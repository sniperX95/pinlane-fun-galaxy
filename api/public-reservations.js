const { createReservation } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { findReservationAlternatives } = require('../lib/reservation-alternatives');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { enforceRateLimit } = require('../lib/rate-limit');

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

  if (enforceRateLimit(req, res, { scope: 'public-reservations', limit: 10, windowMs: 60_000 })) {
    return;
  }

  let request = null;

  try {
    const body = await readJson(req);
    request = normalizeReservationRequest(body, { channel: 'public', requireEmail: true });
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
      channel: 'public',
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
    // Même politique que staff-reservations : les messages métier (français,
    // contrôlés) passent, les erreurs d'infrastructure (Postgres/Neon/réseau)
    // ne fuient jamais vers le public : on les log et on renvoie un 503 neutre.
    const raw = String((error && error.message) || '');
    const isInfra = !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
    if (isInfra) {
      console.error('[public-reservations] échec', error && (error.stack || raw || error));
      sendError(res, 503, 'Réservation momentanément indisponible. Réessayez dans un instant.');
      return;
    }
    const statusCode = Number(error.statusCode || 0);
    if (statusCode && statusCode !== 400) {
      sendError(res, statusCode, raw || 'Requete impossible.');
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
      : (raw || 'Impossible de créer la réservation.'), {
      alternatives,
    });
  }
};
