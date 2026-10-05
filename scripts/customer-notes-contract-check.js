'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
let passed = 0;
function check(value, message) { assert.ok(value, message); passed += 1; console.log(`PASS ${message}`); }
async function rejected(fn, status, message) { await assert.rejects(fn, (e) => e.statusCode === status); passed += 1; console.log(`PASS ${message}`); }

const reservations = [
  { id: 1, center_id: 'a', phone: '+32 487 78 48 16', email: 'test@example.com', name: 'Same name' },
  { id: 2, center_id: 'a', phone: '+32487784816', email: 'test@example.com', name: 'Changed name' },
  { id: 3, center_id: 'b', phone: '+32487784816', email: 'test@example.com', name: 'Same name' },
  { id: 4, center_id: 'a', phone: '', email: ' Test@Example.Com ', name: 'Same name' },
  { id: 5, center_id: 'a', phone: '', email: '', name: 'Same name' },
];
let notes = new Map(); let revision = 0; let released = 0; const queries = []; let raced = false;
function key(center, phone) { return `${center}:${phone}`; }
async function query(sql, params = []) {
  queries.push({ sql, params });
  if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
  if (sql.includes('from reservations')) {
    const rows = sql.includes('any(') ? reservations.filter((r) => r.center_id === params[0] && params[1].includes(r.id)) : reservations.filter((r) => r.id === params[0] && r.center_id === params[1]);
    return { rows: structuredClone(rows) };
  }
  if (sql.startsWith('select') && sql.includes('from client_notes')) {
    const rows = sql.includes('any(') ? params[1].flatMap((p) => notes.has(key(params[0], p)) ? [{ client_key: p, ...notes.get(key(params[0], p)) }] : []) : notes.has(key(params[0], params[1])) ? [notes.get(key(params[0], params[1]))] : [];
    return { rows: structuredClone(rows) };
  }
  if (sql.startsWith('insert into client_notes')) {
    if (raced) { raced = false; return { rows: [] }; }
    const row = { body: params[2], updated_by: params[3], version: `2026-10-05 12:00:00.${String(++revision).padStart(6, '0')}+00` };
    notes.set(key(params[0], params[1]), row); return { rows: [row] };
  }
  if (sql.startsWith('update client_notes')) {
    for (const k of params[1]) if (notes.has(key(params[0], k))) notes.set(key(params[0], k), { body: params[2], version: params[3], updated_by: params[4] });
    return { rows: [] };
  }
  // Le registre des notes (migration 0053) : une ligne par version enregistree.
  if (sql.startsWith('insert into client_note_versions')) return { rows: [{ id: ++revision }] };
  // Le point de sauvegarde autour de la version (base pas encore migree toleree).
  if (/^(savepoint|release savepoint|rollback to savepoint) note_version;?$/.test(sql)) return { rows: [] };
  throw new Error(`Unhandled synthetic query: ${sql}`);
}
const pool = { query, connect: async () => ({ query, release() { released += 1; } }) };
// Replace only the pool factory before loading real business code: no network.
const database = require('../lib/database');
database.getPool = () => pool;
const { getCustomerNote, getCustomerNotes, saveCustomerNote, customerKey, phoneAliases } = require('../lib/customer-notes');

