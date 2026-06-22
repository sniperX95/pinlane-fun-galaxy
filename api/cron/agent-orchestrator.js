const { runOrchestratorForCenter } = require('../../lib/orchestrator-runner');
const { runMarketingAgentCycle } = require('../../lib/marketing-agents');
const { sendError, sendJson } = require('../../lib/http');
const { loadOpsKnowledge } = require('../../lib/ops-knowledge');

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.authorization === `Bearer ${expected}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, 'Cron non autorise.');
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const knowledge = loadOpsKnowledge();
    const activeCenters = (knowledge.centers || []).filter((center) => center.status === 'active');
    const startDate = daysAgoIso(Number(requestUrl.searchParams.get('days') || 30));
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

    sendJson(res, 200, {
      ok: true,
      action: 'agent-orchestrator',
      startDate,
      endDate,
      centers: activeCenters.map((center) => center.id),
      results,
    });
  } catch (error) {
    sendError(res, 500, error.message || 'Orchestration agents impossible.');
  }
};
