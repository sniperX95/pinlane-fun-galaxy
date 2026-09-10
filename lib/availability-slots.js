// LES CRENEAUX DU TUNNEL, ECRITS UNE FOIS (2026-09-10).
//
// Les heures qu une formule propose ne se deduisent PAS de sa fenetre. Le
// moteur construit la visite activite par activite (une heure de bowling, des
// parties de laser, le minigolf, la table), avec les ancres de piste et
// d arene, puis chaque creneau passe la garde finale (fermetures, pistes,
// arene). Mesure du 2026-09-10 sur Libramont, un jeudi : FORMULE 4 se propose
// jusqu a 19 h quand sa fenetre dit 18 h 30, FORMULE 8 jusqu a 18 h 30 quand
// elle dit 19 h, et les formules a table ne s ouvrent qu a 14 h 30. Et une
// FORMULE 2 dure 2 h 20 dans le tunnel quand ses lignes en annoncent 3.
//
// La route publique (api/public-availability.js) composait tout cela dans son
// propre code, et l agent qui repond aux clients ne pouvait que le deviner.
// La projection d un scenario en creneau, la garde finale et les deux
// compositions par defaut d une formule vivent donc ici. La route les
// appelle ; l agent les lit par proposedArrivals. Il n y a pas de seconde
// copie a tenir a jour : c est le meme code.
const {
  TOTAL_LANES,
  getFormuleArrivalWindow,
  getFormuleAvailability,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getRequiredLaneCount,
  getSchedule,
  numToTime,
  reservationNeedsLanes,
  timeToNum,
  todayStr,
  bookingDateOutOfRange,
} = require('./booking-config');
const { isFormulaFullyBlockedOn, isLaneBlockedAt, resolveBlocksForDate } = require('./availability-blocks');
const { getCenter, getFormula, publicBookingBlockReason } = require('./ops-knowledge');
const { validateReservationResources } = require('./database');

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

function centerLaneBound(centerId) {
  try {
    const value = Number(getCenter(centerId || 'libramont')?.resources?.bowling?.laneCount);
    return Number.isFinite(value) && value > 0 ? value : TOTAL_LANES;
  } catch (error) {
    return TOTAL_LANES;
  }
}

function getFreeCount(reservations, laneStatuses, startTime, duration, laneCount = TOTAL_LANES, blocks = [], dateISO = '') {
  const occupied = getOccupiedLanes(reservations, startTime, duration);
  const startMin = Math.round(timeToNum(startTime) * 60);
  const endMin = startMin + Math.round(Number(duration || 0) * 60);
  let count = 0;
  for (let lane = 1; lane <= laneCount; lane += 1) {
    // Une piste bloquee (scope 'lane') sur la fenetre ne compte pas comme libre,
    // comme la maintenance. Sans blocage la liste est vide : compte inchange.
    if (!occupied.has(lane)
      && laneStatuses[lane] !== 'maintenance'
      && !isLaneBlockedAt(blocks, dateISO, lane, startMin, endMin)) {
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
    freeCount: getFreeCount(snapshot.reservations, snapshot.laneStatuses, laneStart, laneDuration, centerLaneBound(snapshot.centerId), snapshot.blocks || [], snapshot.date || ''),
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
      // Avis de confort (trou entre deux activités) : le créneau est
      // réservable, l'écran l'annonce sans jamais barrer la route.
      comfortNotices: scenario.comfortNotices || [],
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
      // Blocages resolus a la date : la garde finale retire les creneaux dont le
      // centre est ferme, la piste/l'activite/la formule est bloquee. Sans
      // blocage (liste vide) la garde est strictement identique a aujourd'hui.
      context.snapshot.blocks || [],
      context.date || context.snapshot.date || '',
    );
    return true;
  } catch (error) {
    return false;
  }
}

function filterSlotsByFinalGuards(slots, context) {
  return slots.filter((slot) => slotPassesFinalGuards(slot, context));
}

