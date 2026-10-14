const TOTAL_LANES = 8;
const MAX_PER_LANE = 6;
const EMERGENCY_MAX_PER_LANE = 7;
const PAIRS = [[1,2],[3,4],[5,6],[7,8]];
const BOWLING_PRICES = { 0.5: 20, 1: 39, 1.5: 59, 2: 78 };
const LASER_GAME_MAX_PLAYERS = 30;
const LASER_GAME_PARALLEL_LAUNCHES = 1;
const LASER_GAME_ARENA_MINUTES = 25;
const LASER_GAME_OPTIONS = [
  { games: 1, value: 0.5, label: '1 partie', price: 10, durationMinutes: 30 },
  { games: 2, value: 1, label: '2 parties', price: 18, durationMinutes: 60 },
  { games: 3, value: 1.5, label: '3 parties', price: 25, durationMinutes: 90 },
];
const FORMULES = [
  { id:'f1', name:'FORMULE 1', family:'Formules anniversaires', desc:["1h de Bowling","1 partie Laser Game","30 min arcades","2 cruches boissons"], price:26, oldPrice:34, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'f2', name:'FORMULE 2', family:'Formules anniversaires', desc:["1 partie Minigolf","2 parties Laser Game","30 min arcades","2 cruches boissons"], price:30, oldPrice:45, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, best:true, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'f3', name:'FORMULE 3', family:'Formules anniversaires', desc:["1 partie Minigolf","1h de Bowling","30 min d'Arcades","2 cruches boissons"], price:28, oldPrice:34, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  // Les variantes de la Formule 4 : jumelles du socle (booking-constants-drift-check),
  // la console lit celles que le plan du dossier garde (getReservationFormulaChoice).
  { id:'f4', name:'FORMULE 4', family:'Formules anniversaires', desc:["1 partie de Minigolf","1h de Bowling","2 parties Laser Game","2 cruches boissons"], price:39, oldPrice:48, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"],
    choices:[{ id:'laser2', label:'2 parties de Laser Game' }, { id:'arcade60', label:"60 min d'arcades", replaces:['laser_game'], steps:[{ activityId:'arcade_time', count:1, durationMinutes:60 }], descReplaces:['Laser Game'], descWith:["60 min d'arcades"] }] },
  { id:'f5', name:'FORMULE 5', family:'Formules anniversaires', desc:["2 parties de Laser Game","1 partie de Minigolf","2 cruches boissons"], price:26, oldPrice:32, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'f6', name:'FORMULE 6', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","8 crédits d'arcade (8€) par enfant","2 cruches boissons"], price:18, oldPrice:20, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'f7', name:'FORMULE 7', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","1 entrée Mini Golf Blacklight","8 crédits d'arcade (8€) par enfant","2 cruches boissons"], price:24, oldPrice:30, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'f8', name:'FORMULE 8', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","1 entrée Mini Golf Blacklight","30 minutes d'arcade à volonté par enfant","2 cruches boissons"], price:28, oldPrice:37, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés","Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire"] },
  { id:'bts', name:'BACK TO SCHOOL/WORK', family:'Formules spéciales', desc:["1h de Bowling","1h d'Arcades"], price:20, oldPrice:50, type:'per_pax', minPax:4, validDays:[0,2,3,4], timeLimit:{min:18,max:22}, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Mardi, mercredi, jeudi et dimanche","De 18h à 22h","4 personnes minimum","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'mm', name:'MATIN MALIN', family:'Formules spéciales', desc:["Arcades illimitées, hors jeux à cadeaux","Laser Game illimité"], price:25, oldPrice:90, type:'per_pax', minPax:1, timeLimit:{max:12}, estimatedTotalDuration:2, orderPolicy:'open_window', noHolidays:true, hasBowling:false, notes:["Toutes les activités de la formule doivent être terminées à 12h","Les jeux d’arcade à cadeaux ne sont pas inclus","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'css', name:'CRAZY STUDENT STRIKE', family:'Formules spéciales', desc:["1h de Bowling","1 mètre de bière"], price:55, type:'per_lane', minPax:1, validDays:[2], noHolidays:false, hasBowling:true, bowlingDur:1, notes:["Disponible uniquement le mardi"] },
  { id:'kfd', name:'KIDS FUN DAY', family:'Formules spéciales', desc:["Toutes les activités illimitées","De 12h à 17h pour les enfants de 5 à 12 ans"], price:30, type:'per_pax', minPax:1, validDays:[3], timeLimit:{min:12,max:17}, orderPolicy:'open_window', noHolidays:true, hasBowling:false, notes:["Disponible uniquement le mercredi","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'hlg', name:'HAPPY LASER AND GAME', family:'Formules spéciales', desc:["30 minutes d'arcade","1 partie de Laser Game","1 boisson"], price:20, type:'per_pax', minPax:1, validDays:[4], noHolidays:true, hasBowling:false, notes:["Disponible uniquement le jeudi"] },
  { id:'ffm', name:'FUN FRIDAY MADNESS', family:'Formules spéciales', desc:["1 heure de Bowling","1 partie de Laser Game","30 minutes d'arcade","1 boisson"], price:30, type:'per_pax', minPax:1, validDays:[5], noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Disponible uniquement le vendredi"] },
];
const UPSELL_CATALOG = [
  { id:'u1', name:'Cruche Bière', price:18 },
  { id:'u2', name:'Cruche Soda', price:12 },
  { id:'u3', name:'Pack Jetons', price:10 },
  { id:'u4', name:'Tapas', price:15 },
];
// Fun Run by PIXEL : des SESSIONS, pas des heures (30 EUR les 15 min, 55 les
// 30 : le prix horaire n'est meme pas constant). Miroir de lib/booking-config,
// comme les grilles bowling et laser au-dessus.
const FUN_RUN_OPTIONS = [
  { minutes: 15, label: '15 min', price: 30 },
  { minutes: 30, label: '30 min', price: 55 },
];
const FUN_RUN_MAX_PAX = 5;
const DURATION_OPTIONS = [
  { value:0.5, label:'30 min', price:20 },
  { value:1, label:'1 heure', price:39 },
  { value:1.5, label:'1h30', price:59 },
  { value:2, label:'2 heures', price:78 },
];
// Repli hors-ligne des CENTRES DU FICHIER, cle par leur id : jamais servi a
// un autre centre (getAdminCenters filtre sur le centre de la session, et le
// repli d un centre inconnu est neutre, cf. getAdminCenter dans app-main.js).
// Miroir minimal de ops-knowledge/centers.json.
const ADMIN_CENTER_FALLBACKS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30, parallelLaunches: 1, requiresCompleteGroupBeforeLaunch: true } } },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30, parallelLaunches: 3, requiresCompleteGroupBeforeLaunch: false } } },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', resources: { bowling: null, laser: null } }
];

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, delta) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + delta);
  return toLocalDateStr(d);
}

// Conges scolaires FWB verifies (enseignement.be). kind: 'summer' = grandes
// vacances, 'short' = petits conges. Miroir de lib/booking-config.js.
const WALLONIA_SCHOOL_HOLIDAYS = [
  { start: '2025-10-20', end: '2025-11-02', label: 'Congé d\'automne', kind: 'short' },
  { start: '2025-12-22', end: '2026-01-04', label: 'Vacances d\'hiver', kind: 'short' },
  { start: '2026-02-16', end: '2026-03-01', label: 'Congé de détente', kind: 'short' },
  { start: '2026-04-27', end: '2026-05-10', label: 'Vacances de printemps', kind: 'short' },
  { start: '2026-07-04', end: '2026-08-23', label: 'Vacances d\'été', kind: 'summer' },
  { start: '2026-10-19', end: '2026-11-01', label: 'Congé d\'automne', kind: 'short' },
  { start: '2026-12-21', end: '2027-01-03', label: 'Vacances d\'hiver', kind: 'short' },
  { start: '2027-02-22', end: '2027-03-07', label: 'Congé de détente', kind: 'short' },
  { start: '2027-04-26', end: '2027-05-09', label: 'Vacances de printemps', kind: 'short' },
  { start: '2027-07-03', end: '2027-08-22', label: 'Vacances d\'été', kind: 'summer' }
];
const BELGIAN_PUBLIC_HOLIDAY_CACHE = new Map();
const BUSINESS_TIME_ZONE = 'Europe/Brussels';

// Config centre (horaires staff, regime vacances/feries, offres) poussee par
// /api/public-booking-meta ou par la config staff. Null = grille historique.
const HOLIDAY_PERIOD_TYPES = ['public', 'school_short', 'school_summer', 'manual'];
const DEFAULT_FORMULA_BLOCKED_PERIODS = ['public', 'school_short', 'manual'];
let centerScheduleConfig = null;

function setCenterScheduleConfig(config) {
  centerScheduleConfig = config && typeof config === 'object' ? config : null;
}

function getCenterScheduleConfig() {
  return centerScheduleConfig;
}

// Ce que CE centre vend (cle `activities` de /api/public-booking-meta) : bowling
// et laser, qui contraignent le creneau, plus les activites libres du centre
// (minigolf, billards, arcades...). Vide tant que la meta n'est pas revenue : le
// tunnel retombe alors sur les deux activites planifiees, c'est-a-dire sur le
// formulaire d'avant.
let centerActivities = [];

// Les ingredients d'une formule que CE centre ne possede pas.
// Retourne toujours un tableau ; vide quand on ne sait pas (aucune table
// d'activites servie) : dans le doute on ne retire jamais une offre.
function centerMissingActivityIds(activityIds) {
  const wanted = Array.isArray(activityIds) ? activityIds.filter(Boolean).map(String) : [];
  if (!wanted.length) return [];
  const config = getCenterScheduleConfig();
  const map = config && config.activityAvailability && typeof config.activityAvailability === 'object'
    ? config.activityAvailability
    : null;
  if (!map) return [];
  const owned = Object.keys(map).filter((id) => map[id]);
  if (!owned.length) return [];
  return wanted.filter((id) => !owned.includes(id));
}

function setCenterActivities(list) {
  centerActivities = Array.isArray(list) ? list.filter((item) => item && item.id) : [];
}

function getCenterActivities() {
  return centerActivities.slice();
}

function getCenterActivity(activityId) {
  return centerActivities.find((item) => item.id === String(activityId || '')) || null;
}

// Prix d'une activite libre, ou null quand le centre n'a pas saisi son tarif.
// null s'affiche "sur place" : afficher 0 EUR promettrait la gratuite.
// Miroir de lib/activity-pricing.resolveActivityUnitPrice : le prix UNITAIRE
// d'une activite peut dependre du JOUR et du CRENEAU (migration 0043). Sans
// creneau choisi, c'est le prix de base : le montant ne peut que baisser une
// fois l'heure connue, jamais monter. Un gate prouve que ce miroir et le
// serveur disent le meme prix.
function resolveActivityUnitPrice(pricing, basePrice, { dateStr = '', startTime = '' } = {}) {
  const base = basePrice === null || basePrice === undefined ? null : Number(basePrice);
  if (!pricing || !Array.isArray(pricing.tiers) || !pricing.tiers.length) return base;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return base;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(startTime || '').trim());
  const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;
  for (const tier of pricing.tiers) {
    const days = Array.isArray(tier.days) ? tier.days : [];
    if (days.length && days.indexOf(day) === -1) continue;
    const bounded = tier.fromMinutes != null || tier.untilMinutes != null;
    if (bounded) {
      if (minutes === null) continue;
      if (tier.fromMinutes != null && minutes < tier.fromMinutes) continue;
      if (tier.untilMinutes != null && minutes >= tier.untilMinutes) continue;
    }
    return Number(tier.price);
  }
  return base;
}

// Combien de passages pour ce groupe sur une installation qui n'en prend
// qu'une partie a la fois (Fun Run : 5 joueurs). MIROIR de
// activitySessionCount de lib/activity-catalog : le serveur fait foi, le gate
// funrun-rotation-check compare les deux au centime.
function getActivitySessionCount(activity, pax) {
  const capacity = Math.trunc(Number(activity && activity.capacityPerUnit) || 0);
  const units = Math.trunc(Number(activity && activity.units) || 0);
  if (capacity <= 0) return 1;
  const places = capacity * (units > 0 ? units : 1);
  const sessions = Math.ceil(Math.max(1, Math.trunc(Number(pax) || 1)) / places);
  return Math.max(1, sessions);
}

