const { createReservation, getPool } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { findReservationAlternatives } = require('../lib/reservation-alternatives');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { refreshFormuleOverrides, bookingDateOutOfRange, BOOKING_HORIZON_DAYS } = require('../lib/booking-config');
const { refreshCatalog } = require('../lib/catalog-store');
const { refreshCenterOverrides } = require('../lib/ops-knowledge');
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
    // La date est bornee AVANT tout le reste : ni le champ du tunnel ni le
    // moteur n'avaient de limite haute, une reservation a deux ans passait.
    const dateVerdict = bookingDateOutOfRange(body && body.date);
    if (dateVerdict === 'past') {
      sendError(res, 422, 'Cette date est déjà passée. Choisissez une date à venir.');
      return;
    }
    if (dateVerdict === 'far') {
      sendError(res, 422, `Les réservations sont ouvertes jusqu'à ${BOOKING_HORIZON_DAYS} jours à l'avance. Choisissez une date plus proche.`);
      return;
    }
    // Overrides de CENTRE chauds AVANT tout le reste (sync). Un centre cree
    // depuis la console n'existe QUE en base : sans cette ligne, une instance
    // serverless fraiche ne connait que les centres du FICHIER
    // ops-knowledge/centers.json. getCenter leve alors « Centre inconnu », le
    // centre n'a ni pistes ni activites cochees, et AUCUNE de ses reservations
    // ne passe : 422 « Choisissez au moins une activite » quand le client a
    // choisi une activite libre (listCenterActivities ne la garde que si le
    // centre l'a cochee), 409 sans alternatives quand il a choisi le bowling.
    // Les creneaux, eux, s'affichaient : public-availability et
    // public-booking-meta font cet appel depuis le debut, pas ce handler.
    // Fail-soft comme les deux suivantes : sans base, socle fichier.
    try { await refreshCenterOverrides(getPool()); } catch (error) { /* socle fichier */ }
    // Carte d'overrides catalogue chaude AVANT le calcul du prix (sync) : une
    // instance serverless fraiche doit facturer le meme prix que celui affiche
    // par le tunnel (public-booking-meta). Fail-soft : sans base, prix fichier.
    try { await refreshFormuleOverrides(getPool()); } catch (error) { /* prix fichier */ }
    // Catalogue unifie chaud AVANT le calcul de prix et l'ancrage (sync). Meme
    // instance serverless fraiche facture / ancre comme le tunnel. Fail-soft.
    try { await refreshCatalog(getPool()); } catch (error) { /* catalogue fichier */ }
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
