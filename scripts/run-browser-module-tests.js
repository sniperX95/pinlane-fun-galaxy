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
