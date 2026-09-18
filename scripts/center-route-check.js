// L ADRESSE PAR CENTRE TIENT.
//
// Defaut mesure EN PRODUCTION le 2026-09-18 : ouvrir
// app.pinlane.be/reserver/gembloux affichait bien Fun Galaxy Gembloux, puis
// l application reecrivait l adresse en /reserver. Au rechargement, le serveur
// ne voyait plus de centre, retombait sur Libramont, et le visiteur se
// retrouvait chez l autre centre sans un mot : autre catalogue, autres tarifs,
// autres horaires, autre arene. Un ecart de tarif ne se voit sur aucun ecran.
//
// CE QUI EST TENU ICI :
//   1. le chemin ouvert garde son centre apres le demarrage ;
//   2. il le garde apres une navigation dans le parcours ;
//   3. il le garde apres un RECHARGEMENT (c est la que le defaut mordait) ;
//   4. ce n est pas qu un affichage : la requete au serveur porte ce centre ;
//   5. sans centre dans l adresse, l application n en invente pas un.
//
// Lancement : node scripts/center-route-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_CENTER_ROUTE_PORT || 4257);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Date du CENTRE (Europe/Brussels), jamais celle de la machine.
function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const CENTRE = 'gembloux';

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', order: 3, defaultMinutes: 45 },
];

// LE SERVEUR RENVOIE LE CENTRE QU ON LUI DEMANDE, et note chaque demande : c est
// cette trace qui prouve que le centre vient de l adresse, pas d un affichage.
const demandes = [];
function metaPayload(centerId) {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: centerId, status: 'active',
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
    if (url.pathname === '/api/public-booking-meta') {
      const demande = url.searchParams.get('centerId') || url.searchParams.get('center') || '';
      demandes.push(demande);
      return json(200, metaPayload(demande || 'libramont'));
    }
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

async function ouvrir(page, chemin) {
  demandes.length = 0;
  await page.goto(`${BASE_URL}${chemin}`, { waitUntil: 'networkidle', timeout: 45000 });
  // Le parcours doit etre PEINT avant qu on lise l adresse : c est le rendu qui
  // declenche l ecriture d URL, et un gate qui lit trop tot verdit sans rien
  // prouver.
  await page.waitForSelector('#clientView', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => {
    const v = document.getElementById('clientView');
    return Boolean(v && v.getBoundingClientRect().height > 0);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => ({ pathname: location.pathname, titre: document.title }));
}

// Mutation d un fichier de production, restaure quoi qu il arrive.
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
    const contexte = await browser.newContext();
    const page = await contexte.newPage();

    section('Montage : le parcours s ouvre bien sur l adresse du centre');
    const apresBoot = await ouvrir(page, `/reserver/${CENTRE}`);
    record('le parcours est peint', Boolean(apresBoot.titre), apresBoot.titre);

    section('[1] Le centre reste dans l adresse apres le demarrage');
    record('chemin conserve', apresBoot.pathname === `/reserver/${CENTRE}`, apresBoot.pathname);

    section('[2] Ce n est pas qu un affichage : le serveur a recu CE centre');
    record('la requete porte le centre de l adresse', demandes.includes(CENTRE), JSON.stringify(demandes));

    section('[3] Le centre survit a une navigation dans le parcours');
    await page.evaluate(() => {
      if (typeof syncViewUrl === 'function') syncViewUrl('client');
      if (typeof setVenueStage === 'function') setVenueStage('pax');
    });
    await page.waitForTimeout(300);
    const apresNav = await page.evaluate(() => location.pathname);
    record('chemin conserve apres navigation', apresNav === `/reserver/${CENTRE}`, apresNav);

    section('[4] Le centre survit a un RECHARGEMENT (le defaut mordait ici)');
    const apresRechargement = await ouvrir(page, `/reserver/${CENTRE}`);
    await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(600);
    const rechargee = await page.evaluate(() => ({ pathname: location.pathname }));
    record('chemin conserve apres rechargement', rechargee.pathname === `/reserver/${CENTRE}`,
      `${apresRechargement.pathname} puis ${rechargee.pathname}`);
    record('et le serveur voit toujours ce centre', demandes.includes(CENTRE), JSON.stringify(demandes));

    section('[5] Sans centre dans l adresse, l application n en invente pas un');
    const nu = await ouvrir(page, '/reserver');
    record('chemin nu inchange', nu.pathname === '/reserver', nu.pathname);

    section('Contre-epreuve par mutation : ce gate sait-il rougir ?');
    try {
      const chemin = await withSourceMutation(
        APP_JS,
        "writeAppUrl(CLIENT_ROUTE_OPENED, '', { push });",
        "writeAppUrl(CLIENT_ROUTE_PATH, '', { push });",
        async () => {
          const ctx = await browser.newContext();
          const p2 = await ctx.newPage();
          const vu = await ouvrir(p2, `/reserver/${CENTRE}`);
          await ctx.close();
          return vu.pathname;
        },
      );
      record('adresse generique reecrite : le centre disparait, ce gate ROUGIRAIT', chemin === '/reserver', chemin);
    } catch (error) {
      record('contre-epreuve montable', false, error.message);
    }
    record('app-main.js restaure a l identique', fs.readFileSync(APP_JS, 'utf8').includes("writeAppUrl(CLIENT_ROUTE_OPENED, '', { push });"));

    await contexte.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'CENTER ROUTE OK' : `CENTER ROUTE : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });
