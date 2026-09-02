const assert = require('assert');
const { communicationAgent, delayAgent, learningAgent, planningAgent } = require('../lib/ops-agents');
const { computeDelayImpact, getRequiredLaneCount, getFormulaAnchorAvailability } = require('../lib/ops-engine');
const {
  buildClientMessage,
  buildDelayChangeMessage,
  buildMessage,
  listClientMessageChannels,
  listClientMessageTemplates,
  listDelayNotificationChannels,
  normalizePhoneForSms,
} = require('../lib/ops-communications');
const { getCenter, loadOpsKnowledge } = require('../lib/ops-knowledge');
const database = require('../lib/database');
const {
  FORMULES,
  getFormuleAvailability,
  getSchedule,
  parseLocalDate,
  todayStr,
} = require('../lib/booking-config');
const { normalizeReservationRequest } = require('../lib/reservation-request');

const publicAvailabilityPath = require.resolve('../api/public-availability');
const reservationOpsPath = require.resolve('../lib/reservation-ops');

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function findFutureFormulaDate({ formuleId = 'f4', pax = 17, startTime = '14:00' } = {}) {
  const formule = FORMULES.find((item) => item.id === formuleId);
  if (!formule) throw new Error(`Formule de test introuvable: ${formuleId}`);
  for (let offset = 1; offset <= 370; offset += 1) {
    const date = addDays(todayStr(), offset);
    const schedule = getSchedule(date);
    if (!schedule) continue;
    // JOUR QUI OUVRE A 10H, ET RIEN D'AUTRE. Le moteur exige l'arrivee 10 min
    // AVANT le depart (FORMULA_ARRIVAL_MINUTES), regle que getFormuleAvailability
    // ne connait pas : un mardi qui ouvre a 14h faisait refuser le depart 14:00
    // (arrivee 13:50 avant l'ouverture). Et plus bas, la suite ancre des
    // creneaux a 12:00 (wideGap) : elle suppose une ouverture matinale.
    // Mesure du 2026-08-24 : le 22/08 la date elue etait un dimanche d'ete
    // (ouverture 10h, suite verte) ; deux jours plus tard, un mardi (14h,
    // suite rouge), sans qu'une ligne de code ait change. Un gate qui depend
    // du jour ou on le lance apprend a ignorer ses rouges.
    if (Number(schedule.open) > 10) continue;
    if (getFormuleAvailability(formule, date, pax, startTime).ok) return date;
  }
  throw new Error(`Aucune date future compatible pour ${formuleId}.`);
}

const TEST_DATE = findFutureFormulaDate();

function testCompetitivePlaybookLoaded() {
  const knowledge = loadOpsKnowledge({ refresh: true });
  assert.ok(knowledge.competitivePlaybook, 'competitive playbook must be loaded');
  assert.ok(knowledge.competitivePlaybook.patterns.some((pattern) => pattern.id === 'entitlement_based_booking'));
  assert.ok(knowledge.competitivePlaybook.patterns.some((pattern) => pattern.id === 'shock_absorber_routing'));
}

function testLaneRules() {
  const center = getCenter('libramont');
  assert.strictEqual(getRequiredLaneCount(center, 6), 1);
  assert.strictEqual(getRequiredLaneCount(center, 7), 2);
  assert.strictEqual(getRequiredLaneCount(center, 8), 2);
  assert.strictEqual(getRequiredLaneCount(center, 17), 3);
  assert.strictEqual(getRequiredLaneCount(center, 50), 8);
  assert.strictEqual(getRequiredLaneCount(center, 57), 10);
}

function testFormulaPlanning() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f4',
    pax: 17,
    startTime: '14:00',
    preference: {
      arrivalConfidence: 'uncertain',
      firstActivityId: 'bowling',
    },
    pauseMinutes: 10,
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(result.agent, 'planning-agent');
  assert.ok(result.plan.recommended, 'expected recommended scenario');
  assert.strictEqual(result.decision, 'staff_review_required', 'FORMULE 4 must respect required human validation');
  assert.strictEqual(result.requiresHumanReview, true, 'FORMULE 4 should request staff review');
  assert.ok(result.plan.recommended.assignedLanes.length >= 3, '17 pax needs 3 lanes when bowling is present');
  assert.ok(['high', 'critical'].includes(result.plan.recommended.risk.level), 'large Libramont laser formula should be risky');
  assert.ok(result.plan.recommended.timeline.some((step) => step.activityId === 'laser_game'));
  assert.ok(result.plan.recommended.marketIntelligence.patterns.some((pattern) => pattern.id === 'entitlement_based_booking'));
  assert.ok(result.plan.recommended.entitlements.fixedCommitments.length >= 2, 'formula should expose fixed critical commitments');
  assert.ok(result.plan.recommended.operationsChecklist.length >= 1, 'formula should expose staff checklist');
}

