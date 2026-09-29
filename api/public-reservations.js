const crypto = require('crypto');
const {
  createReservation,
  createSlotHold,
  releaseSlotHold,
  reservationDejaConfirmee,
  precisionBlocagesEnCours,
  readStaffState,
  nouveauJetonBlocage,
  empreinteJetonBlocage,
} = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { afterReservationCreated, dotationDepassee, prepareReservationOps } = require('../lib/reservation-ops');
const { findReservationAlternatives } = require('../lib/reservation-alternatives');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { ouvrirDemandePublique, estErreurInfra, signatureDemande } = require('../lib/demande-publique');
const { enforceRateLimit, getClientIp } = require('../lib/rate-limit');

// La reponse a une confirmation deja faite (le client renvoie la meme) : sa
// reservation, telle qu elle est en base, sans en creer une deuxieme ni
// renvoyer de message.
function reponseRejouee(res, reservation) {
  sendJson(res, 200, {
    ok: true,
    replay: true,
    reservation,
    ops: {
      riskLevel: reservation.riskLevel,
      riskScore: reservation.riskScore,
      validationStatus: reservation.validationStatus,
      autoDecision: reservation.validationStatus === 'staff_review' ? 'human_review_required' : 'auto_confirmed',
    },
    communications: [],
    warnings: [],
  });
}

// L appareil, pour le plafond de blocages : l empreinte de son adresse, jamais
// l adresse. Poivree par le secret du serveur quand il existe : sans lui, une
// empreinte d IPv4 se retrouverait en essayant les quatre milliards.
function empreinteAppareil(req) {
  const ip = String(getClientIp(req) || '').trim();
  if (!ip || ip === 'unknown') return '';
  return crypto.createHmac('sha256', `pinlane-slot-holds:${process.env.STAFF_AUTH_SECRET || ''}`).update(ip).digest('hex');
}

