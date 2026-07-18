const { createOpsEvent, readStaffState } = require('./database');
const { planningAgent } = require('./ops-agents');
const { enqueueReservationCommunications } = require('./ops-communications');
const { enqueueReservationAutomation } = require('./ops-jobs');
const { normalizeReservationRequest } = require('./reservation-request');
const { shouldRequestHumanReview } = require('./validation-policy');

function timeToMinutes(value) {
  const [hours, minutes = 0] = String(value || '0:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function coerceMinute(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return timeToMinutes(value);
  return null;
}

function normalizeTimedItem(item) {
  if (!item || typeof item !== 'object') return item;
  const start = coerceMinute(item.start) ?? coerceMinute(item.startTime);
  const end = coerceMinute(item.end) ?? coerceMinute(item.endTime);
  if (start === null || end === null || end <= start) return item;
  return {
    ...item,
    start,
    end,
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    durationMinutes: Number(item.durationMinutes || end - start),
  };
}

function normalizeTrustedPlan(body, plan) {
  const resourceBlocks = Array.isArray(plan.resourceBlocks)
    ? plan.resourceBlocks.map(normalizeTimedItem)
    : [];
  const timeline = Array.isArray(plan.timeline)
    ? plan.timeline.map(normalizeTimedItem)
    : plan.timeline;
  const timedBlocks = resourceBlocks
    .map((block) => ({
      start: coerceMinute(block.start) ?? coerceMinute(block.startTime),
      end: coerceMinute(block.end) ?? coerceMinute(block.endTime),
      block,
    }))
    .filter((item) => item.start !== null && item.end !== null && item.end > item.start);
  const firstStart = timedBlocks.length ? Math.min(...timedBlocks.map((item) => item.start)) : null;
  const lastEnd = timedBlocks.length ? Math.max(...timedBlocks.map((item) => item.end)) : null;
  const bowlingBlocks = resourceBlocks.filter((block) => block.resourceType === 'bowling_lane');
  const laserBlocks = resourceBlocks.filter((block) => block.resourceType === 'laser_arena');
  const assignedLanes = [...new Set(bowlingBlocks.flatMap((block) =>
    (Array.isArray(block.lanes) ? block.lanes : [])
      .map((lane) => Number(lane))
      .filter((lane) => Number.isInteger(lane) && lane > 0)))];

  return {
    ...plan,
    startTime: firstStart !== null ? minutesToTime(firstStart) : plan.startTime,
    endTime: lastEnd !== null ? minutesToTime(lastEnd) : plan.endTime,
    totalMinutes: firstStart !== null && lastEnd !== null ? lastEnd - firstStart : Number(plan.totalMinutes || 0),
    resourceBlocks,
    timeline,
    assignedLanes: assignedLanes.length ? assignedLanes : plan.assignedLanes,
    firstBowlingTime: bowlingBlocks[0]?.startTime || plan.firstBowlingTime,
    firstLaserTime: laserBlocks[0]?.startTime || plan.firstLaserTime,
    staffSummary: plan.staffSummary || body.staffSummary || '',
  };
}

function isTrustedClientPlan(plan, body = {}) {
  if (!plan || typeof plan !== 'object') return false;
  if (!Array.isArray(plan.resourceBlocks) || !plan.resourceBlocks.length) return false;
  if (plan.startTime && body.startTime) {
    const bodyStart = String(body.startTime).slice(0, 5);
    const acceptedStarts = new Set([
      plan.startTime,
      plan.firstBowlingTime,
      plan.firstLaserTime,
      ...(plan.resourceBlocks || []).map((block) => block.startTime),
    ].filter(Boolean).map((value) => String(value).slice(0, 5)));
    const closeToPlannedStart = [...acceptedStarts].some((value) =>
      Math.abs(timeToMinutes(value) - timeToMinutes(bodyStart)) <= 15);
    if (!acceptedStarts.has(bodyStart) && !closeToPlannedStart) return false;
  }
  return plan.resourceBlocks.some((block) =>
    ['bowling_lane', 'laser_arena', 'party_table'].includes(block.resourceType)
    && (block.startTime || Number.isFinite(Number(block.start)))
    && (block.endTime || Number.isFinite(Number(block.end))),
  );
}

function buildTrustedClientPlanResult(body, plan) {
  const formulaId = body.formuleId || body.formulaId || plan.formulaId || '';
  const formulaName = body.type === 'laser'
    ? 'Laser Game'
    : body.label || plan.formulaName || '';
  const normalizedPlan = normalizeTrustedPlan(body, plan);
  const safePlan = {
    ...normalizedPlan,
    ok: normalizedPlan.ok !== false,
    formulaId,
    formulaName,
    conflicts: Array.isArray(normalizedPlan.conflicts) ? normalizedPlan.conflicts : [],
    risk: normalizedPlan.risk || { level: normalizedPlan.riskLevel || 'low', score: Number(normalizedPlan.riskScore || 20), reasons: [] },
    marketIntelligence: normalizedPlan.marketIntelligence || { qualityScore: 90, warnings: [] },
  };
  return {
    ok: true,
    warning: null,
    plan: {
      ok: true,
      formulaId,
      formulaName,
      validationMode: body.validationMode || plan.validationMode || 'recommended',
      recommended: safePlan,
      scenarios: [safePlan],
    },
  };
}

async function prepareReservationOps(body, channel = 'public', options = {}) {
  const request = normalizeReservationRequest(body, { channel });
  const centerId = request.centerId || request.center_id || 'libramont';
  const ignoreReservationId = Number(options.ignoreReservationId || request.ignoreReservationId || 0);
  const readState = options.readState || readStaffState;
  let planResult = null;

  try {
    const snapshot = await readState(request.date, centerId);
    const reservations = ignoreReservationId
      ? snapshot.reservations.filter((reservation) => Number(reservation.id) !== ignoreReservationId)
      : snapshot.reservations;
    const isFormula = request.type === 'formule';
    const isDirectLaser = request.type === 'laser';
    const trustedClientPlan = channel !== 'public'
      && (isFormula || isDirectLaser)
      && isTrustedClientPlan(request.opsPlan, request);
    planResult = trustedClientPlan
      ? buildTrustedClientPlanResult(request, request.opsPlan)
      : planningAgent(
        {
          centerId,
          date: request.date,
          type: request.type || 'bowling',
          formuleId: request.formuleId || request.formulaId || '',
          pax: request.pax,
          startTime: request.startTime,
          duration: request.duration,
          laserGames: request.laserGames || request.games || request.gameCount || 0,
          preference: request.preference || {},
          channel,
          allowPastStart: channel === 'staff' && Boolean(request.allowPastStart),
          pauseMinutes: 0,
        },
        {
          reservations,
          laneStatuses: snapshot.laneStatuses,
        },
      );
  } catch (error) {
    planResult = {
      ok: false,
      warning: error.message || 'Plan Ops indisponible.',
      plan: null,
    };
  }

  const baseRecommended = planResult?.plan?.recommended || null;
  const requestLaserGames = request.type === 'laser'
    ? Number(request.laserGames || request.games || request.gameCount || 0)
    : 0;
  const recommended = baseRecommended && requestLaserGames
    ? {
      ...baseRecommended,
      laserGames: requestLaserGames,
      games: requestLaserGames,
      laserPassPlan: baseRecommended.laserPassPlan
        ? { ...baseRecommended.laserPassPlan, totalGames: requestLaserGames }
        : baseRecommended.laserPassPlan,
    }
    : baseRecommended;
  const blockingConflicts = recommended?.conflicts?.some((conflict) => conflict.severity === 'blocking');
  const noSafePlan = planResult && planResult.ok === false;
  // Choix ops Movsar (2026-07-18) : validation staff (et email) UNIQUEMENT si la
  // resa ne peut pas etre placee (pas de plan sur ou conflit bloquant) ou si
  // l'operateur l'exige. Le risque critique mais placable auto-confirme et
  // remonte dans « A surveiller » via riskLevel ci-dessous, sans email.
  const policyReview = shouldRequestHumanReview({
    validationMode: planResult?.plan?.validationMode,
    recommended,
  });
  const validationStatus = request.validationStatus
    || (noSafePlan || blockingConflicts || policyReview ? 'staff_review' : 'confirmed');
  const plannedTotalDuration = recommended?.totalMinutes
    ? Math.ceil(Number(recommended.totalMinutes) / 30) / 2
    : 0;
  const totalDuration = plannedTotalDuration
    ? Math.max(Number(request.totalDuration || request.duration || 0), plannedTotalDuration)
    : request.totalDuration;

  return {
    centerId,
    ...(totalDuration ? { totalDuration } : {}),
    ...(channel === 'public' && recommended?.startTime ? { startTime: recommended.startTime } : {}),
    opsPlan: recommended,
    riskLevel: recommended?.risk?.level || '',
    riskScore: recommended?.risk?.score ?? null,
    validationStatus,
    requiresHumanReview: validationStatus === 'staff_review',
    autoDecision: validationStatus === 'staff_review' ? 'human_review_required' : 'auto_confirmed',
    blockOnlineConfirmation: channel === 'public' && noSafePlan,
    planAvailable: !noSafePlan,
    planWarning: planResult?.warning || null,
  };
}

async function afterReservationCreated(reservation, body = {}) {
  const warnings = [];

  // Les trois hooks post-création (event, jobs, communications) sont
  // indépendants : on les lance en PARALLÈLE au lieu d'enchaîner les awaits.
  // Chemin chaud du POST staff : chaque aller-retour séquentiel évité compte.
  const [, , communications] = await Promise.all([
    createOpsEvent({
      centerId: reservation.centerId || 'libramont',
      reservationId: reservation.id,
      formulaId: reservation.formuleId || '',
      eventType: 'reservation_created',
      plannedMinutes: Number(reservation.totalDuration || reservation.duration || 0) * 60,
      payload: {
        channel: reservation.channel,
        validationStatus: reservation.validationStatus,
        riskLevel: reservation.riskLevel,
      },
      runLearning: false,
    }).catch((error) => {
      warnings.push(`event:${error.message}`);
      return null;
    }),
    enqueueReservationAutomation(reservation).catch((error) => {
      warnings.push(`jobs:${error.message}`);
      return [];
    }),
    enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus || body.validationStatus,
    }).catch((error) => {
      warnings.push(`communications:${error.message}`);
      return [];
    }),
  ]);

  return { warnings, communications };
}

module.exports = {
  afterReservationCreated,
  prepareReservationOps,
};