// Modèle « Ancres + Liberté » : les heures choisies par activité (ancres
// bowling/laser) composent la visite telles quelles : validation serveur de la
// combinaison (grille :00/:30, pas de chevauchement, horaires, écart réaliste).
function testFormulaPreferredTimes() {
  const anchorRequest = (preferredTimes, extra = {}) => planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    preference: { preferredTimes, ...extra },
  }, {
    reservations: [],
    laneStatuses: {},
  });

  const locked = anchorRequest({ bowling: '15:00', laser_game: '16:30' });
  assert.strictEqual(locked.ok, true, 'a valid anchor combination must be bookable');
  const lockedPlan = locked.plan.recommended;
  const bowlingBlock = lockedPlan.resourceBlocks.find((block) => block.resourceType === 'bowling_lane');
  const laserBlocks = lockedPlan.resourceBlocks.filter((block) => block.resourceType === 'laser_arena');
  assert.strictEqual(bowlingBlock?.startTime, '15:00', 'bowling block must start at the chosen anchor time');
  assert.strictEqual(bowlingBlock?.endTime, '16:00', 'bowling block must keep the formula lane duration');
  assert.strictEqual(laserBlocks[0]?.startTime, '16:30', 'laser block must start at the chosen anchor time');
  assert.strictEqual(lockedPlan.startTime, '15:00', 'program start = first anchor');
  assert.strictEqual(lockedPlan.arrivalTime, '14:50', 'arrival stays 10 minutes before the first anchor');
  assert.ok(
    lockedPlan.timeline.filter((step) => step.flexible).length >= 1,
    'free activities must stay in the plan as flexible pass entries',
  );
  assert.ok(
    lockedPlan.timeline.filter((step) => step.flexible).every((step) => step.startTime === lockedPlan.startTime),
    'flexible pass entries carry no dedicated schedule (whole visit window)',
  );

  // ENCHAINEMENT COLLÉ (2026-08-24, Movsar : « on finit le bowling à 15h30
  // et on est obligé d'attendre 30 minutes, c'est con »). La « transition »
  // de 5 minutes, croisée à la grille de 30, transformait ce choix réalisable
  // en refus anchor_overlap : marcher de la piste à l'arène ne prend pas une
  // demi-heure. Seul le VRAI chevauchement reste interdit.
  // L OUVERTURE EST OFFERTE (2026-08-25, Movsar : « des qu il y a du laser
  // on ne peut plus prendre l heure d ouverture »). L accueil 10 min est
  // un CONSEIL : la grille des ancres demarre a l ouverture, et composer
  // cette heure-la passe. TEST_DATE ouvre a 10h pile (le selecteur exige
  // open <= 10 et aucun centre Fun Galaxy n ouvre avant 10h).
  {
    const availability = getFormulaAnchorAvailability(
      { centerId: 'libramont', formuleId: 'f1', date: TEST_DATE, pax: 10 },
      { reservations: [], laneStatuses: {} },
    );
    assert.strictEqual(availability.ok, true, 'anchor availability must resolve on the test day');
    const bowlingTimes = availability.activities.find((activity) => activity.activityId === 'bowling');
    assert.strictEqual(bowlingTimes.times[0].time, '10:00',
      `the first bowling anchor must be the OPENING hour, not opening+welcome (got ${bowlingTimes.times[0].time})`);
    // Listee ne suffit pas : depuis le 2026-09-03 la grille rend aussi les
    // heures impossibles (ok:false). L ouverture doit etre RESERVABLE.
    assert.notStrictEqual(bowlingTimes.times[0].ok, false,
      `the opening hour must be bookable, not merely listed (reason: ${bowlingTimes.times[0].reason || ''})`);
    const laserTimes = availability.activities.find((activity) => activity.activityId === 'laser_game');
    const laserAfterOpen = laserTimes.times.find((item) => item.ok !== false && item.time >= '11:00');
    const atOpen = anchorRequest({ bowling: '10:00', laser_game: laserAfterOpen.time });
    assert.strictEqual(atOpen.ok, true, 'booking the opening hour with a laser after must compose');
  }

  const chained = anchorRequest({ bowling: '15:00', laser_game: '16:00' });
  assert.strictEqual(chained.ok, true, 'back-to-back anchors (gap 0) must be bookable');
  assert.ok(
    chained.plan.recommended.resourceBlocks.some((block) => block.resourceType === 'laser_arena' && block.startTime === '16:00'),
    'the chained laser block starts exactly when bowling ends',
  );
  assert.strictEqual(
    (chained.plan.recommended.comfortNotices || []).length, 0,
    'chaining is the most comfortable choice: no notice',
  );

  // Ordre inversé (laser avant bowling) : toujours un vrai choix par ancre.
  const reversed = anchorRequest({ bowling: '17:00', laser_game: '16:00' });
  assert.strictEqual(reversed.ok, true, 'anchors can be booked in any order');
  assert.strictEqual(reversed.plan.recommended.startTime, '16:00', 'program start follows the earliest anchor');

  const overlapping = anchorRequest({ bowling: '15:00', laser_game: '15:30' });
  assert.strictEqual(overlapping.ok, false, 'overlapping anchors must be refused');
  assert.strictEqual(overlapping.plan.refusalCode, 'anchor_overlap');
  assert.ok(overlapping.plan.anchorSuggestions.length >= 1, 'a refusal must come with close suggestions');

  const offGrid = anchorRequest({ bowling: '15:00', laser_game: '16:15' });
  assert.strictEqual(offGrid.ok, false, 'off-grid anchor times must be refused');
  assert.strictEqual(offGrid.plan.refusalCode, 'off_grid');

  const impossible = anchorRequest({ bowling: '08:00', laser_game: '16:30' });
  assert.strictEqual(impossible.ok, false, 'impossible preferred formula times must be rejected');

  // LIBERTÉ DU CLIENT (arbitrage Movsar du 2026-08-15, qui renverse la règle
  // précédente) : un grand trou entre deux activités est un INCONFORT, pas une
  // impossibilité. Le moteur laisse passer et PRÉVIENT. Il ne refuse plus.
  const wideGap = anchorRequest({ bowling: '12:00', laser_game: '19:00' });
  assert.strictEqual(wideGap.ok, true, 'a wide gap between anchors must stay bookable: the client decides');
  assert.strictEqual(wideGap.plan.refusalCode, '', 'a wide gap must not produce any refusal code');
  const gapNotice = (wideGap.plan.recommended.comfortNotices || []).find((notice) => notice.code === 'anchor_gap');
  assert.ok(gapNotice, 'a wide gap must come back as a comfort notice');
  assert.strictEqual(gapNotice.gapMinutes, 360, 'the notice states the real waiting time');
  assert.strictEqual(gapNotice.gapLabel, '6 h', 'the notice is readable by a customer, not in raw minutes');
  // 13:00, pas 13:30 : « enchaîner » veut dire coller les deux activités.
  // L'ancienne valeur portait la marge de 5 min arrondie a la grille, soit
  // 30 minutes d'attente offertes a quelqu'un qui venait de demander zero.
  assert.strictEqual(gapNotice.tightenTime, '13:00', 'the notice offers the closest time that chains both activities');
  assert.strictEqual(gapNotice.severity, 'advice', 'a comfort notice is an advice, never a blocker');
  // Le bloc laser est bien posé à l'heure demandée : prévenir n'est pas
  // corriger en douce le choix du client.
  assert.ok(
    wideGap.plan.recommended.resourceBlocks.some((block) => block.resourceType === 'laser_arena' && block.startTime === '19:00'),
    'the engine books exactly what the customer chose, it does not silently move it',
  );
  // Une combinaison confortable ne fabrique aucun avis (pas de bruit).
  assert.strictEqual(
    (locked.plan.recommended.comfortNotices || []).length, 0,
    'a comfortable combination carries no notice at all',
  );

  // Option « Je place mes parties laser sur place » : seul le bowling est
  // fixé, le laser reste un crédit à placer selon l'affluence.
  const onSite = anchorRequest({ bowling: '15:00' }, { laserPlacement: 'onsite' });
  assert.strictEqual(onSite.ok, true, 'laser on-site option must stay bookable');
  const onSitePlan = onSite.plan.recommended;
  assert.ok(!onSitePlan.resourceBlocks.some((block) => block.resourceType === 'laser_arena'), 'on-site laser must not lock the arena');
  assert.strictEqual(onSitePlan.laserPassPlan.scheduledGames, 0);
  assert.strictEqual(onSitePlan.laserPassPlan.remainingGames, 1);

  // Formule à ancre laser unique (f5, 2 parties) : une seule session fixée,
  // le reste en crédit : jamais deux sessions imposées d'affilée.
  const laserOnly = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f5',
    pax: 10,
    preference: { preferredTimes: { laser_game: '15:00' } },
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(laserOnly.ok, true, 'single-anchor laser formula must be bookable at the chosen time');
  const laserOnlyPlan = laserOnly.plan.recommended;
  assert.strictEqual(laserOnlyPlan.resourceBlocks.filter((block) => block.resourceType === 'laser_arena').length, 1);
  assert.strictEqual(laserOnlyPlan.laserPassPlan.totalGames, 2);
  assert.strictEqual(laserOnlyPlan.laserPassPlan.remainingGames, 1, 'second laser game stays a flexible credit');
}

// Table anniversaire : jamais une ancre, elle suit l'arrivée et couvre toute
// la visite pour le staff, sans aucune heure à choisir côté client.
function testPartyTableFollowsArrival() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f7',
    pax: 8,
    startTime: '15:00',
  }, { reservations: [], laneStatuses: {} });

  assert.strictEqual(result.ok, true, 'table formulas must be plannable');
  const plan = result.plan.recommended;
  const tableBlock = plan.resourceBlocks.find((block) => block.resourceType === 'party_table');
  assert.ok(tableBlock, 'table formulas must produce an internal party_table block');
  assert.strictEqual(tableBlock.startTime, plan.arrivalTime, 'table is blocked from the group arrival');
  assert.strictEqual(tableBlock.endTime, plan.timeline[plan.timeline.length - 1].endTime, 'table stays blocked until the end of the visit');
  assert.ok(tableBlock.followsArrival, 'table block must be flagged as following the arrival');
}

function testLaserConflict() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f5',
    pax: 16,
    startTime: '14:00',
  }, {
    reservations: [
      {
        id: 1,
        type: 'formule',
        formuleId: 'f5',
        startTime: '14:00',
        duration: 1,
        pax: 16,
        lanes: [],
      },
    ],
    laneStatuses: {},
  });

  assert.ok(result.plan.scenarios.some((scenario) => scenario.conflicts.some((conflict) => conflict.type === 'laser_conflict')));
}

function testStandaloneLaserPlanning() {
  const existingPlan = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 8,
    startTime: '15:00',
    duration: 0.5,
  }, { reservations: [], laneStatuses: {} }).plan.recommended;
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 10,
    startTime: '15:00',
    duration: 0.5,
    laserGames: 1,
  }, {
    reservations: [
      {
        id: 2,
        type: 'laser',
        startTime: '15:00',
        duration: 0.5,
        pax: 8,
        lanes: [],
        opsPlan: existingPlan,
      },
    ],
    laneStatuses: {},
  });

  assert.strictEqual(result.agent, 'planning-agent');
  assert.ok(result.ok, 'laser session should accept sharing while capacity remains');
  assert.strictEqual(result.plan.recommended.assignedLanes.length, 0);
  assert.ok(result.plan.recommended.resourceBlocks.some((block) => block.resourceType === 'laser_arena'));
  assert.ok(result.plan.recommended.laserSharing.mayShare);
  assert.ok(result.plan.recommended.marketIntelligence.sourcePatternIds.includes('shared_session_capacity'));
}

function testShockAbsorberRouting() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f4',
    pax: 10,
    startTime: '14:00',
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.ok(result.plan.scenarios.some((scenario) =>
    scenario.marketIntelligence?.qualitySignals?.some((signal) => /amortisseur/i.test(signal))),
  'expected at least one scenario using a soft activity as shock absorber');
}

function testCommunicationCommitmentModel() {
  const planned = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '14:00',
  }, {
    reservations: [],
    laneStatuses: {},
  });
  const mail = communicationAgent({
    centerId: 'libramont',
    formuleId: 'f1',
    name: 'Client Test',
    plan: planned.plan,
  });

  assert.ok(mail.commitmentModel.stages.includes('rappel J-2'));
  assert.ok(mail.reminders.every((reminder) => reminder.channel === 'email'), 'SMS must stay standby until provider is chosen');
  assert.ok(mail.body.includes('Créneaux prévus'), 'mail should expose planned critical commitments');
}

