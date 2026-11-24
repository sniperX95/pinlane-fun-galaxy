const { AsyncLocalStorage } = require('async_hooks');
const { optionLaserAuPalier, prixBowlingAuPalier } = require('./prix-palier');

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

// Fun Run by PIXEL : le centre vend des SESSIONS, pas des heures. Le prix
// horaire n'est meme pas constant (120 EUR/h sur 15 min, 110 sur 30), donc
// aucun tarif unitaire ne peut l'exprimer : c'est une grille, comme le
// bowling et le laser. Elle vit ici avec elles : la dette est assumee et
// documentee depuis l'origine : tant que les grilles ne sont pas en base,
// les recopier ailleurs creerait deux verites sur le meme montant.
const FUN_RUN_OPTIONS = [
  { minutes: 15, label: '15 min', price: 30 },
  { minutes: 30, label: '30 min', price: 55 },
  { minutes: 60, label: '60 min', price: 100 },
];
// Nombre de joueurs simultanes que l'installation accepte.
const FUN_RUN_MAX_PAX = 5;

const DURATION_OPTIONS = [
  { value: 0.5, label: '30 min', price: 20 },
  { value: 1, label: '1 heure', price: 39 },
  { value: 1.5, label: '1h30', price: 59 },
  { value: 2, label: '2 heures', price: 78 },
];

// LES GRILLES D UN CENTRE (2026-11-04, lot 2 de l onglet Tarifs & formules).
//
// Les constantes ci-dessus sont le tarif de depart. Un centre pose le sien dans
// sa configuration (centers.settings.config.grillesTarif, droit Tarifs, action
// saveGrillesTarif), case par case :
//   { bowling: { '1': 42 }, laser: { '2': 20 }, funRun: { '15': 32 } }
// Une case remplace le PRIX, jamais la duree ni le libelle : le moteur, le tunnel
// et le planning gardent les memes paliers partout. Un centre qui n a rien pose,
// ou une case illisible, rend le tarif de depart, au centime pres.
const PRIX_GRILLE_MAX = 1000;
function prixDeGrille(valeur) {
  if (typeof valeur !== 'number' && (typeof valeur !== 'string' || !valeur.trim())) return null;
  const prix = Math.round(Number(valeur) * 100) / 100;
  // Pas de case a zero : une duree a 0 EUR est celle que le tunnel refuse (garde
  // anti-abus de lib/reservation-request.js), le client verrait une option qu il
  // ne peut pas prendre.
  return Number.isFinite(prix) && prix > 0 && prix <= PRIX_GRILLE_MAX ? prix : null;
}

function grillesAvec(lu) {
  const durationOptions = DURATION_OPTIONS.map((option) => ({ ...option, price: lu('bowling', option.value, option.price) }));
  return {
    bowlingPrices: Object.fromEntries(durationOptions.map((option) => [option.value, option.price])),
    durationOptions,
    laserOptions: LASER_GAME_OPTIONS.map((option) => ({ ...option, price: lu('laser', option.games, option.price) })),
    funRunOptions: FUN_RUN_OPTIONS.map((option) => ({ ...option, price: lu('funRun', option.minutes, option.price) })),
  };
}
const GRILLES_DE_DEPART = { bowlingPrices: BOWLING_PRICES, durationOptions: DURATION_OPTIONS, laserOptions: LASER_GAME_OPTIONS, funRunOptions: FUN_RUN_OPTIONS };

function grillesEffectives(grillesTarif) {
  if (!grillesTarif || typeof grillesTarif !== 'object') return GRILLES_DE_DEPART;
  return grillesAvec((nom, cle, repli) => {
    const grille = grillesTarif[nom];
    const prix = grille && typeof grille === 'object' ? prixDeGrille(grille[String(cle)]) : null;
    return prix === null ? repli : prix;
  });
}

// `getCenter` : le centre tel que la base le connait (cache de 30 s, relu par
// chaque porte avant de chiffrer). Sans centre, ou pour un centre inconnu, le
// tarif de depart : jamais celui d un autre centre.
function grillesDuCentre(centerId) {
  if (!centerId || centerId === 'all') return GRILLES_DE_DEPART;
  let centre = null;
  try {
    centre = require('./ops-knowledge').getCenter(centerId);
  } catch (error) {
    centre = null;
  }
  return grillesEffectives(centre && centre.grillesTarif);
}

const FORMULES = [
  { id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game', '30 min arcades', '2 cruches boissons'], price: 26, oldPrice: 34, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'f2', name: 'FORMULE 2', family: 'Formules anniversaires', desc: ['1 partie Minigolf', '2 parties Laser Game', '30 min arcades', '2 cruches boissons'], price: 30, oldPrice: 45, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, best: true, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'f3', name: 'FORMULE 3', family: 'Formules anniversaires', desc: ['1 partie Minigolf', '1h de Bowling', "30 min d'Arcades", '2 cruches boissons'], price: 28, oldPrice: 34, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  // LE CHOIX DU CLIENT (Movsar, 2026-10-13) : les deux parties de laser, ou
  // 60 min d arcades a leur place, au meme prix. La premiere variante est le
  // contenu de la carte ; lib/formula-choice joue les autres, et leur
  // programme se lit sur la carte servie : la ligne qui dit « Laser Game »
  // laisse la place a la leur, les autres restent celles du centre.
  { id: 'f4', name: 'FORMULE 4', family: 'Formules anniversaires', desc: ['1 partie de Minigolf', '1h de Bowling', '2 parties Laser Game', '2 cruches boissons'], price: 39, oldPrice: 48, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'],
    choices: [
      { id: 'laser2', label: '2 parties de Laser Game' },
      { id: 'arcade60', label: "60 min d'arcades", replaces: ['laser_game'], steps: [{ activityId: 'arcade_time', count: 1, durationMinutes: 60 }], descReplaces: ['Laser Game'], descWith: ["60 min d'arcades"] },
    ] },
  { id: 'f5', name: 'FORMULE 5', family: 'Formules anniversaires', desc: ['2 parties de Laser Game', '1 partie de Minigolf', '2 cruches boissons'], price: 26, oldPrice: 32, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'f6', name: 'FORMULE 6', family: 'Formules anniversaires', desc: ['1 table privée pendant 2 heures', '1 entrée à la plaine de jeu', "8 crédits d'arcade (8€) par enfant", '2 cruches boissons'], price: 18, oldPrice: 20, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'f7', name: 'FORMULE 7', family: 'Formules anniversaires', desc: ['1 table privée pendant 2 heures', '1 entrée à la plaine de jeu', '1 entrée Mini Golf Blacklight', "8 crédits d'arcade (8€) par enfant", '2 cruches boissons'], price: 24, oldPrice: 30, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'f8', name: 'FORMULE 8', family: 'Formules anniversaires', desc: ['1 table privée pendant 2 heures', '1 entrée à la plaine de jeu', '1 entrée Mini Golf Blacklight', "30 minutes d'arcade à volonté par enfant", '2 cruches boissons'], price: 28, oldPrice: 37, type: 'per_pax', minPax: 6, noHolidays: true, hasBowling: false, notes: ['Minimum 6 personnes', 'Non valable durant les vacances scolaires et jours fériés', 'Nourriture et boissons venues de l’extérieur non admises, sauf le gâteau d’anniversaire'] },
  { id: 'bts', name: 'BACK TO SCHOOL/WORK', family: 'Formules speciales', desc: ['1h de Bowling', "1h d'Arcades"], price: 20, oldPrice: 59, type: 'per_pax', minPax: 4, validDays: [0, 2, 3, 4], timeLimit: { min: 18, max: 22 }, noHolidays: true, hasBowling: true, bowlingDur: 1, notes: ['Mardi, mercredi, jeudi et dimanche', 'De 18h à 22h', '4 personnes minimum', 'Non valable durant les vacances scolaires et jours fériés'] },
  { id: 'mm', name: 'MATIN MALIN', family: 'Formules speciales', desc: ['Arcades illimitées, hors jeux à cadeaux', 'Laser Game illimité'], price: 25, oldPrice: 90, type: 'per_pax', minPax: 1, timeLimit: { max: 12 }, estimatedTotalDuration: 2, orderPolicy: 'open_window', noHolidays: true, hasBowling: false, notes: ['Toutes les activités de la formule doivent être terminées à 12h', 'Les jeux d’arcade à cadeaux ne sont pas inclus', 'Non valable durant les vacances scolaires et jours fériés'] },
  { id: 'css', name: 'CRAZY STUDENT STRIKE', family: 'Formules speciales', desc: ['1h de Bowling', '1 mètre de bière'], price: 55, type: 'per_lane', minPax: 1, validDays: [2], noHolidays: false, hasBowling: true, bowlingDur: 1, notes: ['Disponible uniquement le mardi'] },
  { id: 'kfd', name: 'KIDS FUN DAY', family: 'Formules speciales', desc: ['Toutes les activités illimitées', 'De 12h à 17h pour les enfants de 5 à 12 ans'], price: 30, type: 'per_pax', minPax: 1, validDays: [3], timeLimit: { min: 12, max: 17 }, orderPolicy: 'open_window', toutIllimite: true, noHolidays: true, hasBowling: false, notes: ['Disponible uniquement le mercredi', 'Non valable durant les vacances scolaires et jours fériés'] },
  { id: 'hlg', name: 'HAPPY LASER AND GAME', family: 'Formules speciales', desc: ["30 minutes d'arcade", '1 partie de Laser Game', '1 boisson'], price: 20, type: 'per_pax', minPax: 1, validDays: [4], noHolidays: false, hasBowling: false, notes: ['Disponible uniquement le jeudi'] },
  { id: 'ffm', name: 'FUN FRIDAY MADNESS', family: 'Formules speciales', desc: ['1 heure de Bowling', '1 partie de Laser Game', "30 minutes d'arcade", '1 boisson'], price: 30, type: 'per_pax', minPax: 1, validDays: [5], noHolidays: false, hasBowling: true, bowlingDur: 1, notes: ['Disponible uniquement le vendredi'] },
];

// Conges scolaires FWB (Federation Wallonie-Bruxelles), verifies sur le
// calendrier officiel (enseignement.be / RTBF). kind: 'summer' = grandes
// vacances (juillet-aout), 'short' = petits conges (automne, hiver, detente,
// printemps). Structure extensible annee par annee.
// HORIZON DE RESERVATION. Le champ date du tunnel n'avait aucune borne
// haute : le 2026-08-22, une reservation au 15/07/2028 etait acceptee et le
// serveur rendait de vrais creneaux. Or la table ci-dessous, seule source de
// verite des conges scolaires, s'arrete au 22/08/2027 : au-dela, plus aucune
// vacance n'existe pour le systeme, les horaires de vacances ne s'appliquent
// jamais et les formules « noHolidays » ne sont jamais bloquees. Un an, c'est
// exactement ce que le calendrier sait tenir.
const BOOKING_HORIZON_DAYS = 365;

// LES REGLES DE RESERVATION EN LIGNE D UN CENTRE (bookingRules, page Etablissement). L horizon ne depasse jamais
// un an, ce que le calendrier des conges sait tenir. Sans reglage : l an entier, et aucun delai en jours.
function reglesDeReservation(center) {
  const r = center && center.bookingRules && typeof center.bookingRules === 'object' ? center.bookingRules : {};
  const horizon = Math.trunc(Number(r.horizonDays));
  const jours = Math.trunc(Number(r.minDaysAhead));
  return {
    horizonDays: r.horizonDays != null && horizon >= 1 ? Math.min(horizon, BOOKING_HORIZON_DAYS) : BOOKING_HORIZON_DAYS,
    minDaysAhead: jours >= 1 ? Math.min(jours, 30) : 0,
  };
}

// Une date a venir, mais avant le premier jour que le centre accepte en ligne (aujourd hui + minDaysAhead).
function bookingDateTooSoon(dateStr, minDaysAhead) {
  const jours = Math.trunc(Number(minDaysAhead) || 0);
  if (jours <= 0) return false;
  const value = String(dateStr == null ? '' : dateStr).trim();
  const today = todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today) return false;
  const [year, month, day] = today.split('-').map(Number);
  return value < new Date(Date.UTC(year, month - 1, day + jours)).toISOString().slice(0, 10);
}

