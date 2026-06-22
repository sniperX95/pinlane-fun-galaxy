const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'ops-knowledge');

let cache = null;

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
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
    centers: centers.centers,
    activities: activities.activities,
    formulas: formulas.formulas,
    rules,
    competitivePlaybook,
    centerById: new Map(centers.centers.map((center) => [center.id, center])),
    activityById: new Map(activities.activities.map((activity) => [activity.id, activity])),
    formulaById: new Map(formulas.formulas.map((formula) => [formula.id, formula])),
  };

  return cache;
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
};