// CE QU UNE RESERVATION DE FORMULE OCCUPE, pour la garde des fermetures : sa
// duree estimee, ou, pour une FENETRE OUVERTE (MATIN MALIN, KIDS FUN DAY),
// toute la periode, puisque la visite dure jusqu a sa fin quelle que soit
// l heure d arrivee.
function formulaOccupiedDuration(formule, schedule) {
  if (formule && formule.orderPolicy === 'open_window') {
    const fenetre = getFormuleArrivalWindow(formule, schedule);
    const periodEnd = fenetre ? fenetre.periodEnd : schedule.close;
    const periodStart = fenetre ? fenetre.periodStart : schedule.open;
    return Math.max(0.5, periodEnd - periodStart);
  }
  return getFormuleTotalDuration(formule);
}

// UNE FORMULE A ANCRES (bowling, arene laser), sans heure choisie : pour
// chaque heure possible de la premiere ancre, la combinaison valide la plus
// simple (ancres enchainees, pass liberte autour), puis la garde finale. Le
// client peut ensuite modifier chaque ancre.
function anchoredDefaultSlots({
  center, formula, date, pax, model, anchorMeta, snapshot, duration, guardContext,
}) {
  const { buildDefaultAnchorTimes, evaluateAnchoredCombination } = require('./ops-engine');
  const candidatesByActivity = {};
  (anchorMeta?.activities || []).forEach((activity) => {
    candidatesByActivity[activity.activityId] = activity.times.filter((item) => item.ok !== false).map((item) => Math.round(timeToNum(item.time) * 60));
  });
  const firstAnchorId = model.anchors[0].activityId;
  const defaultSlots = [];
  (candidatesByActivity[firstAnchorId] || []).forEach((firstStart) => {
    const anchorTimes = buildDefaultAnchorTimes({
      center,
      formula,
      date,
      pax,
      model,
      candidatesByActivity,
      reservations: snapshot.reservations,
      laneStatuses: snapshot.laneStatuses,
      blocks: snapshot.blocks || [],
      firstStart,
    });
    if (!anchorTimes) return;
    const combo = evaluateAnchoredCombination({
      center,
      formula,
      date,
      pax,
      anchorTimes,
      laserPlacement: 'scheduled',
      reservations: snapshot.reservations,
      laneStatuses: snapshot.laneStatuses,
      blocks: snapshot.blocks || [],
    });
    if (combo.ok) defaultSlots.push(toFormulaSlot(combo.scenario, snapshot, duration));
  });
  return filterSlotsByFinalGuards(defaultSlots, guardContext);
}

// UNE FORMULE SANS ANCRE (table anniversaire, pass liberte, fenetre ouverte) :
// le client choisit son heure d arrivee, la table suit. Departs proposes
// uniquement aux heures pleines ou demies (grille :00/:30), la borne basse
// recalee si la configuration (timeLimit, horaires) l a desalignee. Un plan
// par combinaison distincte, tries, puis la garde finale.
function plannedArrivalSlots({
  centerId, date, type, formuleId, pax, duration, minTime, maxTime, preference,
  pauseMinutes, snapshot, guardContext,
}) {
  const { planningAgent } = require('./ops-agents');
  const slotsByPlan = new Map();
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
        preference: { ...preference },
        pauseMinutes,
      },
      {
        reservations: snapshot.reservations,
        laneStatuses: snapshot.laneStatuses,
        blocks: snapshot.blocks || [],
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
  return filterSlotsByFinalGuards(slots, guardContext);
}