// Les unites d une installation comptee pour un groupe : pistes de duckpin
// deduites des joueurs (6 par piste), avec des tours au-dela des 2 pistes ;
// tables de billard CHOISIES (une par defaut), dans la limite du centre.
// MIROIR de activityUnitPlan (lib/activity-catalog) : le serveur fait foi, le
// gate tours-dotation-check compare les deux pour chaque taille de groupe.
function getActivityUnitPlan(activity, pax, requested = 0) {
  const capacite = Math.trunc(Number(activity && activity.capacityPerUnit) || 0);
  const dotation = Math.trunc(Number(activity && activity.units) || 0);
  const joueurs = Math.max(1, Math.trunc(Number(pax) || 1));
  const necessaires = capacite > 0 ? Math.ceil(joueurs / capacite) : 1;
  const demandees = Math.trunc(Number(requested) || 0);
  const plafond = dotation > 0 ? Math.max(necessaires, dotation) : 50;
  const units = Math.max(1, necessaires, Math.min(demandees, plafond, 50));
  const atOnce = dotation > 0 ? Math.min(dotation, units) : units;
  const tours = Math.max(1, Math.ceil(units / atOnce));
  return { units, atOnce, tours, lastTour: units - (tours - 1) * atOnce, perUnit: capacite, needed: necessaires };
}

// Le palier d UNE session d une ligne de programme enregistree. MIROIR de
// minutesDUneSession de lib/visit-program : `minutes` y est le temps de tout
// le groupe (3 passages de 30 min = 90), le relire comme un palier faisait
// retomber la ligne sur 15 min a la premiere modification.
// `sessionsDuGroupe` : les passages de CE groupe (getActivitySessionCount),
// pour une ligne enregistree avant que la base ne garde ses passages.
function funRunSessionMinutes(item, sessionsDuGroupe = 1) {
  if (!item) return 0;
  const palier = Math.trunc(Number(item.sessionMinutes) || 0);
  if (palier > 0) return palier;
  const minutes = Math.trunc(Number(item.minutes) || 0);
  const passages = Math.trunc(Number(item.sessions) || 0);
  if (minutes > 0 && passages > 1) return Math.round(minutes / passages);
  const groupe = Math.trunc(Number(sessionsDuGroupe) || 1);
  const estUnPalier = (m) => FUN_RUN_OPTIONS.some((option) => Number(option.minutes) === m);
  if (minutes > 0 && groupe > 1 && !estUnPalier(minutes) && minutes % groupe === 0 && estUnPalier(minutes / groupe)) {
    return minutes / groupe;
  }
  return minutes;
}

function defaultArcadeOptions(activity) {
  const offers = activity && activity.arcadeOffers;
  if (!offers || offers.enabled === false) return {};
  const time = (offers.timeOffers || []).find(o => o.enabled !== false);
  const credit = (offers.creditOffers || []).find(o => o.enabled !== false);
  return time ? { arcadeMode: 'time', arcadeOfferId: time.id } : credit ? { arcadeMode: 'credit', arcadeOfferId: credit.id } : {};
}

function getArcadeOfferQuote(activity, options = {}, participants = 1) {
  const mode = options.arcadeMode || options.arcadeOffer?.mode;
  const id = options.arcadeOfferId || options.arcadeOffer?.id;
  if (!mode || !id) return null;
  const offers = activity && activity.arcadeOffers;
  const offer = options.arcadeOffer || (offers && offers.enabled !== false && ((mode === 'time' ? offers.timeOffers : mode === 'credit' ? offers.creditOffers : []) || []).find(o => o.id === id && o.enabled !== false));
  if (!offer || !Number.isFinite(Number(offer.price)) || Number(offer.price) < 0) return null;
  const cards = mode === 'time' ? Math.max(1, Math.trunc(Number(participants) || 1)) : Math.min(1000, Math.max(1, Math.trunc(Number(options.cards) || Number(participants) || 1)));
  const snapshot = { ...offer, mode, id, description: offer.description || (mode === 'time' ? offers?.timedDescription : offers?.creditDescription) || '', gameCostMin: offer.gameCostMin ?? offers?.creditGameCostMin, gameCostMax: offer.gameCostMax ?? offers?.creditGameCostMax };
  return { cards, price: Math.round(Number(offer.price) * cards * 100) / 100, offer: snapshot };
}

function getArcadeOfferDetail(item) {
  const offer = item && item.arcadeOffer;
  if (!offer) return '';
  const cards = Math.max(1, Math.trunc(Number(item.cards) || Number(item.participants) || 1));
  const number = n => Number(n).toLocaleString('fr-BE');
  const amount = offer.mode === 'time' ? `${number(offer.minutes)} min par carte · jeux sans cadeaux illimités · jeux à lots exclus` : `${number(offer.credits)} crédits + ${number(offer.bonusCredits || 0)} offerts = ${number(offer.totalCredits ?? (Number(offer.credits) + Number(offer.bonusCredits || 0)))} crédits par carte`;
  const games = offer.mode === 'credit' && Number(offer.gameCostMin) > 0 ? `jeux de ${number(offer.gameCostMin)} à ${number(offer.gameCostMax)} crédits · jeux à lots inclus` : '';
  return [`${cards} carte${cards > 1 ? 's' : ''}`, amount, games, offer.description].filter(Boolean).join(' · ');
}

function getFreeActivityPrice(activity, { pax = 1, units = 1, hours = 1, minutes = null, dateStr = '', startTime = '', arcadeMode, arcadeOfferId, cards, arcadeOffer } = {}) {
  if (!activity) return null;
  if (activity.id === 'arcade_time') return getArcadeOfferQuote(activity, { arcadeMode, arcadeOfferId, cards, arcadeOffer }, pax)?.price ?? null;
  // Grille de session : le montant vient de la grille, pas d'un tarif saisi.
  // Un groupe plus grand que l'installation TOURNE : autant de sessions, donc
  // autant de fois le prix de la grille.
  if (activity.priceType === 'grid_fun_run') {
    const option = FUN_RUN_OPTIONS.find((item) => item.minutes === Number(minutes)) || FUN_RUN_OPTIONS[0];
    return option.price * getActivitySessionCount(activity, pax);
  }
  const unitPrice = resolveActivityUnitPrice(activity.pricing || null, activity.priceValue, { dateStr, startTime });
  if (unitPrice == null) return null;
  const people = Math.max(1, Number(pax) || 1);
  if (activity.priceType === 'per_pax') return Math.round(unitPrice * people * 100) / 100;
  if (activity.priceType === 'per_unit_hour') {
    // Les tables choisies, bornees comme le serveur les borne.
    const tables = getActivityUnitPlan(activity, pax, units).units;
    return Math.round(unitPrice * tables * Math.max(0.5, Number(hours) || 1) * 100) / 100;
  }
  return null;
}

// Verdict serveur DU JOUR (cle center.day de /api/public-booking-meta?date=...).
// Le serveur est le seul a connaitre les blocages ponctuels poses depuis le
// cockpit (fermeture exceptionnelle, activite en panne, formule suspendue) :
// la grille hebdo locale ne les voit pas. Null = aucun verdict connu, on
// retombe strictement sur le rendu historique.
let centerDayStatus = null;
// Centre pour lequel le verdict a ete rendu. Un verdict est valable pour UN
// centre : le switcher staff ne recharge pas la config publique, sans cette cle
// la fermeture du centre A serait annoncee sur le centre B.
let centerDayStatusCenter = '';
// Date pour laquelle un verdict est EN COURS de chargement. Sert a ne jamais
// annoncer "Ouvert" pendant l'aller-retour reseau qui va peut-etre dire "Ferme".
let centerDayPendingDate = '';

function currentDayCenterKey() {
  try {
    return typeof getCurrentStaffCenterId === 'function' ? String(getCurrentStaffCenterId() || '') : '';
  } catch (error) { return ''; }
}

// centerKey = centre REELLEMENT interroge. L'appelant le connait ; s'en remettre
// au centre courant serait faux quand l'utilisateur a switche pendant le vol.
function setCenterDayStatus(day, centerKey) {
  centerDayStatus = day && typeof day === 'object' && typeof day.date === 'string' ? day : null;
  if (!centerDayStatus) { centerDayStatusCenter = ''; return; }
  centerDayStatusCenter = centerKey === undefined ? currentDayCenterKey() : String(centerKey || '');
}

function getCenterDayStatus() {
  return centerDayStatus;
}

function setCenterDayPending(dateStr) {
  centerDayPendingDate = String(dateStr || '');
}

// Ne relache que SA propre attente : deux changements de date rapides ne
// doivent pas laisser la seconde requete sans etat d'attente.
function clearCenterDayPending(dateStr) {
  if (centerDayPendingDate === String(dateStr || '')) centerDayPendingDate = '';
}

// Verdict applicable a CETTE date uniquement. La garde d'egalite de date est
// obligatoire : le meme module sert le tunnel client et le QuickBook staff, qui
// travaillent sur deux dates differentes.
function getCenterDayStatusFor(dateStr) {
  if (!centerDayStatus) return null;
  if (centerDayStatusCenter !== currentDayCenterKey()) return null; // centre change : verdict perime
  return centerDayStatus.date === String(dateStr || '') ? centerDayStatus : null;
}

function isCenterDayPending(dateStr) {
  const wanted = String(dateStr || '');
  return !!wanted && centerDayPendingDate === wanted && !getCenterDayStatusFor(wanted);
}

// Config bookable poussée par /api/public-booking-meta (center.booking) ou par
// la config staff (resources.bowling). Absente = constantes historiques.
function getBookingCatalogConfig() {
  const booking = centerScheduleConfig?.booking;
  return booking && typeof booking === 'object' ? booking : null;
}

