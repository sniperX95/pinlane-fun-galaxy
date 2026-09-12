'use strict';

// Entire real generator + real job lifecycle, with an explicit dependency allowlist.
// No product dependency is imported transitively; no DB, network or .env exists here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-09-12T10:00:00Z');
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

function loadReal(file, dependencies, timers) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const requireMock = name => {
    assert(Object.hasOwn(dependencies, name), `Unmocked dependency forbidden: ${file} -> ${name}`);
    return dependencies[name];
  };
  const context = vm.createContext({
    module, exports: module.exports, require: requireMock,
    Date: FixtureDate, process: { env: Object.freeze({}) },
    setInterval(callback, delay) {
      assert.equal(delay, 60000);
      const timer = { callback, unref() {} };
      timers.add(timer);
      return timer;
    },
    clearInterval(timer) { timers.delete(timer); },
  });
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
  return module.exports;
}

function fixture({ loss = '', saveFailure = false, emptySave = false, attempts = 0, provider = true, progressFailure = false } = {}) {
  const state = { owned: true, modelCalls: 0, writes: 0, renewals: 0, updates: [], steps: [], timers: new Set() };
  const token = '2026-09-12 10:00:00.123456+00';
  const job = { id: 41, claimToken: token, jobType: 'marketing_plan', centerId: 'offline', payload: { weeks: 2 }, attempts, maxAttempts: 5 };
  let claimed = false;
  const query = async (sql, params) => {
    assert.match(sql, /insert into marketing_plans/);
    assert.match(sql, /on conflict \(center_id, from_date\) where status <> 'archived'/);
    assert.match(sql, /returning id/);
    assert.equal(params[0], 'offline');
    assert.equal(params[1], '2026-09-07');
    assert.equal(params[3], 2);
    const payload = JSON.parse(params[5]);
    assert.equal(payload.weeks.length, 2);
    state.writes++;
    if (saveFailure) throw new Error('OFFLINE_SAVE_FAILED');
    return { rows: emptySave ? [] : [{ id: 99, payload }] };
  };
  const db = {
    getPool: () => ({ query }),
    listDueOpsJobs: async ({ limit }) => {
      assert.equal(limit, 1);
      if (claimed) return [];
      claimed = true;
      return [job];
    },
    renewOpsJobLease: async (id, claimToken) => {
      assert.equal(id, job.id);
      assert.equal(claimToken, token);
      state.renewals++;
      return state.owned;
    },
    appendOpsJobStep: async (id, label, options) => {
      assert.equal(id, job.id);
      assert.equal(options.claimToken, token);
      state.steps.push(label);
      // Loss happens AFTER the progress writer's renewal: only an independent
      // guard immediately before the next side effect can observe it.
      if ((loss === 'before-model' && label.includes('rédiger le plan par le modèle')) ||
          (loss === 'before-save' && label.includes("J'enregistre le plan"))) state.owned = false;
      if (progressFailure) throw new Error('OFFLINE_PROGRESS_FAILED');
      return true;
    },
    updateOpsJobStatus: async (id, update) => {
      assert.equal(id, job.id);
      assert.equal(update.claimToken, token);
      state.updates.push(update);
      return state.owned ? { id, ...update } : null;
    },
  };
  const strategist = loadReal('lib/marketing-strategist.js', {
    './database': db,
    './center-metrics': { SCHOOL_HOLIDAYS_FWB: [], LOCAL_EVENTS: [], publicHolidaysBE: () => [], listMarketingPatterns: async () => [] },
    './marketing-agents': { buildCenterFacts: () => ({ city: 'Offline', activities: ['Bowling'] }) },
    './llm-client': {
      llmProvider: () => provider ? 'offline' : null,
      callLlmJson: async request => {
        state.modelCalls++;
        const input = JSON.parse(request.user);
        assert.equal(input.semaines.length, 2);
        return { weeks: input.semaines.map(w => ({ ...w, objectif: 'Objectif local', pourquoi: 'Routine', actions: ['Action locale'] })) };
      },
    },
  }, state.timers);
  const jobs = loadReal('lib/ops-jobs.js', {
    './database': db, './marketing-strategist': strategist,
    './ops-communications': {}, './ops-knowledge': {}, crypto,
  }, state.timers);
  return { state, strategist, jobs };
}