// Les deux refus, dits de la meme facon a l affichage des heures et a l envoi.
function messageDateTropProche(minDaysAhead) {
  return Number(minDaysAhead) === 1
    ? 'En ligne, ce centre se réserve au plus tard la veille. Choisissez un autre jour, ou appelez le centre.'
    : `En ligne, ce centre se réserve au moins ${minDaysAhead} jours à l’avance. Choisissez un jour plus éloigné, ou appelez le centre.`;
}
function messageDateTropLoin(horizonDays) {
  return `En ligne, ce centre se réserve jusqu’à ${horizonDays} jours à l’avance. Choisissez une date plus proche, ou appelez le centre.`;
}

// '' = date acceptable · 'invalid' · 'past' · 'far'.
function bookingDateOutOfRange(dateStr, horizonDays = BOOKING_HORIZON_DAYS) {
  const value = String(dateStr == null ? '' : dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid';
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) return 'invalid';
  const today = todayStr();
  if (value < today) return 'past';
  const [year, month, day] = today.split('-').map(Number);
  const limit = new Date(Date.UTC(year, month - 1, day + horizonDays));
  return value > limit.toISOString().slice(0, 10) ? 'far' : '';
}

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
// UN SEUL FORMATEUR (2026-10-13) : le construire a chaque appel coutait 2 s
// sur une grille d heures avec arrivee (mesure au profileur, 0,1 ms par appel,
// des dizaines de milliers d appels par la fenetre du jour). Il ne garde
// aucune date : l heure lue reste celle passee a chaque appel.
const BUSINESS_NOW_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getBusinessNowParts(date = new Date()) {
  const parts = BUSINESS_NOW_FORMAT.formatToParts(date);

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

// --- Synchronisation annuelle des conges scolaires (Communaute francaise) ----
// La table WALLONIA_SCHOOL_HOLIDAYS est la RESERVE : les annees scolaires deja
// publiees, recopiees a la main. Pour que le calendrier suive chaque annee sans
// qu on retape la table, le serveur relit le calendrier officiel republie par
// OpenHolidays (openholidaysapi.org, pays BE, groupe BE-FR = Federation
// Wallonie-Bruxelles) et garde en memoire les periodes lues pendant 24 h. La
// recherche d une date regarde les periodes lues PUIS la table : une lecture
// qui echoue ne retire rien, la table reste la verite. `npm run sync:calendar`
// recopie les memes periodes dans la table pour que la reserve suive aussi.
const OPENHOLIDAYS_SCHOOL_URL = 'https://openholidaysapi.org/SchoolHolidays';
const WALLONIA_SYNC_TTL_MS = 24 * 60 * 60 * 1000;
const WALLONIA_SYNC_RETRY_MS = 60 * 60 * 1000;
let walloniaFetched = [];
let walloniaFetchedAt = 0;
let walloniaFetchPending = null;

// Les cinq periodes ont un nom canonique, le meme que la table (les libelles
// de l API portent une precision entre parentheses : « Conge d'automne
// (Toussaint) »). Un libelle inconnu est garde tel quel, sans parenthese.
function normalizeWalloniaLabel(text) {
  const brut = String(text || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const plat = brut.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/automne|toussaint/.test(plat)) return { label: "Conge d'automne", kind: 'short' };
  if (/hiver|noel/.test(plat)) return { label: "Vacances d'hiver", kind: 'short' };
  if (/detente|carnaval/.test(plat)) return { label: 'Conge de detente', kind: 'short' };
  if (/printemps|paques/.test(plat)) return { label: 'Vacances de printemps', kind: 'short' };
  if (/ete\b|grandes vacances/.test(plat)) return { label: "Vacances d'ete", kind: 'summer' };
  return { label: brut, kind: 'short' };
}

// Les entrees brutes de l API vers la forme de la table. Seul le groupe BE-FR
// compte (les calendriers flamand et germanophone sont dans la meme reponse).
// Les marqueurs d un seul jour (« Debut des vacances d'ete ») ne sont pas des
// periodes : ignores.
function parseOpenHolidaysSchoolEntries(entries) {
  const out = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const groups = Array.isArray(entry.groups) ? entry.groups : [];
    if (!groups.some((group) => group && String(group.code || '').toUpperCase() === 'BE-FR')) return;
    const start = String(entry.startDate || '').slice(0, 10);
    const end = String(entry.endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return;
    const nom = (Array.isArray(entry.name) ? entry.name : []).find((item) => item && String(item.language || '').toUpperCase() === 'FR')
      || (Array.isArray(entry.name) ? entry.name[0] : null);
    const texte = nom && nom.text ? String(nom.text) : '';
    if (/^(debut|début|fin)\b/i.test(texte.trim()) || start === end) return;
    const { label, kind } = normalizeWalloniaLabel(texte);
    out.push({ start, end, label, kind });
  });
  const vus = new Set();
  return out
    .filter((range) => { const cle = `${range.start}>${range.end}`; if (vus.has(cle)) return false; vus.add(cle); return true; })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

function getWalloniaSchoolHolidays() {
  return [...walloniaFetched, ...WALLONIA_SCHOOL_HOLIDAYS];
}

function getWalloniaSchoolHoliday(dateStr) {
  return getWalloniaSchoolHolidays().find((range) => isDateWithinRange(dateStr, range.start, range.end)) || null;
}

// Jusqu ou la RESERVE (la table) voit : le gate exige au moins douze mois.
function walloniaSchoolHolidayCoverage() {
  return WALLONIA_SCHOOL_HOLIDAYS.reduce((max, range) => (range.end > max ? range.end : max), '');
}

// Relit le calendrier officiel, au plus une fois par 24 h par instance, avec un
// delai borne : la reponse d une disponibilite ne doit jamais attendre un site
// tiers. En cas d echec, une heure de silence avant de reessayer.
async function refreshWalloniaSchoolHolidays({ fetchImpl = globalThis.fetch, timeoutMs = 1500, now = Date.now() } = {}) {
  // PINLANE_CALENDAR_SYNC=off : les gates et le serveur de dev restent hors
  // reseau, la table statique seule fait foi.
  if (String(process.env.PINLANE_CALENDAR_SYNC || '').toLowerCase() === 'off') return { ok: false, cached: false, count: walloniaFetched.length, reason: 'desactive' };
  if (typeof fetchImpl !== 'function') return { ok: false, cached: false, count: walloniaFetched.length, reason: 'fetch indisponible' };
  if (walloniaFetchedAt && now - walloniaFetchedAt < WALLONIA_SYNC_TTL_MS) return { ok: true, cached: true, count: walloniaFetched.length };
  if (walloniaFetchPending) return walloniaFetchPending;
  walloniaFetchPending = (async () => {
    try {
      const aujourdhui = parseLocalDate(todayStr());
      const from = toLocalDateStr(addDaysToDate(aujourdhui, -60));
      const to = toLocalDateStr(addDaysToDate(aujourdhui, 400));
      const url = `${OPENHOLIDAYS_SCHOOL_URL}?countryIsoCode=BE&languageIsoCode=FR&validFrom=${from}&validTo=${to}`;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(url, { headers: { accept: 'application/json' }, ...(controller ? { signal: controller.signal } : {}) });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'sans reponse'}`);
      const parsed = parseOpenHolidaysSchoolEntries(await response.json());
      if (!parsed.length) throw new Error('aucune periode BE-FR dans la reponse');
      walloniaFetched = parsed;
      walloniaFetchedAt = now;
      return { ok: true, cached: false, count: parsed.length };
    } catch (error) {
      walloniaFetchedAt = now - WALLONIA_SYNC_TTL_MS + WALLONIA_SYNC_RETRY_MS;
      return { ok: false, cached: false, count: walloniaFetched.length, reason: String((error && error.message) || error) };
    } finally {
      walloniaFetchPending = null;
    }
  })();
  return walloniaFetchPending;
}

// Pour les gates : poser ou vider les periodes « lues » sans reseau.
function __setWalloniaFetchedForTests(list, at = Date.now()) {
  walloniaFetched = Array.isArray(list) ? list.slice() : [];
  walloniaFetchedAt = walloniaFetched.length ? at : 0;
  walloniaFetchPending = null;
}

// --- LE CALENDRIER DU CENTRE : SON PAYS ET SA REGION (2026-11-17, D5) -------
// Ansar : « regle tout ca » (Projects/pinlane/avant-lancement-2026-11-16, partie D). Les feries belges et les
// conges de la Federation Wallonie-Bruxelles s imposaient a tout centre : un centre francais voyait le 21 juillet
// et pas le 14, et ses horaires de vacances comme ses formules « pas en vacances » suivaient l ecole belge.
// Chaque centre choisit maintenant son calendrier (holidaySettings.calendar, page Etablissement). Sans choix :
// la Belgique francophone, lue par les MEMES fonctions qu avant (getBelgianPublicHoliday,
// getWalloniaSchoolHoliday) : Fun Galaxy ne voit rien changer (scripts/feries-par-pays-check.js, [A]).
//
// LES FERIES se calculent ici, pays par pays ; chaque liste est recopiee d une source officielle, citee
// au-dessus d elle. LES CONGES SCOLAIRES se relisent chez OpenHolidays comme ceux de la Federation : meme
// delai borne, meme cache de 24 h, meme heure de silence apres un echec. Seule la Federation a une table de
// reserve : ailleurs, ce que l API n a pas encore publie n existe pas pour le moteur, et la console le dit
// (etatDuCalendrier) au lieu de laisser croire a une annee sans vacances.
const CALENDRIER_PAR_DEFAUT = 'BE-FR';

function jourDePaques(annee, ecart) {
  return toLocalDateStr(addDaysToDate(getEasterSunday(annee), ecart)).slice(5);
}
// Le rang-ieme dimanche d un mois (1 a 12), decale de quelques jours, en MM-JJ.
function dimancheDuMois(annee, mois, rang, ecart = 0) {
  const premier = new Date(annee, mois - 1, 1);
  const dimanche = 1 + ((7 - premier.getDay()) % 7);
  return toLocalDateStr(new Date(annee, mois - 1, dimanche + 7 * (rang - 1) + ecart)).slice(5);
}
// Un jour qui n est ferie que s il tombe un lundi (le lendemain d un ferie tombe un dimanche).
function siLundi(annee, jour, libelle) {
  const [mois, quantieme] = jour.split('-').map(Number);
  return new Date(annee, mois - 1, quantieme).getDay() === 1 ? [jour, libelle] : null;
}

const FERIES_PAR_LISTE = {
  // France : Code du travail, article L3133-1 (les onze fetes legales).
  france: (an) => [
    ['01-01', 'Jour de l’An'], [jourDePaques(an, 1), 'Lundi de Pâques'], ['05-01', 'Fête du Travail'],
    ['05-08', 'Victoire 1945'], [jourDePaques(an, 39), 'Ascension'], [jourDePaques(an, 50), 'Lundi de Pentecôte'],
    ['07-14', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice 1918'],
    ['12-25', 'Noël'],
  ],
  // Bas-Rhin, Haut-Rhin et Moselle : en plus, Code du travail, article L3134-13. Le Vendredi saint n y est
  // ferie que dans les communes qui ont un temple protestant ou une eglise mixte : le calendrier le pose
  // partout, une commune sans temple le rend normal par un jour a part.
  alsaceMoselle: (an) => [
    ...FERIES_PAR_LISTE.france(an), [jourDePaques(an, -2), 'Vendredi saint'], ['12-26', 'Saint-Étienne'],
  ],
  // Luxembourg : Code du travail, article L.232-2 (la Journee de l Europe depuis la loi du 26 mars 2019).
  luxembourg: (an) => [
    ['01-01', 'Jour de l’An'], [jourDePaques(an, 1), 'Lundi de Pâques'], ['05-01', 'Fête du Travail'],
    ['05-09', 'Journée de l’Europe'], [jourDePaques(an, 39), 'Ascension'], [jourDePaques(an, 50), 'Lundi de Pentecôte'],
    ['06-23', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['12-25', 'Noël'],
    ['12-26', 'Saint-Étienne'],
  ],
  // Suisse : le 1er aout est le seul ferie federal (Constitution federale, article 110 alinea 3), tous les
  // autres sont cantonaux. Geneve : loi sur les jours feries, RSG J 1 45, article 1 (le Jeune genevois est le
  // jeudi qui suit le premier dimanche de septembre).
  geneve: (an) => [
    ['01-01', 'Nouvel An'], [jourDePaques(an, -2), 'Vendredi saint'], [jourDePaques(an, 1), 'Lundi de Pâques'],
    [jourDePaques(an, 39), 'Ascension'], [jourDePaques(an, 50), 'Lundi de Pentecôte'], ['08-01', 'Fête nationale'],
    [dimancheDuMois(an, 9, 1, 4), 'Jeûne genevois'], ['12-25', 'Noël'], ['12-31', 'Restauration de la République'],
  ],
  // Vaud : Etat de Vaud, « Jours feries officiels » publies chaque annee sur vd.ch, et loi sur le personnel
  // de l Etat de Vaud, article 123 (le lundi du Jeune suit le troisieme dimanche de septembre).
  vaud: (an) => [
    ['01-01', 'Nouvel An'], ['01-02', '2 janvier'], [jourDePaques(an, -2), 'Vendredi saint'],
    [jourDePaques(an, 1), 'Lundi de Pâques'], [jourDePaques(an, 39), 'Ascension'], [jourDePaques(an, 50), 'Lundi de Pentecôte'],
    ['08-01', 'Fête nationale'], [dimancheDuMois(an, 9, 3, 1), 'Lundi du Jeûne fédéral'], ['12-25', 'Noël'],
  ],
  // Neuchatel : SECO, « Jours feries en Suisse », annexe a l article 20a LTr (etat septembre 2015), section
  // Neuchatel ; loi sur le dimanche et les jours feries, RSN 941.02, article 3 : le 2 janvier et le 26 decembre
  // seulement quand le 1er janvier ou Noel tombe un dimanche, donc quand ils tombent un lundi. La Fete-Dieu du
  // Landeron (un seul village) n y est pas : un jour a part.
  neuchatel: (an) => [
    ['01-01', 'Nouvel An'], siLundi(an, '01-02', 'Lendemain du Nouvel An'), ['03-01', 'Instauration de la République'],
    [jourDePaques(an, -2), 'Vendredi saint'], ['05-01', 'Fête du Travail'], [jourDePaques(an, 39), 'Ascension'],
    ['08-01', 'Fête nationale'], ['12-25', 'Noël'], siLundi(an, '12-26', 'Lendemain de Noël'),
  ],
  // Jura : loi du 31 aout 2022 sur les jours feries officiels et le repos dominical, RSJU 555.1, article 3.
  jura: (an) => [
    ['01-01', 'Nouvel An'], ['01-02', '2 janvier'], [jourDePaques(an, -2), 'Vendredi saint'],
    [jourDePaques(an, 1), 'Lundi de Pâques'], ['05-01', 'Fête du Travail'], [jourDePaques(an, 39), 'Ascension'],
    [jourDePaques(an, 50), 'Lundi de Pentecôte'], [jourDePaques(an, 60), 'Fête-Dieu'],
    ['06-23', 'Commémoration du plébiscite'], ['08-01', 'Fête nationale'], ['08-15', 'Assomption'],
    ['11-01', 'Toussaint'], ['12-25', 'Noël'],
  ],
  // Valais : Etat du Valais, « Vacances, jours feries, conges » (vs.ch), les neuf jours feries du canton. Le
  // Vendredi saint, les lundis de Paques et de Pentecote et la Saint-Etienne y sont chomes, pas feries.
  valais: (an) => [
    ['01-01', 'Nouvel An'], ['03-19', 'Saint-Joseph'], [jourDePaques(an, 39), 'Ascension'],
    [jourDePaques(an, 60), 'Fête-Dieu'], ['08-01', 'Fête nationale'], ['08-15', 'Assomption'],
    ['11-01', 'Toussaint'], ['12-08', 'Immaculée Conception'], ['12-25', 'Noël'],
  ],
  // Fribourg : SECO, annexe a l article 20a LTr (etat septembre 2015), section Fribourg, et fr.ch « Jours
  // feries ». La liste depend de la commune : catholique ou reformee.
  fribourgCatholique: (an) => [
    ['01-01', 'Nouvel An'], [jourDePaques(an, -2), 'Vendredi saint'], [jourDePaques(an, 39), 'Ascension'],
    [jourDePaques(an, 60), 'Fête-Dieu'], ['08-01', 'Fête nationale'], ['08-15', 'Assomption'],
    ['11-01', 'Toussaint'], ['12-08', 'Immaculée Conception'], ['12-25', 'Noël'],
  ],
  fribourgReforme: (an) => [
    ['01-01', 'Nouvel An'], ['01-02', 'Saint-Berchtold'], [jourDePaques(an, -2), 'Vendredi saint'],
    [jourDePaques(an, 1), 'Lundi de Pâques'], [jourDePaques(an, 39), 'Ascension'], [jourDePaques(an, 50), 'Lundi de Pentecôte'],
    ['08-01', 'Fête nationale'], ['12-25', 'Noël'], ['12-26', 'Saint-Étienne'],
  ],
};

// Les calendriers proposes. `feries` : la liste ci-dessus (« belgique » = getBelgianPublicHolidayMap, les dix
// feries legaux, communs aux trois communautes) ; `ecole` : la question posee a OpenHolidays (groupe pour la
// Belgique, subdivision ailleurs ; `commentaire` garde, en Valais, les periodes de l ecole francophone).
const CALENDRIERS = new Map([
  ['BE-FR', { pays: 'Belgique', libelle: 'Belgique, Fédération Wallonie-Bruxelles', feries: 'belgique', ecole: { pays: 'BE', groupe: 'BE-FR' } }],
  ['BE-NL', { pays: 'Belgique', libelle: 'Belgique, Communauté flamande', feries: 'belgique', ecole: { pays: 'BE', groupe: 'BE-NL' } }],
  ['BE-DE', { pays: 'Belgique', libelle: 'Belgique, Communauté germanophone', feries: 'belgique', ecole: { pays: 'BE', groupe: 'BE-DE' } }],
  ['FR-A', { pays: 'France', libelle: 'France, zone A', feries: 'france', ecole: { pays: 'FR', subdivision: 'FR-ZA' } }],
  ['FR-B', { pays: 'France', libelle: 'France, zone B', feries: 'france', ecole: { pays: 'FR', subdivision: 'FR-ZB' } }],
  ['FR-B-AM', { pays: 'France', libelle: 'France, zone B, Alsace et Moselle', feries: 'alsaceMoselle', ecole: { pays: 'FR', subdivision: 'FR-ZB' } }],
  ['FR-C', { pays: 'France', libelle: 'France, zone C', feries: 'france', ecole: { pays: 'FR', subdivision: 'FR-ZC' } }],
  ['LU', { pays: 'Luxembourg', libelle: 'Luxembourg', feries: 'luxembourg', ecole: { pays: 'LU' } }],
  ['CH-GE', { pays: 'Suisse', libelle: 'Suisse, canton de Genève', feries: 'geneve', ecole: { pays: 'CH', subdivision: 'CH-GE' } }],
  ['CH-VD', { pays: 'Suisse', libelle: 'Suisse, canton de Vaud', feries: 'vaud', ecole: { pays: 'CH', subdivision: 'CH-VD' } }],
  ['CH-NE', { pays: 'Suisse', libelle: 'Suisse, canton de Neuchâtel', feries: 'neuchatel', ecole: { pays: 'CH', subdivision: 'CH-NE' } }],
  ['CH-JU', { pays: 'Suisse', libelle: 'Suisse, canton du Jura', feries: 'jura', ecole: { pays: 'CH', subdivision: 'CH-JU' } }],
  ['CH-VS', { pays: 'Suisse', libelle: 'Suisse, Valais romand', feries: 'valais', ecole: { pays: 'CH', subdivision: 'CH-VS', commentaire: /franco/i } }],
  ['CH-FR-C', { pays: 'Suisse', libelle: 'Suisse, canton de Fribourg, commune catholique', feries: 'fribourgCatholique', ecole: { pays: 'CH', subdivision: 'CH-FR' } }],
  ['CH-FR-R', { pays: 'Suisse', libelle: 'Suisse, canton de Fribourg, commune réformée', feries: 'fribourgReforme', ecole: { pays: 'CH', subdivision: 'CH-FR' } }],
]);

// Le code range dans la configuration du centre : un code connu, sinon rien (la Belgique francophone).
function codeDeCalendrier(valeur) {
  const code = typeof valeur === 'string' ? valeur.trim().toUpperCase() : '';
  return CALENDRIERS.has(code) ? code : '';
}

function calendrierDuCentre(center) {
  const settings = center && typeof center === 'object' ? center.holidaySettings : null;
  return codeDeCalendrier(settings && typeof settings === 'object' ? settings.calendar : '') || CALENDRIER_PAR_DEFAUT;
}

// Ce que la page Etablissement propose, dans l ordre.
function listeDesCalendriers() {
  return [...CALENDRIERS.entries()].map(([code, c]) => ({ code, pays: c.pays, libelle: c.libelle }));
}

const FERIES_PAR_ANNEE = new Map();
function feriesDeLAnnee(code, annee) {
  const calendrier = CALENDRIERS.get(code) || CALENDRIERS.get(CALENDRIER_PAR_DEFAUT);
  if (calendrier.feries === 'belgique') return getBelgianPublicHolidayMap(annee);
  const cle = `${code}:${annee}`;
  if (!FERIES_PAR_ANNEE.has(cle)) {
    const liste = FERIES_PAR_LISTE[calendrier.feries](annee).filter(Boolean);
    FERIES_PAR_ANNEE.set(cle, new Map(liste.map(([jour, libelle]) => [`${annee}-${jour}`, libelle])));
  }
  return FERIES_PAR_ANNEE.get(cle);
}

function getPublicHolidayFor(code, dateStr) {
  if (!dateStr) return null;
  if (!CALENDRIERS.has(code) || CALENDRIERS.get(code).feries === 'belgique') return getBelgianPublicHoliday(dateStr);
  return feriesDeLAnnee(code, parseLocalDate(dateStr).getFullYear()).get(dateStr) || null;
}

// Les noms courts de certains cantons (« Ete », « Sport ») deviennent une phrase lisible.
const NOMS_SCOLAIRES_COURTS = {
  ete: 'Vacances d’été', automne: 'Vacances d’automne', noel: 'Vacances de Noël', printemps: 'Vacances de printemps',
  sport: 'Vacances de sport', hiver: 'Vacances d’hiver', paques: 'Vacances de Pâques',
};
const sansAccents = (texte) => String(texte || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function libelleScolaire(texte) {
  const brut = String(texte || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const label = NOMS_SCOLAIRES_COURTS[sansAccents(brut)] || brut;
  return { label, kind: /(^|[^a-z])ete([^a-z]|$)|grandes vacances/.test(sansAccents(label)) ? 'summer' : 'short' };
}

// L entree concerne-t-elle ce calendrier ? En Belgique, le groupe (les trois communautes sont dans la meme
// reponse) ; ailleurs, la subdivision ou tout le pays ; en Valais, la langue de l ecole.
function entreeDuCalendrier(entry, ecole) {
  if (ecole.groupe) {
    return (Array.isArray(entry.groups) ? entry.groups : []).some((group) => group && String(group.code || '').toUpperCase() === ecole.groupe);
  }
  if (ecole.subdivision && entry.nationwide !== true) {
    const subdivisions = Array.isArray(entry.subdivisions) ? entry.subdivisions : [];
    if (!subdivisions.some((sub) => sub && String(sub.code || '').toUpperCase() === ecole.subdivision)) return false;
  }
  if (ecole.commentaire) {
    const notes = (Array.isArray(entry.comment) ? entry.comment : []).map((note) => String((note && note.text) || '')).filter(Boolean);
    if (notes.length && !notes.some((note) => ecole.commentaire.test(note))) return false;
  }
  return true;
}

// Les periodes d un autre calendrier que la Federation. Un marqueur (« Fin des cours », « Debut des vacances
// d ete ») n est pas une periode ; un vrai jour de conge isole (le Jour de la Communaute germanophone, le pont
// de l Ascension) en est une. Deux ecoles du meme canton qui se chevauchent (Fribourg : primaire de la ville,
// secondaire) ne font qu une periode : un enfant de la famille est en vacances.
function periodesScolairesDe(entries, code) {
  const calendrier = CALENDRIERS.get(code);
  if (!calendrier) return [];
  const out = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object' || !entreeDuCalendrier(entry, calendrier.ecole)) return;
    if (entry.type && String(entry.type) !== 'School') return;
    const start = String(entry.startDate || '').slice(0, 10);
    const end = String(entry.endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return;
    const noms = Array.isArray(entry.name) ? entry.name : [];
    const nom = noms.find((item) => item && String(item.language || '').toUpperCase() === 'FR') || noms[0] || null;
    const texte = nom && nom.text ? String(nom.text) : '';
    if (/^(debut|début|fin)\b/i.test(texte.trim())) return;
    const { label, kind } = libelleScolaire(texte);
    out.push({ start, end, label, kind });
  });
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.end < b.end ? -1 : a.end > b.end ? 1 : 0)));
  const fusion = [];
  out.forEach((periode) => {
    const derniere = fusion[fusion.length - 1];
    if (derniere && periode.start <= derniere.end) {
      if (periode.end > derniere.end) derniere.end = periode.end;
      if (periode.kind === 'summer') derniere.kind = 'summer';
      return;
    }
    fusion.push({ ...periode });
  });
  return fusion;
}

// Les periodes lues, par calendrier (la Federation garde les siennes plus haut : walloniaFetched).
const CONGES_LUS = new Map();
function congesLus(code) {
  if (!CONGES_LUS.has(code)) CONGES_LUS.set(code, { periodes: [], lueA: 0, enCours: null });
  return CONGES_LUS.get(code);
}

function getSchoolHolidaysFor(code) {
  if (!CALENDRIERS.has(code) || code === CALENDRIER_PAR_DEFAUT) return getWalloniaSchoolHolidays();
  return congesLus(code).periodes.slice();
}

function getSchoolHolidayFor(code, dateStr) {
  if (!CALENDRIERS.has(code) || code === CALENDRIER_PAR_DEFAUT) return getWalloniaSchoolHoliday(dateStr);
  return congesLus(code).periodes.find((range) => isDateWithinRange(dateStr, range.start, range.end)) || null;
}

// La relecture d un autre calendrier : les memes regles que refreshWalloniaSchoolHolidays (24 h par instance,
// delai borne, une heure de silence apres un echec, PINLANE_CALENDAR_SYNC=off coupe tout appel). La
// Federation passe par sa propre fonction, inchangee.
async function refreshSchoolHolidays(code, { fetchImpl = globalThis.fetch, timeoutMs = 1500, now = Date.now() } = {}) {
  const cle = CALENDRIERS.has(code) ? code : CALENDRIER_PAR_DEFAUT;
  if (cle === CALENDRIER_PAR_DEFAUT) return refreshWalloniaSchoolHolidays({ fetchImpl, timeoutMs, now });
  const etat = congesLus(cle);
  if (String(process.env.PINLANE_CALENDAR_SYNC || '').toLowerCase() === 'off') return { ok: false, cached: false, count: etat.periodes.length, reason: 'desactive' };
  if (typeof fetchImpl !== 'function') return { ok: false, cached: false, count: etat.periodes.length, reason: 'fetch indisponible' };
  if (etat.lueA && now - etat.lueA < WALLONIA_SYNC_TTL_MS) return { ok: true, cached: true, count: etat.periodes.length };
  if (etat.enCours) return etat.enCours;
  etat.enCours = (async () => {
    try {
      const { ecole } = CALENDRIERS.get(cle);
      const aujourdhui = parseLocalDate(todayStr());
      const from = toLocalDateStr(addDaysToDate(aujourdhui, -60));
      const to = toLocalDateStr(addDaysToDate(aujourdhui, 400));
      const url = `${OPENHOLIDAYS_SCHOOL_URL}?countryIsoCode=${ecole.pays}&languageIsoCode=FR&validFrom=${from}&validTo=${to}${ecole.subdivision ? `&subdivisionCode=${ecole.subdivision}` : ''}`;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(url, { headers: { accept: 'application/json' }, ...(controller ? { signal: controller.signal } : {}) });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'sans reponse'}`);
      const parsed = periodesScolairesDe(await response.json(), cle);
      if (!parsed.length) throw new Error(`aucune periode ${cle} dans la reponse`);
      etat.periodes = parsed;
      etat.lueA = now;
      return { ok: true, cached: false, count: parsed.length };
    } catch (error) {
      etat.lueA = now - WALLONIA_SYNC_TTL_MS + WALLONIA_SYNC_RETRY_MS;
      return { ok: false, cached: false, count: etat.periodes.length, reason: String((error && error.message) || error) };
    } finally {
      etat.enCours = null;
    }
  })();
  return etat.enCours;
}

