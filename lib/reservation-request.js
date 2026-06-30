const { LASER_GAME_OPTIONS, getBasePrice, getRequiredLaneCount } = require('./booking-config');

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

function isPublicChannel(options = {}) {
  return normalizeText(options.channel, 'public').toLowerCase() === 'public';
}

function getLaserOptionFromGames(games) {
  const normalized = Math.max(1, Math.min(3, Math.trunc(Number(games || 1))));
  return LASER_GAME_OPTIONS.find((item) => Number(item.games) === normalized) || LASER_GAME_OPTIONS[0];
}

function getLaserOptionFromDuration(duration) {
  const numeric = Number(duration || 0);
  return LASER_GAME_OPTIONS.find((item) => Number(item.value) === numeric) || LASER_GAME_OPTIONS[0];
}

function getExplicitLaserGames(input = {}) {
  const explicit = Number(input.laserGames || input.games || input.gameCount || 0);
  return explicit >= 1 ? explicit : 0;
}

function estimatePublicPrice(request) {
  const pax = Math.max(1, Math.trunc(Number(request.pax || 1)));
  const formuleId = normalizeText(request.formuleId || request.formulaId);
  const laneCount = getRequiredLaneCount(request.type, pax, formuleId);
  return Math.max(0, Math.round(Number(getBasePrice(
    request.type,
    Number(request.duration || request.totalDuration || 0),
    laneCount,
    pax,
    formuleId,
  )) || 0));
}

function applyPublicFieldGuardrails(request) {
  const price = estimatePublicPrice(request);
  request.channel = 'public';
  request.status = 'pending';
  request.basePrice = price;
  request.price = price;
  request.paymentMethod = null;
  request.payment_method = null;
  request.validationStatus = '';
  request.validation_status = '';
  request.validationMode = '';
  return request;
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
    const explicitGames = getExplicitLaserGames(input);
    const laserOption = explicitGames
      ? getLaserOptionFromGames(explicitGames)
      : getLaserOptionFromDuration(input.duration || request.duration);
    request.label = !request.label || FORMULA_LABEL_PATTERN.test(normalizeText(request.label))
      ? 'Laser Game'
      : request.label;
    request.duration = Number(laserOption.value);
    request.totalDuration = Number(request.totalDuration || laserOption.value);
    if (Number(request.totalDuration) < Number(laserOption.value)) request.totalDuration = Number(laserOption.value);
    request.laserGames = Number(laserOption.games);
    request.games = Number(laserOption.games);
    request.gameCount = Number(laserOption.games);
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

  if (isPublicChannel(options)) {
    applyPublicFieldGuardrails(request);
  }

  return request;
}

module.exports = {
  normalizeReservationRequest,
  normalizeReservationType,
  planBelongsToType,
};
