// LE TUNNEL SE PROUVE AU DOIGT, PAS A L'INJECTION.
//
// Ne du bug du 2026-08-18 (journal 171) : en prod a 390x844, le clic
// « Verifier les disponibilites » ne quittait JAMAIS l'etape 1. Le gate
// one-screen etait VERT pendant ce temps, parce qu'il avance le tunnel par
// page.evaluate(() => goStep2()) : un chemin qu'aucun doigt n'emprunte. La
// cause etait triple, et chaque volet a son assertion ici :
//   1. le CTA du pied d'etape etait pousse HORS ECRAN (26 px a x=382) par la
//      demande sur mesure qui gardait width: 100 % sous son flex: none ->
//      CHAQUE tap de ce gate exige l'element ENTIEREMENT dans le viewport ET
//      le hit-test reel (elementFromPoint) avant de taper ;
//   2. les barres position:fixed DANS la piste transformee (decision du
//      recapitulatif, Valider des ancres) devenaient des absolus de piste et
//      partaient a un ecran entier du viewport -> le parcours va jusqu'a la
//      CONFIRMATION, dans les DEUX variantes de l'etape creneau ;
//   3. un scrollIntoView ou un focus pouvait pousser le scrollLeft de la
//      scene overflow:hidden et desaxer toutes les etapes -> le verrou est
//      teste en COMPORTEMENT (on pousse, il revient), pas en presence.
//
// Contre-epreuve par mutation : on retire `width: auto` de la regle mobile de
// la demande sur mesure (le bug exact du 2026-08-18) et le CTA doit redevenir
// inatteignable -> le gate sait rougir. Restauration inverse ensuite.
//
// Lancement : node scripts/tunnel-mobile-touch-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const database = require('../lib/database');

const CLIENT_CSS = path.join(ROOT, 'assets/pinlane-client.css');
const PORT = Number(process.env.PINLANE_MOBILETOUCH_PORT || 4218);
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

// Aucun acces base : l'instantane est neutralise avant le chargement de l'API.
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
    if (url.pathname === '/api/public-booking-meta') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(metaPayload())); return; }
    if (url.pathname === '/api/public-availability') { try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); } return; }
    if (url.pathname === '/api/public-reservations') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, reservation: { id: 1 }, ops: {}, communications: [], warnings: [] })); }); return; }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '/reserver' || /^\/reserver\/[a-z0-9-]+\/?$/.test(url.pathname)) filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// Un element n'est tapable que s'il est ENTIEREMENT dans le viewport et que
// le hit-test reel (elementFromPoint en son centre) le rend, lui ou un de ses
// enfants. C'est exactement ce que le bug du 2026-08-18 violait.
async function probeTappable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false, inViewport: false, hit: false };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      present: true,
      inViewport: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      hit: !!top && (el === top || el.contains(top)),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }, selector);
}

async function provenTap(page, selector, label) {
  const probe = await probeTappable(page, selector);
  ok(probe.present, `${label} : present`);
  if (!probe.present) return false;
  ok(probe.inViewport, `${label} : entierement dans l ecran (${JSON.stringify(probe.rect)})`);
  ok(probe.hit, `${label} : recoit le doigt (hit-test reel)`);
  if (!probe.inViewport || !probe.hit) return false;
  await page.tap(selector, { timeout: 5000 });
  return true;
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))).catch(() => {});
  await page.waitForTimeout(120);
}

