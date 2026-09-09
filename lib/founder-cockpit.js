// ============================================================================
// COCKPIT FONDATEUR : le bundle de lecture unique (action GET founderCockpit).
// ============================================================================
//
// Un seul fetch pour toute la page, sur le modele de marketing-brief. Toutes
// les lectures sont CROSS-CENTRES : ce module n'est appele que derriere la
// permission 'platform.admin' (api/ops.js), jamais depuis une console centre.
//
// TROIS REGLES, non negociables ici :
//   1. VERITE DES DONNEES : chaque compteur annonce son perimetre temporel
//      (`window`), et ce qui n'est pas mesurable est dit tel quel (`measured:
//      false`), jamais rendu comme un zero qui ressemble a une mesure. Le SaaS
//      n'est pas lance : le bundle porte `testData: true` et le front
//      l'affiche en toutes lettres.
//   2. RESILIENCE PAR SECTION : une table qui manque ou une requete qui casse
//      ne vide pas le cockpit. Chaque section est chargee independamment et
//      porte son propre `error` en cas d'echec : l'ecran dit "cette brique n'a
//      pas repondu" au lieu d'afficher des zeros faux.
//   3. AUCUN SECRET : on lit des montants (llm_spend), jamais une cle ; les
//      erreurs de mails (last_error) sont des messages fournisseur, pas des
//      credentials. Aucune requete ne concatene une valeur : parametres SQL.
//
// Chaque requete de ce fichier est la SOURCE d'un chiffre affiche : le compte
// rendu du chantier (sourcesDesChiffres) pointe ici.

const { getPool } = require('./database');
const { getAuditHealth, readAuditLog } = require('./audit-log');
const { monthlyBudgetUsd } = require('./llm-budget');
const { getAutomationSettings, getAutomationDefaults } = require('./ops-communications');
const { loadOpenIncidentGroups } = require('./catalog-overrides');
const { getCenter } = require('./ops-knowledge');

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Charge une section sans jamais jeter : le cockpit affiche l'echec de la
// brique, il ne s'ecroule pas avec elle.
async function section(label, loader) {
  try {
    return await loader();
  } catch (error) {
    console.error(`[founder-cockpit] section ${label} indisponible`, error && (error.message || error));
    return { error: 'Cette lecture n\'a pas repondu. Rechargez dans un instant.' };
  }
}

// ── C1 : qu'est-ce qui casse maintenant ─────────────────────────────────────

async function loadMailFailures(pool) {
  const [counts, groups, recent] = await Promise.all([
    pool.query(`
      select count(*)::int as failed
      from communications
      where status = 'failed' and created_at > now() - interval '30 days';
    `),
    pool.query(`
      select coalesce(last_error, '') as last_error, count(*)::int as count
      from communications
      where status = 'failed' and created_at > now() - interval '30 days'
      group by 1 order by 2 desc limit 4;
    `),
    pool.query(`
      select id, center_id, recipient, subject, coalesce(last_error, '') as last_error, attempts, created_at
      from communications
      where status = 'failed' and created_at > now() - interval '30 days'
      order by created_at desc limit 8;
    `),
  ]);
  return {
    window: '30 derniers jours',
    failed: counts.rows[0] ? Number(counts.rows[0].failed) : 0,
    groups: groups.rows.map((row) => ({ lastError: row.last_error, count: Number(row.count) })),
    recent: recent.rows.map((row) => ({
      id: Number(row.id),
      centerId: row.center_id,
      recipient: row.recipient || '',
      subject: row.subject || '',
      lastError: row.last_error,
      attempts: Number(row.attempts) || 0,
      createdAt: toIso(row.created_at),
    })),
  };
}

async function loadFailedJobs(pool) {
  const [counts, recent] = await Promise.all([
    pool.query(`select count(*)::int as failed from ops_jobs where status = 'failed';`),
    pool.query(`
      select id, center_id, job_type, coalesce(last_error, '') as last_error,
             attempts, max_attempts, updated_at
      from ops_jobs
      where status = 'failed'
      order by updated_at desc limit 8;
    `),
  ]);
  return {
    window: 'etat actuel',
    failed: counts.rows[0] ? Number(counts.rows[0].failed) : 0,
    recent: recent.rows.map((row) => ({
      id: Number(row.id),
      centerId: row.center_id,
      jobType: row.job_type,
      lastError: row.last_error,
      attempts: Number(row.attempts) || 0,
      maxAttempts: Number(row.max_attempts) || 0,
      updatedAt: toIso(row.updated_at),
    })),
  };
}

