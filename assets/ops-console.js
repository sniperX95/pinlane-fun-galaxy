async function loadOpsAdmin(force = false) {
  if (opsAdminCache.loading) return;
  const now = Date.now();
  if (!force && opsAdminCache.loaded && now - opsAdminLastAutoLoadAt < 8000) return;
  opsAdminCache.loading = true;
  opsAdminLastAutoLoadAt = now;
  if (!opsAdminCache.loaded) {
    if (typeof isStaffEmailsActive === 'function' && isStaffEmailsActive()) renderStaffEmailsPage();
    else if (typeof isStaffUtilityActive === 'function' && isStaffUtilityActive()) renderStaffUtilityPage();
    else renderOpsAdmin();
  }
  try {
    const centerId = encodeURIComponent(getActiveOpsCenterId());
    const range = state.view === 'admin'
      ? getAdminPeriodRange()
      : { startDate: state.currentDate || todayStr(), endDate: state.currentDate || todayStr() };
    const startDate = encodeURIComponent(range.startDate);
    const endDate = encodeURIComponent(range.endDate);
    const simDate = encodeURIComponent(getSimulationDate());
    // UN REFUS SUR UN BLOC NE VIDE PAS LA PAGE (corrige 2026-08-19).
    // Ces six chargements partaient en Promise.all : le premier rejet emportait
    // les cinq autres. Or /api/simulation exige 'platform.admin', que meme la
    // Direction d un centre n a pas : la page Emails perdait donc TOUT
    // (communications, exemples, suggestions, evenements, pile d agents) a
    // cause d un bloc que personne n avait demande. Et le rendu qui suivait
    // relancait la charge, d ou des centaines d appels en boucle.
    // Reponse : on n appelle pas ce qu on n a pas le droit d appeler, et le
    // lot survit bloc par bloc (allSettled).
    const maySimulate = typeof canUseStaffPermission !== 'function' || canUseStaffPermission('platform.admin');
    const results = await Promise.allSettled([
      apiRequest(`${API_ENDPOINTS.ops}?action=communications&centerId=${centerId}&limit=500`),
      apiRequest(`${API_ENDPOINTS.ops}?action=emailSamples`),
      apiRequest(`${API_ENDPOINTS.ops}?action=suggestions&centerId=${centerId}&limit=80`),
      apiRequest(`${API_ENDPOINTS.ops}?action=events&centerId=${centerId}&limit=80`),
      apiRequest(`${API_ENDPOINTS.ops}?action=agentStack&centerId=${centerId}&startDate=${startDate}&endDate=${endDate}`),
      maySimulate
        ? apiRequest(`${API_ENDPOINTS.simulation}?action=status&centerId=${centerId}&date=${simDate}`)
        : Promise.resolve(null),
      // QUI REPOND A QUOI, EN CE MOMENT. Bloc separe et non bloquant : un refus
      // ici ne doit jamais vider la boite de reception, il fait seulement
      // disparaitre les pastilles « Untel repond ».
      apiRequest(`${API_ENDPOINTS.ops}?action=emailClaims&centerId=${centerId}`),
      // CE QUE L AGENT NE SAIT PAS, et ce qu on lui a deja appris. Bloc separe
      // et non bloquant, comme les prises : un refus ici ne doit jamais vider la
      // boite de reception.
      apiRequest(`${API_ENDPOINTS.ops}?action=agentQuestions&centerId=${centerId}`)
    ]);
    const value = (index) => (results[index].status === 'fulfilled' ? results[index].value : null) || {};
    const [communicationsPayload, samplesPayload, suggestionsPayload, eventsPayload, agentStackPayload] = [0, 1, 2, 3, 4].map(value);
    const simulationPayload = results[5].status === 'fulfilled' ? results[5].value : null;
    const claimsPayload = results[6] && results[6].status === 'fulfilled' ? results[6].value : null;
    const savoirPayload = results[7] && results[7].status === 'fulfilled' ? results[7].value : null;
    // Si TOUT a echoue, c est une vraie panne : elle se dit, comme avant.
    const everyFailed = results.slice(0, 5).every((entry) => entry.status === 'rejected');
    if (everyFailed) throw (results[0].reason || new Error('Console Ops indisponible.'));
    opsAdminCache = {
      communications: communicationsPayload.communications || [],
      samples: samplesPayload.samples || [],
      suggestions: suggestionsPayload.suggestions || [],
      events: eventsPayload.events || [],
      agentStack: agentStackPayload || null,
      simulation: simulationPayload || null,
      claims: (claimsPayload && claimsPayload.claims) || [],
      questions: (savoirPayload && savoirPayload.questions) || [],
      appris: (savoirPayload && savoirPayload.appris) || [],
      suivi: (savoirPayload && savoirPayload.suivi) || null,
      loaded: true,
      loading: false,
      lastLoadedAt: new Date().toISOString()
    };
    if (typeof isStaffEmailsActive === 'function' && isStaffEmailsActive()) renderStaffEmailsPage();
    else if (typeof isStaffUtilityActive === 'function' && isStaffUtilityActive()) renderStaffUtilityPage();
    else renderOpsAdmin();
  } catch (error) {
    opsAdminCache.loading = false;
    if (typeof isStaffEmailsActive === 'function' && isStaffEmailsActive()) renderStaffEmailsPage(error.message || 'Console Ops indisponible.');
    else if (typeof isStaffUtilityActive === 'function' && isStaffUtilityActive()) renderStaffUtilityPage();
    else renderOpsAdmin(error.message || 'Console Ops indisponible.');
  }
}

function renderOpsStats(communications = []) {
  const queued = communications.filter(item => item.status === 'queued').length;
  const sent = communications.filter(item => item.status === 'sent' || item.status === 'delivered').length;
  const failed = communications.filter(item => item.status === 'failed').length;
  const review = communications.filter(item => item.templateId === 'staff_review_request').length;
  return `
    <div class="ops-grid">
      <div class="ops-stat"><div class="k">En file</div><div class="v">${queued}</div></div>
      <div class="ops-stat"><div class="k">Envoyés</div><div class="v">${sent}</div></div>
      <div class="ops-stat"><div class="k">À corriger</div><div class="v">${failed}</div></div>
      <div class="ops-stat"><div class="k">Validations</div><div class="v">${review}</div></div>
    </div>`;
}

function getVisibleOpsCommunications(list = opsAdminCache.communications || []) {
  return list.filter(item => item.templateId !== 'sms_future_reminder' && item.channel !== 'phone_note' && !item.payload?.smsDeferred);
}

function renderOpsCommunications() {
  const communications = getVisibleOpsCommunications();
  if (!communications.length) {
    return `<div class="empty-state"><div class="e-title">Aucun mail en file</div><div class="e-sub">Les confirmations, rappels et validations apparaîtront ici dès qu’une réservation sera créée.</div></div>`;
  }
  return `${renderOpsStats(communications)}
    <div class="ops-list">
      ${communications.map((item, index) => `
        <div class="ops-row">
          <div>
            <span class="ops-pill ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            <div class="meta" style="margin-top:7px;">${escapeHtml(formatOpsTimestamp(item.scheduledAt || item.createdAt))}</div>
          </div>
          <div>
            <div class="title">${escapeHtml(item.subject || getOpsTemplateLabel(item.templateId))}</div>
            <div class="meta">${escapeHtml(getOpsTemplateLabel(item.templateId))} · ${escapeHtml(item.channel || 'email')}</div>
          </div>
          <div class="meta">
            ${escapeHtml(item.recipient || 'Destinataire manquant')}<br>
            ${item.lastError ? `<span class="ops-error">${escapeHtml(item.lastError)}</span>` : `${Number(item.attempts || 0)} tentative(s)`}
          </div>
          <button class="ops-mini-btn" onclick="previewOpsEmail(${index}, 'communication-visible')">Voir</button>
        </div>
      `).join('')}
    </div>`;
}

function renderOpsSamples() {
  const samples = opsAdminCache.samples || [];
  if (!samples.length) {
    return `<div class="empty-state"><div class="e-title">Aucun modèle chargé</div><div class="e-sub">Les modèles d'emails (confirmation, rappel, validation) apparaîtront ici après actualisation.</div></div>`;
  }
  return `<div class="ops-list">
    ${samples.map((sample, index) => `
      <div class="ops-row template">
        <div>
          <span class="ops-pill">${escapeHtml(getOpsTemplateLabel(sample.templateId))}</span>
          <div class="meta" style="margin-top:7px;">Prévisualisation officielle</div>
        </div>
        <div>
          <div class="title">${escapeHtml(sample.subject)}</div>
          <div class="meta">${escapeHtml(sample.preheader || 'Template email du centre')}</div>
        </div>
        <button class="ops-mini-btn" onclick="previewOpsEmail(${index}, 'sample')">Prévisualiser</button>
      </div>
    `).join('')}
  </div>`;
}

const OPS_SEVERITY_LABELS = {
  info: 'Info',
  low: 'Faible',
  medium: 'Moyen',
  high: 'Priorité haute',
  critical: 'Critique',
};

function renderOpsSuggestions() {
  const suggestions = opsAdminCache.suggestions || [];
  if (!suggestions.length) {
    return `<div class="empty-state"><div class="e-title">Aucune anomalie active</div><div class="e-sub">Les agents ajouteront ici les retards récurrents, créneaux risqués et ajustements proposés.</div></div>`;
  }
  return `<div class="ops-list">
    ${suggestions.map(item => {
      const payload = item.payload || {};
      const severity = String(item.severity || 'info');
      const tone = severity === 'critical' ? 'err' : severity === 'high' ? 'warn' : '';
      return `
        <div class="ops-row activity">
          <div>
            <div class="title">${escapeHtml(payload.title || item.suggestionType || 'Suggestion agent')}</div>
            <div class="meta">${escapeHtml(payload.reason || payload.detail || '')}</div>
          </div>
          <div class="meta">${escapeHtml(payload.recommendation || payload.reason || payload.message || 'À examiner par le staff.')}</div>
          <span class="ops-pill ${tone}">${escapeHtml(OPS_SEVERITY_LABELS[severity] || severity)}</span>
        </div>`;
    }).join('')}
  </div>`;
}

const OPS_AGENT_DEPARTMENT_LABELS = {
  direction: 'Direction',
  operations: 'Opérations',
  customer: 'Relation client',
  risk_quality: 'Qualité & sécurité',
  product_market: 'Produit & marché'
};

