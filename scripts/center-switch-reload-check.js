// LE GATE DE LA BASCULE DE CENTRE (2026-08-21, Edge headless).
//
// DEUX PLAINTES DE MOVSAR, deux invariants :
//
//   [A] « ca affiche aucun centre » : apres une connexion par le formulaire, le
//       selecteur de centre etait VIDE. loadMenuCenters n'etait appele que sur
//       le chemin de RESTAURATION de session (loadStaffAuthSession), jamais
//       apres submitLogin. Le switcher retombait donc sur le repli statique des
//       trois centres Fun Galaxy, filtre par le centre courant : pour un centre
//       ne dans la console (n4-bowling, mi12) ce repli est VIDE.
//
//   [B] « quand on change de centre ca recharge rien, ca change instant, ya des
//       chiffres identiques d'un centre a l'autre » : les caches sans cle de
//       centre (blocs de disponibilite, config d'etablissement, opsAdminCache,
//       adminDashboardCache) survivaient a la bascule. L'ecran reaffichait les
//       donnees du centre QUITTE sous le nom du nouveau : un etat faux et
//       credible, le pire des deux.
//
// CE QUI EST MESURE, jamais une presence de chaine : les requetes reellement
// parties (URL + centerId, comptees dans la page), l'etat des caches du VRAI
// code, et le DOM du popover. Les deux bascules sont de VRAIS CLICS dans le
// menu, pas des appels de fonction.
//
// Chaque invariant a sa contre-preuve : on neutralise la ligne de production
// qui le tient et on exige que la mesure redevienne celle du bug.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/center-switch-reload-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CENTER_SWITCH_PORT || 4297);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Deux centres de DEUX entreprises differentes, avec des donnees qui ne se
// ressemblent pas : c'est ce qui rend un melange visible.
const CENTER_A = { id: 'libramont', name: 'Fun Galaxy Libramont' };
const CENTER_B = { id: 'n4-bowling', name: 'N4 Bowling' };

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

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

// ---- Mock : deux centres, des donnees distinctes, et un COMPTEUR d'appels ---
async function installMock(page, { withSession }) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, withSession, A, B }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'direction.view', 'centers.switch', 'settings.manage', 'emails.view', 'users.manage', 'platform.admin'];
    const sessionFor = (centerId) => ({
      token: 'qa', cookieBacked: false, centerId, expiresAt,
      member: { id: `${centerId}:platform-owner`, name: 'Movsar' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    });
    // Le serveur ouvre la session sur le centre DEMANDE : c'est le contrat
    // etabli par lib/staff-auth (le code dit le centre).
    window.__calls = [];
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

    // Un bloc de disponibilite par centre, avec un motif RECONNAISSABLE : si le
    // motif de A survit a la bascule vers B, le melange se voit.
    const blocksFor = (centerId) => (centerId === B.id
      ? [
        { id: 901, centerId: B.id, scope: 'center', reason: 'BLOC-N4-UN', recurrence: 'once', date: '2026-09-01' },
        { id: 902, centerId: B.id, scope: 'center', reason: 'BLOC-N4-DEUX', recurrence: 'once', date: '2026-09-02' },
      ]
      : [{ id: 101, centerId: A.id, scope: 'center', reason: 'BLOC-LIBRAMONT', recurrence: 'once', date: '2026-09-03' }]);

    const configFor = (centerId) => ({
      ok: true,
      centers: [centerId === B.id
        ? { id: B.id, name: B.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 12 } } }
        : { id: A.id, name: A.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8 } } }],
      activities: [],
    });

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname.startsWith('/api/')) {
        window.__calls.push({
          path: u.pathname,
          action: u.searchParams.get('action') || (init && init.body && String(init.body).includes('"action"') ? JSON.parse(init.body).action : ''),
          centerId: u.searchParams.get('centerId') || '',
          method: (init && init.method) || 'GET',
        });
      }
      if (u.pathname === '/api/staff-auth') {
        const isPost = String((init && init.method) || 'GET').toUpperCase() === 'POST';
        const body = isPost && init.body ? JSON.parse(init.body) : {};
        if (isPost && body.action === 'login') {
          return J({ ok: true, authenticated: true, session: sessionFor(body.centerId || A.id) });
        }
        const wanted = u.searchParams.get('centerId') || A.id;
        return J({ ok: true, authenticated: true, session: sessionFor(wanted) });
      }
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        const centerId = u.searchParams.get('centerId') || A.id;
        if (action === 'menuCenters') {
          return J({ ok: true, owner: true, centers: [
            { id: A.id, name: A.name, status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy' },
            { id: B.id, name: B.name, status: 'active', clientId: 'n4-bowling', clientName: 'N4' },
          ] });
        }
        if (action === 'listAvailabilityBlocks') return J({ ok: true, blocks: blocksFor(centerId) });
        if (action === 'centerConfig') return J(configFor(centerId));
        return J({ ok: true, communications: [], suggestions: [], events: [], samples: [] });
      }
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], blocks: [] });
      return nf(input, init);
    };
    try {
      if (withSession) localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(sessionFor(A.id)));
      else localStorage.removeItem('funGalaxy_auth_v1');
    } catch (e) {}
  }, { expiresAt, withSession, A: CENTER_A, B: CENTER_B });
}