async function loadWorkerHealth(pool) {
  const [last, failed24h, tasks] = await Promise.all([
    pool.query(`select task_name, status, started_at, finished_at, error from ops_worker_runs order by started_at desc limit 1;`),
    pool.query(`select count(*)::int as n from ops_worker_runs where status = 'failed' and started_at > now() - interval '24 hours';`),
    pool.query(`
      select distinct on (task_name) task_name, status, started_at, finished_at, coalesce(error, '') as error
      from ops_worker_runs
      order by task_name, started_at desc
      limit 12;
    `),
  ]);
  const lastRow = last.rows[0] || null;
  return {
    window: '24 dernieres heures pour les echecs',
    lastRun: lastRow
      ? { taskName: lastRow.task_name, status: lastRow.status, startedAt: toIso(lastRow.started_at), finishedAt: toIso(lastRow.finished_at), error: lastRow.error || '' }
      : null,
    failed24h: failed24h.rows[0] ? Number(failed24h.rows[0].n) : 0,
    tasks: tasks.rows.map((row) => ({
      taskName: row.task_name,
      status: row.status,
      startedAt: toIso(row.started_at),
      error: row.error,
    })),
  };
}

async function loadAccessDenied(pool) {
  const [counts, recent] = await Promise.all([
    pool.query(`select count(*)::int as n from audit_log where outcome = 'denied' and occurred_at > now() - interval '7 days';`),
    pool.query(`
      select id, center_id, occurred_at, actor_kind, actor_member_id, actor_label,
             surface, denied_reason, context
      from audit_log
      where outcome = 'denied' and occurred_at > now() - interval '7 days'
      order by occurred_at desc limit 8;
    `),
  ]);
  return {
    window: '7 derniers jours',
    count: counts.rows[0] ? Number(counts.rows[0].n) : 0,
    recent: recent.rows.map((row) => ({
      id: Number(row.id),
      centerId: row.center_id,
      occurredAt: toIso(row.occurred_at),
      actorKind: row.actor_kind,
      actorLabel: row.actor_label || row.actor_member_id || '',
      surface: row.surface || '',
      deniedReason: row.denied_reason || '',
      requestedCenter: (row.context && row.context.centreDemande) || '',
    })),
  };
}

// ── C2 : mes clients l'utilisent-ils ────────────────────────────────────────
//
// Le proprietaire plateforme (membre `<centre>:platform-owner`) est EXCLU des
// compteurs d'adoption : le signal cherche est "le CLIENT s'en sert", pas
// "Movsar a teste hier soir".

async function loadAdoption(pool) {
  const [perCenter, actions, logins, sessions] = await Promise.all([
    pool.query(`
      select center_id,
             max(occurred_at) as last_action,
             count(*) filter (where occurred_at > now() - interval '7 days')::int as d7,
             count(*) filter (where occurred_at > now() - interval '30 days')::int as d30
      from audit_log
      where actor_kind = 'staff'
        and coalesce(actor_member_id, '') not like '%:platform-owner'
      group by center_id;
    `),
    pool.query(`
      select center_id, action, count(*)::int as count
      from audit_log
      where actor_kind = 'staff'
        and coalesce(actor_member_id, '') not like '%:platform-owner'
        and occurred_at > now() - interval '30 days'
      group by center_id, action
      order by count desc
      limit 200;
    `),
    pool.query(`
      select center_id, max(created_at) as last_login
      from staff_access_events
      where event_type = 'login_success'
        and coalesce(actor_member_id, '') not like '%:platform-owner'
      group by center_id;
    `),
    pool.query(`
      select center_id, count(*)::int as active
      from staff_sessions
      where expires_at > now()
        and member_id not like '%:platform-owner'
      group by center_id;
    `),
  ]);
  const byCenter = new Map();
  const entry = (centerId) => {
    if (!byCenter.has(centerId)) {
      byCenter.set(centerId, { centerId, lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 });
    }
    return byCenter.get(centerId);
  };
  perCenter.rows.forEach((row) => {
    const item = entry(row.center_id);
    item.lastStaffAction = toIso(row.last_action);
    item.actions7d = Number(row.d7) || 0;
    item.actions30d = Number(row.d30) || 0;
  });
  logins.rows.forEach((row) => { entry(row.center_id).lastLogin = toIso(row.last_login); });
  sessions.rows.forEach((row) => { entry(row.center_id).activeSessions = Number(row.active) || 0; });
  return {
    window: '7 et 30 derniers jours',
    excludesPlatformOwner: true,
    perCenter: [...byCenter.values()],
    actions30d: actions.rows.map((row) => ({ centerId: row.center_id, action: row.action, count: Number(row.count) })),
  };
}

