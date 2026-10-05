// LE REGISTRE : aucune donnee perdue (2026-10-05).
//
// Movsar : chaque reservation et chaque donnee saisie, sur le formulaire
// public comme dans la console, doit etre gardee en entier et rester
// recuperable apres une erreur, une panne ou une intrusion. Un audit a montre
// que le journal (0031) ne tenait pas cette promesse pour les reservations :
//   - la liste des champs journalises nommait `clientName` alors que l objet
//     reservation porte `name` : le nom du client n etait JAMAIS ecrit ;
//   - le telephone n y etait pas ; la note n y etait qu en longueur ;
//   - une reservation en ligne ou une demande sur mesure n ecrivait rien.
//
// Ce module est la SEULE source de ce qu un instantane de reservation
// contient. La liste des champs n est pas recopiee a la main : elle est
// DERIVEE des clefs de l objet que lib/database.js (mapReservation) rend a
// toute l application. Une colonne ajoutee demain entre dans le registre sans
// qu on y pense ; une clef renommee ne peut plus manquer en silence, et le
// gate scripts/registre-check.js le verifie contre mapReservation lui-meme.
//
// Ce qui est garde EN ENTIER : nom, telephone, e-mail, notes (texte complet),
// prix, statut, moyen de paiement, programme, pistes, extras, occasion,
// accompagnants, suivi d activites, canal, centre, risque, statut de
// validation. Le plan d exploitation (opsPlan), lui, est resume : ses blocs
// de ressources (activite, heures, pistes, joueurs) et son drapeau de retard,
// sans la timeline ni les diagnostics qui le font peser plusieurs Ko et que le
// moteur recalcule. Le plan COMPLET est garde par reservation_archive a la
// suppression (to_jsonb de la ligne).
//
// Doctrine assumee, qui remplace la regle T2 de database/audit-log-schema.sql
// pour les reservations : le texte des notes et le telephone SONT journalises,
// parce que c est precisement ce qu il faut pouvoir retrouver quand un dossier
// a ete abime. Le journal reste scope par centre (lecture en parametre SQL) et
// reserve a la plateforme (action auditLog : platform.admin).

const { buildChanges } = require('./audit-log');

// Les clefs de l objet reservation qui ne portent AUCUNE donnee saisie et
// bougent a chaque ecriture : les journaliser noierait le signal.
const RESERVATION_VOLATILE_FIELDS = ['createdAt', 'updatedAt'];

let fieldsCache = null;

// La copie de secours des clefs de mapReservation, pour les gates qui
// remplacent lib/database.js par un double sans mapReservation. Jamais la
// source de verite : scripts/registre-check.js exige qu elle soit EGALE aux
// clefs reelles, donc une colonne ajoutee a mapReservation la fait rougir.
const RESERVATION_FIELDS_FALLBACK = [
  'id', 'name', 'phone', 'email', 'date', 'startTime', 'duration', 'totalDuration', 'lanes', 'pax', 'status',
  'basePrice', 'price', 'type', 'formuleId', 'label', 'occasion', 'companions', 'extras', 'paymentMethod', 'notes',
  'activityProgress', 'program', 'channel', 'centerId', 'opsPlan', 'riskLevel', 'riskScore', 'validationStatus',
];

// Les clefs de l objet reservation tel que mapReservation le rend. Lu a la
// demande (lib/database.js charge ce module en retour) et mis en cache : la
// forme de l objet ne change pas pendant la vie du processus.
function reservationSnapshotFields() {
  if (fieldsCache) return fieldsCache;
  let keys = null;
  try {
    const { mapReservation } = require('./database');
    if (typeof mapReservation === 'function') keys = Object.keys(mapReservation({}));
  } catch (error) {
    keys = null;
  }
  if (!keys) return RESERVATION_FIELDS_FALLBACK.slice();
  fieldsCache = keys.filter((key) => !RESERVATION_VOLATILE_FIELDS.includes(key));
  return fieldsCache;
}

// Les clefs que le registre ne tronque jamais (lib/audit-log.js les reconnait
// par ce nom, a tous les niveaux) : l identite du client et ce qu il a ecrit.
const IDENTITY_FIELDS = ['name', 'phone', 'email', 'notes'];

function resumeBloc(block) {
  if (!block || typeof block !== 'object') return null;
  const out = {};
  for (const key of ['activityId', 'resourceType', 'startTime', 'endTime', 'durationMinutes', 'players', 'requiredLanes', 'games', 'sessions', 'units']) {
    if (block[key] !== undefined && block[key] !== null && block[key] !== '') out[key] = block[key];
  }
  if (Array.isArray(block.lanes)) out.lanes = block.lanes.map(Number);
  return out;
}

function resumeDrapeauRetard(flag) {
  if (!flag || typeof flag !== 'object') return null;
  const out = {};
  for (const key of ['minutes', 'from', 'to', 'cleared', 'sourceId', 'at']) {
    if (flag[key] !== undefined && flag[key] !== null) out[key] = flag[key];
  }
  if (flag.origin && typeof flag.origin === 'object') {
    out.origin = {
      startTime: flag.origin.startTime || '',
      lanes: Array.isArray(flag.origin.lanes) ? flag.origin.lanes.map(Number) : [],
    };
  }
  return out;
}