function resolveBookingCapacityValue(key, fallback) {
  const raw = Number(getBookingCatalogConfig()?.[key] ?? centerScheduleConfig?.resources?.bowling?.[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getTotalLanes() {
  return resolveBookingCapacityValue('laneCount', TOTAL_LANES);
}

function getMaxPerLane() {
  return resolveBookingCapacityValue('normalCapacityPerLane', MAX_PER_LANE);
}

function getEmergencyMaxPerLane() {
  return resolveBookingCapacityValue('emergencyCapacityPerLane', EMERGENCY_MAX_PER_LANE);
}

function getBowlingPrices() {
  const prices = getBookingCatalogConfig()?.bowlingPrices;
  return prices && typeof prices === 'object' ? prices : BOWLING_PRICES;
}

// Le tarif bowling DU CENTRE : present, ce centre vend AUX PARTIES et par
// personne (N4 Bowling) ; absent, il vend a la grille par piste et par duree
// (Fun Galaxy). Miroir exact de lib/booking-config.resolveBowlingPricing.
function getBowlingPricing() {
  const pricing = getBookingCatalogConfig()?.bowlingPricing;
  if (!pricing || typeof pricing !== 'object') return null;
  if (pricing.mode !== 'per_game_per_person') return null;
  if (!Array.isArray(pricing.tiers) || !pricing.tiers.length) return null;
  return pricing;
}

// Les parties vendables un jour donne. null = grille historique ; [] = ce
// centre vend aux parties mais aucun tarif ne couvre ce jour. Miroir de
// lib/booking-config.getBowlingGameOptions : les deux doivent rendre la meme
// chose, sinon le prix affiche et le prix facture divergent.
function getBowlingGameOptions(dateStr, context) {
  const pricing = getBowlingPricing();
  if (!pricing) return null;
  if (!dateStr) return [];
  const day = parseLocalDate(dateStr).getDay();
  const tier = pricing.tiers.find(t => Array.isArray(t.days) && t.days.indexOf(day) !== -1);
  if (!tier) return [];
  // Miroir de lib/booking-config.bowlingGameMinutes : une partie dure ce que
  // mettent les joueurs a lancer chacun leur tour, et deux pistes jouent en
  // parallele. Les deux doivent rendre la meme duree, sinon le creneau reserve
  // et le creneau annonce different.
  const ctx = context || {};
  const perPlayer = Number(pricing.minutesPerPlayerPerGame) || 0;
  const players = Math.max(1, Math.trunc(Number(ctx.pax) || 1));
  const lanes = Math.max(1, Math.trunc(Number(ctx.laneCount) || 1));
  const playersPerLane = Math.ceil(players / lanes);
  return (tier.prices || []).map((price, index) => {
    const games = index + 1;
    const durationMinutes = perPlayer > 0
      ? Math.min(480, Math.max(30, Math.ceil((games * perPlayer * playersPerLane) / 30) * 30))
      : games * (Number(pricing.minutesPerGame) || 60);
    return {
      games,
      value: Math.round((durationMinutes / 60) * 100) / 100,
      label: games === 1 ? '1 partie' : games + ' parties',
      price: Number(price),
      durationMinutes,
    };
  });
}

// Une nuit qui deborde sur le lendemain s'ecrit 25:00 EN INTERNE : la soiree du
// samedi appartient au samedi, pour le staff comme pour le planning, meme
// quand elle finit dimanche matin. Le CLIENT, lui, lit une heure de montre.
// C'est un habillage d'affichage, jamais un changement de donnee.
function displayTime(value) {
  const parts = String(value == null ? '' : value).split(':');
  const hours = Number(parts[0]);
  if (!Number.isFinite(hours)) return String(value == null ? '' : value);
  const minutes = String(parts[1] == null ? '00' : parts[1]).padStart(2, '0');
  return String(hours % 24).padStart(2, '0') + ':' + minutes;
}

function getLaserOptionsCatalog() {
  const options = getBookingCatalogConfig()?.laserOptions;
  return Array.isArray(options) && options.length ? options : LASER_GAME_OPTIONS;
}

// Le formateur se construit une fois : en construire un a chaque appel coutait
// 31 ms par rendu du planning sur tablette (processeur ralenti 4x), l heure
// etant demandee pour chaque carte. Il rend exactement les memes parties.
var businessNowFormat = null; // var : peut etre appele avant cette ligne au chargement
function getBusinessNowParts(date = new Date()) {
  if (!businessNowFormat) businessNowFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = businessNowFormat.formatToParts(date);
  const read = type => Number(parts.find(part => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute')
  };
}

function timeToNum(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h + (m / 60); }
function numToTime(n) { const h = Math.floor(n); const m = Math.round((n - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function formatClockDisplay(value) {
  const totalMinutes = Math.round((Number(value) || 0) * 60);
  const dayMinutes = 24 * 60;
  const normalized = ((totalMinutes % dayMinutes) + dayMinutes) % dayMinutes;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function overlap(s1, d1, s2, d2) { return s1 < (s2 + d2) && s2 < (s1 + d1); }
function roundUpHalfHour(value) { return Math.ceil(value * 2) / 2; }
function todayStr() {
  const now = getBusinessNowParts();
  return `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
}
function isPastBusinessDate(dateStr) {
  return !!dateStr && dateStr < todayStr();
}
function currentTimeDecimal() {
  const now = getBusinessNowParts();
  return now.hour + (now.minute / 60);
}
// La PROCHAINE date reservable a partir d une preference. On garde la date
// voulue si elle est encore ouvrable, sinon on avance jour par jour jusqu au
// premier jour ouvert. Tout vient de getSchedule, c est a dire du planning
// EDITABLE du centre : aucune heure ni aucun jour code en dur ici, un centre
// qui change ses horaires change ce que cette fonction rend. Sert le reset du
// tunnel (jamais une date passee, jamais un jour ferme selectionne tout seul).
function firstBookableDate(preferred, holidayMode = false) {
  const today = todayStr();
  let d = (!preferred || preferred < today) ? today : preferred;
  for (let i = 0; i < 400; i += 1) {
    const schedule = getSchedule(d, holidayMode);
    // Un jour ouvert, sauf aujourd hui dont l heure de fermeture est deja passee.
    if (schedule && !(d === today && currentTimeDecimal() >= schedule.close)) return d;
    d = addDays(d, 1);
  }
  return d;
}
function filterPastSlotsForDate(slots, dateStr) {
  if (dateStr !== todayStr()) return slots;
  const minStart = roundUpHalfHour(currentTimeDecimal());
  return slots.filter(slot => timeToNum(slot.time) >= minStart);
}
function sumExtras(extras = []) { return extras.reduce((sum, item) => sum + (Number(item.price) || 0), 0); }
function isDateWithinRange(dateStr, start, end) { return !!dateStr && dateStr >= start && dateStr <= end; }
function addDaysToDate(date, delta) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + delta);
  return next;
}
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function getBelgianPublicHolidayMap(year) {
  if (!BELGIAN_PUBLIC_HOLIDAY_CACHE.has(year)) {
    const easterSunday = getEasterSunday(year);
    const entries = [
      ['01-01', 'Jour de l\'An'],
      [toLocalDateStr(addDaysToDate(easterSunday, 1)).slice(5), 'Lundi de Pâques'],
      ['05-01', 'Fête du Travail'],
      [toLocalDateStr(addDaysToDate(easterSunday, 39)).slice(5), 'Ascension'],
      [toLocalDateStr(addDaysToDate(easterSunday, 50)).slice(5), 'Lundi de Pentecôte'],
      ['07-21', 'Fête nationale'],
      ['08-15', 'Assomption'],
      ['11-01', 'Toussaint'],
      ['11-11', 'Armistice'],
      ['12-25', 'Noël']
    ];
    BELGIAN_PUBLIC_HOLIDAY_CACHE.set(year, new Map(entries.map(([monthDay, label]) => [`${year}-${monthDay}`, label])));
  }
  return BELGIAN_PUBLIC_HOLIDAY_CACHE.get(year);
}
function getBelgianPublicHoliday(dateStr) {
  if (!dateStr) return null;
  const year = parseLocalDate(dateStr).getFullYear();
  return getBelgianPublicHolidayMap(year).get(dateStr) || null;
}
function getWalloniaSchoolHoliday(dateStr) {
  return WALLONIA_SCHOOL_HOLIDAYS.find(range => isDateWithinRange(dateStr, range.start, range.end)) || null;
}
function getManualHolidayOverride(dateStr) {
  const settings = centerScheduleConfig?.holidaySettings;
  if (!settings || typeof settings !== 'object') return null;
  const overrides = Array.isArray(settings.overrides) ? settings.overrides : [];
  const found = overrides.find(item => item && item.date === dateStr && (item.mode === 'holiday' || item.mode === 'normal'));
  return found ? found.mode : null;
}
function getSpecialOpeningContext(dateStr, manualHolidayOverride = false) {
  const schoolHoliday = getWalloniaSchoolHoliday(dateStr);
  const publicHoliday = getBelgianPublicHoliday(dateStr);
  const autoDetected = Boolean(schoolHoliday || publicHoliday);
  const settings = centerScheduleConfig?.holidaySettings;
  const override = getManualHolidayOverride(dateStr);
  const autoApplyEnabled = !settings || settings.enabled !== false;
  const active = Boolean(
    manualHolidayOverride
    || override === 'holiday'
    || (override !== 'normal' && autoApplyEnabled && autoDetected)
  );
  let periodType = null;
  if (active) {
    if (publicHoliday) periodType = 'public';
    else if (schoolHoliday) periodType = schoolHoliday.kind === 'summer' ? 'school_summer' : 'school_short';
    else periodType = 'manual';
  }
  return {
    active,
    periodType,
    override,
    autoDetected,
    schoolHoliday,
    publicHoliday,
    label: publicHoliday || (schoolHoliday ? schoolHoliday.label : '') || (active ? 'Jour special' : '')
  };
}
function isHolidayScheduleDate(dateStr, manualHolidayOverride = false) {
  return getSpecialOpeningContext(dateStr, manualHolidayOverride).active;
}
function getFormulaBlockedPeriods() {
  const settings = centerScheduleConfig?.holidaySettings;
  const configured = settings && Array.isArray(settings.formulaBlockedPeriods) ? settings.formulaBlockedPeriods : null;
  if (!configured) return DEFAULT_FORMULA_BLOCKED_PERIODS;
  return configured.filter(value => HOLIDAY_PERIOD_TYPES.includes(value));
}
// Regle metier : formules "noHolidays" bloquees feries + petits conges + jours
// forces, mais accessibles pendant les grandes vacances d'ete (configurable).
function isFormulaBlockedDate(dateStr, manualHolidayOverride = false) {
  const context = getSpecialOpeningContext(dateStr, manualHolidayOverride);
  if (!context.active || !context.periodType) return false;
  return getFormulaBlockedPeriods().includes(context.periodType);
}
// Offre activee/desactivee par le staff (Etablissement > Offres & formules).
function isOfferEnabled(formuleId) {
  const availability = centerScheduleConfig?.offerAvailability;
  if (!availability || typeof availability !== 'object') return true;
  return availability[formuleId] !== false;
}
function getReservationLabel(res) {
  if (res.label) return res.label;
  if (res.type === 'laser') return 'Laser Game';
  return res.formuleId ? (FORMULES.find(x => x.id === res.formuleId)?.name || 'Formule') : 'Bowling Classique';
}
function reservationNeedsLanes(type, formuleId) {
  const formule = FORMULES.find(x => x.id === formuleId);
  // Une VISITE mobilise des pistes des qu'elle contient du bowling. Sans ce cas,
  // le tunnel n'allouait aucune piste pour une visite bowling + laser et postait
  // lanes: [] : le serveur rattrapait, mais le client n'aurait plus rien verifie
  // avant d'envoyer, et le recapitulatif aurait affiche zero piste.
  if (type === 'visite') {
    const chosen = (typeof state !== 'undefined' && state.booking && state.booking.activities) || {};
    return Boolean(chosen.bowling);
  }
  return type === 'bowling' || !!(formule && formule.hasBowling);
}
function getRequiredLaneCount(type, pax, formuleId) {
  if (!reservationNeedsLanes(type, formuleId)) return 0;
  const laneCount = getTotalLanes();
  const players = Number(pax) || 1;
  const normal = Math.ceil(players / getMaxPerLane());
  if (normal > laneCount && players <= laneCount * getEmergencyMaxPerLane()) return laneCount;
  return normal;
}
// Le secours ne s'active que lorsque le stock libre ne suffit pas au confort.
function getBowlingCapacityPlan(pax, availableLanes, durationMinutes = 60) {
  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const normalCapacityPerLane = getMaxPerLane();
  const emergencyCapacityPerLane = Math.max(normalCapacityPerLane, getEmergencyMaxPerLane());
  const normalLanesNeeded = Math.ceil(players / normalCapacityPerLane);
  const available = Math.max(0, Math.trunc(Number(availableLanes) || 0));
  const emergency = available < normalLanesNeeded && players <= available * emergencyCapacityPerLane;
  const requiredCount = emergency ? Math.ceil(players / emergencyCapacityPerLane) : normalLanesNeeded;
  const lanePlayers = Array.from({ length: requiredCount }, (_, index) => Math.floor(players / requiredCount) + (index >= requiredCount - players % requiredCount ? 1 : 0));
  const estimatedMinutes = Math.max(...lanePlayers) * 10;
  return { requiredCount, bowlingCapacity: { emergency, normalCapacityPerLane, emergencyCapacityPerLane, normalLanesNeeded, lanePlayers, estimatedMinutes, speedWarning: emergency && Number(durationMinutes) < estimatedMinutes } };
}
// Resolution d'une formule pour l'AFFICHAGE prix/nom : si l'app a charge le
// catalogue effectif du centre (window.__pinlaneDisplayFormules, aligne sur le
// serveur et le formulaire public via getEffectiveFormules), on lit CE prix la ;
// sinon fallback sur le catalogue statique. Garde la carte formule ET la ligne
// total du recap coherentes avec le prix reellement facture par le serveur.
// (Le montant facture reste recalcule cote serveur : ceci ne corrige QUE
// l'affichage client, jamais la source de verite.)
function resolveDisplayFormule(formuleId) {
  if (!formuleId) return null;
  // Le catalogue EFFECTIF du centre fait autorite quand l'application est la :
  // window.getEffectiveCatalogFormules (app-main) sait, lui, qu'un centre hors
  // socle ne doit JAMAIS retomber sur les formules du fichier, qui sont celles
  // de Fun Galaxy. Sans lui (usage isole de ce module), ancien chemin.
  if (typeof window !== 'undefined' && typeof window.getEffectiveCatalogFormules === 'function') {
    return window.getEffectiveCatalogFormules().find(x => x && x.id === formuleId) || null;
  }
  const display = (typeof window !== 'undefined' && Array.isArray(window.__pinlaneDisplayFormules))
    ? window.__pinlaneDisplayFormules
    : null;
  if (display) {
    const hit = display.find(x => x && x.id === formuleId);
    if (hit) return hit;
  }
  return FORMULES.find(x => x.id === formuleId) || null;
}
// LE GROUPE QUI NE TIENT PAS SUR LES PISTES JOUE EN PLUSIEURS SERVICES.
//
// Jumeau client de splitGroupIntoBowlingServices (lib/booking-config.js), sur
// la capacite REELLE du centre affiche : le parc de pistes, la capacite de
// confort et celle de secours viennent toutes trois de la configuration
// servie, jamais d une constante.
//
// UN SEUL element = le groupe tient en une fois, et rien ne change pour lui.
// Le seuil est celui du REFUS (pistes x secours), pas celui du confort : entre
// les deux, le centre sait deja recevoir le groupe d un coup.
function splitGroupIntoBowlingServices(pax) {
  const players = Math.max(1, Number(pax) || 1);
  const lanes = Math.max(1, Math.trunc(Number(getTotalLanes()) || 1));
  const confort = Math.max(1, lanes * Math.max(1, Math.trunc(Number(getMaxPerLane()) || 1)));
  const secours = Math.max(confort, lanes * Math.max(1, Math.trunc(Number(getEmergencyMaxPerLane()) || 1)));
  if (players <= secours) return [players];
  const services = Math.ceil(players / confort);
  const base = Math.floor(players / services);
  const extra = players % services;
  return Array.from({ length: services }, (_, index) => base + (index < extra ? 1 : 0));
}

// LE PRIX AU-DELA DE LA GRILLE : PALIER PUIS UNITE (Movsar, 2026-10-08).
// Jumeaux exacts de lib/prix-palier.js (scripts/prix-palier-check.js compare
// les deux de 1 a 12 parties et de 30 min a 6 h). Le comptoir vend 4 parties
// ou 2 h 30 : le plus grand palier de la grille, puis l unite pour le reste
// (laser : 25 EUR les 3 parties, puis 10 EUR la partie ; bowling : 78 EUR les
// 2 h, puis 39 EUR l heure et 20 EUR la demi-heure). Le tunnel ne propose que
// les options de la grille : pour lui, rien ne change.
function prixLaserAuPalier(options, parties) {
  const n = Math.trunc(Number(parties));
  const liste = (Array.isArray(options) ? options : [])
    .map((option) => ({ games: Math.trunc(Number(option && option.games)), price: Number(option && option.price) }))
    .filter((option) => option.games > 0 && Number.isFinite(option.price) && option.price >= 0)
    .sort((a, b) => a.games - b.games);
  if (!Number.isFinite(n) || n < 1 || !liste.length) return null;
  const exact = liste.find((option) => option.games === n);
  if (exact) return exact.price;
  const palier = liste.filter((option) => option.games < n).pop();
  const unite = liste.find((option) => option.games === 1);
  if (!palier || !unite) return null;
  return palier.price + (n - palier.games) * unite.price;
}

function prixBowlingAuPalier(prix, heures) {
  const duree = Number(heures);
  if (!Number.isFinite(duree) || duree <= 0 || Math.round(duree * 2) !== duree * 2) return null;
  const grille = Object.entries(prix && typeof prix === 'object' ? prix : {})
    .map(([cle, valeur]) => ({ heures: Number(cle), price: Number(valeur) }))
    .filter((pas) => pas.heures > 0 && Number.isFinite(pas.price) && pas.price >= 0)
    .sort((a, b) => a.heures - b.heures);
  if (!grille.length) return null;
  const exact = grille.find((pas) => pas.heures === duree);
  if (exact) return exact.price;
  const palier = grille.filter((pas) => pas.heures < duree).pop();
  const heure = grille.find((pas) => pas.heures === 1);
  const demi = grille.find((pas) => pas.heures === 0.5);
  if (!palier || !heure) return null;
  const reste = duree - palier.heures;
  const heuresPleines = Math.floor(reste);
  const avecDemi = reste - heuresPleines >= 0.5;
  if (avecDemi && !demi) return null;
  return palier.price + heuresPleines * heure.price + (avecDemi ? demi.price : 0);
}

// L option de N parties (1 a 12, la borne du comptoir), dans la forme de la
// grille : une partie vaut 0,5 h et 30 min, comme 1, 2 et 3 parties.
function optionLaserAuPalier(options, parties) {
  const n = Number(parties);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  const grille = Array.isArray(options) ? options : [];
  const exacte = grille.find((option) => Math.trunc(Number(option && option.games)) === n);
  if (exacte) return exacte;
  const prix = prixLaserAuPalier(grille, n);
  if (prix === null) return null;
  return { games: n, value: n / 2, label: `${n} parties`, price: prix, durationMinutes: n * 30 };
}

function getBasePrice(type, duration, laneCount, pax, formuleId, dateStr) {
  if (type === 'bowling') {
    const gameOptions = getBowlingGameOptions(dateStr, { pax, laneCount });
    if (gameOptions) {
      const chosen = gameOptions.find(o => Number(o.value) === Number(duration));
      return chosen ? chosen.price * pax : 0;
    }
    const grille = getBowlingPrices();
    return (grille[duration] || prixBowlingAuPalier(grille, duration) || 0) * laneCount;
  }
  if (type === 'laser') {
    // Number() : jamais `undefined`, qui ferait lire l etat du tunnel par le
    // parametre par defaut de getLaserOption.
    return getLaserOption(Number(duration)).price * pax;
  }
  const formule = resolveDisplayFormule(formuleId);
  if (!formule) return 0;
  return formule.type === 'per_lane' ? formule.price * laneCount : formule.price * pax;
}
function getBasePriceForReservation(res) {
  const laneCount = reservationNeedsLanes(res.type, res.formuleId) ? (res.lanes || []).length : 0;
  return getBasePrice(res.type, Number(res.duration), laneCount, Number(res.pax), res.formuleId, res.date);
}
function getPlanningWindow(dateStr) {
  const schedule = getSchedule(dateStr, state.isHolidayMode);
  if (!schedule) return { open: 10, close: 22, closed: true, label: 'Fermé' };
  return { open: schedule.open, close: schedule.close, closed: false, label: schedule.label };
}

function normalizeActivityText(text = '') {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function formatDurationLabel(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m} min`;
}

// Au-dela de la grille (4 parties = 2 h), l option composee au palier : avant,
// 4 parties retombaient sur la PREMIERE option, et le comptoir affichait « 1
// partie » a 10 EUR pour un groupe qui en jouait quatre.
function getLaserOption(duration = state.booking?.duration || 0.5) {
  const options = getLaserOptionsCatalog();
  return options.find(x => Number(x.value) === Number(duration))
    || optionLaserAuPalier(options, Number(duration) * 2)
    || options[0];
}

function getLaserGameCount(duration = state.booking?.duration || 0.5) {
  return getLaserOption(duration).games;
}

// LES POSTES DE L ARENE DU CENTRE AFFICHE. La constante ne decide plus : elle
// n est que le dernier recours quand le centre n a rien declare. Un centre
// a 20 postes voyait sinon ses groupes annonces sur la base de 30, et le
// tunnel contredisait le plan du moteur (mesure Gembloux, 2026-09-18).
function getLaserArenaCapacity() {
  const declare = Number(
    getBookingCatalogConfig()?.laserArenaCapacity
    ?? centerScheduleConfig?.resources?.laser?.weaponCount,
  );
  return Number.isFinite(declare) && declare > 0 ? Math.trunc(declare) : LASER_GAME_MAX_PLAYERS;
}

// LES LANCEMENTS QUI TOURNENT EN MEME TEMPS, meme source que les postes :
// Gembloux en declare six, et la console refusait le deuxieme groupe d un
// creneau (« un seul lancement à la fois ») au nom d une constante a 1,
// alors que le moteur l aurait accepte. La constante n est plus que le
// dernier recours d un centre qui n a rien declare.
function getLaserParallelLaunches() {
  const declare = Number(
    getBookingCatalogConfig()?.laserParallelLaunches
    ?? centerScheduleConfig?.resources?.laser?.parallelLaunches,
  );
  return Number.isFinite(declare) && declare > 0 ? Math.trunc(declare) : LASER_GAME_PARALLEL_LAUNCHES;
}

function getLaserWaveCount(pax) {
  return Math.max(1, Math.ceil((Number(pax) || 1) / getLaserArenaCapacity()));
}

function getBalancedLaserWaveSize(pax) {
  const players = Number(pax) || 1;
  return Math.ceil(players / getLaserWaveCount(players));
}

function getBalancedLaserWaveSizes(pax) {
  const players = Math.max(1, Number(pax) || 1);
  const waveCount = getLaserWaveCount(players);
  const base = Math.floor(players / waveCount);
  const extra = players % waveCount;
  return Array.from({ length: waveCount }, (_, index) => base + (index < extra ? 1 : 0));
}

// Un depart laser vit sur la grille :00/:30 (miroir du moteur serveur).
// L accueil de 5/10 min est un CONSEIL d arrivee : l ajouter au DEBUT du
// bloc arene creait des sessions a 12:05 que le planning (rangees de 30
// min) et le partage de session (cle exacte) ne savaient pas lire
// (2026-08-25, captures Movsar).
function snapLaserLaunchHour(hour) {
  return Math.ceil(Number(hour || 0) * 2) / 2;
}

function getLaserCandidateWindows(startTime, duration, pax) {
  const games = getLaserGameCount(duration);
  const players = Math.max(1, Number(pax) || 1);
  const waveSizes = getBalancedLaserWaveSizes(players);
  let cursor = snapLaserLaunchHour(timeToNum(startTime));
  let laserBriefed = false;
  const windows = [];

  for (let game = 0; game < games; game += 1) {
    for (let waveIndex = 0; waveIndex < waveSizes.length; waveIndex += 1) {
      const durationMinutes = LASER_GAME_ARENA_MINUTES;
      const blockDuration = durationMinutes / 60;
      const start = cursor;
      const end = start + blockDuration;
      windows.push({
        start,
        end,
        duration: blockDuration,
        players: waveSizes[waveIndex],
        groupPlayers: players,
        groupWaveIndex: waveIndex + 1,
        groupWaveCount: waveSizes.length,
        countIndex: game + 1,
        resourceType: 'laser_arena',
        label: 'Laser Game'
      });
      // Vague et partie suivantes au prochain DEPART de la grille (le
      // creux de 5 min entre 12:25 et 12:30 EST la transition).
      cursor = snapLaserLaunchHour(end);
      laserBriefed = true;
    }
  }

  return windows;
}

// LA VARIANTE QU UN DOSSIER A ACHETEE (lib/formula-choice, la Formule 4 :
// « 60 min d'arcades » a la place des deux parties de laser). Son plan la
// garde (opsPlan.formulaChoice) : ce qu elle remplace, ce qu elle pose, son
// programme. Sans elle, la formule telle quelle.
function getReservationFormulaChoice(reservation) {
  const choix = reservation && reservation.opsPlan && reservation.opsPlan.formulaChoice;
  return choix && typeof choix === 'object' && choix.id && Array.isArray(choix.replaces) && Array.isArray(choix.steps) ? choix : null;
}
// La carte de la formule, dans les mots de la variante achetee.
function applyReservationFormulaChoice(formule, reservation) {
  const choix = getReservationFormulaChoice(reservation);
  return formule && choix && Array.isArray(choix.desc) && choix.desc.length ? { ...formule, desc: choix.desc.slice() } : formule;
}
// Les etapes du miroir (FORMULA_ACTIVITY_STEPS), dans la variante achetee :
// les siennes a la place de la premiere qu elle remplace.
function applyReservationFormulaChoiceToSteps(steps, reservation) {
  const choix = getReservationFormulaChoice(reservation);
  const remplacees = new Set(choix ? choix.replaces.map(String) : []);
  if (!Array.isArray(steps) || !steps.some(step => remplacees.has(step.a))) return steps;
  const out = [];
  let posees = false;
  steps.forEach(step => {
    if (!remplacees.has(step.a)) { out.push(step); return; }
    if (posees) return;
    posees = true;
    choix.steps.forEach(etape => out.push({ a: String(etape.activityId), c: Math.max(1, Number(etape.count) || 1), ...(etape.label ? { label: String(etape.label) } : {}) }));
  });
  return out;
}

function getFormulaLaserFallbackWindows(reservation) {
  // Formule OU visite : les deux vendent des parties de laser sans etre de type
  // 'laser'. Une visite dont le plan n'a pas pu etre calcule doit quand meme
  // montrer sa session estimee, comme une formule.
  if (!(reservation?.type === 'formule' || reservation?.formuleId || getProgramLaserGameCount(reservation) > 0)) return [];
  const formule = reservation.formuleId ? applyReservationFormulaChoice(FORMULES.find(x => x.id === reservation.formuleId), reservation) : null;
  const laserItem = (reservation.program?.items || []).find(item => item?.activityId === 'laser_game');
  // Extra games remain pending: a missing plan must never fabricate their hour
  // or allocate the whole initial group to the smaller purchased subgroup.
  const games = laserItem?.extraLaser ? Number(laserItem.games) || 1
    : getProgramLaserGameCount(reservation) || getFormulaLaserGameCount(formule);
  if (!games) return [];
  const players = Math.max(1, Number(getReservationActivityPlayers(reservation, 'laser_game')) || 1);
  const preferredLaserTime = reservation.preference?.preferredLaserTime || reservation.opsPlan?.laserPassPlan?.scheduledPasses?.[0]?.startTime || '';
  const bowlingWindows = getBowlingWindowsFromReservation(reservation).sort((a, b) => Number(a.start) - Number(b.start));
  // Premiere partie estimee au prochain DEPART de la grille apres le
  // bowling (+5 min de marche), jamais a l heure fine : le planning range
  // ses rangees par demi-heure et une session a 13:45 y est illisible.
  const firstLaserStart = preferredLaserTime
    ? timeToNum(preferredLaserTime)
    : bowlingWindows.length
      ? snapLaserLaunchHour(Math.max(...bowlingWindows.map(window => Number(window.end || window.start))) + (5 / 60))
      : snapLaserLaunchHour(timeToNum(reservation.startTime));
  const scheduled = reservation.opsPlan?.laserPassPlan?.scheduledPasses;
  return getLaserCandidateWindows(numToTime(firstLaserStart), games * 0.5, players)
    .filter(window => !laserItem?.extraLaser || !Array.isArray(scheduled)
      || scheduled.some(pass => Number(pass.countIndex) === window.countIndex))
    .map(window => ({
    ...window,
    reservation,
    resourceType: 'laser_arena',
    activityId: 'laser_game',
    label: 'Laser Game',
    formulaFallback: true,
  }));
}

function getQuickBookStartForLaserSession(session, pax = 4) {
  const players = Math.max(1, Number(pax) || 1);
  const arrivalMinutes = players >= 12 ? 10 : 5;
  return numToTime(Math.max(0, Number(session?.start || 0) - (arrivalMinutes / 60)));
}

function openQuickBookForLaserSession(sessionStart, remainingPlaces = getLaserArenaCapacity()) {
  const postes = getLaserArenaCapacity();
  const safeRemaining = Math.max(1, Math.min(postes, Number(remainingPlaces || postes)));
  const pax = Math.min(4, safeRemaining);
  const startTime = getQuickBookStartForLaserSession({ start: Number(sessionStart) }, pax);
  openQuickBook({
    date: state.currentDate,
    startTime,
    type: 'laser',
    duration: 0.5,
    totalDuration: 0.5,
    pax,
    allowPastStart: true,
    pastStartDate: state.currentDate,
    pastStartTime: startTime,
    lockStartTime: true
  });
}

function getLaserSlotCapacityText(slot, pax = state.booking.pax) {
  const players = Number(slot?.groupPlayers || pax || 0);
  const waveCount = Number(slot?.waveCount || getLaserWaveCount(players));
  const remaining = Math.max(Number(slot?.freeCount || 0), 0);
  if (waveCount > 1) {
    return `${players} joueurs · ${waveCount} sessions`;
  }
  return `Vous prenez ${players} place${players > 1 ? 's' : ''}`;
}

function getLaserSlotAfterText(slot, pax = state.booking.pax) {
  const players = Number(slot?.groupPlayers || pax || 0);
  const waveCount = Number(slot?.waveCount || getLaserWaveCount(players));
  const remaining = Math.max(Number(slot?.freeCount || 0), 0);
  if (waveCount > 1) {
    return `il restera ${remaining} place${remaining > 1 ? 's' : ''} sur la vague la plus remplie`;
  }
  return `il restera ${remaining} place${remaining > 1 ? 's' : ''} après votre réservation`;
}

function getFormuleLaneDuration(formule) {
  if (!formule) return 0;
  return formule.hasBowling ? Number(formule.bowlingDur || 1) : 0.5;
}

function estimateFormulaDurationFromLines(formule) {
  if (!formule) return 0;
  if (formule.estimatedTotalDuration) return formule.estimatedTotalDuration;

  const descTexts = (formule.desc || []).map(line => normalizeActivityText(line));
  const hasAllActivitiesWindowPackage =
    descTexts.some(text => text.includes('toutes les activites illimitees')) &&
    descTexts.some(text => text.includes('12h a 17h'));
  if (hasAllActivitiesWindowPackage) return 5;

  let total = 0;
  let anchoredDuration = 0;
  let activitySegments = 0;
  let hasFixedWindowPackage = false;

  descTexts.forEach(text => {
    if (!text) return;

    if (text.includes('toutes les activites illimitees') && text.includes('12h a 17h')) {
      total += 5;
      hasFixedWindowPackage = true;
      activitySegments += 1;
      return;
    }
    if (text.includes('table privee pendant 2 heures')) {
      anchoredDuration = Math.max(anchoredDuration, 2);
      activitySegments += 1;
      return;
    }
    if (text.includes('bowling')) {
      const explicit = text.match(/(\d+(?:[.,]\d+)?)\s*h/);
      total += explicit ? Number(explicit[1].replace(',', '.')) : getFormuleLaneDuration(formule);
      activitySegments += 1;
      return;
    }
    if (text.includes('laser game')) {
      if (text.includes('illimite')) {
        total += 1.5;
        activitySegments += 1;
        return;
      }
      const partsMatch = text.match(/(\d+)\s*part/);
      const parts = partsMatch ? Number(partsMatch[1]) : 1;
      total += parts * 0.5;
      activitySegments += 1;
      return;
    }
    if (text.includes('minigolf') || text.includes('mini golf')) {
      const explicit = text.match(/(\d+(?:[.,]\d+)?)\s*h/);
      total += explicit ? Number(explicit[1].replace(',', '.')) : 0.75;
      activitySegments += 1;
      return;
    }
    if (text.includes('arcade')) {
      if (text.includes('illimite')) {
        total += 1.5;
        activitySegments += 1;
        return;
      }
      if (text.includes('30 minutes')) {
        total += 0.5;
        activitySegments += 1;
        return;
      }
      const explicit = text.match(/(\d+(?:[.,]\d+)?)\s*h/);
      total += explicit ? Number(explicit[1].replace(',', '.')) : 0.5;
      activitySegments += 1;
      return;
    }
    if (text.includes('plaine de jeu')) {
      total += 1;
      activitySegments += 1;
      return;
    }
  });

  if (anchoredDuration) total = Math.max(total, anchoredDuration);
  if (!hasFixedWindowPackage && activitySegments > 1) total += 0.5;
  return Math.max(roundUpHalfHour(total || getFormuleLaneDuration(formule)), getFormuleLaneDuration(formule));
}

function getFormuleTotalDuration(formule) {
  return formule ? estimateFormulaDurationFromLines(formule) : 0;
}

// JUMELLES EXACTES de lib/booking-config.js. Le navigateur grise une formule
// sans heure d arrivee possible avec LA MEME regle que la route qui compose
// les creneaux et que l agent qui repond aux clients. Le gate de derive
// (scripts/booking-constants-drift-check.js) les compare a celles du serveur,
// formule par formule, sur plusieurs grilles horaires.
function getFormuleBookedDuration(formule) {
  if (!formule) return 0;
  return formule.orderPolicy === 'open_window' ? 0.5 : getFormuleTotalDuration(formule);
}

function getFormuleArrivalWindow(formule, schedule) {
  if (!formule || !schedule) return null;
  const limit = formule.timeLimit || {};
  const periodStart = limit.min ? Math.max(schedule.open, limit.min) : schedule.open;
  const periodEnd = limit.max ? Math.min(schedule.close, limit.max) : schedule.close;
  return {
    periodStart,
    periodEnd,
    earliestStart: periodStart,
    latestStart: periodEnd - getFormuleBookedDuration(formule),
  };
}

function getBookingTotalDuration(booking) {
  if (booking.type === 'formule') {
    const formule = FORMULES.find(x => x.id === booking.formuleId);
    return getFormuleTotalDuration(formule);
  }
  return Number(booking.totalDuration || booking.duration || 0);
}

function legacyGetFormuleAvailability(formule, dateStr, pax, startTime = '') {
  const day = parseLocalDate(dateStr).getDay();
  if (!isOfferEnabled(formule.id)) return { ok: false, message: 'Offre momentanément indisponible' };
  if (pax < formule.minPax) return { ok: false, message: `Min. ${formule.minPax} personnes` };
  if (formule.noHolidays && isFormulaBlockedDate(dateStr, state.isHolidayMode)) return { ok: false, message: 'Indisponible vacances/fériés' };
  if (formule.validDays && !formule.validDays.includes(day)) return { ok: false, message: 'Indisponible ce jour' };
  if (startTime && formule.timeLimit) {
    const start = timeToNum(startTime);
    const dur = getFormuleTotalDuration(formule);
    if (formule.timeLimit.min && start < formule.timeLimit.min) return { ok: false, message: `À partir de ${formule.timeLimit.min}h` };
    if (formule.timeLimit.max && start + dur > formule.timeLimit.max) return { ok: false, message: `Jusqu'à ${formule.timeLimit.max}h` };
  }
  return { ok: true, message: 'Disponible' };
}
function validateSlotWindow(dateStr, startTime, duration, options = {}) {
  const allowPastStart = Boolean(options.allowPastStart || options.allowPastDate || options.allowPastToday);
  if (isPastBusinessDate(dateStr) && !allowPastStart) return { ok: false, message: 'Cette date est passée. La réservation n’est plus possible.' };
  const schedule = getSchedule(dateStr, state.isHolidayMode);
  if (!schedule) return { ok: false, message: 'Centre fermé à cette date.' };
  const start = timeToNum(startTime);
  const end = start + Number(duration);
  if (start < schedule.open || end > schedule.close) return { ok: false, message: `Créneau hors horaires (${schedule.label}).` };
  if (dateStr === todayStr() && start < roundUpHalfHour(currentTimeDecimal()) && !allowPastStart) return { ok: false, message: 'Ce créneau est déjà passé.' };
  return { ok: true };
}

function formatScheduleHour(value) {
  const raw = Number(value);
  // Minuit PILE se dit « Minuit ». Au-dela, la nuit deborde sur le lendemain
  // (25 h = 1 h du matin, 26 h = 2 h) : le client doit lire l'heure de sa
  // montre, pas un nombre d'heures depuis l'ouverture. Sans ce cas, un centre
  // ouvert jusqu'a 2 h annoncait « Minuit » et se privait de deux heures de
  // reservations.
  if (raw === 24) return 'Minuit';
  const wrapped = raw > 24 ? raw - 24 : raw;
  const h = Math.floor(wrapped);
  const m = Math.round((wrapped - h) * 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
function buildScheduleLabel(open, close) {
  return `${formatScheduleHour(open)} - ${formatScheduleHour(close)}`;
}
// Lit un jour dans un bloc configure ({'0'..'6': {open, close}|null}).
// undefined = jour non configure (fallback grille historique), null = ferme.
function scheduleFromConfigBlock(block, day) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined;
  const key = String(day);
  if (!(key in block)) return undefined;
  const slot = block[key];
  if (!slot || !slot.open || !slot.close) return null;
  const open = timeToNum(slot.open);
  const close = timeToNum(slot.close);
  if (!(close > open)) return null;
  return { open, close, label: buildScheduleLabel(open, close) };
}
function getSchedule(dateStr, manualHolidayOverride = false) {
  // 1. VERDICT SERVEUR pour cette date exacte. Il sait ce que la grille hebdo
  //    ignore : fermeture ponctuelle, coupure posee depuis le cockpit. Quand il
  //    dit ferme, aucune grille locale ne peut le contredire - c'est la regle
  //    qui interdit le faux "Ouvert" du parcours client.
  const verdict = getCenterDayStatusFor(dateStr);
  if (verdict) {
    if (verdict.open === false) return null;
    const open = Number(verdict.schedule && verdict.schedule.open);
    const close = Number(verdict.schedule && verdict.schedule.close);
    if (Number.isFinite(open) && Number.isFinite(close) && close > open) {
      return { open, close, label: verdict.schedule.label || buildScheduleLabel(open, close) };
    }
  }
  // 2. Config du centre poussee par le serveur (grille hebdo + regime vacances).
  // 3. Grille en dur : dernier recours fail-soft (hors ligne, centre sans config).
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  const holidayActive = isHolidayScheduleDate(dateStr, manualHolidayOverride);
  const blocks = centerScheduleConfig?.defaultSchedule;
  if (blocks && typeof blocks === 'object') {
    const holidaySlot = holidayActive ? scheduleFromConfigBlock(blocks.holiday, day) : undefined;
    const resolved = holidaySlot !== undefined ? holidaySlot : scheduleFromConfigBlock(blocks.regular, day);
    if (resolved !== undefined) return resolved;
  }
  if (holidayActive) {
    if (day === 5 || day === 6) return { open: 10, close: 24, label: '10h - Minuit' };
    return { open: 10, close: 22, label: '10h - 22h' };
  }
  switch (day) {
    case 1: return null;
    case 2: return { open: 14, close: 22, label: '14h - 22h' };
    case 3: return { open: 12, close: 22, label: '12h - 22h' };
    case 4: return { open: 14, close: 22, label: '14h - 22h' };
    case 5: return { open: 14, close: 24, label: '14h - Minuit' };
    case 6: return { open: 10, close: 24, label: '10h - Minuit' };
    case 0: return { open: 10, close: 22, label: '10h - 22h' };
    default: return null;
  }
}

function readBlockHour(block, key, fallback = 0) {
  const raw = Number(block?.[key]);
  if (Number.isFinite(raw)) return raw > 24 ? raw / 60 : raw;
  const timeKey = key === 'start' ? 'startTime' : 'endTime';
  if (block?.[timeKey]) return timeToNum(block[timeKey]);
  return fallback;
}

// Une DUREE de reservation, en heures, quelle que soit l'unite d'origine.
//
// `readBlockHour` normalise deja les minutes en heures pour les HORAIRES : la
// preuve que des valeurs en minutes circulent dans le systeme. Le chemin de
// repli des fenetres bowling, lui, prenait `reservation.duration` brut. Une
// donnee en minutes qui passait par la produisait des piste-heures 60 fois trop
// grandes, et donc un taux d'occupation a 813 % au lieu de 13 %.
//
// Le seuil est le meme que celui de `readBlockHour` (24) pour ne pas avoir deux
// regles concurrentes dans le meme fichier. Limite assumee : une duree comprise
// entre 13 et 24 minutes serait lue comme des heures. Aucun creneau de ce genre
// n'existe (le pas est de 30 min), et un seuil plus bas casserait les durees
// legitimes de 1 a 4 heures.
function readDurationHours(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 24 ? raw / 60 : raw;
}

function normalizeLaserArenaEnd(start, end) {
  const arenaEnd = start + (LASER_GAME_ARENA_MINUTES / 60);
  if (!Number.isFinite(Number(end)) || end <= start) return arenaEnd;
  return Math.min(end, arenaEnd);
}

function getResourceWindowsFromReservation(reservation, resourceType) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  // Une partie de laser au-dela de la 1re ne se dessine que si elle est
  // REELLEMENT posee : le plan la declare (scheduledPasses, quand le client a
  // choisi son heure) ou le staff l'a placee a la main. Les autres attendent
  // dans la file. Sans plan de pass, rien n'est masque : un vieux plan qui
  // chainait les parties bout a bout n'existe plus qu'avec ce plan.
  const passPlan = reservation.opsPlan?.laserPassPlan || null;
  const partiesPosees = new Set((passPlan?.scheduledPasses || []).map(pass => Number(pass.countIndex || 1)));
  const planned = blocks
    .filter(block => block.resourceType === resourceType)
    .filter(block => !(
      resourceType === 'laser_arena' &&
      reservation.type === 'laser' &&
      Number(block.countIndex || 1) > 1 &&
      !block.manualLaserPass &&
      passPlan &&
      !partiesPosees.has(Number(block.countIndex || 1))
    ))
    .map(block => {
      const start = readBlockHour(block, 'start');
      const rawEnd = readBlockHour(block, 'end', start + (Number(block.durationMinutes || LASER_GAME_ARENA_MINUTES) / 60));
      const end = resourceType === 'laser_arena' ? normalizeLaserArenaEnd(start, rawEnd) : rawEnd;
      return {
        ...block,
        reservation,
        start,
        end,
        duration: Math.max(0, end - start),
        lanes: (block.lanes?.length ? block.lanes : reservation.lanes || []).map(Number),
        players: Number(block.players || (resourceType === 'laser_arena'
          ? getReservationLaserPlayersForGame(reservation, block.countIndex)
          : getReservationActivityPlayers(reservation, 'bowling')) || 0),
        unitKey: resourceType === 'laser_arena' ? laserBlockUnitKey(block) : undefined,
      };
    })
    .filter(window => window.duration > 0);
  if (planned.length) return planned;
  // Gestion laser MANUELLE (une partie a été dé-placée vers « à placer ») : on ne
  // régénère JAMAIS de fenêtre par fallback : l'absence de bloc laser = partie non
  // placée (sinon la carte réapparaîtrait aussitôt sur le planning).
  if (resourceType === 'laser_arena' && reservation.opsPlan?.laserManual) return planned;
  if (resourceType === 'bowling_lane' && (reservation.lanes || []).length) {
    const heures = readDurationHours(reservation.duration);
    return [{
      reservation,
      resourceType,
      start: timeToNum(reservation.startTime),
      end: timeToNum(reservation.startTime) + heures,
      duration: heures,
      lanes: (reservation.lanes || []).map(Number),
      label: 'Bowling',
    }];
  }
  if (resourceType === 'laser_arena'
    && (reservation.type === 'formule' || reservation.formuleId || getProgramLaserGameCount(reservation) > 0)) {
    return getFormulaLaserFallbackWindows(reservation);
  }
  if (resourceType === 'laser_arena' && reservation.type === 'laser') {
    const laserGames = getLaserGameCountForReservation(reservation);
    return getLaserCandidateWindows(reservation.startTime, reservation.duration, getReservationActivityPlayers(reservation, 'laser_game'))
      .filter(window => laserGames <= 1 || Number(window.countIndex || 1) === 1)
      .map(window => ({
      ...window,
      reservation,
      resourceType,
      label: 'Laser Game',
    }));
  }
  return [];
}

function getBowlingWindowsFromReservation(reservation) {
  return getResourceWindowsFromReservation(reservation, 'bowling_lane');
}

function getLaserWindowsFromReservation(reservation) {
  return getResourceWindowsFromReservation(reservation, 'laser_arena');
}

function hourToMinuteInt(value) {
  return Math.round(Number(value || 0) * 60);
}

function minuteIntToTime(value) {
  return numToTime(Number(value || 0) / 60);
}

// ── Identité par VAGUE (unité laser plaçable indépendamment) ─────────────────
// Un gros groupe joue UN jeu laser en plusieurs vagues (pas assez d'armes pour
// tout le monde d'un coup). Chaque vague est une unité qu'on place où on veut :
// son identité stable = `${countIndex}.${waveIndex}` (jeu . vague). Le cas 2 jeux
// distincts (1 vague chacun) reste `1.1` / `2.1` → comportement inchangé.
function laserUnitKey(countIndex, waveIndex) {
  return `${Number(countIndex || 1)}.${Number(waveIndex || 1)}`;
}
function laserBlockUnitKey(block) {
  return laserUnitKey(block?.countIndex, block?.groupWaveIndex);
}
function parseLaserUnitKey(key) {
  const [ci, wi] = String(key).split('.').map(Number);
  return { countIndex: ci || 1, waveIndex: wi || 1 };
}

// Le nombre de parties de laser VENDUES dans une visite (plusieurs activités
// dans une seule réservation). Le programme est la source : une visite n'a pas
// d'id de formule, et son `type` dit bowling dès qu'elle contient du bowling.
// Rend 0 pour tout le reste → l'appelant garde son chemin d'avant, à
// l'identique.
// Déplacer une partie de laser ne touche JAMAIS aux pistes. On ne les remet à
// zéro que pour une réservation qui n'en occupe pas : une VISITE bowling +
// laser en occupe, et forcer `laneCount: 0` lui aurait fait perdre ses pistes
// au premier glisser-déposer d'une partie.
function laserPassLanePayload(reservation) {
  const lanes = (reservation.lanes || []).map(Number).filter(lane => Number.isFinite(lane) && lane > 0);
  return lanes.length
    ? { laneCount: lanes.length, requiresLanes: true }
    : { laneCount: 0, requiresLanes: false };
}

function getProgramLaserGameCount(reservation) {
  const program = reservation && reservation.program;
  const items = Array.isArray(program) ? program : Array.isArray(program?.items) ? program.items : [];
  const laser = items.find(item => item && item.activityId === 'laser_game');
  return laser ? Math.max(0, Math.trunc(Number(laser.games) || 0), Math.trunc(Number(laser.extraLaser?.games) || 0)) : 0;
}

function getReservationActivityPlayers(reservation, activityId) {
  const program = reservation && reservation.program;
  const items = Array.isArray(program) ? program : (program && Array.isArray(program.items) ? program.items : []);
  const item = items.find(line => line && line.activityId === activityId);
  const group = Math.max(1, Math.trunc(Number(reservation && reservation.pax) || Number(item && item.participants) || 1));
  return Math.min(group, Math.max(1, Math.trunc(Number(item && item.participants) || group)));
}

function getReservationLaserPlayersForGame(reservation, countIndex = 1) {
  const program = reservation?.program;
  const items = Array.isArray(program) ? program : program?.items || [];
  const laser = items.find(item => item?.activityId === 'laser_game');
  const base = getReservationActivityPlayers(reservation, 'laser_game');
  if (laser?.extraLaser && Number(countIndex) > Number(laser.games || 1)) {
    return Math.min(base, Math.max(1, Math.trunc(Number(laser.extraLaser.participants) || base)));
  }
  if (laser) return base;
  const plan = reservation?.opsPlan?.laserPassPlan;
  const explicit = [...(plan?.scheduledPasses || []), ...(plan?.pendingPasses || [])]
    .find(pass => Number(pass.countIndex) === Number(countIndex));
  return explicit?.pax ? Math.min(base, Math.max(1, Math.trunc(Number(explicit.pax) || base))) : base;
}

// Liste canonique de TOUTES les vagues d'une réservation (indépendante du placement) :
// pour chaque jeu (countIndex 1..N), les vagues issues du découpage capacité armes.
function getLaserUnitsForReservation(reservation) {
  const games = Math.max(1, getLaserGameCountForReservation(reservation));
  const units = [];
  for (let game = 1; game <= games; game += 1) {
    const waveSizes = getBalancedLaserWaveSizes(getReservationLaserPlayersForGame(reservation, game));
    waveSizes.forEach((players, waveIdx) => {
      units.push({
        countIndex: game,
        waveIndex: waveIdx + 1,
        waveCount: waveSizes.length,
        players,
        unitKey: laserUnitKey(game, waveIdx + 1),
      });
    });
  }
  return units;
}

// Clés des vagues ACTUELLEMENT placées (présentes en blocs opsPlan).
function getLaserScheduledUnitKeys(reservation) {
  return [...new Set(getLaserWindowsFromReservation(reservation).map(laserBlockUnitKey))];
}

// Infos d'une vague (par clé) : priorité au bloc placé (compte joueurs réel du
// serveur), sinon canonique. Accepte aussi un ancien index numérique de jeu.
function laserUnitInfo(reservation, unitRef) {
  const key = String(unitRef).includes('.') ? String(unitRef) : laserUnitKey(Number(unitRef) || 1, 1);
  const placed = getLaserWindowsFromReservation(reservation).find(window => laserBlockUnitKey(window) === key);
  if (placed) {
    return {
      countIndex: Number(placed.countIndex || 1),
      waveIndex: Number(placed.groupWaveIndex || 1),
      waveCount: Number(placed.groupWaveCount || 1),
      players: Math.max(1, Number(placed.players || getReservationLaserPlayersForGame(reservation, placed.countIndex) || 1)),
      unitKey: key,
    };
  }
  const canon = getLaserUnitsForReservation(reservation).find(unit => unit.unitKey === key);
  if (canon) return canon;
  const { countIndex, waveIndex } = parseLaserUnitKey(key);
  return { countIndex, waveIndex, waveCount: 1, players: Math.max(1, Number(getReservationLaserPlayersForGame(reservation, countIndex) || 1)), unitKey: key };
}

function getLaserPassScheduledIndexes(reservation) {
  return [...new Set(getLaserWindowsFromReservation(reservation).map(window => Number(window.countIndex || 1)))].sort((a, b) => a - b);
}

function getPendingLaserPasses(dateStr = state.currentDate) {
  return todaysReservations()
    .filter(reservation => reservation.date === dateStr)
    .flatMap(getPendingLaserPassesForReservation);
}

// LES PARTIES D'UN DOSSIER QUI ATTENDENT LEUR HEURE : la file « Parties à
// placer » du planning laser les montre toutes, la pastille d'un dossier les
// compte (audit QA du 2026-09-28 : « une réservation confirmée peut être
// incomplète dans le planning, l'équipe peut oublier de placer les parties
// restantes »). Une seule règle pour les deux.
function getPendingLaserPassesForReservation(reservation) {
  if (!(reservation
      && reservation.status !== 'cancelled'
      // Une VISITE compte ici comme une formule : ses parties de laser au-delà
      // de la première se placent à la main, exactement pareil. Sans elle dans
      // ce filtre, deux parties payées n'apparaissaient nulle part.
      && (reservation.type === 'laser' || reservation.type === 'formule' || reservation.formuleId
        || getProgramLaserGameCount(reservation) > 0)
      // Plusieurs unités laser (vagues et/ou parties à placer) OU laser en gestion
      // manuelle : une unité a été dé-placée vers « à placer », y compris une
      // session laser direct 1-partie.
      && (getLaserUnitsForReservation(reservation).length > 1 || reservation.opsPlan?.laserManual))) return [];
  const units = getLaserUnitsForReservation(reservation);
  const scheduled = new Set(getLaserScheduledUnitKeys(reservation));
  const totalGames = Math.max(1, getLaserGameCountForReservation(reservation));
  // La 1re unité (jeu 1 · vague 1) reste ancrée automatiquement pour une formule,
  // SAUF laser en gestion manuelle (elle a pu être dé-placée) → tout devient plaçable.
  // ET SAUF quand le plan DIT ce qui est posé (`laserPassPlan`) : depuis que
  // le client choisit l'heure de chaque partie, il peut parfaitement laisser
  // la 1re sur place et poser la 3e. Le plan fait foi, pas la convention.
  const anchorFirst = reservation.opsPlan?.laserPassPlan
    ? false
    : (!reservation.opsPlan?.laserManual && reservation.type !== 'laser');
  return units
    .filter((unit, index) => {
      if (anchorFirst && index === 0) return false;
      return !scheduled.has(unit.unitKey);
    })
    .map(unit => ({
      reservation,
      countIndex: unit.countIndex,
      waveIndex: unit.waveIndex,
      waveCount: unit.waveCount,
      unitKey: unit.unitKey,
      totalGames,
      players: Number(unit.players || getReservationActivityPlayers(reservation, 'laser_game') || 0),
    }));
}

// Construit le bloc d'UNE vague (unité) placée manuellement à `targetStart`.
// Chaque vague est indépendante : on ne re-découpe plus tout le groupe.
function buildManualLaserPassBlocks(reservation, unitRef, targetStart, targetEnd = null) {
  const unit = laserUnitInfo(reservation, unitRef);
  const start = hourToMinuteInt(targetStart);
  const fixedEnd = Number.isFinite(Number(targetEnd)) ? hourToMinuteInt(targetEnd) : null;
  const durationMinutes = fixedEnd ? Math.max(15, fixedEnd - start) : LASER_GAME_ARENA_MINUTES;
  const end = start + durationMinutes;
  return [{
    type: 'activity',
    activityId: 'laser_game',
    label: 'Laser Game',
    resourceType: 'laser_arena',
    countIndex: unit.countIndex,
    manualLaserPass: true,
    critical: true,
    start,
    end,
    startTime: minuteIntToTime(start),
    endTime: minuteIntToTime(end),
    durationMinutes,
    players: unit.players,
    groupPlayers: Number(getReservationLaserPlayersForGame(reservation, unit.countIndex) || unit.players),
    groupWaveIndex: unit.waveIndex,
    groupWaveCount: unit.waveCount,
    weaponNeed: Math.min(unit.players, getLaserArenaCapacity()),
  }];
}

function getSanitizedLaserResourceBlocks(reservation, replacingUnitRef = null) {
  const planned = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const base = planned.length
    ? planned
    : getLaserWindowsFromReservation(reservation).map(window => ({
      ...window,
      start: hourToMinuteInt(window.start),
      end: hourToMinuteInt(window.end),
      startTime: minuteIntToTime(hourToMinuteInt(window.start)),
      endTime: minuteIntToTime(hourToMinuteInt(window.end)),
      durationMinutes: Math.round(Number(window.duration || 0) * 60),
      activityId: 'laser_game',
      resourceType: 'laser_arena',
      critical: true,
    }));
  const replacingKey = replacingUnitRef == null
    ? null
    : (String(replacingUnitRef).includes('.') ? String(replacingUnitRef) : null);
  const replacingGame = replacingKey ? null : (replacingUnitRef == null ? null : Number(replacingUnitRef));
  return base.filter(block => {
    if (block.resourceType !== 'laser_arena') return true;
    const index = Number(block.countIndex || 1);
    // Retire UNIQUEMENT la vague déplacée (clé jeu.vague). Compat : un index de
    // jeu numérique retire toutes les vagues de ce jeu (ancien comportement).
    if (replacingKey && laserBlockUnitKey(block) === replacingKey) return false;
    if (replacingGame && index === replacingGame) return false;
    if (reservation.type === 'laser' && index > 1 && !block.manualLaserPass) return false;
    return true;
  });
}

function checkManualLaserPassPlacement(reservation, unitRef, targetStart, targetEnd = null) {
  const candidateBlocks = buildManualLaserPassBlocks(reservation, unitRef, targetStart, targetEnd);
  const movingKey = laserUnitInfo(reservation, unitRef).unitKey;
  const existingWindows = todaysReservations()
    .filter(item => item.status !== 'cancelled' && item.id !== reservation.id)
    .flatMap(getLaserWindowsFromReservation);
  // On exclut UNIQUEMENT la vague déplacée : les autres vagues/parties du même
  // groupe restent des obstacles (une seule arène, pas de chevauchement).
  const sameReservationWindows = getLaserWindowsFromReservation(reservation)
    .filter(window => laserBlockUnitKey(window) !== movingKey);
  const allWindows = [...existingWindows, ...sameReservationWindows];
  for (const candidate of candidateBlocks) {
    const candidateStart = Number(candidate.start) / 60;
    const candidateEnd = Number(candidate.end) / 60;
    const candidateDuration = Math.max(0, candidateEnd - candidateStart);
    const overlapping = allWindows.filter(window => overlap(candidateStart, candidateDuration, window.start, window.duration));
    if (overlapping.some(window => Number(window.reservation?.id) === Number(reservation.id))) {
      return { ok: false, message: 'Ce groupe a déjà une partie Laser Game sur ce créneau.' };
    }
    const key = `${hourToMinuteInt(candidateStart)}-${hourToMinuteInt(candidateEnd)}`;
    const sessionKeys = new Set(overlapping.map(window => `${hourToMinuteInt(window.start)}-${hourToMinuteInt(window.end)}`));
    const joinsExistingSession = sessionKeys.has(key);
    const launchCount = sessionKeys.size + (joinsExistingSession ? 0 : 1);
    const playersTotal = overlapping.reduce((sum, window) => sum + Number(window.players || window.reservation?.pax || 0), Number(candidate.players || 0));
    // Les limites du CENTRE (postes, lancements simultanes), pas les
    // constantes : a Gembloux (20 postes, 6 lancements) ce glisser refusait un
    // deuxieme lancement permis et acceptait 30 joueurs sur 20 armes.
    const lancementsMax = getLaserParallelLaunches();
    const postes = getLaserArenaCapacity();
    if (launchCount > lancementsMax) {
      return {
        ok: false,
        message: lancementsMax > 1
          ? `Ce lancement en ferait ${launchCount} en même temps : l’arène en accepte ${lancementsMax}.`
          : 'Ce lancement créerait deux sessions laser en parallèle.',
      };
    }
    if (playersTotal > postes) {
      return { ok: false, message: `Laser complet sur ce lancement (${playersTotal}/${postes}).` };
    }
  }
  return { ok: true, blocks: candidateBlocks };
}

let laserPassSaveSeq = 0;
const laserPassLatestSeqByReservation = {};

function updateLaserPassPlan(opsPlan, reservation) {
  const totalGames = getLaserGameCountForReservation(reservation);
  if (totalGames <= 1) return opsPlan;
  const scheduled = [...new Set((opsPlan.resourceBlocks || [])
    .filter(block => block.resourceType === 'laser_arena')
    .map(block => Number(block.countIndex || 1)))].sort((a, b) => a - b);
  const pendingPasses = [];
  // Depuis que le client place les parties qu'il veut (2026-08-20), la PREMIERE
  // peut tres bien etre celle qu'il laisse sur place : la boucle part de 1.
  for (let countIndex = 1; countIndex <= totalGames; countIndex += 1) {
    if (!scheduled.includes(countIndex)) pendingPasses.push({ countIndex, status: 'pending', pax: getReservationLaserPlayersForGame(reservation, countIndex) });
  }
  return {
    ...opsPlan,
    laserPassPlan: {
      mode: 'manual_after_first',
      totalGames,
      scheduledGames: scheduled.length,
      remainingGames: pendingPasses.length,
      scheduledPasses: scheduled.map(countIndex => ({
        countIndex,
        status: 'scheduled',
        pax: getReservationLaserPlayersForGame(reservation, countIndex),
        startTime: (opsPlan.resourceBlocks || []).find(block => block.resourceType === 'laser_arena' && Number(block.countIndex || 1) === countIndex)?.startTime || '',
      })),
      pendingPasses,
    },
  };
}

async function scheduleLaserPass(reservationId, unitRef, targetStart, targetEnd = null) {
  const sessionKey = () => JSON.stringify([state.view, state.staffAuthSession?.member?.id, state.staffAuthSession?.expiresAt, state.staffAuthSession?.token]);
  const contextCenter = getCurrentStaffCenterId(), contextDate = state.currentDate, contextSession = sessionKey();
  const currentContext = () => getCurrentStaffCenterId() === contextCenter && state.currentDate === contextDate && sessionKey() === contextSession;
  const reservation = state.reservations.find(item => Number(item.id) === Number(reservationId));
  if (!reservation) return;
  const unit = laserUnitInfo(reservation, unitRef);
  const placement = checkManualLaserPassPlacement(reservation, unit.unitKey, targetStart, targetEnd);
  if (!placement.ok) {
    if (typeof showPlanningMoveNotice === 'function') {
      showPlanningMoveNotice('Laser Game bloque', placement.message, 'warning');
    } else {
      toast(placement.message);
    }
    return;
  }
  const requestKey = Number(reservation.id);
  const requestSeq = ++laserPassSaveSeq;
  laserPassLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => laserPassLatestSeqByReservation[requestKey] === requestSeq;
  try {
    if (typeof envoyerDeplacementActivite !== 'function') throw new Error('Le déplacement ciblé est indisponible. Actualisez le planning.');
    const payload = await envoyerDeplacementActivite(reservation, { activityId: 'laser_game', unitKey: unit.unitKey, startTime: numToTime(Number(targetStart)) });
    if (!isLatestRequest() || !currentContext()) return true;
    const savedWindow = getLaserWindowsFromReservation(payload.reservation).find(window => laserBlockUnitKey(window) === unit.unitKey);
    if (!savedWindow || Math.abs(hourToMinuteInt(savedWindow.start) - hourToMinuteInt(Number(targetStart))) > 1) {
      throw new Error('La partie laser sauvegardée ne correspond pas au déplacement. Actualisez le planning.');
    }
    upsertReservationInState(payload.reservation);
    if (typeof markReservationMutation === 'function') markReservationMutation(requestKey, payload.reservation, ['opsPlan']);
    save();
    renderStaffData();
    const unitLabel = unit.waveCount > 1 ? `Vague ${unit.waveIndex}/${unit.waveCount}` : `Partie ${unit.countIndex}`;
    toast(`${unitLabel} placée à ${formatClockDisplay(targetStart)}`);
    return true;
  } catch (error) {
    if (!isLatestRequest() || !currentContext()) return false;
    if (error.reservation) upsertReservationInState(error.reservation);
    if (typeof clearReservationMutation === 'function') clearReservationMutation(requestKey);
    renderStaffData();
    if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Déplacement Laser annulé', error.message || 'Impossible de placer cette partie Laser Game.', 'warning');
    else toast(error.message || 'Impossible de placer cette partie Laser Game.');
    return false;
  } finally {
    if (isLatestRequest()) delete laserPassLatestSeqByReservation[requestKey];
  }
}

// Matérialise les vagues laser CONSERVÉES en blocs explicites (+ garde les blocs
// non-laser), en retirant la vague `unitRef`. Indispensable : sans bloc explicite,
// getResourceWindowsFromReservation régénère la vague par fallback (elle reviendrait).
function removeLaserPassFromPlan(reservation, unitRef) {
  const removeKey = laserUnitInfo(reservation, unitRef).unitKey;
  const keptLaserBlocks = getLaserWindowsFromReservation(reservation)
    .filter(window => laserBlockUnitKey(window) !== removeKey)
    .map(window => {
      const start = hourToMinuteInt(window.start);
      const end = hourToMinuteInt(window.end);
      return {
        type: 'activity',
        activityId: 'laser_game',
        label: 'Laser Game',
        resourceType: 'laser_arena',
        countIndex: Number(window.countIndex || 1),
        manualLaserPass: true,
        critical: true,
        start,
        end,
        startTime: minuteIntToTime(start),
        endTime: minuteIntToTime(end),
        durationMinutes: Math.max(15, end - start),
        players: Number(window.players || getReservationLaserPlayersForGame(reservation, window.countIndex) || 0),
        groupPlayers: Number(getReservationLaserPlayersForGame(reservation, window.countIndex) || window.players || 0),
        groupWaveIndex: Number(window.groupWaveIndex || 1),
        groupWaveCount: Number(window.groupWaveCount || 1),
      };
    });
  const nonLaserBlocks = (reservation.opsPlan?.resourceBlocks || [])
    .filter(block => block.resourceType !== 'laser_arena');
  return [...nonLaserBlocks, ...keptLaserBlocks].sort((left, right) => Number(left.start || 0) - Number(right.start || 0));
}

// Dé-planifie une vague laser : la carte quitte le planning et repart dans la file
// « Parties à placer ». Miroir de scheduleLaserPass.
async function unscheduleLaserPass(reservationId, unitRef) {
  const sessionKey = () => JSON.stringify([state.view, state.staffAuthSession?.member?.id, state.staffAuthSession?.expiresAt, state.staffAuthSession?.token]);
  const contextCenter = getCurrentStaffCenterId(), contextDate = state.currentDate, contextSession = sessionKey();
  const currentContext = () => getCurrentStaffCenterId() === contextCenter && state.currentDate === contextDate && sessionKey() === contextSession;
  const reservation = state.reservations.find(item => Number(item.id) === Number(reservationId));
  if (!reservation) return false;
  const unit = laserUnitInfo(reservation, unitRef);
  // Déjà dans « à placer » (aucune fenêtre planifiée) → rien à faire.
  const scheduledKeys = new Set(getLaserScheduledUnitKeys(reservation));
  if (!scheduledKeys.has(unit.unitKey)) return true;
  const requestKey = Number(reservation.id);
  const requestSeq = ++laserPassSaveSeq;
  laserPassLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => laserPassLatestSeqByReservation[requestKey] === requestSeq;
  try {
    if (typeof envoyerDeplacementActivite !== 'function') throw new Error('Le retrait ciblé est indisponible. Actualisez le planning.');
    const payload = await envoyerDeplacementActivite(reservation, { activityId: 'laser_game', unitKey: unit.unitKey, unplace: true });
    if (!isLatestRequest() || !currentContext()) return true;
    if (getLaserScheduledUnitKeys(payload.reservation).includes(unit.unitKey)) throw new Error('Le serveur n’a pas confirmé le retrait de cette partie. Actualisez le planning.');
    upsertReservationInState(payload.reservation);
    if (typeof markReservationMutation === 'function') markReservationMutation(requestKey, payload.reservation, ['opsPlan']);
    save();
    renderStaffData();
    toast('Partie retirée du planning : à replacer quand vous voulez.');
    return true;
  } catch (error) {
    if (!isLatestRequest() || !currentContext()) return false;
    if (error.reservation) upsertReservationInState(error.reservation);
    if (typeof clearReservationMutation === 'function') clearReservationMutation(requestKey);
    renderStaffData();
    if (typeof showPlanningMoveNotice === 'function') showPlanningMoveNotice('Retrait annulé', error.message || 'Impossible de retirer cette partie Laser Game.', 'warning');
    return false;
  } finally {
    if (isLatestRequest()) delete laserPassLatestSeqByReservation[requestKey];
  }
}

// ── Suivi des activités de formule ─────────────────────────────────────────────
// La checklist = les activités RÉELLEMENT INCLUSES dans LA formule réservée (source de
// vérité : la DÉFINITION de la formule, pas le plan opérationnel qui peut être partiel).
// Chaque activité = un item cochable, clé stable `${activityId}-${occurrence}`. Les
// heures viennent du plan (opsPlan.timeline) quand elles existent. État coché dans
// reservation.activityProgress (colonne DB, survit au replan).

// Libellés d'activités (miroir de ops-knowledge/activities.json, côté client).
const FORMULA_ACTIVITY_LABELS = {
  bowling: 'Bowling',
  laser_game: 'Laser Game',
  minigolf_blacklight: 'Minigolf Blacklight',
  golf_oclock: "Golf o'Clock",
  arcade_time: 'Arcades',
  arcade_credit: 'Arcade',
  playground: 'Plaine de jeux',
  party_table: 'Table anniversaire',
  service_drinks: 'Boissons',
  duckpin_bowling: 'Duckpin Bowling',
};

// Activités « à sessions » : chaque unité est une session distincte à suivre
// séparément (ex. « 2 parties Laser Game » → 2 cases). Les autres (boissons ×2,
// arcade…) restent UN item, la quantité est dans le libellé.
const SESSION_ACTIVITIES = new Set(['laser_game', 'bowling']);

// Étapes d'activités PAR FORMULE : miroir fidèle de ops-knowledge/formulas.json.
// À garder synchronisé si formulas.json change (c'est la source serveur).
const FORMULA_ACTIVITY_STEPS = {
  f1: [{ a: 'bowling', c: 1 }, { a: 'laser_game', c: 1 }, { a: 'arcade_time', c: 1 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f2: [{ a: 'minigolf_blacklight', c: 1 }, { a: 'laser_game', c: 2 }, { a: 'arcade_time', c: 1 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f3: [{ a: 'minigolf_blacklight', c: 1 }, { a: 'bowling', c: 1 }, { a: 'arcade_time', c: 1 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f4: [{ a: 'minigolf_blacklight', c: 1 }, { a: 'bowling', c: 1 }, { a: 'laser_game', c: 2 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f5: [{ a: 'laser_game', c: 2 }, { a: 'minigolf_blacklight', c: 1 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f6: [{ a: 'party_table', c: 1 }, { a: 'playground', c: 1 }, { a: 'arcade_credit', c: 1, label: "8 crédits d'arcade (8€) par enfant" }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f7: [{ a: 'party_table', c: 1 }, { a: 'playground', c: 1 }, { a: 'minigolf_blacklight', c: 1 }, { a: 'arcade_credit', c: 1, label: "8 crédits d'arcade (8€) par enfant" }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  f8: [{ a: 'party_table', c: 1 }, { a: 'playground', c: 1 }, { a: 'minigolf_blacklight', c: 1 }, { a: 'arcade_time', c: 1 }, { a: 'service_drinks', c: 2, label: '2 cruches boissons' }],
  bts: [{ a: 'bowling', c: 1 }, { a: 'arcade_time', c: 1 }],
  mm: [{ a: 'arcade_time', c: 1 }, { a: 'laser_game', c: 2 }],
  css: [{ a: 'bowling', c: 1 }, { a: 'service_drinks', c: 1, label: '1 mètre de bière' }],
  kfd: [{ a: 'playground', c: 1 }, { a: 'arcade_time', c: 1 }],
  hlg: [{ a: 'arcade_time', c: 1 }, { a: 'laser_game', c: 1 }, { a: 'service_drinks', c: 1, label: '1 boisson' }],
  ffm: [{ a: 'bowling', c: 1 }, { a: 'laser_game', c: 1 }, { a: 'arcade_time', c: 1 }, { a: 'service_drinks', c: 1, label: '1 boisson' }],
};

function getActivityLabel(activityId, stepLabel) {
  return stepLabel || FORMULA_ACTIVITY_LABELS[activityId] || String(activityId || 'Activité');
}

function getReservationFormulaId(reservation) {
  return String(reservation?.formuleId || reservation?.formulaId || '').trim();
}

function getFormulaActivitySteps(formuleId) {
  return FORMULA_ACTIVITY_STEPS[String(formuleId || '').trim()] || null;
}

// Famille/catégorie d'une formule (ex. « Formules anniversaires » / « Formules
// spéciales ») : pour regrouper la page Formules par catégorie.
function getFormulaFamilyLabel(formuleId) {
  const formule = FORMULES.find(item => item.id === String(formuleId || '').trim());
  return formule && formule.family ? formule.family : 'Autres formules';
}

function reservationHasFormulaActivities(reservation) {
  if (!reservation) return false;
  if (getFormulaActivitySteps(getReservationFormulaId(reservation))) return true;
  // Fallback : formule sans définition connue mais avec un plan détaillé.
  const isFormula = reservation.type === 'formule' || !!reservation.formuleId;
  const steps = Array.isArray(reservation.opsPlan?.timeline) ? reservation.opsPlan.timeline : [];
  return isFormula && steps.some(step => step && step.type === 'activity');
}

// Index des heures planifiées (opsPlan.timeline) par clé `${activityId}-${occurrence}`.
function buildFormulaTimelineTimeIndex(reservation) {
  const timeline = Array.isArray(reservation?.opsPlan?.timeline)
    ? reservation.opsPlan.timeline.filter(step => step && step.type === 'activity')
    : [];
  const seen = {};
  const index = {};
  timeline.forEach(step => {
    const aid = String(step.activityId || '');
    seen[aid] = (seen[aid] || 0) + 1;
    const occ = Number(step.countIndex || seen[aid]);
    index[`${aid}-${occ}`] = { startTime: step.startTime || '', endTime: step.endTime || '' };
  });
  return index;
}

function getFormulaActivityChecklist(reservation) {
  const progress = reservation?.activityProgress && typeof reservation.activityProgress === 'object' ? reservation.activityProgress : {};
  const timeByKey = buildFormulaTimelineTimeIndex(reservation);
  const steps = applyReservationFormulaChoiceToSteps(getFormulaActivitySteps(getReservationFormulaId(reservation)), reservation);
  const mkItem = (activityId, occurrence, label) => {
    const key = `${activityId}-${occurrence}`;
    const entry = progress[key];
    const t = timeByKey[key] || {};
    return {
      key,
      activityId,
      countIndex: occurrence,
      label,
      startTime: t.startTime || '',
      endTime: t.endTime || '',
      done: !!(entry && entry.done),
      doneAt: entry && entry.doneAt ? entry.doneAt : '',
      by: entry && entry.by ? entry.by : '',
    };
  };
  // Cas nominal : on connaît la formule → liste COMPLÈTE de SES activités.
  if (Array.isArray(steps)) {
    const items = [];
    steps.forEach(step => {
      const aid = String(step.a || 'activite');
      const count = Math.max(1, Number(step.c || 1));
      if (SESSION_ACTIVITIES.has(aid) && count > 1) {
        for (let i = 1; i <= count; i += 1) items.push(mkItem(aid, i, `${getActivityLabel(aid)} (${i}/${count})`));
      } else {
        items.push(mkItem(aid, 1, getActivityLabel(aid, step.label)));
      }
    });
    return items;
  }
  // Fallback (formuleId inconnu) : dérive du plan opérationnel.
  const seen = new Map();
  const items = [];
  (Array.isArray(reservation?.opsPlan?.timeline) ? reservation.opsPlan.timeline : [])
    .filter(step => step && step.type === 'activity')
    .forEach(step => {
      const activityId = String(step.activityId || 'activite');
      const occ = (seen.get(activityId) || 0) + 1;
      seen.set(activityId, occ);
      const countIndex = Number(step.countIndex || occ);
      items.push(mkItem(activityId, countIndex, getActivityLabel(activityId, step.label)));
    });
  return items;
}

function getFormulaActivityProgressSummary(reservation) {
  const items = getFormulaActivityChecklist(reservation);
  const done = items.filter(item => item.done).length;
  return { items, done, total: items.length, allDone: items.length > 0 && done === items.length };
}

(function exposeBookingCore(global) {
  if (!global) return;
  global.PinlaneBookingCore = {
    TOTAL_LANES,
    MAX_PER_LANE,
    EMERGENCY_MAX_PER_LANE,
    PAIRS,
    BOWLING_PRICES,
    LASER_GAME_MAX_PLAYERS,
    LASER_GAME_PARALLEL_LAUNCHES,
    LASER_GAME_ARENA_MINUTES,
    LASER_GAME_OPTIONS,
    FORMULES,
    UPSELL_CATALOG,
    DURATION_OPTIONS,
    ADMIN_CENTER_FALLBACKS,
    parseLocalDate,
    toLocalDateStr,
    addDays,
    getBusinessNowParts,
    timeToNum,
    numToTime,
    formatClockDisplay,
    overlap,
    roundUpHalfHour,
    todayStr,
    isPastBusinessDate,
    currentTimeDecimal,
    firstBookableDate,
    filterPastSlotsForDate,
    sumExtras,
    isDateWithinRange,
    getBelgianPublicHoliday,
    getWalloniaSchoolHoliday,
    getSpecialOpeningContext,
    isHolidayScheduleDate,
    isFormulaBlockedDate,
    isOfferEnabled,
    setCenterScheduleConfig,
    setCenterActivities,
    getCenterActivities,
    getBowlingPricing,
    getBowlingGameOptions,
    displayTime,
    buildScheduleLabel,
    getCenterActivity,
    getFreeActivityPrice,
    resolveActivityUnitPrice,
    getCenterScheduleConfig,
    setCenterDayStatus,
    getCenterDayStatus,
    getCenterDayStatusFor,
    setCenterDayPending,
    clearCenterDayPending,
    isCenterDayPending,
    getTotalLanes,
    getMaxPerLane,
    getEmergencyMaxPerLane,
    getBowlingPrices,
    getLaserOptionsCatalog,
    getReservationLabel,
    reservationNeedsLanes,
    getRequiredLaneCount,
    getBasePrice,
    getBasePriceForReservation,
    prixLaserAuPalier,
    prixBowlingAuPalier,
    optionLaserAuPalier,
    normalizeActivityText,
    formatDurationLabel,
    getLaserOption,
    getLaserGameCount,
    getLaserWaveCount,
    getBalancedLaserWaveSize,
    getBalancedLaserWaveSizes,
    getLaserCandidateWindows,
    getFormulaLaserFallbackWindows,
    getReservationFormulaChoice,
    applyReservationFormulaChoice,
    applyReservationFormulaChoiceToSteps,
    getQuickBookStartForLaserSession,
    getLaserSlotCapacityText,
    getLaserSlotAfterText,
    getFormuleLaneDuration,
    estimateFormulaDurationFromLines,
    getFormuleTotalDuration,
    getFormuleBookedDuration,
    getFormuleArrivalWindow,
    getBookingTotalDuration,
    legacyGetFormuleAvailability,
    validateSlotWindow,
    getSchedule,
    readBlockHour,
    normalizeLaserArenaEnd,
    getResourceWindowsFromReservation,
    getBowlingWindowsFromReservation,
    getLaserWindowsFromReservation,
    hourToMinuteInt,
    minuteIntToTime,
    getLaserPassScheduledIndexes,
    laserUnitKey,
    laserBlockUnitKey,
    parseLaserUnitKey,
    getLaserUnitsForReservation,
    getLaserScheduledUnitKeys,
    laserUnitInfo,
    getPendingLaserPasses,
    getPendingLaserPassesForReservation,
    buildManualLaserPassBlocks,
    getSanitizedLaserResourceBlocks,
    checkManualLaserPassPlacement,
    updateLaserPassPlan,
    scheduleLaserPass,
    removeLaserPassFromPlan,
    unscheduleLaserPass,
    reservationHasFormulaActivities,
    getFormulaActivityChecklist,
    getFormulaActivityProgressSummary,
    getFormulaActivitySteps,
    getFormulaFamilyLabel,
    getActivityLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
