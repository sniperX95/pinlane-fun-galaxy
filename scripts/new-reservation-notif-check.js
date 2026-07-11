// Vérifie la notif + son « nouvelle réservation du jour » : détectée depuis le
// poll serveur (pas les créations locales), carte visible au-dessus du planning
// agrandi, son coupable, notif fermable.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);

  // Session staff + stub du endpoint staff-state (2 snapshots : baseline puis +1 résa).
  await page.evaluate(() => {
    const today = todayStr();
    const res = (id, name, time) => ({ id, name, phone: '0470', email: '', date: today, startTime: time, duration: 1, lanes: [1, 2], status: 'confirmed', pax: 4, price: 78, basePrice: 78, type: 'bowling', label: 'Bowling Classique', extras: [] });
    window.__snaps = [
      { etag: 'rev-1', reservations: [res(9001, 'Client A', '14:00'), res(9002, 'Client B', '16:00')] },
      { etag: 'rev-2', reservations: [res(9001, 'Client A', '14:00'), res(9002, 'Client B', '16:00'), res(9003, 'Nouveau Client Web', '18:00')] },
    ];
    window.__snapIdx = 0;
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.pathname === '/api/staff-state') {
        const snap = window.__snaps[Math.min(window.__snapIdx, window.__snaps.length - 1)];
        window.__snapIdx += 1;
        return new Response(JSON.stringify({ ok: true, reservations: snap.reservations, revision: snap.etag }), { status: 200, headers: { ETag: snap.etag, 'content-type': 'application/json' } });
      }
      return realFetch(input, init);
    };
    storeStaffAuthSession({ cookieBacked: true, centerId: 'libramont', permissions: [], role: { name: 'owner', locked: true }, member: { name: 'Owner' } });
    state.view = 'staff';
    state.staffMenuPage = 'dashboard';
    state.currentDate = today;
    state.newResSound = true;
    // Vue staff réelle : le conteneur de notifs n'est visible qu'en staff-mode
    // (jamais côté client). On reproduit la classe posée par setView().
    document.body.classList.add('staff-mode');
    document.body.classList.remove('client-mode', 'admin-mode');
    save();
  });

  // 1er sync = baseline → aucune notif (on ne bipe pas les résas déjà là).
  await page.evaluate(() => syncDateReservations(state.currentDate, { skipRender: true }));
  await page.waitForTimeout(300);
  assert(await page.locator('#newResNotifs .nr-card').count() === 0, 'baseline : aucune notif au 1er sync');

  // 2e sync = +1 résa web → exactement 1 notif, pour la nouvelle uniquement.
  await page.evaluate(() => syncDateReservations(state.currentDate, { skipRender: true }));
  await page.waitForTimeout(400);
  assert(await page.locator('#newResNotifs .nr-card').count() === 1, 'exactement 1 notif pour la nouvelle résa');
  const notifText = await page.locator('#newResNotifs .nr-card').first().textContent();
  assert(notifText.includes('Nouveau Client Web'), `notif porte le nom du nouveau client (reçu "${notifText.slice(0, 60)}")`);
  assert(notifText.includes('18:00'), 'notif affiche l\'heure');

  // Visible au-dessus du planning agrandi (z-index 950 > 400).
  const z = await page.evaluate(() => Number(getComputedStyle(document.getElementById('newResNotifs')).zIndex));
  assert(z >= 900, `z-index notif au-dessus du plein écran (reçu ${z})`);
  await page.evaluate(() => { state.staffPlanningExpanded = true; save(); });
  const visible = await page.locator('#newResNotifs .nr-card').first().isVisible();
  assert(visible, 'notif visible même en planning agrandi');
  await page.screenshot({ path: path.join(ROOT, 'artifacts', 'audit', 'new-res-notif.png') }).catch(() => {});

  // Une résa créée EN LOCAL (déjà dans l'état avant le poll) ne redéclenche rien.
  await page.evaluate(() => {
    const today = todayStr();
    // simulate local creation : ajoutée à l'état puis renvoyée par le serveur
    upsertReservationInState({ id: 9004, name: 'Compt. Local', date: today, startTime: '20:00', duration: 1, lanes: [3], status: 'confirmed', pax: 2, price: 39, type: 'bowling', label: 'Bowling' });
    window.__snaps.push({ etag: 'rev-3', reservations: [...window.__snaps[1].reservations, { id: 9004, name: 'Compt. Local', date: today, startTime: '20:00', duration: 1, lanes: [3], status: 'confirmed', pax: 2, price: 39, type: 'bowling', label: 'Bowling' }] });
  });
  await page.evaluate(() => syncDateReservations(state.currentDate, { skipRender: true }));
  await page.waitForTimeout(300);
  assert(await page.locator('#newResNotifs .nr-card:has-text("Compt. Local")').count() === 0, 'création locale au comptoir : PAS de notif');

  // Toggle son : coupe la préférence + icône 🔕.
  await page.locator('#newResNotifs .nr-card').first().locator('.nr-mute').click();
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => state.newResSound === false), 'son coupé via le toggle');
  assert((await page.locator('#newResNotifs .nr-mute').first().textContent()).includes('🔕'), 'icône passe à muet');

  // Fermeture manuelle.
  await page.locator('#newResNotifs .nr-card').first().locator('.nr-close').click();
  await page.waitForTimeout(400);
  assert(await page.locator('#newResNotifs .nr-card:has-text("Nouveau Client Web")').count() === 0, 'notif fermée à la main');

  // JAMAIS côté client : conteneur masqué + purge à la bascule de vue.
  await page.evaluate(() => {
    // une notif est présente en staff…
    notifyNewReservation({ id: 9099, name: 'Ne doit pas fuiter', startTime: '21:00', label: 'Bowling', pax: 3, status: 'confirmed' });
  });
  assert(await page.locator('#newResNotifs .nr-card').count() >= 1, 'notif créée en staff');
  await page.evaluate(() => { document.body.classList.remove('staff-mode'); document.body.classList.add('client-mode'); state.view = 'client'; clearNewResNotifs(); });
  await page.waitForTimeout(200);
  const clientVisible = await page.locator('#newResNotifs').isVisible();
  assert(!clientVisible, 'conteneur de notifs invisible côté client');
  assert(await page.locator('#newResNotifs .nr-card').count() === 0, 'notifs purgées à la bascule vers client');
  // …et une nouvelle notif tentée en client ne crée rien.
  await page.evaluate(() => notifyNewReservation({ id: 9100, name: 'Client leak', startTime: '22:00', status: 'confirmed' }));
  assert(await page.locator('#newResNotifs .nr-card').count() === 0, 'notifyNewReservation ignoré hors vue staff');

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) { console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1)); throw new Error(`${critical.length} erreur(s) page`); }
  await browser.close();
  server.close();
  console.log('NEW RESERVATION NOTIF CHECK: ALL OK');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
