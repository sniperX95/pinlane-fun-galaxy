const {
  listAgentSuggestions,
  listCommunications,
  listOpsEvents,
  readAdminRangeState,
  saveAgentSuggestions,
} = require('./database');
const { learningAgent } = require('./ops-agents');
const { orchestratorAgent } = require('./agent-skill-registry');
const { loadOpsKnowledge } = require('./ops-knowledge');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function severityForPriority(priority = '') {
  if (priority === 'P0' || priority === 'P1') return 'high';
  if (priority === 'P2') return 'medium';
  return 'low';
}

function orchestratorActionsToSuggestions(centerId, actions = []) {
  return actions.map((action) => ({
    centerId,
    agentId: action.agentId || 'orchestrator-agent',
    suggestionType: 'orchestrator_action',
    dedupeKey: [
      centerId,
      'orchestrator_action',
      action.agentId || 'orchestrator-agent',
      action.title || action.reason || 'action',
    ].join(':'),
    severity: severityForPriority(action.priority),
    confidence: action.priority === 'P1' ? 0.82 : 0.68,
    payload: {
      ...action,
      source: 'orchestrator-agent',
    },
  }));
}

async function buildOrchestratorContext({
  centerId = 'libramont',
  startDate = daysAgoIso(30),
  endDate = todayIso(),
  communicationsLimit = 200,
  suggestionsLimit = 200,
  eventsLimit = 1000,
} = {}) {
  const [rangeState, communications, suggestions, events] = await Promise.all([
    readAdminRangeState(startDate, endDate, centerId),
    listCommunications({ centerId, limit: communicationsLimit }),
    listAgentSuggestions({ centerId, status: 'pending', limit: suggestionsLimit }),
    listOpsEvents({ centerId, limit: eventsLimit }),
  ]);
  return {
    centerId,
    startDate,
    endDate,
    reservations: rangeState.reservations || [],
    laneStatuses: rangeState.laneStatuses || {},
    communications,
    suggestions,
    events,
    knowledge: loadOpsKnowledge(),
    snapshotRevision: rangeState.revision,
    syncedAt: rangeState.syncedAt,
  };
}

async function runOrchestratorForCenter(options = {}) {
  const context = await buildOrchestratorContext(options);
  const orchestration = orchestratorAgent(context);
  const learning = learningAgent({ events: context.events || [] });
  const shouldPersist = options.persist !== false;
  let savedSuggestions = [];

  if (shouldPersist) {
    const orchestratorSuggestions = orchestratorActionsToSuggestions(
      context.centerId,
      orchestration.continuousLearning?.actions || [],
    );
    const learningSuggestions = (learning.suggestions || []).map((suggestion) => ({
      ...suggestion,
      centerId: suggestion.centerId || context.centerId,
      agentId: 'learning-agent',
      suggestionType: 'duration_adjustment',
      severity: suggestion.confidence >= 0.75 ? 'high' : 'medium',
    }));
    savedSuggestions = await saveAgentSuggestions([...orchestratorSuggestions, ...learningSuggestions]);
  }

  return {
    ok: orchestration.ok,
    context: {
      centerId: context.centerId,
      startDate: context.startDate,
      endDate: context.endDate,
      snapshotRevision: context.snapshotRevision,
      syncedAt: context.syncedAt,
    },
    orchestration,
    learning,
    savedSuggestions: savedSuggestions.length,
  };
}

module.exports = {
  buildOrchestratorContext,
  runOrchestratorForCenter,
};