// ── C3 : que font mes agents IA ─────────────────────────────────────────────

async function loadAgents(pool) {
  const [suggestions, insights, insightsPerCenter, plans, decisions] = await Promise.all([
    pool.query(`
      select count(*)::int as total,
             count(*) filter (where status = 'pending')::int as pending,
             max(created_at) as last_at
      from ops_agent_suggestions;
    `),
    pool.query(`
      select status, count(*)::int as count, max(proposed_at) as last_at
      from marketing_insights
      group by status;
    `),
    pool.query(`
      select center_id, max(proposed_at) as last_at,
             count(*) filter (where proposed_at > now() - interval '30 days')::int as d30
      from marketing_insights
      group by center_id;
    `),
    pool.query(`
      select distinct on (center_id) center_id, status, from_date, to_date, mode, created_at
      from marketing_plans
      where status <> 'archived'
      order by center_id, created_at desc;
    `),
    pool.query(`
      select count(*) filter (where created_at > now() - interval '7 days')::int as d7,
             max(created_at) as last_at
      from ops_decision_logs;
    `),
  ]);
  const suggestionRow = suggestions.rows[0] || {};
  const decisionRow = decisions.rows[0] || {};
  return {
    suggestions: {
      total: Number(suggestionRow.total) || 0,
      pending: Number(suggestionRow.pending) || 0,
      lastAt: toIso(suggestionRow.last_at),
      window: 'depuis le debut',
    },
    insights: {
      byStatus: insights.rows.map((row) => ({ status: row.status, count: Number(row.count), lastAt: toIso(row.last_at) })),
      perCenter: insightsPerCenter.rows.map((row) => ({ centerId: row.center_id, lastAt: toIso(row.last_at), count30d: Number(row.d30) || 0 })),
    },
    plans: plans.rows.map((row) => ({
      centerId: row.center_id,
      status: row.status,
      fromDate: String(row.from_date).slice(0, 10),
      toDate: String(row.to_date).slice(0, 10),
      mode: row.mode,
      createdAt: toIso(row.created_at),
    })),
    decisions: { d7: Number(decisionRow.d7) || 0, lastAt: toIso(decisionRow.last_at), window: '7 derniers jours' },
  };
}

// ── C4 : combien ca coute ───────────────────────────────────────────────────
//
// llm_spend est un registre MENSUEL (une ligne par mois). Le cout PAR JOUR
// n'est donc pas mesurable aujourd'hui : le bundle le dit (dailyMeasured:
// false) et le front affiche "pas encore mesure", jamais un zero.

async function loadCost(pool) {
  const months = await pool.query(`
    select month, cost_usd, calls, updated_at
    from llm_spend
    order by month desc
    limit 6;
  `);
  const budgetUsd = monthlyBudgetUsd();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const current = months.rows.find((row) => row.month === currentMonth) || null;
  const spentUsd = current ? Number(current.cost_usd) || 0 : 0;
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    budgetUsd,
    month: currentMonth,
    monthMeasured: Boolean(current),
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    calls: current ? Number(current.calls) || 0 : 0,
    updatedAt: current ? toIso(current.updated_at) : null,
    // Projection lineaire du mois : depense observee / jours ecoules * jours du
    // mois. C'est une projection, pas une mesure : le front l'annonce ainsi.
    projectionUsd: Math.round((spentUsd / Math.max(1, dayOfMonth)) * daysInMonth * 100) / 100,
    dailyMeasured: false,
    months: months.rows.map((row) => ({ month: row.month, costUsd: Number(row.cost_usd) || 0, calls: Number(row.calls) || 0 })),
  };
}

// ── C6 : mes prospects ──────────────────────────────────────────────────────

