const {
  FORMULES,
  LASER_GAME_OPTIONS,
  PAIRS,
  currentTimeDecimal,
  getBasePrice,
  getFormuleAvailability,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getHolidayContext,
  getRequiredLaneCount,
  getSchedule,
  numToTime,
  reservationNeedsLanes,
  roundUpHalfHour,
  timeToNum,
  todayStr,
  TOTAL_LANES,
} = require('../lib/booking-config');
const { getPool, readAvailabilitySnapshot, validateReservationResources } = require('../lib/database');
const { sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { planningAgent } = require('../lib/ops-agents');
const { getActivity, getCenter, getFormula, refreshCenterOverrides } = require('../lib/ops-knowledge');

const LASER_ARENA_MINUTES = 25;
const FORMULA_ARRIVAL_MINUTES = 5;
const FORMULA_TRANSITION_MINUTES = 5;
const FLEXIBLE_SLOT_STEP_MINUTES = 15;

function overlap(startA, durationA, startB, durationB) {
  return startA < startB + durationB && startB < startA + durationA;
}

function readBlockHour(block, key, fallback = 0) {
  const raw = Number(block?.[key]);
  if (Number.isFinite(raw)) return raw > 24 ? raw / 60 : raw;
  const timeKey = key === 'start' ? 'startTime' : 'endTime';
  if (block?.[timeKey]) return timeToNum(block[timeKey]);
  return fallback;
}

function getLaserOptionFromRequest(url, fallbackDuration = 0.5) {
  const requestedGames = Number(url.searchParams.get('laserGames') || url.searchParams.get('games') || url.searchParams.get('gameCount') || 0);
  if (requestedGames >= 1) {
    const normalizedGames = Math.max(1, Math.min(3, Math.trunc(requestedGames)));
    const option = LASER_GAME_OPTIONS.find((item) => Number(item.games) === normalizedGames);
    if (option) return option;
  }
  return LASER_GAME_OPTIONS.find((item) => Number(item.value) === Number(fallbackDuration)) || LASER_GAME_OPTIONS[0];
}

function laneWindowsFromReservation(reservation) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const planned = blocks
    .filter((block) => block.resourceType === 'bowling_lane')
    .map((block) => {
      const start = readBlockHour(block, 'start');
      const end = readBlockHour(block, 'end', start + Number(block.durationMinutes || 60) / 60);
      return {
        start,
        duration: Math.max(0, end - start),
        lanes: (block.lanes?.length ? block.lanes : reservation.lanes || []).map(Number),
      };
    })
    .filter((window) => window.duration > 0 && window.lanes.length);
  if (planned.length) return planned;
  return [{
    start: timeToNum(reservation.startTime),
    duration: Number(reservation.duration),
    lanes: (reservation.lanes || []).map(Number),
  }];
}

function laserWindowsFromReservation(reservation) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const planned = blocks
    .filter((block) => block.resourceType === 'laser_arena')
    .map((block) => {
      const start = readBlockHour(block, 'start') * 60;
      const rawEnd = readBlockHour(block, 'end', (start / 60) + (LASER_ARENA_MINUTES / 60)) * 60;
      return {
        start,
        end: Math.min(rawEnd, start + LASER_ARENA_MINUTES),
        players: Number(block.players || reservation.pax || 0),
      };
    })
    .filter((window) => window.end > window.start);
  if (planned.length) return planned;
  if (reservation.type === 'formule' || reservation.formuleId) {
    return getFormulaFallbackLaserWindows(reservation);
  }
  if (reservation.type === 'laser') {
    const start = Math.round(timeToNum(reservation.startTime) * 60);
    return [{
      start,
      end: start + LASER_ARENA_MINUTES,
      players: Number(reservation.pax || 0),
    }];
  }
  return [];
}

function getFormulaFallbackLaserWindows(reservation) {
  if (!reservation?.formuleId) return [];
  const formulaDoc = getFormula(reservation.formuleId);
  const games = getFormulaStepCount(formulaDoc, 'laser_game');
  if (!games) return [];

  const players = Math.max(1, Number(reservation.pax || 1));
  const arrivalMinutes = players >= 12 ? 10 : 5;
  const bowlingWindows = laneWindowsFromReservation(reservation);
  const firstLaserStart = bowlingWindows.length
    ? Math.round(Math.max(...bowlingWindows.map((window) => window.start + window.duration)) * 60) + FORMULA_TRANSITION_MINUTES
    : Math.round(timeToNum(reservation.startTime) * 60) + arrivalMinutes;
  let cursor = Math.max(0, firstLaserStart);
  const windows = [];

  for (let index = 0; index < games; index += 1) {
    windows.push({
      start: cursor,
      end: cursor + LASER_ARENA_MINUTES,
      players,
      countIndex: index + 1,
      formulaFallback: true,
    });
    cursor += LASER_ARENA_MINUTES + FORMULA_TRANSITION_MINUTES;
  }

  return windows;
}

