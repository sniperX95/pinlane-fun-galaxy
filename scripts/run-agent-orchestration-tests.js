const assert = require('assert');
const {
  architectureAgent,
  auditAgentSkillCatalog,
  getAgentSkillCatalog,
  orchestratorAgent,
} = require('../lib/agent-skill-registry');

function readIterations() {
  const arg = process.argv.find((item) => item.startsWith('--iterations='));
  const raw = arg ? arg.split('=')[1] : process.env.AGENT_ORCHESTRATION_ITERATIONS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 10000;
}

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

function maybe(random, probability) {
  return random() < probability;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString();
}

function makeReservation(index, random) {
  const type = pick(random, ['bowling', 'laser', 'formule']);
  const riskLevel = pick(random, ['', '', 'low', 'medium', 'high', 'critical']);
  const hasLaserPlan = type === 'laser' || type === 'formule' || maybe(random, 0.2);
  return {
    id: index + 1,
    type,
    formuleId: type === 'formule' ? pick(random, ['f1', 'f4', 'f5', 'ffm']) : '',
    centerId: pick(random, ['libramont', 'gembloux']),
    pax: 1 + Math.floor(random() * 80),
    status: pick(random, ['pending', 'arrived', 'paid']),
    riskLevel,
    opsPlan: {
      resourceBlocks: [
        ...(type !== 'laser' && maybe(random, 0.65) ? [{ resourceType: 'bowling_lane' }] : []),
        ...(hasLaserPlan ? [{ resourceType: 'laser_arena' }] : []),
      ],
    },
  };
}

function makeCommunication(index, random) {
  return {
    id: index + 1,
    status: pick(random, ['queued', 'sent', 'delivered', 'failed']),
    channel: 'email',
    recipient: `client${index + 1}@example.test`,
  };
}

function makeEvent(index, random, recent) {
  const plannedMinutes = pick(random, [20, 30, 45, 60, 90]);
  const actualMinutes = plannedMinutes + pick(random, [-5, 0, 3, 7, 12, 18]);
  return {
    id: index + 1,
    centerId: pick(random, ['libramont', 'gembloux']),
    formulaId: pick(random, ['', 'f1', 'f4', 'f5']),
    activityId: pick(random, ['', 'bowling', 'laser_game']),
    eventType: pick(random, ['delay', 'incident', 'duration_observed', 'arrival']),
    reasonId: pick(random, ['', 'late_customer', 'laser_bug', 'bar_queue']),
    plannedMinutes,
    actualMinutes,
    createdAt: addDays(new Date(), recent ? -Math.floor(random() * 3) : -20 - Math.floor(random() * 20)),
  };
}

function makeContext(index, random) {
  const reservations = Array.from({ length: Math.floor(random() * 12) }, (_, item) => makeReservation(item, random));
  const communications = Array.from({ length: Math.floor(random() * 8) }, (_, item) => makeCommunication(item, random));
  const events = Array.from({ length: Math.floor(random() * 14) }, (_, item) => makeEvent(item, random, maybe(random, 0.7)));
  return {
    centerId: pick(random, ['libramont', 'gembloux', 'ciney']),
    startDate: '2026-05-20',
    endDate: '2026-05-20',
    reservations,
    communications,
    events,
    suggestions: maybe(random, 0.35) ? [{ id: index + 1, status: 'pending', agentId: 'learning-agent' }] : [],
    laneStatuses: maybe(random, 0.75) ? { 1: 'active', 2: maybe(random, 0.1) ? 'maintenance' : 'active' } : {},
    knowledge: { present: true },
  };
}

function modesByAgent(orchestration) {
  return new Map(orchestration.activations.map((item) => [item.agentId, item.mode]));
}

