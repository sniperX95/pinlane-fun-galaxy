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
  lireDepartsRapides,
  lireEpinglesDeparts,
  ecrireEpinglesDeparts,
  readStaffState,
} = require('../lib/database');
const { readJson, sendError, sendJson } = require('../lib/http');
const { enqueueReservationCommunications } = require('../lib/ops-communications');
const { enqueueReservationAutomation } = require('../lib/ops-jobs');
const { afterReservationCreated, prepareReservationOps } = require('../lib/reservation-ops');
const { requireStaffPermission, getStaffSessionFromRequest } = require('../lib/staff-auth');
const { writeAuditLog, actorFromSession, buildChanges, newRequestId } = require('../lib/audit-log');
const { reservationChanges, reservationSnapshot, libelleMembre } = require('../lib/registre');
const { refreshCenterOverrides } = require('../lib/ops-knowledge');
const { refreshFormuleOverrides } = require('../lib/booking-config');
const { refreshCatalog } = require('../lib/catalog-store');
const { getPool } = require('../lib/database');
const { finDesActivites, planifierPourLaFenetre, simulerAutres } = require('../lib/reserver-fenetre');
const { simulerCandidats } = require('../lib/reserver-simulation');
const { normaliserEpingles } = require('../lib/departs-rapides');

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
// bien reference », « aucun bug quand on change d horaire »). La simulation,
// la creation et le lot passent par la MEME preparation
// (planifierPourLaFenetre, lib/reserver-fenetre.js) : la fenetre montre les
// heures, les pistes, les conflits et le prix que la creation posera.
const LOT_MAX = 12;

// Les erreurs d infrastructure (Postgres, Neon, reseau) ne s affichent jamais :
// elles se journalisent, et le staff lit une phrase qui dit de reessayer.
function estErreurInfra(error) {
  const raw = String((error && error.message) || '');
  return !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
}
const MESSAGE_INFRA = 'Opération réservation impossible pour le moment. Réessayez.';