function testStandaloneLaserCapacityBlock() {
  const existingPlan = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 8,
    startTime: '15:00',
    duration: 0.5,
  }, { reservations: [], laneStatuses: {} }).plan.recommended;
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 26,
    startTime: '15:00',
    duration: 0.5,
  }, {
    reservations: [
      {
        id: 3,
        type: 'laser',
        startTime: '15:00',
        duration: 0.5,
        pax: 8,
        lanes: [],
        opsPlan: existingPlan,
      },
    ],
    laneStatuses: {},
  });

  assert.strictEqual(result.ok, false, 'laser must block when weapon capacity is exceeded');
  assert.ok(result.plan.scenarios.some((scenario) => scenario.conflicts.some((conflict) => conflict.type === 'laser_conflict')));
}

function testStandaloneLaserExactRemainingCapacity() {
  const existingPlan = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 23,
    startTime: '15:30',
    duration: 0.5,
  }, { reservations: [], laneStatuses: {} }).plan.recommended;

  const accepted = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 7,
    startTime: '15:30',
    duration: 0.5,
    laserGames: 1,
  }, {
    reservations: [
      {
        id: 4,
        type: 'laser',
        startTime: '15:30',
        duration: 0.5,
        pax: 23,
        lanes: [],
        opsPlan: existingPlan,
      },
    ],
    laneStatuses: {},
  });

  assert.strictEqual(accepted.ok, true, '7 players must fit when exactly 7 laser places remain');
  assert.strictEqual(accepted.plan.recommended.laserSharing.playersTotal, 30);

  const refused = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 8,
    startTime: '15:30',
    duration: 0.5,
    laserGames: 1,
  }, {
    reservations: [
      {
        id: 5,
        type: 'laser',
        startTime: '15:30',
        duration: 0.5,
        pax: 23,
        lanes: [],
        opsPlan: existingPlan,
      },
    ],
    laneStatuses: {},
  });

  assert.strictEqual(refused.ok, false, '8 players must not fit when only 7 laser places remain');
}

function testStandaloneLaserSplitGroup() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 50,
    startTime: '14:00',
    duration: 0.5,
    laserGames: 1,
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(result.ok, true, 'laser should split groups above 30 into multiple waves');
  assert.strictEqual(result.plan.recommended.laserSharing.waveCount, 2);
  assert.ok(result.plan.recommended.resourceBlocks.every((block) => block.players <= 30));
}

function testDelayAgent() {
  const planned = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '15:00',
  }, {
    reservations: [],
    laneStatuses: {},
  });

  const delay = delayAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    reasonId: 'incomplete_group',
    delayMinutes: 15,
    plan: planned.plan.recommended,
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(delay.agent, 'delay-agent');
  assert.ok(delay.impact.actions.some((action) => action.includes('laser')));
}

function testDelayAgentAbsorbableShift() {
  const planned = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 6,
    startTime: '14:00',
    duration: 1,
  }, {
    reservations: [],
    laneStatuses: {},
  });

  const delay = delayAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 6,
    startTime: '14:00',
    duration: 1,
    delayMinutes: 10,
    plan: planned.plan.recommended,
    reservation: { id: 901, type: 'bowling', pax: 6, startTime: '14:00', duration: 1 },
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(delay.agent, 'delay-agent');
  assert.strictEqual(delay.ok, true, '10 min delay should be absorbable on an empty day');
  assert.strictEqual(delay.impact.status, 'absorbable');
  assert.strictEqual(delay.impact.canApply, true);
  assert.strictEqual(delay.impact.proposedStartTime, '14:10');
  assert.strictEqual(delay.impact.shiftedPlan.startTime, '14:10');
  assert.ok(delay.impact.confirmation.required, 'staff must explicitly confirm applying a delay');
}

function testDelayAgentFallbackPlanFromReservation() {
  const delay = delayAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    delayMinutes: 5,
    reservation: {
      id: 903,
      centerId: 'libramont',
      date: TEST_DATE,
      type: 'bowling',
      pax: 6,
      startTime: '14:00',
      duration: 1,
      lanes: [3],
    },
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(delay.ok, true, 'delay must work even when an older reservation has no opsPlan');
  assert.strictEqual(delay.impact.previousStartTime, '14:00');
  assert.strictEqual(delay.impact.proposedStartTime, '14:05');
  assert.deepStrictEqual(delay.impact.shiftedPlan.assignedLanes, [3]);
}

function testDelayAgentProposesAlternativesWhenBlocked() {
  const planned = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 6,
    startTime: '14:00',
    duration: 1,
  }, {
    reservations: [],
    laneStatuses: {},
  });
  const blockers = Array.from({ length: 8 }, (_, index) => ({
    id: 1000 + index,
    type: 'bowling',
    startTime: '14:30',
    duration: 1,
    pax: 6,
    lanes: [index + 1],
  }));

  const delay = delayAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 6,
    startTime: '14:00',
    duration: 1,
    delayMinutes: 30,
    plan: planned.plan.recommended,
    reservation: { id: 902, type: 'bowling', pax: 6, startTime: '14:00', duration: 1 },
  }, {
    reservations: blockers,
    laneStatuses: {},
  });

  assert.strictEqual(delay.ok, false, 'blocked delay must not be applied silently');
  assert.strictEqual(delay.impact.status, 'alternative_required');
  assert.strictEqual(delay.impact.canApply, false);
  assert.ok(delay.impact.alternatives.length >= 1, 'blocked delay should propose feasible alternatives');
  assert.ok(delay.impact.actions.some((action) => /alternative/i.test(action)));
}

// === Moteur d'impact retard (cascade + alternatives) ========================
function delayImpactBaseReservations() {
  return {
    delayed: {
      id: 1, name: 'Groupe Retarde', email: 'retarde@example.test', date: TEST_DATE,
      startTime: '14:00', duration: 1, pax: 6, type: 'bowling', lanes: [1], status: 'pending',
    },
    downstream: {
      id: 2, name: 'Groupe Suivant', email: 'suivant@example.test', date: TEST_DATE,
      startTime: '15:00', duration: 1, pax: 6, type: 'bowling', lanes: [1], status: 'pending',
    },
  };
}

// Préférence n°1 : la résa RETARDÉE change de piste, personne d'autre ne bouge.
function testDelayImpactPrefersRelocatingDelayed() {
  const { delayed, downstream } = delayImpactBaseReservations();
  const impact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 15, reasonId: 'late_customer', reservationId: 1 },
    { reservations: [delayed, downstream], laneStatuses: {} },
  );

  assert.strictEqual(impact.status, 'conflicts', 'lane 1 collision must be detected before applying anything');
  assert.strictEqual(impact.recommendedStrategyId, 'relocate_delayed', 'moving the DELAYED group to a free lane must be the first choice');
  assert.deepStrictEqual(impact.strategies.map((strategy) => strategy.id), ['relocate_delayed', 'relocate_downstream', 'cascade'], 'strategies keep the business preference order');
  const relocation = impact.strategies[0];
  assert.strictEqual(relocation.feasible, true);
  assert.strictEqual(relocation.changes.length, 1, 'only the delayed reservation moves');
  const change = relocation.changes[0];
  assert.strictEqual(change.newStartTime, '14:15');
  assert.strictEqual(change.laneChanged, true, 'the delayed group takes another free lane');
  assert.ok(!change.newLanes.includes(1), 'the conflicting lane is released');
  assert.strictEqual(impact.confirmation.required, true, 'staff must validate before anything is applied');
  assert.strictEqual(impact.notifications.automatic, false, 'no notification is ever automatic');
  assert.strictEqual(impact.notifications.requiresExplicitConfirmation, true);
}

// Préférence n°2 : si la retardée ne peut pas bouger de piste, les résas
// SUIVANTES changent de piste en gardant leur heure.
function testDelayImpactRelocatesDownstreamWhenDelayedIsStuck() {
  const { delayed, downstream } = delayImpactBaseReservations();
  // Pistes 2-8 occupées de 13:30 à 15:00 : impossible de reloger la retardée
  // (sa fenêtre décalée 14:15-15:15 chevauche), mais la suivante (15:00) peut
  // passer sur une piste libérée à 15:00.
  const blockers = Array.from({ length: 7 }, (_, index) => ({
    id: 100 + index, name: `Bloqueur ${index + 2}`, date: TEST_DATE, startTime: '13:30',
    duration: 1.5, pax: 6, type: 'bowling', lanes: [index + 2], status: 'pending',
  }));
  const impact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 15, reservationId: 1 },
    { reservations: [delayed, downstream, ...blockers], laneStatuses: {} },
  );

  const relocateDelayed = impact.strategies.find((strategy) => strategy.id === 'relocate_delayed');
  assert.strictEqual(relocateDelayed.feasible, false, 'no free lane exists for the delayed group on its shifted window');
  assert.strictEqual(impact.recommendedStrategyId, 'relocate_downstream');
  const relocateDownstream = impact.strategies.find((strategy) => strategy.id === 'relocate_downstream');
  assert.strictEqual(relocateDownstream.feasible, true);
  const downstreamChange = relocateDownstream.changes.find((change) => change.reservationId === 2);
  assert.strictEqual(downstreamChange.kind, 'relocate');
  assert.strictEqual(downstreamChange.newStartTime, '15:00', 'downstream keeps its time and only changes lane');
  assert.strictEqual(downstreamChange.laneChanged, true);
  assert.ok(/heure inchangée/.test(downstreamChange.summary), 'staff summary must say the time is unchanged');
}

