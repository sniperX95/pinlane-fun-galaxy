const {
  FORMULES,
  LASER_GAME_OPTIONS,
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
const { allocateLanes, getPool, readAvailabilitySnapshot, validateReservationResources } = require('../lib/database');
const { sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { planningAgent } = require('../lib/ops-agents');
const {
  buildDefaultAnchorTimes,
  evaluateAnchoredCombination,
  getFormulaAnchorAvailability,
  getFormulaAnchorModel,
} = require('../lib/ops-engine');
const { getCenter, getFormula, refreshCenterOverrides } = require('../lib/ops-knowledge');

const LASER_ARENA_MINUTES = 25;
// Fenêtre d'accueil fixe AVANT la première activité : l'heure choisie par le
// client est l'heure exacte de début de sa première activité, l'accueil se
// fait 10 minutes avant (aligné sur lib/ops-engine.js).
const FORMULA_ARRIVAL_MINUTES = 10;
const FORMULA_TRANSITION_MINUTES = 5;
// Règle métier : TOUTE heure proposée au client est une heure pleine ou demie
// (15:00, 15:30 — jamais 15:15 ni 16:40). Elle s'applique au début du
// PROGRAMME, c'est-à-dire au début de la PREMIÈRE activité, quelle qu'elle
// soit (bowling, laser, minigolf…). Les activités suivantes à l'intérieur du
// programme peuvent rester à des heures fines (enchaînement naturel).
const PROGRAM_GRID_MINUTES = 30;
// Les pistes de bowling restent en plus alignées :00/:30 même au milieu d'un
// programme (contrainte d'exploitation des pistes).
const BOWLING_GRID_MINUTES = PROGRAM_GRID_MINUTES;

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
  const bowlingWindows = laneWindowsFromReservation(reservation);
  // reservation.startTime = début exact de la première activité (l'accueil se
  // fait avant) : sans bowling planifié, le premier laser part à cette heure.
  const firstLaserStart = bowlingWindows.length
    ? Math.round(Math.max(...bowlingWindows.map((window) => window.start + window.duration)) * 60) + FORMULA_TRANSITION_MINUTES
    : Math.round(timeToNum(reservation.startTime) * 60);
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

function getFormulaStepCount(formulaDoc, activityId) {
  return (formulaDoc?.steps || [])
    .filter((step) => step.activityId === activityId)
    .reduce((sum, step) => sum + Math.max(1, Number(step.count || 1)), 0);
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
      arrivalTime: scenario.arrivalTime || null,
      arrivalMinutes: scenario.arrivalMinutes || null,
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
      laserPassPlan: scenario.laserPassPlan || null,
      anchorPlan: scenario.anchorPlan || null,
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
      arrivalTime: scenario.arrivalTime || null,
      arrivalMinutes: scenario.arrivalMinutes || null,
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
      const engineContext = {
        reservations: snapshot.reservations,
        laneStatuses: snapshot.laneStatuses,
      };
      // Modèle « Ancres + Liberté » : la dispo est exposée PAR ANCRE
      // (bowling/laser — heures :00/:30 vérifiées indépendamment) + une
      // combinaison par défaut valide. Les activités libres restent un pass
      // sans aucune heure, la table suit l'arrivée.
      const anchorModel = getFormulaAnchorModel(formulaDoc);
      let anchorMeta = null;
      try {
        anchorMeta = getFormulaAnchorAvailability({ centerId, formuleId, date, pax }, engineContext);
      } catch (error) {
        anchorMeta = null;
      }
      const guardContext = {
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
      };
      const respondFormula = (slots, message, suggestions = []) => {
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
          label: formule.name,
          anchors: anchorMeta,
          suggestions,
          message,
        });
      };

      if (anchorModel.anchors.length) {
        const laserPlacement = String(url.searchParams.get('laserPlacement') || '') === 'onsite' ? 'onsite' : 'scheduled';
        const hasAnchorChoice = Boolean(preferredTimes.bowling || preferredTimes.laser_game) || laserPlacement === 'onsite';

        if (hasAnchorChoice) {
          // Revalidation serveur de la combinaison choisie (source de vérité) :
          // soit LE créneau composé, soit un refus clair + suggestions proches.
          const plan = planningAgent(
            {
              centerId,
              date,
              type,
              formuleId,
              pax,
              duration,
              preference: {
                preferredTimes,
                laserPlacement,
                arrivalConfidence: 'normal',
              },
              pauseMinutes,
            },
            engineContext,
          );
          const recommended = plan?.plan?.recommended;
          const guarded = recommended && recommended.ok
            ? filterSlotsByFinalGuards([toFormulaSlot(recommended, snapshot, duration)], guardContext)
            : [];
          if (guarded.length) {
            respondFormula(guarded, '');
            return;
          }
          respondFormula(
            [],
            plan?.plan?.reason || 'Cette combinaison n’est plus disponible. Essayez une heure proche.',
            plan?.plan?.anchorSuggestions || [],
          );
          return;
        }

        // Défaut zéro friction : pour chaque heure possible de la première
        // ancre, la combinaison valide la plus simple (ancres enchaînées,
        // pass liberté autour). Le client peut ensuite modifier chaque ancre.
        const centerDocResolved = getCenter(centerId);
        const candidatesByActivity = {};
        (anchorMeta?.activities || []).forEach((activity) => {
          candidatesByActivity[activity.activityId] = activity.times.map((item) => Math.round(timeToNum(item.time) * 60));
        });
        const firstAnchorId = anchorModel.anchors[0].activityId;
        const defaultSlots = [];
        (candidatesByActivity[firstAnchorId] || []).forEach((firstStart) => {
          const anchorTimes = buildDefaultAnchorTimes({
            center: centerDocResolved,
            formula: formulaDoc,
            date,
            pax,
            model: anchorModel,
            candidatesByActivity,
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
            firstStart,
          });
          if (!anchorTimes) return;
          const combo = evaluateAnchoredCombination({
            center: centerDocResolved,
            formula: formulaDoc,
            date,
            pax,
            anchorTimes,
            laserPlacement: 'scheduled',
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
          });
          if (combo.ok) defaultSlots.push(toFormulaSlot(combo.scenario, snapshot, duration));
        });
        const guardedDefaults = filterSlotsByFinalGuards(defaultSlots, guardContext);
        respondFormula(
          guardedDefaults,
          guardedDefaults.length ? '' : 'Aucune combinaison disponible pour cette formule ce jour-là. Essayez une autre date ou un autre groupe.',
        );
        return;
      }

      // Formules sans ancre (table anniversaire + pass liberté) : le client
      // choisit simplement son heure d'arrivée — la table suit automatiquement.
      const slotsByPlan = new Map();

      // Départs de programme proposés au client : uniquement aux heures
      // pleines ou demies (grille :00/:30) — on recale la borne basse si la
      // config (timeLimit, horaires) l'a désalignée.
      const formulaMinTime = Math.ceil(minTime * 2) / 2;
      for (let value = formulaMinTime; value <= maxTime; value += 0.5) {
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
      respondFormula(
        guardedSlots,
        guardedSlots.length ? '' : 'Aucun scénario automatique sûr pour cette formule. Essayez un autre horaire ou contactez le centre.',
      );
      return;
    }

    if (type === 'laser') {
      const slotsByTime = new Map();
      const candidateMinutes = new Set();

      // Départs Laser proposés au client : uniquement aux heures pleines ou
      // demies (grille :00/:30) — on recale la borne basse si la config l'a
      // désalignée.
      const laserMinTime = Math.ceil(minTime * 2) / 2;
      for (let value = laserMinTime; value <= maxTime; value += 0.5) {
        candidateMinutes.add(Math.round(value * 60));
      }

      // Sessions partagées existantes : on ne propose de les rejoindre que si
      // leur départ tombe sur la grille client :00/:30 (les sessions décalées
      // par le staff restent gérables en interne, jamais proposées au client).
      snapshot.reservations
        .flatMap(laserWindowsFromReservation)
        .forEach((window) => {
          const startMinute = Math.round(Number(window.start || 0));
          if (startMinute % PROGRAM_GRID_MINUTES !== 0) return;
          if (startMinute >= Math.round(laserMinTime * 60) && startMinute <= Math.round(maxTime * 60)) {
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

    // Bowling classique : départs uniquement aux heures pleines ou demies
    // (grille :00/:30) — on recale la borne basse si la config l'a désalignée.
    minTime = Math.ceil(minTime * 2) / 2;
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
    // Même politique que staff-reservations : les messages métier (français,
    // contrôlés) passent, les erreurs d'infrastructure (Postgres/Neon/réseau)
    // ne fuient jamais vers le public — on les log et on renvoie un 503 neutre.
    const raw = String((error && error.message) || '');
    const isInfra = !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
    if (isInfra) {
      console.error('[public-availability] échec', error && (error.stack || raw || error));
      sendError(res, 503, 'Disponibilités momentanément indisponibles. Réessayez dans un instant.');
      return;
    }
    sendError(res, 400, raw);
  }
};
