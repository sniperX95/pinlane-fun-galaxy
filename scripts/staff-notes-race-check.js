'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label); };
const row = { id: 12, centerId: 'libramont', phone: '+32470000001', email: '', status: 'pending' };
let center = 'libramont', permission = true, calls = 0, delayed, stored = { body: 'Original', updatedAt: 'v1' };
const context = vm.createContext({ window: {}, state: { view: 'staff' }, Map, Set, Date, Number, String, JSON, queueMicrotask,
  getCurrentStaffCenterId: () => center, canUseStaffPermission: () => permission,
  findStaffReservationById: () => row, escapeHtml: s => s.replaceAll('<', '&lt;'), formatNoteEquipeQuand: s => s,
  renderPos() {}, renderStaffData() {}, toast() {}, document: { getElementById() { return null; } },
  apiRequest: async (_, options) => {
    calls++;
    if (options?.method === 'PATCH') { stored = { body: JSON.parse(options.body).body, updatedAt: 'v2' }; return { ok: true, note: stored }; }
    if (delayed) return new Promise(resolve => { delayed.resolve = resolve; });
    return { eligible: true, clientKey: 'phone:+32470000001', note: stored };
  },
});
vm.runInContext(fs.readFileSync('assets/pinlane-staff-notes.js', 'utf8'), context);
const api = context.window.PinlaneStaffNotes;
(async () => {
  await api.ensure(row);
  delayed = {}; const oldRead = api.ensure(row, true);
  api.editClient(row.id); api.setDraft(row.id, 'New saved memory');
  check(await api.saveClient(row.id), 'new note confirmed while old GET pending');
  delayed.resolve({ eligible: true, clientKey: 'phone:+32470000001', note: { body: 'Old stale memory', updatedAt: 'v1' } });
  await oldRead; delayed = null;
  check(api.text(row) === 'New saved memory', 'late GET cannot overwrite newer PATCH');
  api.editClient(row.id); api.setDraft(row.id, 'Old client private draft'); row.phone = '+32470000002';
  check(!api.render(row).includes('Old client private draft'), 'changed contact hides old private draft');
  check(await api.saveClient(row.id) === false, 'changed contact cannot submit old client draft');
  await new Promise(resolve => setTimeout(resolve, 0));
  api.editClient(row.id); api.setDraft(row.id, 'Restricted draft'); permission = false;
  check(api.render(row) === '', 'revoked view permission hides client note and editor');
  check(api.text(row) === '', 'revoked view permission hides planning note preview');
  check(await api.saveClient(row.id) === false, 'revoked permission cannot save draft');
  permission = true; center = 'gembloux'; const before = calls;
  await api.ensure(row, true);
  check(calls === before, 'other center starts no request for old reservation');
  check(api.render(row) === '' && api.text(row) === '', 'other center reveals no cached note');
  console.log(`Staff notes races: ${checks} passed.`);
})().catch(error => { console.error(error); process.exit(1); });
