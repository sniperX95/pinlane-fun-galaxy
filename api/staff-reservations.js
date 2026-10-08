const {
  cancelReservationCommunications,
  cancelReservationOpsJobs,
  createOpsEvent,
  createReservation,
  deleteReservation,
  getReservationById,
  updateReservation,
  setReservationStatus,
  setReservationActivityProgress,
  setReservationActivityDone,
  noterReservationEquipe,
  lireVersionAttendue,
  memeVersion,
  reservationModifieeEntreTemps,
  lireHistoriqueClient,
} = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { enqueueReservationCommunications } = require('../lib/ops-communications');
const { enqueueReservationAutomation } = require('../lib/ops-jobs');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { requireStaffPermission, getStaffSessionFromRequest } = require('../lib/staff-auth');
const { writeAuditLog, actorFromSession, buildChanges, newRequestId } = require('../lib/audit-log');
const { reservationChanges, reservationSnapshot, libelleMembre } = require('../lib/registre');
const { refreshCenterOverrides } = require('../lib/ops-knowledge');
const { refreshFormuleOverrides, getBasePrice } = require('../lib/booking-config');
const { refreshCatalog } = require('../lib/catalog-store');
const { getPool } = require('../lib/database');

// LE COMPTOIR CONNAIT LES MEMES CENTRES QUE LE TUNNEL (2026-08-21).
//
// Ce handler normalisait un programme et planifiait un creneau sans jamais
// rechauffer les trois caches module (centres, prix, catalogue). Sur une
// instance serverless fraiche, il ne voyait donc que les centres du FICHIER
// ops-knowledge/centers.json : pour un centre cree depuis la console, getCenter
// levait « Centre inconnu », aucune activite libre n'etait retenue (le
// catalogue d'un centre se lit dans SA fiche) et createReservation refusait.
// Meme cause, meme correctif et meme ordre que api/public-reservations.js.
//
// Fail-soft en trois try separes : un incident base laisse le comptoir
// travailler sur le dernier etat connu au lieu de le bloquer.
// Appele APRES le controle de permission, jamais avant : ce depot ne lit pas la
// base pour un inconnu (cf requireAnyStaffSession plus bas).
async function warmCenterKnowledge() {
  try { await refreshCenterOverrides(getPool()); } catch (error) { /* socle fichier */ }
  try { await refreshFormuleOverrides(getPool()); } catch (error) { /* prix fichier */ }
  try { await refreshCatalog(getPool()); } catch (error) { /* catalogue fichier */ }
}

// ---- PP4 : le chemin chaud -------------------------------------------------
//
// L avant/apres d une reservation. C'est la question numero 1 du mandat ("qui
// a modifie ce prix, cette reservation").
//
// Le cout de lecture est NUL : `current` est deja charge par getReservationById
// pour les besoins de la validation (PATCH et DELETE). L'etat AVANT est en
// memoire, il etait simplement jete.
//
// LE REGISTRE (2026-10-05, lib/registre.js) : la liste des champs n est plus
// recopiee ici. Elle nommait `clientName` alors que l objet porte `name` : le
// nom du client n a JAMAIS ete journalise, le telephone non plus, et la note
// ne l etait qu en longueur. L instantane est derive des clefs reelles de
// mapReservation : nom, telephone, e-mail, notes en texte complet, prix,
// statut, moyen de paiement, programme, pistes, resume du plan. C est ce qu il
// faut pour retrouver un dossier abime, et le gate scripts/registre-check.js
// prouve qu aucune clef de l objet ne manque a l instantane.
//
// `registre.avant` / `registre.apres` dans le contexte : l etat COMPLET avant et
// apres une modification, pas seulement les champs qui ont bouge. Chaque etat
// par lequel un dossier est passe se relit donc dans le journal.
function buildReservationAuditChanges(before, after) {
  return reservationChanges(before, after);
}

function contexteRegistre(before, after, extra = {}) {
  return {
    ...extra,
    registre: {
      avant: reservationSnapshot(before),
      apres: reservationSnapshot(after),
    },
  };
}

// LA BOITE DE SECOURS SUIT LES VRAIS CHANGEMENTS (2026-10-05) : date, heure,
// effectif, programme, coordonnees, prix, annulation, suppression. Pas une
// arrivee ni un paiement : la feuille renvoyee tous les quarts d heure les
// porte deja, un mail par clic noierait la boite.
const CHAMPS_COPIE_SECOURS = ['date', 'startTime', 'pax', 'program', 'formuleId', 'formulaId', 'type', 'name', 'phone', 'email', 'price', 'notes', 'duration', 'totalDuration', 'lanes'];
async function copierAuSecours(reservation, evenement, avant, session) {
  const { copieSecours } = require('../lib/secours-envoi');
  const par = (session && session.member && session.member.name) || '';
  const r = await copieSecours(reservation, { evenement, avant, par });
  return r && r.erreur ? `secours:${r.erreur}` : '';
}

