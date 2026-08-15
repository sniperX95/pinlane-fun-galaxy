// UNE ETAPE = UN ECRAN, et pas au prix de l'information.
//
// Objectif pose par Movsar (2026-08-15) : « eviter le plus de devoir scroller
// vers le bas, genre de tout voir d'une traite ». Ce gate mesure la hauteur
// REELLE de chaque etape dans un vrai navigateur, aux deux themes, sur les
// VIEWPORTS REELS : l'ancienne fenetre de 900 px de haut n'existe sur aucun
// laptop (1920x1080 + zoom systeme 125 % + chrome du navigateur = ~730 px
// utiles ; un petit laptop en donne ~610). C'est la que « une etape = un
// ecran » se prouve, en PIXELS, jamais sur un ratio arrondi.
//
// LES QUATRE PIEGES QU'IL REND IMPOSSIBLES :
//   1. tenir dans l'ecran en CACHANT de l'information : chaque activite choisie
//      par le client et chaque heure de la journee doivent rester dans le DOM ;
//   2. tenir dans l'ecran en RABOTANT : aucune cible tactile sous 44 px, aucun
//      texte du parcours sous 11,5 px ;
//   3. un defilement interne INVISIBLE : tout bloc qui defile en lui-meme doit
//      le dire (etat de debordement + boutons de deplacement) et rester
//      parcourable au clavier ;
//   4. une carte MUETTE au lecteur d'ecran : chaque bouton du parcours doit
//      porter un nom accessible non vide dans l'arbre d'accessibilite REEL
//      (CDP), pas seulement un texte visuel (bug attrape en prod le
//      2026-08-15 : les huit cartes d'activite rendaient « button » sans nom).
//
// LE BUDGET : sur ordinateur (1536x730 et 1280x610), CHAQUE etape tient dans
// UN ecran, comparaison en pixels. Sur telephone (390x844), les budgets sont
// etablis sur la mesure et le gate empeche qu'ils REMONTENT.
//
// Contre-epreuves par mutation : on rend une etape trop haute expres, et on
// rend les cartes muettes expres ; le gate rougit ; restauration inverse.
//
// Lancement : node scripts/tunnel-one-screen-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const database = require('../lib/database');

const CLIENT_CSS = path.join(ROOT, 'assets/pinlane-client.css');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_ONESCREEN_PORT || 4215);
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

// Aucun acces a la base : l'instantane est neutralise avant le chargement de
// l'API (le .env porte la production).
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
    if (url.pathname === '/') filePath = path.join(ROOT, 'index.html');
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

// Hauteur reelle de la page, cibles trop petites, textes trop petits, et blocs
// qui defilent sans le dire.
const MEASURE = () => {
  const root = document.scrollingElement || document.documentElement;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const step = document.querySelector('#clientView .step:not(.hidden)');
  const scope = step || document;
  const smallTargets = [...scope.querySelectorAll('button, input, textarea, select, summary, [role="button"]')]
    .filter(visible)
    .filter((el) => {
      if (el.getBoundingClientRect().height >= 44) return false;
      // Une case a cocher dans une etiquette cliquable : la CIBLE est
      // l'etiquette, c'est elle qu'on mesure.
      const label = el.closest('label');
      return !(label && label.getBoundingClientRect().height >= 44);
    })
    .map((el) => `${(el.className || el.tagName).toString().split(' ')[0] || el.tagName}:${Math.round(el.getBoundingClientRect().height)}`);
  const smallText = [...scope.querySelectorAll('*')]
    .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim().length > 2)
    .map((el) => `${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10}`)
    .filter((entry) => parseFloat(entry.split(':')[1]) < 11.5);
  // Tout bloc qui defile en lui-meme doit le DIRE.
  const silentScrollers = [...scope.querySelectorAll('*')]
    .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 4 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
    .filter((el) => !el.dataset.overflow || el.dataset.overflow === 'none')
    .map((el) => (el.className || el.tagName).toString().split(' ')[0]);
  return {
    scrollHeight: Math.round(root.scrollHeight),
    clientHeight: Math.round(root.clientHeight),
    fits: root.scrollHeight <= root.clientHeight,
    screens: Math.round((root.scrollHeight / root.clientHeight) * 100) / 100,
    hScroll: root.scrollWidth > root.clientWidth,
    smallTargets,
    smallTextCount: smallText.length,
    smallText: [...new Set(smallText)].slice(0, 8),
    silentScrollers,
    chipsInDom: document.querySelectorAll('.anchor-chip').length,
    freeActivities: [...document.querySelectorAll('.anchor-free-item')].map((el) => el.textContent.replace(/\s+/g, ' ').trim().split('réglé')[0].trim()),
    activityCards: document.querySelectorAll('#activityPicker .activity-card').length,
  };
};