const OPS_AGENT_DEPARTMENT_ORDER = ['operations', 'customer', 'direction', 'risk_quality', 'product_market'];

const OPS_EVENT_TYPE_LABELS = {
  reservation_updated: 'Réservation modifiée',
  reservation_created: 'Réservation créée',
  reservation_deleted: 'Réservation supprimée',
  delay_applied: 'Retard appliqué',
  delay_cascade_applied: 'Cascade de retard',
  delay_clients_notified: 'Clients prévenus du retard',
  delay_indicator_cleared: 'Indicateur de retard levé',
  delay_reverted: 'Retard annulé',
  client_message_sent: 'Message client envoyé',
  simulation_reservation_created: 'Réservation simulée',
  simulation_status_update: 'Statut simulé',
  simulation_delay: 'Retard simulé',
  marketing_feedback_recorded: 'Retour marketing enregistré',
  marketing_agent_cycle: 'Cycle agent marketing',
  no_show_watch_due: 'Surveillance no-show'
};

const OPS_ACTIVITY_TYPE_LABELS = {
  bowling: 'Bowling',
  laser_game: 'Laser Game',
  minigolf_blacklight: 'Minigolf blacklight',
  duckpin_bowling: 'Duckpin',
  golf_oclock: "Golf o'Clock",
  arcade_time: 'Arcade',
  playground: 'Plaine de jeux',
  billards: 'Billards',
  fun_run: 'Fun Run'
};

const OPS_EVENT_REASON_LABELS = {
  late_customer: 'Retard client',
  client_late: 'Retard client',
  incomplete_group: 'Groupe incomplet'
};

const OPS_REVIEW_STATUS_LABELS = {
  approved: 'Approuvée',
  rejected: 'Rejetée',
  alternatives_sent: 'Alternatives envoyées'
};

const OPS_REVIEW_DECISION_LABELS = {
  approve: 'approuver',
  reject: 'rejeter',
  send_alternatives: 'envoyer des alternatives'
};

const OPS_AGENT_WORK_TRIGGERS = {
  'executive-director-agent': 'Travaille quand la direction ouvre Stack IA, lance l’orchestrateur ou demande une lecture multi-centres.',
  'orchestrator-agent': 'Travaille à chaque actualisation Ops: il lit réservations, mails, événements et suggestions avant de router les agents.',
  'planning-manager-agent': 'Travaille à chaque recherche de disponibilité, création staff, simulation ou contrôle de conflit.',
  'bowling-capacity-agent': 'Travaille quand une piste est réservée, déplacée, prolongée ou quand une formule utilise du Bowling.',
  'laser-capacity-agent': 'Travaille quand une session Laser est réservée, partagée, déplacée ou quand il reste des parties à placer.',
  'rush-floor-agent': 'Travaille pendant la journée terrain: arrivées proches, retards, groupes incomplets, paiements et consignes staff.',
  'delay-agent': 'Travaille quand un retard ou incident peut impacter les créneaux suivants.',
  'communication-manager-agent': 'Travaille quand une réservation doit recevoir confirmation, rappel, correction ou relance.',
  'crm-followup-agent': 'Travaille en lecture sur les clients existants; les relances automatiques attendent un CRM branché.',
  'director-agent': 'Travaille sur les vues Direction, exports, rapports et comparaisons par centre/période.',
  'finance-admin-agent': 'Travaille quand la direction consulte les montants, exports compta et écarts de caisse.',
  'learning-agent': 'Travaille quand des événements terrain ou simulations donnent assez de données pour proposer une règle.',
  'qa-redteam-agent': 'Travaille avant déploiement et pendant les simulations rush pour casser le système avant les vrais clients.',
  'security-agent': 'Travaille en contrôle: secrets, permissions, prompt injection et actions dangereuses restent sous garde-fous.',
  'research-agent': 'Travaille sur veille marché, concurrents, UX, prix, intégrations et opportunités produit.',
  'integration-manager-agent': 'Travaille quand une clé, un connecteur, un cron ou un service externe doit être vérifié.'
};

const OPS_AGENT_RUNTIME_MAP = {
  'planning-manager-agent': 'planning-agent',
  'rush-floor-agent': 'rush-agent',
  'delay-agent': 'delay-agent',
  'communication-manager-agent': 'communication-agent',
  'learning-agent': 'learning-agent',
  'director-agent': 'director-agent',
  'qa-redteam-agent': 'qa-redteam-agent'
};

function getOpsAgentActivation(agent = {}, activations = []) {
  const directIds = new Set([agent.id, agent.runtimeAgentId, OPS_AGENT_RUNTIME_MAP[agent.id]].filter(Boolean));
  return activations.find(item => directIds.has(item.id) || directIds.has(item.agentId)) || null;
}

function getOpsAgentActivity(agent = {}, activations = [], orchestration = {}) {
  const activation = getOpsAgentActivation(agent, activations);
  const runtimeStatus = agent.runtimeStatus || agent.mode || 'planned';
  const feeds = orchestration?.continuousLearning?.dataFeeds || [];
  const dataCount = feeds.reduce((sum, feed) => sum + Number(feed.count || 0), 0);
  const executiveSyntheticActivation = agent.id === 'executive-director-agent' && (activation || dataCount || (orchestration?.activations || []).length);
  const effectiveActivation = activation || (executiveSyntheticActivation
    ? {
      mode: 'active',
      reason: 'Centralise les données, arbitre les priorités et route les agents utiles.',
      tool: 'run_orchestrator'
    }
    : null);
  const live = ['active', 'live', 'partial', 'standby', 'collect', 'monitor'].includes(runtimeStatus)
    || ['active', 'live', 'partial', 'collect', 'monitor'].includes(effectiveActivation?.mode || '');
  const executable = agent.executable !== false;
  const statusLabel = effectiveActivation?.mode === 'active'
    ? 'Travaille maintenant'
    : effectiveActivation?.mode === 'collect'
      ? 'Collecte les données'
      : effectiveActivation?.mode === 'monitor'
        ? 'Surveillance'
        : runtimeStatus === 'live'
          ? 'Actif'
          : runtimeStatus === 'partial'
            ? 'Actif supervisé'
            : runtimeStatus === 'standby'
              ? 'Actif encadré'
              : executable
                ? 'Disponible'
                : 'Lecture seule';
  const statusClass = effectiveActivation?.mode === 'active'
    ? 'working'
    : effectiveActivation?.mode === 'monitor' || effectiveActivation?.mode === 'collect'
      ? 'watching'
      : live && executable
        ? 'ready'
        : 'standby';
  return {
    activation: effectiveActivation,
    live,
    executable,
    statusLabel,
    statusClass,
    headline: effectiveActivation?.reason || agent.mission || 'Agent répertorié dans l’écosystème.',
    workTrigger: OPS_AGENT_WORK_TRIGGERS[agent.id] || 'Travaille quand son domaine est touché par une réservation, un signal ou un rapport.',
    dataLabel: dataCount ? `${dataCount} lignes/signalements disponibles sur cette période` : 'Attend les données du centre et du planning.',
    currentTool: effectiveActivation?.tool || (agent.tools || [])[0] || 'lecture',
    nextAction: effectiveActivation?.nextAction || (agent.guardrails || [])[0] || 'Surveillance sans action externe directe.'
  };
}

function getSelectedOpsAgent(agents = [], activations = []) {
  if (!agents.length) return null;
  const selected = agents.find(agent => agent.id === selectedOpsAgentId);
  if (selected) return selected;
  const active = agents.find(agent => getOpsAgentActivation(agent, activations)?.mode === 'active');
  selectedOpsAgentId = (active || agents[0]).id;
  return active || agents[0];
}

function selectOpsAgent(agentId) {
  selectedOpsAgentId = agentId || '';
  if (state.view === 'admin') {
    renderAdminDashboard();
  } else {
    renderOpsAdmin();
  }
}

function renderOpsAgentNode(agent, selectedAgent, activity) {
  const selected = selectedAgent?.id === agent.id;
  const tools = (agent.tools || []).slice(0, 2).join(' · ');
  return `
    <button class="ai-org-node ${escapeHtml(activity.statusClass)}${selected ? ' selected' : ''}" type="button" onclick="selectOpsAgent('${escapeJsString(agent.id)}')">
      <span class="ai-agent-avatar"><span></span></span>
      <span class="ai-agent-body">
        <span class="ai-agent-kicker">${escapeHtml(OPS_AGENT_DEPARTMENT_LABELS[agent.department] || agent.department || 'Agent')}</span>
        <strong>${escapeHtml(agent.title || agent.id)}</strong>
        <small>${escapeHtml(activity.statusLabel)}</small>
        <em>${escapeHtml(tools || activity.currentTool)}</em>
      </span>
      <span class="ai-agent-state" aria-hidden="true"></span>
    </button>`;
}

function buildOpsAgentOrgTree(ecosystem, agents = []) {
  const topAgent = agents.find(agent => agent.id === 'executive-director-agent') || agents[0];
  const nodes = new Map();
  const children = new Map();
  const addChild = (parentId, childId) => {
    if (!parentId || !childId || parentId === childId) return;
    if (!children.has(parentId)) children.set(parentId, []);
    if (!children.get(parentId).includes(childId)) children.get(parentId).push(childId);
  };

  agents.forEach(agent => {
    nodes.set(agent.id, { kind: 'agent', id: agent.id, order: Number(agent.order || 99), agent });
  });

  (ecosystem.hierarchy || []).forEach(node => {
    if (node.id === 'executive-director') return;
    nodes.set(node.id, {
      kind: 'manager',
      id: node.id,
      order: Number(node.order || 50),
      title: node.title,
      role: node.role,
      reportsTo: node.reportsTo
    });
  });

  (ecosystem.hierarchy || []).forEach(node => {
    if (node.id === 'executive-director') return;
    const parent = node.reportsTo === 'executive-director' ? topAgent.id : node.reportsTo;
    addChild(nodes.has(parent) ? parent : topAgent.id, node.id);
  });

  agents.forEach(agent => {
    if (agent.id === topAgent.id) return;
    let parent = agent.reportsTo || topAgent.id;
    if (parent === 'executive-director') parent = topAgent.id;
    if (!nodes.has(parent)) parent = topAgent.id;
    addChild(parent, agent.id);
  });

  return { rootId: topAgent.id, nodes, children };
}

function renderOpsManagerNode(node, childCount = 0) {
  return `
    <div class="ai-manager-node">
      <span>Manager IA</span>
      <strong>${escapeHtml(node.title || node.id)}</strong>
      <small>${escapeHtml(node.role || 'Coordonne les agents de son pôle.')}</small>
      <em>${Number(childCount || 0)} agent(s)</em>
    </div>`;
}

