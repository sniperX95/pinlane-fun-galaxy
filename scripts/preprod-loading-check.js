// OPS-07: real browser modules, local fixtures only. Run through run-isolated.cjs.
// All browser requests are fulfilled from source/mocks or aborted, never forwarded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'preprod-fixes-20260912', 'ops07');
const ORIGIN = 'http://127.0.0.1:4199';
const STAFF = ['ops-progress', 'ops-live', 'email-thread', 'staff-menu', 'pinlane-fx',
  'staff-pages-v2', 'pinlane-charts', 'pinlane-daterange', 'pinlane-analytics-board',
  'founder-cockpit', 'founder-clients-platform', 'founder-centres', 'founder-tarifs', 'founder-team'];
const ADMIN = ['admin-console', 'ops-console', 'admin-data', 'admin-mail'];
const SHARED = ['booking-core', 'brand-color', 'app-main', 'storage-adapter', 'api-client'];
const SESSION = { token: 'qa-loading', cookieBacked: false, centerId: 'libramont',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  member: { id: 'libramont:platform-owner', name: 'QA', roleId: 'platform-owner' },
  role: { id: 'platform-owner', name: 'QA', locked: true },
  permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
    'reservations.view', 'clients.view', 'pricing.manage', 'emails.view', 'emails.send',
    'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view',
    'users.manage', 'platform.admin', 'centers.switch'] };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let failures = 0;
