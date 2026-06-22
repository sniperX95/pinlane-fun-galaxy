const fs = require('fs');
const path = require('path');

const ECOSYSTEM_PATH = path.join(__dirname, '..', 'ops-knowledge', 'agent-ecosystem.json');
const RUNTIME_HANDLERS = new Set([
  'executive-director-agent',
  'orchestrator-agent',
  'planning-manager-agent',
  'bowling-capacity-agent',
  'laser-capacity-agent',
  'rush-floor-agent',
  'delay-agent',
  'communication-manager-agent',
  'crm-followup-agent',
  'director-agent',
  'finance-admin-agent',
  'learning-agent',
  'qa-redteam-agent',
  'security-agent',
  'research-agent',
  'integration-manager-agent',
]);

let cachedEcosystem = null;

function readAgentEcosystem({ refresh = false } = {}) {
  if (cachedEcosystem && !refresh) return cachedEcosystem;
  cachedEcosystem = JSON.parse(fs.readFileSync(ECOSYSTEM_PATH, 'utf8'));
  return cachedEcosystem;
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function connectorStatus(connector) {
  const required = Array.isArray(connector.requiredEnv) ? connector.requiredEnv : [];
  const requiredAny = Array.isArray(connector.requiredAnyEnv) ? connector.requiredAnyEnv : [];
  const allConfigured = required.length ? required.every(hasEnv) : true;
  const anyConfigured = requiredAny.length ? requiredAny.some(hasEnv) : true;
  const configured = allConfigured && anyConfigured;
  return {
    ...connector,
    configured,
    status: configured ? 'connected' : (connector.statusIfMissing || 'missing'),
    missing: [
      ...required.filter((name) => !hasEnv(name)),
      ...(requiredAny.length && !anyConfigured ? [`one_of:${requiredAny.join('|')}`] : []),
    ],
  };
}

function statusRank(status) {
  return {
    connected: 0,
    live: 0,
    partial: 1,
    degraded: 2,
    planned: 3,
    standby: 4,
    optional: 5,
    blocked: 6,
    missing: 7,
  }[status] ?? 9;
}

function agentRuntimeStatus(agent, connectorMap) {
  if (agent.id === 'executive-director-agent') return 'live';
  if (agent.mode === 'live') return 'live';
  if (agent.mode === 'partial') return 'partial';
  if (agent.runtime === 'planned_llm') {
    return 'partial';
  }
  if (String(agent.runtime || '').includes('needs_crm')) return 'partial';
  if (String(agent.runtime || '').includes('needs_llm')) return 'partial';
  if (String(agent.runtime || '').includes('needs_web')) return 'partial';
  if (agent.mode === 'planned') return 'partial';
  return agent.mode || 'planned';
}

function buildAgentEcosystemStatus(context = {}, options = {}) {
  const ecosystem = readAgentEcosystem(options);
  const connectors = (ecosystem.connectors || []).map(connectorStatus);
  const connectorMap = Object.fromEntries(connectors.map((connector) => [connector.id, connector]));
  const activeActivations = new Set(
    (context.activations || context.orchestration?.activations || [])
      .filter((activation) => ['active', 'monitor', 'collect'].includes(activation.mode))
      .map((activation) => activation.agentId),
  );
  const agents = (ecosystem.agents || [])
    .map((agent) => {
      const runtimeStatus = agentRuntimeStatus(agent, connectorMap);
      const executable = RUNTIME_HANDLERS.has(agent.id)
        || ['planning-manager-agent', 'bowling-capacity-agent', 'laser-capacity-agent'].includes(agent.id);
      return {
        ...agent,
        runtimeStatus,
        executable,
        activeNow: activeActivations.has(agent.id)
          || (agent.id === 'planning-manager-agent' && activeActivations.has('planning-agent'))
          || (agent.id === 'communication-manager-agent' && activeActivations.has('communication-agent')),
      };
    })
    .sort((left, right) => Number(left.order || 99) - Number(right.order || 99));
  const departments = agents.reduce((acc, agent) => {
    const key = agent.department || 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(agent.id);
    return acc;
  }, {});
  const connected = connectors.filter((connector) => connector.configured).length;
  const blockingConnectors = connectors
    .filter((connector) => !connector.configured && ['blocked', 'degraded'].includes(connector.status))
    .sort((left, right) => statusRank(left.status) - statusRank(right.status));

  return {
    ok: !connectors.some((connector) => connector.status === 'blocked'),
    schemaVersion: ecosystem.schemaVersion,
    updatedAt: ecosystem.updatedAt,
    mission: ecosystem.mission,
    operatingModel: ecosystem.operatingModel,
    summary: {
      agents: agents.length,
      liveAgents: agents.filter((agent) => agent.runtimeStatus === 'live').length,
      partialAgents: agents.filter((agent) => agent.runtimeStatus === 'partial').length,
      plannedAgents: agents.filter((agent) => agent.runtimeStatus === 'planned').length,
      connectors: connectors.length,
      connectedConnectors: connected,
      departments: Object.keys(departments).length,
      blockingConnectors: blockingConnectors.length,
    },
    hierarchy: ecosystem.hierarchy || [],
    departments,
    agents,
    connectors,
    executionOrder: ecosystem.executionOrder || agents.map((agent) => agent.id),
    blockingConnectors,
    nextSteps: [
      blockingConnectors.length
        ? `Configurer ${blockingConnectors[0].label} pour debloquer ${blockingConnectors[0].use}`
        : 'Activer les brouillons LLM controles apres ajout AI Gateway/OpenAI.',
      'Afficher les decisions agents dans Direction pour prouver qui a lu quoi et pourquoi.',
      'Garder les actions sensibles en approbation humaine jusqu aux tests terrain.',
    ],
  };
}

module.exports = {
  buildAgentEcosystemStatus,
  readAgentEcosystem,
};