function assertCoreShape(result, catalog) {
  assert.strictEqual(result.agent, 'orchestrator-agent');
  assert.strictEqual(result.ok, true);
  assert.ok(result.footprint, 'footprint missing');
  assert.ok(Array.isArray(result.activations), 'activations missing');
  assert.ok(Array.isArray(result.agentUsage), 'agentUsage missing');
  assert.ok(result.continuousLearning?.cadence, 'continuous learning cadence missing');
  assert.ok(result.audit?.ok, 'catalog audit must be ok');

  const catalogAgentIds = new Set(catalog.agents.map((agent) => agent.id));
  const usageAgentIds = new Set(result.agentUsage.map((agent) => agent.id));
  catalogAgentIds.forEach((id) => assert.ok(usageAgentIds.has(id), `agentUsage missing ${id}`));

  result.activations.forEach((activation) => {
    assert.ok(catalogAgentIds.has(activation.agentId), `unknown activation ${activation.agentId}`);
    assert.ok(['active', 'monitor', 'collect', 'planned', 'scheduled'].includes(activation.mode), `bad mode ${activation.mode}`);
    assert.ok(activation.reason, `activation reason missing for ${activation.agentId}`);
    assert.ok(Array.isArray(activation.dataUsed), `dataUsed missing for ${activation.agentId}`);
    if (!activation.executable) {
      assert.notStrictEqual(activation.mode, 'active', `${activation.agentId} is active without runtime handler`);
    }
  });

  assert.strictEqual(modesByAgent(result).get('orchestrator-agent'), 'active');
  assert.strictEqual(modesByAgent(result).get('security-agent'), 'monitor');
  assert.strictEqual(modesByAgent(result).get('director-agent'), 'active');
  assert.strictEqual(modesByAgent(result).get('design-agent'), 'monitor');
  assert.strictEqual(modesByAgent(result).get('research-agent'), 'collect');
}

function assertContextRouting(context, result) {
  const modes = modesByAgent(result);
  const hasReservations = context.reservations.length > 0;
  const hasFormulaOrLaser = context.reservations.some((reservation) =>
    reservation.type === 'formule'
    || reservation.type === 'laser'
    || reservation.opsPlan?.resourceBlocks?.some((block) => block.resourceType === 'laser_arena'));
  const hasRisk = context.reservations.some((reservation) => ['high', 'critical'].includes(reservation.riskLevel));
  const hasFailedOrQueuedMail = context.communications.some((mail) => mail.status === 'failed' || mail.status === 'queued');
  const failedMailCount = context.communications.filter((mail) => mail.status === 'failed').length;
  const learningEvents = context.events.filter((event) => Number(event.actualMinutes || 0) > 0 && Number(event.plannedMinutes || 0) > 0).length;
  const delayEvents = context.events.filter((event) => /delay|late|retard|incident|no_show/i.test(`${event.eventType || ''} ${event.reasonId || ''}`)).length;

  if (hasReservations) assert.strictEqual(modes.get('planning-agent'), 'active', 'planning should activate when reservations exist');
  if (hasFormulaOrLaser) assert.strictEqual(modes.get('qa-redteam-agent'), 'monitor', 'QA should monitor formula/laser contexts through stress scripts');
  if (hasRisk || delayEvents > 0) assert.strictEqual(modes.get('delay-agent'), 'active', 'delay should activate for risk or delay events');
  if (hasFailedOrQueuedMail) assert.strictEqual(modes.get('communication-agent'), 'active', 'communication should activate for queued/failed mails');
  if (learningEvents >= 3 || delayEvents >= 2) assert.strictEqual(modes.get('learning-agent'), 'active', 'learning should activate on enough events');
  if (learningEvents < 3 && delayEvents < 2) assert.strictEqual(modes.get('learning-agent'), 'collect', 'learning should collect when data is weak');

  if (failedMailCount > 0) {
    assert.ok(result.continuousLearning.actions.some((action) => action.agentId === 'communication-agent'), 'failed mails need a learning action');
  }
  if (hasRisk) {
    assert.ok(result.continuousLearning.actions.some((action) => action.agentId === 'planning-agent'), 'risky reservations need a planning action');
  }
}