function getOccupiedLanes(reservations, startTime, duration) {
  const occupied = new Set();
  const requestStart = timeToNum(startTime);

  reservations.forEach((reservation) => {
    laneWindowsFromReservation(reservation).forEach((window) => {
      if (overlap(requestStart, Number(duration), window.start, window.duration)) {
        window.lanes.forEach((lane) => occupied.add(Number(lane)));
      }
    });
  });

  return occupied;
}

function getFormulaTimedActivityOrder(formulaDoc, activityOrder = []) {
  const steps = Array.isArray(formulaDoc?.steps) ? formulaDoc.steps : [];
  const timed = steps
    .filter((step) => ['bowling_lane', 'laser_arena', 'party_table'].includes(step.resourceType || getActivity(step.activityId)?.resourceType || ''))
    .map((step) => step.activityId)
    .filter(Boolean)
    .filter((activityId, index, list) => list.indexOf(activityId) === index);
  const requested = activityOrder.filter((activityId) => timed.includes(activityId));
  return [
    ...requested,
    ...timed.filter((activityId) => !requested.includes(activityId)),
  ];
}

function getFormulaDisplayOrder(formulaDoc, activityOrder = []) {
  const steps = Array.isArray(formulaDoc?.steps) ? formulaDoc.steps : [];
  const ids = steps
    .map((step) => step.activityId)
    .filter(Boolean)
    .filter((activityId) => !String(activityId).includes('service_drinks'))
    .filter((activityId, index, list) => list.indexOf(activityId) === index);
  const requested = activityOrder.filter((activityId) => ids.includes(activityId));
  return [
    ...requested,
    ...ids.filter((activityId) => !requested.includes(activityId)),
  ];
}

function getFormulaStepCount(formulaDoc, activityId) {
  return (formulaDoc?.steps || [])
    .filter((step) => step.activityId === activityId)
    .reduce((sum, step) => sum + Math.max(1, Number(step.count || 1)), 0);
}

function getFormulaStepDurationMinutes(formulaDoc, formula, activityId) {
  if (activityId === 'bowling') return Math.max(30, Number(getFormuleLaneDuration(formula) || 1) * 60);
  if (activityId === 'laser_game') return LASER_ARENA_MINUTES;
  const step = (formulaDoc?.steps || []).find((item) => item.activityId === activityId);
  const activity = getActivity(activityId);
  if (step?.durationMinutes) return Number(step.durationMinutes);
  return Number(activity?.durationModel?.defaultMinutes || activity?.durationModel?.gameMinutes || 30);
}

function minuteRange(startMinute, endMinute, stepMinutes = FLEXIBLE_SLOT_STEP_MINUTES) {
  const values = [];
  for (let value = Math.ceil(startMinute / stepMinutes) * stepMinutes; value <= endMinute; value += stepMinutes) {
    values.push(value);
  }
  return values;
}

function getFormulaActivityCandidates({ activityId, formulaDoc, formula, pax, snapshot, laneStatuses, schedule, minStartMinute, closeMinute, preferredTimes, laneCount, center }) {
  if (center.activityAvailability && center.activityAvailability[activityId] !== true) return [];
  const preferred = preferredTimes?.[activityId] ? [Math.round(timeToNum(preferredTimes[activityId]) * 60)] : null;
  const duration = getFormulaStepDurationMinutes(formulaDoc, formula, activityId);
  let laserExisting = [];
  let candidates = preferred || minuteRange(minStartMinute, closeMinute - duration);
  if (activityId === 'laser_game') {
    laserExisting = snapshot.reservations.flatMap(laserWindowsFromReservation);
    if (!preferred) {
      candidates = [...new Set([
        ...candidates,
        ...laserExisting
          .map((window) => Number(window.start))
          .filter((start) => Number.isFinite(start) && start >= minStartMinute && start + duration <= closeMinute),
      ])].sort((left, right) => left - right);
    }
  }
  return candidates
    .map((start) => {
      if (start < minStartMinute || start + duration > closeMinute) return null;
      if (activityId === 'bowling') {
        const lanes = allocateLanes(laneCount, snapshot.reservations, laneStatuses, numToTime(start / 60), duration / 60, Number(center.resources?.bowling?.laneCount) || TOTAL_LANES);
        if (!lanes) return null;
        return { activityId, start, end: start + duration, lanes, players: pax };
      }
      if (activityId === 'laser_game') {
        const end = start + LASER_ARENA_MINUTES;
        const overlapping = laserExisting.filter((window) => start < window.end && window.start < end);
        const sessionKey = `${start}-${end}`;
        const keys = new Set(overlapping.map((window) => `${window.start}-${window.end}`));
        const joinsExisting = keys.has(sessionKey);
        const launchCount = keys.size + (joinsExisting ? 0 : 1);
        const playersBefore = overlapping.reduce((sum, window) => sum + Number(window.players || 0), 0);
        const weaponCount = Number(center.resources?.laser?.weaponCount || 30);
        const parallelLaunches = Number(center.resources?.laser?.parallelLaunches || 1);
        const playersTotal = playersBefore + pax;
        if (launchCount > parallelLaunches || playersTotal > weaponCount) return null;
        return {
          activityId,
          start,
          end,
          players: pax,
          playersBefore,
          playersTotal,
          remainingWeapons: Math.max(0, weaponCount - playersTotal),
          sharedSession: playersBefore > 0,
          mayShareSession: playersTotal < weaponCount,
        };
      }
      return { activityId, start, end: start + duration, players: pax };
    })
    .filter(Boolean);
}

