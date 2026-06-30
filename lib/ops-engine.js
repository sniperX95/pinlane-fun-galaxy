const {
  currentTimeDecimal,
  getSchedule,
  isHolidayScheduleDate,
  todayStr,
} = require('./booking-config');
const { getActivity, getCenter, getFormula, loadOpsKnowledge } = require('./ops-knowledge');

const LASER_GAME_ARENA_MINUTES = 25;
const CRITICAL_RESOURCE_TYPES = new Set(['bowling_lane', 'laser_arena', 'party_table']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function timeToMinutes(value) {
  if (typeof value === 'number') return value;
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function ceilMinutes(value, step) {
  return Math.ceil(value / step) * step;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function overlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function normalizeDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
    throw new Error('Date invalide.');
  }
  return String(dateStr);
}

function getRiskLevel(score, rules) {
  const found = rules.risk.levels.find((level) => score <= level.maxScore);
  return found ? found.id : 'critical';
}

function getBufferMinutes(score, rules) {
  return rules.buffers[getRiskLevel(score, rules)] || rules.buffers.critical;
}

function getRequiredLaneCount(center, pax, options = {}) {
  const bowling = center.resources.bowling;
  if (!bowling) return 0;
  const players = Math.max(1, Number(pax) || 1);
  if (options.allowEmergencySeventh && players <= bowling.emergencyCapacityPerLane) return 1;
  const normal = Math.ceil(players / bowling.normalCapacityPerLane);
  if (normal > bowling.laneCount && players <= bowling.laneCount * bowling.emergencyCapacityPerLane) {
    return bowling.laneCount;
  }
  return normal;
}

function getActivityDurationMinutes(step, activity, state = {}) {
  if (step.durationMinutes) return Number(step.durationMinutes);
  if (!activity) return Number(step.durationMinutes || 5);

  const model = activity.durationModel || {};
  if (activity.id === 'laser_game') {
    state.laserBriefed = true;
    return LASER_GAME_ARENA_MINUTES;
  }

  return model.defaultMinutes || model.gameMinutes || 30;
}

function splitGroupIntoWaves(pax, capacity) {
  const players = Math.max(1, Number(pax) || 1);
  const maxPerWave = Math.max(1, Number(capacity) || players);
  const waveCount = Math.max(1, Math.ceil(players / maxPerWave));
  const base = Math.floor(players / waveCount);
  const extra = players % waveCount;
  return Array.from({ length: waveCount }, (_, index) => base + (index < extra ? 1 : 0));
}

function expandFormulaSteps(formula) {
  const expanded = [];
  (formula.steps || []).forEach((step) => {
    const count = Math.max(1, Number(step.count || 1));
    for (let index = 0; index < count; index += 1) {
      expanded.push({
        ...step,
        uid: `${step.activityId || step.resourceType || 'service'}:${expanded.length + 1}`,
        countIndex: index + 1,
      });
    }
  });
  return expanded;
}

function stepResourceType(step) {
  const activity = getActivity(step.activityId);
  return step.resourceType || activity?.resourceType || 'service';
}

function isSoftStep(step) {
  const activity = getActivity(step.activityId);
  return ['soft_capacity', 'bar_service_then_autonomous'].includes(stepResourceType(step)) || activity?.planningPressure === 'low';
}

function isShockAbsorberStep(step) {
  return isSoftStep(step) && !CRITICAL_RESOURCE_TYPES.has(stepResourceType(step));
}

function addShockAbsorberOrder(steps, add, firstActivityId, secondActivityId) {
  const first = steps.filter((step) => step.activityId === firstActivityId);
  const second = steps.filter((step) => step.activityId === secondActivityId);
  const shockAbsorbers = steps.filter((step) => isShockAbsorberStep(step));
  if (!first.length || !second.length || !shockAbsorbers.length) return;

  const used = new Set([...first, ...second, ...shockAbsorbers].map((step) => step.uid));
  add([
    ...first,
    ...shockAbsorbers,
    ...second,
    ...steps.filter((step) => !used.has(step.uid)),
  ]);
}

function generateOrders(formula, preference = {}) {
  const steps = expandFormulaSteps(formula);
  const orders = [];
  const add = (items) => {
    const key = items.map((step) => step.uid).join('|');
    if (!orders.some((order) => order.key === key)) orders.push({ key, steps: items });
  };

  const activityOrder = Array.isArray(preference.activityOrder)
    ? preference.activityOrder.filter(Boolean)
    : [];
  if (activityOrder.length) {
    add([
      ...steps
        .filter((step) => activityOrder.includes(step.activityId))
        .sort((left, right) => activityOrder.indexOf(left.activityId) - activityOrder.indexOf(right.activityId)),
      ...steps.filter((step) => !activityOrder.includes(step.activityId)),
    ]);
  }

  const preferred = preference.firstActivityId;
  if (preferred) {
    add([
      ...steps.filter((step) => step.activityId === preferred),
      ...steps.filter((step) => step.activityId !== preferred),
    ]);
  }

  if (preference.useCompetitiveRouting !== false) {
    addShockAbsorberOrder(steps, add, 'bowling', 'laser_game');
    addShockAbsorberOrder(steps, add, 'laser_game', 'bowling');
  }

  add(steps);

  add([
    ...steps.filter((step) => step.activityId === 'laser_game'),
    ...steps.filter((step) => step.activityId !== 'laser_game'),
  ]);
  add([
    ...steps.filter((step) => step.activityId === 'bowling'),
    ...steps.filter((step) => step.activityId !== 'bowling'),
  ]);
  add([
    ...steps.filter((step) => isSoftStep(step)),
    ...steps.filter((step) => !isSoftStep(step)),
  ]);
  add([
    ...steps.filter((step) => step.critical),
    ...steps.filter((step) => !step.critical),
  ]);

  return orders.map((order) => order.steps);
}

function normalizePreferredTimes(preference = {}) {
  const preferredTimes = preference.preferredTimes || {};
  return {
    ...preferredTimes,
    bowling: preferredTimes.bowling || preference.preferredBowlingTime || '',
    laser_game: preferredTimes.laser_game || preference.preferredLaserTime || '',
  };
}

function hasPreferredTimeFilter(preference = {}) {
  const preferred = normalizePreferredTimes(preference);
  return Object.values(preferred).some(Boolean);
}

function scenarioActivityStartTimes(scenario, activityId) {
  return (scenario?.timeline || [])
    .filter((step) => step.activityId === activityId)
    .map((step) => step.startTime || minutesToTime(step.start))
    .filter(Boolean);
}

function scenarioMatchesPreferredTimes(scenario, preference = {}) {
  const preferred = normalizePreferredTimes(preference);
  for (const [activityId, startTime] of Object.entries(preferred)) {
    if (startTime && !scenarioActivityStartTimes(scenario, activityId).includes(startTime)) return false;
  }
  return true;
}

function scenarioMatchesActivityOrder(scenario, preference = {}) {
  const requested = Array.isArray(preference.activityOrder)
    ? preference.activityOrder.filter(Boolean)
    : [];
  if (requested.length < 2) return true;
  const ordered = (scenario?.timeline || [])
    .filter((step) => step.activityId && requested.includes(step.activityId))
    .sort((left, right) => Number(left.start || 0) - Number(right.start || 0))
    .map((step) => step.activityId)
    .filter((activityId, index, list) => list.indexOf(activityId) === index);
  const expected = requested.filter((activityId, index, list) => list.indexOf(activityId) === index);
  return expected.every((activityId, index) => ordered[index] === activityId);
}

function buildTimeline({ center, formula, pax, startMinutes, order, pauseMinutes = 0, arrivalConfidence = 'normal' }) {
  const timeline = [];
  const resourceBlocks = [];
  const state = { laserBriefed: false };
  const arrivalMinutes = arrivalConfidence === 'uncertain' || pax >= 12 ? 10 : 5;
  let cursor = startMinutes;

  timeline.push({
    type: 'service',
    label: 'Accueil / verification groupe',
    resourceType: 'bar_service',
    start: cursor,
    end: cursor + arrivalMinutes,
    startTime: minutesToTime(cursor),
    endTime: minutesToTime(cursor + arrivalMinutes),
  });
  cursor += arrivalMinutes;

  order.forEach((step, index) => {
    const activity = getActivity(step.activityId);
    const resourceType = stepResourceType(step);
    const label = activity?.name || step.label || 'Service';

    const waveSizes = resourceType === 'laser_arena'
      ? splitGroupIntoWaves(step.players || step.pax || pax, center.resources.laser?.weaponCount || pax)
      : [step.players || step.pax || pax];

    waveSizes.forEach((wavePlayers, waveIndex) => {
      const duration = getActivityDurationMinutes(step, activity, state);
      const start = cursor;
      const end = cursor + duration;
      const timelineStep = {
        type: step.activityId ? 'activity' : 'service',
        activityId: step.activityId || null,
        label: resourceType === 'laser_arena' && waveSizes.length > 1
          ? `${label} - groupe ${waveIndex + 1}/${waveSizes.length}`
          : label,
        resourceType,
        countIndex: step.countIndex || 1,
        critical: Boolean(step.critical),
        start,
        end,
        startTime: minutesToTime(start),
        endTime: minutesToTime(end),
        durationMinutes: duration,
      };

      if (resourceType === 'bowling_lane') {
        timelineStep.requiredLanes = getRequiredLaneCount(center, pax);
      }
      if (resourceType === 'laser_arena') {
        timelineStep.players = wavePlayers;
        timelineStep.groupPlayers = pax;
        timelineStep.groupWaveIndex = waveIndex + 1;
        timelineStep.groupWaveCount = waveSizes.length;
        timelineStep.weaponNeed = Math.min(wavePlayers, center.resources.laser?.weaponCount || wavePlayers);
      }
      if (resourceType === 'party_table') {
        timelineStep.tableNeed = 1;
      }

      timeline.push(timelineStep);
      if (['bowling_lane', 'laser_arena', 'party_table'].includes(resourceType)) {
        resourceBlocks.push(timelineStep);
      }

      cursor = end;
    });

    if (resourceType !== 'laser_arena' && waveSizes.length > 1) {
      cursor = timeline[timeline.length - 1].end;
    }
    const hasNextActivity = order.slice(index + 1).some((next) => stepResourceType(next) !== 'bar_service');
    if (hasNextActivity) {
      const transition = resourceType === 'laser_arena' ? 5 : 5;
      timeline.push({
        type: 'service',
        label: pauseMinutes && index === 0 ? `Pause client ${pauseMinutes} min` : 'Transition',
        resourceType: 'transition',
        start: cursor,
        end: cursor + transition + (pauseMinutes && index === 0 ? pauseMinutes : 0),
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(cursor + transition + (pauseMinutes && index === 0 ? pauseMinutes : 0)),
      });
      cursor += transition + (pauseMinutes && index === 0 ? pauseMinutes : 0);
    }
  });

  return {
    timeline,
    resourceBlocks,
    start: startMinutes,
    end: cursor,
    totalMinutes: cursor - startMinutes,
  };
}

function deferExtraStandaloneLaserPasses(scenario, games) {
  if (!scenario || Number(games || 1) <= 1) return scenario;
  const firstPassBlocks = (scenario.resourceBlocks || []).filter(
    (block) => block.resourceType === 'laser_arena' && Number(block.countIndex || 1) === 1,
  );
  if (!firstPassBlocks.length) return scenario;
  const firstPassEnd = Math.max(...firstPassBlocks.map((block) => Number(block.end || scenario.start)));
  const timeline = (scenario.timeline || []).filter((step) => {
    if (step.resourceType === 'laser_arena') return Number(step.countIndex || 1) === 1;
    return Number(step.end || 0) <= firstPassEnd;
  });
  const resourceBlocks = (scenario.resourceBlocks || []).filter(
    (block) => block.resourceType !== 'laser_arena' || Number(block.countIndex || 1) === 1 || block.manualLaserPass,
  );
  return {
    ...scenario,
    timeline,
    resourceBlocks,
    end: firstPassEnd,
    totalMinutes: firstPassEnd - Number(scenario.start || 0),
    laserPassPlan: {
      mode: 'manual_after_first',
      totalGames: games,
      scheduledGames: 1,
      remainingGames: Math.max(0, games - 1),
      pendingPasses: Array.from({ length: Math.max(0, games - 1) }, (_, index) => ({
        countIndex: index + 2,
        status: 'pending',
      })),
    },
  };
}

function attachLaserPassPlan(plan, games) {
  if (!plan || Number(games || 1) <= 1) return plan;
  const manualBlocks = (plan.resourceBlocks || []).filter(
    (block) => block.resourceType === 'laser_arena' && Number(block.countIndex || 1) > 1 && block.manualLaserPass,
  );
  const scheduledExtra = [...new Set(manualBlocks.map((block) => Number(block.countIndex || 1)))].sort((a, b) => a - b);
  const scheduledGames = 1 + scheduledExtra.length;
  const firstBlock = (plan.resourceBlocks || []).find((block) => block.resourceType === 'laser_arena');
  return {
    ...plan,
    laserPassPlan: {
      mode: 'manual_after_first',
      totalGames: games,
      scheduledGames,
      remainingGames: Math.max(0, games - scheduledGames),
      scheduledPasses: [
        { countIndex: 1, status: 'scheduled', startTime: firstBlock?.startTime || plan.startTime },
        ...scheduledExtra.map((countIndex) => ({
          countIndex,
          status: 'scheduled',
          startTime: manualBlocks.find((block) => Number(block.countIndex || 1) === countIndex)?.startTime || '',
        })),
      ],
      pendingPasses: Array.from({ length: Math.max(0, games - scheduledGames) }, (_, index) => ({
        countIndex: scheduledGames + index + 1,
        status: 'pending',
      })),
    },
  };
}

function coerceBlockMinute(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return timeToMinutes(value);
  return null;
}

function blockMinutes(block, key) {
  const direct = coerceBlockMinute(block?.[key]);
  if (direct !== null) return direct;
  return coerceBlockMinute(block?.[`${key}Time`]);
}

function blockLanes(block) {
  const lanes = Array.isArray(block?.lanes) ? block.lanes : [block?.lane, block?.assignedLane];
  return lanes
    .map((lane) => Number(lane))
    .filter((lane) => Number.isInteger(lane) && lane > 0);
}

function plannedLaneBlocksFromReservation(reservation) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks)
    ? reservation.opsPlan.resourceBlocks
    : [];
  return blocks
    .filter((block) => block?.resourceType === 'bowling_lane')
    .flatMap((block) => {
      const lanes = blockLanes(block);
      const start = blockMinutes(block, 'start');
      const end = blockMinutes(block, 'end');
      if (!lanes.length || start === null || end === null || end <= start) return [];
      return lanes.map((lane) => ({
        sourceId: reservation.id,
        resourceType: 'bowling_lane',
        lane,
        start,
        end,
        pax: reservation.pax || block.pax || 0,
      }));
    });
}

