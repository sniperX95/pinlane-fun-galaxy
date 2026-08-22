// LE GATE DES ADRESSES DE L APPLICATION (2026-08-22, Edge headless).
//
// DEUX DEFAUTS MESURES EN PRODUCTION le 2026-08-22, session staff ouverte :
//
//   [A] Ouvrir « /reserver/libramont » renvoyait sur la CONSOLE.
//       applyInitialRouteFromHash comparait le chemin par EGALITE a
//       CLIENT_ROUTE_PATH ('/reserver'), donc « /reserver/<centre> » ne
//       matchait pas : la vue retombait sur l etat sauvegarde (staff) et
//       l URL etait reecrite en « /#/staff/prices ». Le centre demande
//       disparaissait de l adresse.
//       detectCustomerMode, lui, acceptait deja les deux formes
//       (path === '/reserver' || path.startsWith('/reserver/')) : deux
//       fonctions, deux regles, pour la meme adresse.
//
//   [B] « #/staff/bowling », « #/staff/laser » et « #/staff/complete » ne
//       menaient nulle part : ces cles sont des RESSOURCES du planning, pas
//       des pages. STAFF_MENU_PAGES ne les contient pas, donc la page restait
//       celle qui trainait dans l etat sauvegarde (le dashboard, mesure en
//       prod) pendant que la ressource, elle, changeait. Un lien profond vers
//       le planning bowling affichait le dashboard.
//
// CE QUI EST MESURE : la vue reellement posee, le chemin reellement affiche,
// et le CENTRE reellement demande au serveur. Chaque invariant a sa
// contre-epreuve par mutation de la ligne de production qui le tient.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/app-routing-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_ROUTING_PORT || 4312);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const CENTER = { id: 'libramont', name: 'Fun Galaxy Libramont' };

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// Le serveur de prod sert index.html sur /reserver/<centre> (reecriture Vercel).
// Ce double fait pareil : sans ca, le gate mesurerait un 404, pas une route.
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    const ext = path.extname(url.pathname).toLowerCase();
    if (url.pathname === '/' || url.pathname === '' || !ext) filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, C }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'centers.switch', 'platform.admin'];
    const session = {
      token: 'qa', cookieBacked: false, centerId: C.id, expiresAt,
      member: { id: `${C.id}:platform-owner`, name: 'Movsar' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    };
    // Session DEJA OUVERTE : c est la condition qui declenchait [A].
    // detectCustomerMode annule le mode client pur quand une session existe.
    try {
      localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
      localStorage.setItem('funGalaxy_v4', JSON.stringify({
        view: 'staff', staffMenuPage: 'prices', adminCenterId: C.id, staffResourceView: 'all',
      }));
    } catch (e) {}
    window.__metaCenters = [];
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
      if (u.pathname === '/api/staff-state') return J({ ok: true, reservations: [], laneStatuses: {} });
      if (u.pathname === '/api/public-booking-meta') {
        // LE CENTRE REELLEMENT DEMANDE : c est la mesure qui prouve que le slug
        // de l adresse n a pas ete perdu en route.
        window.__metaCenters.push(u.searchParams.get('centerId') || '');
        return J({
          ok: true, today: '', durationOptions: [], formules: [], laserOptions: [], bowlingPrices: {},
          activities: [{ id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane', priceType: 'grid_bowling', planned: true, order: 1 }],
          center: { id: C.id, name: C.name, status: 'active', offerAvailability: {}, booking: { laneCount: 8 } },
        });
      }
      if (u.pathname === '/api/public-availability') return J({ ok: true, slots: [], program: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'menuCenters') return J({ ok: true, owner: true, centers: [{ id: C.id, name: C.name, status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: { bowling: { laneCount: 8 } } }] });
        if (action === 'centerConfig') return J({ ok: true, centers: [{ id: C.id, name: C.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8 } } }], activities: [] });
        return J({ ok: true, items: [], rows: [], formulas: [], activities: [], blocks: [], entries: [] });
      }
      return J({ ok: true });
    };
  }, { expiresAt, C: CENTER });
}

