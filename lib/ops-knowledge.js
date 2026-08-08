const { mergeCenterConfig, loadCenterRecords, normalizeCenterConfig } = require('./center-config');
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

// In-memory per-center records loaded from PostgreSQL. Kept separate from the
// file baseline so getCenter always returns baseline merged with the latest
// overrides, and so a DB outage silently falls back.
//
// Map(centerId -> { name?, status?, timezone?, config }). Un centre du FICHIER
// n'utilise que `config` (comportement historique, inchange). Un centre qui
// n'existe QUE en base utilise en plus son identite : c'est ce qui lui permet
// d'exister aux yeux de getCenter sans commit dans ops-knowledge/centers.json.
let centerOverrides = new Map();
let lastOverrideRefreshAt = 0;
const OVERRIDE_TTL_MS = 30_000;

function readJson(name) {
  return KNOWLEDGE_FILES[name];
}

function cloneCenter(center) {
  return JSON.parse(JSON.stringify(center));
}

// Un centre qui n'existe QUE en base : sa fiche moteur est construite a partir
// de son identite (colonnes) et de sa config normalisee. Sans ce chemin,
// getCenter levait « Centre inconnu » pour tout centre cree depuis la console,
// createReservation refusait chaque reservation, et le tunnel public retombait
// sur l'horaire et le catalogue de Fun Galaxy.
//
// Le nom vient de la colonne (seule ecriture qui le porte). Le statut vient de
// la colonne, tenue a jour par upsertCenter ET saveCenterConfigOverride. Le
// fuseau vient de la config si elle en porte un (saveCenterConfigOverride
// n'ecrit pas la colonne), sinon de la colonne.
function centerFromRecord(record) {
  const config = normalizeCenterConfig(
    { timezone: record.timezone || undefined, ...(record.config || {}) },
    record.id,
  );
  return {
    ...config,
    id: record.id,
    name: record.name || record.id,
    status: record.status || config.status,
  };
}

function rebuildMergedCenters() {
  if (!cache) return;
  const baseIds = new Set(cache.baseCenters.map((base) => base.id));
  const merged = cache.baseCenters.map((base) => {
    const record = centerOverrides.get(base.id);
    const override = record && record.config;
    return override ? mergeCenterConfig(cloneCenter(base), override) : cloneCenter(base);
  });
  // Puis les centres que SEULE la base connait, dans un ordre stable.
  for (const [id, record] of [...centerOverrides.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (baseIds.has(id)) continue;
    if (!record || !record.fromDatabase) continue;
    merged.push(centerFromRecord({ ...record, id }));
  }
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
// Les valeurs sont des CONFIGS nues : ce chemin ne cree aucun centre, il ne
// re-parametre que ceux du fichier (contrat historique, tenu par les gates).
function applyCenterOverrides(map) {
  const entries = map instanceof Map ? [...map.entries()] : [];
  centerOverrides = new Map(entries.map(([id, config]) => [id, { config, fromDatabase: false }]));
  loadOpsKnowledge();
  rebuildMergedCenters();
  return cache.centers;
}

// Merge une liste de LIGNES de la table `centers` : identite comprise, donc
// capable de faire exister un centre absent du fichier.
function applyCenterRecords(records) {
  const list = Array.isArray(records) ? records : [];
  centerOverrides = new Map(list
    .filter((record) => record && record.id)
    .map((record) => [record.id, { ...record, fromDatabase: true }]));
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
  const records = await loadCenterRecords(pool);
  applyCenterRecords(records);
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
  applyCenterRecords,
  refreshCenterOverrides,
  // Re-export : le catalogue unifie se rafraichit aux memes points de requete
  // que les overrides de centre (cache module, TTL 30 s, fail-soft).
  refreshCatalog: catalogStore.refreshCatalog,
};
