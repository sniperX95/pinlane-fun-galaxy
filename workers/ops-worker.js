const {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
} = require('../lib/cron-tasks');
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

function taskDidWork(result) {
  if (!result || typeof result !== 'object') return false;
  const counts = [
    Array.isArray(result.results) ? result.results.length : 0,
    Number(result.processed || 0),
    Number(result.dispatched || 0),
    Number(result.sent || 0),
    Number(result.enqueued || 0),
    Number(result.updated || 0),
    Number(result.deleted || 0),
  ];
  return counts.some((n) => n > 0);
}

async function runTask(task) {
  if (task.running) return;
  task.running = true;
  const startedAt = Date.now();
  let hadWork = false;
  try {
    const result = await task.run();
    hadWork = taskDidWork(result);
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
    // Backoff adaptatif : du travail réel remet l'intervalle au minimum (réactif) ;
    // rien à faire (ou tâche de fond) l'allonge jusqu'à maxIdle → Neon dort → 0 $.
    const base = task.baseIntervalMs || task.intervalMs;
    const maxIdle = task.maxIdleIntervalMs || base;
    if (hadWork && !task.alwaysBackoff) {
      task.intervalMs = base;
    } else {
      task.intervalMs = Math.min(maxIdle, Math.round((task.intervalMs || base) * 1.8));
    }
  }
}

// Rétention automatique des logs ops : évite que les tables de logs grossissent
// à l'infini (elles étaient montées à ~20k lignes). Ne touche PAS aux données
// métier (réservations, membres, config). S'exécute rarement (toutes les ~6 h).
const OPS_LOG_RETENTION_DAYS = envNumber('OPS_WORKER_LOG_RETENTION_DAYS', 7, { min: 2, max: 90 });
const OPS_LOG_TABLES = [
  ['ops_worker_runs', 'started_at'],
  ['marketing_agent_runs', 'created_at'],
  ['ops_decision_logs', 'created_at'],
  ['ops_events', 'created_at'],
  ['ops_agent_suggestions', 'created_at'],
];
async function pruneOpsLogs() {
  const pool = getPool();
  let deleted = 0;
  for (const [table, col] of OPS_LOG_TABLES) {
    try {
      const res = await pool.query(
        `delete from ${table} where ${col} < now() - ($1 || ' days')::interval`,
        [String(OPS_LOG_RETENTION_DAYS)],
      );
      deleted += res.rowCount || 0;
    } catch (error) {
      // table absente / colonne différente : on ignore, la rétention est best-effort.
    }
  }
  return { ok: true, action: 'pruneOpsLogs', deleted };
}

function buildTasks() {
  const tasks = [];
  if (envBool('OPS_WORKER_RUN_COMMUNICATIONS', true)) {
    tasks.push({
      name: 'communications',
      baseIntervalMs: envNumber('OPS_WORKER_COMMUNICATION_INTERVAL_MS', 60_000, { min: 10_000 }),
      maxIdleIntervalMs: envNumber('OPS_WORKER_COMMUNICATION_MAX_IDLE_MS', 600_000, { min: 60_000 }),
      lastRunAt: 0,
      running: false,
      run: () => runDispatchCommunicationsCron({
        limit: envNumber('OPS_WORKER_COMMUNICATION_LIMIT', 50, { min: 1, max: 100 }),
      }),
    });
  }

  if (envBool('OPS_WORKER_RUN_JOBS', true)) {
    tasks.push({
      name: 'jobs',
      baseIntervalMs: envNumber('OPS_WORKER_JOBS_INTERVAL_MS', 30_000, { min: 5_000 }),
      maxIdleIntervalMs: envNumber('OPS_WORKER_JOBS_MAX_IDLE_MS', 600_000, { min: 60_000 }),
      lastRunAt: 0,
      running: false,
      run: () => runOpsJobsCron({
        limit: envNumber('OPS_WORKER_JOBS_LIMIT', 25, { min: 1, max: 100 }),
      }),
    });
  }

  if (envBool('OPS_WORKER_RUN_AGENTS', true)) {
    tasks.push({
      name: 'agents',
      // Cadence 3 h / repli 6 h (avant : 15/30 min). Les intervalles courts
      // dataient de l'epoque zero-cle : le cycle etait gratuit (templates).
      // Depuis que le worker a une cle IA (16/07), chaque cycle paie ~6 appels
      // LLM : a 48 cycles/jour le plafond mensuel de 5 USD tombait en 3 jours
      // et TOUT le produit retombait en mode templates jusqu'au 1er du mois.
      // 4 cycles/jour suffisent largement : les sequences (anniversaire J-30,
      // reactivation) sont datees au jour, le warehouse est quotidien, et le
      // cron Vercel de 08:15 fait deja le cycle complet du matin. Override
      // possible sans redeploiement via les variables d'environnement.
      baseIntervalMs: envNumber('OPS_WORKER_AGENT_INTERVAL_MS', 3 * 60 * 60_000, { min: 60_000 }),
      maxIdleIntervalMs: envNumber('OPS_WORKER_AGENT_MAX_IDLE_MS', 6 * 60 * 60_000, { min: 5 * 60_000 }),
      lastRunAt: 0,
      running: false,
      // L'orchestrateur « travaille » toujours en apparence : on le laisse
      // reculer jusqu'à son max pour ne pas garder la base éveillée pour rien.
      alwaysBackoff: true,
      run: () => runAgentOrchestratorCron({
        days: envNumber('OPS_WORKER_AGENT_DAYS', 30, { min: 1, max: 365 }),
      }),
    });
  }

  tasks.push({
    name: 'prune-logs',
    baseIntervalMs: envNumber('OPS_WORKER_PRUNE_INTERVAL_MS', 6 * 60 * 60_000, { min: 60 * 60_000 }),
    maxIdleIntervalMs: envNumber('OPS_WORKER_PRUNE_INTERVAL_MS', 6 * 60 * 60_000, { min: 60 * 60_000 }),
    lastRunAt: Date.now(), // pas au démarrage : laisse le worker se lancer d'abord
    running: false,
    alwaysBackoff: true,
    run: () => pruneOpsLogs(),
  });

  // Intervalle effectif = base au départ ; ajusté dynamiquement (backoff quand
  // rien à faire) pour laisser Neon se mettre en veille et ne rien facturer.
  tasks.forEach((task) => { task.intervalMs = task.baseIntervalMs; });
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