function laneBlocksFromReservation(reservation) {
  const plannedBlocks = plannedLaneBlocksFromReservation(reservation);
  if (plannedBlocks.length) return plannedBlocks;
  const duration = Number(reservation.durationMinutes || reservation.duration * 60 || 0);
  const start = timeToMinutes(reservation.startTime);
  const end = start + duration;
  return (reservation.lanes || []).map((lane) => ({
    sourceId: reservation.id,
    resourceType: 'bowling_lane',
    lane,
    start,
    end,
    pax: reservation.pax || 0,
  }));
}

function normalizeLaserArenaBlock(block) {
  if (block.resourceType !== 'laser_arena') return block;
  const start = Number.isFinite(Number(block.start)) ? Number(block.start) : timeToMinutes(block.startTime);
  const rawEnd = Number(block.end || start + LASER_GAME_ARENA_MINUTES);
  const end = Math.min(rawEnd, start + LASER_GAME_ARENA_MINUTES);
  return {
    ...block,
    start,
    end,
    durationMinutes: Math.max(0, end - start),
    endTime: minutesToTime(end),
  };
}

function inferBlocksFromReservation(reservation, center) {
  if (reservation.opsPlan?.resourceBlocks) {
    return reservation.opsPlan.resourceBlocks
      .filter((block) => !(
        reservation.type === 'laser'
        && block.resourceType === 'laser_arena'
        && Number(block.countIndex || 1) > 1
        && !block.manualLaserPass
      ))
      .map((block) => normalizeLaserArenaBlock({ ...block, sourceId: reservation.id }));
  }

  const blocks = laneBlocksFromReservation(reservation);

  if (reservation.type === 'laser') {
    const games = inferLaserGames(reservation);
    const order = Array.from({ length: games }, (_, index) => ({
      activityId: 'laser_game',
      uid: `laser_game:${index + 1}`,
      countIndex: index + 1,
      critical: true,
    }));
    const built = buildTimeline({
      center,
      formula: null,
      pax: reservation.pax || 1,
      startMinutes: timeToMinutes(reservation.startTime),
      order,
      arrivalConfidence: Number(reservation.pax || 0) >= 12 ? 'uncertain' : 'normal',
    });
    const planned = deferExtraStandaloneLaserPasses(built, games);
    planned.resourceBlocks.forEach((block) => {
      blocks.push({ ...block, sourceId: reservation.id, pax: reservation.pax || 0 });
    });
  }

  if (reservation.type === 'formule' && reservation.formuleId) {
    try {
      const formula = getFormula(reservation.formuleId);
      const order = expandFormulaSteps(formula);
      const built = buildTimeline({
        center,
        formula,
        pax: reservation.pax || 1,
        startMinutes: timeToMinutes(reservation.startTime),
        order,
      });
      built.resourceBlocks.forEach((block) => {
        if (block.resourceType !== 'bowling_lane') {
          blocks.push({ ...block, sourceId: reservation.id, pax: reservation.pax || 0 });
        }
      });
    } catch (error) {
      return blocks;
    }
  }

  return blocks;
}

