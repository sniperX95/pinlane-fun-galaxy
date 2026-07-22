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

  // dbFormulaIds : l'ensemble des ids qui portent une LIGNE en base (active ou
  // non). C'est ce qui distingue "id inconnu" (aucune ligne -> fallback fichier
  // legitime) de "id connu mais desactive" (ligne active=false -> retiree pour
  // de vrai, jamais de resurrection par le fichier). Lu par isFormulaKnown.
  const dbFormulaIds = new Set(dbState.formulas.map((row) => row.id));

  merged = { formulaDocById, bookingFormuleById, bookingList, activityDocByKey, dbFormulaIds };
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

// L'id porte-t-il une LIGNE en base (active OU desactivee) ? C'est le signal du
// fix "no-resurrect" (residuel 2a n1) : un caller (lib/ops-knowledge getFormula,
// lib/booking-config catalogBookingFormule) ne retombe sur le FICHIER que si l'id
// est INCONNU du store (aucune ligne). Un id CONNU mais desactive (getFormulaDoc
// rend null ET isFormulaKnown rend true) est retire pour de vrai, sans fallback.
function isFormulaKnown(id) {
  return ensureMerged().dbFormulaIds.has(id);
}

// Une activite (par id, tous centres confondus) est-elle presente dans le
// catalogue effectif ? Sert a valider un step : un activityId doit exister dans
// le catalogue activites OU porter un resourceType explicite (pseudo-activites
// service_drinks / arcade_credit, absentes du catalogue mais typees a la main).
function isActivityKnown(activityId) {
  const store = ensureMerged();
  const id = String(activityId || '');
  for (const key of store.activityDocByKey.keys()) {
    const sep = key.indexOf('|');
    if (sep !== -1 && key.slice(0, sep) === id) return true;
  }
  return false;
}

// Initialisation depuis le socle des le chargement du module (comme
// DEFAULT_CENTER_CONFIG_BY_ID dans lib/center-config) : le store est utilisable
// avant tout refreshCatalog, avec le comportement fichier.
applyCatalogState({});

// ─────────────────────────────────────────────────────────────────────────────
// CRUD DU CATALOGUE DB (phase 2b-1). Ecritures BORNEES + validees, exportees.
//
// DOCTRINE preservee : ces fonctions n'ecrivent QUE dans les 3 tables (formulas
// / formula_steps / activities). Sans ecriture, le socle fichier reste la
// verite (scripts/catalog-store-check.js). Toute ecriture rafraichit le cache
// (refreshCatalog force) pour que les adaptateurs synchrones voient l'etat neuf.
//
// SCOPE (assume, documente) : les formulas sont GLOBALES (pas de center_id). Ce
// CRUD edite donc le catalogue PARTAGE (owner + client agissent dessus). Le
// scoping per-centre des formules custom est un raffinement ulterieur, HORS
// phase. Les ACTIVITES portent deja un center_id (defaut 'all').
// ─────────────────────────────────────────────────────────────────────────────

const FORMULA_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const NAME_MAX = 120;
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

function exposeError(message) {
  const error = new Error(message);
  error.expose = true; // message metier sur, montrable au client (comme catalog-overrides)
  return error;
}

function toBool(value) {
  return value === true || value === 'true';
}

function validateName(value, required) {
  if (value === null || value === undefined || value === '') {
    if (required) throw exposeError('Nom requis.');
    return null;
  }
  const name = String(value).trim();
  if (!name) {
    if (required) throw exposeError('Nom requis.');
    return null;
  }
  if (name.length > NAME_MAX) throw exposeError(`Nom trop long (max ${NAME_MAX} caracteres).`);
  return name;
}

function validateFamily(value) {
  if (value === null || value === undefined || value === '') return 'Formules speciales';
  const family = String(value).trim();
  if (family.length > NAME_MAX) throw exposeError(`Famille trop longue (max ${NAME_MAX} caracteres).`);
  return family;
}

function validateMinPax(value) {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) throw exposeError('minPax invalide (entier >= 1).');
  return parsed;
}

function validatePriceType(value) {
  const type = String(value == null ? '' : value).trim();
  if (type !== 'per_pax' && type !== 'per_lane') throw exposeError('priceType invalide (per_pax ou per_lane).');
  return type;
}

