const { runOrchestratorForCenter } = require('./orchestrator-runner');
const { runMarketingAgentCycle } = require('./marketing-agents');
const { dispatchDueCommunications } = require('./ops-communications');
const { loadOpsKnowledge } = require('./ops-knowledge');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

async function runAgentOrchestratorCron({ days = 30 } = {}) {
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
}

async function runDispatchCommunicationsCron({ limit = 50 } = {}) {
  return dispatchDueCommunications({ limit: Number(limit || 50) });
}

module.exports = {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
};