function runFixedScenarios(catalog) {
  const empty = orchestratorAgent({ centerId: 'libramont', reservations: [], communications: [], events: [], suggestions: [] });
  assertCoreShape(empty, catalog);
  assert.strictEqual(modesByAgent(empty).get('learning-agent'), 'collect');
  assert.ok(empty.continuousLearning.actions.some((action) => action.agentId === 'learning-agent'));

  const dangerous = orchestratorAgent({
    centerId: 'libramont',
    reservations: [
      { id: 1, type: 'formule', formuleId: 'f4', riskLevel: 'critical', opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena' }] } },
    ],
    communications: [{ id: 1, status: 'failed' }],
    events: [
      { id: 1, eventType: 'delay', plannedMinutes: 30, actualMinutes: 46, createdAt: new Date().toISOString() },
      { id: 2, eventType: 'incident', plannedMinutes: 30, actualMinutes: 43, createdAt: new Date().toISOString() },
      { id: 3, eventType: 'duration_observed', plannedMinutes: 60, actualMinutes: 72, createdAt: new Date().toISOString() },
    ],
    suggestions: [],
    laneStatuses: { 1: 'active' },
    knowledge: { present: true },
  });
  assertCoreShape(dangerous, catalog);
  assertContextRouting({
    reservations: dangerous.footprint.reservations ? [{ type: 'formule', riskLevel: 'critical', opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena' }] } }] : [],
    communications: [{ status: 'failed' }],
    events: [
      { eventType: 'delay', plannedMinutes: 30, actualMinutes: 46 },
      { eventType: 'incident', plannedMinutes: 30, actualMinutes: 43 },
      { eventType: 'duration_observed', plannedMinutes: 60, actualMinutes: 72 },
    ],
  }, dangerous);

  const architecture = architectureAgent({
    centerId: 'libramont',
    reservations: [{ id: 2, type: 'laser', riskLevel: 'high', opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena' }] } }],
    communications: [],
    events: [],
    suggestions: [],
  });
  assert.strictEqual(architecture.ok, true);
  assert.strictEqual(architecture.orchestration.agent, 'orchestrator-agent');
  assert.strictEqual(modesByAgent(architecture.orchestration).get('qa-redteam-agent'), 'monitor');
}

function run() {
  const iterations = readIterations();
  const catalog = getAgentSkillCatalog({ refresh: true });
  const audit = auditAgentSkillCatalog();
  assert.strictEqual(audit.ok, true, `catalog audit failed: ${JSON.stringify(audit.findings)}`);
  runFixedScenarios(catalog);

  const random = rng(20260520);
  const seenModes = {};
  for (let index = 0; index < iterations; index += 1) {
    const context = makeContext(index, random);
    const result = orchestratorAgent(context);
    assertCoreShape(result, catalog);
    assertContextRouting(context, result);
    result.agentUsage.forEach((agent) => {
      if (!seenModes[agent.id]) seenModes[agent.id] = new Set();
      seenModes[agent.id].add(agent.runtimeUse);
    });
  }

  [
    ['orchestrator-agent', 'active'],
    ['planning-agent', 'active'],
    ['communication-agent', 'active'],
    ['delay-agent', 'active'],
    ['learning-agent', 'active'],
    ['learning-agent', 'collect'],
    ['director-agent', 'active'],
    ['security-agent', 'monitor'],
    ['qa-redteam-agent', 'monitor'],
    ['design-agent', 'monitor'],
    ['research-agent', 'collect'],
  ].forEach(([agentId, mode]) => {
    assert.ok(seenModes[agentId]?.has(mode), `${agentId} never reached mode ${mode}`);
  });

  const summary = Object.fromEntries(
    Object.entries(seenModes).map(([agentId, modes]) => [agentId, [...modes].sort()]),
  );
  console.log(`agent-orchestration-tests-ok iterations=${iterations} modes=${JSON.stringify(summary)}`);
}

run();
