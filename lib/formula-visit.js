'use strict';
// LA VISITE D UNE FORMULE PAR HEURE D ARRIVEE (2026-10-12).
//
// Le gerant de Fun Galaxy Libramont, verbatim : « ils prennent une formule,
// 10 personnes, ils veulent tous venir a 10h. Laser game et bowling sont
// reservables a une heure precise ; s ils sont full de 10 a 12h, eux veulent
// venir a cette tranche-la, ils font comment ? Ils peuvent pas, alors qu il y
// a d autres activites dans la formule, par exemple 30 minutes d arcade qu ils
// peuvent faire pendant ces heures-la. Pour le minigolf c est encore plus
// complique car il n y a pas de temps exact. Tu dois rendre tout ca
// parametrable. »
//
// LE REGLAGE DU CENTRE, ecrit une seule fois. La configuration (center-config,
// center-scope, meta publique) et le moteur (lib/ops-engine) le lisent ici :
//
//   arrivalFirst        la reservation par heure d arrivee est proposee.
//                       Defaut true : elle n agit QUE quand le client demande
//                       une heure d arrivee (sans elle, aucun calcul ne change)
//                       et un centre qui n en veut pas la coupe en ecrivant
//                       false. Le defaut ne demande pas d ecran de console :
//                       l editeur de configuration n est pas touche par ce lot.
//   maxWaitMinutes      l attente OISIVE acceptee : la part des trous de la
//                       visite qu aucune activite libre ne couvre. Defaut 30
//                       (une demi-heure, le pas de la grille), de 0 a 240.
//   maxVisitMinutes     la duree acceptee entre l arrivee et la fin de la
//                       visite. 0 = automatique : la duree naturelle de la
//                       formule (ses activites et transitions, sans attente)
//                       plus 120 minutes. Sinon une borne absolue, de 60 a
//                       720 minutes.
//   freeDurationPolicy  la duree retenue pour une activite libre a duree
//                       OUVERTE (minigolf, golf : modele open_range de
//                       ops-knowledge/activities.json) : 'min', 'default' (la
//                       duree d avant, le defaut) ou 'max'. Une etape de
//                       formule qui ecrit sa duree la garde toujours.
//
// Un reglage PAR FORMULE n est pas demande. Il irait dans l entree canonique
// de la formule (lib/catalog-store.js, champ a cote de orderPolicy), lu par
// formulaVisitOf avant celui du centre.

const FORMULA_VISIT_DEFAULTS = Object.freeze({
  arrivalFirst: true,
  maxWaitMinutes: 30,
  maxVisitMinutes: 0,
  freeDurationPolicy: 'default',
});
const FREE_DURATION_POLICIES = ['min', 'default', 'max'];
// La marge de la borne automatique de duree : la duree naturelle plus deux
// heures (proposition du mandat du 2026-10-12, reprise telle quelle).
const AUTO_VISIT_EXTRA_MINUTES = 120;
const MAX_WAIT_BOUNDS = [0, 240];
const MAX_VISIT_BOUNDS = [60, 720];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// Toujours un objet complet et borne : une cle absente ou illisible prend le
// defaut, une valeur hors bornes est ramenee a la borne. Ne jette jamais.
function normalizeFormulaVisit(input) {
  const src = isPlainObject(input) ? input : {};
  const brutVisite = src.maxVisitMinutes === null || src.maxVisitMinutes === undefined || src.maxVisitMinutes === ''
    ? 0
    : Math.trunc(Number(src.maxVisitMinutes));
  const policy = String(src.freeDurationPolicy || '').trim().toLowerCase();
  return {
    arrivalFirst: asBoolean(src.arrivalFirst, FORMULA_VISIT_DEFAULTS.arrivalFirst),
    maxWaitMinutes: clampInt(src.maxWaitMinutes, MAX_WAIT_BOUNDS[0], MAX_WAIT_BOUNDS[1], FORMULA_VISIT_DEFAULTS.maxWaitMinutes),
    // 0 (ou rien, ou une valeur illisible ou negative) = automatique.
    maxVisitMinutes: Number.isFinite(brutVisite) && brutVisite > 0
      ? Math.max(MAX_VISIT_BOUNDS[0], Math.min(MAX_VISIT_BOUNDS[1], brutVisite))
      : 0,
    freeDurationPolicy: FREE_DURATION_POLICIES.includes(policy) ? policy : FORMULA_VISIT_DEFAULTS.freeDurationPolicy,
  };
}

// Le reglage d un centre tel que le moteur le lit (fichier socle fusionne avec
// la config de la base, ou config normalisee d un centre ne en base).
function formulaVisitOf(center) {
  return normalizeFormulaVisit(center && center.formulaVisit);
}

// LA DUREE D UNE ACTIVITE LIBRE, la seule definition. Avec la politique
// 'default', c est exactement l expression d avant : la duree de l etape,
// sinon celle du modele, sinon celle d une partie, sinon 30 minutes. 'min' et
// 'max' ne changent que les activites a duree ouverte (open_range) dont le
// modele porte la borne demandee.
function freeStepMinutes(step, durationModel, policy = 'default') {
  const model = durationModel || {};
  const ouverte = model.type === 'open_range';
  const borne = ouverte && policy === 'min' ? Number(model.minMinutes)
    : ouverte && policy === 'max' ? Number(model.maxMinutes)
      : 0;
  const retenue = Number.isFinite(borne) && borne > 0 ? borne : model.defaultMinutes;
  return Number((step && step.durationMinutes) || retenue || model.gameMinutes || 30);
}

// LES ACTIVITES LIBRES A HEURE CHOISIE, dans une visite par heure d arrivee.
// Movsar, 2026-10-12 : « les arcades ont une heure choisie » ; le groupe qui
// arrive quand le bowling et le laser sont complets commence par elles, a son
// heure d arrivee, et le planning de la console doit les montrer a leur vraie
// heure. Une activite a duree OUVERTE (open_range : minigolf, golf) reste
// toujours sans heure : « on ne connait pas sa duree, le client la choisit ».
// Le reste du libre (boissons, credits) garde le pass de toute la visite.
const ACTIVITES_A_HEURE = Object.freeze(['arcade_time']);

function freeStepHasTime(step, durationModel) {
  const model = durationModel || {};
  return Boolean(step && ACTIVITES_A_HEURE.includes(step.activityId)) && model.type !== 'open_range';
}

// La borne de duree effective d une visite : celle du centre, sinon la duree
// naturelle de la formule plus la marge automatique.
function effectiveMaxVisitMinutes(reglage, naturalMinutes) {
  const borne = Math.trunc(Number(reglage && reglage.maxVisitMinutes) || 0);
  if (borne > 0) return borne;
  return Math.max(0, Math.round(Number(naturalMinutes) || 0)) + AUTO_VISIT_EXTRA_MINUTES;
}

module.exports = {
  ACTIVITES_A_HEURE,
  AUTO_VISIT_EXTRA_MINUTES,
  FORMULA_VISIT_DEFAULTS,
  FREE_DURATION_POLICIES,
  effectiveMaxVisitMinutes,
  formulaVisitOf,
  freeStepHasTime,
  freeStepMinutes,
  normalizeFormulaVisit,
};