// Préférence n°3 : cascade MINIMALE, chaque résa aval décalée du strict
// nécessaire, un trou de planning absorbe une partie du retard.
function testDelayImpactCascadeUsesMinimalShift() {
  const { delayed, downstream } = delayImpactBaseReservations();
  const gapDownstream = { ...downstream, startTime: '15:30' };
  const maintenance = { 2: 'maintenance', 3: 'maintenance', 4: 'maintenance', 5: 'maintenance', 6: 'maintenance', 7: 'maintenance', 8: 'maintenance' };
  const impact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 45, reservationId: 1 },
    { reservations: [delayed, gapDownstream], laneStatuses: maintenance },
  );

  assert.strictEqual(impact.recommendedStrategyId, 'cascade', 'with every other lane in maintenance only the cascade remains');
  const cascade = impact.strategies.find((strategy) => strategy.id === 'cascade');
  assert.strictEqual(cascade.feasible, true);
  const delayedChange = cascade.changes.find((change) => change.reservationId === 1);
  const downstreamChange = cascade.changes.find((change) => change.reservationId === 2);
  assert.strictEqual(delayedChange.newStartTime, '14:45');
  assert.strictEqual(downstreamChange.newStartTime, '15:45', 'the 30 min gap absorbs part of the 45 min delay');
  assert.strictEqual(downstreamChange.shiftMinutes, 15, 'downstream is shifted by the strict minimum, not the full delay');
}

// Formule : un retard sur l'ancre bowling recale le programme, la table suit
// l'arrivée, les ancres aval ne glissent QUE si nécessaire.
function testDelayImpactFormulaProgramRecomputed() {
  const planned = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    preference: { preferredTimes: { bowling: '15:00', laser_game: '16:30' } },
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(planned.ok, true);
  const reservation = {
    id: 30, name: 'Anniversaire Formule', email: 'formule@example.test', date: TEST_DATE,
    startTime: '15:00', duration: 1, totalDuration: 2.5, pax: 10, type: 'formule', formuleId: 'f1',
    lanes: planned.plan.recommended.assignedLanes, status: 'pending', opsPlan: planned.plan.recommended,
  };

  // Retard court : le trou avant le laser absorbe tout, l'ancre laser ne bouge pas.
  const small = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 15, reservationId: 30 },
    { reservations: [reservation], laneStatuses: {} },
  );
  assert.strictEqual(small.status, 'no_conflict');
  const smallPlan = small.strategies[0].changes[0].update.opsPlan;
  const smallBowling = smallPlan.resourceBlocks.find((block) => block.resourceType === 'bowling_lane');
  const smallLaser = smallPlan.resourceBlocks.find((block) => block.resourceType === 'laser_arena');
  assert.strictEqual(smallBowling.startTime, '15:15', 'the delayed bowling anchor slides by the delay');
  assert.strictEqual(smallLaser.startTime, '16:30', 'the laser anchor stays: the gap absorbs the delay');
  assert.strictEqual(small.strategies[0].changes[0].update.startTime, '15:15');

  // Retard long : l'ancre laser aval glisse au PROCHAIN DEPART de la grille
  // (:00/:30) apres la fin du bowling + transition. Avant le 2026-08-26 elle
  // glissait « juste assez » (17:35) : c'est exactement ce que Movsar a rejete
  // en review (« session de 13:45 a 14:10, pourquoi 13:45 ?? ») : un lancement
  // laser a l'heure fine est illisible au planning (rangees de 30 min),
  // impossible a rejoindre (cle de session exacte) et faux dans le compte
  // d'armes par tranche.
  const large = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 90, reservationId: 30 },
    { reservations: [reservation], laneStatuses: {} },
  );
  const largePlan = large.strategies[0].changes[0].update.opsPlan;
  const largeBowling = largePlan.resourceBlocks.find((block) => block.resourceType === 'bowling_lane');
  const largeLaser = largePlan.resourceBlocks.find((block) => block.resourceType === 'laser_arena');
  assert.strictEqual(largeBowling.startTime, '16:30');
  assert.strictEqual(largeLaser.startTime, '18:00', 'the laser anchor slides to the NEXT grid launch after bowling end + transition (17:35 -> 18:00)');

  // Formule table (f7) : la table suit l'arrivée décalée.
  const tablePlanned = planningAgent({
    centerId: 'libramont', date: TEST_DATE, type: 'formule', formuleId: 'f7', pax: 8, startTime: '15:00',
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(tablePlanned.ok, true);
  const tableReservation = {
    id: 31, name: 'Anniversaire Table', date: TEST_DATE, startTime: '15:00', duration: 2.5, pax: 8,
    type: 'formule', formuleId: 'f7', lanes: [], status: 'pending', opsPlan: tablePlanned.plan.recommended,
  };
  const tableImpact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 20, reservationId: 31 },
    { reservations: [tableReservation], laneStatuses: {} },
  );
  const shiftedTable = tableImpact.strategies[0].changes[0].update.opsPlan.resourceBlocks
    .find((block) => block.resourceType === 'party_table');
  assert.strictEqual(shiftedTable.startTime, '15:10', 'the table follows the shifted arrival (14:50 + 20)');
}

// Fin de journée : si la cascade dépasse la fermeture, le preview le signale
// et le choix reste au staff (rien n'est bloqué silencieusement).
function testDelayImpactFlagsClosingOverrun() {
  const schedule = getSchedule(TEST_DATE);
  const closeMinutes = Math.round(schedule.close * 60);
  const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const lateReservation = {
    id: 40, name: 'Groupe Tardif', email: 'tardif@example.test', date: TEST_DATE,
    startTime: toTime(closeMinutes - 60), duration: 1, pax: 6, type: 'bowling', lanes: [1], status: 'pending',
  };
  const impact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 30, reservationId: 40 },
    { reservations: [lateReservation], laneStatuses: {} },
  );
  const strategy = impact.strategies.find((item) => item.feasible);
  assert.ok(strategy, 'the shift itself stays possible: the staff decides');
  const change = strategy.changes[0];
  assert.strictEqual(change.overClosingMinutes, 30, 'the closing overrun must be measured');
  assert.ok(strategy.warnings.some((warning) => /fermeture/.test(warning)), 'the preview must flag the closing overrun');
  assert.strictEqual(impact.closingTime, toTime(closeMinutes));
}

// Laser : les autres groupes d'un lancement partagé ne bougent pas, et la
// résa retardée rejoint un lancement compatible plutôt que de tout décaler.
function testDelayImpactLaserSharedSession() {
  const delayedLaser = {
    id: 50, name: 'Laser Retarde', email: 'laser@example.test', date: TEST_DATE,
    startTime: '15:00', duration: 0.5, pax: 6, type: 'laser', lanes: [], status: 'pending',
  };
  const sameSession = {
    id: 51, name: 'Laser Partage', date: TEST_DATE,
    startTime: '15:00', duration: 0.5, pax: 10, type: 'laser', lanes: [], status: 'pending',
  };
  const nextSession = {
    id: 52, name: 'Laser Suivant', date: TEST_DATE,
    startTime: '15:30', duration: 0.5, pax: 8, type: 'laser', lanes: [], status: 'pending',
  };
  const impact = computeDelayImpact(
    { centerId: 'libramont', date: TEST_DATE, delayMinutes: 15, reservationId: 50 },
    { reservations: [delayedLaser, sameSession, nextSession], laneStatuses: {} },
  );

  assert.ok(impact.warnings.some((warning) => /partagé/.test(warning)), 'the shared launch must be flagged: other groups stay on time');
  // Depuis la grille des departs laser (2026-08-26, review Movsar : plus
  // jamais de lancement a 15:15), un retard de 15 min SNAPPE le groupe sur le
  // prochain depart : le simple decalage atterrit DEJA sur le lancement de
  // 15:30, donc la strategie recommandee peut etre « shift » comme
  // « relocate_delayed » : ce qui compte est le COMPORTEMENT : le groupe part
  // a 15:30, sur la grille, et personne d autre ne bouge.
  const recommended = impact.strategies.find((strategy) => strategy.id === impact.recommendedStrategyId);
  assert.ok(recommended, 'a strategy is recommended');
  assert.strictEqual(recommended.feasible, true);
  const delayedChanges = recommended.changes.filter((change) => change.reservationId === 50);
  assert.strictEqual(delayedChanges.length, 1, 'the delayed group has exactly one change');
  assert.strictEqual(recommended.changes.length, 1, 'nobody else moves');
  assert.strictEqual(delayedChanges[0].newStartTime, '15:30', 'the delayed group lands on the 15:30 grid launch, never 15:15');
}

