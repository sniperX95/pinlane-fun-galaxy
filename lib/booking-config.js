const TOTAL_LANES = 8;
const MAX_PER_LANE = 6;
const EMERGENCY_MAX_PER_LANE = 7;
const PAIRS = [
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
];

// Paires de pistes voisines pour un centre a `laneCount` pistes
// ([[1,2],[3,4],...]). laneCount impair : la derniere piste reste sans binome.
function pairsForLaneCount(laneCount) {
  const count = Math.trunc(Number(laneCount));
  if (!Number.isFinite(count) || count < 2) return [];
  const pairs = [];
  for (let lane = 1; lane + 1 <= count; lane += 2) {
    pairs.push([lane, lane + 1]);
  }
  return pairs;
}

const LASER_GAME_ARENA_MINUTES = 25;

const BOWLING_PRICES = { 0.5: 20, 1: 39, 1.5: 59, 2: 78 };
const LASER_GAME_MAX_PLAYERS = 30;
const LASER_GAME_OPTIONS = [
  { games: 1, value: 0.5, label: '1 partie', price: 10, durationMinutes: 30 },
  { games: 2, value: 1, label: '2 parties', price: 18, durationMinutes: 60 },
  { games: 3, value: 1.5, label: '3 parties', price: 25, durationMinutes: 90 },
];

const DURATION_OPTIONS = [
  { value: 0.5, label: '30 min', price: 20 },
  { value: 1, label: '1 heure', price: 39 },
  { value: 1.5, label: '1h30', price: 59 },
  { value: 2, label: '2 heures', price: 78 },
];

