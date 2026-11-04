const { updateLaneStatus } = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { requireStaffPermission } = require('../lib/staff-auth');
const { writeAuditLog, actorFromSession, newRequestId } = require('../lib/audit-log');

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  try {
    const body = await readJson(req);
    // Le centre nomme, sinon celui de la session, jamais un centre par defaut : fermer une piste a Gembloux fermait
    // celle de Libramont (audit du 2026-11-04).
    const session = await requireStaffPermission(req, res, ['planning.drag', 'settings.manage'], { centerId: body.centerId || body.center_id || '' });
    if (!session) return;
    const centerId = session.authorizedCenterId;
    if (!centerId || centerId === 'all') {
      sendError(res, 422, 'Choisissez un centre pour changer une piste.');
      return;
    }
    const lane = await updateLaneStatus(body.lane, body.status, centerId, {
      maintenanceFrom: body.maintenanceFrom || '',
      maintenanceUntil: body.maintenanceUntil || '',
      note: body.note || '',
    });
    // Bloquer une piste retire de la capacite reelle au centre : c'est une
    // modification qui a un effet commercial direct, et elle doit avoir un
    // auteur. Ecriture APRES le retour de updateLaneStatus, donc hors du
    // pg_advisory_xact_lock par piste que cette fonction tient (T5). Le statut
    // ancien/nouveau se lit en simples chaines : le diff est trivial, une
    // structure serait du bruit.
    const auditLane = await writeAuditLog({
      centerId,
      ...actorFromSession(session),
      surface: 'api/staff-lanes.js',
      action: 'updateLaneStatus',
      method: 'PATCH',
      entityType: 'lane',
      entityId: String(body.lane || ''),
      outcome: 'success',
      changes: { status: { before: null, after: String(body.status || '') } },
      context: {
        maintenanceFrom: body.maintenanceFrom || '',
        maintenanceUntil: body.maintenanceUntil || '',
        noteModifiee: Boolean(body.note),
      },
      requestId: newRequestId(),
    });
    sendJson(res, 200, {
      ok: true,
      lane,
      ...(auditLane.warning ? { warnings: [auditLane.warning] } : {}),
    });
  } catch (error) {
    sendError(res, error.statusCode || 400, require('../lib/http').publicErrorMessage(error, 'Impossible de mettre a jour la piste.'));
  }
};