// Canal de notification : email actif, SMS prévu mais inactif, et le message
// par client couvre décalage ET changement de piste.
function testDelayNotificationChannelsAndMessages() {
  const channels = listDelayNotificationChannels();
  const email = channels.find((channel) => channel.id === 'email');
  const sms = channels.find((channel) => channel.id === 'sms');
  assert.ok(email && email.available, 'email channel must be available');
  assert.ok(sms && sms.available === false, 'sms channel exists but stays inactive without provider config');

  const reservation = {
    id: 2, centerId: 'libramont', name: 'Groupe Suivant', email: 'suivant@example.test',
    date: TEST_DATE, startTime: '15:15', pax: 6, type: 'bowling', label: 'Bowling classique',
  };
  const shifted = buildDelayChangeMessage({
    reservation,
    change: { kind: 'shift', previousStartTime: '15:00', newStartTime: '15:15', shiftMinutes: 15, previousLanes: [1], newLanes: [1], laneChanged: false },
  });
  assert.ok(shifted.body.includes('15:00') && shifted.body.includes('15:15'), 'the shift email states old and new time');
  assert.ok(shifted.body.includes('reste bien confirmée'), 'the email stays reassuring');

  const relocated = buildDelayChangeMessage({
    reservation,
    change: { kind: 'relocate', previousStartTime: '15:00', newStartTime: '15:00', shiftMinutes: 0, previousLanes: [1], newLanes: [5], laneChanged: true },
  });
  assert.ok(/piste 5/.test(relocated.body), 'the lane-change email names the new lane');
  assert.ok(!/décalé de/.test(relocated.body), 'a pure lane change never announces a time shift');
}

// Centre de communication client : bibliothèque de modèles pré-remplis,
// éditables, et état des canaux (email actif, SMS inactif sans config).
function testClientMessageCenter() {
  const templates = listClientMessageTemplates();
  assert.ok(templates.length >= 9, 'client message library should offer at least 9 templates');
  const ids = templates.map((template) => template.id);
  ['confirmation', 'reminder', 'delay', 'reschedule', 'cancellation', 'thanks', 'practical_info', 'promo', 'custom']
    .forEach((id) => assert.ok(ids.includes(id), `template ${id} must exist`));

  const reservation = {
    id: 42, centerId: 'libramont', name: 'Marie Dupont', email: 'marie@example.test', phone: '0470111222',
    date: '2026-07-11', startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4',
  };

  const email = buildClientMessage({ reservation, templateId: 'reminder', channel: 'email' });
  assert.ok(email.subject && email.subject.length > 3, 'email template has a subject');
  assert.ok(email.body.includes('Marie Dupont'), 'email is personalised with the client name');
  assert.ok(email.body.includes('11/07/2026') && email.body.includes('15:00'), 'email is filled with date and time');
  assert.ok(email.body.includes('FORMULE 4'), 'email is filled with the activity/offer');

  const sms = buildClientMessage({ reservation, templateId: 'reminder', channel: 'sms' });
  assert.ok(sms.body.length > 0 && sms.body.length <= 320, 'sms body stays short');
  assert.ok(sms.body.includes('11/07/2026'), 'sms is filled with the date');

  const channels = listClientMessageChannels(reservation);
  const emailChannel = channels.find((channel) => channel.id === 'email');
  const smsChannel = channels.find((channel) => channel.id === 'sms');
  assert.ok(emailChannel && emailChannel.available, 'email channel is active immediately');
  assert.ok(emailChannel.hasRecipient, 'email recipient detected from reservation email');
  assert.ok(smsChannel && smsChannel.available === false, 'sms channel stays inactive without Twilio config');
  assert.ok(smsChannel.unavailableReason && /Twilio/i.test(smsChannel.unavailableReason), 'sms explains it needs Twilio');
  assert.ok(smsChannel.hasRecipient, 'sms recipient detected from reservation phone');

  const noContact = listClientMessageChannels({ id: 1, centerId: 'libramont', name: 'Sans Contact', date: '2026-07-11', startTime: '15:00' });
  assert.ok(noContact.find((channel) => channel.id === 'email').hasRecipient === false, 'missing email means no recipient');
}

// Le corps relu/modifié par le staff (override) doit rester une chaîne éditable
// distincte du template généré, tout en gardant le rendu généré comme repli.
function testDelayNotificationEditableOverride() {
  const reservation = {
    id: 7, centerId: 'libramont', name: 'Groupe Suivant', email: 'suivant@example.test',
    date: TEST_DATE, startTime: '15:15', pax: 6, type: 'bowling', label: 'Bowling classique',
  };
  const change = { kind: 'shift', previousStartTime: '15:00', newStartTime: '15:15', shiftMinutes: 15, previousLanes: [1], newLanes: [1], laneChanged: false };
  const generated = buildDelayChangeMessage({ reservation, change });
  assert.ok(generated.body.includes('15:15'), 'generated delay message is available as a prefill');
  assert.ok(typeof generated.subject === 'string' && generated.subject.length > 0, 'generated message exposes an editable subject');
}

function testDelayEmailTemplate() {
  const message = buildMessage({
    templateId: 'delay_update',
    channel: 'email',
    reservation: {
      centerId: 'libramont',
      name: 'Client Test',
      email: 'client@example.com',
      date: TEST_DATE,
      startTime: '15:10',
      pax: 6,
      type: 'bowling',
      label: 'Bowling classique',
      delayUpdate: {
        previousStartTime: '15:00',
        proposedStartTime: '15:10',
        delayMinutes: 10,
        reason: 'Retard signale',
      },
    },
  });

  // On teste le CONTRAT du message (les deux horaires sont dits, le client est
  // rassure sur le maintien de sa reservation, le sujet porte le nouvel
  // horaire), pas une formulation exacte : figer la copie dans un assert
  // interdit toute reecriture editoriale sans casser la suite.
  assert.ok(message.subject.includes('15:10'), 'le sujet porte le nouvel horaire');
  assert.ok(message.body.includes('15:00'), "l'ancien horaire est rappele");
  assert.ok(message.body.includes('15:10'), 'le nouvel horaire est annonce');
  assert.ok(/reste confirm/i.test(message.body), 'le client est rassure : la reservation tient');
}

function testLearningAgent() {
  const events = Array.from({ length: 10 }, (_, index) => ({
    centerId: 'libramont',
    formulaId: 'f4',
    activityId: 'laser_game',
    plannedMinutes: 30,
    actualMinutes: 39 + (index % 3),
  }));

  const learning = learningAgent({ events });
  assert.strictEqual(learning.agent, 'learning-agent');
  assert.ok(learning.suggestions.length >= 1, 'expected a duration adjustment suggestion');
  assert.strictEqual(learning.appliedAutomatically, false);
}

function testPhoneNormalization() {
  assert.strictEqual(normalizePhoneForSms('0470 12 34 56'), '+32470123456');
  assert.strictEqual(normalizePhoneForSms('+33 6 12 34 56 78'), '+33612345678');
  assert.strictEqual(normalizePhoneForSms('0032 470 12 34 56'), '+32470123456');
}

