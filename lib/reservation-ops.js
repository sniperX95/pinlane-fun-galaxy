const { createOpsEvent, readStaffState } = require('./database');
const { planningAgent } = require('./ops-agents');
const { dispatchDueCommunications, enqueueReservationCommunications } = require('./ops-communications');
const { normalizeReservationRequest } = require('./reservation-request');
const { shouldRequestHumanReview } = require('./validation-policy');

function timeToMinutes(value) {
  const [hours, minutes = 0] = String(value || '0:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
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
  const safePlan = {
    ...plan,
    ok: plan.ok !== false,
    formulaId,
    formulaName,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts : [],
    risk: plan.risk || { level: plan.riskLevel || 'low', score: Number(plan.riskScore || 20), reasons: [] },
    marketIntelligence: plan.marketIntelligence || { qualityScore: 90, warnings: [] },
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
  let planResult = null;

  try {
    const snapshot = await readStaffState(request.date, centerId);
    const reservations = ignoreReservationId
      ? snapshot.reservations.filter((reservation) => Number(reservation.id) !== ignoreReservationId)
      : snapshot.reservations;
    const isFormula = request.type === 'formule';
    const isDirectLaser = request.type === 'laser';
    const trustedClientPlan = channel === 'public'
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

  const recommended = planResult?.plan?.recommended || null;
  const isFormula = request.type === 'formule';
  const blockingConflicts = recommended?.conflicts?.some((conflict) => conflict.severity === 'blocking');
  const criticalRisk = recommended?.risk?.level === 'critical';
  const noSafeFormulaPlan = isFormula && planResult && planResult.ok === false;
  const policyReview = shouldRequestHumanReview({
    isFormula,
    validationMode: planResult?.plan?.validationMode,
    recommended,
    planOk: Boolean(planResult?.ok),
  });
  const validationStatus = request.validationStatus
    || (noSafeFormulaPlan || blockingConflicts || criticalRisk || policyReview ? 'staff_review' : 'confirmed');
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
    blockOnlineConfirmation: channel === 'public' && noSafeFormulaPlan,
    planWarning: planResult?.warning || null,
  };
}

async function afterReservationCreated(reservation, body = {}) {
  const warnings = [];

  try {
    await createOpsEvent({
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
    });
  } catch (error) {
    warnings.push(`event:${error.message}`);
  }

  try {
    const communications = await enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus || body.validationStatus,
    });
    const dispatch = await dispatchDueCommunications({ limit: 10 });
    if (dispatch.results?.some((result) => result.error)) {
      warnings.push('communications_dispatch:certains mails devront etre relances depuis le cockpit direction.');
    }
    return { warnings, communications };
  } catch (error) {
    warnings.push(`communications:${error.message}`);
    return { warnings, communications: [] };
  }
}

module.exports = {
  afterReservationCreated,
  prepareReservationOps,
};