const REPLAN_FIELDS = [
  // Changer les ACTIVITES d un dossier (formule adaptee au comptoir) doit
  // replanifier : les horaires et les ressources en dependent. Sans `program`
  // ici, un PATCH qui ne portait que le programme passait sans replan et les
  // nouvelles activites n avaient ni creneau ni piste (2026-08-26).
  'program',
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

// Le comptoir renvoie souvent le dossier entier pour modifier un contact.
// Seuls les choix réellement changés justifient une nouvelle cotation/placement.
function operationalProgram(program, pax) {
  const items = Array.isArray(program) ? program : program?.items;
  if (!Array.isArray(items) || !items.length) return null;
  return items.map((item) => {
    const activityId = String(item.activityId || item.id || '');
    const choice = { activityId, participants: Number(item.participants ?? pax) };
    if (item.upsell) choice.upsell = { offerId: String(item.upsell.offerId || ''), participants: Number(item.upsell.participants) };
    if (item.extraLaser) choice.extraLaser = { offerId: String(item.extraLaser.offerId || ''), participants: Number(item.extraLaser.participants), games: Number(item.extraLaser.games) };
    if (activityId === 'arcade_time' && item.arcadeOfferId) {
      choice.arcadeMode = String(item.arcadeMode || '');
      choice.arcadeOfferId = String(item.arcadeOfferId);
      choice.cards = Number(item.cards ?? choice.participants);
    } else {
      for (const key of ['duration', 'games', 'units', 'hours', 'minutes', 'sessionMinutes', 'waitOffer', 'dayAccess']) {
        if (item[key] != null) choice[key] = typeof item[key] === 'boolean' ? item[key] : Number(item[key]);
      }
    }
    return choice;
  });
}

function patchChangesOperations(patch, current) {
  const nextProgram = Object.prototype.hasOwnProperty.call(patch, 'program') ? patch.program : current.program;
  if (JSON.stringify(operationalProgram(nextProgram, patch.pax ?? current.pax))
    !== JSON.stringify(operationalProgram(current.program, current.pax))) return true;
  const items = Array.isArray(nextProgram) ? nextProgram : nextProgram?.items;
  const ownParticipants = Array.isArray(items) && items.length > 0
    && items.every((item) => Number.isInteger(Number(item.participants)) && Number(item.participants) > 0);
  const comparable = (value) => value == null || value === '' ? ''
    : /^-?\d+(\.\d+)?$/.test(String(value)) ? String(Number(value)) : String(value);
  for (const key of REPLAN_FIELDS.filter((field) => !['program', 'pax', 'formulaId', 'laneCount', 'requiresLanes'].includes(field))) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (key === 'lanes') {
      if (JSON.stringify((patch.lanes || []).map(Number)) !== JSON.stringify((current.lanes || []).map(Number))) return true;
    } else if (comparable(patch[key]) !== comparable(current[key])) return true;
  }
  if (patch.formulaId != null && comparable(patch.formulaId) !== comparable(current.formuleId)) return true;
  if (!ownParticipants && patch.pax != null && Number(patch.pax) !== Number(current.pax)) return true;
  const lanes = current.lanes || [];
  if (patch.laneCount != null && Number(patch.laneCount) !== Number(current.laneCount ?? lanes.length)) return true;
  if (patch.requiresLanes != null && Boolean(patch.requiresLanes) !== Boolean(current.requiresLanes ?? lanes.length > 0)) return true;
  return comparable(patch.centerId) !== comparable(current.centerId || 'libramont');
}

function patchNeedsOnlyStatus(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes', 'activityProgress', 'activity_progress', 'activityToggle', 'noteEquipe'].includes(key));
}

// Un PATCH qui ne touche QUE le suivi d'activités (cocher/décocher) : chemin rapide
// dédié, aucune re-validation planning (pistes/laser/créneau).
function patchIsActivityProgressOnly(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => key !== 'id' && key !== 'centerId' && key !== 'center_id');
  return keys.length === 1 && (keys[0] === 'activityProgress' || keys[0] === 'activity_progress');
}

// La coche d UNE activite (activityToggle : { key, done, doneAt, by }). Le
// suivi entier (activityProgress) reste accepte pour un onglet ouvert avant le
// deploiement, mais c est lui qui perd la coche d un autre poste.
function patchIsActivityToggleOnly(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => key !== 'id' && key !== 'centerId' && key !== 'center_id');
  return keys.length === 1 && keys[0] === 'activityToggle'
    && Boolean(body.activityToggle) && typeof body.activityToggle === 'object';
}