function testRequestTypeGuardrails() {
  const staleBowling = normalizeReservationRequest({
    centerId: 'libramont',
    type: 'bowling',
    formuleId: 'f1',
    formulaId: 'f1',
    label: 'FORMULE 1',
    opsPlan: {
      formulaId: 'f1',
      resourceBlocks: [
        { resourceType: 'bowling_lane', startTime: '14:00', endTime: '15:00' },
        { resourceType: 'laser_arena', startTime: '15:10', endTime: '15:35' },
      ],
    },
    date: TEST_DATE,
    startTime: '14:00',
    pax: 6,
    duration: 1,
  }, { channel: 'public' });

  assert.strictEqual(staleBowling.type, 'bowling', 'explicit bowling type must win over stale formula fields');
  assert.strictEqual(staleBowling.formuleId, '', 'bowling must clear stale formuleId');
  assert.strictEqual(staleBowling.formulaId, '', 'bowling must clear stale formulaId');
  assert.strictEqual(staleBowling.label, 'Bowling Classique', 'bowling must clear stale formula label');
  assert.strictEqual(staleBowling.opsPlan, null, 'bowling must drop stale formula ops plan');

  const bowlingPlan = planningAgent(staleBowling, { reservations: [], laneStatuses: {} });
  assert.strictEqual(bowlingPlan.ok, true, 'stale formula fields must not block bowling planning');
  assert.strictEqual(bowlingPlan.plan.type, 'bowling', 'planner must keep explicit bowling type');
  assert.strictEqual(Boolean(bowlingPlan.plan.formulaId), false, 'bowling plan must not expose formula id');

  const staleLaser = normalizeReservationRequest({
    centerId: 'libramont',
    type: 'laser',
    formuleId: 'f4',
    label: 'FORMULE 4',
    date: TEST_DATE,
    startTime: '15:00',
    pax: 7,
    duration: 0.5,
  }, { channel: 'public' });
  assert.strictEqual(staleLaser.type, 'laser');
  assert.strictEqual(staleLaser.formuleId, '');
  assert.strictEqual(staleLaser.label, 'Laser Game');
  const laserPlan = planningAgent(staleLaser, { reservations: [], laneStatuses: {} });
  assert.strictEqual(laserPlan.ok, true, '7 players laser must be accepted on an empty 30-weapon session');
  assert.strictEqual(laserPlan.plan.laserGames, 1);
}

function testLaserGameCountSurvivesRequestNormalization() {
  [2, 3].forEach((laserGames) => {
    const expectedDuration = laserGames === 2 ? 1 : 1.5;
    const request = normalizeReservationRequest({
      centerId: 'libramont',
      type: 'laser',
      date: TEST_DATE,
      startTime: '15:00',
      pax: 7,
      duration: 0.5,
      laserGames,
    }, { channel: 'public' });

    assert.strictEqual(request.type, 'laser');
    assert.strictEqual(request.formuleId, '');
    assert.strictEqual(request.laserGames, laserGames);
    assert.strictEqual(request.games, laserGames);
    assert.strictEqual(request.gameCount, laserGames);
    assert.strictEqual(request.duration, expectedDuration);
    assert.strictEqual(request.totalDuration, expectedDuration);

    const plan = planningAgent(request, { reservations: [], laneStatuses: {} });
    assert.strictEqual(plan.ok, true, `${laserGames} laser games should remain plannable`);
    assert.strictEqual(plan.plan.laserGames, laserGames);
    assert.strictEqual(plan.plan.recommended.laserPassPlan.totalGames, laserGames);
  });
}

function testStaffLaserGameCountSurvivesOpsPreparationShape() {
  const request = normalizeReservationRequest({
    centerId: 'libramont',
    channel: 'staff',
    type: 'laser',
    date: TEST_DATE,
    startTime: '16:00',
    pax: 9,
    duration: 0.5,
    laserGames: 3,
    label: 'Laser Game',
  }, { channel: 'staff' });
  const plan = planningAgent(request, { reservations: [], laneStatuses: {} });

  assert.strictEqual(request.duration, 1.5);
  assert.strictEqual(request.laserGames, 3);
  assert.strictEqual(plan.plan.laserGames, 3);
  assert.strictEqual(plan.plan.recommended.laserPassPlan.totalGames, 3);
  assert.strictEqual(plan.plan.recommended.laserPassPlan.remainingGames, 2);
}

function makeMockResponse(req) {
  let body = '';
  return {
    req,
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk = '') {
      body += chunk;
    },
    json() {
      return JSON.parse(body || '{}');
    },
  };
}

async function testPrepareReservationOpsPersistsLaserGamesInOpsPlan() {
  const originalReadStaffState = database.readStaffState;
  database.readStaffState = async () => ({ reservations: [], laneStatuses: {} });
  delete require.cache[reservationOpsPath];
  const { prepareReservationOps } = require('../lib/reservation-ops');

  try {
    const ops = await prepareReservationOps({
      centerId: 'libramont',
      channel: 'staff',
      type: 'laser',
      date: TEST_DATE,
      startTime: '16:30',
      pax: 9,
      duration: 0.5,
      laserGames: 3,
      label: 'Laser Game',
    }, 'staff');

    assert.strictEqual(ops.opsPlan.laserGames, 3);
    assert.strictEqual(ops.opsPlan.games, 3);
    assert.strictEqual(ops.opsPlan.laserPassPlan.totalGames, 3);
  } finally {
    database.readStaffState = originalReadStaffState;
    delete require.cache[reservationOpsPath];
  }
}

// POST public forgé avec des ancres qui se chevauchent : le serveur recompose
// la combinaison depuis la préférence (jamais depuis l'opsPlan client) et
// refuse la confirmation en ligne.
async function testPreparePublicReservationRefusesOverlappingAnchors() {
  const originalReadStaffState = database.readStaffState;
  database.readStaffState = async () => ({ reservations: [], laneStatuses: {} });
  delete require.cache[reservationOpsPath];
  const { prepareReservationOps } = require('../lib/reservation-ops');

  const forgedBase = {
    channel: 'public',
    type: 'formule',
    formuleId: 'f1',
    date: TEST_DATE,
    startTime: '15:00',
    pax: 8,
    duration: 1,
    totalDuration: 2.5,
    label: 'FORMULE 1',
    // opsPlan client forgé « propre » : il doit être ignoré, seule la
    // préférence (ancres) fait foi côté serveur.
    opsPlan: {
      resourceBlocks: [
        { resourceType: 'bowling_lane', startTime: '15:00', endTime: '16:00', lanes: [1] },
        { resourceType: 'laser_arena', startTime: '16:30', endTime: '16:55', players: 8 },
      ],
    },
  };

  try {
    const overlapping = await prepareReservationOps({
      centerId: 'libramont',
      ...forgedBase,
      preference: { preferredTimes: { bowling: '15:00', laser_game: '15:30' } },
    }, 'public');
    assert.strictEqual(overlapping.blockOnlineConfirmation, true, 'overlapping anchors must block online confirmation');

    const offGrid = await prepareReservationOps({
      centerId: 'libramont',
      ...forgedBase,
      preference: { preferredTimes: { bowling: '15:00', laser_game: '16:45' } },
    }, 'public');
    assert.strictEqual(offGrid.blockOnlineConfirmation, true, 'off-grid anchor must block online confirmation');

    const valid = await prepareReservationOps({
      centerId: 'libramont',
      ...forgedBase,
      preference: { preferredTimes: { bowling: '15:00', laser_game: '16:30' } },
    }, 'public');
    assert.strictEqual(valid.blockOnlineConfirmation, false, 'a valid anchor combination must confirm online');
    const blocks = valid.opsPlan.resourceBlocks;
    assert.strictEqual(blocks.find((block) => block.resourceType === 'bowling_lane')?.startTime, '15:00');
    assert.strictEqual(blocks.find((block) => block.resourceType === 'laser_arena')?.startTime, '16:30');
  } finally {
    database.readStaffState = originalReadStaffState;
    delete require.cache[reservationOpsPath];
  }
}

async function invokePublicAvailability(query, snapshot) {
  const originalReadAvailabilitySnapshot = database.readAvailabilitySnapshot;
  database.readAvailabilitySnapshot = async () => snapshot;
  delete require.cache[publicAvailabilityPath];
  const handler = require('../api/public-availability');
  const req = {
    method: 'GET',
    url: `/api/public-availability?${query.toString()}`,
    headers: { host: 'localhost' },
  };
  const res = makeMockResponse(req);

  try {
    await handler(req, res);
    return { statusCode: res.statusCode, payload: res.json() };
  } finally {
    database.readAvailabilitySnapshot = originalReadAvailabilitySnapshot;
    delete require.cache[publicAvailabilityPath];
  }
}

