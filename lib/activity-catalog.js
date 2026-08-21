// Ce qu'un centre peut VENDRE, et a quel prix.
//
// POURQUOI CE MODULE
//
// Trois sources decrivaient une activite, chacune pour son usage :
//   * ops-knowledge/activities.json + table activities : la ressource, la duree,
//     les risques -> le MOTEUR ;
//   * centers.activityAvailability : ce centre la propose-t-il ? -> le CENTRE ;
//   * rien du tout : son tarif -> personne.
// Le tunnel client, l'API de disponibilite et la creation de reservation ont
// tous besoin de la MEME reponse a "qu'est-ce que ce centre vend, combien, et
// est-ce que ca contraint le planning ?". Une regle recopiee a trois endroits
// diverge : elle vit ici.
//
// LA FRONTIERE DU PRODUIT (la seule qui compte)
//
//   PLANIFIEE : bowling (piste) et laser (arene). Elles occupent une ressource
//     comptee, donc elles decident du creneau.
//   LIBRE : minigolf, billards, arcades, playground, golf o'Clock, duckpin,
//     fun run. Elles se reservent, s'annoncent, se facturent, mais n'entrent
//     JAMAIS dans un calcul de disponibilite. Le centre les absorbe.
//
// LE TARIF EST UNE DONNEE DE CENTRE, JAMAIS UNE CONSTANTE DU CODE. Tant qu'il
// n'est pas saisi (colonne activities.price_value, migration 0039), l'activite
// reste reservable et s'affiche "regle sur place" : un produit multi-tenant qui
// invente un prix fabrique un litige au comptoir.

const { getCenter } = require('./ops-knowledge');
const { listActivities, getActivityDoc } = require('./catalog-store');
const { resolveActivityUnitPrice } = require('./activity-pricing');
const { FUN_RUN_OPTIONS } = require('./booking-config');

const DEFAULT_ACTIVITY_CENTER = 'all';
const PLANNED_RESOURCE_TYPES = new Set(['bowling_lane', 'laser_arena']);
// Bornes de saisie client (un panier force ne doit pas devenir un DoS ni une
// facture absurde). Alignees sur l'esprit des bornes de reservation-request.
const MAX_UNITS = 20;
const MAX_HOURS = 6;

function centerActivityAvailability(centerId) {
  try {
    const center = getCenter(centerId || 'libramont');
    const availability = center && center.activityAvailability;
    return availability && typeof availability === 'object' ? availability : null;
  } catch (error) {
    // Centre inconnu : aucune activite proposee plutot qu'un catalogue devine.
    return null;
  }
}

function isPlannedDoc(doc) {
  return Boolean(doc && PLANNED_RESOURCE_TYPES.has(doc.resourceType));
}

function durationBounds(doc) {
  const model = (doc && doc.durationModel) || {};
  const base = Number(model.defaultMinutes || model.gameMinutes || 0) || 0;
  return {
    defaultMinutes: base,
    minMinutes: Number(model.minMinutes || base) || base,
    maxMinutes: Number(model.maxMinutes || base) || base,
    // Le pas entre deux durees vendables. 30 min par defaut ; le billard se
    // vend a l'heure pleine, d'ou son pas de 60.
    stepMinutes: Number(model.stepMinutes || 30) || 30,
  };
}

// La liste vendable d'un centre. Une activite y est si elle existe au catalogue
// effectif du centre (ligne centre > ligne 'all'), si son bloc booking la dit
// reservable, et selon activityAvailability :
//
//   PLANIFIEE : proposee SAUF refus explicite (availability[id] === false).
//     Bowling et laser sont le tunnel d'aujourd'hui : les conditionner a une
//     case cochee aurait vide le formulaire de tout centre pas encore configure
//     (Ciney a un activityAvailability vide) et casse la reservation en prod.
//   LIBRE : proposee SEULEMENT si cochee. Promettre un minigolf a un centre qui
//     n'en a pas coute plus cher que de ne pas le proposer.
//
// activityAvailability fait autorite : c'est la case que la direction voit dans
// Etablissement, et le site du client dit la meme chose (billards a Libramont et
// Gembloux, golf o'Clock a Gembloux, playground et fun run a Libramont).
function listCenterActivities(centerId) {
  return listSellableActivities({ centerId, availability: centerActivityAvailability(centerId) });
}