async function loadLeads(pool) {
  const [byStatus, recent] = await Promise.all([
    pool.query(`select status, count(*)::int as count from pilot_leads group by status;`),
    pool.query(`
      select center_name, priority, status, created_at
      from pilot_leads
      order by created_at desc limit 5;
    `),
  ]);
  const statuses = {};
  let total = 0;
  byStatus.rows.forEach((row) => {
    statuses[row.status] = Number(row.count) || 0;
    total += Number(row.count) || 0;
  });
  return {
    window: 'depuis le debut',
    total,
    byStatus: statuses,
    lastAt: recent.rows[0] ? toIso(recent.rows[0].created_at) : null,
    recent: recent.rows.map((row) => ({
      centerName: row.center_name || '',
      priority: row.priority || '',
      status: row.status,
      createdAt: toIso(row.created_at),
    })),
  };
}

// ── C7 : etat des sequences par centre (pour les interrupteurs du cockpit) ──

async function loadSequences(centerIds) {
  const defaults = getAutomationDefaults();
  const keys = Object.keys(defaults);
  const perCenter = {};
  await Promise.all(centerIds.map(async (centerId) => {
    const settings = await getAutomationSettings(centerId);
    perCenter[centerId] = {};
    keys.forEach((key) => {
      perCenter[centerId][key] = { enabled: Boolean(settings[key] && settings[key].enabled) };
    });
  }));
  return {
    keys: keys.map((key) => ({ key, label: defaults[key].label || key })),
    perCenter,
  };
}

// ── C8 : pages dediees de la categorie Plateforme ───────────────────────────
//
// Trois bundles independants (actions GET founderAgents / founderIncidents /
// founderClients, meme permission platform.admin que le cockpit, api/ops.js).
// Les NOMS de champs suivent le front assets/founder-cockpit.js : c'est lui
// qui consomme (renderAgentsPage / renderIncidentsPage / renderClientsPage).
// Memes trois regles que le bundle : verite des donnees, resilience par
// section, aucun secret.

// L'agent marketing : ce qu'il a REELLEMENT produit (marketing_insights),
// par statut et par kind sur tout l'historique, volumes 7/30 j par centre,
// dernier propose. valides vs refutes = la preuve que ses idees sont mesurees.
async function loadAgentMarketing(pool) {
  const [statusKind, perCenter, latest] = await Promise.all([
    pool.query(`
      select status, kind, count(*)::int as count, max(proposed_at) as last_at
      from marketing_insights
      group by status, kind;
    `),
    pool.query(`
      select center_id, max(proposed_at) as last_at,
             count(*) filter (where proposed_at > now() - interval '7 days')::int as d7,
             count(*) filter (where proposed_at > now() - interval '30 days')::int as d30
      from marketing_insights
      group by center_id;
    `),
    pool.query(`
      select title, kind, status, channel, proposed_at
      from marketing_insights
      order by proposed_at desc
      limit 1;
    `),
  ]);

  const byStatusMap = new Map();
  const byKindMap = new Map();
  statusKind.rows.forEach((row) => {
    const count = Number(row.count) || 0;
    const lastAt = toIso(row.last_at);
    const statusEntry = byStatusMap.get(row.status) || { status: row.status, count: 0, lastAt: null };
    statusEntry.count += count;
    if (lastAt && (!statusEntry.lastAt || lastAt > statusEntry.lastAt)) statusEntry.lastAt = lastAt;
    byStatusMap.set(row.status, statusEntry);
    const kindEntry = byKindMap.get(row.kind) || { kind: row.kind, count: 0 };
    kindEntry.count += count;
    byKindMap.set(row.kind, kindEntry);
  });
  const statusCount = (status) => (byStatusMap.has(status) ? byStatusMap.get(status).count : 0);

  let count7d = 0;
  let count30d = 0;
  let lastAt = null;
  const centers = perCenter.rows.map((row) => {
    const rowLast = toIso(row.last_at);
    if (rowLast && (!lastAt || rowLast > lastAt)) lastAt = rowLast;
    count7d += Number(row.d7) || 0;
    count30d += Number(row.d30) || 0;
    return { centerId: row.center_id, lastAt: rowLast, count7d: Number(row.d7) || 0, count30d: Number(row.d30) || 0 };
  });

  const latestRow = latest.rows[0] || null;
  return {
    label: 'Agent marketing',
    window: '7 et 30 derniers jours pour les volumes, tout l\'historique pour les statuts',
    lastAt,
    count7d,
    count30d,
    detail: latestRow ? `Dernier propose : ${latestRow.title || '(sans titre)'}` : '',
    lastProposedAt: latestRow ? toIso(latestRow.proposed_at) : null,
    byStatus: [...byStatusMap.values()],
    byKind: [...byKindMap.values()],
    perCenter: centers,
    validated: statusCount('validated'),
    refuted: statusCount('refuted'),
  };
}