const results = [];
async function check(label, fn) {
  try { const evidence = await fn(); results.push({ label, ok: true, evidence }); console.log('PASS', label, JSON.stringify(evidence ?? '')); }
  catch (e) { failures++; results.push({ label, ok: false, error: e.message }); console.error('FAIL', label, e.stack); }
}
const names = requests => requests.map(url => path.basename(new URL(url).pathname, '.js'));
async function fixture(browser, { auth = true, fail = '', delay = '', eager = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(8000);
  const requests = [], errors = [], executed = [];
  let blocked = fail;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('__loadingExecuted', name => executed.push(name));
  await page.addInitScript(({ auth, session }) => {
    if (auth) localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
    window.__loadingSession = session;
  }, { auth, session: SESSION });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      let payload = { ok: true, blocks: [], communications: [], samples: [], suggestions: [],
        events: [], agents: [], activations: [], orchestration: {}, centers: [], clients: [] };
      if (url.pathname === '/api/staff-auth') payload = { ok: true, authenticated: true, session: SESSION };
      if (url.pathname === '/api/staff-state') payload = { ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' };
      if (url.pathname === '/api/public-booking-meta') payload = { ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', name: 'QA', status: 'active' } };
      if (url.pathname === '/api/admin-range') payload = { ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' };
      return route.fulfill({ json: payload });
    }
    const file = url.pathname === '/' || url.pathname.startsWith('/reserver') ? 'index.html' : url.pathname.slice(1);
    // Only known public asset trees; no API handler, env loader or server imported.
    if (file !== 'index.html' && !file.startsWith('assets/')) return route.fulfill({ status: 404, body: '' });
    const resolved = path.resolve(ROOT, file);
    if (!resolved.startsWith(ROOT + path.sep) || !fs.existsSync(resolved)) return route.fulfill({ status: 404, body: '' });
    let body = fs.readFileSync(resolved);
    if (file.endsWith('.js')) {
      requests.push(url.href);
      const name = path.basename(file, '.js');
      if (name === blocked) return route.abort('failed');
      if (name === delay) await held;
      body = Buffer.from(body.toString('utf8') + '\n;window.__loadingExecuted(' + JSON.stringify(name) + ');');
    }
    // Negative control: the real index with its staff declarations made eager again.
    if (file === 'index.html' && eager) body = Buffer.from(body.toString('utf8').replace(/type="text\/plain" data-staff-console/g, 'defer'));
    return route.fulfill({ body, contentType: MIME[path.extname(file)] || 'application/octet-stream' });
  });
  return { page, requests, errors, executed, release, unblock: () => { blocked = ''; },
    close: async () => { release(); await page.close(); } };
}
async function boot(f, url = '/reserver/libramont') {
  await f.page.goto(ORIGIN + url, { waitUntil: 'load' });
  await f.page.waitForFunction(() => typeof setView === 'function');
}
async function staffReady(f, host = '#staffReservationsPage') {
  await f.page.waitForFunction(selector => {
    const root = document.getElementById('staffView');
    const el = document.querySelector(selector);
    return root && getComputedStyle(root).display !== 'none' && !root.inert &&
      el && el.innerText.trim().length > 30 && !document.getElementById('staffConsoleLoadStatus');
  }, host);
  assert.equal(await f.page.locator('.fgx-menu-nav').count(), 1, 'one working sidebar');
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    await check('OPS-07 public: zero staff/admin requests, shared business modules retained', async () => {
      const evidence = [];
      for (const url of ['/', '/#client', '/reserver', '/reserver/libramont']) {
        const f = await fixture(browser, { auth: false });
        try {
          await boot(f, url);
          const loaded = names(f.requests);
          const unnecessary = loaded.filter(name => STAFF.includes(name) || ADMIN.includes(name));
          const bytes = unnecessary.reduce((sum, name) => sum + fs.statSync(path.join(ROOT, 'assets', name + '.js')).size, 0);
          console.log('PUBLIC_MEASURE', JSON.stringify({ url, requests: unnecessary.length, sourceBytes: bytes, names: unnecessary }));
          assert.deepEqual(unnecessary, []);
          for (const name of SHARED) assert(loaded.includes(name), name + ' still loaded');
          assert.deepEqual(f.errors, []);
          evidence.push({ url, requests: 0, sourceBytes: 0 });
        } finally { await f.close(); }
      }
      return evidence;
    });
    await check('negative control: eager declarations are detected as public overhead', async () => {
      const f = await fixture(browser, { auth: false, eager: true });
      try { await boot(f); const loaded = names(f.requests).filter(name => STAFF.includes(name)); assert.equal(loaded.length, STAFF.length); return { requests: loaded.length, sourceBytes: STAFF.reduce((sum, name) => sum + fs.statSync(path.join(ROOT, 'assets', name + '.js')).size, 0) }; }
      finally { await f.close(); }
    });
    await check('staff deep link and reload: pages/sidebar and execution order', async () => {
      const f = await fixture(browser);
      try {
        await boot(f, '/#/staff/reservations'); await staffReady(f);
        assert.deepEqual(f.executed.filter(name => STAFF.includes(name)), STAFF);
        await f.page.reload({ waitUntil: 'load' }); await staffReady(f);
        assert.equal(await f.page.evaluate(() => state.staffMenuPage), 'reservations');
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('late entry: two requests share one load; public navigation wins during load', async () => {
      const f = await fixture(browser, { delay: 'staff-pages-v2' });
      try {
        await boot(f);
        await f.page.evaluate(() => { state.staffMenuPage = 'reservations'; setView('staff'); setView('staff'); });
        await f.page.waitForFunction(() => document.getElementById('staffConsoleLoadStatus'));
        assert.equal(await f.page.locator('#staffView').isVisible(), false, 'partial staff UI is hidden');
        await f.page.evaluate(() => setView('client'));
        f.release();
        await f.page.evaluate(() => ensureStaffConsolesLoaded());
        assert.equal(await f.page.evaluate(() => state.view), 'client');
        assert.equal(await f.page.locator('#clientView').isVisible(), true);
        assert.equal(await f.page.locator('#staffConsoleLoadStatus').isVisible(), false);
        for (const name of STAFF) assert.equal(names(f.requests).filter(n => n === name).length, 1, name + ' loaded once');
        await f.page.evaluate(() => setView('staff')); await staffReady(f);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('failed download: inaccessible partial chrome, real retry, no duplicate predecessors', async () => {
      const f = await fixture(browser, { fail: 'staff-pages-v2' });
      try {
        await boot(f);
        await f.page.evaluate(() => { state.staffMenuPage = 'reservations'; setView('staff'); });
        await f.page.locator('#staffConsoleLoadStatus button').waitFor();
        await f.page.screenshot({ path: path.join(OUT, 'staff-download-failure.png') });
        assert.equal(await f.page.locator('#staffView').isVisible(), false);
        assert.equal(await f.page.locator('[data-staff-menu-root]').evaluate(el => el.inert), true);
        assert(!names(f.requests).includes('pinlane-charts'), 'later dependencies must not execute after a failed predecessor');
        f.unblock(); await f.page.locator('#staffConsoleLoadStatus button').click(); await staffReady(f);
        assert.equal(names(f.requests).filter(n => n === 'staff-pages-v2').length, 2);
        assert.equal(names(f.requests).filter(n => n === 'staff-menu').length, 1);
        assert.equal(await f.page.locator('[data-staff-menu-root]').evaluate(el => el.inert), false);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('login during deferred loading completes the selected page', async () => {
      const f = await fixture(browser, { auth: false, delay: 'staff-pages-v2' });
      try {
        await f.page.goto(ORIGIN + '/#/staff/reservations', { waitUntil: 'domcontentloaded' });
        await f.page.locator('#loginPass').fill('QA-LOCAL');
        await f.page.evaluate(() => submitLogin({ preventDefault() {} }));
        f.release(); await staffReady(f);
        assert.equal(await f.page.locator('#authOverlay').isVisible(), false);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('late hash entry: charts, analytics and founder pages use real modules', async () => {
      const f = await fixture(browser);
      try {
        await boot(f);
        await f.page.evaluate(() => { history.replaceState(null, '', '/'); location.hash = '/staff/reservations'; });
        await staffReady(f);
        for (const [target, host] of [['clients', '#staffClientsPage'], ['emails', '#staffEmailsPage'], ['cockpit-centres', '#staffCockpitPage'], ['cockpit-clients-platform', '#staffCockpitPage']]) {
          await f.page.locator(`.fgx-menu-nav [data-fgx-menu-key="${target}"]`).click();
          await staffReady(f, host);
          assert.equal(await f.page.evaluate(() => state.staffMenuPage), target, 'real sidebar click selects the page');
        }
        assert.equal(await f.page.evaluate(() => typeof PinlaneCharts.lineChart === 'function' && typeof PinlaneDateRange.mount === 'function' && typeof PinlaneAnalyticsBoard.mount === 'function' && typeof renderFounderTarifsPage === 'function' && typeof renderFounderTeamPage === 'function'), true);
        await f.page.screenshot({ path: path.join(OUT, 'late-founder-sidebar.png') });
        assert(STAFF.every(name => names(f.requests).includes(name)));
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('C14 admin failure and retry still render the direction console', async () => {
      const f = await fixture(browser, { fail: 'admin-console' });
      try {
        await boot(f, '/#/staff/reservations'); await staffReady(f);
        await f.page.evaluate(() => setView('admin'));
        await f.page.locator('#adminConsoleLoadError button').waitFor();
        assert.equal(await f.page.locator('#adminView').evaluate(el => el.style.pointerEvents), 'none');
        f.unblock(); await f.page.locator('#adminConsoleLoadError button').click();
        await f.page.waitForFunction(() => !document.getElementById('adminConsoleLoadError') && document.getElementById('adminContent').innerText.trim().length > 30);
        assert.equal(names(f.requests).filter(n => n === 'admin-console').length, 2);
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
    await check('admin deep link: concurrent load, public navigation and late direction entry', async () => {
      const f = await fixture(browser, { delay: 'admin-data' });
      try {
        await f.page.goto(ORIGIN + '/#/admin', { waitUntil: 'domcontentloaded' });
        await f.page.waitForFunction(() => !!document.querySelector('script[src*="admin-data.js"]'));
        await f.page.evaluate(() => { setView('admin'); setView('client'); });
        f.release(); await f.page.evaluate(() => ensureAdminConsolesLoaded());
        assert.equal(await f.page.evaluate(() => state.view), 'client');
        assert.equal(await f.page.locator('#clientView').isVisible(), true);
        await f.page.evaluate(() => setView('admin'));
        await f.page.waitForFunction(() => document.getElementById('adminContent').innerText.trim().length > 30);
        for (const name of [...STAFF, ...ADMIN]) assert.equal(names(f.requests).filter(n => n === name).length, 1, name + ' loaded once');
        assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
  } finally { await browser.close(); }
  console.log('LOADING_RESULTS', JSON.stringify(results));
  fs.writeFileSync(path.join(OUT, 'loading-results.json'), JSON.stringify(results, null, 2));
  console.log(`preprod-loading-check: ${results.length - failures}/${results.length} passed`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
