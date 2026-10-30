// OPS05: real reader, route and browser collector, synthetic SQL only.
// Run through artifacts/preprod-fixes-20260912/run-isolated.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
assert(!fs.existsSync(path.join(__dirname, '../.env')), 'Use the isolated runner');
assert(!process.env.DATABASE_URL, 'No inherited database credentials');
for (const name of ['node:net', 'node:tls', 'node:http', 'node:https']) {
  const module = require(name);
  for (const method of ['connect', 'createConnection', 'request', 'get']) {
    if (module[method]) module[method] = () => { throw new Error('Network forbidden in range gate'); };
  }
}
require('node:net').Socket.prototype.connect = () => { throw new Error('Socket forbidden'); };
global.fetch = () => { throw new Error('Fetch forbidden'); };
process.env.DATABASE_URL = 'postgres://fixture:fixture@localhost:1/range_fixture';
const root = path.resolve(__dirname, '..');
let rows = [];
let queries = [];
let releases = 0;
let deny = false;
let direction = false;
let opsReads = 0;
let laneRows = [];
let opsFixture = { queue: { pending: 0 } };
const authCalls = [];
const { isSimulationReservation, simulationSqlExclusion } = require('../lib/simulation-filter');
function chronological(a, b) {
  return a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time) || Number(a.id) - Number(b.id);
}
async function query(sql, values = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  queries.push({ sql: normalized, values });
  if (/from lane_statuses/i.test(normalized)) return { rows: laneRows };
  assert.match(normalized, /from reservations/i, 'Unexpected SQL');
  assert.match(normalized, /date >= \$1/);
  assert.match(normalized, /date <= \$2/);
  assert.match(normalized, /center_id = \$3/);
  let selected = rows.filter(r => r.date >= values[0] && r.date <= values[1] && r.center_id === values[2]);
  if (normalized.includes(simulationSqlExclusion())) selected = selected.filter(r => !isSimulationReservation(r));
  if (/max\(id\)/i.test(normalized)) {
    return { rows: [{ upper_id: selected.reduce((n, r) => BigInt(r.id) > n ? BigInt(r.id) : n, 0n).toString() }] };
  }
  if (/limit \$6/i.test(normalized)) {
    assert.match(normalized, /id > \$4/);
    assert.match(normalized, /id <= \$5/);
    assert.match(normalized, /order by id asc/i);
    assert.doesNotMatch(normalized, /offset/i);
    assert(Number.isInteger(values[5]) && values[5] <= 501);
    selected = selected.filter(r => BigInt(r.id) > BigInt(values[3]) && BigInt(r.id) <= BigInt(values[4]));
    selected.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
    selected = selected.slice(0, values[5]);
  } else {
    selected.sort(chronological);
  }
  return { rows: selected, rowCount: selected.length };
}
class FakePool extends EventEmitter {
  async connect() { return { query, release() { releases += 1; } }; }
  async query(sql, values) { return query(sql, values); }
}
const load = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'pg') return { Pool: FakePool };
  if (parent?.filename === path.join(root, 'api/admin-range.js') && name === '../lib/staff-auth') {
    return {
      async requireStaffPermission(req, res, permissions, scope) {
        authCalls.push({ permissions, scope });
        if (deny) { require('../lib/http').sendError(res, 403, 'Refus fixture'); return null; }
        return { id: 'fixture-staff' };
      },
      sessionHasPermission() { return direction; },
    };
  }
  return load.call(this, name, parent, isMain);
};
const db = require('../lib/database');
db.getOpsHealth = async () => { opsReads += 1; return opsFixture; };
const handler = require('../api/admin-range');
Module._load = load;
const browser = { window: { location: { origin: 'http://localhost' } }, URL, URLSearchParams, console, fetch: global.fetch };
vm.createContext(browser);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/api-client.js'), 'utf8'), browser);
const collect = (url, request) => browser.window.PinlaneApiClient.collectAdminRange(url, request);
const base = '/api/admin-range?startDate=2023-01-01&endDate=2026-12-31&centerId=libramont';
function fixture(id, extra = {}) {
  return {
    id: String(id), name: `Client ${id}`, phone: '0400000000', email: `client${id}@example.test`,
    center_id: 'libramont', date: id === 1 ? '2023-01-01' : `2026-09-${String(1 + id % 28).padStart(2, '0')}`,
    start_time: `${String(10 + id % 10).padStart(2, '0')}:30:00`, duration: 1, total_duration: 1,
    price: 20, base_price: 20, pax: 4, lanes: [1], status: id % 9 ? 'paid' : 'cancelled',
    channel: 'staff', created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-01-01T10:00:00.000Z', ...extra,
  };
}
function reset(nextRows) { rows = nextRows; queries = []; deny = false; direction = false; laneRows = []; opsFixture = { queue: { pending: 0 } }; }
async function http(url = base, headers = {}, method = 'GET') {
  const res = { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body = '') { this.body = body; } };
  await handler({ url, headers, method }, res);
  res.payload = res.body ? JSON.parse(res.body) : null;
  return res;
}
async function request(url) {
  const res = await http(url);
  if (res.statusCode !== 200) throw Object.assign(new Error(res.payload.message), { status: res.statusCode });
  assert(Buffer.byteLength(res.body) < 3_800_000, 'Every successful envelope fits the byte ceiling');
  return res.payload;
}
const results = [];
function findRangeCalls(source) {
  // Inspect call arguments, not endpoint declarations or permission registries.
  // Covers the literal and configured URL forms used by browser consumers.
  const opening = /\b((?:window\.)?PinlaneApiClient\.(?:collectAdminRange|request)|apiRequest|fetch)\s*\(\s*/g;
  const matches = [];
  for (const match of source.matchAll(opening)) {
    const argument = source.slice(match.index + match[0].length);
    const quote = argument[0];
    const literal = [String.fromCharCode(96), '"', "'"].includes(quote);
    const end = literal ? argument.indexOf(quote, 1) : argument.search(/[,)]/);
    const firstArgument = argument.slice(0, end < 0 ? argument.length : end + 1);
    if (!/API_ENDPOINTS\s*\.\s*adminRange|endpoints\s*\.\s*adminRange|\/api\/admin-range/.test(firstArgument)) continue;
    matches.push({
      line: source.slice(0, match.index).split('\n').length,
      callee: match[1],
      collected: match[1].endsWith('.collectAdminRange'),
    });
  }
  return matches;
}
function browserSourceFiles(directory = path.join(root, 'assets')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? browserSourceFiles(file) : file.endsWith('.js') ? [file] : [];
  });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function dashboardFixtureRows() {
  return Array.from({ length: 701 }, (_, i) => fixture(i + 1, {
    date: '2026-09-12', status: i === 700 ? 'cancelled' : 'paid',
    price: i === 700 ? 999 : i < 500 ? 20 : 50,
  }));
}
function dashboardHarness({ mutation = '', pauseSecond = false, failSecond = false, prefetch = false } = {}) {
  const secondSeen = deferred();
  const resume = deferred();
  const calls = [];
  const renders = [];
  const notices = [];
  const center = { id: 'libramont', name: 'Fixture', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 32 } } };
  const parse = date => new Date(date + 'T00:00:00Z');
  const add = (date, n) => { const d = parse(date); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const context = {
    window: { location: { origin: 'http://localhost' } }, URL, URLSearchParams,
    console: { ...console, warn: (...args) => notices.push(args.join(' ')) },
    state: { view: 'admin', adminCenterId: 'libramont', adminPeriod: 'day', adminDate: '2026-09-12', adminTab: 'overview' },
    API_ENDPOINTS: { adminRange: '/api/admin-range', ops: '/api/ops' },
    adminLoadRequestId: 0, adminDashboardCache: { loaded: false, snapshot: null, knowledge: {} },
    adminSnapshotCache: {}, adminSnapshotLoadingKeys: {}, adminOpsCacheByCenter: {}, opsAdminCache: {},
    todayStr: () => '2026-09-12', parseLocalDate: parse, addDays: add,
    startOfWeek: date => add(date, -((parse(date).getUTCDay() + 6) % 7)),
    getDateRangeDays: (start, end) => {
      const dates = [];
      for (let d = start; d <= end; d = add(d, 1)) dates.push(d);
      return dates;
    },
    getAdminCenter: () => center,
    getPlanningWindow: () => ({ open: 10, close: 22, closed: false }),
    getBowlingWindowsFromReservation: () => [], getLaserWindowsFromReservation: () => [],
    getVisibleOpsCommunications: values => values,
    markRemoteSyncSuccess() {}, markRemoteSyncFailure() {},
    toast: text => notices.push(text),
    fixtureSinglePage: (url, requestPage) => requestPage(url),
    apiRequest: async url => {
      const target = new URL(url, 'http://localhost');
      assert.equal(target.origin, 'http://localhost');
      assert.equal(target.pathname, '/api/admin-range', 'Unrelated services must be mocked');
      calls.push(url);
      if (target.searchParams.has('cursor')) {
        secondSeen.resolve();
        if (pauseSecond) await resume.promise;
        if (failSecond) throw new Error('dashboard-second-page-failed');
      }
      return request(url);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/api-client.js'), 'utf8'), context);
  let source = fs.readFileSync(path.join(root, 'assets/admin-console.js'), 'utf8');
  if (mutation) {
    // Change only the chosen real caller, IN MEMORY. Product files stay frozen.
    const start = source.indexOf('function ' + mutation + '(');
    const end = source.indexOf('\n}', start) + 2;
    assert(start >= 0 && end > start);
    const body = source.slice(start, end);
    const replacement = body.replace('window.PinlaneApiClient.collectAdminRange(', 'fixtureSinglePage(');
    assert.notEqual(body, replacement, 'Mutation must hit the chosen caller');
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  vm.runInContext(source, context, { filename: 'assets/admin-console.js' });
  // Only adjacent effects/DOM are mocked. The loaders, period/cache helpers,
  // collector, metrics and export payload builder remain the real functions.
  context.refreshAdminKnowledge = async () => {};
  context.loadAdminOpsForCenter = async () => {};
  if (!prefetch) context.prefetchAdminPeriodSnapshots = () => {};
  context.renderAdminDashboard = () => {
    if (context.adminDashboardCache.loaded) renders.push(context.getAdminExportPayload());
  };
  return { context, secondSeen, resume, calls, renders, notices };
}
function assertCompleteDashboard(harness) {
  const current = harness.context.adminDashboardCache;
  assert.equal(current.loaded, true, current.error);
  assert.equal(current.snapshot.reservations.length, 701, 'Dashboard must publish both pages');
  assert.equal(new Set(current.snapshot.reservations.map(row => row.id)).size, 701);
  const payload = harness.context.getAdminExportPayload();
  assert.equal(payload.metrics.reservations, 700, 'The cancelled row stays visible but is excluded from counts');
  assert.equal(payload.metrics.revenue, 20000, 'Dashboard revenue includes the second page');
  assert.equal(payload.metrics.collected, 20000);
  assert.equal(payload.metrics.players, 2800);
  return payload;
}
async function settlePrefetch(harness) {
  for (let turn = 0; turn < 100; turn += 1) {
    if (!Object.values(harness.context.adminSnapshotLoadingKeys).some(Boolean)) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Prefetch did not settle');
}
async function test(name, fn) {
  // Keep a pending continuation from letting Node exit successfully before
  // the assertions run. A broken loader must fail, not silently end the gate.
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scenario did not finish')), 15000); }),
    ]);
    results.push({ name, ok: true }); console.log(`PASS ${name}`);
  }
  catch (error) { results.push({ name, ok: false }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { clearTimeout(timer); }
}
async function main() {
  await test('OPS05 bounded 10k+ HTTP first page', async () => {
    reset(Array.from({ length: 10021 }, (_, i) => fixture(i + 1)));
    const res = await http();
    console.log(JSON.stringify({ fixtureRows: rows.length, firstPageRows: res.payload?.reservations?.length, responseBytes: Buffer.byteLength(res.body) }));
    assert.equal(res.statusCode, 200);
    assert(Buffer.byteLength(res.body) < 3_800_000);
    assert.equal(res.payload.reservations.length, 500);
    assert(res.payload.pagination.hasMore && res.payload.pagination.nextCursor);
    assert.match(queries.find(q => /limit/i.test(q.sql))?.sql || '', /limit \$6/i);
  });
  await test('All 10021 rows, complete business reader and collected ordering', async () => {
    reset(Array.from({ length: 10021 }, (_, i) => fixture(i + 1)));
    rows.push(fixture(11000, { center_id: 'gembloux' }), fixture(11001, { channel: 'sim-staff' }), fixture(11002, { date: '2022-12-31' }));
    const complete = await db.readAdminRangeState('2023-01-01', '2026-12-31', 'libramont');
    assert.equal(complete.reservations.length, 10021);
    const all = await collect(base, request);
    assert.deepEqual(JSON.parse(JSON.stringify(all.reservations)), JSON.parse(JSON.stringify(complete.reservations)));
    assert.equal(new Set(all.reservations.map(r => r.id)).size, 10021);
    assert.equal(all.reservations.reduce((n, r) => n + r.price, 0), 200420);
    assert(all.reservations.some(r => r.date === '2023-01-01'));
    assert.equal(all.pagination.hasMore, false);
    const simulation = await db.readAdminRangeState('2023-01-01', '2026-12-31', 'libramont', { includeSimulation: true });
    assert.equal(simulation.reservations.length, 10022);
  });
  await test('Pages 1+2: immutable key survives deletion/time edits and bounds new inserts', async () => {
    reset(Array.from({ length: 700 }, (_, i) => fixture(i + 1)));
    const first = await request(base);
    assert.equal(first.reservations.length, 500);
    rows = rows.filter(r => r.id !== '1');
    rows.find(r => r.id === '2').start_time = '23:00:00';
    rows.push(fixture(701));
    const second = await request(`${base}&cursor=${encodeURIComponent(first.pagination.nextCursor)}`);
    const ids = [...first.reservations, ...second.reservations].map(r => r.id);
    assert.equal(ids.length, 700);
    assert.equal(new Set(ids).size, 700);
    assert.equal(second.pagination.hasMore, false);
    assert(!ids.includes(701));
  });
  await test('UTF8 large notes/plans force byte pagination without losing fields', async () => {
    const note = 'é😀"\\'.repeat(16000);
    reset(Array.from({ length: 35 }, (_, i) => fixture(i + 1, { notes: note, ops_plan: { label: note } })));
    const first = await request(base);
    assert(first.reservations.length > 0 && first.reservations.length < 35);
    const all = await collect(base, request);
    assert.equal(all.reservations.length, 35);
    for (const row of all.reservations) { assert.equal(row.notes, note); assert.equal(row.opsPlan.label, note); }
    console.log(JSON.stringify({ largeNoteRows: all.reservations.length, firstPageRows: first.reservations.length, firstPageBytes: Buffer.byteLength(JSON.stringify(first)) }));
  });
  await test('Oversized individual row or metadata errors explicitly; no truncated success', async () => {
    reset([fixture(1, { notes: 'x'.repeat(4_600_000) })]);
    assert.equal((await http()).statusCode, 413);
    await assert.rejects(collect(base, request));
    reset([fixture(1)]);
    direction = true;
    opsFixture = { diagnostic: 'x'.repeat(4_600_000) };
    assert.equal((await http()).statusCode, 413);
  });
  await test('Cursor validation covers scope, encoding, positions, dates, and page size', async () => {
    reset(Array.from({ length: 600 }, (_, i) => fixture(i + 1)));
    const first = await request(base);
    const cursor = first.pagination.nextCursor;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const invalid = [
      `${base}&cursor=garbage`, `${base}&cursor=${'a'.repeat(5000)}`,
      `${base.replace('libramont', 'gembloux')}&cursor=${cursor}`,
      `${base.replace('2023-01-01', '2024-01-01')}&cursor=${cursor}`,
      `${base}&cursor=${Buffer.from(JSON.stringify({ ...decoded, afterId: '-1' })).toString('base64url')}`,
      `${base}&cursor=${Buffer.from(JSON.stringify({ ...decoded, afterId: '999999999999999999999999' })).toString('base64url')}`,
      base.replace('2023-01-01', '2026-02-30'), base.replace('2023-01-01', '2026-99-01'),
      base.replace('2023-01-01', 'invalid'), base.replace('2023-01-01', '2027-01-01'),
      `${base}&pageSize=0`, `${base}&pageSize=999999`, `${base}&pageSize=1.5`,
    ];
    for (const url of invalid) {
      const before = queries.length;
      assert.equal((await http(url)).statusCode, 400, url.slice(-100));
      assert.equal(queries.length, before, 'Invalid request never reaches the pool');
    }
    await assert.rejects(db.readAdminRangeState('2023-01-01', '2026-12-31', 'libramont', { pageSize: 500, cursor, includeSimulation: true }));
    assert.equal((await http(`${base}&pageSize=2`)).payload.reservations.length, 2);
  });
  await test('Empty period, filtered center, cancelled rows retained', async () => {
    reset([fixture(1, { center_id: 'gembloux', status: 'cancelled' }), fixture(2, { channel: 'sim-client' })]);
    const empty = await collect(base, request);
    assert.equal(empty.reservations.length, 0);
    assert.equal(empty.pagination.nextCursor, null);
    const other = await collect(base.replace('libramont', 'gembloux'), request);
    assert.equal(other.reservations.length, 1);
    assert.equal(other.reservations[0].status, 'cancelled');
  });
  await test('Permissions enforced on each page; page-specific compact ETags', async () => {
    reset(Array.from({ length: 600 }, (_, i) => fixture(i + 1)));
    const first = await http();
    assert(first.headers.etag.length < 128, 'ETag is a digest, not all row data');
    assert.equal(first.payload.opsHealth, null);
    const secondUrl = `${base}&cursor=${first.payload.pagination.nextCursor}`;
    const second = await http(secondUrl, { 'if-none-match': first.headers.etag });
    assert.equal(second.statusCode, 200);
    assert.notEqual(second.headers.etag, first.headers.etag);
    assert.equal((await http(secondUrl, { 'if-none-match': second.headers.etag })).statusCode, 304);
    rows.find(r => r.id === '501').notes = 'changed without timestamp';
    assert.equal((await http(secondUrl, { 'if-none-match': second.headers.etag })).statusCode, 200);
    deny = true;
    const before = queries.length;
    assert.equal((await http(secondUrl)).statusCode, 403);
    assert.equal(queries.length, before);
    deny = false; direction = true;
    const opsBefore = opsReads;
    const director = await http(undefined, { 'if-none-match': first.headers.etag });
    assert.equal(director.statusCode, 200);
    assert(director.payload.opsHealth);
    assert.equal(opsReads, opsBefore + 1);
    assert(authCalls.every(a => a.permissions.includes('reservations.view') && a.permissions.includes('clients.view') && a.scope.centerId));
    assert.equal((await http(base, {}, 'POST')).statusCode, 405);
  });
  await test('Collector accepts legacy single-page mocks and fails closed on incomplete pages', async () => {
    let calls = 0;
    const single = { ok: true, reservations: [{ id: 1 }] };
    const result = await collect(base, async () => { calls += 1; return single; });
    assert.equal(calls, 1); assert.equal(result.reservations.length, 1);
    await assert.rejects(collect(base, async () => ({ reservations: [], pagination: { hasMore: true, nextCursor: null } })));
    await assert.rejects(collect(base, async () => ({ reservations: [{ id: 1 }], pagination: { hasMore: true, nextCursor: 'repeat' } })));
    calls = 0;
    await assert.rejects(collect(base, async () => { if (++calls === 2) throw new Error('offline'); return { reservations: [{ id: 1 }], pagination: { hasMore: true, nextCursor: 'next' } }; }));
    calls = 0;
    await assert.rejects(collect(base, async () => ++calls === 1
      ? { reservations: [{ id: 1 }], pagination: { hasMore: true, nextCursor: 'next' } }
      : { reservations: [{ id: 2 }] }));
  });
  await test('Real API request keeps the staff session on every page', async () => {
    reset(Array.from({ length: 701 }, (_, i) => fixture(i + 1)));
    let calls = 0;
    browser.fetch = async (url, options) => {
      calls += 1;
      assert.equal(new URL(url).origin, 'http://localhost');
      assert.equal(options.headers['X-Staff-Session'], 'fixture-token');
      assert.equal(options.credentials, 'same-origin');
      const res = await http(url);
      return { ok: res.statusCode === 200, status: res.statusCode, text: async () => res.body };
    };
    const client = browser.window.PinlaneApiClient;
    const all = await collect(base, url => client.request(url, {}, { getSessionToken: () => 'fixture-token' }));
    assert.equal(all.reservations.length, 701);
    assert.equal(calls, 2);
    browser.fetch = global.fetch;
  });
  await test('Real CSV export waits for every page and produces no partial download on failure', async () => {
    reset(Array.from({ length: 10021 }, (_, i) => fixture(i + 1)));
    const exports = [];
    const notices = [];
    const context = {
      window: browser.window, URL, console,
      document: { getElementById() { return null; } },
      state: { adminCenterId: 'libramont' }, apiRequest: request,
      toast: text => notices.push(text),
      capture: (filename, csv) => exports.push({ filename, csv }),
    };
    vm.createContext(context);
    // The raw export now includes the activity detail supplied by the shared
    // admin-console helper. Load that real dependency, as the browser does.
    const adminSource = fs.readFileSync(path.join(root, 'assets/admin-console.js'), 'utf8');
    const programExportStart = adminSource.indexOf('function getAdminProgramExportText(');
    const programExportEnd = adminSource.indexOf('function buildAdminExcelXml(', programExportStart);
    assert(programExportStart >= 0 && programExportEnd > programExportStart, 'Real program export helper is present');
    vm.runInContext(adminSource.slice(programExportStart, programExportEnd), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/admin-data.js'), 'utf8'), context);
    vm.runInContext("dhState.analytics = { startDate: '2023-01-01', endDate: '2026-12-31' }; dhDownload = capture;", context);
    await vm.runInContext("dhExportCsv('reservations-brutes')", context);
    assert.equal(exports.length, 1);
    assert.equal(exports[0].csv.split('\r\n').length, 10022);
    assert(exports[0].csv.includes('"2023-01-01"'));
    assert(exports[0].csv.includes('Détail des activités'));
    let calls = 0;
    context.apiRequest = async url => {
      if (++calls === 2) throw new Error('second-page-failed');
      return request(url);
    };
    await vm.runInContext("dhExportCsv('reservations-brutes')", context);
    assert.equal(exports.length, 1, 'No partial CSV on failed continuation');
    assert(notices.includes('second-page-failed'));
  });
  await test('Every browser admin-range call uses the complete-history collector', async () => {
    const inventory = browserSourceFiles().flatMap(file => findRangeCalls(fs.readFileSync(file, 'utf8'))
      .map(call => ({ file: path.relative(root, file).replaceAll(path.sep, '/'), ...call })));
    assert(inventory.length >= 6, 'Non-empty inventory includes all six known browser call sites');
    const direct = inventory.filter(call => !call.collected);
    console.log(JSON.stringify({ rangeCallers: inventory }));
    assert.deepEqual(direct, [], 'Direct one-page consumers remain');
    // Positive/negative controls for the source gate itself, including new files.
    const tick = String.fromCharCode(96);
    for (const expression of [
      'apiRequest(API_ENDPOINTS.adminRange)',
      'fetch("/api/admin-range?startDate=2026-09-12")',
      'window.PinlaneApiClient.request(' + tick + '/api/admin-range?centerId=libramont' + tick + ')',
      'apiRequest(\n' + tick + '${API_ENDPOINTS.adminRange}?startDate=2026-09-12' + tick + '\n)',
    ]) {
      const found = findRangeCalls(expression);
      assert.equal(found.length, 1);
      assert.equal(found[0].collected, false);
    }
    assert.equal(findRangeCalls('window.PinlaneApiClient.collectAdminRange("/api/admin-range", apiRequest)')[0].collected, true);
    assert.equal(findRangeCalls('apiRequest("/api/staff-state")').length, 0);
  });
  await test('Real loadAdminDashboard waits for page two, then caches/renders complete metrics', async () => {
    reset(dashboardFixtureRows());
    const h = dashboardHarness({ pauseSecond: true });
    const loading = h.context.loadAdminDashboard(true);
    try {
      await Promise.race([h.secondSeen.promise, loading]);
      assert.equal(h.calls.length, 2, 'Continuation must be requested');
      assert.equal(h.context.adminDashboardCache.loaded, false);
      assert.equal(Object.keys(h.context.adminSnapshotCache).length, 0, 'No first-page cache while loading');
      assert.equal(h.renders.length, 0, 'No first-page metrics rendered');
    } finally { h.resume.resolve(); await loading; }
    const payload = assertCompleteDashboard(h);
    assert.equal(h.renders.at(-1).metrics.revenue, 20000);
    const cached = Object.values(h.context.adminSnapshotCache);
    assert.equal(cached.length, 1);
    assert.equal(cached[0].snapshot.reservations.length, 701);
    await h.context.loadAdminDashboard(false);
    assert.equal(h.calls.length, 2, 'Cache hit reuses a COMPLETE snapshot');
    assertCompleteDashboard(h);
    console.log(JSON.stringify({ dashboardRows: payload.reservations.length, activeRows: payload.metrics.reservations, revenue: payload.metrics.revenue, pages: h.calls.length }));
  });
  await test('Dashboard failed continuation publishes no partial data; existing complete cache survives', async () => {
    reset(dashboardFixtureRows());
    const cold = dashboardHarness({ failSecond: true });
    await cold.context.loadAdminDashboard(true);
    assert.equal(cold.context.adminDashboardCache.loaded, false);
    assert.equal(Object.keys(cold.context.adminSnapshotCache).length, 0);
    assert.equal(cold.renders.length, 0);
    assert.match(cold.context.adminDashboardCache.error, /dashboard-second-page-failed/);
    const warm = dashboardHarness();
    await warm.context.loadAdminDashboard(true);
    const previous = warm.context.adminDashboardCache.snapshot;
    const originalRequest = warm.context.apiRequest;
    warm.context.apiRequest = url => new URL(url, 'http://localhost').searchParams.has('cursor')
      ? Promise.reject(new Error('warm-second-page-failed')) : originalRequest(url);
    await warm.context.loadAdminDashboard(true);
    assert.equal(warm.context.adminDashboardCache.snapshot, previous);
    assertCompleteDashboard(warm);
  });
  await test('Real prefetch waits for all pages before publishing each period cache', async () => {
    reset(dashboardFixtureRows());
    const h = dashboardHarness({ prefetch: true, pauseSecond: true });
    h.context.prefetchAdminPeriodSnapshots();
    await h.secondSeen.promise;
    assert.equal(Object.keys(h.context.adminSnapshotCache).length, 0);
    h.resume.resolve();
    await settlePrefetch(h);
    const entries = Object.values(h.context.adminSnapshotCache);
    assert(entries.length >= 2, 'Day and week prefetch are exercised');
    assert(entries.every(entry => entry.snapshot.reservations.length === 701));
    assert(entries.every(entry => entry.snapshot.pagination.hasMore === false));
    const failed = dashboardHarness({ prefetch: true, failSecond: true });
    failed.context.prefetchAdminPeriodSnapshots();
    await settlePrefetch(failed);
    assert.equal(Object.keys(failed.context.adminSnapshotCache).length, 0);
  });
  await test('Caller mutations in memory expose first-page-only dashboard and prefetch regressions', async () => {
    reset(dashboardFixtureRows());
    const dashboard = dashboardHarness({ mutation: 'loadAdminDashboard' });
    await dashboard.context.loadAdminDashboard(true);
    assert.equal(dashboard.context.adminDashboardCache.snapshot.reservations.length, 500);
    assert.equal(dashboard.context.getAdminExportPayload().metrics.revenue, 10000);
    assert.throws(() => assertCompleteDashboard(dashboard), /Dashboard must publish both pages/);
    const prefetch = dashboardHarness({ mutation: 'prefetchAdminPeriodSnapshots', prefetch: true });
    prefetch.context.prefetchAdminPeriodSnapshots();
    await settlePrefetch(prefetch);
    const entries = Object.values(prefetch.context.adminSnapshotCache);
    assert(entries.length >= 2);
    assert(entries.every(entry => entry.snapshot.reservations.length === 500));
    assert.throws(() => assert(entries.every(entry => entry.snapshot.reservations.length === 701)));
    console.log('COUNTERPROOF: one-page caller mutations produce 500 rows and 10000 EUR instead of 701 rows and 20000 EUR');
  });
  console.log(JSON.stringify({ cases: results.length, failures: results.filter(r => !r.ok).length, releases, network: 'blocked', database: 'synthetic SQL double' }));
  process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}
main().catch(error => { console.error(error.stack); process.exit(1); });