function buildFlexibleFormulaScenario({ center, formulaDoc, formula, pax, order, selected }) {
  const selectedByActivity = new Map(selected.map((item) => [item.activityId, item]));
  const firstSelected = selected.reduce((min, item) => Math.min(min, item.start), Infinity);
  if (!Number.isFinite(firstSelected)) return null;

  let cursor = Math.max(0, firstSelected - FORMULA_ARRIVAL_MINUTES);
  const timeline = [{
    type: 'service',
    label: 'Accueil / vérification groupe',
    resourceType: 'bar_service',
    start: cursor,
    end: cursor + FORMULA_ARRIVAL_MINUTES,
    startTime: numToTime(cursor / 60),
    endTime: numToTime((cursor + FORMULA_ARRIVAL_MINUTES) / 60),
  }];
  cursor += FORMULA_ARRIVAL_MINUTES;
  const resourceBlocks = [];

  for (const activityId of order) {
    const fixed = selectedByActivity.get(activityId);
    const activity = getActivity(activityId);
    const resourceType = activityId === 'bowling' ? 'bowling_lane' : activityId === 'laser_game' ? 'laser_arena' : (activity?.resourceType || 'soft_capacity');
    const duration = getFormulaStepDurationMinutes(formulaDoc, formula, activityId);
    const start = fixed ? fixed.start : cursor;
    if (start < cursor) return null;
    const end = fixed ? fixed.end : start + duration;
    const step = {
      type: 'activity',
      activityId,
      label: activity?.name || activityId,
      resourceType,
      start,
      end,
      startTime: numToTime(start / 60),
      endTime: numToTime(end / 60),
      durationMinutes: end - start,
      critical: resourceType === 'bowling_lane' || resourceType === 'laser_arena',
    };
    if (activityId === 'bowling') {
      step.requiredLanes = fixed?.lanes?.length || 1;
      step.lanes = fixed?.lanes || [];
      step.players = pax;
    }
    if (activityId === 'laser_game') {
      step.players = fixed?.players || pax;
      step.playersBefore = fixed?.playersBefore || 0;
      step.playersTotal = fixed?.playersTotal || pax;
      step.remainingWeapons = fixed?.remainingWeapons ?? Math.max(0, Number(center.resources?.laser?.weaponCount || 30) - pax);
      step.sharedSession = Boolean(fixed?.sharedSession);
      step.mayShareSession = fixed?.mayShareSession !== false;
      step.countIndex = 1;
    }
    timeline.push(step);
    if (['bowling_lane', 'laser_arena', 'party_table'].includes(resourceType)) resourceBlocks.push(step);
    cursor = end;
    if (order.indexOf(activityId) < order.length - 1) {
      timeline.push({
        type: 'service',
        label: 'Transition libre',
        resourceType: 'transition',
        start: cursor,
        end: cursor + FORMULA_TRANSITION_MINUTES,
        startTime: numToTime(cursor / 60),
        endTime: numToTime((cursor + FORMULA_TRANSITION_MINUTES) / 60),
      });
      cursor += FORMULA_TRANSITION_MINUTES;
    }
  }

  const bowlingBlock = resourceBlocks.find((block) => block.resourceType === 'bowling_lane');
  const laserBlock = resourceBlocks.find((block) => block.resourceType === 'laser_arena');
  const laserCount = getFormulaStepCount(formulaDoc, 'laser_game');
  const fixedCommitments = resourceBlocks.map((block) => ({
    type: block.resourceType === 'bowling_lane' ? 'bowling' : block.resourceType === 'laser_arena' ? 'laser_game' : block.resourceType,
    label: block.resourceType === 'bowling_lane' ? 'Bowling' : block.resourceType === 'laser_arena' ? 'Laser Game' : block.label,
    startTime: block.startTime,
    endTime: block.endTime,
    lanes: block.lanes || [],
    players: Number(block.players || pax),
    remainingPlaces: block.resourceType === 'laser_arena' ? block.remainingWeapons : undefined,
    countIndex: block.countIndex || 1,
  }));
  return {
    ok: true,
    start: timeline[0].start,
    end: cursor,
    startTime: timeline[0].startTime,
    endTime: numToTime(cursor / 60),
    totalMinutes: cursor - timeline[0].start,
    bufferMinutes: 0,
    risk: { level: center.id === 'libramont' && laserBlock ? 'medium' : 'low', score: laserBlock ? 35 : 15, reasons: [] },
    staffSummary: [
      bowlingBlock ? `Bowling ${bowlingBlock.startTime}-${bowlingBlock.endTime}` : '',
      laserBlock ? `Laser ${laserBlock.startTime}-${laserBlock.endTime}` : '',
    ].filter(Boolean).join(' | '),
    assignedLanes: bowlingBlock?.lanes || [],
    timeline,
    resourceBlocks,
    marketIntelligence: { qualityScore: 92, warnings: [] },
    entitlements: {
      fixedCommitments,
      flexibleEntitlements: (formulaDoc.steps || [])
        .filter((step) => !['bowling', 'laser_game'].includes(step.activityId) && step.activityId !== 'service_drinks')
        .map((step) => ({ type: step.activityId, label: getActivity(step.activityId)?.name || step.activityId })),
    },
    operationsChecklist: [
      laserBlock ? { title: 'Prévenir le client que le Laser Game peut être partagé selon l’affluence.' } : null,
      laserCount > 1 ? { title: `${laserCount - 1} partie(s) Laser restante(s) à placer par le staff si le client veut une pause.` } : null,
    ].filter(Boolean),
    customerCommitment: [
      'Vos horaires choisis sont enregistrés. Les activités sans horaire fixe restent libres sur place.',
      laserBlock ? 'Le Laser Game peut être complété avec d’autres joueurs selon l’affluence.' : '',
    ].filter(Boolean),
    firstBowlingTime: bowlingBlock?.startTime || '',
    firstLaserTime: laserBlock?.startTime || '',
    laserSharing: laserBlock ? {
      mayShare: laserBlock.mayShareSession !== false,
      sharedNow: Boolean(laserBlock.sharedSession),
      requestedPlayers: pax,
      remainingPlaces: laserBlock.remainingWeapons,
      waveCount: 1,
      launchCount: 1,
    } : null,
    laserPassPlan: laserCount > 1 && laserBlock ? {
      mode: 'manual_after_first',
      totalGames: laserCount,
      scheduledGames: 1,
      remainingGames: laserCount - 1,
      scheduledPasses: [{ countIndex: 1, startTime: laserBlock.startTime, endTime: laserBlock.endTime, status: 'scheduled' }],
    } : null,
  };
}