// L'agent emails n'existe que si sa table est provisionnee (deploiement
// progressif) : sans table, on renvoie null et la carte du front dit
// "aucune donnee" au lieu d'un zero qui ressemble a une mesure.
async function loadAgentEmails(pool) {
  const reg = await pool.query(`select to_regclass('public.email_agent_memory') as reg;`);
  if (!reg.rows[0] || !reg.rows[0].reg) return null;
  const stats = await pool.query(`
    select count(*)::int as total,
           count(*) filter (where created_at > now() - interval '7 days')::int as d7,
           count(*) filter (where created_at > now() - interval '30 days')::int as d30,
           max(created_at) as last_at,
           (array_agg(intent order by created_at desc))[1] as last_intent
    from email_agent_memory;
  `);
  const row = stats.rows[0] || {};
  return {
    label: 'Agent emails',
    window: '7 et 30 derniers jours pour les volumes, total depuis le debut',
    lastAt: toIso(row.last_at),
    count7d: Number(row.d7) || 0,
    count30d: Number(row.d30) || 0,
    total: Number(row.total) || 0,
    detail: row.last_intent ? `Derniere lecon apprise : ${row.last_intent}` : '',
  };
}

// Lignes ACTIONNABLES de l'agent marketing pour le panneau Appliquer/Ignorer
// de la page Agents IA (le front collectActionableInsights consomme
// `pendingInsights`). Chaque ligne doit porter un id NUMERIQUE (insightStatus le
// coerce en Number cote serveur) et le statut que le front asservit.
//
// TRADUCTION DE VOCABULAIRE, assumee : le cycle de vie reel de marketing_insights
// nomme l'etat "en attente d'arbitrage" `proposed` (proposed -> applied/ignored
// via setInsightStatus ; il n'existe AUCUN statut 'pending' dans le schema, le
// CHECK l'interdirait). Le front, lui, n'inclut un item que si son champ status
// vaut la chaine 'pending' et rend une pastille "en attente" figee. On lit donc
// l'etat reel ('proposed') et on l'expose dans le mot que le front attend
// ('pending') : sans cette traduction, le panneau resterait mort pour toujours.
//
// Les PISTES sont exclues. Ce panneau propose « Appliquer », et une piste est
// une question a trancher, pas une action. Le probleme n est pas le mot :
// Appliquer ecrit status = 'applied', ce qui envoie la ligne dans la file de
// measureAppliedInsights et produit un effet mesure a 14 jours pour une action
// que personne n a faite. Une mesure fabriquee est pire que pas de mesure.
// La piste vit dans le brief du gerant, avec sa population concernee et la
// comparaison deja possible au catalogue.
async function loadPendingInsights(pool) {
  const result = await pool.query(`
    select id, center_id, kind, title, body, proposed_at, created_at
    from marketing_insights
    where status = 'proposed' and kind <> 'piste'
    order by proposed_at desc, id desc
    limit 20;
  `);
  return result.rows.map((row) => ({
    id: Number(row.id),
    status: 'pending',
    kind: row.kind || '',
    title: row.title || '',
    summary: row.body || '',
    centerId: row.center_id || '',
    proposedAt: toIso(row.proposed_at),
    createdAt: toIso(row.created_at),
  }));
}

async function loadAgentSuggestionActivity(pool) {
  const result = await pool.query(`
    select count(*)::int as total,
           count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where created_at > now() - interval '7 days')::int as d7,
           count(*) filter (where created_at > now() - interval '30 days')::int as d30,
           max(created_at) as last_at
    from ops_agent_suggestions;
  `);
  const row = result.rows[0] || {};
  const pending = Number(row.pending) || 0;
  return {
    label: 'Suggestions terrain',
    window: '7 et 30 derniers jours pour les volumes, total depuis le debut',
    lastAt: toIso(row.last_at),
    count7d: Number(row.d7) || 0,
    count30d: Number(row.d30) || 0,
    total: Number(row.total) || 0,
    pending,
    detail: pending > 0 ? `${pending} en attente de decision` : '',
  };
}

