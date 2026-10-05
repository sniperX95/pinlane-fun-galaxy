const { runOrchestratorForCenter } = require('./orchestrator-runner');
const { runMarketingAgentCycle } = require('./marketing-agents');
const { createWorkerRun, finishWorkerRun, purgeSlotHolds } = require('./database');
const { dispatchDueCommunications, runBirthdayJ30Sweep, runReactivationSweep, runCustomSequencesSweep } = require('./ops-communications');
const { processDueOpsJobs } = require('./ops-jobs');
const { loadOpsKnowledge, refreshCenterOverrides } = require('./ops-knowledge');
const { refreshCatalog } = require('./catalog-store');
const { getPool } = require('./database');
const { collectDailyMetrics, listMissingMetricDates, refreshWeatherForecast } = require('./center-metrics');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

// ---- PP5 : les deux runtimes automatiques ----------------------------------
//
// api/cron.js (Vercel) et workers/ops-worker.js (Railway) appellent exactement
// les trois memes fonctions exportees ci-dessous. Instrumenter recordWorkerTask
// couvre donc LES DEUX runtimes en un seul point, et distingue l'un de l'autre.
//
// Pourquoi la distinction compte : "est-ce un humain, le cron, ou le worker qui
// a fait ca ?" est une des six questions du mandat. Une action automatique ne
// se juge pas comme une action humaine. Sans cette colonne, un envoi de masse
// declenche par une boucle serait indistinguable d'un envoi declenche par la
// directrice, et le journal accuserait la mauvaise personne.
let auditRuntimeKind = 'system';

function setAuditRuntime(kind) {
  if (['cron', 'worker', 'system'].includes(kind)) auditRuntimeKind = kind;
}

function getAuditRuntime() {
  return auditRuntimeKind;
}

async function recordWorkerTask(taskName, run) {
  const { writeAuditLog, newRequestId } = require('./audit-log');
  const auditBase = {
    // Les taches automatiques sont de portee plateforme : elles balayent tous
    // les centres. 'all' est le centre technique de ce cas, jamais un centre
    // reel, pour qu'une directrice ne voie pas dans son journal des lignes
    // qu'elle n'a pas provoquees et ne peut pas expliquer.
    centerId: 'all',
    actorKind: auditRuntimeKind,
    actorMemberId: null,
    actorLabel: auditRuntimeKind === 'worker' ? 'Worker Railway' : (auditRuntimeKind === 'cron' ? 'Cron Vercel' : 'Systeme'),
    surface: 'lib/cron-tasks.js',
    action: taskName,
    method: 'JOB',
    entityType: 'cron_task',
    entityId: taskName,
    requestId: newRequestId(),
  };

  let workerRun = null;
  try {
    workerRun = await createWorkerRun({ taskName });
  } catch (error) {
    // Health logging must not block the actual work.
    workerRun = null;
  }

  try {
    const result = await run();
    const degraded = result?.ok === false;
    if (workerRun) {
      await finishWorkerRun(workerRun.id, {
        status: degraded ? 'failed' : 'ok',
        checkedCount: result.checked || result.results?.length || result.centers?.length || 0,
        error: degraded ? 'Traitement partiellement ou totalement echoue.' : null,
        result,
      }).catch(() => null);
    }
    // Regime non bloquant : une tache automatique ne se refuse pas parce que sa
    // trace ne s'ecrit pas. Un cron qui cesserait de distribuer les mails de
    // confirmation a cause du journal transformerait un probleme
    // d'observabilite en panne client. L'echec crie (prefixe stable + compteur).
    //
    // ON N'ECRIT QUE SI LA TACHE A FAIT QUELQUE CHOSE. Une premiere version
    // ecrivait a CHAQUE tick, inconditionnellement. Cadences reelles du worker
    // (ops-jobs 30 s, dispatch 60 s) : environ 290 lignes par jour qui disent
    // toutes "j'ai regarde, il n'y avait rien". Un journal d'audit noye sous du
    // bruit de boucle ne se lit plus, donc ne sert plus : la ligne utile devient
    // introuvable au milieu des tours a vide. Un passage sans travail n'est pas
    // une MODIFICATION, et ce journal est celui des modifications. La sante du
    // worker, elle, reste tracee ailleurs : createWorkerRun / finishWorkerRun
    // ecrivent a chaque tour dans ops_worker_runs, qui est fait pour ca.
    const traites = (result && (result.checked
      || (result.results && result.results.length)
      || (result.centers && result.centers.length))) || 0;
    if (traites > 0 || degraded) {
      await writeAuditLog({
        ...auditBase,
        outcome: degraded ? 'error' : 'success',
        context: { traites, ...(degraded ? { failed: result.failed || 0, retried: result.retried || 0, superseded: result.superseded || 0 } : {}) },
      });
    }
    return result;
  } catch (error) {
    await writeAuditLog({
      ...auditBase,
      outcome: 'error',
      context: { erreur: String((error && error.message) || 'erreur').slice(0, 300) },
    });
    if (workerRun) {
      await finishWorkerRun(workerRun.id, {
        status: 'failed',
        error: error.message || String(error),
        result: { taskName },
      }).catch(() => null);
    }
    throw error;
  }
}

// Consolide le warehouse quotidien AVANT le cycle marketing : J-1 + rattrapage
// borné (J-5) des dates manquantes + prévision météo J+14. Chaque étape est
// non-fatale : une météo indisponible n'empêche ni les métriques ni le cycle.
async function collectDailyMetricsForCenters(activeCenters) {
  return recordWorkerTask('daily-metrics', async () => {
    const results = [];
    for (const center of activeCenters) {
      const entry = { centerId: center.id, collected: [], forecast: null };
      try {
        const yesterday = daysAgoIso(1);
        const missing = await listMissingMetricDates(center.id, daysAgoIso(5), yesterday).catch(() => [yesterday]);
        const dates = missing.length ? missing : [yesterday];
        for (const date of dates) {
          const collected = await collectDailyMetrics({ centerId: center.id, date });
          entry.collected.push({ date, weather: collected.weather });
        }
      } catch (error) {
        entry.error = error.message || 'Collecte métriques impossible.';
      }
      try {
        entry.forecast = await refreshWeatherForecast(center.id);
      } catch (error) {
        entry.forecast = { ok: false, message: error.message || 'Prévision indisponible.' };
      }
      results.push(entry);
    }
    return { ok: true, action: 'daily-metrics', checked: results.length, results };
  });
}

// Séquences automatiques (anniversaire J-30, réactivation dormants) : sweeps
// quotidiens gouvernés par center_automation_settings, idempotents via le
// journal communications. Non-fatal : une séquence en échec n'arrête rien.
async function runAutomationSequences(activeCenters) {
  return recordWorkerTask('automation-sequences', async () => {
    const results = [];
    for (const center of activeCenters) {
      const entry = { centerId: center.id };
      try {
        entry.birthday = await runBirthdayJ30Sweep(center.id);
      } catch (error) {
        entry.birthday = { ok: false, message: error.message || 'Sweep anniversaire impossible.' };
      }
      try {
        entry.reactivation = await runReactivationSweep(center.id);
      } catch (error) {
        entry.reactivation = { ok: false, message: error.message || 'Sweep réactivation impossible.' };
      }
      try {
        entry.custom = await runCustomSequencesSweep(center.id);
      } catch (error) {
        entry.custom = { ok: false, message: error.message || 'Séquences personnalisées impossibles.' };
      }
      try {
        // Veille concurrence : visite des sites configurés, snapshot si changement.
        const { runCompetitorSweep } = require('./competitor-watch');
        entry.competitors = await runCompetitorSweep(center.id);
      } catch (error) {
        entry.competitors = { ok: false, message: error.message || 'Veille concurrence impossible.' };
      }
      results.push(entry);
    }
    return { ok: true, action: 'automation-sequences', checked: results.length, results };
  });
}

async function runAgentOrchestratorCron({ days = 30 } = {}) {
  await rechaufferLaConnaissance();
  return recordWorkerTask('agent-orchestrator', async () => {
    const knowledge = loadOpsKnowledge();
    const activeCenters = (knowledge.centers || []).filter((center) => center.status === 'active');
    const startDate = daysAgoIso(Number(days || 30));
    const endDate = todayIso();
    const results = [];

    // Warehouse d'abord : le cycle marketing qui suit lit ces données fraîches.
    let dailyMetrics = null;
    try {
      dailyMetrics = await collectDailyMetricsForCenters(activeCenters);
    } catch (error) {
      dailyMetrics = { ok: false, message: error.message || 'Collecte quotidienne impossible.' };
    }

    // Séquences automatiques (anniversaire J-30, réactivation), non-fatal.
    let automationSequences = null;
    try {
      automationSequences = await runAutomationSequences(activeCenters);
    } catch (error) {
      automationSequences = { ok: false, message: error.message || 'Séquences automatiques impossibles.' };
    }

    // LE STRATÈGE (Phase 4) : on ENFILE le plan hebdo, on ne le génère pas ici.
    // Le cron est « au mieux » : s'il échoue, personne ne le sait et le plan
    // manque pendant une semaine. La queue apporte les retries, le backoff et
    // last_error. La clé d'idempotence porte le lundi, donc ce cron peut tourner
    // tous les jours sans jamais produire deux plans ni payer deux appels LLM.
    let strategist = null;
    try {
      const { enqueueWeeklyMarketingPlans } = require('./ops-jobs');
      strategist = await enqueueWeeklyMarketingPlans({ centerIds: activeCenters.map((c) => c.id) });
    } catch (error) {
      strategist = { ok: false, message: error.message || 'Enfilage du plan impossible.' };
    }

    for (const center of activeCenters) {
      const ops = await runOrchestratorForCenter({
        centerId: center.id,
        startDate,
        endDate,
        persist: true,
      });
      let marketing = null;
      try {
        marketing = await runMarketingAgentCycle({
          centerId: center.id,
          startDate,
          endDate,
          persist: true,
          runType: 'cron',
        });
      } catch (error) {
        marketing = {
          ok: false,
          message: error.message || 'Cycle marketing impossible.',
        };
      }
      results.push({ centerId: center.id, ops, marketing });
    }

    return {
      ok: true,
      action: 'agent-orchestrator',
      startDate,
      endDate,
      centers: activeCenters.map((center) => center.id),
      dailyMetrics,
      automationSequences,
      strategist,
      results,
    };
  });
}

// LE CRON LIT LA BASE AVANT DE PARLER AU CLIENT (2026-08-31).
// Mesure : sur un run complet de runDispatchCommunicationsCron et de
// runOpsJobsCron, ZERO requete vers `centers`, `formulas` ou `activities`.
// Les deux runtimes (le worker Railway et le cron Vercel) composaient donc
// leurs mails sur le socle FICHIER pendant toute la duree du process : une
// personnalisation faite en console apres leur demarrage (horaires, jour
// ferme, tarif, formule) n atteignait jamais le client, et un centre ne dans
// la console etait carrement inconnu.
// Le rechauffage vit ICI, dans le module partage, et pas dans les deux points
// d entree : une troisieme facon de declencher ces taches en heriterait
// automatiquement. Fail-soft comme partout ailleurs : sans base, on retombe
// sur le socle fichier plutot que de ne rien envoyer.
async function rechaufferLaConnaissance() {
  let pool = null;
  try { pool = getPool(); } catch (error) { return; }
  if (!pool) return;
  try { await refreshCenterOverrides(pool, { force: true }); } catch (error) { /* socle fichier */ }
  try { await refreshCatalog(pool, { force: true }); } catch (error) { /* catalogue fichier */ }
}

async function runDispatchCommunicationsCron({ limit = 50 } = {}) {
  await rechaufferLaConnaissance();
  return recordWorkerTask('dispatch-communications', () =>
    dispatchDueCommunications({ limit: Number(limit || 50) }));
}

async function runOpsJobsCron({ limit = 25 } = {}) {
  await rechaufferLaConnaissance();
  const resultat = await recordWorkerTask('ops-jobs', () =>
    processDueOpsJobs({ limit: Number(limit || 25) }));
  // Le menage des blocages d horaires (migration 0049) : les lignes liberees
  // ou echues depuis plus de 7 jours. Aucune n est plus lue ; l index des
  // blocages en cours reste court. Un echec ici ne fait pas echouer les
  // travaux du jour, faits juste au-dessus.
  try { await purgeSlotHolds(); } catch (error) { console.error('[ops-jobs] menage des blocages', error && error.message); }
  return resultat;
}

module.exports = {
  // La boite de secours et la sauvegarde de la nuit passent par le meme
  // releve (ops_worker_runs) : la page Secours lit leur dernier passage.
  recordWorkerTask,
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
  setAuditRuntime,
  getAuditRuntime,
};
