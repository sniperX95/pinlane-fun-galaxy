const assert = require('assert');
const { buildAgentEcosystemStatus, readAgentEcosystem } = require('../lib/agent-ecosystem');
const {
  architectureAgent,
  auditAgentSkillCatalog,
  getAgentSkillCatalog,
  orchestratorAgent,
  summarizeAgentStack,
} = require('../lib/agent-skill-registry');

const catalog = getAgentSkillCatalog({ refresh: true });
const ecosystemConfig = readAgentEcosystem({ refresh: true });
assert.strictEqual(catalog.schemaVersion, 1);
assert.strictEqual(ecosystemConfig.schemaVersion, 1);
assert.ok(ecosystemConfig.agents.length >= 15, 'expected a full AI company roster');
assert.ok(ecosystemConfig.executionOrder.includes('executive-director-agent'), 'executive director missing from execution order');
assert.ok(ecosystemConfig.connectors.some((connector) => connector.id === 'openai-or-ai-gateway'), 'AI connector missing');
assert.ok(catalog.sources.length >= 6, 'expected research sources');
assert.ok(catalog.agents.some((agent) => agent.id === 'security-agent'), 'security agent missing');
assert.ok(catalog.agents.some((agent) => agent.id === 'qa-redteam-agent'), 'qa redteam agent missing');
assert.ok(catalog.agents.some((agent) => agent.id === 'orchestrator-agent'), 'orchestrator agent missing');
assert.ok(catalog.skillPacks.some((pack) => pack.id === 'security-governance'), 'security skill pack missing');

const audit = auditAgentSkillCatalog();
assert.strictEqual(audit.ok, true, `agent stack audit failed: ${JSON.stringify(audit.findings)}`);
assert.ok(audit.counts.agents >= 8, 'expected complete agent roster');

const stack = summarizeAgentStack({ centerId: 'libramont' });
assert.strictEqual(stack.centerId, 'libramont');
assert.ok(stack.summary.liveAgents >= 5, 'expected existing live agents');
assert.ok(stack.nextActions.length >= 2, 'expected actionable P1 backlog');

const architecture = architectureAgent({ centerId: 'libramont' });
assert.strictEqual(architecture.agent, 'architecture-agent');
assert.strictEqual(architecture.ok, true);
assert.ok(architecture.guardrails.some((line) => line.includes('LLM')));
assert.strictEqual(architecture.orchestration.agent, 'orchestrator-agent');
const ecosystem = buildAgentEcosystemStatus({
  centerId: 'libramont',
  orchestration: architecture.orchestration,
  activations: architecture.orchestration.activations,
});
assert.ok(ecosystem.summary.agents >= 15, 'ecosystem must expose all agents');
assert.ok(ecosystem.hierarchy.some((node) => node.id === 'executive-director'), 'ecosystem hierarchy missing executive director');
assert.ok(ecosystem.connectors.some((connector) => connector.id === 'postgres'), 'ecosystem DB connector missing');
assert.ok(ecosystem.agents.some((agent) => agent.id === 'integration-manager-agent' && agent.runtimeStatus), 'integration manager missing status');

const orchestration = orchestratorAgent({
  centerId: 'libramont',
  reservations: [
    {
      id: 1,
      type: 'formule',
      formuleId: 'f4',
      riskLevel: 'high',
      opsPlan: {
        resourceBlocks: [{ resourceType: 'laser_arena' }],
      },
    },
  ],
  communications: [
    { id: 1, status: 'failed' },
    { id: 2, status: 'queued' },
  ],
  events: [
    { id: 1, eventType: 'delay', plannedMinutes: 60, actualMinutes: 75, createdAt: new Date().toISOString() },
    { id: 2, eventType: 'incident', plannedMinutes: 30, actualMinutes: 42, createdAt: new Date().toISOString() },
    { id: 3, eventType: 'duration_observed', plannedMinutes: 30, actualMinutes: 38, createdAt: new Date().toISOString() },
  ],
  suggestions: [],
  laneStatuses: { 1: 'active' },
});

assert.strictEqual(orchestration.ok, true);
assert.ok(orchestration.activations.some((item) => item.agentId === 'planning-agent' && item.mode === 'active'));
assert.ok(orchestration.activations.some((item) => item.agentId === 'communication-agent' && item.mode === 'active'));
assert.ok(orchestration.activations.some((item) => item.agentId === 'learning-agent' && item.mode === 'active'));
assert.ok(orchestration.activations.some((item) => item.agentId === 'security-agent' && item.mode === 'monitor' && item.executable === false));
assert.ok(orchestration.continuousLearning.dataFeeds.some((feed) => feed.id === 'ops_events' && feed.status === 'active'));
assert.ok(orchestration.agentUsage.some((agent) => agent.id === 'research-agent' && agent.runtimeUse === 'collect' && agent.executable === false));

// L agent marketing : sa declaration et son handler ne peuvent plus diverger,
// parce que le handler LIT la declaration. Le test verifie cette identite, et
// que la declaration dit bien les gardes reellement en place. Sans ca, la liste
// se perime en silence, comme elle l avait deja fait.
const { marketingAgent } = require('../lib/ops-agents');
const marketingDeclare = catalog.agents.find((agent) => agent.id === 'marketing-agent');
assert.ok(marketingDeclare, 'marketing agent missing from catalog');
assert.strictEqual(marketingDeclare.status, 'live');
const marketingRuntime = marketingAgent({ centerId: 'libramont', fiche: {} });
assert.strictEqual(marketingRuntime.agent, 'marketing-agent');
assert.ok(marketingRuntime.guardrails.length >= 8, "marketing guardrails look truncated");
assert.deepStrictEqual(
  marketingRuntime.guardrails,
  marketingDeclare.guardrails,
  'le handler doit RENDRE les gardes declarees, pas une copie',
);
// Les gardes reellement ecrites doivent etre nommees dans la declaration : un
// mot-cle par garde, verifie sur le texte declare.
for (const mot of ['unite', 'recurrence', 'clients', 'cadratin', 'FORME', 'memes faits']) {
  assert.ok(
    marketingDeclare.guardrails.some((ligne) => ligne.includes(mot)),
    `garde non declaree : ${mot}`,
  );
}
// Ce qui est FAIT ne doit plus figurer dans ce qui reste a faire.
assert.ok(
  !(marketingDeclare.nextUpgrades || []).some((ligne) => /ADN d ecriture|doctrine de style/.test(ligne)),
  'la doctrine d ecriture est branchee : elle ne peut plus etre annoncee comme a faire',
);
console.log('agent-stack-tests-ok');
