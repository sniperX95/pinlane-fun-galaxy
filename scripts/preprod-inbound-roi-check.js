'use strict';
// Run only through artifacts/preprod-fixes-20260912/run-isolated.cjs.
// Real ingestion, webhook, ROI and database insertion; synthetic pg driver.
// The SQL interpreter below is deliberately bounded, NOT PostgreSQL execution.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
assert(!fs.existsSync(path.resolve(__dirname, '../.env')), 'isolated copy required');
assert(!process.env.DATABASE_URL, 'runner must remove inherited database credentials');
const noNetwork = () => { throw new Error('Network forbidden in inbound/ROI gate'); };
global.fetch = noNetwork;
require('node:net').Socket.prototype.connect = noNetwork;
require('node:tls').connect = noNetwork;
require('node:http').request = noNetwork;
require('node:https').request = noNetwork;
const actualLoad = Module._load;
let poolQuery = async () => ({ rows: [] });
Module._load = function (id, parent, main) {
  if (id === 'dotenv' || id.startsWith('dotenv/')) throw new Error('dotenv forbidden');
  if (id === 'pg') return { Pool: class {
    query(sql, params) { return poolQuery(sql, params); }
    on() { return this; }
    connect() { return noNetwork(); }
  } };
  return actualLoad.call(this, id, parent, main);
};
// Fictitious URL, only consumed by the fake driver above; never a connection.
process.env.DATABASE_URL = 'postgres://localhost:1/isolated_gate';
const { ingestInboundEmail } = require('../lib/email-agent');
const { createHandler } = require('../api/inbound-email');
const { computeMarketingRoi, attributedRevenueByTrigger, MARKETING_SOURCES } = require('../lib/marketing-roi');
const { buildPatternRows, aggregateMarketingPatterns } = require('../lib/center-metrics');
const { buildMarketingBriefBundle } = require('../lib/marketing-brief');
const { answerMarketingQuestion, buildAskDossier } = require('../lib/marketing-ask');
const { SIMULATION_CHANNELS } = require('../lib/simulation-filter');
const NOW = Date.parse('2026-09-12T10:00:00Z');
const DAY = 86400000;
const iso = (days) => new Date(NOW + days * DAY).toISOString();
let passed = 0;
let failed = 0;
async function check(name, run) {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

function inbox() {
  const rows = [];
  let failLookup = false;
  const query = async (text, params = []) => {
    const sql = String(text).trim();
    if (sql.startsWith('select id from communications') && sql.includes('idempotency_key = $2')) {
      if (failLookup) throw new Error('synthetic lookup failure');
      return { rows: rows.filter(r => r.center_id === params[0] && r.idempotency_key === params[1]) };
    }
    if (sql.startsWith('insert into communications')) {
      assert(sql.includes('on conflict (idempotency_key)'), 'exercise real database insertion');
      const row = { id: rows.length + 1, center_id: params[0], direction: params[3],
        recipient: params[5], subject: params[6], body: params[7], status: params[8],
        payload: JSON.parse(params[10]), idempotency_key: params[11] };
      const prior = rows.find(r => r.idempotency_key === row.idempotency_key);
      if (prior) Object.assign(prior, { recipient: row.recipient, subject: row.subject, body: row.body, payload: row.payload });
      else rows.push(row);
      return { rows: [prior || row] };
    }
    // No client/history, no overrides: real rule-based analysis, no LLM.
    return { rows: [] };
  };
  poolQuery = query;
  const ingest = (input) => ingestInboundEmail({ centerId: 'libramont', from: 'sender@example.test',
    subject: 'Ma demande', body: 'Je souhaite reserver.', receivedAt: '2026-09-12T10:00:05Z',
    ...input, deps: { query }, fetchImpl: noNetwork });
  return { rows, ingest, failLookup() { failLookup = true; } };
}

async function webhook(store, data, eventId = 'event-one') {
  const secret = Buffer.from('synthetic-signature-key');
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${secret.toString('base64')}`;
  const raw = JSON.stringify({ type: 'email.received', data: { from: 'sender@example.test',
    to: ['libramont@example.test'], subject: 'Ma demande', ...data } });
  const stamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${eventId}.${stamp}.${raw}`).digest('base64');
  const handler = createHandler({ ingest: store.ingest,
    recupererContenu: async () => ({ text: 'Je souhaite reserver.' }) });
  const req = Object.assign(Readable.from([raw]), { method: 'POST', url: '/api/inbound-email',
    headers: { host: 'localhost', 'svix-id': eventId, 'svix-timestamp': String(stamp),
      'svix-signature': `v1,${signature}` } });
  let body;
  const res = { statusCode: 0, setHeader() {}, end(value) { body = JSON.parse(value); } };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  return body;
}