// Le resume d un plan d exploitation : ce qu un humain relit pour comprendre
// ou etait le groupe (heures, pistes, blocs par activite) et s il portait un
// retard. Borne a 60 blocs : au-dela, c est un plan forge, et le compte le dit.
function resumeOpsPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const out = {
    startTime: plan.startTime || '',
    endTime: plan.endTime || '',
    totalMinutes: Number(plan.totalMinutes) || 0,
    assignedLanes: Array.isArray(plan.assignedLanes) ? plan.assignedLanes.map(Number) : [],
    blocs: blocks.slice(0, 60).map(resumeBloc).filter(Boolean),
    nbBlocs: blocks.length,
  };
  if (plan.validationMode) out.validationMode = String(plan.validationMode);
  if (plan.staffSummary) out.staffSummary = String(plan.staffSummary).slice(0, 300);
  const retard = resumeDrapeauRetard(plan.delayFlag);
  if (retard) out.delayFlag = retard;
  return out;
}

// L instantane COMPLET d une reservation : toutes les clefs de l objet (sauf
// les horodatages volatils), les valeurs telles quelles, le plan resume.
// `null` ou un objet vide rend un instantane vide (creation : rien avant ;
// suppression : rien apres).
function reservationSnapshot(reservation) {
  if (!reservation || typeof reservation !== 'object' || !Object.keys(reservation).length) return {};
  const snapshot = {};
  for (const key of reservationSnapshotFields()) {
    const value = reservation[key];
    snapshot[key] = key === 'opsPlan' ? resumeOpsPlan(value) : (value === undefined ? null : value);
  }
  return snapshot;
}

// L avant / apres d une reservation, champ par champ, sur l instantane
// complet. Creation : `before` vide, donc chaque champ apparait avec sa valeur
// d apres. Suppression : `after` vide, le dossier entier est dans `before`.
// Modification : seuls les champs qui ont change figurent, valeurs entieres
// (le texte complet de la note, l ancien et le nouveau telephone).
function reservationChanges(before, after) {
  return buildChanges(reservationSnapshot(before), reservationSnapshot(after), reservationSnapshotFields());
}

// L instantane d une demande sur mesure (custom_requests), objet mappe par
// lib/database.js (mapCustomRequest). Tout y est : le contact, l organisation,
// la date voulue, le message, la demande structuree et le suivi.
const CUSTOM_REQUEST_FIELDS = ['centerId', 'contactName', 'company', 'email', 'phone', 'requestedDate', 'pax', 'occasion', 'message', 'source', 'status', 'payload'];

function customRequestSnapshot(request) {
  if (!request || typeof request !== 'object' || !Object.keys(request).length) return {};
  const snapshot = {};
  for (const key of CUSTOM_REQUEST_FIELDS) snapshot[key] = request[key] === undefined ? null : request[key];
  return snapshot;
}

// Le diff compact du SUIVI d une demande (payload.suivi) : les evenements et
// les notes AJOUTES par l action, pas l historique entier (borne a 60
// evenements et 40 notes de 1 500 caracteres : relu deux fois, il pesait
// jusqu a 120 Ko par ligne).
function suiviAjoute(avant, apres) {
  const s1 = (avant && avant.payload && avant.payload.suivi) || {};
  const s2 = (apres && apres.payload && apres.payload.suivi) || {};
  const h1 = Array.isArray(s1.historique) ? s1.historique : [];
  const h2 = Array.isArray(s2.historique) ? s2.historique : [];
  const n1 = Array.isArray(s1.notes) ? s1.notes : [];
  const n2 = Array.isArray(s2.notes) ? s2.notes : [];
  const out = {};
  if (h2.length > h1.length) out.evenements = h2.slice(h1.length);
  if (n2.length > n1.length) out.notes = n2.slice(n1.length);
  return out;
}

// L avant / apres d une demande sur mesure : le statut et les colonnes en
// diff classique, le suivi en diff compact (ce qui a ete ajoute).
function customRequestChanges(before, after) {
  const fields = CUSTOM_REQUEST_FIELDS.filter((key) => key !== 'payload');
  const changes = buildChanges(customRequestSnapshot(before), customRequestSnapshot(after), fields);
  if (!before || !Object.keys(before).length) {
    // Creation : la demande structuree et le reste du payload en entier.
    changes.payload = { before: null, after: (after && after.payload) || {} };
    return changes;
  }
  const ajout = suiviAjoute(before, after);
  if (Object.keys(ajout).length) changes.suivi = { before: null, after: ajout };
  return changes;
}

// L acteur d une ecriture faite par un client sur le formulaire public.
const ACTEUR_FORMULAIRE_PUBLIC = Object.freeze({
  actorKind: 'public',
  actorMemberId: null,
  actorLabel: 'client (formulaire public)',
  actorRoleId: null,
});

// Le libelle « qui » d une session staff, pour archived_by / restored_by :
// identifiant et nom, lisibles meme si le membre est supprime plus tard.
function libelleMembre(session) {
  const member = session && session.member;
  if (!member) return '';
  const id = String(member.id || '').trim();
  const name = String(member.name || member.displayName || '').trim();
  return [id, name].filter(Boolean).join(' ').slice(0, 200);
}

module.exports = {
  ACTEUR_FORMULAIRE_PUBLIC,
  CUSTOM_REQUEST_FIELDS,
  IDENTITY_FIELDS,
  RESERVATION_FIELDS_FALLBACK,
  RESERVATION_VOLATILE_FIELDS,
  customRequestChanges,
  customRequestSnapshot,
  libelleMembre,
  reservationChanges,
  reservationSnapshot,
  reservationSnapshotFields,
  resumeOpsPlan,
  suiviAjoute,
};