// Etat lu DANS la page : caches du vrai code + appels reellement partis.
const READ_STATE = `(() => ({
  centerId: (typeof state !== 'undefined') ? state.adminCenterId : null,
  sessionCenterId: (typeof state !== 'undefined' && state.staffAuthSession) ? state.staffAuthSession.centerId : null,
  menuCentersLoaded: (typeof scopedCentersCache !== 'undefined') ? scopedCentersCache.loaded : null,
  menuCentersCount: (typeof getMenuCenters === 'function') ? getMenuCenters().length : -1,
  blocksLoaded: (typeof availabilityBlocksCache !== 'undefined') ? availabilityBlocksCache.loaded : null,
  blockReasons: (typeof availabilityBlocksCache !== 'undefined' ? (availabilityBlocksCache.blocks || []) : []).map(b => b.reason),
  configCenters: (typeof staffCenterConfigCache !== 'undefined' ? (staffCenterConfigCache.centers || []) : []).map(c => c.id),
  calls: (window.__calls || []).slice(),
}))()`;

const readState = (page) => page.evaluate(READ_STATE);
const blockCalls = (calls, centerId) => calls.filter(c => c.action === 'listAvailabilityBlocks' && c.centerId === centerId).length;

async function openCenterMenu(page) {
  await page.waitForSelector('[data-fgx-center-menu]', { state: 'visible', timeout: 10000 });
  await page.click('[data-fgx-center-menu]');
  await page.waitForSelector('.fgx-menu-popover[data-popover-kind="center"]', { state: 'visible', timeout: 10000 });
}

async function listedCenters(page) {
  return page.$$eval('.fgx-menu-popover[data-popover-kind="center"] [data-fgx-center-option]', nodes => nodes.map(n => n.dataset.fgxCenterOption));
}

