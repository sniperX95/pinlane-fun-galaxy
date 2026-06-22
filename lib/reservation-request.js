const KNOWN_TYPES = new Set(['bowling', 'laser', 'formule']);
const FORMULA_LABEL_PATTERN = /\bformule\b/i;

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeReservationType(input = {}) {
  const explicit = normalizeText(input.type).toLowerCase();
  if (KNOWN_TYPES.has(explicit)) return explicit;
  if (normalizeText(input.activityId).toLowerCase() === 'laser_game') return 'laser';
  if (normalizeText(input.formuleId || input.formulaId)) return 'formule';
  return 'bowling';
}

function planBelongsToType(plan, type) {
  if (!plan || typeof plan !== 'object') return false;
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  if (type === 'formule') return true;
  if (plan.formulaId || plan.formuleId || FORMULA_LABEL_PATTERN.test(normalizeText(plan.formulaName))) return false;
  if (type === 'bowling') return blocks.length ? blocks.every((block) => block.resourceType === 'bowling_lane') : true;
  if (type === 'laser') return blocks.length ? blocks.every((block) => block.resourceType === 'laser_arena') : true;
  return false;
}

function normalizeReservationRequest(input = {}, options = {}) {
  const type = normalizeReservationType(input);
  const channel = normalizeText(input.channel, options.channel || 'public') || 'public';
  const request = {
    ...input,
    type,
    channel,
    centerId: normalizeText(input.centerId || input.center_id, options.centerId || 'libramont') || 'libramont',
  };

  if (type !== 'formule') {
    request.formuleId = '';
    request.formulaId = '';
    request.validationMode = request.validationMode === 'staff_review' ? request.validationMode : '';
    if (!planBelongsToType(request.opsPlan || request.ops_plan, type)) {
      request.opsPlan = null;
      request.ops_plan = null;
    }
  }

  if (type === 'bowling') {
    request.label = !request.label || FORMULA_LABEL_PATTERN.test(normalizeText(request.label))
      ? 'Bowling Classique'
      : request.label;
    request.laserGames = 0;
    request.games = 0;
    request.gameCount = 0;
    request.requiresLanes = request.requiresLanes ?? true;
  }

  if (type === 'laser') {
    request.label = !request.label || FORMULA_LABEL_PATTERN.test(normalizeText(request.label))
      ? 'Laser Game'
      : request.label;
    request.duration = Number(request.duration || 0.5);
    request.totalDuration = Number(request.totalDuration || request.duration || 0.5);
    request.laserGames = Math.max(1, Math.trunc(Number(request.laserGames || request.games || request.gameCount || 1)));
    request.requiresLanes = false;
    request.lanes = [];
    request.laneCount = 0;
  }

  if (type === 'formule') {
    request.formuleId = normalizeText(input.formuleId || input.formulaId || request.formuleId);
    request.formulaId = request.formuleId;
    if (!request.formuleId) {
      throw new Error('Formule manquante.');
    }
  }

  return request;
}

module.exports = {
  normalizeReservationRequest,
  normalizeReservationType,
  planBelongsToType,
};
