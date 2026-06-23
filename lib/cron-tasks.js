const { runOrchestratorForCenter } = require('./orchestrator-runner');
const { runMarketingAgentCycle } = require('./marketing-agents');
const { createWorkerRun, finishWorkerRun } = require('./database');
const { dispatchDueCommunications } = require('./ops-communications');
const { processDueOpsJobs } = require('./ops-jobs');
const { loadOpsKnowledge } = require('./ops-knowledge');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

async function recordWorkerTask(taskName, run) {
  let workerRun = null;
  try {
    workerRun = await createWorkerRun({ taskName });
  } catch (error) {
    // Health logging must not block the actual work.
    workerRun = null;
  }

  try {
    const result = await run();
    if (workerRun) {
      await finishWorkerRun(workerRun.id, {
        status: 'ok',
        checkedCount: result.checked || result.results?.length || result.centers?.length || 0,
        result,
      }).catch(() => null);
    }
    return result;
  } catch (error) {
    if (workerRun) {
      await finishWorkerRun(workerRun.id, {
        status: 'failed',
        error: error.message || String(error),
        result: { taskName },
      }).catch(() => null);
    }
    throw error;
  }
}

async function runAgentOrchestratorCron({ days = 30 } = {}) {
  return recordWorkerTask('agent-orchestrator', async () => {
    const knowledge = loadOpsKnowledge();
    const activeCenters = (knowledge.centers || []).filter((center) => center.status === 'active');
    const startDate = daysAgoIso(Number(days || 30));
    const endDate = todayIso();
    const results = [];

    for (const center of activeCenters) {
      const ops = await runOrchestratorForCenter({
        centerId: center.id,
        startDate,
        endDate,
        persist: true,
      });
      let marketing = null;
      try {
        marketing = await runMarketingAgentCycle({
          centerId: center.id,
          startDate,
          endDate,
          persist: true,
          runType: 'cron',
        });
      } catch (error) {
        marketing = {
          ok: false,
          message: error.message || 'Cycle marketing impossible.',
        };
      }
      results.push({ centerId: center.id, ops, marketing });
    }

    return {
      ok: true,
      action: 'agent-orchestrator',
      startDate,
      endDate,
      centers: activeCenters.map((center) => center.id),
      results,
    };
  });
}

async function runDispatchCommunicationsCron({ limit = 50 } = {}) {
  return recordWorkerTask('dispatch-communications', () =>
    dispatchDueCommunications({ limit: Number(limit || 50) }));
}

async function runOpsJobsCron({ limit = 25 } = {}) {
  return recordWorkerTask('ops-jobs', () =>
    processDueOpsJobs({ limit: Number(limit || 25) }));
}

module.exports = {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
};
