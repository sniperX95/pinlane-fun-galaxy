const {
  cancelReservationCommunications,
  cancelReservationOpsJobs,
  createOpsEvent,
  createReservation,
  deleteReservation,
  getReservationById,
  updateReservation,
  setReservationActivityProgress,
} = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { enqueueReservationCommunications } = require('../lib/ops-communications');
const { enqueueReservationAutomation } = require('../lib/ops-jobs');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { requireStaffPermission } = require('../lib/staff-auth');

const REPLAN_FIELDS = [
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
];

const AUTOMATION_REFRESH_FIELDS = [
  ...REPLAN_FIELDS,
  'centerId',
  'center_id',
  'email',
  'phone',
  'status',
  'validationStatus',
  'validation_status',
  'opsPlan',
  'ops_plan',
];

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hasAnyField(body = {}, fields = []) {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(body || {}, field));
}

function patchNeedsOnlyStatus(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => key !== 'id' && key !== 'centerId' && key !== 'center_id');
  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes', 'activityProgress', 'activity_progress'].includes(key));
}

// Un PATCH qui ne touche QUE le suivi d'activités (cocher/décocher) : chemin rapide
// dédié, aucune re-validation planning (pistes/laser/créneau).
function patchIsActivityProgressOnly(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => key !== 'id' && key !== 'centerId' && key !== 'center_id');
  return keys.length === 1 && (keys[0] === 'activityProgress' || keys[0] === 'activity_progress');
}

function isFormulaPatch(body = {}) {
  return body.type === 'formule' || Boolean(body.formuleId || body.formulaId);
}

async function cancelPendingAutomation(reservation, reason) {
  if (!reservation?.id) return { communications: 0, jobs: 0 };
  const [communications, jobs] = await Promise.all([
    cancelReservationCommunications({
      reservationId: reservation.id,
      centerId: reservation.centerId || 'libramont',
      reason,
    }),
    cancelReservationOpsJobs({
      reservationId: reservation.id,
      centerId: reservation.centerId || 'libramont',
      reason,
    }),
  ]);
  return { communications: communications.length, jobs: jobs.length };
}

async function refreshReservationAutomation(current, reservation, options = {}) {
  const cancelled = await cancelPendingAutomation(current, options.reason || 'reservation_updated');
  if (reservation.centerId && current.centerId && reservation.centerId !== current.centerId) {
    const movedCleanup = await cancelPendingAutomation(reservation, options.reason || 'reservation_updated');
    cancelled.communications += movedCleanup.communications;
    cancelled.jobs += movedCleanup.jobs;
  }

  if (reservation.status === 'cancelled') {
    return { ...cancelled, refreshed: false };
  }

  await Promise.all([
    enqueueReservationAutomation(reservation).catch(() => []),
    enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus || options.validationMode,
    }).catch(() => []),
  ]);

  return { ...cancelled, refreshed: true };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const body = await readJson(req);
      const session = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });
      if (!session) return;
      // Côté STAFF le contact est LIBRE (nom/tél/email non imposés) : le staff
      // crée souvent une résa au comptoir sans tout saisir. L'email obligatoire
      // reste réservé au parcours CLIENT PUBLIC (api/public-reservations.js).
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
      if (!body.id) throw createHttpError('Reservation manquante.', 400);

      const current = await getReservationById(body.id);
      if (!current) throw createHttpError('Reservation introuvable.', 404);

      const requestedCenterId = body.centerId || body.center_id || current.centerId || 'libramont';
      const permission = patchNeedsOnlyStatus(body) ? ['reservations.status', 'reservations.edit'] : 'reservations.edit';
      const session = await requireStaffPermission(req, res, permission, { centerId: current.centerId || 'libramont' });
      if (!session) return;

      if (requestedCenterId !== (current.centerId || 'libramont')) {
        const switchSession = await requireStaffPermission(req, res, 'centers.switch', { centerId: requestedCenterId });
        if (!switchSession) return;
      }

      // Chemin rapide : cocher/décocher une activité de formule. On écrit UNIQUEMENT
      // activity_progress, SANS re-valider pistes/laser/créneau (rien du planning ne
      // change) → plus de faux « Ce créneau vient de changer » qui annulait la coche.
      if (patchIsActivityProgressOnly(body)) {
        const updated = await setReservationActivityProgress(
          current.id,
          current.centerId || 'libramont',
          body.activityProgress ?? body.activity_progress,
        );
        sendJson(res, 200, { ok: true, reservation: updated, automation: { communications: 0, jobs: 0, refreshed: false } });
        return;
      }

      const patch = {
        ...body,
        centerId: requestedCenterId,
      };
      const shouldReplan = (!patch.skipReplan || isFormulaPatch(patch)) && hasAnyField(patch, REPLAN_FIELDS);
      const ops = shouldReplan
        ? await prepareReservationOps(patch, 'staff', { ignoreReservationId: Number(patch.id) })
        : {};
      const reservation = await updateReservation({
        ...patch,
        ...ops,
        channel: patch.channel || current.channel || 'staff',
      });
      const automation = hasAnyField(patch, AUTOMATION_REFRESH_FIELDS)
        ? await refreshReservationAutomation(current, reservation, { reason: 'reservation_updated' })
        : { communications: 0, jobs: 0, refreshed: false };

      await createOpsEvent({
        centerId: reservation.centerId || current.centerId || 'libramont',
        reservationId: reservation.id,
        formulaId: reservation.formuleId || '',
        eventType: 'reservation_updated',
        payload: {
          status: reservation.status,
          validationStatus: reservation.validationStatus,
          fields: Object.keys(body || {}),
          automation,
        },
      }).catch(() => null);
      sendJson(res, 200, { ok: true, reservation, automation });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      if (!body.id) throw createHttpError('Reservation manquante.', 400);
      const current = await getReservationById(body.id);
      if (!current) throw createHttpError('Reservation introuvable.', 404);
      const session = await requireStaffPermission(req, res, 'reservations.cancel', { centerId: current.centerId || 'libramont' });
      if (!session) return;
      const automation = await cancelPendingAutomation(current, 'reservation_deleted');
      await deleteReservation(body.id);
      await createOpsEvent({
        centerId: current.centerId || 'libramont',
        reservationId: current.id,
        eventType: 'reservation_deleted',
        payload: { source: 'staff', automation },
      }).catch(() => null);
      sendJson(res, 200, { ok: true, automation });
      return;
    }

    sendError(res, 405, 'Methode non autorisee.');
  } catch (error) {
    // On montre les messages métier (français, contrôlés : "Aucune piste
    // disponible", "Ce créneau vient de changer"…) car le staff en a besoin.
    // On masque UNIQUEMENT les erreurs d'infrastructure (Postgres/Neon/réseau)
    // qui ne doivent jamais fuir à l'écran, et on les log.
    const raw = String((error && error.message) || '');
    const isInfra = !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
    if (isInfra) {
      console.error('[staff-reservations] échec', error && (error.stack || raw || error));
      sendError(res, 503, 'Opération réservation impossible pour le moment. Réessayez.');
      return;
    }
    sendError(res, (error && error.statusCode) || 400, raw);
  }
};
