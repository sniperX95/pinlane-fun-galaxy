const {
  LASER_GAME_ARENA_MINUTES,
  currentTimeDecimal,
  getSchedule,
  isFormulaBlockedDate,
  isOfferEnabled,
  todayStr,
} = require('./booking-config');
const { getActivity, getCenter, getFormula, loadOpsKnowledge } = require('./ops-knowledge');
const { isActivityBlockedAt, isLaneBlockedAt } = require('./availability-blocks');
const {
  getDeclaredResource,
  listDeclaredResources,
  requiredUnitsFor,
} = require('./declared-resources');

const CRITICAL_RESOURCE_TYPES = new Set(['bowling_lane', 'laser_arena', 'party_table']);

// Une ressource est CRITIQUE (comptee par le planning) si elle est l'une des
// trois familles historiques OU une ressource DECLAREE par le centre
// (config.resources.declared). C'est ce qui transforme l'ensemble fige en
// donnee : declarer « padel_court » suffit pour que le moteur compte ses
// occupations, sans deploiement. Sans declaration : strictement equivalent a
// l'ensemble historique.
function isCriticalResourceType(center, resourceType) {
  if (CRITICAL_RESOURCE_TYPES.has(resourceType)) return true;
  return Boolean(center && getDeclaredResource(center, resourceType));
}
// Buffer between consecutive activities in a formula, whatever the resources.
const TRANSITION_MINUTES = 5;
// Règle métier : l'heure choisie par le client est l'heure EXACTE de début de
// sa première activité. L'accueil (vérification du groupe) se fait AVANT, sur
// une fenêtre fixe : « présentez-vous 10 minutes avant ». Ce bloc d'accueil ne
// consomme aucune ressource critique (pistes/arène) : il ne décale rien.
const FORMULA_ARRIVAL_MINUTES = 10;
// Règle métier : TOUTE heure proposée au client est une heure pleine ou demie
// (15:00, 15:30, jamais 15:15 ni 15:45). Elle s'applique au début du
// PROGRAMME (= début de la première activité, bowling, laser, minigolf…) ;
// les activités suivantes à l'intérieur du programme peuvent rester à des
// heures fines (enchaînement naturel).
const PROGRAM_GRID_MINUTES = 30;
// Les pistes de bowling restent en plus alignées :00/:30 même au milieu d'un
// programme (contrainte d'exploitation des pistes).
const BOWLING_GRID_MINUTES = PROGRAM_GRID_MINUTES;

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

// Une etape marquee `optional: true` est INCLUSE par defaut (elle fait partie
// de la formule vendue) mais le client/staff peut la retirer :
// preference.excludedOptionalActivityIds liste les activites optionnelles
// retirees. Une etape NON optionnelle n'est jamais retirable par ce chemin.
// Aucune formule existante ne porte `optional` : sans donnee, la formule rendue
// est STRICTEMENT l'entree (zero regression).
function applyOptionalSelection(formula, preference = {}) {
  const steps = Array.isArray(formula.steps) ? formula.steps : [];
  if (!steps.some((step) => step && step.optional === true)) return formula;
  const excluded = new Set(
    (Array.isArray(preference.excludedOptionalActivityIds) ? preference.excludedOptionalActivityIds : [])
      .map((id) => String(id || ''))
      .filter(Boolean),
  );
  if (!excluded.size) return formula;
  return {
    ...formula,
    steps: steps.filter((step) => !(step && step.optional === true
      && excluded.has(String(step.activityId || step.resourceType || '')))),
  };
}

// P3 : contrainte d'ordre declaree par la formule. `orderConstraints` est une
// liste de paires [avant, apres] (ids d'activite) : « le bowling passe avant le
// laser ». Un ordre candidat qui viole une paire est ecarte. Aucune formule
// existante ne porte orderConstraints : sans donnee, aucun ordre n'est filtre.
// (`orderPolicy` historique reste descriptif : il n'a jamais ete lu par le
// moteur, l'activer d'un coup changerait des formules reelles.)
function orderSatisfiesConstraints(steps, constraints) {
  if (!Array.isArray(constraints) || !constraints.length) return true;
  // Une contrainte designe une etape par son activityId, ou, pour une etape
  // SANS activityId (pseudo-etape definie par sa seule ressource), par son
  // resourceType : aucune etape n'echappe au verrou en silence.
  const firstIndexOf = (id) => steps.findIndex((step) => step.activityId === id
    || (!step.activityId && stepResourceType(step) === id));
  return constraints.every((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return true;
    const before = firstIndexOf(String(pair[0] || ''));
    const after = firstIndexOf(String(pair[1] || ''));
    // Une contrainte sur une activite absente de la formule ne contraint rien.
    if (before < 0 || after < 0) return true;
    return before < after;
  });
}

function stepResourceType(step) {
  const activity = getActivity(step.activityId);
  return step.resourceType || activity?.resourceType || 'service';
}

function isSoftStep(step) {
  const activity = getActivity(step.activityId);
  return ['soft_capacity', 'bar_service_then_autonomous'].includes(stepResourceType(step)) || activity?.planningPressure === 'low';
}

function isShockAbsorberStep(step, center = null) {
  // Une ressource declaree est comptee par le planning : elle ne peut jamais
  // servir d'amortisseur, meme si son activite est marquee douce.
  return isSoftStep(step) && !isCriticalResourceType(center, stepResourceType(step));
}

function addShockAbsorberOrder(steps, add, firstActivityId, secondActivityId, center = null) {
  const first = steps.filter((step) => step.activityId === firstActivityId);
  const second = steps.filter((step) => step.activityId === secondActivityId);
  const shockAbsorbers = steps.filter((step) => isShockAbsorberStep(step, center));
  if (!first.length || !second.length || !shockAbsorbers.length) return;

  const used = new Set([...first, ...second, ...shockAbsorbers].map((step) => step.uid));
  add([
    ...first,
    ...shockAbsorbers,
    ...second,
    ...steps.filter((step) => !used.has(step.uid)),
  ]);
}