// BLOQUER LES HORAIRES CHOISIS (migration 0049, POST /api/public-holds,
// reecrit ici par vercel.json). Le client retient ses horaires en passant a
// ses coordonnees : DUREE_BLOCAGE_MINUTES pendant lesquelles personne d autre
// ne peut les prendre. Les memes portes que la reservation, le meme moteur, la
// meme verification sous verrou (lib/database createSlotHold). Aucune donnee
// personnelle : le corps est celui de la reservation, sans nom, telephone ni
// e-mail. `release: true` libere tout de suite (le client change d avis).
async function traiterBlocage(req, res) {
  if (enforceRateLimit(req, res, { scope: 'public-holds', limit: 30, windowMs: 60_000 })) {
    return;
  }
  try {
    const body = await readJson(req);
    if (body && body.release === true) {
      const libere = await releaseSlotHold(body.holdToken);
      sendJson(res, 200, { ok: true, released: libere.released });
      return;
    }
    const porte = await ouvrirDemandePublique(body);
    if (!porte.ok) {
      sendError(res, porte.status, porte.message, porte.extra);
      return;
    }
    const recu = String((body && body.holdToken) || '').trim();
    const jeton = empreinteJetonBlocage(recu) ? recu : nouveauJetonBlocage();
    const request = normalizeReservationRequest({ ...body, name: '', phone: '', email: '', notes: '' }, { channel: 'public' });
    const ops = await prepareReservationOps(request, 'public', { saufJeton: jeton });
    if (ops.blockOnlineConfirmation) {
      // Pris par une reservation, ou retenus par un autre client en train de
      // reserver ? Le moteur rejoue sans les blocages : s il trouve alors,
      // ce sont eux, et on dit quand la place se libere au plus tard.
      const sansBlocages = await prepareReservationOps(request, 'public', { readState: (date, centre) => readStaffState(date, centre) });
      const precision = sansBlocages.blockOnlineConfirmation
        ? ''
        : await precisionBlocagesEnCours({ ...request, ...sansBlocages }, { saufJeton: jeton });
      sendError(res, 409, `Ces horaires ne sont plus libres.${precision || ' Choisissez-en d’autres.'}`, { code: 'slot_unavailable' });
      return;
    }
    // Les pistes du plan que le moteur vient de composer, pas celles de la
    // page des horaires : elles ont pu etre prises depuis, celles-ci sont
    // libres maintenant (le client ne voit jamais un numero de piste).
    const pistesDuPlan = ops.opsPlan && Array.isArray(ops.opsPlan.assignedLanes) ? ops.opsPlan.assignedLanes : [];
    const blocage = await createSlotHold({
      ...request,
      ...ops,
      ...(pistesDuPlan.length ? { lanes: pistesDuPlan } : {}),
      channel: 'public',
    }, {
      jeton,
      empreinteAppareil: empreinteAppareil(req),
      signatureDemande: signatureDemande(request),
      verifierProgramme: (reservations) => dotationDepassee(request, reservations),
    });
    sendJson(res, 201, {
      ok: true,
      holdToken: jeton,
      expiresAt: blocage.expiresAt,
      minutes: blocage.minutes,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    const raw = String((error && error.message) || '');
    // Deux demandes du meme ecran se sont croisees (index unique du jeton) :
    // la derniere arrivee se refait.
    if (error && error.code === '23505') {
      sendError(res, 409, 'Un autre choix vient d’être retenu depuis cette page. Réessayez.', { code: 'hold_retry' });
      return;
    }
    // Toute autre erreur de la base (un code SQLSTATE) n est jamais « horaires
    // pris » : le formulaire continue sans blocage, la confirmation reverifie.
    if (estErreurInfra(error) || /^[0-9A-Z]{5}$/.test(String((error && error.code) || ''))) {
      console.error('[public-holds] échec', error && (error.stack || raw || error));
      sendError(res, 503, 'Vos horaires n’ont pas pu être retenus pour le moment.', { code: 'hold_unavailable' });
      return;
    }
    if (error && error.code === 'reservation_deja_confirmee') {
      sendError(res, 409, raw, { code: 'already_confirmed' });
      return;
    }
    const statusCode = Number(error.statusCode || 0);
    if (statusCode && statusCode !== 400) {
      sendError(res, statusCode, raw || 'Requete impossible.', statusCode === 429 ? { code: 'hold_limit' } : {});
      return;
    }
    // Le refus du controle sous verrou : un autre client a pris ou retient ces
    // horaires. Le motif technique (« Aucune piste disponible pour 1
    // piste(s) », « 1/1 lancement ») ne sert pas au client ; la phrase qui
    // dit quand la place se libere, si. Elle n est ajoutee par lib/database
    // que si les blocages en cours sont bien la cause du refus.
    const precision = (raw.match(/ Une réservation en ligne est en cours sur ce créneau[^.]*\./) || [''])[0];
    sendError(res, 409, `Ces horaires ne sont plus libres.${precision || ' Choisissez-en d’autres.'}`, { code: 'slot_taken' });
  }
}

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

  if (new URL(req.url, 'https://localhost').searchParams.get('action') === 'hold') {
    await traiterBlocage(req, res);
    return;
  }

  if (enforceRateLimit(req, res, { scope: 'public-reservations', limit: 10, windowMs: 60_000 })) {
    return;
  }

  let request = null;
  let holdToken = '';

  try {
    const body = await readJson(req);
    // Les portes d une demande publique (centre, date, demonstration, statut
    // du centre, grands groupes, catalogue chaud) : les memes que le blocage
    // des horaires, lib/demande-publique.
    const porte = await ouvrirDemandePublique(body);
    if (!porte.ok) {
      sendError(res, porte.status, porte.message, porte.extra);
      return;
    }
    // LE BLOCAGE DU CLIENT (migration 0049) : ses horaires, retenus pendant
    // qu il remplissait ses coordonnees, ne le bloquent pas lui-meme, et
    // deviennent sa reservation dans la meme transaction.
    holdToken = String((body && body.holdToken) || '').trim();
    request = normalizeReservationRequest(body, { channel: 'public', requireEmail: true });
    // La meme confirmation, renvoyee apres une reponse perdue : la
    // reservation deja creee, jamais une deuxieme. Avant le moteur, qui
    // verrait la premiere occuper la place et proposerait d autres horaires.
    const deja = holdToken ? await reservationDejaConfirmee(holdToken) : null;
    if (deja) {
      reponseRejouee(res, deja);
      return;
    }
    const ops = await prepareReservationOps(request, 'public', { saufJeton: holdToken });
    if (ops.blockOnlineConfirmation) {
      const alternatives = await findReservationAlternatives(request, {
        channel: 'public',
        limit: 5,
        spanDays: 14,
        maxChecks: 160,
        saufJeton: holdToken,
      });
      sendError(res, 409, alternatives.length
        ? 'Ce créneau ne tient plus, mais nous avons trouvé des alternatives compatibles.'
        : 'Ce créneau ne peut pas être planifié automatiquement. Merci de choisir un autre horaire.', {
        alternatives,
      });
      return;
    }
    // Les pistes du plan que le moteur vient de composer, comme pour le
    // blocage : celles de la page des horaires ont pu etre prises pendant que
    // le client remplissait ses coordonnees (le moteur les garde quand elles
    // sont encore libres). Un blocage en cours reprend, lui, les siennes sous
    // le verrou (lib/database planDuBlocage).
    const pistesDuPlan = ops.opsPlan && Array.isArray(ops.opsPlan.assignedLanes) ? ops.opsPlan.assignedLanes : [];
    const reservation = await createReservation({
      ...request,
      ...ops,
      ...(pistesDuPlan.length ? { lanes: pistesDuPlan } : {}),
      channel: 'public',
      holdToken,
      signatureDemande: signatureDemande(request),
      // Les installations comptees (pistes de duckpin, tables) se reverifient
      // SOUS le verrou de la journee : deux demandes simultanees ne prennent
      // plus toutes deux la derniere unite.
      verifierProgramme: (reservations) => dotationDepassee(request, reservations),
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
    // Deux envois simultanes de la meme confirmation : le second rend la
    // reservation du premier (lib/database, sous le verrou de la journee).
    if (error && error.code === 'reservation_deja_confirmee' && error.reservation) {
      reponseRejouee(res, error.reservation);
      return;
    }
    // Même politique que staff-reservations : les messages métier (français,
    // contrôlés) passent, les erreurs d'infrastructure (Postgres/Neon/réseau)
    // ne fuient jamais vers le public : on les log et on renvoie un 503 neutre.
    const raw = String((error && error.message) || '');
    if (estErreurInfra(error)) {
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
        saufJeton: holdToken,
      }).catch(() => [])
      : [];
    sendError(res, alternatives.length ? 409 : 400, alternatives.length
      ? 'Ce créneau vient de changer. Choisissez une des alternatives compatibles ci-dessous.'
      : (raw || 'Impossible de créer la réservation.'), {
      alternatives,
    });
  }
};
