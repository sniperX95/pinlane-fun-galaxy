// LES HEURES SE LISENT SANS MUR, LE RETOUR REVIENT OU IL FAUT, ET UNE DUREE
// QUI NE RENTRE PLUS LE DIT (Movsar, 2026-09-17, maquette et captures).
//
//   [E2] « pour les heures tu pourrais faire un truc comme ca avec dessin ou
//        quoi et ou dcp avec menu regroupe quon peut degroupe pour tout voir
//        comme ca, ca fait moins de trop » / « genre pliant depliant ».
//        Mesure avant : 28 pastilles par activite, toutes peintes d un coup,
//        deux colonnes cote a cote (56 pastilles a l ecran).
//   [H]  « quand on fait retour on tombe sur le choix dactivite et pas a la
//        page precedente de base qui est choix des options donc horaire ».
//        Mesure avant : le pied de l etape des heures appelait goStep(1), qui
//        rend l ecran des ACTIVITES ; l ecran des reglages etait saute.
//   [G]  « ici ya que 30 minutes de dispo avant la fermeture et ici ca met
//        toute possibilite faudrait mettre genre que le temps disponible ici
//        direct ». Mesure avant : 30 min / 1 h / 1h30 / 2 h offerts a 21:21
//        pour un centre qui ferme a 22:00, puis « Aucun creneau disponible »
//        a l ecran suivant.
//
// L HORLOGE DE LA PAGE EST TRUQUEE pour [G] : un samedi a 23:30, pour un
// centre ouvert jusqu a minuit. Sans horloge fixe, ce gate ne rougirait qu une
// demi-heure par jour.
//
// Lancement : node scripts/hour-groups-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const CSS = path.join(ROOT, 'assets/pinlane-client.css');
const INDEX = path.join(ROOT, 'index.html');
const PORT = Number(process.env.PINLANE_HOUR_GROUPS_PORT || 4253);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
// Le samedi ferme a minuit dans la grille du centre : a 23:30 il reste 30 min.
const HORLOGE_TARD = `${DATE}T23:30:00`;

const database = require('../lib/database');
database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
];

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/api/public-booking-meta') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(metaPayload()));
      return;
    }
    if (url.pathname === '/api/public-availability') {
      try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n--- ${title}`); }

async function withSourceMutation(file, from, to, run) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`ancre trouvee ${count} fois dans ${path.basename(file)}`);
  try {
    fs.writeFileSync(file, original.split(from).join(to));
    return await run();
  } finally {
    fs.writeFileSync(file, original);
    if (fs.readFileSync(file, 'utf8') !== original) throw new Error(`${path.basename(file)} non restaure`);
  }
}

// Horloge de la page figee : sans elle, [G] ne serait vrai qu une demi-heure
// par jour et les rouges dependraient du calendrier.
async function figerHorloge(page, isoLocal) {
  await page.addInitScript((iso) => {
    const Reelle = Date;
    const fixe = new Reelle(iso).getTime();
    function Fausse(...args) {
      if (!args.length) return new Reelle(fixe);
      return new Reelle(...args);
    }
    Fausse.now = () => fixe;
    Fausse.parse = Reelle.parse;
    Fausse.UTC = Reelle.UTC;
    Fausse.prototype = Reelle.prototype;
    window.Date = Fausse;
  }, isoLocal);
}

async function ouvrirTunnel(browser, { etiquette, horloge = null }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  if (horloge) await figerHorloge(page, horloge);
  await page.goto(`${BASE_URL}/reserver/libramont?v=hg-${etiquette}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep2 === 'function' && document.querySelectorAll('#clientView .activity-card').length >= 8, null, { timeout: 20000 });
  await page.evaluate((date) => {
    const champ = document.getElementById('fDate');
    champ.value = date;
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  }, DATE);
  await page.waitForTimeout(500);
  const grilleVisible = () => page.evaluate(() => {
    const grille = document.querySelector('#clientView .activity-grid');
    return Boolean(grille) && grille.getBoundingClientRect().height > 0;
  });
  for (let pas = 0; pas < 4 && !(await grilleVisible()); pas += 1) {
    const continuer = page.locator('#btnVenueContinue');
    if (!(await continuer.isVisible().catch(() => false))) break;
    await continuer.click({ timeout: 4000 });
    await page.waitForTimeout(450);
  }
  if (!(await grilleVisible())) throw new Error('montage impossible : grille des activites masquee');
  for (const id of ['bowling', 'laser_game']) {
    const toggle = page.locator(`#clientView .activity-card[data-activity="${id}"] .activity-toggle`).first();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click({ timeout: 6000 });
    await page.waitForTimeout(300);
  }
  return { context, page };
}

