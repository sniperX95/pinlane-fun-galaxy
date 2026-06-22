const { readStaffState } = require('../lib/database');
const { sendError, sendJson } = require('../lib/http');
const { requireStaffPermission } = require('../lib/staff-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const requestUrl = new URL(req.url, 'http://localhost');
    const date = requestUrl.searchParams.get('date');
    const centerId = requestUrl.searchParams.get('centerId') || 'libramont';
    const session = await requireStaffPermission(req, res, ['planning.view', 'dashboard.view', 'reservations.view'], { centerId });
    if (!session) return;
    if (!date) {
      sendError(res, 400, 'Date manquante.');
      return;
    }
    const snapshot = await readStaffState(date, centerId);
    const requestRevision = req.headers['if-none-match'];
    if (requestRevision && requestRevision === snapshot.revision) {
      res.statusCode = 304;
      res.setHeader('ETag', snapshot.revision);
      res.end();
      return;
    }
    res.setHeader('ETag', snapshot.revision);
    sendJson(res, 200, { ok: true, ...snapshot });
  } catch (error) {
    sendError(res, 500, error.message || 'Impossible de charger les donnees staff.');
  }
};