// Le calendrier d UN centre, relu avant de repondre (meme place que l ancien appel a la Federation).
function refreshSchoolHolidaysFor(center, options) {
  return refreshSchoolHolidays(calendrierDuCentre(center), options);
}

// Les chemins qui ne relisaient rien (l assistant, l agent des mails) relisent le calendrier d un centre hors
// Federation avant de juger ses jours ; la Federation garde sa table, sans aucun appel de plus. Ne jette jamais.
async function relireCalendrierHorsFederation(center, options) {
  const code = calendrierDuCentre(center);
  if (code === CALENDRIER_PAR_DEFAUT) return { ok: true, cached: true, count: 0, reason: 'federation' };
  try { return await refreshSchoolHolidays(code, options); } catch (error) { return { ok: false, cached: false, count: 0, reason: String((error && error.message) || error) }; }
}

// Ce que la console dit du calendrier : jusqu ou les conges scolaires sont connus. '' = inconnus.
function etatDuCalendrier(code) {
  const cle = CALENDRIERS.has(code) ? code : CALENDRIER_PAR_DEFAUT;
  const calendrier = CALENDRIERS.get(cle);
  const connuJusquau = getSchoolHolidaysFor(cle).reduce((max, range) => (range.end > max ? range.end : max), '');
  return { code: cle, pays: calendrier.pays, libelle: calendrier.libelle, connuJusquau };
}