function allocateLanes(center, laneStatuses, reservations, start, end, requiredCount) {
  if (!requiredCount) return [];
  const unavailable = new Set();
  const blocks = reservations.flatMap(laneBlocksFromReservation);

  blocks.forEach((block) => {
    if (overlap(start, end, block.start, block.end)) unavailable.add(Number(block.lane));
  });

  const available = [];
  const laneCount = center.resources.bowling?.laneCount || 0;
  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!unavailable.has(lane) && laneStatuses[String(lane)] !== 'maintenance' && laneStatuses[lane] !== 'maintenance') {
      available.push(lane);
    }
  }
  if (available.length < requiredCount) return null;

  if (requiredCount === 1) return [available[0]];
  for (let index = 0; index <= available.length - requiredCount; index += 1) {
    const group = available.slice(index, index + requiredCount);
    if (group.every((lane, offset) => offset === 0 || lane === group[offset - 1] + 1)) return group;
  }
  return available.slice(0, requiredCount);
}

function validateRequestedLanes(center, laneStatuses, reservations, block) {
  const requestedLanes = [...new Set(blockLanes(block))];
  if (!requestedLanes.length) return null;
  const laneCount = center.resources.bowling?.laneCount || 0;
  const occupiedBlocks = reservations
    .flatMap(laneBlocksFromReservation)
    .filter((existing) => overlap(block.start, block.end, existing.start, existing.end));
  const invalid = requestedLanes.filter((lane) => lane < 1 || lane > laneCount);
  const maintenance = requestedLanes.filter((lane) => laneStatuses[String(lane)] === 'maintenance' || laneStatuses[lane] === 'maintenance');
  const occupied = requestedLanes.filter((lane) => occupiedBlocks.some((existing) => Number(existing.lane) === lane));

  if (invalid.length || maintenance.length || occupied.length) {
    return {
      ok: false,
      lanes: requestedLanes,
      invalid,
      maintenance,
      occupied,
    };
  }

  return { ok: true, lanes: requestedLanes };
}

function findJoinableLaserSession(block, overlapping, weaponCount) {
  const sessions = new Map();
  overlapping.forEach((existing) => {
    const key = `${existing.start}-${existing.end}`;
    const current = sessions.get(key) || {
      start: existing.start,
      end: existing.end,
      players: 0,
    };
    current.players += Number(existing.players || existing.pax || 0);
    sessions.set(key, current);
  });

  return [...sessions.values()]
    .filter((session) => {
      const canFit = session.players + Number(block.players || 0) <= weaponCount;
      const startsCloseEnough = Math.abs(Number(session.start) - Number(block.start)) <= 15;
      const endsCloseEnough = Math.abs(Number(session.end) - Number(block.end)) <= 15;
      return canFit && startsCloseEnough && endsCloseEnough;
    })
    .sort((left, right) =>
      Math.abs(Number(left.start) - Number(block.start)) - Math.abs(Number(right.start) - Number(block.start)))[0] || null;
}

function evaluateConflicts({ center, scenario, reservations, laneStatuses }) {
  const conflicts = [];
  const assignedLanesByBlock = new Map();
  const existingBlocks = reservations.flatMap((reservation) => inferBlocksFromReservation(reservation, center));

  scenario.resourceBlocks.forEach((block, index) => {
    if (block.resourceType === 'bowling_lane') {
      const requestedLaneCheck = validateRequestedLanes(center, laneStatuses, reservations, block);
      const lanes = requestedLaneCheck
        ? (requestedLaneCheck.ok ? requestedLaneCheck.lanes : null)
        : allocateLanes(center, laneStatuses, reservations, block.start, block.end, block.requiredLanes || 1);
      if (!lanes) {
        const occupied = requestedLaneCheck?.occupied?.length
          ? ` Piste(s) deja occupee(s): ${requestedLaneCheck.occupied.join(', ')}.`
          : '';
        const maintenance = requestedLaneCheck?.maintenance?.length
          ? ` Piste(s) en maintenance: ${requestedLaneCheck.maintenance.join(', ')}.`
          : '';
        conflicts.push({
          type: 'bowling_conflict',
          severity: 'blocking',
          message: `Pas assez de pistes libres pour ${block.requiredLanes || 1} piste(s) a ${minutesToTime(block.start)}.${occupied}${maintenance}`,
        });
      } else {
        assignedLanesByBlock.set(index, lanes);
      }
    }

    if (block.resourceType === 'laser_arena') {
      let overlapping = existingBlocks.filter(
        (existing) => existing.resourceType === 'laser_arena' && overlap(block.start, block.end, existing.start, existing.end),
      );
      const parallelLaunches = center.resources.laser?.parallelLaunches || 1;
      const weaponCount = center.resources.laser?.weaponCount || 30;
      const joinableSession = findJoinableLaserSession(block, overlapping, weaponCount);
      if (joinableSession) {
        block.start = joinableSession.start;
        block.end = joinableSession.end;
        block.startTime = minutesToTime(block.start);
        block.endTime = minutesToTime(block.end);
        overlapping = existingBlocks.filter(
          (existing) => existing.resourceType === 'laser_arena' && overlap(block.start, block.end, existing.start, existing.end),
        );
      }
      const sessionKey = `${block.start}-${block.end}`;
      const overlappingSessionKeys = new Set(overlapping.map((item) => `${item.start}-${item.end}`));
      const joinsExistingSession = overlappingSessionKeys.has(sessionKey);
      const launchCount = overlappingSessionKeys.size + (joinsExistingSession ? 0 : 1);
      const players = overlapping.reduce((sum, item) => sum + Number(item.players || item.pax || 0), Number(block.players || 0));
      block.playersBefore = overlapping.reduce((sum, item) => sum + Number(item.players || item.pax || 0), 0);
      block.playersTotal = players;
      block.remainingWeapons = Math.max(0, weaponCount - players);
      block.sharedSession = block.playersBefore > 0;
      block.mayShareSession = players < weaponCount;
      if (launchCount > parallelLaunches || players > weaponCount) {
        conflicts.push({
          type: 'laser_conflict',
          severity: 'blocking',
          message: `Laser charge a ${minutesToTime(block.start)}: ${players}/${weaponCount} joueurs et ${launchCount}/${parallelLaunches} lancement(s).`,
        });
      }
    }

    if (block.resourceType === 'party_table') {
      const overlapping = existingBlocks.filter(
        (existing) => existing.resourceType === 'party_table' && overlap(block.start, block.end, existing.start, existing.end),
      );
      const hardCapacity = center.resources.partyTables?.hardCapacity || 8;
      if (overlapping.length + 1 > hardCapacity) {
        conflicts.push({
          type: 'table_conflict',
          severity: 'blocking',
          message: `Trop de tables anniversaire occupees sur ${minutesToTime(block.start)}-${minutesToTime(block.end)}.`,
        });
      }
    }
  });

  return { conflicts, assignedLanesByBlock };
}

function countFormulaActivity(formula, activityId) {
  return expandFormulaSteps(formula).filter((step) => step.activityId === activityId).length;
}