async function bootStaff(page, { page: staffPage = 'planning' } = {}) {
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffMenu === 'function',
    null, { timeout: 15000 },
  );
  await page.evaluate((key) => {
    setView('staff');
    if (typeof setMenuPage === 'function') setMenuPage(key);
    else if (typeof state !== 'undefined') { state.staffMenuPage = key; }
    if (typeof renderStaff === 'function') renderStaff();
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  }, staffPage);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let failed = 0;
  try {
    // ===================================================================== [A]
    section('[A] Apres une CONNEXION par le formulaire, le selecteur liste les centres');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: false });
      // Le navigateur garde le dernier centre consulte : celui d'un client, ne
      // dans la console. C'est l'etat exact de la capture de Movsar.
      await page.addInitScript((centerId) => {
        try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: centerId, view: 'client' })); } catch (e) {}
      }, CENTER_B.id);
      await page.goto(`${BASE_URL}/?v=switch-a-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.submitLogin === 'function', null, { timeout: 15000 });

      // VRAIE connexion par le formulaire (le mock accepte n'importe quel code).
      await page.evaluate(() => { setView('staff'); });
      await page.waitForSelector('#loginPass', { state: 'visible', timeout: 10000 });
      await page.fill('#loginPass', 'GATE-CODE-0000');
      await page.click('.auth-form button[type="submit"]');
      await page.waitForFunction(() => typeof hasSavedAuth === 'function' && hasSavedAuth(), null, { timeout: 15000 });
      await page.waitForFunction(() => typeof scopedCentersCache !== 'undefined' && scopedCentersCache.loaded, null, { timeout: 15000 })
        .catch(() => null);

      const st = await readState(page);
      record('la session ouverte porte le centre demande', st.sessionCenterId === CENTER_B.id, `centre=${st.sessionCenterId}`);
      record('la liste des centres du tenant est chargee apres le login', st.menuCentersLoaded === true, `loaded=${st.menuCentersLoaded}`);
      record('menuCenters a bien ete appele sur ce chemin', st.calls.some(c => c.action === 'menuCenters'), `${st.calls.filter(c => c.action === 'menuCenters').length} appel(s)`);

      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      await openCenterMenu(page);
      const listed = await listedCenters(page);
      record('le popover liste les DEUX centres', listed.length === 2, listed.join(',') || 'aucun');
      record('dont le centre du client, celui qui etait affiche', listed.includes(CENTER_B.id), listed.join(','));
      await context.close();
    }

    // -- contre-preuve [A] : sans l'appel, le popover est vide ----------------
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: false });
      await page.addInitScript((centerId) => {
        try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: centerId, view: 'client' })); } catch (e) {}
      }, CENTER_B.id);
      await page.goto(`${BASE_URL}/?v=switch-a2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.submitLogin === 'function', null, { timeout: 15000 });
      // On neutralise la ligne de production ajoutee dans submitLogin.
      await page.evaluate(() => { window.loadMenuCenters = async () => {}; });
      await page.evaluate(() => { setView('staff'); });
      await page.waitForSelector('#loginPass', { state: 'visible', timeout: 10000 });
      await page.fill('#loginPass', 'GATE-CODE-0000');
      await page.click('.auth-form button[type="submit"]');
      await page.waitForFunction(() => typeof hasSavedAuth === 'function' && hasSavedAuth(), null, { timeout: 15000 });
      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      await openCenterMenu(page);
      const listed = await listedCenters(page);
      record('contre-preuve [A] : sans le chargement, AUCUN centre listable', listed.length === 0, listed.join(',') || 'aucun');
      await context.close();
    }

    // ===================================================================== [B]
    section('[B] Changer de centre RECHARGE les donnees, il ne les recycle pas');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true });
      await page.goto(`${BASE_URL}/?v=switch-b-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && availabilityBlocksCache.loaded && (availabilityBlocksCache.blocks || []).length > 0,
        null, { timeout: 15000 },
      ).catch(() => null);

      const before = await readState(page);
      record('centre de depart charge : le bloc de Libramont est en memoire', before.blockReasons.includes('BLOC-LIBRAMONT'), before.blockReasons.join(',') || 'aucun');
      record('aucun appel pour le second centre a ce stade', blockCalls(before.calls, CENTER_B.id) === 0, `${blockCalls(before.calls, CENTER_B.id)} appel(s)`);

      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && (availabilityBlocksCache.blocks || []).some(b => String(b.reason).startsWith('BLOC-N4')),
        null, { timeout: 15000 },
      ).catch(() => null);

      const after = await readState(page);
      record('le centre courant a bascule', after.centerId === CENTER_B.id, `centre=${after.centerId}`);
      record('une VRAIE requete est partie pour le nouveau centre', blockCalls(after.calls, CENTER_B.id) >= 1, `${blockCalls(after.calls, CENTER_B.id)} appel(s)`);
      record('les blocs affiches sont ceux du nouveau centre', after.blockReasons.includes('BLOC-N4-UN'), after.blockReasons.join(',') || 'aucun');
      record('AUCUNE donnee du centre quitte ne survit', !after.blockReasons.includes('BLOC-LIBRAMONT'), after.blockReasons.join(',') || 'aucun');
      record('la config d etablissement suit aussi le nouveau centre', !after.configCenters.includes(CENTER_A.id), after.configCenters.join(',') || 'vide');
      await context.close();
    }

    // -- contre-preuve [B] : sans la purge, les donnees de A survivent --------
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true });
      await page.goto(`${BASE_URL}/?v=switch-b2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && availabilityBlocksCache.loaded && (availabilityBlocksCache.blocks || []).length > 0,
        null, { timeout: 15000 },
      ).catch(() => null);
      // On neutralise la purge : c'est l'etat d'AVANT le correctif.
      await page.evaluate(() => { window.resetCenterScopedCaches = () => {}; });
      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
      await page.waitForTimeout(1500);
      const stuck = await readState(page);
      record(
        'contre-preuve [B] : sans la purge, le bloc du centre QUITTE reste affiche',
        stuck.blockReasons.includes('BLOC-LIBRAMONT'),
        stuck.blockReasons.join(',') || 'aucun',
      );
      record(
        'contre-preuve [B] : et aucun bloc du nouveau centre n arrive',
        !stuck.blockReasons.some(r => String(r).startsWith('BLOC-N4')),
        stuck.blockReasons.join(',') || 'aucun',
      );
      await context.close();
    }
  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  } finally {
    await browser.close();
    server.close();
  }

  const red = checks.filter(c => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();