// Evaluate the temporal operators actually emitted by the real ROI module.
// Unknown grammar throws (unavailable), never a successful empty result.
function roiDriver(messages, reservations, { broken = false } = {}) {
  return { query: async (raw, params) => {
    if (broken) throw new Error('synthetic database unavailable');
    const sql = String(raw).replace(/\s+/g, ' ').trim();
    const capture = (re) => { const m = sql.match(re); assert(m, `unsupported SQL: ${re}`); return m; };
    const projected = capture(/select id, (created_at|sent_at), recipient/)[1];
    const periodField = capture(/and (created_at|sent_at) > now\(\) - \(\$2 \|\| ' days'\)::interval/)[1];
    const lower = capture(/and res.created_at (>|>=) m\.(created_at|sent_at)/);
    const upper = capture(/and res.created_at (<=|<) m\.(created_at|sent_at) \+ interval '60 days'/);
    const orderField = capture(/order by res.id, m\.(created_at|sent_at) desc/)[1];
    assert(sql.includes('distinct on (res.id)'));
    assert(sql.includes('where center_id = $1'));
    assert(sql.includes('on res.center_id = $1'));
    assert(sql.includes("status in ('sent', 'delivered')"));
    assert(sql.includes("res.status in ('arrived', 'paid')"));
    assert(sql.includes("res.validation_status = 'confirmed'"));
    assert(sql.includes('res.date < current_date'));
    assert(sql.includes("coalesce(res.channel, '') not in ("));
    const instant = v => {
      if (v === null || v === undefined) return null;
      const n = Date.parse(v);
      assert(Number.isFinite(n), 'invalid timestamp rejected by fake timestamptz driver');
      return n;
    };
    const candidates = messages.filter(m => m.center_id === params[0] && m.direction !== 'inbound'
      && ['sent', 'delivered'].includes(m.status) && MARKETING_SOURCES.some(s => s.key === m.source));
    const eligible = candidates.filter(m => {
      const when = instant(m[periodField]);
      if (sql.includes('sent_at is not null') && m.sent_at == null) return false;
      if (sql.includes('and sent_at <= now()') && instant(m.sent_at) > NOW) return false;
      return when !== null && when > NOW - Number(params[1]) * DAY;
    });
    const grouped = new Map();
    eligible.forEach(m => {
      if (!grouped.has(m.source)) grouped.set(m.source, { source: m.source, sent: 0, conversions: 0, revenue: 0 });
      grouped.get(m.source).sent += 1;
    });
    reservations.forEach(r => {
      if (r.center_id !== params[0] || !['arrived', 'paid'].includes(r.status)
        || r.validation_status !== 'confirmed' || r.date >= '2026-09-12'
        || SIMULATION_CHANNELS.includes(r.channel)) return;
      const booked = instant(r.created_at);
      const matches = eligible.filter(m => {
        assert([lower[2], upper[2], orderField].every(f => f === projected), 'unprojected temporal column');
        const start = instant(m[lower[2]]), end = instant(m[upper[2]]);
        if (start === null || end === null) return false;
        return (lower[1] === '>' ? booked > start : booked >= start)
          && (upper[1] === '<=' ? booked <= end + 60 * DAY : booked < end + 60 * DAY)
          && (r.email.toLowerCase() === m.recipient.toLowerCase()
            || (m.client_key && r.phone.replace(/[^0-9+]/g, '') === m.client_key));
      }).sort((a, b) => instant(b[orderField]) - instant(a[orderField])
        || (sql.includes('m.id desc') ? b.id - a.id : 0));
      if (matches.length) {
        const source = grouped.get(matches[0].source);
        source.conversions += 1; source.revenue += r.price;
      }
    });
    return { rows: [{ by_source: [...grouped.values()], review_clicks: 0,
      excluded_missing_sent_at: sql.includes('as excluded_missing_sent_at')
        ? candidates.filter(m => m.sent_at == null).length : undefined }] };
  } };
}
const msg = (id, overrides = {}) => ({ id, center_id: 'libramont', direction: 'outbound',
  recipient: 'sender@example.test', status: 'sent', source: 'campaign', client_key: '',
  created_at: iso(-8), sent_at: iso(-3), ...overrides });
