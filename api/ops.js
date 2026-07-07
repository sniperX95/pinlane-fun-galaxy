const {
  applyReservationScheduleUpdates,
  cancelReservationCommunications,
  cancelReservationOpsJobs,
  createDelayIncident,
  createOpsJob,
  createOpsEvent,
  getDelayIncidentById,
  getReservationById,
  getOpsHealth,
  listCommunications,
  listAgentSuggestions,
  listOpsEvents,
  readAdminRangeState,
  readStaffState,
  saveAgentSuggestions,
} = require('../lib/database');
const { computeDelayImpact } = require('../lib/ops-engine');
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
  enqueueDelayChangeCommunications,
  enqueueReservationCommunications,
  listDelayNotificationChannels,
} = require('../lib/ops-communications');
const { enqueueReservationAutomation, processDueOpsJobs } = require('../lib/ops-jobs');
const { loadOpsKnowledge, refreshCenterOverrides } = require('../lib/ops-knowledge');
const {
  listCenterConfigs,
  saveCenterConfigOverride,
  upsertCenter,
  setCenterStatus,
} = require('../lib/center-config');
const { getPool } = require('../lib/database');
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

function createHttpError(message, statusCode = 400, expose = true) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = expose; // message sûr à montrer au client (français, contrôlé)
  return error;
}

// Message affichable au client : seulement si l'erreur est intentionnelle
// (validation métier marquée expose). Sinon (panne DB/upstream…) → générique,
// et le détail technique part en logs.
function safeUserMessage(error, fallback = 'Service momentanément indisponible. Réessayez dans un instant.') {
  if (error && error.expose === true && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  console.error('[ops] erreur non exposée', error && (error.stack || error.message || error));
  return fallback;
}

function normalizeCenterId(value) {
  return String(value || '').trim().toLowerCase();
}

function getBodyCenterId(body = {}) {
  return normalizeCenterId(
    body.centerId
    || body.center_id
    || body.reservation?.centerId
    || body.reservation?.center_id
    || body.job?.centerId
    || body.job?.center_id
    || body.event?.centerId
    || body.event?.center_id
    || body.context?.centerId
    || '',
  );
}

function resolveEffectiveCenterId(session, requestedCenterId = '') {
  return normalizeCenterId(requestedCenterId || session?.authorizedCenterId || session?.centerId || 'libramont');
}

function centerScope(centerId) {
  return centerId === 'all' ? '' : centerId;
}

function withCenter(body = {}, centerId = 'libramont') {
  const next = { ...body, centerId };
  if (body.reservation && typeof body.reservation === 'object') {
    next.reservation = { ...body.reservation, centerId };
  }
  if (body.job && typeof body.job === 'object') {
    next.job = { ...body.job, centerId };
  }
  if (body.event && typeof body.event === 'object') {
    next.event = { ...body.event, centerId };
  }
  return next;
}

function getAction(req, body = {}) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  return body.action || url.searchParams.get('action') || 'knowledge';
}