function buildFlexibleFormulaSlots({ centerId, date, formula, formulaDoc, pax, snapshot, schedule, minTime, maxTime, activityOrder, preferredTimes, laneCount }) {
  const center = getCenter(centerId);
  const openMinute = Math.round(minTime * 60);
  const closeMinute = Math.round((maxTime || schedule.close) * 60);
  const order = getFormulaDisplayOrder(formulaDoc, activityOrder);
  const timedOrder = getFormulaTimedActivityOrder(formulaDoc, activityOrder);
  if (!timedOrder.length) return [];
  const candidates = {};
  timedOrder.forEach((activityId) => {
    candidates[activityId] = getFormulaActivityCandidates({
      activityId,
      formulaDoc,
      formula,
      pax,
      snapshot,
      laneStatuses: snapshot.laneStatuses || {},
      schedule,
      minStartMinute: openMinute + FORMULA_ARRIVAL_MINUTES,
      closeMinute,
      preferredTimes,
      laneCount,
      center,
    });
  });
  if (timedOrder.some((activityId) => !candidates[activityId]?.length)) return [];

  const selected = [];
  const scenarios = [];
  const walk = (index) => {
    if (scenarios.length >= 180) return;
    if (index >= timedOrder.length) {
      const scenario = buildFlexibleFormulaScenario({ center, formulaDoc, formula, pax, order, selected: [...selected] });
      if (!scenario) return;
      if (scenario.end > closeMinute) return;
      scenarios.push(scenario);
      return;
    }
    const activityId = timedOrder[index];
    candidates[activityId].forEach((candidate) => {
      selected.push(candidate);
      walk(index + 1);
      selected.pop();
    });
  };
  walk(0);

  return scenarios
    .sort((left, right) => (
      left.start - right.start
      || left.end - right.end
    ))
    .map((scenario) => toFormulaSlot(scenario, snapshot, getFormuleLaneDuration(formula)));
}

