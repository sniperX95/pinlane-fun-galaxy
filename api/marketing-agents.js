const {
  getMarketingAgentStatus,
  recordMarketingFeedback,
  runMarketingAgentCycle,
} = require('../lib/marketing-agents');
const { loadOpsKnowledge } = require('../lib/ops-knowledge');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { requireStaffPermission, sessionHasPermission } = require('../lib/staff-auth');

function getAction(req, body = {}) {
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return body.action || requestUrl.searchParams.get('action') || 'status';
}

function getCenterIds(centerId = 'libramont') {
  if (centerId !== 'all') return [centerId || 'libramont'];
  const knowledge = loadOpsKnowledge();
  return (knowledge.centers || [])
    .filter((center) => center.status === 'active')
    .map((center) => center.id);
}

function normalizeCenterId(value, fallback = 'libramont') {
  return String(value || fallback).trim().toLowerCase();
}

async function statusForCenters(centerIds) {
  const results = await Promise.all(centerIds.map((centerId) => getMarketingAgentStatus({ centerId })));
  return {
    ok: true,
    centers: results,
    updatedAt: new Date().toISOString(),
  };
}

async function runForCenters(body = {}) {
  const requestedCenterId = normalizeCenterId(body.centerId || body.center_id, 'libramont');
  const centerIds = getCenterIds(requestedCenterId);
  const results = [];
  for (const centerId of centerIds) {
    results.push(await runMarketingAgentCycle({
      centerId,
      startDate: body.startDate,
      endDate: body.endDate,
      objective: body.objective,
      brief: body.brief,
      persist: body.persist !== false,
      runType: body.runType || 'manual',
    }));
  }
  return {
    ok: true,
    action: 'run',
    centers: results,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  setCors(res, 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const action = getAction(req);
      const centerId = normalizeCenterId(requestUrl.searchParams.get('centerId'), 'libramont');
      const permissionCenterId = centerId === 'all' ? '' : centerId;
      const session = await requireStaffPermission(req, res, ['campaigns.manage', 'marketing.agents'], { centerId: permissionCenterId });
      if (!session) return;
      if (centerId === 'all' && !sessionHasPermission(session, 'centers.switch')) {
        sendError(res, 403, 'Acces multi-centres insuffisant.');
        return;
      }
      if (action === 'status') {
        sendJson(res, 200, await statusForCenters(getCenterIds(centerId)));
        return;
      }
      if (action === 'run') {
        sendError(res, 405, 'Lancement agents marketing reserve au POST.');
        return;
      }
      sendError(res, 400, 'Action marketing inconnue.');
      return;
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = getAction(req, body);
      const centerId = normalizeCenterId(body.centerId || body.center_id, 'libramont');
      const permissionCenterId = centerId === 'all' ? '' : centerId;
      const session = await requireStaffPermission(req, res, ['campaigns.manage', 'marketing.agents'], { centerId: permissionCenterId });
      if (!session) return;
      if (centerId === 'all' && !sessionHasPermission(session, 'centers.switch')) {
        sendError(res, 403, 'Acces multi-centres insuffisant.');
        return;
      }
      if (action === 'run') {
        sendJson(res, 200, await runForCenters({ ...body, centerId }));
        return;
      }
      if (action === 'feedback') {
        const feedback = await recordMarketingFeedback({ ...body, centerId });
        const status = await statusForCenters(getCenterIds(centerId));
        sendJson(res, 201, { ok: true, feedback, ...status });
        return;
      }
      sendError(res, 400, 'Action marketing inconnue.');
      return;
    }

    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || 'Agents marketing indisponibles.');
  }
};