function generateOrders(formula, preference = {}, center = null) {
  const steps = expandFormulaSteps(formula);
  const orders = [];
  const constraints = Array.isArray(formula.orderConstraints) ? formula.orderConstraints : [];
  const add = (items) => {
    // P3 : un ordre qui viole une contrainte declaree n'est jamais candidat.
    if (!orderSatisfiesConstraints(items, constraints)) return;
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
    addShockAbsorberOrder(steps, add, 'bowling', 'laser_game', center);
    addShockAbsorberOrder(steps, add, 'laser_game', 'bowling', center);
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

function snapToBowlingGrid(minute) {
  return ceilMinutes(minute, BOWLING_GRID_MINUTES);
}

// `startMinutes` est l'heure de début de la PREMIÈRE activité (l'heure que le
// client choisit). Le bloc « Arrivée & accueil » est ancré AVANT ce départ :
// il apparaît dans la timeline mais ne décale aucune réservation de ressource.
function buildTimeline({ center, formula, pax, startMinutes, order, pauseMinutes = 0 }) {
  const steps = [];
  const resourceBlocks = [];
  const state = { laserBriefed: false };
  let cursor = startMinutes;
  let programStart = null;
  const tableSteps = [];

  order.forEach((step, index) => {
    const activity = getActivity(step.activityId);
    const resourceType = stepResourceType(step);
    const label = activity?.name || step.label || 'Service';

    // Règle métier « Ancres + Liberté » : la table anniversaire n'est PAS une
    // étape à caser dans l'enchaînement : elle appartient au groupe dès son
    // arrivée et le staff la bloque en interne sur toute la durée de la
    // visite. On la sort du flux séquentiel et on l'ancre sur l'arrivée après
    // la construction du programme.
    if (resourceType === 'party_table') {
      tableSteps.push(step);
      return;
    }

    if (resourceType === 'bowling_lane') {
      // Alignement bowling :00/:30. Si le bowling ouvre le programme, tout le
      // programme se cale sur la grille ; sinon on insère un temps libre
      // jusqu'au prochain départ de piste valide (les activités libres autour
      // absorbent l'attente).
      const snapped = snapToBowlingGrid(cursor);
      if (snapped > cursor) {
        if (programStart === null) {
          cursor = snapped;
        } else {
          steps.push({
            type: 'service',
            label: 'Temps libre avant le bowling',
            resourceType: 'transition',
            start: cursor,
            end: snapped,
            startTime: minutesToTime(cursor),
            endTime: minutesToTime(snapped),
          });
          cursor = snapped;
        }
      }
    }

    // P2 : une etape peut porter SON effectif (step.pax), different du groupe
    // entier (10 enfants au laser, 16 personnes a table). Sans donnee : pax.
    const stepPax = Number(step.players || step.pax || pax);
    const declaredResource = getDeclaredResource(center, resourceType);
    const waveSizes = resourceType === 'laser_arena'
      ? splitGroupIntoWaves(stepPax, center.resources.laser?.weaponCount || pax)
      : [stepPax];

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
        timelineStep.requiredLanes = getRequiredLaneCount(center, stepPax);
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
      if (declaredResource) {
        // Ressource declaree : le bloc porte tout ce que l'allocation generique
        // doit savoir (joueurs, installations requises, remise en etat). La
        // remise en etat n'allonge JAMAIS la visite du client : elle etend
        // l'occupation de l'installation, cote conflits.
        timelineStep.players = wavePlayers;
        timelineStep.requiredUnits = requiredUnitsFor(declaredResource, wavePlayers);
        timelineStep.cleanupMinutes = declaredResource.cleanupMinutes;
        timelineStep.critical = true;
      }

      if (programStart === null) programStart = start;
      steps.push(timelineStep);
      if (['bowling_lane', 'laser_arena', 'party_table'].includes(resourceType) || declaredResource) {
        resourceBlocks.push(timelineStep);
      }

      cursor = end;
    });

    if (resourceType !== 'laser_arena' && waveSizes.length > 1) {
      cursor = steps[steps.length - 1].end;
    }
    const hasNextActivity = order.slice(index + 1).some((next) => !['bar_service', 'party_table'].includes(stepResourceType(next)));
    if (hasNextActivity) {
      const transition = TRANSITION_MINUTES;
      steps.push({
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

  const firstActivityStart = programStart === null ? startMinutes : programStart;
  const arrivalStart = firstActivityStart - FORMULA_ARRIVAL_MINUTES;

  // Table anniversaire : bloquée de l'arrivée du groupe jusqu'à la fin de la
  // visite (jamais choisie par le client : « votre table vous attend dès votre
  // arrivée »). Le bloc interne garantit la capacité tables côté staff.
  tableSteps.forEach((step) => {
    const activity = getActivity(step.activityId);
    const tableMinutes = Number(step.durationMinutes || activity?.durationModel?.defaultMinutes || 120);
    const end = Math.max(cursor, firstActivityStart + tableMinutes);
    const tableStep = {
      type: 'activity',
      activityId: step.activityId || 'party_table',
      label: activity?.name || step.label || 'Table anniversaire',
      resourceType: 'party_table',
      countIndex: step.countIndex || 1,
      critical: Boolean(step.critical),
      followsArrival: true,
      start: arrivalStart,
      end,
      startTime: minutesToTime(arrivalStart),
      endTime: minutesToTime(end),
      durationMinutes: end - arrivalStart,
      tableNeed: 1,
    };
    steps.unshift(tableStep);
    resourceBlocks.push(tableStep);
    cursor = Math.max(cursor, end);
  });

  const timeline = [{
    type: 'service',
    label: 'Arrivée & accueil',
    resourceType: 'bar_service',
    start: arrivalStart,
    end: firstActivityStart,
    startTime: minutesToTime(arrivalStart),
    endTime: minutesToTime(firstActivityStart),
  }, ...steps];

  return {
    timeline,
    resourceBlocks,
    // start = début exact de la première activité (heure « client »), l'accueil
    // vit avant ce point et n'entre pas dans totalMinutes.
    start: firstActivityStart,
    end: cursor,
    totalMinutes: cursor - firstActivityStart,
    arrivalStart,
    arrivalMinutes: FORMULA_ARRIVAL_MINUTES,
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

function allocateLanes(center, laneStatuses, reservations, start, end, requiredCount, availabilityBlocks = [], dateISO = '') {
  if (!requiredCount) return [];
  const unavailable = new Set();
  const blocks = reservations.flatMap(laneBlocksFromReservation);

  blocks.forEach((block) => {
    if (overlap(start, end, block.start, block.end)) unavailable.add(Number(block.lane));
  });

  const available = [];
  const laneCount = center.resources.bowling?.laneCount || 0;
  for (let lane = 1; lane <= laneCount; lane += 1) {
    // start/end sont en MINUTES ici. Un blocage de piste a l'heure pres (scope
    // 'lane') retire la piste comme la maintenance. Sans blocage : rien ne change.
    if (!unavailable.has(lane)
      && laneStatuses[String(lane)] !== 'maintenance' && laneStatuses[lane] !== 'maintenance'
      && !isLaneBlockedAt(availabilityBlocks, dateISO, lane, start, end)) {
      available.push(lane);
    }
  }
  if (available.length < requiredCount) return null;

  if (requiredCount === 1) return [available[0]];
  // preferAdjacentLanes cable : la preference de pistes adjacentes (regrouper un
  // meme groupe cote a cote) etait DEJA le comportement inconditionnel ci-dessous.
  // On l'ouvre a la config : seul un centre qui met explicitement
  // preferAdjacentLanes = false renonce a la recherche de bloc contigu. Absent /
  // true => comportement byte-for-byte identique a l'historique (doctrine defaut).
  const preferAdjacent = center.resources.bowling?.preferAdjacentLanes !== false;
  if (preferAdjacent) {
    for (let index = 0; index <= available.length - requiredCount; index += 1) {
      const group = available.slice(index, index + requiredCount);
      if (group.every((lane, offset) => offset === 0 || lane === group[offset - 1] + 1)) return group;
    }
  }
  return available.slice(0, requiredCount);
}

function validateRequestedLanes(center, laneStatuses, reservations, block, availabilityBlocks = [], dateISO = '') {
  const requestedLanes = [...new Set(blockLanes(block))];
  if (!requestedLanes.length) return null;
  const laneCount = center.resources.bowling?.laneCount || 0;
  const occupiedBlocks = reservations
    .flatMap(laneBlocksFromReservation)
    .filter((existing) => overlap(block.start, block.end, existing.start, existing.end));
  const invalid = requestedLanes.filter((lane) => lane < 1 || lane > laneCount);
  const maintenance = requestedLanes.filter((lane) => laneStatuses[String(lane)] === 'maintenance' || laneStatuses[lane] === 'maintenance');
  const occupied = requestedLanes.filter((lane) => occupiedBlocks.some((existing) => Number(existing.lane) === lane));
  // Piste bloquee (scope 'lane') sur la fenetre du bloc : traitee comme la
  // maintenance. block.start/end sont en minutes. Sans blocage : liste vide.
  const blocked = requestedLanes.filter((lane) => isLaneBlockedAt(availabilityBlocks, dateISO, lane, block.start, block.end));

  if (invalid.length || maintenance.length || occupied.length || blocked.length) {
    return {
      ok: false,
      lanes: requestedLanes,
      invalid,
      maintenance: [...new Set([...maintenance, ...blocked])],
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

function evaluateConflicts({ center, scenario, reservations, laneStatuses, blocks: availabilityBlocks = [], dateISO = '' }) {
  const conflicts = [];
  const assignedLanesByBlock = new Map();
  const existingBlocks = reservations.flatMap((reservation) => inferBlocksFromReservation(reservation, center));

  scenario.resourceBlocks.forEach((block, index) => {
    if (block.resourceType === 'bowling_lane') {
      // Activite 'bowling' bloquee sur la fenetre du bloc (scope 'activity') :
      // conflit bloquant, la piste ne peut pas etre attribuee. Sans blocage : rien.
      const bowlingActivityBlocked = isActivityBlockedAt(availabilityBlocks, dateISO, 'bowling', block.start, block.end);
      const requestedLaneCheck = validateRequestedLanes(center, laneStatuses, reservations, block, availabilityBlocks, dateISO);
      const lanes = bowlingActivityBlocked
        ? null
        : requestedLaneCheck
          ? (requestedLaneCheck.ok ? requestedLaneCheck.lanes : null)
          : allocateLanes(center, laneStatuses, reservations, block.start, block.end, block.requiredLanes || 1, availabilityBlocks, dateISO);
      if (!lanes) {
        if (bowlingActivityBlocked) {
          conflicts.push({
            type: 'bowling_conflict',
            severity: 'blocking',
            message: `Bowling indisponible (blocage) a ${minutesToTime(block.start)}.`,
          });
        } else {
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
        }
      } else {
        assignedLanesByBlock.set(index, lanes);
      }
    }

    if (block.resourceType === 'laser_arena') {
      // Activite 'laser_game' bloquee sur la fenetre du bloc (scope 'activity') :
      // conflit bloquant, comme un Laser Game complet. Sans blocage : rien.
      if (isActivityBlockedAt(availabilityBlocks, dateISO, 'laser_game', block.start, block.end)) {
        conflicts.push({
          type: 'laser_conflict',
          severity: 'blocking',
          message: `Laser Game indisponible (blocage) a ${minutesToTime(block.start)}.`,
        });
      }
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

    const declaredResource = getDeclaredResource(center, block.resourceType);
    if (declaredResource) {
      const conflict = evaluateDeclaredResourceBlock({
        declared: declaredResource,
        block,
        availabilityBlocks,
        dateISO,
      });
      if (conflict) conflicts.push(conflict);
    }
  });

  // Pools declares : la capacite s'evalue PAR RESSOURCE, sur l'ensemble des
  // blocs du scenario (deux passages du meme groupe sur la meme salle comptent
  // ensemble, remise en etat comprise) plus l'existant du planning. Une
  // evaluation bloc par bloc manquerait la contention interne du scenario.
  const declaredTypes = [...new Set((scenario.resourceBlocks || []).map((block) => block.resourceType))]
    .map((type) => getDeclaredResource(center, type))
    .filter(Boolean);
  declaredTypes.forEach((declared) => {
    const ownBlocks = scenario.resourceBlocks.filter((block) => block.resourceType === declared.id);
    const sameType = existingBlocks.filter((existing) => existing.resourceType === declared.id);
    const sessions = declaredSessionsUnits(declared, [...sameType, ...ownBlocks]);
    const peak = declaredPeakUnits(declared, sessions);
    if (peak > declared.units) {
      const first = ownBlocks[0];
      const { start, end } = declaredBlockWindow(first);
      conflicts.push({
        type: 'resource_conflict',
        severity: 'blocking',
        message: `${declared.name} complet sur ${minutesToTime(start)}-${minutesToTime(end)}: ${peak}/${declared.units} installation(s) demandees (remise en etat ${declared.cleanupMinutes} min comprise).`,
      });
    }
  });

  return { conflicts, assignedLanesByBlock };
}

// === Allocation generique des ressources DECLAREES ==========================
// Le pool : `units` installations interchangeables de `capacityPerUnit` places,
// `cleanupMinutes` de remise en etat apres chaque occupation, mixage de groupes
// autorise ou non. Verite exacte, pas d'heuristique : pour des installations
// interchangeables, une demande d'intervalles est realisable si et seulement si
// la demande simultanee maximale (fenetres ETENDUES de la remise en etat) ne
// depasse jamais `units` (ordonnancement d'intervalles sur k machines).

function declaredBlockWindow(block) {
  const start = Number.isFinite(Number(block.start)) ? Number(block.start) : timeToMinutes(block.startTime);
  const end = Number.isFinite(Number(block.end)) ? Number(block.end) : timeToMinutes(block.endTime);
  return { start, end };
}

// Sessions : les occupations d'un pool groupees par fenetre EXACTE [start,end).
// Avec mixage, les joueurs d'une meme fenetre s'additionnent et remplissent les
// installations ensemble ; sans mixage, chaque groupe garde ses installations.
function declaredSessionsUnits(declared, blocks) {
  const sessions = new Map();
  blocks.forEach((block) => {
    const { start, end } = declaredBlockWindow(block);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const key = `${start}-${end}`;
    if (!sessions.has(key)) sessions.set(key, { start, end, players: 0, units: 0 });
    const session = sessions.get(key);
    const players = Math.max(1, Number(block.players || block.pax || 1));
    session.players += players;
    session.units += Number(block.requiredUnits) || requiredUnitsFor(declared, players);
  });
  return [...sessions.values()].map((session) => ({
    start: session.start,
    end: session.end,
    players: session.players,
    units: declared.allowGroupMixing ? requiredUnitsFor(declared, session.players) : session.units,
  }));
}

function declaredPeakUnits(declared, sessions) {
  // Balayage par evenements sur les fenetres etendues de la remise en etat.
  const events = [];
  sessions.forEach((session) => {
    events.push([session.start, session.units]);
    events.push([session.end + declared.cleanupMinutes, -session.units]);
  });
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let current = 0;
  let peak = 0;
  events.forEach(([, delta]) => {
    current += delta;
    if (current > peak) peak = current;
  });
  return peak;
}

// Verifications PAR BLOC d'un pool declare : blocage de disponibilite (scope
// 'activity') et faisabilite structurelle (le groupe tient-il dans le pool
// entier ?). La capacite partagee, elle, s'evalue par ressource dans
// evaluateConflicts : un bloc seul ne voit pas ses freres de scenario.
function evaluateDeclaredResourceBlock({ declared, block, availabilityBlocks, dateISO }) {
  const { start, end } = declaredBlockWindow(block);
  const label = declared.name;

  if (block.activityId && isActivityBlockedAt(availabilityBlocks, dateISO, block.activityId, start, end)) {
    return {
      type: 'resource_conflict',
      severity: 'blocking',
      message: `${label} indisponible (blocage) a ${minutesToTime(start)}.`,
    };
  }

  const players = Math.max(1, Number(block.players || block.pax || 1));
  const required = Number(block.requiredUnits) || requiredUnitsFor(declared, players);
  if (required > declared.units) {
    return {
      type: 'resource_conflict',
      severity: 'blocking',
      message: `${label}: ${players} joueurs demandent ${required} installation(s), le centre n'en a que ${declared.units}.`,
    };
  }
  return null;
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
      return !isCriticalResourceType(center, step.resourceType);
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

  if (Number.isFinite(scenario.arrivalStart)) {
    customerCommitment.unshift(
      `Votre première activité démarre à ${minutesToTime(scenario.start)} : présentez-vous ${FORMULA_ARRIVAL_MINUTES} minutes avant pour l'accueil (${minutesToTime(scenario.arrivalStart)}).`,
    );
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

function decorateScenario({ center, formula, pax, date, scenario, reservations, laneStatuses, preference, activityType = '', blocks: availabilityBlocks = [] }) {
  const conflictResult = evaluateConflicts({ center, scenario, reservations, laneStatuses, blocks: availabilityBlocks, dateISO: date });
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
    // startTime = début exact de la première activité (l'heure « client »).
    // L'accueil recommandé vit avant, exposé via arrivalTime/arrivalMinutes.
    startTime: minutesToTime(scenario.start),
    endTime: minutesToTime(scenario.end + risk.bufferMinutes),
    totalMinutes: scenario.totalMinutes,
    arrivalTime: Number.isFinite(scenario.arrivalStart) ? minutesToTime(scenario.arrivalStart) : null,
    arrivalMinutes: Number.isFinite(scenario.arrivalMinutes) ? scenario.arrivalMinutes : null,
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

function validateFormulaBusinessRules({ formula, date, pax, startMinutes = null, totalMinutes = 0, center = null }) {
  if (!isOfferEnabled(formula.id, center)) {
    return { ok: false, reason: `${formula.name} est momentanément désactivée par le centre.` };
  }

  if (pax < Number(formula.minPax || 1)) {
    return { ok: false, reason: `Minimum ${formula.minPax} personnes pour ${formula.name}.` };
  }

  const day = new Date(`${date}T12:00:00`).getDay();
  if (Array.isArray(formula.validDays) && !formula.validDays.includes(day)) {
    return { ok: false, reason: `${formula.name} indisponible ce jour.` };
  }

  if (formula.notDuringHolidays && isFormulaBlockedDate(date, center)) {
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

// `preMinutes` : temps de service à caser AVANT l'heure de début (accueil des
// formules/laser). L'accueil doit tenir dans les horaires d'ouverture, donc le
// premier départ possible est `open + preMinutes`, recalé sur la grille.
function getScheduleWindow({ center, date, estimatedMinutes, formula = null, preMinutes = 0 }) {
  const centerReady = validateCenterReady(center);
  if (!centerReady.ok) return centerReady;

  const today = todayStr();
  if (date < today) {
    return { ok: false, reason: 'Cette date est déjà passée.' };
  }

  const schedule = getSchedule(date, center);
  if (!schedule) {
    return { ok: false, reason: 'Le centre est fermé à cette date.' };
  }

  const { rules } = loadOpsKnowledge();
  const step = rules.scenarioGeneration.slotStepMinutes;
  const leadMinutes = Number(rules.scenarioGeneration.sameDayLeadMinutes || 15);
  let minStart = Math.round(schedule.open * 60);
  if (preMinutes > 0) {
    minStart = ceilMinutes(minStart + preMinutes, step);
  }
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

function getCandidateStartTimes({ center, date, requestedStartTime, estimatedMinutes, formula = null, preMinutes = 0 }) {
  const window = getScheduleWindow({ center, date, estimatedMinutes, formula, preMinutes });
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
  const schedule = getSchedule(date, center);
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
    // La table anniversaire n'est pas une « activité » que le centre active ou
    // non : c'est une ressource interne (capacité tables) qui suit l'arrivée
    // du groupe. Sa disponibilité se joue dans les conflits de capacité.
    if (stepResourceType(step) === 'party_table') return;
    const activity = step.activityId ? getActivity(step.activityId) : null;
    if (!activity) return;
    // MEME REGLE POUR TOUTE COMPOSANTE INTERNE : une activité non réservable
    // seule (boissons, crédit arcade, et toute activité créée « pour les
    // formules » en console) n'est pas un choix d'offre du centre, c'est un
    // ingrédient du service. L'exiger dans activityAvailability rendait la
    // formule improgrammable pour tous les centres dès que l'ingrédient
    // entrait au catalogue (« Activité non disponible : service_drinks »),
    // et l'aurait fait à chaque activité perso ajoutée.
    if (activity.booking && activity.booking.bookable === false) return;
    if (center.activityAvailability[step.activityId] !== true) unavailable.push(step.activityId);
  });
  return unavailable;
}

// --- Modèle « Ancres + Liberté » --------------------------------------------
// Une formule se décompose en trois familles :
// 1. ANCRES : bowling (piste) et laser (sessions), les seules vraies
//    ressources à créneau. Le client choisit une heure par ancre.
// 2. TABLE ANNIVERSAIRE : jamais choisie, elle suit l'heure d'arrivée
//    (10 min avant la première ancre) et reste bloquée en interne sur la
//    durée de la visite.
// 3. PASS LIBERTÉ : minigolf, arcades, playground, boissons, aucun horaire,
//    jamais. Utilisables à volonté pendant la visite.
const ANCHOR_ACTIVITY_IDS = ['bowling', 'laser_game'];
// Écart qu'une visite absorbe sans que le client attende « pour rien » : la
// durée du pass liberté entre les deux ancres + une marge de respiration.
// AU-DELÀ, LE MOTEUR PRÉVIENT, IL NE REFUSE PAS (arbitrage Movsar du
// 2026-08-15 : « ils doivent être libres de choisir la date qu'ils veulent »).
// Le confort est un avis ; seules l'impossibilité physique (chevauchement,
// ressource prise, capacité, horaires du centre) reste un refus.
const ANCHOR_GAP_GRACE_MINUTES = 60;

// « 2 h 30 », « 45 min » : sert les avis de confort rendus au client.
function formatGapLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function getFormulaAnchorModel(formula) {
  const steps = expandFormulaSteps(formula);
  const anchors = [];
  ANCHOR_ACTIVITY_IDS.forEach((activityId) => {
    const matching = steps.filter((step) => step.activityId === activityId);
    if (!matching.length) return;
    anchors.push({
      activityId,
      label: getActivity(activityId)?.name || activityId,
      count: matching.length,
      durationMinutes: activityId === 'laser_game'
        ? LASER_GAME_ARENA_MINUTES
        : Number(matching[0].durationMinutes || 60),
    });
  });
  const freeSteps = steps.filter((step) => !ANCHOR_ACTIVITY_IDS.includes(step.activityId)
    && stepResourceType(step) !== 'party_table');
  const tableStep = steps.find((step) => stepResourceType(step) === 'party_table') || null;
  const freeMinutes = freeSteps.reduce((sum, step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    const model = activity?.durationModel || {};
    return sum + Number(step.durationMinutes || model.defaultMinutes || model.gameMinutes || 30);
  }, 0);
  return { anchors, freeSteps, tableStep, freeMinutes };
}

function normalizeAnchorPreference(preference = {}) {
  const preferred = normalizePreferredTimes(preference);
  const anchorTimes = {};
  ANCHOR_ACTIVITY_IDS.forEach((activityId) => {
    if (preferred[activityId]) anchorTimes[activityId] = timeToMinutes(preferred[activityId]);
  });
  return {
    anchorTimes,
    laserPlacement: preference.laserPlacement === 'onsite' ? 'onsite' : 'scheduled',
  };
}

function isAnchoredFormulaRequest(formula, preference = {}) {
  if (!getFormulaAnchorModel(formula).anchors.length) return false;
  const { anchorTimes, laserPlacement } = normalizeAnchorPreference(preference);
  return Object.keys(anchorTimes).length > 0 || laserPlacement === 'onsite';
}

function buildAnchorLaserPassPlan({ laserAnchor, laserOnSite, laserStart }) {
  if (!laserAnchor) return null;
  const totalGames = Math.max(1, Number(laserAnchor.count || 1));
  const scheduledGames = laserOnSite ? 0 : 1;
  if (totalGames <= scheduledGames) return null;
  return {
    mode: laserOnSite ? 'all_on_site' : 'manual_after_first',
    totalGames,
    scheduledGames,
    remainingGames: totalGames - scheduledGames,
    scheduledPasses: laserOnSite ? [] : [{ countIndex: 1, status: 'scheduled', startTime: minutesToTime(laserStart) }],
    pendingPasses: Array.from({ length: totalGames - scheduledGames }, (_, index) => ({
      countIndex: scheduledGames + index + 1,
      status: 'pending',
    })),
  };
}

// Compose la visite à partir des heures d'ancre choisies. Aucune activité
// libre n'y reçoit d'horaire propre : elles couvrent la fenêtre de visite
// entière (flexible: true) et le client ne voit jamais d'heure pour elles.
function composeAnchoredFormulaScenario({ center, formula, pax, anchorTimes = {}, laserPlacement = 'scheduled' }) {
  const model = getFormulaAnchorModel(formula);
  if (!model.anchors.length) {
    return { ok: false, code: 'no_anchor', reason: 'Cette formule ne comporte aucune activité à créneau : choisissez simplement votre heure d’arrivée.' };
  }

  const bowlingAnchor = model.anchors.find((anchor) => anchor.activityId === 'bowling') || null;
  const laserAnchor = model.anchors.find((anchor) => anchor.activityId === 'laser_game') || null;
  // « Je place mes parties laser sur place » : possible uniquement si une
  // autre ancre (bowling) fixe l'arrivée : il faut au moins UNE ancre pour
  // ancrer l'accueil et la table.
  const laserOnSite = Boolean(laserAnchor) && laserPlacement === 'onsite' && Boolean(bowlingAnchor);

  const requiredAnchors = model.anchors.filter((anchor) => !(anchor.activityId === 'laser_game' && laserOnSite));
  for (const anchor of requiredAnchors) {
    const start = anchorTimes[anchor.activityId];
    if (!Number.isFinite(start)) {
      return { ok: false, code: 'missing_anchor', reason: `Choisissez une heure pour ${anchor.label}.` };
    }
    if (start % PROGRAM_GRID_MINUTES !== 0) {
      return { ok: false, code: 'off_grid', reason: `${anchor.label} démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30).` };
    }
  }

  const anchorBlocks = [];
  const anchorWindows = [];
  if (bowlingAnchor) {
    const start = anchorTimes.bowling;
    const end = start + bowlingAnchor.durationMinutes;
    anchorBlocks.push({
      type: 'activity',
      activityId: 'bowling',
      label: 'Bowling',
      resourceType: 'bowling_lane',
      countIndex: 1,
      critical: true,
      start,
      end,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      durationMinutes: bowlingAnchor.durationMinutes,
      requiredLanes: getRequiredLaneCount(center, pax),
      players: pax,
    });
    anchorWindows.push({ activityId: 'bowling', label: 'Bowling', start, end });
  }
  if (laserAnchor && !laserOnSite) {
    const weaponCount = center.resources.laser?.weaponCount || pax;
    const waveSizes = splitGroupIntoWaves(pax, weaponCount);
    let waveCursor = anchorTimes.laser_game;
    waveSizes.forEach((wavePlayers, waveIndex) => {
      const end = waveCursor + LASER_GAME_ARENA_MINUTES;
      anchorBlocks.push({
        type: 'activity',
        activityId: 'laser_game',
        label: waveSizes.length > 1 ? `Laser Game - groupe ${waveIndex + 1}/${waveSizes.length}` : 'Laser Game',
        resourceType: 'laser_arena',
        countIndex: 1,
        critical: true,
        start: waveCursor,
        end,
        startTime: minutesToTime(waveCursor),
        endTime: minutesToTime(end),
        durationMinutes: LASER_GAME_ARENA_MINUTES,
        players: wavePlayers,
        groupPlayers: pax,
        groupWaveIndex: waveIndex + 1,
        groupWaveCount: waveSizes.length,
        weaponNeed: Math.min(wavePlayers, weaponCount),
      });
      waveCursor = end;
    });
    anchorWindows.push({
      activityId: 'laser_game',
      label: 'Laser Game',
      start: anchorTimes.laser_game,
      end: waveCursor,
    });
  }

  // Cohérence de la combinaison. DEUX NIVEAUX, jamais confondus :
  //  - IMPOSSIBLE : un groupe ne peut pas être à deux endroits en même temps.
  //    Chevauchement = refus, et ça le restera.
  //  - INCONFORTABLE : un trou plus grand que ce que le pass liberté occupe.
  //    C'est un choix que le client a le droit d'assumer : on le PRÉVIENT, on
  //    ne l'interdit plus (le refus `anchor_gap` a disparu ici le 2026-08-15).
  const orderedWindows = [...anchorWindows].sort((left, right) => left.start - right.start);
  const comfortNotices = [];
  for (let index = 1; index < orderedWindows.length; index += 1) {
    const previous = orderedWindows[index - 1];
    const current = orderedWindows[index];
    if (current.start < previous.end + TRANSITION_MINUTES) {
      return {
        ok: false,
        code: 'anchor_overlap',
        reason: `${previous.label} (${minutesToTime(previous.start)}-${minutesToTime(previous.end)}) et ${current.label} (${minutesToTime(current.start)}) se chevauchent : décalez l'une des deux heures.`,
      };
    }
    const gap = current.start - previous.end;
    const absorbedMinutes = model.freeMinutes + ANCHOR_GAP_GRACE_MINUTES;
    if (gap > absorbedMinutes) {
      comfortNotices.push({
        code: 'anchor_gap',
        severity: 'advice',
        fromActivityId: previous.activityId,
        toActivityId: current.activityId,
        fromLabel: previous.label,
        toLabel: current.label,
        gapMinutes: gap,
        gapLabel: formatGapLabel(gap),
        // L'heure la plus proche qui collerait les deux activités : c'est ce
        // que le client peut appliquer en un geste s'il préfère enchaîner.
        tightenTime: minutesToTime(ceilMinutes(previous.end + TRANSITION_MINUTES, PROGRAM_GRID_MINUTES)),
        message: `${formatGapLabel(gap)} d'attente entre ${previous.label} et ${current.label}.`,
      });
    }
  }

  const firstStart = Math.min(...anchorBlocks.map((block) => block.start));
  const lastEnd = Math.max(...anchorBlocks.map((block) => block.end));
  const arrivalStart = firstStart - FORMULA_ARRIVAL_MINUTES;
  // Durée de visite indicative pour le staff : ancres planifiées + pass
  // liberté + transitions.
  const scheduledAnchorMinutes = anchorWindows.reduce((sum, window) => sum + (window.end - window.start), 0);
  const sequentialMinutes = scheduledAnchorMinutes
    + model.freeMinutes
    + (anchorWindows.length + model.freeSteps.length) * TRANSITION_MINUTES;
  let visitEnd = Math.max(lastEnd, firstStart + sequentialMinutes);

  const resourceBlocks = [...anchorBlocks];
  const timeline = [{
    type: 'service',
    label: 'Arrivée & accueil',
    resourceType: 'bar_service',
    start: arrivalStart,
    end: firstStart,
    startTime: minutesToTime(arrivalStart),
    endTime: minutesToTime(firstStart),
  }];

  if (model.tableStep) {
    const activity = getActivity(model.tableStep.activityId);
    const tableMinutes = Number(model.tableStep.durationMinutes || activity?.durationModel?.defaultMinutes || 120);
    visitEnd = Math.max(visitEnd, firstStart + tableMinutes);
    const tableBlock = {
      type: 'activity',
      activityId: model.tableStep.activityId || 'party_table',
      label: activity?.name || model.tableStep.label || 'Table anniversaire',
      resourceType: 'party_table',
      countIndex: 1,
      critical: Boolean(model.tableStep.critical),
      followsArrival: true,
      start: arrivalStart,
      end: visitEnd,
      startTime: minutesToTime(arrivalStart),
      endTime: minutesToTime(visitEnd),
      durationMinutes: visitEnd - arrivalStart,
      tableNeed: 1,
    };
    timeline.push(tableBlock);
    resourceBlocks.push(tableBlock);
  }

  timeline.push(...anchorBlocks);

  // Pass liberté : chaque avantage couvre la fenêtre de visite entière, 
  // aucun horaire propre, jamais montré au client.
  model.freeSteps.forEach((step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    const stepModel = activity?.durationModel || {};
    timeline.push({
      type: step.activityId && stepResourceType(step) !== 'bar_service' ? 'activity' : 'service',
      activityId: step.activityId || null,
      label: activity?.name || step.label || 'Service',
      resourceType: stepResourceType(step),
      countIndex: step.countIndex || 1,
      flexible: true,
      start: firstStart,
      end: visitEnd,
      startTime: minutesToTime(firstStart),
      endTime: minutesToTime(visitEnd),
      durationMinutes: Number(step.durationMinutes || stepModel.defaultMinutes || stepModel.gameMinutes || 30),
    });
  });

  return {
    ok: true,
    timeline,
    resourceBlocks,
    start: firstStart,
    end: visitEnd,
    totalMinutes: visitEnd - firstStart,
    arrivalStart,
    arrivalMinutes: FORMULA_ARRIVAL_MINUTES,
    // Avis de confort : la combinaison est réservable, on dit juste ce qu'elle
    // implique sur place. Jamais un motif de refus.
    comfortNotices,
    laserPassPlan: buildAnchorLaserPassPlan({ laserAnchor, laserOnSite, laserStart: anchorTimes.laser_game }),
    anchorPlan: {
      mode: 'anchors_freedom',
      laserPlacement: laserOnSite ? 'onsite' : 'scheduled',
      times: Object.fromEntries(anchorWindows.map((window) => [window.activityId, minutesToTime(window.start)])),
    },
  };
}

// Valide une combinaison d'ancres complète : composition, horaires
// d'ouverture, règles de la formule, conflits de ressources (serveur =
// source de vérité). Renvoie le scénario décoré prêt pour opsPlan.
function evaluateAnchoredCombination({ center, formula, date, pax, anchorTimes, laserPlacement, reservations = [], laneStatuses = {}, blocks = [], preference = {} }) {
  const raw = composeAnchoredFormulaScenario({ center, formula, pax, anchorTimes, laserPlacement });
  if (!raw.ok) return { ok: false, code: raw.code, reason: raw.reason, scenario: null };

  const businessRules = validateFormulaBusinessRules({
    formula,
    date,
    pax,
    startMinutes: raw.start,
    totalMinutes: raw.totalMinutes,
    center,
  });
  if (!businessRules.ok) return { ok: false, code: 'business_rules', reason: businessRules.reason, scenario: null };

  const window = getScheduleWindow({
    center,
    date,
    estimatedMinutes: raw.totalMinutes,
    formula,
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  if (!window.ok) return { ok: false, code: 'schedule', reason: window.reason, scenario: null };
  if (raw.start < window.minStart || raw.end > window.close) {
    return {
      ok: false,
      code: 'schedule',
      reason: 'Ces heures ne rentrent pas dans les horaires du centre pour cette formule.',
      scenario: null,
    };
  }

  const decorated = decorateScenario({
    center,
    formula,
    pax,
    date,
    scenario: raw,
    reservations,
    laneStatuses,
    blocks,
    preference,
  });
  decorated.laserPassPlan = raw.laserPassPlan;
  decorated.anchorPlan = raw.anchorPlan;
  decorated.comfortNotices = raw.comfortNotices || [];

  if (!decorated.ok) {
    return {
      ok: false,
      code: 'resource_conflict',
      reason: decorated.conflicts[0]?.message || 'Cette combinaison n’est plus disponible.',
      scenario: decorated,
    };
  }
  return { ok: true, code: '', reason: '', scenario: decorated };
}

function anchorLaserCapacityOk({ center, existingLaserBlocks, start, pax }) {
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const parallelLaunches = center.resources.laser?.parallelLaunches || 1;
  const waveSizes = splitGroupIntoWaves(pax, weaponCount);
  let cursor = start;
  for (const wavePlayers of waveSizes) {
    const end = cursor + LASER_GAME_ARENA_MINUTES;
    const overlapping = existingLaserBlocks.filter((block) => overlap(cursor, end, block.start, block.end));
    const sessionKeys = new Set(overlapping.map((block) => `${block.start}-${block.end}`));
    const joinsExisting = sessionKeys.has(`${cursor}-${end}`);
    const launchCount = sessionKeys.size + (joinsExisting ? 0 : 1);
    const players = overlapping.reduce((sum, block) => sum + Number(block.players || block.pax || 0), wavePlayers);
    if (launchCount > parallelLaunches || players > weaponCount) return null;
    cursor = end;
  }
  const firstOverlap = existingLaserBlocks.filter((block) => overlap(start, start + LASER_GAME_ARENA_MINUTES, block.start, block.end));
  const playersBefore = firstOverlap.reduce((sum, block) => sum + Number(block.players || block.pax || 0), 0);
  return {
    playersBefore,
    remainingPlaces: Math.max(0, weaponCount - playersBefore - Math.max(...waveSizes, 0)),
    sharedSession: playersBefore > 0,
    waveCount: waveSizes.length,
  };
}

// Disponibilité PAR ANCRE pour une formule : la liste des heures possibles de
// chaque ancre (grille :00/:30, capacité vérifiée indépendamment) + une
// combinaison par défaut valide. C'est la matière première des chips côté
// client ; la combinaison choisie est ensuite revalidée en entier.
function getFormulaAnchorAvailability(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  // Meme porte d'entree que planFormula : un document fourni par l'appelant
  // (visite composee par le client) court-circuite la resolution par id.
  const formula = (input.formula && typeof input.formula === 'object')
    ? input.formula
    : getFormula(input.formuleId || input.formulaId);
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
  const model = getFormulaAnchorModel(formula);
  const freePass = model.freeSteps
    .filter((step) => step.activityId !== 'service_drinks')
    .map((step) => ({
      activityId: step.activityId || '',
      label: getActivity(step.activityId)?.name || step.label || 'Activité libre',
    }))
    .filter((item, index, list) => list.findIndex((other) => other.label === item.label) === index);
  const drinks = model.freeSteps
    .filter((step) => step.activityId === 'service_drinks')
    .map((step) => step.label || 'Boissons')
    .filter((label, index, list) => list.indexOf(label) === index);
  const base = {
    ok: true,
    reason: '',
    arrivalLeadMinutes: FORMULA_ARRIVAL_MINUTES,
    hasTable: Boolean(model.tableStep),
    freePass,
    drinks,
    laserGames: model.anchors.find((anchor) => anchor.activityId === 'laser_game')?.count || 0,
    laserOnSiteAvailable: model.anchors.length >= 2
      && model.anchors.some((anchor) => anchor.activityId === 'laser_game'),
    activities: [],
    defaultTimes: null,
  };
  if (!model.anchors.length) return base;

  const estimated = estimateFormulaMinutes(center, formula, pax, 0);
  const window = getScheduleWindow({
    center,
    date,
    estimatedMinutes: Math.min(estimated, model.anchors[0].durationMinutes + 30),
    formula,
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  if (!window.ok) return { ...base, ok: false, reason: window.reason };

  const existingLaserBlocks = model.anchors.some((anchor) => anchor.activityId === 'laser_game')
    ? reservations
      .flatMap((reservation) => inferBlocksFromReservation(reservation, center))
      .map(normalizeLaserArenaBlock)
      .filter((block) => block.resourceType === 'laser_arena')
    : [];

  const otherDuration = (activityId) => model.anchors
    .filter((anchor) => anchor.activityId !== activityId)
    .reduce((sum, anchor) => sum + anchor.durationMinutes + TRANSITION_MINUTES, 0);

  const candidatesByActivity = {};
  base.activities = model.anchors.map((anchor) => {
    const times = [];
    const firstGridStart = ceilMinutes(window.minStart, PROGRAM_GRID_MINUTES);
    for (let start = firstGridStart; start + anchor.durationMinutes <= window.close; start += PROGRAM_GRID_MINUTES) {
      // L'heure doit rester combinable : l'autre ancre doit pouvoir passer
      // avant (après l'ouverture) ou après (avant la fermeture).
      const others = otherDuration(anchor.activityId);
      const fitsBefore = start - others >= window.minStart;
      const fitsAfter = start + anchor.durationMinutes + others <= window.close;
      if (others > 0 && !fitsBefore && !fitsAfter) continue;
      if (anchor.activityId === 'bowling') {
        // Activite bowling bloquee (scope 'activity') sur la fenetre de l'ancre :
        // aucune heure proposee. La piste bloquee (scope 'lane') est geree par
        // allocateLanes. Sans blocage : rien ne change.
        if (isActivityBlockedAt(availabilityBlocks, date, 'bowling', start, start + anchor.durationMinutes)) continue;
        const lanes = allocateLanes(center, laneStatuses, reservations, start, start + anchor.durationMinutes, getRequiredLaneCount(center, pax), availabilityBlocks, date);
        if (!lanes) continue;
        times.push({ time: minutesToTime(start), lanes });
      } else {
        // Activite laser bloquee (scope 'activity') sur la fenetre : heure retiree.
        if (isActivityBlockedAt(availabilityBlocks, date, 'laser_game', start, start + anchor.durationMinutes)) continue;
        const capacity = anchorLaserCapacityOk({ center, existingLaserBlocks, start, pax });
        if (!capacity) continue;
        times.push({
          time: minutesToTime(start),
          remainingPlaces: capacity.remainingPlaces,
          sharedSession: capacity.sharedSession,
          waveCount: capacity.waveCount,
        });
      }
    }
    candidatesByActivity[anchor.activityId] = times.map((item) => timeToMinutes(item.time));
    return {
      activityId: anchor.activityId,
      label: anchor.label,
      count: anchor.count,
      durationMinutes: anchor.durationMinutes,
      times,
    };
  });

  if (base.activities.some((activity) => !activity.times.length)) {
    return { ...base, ok: false, reason: 'Aucune heure disponible pour toutes les activités de la formule ce jour-là.' };
  }

  const defaults = buildDefaultAnchorTimes({
    center,
    formula,
    date,
    pax,
    model,
    candidatesByActivity,
    reservations,
    laneStatuses,
    blocks: availabilityBlocks,
  });
  if (defaults) {
    base.defaultTimes = Object.fromEntries(Object.entries(defaults).map(([activityId, minutes]) => [activityId, minutesToTime(minutes)]));
  }
  return base;
}

// Combinaison par défaut (zéro friction) : première heure valide de la
// première ancre, puis chaque ancre suivante calée juste après. Peut partir
// d'une heure de première ancre imposée (liste des départs proposés).
function buildDefaultAnchorTimes({ center, formula, date, pax, model, candidatesByActivity, reservations, laneStatuses, blocks = [], firstStart = null }) {
  const anchorIds = model.anchors.map((anchor) => anchor.activityId);
  if (!anchorIds.length) return null;
  const firstId = anchorIds[0];
  const firstCandidates = (candidatesByActivity[firstId] || [])
    .filter((start) => firstStart === null || start === firstStart);

  for (const start of firstCandidates) {
    const anchorTimes = { [firstId]: start };
    let cursor = start + model.anchors[0].durationMinutes * (firstId === 'laser_game' ? splitGroupIntoWaves(pax, center.resources.laser?.weaponCount || pax).length : 1);
    let feasible = true;
    for (let index = 1; index < anchorIds.length; index += 1) {
      const anchorId = anchorIds[index];
      const next = (candidatesByActivity[anchorId] || []).find((candidate) => candidate >= cursor + TRANSITION_MINUTES);
      if (next === undefined) {
        feasible = false;
        break;
      }
      anchorTimes[anchorId] = next;
      cursor = next + model.anchors[index].durationMinutes * (anchorId === 'laser_game' ? splitGroupIntoWaves(pax, center.resources.laser?.weaponCount || pax).length : 1);
    }
    if (!feasible) continue;
    const result = evaluateAnchoredCombination({
      center,
      formula,
      date,
      pax,
      anchorTimes,
      laserPlacement: 'scheduled',
      reservations,
      laneStatuses,
      blocks,
    });
    if (result.ok) return anchorTimes;
  }
  return null;
}

// Suggestions proches quand une combinaison choisie est impossible : on garde
// les autres ancres et on cherche, pour chaque ancre, les heures valides les
// plus proches de la demande.
function suggestAnchorCombinations({ center, formula, date, pax, anchorTimes = {}, laserPlacement = 'scheduled', reservations = [], laneStatuses = {} }, limit = 4) {
  const model = getFormulaAnchorModel(formula);
  const availability = getFormulaAnchorAvailability(
    // On repasse le DOCUMENT, pas seulement son id : une visite composee n'est
    // dans aucun catalogue, la resoudre par id jetterait "Formule inconnue".
    { centerId: center.id, formuleId: formula.id, formula, date, pax },
    { reservations, laneStatuses },
  );
  if (!availability.ok) return [];
  const suggestions = [];
  const seen = new Set();
  for (const anchor of model.anchors) {
    const requested = anchorTimes[anchor.activityId];
    if (!Number.isFinite(requested)) continue;
    const candidates = (availability.activities.find((activity) => activity.activityId === anchor.activityId)?.times || [])
      .map((item) => timeToMinutes(item.time))
      .sort((left, right) => Math.abs(left - requested) - Math.abs(right - requested));
    let found = 0;
    for (const candidate of candidates) {
      if (found >= 2 || suggestions.length >= limit) break;
      const combo = { ...anchorTimes, [anchor.activityId]: candidate };
      const key = ANCHOR_ACTIVITY_IDS.map((id) => `${id}:${combo[id] ?? ''}`).join('|');
      if (seen.has(key)) continue;
      const result = evaluateAnchoredCombination({
        center,
        formula,
        date,
        pax,
        anchorTimes: combo,
        laserPlacement,
        reservations,
        laneStatuses,
      });
      if (!result.ok) continue;
      seen.add(key);
      found += 1;
      suggestions.push({
        times: Object.fromEntries(Object.entries(combo).map(([activityId, minutes]) => [activityId, minutesToTime(minutes)])),
        label: model.anchors
          .filter((item) => Number.isFinite(combo[item.activityId]))
          .map((item) => `${item.label} ${minutesToTime(combo[item.activityId])}`)
          .join(' · '),
      });
    }
    if (suggestions.length >= limit) break;
  }
  return suggestions.slice(0, limit);
}

// Planification d'une formule en mode « Ancres + Liberté » : le client a fixé
// ses heures par ancre (ou choisi le laser « sur place »), le serveur
// revalide toute la combinaison et refuse clairement sinon.
function planFormulaWithAnchors(input, context, { center, formula, date, pax, preference }) {
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
  const { anchorTimes, laserPlacement } = normalizeAnchorPreference(preference);
  const result = evaluateAnchoredCombination({
    center,
    formula,
    date,
    pax,
    anchorTimes,
    laserPlacement,
    reservations,
    laneStatuses,
    blocks: availabilityBlocks,
    preference,
  });

  const scenarios = result.scenario ? [result.scenario] : [];
  return {
    ok: result.ok,
    reason: result.ok ? '' : result.reason,
    refusalCode: result.ok ? '' : result.code,
    type: 'formule',
    centerId: center.id,
    date,
    formulaId: formula.id,
    formulaName: formula.name,
    pax,
    requestedStartTime: input.startTime || (result.scenario ? result.scenario.startTime : null),
    recommended: result.ok ? result.scenario : (result.scenario || null),
    scenarios,
    validationMode: formula.humanValidation || 'recommended',
    anchorSuggestions: result.ok ? [] : suggestAnchorCombinations({
      center,
      formula,
      date,
      pax,
      anchorTimes,
      laserPlacement,
      reservations,
      laneStatuses,
    }),
  };
}

function planFormula(input, context = {}) {
  const knowledge = loadOpsKnowledge();
  const center = getCenter(input.centerId || 'libramont');
  // input.formula : document de formule fourni par l'appelant, au lieu d'un id a
  // resoudre au catalogue. C'est ce qui permet a une VISITE composee par le
  // client (lib/visit-program) d'etre planifiee par le moteur des formules sans
  // qu'aucune ligne de catalogue existe pour elle. Le catalogue reste la source
  // pour tout id : passer un document est un choix explicite de l'appelant.
  const rawFormula = (input.formula && typeof input.formula === 'object')
    ? input.formula
    : getFormula(input.formuleId || input.formulaId);
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const pauseMinutes = 0;
  const preference = input.preference || {};
  // P2 : etapes optionnelles retirees par le client (sans donnee optional dans
  // la formule, rend l'entree telle quelle : zero changement).
  const formula = applyOptionalSelection(rawFormula, preference);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
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

  // Modèle « Ancres + Liberté » : dès que le client a choisi une heure par
  // ancre (bowling/laser) ou l'option laser « sur place », la combinaison est
  // composée et validée telle quelle : plus de programme rigide imposé.
  if (isAnchoredFormulaRequest(formula, preference)) {
    return planFormulaWithAnchors(input, context, { center, formula, date, pax, preference });
  }

  const estimated = estimateFormulaMinutes(center, formula, pax, pauseMinutes);
  const baseRules = validateFormulaBusinessRules({
    formula,
    date,
    pax,
    startMinutes: input.startTime ? timeToMinutes(input.startTime) : null,
    totalMinutes: estimated,
    center,
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
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  const starts = candidateResult.starts;
  const requestedStartMinutes = input.startTime ? timeToMinutes(input.startTime) : null;
  const orders = generateOrders(formula, preference, center);
  const scenarios = [];

  starts.forEach((startMinutes) => {
    const formulaRules = validateFormulaBusinessRules({
      formula,
      date,
      pax,
      startMinutes,
      totalMinutes: estimated,
      center,
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
      });
      // L'heure demandée est l'heure EXACTE de la première activité : si
      // l'alignement bowling :00/:30 a décalé le départ du programme, ce
      // scénario ne correspond plus au choix du client et doit être écarté.
      if (requestedStartMinutes !== null && raw.start !== requestedStartMinutes) return;
      // Règle métier : le début du programme (première activité, quelle
      // qu'elle soit) tombe TOUJOURS sur :00/:30, jamais 15:15 ni 16:40.
      if (raw.start % PROGRAM_GRID_MINUTES !== 0) return;
      const decorated = decorateScenario({
        center,
        formula,
        pax,
        date,
        scenario: raw,
        reservations,
        laneStatuses,
        blocks: availabilityBlocks,
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

  const misalignedProgramStart = requestedStartMinutes !== null
    && requestedStartMinutes % PROGRAM_GRID_MINUTES !== 0;
  return {
    ok: Boolean(recommended && recommended.ok),
    reason: recommended
      ? ''
      : misalignedProgramStart
        ? 'Une formule démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30) : choisissez un autre départ.'
        : hasPreferredTimeFilter(preference)
          ? 'Aucune combinaison compatible avec les heures Bowling/Laser choisies.'
          : candidateResult.reason || 'Aucun scenario exploitable.',
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

// === Scenarios calcules : le client choisit un SCENARIO, jamais des heures ===
// Le concurrent fait choisir au client une heure PAR activite en ne retirant
// que les heures de debut deja prises : le client peut s'assembler un programme
// creux ou infaisable (mesure chez un de leurs clients : 3 x 30 min placees a
// 11h30, 12h30 et 13h30, une heure de battement facturee sans un mot). Ici,
// l'inverse : le moteur calcule les ENCHAINEMENTS realisables sur l'inventaire
// commun (capacites, remise en etat des ressources declarees, tampon de risque,
// transitions, horaires) et NE PROPOSE QUE des scenarios qui tiennent. Un
// scenario bloquant ne sort JAMAIS d'ici : c'est la regle produit.
//
// input.steps : la chaine (1 a N activites), chaque etape { activityId?, label?,
//   resourceType?, durationMinutes?, pax?, optional? }. resourceType peut etre
//   une ressource DECLAREE du centre (padel_court...) : c'est ce qui rend la
//   chaine planifiable sans une ligne de code.
// input.lockOrder : contrainte d'ordre (P3) : l'ordre donne est imperatif.
// preference.excludedOptionalActivityIds : etapes optionnelles retirees (P2).
function planScenarioChain(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const preference = input.preference || {};
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (!rawSteps.length) {
    return { ok: false, reason: 'Aucune activité dans le programme.', type: 'chain', centerId: center.id, date, pax, scenarios: [], checkedStarts: 0 };
  }

  const steps = rawSteps.map((step, index) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    return {
      activityId: step.activityId || null,
      label: step.label || activity?.name || `Activité ${index + 1}`,
      resourceType: step.resourceType || activity?.resourceType || 'service',
      count: 1,
      ...(step.durationMinutes ? { durationMinutes: Number(step.durationMinutes) } : {}),
      ...(step.pax ? { pax: Math.max(1, Number(step.pax)) } : {}),
      ...(step.optional === true ? { optional: true } : {}),
      critical: isCriticalResourceType(center, step.resourceType || activity?.resourceType || 'service'),
    };
  });

  // P3 : verrou d'ordre = paires consecutives sur les identifiants distincts
  // de la chaine. Une etape sans activityId est verrouillee par son
  // resourceType (la normalisation ci-dessus en garantit toujours un) : aucune
  // etape n'echappe au verrou en silence. generateOrders ecarte tout ordre qui
  // viole une paire.
  const lockKeys = [...new Set(steps.map((step) => step.activityId || step.resourceType))];
  const orderConstraints = input.lockOrder === true && lockKeys.length >= 2
    ? lockKeys.slice(0, -1).map((key, index) => [key, lockKeys[index + 1]])
    : undefined;

  const formulaDoc = {
    id: String(input.chainId || 'chain'),
    name: String(input.chainName || 'Programme'),
    minPax: 1,
    price: { type: 'per_pax', value: 0 },
    steps,
    ...(orderConstraints ? { orderConstraints } : {}),
  };

  // La grille des departs candidats : memes regles que les formules (grille
  // :00/:30, accueil 10 min apres l'ouverture, marge de fin de journee).
  const effectiveDoc = applyOptionalSelection(formulaDoc, preference);
  const estimated = estimateFormulaMinutes(center, effectiveDoc, pax, 0);
  const window = getScheduleWindow({
    center,
    date,
    estimatedMinutes: estimated,
    formula: null,
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  if (!window.ok) {
    return { ok: false, reason: window.reason, type: 'chain', centerId: center.id, date, pax, scenarios: [], checkedStarts: 0 };
  }

  const scenarios = [];
  let checkedStarts = 0;
  for (let startMinutes = ceilMinutes(window.minStart, PROGRAM_GRID_MINUTES); startMinutes <= window.maxStart; startMinutes += PROGRAM_GRID_MINUTES) {
    checkedStarts += 1;
    const result = planFormula({
      centerId: center.id,
      date,
      pax,
      formula: formulaDoc,
      startTime: minutesToTime(startMinutes),
      preference,
    }, context);
    // SEULE une combinaison qui tient sort : jamais de scenario bloquant.
    if (result.ok && result.recommended && result.recommended.ok) {
      scenarios.push(result.recommended);
    }
  }

  return {
    ok: scenarios.length > 0,
    reason: scenarios.length ? '' : 'Aucun enchaînement réalisable ce jour-là avec ce programme.',
    type: 'chain',
    centerId: center.id,
    date,
    pax,
    lockOrder: input.lockOrder === true,
    scenarios,
    checkedStarts,
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
  // Règle métier : les pistes ne partent qu'à :00 ou :30, y compris pour un
  // horaire demandé à la main (staff ou requête forgée).
  const starts = candidateResult.starts.filter((startMinutes) => startMinutes % BOWLING_GRID_MINUTES === 0);
  const misalignedRequest = candidateResult.starts.length > 0 && starts.length === 0;
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
    reason: sorted[0]
      ? ''
      : misalignedRequest
        ? 'Le bowling démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30).'
        : candidateResult.reason || 'Aucun créneau disponible.',
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
  }).totalMinutes;
}

function planLaser(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const games = inferLaserGames(input);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
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
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  const order = Array.from({ length: games }, (_, index) => ({
    activityId: 'laser_game',
    uid: `laser_game:${index + 1}`,
    countIndex: index + 1,
    critical: true,
  }));
  // Règle métier : les départs Laser générés pour le client tombent sur
  // :00/:30. Un horaire explicitement demandé (décalage staff, session
  // partagée interne) reste accepté tel quel.
  const laserStarts = input.startTime
    ? candidateResult.starts
    : candidateResult.starts.filter((startMinutes) => startMinutes % PROGRAM_GRID_MINUTES === 0);
  const scenarios = laserStarts.map((startMinutes) => {
    const raw = buildTimeline({
      center,
      formula: null,
      pax,
      startMinutes,
      order,
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
      blocks: availabilityBlocks,
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

// === Retards : moteur d'impact multi-réservations ===========================
// Demande métier (patron du centre) : quand un groupe est en retard, TOUT doit
// être géré d'un coup. Le moteur calcule la cascade sur les réservations
// suivantes AVANT toute application, cherche des alternatives dans l'ordre de
// préférence : (1) la résa retardée change de piste/lancement, personne
// d'autre ne bouge ; (2) les résas suivantes changent de piste en gardant leur
// heure ; (3) cascade du minimum nécessaire (un trou de planning absorbe une
// partie du retard). Le staff valide explicitement le plan, et AUCUNE
// notification client ne part sans confirmation explicite, client par client.

const DELAY_MIN_MINUTES = 1;
const DELAY_MAX_MINUTES = 240;
const DELAY_CASCADE_MAX_STEPS = 40;

const DELAY_RESOURCE_LABELS = {
  bowling_lane: 'Bowling',
  laser_arena: 'Laser Game',
  party_table: 'Table anniversaire',
};

function delayWindowKey(resourceType, start, end) {
  return [resourceType, Math.round(start), Math.round(end)].join(':');
}

function criticalBlocksFromReservation(reservation, center) {
  return inferBlocksFromReservation(reservation, center)
    .filter((block) => isCriticalResourceType(center, block.resourceType))
    .map((block) => {
      const start = Number.isFinite(Number(block.start)) ? Number(block.start) : timeToMinutes(block.startTime);
      const end = Number.isFinite(Number(block.end)) ? Number(block.end) : timeToMinutes(block.endTime);
      return {
        resourceType: block.resourceType,
        start,
        end,
        lanes: block.resourceType === 'bowling_lane' ? blockLanes(block) : [],
        players: Number(block.players || block.pax || reservation.pax || 0),
        countIndex: Number(block.countIndex || 1),
      };
    })
    .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end) && block.end > block.start)
    .sort((left, right) => left.start - right.start);
}

function groupDelayWindows(blocks) {
  const windows = new Map();
  blocks
    .filter((block) => block.resourceType !== 'party_table')
    .forEach((block) => {
      const key = delayWindowKey(block.resourceType, block.start, block.end);
      if (!windows.has(key)) {
        windows.set(key, {
          key,
          resourceType: block.resourceType,
          start: block.start,
          end: block.end,
          lanes: [],
          players: 0,
        });
      }
      const window = windows.get(key);
      window.lanes = [...new Set([...window.lanes, ...block.lanes])].sort((a, b) => a - b);
      window.players = Math.max(window.players, Number(block.players || 0));
    });
  return [...windows.values()].sort((left, right) => left.start - right.start);
}

// Décalage minimal intra-réservation : le bloc visé glisse du retard demandé,
// les blocs suivants ne glissent QUE si nécessaire (un trou absorbe le reste),
// les blocs précédents ne bougent jamais. Les enchaînements collés (vagues
// laser) restent collés, les transitions de 5 min sont préservées.
function planDelayWindowShifts(windows, { delayMinutes, fromStartMinute = null }) {
  let anchorIndex = 0;
  if (fromStartMinute !== null) {
    anchorIndex = windows.findIndex((window) => window.start >= fromStartMinute - 0.01);
    if (anchorIndex < 0) anchorIndex = Math.max(0, windows.length - 1);
  }
  windows.forEach((window, index) => {
    if (index < anchorIndex) {
      window.newStart = window.start;
      window.newEnd = window.end;
      return;
    }
    if (index === anchorIndex) {
      window.newStart = window.start + delayMinutes;
    } else {
      const previous = windows[index - 1];
      const requiredGap = Math.min(TRANSITION_MINUTES, Math.max(0, window.start - previous.end));
      window.newStart = Math.max(window.start, previous.newEnd + requiredGap);
    }
    window.newEnd = window.newStart + (window.end - window.start);
  });
  return windows;
}

function moveTimedItem(item, delta, endDelta = null) {
  const startRaw = Number.isFinite(Number(item.start)) ? Number(item.start) : timeToMinutes(item.startTime);
  const endRaw = Number.isFinite(Number(item.end)) ? Number(item.end) : timeToMinutes(item.endTime);
  const start = startRaw + delta;
  const end = endRaw + (endDelta === null ? delta : endDelta);
  return {
    ...item,
    start,
    end,
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    durationMinutes: Math.max(0, end - start),
  };
}

function itemStartMinute(item) {
  return Number.isFinite(Number(item.start)) ? Number(item.start) : timeToMinutes(item.startTime);
}

function itemEndMinute(item) {
  return Number.isFinite(Number(item.end)) ? Number(item.end) : timeToMinutes(item.endTime);
}

// Applique le décalage minimal à une réservation entière (opsPlan compris).
// Cas formule : la table suit l'arrivée (donc le premier bloc), les ancres
// aval glissent seulement si besoin, les activités libres couvrent la
// nouvelle fenêtre de visite.
function shiftReservationForDelay(reservation, center, { delayMinutes, fromStartMinute = null }) {
  const hasPlanBlocks = Array.isArray(reservation.opsPlan?.resourceBlocks) && reservation.opsPlan.resourceBlocks.length > 0;
  const basePlan = hasPlanBlocks ? reservation.opsPlan : buildDelayPlanFromReservation({ reservation }, center);
  if (!basePlan) return null;

  const criticalBlocks = criticalBlocksFromReservation(reservation, center);
  const windows = planDelayWindowShifts(groupDelayWindows(criticalBlocks), { delayMinutes, fromStartMinute });
  const firstDelta = windows.length ? windows[0].newStart - windows[0].start : delayMinutes;
  const lastNewEnd = windows.length ? Math.max(...windows.map((window) => window.newEnd)) : null;
  const deltaByKey = new Map(windows.map((window) => [window.key, window.newStart - window.start]));

  const deltaForCritical = (item) => {
    if (item.resourceType === 'party_table') return firstDelta;
    const start = itemStartMinute(item);
    const end = itemEndMinute(item);
    const exact = deltaByKey.get(delayWindowKey(item.resourceType, start, end));
    if (exact !== undefined) return exact;
    // Bloc hors fenêtres connues (ex. passes laser en crédit) : suivre la
    // fenêtre précédente la plus proche, sinon le début du programme.
    const preceding = [...windows].reverse().find((window) => window.start <= start + 0.01);
    return preceding ? preceding.newStart - preceding.start : firstDelta;
  };

  const moveCritical = (item) => {
    if (item.resourceType !== 'party_table') return moveTimedItem(item, deltaForCritical(item));
    const start = itemStartMinute(item) + firstDelta;
    const end = Math.max(itemEndMinute(item) + firstDelta, lastNewEnd === null ? -Infinity : lastNewEnd);
    return moveTimedItem(item, firstDelta, end - itemEndMinute(item));
  };

  const resourceBlocks = (basePlan.resourceBlocks || []).map((block) => (
    isCriticalResourceType(center, block.resourceType) ? moveCritical(block) : moveTimedItem(block, firstDelta)
  ));
  const timeline = (basePlan.timeline || []).map((step) => {
    if (isCriticalResourceType(center, step.resourceType)) return moveCritical(step);
    if (step.flexible && lastNewEnd !== null) {
      const end = Math.max(itemEndMinute(step) + firstDelta, lastNewEnd);
      return moveTimedItem(step, firstDelta, end - itemEndMinute(step));
    }
    return moveTimedItem(step, firstDelta);
  });

  const previousStartTime = reservation.startTime || basePlan.startTime || (windows.length ? minutesToTime(windows[0].start) : '');
  const newStartMinutes = timeToMinutes(previousStartTime) + firstDelta;
  const newStartTime = minutesToTime(newStartMinutes);
  const planEnd = resourceBlocks.length
    ? Math.max(...resourceBlocks.map((block) => itemEndMinute(block)))
    : timeToMinutes(basePlan.endTime || previousStartTime) + firstDelta;

  const shiftedPlan = {
    ...basePlan,
    start: newStartMinutes,
    end: planEnd,
    startTime: newStartTime,
    endTime: minutesToTime(planEnd),
    resourceBlocks,
    timeline,
    delayAdjustment: {
      delayMinutes,
      appliedShiftMinutes: firstDelta,
      previousStartTime,
    },
  };

  const shiftedBlocks = criticalBlocks.map((block) => {
    if (block.resourceType !== 'party_table') {
      const delta = deltaByKey.get(delayWindowKey(block.resourceType, block.start, block.end)) ?? firstDelta;
      return { ...block, start: block.start + delta, end: block.end + delta };
    }
    return {
      ...block,
      start: block.start + firstDelta,
      end: Math.max(block.end + firstDelta, lastNewEnd === null ? block.end + firstDelta : lastNewEnd),
    };
  });

  return {
    reservation,
    update: {
      id: Number(reservation.id),
      startTime: newStartTime,
      lanes: (reservation.lanes || []).map(Number).filter(Boolean),
      opsPlan: hasPlanBlocks ? shiftedPlan : reservation.opsPlan || null,
    },
    blocks: shiftedBlocks,
    windows,
    previousStartTime,
    newStartTime,
    shiftMinutes: firstDelta,
    endMinutes: shiftedBlocks.length ? Math.max(...shiftedBlocks.map((block) => block.end)) : planEnd,
  };
}

function pseudoReservationFromBlocks(reservationId, blocks, source = {}) {
  return {
    id: reservationId,
    pax: source.pax || 0,
    startTime: blocks.length ? minutesToTime(Math.min(...blocks.map((block) => block.start))) : source.startTime || '00:00',
    duration: 0,
    lanes: [],
    opsPlan: {
      resourceBlocks: blocks.map((block) => ({
        resourceType: block.resourceType,
        start: block.start,
        end: block.end,
        startTime: minutesToTime(block.start),
        endTime: minutesToTime(block.end),
        lanes: block.lanes || [],
        players: block.players || 0,
        countIndex: block.countIndex || 1,
      })),
    },
  };
}

// Détecte les collisions entre des blocs déplacés et le reste du planning.
// Renvoie, par réservation touchée, le décalage MINIMAL qui la libère.
function findDelayCollisions({ center, laneStatuses = {}, movedSets = [], others = [] }) {
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const parallelLaunches = center.resources.laser?.parallelLaunches || 1;
  const tableCapacity = center.resources.partyTables?.hardCapacity || 8;
  const maintenanceLanes = new Set(
    Object.entries(laneStatuses || {})
      .filter(([, status]) => status === 'maintenance')
      .map(([lane]) => Number(lane)),
  );

  const collisions = new Map();
  const maintenanceIssues = [];
  const hardConflicts = [];

  const otherEntries = others.map((reservation) => ({
    reservation,
    movable: true,
    blocks: criticalBlocksFromReservation(reservation, center),
  }));
  const movedEntries = movedSets.map((set) => ({
    reservation: set.reservation,
    movable: !set.immovable,
    blocks: set.blocks,
  }));

  const record = (entry, needed, fromStart, kind, message) => {
    if (needed <= 0.01) return;
    if (!entry.movable) {
      hardConflicts.push(message);
      return;
    }
    const id = Number(entry.reservation.id);
    const current = collisions.get(id) || {
      reservation: entry.reservation,
      neededShiftMinutes: 0,
      fromStartMinute: Infinity,
      kinds: new Set(),
      messages: [],
    };
    current.neededShiftMinutes = Math.max(current.neededShiftMinutes, Math.ceil(needed));
    current.fromStartMinute = Math.min(current.fromStartMinute, fromStart);
    current.kinds.add(kind);
    current.messages.push(message);
    collisions.set(id, current);
  };

  const compare = (movedEntry, targetEntry) => {
    movedEntry.blocks.forEach((moved) => {
      if (moved.resourceType === 'bowling_lane') {
        (moved.lanes || []).forEach((lane) => {
          if (maintenanceLanes.has(Number(lane))) {
            maintenanceIssues.push(`Piste ${lane} en maintenance sur ${minutesToTime(moved.start)}-${minutesToTime(moved.end)}.`);
          }
        });
      }
      targetEntry.blocks.forEach((existing) => {
        if (!overlap(moved.start, moved.end, existing.start, existing.end)) return;
        if (moved.resourceType === 'bowling_lane' && existing.resourceType === 'bowling_lane') {
          const sharedLanes = (moved.lanes || []).filter((lane) => (existing.lanes || []).map(Number).includes(Number(lane)));
          if (!sharedLanes.length) return;
          record(
            targetEntry,
            moved.end - existing.start,
            existing.start,
            'bowling',
            `Piste ${sharedLanes.join(', ')} occupée jusqu'à ${minutesToTime(moved.end)}.`,
          );
        }
        if (moved.resourceType === 'party_table' && existing.resourceType === 'party_table') {
          const allTables = [...movedEntries, ...otherEntries]
            .flatMap((entry) => entry.blocks)
            .filter((block) => block.resourceType === 'party_table' && overlap(moved.start, moved.end, block.start, block.end));
          if (allTables.length > tableCapacity) {
            record(
              targetEntry,
              moved.end - existing.start,
              existing.start,
              'table',
              `Capacité tables anniversaire dépassée sur ${minutesToTime(moved.start)}-${minutesToTime(moved.end)}.`,
            );
          }
        }
      });
      if (moved.resourceType === 'laser_arena') {
        const overlapping = targetEntry.blocks.filter((existing) =>
          existing.resourceType === 'laser_arena' && overlap(moved.start, moved.end, existing.start, existing.end));
        if (!overlapping.length) return;
        const allOverlapping = [...otherEntries, ...movedEntries]
          .filter((entry) => entry !== movedEntry)
          .flatMap((entry) => entry.blocks)
          .filter((existing) => existing.resourceType === 'laser_arena' && overlap(moved.start, moved.end, existing.start, existing.end));
        const sessionKeys = new Set(allOverlapping.map((block) => `${block.start}-${block.end}`));
        const joinsExisting = sessionKeys.has(`${moved.start}-${moved.end}`);
        const launchCount = sessionKeys.size + (joinsExisting ? 0 : 1);
        const players = allOverlapping.reduce((sum, block) => sum + Number(block.players || 0), Number(moved.players || 0));
        const capacityBroken = players > weaponCount;
        const launchesBroken = launchCount > parallelLaunches;
        if (!capacityBroken && !launchesBroken) return;
        overlapping.forEach((existing) => {
          const sameWindow = existing.start === moved.start && existing.end === moved.end;
          if (sameWindow && !capacityBroken) return;
          record(
            targetEntry,
            moved.end - existing.start,
            existing.start,
            'laser',
            `Lancement laser ${minutesToTime(existing.start)} en conflit avec l'arène occupée jusqu'à ${minutesToTime(moved.end)}.`,
          );
        });
      }
      const movedDeclared = getDeclaredResource(center, moved.resourceType);
      if (movedDeclared) {
        // Pool declare : meme verite que evaluateConflicts (pic de demande sur
        // fenetres etendues de la remise en etat). Si le pool sature, chaque
        // bloc aval en chevauchement recoit le decalage necessaire.
        const extEnd = moved.end + movedDeclared.cleanupMinutes;
        const overlapping = targetEntry.blocks.filter((existing) =>
          existing.resourceType === moved.resourceType
          && overlap(moved.start, extEnd, existing.start, existing.end + movedDeclared.cleanupMinutes));
        if (!overlapping.length) return;
        const allBlocks = [...otherEntries, ...movedEntries]
          .flatMap((entry) => entry.blocks)
          .filter((existing) => existing.resourceType === moved.resourceType);
        const peak = declaredPeakUnits(movedDeclared, declaredSessionsUnits(movedDeclared, allBlocks));
        if (peak <= movedDeclared.units) return;
        overlapping.forEach((existing) => {
          record(
            targetEntry,
            extEnd - existing.start,
            existing.start,
            'resource',
            `${movedDeclared.name} sature autour de ${minutesToTime(moved.start)} (remise en etat comprise).`,
          );
        });
      }
    });
  };

  movedEntries.forEach((movedEntry) => {
    otherEntries.forEach((targetEntry) => compare(movedEntry, targetEntry));
    movedEntries.forEach((targetEntry) => {
      if (targetEntry === movedEntry) return;
      // Entre deux ensembles déplacés, on ne décale que celui dont le bloc en
      // conflit démarre le plus tard (ordre chronologique préservé).
      compare(movedEntry, targetEntry);
    });
  });

  return {
    collisions: [...collisions.values()].sort((left, right) => left.fromStartMinute - right.fromStartMinute),
    maintenanceIssues: [...new Set(maintenanceIssues)],
    hardConflicts: [...new Set(hardConflicts)],
  };
}

function delayChangeSummary(change) {
  const parts = [];
  if (change.kind === 'relocate') {
    parts.push(`passe piste ${change.previousLanes.join(', ')} vers ${change.newLanes.join(', ')}, heure inchangée`);
  } else {
    (change.moves || []).forEach((move) => {
      parts.push(`${move.label} ${move.previousStartTime} vers ${move.newStartTime}`);
    });
    if (change.laneChanged) {
      parts.push(`passe piste ${change.previousLanes.join(', ')} vers ${change.newLanes.join(', ')}`);
    } else if (change.newLanes.length) {
      parts.push(`reste piste ${change.newLanes.join(', ')}`);
    }
  }
  if (change.laserNote) parts.push(change.laserNote);
  if (change.overClosingMinutes) parts.push(`dépasse la fermeture de ${change.overClosingMinutes} min`);
  return parts.join(' · ') || 'aucune incidence';
}

function buildDelayChange({ reservation, shiftResult, kind, closeMinutes, previousLanes = null, newLanes = null, laserNote = '' }) {
  const beforeLanes = (previousLanes || reservation.lanes || []).map(Number).filter(Boolean);
  const afterLanes = (newLanes || shiftResult?.update?.lanes || beforeLanes).map(Number).filter(Boolean);
  const moves = (shiftResult?.windows || [])
    .filter((window) => Math.round(window.newStart - window.start) > 0)
    .map((window) => ({
      label: DELAY_RESOURCE_LABELS[window.resourceType] || window.resourceType,
      previousStartTime: minutesToTime(window.start),
      newStartTime: minutesToTime(window.newStart),
      shiftMinutes: Math.round(window.newStart - window.start),
    }));
  const endMinutes = shiftResult ? shiftResult.endMinutes : null;
  const overClosingMinutes = closeMinutes !== null && endMinutes !== null && endMinutes > closeMinutes
    ? Math.round(endMinutes - closeMinutes)
    : 0;
  const change = {
    reservationId: Number(reservation.id),
    name: reservation.name || reservation.label || `Réservation ${reservation.id}`,
    email: String(reservation.email || '').trim(),
    phone: String(reservation.phone || '').trim(),
    hasEmail: Boolean(String(reservation.email || '').trim()),
    kind,
    previousStartTime: shiftResult ? shiftResult.previousStartTime : reservation.startTime,
    newStartTime: shiftResult ? shiftResult.newStartTime : reservation.startTime,
    shiftMinutes: shiftResult ? Math.round(shiftResult.shiftMinutes) : 0,
    previousLanes: beforeLanes,
    newLanes: afterLanes,
    laneChanged: beforeLanes.join(',') !== afterLanes.join(','),
    moves,
    laserNote,
    overClosingMinutes,
    update: shiftResult
      ? { ...shiftResult.update, lanes: afterLanes }
      : { id: Number(reservation.id), startTime: reservation.startTime, lanes: afterLanes, opsPlan: reservation.opsPlan || null },
  };
  change.summary = delayChangeSummary(change);
  return change;
}

function applyLanesToShiftedPlan(shiftResult, laneMappings) {
  // laneMappings : [{ start, end, fromLanes, toLanes }] sur les fenêtres décalées.
  const remapBlockLanes = (block) => {
    if (block.resourceType !== 'bowling_lane') return block;
    const start = itemStartMinute(block);
    const mapping = laneMappings.find((item) => Math.abs(item.start - start) < 0.01);
    if (!mapping) return block;
    return { ...block, lanes: mapping.toLanes, lane: undefined };
  };
  const plan = shiftResult.update.opsPlan;
  const nextPlan = plan && Array.isArray(plan.resourceBlocks)
    ? {
      ...plan,
      resourceBlocks: plan.resourceBlocks.map(remapBlockLanes),
      timeline: Array.isArray(plan.timeline) ? plan.timeline.map(remapBlockLanes) : plan.timeline,
      assignedLanes: [...new Set(laneMappings.flatMap((item) => item.toLanes))].sort((a, b) => a - b),
    }
    : plan;
  const blocks = shiftResult.blocks.map(remapBlockLanes);
  const lanes = [...new Set(blocks.filter((block) => block.resourceType === 'bowling_lane').flatMap((block) => block.lanes || []))]
    .map(Number)
    .sort((a, b) => a - b);
  return {
    ...shiftResult,
    blocks,
    update: { ...shiftResult.update, lanes, opsPlan: nextPlan },
  };
}

// Stratégie 1 : la réservation RETARDÉE change de piste (ou rejoint un autre
// lancement laser) au nouvel horaire : personne d'autre n'est touché.
function tryRelocateDelayedStrategy({ center, laneStatuses, delayed, delayedShift, others, closeMinutes }) {
  const base = {
    id: 'relocate_delayed',
    label: 'Changer la réservation retardée de piste',
    description: 'Le groupe retardé glisse sur une autre piste ou un autre lancement : aucune autre réservation ne bouge.',
  };
  let working = {
    ...delayedShift,
    blocks: delayedShift.blocks.map((block) => ({ ...block })),
  };
  const laneMappings = [];
  let laserNote = '';
  const weaponCount = center.resources.laser?.weaponCount || 30;

  const initial = findDelayCollisions({
    center,
    laneStatuses,
    movedSets: [{ reservation: delayed, blocks: working.blocks, immovable: true }],
    others,
  });
  const conflictKinds = new Set(initial.collisions.flatMap((collision) => [...collision.kinds]));

  if (conflictKinds.has('bowling') || initial.maintenanceIssues.length) {
    const bowlingWindows = groupDelayWindows(working.blocks).filter((window) => window.resourceType === 'bowling_lane');
    for (const window of bowlingWindows) {
      const requiredCount = Math.max(1, window.lanes.length);
      const allocated = allocateLanes(center, laneStatuses, others, window.start, window.end, requiredCount);
      if (!allocated) {
        return { ...base, feasible: false, reasonIfNot: 'Aucune piste libre équivalente au nouvel horaire.', changes: [], warnings: [] };
      }
      laneMappings.push({ start: window.start, end: window.end, fromLanes: window.lanes, toLanes: allocated.map(Number) });
    }
    working.blocks = working.blocks.map((block) => {
      if (block.resourceType !== 'bowling_lane') return block;
      const mapping = laneMappings.find((item) => Math.abs(item.start - block.start) < 0.01);
      return mapping ? { ...block, lanes: mapping.toLanes } : block;
    });
  }

  const laserAdjustments = [];
  if (conflictKinds.has('laser')) {
    const otherLaserBlocks = others
      .flatMap((reservation) => criticalBlocksFromReservation(reservation, center))
      .filter((block) => block.resourceType === 'laser_arena');
    working.blocks = working.blocks.map((block) => {
      if (block.resourceType !== 'laser_arena') return block;
      const overlapping = otherLaserBlocks.filter((existing) => overlap(block.start, block.end, existing.start, existing.end));
      if (!overlapping.length) return block;
      // Un groupe en retard ne peut rejoindre qu'un lancement qui démarre à
      // partir de son heure décalée : jamais un lancement déjà parti.
      const candidates = otherLaserBlocks.filter((existing) => existing.start >= block.start - 0.01);
      const joinable = findJoinableLaserSession(
        { start: block.start, end: block.end, players: block.players },
        candidates,
        weaponCount,
      );
      if (!joinable) return block;
      laserAdjustments.push({ oldStart: block.start, oldEnd: block.end, newStart: joinable.start, newEnd: joinable.end });
      laserNote = `rejoint le lancement laser de ${minutesToTime(joinable.start)}`;
      return { ...block, start: joinable.start, end: joinable.end };
    });
  }

  if (conflictKinds.has('table')) {
    return { ...base, feasible: false, reasonIfNot: 'Capacité tables dépassée : pas de relocation possible.', changes: [], warnings: [] };
  }

  const verify = findDelayCollisions({
    center,
    laneStatuses,
    movedSets: [{ reservation: delayed, blocks: working.blocks, immovable: true }],
    others,
  });
  if (verify.collisions.length || verify.maintenanceIssues.length || verify.hardConflicts.length) {
    return { ...base, feasible: false, reasonIfNot: 'Aucune combinaison piste/lancement libre pour le groupe retardé.', changes: [], warnings: [] };
  }

  let result = laneMappings.length ? applyLanesToShiftedPlan(working, laneMappings) : working;
  if (laserAdjustments.length) {
    // Répercute les lancements rejoints dans le plan (blocs + timeline) et
    // dans les fenêtres, pour un résumé staff cohérent (« 15:00 vers 15:30 »).
    const remapLaser = (item) => {
      if (item.resourceType !== 'laser_arena') return item;
      const adjustment = laserAdjustments.find((entry) => Math.abs(entry.oldStart - itemStartMinute(item)) < 0.01);
      if (!adjustment) return item;
      return {
        ...item,
        start: adjustment.newStart,
        end: adjustment.newEnd,
        startTime: minutesToTime(adjustment.newStart),
        endTime: minutesToTime(adjustment.newEnd),
        durationMinutes: adjustment.newEnd - adjustment.newStart,
      };
    };
    const plan = result.update.opsPlan;
    const newStartMinutes = Math.min(...result.blocks.map((block) => block.start));
    const newEndMinutes = Math.max(...result.blocks.map((block) => block.end));
    const nextPlan = plan && Array.isArray(plan.resourceBlocks)
      ? {
        ...plan,
        startTime: minutesToTime(newStartMinutes),
        endTime: minutesToTime(newEndMinutes),
        resourceBlocks: plan.resourceBlocks.map(remapLaser),
        timeline: Array.isArray(plan.timeline) ? plan.timeline.map(remapLaser) : plan.timeline,
      }
      : plan;
    result = {
      ...result,
      windows: (result.windows || []).map((window) => {
        const adjustment = laserAdjustments.find((entry) => Math.abs(entry.oldStart - window.newStart) < 0.01);
        return adjustment ? { ...window, newStart: adjustment.newStart, newEnd: adjustment.newEnd } : window;
      }),
      newStartTime: minutesToTime(newStartMinutes),
      endMinutes: newEndMinutes,
      update: { ...result.update, startTime: minutesToTime(newStartMinutes), opsPlan: nextPlan },
    };
  }
  const change = buildDelayChange({
    reservation: delayed,
    shiftResult: result,
    kind: 'delayed',
    closeMinutes,
    previousLanes: delayed.lanes || [],
    newLanes: result.update.lanes,
    laserNote,
  });
  const warnings = change.overClosingMinutes
    ? [`La réservation retardée dépasse la fermeture de ${change.overClosingMinutes} min.`]
    : [];
  return { ...base, feasible: true, reasonIfNot: '', changes: [change], warnings };
}

// Stratégie 2 : les réservations SUIVANTES gardent leur heure mais changent de
// piste (acceptable côté client). Possible uniquement pour des conflits piste.
function tryRelocateDownstreamStrategy({ center, laneStatuses, delayed, delayedShift, others, collisions, closeMinutes }) {
  const base = {
    id: 'relocate_downstream',
    label: 'Déplacer les réservations suivantes de piste',
    description: 'Les réservations suivantes gardent leur heure et changent seulement de piste ; le groupe retardé garde sa piste.',
  };
  if (collisions.some((collision) => [...collision.kinds].some((kind) => kind !== 'bowling'))) {
    return { ...base, feasible: false, reasonIfNot: 'Conflit laser ou table : un changement de piste ne suffit pas.', changes: [], warnings: [] };
  }

  const movedPseudo = [pseudoReservationFromBlocks(Number(delayed.id), delayedShift.blocks, delayed)];
  const changes = [];

  for (const collision of collisions) {
    const reservation = collision.reservation;
    const blocks = criticalBlocksFromReservation(reservation, center).map((block) => ({ ...block }));
    const othersForAllocation = [
      ...others.filter((item) => Number(item.id) !== Number(reservation.id)),
      ...movedPseudo,
    ];
    const laneMappings = [];
    const windows = groupDelayWindows(blocks).filter((window) => window.resourceType === 'bowling_lane');
    for (const window of windows) {
      const conflictsHere = delayedShift.blocks.some((moved) =>
        moved.resourceType === 'bowling_lane'
        && overlap(moved.start, moved.end, window.start, window.end)
        && (moved.lanes || []).some((lane) => window.lanes.map(Number).includes(Number(lane))));
      if (!conflictsHere) continue;
      const allocated = allocateLanes(center, laneStatuses, othersForAllocation, window.start, window.end, Math.max(1, window.lanes.length));
      if (!allocated) {
        return { ...base, feasible: false, reasonIfNot: 'Pas assez de pistes libres pour re-router les réservations suivantes.', changes: [], warnings: [] };
      }
      laneMappings.push({ start: window.start, end: window.end, fromLanes: window.lanes, toLanes: allocated.map(Number) });
    }
    if (!laneMappings.length) {
      return { ...base, feasible: false, reasonIfNot: 'Conflit sans fenêtre piste identifiable.', changes: [], warnings: [] };
    }

    const newBlocks = blocks.map((block) => {
      if (block.resourceType !== 'bowling_lane') return block;
      const mapping = laneMappings.find((item) => Math.abs(item.start - block.start) < 0.01);
      return mapping ? { ...block, lanes: mapping.toLanes } : block;
    });
    const newLanes = [...new Set(newBlocks.filter((block) => block.resourceType === 'bowling_lane').flatMap((block) => block.lanes || []))]
      .map(Number)
      .sort((a, b) => a - b);
    const nextPlan = reservation.opsPlan && Array.isArray(reservation.opsPlan.resourceBlocks)
      ? {
        ...reservation.opsPlan,
        resourceBlocks: reservation.opsPlan.resourceBlocks.map((block) => {
          if (block.resourceType !== 'bowling_lane') return block;
          const mapping = laneMappings.find((item) => Math.abs(item.start - itemStartMinute(block)) < 0.01);
          return mapping ? { ...block, lanes: mapping.toLanes, lane: undefined } : block;
        }),
        assignedLanes: newLanes,
      }
      : reservation.opsPlan || null;

    movedPseudo.push(pseudoReservationFromBlocks(Number(reservation.id), newBlocks, reservation));
    const change = buildDelayChange({
      reservation,
      shiftResult: null,
      kind: 'relocate',
      closeMinutes,
      previousLanes: reservation.lanes || [],
      newLanes,
    });
    change.update = { id: Number(reservation.id), startTime: reservation.startTime, lanes: newLanes, opsPlan: nextPlan };
    change.laneChanged = true;
    change.summary = delayChangeSummary(change);
    changes.push(change);
  }

  const untouched = others.filter((item) => !changes.some((change) => change.reservationId === Number(item.id)));
  const verify = findDelayCollisions({
    center,
    laneStatuses,
    movedSets: [
      { reservation: delayed, blocks: delayedShift.blocks, immovable: true },
      ...changes.map((change) => ({
        reservation: { id: change.reservationId },
        blocks: (change.update.opsPlan?.resourceBlocks || []).map((block) => ({
          resourceType: block.resourceType,
          start: itemStartMinute(block),
          end: itemEndMinute(block),
          lanes: (block.lanes || []).map(Number),
          players: Number(block.players || 0),
        })).filter((block) => isCriticalResourceType(center, block.resourceType)),
        immovable: false,
      })),
    ],
    others: untouched,
  });
  if (verify.collisions.length || verify.hardConflicts.length) {
    return { ...base, feasible: false, reasonIfNot: 'La relocation des réservations suivantes crée un nouveau conflit.', changes: [], warnings: [] };
  }

  const delayedChange = buildDelayChange({ reservation: delayed, shiftResult: delayedShift, kind: 'delayed', closeMinutes });
  const warnings = delayedChange.overClosingMinutes
    ? [`La réservation retardée dépasse la fermeture de ${delayedChange.overClosingMinutes} min.`]
    : [];
  return { ...base, feasible: true, reasonIfNot: '', changes: [delayedChange, ...changes], warnings };
}

// Stratégie 3 : cascade minimale, chaque réservation aval est décalée du
// strict nécessaire (un trou de planning absorbe une partie du retard).
function tryCascadeStrategy({ center, laneStatuses, delayed, delayedShift, others, closeMinutes }) {
  const base = {
    id: 'cascade',
    label: 'Décaler les réservations suivantes',
    description: 'Chaque réservation aval est décalée du minimum nécessaire, dans l\'ordre du planning.',
  };
  const movedById = new Map();
  movedById.set(Number(delayed.id), {
    reservation: delayed,
    current: delayed,
    shiftResult: delayedShift,
    immovable: true,
  });
  let remaining = others.map((item) => item);

  for (let step = 0; step < DELAY_CASCADE_MAX_STEPS; step += 1) {
    const movedSets = [...movedById.values()].map((entry) => ({
      reservation: entry.current,
      blocks: entry.shiftResult.blocks,
      immovable: entry.immovable,
    }));
    const { collisions, hardConflicts } = findDelayCollisions({
      center,
      laneStatuses,
      movedSets,
      others: remaining,
    });
    if (hardConflicts.length) {
      return { ...base, feasible: false, reasonIfNot: hardConflicts[0], changes: [], warnings: [] };
    }
    if (!collisions.length) {
      const changes = [
        buildDelayChange({ reservation: delayed, shiftResult: delayedShift, kind: 'delayed', closeMinutes }),
        ...[...movedById.values()]
          .filter((entry) => !entry.immovable)
          .map((entry) => {
            const combined = {
              ...entry.shiftResult,
              previousStartTime: entry.reservation.startTime,
              shiftMinutes: timeToMinutes(entry.shiftResult.newStartTime) - timeToMinutes(entry.reservation.startTime),
              windows: entry.totalWindows || entry.shiftResult.windows,
            };
            return buildDelayChange({ reservation: entry.reservation, shiftResult: combined, kind: 'shift', closeMinutes });
          }),
      ];
      const overClosing = changes.filter((change) => change.overClosingMinutes > 0);
      const warnings = overClosing.map((change) =>
        `${change.name} dépasse la fermeture de ${change.overClosingMinutes} min (fin ${minutesToTime(closeMinutes + change.overClosingMinutes)}).`);
      return { ...base, feasible: true, reasonIfNot: '', changes, warnings };
    }

    const target = collisions[0];
    const targetId = Number(target.reservation.id);
    const existing = movedById.get(targetId);
    const sourceReservation = existing ? existing.current : remaining.find((item) => Number(item.id) === targetId);
    if (!sourceReservation) {
      return { ...base, feasible: false, reasonIfNot: 'Cascade impossible à résoudre.', changes: [], warnings: [] };
    }
    const shiftResult = shiftReservationForDelay(sourceReservation, center, {
      delayMinutes: target.neededShiftMinutes,
      fromStartMinute: target.fromStartMinute,
    });
    if (!shiftResult) {
      return { ...base, feasible: false, reasonIfNot: 'Réservation aval sans plan exploitable.', changes: [], warnings: [] };
    }
    const original = existing ? existing.reservation : sourceReservation;
    const totalWindows = existing
      ? mergeCascadeWindows(existing.totalWindows || existing.shiftResult.windows, shiftResult.windows)
      : shiftResult.windows;
    movedById.set(targetId, {
      reservation: original,
      current: {
        ...sourceReservation,
        startTime: shiftResult.newStartTime,
        lanes: shiftResult.update.lanes,
        opsPlan: shiftResult.update.opsPlan || sourceReservation.opsPlan,
      },
      shiftResult,
      totalWindows,
      immovable: false,
    });
    remaining = remaining.filter((item) => Number(item.id) !== targetId);
  }

  return { ...base, feasible: false, reasonIfNot: 'Cascade trop profonde : arbitrage manuel requis.', changes: [], warnings: [] };
}

// Cumule les fenêtres d'une réservation re-décalée plusieurs fois dans la
// cascade : l'origine reste la fenêtre initiale, la destination la dernière.
function mergeCascadeWindows(previousWindows = [], nextWindows = []) {
  return nextWindows.map((next, index) => {
    const previous = previousWindows[index];
    if (!previous || previous.resourceType !== next.resourceType) return next;
    return { ...next, start: previous.start, end: previous.end };
  });
}

function detectSharedLaserNotes(delayed, others, center) {
  const notes = [];
  const delayedLaser = criticalBlocksFromReservation(delayed, center).filter((block) => block.resourceType === 'laser_arena');
  if (!delayedLaser.length) return notes;
  const otherLaser = others.flatMap((reservation) => criticalBlocksFromReservation(reservation, center))
    .filter((block) => block.resourceType === 'laser_arena');
  delayedLaser.forEach((block) => {
    const shared = otherLaser.some((existing) => existing.start === block.start && existing.end === block.end);
    if (shared) {
      notes.push(`Le lancement laser de ${minutesToTime(block.start)} est partagé : les autres groupes du lancement restent à l'heure prévue.`);
    }
  });
  return [...new Set(notes)];
}

// Point d'entrée : calcule le plan d'impact complet d'un retard, AVANT toute
// application. Renvoie les stratégies ordonnées par préférence métier.
function computeDelayImpact(input, context = {}) {
  const knowledge = loadOpsKnowledge();
  const center = getCenter(input.centerId || 'libramont');
  const reasonDoc = knowledge.rules.delayReasons.find((item) => item.id === input.reasonId) || null;
  const delayMinutes = clamp(
    Math.round(Number(input.delayMinutes || reasonDoc?.defaultMinutes || 10)),
    DELAY_MIN_MINUTES,
    DELAY_MAX_MINUTES,
  );

  const allReservations = (Array.isArray(context.reservations) ? context.reservations : [])
    .filter((reservation) => reservation && reservation.status !== 'cancelled');
  const reservationId = Number(input.reservationId || input.reservation?.id || 0);
  const delayed = input.reservation
    || allReservations.find((reservation) => Number(reservation.id) === reservationId);
  if (!delayed) throw new Error('Réservation introuvable pour analyser le retard.');
  const others = allReservations.filter((reservation) => Number(reservation.id) !== Number(delayed.id));
  const laneStatuses = context.laneStatuses || {};
  const date = input.date || delayed.date;
  const schedule = date ? getSchedule(date, center) : null;
  const closeMinutes = schedule ? Math.round(schedule.close * 60) : null;

  const delayedShift = shiftReservationForDelay(delayed, center, { delayMinutes });
  if (!delayedShift) throw new Error('Plan introuvable pour cette réservation.');

  const sharedLaserNotes = detectSharedLaserNotes(delayed, others, center);
  const baseline = findDelayCollisions({
    center,
    laneStatuses,
    movedSets: [{ reservation: delayed, blocks: delayedShift.blocks, immovable: true }],
    others,
  });

  const strategies = [];
  if (!baseline.collisions.length && !baseline.maintenanceIssues.length) {
    const change = buildDelayChange({ reservation: delayed, shiftResult: delayedShift, kind: 'delayed', closeMinutes });
    strategies.push({
      id: 'shift',
      label: 'Décaler la réservation',
      description: 'Le nouveau créneau est libre : aucune autre réservation n\'est impactée.',
      feasible: true,
      reasonIfNot: '',
      changes: [change],
      warnings: change.overClosingMinutes
        ? [`${change.name} dépasse la fermeture de ${change.overClosingMinutes} min.`]
        : [],
    });
  } else {
    strategies.push(tryRelocateDelayedStrategy({ center, laneStatuses, delayed, delayedShift, others, closeMinutes }));
    strategies.push(tryRelocateDownstreamStrategy({
      center,
      laneStatuses,
      delayed,
      delayedShift,
      others,
      collisions: baseline.collisions,
      closeMinutes,
    }));
    strategies.push(tryCascadeStrategy({ center, laneStatuses, delayed, delayedShift, others, closeMinutes }));
  }

  strategies.forEach((strategy) => {
    strategy.impactedCount = Math.max(0, (strategy.changes || []).length - 1);
    if (sharedLaserNotes.length) strategy.warnings = [...(strategy.warnings || []), ...sharedLaserNotes];
  });
  const recommended = strategies.find((strategy) => strategy.feasible) || null;

  return {
    ok: Boolean(recommended),
    status: !baseline.collisions.length && !baseline.maintenanceIssues.length ? 'no_conflict' : 'conflicts',
    delayMinutes,
    reasonId: input.reasonId || '',
    reason: reasonDoc?.label || 'Retard signalé',
    reservationId: Number(delayed.id),
    reservationName: delayed.name || delayed.label || `Réservation ${delayed.id}`,
    date,
    centerId: center.id,
    previousStartTime: delayedShift.previousStartTime,
    proposedStartTime: delayedShift.newStartTime,
    closingTime: closeMinutes !== null ? minutesToTime(closeMinutes) : null,
    downstreamConflicts: baseline.collisions.map((collision) => ({
      reservationId: Number(collision.reservation.id),
      name: collision.reservation.name || `Réservation ${collision.reservation.id}`,
      neededShiftMinutes: collision.neededShiftMinutes,
      kinds: [...collision.kinds],
    })),
    strategies,
    recommendedStrategyId: recommended ? recommended.id : '',
    confirmation: {
      required: true,
      label: 'Le staff valide le plan avant toute application. Rien ne bouge tout seul.',
    },
    notifications: {
      automatic: false,
      requiresExplicitConfirmation: true,
      candidates: recommended
        ? recommended.changes.map((change) => ({
          reservationId: change.reservationId,
          name: change.name,
          email: change.email,
          hasEmail: change.hasEmail,
          summary: change.summary,
        }))
        : [],
    },
    warnings: [...sharedLaserNotes, ...baseline.maintenanceIssues],
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
  // Les seules activites A CRENEAU (bowling, laser). Exposee pour que les
  // surfaces publiques ne redefinissent pas la liste en dur : le moteur reste
  // la source unique de ce qui est "vendable a l'heure".
  ANCHOR_ACTIVITY_IDS,
  BOWLING_GRID_MINUTES,
  PROGRAM_GRID_MINUTES,
  FORMULA_ARRIVAL_MINUTES,
  allocateLanes,
  evaluateConflicts,
  analyzeDelay,
  buildDefaultAnchorTimes,
  computeDelayImpact,
  shiftReservationForDelay,
  buildLearningSuggestions,
  evaluateAnchoredCombination,
  getFormulaAnchorAvailability,
  getFormulaAnchorModel,
  getRequiredLaneCount,
  isCriticalResourceType,
  listDeclaredResources,
  minutesToTime,
  planLaser,
  planReservation,
  planScenarioChain,
  suggestAnchorCombinations,
  timeToMinutes,
};
