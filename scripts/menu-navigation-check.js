// Gate de NAVIGATION du menu lateral (Edge headless, serveur statique local,
// session platform.admin mockee). Ce que ce gate garde, que le harnais
// founder-cockpit-shots.js ne gardait PAS : il pose state.staffMenuPage a la
// main et ne clique JAMAIS le menu, si bien que le bug de routage des 4 pages
// PLATEFORME (cockpit, cockpit-agents, cockpit-incidents, cockpit-clients)
// passait inapercu. Ici on pilote de VRAIS clics sur les boutons de la barre
// laterale (data-fgx-menu-key) et on mesure le COMPORTEMENT : la vue affichee
// (classe hidden + display calcule + boite reelle), l'etat state.view,
// state.staffMenuPage, et le titre h1 reellement rendu. Jamais une presence de
// chaine.
//
// Le bug corrige : navigateMenu(cle) n'avait aucun cas explicite pour les 4
// pages PLATEFORME. Elles tombaient dans un fallback qui faisait setView('admin')
// et ouvrait la Direction : le menu surlignait l'item (setMenuPage l'avait pose)
// mais l'ecran montrait le poste d'observation Direction. Le fix ajoute le cas
// explicite (les 4 pages -> setMenuPage + setView('staff') + renderStaff) et
// rend le fallback defensif. La vue Direction (admin) ne s'atteint QUE par le
// menu compte/centre (data-fgx-menu-action="direction"), jamais par la barre.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/menu-navigation-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_MENU_NAV_PORT || 4243);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MENU_SRC = path.join(ROOT, 'assets', 'staff-menu.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Les 4 pages de la categorie PLATEFORME et le titre h1 attendu :
//  - cockpit         -> renderCockpitPage (h1 'Cockpit fondateur')
//  - cockpit-agents  -> PAGE_META.title 'Agents IA'
//  - cockpit-incidents -> PAGE_META.title 'Incidents'
//  - cockpit-clients -> PAGE_META.title 'Clients'
const PLATFORM_PAGES = [
  { key: 'cockpit', title: 'Cockpit fondateur' },
  { key: 'cockpit-agents', title: 'Agents IA' },
  { key: 'cockpit-incidents', title: 'Incidents' },
  { key: 'cockpit-clients', title: 'Clients' },
];