async function jobCase(options, expected) {
  const { state, jobs } = fixture(options);
  const result = await jobs.processDueOpsJobs({ limit: 1 });
  console.log(JSON.stringify({ options, status: result.results[0]?.status, ok: result.ok,
    modelCalls: state.modelCalls, writes: state.writes,
    updates: state.updates.map(u => u.status), timers: state.timers.size }));
  assert.equal(state.modelCalls, expected.modelCalls, 'model calls after ownership loss');
  assert.equal(state.writes, expected.writes, 'persistence after ownership loss');
  assert.equal(state.timers.size, 0, 'heartbeat must be cleaned up on every exit');
  assert.equal(result.checked, 1);
  assert.equal(result.results[0].status, expected.status);
  assert.equal(result.ok, expected.status === 'done');
  assert.equal(result.superseded, expected.status === 'superseded' ? 1 : 0);
  assert.equal(result.retried, expected.status === 'queued' ? 1 : 0);
  assert.equal(result.failed, expected.status === 'failed' ? 1 : 0);
  if (expected.status === 'superseded') {
    assert.equal(state.updates.length, 0, 'lost owner must not even attempt finalization');
  } else {
    assert.equal(state.updates.length, 1);
    assert.equal(state.updates[0].incrementAttempts, 1);
    if (expected.status === 'done') {
      assert.equal(result.results[0].result.planId, 99);
      assert.equal(result.results[0].result.semaines, 2);
      assert.equal(result.results[0].result.mode, options.provider === false ? 'rules' : 'ai');
    } else {
      assert.match(state.updates[0].lastError, /plan|enregistr/i, 'actionable persistence error');
      assert.equal(state.updates[0].runAt, expected.status === 'queued' ? '2026-09-12T10:05:00.000Z' : null);
    }
  }
}

async function main() {
  const cases = [
    ['lost-before-model', () => jobCase({ loss: 'before-model' }, { status: 'superseded', modelCalls: 0, writes: 0 })],
    ['lost-before-persistence', () => jobCase({ loss: 'before-save' }, { status: 'superseded', modelCalls: 1, writes: 0 })],
    ['rules-lost-before-persistence', () => jobCase({ loss: 'before-save', provider: false }, { status: 'superseded', modelCalls: 0, writes: 0 })],
    ['persistence-failure-retry', () => jobCase({ saveFailure: true }, { status: 'queued', modelCalls: 1, writes: 1 })],
    ['persistence-failure-exhausted', () => jobCase({ saveFailure: true, attempts: 4 }, { status: 'failed', modelCalls: 1, writes: 1 })],
    ['empty-save-not-done', () => jobCase({ emptySave: true }, { status: 'queued', modelCalls: 1, writes: 1 })],
    ['owned-done', () => jobCase({}, { status: 'done', modelCalls: 1, writes: 1 })],
    ['rules-owned-done', () => jobCase({ provider: false }, { status: 'done', modelCalls: 0, writes: 1 })],
    ['progress-error-nonblocking', () => jobCase({ progressFailure: true }, { status: 'done', modelCalls: 1, writes: 1 })],
    ['ui-contract-unchanged', async () => {
      const { state, strategist } = fixture({ saveFailure: true });
      const options = { weeks: 2, onStep: async () => { throw new Error('UI_PROGRESS_FAILED'); } };
      const preview = await strategist.generateMarketingPlan('offline', { ...options, persist: false });
      assert.equal(preview.saved, null);
      assert.equal(preview.plan.mode, 'ai');
      assert.equal(state.writes, 0);
      const unsaved = await strategist.generateMarketingPlan('offline', options);
      assert.equal(unsaved.saved, null, 'UI fallback contract remains unchanged');
      assert.equal(unsaved.plan.weeks.length, 2);
      assert.equal(state.writes, 1);
      assert.equal(state.modelCalls, 2);
      assert.equal(state.timers.size, 0);
    }],
  ];
  let failures = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
  }
  console.log(`preprod-marketing-job-check: ${cases.length - failures}/${cases.length} passed, ${failures} failed; offline VM dependencies only`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
