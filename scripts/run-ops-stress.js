const assert = require('assert');
const { communicationAgent, delayAgent, learningAgent, planningAgent } = require('../lib/ops-agents');
const { getRequiredLaneCount, timeToMinutes } = require('../lib/ops-engine');
const {
  buildEmailSamples,
  buildMessage,
  emailShell,
  normalizePhoneForSms,
  __test: communicationsTest,
} = require('../lib/ops-communications');
const { getSchedule, isHolidayScheduleDate, todayStr } = require('../lib/booking-config');
const { loadOpsKnowledge } = require('../lib/ops-knowledge');
const { normalizeReservationRequest } = require('../lib/reservation-request');

function readIterations() {
  const arg = process.argv.find((item) => item.startsWith('--iterations='));
  const raw = arg ? arg.split('=')[1] : process.env.OPS_STRESS_ITERATIONS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 5000;
}

const ITERATIONS = readIterations();

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function nextOpenDate(offsetDays = 7) {
  for (let offset = offsetDays; offset < offsetDays + 30; offset += 1) {
    const date = addDays(todayStr(), offset);
    if (getSchedule(date)) return date;
  }
  throw new Error('No future open date found for guardrail tests.');
}

function dayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function nextOpenNonHolidayDate(offsetDays = 7, predicate = () => true) {
  for (let offset = offsetDays; offset < offsetDays + 370; offset += 1) {
    const date = addDays(todayStr(), offset);
    if (getSchedule(date) && !isHolidayScheduleDate(date) && predicate(dayOfWeek(date))) return date;
  }
  throw new Error('No compatible future non-holiday open date found for guardrail tests.');
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function randomTime(random) {
  return minutesToTime((9 * 60) + Math.floor(random() * 30) * 30);
}

function makeReservation(index, random, date, centerId) {
  const start = minutesToTime((10 * 60) + Math.floor(random() * 20) * 30);
  const duration = pick(random, [0.5, 1, 1.5, 2]);
  const laneStart = 1 + Math.floor(random() * 8);
  const laneCount = pick(random, [1, 1, 2, 3]);
  const lanes = Array.from({ length: laneCount }, (_, offset) => ((laneStart + offset - 1) % 8) + 1);

  return {
    id: index + 1,
    centerId,
    type: 'bowling',
    startTime: start,
    duration,
    totalDuration: duration,
    lanes,
    pax: laneCount * 6,
    status: 'confirmed',
  };
}

function makeContext(random, date, centerId) {
  const count = Math.floor(random() * 8);
  const reservations = Array.from({ length: count }, (_, index) => makeReservation(index, random, date, centerId));
  const laneStatuses = {};
  if (random() < 0.08) laneStatuses[1 + Math.floor(random() * 8)] = 'maintenance';
  return { reservations, laneStatuses };
}

function validateScenarioShape(scenario, center, formulaId = '') {
  assert.ok(scenario, 'recommended scenario missing');
  assert.ok(Number.isFinite(Number(scenario.totalMinutes)), 'scenario total minutes invalid');
  assert.ok(scenario.risk, 'risk missing');
  assert.ok(Number(scenario.risk.score) >= 0 && Number(scenario.risk.score) <= 100, 'risk score outside 0..100');
  assert.ok(['low', 'medium', 'high', 'critical'].includes(scenario.risk.level), 'unknown risk level');
  assert.ok(Array.isArray(scenario.timeline), 'timeline missing');
  assert.ok(Array.isArray(scenario.resourceBlocks), 'resource blocks missing');

  let previousStart = -1;
  scenario.timeline.forEach((step) => {
    assert.ok(Number.isFinite(Number(step.start)), 'timeline start invalid');
    assert.ok(Number.isFinite(Number(step.end)), 'timeline end invalid');
    assert.ok(step.end > step.start, 'timeline step has non-positive duration');
    assert.ok(step.start >= previousStart, 'timeline is not ordered');
    previousStart = step.start;
  });

  scenario.resourceBlocks.forEach((block) => {
    assert.ok(block.end > block.start, 'resource block has non-positive duration');
    if (block.resourceType === 'bowling_lane' && scenario.ok) {
      assert.ok((block.lanes || []).length >= Number(block.requiredLanes || 1), 'not enough bowling lanes assigned');
      block.lanes.forEach((lane) => assert.ok(lane >= 1 && lane <= center.resources.bowling.laneCount, 'lane out of range'));
    }
    if (block.resourceType === 'laser_arena' && scenario.ok) {
      assert.ok(Number(block.players || 0) <= center.resources.laser.weaponCount, 'laser weapon capacity exceeded');
    }
  });

  if (scenario.ok) {
    assert.strictEqual((scenario.conflicts || []).length, 0, 'ok scenario contains conflicts');
  }

  if (formulaId) {
    assert.ok(scenario.staffSummary.includes('Risque'), 'staff summary must expose risk');
  }
}

function validatePlanResult(result, input, context, knowledge) {
  assert.strictEqual(result.agent, 'planning-agent');
  assert.ok(result.plan, 'plan missing');
  const center = knowledge.centerById.get(result.plan.centerId || input.centerId || 'libramont');

  if (!result.ok) {
    assert.ok(result.decision === 'no_safe_slot' || result.plan.reason || result.plan.recommended, 'unsafe plan must explain why');
    return;
  }

  validateScenarioShape(result.plan.recommended, center, input.formuleId || '');

  if ((input.type || 'bowling') === 'bowling') {
    const expected = getRequiredLaneCount(center, input.pax);
    assert.strictEqual(result.plan.requiredLanes, expected, 'bowling lane count mismatch');
    assert.ok(result.plan.recommended.assignedLanes.length >= expected, 'bowling recommendation lacks lanes');
  }
  if (result.plan.validationMode === 'required') {
    assert.strictEqual(result.decision, 'staff_review_required', 'required validation mode must not auto-confirm');
    assert.strictEqual(result.requiresHumanReview, true, 'required validation mode must request staff review');
  }

  const schedule = getSchedule(input.date);
  if (schedule) {
    const open = Math.round(schedule.open * 60);
    const close = Math.round(schedule.close * 60);
    result.plan.recommended.resourceBlocks.forEach((block) => {
      assert.ok(block.start >= open, 'resource starts before opening');
      assert.ok(block.end <= close, 'resource ends after closing');
    });
  }

  const delay = delayAgent({
    centerId: input.centerId,
    date: input.date,
    reasonId: pick(rng(input.pax * 13 + result.plan.recommended.totalMinutes), ['late_customer', 'incomplete_group', 'bar_queue', 'laser_bug']),
    delayMinutes: pick(rng(input.pax * 29 + result.plan.recommended.totalMinutes), [5, 10, 15, 20, 30]),
    plan: result.plan.recommended,
  }, context);
  assert.strictEqual(delay.agent, 'delay-agent');
  assert.ok(delay.impact.actions.length >= 1, 'delay agent must return at least one action');
}

function runFixedGuardrailTests(knowledge) {
  const futureOpenDate = nextOpenDate(7);
  const formulaGuardDate = nextOpenNonHolidayDate(7);
  const invalidFfmDate = nextOpenNonHolidayDate(7, (day) => day !== 5);
  const pastDate = addDays(todayStr(), -1);
  const past = planningAgent({
    centerId: 'libramont',
    date: pastDate,
    type: 'bowling',
    pax: 4,
    startTime: '10:00',
    duration: 1,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(past.ok, false, 'past date must not be accepted');

  let staffPastDate = pastDate;
  while (!getSchedule(staffPastDate)) staffPastDate = addDays(staffPastDate, -1);
  const staffPastSchedule = getSchedule(staffPastDate);
  const staffPast = planningAgent({
    centerId: 'libramont',
    date: staffPastDate,
    type: 'bowling',
    pax: 4,
    startTime: minutesToTime(Math.round(staffPastSchedule.open * 60)),
    duration: 1,
    channel: 'staff',
    allowPastStart: true,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(staffPast.ok, true, 'staff must be able to place an explicit past reservation');

  const ciney = planningAgent({
    centerId: 'ciney',
    date: addDays(todayStr(), 7),
    type: 'bowling',
    pax: 4,
    startTime: '14:00',
    duration: 1,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(ciney.ok, false, 'planned center must not accept bookings');

  const tooSmall = planningAgent({
    centerId: 'libramont',
    date: formulaGuardDate,
    type: 'formule',
    formuleId: 'f4',
    pax: 3,
    startTime: '14:00',
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(tooSmall.ok, false, 'formula min pax must be enforced');

  const invalidDay = planningAgent({
    centerId: 'libramont',
    date: invalidFfmDate,
    type: 'formule',
    formuleId: 'ffm',
    pax: 6,
    startTime: '14:00',
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(invalidDay.ok, false, 'formula validDays must be enforced');

  // Départ 15:00 et non 14:00 : nextOpenDate peut tomber sur un jour qui
  // OUVRE à 14:00, et l'accueil 10 min avant le départ sortirait alors de
  // l'horaire (refus légitime du moteur, pas un défaut de vagues). Même
  // remède que le bloc formule ci-dessous ; fixture dépendante de l'horloge
  // attrapée le 2026-08-17 (un mardi à J+8).
  const splitLaser = planningAgent({
    centerId: 'libramont',
    date: futureOpenDate,
    type: 'laser',
    pax: 50,
    startTime: '15:00',
    duration: 0.5,
    laserGames: 1,
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(splitLaser.ok, true, 'standalone laser should split oversized groups into waves');
  assert.strictEqual(splitLaser.plan.recommended.laserSharing.waveCount, 2, '50 laser players should create two waves');

  // Départ 15:00 : reste valide quel que soit le jour ouvert retenu (une
  // formule ne peut pas partir pile à l'ouverture : accueil 10 min avant).
  const hugeLaserFormula = planningAgent({
    centerId: 'libramont',
    date: formulaGuardDate,
    type: 'formule',
    formuleId: 'f5',
    pax: 31,
    startTime: '15:00',
  }, { reservations: [], laneStatuses: {} });
  assert.strictEqual(hugeLaserFormula.ok, true, 'laser formulas should split groups over weapon capacity');
  assert.ok(hugeLaserFormula.plan.recommended.laserSharing.waveCount >= 2, 'formula laser split missing');

  const communication = communicationAgent({
    centerId: 'libramont',
    formuleId: 'f4',
    name: 'Client Test',
    startTime: '15:00',
    channel: 'email',
  });
  assert.ok(communication.body.includes('15 minutes'), 'formula communication must mention early arrival');

  const publicRequest = normalizeReservationRequest({
    centerId: 'libramont',
    channel: 'staff',
    status: 'paid',
    paymentMethod: 'card',
    validationStatus: 'confirmed',
    date: futureOpenDate,
    type: 'bowling',
    pax: 7,
    startTime: '14:00',
    duration: 1,
    basePrice: 1,
    price: 1,
  }, { channel: 'public' });
  assert.strictEqual(publicRequest.channel, 'public', 'public request must force public channel');
  assert.strictEqual(publicRequest.status, 'pending', 'public request must not impose reservation status');
  assert.strictEqual(publicRequest.paymentMethod, null, 'public request must not impose payment method');
  assert.strictEqual(publicRequest.validationStatus, '', 'public request must not impose validation status');
  assert.strictEqual(publicRequest.basePrice, 78, 'public bowling base price must be server-computed');
  assert.strictEqual(publicRequest.price, 78, 'public bowling price must be server-computed');

  assert.strictEqual(communicationsTest.isSimulationCommunication({
    status: 'queued',
    payload: { simulation: true, simulationRunId: 'sim_test' },
  }), true, 'simulation payload must be detected before dispatch');
  assert.strictEqual(communicationsTest.isSimulationCommunication({
    status: 'queued',
    idempotencyKey: 'simulation:run:reservation:email',
    payload: {},
  }), true, 'simulation idempotency key must be detected before dispatch');
  assert.strictEqual(communicationsTest.isSimulationCommunication({
    status: 'queued',
    idempotencyKey: 'reservation:normal:email',
    payload: { textBody: 'normal' },
  }), false, 'normal communication must remain dispatchable');

  const phoneSamples = [
    ['0470 12 34 56', '+32470123456'],
    ['0032 470 12 34 56', '+32470123456'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['470123456', '+32470123456'],
  ];
  phoneSamples.forEach(([input, expected]) => assert.strictEqual(normalizePhoneForSms(input), expected));

  const mailReservation = {
    id: 777,
    centerId: 'libramont',
    name: '<Client Test>',
    date: '2026-06-20',
    startTime: '15:00',
    pax: 14,
    price: 546,
    type: 'formule',
    formuleId: 'f4',
    label: 'FORMULE 4',
    riskLevel: 'critical',
    riskScore: 91,
  };
  // Purge de marque (2026-08-15) : l'habillage email porte le nom du CENTRE
  // quand l'appelant le fournit (chemin de prod : shellFromMessage passe le
  // centre), et AUCUN nom du tout sans centre. L'ancien invariant (« Fun
  // Galaxy » present dans tout mail, meme sans centre) etait la fuite.
  const mailCenter = loadOpsKnowledge().centerById.get('libramont');
  ['request_received', 'confirmation', 'reminder_48h', 'staff_review_request', 'delay_update'].forEach((templateId) => {
    const message = buildMessage({ reservation: mailReservation, templateId, channel: 'email' });
    assert.ok(message.subject && message.body, `email message missing for ${templateId}`);
    const html = emailShell({
      title: message.subject,
      body: message.body,
      preheader: message.preheader,
      details: message.details,
      action: message.action,
      note: message.note,
      center: mailCenter,
    });
    assert.ok(html.includes('Fun Galaxy Libramont'), `email center name missing for ${templateId}`);
    assert.ok(html.includes('&lt;Client Test&gt;'), `email escaping missing for ${templateId}`);
    assert.ok(!html.includes('<Client Test>'), `email contains unescaped client data for ${templateId}`);
    // L'HABILLAGE seul (le corps du message nomme legitimement SON centre) :
    // sans centre fourni, la coquille ne doit porter AUCUNE marque de client.
    const orphanHtml = emailShell({ title: 'Test neutre', body: 'Bonjour', preheader: 'Apercu neutre' });
    assert.ok(!/fun\s*galaxy|fungalaxy|mngfunglxy/i.test(orphanHtml), `orphan shell must carry no client brand for ${templateId}`);
  });
  const sampleIds = buildEmailSamples().map((sample) => sample.templateId);
  ['request_received', 'confirmation', 'reminder_48h', 'staff_review_request', 'delay_update'].forEach((templateId) => {
    assert.ok(sampleIds.includes(templateId), `email sample missing for ${templateId}`);
  });

  const events = Array.from({ length: 40 }, (_, index) => ({
    centerId: index % 2 ? 'libramont' : 'gembloux',
    formulaId: 'f4',
    activityId: 'laser_game',
    plannedMinutes: 30,
    actualMinutes: 39 + (index % 4),
  }));
  const learning = learningAgent({ events });
  assert.ok(learning.suggestions.length >= 2, 'learning agent should produce center-specific suggestions');
  assert.strictEqual(learning.appliedAutomatically, false, 'learning must not auto-apply operational changes');

  assert.ok(knowledge.formulas.length >= 10, 'formula knowledge unexpectedly small');
}

function runStress() {
  const knowledge = loadOpsKnowledge();
  const centerIds = knowledge.centers.map((center) => center.id);
  const formulaIds = knowledge.formulas.map((formula) => formula.id);
  const random = rng(20260519);
  const stats = {
    iterations: 0,
    accepted: 0,
    refused: 0,
    formula: 0,
    bowling: 0,
    highOrCritical: 0,
  };

  runFixedGuardrailTests(knowledge);

  for (let index = 0; index < ITERATIONS; index += 1) {
    const centerId = pick(random, centerIds);
    const date = addDays(todayStr(), Math.floor(random() * 120));
    const draw = random();
    const isFormula = draw < 0.58;
    const isLaser = draw >= 0.58 && draw < 0.74;
    const input = {
      centerId,
      date,
      type: isFormula ? 'formule' : isLaser ? 'laser' : 'bowling',
      pax: 1 + Math.floor(random() * 80),
      startTime: random() < 0.68 ? randomTime(random) : '',
      duration: pick(random, [0.5, 1, 1.5, 2]),
      laserGames: pick(random, [1, 1, 2, 3]),
      pauseMinutes: pick(random, [0, 0, 10, 15, 20, 30]),
      preference: {
        arrivalConfidence: pick(random, ['normal', 'normal', 'uncertain']),
        firstActivityId: pick(random, ['', 'bowling', 'laser_game', 'minigolf_blacklight']),
      },
    };
    if (isFormula) input.formuleId = pick(random, formulaIds);

    const context = makeContext(random, date, centerId);
    const result = planningAgent(input, context);
    validatePlanResult(result, input, context, knowledge);

    stats.iterations += 1;
    if (isLaser) stats.laser = (stats.laser || 0) + 1;
    else stats[isFormula ? 'formula' : 'bowling'] += 1;
    if (result.ok) {
      stats.accepted += 1;
      if (['high', 'critical'].includes(result.plan.recommended.risk.level)) stats.highOrCritical += 1;
    } else {
      stats.refused += 1;
    }
  }

  console.log(`ops-stress-ok iterations=${stats.iterations} accepted=${stats.accepted} refused=${stats.refused} formula=${stats.formula} bowling=${stats.bowling} laser=${stats.laser || 0} highOrCritical=${stats.highOrCritical}`);
}

runStress();
