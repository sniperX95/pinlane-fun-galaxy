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

module.exports = { buildFounderCockpit };