function calculateRisk({ center, formula, pax, date, preference = {}, conflicts = [], activityType = '' }) {
  const { rules } = loadOpsKnowledge();
  let score = formula ? rules.risk.baseFormulaRisk : rules.risk.baseBowlingRisk;
  const reasons = [];
  const day = new Date(`${date}T12:00:00`).getDay();

  if (formula) {
    const laserCount = countFormulaActivity(formula, 'laser_game');
    const hasBowling = countFormulaActivity(formula, 'bowling') > 0;
    if (center.id === 'libramont' && laserCount) {
      score += rules.risk.libramontLaserRisk;
      reasons.push('Laser Libramont sensible: un seul lancement propre et groupe complet attendu.');
    }
    if (laserCount >= 2) {
      score += rules.risk.laserTwoGamesRisk;
      reasons.push('Deux passages laser augmentent le risque de decalage.');
    }
    if (hasBowling && laserCount) {
      score += 10;
      reasons.push('Formule multi-ressources: bowling et laser doivent rester coordonnes.');
    }
    if (laserCount && pax > (center.resources.laser?.weaponCount || 30)) {
      score += 18;
      reasons.push('Formule avec groupe superieur aux armes: laser decoupe en vagues.');
    }
  }

  if (activityType === 'laser') {
    score += 8;
    if (center.id === 'libramont') {
      score += rules.risk.libramontLaserRisk;
      reasons.push('Laser Libramont sensible: un seul lancement propre et groupe complet attendu.');
    }
    if (pax > (center.resources.laser?.weaponCount || 30)) {
      score += 18;
      reasons.push('Groupe superieur aux armes disponibles: plusieurs vagues laser planifiees.');
    }
    if (Number(preference.laserGames || 1) >= 2) {
      score += rules.risk.laserTwoGamesRisk;
      reasons.push('Plusieurs parties laser augmentent le risque de decalage.');
    }
  }

  if (pax >= rules.risk.veryLargeGroupRiskAtPax) {
    score += rules.risk.veryLargeGroupRisk;
    reasons.push('Tres gros groupe: attente, briefing et transitions plus longs.');
  } else if (pax >= rules.risk.largeGroupRiskAtPax) {
    score += rules.risk.largeGroupRisk;
    reasons.push('Groupe nombreux: marge supplementaire necessaire.');
  }

  if (preference.arrivalConfidence === 'uncertain') {
    score += rules.risk.customerUncertainArrivalRisk;
    reasons.push('Arrivee incertaine: eviter de verrouiller le laser en premier.');
  }

  if (day === 0 || day === 6) {
    score += rules.risk.weekendRisk;
    reasons.push('Jour charge: buffers renforces.');
  }

  if (conflicts.length) {
    score += 40;
    reasons.push('Conflit ressource detecte.');
  }

  const level = getRiskLevel(score, rules);
  return {
    score: clamp(score, 0, 100),
    level,
    bufferMinutes: getBufferMinutes(score, rules),
    reasons,
  };
}

function buildEntitlementModel({ center, timeline = [], blocks = [], pax = 0 }) {
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const fixedCommitments = blocks.map((block) => {
    if (block.resourceType === 'bowling_lane') {
      return {
        type: 'bowling',
        label: 'Bowling',
        startTime: block.startTime || minutesToTime(block.start),
        endTime: block.endTime || minutesToTime(block.end),
        lanes: block.lanes || [],
        requiredLanes: block.requiredLanes || 1,
        players: Number(pax || block.pax || 0),
      };
    }
    if (block.resourceType === 'laser_arena') {
      return {
        type: 'laser_game',
        label: 'Laser Game',
        startTime: block.startTime || minutesToTime(block.start),
        endTime: block.endTime || minutesToTime(block.end),
        players: Number(block.players || pax || 0),
        playersTotal: Number(block.playersTotal || block.players || pax || 0),
        remainingPlaces: Math.max(0, weaponCount - Number(block.playersTotal || block.players || 0)),
        countIndex: Number(block.countIndex || 1),
        waveIndex: Number(block.groupWaveIndex || 1),
        waveCount: Number(block.groupWaveCount || 1),
        mayShareSession: Boolean(block.mayShareSession),
        sharedSession: Boolean(block.sharedSession),
      };
    }
    if (block.resourceType === 'party_table') {
      return {
        type: 'party_table',
        label: 'Table anniversaire',
        startTime: block.startTime || minutesToTime(block.start),
        endTime: block.endTime || minutesToTime(block.end),
        players: Number(pax || block.pax || 0),
      };
    }
    return {
      type: block.resourceType || 'resource',
      label: block.label || block.activityId || 'Ressource',
      startTime: block.startTime || minutesToTime(block.start),
      endTime: block.endTime || minutesToTime(block.end),
    };
  });

  const seenFlexible = new Set();
  const flexibleEntitlements = timeline
    .filter((step) => {
      if (!step.activityId && step.resourceType !== 'bar_service' && step.resourceType !== 'bar_service_then_autonomous') return false;
      return !CRITICAL_RESOURCE_TYPES.has(step.resourceType);
    })
    .map((step) => {
      const activity = step.activityId ? getActivity(step.activityId) : null;
      return {
        type: step.activityId || step.resourceType || 'service',
        label: activity?.name || step.label || 'Service',
        startTime: step.startTime || minutesToTime(step.start),
        endTime: step.endTime || minutesToTime(step.end),
        durationMinutes: Number(step.durationMinutes || Math.max(0, Number(step.end || 0) - Number(step.start || 0))),
        mode: isSoftStep(step) ? 'flexible_on_site' : 'service_on_site',
      };
    })
    .filter((item) => {
      const key = `${item.type}|${item.label}|${item.startTime}|${item.endTime}`;
      if (seenFlexible.has(key)) return false;
      seenFlexible.add(key);
      return true;
    });

  return {
    fixedCommitments,
    flexibleEntitlements,
    customerReadable: [
      ...fixedCommitments.map((item) => `${item.label} ${item.startTime}-${item.endTime}`),
      ...flexibleEntitlements.map((item) => `${item.label} libre sur place`),
    ],
  };
}

function hasSoftStepBetweenActivities(timeline = [], firstActivityId, secondActivityId) {
  const firstIndex = timeline.findIndex((step) => step.activityId === firstActivityId);
  const secondIndex = timeline.findIndex((step) => step.activityId === secondActivityId);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return false;
  const [start, end] = firstIndex < secondIndex ? [firstIndex + 1, secondIndex] : [secondIndex + 1, firstIndex];
  return timeline.slice(start, end).some((step) => isSoftStep(step));
}

function firstCriticalResource(blocks = []) {
  return [...blocks].sort((left, right) => Number(left.start || 0) - Number(right.start || 0))[0] || null;
}

function buildScenarioIntelligence({ center, formula, pax, scenario, blocks, risk, conflicts, activityType = '', laserSharing = null }) {
  const playbook = loadOpsKnowledge().competitivePlaybook || {};
  const entitlements = buildEntitlementModel({ center, timeline: scenario.timeline || [], blocks, pax });
  const patternIds = new Set(['integrated_capacity_ledger']);
  const qualitySignals = [];
  const warnings = [];
  const staffChecklist = [];
  const customerCommitment = [];
  let scoreAdjustment = 0;

  if (entitlements.fixedCommitments.length) {
    patternIds.add('entitlement_based_booking');
    qualitySignals.push('Ressources critiques separees des avantages libres.');
    staffChecklist.push('Verifier les engagements fixes: heures, pistes, laser et capacite.');
  }

  if (entitlements.flexibleEntitlements.length) {
    patternIds.add('shock_absorber_routing');
    qualitySignals.push('Activites flexibles disponibles pour absorber attente ou retard.');
    customerCommitment.push('Les activites libres restent utilisables sur place selon le rythme du groupe.');
  }

  const hasBowling = blocks.some((block) => block.resourceType === 'bowling_lane');
  const hasLaser = blocks.some((block) => block.resourceType === 'laser_arena');
  if (formula && hasBowling && hasLaser) {
    const hasBuffer = hasSoftStepBetweenActivities(scenario.timeline || [], 'bowling', 'laser_game');
    if (hasBuffer) {
      scoreAdjustment -= 4;
      qualitySignals.push('Un amortisseur est place entre Bowling et Laser Game.');
    } else {
      scoreAdjustment += 8;
      warnings.push('Bowling et Laser Game sont proches: surveiller retard et groupe incomplet.');
      staffChecklist.push('Si le groupe est en retard, privilegier un ordre alternatif ou une activite libre avant Laser.');
    }
  }

  if (hasLaser || activityType === 'laser') {
    patternIds.add('shared_session_capacity');
    patternIds.add('guest_commitment_ladder');
    const sharing = laserSharing || summarizeLaserSharing(blocks, center, pax);
    if (sharing?.sharedNow) {
      qualitySignals.push(`Laser partage: ${sharing.playersTotal}/${sharing.weaponCount} joueurs.`);
      customerCommitment.push("Le Laser Game peut être partagé avec d'autres joueurs déjà planifiés.");
    } else if (sharing?.mayShare) {
      customerCommitment.push("Le Laser Game peut être complété avec d'autres joueurs selon l'affluence.");
    }
    if (center.id === 'libramont' && Number(pax || 0) >= 12 && firstCriticalResource(blocks)?.resourceType === 'laser_arena') {
      scoreAdjustment += 6;
      warnings.push('Laser Libramont en premier sur gros groupe: risque si tout le monde n est pas arrive.');
      staffChecklist.push('Confirmer que le groupe est complet avant lancement Laser.');
    }
  }

  if (conflicts.length) {
    warnings.push(conflicts[0].message);
  }

  if (!customerCommitment.length && entitlements.fixedCommitments.length) {
    customerCommitment.push('Les horaires des ressources critiques sont bloques, le reste reste simple sur place.');
  }

  const livePatterns = (playbook.patterns || [])
    .filter((pattern) => patternIds.has(pattern.id))
    .map((pattern) => ({ id: pattern.id, label: pattern.label }));

  return {
    benchmark: 'FEC SaaS pattern: inventaire unique, package multi-activites, capacite lisible, engagement client progressif.',
    sourcePatternIds: [...patternIds],
    patterns: livePatterns,
    scoreAdjustment,
    qualityScore: clamp(100 - risk.score - conflicts.length * 20 - Math.max(0, scoreAdjustment) + qualitySignals.length * 3, 0, 100),
    qualitySignals,
    warnings,
    entitlements,
    staffChecklist,
    customerCommitment,
  };
}