async function main() {
  check(customerKey(reservations[0]) === '+32487784816', 'CRM identity removes phone formatting');
  check(customerKey(reservations[3]) === 'test@example.com', 'email fallback is trimmed lowercase');
  check(customerKey(reservations[4]) === '', 'name-only identities never merge');
  check(customerKey({ phone: '+++++++123', email: 'broken' }) === '', 'invalid contacts cannot create persistent notes');
  const first = await getCustomerNote({ centerId: 'a', reservationId: 1 });
  check(first.eligible && first.note === null, 'initial customer note absent, eligible contact');
  let saved = await saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: null, body: 'Internal memory', updatedBy: 'Léa' });
  check(saved.note.body === 'Internal memory' && saved.note.updatedBy === 'Léa', 'persistent note returns trusted author and exact version');
  check((await getCustomerNote({ centerId: 'a', reservationId: 2 })).note.body === 'Internal memory', 'future reservation same center sees existing customer note');
  check((await getCustomerNote({ centerId: 'b', reservationId: 3 })).note === null, 'same customer contact another center is isolated');
  await rejected(() => getCustomerNote({ centerId: 'b', reservationId: 1 }), 404, 'cross-center reservation cannot resolve note');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 5, clientKey: '', baseUpdatedAt: null, body: 'x' }), 422, 'name-only persistence blocked');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: 'wrong', baseUpdatedAt: saved.note.updatedAt, body: 'x' }), 409, 'identity changed since reading blocked');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: null, body: 'overwrite' }), 409, 'stale initial creation cannot overwrite existing note');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, body: 'x' }), 422, 'version required');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: 'invalid', body: 'x' }), 422, 'invalid version rejected');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: saved.note.updatedAt, body: 'x'.repeat(4001) }), 422, 'overlong note rejected rather than silently truncated');
  const before = saved.note.updatedAt;
  saved = await saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: before, body: 'Edited', updatedBy: 'Sam' });
  check(saved.note.body === 'Edited' && saved.note.updatedBy === 'Sam' && saved.note.updatedAt !== before, 'editable persistent note updates author/version');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 2, clientKey: first.clientKey, baseUpdatedAt: before, body: 'Concurrent' }), 409, 'microsecond versions detect concurrent changes');
  raced = true;
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: saved.note.updatedAt, body: 'Race' }), 409, 'legacy CRM race cannot bypass conditional upsert');
  saved = await saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: saved.note.updatedAt, body: '' });
  check(saved.note.body === '' && saved.note.updatedAt, 'clearing preserves version tombstone');
  const offset = queries.length;
  const batch = await getCustomerNotes({ centerId: 'a', reservationIds: [1, 2, 3, 4, 5] });
  check(Object.keys(batch.notesByReservationId).length === 4 && !batch.notesByReservationId[3], 'batch omits cross-center reservation');
  check(batch.notesByReservationId[1].note.updatedAt === batch.notesByReservationId[2].note.updatedAt, 'batch same customer has consistent note');
  check(queries.length - offset === 2, 'batch bounded to two queries without per-booking requests');
  await rejected(() => getCustomerNotes({ centerId: 'a', reservationIds: Array(201).fill(1) }), 422, 'batch cap200 enforced');
  await rejected(() => getCustomerNotes({ centerId: 'a', reservationIds: ['1 OR true'] }), 422, 'invalid batch IDs blocked');
  check(queries.some((q) => q.sql.includes('for share')) && queries.some((q) => q.sql.includes('for update')) && queries.some((q) => q.sql.includes('pg_advisory_xact_lock')), 'contact and note held under transaction locks');
  check(released > 0 && queries.some((q) => q.sql === 'rollback'), 'transactions release connections on success and failure');

  let allowed = true; const authCalls = []; const audits = [];
  const auth = require('../lib/staff-auth');
  auth.requireStaffPermission = async (req, res, permission, scope) => { authCalls.push({ permission, scope }); if (!allowed) { res.statusCode = 403; res.end(JSON.stringify({ ok: false })); return null; } return { member: { name: 'Session author' } }; };
  const audit = require('../lib/audit-log'); audit.writeAuditLog = async (entry) => { audits.push(entry); return {}; };
  const endpoint = require('../api/staff-customer-notes');
  async function request(method, url, body) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); Object.assign(req, { method, url, headers: {} });
    const res = { setHeader() {}, end(value) { this.payload = JSON.parse(value); } };
    await endpoint(req, res); return res;
  }
  const response = await request('GET', '/api/staff-customer-notes?centerId=a&reservationId=1');
  check(response.statusCode === 200 && authCalls.at(-1).permission === 'reservations.view', 'GET requires real reservation-view permission');
  const edited = await request('PATCH', '/api/staff-customer-notes', { centerId: 'a', reservationId: 1, clientKey: first.clientKey, baseUpdatedAt: response.payload.note.updatedAt, body: 'Private' });
  check(edited.statusCode === 200 && edited.payload.note.updatedBy === 'Session author' && authCalls.at(-1).permission === 'clients.edit', 'PATCH author from session, clients.edit required');
  check(!JSON.stringify(audits).includes('Private') && !JSON.stringify(audits).includes(first.clientKey), 'audit contains no note or customer contact');
  allowed = false;
  check((await request('PATCH', '/api/staff-customer-notes', { centerId: 'a', reservationId: 1, body: 'Denied' })).statusCode === 403, 'denied staff cannot mutate note');
  allowed = true;
  check((await request('PATCH', '/api/staff-customer-notes', { centerId: 'a', reservationId: 1, body: 'x', updatedBy: 'Forged' })).statusCode === 422, 'forged author/unknown fields rejected');
  check((await request('GET', '/api/staff-customer-notes?centerId=all&reservationId=1')).statusCode === 422, 'global center forbidden');
  check((await request('DELETE', '/api/staff-customer-notes?centerId=a&reservationId=1')).statusCode === 405, 'no unversioned deletion endpoint');

  check(JSON.stringify(phoneAliases('0487784816')) === JSON.stringify(phoneAliases('+32487784816')) && JSON.stringify(phoneAliases('0032487784816')) === JSON.stringify(phoneAliases('+32487784816')), 'Belgian local/international variants share bounded phone-only aliases');
  check(phoneAliases('+33123456789').length === 1 && phoneAliases('bad@example.test').length === 1, 'non-Belgian contact and email never receive phone aliases');
  notes.delete(key('a', first.clientKey));
  notes.set(key('a', '0487784816'), { body: 'Historic local note', version: '2026-10-05 12:00:01.000001+00', updated_by: 'Historic author' });
  const historic = await getCustomerNote({ centerId: 'a', reservationId: 1 });
  check(historic.clientKey === '0487784816' && historic.note.body === 'Historic local note', 'international booking reuses existing local note identity');
  const aliasSaved = await saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: historic.clientKey, baseUpdatedAt: historic.note.updatedAt, body: 'Alias edited' });
  check(notes.has(key('a', '0487784816')) && !notes.has(key('a', first.clientKey)), 'alias edit reuses row instead of creating duplicate memory');
  notes.set(key('a', first.clientKey), { body: 'Conflict different content', version: '2026-10-05 12:00:02.000001+00', updated_by: 'Other' });
  const conflict = await getCustomerNote({ centerId: 'a', reservationId: 1 });
  check(!conflict.eligible && conflict.conflict && conflict.message && conflict.note === null, 'conflicting alias notes never silently merge or pick one');
  const conflictBatch = await getCustomerNotes({ centerId: 'a', reservationIds: [1, 2] });
  check(conflictBatch.notesByReservationId[1].conflict && conflictBatch.notesByReservationId[2].conflict, 'batch exposes same alias conflict');
  await rejected(() => saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: historic.clientKey, baseUpdatedAt: aliasSaved.note.updatedAt, body: 'Overwrite conflicting notes' }), 409, 'conflicting aliases block any overwrite');
  notes.set(key('a', first.clientKey), { ...notes.get(key('a', '0487784816')) });
  const equal = await getCustomerNote({ centerId: 'a', reservationId: 1 });
  await saveCustomerNote({ centerId: 'a', reservationId: 1, clientKey: equal.clientKey, baseUpdatedAt: equal.note.updatedAt, body: 'Both equal aliases edited' });
  check(notes.get(key('a', first.clientKey)).body === notes.get(key('a', '0487784816')).body && notes.get(key('a', first.clientKey)).version === notes.get(key('a', '0487784816')).version, 'identical historic aliases stay synchronized after edit under locks');
  const { getClientNote, saveClientNote } = require('../lib/ops-communications');
  const crmNote = await getClientNote('a', '0487784816', { query });
  check(crmNote.body === 'Both equal aliases edited' && crmNote.clientKey === first.clientKey, 'CRM reads same memory across national/international formats');
  const crmSaved = await saveClientNote('a', '0487784816', 'CRM edited memory', { query }, { baseUpdatedAt: crmNote.updatedAt, updatedBy: 'CRM staff' });
  check(crmSaved.note.body === 'CRM edited memory' && crmSaved.note.updatedBy === 'CRM staff' && notes.get(key('a', '0487784816')).body === 'CRM edited memory', 'CRM writes through same transactional alias/version writer');
  await rejected(() => saveClientNote('a', '0487784816', 'Stale CRM', { query }, { baseUpdatedAt: crmNote.updatedAt }), 409, 'stale CRM editor cannot overwrite newer shared note');
  await rejected(() => saveClientNote('a', '0487784816', 'Unversioned CRM', { query }), 422, 'old unversioned CRM request requires reload');

  // Execute the real atomic reservation-note function with a transactional fixture.
  const source = fs.readFileSync(path.join(__dirname, '../lib/database.js'), 'utf8');
  const start = source.indexOf('const NOTE_EQUIPE_TAG =');
  const end = source.indexOf('async function setReservationActivityProgress', start);
  let row = { id: 10, centerId: 'a', price: 39, opsPlan: { untouched: true }, notes: 'Client message\n[equipe] ' + JSON.stringify({ t: 'Before', par: 'Original author', le: '2026-10-05T12:00:00.000Z' }) };
  const context = { JSON, String, Number, Boolean, Date, Object, Error, stripUnsafeMarkup: (s) => s.replace(/<[^>]*>/g, ''), normalizeText: (s) => String(s || ''), mapReservation: (r) => r,
    withTransaction: async (fn) => fn({ query: async (sql, params) => sql.startsWith('select') ? { rowCount: 1, rows: [structuredClone(row)] } : (row = { ...row, notes: params[2] }, { rowCount: 1, rows: [row] }) }) };
  vm.createContext(context); vm.runInContext(source.slice(start, end) + '\nthis.edit = noterReservationEquipe;', context);
  const mutation = { modifier: { le: '2026-10-05T12:00:00.000Z', baseText: 'Before', texte: 'After' }, par: 'Editor' };
  const updated = await context.edit(10, 'a', mutation);
  const note = JSON.parse(updated.notes.split('\n')[1].slice('[equipe] '.length));
  check(note.t === 'After' && note.par === 'Original author' && note.le === mutation.modifier.le && note.modifiePar === 'Editor', 'reservation edit preserves original author/date, records editor');
  check(updated.notes.startsWith('Client message\n') && updated.price === 39 && updated.opsPlan.untouched, 'reservation edit preserves customer message, commercial fields and plan');
  await rejected(() => context.edit(10, 'a', mutation), 409, 'reservation note stale text conflict');
  await rejected(() => context.edit(10, 'a', { modifier: { ...mutation.modifier, le: 'missing' }, par: 'Editor' }), 409, 'deleted reservation note cannot be recreated by edit');
  await rejected(() => context.edit(10, 'a', { modifier: { ...mutation.modifier, baseText: 'After', texte: ' ' } }), 422, 'blank reservation note edit rejected');
  check(fs.readFileSync(path.join(__dirname, '../scripts/run-db-migrations.js'), 'utf8').includes("id: '0051_customer_note_author'"), 'additive author migration registered');
  console.log(`Customer notes: ${passed} assertions passed. No live database mutations.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
