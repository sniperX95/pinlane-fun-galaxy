const fs = require('fs');
const path = require('path');
const { mergeCenterConfig, loadCenterConfigOverrides } = require('./center-config');

const ROOT = path.join(__dirname, '..', 'ops-knowledge');

let cache = null;

// In-memory per-center overrides loaded from PostgreSQL (centers.settings.config).
// Kept separate from the file baseline so getCenter always returns baseline
// merged with the latest overrides, and so a DB outage silently falls back.
let centerOverrides = new Map();
let lastOverrideRefreshAt = 0;
const OVERRIDE_TTL_MS = 30_000;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
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
  const knowledge = loadOpsKnowledge();
  const activity = knowledge.activityById.get(activityId);
  if (!activity) return null;
  return activity;
}

function getFormula(formulaId) {
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
};
