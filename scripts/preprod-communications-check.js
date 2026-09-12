'use strict';
// Real application modules, synthetic pg only. No dotenv, sockets or services.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const baseline = process.argv.includes('--baseline');
const baselineRef = '999963b8aa407382ecc3915f609c9b226095b676';
if (baseline) {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function(source, filename) {
    const rel = path.relative(path.resolve(__dirname, '..'), filename).split(path.sep).join('/');
    if (['lib/database.js', 'lib/ops-communications.js', 'lib/marketing-suppression.js'].includes(rel)) {
      source = execFileSync('git', ['show', `${baselineRef}:${rel}`], { encoding: 'utf8', windowsHide: true });
    }
    return compile.call(this, source, filename);
  };
}
for (const key of Object.keys(process.env)) {
  if (!/^(path|systemroot|windir|temp|tmp)$/i.test(key)) delete process.env[key];
}
process.env.DATABASE_URL = 'postgres://synthetic:synthetic@localhost:1/unused';
process.env.RESEND_API_KEY = 'synthetic-provider';
require('node:net').Socket.prototype.connect = () => { throw new Error('NETWORK_FORBIDDEN'); };
require('node:tls').connect = () => { throw new Error('NETWORK_FORBIDDEN'); };
for (const name of ['node:http', 'node:https']) {
  const mod = require(name);
  mod.request = mod.get = () => { throw new Error('NETWORK_FORBIDDEN'); };
}
const clone = value => JSON.parse(JSON.stringify(value));
const result = rows => ({ rows: clone(rows), rowCount: rows.length });
let rows, suppressed, calls, sends, lessons, afterClaim, beforeProvider, providerFailure, providerResponse, suppressionFailure, bookings, campaigns;
function reset() {
  rows = []; suppressed = new Set(); calls = []; sends = []; lessons = [];
  afterClaim = beforeProvider = null; providerFailure = suppressionFailure = false;
  providerResponse = null; process.env.RESEND_API_KEY = 'synthetic-provider';
  bookings = [{ id: 700, center_id: 'libramont', status: 'pending', validation_status: 'confirmed' },
    { id: 700, center_id: 'gembloux', status: 'pending', validation_status: 'confirmed' }];
  campaigns = [{ id: 7, center_id: 'libramont', status: 'sending' }];
}
reset();
const keyFor = row => `${row.center_id}:${row.recipient.toLowerCase()}`;
const marketing = row => Boolean(row.payload.unsubToken) || /^(campaign_|custom_)/.test(row.template_id)
  || ['birthday_j30', 'reactivation'].includes(row.template_id);
