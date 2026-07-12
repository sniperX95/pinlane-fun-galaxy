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
  { id:'f1', name:'FORMULE 1', family:'Formules anniversaires', desc:["1h de Bowling","1 partie Laser Game","30 min arcades","2 cruches boissons"], price:26, oldPrice:34, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f2', name:'FORMULE 2', family:'Formules anniversaires', desc:["1 partie Minigolf","2 parties Laser Game","30 min arcades","2 cruches boissons"], price:30, oldPrice:45, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, best:true, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f3', name:'FORMULE 3', family:'Formules anniversaires', desc:["1 partie Minigolf","1h de Bowling","30 min d'Arcades","2 cruches boissons"], price:28, oldPrice:34, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f4', name:'FORMULE 4', family:'Formules anniversaires', desc:["1 partie de Minigolf","1h de Bowling","2 parties Laser Game","2 cruches boissons"], price:39, oldPrice:48, type:'per_pax', minPax:6, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f5', name:'FORMULE 5', family:'Formules anniversaires', desc:["2 parties de Laser Game","1 partie de Minigolf","2 cruches boissons"], price:26, oldPrice:32, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f6', name:'FORMULE 6', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","8€ d'arcade par enfant","2 cruches boissons"], price:18, oldPrice:20, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f7', name:'FORMULE 7', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","1 entrée Mini Golf Blacklight","8€ d'arcade par enfant","2 cruches boissons"], price:24, oldPrice:30, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'f8', name:'FORMULE 8', family:'Formules anniversaires', desc:["1 table privée pendant 2 heures","1 entrée à la plaine de jeu","1 entrée Mini Golf Blacklight","30 minutes d'arcade à volonté par enfant","2 cruches boissons"], price:28, oldPrice:37, type:'per_pax', minPax:6, noHolidays:true, hasBowling:false, notes:["Minimum 6 personnes","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'bts', name:'BACK TO SCHOOL/WORK', family:'Formules spéciales', desc:["1h de Bowling","1h d'Arcades"], price:20, oldPrice:50, type:'per_pax', minPax:4, validDays:[0,2,3,4], timeLimit:{min:18,max:22}, noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Mardi, mercredi, jeudi et dimanche","De 18h à 22h","4 personnes minimum","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'mm', name:'MATIN MALIN', family:'Formules spéciales', desc:["Arcades illimitées","Laser Game illimité"], price:25, oldPrice:90, type:'per_pax', minPax:1, timeLimit:{max:12}, estimatedTotalDuration:2, noHolidays:true, hasBowling:false, notes:["Disponible uniquement avant 12h","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'css', name:'CRAZY STUDENT STRIKE', family:'Formules spéciales', desc:["1h de Bowling","1 mètre de bière"], price:55, type:'per_lane', minPax:1, validDays:[2], noHolidays:false, hasBowling:true, bowlingDur:1, notes:["Disponible uniquement le mardi"] },
  { id:'kfd', name:'KIDS FUN DAY', family:'Formules spéciales', desc:["Toutes les activités illimitées","De 12h à 17h pour les enfants de 5 à 12 ans"], price:30, type:'per_pax', minPax:1, validDays:[3], timeLimit:{min:12,max:17}, noHolidays:true, hasBowling:false, notes:["Disponible uniquement le mercredi","Non valable durant les vacances scolaires et jours fériés"] },
  { id:'hlg', name:'HAPPY LASER AND GAME', family:'Formules spéciales', desc:["30 minutes d'arcade","1 partie de Laser Game","1 boisson"], price:20, type:'per_pax', minPax:1, validDays:[4], noHolidays:true, hasBowling:false, notes:["Disponible uniquement le jeudi"] },
  { id:'ffm', name:'FUN FRIDAY MADNESS', family:'Formules spéciales', desc:["1 heure de Bowling","1 partie de Laser Game","30 minutes d'arcade","1 boisson"], price:30, type:'per_pax', minPax:1, validDays:[5], noHolidays:true, hasBowling:true, bowlingDur:1, notes:["Disponible uniquement le vendredi"] },
];
const UPSELL_CATALOG = [
  { id:'u1', name:'Cruche Bière', price:18 },
  { id:'u2', name:'Cruche Soda', price:12 },
  { id:'u3', name:'Pack Jetons', price:10 },
  { id:'u4', name:'Tapas', price:15 },
];
const DURATION_OPTIONS = [
  { value:0.5, label:'30 min', price:20 },
  { value:1, label:'1 heure', price:39 },
  { value:1.5, label:'1h30', price:59 },
  { value:2, label:'2 heures', price:78 },
];
const FUN_GALAXY_LOGO_URL = 'https://fungalaxy.be/wp-content/themes/fungalaxy/img/logo-fun-galaxy.svg';
const ADMIN_CENTER_FALLBACKS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30, parallelLaunches: 1, requiresCompleteGroupBeforeLaunch: true } } },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30, parallelLaunches: 3, requiresCompleteGroupBeforeLaunch: false } } },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', resources: { bowling: null, laser: null } }
];
const STAFF_CAMPAIGN_CHANNELS = ['linkedin', 'facebook', 'instagram', 'tiktok', 'email'];
const STAFF_CAMPAIGN_CENTERS = {
  libramont: {
    id: 'libramont',
    name: 'Fun Galaxy Libramont',
    city: 'Libramont',
    positioning: 'sorties familles, anniversaires, groupes et loisirs indoor en province de Luxembourg',
    approvedActivities: ['Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', 'Arcades', 'Plaine de jeux', 'Formules anniversaires'],
    practicalFacts: [
      'Bowling: 8 pistes, 6 joueurs conseillés par piste.',
      'Laser Game: 30 armes, lancement plus sensible aux groupes incomplets.',
      'Mini Golf Blacklight et arcades: activités utiles pour compléter une sortie sans bloquer le planning.',
      'Anniversaires: formules avec activités, arcades et boissons selon la formule choisie.'
    ],
    forbiddenClaims: ['Golf oClock', 'plusieurs lancements Laser Game en parallèle', 'cinéma', 'karting', 'réalité virtuelle', 'escape game'],
    localAngle: 'centre indoor pratique pour les familles, écoles, clubs et entreprises autour de Libramont',
    laserAdvice: 'prévenir que les sessions Laser Game peuvent être partagées selon l’affluence'
  },
  gembloux: {
    id: 'gembloux',
    name: 'Fun Galaxy Gembloux',
    city: 'Gembloux',
    positioning: 'sorties familles, anniversaires, groupes, loisirs indoor et activités afterwork',
    approvedActivities: ['Bowling 8 pistes', 'Laser Game 30 armes', 'Mini Golf Blacklight', "Golf o'Clock", 'Arcades', 'Plaine de jeux', 'Formules anniversaires'],
    practicalFacts: [
      'Bowling: 8 pistes, 6 joueurs conseillés par piste.',
      'Laser Game: 30 armes, organisation plus souple grâce aux lancements multiples.',
      'Golf oClock est disponible à Gembloux.',
      'Anniversaires: formules avec activités, arcades et boissons selon la formule choisie.'
    ],
    forbiddenClaims: ["Golf o'Clock à Libramont", 'cinéma', 'karting', 'réalité virtuelle', 'escape game'],
    localAngle: 'centre indoor complet pour familles, groupes, entreprises et sorties entre amis autour de Gembloux',
    laserAdvice: 'valoriser la souplesse Laser Game sans promettre une session privée'
  }
};
const STAFF_SOCIAL_AGENTS = {
  linkedin: {
    label: 'LinkedIn',
    icon: 'linkedin',
    name: 'Agent LinkedIn B2B',
    mission: 'Transformer les signaux du centre en post crédible pour entreprises, écoles, clubs et responsables RH.',
    structure: ['accroche métier', 'problème terrain', 'preuve locale', 'invitation à organiser une sortie'],
    tone: 'professionnel, concret, peu publicitaire',
    avoid: 'hashtags en masse, promesses inventées, ton trop vendeur'
  },
  facebook: {
    label: 'Facebook',
    icon: 'facebook',
    name: 'Agent Facebook local',
    mission: 'Parler aux familles et groupes locaux avec un message simple, utile et partageable.',
    structure: ['situation concrète', 'activités disponibles', 'rassurance pratique', 'appel à réserver ou demander une dispo'],
    tone: 'chaleureux, local, direct',
    avoid: 'texte trop long, jargon marketing, fausse urgence'
  },
  instagram: {
    label: 'Instagram',
    icon: 'instagram',
    name: 'Agent Instagram visuel',
    mission: 'Préparer une légende courte et un brief Reels/carrousel basé sur les vraies activités du centre.',
    structure: ['hook court', 'moment visuel à montrer', 'bénéfice client', 'CTA léger'],
    tone: 'visuel, vivant, sobre',
    avoid: 'liste froide, hashtags génériques, activités non présentes'
  },
  tiktok: {
    label: 'TikTok',
    icon: 'tiktok',
    name: 'Agent TikTok créatif',
    mission: 'Découper l’idée en mini-script vertical avec hook immédiat et scènes filmables dans le centre.',
    structure: ['hook 2 secondes', '3 plans terrain', 'preuve simple', 'CTA court'],
    tone: 'rapide, naturel, filmable par le staff',
    avoid: 'script trop corporate, promesse impossible, trends hors sujet'
  },
  email: {
    label: 'Email',
    icon: 'mail',
    name: 'Agent Email humain',
    mission: 'Rédiger un message court qui ressemble à une vraie prise de contact du centre.',
    structure: ['objet clair', 'message humain', 'information utile', 'réponse facile'],
    tone: 'humain, précis, sans design lourd',
    avoid: 'newsletter trop chargée, fausse personnalisation, promotion vague'
  }
};

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
  { start: '2025-10-20', end: '2025-11-02', label: 'Conge d\'automne', kind: 'short' },
  { start: '2025-12-22', end: '2026-01-04', label: 'Vacances d\'hiver', kind: 'short' },
  { start: '2026-02-16', end: '2026-03-01', label: 'Conge de detente', kind: 'short' },
  { start: '2026-04-27', end: '2026-05-10', label: 'Vacances de printemps', kind: 'short' },
  { start: '2026-07-04', end: '2026-08-23', label: 'Vacances d\'ete', kind: 'summer' },
  { start: '2026-10-19', end: '2026-11-01', label: 'Conge d\'automne', kind: 'short' },
  { start: '2026-12-21', end: '2027-01-03', label: 'Vacances d\'hiver', kind: 'short' },
  { start: '2027-02-22', end: '2027-03-07', label: 'Conge de detente', kind: 'short' },
  { start: '2027-04-26', end: '2027-05-09', label: 'Vacances de printemps', kind: 'short' },
  { start: '2027-07-03', end: '2027-08-22', label: 'Vacances d\'ete', kind: 'summer' }
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