function decorateScenario({ center, formula, pax, date, scenario, reservations, laneStatuses, preference, activityType = '' }) {
  const conflictResult = evaluateConflicts({ center, scenario, reservations, laneStatuses });
  const risk = calculateRisk({
    center,
    formula,
    pax,
    date,
    preference,
    conflicts: conflictResult.conflicts,
    activityType,
  });

  const blocks = scenario.resourceBlocks.map((block, index) => ({
    ...block,
    startTime: minutesToTime(block.start),
    endTime: minutesToTime(block.end),
    lanes: conflictResult.assignedLanesByBlock.get(index) || block.lanes || [],
  }));

  const blocking = conflictResult.conflicts.some((conflict) => conflict.severity === 'blocking');
  const laserSharing = summarizeLaserSharing(blocks, center, pax);
  const marketIntelligence = buildScenarioIntelligence({
    center,
    formula,
    pax,
    scenario,
    blocks,
    risk,
    conflicts: conflictResult.conflicts,
    activityType,
    laserSharing,
  });
  const score = (blocking ? 1000 : 0) + risk.score + scenario.totalMinutes / 10 + marketIntelligence.scoreAdjustment;

  return {
    ok: !blocking,
    score,
    startTime: minutesToTime(scenario.start),
    endTime: minutesToTime(scenario.end + risk.bufferMinutes),
    totalMinutes: scenario.totalMinutes,
    bufferMinutes: risk.bufferMinutes,
    risk,
    conflicts: conflictResult.conflicts,
    assignedLanes: [...new Set(blocks.flatMap((block) => block.lanes || []))],
    timeline: scenario.timeline.map((step) => ({
      ...step,
      startTime: minutesToTime(step.start),
      endTime: minutesToTime(step.end),
    })),
    resourceBlocks: blocks,
    laserSharing,
    marketIntelligence,
    entitlements: marketIntelligence.entitlements,
    operationsChecklist: marketIntelligence.staffChecklist,
    customerCommitment: marketIntelligence.customerCommitment,
    staffSummary: buildStaffSummary({ center, formula, pax, scenario, risk, conflicts: conflictResult.conflicts, activityType, blocks, marketIntelligence }),
  };
}

function summarizeLaserSharing(blocks, center, requestedPlayers = 0) {
  const laserBlocks = (blocks || []).filter((block) => block.resourceType === 'laser_arena');
  if (!laserBlocks.length) return null;
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const maxPlayers = Math.max(...laserBlocks.map((block) => Number(block.playersTotal || block.players || 0)));
  const minRemaining = Math.min(...laserBlocks.map((block) => Math.max(0, weaponCount - Number(block.playersTotal || block.players || 0))));
  const waveCount = Math.max(...laserBlocks.map((block) => Number(block.groupWaveCount || 1)));
  return {
    mayShare: maxPlayers < weaponCount,
    sharedNow: laserBlocks.some((block) => Number(block.playersBefore || 0) > 0),
    weaponCount,
    requestedPlayers: Number(requestedPlayers || 0),
    playersTotal: maxPlayers,
    remainingPlaces: minRemaining,
    waveCount,
    launchCount: laserBlocks.length,
    splitGroup: waveCount > 1,
  };
}

function buildStaffSummary({ center, formula, pax, scenario, risk, conflicts, activityType = '', blocks = [], marketIntelligence = null }) {
  const nextCritical = scenario.resourceBlocks[0];
  const parts = [];
  if (formula) parts.push(`${formula.name} - ${pax} personnes`);
  if (activityType === 'laser') {
    const laser = blocks.find((block) => block.resourceType === 'laser_arena') || nextCritical;
    parts.push(`Laser Game - ${pax} personnes`);
    if (laser) parts.push(`Lancement ${minutesToTime(laser.start)}`);
    const sharing = summarizeLaserSharing(blocks, center, pax);
    if (sharing?.splitGroup) parts.push(`Groupe reparti en ${sharing.waveCount} vagues laser`);
    if (sharing?.sharedNow) parts.push(`Session partagée: ${sharing.playersTotal}/${sharing.weaponCount}`);
    else if (sharing?.mayShare) parts.push("Peut être complétée avec d'autres joueurs");
  }
  if (nextCritical) parts.push(`Premiere ressource critique: ${nextCritical.label} a ${minutesToTime(nextCritical.start)}`);
  parts.push(`Risque ${risk.level} (${risk.score}/100)`);
  if (center.id === 'libramont' && formula && countFormulaActivity(formula, 'laser_game')) {
    parts.push('Consigne: groupe complet avant laser, sinon proposer un ordre alternatif.');
  }
  if (marketIntelligence?.warnings?.length) {
    parts.push(`Point marche: ${marketIntelligence.warnings[0]}`);
  } else if (marketIntelligence?.qualitySignals?.length) {
    parts.push(`Point marche: ${marketIntelligence.qualitySignals[0]}`);
  }
  if (conflicts.length) parts.push(conflicts[0].message);
  return parts.join(' | ');
}

function validateCenterReady(center) {
  if (!center || center.status !== 'active') {
    return {
      ok: false,
      reason: `Centre indisponible pour la réservation: ${center?.name || 'centre inconnu'}.`,
    };
  }
  return { ok: true };
}

function validateFormulaBusinessRules({ formula, date, pax, startMinutes = null, totalMinutes = 0 }) {
  if (pax < Number(formula.minPax || 1)) {
    return { ok: false, reason: `Minimum ${formula.minPax} personnes pour ${formula.name}.` };
  }

  const day = new Date(`${date}T12:00:00`).getDay();
  if (Array.isArray(formula.validDays) && !formula.validDays.includes(day)) {
    return { ok: false, reason: `${formula.name} indisponible ce jour.` };
  }

  if (formula.notDuringHolidays && isHolidayScheduleDate(date)) {
    return { ok: false, reason: `${formula.name} indisponible pendant les vacances ou jours fériés.` };
  }

  if (formula.timeLimit && startMinutes !== null) {
    const min = formula.timeLimit.min ? timeToMinutes(formula.timeLimit.min) : null;
    const max = formula.timeLimit.max ? timeToMinutes(formula.timeLimit.max) : null;
    if (min !== null && startMinutes < min) {
      return { ok: false, reason: `${formula.name} commence a partir de ${formula.timeLimit.min}.` };
    }
    if (max !== null && startMinutes + totalMinutes > max) {
      return { ok: false, reason: `${formula.name} doit terminer avant ${formula.timeLimit.max}.` };
    }
  }

  return { ok: true };
}

function getScheduleWindow({ center, date, estimatedMinutes, formula = null }) {
  const centerReady = validateCenterReady(center);
  if (!centerReady.ok) return centerReady;

  const today = todayStr();
  if (date < today) {
    return { ok: false, reason: 'Cette date est déjà passée.' };
  }

  const schedule = getSchedule(date);
  if (!schedule) {
    return { ok: false, reason: 'Le centre est fermé à cette date.' };
  }

  const { rules } = loadOpsKnowledge();
  const step = rules.scenarioGeneration.slotStepMinutes;
  const leadMinutes = Number(rules.scenarioGeneration.sameDayLeadMinutes || 15);
  let minStart = Math.round(schedule.open * 60);
  let maxStart = Math.round(schedule.close * 60) - estimatedMinutes;

  if (date === today) {
    minStart = Math.max(minStart, ceilMinutes(currentTimeDecimal() * 60 + leadMinutes, step));
  }

  if (formula?.timeLimit) {
    if (formula.timeLimit.min) minStart = Math.max(minStart, timeToMinutes(formula.timeLimit.min));
    if (formula.timeLimit.max) maxStart = Math.min(maxStart, timeToMinutes(formula.timeLimit.max) - estimatedMinutes);
  }

  if (maxStart < minStart) {
    return {
      ok: false,
      reason: 'Aucun départ possible dans les horaires disponibles avec cette durée.',
    };
  }

  return {
    ok: true,
    minStart,
    maxStart,
    step,
    open: Math.round(schedule.open * 60),
    close: Math.round(schedule.close * 60),
  };
}

