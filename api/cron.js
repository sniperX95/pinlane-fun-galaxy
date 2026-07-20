const crypto = require('crypto');
const { sendError, sendJson } = require('../lib/http');
const {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
  setAuditRuntime,
} = require('../lib/cron-tasks');

// Runtime Vercel : les memes taches que le worker Railway, declenchees par le
// planificateur de Vercel. Le journal doit les distinguer.
setAuditRuntime('cron');

// Comparaison a temps constant. On hache les deux cotes avant de comparer :
// crypto.timingSafeEqual leve si les tailles different, ce qui refuirait la
// longueur du secret. Deux empreintes SHA-256 font toujours 32 octets, donc la
// duree de la comparaison ne depend ni du contenu ni de la longueur.
function timingSafeEqualText(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return timingSafeEqualText(req.headers.authorization || '', `Bearer ${expected}`);
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