function centerLaneBound(centerId) {
  try {
    const value = Number(getCenter(centerId || 'libramont')?.resources?.bowling?.laneCount);
    return Number.isFinite(value) && value > 0 ? value : TOTAL_LANES;
  } catch (error) {
    return TOTAL_LANES;
  }
}

function getFreeCount(reservations, laneStatuses, startTime, duration, laneCount = TOTAL_LANES) {
  const occupied = getOccupiedLanes(reservations, startTime, duration);
  let count = 0;
  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!occupied.has(lane) && laneStatuses[lane] !== 'maintenance') {
      count += 1;
    }
  }
  return count;
}

function allocateLanes(requiredCount, reservations, laneStatuses, startTime, duration, laneCount = TOTAL_LANES) {
  if (!requiredCount) return [];

  const occupied = getOccupiedLanes(reservations, startTime, duration);
  const available = [];

  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!occupied.has(lane) && laneStatuses[lane] !== 'maintenance') {
      available.push(lane);
    }
  }

  if (available.length < requiredCount) return null;

  if (requiredCount === 1) {
    for (const pair of PAIRS) {
      if (available.includes(pair[0]) && !available.includes(pair[1])) return [pair[0]];
      if (!available.includes(pair[0]) && available.includes(pair[1])) return [pair[1]];
    }
    return [available[0]];
  }

  if (requiredCount === 2) {
    for (const pair of PAIRS) {
      if (available.includes(pair[0]) && available.includes(pair[1])) return [...pair];
    }
  }

  for (let index = 0; index <= available.length - requiredCount; index += 1) {
    const group = [available[index]];
    let contiguous = true;

    for (let offset = 1; offset < requiredCount; offset += 1) {
      if (available[index + offset] === group[group.length - 1] + 1) {
        group.push(available[index + offset]);
      } else {
        contiguous = false;
        break;
      }
    }

    if (contiguous) return group;
  }

  return available.slice(0, requiredCount);
}

function findBowlingBlock(scenario) {
  return (scenario?.resourceBlocks || []).find((block) => block.resourceType === 'bowling_lane') || null;
}

function firstActivityTime(scenario, activityId) {
  const step = (scenario?.timeline || []).find((item) => item.activityId === activityId);
  return step?.startTime || '';
}

function toFormulaSlot(scenario, snapshot, duration) {
  const bowlingBlock = findBowlingBlock(scenario);
  const laneStart = bowlingBlock?.startTime || scenario.startTime;
  const laneDuration = bowlingBlock?.durationMinutes ? bowlingBlock.durationMinutes / 60 : duration;

  return {
    time: scenario.startTime,
    lanes: scenario.assignedLanes || [],
    freeCount: getFreeCount(snapshot.reservations, snapshot.laneStatuses, laneStart, laneDuration, centerLaneBound(snapshot.centerId)),
    opsPlan: {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      totalMinutes: scenario.totalMinutes,
      bufferMinutes: scenario.bufferMinutes,
      risk: scenario.risk,
      staffSummary: scenario.staffSummary,
      assignedLanes: scenario.assignedLanes || [],
      timeline: scenario.timeline || [],
      resourceBlocks: scenario.resourceBlocks || [],
      marketIntelligence: scenario.marketIntelligence || null,
      entitlements: scenario.entitlements || null,
      operationsChecklist: scenario.operationsChecklist || [],
      customerCommitment: scenario.customerCommitment || [],
      firstLaserTime: firstActivityTime(scenario, 'laser_game'),
      firstBowlingTime: firstActivityTime(scenario, 'bowling'),
      laserSharing: scenario.laserSharing || null,
    },
  };
}

function firstLaserBlock(scenario) {
  return (scenario?.resourceBlocks || []).find((block) => block.resourceType === 'laser_arena') || null;
}

function toLaserSlot(scenario, pax) {
  const laserBlock = firstLaserBlock(scenario);
  const sharing = scenario.laserSharing || {};
  return {
    time: scenario.startTime,
    lanes: [],
    freeCount: sharing.remainingPlaces ?? laserBlock?.remainingWeapons ?? 0,
    groupPlayers: Number(pax || sharing.requestedPlayers || 0),
    waveCount: sharing.waveCount || 1,
    launchCount: sharing.launchCount || 1,
    splitGroup: Boolean(sharing.splitGroup),
    maxSessionPlayers: sharing.playersTotal ?? laserBlock?.playersTotal ?? laserBlock?.players ?? 0,
    sharedSession: Boolean(sharing.sharedNow),
    mayShareSession: sharing.mayShare !== false,
    opsPlan: {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      totalMinutes: scenario.totalMinutes,
      bufferMinutes: scenario.bufferMinutes,
      risk: scenario.risk,
      staffSummary: scenario.staffSummary,
      assignedLanes: [],
      timeline: scenario.timeline || [],
      resourceBlocks: scenario.resourceBlocks || [],
      marketIntelligence: scenario.marketIntelligence || null,
      entitlements: scenario.entitlements || null,
      operationsChecklist: scenario.operationsChecklist || [],
      customerCommitment: scenario.customerCommitment || [],
      firstLaserTime: firstActivityTime(scenario, 'laser_game'),
      laserSharing: scenario.laserSharing || null,
    },
  };
}