// LE CALENDRIER ENVOYE AU NAVIGATEUR (console, ancien tunnel) d un centre hors Federation : ses feries et ses
// conges sur la fenetre que la page montre (un mois en arriere, un peu plus d un an devant). La Federation n en
// a pas besoin : assets/booking-core.js porte sa table et ses feries, comme avant.
function calendrierPourLeClient(center, { depuis = '', jours = 430 } = {}) {
  const code = calendrierDuCentre(center);
  const etat = etatDuCalendrier(code);
  const debut = /^\d{4}-\d{2}-\d{2}$/.test(String(depuis)) ? String(depuis) : toLocalDateStr(addDaysToDate(parseLocalDate(todayStr()), -31));
  const fin = toLocalDateStr(addDaysToDate(parseLocalDate(debut), jours));
  const dates = [];
  for (let annee = Number(debut.slice(0, 4)); annee <= Number(fin.slice(0, 4)); annee += 1) {
    for (const [date, libelle] of feriesDeLAnnee(code, annee)) {
      if (date >= debut && date <= fin) dates.push([date, libelle]);
    }
  }
  const feries = Object.fromEntries(dates.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const conges = getSchoolHolidaysFor(code)
    .filter((range) => range.end >= debut && range.start <= fin)
    .map(({ start, end, label, kind }) => ({ start, end, label, kind }));
  return { ...etat, feries, conges };
}

// LA PAGE ETABLISSEMENT (api/ops.js, centerConfig) : chaque centre hors Federation part avec son calendrier,
// relu une fois par code ; un centre de la Federation part tel quel, comme avant.
async function centresAvecCalendrier(centers, options) {
  const liste = Array.isArray(centers) ? centers : [];
  const codes = [...new Set(liste.map((centre) => calendrierDuCentre(centre)).filter((code) => code !== CALENDRIER_PAR_DEFAUT))];
  await Promise.all(codes.map((code) => refreshSchoolHolidays(code, options).catch(() => null)));
  return liste.map((centre) => (calendrierDuCentre(centre) !== CALENDRIER_PAR_DEFAUT ? { ...centre, holidayCalendar: calendrierPourLeClient(centre) } : centre));
}

// Pour les gates : poser ou vider les periodes « lues » d un calendrier sans reseau.
function __setSchoolHolidaysForTests(code, list, at = Date.now()) {
  if (code === CALENDRIER_PAR_DEFAUT) { __setWalloniaFetchedForTests(list, at); return; }
  const etat = congesLus(code);
  etat.periodes = Array.isArray(list) ? list.slice() : [];
  etat.lueA = etat.periodes.length ? at : 0;
  etat.enCours = null;
}

// --- Contexte vacances/feries configurable par centre ----------------------
// Le calendrier du centre (holidaySettings.calendar, Federation par defaut) est la source auto-detectee.
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
  // Le calendrier de CE centre (2026-11-17, D5) : sans choix, la Federation, par les memes fonctions qu avant.
  const calendrier = calendrierDuCentre(center);
  const schoolHoliday = getSchoolHolidayFor(calendrier, dateStr);
  const publicHoliday = getPublicHolidayFor(calendrier, dateStr);
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
  // Comme le formulaire (assets/booking-core.js) : minuit pile se dit « Minuit », au-dela la nuit deborde sur le
  // lendemain (25 h = 1 h du matin). La page Etablissement accepte maintenant une fermeture apres minuit.
  const raw = Number(value);
  if (raw === 24) return 'Minuit';
  const wrapped = raw > 24 ? raw - 24 : raw;
  const hours = Math.floor(wrapped);
  const minutes = Math.round((wrapped - hours) * 60);
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

// L OUVERTURE EXCEPTIONNELLE D UN JOUR (2026-11-09, Ansar : « par exemple c 14-22 on puet
// ouvirr le centre a 10 h ou fermer a minuit »). Pour un groupe, l equipe ouvre plus tot,
// ferme plus tard, ou ouvre un jour ferme. Elle ne vaut QUE pour l equipe : les portes du
// comptoir travaillent dans pourLEquipe, et rien d autre n y entre. Un client en ligne, le
// mail automatique et l assistant gardent les horaires habituels, par defaut, sans avoir a
// y penser : une porte oubliee montre moins, jamais plus.
const contexteEquipe = new AsyncLocalStorage();
function pourLEquipe(travail) {
  return contexteEquipe.run({ equipe: true }, travail);
}

function ouvertureExceptionnelle(dateStr, center) {
  const liste = center && Array.isArray(center.ouverturesExceptionnelles) ? center.ouverturesExceptionnelles : null;
  const ligne = liste ? liste.find((x) => x && x.date === dateStr) : null;
  if (!ligne) return null;
  const open = timeToNum(ligne.open);
  const close = timeToNum(ligne.close);
  if (!(close > open)) return null;
  return { open, close, label: buildScheduleLabel(open, close), exceptionnelle: true };
}

// Horaires du jour. Sans centre (ou sans grille configuree), comportement
// historique inchange. Avec un centre configure (defaultSchedule.regular /
// defaultSchedule.holiday + holidaySettings), la grille staff fait foi.
function getSchedule(dateStr, center = null) {
  const contexte = contexteEquipe.getStore();
  if (contexte && contexte.equipe === true) {
    const exception = ouvertureExceptionnelle(dateStr, center);
    if (exception) return exception;
  }
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

// COMBIEN DE TEMPS UNE FORMULE OCCUPE-T-ELLE, POUR LE MOTEUR ?
// Pas la meme chose que sa duree annoncee. Une formule a FENETRE OUVERTE
// (MATIN MALIN, KIDS FUN DAY) ne reserve que la demi-heure d arrivee : la
// visite dure jusqu a la fin de la periode, quelle que soit l heure ou le
// client arrive. C est ce que getFormuleAvailability applique plus bas pour
// borner l arrivee, et ce que la route publique applique pour composer la
// liste des creneaux. Une seule expression, parce que deux portes en
// dependent et qu une copie finirait par deriver.
function getFormuleBookedDuration(formule) {
  if (!formule) return 0;
  return formule.orderPolicy === 'open_window' ? 0.5 : getFormuleTotalDuration(formule);
}

// LA FENETRE D ARRIVEE D UNE FORMULE, UN JOUR DONNE : la premiere et la
// derniere heure de debut possibles, en heures decimales. La periode est la
// plage d ouverture du jour bornee par celle de la formule ; la derniere
// arrivee est la fin de cette periode moins le temps que le moteur reserve
// (la demi-heure d arrivee pour une fenetre ouverte, toute la visite sinon).
// C est LA regle : la route publique compose ses creneaux avec elle, l agent
// dit avec elle quels jours et jusqu a quelle heure une formule se reserve,
// et le navigateur en porte une jumelle exacte (assets/booking-core.js) que
// le gate de derive compare a celle-ci. null quand le centre n ouvre pas.
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
    return {
      laneCount: Number.isFinite(laneCount) && laneCount > 0 ? laneCount : TOTAL_LANES,
      normalCapacityPerLane: Number.isFinite(normal) && normal > 0 ? normal : MAX_PER_LANE,
      emergencyCapacityPerLane: Number.isFinite(emergency) && emergency > 0 ? emergency : EMERGENCY_MAX_PER_LANE,
    };
  }
  return {
    laneCount: TOTAL_LANES,
    normalCapacityPerLane: MAX_PER_LANE,
    emergencyCapacityPerLane: EMERGENCY_MAX_PER_LANE,
  };
}

