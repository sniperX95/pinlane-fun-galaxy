const assert = require('assert');
const { communicationAgent, delayAgent, learningAgent, planningAgent } = require('../lib/ops-agents');
const { getRequiredLaneCount } = require('../lib/ops-engine');
const { buildMessage, normalizePhoneForSms } = require('../lib/ops-communications');
const { getCenter, loadOpsKnowledge } = require('../lib/ops-knowledge');
const {
  FORMULES,
  getFormuleAvailability,
  getSchedule,
  parseLocalDate,
  todayStr,
} = require('../lib/booking-config');
const { normalizeReservationRequest } = require('../lib/reservation-request');

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

console.log('ops-tests-ok');
