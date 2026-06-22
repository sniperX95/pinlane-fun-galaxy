const { createOpsEvent, createReservation, deleteReservation, updateReservation } = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { requireStaffPermission } = require('../lib/staff-auth');

function patchNeedsOnlyStatus(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => key !== 'id' && key !== 'centerId' && key !== 'center_id');
  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes'].includes(key));
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const body = await readJson(req);
      const session = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });
      if (!session) return;
      const request = normalizeReservationRequest(body, { channel: 'staff' });
      const ops = await prepareReservationOps(request, 'staff');
      const reservation = await createReservation({
        ...request,
        ...ops,
        channel: request.channel || 'staff',
      });
      const postCreate = await afterReservationCreated(reservation, request);
      sendJson(res, 201, {
        ok: true,
        reservation,
        ops: {
          riskLevel: reservation.riskLevel,
          riskScore: reservation.riskScore,
          validationStatus: reservation.validationStatus,
          planWarning: ops.planWarning,
          autoDecision: ops.requiresHumanReview ? 'human_review_required' : 'auto_confirmed',
        },
        communications: postCreate.communications,
        warnings: postCreate.warnings,
      });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const permission = patchNeedsOnlyStatus(body) ? ['reservations.status', 'reservations.edit'] : 'reservations.edit';
      const session = await requireStaffPermission(req, res, permission, { centerId: body.centerId || body.center_id });
      if (!session) return;
      const shouldReplan = !body.skipReplan && [
        'date',
        'startTime',
        'duration',
        'totalDuration',
        'pax',
        'type',
        'formuleId',
        'formulaId',
        'lanes',
        'laneCount',
        'requiresLanes',
        'preference',
        'laserGames',
        'games',
        'gameCount',
      ].some((field) => Object.prototype.hasOwnProperty.call(body || {}, field));
      const ops = shouldReplan
        ? await prepareReservationOps(body, 'staff', { ignoreReservationId: Number(body.id) })
        : {};
      const reservation = await updateReservation({
        ...body,
        ...ops,
        channel: body.channel || 'staff',
      });
      await createOpsEvent({
        centerId: reservation.centerId || 'libramont',
        reservationId: reservation.id,
        formulaId: reservation.formuleId || '',
        eventType: 'reservation_updated',
        payload: {
          status: reservation.status,
          validationStatus: reservation.validationStatus,
          fields: Object.keys(body || {}),
        },
      }).catch(() => null);
      sendJson(res, 200, { ok: true, reservation });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const session = await requireStaffPermission(req, res, 'reservations.cancel', { centerId: body.centerId || body.center_id });
      if (!session) return;
      await deleteReservation(body.id);
      await createOpsEvent({
        centerId: body.centerId || 'libramont',
        reservationId: body.id,
        eventType: 'reservation_deleted',
        payload: { source: 'staff' },
      }).catch(() => null);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || 'Operation reservation impossible.');
  }
};
