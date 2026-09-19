// Vérifie que le menu latéral se met à jour EN TEMPS RÉEL au changement de
// rôle (login manager → directrice) SANS refresh manuel. Régression : le menu
// n'était reconstruit qu'au chargement de page, donc un nouveau rôle gardait
// les catégories de l'ancien jusqu'à un F5.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4198;
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

// role.locked=false → seules les permissions listées comptent.
const MANAGER_PERMS = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.status', 'clients.view', 'emails.view'];
const DIRECTION_PERMS = [...MANAGER_PERMS, 'users.manage', 'settings.manage', 'direction.view', 'campaigns.manage', 'pricing.manage'];

// Les sources restent reelles ; seul le transport API est simule. Aucun appel
// hors localhost. Le premier module est retenu pour soumettre le vrai login
// AVANT qu'un seul script staff ait pu s'executer.
async function installColdLoginFixture(page) {
  const staffPaths = new Set([...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .matchAll(/<script\b[^>]*data-staff-console[^>]*src="([^"]+)"/g)]
    .map((match) => new URL(match[1], BASE_URL).pathname));
  assert(staffPaths.has('/assets/staff-menu.js'), 'fixture : manifeste staff detecte');
  const requests = [], logins = [];
  let release, session = null;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE_URL) return route.abort();
    if (staffPaths.has(url.pathname)) {
      requests.push(url.pathname);
      if (requests.length === 1) await held;
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload = { ok: true, blocks: [], communications: [], samples: [], suggestions: [], events: [], centers: [], clients: [] };
    if (url.pathname === '/api/staff-auth') {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
      if (body.action === 'login') {
        logins.push(body);
        session = { cookieBacked: true, centerId: 'libramont', permissions: MANAGER_PERMS,
          role: { name: 'manager', locked: false }, member: { name: 'Test' } };
      }
      if (body.action === 'logout') session = null;
      payload = { ok: true, authenticated: Boolean(session), session };
    }
    if (url.pathname === '/api/staff-state') payload = { ok: true, reservations: [], laneStatuses: {}, revision: 'role-refresh-local', centerId: 'libramont' };
    return route.fulfill({ json: payload });
  });
  return { requests, logins, staffPaths, release };
}

async function proveColdLogin(page, fixture) {
  await page.waitForFunction(() => typeof window.setView === 'function');
  assert(fixture.requests.length === 0, 'public : aucun script staff demande');
  assert(await page.evaluate(() => typeof window.renderStaffMenu === 'undefined'), 'public : menu staff absent');
  await page.evaluate(() => { window.__roleRefreshDocument = true; });
  // Les handlers HTML reels appellent setView et submitLogin.
  // Aucun setView/ensureStaffConsolesLoaded injecte ici par le test.
  await page.locator('.entry-login').click();
  await page.locator('#authOverlay').waitFor({ state: 'visible' });
  await page.locator('#loginPass').fill('QA-LOCAL-ROLE');
  await page.locator('#authOverlay button[type="submit"]').click();
  await page.waitForFunction(() => Boolean(state.staffAuthSession?.cookieBacked)
    && document.getElementById('authOverlay').classList.contains('hidden'));
  assert(fixture.logins.length === 1 && fixture.logins[0].code === 'QA-LOCAL-ROLE', 'login : vraie soumission recue par le mock local');
  assert(fixture.requests.length === 1, 'login : premier script retenu, aucune dependance suivante demandee');
  assert(await page.evaluate(() => typeof window.renderStaffMenu === 'undefined'), 'login : session ouverte avant execution des scripts staff');
  fixture.release();
  await page.waitForFunction(() => typeof window.renderStaffMenu === 'function'
    && !document.getElementById('staffConsoleLoadStatus'));
  assert(await page.locator('#staffView').isVisible(), 'login : console visible sans reload');
  assert((await menuKeys(page)).includes('clients'), 'login : Clients apparait sans amorcage manuel du loader');
  assert(fixture.requests.length === fixture.staffPaths.size && new Set(fixture.requests).size === fixture.staffPaths.size,
    'login : un seul chargement de chaque module staff');
  console.log(`  [login reel a froid] public=0, login avant execution staff, ${fixture.requests.length} modules charges une fois, Clients visible`);
}

async function setRole(page, permissions) {
  return page.evaluate((perms) => {
    const session = { cookieBacked: true, centerId: 'libramont', permissions: perms, role: { name: 'test', locked: false }, member: { name: 'Test' } };
    // Transition d'auth sur la console deja ouverte par le vrai login ci-dessus.
    // applyAuthState actualise les permissions ; ce n'est pas une entree de vue.
    storeStaffAuthSession(session);
    state.view = 'staff';
    state.staffMenuPage = 'dashboard';
    save();
    applyAuthState();
  }, permissions);
}

async function menuKeys(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-staff-menu-root] [data-fgx-menu-key]')).map((n) => n.getAttribute('data-fgx-menu-key')));
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const coldLogin = await installColdLoginFixture(page);
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  await proveColdLogin(page, coldLogin);

  // 1) Rôle manager : pas d'accès Équipe/Établissement/Campagnes.
  await setRole(page, MANAGER_PERMS);
  await page.waitForTimeout(400);
  const managerKeys = await menuKeys(page);
  assert(!managerKeys.includes('users'), 'manager : « Équipe & accès » masqué');
  assert(!managerKeys.includes('establishment'), 'manager : « Établissement » masqué');
  assert(!managerKeys.includes('campaigns'), 'manager : « Campagnes » masqué');
  assert(managerKeys.includes('clients'), 'manager : « Clients » visible');
  console.log(`  [manager] ${managerKeys.length} entrées visibles`);

  // 2) Login directrice SANS reload → le menu doit refléter le nouveau rôle immédiatement.
  await setRole(page, DIRECTION_PERMS);
  await page.waitForTimeout(400);
  const dirKeys = await menuKeys(page);
  assert(dirKeys.includes('users'), 'directrice : « Équipe & accès » apparaît sans refresh');
  assert(dirKeys.includes('establishment'), 'directrice : « Établissement » apparaît sans refresh');
  assert(dirKeys.includes('campaigns'), 'directrice : « Campagnes » apparaît sans refresh');
  console.log(`  [directrice] ${dirKeys.length} entrées visibles`);

  // 3) Retour manager → les catégories directrice disparaissent immédiatement.
  await setRole(page, MANAGER_PERMS);
  await page.waitForTimeout(400);
  const backKeys = await menuKeys(page);
  assert(!backKeys.includes('users'), 'retour manager : « Équipe & accès » re-masqué sans refresh');
  assert(!backKeys.includes('establishment'), 'retour manager : « Établissement » re-masqué sans refresh');

  assert(await page.evaluate(() => window.__roleRefreshDocument === true), 'login et changements de role : aucun rechargement du document');
  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) { console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1)); throw new Error(`${critical.length} erreur(s) page`); }
  await browser.close();
  server.close();
  console.log('ROLE REFRESH CHECK: ALL OK');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