// LE GROUPE QUI NE TIENT PAS SUR LES PISTES JOUE EN PLUSIEURS SERVICES.
//
// Rend la taille de chaque service, dans l ordre. UN SEUL element = le groupe
// tient en une fois, et rien ne change pour lui : c est le cas de tous les
// groupes jusqu a `pistes x capacite de secours`.
//
// Les services sont EQUILIBRES : 70 joueurs a Libramont donnent deux services
// de 35, pas 48 puis 22. Les deux sous-groupes vivent alors la meme chose, et
// chacun tient sur `ceil(35 / 6) = 6` pistes, ce qui en laisse deux libres
// pour les autres clients. C est la meme repartition que les vagues de
// l arene laser, qui est deja ecrite et deja eprouvee.
//
// C EST ICI QUE SE REGLE LA SCISSION, et nulle part ailleurs. La regle
// commerciale qui en decoule se lit dans getBilledLaneCount, juste dessous :
// un seul endroit a ouvrir pour changer ce que coute un second service.
function splitGroupIntoBowlingServices(pax, bowlingConfig) {
  const { laneCount, normalCapacityPerLane, emergencyCapacityPerLane } = resolveBowlingCapacity(bowlingConfig);
  const players = Math.max(1, Number(pax) || 1);
  const confort = Math.max(1, laneCount * normalCapacityPerLane);
  const secours = Math.max(confort, laneCount * emergencyCapacityPerLane);
  if (players <= secours) return [players];
  const services = Math.ceil(players / confort);
  const base = Math.floor(players / services);
  const extra = players % services;
  return Array.from({ length: services }, (_, index) => base + (index < extra ? 1 : 0));
}