// Une note de l equipe ajoutee ou retiree (noteEquipe : { ajout } ou
// { retrait: le }) : comme la coche, elle s applique sur ce qui est en base.
function patchIsNoteEquipeOnly(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
  return keys.length === 1 && keys[0] === 'noteEquipe'
    && Boolean(body.noteEquipe) && typeof body.noteEquipe === 'object';
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

// PROUVER QUI ON EST AVANT DE LIRE LA BASE (corrige 2026-08-20, trouve en
// verifiant la prod). PATCH et DELETE lisaient la reservation AVANT tout
// controle de session, parce que la permission depend du centre de cette
// reservation. Consequence mesuree sur app.pinlane.be : un inconnu recevait
// 404 pour un id inexistant et 401 pour un id existant. C'est un oracle
// d'enumeration (quels ids existent) et, accessoirement, une lecture de base
// offerte a n'importe qui, en boucle, sans compte.
//
// Deux etages, dans cet ordre : (1) as-tu une session staff valide, sinon 401
// sans avoir rien lu ni rien revele ; (2) une fois la reservation lue, as-tu
// le droit d'agir sur SON centre, ce qui reste le controle qui compte.
async function requireAnyStaffSession(req, res) {
  const session = await getStaffSessionFromRequest(req);
  if (!session) {
    sendError(res, 401, 'Session staff requise.');
    return null;
  }
  return session;
}

// LA FENETRE RESERVER LIT LE PLAN AVANT DE CREER (2026-10-08, Movsar : « tout
// bien reference », « aucun bug quand on change d horaire »). Un corps qui porte
// `dryRun: true` est normalise et planifie par le MEME moteur que la creation,
// sur la journee lue en base, puis la reponse part sans rien ecrire : la
// fenetre montre les heures, les pistes et les departs laser que la creation
// posera, au lieu d une estimation du navigateur.
function heureDuPlan(valeur) {
  return typeof valeur === 'string' && /^\d{1,2}:\d{2}/.test(valeur) ? valeur.slice(0, 5) : '';
}
function nombreDuPlan(valeur) {
  return valeur === undefined || valeur === null || valeur === '' || !Number.isFinite(Number(valeur)) ? null : Number(valeur);
}
// La fin annoncee est celle des ACTIVITES : opsPlan.endTime ajoute la marge de
// risque du moteur (5 a 30 min), un tampon pour l equipe, pas une heure a
// dire au client.
function finDesActivites(plan) {
  const minutes = (heure) => { const [h, m] = String(heure || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  const fins = [...(plan.resourceBlocks || []), ...(plan.timeline || [])].map((pas) => minutes(heureDuPlan(pas && pas.endTime))).filter((v) => v !== null);
  if (fins.length) { const fin = Math.max(...fins); return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`; }
  const brute = minutes(heureDuPlan(plan.endTime));
  if (brute === null) return '';
  const fin = brute - (Number(plan.bufferMinutes) || 0);
  return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
}
// `dossier` est l objet exact que createReservation recevrait : le prix, le
// libelle et le plan se lisent la, jamais dans la requete d avant le moteur.
function resumerPlanPourLaFenetre(dossier = {}, ops = {}) {
  const plan = dossier.opsPlan && typeof dossier.opsPlan === 'object' ? dossier.opsPlan : null;
  const blocs = Array.isArray(plan && plan.resourceBlocks) ? plan.resourceBlocks : [];
  const etapes = Array.isArray(plan && plan.timeline) ? plan.timeline : [];
  const activiteDuBloc = (bloc) => String(bloc.activityId
    || (bloc.resourceType === 'bowling_lane' ? 'bowling' : bloc.resourceType === 'laser_arena' ? 'laser_game' : ''));
  return {
    disponible: Boolean(plan) && ops.planAvailable !== false,
    debut: heureDuPlan(plan && plan.startTime) || heureDuPlan(dossier.startTime),
    fin: plan ? finDesActivites(plan) : '',
    validation: ops.validationStatus || '',
    refus: ops.planRefusal ? String(ops.planRefusal) : '',
    avertissement: ops.planWarning ? String(ops.planWarning) : '',
    raison: (ops.validation && ops.validation.raison) || '',
    aSurveiller: ((ops.validation && ops.validation.aSurveiller) || []).map((item) => item && item.phrase).filter(Boolean),
    blocs: blocs.map((bloc) => ({
      activite: activiteDuBloc(bloc),
      ressource: String(bloc.resourceType || ''),
      debut: heureDuPlan(bloc.startTime),
      fin: heureDuPlan(bloc.endTime),
      pistes: Array.isArray(bloc.lanes) ? bloc.lanes.map(Number).filter(Number.isFinite) : [],
      joueurs: nombreDuPlan(bloc.players),
      partie: nombreDuPlan(bloc.countIndex),
      vague: nombreDuPlan(bloc.groupWaveIndex),
      vagues: nombreDuPlan(bloc.groupWaveCount),
      joueursAvant: nombreDuPlan(bloc.playersBefore),
      placesRestantes: nombreDuPlan(bloc.remainingWeapons),
      partagee: Boolean(bloc.sharedSession),
    })),
    etapes: etapes.map((etape) => ({
      activite: String(etape.activityId || ''),
      debut: heureDuPlan(etape.startTime),
      fin: heureDuPlan(etape.endTime),
      libelle: String(etape.label || ''),
      libre: Boolean(etape.flexible),
    })).filter((etape) => etape.activite && etape.debut),
    prix: nombreDuPlan(dossier.price),
    prixReference: nombreDuPlan(dossier.basePrice),
    libelle: String(dossier.label || ''),
  };
}

// UNE FORMULE ADAPTEE DES LA CREATION (2026-10-08). La fiche savait deja
// adapter une formule apres coup (retirer le minigolf, ajouter une partie) :
// elle envoie la formule et son programme, et le moteur repart du document de
// la formule (buildAdaptedFormula, qui garde la table et les boissons). A la
// creation, le programme effacait la formule (normalizeReservationRequest) :
// le dossier devenait une visite libre et perdait sa table au planning. Une
// creation qui porte les deux est donc planifiee et enregistree comme une
// formule adaptee, exactement comme celle que la fiche aurait produite.
function formuleAdapteeDuCorps(body = {}) {
  const formuleId = String(body.formuleId || body.formulaId || '').trim();
  const program = body.program;
  const items = Array.isArray(program) ? program : (program && Array.isArray(program.items) ? program.items : []);
  return formuleId && items.length ? formuleId : '';
}

module.exports = async (req, res) => {
  try {
    // LE CLIENT DEJA VENU (2026-10-08) : la fenetre Reserver demande, pour un
    // numero tape, si ce client est deja venu dans CE centre. Lecture seule,
    // centre de la session, un resume et rien d autre.
    if (req.method === 'GET') {
      const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const session = await requireStaffPermission(req, res, ['reservations.create', 'reservations.view', 'clients.view'], { centerId: requestUrl.searchParams.get('centerId') || '' });
      if (!session) return;
      const chiffres = String(requestUrl.searchParams.get('client') || '').replace(/\D/g, '');
      if (chiffres.length < 8 || chiffres.length > 15) {
        sendError(res, 422, 'Numéro incomplet : 8 chiffres au moins.');
        return;
      }
      const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
      const client = await lireHistoriqueClient({ centerId: session.authorizedCenterId, telephone: chiffres, aujourdhui });
      sendJson(res, 200, { ok: true, client });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const session = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });
      if (!session) return;
      await warmCenterKnowledge();
      // Côté STAFF le contact est LIBRE (nom/tél/email non imposés) : le staff
      // crée souvent une résa au comptoir sans tout saisir. L'email obligatoire
      // reste réservé au parcours CLIENT PUBLIC (api/public-reservations.js).
      // Le centre de la SESSION voyage avec la requete (meme discipline que
      // withCenter dans api/ops.js) : sans lui, un body sans centerId etait
      // range chez 'libramont' QUEL QUE SOIT le centre authentifie, et la
      // barriere inter-clients ne voyait rien (requestedCenterId vide).
      const request = normalizeReservationRequest(body, { channel: 'staff', centerId: session.authorizedCenterId });
      const formuleAdaptee = formuleAdapteeDuCorps(body);
      if (formuleAdaptee) {
        // Le prix de reference est celui de la formule ; le prix facture,
        // celui que la fenetre envoie (sinon la reference).
        const reference = getBasePrice('formule', request.duration, Number(request.laneCount) || 0, Number(request.pax) || 1, formuleAdaptee, request.centerId);
        request.type = 'formule';
        request.basePrice = reference;
        const envoye = body.price === undefined || body.price === null || body.price === '' ? null : Number(body.price);
        request.price = Number.isFinite(envoye) && envoye >= 0 ? envoye : reference;
      }
      const ops = await prepareReservationOps(formuleAdaptee ? { ...request, formuleId: formuleAdaptee } : request, 'staff');
      const dossier = {
        ...request,
        ...ops,
        // Apres le plan : le moteur reecrit type, libelle et prix d un dossier
        // a programme ; une formule adaptee garde les siens.
        ...(formuleAdaptee ? {
          type: 'formule',
          formuleId: formuleAdaptee,
          label: request.label || ops.label || '',
          basePrice: request.basePrice,
          price: request.price,
        } : {}),
        channel: request.channel || 'staff',
      };
      if (body.dryRun === true) {
        sendJson(res, 200, { ok: true, dryRun: true, plan: resumerPlanPourLaFenetre(dossier, ops) });
        return;
      }
      const reservation = await createReservation(dossier);
      const postCreate = await afterReservationCreated(reservation, request);

      // T5 : l'ecriture du journal a lieu ICI, apres le retour de
      // createReservation, donc APRES le COMMIT et hors du
      // pg_advisory_xact_lock que lockDate tient par (centre, date) jusqu'a la
      // fin de la transaction. La placer dans la transaction ajouterait un
      // aller-retour Neon a la fenetre de detention du verrou et serialiserait
      // toutes les creations d'une meme date. Meme placement que le
      // createOpsEvent qui existait deja ; ce qui n'est PAS repris, c'est son
      // `.catch(() => null)`.
      const auditCreate = await writeAuditLog({
        centerId: reservation.centerId || 'libramont',
        ...actorFromSession(session),
        surface: 'api/staff-reservations.js',
        action: 'createReservation',
        method: 'POST',
        entityType: 'reservation',
        entityId: reservation.id,
        outcome: 'success',
        changes: buildReservationAuditChanges({}, reservation),
        context: {
          canal: reservation.channel || 'staff',
          validationStatus: reservation.validationStatus || '',
        },
        requestId: newRequestId(),
      });

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
        // T4 point (c) : l'echec de trace remonte a l'ecran, dans le champ
        // `warnings` qui existait deja. La personne qui vient de creer la
        // reservation voit que sa trace a saute. C'est ce qui distingue
        // "non bloquant" de "silencieux".
        warnings: auditCreate.warning
          ? [...(postCreate.warnings || []), auditCreate.warning]
          : postCreate.warnings,
      });
      return;
    }

    if (req.method === 'PATCH') {
      if (!(await requireAnyStaffSession(req, res))) return;
      const body = await readJson(req);
      if (!body.id) throw createHttpError('Reservation manquante.', 400);

      const current = await getReservationById(body.id);
      if (!current) throw createHttpError('Reservation introuvable.', 404);

      const requestedCenterId = body.centerId || body.center_id || current.centerId || 'libramont';
      // L encaisse et l absence (0056) sont des gestes d accueil : meme droit
      // de base que changer un statut (l encaisse redemande payments.markPaid).
      const gesteAccueil = Object.keys(body).filter((key) => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
      const estGesteAccueil = gesteAccueil.length === 1 && ['encaissement', 'absent'].includes(gesteAccueil[0]);
      const permission = patchNeedsOnlyStatus(body) || estGesteAccueil ? ['reservations.status', 'reservations.edit'] : 'reservations.edit';
      const session = await requireStaffPermission(req, res, permission, { centerId: current.centerId || 'libramont' });
      if (!session) return;

      if (requestedCenterId !== (current.centerId || 'libramont')) {
        const switchSession = await requireStaffPermission(req, res, 'centers.switch', { centerId: requestedCenterId });
        if (!switchSession) return;
      }

      // DEUX POSTES, UNE RESERVATION. La version sur laquelle le client a
      // travaille ne correspond plus : on le dit tout de suite, avec la
      // version actuelle, avant de replanifier pour rien. updateReservation
      // refait ce controle sous verrou : c est lui qui fait foi.
      const versionAttendue = lireVersionAttendue(body.baseUpdatedAt);
      if (versionAttendue !== null && !memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);

      // CE QUI A ETE ENCAISSE / LE GROUPE QUI N EST PAS VENU (0056) : deux
      // gestes de l accueil, seuls dans leur PATCH. L encaisse demande le
      // droit d encaisser ; l absence, celui de changer un statut.
      const gesteKeys = Object.keys(body).filter(key => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
      if (gesteKeys.length === 1 && (gesteKeys[0] === 'encaissement' || gesteKeys[0] === 'absent')) {
        if (gesteKeys[0] === 'encaissement') {
          const paymentSession = await requireStaffPermission(req, res, 'payments.markPaid', { centerId: requestedCenterId });
          if (!paymentSession) return;
        }
        const { noterEncaisseOuAbsence } = require('../lib/database');
        const reservation = await noterEncaisseOuAbsence({ id: current.id, centerId: requestedCenterId, baseUpdatedAt: body.baseUpdatedAt, ...(gesteKeys[0] === 'encaissement' ? { encaissement: body.encaissement } : { absent: body.absent === true }) });
        const audit = await writeAuditLog({ centerId: requestedCenterId, ...actorFromSession(session), surface: 'api/staff-reservations.js', action: gesteKeys[0] === 'encaissement' ? 'noterEncaisse' : 'noterAbsence', method: 'PATCH', entityType: 'reservation', entityId: current.id, outcome: 'success', changes: buildReservationAuditChanges(current, reservation), context: contexteRegistre(current, reservation), requestId: newRequestId() });
        sendJson(res, 200, { ok: true, reservation, ...(audit.warning ? { warnings: [audit.warning] } : {}) });
        return;
      }

      const statusKeys = Object.keys(body).filter(key => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
      if (statusKeys.includes('status') && statusKeys.every(key => ['status', 'paymentMethod', 'payment_method'].includes(key))) {
        if (body.status === 'paid' || statusKeys.includes('paymentMethod') || statusKeys.includes('payment_method')) {
          const paymentSession = await requireStaffPermission(req, res, 'payments.markPaid', { centerId: requestedCenterId });
          if (!paymentSession) return;
        }
        const reservation = await setReservationStatus({ id: current.id, centerId: requestedCenterId, baseUpdatedAt: body.baseUpdatedAt, status: body.status, ...(Object.prototype.hasOwnProperty.call(body, 'paymentMethod') || Object.prototype.hasOwnProperty.call(body, 'payment_method') ? { paymentMethod: body.paymentMethod ?? body.payment_method } : {}) });
        const automation = await refreshReservationAutomation(current, reservation, { reason: 'reservation_status_updated' });
        const auditStatus = await writeAuditLog({ centerId: requestedCenterId, ...actorFromSession(session), surface: 'api/staff-reservations.js', action: 'setReservationStatus', method: 'PATCH', entityType: 'reservation', entityId: current.id, outcome: 'success', changes: buildReservationAuditChanges(current, reservation), context: contexteRegistre(current, reservation), requestId: newRequestId() });
        const changeAnnulation = (body.status === 'cancelled') !== (current.status === 'cancelled');
        const avertSecours = changeAnnulation ? await copierAuSecours(reservation, body.status === 'cancelled' ? 'annulee' : 'restauree', current, session) : '';
        const avertissements = [auditStatus.warning, avertSecours].filter(Boolean);
        sendJson(res, 200, { ok: true, reservation, automation, ...(avertissements.length ? { warnings: avertissements } : {}) });
        return;
      }

      if (patchIsNoteEquipeOnly(body)) {
        const geste = body.noteEquipe;
        const membre = session && session.member ? session.member : null;
        const updated = await noterReservationEquipe(current.id, current.centerId || 'libramont', {
          ajout: typeof geste.ajout === 'string' ? geste.ajout : undefined,
          retrait: typeof geste.retrait === 'string' ? geste.retrait : undefined,
          modifier: geste.modifier,
          // L auteur vient de la session, jamais du corps : une note ne
          // s ecrit pas au nom d un collegue.
          par: (membre && (membre.name || membre.displayName)) || 'Équipe',
        });
        const auditNote = await writeAuditLog({
          centerId: current.centerId || 'libramont',
          ...actorFromSession(session),
          surface: 'api/staff-reservations.js',
          action: geste.modifier ? 'modifierNoteEquipe' : geste.retrait ? 'retirerNoteEquipe' : 'ajouterNoteEquipe',
          method: 'PATCH',
          entityType: 'reservation',
          entityId: current.id,
          outcome: 'success',
          changes: buildReservationAuditChanges(current, updated),
          requestId: newRequestId(),
        });
        sendJson(res, 200, {
          ok: true,
          reservation: updated,
          automation: { communications: 0, jobs: 0, refreshed: false },
          ...(auditNote.warning ? { warnings: [auditNote.warning] } : {}),
        });
        return;
      }

      if (patchIsActivityToggleOnly(body)) {
        const coche = body.activityToggle;
        const updated = await setReservationActivityDone(
          current.id,
          current.centerId || 'libramont',
          coche.key,
          coche.done === true,
          { doneAt: coche.doneAt, by: coche.by },
        );
        const auditToggle = await writeAuditLog({
          centerId: current.centerId || 'libramont',
          ...actorFromSession(session),
          surface: 'api/staff-reservations.js',
          action: 'setReservationActivityProgress',
          method: 'PATCH',
          entityType: 'reservation',
          entityId: current.id,
          outcome: 'success',
          changes: buildChanges(
            { activityProgress: current.activityProgress },
            { activityProgress: updated.activityProgress },
            ['activityProgress'],
          ),
          requestId: newRequestId(),
        });
        sendJson(res, 200, {
          ok: true,
          reservation: updated,
          automation: { communications: 0, jobs: 0, refreshed: false },
          ...(auditToggle.warning ? { warnings: [auditToggle.warning] } : {}),
        });
        return;
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
        // Ce chemin rapide sortait AVANT toute journalisation : cocher une
        // activite de formule est une vraie modification (elle change ce que le
        // client a consomme) et serait restee invisible. Regime non bloquant :
        // c'est une action de comptoir, repetee, sur le chemin chaud.
        const auditProgress = await writeAuditLog({
          centerId: current.centerId || 'libramont',
          ...actorFromSession(session),
          surface: 'api/staff-reservations.js',
          action: 'setReservationActivityProgress',
          method: 'PATCH',
          entityType: 'reservation',
          entityId: current.id,
          outcome: 'success',
          changes: buildChanges(
            { activityProgress: current.activityProgress },
            { activityProgress: updated.activityProgress },
            ['activityProgress'],
          ),
          requestId: newRequestId(),
        });
        sendJson(res, 200, {
          ok: true,
          reservation: updated,
          automation: { communications: 0, jobs: 0, refreshed: false },
          ...(auditProgress.warning ? { warnings: [auditProgress.warning] } : {}),
        });
        return;
      }

      await warmCenterKnowledge();
      if (Object.prototype.hasOwnProperty.call(body, 'activityMove')) {
        if (Object.keys(body).some(field => !['id', 'centerId', 'center_id', 'baseUpdatedAt', 'activityMove'].includes(field))) {
          throw createHttpError('Un déplacement d’activité ne modifie aucun autre choix du dossier.', 422);
        }
        if (!body.baseUpdatedAt || !memeVersion(current.updatedAt, lireVersionAttendue(body.baseUpdatedAt))) {
          throw reservationModifieeEntreTemps(current);
        }
        const { buildActivityMove } = require('../lib/reservation-activity-move');
        const { readStaffState, validateActivityMoveResources } = require('../lib/database');
        const candidate = buildActivityMove(current, body.activityMove);
        const snapshot = await readStaffState(current.date, requestedCenterId, { avecBlocages: true });
        try {
          validateActivityMoveResources(candidate, body.activityMove, snapshot.reservations.filter(row => Number(row.id) !== Number(current.id)), snapshot.laneStatuses, snapshot.blocks || [], current.date);
        } catch (error) { if (!error.statusCode) error.statusCode = 409; throw error; }
        const reservation = await updateReservation({ id: current.id, centerId: requestedCenterId, baseUpdatedAt: body.baseUpdatedAt, activityMove: body.activityMove });
        const automation = await refreshReservationAutomation(current, reservation, { reason: 'activity_moved' });
        const auditMove = await writeAuditLog({ centerId: requestedCenterId, ...actorFromSession(session), surface: 'api/staff-reservations.js', action: 'moveReservationActivity', method: 'PATCH', entityType: 'reservation', entityId: current.id, outcome: 'success', changes: buildReservationAuditChanges(current, reservation), context: contexteRegistre(current, reservation, { activityMove: body.activityMove }), requestId: newRequestId() });
        sendJson(res, 200, { ok: true, reservation, activityMove: { ...body.activityMove, unchangedActivities: true }, automation, ...(auditMove.warning ? { warnings: [auditMove.warning] } : {}) });
        return;
      }
      const patch = {
        ...body,
        centerId: requestedCenterId,
      };
      const proposedProgram = patch.program ?? current.program;
      const proposedItems = Array.isArray(proposedProgram) ? proposedProgram
        : Array.isArray(proposedProgram?.items) ? proposedProgram.items : [];
      if (proposedItems.some((item) => Number(item.participants) > Number(patch.pax ?? current.pax))) {
        throw createHttpError('Le nombre de joueurs d’une activité dépasse le nombre de personnes du groupe.', 422);
      }
      const operationsChanged = patchChangesOperations(patch, current);
      const shouldReplan = operationsChanged;
      if (!operationsChanged) {
        // Ne jamais adopter les métadonnées/prix/snapshots renvoyés par le client.
        // Le contrat serveur sauvegardé fait foi lors d'une édition administrative.
        patch.program = current.program;
        patch.opsPlan = current.opsPlan;
        // Ces deux projections UI ne sont pas stockées sur la ligne SQL.
        // Laisser la DB reprendre ses valeurs normalisées du dossier courant.
        delete patch.laneCount;
        delete patch.requiresLanes;
      }
      const operationalRequest = { ...current, ...patch };
      if (!Object.prototype.hasOwnProperty.call(patch, 'price')) delete operationalRequest.price;
      const ops = shouldReplan
        ? await prepareReservationOps(operationalRequest, 'staff', { ignoreReservationId: Number(patch.id) })
        : {};
      if (shouldReplan && JSON.stringify((patch.lanes ?? current.lanes ?? []).map(Number))
        === JSON.stringify((current.lanes || []).map(Number))) {
        const allocated = (ops.opsPlan?.resourceBlocks || []).filter((block) => block.resourceType === 'bowling_lane')
          .flatMap((block) => block.lanes || []);
        if (allocated.length) patch.lanes = [...new Set(allocated.map(Number))];
      }
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

      // L'avant/apres reel. `current` a ete charge ligne ~150 pour la
      // validation : le diff ne coute aucune lecture supplementaire. C'est
      // precisement ce que l'ops_event ci-dessus ne dit pas (il ne porte que
      // les NOMS des champs touches, et aucun acteur).
      const auditPatch = await writeAuditLog({
        centerId: reservation.centerId || current.centerId || 'libramont',
        ...actorFromSession(session),
        surface: 'api/staff-reservations.js',
        action: 'updateReservation',
        method: 'PATCH',
        entityType: 'reservation',
        entityId: reservation.id,
        outcome: 'success',
        changes: buildReservationAuditChanges(current, reservation),
        context: contexteRegistre(current, reservation, { champsDemandes: Object.keys(body || {}).slice(0, 40) }),
        requestId: newRequestId(),
      });

      const avertSecours = hasAnyField(patch, CHAMPS_COPIE_SECOURS) || (patch.status && (patch.status === 'cancelled') !== (current.status === 'cancelled'))
        ? await copierAuSecours(reservation, patch.status === 'cancelled' && current.status !== 'cancelled' ? 'annulee' : 'modifiee', current, session)
        : '';
      const avertissementsPatch = [auditPatch.warning, avertSecours].filter(Boolean);
      sendJson(res, 200, {
        ok: true,
        reservation,
        automation,
        ...(avertissementsPatch.length ? { warnings: avertissementsPatch } : {}),
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (!(await requireAnyStaffSession(req, res))) return;
      const body = await readJson(req);
      if (!body.id) throw createHttpError('Reservation manquante.', 400);
      const current = await getReservationById(body.id);
      if (!current) throw createHttpError('Reservation introuvable.', 404);
      const session = await requireStaffPermission(req, res, 'reservations.cancel', { centerId: current.centerId || 'libramont' });
      if (!session) return;
      const automation = await cancelPendingAutomation(current, 'reservation_deleted');
      // LE REGISTRE (migration 0052) : la ligne entiere est copiee dans
      // reservation_archive AVANT le DELETE, dans la meme transaction. Si la
      // copie echoue, deleteReservation jette (503, message clair) et rien n est
      // supprime : la copie est OBLIGATOIRE, contrairement au journal d audit
      // ci-dessous qui reste non bloquant.
      const suppression = await deleteReservation(body.id, {
        archivedBy: libelleMembre(session),
        reason: String((body && body.reason) || 'suppression depuis la console').slice(0, 500),
      });
      await createOpsEvent({
        centerId: current.centerId || 'libramont',
        reservationId: null,
        eventType: 'reservation_deleted',
        payload: { source: 'staff', reservationId: current.id, archiveId: suppression.archiveId, automation },
      }).catch(() => null);

      // Une suppression est la modification la plus destructrice du produit :
      // l'objet n'existe plus, donc le journal et l archive sont les seuls
      // endroits ou son etat final subsiste. L etat complet est en `before`,
      // et le contexte pointe la copie d archive restaurable.
      const auditDelete = await writeAuditLog({
        centerId: current.centerId || 'libramont',
        ...actorFromSession(session),
        surface: 'api/staff-reservations.js',
        action: 'deleteReservation',
        method: 'DELETE',
        entityType: 'reservation',
        entityId: current.id,
        outcome: 'success',
        changes: buildReservationAuditChanges(current, {}),
        context: { automation, archiveId: suppression.archiveId, registre: { avant: reservationSnapshot(current), apres: {} } },
        requestId: newRequestId(),
      });

      const avertSecoursSuppression = await copierAuSecours(current, 'archivee', null, session);
      const avertissementsSuppression = [auditDelete.warning, avertSecoursSuppression].filter(Boolean);
      sendJson(res, 200, {
        ok: true,
        automation,
        archiveId: suppression.archiveId,
        ...(avertissementsSuppression.length ? { warnings: avertissementsSuppression } : {}),
      });
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
    // 409 : la version actuelle voyage avec le refus, le client rejoue son
    // action dessus. Elle ne part qu apres le controle de permission sur le
    // centre de la reservation (plus haut) : un refus de droit reste un 403.
    const extra = error && error.code === 'reservation_modifiee' && error.reservation
      ? { code: error.code, reservation: error.reservation }
      : {};
    sendError(res, (error && error.statusCode) || 400, raw, extra);
  }
};