async function allerAuxHeures(page) {
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForTimeout(700);
  await page.locator('#btnStep1').click({ timeout: 6000 });
  await page.waitForFunction(() => document.querySelectorAll('.anchor-row[data-anchor] .slot-period').length >= 2, null, { timeout: 25000 });
  await page.waitForTimeout(900);
}

// L etat des moments d une activite : ouverts, fermes, et ce qu ils annoncent.
const ETAT_MOMENTS = (activityId) => {
  const row = document.querySelector(`.anchor-row[data-anchor="${activityId}"]`);
  if (!row) return { moments: [] };
  return {
    moments: [...row.querySelectorAll('.slot-period')].map((section) => {
      const tete = section.querySelector('.slot-period-head');
      const grille = section.querySelector('.anchor-chip-grid');
      return {
        cle: section.getAttribute('data-period') || '',
        ouvert: section.classList.contains('is-open'),
        annonce: tete ? (tete.getAttribute('aria-expanded') || '') : '',
        titre: tete ? ((tete.querySelector('.slot-period-title') || {}).textContent || '').trim() : '',
        compte: tete ? ((tete.querySelector('.slot-period-count') || {}).textContent || '').trim() : '',
        dessin: tete ? Boolean(tete.querySelector('.slot-period-icon svg')) : false,
        hauteurTete: tete ? Math.round(tete.getBoundingClientRect().height) : 0,
        pastillesPeintes: grille ? [...grille.querySelectorAll('.anchor-chip')].filter((chip) => chip.getBoundingClientRect().height > 0).length : 0,
        pastillesDansLeDom: grille ? grille.querySelectorAll('.anchor-chip').length : 0,
      };
    }),
  };
};

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =================================================================== [E2]
    section('[E2] Les moments de la journee se plient et se deplient');
    const { context, page } = await ouvrirTunnel(browser, { etiquette: 'moments' });
    await allerAuxHeures(page);
    const etat = await page.evaluate(ETAT_MOMENTS, 'bowling');
    record('montage : la journee est decoupee en plusieurs moments', etat.moments.length >= 2, JSON.stringify(etat.moments.map((m) => m.cle)));
    record('chaque moment porte un dessin', etat.moments.every((m) => m.dessin));
    record('chaque moment dit combien d heures il porte', etat.moments.every((m) => /heure|aucune/i.test(m.compte)), JSON.stringify(etat.moments.map((m) => m.compte)));
    record('sa tete est une cible tactile (>= 44 px)', etat.moments.every((m) => m.hauteurTete >= 44), JSON.stringify(etat.moments.map((m) => m.hauteurTete)));
    const ouverts = etat.moments.filter((m) => m.ouvert);
    record('UN SEUL moment est ouvert a l arrivee', ouverts.length === 1, `${ouverts.length} ouvert(s)`);
    record('les moments fermes ne peignent aucune pastille', etat.moments.filter((m) => !m.ouvert).every((m) => m.pastillesPeintes === 0));
    record('mais leurs heures restent dans la page (rien n est retire)', etat.moments.filter((m) => !m.ouvert).every((m) => m.pastillesDansLeDom > 0), JSON.stringify(etat.moments.map((m) => m.pastillesDansLeDom)));
    record('l annonce accessible suit l etat', etat.moments.every((m) => m.annonce === (m.ouvert ? 'true' : 'false')));

    // Deplier a la main, puis poser une heure : le moment reste ouvert.
    const ferme = etat.moments.find((m) => !m.ouvert);
    await page.evaluate((cle) => {
      const tete = document.querySelector(`.anchor-row[data-anchor="bowling"] .slot-period[data-period="${cle}"] .slot-period-head`);
      if (tete) tete.click();
    }, ferme.cle);
    await page.waitForTimeout(600);
    const apresClic = await page.evaluate(ETAT_MOMENTS, 'bowling');
    const deplie = apresClic.moments.find((m) => m.cle === ferme.cle);
    record('un clic deplie le moment ferme', Boolean(deplie && deplie.ouvert && deplie.pastillesPeintes > 0), JSON.stringify(deplie));
    record('et son annonce accessible le dit', Boolean(deplie && deplie.annonce === 'true'));

    const heureDuMoment = await page.evaluate((cle) => {
      const chip = document.querySelector(`.anchor-row[data-anchor="bowling"] .slot-period[data-period="${cle}"] .anchor-chip:not([disabled])`);
      if (!chip) return '';
      chip.click();
      return chip.getAttribute('data-time') || '';
    }, ferme.cle);
    await page.waitForTimeout(2500);
    const apresChoix = await page.evaluate(ETAT_MOMENTS, 'bowling');
    const toujoursOuvert = apresChoix.moments.find((m) => m.cle === ferme.cle);
    record('poser une heure ne referme pas le moment deplie', Boolean(heureDuMoment) && Boolean(toujoursOuvert && toujoursOuvert.ouvert), `${heureDuMoment} ${JSON.stringify(toujoursOuvert && toujoursOuvert.ouvert)}`);

    // ==================================================================== [H]
    section('[H] Le retour depuis les heures revient a l ecran des reglages');
    await page.locator('#btnStep2Back').click({ timeout: 6000 });
    await page.waitForTimeout(1200);
    const retour = await page.evaluate(() => ({
      etape: typeof state !== 'undefined' ? state.step : 0,
      surReglages: document.getElementById('step1').classList.contains('is-options'),
      titre: ((document.querySelector('#step1.is-options .activity-configurator-title') || {}).textContent || '').trim(),
      grilleActivites: (() => { const g = document.querySelector('#clientView .activity-grid'); return Boolean(g) && g.getBoundingClientRect().height > 0; })(),
    }));
    record('on revient a l etape 1', retour.etape === 1, `etape=${retour.etape}`);
    record('sur l ecran des REGLAGES, pas sur le choix des activites', retour.surReglages && retour.grilleActivites === false, JSON.stringify(retour));
    await context.close();

    // ==================================================================== [G]
    section('[G] Une duree qui ne rentre plus avant la fermeture le dit');
    {
      const { context: ctx, page: tard } = await ouvrirTunnel(browser, { etiquette: 'tard', horloge: HORLOGE_TARD });
      const horloge = await tard.evaluate(() => ({
        maintenant: new Date().toTimeString().slice(0, 5),
        jour: typeof todayStr === 'function' ? todayStr() : '',
        restant: typeof heuresJusquALaFermeture === 'function' ? heuresJusquALaFermeture() : null,
        fermeture: typeof libelleFermetureDuJour === 'function' ? libelleFermetureDuJour() : '',
      }));
      record('montage : l horloge de la page est bien figee tard', horloge.maintenant === '23:30', JSON.stringify(horloge));
      record('montage : il reste une demi-heure avant la fermeture', horloge.restant === 0.5, `restant=${horloge.restant}`);
      await tard.evaluate(() => { showMobileOptionsPage(true); });
      await tard.waitForTimeout(1200);
      const options = await tard.evaluate(() => {
        const rangees = [...document.querySelectorAll('.activity-config-row.is-visible')];
        return {
          pastilles: rangees.flatMap((row) => [...row.querySelectorAll('[data-opt]')].map((pill) => ({
            activite: row.getAttribute('data-activity-options'),
            valeur: pill.getAttribute('data-val'),
            cle: pill.getAttribute('data-opt'),
            verrouillee: pill.disabled && pill.hasAttribute('data-too-late'),
            active: pill.classList.contains('active'),
          }))),
          notes: [...document.querySelectorAll('[data-role="closing-note"]')].map((n) => n.textContent.trim()),
        };
      });
      const bowling = options.pastilles.filter((p) => p.activite === 'bowling' && p.cle === 'duration');
      const demiHeure = bowling.find((p) => Number(p.valeur) === 0.5);
      const uneHeure = bowling.find((p) => Number(p.valeur) === 1);
      const deuxHeures = bowling.find((p) => Number(p.valeur) === 2);
      record('montage : les quatre durees de bowling sont bien la', bowling.length >= 4, `${bowling.length} durees`);
      record('30 min reste prenable', Boolean(demiHeure) && demiHeure.verrouillee === false);
      record('1 heure est verrouillee (elle ne rentre plus)', Boolean(uneHeure) && uneHeure.verrouillee === true);
      record('2 heures est verrouillee', Boolean(deuxHeures) && deuxHeures.verrouillee === true);
      record('la duree retenue est celle qui tient', Boolean(demiHeure) && demiHeure.active === true, JSON.stringify(bowling.filter((p) => p.active)));
      record('une note dit le temps restant et la fermeture', options.notes.some((texte) => /reste 30 min/i.test(texte) && /minuit|fermeture/i.test(texte)), JSON.stringify(options.notes));
      const laser = options.pastilles.filter((p) => p.activite === 'laser_game' && p.cle === 'games');
      record('cote laser aussi : 1 partie tient, 3 parties non', Boolean(laser.find((p) => Number(p.valeur) === 1 && !p.verrouillee)) && Boolean(laser.find((p) => Number(p.valeur) === 3 && p.verrouillee)), JSON.stringify(laser));
      await ctx.close();
    }

    // =========================================================== CONTRE-EPREUVES
    section('Contre-epreuves par mutation du code de production');
    try {
      const sansPli = await withSourceMutation(
        CSS,
        '#clientView .slot-period:not(.is-open) .anchor-chip-grid { display: none; }',
        '#clientView .slot-period:not(.is-open) .anchor-chip-grid { display: grid; }',
        async () => {
          const { context: ctx, page: p2 } = await ouvrirTunnel(browser, { etiquette: 'sanspli' });
          await allerAuxHeures(p2);
          const etat2 = await p2.evaluate(ETAT_MOMENTS, 'bowling');
          await ctx.close();
          return etat2;
        },
      );
      record('sans la regle de pliage, tout se peint : ce gate ROUGIRAIT', sansPli.moments.filter((m) => !m.ouvert).some((m) => m.pastillesPeintes > 0), JSON.stringify(sansPli.moments.map((m) => ({ cle: m.cle, ouvert: m.ouvert, peintes: m.pastillesPeintes }))));
    } catch (error) {
      record('contre-epreuve du pliage montable', false, error.message);
    }

    try {
      const sansRetour = await withSourceMutation(
        INDEX,
        '<button class="btn-secondary" id="btnStep2Back" onclick="retourDepuisCreneau()">',
        '<button class="btn-secondary" id="btnStep2Back" onclick="goStep(1)">',
        async () => {
          const { context: ctx, page: p3 } = await ouvrirTunnel(browser, { etiquette: 'sansretour' });
          await allerAuxHeures(p3);
          await p3.locator('#btnStep2Back').click({ timeout: 6000 });
          await p3.waitForTimeout(1200);
          const vu = await p3.evaluate(() => ({
            surReglages: document.getElementById('step1').classList.contains('is-options'),
            grilleActivites: (() => { const g = document.querySelector('#clientView .activity-grid'); return Boolean(g) && g.getBoundingClientRect().height > 0; })(),
          }));
          await ctx.close();
          return vu;
        },
      );
      record('avec l ancien retour, on retombe sur les activites : ce gate ROUGIRAIT', sansRetour.surReglages === false && sansRetour.grilleActivites === true, JSON.stringify(sansRetour));
    } catch (error) {
      record('contre-epreuve du retour montable', false, error.message);
    }

    try {
      const sansVerrou = await withSourceMutation(
        APP_JS,
        'const trop = restant !== null && heures > restant + 0.001;',
        'const trop = false;',
        async () => {
          const { context: ctx, page: p4 } = await ouvrirTunnel(browser, { etiquette: 'sansverrou', horloge: HORLOGE_TARD });
          await p4.evaluate(() => { showMobileOptionsPage(true); });
          await p4.waitForTimeout(1200);
          const vu = await p4.evaluate(() => {
            const row = document.querySelector('.activity-config-row.is-visible[data-activity-options="bowling"]');
            const pill = row ? row.querySelector('[data-opt="duration"][data-val="2"]') : null;
            return { verrouillee: pill ? (pill.disabled && pill.hasAttribute('data-too-late')) : null };
          });
          await ctx.close();
          return vu;
        },
      );
      record('sans le verrou, 2 heures reste prenable a 23:30 : ce gate ROUGIRAIT', sansVerrou.verrouillee === false, JSON.stringify(sansVerrou));
    } catch (error) {
      record('contre-epreuve du verrou montable', false, error.message);
    }

    record('index.html restaure a l identique', fs.readFileSync(INDEX, 'utf8').includes('onclick="retourDepuisCreneau()"'));
    record('pinlane-client.css restaure a l identique', fs.readFileSync(CSS, 'utf8').includes('#clientView .slot-period:not(.is-open) .anchor-chip-grid { display: none; }'));
    record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8').includes('const trop = restant !== null && heures > restant + 0.001;'));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'HOUR GROUPS OK' : `HOUR GROUPS : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });
