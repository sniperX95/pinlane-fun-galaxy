const {
  createDelayIncident,
  createOpsJob,
  createOpsEvent,
  getOpsHealth,
  listCommunications,
  listAgentSuggestions,
  listOpsEvents,
  readAdminRangeState,
  readStaffState,
  saveAgentSuggestions,
  updateReservation,
} = require('../lib/database');
const {
  architectureAgent,
  communicationAgent,
  delayAgent,
  learningAgent,
  orchestratorAgent,
  planningAgent,
} = require('../lib/ops-agents');
const { buildAgentEcosystemStatus } = require('../lib/agent-ecosystem');
const { auditAgentSkillCatalog, getAgentSkillCatalog } = require('../lib/agent-skill-registry');
const { runOrchestratorForCenter } = require('../lib/orchestrator-runner');
const {
  buildEmailSamples,
  dispatchDueCommunications,
  enqueueDelayCommunications,
  enqueueReservationCommunications,
} = require('../lib/ops-communications');
const { enqueueReservationAutomation, processDueOpsJobs } = require('../lib/ops-jobs');
const { loadOpsKnowledge } = require('../lib/ops-knowledge');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { requireStaffPermission } = require('../lib/staff-auth');

async function buildContext(body) {
  if (body.context) return body.context;
  if (Array.isArray(body.reservations)) {
    return {
      reservations: body.reservations,
      laneStatuses: body.laneStatuses || {},
    };
  }

  try {
    const snapshot = await readStaffState(body.date, body.centerId || 'libramont');
    return {
      reservations: snapshot.reservations,
      laneStatuses: snapshot.laneStatuses,
      syncedAt: snapshot.syncedAt,
    };
  } catch (error) {
    return {
      reservations: [],
      laneStatuses: {},
      warning: error.message || 'Contexte temps reel indisponible.',
    };
  }
}

function getAction(req, body = {}) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return body.action || url.searchParams.get('action') || 'knowledge';
}

async function handleGet(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const action = getAction(req);
  const centerId = url.searchParams.get('centerId') || 'libramont';
  const startDate = url.searchParams.get('startDate') || url.searchParams.get('date') || '';
  const endDate = url.searchParams.get('endDate') || startDate || '';

  if (action === 'knowledge') {
    const knowledge = loadOpsKnowledge();
    sendJson(res, 200, {
      ok: true,
      schemaVersion: knowledge.schemaVersion,
      centers: knowledge.centers,
      activities: knowledge.activities,
      formulas: knowledge.formulas,
      rules: knowledge.rules,
      competitivePlaybook: knowledge.competitivePlaybook,
    });
    return;
  }

  if (action === 'events') {
    const events = await listOpsEvents({ centerId, limit: Number(url.searchParams.get('limit') || 200) });
    sendJson(res, 200, { ok: true, centerId, events });
    return;
  }

  if (action === 'suggestions') {
    const suggestions = await listAgentSuggestions({
      centerId,
      status: url.searchParams.get('status') || 'pending',
      limit: Number(url.searchParams.get('limit') || 100),
    });
    sendJson(res, 200, { ok: true, suggestions });
    return;
  }

  if (action === 'communications') {
    const communications = await listCommunications({
      centerId,
      status: url.searchParams.get('status') || '',
      limit: Number(url.searchParams.get('limit') || 100),
    });
    sendJson(res, 200, { ok: true, centerId, communications });
    return;
  }

  if (action === 'health') {
    const health = await getOpsHealth({
      centerId,
      limit: Number(url.searchParams.get('limit') || 20),
    });
    sendJson(res, 200, { ok: true, health });
    return;
  }

  if (action === 'emailSamples') {
    sendJson(res, 200, { ok: true, samples: buildEmailSamples() });
    return;
  }

  if (action === 'agentStack') {
    let context = { centerId };
    if (startDate && endDate) {
      try {
        const [rangeState, communications, suggestions, events] = await Promise.all([
          readAdminRangeState(startDate, endDate, centerId),
          listCommunications({ centerId, limit: 200 }),
          listAgentSuggestions({ centerId, status: 'pending', limit: 200 }),
          listOpsEvents({ centerId, limit: 1000 }),
        ]);
        context = {
          centerId,
          startDate,
          endDate,
          reservations: rangeState.reservations || [],
          laneStatuses: rangeState.laneStatuses || {},
          communications,
          suggestions,
          events,
          knowledge: loadOpsKnowledge(),
          syncedAt: rangeState.syncedAt,
          snapshotRevision: rangeState.revision,
        };
      } catch (error) {
        context = {
          centerId,
          startDate,
          endDate,
          contextWarning: error.message || 'Donnees site indisponibles pour orchestration.',
        };
      }
    }
    const result = architectureAgent(context);
    const ecosystem = buildAgentEcosystemStatus({
      ...context,
      activations: result.orchestration?.activations || [],
      orchestration: result.orchestration,
    });
    sendJson(res, 200, { ok: true, ...result, ecosystem });
    return;
  }

  if (action === 'agentEcosystem') {
    sendJson(res, 200, { ok: true, ecosystem: buildAgentEcosystemStatus({ centerId }) });
    return;
  }

  if (action === 'agentSkills') {
    sendJson(res, 200, { ok: true, catalog: getAgentSkillCatalog() });
    return;
  }

  sendError(res, 400, 'Action Ops GET inconnue.');
}