async function readRoute(page) {
  return page.evaluate(() => ({
    view: state.view,
    pathname: window.location.pathname,
    hash: window.location.hash,
    menuPage: state.staffMenuPage || '',
    resource: state.staffResourceView || '',
    metaCenters: window.__metaCenters || [],
    clientPainted: !!document.querySelector('.activity-card, .formule-card'),
  }));
}

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof todayStr === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1200);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const appOriginal = fs.readFileSync(APP, 'utf8');
  let failed = 0;

  try {
    section('[A] /reserver/<centre> ouvre le tunnel client, meme avec une session staff');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      await boot(page, `${BASE_URL}/reserver/${CENTER.id}?v=route-a-${Date.now()}`);
      const got = await readRoute(page);
      record('la vue posee est la vue client', got.view === 'client', `view=${got.view}`);
      record('le chemin reste sur /reserver', got.pathname.toLowerCase().startsWith('/reserver'), `pathname=${got.pathname}`);
      record('l adresse ne bascule pas sur un ecran de console', !/^#\/staff\//.test(got.hash), `hash=${got.hash || '(vide)'}`);
      record('le tunnel client est reellement peint', got.clientPainted, got.clientPainted ? '' : 'aucune carte activite ni formule');
      record(
        'le centre du slug est bien celui demande au serveur',
        got.metaCenters.length > 0 && got.metaCenters.every(id => id === CENTER.id),
        got.metaCenters.join(' | ') || 'aucun appel',
      );
      await context.close();
    }

    section('[B] #/staff/<ressource> mene au planning de cette ressource');
    for (const [key, expected] of [['bowling', 'bowling'], ['laser', 'laser'], ['complete', 'all']]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      // Le cache-buster va AVANT le hash : place apres, il devient partie du
      // hash (« bowling?v=... ») et la route ne matche plus rien. Ce gate a
      // commence par mesurer exactement ca, c est-a-dire rien.
      await boot(page, `${BASE_URL}/?v=route-b-${key}-${Date.now()}#/staff/${key}`);
      const got = await readRoute(page);
      record(`#/staff/${key} ouvre la page planning`, got.menuPage === 'planning', `page=${got.menuPage}`);
      record(`#/staff/${key} selectionne la ressource ${expected}`, got.resource === expected, `resource=${got.resource}`);
      await context.close();
    }

    section('[C] CONTRE-EPREUVES par mutation');
    {
      const anchorA = 'if (isClientRoutePath(getCurrentPathname())) {';
      const anchorB = 'const resourceAliasPages = { bowling: \'bowling\', laser: \'laser\', complete: \'all\' };';
      for (const [label, anchor] of [['A', anchorA], ['B', anchorB]]) {
        const occurrences = appOriginal.split(anchor).length - 1;
        if (occurrences !== 1) throw new Error(`ancre de mutation ${label} introuvable ou ambigue (${occurrences})`);
      }
      try {
        // Mutation A : on remet la comparaison par egalite stricte, le defaut d origine.
        fs.writeFileSync(APP, appOriginal.replace(anchorA, "if (getCurrentPathname().toLowerCase() === CLIENT_ROUTE_PATH) {"));
        {
          const context = await browser.newContext();
          const page = await context.newPage();
          await installMock(page);
          await boot(page, `${BASE_URL}/reserver/${CENTER.id}?v=route-c1-${Date.now()}`);
          const broken = await readRoute(page);
          record(
            'sans le predicat de chemin : /reserver/<centre> retombe sur la console, ce gate ROUGIRAIT',
            broken.view !== 'client',
            `view=${broken.view} hash=${broken.hash || '(vide)'}`,
          );
          await context.close();
        }

        // Mutation B : la table des alias de ressource ne mappe plus rien.
        fs.writeFileSync(APP, appOriginal.replace(anchorB, 'const resourceAliasPages = {};'));
        {
          const context = await browser.newContext();
          const page = await context.newPage();
          await installMock(page);
          await boot(page, `${BASE_URL}/?v=route-c2-${Date.now()}#/staff/bowling`);
          const broken = await readRoute(page);
          record(
            'sans la table d alias : #/staff/bowling n ouvre pas le planning, ce gate ROUGIRAIT',
            broken.menuPage !== 'planning',
            `page=${broken.menuPage}`,
          );
          await context.close();
        }
      } finally {
        fs.writeFileSync(APP, appOriginal); // ECRITURE INVERSE exacte
      }
      record('app-main.js est restaure a l identique', fs.readFileSync(APP, 'utf8') === appOriginal);
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