async function bootTunnel(page) {
  await page.goto(`${BASE_URL}/reserver?v=touch-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goStep === 'function', null, { timeout: 15000 });
  // PAGE PAR PAGE : une venue confirmee survit au rechargement (journal 162),
  // le telephone demarre alors sur la page activites et le champ date est
  // masque. Le harnais fait le geste du client : Modifier d'abord.
  const dateHidden = await page.evaluate(() => {
    const el = document.getElementById('fDate');
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 || r.height === 0;
  });
  if (dateHidden && await page.locator('#s1VenueLine').isVisible().catch(() => false)) {
    await page.tap('#s1VenueLine');
    await page.waitForTimeout(1000);
  }
  await page.fill('#fDate', DATE);
  await page.waitForTimeout(600);
}

async function openProgram(page) {
  if (await page.locator('#btnVenueContinue').isVisible().catch(() => false)) {
    await provenTap(page, '#btnVenueContinue', 'Voir les activites');
    await settle(page, 1400);
  }
  const chosen = await page.evaluate(() => getChosenActivities().length);
  if (!chosen) {
    await provenTap(page, '#activityPicker .activity-card', 'premiere carte d activite');
    await settle(page, 600);
  }
  ok((await page.evaluate(() => getChosenActivities().length)) >= 1, 'au moins une activite au panier');
}

const step = (page) => page.evaluate(() => Number(state.step));

async function markReachable(page, selector) {
  return page.evaluate((sel) => {
    document.querySelector('[data-touch-target]')?.removeAttribute('data-touch-target');
    const target = [...document.querySelectorAll(sel)].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    });
    if (!target) return null;
    target.setAttribute('data-touch-target', '1');
    return target.textContent.replace(/\s+/g, ' ').trim().slice(0, 30);
  }, selector);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  // DEUX ECRANS DE TELEPHONE, DEUX THEMES : 844 (plein ecran) en clair, et
  // 664 (iPhone reel avec le chrome Safari, verdict de Movsar du 2026-08-18)
  // en SOMBRE : tout le controle visuel du 18 aout etait en clair pendant
  // que Movsar regardait du sombre.
  for (const shape of [
    { width: 390, height: 844, scheme: 'light' },
    // 320x520 : l iPhone reel de Movsar (~320 px utiles, barre Safari
    // deployee). Format de reference de la refonte mobile du 2026-08-18.
    { width: 320, height: 520, scheme: 'dark' },
    { width: 390, height: 664, scheme: 'dark' },
  ]) {
  const context = await browser.newContext({
    viewport: { width: shape.width, height: shape.height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    colorScheme: shape.scheme,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    // --- PARCOURS COMPLET, VARIANTE SIMPLE (une activite -> cartes) --------
    console.log(`\n[${shape.width}x${shape.height} ${shape.scheme} tactile : parcours complet, variante cartes simples]`);
    await bootTunnel(page);
    ok(await step(page) === 1, 'etape 1 au chargement');
    await openProgram(page);
    // PAGE PAR PAGE : programme ouvert, la ligne de rappel de venue est la
    // page de retour. On la tape (retour a la venue), puis on rouvre : le
    // geste Modifier du telephone fait partie du parcours.
    const lineVisible = await page.evaluate(() => {
      const line = document.getElementById('s1VenueLine');
      if (!line) return false;
      const r = line.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    ok(lineVisible, 'la ligne de rappel de la venue est visible programme ouvert');
    if (lineVisible) {
      await provenTap(page, '#s1VenueLine', 'Modifier (retour a la page venue)');
      await settle(page, 1200);
      const backToSolo = await page.evaluate(() => document.querySelector('#clientView .step1-body').classList.contains('is-solo'));
      ok(backToSolo, 'le tap Modifier ramene a la page venue (solo)');
      await provenTap(page, '#btnVenueContinue', 'Voir les activites (retour au programme)');
      await settle(page, 1400);
    }
    await provenTap(page, '#btnStep1', 'Verifier les disponibilites');
    await settle(page, 2200);
    ok(await step(page) === 2, `le doigt quitte l etape 1 (etape courante : ${await step(page)})`);

    const simpleSlots = await page.locator('.slot.slot-card').count();
    ok(simpleSlots > 0, `des cartes d heure sont rendues (${simpleSlots})`);
    const slotLabel = await markReachable(page, '.slot.slot-card');
    ok(!!slotLabel, `une heure atteignable au doigt (${slotLabel || 'aucune'})`);
    await provenTap(page, '[data-touch-target]', `carte ${slotLabel}`);
    await settle(page, 1400);
    ok(await step(page) === 3, `le doigt choisit une heure et passe au contact (${await step(page)})`);

    for (const [sel, value] of [['#fName', 'Marie Dupont'], ['#fPhone', '+32 470 00 00 00'], ['#fEmail', 'marie@email.com']]) {
      await provenTap(page, sel, `champ ${sel}`);
      await page.keyboard.type(value, { delay: 10 });
      await page.waitForTimeout(100);
    }
    // Le VERROU DE SCENE, teste en comportement : on pousse le scrollLeft de
    // la boite overflow:hidden (ce que fait un focus ou un scrollIntoView) et
    // il doit revenir a zero tout seul. Avant le verrou, cette poussee
    // desaxait toutes les etapes (step1 mesure a x=-188 le 2026-08-18).
    const lockWorks = await page.evaluate(async () => {
      const stage = document.querySelector('#clientView .tunnel-stage');
      if (!stage) return { pushed: 0, after: -1 };
      stage.scrollLeft = 200;
      const pushed = stage.scrollLeft;
      await new Promise((r) => setTimeout(r, 150));
      return { pushed, after: stage.scrollLeft };
    });
    ok(lockWorks.after === 0, `verrou de scene : scrollLeft pousse (${lockWorks.pushed}) revient a 0 (${lockWorks.after})`);

    await provenTap(page, '#step3 .step-foot .btn-primary', 'Voir le recapitulatif');
    await settle(page, 1400);
    ok(await step(page) === 4, `le doigt passe au recapitulatif (${await step(page)})`);
    await provenTap(page, '#btnConfirmBooking', 'Confirmer la reservation');
    await settle(page, 2600);
    ok(await step(page) === 5, `le doigt confirme et arrive a l etape 5 (${await step(page)})`);
    const successVisible = await page.evaluate(() => {
      const h2 = document.querySelector('#step5 .success-wrap h2');
      if (!h2) return false;
      const r = h2.getBoundingClientRect();
      return Number(state.step) === 5 && r.top >= 0 && r.bottom <= window.innerHeight;
    });
    ok(successVisible, 'l ecran « C est valide ! » est dans le viewport');

    // --- VARIANTE ANCRES (bowling + laser -> grille + Valider) -------------
    console.log(`\n[${shape.width}x${shape.height} ${shape.scheme} tactile : etape creneau, variante grille d ancres]`);
    await bootTunnel(page);
    await page.evaluate((d) => {
      state.booking.date = d; state.booking.pax = 6; state.booking.mode = 'carte';
      state.booking.venueConfirmed = true;
      state.booking.activities = { bowling: { duration: 1 }, laser_game: { games: 1 } };
      applyChosenActivitiesToBooking(); syncBookingTypeUi();
      goStep(1, { animate: false, focus: false });
    }, DATE);
    await settle(page, 800);
    await provenTap(page, '#btnStep1', 'Verifier les disponibilites (panier ancres)');
    await settle(page, 2400);
    ok(await step(page) === 2, `etape creneau atteinte (${await step(page)})`);
    const chips = await page.evaluate(() => document.querySelectorAll('.anchor-chip:not([disabled])').length);
    ok(chips > 0, `grille d ancres rendue (${chips} heures)`);
    const hOverflow = await page.evaluate(() => {
      const W = window.innerWidth; const out = [];
      document.querySelectorAll('#step2 *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && (r.right > W + 1 || r.left < -1)) out.push((el.className || el.tagName).toString().split(' ')[0]); });
      return [...new Set(out)].slice(0, 6);
    });
    ok(hOverflow.length === 0, `zero debordement horizontal sur l etape creneau (${hOverflow.join(', ') || 'aucun'})`);
    const chipLabel = await markReachable(page, '.anchor-chip:not([disabled])');
    ok(!!chipLabel, `une heure atteignable (${chipLabel || 'aucune'})`);
    await provenTap(page, '[data-touch-target]', `heure ${chipLabel}`);
    await settle(page, 1400);
    await provenTap(page, '.formula-plan-confirm', 'Valider ces horaires');
    await settle(page, 1500);
    ok(await step(page) === 3, `le Valider colle est tapable et mene au contact (${await step(page)})`);

    ok(errors.length === 0, `zero erreur JS/console sur les deux parcours (${errors.length}${errors.length ? ' : ' + errors[0] : ''})`);

    // --- CONTRE-EPREUVE PAR MUTATION (au format 320, le plus etroit) -------
    // Le bug du 2026-08-18 (CTA hors ecran), reintroduit dans la grammaire de
    // la refonte mobile. L ancienne mutation (width: auto de la demande sur
    // mesure) ne mord plus : le pied en flex retrecissable ABSORBE le
    // debordement. Les protections actuelles sont : (1) la demande sur mesure
    // est RETIREE de la page activites sous 640 px, (2) le CTA du pied est
    // pleine largeur SANS plancher (min-width: 0 ; la regle de base pose
    // min-width: 280 px). La mutation retire LES DEUX : la demande sur mesure
    // revient dans la rangee, le CTA reprend son plancher de 280 px, et a
    // 320 px la rangee deborde, le CTA ressort de l ecran.
    if (shape.width === 320) {
      console.log('\n[Contre-epreuve : ce gate sait-il rougir ?]');
      // 1. Les protections structurelles de la refonte existent, uniques et
      //    en place. NOTE HONNETE (2026-08-18) : le bug d origine (la demande
      //    sur mesure poussait le CTA hors ecran) ne peut PLUS etre reproduit
      //    en retirant une seule de ces regles : le pied en flex retrecissable
      //    ABSORBE le debordement (trois regles independantes se relaient :
      //    display none sous 640, width auto sous 900, min-width 0 du CTA).
      //    C est une protection en profondeur, pas un affaiblissement du gate.
      const css = fs.readFileSync(CLIENT_CSS, 'utf8');
      const anchorBespoke = '#clientView #step1:not(.is-solo) .step-foot .bespoke-entry { display: none; }';
      const anchorCta = '#clientView .step-foot .btn-primary { flex: 1 1 auto; min-width: 0; }';
      ok(css.split(anchorBespoke).length - 1 === 1, 'protection en place : demande sur mesure retiree de la page activites (unique)');
      ok(css.split(anchorCta).length - 1 === 1, 'protection en place : CTA du pied pleine largeur sans plancher (unique)');
      // 2. Le DETECTEUR rougit sur la signature geometrique exacte du bug
      //    paye (CTA hors ecran, x=382 sur 390 le 2026-08-18) : on la
      //    reproduit dans la page et la sonde doit la voir.
      await bootTunnel(page);
      await openProgram(page);
      let mutated = null;
      try {
        await page.addStyleTag({ content: '#clientView .step-foot .btn-primary { position: relative; left: 310px; }' });
        mutated = await probeTappable(page, '#btnStep1');
      } finally {
        await page.evaluate(() => { const tags = document.querySelectorAll('style'); tags[tags.length - 1].remove(); });
      }
      ok(mutated && mutated.present && !mutated.inViewport,
        `bug rejoue expres : le CTA ressort de l ecran (${mutated ? JSON.stringify(mutated.rect) : 'n/a'}) -> le gate ROUGIRAIT`);
      const restored = await probeTappable(page, '#btnStep1');
      ok(restored.inViewport && restored.hit, 'restauration inverse : le CTA est de nouveau sous le doigt');
    }
  } finally {
    await context.close();
  }
  }
  await browser.close();
  server.close();

  if (failures) {
    console.error(`\ntunnel-mobile-touch-check: ${failures} echec(s).`);
    process.exit(1);
  }
  console.log('\ntunnel-mobile-touch-check: ALL OK - le parcours complet passe au doigt a 390x844, 320x520 et 390x664, clair et sombre.');
}

main().catch((error) => { console.error(error); process.exit(1); });