function renderOpsOrgBranch(nodeId, tree, selectedAgent, activations, orchestration) {
  const node = tree.nodes.get(nodeId);
  if (!node) return '';
  const childIds = [...(tree.children.get(nodeId) || [])].sort((leftId, rightId) => {
    const left = tree.nodes.get(leftId);
    const right = tree.nodes.get(rightId);
    return Number(left?.order || 99) - Number(right?.order || 99);
  });
  const nodeMarkup = node.kind === 'agent'
    ? renderOpsAgentNode(node.agent, selectedAgent, getOpsAgentActivity(node.agent, activations, orchestration))
    : renderOpsManagerNode(node, childIds.length);
  return `
    <li class="${node.kind === 'manager' ? 'manager-branch' : 'agent-branch'}">
      ${nodeMarkup}
      ${childIds.length ? `<ul>${childIds.map(childId => renderOpsOrgBranch(childId, tree, selectedAgent, activations, orchestration)).join('')}</ul>` : ''}
    </li>`;
}

function renderOpsCompactAgentPyramid(ecosystem, agents = [], selectedAgent, activations = [], orchestration = {}) {
  const topAgent = agents.find(agent => agent.id === 'executive-director-agent') || agents[0];
  const topActivity = getOpsAgentActivity(topAgent, activations, orchestration);
  const hierarchy = ecosystem.hierarchy || [];
  const managerById = Object.fromEntries(hierarchy.map(node => [node.id, node]));
  const groups = [
    {
      id: 'direction-core',
      title: 'Direction centrale',
      role: 'Orchestration, reporting, finance et décisions multi-centres.',
      department: 'direction',
      agents: agents.filter(agent => agent.department === 'direction' && agent.id !== topAgent.id)
    },
    {
      ...(managerById['ops-director'] || {}),
      id: 'ops-director',
      department: 'operations',
      agents: agents.filter(agent => agent.department === 'operations')
    },
    {
      ...(managerById['customer-director'] || {}),
      id: 'customer-director',
      department: 'customer',
      agents: agents.filter(agent => agent.department === 'customer')
    },
    {
      ...(managerById['risk-director'] || {}),
      id: 'risk-director',
      department: 'risk_quality',
      agents: agents.filter(agent => agent.department === 'risk_quality')
    },
    {
      ...(managerById['growth-director'] || {}),
      id: 'growth-director',
      department: 'product_market',
      agents: agents.filter(agent => agent.department === 'product_market')
    }
  ].map(group => ({
    ...group,
    title: group.title || OPS_AGENT_DEPARTMENT_LABELS[group.department] || group.id,
    role: group.role || 'Coordonne les agents de son pôle.',
    agents: [...(group.agents || [])].sort((a, b) => Number(a.order || 99) - Number(b.order || 99))
  }));

  return `
    <div class="ai-compact-pyramid">
      <div class="ai-compact-root">
        ${renderOpsAgentNode(topAgent, selectedAgent, topActivity)}
      </div>
      <div class="ai-compact-spine"></div>
      <div class="ai-compact-manager-grid">
        ${groups.map(group => `
          <section class="ai-compact-manager">
            ${renderOpsManagerNode(group, group.agents.length)}
            <div class="ai-compact-link"></div>
            <div class="ai-compact-agents">
              ${group.agents.map(agent => renderOpsAgentNode(agent, selectedAgent, getOpsAgentActivity(agent, activations, orchestration))).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    </div>`;
}

function renderOpsAgentDetail(agent, activity, connectors = []) {
  if (!agent) return '';
  const relatedConnectors = connectors.filter(connector => {
    const haystack = `${agent.tools?.join(' ') || ''} ${agent.permissions?.join(' ') || ''} ${agent.mission || ''}`.toLowerCase();
    return haystack.includes(connector.id) || haystack.includes(String(connector.label || '').split(' ')[0].toLowerCase());
  }).slice(0, 4);
  const connectorList = relatedConnectors.length ? relatedConnectors : connectors.slice(0, 3);
  return `
    <aside class="ai-detail-panel">
      <div class="ai-detail-head">
        <div>
          <span class="ops-eyebrow">${escapeHtml(OPS_AGENT_DEPARTMENT_LABELS[agent.department] || agent.department || 'Agent')}</span>
          <h3>${escapeHtml(agent.title || agent.id)}</h3>
          <p>${escapeHtml(agent.mission || '')}</p>
        </div>
        <span class="ai-detail-status ${escapeHtml(activity.statusClass)}"><i></i>${escapeHtml(activity.statusLabel)}</span>
      </div>
      <div class="ai-detail-section primary">
        <span>Activité actuelle</span>
        <strong>${escapeHtml(activity.headline)}</strong>
      </div>
      <div class="ai-detail-grid">
        <div class="ai-detail-section">
          <span>Quand il travaille</span>
          <p>${escapeHtml(activity.workTrigger)}</p>
        </div>
        <div class="ai-detail-section">
          <span>Données lues</span>
          <p>${escapeHtml(activity.dataLabel)}</p>
        </div>
        <div class="ai-detail-section">
          <span>Outils</span>
          <p>${escapeHtml((agent.tools || []).join(' · ') || activity.currentTool)}</p>
        </div>
        <div class="ai-detail-section">
          <span>Permissions</span>
          <p>${escapeHtml((agent.permissions || []).join(' · ') || 'Lecture uniquement')}</p>
        </div>
      </div>
      <div class="ai-detail-section">
        <span>Garde-fous</span>
        <ul>${(agent.guardrails || ['Aucune action sensible sans règle claire.']).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="ai-detail-section">
        <span>Connecteurs utiles</span>
        <div class="ai-connector-strip">
          ${connectorList.map(connector => {
            const connectorState = connector.configured ? 'connecté' : ['blocked', 'degraded'].includes(connector.status) ? 'à configurer' : 'prévu';
            return `<b class="${escapeHtml(connector.status || '')}">${escapeHtml(connector.label || connector.id)} <small>${escapeHtml(connectorState)}</small></b>`;
          }).join('')}
        </div>
      </div>
      <div class="ai-detail-section">
        <span>Prochaine décision</span>
        <p>${escapeHtml(activity.nextAction)}</p>
      </div>
    </aside>`;
}

function buildOpsLiveProblems(ecosystem, agents, activations, orchestration, connectors) {
  const problems = [];
  const footprint = orchestration?.footprint || {};
  const backlog = orchestration?.continuousLearning?.actions || ecosystem?.implementationBacklog || [];
  const blockingConnectors = (connectors || []).filter(connector => ['blocked', 'degraded'].includes(connector.status) || connector.configured === false);
  const inactiveCritical = agents.filter(agent => {
    const activity = getOpsAgentActivity(agent, activations, orchestration);
    return ['executive-director-agent', 'orchestrator-agent', 'planning-manager-agent'].includes(agent.id)
      && activity.statusClass === 'standby';
  });

  if (blockingConnectors.length) {
    problems.push({
      level: 'warning',
      title: 'Connecteur à surveiller',
      text: blockingConnectors.slice(0, 3).map(item => item.label || item.id).join(', '),
    });
  }
  if (inactiveCritical.length) {
    problems.push({
      level: 'high',
      title: 'Agent critique pas assez actif',
      text: inactiveCritical.slice(0, 2).map(item => item.title || item.id).join(', '),
    });
  }
  if (backlog.length) {
    const first = backlog[0];
    problems.push({
      level: first.priority === 'P0' ? 'high' : 'info',
      title: first.title || first.id || 'Amélioration détectée',
      text: first.reason || (first.steps || []).slice(0, 2).join(' · ') || 'Suggestion agent prête à examiner.',
    });
  }
  if (!Number(footprint.reservations || 0) && !Number(footprint.communications || 0) && !Number(footprint.events || 0)) {
    problems.push({
      level: 'info',
      title: 'Peu de données sur la période',
      text: 'Les agents restent actifs, mais ils ont besoin de réservations, mails ou événements pour apprendre vraiment.',
    });
  }
  if (!problems.length) {
    problems.push({
      level: 'ok',
      title: 'Aucun blocage majeur',
      text: 'Les agents lisent les données disponibles et gardent les garde-fous actifs.',
    });
  }
  return problems.slice(0, 4);
}

function renderOpsAgentLiveBoard(ecosystem, agents, selectedAgent, activations, orchestration, connectors = []) {
  const problems = buildOpsLiveProblems(ecosystem, agents, activations, orchestration, connectors);
  const footprint = orchestration?.footprint || {};
  const agentRows = agents.map(agent => {
    const activity = getOpsAgentActivity(agent, activations, orchestration);
    const selected = selectedAgent?.id === agent.id;
    return `
      <button type="button" class="ai-live-agent ${selected ? 'selected' : ''}" onclick="selectOpsAgent('${escapeJsString(agent.id)}')">
        <span class="ai-live-dot ${escapeHtml(activity.statusClass)}"></span>
        <span>
          <strong>${escapeHtml(agent.title || agent.id)}</strong>
          <small>${escapeHtml(activity.headline)}</small>
        </span>
        <em>${escapeHtml(activity.currentTool || 'lecture')}</em>
      </button>`;
  }).join('');
  const workingCount = agents.filter(agent => getOpsAgentActivity(agent, activations, orchestration).statusClass === 'working').length;
  const watchedRows = [
    `${Number(footprint.reservations || 0)} réservation(s)`,
    `${Number(footprint.communications || 0)} mail(s)`,
    `${Number(footprint.events || 0)} événement(s)`,
    `${Number(activations.length || 0)} signal(aux) agents`,
  ];

  return `
    <section class="ai-live-board">
      <div class="ai-live-summary">
        <div>
          <span class="ops-eyebrow">Analyse instantanée</span>
          <h3>Problèmes et activité agents</h3>
          <p>Lecture en direct des signaux utiles: ce qui bloque, qui travaille, et quelle décision doit suivre.</p>
        </div>
        <div class="ai-live-kpis">
          <span><strong>${workingCount}</strong> actifs</span>
          <span><strong>${connectors.filter(item => item.configured).length}</strong> connectés</span>
          <span><strong>${watchedRows.length}</strong> flux lus</span>
        </div>
      </div>
      <div class="ai-problem-grid">
        ${problems.map(problem => `
          <article class="ai-problem-card ${escapeHtml(problem.level)}">
            <span>${escapeHtml(problem.level === 'high' ? 'Critique' : problem.level === 'warning' ? 'Attention' : problem.level === 'ok' ? 'OK' : 'Info')}</span>
            <strong>${escapeHtml(problem.title)}</strong>
            <p>${escapeHtml(problem.text)}</p>
          </article>
        `).join('')}
      </div>
      <div class="ai-live-columns">
        <div class="ai-live-activity">
          <div class="ai-live-column-head">
            <strong>Agents en temps réel</strong>
            <small>${agents.length} rôles surveillés</small>
          </div>
          <div class="ai-agent-activity-grid">${agentRows}</div>
        </div>
        <div class="ai-live-activity compact">
          <div class="ai-live-column-head">
            <strong>Données lues maintenant</strong>
            <small>Base réelle + simulation</small>
          </div>
          ${watchedRows.map(row => `<div class="ai-live-data-row">${escapeHtml(row)}</div>`).join('')}
          <div class="ai-live-next">
            <span>Prochaine décision</span>
            <strong>${escapeHtml(getOpsAgentActivity(selectedAgent, activations, orchestration).nextAction || 'Continuer la surveillance.')}</strong>
          </div>
        </div>
      </div>
    </section>`;
}

function renderOpsAgentEcosystem(ecosystem, activations = [], orchestration = {}) {
  if (!ecosystem?.agents?.length) return '';
  const agents = [...ecosystem.agents].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const connectors = ecosystem.connectors || [];
  const selectedAgent = getSelectedOpsAgent(agents, activations);

  return `
    <section class="ai-org-shell">
      <div class="ai-org-toolbar">
        <div>
          <span class="ops-eyebrow">Entreprise IA</span>
          <h3>Super Agent Team</h3>
          <p>${escapeHtml(ecosystem.mission || 'Écosystème IA du centre.')}</p>
        </div>
        <div class="ai-org-metrics">
          <span><strong>${Number(ecosystem.summary?.agents || agents.length)}</strong> agents</span>
          <span><strong>${Number(ecosystem.summary?.connectedConnectors || 0)}/${Number(ecosystem.summary?.connectors || connectors.length)}</strong> connecteurs</span>
          <span><strong>${activations.length}</strong> signaux live</span>
        </div>
      </div>
      <div class="ai-org-layout">
        <div class="ai-org-canvas" aria-label="Organigramme IA du centre">
          ${renderOpsCompactAgentPyramid(ecosystem, agents, selectedAgent, activations, orchestration)}
        </div>
        ${renderOpsAgentLiveBoard(ecosystem, agents, selectedAgent, activations, orchestration, connectors)}
      </div>
    </section>`;
}

function renderOpsAgentStack() {
  const payload = opsAdminCache.agentStack || adminDashboardCache.agentStack;
  const stack = payload?.stack || null;
  const orchestration = payload?.orchestration || null;
  const ecosystem = payload?.ecosystem || null;
  const stackHead = `
    <div class="ops-admin-head">
      <div>
        <div class="ops-eyebrow">Stack IA</div>
        <h3>Agents, orchestration et signaux</h3>
        <p>État des agents IA sur la période ouverte.</p>
      </div>
      <button class="ops-admin-btn primary" onclick="runAdminOrchestratorNow()">Relancer l’orchestrateur</button>
    </div>`;
  if (!stack) {
    return `${stackHead}<div class="empty-state"><div class="e-title">Stack IA indisponible</div><div class="e-sub">Aucun agent enregistré pour le moment. Lancez « Relancer l’orchestrateur » pour charger les agents.</div></div>`;
  }
  const audit = payload.audit || {};
  const activations = orchestration?.activations || [];
  const runtimeAgents = activations.filter(item => item.mode === 'active' && item.executable !== false);
  const monitorAgents = activations.filter(item => item.mode === 'monitor' || item.mode === 'collect');
  const footprint = orchestration?.footprint || {};
  const backlog = orchestration?.continuousLearning?.actions || stack.nextActions || stack.implementationBacklog || [];
  const agentUsage = orchestration?.agentUsage || (stack.agents || []).map(agent => ({
    ...agent,
    runtimeUse: agent.status === 'live' ? 'runtime' : agent.status === 'new' ? 'disponible' : 'lecture',
    reason: agent.mission,
  }));
  return `
    ${stackHead}
    <div class="ops-grid">
      <div class="ops-stat"><div class="k">Agents runtime</div><div class="v">${runtimeAgents.length}</div></div>
      <div class="ops-stat"><div class="k">Surveillance</div><div class="v">${monitorAgents.length}</div></div>
      <div class="ops-stat"><div class="k">Données lues</div><div class="v">${Number(footprint.reservations || 0) + Number(footprint.communications || 0) + Number(footprint.events || 0)}</div></div>
      <div class="ops-stat"><div class="k">Audit</div><div class="v">${audit.ok ? 'OK' : '!'}</div></div>
    </div>
    ${ecosystem ? renderOpsAgentEcosystem(ecosystem, activations, orchestration) : ''}
    <div class="ops-list">
      ${(orchestration?.continuousLearning?.dataFeeds || []).map(feed => `
        <div class="ops-row template">
          <div><span class="ops-pill ${escapeHtml(feed.status || '')}">${escapeHtml(feed.status || 'data')}</span></div>
          <div><div class="title">${escapeHtml(feed.id || 'data')}</div><div class="meta">${escapeHtml(feed.use || '')}</div></div>
          <span class="ops-pill">${Number(feed.count || 0)}</span>
        </div>
      `).join('')}
      ${(stack.recommendations || []).slice(0, 3).map(item => `
        <div class="ops-row template">
          <div><span class="ops-pill">Principe</span></div>
          <div><div class="title">${escapeHtml(item)}</div><div class="meta">Règle d'architecture IA de la plateforme</div></div>
          <span class="ops-pill">Actif</span>
        </div>
      `).join('')}
      ${(!ecosystem ? agentUsage : []).map(agent => `
        <div class="ops-row">
          <div>
            <span class="ops-pill ${escapeHtml(agent.runtimeUse || agent.status || '')}">${escapeHtml(agent.runtimeUse || agent.status || 'roadmap')}</span>
            <div class="meta" style="margin-top:7px;">${escapeHtml(agent.status || 'catalogue')}</div>
          </div>
          <div>
            <div class="title">${escapeHtml(agent.label || agent.id)}</div>
            <div class="meta">${escapeHtml((agent.skills || []).slice(0, 4).join(' · ') || agent.id)}</div>
          </div>
          <div class="meta">${escapeHtml(agent.reason || agent.mission || '')}</div>
          <span class="ops-pill">${escapeHtml(agent.executable ? (agent.useful === false ? 'repos' : 'handler') : 'catalogue')}</span>
        </div>
      `).join('')}
      ${backlog.slice(0, 5).map(item => `
        <div class="ops-row template">
          <div><span class="ops-pill ${escapeHtml(item.status || '')}">${escapeHtml(item.priority || 'P')}</span></div>
          <div><div class="title">${escapeHtml(item.title || item.id)}</div><div class="meta">${escapeHtml(item.reason || (item.steps || []).slice(0, 3).join(' · '))}</div></div>
          <span class="ops-pill">${escapeHtml(item.safeAutomation || item.status || 'ready')}</span>
        </div>
      `).join('')}
    </div>`;
}

// Vue « Activité du centre » : signaux agents + journal terrain sur UN écran,
// scope centre. C'est la seule vue du panneau pour une directrice ; les
// harnais plateforme (Stack IA, Simulation rush) restent des sous-onglets
// gates platform.admin. Chaque bloc annonce son périmètre : ces listes sont
// les dernières entrées enregistrées pour le centre, pas un total historique.
function renderOpsActivity() {
  const suggestions = opsAdminCache.suggestions || [];
  const events = opsAdminCache.events || [];
  return `
    <section class="ops-activity-block">
      <div class="ops-activity-head">
        <h3>Signaux des agents</h3>
        <span>${suggestions.length ? `${suggestions.length} ${suggestions.length > 1 ? 'signaux récents' : 'signal récent'} pour ce centre` : 'derniers signaux enregistrés pour ce centre'}</span>
      </div>
      ${renderOpsSuggestions()}
    </section>
    <section class="ops-activity-block">
      <div class="ops-activity-head">
        <h3>Journal terrain</h3>
        <span>${events.length ? `${events.length} événement${events.length > 1 ? 's' : ''} récent${events.length > 1 ? 's' : ''} : retards, incidents, corrections staff` : 'derniers événements terrain enregistrés pour ce centre'}</span>
      </div>
      ${renderOpsEvents()}
    </section>`;
}

function renderOpsEvents() {
  const events = opsAdminCache.events || [];
  if (!events.length) {
    return `<div class="empty-state"><div class="e-title">Journal encore vide</div><div class="e-sub">Les retards, no-shows, incidents bowling/laser et corrections staff alimenteront l’apprentissage ici.</div></div>`;
  }
  return `<div class="ops-list">
    ${events.map(item => `
      <div class="ops-row activity">
        <div>
          <div class="title">${escapeHtml(OPS_EVENT_TYPE_LABELS[item.eventType] || String(item.eventType || 'Événement').replace(/_/g, ' '))} · ${escapeHtml(OPS_ACTIVITY_TYPE_LABELS[item.activityType] || 'Opération')}</div>
          <div class="meta">${escapeHtml(OPS_EVENT_REASON_LABELS[item.reasonId] || 'Signal terrain')} · ${escapeHtml(formatOpsTimestamp(item.createdAt))}</div>
        </div>
        <div class="meta">${escapeHtml(`${item.plannedStart || '--:--'} → ${item.actualEnd || item.actualStart || '--:--'} · ${item.actualMinutes || item.plannedMinutes || 0} min`)}</div>
      </div>
    `).join('')}
  </div>`;
}

function getSimulationDate() {
  return state.view === 'admin' ? (state.adminDate || todayStr()) : (state.currentDate || todayStr());
}

function storeOpsSimulationPayload(payload) {
  opsAdminCache = {
    ...opsAdminCache,
    simulation: payload,
    loaded: opsAdminCache.loaded || Boolean(payload),
    loading: false,
  };
  adminDashboardCache = {
    ...adminDashboardCache,
    simulation: payload,
  };
  try {
    const key = getAdminOpsCacheKey(getActiveOpsCenterId());
    if (adminOpsCacheByCenter[key]) {
      adminOpsCacheByCenter[key] = { ...adminOpsCacheByCenter[key], simulation: payload };
    }
  } catch (error) {}
}

function getOpsSimulationPayload() {
  return opsAdminCache.simulation || adminDashboardCache.simulation || null;
}

function getOpsSimulationProfiles() {
  return getOpsSimulationPayload()?.profiles || [
    { id: 'quiet', label: 'Quasi vide', description: '10 demandes environ' },
    { id: 'normal', label: 'Journée normale', description: 'Charge réaliste' },
    { id: 'rush', label: 'Rush fort', description: 'Grosse journée' },
    { id: 'max', label: 'Stress maximum', description: 'Tout le scénario' },
  ];
}

function getOpsSimulationScenario() {
  return state.opsSimulationScenario || getOpsSimulationPayload()?.run?.payload?.scenario || 'normal';
}

function setOpsSimulationScenario(value) {
  state.opsSimulationScenario = value || 'normal';
  save();
  renderOpsAdmin();
}

async function startOpsSimulationScenario(value) {
  state.opsSimulationScenario = value || 'normal';
  save();
  await startOpsSimulation();
}

function getOpsSimulationProfileTone(profileId) {
  const tones = {
    quiet: {
      badge: 'Niveau 1',
      objective: 'Jour calme, environ 10 demandes.',
      proof: 'Vérifie que le moteur ne surjoue pas les alertes.'
    },
    normal: {
      badge: 'Niveau 2',
      objective: 'Jour normal, charge réaliste.',
      proof: 'Contrôle les emails, les formules et les validations utiles.'
    },
    rush: {
      badge: 'Niveau 3',
      objective: 'Rush fort, beaucoup de groupes.',
      proof: 'Éprouve les retards, alternatives et conflits bowling/laser.'
    },
    max: {
      badge: 'Niveau 4',
      objective: 'Stress maximum, saturation volontaire.',
      proof: 'Pousse le moteur jusqu’aux limites pour trouver les failles.'
    },
  };
  return tones[profileId] || tones.normal;
}

function renderOpsSimulationProfilePicker() {
  const active = getOpsSimulationScenario();
  const profiles = getOpsSimulationProfiles();
  const activeProfile = profiles.find(profile => profile.id === active) || profiles[0] || {};
  return `
    <section id="ops-sim-load-control" class="ops-sim-control-panel" aria-label="Niveau de charge simulation">
      <div class="ops-sim-control-head">
        <div>
          <span class="ops-sim-overline">Niveau de charge</span>
          <h4>${escapeHtml(activeProfile.label || 'Journée normale')}</h4>
          <p>${escapeHtml(getOpsSimulationProfileTone(active).objective)}</p>
        </div>
        <button class="ops-admin-btn primary" onclick="startOpsSimulation()">Lancer ce niveau</button>
      </div>
      <div class="ops-sim-profile-row">
        ${profiles.map(profile => {
          const tone = getOpsSimulationProfileTone(profile.id);
          const isActive = profile.id === active;
          const bookingLimit = profile.bookingLimit === 'max' ? 'max' : `${profile.bookingLimit || '--'} résas`;
          return `
            <button class="ops-sim-profile ${isActive ? 'active' : ''}" onclick="setOpsSimulationScenario('${escapeHtml(profile.id)}')" aria-pressed="${isActive ? 'true' : 'false'}">
              <span class="ops-sim-profile-index">${escapeHtml(tone.badge)}</span>
              <strong>${escapeHtml(profile.label || profile.id)}</strong>
              <span>${escapeHtml(profile.description || tone.proof)}</span>
              <em>${escapeHtml(bookingLimit)} · ${Number(profile.dayLimit || 1)} jour(s)</em>
            </button>`;
        }).join('')}
      </div>
      <div class="ops-sim-control-foot">
        <span>Ce choix contrôle combien de réservations, refus, retards, emails et validations staff seront joués.</span>
      </div>
    </section>`;
}

function renderOpsSimulationCommandMap(stats = {}, payload = {}) {
  const run = payload?.run || null;
  const reviews = run?.payload?.staffReviews || [];
  const pendingReviews = reviews.filter(review => review.status === 'pending').length;
  const communications = Array.isArray(payload.communications) ? payload.communications : [];
  const queued = communications.filter(item => item.status === 'queued').length;
  const failed = communications.filter(item => item.status === 'failed').length;
  const logs = payload?.logs || [];
  const hardRefusals = Number(stats.hardRefusals || 0);
  const alternatives = Number(stats.alternativesOffered || 0);
  const items = [
    {
      href: '#ops-sim-load-control',
      label: 'Charge',
      value: getOpsSimulationProfiles().find(item => item.id === getOpsSimulationScenario())?.label || 'Niveau',
      detail: 'Choisir vide, normal, rush ou stress max.'
    },
    {
      href: '#ops-sim-staff-reviews',
      label: 'À vérifier',
      value: `${pendingReviews} à traiter`,
      detail: 'Valider, proposer une alternative ou refuser.'
    },
    {
      href: '#ops-sim-run-stats',
      label: 'Refus',
      value: hardRefusals ? `${hardRefusals} sans solution` : `${alternatives} alternatives`,
      detail: 'Voir si le moteur propose une vraie issue.'
    },
    {
      href: '#ops-sim-mail-console',
      label: 'Emails',
      value: `${queued} en file`,
      detail: failed ? `${failed} erreur(s) à corriger.` : 'Prévisualiser les mails du run.'
    },
    {
      href: '#ops-sim-agent-logs',
      label: 'Agents & logs',
      value: `${logs.length} logs`,
      detail: 'Lire qui agit et pourquoi.'
    },
  ];
  return `
    <nav class="ops-sim-command-map" aria-label="Raccourcis simulation">
      ${items.map(item => `
        <a class="ops-sim-command-link" href="${escapeHtml(item.href)}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </a>
      `).join('')}
    </nav>`;
}

function renderOpsSimulationStats(stats = {}, run = null) {
  const progress = run?.totalSteps ? Math.round((Number(run.stepIndex || 0) / Number(run.totalSteps || 1)) * 100) : 0;
  const alternatives = Number(stats.alternativesOffered || 0);
  const hardRefusals = Number(stats.hardRefusals || 0);
  const pendingReviews = Number(stats.staffReviewsPending || 0);
  return `
    <div class="ops-grid">
      <div class="ops-stat"><div class="k">Progression</div><div class="v">${run ? `${progress}%` : '--'}</div></div>
      <div class="ops-stat"><div class="k">Réservations créées</div><div class="v">${Number(stats.created || 0)}</div></div>
      <div class="ops-stat"><div class="k">A valider staff</div><div class="v">${pendingReviews}</div></div>
      <div class="ops-stat"><div class="k">Alternatives proposées</div><div class="v">${alternatives}</div></div>
      <div class="ops-stat"><div class="k">Refus sans solution</div><div class="v">${hardRefusals}</div></div>
      <div class="ops-stat"><div class="k">Retards joués</div><div class="v">${Number(stats.delays || 0)}</div></div>
      <div class="ops-stat"><div class="k">Mails simulés</div><div class="v">${Number(stats.mailsDrafted || 0)}</div></div>
      <div class="ops-stat"><div class="k">Erreurs moteur</div><div class="v">${Number(stats.errors || 0)}</div></div>
    </div>`;
}

function renderOpsSimulationStatsPanel(stats = {}, run = null) {
  const progress = run?.totalSteps ? Math.round((Number(run.stepIndex || 0) / Number(run.totalSteps || 1)) * 100) : 0;
  const created = Number(stats.created || 0);
  const alternatives = Number(stats.alternativesOffered || 0);
  const hardRefusals = Number(stats.hardRefusals || 0);
  const pendingReviews = Number(stats.staffReviewsPending || 0);
  const doneReviews = Number(stats.staffReviewsApproved || 0) + Number(stats.staffReviewsRejected || 0) + Number(stats.staffReviewsAlternativesSent || 0);
  const mails = Number(stats.mailsDrafted || 0);
  const errors = Number(stats.errors || 0);
  const delays = Number(stats.delays || 0);
  return `
    <section id="ops-sim-run-stats" class="ops-sim-scoreboard" aria-label="État du run simulation">
      <div class="ops-sim-score-main">
        <span class="ops-sim-overline">État du run</span>
        <strong>${run ? `${progress}%` : '--'}</strong>
        <span>${run ? `${Number(run.stepIndex || 0)} / ${Number(run.totalSteps || 0)} actions jouées` : 'Aucun test lancé'}</span>
        <div class="ops-sim-progress"><span style="width:${progress}%"></span></div>
      </div>
      <div class="ops-sim-score-grid">
        <div class="ops-sim-score"><span>Réservations créées</span><strong>${created}</strong></div>
        <div class="ops-sim-score ${pendingReviews ? 'attention' : ''}"><span>À valider staff</span><strong>${pendingReviews}</strong><small>${doneReviews} traitées</small></div>
        <div class="ops-sim-score"><span>Alternatives proposées</span><strong>${alternatives}</strong></div>
        <div class="ops-sim-score ${hardRefusals ? 'danger' : ''}"><span>Refus sans solution</span><strong>${hardRefusals}</strong></div>
        <div class="ops-sim-score"><span>Emails du run</span><strong>${mails}</strong></div>
        <div class="ops-sim-score ${errors ? 'danger' : ''}"><span>Erreurs moteur</span><strong>${errors}</strong><small>${delays} retard(s)</small></div>
      </div>
    </section>`;
}

function renderOpsSimulationReviews(payload = {}) {
  const run = payload?.run || null;
  const reviews = run?.payload?.staffReviews || [];
  const pending = reviews.filter(review => review.status === 'pending').slice(0, 8);
  const resolved = reviews.filter(review => review.status !== 'pending').slice(-6).reverse();
  if (!reviews.length) {
    return `
      <div id="ops-sim-staff-reviews" class="ops-sim-review-board">
        <div class="ops-sim-card">
          <span class="ops-pill">À vérifier</span>
          <h3>Aucune décision en attente</h3>
          <p>Les demandes risquées, les conflits et les refus sans solution apparaîtront ici avec des actions claires.</p>
        </div>
      </div>`;
  }

  const renderReview = (review) => {
    const alternatives = Array.isArray(review.alternatives) ? review.alternatives.slice(0, 3) : [];
    const canApprove = review.type === 'staff_review' && review.reservationId;
    return `
      <div class="ops-review-item ${escapeHtml(review.risk || '')}">
        <div class="ops-review-main">
          <span class="ops-pill ${escapeHtml(review.risk || '')}">${escapeHtml(review.type === 'staff_review' ? 'Revue staff' : 'Revue')}</span>
          <strong>${escapeHtml(review.title || 'Décision staff')}</strong>
          <p>${escapeHtml(review.summary || review.reason || '')}</p>
          ${alternatives.length ? `<div class="ops-review-alt-list">
            ${alternatives.map((alternative, index) => `
              <button class="ops-review-alt" onclick="reviewOpsSimulation('${escapeHtml(review.id)}','send_alternatives',${index})">
                <strong>${escapeHtml(alternative.summary || `${alternative.date || ''} ${alternative.startTime || ''}`)}</strong>
                <span>${escapeHtml(alternative.reason || alternative.recommendation || 'Alternative compatible')}</span>
              </button>
            `).join('')}
          </div>` : ''}
        </div>
        <div class="ops-review-actions">
          ${canApprove ? `<button class="ops-admin-btn primary" onclick="reviewOpsSimulation('${escapeHtml(review.id)}','approve')">OK staff</button>` : ''}
          ${alternatives.length ? `<button class="ops-admin-btn" onclick="reviewOpsSimulation('${escapeHtml(review.id)}','send_alternatives',0)">Proposer</button>` : ''}
          <button class="ops-admin-btn" onclick="reviewOpsSimulation('${escapeHtml(review.id)}','reject')">Refuser proprement</button>
        </div>
      </div>`;
  };

  return `
    <div id="ops-sim-staff-reviews" class="ops-sim-review-board">
      <div class="ops-sim-card">
        <div class="ops-review-head">
          <div>
            <span class="ops-pill">Staff control</span>
            <h3>Décisions à valider</h3>
            <p>Quand le moteur voit un risque, il propose une action staff au lieu de bloquer en silence.</p>
          </div>
          <strong>${pending.length} en attente</strong>
        </div>
        <div class="ops-review-list">
          ${pending.length ? pending.map(renderReview).join('') : '<p>Aucune décision staff en attente.</p>'}
        </div>
      </div>
      <div class="ops-sim-card">
        <span class="ops-pill">Historique</span>
        <h3>Dernières décisions</h3>
        <div class="ops-sim-timeline">
          ${resolved.length ? resolved.map(review => `
            <div class="ops-sim-timeline-item">
              <strong>${escapeHtml(review.title || review.id)}</strong>
              <span>${escapeHtml(`${OPS_REVIEW_STATUS_LABELS[review.status] || review.status} - ${(() => { const d = review.decision || review.recommendation || ''; return OPS_REVIEW_DECISION_LABELS[d] || d; })()}`)}</span>
            </div>
          `).join('') : '<p>Aucune décision traitée pour le moment.</p>'}
        </div>
      </div>
    </div>`;
}

function renderOpsSimulationCommunications(payload = {}) {
  const communications = Array.isArray(payload.communications) ? payload.communications : [];
  const visible = communications.slice(0, 10);
  const queued = communications.filter(item => item.status === 'queued').length;
  const sent = communications.filter(item => item.status === 'sent' || item.status === 'delivered').length;
  const failed = communications.filter(item => item.status === 'failed').length;
  const drafts = communications.filter(item => item.status === 'draft').length;
  return `
    <section id="ops-sim-mail-console" class="ops-sim-comm-board">
      <div class="ops-sim-comm-head">
        <div>
          <span class="ops-sim-overline">Emails du run</span>
          <h3>Communication simulée et file d'envoi</h3>
          <p>Les messages créés par la simulation apparaissent ici. Les faux clients ne reçoivent rien; les décisions staff peuvent partir vers la boîte test/staff configurée.</p>
        </div>
        <div class="ops-sim-comm-actions">
          <span>${queued} en file</span>
          <button class="ops-admin-btn" onclick="typeof dispatchOpsEmails === 'function' ? dispatchOpsEmails() : toast('File email indisponible sur cette page.')">Envoyer la file</button>
        </div>
      </div>
      <div class="ops-sim-comm-summary">
        <span><strong>${communications.length}</strong> total</span>
        <span><strong>${drafts}</strong> brouillon</span>
        <span><strong>${queued}</strong> en file</span>
        <span><strong>${sent}</strong> envoyés</span>
        <span><strong>${failed}</strong> erreur</span>
      </div>
      <div class="ops-sim-comm-list">
        ${visible.length ? visible.map((item, index) => `
          <button class="ops-sim-comm-row" onclick="previewOpsEmail(${index}, 'simulation')">
            <span class="ops-pill ${escapeHtml(item.status || '')}">${escapeHtml(item.status || 'draft')}</span>
            <strong>${escapeHtml(item.subject || getOpsTemplateLabel(item.templateId))}</strong>
            <span>${escapeHtml(item.recipient || item.payload?.safeRecipient || 'destinataire test non configuré')}</span>
            <small>${escapeHtml(getOpsTemplateLabel(item.templateId))} · ${escapeHtml(formatOpsTimestamp(item.scheduledAt || item.createdAt))}</small>
          </button>
        `).join('') : `
          <div class="ops-sim-empty">
            <strong>Aucun email créé</strong>
            <span>Lancez un niveau puis avancez la simulation. Les confirmations, rappels, refus et alternatives apparaîtront ici.</span>
          </div>`}
      </div>
    </section>`;
}

function buildOpsTrainingReport(payload = {}) {
  const run = payload?.run || null;
  const stats = payload?.stats || run?.payload?.stats || {};
  const logs = payload?.logs || [];
  const communications = payload?.communications || [];
  const reservations = payload?.snapshot?.reservations || [];
  const progress = run?.totalSteps ? Math.round((Number(run.stepIndex || 0) / Number(run.totalSteps || 1)) * 100) : 0;
  const errors = Number(stats.errors || 0);
  const refused = Number(stats.refused || 0);
  const alternatives = Number(stats.alternativesOffered || 0);
  const hardRefusals = Number(stats.hardRefusals || Math.max(0, refused - alternatives));
  const rescuedRefusals = Number(stats.rescuedRefusals || alternatives);
  const created = Number(stats.created || reservations.length || 0);
  const delays = Number(stats.delays || 0);
  const mails = Number(stats.mailsDrafted || communications.length || 0);
  const orchestrations = Number(stats.orchestrations || logs.filter(log => log.agentId === 'orchestrator-agent').length || 0);
  const finishedBonus = run?.status === 'finished' ? 8 : 0;
  const coverageScore = Math.min(35, Math.round(progress * .22)
    + (Number(stats.plannedBowling || 0) ? 3 : 0)
    + (Number(stats.plannedLaser || 0) ? 3 : 0)
    + (Number(stats.plannedFormulas || 0) ? 4 : 0)
    + (delays ? 3 : 0));
  const score = Math.max(0, Math.min(100, 58 + coverageScore + finishedBonus - errors * 18 - hardRefusals * 5 - Math.max(0, refused - alternatives - created) * 1));
  const agents = logs.reduce((acc, log) => {
    const id = log.agentId || 'agent';
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
  const agentMeters = Object.entries(agents)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
  const cases = [
    {
      title: 'Charge multi-jours',
      ok: Number(stats.daysCovered || 0) >= 7,
      detail: `${Number(stats.daysCovered || 0)} jour(s) couverts, ${Number(stats.plannedSteps || 0)} actions prévues.`
    },
    {
      title: 'Mix Bowling / Laser / Formules',
      ok: Number(stats.plannedBowling || 0) && Number(stats.plannedLaser || 0) && Number(stats.plannedFormulas || 0),
      detail: `${Number(stats.plannedBowling || 0)} bowling, ${Number(stats.plannedLaser || 0)} laser, ${Number(stats.plannedFormulas || 0)} formules.`
    },
    {
      title: 'Retards et incidents',
      ok: delays > 0,
      detail: `${delays} retard(s) joués, ${Number(stats.events || 0)} événement(s) terrain.`
    },
    {
      title: 'Communication client',
      ok: mails > 0,
      detail: `${mails} mail(s) simulés, aucun envoi vers vrais clients.`
    },
    {
      title: 'Orchestrateur',
      ok: orchestrations > 0,
      detail: `${orchestrations} lecture(s) orchestration / direction.`
    },
    {
      title: 'Alternatives aux refus',
      ok: alternatives > 0 || refused === 0,
      danger: hardRefusals > 0,
      detail: `${alternatives} proposition(s), ${hardRefusals} refus sans solution.`
    },
    {
      title: 'Robustesse moteur',
      ok: errors === 0,
      danger: errors > 0,
      detail: errors ? `${errors} erreur(s) technique(s) à corriger.` : 'Aucune erreur moteur détectée.'
    }
  ];
  const nextActions = [];
  if (!run) nextActions.push('Lancer un rush accéléré pour créer une base visible.');
  if (progress < 100 && run) nextActions.push('Jouer toute la simulation pour obtenir un score complet.');
  if (!delays) nextActions.push('Ajouter ou jouer des retards pour entraîner le Delay Agent.');
  if (!mails) nextActions.push('Vérifier que les mails simulés sont générés dans le run.');
  if (hardRefusals) nextActions.push('Analyser les refus sans solution et élargir les alternatives proposées.');
  if (errors) nextActions.push('Ouvrir les logs rouges: seules les erreurs sans alternative doivent rester critiques.');
  if (!nextActions.length) nextActions.push('Comparer ce run avec un prochain rush pour voir si les décisions s’améliorent.');
  return {
    score,
    progress,
    created,
    refused,
    alternatives,
    hardRefusals,
    rescuedRefusals,
    delays,
    mails,
    errors,
    agentMeters,
    cases,
    nextActions,
  };
}

function renderOpsTrainingLab(payload = {}) {
  const report = buildOpsTrainingReport(payload);
  const maxAgentCount = Math.max(1, ...report.agentMeters.map(([, count]) => count));
  return `
    <div id="ops-sim-training-lab" class="ops-training-board">
      <div class="ops-training-card">
        <span class="ops-pill">Training Lab IA</span>
        <h3>Banc d'essai visible</h3>
        <p>Ce banc d'essai rejoue des scénarios pour vérifier les agents avant mise en production.</p>
        <div class="ops-training-score">
          <strong>${report.score}</strong>
          <small>/100 robustesse actuelle</small>
        </div>
        <div class="ops-sim-progress"><span style="width:${report.progress}%"></span></div>
        <p>${report.created} réservation(s) créées, ${report.alternatives} alternative(s), ${report.hardRefusals} refus sans solution, ${report.delays} retard(s), ${report.errors} erreur(s) technique(s).</p>
      </div>
      <div class="ops-training-card">
        <span class="ops-pill">Couverture</span>
        <h3>Ce qui est testé</h3>
        <div class="ops-training-matrix">
          ${report.cases.map(test => `<div class="ops-training-case ${test.danger ? 'danger' : test.ok ? 'ok' : 'warn'}">
            <strong>${escapeHtml(test.title)}</strong>
            <span>${escapeHtml(test.detail)}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="ops-training-card">
        <span class="ops-pill">Agents</span>
        <h3>Qui travaille pendant le test</h3>
        <div class="ops-agent-meters">
          ${report.agentMeters.length ? report.agentMeters.map(([agentId, count]) => `
            <div class="ops-agent-meter">
              <div class="ops-agent-meter-head">
                <strong>${escapeHtml(agentId)}</strong>
                <span>${count}</span>
              </div>
              <span class="bar"><i style="--value:${Math.round((count / maxAgentCount) * 100)}%"></i></span>
            </div>
          `).join('') : `<p>Aucun agent journalisé pour le moment. Lance ou avance une simulation.</p>`}
        </div>
      </div>
      <div class="ops-training-card">
        <span class="ops-pill">Amélioration</span>
        <h3>Prochaines corrections</h3>
        <div class="ops-sim-timeline">
          ${report.nextActions.map(action => `<div class="ops-sim-timeline-item"><strong>Action</strong><span>${escapeHtml(action)}</span></div>`).join('')}
        </div>
      </div>
    </div>`;
}

function renderOpsSimulation() {
  const payload = getOpsSimulationPayload();
  const run = payload?.run || null;
  const stats = payload?.stats || run?.payload?.stats || {};
  const logs = payload?.logs || [];
  const timeline = run?.payload?.timeline || [];
  const progress = run?.totalSteps ? Math.round((Number(run.stepIndex || 0) / Number(run.totalSteps || 1)) * 100) : 0;
  const status = run?.status || 'idle';
  const safety = run?.payload?.safety || 'isolated_simulation_no_real_dispatch';
  const profile = run?.payload?.profile || getOpsSimulationProfiles().find(item => item.id === getOpsSimulationScenario()) || null;
  const safetyLabel = safety === 'isolated_simulation_no_real_dispatch' || safety === 'simulation_only_no_real_dispatch'
    ? 'Simulation isolée, aucun vrai message envoyé.'
    : safety;

  if (!payload && opsAdminCache.loading) {
    return `<div class="empty-state"><div class="e-title">Chargement simulation</div><div class="e-sub">Lecture du dernier rush accéléré.</div></div>`;
  }

  const statusLabel = status === 'running' ? 'En cours' : status === 'finished' ? 'Terminée' : status === 'failed' ? 'Erreur' : 'Prête';
  const primaryAction = run?.status === 'running'
    ? `<button class="ops-admin-btn primary" onclick="stepOpsSimulation(12)">Avancer 12 actions</button>`
    : `<button class="ops-admin-btn primary" onclick="startOpsSimulation()">Lancer le niveau</button>`;
  const autoAction = run?.status === 'running'
    ? `<button class="ops-admin-btn" onclick="${opsSimulationAutoRunning ? 'stopOpsSimulationAuto()' : 'resumeOpsSimulationAuto()'}">${opsSimulationAutoRunning ? 'Pause auto' : 'Lecture auto'}</button>`
    : '';

  return `
    <div class="ops-sim-hero">
      <div class="ops-sim-card">
        <span class="ops-pill ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
        <h3>Simulation rush terrain</h3>
        <p>Agents client + staff, réservations bowling/laser/formules, retards, refus limites, mails brouillons et logs de décision. Tout est marqué simulation et ne part pas aux vrais clients.</p>
        ${renderOpsSimulationProfilePicker()}
        <div class="ops-sim-progress"><span style="width:${progress}%"></span></div>
        <p>${run ? `${Number(run.stepIndex || 0)} / ${Number(run.totalSteps || 0)} actions · ${escapeHtml(profile?.label || run.payload?.scenario || 'scenario')} · vitesse x${Number(run.speedFactor || 0)} · ${escapeHtml(run.simDate || '')}` : `Aucun run actif pour ${escapeHtml(getSimulationDate())}.`}</p>
        <div class="ops-sim-actions">
          ${primaryAction}
          ${autoAction}
          <button class="ops-admin-btn" onclick="stepOpsSimulation(24)">Burst 24</button>
          <button class="ops-admin-btn" onclick="fastForwardOpsSimulation()">Jouer tout</button>
          <button class="ops-admin-btn" onclick="resetOpsSimulation()">Reset simulation</button>
        </div>
      </div>
      <div class="ops-sim-card">
        <span class="ops-pill">Pilote terrain</span>
        <h3>Ce que ça prouve</h3>
        <p>${escapeHtml(run?.payload?.fieldPilot?.mission || 'Vérifiez que les suggestions aident vraiment le staff avant de généraliser.')}</p>
        <p style="margin-top:8px;">Sécurité : ${escapeHtml(safetyLabel)} Le SMS sera activé dès qu’un fournisseur sera choisi.</p>
      </div>
    </div>
    ${renderOpsSimulationCommandMap(stats, payload || {})}
    ${renderOpsSimulationStatsPanel(stats, run)}
    ${renderOpsSimulationReviews(payload || {})}
    ${renderOpsSimulationCommunications(payload || {})}
    ${renderOpsTrainingLab(payload || {})}
    <div id="ops-sim-agent-logs" class="ops-sim-hero">
      <div class="ops-sim-card">
        <h3>Timeline accélérée</h3>
        <div class="ops-sim-timeline">
          ${timeline.length ? timeline.slice(-12).reverse().map(item => `
            <div class="ops-sim-timeline-item">
              <strong>${escapeHtml(item.label || item.kind || 'Action')}</strong>
              <span>${escapeHtml(`${item.kind || 'event'} · minute ${item.minute ?? '--'} · ${item.detail || ''}`)}</span>
            </div>
          `).join('') : `<p>Aucune action jouée pour le moment.</p>`}
        </div>
      </div>
      <div class="ops-sim-card">
        <h3>Derniers logs de décision</h3>
        <div>
          ${logs.length ? logs.slice(0, 12).map(log => `
            <div class="ops-sim-log">
              <div><span class="ops-pill ${escapeHtml(log.severity || '')}">${escapeHtml(log.severity || 'info')}</span><div class="meta">${escapeHtml(formatOpsTimestamp(log.createdAt))}</div></div>
              <div><strong>${escapeHtml(log.decisionType || 'decision')}</strong><div class="meta">${escapeHtml(log.payload?.summary || log.payload?.error || log.payload?.action || log.payload?.reason || 'Décision journalisée.')}</div></div>
              <div class="meta">${escapeHtml(log.agentId || 'agent')}<br>${log.reservationId ? `Réservation #${escapeHtml(log.reservationId)}` : 'Run global'}</div>
            </div>
          `).join('') : `<p>Aucun log pour l’instant.</p>`}
        </div>
      </div>
    </div>`;
}

async function loadOpsSimulationStatus(render = true) {
  try {
    const centerId = encodeURIComponent(getActiveOpsCenterId());
    const date = encodeURIComponent(getSimulationDate());
    const payload = await apiRequest(`${API_ENDPOINTS.simulation}?action=status&centerId=${centerId}&date=${date}`);
    storeOpsSimulationPayload(payload);
    if (render) renderOpsAdmin();
    return payload;
  } catch (error) {
    if (render) toast(error.message || 'Simulation indisponible.');
    return null;
  }
}

async function startOpsSimulation() {
  try {
    stopOpsSimulationAuto(false);
    const payload = await apiRequest(API_ENDPOINTS.simulation, {
      method: 'POST',
      body: JSON.stringify({
        action: 'start',
        centerId: getActiveOpsCenterId(),
        date: getSimulationDate(),
        scenario: getOpsSimulationScenario(),
        speedFactor: 96,
        resetExisting: true,
      })
    });
    storeOpsSimulationPayload(payload);
    state.staffResourceView = 'all';
    save();
    renderOpsAdmin();
    toast('Simulation lancée.');
    opsSimulationAutoRunning = true;
    await stepOpsSimulation(Number(payload.run?.payload?.profile?.startBatch || 36), true);
  } catch (error) {
    toast(error.message || 'Impossible de lancer la simulation.');
  }
}

function stopOpsSimulationAuto(render = true) {
  opsSimulationAutoRunning = false;
  clearTimeout(opsSimulationAutoTimer);
  opsSimulationAutoTimer = null;
  if (render) renderOpsAdmin();
}

function resumeOpsSimulationAuto() {
  const run = getOpsSimulationPayload()?.run;
  if (!run || run.status !== 'running') {
    toast('Aucune simulation en cours.');
    return;
  }
  opsSimulationAutoRunning = true;
  renderOpsAdmin();
  scheduleOpsSimulationLoop();
}

function scheduleOpsSimulationLoop() {
  clearTimeout(opsSimulationAutoTimer);
  if (!opsSimulationAutoRunning) return;
  opsSimulationAutoTimer = setTimeout(() => {
    stepOpsSimulation(24, true);
  }, 450);
}

async function stepOpsSimulation(batchSize = 8, auto = false) {
  const current = getOpsSimulationPayload();
  const run = current?.run;
  if (!run?.id || run.status !== 'running') {
    if (!auto) toast('Lancez une simulation avant de jouer les étapes.');
    stopOpsSimulationAuto();
    return;
  }
  try {
    const payload = await apiRequest(API_ENDPOINTS.simulation, {
      method: 'POST',
      body: JSON.stringify({
        action: 'step',
        centerId: getActiveOpsCenterId(),
        date: run.simDate || getSimulationDate(),
        runId: run.id,
        batchSize,
      })
    });
    storeOpsSimulationPayload(payload);
    renderOpsAdmin();
    if (state.view === 'staff') {
      await syncDateReservations(payload.run?.simDate || run.simDate || getSimulationDate(), { silent: true });
    }
    const nextRun = payload.run;
    if (Date.now() - opsSimulationLastDashboardRefreshAt > 2500) {
      opsSimulationLastDashboardRefreshAt = Date.now();
      loadAdminDashboard(true);
    }
    if (nextRun?.status === 'running' && opsSimulationAutoRunning) {
      scheduleOpsSimulationLoop();
    } else {
      stopOpsSimulationAuto(false);
      if (!auto) toast('Simulation terminée.');
      renderOpsAdmin();
      loadAdminDashboard(true);
    }
  } catch (error) {
    stopOpsSimulationAuto(false);
    toast(error.message || 'Étape simulation impossible.');
    renderOpsAdmin();
  }
}

async function fastForwardOpsSimulation() {
  const current = getOpsSimulationPayload();
  const run = current?.run;
  if (!run?.id) {
    toast('Lancez une simulation avant de jouer tout le test.');
    return;
  }
  try {
    stopOpsSimulationAuto(false);
    const payload = await apiRequest(API_ENDPOINTS.simulation, {
      method: 'POST',
      body: JSON.stringify({
        action: 'fastForward',
        centerId: getActiveOpsCenterId(),
        date: run.simDate || getSimulationDate(),
        runId: run.id,
        batchSize: 80,
      })
    });
    storeOpsSimulationPayload(payload);
    renderOpsAdmin();
    await loadAdminDashboard(true);
    toast('Test IA complet joué.');
  } catch (error) {
    toast(error.message || 'Impossible de jouer tout le test.');
  }
}

async function resetOpsSimulation() {
  try {
    stopOpsSimulationAuto(false);
    const payload = await apiRequest(API_ENDPOINTS.simulation, {
      method: 'POST',
      body: JSON.stringify({
        action: 'reset',
        centerId: getActiveOpsCenterId(),
      })
    });
    storeOpsSimulationPayload(payload);
    renderOpsAdmin();
    await loadAdminDashboard(true);
    toast('Données de simulation nettoyées.');
  } catch (error) {
    toast(error.message || 'Reset simulation impossible.');
  }
}

async function reviewOpsSimulation(reviewId, decision, alternativeIndex = 0) {
  const current = getOpsSimulationPayload();
  const run = current?.run;
  if (!run?.id) {
    toast('Lancez une simulation avant de valider.');
    return;
  }
  try {
    const payload = await apiRequest(API_ENDPOINTS.simulation, {
      method: 'POST',
      body: JSON.stringify({
        action: 'review',
        centerId: getActiveOpsCenterId(),
        date: run.simDate || getSimulationDate(),
        runId: run.id,
        reviewId,
        decision,
        alternativeIndex,
      })
    });
    storeOpsSimulationPayload(payload);
    renderOpsAdmin();
    await loadAdminDashboard(true);
    toast(decision === 'approve'
      ? 'Réservation validée.'
      : decision === 'send_alternatives'
        ? 'Alternative ajoutée à la file mail.'
        : 'Refus propre ajouté à la file mail.');
  } catch (error) {
    toast(error.message || 'Décision simulation impossible.');
  }
}

function renderOpsAdmin(errorMessage = '') {
  const panel = document.getElementById('opsAdminContent');
  if (!panel) return;
  // La vue par défaut est l'activité du centre (signaux + terrain fusionnés).
  // Stack IA et Simulation rush sont l'outillage de test du fondateur : ils
  // n'existent que pour platform.admin, même si un vieux state.opsPanelTab les
  // réclame encore. Les anciennes clés (communications, samples, suggestions,
  // events) retombent aussi sur l'activité : les mails vivent dans l'onglet
  // Mails, un seul endroit par usage.
  const isPlatform = typeof canUseStaffPermission === 'function' && canUseStaffPermission('platform.admin');
  const allowedTabs = isPlatform ? ['activity', 'stack', 'simulation'] : ['activity'];
  const activeTab = allowedTabs.includes(state.opsPanelTab) ? state.opsPanelTab : 'activity';
  ['Activity', 'Stack', 'Simulation'].forEach(name => {
    const button = document.getElementById(`opsTab${name}`);
    if (button) button.classList.toggle('active', activeTab === name.toLowerCase());
  });
  if (!opsAdminCache.loaded && opsAdminCache.loading) {
    panel.innerHTML = `<div class="empty-state"><div class="e-title">Chargement discret</div><div class="e-sub">La console prépare les signaux agents et le journal terrain.</div></div>`;
    return;
  }
  if (errorMessage) {
    panel.innerHTML = `<div class="empty-state"><div class="e-title">Console Ops indisponible</div><div class="e-sub">${escapeHtml(errorMessage)}</div></div>`;
    return;
  }
  const updatedAt = opsAdminCache.lastLoadedAt ? `<div class="ops-refresh-note">Actualisé ${escapeHtml(formatOpsTimestamp(opsAdminCache.lastLoadedAt))}</div>` : '';
  const content = activeTab === 'stack'
    ? renderOpsAgentStack()
    : activeTab === 'simulation'
      ? renderOpsSimulation()
      : renderOpsActivity();
  panel.innerHTML = `${updatedAt}${content}`;
}

function previewOpsEmail(index, type = 'sample') {
  const source = type === 'communication-visible'
    ? getVisibleOpsCommunications()
    : type === 'simulation'
      ? (getOpsSimulationPayload()?.communications || [])
      : type === 'communication' ? opsAdminCache.communications : opsAdminCache.samples;
  const item = source[index];
  if (!item) return;
  const html = item.html || item.body || `<pre>${escapeHtml(item.textBody || item.subject || '')}</pre>`;
  const title = item.subject || getOpsTemplateLabel(item.templateId);
  previewOpsEmailHtml(html, title);
}

// Overlay d'aperçu à partir d'un HTML déjà rendu (aperçu d'un brouillon de
// séquence, page Emails), sans passer par un index dans un tableau de cache.
// L'iframe est `sandbox=""` : le HTML du mail ne peut ni exécuter de script ni
// toucher au document de la console.
function previewOpsEmailHtml(html = '', title = 'Aperçu du mail') {
  let overlay = document.getElementById('emailPreviewOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'emailPreviewOverlay';
    document.body.appendChild(overlay);
  }
  // FAMILLE B, le seul vrai montage/demontage de la page Emails : ce noeud est
  // cree et retire a la main, pas reconstruit par innerHTML. C'est donc le seul
  // endroit ou une entree ET une sortie animees sont legitimes. La classe
  // d'ouverture est posee a la frame suivante pour que l'etat initial du CSS
  // (opacite 0, echelle 0.98) soit commite avant la transition.
  // Reouverture pendant la sortie : le retrait differe doit etre annule, sinon
  // le nouvel apercu disparaitrait tout seul 150 ms plus tard.
  if (overlay.__closeTimer) { clearTimeout(overlay.__closeTimer); overlay.__closeTimer = 0; }
  overlay.className = 'email-preview-overlay is-opening';
  overlay.innerHTML = `
    <div class="email-preview-card">
      <div class="email-preview-head">
        <strong>${escapeHtml(title)}</strong>
        <button class="close-btn" onclick="closeEmailPreview()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <iframe class="email-preview-frame" sandbox="" srcdoc="${escapeHtml(html)}"></iframe>
    </div>`;
  // Reflow FORCE, pas requestAnimationFrame : mesure faite, le rAF s'executait
  // avant que l'etat initial (opacite 0, echelle 0.98) ne soit commite, et
  // l'overlay apparaissait d'un coup a pleine opacite. Lire offsetWidth force le
  // navigateur a calculer ce style avant qu'on retire la classe : la transition
  // a alors un point de depart et joue reellement.
  void overlay.offsetWidth;
  overlay.classList.remove('is-opening');
}

function closeEmailPreview() {
  const overlay = document.getElementById('emailPreviewOverlay');
  if (!overlay || overlay.classList.contains('is-closing')) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { overlay.remove(); return; }
  // La SORTIE n'est possible que parce qu'on retarde le retrait du noeud : on ne
  // peut pas animer ce qui est deja detruit. Elle est plus courte que l'entree
  // (150 ms contre 240) : a l'ouverture la gerante decouvre le mail, a la
  // fermeture elle a deja decide. Le delai est cale sur --dur-exit.
  overlay.classList.add('is-closing');
  overlay.__closeTimer = setTimeout(() => { overlay.remove(); }, 150);
}

async function dispatchOpsEmails() {
  try {
    const payload = await apiRequest(API_ENDPOINTS.ops, {
      method: 'POST',
      body: JSON.stringify({ action: 'dispatchDue', limit: 25 })
    });
    if (state.view === 'admin') await loadAdminDashboard(true);
    else await loadOpsAdmin(true);
    toast(`${payload.checked || 0} message(s) vérifié(s) dans la file.`);
  } catch (error) {
    toast(error.message || 'Envoi des mails impossible.');
  }
}

(function exposeOpsConsole(global) {
  if (!global) return;
  global.PinlaneOpsConsole = {
    loadOpsAdmin,
    renderOpsStats,
    getVisibleOpsCommunications,
    renderOpsCommunications,
    renderOpsSamples,
    renderOpsSuggestions,
    getOpsAgentActivation,
    getOpsAgentActivity,
    getSelectedOpsAgent,
    selectOpsAgent,
    renderOpsAgentNode,
    buildOpsAgentOrgTree,
    renderOpsManagerNode,
    renderOpsOrgBranch,
    renderOpsCompactAgentPyramid,
    renderOpsAgentDetail,
    buildOpsLiveProblems,
    renderOpsAgentLiveBoard,
    renderOpsAgentEcosystem,
    renderOpsAgentStack,
    renderOpsActivity,
    renderOpsEvents,
    getSimulationDate,
    storeOpsSimulationPayload,
    getOpsSimulationPayload,
    getOpsSimulationProfiles,
    getOpsSimulationScenario,
    setOpsSimulationScenario,
    startOpsSimulationScenario,
    getOpsSimulationProfileTone,
    renderOpsSimulationProfilePicker,
    renderOpsSimulationCommandMap,
    renderOpsSimulationStats,
    renderOpsSimulationStatsPanel,
    renderOpsSimulationReviews,
    renderOpsSimulationCommunications,
    buildOpsTrainingReport,
    renderOpsTrainingLab,
    renderOpsSimulation,
    loadOpsSimulationStatus,
    startOpsSimulation,
    stopOpsSimulationAuto,
    resumeOpsSimulationAuto,
    scheduleOpsSimulationLoop,
    stepOpsSimulation,
    fastForwardOpsSimulation,
    resetOpsSimulation,
    reviewOpsSimulation,
    renderOpsAdmin,
    previewOpsEmail,
    closeEmailPreview,
    dispatchOpsEmails,
  };
})(typeof window !== 'undefined' ? window : globalThis);