// ---- Journal des verifications --------------------------------------------
const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? ' :: ' + detail : ''}`);
}

// ---- Serveur statique (identique aux autres gates navigateur) --------------
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

// ---- Mock de session platform.admin + fetch stub ---------------------------
// Repris fidelement de scripts/founder-cockpit-shots.js:installMock : session
// funGalaxy_auth_v1 avec platform.admin/direction.view/centers.switch, fetch
// stub qui repond {ok:true,...} pour /api/staff-auth et /api/ops (founder*).
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'direction.view', 'centers.switch', 'settings.manage', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'users.manage', 'platform.admin'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'libramont:platform-owner', name: 'Movsar' }, role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true }, permissions: perms };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const now = new Date().toISOString();
    const hier = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const vieux = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

    const bundle = {
      ok: true, generatedAt: now, testData: true,
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active' },
        { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned' },
      ],
      journalSince: hier,
      breakage: {
        mails: { window: '30 derniers jours', failed: 2, groups: [{ lastError: 'sandbox', count: 2 }], recent: [
          { id: 501, centerId: 'libramont', recipient: 'client@test.be', subject: 'Rappel', lastError: 'sandbox', attempts: 2, createdAt: hier },
        ] },
        jobs: { window: 'etat actuel', failed: 1, recent: [{ id: 88, centerId: 'libramont', jobType: 'reservation_followup', lastError: 'timeout enqueue', attempts: 3, maxAttempts: 20, updatedAt: hier }] },
        worker: { window: '24 dernieres heures', lastRun: { taskName: 'ops-jobs', status: 'ok', startedAt: now, finishedAt: now, error: '' }, failed24h: 0, tasks: [] },
        denied: { window: '7 derniers jours', count: 1, recent: [{ id: 3, centerId: 'libramont', occurredAt: hier, actorKind: 'staff', actorLabel: 'Directrice Demo', surface: 'api/ops.js', deniedReason: 'Permission insuffisante.', requestedCenter: '' }] },
        audit: { failures: 0 },
      },
      adoption: { window: '7 et 30 derniers jours', excludesPlatformOwner: true,
        perCenter: [
          { centerId: 'libramont', lastStaffAction: hier, actions7d: 14, actions30d: 61, lastLogin: hier, activeSessions: 1 },
          { centerId: 'gembloux', lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 },
        ],
        actions30d: [
          { centerId: 'libramont', action: 'updateReservation', count: 22 },
        ] },
      agents: {
        suggestions: { total: 12, pending: 2, lastAt: hier, window: 'depuis le debut' },
        insights: { byStatus: [{ status: 'pending', count: 3, lastAt: hier }], perCenter: [
          { centerId: 'libramont', lastAt: hier, count30d: 5 },
        ] },
        plans: [{ centerId: 'libramont', status: 'proposed', fromDate: '2026-07-20', toDate: '2026-09-14', mode: 'deterministe', createdAt: hier }],
        decisions: { d7: 4, lastAt: hier, window: '7 derniers jours' },
      },
      cost: { budgetUsd: 5, month: '2026-07', monthMeasured: true, spentUsd: 4.0023, calls: 645, updatedAt: now, projectionUsd: 5.9, dailyMeasured: false,
        months: [{ month: '2026-07', costUsd: 4.0023, calls: 645 }, { month: '2026-06', costUsd: 2.1, calls: 300 }] },
      leads: { window: 'depuis le debut', total: 1, byStatus: { new: 1 }, lastAt: hier, recent: [
        { centerName: 'Bowling du Lac', priority: 'haute', status: 'new', createdAt: hier },
      ] },
      sequences: { keys: [
        { key: 'confirmation', label: 'Confirmation' }, { key: 'reminder_48h', label: 'Rappel avant la venue' },
      ], perCenter: {
        libramont: { confirmation: { enabled: true }, reminder_48h: { enabled: true } },
        gembloux: { confirmation: { enabled: true }, reminder_48h: { enabled: false } },
      } },
      audit: { entries: [
        { id: 1, occurredAt: now, centerId: 'libramont', actorKind: 'staff', actorLabel: 'Directrice Demo', actorMemberId: 'libramont:demo', action: 'automationSettings', outcome: 'success', surface: 'api/ops.js' },
      ] },
    };
    const agentsBundle = {
      ok: true, generatedAt: now, testData: true,
      agents: {
        marketing: { lastAt: hier, count7d: 3, count30d: 11, detail: 'insight' },
        emails: { lastAt: null, count7d: 0, count30d: 0 },
        suggestions: { lastAt: hier, count7d: 2, count30d: 12 },
        decisions: { lastAt: now, count7d: 4, count30d: 19 },
      },
      cost: { budgetUsd: 5, costPerAgentMeasured: false,
        months: [{ month: '2026-06', costUsd: 2.1, calls: 300 }, { month: '2026-07', costUsd: 4.0023, calls: 645 }] },
    };
    const incidentsBundle = {
      ok: true, generatedAt: now, testData: true,
      console: { window: '14 derniers jours', groups: [
        { message: "TypeError lanes", count: 6, lastAt: recent, centers: ['libramont'], pages: ['planning'], stack: "TypeError lanes\n    at renderPlanning" },
        { message: 'NetworkError /api/ops', count: 2, lastAt: vieux, centers: ['gembloux'], pages: ['emails'] },
      ] },
      breakage: bundle.breakage,
    };
    const clientsBundle = {
      ok: true, generatedAt: now, testData: true,
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', config: { done: 9, total: 10 },
          adoption: { lastStaffAction: hier, actions7d: 14, actions30d: 61, lastLogin: hier, activeSessions: 1 },
          topActors: [{ label: 'Directrice Demo', count30d: 41 }], mails: { sent30d: 118, failed30d: 3 }, sequences: { active: 3, total: 3 } },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', config: { done: 6, total: 10 },
          adoption: { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 },
          topActors: [], mails: { sent30d: 0, failed30d: 0 }, sequences: { active: 1, total: 3 } },
        { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', config: { done: 2, total: 10 },
          adoption: { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 },
          topActors: [], mails: null, sequences: { active: 0, total: 3 } },
      ],
    };

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderCockpit') return J(bundle);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderAuditLog') return J({ ok: true, entries: bundle.audit.entries });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderAgents') return J(agentsBundle);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderIncidents') return J(incidentsBundle);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderClients') return J(clientsBundle);
      if (u.pathname === '/api/ops') return J({ ok: true });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) {}
  }, { expiresAt });
}

// ---- Sonde de visibilite injectee dans la page -----------------------------
// COMPORTEMENT, pas presence de chaine : classe hidden + display calcule +
// boite reelle (getBoundingClientRect). getBoundingClientRect gere aussi les
// elements position:fixed, la ou offsetParent renverrait null a tort.
const READ_NAV_STATE = `(() => {
  const vis = (el) => {
    if (!el) return false;
    if (el.classList.contains('hidden')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const hid = (el) => {
    if (!el) return true;
    if (el.classList.contains('hidden')) return true;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0;
  };
  const adminView = document.getElementById('adminView');
  const staffCockpit = document.getElementById('staffCockpitPage');
  const adminHero = document.getElementById('adminHeroTitle');
  const dashboardPage = document.getElementById('staffDashboardPage');
  const cockpitH1 = staffCockpit ? staffCockpit.querySelector('.pv2-bar h1') : null;
  return {
    view: (typeof state !== 'undefined') ? state.view : null,
    menuPage: (typeof getStaffMenuPage === 'function') ? getStaffMenuPage() : (typeof state !== 'undefined' ? state.staffMenuPage : null),
    adminViewHidden: hid(adminView),
    adminViewVisible: vis(adminView),
    adminViewHasHiddenClass: !!adminView && adminView.classList.contains('hidden'),
    adminHeroVisible: vis(adminHero),
    cockpitVisible: vis(staffCockpit),
    cockpitHidden: hid(staffCockpit),
    cockpitHasHiddenClass: !!staffCockpit && staffCockpit.classList.contains('hidden'),
    cockpitH1: cockpitH1 ? cockpitH1.textContent.trim() : null,
    dashboardVisible: vis(dashboardPage),
  };
})()`;

function readNavState(page) {
  return page.evaluate(READ_NAV_STATE);
}

// ---- Boot : ouvrir la page, entrer en vue staff, garantir le menu -----------
async function boot(page) {
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=nav-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffMenu === 'function',
    null, { timeout: 15000 },
  );
  // On entre en vue staff (le menu lateral n'est visible qu'en staff/admin) et
  // on re-rend le menu avec la session chargee, pour que la categorie
  // PLATEFORME soit dans le DOM. La page par defaut retombe sur 'dashboard'
  // (guardStaffPage : la session n'a pas planning.view).
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    setView('staff');
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  });
  await page.waitForSelector('.fgx-menu-nav [data-fgx-menu-key="cockpit"]', { state: 'visible', timeout: 15000 });
}

// Vrai clic sur un bouton de la barre laterale (scope au nav pour eviter le
// bouton de marque qui porte aussi data-fgx-menu-key="dashboard").
async function clickNav(page, key) {
  const sel = `.fgx-menu-nav [data-fgx-menu-key="${key}"]`;
  await page.waitForSelector(sel, { state: 'visible', timeout: 10000 });
  await page.click(sel);
}

// Ouvre le menu centre puis clique l'action Direction (data-fgx-menu-action).
async function triggerDirection(page) {
  await page.waitForSelector('[data-fgx-center-menu]', { state: 'visible', timeout: 10000 });
  await page.click('[data-fgx-center-menu]');
  await page.waitForSelector('[data-fgx-menu-action="direction"]', { state: 'visible', timeout: 10000 });
  await page.click('[data-fgx-menu-action="direction"]');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.view === 'admin', null, { timeout: 10000 });
}

async function waitCockpitH1(page, title) {
  await page.waitForFunction(
    (expected) => {
      const h1 = document.querySelector('#staffCockpitPage .pv2-bar h1');
      return !!h1 && h1.textContent.trim() === expected;
    },
    title, { timeout: 15000 },
  );
}

// Probe reutilisable pour la contre-preuve : page fraiche (contexte neuf, cache
// isole), clic reel sur cockpit, on renvoie l'etat mesure.
async function probeCockpitClick(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await boot(page);
    await clickNav(page, 'cockpit');
    // On laisse le handler synchrone s'appliquer (setView + renderStaff).
    await page.waitForFunction(() => typeof state !== 'undefined' && (state.view === 'staff' || state.view === 'admin'), null, { timeout: 10000 });
    return await readNavState(page);
  } finally {
    await page.close();
  }
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const errs = [];
  let mutationOriginal = null; // garde le contenu d'origine pour restauration sure
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
    await boot(page);

    // ---- ETAPES 1 & 2 : les 4 pages PLATEFORME par clic reel ---------------
    console.log('\n[1-2] Les 4 pages PLATEFORME : clic reel -> vue staff, cockpit visible, bon titre, PAS de Direction');
    for (const pg of PLATFORM_PAGES) {
      // Reset sur une page non-cockpit : le clic suivant est une VRAIE transition.
      await clickNav(page, 'dashboard');
      await page.waitForFunction(() => typeof isStaffCockpitActive === 'function' && !isStaffCockpitActive(), null, { timeout: 10000 });

      await clickNav(page, pg.key);
      await waitCockpitH1(page, pg.title);
      const s = await readNavState(page);

      record(`${pg.key} : state.view === 'staff'`, s.view === 'staff', `view=${s.view}`);
      record(`${pg.key} : getStaffMenuPage() === '${pg.key}'`, s.menuPage === pg.key, `menuPage=${s.menuPage}`);
      record(`${pg.key} : #adminView cache (hidden + display none)`, s.adminViewHidden && s.adminViewHasHiddenClass, `adminHidden=${s.adminViewHidden} hasHiddenClass=${s.adminViewHasHiddenClass}`);
      record(`${pg.key} : #staffCockpitPage visible (pas hidden)`, s.cockpitVisible && !s.cockpitHasHiddenClass, `cockpitVisible=${s.cockpitVisible} hasHiddenClass=${s.cockpitHasHiddenClass}`);
      record(`${pg.key} : h1 rendu === '${pg.title}'`, s.cockpitH1 === pg.title, `h1=${JSON.stringify(s.cockpitH1)}`);
      // ETAPE 2 : on n'atterrit PLUS sur la Direction.
      record(`${pg.key} : hero admin 'Direction' NON visible`, !s.adminHeroVisible && !s.adminViewVisible, `adminHeroVisible=${s.adminHeroVisible} adminViewVisible=${s.adminViewVisible}`);
    }

    // ---- ETAPE 3 : les autres routes marchent toujours ---------------------
    console.log('\n[3] Regressions croisees : dashboard, establishment (staff), action direction (admin)');
    // 3a. dashboard -> vue staff, cockpit cache.
    await clickNav(page, 'dashboard');
    await page.waitForFunction(() => typeof isStaffCockpitActive === 'function' && !isStaffCockpitActive(), null, { timeout: 10000 });
    let s3 = await readNavState(page);
    record("dashboard : state.view === 'staff'", s3.view === 'staff', `view=${s3.view}`);
    record('dashboard : #staffCockpitPage cache', s3.cockpitHidden && s3.cockpitHasHiddenClass, `cockpitHidden=${s3.cockpitHidden}`);
    record('dashboard : page dashboard visible', s3.dashboardVisible, `dashboardVisible=${s3.dashboardVisible}`);

    // 3b. establishment -> vue staff (PAS admin).
    await clickNav(page, 'establishment');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.view === 'staff' && (typeof getStaffMenuPage === 'function' ? getStaffMenuPage() : state.staffMenuPage) === 'establishment', null, { timeout: 10000 });
    s3 = await readNavState(page);
    record("establishment : state.view === 'staff' (pas admin)", s3.view === 'staff', `view=${s3.view}`);
    record('establishment : #adminView cache', s3.adminViewHidden && s3.adminViewHasHiddenClass, `adminHidden=${s3.adminViewHidden}`);

    // 3c. action compte/centre 'direction' -> vue admin (adminView visible).
    await triggerDirection(page);
    let sDir = await readNavState(page);
    record("direction : state.view === 'admin'", sDir.view === 'admin', `view=${sDir.view}`);
    record('direction : #adminView visible', sDir.adminViewVisible && !sDir.adminViewHasHiddenClass, `adminViewVisible=${sDir.adminViewVisible} hasHiddenClass=${sDir.adminViewHasHiddenClass}`);

    // ---- ETAPE 4 : sequence exacte du bug rapporte -------------------------
    // Partir en vue admin (via direction, deja fait), PUIS cliquer 'cockpit' :
    // on doit basculer en vue staff sur le cockpit. C'est la regression precise.
    console.log('\n[4] Sequence exacte du bug : admin (direction) PUIS clic cockpit -> vue staff sur le cockpit');
    // Verrou : on est bien en admin avant le clic.
    record("etape 4 : point de depart = vue admin", sDir.view === 'admin', `view=${sDir.view}`);
    await clickNav(page, 'cockpit');
    await waitCockpitH1(page, 'Cockpit fondateur');
    const s4 = await readNavState(page);
    record("etape 4 : apres clic cockpit, state.view === 'staff'", s4.view === 'staff', `view=${s4.view}`);
    record("etape 4 : getStaffMenuPage() === 'cockpit'", s4.menuPage === 'cockpit', `menuPage=${s4.menuPage}`);
    record('etape 4 : #adminView cache', s4.adminViewHidden && s4.adminViewHasHiddenClass, `adminHidden=${s4.adminViewHidden}`);
    record('etape 4 : #staffCockpitPage visible + h1 Cockpit fondateur', s4.cockpitVisible && s4.cockpitH1 === 'Cockpit fondateur', `cockpitVisible=${s4.cockpitVisible} h1=${JSON.stringify(s4.cockpitH1)}`);

    await page.close();

    // ---- ETAPE 5 : CONTRE-PREUVE PAR MUTATION ------------------------------
    // On mute le cas explicite des 4 pages dans staff-menu.js : setView('staff')
    // devient setView('admin'). C'est la reintroduction exacte du symptome
    // rapporte (clic cockpit -> Direction/admin). Note : le simple retrait du
    // cas explicite ne suffirait PAS a rougir, car le fallback est desormais
    // defensif (il reste en staff) ; la mutation cible donc la decision de vue
    // du cas explicite, ce que le fix garantit. Restauration par EDITION
    // INVERSE exacte (le remplacement inverse), jamais git checkout.
    console.log('\n[5] Contre-preuve par MUTATION : le gate doit ROUGIR, puis restauration par edition inverse');
    const original = fs.readFileSync(MENU_SRC, 'utf8');
    mutationOriginal = original;
    const nl = original.includes('\r\n') ? '\r\n' : '\n';
    const ANCHOR = [
      "    if (['cockpit', 'cockpit-agents', 'cockpit-incidents', 'cockpit-clients'].includes(key)) {",
      '      setMenuPage(key);',
      "      if (typeof setView === 'function') setView('staff');",
    ].join(nl);
    const MUTATED = [
      "    if (['cockpit', 'cockpit-agents', 'cockpit-incidents', 'cockpit-clients'].includes(key)) {",
      '      setMenuPage(key);',
      "      if (typeof setView === 'function') setView('admin');",
    ].join(nl);

    const occ = original.split(ANCHOR).length - 1;
    if (occ !== 1) {
      console.error(`menu-navigation-check: ancre de mutation introuvable ou ambigue (${occ} occurrence(s)). Le cas explicite des 4 pages a-t-il change ?`);
      process.exitCode = 1;
      return;
    }
    const mutatedContent = original.replace(ANCHOR, MUTATED);
    if (mutatedContent === original) {
      console.error('menu-navigation-check: la mutation n a rien change au fichier.');
      process.exitCode = 1;
      return;
    }

    let redState = null;
    let redError = null;
    fs.writeFileSync(MENU_SRC, mutatedContent);
    try {
      redState = await probeCockpitClick(browser);
    } catch (e) {
      redError = e && e.message;
    } finally {
      // EDITION INVERSE exacte : on annule le remplacement sur le contenu mute.
      const restored = mutatedContent.replace(MUTATED, ANCHOR);
      // Filet de securite : si l'inverse ne reconstruit pas l'original bit pour
      // bit, on reecrit l'original capture (jamais git checkout).
      fs.writeFileSync(MENU_SRC, restored === original ? restored : original);
    }

    // Le gate DOIT rougir sous mutation : clic cockpit -> vue admin.
    const mutationRouge = !!redState && redState.view === 'admin';
    record('mutation : clic cockpit bascule en vue admin (le gate ROUGIT)', mutationRouge, redError ? `erreur probe=${redError}` : `view=${redState && redState.view} adminViewVisible=${redState && redState.adminViewVisible}`);
    if (!mutationRouge) {
      console.error('menu-navigation-check: MUTATION SANS EFFET, le gate ne sait pas rougir.', JSON.stringify(redState));
    }

    // Restauration : le fichier est identique a l'original, octet pour octet.
    const afterRestore = fs.readFileSync(MENU_SRC, 'utf8');
    record('restauration : staff-menu.js identique a l original (edition inverse)', afterRestore === original, `identique=${afterRestore === original}`);

    // Re-verification VERTE apres restauration : clic cockpit -> vue staff.
    const greenState = await probeCockpitClick(browser);
    record('apres restauration : clic cockpit revient en vue staff (VERT)', greenState.view === 'staff' && greenState.cockpitVisible, `view=${greenState.view} cockpitVisible=${greenState.cockpitVisible}`);

    // ---- ETAPE 6 : DEEP-LINK / HASH (finding B, meme famille de bug) --------
    // applyInitialRouteFromHash avait une SECONDE liste blanche codee en dur qui
    // omettait les 4 pages Plateforme : un deep-link/bookmark #/staff/cockpit-*
    // retombait sur planning. Le fix la remplace par la source de verite unique
    // STAFF_MENU_PAGES. On teste la fonction reelle en isolant son effet, avec un
    // controle NEGATIF (une page inexistante DOIT etre refusee) pour prouver que
    // le filtre est reel et que le test ne passe pas trivialement.
    console.log('\n[6] Deep-link par hash : applyInitialRouteFromHash honore les pages Plateforme');
    const hashPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await boot(hashPage);
      const applyHash = (hash) => hashPage.evaluate((h) => {
        if (typeof applyInitialRouteFromHash !== 'function') return { error: 'applyInitialRouteFromHash absente' };
        state.view = 'client';
        state.staffMenuPage = 'planning';
        window.location.hash = h;
        applyInitialRouteFromHash();
        return { view: state.view, page: (typeof getStaffMenuPage === 'function') ? getStaffMenuPage() : state.staffMenuPage };
      }, hash);

      const inc = await applyHash('#/staff/cockpit-incidents');
      record("deep-link #/staff/cockpit-incidents : state.view === 'staff'", inc.view === 'staff', `view=${inc.view}`);
      record("deep-link #/staff/cockpit-incidents : page === 'cockpit-incidents' (plus de repli planning)", inc.page === 'cockpit-incidents', `page=${inc.page}`);

      const cock = await applyHash('#/staff/cockpit');
      record("deep-link #/staff/cockpit : page === 'cockpit'", cock.page === 'cockpit', `page=${cock.page}`);

      // Controle NEGATIF : une page hors STAFF_MENU_PAGES ne doit PAS etre posee
      // (sinon le test [6] passerait pour n'importe quelle chaine, donc ne
      // prouverait rien). Elle reste sur la valeur de depart 'planning'.
      const bogus = await applyHash('#/staff/pagequinexistepas');
      record("controle negatif : deep-link vers une page inconnue est refuse (reste 'planning')", bogus.page === 'planning', `page=${bogus.page}`);
    } finally {
      await hashPage.close();
    }

    // ---- Erreurs console fatales -------------------------------------------
    const fatal = errs.filter((e) => !/localStorage|sandboxed|favicon|cdn\.vercel-insights/i.test(e));
    record('aucune erreur console fatale', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } catch (error) {
    console.error('menu-navigation-check: exception', error && error.stack || error);
    process.exitCode = 1;
  } finally {
    // Ultime garde-fou : si une exception a laisse le fichier mute, on restaure.
    if (mutationOriginal != null) {
      try {
        const cur = fs.readFileSync(MENU_SRC, 'utf8');
        if (cur !== mutationOriginal) fs.writeFileSync(MENU_SRC, mutationOriginal);
      } catch (e) {}
    }
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nmenu-navigation-check: ${checks.length - failed.length}/${checks.length} verifications vertes.`);
  if (failed.length || process.exitCode === 1) {
    console.error(`menu-navigation-check: ECHEC (${failed.length} rouge(s)).`);
    process.exit(1);
  }
  console.log('menu-navigation-check: ALL OK (navigation menu -> pages PLATEFORME cloisonnee, Direction jamais atteinte par la barre laterale)');
  process.exit(0);
})();
