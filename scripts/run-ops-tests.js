const assert = require('assert');
const { communicationAgent, delayAgent, learningAgent, planningAgent } = require('../lib/ops-agents');
const { getRequiredLaneCount } = require('../lib/ops-engine');
const { buildMessage, normalizePhoneForSms } = require('../lib/ops-communications');
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
    if (!getSchedule(date)) continue;
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

function testFormulaPreferredTimes() {
  const base = planningAgent({
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

  const recommended = base.plan.recommended;
  assert.ok(recommended?.ok, 'expected a baseline formula scenario');
  const bowlingTime = recommended.timeline.find((step) => step.activityId === 'bowling')?.startTime;
  const laserTime = recommended.timeline.find((step) => step.activityId === 'laser_game')?.startTime;
  assert.ok(bowlingTime && laserTime, 'baseline formula should include bowling and laser times');

  const locked = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '14:00',
    preference: {
      preferredTimes: {
        bowling: bowlingTime,
        laser_game: laserTime,
      },
    },
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(locked.ok, true, 'matching preferred activity times should remain bookable');
  assert.strictEqual(locked.plan.recommended.timeline.find((step) => step.activityId === 'bowling')?.startTime, bowlingTime);
  assert.strictEqual(locked.plan.recommended.timeline.find((step) => step.activityId === 'laser_game')?.startTime, laserTime);

  const impossible = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '14:00',
    preference: {
      preferredTimes: {
        bowling: '08:00',
        laser_game: laserTime,
      },
    },
  }, {
    reservations: [],
    laneStatuses: {},
  });

  assert.strictEqual(impossible.ok, false, 'impossible preferred formula times must be rejected');
  assert.strictEqual(impossible.plan.scenarios.length, 0);
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

  assert.ok(message.subject.includes('Ajustement'));
  assert.ok(message.body.includes('15:00'));
  assert.ok(message.body.includes('15:10'));
  assert.ok(message.body.includes('reste confirmee'));
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

// Règle métier 2 : le bowling ne démarre qu'à :00/:30, dans TOUS les scénarios
// composés (y compris quand le bowling n'est pas la première activité).
function testFormulaBowlingSnapsToHalfHourGrid() {
  const result = planningAgent({
    centerId: 'libramont',
    date: TEST_DATE,
    type: 'formule',
    formuleId: 'f1',
    pax: 10,
    startTime: '15:15',
  }, { reservations: [], laneStatuses: {} });

  result.plan.scenarios.forEach((scenario) => {
    assert.strictEqual(scenario.startTime, '15:15', 'a 15:15 start is allowed only when the first activity is not bowling');
    const firstActivity = scenario.timeline.find((step) => step.type === 'activity');
    assert.notStrictEqual(firstActivity.activityId, 'bowling', 'bowling can never open a program off the :00/:30 grid');
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
  // f1 démarre au bowling en mode auto : toutes les chips doivent être :00/:30.
  slots
    .filter((slot) => (slot.opsPlan.timeline || []).find((step) => step.type === 'activity')?.activityId === 'bowling')
    .forEach((slot) => {
      assert.strictEqual(toMinutes(slot.time) % 30, 0, `bowling-first chip must be on :00/:30, got ${slot.time}`);
    });
}

async function testPublicFormulaAvailabilityManualOrder() {
  await testPublicFormulaAvailabilityNewSemantics(new URLSearchParams({
    date: TEST_DATE,
    centerId: 'libramont',
    type: 'formule',
    formuleId: 'f1',
    pax: '10',
    activityOrder: 'laser_game,bowling,arcade_time',
  }), { expectFirstActivity: 'laser_game' });
}

async function main() {
  testCompetitivePlaybookLoaded();
  testLaneRules();
  testFormulaPlanning();
  testFormulaPreferredTimes();
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
  testDelayEmailTemplate();
  testLearningAgent();
  testPhoneNormalization();
  testCommunicationCommitmentModel();
  testRequestTypeGuardrails();
  testLaserGameCountSurvivesRequestNormalization();
  testStaffLaserGameCountSurvivesOpsPreparationShape();
  testFormulaChosenTimeIsExactFirstActivityStart();
  testFormulaBowlingSnapsToHalfHourGrid();
  testBowlingClassicRefusesOffGridStart();
  testReservationValidationRefusesOffGridBowling();
  await testPrepareReservationOpsPersistsLaserGamesInOpsPlan();
  await testPublicLaserAvailabilityUsesLaserGamesAndExactRemainingCapacity();
  await testPublicFormulaAvailabilityAutoMode();
  await testPublicFormulaAvailabilityManualOrder();

  console.log('ops-tests-ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
