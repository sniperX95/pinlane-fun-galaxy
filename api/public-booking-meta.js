const { DURATION_OPTIONS, FORMULES, todayStr } = require('../lib/booking-config');
const { sendError, sendJson, setCors } = require('../lib/http');

module.exports = async (req, res) => {
  setCors(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  sendJson(res, 200, {
    ok: true,
    today: todayStr(),
    durationOptions: DURATION_OPTIONS,
    formules: FORMULES,
  });
};