async function handleGet(req, res, options = {}) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const action = getAction(req);
  const centerId = options.centerId || normalizeCenterId(url.searchParams.get('centerId') || '') || 'libramont';
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

  if (action === 'centerConfig') {
    const session = await requireStaffPermission(req, res, ['settings.manage', 'direction.view'], { centerId });
    if (!session) return;
    const pool = getPool();
    try {
      await refreshCenterOverrides(pool, { force: true });
    } catch (error) {
      // Fall back to file baseline if the refresh fails.
    }
    const centers = await listCenterConfigs(pool);
    const knowledge = loadOpsKnowledge();
    const activities = (knowledge.activities || []).map((activity) => ({
      id: activity.id,
      label: activity.label || activity.name || activity.id,
    }));
    sendJson(res, 200, { ok: true, centers, activities });
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

async function handlePost(req, res, providedBody = null, options = {}) {
  const body = providedBody || (await readJson(req));
  const action = getAction(req, body);
  const centerId = options.centerId || normalizeCenterId(body.centerId || body.center_id || '') || 'libramont';
  const scopedCenterId = centerScope(centerId);
  const requireConcreteCenter = (label = action) => {
    if (!scopedCenterId) {
      throw createHttpError(`Action ${label} refusée: choisissez un centre précis.`, 400);
    }
    return scopedCenterId;
  };

  if (action === 'plan') {
    requireConcreteCenter('planification');
    const scopedBody = withCenter(body, centerId);
    const context = await buildContext(scopedBody);
    const result = planningAgent(scopedBody, context);
    sendJson(res, 200, { ok: true, contextWarning: context.warning || null, ...result });
    return;
  }

  if (action === 'saveCenterConfig') {
    const session = await requireStaffPermission(req, res, ['settings.manage'], { centerId });
    if (!session) return;
    const targetCenter = requireConcreteCenter('configuration centre');
    const pool = getPool();
    let config;
    try {
      config = await saveCenterConfigOverride(pool, targetCenter, body.config || {});
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Enregistrement de la configuration impossible pour le moment. Réessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, centerId: targetCenter, config });
    return;
  }

  if (action === 'saveCenter') {
    const session = await requireStaffPermission(req, res, ['settings.manage'], { centerId: 'all' });
    if (!session) return;
    const pool = getPool();
    let center;
    try {
      center = await upsertCenter(pool, body.center || {});
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Enregistrement du centre impossible pour le moment. Réessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, center });
    return;
  }

  if (action === 'setCenterStatus') {
    const session = await requireStaffPermission(req, res, ['settings.manage'], { centerId });
    if (!session) return;
    const targetCenter = requireConcreteCenter('statut centre');
    const pool = getPool();
    let center;
    try {
      center = await setCenterStatus(pool, targetCenter, body.status);
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Changement de statut impossible pour le moment. Réessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, center });
    return;
  }

  if (action === 'delay') {
    // Analyse legacy mono-réservation (agents, simulation). L'application d'un
    // retard passe désormais par delayImpact → delayApply → delayNotify :
    // preview obligatoire, application atomique, notifications sur demande.
    requireConcreteCenter('retard');
    const effectiveBody = withCenter(body, centerId);
    const context = await buildContext(effectiveBody);
    const result = delayAgent(effectiveBody, context);
    sendJson(res, 200, { ok: true, contextWarning: context.warning || null, ...result });
    return;
  }

  if (action === 'delayImpact') {
    requireConcreteCenter('retard');
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour analyser le retard.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    const context = await buildContext({
      ...body,
      centerId: reservation.centerId || centerId,
      date: reservation.date,
    });
    const impact = computeDelayImpact({
      centerId: reservation.centerId || centerId,
      date: reservation.date,
      reservationId,
      reservation: context.reservations?.some((item) => Number(item.id) === reservationId) ? undefined : reservation,
      delayMinutes: body.delayMinutes,
      reasonId: body.reasonId || 'late_customer',
    }, context);
    sendJson(res, 200, {
      ok: true,
      contextWarning: context.warning || null,
      impact: {
        ...impact,
        notifications: {
          ...impact.notifications,
          channels: listDelayNotificationChannels(),
        },
      },
    });
    return;
  }

  if (action === 'delayApply') {
    requireConcreteCenter('retard');
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour appliquer le retard.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    const editSession = await requireStaffPermission(req, res, ['reservations.edit', 'planning.drag'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!editSession) return;

    // Serveur = source de vérité : l'impact est RECALCULÉ ici, jamais repris
    // du client. Le staff choisit seulement la stratégie parmi les faisables.
    const effectiveCenter = reservation.centerId || centerId || 'libramont';
    const context = await buildContext({ centerId: effectiveCenter, date: reservation.date });
    const impact = computeDelayImpact({
      centerId: effectiveCenter,
      date: reservation.date,
      reservationId,
      delayMinutes: body.delayMinutes,
      reasonId: body.reasonId || 'late_customer',
    }, context);
    const strategyId = body.strategyId || impact.recommendedStrategyId;
    const strategy = (impact.strategies || []).find((item) => item.id === strategyId && item.feasible);
    if (!strategy) {
      sendJson(res, 409, {
        ok: false,
        applied: false,
        impact,
        message: 'Ce plan de retard n\'est plus applicable : le planning a changé, relancez l\'analyse.',
      });
      return;
    }

    const staffMember = editSession.member?.name || editSession.member?.id || 'staff';
    const updates = strategy.changes.map((change) => ({
      id: change.reservationId,
      startTime: change.update.startTime,
      lanes: change.update.lanes,
      opsPlan: change.update.opsPlan,
      noteAppend: change.kind === 'delayed'
        ? `Retard +${impact.delayMinutes} min appliqué (${impact.reason}) — ${strategy.label} — par ${staffMember}.`
        : change.kind === 'relocate'
          ? `Changement de piste (${change.previousLanes.join(', ')} vers ${change.newLanes.join(', ')}) suite au retard de « ${impact.reservationName} » — par ${staffMember}.`
          : `Décalage de ${change.shiftMinutes} min suite au retard de « ${impact.reservationName} » — par ${staffMember}.`,
    }));

    const updatedReservations = await applyReservationScheduleUpdates({
      centerId: effectiveCenter,
      date: reservation.date,
      updates,
    });

    const publicChanges = strategy.changes.map(({ update, ...rest }) => rest);
    const incident = await createDelayIncident({
      centerId: effectiveCenter,
      reservationId,
      delayMinutes: impact.delayMinutes,
      reason: impact.reason,
      status: 'applied',
      previousStartTime: impact.previousStartTime,
      proposedStartTime: impact.proposedStartTime,
      impact: {
        strategyId: strategy.id,
        strategyLabel: strategy.label,
        warnings: strategy.warnings || [],
        changes: publicChanges,
        appliedBy: staffMember,
      },
      communications: { queued: [] },
      idempotencyKey: `delayplan:${reservationId}:${impact.delayMinutes}:${impact.proposedStartTime}:${strategy.id}`,
    }).catch(() => null);

    for (const change of strategy.changes) {
      const updated = updatedReservations.find((item) => Number(item.id) === change.reservationId);
      // Les communications déjà en file (rappels avec l'ancienne heure) sont
      // annulées ; l'automatisation interne est reprogrammée ; le rappel J-2
      // est régénéré avec la bonne heure. AUCUN email de retard n'est mis en
      // file ici : l'étape « Prévenir les clients ? » reste explicite.
      await Promise.all([
        cancelReservationCommunications({ reservationId: change.reservationId, centerId: effectiveCenter, reason: 'delay_plan_applied' }),
        cancelReservationOpsJobs({ reservationId: change.reservationId, centerId: effectiveCenter, reason: 'delay_plan_applied' }),
      ]).catch(() => null);
      if (updated) {
        await enqueueReservationAutomation(updated).catch(() => []);
        await enqueueReservationCommunications(updated, { templatesOnly: ['reminder_48h'] }).catch(() => []);
      }
      await createOpsEvent({
        centerId: effectiveCenter,
        reservationId: change.reservationId,
        eventType: change.kind === 'delayed' ? 'delay_applied' : 'delay_cascade_applied',
        severity: change.overClosingMinutes ? 'warning' : 'info',
        payload: {
          incidentId: incident?.id || null,
          strategyId: strategy.id,
          kind: change.kind,
          previousStartTime: change.previousStartTime,
          newStartTime: change.newStartTime,
          shiftMinutes: change.shiftMinutes,
          previousLanes: change.previousLanes,
          newLanes: change.newLanes,
          reason: impact.reason,
          appliedBy: staffMember,
        },
        runLearning: false,
      }).catch(() => null);
    }

    sendJson(res, 200, {
      ok: true,
      applied: true,
      incidentId: incident?.id || null,
      strategyId: strategy.id,
      strategyLabel: strategy.label,
      delayMinutes: impact.delayMinutes,
      reason: impact.reason,
      changes: publicChanges,
      warnings: strategy.warnings || [],
      reservations: updatedReservations,
      notifications: {
        automatic: false,
        requiresExplicitConfirmation: true,
        channels: listDelayNotificationChannels(),
        candidates: publicChanges
          .filter((change) => change.hasEmail)
          .map((change) => ({
            reservationId: change.reservationId,
            name: change.name,
            email: change.email,
            summary: change.summary,
            kind: change.kind,
          })),
      },
    });
    return;
  }

  if (action === 'delayNotify') {
    requireConcreteCenter('retard');
    const notifySession = await requireStaffPermission(req, res, ['emails.send', 'reservations.edit'], { centerId });
    if (!notifySession) return;
    const incidentId = Number(body.incidentId || 0);
    if (!incidentId) throw createHttpError('Incident retard manquant pour notifier les clients.', 400);
    const incident = await getDelayIncidentById(incidentId);
    if (!incident) throw createHttpError('Incident retard introuvable.', 404);
    const changes = Array.isArray(incident.impact?.changes) ? incident.impact.changes : [];
    const requestedIds = Array.isArray(body.reservationIds) ? body.reservationIds.map(Number) : [];
    if (!requestedIds.length) throw createHttpError('Aucun client sélectionné pour la notification.', 400);
    const channels = Array.isArray(body.channels) && body.channels.length ? body.channels : ['email'];

    const queued = [];
    const dispatched = [];
    for (const requestedId of requestedIds) {
      const change = changes.find((item) => Number(item.reservationId) === requestedId);
      if (!change) continue;
      const target = await getReservationById(requestedId);
      if (!target) continue;
      const created = await enqueueDelayChangeCommunications({
        reservation: target,
        change,
        incidentId,
        channels,
      });
      queued.push(...created.map((item) => ({ id: item.id, reservationId: requestedId, channel: item.channel, status: item.status })));
      if (created.length) {
        const dispatch = await dispatchDueCommunications({
          limit: 10,
          centerId: incident.centerId,
          reservationId: requestedId,
        }).catch(() => null);
        if (dispatch) dispatched.push({ reservationId: requestedId, ...dispatch });
      }
    }

    await createOpsEvent({
      centerId: incident.centerId,
      reservationId: incident.reservationId,
      eventType: 'delay_clients_notified',
      payload: {
        incidentId,
        reservationIds: requestedIds,
        channels,
        queued: queued.map((item) => item.id),
      },
      runLearning: false,
    }).catch(() => null);

    sendJson(res, 200, { ok: true, incidentId, queued, dispatched });
    return;
  }

  if (action === 'communicationDraft') {
    const result = communicationAgent(body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (action === 'enqueueReservation') {
    const concreteCenterId = requireConcreteCenter('file réservation');
    if (!body.reservation) throw new Error('Reservation manquante.');
    const reservation = { ...body.reservation, centerId: concreteCenterId || body.reservation.centerId || 'libramont' };
    const jobs = await enqueueReservationAutomation(reservation, body.options || {});
    const communications = await enqueueReservationCommunications(reservation, body.options || {});
    sendJson(res, 200, { ok: true, action, jobs, communications });
    return;
  }

  if (action === 'dispatchDue') {
    const result = await dispatchDueCommunications({ limit: body.limit || 25, centerId: scopedCenterId });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  if (action === 'processJobs') {
    const result = await processDueOpsJobs({ limit: body.limit || 25, centerId: scopedCenterId });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  if (action === 'enqueueJob') {
    const concreteCenterId = requireConcreteCenter('job');
    const jobPayload = body.job ? { ...body.job, centerId: concreteCenterId || body.job.centerId || 'libramont' } : withCenter(body, concreteCenterId);
    const job = await createOpsJob(jobPayload);
    sendJson(res, 201, { ok: true, action, job });
    return;
  }

  if (action === 'event') {
    const concreteCenterId = requireConcreteCenter('événement');
    const event = await createOpsEvent(withCenter(body, concreteCenterId));
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
        centerId: requireConcreteCenter('orchestration'),
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
  if (['plan', 'delay', 'delayImpact', 'delayApply', 'delayNotify'].includes(action)) return ['planning.view', 'ai.ops'];
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
      const requestedCenterId = normalizeCenterId(requestUrl.searchParams.get('centerId') || '');
      const session = await requireStaffPermission(req, res, getRequiredOpsPermission('GET', action), {
        centerId: requestedCenterId,
      });
      if (!session) return;
      await handleGet(req, res, { centerId: resolveEffectiveCenterId(session, requestedCenterId) });
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = getAction(req, body);
      const requestedCenterId = getBodyCenterId(body);
      const session = await requireStaffPermission(req, res, getRequiredOpsPermission('POST', action), {
        centerId: requestedCenterId,
      });
      if (!session) return;
      const effectiveCenterId = resolveEffectiveCenterId(session, requestedCenterId);
      await handlePost(req, res, withCenter(body, effectiveCenterId), { centerId: effectiveCenterId });
      return;
    }
    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    const status = error && error.expose === true ? (error.statusCode || 400) : (error && error.statusCode >= 500 ? error.statusCode : 503);
    sendError(res, status, safeUserMessage(error, 'Opération impossible pour le moment. Réessayez dans un instant.'));
  }
};