async function handlePost(req, res) {
  const body = arguments.length >= 3 ? arguments[2] : await readJson(req);
  const action = getAction(req, body);

  if (action === 'plan') {
    const context = await buildContext(body);
    const result = planningAgent(body, context);
    sendJson(res, 200, { ok: true, contextWarning: context.warning || null, ...result });
    return;
  }

  if (action === 'delay') {
    const context = await buildContext(body);
    const result = delayAgent(body, context);
    if (body.applyDelay || body.apply) {
      const reservation = body.reservation || {};
      const impact = result.impact || {};
      const reservationId = reservation.id || body.reservationId || body.id;
      if (!reservationId) {
        throw new Error('Reservation manquante pour appliquer le retard.');
      }
      if (!impact.canApply) {
        const communications = await enqueueDelayCommunications(
          { ...reservation, id: reservationId, centerId: reservation.centerId || body.centerId || 'libramont' },
          impact,
          body.options || {},
        );
        await createDelayIncident({
          centerId: reservation.centerId || body.centerId || 'libramont',
          reservationId,
          delayMinutes: impact.delayMinutes || body.delayMinutes || 0,
          reason: impact.reason || body.reason || 'retard signale',
          status: 'needs_staff',
          previousStartTime: impact.previousStartTime || reservation.startTime || '',
          proposedStartTime: impact.proposedStartTime || '',
          impact,
          communications: { queued: communications.map((item) => item.id) },
          idempotencyKey: `delay:${reservationId}:${impact.delayMinutes || body.delayMinutes || 0}:${impact.proposedStartTime || 'none'}`,
        }).catch(() => null);
        sendJson(res, 409, {
          ok: false,
          contextWarning: context.warning || null,
          ...result,
          applied: false,
          communications,
          message: 'Retard non applicable automatiquement. Choisir une alternative proposee.',
        });
        return;
      }

      const shiftedPlan = impact.shiftedPlan || {};
      const updatedReservation = await updateReservation({
        ...reservation,
        id: reservationId,
        centerId: reservation.centerId || body.centerId || 'libramont',
        date: reservation.date || body.date,
        startTime: impact.proposedStartTime || reservation.startTime,
        lanes: shiftedPlan.assignedLanes || reservation.lanes || [],
        opsPlan: shiftedPlan,
        notes: [
          reservation.notes || '',
          `Retard applique +${impact.delayMinutes || body.delayMinutes || 0} min (${impact.reason || body.reason || 'retard signale'}).`,
        ].filter(Boolean).join('\n'),
      });
      await createOpsEvent({
        centerId: updatedReservation.centerId,
        reservationId: updatedReservation.id,
        eventType: 'delay_applied',
        severity: impact.severity === 'needs_staff_decision' ? 'warning' : 'info',
        payload: {
          previousStartTime: impact.previousStartTime,
          proposedStartTime: impact.proposedStartTime,
          delayMinutes: impact.delayMinutes,
          reason: impact.reason,
          conflicts: impact.conflicts || [],
        },
      }).catch(() => null);
      const communications = await enqueueDelayCommunications(updatedReservation, impact, body.options || {});
      await createDelayIncident({
        centerId: updatedReservation.centerId,
        reservationId: updatedReservation.id,
        delayMinutes: impact.delayMinutes || body.delayMinutes || 0,
        reason: impact.reason || body.reason || 'retard signale',
        status: 'applied',
        previousStartTime: impact.previousStartTime || reservation.startTime || '',
        proposedStartTime: impact.proposedStartTime || updatedReservation.startTime || '',
        impact,
        communications: { queued: communications.map((item) => item.id) },
        idempotencyKey: `delay:${updatedReservation.id}:${impact.delayMinutes || body.delayMinutes || 0}:${impact.proposedStartTime || updatedReservation.startTime}`,
      }).catch(() => null);
      const dispatch = body.dispatch === false ? null : await dispatchDueCommunications({ limit: 10 });
      sendJson(res, 200, {
        ok: true,
        contextWarning: context.warning || null,
        ...result,
        applied: true,
        reservation: updatedReservation,
        communications,
        dispatch,
      });
      return;
    }
    sendJson(res, 200, { ok: true, contextWarning: context.warning || null, ...result });
    return;
  }

  if (action === 'communicationDraft') {
    const result = communicationAgent(body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'enqueueReservation') {
    if (!body.reservation) throw new Error('Reservation manquante.');
    const jobs = await enqueueReservationAutomation(body.reservation, body.options || {});
    const communications = await enqueueReservationCommunications(body.reservation, body.options || {});
    sendJson(res, 200, { ok: true, action, jobs, communications });
    return;
  }

  if (action === 'dispatchDue') {
    const result = await dispatchDueCommunications({ limit: body.limit || 25 });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  if (action === 'processJobs') {
    const result = await processDueOpsJobs({ limit: body.limit || 25 });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  if (action === 'enqueueJob') {
    const job = await createOpsJob(body.job || body);
    sendJson(res, 201, { ok: true, action, job });
    return;
  }

  if (action === 'event') {
    const event = await createOpsEvent(body);
    let learning = null;
    if (body.runLearning !== false) {
      const events = await listOpsEvents({ centerId: event.centerId, limit: 1000 });
      learning = learningAgent({ events });
      if (learning.suggestions.length) {
        await saveAgentSuggestions(
          learning.suggestions.map((suggestion) => ({
            ...suggestion,
            agentId: 'learning-agent',
            suggestionType: 'duration_adjustment',
            severity: suggestion.confidence >= 0.75 ? 'high' : 'medium',
          })),
        );
      }
    }
    sendJson(res, 201, { ok: true, event, learning });
    return;
  }

  if (action === 'learning') {
    const result = learningAgent(body);
    let savedSuggestions = [];
    if (body.persist !== false && result.suggestions.length) {
      savedSuggestions = await saveAgentSuggestions(
        result.suggestions.map((suggestion) => ({
          ...suggestion,
          agentId: 'learning-agent',
          suggestionType: 'duration_adjustment',
          severity: suggestion.confidence >= 0.75 ? 'high' : 'medium',
        })),
      );
    }
    sendJson(res, 200, { ok: true, ...result, savedSuggestions: savedSuggestions.length });
    return;
  }

  if (action === 'orchestrate') {
    const result = body.context
      ? { ok: true, orchestration: orchestratorAgent(body.context), savedSuggestions: 0 }
      : await runOrchestratorForCenter({
        centerId: body.centerId || 'libramont',
        startDate: body.startDate,
        endDate: body.endDate,
        persist: body.persist !== false,
      });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'agentStackAudit') {
    const result = auditAgentSkillCatalog();
    sendJson(res, result.ok ? 200 : 422, { ok: result.ok, ...result });
    return;
  }

  sendError(res, 400, 'Action Ops POST inconnue.');
}

function getRequiredOpsPermission(method, action) {
  if (method === 'GET') {
    if (['communications', 'emailSamples'].includes(action)) return 'emails.view';
    if (action === 'health') return ['dashboard.view', 'ai.ops'];
    if (action === 'knowledge') return ['dashboard.view', 'planning.view', 'ai.ops'];
    return 'ai.ops';
  }
  if (['communicationDraft'].includes(action)) return 'emails.view';
  if (['enqueueReservation', 'dispatchDue'].includes(action)) return 'emails.send';
  if (['processJobs', 'enqueueJob'].includes(action)) return 'ai.ops';
  if (['plan', 'delay'].includes(action)) return ['planning.view', 'ai.ops'];
  return 'ai.ops';
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
      const action = getAction(req);
      const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const session = await requireStaffPermission(req, res, getRequiredOpsPermission('GET', action), {
        centerId: requestUrl.searchParams.get('centerId') || '',
      });
      if (!session) return;
      await handleGet(req, res);
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = getAction(req, body);
      const session = await requireStaffPermission(req, res, getRequiredOpsPermission('POST', action), {
        centerId: body.centerId || body.center_id || '',
      });
      if (!session) return;
      await handlePost(req, res, body);
      return;
    }
    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || 'Operation Ops impossible.');
  }
};
