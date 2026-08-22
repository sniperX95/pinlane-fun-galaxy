// Gate UI du VERDICT DU JOUR cote CLIENT (BUG 1 : "la fermeture n'est pas
// affichee cote client"). Edge headless via playwright-core, index.html reel
// servi en memoire, /api/public-booking-meta mocke avec la VRAIE forme du
// contrat `center.day` produit par api/public-booking-meta.js.
//
// Ce gate est le seul qui prouve que la fermeture est VISIBLE. Le gate serveur
// (scripts/availability-day-check.js) prouve que le verdict est CALCULE ; ici on
// prouve qu'il est PEINT, et qu'aucun faux "Ouvert" ne subsiste.
//
// Preuves COMPORTEMENTALES (jamais une simple presence de chaine) :
//   1. day absent  => rendu strictement historique : "Ouvert ...", aucun bloc
//      .day-status, aucune banniere jour, tuile Laser cochable. C'est la
//      garantie de non-regression des 16 gates qui mockent cet endpoint.
//   2. centre ferme ce jour => #schedHint porte .day-status.is-closed, le mot
//      "Ouvert" a DISPARU, la banniere .formule-day-alert est la, et TOUTES les
//      cartes formule sont disabled + aria-disabled.
//   3. laser_game ferme (centre ouvert) => la TUILE Laser du selecteur porte
//      .is-off, son bouton est disabled + aria-disabled, sa ligne de prix dit
//      "Fermé ce jour" ; la formule ancree laser est disabled AVEC la raison
//      exacte "Laser Game ferme ce jour", une formule sans laser reste
//      reservable (preuve que le grisage est cible, pas un rideau).
//      2026-08-08 : ce point observait #segLaser et sa pastille .seg-btn-off,
//      supprimes par la refonte du selecteur (8 tuiles + panneau commun). Le
//      comportement n'avait pas bouge, l'element si : le gate rougissait sur un
//      selecteur mort, et son pendant "control-laser-clickable" ne pouvait plus
//      JAMAIS echouer (getElementById rendait null des deux cotes).
//   4. coupure horaire => .day-status.is-partial annonce l'amplitude ET la
//      coupure, sans fermer le centre ni griser une carte de plus.
//   5. retour a day absent => snapshot IDENTIQUE au point 1 (aucune fuite d'etat).
//
// Puis QUATRE contre-preuves par MUTATION du VRAI source (assets/booking-core.js
// et assets/app-main.js), restauration par EDITION INVERSE exacte (jamais
// git checkout). Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/availability-day-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_PDAY_PORT || 4253);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = path.join(ROOT, 'assets', 'app-main.js');
const CORE = path.join(ROOT, 'assets', 'booking-core.js');
// Le catalogue vendable vient du VRAI module serveur, avec la meme
// `activityAvailability` que le centre mocke plus bas : une liste ecrite a la
// main ici perimerait le jour ou le contrat bouge, et c'est exactement ce qui
// avait rendu ce gate aveugle a la refonte du selecteur.
const { listSellableActivities } = require('../lib/activity-catalog.js');
// Le centre mocke POSSEDE tout ce que son catalogue exige (bowling, laser,
// arcades, minigolf, table anniversaire, plaine de jeux). Il n'en vendait que
// deux, et servait pourtant les 14 formules : un etat que la production ne
// peut pas avoir, et qui masquait le defaut mesure le 2026-08-22 (une formule
// dont le centre n'a pas les ingredients ne se planifie jamais). Les
// ingredients non vendables (table, plaine) ne rejoignent pas le selecteur :
// listSellableActivities les ecarte.
const SELLABLE_ACTIVITIES = listSellableActivities({
  centerId: 'libramont',
  availability: { bowling: true, laser_game: true, arcade_time: true, minigolf_blacklight: true, party_table: true, playground: true },
});
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Mutations ciblees du VRAI source. Chacune doit faire rougir UN check precis.
const MUTATIONS = [
  {
    name: 'getSchedule ignore le verdict de fermeture du serveur',
    file: CORE,
    find: '    if (verdict.open === false) return null;',
    replace: '    if (false) return null;',
    expect: 'closed-all-cards-disabled',
  },
  {
    name: 'updateSchedHint n affiche plus le bloc ferme',
    file: APP,
    find: '  if (dayStatus && dayStatus.open === false) {',
    replace: '  if (false) {',
    expect: 'closed-day-status-block',
  },
  {
    name: 'la tuile de l activite fermee ne s eteint plus',
    file: APP,
    find: '    const closed = off.includes(activityId);',
    replace: '    const closed = false;',
    expect: 'laser-card-off',
  },
  {
    name: 'getFormuleAvailability ignore les formules bloquees du jour',
    file: APP,
    find: '  if (dayStatus && Array.isArray(dayStatus.unavailableFormulaIds) && dayStatus.unavailableFormulaIds.includes(formule.id)) {',
    replace: '  if (false && Array.isArray(dayStatus.unavailableFormulaIds) && dayStatus.unavailableFormulaIds.includes(formule.id)) {',
    expect: 'laser-formula-disabled',
  },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function applyEdit(file, find, replace) {
  const src = fs.readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const f = find.split('\n').join(eol);
  const r = replace.split('\n').join(eol);
  const count = src.split(f).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count}) dans ${path.basename(file)} : ${find.slice(0, 48)}`);
  fs.writeFileSync(file, src.replace(f, r));
}

// Mock de /api/public-booking-meta pilote par window.__pdayScenario. La forme du
// payload est celle du serveur reel : center.day n'existe QUE si &date= est
// passe, et day.date fait echo de la date demandee (garde anti-course cliente).
async function installMock(page) {
  await page.addInitScript((sellable) => {
    window.__pdaySellable = sellable;
    window.__pdayScenario = 'none';
    window.__pdayFetches = 0;
    window.__pdayQueries = [];

    const OPEN_DAY = { open: '10:00', close: '22:00' };
    const CENTER = {
      id: 'libramont', status: 'active',
      defaultSchedule: {
        regular: { 0: OPEN_DAY, 1: OPEN_DAY, 2: OPEN_DAY, 3: OPEN_DAY, 4: OPEN_DAY, 5: OPEN_DAY, 6: OPEN_DAY },
        holiday: {},
      },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      activityAvailability: { bowling: true, laser_game: true, arcade_time: true, minigolf_blacklight: true, party_table: true, playground: true },
    };
    const SCHEDULE = { open: 10, close: 22, label: '10h - 22h' };

    // Verdicts calques sur buildDayStatus (api/public-booking-meta.js) : aucune
    // cle inventee, aucun `reason` du staff, jamais de blocage de scope 'lane'.
    const dayFor = (scenario, date) => {
      if (scenario === 'none') return null;
      const base = {
        date, open: true, schedule: SCHEDULE, closedLabel: '', closedWindows: [],
        unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {},
      };
      if (scenario === 'closed') {
        return { ...base, open: false, closedLabel: 'Fermé exceptionnellement ce jour' };
      }
      if (scenario === 'laser-off') {
        return {
          ...base,
          unavailableActivityIds: ['laser_game'],
          unavailableFormulaIds: ['f1'],
          unavailableFormulaReason: { f1: 'laser_game' },
        };
      }
      if (scenario === 'partial') {
        return { ...base, closedWindows: [{ start: '16:00', end: '18:00' }] };
      }
      return base;
    };

    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(raw, window.location.origin); } catch (e) { return nf(input, init); }
      if (u.pathname === '/api/public-booking-meta') {
        const date = u.searchParams.get('date') || '';
        window.__pdayQueries.push(u.search);
        window.__pdayFetches += 1;
        const day = date ? dayFor(window.__pdayScenario, date) : null;
        return J({
          ok: true,
          today: new Date().toISOString().slice(0, 10),
          durationOptions: [],
          // Le SOCLE, comme le fait la prod pour un centre du fichier : depuis
          // le 2026-08-21, un `formules: []` veut dire « ce centre ne vend
          // aucune formule » et la console l'affiche tel quel, au lieu de
          // retomber sur le catalogue de Fun Galaxy (fuite d'affichage chez un
          // autre client). Ce mock doit donc servir ce que le serveur sert.
          formules: (typeof FORMULES !== 'undefined' ? FORMULES : []),
          // Ce que le centre vend : sans cette cle le selecteur d'activites ne
          // construit AUCUNE tuile, et les checks laser passeraient sur du vide.
          activities: window.__pdaySellable,
          center: { ...CENTER, ...(day ? { day } : {}) },
        });
      }
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: false });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], slots: [] });
      return nf(input, init);
    };
  }, SELLABLE_ACTIVITIES);
}

// Snapshot de tout ce qui porte l'information "ouvert / ferme" a l'ecran.
function snapshot(page) {
  return page.evaluate(() => {
    const hint = document.getElementById('schedHint');
    const cards = Array.from(document.querySelectorAll('#formuleGrid .formule-card'));
    const statusOf = (id) => {
      const card = document.querySelector(`#formuleGrid .formule-card[data-formule-id="${id}"]`);
      const el = card && card.querySelector('.formule-card-status');
      return el ? el.textContent.trim() : '';
    };
    // Le choix d'une activite se fait dans la grille de tuiles (#activityPicker),
    // plus dans un segment. On lit la tuile Laser telle qu'elle est peinte.
    const laserCard = document.querySelector('#activityPicker .activity-card[data-activity="laser_game"]');
    const laserToggle = laserCard && laserCard.querySelector('.activity-toggle');
    const laserPrice = laserCard && laserCard.querySelector('[data-role="price"]');
    return {
      hintText: hint ? hint.textContent.trim() : '',
      hintHasOuvert: /Ouvert/.test(hint ? hint.textContent : ''),
      closedBlocks: document.querySelectorAll('#schedHint .day-status.is-closed').length,
      partialBlocks: document.querySelectorAll('#schedHint .day-status.is-partial').length,
      dayAlerts: document.querySelectorAll('#formuleGrid .formule-day-alert').length,
      typeAlerts: document.querySelectorAll('#typeAlert .day-status').length,
      cardCount: cards.length,
      disabledIds: cards.filter((c) => c.hasAttribute('disabled')).map((c) => c.getAttribute('data-formule-id')),
      ariaDisabledCount: cards.filter((c) => c.getAttribute('aria-disabled') === 'true').length,
      f1Status: statusOf('f1'),
      mmStatus: statusOf('mm'),
      activityCards: document.querySelectorAll('#activityPicker .activity-card').length,
      laserCardPresent: Boolean(laserCard),
      laserCardOff: Boolean(laserCard && laserCard.classList.contains('is-off')),
      laserToggleDisabled: Boolean(laserToggle && laserToggle.disabled),
      laserToggleAria: laserToggle ? laserToggle.getAttribute('aria-disabled') : '',
      laserPrice: laserPrice ? laserPrice.textContent.trim() : '',
    };
  });
}

