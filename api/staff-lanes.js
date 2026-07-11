const { updateLaneStatus } = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { requireStaffPermission } = require('../lib/staff-auth');

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  try {
    const body = await readJson(req);
    const centerId = body.centerId || body.center_id || 'libramont';
    const session = await requireStaffPermission(req, res, ['planning.drag', 'settings.manage'], { centerId });
    if (!session) return;
    const lane = await updateLaneStatus(body.lane, body.status, centerId, {
      maintenanceFrom: body.maintenanceFrom || '',
      maintenanceUntil: body.maintenanceUntil || '',
      note: body.note || '',
    });
    sendJson(res, 200, { ok: true, lane });
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || 'Impossible de mettre a jour la piste.');
  }
};
