// Catalogue UNIFIE (source DB unique fusionnee par-dessus les fichiers socle).
//
// DOCTRINE, verrouillee par scripts/catalog-store-check.js :
//   1. LES FICHIERS RESTENT LE SOCLE. Aucune ligne en base (tables activities /
//      formulas / formula_steps de la migration 0038) = comportement STRICTEMENT
//      identique aux fichiers (ops-knowledge/formulas.json, activities.json,
//      lib/booking-config FORMULES).
//   2. APRES BACKFILL SEED (lignes = contenu des fichiers) = comportement
//      IDENTIQUE : meme prix au centime, memes verdicts de dispo, meme deep-equal
//      des docs (steps compris), meme modele d'ancrage.
//   3. FUSION. Une ligne DB pour un id PRIME sur le socle (par id). active=false
//      retire la formule/activite. source='custom' (id absent des fichiers) est
//      une entree ajoutee.
//   4. DEUX ADAPTATEURS, UNE SOURCE. getFormulaDoc rend le format
//      ops-knowledge/formulas.json ; getBookingFormule le format
//      lib/booking-config FORMULES. Les deux derivent de la MEME entree
//      canonique : c'est le coeur de l'unification.
//
// MECANIQUE DE CACHE : identique a refreshCenterOverrides (lib/ops-knowledge) et
// refreshFormuleOverrides (lib/booking-config) : cache module, TTL 30 s,
// fail-soft (sur erreur base on garde le dernier etat connu). getFormulaDoc /
// getBookingFormule / getActivityDoc restent SYNCHRONES, lus partout.
//
// CANONIQUE : time_limit en MINUTES depuis minuit (le 'HH:MM' de formulas.json
// et les heures numeriques de booking-config en derivent). description_lines =
// desc[] d'affichage de booking-config ; la DUREE vient des steps, plus du desc.
// hasBowling / bowlingDur ne sont PAS stockes : ils se derivent des steps.
//
// Les fichiers socle sont charges via require() (traces + embarques par le
// bundler Vercel), jamais fs.readFileSync (non trace -> ENOENT en prod, cf
// lib/ops-knowledge.js et lib/center-config.js).

const { FORMULES } = require('./booking-config');
const FORMULAS_DOC_FILE = require('../ops-knowledge/formulas.json');
const ACTIVITIES_FILE = require('../ops-knowledge/activities.json');

const OVERRIDE_TTL_MS = 30_000;
const DEFAULT_ACTIVITY_CENTER = 'all';

// ── Baselines (fichiers) indexes par id ─────────────────────────────────────
const BOOKING_BASE_BY_ID = new Map(FORMULES.map((formule) => [formule.id, formule]));
const DOC_BASE_BY_ID = new Map((FORMULAS_DOC_FILE.formulas || []).map((doc) => [doc.id, doc]));
// Ordre de reference des formules = l'ordre du fichier booking-config (le tunnel
// et getEffectiveFormules doivent servir les formules dans CET ordre).
const BASELINE_ORDER = FORMULES.map((formule) => formule.id);
const ACTIVITY_BASE_BY_ID = new Map((ACTIVITIES_FILE.activities || []).map((activity) => [activity.id, activity]));