// CE QUE LE TUNNEL PROPOSE, pour une formule, un jour, un groupe, quand le
// client n a encore rien choisi : les memes refus que la route, dans le meme
// ordre, puis la meme composition et la meme garde. Sans reservation : les
// blocages et l etat des pistes sont ceux qu on lui donne, la place prise par
// les autres groupes ne l est pas. C est ce que l agent appelle « sous reserve
// de place ». Le jour meme, le moteur retire lui-meme les heures trop
// proches (avance et pas de ses regles, sur son horloge) : rien ici ne les
// recalcule.
//
// Rend une arrivee par heure, dans l ordre du tunnel, avec la fin prevue de la
// visite. Une liste vide dit « rien a proposer », jamais « je ne sais pas ».
function proposedArrivals({
  centerId, date, formule, pax, blocks = [], laneStatuses = {},
}) {
  if (!formule || !date) return [];
  if (bookingDateOutOfRange(date) === 'far' || publicBookingBlockReason(centerId)) return [];
  if (date < todayStr()) return [];
  const { getFormulaAnchorAvailability, getFormulaAnchorModel } = require('./ops-engine');
  let centre = null;
  try {
    centre = getCenter(centerId) || null;
  } catch (error) {
    centre = null;
  }
  const schedule = getSchedule(date, centre);
  if (!schedule) return [];
  const groupe = Math.min(240, Math.max(1, Math.trunc(Number(pax) || 1)));
  if (!getFormuleAvailability(formule, date, groupe, '', centre).ok) return [];
  const blocsDuJour = resolveBlocksForDate(blocks, date);
  if (isFormulaFullyBlockedOn(blocsDuJour, date, formule.id)) return [];
  const snapshot = {
    date, centerId, reservations: [], laneStatuses, blocks: blocsDuJour,
  };
  const duration = getFormuleLaneDuration(formule);
  const guardContext = {
    centerId,
    date,
    type: 'formule',
    formuleId: formule.id,
    pax: groupe,
    duration,
    totalDuration: formulaOccupiedDuration(formule, schedule),
    laneCount: getRequiredLaneCount('formule', groupe, formule.id, centre?.resources?.bowling || null),
    requiresLanes: reservationNeedsLanes('formule', formule.id),
    label: formule.name,
    snapshot,
  };
  // Sans document au catalogue, le moteur ne sait rien composer : la route
  // jette sur getFormulaAnchorModel et ne sert aucun creneau. Rien, ici aussi.
  const formulaDoc = getFormula(formule.id);
  if (!formulaDoc) return [];
  const model = getFormulaAnchorModel(formulaDoc);
  let slots = [];
  if (model.anchors.length) {
    let anchorMeta = null;
    try {
      anchorMeta = getFormulaAnchorAvailability({
        centerId, formuleId: formule.id, date, pax: groupe, preferredTimes: {}, laserGameTimes: [],
      }, { reservations: [], laneStatuses, blocks: blocsDuJour });
    } catch (error) {
      anchorMeta = null;
    }
    slots = anchoredDefaultSlots({
      center: getCenter(centerId), formula: formulaDoc, date, pax: groupe, model, anchorMeta, snapshot, duration, guardContext,
    });
  } else {
    const fenetre = getFormuleArrivalWindow(formule, schedule);
    slots = plannedArrivalSlots({
      centerId,
      date,
      type: 'formule',
      formuleId: formule.id,
      pax: groupe,
      duration,
      minTime: fenetre.earliestStart,
      maxTime: fenetre.latestStart,
      preference: { firstActivityId: '', activityOrder: [], arrivalConfidence: 'normal', preferredTimes: {} },
      pauseMinutes: 0,
      snapshot,
      guardContext,
    });
  }
  const vues = new Set();
  return slots
    .filter((slot) => !vues.has(slot.time) && vues.add(slot.time))
    .map((slot) => ({ time: slot.time, endTime: (slot.opsPlan && slot.opsPlan.endTime) || '' }));
}

module.exports = {
  anchoredDefaultSlots,
  centerLaneBound,
  filterSlotsByFinalGuards,
  firstActivityTime,
  formulaOccupiedDuration,
  getFreeCount,
  laneWindowsFromReservation,
  plannedArrivalSlots,
  proposedArrivals,
  readBlockHour,
  slotPassesFinalGuards,
  toFormulaSlot,
};
