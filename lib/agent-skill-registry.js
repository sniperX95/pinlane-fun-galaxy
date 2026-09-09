const fs = require('fs');
const path = require('path');
const { loadOpsKnowledge } = require('./ops-knowledge');

const CATALOG_PATH = path.join(__dirname, '..', 'ops-knowledge', 'agent-skills.json');
const REQUIRED_AGENT_IDS = [
  'orchestrator-agent',
  'planning-agent',
  'delay-agent',
  'communication-agent',
  'learning-agent',
  'director-agent',
  'security-agent',
  'qa-redteam-agent',
];
const REQUIRED_SKILL_PACKS = [
  'planning-reliability',
  'communications-human',
  'security-governance',
  'observability-evals',
];
const RUNTIME_AGENT_HANDLERS = {
  'orchestrator-agent': 'orchestratorAgent',
  'planning-agent': 'planningAgent',
  'delay-agent': 'delayAgent',
  'communication-agent': 'communicationAgent',
  'learning-agent': 'learningAgent',
  'director-agent': 'directorAgent',
  'marketing-agent': 'marketingAgent',
};

let cachedCatalog = null;

function readCatalog({ refresh = false } = {}) {
  if (cachedCatalog && !refresh) return cachedCatalog;
  cachedCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return cachedCatalog;
}

