const {
  LASER_GAME_ARENA_MINUTES,
  currentTimeDecimal,
  formuleMinPaxDetail,
  getSchedule,
  getBowlingGameOptions,
  isFormulaBlockedDate,
  isOfferEnabled,
  splitGroupIntoBowlingServices,
  todayStr,
} = require('./booking-config');
const { allocateBowlingCapacity } = require('./bowling-allocation');
const { getActivity, getCenter, getFormula, loadOpsKnowledge } = require('./ops-knowledge');
const { modeValidationFormule } = require('./validation-policy');
const { isActivityBlockedAt, isLaneBlockedAt } = require('./availability-blocks');
const {
  getDeclaredResource,
  listDeclaredResources,
  requiredUnitsFor,
} = require('./declared-resources');
const {
  effectiveMaxVisitMinutes,
  formulaVisitOf,
  freeStepHasTime,
  freeStepMinutes,
} = require('./formula-visit');
const { choixDuDossier, formuleAvecChoix, formuleDuDossier, varianteDemandee } = require('./formula-choice');

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
// PROGRAMME (= début de la première activité, bowling, laser, minigolf…).
const PROGRAM_GRID_MINUTES = 30;
// Les pistes de bowling restent en plus alignées :00/:30 même au milieu d'un
// programme (contrainte d'exploitation des pistes).
const BOWLING_GRID_MINUTES = PROGRAM_GRID_MINUTES;
// Les LANCEMENTS LASER aussi : un depart vit sur la grille :00/:30. Les
// « heures fines » (laser pose apres bowling + transition, vagues bout a
// bout a :25, retard decale de +7 min exactement) donnaient des sessions a
// 12:12 ou 13:45 : illisibles au planning (rangees de 30 min), impossibles
// a rejoindre (la cle de session est exacte) et fausses dans le compte
// d armes par tranche (2026-08-25, captures Movsar). Le retard, la
// transition et l enchainement des vagues se posent sur le PROCHAIN depart.
const LASER_LAUNCH_GRID_MINUTES = PROGRAM_GRID_MINUTES;

function snapLaserLaunch(minute) {
  return ceilMinutes(minute, LASER_LAUNCH_GRID_MINUTES);
}

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
  const bowling = options.bowlingConfig || center.resources.bowling;
  if (!bowling) return 0;
  const players = Math.max(1, Number(pax) || 1);
  if (options.allowEmergencySeventh && players <= bowling.emergencyCapacityPerLane) return 1;
  const normal = Math.ceil(players / bowling.normalCapacityPerLane);
  if (normal > bowling.laneCount && players <= bowling.laneCount * bowling.emergencyCapacityPerLane) {
    return bowling.laneCount;
  }
  return normal;
}