function validatePrice(value, label, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw exposeError(`${label} requis.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < PRICE_MIN || parsed > PRICE_MAX) {
    throw exposeError(`${label} hors bornes (attendu ${PRICE_MIN} a ${PRICE_MAX}).`);
  }
  return Math.round(parsed * 100) / 100;
}

function validateValidDays(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Array.isArray(value)) throw exposeError('validDays doit etre une liste de jours (0..6).');
  const days = value.map((day) => Math.trunc(Number(day)));
  for (const day of days) {
    if (!Number.isFinite(day) || day < 0 || day > 6) throw exposeError('validDays invalide (chaque jour 0..6).');
  }
  return days.length ? days : null;
}

function validateTimeLimit(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1440) {
    throw exposeError(`${label} invalide (0..1440 minutes depuis minuit).`);
  }
  return parsed;
}

function validateShortText(value, label, max = 60) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw exposeError(`${label} trop long (max ${max} caracteres).`);
  return text;
}

function validateDescriptionLines(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw exposeError('descriptionLines doit etre une liste de lignes.');
  if (value.length > 40) throw exposeError('Trop de lignes de description (max 40).');
  return value.map((line) => String(line).slice(0, 200));
}

// Valide et normalise une liste de steps. Chaque step doit designer une activite
// CONNUE du catalogue OU porter un resourceType explicite (pseudo-activites).
function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw exposeError('Une formule doit comporter au moins une etape.');
  return steps.map((step, index) => {
    const source = step && typeof step === 'object' ? step : {};
    const activityId = source.activityId == null ? '' : String(source.activityId).trim();
    const resourceType = source.resourceType == null ? '' : String(source.resourceType).trim();
    if (!activityId && !resourceType) throw exposeError(`Etape ${index + 1} : activityId ou resourceType requis.`);
    if (activityId && !resourceType && !isActivityKnown(activityId)) {
      throw exposeError(`Etape ${index + 1} : activite inconnue "${activityId}" (fournir un resourceType explicite pour une pseudo-activite).`);
    }
    const count = source.count == null ? 1 : Math.trunc(Number(source.count));
    if (!Number.isFinite(count) || count < 1 || count > 99) throw exposeError(`Etape ${index + 1} : count invalide (1..99).`);
    let durationMinutes = null;
    if (source.durationMinutes != null && source.durationMinutes !== '') {
      durationMinutes = Math.trunc(Number(source.durationMinutes));
      if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
        throw exposeError(`Etape ${index + 1} : duree invalide (0..1440 minutes).`);
      }
    }
    return {
      activityId: activityId || null,
      count,
      durationMinutes,
      label: source.label == null ? null : String(source.label).slice(0, 200),
      critical: source.critical === true,
      resourceType: resourceType || null,
    };
  });
}

function stepRowFor(formulaId, position, step) {
  return {
    formula_id: formulaId,
    position,
    activity_id: step.activityId,
    count: step.count,
    duration_minutes: step.durationMinutes,
    label: step.label,
    critical: step.critical,
    resource_type: step.resourceType,
  };
}

function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function makeUniqueId(baseSlug, taken) {
  let root = baseSlug && /^[a-z]/.test(baseSlug) ? baseSlug : `x-${baseSlug}`.replace(/-+$/, '');
  if (!root || !/^[a-z]/.test(root)) root = 'formule';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function normalizeActivityCenter(value) {
  const center = String(value == null ? DEFAULT_ACTIVITY_CENTER : value).trim().toLowerCase();
  return center || DEFAULT_ACTIVITY_CENTER;
}

// Champs valides d'une formule au format table (snake_case), depuis l'input API.
function buildFormulaFields(input) {
  return {
    name: validateName(input.name, true),
    family: validateFamily(input.family),
    min_pax: validateMinPax(input.minPax),
    price_type: validatePriceType(input.priceType),
    price_value: validatePrice(input.priceValue, 'Prix', { nullable: false }),
    price_old: validatePrice(input.priceOld, 'Ancien prix', { nullable: true }),
    not_during_holidays: toBool(input.notDuringHolidays),
    valid_days: validateValidDays(input.validDays),
    time_limit_min_minutes: validateTimeLimit(input.timeLimitMinMinutes, 'Heure min'),
    time_limit_max_minutes: validateTimeLimit(input.timeLimitMaxMinutes, 'Heure max'),
    human_validation: validateShortText(input.humanValidation, 'humanValidation'),
    order_policy: validateShortText(input.orderPolicy, 'orderPolicy'),
    is_birthday_formula: toBool(input.isBirthdayFormula),
    best: toBool(input.best),
    description_lines: validateDescriptionLines(input.descriptionLines),
  };
}

// Patch PARTIEL d'une formule (mute une ligne snake_case en place). Seuls les
// champs fournis sont touches ; undefined = garder. Ne touche PAS les steps.
function applyFormulaPatch(row, input) {
  if (input.name !== undefined) row.name = validateName(input.name, true);
  if (input.family !== undefined) row.family = validateFamily(input.family);
  if (input.minPax !== undefined) row.min_pax = validateMinPax(input.minPax);
  if (input.priceType !== undefined) row.price_type = validatePriceType(input.priceType);
  if (input.priceValue !== undefined) row.price_value = validatePrice(input.priceValue, 'Prix', { nullable: false });
  if (input.priceOld !== undefined) row.price_old = validatePrice(input.priceOld, 'Ancien prix', { nullable: true });
  if (input.notDuringHolidays !== undefined) row.not_during_holidays = toBool(input.notDuringHolidays);
  if (input.validDays !== undefined) row.valid_days = validateValidDays(input.validDays);
  if (input.timeLimitMinMinutes !== undefined) row.time_limit_min_minutes = validateTimeLimit(input.timeLimitMinMinutes, 'Heure min');
  if (input.timeLimitMaxMinutes !== undefined) row.time_limit_max_minutes = validateTimeLimit(input.timeLimitMaxMinutes, 'Heure max');
  if (input.humanValidation !== undefined) row.human_validation = validateShortText(input.humanValidation, 'humanValidation');
  if (input.orderPolicy !== undefined) row.order_policy = validateShortText(input.orderPolicy, 'orderPolicy');
  if (input.isBirthdayFormula !== undefined) row.is_birthday_formula = toBool(input.isBirthdayFormula);
  if (input.best !== undefined) row.best = toBool(input.best);
  if (input.descriptionLines !== undefined) row.description_lines = validateDescriptionLines(input.descriptionLines);
}

// Ligne formulas (snake_case) reconstruite depuis le SOCLE fichier, pour patcher
// une formule seed qui n'a PAS encore de ligne DB (prod deja backfillee, mais on
// reste robuste). Le resultat est identique a ce que le backfill aurait ecrit.
function canonicalToFormulaRow(canonical) {
  return {
    id: canonical.id,
    name: canonical.name,
    family: canonical.docFamily,
    min_pax: canonical.minPax,
    price_type: canonical.priceType,
    price_value: canonical.priceValue,
    price_old: canonical.priceOld,
    not_during_holidays: canonical.notDuringHolidays === true,
    valid_days: canonical.validDays && canonical.validDays.length ? canonical.validDays.slice() : null,
    time_limit_min_minutes: canonical.timeLimitMin,
    time_limit_max_minutes: canonical.timeLimitMax,
    human_validation: canonical.humanValidation,
    order_policy: canonical.orderPolicy,
    is_birthday_formula: canonical.isBirthday === true,
    best: canonical.best === true,
    description_lines: canonical.descriptionLines ? canonical.descriptionLines.slice() : [],
    sort_index: canonical.sortIndex,
    source: canonical.source,
    active: canonical.active,
  };
}

function baselineFormulaRow(id) {
  const bookingBase = BOOKING_BASE_BY_ID.get(id) || null;
  const docBase = DOC_BASE_BY_ID.get(id) || null;
  if (!bookingBase && !docBase) return null;
  const canonical = buildCanonicalFormula({ id, bookingBase, docBase, dbRow: null, dbSteps: null });
  return canonicalToFormulaRow(canonical);
}

function baselineActivityRow(id, centerId) {
  const base = ACTIVITY_BASE_BY_ID.get(id) || null;
  if (!base || centerId !== DEFAULT_ACTIVITY_CENTER) return null;
  return {
    id,
    center_id: DEFAULT_ACTIVITY_CENTER,
    name: base.name != null ? base.name : null,
    resource_type: base.resourceType != null ? base.resourceType : null,
    duration_model: base.durationModel != null ? base.durationModel : null,
    service_model: base.serviceModel != null ? base.serviceModel : null,
    risk_drivers: Array.isArray(base.riskDrivers) ? base.riskDrivers.slice() : null,
    planning_pressure: base.planningPressure != null ? base.planningPressure : null,
    source: 'seed',
    active: true,
  };
}

// ── SQL borne (memes shapes que scripts/backfill-catalog.js) ─────────────────
async function writeFormulaRow(db, row) {
  await db.query(
    `insert into formulas
       (id, name, family, min_pax, price_type, price_value, price_old, not_during_holidays,
        valid_days, time_limit_min_minutes, time_limit_max_minutes, human_validation, order_policy,
        is_birthday_formula, best, description_lines, sort_index, source, active, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     on conflict (id) do update set
       name = excluded.name,
       family = excluded.family,
       min_pax = excluded.min_pax,
       price_type = excluded.price_type,
       price_value = excluded.price_value,
       price_old = excluded.price_old,
       not_during_holidays = excluded.not_during_holidays,
       valid_days = excluded.valid_days,
       time_limit_min_minutes = excluded.time_limit_min_minutes,
       time_limit_max_minutes = excluded.time_limit_max_minutes,
       human_validation = excluded.human_validation,
       order_policy = excluded.order_policy,
       is_birthday_formula = excluded.is_birthday_formula,
       best = excluded.best,
       description_lines = excluded.description_lines,
       sort_index = excluded.sort_index,
       source = excluded.source,
       active = excluded.active,
       updated_at = now();`,
    [
      row.id, row.name, row.family, row.min_pax, row.price_type, row.price_value, row.price_old,
      row.not_during_holidays, row.valid_days, row.time_limit_min_minutes, row.time_limit_max_minutes,
      row.human_validation, row.order_policy, row.is_birthday_formula, row.best, row.description_lines,
      row.sort_index, row.source, row.active,
    ],
  );
}

async function writeStepRow(db, row) {
  await db.query(
    `insert into formula_steps
       (formula_id, position, activity_id, count, duration_minutes, label, critical, resource_type)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (formula_id, position) do update set
       activity_id = excluded.activity_id,
       count = excluded.count,
       duration_minutes = excluded.duration_minutes,
       label = excluded.label,
       critical = excluded.critical,
       resource_type = excluded.resource_type;`,
    [row.formula_id, row.position, row.activity_id, row.count, row.duration_minutes, row.label, row.critical, row.resource_type],
  );
}

async function deleteStepRows(db, formulaId) {
  await db.query(`delete from formula_steps where formula_id = $1;`, [formulaId]);
}

async function writeActivityRow(db, row) {
  await db.query(
    `insert into activities
       (id, center_id, name, resource_type, duration_model, service_model, risk_drivers, planning_pressure, source, active, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, now())
     on conflict (id, center_id) do update set
       name = excluded.name,
       resource_type = excluded.resource_type,
       duration_model = excluded.duration_model,
       service_model = excluded.service_model,
       risk_drivers = excluded.risk_drivers,
       planning_pressure = excluded.planning_pressure,
       source = excluded.source,
       active = excluded.active,
       updated_at = now();`,
    [
      row.id, row.center_id, row.name, row.resource_type,
      row.duration_model == null ? null : JSON.stringify(row.duration_model),
      row.service_model == null ? null : JSON.stringify(row.service_model),
      row.risk_drivers, row.planning_pressure, row.source, row.active,
    ],
  );
}

async function readFormulaRowById(pool, id) {
  const result = await pool.query(
    `select id, name, family, min_pax, price_type, price_value, price_old, not_during_holidays,
            valid_days, time_limit_min_minutes, time_limit_max_minutes, human_validation, order_policy,
            is_birthday_formula, best, description_lines, sort_index, source, active
     from formulas where id = $1 limit 1;`,
    [id],
  );
  return (result.rows && result.rows[0]) || null;
}

async function readFormulaIds(pool) {
  const result = await pool.query(`select id from formulas;`);
  return new Set((result.rows || []).map((row) => row.id));
}

async function readActivityRowByKey(pool, id, centerId) {
  const result = await pool.query(
    `select id, center_id, name, resource_type, duration_model, service_model, risk_drivers, planning_pressure, source, active
     from activities where id = $1 and center_id = $2 limit 1;`,
    [id, centerId],
  );
  return (result.rows && result.rows[0]) || null;
}

async function readActivityIds(pool) {
  const result = await pool.query(`select id from activities;`);
  return new Set((result.rows || []).map((row) => row.id));
}

// ── FORMULES ─────────────────────────────────────────────────────────────────

// Insere une formule source='custom' active=true + ses steps (position
// sequentielle) dans une transaction. Genere un id slug si absent (unique) ;
// refuse un id qui collisionne un seed. Bornes : name<=120, prix 0..1000,
// minPax>=1, steps non vide.
async function createFormula(pool, input = {}) {
  const fields = buildFormulaFields(input);
  const steps = validateSteps(input.steps);

  const seedIds = new Set([...BOOKING_BASE_BY_ID.keys(), ...DOC_BASE_BY_ID.keys()]);
  const dbIds = await readFormulaIds(pool);
  let id;
  if (input.id != null && String(input.id).trim()) {
    id = String(input.id).trim().toLowerCase();
    if (!FORMULA_ID_PATTERN.test(id)) throw exposeError('Identifiant formule invalide (minuscules, chiffres, tirets, commence par une lettre).');
    if (seedIds.has(id)) throw exposeError('Cet identifiant est reserve a une formule du socle.');
    if (dbIds.has(id)) throw exposeError('Une formule porte deja cet identifiant.');
  } else {
    id = makeUniqueId(slugify(input.name), new Set([...seedIds, ...dbIds]));
  }

  const row = { id, ...fields, sort_index: null, source: 'custom', active: true };
  const stepRows = steps.map((step, index) => stepRowFor(id, index, step));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeFormulaRow(client, row);
    for (const stepRow of stepRows) await writeStepRow(client, stepRow);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await refreshCatalog(pool, { force: true });
  return { id, source: 'custom', stepCount: stepRows.length };
}

// Patch partiel des champs de la formule (PAS les steps). Autorise sur seed ET
// custom : une formule seed sans ligne DB est materialisee depuis le socle.
async function updateFormula(pool, input = {}) {
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const existing = await readFormulaRowById(pool, id);
  const row = existing ? { ...existing } : baselineFormulaRow(id);
  if (!row) throw exposeError('Formule inconnue.');
  applyFormulaPatch(row, input);
  await writeFormulaRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, source: row.source };
}

// Remplace la liste ORDONNEE des steps d'une formule (delete + insert dans une
// transaction). C'est l'edition des ACTIVITES d'une formule. Une formule seed
// sans ligne DB est materialisee d'abord (sinon les steps DB seraient ignores :
// buildCanonicalFormula n'utilise dbSteps que si la formule a une ligne DB).
async function setFormulaSteps(pool, input = {}) {
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const dbIds = await readFormulaIds(pool);
  const known = dbIds.has(id) || BOOKING_BASE_BY_ID.has(id) || DOC_BASE_BY_ID.has(id);
  if (!known) throw exposeError('Formule inconnue.');
  const steps = validateSteps(input.steps);
  const existing = await readFormulaRowById(pool, id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!existing) {
      const baseRow = baselineFormulaRow(id);
      if (baseRow) await writeFormulaRow(client, baseRow);
    }
    await deleteStepRows(client, id);
    for (let index = 0; index < steps.length; index += 1) {
      await writeStepRow(client, stepRowFor(id, index, steps[index]));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await refreshCatalog(pool, { force: true });
  return { id, stepCount: steps.length };
}

// SOFT delete : active=false, JAMAIS de DELETE physique (reservations.formule_id
// n'a pas de FK mais les resas passees gardent leur libelle). Le fix no-resurrect
// (isFormulaKnown) garantit qu'une seed desactivee ne reapparait pas par le fichier.
async function deleteFormula(pool, input = {}) {
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const existing = await readFormulaRowById(pool, id);
  const row = existing ? { ...existing } : baselineFormulaRow(id);
  if (!row) throw exposeError('Formule inconnue.');
  row.active = false;
  await writeFormulaRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, active: false };
}

// ── ACTIVITES ────────────────────────────────────────────────────────────────
function buildActivityFields(input) {
  return {
    name: validateName(input.name, true),
    resource_type: validateShortText(input.resourceType, 'resourceType', 60),
    duration_model: input.durationModel != null && typeof input.durationModel === 'object' ? input.durationModel : null,
    service_model: input.serviceModel != null && typeof input.serviceModel === 'object' ? input.serviceModel : null,
    risk_drivers: Array.isArray(input.riskDrivers) ? input.riskDrivers.map(String) : null,
    planning_pressure: validateShortText(input.planningPressure, 'planningPressure', 30),
  };
}

function applyActivityPatch(row, input) {
  if (input.name !== undefined) row.name = validateName(input.name, true);
  if (input.resourceType !== undefined) row.resource_type = validateShortText(input.resourceType, 'resourceType', 60);
  if (input.durationModel !== undefined) row.duration_model = input.durationModel != null && typeof input.durationModel === 'object' ? input.durationModel : null;
  if (input.serviceModel !== undefined) row.service_model = input.serviceModel != null && typeof input.serviceModel === 'object' ? input.serviceModel : null;
  if (input.riskDrivers !== undefined) row.risk_drivers = Array.isArray(input.riskDrivers) ? input.riskDrivers.map(String) : null;
  if (input.planningPressure !== undefined) row.planning_pressure = validateShortText(input.planningPressure, 'planningPressure', 30);
}

async function createActivity(pool, input = {}) {
  const centerId = normalizeActivityCenter(input.centerId);
  const fields = buildActivityFields(input);
  const seedIds = new Set(ACTIVITY_BASE_BY_ID.keys());
  let id;
  if (input.id != null && String(input.id).trim()) {
    id = String(input.id).trim().toLowerCase();
    if (!FORMULA_ID_PATTERN.test(id)) throw exposeError('Identifiant activite invalide (minuscules, chiffres, tirets, commence par une lettre).');
    if (centerId === DEFAULT_ACTIVITY_CENTER && seedIds.has(id)) throw exposeError('Cet identifiant est reserve a une activite du socle.');
    if (await readActivityRowByKey(pool, id, centerId)) throw exposeError('Une activite porte deja cet identifiant pour ce centre.');
  } else {
    id = makeUniqueId(slugify(input.name), new Set([...seedIds, ...(await readActivityIds(pool))]));
  }
  const row = { id, center_id: centerId, ...fields, source: 'custom', active: true };
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, source: 'custom' };
}

async function updateActivity(pool, input = {}) {
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant activite requis.');
  const centerId = normalizeActivityCenter(input.centerId);
  const existing = await readActivityRowByKey(pool, id, centerId);
  const row = existing ? { ...existing } : baselineActivityRow(id, centerId);
  if (!row) throw exposeError('Activite inconnue.');
  applyActivityPatch(row, input);
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, source: row.source };
}

async function deleteActivity(pool, input = {}) {
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant activite requis.');
  const centerId = normalizeActivityCenter(input.centerId);
  const existing = await readActivityRowByKey(pool, id, centerId);
  const row = existing ? { ...existing } : baselineActivityRow(id, centerId);
  if (!row) throw exposeError('Activite inconnue.');
  row.active = false;
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, active: false };
}

module.exports = {
  refreshCatalog,
  applyCatalogState,
  loadCatalogState,
  getFormulaDoc,
  getBookingFormule,
  listBookingFormules,
  getActivityDoc,
  isFormulaKnown,
  isActivityKnown,
  createFormula,
  updateFormula,
  setFormulaSteps,
  deleteFormula,
  createActivity,
  updateActivity,
  deleteActivity,
};