function sortByPriority(items = []) {
  return [...items].sort((left, right) => {
    const priorityDelta = Number(left.priority || 99) - Number(right.priority || 99);
    if (priorityDelta !== 0) return priorityDelta;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

function getAgentSkillCatalog(options = {}) {
  const catalog = readCatalog(options);
  return {
    ...catalog,
    selectedStack: sortByPriority(catalog.selectedStack || []),
    agents: sortByPriority(catalog.agents || []),
    skillPacks: sortByPriority(catalog.skillPacks || []),
    implementationBacklog: [...(catalog.implementationBacklog || [])].sort((left, right) => {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (rank[left.priority] ?? 9) - (rank[right.priority] ?? 9);
    }),
  };
}

function summarizeAgentStack(input = {}) {
  const catalog = getAgentSkillCatalog();
  const knowledge = loadOpsKnowledge();
  const competitivePlaybook = knowledge.competitivePlaybook || {};
  const centerId = input.centerId || 'libramont';
  const liveAgents = catalog.agents.filter((agent) => agent.status === 'live');
  const newAgents = catalog.agents.filter((agent) => agent.status === 'new');
  const plannedStack = catalog.selectedStack.filter((item) => item.status !== 'live');
  const p1Backlog = catalog.implementationBacklog.filter((item) => item.priority === 'P1');
  const livePatterns = normalizeList(competitivePlaybook.patterns).filter((pattern) => pattern.status === 'live');

  return {
    centerId,
    schemaVersion: catalog.schemaVersion,
    updatedAt: catalog.updatedAt,
    productContext: catalog.productContext,
    summary: {
      liveAgents: liveAgents.length,
      newAgents: newAgents.length,
      selectedStackItems: catalog.selectedStack.length,
      p1Backlog: p1Backlog.length,
      criticalSkillPacks: catalog.skillPacks.filter((pack) => Number(pack.priority || 9) === 1).length,
      competitivePatterns: livePatterns.length,
    },
    competitiveIntelligence: {
      updatedAt: competitivePlaybook.updatedAt,
      positioning: competitivePlaybook.positioning,
      sourceCount: normalizeList(competitivePlaybook.sources).length,
      livePatterns: livePatterns.map((pattern) => ({
        id: pattern.id,
        label: pattern.label,
        implementedAs: pattern.implementedAs || [],
      })),
      rules: competitivePlaybook.implementationRules || [],
    },
    selectedStack: catalog.selectedStack,
    agents: catalog.agents,
    skillPacks: catalog.skillPacks,
    implementationBacklog: catalog.implementationBacklog,
    sources: catalog.sources,
    recommendations: [
      'Garder le moteur planning deterministe comme source de verite.',
      'Activer les LLM d abord sur drafts et analyses, pas sur modification directe du planning.',
      'Ajouter red team Promptfoo avant tout agent public capable de lire/ecrire.',
      'Tracer chaque decision agent avec reservationId, centerId et scenario retenu.',
      'Transformer les retards terrain en evenements structures pour apprentissage controle.',
      'S aligner sur le pattern marche: capacite unique, engagements fixes, avantages libres, rappel client humain.',
    ],
    nextActions: p1Backlog.slice(0, 4),
  };
}

function isRecentDate(value, now = new Date()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp <= 1000 * 60 * 60 * 24 * 7;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function buildDataFootprint(input = {}) {
  const reservations = normalizeList(input.reservations);
  const communications = normalizeList(input.communications);
  const suggestions = normalizeList(input.suggestions);
  const events = normalizeList(input.events);
  const riskyReservations = reservations.filter((item) => ['high', 'critical'].includes(item.riskLevel));
  const formulaReservations = reservations.filter((item) => item.type === 'formule' || item.formuleId);
  const laserReservations = reservations.filter((item) => item.type === 'laser'
    || (item.opsPlan?.resourceBlocks || []).some((block) => block.resourceType === 'laser_arena'));
  const failedCommunications = communications.filter((item) => item.status === 'failed');
  const queuedCommunications = communications.filter((item) => item.status === 'queued');
  const delayEvents = events.filter((item) => /delay|late|retard|incident|no_show/i.test(`${item.eventType || ''} ${item.reasonId || ''}`));
  const learningEvents = events.filter((item) => Number(item.actualMinutes || 0) > 0 && Number(item.plannedMinutes || 0) > 0);

  return {
    reservations: reservations.length,
    formulas: formulaReservations.length,
    laserReservations: laserReservations.length,
    riskyReservations: riskyReservations.length,
    communications: communications.length,
    failedCommunications: failedCommunications.length,
    queuedCommunications: queuedCommunications.length,
    suggestions: suggestions.length,
    pendingSuggestions: suggestions.filter((item) => item.status === 'pending' || !item.status).length,
    events: events.length,
    delayEvents: delayEvents.length,
    learningEvents: learningEvents.length,
    hasKnowledge: Boolean(input.knowledge || input.productContext),
    hasCompetitivePlaybook: Boolean(input.competitivePlaybook || input.knowledge?.competitivePlaybook),
    hasLaneStatuses: Boolean(input.laneStatuses && Object.keys(input.laneStatuses).length),
  };
}

function createActivation(agentId, mode, priority, reason, dataUsed = []) {
  return {
    agentId,
    mode,
    priority,
    reason,
    dataUsed,
    executable: Boolean(RUNTIME_AGENT_HANDLERS[agentId]),
    handler: RUNTIME_AGENT_HANDLERS[agentId] || null,
  };
}

function routeAgents(input = {}) {
  const footprint = buildDataFootprint(input);
  const activations = [];

  activations.push(createActivation(
    'orchestrator-agent',
    'active',
    1,
    'Centralise les donnees et arbitre quels agents doivent agir.',
    ['reservations', 'communications', 'events', 'suggestions', 'knowledge'],
  ));

  activations.push(createActivation(
    'security-agent',
    'monitor',
    1,
    'Garde-fous securite actifs: surveille secrets, permissions et actions sensibles sans agir seul.',
    ['communications', 'reservations', 'agent catalog'],
  ));

  if (footprint.reservations || input.reservationDraft || input.availabilityRequest) {
    activations.push(createActivation(
      'planning-agent',
      'active',
      footprint.riskyReservations ? 1 : 2,
      footprint.riskyReservations
        ? `${footprint.riskyReservations} reservation(s) a risque demandent une lecture planning.`
        : 'Reservations ou demandes disponibles: verifier capacites et scenarios.',
      ['reservations', 'laneStatuses', 'knowledge'],
    ));
  }

  if (footprint.failedCommunications || footprint.queuedCommunications || input.reservationDraft) {
    activations.push(createActivation(
      'communication-agent',
      'active',
      footprint.failedCommunications ? 1 : 2,
      footprint.failedCommunications
        ? `${footprint.failedCommunications} mail(s) en echec doivent etre corriges.`
        : `${footprint.queuedCommunications} mail(s) en file ou reservation a accompagner.`,
      ['communications', 'reservations'],
    ));
  }

  if (footprint.delayEvents || footprint.riskyReservations) {
    activations.push(createActivation(
      'delay-agent',
      'active',
      1,
      footprint.delayEvents
        ? `${footprint.delayEvents} evenement(s) retard/incident detectes.`
        : 'Reservations a risque: prevoir impact retard et alerte terrain.',
      ['events', 'reservations', 'opsPlan'],
    ));
  }

  if (footprint.learningEvents >= 3 || footprint.delayEvents >= 2) {
    activations.push(createActivation(
      'learning-agent',
      'active',
      2,
      `${footprint.learningEvents} evenement(s) exploitables pour ajuster les buffers.`,
      ['events'],
    ));
  } else {
    activations.push(createActivation(
      'learning-agent',
      'collect',
      3,
      'Pas encore assez de donnees terrain structurees: continuer a collecter.',
      ['events'],
    ));
  }

  if (footprint.formulas || footprint.laserReservations || footprint.riskyReservations) {
    activations.push(createActivation(
      'qa-redteam-agent',
      'monitor',
      2,
      'Formules ou Laser detectes: les scripts de stress surveillent ce scenario et signalent les regressions.',
      ['reservations', 'knowledge'],
    ));
  }

  activations.push(createActivation(
    'director-agent',
    'active',
    2,
    'Synthese direction multi-centres, risques, revenus et communications.',
    ['reservations', 'communications', 'suggestions', 'events'],
  ));

  activations.push(createActivation(
    'design-agent',
    'monitor',
    3,
    'Surveille les retours UI et les captures apres changements; les corrections restent appliquees par Codex.',
    ['frontend snapshots', 'copy'],
  ));

  activations.push(createActivation(
    'research-agent',
    'collect',
    3,
    footprint.hasCompetitivePlaybook || footprint.hasKnowledge
      ? 'Playbook concurrentiel charge: collecte les patterns marche utiles et les transforme en backlog produit.'
      : 'Collecte les sujets marche a analyser au prochain passage de recherche web.',
    ['web sources', 'competitive playbook', 'product backlog'],
  ));

  return activations.sort((left, right) => {
    const priorityDelta = Number(left.priority || 9) - Number(right.priority || 9);
    if (priorityDelta !== 0) return priorityDelta;
    const modeRank = { active: 0, monitor: 1, collect: 2, planned: 3, scheduled: 4 };
    return (modeRank[left.mode] ?? 9) - (modeRank[right.mode] ?? 9);
  });
}

function buildContinuousLearningPlan(input = {}) {
  const footprint = buildDataFootprint(input);
  const now = new Date();
  const lastEventIsRecent = normalizeList(input.events).some((event) => isRecentDate(event.createdAt, now));
  const dataFeeds = [
    { id: 'reservations', status: footprint.reservations ? 'active' : 'empty', count: footprint.reservations, use: 'Planning, direction, QA.' },
    { id: 'communications', status: footprint.communications ? 'active' : 'empty', count: footprint.communications, use: 'Qualite mails, relances, erreurs provider.' },
    { id: 'ops_events', status: footprint.events ? 'active' : 'needs_more_data', count: footprint.events, use: 'Retards, incidents, durees reelles, apprentissage.' },
    { id: 'agent_suggestions', status: footprint.suggestions ? 'active' : 'empty', count: footprint.suggestions, use: 'Backlog IA approuvable.' },
    { id: 'ops_knowledge', status: footprint.hasKnowledge ? 'active' : 'missing', count: footprint.hasKnowledge ? 1 : 0, use: 'Centres, formules, activites, regles.' },
    { id: 'competitive_playbook', status: footprint.hasCompetitivePlaybook || footprint.hasKnowledge ? 'active' : 'missing', count: footprint.hasCompetitivePlaybook || footprint.hasKnowledge ? 1 : 0, use: 'Techniques marche a transformer en contraintes et UX staff.' },
  ];
  const actions = [];

  if (footprint.learningEvents < 3) {
    actions.push({
      priority: 'P1',
      agentId: 'learning-agent',
      title: 'Collecter plus de durees reelles',
      reason: 'Moins de 3 evenements avec plannedMinutes/actualMinutes: apprentissage trop faible.',
      safeAutomation: 'collect_only',
    });
  }
  if (footprint.failedCommunications) {
    actions.push({
      priority: 'P1',
      agentId: 'communication-agent',
      title: 'Corriger les mails en echec',
      reason: `${footprint.failedCommunications} mail(s) en echec.`,
      safeAutomation: 'staff_visible',
    });
  }
  if (footprint.riskyReservations) {
    actions.push({
      priority: 'P1',
      agentId: 'planning-agent',
      title: 'Relire les reservations a risque',
      reason: `${footprint.riskyReservations} reservation(s) high/critical.`,
      safeAutomation: 'analysis_only',
    });
  }
  if (!lastEventIsRecent) {
    actions.push({
      priority: 'P2',
      agentId: 'orchestrator-agent',
      title: 'Rappeler au staff de journaliser les incidents',
      reason: 'Aucun evenement terrain recent: le systeme ne peut pas apprendre correctement.',
      safeAutomation: 'dashboard_hint',
    });
  }

  return {
    cadence: {
      liveDashboard: 'a chaque actualisation admin',
      backgroundLearning: 'cron quotidien sur Vercel Hobby; horaire possible avec plan Pro et schedule adapte',
      humanApproval: 'obligatoire avant modification de durees, regles ou messages critiques',
    },
    dataFeeds,
    actions,
    safety: [
      'Les donnees clients restent dans la base projet; pas d entrainement externe automatique.',
      'Les agents generatifs ne modifient pas directement les reservations.',
      'Toute amelioration de regle passe par suggestion dedupee et visible direction.',
    ],
  };
}

function orchestratorAgent(input = {}) {
  const catalog = getAgentSkillCatalog();
  const audit = auditAgentSkillCatalog();
  const activations = routeAgents(input);
  const continuousLearning = buildContinuousLearningPlan({
    ...input,
    productContext: catalog.productContext,
  });
  const footprint = buildDataFootprint(input);
  const usedAgentIds = new Set(activations.map((item) => item.agentId));
  const agentUsage = catalog.agents.map((agent) => ({
    id: agent.id,
    label: agent.label,
    status: agent.status,
    runtimeUse: usedAgentIds.has(agent.id)
      ? activations.find((item) => item.agentId === agent.id).mode
      : (agent.status === 'live' ? 'runtime' : agent.status === 'new' ? 'disponible' : 'lecture'),
    executable: Boolean(RUNTIME_AGENT_HANDLERS[agent.id]),
    handler: RUNTIME_AGENT_HANDLERS[agent.id] || null,
    useful: usedAgentIds.has(agent.id) && Boolean(RUNTIME_AGENT_HANDLERS[agent.id]),
    reason: usedAgentIds.has(agent.id)
      ? activations.find((item) => item.agentId === agent.id).reason
      : 'Pas sollicite par les donnees de ce contexte; reste disponible en lecture ou en controle manuel.',
  }));

  return {
    agent: 'orchestrator-agent',
    ok: audit.ok,
    decision: audit.ok ? 'orchestration_ready' : 'catalog_needs_fix',
    footprint,
    activations,
    agentUsage,
    continuousLearning,
    audit,
    nextAction: continuousLearning.actions[0]?.title || 'Continuer la surveillance et les tests.',
  };
}

function auditAgentSkillCatalog() {
  const catalog = getAgentSkillCatalog({ refresh: true });
  const agentIds = new Set(catalog.agents.map((agent) => agent.id));
  const skillPackIds = new Set(catalog.skillPacks.map((pack) => pack.id));
  const findings = [];

  REQUIRED_AGENT_IDS.forEach((id) => {
    if (!agentIds.has(id)) {
      findings.push({ severity: 'critical', code: 'missing_agent', message: `Agent requis manquant: ${id}` });
    }
  });

  REQUIRED_SKILL_PACKS.forEach((id) => {
    if (!skillPackIds.has(id)) {
      findings.push({ severity: 'critical', code: 'missing_skill_pack', message: `Skill pack requis manquant: ${id}` });
    }
  });

  catalog.agents.forEach((agent) => {
    if (!Array.isArray(agent.skills) || agent.skills.length < 2) {
      findings.push({ severity: 'high', code: 'weak_skill_set', message: `${agent.id} doit avoir au moins deux skills.` });
    }
    if (!Array.isArray(agent.guardrails) || agent.guardrails.length < 2) {
      findings.push({ severity: 'high', code: 'missing_guardrails', message: `${agent.id} doit avoir des garde-fous explicites.` });
    }
    if (agent.category === 'security' && agent.status !== 'live' && agent.status !== 'new') {
      findings.push({ severity: 'medium', code: 'security_status', message: `${agent.id} doit etre visible dans la roadmap securite.` });
    }
    if (agent.status === 'live' && !RUNTIME_AGENT_HANDLERS[agent.id]) {
      findings.push({ severity: 'high', code: 'missing_runtime_handler', message: `${agent.id} est live mais sans handler runtime.` });
    }
  });

  catalog.skillPacks.forEach((pack) => {
    (pack.appliesTo || []).forEach((agentId) => {
      if (!agentIds.has(agentId)) {
        findings.push({ severity: 'high', code: 'skill_pack_unknown_agent', message: `${pack.id} pointe vers un agent inconnu: ${agentId}` });
      }
    });
  });

  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  catalog.selectedStack.forEach((item) => {
    if (item.status === 'planned' && !sourceIds.has(item.id)) {
      findings.push({ severity: 'medium', code: 'missing_source', message: `${item.id} devrait pointer vers une source de recherche.` });
    }
  });

  return {
    ok: !findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high'),
    checkedAt: new Date().toISOString(),
    findings,
    counts: {
      agents: catalog.agents.length,
      skillPacks: catalog.skillPacks.length,
      sources: catalog.sources.length,
      backlog: catalog.implementationBacklog.length,
    },
  };
}

function architectureAgent(input = {}) {
  const stack = summarizeAgentStack(input);
  const audit = auditAgentSkillCatalog();
  const orchestration = orchestratorAgent(input);
  return {
    agent: 'architecture-agent',
    ok: audit.ok,
    decision: audit.ok ? 'stack_ready_for_incremental_activation' : 'stack_needs_attention',
    stack,
    orchestration,
    audit,
    guardrails: [
      'Ne jamais donner a un LLM le droit de confirmer, annuler ou modifier une reservation sans validation schema et trace.',
      'Les agents generatifs commencent en mode assistant/draft avant toute action autonome.',
      'Toute integration externe doit etre testee contre prompt injection, fuite de donnees et consommation non bornee.',
    ],
    nextAction: audit.ok
      ? 'Activer d abord Promptfoo red team et les logs de decision, puis brancher un LLM sur les brouillons de communication.'
      : 'Corriger le registre agents/skills avant toute activation IA supplementaire.',
  };
}

module.exports = {
  architectureAgent,
  auditAgentSkillCatalog,
  getAgentSkillCatalog,
  orchestratorAgent,
  summarizeAgentStack,
};