function getCandidateStartTimes({ center, date, requestedStartTime, estimatedMinutes, formula = null }) {
  const window = getScheduleWindow({ center, date, estimatedMinutes, formula });
  if (!window.ok) return { starts: [], reason: window.reason };

  if (requestedStartTime) {
    const requested = timeToMinutes(requestedStartTime);
    if (requested < window.minStart || requested > window.maxStart) {
      return { starts: [], reason: 'Créneau demandé indisponible ou hors horaires.' };
    }
    return { starts: [requested], reason: '' };
  }

  const times = [];
  for (let value = window.minStart; value <= window.maxStart; value += window.step) times.push(value);
  return { starts: times, reason: '' };
}

function getLockedStaffStartTimes({ center, date, requestedStartTime, estimatedMinutes, formula = null, allowPastStart = false }) {
  if (!allowPastStart || !requestedStartTime) return null;
  const centerReady = validateCenterReady(center);
  if (!centerReady.ok) return { starts: [], reason: centerReady.reason };
  const schedule = getSchedule(date);
  if (!schedule) return { starts: [], reason: 'Le centre est fermé à cette date.' };
  const requested = timeToMinutes(requestedStartTime);
  const open = Math.round(schedule.open * 60);
  const close = Math.round(schedule.close * 60);
  if (requested < open || requested + estimatedMinutes > close) {
    return { starts: [], reason: 'Créneau demandé hors horaires.' };
  }
  if (formula?.timeLimit) {
    if (formula.timeLimit.min && requested < timeToMinutes(formula.timeLimit.min)) {
      return { starts: [], reason: `${formula.name} doit commencer apres ${formula.timeLimit.min}.` };
    }
    if (formula.timeLimit.max && requested + estimatedMinutes > timeToMinutes(formula.timeLimit.max)) {
      return { starts: [], reason: `${formula.name} doit terminer avant ${formula.timeLimit.max}.` };
    }
  }
  return { starts: [requested], reason: '' };
}

function estimateFormulaMinutes(center, formula, pax, pauseMinutes) {
  const order = expandFormulaSteps(formula);
  return buildTimeline({
    center,
    formula,
    pax,
    startMinutes: 0,
    order,
    pauseMinutes,
  }).totalMinutes + 30;
}

function validateFormulaForCenter(center, formula) {
  const unavailable = [];
  expandFormulaSteps(formula).forEach((step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    if (activity && center.activityAvailability[step.activityId] !== true) unavailable.push(step.activityId);
  });
  return unavailable;
}

function planFormula(input, context = {}) {
  const knowledge = loadOpsKnowledge();
  const center = getCenter(input.centerId || 'libramont');
  const formula = getFormula(input.formuleId || input.formulaId);
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const pauseMinutes = 0;
  const preference = input.preference || {};
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const unavailable = validateFormulaForCenter(center, formula);
  const centerReady = validateCenterReady(center);

  if (!centerReady.ok) {
    return {
      ok: false,
      reason: centerReady.reason,
      scenarios: [],
    };
  }

  if (unavailable.length) {
    return {
      ok: false,
      reason: `Activité non disponible dans ce centre: ${unavailable.join(', ')}`,
      scenarios: [],
    };
  }

  const estimated = estimateFormulaMinutes(center, formula, pax, pauseMinutes);
  const baseRules = validateFormulaBusinessRules({
    formula,
    date,
    pax,
    startMinutes: input.startTime ? timeToMinutes(input.startTime) : null,
    totalMinutes: estimated,
  });
  if (!baseRules.ok) {
    return {
      ok: false,
      reason: baseRules.reason,
      scenarios: [],
    };
  }

  const candidateResult = getLockedStaffStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: estimated,
    formula,
    allowPastStart: input.channel === 'staff' && Boolean(input.allowPastStart),
  }) || getCandidateStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: estimated,
    formula,
  });
  const starts = candidateResult.starts;
  const orders = generateOrders(formula, preference);
  const scenarios = [];

  starts.forEach((startMinutes) => {
    const formulaRules = validateFormulaBusinessRules({
      formula,
      date,
      pax,
      startMinutes,
      totalMinutes: estimated,
    });
    if (!formulaRules.ok) return;

    orders.forEach((order) => {
      const raw = buildTimeline({
        center,
        formula,
        pax,
        startMinutes,
        order,
        pauseMinutes,
        arrivalConfidence: preference.arrivalConfidence || 'normal',
      });
      const decorated = decorateScenario({
        center,
        formula,
        pax,
        date,
        scenario: raw,
        reservations,
        laneStatuses,
        preference,
      });
      if (!scenarioMatchesActivityOrder(decorated, preference)) return;
      if (!scenarioMatchesPreferredTimes(decorated, preference)) return;
      scenarios.push(decorated);
    });
  });

  const sorted = scenarios
    .sort((left, right) => left.score - right.score)
    .slice(0, knowledge.rules.scenarioGeneration.maxScenarios);
  const recommended = sorted.find((scenario) => scenario.ok) || sorted[0] || null;

  return {
    ok: Boolean(recommended && recommended.ok),
    reason: recommended ? '' : hasPreferredTimeFilter(preference) ? 'Aucune combinaison compatible avec les heures Bowling/Laser choisies.' : candidateResult.reason || 'Aucun scenario exploitable.',
    type: 'formule',
    centerId: center.id,
    date,
    formulaId: formula.id,
    formulaName: formula.name,
    pax,
    requestedStartTime: input.startTime || null,
    recommended,
    scenarios: sorted,
    validationMode: formula.humanValidation || 'recommended',
  };
}

function planBowling(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const durationMinutes = Math.max(30, Number(input.durationMinutes || input.duration * 60 || 60));
  const requiredLanes = getRequiredLaneCount(center, pax, input);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const centerReady = validateCenterReady(center);
  if (!centerReady.ok) {
    return {
      ok: false,
      reason: centerReady.reason,
      centerId: center.id,
      date,
      pax,
      requiredLanes,
      recommended: null,
      scenarios: [],
      validationMode: 'automatic_if_no_conflict',
    };
  }

  const candidateResult = getLockedStaffStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: durationMinutes,
    formula: null,
    allowPastStart: input.channel === 'staff' && Boolean(input.allowPastStart),
  }) || getCandidateStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: durationMinutes,
  });
  const starts = candidateResult.starts;
  const scenarios = starts.map((start) => {
    const end = start + durationMinutes;
    const lanes = allocateLanes(center, laneStatuses, reservations, start, end, requiredLanes);
    const conflicts = lanes
      ? []
      : [{ type: 'bowling_conflict', severity: 'blocking', message: `Pas assez de pistes libres a ${minutesToTime(start)}.` }];
    const risk = calculateRisk({ center, formula: null, pax, date, conflicts });
    const ok = conflicts.length === 0;
    return {
      ok,
      score: (ok ? 0 : 1000) + risk.score + durationMinutes / 10,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end + risk.bufferMinutes),
      totalMinutes: durationMinutes,
      bufferMinutes: risk.bufferMinutes,
      risk,
      conflicts,
      assignedLanes: lanes || [],
      timeline: [
        {
          type: 'activity',
          activityId: 'bowling',
          label: 'Bowling',
          resourceType: 'bowling_lane',
          start,
          end,
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
          durationMinutes,
          requiredLanes,
          lanes: lanes || [],
        },
      ],
      resourceBlocks: [
        {
          activityId: 'bowling',
          label: 'Bowling',
          resourceType: 'bowling_lane',
          start,
          end,
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
          requiredLanes,
          lanes: lanes || [],
        },
      ],
      staffSummary: `Bowling - ${pax} personnes | ${requiredLanes} piste(s) | Risque ${risk.level}`,
    };
  });
  const sorted = scenarios.sort((left, right) => left.score - right.score).slice(0, 6);
  return {
    ok: Boolean(sorted[0]?.ok),
    reason: sorted[0] ? '' : candidateResult.reason || 'Aucun créneau disponible.',
    type: 'bowling',
    centerId: center.id,
    date,
    pax,
    requiredLanes,
    recommended: sorted.find((scenario) => scenario.ok) || sorted[0] || null,
    scenarios: sorted,
    validationMode: 'automatic_if_no_conflict',
  };
}

function inferLaserGames(input) {
  const explicit = Number(input.laserGames || input.games || input.gameCount || 0);
  if (explicit >= 1) return clamp(Math.round(explicit), 1, 3);
  const duration = Number(input.duration || 0.5);
  if (duration >= 1.25) return 3;
  if (duration >= 0.75) return 2;
  return 1;
}

function estimateLaserMinutes(center, pax, games) {
  const order = Array.from({ length: games }, (_, index) => ({
    activityId: 'laser_game',
    uid: `laser_game:${index + 1}`,
    countIndex: index + 1,
    critical: true,
  }));
  return buildTimeline({
    center,
    formula: null,
    pax,
    startMinutes: 0,
    order,
    arrivalConfidence: pax >= 12 ? 'uncertain' : 'normal',
  }).totalMinutes;
}