function getLaserOptionsCatalog() {
  const options = getBookingCatalogConfig()?.laserOptions;
  return Array.isArray(options) && options.length ? options : LASER_GAME_OPTIONS;
}

function getBusinessNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
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
      [toLocalDateStr(addDaysToDate(easterSunday, 1)).slice(5), 'Lundi de Paques'],
      ['05-01', 'Fete du Travail'],
      [toLocalDateStr(addDaysToDate(easterSunday, 39)).slice(5), 'Ascension'],
      [toLocalDateStr(addDaysToDate(easterSunday, 50)).slice(5), 'Lundi de Pentecote'],
      ['07-21', 'Fete nationale'],
      ['08-15', 'Assomption'],
      ['11-01', 'Toussaint'],
      ['11-11', 'Armistice'],
      ['12-25', 'Noel']
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
function getBasePrice(type, duration, laneCount, pax, formuleId) {
  if (type === 'bowling') return (getBowlingPrices()[duration] || 0) * laneCount;
  if (type === 'laser') {
    const options = getLaserOptionsCatalog();
    const option = options.find(x => Number(x.value) === Number(duration)) || options[0];
    return option.price * pax;
  }
  const formule = FORMULES.find(x => x.id === formuleId);
  if (!formule) return 0;
  return formule.type === 'per_lane' ? formule.price * laneCount : formule.price * pax;
}
function getBasePriceForReservation(res) {
  const laneCount = reservationNeedsLanes(res.type, res.formuleId) ? (res.lanes || []).length : 0;
  return getBasePrice(res.type, Number(res.duration), laneCount, Number(res.pax), res.formuleId);
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

function getLaserOption(duration = state.booking?.duration || 0.5) {
  const options = getLaserOptionsCatalog();
  return options.find(x => Number(x.value) === Number(duration)) || options[0];
}

function getLaserGameCount(duration = state.booking?.duration || 0.5) {
  return getLaserOption(duration).games;
}

function getLaserWaveCount(pax) {
  return Math.max(1, Math.ceil((Number(pax) || 1) / LASER_GAME_MAX_PLAYERS));
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

function getLaserCandidateWindows(startTime, duration, pax) {
  const games = getLaserGameCount(duration);
  const players = Math.max(1, Number(pax) || 1);
  const waveSizes = getBalancedLaserWaveSizes(players);
  let cursor = timeToNum(startTime) + ((players >= 12 ? 10 : 5) / 60);
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
      cursor = end;
      laserBriefed = true;
    }
    if (game < games - 1) cursor += 5 / 60;
  }

  return windows;
}