function slotPassesFinalGuards(slot, context) {
  try {
    validateReservationResources(
      {
        centerId: context.centerId,
        channel: 'public',
        name: 'Availability Probe',
        phone: '+32000000000',
        email: '',
        date: context.date,
        startTime: slot.time,
        duration: context.duration,
        totalDuration: context.totalDuration,
        lanes: slot.lanes || [],
        pax: context.pax,
        status: 'pending',
        basePrice: 0,
        price: 0,
        type: context.type,
        formuleId: context.formuleId || '',
        label: context.label || 'Availability Probe',
        opsPlan: slot.opsPlan || null,
        laneCount: context.laneCount || 0,
        requiresLanes: Boolean(context.requiresLanes),
      },
      context.snapshot.reservations || [],
      context.snapshot.laneStatuses || {},
    );
    return true;
  } catch (error) {
    return false;
  }
}

function filterSlotsByFinalGuards(slots, context) {
  return slots.filter((slot) => slotPassesFinalGuards(slot, context));
}

module.exports = async (req, res) => {
  setCors(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  if (enforceRateLimit(req, res, { scope: 'public-availability', limit: 60, windowMs: 60_000 })) {
    return;
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const date = String(url.searchParams.get('date') || '');
    const centerId = String(url.searchParams.get('centerId') || 'libramont');
    // Reflect the latest per-center config edits (cached ~30s). Fails soft on a
    // DB outage: the file baseline is used so availability never breaks.
    try {
      await refreshCenterOverrides(getPool());
    } catch (error) {
      // Ignore: fall back to the file baseline.
    }
    let centerDoc = null;
    try {
      centerDoc = getCenter(centerId) || null;
    } catch (error) {
      centerDoc = null;
    }
    const centerBowlingConfig = centerDoc?.resources?.bowling || null;
    const centerLaneCount = Number(centerBowlingConfig?.laneCount) || TOTAL_LANES;
    const rawType = String(url.searchParams.get('type') || 'bowling');
    const type = rawType === 'formule' ? 'formule' : rawType === 'laser' ? 'laser' : 'bowling';
    const pax = Math.max(1, Number(url.searchParams.get('pax') || 1));
    const formuleId = String(url.searchParams.get('formuleId') || '');
    const requestedDuration = Number(url.searchParams.get('duration') || (type === 'laser' ? 0.5 : 1));
    const formule = FORMULES.find((item) => item.id === formuleId) || null;
    const firstActivityId = String(url.searchParams.get('firstActivityId') || '');
    const preferredBowlingTime = String(url.searchParams.get('preferredBowlingTime') || '');
    const preferredLaserTime = String(url.searchParams.get('preferredLaserTime') || '');
    const activityOrder = String(url.searchParams.get('activityOrder') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    let preferredTimes = {};
    try {
      preferredTimes = JSON.parse(String(url.searchParams.get('preferredTimes') || '{}')) || {};
    } catch (error) {
      preferredTimes = {};
    }
    if (preferredBowlingTime) preferredTimes.bowling = preferredBowlingTime;
    if (preferredLaserTime) preferredTimes.laser_game = preferredLaserTime;
    const pauseMinutes = 0;

    if (!date) {
      throw new Error('Date manquante.');
    }

    // Horaires + contexte vacances/feries resolus avec la config du centre
    // (grille staff, overrides ponctuels). Renvoyes au client pour que
    // l'affichage "Ouvert 10h - 22h" reflete la meme verite que le serveur.
    const holidayContext = getHolidayContext(date, centerDoc);
    const schedule = getSchedule(date, centerDoc);
    const scheduleMeta = {
      schedule: schedule ? { open: schedule.open, close: schedule.close, label: schedule.label } : null,
      holiday: {
        active: holidayContext.active,
        periodType: holidayContext.periodType,
        label: holidayContext.label,
      },
    };

    if (date < todayStr()) {
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: [],
        laneCount: 0,
        duration: 0,
        totalDuration: 0,
        price: 0,
        requiresLanes: false,
        label: type === 'formule' && formule ? formule.name : type === 'laser' ? 'Laser Game' : 'Bowling Classique',
        message: 'Cette date est déjà passée.',
      });
      return;
    }

    if (type === 'formule' && !formule) {
      throw new Error('Formule invalide.');
    }

    if (!schedule) {
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: [],
        laneCount: 0,
        duration: 0,
        totalDuration: 0,
        price: 0,
        requiresLanes: false,
        label: type === 'formule' ? formule.name : type === 'laser' ? 'Laser Game' : 'Bowling Classique',
        message: 'Le centre est fermé à cette date.',
      });
      return;
    }

    if (type === 'formule') {
      const availability = getFormuleAvailability(formule, date, pax, '', centerDoc);
      if (!availability.ok) {
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: [],
          laneCount: getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig),
          duration: getFormuleLaneDuration(formule),
          totalDuration: getFormuleTotalDuration(formule),
          price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId),
          requiresLanes: reservationNeedsLanes(type, formuleId),
          label: formule.name,
          message: availability.message,
        });
        return;
      }
    }

    const snapshot = await readAvailabilitySnapshot(date, centerId);
    const laserOption = getLaserOptionFromRequest(url, requestedDuration);
    const duration = type === 'formule' ? getFormuleLaneDuration(formule) : type === 'laser' ? laserOption.value : requestedDuration;
    const totalDuration = type === 'formule' ? getFormuleTotalDuration(formule) : type === 'laser' ? laserOption.value : requestedDuration;
    const laneCount = getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig);
    const requiresLanes = reservationNeedsLanes(type, formuleId);
    let minTime = schedule.open;
    let maxTime = schedule.close - totalDuration;

    if (formule && formule.timeLimit) {
      if (formule.timeLimit.min) minTime = Math.max(minTime, formule.timeLimit.min);
      if (formule.timeLimit.max) maxTime = Math.min(maxTime, formule.timeLimit.max - totalDuration);
    }

    if (date === todayStr()) {
      minTime = Math.max(minTime, roundUpHalfHour(currentTimeDecimal()));
    }

    if (type === 'formule') {
      const formulaDoc = getFormula(formuleId);
      const hasManualFormulaChoice = activityOrder.length > 0 || Object.values(preferredTimes || {}).some(Boolean);
      if (hasManualFormulaChoice) {
        const flexibleSlots = buildFlexibleFormulaSlots({
          centerId,
          date,
          formula: formule,
          formulaDoc,
          pax,
          snapshot,
          schedule,
          minTime,
          maxTime: formule?.timeLimit?.max ? Math.min(maxTime + totalDuration, formule.timeLimit.max) : schedule.close,
          activityOrder,
          preferredTimes,
          laneCount,
        });
        const guardedFlexibleSlots = filterSlotsByFinalGuards(flexibleSlots, {
          centerId,
          date,
          type,
          formuleId,
          pax,
          duration,
          totalDuration,
          laneCount,
          requiresLanes,
          label: formule.name,
          snapshot,
        });
        if (guardedFlexibleSlots.length) {
          sendJson(res, 200, {
            ok: true,
            date,
            ...scheduleMeta,
            slots: guardedFlexibleSlots,
            laneCount,
            duration,
            totalDuration,
            price: getBasePrice(type, duration, laneCount, pax, formuleId),
            requiresLanes,
            label: formule.name,
            message: '',
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: [],
          laneCount,
          duration,
          totalDuration,
          price: getBasePrice(type, duration, laneCount, pax, formuleId),
          requiresLanes,
          label: formule.name,
          message: 'Aucune combinaison disponible avec ces heures. Choisissez un autre horaire.',
        });
        return;
      }
      const slotsByPlan = new Map();

      for (let value = minTime; value <= maxTime; value += 0.5) {
        const startTime = numToTime(value);
        const plan = planningAgent(
          {
            centerId,
            date,
            type,
            formuleId,
            pax,
            startTime,
            duration,
            preference: {
              firstActivityId,
              activityOrder,
              arrivalConfidence: 'normal',
              preferredTimes,
            },
            pauseMinutes,
          },
          {
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
          },
        );
        const recommended = plan?.plan?.recommended;
        const scenarios = Array.isArray(plan?.plan?.scenarios) && plan.plan.scenarios.length
          ? plan.plan.scenarios
          : recommended
            ? [recommended]
            : [];

        scenarios
          .filter((scenario) => scenario && scenario.ok)
          .forEach((scenario) => {
            const slot = toFormulaSlot(scenario, snapshot, duration);
            const key = [
              slot.time,
              slot.opsPlan?.firstBowlingTime || '',
              slot.opsPlan?.firstLaserTime || '',
              slot.opsPlan?.endTime || '',
            ].join('|');
            if (!slotsByPlan.has(key)) {
              slotsByPlan.set(key, slot);
            }
          });
      }

      const slots = [...slotsByPlan.values()].sort((left, right) => (
        timeToNum(left.time) - timeToNum(right.time)
        || timeToNum(left.opsPlan?.firstBowlingTime || left.opsPlan?.firstLaserTime || left.time)
          - timeToNum(right.opsPlan?.firstBowlingTime || right.opsPlan?.firstLaserTime || right.time)
        || timeToNum(left.opsPlan?.firstLaserTime || left.opsPlan?.firstBowlingTime || left.time)
          - timeToNum(right.opsPlan?.firstLaserTime || right.opsPlan?.firstBowlingTime || right.time)
        || timeToNum(left.opsPlan?.endTime || left.time) - timeToNum(right.opsPlan?.endTime || right.time)
      ));
      const guardedSlots = filterSlotsByFinalGuards(slots, {
        centerId,
        date,
        type,
        formuleId,
        pax,
        duration,
        totalDuration,
        laneCount,
        requiresLanes,
        label: formule.name,
        snapshot,
      });
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: guardedSlots,
        laneCount,
        duration,
        totalDuration,
        price: getBasePrice(type, duration, laneCount, pax, formuleId),
        requiresLanes,
        label: formule.name,
        message: guardedSlots.length ? '' : 'Aucun scénario automatique sûr pour cette formule. Essayez un autre horaire, un autre ordre ou contactez le centre.',
      });
      return;
    }

    if (type === 'laser') {
      const slotsByTime = new Map();
      const candidateMinutes = new Set();

      for (let value = minTime; value <= maxTime; value += 0.5) {
        candidateMinutes.add(Math.round(value * 60));
      }

      snapshot.reservations
        .flatMap(laserWindowsFromReservation)
        .forEach((window) => {
          const startMinute = Math.round(Number(window.start || 0));
          if (startMinute >= Math.round(minTime * 60) && startMinute <= Math.round(maxTime * 60)) {
            candidateMinutes.add(startMinute);
          }
        });

      for (const startMinute of [...candidateMinutes].sort((left, right) => left - right)) {
        const startTime = numToTime(startMinute / 60);
        const plan = planningAgent(
          {
            centerId,
            date,
            type,
            pax,
            startTime,
            duration,
            laserGames: laserOption.games,
            preference: {
              arrivalConfidence: pax >= 12 ? 'uncertain' : 'normal',
            },
          },
          {
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
          },
        );
        const recommended = plan?.plan?.recommended;
        if (!recommended || !recommended.ok) continue;
        if (!slotsByTime.has(recommended.startTime)) {
          slotsByTime.set(recommended.startTime, toLaserSlot(recommended, pax));
        }
      }

      const slots = filterSlotsByFinalGuards(
        [...slotsByTime.values()].sort((left, right) => timeToNum(left.time) - timeToNum(right.time)),
        {
          centerId,
          date,
          type,
          formuleId: '',
          pax,
          duration,
          totalDuration,
          laneCount: 0,
          requiresLanes: false,
          label: `${laserOption.label} Laser Game`,
          laserGames: laserOption.games,
          snapshot,
        },
      );
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots,
        laneCount: 0,
        duration,
        totalDuration,
        price: getBasePrice(type, duration, 0, pax, ''),
        requiresLanes: false,
        label: `${laserOption.label} Laser Game`,
        laserGames: laserOption.games,
        message: slots.length ? '' : 'Aucun départ Laser Game disponible pour ces critères.',
      });
      return;
    }

    const slots = [];
    for (let value = minTime; value <= maxTime; value += 0.5) {
      const startTime = numToTime(value);
      const lanes = requiresLanes
        ? allocateLanes(laneCount, snapshot.reservations, snapshot.laneStatuses, startTime, duration, centerLaneCount)
        : [];

      if (!requiresLanes || lanes !== null) {
        slots.push({
          time: startTime,
          lanes: lanes || [],
          freeCount: getFreeCount(snapshot.reservations, snapshot.laneStatuses, startTime, duration, centerLaneCount),
        });
      }
    }

    sendJson(res, 200, {
      ok: true,
      date,
      ...scheduleMeta,
      slots,
      laneCount,
      duration,
      totalDuration,
      price: getBasePrice(type, duration, laneCount, pax, formuleId),
      requiresLanes,
      label: type === 'formule' ? formule.name : 'Bowling Classique',
      message: slots.length ? '' : 'Aucun créneau disponible pour ces critères.',
    });
  } catch (error) {
    sendError(res, 400, error.message || 'Impossible de charger les disponibilités.');
  }
};