function planLaser(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const games = inferLaserGames(input);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const centerReady = validateCenterReady(center);
  const activityAvailable = center.activityAvailability?.laser_game === true && center.resources.laser;
  const weaponCount = center.resources.laser?.weaponCount || 30;

  if (!centerReady.ok || !activityAvailable) {
    return {
      ok: false,
      reason: centerReady.reason || 'Laser Game indisponible dans ce centre.',
      centerId: center.id,
      date,
      pax,
      recommended: null,
      scenarios: [],
      validationMode: 'automatic_if_no_conflict',
    };
  }

  const estimated = estimateLaserMinutes(center, pax, games);
  const candidateResult = getLockedStaffStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: estimated,
    formula: null,
    allowPastStart: input.channel === 'staff' && Boolean(input.allowPastStart),
  }) || getCandidateStartTimes({
    center,
    date,
    requestedStartTime: input.startTime,
    estimatedMinutes: estimated,
  });
  const order = Array.from({ length: games }, (_, index) => ({
    activityId: 'laser_game',
    uid: `laser_game:${index + 1}`,
    countIndex: index + 1,
    critical: true,
  }));
  const scenarios = candidateResult.starts.map((startMinutes) => {
    const raw = buildTimeline({
      center,
      formula: null,
      pax,
      startMinutes,
      order,
      arrivalConfidence: pax >= 12 ? 'uncertain' : 'normal',
    });
    const scenario = input.deferExtraLaserGames === false ? raw : deferExtraStandaloneLaserPasses(raw, games);
    return attachLaserPassPlan(decorateScenario({
      center,
      formula: null,
      pax,
      date,
      scenario,
      reservations,
      laneStatuses,
      preference: {
        ...(input.preference || {}),
        laserGames: games,
      },
      activityType: 'laser',
    }), games);
  });

  const sorted = scenarios.sort((left, right) => left.score - right.score).slice(0, 8);
  const recommended = sorted.find((scenario) => scenario.ok) || sorted[0] || null;
  return {
    ok: Boolean(recommended && recommended.ok),
    reason: recommended ? '' : candidateResult.reason || 'Aucun créneau Laser Game disponible.',
    type: 'laser',
    centerId: center.id,
    date,
    pax,
    laserGames: games,
    weaponCount,
    requestedStartTime: input.startTime || null,
    recommended,
    scenarios: sorted,
    validationMode: 'automatic_if_no_conflict',
  };
}

function planReservation(input, context = {}) {
  const explicitType = String(input.type || '').toLowerCase();
  const type = ['bowling', 'laser', 'formule'].includes(explicitType)
    ? explicitType
    : ((input.formuleId || input.formulaId) ? 'formule' : 'bowling');
  if (type === 'formule') {
    return planFormula(input, context);
  }
  if (type === 'laser' || input.activityId === 'laser_game') {
    return planLaser(input, context);
  }
  return planBowling(input, context);
}

function getDelayPlanStartMinutes(plan, input = {}) {
  const reservation = input.reservation || {};
  const candidates = [
    input.startTime,
    reservation.startTime,
    plan.startTime,
    plan.firstBowlingTime,
    plan.firstLaserTime,
    plan.resourceBlocks?.[0]?.startTime,
    plan.timeline?.find((step) => step.type === 'activity')?.startTime,
    plan.timeline?.[0]?.startTime,
    plan.start,
  ].filter((value) => value !== undefined && value !== null && value !== '');
  if (!candidates.length) return 0;
  return timeToMinutes(candidates[0]);
}

function shiftTimedItem(item, delayMinutes) {
  const start = timeToMinutes(item.startTime || item.start) + delayMinutes;
  const end = timeToMinutes(item.endTime || item.end) + delayMinutes;
  return {
    ...item,
    start,
    end,
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
  };
}

function assignShiftedLanes(shifted, conflictResult) {
  const assigned = [];
  const resourceBlocks = (shifted.resourceBlocks || []).map((block, index) => {
    const currentLanes = Array.isArray(block.lanes) && block.lanes.length
      ? block.lanes
      : block.lane
        ? [block.lane]
        : [];
    const suggestedLanes = conflictResult.assignedLanesByBlock?.get(index) || [];
    const lanes = currentLanes.length ? currentLanes : suggestedLanes;
    if (block.resourceType !== 'bowling_lane' || !lanes.length) return block;
    assigned.push(...lanes.map(Number));
    return {
      ...block,
      lanes: lanes.map(Number),
    };
  });
  return {
    ...shifted,
    resourceBlocks,
    assignedLanes: assigned.length ? [...new Set(assigned)].sort((a, b) => a - b) : shifted.assignedLanes,
  };
}

function buildShiftedDelayPlan(plan, input, delayMinutes) {
  const originalStart = getDelayPlanStartMinutes(plan, input);
  const shiftedStart = originalStart + delayMinutes;
  const shifted = {
    ...plan,
    start: Number.isFinite(Number(plan.start)) ? Number(plan.start) + delayMinutes : shiftedStart,
    end: Number.isFinite(Number(plan.end)) ? Number(plan.end) + delayMinutes : undefined,
    startTime: minutesToTime(shiftedStart),
    endTime: plan.endTime || plan.end
      ? minutesToTime(timeToMinutes(plan.endTime || plan.end) + delayMinutes)
      : plan.endTime,
    timeline: (plan.timeline || []).map((step) => shiftTimedItem(step, delayMinutes)),
    resourceBlocks: (plan.resourceBlocks || []).map((block) => shiftTimedItem(block, delayMinutes)),
  };
  return shifted;
}

function getDelayRequest(input, plan, proposedStartTime) {
  const reservation = input.reservation || {};
  const type = String(input.type || reservation.type || plan.type || (reservation.formuleId || reservation.formulaId || plan.formulaId ? 'formule' : 'bowling')).toLowerCase();
  const laserGames = input.laserGames
    || input.games
    || reservation.laserGames
    || reservation.games
    || reservation.gameCount
    || plan.laserGames
    || plan.laserPassPlan?.totalGames
    || 0;
  return {
    centerId: input.centerId || reservation.centerId || plan.centerId || 'libramont',
    date: input.date || reservation.date || plan.date,
    type,
    formuleId: input.formuleId || input.formulaId || reservation.formuleId || reservation.formulaId || plan.formulaId || '',
    pax: Number(input.pax || reservation.pax || plan.pax || 1),
    startTime: proposedStartTime,
    duration: Number(input.duration || reservation.duration || plan.duration || 1),
    totalDuration: Number(input.totalDuration || reservation.totalDuration || plan.totalDuration || 0) || undefined,
    laserGames,
    games: laserGames,
    preference: {
      ...(reservation.preference || {}),
      ...(input.preference || {}),
    },
    channel: 'staff',
    allowPastStart: true,
    pauseMinutes: 0,
    deferExtraLaserGames: input.deferExtraLaserGames,
  };
}

function hasBlockingConflict(scenario) {
  return (scenario?.conflicts || []).some((conflict) => conflict.severity === 'blocking');
}

function summarizeDelayAlternative(scenario) {
  const blocks = Array.isArray(scenario.resourceBlocks) ? scenario.resourceBlocks : [];
  const bowling = blocks.filter((block) => block.resourceType === 'bowling_lane');
  const laser = blocks.filter((block) => block.resourceType === 'laser_arena');
  return {
    startTime: scenario.startTime || scenario.timeline?.[0]?.startTime || '',
    endTime: scenario.endTime || scenario.timeline?.[scenario.timeline.length - 1]?.endTime || '',
    riskLevel: scenario.risk?.level || 'low',
    riskScore: scenario.risk?.score ?? null,
    assignedLanes: scenario.assignedLanes || bowling.flatMap((block) => block.lanes || []),
    bowling: bowling.map((block) => ({
      startTime: block.startTime,
      endTime: block.endTime,
      lanes: block.lanes || [],
      requiredLanes: block.requiredLanes || 1,
    })),
    laser: laser.map((block) => ({
      startTime: block.startTime,
      endTime: block.endTime,
      players: block.players || 0,
      playersTotal: block.playersTotal || block.players || 0,
      remainingWeapons: block.remainingWeapons ?? null,
      sharedSession: Boolean(block.sharedSession),
    })),
    staffSummary: scenario.staffSummary || '',
    customerCommitment: Array.isArray(scenario.customerCommitment) ? scenario.customerCommitment.slice(0, 3) : [],
  };
}