// LES PISTES FACTUREES NE SONT PAS LES PISTES OCCUPEES.
//
// La grille du bowling se paie a la piste et a la duree. Un groupe scinde
// n occupe jamais les pistes de ses deux moities en meme temps (six pistes,
// deux fois), mais il consomme bien deux fois le creneau : il paie donc la
// somme des pistes de chaque service. Deux fonctions, deux intentions :
// getRequiredLaneCount dit ce qu il faut RESERVER a un instant donne, et le
// confondre avec la facture ferait demander douze pistes a un centre qui en a
// huit.
//
// LE LEVIER COMMERCIAL EST CETTE SOMME. Facturer le second service a moitie,
// ou pas du tout, se decide sur cette seule ligne.
function getBilledLaneCount(type, pax, formuleId, bowlingConfig) {
  if (!reservationNeedsLanes(type, formuleId)) return 0;
  return splitGroupIntoBowlingServices(pax, bowlingConfig)
    .reduce((total, joueurs) => total + getRequiredLaneCount(type, joueurs, formuleId, bowlingConfig), 0);
}

function getRequiredLaneCount(type, pax, formuleId, bowlingConfig) {
  if (!reservationNeedsLanes(type, formuleId)) return 0;
  const { laneCount, normalCapacityPerLane, emergencyCapacityPerLane } = resolveBowlingCapacity(bowlingConfig);
  const players = Number(pax) || 1;
  // Nombre de pistes = joueurs / capacite confort par piste (arrondi au sup).
  // Ex : 11 joueurs, 6 confort/piste => 2 pistes. Le seul assouplissement est le
  // repli sur la capacite de secours quand le confort deborderait le parc.
  // (forceExtraLaneAtPax RETIRE : il ajoutait une piste de confort au-dela d'un
  // seuil, ce qui donnait 3 pistes pour 11 joueurs et ne correspondait pas a la
  // capacite reglee par le centre.)
  const normal = Math.ceil(players / normalCapacityPerLane);
  let required = normal;
  if (normal > laneCount && players <= laneCount * emergencyCapacityPerLane) required = laneCount;
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
// L'empreinte de formule_overrides a la derniere lecture (lib/cache-empreintes).
let formuleOverridesEmpreinte = null;

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
    humanValidation: pick('humanValidation'),
  };
}