const FORMULES = [
  { id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game', '30 min arcades', '2 cruches boissons'], price: 26, oldPrice: 34, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f2', name: 'FORMULE 2', family: 'Formules anniversaires', desc: ['1 partie Minigolf', '2 parties Laser Game', '30 min arcades', '2 cruches boissons'], price: 30, oldPrice: 45, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, best: true, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f3', name: 'FORMULE 3', family: 'Formules anniversaires', desc: ['1 partie Minigolf', '1h de Bowling', "30 min d'Arcades", '2 cruches boissons'], price: 28, oldPrice: 34, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f4', name: 'FORMULE 4', family: 'Formules anniversaires', desc: ['1 partie de Minigolf', '1h de Bowling', '2 parties Laser Game', '2 cruches boissons'], price: 39, oldPrice: 48, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f5', name: 'FORMULE 5', family: 'Formules anniversaires', desc: ['2 parties de Laser Game', '1 partie de Minigolf', '2 cruches boissons'], price: 26, oldPrice: 32, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f6', name: 'FORMULE 6', family: 'Formules anniversaires', desc: ['1 table privee pendant 2 heures', '1 entree a la plaine de jeu', "8EUR d'arcade par enfant", '2 cruches boissons'], price: 18, oldPrice: 20, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f7', name: 'FORMULE 7', family: 'Formules anniversaires', desc: ['1 table privee pendant 2 heures', '1 entree a la plaine de jeu', '1 entree Mini Golf Blacklight', "8EUR d'arcade par enfant", '2 cruches boissons'], price: 24, oldPrice: 30, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'f8', name: 'FORMULE 8', family: 'Formules anniversaires', desc: ['1 table privee pendant 2 heures', '1 entree a la plaine de jeu', '1 entree Mini Golf Blacklight', "30 minutes d'arcade a volonte par enfant", '2 cruches boissons'], price: 28, oldPrice: 37, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'bts', name: 'BACK TO SCHOOL/WORK', family: 'Formules speciales', desc: ['1h de Bowling', "1h d'Arcades"], price: 20, oldPrice: 50, type: 'per_pax', minPax: 4, validDays: [0, 2, 3, 4], timeLimit: { min: 18, max: 22 }, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Mardi, mercredi, jeudi et dimanche', 'De 18h a 22h', '4 personnes minimum', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'mm', name: 'MATIN MALIN', family: 'Formules speciales', desc: ['Arcades illimite', 'Laser Game illimite'], price: 25, oldPrice: 90, type: 'per_pax', minPax: 1, timeLimit: { max: 12 }, estimatedTotalDuration: 2, noHolidays: true, hasBowling: false, notes: ['Disponible uniquement avant 12h', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'css', name: 'CRAZY STUDENT STRIKE', family: 'Formules speciales', desc: ['1h de Bowling', '1 metre de biere'], price: 55, type: 'per_lane', minPax: 1, validDays: [2], noHolidays: false, hasBowling: true, bowlingDur: 1, notes: ['Disponible uniquement le mardi'] },
  { id: 'kfd', name: 'KIDS FUN DAY', family: 'Formules speciales', desc: ['Toutes les activites illimitees', 'De 12h a 17h pour les enfants de 5 a 12 ans'], price: 30, type: 'per_pax', minPax: 1, validDays: [3], timeLimit: { min: 12, max: 17 }, noHolidays: true, hasBowling: false, notes: ['Disponible uniquement le mercredi', 'Non valable durant les vacances scolaires et jours feries'] },
  { id: 'hlg', name: 'HAPPY LASER AND GAME', family: 'Formules speciales', desc: ["30 minutes d'arcade", '1 partie de Laser Game', '1 boisson'], price: 20, type: 'per_pax', minPax: 1, validDays: [4], noHolidays: true, hasBowling: false, notes: ['Disponible uniquement le jeudi'] },
  { id: 'ffm', name: 'FUN FRIDAY MADNESS', family: 'Formules speciales', desc: ['1 heure de Bowling', '1 partie de Laser Game', "30 minutes d'arcade", '1 boisson'], price: 30, type: 'per_pax', minPax: 1, validDays: [5], noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Disponible uniquement le vendredi'] },
];

// Conges scolaires FWB (Federation Wallonie-Bruxelles), verifies sur le
// calendrier officiel (enseignement.be / RTBF). kind: 'summer' = grandes
// vacances (juillet-aout), 'short' = petits conges (automne, hiver, detente,
// printemps). Structure extensible annee par annee.
const WALLONIA_SCHOOL_HOLIDAYS = [
  // Annee scolaire 2025-2026
  { start: '2025-10-20', end: '2025-11-02', label: "Conge d'automne", kind: 'short' },
  { start: '2025-12-22', end: '2026-01-04', label: "Vacances d'hiver", kind: 'short' },
  { start: '2026-02-16', end: '2026-03-01', label: 'Conge de detente', kind: 'short' },
  { start: '2026-04-27', end: '2026-05-10', label: 'Vacances de printemps', kind: 'short' },
  { start: '2026-07-04', end: '2026-08-23', label: "Vacances d'ete", kind: 'summer' },
  // Annee scolaire 2026-2027
  { start: '2026-10-19', end: '2026-11-01', label: "Conge d'automne", kind: 'short' },
  { start: '2026-12-21', end: '2027-01-03', label: "Vacances d'hiver", kind: 'short' },
  { start: '2027-02-22', end: '2027-03-07', label: 'Conge de detente', kind: 'short' },
  { start: '2027-04-26', end: '2027-05-09', label: 'Vacances de printemps', kind: 'short' },
  { start: '2027-07-03', end: '2027-08-22', label: "Vacances d'ete", kind: 'summer' },
];

const BELGIAN_PUBLIC_HOLIDAY_CACHE = new Map();
const BUSINESS_TIME_ZONE = 'Europe/Brussels';

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

  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
  };
}

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDateStr(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayStr() {
  const now = getBusinessNowParts();
  return `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
}

function timeToNum(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours + minutes / 60;
}

function numToTime(value) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundUpHalfHour(value) {
  return Math.ceil(Number(value) * 2) / 2;
}

function currentTimeDecimal() {
  const now = getBusinessNowParts();
  return now.hour + now.minute / 60;
}

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
      ['01-01', "Jour de l'An"],
      [toLocalDateStr(addDaysToDate(easterSunday, 1)).slice(5), 'Lundi de Paques'],
      ['05-01', 'Fete du Travail'],
      [toLocalDateStr(addDaysToDate(easterSunday, 39)).slice(5), 'Ascension'],
      [toLocalDateStr(addDaysToDate(easterSunday, 50)).slice(5), 'Lundi de Pentecote'],
      ['07-21', 'Fete nationale'],
      ['08-15', 'Assomption'],
      ['11-01', 'Toussaint'],
      ['11-11', 'Armistice'],
      ['12-25', 'Noel'],
    ];
    BELGIAN_PUBLIC_HOLIDAY_CACHE.set(
      year,
      new Map(entries.map(([monthDay, label]) => [`${year}-${monthDay}`, label])),
    );
  }
  return BELGIAN_PUBLIC_HOLIDAY_CACHE.get(year);
}

function getBelgianPublicHoliday(dateStr) {
  if (!dateStr) return null;
  const year = parseLocalDate(dateStr).getFullYear();
  return getBelgianPublicHolidayMap(year).get(dateStr) || null;
}

function isDateWithinRange(dateStr, start, end) {
  return Boolean(dateStr && dateStr >= start && dateStr <= end);
}

function getWalloniaSchoolHoliday(dateStr) {
  return WALLONIA_SCHOOL_HOLIDAYS.find((range) => isDateWithinRange(dateStr, range.start, range.end)) || null;
}

// --- Contexte vacances/feries configurable par centre ----------------------
// Le calendrier belge (feries + conges FWB) reste la source auto-detectee.
// Un centre peut, via centers.settings.config.holidaySettings :
//   - desactiver l'application automatique (enabled: false)
//   - forcer ponctuellement un jour en "holiday" ou "normal" (overrides: [{date, mode}])

const HOLIDAY_OVERRIDE_MODES = new Set(['holiday', 'normal']);
// Types de periode speciale : ferie legal, petit conge scolaire (automne,
// hiver, detente, printemps), grandes vacances (ete), jour force manuellement.
const HOLIDAY_PERIOD_TYPES = ['public', 'school_short', 'school_summer', 'manual'];
// Regle metier par defaut : les formules "non valables vacances/feries" sont
// bloquees les feries, les petits conges et les jours forces manuellement,
// mais restent ACCESSIBLES pendant les grandes vacances d'ete.
const DEFAULT_FORMULA_BLOCKED_PERIODS = ['public', 'school_short', 'manual'];

function getManualHolidayOverride(dateStr, holidaySettings) {
  if (!holidaySettings || typeof holidaySettings !== 'object') return null;
  const overrides = Array.isArray(holidaySettings.overrides) ? holidaySettings.overrides : [];
  const found = overrides.find((item) => item && item.date === dateStr && HOLIDAY_OVERRIDE_MODES.has(item.mode));
  return found ? found.mode : null;
}

function getHolidayContext(dateStr, center = null) {
  const schoolHoliday = getWalloniaSchoolHoliday(dateStr);
  const publicHoliday = getBelgianPublicHoliday(dateStr);
  const autoDetected = Boolean(schoolHoliday || publicHoliday);
  const settings = center && typeof center === 'object' ? center.holidaySettings : null;
  const override = getManualHolidayOverride(dateStr, settings);
  const autoApplyEnabled = !settings || settings.enabled !== false;
  const active = override === 'holiday' || (override !== 'normal' && autoApplyEnabled && autoDetected);
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
    autoApplyEnabled,
    schoolHoliday,
    publicHoliday,
    label: publicHoliday || (schoolHoliday ? schoolHoliday.label : '') || (override === 'holiday' ? 'Jour special (manuel)' : ''),
  };
}

function isHolidayScheduleDate(dateStr, center = null) {
  return getHolidayContext(dateStr, center).active;
}

function getFormulaBlockedPeriods(center = null) {
  const settings = center && typeof center === 'object' ? center.holidaySettings : null;
  const configured = settings && Array.isArray(settings.formulaBlockedPeriods) ? settings.formulaBlockedPeriods : null;
  if (!configured) return DEFAULT_FORMULA_BLOCKED_PERIODS;
  return configured.filter((value) => HOLIDAY_PERIOD_TYPES.includes(value));
}

// Une formule "noHolidays" est-elle bloquee a cette date pour ce centre ?
// Depend du TYPE de periode (ferie / petit conge / ete / manuel), configurable
// via holidaySettings.formulaBlockedPeriods.
function isFormulaBlockedDate(dateStr, center = null) {
  const context = getHolidayContext(dateStr, center);
  if (!context.active || !context.periodType) return false;
  return getFormulaBlockedPeriods(center).includes(context.periodType);
}

// Disponibilite d'une offre pilotee par le staff (centers.settings.config
// .offerAvailability : map formuleId -> boolean, absent = active).
function isOfferEnabled(formuleId, center = null) {
  const availability = center && typeof center === 'object' ? center.offerAvailability : null;
  if (!availability || typeof availability !== 'object') return true;
  return availability[formuleId] !== false;
}

function formatScheduleHour(value) {
  if (Number(value) >= 24) return 'Minuit';
  const hours = Math.floor(Number(value));
  const minutes = Math.round((Number(value) - hours) * 60);
  return minutes ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
}

function buildScheduleLabel(open, close) {
  return `${formatScheduleHour(open)} - ${formatScheduleHour(close)}`;
}

// Lit un jour dans un bloc d'horaires configure ({'0'..'6': {open, close}|null}).
// Retourne undefined si le jour n'est pas configure (le caller retombe sur la
// grille historique), null si explicitement ferme, sinon {open, close, label}.
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

function getLegacySchedule(day, holidayActive) {
  if (holidayActive) {
    if (day === 5 || day === 6) return { open: 10, close: 24, label: '10h - Minuit' };
    return { open: 10, close: 22, label: '10h - 22h' };
  }

  switch (day) {
    case 1:
      return null;
    case 2:
      return { open: 14, close: 22, label: '14h - 22h' };
    case 3:
      return { open: 12, close: 22, label: '12h - 22h' };
    case 4:
      return { open: 14, close: 22, label: '14h - 22h' };
    case 5:
      return { open: 14, close: 24, label: '14h - Minuit' };
    case 6:
      return { open: 10, close: 24, label: '10h - Minuit' };
    case 0:
      return { open: 10, close: 22, label: '10h - 22h' };
    default:
      return null;
  }
}

// Horaires du jour. Sans centre (ou sans grille configuree), comportement
// historique inchange. Avec un centre configure (defaultSchedule.regular /
// defaultSchedule.holiday + holidaySettings), la grille staff fait foi.
function getSchedule(dateStr, center = null) {
  const day = parseLocalDate(dateStr).getDay();
  const holidayActive = isHolidayScheduleDate(dateStr, center);
  const blocks = center && typeof center === 'object' && center.defaultSchedule && typeof center.defaultSchedule === 'object'
    ? center.defaultSchedule
    : null;

  if (blocks) {
    const holidaySlot = holidayActive ? scheduleFromConfigBlock(blocks.holiday, day) : undefined;
    const resolved = holidaySlot !== undefined ? holidaySlot : scheduleFromConfigBlock(blocks.regular, day);
    if (resolved !== undefined) return resolved;
  }

  return getLegacySchedule(day, holidayActive);
}

function normalizeActivityText(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getFormuleLaneDuration(formule) {
  if (!formule) return 0;
  return formule.hasBowling ? Number(formule.bowlingDur || 1) : 0.5;
}

function estimateFormulaDurationFromLines(formule) {
  if (!formule) return 0;
  if (formule.estimatedTotalDuration) return formule.estimatedTotalDuration;

  const descTexts = (formule.desc || []).map((line) => normalizeActivityText(line));
  const hasAllActivitiesWindowPackage =
    descTexts.some((text) => text.includes('toutes les activites illimitees')) &&
    descTexts.some((text) => text.includes('12h a 17h'));
  if (hasAllActivitiesWindowPackage) return 5;

  let total = 0;
  let anchoredDuration = 0;
  let activitySegments = 0;
  let hasFixedWindowPackage = false;

  descTexts.forEach((text) => {
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
    }
  });

  if (anchoredDuration) total = Math.max(total, anchoredDuration);
  if (!hasFixedWindowPackage && activitySegments > 1) total += 0.5;
  return Math.max(roundUpHalfHour(total || getFormuleLaneDuration(formule)), getFormuleLaneDuration(formule));
}

function getFormuleTotalDuration(formule) {
  return formule ? estimateFormulaDurationFromLines(formule) : 0;
}

function reservationNeedsLanes(type, formuleId) {
  // Recable 2a n2 : hasBowling lu via le STORE (getBookingFormule le derive des
  // steps), plus la constante FORMULES en dur. Ainsi, editer les steps d'une
  // formule (ajouter/retirer un step bowling) change correctement le besoin en
  // pistes. catalogBookingFormule retombe sur la constante si le store n'a rien.
  const formule = catalogBookingFormule(formuleId); // hasBowling derive des steps du store
  return type === 'bowling' || Boolean(formule && formule.hasBowling);
}

// Resolve the bowling capacity a center exposes, falling back to the historical
// hard-coded constants when no per-center config is supplied. This keeps the
// engine byte-for-byte identical when called without an override.
function resolveBowlingCapacity(bowlingConfig) {
  if (bowlingConfig && typeof bowlingConfig === 'object') {
    const laneCount = Number(bowlingConfig.laneCount);
    const normal = Number(bowlingConfig.normalCapacityPerLane);
    const emergency = Number(bowlingConfig.emergencyCapacityPerLane);
    // forceExtraLaneAtPax : seuil (en joueurs) au-dela duquel on ouvre une piste
    // de plus, pour le confort. 0 = desactive (comportement historique). Un champ
    // absent / non numerique / <= 0 est neutralise ici, donc le calcul reste
    // strictement identique quand aucun seuil valide n'est fourni.
    const forceExtra = Number(bowlingConfig.forceExtraLaneAtPax);
    return {
      laneCount: Number.isFinite(laneCount) && laneCount > 0 ? laneCount : TOTAL_LANES,
      normalCapacityPerLane: Number.isFinite(normal) && normal > 0 ? normal : MAX_PER_LANE,
      emergencyCapacityPerLane: Number.isFinite(emergency) && emergency > 0 ? emergency : EMERGENCY_MAX_PER_LANE,
      forceExtraLaneAtPax: Number.isFinite(forceExtra) && forceExtra > 0 ? forceExtra : 0,
    };
  }
  return {
    laneCount: TOTAL_LANES,
    normalCapacityPerLane: MAX_PER_LANE,
    emergencyCapacityPerLane: EMERGENCY_MAX_PER_LANE,
    forceExtraLaneAtPax: 0,
  };
}

function getRequiredLaneCount(type, pax, formuleId, bowlingConfig) {
  if (!reservationNeedsLanes(type, formuleId)) return 0;
  const { laneCount, normalCapacityPerLane, emergencyCapacityPerLane, forceExtraLaneAtPax } = resolveBowlingCapacity(bowlingConfig);
  const players = Number(pax) || 1;
  const normal = Math.ceil(players / normalCapacityPerLane);
  let required = normal;
  if (normal > laneCount && players <= laneCount * emergencyCapacityPerLane) required = laneCount;
  // forceExtraLaneAtPax cable : a partir de ce seuil, une piste de confort en
  // plus, TOUJOURS bornee au nombre total de pistes du centre. Neutre (0) => la
  // valeur de `required` ci-dessus est renvoyee telle quelle (doctrine defaut).
  // Applique au BOWLING DIRECT uniquement : une formule est un package fixe
  // (bowling + autres activites) dont la disponibilite et le prix sont deja
  // etablis ; y injecter une piste de confort en changerait le comportement
  // existant, ce que la doctrine "config defaut = inchange" interdit.
  if (type === 'bowling' && forceExtraLaneAtPax > 0 && players >= forceExtraLaneAtPax) {
    required = Math.min(required + 1, laneCount);
  }
  return required;
}

// --- Overrides catalogue (no-code) appliques EN MEMOIRE, comme les overrides
//     de centre (refreshCenterOverrides). FORMULE_OVERRIDES vide par defaut =>
//     comportement STRICTEMENT identique au fichier. Une ligne 'all' s'applique
//     a tous les centres ; une ligne centre precis PRIME champ par champ. Seul
//     le prix, l'ancien prix, le nom et le retrait sont overridables ; la
//     disponibilite par centre reste geree par center.offerAvailability. ------
let FORMULE_OVERRIDES = new Map(); // cle 'formuleId|centerId' -> ligne normalisee
let formuleOverridesLoadedAt = 0;

function setFormuleOverrides(map) {
  FORMULE_OVERRIDES = map instanceof Map ? map : new Map();
}

function resolveFormuleOverride(formuleId, centerId) {
  const all = FORMULE_OVERRIDES.get(`${formuleId}|all`) || null;
  const own = centerId && centerId !== 'all' ? (FORMULE_OVERRIDES.get(`${formuleId}|${centerId}`) || null) : null;
  if (!all && !own) return null;
  const pick = (field) => (own && own[field] != null ? own[field] : (all && all[field] != null ? all[field] : null));
  return {
    name: pick('name'),
    priceValue: pick('priceValue'),
    priceOld: pick('priceOld'),
    enabled: pick('enabled'),
    removed: Boolean(own ? own.removed : (all ? all.removed : false)),
  };
}

// Rafraichit la carte depuis la base (fail-soft, TTL 30 s). A appeler au bord
// des API (public-booking-meta, public-reservations) : la carte reste chaude,
// getBasePrice/getEffectiveFormules restent synchrones.
async function refreshFormuleOverrides(pool, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - formuleOverridesLoadedAt < 30000) return;
  try {
    const { loadFormuleOverrides } = require('./catalog-overrides');
    setFormuleOverrides(await loadFormuleOverrides(pool));
    formuleOverridesLoadedAt = now;
  } catch (error) {
    // On garde le dernier etat connu : un incident base ne doit pas changer
    // les prix affiches/factures de facon impredictible.
  }
}

// Catalogue de base lu depuis la SOURCE DB unique (lib/catalog-store, fusionnee
// par-dessus le socle FORMULES). require PARESSEUX : casse le cycle de chargement
// (catalog-store require ce module pour le socle FORMULES ; ce module n'appelle
// catalog-store qu'a l'execution). Fallback sur la constante FORMULES si le store
// est indisponible : comportement fichier garanti. Les formule_overrides
// (catalog-overrides) s'appliquent TOUJOURS PAR-DESSUS ce catalogue, inchange.
function catalogBookingFormule(formuleId) {
  try {
    const store = require('./catalog-store');
    const found = store.getBookingFormule(formuleId);
    if (found) return found;
    // FIX no-resurrect : une formule CONNUE du store mais desactivee
    // (active=false) ne doit pas ressusciter par la constante FORMULES. Le
    // fallback socle n'est legitime que pour un id INCONNU du store (store vide
    // au demarrage a froid, ou id jamais entre en base).
    if (store.isFormulaKnown(formuleId)) return null;
  } catch (error) {
    // Fallback socle ci-dessous.
  }
  return FORMULES.find((item) => item.id === formuleId) || null;
}

function catalogBookingList() {
  try {
    const list = require('./catalog-store').listBookingFormules();
    if (Array.isArray(list) && list.length) return list;
  } catch (error) {
    // Fallback socle ci-dessous.
  }
  return FORMULES;
}

// Liste des formules avec overrides appliques (prix, ancien prix, nom) et les
// formules retirees exclues, pour l'affichage du tunnel (public-booking-meta).
function getEffectiveFormules(centerId) {
  const out = [];
  for (const formule of catalogBookingList()) {
    const ov = resolveFormuleOverride(formule.id, centerId);
    if (!ov) { out.push(formule); continue; }
    if (ov.removed || ov.enabled === false) continue;
    out.push({
      ...formule,
      price: ov.priceValue != null ? ov.priceValue : formule.price,
      oldPrice: ov.priceOld != null ? ov.priceOld : formule.oldPrice,
      name: ov.name != null ? ov.name : formule.name,
    });
  }
  return out;
}

function getBasePrice(type, duration, laneCount, pax, formuleId, centerId) {
  if (type === 'bowling') return (BOWLING_PRICES[duration] || 0) * laneCount;
  if (type === 'laser') {
    const option = LASER_GAME_OPTIONS.find((item) => Number(item.value) === Number(duration)) || LASER_GAME_OPTIONS[0];
    return option.price * pax;
  }
  const formule = catalogBookingFormule(formuleId);
  if (!formule) return 0;
  const ov = resolveFormuleOverride(formule.id, centerId);
  const unit = (ov && ov.priceValue != null) ? ov.priceValue : formule.price;
  return formule.type === 'per_lane' ? unit * laneCount : unit * pax;
}

function getFormuleAvailability(formule, dateStr, pax, startTime = '', center = null) {
  const day = parseLocalDate(dateStr).getDay();
  if (!isOfferEnabled(formule.id, center)) {
    return { ok: false, message: 'Offre momentanement indisponible' };
  }
  if (pax < formule.minPax) return { ok: false, message: `Min. ${formule.minPax} personnes` };
  if (formule.noHolidays && isFormulaBlockedDate(dateStr, center)) {
    return { ok: false, message: 'Indisponible vacances/feries' };
  }
  if (formule.validDays && !formule.validDays.includes(day)) {
    return { ok: false, message: 'Indisponible ce jour' };
  }
  if (startTime && formule.timeLimit) {
    const start = timeToNum(startTime);
    const totalDuration = getFormuleTotalDuration(formule);
    if (formule.timeLimit.min && start < formule.timeLimit.min) {
      return { ok: false, message: `A partir de ${formule.timeLimit.min}h` };
    }
    if (formule.timeLimit.max && start + totalDuration > formule.timeLimit.max) {
      return { ok: false, message: `Jusqu'a ${formule.timeLimit.max}h` };
    }
  }
  return { ok: true, message: 'Disponible' };
}

module.exports = {
  BOWLING_PRICES,
  DURATION_OPTIONS,
  FORMULES,
  LASER_GAME_ARENA_MINUTES,
  LASER_GAME_MAX_PLAYERS,
  LASER_GAME_OPTIONS,
  MAX_PER_LANE,
  EMERGENCY_MAX_PER_LANE,
  PAIRS,
  TOTAL_LANES,
  currentTimeDecimal,
  getBasePrice,
  getEffectiveFormules,
  refreshFormuleOverrides,
  setFormuleOverrides,
  getFormuleAvailability,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getHolidayContext,
  getRequiredLaneCount,
  getSchedule,
  isFormulaBlockedDate,
  isHolidayScheduleDate,
  isOfferEnabled,
  numToTime,
  pairsForLaneCount,
  parseLocalDate,
  reservationNeedsLanes,
  resolveBowlingCapacity,
  roundUpHalfHour,
  timeToNum,
  todayStr,
};
