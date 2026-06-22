const { runAgentOrchestratorCron, runDispatchCommunicationsCron } = require('../lib/cron-tasks');
const { getPool } = require('../lib/database');

const once = process.argv.includes('--once');
let shuttingDown = false;

function envBool(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function envNumber(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function log(level, message, extra = {}) {
  console.log(JSON.stringify({
    level,
    message,
    worker: 'ops-worker',
    time: new Date().toISOString(),
    ...extra,
  }));
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result.results)) {
    return {
      ok: result.ok,
      action: result.action,
      checked: result.checked,
      results: result.results.length,
    };
  }
  return {
    ok: result.ok,
    action: result.action,
    checked: result.checked,
    centers: result.centers,
    startDate: result.startDate,
    endDate: result.endDate,
  };
}

async function runTask(task) {
  if (task.running) return;
  task.running = true;
  const startedAt = Date.now();
  try {
    const result = await task.run();
    log('info', `${task.name}:ok`, {
      task: task.name,
      durationMs: Date.now() - startedAt,
      result: summarizeResult(result),
    });
  } catch (error) {
    log('error', `${task.name}:failed`, {
      task: task.name,
      durationMs: Date.now() - startedAt,
      error: error.message || String(error),
      stack: error.stack,
    });
  } finally {
    task.lastRunAt = Date.now();
    task.running = false;
  }
}

function buildTasks() {
  const tasks = [];
  if (envBool('OPS_WORKER_RUN_COMMUNICATIONS', true)) {
    tasks.push({
      name: 'communications',
      intervalMs: envNumber('OPS_WORKER_COMMUNICATION_INTERVAL_MS', 60_000, { min: 10_000 }),
      lastRunAt: 0,
      running: false,
      run: () => runDispatchCommunicationsCron({
        limit: envNumber('OPS_WORKER_COMMUNICATION_LIMIT', 50, { min: 1, max: 100 }),
      }),
    });
  }

  if (envBool('OPS_WORKER_RUN_AGENTS', true)) {
    tasks.push({
      name: 'agents',
      intervalMs: envNumber('OPS_WORKER_AGENT_INTERVAL_MS', 15 * 60_000, { min: 60_000 }),
      lastRunAt: 0,
      running: false,
      run: () => runAgentOrchestratorCron({
        days: envNumber('OPS_WORKER_AGENT_DAYS', 30, { min: 1, max: 365 }),
      }),
    });
  }

  return tasks;
}

async function runOnce(tasks) {
  log('info', 'once:start', { tasks: tasks.map((task) => task.name) });
  for (const task of tasks) {
    await runTask(task);
  }
  await getPool().end();
  log('info', 'once:done');
}

async function runLoop(tasks) {
  log('info', 'loop:start', {
    tasks: tasks.map((task) => ({ name: task.name, intervalMs: task.intervalMs })),
  });

  while (!shuttingDown) {
    const now = Date.now();
    for (const task of tasks) {
      if (!task.lastRunAt || now - task.lastRunAt >= task.intervalMs) {
        runTask(task);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  log('info', 'loop:stopping');
  while (tasks.some((task) => task.running)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await getPool().end();
  log('info', 'loop:stopped');
}

async function main() {
  const tasks = buildTasks();
  if (!tasks.length) {
    log('warn', 'no_tasks_enabled');
    return;
  }
  if (once) {
    await runOnce(tasks);
    return;
  }
  await runLoop(tasks);
}

process.on('SIGINT', () => {
  shuttingDown = true;
});

process.on('SIGTERM', () => {
  shuttingDown = true;
});

main().catch(async (error) => {
  log('error', 'worker:fatal', { error: error.message || String(error), stack: error.stack });
  try {
    await getPool().end();
  } catch (closeError) {
    log('error', 'pool:close_failed', { error: closeError.message || String(closeError) });
  }
  process.exit(1);
});
