const {
  getSimulationStatus,
  reviewSimulationDecision,
  resetSimulation,
  startSimulation,
  stepSimulation,
} = require('../lib/ops-simulation');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { todayStr } = require('../lib/booking-config');
const { requireStaffPermission } = require('../lib/staff-auth');

function getAction(req, body = {}) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return body.action || url.searchParams.get('action') || 'status';
}

function getQuery(req) {
  return new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams;
}

function normalizeCenterId(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEffectiveCenterId(session, requestedCenterId = '') {
  return normalizeCenterId(requestedCenterId || session?.authorizedCenterId || session?.centerId || 'libramont');
}

async function handleGet(req, res, options = {}) {
  const query = getQuery(req);
  const action = getAction(req);
  const centerId = options.centerId || normalizeCenterId(query.get('centerId') || '') || 'libramont';
  const date = query.get('date') || todayStr();
  const runId = query.get('runId') || '';

  if (action === 'status') {
    sendJson(res, 200, await getSimulationStatus({ centerId, date, runId }));
    return;
  }

  sendError(res, 400, 'Action simulation GET inconnue.');
}

async function handlePost(req, res, providedBody = null, options = {}) {
  const body = providedBody || await readJson(req);
  const action = getAction(req, body);
  const centerId = options.centerId || normalizeCenterId(body.centerId || body.center_id || '') || 'libramont';
  const date = body.date || todayStr();

  if (action === 'start') {
    const payload = await startSimulation({
      centerId,
      date,
      scenario: body.scenario,
      speedFactor: body.speedFactor,
      resetExisting: body.resetExisting === true,
    });
    sendJson(res, 201, payload);
    return;
  }

  if (action === 'step') {
    const payload = await stepSimulation({
      centerId,
      date,
      runId: body.runId,
      batchSize: body.batchSize || 6,
    });
    sendJson(res, 200, payload);
    return;
  }

  if (action === 'fastForward') {
    let latest = await getSimulationStatus({ centerId, date, runId: body.runId || '' });
    let guard = 0;
    while (latest.run?.status === 'running' && guard < 80) {
      latest = await stepSimulation({
        centerId,
        date,
        runId: latest.run.id,
        batchSize: body.batchSize || 40,
      });
      guard += 1;
    }
    sendJson(res, 200, latest);
    return;
  }

  if (action === 'reset') {
    sendJson(res, 200, await resetSimulation({
      centerId,
      runId: body.runId || '',
      confirmResetAll: body.confirmResetAll === true,
    }));
    return;
  }

  if (action === 'review') {
    const payload = await reviewSimulationDecision({
      centerId,
      date,
      runId: body.runId,
      reviewId: body.reviewId,
      decision: body.decision,
      alternativeIndex: body.alternativeIndex,
    });
    sendJson(res, 200, payload);
    return;
  }

  sendError(res, 400, 'Action simulation POST inconnue.');
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
      const query = getQuery(req);
      const requestedCenterId = normalizeCenterId(query.get('centerId') || '');
      const session = await requireStaffPermission(req, res, 'platform.admin', { centerId: requestedCenterId });
      if (!session) return;
      await handleGet(req, res, { centerId: resolveEffectiveCenterId(session, requestedCenterId) });
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const requestedCenterId = normalizeCenterId(body.centerId || body.center_id || '');
      const session = await requireStaffPermission(req, res, 'platform.admin', { centerId: requestedCenterId });
      if (!session) return;
      await handlePost(req, res, body, { centerId: resolveEffectiveCenterId(session, requestedCenterId) });
      return;
    }
    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    sendError(res, error.statusCode || 400, require('../lib/http').publicErrorMessage(error, 'Simulation impossible.'));
  }
};
