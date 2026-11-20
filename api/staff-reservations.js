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
  notesAvecCompte,
  notesAvecPrix,
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
const { alerterLimiteDeTables } = require('../lib/limite-tables');
const { requireStaffPermission, getStaffSessionFromRequest, sessionHasPermission, requestedCenterIsSameClient } = require('../lib/staff-auth');

// Les deux barrieres de requireStaffPermission, sans rien envoyer : une session
// qui demande un numero d un autre centre pourrait-elle y passer ? Changer de
// centre (centers.switch), et seulement chez son propre client, sauf la
// plateforme.
async function sessionPeutOuvrirLeCentre(session, centre) {
  if (!session || !centre) return false;
  if (centre === session.centerId) return true;
  if (!sessionHasPermission(session, 'centers.switch')) return false;
  if (sessionHasPermission(session, 'platform.admin')) return true;
  return requestedCenterIsSameClient(session.centerId, centre);
}
const { writeAuditLog, actorFromSession, buildChanges, newRequestId } = require('../lib/audit-log');
const { reservationChanges, reservationSnapshot, libelleMembre } = require('../lib/registre');
const { getCenter, refreshCenterOverrides } = require('../lib/ops-knowledge');
const { refreshFormuleOverrides } = require('../lib/booking-config');
const { refreshCatalog } = require('../lib/catalog-store');
const { getPool } = require('../lib/database');
const { exigerLesDroits, finDeLaVisite, notesSansLaNoteAPlacer, planifierPourLaFenetre, simulerAutres } = require('../lib/reserver-fenetre');
const { ancresDuMoteur, debutDesActivites, heureDuPlan, lireHeuresPosees, memesActivites, poserLesHeures } = require('../lib/heures-posees');
// La creation elle-meme vit dans lib/reserver-creation.js : la reservation en un clic d une demande
// sur mesure (api/ops.js customRequestBook) prend le meme chemin.
const { creerDepuisLaFenetre } = require('../lib/reserver-creation');
const { baseDuServeur, estRefusDeDroit, exigerAdaptationDeFormule, exigerFormuleDuCentre, exigerRetraitDeNote, jugerPrixDeModification, nomDeSession, notesDuPatch, patchAdapteLaFormule, prixQuiSuit, resoudreExtras } = require('../lib/droits-reservation');
const { exigerHistorique, exigerPistesALaMain, jugerEncaisse, pistesALaMainDuPlan } = require('../lib/droits-reservation');
const { lireHistoriqueDossier } = require('../lib/historique-dossier');
const { simulerCandidats } = require('../lib/reserver-simulation');
const { normaliserEpingles } = require('../lib/departs-rapides');
const { chercherUnAutreOrdre, corpsDuDossier, planConformeALaProposition } = require('../lib/autre-ordre');

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
async function rendreLeCorpsSansFondateur(body, current, session, res) {
  const F = require('../lib/fondateur-invisible');
  const cles = ['activityProgress', 'activity_progress'].filter((cle) => body[cle] && typeof body[cle] === 'object');
  // Le dossier que la console a recu sans lui (une session du centre, et la sienne depuis le 2026-11-18)
  // revient tel qu en base : une note ou une coche masquee ne se resigne ni ne s efface.
  const masques = F.nomsMasques(res);
  if (masques) {
    if (typeof body.notes === 'string') body.notes = F.notesRendues(body.notes, String(current.notes || ''), masques);
    cles.forEach((cle) => { body[cle] = F.suiviRendu(body[cle], current.activityProgress, masques); });
  }
  if (!F.estFondateur(session) || !cles.length) return;
  const noms = masques || await F.nomsDuFondateur();
  cles.forEach((cle) => { body[cle] = F.suiviSansSignature(body[cle], current.activityProgress, noms); });
}

