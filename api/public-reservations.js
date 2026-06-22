const { createReservation } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { findReservationAlternatives } = require('../lib/reservation-alternatives');
const { normalizeReservationRequest } = require('../lib/reservation-request');

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  let request = null;

  try {
    const body = await readJson(req);
    request = normalizeReservationRequest(body, { channel: 'public' });
    const ops = await prepareReservationOps(request, 'public');
    if (ops.blockOnlineConfirmation) {
      const alternatives = await findReservationAlternatives(request, {
        channel: 'public',
        limit: 5,
        spanDays: 14,
        maxChecks: 160,
      });
      sendError(res, 409, alternatives.length
        ? 'Ce créneau ne tient plus, mais nous avons trouvé des alternatives compatibles.'
        : 'Ce créneau ne peut pas être planifié automatiquement. Merci de choisir un autre horaire.', {
        alternatives,
      });
      return;
    }
    const reservation = await createReservation({
      ...request,
      ...ops,
      channel: request.channel || 'public',
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
  } catch (error) {
    const statusCode = Number(error.statusCode || 0);
    if (statusCode && statusCode !== 400) {
      sendError(res, statusCode, error.message || 'Requete impossible.');
      return;
    }
    const alternatives = request
      ? await findReservationAlternatives(request, {
        channel: 'public',
        limit: 5,
        spanDays: 14,
        maxChecks: 160,
      }).catch(() => [])
      : [];
    sendError(res, alternatives.length ? 409 : 400, alternatives.length
      ? 'Ce créneau vient de changer. Choisissez une des alternatives compatibles ci-dessous.'
      : (error.message || 'Impossible de créer la réservation.'), {
      alternatives,
    });
  }
};
