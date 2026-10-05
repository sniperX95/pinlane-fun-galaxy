'use strict';
// Real served staff UI + real new customer-notes API; synthetic database only.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { Readable } = require('node:stream');
process.env.PINLANE_CAPACITY_PORT = process.env.PINLANE_NOTES_QA_PORT || '4797';
const { serveStatic, installMock } = require('./planning-capacity-ui-check');
const { chromium } = require('playwright-core');
const out = path.resolve(__dirname, '../tests/artifacts/staff-notes-scope'); fs.mkdirSync(out, { recursive: true });
let checks = 0, revision = 0, mode = '', delayedGetRelease = null, records = [], memory = new Map(); const failures = [], errors = [], requests = [];
const clone = (v) => structuredClone(v);
function check(value, name) { checks++; if (!value) failures.push(name); console.log((value ? 'PASS ' : 'FAIL ') + name); }
function seed() {
  const base = { name: 'QA Client', centerId: 'libramont', date: '2026-10-10', startTime: '14:00', duration: 1, totalDuration: 1, type: 'bowling', status: 'confirmed', pax: 4, lanes: [1], price: 39, basePrice: 39, updatedAt: '2026-10-05T10:00:00Z', phone: '+32487784816', email: 'client@example.test', notes: '', program: null, opsPlan: null };
  records = [{ ...base, id: 99101 }, { ...base, id: 99102, startTime: '16:00', phone: '0487 78 48 16', lanes: [2] }, { ...base, id: 99103, phone: '+32470000099', lanes: [3] }, { ...base, id: 99104, centerId: 'gembloux' }];
  memory = new Map(); revision = 0; mode = '';
}
async function query(sql, params = []) {
  if (['begin', 'commit', 'rollback'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
  if (sql.includes('from reservations')) return { rows: clone(sql.includes('any(') ? records.filter(r => r.centerId === params[0] && params[1].includes(r.id)) : records.filter(r => r.id === params[0] && r.centerId === params[1])) };
  if (sql.startsWith('select') && sql.includes('from client_notes')) {
    const keys = sql.includes('any(') ? params[1] : [params[1]];
    return { rows: clone(keys.flatMap(k => memory.has(params[0] + ':' + k) ? [{ client_key: k, ...memory.get(params[0] + ':' + k) }] : [])) };
  }
  if (sql.startsWith('insert into client_notes')) {
    const id = params[0] + ':' + params[1], old = memory.get(id);
    if (old && old.version !== params[4]) return { rows: [] };
    const row = { body: params[2], updated_by: params[3], version: `2026-10-05 12:00:00.${String(++revision).padStart(6, '0')}+00` }; memory.set(id, row); return { rows: [row] };
  }
  if (sql.startsWith('update client_notes')) { for (const k of params[1]) if (memory.has(params[0] + ':' + k)) memory.set(params[0] + ':' + k, { body: params[2], version: params[3], updated_by: params[4] }); return { rows: [] }; }
  throw new Error('Unknown synthetic notes query: ' + sql);
}
const database = require('../lib/database'); database.getPool = () => ({ query, connect: async () => ({ query, release() {} }) });
require('../lib/staff-auth').requireStaffPermission = async (req, res, permission, scope) => ({ centerId: scope.centerId, member: { id: 'qa', name: 'QA personnel' } });
require('../lib/audit-log').writeAuditLog = async () => ({ warning: null });
const handler = require('../api/staff-customer-notes');
async function notesRequest(input) {
  requests.push(clone(input));
  if (mode === 'loadfail' && input.method === 'GET') return { status: 503, payload: { ok: false, message: 'QA chargement indisponible' } };
  if (mode === 'savefail' && input.method === 'PATCH') return { status: 503, payload: { ok: false, message: 'QA sauvegarde indisponible' } };
  const req = Readable.from(input.body ? [input.body] : []); Object.assign(req, { method: input.method, url: input.url, headers: {} });
  const res = { setHeader() {}, end(data) { this.payload = JSON.parse(data); } }; await handler(req, res);
  if (mode === 'holdget' && input.method === 'GET') await new Promise(resolve => { delayedGetRelease = resolve; });
  return { status: res.statusCode, payload: res.payload };
}
// Existing reservation-note function is executed verbatim against a local transaction fixture.
const dbSource = fs.readFileSync(path.resolve(__dirname, '../lib/database.js'), 'utf8');
const context = { JSON, String, Number, Boolean, Object, Date, Error, stripUnsafeMarkup: s => s.replace(/<[^>]*>/g, ''), normalizeText: s => String(s || ''), mapReservation: r => r,
  withTransaction: async fn => fn({ query: async (sql, p) => { const index = records.findIndex(r => r.id === p[0] && r.centerId === p[1]); if (index < 0) return { rowCount: 0, rows: [] }; if (sql.startsWith('update')) records[index] = { ...records[index], notes: p[2], updatedAt: new Date().toISOString() }; return { rowCount: 1, rows: [clone(records[index])] }; } }) };
vm.createContext(context); vm.runInContext(dbSource.slice(dbSource.indexOf('const NOTE_EQUIPE_TAG ='), dbSource.indexOf('async function setReservationActivityProgress', dbSource.indexOf('const NOTE_EQUIPE_TAG ='))) + '\nthis.mutate = noterReservationEquipe;', context);
async function bookingRequest(input) {
  const body = JSON.parse(input.body); if (!body.noteEquipe) return { status: 422, payload: { ok: false, message: 'Notes-only fixture' } };
  try { return { status: 200, payload: { ok: true, reservation: await context.mutate(body.id, body.centerId, { ...body.noteEquipe, par: 'QA personnel' }) } }; }
  catch (e) { return { status: e.statusCode || 500, payload: { ok: false, message: e.message, ...(e.reservation ? { reservation: e.reservation, code: e.code } : {}) } }; }
}
async function configure(page, theme) {
  await page.evaluate(async theme => { await ensureStaffConsolesLoaded(); setView('staff'); while (staffCenterConfigCache.loading) await new Promise(r => setTimeout(r, 20)); await loadStaffCenterConfig(true); state.staffAuthSession.permissions.push('clients.edit'); state.currentDate = '2026-10-10'; state.adminCenterId = 'libramont'; state.reservations = await window.__notesRecords(); state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; state.staffTheme = theme; state.searchTerm = ''; renderStaff(); renderTable(); }, theme);
  await page.waitForTimeout(200);
}
async function open(page, id) { await page.evaluate(id => { closePos(); openPos(id); }, id); await page.waitForTimeout(150); }
async function add(page, id, text, scope = 'reservation') {
  const pane = page.locator('#posOverlay'), touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  await pane.locator('.gc-note-ouvrir')[touch ? 'tap' : 'click']();
  if (!await pane.locator(`input[value="${scope}"]`).isChecked()) await pane.locator(`label:has(input[value="${scope}"])`)[touch ? 'tap' : 'click']();
  await pane.locator('#gcNoteEquipe' + id).fill(text); await pane.locator('.gc-note-ajout .gc-note-ok')[touch ? 'tap' : 'click'](); await page.waitForTimeout(250);
}
(async () => {
  seed(); const server = await serveStatic(), browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    for (const width of [390, 834, 1440]) for (const theme of ['light', 'dark']) {
      seed(); const ctx = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 1100 }), page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await ctx.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
      await page.exposeFunction('__notesAPI', notesRequest); await page.exposeFunction('__notesBookingAPI', bookingRequest); await page.exposeFunction('__notesRecords', () => clone(records));
      await installMock(page);
      await page.addInitScript(() => { const old = window.fetch; window.fetch = async (input, init = {}) => { const u = new URL(typeof input === 'string' ? input : input.url, location.origin), method = init.method || 'GET';
        if (u.pathname === '/api/staff-customer-notes' || (u.pathname === '/api/staff-reservations' && method === 'PATCH')) { const r = await (u.pathname === '/api/staff-customer-notes' ? window.__notesAPI : window.__notesBookingAPI)({ url: u.pathname + u.search, method, body: init.body || '' }); return new Response(JSON.stringify(r.payload), { status: r.status, headers: { 'content-type': 'application/json' } }); }
        if (u.pathname === '/api/staff-state') { const rows = await window.__notesRecords(); return new Response(JSON.stringify({ ok: true, revision: JSON.stringify(rows), centerId: 'libramont', reservations: rows.filter(r => r.centerId === 'libramont'), laneStatuses: {} }), { headers: { 'content-type': 'application/json' } }); }
        if (u.pathname === '/api/staff-auth') { const r = await old(input, init), p = await r.json(); p.session.permissions.push('clients.edit'); return new Response(JSON.stringify(p), { headers: { 'content-type': 'application/json' } }); }
        return old(input, init); }; });
      await page.goto('http://127.0.0.1:' + process.env.PINLANE_CAPACITY_PORT + '/', { waitUntil: 'networkidle' }); await configure(page, theme); await open(page, 99101);
      const name = `${width}-${theme}`;
      check(await page.locator('#posOverlay .gc-note-ouvrir').isVisible(), name + ' note action available');
      await add(page, 99101, 'Réservation uniquement');
      check(records[0].notes.includes('Réservation uniquement') && !records[1].notes, name + ' reservation-only note remains on one booking');
      await open(page, 99102); check(!(await page.locator('#posOverlay').innerText()).includes('Réservation uniquement'), name + ' reservation note absent future booking');
      await open(page, 99101); await add(page, 99101, 'Mémoire client privée', 'client');
      check(memory.size === 1 && [...memory.values()][0].body === 'Mémoire client privée', name + ' permanent note genuinely persisted');
      check((await page.locator('#staffTableBox [data-res-row-id="99102"]').innerText()).includes('Mémoire client privée') && !(await page.locator('#staffTableBox [data-res-row-id="99103"]').innerText()).includes('Mémoire client privée'), name + ' batch planner markers follow matching customer only');
      await open(page, 99102); check((await page.locator('#posOverlay').innerText()).includes('Mémoire client privée'), name + ' Belgian national alias future booking inherits permanent note');
      await open(page, 99103); check(!(await page.locator('#posOverlay').innerText()).includes('Mémoire client privée'), name + ' different phone never inherits memory');
      const cross = await notesRequest({ method: 'GET', url: '/api/staff-customer-notes?centerId=gembloux&reservationId=99104' }); check(cross.payload.note === null, name + ' other center isolated');
      await open(page, 99101); await add(page, 99101, 'Complément', 'client');
      check([...memory.values()][0].body === 'Mémoire client privée\n\nComplément', name + ' append preserves existing note');
      await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill('Mémoire modifiée'); await page.locator('.staff-client-note-editor .gc-note-ok').click(); await page.waitForTimeout(200);
      check([...memory.values()][0].body === 'Mémoire modifiée', name + ' editing customer memory persists');
      await page.screenshot({ path: path.join(out, name + '-notes.png'), fullPage: true });
      check(await page.locator('#posOverlay .gc-notes').evaluate(e => e.scrollWidth <= e.clientWidth + 1), name + ' notes panel no horizontal overflow');
      if (width === 390 && theme === 'light') {
        await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill('Brouillon conservé'); mode = 'savefail'; await page.locator('.staff-client-note-editor .gc-note-ok').click(); await page.waitForTimeout(150);
        check(await page.locator('#staffClientNote99101').inputValue() === 'Brouillon conservé', '503 preserves customer edit draft'); check([...memory.values()][0].body === 'Mémoire modifiée', '503 leaves persisted memory unchanged'); mode = '';
        memory.get('libramont:+32487784816').body = 'Autre membre'; memory.get('libramont:+32487784816').version = '2026-10-05 12:00:02.000001+00';
        await page.locator('.staff-client-note-editor .gc-note-ok').click(); await page.waitForTimeout(150);
        check(await page.locator('#staffClientNote99101').inputValue() === 'Brouillon conservé', '409 preserves customer edit draft'); check([...memory.values()][0].body === 'Autre membre', '409 does not overwrite colleague memory');
        await page.locator('.staff-client-note-editor .gc-note-retirer').click(); await page.evaluate(() => PinlaneStaffNotes.reload(99101)); await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill(''); await page.locator('.staff-client-note-editor .gc-note-ok').click(); await page.waitForTimeout(150); check([...memory.values()][0].body === '', 'clear memory persists tombstone');
        await page.evaluate(() => PinlaneStaffNotes.invalidate()); mode = 'loadfail'; await page.evaluate(() => PinlaneStaffNotes.reload(99101)); await page.locator('#posOverlay .gc-note-ouvrir').click(); await page.locator('input[value="client"]').check(); await page.locator('#gcNoteEquipe99101').fill('Chargement échoué, texte gardé'); await page.locator('.gc-note-ajout .gc-note-ok').click(); await page.waitForTimeout(150);
        check(await page.locator('#gcNoteEquipe99101').inputValue() === 'Chargement échoué, texte gardé', 'load failure preserves add draft'); mode = '';
        await page.evaluate(() => { PinlaneStaffNotes.invalidate(); fermerNoteEquipe(99101); });
        await page.locator('#posOverlay .gc-note-equipe button').filter({ hasText: 'Modifier' }).click(); await page.locator('#gcNoteEquipe99101').fill('Note réservation modifiée'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
        check(records[0].notes.includes('Note réservation modifiée') && !records[0].notes.includes('Réservation uniquement'), 'keyboard atomic reservation note edit');
        await page.reload({ waitUntil: 'networkidle' }); await configure(page, theme); await open(page, 99101); check((await page.locator('#posOverlay').innerText()).includes('Note réservation modifiée'), 'fresh browser reload preserves reservation note edit');
        memory.get('libramont:+32487784816').body = 'Ancienne réponse GET'; memory.get('libramont:+32487784816').version = '2026-10-05 12:01:00.000001+00';
        await page.evaluate(() => PinlaneStaffNotes.reload(99101)); mode = 'holdget';
        await page.evaluate(() => { void PinlaneStaffNotes.reload(99101); });
        for (let i = 0; i < 20 && !delayedGetRelease; i++) await page.waitForTimeout(20);
        check(Boolean(delayedGetRelease), 'delayed old GET genuinely pending');
        await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill('Nouveau PATCH confirmé'); await page.locator('.staff-client-note-editor .gc-note-ok').click(); await page.waitForTimeout(150);
        mode = ''; delayedGetRelease?.(); delayedGetRelease = null; await page.waitForTimeout(150);
        check((await page.locator('#posOverlay').innerText()).includes('Nouveau PATCH confirmé') && !(await page.locator('#posOverlay .staff-client-note > p').innerText()).includes('Ancienne réponse GET'), 'late pre-PATCH GET never replaces confirmed memory');
        await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill('Ancien contact draft');
        const contactRequestCount = requests.filter(r => r.method === 'PATCH').length;
        await page.evaluate(async () => { const r = findStaffReservationById(99101); r.phone = '+32470000099'; renderPos(); await PinlaneStaffNotes.saveClient(99101); });
        check(requests.filter(r => r.method === 'PATCH').length === contactRequestCount && !await page.locator('#staffClientNote99101').count(), 'contact change discards stale editor and prevents wrong-client save');
        await page.evaluate(async () => { findStaffReservationById(99101).phone = '+32487784816'; PinlaneStaffNotes.invalidate(); await PinlaneStaffNotes.reload(99101); renderPos(); });
        await page.locator('#posOverlay .staff-client-note-head button').click(); await page.locator('#staffClientNote99101').fill('Permissions revoked draft');
        const deniedRequestCount = requests.filter(r => r.method === 'PATCH').length;
        const permissions = await page.evaluate(() => ({ permissions: [...state.staffAuthSession.permissions], role: { ...state.staffAuthSession.role } }));
        await page.evaluate(async () => { state.staffAuthSession.role.locked = false; state.staffAuthSession.permissions = state.staffAuthSession.permissions.filter(p => !['clients.edit', 'reservations.view'].includes(p)); renderPos(); await PinlaneStaffNotes.saveClient(99101); });
        check(requests.filter(r => r.method === 'PATCH').length === deniedRequestCount && await page.evaluate(() => !PinlaneStaffNotes.text(findStaffReservationById(99101))), 'role revoked hides cached memory and blocks stale editor save');
        await page.evaluate(saved => { state.staffAuthSession.permissions = saved.permissions; state.staffAuthSession.role = saved.role; renderPos(); }, permissions);
      }
      await page.evaluate(() => { closePos(); state.view = 'public'; }); const before = requests.length; await page.evaluate(() => PinlaneStaffNotes.ensure(state.reservations[0], true)); check(requests.length === before, name + ' public mode never requests private notes');
      await ctx.close();
    }
    check(errors.length === 0, 'no browser exceptions');
  } catch (e) { failures.push(e.stack); console.error(e.stack); }
  finally { fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ checks, failures, errors, requests, remoteWrites: 0 }, null, 2)); await browser.close(); server.close(); }
  if (failures.length) process.exitCode = 1; else console.log(`Staff notes scope: ${checks} assertions passed.`);
})();
