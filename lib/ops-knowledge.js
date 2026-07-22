const { mergeCenterConfig, loadCenterConfigOverrides } = require('./center-config');
const catalogStore = require('./catalog-store');

// Chargé via require() (et non fs.readFileSync) : le bundler Vercel trace les
// require de .json et les embarque dans la fonction, même si `.vercelignore`
// exclut le dossier ops-knowledge/. fs.readFileSync n'est PAS tracé → ENOENT
// en prod. Objets immuables (les merges clonent avant toute mutation).
const KNOWLEDGE_FILES = {
  'centers.json': require('../ops-knowledge/centers.json'),
  'activities.json': require('../ops-knowledge/activities.json'),
  'formulas.json': require('../ops-knowledge/formulas.json'),
  'planning-rules.json': require('../ops-knowledge/planning-rules.json'),
  'competitive-playbook.json': require('../ops-knowledge/competitive-playbook.json'),
};

let cache = null;

// In-memory per-center overrides loaded from PostgreSQL (centers.settings.config).
// Kept separate from the file baseline so getCenter always returns baseline
// merged with the latest overrides, and so a DB outage silently falls back.
let centerOverrides = new Map();
let lastOverrideRefreshAt = 0;
const OVERRIDE_TTL_MS = 30_000;

function readJson(name) {
  return KNOWLEDGE_FILES[name];
}

function cloneCenter(center) {
  return JSON.parse(JSON.stringify(center));
}

function rebuildMergedCenters() {
  if (!cache) return;
  const merged = cache.baseCenters.map((base) => {
    const override = centerOverrides.get(base.id);
    return override ? mergeCenterConfig(cloneCenter(base), override) : cloneCenter(base);
  });
  cache.centers = merged;
  cache.centerById = new Map(merged.map((center) => [center.id, center]));
}

function loadOpsKnowledge({ refresh = false } = {}) {
  if (cache && !refresh) return cache;

  const centers = readJson('centers.json');
  const activities = readJson('activities.json');
  const formulas = readJson('formulas.json');
  const rules = readJson('planning-rules.json');
  const competitivePlaybook = readJson('competitive-playbook.json');

  cache = {
    schemaVersion: 1,
    baseCenters: centers.centers,
    centers: centers.centers,
    activities: activities.activities,
    formulas: formulas.formulas,
    rules,
    competitivePlaybook,
    centerById: new Map(centers.centers.map((center) => [center.id, center])),
    activityById: new Map(activities.activities.map((activity) => [activity.id, activity])),
    formulaById: new Map(formulas.formulas.map((formula) => [formula.id, formula])),
  };

  // Re-apply any overrides captured before a forced reload.
  if (centerOverrides.size) rebuildMergedCenters();

  return cache;
}

// Merge a Map(centerId -> configOverride) onto the file baseline. Passing an
// empty map clears all overrides (used by tests to restore the baseline).
function applyCenterOverrides(map) {
  centerOverrides = map instanceof Map ? new Map(map) : new Map();
  loadOpsKnowledge();
  rebuildMergedCenters();
  return cache.centers;
}

// Load overrides from PostgreSQL and apply them. Cached for OVERRIDE_TTL_MS to
// avoid a DB round-trip on every engine request. Fails soft: on any error the
// current (baseline or last-known) merged centers are kept.
async function refreshCenterOverrides(pool, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastOverrideRefreshAt < OVERRIDE_TTL_MS) {
    return false;
  }
  lastOverrideRefreshAt = now;
  const overrides = await loadCenterConfigOverrides(pool);
  applyCenterOverrides(overrides);
  return true;
}

function getCenter(centerId = 'libramont') {
  const knowledge = loadOpsKnowledge();
  const center = knowledge.centerById.get(centerId);
  if (!center) throw new Error(`Centre inconnu: ${centerId}`);
  return center;
}

function getActivity(activityId) {
  // Source DB unique en priorite (catalog-store) ; fallback fichier si le store
  // ne connait pas l'activite (id hors catalogue, ex. service_drinks inline).
  try {
    const doc = catalogStore.getActivityDoc(activityId);
    if (doc) return doc;
  } catch (error) {
    // Fallback fichier ci-dessous.
  }
  const knowledge = loadOpsKnowledge();
  const activity = knowledge.activityById.get(activityId);
  if (!activity) return null;
  return activity;
}

function getFormula(formulaId) {
  // Source DB unique en priorite (catalog-store, fusionnee par-dessus le
  // fichier). FIX no-resurrect (residuel 2a n1) : on distingue "id INCONNU du
  // store" (aucune ligne DB -> fallback fichier legitime) de "id CONNU mais
  // desactive" (getFormulaDoc rend null ET isFormulaKnown rend true -> retiree
  // pour de vrai, on rend null SANS fallback, sinon la formule soft-deleted
  // ressusciterait par le fichier).
  try {
    const doc = catalogStore.getFormulaDoc(formulaId);
    if (doc) return doc;
    if (catalogStore.isFormulaKnown(formulaId)) return null;
  } catch (error) {
    // Fallback fichier ci-dessous.
  }
  const knowledge = loadOpsKnowledge();
  const formula = knowledge.formulaById.get(formulaId);
  if (!formula) throw new Error(`Formule inconnue: ${formulaId}`);
  return formula;
}

module.exports = {
  getActivity,
  getCenter,
  getFormula,
  loadOpsKnowledge,
  applyCenterOverrides,
  refreshCenterOverrides,
  // Re-export : le catalogue unifie se rafraichit aux memes points de requete
  // que les overrides de centre (cache module, TTL 30 s, fail-soft).
  refreshCatalog: catalogStore.refreshCatalog,
};