// ── Conversions temporelles ─────────────────────────────────────────────────
function hhmmToMinutes(value) {
  if (value == null) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function minutesToHhmm(value) {
  const total = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function hoursToMinutes(value) {
  return value == null ? null : Math.round(Number(value) * 60);
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value) {
  const parsed = numOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

// ── Normalisation des lignes DB (types pg -> objet applicatif stable) ────────
function normalizeFormulaRow(row) {
  return {
    id: row.id,
    name: row.name == null ? null : String(row.name),
    family: row.family == null ? null : String(row.family),
    minPax: intOrNull(row.min_pax),
    priceType: row.price_type == null ? null : String(row.price_type),
    priceValue: numOrNull(row.price_value),
    priceOld: numOrNull(row.price_old),
    notDuringHolidays: Boolean(row.not_during_holidays),
    validDays: Array.isArray(row.valid_days) ? row.valid_days.map(Number) : null,
    timeLimitMin: intOrNull(row.time_limit_min_minutes),
    timeLimitMax: intOrNull(row.time_limit_max_minutes),
    humanValidation: row.human_validation == null ? null : String(row.human_validation),
    orderPolicy: row.order_policy == null ? null : String(row.order_policy),
    isBirthdayFormula: Boolean(row.is_birthday_formula),
    best: Boolean(row.best),
    descriptionLines: Array.isArray(row.description_lines) ? row.description_lines.map(String) : [],
    sortIndex: intOrNull(row.sort_index),
    source: row.source === 'custom' ? 'custom' : 'seed',
    active: row.active === undefined || row.active === null ? true : Boolean(row.active),
  };
}

function normalizeStepRow(row) {
  return {
    formulaId: row.formula_id,
    position: intOrNull(row.position),
    activityId: row.activity_id == null ? null : String(row.activity_id),
    count: row.count == null ? 1 : Math.trunc(Number(row.count)),
    durationMinutes: intOrNull(row.duration_minutes),
    label: row.label == null ? null : String(row.label),
    critical: Boolean(row.critical),
    resourceType: row.resource_type == null ? null : String(row.resource_type),
  };
}

function normalizeActivityRow(row) {
  return {
    id: row.id,
    centerId: row.center_id == null ? DEFAULT_ACTIVITY_CENTER : String(row.center_id),
    name: row.name == null ? null : String(row.name),
    resourceType: row.resource_type == null ? null : String(row.resource_type),
    durationModel: row.duration_model == null ? null : row.duration_model,
    serviceModel: row.service_model == null ? null : row.service_model,
    riskDrivers: Array.isArray(row.risk_drivers) ? row.risk_drivers.map(String) : null,
    planningPressure: row.planning_pressure == null ? null : String(row.planning_pressure),
    source: row.source === 'custom' ? 'custom' : 'seed',
    active: row.active === undefined || row.active === null ? true : Boolean(row.active),
  };
}

// ── Steps -> forme canonique (une seule representation interne) ──────────────
function canonicalStepFromDoc(step) {
  return {
    activityId: step.activityId == null ? null : String(step.activityId),
    count: step.count == null ? 1 : Math.trunc(Number(step.count)),
    durationMinutes: step.durationMinutes == null ? null : Math.trunc(Number(step.durationMinutes)),
    label: step.label == null ? null : String(step.label),
    critical: step.critical === true,
    resourceType: step.resourceType == null ? null : String(step.resourceType),
  };
}

function canonicalStepFromDbRow(row) {
  return {
    activityId: row.activityId,
    count: row.count == null ? 1 : Math.trunc(Number(row.count)),
    durationMinutes: row.durationMinutes,
    label: row.label,
    critical: row.critical === true,
    resourceType: row.resourceType,
  };
}

// ── Construction de l'entree CANONIQUE (socle fusionne avec la ligne DB) ─────
// Une ligne DB (dbRow) PRIME sur le socle par champ ; les extras propres au
// format booking (notes, estimatedTotalDuration, famille libelle) ne sont PAS en
// base : ils viennent du socle booking, ou sont derives pour une formule custom.
function buildCanonicalFormula({ id, bookingBase, docBase, dbRow, dbSteps }) {
  const hasDb = Boolean(dbRow);

  const docFamily = hasDb ? dbRow.family : (docBase ? docBase.family : null);
  const isBirthday = hasDb
    ? dbRow.isBirthdayFormula
    : /anniversaire/i.test((bookingBase && bookingBase.family) || '');
  const bookingFamily = bookingBase
    ? bookingBase.family
    : (isBirthday ? 'Formules anniversaires' : 'Formules speciales');

  const priceType = hasDb
    ? dbRow.priceType
    : (bookingBase ? bookingBase.type : (docBase && docBase.price ? docBase.price.type : null));
  const priceValue = hasDb
    ? dbRow.priceValue
    : (docBase && docBase.price ? Number(docBase.price.value) : (bookingBase ? Number(bookingBase.price) : 0));
  const priceOld = hasDb
    ? dbRow.priceOld
    : (docBase && docBase.price && docBase.price.oldValue != null
      ? Number(docBase.price.oldValue)
      : (bookingBase && bookingBase.oldPrice != null ? Number(bookingBase.oldPrice) : null));

  let timeLimitMin = null;
  let timeLimitMax = null;
  if (hasDb) {
    timeLimitMin = dbRow.timeLimitMin;
    timeLimitMax = dbRow.timeLimitMax;
  } else if (docBase && docBase.timeLimit) {
    timeLimitMin = docBase.timeLimit.min != null ? hhmmToMinutes(docBase.timeLimit.min) : null;
    timeLimitMax = docBase.timeLimit.max != null ? hhmmToMinutes(docBase.timeLimit.max) : null;
  } else if (bookingBase && bookingBase.timeLimit) {
    timeLimitMin = bookingBase.timeLimit.min != null ? hoursToMinutes(bookingBase.timeLimit.min) : null;
    timeLimitMax = bookingBase.timeLimit.max != null ? hoursToMinutes(bookingBase.timeLimit.max) : null;
  }

  const validDaysRaw = hasDb
    ? dbRow.validDays
    : (docBase && Array.isArray(docBase.validDays)
      ? docBase.validDays
      : (bookingBase && Array.isArray(bookingBase.validDays) ? bookingBase.validDays : null));
  const validDays = Array.isArray(validDaysRaw) && validDaysRaw.length ? validDaysRaw.map(Number) : null;

  let steps;
  if (hasDb && Array.isArray(dbSteps) && dbSteps.length) {
    steps = dbSteps.slice().sort((a, b) => Number(a.position) - Number(b.position)).map(canonicalStepFromDbRow);
  } else if (docBase && Array.isArray(docBase.steps)) {
    steps = docBase.steps.map(canonicalStepFromDoc);
  } else {
    steps = [];
  }

  return {
    id,
    source: hasDb ? dbRow.source : 'seed',
    active: hasDb ? dbRow.active : true,
    sortIndex: hasDb ? dbRow.sortIndex : null,
    name: hasDb ? dbRow.name : (docBase ? docBase.name : (bookingBase ? bookingBase.name : id)),
    docFamily,
    bookingFamily,
    isBirthday,
    minPax: hasDb ? dbRow.minPax : (docBase ? docBase.minPax : (bookingBase ? bookingBase.minPax : 1)),
    priceType,
    priceValue,
    priceOld,
    notDuringHolidays: hasDb
      ? dbRow.notDuringHolidays
      : (docBase ? docBase.notDuringHolidays === true : (bookingBase ? bookingBase.noHolidays === true : false)),
    validDays,
    timeLimitMin,
    timeLimitMax,
    orderPolicy: hasDb ? dbRow.orderPolicy : (docBase ? (docBase.orderPolicy == null ? null : docBase.orderPolicy) : null),
    humanValidation: hasDb ? dbRow.humanValidation : (docBase ? (docBase.humanValidation == null ? null : docBase.humanValidation) : null),
    best: hasDb ? dbRow.best : (bookingBase ? bookingBase.best === true : false),
    // description_lines vient de la DB si presente, sinon du desc[] booking.
    descriptionLines: hasDb ? dbRow.descriptionLines.slice() : (bookingBase && Array.isArray(bookingBase.desc) ? bookingBase.desc.slice() : []),
    // Extras PROPRES au format booking, jamais stockes en base : socle uniquement.
    notes: bookingBase && Array.isArray(bookingBase.notes) ? bookingBase.notes.slice() : [],
    estimatedTotalDuration: bookingBase && bookingBase.estimatedTotalDuration != null ? bookingBase.estimatedTotalDuration : null,
    steps,
  };
}

function buildCanonicalActivity({ id, centerId, base, dbRow }) {
  const hasDb = Boolean(dbRow);
  return {
    id,
    centerId,
    source: hasDb ? dbRow.source : 'seed',
    active: hasDb ? dbRow.active : true,
    name: hasDb ? dbRow.name : (base ? base.name : null),
    resourceType: hasDb ? dbRow.resourceType : (base ? base.resourceType : null),
    durationModel: hasDb ? dbRow.durationModel : (base ? base.durationModel : null),
    serviceModel: hasDb ? dbRow.serviceModel : (base ? base.serviceModel : null),
    riskDrivers: hasDb ? dbRow.riskDrivers : (base && Array.isArray(base.riskDrivers) ? base.riskDrivers : null),
    planningPressure: hasDb
      ? dbRow.planningPressure
      : (base && base.planningPressure != null ? base.planningPressure : null),
  };
}

// ── Reconstruction des DEUX formats depuis l'entree canonique ────────────────
// getFormulaDoc : format ops-knowledge/formulas.json (steps compris). Regle
// d'or : ne poser un champ optionnel QUE s'il est present dans le fichier
// d'origine (deep-equal exact avec getFormula d'avant le refactor).
function formulaDocFromCanonical(canonical) {
  const doc = {
    id: canonical.id,
    name: canonical.name,
    family: canonical.docFamily,
    minPax: canonical.minPax,
  };
  doc.price = { type: canonical.priceType, value: canonical.priceValue };
  if (canonical.priceOld != null) doc.price.oldValue = canonical.priceOld;
  if (canonical.notDuringHolidays) doc.notDuringHolidays = true;
  if (canonical.validDays && canonical.validDays.length) doc.validDays = canonical.validDays.slice();
  if (canonical.timeLimitMin != null || canonical.timeLimitMax != null) {
    doc.timeLimit = {};
    if (canonical.timeLimitMin != null) doc.timeLimit.min = minutesToHhmm(canonical.timeLimitMin);
    if (canonical.timeLimitMax != null) doc.timeLimit.max = minutesToHhmm(canonical.timeLimitMax);
  }
  if (canonical.orderPolicy != null) doc.orderPolicy = canonical.orderPolicy;
  if (canonical.humanValidation != null) doc.humanValidation = canonical.humanValidation;
  doc.steps = canonical.steps.map((step) => {
    const out = { activityId: step.activityId, count: step.count };
    if (step.durationMinutes != null) out.durationMinutes = step.durationMinutes;
    if (step.label != null) out.label = step.label;
    if (step.critical) out.critical = true;
    if (step.resourceType != null) out.resourceType = step.resourceType;
    return out;
  });
  return doc;
}

// getBookingFormule : format lib/booking-config FORMULES. hasBowling / bowlingDur
// DERIVES des steps. timeLimit en heures numeriques. noHolidays TOUJOURS present
// (le socle booking le porte sur chaque formule, contrairement a formulas.json).
function bookingFromCanonical(canonical) {
  const formule = {
    id: canonical.id,
    name: canonical.name,
    family: canonical.bookingFamily,
    desc: canonical.descriptionLines.slice(),
    price: canonical.priceValue,
    type: canonical.priceType,
    minPax: canonical.minPax,
  };
  if (canonical.priceOld != null) formule.oldPrice = canonical.priceOld;
  if (canonical.validDays && canonical.validDays.length) formule.validDays = canonical.validDays.slice();
  if (canonical.timeLimitMin != null || canonical.timeLimitMax != null) {
    formule.timeLimit = {};
    if (canonical.timeLimitMin != null) formule.timeLimit.min = canonical.timeLimitMin / 60;
    if (canonical.timeLimitMax != null) formule.timeLimit.max = canonical.timeLimitMax / 60;
  }
  formule.noHolidays = Boolean(canonical.notDuringHolidays);
  const bowling = canonical.steps.find((step) => step.activityId === 'bowling');
  formule.hasBowling = Boolean(bowling);
  if (bowling) formule.bowlingDur = bowling.durationMinutes != null ? bowling.durationMinutes / 60 : 1;
  if (canonical.best) formule.best = true;
  formule.notes = canonical.notes.slice();
  if (canonical.estimatedTotalDuration != null) formule.estimatedTotalDuration = canonical.estimatedTotalDuration;
  return formule;
}

function activityDocFromCanonical(canonical) {
  const doc = {
    id: canonical.id,
    name: canonical.name,
    resourceType: canonical.resourceType,
    durationModel: canonical.durationModel,
    serviceModel: canonical.serviceModel,
    riskDrivers: canonical.riskDrivers,
  };
  if (canonical.planningPressure != null) doc.planningPressure = canonical.planningPressure;
  return doc;
}

// ── Cache module ─────────────────────────────────────────────────────────────
let dbState = { formulas: [], steps: [], activities: [] };
let merged = null;
let lastLoadedAt = 0;

function rebuildMerged() {
  const dbFormulaById = new Map(dbState.formulas.map((row) => [row.id, row]));
  const dbStepsByFormula = new Map();
  for (const step of dbState.steps) {
    if (!dbStepsByFormula.has(step.formulaId)) dbStepsByFormula.set(step.formulaId, []);
    dbStepsByFormula.get(step.formulaId).push(step);
  }
  const dbActivityByKey = new Map(dbState.activities.map((row) => [`${row.id}|${row.centerId}`, row]));

  // Ordre : socle d'abord (ordre fichier), puis les formules custom (par
  // sort_index puis id) qui n'existent pas dans le socle.
  const orderedIds = [...BASELINE_ORDER];
  const customIds = dbState.formulas
    .filter((row) => !BOOKING_BASE_BY_ID.has(row.id) && !DOC_BASE_BY_ID.has(row.id))
    .sort((a, b) => {
      const sa = a.sortIndex == null ? Number.MAX_SAFE_INTEGER : a.sortIndex;
      const sb = b.sortIndex == null ? Number.MAX_SAFE_INTEGER : b.sortIndex;
      return sa - sb || (a.id < b.id ? -1 : 1);
    })
    .map((row) => row.id);
  for (const id of customIds) if (!orderedIds.includes(id)) orderedIds.push(id);

  const formulaDocById = new Map();
  const bookingFormuleById = new Map();
  const bookingList = [];

  for (const id of orderedIds) {
    const dbRow = dbFormulaById.get(id) || null;
    // active=false = retiree ; SANS ligne DB, on garde le socle (rien ne change).
    if (dbRow && dbRow.active === false) continue;
    const canonical = buildCanonicalFormula({
      id,
      bookingBase: BOOKING_BASE_BY_ID.get(id) || null,
      docBase: DOC_BASE_BY_ID.get(id) || null,
      dbRow,
      dbSteps: dbStepsByFormula.get(id) || null,
    });
    const doc = formulaDocFromCanonical(canonical);
    const booking = bookingFromCanonical(canonical);
    formulaDocById.set(id, doc);
    bookingFormuleById.set(id, booking);
    bookingList.push(booking);
  }

  // Activites : socle (center 'all') plus lignes DB. Une cle (id, centerId).
  const activityDocByKey = new Map();
  const activityIds = new Set([
    ...ACTIVITY_BASE_BY_ID.keys(),
    ...dbState.activities.map((row) => row.id),
  ]);
  for (const id of activityIds) {
    const base = ACTIVITY_BASE_BY_ID.get(id) || null;
    // Socle 'all' toujours disponible si aucune ligne DB ne le retire.
    const centers = new Set([DEFAULT_ACTIVITY_CENTER]);
    for (const row of dbState.activities) if (row.id === id) centers.add(row.centerId);
    for (const centerId of centers) {
      const dbRow = dbActivityByKey.get(`${id}|${centerId}`) || null;
      if (dbRow && dbRow.active === false) continue;
      if (!dbRow && !base && centerId === DEFAULT_ACTIVITY_CENTER) continue;
      if (!dbRow && centerId !== DEFAULT_ACTIVITY_CENTER) continue;
      const canonical = buildCanonicalActivity({ id, centerId, base, dbRow });
      activityDocByKey.set(`${id}|${centerId}`, activityDocFromCanonical(canonical));
    }
  }

  merged = { formulaDocById, bookingFormuleById, bookingList, activityDocByKey };
}

// Applique un etat DB (les 3 tables) et reconstruit le catalogue fusionne.
// Passer un etat vide restaure le socle. Testable directement (comme
// applyCenterOverrides dans lib/ops-knowledge).
function applyCatalogState(state = {}) {
  dbState = {
    formulas: Array.isArray(state.formulas) ? state.formulas.map(normalizeFormulaRow) : [],
    steps: Array.isArray(state.steps) ? state.steps.map(normalizeStepRow) : [],
    activities: Array.isArray(state.activities) ? state.activities.map(normalizeActivityRow) : [],
  };
  rebuildMerged();
  return merged;
}

async function loadCatalogState(pool) {
  const formulas = await pool.query(
    `select id, name, family, min_pax, price_type, price_value, price_old,
            not_during_holidays, valid_days, time_limit_min_minutes, time_limit_max_minutes,
            human_validation, order_policy, is_birthday_formula, best, description_lines,
            sort_index, source, active
     from formulas;`,
  );
  const steps = await pool.query(
    `select formula_id, position, activity_id, count, duration_minutes, label, critical, resource_type
     from formula_steps
     order by formula_id, position;`,
  );
  const activities = await pool.query(
    `select id, center_id, name, resource_type, duration_model, service_model,
            risk_drivers, planning_pressure, source, active
     from activities;`,
  );
  return {
    formulas: formulas.rows || [],
    steps: steps.rows || [],
    activities: activities.rows || [],
  };
}

// Rafraichit le cache depuis la base (fail-soft, TTL 30 s). Meme mecanique que
// refreshCenterOverrides : sur erreur base on garde le dernier etat connu, le
// timestamp est pose avant la lecture pour throttler meme en cas d'echec.
async function refreshCatalog(pool, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastLoadedAt < OVERRIDE_TTL_MS) return false;
  lastLoadedAt = now;
  try {
    const state = await loadCatalogState(pool);
    applyCatalogState(state);
    return true;
  } catch (error) {
    // On garde le dernier etat connu (socle ou dernier chargement DB) : un
    // incident base ne doit pas changer le catalogue de facon impredictible.
    return false;
  }
}

// ── Adaptateurs SYNCHRONES (lus partout) ─────────────────────────────────────
function ensureMerged() {
  if (!merged) rebuildMerged();
  return merged;
}

// Format ops-knowledge/formulas.json. null si formule inconnue/retiree (le
// caller retombe alors sur le fichier, cf lib/ops-knowledge getFormula).
function getFormulaDoc(id) {
  return ensureMerged().formulaDocById.get(id) || null;
}

// Format lib/booking-config FORMULES.
function getBookingFormule(id) {
  return ensureMerged().bookingFormuleById.get(id) || null;
}

// Liste des formules actives au format booking, dans l'ordre du socle.
function listBookingFormules() {
  return ensureMerged().bookingList.slice();
}

// Format ops-knowledge/activities.json. Prefere la ligne du centre, sinon 'all',
// sinon le socle. null si activite inconnue/retiree.
function getActivityDoc(id, centerId = DEFAULT_ACTIVITY_CENTER) {
  const store = ensureMerged();
  if (centerId && centerId !== DEFAULT_ACTIVITY_CENTER) {
    const own = store.activityDocByKey.get(`${id}|${centerId}`);
    if (own) return own;
  }
  return store.activityDocByKey.get(`${id}|${DEFAULT_ACTIVITY_CENTER}`) || null;
}

// Initialisation depuis le socle des le chargement du module (comme
// DEFAULT_CENTER_CONFIG_BY_ID dans lib/center-config) : le store est utilisable
// avant tout refreshCatalog, avec le comportement fichier.
applyCatalogState({});

module.exports = {
  refreshCatalog,
  applyCatalogState,
  loadCatalogState,
  getFormulaDoc,
  getBookingFormule,
  listBookingFormules,
  getActivityDoc,
};