function buildDelayAlternatives(input, context, plan, proposedStartTime) {
  const request = getDelayRequest(input, plan, proposedStartTime);
  const seen = new Set();
  const alternatives = [];
  const tryPlan = (startTime) => {
    const result = planReservation({ ...request, startTime }, context);
    const scenarios = (result.scenarios || [])
      .filter((scenario) => scenario?.ok && !hasBlockingConflict(scenario));
    scenarios.forEach((scenario) => {
      const key = [
        scenario.startTime,
        scenario.resourceBlocks?.map((block) => `${block.resourceType}:${block.startTime}-${block.endTime}:${(block.lanes || []).join('.')}`).join('|'),
      ].join('|');
      if (!key || seen.has(key)) return;
      seen.add(key);
      alternatives.push(summarizeDelayAlternative(scenario));
    });
  };

  try {
    tryPlan(proposedStartTime);
  } catch (error) {
    // The fallback scan below still gives staff usable options.
  }

  const base = timeToMinutes(proposedStartTime);
  [15, 30, 45, 60, 90, 120].forEach((offset) => {
    if (alternatives.length >= 4) return;
    try {
      tryPlan(minutesToTime(base + offset));
    } catch (error) {
      // Keep scanning other offsets.
    }
  });

  return alternatives.slice(0, 4);
}

function getDelayContextReservations(input, context = {}) {
  const reservationId = Number(input.reservationId || input.id || input.reservation?.id || 0);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  if (!reservationId) return reservations;
  return reservations.filter((reservation) => Number(reservation.id) !== reservationId);
}

function buildDelayPlanFromReservation(input, center) {
  const reservation = input.reservation || {};
  const source = {
    ...reservation,
    centerId: reservation.centerId || input.centerId || center.id,
    date: reservation.date || input.date,
    startTime: reservation.startTime || input.startTime,
    duration: reservation.duration || input.duration || 1,
    pax: reservation.pax || input.pax || 1,
    type: reservation.type || input.type || 'bowling',
    formuleId: reservation.formuleId || input.formuleId || '',
  };
  const blocks = inferBlocksFromReservation(source, center).map((block) => ({
    ...block,
    lanes: block.resourceType === 'bowling_lane'
      ? (Array.isArray(block.lanes) && block.lanes.length ? block.lanes : block.lane ? [block.lane] : [])
      : block.lanes,
    startTime: block.startTime || minutesToTime(block.start),
    endTime: block.endTime || minutesToTime(block.end),
  }));
  if (!blocks.length) return null;
  const start = Math.min(...blocks.map((block) => Number(block.start)));
  const end = Math.max(...blocks.map((block) => Number(block.end)));
  const assignedLanes = blocks
    .filter((block) => block.resourceType === 'bowling_lane')
    .flatMap((block) => block.lanes || (block.lane ? [block.lane] : []))
    .map(Number)
    .filter(Boolean);
  return {
    ok: true,
    type: source.type,
    centerId: source.centerId,
    date: source.date,
    pax: Number(source.pax || 1),
    start,
    end,
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    duration: Number(source.duration || 1),
    assignedLanes: [...new Set(assignedLanes)].sort((a, b) => a - b),
    resourceBlocks: blocks,
    timeline: blocks.map((block, index) => ({
      type: 'activity',
      activityId: block.resourceType === 'laser_arena' ? 'laser_game' : block.resourceType === 'bowling_lane' ? 'bowling' : block.resourceType,
      resourceType: block.resourceType,
      label: block.resourceType === 'laser_arena' ? 'Laser Game' : block.resourceType === 'bowling_lane' ? 'Bowling' : block.resourceType,
      start: block.start,
      end: block.end,
      startTime: block.startTime || minutesToTime(block.start),
      endTime: block.endTime || minutesToTime(block.end),
      durationMinutes: Math.max(0, Number(block.end) - Number(block.start)),
      lanes: block.lanes || (block.lane ? [block.lane] : []),
      countIndex: block.countIndex || 1,
      uid: `delay-fallback-${index}`,
    })),
  };
}

function analyzeDelay(input, context = {}) {
  const knowledge = loadOpsKnowledge();
  const reason = knowledge.rules.delayReasons.find((item) => item.id === input.reasonId) || null;
  const delayMinutes = Number(input.delayMinutes || reason?.defaultMinutes || 10);
  const center = getCenter(input.centerId || 'libramont');
  const plan = input.plan || input.scenario || buildDelayPlanFromReservation(input, center);
  if (!plan || !Array.isArray(plan.timeline)) throw new Error('Plan manquant pour analyser le retard.');
  const previousStartTime = minutesToTime(getDelayPlanStartMinutes(plan, input));
  const proposedStartTime = minutesToTime(timeToMinutes(previousStartTime) + delayMinutes);
  let shifted = buildShiftedDelayPlan(plan, input, delayMinutes);
  const reservations = getDelayContextReservations(input, context);

  const conflictResult = evaluateConflicts({
    center,
    scenario: shifted,
    reservations,
    laneStatuses: context.laneStatuses || {},
  });
  shifted = assignShiftedLanes(shifted, conflictResult);

  const actions = [];
  const ok = conflictResult.conflicts.length === 0;
  const alternatives = ok
    ? []
    : buildDelayAlternatives(input, { ...context, reservations }, plan, proposedStartTime);
  if (reason?.id === 'incomplete_group' && center.resources.laser?.requiresCompleteGroupBeforeLaunch) {
    actions.push('Eviter de lancer le laser tant que le groupe est incomplet.');
    actions.push('Proposer bowling, minigolf ou arcade avant laser si la formule le permet.');
  }
  if (conflictResult.conflicts.some((conflict) => conflict.type === 'laser_conflict')) {
    actions.push('Choisir une alternative compatible avec un laser plus tard ou un lancement partage.');
  }
  if (conflictResult.conflicts.some((conflict) => conflict.type === 'bowling_conflict')) {
    actions.push('Choisir une alternative avec autres pistes ou autre depart avant de confirmer.');
  }
  if (!actions.length && ok) {
    actions.push(`Appliquer le retard de ${delayMinutes} min apres confirmation staff.`);
    actions.push('Envoyer le mail d ajustement au client si une adresse email est disponible.');
  }
  if (!ok && alternatives.length) {
    actions.push('Proposer une des alternatives realisables au client au lieu de refuser.');
  }
  if (!actions.length) actions.push('Decision staff requise avant de modifier le planning.');

  return {
    ok,
    status: ok ? 'absorbable' : 'alternative_required',
    reason: reason?.label || 'Retard manuel',
    delayMinutes,
    previousStartTime,
    proposedStartTime,
    canApply: ok,
    confirmation: {
      required: true,
      label: ok ? 'Confirmer le decalage et notifier le client' : 'Choisir une alternative avant confirmation',
    },
    shiftedPlan: shifted,
    conflicts: conflictResult.conflicts,
    alternatives,
    actions,
    customerNotification: {
      templateId: 'delay_update',
      shouldSend: ok && Boolean(input.reservation?.email || input.email),
      previousStartTime,
      proposedStartTime,
      delayMinutes,
    },
    severity: ok ? 'absorbed' : 'needs_staff_decision',
  };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function buildLearningSuggestions(events = []) {
  const { rules } = loadOpsKnowledge();
  const groups = new Map();

  events.forEach((event) => {
    if (!event || !event.formulaId || !event.activityId) return;
    const planned = Number(event.plannedMinutes);
    const actual = Number(event.actualMinutes);
    if (!Number.isFinite(planned) || !Number.isFinite(actual) || actual <= 0) return;
    const key = [event.centerId || 'libramont', event.formulaId, event.activityId].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(actual - planned);
  });

  const suggestions = [];
  groups.forEach((deltas, key) => {
    const [centerId, formulaId, activityId] = key.split('|');
    if (deltas.length < rules.learning.minSamplesForSuggestion) return;
    const p75 = percentile(deltas, 0.75);
    const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const recommendedAdjustment = Math.round(Math.max(p75, average));
    if (Math.abs(recommendedAdjustment) < rules.learning.minDeltaMinutesForSuggestion) return;
    suggestions.push({
      centerId,
      formulaId,
      activityId,
      samples: deltas.length,
      averageDeltaMinutes: Math.round(average),
      p75DeltaMinutes: Math.round(p75),
      recommendedAdjustmentMinutes: recommendedAdjustment,
      confidence: clamp(deltas.length / (rules.learning.minSamplesForSuggestion * 2), 0, 1),
      requiresHumanApproval: true,
      message: `Ajuster ${activityId} de ${recommendedAdjustment} min pour ${formulaId} a ${centerId}.`,
    });
  });

  return {
    ok: true,
    appliedAutomatically: false,
    suggestions,
    policy: 'Les agents apprennent en proposant des ajustements. Aucune regle operationnelle critique nest modifiee sans validation humaine.',
  };
}

module.exports = {
  analyzeDelay,
  buildLearningSuggestions,
  getRequiredLaneCount,
  minutesToTime,
  planLaser,
  planReservation,
  timeToMinutes,
};
