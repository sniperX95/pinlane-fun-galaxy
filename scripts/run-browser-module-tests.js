const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function runBrowserScript(file, context = {}) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    ...context,
  };
  sandbox.window = sandbox.window || {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

async function main() {
  const storageMap = new Map();
  const storageSandbox = runBrowserScript('assets/storage-adapter.js', {
    window: {
      localStorage: {
        getItem: (key) => storageMap.has(key) ? storageMap.get(key) : null,
        setItem: (key, value) => storageMap.set(key, String(value)),
        removeItem: (key) => storageMap.delete(key),
      },
    },
  });
  const storage = storageSandbox.window.PinlaneStorage;
  assert(storage, 'PinlaneStorage is missing');
  assert.strictEqual(storage.setJson('state', { view: 'staff' }), true);
  assert.strictEqual(storage.getJson('state').view, 'staff');
  assert.strictEqual(storage.ensureMarker('migration', () => storage.setRaw('applied', 'yes')), true);
  assert.strictEqual(storage.getRaw('applied'), 'yes');
  assert.strictEqual(storage.ensureMarker('migration', () => storage.setRaw('applied', 'no')), false);
  assert.strictEqual(storage.remove('state'), true);
  assert.strictEqual(storage.getJson('state', null), null);

  const bookingCoreSandbox = runBrowserScript('assets/booking-core.js', {
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Set,
    Map,
  });
  const bookingCore = bookingCoreSandbox.window.PinlaneBookingCore;
  assert(bookingCore, 'PinlaneBookingCore is missing');
  assert.strictEqual(bookingCore.TOTAL_LANES, 8);
  assert.strictEqual(bookingCore.FORMULES.length >= 10, true);
  assert.strictEqual(bookingCore.getRequiredLaneCount('bowling', 6, ''), 1);
  assert.strictEqual(bookingCore.getRequiredLaneCount('bowling', 17, ''), 3);
  assert.strictEqual(bookingCore.getLaserWaveCount(32), 2);
  assert.strictEqual(bookingCore.formatDurationLabel(1.5), '1h30');
  assert.strictEqual(bookingCore.getSchedule('2026-06-26', false).label, '14h - Minuit');

  const adminConsoleSandbox = runBrowserScript('assets/admin-console.js', {
    window: {},
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Set,
    Map,
  });
  const adminConsole = adminConsoleSandbox.window.PinlaneAdminConsole;
  assert(adminConsole, 'PinlaneAdminConsole is missing');
  assert.strictEqual(typeof adminConsole.buildAdminMetrics, 'function');
  assert.strictEqual(typeof adminConsole.renderAdminDashboard, 'function');
  assert.strictEqual(typeof adminConsole.loadAdminDashboard, 'function');

  const opsConsoleSandbox = runBrowserScript('assets/ops-console.js', {
    window: {},
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Set,
    Map,
  });
  const opsConsole = opsConsoleSandbox.window.PinlaneOpsConsole;
  assert(opsConsole, 'PinlaneOpsConsole is missing');
  assert.strictEqual(typeof opsConsole.loadOpsAdmin, 'function');
  assert.strictEqual(typeof opsConsole.renderOpsAdmin, 'function');
  assert.strictEqual(typeof opsConsole.renderOpsAgentStack, 'function');

  const sessionSandbox = runBrowserScript('assets/staff-auth-session.js');
  const session = sessionSandbox.window.PinlaneStaffAuthSession;
  assert(session, 'PinlaneStaffAuthSession is missing');
  assert.strictEqual(session.normalize({ token: 'abc' }, 'gembloux').centerId, 'gembloux');
  assert.strictEqual(session.normalize({ cookieBacked: true }, 'libramont').cookieBacked, true);
  assert.strictEqual(session.normalize({ token: 'abc', expiresAt: '2000-01-01T00:00:00.000Z' }, 'libramont'), null);
  assert.strictEqual(session.getToken({ token: 'abc' }), 'abc');
  assert.strictEqual(session.getToken({ cookieBacked: true }), '');

  let fetchOptions = null;
  let unauthorizedCalled = false;
  const apiSandbox = runBrowserScript('assets/api-client.js', {
    window: { location: { origin: 'https://example.test' } },
    fetch: async (url, options) => {
      fetchOptions = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, url, headers: options.headers, credentials: options.credentials }),
      };
    },
  });
  const api = apiSandbox.window.PinlaneApiClient;
  assert(api, 'PinlaneApiClient is missing');
  assert.strictEqual(api.endpoints.staffAuth, '/api/staff-auth');
  assert.strictEqual(api.isProtectedStaffApi('/api/staff-auth?centerId=libramont'), true);
  assert.strictEqual(api.isProtectedStaffApi('/api/public-availability?date=2026-06-20'), false);

  const payload = await api.request('/api/staff-auth?centerId=libramont', { method: 'GET' }, {
    getSessionToken: () => 'staff-token',
    onUnauthorized: () => { unauthorizedCalled = true; },
  });
  assert.strictEqual(fetchOptions.url, 'https://example.test/api/staff-auth?centerId=libramont');
  assert.strictEqual(payload.headers['X-Staff-Session'], 'staff-token');
  assert.strictEqual(payload.credentials, 'same-origin');
  assert.strictEqual(unauthorizedCalled, false);

  const staffMenuSource = fs.readFileSync(path.join(root, 'assets', 'staff-menu.js'), 'utf8');
  assert(staffMenuSource.includes('GROUP_DEFAULT_TARGETS'), 'staff menu collapsed group targets are missing');
  assert(staffMenuSource.includes("planning: 'planning'"), 'planning group does not have a collapsed fallback target');
  assert(staffMenuSource.includes("field: 'arrivals'"), 'field group does not have a collapsed fallback target');
  assert(staffMenuSource.includes("activities: 'prices'"), 'activities group does not have a collapsed fallback target');
  assert(/function\s+navigateMenuGroup/.test(staffMenuSource), 'collapsed parent navigation helper is missing');
  assert(/measureMenuSubnavHeight/.test(staffMenuSource), 'staff menu subnav animation is not height-measured');
  assert(/applyMenuGroupOpen\(groupToggle,\s*nextOpen,\s*\{\s*animate:\s*true\s*\}\)/.test(staffMenuSource), 'group toggles do not request animated state changes');
  assert(staffMenuSource.includes('FGX_STAFF_MENU_GROUP_TARGETS'), 'staff menu group targets are not exposed for diagnostics');
  assert(/visibleMenuSections\(\)\.map\(sectionMarkup\)/.test(staffMenuSource), 'sidebar nav must render only permission-filtered sections');

  // Masquage réel : un rôle limité ne doit voir QUE ses entrées autorisées dans
  // le menu (entrées interdites absentes, pas seulement désactivées).
  function buildMenuSandbox(allowedPages) {
    const noopEl = { classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dataset: {}, setAttribute() {} };
    const sandbox = {
      window: {},
      document: {
        readyState: 'loading',
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: () => noopEl,
      },
      canUseStaffPage: (page) => allowedPages.has(page),
      canUseStaffPermission: () => false,
      localStorage: { getItem: () => null, setItem() {} },
      state: { view: 'staff', staffMenuPage: 'dashboard' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(staffMenuSource, sandbox);
    return sandbox;
  }

  const limitedSandbox = buildMenuSandbox(new Set(['dashboard', 'planning', 'reservations']));
  const limitedSections = limitedSandbox.window.FGX_STAFF_VISIBLE_SECTIONS();
  const limitedKeys = new Set(limitedSections.flatMap(section => section.items.map(item => item.key)));
  assert(limitedKeys.has('dashboard') && limitedKeys.has('planning') && limitedKeys.has('reservations'), 'allowed entries must remain visible');
  assert(!limitedKeys.has('users'), 'forbidden "users" entry must be absent from the menu (not just disabled)');
  assert(!limitedKeys.has('clients'), 'forbidden "clients" entry must be absent from the menu');
  assert(!limitedSections.some(section => section.title === 'Clients & marketing'), 'a section with no allowed entry must be removed entirely');
  assert(!limitedSections.some(section => section.items.some(item => item.key === 'activities')), 'forbidden "activities" group must be removed when no child is allowed');

  const directionSandbox = buildMenuSandbox(new Set(['dashboard', 'planning', 'reservations', 'clients', 'groups', 'emails', 'campaigns', 'prices', 'lanes', 'laserGame', 'users', 'establishment', 'settings', 'sessions', 'arrivals', 'events']));
  const directionKeys = new Set(directionSandbox.window.FGX_STAFF_VISIBLE_SECTIONS().flatMap(section => section.items.map(item => item.key)));
  assert(directionKeys.has('users') && directionKeys.has('establishment'), 'full-access role must still see the access-management entries');

  const staffMenuCss = fs.readFileSync(path.join(root, 'assets', 'pinlane-staff.css'), 'utf8');
  assert(
    /body\.staff-menu-collapsed[\s\S]{0,600}\.fgx-menu-subnav\s*\{\s*display:\s*none/.test(staffMenuCss),
    'collapsed staff menu must hide subnavs so parent buttons remain the only collapsed affordance'
  );
  assert(
    /\.fgx-menu-subnav\s*\{[\s\S]{0,600}transition:\s*max-height[\s\S]{0,200}opacity[\s\S]{0,200}margin/.test(staffMenuCss)
      && !/\.fgx-menu-subnav\s*\{[\s\S]{0,600}transition:\s*all/.test(staffMenuCss),
    'staff menu group animation must transition only the changed properties'
  );

  apiSandbox.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Session expirée' }),
  });
  await assert.rejects(
    () => api.request('/api/staff-state?date=2026-06-20', {}, {
      getSessionToken: () => 'staff-token',
      onUnauthorized: () => { unauthorizedCalled = true; },
    }),
    /Session expirée/,
  );
  assert.strictEqual(unauthorizedCalled, true);

  console.log('browser-module-tests-ok');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