async function applyScenario(page, scenario, dateStr) {
  const before = await page.evaluate(() => window.__pdayFetches);
  await page.evaluate((next) => { window.__pdayScenario = next; }, scenario);
  await page.evaluate((d) => {
    const el = document.getElementById('fDate');
    el.value = d;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, dateStr);
  await page.waitForFunction((n) => window.__pdayFetches > n, before, { timeout: 8000 });
  // Le rendu suit la resolution du fetch dans la meme continuation async.
  await page.waitForTimeout(200);
  return snapshot(page);
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=pday-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(
      () => typeof window.setView === 'function' && typeof state !== 'undefined' && typeof getCenterDayStatusFor === 'function',
      null, { timeout: 15000 },
    );

    // Date choisie A L'EXECUTION : premiere date future hors vacances/ferie, pour
    // qu'aucun motif de blocage etranger au verdict ne pollue les cartes. Une
    // date en dur perimerait (lecon de scripts/run-visual-qa.js).
    const dateStr = await page.evaluate(() => {
      for (let i = 7; i < 400; i += 1) {
        const candidate = addDays(todayStr(), i);
        if (!getSpecialOpeningContext(candidate, false).active) return candidate;
      }
      return addDays(todayStr(), 30);
    });
    // pax = 8 : au-dessus du minPax 6 des formules ancrees, sinon elles seraient
    // deja grisees pour une raison qui n'a rien a voir avec la fermeture.
    await page.evaluate(() => {
      state.view = 'client';
      setView('client');
      const pax = document.getElementById('fPax');
      pax.value = '8';
      pax.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // ---- 1. day ABSENT : rendu strictement historique ----------------------
    const control = await applyScenario(page, 'none', dateStr);
    ok(control.hintHasOuvert, 'control-ouvert', JSON.stringify(control.hintText));
    ok(control.closedBlocks === 0 && control.partialBlocks === 0, 'control-no-day-status', JSON.stringify(control));
    ok(control.dayAlerts === 0 && control.typeAlerts === 0, 'control-no-day-alert', JSON.stringify(control));
    // Precondition du test 3 : sans la tuile a l'ecran, "la tuile est eteinte"
    // ne prouverait rien du tout (c'est le piege qui a rendu ce gate aveugle).
    ok(control.laserCardPresent && control.activityCards >= 2, 'control-activity-cards',
      JSON.stringify({ cards: control.activityCards, laser: control.laserCardPresent }));
    ok(!control.laserCardOff && !control.laserToggleDisabled && control.laserToggleAria === 'false',
      'control-laser-clickable', JSON.stringify(control));
    ok(control.cardCount > 0, 'control-cards-rendered', JSON.stringify(control.cardCount));
    // Precondition du test 3 : sans elle, "f1 grisee" ne prouverait rien.
    ok(!control.disabledIds.includes('f1'), 'control-f1-enabled', JSON.stringify(control.disabledIds));
    ok(!control.disabledIds.includes('mm'), 'control-mm-enabled', JSON.stringify(control.disabledIds));

    // ---- 2. Centre ferme ce jour -------------------------------------------
    const closed = await applyScenario(page, 'closed', dateStr);
    ok(closed.closedBlocks === 1, 'closed-day-status-block', JSON.stringify(closed.hintText));
    ok(!closed.hintHasOuvert, 'closed-no-ouvert', JSON.stringify(closed.hintText));
    ok(/Fermé exceptionnellement le /.test(closed.hintText), 'closed-hint-wording', JSON.stringify(closed.hintText));
    ok(closed.dayAlerts === 1, 'closed-banner', JSON.stringify(closed.dayAlerts));
    ok(closed.cardCount > 0 && closed.disabledIds.length === closed.cardCount, 'closed-all-cards-disabled', `${closed.disabledIds.length}/${closed.cardCount}`);
    ok(closed.ariaDisabledCount === closed.cardCount, 'closed-all-cards-aria', `${closed.ariaDisabledCount}/${closed.cardCount}`);
    // Une raison repetee sur quinze cartes est du bruit : la banniere suffit.
    ok(closed.f1Status === '' && closed.mmStatus === '', 'closed-cards-silent', JSON.stringify([closed.f1Status, closed.mmStatus]));

    // ---- 3. Laser ferme, centre ouvert -------------------------------------
    const laserOff = await applyScenario(page, 'laser-off', dateStr);
    ok(laserOff.hintHasOuvert, 'laser-center-still-open', JSON.stringify(laserOff.hintText));
    ok(laserOff.laserCardOff && laserOff.laserToggleDisabled && laserOff.laserToggleAria === 'true',
      'laser-card-disabled', JSON.stringify(laserOff));
    ok(laserOff.laserPrice === 'Fermé ce jour', 'laser-card-off', JSON.stringify(laserOff.laserPrice));
    ok(laserOff.typeAlerts === 1, 'laser-type-alert', JSON.stringify(laserOff.typeAlerts));
    ok(laserOff.disabledIds.includes('f1'), 'laser-formula-disabled', JSON.stringify(laserOff.disabledIds));
    ok(laserOff.f1Status === 'Laser Game fermé ce jour', 'laser-formula-reason', JSON.stringify(laserOff.f1Status));
    // Cible, pas rideau : une formule sans ancre laser reste vendable.
    ok(!laserOff.disabledIds.includes('mm'), 'laser-other-formula-open', JSON.stringify(laserOff.disabledIds));
    ok(laserOff.dayAlerts === 0, 'laser-no-closed-banner', JSON.stringify(laserOff.dayAlerts));

    // ---- 4. Coupure horaire : limite annoncee, rien de grise ----------------
    const partial = await applyScenario(page, 'partial', dateStr);
    ok(partial.partialBlocks === 1, 'partial-day-status-block', JSON.stringify(partial.hintText));
    ok(/Ouvert 10h - 22h/.test(partial.hintText), 'partial-keeps-amplitude', JSON.stringify(partial.hintText));
    ok(/de 16h à 18h/.test(partial.hintText), 'partial-window-wording', JSON.stringify(partial.hintText));
    ok(partial.disabledIds.length === control.disabledIds.length, 'partial-no-extra-disabled', JSON.stringify(partial.disabledIds));

    // ---- 5. Retour a day absent : aucun etat residuel ----------------------
    const back = await applyScenario(page, 'none', dateStr);
    ok(JSON.stringify(back) === JSON.stringify(control), 'back-to-control-identical', JSON.stringify({ back, control }));
  } catch (error) {
    ok(false, 'suite-exception', error && error.message);
  } finally {
    await page.close();
  }
  return failures;
}

(async () => {
  const originals = new Map([[APP, fs.readFileSync(APP, 'utf8')], [CORE, fs.readFileSync(CORE, 'utf8')]]);
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const restoreAll = () => {
    originals.forEach((content, file) => {
      if (fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content);
    });
  };
  try {
    console.log('--- passe 1 : gate nominal ---');
    const base = await runSuite(browser, false);
    if (base.length) {
      console.error(`availability-day-ui-check: ROUGE en nominal (${base.join(', ')})`);
      process.exitCode = 1;
      return;
    }

    for (const m of MUTATIONS) {
      console.log(`--- contre-preuve par mutation : ${m.name} ---`);
      applyEdit(m.file, m.find, m.replace);
      let red;
      try {
        red = await runSuite(browser, true);
      } finally {
        applyEdit(m.file, m.replace, m.find); // edition inverse exacte, jamais git checkout
      }
      if (fs.readFileSync(m.file, 'utf8') !== originals.get(m.file)) {
        console.error(`availability-day-ui-check: restauration ratee sur ${path.basename(m.file)}`);
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`availability-day-ui-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`availability-day-ui-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`availability-day-ui-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('availability-day-ui-check: ALL OK (day absent = rendu historique, centre ferme visible sans faux Ouvert, laser ferme = tuile eteinte + formule ancree grisee avec sa raison, coupure annoncee sans grisage, retour sans etat residuel ; 4 contre-preuves par mutation)');
  } finally {
    try { restoreAll(); } catch (e) { /* ignore */ }
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('availability-day-ui-check: exception', error && (error.stack || error));
  process.exit(1);
});