async function copierAuSecours(reservation, evenement, avant, session) {
  const { copieSecours } = require('../lib/secours-envoi');
  // La copie de secours ne nomme pas le fondateur (2026-11-13, lib/fondateur-invisible.js).
  const par = require('../lib/fondateur-invisible').signatureVisible(session, { avecId: false });
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
    // Les joueurs de chaque partie se vendent (lib/visit-program.js prixDesParties) : sans eux ici,
    // la partie 3 passee de 8 a 7 dans le dossier gardait le prix et le plan d avant.
    if (Array.isArray(item.joueursParPartie)) choice.joueursParPartie = item.joueursParPartie.map(Number);
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

// Ce qui se vend sur un dossier : le groupe, l offre, les activites, les lignes
// de sur mesure. Sa comparaison dit si un prix doit etre rejuge.
function contenuDuDossier(dossier) {
  const pax = dossier.pax;
  return JSON.stringify({
    pax: Number(pax) || 0,
    type: String(dossier.type || ''),
    formuleId: String(dossier.formuleId || dossier.formulaId || ''),
    duration: Number(dossier.duration) || 0,
    programme: operationalProgram(dossier.program, pax),
    extras: (Array.isArray(dossier.extras) ? dossier.extras : [])
      .map((ligne) => `${String(ligne.name || '')}|${Math.round((Number(ligne.price) || 0) * 100)}`).sort(),
  });
}

// Le programme replanifie, aux montants que le dossier disait. Le contenu est le meme
// (contenuDuDossier), ligne pour ligne : seules les heures du moteur changent.
function programmeAuxMontantsDuDossier(programme, avant) {
  const items = Array.isArray(programme) ? programme : programme?.items;
  const anciens = Array.isArray(avant) ? avant : avant?.items;
  if (!Array.isArray(items) || !Array.isArray(anciens) || items.length !== anciens.length) return programme;
  const reprises = items.map((item, i) => ({ ...item, price: anciens[i].price, priceKnown: anciens[i].priceKnown }));
  if (Array.isArray(programme)) return reprises;
  return { ...programme, items: reprises, price: avant.price ?? programme.price, priceComplete: avant.priceComplete ?? programme.priceComplete };
}

function patchNeedsOnlyStatus(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes', 'activityProgress', 'activity_progress', 'activityToggle', 'noteEquipe'].includes(key));
}

// DEPLACER, C EST LE DROIT « DEPLACER UNE RESERVATION » (2026-11-07). Le
// glisser du planning n envoie que activityMove ; il demandait reservations.edit,
// et planning.drag ne servait a rien : le role Technique, qui le porte, etait
// refuse a chaque glisser. Modifier le dossier reste le droit de modifier.
function patchIsActivityMoveOnly(body = {}) {
  const keys = Object.keys(body || {}).filter((key) => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
  return keys.length === 1 && keys[0] === 'activityMove';
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
    // Un dossier deplace dans le temps peut depasser la limite de tables du
    // centre : seule une plage de table nouvelle le previent (ne leve jamais).
    alerterLimiteDeTables(reservation, { avant: current }),
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

// LE TELEPHONE DU CLIENT EST OBLIGATOIRE A LA CREATION (Ansar, 2026-11-11 : « on doit
// obligatoirement mettre numéro de téléphone »). La fenetre Reserver l exige avant
// Créer (rvTelephoneValide, assets/app-main.js) ; le serveur redit la meme regle
// (lib/telephone-du-client.js) pour un poste reste sur une ancienne page. La
// simulation n en a pas besoin ; une demande sur mesure reservee (customRequestBook)
// garde le numero de sa demande.
function exigerLeTelephone(corps) {
  if (require('../lib/telephone-du-client').telephoneValide(corps && corps.phone)) return;
  throw createHttpError('Le téléphone du client est obligatoire.', 422);
}

// Les erreurs d infrastructure (Postgres, Neon, reseau) ne s affichent jamais :
// elles se journalisent, et le staff lit une phrase qui dit de reessayer.
// ECONNRESET (point C6) : une connexion coupee en pleine transaction.
function estErreurInfra(error) {
  const raw = String((error && error.message) || '');
  return !raw || /tuple concurrently|timeout exceeded|data transfer quota|ECONNREFUSED|ECONNRESET|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
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
// CE QUE « MODIFIER » ECRIRAIT, SANS L ECRIRE (2026-11-15, Ansar : « super
// intelligente pour pas faire de la merde et tout autorisé sans cassé »). La
// console ne savait qu au clic si la modification passait : une piste prise,
// un laser plein, un prix au-dela du role, un planning qui ne suit pas se
// lisaient apres coup, et le prix annonce n etait pas toujours celui ecrit. Le
// dossier de « Modifier » passe ici par les memes droits, le meme calcul
// (calculerLaModification) et la meme ecriture sous verrou (updateReservation),
// que la base annule aussitot (`aBlanc`). La reponse dit la ligne qui aurait
// ete ecrite, ou le refus, toujours en 200 avec `modification: true`.
// Demande en POST (dryRun + modification), jamais en PATCH : un PATCH lu par un
// serveur d avant ce jour aurait ecrit pour de bon, alors que son POST dryRun
// simule une creation et n ecrit rien ; la console se tait sans `modification`.
async function modifierABlanc(req, res, corps) {
  const body = { ...corps };
  delete body.dryRun;
  if (!body.id) throw createHttpError('Reservation manquante.', 400);
  const current = await getReservationById(body.id);
  if (!current) throw createHttpError('Reservation introuvable.', 404);
  const centre = current.centerId || 'libramont';
  const session = await requireStaffPermission(req, res, 'reservations.edit', { centerId: centre });
  if (!session) return null;
  try {
    if (res.__sansMontants) require('../lib/montants-role').retirerLesMontantsDuCorps(body, current);
    await rendreLeCorpsSansFondateur(body, current, session, res);
    // Le dossier entier de « Modifier », rien d autre : un deplacement
    // d activite, un geste d accueil, un changement d etat ou de moyen de
    // paiement ont leurs droits et leurs chemins.
    const porte = (cle) => Object.prototype.hasOwnProperty.call(body, cle);
    const etatChange = porte('status') && String(body.status || '') !== String(current.status || '');
    const moyenChange = ['paymentMethod', 'payment_method'].some((cle) => porte(cle) && String(body[cle] ?? '') !== String(current.paymentMethod || ''));
    if (body.activityMove || body.compteArrivee || porte('encaissement') || porte('absent') || etatChange || moyenChange) {
      throw createHttpError('Le calcul à blanc ne vaut que pour une modification du dossier.', 400);
    }
    const requestedCenterId = body.centerId || body.center_id || centre;
    if (requestedCenterId !== centre) throw createHttpError('Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.', 422);
    const aujourdhui = aujourdhuiABruxelles();
    const jourPasse = (jour) => dateValide(jour) && jour < aujourdhui;
    if ((jourPasse(current.date) || jourPasse(body.date)) && !sessionHasPermission(session, 'planning.past')) throw createHttpError('Changer un jour passé ne fait pas partie de votre rôle.', 403);
    const versionAttendue = lireVersionAttendue(body.baseUpdatedAt);
    if (versionAttendue !== null && !memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);
    // LES HEURES D ABORD, PUIS LE RESTE (2026-11-20, dossier 1953 de Gembloux). « Enregistrer » deplace
    // chaque heure changee par son chemin (PATCH activityMove), puis envoie le reste sur le dossier que
    // ces deplacements ont ecrit. Le calcul a blanc joue la meme suite : les deplacements sur le dossier
    // relu, par les controles du glisser, puis la modification sur le dossier deplace.
    const aDeplacer = Array.isArray(body.deplacements) ? body.deplacements : [];
    delete body.deplacements;
    const dossierDeplace = aDeplacer.length ? await deplacerAvantLeReste(current, aDeplacer, session) : current;
    if (dossierDeplace !== current) {
      // (le corps part de l ecran d avant les deplacements : le plan et les pistes que la personne n a
      // pas touches sont ceux du dossier deplace, comme a l enregistrement)
      body.opsPlan = dossierDeplace.opsPlan;
      if (JSON.stringify((body.lanes || []).map(Number)) === JSON.stringify((current.lanes || []).map(Number))) body.lanes = dossierDeplace.lanes || [];
    }
    const { patch, ops, shouldReplan } = await calculerLaModification({ body, current: dossierDeplace, session, requestedCenterId });
    const reservation = await updateReservation({ ...patch, ...ops, channel: patch.channel || current.channel || 'staff', aBlanc: true });
    // Les verrous du jour etaient pris par un vrai geste : pas de verdict, la console se tait.
    if (!reservation) return { ok: true, dryRun: true };
    const planNonRefait = shouldReplan && ops.planAvailable === false ? (ops.planRefusal || ops.planWarning || 'le moteur n’a pas donné de motif.') : '';
    return { ok: true, dryRun: true, modification: true, reservation, ...(planNonRefait ? { planNonRefait } : {}) };
  } catch (error) {
    if ((error && error.statusCode >= 500) || estErreurInfra(error)) throw error;
    return { ok: true, dryRun: true, modification: true, refus: { message: String(error.message), statut: error.statusCode || 400, ...(error.code ? { code: error.code } : {}), ...(Number.isInteger(error.rangDuDeplacement) ? { rang: error.rangDuDeplacement, suggestions: error.heuresProches || [] } : {}) } };
  }
}

// Les deplacements de « Modifier » joues avant le reste, a blanc : un apres l autre sur le dossier relu,
// par les controles du PATCH activityMove (buildActivityMove, puis validateActivityMoveResources contre
// la journee relue, fermetures comprises). Un refus porte son rang et les heures libres les plus proches.
async function deplacerAvantLeReste(current, deplacements, session) {
  if (deplacements.length > DEPLACEMENTS_A_BLANC_MAX) throw createHttpError('Déplacement d’activité invalide.', 400);
  deplacements.forEach((d) => {
    const activite = String((d && d.activityId) || '');
    const droit = activite === 'laser_game' ? 'planning.laser' : activite === 'bowling' ? 'planning.bowling' : '';
    if (droit && !sessionHasPermission(session, droit)) throw createHttpError('Ce planning ne fait pas partie de votre rôle.', 403);
  });
  const { buildActivityMove } = require('../lib/reservation-activity-move');
  const { validateActivityMoveResources } = require('../lib/database');
  const lu = await readStaffState(current.date, current.centerId || 'libramont', { avecBlocages: true, avecFermetures: true });
  const voisins = (Array.isArray(lu.reservations) ? lu.reservations : []).filter((row) => Number(row.id) !== Number(current.id));
  const tenir = (dossier, d) => {
    const suivant = buildActivityMove(dossier, d);
    try {
      validateActivityMoveResources(suivant, d, voisins, lu.laneStatuses || {}, lu.blocks || [], current.date);
    } catch (error) { if (!error.statusCode) error.statusCode = 409; throw error; }
    return suivant;
  };
  let dossier = current;
  for (let i = 0; i < deplacements.length; i += 1) {
    try { dossier = tenir(dossier, deplacements[i]); } catch (error) {
      if (!error || !error.statusCode || error.statusCode >= 500 || estErreurInfra(error)) throw error;
      error.rangDuDeplacement = i;
      error.heuresProches = heuresLibresProches(dossier, deplacements[i], null, tenir);
      throw error;
    }
  }
  return dossier;
}

// L HEURE D UNE ACTIVITE CHANGEE DANS « MODIFIER », SANS L ECRIRE (2026-11-18, Ansar : « on doit pouvoir
// modifier l heure de chaque activite ici »). La fenetre deplace une activite par le chemin du glisser du
// planning (PATCH activityMove), une activite apres l autre. Avant le clic, elle demande ici ce que ces
// deplacements donneraient : memes droits que le PATCH, le dossier relu, les memes controles
// (buildActivityMove, puis validateActivityMoveResources contre la journee relue, blocages en ligne
// compris), rien d ecrit. La reponse rend le dossier qui serait ecrit, ou le refus, toujours en 200 avec
// `deplacement: true` : un serveur d avant ce jour ne le dit pas, et la console se tait.
const DEPLACEMENTS_A_BLANC_MAX = 12;
async function deplacerABlanc(req, res, corps) {
  if (!corps.id) throw createHttpError('Reservation manquante.', 400);
  const current = await getReservationById(corps.id);
  if (!current) throw createHttpError('Reservation introuvable.', 404);
  const centre = current.centerId || 'libramont';
  const session = await requireStaffPermission(req, res, ['planning.drag', 'reservations.edit'], { centerId: centre });
  if (!session) return null;
  try {
    const deplacements = Array.isArray(corps.activityMoves) ? corps.activityMoves : [];
    if (!deplacements.length || deplacements.length > DEPLACEMENTS_A_BLANC_MAX) throw createHttpError('Déplacement d’activité invalide.', 400);
    if ((corps.centerId || corps.center_id || centre) !== centre) throw createHttpError('Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.', 422);
    for (const deplacement of deplacements) {
      const activite = String((deplacement && deplacement.activityId) || '');
      const droit = activite === 'laser_game' ? 'planning.laser' : (activite === 'bowling' ? 'planning.bowling' : '');
      if (droit && !sessionHasPermission(session, droit)) throw createHttpError('Ce planning ne fait pas partie de votre rôle.', 403);
    }
    const aujourdhui = aujourdhuiABruxelles();
    if (dateValide(current.date) && current.date < aujourdhui && !sessionHasPermission(session, 'planning.past')) throw createHttpError('Changer un jour passé ne fait pas partie de votre rôle.', 403);
    if (!corps.baseUpdatedAt || !memeVersion(current.updatedAt, lireVersionAttendue(corps.baseUpdatedAt))) throw reservationModifieeEntreTemps(current);
    const { buildActivityMove } = require('../lib/reservation-activity-move');
    const { validateActivityMoveResources } = require('../lib/database');
    const snapshot = await readStaffState(current.date, centre, { avecBlocages: true });
    const autres = snapshot.reservations.filter(row => Number(row.id) !== Number(current.id));
    // Les fermetures et indisponibilites du jour (une piste bloquee, une activite fermee) : la journee
    // relue ne les porte pas, l ecriture sous verrou les lit (resolveBlocksOnClient). Le verdict les lit
    // ici pour dire avant le clic ce que l ecriture refuserait.
    let blocs = [];
    try {
      const { loadAvailabilityBlocks, resolveBlocksForDate } = require('../lib/availability-blocks');
      blocs = resolveBlocksForDate(await loadAvailabilityBlocks(require('../lib/database').getPool(), centre), current.date);
    } catch (error) { blocs = []; }
    // L heure la plus tot que la fenetre accepte (l arrivee du groupe, l heure qu il est), pour les
    // heures proposees seulement : la fenetre dit elle-meme pourquoi une heure plus tot ne va pas.
    const auPlusTot = Number.isFinite(Number(corps.auPlusTot)) && corps.auPlusTot !== null && corps.auPlusTot !== ''
      ? Math.max(0, Math.min(48 * 60, Math.round(Number(corps.auPlusTot)))) : null;
    const essayer = (base, deplacement) => {
      const essai = buildActivityMove(base, deplacement);
      try {
        validateActivityMoveResources(essai, deplacement, autres, snapshot.laneStatuses, blocs, current.date);
      } catch (error) { if (!error.statusCode) error.statusCode = 409; throw error; }
      return essai;
    };
    let candidat = current;
    for (let rang = 0; rang < deplacements.length; rang += 1) {
      const deplacement = deplacements[rang];
      const voulue = minuteDeLaFenetre(deplacement && deplacement.startTime);
      try {
        if (auPlusTot !== null && Number.isFinite(voulue) && voulue < auPlusTot) {
          const tot = new Error('Trop tôt : le groupe n’est pas encore là à cette heure.');
          tot.statusCode = 422;
          tot.plancher = true;
          throw tot;
        }
        candidat = essayer(candidat, deplacement);
      } catch (error) {
        if (!error || !error.statusCode || error.statusCode >= 500 || estErreurInfra(error)) throw error;
        if (error.code === 'reservation_modifiee') throw error;
        error.rang = rang;
        error.suggestions = heuresLibresProches(candidat, deplacement, auPlusTot, essayer);
        throw error;
      }
    }
    return { ok: true, dryRun: true, deplacement: true, reservation: candidat };
  } catch (error) {
    if (!error || !error.statusCode || error.statusCode >= 500 || estErreurInfra(error)) throw error;
    return { ok: true, dryRun: true, deplacement: true, refus: { message: String(error.message), statut: error.statusCode, ...(error.code ? { code: error.code } : {}), ...(Number.isInteger(error.rang) ? { rang: error.rang, suggestions: error.suggestions || [] } : {}), ...(error.plancher ? { plancher: true } : {}) } };
  }
}

// UN AUTRE ORDRE POUR UN DOSSIER ENREGISTRE (2026-11-18, Marius, Gembloux : « l algo ne
// change pas en se disant : finalement, le bowling, je vais le remettre en dernier »). La meme
// arrivee, les memes activites, les memes joueurs, l ordre libre (lib/autre-ordre.js), joue a
// blanc par la porte de la fenetre sur UNE lecture de la journee ; le dossier ne compte pas
// dans sa propre journee. Rien ne s ecrit.
async function proposerUnAutreOrdre(current, session) {
  const lectures = new Map();
  const readState = (jour, centre) => {
    const cle = `${centre}|${jour}`;
    // (les fermetures et privatisations du jour aussi, lues une fois pour tous les ordres essayes ;
    // ecrit en bloc pour que l ancre de la contre-preuve de simulerPourLaFenetre reste unique)
    if (!lectures.has(cle)) {
      lectures.set(cle, readStaffState(jour, centre, { avecBlocages: true, avecFermetures: true }));
    }
    return lectures.get(cle);
  };
  if (current.status === 'cancelled') return { ok: true, trouve: null, raison: 'Une réservation annulée ne change pas d’ordre.', essais: 0 };
  return chercherUnAutreOrdre({ corps: corpsDuDossier(current), planifier: (essai) => planifierPourLaFenetre(essai, session, { readState, dossierReplanifie: Number(current.id) }) });
}

// « Proposer un autre ordre » sur la fiche : le droit de modifier le dossier, dans son centre.
async function autreOrdreABlanc(req, res, demande) {
  if (!demande.id) throw createHttpError('Reservation manquante.', 400);
  const current = await getReservationById(demande.id);
  if (!current) throw createHttpError('Reservation introuvable.', 404);
  const centre = current.centerId || 'libramont';
  const session = await requireStaffPermission(req, res, 'reservations.edit', { centerId: centre });
  if (!session) return null;
  if ((demande.centerId || demande.center_id || centre) !== centre) throw createHttpError('Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.', 422);
  const proposition = await proposerUnAutreOrdre(current, session);
  return { ok: true, dryRun: true, autreOrdre: { ...proposition, id: current.id, baseUpdatedAt: current.updatedAt } };
}

function minuteDeLaFenetre(texte) {
  const lu = /^(\d{1,2}):(\d{2})$/.exec(String(texte || ''));
  return lu && Number(lu[2]) < 60 ? Number(lu[1]) * 60 + Number(lu[2]) : NaN;
}

// LES HEURES LIBRES LES PLUS PROCHES d une heure qui ne va pas (2026-11-18) : une avant, une apres, pour
// la meme activite, la meme duree et la meme ressource (le bowling garde ses pistes), jugees par les
// memes controles que le deplacement lui-meme. Le bowling cherche sur la grille des demi-heures, le
// reste de 5 en 5 minutes, jusqu a douze heures de part et d autre ; rien avant `auPlusTot`.
function heuresLibresProches(base, deplacement, auPlusTot, essayer) {
  const voulue = minuteDeLaFenetre(deplacement && deplacement.startTime);
  if (!Number.isFinite(voulue)) return [];
  const pas = deplacement.activityId === 'bowling' ? 30 : 5;
  const enHeure = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  // (l heure qu elle a deja ne se propose pas : ce ne serait pas un changement)
  const actuelle = heureActuelleDuDeplacement(base, deplacement);
  const passe = (minutes) => {
    if (minutes < 0 || minutes >= 24 * 60 || minutes === actuelle || (auPlusTot !== null && minutes < auPlusTot)) return false;
    try { essayer(base, { ...deplacement, startTime: enHeure(minutes) }); return true; } catch (error) {
      if (!error || !error.statusCode || error.statusCode >= 500) throw error;
      return false;
    }
  };
  let avant = null;
  let apres = null;
  const premierAvant = Math.floor((voulue - 1) / pas) * pas;
  const premierApres = Math.floor(voulue / pas) * pas + pas;
  for (let ecart = 0; ecart <= 12 * 60 && (avant === null || apres === null); ecart += pas) {
    if (avant === null && passe(premierAvant - ecart)) avant = premierAvant - ecart;
    if (apres === null && passe(premierApres + ecart)) apres = premierApres + ecart;
  }
  return [avant, apres].filter((minutes) => minutes !== null).map(enHeure);
}

// L heure qu a aujourd hui ce que le deplacement viserait : le premier service du bowling, la partie
// et la vague du laser, la premiere etape a heure d une autre activite.
function heureActuelleDuDeplacement(base, deplacement) {
  const plan = (base && base.opsPlan) || {};
  const minute = (bloc) => minuteDeLaFenetre(String((bloc && bloc.startTime) || '').slice(0, 5));
  const premiere = (blocs) => { const liste = blocs.map(minute).filter(Number.isFinite); return liste.length ? Math.min(...liste) : NaN; };
  if (deplacement.activityId === 'bowling') return premiere((plan.resourceBlocks || []).filter((bloc) => bloc && bloc.resourceType === 'bowling_lane'));
  if (deplacement.activityId === 'laser_game') {
    return premiere((plan.resourceBlocks || []).filter((bloc) => bloc && bloc.resourceType === 'laser_arena' && `${Number(bloc.countIndex || 1)}.${Number(bloc.groupWaveIndex || 1)}` === String(deplacement.unitKey)));
  }
  return premiere((plan.timeline || []).filter((bloc) => bloc && bloc.activityId === deplacement.activityId && bloc.type === 'activity' && bloc.flexible !== true));
}

// LA SIMULATION (dryRun). UNE lecture de la journee, partagee par le dossier,
// les autres dossiers du meme envoi et chaque heure de l horloge : deux
// heures ne se comparent pas sur deux etats differents de la base.
async function simulerPourLaFenetre(body, session) {
  const lectures = new Map();
  const readState = (jour, centre) => {
    const cle = `${centre}|${jour}`;
    // (les fermetures et privatisations du jour aussi : la fenetre les dit avant « Créer »)
    if (!lectures.has(cle)) lectures.set(cle, readStaffState(jour, centre, { avecBlocages: true, avecFermetures: true }));
    return lectures.get(cle);
  };
  const corps = { ...body };
  ['dryRun', 'autres', 'candidats', 'forcer', 'dossiers', 'autreOrdre'].forEach((champ) => { delete corps[champ]; });
  const autres = Array.isArray(body.autres) ? body.autres.slice(0, LOT_MAX) : [];
  const { virtuelles, plans } = autres.length
    ? await simulerAutres(autres, session, { readState })
    : { virtuelles: [], plans: [] };
  const principal = await planifierPourLaFenetre(corps, session, { readState, virtuelles });
  const reponse = { ok: true, dryRun: true, plan: principal.plan };
  if (autres.length) reponse.autres = plans;
  // LE COMPTOIR DEMANDE AUSSI L ORDRE QUI GARDE L HEURE (2026-11-18, lib/autre-ordre.js) :
  // seulement quand le plan ne tient pas, sur la meme lecture de la journee.
  if (body.autreOrdre === true && principal.plan && principal.plan.disponible === false) {
    reponse.autreOrdre = await chercherUnAutreOrdre({ corps, planifier: (essai) => planifierPourLaFenetre(essai, session, { readState, virtuelles }) });
  }
  if (Array.isArray(body.candidats)) {
    reponse.candidats = await simulerCandidats({
      corps,
      candidats: body.candidats,
      planifier: async (essai) => {
        const resultat = await planifierPourLaFenetre(essai, session, { readState, virtuelles });
        return { ops: resultat.ops, dossier: resultat.dossier, conflits: resultat.conflits };
      },
      finDuPlan: finDeLaVisite,
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
      exigerLeTelephone(corps);
      const prepare = await planifierPourLaFenetre(corps, session, { forcer: corps.forcer === true });
      const cree = await creerDepuisLaFenetre(prepare, session, { lot: { index, total: dossiers.length } });
      reservations.push({ index, reservation: cree.reservation, ops: cree.ops, aPlacer: cree.aPlacer, conflits: cree.conflits, warnings: cree.warnings });
    } catch (error) {
      const infra = estErreurInfra(error);
      if (infra) {
        console.error('[staff-reservations] lot, dossier', index, error && (error.stack || error.message || error));
        require('../lib/garde-serveur').signalerPanneServeur('api/staff-reservations:lot', error);
      }
      echecs.push({ index, message: infra ? MESSAGE_INFRA : String(error.message), infra, ...(estRefusDeDroit(error) ? { code: error.code, refusDeDroit: error.statusCode === 403 } : {}) });
    }
  }
  const statut = !echecs.length ? 201 : reservations.length ? 207 : echecs.every((echec) => echec.infra) ? 503 : echecs.every((echec) => echec.refusDeDroit) ? 403 : 422;
  return { statut, corps: { ok: !echecs.length, reservations, echecs: echecs.map(({ index, message, code }) => ({ index, message, ...(code ? { code } : {}) })) } };
}

// CE QUE « MODIFIER » ECRIRA (2026-11-12) : le prix borne, les notes, la formule, les extras, le compte
// a l arrivee, les pistes a la main, la replanification, la reference et le prix, juges comme le PATCH
// les ecrit. Le PATCH l appelle puis ecrit ; l assistant l appelle pour montrer sur sa carte le prix et
// le plan que le clic ecrira (lib/assistant-gestes-reservations.js, apercuDeLaModification). Rien ne
// s ecrit ici : prepareReservationOps lit la journee et calcule.
async function calculerLaModification({ body, current, session, requestedCenterId }) {
  // UN PRIX SE BORNE (2026-10-12) : le comptoir ecrit le montant qu il a
  // sous les yeux, entre 0 et 100 000 EUR, comme l encaisse
  // (noterEncaisseOuAbsence). Sans prix envoye (absent, null, vide), le
  // dossier garde le sien, sauf si son contenu change : le serveur le pose
  // alors sur sa reference (prixQuiSuit, plus bas).
  if (Object.prototype.hasOwnProperty.call(body, 'price') && body.price !== null && body.price !== '') {
    const prix = Number(body.price);
    if (!Number.isFinite(prix) || prix < 0 || prix > 100000) throw createHttpError(`Prix invalide : entre 0 et 100 000 ${require('../lib/monnaie').signeDuCentre(requestedCenterId)}.`, 422);
  }
  const patch = {
    ...body,
    centerId: requestedCenterId,
  };
  // LE TELEPHONE DU DOSSIER (2026-11-20, la regle de la creation, lib/telephone-du-client.js) : un
  // numero change doit tenir. Seul un numero change et tape se juge : un ancien numero qui ne tient pas
  // ne bloque pas les autres changements, et le PATCH du dossier entier peut encore le vider (un dossier
  // d avant la regle, reserver-comptoir-check [D1]) ; l onglet Modifier, lui, ne le laisse pas vider.
  if (Object.prototype.hasOwnProperty.call(patch, 'phone') && String(patch.phone ?? '').trim() !== String(current.phone ?? '').trim()) {
    const tape = String(patch.phone ?? '').trim();
    if (tape && !require('../lib/telephone-du-client').telephoneValide(tape)) throw createHttpError('Ce numéro de téléphone n’est pas valide, 8 chiffres au moins.', 422);
  }
  // LES DROITS DU DOSSIER (2026-11-03, lib/droits-reservation.js). La raison
  // du prix ne s ecrit pas telle quelle : elle part dans la note du serveur.
  // Un prix vide ne dit rien (toNumber les lisait 0), des notes nulles non
  // plus, et des extras qui ne sont pas une liste n effacent pas les lignes
  // du dossier.
  if (patch.price === null || patch.price === '') delete patch.price;
  if (patch.notes === null) delete patch.notes;
  if (Object.prototype.hasOwnProperty.call(patch, 'extras') && !Array.isArray(patch.extras)) delete patch.extras;
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) patch.notes = notesDuPatch({ notes: patch.notes, current, session });
  if (patchAdapteLaFormule(patch, current) || patch.formuleSurMesure) exigerAdaptationDeFormule(session);
  // Une formule gardee par un autre centre ne se prend pas ici (lib/formule-comptoir.js).
  if (patch.formuleId || patch.formulaId) exigerFormuleDuCentre({ formuleId: patch.formuleId || patch.formulaId, centerId: requestedCenterId });
  if (Object.prototype.hasOwnProperty.call(patch, 'extras')) {
    const { extras, refus } = resoudreExtras({ extras: patch.extras, avant: current.extras, session, centerId: requestedCenterId, pax: patch.pax ?? current.pax });
    if (refus) throw refus;
    patch.extras = extras;
  }
  // LE COMPTE A L ARRIVEE (2026-10-29, lot 2 de R33) : le groupe recompte au
  // comptoir passe par ce chemin, celui de Modifier (meme droit, meme
  // replanification, le prix que la console a calcule). Le serveur le trace
  // dans une note d equipe, dans la meme ecriture et a l auteur de la
  // session, jamais a celui du corps : « 10 → 13 ». Seul un groupe pointe
  // arrive se compte.
  const compteArrivee = patch.compteArrivee === true;
  delete patch.compteArrivee;
  if (compteArrivee) {
    if (current.status !== 'arrived') throw createHttpError('Le compte se fait sur un groupe pointé arrivé.', 422);
    const de = Math.trunc(Number(current.pax) || 0);
    const a = Number(patch.pax);
    if (!Number.isInteger(a) || a < 1 || a > 240) throw createHttpError('Nombre de personnes invalide : entre 1 et 240.', 422);
    if (a !== de) patch.notes = notesAvecCompte(current.notes, { de, a, par: nomDeSession(session) });
  }
  if (patch.program && !patch.formuleSurMesure && current.program && current.program.formuleSurMesure) patch.formuleSurMesure = current.program.formuleSurMesure;
  const proposedProgram = patch.program ?? current.program;
  const proposedItems = Array.isArray(proposedProgram) ? proposedProgram
    : Array.isArray(proposedProgram?.items) ? proposedProgram.items : [];
  if (proposedItems.some((item) => Number(item.participants) > Number(patch.pax ?? current.pax))) {
    throw createHttpError('Le nombre de joueurs d’une activité dépasse le nombre de personnes du groupe.', 422);
  }
  // L HEURE D UNE ACTIVITE AJOUTEE (2026-11-20, Ansar : « modifier tout complet »). Modifier ajoute une
  // activite au dossier ; le comptoir peut lui donner son heure avant d enregistrer, comme Reserver
  // (lib/heures-posees.js) : apres le moteur, par le chemin du glisser (buildActivityMove puis
  // validateActivityMoveResources sur la journee relue, ce dossier mis a part), memes controles, memes
  // phrases. Seule une activite que le dossier n a pas encore et que le programme envoye porte se pose
  // ici : l heure d une activite deja au dossier se deplace par son propre chemin (activityMove), et une
  // heure restee sur une copie de la fiche ne rejoue rien. Un corps forge est refuse (lireHeuresPosees).
  const itemsAvant = Array.isArray(current.program) ? current.program : Array.isArray(current.program?.items) ? current.program.items : [];
  // (un bowling que le programme porte sans que le plan le place, le dossier 1953 : il recoit son heure
  // ici, comme un bowling ajoute ; un bowling place se deplace par son chemin)
  const dejaAuDossier = (id) => (id === 'bowling' ? false : itemsAvant.some((item) => item && item.activityId === id)) || Number.isFinite(heureDuPlan(current, id));
  const heuresAPoser = lireHeuresPosees(patch.heuresPosees)
    .filter((posee) => !dejaAuDossier(posee.activityId) && proposedItems.some((item) => item && item.activityId === posee.activityId));
  delete patch.heuresPosees;
  // Le bowling et le laser ajoutes ont leur heure avant le moteur, comme ancres (lib/heures-posees.js).
  const ancres = ancresDuMoteur(heuresAPoser);
  if (Object.keys(ancres).length) {
    const preference = patch.preference && typeof patch.preference === 'object' && !Array.isArray(patch.preference) ? patch.preference : {};
    const voulues = preference.preferredTimes && typeof preference.preferredTimes === 'object' && !Array.isArray(preference.preferredTimes) ? preference.preferredTimes : {};
    patch.preference = { ...preference, preferredTimes: { ...voulues, ...ancres } };
  }
  // LE NOMBRE DE PISTES POSE A LA MAIN (2026-11-05). Il suit le dossier : une heure ou un
  // nom change sans qu on le redemande. Le poser, le changer ou le retirer replanifie, et
  // descendre sous le conseil du centre demande le niveau forcer, juge ici.
  const poseAvant = pistesALaMainDuPlan(current.opsPlan);
  const poseEnvoyee = Object.prototype.hasOwnProperty.call(patch, 'pistesALaMain') ? Math.max(0, Math.trunc(Number(patch.pistesALaMain) || 0)) : null;
  const poseApres = poseEnvoyee !== null ? poseEnvoyee : poseAvant && (Array.isArray(patch.lanes) ? patch.lanes.length : (current.lanes || []).length) || poseAvant;
  delete patch.pistesALaMain;
  if (poseApres) patch.pistesALaMain = poseApres;
  if (poseApres && poseApres !== poseAvant) {
    const bowling = proposedItems.find((item) => item.activityId === 'bowling');
    const joueurs = Number(bowling && bowling.participants) || Number(patch.pax ?? current.pax) || 1;
    const normale = Number(getCenter(requestedCenterId).resources?.bowling?.normalCapacityPerLane) || 6;
    if (joueurs > poseApres * normale) exigerPistesALaMain(session);
  }
  const operationsChanged = patchChangesOperations(patch, current) || poseApres !== poseAvant || heuresAPoser.length > 0;
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
    ? await prepareReservationOps(operationalRequest, 'staff', { ignoreReservationId: Number(patch.id), heureEnregistree: current.startTime })
    : {};
  // UN PROGRAMME QUE LE PLAN NE PORTE PAS NE S ECRIT PAS (2026-11-20, dossier 1953 de Gembloux). Le
  // moteur refusait la Formule 5 avec son Bowling, et le dossier s ecrivait quand meme : le programme
  // avec le bowling, le plan d avant sans lui. Modifier lisait « Bowling --:-- », Infos l ancien plan,
  // un minigolf en double et une fin de visite fausse. Une activite ajoutee ou retiree, ou une heure
  // demandee, que le moteur ne sait pas placer est refusee avec son motif : rien ne s ecrit. (Un nombre
  // de joueurs que le plan ne suit pas s ecrit toujours sur l ancien plan, la console le dit.)
  if (shouldReplan && ops.planAvailable === false && patch.program && (heuresAPoser.length || !memesActivites(current, proposedItems))) {
    const motif = String(ops.planRefusal || ops.planWarning || 'le moteur n’a pas donné de motif.').trim();
    throw createHttpError(`Ce programme ne tient pas au planning : ${motif}`, 422);
  }
  if (heuresAPoser.length && shouldReplan && ops.opsPlan && ops.planAvailable !== false) {
    const jour = String(patch.date ?? current.date);
    const lu = await readStaffState(jour, requestedCenterId, { avecBlocages: true, avecFermetures: true });
    const autres = (Array.isArray(lu.reservations) ? lu.reservations : []).filter((row) => Number(row.id) !== Number(current.id));
    const pose = poserLesHeures({ ...operationalRequest, ...ops }, heuresAPoser, { reservations: autres, laneStatuses: lu.laneStatuses || {}, blocks: lu.blocks || [], date: jour });
    if (pose.refus) throw createHttpError(pose.refus.message, 422);
    ops.opsPlan = pose.dossier.opsPlan;
    // (une activite posee avant l arrivee fait venir le groupe plus tot : le dossier commence avec elle,
    // la fiche ne dit plus « début 13:00 » au-dessus d un bowling a 12:00)
    const premiere = debutDesActivites(ops.opsPlan);
    const arrivee = minuteDeLaFenetre(String(patch.startTime ?? current.startTime ?? '').slice(0, 5));
    if (Number.isFinite(premiere) && Number.isFinite(arrivee) && premiere < arrivee) {
      ops.startTime = `${String(Math.floor(premiere / 60)).padStart(2, '0')}:${String(premiere % 60).padStart(2, '0')}`;
    }
  }
  if (shouldReplan && JSON.stringify((patch.lanes ?? current.lanes ?? []).map(Number))
    === JSON.stringify((current.lanes || []).map(Number))) {
    const allocated = (ops.opsPlan?.resourceBlocks || []).filter((block) => block.resourceType === 'bowling_lane')
      .flatMap((block) => block.lanes || []);
    if (allocated.length) patch.lanes = [...new Set(allocated.map(Number))];
  }
  // LA REFERENCE ET LE PRIX, juges sur ce qui va s ecrire. Le contenu, c est
  // ce qui se vend : les pistes, l heure et le jour deplacent un dossier sans
  // rouvrir son prix.
  const extrasFinales = patch.extras ?? current.extras ?? [];
  const contenuChange = contenuDuDossier({ ...current, ...patch, ...ops, extras: extrasFinales }) !== contenuDuDossier(current) || poseApres !== poseAvant;
  const jourChange = String(patch.date ?? current.date) !== String(current.date);
  const memesPistes = Number(ops.laneCount ?? (patch.lanes ?? current.lanes ?? []).length) === (current.lanes || []).length;
  const base = operationsChanged
    ? baseDuServeur({ current, demande: operationalRequest, ops, contenuChange, jourChange, memesPistes })
    : (Number(current.basePrice) || 0);
  // UNE HEURE DEPLACEE GARDE SES MONTANTS (2026-11-04). Le moteur rechiffre au tarif du
  // jour ; rien de ce qui se vend n a bouge, le dossier garde son prix et ses lignes,
  // meme si un tarif a ete publie depuis.
  if (operationsChanged && !contenuChange && !jourChange && memesPistes) {
    if (Object.prototype.hasOwnProperty.call(ops, 'price')) ops.price = Object.prototype.hasOwnProperty.call(patch, 'price') ? Number(patch.price) : Number(current.price) || 0;
    if (ops.program) ops.program = programmeAuxMontantsDuDossier(ops.program, current.program);
    if (Object.prototype.hasOwnProperty.call(ops, 'programPrice')) ops.programPrice = base;
  }
  patch.basePrice = base;
  if (Object.prototype.hasOwnProperty.call(ops, 'basePrice')) ops.basePrice = base;
  // LE PRIX QUI SUIT (2026-11-03) : le contenu change et aucun prix n est
  // envoye, le serveur le pose sur sa reference, l ajustement en place
  // garde. Le moteur rend un prix sans ajustement (celui d un programme) ou
  // aucun (un plan de pistes sans prix demande) : celui-ci remplace les deux.
  // Personne ne l a decide : rien a juger, aucune trace de prix.
  const prixSuivi = contenuChange && !Object.prototype.hasOwnProperty.call(patch, 'price');
  if (prixSuivi) {
    patch.price = prixQuiSuit({ current, base, extras: extrasFinales, pax: patch.pax ?? current.pax });
    if (Object.prototype.hasOwnProperty.call(ops, 'price')) ops.price = patch.price;
  }
  const prixFinal = ops.price ?? patch.price ?? current.price;
  const formuleDuComptoir = current.program && current.program.formuleSurMesure;
  if (!prixSuivi && formuleDuComptoir && formuleDuComptoir.prixParPersonne !== undefined && Math.abs(Number(prixFinal) - prixQuiSuit({ current, base, extras: extrasFinales, pax: patch.pax ?? current.pax })) > 0.5) {
    const programme = ops.program ?? patch.program;
    const nom = { nom: formuleDuComptoir.nom };
    if (ops.program) ops.program = { ...programme, formuleSurMesure: nom };
    else if (patch.program) patch.program = { ...programme, formuleSurMesure: nom };
  }
  const notePrix = prixSuivi ? null : jugerPrixDeModification({ session, current, prix: prixFinal, base, extras: extrasFinales, contenuChange, raison: patch.prixRaison });
  if (notePrix) patch.notes = notesAvecPrix(patch.notes ?? current.notes, notePrix);
  return { patch, ops, shouldReplan, prixFinal, base, prixSuivi, contenuChange, jourChange };
}

const traiter = async (req, res) => {
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
      // L HISTORIQUE D UN DOSSIER (2026-11-03, lib/historique-dossier.js) : qui a
      // fait quoi, quand, en phrases simples. Voir le dossier, puis le niveau
      // « historique » du role, juge avant toute lecture de la base. Le dossier
      // doit etre du centre de la session : sinon 404, comme un dossier qui
      // n existe pas, et le journal n est lu que pour ce centre.
      if (requestUrl.searchParams.has('historique')) {
        const sessionHistorique = await requireStaffPermission(req, res, 'reservations.view', { centerId: requestUrl.searchParams.get('centerId') || '' });
        if (!sessionHistorique) return;
        exigerHistorique(sessionHistorique);
        const dossierId = String(requestUrl.searchParams.get('historique') || '').trim();
        if (!/^\d{1,12}$/.test(dossierId)) {
          sendError(res, 422, 'Dossier invalide.');
          return;
        }
        const centre = sessionHistorique.authorizedCenterId;
        const dossier = await getReservationById(Number(dossierId));
        if (!dossier || !centre || (dossier.centerId || 'libramont') !== centre) {
          sendError(res, 404, 'Réservation introuvable.');
          return;
        }
        // Ce que le fondateur a fait ne s y lit pas, lui compris (2026-11-18, lib/fondateur-invisible.js) :
        // l historique d un dossier est celui de l equipe. Ses gestes restent au journal de la plateforme.
        const historique = await lireHistoriqueDossier({ centerId: centre, reservationId: dossier.id });
        sendJson(res, 200, { ok: true, id: dossier.id, historique });
        return;
      }
      // LE NUMERO DE RESERVATION (2026-11-06, Ansar : « chaque numero affiche
      // mene quelque part »). La recherche, le lien direct (/?resa=1734), les
      // messages Telegram et le mail « a valider » demandent ou est la
      // reservation n° X. Dans le centre de l ecran : son jour et son heure,
      // pour que la console l ouvre. Dans un autre centre que la session peut
      // ouvrir (direction, meme client) : le nom de ce centre seulement, la
      // console y passe puis redemande. Sinon 404, le meme qu un numero qui
      // n existe pas : un autre client n apprend jamais qu un numero existe.
      if (requestUrl.searchParams.has('numero')) {
        const sessionNumero = await requireStaffPermission(req, res, ['planning.view', 'dashboard.view', 'reservations.view'], { centerId: requestUrl.searchParams.get('centerId') || '' });
        if (!sessionNumero) return;
        const numero = String(requestUrl.searchParams.get('numero') || '').trim();
        if (!/^\d{1,12}$/.test(numero)) {
          sendError(res, 422, 'Numéro de réservation invalide : des chiffres seulement.');
          return;
        }
        const centre = sessionNumero.authorizedCenterId;
        const dossier = await getReservationById(Number(numero));
        const sonCentre = dossier ? String(dossier.centerId || 'libramont') : '';
        if (dossier && centre && sonCentre === centre) {
          sendJson(res, 200, {
            ok: true,
            reservation: {
              id: dossier.id, centerId: sonCentre, date: dossier.date, startTime: dossier.startTime,
              name: dossier.name, pax: dossier.pax, status: dossier.status,
            },
          });
          return;
        }
        if (dossier && await sessionPeutOuvrirLeCentre(sessionNumero, sonCentre)) {
          sendJson(res, 200, { ok: true, centre: sonCentre });
          return;
        }
        sendError(res, 404, `Aucune réservation n° ${numero} dans ce centre.`);
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
      // « Modifier » demande ce que son enregistrement ecrirait (modifierABlanc) :
      // son droit est celui de modifier, pas celui de creer.
      if (body.dryRun === true && body.modification && typeof body.modification === 'object' && !Array.isArray(body.modification)) {
        // Une session d abord, comme le PATCH : sans elle, 401 sans avoir rien
        // lu (2026-11-16 : un inconnu recevait 404 pour un numero libre et 401
        // pour un numero pris, de quoi compter les dossiers).
        if (!(await requireAnyStaffSession(req, res))) return;
        await warmCenterKnowledge();
        const blanc = await modifierABlanc(req, res, body.modification);
        if (blanc) sendJson(res, 200, blanc);
        return;
      }
      // « Proposer un autre ordre » sur un dossier (autreOrdreABlanc) : le droit de le modifier.
      if (body.dryRun === true && body.autreOrdre && typeof body.autreOrdre === 'object' && !Array.isArray(body.autreOrdre)) {
        if (!(await requireAnyStaffSession(req, res))) return;
        await warmCenterKnowledge();
        const blanc = await autreOrdreABlanc(req, res, body.autreOrdre);
        if (blanc) sendJson(res, 200, blanc);
        return;
      }
      // L heure d une activite changee dans « Modifier » (deplacerABlanc) : le droit du glisser.
      if (body.dryRun === true && body.deplacement && typeof body.deplacement === 'object' && !Array.isArray(body.deplacement)) {
        if (!(await requireAnyStaffSession(req, res))) return;
        await warmCenterKnowledge();
        const blanc = await deplacerABlanc(req, res, body.deplacement);
        if (blanc) sendJson(res, 200, blanc);
        return;
      }
      const session = await requireStaffPermission(req, res, 'reservations.create', { centerId: body.centerId || body.center_id });
      if (!session) return;
      await warmCenterKnowledge();
      // Côté STAFF, le TELEPHONE est obligatoire (2026-11-11, exigerLeTelephone) ;
      // le nom et l'e-mail restent libres (sans nom, le dossier part au nom de
      // Client). L'email obligatoire reste réservé au parcours CLIENT PUBLIC
      // (api/public-reservations.js).
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
      exigerLeTelephone(body);
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
      const gesteDAccueil = patchNeedsOnlyStatus(body) || estGesteAccueil;
      const permission = patchIsActivityMoveOnly(body)
        ? ['planning.drag', 'reservations.edit']
        : (gesteDAccueil ? ['reservations.status', 'reservations.edit'] : 'reservations.edit');
      const session = await requireStaffPermission(req, res, permission, { centerId: current.centerId || 'libramont' });
      if (!session) return;
      // Sans « Voir les montants », le dossier revient sans ses montants : ils ne s ecrivent
      // pas, chaque ligne garde le sien (lib/montants-role.js, passe securite du 2026-11-08).
      if (res.__sansMontants) require('../lib/montants-role').retirerLesMontantsDuCorps(body, current);
      // LE CHEMIN DU RETOUR, SANS LE FONDATEUR (2026-11-13, lib/fondateur-invisible.js). Une session du centre
      // a recu les notes et les coches du fondateur sans son nom : renvoyees telles quelles, elles redeviennent
      // les lignes en base (sinon elles seraient resignees du nom de l employe, ou le nom effacerait la base).
      // Le fondateur, lui, coche sans signer.
      await rendreLeCorpsSansFondateur(body, current, session, res);
      // GLISSER UNE ACTIVITE DEMANDE LE DROIT DE SA RESSOURCE (passe securite du 2026-11-08) :
      // « Gérer les pistes bowling » et « Gérer les sessions Laser Game » ne gardaient que les
      // onglets de la console, un role sans l un des deux deplacait quand meme par l API.
      if (patchIsActivityMoveOnly(body)) {
        const activiteDeplacee = String((body.activityMove && body.activityMove.activityId) || '');
        const droitDeLaRessource = activiteDeplacee === 'laser_game' ? 'planning.laser' : (activiteDeplacee === 'bowling' ? 'planning.bowling' : '');
        if (droitDeLaRessource && !sessionHasPermission(session, droitDeLaRessource)) throw createHttpError('Ce planning ne fait pas partie de votre rôle.', 403);
      }
      // UN JOUR PASSE SE CORRIGE AVEC SON DROIT (2026-11-07). planning.past
      // (« Changer un jour passé ») ne gardait que le bouton Valider de l ecran :
      // modifier, deplacer ou annuler une reservation d hier passait par l API.
      // L accueil (etat, encaisse, absence, coches, notes) reste ouvert a tous
      // ceux qui l ont : un groupe paie encore apres minuit.
      const changeLAnnulation = Object.prototype.hasOwnProperty.call(body, 'status')
        && (String(body.status || '') === 'cancelled') !== (current.status === 'cancelled');
      const aujourdhui = aujourdhuiABruxelles();
      const jourPasse = (jour) => dateValide(jour) && jour < aujourdhui;
      if ((!gesteDAccueil || changeLAnnulation) && (jourPasse(current.date) || jourPasse(body.date))) {
        const sessionPasse = await requireStaffPermission(req, res, 'planning.past', { centerId: current.centerId || 'libramont' });
        if (!sessionPasse) return;
      }
      // ANNULER UN DOSSIER, OU LE RESTAURER, DEMANDE LE DROIT D ANNULER
      // (2026-10-12). La console ne montre « Annuler la réservation » qu a
      // reservations.cancel ; un PATCH qui faisait passer le statut a
      // cancelled (ou l en sortait) ne demandait que le droit de changer un
      // statut, et n importe quel role du comptoir annulait par l API. Le
      // dossier entier renvoye par « Modifier » porte son statut : seul un
      // CHANGEMENT d annulation est juge.
      if (changeLAnnulation) {
        const sessionAnnulation = await requireStaffPermission(req, res, 'reservations.cancel', { centerId: current.centerId || 'libramont' });
        if (!sessionAnnulation) return;
      }

      // UNE RESERVATION RESTE DANS SON CENTRE (2026-11-04) : ses pistes, son laser et ses horaires sont ceux de ce centre.
      // La console nomme toujours le centre du dossier ; un autre nom est refuse, jamais un deplacement. Le droit d abord :
      // une tentative inter-centres sans droit reste un refus trace au journal.
      if (requestedCenterId !== (current.centerId || 'libramont')) {
        const switchSession = await requireStaffPermission(req, res, 'centers.switch', { centerId: requestedCenterId });
        if (!switchSession) return;
        sendError(res, 422, 'Une réservation reste dans son centre : annulez-la et recréez-la dans l autre.');
        return;
      }

      // DEUX POSTES, UNE RESERVATION. La version sur laquelle le client a
      // travaille ne correspond plus : on le dit tout de suite, avec la
      // version actuelle, avant de replanifier pour rien. updateReservation
      // refait ce controle sous verrou : c est lui qui fait foi.
      const versionAttendue = lireVersionAttendue(body.baseUpdatedAt);
      if (versionAttendue !== null && !memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);

      // UN AUTRE ORDRE, APPLIQUE D UN GESTE (2026-11-18, lib/autre-ordre.js). Le serveur refait
      // la proposition sur la journee d aujourd hui ; celle que l employe a lue (sa cle) doit
      // etre la meme, sinon rien ne s ecrit. Puis c est une modification comme « Modifier » :
      // l ordre, ses heures et l arrivee, le plan refait par le moteur. Tout ou rien : un plan
      // qui ne tient plus au moment d ecrire n ecrit rien (l ancien plan reste).
      let autreOrdreApplique = null;
      if (Object.prototype.hasOwnProperty.call(body, 'autreOrdre')) {
        const enTrop = Object.keys(body).filter((cle) => !['id', 'centerId', 'center_id', 'baseUpdatedAt', 'autreOrdre'].includes(cle));
        if (enTrop.length) throw createHttpError('Un autre ordre ne modifie aucun autre choix du dossier.', 422);
        if (versionAttendue === null) throw createHttpError('Version du dossier manquante : rouvrez la fiche.', 422);
        const voulue = String((body.autreOrdre && body.autreOrdre.cle) || '');
        const proposition = await proposerUnAutreOrdre(current, session);
        if (!proposition.trouve) throw createHttpError(proposition.raison || 'Aucun ordre ne tient.', 409);
        if (proposition.trouve.cle !== voulue) throw createHttpError('La proposition a changé entre-temps : relancez « Proposer un autre ordre ».', 409);
        delete body.autreOrdre;
        // Les pistes lues voyagent : le moteur les reprend si elles sont toujours libres.
        const pistes = [...new Set(proposition.trouve.etapes.flatMap((etape) => etape.pistes || []))];
        Object.assign(body, proposition.trouve.modification, { opsPlan: null, lanes: pistes });
        // Place sans conflit (tout ou rien, plus bas) : la note « À placer : créé malgré le
        // conflit… » ne dit plus vrai et part dans la meme ecriture.
        const notesPlacees = notesSansLaNoteAPlacer(current);
        if (notesPlacees !== null) body.notes = notesPlacees;
        autreOrdreApplique = proposition.trouve;
      }

      // CE QUI A ETE ENCAISSE / LE GROUPE QUI N EST PAS VENU (0056) : deux
      // gestes de l accueil, seuls dans leur PATCH. L encaisse demande le
      // droit d encaisser ; l absence, celui de changer un statut.
      const gesteKeys = Object.keys(body).filter(key => !['id', 'centerId', 'center_id', 'baseUpdatedAt'].includes(key));
      if (gesteKeys.length === 1 && (gesteKeys[0] === 'encaissement' || gesteKeys[0] === 'absent')) {
        if (gesteKeys[0] === 'encaissement') {
          const paymentSession = await requireStaffPermission(req, res, 'payments.markPaid', { centerId: requestedCenterId });
          if (!paymentSession) return;
          // Encaisser moins que le prix, c est baisser le prix : il se juge au
          // niveau prix de la session, comme la porte du prix (2026-11-03). La
          // version est exigee plus bas : `current` est la ligne qui s ecrira.
          jugerEncaisse({ session, current, encaissement: body.encaissement });
        }
        const { noterEncaisseOuAbsence } = require('../lib/database');
        const reservation = await noterEncaisseOuAbsence({ id: current.id, centerId: requestedCenterId, baseUpdatedAt: body.baseUpdatedAt, ...(gesteKeys[0] === 'encaissement' ? { encaissement: body.encaissement } : { absent: body.absent === true }) });
        // L instantane du registre ne porte ni l encaisse ni l absence (colonnes
        // 0056) : l historique du dossier les lit ici.
        const geste = gesteKeys[0] === 'encaissement'
          ? { encaisse: { montant: reservation.amountPaid ?? reservation.price, prix: reservation.price, raison: reservation.discountReason || '' } }
          : { absent: Boolean(reservation.absentAt) };
        const audit = await writeAuditLog({ centerId: requestedCenterId, ...actorFromSession(session), surface: 'api/staff-reservations.js', action: gesteKeys[0] === 'encaissement' ? 'noterEncaisse' : 'noterAbsence', method: 'PATCH', entityType: 'reservation', entityId: current.id, outcome: 'success', changes: buildReservationAuditChanges(current, reservation), context: contexteRegistre(current, reservation, geste), requestId: newRequestId() });
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
        // Ajouter est un geste d accueil ; retirer ou reecrire touche a ce qui
        // est ecrit, la raison d un prix comprise.
        if (geste.retrait !== undefined || geste.modifier !== undefined) exigerRetraitDeNote(session);
        const updated = await noterReservationEquipe(current.id, current.centerId || 'libramont', {
          ajout: typeof geste.ajout === 'string' ? geste.ajout : undefined,
          retrait: typeof geste.retrait === 'string' ? geste.retrait : undefined,
          modifier: geste.modifier,
          // L auteur vient de la session, jamais du corps : une note ne
          // s ecrit pas au nom d un collegue (ni a celui du fondateur, nomDeSession).
          par: nomDeSession(session),
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
          { doneAt: coche.doneAt, by: require('../lib/fondateur-invisible').estFondateur(session) ? '' : coche.by },
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
        // (les fermetures et privatisations du jour : `snapshot.blocks` etait toujours vide, seule
        // l ecriture sous verrou les jugeait ; la meme phrase, maintenant des ce controle)
        const snapshot = await readStaffState(current.date, requestedCenterId, { avecBlocages: true, avecFermetures: true });
        try {
          validateActivityMoveResources(candidate, body.activityMove, snapshot.reservations.filter(row => Number(row.id) !== Number(current.id)), snapshot.laneStatuses, snapshot.blocks || [], current.date);
        } catch (error) { if (!error.statusCode) error.statusCode = 409; throw error; }
        const reservation = await updateReservation({ id: current.id, centerId: requestedCenterId, baseUpdatedAt: body.baseUpdatedAt, activityMove: body.activityMove, modifiePar: nomDeSession(session) });
        const automation = await refreshReservationAutomation(current, reservation, { reason: 'activity_moved' });
        const auditMove = await writeAuditLog({ centerId: requestedCenterId, ...actorFromSession(session), surface: 'api/staff-reservations.js', action: 'moveReservationActivity', method: 'PATCH', entityType: 'reservation', entityId: current.id, outcome: 'success', changes: buildReservationAuditChanges(current, reservation), context: contexteRegistre(current, reservation, { activityMove: body.activityMove }), requestId: newRequestId() });
        sendJson(res, 200, { ok: true, reservation, activityMove: { ...body.activityMove, unchangedActivities: true }, automation, ...(auditMove.warning ? { warnings: [auditMove.warning] } : {}) });
        return;
      }
      // ENCAISSER PAR « MODIFIER » DEMANDE LE DROIT D ENCAISSER (2026-10-12).
      // Le chemin du statut seul le demandait deja ; le dossier entier passait
      // a paid, ou changeait le moyen de paiement, avec reservations.edit.
      const moyenEnvoye = Object.prototype.hasOwnProperty.call(body, 'paymentMethod') || Object.prototype.hasOwnProperty.call(body, 'payment_method');
      const devientPaye = body.status === 'paid' && current.status !== 'paid';
      const moyenChange = moyenEnvoye && String(body.paymentMethod ?? body.payment_method ?? '') !== String(current.paymentMethod || '');
      if (devientPaye || moyenChange) {
        const sessionEncaisse = await requireStaffPermission(req, res, 'payments.markPaid', { centerId: requestedCenterId });
        if (!sessionEncaisse) return;
      }
      const { patch, ops, shouldReplan } = await calculerLaModification({ body, current, session, requestedCenterId });
      if (autreOrdreApplique && (!shouldReplan || ops.planAvailable === false || !planConformeALaProposition(ops.opsPlan, autreOrdreApplique))) {
        throw createHttpError(`Cet ordre ne tient plus tel quel${ops.planRefusal ? ` (${ops.planRefusal})` : ''} : relancez « Proposer un autre ordre ».`, 409);
      }
      const reservation = await updateReservation({
        ...patch,
        ...ops,
        channel: patch.channel || current.channel || 'staff',
        // La derniere modification se signe au nom de la session, jamais d un
        // nom venu du corps (lib/historique-dossier.js).
        modifiePar: nomDeSession(session),
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
      // ENREGISTRE N EST PAS REPLANIFIE (2026-11-02). Le moteur a refuse : le dossier
      // est ecrit, le planning garde l ancien plan (lib/database, opsPlan absent).
      // « Réservation mise à jour » tout court etait alors un mensonge tranquille :
      // la console lit ce motif et le dit. Il ne touche pas au statut de validation.
      const planNonRefait = shouldReplan && ops.planAvailable === false
        ? (ops.planRefusal || ops.planWarning || 'le moteur n’a pas donné de motif.') : '';
      sendJson(res, 200, {
        ok: true,
        reservation,
        automation,
        ...(planNonRefait ? { planNonRefait } : {}),
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
      // Supprimer un dossier d hier, c est le corriger : meme droit que le PATCH.
      if (dateValide(current.date) && current.date < aujourdhuiABruxelles()) {
        const sessionPasse = await requireStaffPermission(req, res, 'planning.past', { centerId: current.centerId || 'libramont' });
        if (!sessionPasse) return;
      }
      // LA VERSION DE LA SUPPRESSION (point C5, lib/database deleteReservation) : un dossier change depuis
      // que ce poste l a lu ne se supprime pas, et ses mails en attente ne sont pas annules pour rien.
      // deleteReservation refait ce controle sous verrou : c est lui qui fait foi.
      const versionSupprimee = lireVersionAttendue(body.baseUpdatedAt);
      if (versionSupprimee !== null && !memeVersion(current.updatedAt, versionSupprimee)) throw reservationModifieeEntreTemps(current);
      const automation = await cancelPendingAutomation(current, 'reservation_deleted');
      // LE REGISTRE (migration 0052) : la ligne entiere est copiee dans
      // reservation_archive AVANT le DELETE, dans la meme transaction. Si la
      // copie echoue, deleteReservation jette (503, message clair) et rien n est
      // supprime : la copie est OBLIGATOIRE, contrairement au journal d audit
      // ci-dessous qui reste non bloquant.
      let suppression;
      try {
        suppression = await deleteReservation(body.id, {
          archivedBy: libelleMembre(session),
          reason: String((body && body.reason) || 'suppression depuis la console').slice(0, 500),
          baseUpdatedAt: body.baseUpdatedAt,
        });
      } catch (error) {
        // Ecrit entre la lecture d ici et le verrou : le dossier reste, ses mails et travaux reviennent.
        if (error && error.code === 'reservation_modifiee' && error.reservation) {
          await refreshReservationAutomation(current, error.reservation, { reason: 'suppression_refusee' }).catch(() => null);
        }
        throw error;
      }
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
      require('../lib/garde-serveur').signalerPanneServeur('api/staff-reservations', error);
      sendError(res, 503, MESSAGE_INFRA);
      return;
    }
    // 409 : la version actuelle voyage avec le refus, le client rejoue son
    // action dessus. Elle ne part qu apres le controle de permission sur le
    // centre de la reservation (plus haut) : un refus de droit reste un 403.
    // Un refus de droit garde son code stable : la console le lit, pas la phrase.
    const extra = error && error.code === 'reservation_modifiee' && error.reservation
      ? { code: error.code, reservation: error.reservation }
      : estRefusDeDroit(error) ? { code: error.code } : {};
    sendError(res, (error && error.statusCode) || 400, raw, extra);
  }
};

// Les portes du comptoir voient les ouvertures exceptionnelles du centre (lib/booking-config).
module.exports = (req, res) => require('../lib/booking-config').pourLEquipe(() => traiter(req, res));
module.exports.calculerLaModification = calculerLaModification;