const booking = (overrides = {}) => ({ id: 1, center_id: 'libramont', status: 'paid',
  validation_status: 'confirmed', date: '2026-09-11', created_at: iso(-2),
  email: 'sender@example.test', phone: '', channel: 'public', price: 120, ...overrides });
const roi = (messages, reservations, days = 30) => computeMarketingRoi('libramont', { days }, roiDriver(messages, reservations));

// Exercise the real ROI -> real brief -> real ask path. Only independent data
// readers and the model transport are injected; inspect its actual JSON input.
async function askFromRoi(driver) {
  poolQuery = driver.query;
  let bundle, dossier, modelCalls = 0;
  const facts = { centerId: 'libramont', centerName: 'Centre test', activities: [], forbiddenClaims: [] };
  const briefDeps = {
    buildMarketingBrain: async () => ({ today: '2026-09-12', outlook: [], plan: [], explainPast: [], dataDays: 0 }),
    listMarketingInsights: async () => [], listMarketingPatterns: async () => [],
    listDailyMetrics: async () => ({ totals: { visitors: 0, revenue: 0 }, rows: [] }),
    chargerFicheDuRegistre: async () => ({}), centerFacts: () => facts,
    llmProvider: () => null, skipPolish: true,
    query: async sql => ({ rows: sql.includes('count(*)') ? [{ count: 0 }] : [] }),
  };
  const answer = await answerMarketingQuestion('libramont', { question: 'Quel impact ont les messages ?' }, {
    llmProvider: () => 'synthetic', isBudgetExhausted: () => false,
    buildMarketingBriefBundle: async (centerId, options, injected) => {
      assert.equal(centerId, 'libramont'); assert.equal(injected.skipPolish, true);
      bundle = await buildMarketingBriefBundle(centerId, options, briefDeps);
      return bundle;
    },
    buildCenterFacts: () => facts, getMergedFormulas: async () => [], listCenterActivities: () => [],
    chargerFicheDuRegistre: async () => ({}), getFaitsAppris: async () => [],
    callLlmJson: async request => {
      modelCalls += 1; assert.equal(request.usage, 'sensitive');
      dossier = JSON.parse(request.user).dossier;
      return { titre: 'Les mesures', reponse: 'Je peux lire les faits du dossier.',
        faits: [], jeNeSaisPas: [], action: 'aucune', jourVise: '' };
    },
  });
  assert.equal(modelCalls, 1); assert.equal(answer.grounded, true, JSON.stringify(answer));
  return { bundle, dossier };
}