async function loadAgentDecisionActivity(pool) {
  const result = await pool.query(`
    select count(*) filter (where created_at > now() - interval '7 days')::int as d7,
           count(*) filter (where created_at > now() - interval '30 days')::int as d30,
           max(created_at) as last_at
    from ops_decision_logs;
  `);
  const row = result.rows[0] || {};
  return {
    label: 'Decisions automatiques',
    window: '7 et 30 derniers jours',
    lastAt: toIso(row.last_at),
    count7d: Number(row.d7) || 0,
    count30d: Number(row.d30) || 0,
  };
}

async function loadMarketingPlanRows(pool) {
  const plans = await pool.query(`
    select distinct on (center_id) center_id, status, from_date, to_date, mode, created_at
    from marketing_plans
    where status <> 'archived'
    order by center_id, created_at desc;
  `);
  return {
    window: 'plans non archives, le plus recent par centre',
    rows: plans.rows.map((row) => ({
      centerId: row.center_id,
      status: row.status,
      fromDate: String(row.from_date).slice(0, 10),
      toDate: String(row.to_date).slice(0, 10),
      mode: row.mode,
      createdAt: toIso(row.created_at),
    })),
  };
}

async function loadCostMonths(pool) {
  const months = await pool.query(`
    select month, cost_usd, calls, updated_at
    from llm_spend
    order by month desc
    limit 12;
  `);
  return {
    window: '12 derniers mois',
    month: new Date().toISOString().slice(0, 7),
    budgetUsd: monthlyBudgetUsd(),
    // HONNETETE : llm_spend est un registre GLOBAL mensuel (une ligne par
    // mois, tous agents confondus). Ventiler un cout PAR agent serait une
    // invention. Le front ecrit "non mesure" sur la foi de ce champ : il ne
    // passera a true que le jour ou le registre sera reellement ventile.
    costPerAgentMeasured: false,
    months: months.rows.map((row) => ({
      month: row.month,
      costUsd: Number(row.cost_usd) || 0,
      calls: Number(row.calls) || 0,
    })),
  };
}

// Bundle de la page Agents IA. `agents` est un objet cle -> carte (le front
// connait l'ordre marketing/emails/suggestions/decisions et affiche "aucune
// donnee" pour toute cle absente) ; une section en echec RETIRE sa carte et
// pose son message dans agentErrors, jamais des zeros muets.
async function buildFounderAgents() {
  const pool = getPool();
  const [marketing, emails, suggestions, decisions, plans, cost, pending] = await Promise.all([
    section('agents.marketing', () => loadAgentMarketing(pool)),
    section('agents.emails', () => loadAgentEmails(pool)),
    section('agents.suggestions', () => loadAgentSuggestionActivity(pool)),
    section('agents.decisions', () => loadAgentDecisionActivity(pool)),
    section('agents.plans', () => loadMarketingPlanRows(pool)),
    section('agents.cost', () => loadCostMonths(pool)),
    section('agents.pending', () => loadPendingInsights(pool)),
  ]);

  const agents = {};
  const agentErrors = {};
  const put = (key, result) => {
    if (!result) return; // ex. tables emails absentes : pas de carte, pas de zero
    if (result.error) { agentErrors[key] = result.error; return; }
    agents[key] = result;
  };
  put('marketing', marketing);
  put('emails', emails);
  put('suggestions', suggestions);
  put('decisions', decisions);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    // Meme doctrine que le bundle cockpit : le SaaS n'est pas lance.
    testData: true,
    agents,
    agentErrors: Object.keys(agentErrors).length ? agentErrors : null,
    plans: plans.error ? { error: plans.error, rows: [] } : plans,
    cost,
    // Lignes actionnables (id numerique + status:'pending') pour le panneau
    // Appliquer/Ignorer du front. section() rend {error} en cas d'echec : dans
    // ce cas liste vide (le panneau reste absent, jamais un faux item).
    pendingInsights: Array.isArray(pending) ? pending : [],
  };
}