// La maintenance retire une piste de la dotation du service pour toute la
// journee. Les reservations et blocages horaires restent des indisponibilites
// de CRENEAU : ils ne doivent jamais changer la taille des sous-groupes.
// On garde le laneCount physique sur `center` pour que l'allocation continue
// d'enumerer les vrais identifiants (ex. 5-8 quand 1-4 sont en maintenance).
function getOperationalBowlingConfig(center, laneStatuses = {}) {
  const bowling = center.resources.bowling;
  if (!bowling) return null;
  let operationalLaneCount = 0;
  for (let lane = 1; lane <= Number(bowling.laneCount || 0); lane += 1) {
    const status = laneStatuses[String(lane)] ?? laneStatuses[lane];
    if (status !== 'maintenance') operationalLaneCount += 1;
  }
  if (operationalLaneCount <= 0) return null;
  return { ...bowling, laneCount: operationalLaneCount };
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
        ...(Array.isArray(step.participantsPerGame) ? { pax: step.participantsPerGame[index] } : {}),
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
function buildTimeline({ center, formula, pax, startMinutes, order, pauseMinutes = 0, preferredLanes = [], bowlingConfig = null }) {
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
    // UN SERVICE DE BOWLING EST UN BLOC, exactement comme une vague de laser.
    const waveSizes = resourceType === 'laser_arena'
      ? splitGroupIntoWaves(stepPax, center.resources.laser?.weaponCount || pax)
      : resourceType === 'bowling_lane'
        ? splitGroupIntoBowlingServices(stepPax, bowlingConfig || center.resources.bowling || null)
        : [stepPax];

    waveSizes.forEach((wavePlayers, waveIndex) => {
      // Lancement laser : sur la grille des departs, jamais a l heure fine.
      if (resourceType === 'laser_arena') cursor = snapLaserLaunch(cursor);
      const duration = getActivityDurationMinutes(step, activity, state);
      const start = cursor;
      const end = cursor + duration;
      const timelineStep = {
        type: step.activityId ? 'activity' : 'service',
        activityId: step.activityId || null,
        label: waveSizes.length > 1 && (resourceType === 'laser_arena' || resourceType === 'bowling_lane')
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
        // LES PISTES DE CE SERVICE-LA, pas celles du groupe entier : les deux
        // moities d un groupe scinde ne sont jamais sur les pistes en meme
        // temps. Un groupe qui tient en une fois rend exactement la meme
        // valeur qu avant, `wavePlayers` valant alors `stepPax`.
        timelineStep.requiredLanes = getRequiredLaneCount(center, wavePlayers, { bowlingConfig: bowlingConfig || center.resources.bowling || null });
        timelineStep.players = wavePlayers;
        if (step.games) timelineStep.games = step.games;
        if (waveSizes.length > 1) {
          timelineStep.groupPlayers = stepPax;
          timelineStep.groupWaveIndex = waveIndex + 1;
          timelineStep.groupWaveCount = waveSizes.length;
        }
        // Souhait de piste transmis au calcul des conflits (jamais une demande
        // ferme) : une formule que le staff deplace sur les pistes 5-6 garde ces
        // pistes dans SON plan, donc sur le planning.
        if (preferredLanes.length) timelineStep.preferredLanes = [...preferredLanes];
      }
      if (resourceType === 'laser_arena') {
        timelineStep.players = wavePlayers;
        timelineStep.groupPlayers = stepPax;
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

// LES PISTES QU'ON DEMANDE PASSENT AVANT CELLES QU'ON DEVINE (2026-08-20).
// Movsar : « je l ai mis piste 5 et mis en 1h30 mais ça veut juste pas ».
// Le moteur n'a JAMAIS lu les pistes demandees : il allouait toujours les
// premieres libres. La ligne de la reservation gardait le choix du staff (piste
// 5), le PLAN ecrivait autre chose (piste 1), et le planning - qui se dessine
// depuis le plan - ne bougeait pas d'un pixel. Deux ecrans, deux verites.
//
// Rendu : la liste demandee si elle tient sur CETTE fenetre, sinon null pour
// laisser l'allocation automatique faire son travail. Un choix irrealisable ne
// bloque donc rien : il est simplement remplace, et l'appelant le dit.
function preferredLanesFor(center, laneStatuses, reservations, block, availabilityBlocks = [], dateISO = '', preferred = []) {
  const wanted = [...new Set((Array.isArray(preferred) ? preferred : []).map(Number).filter((lane) => Number.isInteger(lane) && lane > 0))];
  if (!wanted.length) return null;
  const check = validateRequestedLanes(center, laneStatuses, reservations, { ...block, lanes: wanted }, availabilityBlocks, dateISO);
  return check && check.ok ? check.lanes : null;
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
  const bowlingAllocationByBlock = new Map();
  const existingBlocks = reservations.flatMap((reservation) => inferBlocksFromReservation(reservation, center));

  scenario.resourceBlocks.forEach((block, index) => {
    if (block.resourceType === 'bowling_lane') {
      // Activite 'bowling' bloquee sur la fenetre du bloc (scope 'activity') :
      // conflit bloquant, la piste ne peut pas etre attribuee. Sans blocage : rien.
      const bowlingActivityBlocked = isActivityBlockedAt(availabilityBlocks, dateISO, 'bowling', block.start, block.end);
      const requestedLaneCheck = validateRequestedLanes(center, laneStatuses, reservations, block, availabilityBlocks, dateISO);
      // `preferredLanes` : le choix du staff, porte par le bloc mais NON
      // contraignant. Il passe avant l'allocation automatique quand il tient sur
      // la fenetre, et s'efface sans refus quand il ne tient pas (a la
      // difference de `lanes`, qui est une demande ferme et devient un conflit).
      const preferred = bowlingActivityBlocked || requestedLaneCheck
        ? null
        : preferredLanesFor(center, laneStatuses, reservations, block, availabilityBlocks, dateISO, block.preferredLanes);
      let lanes = bowlingActivityBlocked
        ? null
        : requestedLaneCheck
          ? (requestedLaneCheck.ok ? requestedLaneCheck.lanes : null)
          : preferred
            || allocateLanes(center, laneStatuses, reservations, block.start, block.end, block.requiredLanes || 1, availabilityBlocks, dateISO);
      if (!bowlingActivityBlocked && (!requestedLaneCheck || requestedLaneCheck.ok)) {
        const allocation = allocateBowlingCapacity({ players: Number(block.players) || 1, config: center.resources.bowling,
          requiredLanes: block.requiredLanes, durationMinutes: block.end - block.start, games: block.games,
          fixedLanes: requestedLaneCheck?.ok ? requestedLaneCheck.lanes : null,
          allocate: (count) => preferred && preferred.length >= count ? preferred
            : allocateLanes(center, laneStatuses, reservations, block.start, block.end, count, availabilityBlocks, dateISO) });
        lanes = allocation?.lanes || null;
        if (allocation) bowlingAllocationByBlock.set(index, allocation);
      }
      if (!lanes) {
        if (bowlingActivityBlocked) {
          conflicts.push({
            type: 'bowling_conflict',
            severity: 'blocking',
            message: `Bowling indisponible (blocage) à ${minutesToTime(block.start)}.`,
          });
        } else {
          const occupied = requestedLaneCheck?.occupied?.length
            ? ` ${requestedLaneCheck.occupied.length > 1 ? 'Pistes déjà occupées' : 'Piste déjà occupée'} : ${requestedLaneCheck.occupied.join(', ')}.`
            : '';
          const maintenance = requestedLaneCheck?.maintenance?.length
            ? ` ${requestedLaneCheck.maintenance.length > 1 ? 'Pistes' : 'Piste'} en maintenance : ${requestedLaneCheck.maintenance.join(', ')}.`
            : '';
          const voulues = block.requiredLanes || 1;
          conflicts.push({
            type: 'bowling_conflict',
            severity: 'blocking',
            message: `Pas assez de pistes libres à ${minutesToTime(block.start)} : il en faut ${voulues}.${occupied}${maintenance}`,
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
          message: `Laser Game indisponible (blocage) à ${minutesToTime(block.start)}.`,
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
      // LE REFUS DIT CE QUI RESTE (2026-10-12) : « Laser charge a 16:30: 38/30
      // joueurs et 1/1 lancement(s). » ne disait ni combien de places il
      // restait, ni quoi faire (l ancienne fenetre : « il reste 4 places.
      // Décalez le départ. »).
      if (launchCount > parallelLaunches || players > weaponCount) {
        const heureLaser = minutesToTime(block.start);
        const reste = Math.max(0, weaponCount - Number(block.playersBefore || 0));
        const groupe = Number(block.players || 0);
        const places = reste > 0 ? `il reste ${reste} place${reste > 1 ? 's' : ''} sur ${weaponCount}` : `plus aucune place sur ${weaponCount}`;
        conflicts.push({
          type: 'laser_conflict',
          severity: 'blocking',
          message: players > weaponCount
            ? `Laser à ${heureLaser} : ${places}, il en faut ${groupe}. Décalez le départ.`
            : `Arène laser déjà prise à ${heureLaser} par une autre partie. Décalez le départ.`,
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

  return { conflicts, assignedLanesByBlock, bowlingAllocationByBlock };
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
      message: `${label} indisponible (blocage) à ${minutesToTime(start)}.`,
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
        players: Number(block.players || block.pax || pax || 0),
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
  warnings.push(...[...new Set(blocks.map((block) => block.emergencyWarning).filter(Boolean))]);
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

  // Une visite composee a partir de l arrivee du client (2026-10-13) commence a
  // son heure, accueil compris : la phrase dit son heure, puis la premiere
  // activite a heure fixe, jamais « presentez-vous dix minutes avant » une
  // heure qu il a choisie lui-meme.
  const premiereAncre = scenario.arrivalPlan && Array.isArray(scenario.arrivalPlan.frise)
    ? scenario.arrivalPlan.frise.find((segment) => segment.kind === 'anchor' && segment.startTime)
    : null;
  if (scenario.arrivalPlan && scenario.arrivalPlan.arrivalTime) {
    customerCommitment.unshift(premiereAncre
      ? `Vous arrivez à ${scenario.arrivalPlan.arrivalTime} : ${FORMULA_ARRIVAL_MINUTES} minutes d'accueil, puis ${premiereAncre.label} à ${premiereAncre.startTime}.`
      : `Vous arrivez à ${scenario.arrivalPlan.arrivalTime} : ${FORMULA_ARRIVAL_MINUTES} minutes d'accueil, puis la visite.`);
  } else if (Number.isFinite(scenario.arrivalStart)) {
    // A L OUVERTURE, A L HEURE PILE (2026-10-13) : quand la premiere activite
    // ouvre la journee, le groupe se presente a son heure.
    const avance = scenario.start - scenario.arrivalStart;
    customerCommitment.unshift(avance > 0
      ? `Votre première activité démarre à ${minutesToTime(scenario.start)} : présentez-vous ${avance} minutes avant pour l'accueil (${minutesToTime(scenario.arrivalStart)}).`
      : `Votre première activité démarre à ${minutesToTime(scenario.start)}, à l'ouverture : présentez-vous à ${minutesToTime(scenario.start)}.`);
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
    ...(conflictResult.bowlingAllocationByBlock.get(index) || {}),
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
      ...(step.resourceType === 'bowling_lane' ? (blocks.find((block) => block.resourceType === 'bowling_lane' && block.start === step.start && block.end === step.end) || {}) : {}),
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
    // LA VARIANTE JOUEE (lib/formula-choice) : la garde de la base, la
    // modification, la console et le deplacement d une activite refont la
    // formule du dossier avec elle. Sans variante, aucune cle de plus.
    ...(formula && formula.formulaChoice ? { formulaChoice: formula.formulaChoice } : {}),
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
    requestedPlayers: Math.max(...laserBlocks.map((block) => Number(block.groupPlayers || block.players || requestedPlayers || 0))),
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

  // Le minimum qui s applique : celui de la formule, ou celui du laser quand
  // elle lance sa propre partie (formuleMinPaxDetail).
  const minimum = formuleMinPaxDetail(formula, center && center.id);
  if (pax < minimum.minPax) {
    return {
      ok: false,
      reason: minimum.parLeLaser
        ? `Minimum ${minimum.minPax} personnes pour ${formula.name} : le laser game se joue à ${minimum.minPax} minimum.`
        : `Minimum ${minimum.minPax} personnes pour ${formula.name}.`,
    };
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
      return { ok: false, reason: `${formula.name} commence à partir de ${formula.timeLimit.min}.` };
    }
    if (max !== null && startMinutes + totalMinutes > max) {
      return { ok: false, reason: `${formula.name} doit terminer avant ${formula.timeLimit.max}.` };
    }
  }

  return { ok: true };
}

// LE PLANCHER DU JOUR MEME : rien ne commence avant maintenant + le delai de
// preparation (sameDayLeadMinutes), recale sur la grille des departs. Une
// seule definition : la fenetre des departs ci-dessous et le retrait des
// heures posees devenues passees (api/public-availability) la lisent.
// null quand la date n est pas aujourd hui.
function plancherDuJour(date) {
  if (date !== todayStr()) return null;
  const { rules } = loadOpsKnowledge();
  const step = rules.scenarioGeneration.slotStepMinutes;
  const leadMinutes = Number(rules.scenarioGeneration.sameDayLeadMinutes || 15);
  return ceilMinutes(currentTimeDecimal() * 60 + leadMinutes, step);
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
  let minStart = Math.round(schedule.open * 60);
  // L accueil (preMinutes) est un CONSEIL, jamais une interdiction : le
  // composeur d ancres demarre a l OUVERTURE (anchorStart), pendant que
  // minStart garde l accueil pour les scenarios guides. Sans cette
  // distinction, un centre qui ouvre a 12:00 n offrait rien avant 12:30
  // des que la visite portait deux activites (2026-08-25, capture Movsar,
  // doctrine : le moteur conseille, il n interdit pas un choix realisable).
  let anchorStart = ceilMinutes(minStart, step);
  if (preMinutes > 0) {
    minStart = ceilMinutes(minStart + preMinutes, step);
  }
  let maxStart = Math.round(schedule.close * 60) - estimatedMinutes;

  if (date === today) {
    const sameDayFloor = plancherDuJour(date);
    minStart = Math.max(minStart, sameDayFloor);
    anchorStart = Math.max(anchorStart, sameDayFloor);
  }

  if (formula?.timeLimit) {
    if (formula.timeLimit.min) {
      minStart = Math.max(minStart, timeToMinutes(formula.timeLimit.min));
      anchorStart = Math.max(anchorStart, timeToMinutes(formula.timeLimit.min));
    }
    if (formula.timeLimit.max) maxStart = Math.min(maxStart, timeToMinutes(formula.timeLimit.max) - estimatedMinutes);
  }

  // L ACCUEIL NE FERME PAS LA JOURNEE. minStart porte les 10 minutes
  // d accueil, anchorStart non (le commentaire plus haut le dit : l accueil
  // est un CONSEIL, jamais une interdiction). Comparer a minStart refusait
  // une visite qui tient PILE dans la journee des que ces 10 minutes ne
  // rentraient plus : mesure du 2026-08-31, bowling 10:00 + laser 23:30 un
  // samedi 10:00-24:00 repondait "aucun depart possible" alors que la visite
  // finit a 23:55. Le composeur, lui, proposait bien cette heure : le client
  // decouvrait l impossible apres avoir clique.
  if (maxStart < Math.min(minStart, anchorStart)) {
    return {
      ok: false,
      reason: 'Aucun départ possible dans les horaires disponibles avec cette durée.',
    };
  }

  return {
    ok: true,
    minStart,
    anchorStart,
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
      return { starts: [], reason: `${formula.name} doit commencer après ${formula.timeLimit.min}.` };
    }
    if (formula.timeLimit.max && requested + estimatedMinutes > timeToMinutes(formula.timeLimit.max)) {
      return { starts: [], reason: `${formula.name} doit terminer avant ${formula.timeLimit.max}.` };
    }
  }
  return { starts: [requested], reason: '' };
}

function estimateFormulaMinutes(center, formula, pax, pauseMinutes, bowlingConfig = null) {
  const order = expandFormulaSteps(formula);
  return buildTimeline({
    center,
    formula,
    pax,
    startMinutes: 0,
    order,
    pauseMinutes,
    bowlingConfig,
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
// Borne de forme sur la liste d'heures par partie : un panier plus long est
// forcement forge (la grille laser s'arrete a 3 parties).
const MAX_LASER_GAMES_PER_RESERVATION = 12;

// « 2 h 30 », « 45 min » : sert les avis de confort rendus au client.
function formatGapLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

// FORMULE « FENETRE OUVERTE » (orderPolicy: 'open_window' : MATIN MALIN, KIDS
// FUN DAY). Tout y est illimite dans une periode (avant 12:00, de 12:00 a
// 17:00) : rien n est une ancre, le client ne choisit que son heure d arrivee
// et la visite dure jusqu a la fin de la periode. Brief Movsar 2026-09-02 (P1).
// Mesure du 2026-09-03 : MATIN MALIN affichait une grille de laser dont 27
// heures sur 28 etaient impossibles (« doit terminer avant 12:00 ») et KIDS FUN
// DAY ne rendait aucun creneau, parce que le moteur additionnait les etapes
// (arcades 90 min + 2 lasers...) comme un programme a enchainer.
function isOpenWindowFormula(formula) {
  return Boolean(formula) && String(formula.orderPolicy || '') === 'open_window';
}

// `options.freeDurationPolicy` : la duree retenue pour une activite libre a
// duree ouverte (minigolf, golf), reglee par le centre (lib/formula-visit).
// Absente, la duree d avant.
function getFormulaAnchorModel(formula, options = {}) {
  const steps = expandFormulaSteps(formula);
  if (isOpenWindowFormula(formula)) {
    // Aucune ancre : toutes les activites se prennent a volonte dans la
    // periode, les parties de laser se placent sur place avec l equipe.
    return {
      anchors: [],
      freeSteps: steps.filter((step) => stepResourceType(step) !== 'party_table'),
      tableStep: steps.find((step) => stepResourceType(step) === 'party_table') || null,
      freeMinutes: 0,
      openWindow: true,
    };
  }
  const anchors = [];
  ANCHOR_ACTIVITY_IDS.forEach((activityId) => {
    const matching = steps.filter((step) => step.activityId === activityId);
    if (!matching.length) return;
    anchors.push({
      activityId,
      label: getActivity(activityId)?.name || activityId,
      count: matching.length,
      ...(matching[0].pax != null ? { pax: Number(matching[0].pax) } : {}),
      ...(matching[0].participantsPerGame ? { participantsPerGame: matching[0].participantsPerGame, baseGames: matching[0].baseGames } : {}),
      ...(activityId === 'bowling' && matching[0].games ? { games: matching[0].games } : {}),
      durationMinutes: activityId === 'laser_game'
        ? LASER_GAME_ARENA_MINUTES
        : Number(matching[0].durationMinutes || 60),
    });
  });
  const freeSteps = steps.filter((step) => !ANCHOR_ACTIVITY_IDS.includes(step.activityId)
    && stepResourceType(step) !== 'party_table');
  const tableStep = steps.find((step) => stepResourceType(step) === 'party_table') || null;
  // La duree du libre se lit a UN endroit (lib/formula-visit, freeStepMinutes),
  // ici et dans le pass liberte de composeAnchoredFormulaScenario.
  const freeMinutes = freeSteps.reduce((sum, step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    return sum + freeStepMinutes(step, activity?.durationModel, options.freeDurationPolicy);
  }, 0);
  return { anchors, freeSteps, tableStep, freeMinutes };
}

// CHAQUE PARTIE DE LASER A SON HEURE (2026-08-20, demande de Movsar : « ils
// peuvent placer toutes leurs parties de laser a l heure qu ils veulent, ou
// juste une, ou juste deux »).
// `laserGameTimes` est une liste PAR PARTIE, dans l'ordre des parties :
// une heure = cette partie est posee au planning ; une case vide = elle se
// place sur place avec l'equipe. Absente, la liste retombe sur l'ancre unique
// `preferredTimes.laser_game` : le comportement d'avant, a l'identique.
function normalizeLaserGameTimes(preference = {}, preferred = {}) {
  const raw = Array.isArray(preference.laserGameTimes) ? preference.laserGameTimes : null;
  if (!raw) {
    return preferred.laser_game ? [timeToMinutes(preferred.laser_game)] : [];
  }
  return raw.slice(0, MAX_LASER_GAMES_PER_RESERVATION).map((value) => {
    const text = String(value || '').slice(0, 5);
    return /^\d{1,2}:\d{2}$/.test(text) ? timeToMinutes(text) : null;
  });
}

function normalizeAnchorPreference(preference = {}) {
  const preferred = normalizePreferredTimes(preference);
  const anchorTimes = {};
  ANCHOR_ACTIVITY_IDS.forEach((activityId) => {
    if (preferred[activityId]) anchorTimes[activityId] = timeToMinutes(preferred[activityId]);
  });
  const laserGameTimes = normalizeLaserGameTimes(preference, preferred);
  // L'ancre laser reste la PREMIERE partie posee : tout ce qui lit
  // `anchorTimes.laser_game` (disponibilite, suggestions, mails) continue de
  // lire une heure juste, sans rien savoir des parties suivantes.
  const firstPlaced = laserGameTimes.find((minutes) => Number.isFinite(minutes));
  if (Number.isFinite(firstPlaced)) anchorTimes.laser_game = firstPlaced;
  else if (laserGameTimes.length) delete anchorTimes.laser_game;
  return {
    anchorTimes,
    laserGameTimes,
    laserPlacement: preference.laserPlacement === 'onsite' ? 'onsite' : 'scheduled',
    // L heure d arcade choisie (2026-10-13), en minutes : avec une heure
    // d arrivee (poserArrivee) comme sans (modele A, la composition la pose).
    arcadeStart: heureDArcade(preference.arcadeTime),
  };
}

// HH:MM sur un pas de 5 minutes (les arcades se posent aussi a la fin d une
// activite, 11:25 apres un laser), sinon null.
function heureDArcade(valeur) {
  const lue = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(valeur === null || valeur === undefined ? '' : valeur).trim());
  if (!lue) return null;
  const minutes = Number(lue[1]) * 60 + Number(lue[2]);
  return minutes % 5 === 0 ? minutes : null;
}

function isAnchoredFormulaRequest(formula, preference = {}) {
  if (!getFormulaAnchorModel(formula).anchors.length) return false;
  const { anchorTimes, laserPlacement } = normalizeAnchorPreference(preference);
  return Object.keys(anchorTimes).length > 0 || laserPlacement === 'onsite';
}

// CE QUI EST POSE, ET CE QUI RESTE A POSER, partie par partie.
// `partTimes[i]` = heure de la partie i+1 (minutes) ou null (sur place). Le
// staff lit ce plan pour savoir ce qui attend dans « Parties a placer » : il
// doit donc dire QUELLES parties, pas seulement combien.
function buildAnchorLaserPassPlan({ laserAnchor, laserOnSite, partTimes = [] }) {
  if (!laserAnchor) return null;
  const totalGames = Math.max(1, Number(laserAnchor.count || 1));
  const placed = laserOnSite
    ? []
    : partTimes
      .map((minutes, index) => ({ countIndex: index + 1, minutes }))
      .filter((part) => Number.isFinite(part.minutes));
  const pending = Array.from({ length: totalGames }, (_, index) => index + 1)
    .filter((countIndex) => !placed.some((part) => part.countIndex === countIndex));
  // Tout est pose : il n'y a plus de pass a suivre, et un plan vide vaut mieux
  // qu'un plan qui annonce zero partie en attente.
  if (!pending.length) return null;
  return {
    mode: placed.length ? 'manual_after_first' : 'all_on_site',
    totalGames,
    scheduledGames: placed.length,
    remainingGames: pending.length,
    scheduledPasses: placed.map((part) => ({
      countIndex: part.countIndex,
      status: 'scheduled',
      startTime: minutesToTime(part.minutes),
    })),
    pendingPasses: pending.map((countIndex) => ({ countIndex, status: 'pending', ...(laserAnchor.participantsPerGame ? { pax: laserAnchor.participantsPerGame[countIndex - 1] } : {}) })),
  };
}

// Compose la visite à partir des heures d'ancre choisies. Aucune activité
// libre n'y reçoit d'horaire propre : elles couvrent la fenêtre de visite
// entière (flexible: true) et le client ne voit jamais d'heure pour elles.
// `arrivalStart` (minutes, 2026-10-12) : la visite commence a l heure d arrivee
// du client, avant ses ancres ; la frise range les activites libres dans
// l attente et donne leur heure aux arcades (poserArrivee). Absent, la
// composition est celle d avant.
function composeAnchoredFormulaScenario({ center, formula, pax, anchorTimes = {}, laserPlacement = 'scheduled', preferredLanes = [], laserGameTimes = [], bowlingConfig = null, arrivalStart: arriveeDemandee = null, arcadeStart = null }) {
  const reglageVisite = formulaVisitOf(center);
  const model = getFormulaAnchorModel(formula, { freeDurationPolicy: reglageVisite.freeDurationPolicy });
  if (!model.anchors.length) {
    return { ok: false, code: 'no_anchor', reason: 'Cette formule ne comporte aucune activité à créneau : choisissez simplement votre heure d’arrivée.' };
  }

  const bowlingAnchor = model.anchors.find((anchor) => anchor.activityId === 'bowling') || null;
  const laserAnchor = model.anchors.find((anchor) => anchor.activityId === 'laser_game') || null;
  const bowlingPax = Number(bowlingAnchor?.pax ?? pax);
  const laserPax = Number(laserAnchor?.pax ?? pax);
  // UNE HEURE PAR PARTIE. `laserPartTimes[i]` = heure de la partie i+1, ou null
  // si le client la laisse a placer sur place. Sans liste, la 1re partie prend
  // l'ancre et les suivantes se placent sur place : le comportement historique.
  const totalLaserGames = laserAnchor ? Math.max(1, Number(laserAnchor.count || 1)) : 0;
  const laserPartTimes = Array.from({ length: totalLaserGames }, (_, index) => {
    if (laserAnchor?.baseGames && index >= laserAnchor.baseGames) return null;
    if (laserGameTimes.length) return Number.isFinite(laserGameTimes[index]) ? laserGameTimes[index] : null;
    return index === 0 && Number.isFinite(anchorTimes.laser_game) ? anchorTimes.laser_game : null;
  });
  const placedLaserParts = laserPartTimes.filter((minutes) => Number.isFinite(minutes)).length;
  // « Je place mes parties laser sur place » : possible uniquement si une
  // autre ancre (bowling) fixe l'arrivée : il faut au moins UNE ancre pour
  // ancrer l'accueil et la table. Tout laisser en « sur place » revient au
  // meme, et se lit donc comme tel.
  const laserOnSite = Boolean(laserAnchor) && Boolean(bowlingAnchor)
    && (laserPlacement === 'onsite' || (totalLaserGames > 0 && placedLaserParts === 0));

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
  // Chaque partie POSEE tombe sur la meme grille que les autres ancres : une
  // partie a 16:15 se refuse comme un bowling a 16:15, et elle dit laquelle.
  if (!laserOnSite) {
    const offGrid = laserPartTimes.findIndex((minutes) => Number.isFinite(minutes) && minutes % PROGRAM_GRID_MINUTES !== 0);
    if (offGrid >= 0) {
      return {
        ok: false,
        code: 'off_grid',
        reason: `${laserAnchor.label}${totalLaserGames > 1 ? ` (partie ${offGrid + 1})` : ''} démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30).`,
      };
    }
  }

  const anchorBlocks = [];
  const anchorWindows = [];
  if (bowlingAnchor) {
    const start = anchorTimes.bowling;
    // UN SERVICE = UN BLOC, l un apres l autre, comme les vagues de l arene.
    // Un groupe qui tient sur les pistes rend UN service : ce bloc est alors
    // identique a celui d avant, champ pour champ.
    const services = splitGroupIntoBowlingServices(bowlingPax, bowlingConfig || center.resources.bowling || null);
    let serviceCursor = start;
    services.forEach((servicePlayers, serviceIndex) => {
      const debut = serviceCursor;
      const fin = debut + bowlingAnchor.durationMinutes;
      anchorBlocks.push({
        type: 'activity',
        activityId: 'bowling',
        label: services.length > 1 ? `Bowling - groupe ${serviceIndex + 1}/${services.length}` : 'Bowling',
        resourceType: 'bowling_lane',
        countIndex: 1,
        critical: true,
        start: debut,
        end: fin,
        startTime: minutesToTime(debut),
        endTime: minutesToTime(fin),
        durationMinutes: bowlingAnchor.durationMinutes,
        ...(bowlingAnchor.games ? { games: bowlingAnchor.games } : {}),
        // LES PISTES DE CE SERVICE-LA : les deux moities d un groupe scinde ne
        // sont jamais sur les pistes en meme temps.
        requiredLanes: getRequiredLaneCount(center, servicePlayers, { bowlingConfig: bowlingConfig || center.resources.bowling || null }),
        // Souhait de piste (jamais un refus s'il ne tient pas) : voir
        // preferredLanesFor. Sans lui, deplacer une formule sur d'autres pistes
        // laissait sa carte sur les pistes d'origine.
        ...(preferredLanes.length ? { preferredLanes: [...preferredLanes] } : {}),
        players: servicePlayers,
        ...(services.length > 1
          ? { groupPlayers: bowlingPax, groupWaveIndex: serviceIndex + 1, groupWaveCount: services.length }
          : {}),
      });
      serviceCursor = fin;
    });
    // UNE SEULE FENETRE, DU PREMIER SERVICE AU DERNIER : le controle de
    // chevauchement doit voir toute la place que le bowling prend, sinon le
    // laser se poserait pendant le second service.
    anchorWindows.push({ activityId: 'bowling', label: 'Bowling', start, end: serviceCursor });
  }
  // UNE PARTIE POSEE = UN BLOC (et ses vagues si le groupe depasse les armes).
  // Les parties laissees vides ne posent rien : elles se placent sur place, et
  // le pass laser plus bas les compte comme telles.
  if (laserAnchor && !laserOnSite) {
    const weaponCount = center.resources.laser?.weaponCount || pax;
    laserPartTimes.forEach((partStart, partIndex) => {
      if (!Number.isFinite(partStart)) return;
      const partPax = Number(laserAnchor.participantsPerGame?.[partIndex] ?? laserPax);
      const waveSizes = splitGroupIntoWaves(partPax, weaponCount);
      const countIndex = partIndex + 1;
      let waveCursor = partStart;
      let lastWaveEnd = partStart;
      waveSizes.forEach((wavePlayers, waveIndex) => {
        const end = waveCursor + LASER_GAME_ARENA_MINUTES;
        anchorBlocks.push({
          type: 'activity',
          activityId: 'laser_game',
          label: waveSizes.length > 1 ? `Laser Game - groupe ${waveIndex + 1}/${waveSizes.length}` : 'Laser Game',
          resourceType: 'laser_arena',
          countIndex,
          critical: true,
          start: waveCursor,
          end,
          startTime: minutesToTime(waveCursor),
          endTime: minutesToTime(end),
          durationMinutes: LASER_GAME_ARENA_MINUTES,
          players: wavePlayers,
          groupPlayers: partPax,
          groupWaveIndex: waveIndex + 1,
          groupWaveCount: waveSizes.length,
          weaponNeed: Math.min(wavePlayers, weaponCount),
        });
        lastWaveEnd = end;
        // Vague suivante au prochain DEPART (:00/:30), plus bout a bout a :25.
        waveCursor = snapLaserLaunch(end);
      });
      // Une fenetre PAR PARTIE : le controle de chevauchement qui suit
      // s'applique donc aussi entre deux parties de laser, pas seulement entre
      // le bowling et le laser. Deux parties collees se refusent comme le reste.
      anchorWindows.push({
        activityId: 'laser_game',
        label: totalLaserGames > 1 ? `Laser Game (partie ${countIndex})` : 'Laser Game',
        start: partStart,
        end: lastWaveEnd,
      });
    });
  }

  // LES PARTIES QUI RESTENT JOUENT DANS LA FOULEE (Movsar, 2026-09-29, capture
  // d une visite annoncee « jusqu a 14:00 » avec deux parties de laser « sur
  // place » : « les 2 parties de laser ca dure 40 minutes minimum »). Le plan
  // ne leur pose pas d heure (l equipe les place, « Parties a placer »), mais
  // la visite les contient : elles s enchainent apres la derniere partie
  // posee, chaque vague au prochain depart de l arene, comme les parties
  // posees ; quand cette suite tombe sur une autre activite du groupe, apres
  // la derniere activite posee. Leur temps compte dans la fin de la visite ; il
  // ne ferme jamais une heure (evaluateAnchoredCombination).
  let partiesALaSuite = null;
  const partiesRestantes = laserAnchor ? totalLaserGames - (laserOnSite ? 0 : placedLaserParts) : 0;
  if (partiesRestantes > 0 && anchorWindows.length) {
    const vagues = laserPartTimes.reduce((total, time, index) => total + (!Number.isFinite(time) ? splitGroupIntoWaves(Number(laserAnchor.participantsPerGame?.[index] ?? laserPax), center.resources.laser?.weaponCount || pax).length : 0), 0);
    const enchainer = (depuis) => {
      let curseur = depuis;
      let debut = null;
      for (let k = 0; k < vagues; k += 1) {
        const depart = snapLaserLaunch(curseur);
        if (debut === null) debut = depart;
        curseur = depart + LASER_GAME_ARENA_MINUTES;
      }
      return { depuis, start: debut, end: curseur };
    };
    const finsLaser = anchorWindows.filter((w) => w.activityId === 'laser_game').map((w) => w.end);
    let suite = finsLaser.length ? enchainer(Math.max(...finsLaser)) : null;
    if (!suite || anchorWindows.some((w) => w.activityId !== 'laser_game' && overlap(suite.start, suite.end, w.start, w.end))) {
      suite = enchainer(Math.max(...anchorWindows.map((w) => w.end)));
    }
    partiesALaSuite = { parties: partiesRestantes, start: suite.start, end: suite.end, minutes: suite.end - suite.depuis };
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
    // Un debut A L HEURE PILE ou l autre finit est un enchainement, pas un
    // chevauchement. La marge TRANSITION_MINUTES ici, croisee a la grille de
    // 30 min, refusait « laser 15:30 apres un bowling qui finit 15:30 » et
    // imposait 30 minutes d attente (Movsar, 2026-08-24). Le client decide,
    // le moteur ne refuse que l irrealisable : deux activites en meme temps.
    if (current.start < previous.end) {
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
        // Les bornes du trou : une visite en retire ce qui s y joue
        // (avisSansLeLibre).
        gapStartTime: minutesToTime(previous.end),
        gapEndTime: minutesToTime(current.start),
        // L'heure la plus proche qui collerait les deux activités : c'est ce
        // que le client peut appliquer en un geste s'il préfère enchaîner.
        // L heure COLLEE : « enchainer » veut dire zero attente. L ancienne
        // marge de 5 min, arrondie a la grille, offrait 30 minutes d attente
        // a quelqu un qui venait d en demander zero.
        tightenTime: minutesToTime(ceilMinutes(previous.end, PROGRAM_GRID_MINUTES)),
        message: `${formatGapLabel(gap)} d'attente entre ${previous.label} et ${current.label}.`,
      });
    }
  }

  // LES ARCADES A L HEURE DU CLIENT, SANS HEURE D ARRIVEE (modele A, Movsar,
  // 2026-10-13 : « oui ok pour la A », l heure d arcade « Facultatif »). Le
  // client ne pose plus son arrivee : il pose ses activites, et ses arcades
  // quand il veut les faire a une heure precise. Elles se posent a cette
  // heure, jamais sur une activite a heure fixe ; quand elles passent en
  // premier, la visite commence avec elles (c est ainsi qu un groupe vient
  // plus tot). Les parties de laser a la suite passent apres elles, comme avec
  // une arrivee. Sans heure, rien ne change : elles restent le pass de la visite.
  let arcadeFixee = null;
  const sansArrivee = arriveeDemandee === null || arriveeDemandee === undefined;
  if (sansArrivee && arcadeStart !== null && arcadeStart !== undefined && Number.isFinite(Number(arcadeStart))) {
    const arcade = fenetreDesArcades(center, model, Number(arcadeStart));
    if (arcade) {
      const heurtee = orderedWindows.find((window) => overlap(arcade.start, arcade.end, window.start, window.end));
      if (heurtee) {
        return {
          ok: false,
          code: 'arcade_overlap',
          reason: `${arcade.label} (${minutesToTime(arcade.start)}-${minutesToTime(arcade.end)}) et ${heurtee.label} (${minutesToTime(heurtee.start)}) se chevauchent : décalez l’une des deux heures.`,
          conflict: { activityId: heurtee.activityId, label: heurtee.label, time: minutesToTime(heurtee.start) },
        };
      }
      arcadeFixee = arcade;
      if (partiesALaSuite && overlap(arcade.start, arcade.end, partiesALaSuite.start, partiesALaSuite.end)) {
        const duree = partiesALaSuite.end - partiesALaSuite.start;
        let depart = snapLaserLaunch(arcade.end);
        let ancre = anchorWindows.find((window) => overlap(depart, depart + duree, window.start, window.end));
        while (ancre) {
          depart = snapLaserLaunch(Math.max(ancre.end, depart + 1));
          ancre = anchorWindows.find((window) => overlap(depart, depart + duree, window.start, window.end));
        }
        partiesALaSuite = { ...partiesALaSuite, start: depart, end: depart + duree };
      }
    }
  }

  const firstStart = Math.min(...anchorBlocks.map((block) => block.start), ...(arcadeFixee ? [arcadeFixee.start] : []));
  const lastEnd = Math.max(...anchorBlocks.map((block) => block.end), ...(arcadeFixee ? [arcadeFixee.end] : []));
  const arrivalStart = firstStart - FORMULA_ARRIVAL_MINUTES;
  // Durée de visite indicative pour le staff : ancres planifiées + pass
  // liberté + transitions.
  const scheduledAnchorMinutes = anchorWindows.reduce((sum, window) => sum + (window.end - window.start), 0);
  // Les transitions se comptent ENTRE les etapes, jamais apres la derniere
  // (meme regle que le planificateur lineaire : hasNextActivity). Compter une
  // transition PAR etape padait la visite de 5 minutes au-dela de sa vraie
  // fin : un bowling seul a 23:00, un jour ferme a minuit, finissait « 00:05 »
  // et la validation le refusait, alors que la regle du 2026-08-31 veut
  // qu une activite qui finit PILE a la fermeture passe. Depuis le 2026-09-03
  // la grille des heures et la validation partagent ce calcul : il doit dire
  // la vraie fin.
  const sequentialSteps = anchorWindows.length + model.freeSteps.length;
  const sequentialMinutes = scheduledAnchorMinutes
    + model.freeMinutes
    + Math.max(0, sequentialSteps - 1) * TRANSITION_MINUTES;
  let visitEnd = Math.max(lastEnd, firstStart + sequentialMinutes);
  // LE LIBRE D UNE FORMULE SE JOUE D UN BLOC AUSSI (2026-10-14, Movsar : « FIN
  // estimé a 17h et le mini golf se joue quand du coup ? »). La somme des
  // etapes supposait le minigolf coupe dans les attentes : la Formule 4 a
  // laser 14:00 et 15:00 puis bowling 16:00 finissait a 17:10, minigolf
  // compris, alors qu il ne tient dans aucune des deux attentes de 35 min.
  // Une activite libre ne prend qu un trou qui la contient tout entiere
  // (rangerLesLibres, la regle de la visite par heure d arrivee) ; ce qui ne
  // tient nulle part se joue apres la derniere activite a heure. La somme
  // reste un plancher : une visite sans trou garde sa fin.
  const libresDuPass = model.freeSteps
    .filter((step) => !(arcadeFixee && step === arcadeFixee.etape))
    .map((step) => {
      const activity = step.activityId ? getActivity(step.activityId) : null;
      return { activityId: step.activityId || null, label: activity?.name || step.label || 'Service', minutes: freeStepMinutes(step, activity?.durationModel, reglageVisite.freeDurationPolicy) };
    });
  const plagesAHeure = [
    ...anchorWindows.map((window) => ({ kind: 'anchor', activityId: window.activityId, label: window.label, start: window.start, end: window.end })),
    ...(arcadeFixee ? [{ kind: 'anchor', activityId: arcadeFixee.activityId || 'arcade_time', label: arcadeFixee.label, start: arcadeFixee.start, end: arcadeFixee.end }] : []),
  ];
  const rangerLePass = (occupees) => (libresDuPass.length ? rangerLesLibres({ debut: firstStart, occupees, libres: libresDuPass }) : null);
  const passSansSuite = rangerLePass(plagesAHeure);
  if (passSansSuite) visitEnd = Math.max(visitEnd, passSansSuite.fin);

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
  const endWithoutPendingParties = visitEnd;
  const passRetenu = partiesALaSuite
    ? rangerLePass([...plagesAHeure, { kind: 'laser_suite', activityId: 'laser_game', label: 'Laser Game', start: partiesALaSuite.start, end: partiesALaSuite.end }])
    : passSansSuite;
  if (partiesALaSuite) {
    visitEnd = Math.max(visitEnd, partiesALaSuite.end, firstStart + sequentialMinutes + partiesALaSuite.minutes, passRetenu ? passRetenu.fin : 0);
  }
  // OU SE JOUE LE LIBRE, pour l ecran (2026-10-14) : chaque trou entre deux
  // activites a heure qui recoit une activite libre tout entiere, et ce qu
  // elle y prend. La foulee n est pas une activite a heure : le trou garde ses
  // bornes, elle y prend seulement sa place.
  const freeGaps = [];
  if (passRetenu) {
    const finOccupee = Math.max(...plagesAHeure.map((plage) => plage.end), partiesALaSuite ? partiesALaSuite.end : -Infinity);
    passRetenu.placements.forEach((posee, rang) => {
      if (!posee || !(posee.start < finOccupee)) return;
      const avant = Math.max(...plagesAHeure.filter((plage) => plage.end <= posee.start).map((plage) => plage.end));
      const apres = Math.min(...plagesAHeure.filter((plage) => plage.start >= posee.end).map((plage) => plage.start));
      if (!Number.isFinite(avant) || !Number.isFinite(apres)) return;
      const startTime = minutesToTime(avant);
      const endTime = minutesToTime(apres);
      let trou = freeGaps.find((item) => item.startTime === startTime && item.endTime === endTime);
      if (!trou) {
        trou = { startTime, endTime, items: [] };
        freeGaps.push(trou);
      }
      trou.items.push({ activityId: libresDuPass[rang].activityId, minutes: libresDuPass[rang].minutes });
    });
    freeGaps.sort((gauche, droite) => gauche.startTime.localeCompare(droite.startTime));
  }

  timeline.push(...anchorBlocks);

  // Pass liberté : chaque avantage couvre la fenêtre de visite entière, 
  // aucun horaire propre, jamais montré au client.
  model.freeSteps.forEach((step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    const stepModel = activity?.durationModel || {};
    const etape = {
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
      durationMinutes: freeStepMinutes(step, stepModel, reglageVisite.freeDurationPolicy),
    };
    // Les arcades a l heure du client : une etape a heure, que le planning de
    // la console lit comme le bowling (flexible: false).
    timeline.push(arcadeFixee && step === arcadeFixee.etape
      ? { ...etape, flexible: false, start: arcadeFixee.start, end: arcadeFixee.end, startTime: minutesToTime(arcadeFixee.start), endTime: minutesToTime(arcadeFixee.end), durationMinutes: arcadeFixee.end - arcadeFixee.start }
      : etape);
  });

  const composee = {
    ok: true,
    timeline,
    resourceBlocks,
    start: firstStart,
    end: visitEnd,
    totalMinutes: visitEnd - firstStart,
    // La fin sans les parties a la suite : la fermeture se juge sur elle.
    endWithoutPendingParties,
    totalMinutesWithoutPendingParties: endWithoutPendingParties - firstStart,
    arrivalStart,
    arrivalMinutes: FORMULA_ARRIVAL_MINUTES,
    // Avis de confort : la combinaison est réservable, on dit juste ce qu'elle
    // implique sur place. Jamais un motif de refus.
    comfortNotices,
    laserPassPlan: partiesALaSuite
      // Ce que l ecran dit « dans la foulee » : combien de parties, et le temps
      // qu elles prennent a la suite (jamais une heure imposee).
      ? { ...buildAnchorLaserPassPlan({ laserAnchor, laserOnSite, partTimes: laserPartTimes }), followOnMinutes: partiesALaSuite.minutes }
      : buildAnchorLaserPassPlan({ laserAnchor, laserOnSite, partTimes: laserPartTimes }),
    anchorPlan: {
      mode: 'anchors_freedom',
      laserPlacement: laserOnSite ? 'onsite' : 'scheduled',
      // `times` garde une entree par ACTIVITE, et c'est la PREMIERE fenetre qui
      // la donne : avec plusieurs parties de laser, prendre la derniere aurait
      // fait mentir l'heure que le tunnel compare pour retrouver son creneau.
      // Les heures partie par partie vivent dans `laserGameTimes`.
      times: anchorWindows.reduce((acc, window) => {
        if (!acc[window.activityId]) acc[window.activityId] = minutesToTime(window.start);
        return acc;
      }, {}),
      laserGameTimes: laserPartTimes.map((minutes) => (Number.isFinite(minutes) ? minutesToTime(minutes) : '')),
      // L heure d arcade que le client a choisie, sans arrivee : la
      // modification la garde, l ecran la relit.
      ...(arcadeFixee ? { arcadeTime: minutesToTime(arcadeFixee.start) } : {}),
    },
  };
  // LA VISITE PAR HEURE D ARRIVEE (2026-10-12) : la composition d avant, a
  // laquelle l arrivee du client donne son debut, sa fin et sa frise.
  if (arriveeDemandee !== null && arriveeDemandee !== undefined) {
    return poserArrivee(composee, {
      arrivee: Number(arriveeDemandee),
      model,
      anchorWindows,
      partiesALaSuite,
      sequentialSteps,
      reglage: reglageVisite,
      arcadeStart,
    });
  }
  return { ...composee, freeGaps };
}

// LA FRISE D UNE VISITE QUI COMMENCE A L ARRIVEE (2026-10-12).
//
// Le groupe arrive a l heure qu il a choisie ; le bowling et le laser ont leurs
// heures fermes (les ancres). Entre l arrivee et la premiere ancre, puis entre
// deux ancres, s ouvrent des TROUS. Les activites libres de la formule
// (arcades, minigolf, boissons...) s y rangent. Les arcades y prennent leur
// heure (Movsar, 2026-10-12 : une heure choisie, a l arrivee quand le bowling
// et le laser sont pris) ; le minigolf, les boissons et le reste du libre
// n en ont aucune (le pass de la visite), la frise dit seulement ou ils
// tiennent. Ce qu aucune ne couvre est l ATTENTE OISIVE, bornee par le
// centre ; ce qui ne tient dans aucun trou se joue apres la derniere ancre.
//
// Une activite libre ne se coupe pas et ne deborde pas sur l ancre qui suit.
// Le rangement couvre le plus de trous possible (la plus petite attente),
// puis remplit d abord le trou le plus tot (le groupe commence par le libre),
// puis garde l ordre de la formule. Les activites s y enchainent sans
// transition propre : leur duree absorbe le passage. Les transitions de la
// visite (meme compte que la composition d avant) s ajoutent a sa fin, ce qui
// laisse la fin d une visite sans attente egale a celle d avant.
const RANGEMENT_EXACT_MAX = 8;

function meilleurRangement(capacites, durees) {
  const n = durees.length;
  if (!n || !capacites.length) return durees.map(() => -1);
  if (n > RANGEMENT_EXACT_MAX) {
    // Au-dela, un rangement glouton : chaque trou dans l ordre, les plus
    // longues activites d abord.
    const place = durees.map(() => -1);
    capacites.forEach((capacite, trou) => {
      let reste = capacite;
      durees
        .map((duree, rang) => ({ duree, rang }))
        .filter((item) => place[item.rang] < 0)
        .sort((gauche, droite) => droite.duree - gauche.duree || gauche.rang - droite.rang)
        .forEach((item) => {
          if (item.duree <= reste) {
            place[item.rang] = trou;
            reste -= item.duree;
          }
        });
    });
    return place;
  }
  const sommes = new Array(1 << n).fill(0);
  for (let masque = 1; masque < (1 << n); masque += 1) {
    const bas = masque & -masque;
    sommes[masque] = sommes[masque ^ bas] + durees[Math.log2(bas)];
  }
  const rangsDe = (masque) => durees.map((_, rang) => rang).filter((rang) => masque & (1 << rang));
  // Plus de minutes couvertes, puis le trou le plus tot le plus rempli, puis
  // les activites les plus tot dans la formule.
  const meilleur = (a, b) => {
    if (a.total !== b.total) return a.total > b.total;
    for (let k = 0; k < a.parTrou.length; k += 1) {
      if (a.parTrou[k] !== b.parTrou[k]) return a.parTrou[k] > b.parTrou[k];
    }
    for (let k = 0; k < a.choix.length; k += 1) {
      const ga = rangsDe(a.choix[k]).join(',');
      const gb = rangsDe(b.choix[k]).join(',');
      if (ga !== gb) return ga < gb;
    }
    return false;
  };
  const memo = new Map();
  const chercher = (trou, restant) => {
    if (trou === capacites.length || restant === 0) return { total: 0, parTrou: [], choix: [] };
    const cle = trou * (1 << n) + restant;
    if (memo.has(cle)) return memo.get(cle);
    let retenu = null;
    for (let sous = restant; ; sous = (sous - 1) & restant) {
      if (sommes[sous] <= capacites[trou]) {
        const suite = chercher(trou + 1, restant & ~sous);
        const candidat = { total: sommes[sous] + suite.total, parTrou: [sommes[sous], ...suite.parTrou], choix: [sous, ...suite.choix] };
        if (!retenu || meilleur(candidat, retenu)) retenu = candidat;
      }
      if (sous === 0) break;
    }
    memo.set(cle, retenu);
    return retenu;
  };
  const solution = chercher(0, (1 << n) - 1);
  const place = durees.map(() => -1);
  solution.choix.forEach((masque, trou) => {
    rangsDe(masque).forEach((rang) => { place[rang] = trou; });
  });
  return place;
}

// Range les activites libres dans les trous d une visite qui commence a
// `debut`. `occupees` : les plages ou le groupe joue a heure ferme, triees.
// Rend la frise (segments dans l ordre de la journee), la place de chaque
// activite libre, et les minutes de trous, couvertes et oisives.
// UNE ACTIVITE LIBRE A L HEURE DU CLIENT (Movsar, 2026-10-13 : « ils peuvent
// choisir heure d arrivee mais aussi arcade [...] mettre arcade pendant temps
// d attente ») : celle qui porte son debut (`start`) se pose comme une plage a
// heure ferme, et le reste du libre se range dans les trous qu elle laisse. Un
// trou se dit avant, entre ou apres les ANCRES : l arcade posee n en est pas
// une. Chaque attente dit le trou ou elle tombe (`gapStart`, `gapEnd`) : c est
// la que le client peut poser quelque chose.
function rangerLesLibres({ debut, occupees, libres }) {
  const posees = libres.map((libre, rang) => rang).filter((rang) => Number.isFinite(libres[rang].start));
  const plages = [
    ...occupees,
    ...posees.map((rang) => ({ kind: 'free', rang, activityId: libres[rang].activityId, label: libres[rang].label, start: libres[rang].start, end: libres[rang].start + libres[rang].minutes })),
  ].sort((gauche, droite) => gauche.start - droite.start);
  const ancreApres = (minutes) => occupees.some((plage) => plage.start >= minutes);
  const trous = [];
  let curseur = debut;
  let avant = null;
  plages.forEach((plage) => {
    if (plage.start > curseur) trous.push({ debut: curseur, fin: plage.start, placement: avant === null ? 'before' : ancreApres(plage.start) ? 'between' : 'after', avant: avant ? avant.activityId : null });
    if (plage.end > curseur) curseur = plage.end;
    if (plage.rang === undefined) avant = plage;
  });
  const finOccupee = curseur;
  const mobiles = libres.map((libre, rang) => rang).filter((rang) => !Number.isFinite(libres[rang].start));
  const rangees = meilleurRangement(trous.map((trou) => trou.fin - trou.debut), mobiles.map((rang) => libres[rang].minutes));
  const place = libres.map(() => -1);
  mobiles.forEach((rang, k) => { place[rang] = rangees[k]; });
  const segments = [];
  const placements = libres.map(() => null);
  const segmentLibre = (libre, rang, start, placement) => {
    const end = start + libre.minutes;
    placements[rang] = { start, end, placement };
    segments.push({
      kind: 'free',
      activityId: libre.activityId,
      label: libre.label,
      start,
      end,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      minutes: libre.minutes,
      placement,
      aHeure: Boolean(libre.aHeure),
      ...(Number.isFinite(libre.start) ? { chosen: true } : {}),
    });
    return end;
  };
  // Dans un trou, l activite a heure (les arcades) passe en tete : a l arrivee
  // quand c est le trou d avant la premiere ancre. Puis le reste, dans l ordre
  // de la formule.
  const dansLOrdre = mobiles.slice()
    .sort((gauche, droite) => (Number(Boolean(libres[droite].aHeure)) - Number(Boolean(libres[gauche].aHeure))) || (gauche - droite));
  let oisive = 0;
  let couvert = 0;
  let fixees = 0;
  const ouvrir = (trou, index) => {
    let pos = trou.debut;
    dansLOrdre.forEach((rang) => {
      if (place[rang] === index) pos = segmentLibre(libres[rang], rang, pos, trou.placement);
    });
    couvert += pos - trou.debut;
    if (trou.fin > pos) {
      oisive += trou.fin - pos;
      segments.push({ kind: 'wait', label: 'Attente', start: pos, end: trou.fin, startTime: minutesToTime(pos), endTime: minutesToTime(trou.fin), minutes: trou.fin - pos, placement: trou.placement, gapStart: trou.debut, gapEnd: trou.fin });
    }
  };
  let trouIndex = 0;
  plages.forEach((plage) => {
    while (trouIndex < trous.length && trous[trouIndex].fin <= plage.start) {
      ouvrir(trous[trouIndex], trouIndex);
      trouIndex += 1;
    }
    if (plage.rang !== undefined) {
      const placement = !occupees.some((autre) => autre.start < plage.start) ? 'before' : ancreApres(plage.end) ? 'between' : 'after';
      segmentLibre(libres[plage.rang], plage.rang, plage.start, placement);
      fixees += plage.end - plage.start;
      return;
    }
    segments.push({
      kind: plage.kind || 'anchor',
      activityId: plage.activityId,
      label: plage.label,
      ...(plage.countIndex ? { countIndex: plage.countIndex } : {}),
      start: plage.start,
      end: plage.end,
      startTime: minutesToTime(plage.start),
      endTime: minutesToTime(plage.end),
      minutes: plage.end - plage.start,
    });
  });
  let fin = finOccupee;
  dansLOrdre.forEach((rang) => {
    if (place[rang] < 0) fin = segmentLibre(libres[rang], rang, fin, 'after');
  });
  segments.sort((gauche, droite) => gauche.start - droite.start || gauche.end - droite.end);
  return {
    segments,
    placements,
    fin,
    // L arcade posee couvre son temps comme une arcade rangee : trous = couvert
    // + oisive, avec ou sans heure choisie.
    trous: trous.reduce((somme, trou) => somme + (trou.fin - trou.debut), 0) + fixees,
    couvert: couvert + fixees,
    oisive,
  };
}

// Donne a une composition d ancres le debut, la fin et la frise d une visite
// qui commence a l arrivee du client. Les ancres, les parties de laser a la
// suite, la table et les avis de confort restent ceux de la composition.
// `arcadeStart` (minutes, 2026-10-13) : l heure d arcade que le client a
// choisie ; absente, la frise range les arcades elle-meme, comme avant.
function poserArrivee(composee, { arrivee, model, anchorWindows, partiesALaSuite, sequentialSteps, reglage, arcadeStart = null }) {
  // L ACCUEIL D ABORD (Movsar, 2026-10-13 : l arrivee « 10 min avant (accueil) »,
  // partout). Une activite a heure fixe commence au plus tot dix minutes apres
  // l arrivee choisie. Avant, le bowling se posait PILE a l arrivee (arrivee
  // 10:30, bowling 10:30) et l accueil se placait dix minutes AVANT l heure
  // que le client avait choisie, sans que l ecran le dise.
  const finAccueil = arrivee + FORMULA_ARRIVAL_MINUTES;
  const tropTot = [...anchorWindows].sort((gauche, droite) => gauche.start - droite.start)
    .find((window) => window.start < finAccueil);
  if (tropTot) {
    const avant = tropTot.start < arrivee;
    // L activite en cause voyage avec le refus : l ecran la libere quand le
    // client choisit cette arrivee (le dernier choix gagne).
    return {
      ok: false,
      code: avant ? 'arrival_after_anchor' : 'arrival_welcome',
      reason: avant
        ? `${tropTot.label} (${minutesToTime(tropTot.start)}) commence avant votre arrivée (${minutesToTime(arrivee)}).`
        : `${tropTot.label} (${minutesToTime(tropTot.start)}) commence pendant votre accueil : comptez ${FORMULA_ARRIVAL_MINUTES} min entre votre arrivée (${minutesToTime(arrivee)}) et votre première activité.`,
      conflict: { activityId: tropTot.activityId, label: tropTot.label, time: minutesToTime(tropTot.start) },
    };
  }
  const accueil = arrivee;
  const plagesAncres = anchorWindows.map((window) => ({
    kind: 'anchor',
    activityId: window.activityId,
    label: window.label,
    start: window.start,
    end: window.end,
  }));
  const libres = model.freeSteps.map((step) => {
    const activity = step.activityId ? getActivity(step.activityId) : null;
    return {
      activityId: step.activityId || null,
      label: activity?.name || step.label || 'Service',
      minutes: freeStepMinutes(step, activity?.durationModel, reglage.freeDurationPolicy),
      aHeure: freeStepHasTime(step, activity?.durationModel),
    };
  });
  // L HEURE D ARCADE CHOISIE (Movsar, 2026-10-13 : « pourquoi tu mets
  // automatiquement l heure d arrivee a arcade »). La premiere activite libre a
  // heure la prend : apres l accueil, jamais sur une activite a heure fixe. Les
  // parties de laser a la suite, que l equipe place, passent apres elle, d un
  // nombre entier de departs de l arene (leurs vagues gardent leur forme).
  let laSuite = partiesALaSuite;
  let arcadeChoisie = null;
  const rangArcade = libres.findIndex((libre) => libre.aHeure);
  if (arcadeStart !== null && arcadeStart !== undefined && Number.isFinite(Number(arcadeStart)) && rangArcade >= 0) {
    const arcade = libres[rangArcade];
    const debutArcade = Number(arcadeStart);
    const finArcade = debutArcade + arcade.minutes;
    const quoi = `${arcade.label} (${minutesToTime(debutArcade)}-${minutesToTime(finArcade)})`;
    if (debutArcade < finAccueil) {
      return {
        ok: false,
        code: 'arcade_before_arrival',
        reason: debutArcade < arrivee
          ? `${quoi} commence avant votre arrivée (${minutesToTime(arrivee)}).`
          : `${quoi} commence pendant votre accueil : comptez ${FORMULA_ARRIVAL_MINUTES} min après votre arrivée (${minutesToTime(arrivee)}).`,
        conflict: { activityId: 'arrivee', label: 'Arrivée', time: minutesToTime(arrivee) },
      };
    }
    const heurtee = [...plagesAncres].sort((gauche, droite) => gauche.start - droite.start)
      .find((plage) => overlap(debutArcade, finArcade, plage.start, plage.end));
    if (heurtee) {
      return {
        ok: false,
        code: 'arcade_overlap',
        reason: `${quoi} et ${heurtee.label} (${minutesToTime(heurtee.start)}) se chevauchent : décalez l’une des deux heures.`,
        conflict: { activityId: heurtee.activityId, label: heurtee.label, time: minutesToTime(heurtee.start) },
      };
    }
    if (laSuite && overlap(debutArcade, finArcade, laSuite.start, laSuite.end)) {
      const duree = laSuite.end - laSuite.start;
      let depart = snapLaserLaunch(finArcade);
      let ancre = plagesAncres.find((plage) => overlap(depart, depart + duree, plage.start, plage.end));
      while (ancre) {
        depart = snapLaserLaunch(Math.max(ancre.end, depart + 1));
        ancre = plagesAncres.find((plage) => overlap(depart, depart + duree, plage.start, plage.end));
      }
      laSuite = { ...laSuite, start: depart, end: depart + duree };
    }
    libres[rangArcade] = { ...arcade, start: debutArcade };
    arcadeChoisie = debutArcade;
  }
  const suite = laSuite
    ? [{ kind: 'laser_suite', activityId: 'laser_game', label: laSuite.parties > 1 ? `Laser Game (${laSuite.parties} parties à la suite)` : 'Laser Game (partie à la suite)', start: laSuite.start, end: laSuite.end }]
    : [];
  const transitions = Math.max(0, sequentialSteps - 1) * TRANSITION_MINUTES;
  // LE LIBRE COMMENCE APRES L ACCUEIL (Movsar, 2026-10-13, meme capture : les
  // arcades se posaient a l heure d arrivee, pendant les dix minutes d accueil).
  const frise = rangerLesLibres({ debut: finAccueil, occupees: [...plagesAncres, ...suite], libres });
  const sansSuite = suite.length ? rangerLesLibres({ debut: finAccueil, occupees: plagesAncres, libres }) : frise;
  const lastEnd = Math.max(...plagesAncres.map((plage) => plage.end));
  let finSansSuite = Math.max(lastEnd, sansSuite.fin + transitions);
  const table = composee.timeline.find((step) => step.resourceType === 'party_table' && step.followsArrival);
  let tableMinutes = 0;
  if (table && model.tableStep) {
    const activity = getActivity(model.tableStep.activityId);
    tableMinutes = Number(model.tableStep.durationMinutes || activity?.durationModel?.defaultMinutes || 120);
    finSansSuite = Math.max(finSansSuite, arrivee + tableMinutes);
  }
  const fin = Math.max(finSansSuite, frise.fin + transitions, laSuite ? laSuite.end : 0);
  // LA DUREE NATURELLE : la meme visite sans un seul trou, l accueil, les
  // activites a heure ferme, les activites libres et les transitions bout a
  // bout (table comprise). Rien ne se fait pendant l accueil (2026-10-13) :
  // ses minutes en font partie, la borne automatique les compte.
  const occupeesMinutes = [...plagesAncres, ...suite].reduce((somme, plage) => somme + (plage.end - plage.start), 0);
  const libresMinutes = libres.reduce((somme, libre) => somme + libre.minutes, 0);
  const naturelle = Math.max((finAccueil - arrivee) + occupeesMinutes + libresMinutes + transitions, tableMinutes);
  const timeline = composee.timeline.map((step, index) => {
    if (index === 0 && step.label === 'Arrivée & accueil') {
      return { ...step, start: accueil, end: finAccueil, startTime: minutesToTime(accueil), endTime: minutesToTime(finAccueil) };
    }
    return step;
  });
  if (table) {
    // Le meme objet que dans resourceBlocks : la table suit l arrivee.
    Object.assign(table, {
      start: accueil,
      end: fin,
      startTime: minutesToTime(accueil),
      endTime: minutesToTime(fin),
      durationMinutes: fin - accueil,
    });
  }
  let rangLibre = 0;
  const timelineRangee = timeline.map((step) => {
    if (!step.flexible) return step;
    const posee = frise.placements[rangLibre];
    const libre = libres[rangLibre];
    rangLibre += 1;
    // L ARCADE A SON HEURE (Movsar, 2026-10-12) : une etape a heure, la ou la
    // frise la range, a l arrivee quand le bowling et le laser sont pris. Le
    // planning de la console la lit comme le bowling (flexible: false).
    if (libre && libre.aHeure && posee) {
      return {
        ...step,
        flexible: false,
        start: posee.start,
        end: posee.end,
        startTime: minutesToTime(posee.start),
        endTime: minutesToTime(posee.end),
        durationMinutes: posee.end - posee.start,
        placement: posee.placement,
      };
    }
    // Le reste du libre (minigolf, boissons) : le pass de toute la visite,
    // sans heure propre, comme sans arrivee. Le minigolf n a pas d heure : sa
    // duree, c est le client qui la choisit.
    return {
      ...step,
      start: arrivee,
      end: fin,
      startTime: minutesToTime(arrivee),
      endTime: minutesToTime(fin),
    };
  });
  // La frise montree : les heures des ancres et des arcades ; le reste du
  // libre et l attente en minutes, a leur place (avant, entre, apres).
  const segmentMontre = ({ start: _start, end: _end, aHeure, ...segment }) => {
    if (segment.kind === 'free' && !aHeure) {
      const { startTime: _debut, endTime: _fin, ...sansHeure } = segment;
      return { ...sansHeure, timed: false };
    }
    if (segment.kind === 'free') return { ...segment, timed: true };
    if (segment.kind === 'wait') {
      // L attente se dit en minutes ; le trou ou elle tombe, lui, a des bornes
      // sures (la fin de ce qui le precede, le debut de ce qui le suit) : c est
      // la que le client peut poser ses arcades.
      const { startTime: _debut, endTime: _fin, gapStart, gapEnd, ...sansHeure } = segment;
      return { ...sansHeure, gapStartTime: minutesToTime(gapStart), gapEndTime: minutesToTime(gapEnd), gapMinutes: gapEnd - gapStart };
    }
    return segment;
  };
  const avant = frise.segments.filter((segment) => segment.kind === 'free' && segment.placement === 'before');
  return {
    ...composee,
    timeline: timelineRangee,
    start: arrivee,
    end: fin,
    totalMinutes: fin - arrivee,
    endWithoutPendingParties: finSansSuite,
    totalMinutesWithoutPendingParties: finSansSuite - arrivee,
    arrivalStart: accueil,
    anchorPlan: { ...composee.anchorPlan, arrivalTime: minutesToTime(arrivee) },
    arrivalPlan: {
      arrivalTime: minutesToTime(arrivee),
      endTime: minutesToTime(fin),
      visitMinutes: fin - arrivee,
      naturalVisitMinutes: naturelle,
      waitMinutes: frise.oisive,
      waitLabel: formatGapLabel(frise.oisive),
      holeMinutes: frise.trous,
      coveredMinutes: frise.couvert,
      transitionMinutes: transitions,
      freeDurationPolicy: reglage.freeDurationPolicy,
      before: avant.map((segment) => ({
        activityId: segment.activityId,
        label: segment.label,
        minutes: segment.minutes,
        ...(segment.aHeure ? { startTime: segment.startTime, endTime: segment.endTime } : {}),
      })),
      frise: frise.segments.map(segmentMontre),
      // L heure d arcade que le client a choisie : la modification la garde
      // (lib/reservation-ops.js arriveeGardee). Absente quand la frise l a rangee.
      ...(arcadeChoisie !== null ? { arcadeTime: minutesToTime(arcadeChoisie) } : {}),
    },
  };
}

// La plage des arcades posees a `debut` (minutes) : la premiere activite libre
// a heure de la formule (lib/formula-visit freeStepHasTime), a la duree que le
// centre retient. null quand la formule n en a pas.
function fenetreDesArcades(center, model, debut) {
  if (!Number.isFinite(debut) || !model || !Array.isArray(model.freeSteps)) return null;
  const etape = model.freeSteps.find((step) => freeStepHasTime(step, step.activityId ? getActivity(step.activityId)?.durationModel : null));
  if (!etape) return null;
  const activite = etape.activityId ? getActivity(etape.activityId) : null;
  return {
    etape,
    activityId: etape.activityId || '',
    label: activite?.name || etape.label || 'Arcades',
    start: debut,
    end: debut + freeStepMinutes(etape, activite?.durationModel, formulaVisitOf(center).freeDurationPolicy),
  };
}

// L ARRIVEE NE PASSE JAMAIS AVANT L OUVERTURE (Movsar, 2026-10-13 : « lorsque
// il commence a l ouverture du centre ils peuvent venir a l heure pile, pas
// besoin de 10 minutes a l avance, uniquement pour l ouverture, et la borne
// arrivee affiche juste la meme heure que l activite »). Une visite sans heure
// d arrivee se presente dix minutes avant sa premiere activite, sauf quand ces
// dix minutes tombent avant l ouverture : elle se presente alors a
// l ouverture, a l heure pile de sa premiere activite quand celle-ci ouvre la
// journee. L accueil et la table qui suit l arrivee commencent avec elle. Rend
// une copie : la composition reste ce qu elle etait.
function arriveeALOuverture(composee, ouverture) {
  if (!composee || !composee.ok || !Number.isFinite(composee.arrivalStart) || !Number.isFinite(ouverture)) return composee;
  if (composee.arrivalStart >= ouverture) return composee;
  const arrivee = Math.min(composee.start, ouverture);
  const avant = composee.arrivalStart;
  const deplacees = new Map();
  const deplacer = (step) => {
    if (!step || step.start !== avant || !(step.label === 'Arrivée & accueil' || step.followsArrival)) return step;
    if (!deplacees.has(step)) {
      deplacees.set(step, {
        ...step,
        start: arrivee,
        startTime: minutesToTime(arrivee),
        ...(step.followsArrival ? { durationMinutes: step.end - arrivee } : {}),
      });
    }
    return deplacees.get(step);
  };
  return {
    ...composee,
    timeline: composee.timeline.map(deplacer),
    resourceBlocks: composee.resourceBlocks.map(deplacer),
    arrivalStart: arrivee,
    arrivalMinutes: composee.start - arrivee,
  };
}

// L HEURE D ARRIVEE DEMANDEE, avant toute composition : le centre la
// propose-t-il, et tombe-t-elle sur la grille des heures (:00/:30) ?
function verdictDeLArrivee(center, arrivee) {
  const reglage = formulaVisitOf(center);
  if (!reglage.arrivalFirst) {
    return { ok: false, code: 'arrival_disabled', reason: 'La réservation par heure d’arrivée n’est pas proposée par ce centre.', reglage };
  }
  const texte = typeof arrivee === 'number' ? '' : String(arrivee === null || arrivee === undefined ? '' : arrivee).trim();
  const lue = /^([01]?\d|2\d):([0-5]\d)$/.exec(texte);
  const minutes = typeof arrivee === 'number' ? arrivee : (lue ? Number(lue[1]) * 60 + Number(lue[2]) : NaN);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return { ok: false, code: 'arrival_invalid', reason: 'Heure d’arrivée illisible : indiquez-la au format HH:MM (ex. 15:00).', reglage };
  }
  if (minutes % PROGRAM_GRID_MINUTES !== 0) {
    return { ok: false, code: 'off_grid', reason: 'L’heure d’arrivée se choisit aux heures pleines ou demies (ex. 15:00, 15:30).', reglage };
  }
  return { ok: true, code: '', reason: '', minutes, reglage };
}

// LES BORNES D UNE VISITE PAR HEURE D ARRIVEE, ecrites une fois : la porte
// (evaluateAnchoredCombination) les applique, la recherche
// (chooseArrivalCombination) les lit pour ne pas essayer une combinaison que
// la porte refuserait.
function bornesDeLArrivee(raw, reglage) {
  const plan = raw && raw.arrivalPlan;
  if (!plan) return { ok: true, code: '', reason: '' };
  const maxVisitMinutes = effectiveMaxVisitMinutes(reglage, plan.naturalVisitMinutes);
  const mesure = { waitMinutes: plan.waitMinutes, visitMinutes: plan.visitMinutes, maxWaitMinutes: reglage.maxWaitMinutes, maxVisitMinutes };
  // Au-dela, la porte PREVIENT (evaluateAnchoredCombination) : la phrase est
  // un avis, pas un refus.
  if (plan.waitMinutes > reglage.maxWaitMinutes) {
    return {
      ok: false,
      code: 'arrival_wait',
      reason: `Arriver à ${plan.arrivalTime} laisse ${formatGapLabel(plan.waitMinutes)} sans activité.`,
      ...mesure,
    };
  }
  if (plan.visitMinutes > maxVisitMinutes) {
    return {
      ok: false,
      code: 'arrival_visit',
      reason: `Arriver à ${plan.arrivalTime}, la visite dure ${formatGapLabel(plan.visitMinutes)}.`,
      ...mesure,
    };
  }
  return { ok: true, code: '', reason: '', ...mesure };
}

// Valide une combinaison d'ancres complète : composition, horaires
// d'ouverture, règles de la formule, conflits de ressources (serveur =
// source de vérité). Renvoie le scénario décoré prêt pour opsPlan.
// LE SOUS-GROUPE QUI ATTEND SON TOUR, lu sur les blocs d un plan.
// Quand une activite se joue en plusieurs vagues (l arene laser ne prend pas
// 40 personnes d un coup), le dernier groupe patiente entre le debut de la
// premiere vague et le debut de la sienne. On mesure ICI, une seule fois,
// pour les deux usages : le moteur s en sert pour savoir combien de temps
// mort la visite contient deja, la disponibilite pour dimensionner l offre
// d attente. Deux copies de cette regle auraient fini par diverger, et l une
// des deux facture.
//
// Un bloc porte son debut en minutes (`start`) dans le moteur et en texte
// (`startTime`) dans le plan rendu au client : les deux formes sont lues.
// UNE VAGUE N EST PAS UNE PARTIE. Les vagues d une meme partie (meme
// `countIndex`) partagent le groupe : la derniere attend les precedentes.
// Deux PARTIES rejouent le groupe ENTIER : entre les deux, personne n attend
// son tour, le groupe fait autre chose (le trou, s il y en a un, est compte
// par intersticesDuGroupe). Capture de Movsar du 2026-09-30 : 4 personnes,
// laser 2 parties a 16:30 et 18:30, bowling entre les deux ; l ecran disait
// « 4 personnes attendent 2 h leur tour » et proposait des arcades
// « pendant l attente », parce que les deux parties etaient lues comme deux
// vagues d un groupe coupe en deux.
// LES TROUS DU GROUPE ENTIER entre ses activites a creneau : les minutes ou
// PERSONNE ne joue, entre le debut de la premiere activite et la fin de la
// derniere. Les activites libres de la visite (minigolf, arcades) s y jouent :
// un laser a 10:00 et un bowling a 22:00 laissent onze heures pour le minigolf,
// la visite ne deborde pas la fermeture. Mesure du 2026-09-22 : sans elle, un
// bowling pose a 22:00 disait « plus le temps pour la suite » a TOUTES les
// heures du laser, 10:00 compris. Le moteur (la reserve de temps) et la
// disponibilite (la fin affichee) lisent cette mesure, jamais une copie.
// Un bloc porte ses heures en minutes (`start`, `end`) dans le moteur et en
// texte (`startTime`, `endTime`) dans le plan rendu au client.
// LES VAGUES D UNE MEME PARTIE COMPTENT COMME UN SEUL BLOC : entre deux
// vagues, un sous-groupe attend deja, et cette attente est comptee par
// attenteDuSousGroupe. La recompter ici avancait la fin de la visite de ces
// minutes (gate wait-offer : recul de 10 min au lieu de 15). Deux PARTIES
// distinctes (`countIndex`), elles, laissent un vrai trou au groupe entier.
// LES TROUS EUX-MEMES, dans l ordre de la journee : ou ils commencent, ce
// qu ils durent, et entre quelles parties (`activite#partie`). La raison
// « pause » d un complement les nomme (2026-10-07) ; intersticesDuGroupe n en
// est que la somme, pour que la regle n existe qu une fois.
function trousDuGroupe(resourceBlocks) {
  const lire = (minutes, texte) => {
    if (minutes !== null && minutes !== '' && Number.isFinite(Number(minutes))) return Math.round(Number(minutes));
    return typeof texte === 'string' && /^\d{1,2}:\d{2}/.test(texte) ? timeToMinutes(texte.slice(0, 5)) : null;
  };
  const parPartie = new Map();
  (Array.isArray(resourceBlocks) ? resourceBlocks : [])
    .filter((bloc) => bloc && bloc.activityId)
    .forEach((bloc) => {
      const debut = lire(bloc.start, bloc.startTime);
      const fin = lire(bloc.end, bloc.endTime);
      if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return;
      const cle = `${bloc.activityId}#${Number(bloc.countIndex) || 1}`;
      const avant = parPartie.get(cle);
      parPartie.set(cle, avant ? { debut: Math.min(avant.debut, debut), fin: Math.max(avant.fin, fin) } : { debut, fin });
    });
  const intervalles = [...parPartie.entries()]
    .map(([partie, intervalle]) => ({ partie, ...intervalle }))
    .sort((gauche, droite) => gauche.debut - droite.debut);
  const trous = [];
  let finCourante = null;
  let avant = null;
  intervalles.forEach((intervalle) => {
    if (finCourante !== null && intervalle.debut > finCourante) {
      trous.push({ debut: finCourante, fin: intervalle.debut, minutes: intervalle.debut - finCourante, avant, apres: intervalle.partie });
    }
    if (finCourante === null || intervalle.fin > finCourante) {
      finCourante = intervalle.fin;
      avant = intervalle.partie;
    }
  });
  return trous;
}

function intersticesDuGroupe(resourceBlocks) {
  return trousDuGroupe(resourceBlocks).reduce((somme, trou) => somme + trou.minutes, 0);
}

// LES TROUS QUE LE LIBRE PEUT PRENDRE (2026-10-13, Movsar : « il ne compte pas
// les activités qui sont dans la foulée »). Les parties de laser sans heure
// s enchainent dans un trou du groupe quand elles y tiennent (partiesALaSuite,
// plus haut) et ne repoussent la fin que de ce qui depasse le dernier bloc.
// Credite des trous bruts, le libre (arcades, minigolf) se jouait dans les
// memes minutes : laser 13:00 et bowling 15:00 annoncaient 16:00 pour 16:40
// avec trois parties. Le libre ne prend donc que ce que la foulee laisse.
// `fin` est la fin du plan sans la marge du staff : ce qu elle depasse le
// dernier bloc, c est la foulee jouee apres lui.
// TROU PAR TROU (2026-10-14) : la foulee part de la fin de la derniere partie
// posee et prend le debut du trou qui s ouvre la. `capacite` dit ce qui reste
// a chaque trou ; leur somme est la mesure d avant.
function trousPourLeLibre(resourceBlocks, laserPassPlan, fin) {
  const trous = trousDuGroupe(resourceBlocks).map((trou) => ({ ...trou, capacite: trou.minutes }));
  const foulee = Math.max(0, Math.round(Number(laserPassPlan && laserPassPlan.followOnMinutes) || 0));
  if (!trous.length || !foulee) return trous;
  const finDe = (bloc) => (bloc.end !== null && bloc.end !== undefined && bloc.end !== '' && Number.isFinite(Number(bloc.end))
    ? Math.round(Number(bloc.end))
    : (typeof bloc.endTime === 'string' && /^\d{1,2}:\d{2}/.test(bloc.endTime) ? timeToMinutes(bloc.endTime.slice(0, 5)) : null));
  const blocs = (Array.isArray(resourceBlocks) ? resourceBlocks : []).filter((bloc) => bloc && bloc.activityId);
  const fins = blocs.map(finDe).filter((minutes) => Number.isFinite(minutes));
  const dehors = fins.length && Number.isFinite(Number(fin))
    ? Math.min(foulee, Math.max(0, Math.round(Number(fin)) - Math.max(...fins)))
    : 0;
  let dedans = foulee - dehors;
  const finsLaser = blocs.filter((bloc) => bloc.activityId === 'laser_game').map(finDe).filter((minutes) => Number.isFinite(minutes));
  const depuis = finsLaser.length ? Math.max(...finsLaser) : -Infinity;
  [...trous.filter((trou) => trou.debut >= depuis), ...trous.filter((trou) => trou.debut < depuis)].forEach((trou) => {
    const prise = Math.min(dedans, trou.capacite);
    trou.capacite -= prise;
    dedans -= prise;
  });
  return trous;
}

// LE LIBRE SE JOUE D UN BLOC (Movsar, 2026-10-14, capture : laser 14:00 et
// 15:00, bowling 16:00-17:00, minigolf 45 min ; « FIN estimé a 17h et le mini
// golf se joue quand du coup ? »). Les deux attentes de 35 min s additionnaient
// et le minigolf y « tenait ». Il ne se coupe pas en deux : une activite libre
// ne prend qu un trou qui la contient TOUT ENTIERE (meilleurRangement, la regle
// de la visite par heure d arrivee) ; ce qui ne tient dans aucun se joue apres
// le plan et recule la fin. Deux morceaux se partagent encore : une entree a
// la journee (la plaine se prend en plusieurs fois) et ce qu une offre
// d attente deborde du temps mort (la mesure du 2026-09-18).
// `libres` : les lignes sans heure (minutes, waitOffer, dayAccess). Absentes,
// le libre reste un seul morceau qui se partage, la mesure d avant.
function piecesDuLibre({ libres = null, libre = 0, couvert = 0 } = {}) {
  const minutesDe = (valeur) => Math.max(0, Math.round(Number(valeur) || 0));
  if (!Array.isArray(libres)) return [{ activityId: null, minutes: Math.max(0, minutesDe(libre) - minutesDe(couvert)), entier: false }];
  let reste = minutesDe(couvert);
  return libres.filter(Boolean).map((ligne) => {
    const minutes = minutesDe(ligne.minutes);
    if (ligne.waitOffer === true) {
      const pendant = Math.min(reste, minutes);
      reste -= pendant;
      return { activityId: ligne.activityId || null, minutes: minutes - pendant, entier: false, attente: true };
    }
    return { activityId: ligne.activityId || null, minutes, entier: ligne.dayAccess !== true };
  });
}

// Range les morceaux dans les trous : les entiers d abord, au meilleur
// rangement, puis ceux qui se partagent dans ce qui reste, du plus tot au plus
// tard. Rend ce qui se joue apres le plan (`apres`), les parts de chaque
// morceau (`dans`, le trou et ses minutes) et ce qui reste a chaque trou.
function rangerLeLibre({ trous = [], pieces = [] } = {}) {
  const reste = trous.map((trou) => Math.max(0, Math.round(Number(trou.capacite ?? trou.minutes) || 0)));
  const dans = pieces.map(() => []);
  const entiers = pieces.map((_, rang) => rang).filter((rang) => pieces[rang].entier !== false && pieces[rang].minutes > 0);
  const places = meilleurRangement(reste.slice(), entiers.map((rang) => pieces[rang].minutes));
  entiers.forEach((rang, k) => {
    if (!(places[k] >= 0)) return;
    reste[places[k]] -= pieces[rang].minutes;
    dans[rang].push({ trou: places[k], minutes: pieces[rang].minutes });
  });
  pieces.forEach((piece, rang) => {
    if (piece.entier !== false) return;
    let aPlacer = piece.minutes;
    reste.forEach((libre, trou) => {
      const prise = Math.min(aPlacer, libre);
      if (!(prise > 0)) return;
      reste[trou] -= prise;
      aPlacer -= prise;
      dans[rang].push({ trou, minutes: prise });
    });
  });
  const apres = pieces.reduce((somme, piece, rang) => somme + Math.max(0, piece.minutes - dans[rang].reduce((total, part) => total + part.minutes, 0)), 0);
  return { apres, dans, reste };
}
// UNE ATTENTE SE DIT SANS CE QUI S Y JOUE (2026-10-15). L ecran range le
// minigolf d une visite dans l attente d 1 h 05 entre le laser et le bowling
// et n y laisse que 20 min : l avis du haut disait encore « 1 h 05 d'attente
// entre Laser Game et Bowling ». Pour une visite composee, l avis d un trou
// ne compte que le temps que ses activites libres, rangees d un bloc, y
// laissent (ce que l agenda dit dessous), et se tait sous la marge de
// respiration. L API la passe sur chaque creneau d une visite, avec le
// rangement de sa fin (api/public-availability.js, mesureDeVisite) : quand
// le client a pose ses heures, le creneau vient de planningAgent, qui ne
// connait pas les activites libres. Une formule garde son avis : son seuil
// compte deja ses etapes libres.
function avisSansLeLibre(avis, { trous = [], pieces = [], rangement = null } = {}) {
  return (Array.isArray(avis) ? avis : []).map((notice) => {
    if (!notice || notice.code !== 'anchor_gap' || !rangement) return notice;
    const rang = trous.findIndex((trou) => minutesToTime(trou.debut) === notice.gapStartTime && minutesToTime(trou.fin) === notice.gapEndTime);
    if (rang < 0) return notice;
    const joue = pieces.reduce((somme, piece, index) => (piece.entier === false ? somme
      : somme + (rangement.dans[index] || []).filter((part) => part.trou === rang).reduce((total, part) => total + part.minutes, 0)), 0);
    if (!(joue > 0)) return notice;
    const vide = Math.max(0, Math.round(Number(notice.gapMinutes) || 0) - joue);
    if (vide <= ANCHOR_GAP_GRACE_MINUTES) return null;
    const gapLabel = formatGapLabel(vide);
    return { ...notice, gapMinutes: vide, gapLabel, message: `${gapLabel} d'attente entre ${notice.fromLabel} et ${notice.toLabel}.` };
  }).filter(Boolean);
}
// LA FIN DE LA VISITE, UNE SEULE MESURE (2026-10-13). Le client la lit dans le
// tunnel (api/public-availability.js), l equipe dans la fenetre Reserver
// (lib/reserver-fenetre.js) : la fenetre s arretait au dernier bloc a heure
// et annoncait 14:25 la visite que le tunnel finissait a 16:15. La fin du plan
// (sans la marge du staff, parties a la suite comprises), puis le libre qui
// ne tient ni dans l attente d un sous-groupe (ce qui s y joue ne repousse
// rien) ni dans les trous que la foulee laisse. `libre` : les minutes des
// activites sans heure ; `attenteLibre` : la part proposee au sous-groupe qui
// patiente ; `creux` : l attente la plus longue du groupe (vagues du plan,
// tours d une activite libre).
// `libres` (2026-10-14) : les lignes sans heure, chacune son morceau
// (piecesDuLibre) ; `rangement` dit ou chacune se joue.
function mesurerLaVisite({ debut, plan = null, libre = 0, attenteLibre = 0, creux = null, libres = null } = {}) {
  const depart = Math.round(Number(debut) || 0);
  const marge = Math.max(0, Number(plan && plan.bufferMinutes) || 0);
  const finPlan = plan && typeof plan.endTime === 'string' && /^\d{1,2}:\d{2}/.test(plan.endTime)
    ? timeToMinutes(plan.endTime.slice(0, 5)) - marge
    : depart;
  const couvert = Math.min(
    Math.max(0, Math.round(Number(attenteLibre) || 0)),
    Math.max(0, Math.round(Number(creux && creux.minutes) || 0)),
  );
  const trous = trousPourLeLibre(plan && plan.resourceBlocks, plan && plan.laserPassPlan, finPlan);
  const pieces = piecesDuLibre({ libres, libre, couvert });
  const rangement = rangerLeLibre({ trous, pieces });
  return { apresLePlan: Math.max(finPlan, depart), libreApres: rangement.apres, trous, pieces, rangement };
}

function attenteDuSousGroupe(resourceBlocks) {
  const blocs = (Array.isArray(resourceBlocks) ? resourceBlocks : [])
    .map((bloc) => {
      if (!bloc) return null;
      const personnes = Math.trunc(Number(bloc.players != null ? bloc.players : bloc.pax) || 0);
      const debut = Number.isFinite(Number(bloc.start))
        ? Math.round(Number(bloc.start))
        : (typeof bloc.startTime === 'string' && /^\d{1,2}:\d{2}/.test(bloc.startTime) ? timeToMinutes(bloc.startTime.slice(0, 5)) : null);
      if (personnes <= 0 || !Number.isFinite(debut)) return null;
      const partie = `${String(bloc.activityId || bloc.resourceType || '')}#${Number(bloc.countIndex) || 1}`;
      return { partie, debut, personnes };
    })
    .filter(Boolean);
  const parPartie = new Map();
  blocs.forEach((bloc) => {
    const liste = parPartie.get(bloc.partie) || [];
    liste.push(bloc);
    parPartie.set(bloc.partie, liste);
  });
  let meilleure = null;
  parPartie.forEach((liste) => {
    const heures = [...new Set(liste.map((bloc) => bloc.debut))].sort((gauche, droite) => gauche - droite);
    if (heures.length < 2) return;
    const derniere = heures[heures.length - 1];
    const personnes = liste.filter((bloc) => bloc.debut === derniere)
      .reduce((somme, bloc) => somme + bloc.personnes, 0);
    const minutes = derniere - heures[0];
    if (personnes > 0 && minutes > 0 && (!meilleure || minutes > meilleure.minutes)) {
      meilleure = { personnes, minutes };
    }
  });
  return meilleure;
}

// `arrival` (2026-10-12, minutes ou HH:MM) : la visite commence a l heure
// d arrivee du client. La meme porte juge alors aussi l arrivee elle-meme
// (verdictDeLArrivee) et, en dernier, les bornes du centre (bornesDeLArrivee) :
// un refus de borne veut dire que tout le reste tient. Absent, rien ne change.
function evaluateAnchoredCombination({ center, formula, date, pax, anchorTimes, laserPlacement, reservations = [], laneStatuses = {}, blocks = [], preference = {}, preferredLanes = [], laserGameTimes = [], reserveMinutes = 0, reserveItems = null, reserveLabel = '', reserveWaitMinutes = 0, reserveSoft = false, arrival = null, arcadeStart = null }) {
  const demandeArrivee = arrival === null || arrival === undefined ? null : verdictDeLArrivee(center, arrival);
  if (demandeArrivee && !demandeArrivee.ok) return { ok: false, code: demandeArrivee.code, reason: demandeArrivee.reason, scenario: null };
  const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
  // L heure d arcade choisie se pose avec ou sans arrivee (modele A, 2026-10-13).
  const raw = composeAnchoredFormulaScenario({ center, formula, pax, anchorTimes, laserPlacement, preferredLanes, laserGameTimes, bowlingConfig, arcadeStart, ...(demandeArrivee ? { arrivalStart: demandeArrivee.minutes } : {}) });
  // L activite en cause d un refus de composition voyage avec lui (une arcade
  // posee sur le bowling) : l ecran sait laquelle il deplace.
  if (!raw.ok) return { ok: false, code: raw.code, reason: raw.reason, ...(raw.conflict ? { conflict: raw.conflict } : {}), scenario: null };

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
    estimatedMinutes: Number.isFinite(raw.totalMinutesWithoutPendingParties) ? raw.totalMinutesWithoutPendingParties : raw.totalMinutes,
    formula,
    preMinutes: FORMULA_ARRIVAL_MINUTES,
  });
  if (!window.ok) return { ok: false, code: 'schedule', reason: window.reason, scenario: null };
  // La grille offre l ouverture : la validation accepte ce qu elle offre.
  //
  // LA RESERVE DE TEMPS DES ACTIVITES LIBRES (entretien Seb, 2026-09-17).
  // `reserveMinutes` vaut 0 pour toute formule du catalogue : leur scenario
  // porte deja ses pas libres. Seule la VISITE composee par le client passe
  // une reserve, parce que son document synthetique ne porte QUE le bowling et
  // l arene (lib/visit-program.js) : sans elle, la fermeture se jugeait sur
  // les ancres seules et le client s entendait proposer une arrivee ou son
  // minigolf ne rentrait plus. La regle du proprietaire ne change pas : une
  // visite qui finit PILE a la fermeture passe.
  // CE QUI SE JOUE PENDANT L ATTENTE N ALLONGE RIEN. `reserveWaitMinutes` dit
  // combien de ces minutes viennent d une activite proposee au sous-groupe qui
  // patiente : elles tiennent dans le temps mort que le plan contient DEJA,
  // sauf leur debordement. Mesure du 2026-09-18 : minigolf 45 min sur 30 min
  // d attente, la visite finissait 45 min plus tard sur l ecran du client au
  // lieu de 15.
  const creux = attenteDuSousGroupe(raw.resourceBlocks);
  const couvert = Math.min(
    Math.max(0, Math.round(Number(reserveWaitMinutes) || 0)),
    Math.max(0, Math.round(Number(creux && creux.minutes) || 0)),
  );
  // LES TROUS ENTRE LES ACTIVITES A CRENEAU ABSORBENT LE LIBRE AUSSI : seule
  // la part qui ne tient ni dans l attente ni dans ces trous repousse la fin.
  // Les parties de laser jouees dans la foulee occupent deja une part de ces
  // trous : le libre n y prend que le reste (trousPourLeLibre), la meme
  // mesure que la fin que le client lit. UN BLOC, PAS DES MINUTES (2026-10-14) :
  // chaque activite libre ne prend qu un trou qui la contient tout entiere
  // (rangerLeLibre). `reserveItems` porte les lignes sans heure ; absent, la
  // reserve reste un seul morceau qui se partage.
  const reserve = rangerLeLibre({ trous: trousPourLeLibre(raw.resourceBlocks, raw.laserPassPlan, raw.end), pieces: piecesDuLibre({ libres: reserveItems, libre: reserveMinutes, couvert }) }).apres;
  // LA RESERVE EST UN CONSEIL, PAS UN INTERDIT, quand l appelant le demande
  // (`reserveSoft`, formulaire Fun Galaxy ; Movsar, 2026-09-22 : « on peut
  // quand meme selectionner et ca s adapte »). Les activites reservees
  // tiennent, c est le reste de la visite qui ne rentre plus : l heure reste
  // valable, avec un avertissement que l ecran montre, et la visite finit a
  // la fermeture. Sans `reserveSoft` (tunnel actuel), rien ne change.
  let warning = null;
  // La fermeture se juge sans les parties de laser a la suite (plus bas).
  const finReservee = Number.isFinite(raw.endWithoutPendingParties) ? raw.endWithoutPendingParties : raw.end;
  // CE QUI DEBORDE, ET DE COMBIEN (capture de Movsar du 2026-09-30 : FORMULE 2
  // a 19:30 disait « plus le temps pour les parties de laser restantes »,
  // alors que la formule porte aussi un minigolf, des arcades et des
  // boissons, tous sans heure). Ce qui reste sans heure se joue dans l ordre
  // que le groupe choisit sur place : quand il y en a plusieurs, aucun n est
  // « celui qui manque », c est la VISITE qui finit trop tard. `fin` est sa
  // fin complete (parties a la suite et activites libres comprises), celle
  // dont le recapitulatif dit deja « tout ne tiendra pas : il manque 10 min ».
  // Une activite n est nommee que quand elle est SEULE a pouvoir deborder.
  const finComplete = raw.end + reserve;
  const partiesSansHeure = ((raw.laserPassPlan && raw.laserPassPlan.pendingPasses) || [])
    .map((passe) => Math.trunc(Number(passe && passe.countIndex) || 0))
    .filter((rang) => rang > 0);
  const aDesPartiesALaSuite = raw.end > finReservee;
  const libresNommes = String(reserveLabel || '').split(',').map((part) => part.trim()).filter(Boolean);
  const autreChoseDeLibre = Math.round(Number(reserveMinutes) || 0) > 0
    || (raw.timeline || []).some((etape) => etape && etape.flexible);
  const toutLabel = `Tout ne tiendra pas avant la fermeture (${minutesToTime(window.close)}) : il manque ${formatGapLabel(finComplete - window.close)}`;
  const tropTot = raw.start < (window.anchorStart ?? window.minStart);
  if (tropTot || finReservee + reserve > window.close) {
    // Une heure AVANT l ouverture ne devient jamais « serree » : seul le libre
    // qui deborde apres des activites reservees qui tiennent l est.
    const manqueLeLibre = !tropTot && reserve > 0 && finReservee <= window.close;
    const portee = aDesPartiesALaSuite || libresNommes.length !== 1 ? 'tout' : 'libre';
    const reason = !manqueLeLibre
      ? 'Ces heures ne rentrent pas dans les horaires du centre pour cette formule.'
      : portee === 'tout' ? toutLabel : `Trop tard pour ${libresNommes[0]} avant la fermeture (${minutesToTime(window.close)})`;
    if (!(manqueLeLibre && reserveSoft)) {
      return {
        ok: false,
        // Un code A PART : l heure tient pour les activites reservees, c est le
        // reste de la visite qui ne rentre plus. La raison courte de la grille
        // peut alors nommer ce qui manque au lieu d annoncer une fin d activite.
        code: manqueLeLibre ? 'schedule_free' : 'schedule',
        reserveLabel,
        ...(manqueLeLibre ? { portee, fin: finComplete, parties: partiesSansHeure } : {}),
        reason,
        scenario: null,
      };
    }
    warning = { code: 'schedule_free', reserveLabel, portee, fin: finComplete, parties: partiesSansHeure, reason };
  }
  // LES PARTIES DE LASER A LA SUITE ne ferment jamais une heure : l equipe les
  // place, parfois avant la partie posee. Quand elles depassent la fermeture,
  // l heure reste possible et le dit (le moteur previent, il n interdit pas
  // un choix realisable). Seules a pouvoir deborder (aucune activite libre dans
  // la visite ou la formule), elles sont nommees ; sinon, c est tout.
  if (!warning && finComplete > window.close) {
    const seules = !autreChoseDeLibre && partiesSansHeure.length > 0;
    const quelles = partiesSansHeure.length > 1
      ? `les parties ${partiesSansHeure.slice(0, -1).join(', ')} et ${partiesSansHeure[partiesSansHeure.length - 1]} de laser`
      : partiesSansHeure.length ? `la partie ${partiesSansHeure[0]} de laser` : 'les parties de laser restantes';
    warning = {
      code: 'schedule_free',
      reserveLabel: seules ? quelles : '',
      portee: seules ? 'parties' : 'tout',
      fin: finComplete,
      parties: partiesSansHeure,
      reason: seules ? `Trop tard pour ${quelles} avant la fermeture (${minutesToTime(window.close)})` : toutLabel,
    };
  }

  // Sans heure d arrivee, l arrivee ne passe jamais avant l ouverture
  // (arriveeALOuverture) ; avec elle, c est celle du client.
  const posee = demandeArrivee ? raw : arriveeALOuverture(raw, window.open);
  const decorated = decorateScenario({
    center,
    formula,
    pax,
    date,
    scenario: posee,
    reservations,
    laneStatuses,
    blocks,
    preference,
  });
  decorated.laserPassPlan = raw.laserPassPlan;
  decorated.anchorPlan = raw.anchorPlan;
  decorated.comfortNotices = raw.comfortNotices || [];
  if (Array.isArray(raw.freeGaps)) decorated.freeGaps = raw.freeGaps;
  if (demandeArrivee) decorated.arrivalPlan = raw.arrivalPlan;

  if (!decorated.ok) {
    return {
      ok: false,
      code: 'resource_conflict',
      reason: decorated.conflicts[0]?.message || 'Cette combinaison n’est plus disponible.',
      scenario: decorated,
    };
  }
  // LES BORNES DE L ARRIVEE, en dernier : tout le reste tient. Elles PREVIENNENT,
  // elles ne refusent plus (Movsar, 2026-10-13 : « on peut prendre l heure qu on
  // veut, juste si c est vraiment impossible on peut pas, et si y a un petit
  // probleme tu le notifies mais on peut quand meme cliquer ») : une longue
  // attente ou une longue visite se disent, la visite se reserve. Un avis de
  // fermeture, plus grave, passe devant ; la mesure reste dans `arrival`.
  if (demandeArrivee) {
    const borne = bornesDeLArrivee(raw, demandeArrivee.reglage);
    if (!borne.ok) {
      const avis = { code: borne.code, reason: borne.reason, waitMinutes: borne.waitMinutes, visitMinutes: borne.visitMinutes, maxWaitMinutes: borne.maxWaitMinutes, maxVisitMinutes: borne.maxVisitMinutes };
      return { ok: true, code: '', reason: '', scenario: decorated, arrival: borne, warning: warning || avis };
    }
  }
  return { ok: true, code: '', reason: '', scenario: decorated, ...(warning ? { warning } : {}) };
}

// Rend la capacite restante, ou { ok: false } avec CE QUI MANQUE a la
// premiere vague qui ne passe pas : les places libres de l arene et celles
// qu il faut, ou une autre partie deja lancee a une autre heure.
function anchorLaserCapacity({ center, existingLaserBlocks, start, pax }) {
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
    const before = overlapping.reduce((sum, block) => sum + Number(block.players || block.pax || 0), 0);
    const vague = cursor !== start ? { waveTime: minutesToTime(cursor) } : {};
    if (launchCount > parallelLaunches) return { ok: false, arenaBusy: true, ...vague };
    if (before + wavePlayers > weaponCount) {
      return { ok: false, placesFree: Math.max(0, weaponCount - before), placesNeeded: wavePlayers, arenaPlaces: weaponCount, ...vague };
    }
    cursor = snapLaserLaunch(end);
  }
  const firstOverlap = existingLaserBlocks.filter((block) => overlap(start, start + LASER_GAME_ARENA_MINUTES, block.start, block.end));
  const playersBefore = firstOverlap.reduce((sum, block) => sum + Number(block.players || block.pax || 0), 0);
  return {
    ok: true,
    playersBefore,
    remainingPlaces: Math.max(0, weaponCount - playersBefore - Math.max(...waveSizes, 0)),
    sharedSession: playersBefore > 0,
    waveCount: waveSizes.length,
  };
}

// Combien de pistes sont libres sur TOUTE la plage : le plus grand nombre
// qu allocateLanes accorde encore, par sa propre regle.
function lanesFreeOver(center, laneStatuses, reservations, start, end, availabilityBlocks, dateISO) {
  const total = Number(center.resources.bowling?.laneCount) || 0;
  let libres = 0;
  while (libres < total && allocateLanes(center, laneStatuses, reservations, start, end, libres + 1, availabilityBlocks, dateISO)) libres += 1;
  return libres;
}

// Disponibilité PAR ANCRE pour une formule : la liste des heures possibles de
// chaque ancre (grille :00/:30, capacité vérifiée indépendamment) + une
// combinaison par défaut valide. C'est la matière première des chips côté
// client ; la combinaison choisie est ensuite revalidée en entier.
// UNE SEULE VERITE POUR CHAQUE HEURE DE LA GRILLE (2026-09-03, brief Movsar).
//
// La grille du composeur reimplementait la faisabilite a la main (chevauchement
// avec l autre ancre, fermeture sur l activite SEULE, capacites) et SUPPRIMAIT
// les heures qui ne passaient pas, sans jamais dire pourquoi. Deux mensonges
// mesures en prod le 2026-09-03 : les parties 2 et 3 du laser n occupaient
// aucune place (20:30 propose pour le bowling alors qu il chevauche la 2e
// partie posee a 20:30, refus anchor_overlap au clic), et la fermeture se
// jugeait sur l activite seule quand la validation la juge sur la VISITE
// ENTIERE. Movsar : « ne pas masquer un creneau parce qu une activite ne peut
// pas demarrer la ; determiner si la combinaison complete est possible ; si
// impossible, savoir pourquoi ; si possible, l afficher. »
//
// Ici, chaque heure candidate passe par evaluateAnchoredCombination, la porte
// que la validation, le recapitulatif et le POST empruntent deja : le verdict
// de la grille EST celui de la reservation. L heure candidate remplace
// l heure eventuellement deja retenue pour SA propre activite (elle ne se
// refuse jamais elle-meme), les autres ancres gardent leurs heures retenues,
// et une ancre non retenue est placee automatiquement : collee apres, sinon
// juste avant. Tout vient des horaires du centre (getScheduleWindow) : rien
// n est code en dur, un centre qui change ses heures change le verdict.
function visitFeasibilityAt({ center, formula, model, date, pax, activityId, start, pinnedTimes = {}, pinnedLaserParts = [], reservations = [], laneStatuses = {}, blocks = [], window, reserveMinutes = 0, reserveItems = null, reserveLabel = '', reserveWaitMinutes = 0, reserveSoft = false, deplacement = false, gardeDeVisite = null, arcadeStart = null }) {
  const anchor = model.anchors.find((item) => item.activityId === activityId);
  if (!anchor) return { ok: false, code: 'unknown_anchor', reason: 'Indisponible' };
  const wavesOf = (id) => {
    const players = Number(model.anchors.find((item) => item.activityId === id)?.pax ?? pax);
    if (id === 'laser_game') return splitGroupIntoWaves(players, center.resources.laser?.weaponCount || pax).length;
    // Le bowling scinde prend autant de fois sa duree qu il a de services.
    if (id === 'bowling') {
      const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
      return bowlingConfig ? splitGroupIntoBowlingServices(players, bowlingConfig).length : 0;
    }
    return 1;
  };
  const spanOf = (item) => item.durationMinutes * wavesOf(item.activityId);
  const other = model.anchors.find((item) => item.activityId !== activityId) || null;
  const laserCount = model.anchors.find((item) => item.activityId === 'laser_game')?.count || 1;
  const floorToGrid = (minutes) => Math.floor(minutes / PROGRAM_GRID_MINUTES) * PROGRAM_GRID_MINUTES;
  const earliest = window.anchorStart ?? window.minStart;

  // Les heures retenues, sans celle de l activite candidate.
  const kept = {};
  Object.entries(pinnedTimes).forEach(([id, minutes]) => {
    if (id !== activityId && Number.isFinite(minutes)) kept[id] = minutes;
  });
  const parts = pinnedLaserParts.filter((minutes) => Number.isFinite(minutes)).sort((a, b) => a - b);

  const arrangements = [];
  let partsForReason = parts;
  // PLUS TOT, POUR LAISSER DU TEMPS AU LIBRE. Collee juste avant, l autre
  // activite ne laisse aucun trou ; posee une, deux, trois demi-heures plus
  // tot, elle en laisse un ou le minigolf se joue. Ces essais ne servent que
  // quand c est le temps du libre qui coince (avertissement ou refus
  // `schedule_free`) : une formule du catalogue n a pas de reserve, et un
  // refus de capacite ne se regle pas en reculant l autre activite.
  const reserveBrute = Math.max(0, Math.round(Number(reserveMinutes) || 0));
  const plusTotEssais = [];
  const plusTot = (avant, poser) => {
    for (let k = 1; reserveBrute > 0 && k * PROGRAM_GRID_MINUTES <= reserveBrute + PROGRAM_GRID_MINUTES; k += 1) {
      const minutes = avant - k * PROGRAM_GRID_MINUTES;
      if (minutes < earliest) break;
      plusTotEssais.push(poser(minutes));
    }
  };
  // PLUS LOIN, QUAND RIEN NE TIENT COLLE (Movsar, 2026-09-29 : « je vois
  // complet, mais quand je choisis un horaire ce n est plus complet »). La
  // reservation pose l activite restee libre a la premiere heure possible
  // apres celle du client, sinon a la derniere avant (buildDefaultAnchorTimes),
  // attente comprise : le moteur ne refuse jamais une attente, il la signale.
  // La grille n essayait que les places collees : « laser 14:00 » se disait
  // complet parce que le bowling de 14:30 et celui de 12:30 etaient pris, alors
  // que la reservation posait le bowling a 15:30 (journee reelle du 30/09,
  // 25 joueurs). Memes places, meme ordre que la reservation : apres, puis avant.
  const plusLoinEssais = [];
  const plusLoin = (apres, avant, spanAutre, poser) => {
    for (let minutes = apres + PROGRAM_GRID_MINUTES; minutes + spanAutre <= window.close; minutes += PROGRAM_GRID_MINUTES) plusLoinEssais.push(poser(minutes));
    for (let minutes = avant - PROGRAM_GRID_MINUTES; minutes >= earliest; minutes -= PROGRAM_GRID_MINUTES) plusLoinEssais.push(poser(minutes));
  };
  if (activityId === 'laser_game') {
    // Le candidat est UNE partie de laser : il rejoint les parties deja posees
    // (ou remplace la plus tot quand le compte est atteint). L ancre laser est
    // la partie la plus precoce, comme le tunnel l envoie.
    let next = parts.filter((minutes) => minutes !== start);
    if (next.length >= laserCount) next = next.slice(1);
    // LA RAISON SE LIT SUR LES PARTIES QUI RESTENT, pas sur celle que le
    // candidat remplace. Posee AVANT le `slice`, cette liste gardait la partie
    // sortante : un laser d une seule partie retenu a 13:30, repose a 13:00
    // derriere un bowling de 12:30, se disait « Chevauche Laser Game 13:30 »,
    // c est-a-dire lui-meme, alors que le vrai obstacle etait le bowling. Le
    // formulaire lisait ce conflit comme un « decale », et le clic menait a
    // une combinaison refusee (capture de Movsar, 2026-09-23).
    partsForReason = next;
    next = [...next, start].sort((a, b) => a - b);
    const times = { ...kept, laser_game: next[0] };
    if (other && !Number.isFinite(times[other.activityId])) {
      const poser = (minutes) => arrangements.push({ anchorTimes: { ...times, [other.activityId]: minutes }, laserGameTimes: next });
      const lastEnd = next[next.length - 1] + spanOf(anchor);
      poser(ceilMinutes(lastEnd, PROGRAM_GRID_MINUTES));
      const before = floorToGrid(next[0] - spanOf(other));
      if (before >= earliest) poser(before);
      // Deux parties eloignees (la seconde posee tard, la candidate tot) :
      // l autre activite tient ENTRE les deux. Sans cet essai, toute la grille
      // du laser se disait serree des qu une partie etait posee en soiree
      // (mesure du 2026-09-22 : partie a 22:00, 10:00 annonce comme serre).
      if (next.length > 1) {
        const entre = ceilMinutes(next[0] + spanOf(anchor), PROGRAM_GRID_MINUTES);
        if (entre + spanOf(other) <= next[next.length - 1]) poser(entre);
      }
      plusTot(before, (minutes) => ({ anchorTimes: { ...times, [other.activityId]: minutes }, laserGameTimes: next }));
      plusLoin(ceilMinutes(lastEnd, PROGRAM_GRID_MINUTES), before, spanOf(other), (minutes) => ({ anchorTimes: { ...times, [other.activityId]: minutes }, laserGameTimes: next }));
    } else {
      arrangements.push({ anchorTimes: times, laserGameTimes: next });
    }
  } else {
    const times = { ...kept, [activityId]: start };
    const laserPinned = Number.isFinite(times.laser_game) || parts.length > 0;
    if (laserPinned) {
      if (!Number.isFinite(times.laser_game)) times.laser_game = parts[0];
      arrangements.push({ anchorTimes: times, laserGameTimes: parts });
    } else if (other) {
      const after = ceilMinutes(start + spanOf(anchor), PROGRAM_GRID_MINUTES);
      arrangements.push({ anchorTimes: { ...times, [other.activityId]: after }, laserGameTimes: [] });
      const before = floorToGrid(start - spanOf(other));
      if (before >= earliest) arrangements.push({ anchorTimes: { ...times, [other.activityId]: before }, laserGameTimes: [] });
      plusTot(before, (minutes) => ({ anchorTimes: { ...times, [other.activityId]: minutes }, laserGameTimes: [] }));
      plusLoin(after, before, spanOf(other), (minutes) => ({ anchorTimes: { ...times, [other.activityId]: minutes }, laserGameTimes: [] }));
    } else {
      arrangements.push({ anchorTimes: times, laserGameTimes: [] });
    }
  }

  // La borne de fin que la visite doit respecter : la fermeture du centre, ou
  // la limite horaire propre a la formule quand elle est plus tot.
  const limit = formula?.timeLimit?.max
    ? Math.min(window.close, timeToMinutes(formula.timeLimit.max))
    : window.close;
  let firstFailure = null;
  let avertie = null;
  let libreEnCause = false;
  let arcadeEnCause = false;
  const essais = arrangements.concat(plusTotEssais);
  for (let index = 0; index < essais.length; index += 1) {
    if (index >= arrangements.length && !libreEnCause) break;
    const arrangement = essais[index];
    const result = evaluateAnchoredCombination({
      center,
      formula,
      date,
      pax,
      anchorTimes: arrangement.anchorTimes,
      laserPlacement: 'scheduled',
      reserveMinutes,
      reserveItems,
      reserveLabel,
      reserveWaitMinutes,
      reserveSoft,
      reservations,
      laneStatuses,
      blocks,
      laserGameTimes: arrangement.laserGameTimes,
      arcadeStart,
    });
    if (result.ok) {
      // UNE INSTALLATION COMPTEE (pistes de duckpin, tables de billard) se
      // juge sur la visite que CE plan pose, par la garde de la validation que
      // l appelant fournit : sans elle, l heure se disait libre et la
      // validation la refusait ensuite (campagne du 2026-09-29 : 12:00
      // « propose », « rien ne coince », puis « Duckpin complet »).
      const pleine = typeof gardeDeVisite === 'function' ? gardeDeVisite(result.scenario) : '';
      if (pleine) {
        if (!firstFailure) firstFailure = { code: 'capacity', reason: `${pleine} complet` };
        continue;
      }
      if (!result.warning) return { ok: true, code: '', reason: '', endTime: result.scenario?.endTime || '' };
      // En mode souple, un arrangement qui tient sans avertissement l emporte
      // sur celui qui en porte un : on garde le premier averti et on continue.
      if (!avertie) avertie = result;
      libreEnCause = true;
      continue;
    }
    if (result.code === 'schedule_free') libreEnCause = true;
    if (result.code === 'arcade_overlap') arcadeEnCause = true;
    if (!firstFailure) firstFailure = result;
  }
  // Rien de colle ne tient SANS AVERTISSEMENT : les places plus loin, dans
  // l ordre de la reservation. Une place sans avertissement l emporte, sinon la
  // premiere avertie (collee d abord). La raison d un refus reste celle des
  // places collees. Chercher plus loin MEME quand une place collee tient avec
  // un avertissement (mesure du 2026-09-30, FORMULE 4 : bowling 19:30 « serre »
  // parce que le laser colle a 19:00 poussait la fin a 22:05, bowling 20:00
  // « libre » avec le laser a 18:30 ; la reservation de 19:30 posait deja le
  // laser a 18:30, sans avertissement : la grille disait l inverse du plan).
  {
    for (const arrangement of plusLoinEssais) {
      const result = evaluateAnchoredCombination({
        center,
        formula,
        date,
        pax,
        anchorTimes: arrangement.anchorTimes,
        laserPlacement: 'scheduled',
        reserveMinutes,
        reserveItems,
        reserveLabel,
        reserveWaitMinutes,
        reserveSoft,
        reservations,
        laneStatuses,
        blocks,
        laserGameTimes: arrangement.laserGameTimes,
        arcadeStart,
      });
      if (!result.ok) {
        if (result.code === 'arcade_overlap') arcadeEnCause = true;
        continue;
      }
      if (typeof gardeDeVisite === 'function' && gardeDeVisite(result.scenario)) continue;
      if (!result.warning) return { ok: true, code: '', reason: '', endTime: result.scenario?.endTime || '' };
      if (!avertie) avertie = result;
    }
  }
  if (avertie) {
    // L avertissement de la reserve voyage avec sa raison COURTE (la meme
    // phrase que le refus d avant), pour l ecran.
    const warning = { code: avertie.warning.code, reason: shortFeasibilityReason(avertie.warning, { anchor, start, spanOf, pinnedTimes: kept, pinnedLaserParts: partsForReason, model, limit }).reason };
    return { ok: true, code: '', reason: '', endTime: avertie.scenario?.endTime || '', warning };
  }
  // LES ARCADES CHOISIES NE FERMENT AUCUNE HEURE (modele A, 2026-10-13 : le
  // dernier choix gagne). Une heure que seules les arcades posees empechent
  // se prend : elle les decale, et l entree le dit (`conflict` : les arcades,
  // a leur heure). Elle se juge sans elles ; ce qu elle y refuse reste refuse.
  if (arcadeEnCause && Number.isFinite(arcadeStart)) {
    const sansArcade = visitFeasibilityAt({
      center, formula, model, date, pax, activityId, start, pinnedTimes, pinnedLaserParts,
      reservations, laneStatuses, blocks, window, reserveMinutes, reserveItems, reserveLabel, reserveWaitMinutes, reserveSoft,
      deplacement, gardeDeVisite,
    });
    if (!sansArcade.ok) return sansArcade;
    const arcade = fenetreDesArcades(center, model, arcadeStart);
    const nom = (arcade ? arcade.label : 'Arcades').toLowerCase();
    const pendant = Boolean(arcade) && overlap(start, start + spanOf(anchor), arcade.start, arcade.end);
    return {
      ok: false,
      code: 'arcade_overlap',
      reason: pendant
        ? `Pendant vos ${nom} (${minutesToTime(arcadeStart)}) : la prendre décale vos ${nom}`
        : `La prendre décale vos ${nom} (${minutesToTime(arcadeStart)})`,
      conflict: { activityId: arcade ? arcade.activityId : 'arcade_time', label: arcade ? arcade.label : 'Arcades', time: minutesToTime(arcadeStart) },
      ...(sansArcade.endTime ? { endTime: sansArcade.endTime } : {}),
      ...(sansArcade.warning ? { warning: sansArcade.warning } : {}),
    };
  }
  const failure = firstFailure || { code: 'schedule', reason: '' };
  const court = shortFeasibilityReason(failure, { anchor, start, spanOf, pinnedTimes: kept, pinnedLaserParts: partsForReason, model, limit });
  const refus = {
    ok: false,
    code: failure.code || 'schedule',
    reason: court.reason,
    conflict: court.conflict,
  };
  // UNE HEURE QUI CHEVAUCHE L UNE DE SES PROPRES PARTIES PEUT LA DEPLACER
  // (Movsar, 2026-09-24 : « pourquoi il y a "pris", impossible a prendre,
  // c est pas normal »). Jugee comme une partie EN PLUS, l heure chevauche
  // une partie deja posee : c est la seule lecture impossible du geste. La
  // lecture realisable, c est que CETTE partie-la aille a l heure touchee.
  // Son verdict, juge par la meme porte, voyage a cote du refus (`move`) :
  // le refus ne change pas, un ecran qui ajoute toujours une partie (le
  // tunnel) le lit comme avant ; le formulaire Fun Galaxy, lui, deplace.
  if (!deplacement && activityId === 'laser_game' && laserCount > 1 && refus.code === 'anchor_overlap'
    && refus.conflict && refus.conflict.activityId === 'laser_game' && refus.conflict.time) {
    // La partie deplacee : celle dont un groupe joue deja a cette heure (le
    // toucher la fait partir la), sinon celle que l heure chevauche.
    const couvrante = parts.find((minutes) => minutes <= start && start < minutes + spanOf(anchor));
    const remplacee = Number.isFinite(couvrante) ? couvrante : timeToMinutes(refus.conflict.time);
    const verdict = visitFeasibilityAt({
      center, formula, model, date, pax, activityId, start, pinnedTimes,
      pinnedLaserParts: parts.filter((minutes) => minutes !== remplacee),
      reservations, laneStatuses, blocks, window, reserveMinutes, reserveItems, reserveLabel, reserveWaitMinutes, reserveSoft,
      deplacement: true,
      gardeDeVisite,
      arcadeStart,
    });
    refus.move = {
      replaces: minutesToTime(remplacee),
      ok: verdict.ok,
      ...(verdict.ok ? {} : { code: verdict.code, reason: verdict.reason }),
      ...(verdict.conflict ? { conflict: verdict.conflict } : {}),
      ...(verdict.warning ? { warning: verdict.warning } : {}),
    };
  }
  return refus;
}

// La raison COURTE d une heure impossible, lisible sur un telephone, sans
// paragraphe (Movsar : « tres court, lisible, non intrusif »). Elle nomme ce
// qui est chevauche quand c est un chevauchement, sinon la borne en cause.
// Elle rend { reason, conflict } : `conflict` nomme l activite chevauchee
// (identifiant, libelle, heure) quand c en est une, sinon null.
function shortFeasibilityReason(failure, { anchor, start, spanOf, pinnedTimes, pinnedLaserParts, model, limit }) {
  const code = failure.code || '';
  if (code === 'anchor_overlap') {
    const end = start + spanOf(anchor);
    const windows = [];
    Object.entries(pinnedTimes).forEach(([id, minutes]) => {
      const item = model.anchors.find((candidate) => candidate.activityId === id);
      if (item && Number.isFinite(minutes)) windows.push({ activityId: id, label: item.label, start: minutes, end: minutes + spanOf(item) });
    });
    const laser = model.anchors.find((candidate) => candidate.activityId === 'laser_game');
    if (laser) {
      pinnedLaserParts.forEach((minutes, index) => windows.push({
        activityId: laser.activityId,
        label: pinnedLaserParts.length > 1 ? `${laser.label} (partie ${index + 1})` : laser.label,
        start: minutes,
        end: minutes + spanOf(laser),
      }));
    }
    // LE CHEVAUCHEMENT QU ON NE PEUT PAS DEPLACER SE NOMME EN PREMIER. Le
    // tunnel lit `conflict.activityId` : quand il designe une AUTRE activite,
    // il propose « On decale » et laisse prendre l heure. Un chevauchement avec
    // une partie de laser DU MEME GROUPE ne se libere par aucun decalage, c est
    // le groupe lui-meme qui occupe l arene. `find` rendait le premier de la
    // liste, ou les autres ancres passent avant les parties de laser : un
    // groupe de 49 (2 vagues) s est vu offrir 10:30 avec « Bowling se decale »
    // alors que sa propre seconde vague y etait deja (mesure du 2026-09-18).
    const chevauche = (item) => overlap(start, end, item.start, item.end);
    const hit = windows.find((item) => item.activityId === anchor.activityId && chevauche(item))
      || windows.find(chevauche);
    if (hit) {
      return {
        reason: `Chevauche ${hit.label} ${minutesToTime(hit.start)}`,
        conflict: { activityId: hit.activityId || '', label: hit.label, time: minutesToTime(hit.start) },
      };
    }
    return { reason: 'Chevauche une autre activité', conflict: null };
  }
  // « Fin apres 22:00 » : c est la VISITE entiere qui finirait apres la borne,
  // pas seulement cette activite. Court, et la borne vient des horaires du
  // centre (editables) : rien de code en dur.
  if (code === 'schedule') {
    if (!Number.isFinite(limit)) return { reason: 'Fin après la fermeture', conflict: null };
    return { reason: `Fin après ${limit >= 24 * 60 ? 'minuit' : minutesToTime(limit)}`, conflict: null };
  }
  // LE TEMPS DES ACTIVITES LIBRES (entretien Seb, 2026-09-17) : a cette heure
  // les activites reservees tiennent, c est le RESTE de la visite qui ne rentre
  // plus avant la fermeture. « Fin apres 22:00 » sur une heure ou le bowling
  // finit a 21:00 se lirait comme une erreur du site : on nomme ce qui manque.
  if (code === 'schedule_free') {
    const borne = Number.isFinite(limit) ? (limit >= 24 * 60 ? 'minuit' : minutesToTime(limit)) : 'la fermeture';
    // « Tout ne tiendra pas » : la fin complete de la visite contre la borne,
    // la meme phrase que le recapitulatif. Sans fin connue, l ancienne.
    const manque = Number.isFinite(Number(failure.fin)) && Number.isFinite(limit) ? Math.round(Number(failure.fin) - limit) : 0;
    const tout = manque > 0 ? `Tout ne tiendra pas avant ${borne} : il manque ${formatGapLabel(manque)}` : `Plus le temps pour tout avant ${borne}`;
    if (failure.portee === 'tout') return { reason: tout, conflict: null };
    if (failure.portee === 'parties') return { reason: `Plus le temps pour ${failure.reserveLabel || 'les parties de laser restantes'} avant ${borne}`, conflict: null };
    const libres = String(failure.reserveLabel || '').split(',').map((part) => part.trim()).filter(Boolean);
    if (libres.length !== 1) return { reason: tout, conflict: null };
    // Le premier mot suffit quand il porte deja le nom (« Minigolf
    // Blacklight » -> « Minigolf ») ; sinon le nom entier, sans le tronquer
    // (« Fun Run by PIXEL » ne se lit pas « Fun »).
    const mots = libres[0].split(/\s+/).filter(Boolean);
    const nom = (mots[0] || '').length >= 4 ? mots[0] : libres[0];
    return { reason: `Plus le temps pour ${nom} avant ${borne}`, conflict: null };
  }
  if (code === 'resource_conflict') return { reason: 'Complet', conflict: null };
  if (failure.reason) return { reason: failure.reason, conflict: null };
  return { reason: 'Indisponible', conflict: null };
}

function getFormulaAnchorAvailability(input, context = {}) {
  const center = getCenter(input.centerId || 'libramont');
  // Meme porte d'entree que planFormula : un document fourni par l'appelant
  // (visite composee par le client) court-circuite la resolution par id. La
  // variante choisie (`formulaChoice`, lib/formula-choice) se joue dessus.
  const formuleBrute = (input.formula && typeof input.formula === 'object')
    ? input.formula
    : getFormula(input.formuleId || input.formulaId);
  const formula = formuleAvecChoix(formuleBrute, varianteDemandee(formuleBrute && formuleBrute.id, input.formulaChoice));
  const date = normalizeDate(input.date);
  const pax = Math.max(1, Number(input.pax || 1));
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
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
  if (model.anchors.some((anchor) => anchor.activityId === 'bowling') && !bowlingConfig) {
    return { ...base, ok: false, reason: 'Aucune piste de bowling exploitable ce jour-là.' };
  }

  // Reserve de temps des activites LIBRES de la visite composee par le client
  // (aucune pour une formule du catalogue : 0, rien ne change).
  const reserveMinutes = Math.max(0, Math.round(Number(input.reserveMinutes) || 0));
  // Les lignes sans heure, chacune son morceau (piecesDuLibre, 2026-10-14).
  const reserveItems = Array.isArray(input.reserveItems) ? input.reserveItems : null;
  const reserveLabel = String(input.reserveLabel || '').trim();
  const reserveWaitMinutes = Math.max(0, Math.round(Number(input.reserveWaitMinutes) || 0));
  const reserveSoft = Boolean(input.reserveSoft);
  // L heure d arcade choisie (modele A, 2026-10-13) : chaque heure se juge avec
  // elle, les heures proposees se posent autour.
  const arcadeStart = heureDArcade(input.arcadeTime);
  const estimated = estimateFormulaMinutes(center, formula, pax, 0, bowlingConfig);
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

  // LES HEURES DEJA RETENUES OCCUPENT LEUR PLACE (2026-08-31), et depuis le
  // 2026-09-03 les PARTIES de laser deja posees aussi (mesure prod : la 2e
  // partie a 20:30 ne retirait rien au bowling, refus au clic). Une heure
  // retenue par ancre (preferredTimes) + toutes les parties (laserGameTimes),
  // en minutes : c est ce que visitFeasibilityAt tient pour acquis quand il
  // juge chaque candidat.
  const voulues = (input.preferredTimes && typeof input.preferredTimes === 'object') ? input.preferredTimes : {};
  const pinnedTimes = {};
  model.anchors.forEach((anchor) => {
    const brut = voulues[anchor.activityId];
    if (typeof brut !== 'string' || !/^\d{2}:\d{2}/.test(brut)) return;
    pinnedTimes[anchor.activityId] = timeToMinutes(brut.slice(0, 5));
  });
  const pinnedLaserParts = (Array.isArray(input.laserGameTimes) ? input.laserGameTimes : [])
    .map((brut) => (typeof brut === 'string' && /^\d{2}:\d{2}/.test(brut) ? timeToMinutes(brut.slice(0, 5)) : null))
    .filter((minutes) => Number.isFinite(minutes))
    .sort((left, right) => left - right);

  const candidatesByActivity = {};
  base.activities = model.anchors.map((anchor) => {
    const anchorPax = Number(anchor.pax ?? pax);
    const times = [];
    // anchorStart : l ouverture (bornes dures comprises), pas l accueil.
    const firstGridStart = ceilMinutes(window.anchorStart ?? window.minStart, PROGRAM_GRID_MINUTES);
    // TOUTES les heures de la journee jusqu a la fermeture sont rendues :
    // celles qui ne tiennent pas portent { ok:false, code, reason } au lieu
    // de disparaitre. Le client les montre grisees avec leur raison, les
    // defauts et les suggestions ne lisent que les heures ok.
    for (let start = firstGridStart; start < window.close; start += PROGRAM_GRID_MINUTES) {
      const time = minutesToTime(start);
      // `extra` porte CE QUI CHEVAUCHE : le tunnel propose alors de decaler
      // cette activite-la au lieu de fermer l heure (entretien Seb, 2026-09-17).
      const ko = (code, reason, extra = null) => ({ time, ok: false, code, reason, ...(extra || {}) });
      let entry = null;
      let meta = {};
      if (anchor.activityId === 'bowling') {
        // Activite bowling bloquee (scope 'activity') sur la fenetre de l'ancre.
        // La piste bloquee (scope 'lane') est geree par allocateLanes.
        // TOUTE LA PLACE DU BOWLING, services compris : un blocage pose sur le
        // second service fermait autrefois une heure que rien n examinait.
        const services = bowlingConfig ? splitGroupIntoBowlingServices(anchorPax, bowlingConfig) : [];
        const finTotale = start + anchor.durationMinutes * services.length;
        if (isActivityBlockedAt(availabilityBlocks, date, 'bowling', start, finTotale)) {
          entry = ko('blocked', 'Indisponible');
        } else {
          // CHAQUE SERVICE DOIT TROUVER SES PISTES, pas seulement le premier :
          // proposer une heure ou la seconde moitie du groupe n a pas de piste
          // serait exactement le « tu laisses sous entendre quon peut alors que
          // non » de Movsar.
          //
          // LE « COMPLET » DIT SON CALCUL (Movsar, 2026-09-30 : « faut montrer
          // que 6 joueurs max par piste donc vous avez besoin de x pistes ») :
          // les joueurs par piste de la regle appliquee, les pistes qu il faut
          // au groupe (a son service qui coince) et celles qui restent libres.
          let curseur = start;
          let premieres = null;
          let manque = null;
          services.forEach((joueurs) => {
            if (manque) return;
            const fin = curseur + anchor.durationMinutes;
            const requises = getRequiredLaneCount(center, joueurs, { bowlingConfig });
            const allocation = allocateBowlingCapacity({ players: joueurs, config: bowlingConfig, requiredLanes: requises,
              durationMinutes: anchor.durationMinutes, games: anchor.games,
              allocate: (count) => allocateLanes(center, laneStatuses, reservations, curseur, fin, count, availabilityBlocks, date) });
            const trouvees = allocation?.lanes || null;
            if (!trouvees) {
              const normale = Number(bowlingConfig.normalCapacityPerLane) || 0;
              manque = {
                lanesNeeded: requises,
                lanesFree: lanesFreeOver(center, laneStatuses, reservations, curseur, fin, availabilityBlocks, date),
                playersPerLane: Math.ceil(joueurs / Math.max(1, requises)) > normale
                  ? Number(bowlingConfig.emergencyCapacityPerLane) || normale
                  : normale,
                ...(services.length > 1 ? { servicePlayers: joueurs, serviceCount: services.length } : {}),
                ...(curseur !== start ? { serviceTime: minutesToTime(curseur) } : {}),
              };
              return;
            }
            if (!premieres) premieres = trouvees;
            curseur = fin;
          });
          if (manque) entry = ko('capacity', 'Complet', manque);
          else meta = { lanes: premieres };
        }
      } else if (isActivityBlockedAt(availabilityBlocks, date, 'laser_game', start, start + anchor.durationMinutes)) {
        // Activite laser bloquee (scope 'activity') sur la fenetre.
        entry = ko('blocked', 'Indisponible');
      } else {
        // Le « Complet » de l arene dit ses places : libres, et celles qu il
        // faut au groupe (ou l autre partie deja lancee).
        const capacity = anchorLaserCapacity({ center, existingLaserBlocks, start, pax: anchorPax });
        if (!capacity.ok) {
          const { ok: _refus, ...manque } = capacity;
          entry = ko('capacity', 'Complet', manque);
        } else meta = { remainingPlaces: capacity.remainingPlaces, sharedSession: capacity.sharedSession, waveCount: capacity.waveCount };
      }
      if (!entry) {
        // LE VERDICT DE LA GRILLE EST CELUI DE LA RESERVATION (visitFeasibilityAt).
        const verdict = visitFeasibilityAt({
          center, formula, model, date, pax,
          reserveMinutes,
          reserveItems,
          reserveLabel,
          reserveWaitMinutes,
          reserveSoft,
          activityId: anchor.activityId,
          start,
          pinnedTimes,
          pinnedLaserParts,
          reservations,
          laneStatuses,
          blocks: availabilityBlocks,
          window,
          gardeDeVisite: typeof input.gardeDeVisite === 'function' ? input.gardeDeVisite : null,
          arcadeStart,
        });
        entry = verdict.ok
          ? { time, ok: true, ...meta, ...(verdict.warning ? { warning: verdict.warning } : {}) }
          : ko(verdict.code, verdict.reason, {
            ...(verdict.conflict ? { conflict: verdict.conflict } : {}),
            // Le deplacement de la partie chevauchee (voir visitFeasibilityAt).
            ...(verdict.move ? { move: verdict.move } : {}),
          });
      }
      times.push(entry);
    }
    // Les heures proposees d office viennent des heures SANS avertissement
    // quand il en reste : le serveur ne propose jamais de lui-meme une heure
    // qui laisse trop peu de temps pour le reste de la visite.
    const sansAvertissement = times.filter((item) => item.ok !== false && !item.warning);
    candidatesByActivity[anchor.activityId] = (sansAvertissement.length ? sansAvertissement : times.filter((item) => item.ok !== false)).map((item) => timeToMinutes(item.time));
    return {
      activityId: anchor.activityId,
      label: anchor.label,
      count: anchor.count,
      participants: anchorPax,
      durationMinutes: anchor.durationMinutes,
      times,
    };
  });

  if (base.activities.some((activity) => !activity.times.some((item) => item.ok !== false))) {
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
    // UNE HEURE DEJA RETENUE COMMANDE LE DEFAUT (entretien Seb, 2026-09-17).
    // Sans elle, l ancre restee libre repartait de la premiere heure de la
    // journee : le client qui deplacait le laser a 14:00 voyait son bowling
    // atterrir a 10:00, soit 3 h d attente qu il n avait pas demandees.
    pinned: pinnedTimes,
    arcadeStart,
  });
  if (defaults) {
    base.defaultTimes = Object.fromEntries(Object.entries(defaults).map(([activityId, minutes]) => [activityId, minutesToTime(minutes)]));
  }
  return base;
}

// Combinaison par défaut (zéro friction) : première heure valide de la
// première ancre, puis chaque ancre suivante calée juste après. Peut partir
// d'une heure de première ancre imposée (liste des départs proposés).
function buildDefaultAnchorTimes({ center, formula, date, pax, model, candidatesByActivity, reservations, laneStatuses, blocks = [], firstStart = null, pinned = {}, arcadeStart = null }) {
  const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
  const anchorIds = model.anchors.map((anchor) => anchor.activityId);
  if (!anchorIds.length) return null;
  // La place que prend une ancre : sa duree, multipliee par ses vagues pour le
  // laser (meme calcul que la boucle par defaut ci-dessous).
  const placeDe = (activityId) => {
    const anchor = model.anchors.find((item) => item.activityId === activityId);
    if (!anchor) return 0;
    const players = Number(anchor.pax ?? pax);
    const vagues = activityId === 'laser_game'
      ? splitGroupIntoWaves(players, center.resources.laser?.weaponCount || pax).length
      : activityId === 'bowling'
        ? (bowlingConfig ? splitGroupIntoBowlingServices(players, bowlingConfig).length : 0)
        : 1;
    return anchor.durationMinutes * vagues;
  };
  // LES ARCADES CHOISIES (modele A, 2026-10-13) gardent leur plage : aucune
  // heure proposee ne s y pose. Quand le client n a retenu aucune activite,
  // ce sont elles qui commandent : les activites s enchainent apres elles,
  // sinon finissent juste avant.
  const arcade = fenetreDesArcades(center, model, arcadeStart);
  const libre = (debut, activityId) => !arcade || !overlap(debut, debut + placeDe(activityId), arcade.start, arcade.end);
  const juger = (anchorTimes) => evaluateAnchoredCombination({
    center,
    formula,
    date,
    pax,
    anchorTimes,
    laserPlacement: 'scheduled',
    reservations,
    laneStatuses,
    blocks,
    arcadeStart,
  });
  // AUTOUR DE L HEURE DEJA RETENUE, quand il y en a une : les ancres libres
  // s enchainent apres elle, sinon se posent juste avant. La combinaison passe
  // la meme porte que toutes les autres ; si rien ne tient, pas de defaut du
  // tout (l equipe placera l activite) plutot qu un defaut absurde.
  const retenues = {};
  Object.entries(pinned || {}).forEach(([activityId, minutes]) => {
    if (anchorIds.includes(activityId) && Number.isFinite(minutes)) retenues[activityId] = minutes;
  });
  const ancre = anchorIds.find((activityId) => Number.isFinite(retenues[activityId]));
  // Il faut ENCORE QUELQUE CHOSE A PLACER. Quand le client a deja choisi toutes
  // ses heures, ce champ n a plus rien a completer : il redevient la proposition
  // enchainee que le tunnel affiche par defaut, et ne renvoie pas au client sa
  // propre saisie en la nommant « defaut » (run-ops-tests verifie ce contrat).
  const resteAPlacer = anchorIds.some((activityId) => !Number.isFinite(retenues[activityId]));
  if (ancre && resteAPlacer && firstStart === null) {
    const anchorTimes = { ...retenues };
    let cursor = retenues[ancre] + placeDe(ancre);
    for (const activityId of anchorIds) {
      if (Number.isFinite(anchorTimes[activityId])) continue;
      const candidats = (candidatesByActivity[activityId] || []).filter((candidate) => libre(candidate, activityId));
      const apres = candidats.find((candidate) => candidate >= cursor);
      const avant = [...candidats].reverse().find((candidate) => candidate + placeDe(activityId) <= retenues[ancre]);
      const choisi = apres !== undefined ? apres : avant;
      if (choisi === undefined) return null;
      anchorTimes[activityId] = choisi;
      cursor = Math.max(cursor, choisi + placeDe(activityId));
    }
    return juger(anchorTimes).ok ? anchorTimes : null;
  }
  if (!ancre && arcade && firstStart === null) {
    const essais = [];
    const apres = {};
    let cursor = arcade.end;
    for (const activityId of anchorIds) {
      const choisi = (candidatesByActivity[activityId] || []).find((candidate) => candidate >= cursor && libre(candidate, activityId));
      if (choisi === undefined) break;
      apres[activityId] = choisi;
      cursor = choisi + placeDe(activityId);
    }
    if (Object.keys(apres).length === anchorIds.length) essais.push(apres);
    const avant = {};
    let borne = arcade.start;
    for (const activityId of [...anchorIds].reverse()) {
      const choisi = [...(candidatesByActivity[activityId] || [])].reverse().find((candidate) => candidate + placeDe(activityId) <= borne);
      if (choisi === undefined) break;
      avant[activityId] = choisi;
      borne = choisi;
    }
    if (Object.keys(avant).length === anchorIds.length) essais.push(avant);
    const retenu = essais.find((anchorTimes) => juger(anchorTimes).ok);
    if (retenu) return retenu;
  }
  const firstId = anchorIds[0];
  const firstCandidates = (candidatesByActivity[firstId] || [])
    .filter((start) => (firstStart === null || start === firstStart) && libre(start, firstId));

  for (const start of firstCandidates) {
    const anchorTimes = { [firstId]: start };
    // `placeDe` porte deja la regle des vagues ET des services : la recopier
    // ici en la limitant au laser est ce qui aurait laisse le second service de
    // bowling sans place.
    let cursor = start + placeDe(firstId);
    let feasible = true;
    for (let index = 1; index < anchorIds.length; index += 1) {
      const anchorId = anchorIds[index];
      // >= cursor, sans marge : le premier plan propose enchaine. Avec
      // + TRANSITION_MINUTES, le candidat colle (grille de 30) etait saute
      // et le defaut posait 30 minutes d attente entre les deux activites.
      const next = (candidatesByActivity[anchorId] || []).find((candidate) => candidate >= cursor && libre(candidate, anchorId));
      if (next === undefined) {
        feasible = false;
        break;
      }
      anchorTimes[anchorId] = next;
      cursor = next + placeDe(anchorId);
    }
    if (!feasible) continue;
    if (juger(anchorTimes).ok) return anchorTimes;
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
      .filter((item) => item.ok !== false)
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

// LES ARCADES SUR UNE ACTIVITE POSEE (modele A, 2026-10-13) : l activite que
// le client a posee et que des arcades a `arcadeStart` (minutes)
// chevaucheraient, { activityId, label, time }, sinon null. Les heures posees
// seules se composent, les autres ancres loin dans la journee : la meme
// composition que la reservation, sans rien juger d autre.
function arcadesHeurtentLesPosees({ center, formula, pax, laneStatuses = {}, preference = {}, arcadeStart }) {
  const model = getFormulaAnchorModel(formula);
  if (!model.anchors.length || !Number.isFinite(arcadeStart)) return null;
  const posees = normalizeAnchorPreference(preference);
  const laserTenu = Number.isFinite(posees.anchorTimes.laser_game)
    || (Array.isArray(preference.laserGameTimes) && preference.laserGameTimes.some(Boolean))
    || posees.laserPlacement === 'onsite';
  const heures = { ...posees.anchorTimes };
  let loin = 0;
  model.anchors.forEach((anchor) => {
    const tenue = anchor.activityId === 'laser_game' ? laserTenu : Number.isFinite(heures[anchor.activityId]);
    if (tenue) return;
    loin += 1;
    heures[anchor.activityId] = (48 + 24 * loin) * 60;
  });
  const raw = composeAnchoredFormulaScenario({
    center,
    formula,
    pax,
    anchorTimes: heures,
    laserPlacement: posees.laserPlacement,
    laserGameTimes: laserTenu ? posees.laserGameTimes : [],
    bowlingConfig: getOperationalBowlingConfig(center, laneStatuses),
    arcadeStart,
  });
  return !raw.ok && raw.code === 'arcade_overlap' && raw.conflict ? raw.conflict : null;
}

// Planification d'une formule en mode « Ancres + Liberté » : le client a fixé
// ses heures par ancre (ou choisi le laser « sur place »), le serveur
// revalide toute la combinaison et refuse clairement sinon.
function planFormulaWithAnchors(input, context, { center, formula, date, pax, preference }) {
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
  const { anchorTimes, laserPlacement, laserGameTimes, arcadeStart } = normalizeAnchorPreference(preference);
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
    preferredLanes: Array.isArray(input.lanes) ? input.lanes : [],
    laserGameTimes,
    arcadeStart,
  });

  const scenarios = result.scenario ? [result.scenario] : [];
  return {
    ok: result.ok,
    reason: result.ok ? '' : result.reason,
    refusalCode: result.ok ? '' : result.code,
    // L activite en cause d un refus de composition (des arcades posees sur le
    // bowling) : la liste des heures d arcade sait laquelle elle libere.
    ...(result.ok || !result.conflict ? {} : { refusalConflict: result.conflict }),
    type: 'formule',
    centerId: center.id,
    date,
    formulaId: formula.id,
    formulaName: formula.name,
    pax,
    requestedStartTime: input.startTime || (result.scenario ? result.scenario.startTime : null),
    recommended: result.ok ? result.scenario : (result.scenario || null),
    scenarios,
    validationMode: modeValidationFormule(formula, center && center.id),
    // `context.sansSuggestions` : un appelant qui juge des heures une a une (la
    // liste des heures d arcade) ne lit pas les suggestions, une grille entiere
    // par refus.
    anchorSuggestions: result.ok || context.sansSuggestions ? [] : suggestAnchorCombinations({
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

// L HEURE D ARRIVEE CHOISIT LA COMBINAISON (2026-10-12).
//
// Le client donne l heure ou son groupe arrive. Le moteur cherche les heures du
// bowling et du laser a partir d elle, dans les DEUX ordres, et chaque
// combinaison passe par LA porte (evaluateAnchoredCombination, avec
// l arrivee), celle de la grille, du POST et des complements. Parmi celles qui
// passent : la visite qui finit le plus tot, puis celle qui attend le moins,
// puis l ordre habituel (bowling avant laser), puis les ancres au plus tot (le
// groupe les joue des qu elles sont libres). Une heure deja posee par le
// client (preferredTimes, laserGameTimes)
// reste la sienne : seules les autres se cherchent. Les parties de laser apres
// la premiere se jouent a la suite, comme dans la combinaison proposee d office.
//
// Les bornes du centre (attente, duree) ne refusent plus rien (2026-10-13) :
// la visite qui les respecte est proposee d abord ; sinon, celle qui fait le
// moins attendre, avec son avis et pourquoi (ce qui est complet et jusqu a
// quand). Seul l impossible refuse : tout est pris, ou plus rien ne tient avant
// la fermeture, ou une regle de la formule. `memo` (une Map, facultative) garde
// le temps d une requete le verdict sans arrivee d une combinaison : il ne
// depend pas de l heure d arrivee.
const CODES_RESSOURCES = new Set(['resource_conflict', 'capacity', 'blocked']);

function raisonCourteArrivee(code, details = {}) {
  if (code === 'arrival_full' || CODES_RESSOURCES.has(code)) return 'Complet';
  if (code === 'arrival_disabled') return 'Non proposé par le centre';
  if (code === 'off_grid' || code === 'arrival_invalid') return 'Heure non valable';
  if (code === 'no_anchor') return 'Sans activité à heure fixe';
  if (code === 'schedule' || code === 'schedule_free') return 'Ne tient pas avant la fermeture';
  const texte = String(details.reason || '');
  return texte && texte.length <= 60 ? texte : 'Indisponible';
}

function refusArrivee(time, code, reason, extra = {}) {
  return { ok: false, time, code, reason, shortReason: raisonCourteArrivee(code, { reason, ...extra }), result: null, ...extra };
}

// « Bowling et Laser Game sont complets jusqu a 12:00 » : les activites a heure
// fixe qu aucune combinaison possible ne pose avant l heure dite.
function phraseDesComplets(tardives) {
  if (!tardives.length) return '';
  const memeHeure = tardives.every((item) => item.heure === tardives[0].heure);
  if (memeHeure) {
    const noms = tardives.map((item) => item.label);
    const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0];
    return `${liste} ${noms.length > 1 ? 'sont complets' : 'est complet'} jusqu’à ${minutesToTime(tardives[0].heure)}`;
  }
  return tardives
    .map((item, index) => (index === 0 ? `${item.label} est complet jusqu’à ${minutesToTime(item.heure)}` : `${item.label} jusqu’à ${minutesToTime(item.heure)}`))
    .join(' et ');
}

function chooseArrivalCombination({ center, formula, date, pax, arrival, reservations = [], laneStatuses = {}, blocks = [], preference = {}, preferredLanes = [], memo = null }) {
  const demande = verdictDeLArrivee(center, arrival);
  const brute = String(arrival === null || arrival === undefined ? '' : arrival).trim().slice(0, 5);
  if (!demande.ok) return refusArrivee(brute, demande.code, demande.reason);
  const arrivee = demande.minutes;
  const time = minutesToTime(arrivee);
  const reglage = demande.reglage;
  const model = getFormulaAnchorModel(formula, { freeDurationPolicy: reglage.freeDurationPolicy });
  if (!model.anchors.length) {
    return refusArrivee(time, 'no_anchor', 'Cette formule ne comporte aucune activité à créneau : choisissez simplement votre heure d’arrivée.');
  }
  const schedule = getSchedule(date, center);
  if (!schedule) return refusArrivee(time, 'schedule', 'Le centre est fermé à cette date.');
  const fermeture = Math.round(schedule.close * 60);
  const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
  const posees = normalizeAnchorPreference(preference);
  // Le laser est tenu des que le client a dit quelque chose de ses parties :
  // une heure, une liste (meme vide de toute heure : « sur place ») ou « sur
  // place ». Sinon sa premiere partie se cherche.
  const laserTenu = Number.isFinite(posees.anchorTimes.laser_game)
    || (Array.isArray(preference.laserGameTimes) && preference.laserGameTimes.length > 0)
    || posees.laserPlacement === 'onsite';
  const aChercher = model.anchors
    .map((anchor) => anchor.activityId)
    .filter((id) => (id === 'laser_game' ? !laserTenu : !Number.isFinite(posees.anchorTimes[id])));
  const fixes = {};
  model.anchors.forEach((anchor) => {
    if (!aChercher.includes(anchor.activityId) && Number.isFinite(posees.anchorTimes[anchor.activityId])) fixes[anchor.activityId] = posees.anchorTimes[anchor.activityId];
  });
  const partiesTenues = laserTenu ? posees.laserGameTimes : [];
  // L heure d arcade choisie se pose dans chaque combinaison essayee : une
  // ancre qui la chevauche n est pas une visite possible.
  const arcadeStart = posees.arcadeStart;
  const composer = (heures) => composeAnchoredFormulaScenario({
    center, formula, pax, anchorTimes: heures, laserPlacement: posees.laserPlacement, preferredLanes, laserGameTimes: partiesTenues, bowlingConfig, arrivalStart: arrivee, arcadeStart,
  });
  const porte = (heures) => evaluateAnchoredCombination({
    center, formula, date, pax, anchorTimes: heures, laserPlacement: posees.laserPlacement, reservations, laneStatuses, blocks, preference, preferredLanes, laserGameTimes: partiesTenues, arrival: arrivee, arcadeStart,
  });
  const cleDe = (heures) => [ANCHOR_ACTIVITY_IDS.map((id) => `${id}:${Number.isFinite(heures[id]) ? heures[id] : ''}`).join('|'), partiesTenues.join(','), posees.laserPlacement].join('#');
  const memoire = memo instanceof Map ? memo : new Map();
  // Le verdict SANS arrivee : les ancres tiennent-elles (ressources, horaires,
  // regles de la formule) ? Il ne sert qu a expliquer un refus.
  const tiennentSansArrivee = (heures) => {
    // La variante jouee entre dans la cle (lib/formula-choice). Defensif, non
    // prouve : aucun appel ne partage aujourd hui une memoire entre la carte et
    // une variante, une demande n en porte qu une.
    const cle = `${formula.id || ''}${formula.formulaChoice ? `~${formula.formulaChoice.id}` : ''}#${pax}#${cleDe(heures)}`;
    if (!memoire.has(cle)) {
      const verdict = evaluateAnchoredCombination({
        center, formula, date, pax, anchorTimes: heures, laserPlacement: posees.laserPlacement, reservations, laneStatuses, blocks, preference, preferredLanes, laserGameTimes: partiesTenues,
      });
      memoire.set(cle, { ok: verdict.ok, code: verdict.code || '' });
    }
    return memoire.get(cle);
  };
  const accepte = (verdict, heures) => ({
    ok: true,
    time,
    code: '',
    reason: '',
    result: verdict,
    anchorTimes: heures,
    laserGameTimes: partiesTenues,
    laserPlacement: posees.laserPlacement,
  });

  // La place que prend chaque ancre cherchee : lue sur une composition d essai
  // (la meme regle de services et de vagues que la porte), les ancres posees
  // loin les unes des autres pour ne jamais se chevaucher.
  const essai = { ...fixes };
  // Les ancres se cherchent sur la grille (:00/:30). Une arrivee hors grille
  // est refusee avant (verdictDeLArrivee), et la creation la refuserait
  // encore (lib/database ensureProgramStartAlignment). La premiere heure
  // laisse les dix minutes d accueil (poserArrivee refuserait les autres).
  const premiereGrille = ceilMinutes(arrivee + FORMULA_ARRIVAL_MINUTES, PROGRAM_GRID_MINUTES);
  aChercher.forEach((id, rang) => { essai[id] = premiereGrille + 24 * 60 * (rang + 1); });
  const sonde = composer(essai);
  if (!sonde.ok) return refusArrivee(time, sonde.code, sonde.reason, sonde.conflict ? { conflict: sonde.conflict } : {});
  // « Avec votre bowling à 12:00 » : les heures que le client a posees, dites
  // dans un avis dont elles sont la cause.
  const phraseDesPosees = () => {
    const posees = model.anchors
      .filter((anchor) => Number.isFinite(fixes[anchor.activityId]))
      .map((anchor) => `votre ${String(anchor.label || anchor.activityId).toLowerCase()} à ${minutesToTime(fixes[anchor.activityId])}`);
    return posees.length ? `Avec ${posees.join(' et ')}` : '';
  };
  // POURQUOI TANT D ATTENTE, dit dans l avis : ce qui est complet jusqu a
  // quand (`complets`), sinon les heures posees. `cause` le porte seul, sans
  // l heure d arrivee : l ecran regroupe les arrivees qui attendent pour la
  // meme raison (« 10:00 et 10:30 : 1 h a 1 h 30 sans activite »).
  const avecSaCause = (verdict, complets = '') => {
    if (!verdict.warning || verdict.warning.code !== 'arrival_wait') return verdict;
    const attente = formatGapLabel(verdict.warning.waitMinutes);
    const cause = complets || phraseDesPosees();
    const reason = complets ? `${complets} : arriver à ${time} laisse ${attente} sans activité.`
      : cause ? `${cause}, arriver à ${time} laisse ${attente} sans activité.`
        : `Arriver à ${time} laisse ${attente} sans activité entre les activités.`;
    return { ...verdict, warning: { ...verdict.warning, reason, ...(cause ? { cause } : {}) } };
  };
  // TOUT EST DEJA POSE : il n y a rien a chercher, la porte juge exactement la
  // combinaison du client, avec son arrivee, et sa raison est la reponse.
  if (!aChercher.length) {
    const verdict = porte(fixes);
    if (verdict.ok) return accepte(avecSaCause(verdict), fixes);
    const mesureFixe = verdict.arrival
      ? { waitMinutes: verdict.arrival.waitMinutes, visitMinutes: verdict.arrival.visitMinutes, maxWaitMinutes: verdict.arrival.maxWaitMinutes, maxVisitMinutes: verdict.arrival.maxVisitMinutes }
      : {};
    return refusArrivee(time, verdict.code, verdict.reason, { ...mesureFixe, ...(verdict.conflict ? { conflict: verdict.conflict } : {}) });
  }
  const etendue = {};
  (sonde.arrivalPlan.frise || []).forEach((segment) => {
    if (segment.kind === 'anchor' && !(segment.activityId in etendue)) etendue[segment.activityId] = segment.minutes;
  });
  const grille = [];
  for (let t = premiereGrille; t < fermeture; t += PROGRAM_GRID_MINUTES) grille.push(t);
  // Toutes les combinaisons de la journee a partir de l arrivee (`marge`
  // infinie), ou seulement celles dont les trous restent dans la borne
  // d attente : un trou plus long que l attente conseillee plus TOUT le libre
  // de la formule laisse forcement plus d attente que la borne.
  const combinaisons = (marge) => {
    const liste = [];
    if (!aChercher.length) {
      liste.push({ ...fixes });
    } else if (aChercher.length === 1) {
      grille.forEach((t) => {
        if (!Object.keys(fixes).length && t - arrivee > marge) return;
        liste.push({ ...fixes, [aChercher[0]]: t });
      });
    } else {
      [[aChercher[0], aChercher[1]], [aChercher[1], aChercher[0]]].forEach(([premier, second]) => {
        grille.forEach((t1) => {
          const avant = t1 - arrivee;
          if (avant > marge) return;
          const finPremier = t1 + (etendue[premier] || 0);
          for (let t2 = ceilMinutes(finPremier, PROGRAM_GRID_MINUTES); t2 < fermeture; t2 += PROGRAM_GRID_MINUTES) {
            if (avant + (t2 - finPremier) > marge) break;
            liste.push({ ...fixes, [premier]: t1, [second]: t2 });
          }
        });
      });
    }
    return liste;
  };
  const rangDOrdre = (raw) => {
    const ordre = (raw.arrivalPlan.frise || []).filter((segment) => segment.kind === 'anchor').map((segment) => segment.activityId)
      .filter((id, index, liste) => liste.indexOf(id) === index);
    const attendu = ANCHOR_ACTIVITY_IDS.filter((id) => ordre.includes(id));
    return ordre.every((id, index) => id === attendu[index]) ? 0 : 1;
  };
  // A egalite de fin et d attente, le bowling et le laser au plus tot (le
  // groupe les joue des qu ils sont libres) : leurs heures comparees une a une,
  // dans l ordre de la journee. Comparer la cle en texte prenait « 1020 »
  // (17:00) avant « 990 » (16:30).
  const heuresTriees = (heures) => Object.values(heures).filter(Number.isFinite).sort((a, b) => a - b);
  const auPlusTot = (gauche, droite) => {
    const g = heuresTriees(gauche);
    const d = heuresTriees(droite);
    for (let rang = 0; rang < Math.max(g.length, d.length); rang += 1) {
      const ecart = (rang < g.length ? g[rang] : Infinity) - (rang < d.length ? d[rang] : Infinity);
      if (ecart) return ecart;
    }
    return 0;
  };
  const classer = (gauche, droite) => (gauche.raw.end - droite.raw.end)
    || (gauche.raw.arrivalPlan.waitMinutes - droite.raw.arrivalPlan.waitMinutes)
    || (rangDOrdre(gauche.raw) - rangDOrdre(droite.raw))
    || auPlusTot(gauche.heures, droite.heures)
    || cleDe(gauche.heures).localeCompare(cleDe(droite.heures));

  // 1. LA MEILLEURE VISITE DANS LES BORNES DU CENTRE, dans l ordre de choix :
  // la premiere que la porte accepte est la visite proposee.
  const enLice = combinaisons(reglage.maxWaitMinutes + model.freeMinutes)
    .map((heures) => ({ heures, raw: composer(heures) }))
    .filter((item) => item.raw.ok && bornesDeLArrivee(item.raw, reglage).ok)
    .sort(classer);
  let premierRefus = null;
  for (const item of enLice) {
    const verdict = porte(item.heures);
    if (verdict.ok) return accepte(verdict, item.heures);
    if (!premierRefus) premierRefus = verdict;
  }
  // Un refus qui ne vient pas de la place prise (regles de la formule,
  // fermeture) vaut pour toute la journee a partir de cette arrivee : il se dit
  // tel quel.
  if (premierRefus && !CODES_RESSOURCES.has(premierRefus.code)) {
    return refusArrivee(time, premierRefus.code, premierRefus.reason);
  }

  // 2. AU-DELA DES BORNES, LE CLIENT RESTE LIBRE (Movsar, 2026-10-13 : « on
  // peut prendre l heure qu on veut, juste si c est vraiment impossible on peut
  // pas »). Parmi les combinaisons de la journee qui tiennent (leur verdict
  // sans arrivee, garde d une heure a l autre), celle qui fait le moins
  // attendre, puis la meilleure : la porte la prend avec son avis.
  const journee = combinaisons(Infinity);
  const possibles = journee.filter((heures) => tiennentSansArrivee(heures).ok);
  const libelleDe = (id) => (model.anchors.find((anchor) => anchor.activityId === id) || {}).label || id;
  // Ce qui est pris jusqu a quand (« Bowling et Laser Game sont complets
  // jusqu a 12:00 »). La demi-heure qui suit l arrivee est a l accueil, elle
  // n est jamais « complete ».
  const desComplets = () => {
    const tardives = aChercher
      .map((id) => ({ id, label: libelleDe(id), heure: Math.min(...possibles.map((heures) => heures[id]).filter(Number.isFinite)) }))
      .filter((item) => Number.isFinite(item.heure) && item.heure > premiereGrille)
      .sort((gauche, droite) => gauche.heure - droite.heure);
    return phraseDesComplets(tardives);
  };
  const mesurees = possibles
    .map((heures) => ({ heures, raw: composer(heures) }))
    .filter((item) => item.raw.ok)
    .sort((gauche, droite) => (gauche.raw.arrivalPlan.waitMinutes - droite.raw.arrivalPlan.waitMinutes) || classer(gauche, droite));
  for (const item of mesurees) {
    const verdict = porte(item.heures);
    if (verdict.ok) return accepte(avecSaCause(verdict, desComplets()), item.heures);
    if (!premierRefus) premierRefus = verdict;
  }
  // L HEURE D ARCADE CHOISIE NE LAISSE PLUS DE PLACE : les activites a heure
  // fixe tiennent ce jour-la, mais aucune sans chevaucher les arcades. Le refus
  // le dit, au lieu d un « complet » qui ne serait pas vrai. (Des arcades sur
  // une activite que le client a posee, la composition d essai l a deja
  // refuse plus haut, en la nommant.)
  if (possibles.length && !mesurees.length && Number.isFinite(arcadeStart)) {
    const heurtees = possibles.map((heures) => composer(heures)).filter((raw) => !raw.ok && raw.code === 'arcade_overlap');
    if (heurtees.length) {
      const arcade = model.freeSteps.find((step) => freeStepHasTime(step, getActivity(step.activityId)?.durationModel));
      const nom = (arcade && (getActivity(arcade.activityId)?.name || arcade.label)) || 'Arcades';
      const noms = aChercher.map(libelleDe);
      const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0];
      return refusArrivee(time, 'arcade_overlap', `Avec vos ${nom.toLowerCase()} à ${minutesToTime(arcadeStart)}, ${liste} ne ${noms.length > 1 ? 'tiennent' : 'tient'} plus ce jour-là : choisissez une autre heure pour vos ${nom.toLowerCase()}.`);
    }
  }

  // 3. RIEN NE TIENT : l impossible, dit tel quel. Complet quand c est la place
  // qui manque partout, trop tard quand la visite ne rentre plus avant la
  // fermeture.
  if (!possibles.length) {
    const codes = journee.map((heures) => tiennentSansArrivee(heures).code);
    if (codes.length && codes.every((code) => CODES_RESSOURCES.has(code))) {
      const noms = model.anchors.map((anchor) => anchor.label);
      const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0];
      return refusArrivee(time, 'arrival_full', `Plus aucun programme possible à partir de ${time} ce jour-là : ${liste} ${noms.length > 1 ? 'sont complets' : 'est complet'}.`);
    }
    return refusArrivee(time, 'schedule', `Plus aucun programme ne tient avant la fermeture (${minutesToTime(fermeture)}) avec une arrivée à ${time}.`);
  }
  if (premierRefus && !CODES_RESSOURCES.has(premierRefus.code)) return refusArrivee(time, premierRefus.code, premierRefus.reason);
  return refusArrivee(time, 'arrival_full', `Plus aucun programme possible à partir de ${time} ce jour-là.`);
}

// Ce que la reponse dit d une arrivee : le verdict, et pour une arrivee qui
// tient, ce qui se fait avant la premiere activite a heure fixe, les heures du
// bowling et du laser, l attente et la fin de la visite.
function resumeArrivee(choix) {
  if (!choix.ok) {
    const { result: _result, ...refus } = choix;
    return refus;
  }
  const scenario = choix.result.scenario || {};
  const plan = scenario.arrivalPlan || {};
  return {
    time: choix.time,
    ok: true,
    welcomeTime: scenario.arrivalTime || '',
    endTime: plan.endTime || '',
    visitMinutes: plan.visitMinutes,
    waitMinutes: plan.waitMinutes,
    anchors: { ...((scenario.anchorPlan && scenario.anchorPlan.times) || {}) },
    laserGameTimes: [...((scenario.anchorPlan && scenario.anchorPlan.laserGameTimes) || [])],
    before: plan.before || [],
    frise: plan.frise || [],
    ...(plan.arcadeTime ? { arcadeTime: plan.arcadeTime } : {}),
    // L AVERTISSEMENT DE LA PORTE (2026-10-13) : une arrivee acceptee dont la
    // visite deborde la fermeture le porte, comme une heure de bowling ; le
    // formulaire la dit « serrée » sans rien recalculer.
    ...(choix.result.warning ? { warning: choix.result.warning } : {}),
  };
}

// Une demande porte une heure d arrivee des que le champ est rempli.
function demandeUneArrivee(preference) {
  const valeur = preference && preference.arrivalTime;
  return valeur !== undefined && valeur !== null && String(valeur).trim() !== '';
}

// Une formule par heure d arrivee : la combinaison que l arrivee choisit, ou
// le refus et sa raison. Meme forme de reponse que planFormulaWithAnchors.
function planFormulaFromArrival(input, context, { center, formula, date, pax, preference }) {
  const choix = chooseArrivalCombination({
    center,
    formula,
    date,
    pax,
    arrival: preference.arrivalTime,
    reservations: Array.isArray(context.reservations) ? context.reservations : [],
    laneStatuses: context.laneStatuses || {},
    blocks: Array.isArray(context.blocks) ? context.blocks : [],
    preference,
    preferredLanes: Array.isArray(input.lanes) ? input.lanes : [],
    memo: context.arrivalMemo instanceof Map ? context.arrivalMemo : null,
  });
  const scenario = choix.ok ? choix.result.scenario : null;
  return {
    ok: choix.ok,
    reason: choix.ok ? '' : choix.reason,
    refusalCode: choix.ok ? '' : choix.code,
    type: 'formule',
    centerId: center.id,
    date,
    formulaId: formula.id,
    formulaName: formula.name,
    pax,
    requestedStartTime: input.startTime || choix.time || null,
    recommended: scenario,
    scenarios: scenario ? [scenario] : [],
    validationMode: modeValidationFormule(formula, center && center.id),
    anchorSuggestions: [],
    arrival: resumeArrivee(choix),
  };
}

// Les heures d arrivee d une journee, sur la grille : de l ouverture (bornes de
// la formule et heure du jour comprises, getScheduleWindow) a la derniere
// demi-heure avant la fermeture. Chacune se juge ensuite par
// planFormulaFromArrival.
function listFormulaArrivalTimes({ centerId, formula: formulaDoc = null, formuleId = '', date }) {
  const center = getCenter(centerId || 'libramont');
  const formula = formulaDoc && typeof formulaDoc === 'object' ? formulaDoc : getFormula(formuleId);
  const jour = normalizeDate(date);
  const window = getScheduleWindow({ center, date: jour, estimatedMinutes: PROGRAM_GRID_MINUTES, formula, preMinutes: FORMULA_ARRIVAL_MINUTES });
  if (!window.ok) return { ok: false, reason: window.reason, times: [] };
  const times = [];
  for (let t = ceilMinutes(window.anchorStart ?? window.minStart, PROGRAM_GRID_MINUTES); t < window.close; t += PROGRAM_GRID_MINUTES) times.push(minutesToTime(t));
  return { ok: true, reason: '', times };
}

// LE COMPTOIR PEUT ALLONGER LE BOWLING D'UNE FORMULE (2026-08-20).
// La fiche « Modifier » propose une duree, y compris sur une formule. Le moteur
// la jetait au profit de la duree du catalogue : la ligne enregistrait 1h30, le
// plan gardait 1h, et le planning dessinait une carte d'une heure sous une fiche
// qui en annonce une et demie. Meme famille que les pistes ignorees.
// Cote STAFF uniquement : le tunnel public vend la formule telle qu'elle est
// ecrite au catalogue, une requete forgee ne s'offre pas deux heures de piste.
function applyStaffBowlingDuration(formula, input = {}) {
  if (input.channel !== 'staff') return formula;
  const minutes = Math.round(Number(input.duration || 0) * 60);
  if (!minutes || minutes < 30 || minutes > 300) return formula;
  const steps = Array.isArray(formula?.steps) ? formula.steps : [];
  const bowling = steps.find((step) => step.activityId === 'bowling');
  if (!bowling) return formula;
  if (Number(bowling.durationMinutes || 60) === minutes) return formula;
  return {
    ...formula,
    steps: steps.map((step) => (step.activityId === 'bowling'
      ? { ...step, durationMinutes: minutes }
      : step)),
  };
}

// La visite d une formule a fenetre ouverte : de l arrivee a la fin de la
// periode, toutes les activites en acces libre (flexible), aucune ressource
// posee a heure fixe. Les parties de laser se placent sur place avec
// l equipe, exactement comme quand un client laisse ses parties « sur place »
// (laserPassPlan all_on_site) : aucune session d arene n est reservee.
function buildOpenWindowScenario({ formula, start, end }) {
  const arrivalStart = start - FORMULA_ARRIVAL_MINUTES;
  const timeline = [{
    type: 'service',
    label: 'Arrivée & accueil',
    resourceType: 'bar_service',
    start: arrivalStart,
    end: start,
    startTime: minutesToTime(arrivalStart),
    endTime: minutesToTime(start),
  }];
  const resourceBlocks = [];
  let laserGames = 0;
  expandFormulaSteps(formula).forEach((step) => {
    const resourceType = stepResourceType(step);
    const activity = step.activityId ? getActivity(step.activityId) : null;
    if (resourceType === 'party_table') {
      const tableBlock = {
        type: 'activity',
        activityId: step.activityId || 'party_table',
        label: activity?.name || step.label || 'Table anniversaire',
        resourceType: 'party_table',
        countIndex: 1,
        critical: Boolean(step.critical),
        followsArrival: true,
        start: arrivalStart,
        end,
        startTime: minutesToTime(arrivalStart),
        endTime: minutesToTime(end),
        durationMinutes: end - arrivalStart,
        tableNeed: 1,
      };
      timeline.push(tableBlock);
      resourceBlocks.push(tableBlock);
      return;
    }
    if (step.activityId === 'laser_game') {
      laserGames += 1;
      if (laserGames > 1) return;
    }
    timeline.push({
      type: step.activityId && resourceType !== 'bar_service' ? 'activity' : 'service',
      activityId: step.activityId || null,
      label: activity?.name || step.label || 'Service',
      resourceType,
      countIndex: 1,
      flexible: true,
      openWindow: true,
      start,
      end,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      durationMinutes: end - start,
    });
  });
  const laserPassPlan = laserGames
    ? {
      mode: 'all_on_site',
      totalGames: laserGames,
      scheduledGames: 0,
      remainingGames: laserGames,
      scheduledPasses: [],
      pendingPasses: Array.from({ length: laserGames }, (_, index) => ({ countIndex: index + 1, status: 'pending' })),
    }
    : null;
  return {
    start,
    end,
    arrivalStart,
    arrivalMinutes: FORMULA_ARRIVAL_MINUTES,
    totalMinutes: end - start,
    timeline,
    resourceBlocks,
    laserPassPlan,
    openWindow: true,
  };
}

// FENETRE OUVERTE : l heure d arrivee est la seule question. Elle vaut de
// l ouverture (ou du debut de periode) a la derniere demi-heure avant la fin
// de periode ; le meme jour, les heures passees sont exclues par
// getScheduleWindow. Tout vient des horaires EDITABLES du centre et de la
// periode de la formule : rien de code en dur, un centre qui change ses
// heures change la plage d arrivees.
function planOpenWindowFormula(input, { center, formula, date, pax, preference, reservations, laneStatuses, availabilityBlocks }) {
  const result = {
    type: 'formule',
    centerId: center.id,
    date,
    formulaId: formula.id,
    formulaName: formula.name,
    pax,
    requestedStartTime: input.startTime || null,
    validationMode: modeValidationFormule(formula, center && center.id),
    openWindow: true,
  };
  const schedule = getSchedule(date, center);
  const window = getScheduleWindow({ center, date, estimatedMinutes: PROGRAM_GRID_MINUTES, formula, preMinutes: FORMULA_ARRIVAL_MINUTES });
  const closeMinutes = schedule ? Math.round(schedule.close * 60) : null;
  const periodEnd = formula.timeLimit?.max
    ? Math.min(closeMinutes ?? Infinity, timeToMinutes(formula.timeLimit.max))
    : closeMinutes;
  if (!window.ok || !Number.isFinite(periodEnd)) {
    // La periode se termine avant l ouverture (MATIN MALIN un jour qui ouvre a
    // 14:00) : le dire, plutot qu un « aucun depart possible » generique.
    const opensAfterPeriod = Boolean(schedule && formula.timeLimit?.max
      && Math.round(schedule.open * 60) >= timeToMinutes(formula.timeLimit.max));
    return {
      ...result,
      ok: false,
      reason: opensAfterPeriod
        ? `${formula.name} se prend avant ${formula.timeLimit.max} : ce jour-là, le centre ouvre à ${minutesToTime(Math.round(schedule.open * 60))}.`
        : (window.reason || `Aucune arrivée disponible pour ${formula.name} ce jour-là.`),
      recommended: null,
      scenarios: [],
    };
  }
  const firstStart = ceilMinutes(window.anchorStart ?? window.minStart, PROGRAM_GRID_MINUTES);
  const lastStart = periodEnd - PROGRAM_GRID_MINUTES;
  const requested = input.startTime ? timeToMinutes(input.startTime) : null;
  if (requested !== null && requested % PROGRAM_GRID_MINUTES !== 0) {
    return {
      ...result,
      ok: false,
      reason: 'Une formule démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30) : choisissez un autre départ.',
      recommended: null,
      scenarios: [],
    };
  }
  const scenarios = [];
  for (let start = firstStart; start <= lastStart; start += PROGRAM_GRID_MINUTES) {
    if (requested !== null && start !== requested) continue;
    const rules = validateFormulaBusinessRules({ formula, date, pax, startMinutes: start, totalMinutes: periodEnd - start, center });
    if (!rules.ok) continue;
    const raw = buildOpenWindowScenario({ formula, start, end: periodEnd });
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
    decorated.laserPassPlan = raw.laserPassPlan;
    decorated.openWindow = true;
    // La fin de periode EST la fin de la visite : la marge de risque du
    // scoring ne prolonge pas une formule au-dela de sa propre limite.
    decorated.endTime = minutesToTime(raw.end);
    decorated.bufferMinutes = 0;
    scenarios.push(decorated);
  }
  // Toutes les arrivees sont LA reponse (aucun tri par score ni troncature :
  // ce ne sont pas des scenarios concurrents, c est une liste d heures).
  const recommended = scenarios.find((scenario) => scenario.ok) || scenarios[0] || null;
  let reason = '';
  if (!recommended) {
    const plage = firstStart <= lastStart
      ? `arrivée possible de ${minutesToTime(firstStart)} à ${minutesToTime(lastStart)}`
      : 'plus aucune arrivée possible ce jour-là';
    reason = requested !== null
      ? `${formula.name} : ${plage}.`
      : `Aucune arrivée disponible pour ${formula.name} ce jour-là (${plage}).`;
  }
  return { ...result, ok: Boolean(recommended && recommended.ok), reason, recommended, scenarios };
}

// UNE FORMULE « HORS VACANCES » SE RESERVE AU COMPTOIR (2026-10-12). En
// ligne, le blocage reste (getFormuleAvailability, le tunnel). Au comptoir, le
// staff est l autorite (regle de Movsar, 2026-08-15 : le moteur conseille et
// previent, il ne bloque pas un choix realisable) : la formule est planifiee
// comme un autre jour, pistes et arene posees, et le plan porte la raison,
// que la fenetre dit avant le clic et que la note du dossier garde. Avant, le
// refus « indisponible pendant les vacances » ne laissait que « Créer quand
// même » : un dossier « à placer » sans piste.
function planFormula(input, context = {}) {
  if (String(input.channel || '').toLowerCase() !== 'staff') return planFormulaSelonRegles(input, context);
  const center = getCenter(input.centerId || 'libramont');
  const formula = (input.formula && typeof input.formula === 'object') ? input.formula : getFormula(input.formuleId || input.formulaId);
  if (!formula || !formula.notDuringHolidays || !isFormulaBlockedDate(normalizeDate(input.date), center)) return planFormulaSelonRegles(input, context);
  const plan = planFormulaSelonRegles({ ...input, formula: { ...formula, notDuringHolidays: false } }, context);
  if (!plan || plan.ok === false) return plan;
  return { ...plan, avertissementComptoir: `${formula.name} n’est pas proposée en ligne pendant les vacances et les jours fériés : réservée ici au comptoir.` };
}

function planFormulaSelonRegles(input, context = {}) {
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
  // LA VARIANTE CHOISIE PAR LE CLIENT (preference.formulaChoice,
  // lib/formula-choice) : sans elle, la meme formule, rien ne change.
  const avecChoix = formuleAvecChoix(rawFormula, varianteDemandee(rawFormula && rawFormula.id, preference.formulaChoice));
  const formula = applyStaffBowlingDuration(applyOptionalSelection(avecChoix, preference), input);
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const laneStatuses = context.laneStatuses || {};
  const bowlingConfig = getOperationalBowlingConfig(center, laneStatuses);
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

  if (expandFormulaSteps(formula).some((step) => stepResourceType(step) === 'bowling_lane') && !bowlingConfig) {
    return {
      ok: false,
      reason: 'Aucune piste de bowling exploitable ce jour-là.',
      scenarios: [],
    };
  }

  // L HEURE D ARRIVEE (2026-10-12) : le client dit quand son groupe arrive, le
  // moteur pose le bowling et le laser a partir de la (planFormulaFromArrival).
  // Avant la fenetre ouverte : une formule sans ancre refuse l arrivee en le
  // disant, au lieu de l ignorer. Sans `preference.arrivalTime`, rien ne change.
  if (demandeUneArrivee(preference)) {
    return planFormulaFromArrival(input, context, { center, formula, date, pax, preference });
  }

  // FENETRE OUVERTE : ni ancres ni programme a enchainer, l arrivee seule.
  if (isOpenWindowFormula(formula)) {
    return planOpenWindowFormula(input, { center, formula, date, pax, preference, reservations, laneStatuses, availabilityBlocks });
  }

  // Modèle « Ancres + Liberté » : dès que le client a choisi une heure par
  // ancre (bowling/laser) ou l'option laser « sur place », la combinaison est
  // composée et validée telle quelle : plus de programme rigide imposé.
  if (isAnchoredFormulaRequest(formula, preference)) {
    return planFormulaWithAnchors(input, context, { center, formula, date, pax, preference });
  }

  const estimated = estimateFormulaMinutes(center, formula, pax, pauseMinutes, bowlingConfig);
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
        preferredLanes: Array.isArray(input.lanes) ? input.lanes : [],
        bowlingConfig,
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
    validationMode: modeValidationFormule(formula, center && center.id),
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
      ...(step.activityId === 'bowling' && step.games ? { games: step.games } : {}),
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
  for (let startMinutes = ceilMinutes(window.anchorStart ?? window.minStart, PROGRAM_GRID_MINUTES); startMinutes <= window.maxStart; startMinutes += PROGRAM_GRID_MINUTES) {
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
  // LE COMPTOIR CHOISIT SON NOMBRE DE PISTES (2026-10-08) : 12 joueurs sur 3
  // pistes est un choix realisable, le moteur le reduisait en silence au
  // minimum (2). Au-dessus du minimum seulement, et jamais plus que le parc du
  // centre. Le tunnel garde le minimum.
  const minimumLanes = getRequiredLaneCount(center, pax, input);
  const demandees = input.channel === 'staff' ? Math.trunc(Number(input.laneCount) || 0) : 0;
  const parc = Math.trunc(Number(center.resources.bowling?.laneCount) || 0);
  const requiredLanes = demandees > minimumLanes ? Math.min(demandees, parc || demandees) : minimumLanes;
  const contractedBowling = input.program?.items?.find((item) => item.activityId === 'bowling');
  const contractedGames = contractedBowling?.games
    || getBowlingGameOptions(center.resources.bowling, date, { pax, laneCount: requiredLanes })
      ?.find((option) => Number(option.durationMinutes) === durationMinutes)?.games || 1;
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
    // Les pistes DEMANDEES d'abord (le staff a coche 5 et 6, le planning doit
    // les montrer la), l'allocation automatique seulement si elles ne tiennent
    // pas sur ce creneau. Elles peuvent etre plus nombreuses que le minimum :
    // trois pistes cote a cote pour quatre joueurs est un choix realisable.
    const availabilityBlocks = Array.isArray(context.blocks) ? context.blocks : [];
    const preferred = preferredLanesFor(center, laneStatuses, reservations, { start, end }, availabilityBlocks, date, input.lanes);
    const allocation = allocateBowlingCapacity({ players: pax, config: center.resources.bowling, requiredLanes, durationMinutes, games: contractedGames,
      allocate: (count) => preferred && preferred.length >= count ? preferred : allocateLanes(center, laneStatuses, reservations, start, end, count, availabilityBlocks, date) });
    const lanes = allocation?.lanes || null;
    const conflicts = lanes
      ? []
      : [{ type: 'bowling_conflict', severity: 'blocking', message: `Pas assez de pistes libres à ${minutesToTime(start)}.` }];
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
      emergencyWarning: allocation?.emergencyWarning || '',
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
          ...(contractedGames > 1 ? { games: contractedGames } : {}),
          requiredLanes,
          players: pax,
          ...(allocation || {}),
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
          players: pax,
          ...(contractedGames > 1 ? { games: contractedGames } : {}),
          ...(allocation || {}),
          lanes: lanes || [],
        },
      ],
      staffSummary: `Bowling - ${pax} personnes | ${lanes?.length || requiredLanes} piste(s) | Risque ${risk.level}`,
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
  // Le comptoir vend jusqu a 12 parties (lib/prix-palier.js) ; le tunnel garde
  // la borne de sa grille.
  if (explicit >= 1) return clamp(Math.round(explicit), 1, input.channel === 'staff' ? MAX_LASER_GAMES_PER_RESERVATION : 3);
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
  // LE COMPTOIR POSE TOUTES LES PARTIES (2026-10-08, Movsar : « on est le
  // staff, on doit pouvoir faire ce qu on veut »). Le tunnel ne pose que la
  // premiere et laisse les suivantes « a placer » ; au comptoir, elles
  // s enchainent dans la foulee, chaque vague au prochain depart de l arene.
  // Elles portent `manualLaserPass` : c est le seul signe que la base
  // (resourceBlocksFromReservation) et ce moteur (inferBlocksFromReservation)
  // lisent pour COMPTER une partie au-dela de la premiere d un laser seul. Sans
  // lui, la 2e partie d un groupe de 20 laissait l arene vide pour le groupe
  // suivant : 40 joueurs pour 30 armes.
  const toutesLesParties = input.channel === 'staff';
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
    if (toutesLesParties) {
      raw.resourceBlocks.forEach((block) => {
        if (block.resourceType === 'laser_arena' && Number(block.countIndex || 1) > 1) block.manualLaserPass = true;
      });
    }
    const scenario = input.deferExtraLaserGames === false || toutesLesParties ? raw : deferExtraStandaloneLaserPasses(raw, games);
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

// Re-pose les blocs laser d un plan decale sur la grille des departs.
//
// CE QUE LE CALAGE AJOUTE, TOUT CE QUI SUIT LE PREND (corrige le 2026-08-26).
// Premiere version : seuls les blocs laser bougeaient, chacun dans son coin.
// Un retard de 7 min sur une visite bowling 15:00 + laser 16:23 poussait le
// laser a 16:30 mais laissait le bowling suivant a 17:00 alors que la partie
// finit desormais a 16:55 : le plan pouvait poser le meme groupe a deux
// endroits en meme temps. On raisonne donc dans l ordre CHRONOLOGIQUE, on
// cumule le decalage introduit par chaque calage, et on le repercute sur tout
// ce qui vient apres. Les items sont rendus dans leur ordre d origine : le
// tableau recu n est pas garanti trie, et un curseur monotone applique a un
// tableau non trie repousserait un bloc anterieur derriere un bloc posterieur.
function snapShiftedLaserItems(items) {
  const liste = Array.isArray(items) ? items : [];
  const chronologie = liste
    .map((item, index) => ({ item, index, start: timeToMinutes(item.startTime || item.start) }))
    .sort((left, right) => left.start - right.start || left.index - right.index);
  const sortie = new Array(liste.length);
  let pousse = 0;
  let curseurLaser = -Infinity;
  chronologie.forEach(({ item, index, start }) => {
    const duree = Math.max(0, timeToMinutes(item.endTime || item.end) - start);
    let debut = start + pousse;
    if (item.resourceType === 'laser_arena') {
      const cale = snapLaserLaunch(Math.max(debut, curseurLaser));
      pousse += cale - debut;
      debut = cale;
      curseurLaser = debut + duree;
    }
    sortie[index] = debut === start
      ? item
      : { ...item, start: debut, end: debut + duree, startTime: minutesToTime(debut), endTime: minutesToTime(debut + duree) };
  });
  return sortie;
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
    timeline: snapShiftedLaserItems((plan.timeline || []).map((step) => shiftTimedItem(step, delayMinutes))),
    resourceBlocks: snapShiftedLaserItems((plan.resourceBlocks || []).map((block) => shiftTimedItem(block, delayMinutes))),
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
  const formuleId = input.formuleId || input.formulaId || reservation.formuleId || reservation.formulaId || plan.formulaId || '';
  // LA VARIANTE QUE LE PLAN DU DOSSIER GARDE (lib/formula-choice) se rejoue
  // depuis cet instantane, jamais depuis le catalogue : sans elle, une Formule
  // 4 aux arcades se replanifiait avec ses deux lasers, et un centre qui
  // reecrit sa carte apres la reservation (le catalogue ne propose plus le
  // choix) la ferait perdre de meme. Une formule que le catalogue n a plus ne
  // bloque pas l analyse : ses essais echouent comme avant, sans solution de
  // rechange (buildDelayAlternatives).
  const dossierDuRetard = choixDuDossier({ opsPlan: plan }) ? { opsPlan: plan } : reservation;
  let formula = null;
  if (formuleId && choixDuDossier(dossierDuRetard)) {
    try {
      formula = formuleDuDossier(getFormula(formuleId), dossierDuRetard);
    } catch (error) {
      formula = null;
    }
  }
  return {
    centerId: input.centerId || reservation.centerId || plan.centerId || 'libramont',
    date: input.date || reservation.date || plan.date,
    type,
    formuleId,
    ...(formula && formula.formulaChoice ? { formula } : {}),
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
    // Fenetre laser : un retard de 7 min ne cree pas un lancement a 12:12,
    // le groupe part au prochain depart de la grille. Les fenetres suivantes
    // suivent (previous.newEnd), donc deux vagues restent sequentielles.
    if (window.resourceType === 'laser_arena') window.newStart = snapLaserLaunch(window.newStart);
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

// Stratégie 3 : cascade, chaque réservation aval que le retard atteint est
// décalée du retard entier (2026-10-02 ; avant : du strict nécessaire).
function tryCascadeStrategy({ center, laneStatuses, delayed, delayedShift, others, closeMinutes }) {
  const base = {
    id: 'cascade',
    label: 'Décaler les réservations suivantes',
    description: 'Chaque réservation suivante que le retard atteint est décalée du même retard, dans l\'ordre du planning.',
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
    // LE RETARD SE PROPAGE ENTIER (2026-10-02, Movsar : « j ai rajoute 20
    // minutes de retard sur les pistes du dessus, normalement ca devrait
    // afficher 20 minutes de retard a toutes celles en dessous, sauf que ca
    // rajoute 10 ou 0 »). Un groupe que le retard atteint prend le retard
    // entier, plus le strict minimum : un trou de planning ne l absorbe plus.
    // Un groupe que le retard n atteint pas ne bouge toujours pas.
    const retardEntier = Math.max(0, Math.round(Number(delayedShift && delayedShift.shiftMinutes) || 0));
    const shiftResult = shiftReservationForDelay(sourceReservation, center, {
      delayMinutes: Math.max(target.neededShiftMinutes, retardEntier),
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
  attenteDuSousGroupe,
  intersticesDuGroupe,
  piecesDuLibre,
  rangerLeLibre,
  avisSansLeLibre,
  trousPourLeLibre,
  mesurerLaVisite,
  trousDuGroupe,
  // Les seules activites A CRENEAU (bowling, laser). Exposee pour que les
  // surfaces publiques ne redefinissent pas la liste en dur : le moteur reste
  // la source unique de ce qui est "vendable a l'heure".
  ANCHOR_ACTIVITY_IDS,
  BOWLING_GRID_MINUTES,
  PROGRAM_GRID_MINUTES,
  LASER_LAUNCH_GRID_MINUTES,
  plancherDuJour,
  FORMULA_ARRIVAL_MINUTES,
  allocateLanes,
  evaluateConflicts,
  analyzeDelay,
  buildDefaultAnchorTimes,
  computeDelayImpact,
  shiftReservationForDelay,
  buildLearningSuggestions,
  // La formule par heure d arrivee (2026-10-12).
  chooseArrivalCombination,
  demandeUneArrivee,
  listFormulaArrivalTimes,
  evaluateAnchoredCombination,
  // Les arcades a l heure du client, sans arrivee (modele A, 2026-10-13).
  arcadesHeurtentLesPosees,
  getFormulaAnchorAvailability,
  visitFeasibilityAt,
  getFormulaAnchorModel,
  getOperationalBowlingConfig,
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