const committed = row => Boolean(row.payload.dispatchCommittedAt);
class FakePool {
  on() { return this; }
  async connect() { return { query: this.query.bind(this), release() {} }; }
  async query(sql, p = []) {
    const q = sql.trim(); calls.push({ sql: q, p: clone(p) });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(q) || q.includes('pg_advisory_xact_lock')) return result([]);
    if (q.includes('insert into marketing_suppressions')) {
      const k = `${p[0]}:${p[1]}`, existed = suppressed.has(k); suppressed.add(k);
      return result(existed ? [] : [{ id: 1 }]);
    }
    if (q.startsWith('select lower(email)')) {
      if (suppressionFailure) throw new Error('synthetic suppression outage');
      return result(p[1].filter(e => suppressed.has(`${p[0]}:${e}`)).map(email => ({ email })));
    }
    if (q.includes('insert into communications')) {
      const existing = rows.find(r => p[11] && r.idempotency_key === p[11]);
      if (existing) {
        if (q.includes('do nothing')) return result([]);
        if (q.includes("communications.status <> 'processing'") && (existing.status === 'processing' || committed(existing))) return result([]);
        if (!['sent', 'delivered'].includes(existing.status)) {
          Object.assign(existing, { recipient: p[5], subject: p[6], body: p[7], status: p[8], scheduled_at: p[9], payload: JSON.parse(p[10]) });
        }
        return result([existing]);
      }
      const row = { id: rows.length + 1, center_id: p[0], reservation_id: p[1], channel: p[2], direction: p[3],
        template_id: p[4], recipient: p[5], subject: p[6], body: p[7], status: p[8], scheduled_at: p[9],
        payload: JSON.parse(p[10]), idempotency_key: p[11], attempts: 0, max_attempts: 3, locked_at: null };
      rows.push(row); return result([row]);
    }
    if (q.includes('with due as')) {
      assert(q.includes('for update skip locked'));
      const due = rows.filter(r => (r.status === 'queued' || (r.status === 'processing' && r.locked_at && new Date(r.locked_at) < Date.now() - p[1] * 60000))
        && (!r.scheduled_at || new Date(r.scheduled_at) <= Date.now())
        && (!r.next_retry_at || new Date(r.next_retry_at) <= Date.now())
        && (!p[2] || r.center_id === p[2]) && (!p[3] || r.reservation_id === p[3])
        && (!p[5] || r.id === p[5]) && r.payload.simulation !== true).slice(0, p[0]);
      due.forEach(r => { r.status = 'processing'; r.locked_at = new Date().toISOString(); if (q.includes('dispatchOwner')) r.payload.dispatchOwner = p[4]; });
      return result(due);
    }
    if (q.includes('communication-dispatch-commit')) {
      assert(q.includes("status = 'processing'") && q.includes("payload->>'dispatchOwner' = $2"), 'commit requires current owner');
      assert(q.includes('not exists') && q.includes('marketing_suppressions'), 'suppression tested by conditional write');
      assert(q.includes('scheduled_at <= now()') && q.includes('next_retry_at <= now()'), 'commit checks due time');
      const row = rows.find(r => r.id === p[0]);
      if (suppressionFailure && row && marketing(row) && !committed(row)) throw new Error('synthetic suppression outage');
      if (!row || !p[1] || row.status !== 'processing' || row.payload.dispatchOwner !== p[1]) return result([]);
      if ((row.scheduled_at && new Date(row.scheduled_at) > Date.now()) || (row.next_retry_at && new Date(row.next_retry_at) > Date.now())) return result([]);
      if (!committed(row) && marketing(row) && suppressed.has(keyFor(row))) return result([]);
      row.payload.dispatchCommittedAt ||= new Date().toISOString();
      row.idempotency_key ||= `communication:${row.center_id}:${row.id}`;
      return result([row]);
    }
    if (q.startsWith('select') && q.includes('from reservations')) {
      assert(q.includes('for share'), 'booking decision is locked until the send commitment');
      return result(bookings.filter(r => r.id === p[0] && r.center_id === p[1]));
    }
    if (q.startsWith('select id from communications where template_id')) {
      assert(q.includes('for update') && q.includes('center_id = $2') && q.includes('dispatchCommittedAt'));
      return result(rows.filter(r => r.template_id === p[0] && r.center_id === p[1] && ['queued', 'processing'].includes(r.status) && !committed(r)));
    }
    if (q.startsWith('update campaigns')) {
      const campaign = campaigns.find(c => c.id === p[0] && c.center_id === p[1]);
      if (!campaign || !['draft', 'scheduled', 'sending'].includes(campaign.status) || (campaign.status !== 'draft' && !p[2])) return result([]);
      campaign.status = 'cancelled'; return result([campaign]);
    }
    if (q.startsWith('select') && q.includes('from communications')) {
      let found = rows;
      if (q.includes('idempotency_key = $1')) found = found.filter(r => r.idempotency_key === p[0]);
      else found = found.filter(r => r.id === p[0]);
      if (q.includes("direction = 'inbound'")) found = found.filter(r => r.direction === 'inbound');
      if (q.includes('center_id = $2')) found = found.filter(r => r.center_id === p[1]);
      if (q.includes('lower(recipient) = lower($3)')) found = found.filter(r => r.recipient.toLowerCase() === p[2].toLowerCase());
      return result(found);
    }
    if (q.includes("status = 'cancelled'") && q.startsWith('update communications')) {
      let eligible = rows.filter(r => ['draft', 'queued', 'processing'].includes(r.status));
      if (q.includes('where reservation_id = $1')) eligible = eligible.filter(r => r.reservation_id === p[0] && r.center_id === p[1]);
      else if (q.includes('where template_id = $1')) eligible = eligible.filter(r => r.template_id === p[0] && r.center_id === p[1] && p[2].includes(r.id));
      else eligible = eligible.filter(r => r.center_id === p[0] && r.recipient.toLowerCase() === p[1] && marketing(r));
      if (q.includes('dispatchCommittedAt')) eligible = eligible.filter(r => !committed(r));
      eligible.forEach(r => { r.status = 'cancelled'; r.locked_at = r.next_retry_at = null; }); return result(eligible);
    }
    if (q.includes('status = coalesce($2, status)')) {
      const row = rows.find(r => r.id === p[0]);
      if (!row) return result([]);
      if (q.includes("payload->>'dispatchOwner' = $8")) {
        if (!p[7] || row.status !== 'processing' || row.payload.dispatchOwner !== p[7]) return result([]);
        if (p[1] === 'sent' && !committed(row)) return result([]);
      }
      Object.assign(row, { status: p[1] || row.status, provider_message_id: p[2], last_error: p[4], next_retry_at: p[5], locked_at: null });
      row.attempts += p[3] || 0;
      if (p[1] === 'sent') row.sent_at = new Date().toISOString();
      if (p[8]) {
        delete row.payload.dispatchCommittedAt;
        if (q.includes('dispatchNotSentThroughAttempt')) row.payload.dispatchNotSentThroughAttempt = row.attempts;
      }
      return result([row]);
    }
    if (q.startsWith('update communications') && q.includes('payload = payload ||')) {
      const row = rows.find(r => r.id === p[0]);
      if (!row) return result([]);
      const patch = JSON.parse(p[1]);
      if (q.includes('sent.status')) {
        const sent = rows.find(r => r.id === p[4]);
        if (!sent || !['sent', 'delivered'].includes(sent.status) || sent.center_id !== p[2]) return result([]);
      }
      if (q.includes('center_id = $3') && row.center_id !== p[2]) return result([]);
      if (q.includes('replyCommunicationId') && row.payload.replyCommunicationId === patch.replyCommunicationId) return result([]);
      Object.assign(row.payload, patch); return result([row]);
    }
    if (q.includes('insert into email_agent_memory')) { lessons.push(p); return result([]); }
    if (q.includes('delete from email_agent_memory')) return result([]);
    throw new Error(`UNEXPECTED_SQL: ${q.slice(0, 180)}`);
  }
}
const originalLoad = Module._load;
Module._load = function(request, parent, main) {
  if (request === 'pg') return { Pool: FakePool };
  if (request === 'dotenv') throw new Error('ENV_FILE_FORBIDDEN');
  return originalLoad.call(this, request, parent, main);
};
global.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  sends.push({ body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
  if (beforeProvider) { const hook = beforeProvider; beforeProvider = null; await hook(); }
  if (providerFailure) throw new Error('synthetic provider response lost');
  if (providerResponse) return providerResponse;
  return { ok: true, json: async () => ({ id: `synthetic-${sends[0].key || 'none'}` }) };
};
const refusal = (status = 400, name = 'validation_error', extra = {}) => ({
  ok: false, status, json: async () => ({ name, message: 'Synthetic request rejected', ...extra }),
});
const db = require('../lib/database');
const actualList = db.listDueCommunications;
db.listDueCommunications = async args => {
  const due = await actualList(args);
  if (afterClaim) { const hook = afterClaim; afterClaim = null; await hook(due); }
  return due;
};
const comm = require('../lib/ops-communications');
const suppression = require('../lib/marketing-suppression');
async function queued(extra = {}) {
  return db.createCommunication({ centerId: 'libramont', reservationId: 700, channel: 'email', templateId: 'confirmation',
    recipient: 'fixture@example.org', subject: 'Fixture', body: '<p>Fixture</p>', payload: {}, ...extra });
}
async function inbound(extra = {}) {
  return queued({ direction: 'inbound', status: 'received', reservationId: null, templateId: 'inbound_email',
    payload: { textBody: 'Question factice', analysis: { intent: 'prix', reply: { subject: 'Proposition', body: 'Ancienne proposition' } } }, ...extra });
}
const direct = extra => comm.sendDirectEmail({ centerId: 'libramont', to: 'fixture@example.org', subject: 'Reponse', body: 'Nouvelle reponse corrigee par le staff.', attemptId: 'attempt-fixture-001', ...extra });
let failed = 0, passed = 0;
async function check(label, fn) {
  reset();
  try { await fn(); passed++; console.log(`PASS ${label}`); }
  catch (error) { failed++; console.error(`FAIL ${label}: ${error.stack}`); }
}
(async () => {
  // Historical comparison is additional evidence when history is available;
  // all current-code assertions run even in a shallow CI checkout.
  const hasBaseline = baseline || spawnSync('git', ['cat-file', '-e', `${baselineRef}^{commit}`], { windowsHide: true, stdio: 'ignore' }).status === 0;
  if (!baseline && hasBaseline) {
    const red = spawnSync(process.execPath, [__filename, '--baseline'], { encoding: 'utf8', windowsHide: true });
    const output = `${red.stdout || ''}${red.stderr || ''}`;
    assert.equal(red.status, 1, 'unchanged HEAD must fail the regression gate');
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C7']) assert(output.includes(`FAIL ${id}`), `${id} must be red on original HEAD`);
    assert(output.includes('PASS positive controls:'), 'baseline has a real positive control');
    console.log(`BASELINE RED ${output.match(/\{"passed":.*\}/)?.[0] || 'missing summary'}`);
  }
  await check('C7 cancellation after committed batch claim prevents provider and final overwrite', async () => {
    await queued(); let claim; afterClaim = due => { claim = due[0]; return db.cancelReservationCommunications({ reservationId: 700 }); };
    await comm.dispatchDueCommunications(); assert.equal(sends.length, 0); assert.equal(rows[0].status, 'cancelled');
    assert.equal(await db.updateCommunicationStatus(claim.id, { status: 'sent', dispatchOwner: claim.payload.dispatchOwner }), null);
    assert.equal(rows[0].status, 'cancelled');
  });
  await check('C7 engaged send is reported non-cancellable and finalizes with the same owner', async () => {
    await queued(); beforeProvider = async () => {
      assert(committed(rows[0])); assert.equal((await db.cancelReservationCommunications({ reservationId: 700 })).length, 0);
    };
    await comm.dispatchDueCommunications(); assert.equal(rows[0].status, 'sent'); assert(sends[0].key);
  });
  await check('C7 stale claim cannot engage or finalize after a replacement claim', async () => {
    await queued(); const old = (await actualList())[0]; rows[0].locked_at = new Date(Date.now() - 20 * 60000).toISOString();
    const fresh = (await actualList())[0]; assert(old.payload.dispatchOwner && old.payload.dispatchOwner !== fresh.payload.dispatchOwner);
    assert.equal(await db.updateCommunicationStatus(old.id, { engage: true, dispatchOwner: old.payload.dispatchOwner }), null);
    assert.equal(await db.updateCommunicationStatus(old.id, { status: 'sent', dispatchOwner: old.payload.dispatchOwner }), null);
    assert.equal(rows[0].status, 'processing');
  });
  await check('C7 a fresh claim is not reclaimed; missing ownership cannot authorize send', async () => {
    await queued(); const first = await actualList(); assert.equal((await actualList()).length, 0);
    assert.equal(await db.updateCommunicationStatus(first[0].id, { engage: true }), null);
  });
  await check('C1 suppression after scheduling cancels marketing only in its centre', async () => {
    for (const templateId of ['campaign_7', 'birthday_j30', 'reactivation', 'custom_weekly']) await queued({ templateId });
    await queued(); await queued({ templateId: 'campaign_8', centerId: 'gembloux' });
    await suppression.suppressEmail({ centerId: 'libramont', email: 'FIXTURE@example.org' });
    assert(rows.slice(0, 4).every(r => r.status === 'cancelled'));
    await comm.dispatchDueCommunications(); assert.equal(sends.length, 2);
    assert(rows.slice(4).every(r => r.status === 'sent'));
  });
  await check('C1 suppression after batch claim prevents the pending provider call', async () => {
    await queued({ templateId: 'campaign_7' }); afterClaim = () => suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    await comm.dispatchDueCommunications(); assert.equal(sends.length, 0); assert.equal(rows[0].status, 'cancelled');
  });
  await check('C1 commit rechecks suppression even for messages queued after withdrawal', async () => {
    suppressed.add('libramont:fixture@example.org'); await queued({ templateId: 'campaign_7' });
    await comm.dispatchDueCommunications(); assert.equal(sends.length, 0); assert.equal(rows[0].status, 'cancelled');
  });
  await check('C1 unreadable suppression fails closed and leaves a retry', async () => {
    suppressionFailure = true; await queued({ templateId: 'campaign_7' }); await comm.dispatchDueCommunications();
    assert.equal(sends.length, 0); assert.equal(rows[0].status, 'queued'); assert(rows[0].next_retry_at);
  });
  await check('C1 suppression and dispatch share transaction lock before deciding', async () => {
    await queued({ templateId: 'campaign_7' }); await comm.dispatchDueCommunications();
    await suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    const locks = calls.filter(c => c.sql.includes('pg_advisory_xact_lock'));
    assert.equal(locks.length, 2); assert.deepEqual(locks[0].p, locks[1].p);
    assert(calls.filter(c => c.sql === 'BEGIN').length >= 3);
  });
  await check('C2 repeated attempt retains one row, provider key, original scheduled time and content', async () => {
    const one = await direct({}); const two = await direct({});
    assert.equal(one.communication.id, two.communication.id); assert.equal(rows.length, 1); assert.equal(sends.length, 1); assert(sends[0].key);
    await assert.rejects(direct({ body: 'Changed content' }), e => e.statusCode === 409);
    assert.equal(rows.length, 1); await direct({ attemptId: 'attempt-fixture-002' }); assert.equal(rows.length, 2);
  });
  await check('C2 queued retry does not unclaim or mutate a processing row', async () => {
    const at = new Date(Date.now() + 86400000).toISOString(); await direct({ scheduledAt: at });
    rows[0].scheduled_at = new Date(Date.now() - 1000).toISOString(); const claimed = (await actualList())[0];
    await direct({ scheduledAt: at }); assert.equal(rows[0].status, 'processing');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.dispatchOwner, claimed.payload.dispatchOwner);
  });
  await check('C2 attempt scope separates centres and excludes malformed keys', async () => {
    await direct({}); await direct({ centerId: 'gembloux' }); assert.equal(rows.length, 2); assert.notEqual(sends[0].key, sends[1].key);
    await assert.rejects(direct({ attemptId: 'bad key' })); assert.equal(rows.length, 2);
  });
  await check('C2 concurrent replay and cancelled replay never create or revive a second row', async () => {
    await Promise.all([direct({}), direct({})]); assert.equal(rows.length, 1); assert.equal(sends.length, 1);
    reset(); const at = new Date(Date.now() + 86400000).toISOString(); await direct({ scheduledAt: at });
    rows[0].status = 'cancelled'; await direct({ scheduledAt: at }); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'cancelled');
  });
  await check('C3 foreign/missing/outbound/wrong-recipient references reject before enqueue or learning', async () => {
    await inbound({ centerId: 'gembloux' }); await inbound({ recipient: 'other@example.org' }); await queued();
    for (const id of [1, 2, 3, 999, 'invalid', -1]) {
      const before = rows.length; await assert.rejects(direct({ replyToCommunicationId: id })); assert.equal(rows.length, before);
    }
    assert.equal(sends.length, 0); assert.equal(lessons.length, 0); assert(rows.every(r => !r.payload.repliedAt));
  });
  await check('C4 scheduled reply remains unanswered, then sent reply marks and learns exactly once', async () => {
    const incoming = await inbound(); const at = new Date(Date.now() + 86400000).toISOString();
    await direct({ replyToCommunicationId: incoming.id, scheduledAt: at });
    assert(!rows[0].payload.repliedAt); assert.equal(lessons.length, 0); assert.equal(sends.length, 0);
    rows[1].scheduled_at = new Date(Date.now() - 1000).toISOString(); await comm.dispatchDueCommunications();
    assert.equal(rows[1].status, 'sent'); assert(rows[0].payload.repliedAt); assert.equal(lessons.length, 1);
    await direct({ replyToCommunicationId: incoming.id, scheduledAt: at }); assert.equal(lessons.length, 1); assert.equal(sends.length, 1);
    const link = calls.find(c => c.sql.startsWith('update communications') && c.sql.includes('payload = payload ||'));
    assert(link.sql.includes('center_id = $3') && link.sql.includes("direction = 'inbound'"));
  });
  await check('C4 failed send has no learning, retry preserves provider identity and learns on sent', async () => {
    const incoming = await inbound(); providerFailure = true; await direct({ replyToCommunicationId: incoming.id });
    assert(!rows[0].payload.repliedAt); assert.equal(lessons.length, 0); assert.equal(rows[1].status, 'queued');
    providerFailure = false; rows[1].next_retry_at = null; await comm.dispatchDueCommunications();
    assert.equal(rows[1].status, 'sent'); assert.equal(lessons.length, 1); assert.equal(sends[0].key, sends[1].key);
  });
  await check('C4 cancelled scheduled reply never marks inbound or learns', async () => {
    const incoming = await inbound(); await direct({ replyToCommunicationId: incoming.id, scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    rows[1].status = 'cancelled'; rows[1].scheduled_at = null; await comm.dispatchDueCommunications();
    assert(!rows[0].payload.repliedAt); assert.equal(lessons.length, 0); assert.equal(sends.length, 0);
  });
  await check('C7 stale job snapshot enqueued AFTER cancellation cannot send confirmation', async () => {
    bookings[0].status = 'cancelled';
    assert.equal((await db.cancelReservationCommunications({ reservationId: 700 })).length, 0);
    const snapshot = { id: 700, centerId: 'libramont', status: 'pending', validationStatus: 'confirmed',
      name: 'Fixture', email: 'fixture@example.org', date: '2026-10-20', startTime: '15:00', type: 'bowling', people: 4, totalDuration: 1 };
    await comm.enqueueReservationCommunications(snapshot, { deps: { query: async () => ({ rows: [] }) } });
    assert(rows.some(r => r.template_id === 'confirmation'), 'real enqueue from stale job snapshot');
    await comm.dispatchDueCommunications(); assert.equal(sends.length, 0);
    assert.equal(rows.find(r => r.template_id === 'confirmation').status, 'cancelled');
  });
  await check('C7 current reservation validation blocks obsolete confirmation but keeps cancellation mail', async () => {
    bookings[0].validation_status = 'staff_review'; await queued(); await queued({ templateId: 'request_received' });
    await queued({ templateId: 'client_cancellation' }); await comm.dispatchDueCommunications();
    assert.equal(rows[0].status, 'cancelled'); assert(rows.slice(1).every(r => r.status === 'sent')); assert.equal(sends.length, 2);
  });
  await check('C7 rejected or missing reservation blocks only reservation-dependent templates', async () => {
    bookings[0].validation_status = 'rejected'; await queued({ templateId: 'reminder_48h' });
    await queued({ templateId: 'post_visit_followup', reservationId: 999 }); await queued({ templateId: 'client_cancellation' });
    await comm.dispatchDueCommunications(); assert(rows.slice(0, 2).every(r => r.status === 'cancelled')); assert.equal(rows[2].status, 'sent');
  });
  await check('C7 crash after commitment can be reclaimed without a new provider identity', async () => {
    await queued(); const old = (await actualList())[0];
    const engaged = await db.updateCommunicationStatus(old.id, { engage: true, dispatchOwner: old.payload.dispatchOwner });
    assert(engaged.idempotencyKey); rows[0].locked_at = new Date(Date.now() - 20 * 60000).toISOString();
    await comm.dispatchDueCommunications(); assert.equal(rows[0].status, 'sent'); assert.equal(sends[0].key, engaged.idempotencyKey);
    assert.equal(await db.updateCommunicationStatus(old.id, { status: 'failed', dispatchOwner: old.payload.dispatchOwner }), null);
    assert.equal(rows[0].status, 'sent');
  });
  await check('C1 engaged retry after withdrawal reconciles its original provider identity', async () => {
    await queued({ templateId: 'campaign_7' }); providerFailure = true; await comm.dispatchDueCommunications();
    assert(committed(rows[0])); assert.equal(rows[0].status, 'queued');
    await suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    assert.equal(rows[0].status, 'queued'); providerFailure = false; rows[0].next_retry_at = null;
    await comm.dispatchDueCommunications(); assert.equal(rows[0].status, 'sent'); assert.equal(sends[0].key, sends[1].key);
  });
  await check('C1 known first Resend validation refusal restores marketing cancellation', async () => {
    await queued({ templateId: 'campaign_7' }); providerResponse = refusal();
    const dispatched = await comm.dispatchDueCommunications();
    assert.equal(dispatched.ok, false); assert.equal(dispatched.retried, 1); assert.equal(dispatched.failed, 0);
    assert.equal(rows[0].status, 'queued'); assert.equal(rows[0].attempts, 1); assert(!committed(rows[0]));
    assert.equal(rows[0].idempotency_key, sends[0].key);
    await suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    providerResponse = null; await comm.dispatchDueCommunications();
    assert.equal(rows[0].status, 'cancelled'); assert.equal(sends.length, 1);
  });
  await check('C7 known first refusal makes the campaign cancellable without changing provider identity', async () => {
    await queued({ templateId: 'campaign_7' }); providerResponse = refusal(400, 'validation_error', { statusCode: 400 });
    await comm.dispatchDueCommunications();
    const cancelled = await db.cancelCampaignRow({ id: 7, centerId: 'libramont' });
    assert.equal(cancelled.cancelledCommunications, 1); assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[0].idempotency_key, sends[0].key); assert.equal(sends.length, 1);
  });
  await check('C1 withdrawal during a known refusal is enforced on the next commitment', async () => {
    await queued({ templateId: 'campaign_7' }); providerResponse = refusal();
    beforeProvider = () => suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    await comm.dispatchDueCommunications(); assert(!committed(rows[0]));
    rows[0].next_retry_at = null; providerResponse = null; await comm.dispatchDueCommunications();
    assert.equal(rows[0].status, 'cancelled'); assert.equal(sends.length, 1);
  });
  await check('C4 repeated proven refusals preserve request bytes and learn only after sent', async () => {
    const incoming = await inbound(); providerResponse = refusal(); await direct({ replyToCommunicationId: incoming.id });
    assert(!committed(rows[1])); assert.equal(rows[1].payload.dispatchNotSentThroughAttempt, 1);
    rows[1].next_retry_at = null; await comm.dispatchDueCommunications();
    assert(!committed(rows[1])); assert.equal(rows[1].payload.dispatchNotSentThroughAttempt, 2);
    assert(!rows[0].payload.repliedAt); assert.equal(lessons.length, 0);
    rows[1].next_retry_at = null; providerResponse = null; await comm.dispatchDueCommunications();
    assert.equal(rows[1].status, 'sent'); assert.equal(lessons.length, 1); assert(rows[0].payload.repliedAt);
    assert.equal(sends.length, 3); assert.deepEqual(sends[1], sends[0]); assert.deepEqual(sends[2], sends[0]);
  });
  for (const [label, response] of [
    ['timeout', null], ['500', refusal(500)], ['503', refusal(503)],
    ['409 concurrent', refusal(409, 'concurrent_idempotent_requests')],
    ['409 changed payload', refusal(409, 'invalid_idempotent_request')],
    ['unknown 400', refusal(400, 'unknown_error')], ['untyped 400', refusal(400, '')],
    ['malformed 400', { ok: false, status: 400, json: async () => { throw new Error('invalid JSON'); } }],
    ['contradictory status', refusal(400, 'validation_error', { statusCode: 500 })],
    ['contradictory accepted ID', refusal(400, 'validation_error', { id: 'provider-may-have-accepted' })],
    ['unclassified 403', refusal(403)], ['unclassified 429', refusal(429, 'rate_limit_exceeded')],
  ]) {
    await check(`C1 ambiguous ${label} remains engaged even after a later known refusal`, async () => {
      await queued({ templateId: 'campaign_7' }); providerFailure = !response; providerResponse = response;
      await comm.dispatchDueCommunications(); assert(committed(rows[0]));
      await suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
      await assert.rejects(db.cancelCampaignRow({ id: 7, centerId: 'libramont' }));
      providerFailure = false; providerResponse = refusal(); rows[0].next_retry_at = null;
      await comm.dispatchDueCommunications(); assert(committed(rows[0])); assert.equal(rows[0].status, 'queued');
      assert.deepEqual(sends[1], sends[0]);
      assert.notEqual(rows[0].payload.dispatchNotSentThroughAttempt, rows[0].attempts);
    });
  }
  await check('C7 crash after commitment cannot be cleared by a validation refusal', async () => {
    await queued({ templateId: 'campaign_7' }); const old = (await actualList())[0];
    await db.updateCommunicationStatus(old.id, { engage: true, dispatchOwner: old.payload.dispatchOwner });
    rows[0].locked_at = new Date(Date.now() - 20 * 60000).toISOString(); providerResponse = refusal();
    await comm.dispatchDueCommunications(); assert(committed(rows[0])); assert.equal(rows[0].status, 'queued');
    assert.equal(sends[0].key, rows[0].idempotency_key);
  });
  await check('C1 an older refusal proof cannot erase a later timeout', async () => {
    await queued({ templateId: 'campaign_7' }); providerResponse = refusal(); await comm.dispatchDueCommunications();
    assert.equal(rows[0].payload.dispatchNotSentThroughAttempt, 1); assert(!committed(rows[0]));
    providerFailure = true; rows[0].next_retry_at = null; await comm.dispatchDueCommunications();
    assert(committed(rows[0])); assert.equal(rows[0].payload.dispatchNotSentThroughAttempt, 1);
    providerFailure = false; rows[0].next_retry_at = null; const terminal = await comm.dispatchDueCommunications();
    assert(committed(rows[0])); assert.equal(rows[0].status, 'failed');
    assert.equal(terminal.failed, 1); assert.equal(terminal.ok, false); assert.deepEqual(sends[2], sends[0]);
    assert.equal(rows[0].payload.dispatchNotSentThroughAttempt, 1);
  });
  await check('C7 stale refusal cannot release or finalize a replacement claim', async () => {
    await queued({ templateId: 'campaign_7' }); let fresh;
    beforeProvider = async () => {
      rows[0].locked_at = new Date(Date.now() - 20 * 60000).toISOString(); fresh = (await actualList())[0];
      await db.updateCommunicationStatus(fresh.id, { engage: true, dispatchOwner: fresh.payload.dispatchOwner });
    };
    providerResponse = refusal(); await comm.dispatchDueCommunications();
    assert.equal(rows[0].status, 'processing'); assert(committed(rows[0]));
    assert.equal(rows[0].payload.dispatchOwner, fresh.payload.dispatchOwner); assert.equal(rows[0].attempts, 0);
  });
  await check('C1 missing provider config never clears an earlier ambiguous commitment', async () => {
    await queued({ templateId: 'campaign_7' }); providerFailure = true; await comm.dispatchDueCommunications();
    delete process.env.RESEND_API_KEY; rows[0].next_retry_at = null; await comm.dispatchDueCommunications();
    assert(committed(rows[0])); assert.equal(rows[0].status, 'queued'); assert.equal(sends.length, 1);
    await suppression.suppressEmail({ centerId: 'libramont', email: 'fixture@example.org' });
    assert.equal(rows[0].status, 'queued');
  });
  await check('C7 historical attempts without durable non-acceptance proof remain conservative', async () => {
    await queued({ templateId: 'campaign_7' }); rows[0].attempts = 1; providerResponse = refusal();
    await comm.dispatchDueCommunications(); assert(committed(rows[0])); assert.equal(rows[0].status, 'queued');
    await assert.rejects(db.cancelCampaignRow({ id: 7, centerId: 'libramont' }));
  });
  await check('C1 a local unroutable skip cannot clear a recovered commitment', async () => {
    await queued({ recipient: 'fixture@example.invalid' }); const claim = (await actualList())[0];
    await db.updateCommunicationStatus(claim.id, { engage: true, dispatchOwner: claim.payload.dispatchOwner });
    rows[0].locked_at = new Date(Date.now() - 20 * 60000).toISOString(); await comm.dispatchDueCommunications();
    assert(committed(rows[0])); assert.equal(rows[0].status, 'queued'); assert.equal(sends.length, 0);
  });
  await check('C4 unchanged answer marks sent without manufacturing an agent lesson', async () => {
    const incoming = await inbound(); await direct({ replyToCommunicationId: incoming.id, subject: 'Proposition', body: 'Ancienne proposition' });
    assert(rows[0].payload.repliedAt); assert.equal(rows[1].status, 'sent'); assert.equal(lessons.length, 0);
  });
  await check('C7 generic refresh preserves processing owner and can regenerate a cancelled uncommitted row', async () => {
    await queued({ idempotencyKey: 'reservation:700:confirmation:email' }); const old = (await actualList())[0];
    await queued({ idempotencyKey: old.idempotencyKey, body: 'changed' }); assert.equal(rows[0].body, '<p>Fixture</p>');
    assert.equal(rows[0].payload.dispatchOwner, old.payload.dispatchOwner); assert.equal(rows.length, 1);
    await db.cancelReservationCommunications({ reservationId: 700 });
    await queued({ idempotencyKey: old.idempotencyKey, body: 'changed' }); assert.equal(rows[0].body, 'changed');
    const fresh = (await actualList())[0]; assert.notEqual(fresh.payload.dispatchOwner, old.payload.dispatchOwner);
    assert.equal(await db.updateCommunicationStatus(old.id, { status: 'sent', dispatchOwner: old.payload.dispatchOwner }), null);
  });
  await check('C7 campaign cancellation stops queued and claimed messages in its centre only', async () => {
    await queued({ templateId: 'campaign_7' }); await queued({ templateId: 'campaign_7' });
    await queued({ templateId: 'campaign_7', centerId: 'gembloux' });
    await actualList({ limit: 1 }); const cancelled = await db.cancelCampaignRow({ id: 7, centerId: 'libramont' });
    assert.equal(cancelled.cancelledCommunications, 2); assert(rows.slice(0, 2).every(r => r.status === 'cancelled'));
    assert.equal(rows[2].status, 'queued');
  });
  await check('C7 campaign cancellation excludes a committed send and refuses empty success', async () => {
    await queued({ templateId: 'campaign_7' }); const claim = (await actualList())[0];
    await db.updateCommunicationStatus(claim.id, { engage: true, dispatchOwner: claim.payload.dispatchOwner });
    await assert.rejects(db.cancelCampaignRow({ id: 7, centerId: 'libramont' })); assert.equal(rows[0].status, 'processing');
    await queued({ templateId: 'campaign_7' }); const cancelled = await db.cancelCampaignRow({ id: 7, centerId: 'libramont' });
    assert.equal(cancelled.cancelledCommunications, 1); assert.equal(rows[0].status, 'processing');
  });
  await check('dispatch failure/retry makes ok false; terminal failure stays visible', async () => {
    await queued(); providerFailure = true; const retry = await comm.dispatchDueCommunications();
    assert.equal(retry.ok, false); assert.equal(retry.retried, 1); assert.equal(retry.failed, 0);
    rows[0].attempts = 2; rows[0].next_retry_at = null; const fail = await comm.dispatchDueCommunications();
    assert.equal(fail.ok, false); assert.equal(fail.failed, 1); assert.equal(rows[0].status, 'failed');
  });
  await check('positive controls: due-time, simulation, reserved recipient, unconfigured provider', async () => {
    await queued({ scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    await queued({ payload: { simulation: true } }); await queued({ recipient: 'fixture@example.invalid' });
    await comm.dispatchDueCommunications(); assert.equal(rows[0].status, 'queued'); assert.equal(rows[1].status, 'draft');
    assert.equal(rows[2].status, 'cancelled'); assert.equal(sends.length, 0);
    delete process.env.RESEND_API_KEY; await queued(); await comm.dispatchDueCommunications();
    assert.equal(rows[3].status, 'queued'); assert(!committed(rows[3])); process.env.RESEND_API_KEY = 'synthetic-provider';
  });
  console.log(JSON.stringify({ passed, failed, realModules: true, database: 'synthetic pg only', network: 'forbidden' }));
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