// Rafraichit la carte depuis la base (fail-soft, TTL 30 s). A appeler au bord
// des API (public-booking-meta, public-reservations) : la carte reste chaude,
// getBasePrice/getEffectiveFormules restent synchrones.
//
// Dans le delai, la carte n'est gardee que si l'empreinte des surcharges n'a
// pas bouge (lib/cache-empreintes) : un prix change dans la console est servi
// tout de suite par le tunnel, au lieu de 30 s plus tard. Require paresseux,
// comme les autres de ce fichier.
async function refreshFormuleOverrides(pool, { force = false } = {}) {
  const now = Date.now();
  const { empreinteDe } = require('./cache-empreintes');
  if (!force && now - formuleOverridesLoadedAt < 30000) {
    const empreinte = await empreinteDe(pool, 'surcharges');
    if (!empreinte || empreinte === formuleOverridesEmpreinte) return;
  }
  // Lue AVANT les donnees ; posee meme si la lecture echoue, pour qu une panne
  // attende le delai ou une ecriture au lieu de se relire a chaque appel.
  formuleOverridesEmpreinte = await empreinteDe(pool, 'surcharges', { frais: true });
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
// centerId FOURNI : lecture stricte dans le catalogue de l'entreprise de ce
// centre (chemin des prix et des listes). centerId ABSENT : resolution d'un id
// deja choisi, toutes portees confondues (les ids custom sont uniques a
// l'echelle de la plateforme). Sans cette distinction, une formule custom d'un
// client serait jugee sur le socle par les appelants qui n'ont pas de centre
// sous la main (reservationNeedsLanes), et son besoin en pistes tomberait a
// faux.
function catalogBookingFormule(formuleId, centerId) {
  try {
    const store = require('./catalog-store');
    const found = centerId
      ? store.getBookingFormule(formuleId, centerId)
      : store.resolveBookingFormuleAnyScope(formuleId);
    if (found) return found;
    // FIX no-resurrect : une formule CONNUE du store mais desactivee
    // (active=false) ne doit pas ressusciter par la constante FORMULES. Le
    // fallback socle n'est legitime que pour un id INCONNU du store (store vide
    // au demarrage a froid, ou id jamais entre en base).
    if (centerId ? store.isFormulaKnown(formuleId, centerId) : store.isFormulaKnownAnyScope(formuleId)) return null;
  } catch (error) {
    // Fallback socle ci-dessous.
  }
  return FORMULES.find((item) => item.id === formuleId) || null;
}

// ---- UNE LISTE VIDE EST UNE REPONSE, PAS UNE PANNE -------------------------
//
// Cette fonction repliait sur FORMULES des que le catalogue rendait une liste
// VIDE. Or vide veut dire « ce centre ne vend aucune formule », et le socle
// FICHIER, ce sont les 14 formules de Fun Galaxy : un centre sans catalogue se
// voyait donc servir celui du premier client. Mesure en production le
// 2026-08-21, code deja deploye : mi12 servait 14 formules alors que son
// catalogue est vide.
//
// Le repli fichier ne vaut plus que pour une PANNE (catalog-store injoignable),
// et seulement pour les centres du socle. Pour un autre centre, la bonne
// reponse a une panne est « rien » : une liste vide se corrige a la seconde
// suivante, un catalogue etranger se vend au telephone.
const SEED_CENTER_IDS = new Set(
  ((require('../ops-knowledge/centers.json').centers) || []).map((center) => String(center.id)),
);

function catalogBookingList(centerId) {
  try {
    const list = require('./catalog-store').listBookingFormules(centerId);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return SEED_CENTER_IDS.has(String(centerId || '')) || !centerId ? FORMULES : [];
  }
}

// LE LASER SE JOUE A DEUX AU MOINS (Movsar, 2026-09-28 : « laser game, 1 pas
// possible faut etre deux minimum » ; fungalaxy.be : « de 2 a 30 personnes »).
// Le minimum est une donnee de l ACTIVITE (booking.minPax au catalogue). Une
// formule qui LANCE sa partie de laser pour le groupe en herite : HAPPY LASER
// AND GAME et FUN FRIDAY MADNESS se vendaient des 1 personne. Une formule a
// fenetre ouverte (MATIN MALIN) n en lance aucune : ses parties se placent sur
// place avec l equipe (getFormulaAnchorModel), elle garde son minimum.
// `formule` : l objet du tunnel (sans etapes) ou le document de formule.
function formuleMinPaxDetail(formule, centerId) {
  const propre = Math.max(1, Math.trunc(Number(formule && formule.minPax) || 1));
  let laser = 0;
  try {
    const store = require('./catalog-store');
    const doc = formule && Array.isArray(formule.steps)
      ? formule
      : store.getFormulaDoc(formule && formule.id, centerId || undefined);
    const lanceSaPartie = Boolean(doc) && doc.orderPolicy !== 'open_window'
      && Array.isArray(doc.steps) && doc.steps.some((step) => step && step.activityId === 'laser_game');
    if (lanceSaPartie) laser = require('./activity-catalog').activityMinPax(centerId, 'laser_game');
  } catch (error) {
    laser = 0;
  }
  // Une formule deja servie par getEffectiveFormules porte le minimum releve :
  // `minPaxLaser` garde la raison.
  const dejaReleve = Boolean(formule && formule.minPaxLaser === true && laser >= propre);
  return { minPax: Math.max(propre, laser), parLeLaser: laser > propre || dejaReleve };
}

// Liste des formules avec overrides appliques (prix, ancien prix, nom) et les
// formules retirees exclues, pour l'affichage du tunnel (public-booking-meta).
// Le minimum servi est celui qui s applique (formuleMinPaxDetail) : les deux
// tunnels, la console et l agent le lisent ici, aucun ne le recalcule.
// `comptoir` : avec les formules gardees au comptoir sans etre affichees aux clients. Par defaut
// elles sont dehors : le formulaire, la disponibilite publique et l agent lisent cette liste.
function getEffectiveFormules(centerId, { comptoir = false } = {}) {
  const out = [];
  for (const formule of catalogBookingList(centerId)) {
    if (formule.comptoirSeul && !comptoir) continue;
    const ov = resolveFormuleOverride(formule.id, centerId);
    if (ov && (ov.removed || ov.enabled === false)) continue;
    const servie = ov
      ? {
        ...formule,
        price: ov.priceValue != null ? ov.priceValue : formule.price,
        oldPrice: ov.priceOld != null ? ov.priceOld : formule.oldPrice,
        name: ov.name != null ? ov.name : formule.name,
      }
      : formule;
    const minimum = formuleMinPaxDetail(servie, centerId);
    const avecMinimum = minimum.parLeLaser ? { ...servie, minPax: minimum.minPax, minPaxLaser: true } : servie;
    const enfants = formuleEnfants(avecMinimum);
    out.push(enfants ? { ...avecMinimum, kidsOnly: enfants } : avecMinimum);
  }
  return out;
}

// UNE OFFRE RESERVEE AUX ENFANTS, dans les mots du centre : sa description dit
// « pour les enfants de 5 a 12 ans » (Kids Fun Day). Le formulaire demande
// alors combien d enfants et d adultes accompagnants viennent, et seuls les
// enfants paient (Movsar, 2026-09-28 : « demander enfants / adultes ; seuls
// les enfants paient la formule »). Rien d ecrit en dur : le centre retire la
// phrase de sa description, la question disparait avec elle.
function formuleEnfants(formule) {
  const lignes = [].concat((formule && formule.desc) || [], (formule && formule.notes) || []);
  for (const ligne of lignes) {
    const trouve = /pour (?:les )?enfants de (\d{1,2}) (?:à|a) (\d{1,2}) ans/i.exec(String(ligne || ''));
    if (trouve && Number(trouve[1]) < Number(trouve[2])) return { ageMin: Number(trouve[1]), ageMax: Number(trouve[2]) };
  }
  return null;
}

// Le tarif bowling DU CENTRE, ou null quand il vend a la grille historique.
function resolveBowlingPricing(bowlingConfig) {
  const pricing = bowlingConfig && typeof bowlingConfig === 'object' ? bowlingConfig.pricing : null;
  if (!pricing || typeof pricing !== 'object') return null;
  if (pricing.mode !== 'per_game_per_person') return null;
  if (!Array.isArray(pricing.tiers) || !pricing.tiers.length) return null;
  return pricing;
}

// Les PARTIES vendables un jour donne, dans la forme deja utilisee pour le
// laser (games / value / label / price / durationMinutes). `value` est la duree
// en HEURES : c'est l'axe que le tunnel, le moteur et l'allocation de pistes
// utilisent depuis toujours, donc rien d'autre ne change de forme.
//   null = ce centre vend a la grille (comportement historique).
//   []   = ce centre vend aux parties, mais AUCUN tarif ne couvre ce jour.
//
// context.pax / context.laneCount : necessaires quand le centre compte la duree
// EN MINUTES PAR JOUEUR. Une partie dure ce que mettent les joueurs a lancer
// chacun leur tour, et deux pistes jouent EN PARALLELE : c'est donc la piste la
// plus chargee qui donne la duree, jamais le groupe entier.
function bowlingGameMinutes(pricing, { pax = 1, laneCount = 1 } = {}, games = 1) {
  const perPlayer = Number(pricing.minutesPerPlayerPerGame) || 0;
  if (perPlayer <= 0) return games * (Number(pricing.minutesPerGame) || 60);
  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const lanes = Math.max(1, Math.trunc(Number(laneCount) || 1));
  const playersPerLane = Math.ceil(players / lanes);
  const raw = games * perPlayer * playersPerLane;
  // Les creneaux tombent sur les demies : on arrondit AU-DESSUS, jamais en
  // dessous. Une piste rendue trop tot, c'est un groupe pousse dehors.
  const rounded = Math.ceil(raw / 30) * 30;
  return Math.min(480, Math.max(30, rounded));
}

function getBowlingGameOptions(bowlingConfig, dateStr, context = {}) {
  const pricing = resolveBowlingPricing(bowlingConfig);
  if (!pricing) return null;
  if (!dateStr) return [];
  const day = parseLocalDate(dateStr).getDay();
  const tier = pricing.tiers.find((item) => Array.isArray(item.days) && item.days.includes(day));
  if (!tier) return [];
  return tier.prices.map((price, index) => {
    const games = index + 1;
    const durationMinutes = bowlingGameMinutes(pricing, context, games);
    return {
      games,
      value: Math.round((durationMinutes / 60) * 100) / 100,
      label: games === 1 ? '1 partie' : `${games} parties`,
      price: Number(price),
      durationMinutes,
    };
  });
}

// options.bowlingConfig / options.dateStr : necessaires UNIQUEMENT pour un
// centre qui vend aux parties. Sans eux, un tel centre rend 0 plutot qu'un prix
// de grille qui ne le concerne pas : un zero se voit, un mauvais prix se
// facture.
// options.auPalier : AU-DELA DE LA GRILLE, LE PALIER PUIS L UNITE (comptoir
// seulement, lib/prix-palier.js). 4 parties de laser retombaient sur le prix
// d UNE partie et 2 h 30 de bowling valaient 0 EUR : deux prix faux qui se
// facturent. Sans l option, tout reste au centime pres comme avant : le tunnel
// public refuse ces durees parce qu elles valent 0 EUR.
// 9,90 × 3 ne fait pas 29,70 en virgule flottante : un montant se pose au centime.
function auCentime(montant) { return Math.round(montant * 100) / 100; }

function getBasePrice(type, duration, laneCount, pax, formuleId, centerId, options = {}) {
  if (type === 'bowling') {
    const gameOptions = getBowlingGameOptions(options.bowlingConfig, options.dateStr, { pax, laneCount });
    if (gameOptions) {
      const chosen = gameOptions.find((item) => Number(item.value) === Number(duration));
      return chosen ? auCentime(chosen.price * pax) : 0;
    }
    const grille = grillesDuCentre(centerId).bowlingPrices;
    const prixGrille = grille[duration] || 0;
    if (prixGrille || !options.auPalier) return auCentime(prixGrille * laneCount);
    return auCentime((prixBowlingAuPalier(grille, duration) || 0) * laneCount);
  }
  if (type === 'laser') {
    const grille = grillesDuCentre(centerId).laserOptions;
    const exacte = grille.find((item) => Number(item.value) === Number(duration));
    const option = exacte
      || (options.auPalier ? optionLaserAuPalier(grille, Number(duration) * 2) : null)
      || grille[0];
    return auCentime(option.price * pax);
  }
  const formule = catalogBookingFormule(formuleId, centerId);
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
  const minimum = formuleMinPaxDetail(formule, center && center.id);
  if (pax < minimum.minPax) {
    return { ok: false, message: minimum.parLeLaser ? `Min. ${minimum.minPax} personnes : le laser game se joue à ${minimum.minPax} minimum` : `Min. ${minimum.minPax} personnes` };
  }
  if (formule.noHolidays && isFormulaBlockedDate(dateStr, center)) {
    return { ok: false, message: 'Indisponible vacances/feries' };
  }
  if (formule.validDays && !formule.validDays.includes(day)) {
    return { ok: false, message: 'Indisponible ce jour' };
  }
  if (startTime && formule.timeLimit) {
    const start = timeToNum(startTime);
    // Fenetre ouverte : seule l ARRIVEE doit tomber dans la periode, la visite
    // dure jusqu a la fin de periode quelle que soit l heure d arrivee.
    const totalDuration = getFormuleBookedDuration(formule);
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
  pourLEquipe,
  ouvertureExceptionnelle,
  BOWLING_PRICES,
  DURATION_OPTIONS,
  FUN_RUN_MAX_PAX,
  FUN_RUN_OPTIONS,
  FORMULES,
  LASER_GAME_ARENA_MINUTES,
  LASER_GAME_MAX_PLAYERS,
  LASER_GAME_OPTIONS,
  MAX_PER_LANE,
  EMERGENCY_MAX_PER_LANE,
  PAIRS,
  TOTAL_LANES,
  currentTimeDecimal,
  formuleMinPaxDetail,
  getBasePrice,
  getBowlingGameOptions,
  grillesDuCentre,
  grillesEffectives,
  prixDeGrille,
  resolveBowlingPricing,
  getEffectiveFormules,
  refreshFormuleOverrides,
  resolveFormuleOverride,
  setFormuleOverrides,
  getFormuleArrivalWindow,
  getFormuleAvailability,
  getFormuleBookedDuration,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getHolidayContext,
  getBilledLaneCount,
  getRequiredLaneCount,
  splitGroupIntoBowlingServices,
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
  // La table des conges scolaires est la SOURCE D AUTORITE du projet :
  // center-metrics la consommait en double, avec des bornes decalees de 1 a
  // 2 jours sur chaque periode. Elle sort d ici, et de nulle part ailleurs.
  BOOKING_HORIZON_DAYS,
  bookingDateOutOfRange,
  reglesDeReservation,
  bookingDateTooSoon,
  messageDateTropProche,
  messageDateTropLoin,
  WALLONIA_SCHOOL_HOLIDAYS,
  getWalloniaSchoolHolidays,
  parseOpenHolidaysSchoolEntries,
  refreshWalloniaSchoolHolidays,
  walloniaSchoolHolidayCoverage,
  __setWalloniaFetchedForTests,
  // Le calendrier du centre, pays et region (2026-11-17, D5).
  CALENDRIER_PAR_DEFAUT,
  calendrierDuCentre,
  calendrierPourLeClient,
  centresAvecCalendrier,
  codeDeCalendrier,
  etatDuCalendrier,
  getPublicHolidayFor,
  getSchoolHolidayFor,
  getSchoolHolidaysFor,
  listeDesCalendriers,
  periodesScolairesDe,
  refreshSchoolHolidays,
  refreshSchoolHolidaysFor,
  relireCalendrierHorsFederation,
  __setSchoolHolidaysForTests,
  todayStr,
};