(async () => {
  await check('C5 two manual bodies in one minute survive', async () => {
    const s = inbox();
    const a = await s.ingest();
    const b = await s.ingest({ body: 'Correction : merci de tout annuler.', receivedAt: '2026-09-12T10:00:45Z' });
    assert.equal(b.deduped, false); assert.notEqual(a.communication.id, b.communication.id);
    assert.equal(s.rows.length, 2); assert.equal(s.rows[0].body, 'Je souhaite reserver.');
  });
  await check('C5 real webhook preserves distinct provider identities', async () => {
    const s = inbox();
    const a = await webhook(s, { email_id: 'email-A', created_at: '2026-09-12T10:00:05Z' });
    const b = await webhook(s, { email_id: 'email-B', created_at: '2026-09-12T10:00:45Z', text: 'Annuler svp.' }, 'event-B');
    assert.notEqual(a.id, b.id); assert.equal(s.rows.length, 2);
    assert.equal(s.rows[0].payload.provider, 'resend'); assert.equal(s.rows[0].payload.providerEmailId, 'email-A');
  });
  await check('C5 retry with new delivery event and no stable receivedAt dedupes', async () => {
    const s = inbox();
    const a = await webhook(s, { email_id: 'stable', text: 'Premier corps', created_at: '2026-09-11T09:00:00Z' });
    const b = await webhook(s, { email_id: 'stable', text: 'Corps rehydrate' }, 'event-retry');
    assert.equal(b.id, a.id); assert.equal(b.deduped, true); assert.equal(s.rows[0].body, 'Premier corps');
  });
  await check('C5 provider ID alias and center/provider namespace', async () => {
    const s = inbox();
    const a = await webhook(s, { id: 'alias-id', text: 'Corps' });
    const b = await webhook(s, { email_id: 'alias-id', text: 'Corps' }, 'another-event');
    assert.equal(a.id, b.id); assert.equal(b.deduped, true);
    await s.ingest({ provider: 'resend', providerEmailId: 'alias-id', centerId: 'gembloux' });
    await s.ingest({ provider: 'another', providerEmailId: 'alias-id' });
    assert.equal(s.rows.length, 3);
  });
  await check('C5 manual request retry is stable, independent requests remain distinct', async () => {
    const s = inbox();
    const a = await s.ingest({ requestId: 'request-one' });
    const b = await s.ingest({ requestId: 'request-one', receivedAt: '2026-09-13T08:00:00Z' });
    assert.equal(b.communication.id, a.communication.id); assert.equal(b.deduped, true);
    await s.ingest({ requestId: 'request-two' }); assert.equal(s.rows.length, 2);
  });
  await check('C5 reused manual request ID cannot overwrite different content on lookup failure', async () => {
    const s = inbox();
    await s.ingest({ requestId: 'request-one' }); s.failLookup();
    await s.ingest({ requestId: 'request-one', body: 'Merci de tout annuler.' });
    assert.equal(s.rows.length, 2); assert.equal(s.rows[0].body, 'Je souhaite reserver.');
  });
  await check('C5 full subject matters for a reused manual request', async () => {
    const s = inbox(); const prefix = 'x'.repeat(60);
    await s.ingest({ requestId: 'same', subject: `${prefix} suite A` });
    await s.ingest({ requestId: 'same', subject: `${prefix} suite B` });
    assert.equal(s.rows.length, 2);
  });
  await check('C5 absent request identity allocates distinct manual ingestions', async () => {
    const s = inbox(); await s.ingest(); await s.ingest(); assert.equal(s.rows.length, 2);
  });
  await check('C5 invalid sender/content rejected without insertion', async () => {
    const s = inbox(); await assert.rejects(s.ingest({ body: '' })); assert.equal(s.rows.length, 0);
  });
  await check('C6 before sending is never attributed', async () => {
    const r = await roi([msg(1, { sent_at: iso(-1) })], [booking()]);
    assert.equal(r.conversions, 0); assert.equal(r.revenue, 0);
  });
  await check('C6 last touch follows sending, not creation', async () => {
    const r = await roi([msg(1, { source: 'campaign', created_at: iso(-9), sent_at: iso(-3) }),
      msg(2, { source: 'reactivation', created_at: iso(-5), sent_at: iso(-4) })], [booking()]);
    assert.equal(r.bySource.find(s => s.key === 'campaign').revenue, 120);
    assert.equal(r.conversions, 1);
  });
  await check('C6 reporting window starts at sending even after long scheduling delay', async () => {
    const r = await roi([msg(1, { created_at: iso(-90) })], [booking()]);
    assert.equal(r.sent, 1); assert.equal(r.revenue, 120);
  });
  await check('C6 attribution window is 60 days after sending, inclusive upper bound', async () => {
    const m = msg(1, { created_at: iso(-110), sent_at: iso(-63) });
    const atBoundary = booking({ created_at: iso(-3) });
    assert.equal((await roi([m], [atBoundary], 365)).revenue, 120);
    assert.equal((await roi([m], [{ ...atBoundary, created_at: new Date(Date.parse(iso(-3)) + 1).toISOString() }], 365)).revenue, 0);
  });
  await check('C6 exact send instant excluded, one millisecond after included', async () => {
    const m = msg(1);
    assert.equal((await roi([m], [booking({ created_at: m.sent_at })])).revenue, 0);
    assert.equal((await roi([m], [booking({ created_at: new Date(Date.parse(m.sent_at) + 1).toISOString() })])).revenue, 120);
  });
  await check('C6 timezone offsets compare instants, including DST repeated hour', async () => {
    const m = msg(1, { created_at: '2025-10-20T10:00:00Z', sent_at: '2025-10-26T02:30:00+02:00' });
    assert.equal((await roi([m], [booking({ created_at: '2025-10-26T02:15:00+01:00' })], 365)).revenue, 120);
    assert.equal((await roi([m], [booking({ created_at: '2025-10-26T00:29:59Z' })], 365)).revenue, 0);
  });
  await check('C6 historical null sent_at excluded and measured without created fallback', async () => {
    const r = await roi([msg(1, { sent_at: null }), msg(2, { center_id: 'gembloux', sent_at: null })], [booking()]);
    assert.equal(r.available, true); assert.equal(r.revenue, 0); assert.equal(r.sent, 0);
    assert.equal(r.excludedMissingSentAt, 1);
  });
  await check('C6 invalid sentAt produces unavailable, never created fallback', async () => {
    const r = await roi([msg(1, { sent_at: 'invalid-sendAt' })], [booking()]);
    assert.equal(r.available, false); assert.equal(r.revenue, null);
  });
  await check('C6 future sending timestamps are not yet eligible', async () => {
    const r = await roi([msg(1, { sent_at: iso(1) })], []);
    assert.equal(r.sent, 0);
  });
  await check('C6 tied send instants have deterministic final ID tie-break', async () => {
    const r = await roi([msg(1, { source: 'campaign' }), msg(2, { source: 'reactivation' })], [booking()]);
    assert.equal(r.bySource.find(s => s.key === 'reactivation').revenue, 120);
  });
  await check('C6 existing status, center, contact and simulation exclusions survive', async () => {
    const m = msg(1);
    for (const change of [{ status: 'pending' }, { status: 'cancelled' }, { validation_status: 'staff_review' },
      { date: '2026-09-13' }, { center_id: 'gembloux' }, { email: 'other@example.test' }, { channel: SIMULATION_CHANNELS[0] }]) {
      assert.equal((await roi([m], [booking(change)])).revenue, 0, JSON.stringify(change));
    }
    for (const change of [{ status: 'queued' }, { direction: 'inbound' }, { source: 'confirmation' }, { center_id: 'gembloux' }]) {
      assert.equal((await roi([msg(1, change)], [booking()])).revenue, 0, JSON.stringify(change));
    }
    assert.equal((await roi([msg(1, { status: 'delivered' })], [booking({ email: 'SENDER@EXAMPLE.TEST' })])).revenue, 120);
    assert.equal((await roi([msg(1, { client_key: '+32123456789' })], [booking({ email: 'other@example.test', phone: '+32 123 45 67 89' })])).revenue, 120);
  });
  await check('C6 query error distinct from business zero, shape and sources retained', async () => {
    const down = await computeMarketingRoi('libramont', {}, roiDriver([], [], { broken: true }));
    const empty = await roi([], []);
    assert.equal(down.available, false); assert.equal(down.unavailableReason, 'query_failed');
    assert.equal(empty.available, true); assert.equal(empty.revenue, 0);
    for (const k of ['sent', 'conversions', 'revenue', 'reviewClicks', 'excludedMissingSentAt']) assert.equal(down[k], null);
    assert.equal(down.bySource.length, MARKETING_SOURCES.length);
    assert(down.bySource.every(s => s.revenue === null && s.sent === null && s.conversions === null));
    assert(!JSON.stringify(down).includes('synthetic database'));
  });
  await check('C6 trigger consumer keeps unavailable distinct from known zero', async () => {
    await assert.rejects(attributedRevenueByTrigger('libramont', {}, roiDriver([], [], { broken: true })),
      e => e.code === 'MARKETING_ROI_UNAVAILABLE');
    const triggers = await attributedRevenueByTrigger('libramont', {}, roiDriver([], []));
    assert.equal(triggers.campaign.revenue, 0);
    const insights = [{ channel: 'email', status: 'validated', payload: { kind: 'email', trigger: 'campaign' }, result: { netDeltaPct: 10 } }];
    assert.equal(buildPatternRows(insights, {})[0].revenue, null);
    assert.equal(buildPatternRows(insights, triggers)[0].revenue, 0);
  });
  await check('C6 real ROI to brief preserves unavailable and known zero', async () => {
    const briefDeps = {
      buildMarketingBrain: async () => ({ today: '2026-09-12', outlook: [], plan: [], explainPast: [], dataDays: 0 }),
      listMarketingInsights: async () => [], listMarketingPatterns: async () => [],
      listDailyMetrics: async () => ({ totals: { visitors: 0, revenue: 0 }, rows: [] }),
      chargerFicheDuRegistre: async () => ({}), centerFacts: () => ({ centerId: 'libramont', activities: [] }),
      llmProvider: () => null, skipPolish: true,
      query: async text => ({ rows: text.includes('count(*)') ? [{ count: 0 }] : [] }),
    };
    // No computeMarketingRoi mock: the bundle invokes the real module/default deps.
    poolQuery = roiDriver([], [], { broken: true }).query;
    const down = await buildMarketingBriefBundle('libramont', {}, briefDeps);
    assert.equal(down.paie.euros, null); assert.equal(down.paie.available, false);
    assert.equal(down.paie.unavailableReason, 'query_failed'); assert.equal(down.paie.excludedMissingSentAt, null);
    assert.equal(down.paie.young, false); assert.equal(down.paie.quietWindow, false);
    poolQuery = roiDriver([], []).query;
    const empty = await buildMarketingBriefBundle('libramont', {}, briefDeps);
    assert.equal(empty.paie.available, true); assert.equal(empty.paie.euros, 0);
    assert.equal(empty.paie.young, true); assert.equal(empty.paie.unavailableReason, null);
  });
  await check('C6 real ROI to brief preserves revenue and excluded historical count', async () => {
    poolQuery = roiDriver([msg(1), msg(2, { sent_at: null })], [booking()]).query;
    const bundle = await buildMarketingBriefBundle('libramont', {}, {
      buildMarketingBrain: async () => ({ today: '2026-09-12', outlook: [], plan: [], explainPast: [] }),
      listMarketingInsights: async () => [], listMarketingPatterns: async () => [],
      listDailyMetrics: async () => ({ totals: {} }), chargerFicheDuRegistre: async () => ({}),
      centerFacts: () => ({ centerId: 'libramont', activities: [] }), llmProvider: () => null, skipPolish: true,
      query: async () => ({ rows: [] }),
    });
    assert.equal(bundle.paie.euros, 120); assert.equal(bundle.paie.venues, 1);
    assert.equal(bundle.paie.sent, 1); assert.equal(bundle.paie.sources[0].key, 'campaign');
    assert.equal(bundle.paie.available, true); assert.equal(bundle.paie.excludedMissingSentAt, 1);
  });
  await check('C6 real aggregate keeps ROI failure null and known totals numeric', async () => {
    const insights = [{ signature: 'campaign:email', channel: 'email', status: 'validated',
      payload: { kind: 'email', trigger: 'campaign' }, result: { netDeltaPct: 10 } }];
    async function aggregate(driver) {
      const writes = [];
      poolQuery = async (text, params) => {
        if (text.includes('marketing_candidates')) return driver.query(text, params);
        if (text.includes('from marketing_insights')) { assert.equal(params[0], 'libramont'); return { rows: insights }; }
        if (text.includes('insert into marketing_patterns')) { writes.push(params); return { rows: [] }; }
        throw new Error(`Unexpected aggregation SQL: ${text.slice(0, 60)}`);
      };
      const result = await aggregateMarketingPatterns({ centerId: 'libramont' });
      assert.equal(result.ok, true); assert.equal(result.patterns, 1);
      assert.equal(writes.length, 1); assert.equal(writes[0][5], 10, 'visitor evidence persists independently of ROI');
      return result;
    }
    const down = await aggregate(roiDriver([], [], { broken: true }));
    assert.equal(down.attributedRevenue, null); assert.equal(down.available, false);
    assert.equal(down.unavailableReason, 'query_failed');
    const empty = await aggregate(roiDriver([], []));
    assert.equal(empty.attributedRevenue, 0); assert.equal(empty.available, true);
    const known = await aggregate(roiDriver([msg(1)], [booking()]));
    assert.equal(known.attributedRevenue, 120); assert.equal(known.available, true);
  });
  await check('C6 ROI failure reaches real brief and serialized ask dossier as unknown', async () => {
    const { bundle, dossier } = await askFromRoi(roiDriver([], [], { broken: true }));
    assert.equal(bundle.paie.available, false);
    const impact = dossier.impactMesure;
    assert.equal(impact.chiffreLieAuxMessages, null);
    assert.equal(impact.visitesHonorees, null); assert.equal(impact.messagesEnvoyes, null);
    assert.equal(impact.available, false); assert.equal(impact.unavailableReason, 'query_failed');
    assert.equal(impact.tropJeunePourUnVerdict, false); assert.equal(impact.fenetreSansEnvoi, false);
    assert.equal(impact.premierVerdictLe, null); assert.equal(impact.envoisSansDateExclus, null);
    assert.match(impact.reserve, /indisponible/i); assert.equal(impact.fenetreJours, 30);
    assert.equal(dossier.pouls.chiffreAffaires30j, '0 €', 'independent known business zero remains usable');
    assert(!JSON.stringify(dossier).includes('synthetic database'));
  });
  await check('C6 genuine zero remains measured zero through real brief and ask', async () => {
    const { dossier } = await askFromRoi(roiDriver([], []));
    const impact = dossier.impactMesure;
    assert.equal(impact.chiffreLieAuxMessages, '0 €'); assert.equal(impact.visitesHonorees, 0);
    assert.equal(impact.messagesEnvoyes, 0); assert.equal(impact.available, true);
    assert.equal(impact.unavailableReason, null); assert.equal(impact.reserve, '');
    assert.equal(impact.tropJeunePourUnVerdict, true); assert.equal(impact.fenetreSansEnvoi, false);
    assert.equal(impact.envoisSansDateExclus, 0);
  });
  await check('C6 known revenue and historical exclusion survive the serialized ask dossier', async () => {
    const { dossier } = await askFromRoi(roiDriver([msg(1), msg(2, { sent_at: null })], [booking()]));
    const impact = dossier.impactMesure;
    assert.equal(impact.chiffreLieAuxMessages, '120 €'); assert.equal(impact.visitesHonorees, 1);
    assert.equal(impact.messagesEnvoyes, 1); assert.equal(impact.available, true);
    assert.equal(impact.envoisSansDateExclus, 1); assert.equal(impact.unavailableReason, null);
  });
  await check('C6 legacy numeric brief remains readable without an availability flag', async () => {
    const impact = buildAskDossier({ bundle: { paie: { euros: 24, venues: 2, sent: 3, days: 30 } } }).impactMesure;
    assert.equal(impact.chiffreLieAuxMessages, '24 €'); assert.equal(impact.visitesHonorees, 2);
    assert.equal(impact.messagesEnvoyes, 3); assert.equal(impact.available, true);
    assert.equal(impact.envoisSansDateExclus, null, 'an absent exclusion counter is not a measured zero');
  });
  await check('C6 absent or incomplete impact never manufactures a zero or verdict', async () => {
    for (const paie of [undefined, { euros: null, venues: null, sent: null },
      { euros: 12, venues: null, sent: 1, available: true },
      { euros: 12, venues: 1, sent: 1, available: false, unavailableReason: 'query_failed' }]) {
      const impact = buildAskDossier({ bundle: { paie } }).impactMesure;
      assert.equal(impact.available, false); assert.equal(impact.chiffreLieAuxMessages, null);
      assert.equal(impact.visitesHonorees, null); assert.equal(impact.messagesEnvoyes, null);
      assert.equal(impact.tropJeunePourUnVerdict, false); assert.equal(impact.fenetreSansEnvoi, false);
      assert.equal(impact.premierVerdictLe, null); assert(impact.unavailableReason);
    }
  });
  console.log(`preprod-inbound-roi-check: ${passed} passed, ${failed} failed; fake driver, no PostgreSQL or network`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