async function testPublicLaserAvailabilityUsesLaserGamesAndExactRemainingCapacity() {
  const existingPlan = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'laser',
    pax: 23,
    startTime: '15:00',
    duration: 0.5,
    laserGames: 1,
  }, { reservations: [], laneStatuses: {} }).plan.recommended;
  const snapshot = {
    reservations: [{
      id: 42,
      centerId: 'libramont',
      type: 'laser',
      date: TEST_DATE,
      startTime: '15:00',
      duration: 0.5,
      totalDuration: 0.5,
      pax: 23,
      lanes: [],
      opsPlan: existingPlan,
    }],
    laneStatuses: {},
  };

  const acceptedQuery = new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'laser',
    pax: '7',
    laserGames: '3',
  });
  const accepted = await invokePublicAvailability(acceptedQuery, snapshot);
  assert.strictEqual(accepted.statusCode, 200);
  assert.strictEqual(accepted.payload.duration, 1.5, 'laserGames=3 should drive duration when duration is absent');
  assert.strictEqual(accepted.payload.totalDuration, 1.5);
  assert.strictEqual(accepted.payload.label, '3 parties Laser Game');
  assert.ok(
    accepted.payload.slots.some((slot) => slot.freeCount === 0 && slot.maxSessionPlayers === 30),
    '7 players should be offered when exactly 7 laser places remain',
  );

  const refusedQuery = new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'laser',
    pax: '8',
    laserGames: '3',
  });
  const refused = await invokePublicAvailability(refusedQuery, snapshot);
  assert.strictEqual(refused.statusCode, 200);
  assert.strictEqual(refused.payload.duration, 1.5);
  assert.ok(
    refused.payload.slots.every((slot) => slot.maxSessionPlayers <= 30),
    'availability must not expose a slot above exact remaining laser capacity',
  );
  assert.ok(
    !refused.payload.slots.some((slot) => slot.time === accepted.payload.slots.find((item) => item.maxSessionPlayers === 30)?.time),
    '8 players must not join the already 23-player laser session',
  );
}

function toMinutes(time) {
  const [hours, minutes] = String(time || '0:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

// Règle métier 1 : l'heure choisie = début EXACT de la première activité, avec
// l'accueil ancré 10 minutes avant (sans décaler les ressources).
function testFormulaChosenTimeIsExactFirstActivityStart() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '15:00',
  }, { reservations: [], laneStatuses: {} });

  assert.strictEqual(result.ok, true, 'formula at 15:00 must be plannable');
  const recommended = result.plan.recommended;
  assert.strictEqual(recommended.startTime, '15:00', 'scenario startTime must equal the chosen time');
  const firstActivity = recommended.timeline.find((step) => step.type === 'activity');
  assert.strictEqual(firstActivity.startTime, '15:00', 'first activity must start exactly at the chosen time');
  assert.strictEqual(recommended.arrivalMinutes, 10, 'arrival window must be the fixed 10 minutes');
  assert.strictEqual(recommended.arrivalTime, '14:50', 'advised arrival must be 10 minutes before the first activity');
  const arrival = recommended.timeline[0];
  assert.strictEqual(arrival.resourceType, 'bar_service', 'timeline must open with the arrival block');
  assert.strictEqual(arrival.startTime, '14:50');
  assert.strictEqual(arrival.endTime, '15:00');
  recommended.resourceBlocks.forEach((block) => {
    assert.ok(toMinutes(block.startTime) >= toMinutes('15:00'), 'arrival must never shift resource blocks before the chosen time');
  });
  assert.ok(
    recommended.customerCommitment.some((line) => /présentez-vous 10 minutes avant/i.test(line)),
    'customer commitment must carry the "come 10 minutes early" notice',
  );

  const scenarios = result.plan.scenarios.filter((scenario) => scenario.ok);
  scenarios.forEach((scenario) => {
    assert.strictEqual(scenario.startTime, '15:00', 'every scenario for a requested time must start exactly at it');
  });
}

// Règle métier 2 : le début du PROGRAMME (première activité, quelle qu'elle
// soit : bowling, laser, minigolf…) ne tombe que sur :00/:30. Un départ 15:15
// est refusé même si la première activité n'est pas du bowling.
function testFormulaProgramStartSnapsToHalfHourGrid() {
  const refused = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '15:15',
  }, { reservations: [], laneStatuses: {} });

  assert.strictEqual(refused.ok, false, 'a formula program can never start at 15:15, whatever the first activity');
  assert.strictEqual(refused.plan.scenarios.length, 0, 'no scenario may be proposed off the :00/:30 grid');
  assert.ok(/heures pleines ou demies/i.test(refused.plan.reason || ''), 'refusal reason must explain the :00/:30 grid');

  const accepted = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '15:30',
  }, { reservations: [], laneStatuses: {} });

  assert.strictEqual(accepted.ok, true, 'a formula program at 15:30 must remain plannable');
  accepted.plan.scenarios.forEach((scenario) => {
    assert.strictEqual(toMinutes(scenario.startTime) % 30, 0, `program start must be on :00/:30, got ${scenario.startTime}`);
    scenario.resourceBlocks
      .filter((block) => block.resourceType === 'bowling_lane')
      .forEach((block) => {
        assert.strictEqual(toMinutes(block.startTime) % 30, 0, `bowling must start on :00/:30, got ${block.startTime}`);
      });
  });
}

function testBowlingClassicRefusesOffGridStart() {
  const refused = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 4,
    startTime: '15:15',
    duration: 1,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(refused.ok, false, 'classic bowling must refuse a 15:15 start');
  assert.ok(/heures pleines ou demies/i.test(refused.plan.reason || ''), 'refusal reason must explain the :00/:30 grid');

  const accepted = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'bowling',
    pax: 4,
    startTime: '15:30',
    duration: 1,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(accepted.ok, true, 'classic bowling must accept a 15:30 start');
}

// Garde serveur à la réservation : un programme dont le bowling n'est pas sur
// :00/:30 est REFUSÉ (pas seulement jamais proposé), même payload forgé.
function testReservationValidationRefusesOffGridBowling() {
  const baseBowling = {
    centerId: 'libramont',
    channel: 'public',
    name: 'Client Grille',
    phone: '+32470000000',
    date: TEST_DATE,
    duration: 1,
    lanes: [],
    pax: 4,
    type: 'bowling',
    label: 'Bowling Classique',
    laneCount: 1,
    requiresLanes: true,
  };
  assert.throws(
    () => database.validateReservationResources({ ...baseBowling, startTime: '15:15' }, [], {}),
    /heures pleines ou demies/i,
    'off-grid classic bowling must be refused at validation',
  );
  const ok = database.validateReservationResources({ ...baseBowling, startTime: '15:30' }, [], {});
  assert.strictEqual(ok.ok, true, 'on-grid classic bowling must pass validation');

  assert.throws(
    () => database.validateReservationResources({
      ...baseBowling,
      type: 'formule',
      formuleId: 'f1',
      label: 'FORMULE 1',
      startTime: '15:00',
      lanes: [1],
      opsPlan: {
        resourceBlocks: [
          { resourceType: 'bowling_lane', startTime: '15:15', endTime: '16:15', lanes: [1] },
        ],
      },
    }, [], {}),
    /heures pleines ou demies/i,
    'a forged formula program with an off-grid bowling block must be refused',
  );

  // Généralisation programme : une FORMULE dont la PREMIÈRE activité (ici un
  // laser, pas de bowling) démarre à :15 est refusée à la création.
  assert.throws(
    () => database.validateReservationResources({
      ...baseBowling,
      type: 'formule',
      formuleId: 'f5',
      label: 'FORMULE 5',
      startTime: '15:15',
      lanes: [],
      laneCount: 0,
      requiresLanes: false,
      opsPlan: {
        resourceBlocks: [
          { resourceType: 'laser_arena', startTime: '15:15', endTime: '15:40', players: 4 },
        ],
      },
    }, [], {}),
    /heures pleines ou demies/i,
    'a forged formula program starting at :15 must be refused even without bowling',
  );
}

// Parcours public complet (mode auto + mode « Je choisis ») via l'API de
// disponibilité : chips = début exact de la première activité, bowling :00/:30.
async function testPublicFormulaAvailabilityNewSemantics(query, { expectFirstActivity } = {}) {
  const response = await invokePublicAvailability(query, { reservations: [], laneStatuses: {} });
  assert.strictEqual(response.statusCode, 200);
  const slots = response.payload.slots || [];
  assert.ok(slots.length >= 3, 'formula availability should propose several programs');

  slots.forEach((slot) => {
    const plan = slot.opsPlan || {};
    const activities = (plan.timeline || []).filter((step) => step.type === 'activity');
    assert.ok(activities.length, 'each slot must expose its program timeline');
    // Règle patron : TOUTE heure proposée au client est :00/:30, quelle que
    // soit la première activité (bowling, laser, minigolf…).
    assert.strictEqual(toMinutes(slot.time) % 30, 0, `every proposed chip must be on :00/:30, got ${slot.time}`);
    assert.strictEqual(
      activities[0].startTime,
      slot.time,
      `chip ${slot.time} must equal the exact start of the first activity (got ${activities[0].startTime})`,
    );
    if (expectFirstActivity) {
      assert.strictEqual(activities[0].activityId, expectFirstActivity, 'custom order must be respected');
    }
    assert.strictEqual(toMinutes(slot.time) - toMinutes(plan.arrivalTime), 10, 'advised arrival must be 10 minutes before the chip');
    const arrival = (plan.timeline || [])[0];
    assert.strictEqual(arrival.resourceType, 'bar_service', 'timeline must open with the arrival block');
    assert.strictEqual(arrival.endTime, slot.time, 'arrival block must end exactly at the chosen time');
    (plan.resourceBlocks || [])
      .filter((block) => block.resourceType === 'bowling_lane')
      .forEach((block) => {
        assert.strictEqual(toMinutes(block.startTime) % 30, 0, `bowling must start on :00/:30, got ${block.startTime} (slot ${slot.time})`);
      });
  });
  return slots;
}