// Coeur PUR : l'appelant fournit la disponibilite deja resolue. C'est ce qui
// permet aux gates de piloter un centre mocke sans passer par getCenter, et a
// api/public-booking-meta de reutiliser le centre qu'il a deja en main.
function listSellableActivities({ centerId, availability = null }) {
  const out = [];
  for (const doc of listActivities(centerId || DEFAULT_ACTIVITY_CENTER)) {
    const booking = doc.booking || null;
    if (!booking || booking.bookable !== true) continue;
    const planned = isPlannedDoc(doc);
    const declared = availability ? availability[doc.id] : undefined;
    if (planned ? declared === false : declared !== true) continue;
    const bounds = durationBounds(doc);
    // ---- UNE ACTIVITE LIBRE SANS DUREE NE SE VEND PAS ---------------------
    //
    // Mesure sur la production le 2026-08-21 : la Kara Box de N4 etait servie
    // au tunnel avec une duree de ZERO (son duration_model n'avait jamais ete
    // pose). Le client la choisissait, voyait des creneaux, et se faisait
    // refuser a la validation par « Ce creneau ne peut pas etre planifie
    // automatiquement » : un message qui ne dit pas la cause et qu'aucun
    // gerant ne peut corriger seul. Une vente perdue a la derniere etape.
    //
    // Les activites PLANIFIEES sont exclues de cette regle : le bowling et le
    // laser tirent leur duree du nombre de parties, pas de ce modele (le socle
    // porte d'ailleurs laser_game a 0 minute depuis toujours, et il marche).
    //
    // Ne pas proposer coute une activite absente du tunnel, le temps que le
    // gerant pose sa duree. La proposer coute une reservation qui echoue
    // devant le client.
    if (!planned && !(Number(bounds.defaultMinutes) > 0)) continue;
    out.push({
      id: doc.id,
      name: doc.name || doc.id,
      planned,
      resourceType: doc.resourceType || null,
      priceType: booking.priceType || 'on_site',
      priceValue: booking.priceValue == null ? null : Number(booking.priceValue),
      // Paliers de tarif par jour et par creneau (migration 0043). Servis au
      // tunnel pour qu'il annonce la meme chose que la facture.
      pricing: booking.pricing || null,
      unitLabel: booking.unitLabel || '',
      order: booking.order == null ? null : Number(booking.order),
      defaultMinutes: bounds.defaultMinutes,
      minMinutes: bounds.minMinutes,
      maxMinutes: bounds.maxMinutes,
      stepMinutes: bounds.stepMinutes,
      // Ce que le centre precise au client (« 12 niveaux », « 2 pistes ») et
      // ce que l'installation accepte : le tunnel ne doit rien redeviner.
      note: booking.note || '',
      maxPax: booking.maxPax == null ? null : Number(booking.maxPax),
      units: booking.units == null ? null : Number(booking.units),
      unitIds: Array.isArray(booking.unitIds) ? booking.unitIds : null,
    });
  }
  return out;
}

function getCenterActivity(centerId, activityId) {
  const id = String(activityId || '');
  if (!id) return null;
  return listCenterActivities(centerId).find((activity) => activity.id === id) || null;
}

// Le prix d'UNE ligne du programme, hors bowling et laser dont les grilles
// existantes (lib/booking-config) restent seules a faire foi : les recopier ici
// creerait deux verites sur le meme montant.
// Rend null quand le montant est inconnu (tarif non saisi, ou active au
// comptoir) : null n'est pas zero, et s'affiche "regle sur place".
// dateStr / startTime : necessaires pour qu'un palier borne par le jour ou
// l'heure puisse s'appliquer. Absents, c'est le prix de BASE qui gagne : le
// montant ne peut donc que baisser une fois le creneau connu, jamais monter.
function activityLinePrice(activity, { pax = 1, units = 1, hours = 1, minutes = null, dateStr = '', startTime = '' } = {}) {
  if (!activity) return null;
  if (activity.priceType === 'grid_bowling' || activity.priceType === 'grid_laser') return null;
  // Grille de session : le montant vient de la grille, pas d'un tarif saisi.
  // Une duree hors grille ne s'invente pas au prorata : on prend le palier
  // demande, ou le premier a defaut.
  if (activity.priceType === 'grid_fun_run') {
    const wanted = Number(minutes);
    const option = FUN_RUN_OPTIONS.find((item) => item.minutes === wanted) || FUN_RUN_OPTIONS[0];
    return round2(option.price);
  }
  const unitPrice = resolveActivityUnitPrice(activity.pricing || null, activity.priceValue, { dateStr, startTime });
  if (unitPrice == null) return null;
  const people = Math.max(1, Math.trunc(Number(pax) || 1));
  if (activity.priceType === 'per_pax') return round2(unitPrice * people);
  if (activity.priceType === 'per_unit_hour') {
    const quantity = clampInt(units, 1, MAX_UNITS);
    const duration = clampNumber(hours, 0.5, MAX_HOURS);
    return round2(unitPrice * quantity * duration);
  }
  return null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clampInt(value, min, max) {
  const parsed = Math.trunc(Number(value) || min);
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

// Duree estimee d'une activite libre dans le programme. Sert a annoncer une
// heure de fin honnete au client, jamais a reserver une ressource.
function activityEstimatedMinutes(activity, { hours = null, minutes = null } = {}) {
  if (!activity) return 0;
  if (activity.priceType === 'grid_fun_run') {
    const wanted = Number(minutes);
    const option = FUN_RUN_OPTIONS.find((item) => item.minutes === wanted) || FUN_RUN_OPTIONS[0];
    return option.minutes;
  }
  if (activity.priceType === 'per_unit_hour' && hours != null) {
    return Math.round(clampNumber(hours, 0.5, MAX_HOURS) * 60);
  }
  return Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0));
}

module.exports = {
  MAX_HOURS,
  MAX_UNITS,
  PLANNED_RESOURCE_TYPES,
  activityEstimatedMinutes,
  activityLinePrice,
  getCenterActivity,
  listCenterActivities,
  listSellableActivities,
  isPlannedActivityId: (centerId, id) => isPlannedDoc(getActivityDoc(String(id || ''), centerId || DEFAULT_ACTIVITY_CENTER)),
};