// Bundle de la page Incidents : les erreurs console des ecrans staff d'abord
// (le signal que personne ne remonte), puis la casse deja connue du cockpit
// (mails, jobs, worker, refus, sante du journal d'audit) via les MEMES
// loaders : on ne reinvente pas une lecture, on la replace dans le triage.
async function buildFounderIncidents() {
  const pool = getPool();
  const [consoleSection, mails, jobs, worker, denied] = await Promise.all([
    section('console', async () => {
      const groups = await loadOpenIncidentGroups(pool, { limit: 30, sinceDays: 14 });
      return {
        window: '14 derniers jours',
        groups: groups.map((group) => ({
          id: group.stackHash,
          message: group.sampleMessage,
          count: Number(group.count) || 0,
          lastAt: toIso(group.lastAt),
          firstAt: toIso(group.firstAt),
          centers: Array.isArray(group.centers) ? group.centers : [],
          pages: Array.isArray(group.pages) ? group.pages : [],
          stack: group.sampleStackExcerpt || '',
          source: group.sampleSource || '',
          membersTouches: Number(group.membersTouches) || 0,
        })),
      };
    }),
    section('mails', () => loadMailFailures(pool)),
    section('jobs', () => loadFailedJobs(pool)),
    section('worker', () => loadWorkerHealth(pool)),
    section('denied', () => loadAccessDenied(pool)),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    console: consoleSection,
    breakage: { mails, jobs, worker, denied, audit: getAuditHealth() },
  };
}

// Top 5 des acteurs staff par centre sur 30 jours, depuis audit_log. Le
// proprietaire plateforme est EXCLU en SQL : la page lit LEUR gestion, pas
// celle de Movsar (meme doctrine que loadAdoption).
async function loadTopStaffActors(pool) {
  const result = await pool.query(`
    select center_id,
           coalesce(nullif(actor_label, ''), coalesce(actor_member_id, '')) as actor_label,
           count(*)::int as count
    from audit_log
    where actor_kind = 'staff'
      and occurred_at > now() - interval '30 days'
      -- jamais le proprietaire plateforme dans le top des acteurs
      and coalesce(actor_member_id, '') not like '%:platform-owner'
    group by 1, 2
    order by 3 desc, 2 asc
    limit 200;
  `);
  const byCenter = new Map();
  result.rows.forEach((row) => {
    if (!byCenter.has(row.center_id)) byCenter.set(row.center_id, []);
    const list = byCenter.get(row.center_id);
    if (list.length < 5) list.push({ label: row.actor_label || '', count30d: Number(row.count) || 0 });
  });
  return { window: '30 derniers jours', byCenter };
}

async function loadMailVolume(pool) {
  const result = await pool.query(`
    select center_id,
           count(*) filter (where status in ('sent', 'delivered'))::int as sent,
           count(*) filter (where status = 'failed')::int as failed
    from communications
    where direction = 'outbound'
      and created_at > now() - interval '30 days'
    group by center_id;
  `);
  const byCenter = new Map(result.rows.map((row) => [row.center_id, {
    sent30d: Number(row.sent) || 0,
    failed30d: Number(row.failed) || 0,
  }]));
  return { window: '30 derniers jours', byCenter };
}

async function loadSequenceCounts(centerIds) {
  const defaults = getAutomationDefaults();
  const keys = Object.keys(defaults);
  const byCenter = new Map();
  await Promise.all(centerIds.map(async (centerId) => {
    const settings = await getAutomationSettings(centerId);
    const active = keys.filter((key) => settings[key] && settings[key].enabled).length;
    byCenter.set(centerId, { active, total: keys.length });
  }));
  return { byCenter };
}

// Config posee d'un centre, lue dans la base de connaissance (ops-knowledge,
// fichiers + overrides DB deja fusionnes par getCenter). Trois elements
// concrets : pistes de bowling, armes laser, horaires definis jour par jour.
// Un centre absent de la connaissance rend null : "pas encore mesure".
function centerConfigSummary(centerId) {
  let center = null;
  try {
    center = getCenter(centerId);
  } catch (error) {
    return null;
  }
  const resources = center.resources && typeof center.resources === 'object' ? center.resources : {};
  const lanes = Number(resources.bowling && resources.bowling.laneCount) || 0;
  const laserWeapons = Number(resources.laser && resources.laser.weaponCount) || 0;
  const regular = center.defaultSchedule && typeof center.defaultSchedule === 'object'
    ? center.defaultSchedule.regular
    : null;
  // Un marqueur texte ('same_as_...', 'to_confirm') n'est PAS un horaire pose.
  const hoursDefined = Boolean(regular && typeof regular === 'object'
    && Object.values(regular).some((day) => day && typeof day === 'object'));
  const done = [lanes > 0, laserWeapons > 0, hoursDefined].filter(Boolean).length;
  return {
    done,
    total: 3,
    lanes: lanes > 0 ? lanes : null,
    laserWeapons: laserWeapons > 0 ? laserWeapons : null,
    hoursDefined,
  };
}

// Bundle de la page Clients : une carte par centre (identite, config posee,
// adoption detaillee via le loader existant, top acteurs staff, volume mails,
// sequences actives).
async function buildFounderClients() {
  const pool = getPool();
  const centersResult = await section('centers', async () => {
    const rows = await pool.query(`select id, name, status from centers order by id;`);
    return { rows: rows.rows.map((row) => ({ id: row.id, name: row.name, status: row.status })) };
  });
  const centers = centersResult.rows || [];
  const centerIds = centers.map((center) => center.id);

  const [adoption, actors, mailVolume, sequences] = await Promise.all([
    section('clients.adoption', () => loadAdoption(pool)),
    section('clients.actors', () => loadTopStaffActors(pool)),
    section('clients.mails', () => loadMailVolume(pool)),
    section('clients.sequences', () => loadSequenceCounts(centerIds)),
  ]);

  const adoptionByCenter = new Map(
    adoption.error ? [] : (adoption.perCenter || []).map((row) => [row.centerId, row]),
  );

  const list = centers.map((center) => {
    const a = adoptionByCenter.get(center.id) || null;
    return {
      id: center.id,
      name: center.name,
      status: center.status,
      config: centerConfigSummary(center.id),
      adoption: {
        lastStaffAction: a ? a.lastStaffAction : null,
        actions7d: a ? a.actions7d : 0,
        actions30d: a ? a.actions30d : 0,
        lastLogin: a ? a.lastLogin : null,
        activeSessions: a ? a.activeSessions : 0,
      },
      topActors: actors.error ? [] : (actors.byCenter.get(center.id) || []),
      // null (jamais un zero) quand la lecture a echoue : le front ecrit
      // "pas encore mesure" au lieu d'un faux volume.
      mails: mailVolume.error ? null : (mailVolume.byCenter.get(center.id) || { sent30d: 0, failed30d: 0 }),
      sequences: sequences.error ? null : (sequences.byCenter.get(center.id) || null),
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    window: '30 derniers jours',
    excludesPlatformOwner: true,
    centers: centersResult.error ? [] : list,
    centersError: centersResult.error || null,
    adoptionError: adoption.error || null,
    actorsError: actors.error || null,
    mailsError: mailVolume.error || null,
    sequencesError: sequences.error || null,
  };
}

// ── Le bundle ───────────────────────────────────────────────────────────────

async function buildFounderCockpit() {
  const pool = getPool();

  const centersResult = await section('centers', async () => {
    const rows = await pool.query(`select id, name, status from centers order by id;`);
    return { rows: rows.rows.map((row) => ({ id: row.id, name: row.name, status: row.status })) };
  });
  const centers = centersResult.rows || [];
  const centerIds = centers.map((center) => center.id);

  const [
    mails, jobs, worker, denied, adoption, agents, cost, leads, sequences,
    journalSince, auditEntries,
  ] = await Promise.all([
    section('mails', () => loadMailFailures(pool)),
    section('jobs', () => loadFailedJobs(pool)),
    section('worker', () => loadWorkerHealth(pool)),
    section('denied', () => loadAccessDenied(pool)),
    section('adoption', () => loadAdoption(pool)),
    section('agents', () => loadAgents(pool)),
    section('cost', () => loadCost(pool)),
    section('leads', () => loadLeads(pool)),
    section('sequences', () => loadSequences(centerIds)),
    section('journalSince', async () => {
      const result = await pool.query(`select min(occurred_at) as since from audit_log;`);
      return { since: result.rows[0] ? toIso(result.rows[0].since) : null };
    }),
    // Premiere page du journal global (C5). Les pages suivantes et les filtres
    // passent par l'action founderAuditLog, meme gate platform.admin, meme
    // lecteur lib/audit-log.readAuditLog.
    section('audit', async () => ({ entries: await readAuditLog({ centerId: 'all', limit: 40 }) })),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    // Le SaaS n'est pas lance : tout chiffre de ce bundle vient des tests
    // internes. Le front l'affiche en bandeau, ce champ est la source.
    testData: true,
    centers: centersResult.error ? [] : centers,
    centersError: centersResult.error || null,
    journalSince: journalSince.error ? null : journalSince.since,
    breakage: { mails, jobs, worker, denied, audit: getAuditHealth() },
    adoption,
    agents,
    cost,
    leads,
    sequences,
    audit: auditEntries,
  };
}

module.exports = {
  buildFounderCockpit,
  buildFounderAgents,
  buildFounderIncidents,
  buildFounderClients,
};