function getFormulaLaserFallbackWindows(reservation) {
  if (!(reservation?.type === 'formule' || reservation?.formuleId)) return [];
  const formule = reservation.formuleId ? FORMULES.find(x => x.id === reservation.formuleId) : null;
  const games = getFormulaLaserGameCount(formule);
  if (!games) return [];
  const players = Math.max(1, Number(reservation.pax) || 1);
  const arrivalBuffer = (players >= 12 ? 10 : 5) / 60;
  const preferredLaserTime = reservation.preference?.preferredLaserTime || reservation.opsPlan?.laserPassPlan?.scheduledPasses?.[0]?.startTime || '';
  const bowlingWindows = getBowlingWindowsFromReservation(reservation).sort((a, b) => Number(a.start) - Number(b.start));
  const firstLaserStart = preferredLaserTime
    ? timeToNum(preferredLaserTime)
    : bowlingWindows.length
      ? Math.max(...bowlingWindows.map(window => Number(window.end || window.start))) + (5 / 60)
      : timeToNum(reservation.startTime) + arrivalBuffer;
  const bookingStart = numToTime(Math.max(0, firstLaserStart - arrivalBuffer));
  return getLaserCandidateWindows(bookingStart, games * 0.5, players).map(window => ({
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

function openQuickBookForLaserSession(sessionStart, remainingPlaces = LASER_GAME_MAX_PLAYERS) {
  const safeRemaining = Math.max(1, Math.min(LASER_GAME_MAX_PLAYERS, Number(remainingPlaces || LASER_GAME_MAX_PLAYERS)));
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
    return `${players} joueurs • ${waveCount} sessions`;
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
  if (Number(value) >= 24) return 'Minuit';
  const h = Math.floor(Number(value));
  const m = Math.round((Number(value) - h) * 60);
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

function normalizeLaserArenaEnd(start, end) {
  const arenaEnd = start + (LASER_GAME_ARENA_MINUTES / 60);
  if (!Number.isFinite(Number(end)) || end <= start) return arenaEnd;
  return Math.min(end, arenaEnd);
}

function getResourceWindowsFromReservation(reservation, resourceType) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const planned = blocks
    .filter(block => block.resourceType === resourceType)
    .filter(block => !(
      resourceType === 'laser_arena' &&
      reservation.type === 'laser' &&
      Number(block.countIndex || 1) > 1 &&
      !block.manualLaserPass
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
        players: Number(block.players || reservation.pax || 0),
      };
    })
    .filter(window => window.duration > 0);
  if (planned.length) return planned;
  if (resourceType === 'bowling_lane' && (reservation.lanes || []).length) {
    return [{
      reservation,
      resourceType,
      start: timeToNum(reservation.startTime),
      end: timeToNum(reservation.startTime) + Number(reservation.duration),
      duration: Number(reservation.duration),
      lanes: (reservation.lanes || []).map(Number),
      label: 'Bowling',
    }];
  }
  if (resourceType === 'laser_arena' && (reservation.type === 'formule' || reservation.formuleId)) {
    return getFormulaLaserFallbackWindows(reservation);
  }
  if (resourceType === 'laser_arena' && reservation.type === 'laser') {
    const laserGames = getLaserGameCountForReservation(reservation);
    return getLaserCandidateWindows(reservation.startTime, reservation.duration, reservation.pax)
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

function getLaserPassScheduledIndexes(reservation) {
  return [...new Set(getLaserWindowsFromReservation(reservation).map(window => Number(window.countIndex || 1)))].sort((a, b) => a - b);
}

function getPendingLaserPasses(dateStr = state.currentDate) {
  return todaysReservations()
    .filter(reservation =>
      reservation.date === dateStr
      && reservation.status !== 'cancelled'
      && (reservation.type === 'laser' || reservation.type === 'formule' || reservation.formuleId)
      && getLaserGameCountForReservation(reservation) > 1
    )
    .flatMap(reservation => {
      const totalGames = getLaserGameCountForReservation(reservation);
      const scheduled = new Set(getLaserPassScheduledIndexes(reservation));
      const passes = [];
      for (let countIndex = 2; countIndex <= totalGames; countIndex += 1) {
        if (!scheduled.has(countIndex)) {
          passes.push({
            reservation,
            countIndex,
            totalGames,
            players: Number(reservation.pax || 0),
          });
        }
      }
      return passes;
    });
}

function buildManualLaserPassBlocks(reservation, countIndex, targetStart, targetEnd = null) {
  const waveSizes = getBalancedLaserWaveSizes(reservation.pax);
  let cursor = hourToMinuteInt(targetStart);
  const fixedEnd = Number.isFinite(Number(targetEnd)) ? hourToMinuteInt(targetEnd) : null;
  return waveSizes.map((players, waveIndex) => {
    const start = cursor;
    const defaultDurationMinutes = LASER_GAME_ARENA_MINUTES;
    const durationMinutes = fixedEnd && waveSizes.length === 1 ? Math.max(15, fixedEnd - start) : defaultDurationMinutes;
    const end = start + durationMinutes;
    cursor = end;
    return {
      type: 'activity',
      activityId: 'laser_game',
      label: 'Laser Game',
      resourceType: 'laser_arena',
      countIndex,
      manualLaserPass: true,
      critical: true,
      start,
      end,
      startTime: minuteIntToTime(start),
      endTime: minuteIntToTime(end),
      durationMinutes,
      players,
      groupPlayers: Number(reservation.pax || players),
      groupWaveIndex: waveIndex + 1,
      groupWaveCount: waveSizes.length,
      weaponNeed: Math.min(players, LASER_GAME_MAX_PLAYERS),
    };
  });
}

function getSanitizedLaserResourceBlocks(reservation, replacingPassIndex = null) {
  const planned = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const base = planned.length
    ? planned
    : getLaserCandidateWindows(reservation.startTime, reservation.duration, reservation.pax).map(window => ({
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
  return base.filter(block => {
    if (block.resourceType !== 'laser_arena') return true;
    const index = Number(block.countIndex || 1);
    if (replacingPassIndex && index === Number(replacingPassIndex)) return false;
    if (reservation.type === 'laser' && index > 1 && !block.manualLaserPass) return false;
    return true;
  });
}

function checkManualLaserPassPlacement(reservation, passIndex, targetStart, targetEnd = null) {
  const candidateBlocks = buildManualLaserPassBlocks(reservation, passIndex, targetStart, targetEnd);
  const existingWindows = todaysReservations()
    .filter(item => item.status !== 'cancelled' && item.id !== reservation.id)
    .flatMap(getLaserWindowsFromReservation);
  const sameReservationWindows = getLaserWindowsFromReservation(reservation)
    .filter(window => Number(window.countIndex || 1) !== Number(passIndex));
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
    if (launchCount > LASER_GAME_PARALLEL_LAUNCHES) {
      return { ok: false, message: 'Ce lancement créerait deux sessions laser en parallèle.' };
    }
    if (playersTotal > LASER_GAME_MAX_PLAYERS) {
      return { ok: false, message: `Laser complet sur ce lancement (${playersTotal}/${LASER_GAME_MAX_PLAYERS}).` };
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
  for (let countIndex = 2; countIndex <= totalGames; countIndex += 1) {
    if (!scheduled.includes(countIndex)) pendingPasses.push({ countIndex, status: 'pending' });
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
        startTime: (opsPlan.resourceBlocks || []).find(block => block.resourceType === 'laser_arena' && Number(block.countIndex || 1) === countIndex)?.startTime || '',
      })),
      pendingPasses,
    },
  };
}

async function scheduleLaserPass(reservationId, passIndex, targetStart, targetEnd = null) {
  const reservation = state.reservations.find(item => Number(item.id) === Number(reservationId));
  if (!reservation) return;
  const placement = checkManualLaserPassPlacement(reservation, passIndex, targetStart, targetEnd);
  if (!placement.ok) {
    if (typeof showPlanningMoveNotice === 'function') {
      showPlanningMoveNotice('Laser Game bloque', placement.message, 'warning');
    } else {
      toast(placement.message);
    }
    return;
  }
  const previous = { ...reservation, opsPlan: reservation.opsPlan ? { ...reservation.opsPlan } : null };
  const nextOpsPlan = updateLaserPassPlan({
    ...(reservation.opsPlan || {}),
    resourceBlocks: [
      ...getSanitizedLaserResourceBlocks(reservation, passIndex),
      ...placement.blocks,
    ].sort((left, right) => Number(left.start || 0) - Number(right.start || 0)),
  }, reservation);
  const updated = {
    ...reservation,
    startTime: reservation.type === 'laser' && Number(passIndex) === 1
      ? getQuickBookStartForLaserSession({ start: Number(targetStart) }, Number(reservation.pax || 4))
      : reservation.startTime,
    allowPastStart: true,
    opsPlan: nextOpsPlan
  };
  const requestKey = Number(reservation.id);
  const requestSeq = ++laserPassSaveSeq;
  laserPassLatestSeqByReservation[requestKey] = requestSeq;
  const isLatestRequest = () => laserPassLatestSeqByReservation[requestKey] === requestSeq;
  const clearLatestRequest = () => {
    if (isLatestRequest()) delete laserPassLatestSeqByReservation[requestKey];
  };
  const moveFields = ['startTime', 'opsPlan'];
  if (typeof markReservationMutation === 'function') markReservationMutation(requestKey, updated, moveFields);
  applyOptimisticReservation(updated, { preserveEditState: true });
  try {
    const payload = await apiRequest(API_ENDPOINTS.staffReservations, {
      method: 'PATCH',
      body: JSON.stringify(buildReservationApiPayload(updated, {
        skipReplan: updated.type !== 'formule' && !updated.formuleId && !updated.formulaId,
        laneCount: 0,
        requiresLanes: false,
        allowPastStart: true
      }))
    });
    if (!isLatestRequest()) return;
    if (!payload?.reservation) throw new Error('Sauvegarde non confirmee par le serveur.');
    upsertReservationInState(payload.reservation);
    // Protection maintenue sur la position Laser confirmée le temps que les
    // lectures (staff-state) rattrapent l'écriture committée → pas de flicker.
    if (typeof markReservationMutation === 'function') markReservationMutation(requestKey, payload.reservation, moveFields);
    save();
    renderStaffData();
    toast(`Partie ${passIndex} placée à ${formatClockDisplay(targetStart)}`);
  } catch (error) {
    if (!isLatestRequest()) return;
    applyOptimisticReservation(previous, { preserveEditState: true });
    if (typeof clearReservationMutation === 'function') clearReservationMutation(requestKey);
    if (typeof showPlanningMoveNotice === 'function') {
      showPlanningMoveNotice('Deplacement Laser annule', error.message || 'Impossible de placer cette partie Laser Game.', 'warning');
    } else {
      toast(error.message || 'Impossible de placer cette partie Laser Game.');
    }
    return;
  } finally {
    clearLatestRequest();
  }
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
    STAFF_CAMPAIGN_CHANNELS,
    STAFF_CAMPAIGN_CENTERS,
    STAFF_SOCIAL_AGENTS,
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
    getCenterScheduleConfig,
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
    normalizeActivityText,
    formatDurationLabel,
    getLaserOption,
    getLaserGameCount,
    getLaserWaveCount,
    getBalancedLaserWaveSize,
    getBalancedLaserWaveSizes,
    getLaserCandidateWindows,
    getFormulaLaserFallbackWindows,
    getQuickBookStartForLaserSession,
    getLaserSlotCapacityText,
    getLaserSlotAfterText,
    getFormuleLaneDuration,
    estimateFormulaDurationFromLines,
    getFormuleTotalDuration,
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
    getPendingLaserPasses,
    buildManualLaserPassBlocks,
    getSanitizedLaserResourceBlocks,
    checkManualLaserPassPlacement,
    updateLaserPassPlan,
    scheduleLaserPass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