async function testPublicFormulaAvailabilityAutoMode() {
  const slots = await testPublicFormulaAvailabilityNewSemantics(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'formule',
    formuleId: 'f1',
    pax: '10',
  }));
  // Toutes les chips (bowling-first ou non) doivent être :00/:30.
  slots.forEach((slot) => {
    assert.strictEqual(toMinutes(slot.time) % 30, 0, `auto-mode chip must be on :00/:30, got ${slot.time}`);
  });
  assert.ok(slots.length >= 5, 'the :30 grid must still leave a healthy number of programs on a full day');
}

// Modèle « Ancres + Liberté » via l'API publique : chaque ancre exposée avec
// ses chips :00/:30, combinaison choisie revalidée serveur, refus + suggestions
// quand elle est impossible, option laser « sur place ».
async function testPublicFormulaAvailabilityAnchorChoice() {
  // Le laser peut ouvrir la visite (vrai choix par ancre, plus d'ordre imposé).
  const laserFirst = await invokePublicAvailability(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'formule',
    formuleId: 'f1',
    pax: '10',
    preferredTimes: JSON.stringify({ laser_game: '15:00', bowling: '16:00' }),
  }), { reservations: [], laneStatuses: {} });
  assert.strictEqual(laserFirst.statusCode, 200);
  assert.strictEqual((laserFirst.payload.slots || []).length, 1, 'a valid anchor combination returns exactly one composed slot');
  const laserFirstPlan = laserFirst.payload.slots[0].opsPlan;
  assert.strictEqual(laserFirst.payload.slots[0].time, '15:00', 'the program starts at the earliest anchor');
  assert.strictEqual(laserFirstPlan.firstLaserTime, '15:00');
  assert.strictEqual(laserFirstPlan.firstBowlingTime, '16:00');

  // Métadonnées d'ancres : une liste d'heures par ancre, toutes :00/:30.
  const anchors = laserFirst.payload.anchors;
  assert.ok(anchors && anchors.activities.length === 2, 'anchor metadata must list bowling and laser');
  anchors.activities.forEach((activity) => {
    assert.ok(activity.times.length >= 5, `anchor ${activity.activityId} must offer several times`);
    activity.times.forEach((item) => {
      assert.strictEqual(toMinutes(item.time) % 30, 0, `anchor chip must be on :00/:30, got ${item.time}`);
    });
  });
  assert.ok(anchors.defaultTimes && anchors.defaultTimes.bowling && anchors.defaultTimes.laser_game,
    'a valid default combination must be preselected server-side');
  // Le DEFAUT enchaine : le premier plan propose ne fait attendre personne.
  {
    const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
    const defaultGap = toMin(anchors.defaultTimes.laser_game) - (toMin(anchors.defaultTimes.bowling) + 60);
    assert.strictEqual(defaultGap, 0, `the default combination chains bowling->laser (gap ${defaultGap} min)`);
  }
  assert.ok((anchors.freePass || []).length >= 1, 'free-pass activities must be listed without any time');
  assert.ok((anchors.freePass || []).every((item) => !item.time && !item.startTime), 'free pass never carries a time');

  // Combinaison impossible (chevauchement) : refus clair + suggestions proches.
  const overlapping = await invokePublicAvailability(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'formule',
    formuleId: 'f1',
    pax: '10',
    preferredTimes: JSON.stringify({ bowling: '15:00', laser_game: '15:30' }),
  }), { reservations: [], laneStatuses: {} });
  assert.strictEqual(overlapping.statusCode, 200);
  assert.strictEqual((overlapping.payload.slots || []).length, 0, 'overlapping anchors must not produce a slot');
  assert.ok(/chevauchent/i.test(overlapping.payload.message), 'the refusal message must explain the overlap');
  assert.ok((overlapping.payload.suggestions || []).length >= 1, 'close suggestions must accompany the refusal');
  overlapping.payload.suggestions.forEach((suggestion) => {
    assert.ok(suggestion.times.bowling && suggestion.times.laser_game, 'suggestions must be complete combinations');
  });

  // Option « Je place mes parties laser sur place » : bowling seul fixé.
  const onSite = await invokePublicAvailability(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'formule',
    formuleId: 'f1',
    pax: '10',
    laserPlacement: 'onsite',
    preferredTimes: JSON.stringify({ bowling: '15:00' }),
  }), { reservations: [], laneStatuses: {} });
  assert.strictEqual(onSite.statusCode, 200);
  assert.strictEqual((onSite.payload.slots || []).length, 1, 'laser on-site option must stay bookable');
  const onSitePlan = onSite.payload.slots[0].opsPlan;
  assert.ok(!(onSitePlan.resourceBlocks || []).some((block) => block.resourceType === 'laser_arena'),
    'laser on-site must not lock the arena');
  assert.strictEqual(onSitePlan.laserPassPlan.remainingGames, 1, 'laser games stay as an on-site credit');
}

// Parcours simples côté client : les créneaux proposés (laser seul, bowling
// seul) tombent aussi uniquement sur :00/:30.
async function testPublicSimpleAvailabilityUsesHalfHourGrid() {
  const laser = await invokePublicAvailability(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'laser',
    pax: '6',
    laserGames: '1',
  }), { reservations: [], laneStatuses: {} });
  assert.strictEqual(laser.statusCode, 200);
  const laserSlots = laser.payload.slots || [];
  assert.ok(laserSlots.length >= 5, 'laser availability should keep a healthy number of half-hour slots');
  laserSlots.forEach((slot) => {
    assert.strictEqual(toMinutes(slot.time) % 30, 0, `laser slot must be on :00/:30, got ${slot.time}`);
  });

  const bowling = await invokePublicAvailability(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'bowling',
    pax: '4',
    duration: '1',
  }), { reservations: [], laneStatuses: {} });
  assert.strictEqual(bowling.statusCode, 200);
  const bowlingSlots = bowling.payload.slots || [];
  assert.ok(bowlingSlots.length >= 5, 'bowling availability should keep a healthy number of half-hour slots');
  bowlingSlots.forEach((slot) => {
    assert.strictEqual(toMinutes(slot.time) % 30, 0, `bowling slot must be on :00/:30, got ${slot.time}`);
  });
}

async function main() {
  testCompetitivePlaybookLoaded();
  testLaneRules();
  testFormulaPlanning();
  testFormulaPreferredTimes();
  testPartyTableFollowsArrival();
  testLaserConflict();
  testStandaloneLaserPlanning();
  testStandaloneLaserCapacityBlock();
  testStandaloneLaserExactRemainingCapacity();
  testStandaloneLaserSplitGroup();
  testShockAbsorberRouting();
  testDelayAgent();
  testDelayAgentAbsorbableShift();
  testDelayAgentFallbackPlanFromReservation();
  testDelayAgentProposesAlternativesWhenBlocked();
  testDelayImpactPrefersRelocatingDelayed();
  testDelayImpactRelocatesDownstreamWhenDelayedIsStuck();
  testDelayImpactCascadeUsesMinimalShift();
  testDelayImpactFormulaProgramRecomputed();
  testDelayImpactFlagsClosingOverrun();
  testDelayImpactLaserSharedSession();
  testDelayNotificationChannelsAndMessages();
  testClientMessageCenter();
  testDelayNotificationEditableOverride();
  testDelayEmailTemplate();
  testLearningAgent();
  testPhoneNormalization();
  testCommunicationCommitmentModel();
  testRequestTypeGuardrails();
  testLaserGameCountSurvivesRequestNormalization();
  testStaffLaserGameCountSurvivesOpsPreparationShape();
  testFormulaChosenTimeIsExactFirstActivityStart();
  testFormulaProgramStartSnapsToHalfHourGrid();
  testBowlingClassicRefusesOffGridStart();
  testReservationValidationRefusesOffGridBowling();
  await testPrepareReservationOpsPersistsLaserGamesInOpsPlan();
  await testPreparePublicReservationRefusesOverlappingAnchors();
  await testPublicLaserAvailabilityUsesLaserGamesAndExactRemainingCapacity();
  await testPublicFormulaAvailabilityAutoMode();
  await testPublicFormulaAvailabilityAnchorChoice();
  await testPublicSimpleAvailabilityUsesHalfHourGrid();

  console.log('ops-tests-ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
