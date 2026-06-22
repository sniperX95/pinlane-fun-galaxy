const { dispatchDueCommunications } = require('../../lib/ops-communications');
const { sendError, sendJson } = require('../../lib/http');

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.authorization === `Bearer ${expected}`;
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
    const result = await dispatchDueCommunications({ limit: 50 });
    sendJson(res, 200, result);
  } catch (error) {
    sendError(res, 500, error.message || 'Dispatch communications impossible.');
  }
};
