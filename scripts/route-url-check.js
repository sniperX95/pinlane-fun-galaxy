// L'URL suit la vue. Le parcours client a son adresse a lui.
//
// Incident (2026-07-27, capture de Movsar) : on lisait
// « mngfunglxy.com/#/staff/users » dans la barre d'adresse ALORS QUE la page
// affichee etait le parcours de reservation client. Cause : seule la partie
// staff ecrivait dans l'URL (setStaffRouteHash) ; revenir a la vue client ne
// nettoyait rien, et la vue client n'avait aucune adresse propre.
//
// Regles verrouillees ici :
//   client    -> /reserver, SANS hash (page publique, deja dans le sitemap)
//   staff     -> / + #/staff/<page>
//   direction -> / + #/admin/<onglet>
// et le mode « client pur » (bascules de vue masquees) ne doit s'appliquer
// qu'a un visiteur SANS session staff : sinon un membre du staff qui clique
// « Réserver » se retrouverait enferme dans la vue client pour tout l'onglet.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_ROUTE_PORT || 4217);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Le serveur de test rejoue la rewrite Vercel « /reserver -> /index.html ».
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const clean = url.pathname.replace(/\/+$/, '') || '/';
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (clean === '/' || clean === '/reserver') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// withSession=false : visiteur public, aucune session staff en localStorage.
async function installMock(page, { withSession }) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, withSession }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'reservations.view', 'reservations.create', 'reservations.status', 'clients.view', 'settings.manage', 'direction.view', 'users.manage'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') {
        if (!withSession) return new Response(JSON.stringify({ ok: false, authenticated: false }), { status: 401, headers: { 'content-type': 'application/json' } });
        return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      }
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-07-18', durationOptions: [], formules: [], center: { id: 'libramont', status: 'active' } });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, blocks: [], communications: [], samples: [], suggestions: [], events: [], agents: [], activations: [], orchestration: {} });
      return nativeFetch(input, init);
    };
    if (withSession) window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, withSession });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 15000 });
  await page.waitForTimeout(500);
}

const urlOf = (page) => page.evaluate(() => ({ path: location.pathname, hash: location.hash, view: state.view }));

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('\n[1] Chaque vue a son adresse');
    // =====================================================================
    const staffPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await installMock(staffPage, { withSession: true });
    await boot(staffPage, `${BASE_URL}/`);

    await staffPage.evaluate(() => { setView('staff'); openStaffMenuPage('users'); });
    await staffPage.waitForTimeout(300);
    const onStaff = await urlOf(staffPage);
    ok(onStaff.hash === '#/staff/users', `staff : hash = #/staff/users (obtenu "${onStaff.hash}")`);
    ok(onStaff.path === '/', `staff : chemin = / (obtenu "${onStaff.path}")`);

    // LE CAS DE LA CAPTURE : on repasse cote client depuis la page Utilisateurs.
    await staffPage.evaluate(() => { setView('client'); });
    await staffPage.waitForTimeout(300);
    const onClient = await urlOf(staffPage);
    ok(onClient.path === '/reserver', `client : chemin = /reserver (obtenu "${onClient.path}")`);
    ok(onClient.hash === '', `client : AUCUN hash residuel (obtenu "${onClient.hash}")`);

    await staffPage.evaluate(() => { setView('staff'); });
    await staffPage.waitForTimeout(300);
    const backToStaff = await urlOf(staffPage);
    ok(backToStaff.path === '/' && backToStaff.hash.startsWith('#/staff/'),
      `retour staff : / + #/staff/... (obtenu "${backToStaff.path}${backToStaff.hash}")`);

    await staffPage.evaluate(() => { setView('admin'); });
    await staffPage.waitForTimeout(600);
    const onAdmin = await urlOf(staffPage);
    ok(onAdmin.hash.startsWith('#/admin/'), `direction : hash = #/admin/... (obtenu "${onAdmin.hash}")`);

    // Retrocompatibilite : les anciens liens/bookmarks doivent continuer d'ouvrir
    // la bonne page.
    const deep = await staffPage.evaluate(async () => {
      location.hash = '#/staff/campaigns';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await new Promise(r => setTimeout(r, 300));
      return { view: state.view, page: state.staffMenuPage };
    });
    ok(deep.view === 'staff' && deep.page === 'campaigns',
      `deep-link #/staff/campaigns toujours honore (view=${deep.view}, page=${deep.page})`);

    // =====================================================================
    console.log('\n[2] /reserver : client pour tous, prison pour personne');
    // =====================================================================
    // Membre du staff : il voit le parcours client MAIS garde ses bascules.
    await boot(staffPage, `${BASE_URL}/reserver`);
    const staffOnReserver = await staffPage.evaluate(() => ({
      view: state.view,
      customerMode: document.body.classList.contains('customer-mode'),
      switchVisible: !!document.getElementById('btnStaff') && getComputedStyle(document.getElementById('btnStaff')).display !== 'none',
    }));
    ok(staffOnReserver.view === 'client', `/reserver ouvre la vue client (obtenu ${staffOnReserver.view})`);
    ok(staffOnReserver.customerMode === false, 'session staff : PAS de verrouillage en mode client pur');
    ok(staffOnReserver.switchVisible === true, 'session staff : la bascule Staff reste accessible');

    // Visiteur public : mode client pur, aucune commande staff.
    const guestPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await installMock(guestPage, { withSession: false });
    await boot(guestPage, `${BASE_URL}/reserver`);
    const guest = await guestPage.evaluate(() => ({
      view: state.view,
      customerMode: document.body.classList.contains('customer-mode'),
      switchHidden: getComputedStyle(document.querySelector('.view-switch')).display === 'none',
    }));
    ok(guest.view === 'client', `visiteur : vue client (obtenu ${guest.view})`);
    ok(guest.customerMode === true, 'visiteur : mode client pur actif');
    ok(guest.switchHidden === true, 'visiteur : les bascules de vue restent masquees');
    await guestPage.close();

    // =====================================================================
    console.log('\n[3] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol('  syncViewUrl(v, { push: viewChanged });');
    if ((original.split(anchor).length - 1) !== 1) {
      ok(false, 'ancre de mutation introuvable ou ambigue');
    } else {
      fs.writeFileSync(APP, original.replace(anchor, toFileEol('  void viewChanged;')));
      let mutated = { path: '', hash: '' };
      try {
        const mutantPage = await browser.newPage({ viewport: { width: 1280, height: 860 } });
        await installMock(mutantPage, { withSession: true });
        await boot(mutantPage, `${BASE_URL}/`);
        await mutantPage.evaluate(() => { setView('staff'); openStaffMenuPage('users'); });
        await mutantPage.waitForTimeout(300);
        await mutantPage.evaluate(() => { setView('client'); });
        await mutantPage.waitForTimeout(300);
        mutated = await urlOf(mutantPage);
        await mutantPage.close();
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
      ok(mutated.hash === '#/staff/users' && mutated.path !== '/reserver',
        `sync retire : le parcours client reaffiche "${mutated.path}${mutated.hash}" -> le gate ROUGIRAIT`);
    }

    await staffPage.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\nroute-url-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nroute-url-check: ALL OK - le parcours client a son adresse, l URL suit la vue.');
}

main().catch((err) => { console.error(err); process.exit(1); });