function dateValide(valeur) {
  const texte = String(valeur || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const date = new Date(`${texte}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === texte;
}

function aujourdhuiABruxelles() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
}

// Creer un dossier deja prepare, le tracer, et rendre ce que la fenetre lit.
// Le journal s ecrit APRES le COMMIT, hors du verrou de la journee (T5) ; son
// echec remonte dans `warnings` (T4 point c), jamais en silence.
async function creerDepuisLaFenetre(prepare, session, contexte = {}) {
  const { ops, conflits, aPlacer } = prepare;
  const reservation = await createReservation(prepare.dossier);
  const postCreate = await afterReservationCreated(reservation, prepare.request);
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
      ...(aPlacer ? { aPlacer: true, conflits: conflits.map((conflit) => conflit.message) } : {}),
      ...contexte,
    },
    requestId: newRequestId(),
  });
  return {
    reservation,
    ops: {
      riskLevel: reservation.riskLevel,
      riskScore: reservation.riskScore,
      validationStatus: reservation.validationStatus,
      planWarning: ops.planWarning,
      autoDecision: ops.requiresHumanReview || aPlacer ? 'human_review_required' : 'auto_confirmed',
    },
    communications: postCreate.communications,
    warnings: auditCreate.warning
      ? [...(postCreate.warnings || []), auditCreate.warning]
      : postCreate.warnings,
    aPlacer,
    conflits,
  };
}

// LA SIMULATION (dryRun). UNE lecture de la journee, partagee par le dossier,
// les autres dossiers du meme envoi et chaque heure de l horloge : deux
// heures ne se comparent pas sur deux etats differents de la base.
async function simulerPourLaFenetre(body, session) {
  const lectures = new Map();
  const readState = (jour, centre) => {
    const cle = `${centre}|${jour}`;
    if (!lectures.has(cle)) lectures.set(cle, readStaffState(jour, centre, { avecBlocages: true }));
    return lectures.get(cle);
  };
  const corps = { ...body };
  ['dryRun', 'autres', 'candidats', 'forcer', 'dossiers'].forEach((champ) => { delete corps[champ]; });
  const autres = Array.isArray(body.autres) ? body.autres.slice(0, LOT_MAX) : [];
  const { virtuelles, plans } = autres.length
    ? await simulerAutres(autres, session, { readState })
    : { virtuelles: [], plans: [] };
  const principal = await planifierPourLaFenetre(corps, session, { readState, virtuelles });
  const reponse = { ok: true, dryRun: true, plan: principal.plan };
  if (autres.length) reponse.autres = plans;
  if (Array.isArray(body.candidats)) {
    reponse.candidats = await simulerCandidats({
      corps,
      candidats: body.candidats,
      planifier: async (essai) => {
        const resultat = await planifierPourLaFenetre(essai, session, { readState, virtuelles });
        return { ops: resultat.ops, dossier: resultat.dossier, conflits: resultat.conflits };
      },
      finDuPlan: finDesActivites,
    });
  }
  return reponse;
}

// LE LOT (2026-10-08) : les dossiers d un meme envoi, crees dans l ordre, chacun
// planifie apres que le precedent est en base. Un dossier refuse ne bloque pas
// les suivants, et son refus est rendu avec son rang : aucun echec muet.
// « Créer quand même » se decide DOSSIER PAR DOSSIER (`forcer` dans le
// dossier) : un `forcer` pose sur le lot est ignore, sinon il enverrait « à
// placer » un dossier dont le plan tient et que personne n a choisi de forcer.
async function creerLeLot(body, session) {
  const dossiers = body.dossiers;
  if (!dossiers.length || dossiers.length > LOT_MAX) throw createHttpError(`Un envoi porte de 1 à ${LOT_MAX} dossiers.`, 422);
  const reservations = [];
  const echecs = [];
  for (let index = 0; index < dossiers.length; index += 1) {
    const corps = dossiers[index];
    try {
      if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw createHttpError('Dossier invalide.', 422);
      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true });
      const cree = await creerDepuisLaFenetre(prepare, session, { lot: { index, total: dossiers.length } });
      reservations.push({ index, reservation: cree.reservation, ops: cree.ops, aPlacer: cree.aPlacer, conflits: cree.conflits, warnings: cree.warnings });
    } catch (error) {
      const infra = estErreurInfra(error);
      if (infra) console.error('[staff-reservations] lot, dossier', index, error && (error.stack || error.message || error));
      echecs.push({ index, message: infra ? MESSAGE_INFRA : String(error.message), infra });
    }
  }
  const statut = !echecs.length ? 201 : reservations.length ? 207 : echecs.every((echec) => echec.infra) ? 503 : 422;
  return { statut, corps: { ok: !echecs.length, reservations, echecs: echecs.map(({ index, message }) => ({ index, message })) } };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      // LES DEPARTS RAPIDES (2026-10-08) : les compositions que le centre vend
      // le plus ce jour de la semaine, et celles que le gerant a epinglees.
      if (requestUrl.searchParams.get('departs') === '1') {
        const sessionDeparts = await requireStaffPermission(req, res, 'reservations.create', { centerId: requestUrl.searchParams.get('centerId') || '' });
        if (!sessionDeparts) return;
        const date = String(requestUrl.searchParams.get('date') || '');
        if (!dateValide(date)) {
          sendError(res, 422, 'Date invalide : AAAA-MM-JJ attendu.');
          return;
        }
        const centre = sessionDeparts.authorizedCenterId;
        const lus = await lireDepartsRapides({ centerId: centre, date, aujourdhui: aujourdhuiABruxelles() });
        const epingles = await lireEpinglesDeparts(centre);
        sendJson(res, 200, { ok: true, date, jourSemaine: lus.jourSemaine, depuis: lus.depuis, jusqua: lus.jusqua, departs: lus.departs, epingles: epingles.epingles });
        return;
      }
      // LE CLIENT DEJA VENU (2026-10-08) : la fenetre Reserver demande, pour un
      // numero tape, si ce client est deja venu dans CE centre. Lecture seule,
      // centre de la session, un resume et rien d autre.
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
      const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const body = await readJson(req);
      // LES DEPARTS EPINGLES (2026-10-08) : le gerant choisit les compositions
      // que la fenetre montre en premier. Droit « Tarifs » (pricing.manage) :
      // c est un choix commercial du centre, que le role Manager porte et que
      // le comptoir (staff-bar) ne porte pas.
      if (requestUrl.searchParams.get('departs') === '1') {
        const sessionEpingles = await requireStaffPermission(req, res, 'pricing.manage', { centerId: body.centerId || body.center_id });
        if (!sessionEpingles) return;
        const epingles = normaliserEpingles(body.epingles);
        const centre = sessionEpingles.authorizedCenterId;
        const avant = await lireEpinglesDeparts(centre);
        const apres = await ecrireEpinglesDeparts({ centerId: centre, epingles, par: libelleMembre(sessionEpingles) });
        const auditEpingles = await writeAuditLog({
          centerId: centre,
          ...actorFromSession(sessionEpingles),
          surface: 'api/staff-reservations.js',
          action: 'ecrireDepartsEpingles',
          method: 'POST',
          entityType: 'center',
          entityId: centre,
          outcome: 'success',
          changes: buildChanges({ epingles: avant.epingles }, { epingles: apres.epingles }, ['epingles']),
          requestId: newRequestId(),
        });
        sendJson(res, 200, { ok: true, epingles: apres.epingles, ...(auditEpingles.warning ? { warnings: [auditEpingles.warning] } : {}) });
        return;
      }
      const session = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });
      if (!session) return;
      await warmCenterKnowledge();
      // Côté STAFF le contact est LIBRE (nom/tél/email non imposés) : le staff
      // crée souvent une résa au comptoir sans tout saisir. L'email obligatoire
      // reste réservé au parcours CLIENT PUBLIC (api/public-reservations.js).
      // Le centre de la SESSION voyage avec la requete (meme discipline que
      // withCenter dans api/ops.js) : planifierPourLaFenetre le pose sur chaque
      // dossier, celui d un lot compris.
      if (Array.isArray(body.dossiers)) {
        const lot = await creerLeLot(body, session);
        sendJson(res, lot.statut, lot.corps);
        return;
      }
      if (body.dryRun === true) {
        sendJson(res, 200, await simulerPourLaFenetre(body, session));
        return;
      }
      // « Créer quand même » (`forcer`) : un dossier en conflit part à placer.
      const prepare = await planifierPourLaFenetre(body, session, { forcer: body.forcer === true });
      // T5 : le journal s ecrit apres le COMMIT (creerDepuisLaFenetre). T4
      // point (c) : l echec de trace remonte dans `warnings`, jamais en
      // silence ; c est ce qui distingue « non bloquant » de « silencieux ».
      const cree = await creerDepuisLaFenetre(prepare, session);
      sendJson(res, 201, { ok: true, ...cree });
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
    if (estErreurInfra(error)) {
      console.error('[staff-reservations] échec', error && (error.stack || raw || error));
      sendError(res, 503, MESSAGE_INFRA);
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