// L'arbre d'accessibilite REEL (CDP), pas une heuristique : c'est ce que recoit
// un lecteur d'ecran. Un bouton visible sans nom est un bouton qu'on ne peut
// pas actionner sans voir.
async function unnamedButtons(session) {
  const { nodes } = await session.send('Accessibility.getFullAXTree');
  return nodes
    .filter((node) => node.role?.value === 'button' && !node.ignored)
    .filter((node) => !(node.name?.value || '').trim()).length;
}

async function walkTunnel(page, session, viewport, theme) {
  const out = {};
  const ax = { total: 0 };
  const sweep = async () => { if (session) ax.total += await unnamedButtons(session); };
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${BASE_URL}/?v=one-${viewport.width}-${theme}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 15000 });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await page.evaluate((d) => {
    state.view = 'client'; state.booking.date = d; state.booking.pax = 8; state.booking.mode = 'carte';
    state.booking.activities = { bowling: { duration: 1 }, laser_game: { games: 2 }, minigolf_blacklight: {}, arcade_time: {}, billards: { units: 2, hours: 1.5 }, fun_run: {} };
    setView('client'); applyChosenActivitiesToBooking(); syncBookingTypeUi();
    goStep(1, { animate: false, focus: false });
  }, DATE);
  await page.waitForTimeout(450);
  out.step1 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => goStep2());
  await page.waitForTimeout(1200);
  out.step2 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => { const i = getCurrentFormulaAnchorSlotIndex(); if (i >= 0) selectSlot(i); });
  await page.waitForTimeout(500);
  out.step3 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(() => {
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32 470 00 00 00';
    document.getElementById('fEmail').value = 'marie@email.com';
    goStep4();
  });
  await page.waitForTimeout(700);
  out.step4 = await page.evaluate(MEASURE);
  await sweep();

  await page.evaluate(async () => { await confirmBooking(); });
  await page.waitForTimeout(900);
  out.step5 = await page.evaluate(MEASURE);
  await sweep();
  out.unnamedButtons = ax.total;
  return out;
}

// LES VIEWPORTS REELS, et le budget EN ECRANS de chacun. 1 = tient dans la
// fenetre, comparaison en pixels.
//   - 1536x730 : laptop 1920x1080, zoom systeme 125 %, chrome du navigateur.
//     C'est l'ecran de Movsar : la reference du rejet du 2026-08-15 (l'etape 1
//     y faisait 1,96 ecran REEL pendant que le gate validait « un ecran » sur
//     une fenetre fictive de 900 px).
//   - 1280x610 : petit laptop apres zoom.
//   - 390x844 : telephone reel (iPhone 12-15). Les budgets telephone sont des
//     MESURES (panier de six activites, le plus lourd accepte), le gate
//     empeche qu'ils remontent ; l'ecart de +1,5 % absorbe la variation de
//     longueur des dates (« 22 août » vs « 26 septembre »).
const VIEWPORTS = [
  { width: 1536, height: 730, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 1280, height: 610, budgets: { step1: 1, step2: 1, step3: 1, step4: 1, step5: 1 } },
  { width: 390, height: 844, budgets: { step1: 3.62, step2: 2.28, step3: 1.73, step4: 1.84, step5: 1.08 } },
];

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 730 } });
  const session = await page.context().newCDPSession(page);
  await session.send('Accessibility.enable');
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const measured = {};
  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        console.log(`\n[${viewport.width}x${viewport.height} px / ${theme}]`);
        const walk = await walkTunnel(page, session, viewport, theme);
        measured[`${viewport.width}-${theme}`] = walk;
        ['step1', 'step2', 'step3', 'step4', 'step5'].forEach((stepKey) => {
          const m = walk[stepKey];
          const budget = viewport.budgets[stepKey];
          // Comparaison en PIXELS, jamais sur le ratio arrondi : 904 px pour une
          // fenetre de 900 donnait « 1 ecran » et passait, alors que la page
          // defilait bel et bien de 4 px.
          ok(m.scrollHeight <= Math.round(m.clientHeight * budget),
            `${stepKey} : ${m.scrollHeight} px, ${m.screens} ecran(s) pour un budget de ${budget}${budget === 1 ? ' (tient dans la fenetre)' : ''}`);
          ok(!m.hScroll, `${stepKey} : aucun debordement horizontal de la page`);
          ok(m.smallTargets.length === 0, `${stepKey} : aucune cible sous 44 px${m.smallTargets.length ? ` (${m.smallTargets.join(', ')})` : ''}`);
          ok(m.smallTextCount === 0, `${stepKey} : aucun texte sous 11,5 px (${m.smallTextCount}${m.smallTextCount ? ' : ' + m.smallText.join(', ') : ''})`);
          ok(m.silentScrollers.length === 0, `${stepKey} : aucun defilement interne muet${m.silentScrollers.length ? ` (${m.silentScrollers.join(', ')})` : ''}`);
        });
        ok(walk.unnamedButtons === 0,
          `lecteur d ecran : aucun bouton sans nom accessible sur les 5 etapes (${walk.unnamedButtons})`);
      }
    }

    // --- L'INFORMATION N'A PAS ETE SACRIFIEE A LA HAUTEUR --------------------
    console.log('\n[Rien n a ete cache pour tenir dans l ecran]');
    const desktop = measured['1536-light'];
    ok(desktop.step1.activityCards === 8, `etape 1 : les 8 activites du centre sont proposees (${desktop.step1.activityCards})`);
    ok(desktop.step2.chipsInDom === 53, `etape creneau : les 53 heures du jour restent dans le DOM (${desktop.step2.chipsInDom})`);
    // Les activites SANS creneau choisies par le client sont nommees a l'etape
    // creneau. C'est le defaut que Movsar a photographie : sa visite y etait
    // amputee de quatre activites sur six.
    ['Minigolf Blacklight', 'Billards', 'Arcades', 'Fun Run by PIXEL'].forEach((label) => {
      ok(desktop.step2.freeActivities.some((entry) => entry.startsWith(label)),
        `etape creneau : « ${label} » est nommee (${desktop.step2.freeActivities.join(' | ') || 'aucune'})`);
    });
    ok(consoleErrors.length === 0, `aucune erreur console (${consoleErrors.length})`);

    // --- CONTRE-EPREUVES PAR MUTATION ---------------------------------------
    console.log('\n[Contre-epreuve par mutation : ce gate sait-il rougir ?]');
    const referenceViewport = VIEWPORTS[0];
    const css = fs.readFileSync(CLIENT_CSS, 'utf8');
    const anchor = '#clientView .formula-anchor-picker {';
    ok(css.split(anchor).length - 1 === 1, 'ancre de mutation unique');
    let mutatedHeight = null;
    let mutatedFits = null;
    try {
      fs.writeFileSync(CLIENT_CSS, css.replace(anchor, `${anchor}\n  padding-bottom: 400px;`));
      const walk = await walkTunnel(page, null, referenceViewport, 'light');
      mutatedHeight = walk.step2.scrollHeight;
      mutatedFits = walk.step2.fits;
    } finally {
      fs.writeFileSync(CLIENT_CSS, css);
    }
    ok(mutatedFits === false && mutatedHeight > referenceViewport.height,
      `400 px ajoutes a l etape creneau : elle deborde de la fenetre (${mutatedHeight} px) -> le budget ROUGIRAIT`);
    const restored = await walkTunnel(page, null, referenceViewport, 'light');
    ok(restored.step2.fits === true,
      `restauration inverse : l etape creneau retient un ecran (${restored.step2.scrollHeight} px)`);

    // Les cartes muettes du 2026-08-15, reproduites expres : nom explicite
    // vide ET contenu retire de l'arbre (aria-hidden). Le balayage CDP doit
    // rougir, sinon il ne protege rien.
    const appJs = fs.readFileSync(APP_JS, 'utf8');
    const labelAnchor = "const hint = activityPriceHint(activity, pax);";
    const textAnchor = '<span class="activity-text">';
    ok(appJs.split(labelAnchor).length - 1 === 1 && appJs.split(textAnchor).length - 1 === 1,
      'ancres de mutation accessibilite uniques');
    let mutedButtons = null;
    try {
      fs.writeFileSync(APP_JS, appJs
        .replace(labelAnchor, 'return "";\n  const hint = activityPriceHint(activity, pax);')
        .replace(textAnchor, '<span class="activity-text" aria-hidden="true">'));
      const walk = await walkTunnel(page, session, referenceViewport, 'light');
      mutedButtons = walk.unnamedButtons;
    } finally {
      fs.writeFileSync(APP_JS, appJs);
    }
    ok(mutedButtons >= 8,
      `cartes rendues muettes expres : ${mutedButtons} boutons sans nom dans l arbre reel -> le balayage ROUGIRAIT`);
    const restoredAx = await walkTunnel(page, session, referenceViewport, 'light');
    ok(restoredAx.unnamedButtons === 0,
      `restauration inverse : plus aucun bouton muet (${restoredAx.unnamedButtons})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ntunnel-one-screen-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\ntunnel-one-screen-check: ALL OK - le tunnel tient dans son budget d ecrans sans rien cacher.');
}

main().catch((error) => { console.error(error); process.exit(1); });
