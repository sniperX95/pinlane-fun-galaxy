const { sendError, sendJson } = require('../lib/http');
const {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
} = require('../lib/cron-tasks');

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.authorization === `Bearer ${expected}`;
}

function getAction(req) {
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return requestUrl.searchParams.get('action') || 'dispatch-communications';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, 405, 'Methode non autorisee.');
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, 'Cron non autorise.');
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const action = getAction(req);
    if (action === 'agent-orchestrator') {
      sendJson(res, 200, await runAgentOrchestratorCron({
        days: requestUrl.searchParams.get('days') || 30,
      }));
      return;
    }
    if (action === 'dispatch-communications') {
      sendJson(res, 200, await runDispatchCommunicationsCron({
        limit: requestUrl.searchParams.get('limit') || 50,
      }));
      return;
    }
    if (action === 'ops-jobs') {
      sendJson(res, 200, await runOpsJobsCron({
        limit: requestUrl.searchParams.get('limit') || 25,
      }));
      return;
    }
    sendError(res, 400, 'Action cron inconnue.');
  } catch (error) {
    sendError(res, 500, error.message || 'Cron indisponible.');
  }
};
