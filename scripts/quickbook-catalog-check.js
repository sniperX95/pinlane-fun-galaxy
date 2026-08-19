// LA RESERVATION RAPIDE SUIT LE CATALOGUE ET LE NOMBRE DE JOUEURS (2026-08-19).
// Deux defauts signales par Movsar sur captures :
//   1. « on monte de joueurs jusqu a plus de 6 et ça reste encore en disant une
//      piste requise » : la ligne d etat ne se recalculait pas pendant la
//      frappe (seul le total etait patche, le commentaire du code affirmait
//      meme que c etait « le seul nombre visible qui depend des joueurs »).
//   2. « on peut reserver que bowling et laser et formules alors que mtn on a
//      integre tout plein d autre » : trois boutons codes en dur pendant que le
//      centre vend huit activites. Meme classe de defaut que la grille Tarifs
//      du 2026-08-17, qui enumerait une CONSTANTE figee au deploiement.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_QUICKBOOK_PORT || 4225);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Le catalogue du centre : HUIT activites vendables, comme en prod.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: 12, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', order: 9, defaultMinutes: 15 },
];

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.quick', 'reservations.edit', 'reservations.status', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        window.__QA_POSTS__.push(JSON.parse(init.body || '{}'));
        return J({ ok: true, reservation: { id: 4242, date: today, startTime: '14:00', pax: 4, status: 'pending', type: 'visite', lanes: [] } });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
            day: { date: today, open: true, schedule: { open: 10, close: 22, label: '10h - 22h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, ACTIVITIES });
}

function statusText(page) {
  return page.evaluate(() => (document.querySelector('.qb-status-line') || {}).textContent || '');
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(BASE_URL + '/?v=qb-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1500);
    // Le catalogue doit etre charge avant d'ouvrir : c'est lui qui peuple le
    // selecteur.
    await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 8, null, { timeout: 15000 });
    await page.evaluate(() => window.openQuickBook());
    await page.waitForSelector('.qb-type-row', { timeout: 8000 });
    await page.waitForTimeout(700);

    console.log('\n[1. Le selecteur suit le CATALOGUE VIVANT]');
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.qb-type-row .qb-type-btn')].map((b) => b.textContent.trim()));
    ok(buttons.length >= 9, `le selecteur propose ${buttons.length} choix, pas trois (${buttons.join(' | ')})`);
    for (const expected of ['Bowling', 'Laser Game', 'Minigolf Blacklight', 'Billards', 'Arcades', 'Playground', 'Duckpin Bowling', 'Fun Run by PIXEL']) {
      ok(buttons.includes(expected), `« ${expected} » est proposee`);
    }
    ok(buttons.includes('Formule'), 'les formules restent un mode a part');

    console.log('\n[2. Les pistes suivent le nombre de joueurs PENDANT la frappe]');
    // Le bug exact de Movsar : 9 joueurs, capacite 6 par piste -> 2 pistes.
    const before = await statusText(page);
    ok(/1\s*piste requise/.test(before), `depart a 4 joueurs : 1 piste requise (${before.trim()})`);
    await page.fill('.qb-field input[type="number"], #qbPax, input[data-qb-pax]', '9').catch(async () => {
      // Le champ n'a pas d'id stable : on prend le champ nombre de la modale.
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop();
        input.value = '9';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    await page.waitForTimeout(600);
    const after = await statusText(page);
    ok(/2\s*pistes requises/.test(after), `9 joueurs sur 6 par piste : 2 pistes requises (${after.trim()})`);
    ok(!/1\s*piste requise/.test(after), 'la ligne ne dit plus « 1 piste requise »');

    console.log('\n[3. Une activite libre ne demande pas de piste]');
    await page.evaluate(() => window.setQuickType('activity', 'minigolf_blacklight'));
    await page.waitForTimeout(700);
    const freeText = await statusText(page);
    ok(!/piste requise|pistes requises/.test(freeText), `le minigolf ne reserve aucune piste (${freeText.trim()})`);
    // Mesure par le DOM : le bouton actif porte l'activite choisie (l'etat
    // interne n'est pas expose, et une sonde qui le suppose rend undefined).
    const activeLabel = await page.evaluate(() => ((document.querySelector('.qb-type-row .qb-type-btn.active') || {}).textContent || '').trim());
    ok(activeLabel === 'Minigolf Blacklight', `le bouton actif est l activite choisie (${activeLabel})`);

    console.log('\n[4. Contre-epreuve : ce gate sait-il rougir ?]');
    // On remet le bowling et on force 4 joueurs : la ligne DOIT redire 1 piste.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const input = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop();
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    const backTo1 = await statusText(page);
    ok(/1\s*piste requise/.test(backTo1), `retour a 4 joueurs : la ligne redescend a 1 piste (${backTo1.trim()}) -> la sonde suit vraiment l etat`);

    if (process.env.QB_SHOT) {
      await page.evaluate(() => { const i = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop(); i.value = '9'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: process.env.QB_SHOT, fullPage: false });
    }
    ok(errs.length === 0, `zero erreur console (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nquickbook-catalog-check: ${failures} echec(s).`); process.exit(1); }
  console.log('\nquickbook-catalog-check: ALL OK - la reservation rapide suit le catalogue et les joueurs.');
}

main().catch((error) => { console.error(error); process.exit(1); });
