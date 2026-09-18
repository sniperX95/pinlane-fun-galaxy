// LES POSTES DE L ARENE SONT UNE DONNEE DU CENTRE.
//
// Movsar, 2026-09-18 : « les 30 armes ne doivent pas etre hardcodees dans
// Pinlane le SaaS, on peut choisir le nombre d armes disponible ».
//
// Le defaut etait deja mesurable avant ce gate. `LASER_GAME_MAX_PLAYERS = 30`
// decidait du nombre de sessions cote tunnel, alors que chaque centre declare
// `resources.laser.weaponCount`. Libramont en a 30 : tout concordait par
// coincidence. Gembloux en a 20 :
//
//   25 joueurs : le moteur planifie 2 sessions, le tunnel en annoncait 1
//   49 joueurs : le moteur en planifie 3, le tunnel en annoncait 2
//
// Le client lisait « une seule session » sur l ecran des options, puis
// « Laser Game - groupe 1/2 » sur celui des heures.
//
// CE QUI EST TENU ICI :
//   1. un centre a 20 postes fait annoncer 2 sessions pour 25 joueurs ;
//   2. le meme code, avec 30 postes, en annonce 1 : c est bien la DONNEE qui
//      decide, pas un seuil ecrit dans le tunnel ;
//   3. l avertissement NOMME la capacite du centre, pas un chiffre invente ;
//   4. sans capacite declaree, le tunnel ne casse pas (dernier recours).
//
// Lancement : node scripts/laser-arena-capacity-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const CORE_JS = path.join(ROOT, 'assets/booking-core.js');
const PORT = Number(process.env.PINLANE_LASER_ARENA_PORT || 4258);
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

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
];

// La capacite servie change d un scenario a l autre : c est tout l objet du gate.
let capaciteServie = 20;

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'centre-essai', status: 'active',
      booking: capaciteServie === null ? { laneCount: 8, normalCapacityPerLane: 6 } : { laneCount: 8, normalCapacityPerLane: 6, laserArenaCapacity: capaciteServie },
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname.startsWith('/api/')) return json(200, { ok: true, slots: [], suggestions: [] });
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
function section(titre) { console.log(`\n--- ${titre}`); }

// Monte le parcours jusqu a l avertissement de groupe, pour un effectif donne.
async function mesurer(browser, pax) {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  await page.goto(`${BASE_URL}/reserver?v=arene-${pax}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForSelector('#clientView', { state: 'attached', timeout: 20000 });
  const vu = await page.evaluate(async (effectif) => {
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 6; i += 1) {
      const b = document.getElementById('btnVenueContinue');
      if (b && b.offsetParent !== null) { b.click(); await attendre(500); } else break;
    }
    for (const id of ['bowling', 'laser_game']) {
      const carte = document.querySelector(`div[data-activity="${id}"] .activity-toggle`);
      const choisi = typeof getChosenActivities === 'function' && getChosenActivities().some((a) => (a.activityId || a.id) === id);
      if (carte && !choisi) { carte.click(); await attendre(400); }
    }
    state.booking.pax = effectif;
    if (typeof renderPaxAlertContent === 'function') renderPaxAlertContent();
    await attendre(300);
    return {
      capaciteLue: typeof getLaserArenaCapacity === 'function' ? getLaserArenaCapacity() : null,
      vagues: typeof getLaserWaveCount === 'function' ? getLaserWaveCount(effectif) : null,
      choisies: typeof getChosenActivities === 'function' ? getChosenActivities().map((a) => a.activityId || a.id) : [],
      texte: ((document.querySelector('#paxAlert .pax-alert') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }, pax);
  await contexte.close();
  return vu;
}

async function withSourceMutation(file, from, to, run) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`ancre trouvee ${count} fois dans ${path.basename(file)}`);
  try {
    fs.writeFileSync(file, original.split(from).join(to));
    return await run();
  } finally {
    fs.writeFileSync(file, original);
  }
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    section('[1] Une arene de 20 postes : 25 joueurs jouent en DEUX sessions');
    capaciteServie = 20;
    const petite = await mesurer(browser, 25);
    record('montage : les deux activites sont au programme', petite.choisies.includes('laser_game') && petite.choisies.includes('bowling'), JSON.stringify(petite.choisies));
    record('le tunnel lit la capacite du centre', petite.capaciteLue === 20, String(petite.capaciteLue));
    record('25 joueurs sur 20 postes : 2 sessions', petite.vagues === 2, String(petite.vagues));
    record('l avertissement NOMME les 20 postes', /20 postes/.test(petite.texte), petite.texte.slice(0, 180));
    record('et annonce les 2 sessions', /2 sessions/.test(petite.texte), petite.texte.slice(0, 180));

    section('[2] La MEME situation avec 30 postes : une seule session');
    capaciteServie = 30;
    const grande = await mesurer(browser, 25);
    record('le tunnel lit la nouvelle capacite', grande.capaciteLue === 30, String(grande.capaciteLue));
    record('25 joueurs sur 30 postes : 1 session', grande.vagues === 1, String(grande.vagues));
    record('l avertissement NOMME les 30 postes', /30 postes/.test(grande.texte), grande.texte.slice(0, 180));
    record('C EST DONC LA DONNEE QUI DECIDE, pas un seuil du tunnel',
      petite.vagues !== grande.vagues, `20 postes -> ${petite.vagues} session(s), 30 postes -> ${grande.vagues}`);

    section('[3] Sans capacite declaree, le tunnel tient debout');
    capaciteServie = null;
    const muette = await mesurer(browser, 25);
    record('une capacite de dernier recours est utilisee', Number(muette.capaciteLue) > 0, String(muette.capaciteLue));
    record('et l ecran affiche quelque chose', muette.texte.length > 0, muette.texte.slice(0, 120));

    section('Contre-epreuve par mutation : ce gate sait-il rougir ?');
    capaciteServie = 20;
    try {
      const avecLaConstante = await withSourceMutation(
        CORE_JS,
        'return Math.max(1, Math.ceil((Number(pax) || 1) / getLaserArenaCapacity()));',
        'return Math.max(1, Math.ceil((Number(pax) || 1) / LASER_GAME_MAX_PLAYERS));',
        async () => mesurer(browser, 25),
      );
      record('avec la constante en dur, 25 joueurs sur 20 postes n annoncent qu UNE session : ce gate ROUGIRAIT',
        avecLaConstante.vagues === 1, `${avecLaConstante.vagues} session(s) annoncee(s)`);
    } catch (error) {
      record('contre-epreuve montable', false, error.message);
    }
    record('booking-core.js restaure a l identique',
      fs.readFileSync(CORE_JS, 'utf8').includes('return Math.max(1, Math.ceil((Number(pax) || 1) / getLaserArenaCapacity()));'));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'LASER ARENA CAPACITY OK' : `LASER ARENA CAPACITY : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });
