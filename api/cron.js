const crypto = require('crypto');
const { sendError, sendJson } = require('../lib/http');
const {
  runAgentOrchestratorCron,
  runDispatchCommunicationsCron,
  runOpsJobsCron,
  setAuditRuntime,
} = require('../lib/cron-tasks');

// Runtime Vercel : les memes taches que le worker Railway, declenchees par le
// planificateur de Vercel. Le journal doit les distinguer.
setAuditRuntime('cron');

// Comparaison a temps constant. On hache les deux cotes avant de comparer :
// crypto.timingSafeEqual leve si les tailles different, ce qui refuirait la
// longueur du secret. Deux empreintes SHA-256 font toujours 32 octets, donc la
// duree de la comparaison ne depend ni du contenu ni de la longueur.
function timingSafeEqualText(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return timingSafeEqualText(req.headers.authorization || '', `Bearer ${expected}`);
}

function getAction(req) {
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return requestUrl.searchParams.get('action') || 'dispatch-communications';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendError(res, 405, 'Methode non autorisee.');
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, 'Cron non autorise.');
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const action = getAction(req);
    if (action === 'agent-orchestrator') {
      const result = await runAgentOrchestratorCron({
        days: requestUrl.searchParams.get('days') || 30,
      });
      sendJson(res, result.ok === false ? 503 : 200, result);
      return;
    }
    if (action === 'dispatch-communications') {
      const result = await runDispatchCommunicationsCron({
        limit: requestUrl.searchParams.get('limit') || 50,
      });
      sendJson(res, result.ok === false ? 503 : 200, result);
      return;
    }
    if (action === 'ops-jobs') {
      const result = await runOpsJobsCron({
        limit: requestUrl.searchParams.get('limit') || 25,
      });
      sendJson(res, result.ok === false ? 503 : 200, result);
      return;
    }
    // LA BOITE DE SECOURS (2026-10-05) : la feuille du jour, ses mises a jour
    // et le classeur du soir, pour chaque centre qui a une boite de secours.
    if (action === 'secours') {
      const { getPool } = require('../lib/database');
      const { normalizeCenterConfig } = require('../lib/center-config');
      const { lancerSecours } = require('../lib/secours-envoi');
      const pool = getPool();
      const lignes = (await pool.query("select id, name, settings from centers where status in ('active', 'planned')")).rows;
      const centres = lignes.map((l) => ({ id: l.id, name: l.name, secours: normalizeCenterConfig((l.settings && l.settings.config) || {}, l.id).secours }));
      const { recordWorkerTask } = require('../lib/cron-tasks');
      const result = await recordWorkerTask('secours', () => lancerSecours({ pool, centres }));
      sendJson(res, result.ok ? 200 : 503, result);
      return;
    }
    // LA SAUVEGARDE DE LA NUIT : toute la base, chiffree, vers une boite a part.
    if (action === 'sauvegarde') {
      const { getPool } = require('../lib/database');
      const { sauvegarderEtEnvoyer } = require('../lib/sauvegarde');
      const { envoyerResend } = require('../lib/secours-envoi');
      const { recordWorkerTask } = require('../lib/cron-tasks');
      const result = await recordWorkerTask('sauvegarde', () => sauvegarderEtEnvoyer({ pool: getPool(), envoyer: (mail) => envoyerResend(mail) }));
      sendJson(res, result.ok || result.ignore ? 200 : 503, result);
      return;
    }
    sendError(res, 400, 'Action cron inconnue.');
  } catch (error) {
    sendError(res, 500, error.message || 'Cron indisponible.');
  }
};
