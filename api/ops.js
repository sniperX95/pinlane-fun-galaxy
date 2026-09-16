// Marqueur des traces automatiques liees a un retard. Il permet de les RETIRER
// quand le retard est annule, au lieu d empiler une ligne de plus. Il est masque
// a l affichage par `getReservationNoteText`.
const DELAY_NOTE_TAG = '[ops:retard]';

const {
  applyReservationScheduleUpdates,
  cancelReservationCommunications,
  cancelReservationOpsJobs,
  createDelayIncident,
  createOpsJob,
  createOpsEvent,
  getDelayIncidentById,
  getReservationById,
  centerHasFabricatedReservations,
  getOpsHealth,
  getOpsJob,
  listCommunications,
  getOpsPulse,
  claimEmailThread,
  releaseEmailThread,
  listActiveEmailClaims,
  listAgentQuestions,
  marquerQuestionRepondue,
  getInboundCommunication,
  listAgentSuggestions,
  listOpsEvents,
  listDirectionReports,
  upsertDirectionReport,
  updateDirectionReportBody,
  listEmailTemplates,
  saveEmailTemplate,
  archiveEmailTemplate,
  listEmailIdentities,
  saveEmailIdentity,
  deleteEmailIdentity,
  getEmailInsightRows,
  createCampaignRow,
  listCampaigns,
  getCampaignRow,
  updateCampaignRow,
  markCampaignSending,
  findRecentDuplicateCampaign,
  cancelCampaignRow,
  readAdminRangeState,
  readStaffState,
  saveAgentSuggestions,
} = require('../lib/database');
const {
  writeAuditLog,
  writeAuditLogOrThrow,
  readAuditLog,
  actorFromSession,
  isBlockingAction,
  getAuditHealth,
  newRequestId,
  normalizeActivityEvents,
} = require('../lib/audit-log');
const { improveEmailDraft, buildEmailInsights } = require('../lib/email-studio');
const { adresseDePlateforme } = require('../lib/sender-domains');
const { llmProvider, callLlm } = require('../lib/llm-client');
const { listDailyMetrics, listMarketingInsights, setInsightStatus, buildMarketingWeek, redoInsight } = require('../lib/center-metrics');
const { CAMPAIGN_SEGMENTS, buildCampaignAudience, personalizeCampaignText, findUnknownCampaignTokens } = require('../lib/campaigns');
const { stampDelayFlag, clearDelayFlagOnPlan } = require('../lib/delay-flag');
const {
  buildDirectionAnalytics,
  buildDirectionReportMarkdown,
  polishReportWithAi,
  previousWindow,
  addDays,
  mondayOf,
  endOfMonth,
} = require('../lib/direction-analytics');
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
  buildClientMessage,
  buildDelayChangeMessage,
  buildEmailSamples,
  dispatchDueCommunications,
  enqueueDelayChangeCommunications,
  enqueueReservationCommunications,
  listClientMessageChannels,
  listClientMessageTemplates,
  listDelayNotificationChannels,
  sendClientMessage,
  sendDirectEmail,
  buildDirectEmailPreview,
  enqueueCampaign,
  getAutomationSettings,
  getAutomationDefaults,
  setAutomationSetting,
  buildAutomationPatch,
  buildAutomationPreview,
  sendAutomationTest,
  getAutomationStats,
  sendClientRelance,
  getRelanceStats,
  getClientNote,
  saveClientNote,
  buildBirthdayJ30Message,
  buildReactivationMessage,
  CUSTOM_SEQUENCE_LIMITS,
  listCustomSequences,
  saveCustomSequence,
  toggleCustomSequence,
  deleteCustomSequence,
} = require('../lib/ops-communications');
const { enqueueReservationAutomation, processDueOpsJobs, processOpsJobById } = require('../lib/ops-jobs');
const { listSuppressions, suppressEmail, removeSuppression } = require('../lib/marketing-suppression');
const { loadOpsKnowledge, refreshCenterOverrides, refreshCatalog } = require('../lib/ops-knowledge');
const {
  listCenterConfigs,
  saveCenterConfigOverride,
  upsertCenter,
  setCenterStatus,
} = require('../lib/center-config');
const { listCentersForSession } = require('../lib/center-scope');
const { sessionHasPermission } = require('../lib/staff-auth');
const { getPool, listCustomRequests, updateCustomRequestStatus, updateOpsJobStatus } = require('../lib/database');
const { readJson, sendError, sendJson, setCors } = require('../lib/http');
const { requireStaffPermission, isCenterForeignToSession } = require('../lib/staff-auth');
const { buildFounderCockpit, buildFounderAgents, buildFounderIncidents, buildFounderClients } = require('../lib/founder-cockpit');
const { buildFounderCenters, buildFounderTeam } = require('../lib/founder-admin');
const { buildFounderCatalog, buildClientCatalog, upsertFormuleOverride, resetFormuleOverride, upsertClientFormuleOverride, resetClientFormuleOverride, dismissClientErrorGroup } = require('../lib/catalog-overrides');
const catalogStore = require('../lib/catalog-store');
const { buildPlatformClients, provisionClient, updateClientStatus, addCenterToClient, setClientBilling, deleteCenter, deleteClient } = require('../lib/platform-clients');
const { upsertAvailabilityBlock, deleteAvailabilityBlock, listAvailabilityBlocks, refreshAvailabilityBlocks } = require('../lib/availability-blocks');
// refreshFormuleOverrides : la carte des overrides catalogue (prix / retrait)
// vit dans lib/booking-config ; action=plan doit la rafraichir comme le fait
// public-availability, sinon le board staff peut voir un catalogue perime.
const { refreshFormuleOverrides } = require('../lib/booking-config');

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

// Le flag d'affichage « retard » (opsPlan.delayFlag) : cumul des minutes,
// snapshot du créneau d'origine et retrait : vit dans les helpers PURS de
// lib/delay-flag.js (importés en tête, testés par scripts/delay-flag-check.js).

// Laisse un travail continuer APRÈS l'envoi de la réponse (progression live).
// Sur Vercel : waitUntil maintient la fonction en vie jusqu'à la fin de la
// promesse (dans la limite du maxDuration). Hors Vercel (tests, node local) :
// la promesse tourne détachée, avec un catch pour ne jamais produire de
// rejet non géré (le cycle de vie du job gère déjà ses propres erreurs).
function keepAlive(promise) {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error('[ops] travail détaché échoué', error && (error.message || error));
  });
  try {
    require('@vercel/functions').waitUntil(guarded);
  } catch (error) {
    // runtime sans waitUntil : la promesse détachée suffit.
  }
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

// LA PORTEE 'all' EST UN PRIVILEGE PLATEFORME, PAS UN MOT-CLE.
//
// centerScope('all') rend une chaine VIDE, et une chaine vide DESACTIVE le
// filtre de centre dans les requetes ecrites `($3 = '' or center_id = $3)`.
// La barriere inter-clients de requireStaffPermission exempte volontairement
// 'all' : ce n est le centre de personne, il n y a rien a comparer. Il ne
// restait donc que `centers.switch`, que TOUT role verrouille possede
// d office. Une direction de centre pouvait ainsi muter la demande d un
// prospect appartenant a un AUTRE client, et en recevoir le nom et le
// contact dans la reponse de la meme requete.
//
// Le refus est explicite plutot que silencieux : rabattre la demande sur le
// centre de la session rendrait une reponse partielle sans dire pourquoi, et
// on croirait le produit vide au lieu de se savoir refuse.
function refuserPorteePlateforme(res, session, requestedCenterId) {
  if (requestedCenterId !== 'all') return false;
  if (sessionHasPermission(session, 'platform.admin')) return false;
  sendError(res, 403, 'Acces centre insuffisant.');
  return true;
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
    // Isolation multi-tenant : la liste `centers` est SCOPEE a la session, jamais
    // la liste complete du fichier baseline. Sans ce scope, un client non-Fun
    // Galaxy recevrait dans la reponse brute les centres d'un autre tenant. Le
    // reste du bundle (activites/formules/regles) est agnostique au centre.
    let centers;
    try {
      centers = await listCentersForSession(getPool(), options.session);
    } catch (error) {
      // Fail-soft interne au helper deja ; ici on retombe sur le seul centre de
      // session par prudence, jamais sur la liste complete.
      centers = knowledge.centers.filter((c) => c && c.id === (options.session && options.session.centerId));
    }
    sendJson(res, 200, {
      ok: true,
      schemaVersion: knowledge.schemaVersion,
      centers,
      activities: knowledge.activities,
      formulas: knowledge.formulas,
      rules: knowledge.rules,
      competitivePlaybook: knowledge.competitivePlaybook,
    });
    return;
  }

  // Liste des centres SCOPEE au tenant, source dediee du SWITCHER de centre du
  // menu staff (assets/staff-menu.js). Action GET AUTHENTIFIEE (le dispatcher
  // exige une session pour toute action ops, voir getRequiredOpsPermission :
  // menuCenters requiert au moins une permission de lecture, donc tout role
  // reel). Un client ne recoit QUE ses centres ; le proprietaire (platform.admin)
  // recoit TOUS les centres avec clientId + clientName pour les grouper.
  if (action === 'menuCenters') {
    const centers = await listCentersForSession(getPool(), options.session);
    const owner = sessionHasPermission(options.session, 'platform.admin');
    sendJson(res, 200, { ok: true, centers, owner });
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

  // LE POULS : appele toutes les quelques secondes par chaque ecran ouvert, il
  // doit rester le plus petit appel de l API. Il ne renvoie AUCUNE donnee
  // metier, seulement une empreinte : savoir qu il faut recharger ne demande
  // pas de connaitre le contenu, et une empreinte ne fuit rien si elle passe
  // par un cache.
  if (action === 'pulse') {
    const pulse = await getOpsPulse({ centerId });
    sendJson(res, 200, { ok: true, centerId, ...pulse });
    return;
  }

  // CE QUE L AGENT NE SAIT PAS, ET CE QU ON LUI A DEJA APPRIS. Les deux dans la
  // meme lecture : la section d apprentissage montre les questions ouvertes ET
  // la memoire deja constituee, sinon on ne peut ni verifier ce qu il a retenu,
  // ni corriger un fait devenu faux.
  if (action === 'agentQuestions') {
    const { getFaitsAppris } = require('../lib/email-agent');
    const [questions, appris] = await Promise.all([
      listAgentQuestions({ centerId, limit: Number(url.searchParams.get('limit') || 50) }),
      getFaitsAppris(centerId),
    ]);
    sendJson(res, 200, { ok: true, centerId, questions, appris });
    return;
  }

  // Les prises en cours du centre : qui repond a quoi, en ce moment. Lecture
  // separee de `communications` pour qu elle reste utilisable seule et qu un
  // refus sur elle ne vide pas la boite.
  if (action === 'emailClaims') {
    const claims = await listActiveEmailClaims({ centerId });
    sendJson(res, 200, { ok: true, centerId, claims });
    return;
  }

  if (action === 'communications') {
    const communications = await listCommunications({
      centerId,
      status: url.searchParams.get('status') || '',
      limit: Number(url.searchParams.get('limit') || 100),
      // Fil d'UN contact quand l'appelant le demande (page Demandes sur
      // mesure). Sans ce filtre, l'ecran devrait telecharger 500 messages du
      // centre pour en montrer trois.
      recipient: url.searchParams.get('recipient') || '',
    });
    sendJson(res, 200, { ok: true, centerId, communications });
    return;
  }

  if (action === 'health') {
    const health = await getOpsHealth({
      centerId,
      limit: Number(url.searchParams.get('limit') || 20),
    });
    // T4 point (b) : le compteur d'ecritures d'audit perdues est expose ici,
    // donc lisible depuis les deux cockpits. Sans cette remontee, un echec de
    // journalisation ne vivrait que dans les logs Vercel et la phrase "tout est
    // tracable" deviendrait fausse sans que personne ne le voie.
    //
    // testData : ce flag allume le bandeau de l'ecran Direction. Il valait
    // `true` EN DUR, herite de la doctrine du cockpit fondateur
    // (lib/founder-cockpit.js) ecrite quand aucune donnee du produit n'etait
    // reelle. Deux consequences, toutes deux fausses aujourd'hui : le bandeau
    // s'affichait sur un centre dont chaque ligne est une vraie reservation, et
    // il parlait de l'etat COMMERCIAL de Pinlane sur un ecran de client.
    //
    // Il repond desormais a la seule question que le bandeau a le droit de
    // poser : les lignes de CE centre sont-elles fabriquees ? La reponse vient
    // de la base, par les marqueurs que le code pose lui-meme a la creation
    // (lib/simulation-filter.js). Donnees d'exploitation = pas de bandeau.
    // Le cockpit fondateur, lui, garde son propre flag : c'est l'ecran de
    // Movsar, et ses compteurs plateforme viennent bien des essais internes.
    sendJson(res, 200, {
      ok: true,
      health,
      audit: getAuditHealth(),
      testData: await centerHasFabricatedReservations({ centerId }),
    });
    return;
  }

  // Lecture du journal d'audit. Scopee au centre : `centerId` vaut ici la
  // valeur deja resolue par resolveEffectiveCenterId, donc la valeur de
  // SESSION, jamais celle demandee par le client. Une directrice qui reclame
  // un autre centre a ete arretee bien plus haut par requireStaffPermission
  // (403 'Acces centre insuffisant', lui-meme trace par PP2).
  if (action === 'auditLog') {
    const rows = await readAuditLog({
      centerId,
      limit: Number(url.searchParams.get('limit') || 100),
      offset: Number(url.searchParams.get('offset') || 0),
      actorMemberId: url.searchParams.get('actorMemberId') || '',
      action: url.searchParams.get('auditAction') || '',
      actorKind: url.searchParams.get('actorKind') || '',
      outcome: url.searchParams.get('outcome') || '',
      entityType: url.searchParams.get('entityType') || '',
      entityId: url.searchParams.get('entityId') || '',
      since: url.searchParams.get('since') || '',
    });
    sendJson(res, 200, { ok: true, centerId, entries: rows, audit: getAuditHealth() });
    return;
  }

  // ── COCKPIT FONDATEUR (platform.admin uniquement, voir
  //    getRequiredOpsPermission). Ces deux lectures sont les SEULES surfaces
  //    cross-centres du cockpit : tout le reste (renvoyer un mail, couper une
  //    sequence) passe par les actions existantes, deja tracees. ──────────────

  // Le bundle unique de la page cockpit : pannes, adoption par centre, agents,
  // couts, prospects, premiere page du journal global. Un fetch, zero N+1.
  if (action === 'founderCockpit') {
    const bundle = await buildFounderCockpit();
    sendJson(res, 200, bundle);
    return;
  }

  // Journal d'audit GLOBAL (tous centres) avec filtres et pagination. Meme
  // lecteur que l'action auditLog (lib/audit-log.readAuditLog) : on ne
  // reinvente pas la lecture, on ne change que le scope, et ce scope n'est
  // atteignable que derriere platform.admin. Le filtre centre voyage dans
  // `auditCenter` (jamais `centerId`, qui porte le scope de session).
  if (action === 'founderAuditLog') {
    const rawCenter = String(url.searchParams.get('auditCenter') || 'all').trim().toLowerCase();
    const auditCenter = /^[a-z0-9-]{1,40}$/.test(rawCenter) ? rawCenter : 'all';
    const rows = await readAuditLog({
      centerId: auditCenter,
      limit: Number(url.searchParams.get('limit') || 50),
      offset: Number(url.searchParams.get('offset') || 0),
      actorMemberId: url.searchParams.get('actorMemberId') || '',
      action: url.searchParams.get('auditAction') || '',
      actorKind: url.searchParams.get('actorKind') || '',
      outcome: url.searchParams.get('outcome') || '',
      since: url.searchParams.get('since') || '',
    });
    sendJson(res, 200, { ok: true, auditCenter, entries: rows, audit: getAuditHealth() });
    return;
  }

  // Les trois pages dediees de la categorie Plateforme (agents IA, incidents,
  // clients). Meme regle que le bundle cockpit : un fetch par page, agregats
  // en SQL, permission plateforme (refus trace outcome=denied par PP2).
  if (action === 'founderAgents') {
    sendJson(res, 200, await buildFounderAgents());
    return;
  }
  if (action === 'founderIncidents') {
    sendJson(res, 200, await buildFounderIncidents());
    return;
  }
  if (action === 'founderClients') {
    sendJson(res, 200, await buildFounderClients());
    return;
  }

  // Panneau de controle fondateur : lecteurs cross-centres de la gestion
  // (centres editables, equipe/roles/permissions). Les ECRITURES passent par
  // les actions existantes deja tracees (saveCenterConfig, setCenterStatus,
  // saveCenter cote ops ; createMember, updateMemberRole, updateRolePermissions
  // ... cote staff-auth), autorisees inter-centres par centers.switch du role
  // verrouille platform-owner.
  if (action === 'founderCenters') {
    sendJson(res, 200, await buildFounderCenters());
    return;
  }
  if (action === 'founderTeam') {
    sendJson(res, 200, await buildFounderTeam());
    return;
  }

  // Catalogue no-code : le socle (formulas.json / booking-config) reste la
  // verite ; buildFounderCatalog montre base + overrides pour l'editeur.
  if (action === 'founderCatalog') {
    // Catalogue unifie chaud a l'ouverture de l'editeur (fail-soft, TTL 30 s).
    try { await refreshCatalog(getPool()); } catch (error) { /* socle fichier */ }
    sendJson(res, 200, await buildFounderCatalog(getPool()));
    return;
  }

  // Editeur tarifaire CLIENT (cockpit centre, permission pricing.manage) : le
  // catalogue scope au centre de SESSION (base + override du centre), pour
  // prefiller l'editeur avec l'etat courant, formules retirees comprises. Le
  // centre vient de la session (centerId resolu par resolveEffectiveCenterId au
  // dispatcher), JAMAIS d'un parametre brut. 'all'/vide est refuse : le
  // proprietaire platform.admin utilise founderCatalog, pas cette vue.
  if (action === 'clientCatalog') {
    const scoped = centerScope(centerId);
    if (!scoped) {
      throw createHttpError('Choisissez un centre precis pour editer ses tarifs.', 400);
    }
    // Catalogue unifie chaud a l'ouverture de l'editeur (fail-soft, TTL 30 s).
    try { await refreshCatalog(getPool()); } catch (error) { /* socle fichier */ }
    // Overrides de CENTRE chauds aussi : un centre ne dans la console n'existe
    // QU'en base. Sans cette ligne, getCenter leve « Centre inconnu » sur une
    // instance fraiche, et les deux signaux que cet ecran sert (les activites
    // que le centre possede, ses jours d'ouverture) repartent vides. Les
    // alertes « il manque tel ingredient » et « jamais vendable » seraient
    // alors muettes PILE sur les centres nes dans la console, ceux qui en ont
    // le plus besoin.
    try { await refreshCenterOverrides(getPool()); } catch (error) { /* socle fichier */ }
    sendJson(res, 200, await buildClientCatalog(getPool(), scoped));
    return;
  }

  // Liste des blocages de disponibilite du centre (editeur de blocage, permission
  // settings.manage). Scope au centre de SESSION (jamais un parametre brut) ;
  // 'all'/vide refuse : un blocage appartient toujours a un centre precis.
  if (action === 'listAvailabilityBlocks') {
    const scoped = centerScope(centerId);
    if (!scoped) {
      throw createHttpError('Choisissez un centre precis pour lister ses blocages.', 400);
    }
    const blocks = await listAvailabilityBlocks(getPool(), scoped);
    sendJson(res, 200, { ok: true, centerId: scoped, blocks });
    return;
  }

  // Vue PROPRIETAIRE : les clients (entreprises) de Pinlane avec leurs centres.
  // C'est le niveau au-dessus des centres, propre au proprietaire (pas au client).
  if (action === 'platformClients') {
    sendJson(res, 200, await buildPlatformClients());
    return;
  }

  // Lecture d'UN job de la queue : la surface du poller de progression (0028).
  // Le job porte ses etapes reelles (steps), ecrites par son handler. Scope
  // centre : un job d'un autre centre rend 404, pas une fuite.
  if (action === 'job') {
    const jobId = Number(url.searchParams.get('id'));
    if (!Number.isInteger(jobId) || jobId <= 0) throw createHttpError('Identifiant de job invalide.', 400);
    const job = await getOpsJob(jobId, { centerId: centerScope(centerId) });
    if (!job) throw createHttpError('Job introuvable.', 404);
    sendJson(res, 200, { ok: true, job });
    return;
  }

  // Warehouse quotidien : lignes daily_center_metrics + agrégats de période.
  // La période est libre (jour/semaine/mois : le front choisit from/to).
  if (action === 'dailyMetrics') {
    const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().slice(0, 10);
    const to = DATE_RX.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : today;
    const from = DATE_RX.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : addDays(to, -29);
    if (from > to) throw createHttpError('Période invalide.', 400);
    const metrics = await listDailyMetrics(centerId, from, to);
    sendJson(res, 200, { ok: true, centerId, from, to, ...metrics });
    return;
  }

  // Idées/constats de l'agent marketing (cycle de vie proposed -> applied ->
  // validated/refuted). Grounding : data_basis contient les faits SQL sources.
  if (action === 'marketingInsights') {
    const insights = await listMarketingInsights(centerId, {
      status: url.searchParams.get('status') || '',
      limit: Number(url.searchParams.get('limit') || 100),
    });
    sendJson(res, 200, { ok: true, centerId, insights });
    return;
  }

  // Séquences automatiques : état + textes/timings personnalisés + défauts
  // (placeholders et « Réinitialiser » de l'éditeur) + stats 30 j.
  if (action === 'automationSettings') {
    const [settings, stats] = await Promise.all([
      getAutomationSettings(centerId),
      getAutomationStats(centerId),
    ]);
    sendJson(res, 200, { ok: true, centerId, settings, stats, defaults: getAutomationDefaults() });
    return;
  }

  // Séquences PERSONNALISÉES créées par le gérant : liste + limites (déclencheurs
  // disponibles, bornes, segments) pour construire l'éditeur.
  if (action === 'customSequences') {
    const sequences = await listCustomSequences(centerId);
    sendJson(res, 200, { ok: true, centerId, sequences, limits: CUSTOM_SEQUENCE_LIMITS });
    return;
  }

  // « Ce que l'agent sait » : textes du gérant (prioritaires) + défauts fichiers
  // (placeholders et Réinitialiser de l'éditeur).
  if (action === 'emailBrain') {
    const { getEmailBrainOverrides, getEmailBrainDefaults } = require('../lib/email-agent');
    const overrides = await getEmailBrainOverrides(centerId);
    sendJson(res, 200, { ok: true, centerId, overrides, defaults: getEmailBrainDefaults(centerId) });
    return;
  }

  // ROI des relances CRM : envoyées → venues → € (page Clients).
  if (action === 'relanceStats') {
    const stats = await getRelanceStats(centerId, { days: Number(url.searchParams.get('days') || 90) });
    sendJson(res, 200, { ok: true, centerId, ...stats });
    return;
  }

  // Liste de suppression marketing : qui ne veut plus de marketing pour CE
  // centre, depuis quand, pourquoi (console page Emails). Lecture scopée au
  // centre : jamais la liste d'un autre centre.
  if (action === 'suppressions') {
    const data = await listSuppressions(centerId, { limit: Number(url.searchParams.get('limit') || 200) });
    sendJson(res, 200, { ok: true, ...data });
    return;
  }

  // Note terrain d'un client (fiche CRM).
  if (action === 'clientNotes') {
    const clientKey = String(url.searchParams.get('clientKey') || '').trim();
    if (!clientKey) throw createHttpError('clientKey requis.', 400);
    const note = await getClientNote(centerId, clientKey);
    sendJson(res, 200, { ok: true, centerId, note });
    return;
  }

  // « Ta période » : plage LIBRE (from/to, défaut aujourd'hui → +6 j, cap 31 j)
  // : météo + calendrier + idées (page Marketing).
  if (action === 'marketingWeek') {
    const week = await buildMarketingWeek(centerId, {
      from: url.searchParams.get('from') || null,
      to: url.searchParams.get('to') || null,
    });
    sendJson(res, 200, { ok: true, centerId, ...week });
    return;
  }

  // Retour marketing en euros : attribution last-touch des réservations aux
  // messages marketing (relances, séquences, campagnes), la preuve du ROI.
  if (action === 'marketingRoi') {
    const { computeMarketingRoi } = require('../lib/marketing-roi');
    const roi = await computeMarketingRoi(centerId, { days: Number(url.searchParams.get('days') || 30) });
    sendJson(res, 200, { ok: true, centerId, ...roi });
    return;
  }

  // « Le Brief » : LE bundle unique de la page Marketing, paie, brief signé,
  // radar 14 j, propositions unifiées, reçus, veille. Un seul fetch.
  if (action === 'marketingBrief') {
    const { buildMarketingBriefBundle } = require('../lib/marketing-brief');
    const bundle = await buildMarketingBriefBundle(centerId, { days: Number(url.searchParams.get('days') || 30) });
    sendJson(res, 200, bundle);
    return;
  }

  // Ce que l'IA marketing a APPRIS : grille de jugement, auto-évaluation,
  // ADN d'écriture, apprentissage par les résultats. Outil PLATEFORME
  // (platform.admin) : c'est la mécanique interne de Pinlane, pas une donnée
  // d'exploitation du centre. Demande de Movsar du 2026-07-28.
  if (action === 'aiLearning') {
    const { buildMarketingLearning } = require('../lib/marketing-learning');
    const learning = await buildMarketingLearning(centerId, { days: Number(url.searchParams.get('days') || 90) });
    sendJson(res, 200, learning);
    return;
  }

  // Cerveau marketing : prévision de fréquentation 14 j (baseline apprise ×
  // météo démontrée), explication des jours anormaux, plan d'actions daté,
  // post Instagram du jour. Tout dérivé des données réelles du centre.
  if (action === 'marketingBrain') {
    const { buildMarketingBrain } = require('../lib/marketing-brain');
    const brain = await buildMarketingBrain(centerId);
    sendJson(res, 200, brain);
    return;
  }

  // Studio de contenu : derniers packs du jour par réseau (lecture seule 
  // la génération est un POST explicite, jamais déclenchée par l'ouverture).
  if (action === 'studioPacks') {
    const { listTodayPacks } = require('../lib/content-studio');
    const packs = await listTodayPacks(centerId);
    sendJson(res, 200, { ok: true, centerId, packs });
    return;
  }

  // Veille concurrence : liste + dernier changement détecté par concurrent.
  if (action === 'competitors') {
    const { listCompetitors } = require('../lib/competitor-watch');
    const competitors = await listCompetitors(centerId);
    sendJson(res, 200, { ok: true, centerId, competitors });
    return;
  }

  // Hub « Données » : agrégats calculés côté serveur (source de vérité unique,
  // le front ne recalcule rien). L'historique complet sert à qualifier
  // nouveau/récurrent au-delà de la fenêtre demandée.
  if (action === 'directionAnalytics' || action === 'dashboardAnalytics') {
    const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().slice(0, 10);
    const endDate = DATE_RX.test(url.searchParams.get('endDate') || '') ? url.searchParams.get('endDate') : today;
    const startDate = DATE_RX.test(url.searchParams.get('startDate') || '') ? url.searchParams.get('startDate') : addDays(endDate, -29);
    if (startDate > endDate) throw createHttpError('Période invalide.', 400);
    const { getCenter } = require('../lib/ops-knowledge');
    const center = getCenter(centerId);
    const history = (await readAdminRangeState('2023-01-01', endDate, centerId)).reservations;
    let analytics = buildDirectionAnalytics({ history, startDate, endDate, center });
    const prevWin = previousWindow(startDate, endDate);
    const previous = buildDirectionAnalytics({ history, startDate: prevWin.startDate, endDate: prevWin.endDate, center });
    // dashboardAnalytics est accessible avec dashboard.view seul : on ne sert
    // que ce que les widgets consomment : jamais le PII direction (top clients).
    // byFormule / byOccasion / heatmap sont des agrégats anonymes (comptes et
    // CA par formule / occasion / créneau), sans aucune identité client.
    if (action === 'dashboardAnalytics') {
      analytics = {
        startDate: analytics.startDate,
        endDate: analytics.endDate,
        totals: analytics.totals,
        daily: analytics.daily,
        weekly: analytics.weekly,
        monthly: analytics.monthly,
        byType: analytics.byType,
        byChannel: analytics.byChannel,
        byFormule: analytics.byFormule,
        byOccasion: analytics.byOccasion,
        heatmap: analytics.heatmap,
        occupancy: analytics.occupancy,
      };
    }
    sendJson(res, 200, {
      ok: true,
      centerId,
      analytics,
      previous: {
        startDate: previous.startDate,
        endDate: previous.endDate,
        totals: previous.totals,
        clients: { unique: previous.clients.unique, returning: previous.clients.returning },
      },
    });
    return;
  }

  if (action === 'directionReports') {
    const reports = await listDirectionReports({
      centerId,
      limit: Number(url.searchParams.get('limit') || 24),
    });
    sendJson(res, 200, { ok: true, centerId, reports });
    return;
  }

  // Capacites de DECISION de la page Direction (distinctes de la config
  // Etablissement) : comparer les centres DU CLIENT (isolation par client_id)
  // et la retention / clients dormants du centre courant.
  if (action === 'directionComparison' || action === 'directionRetention' || action === 'directionAudience') {
    const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().slice(0, 10);
    const endDate = DATE_RX.test(url.searchParams.get('endDate') || '') ? url.searchParams.get('endDate') : today;
    const startDate = DATE_RX.test(url.searchParams.get('startDate') || '') ? url.searchParams.get('startDate') : addDays(endDate, -29);
    if (startDate > endDate) throw createHttpError('Période invalide.', 400);
    const { buildDirectionComparison, buildDirectionRetention, buildDirectionAudience } = require('../lib/direction-insights');
    if (action === 'directionComparison') {
      sendJson(res, 200, await buildDirectionComparison(getPool(), centerId, startDate, endDate));
    } else if (action === 'directionRetention') {
      sendJson(res, 200, await buildDirectionRetention(centerId, startDate, endDate));
    } else {
      sendJson(res, 200, await buildDirectionAudience(centerId, startDate, endDate));
    }
    return;
  }

  // Studio mails : modèles personnalisés + identités d'expéditeur + état canal.
  if (action === 'emailStudio') {
    const [templates, identities] = await Promise.all([
      listEmailTemplates({ centerId }),
      listEmailIdentities({ centerId }),
    ]);
    sendJson(res, 200, {
      ok: true,
      centerId,
      templates,
      identities,
      channel: {
        resendConfigured: Boolean(process.env.RESEND_API_KEY),
        aiConfigured: Boolean(llmProvider()),
        // L adresse plateforme SEULE : une variable posee sur l adresse d un
        // client (ou avec son nom) s afficherait dans le studio de tous les
        // autres (lib/sender-domains.js).
        defaultFrom: adresseDePlateforme(process.env.RESEND_FROM) || 'onboarding@resend.dev',
      },
    });
    return;
  }

  if (action === 'emailInsights') {
    const rows = await getEmailInsightRows({ centerId });
    const insights = buildEmailInsights({ ...rows, resendConfigured: Boolean(process.env.RESEND_API_KEY) });
    sendJson(res, 200, { ok: true, centerId, insights });
    return;
  }

  // Campagnes : audience d'un segment (comptage réel ; full=1 pour l'export).
  if (action === 'campaignAudience') {
    const segment = url.searchParams.get('segment') || 'all';
    // Fail-closed : un segment inconnu renverrait toute la base sous un faux label.
    if (!CAMPAIGN_SEGMENTS.some((s) => s.id === segment)) throw createHttpError('Segment inconnu.', 400);
    const today = new Date().toISOString().slice(0, 10);
    const history = (await readAdminRangeState('2023-01-01', today, centerId)).reservations;
    const recipients = buildCampaignAudience({ history, segment, today });
    const full = url.searchParams.get('full') === '1';
    sendJson(res, 200, {
      ok: true,
      centerId,
      segment,
      count: recipients.length,
      sample: recipients.slice(0, 5).map((r) => r.name),
      recipients: full ? recipients : undefined,
    });
    return;
  }

  if (action === 'listCampaigns') {
    const campaigns = await listCampaigns({ centerId });
    sendJson(res, 200, {
      ok: true,
      centerId,
      campaigns,
      segments: CAMPAIGN_SEGMENTS,
      channel: { resendConfigured: Boolean(process.env.RESEND_API_KEY) },
    });
    return;
  }

  // File staff des demandes SUR MESURE (leads hors planning). PII client :
  // l'auth est déjà appliquée en amont (getRequiredOpsPermission GET).
  if (action === 'customRequests') {
    const requests = await listCustomRequests({
      centerId,
      status: url.searchParams.get('status') || '',
      limit: Number(url.searchParams.get('limit') || 100),
    });
    sendJson(res, 200, { ok: true, centerId, customRequests: requests });
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
    // Isolation multi-tenant : la page Etablissement ne recoit QUE les centres
    // du client de la session (ou tous, avec clientId/clientName, pour le
    // proprietaire platform.admin). Remplace listCenterConfigs (qui rendait TOUS
    // les centres, dont ceux d'autres clients) par la liste scopee serveur.
    const centers = await listCentersForSession(pool, session);
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

  // L'ENTREPRISE qui ecrit (migration 0042). Le catalogue n'est plus partage :
  // toute ecriture est estampillee du client du centre EFFECTIF (celui de la
  // requete quand la barriere inter-clients l'autorise, sinon celui de la
  // session) ; jamais d'une AUTRE entreprise que celle du staff connecte.
  // FAIL-CLOSED : un centre sans entreprise ne peut pas editer, sinon son
  // ecriture atterrirait dans le catalogue plateforme, donc chez tout le monde.
  // C'est exactement la fuite que 0042 ferme.
  const requireOwnerClientId = async (label = action) => {
    const centerId = requireConcreteCenter(label);
    const result = await getPool().query(
      `select nullif(client_id, '') as client_id from centers where id = $1 limit 1;`,
      [centerId],
    );
    const clientId = result.rows && result.rows[0] ? result.rows[0].client_id : null;
    if (!clientId) {
      throw createHttpError(
        `Action ${label} refusée: ce centre n'est rattaché à aucune entreprise.`,
        409,
        true,
      );
    }
    return String(clientId).trim().toLowerCase();
  };

  if (action === 'plan') {
    requireConcreteCenter('planification');
    // Sur Vercel, api/ops est une fonction serverless SEPAREE de
    // public-availability : sans ce rafraichissement, le board de planning staff
    // pouvait servir une capacite centre / un catalogue / des blocs de dispo
    // perimes. On applique EXACTEMENT le meme reflexe fail-soft que
    // public-availability, AVANT le calcul du plan : un incident base ne doit
    // jamais empecher la reponse, on retombe alors sur le socle fichier / le
    // dernier etat connu.
    const planPool = getPool();
    try { await refreshCenterOverrides(planPool); } catch (error) { /* socle fichier */ }
    try { await refreshFormuleOverrides(planPool); } catch (error) { /* dernier etat connu */ }
    try { await refreshCatalog(planPool); } catch (error) { /* socle fichier */ }
    try { await refreshAvailabilityBlocks(planPool); } catch (error) { /* socle fichier */ }
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
    // La CIBLE de cette action ne voyage pas dans body.centerId mais dans
    // body.center.id, et l'appel se fait en portee 'all' : la garde
    // inter-clients de requireStaffPermission ne peut donc pas la voir. Sans ce
    // controle, une direction pouvait RENOMMER et FERMER (status closed) le
    // centre d'un AUTRE client, ce qui coupe son tunnel de reservation. Prouve
    // par la section [G] de scripts/cross-client-center-scope-check.js.
    // Un id inconnu reste permis : c'est la creation d'un centre
    // (submitNewCenter), pas une prise de controle.
    if (await isCenterForeignToSession(session, body.center && body.center.id)) {
      throw createHttpError('Acces centre insuffisant.', 403, true);
    }
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
    // Isolation par centre : getReservationById ne filtre pas le centre, donc on
    // revérifie la permission sur le VRAI centre de la réservation (sinon un staff
    // pourrait analyser une réservation d'un autre centre via un id deviné).
    const scopedSession = await requireStaffPermission(req, res, ['planning.view', 'ai.ops'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!scopedSession) return;
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
    const updates = strategy.changes.map((change) => {
      // La réservation retardée ET toute réservation réellement décalée dans le
      // temps reçoivent un flag d'affichage « retard » (from → to). Les simples
      // relocalisations de piste sans décalage n'affichent pas de badge minutes.
      const timeShifted = change.kind === 'delayed'
        || (change.previousStartTime && change.newStartTime && change.previousStartTime !== change.newStartTime);
      const flagMinutes = change.kind === 'delayed' ? impact.delayMinutes : change.shiftMinutes;
      // Pour la résa CIBLE, on connaît son état PRÉ-décalage (`reservation`,
      // chargé avant l'application) : on CUMULE au flag existant (badge +5 puis
      // +10 => +15) et on snapshotte l'origine (heure + plan + pistes) pour un
      // revert fidèle. Les résas cascadées n'exposent pas leur plan d'origine →
      // pas de snapshot (leur revert se limite au masquage de l'indicateur).
      const isTargetReservation = Number(change.reservationId) === reservationId;
      const existingDelayFlag = isTargetReservation && reservation.opsPlan && typeof reservation.opsPlan === 'object'
        ? reservation.opsPlan.delayFlag
        : null;
      const delayOrigin = isTargetReservation
        ? {
          startTime: reservation.startTime,
          opsPlan: reservation.opsPlan || null,
          lanes: Array.isArray(reservation.lanes) ? reservation.lanes : [],
        }
        : null;
      return {
        id: change.reservationId,
        startTime: change.update.startTime,
        lanes: change.update.lanes,
        opsPlan: timeShifted
          ? stampDelayFlag(change.update.opsPlan, {
            minutes: flagMinutes,
            from: change.previousStartTime,
            to: change.newStartTime,
            existingFlag: existingDelayFlag,
            origin: delayOrigin,
          })
          : change.update.opsPlan,
        // UNE NOTE DIT CE QU IL FAUT FAIRE, PAS QUI A CLIQUE.
        // Movsar, 2026-08-14 : « ca met deja "il y a trop d info", faut citer
        // administrateur ou quoi, c est pas pro ». La ligne posait le retard, sa
        // raison, la strategie choisie ET le nom de l operateur, soit quatre
        // faits pour une consigne de comptoir qui en contient un. Qui a fait
        // quoi vit dans le journal d audit, c est sa raison d etre ; la note du
        // dossier sert la personne qui accueille le client.
        noteAppend: change.kind === 'delayed'
        ? `${DELAY_NOTE_TAG} Retard +${impact.delayMinutes} min.`
        : change.kind === 'relocate'
          ? `${DELAY_NOTE_TAG} Pistes ${change.previousLanes.join(', ')} vers ${change.newLanes.join(', ')}.`
          : `${DELAY_NOTE_TAG} Décalée de ${change.shiftMinutes} min.`,
      };
    });

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
          .map((change) => {
            // Message pré-rédigé, personnalisé et éditable par le staff avant
            // envoi (nom, ancienne → nouvelle heure, activité, ton Fun Galaxy).
            const target = updatedReservations.find((item) => Number(item.id) === Number(change.reservationId));
            const message = target ? buildDelayChangeMessage({ reservation: target, change, channel: 'email' }) : null;
            return {
              reservationId: change.reservationId,
              name: change.name,
              email: change.email,
              summary: change.summary,
              kind: change.kind,
              message: message ? { subject: message.subject, body: message.body } : null,
            };
          }),
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
    // Isolation par centre : l'incident (et les réservations liées) sont chargés
    // sans filtre centre ; on revérifie la permission sur le vrai centre de
    // l'incident avant tout envoi (sinon notification cross-centre via un id deviné).
    const scopedSession = await requireStaffPermission(req, res, ['emails.send', 'reservations.edit'], {
      centerId: incident.centerId || 'libramont',
    });
    if (!scopedSession) return;
    const changes = Array.isArray(incident.impact?.changes) ? incident.impact.changes : [];
    const requestedIds = Array.isArray(body.reservationIds) ? body.reservationIds.map(Number) : [];
    if (!requestedIds.length) throw createHttpError('Aucun client sélectionné pour la notification.', 400);
    const channels = Array.isArray(body.channels) && body.channels.length ? body.channels : ['email'];
    // Textes relus/modifiés par le staff, indexés par réservation. Le serveur
    // fait autorité sur l'envoi et la trace ; ces overrides ne changent que le
    // CORPS du message (le staff a validé ce texte à l'étape notification).
    const overridesById = new Map();
    if (Array.isArray(body.messages)) {
      body.messages.forEach((item) => {
        const id = Number(item && item.reservationId);
        if (Number.isInteger(id) && id > 0) {
          overridesById.set(id, {
            subject: typeof item.subject === 'string' ? item.subject : '',
            body: typeof item.body === 'string' ? item.body : '',
          });
        }
      });
    }

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
        override: overridesById.get(requestedId) || null,
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

  if (action === 'delayClear') {
    // Retire l'indicateur de retard d'une carte planning (flag d'affichage
    // « retard traité/résorbé »). NE modifie PAS l'horaire déjà appliqué : seul
    // le flag visuel opsPlan.delayFlag passe à cleared. Persistance atomique.
    requireConcreteCenter('retard');
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour retirer l\'indicateur de retard.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    const clearSession = await requireStaffPermission(req, res, ['reservations.edit', 'planning.drag'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!clearSession) return;

    const { plan, changed } = clearDelayFlagOnPlan(reservation.opsPlan);
    if (!changed) {
      sendJson(res, 200, { ok: true, cleared: false, reservation });
      return;
    }
    const staffMember = clearSession.member?.name || clearSession.member?.id || 'staff';
    const [updated] = await applyReservationScheduleUpdates({
      centerId: reservation.centerId || 'libramont',
      date: reservation.date,
      updates: [{
        id: reservationId,
        startTime: reservation.startTime,
        lanes: reservation.lanes,
        opsPlan: plan,
      }],
    });
    await createOpsEvent({
      centerId: reservation.centerId || 'libramont',
      reservationId,
      eventType: 'delay_indicator_cleared',
      payload: { clearedBy: staffMember },
      runLearning: false,
    }).catch(() => null);
    sendJson(res, 200, { ok: true, cleared: true, reservation: updated || reservation });
    return;
  }

  if (action === 'delayRevert') {
    // Retire le retard d'une réservation ET restaure son créneau d'origine
    // (heure + plan + pistes) depuis le snapshot posé au premier retard. On
    // restaure start_time ET opsPlan de façon COHÉRENTE : le contrôle de conflit
    // de applyReservationScheduleUpdates valide alors le VRAI créneau et lève une
    // erreur claire si l'origine a été reprise entre-temps. Ne recale QUE la résa
    // cible (les résas cascadées gardent leur décalage).
    requireConcreteCenter('retard');
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour retirer le retard.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    const revertSession = await requireStaffPermission(req, res, ['reservations.edit', 'planning.drag'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!revertSession) return;

    const flag = reservation.opsPlan && typeof reservation.opsPlan === 'object' ? reservation.opsPlan.delayFlag : null;
    if (!flag || flag.cleared) {
      sendJson(res, 200, { ok: true, reverted: false, reservation });
      return;
    }
    const staffMember = revertSession.member?.name || revertSession.member?.id || 'staff';
    const origin = flag.origin && typeof flag.origin === 'object' ? flag.origin : null;

    // Sans snapshot d'origine (retard legacy antérieur à cette version, ou résa
    // cascadée) : restaurer start_time seul désynchroniserait la donnée
    // (start_time vs resourceBlocks). On se limite alors au masquage.
    if (!origin || !origin.startTime || !origin.opsPlan || typeof origin.opsPlan !== 'object') {
      const { plan, changed } = clearDelayFlagOnPlan(reservation.opsPlan);
      if (!changed) {
        sendJson(res, 200, { ok: true, reverted: false, reservation });
        return;
      }
      const [cleared] = await applyReservationScheduleUpdates({
        centerId: reservation.centerId || 'libramont',
        date: reservation.date,
        updates: [{ id: reservationId, startTime: reservation.startTime, lanes: reservation.lanes, opsPlan: plan }],
      });
      await createOpsEvent({
        centerId: reservation.centerId || 'libramont',
        reservationId,
        eventType: 'delay_indicator_cleared',
        payload: { clearedBy: staffMember, reason: 'no_origin_snapshot' },
        runLearning: false,
      }).catch(() => null);
      sendJson(res, 200, {
        ok: true,
        reverted: false,
        cleared: true,
        reservation: cleared || reservation,
        message: 'Indicateur retiré. L\'horaire d\'origine n\'a pas pu être restauré automatiquement (retard posé avant cette mise à jour), ajustez à la main si besoin.',
      });
      return;
    }

    // Restauration cohérente : heure + plan d'origine (delayFlag retiré du plan).
    const restoredPlan = { ...origin.opsPlan };
    delete restoredPlan.delayFlag;
    const restoredLanes = Array.isArray(origin.lanes) && origin.lanes.length ? origin.lanes : reservation.lanes;
    const [updated] = await applyReservationScheduleUpdates({
      centerId: reservation.centerId || 'libramont',
      date: reservation.date,
      updates: [{
        id: reservationId,
        startTime: origin.startTime,
        lanes: restoredLanes,
        opsPlan: restoredPlan,
        // RETIRER UN RETARD RETIRE SA TRACE, il n'en ajoute pas une deuxieme.
        // La note empilait « Retard +10 min applique… » puis « Retard retire,
        // creneau d origine restaure… » : deux lignes contradictoires que
        // personne n efface, et une note qui grossit a chaque aller-retour.
        noteDropTag: 'retard',
      }],
    });
    await createOpsEvent({
      centerId: reservation.centerId || 'libramont',
      reservationId,
      eventType: 'delay_reverted',
      payload: { revertedBy: staffMember, restoredStartTime: origin.startTime },
      runLearning: false,
    }).catch(() => null);
    sendJson(res, 200, { ok: true, reverted: true, reservation: updated || reservation });
    return;
  }

  if (action === 'clientMessageComposer') {
    // Ouverture du centre de communication pour UNE réservation : modèles
    // pré-remplis (email + SMS courts), état des canaux, et historique des
    // messages déjà envoyés à ce client (anti-spam / traçabilité).
    requireConcreteCenter('communication client');
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour composer un message.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    // Isolation par centre : la réservation est chargée sans filtre centre, on
    // revérifie la permission sur son vrai centre avant d'exposer nom/email/phone
    // et l'historique de communications (sinon fuite PII cross-centre).
    const scopedSession = await requireStaffPermission(req, res, ['emails.view'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!scopedSession) return;
    const templates = listClientMessageTemplates().map((template) => ({
      ...template,
      email: buildClientMessage({ reservation, templateId: template.id, channel: 'email' }),
      sms: template.channels.includes('sms')
        ? buildClientMessage({ reservation, templateId: template.id, channel: 'sms' }).body
        : '',
    }));
    const history = await listCommunications({
      centerId: reservation.centerId || centerId,
      reservationId,
      limit: 25,
    }).catch(() => []);
    sendJson(res, 200, {
      ok: true,
      reservation: {
        id: reservation.id,
        name: reservation.name,
        email: reservation.email || '',
        phone: reservation.phone || '',
        date: reservation.date,
        startTime: reservation.startTime,
      },
      channels: listClientMessageChannels(reservation),
      templates,
      history: history.map((item) => ({
        id: item.id,
        channel: item.channel,
        templateId: item.templateId,
        subject: item.subject,
        status: item.status,
        recipient: item.recipient,
        createdAt: item.createdAt,
      })),
    });
    return;
  }

  if (action === 'clientMessageSend') {
    requireConcreteCenter('communication client');
    const sendSession = await requireStaffPermission(req, res, ['emails.send'], { centerId });
    if (!sendSession) return;
    const reservationId = Number(body.reservationId || body.reservation?.id || body.id || 0);
    if (!reservationId) throw createHttpError('Réservation manquante pour envoyer le message.', 400);
    const reservation = await getReservationById(reservationId);
    if (!reservation) throw createHttpError('Réservation introuvable.', 404);
    // Isolation par centre : sans ce second contrôle sur le vrai centre de la
    // réservation, un staff pourrait déclencher l'envoi d'un message arbitraire
    // à un client d'un AUTRE centre via un id deviné (écriture cross-centre).
    const scopedSession = await requireStaffPermission(req, res, ['emails.send'], {
      centerId: reservation.centerId || 'libramont',
    });
    if (!scopedSession) return;
    const channel = body.channel === 'sms' ? 'sms' : 'email';
    const staffMember = sendSession.member?.name || sendSession.member?.id || 'staff';
    let result;
    try {
      result = await sendClientMessage({
        centerId: reservation.centerId || centerId,
        reservation,
        templateId: body.templateId || 'custom',
        channel,
        subject: body.subject || '',
        body: body.body || '',
        staffMember,
      });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Envoi du message impossible pour le moment. Réessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await createOpsEvent({
      centerId: reservation.centerId || centerId,
      reservationId,
      eventType: 'client_message_sent',
      payload: {
        channel,
        templateId: body.templateId || 'custom',
        communicationId: result.communication?.id || null,
        sentBy: staffMember,
      },
      runLearning: false,
    }).catch(() => null);
    const dispatchResult = Array.isArray(result.dispatched?.results)
      ? result.dispatched.results.find((item) => Number(item.id) === Number(result.communication?.id))
      : null;
    sendJson(res, 200, {
      ok: true,
      channel,
      communication: result.communication
        ? { id: result.communication.id, status: dispatchResult?.status || result.communication.status, channel: result.communication.channel }
        : null,
      dispatched: result.dispatched || null,
    });
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

  // ── COCKPIT FONDATEUR : relancer un job RATE (platform.admin). ────────────
  // Un job 'failed' a epuise ses tentatives : ni listDueOpsJobs ni claimOpsJob
  // ne le reprennent jamais. Ce chemin le remet en file par les fonctions
  // EXISTANTES (updateOpsJobStatus remet queued + attempts a zero,
  // processOpsJobById le traite immediatement, le worker Railway sert de
  // filet). Trace par PP1 comme tout POST : action requeueOpsJob, entite
  // ops_job. Portee plateforme assumee : la ligne est relue par id AVANT la
  // mutation et seul un statut 'failed' passe (pas de rejeu d'un job vivant).
  // Telemetrie d'erreurs des consoles staff : le fondateur voit un bug AVANT
  // qu'on le lui signale. Caps de taille et rate-limit (20/membre/heure) dans
  // lib/client-errors. Le rapporteur ne remonte JAMAIS d'echec au navigateur :
  // un systeme de rapport d'erreurs qui produit des erreurs s'auto-alimente.
  if (action === 'logClientError') {
    let dropped = true;
    try {
      const { recordClientError } = require('../lib/client-errors');
      const out = await recordClientError({
        centerId: scopedCenterId || 'libramont',
        memberId: (options.session && options.session.member && options.session.member.id) || '',
        page: body.page,
        message: body.message,
        source: body.source,
        lineno: body.lineno,
        colno: body.colno,
        stack: body.stack,
        userAgent: req.headers['user-agent'] || '',
      });
      dropped = Boolean(out && out.dropped);
    } catch (error) {
      console.error('[client-errors] enregistrement impossible :', error.message);
    }
    sendJson(res, 200, { ok: true, dropped });
    return;
  }

  // Proprietaire Pinlane : provisionner un client CLE EN MAIN (client + centre
  // + roles + codes uniques), ajouter un centre a un client, changer le statut.
  // Les codes d'acces retournes ne sont montres qu'UNE fois (a remettre au
  // client). Gate platform.admin, trace au journal.
  // `body.center` porte aussi la MARQUE (`branding`) et l'IDENTITE D'EXPEDITEUR
  // (`sender`) saisies dans le formulaire : le provisionnement les ecrit dans la
  // foulee, il n'y a plus rien a poser a la main apres. Le cache centres est
  // rafraichi comme apres saveCenter : sinon le tunnel du nouveau centre servirait
  // encore la fusion d'avant, sans ses couleurs.
  if (action === 'createClient') {
    const pool = getPool();
    const out = await provisionClient(pool, {
      id: body.id,
      name: body.name,
      status: body.status,
      plan: body.plan,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      center: body.center || null,
    });
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'addClientCenter') {
    const pool = getPool();
    const out = await addCenterToClient(pool, { clientId: body.clientId, center: body.center || {} });
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'updateClientStatus') {
    const out = await updateClientStatus(getPool(), { id: body.id, status: body.status });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  // Prix mensuel que le client paie a Pinlane (le socle du MRR proprietaire).
  // monthlyPrice null / vide efface le prix ; sinon borne 0..100000 EUR cote
  // lib. Gate platform.admin, trace au journal comme updateClientStatus.
  if (action === 'setClientBilling') {
    const out = await setClientBilling(getPool(), { clientId: body.clientId, monthlyPrice: body.monthlyPrice });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  // Suppression PROPRIETAIRE (nettoyage des donnees de test avant lancement).
  // Gate platform.admin (getRequiredOpsPermission), trace au journal par PP1.
  // La politique d'integrite vit dans lib/platform-clients : centre baseline
  // (fichier) refuse, centre avec reservations refuse, client avec centres
  // refuse (bloque, jamais de cascade silencieuse). L'id cible voyage dans
  // body.id (comme updateClientStatus), JAMAIS dans body.centerId : withCenter
  // ecrase ce champ avec le centre de session.
  if (action === 'deleteClient') {
    const out = await deleteClient(getPool(), { id: body.id });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'deleteCenter') {
    const pool = getPool();
    const out = await deleteCenter(pool, { id: body.id });
    // Le cache centres (fusion baseline + overrides DB) doit oublier le centre
    // supprime, meme reflexe que saveCenter / setCenterStatus.
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }

  // Catalogue no-code : editer/retirer une formule (override par-dessus le
  // socle), remettre a zero, ou ecarter un incident console resolu. Tout est
  // gate platform.admin et trace au journal d'audit (dispatcher POST).
  if (action === 'saveFormuleOverride') {
    const out = await upsertFormuleOverride(getPool(), {
      formuleId: body.formuleId,
      centerId: body.centerId || 'all',
      patch: body.patch || {},
    });
    sendJson(res, 200, { ok: true, action, override: out });
    return;
  }
  if (action === 'resetFormuleOverride') {
    const out = await resetFormuleOverride(getPool(), { formuleId: body.formuleId, centerId: body.centerId || 'all' });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }

  // ── CRUD CATALOGUE DB (permission settings.manage) ──────────────────────────
  // Ces actions editent le catalogue DE L ENTREPRISE du centre de session
  // (migration 0042, owner_client_id). Elles n'ont plus aucun effet chez un
  // autre client : creer, editer ou retirer une formule ou une activite ecrit
  // une ligne scopee, et une formule du SOCLE editee par un client est copiee a
  // la volee dans sa portee (le socle et les autres clients ne bougent pas).
  // requireOwnerClientId resout cette portee depuis centers.client_id et REFUSE
  // (409) un centre orphelin : ecrire alors dans le catalogue plateforme
  // toucherait tout le monde.
  // catalog-store rafraichit le cache (refreshCatalog force) apres chaque
  // ecriture ; l audit est automatique (PP1, action mutante non exclue). Les
  // bornes (name<=120, prix 0..1000, minPax>=1, steps non vide, priceType
  // per_pax|per_lane) vivent dans lib/catalog-store (erreurs exposees).
  if (action === 'createFormula') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.createFormula(getPool(), { ...(body.formula || {}), ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Creation de la formule impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'updateFormula') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.updateFormula(getPool(), { id: body.id, ...(body.patch || {}), ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Mise a jour de la formule impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'setFormulaSteps') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.setFormulaSteps(getPool(), { id: body.id, steps: body.steps, ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Mise a jour des etapes impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'deleteFormula') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.deleteFormula(getPool(), { id: body.id, ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Retrait de la formule impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'createActivity') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      // centerId FORCE a 'all' : la maille d'isolation est l'ENTREPRISE, donc
      // une activite vaut pour tous les centres de CE client. Aucun ecran
      // n'envoie ce champ ; le laisser passer permettrait a un appelant de
      // viser le centre d'un autre client. La portee proprietaire le rendrait
      // de toute facon invisible, mais une ligne qui vise le centre d'autrui
      // n'a aucune raison d'exister.
      out = await catalogStore.createActivity(getPool(), { ...(body.activity || {}), centerId: 'all', ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Creation de l activite impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'updateActivity') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.updateActivity(getPool(), { id: body.id, ...(body.patch || {}), centerId: 'all', ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Mise a jour de l activite impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'deleteActivity') {
    const ownerClientId = await requireOwnerClientId('catalogue');
    let out;
    try {
      out = await catalogStore.deleteActivity(getPool(), { id: body.id, centerId: 'all', ownerClientId });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Retrait de l activite impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }

  // Edition tarifaire CLIENT (cockpit centre, permission pricing.manage) : le
  // centre AFFICHE fait foi (resolveEffectiveCenterId PREFERE le centerId de la
  // requete, valide par la barriere inter-clients ; la session n'est qu'un
  // repli), et
  // l'override global 'all' est refuse : un tenant n'edite QUE son propre tarif,
  // jamais le tarif partage (meme classe de faille que l'escalade de role
  // updateMemberRole). requireConcreteCenter rejette 'all'/vide (400 sans
  // ecriture) ; upsertClientFormuleOverride le rejette une seconde fois cote lib
  // avant toute mutation. Trace au journal par PP1 comme les autres POST.
  if (action === 'saveClientFormuleOverride') {
    const targetCenter = requireConcreteCenter('tarif');
    const out = await upsertClientFormuleOverride(getPool(), {
      formuleId: body.formuleId,
      centerId: targetCenter,
      patch: body.patch || {},
    });
    sendJson(res, 200, { ok: true, action, override: out });
    return;
  }
  if (action === 'resetClientFormuleOverride') {
    const targetCenter = requireConcreteCenter('tarif');
    const out = await resetClientFormuleOverride(getPool(), { formuleId: body.formuleId, centerId: targetCenter });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }
  if (action === 'dismissIncident') {
    const actor = actorFromSession(options.session || {});
    const out = await dismissClientErrorGroup(getPool(), { stackHash: body.stackHash, resolvedBy: actor.actorLabel || actor.actorMemberId || 'fondateur' });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }

  // Blocage granulaire de la disponibilite (permission settings.manage). Le
  // centre est FORCE a celui de la session (withCenter a deja ecrase body.centerId,
  // requireConcreteCenter rejette 'all'/vide) : un centre ne bloque que chez lui,
  // meme classe de garde que la config centre. upsertAvailabilityBlock refuse 'all'
  // une seconde fois cote lib. Apres ecriture, on rechauffe le cache (force) comme
  // saveCenterConfig force refreshCenterOverrides. Trace au journal par PP1.
  if (action === 'saveAvailabilityBlock') {
    const targetCenter = requireConcreteCenter('blocage de disponibilite');
    const pool = getPool();
    const actor = actorFromSession(options.session || {});
    let block;
    try {
      block = await upsertAvailabilityBlock(pool, {
        id: body.id,
        centerId: targetCenter,
        scopeType: body.scopeType,
        scopeRef: body.scopeRef,
        recurrence: body.recurrence,
        date: body.date,
        dayOfWeek: body.dayOfWeek,
        dateFrom: body.dateFrom,
        dateUntil: body.dateUntil,
        startTime: body.startTime,
        endTime: body.endTime,
        reason: body.reason,
        createdBy: actor.actorLabel || actor.actorMemberId || '',
      });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Enregistrement du blocage impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await refreshAvailabilityBlocks(pool, { centerId: targetCenter, force: true });
    sendJson(res, 200, { ok: true, action, block });
    return;
  }

  if (action === 'deleteAvailabilityBlock') {
    const targetCenter = requireConcreteCenter('blocage de disponibilite');
    const pool = getPool();
    let out;
    try {
      out = await deleteAvailabilityBlock(pool, { centerId: targetCenter, id: body.id });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Suppression du blocage impossible pour le moment. Reessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    await refreshAvailabilityBlocks(pool, { centerId: targetCenter, force: true });
    sendJson(res, 200, { ok: true, action, ...out });
    return;
  }

  if (action === 'requeueOpsJob') {
    const jobId = Number(body.id);
    if (!Number.isInteger(jobId) || jobId <= 0) throw createHttpError('Identifiant de job invalide.', 400);
    const job = await getOpsJob(jobId, { centerId: '' });
    if (!job) throw createHttpError('Job introuvable.', 404);
    if (job.status !== 'failed') {
      throw createHttpError(`Seul un job en échec se relance d'ici (celui-ci est « ${job.status} »).`, 409);
    }
    const requeued = await updateOpsJobStatus(jobId, {
      status: 'queued',
      incrementAttempts: -Number(job.attempts || 0),
      runAt: new Date().toISOString(),
      lastError: null,
    });
    keepAlive(processOpsJobById(jobId));
    sendJson(res, 202, {
      ok: true,
      action,
      job: { id: requeued.id, centerId: requeued.centerId, status: requeued.status, attempts: requeued.attempts },
    });
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
    // LE CENTRE D UNE SUGGESTION VIENT DU SERVEUR, PAS DES EVENEMENTS RECUS.
    // `withCenter` reecrit body.centerId, body.reservation, body.job et
    // body.event, mais JAMAIS body.events[] : le centre de chaque suggestion
    // etait donc celui que l appelant avait ecrit dans ses evenements. Une
    // session portant `ai.ops` ecrivait ainsi des lignes de suggestion, au
    // texte qu elle choisissait, dans le centre d un AUTRE client, sans
    // jamais declencher la barriere inter-clients. Son action voisine
    // `event` force le centre depuis toujours ; celle-ci ne le faisait pas.
    const concreteCenterId = requireConcreteCenter('apprentissage');
    const result = learningAgent(body);
    let savedSuggestions = [];
    if (body.persist !== false && result.suggestions.length) {
      savedSuggestions = await saveAgentSuggestions(
        result.suggestions.map((suggestion) => ({
          ...suggestion,
          centerId: concreteCenterId,
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

  // Mise à jour du statut d'une demande sur mesure (nouvelle → traitée…).
  if (action === 'customRequestStatus') {
    // Scope centre : un staff ne mute (ni ne relit) que les demandes de SON centre.
    // 'all' (accès plateforme) garde le prédicat neutre, cohérent avec listCustomRequests.
    const request = await updateCustomRequestStatus(body.id, body.status, { centerId: scopedCenterId });
    sendJson(res, 200, { ok: true, action, customRequest: request });
    return;
  }

  // Console liste de suppression (M5). Ecriture SCOPÉE au centre résolu serveur
  // (requireConcreteCenter), jamais body.centerId : un IDOR inter-centres a déjà
  // été corrigé ici, le même verrou s'applique. La directrice ajoute une adresse
  // à la main (demande orale, réclamation) ou en retire une qui redemande à
  // recevoir.
  if (action === 'suppressionAdd') {
    const concreteCenterId = requireConcreteCenter('liste de suppression');
    const result = await suppressEmail({
      centerId: concreteCenterId,
      email: body.email,
      source: 'staff',
      reason: String(body.reason || '').slice(0, 500),
    });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  if (action === 'suppressionRemove') {
    const concreteCenterId = requireConcreteCenter('liste de suppression');
    const result = await removeSuppression({ centerId: concreteCenterId, email: body.email });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  // Cycle de vie d'une idée de l'agent : le gérant l'applique ou l'ignore.
  // `applied` pose applied_at → la mesure avant/après tourne à J+14 (cron).
  if (action === 'insightStatus') {
    const insight = await setInsightStatus(body.id, body.status, { centerId: centerScope(scopedCenterId || centerId) });
    sendJson(res, 200, { ok: true, action, insight });
    return;
  }

  // « Refaire » une idée mesurée « ça a marché » : clone en nouvelle proposition.
  if (action === 'insightRedo') {
    const insight = await redoInsight(body.id, { centerId: centerScope(scopedCenterId || centerId) });
    sendJson(res, 200, { ok: true, action, insight });
    return;
  }

  // « C'est fait » sur une action du plan marketing : insertion en applied →
  // la mesure avant/après existante tourne à J+14.
  if (action === 'planActionDone') {
    const { markPlanActionDone } = require('../lib/marketing-brain');
    const concreteCenterId = requireConcreteCenter('plan marketing');
    const result = await markPlanActionDone(concreteCenterId, body.planAction || {});
    sendJson(res, 200, { ok: true, action, result });
    return;
  }

  // Action sur une proposition : publiée (SEULE porte vers la mesure J+14),
  // refusée, variante réseau, autre angle.
  if (action === 'propositionAction') {
    const { propositionAction } = require('../lib/marketing-brief');
    const concreteCenterId = requireConcreteCenter('propositions');
    const result = await propositionAction(concreteCenterId, {
      action: String(body.propAction || ''),
      id: body.id || null,
      proposition: body.proposition || null,
      network: String(body.network || ''),
      angle: String(body.angle || ''),
    });
    sendJson(res, 200, { ok: true, action, result });
    return;
  }

  // Création à la demande (barre « Demander », chips, radar jour creux).
  if (action === 'propositionCreate') {
    const { createProposition } = require('../lib/marketing-brief');
    const concreteCenterId = requireConcreteCenter('propositions');
    const result = await createProposition(concreteCenterId, {
      brief: String(body.brief || ''),
      targetDate: body.targetDate || null,
      trigger: String(body.trigger || 'demande'),
    });
    sendJson(res, 200, { ok: true, action, result });
    return;
  }

  // « Demander » : une question LIBRE du gérant, à laquelle le modèle répond
  // depuis le dossier de faits réels du centre (lib/marketing-ask.js). POST et
  // non GET : la question est du texte libre, elle n'a rien à faire dans une
  // URL (journaux, historique, référents). Quand le modèle manque, échoue ou
  // invente, la réponse porte `grounded: false` et le navigateur reprend son
  // chemin déterministe : jamais d'erreur, jamais d'invention affichée.
  if (action === 'marketingAsk') {
    const { answerMarketingQuestion } = require('../lib/marketing-ask');
    const concreteCenterId = requireConcreteCenter('agent marketing');
    const result = await answerMarketingQuestion(concreteCenterId, { question: String(body.question || '') });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  // Génération d'un pack de contenu (boucle de raffinement côté serveur).
  if (action === 'studioGenerate') {
    const { generateContentPack } = require('../lib/content-studio');
    const concreteCenterId = requireConcreteCenter('studio de contenu');
    const pack = await generateContentPack(concreteCenterId, {
      platform: String(body.platform || 'facebook'),
      brief: String(body.brief || ''),
    });
    sendJson(res, 200, { ok: true, action, pack });
    return;
  }

  // CRUD veille concurrence + vérification manuelle immédiate.
  if (action === 'competitorSave') {
    const { saveCompetitor } = require('../lib/competitor-watch');
    const concreteCenterId = requireConcreteCenter('veille concurrence');
    const result = await saveCompetitor(concreteCenterId, body.competitor || {});
    sendJson(res, 200, { ok: true, action, result });
    return;
  }
  if (action === 'competitorDelete') {
    const { deleteCompetitor } = require('../lib/competitor-watch');
    const concreteCenterId = requireConcreteCenter('veille concurrence');
    const result = await deleteCompetitor(concreteCenterId, body.id);
    sendJson(res, 200, { ok: true, action, result });
    return;
  }
  if (action === 'competitorSweep') {
    const { runCompetitorSweep } = require('../lib/competitor-watch');
    const concreteCenterId = requireConcreteCenter('veille concurrence');
    const result = await runCompetitorSweep(concreteCenterId);
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }
  // LE PLAN (Phase 4). Lecture : on rend le dernier plan vivant. S'il n'y en a
  // pas encore (nouveau centre, premier lundi pas passe), on en construit un a
  // la volee : une page vide n'apprend rien au gerant.
  if (action === 'marketingPlanGet') {
    const { listMarketingPlans, generateMarketingPlan } = require('../lib/marketing-strategist');
    requireConcreteCenter('plan marketing');
    const [existing] = await listMarketingPlans(centerId, { limit: 1 });
    if (existing) {
      sendJson(res, 200, { ok: true, action, plan: existing.payload, planId: existing.id, status: existing.status });
      return;
    }
    const { plan, saved } = await generateMarketingPlan(centerId, {});
    sendJson(res, 200, { ok: true, action, plan, planId: saved ? saved.id : null, status: 'proposed' });
    return;
  }

  // Reconstruction a la demande. Idempotent cote SQL (index unique center_id +
  // from_date) : rejouer remplace le plan de la semaine, ne le duplique pas.
  //
  // REGLE DE DECISION synchrone contre queue (RUN B, ne pas laisser a
  // l'intuition) : un travail qui tient dans les 30 s de Vercel RESTE
  // synchrone. La queue ne sert que quand on veut une PROGRESSION REELLE
  // observable (body.live) : le job est cree PUIS traite immediatement dans
  // cette meme invocation (waitUntil), la reponse part tout de suite avec
  // l'id, et le client suit les etapes via l'action `job`. C'est le reveil de
  // la queue a l'enfilement exige par la regle : premiere etape visible en
  // quelques secondes, jamais 10 minutes d'attente du worker. Si l'invocation
  // meurt, le verrou du job devient obsolete et le worker Railway le reprend.
  if (action === 'marketingPlanBuild') {
    const { generateMarketingPlan } = require('../lib/marketing-strategist');
    const concretePlanCenterId = requireConcreteCenter('plan marketing');
    if (body.live === true) {
      const job = await createOpsJob({
        centerId: concretePlanCenterId,
        jobType: 'marketing_plan',
        priority: 80,
        maxAttempts: 2,
        payload: { centerId: concretePlanCenterId, weeks: 8, trigger: 'manual' },
      });
      keepAlive(processOpsJobById(job.id));
      sendJson(res, 202, { ok: true, action, live: true, jobId: job.id });
      return;
    }
    const { plan, saved } = await generateMarketingPlan(centerId, {});
    sendJson(res, 200, { ok: true, action, plan, planId: saved ? saved.id : null, status: 'proposed' });
    return;
  }

  if (action === 'competitorAnalyzePost') {
    const { analyzeCompetitorPost } = require('../lib/competitor-watch');
    requireConcreteCenter('veille concurrence');
    const result = await analyzeCompetitorPost(body.text || '', { centerId });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  // Toggle ON/OFF + texte + timing d'une séquence automatique (persisté par
  // centre). Le patch est construit par `buildAutomationPatch` (lib) et non à
  // la main : c'est une fonction pure, testée sans réseau, ce qui évite qu'un
  // champ de l'éditeur soit jeté en silence comme l'a été `reviewUrl`.
  if (action === 'automationSettings') {
    const concreteCenterId = requireConcreteCenter('séquences automatiques');
    const settings = await setAutomationSetting(concreteCenterId, body.key, buildAutomationPatch(body));
    sendJson(res, 200, { ok: true, action, settings, defaults: getAutomationDefaults() });
    return;
  }

  // Aperçu du mail d'une séquence AVANT enregistrement : même builders, même
  // gabarit que la prod, donc aperçu == test == mail réellement reçu.
  if (action === 'automationPreview') {
    const concreteCenterId = requireConcreteCenter('aperçu des séquences');
    const preview = await buildAutomationPreview(concreteCenterId, body.key, buildAutomationPatch(body));
    sendJson(res, 200, { ok: true, action, ...preview });
    return;
  }

  // « M'envoyer un test ». Le destinataire vient de la SESSION serveur et
  // jamais du corps de la requête : sans cette contrainte, l'action serait un
  // relais d'envoi vers n'importe quelle adresse, signé du domaine du centre.
  if (action === 'sendAutomationTest') {
    const concreteCenterId = requireConcreteCenter('envoi de test');
    const result = await sendAutomationTest({
      centerId: concreteCenterId,
      key: body.key,
      patch: buildAutomationPatch(body),
      member: options.session?.member || null,
    });
    sendJson(res, 200, { ok: true, action, ...result });
    return;
  }

  // Remettre en file un mail qui a échoué. Écriture PAR ID : la portée centre
  // est re-vérifiée sur la ligne réelle en base (un id d'un autre centre rend
  // 404), jamais sur le centre demandé par le client.
  if (action === 'retryCommunication') {
    const concreteCenterId = requireConcreteCenter('renvoi d’un mail');
    const { requeueCommunication } = require('../lib/database');
    const communication = await requeueCommunication(Number(body.id), concreteCenterId);
    const dispatch = await dispatchDueCommunications({ limit: 1, centerId: concreteCenterId });
    const line = (dispatch?.results || []).find((row) => row.id === communication.id) || {};
    sendJson(res, 200, {
      ok: true,
      action,
      id: communication.id,
      status: line.status || communication.status,
      error: line.error || '',
    });
    return;
  }

  // Séquences personnalisées : créer/modifier (op absent), activer/couper
  // (op:'toggle') ou supprimer (op:'delete'). Validation FR côté lib.
  if (action === 'customSequences') {
    const concreteCenterId = requireConcreteCenter('séquences personnalisées');
    let sequences;
    try {
      if (body.op === 'delete') sequences = await deleteCustomSequence(concreteCenterId, String(body.id || ''));
      else if (body.op === 'toggle') sequences = await toggleCustomSequence(concreteCenterId, String(body.id || ''), body.enabled === true);
      else sequences = await saveCustomSequence(concreteCenterId, body.sequence || {});
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Enregistrement de la séquence impossible.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, sequences, limits: CUSTOM_SEQUENCE_LIMITS });
    return;
  }

  // « Ce que l'agent sait » : le gérant édite la FAQ de l'agent email, sa
  // signature et ses consignes libres.
  if (action === 'emailBrain') {
    const concreteCenterId = requireConcreteCenter('cerveau agent email');
    const { saveEmailBrainOverrides, getEmailBrainDefaults } = require('../lib/email-agent');
    let overrides;
    try {
      overrides = await saveEmailBrainOverrides(concreteCenterId, {
        faq: body.faq,
        signature: body.signature,
        extra: body.extra,
      });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Enregistrement impossible.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, { ok: true, action, overrides, defaults: getEmailBrainDefaults(concreteCenterId) });
    return;
  }

  // Parcours d'equipe (2026-08-25, Movsar : « je dois voir exactement ce que
  // font les autres : ou ils vont, sur quoi ils appuient »). Chaque lot de la
  // console devient UNE ligne action='parcours' (evenements bornes dans le
  // contexte). Le proprietaire plateforme n'est JAMAIS trace : c'est lui qui
  // lit ce journal, pas un sujet du journal.
  if (action === 'activityLog') {
    const concreteCenterId = requireConcreteCenter('parcours équipe');
    const activitySession = await requireStaffPermission(req, res, ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view'], { centerId: concreteCenterId });
    if (!activitySession) return;
    const activityMemberId = String(activitySession.member?.id || '');
    if (activityMemberId.endsWith(':platform-owner')) { sendJson(res, 200, { ok: true, saved: 0, skipped: true }); return; }
    const activityEvents = normalizeActivityEvents(body.events);
    if (activityEvents.length) {
      await writeAuditLog({
        centerId: concreteCenterId,
        ...actorFromSession(activitySession),
        surface: 'console',
        action: 'parcours',
        method: 'POST',
        entityType: 'parcours',
        entityId: activityMemberId,
        outcome: 'success',
        context: { events: activityEvents },
      });
    }
    sendJson(res, 200, { ok: true, saved: activityEvents.length });
    return;
  }

  // Relance client 1-clic (CRM) : envoi réel via la queue, tracé payload.relance
  // → alimente relanceStats (ROI). Pas besoin de réservation existante.
  if (action === 'sendClientRelance') {
    const concreteCenterId = requireConcreteCenter('relance client');
    const relanceSession = await requireStaffPermission(req, res, ['emails.send'], { centerId: concreteCenterId });
    if (!relanceSession) return;
    let result;
    try {
      result = await sendClientRelance({
        centerId: concreteCenterId,
        email: body.email,
        name: body.name || '',
        phone: body.phone || '',
        reason: body.reason || 'custom',
        subject: body.subject || '',
        body: body.body || '',
        staffMember: relanceSession.member?.name || relanceSession.member?.id || 'staff',
      });
    } catch (error) {
      throw createHttpError(safeUserMessage(error, 'Relance impossible pour le moment. Réessayez.'), error.expose ? 400 : 503, error.expose === true);
    }
    sendJson(res, 200, {
      ok: true,
      action,
      communication: result.communication
        ? { id: result.communication.id, status: result.communication.status }
        : null,
    });
    return;
  }

  // Note terrain d'un client (upsert).
  if (action === 'clientNotes') {
    const concreteCenterId = requireConcreteCenter('note client');
    const clientKey = String(body.clientKey || '').trim();
    if (!clientKey) throw createHttpError('clientKey requis.', 400);
    await saveClientNote(concreteCenterId, clientKey, body.body || '');
    sendJson(res, 200, { ok: true, action });
    return;
  }

  // Génère (ou régénère) le bilan de la dernière semaine/mois complet : ou de
  // la période explicitement demandée. Déterministe d'abord, IA si clé dispo.
  if (action === 'generateDirectionReport') {
    const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
    const periodType = body.periodType === 'month' ? 'month' : 'week';
    const today = new Date().toISOString().slice(0, 10);
    let periodStart;
    let periodEnd;
    if (DATE_RX.test(body.periodStart || '')) {
      periodStart = periodType === 'week' ? mondayOf(body.periodStart) : `${body.periodStart.slice(0, 7)}-01`;
      periodEnd = periodType === 'week' ? addDays(periodStart, 6) : endOfMonth(periodStart);
    } else if (periodType === 'week') {
      periodStart = addDays(mondayOf(today), -7);
      periodEnd = addDays(periodStart, 6);
    } else {
      periodEnd = addDays(`${today.slice(0, 7)}-01`, -1);
      periodStart = `${periodEnd.slice(0, 7)}-01`;
    }
    const { getCenter } = require('../lib/ops-knowledge');
    const reportCenterId = requireConcreteCenter('generateDirectionReport');
    const center = getCenter(reportCenterId);
    const history = (await readAdminRangeState('2023-01-01', periodEnd, reportCenterId)).reservations;
    const current = buildDirectionAnalytics({ history, startDate: periodStart, endDate: periodEnd, center });
    const prevWin = previousWindow(periodStart, periodEnd);
    const previous = buildDirectionAnalytics({ history, startDate: prevWin.startDate, endDate: prevWin.endDate, center });
    const periodLabel = periodType === 'week'
      ? `de la semaine du ${periodStart}`
      : `du mois ${periodStart.slice(0, 7)}`;
    const centerName = center?.name || reportCenterId;
    const deterministicMd = buildDirectionReportMarkdown({ current, previous, periodLabel, centerName });
    const aiMd = await polishReportWithAi(deterministicMd, { periodLabel, centerName });
    const report = await upsertDirectionReport({
      centerId: reportCenterId,
      periodType,
      periodStart,
      periodEnd,
      title: `Bilan ${periodLabel}, ${centerName}`,
      bodyMd: aiMd || deterministicMd,
      generatedBy: aiMd ? 'ia' : 'deterministic',
    });
    sendJson(res, 200, { ok: true, report });
    return;
  }

  if (action === 'saveDirectionReport') {
    if (!body.id || typeof body.bodyMd !== 'string' || !body.bodyMd.trim()) {
      throw createHttpError('Bilan invalide : contenu requis.', 400);
    }
    // Écrire un bilan de direction en scope 'all' n'a aucun sens métier : on exige
    // un centre précis (400 explicite) plutôt qu'un prédicat neutre qui laisserait
    // passer l'édition du bilan d'un autre centre.
    const report = await updateDirectionReportBody({
      id: body.id,
      bodyMd: body.bodyMd,
      title: body.title,
      editedBy: options.session?.member?.name || options.session?.member?.id || 'direction',
      centerId: requireConcreteCenter('saveDirectionReport'),
    });
    sendJson(res, 200, { ok: true, report });
    return;
  }

  // Envoi libre (studio mails + composer page Emails) : même pipeline que les
  // messages client. `replyToCommunicationId` = réponse à un email reçu
  // (marque l'inbound répondu + apprentissage de l'agent si texte modifié).
  // AMELIORER UN BROUILLON (2026-08-19, demande de Movsar : « un bouton ia
  // plug avec notre kimi qui ameliore le contenu de ce quon a ecrit pour un
  // truc vrm plus pro et carre »).
  //
  // Ce que cette action fait, et surtout ce qu'elle NE fait PAS : elle
  // reecrit la FORME du message que le staff a deja ecrit. Elle n'invente
  // aucun fait, aucun prix, aucune disponibilite, aucune date : le moteur
  // deterministe reste la seule source de verite du produit (DESIGN.md 9), et
  // un mail commercial qui promet un creneau que le planning n'a pas est
  // exactement l'ecart paye le 2026-08-08 sur la vitrine.
  // Si le modele ne repond pas (cle absente, quota, panne), on rend le texte
  // d'origine avec `improved: false` : jamais un message tronque, jamais un
  // silence qui ferait croire a une amelioration.
  if (action === 'improveEmailDraft') {
    const draftSubject = String(body.subject || '').slice(0, 200);
    const draftBody = String(body.body || '').slice(0, 4000);
    if (!draftBody.trim()) {
      sendJson(res, 200, { ok: true, improved: false, reason: 'empty', subject: draftSubject, body: draftBody });
      return;
    }
    const centreName = String(body.centerName || '').slice(0, 120);
    const contactName = String(body.contactName || '').slice(0, 120);
    const context = String(body.context || '').slice(0, 600);
    const result = await callLlm({
      stableSystem: [
        'Tu es le responsable clientele d un centre de loisirs belge (bowling, laser game, anniversaires).',
        'Tu reecris un email que le staff vient d ecrire, pour le rendre plus professionnel, clair et chaleureux.',
        'REGLES ABSOLUES :',
        '- N INVENTE JAMAIS un fait : ni prix, ni horaire, ni disponibilite, ni promesse de reservation.',
        '- Ne garde que les informations presentes dans le brouillon.',
        '- Si le brouillon laisse un blanc a completer, laisse ce blanc.',
        '- Francais de Belgique, vouvoiement, ton direct et cordial, phrases courtes.',
        '- Aucun tiret cadratin, aucun emoji.',
        '- Reponds UNIQUEMENT avec un objet JSON : {"subject": "...", "body": "..."}',
      ].join(String.fromCharCode(10)),
      system: `Centre : ${centreName || 'le centre'}. Contact : ${contactName || 'le client'}.${context ? ' Demande initiale : ' + context : ''}`,
      user: `Objet actuel : ${draftSubject || '(vide)'}

Message actuel :
${draftBody}`,
      maxTokens: 900,
      timeoutMs: 20000,
    });
    if (!result || !result.text) {
      sendJson(res, 200, { ok: true, improved: false, reason: 'unavailable', subject: draftSubject, body: draftBody });
      return;
    }
    let parsed = null;
    try {
      const raw = result.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
    const improvedBody = parsed && typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (!improvedBody) {
      sendJson(res, 200, { ok: true, improved: false, reason: 'unparsable', subject: draftSubject, body: draftBody });
      return;
    }
    // Derniere garde, cote serveur : la regle maison du tiret cadratin ne
    // depend pas de la bonne volonte du modele.
    const clean = (text) => String(text || '').replace(/[\u2014\u2013]/g, '-');
    sendJson(res, 200, {
      ok: true,
      improved: true,
      provider: result.provider,
      model: result.model,
      subject: clean(parsed.subject || draftSubject).slice(0, 200),
      body: clean(improvedBody).slice(0, 4000),
    });
    return;
  }

  if (action === 'sendDirectEmail') {
    const studioCenterId = requireConcreteCenter('sendDirectEmail');
    if (!body.attemptId && !body.idempotencyKey) {
      throw createHttpError('Identifiant de tentative requis pour envoyer le message.', 400);
    }
    let identity = null;
    if (body.identityId) {
      const identities = await listEmailIdentities({ centerId: studioCenterId });
      identity = identities.find((item) => item.id === Number(body.identityId)) || null;
    }
    const result = await sendDirectEmail({
      centerId: studioCenterId,
      to: body.to,
      name: body.name || '',
      subject: body.subject,
      body: body.body,
      fromEmail: identity?.email || '',
      fromLabel: identity?.label || '',
      category: body.category || 'direct',
      templateRef: body.templateRef || '',
      staffMember: options.session?.member?.name || options.session?.member?.id || 'direction',
      identityId: body.identityId || null,
      replyToCommunicationId: body.replyToCommunicationId ?? null,
      scheduledAt: body.scheduledAt || null,
      attemptId: body.attemptId || '',
      idempotencyKey: body.idempotencyKey || '',
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  // APPRENDRE UN FAIT. Le staff repond a la question que l agent a posee : le
  // fait entre dans sa memoire, la question quitte la liste, et le mail est
  // RE-ANALYSE dans la foulee. Sans cette re-analyse, la reponse proposee a
  // l ecran resterait la pirouette d avant l apprentissage, et on croirait que
  // rien n a change.
  if (action === 'answerAgentQuestion') {
    const centreApprentissage = requireConcreteCenter('apprentissage de l agent');
    const mail = await getInboundCommunication(body.communicationId);
    if (!mail) throw createHttpError('Ce message est introuvable.', 404);
    if (mail.centerId !== centreApprentissage) throw createHttpError('Ce message appartient à un autre centre.', 403);
    const question = String((mail.payload && mail.payload.analysis && mail.payload.analysis.question) || '').trim();
    if (!question) throw createHttpError('Ce message ne porte aucune question ouverte.', 400);
    const membre = (options.session && options.session.member) || {};
    const { apprendreUnFait, analyzeEmail } = require('../lib/email-agent');
    const appris = await apprendreUnFait(centreApprentissage, {
      question,
      reponse: body.reponse,
      par: String(membre.name || membre.id || ''),
    });
    // La re-analyse est FAIL-SOFT : si elle echoue, le fait est quand meme
    // appris. Perdre l apprentissage parce que le modele est indisponible
    // serait le pire des deux mondes.
    let analyse = null;
    try {
      analyse = await analyzeEmail({
        from: String((mail.payload && mail.payload.from) || mail.recipient || ''),
        subject: mail.subject,
        body: String((mail.payload && mail.payload.textBody) || mail.body || ''),
        centerId: centreApprentissage,
      });
    } catch (error) {
      analyse = null;
    }
    const communication = await marquerQuestionRepondue({
      communicationId: mail.id,
      analyse,
      par: String(membre.name || membre.id || ''),
    });
    sendJson(res, 200, { ok: true, action, appris, communication, reanalyse: Boolean(analyse) });
    return;
  }

  // OUBLIER UN FAIT. Un fait faux appris une fois empoisonnerait toutes les
  // reponses suivantes, sans que rien ne le signale : il faut pouvoir le
  // retirer, sinon l apprentissage devient un risque au lieu d un progres.
  if (action === 'forgetAgentFact') {
    const centreOubli = requireConcreteCenter('oubli d un fait');
    const { getFaitsAppris } = require('../lib/email-agent');
    const cible = String(body.question || '').trim().toLowerCase();
    if (!cible) throw createHttpError('Quelle question faut-il oublier ?', 400);
    const actuels = await getFaitsAppris(centreOubli);
    const restants = actuels.filter((f) => String((f && f.question) || '').toLowerCase() !== cible);
    if (restants.length === actuels.length) throw createHttpError('Ce fait n’est plus dans la mémoire de l’agent.', 404);
    // Meme fusion a deux niveaux que pour l apprentissage : jsonb_set ne cree
    // pas le niveau `email_brain` s il manque, et l oubli echouerait en silence
    // sur un centre qui n a jamais rien appris (le cas ou l on vient justement
    // de retirer son seul fait).
    await getPool().query(
      `update center_automation_settings
         set settings =
           coalesce(settings, '{}'::jsonb)
           || jsonb_build_object(
                'email_brain',
                coalesce(settings->'email_brain', '{}'::jsonb)
                || jsonb_build_object('appris', $2::jsonb)
              ),
             updated_at = now()
       where center_id = $1;`,
      [centreOubli, JSON.stringify(restants)],
    );
    sendJson(res, 200, { ok: true, action, appris: restants });
    return;
  }

  // RENDRE AU CLIENT SON ANCIEN FORMULAIRE, EN UN CLIC.
  //
  // Le parcours Pinlane vit dans une iframe sur le site du centre, a la place de
  // leur ancien formulaire. Le jour ou quelque chose cloche un dimanche a 15 h,
  // personne ne veut chercher les identifiants WordPress de l agence. Ce geste
  // coupe l iframe et rend leur formulaire d origine, sans toucher a leur site.
  //
  // On enregistre QUI a bascule et QUAND : un centre revenu a son ancien
  // formulaire sans trace resterait un mystere jusqu a ce que quelqu un s en
  // apercoive, des jours plus tard.
  if (action === 'setEmbedState') {
    const centreEmbed = requireConcreteCenter('interrupteur du formulaire');
    const membre = (options.session && options.session.member) || {};
    const actif = body.actif !== false;
    const pool = getPool();
    // On envoie UNIQUEMENT la cle qui change : la sauvegarde fusionne avec la
    // configuration existante. Renvoyer la configuration entiere figerait en
    // override des valeurs qui n etaient que des defauts.
    const config = await saveCenterConfigOverride(pool, centreEmbed, {
      embed: {
        actif,
        bascule: new Date().toISOString(),
        basculePar: String(membre.name || membre.id || ''),
      },
    });
    await refreshCenterOverrides(pool, { force: true });
    sendJson(res, 200, { ok: true, action, centerId: centreEmbed, embed: (config && config.embed) || null });
    return;
  }

  // « JE M EN OCCUPE » : la prise de main sur un mail recu, et sa liberation.
  //
  // L identite du preneur vient de LA SESSION, jamais du corps de la requete :
  // sinon n importe quel appelant pourrait poser une prise au nom d un
  // collegue, ou pire, liberer la sienne. Le refus renvoie QUI tient la main,
  // pour que l ecran d en face puisse le dire au lieu d afficher « personne ».
  if (action === 'claimInboundEmail') {
    // LE FONDATEUR NE COMPTE PAS. Il ouvre des mails pour regarder comment
    // tourne le produit, pas pour repondre a la place du centre : afficher
    // « le fondateur s occupe de ce message » ferait attendre une equipe pour
    // rien, et l habituerait a ignorer la pastille. Il voit celles des autres,
    // il n en pose aucune.
    if (priseIgnoreePourCetteSession(options.session)) {
      sendJson(res, 200, { ok: true, action, ignore: 'fondateur' });
      return;
    }
    const membre = (options.session && options.session.member) || {};
    const role = (options.session && options.session.role) || {};
    const resultat = await claimEmailThread({
      communicationId: body.communicationId,
      centerId: requireConcreteCenter('prise de main sur un mail'),
      memberId: String(membre.id || ''),
      memberName: String(membre.name || membre.id || ''),
      // Le LIBELLE du role, pas son identifiant : c est ce qui sera lu a
      // l ecran par quelqu un qui ne connait pas la table des roles.
      memberRole: String(role.name || role.id || ''),
    });
    sendJson(res, 200, { ok: true, action, ...resultat });
    return;
  }

  if (action === 'releaseInboundEmail') {
    const membre = (options.session && options.session.member) || {};
    const resultat = await releaseEmailThread({
      communicationId: body.communicationId,
      memberId: String(membre.id || ''),
    });
    sendJson(res, 200, { ok: true, action, ...resultat });
    return;
  }

  // Analyse d'un email reçu (collé par le staff, ou ré-analyse depuis l'inbox).
  // store:true → stocké dans la boîte de réception avec son analyse.
  if (action === 'analyzeInboundEmail') {
    const inboundCenterId = requireConcreteCenter('analyse email');
    const from = String(body.from || '').trim();
    const text = String(body.body || '').trim();
    if (!from || !from.includes('@')) throw createHttpError('Adresse de l’expéditeur requise.', 400);
    if (!text) throw createHttpError('Le contenu du mail est requis.', 400);
    const { analyzeEmail, ingestInboundEmail } = require('../lib/email-agent');
    if (body.store === true) {
      const result = await ingestInboundEmail({
        centerId: inboundCenterId,
        from,
        subject: String(body.subject || ''),
        body: text,
        receivedAt: body.receivedAt || null,
        requestId: body.requestId || null,
      });
      sendJson(res, 200, {
        ok: true,
        action,
        communication: result.communication ? { id: result.communication.id } : null,
        analysis: result.analysis,
        deduped: Boolean(result.deduped),
      });
      return;
    }
    const analysis = await analyzeEmail({ from, subject: String(body.subject || ''), body: text, centerId: inboundCenterId });
    sendJson(res, 200, { ok: true, action, analysis });
    return;
  }

  if (action === 'saveEmailTemplate') {
    if (!String(body.name || '').trim()) throw createHttpError('Nom du modèle requis.', 400);
    const template = await saveEmailTemplate({
      id: body.id || null,
      centerId: requireConcreteCenter('saveEmailTemplate'),
      name: body.name,
      category: body.category,
      subject: body.subject,
      body: body.body,
      createdBy: options.session?.member?.name || 'direction',
    });
    sendJson(res, 200, { ok: true, template });
    return;
  }

  if (action === 'archiveEmailTemplate') {
    const template = await archiveEmailTemplate({ id: body.id, centerId: requireConcreteCenter('archiveEmailTemplate') });
    sendJson(res, 200, { ok: true, template });
    return;
  }

  if (action === 'saveEmailIdentity') {
    const identity = await saveEmailIdentity({
      id: body.id || null,
      centerId: requireConcreteCenter('saveEmailIdentity'),
      label: body.label,
      email: body.email,
      isDefault: Boolean(body.isDefault),
      // Un domaine NEUF ne s ouvre que par la plateforme (lib/sender-domains.js) :
      // c est la session, jamais le corps de la requete, qui le dit.
      declarationPlateforme: sessionHasPermission(options.session, 'platform.admin'),
    });
    sendJson(res, 200, { ok: true, identity });
    return;
  }

  if (action === 'deleteEmailIdentity') {
    const result = await deleteEmailIdentity({ id: body.id, centerId: requireConcreteCenter('deleteEmailIdentity') });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  // Campagne : création (brouillon / envoi immédiat / programmée). Chaque
  // destinataire = une communication réelle (idempotente par campagne+email).
  if (action === 'createCampaign') {
    const campaignCenterId = requireConcreteCenter('createCampaign');
    const name = String(body.name || '').trim();
    if (!name) throw createHttpError('Nom de campagne requis.', 400);
    const segment = CAMPAIGN_SEGMENTS.some((s) => s.id === body.segment) ? body.segment : null;
    if (!segment) throw createHttpError('Segment inconnu.', 400);
    const mode = ['now', 'schedule', 'draft'].includes(body.mode) ? body.mode : 'draft';
    const subject = String(body.subject || '').trim();
    const bodyText = String(body.body || '').trim();
    if (mode !== 'draft' && (!subject || !bodyText)) throw createHttpError('Objet et message requis pour envoyer.', 400);
    const scheduledAt = mode === 'schedule' ? parseCampaignScheduledAt(body.scheduledAt) : null;

    let recipients = [];
    if (mode !== 'draft') {
      recipients = await prepareCampaignRecipients({
        centerId: campaignCenterId, segment, subject, bodyText, expectedRecipients: body.expectedRecipients,
      });
      // Anti-doublon : un re-clic / retry ne recrée pas une campagne identique déjà partie.
      const dupId = await findRecentDuplicateCampaign({ centerId: campaignCenterId, segment, subject, body: bodyText });
      if (dupId) {
        throw createHttpError(`Une campagne identique a déjà été lancée il y a moins de 3 min (#${dupId}) : vérifie la liste avant de renvoyer.`, 409);
      }
    }

    const campaign = await createCampaignRow({
      centerId: campaignCenterId,
      name,
      objective: body.objective || '',
      segment,
      subject,
      body: bodyText,
      status: mode === 'draft' ? 'draft' : mode === 'schedule' ? 'scheduled' : 'sending',
      scheduledAt,
      recipientCount: recipients.length,
      createdBy: options.session?.member?.name || 'staff',
    });

    let queued = 0;
    if (mode !== 'draft') {
      queued = await runCampaignEnqueue({ centerId: campaignCenterId, campaignId: campaign.id, recipients, subject, bodyText, scheduledAt });
    }
    sendJson(res, 200, { ok: true, campaign, queued, resendConfigured: Boolean(process.env.RESEND_API_KEY) });
    return;
  }

  // Édition d'un brouillon (jamais une campagne partie).
  if (action === 'updateCampaign') {
    const campaignCenterId = requireConcreteCenter('updateCampaign');
    const name = String(body.name || '').trim();
    if (!name) throw createHttpError('Nom de campagne requis.', 400);
    const segment = CAMPAIGN_SEGMENTS.some((s) => s.id === body.segment) ? body.segment : null;
    if (!segment) throw createHttpError('Segment inconnu.', 400);
    const campaign = await updateCampaignRow({
      id: body.id, centerId: campaignCenterId, name,
      objective: body.objective || '', segment,
      subject: String(body.subject || '').trim(), body: String(body.body || '').trim(),
    });
    sendJson(res, 200, { ok: true, campaign });
    return;
  }

  // Envoi d'un brouillon existant (immédiat ou programmé) : draft → sending.
  if (action === 'sendCampaign') {
    const campaignCenterId = requireConcreteCenter('sendCampaign');
    const existing = await getCampaignRow({ id: body.id, centerId: campaignCenterId });
    if (!existing) throw createHttpError('Campagne introuvable.', 404);
    if (existing.storedStatus !== 'draft') throw createHttpError('Seul un brouillon peut être envoyé.', 409);
    const subject = existing.subject.trim();
    const bodyText = existing.body.trim();
    if (!subject || !bodyText) throw createHttpError('Objet et message requis pour envoyer.', 400);
    const mode = body.mode === 'schedule' ? 'schedule' : 'now';
    const scheduledAt = mode === 'schedule' ? parseCampaignScheduledAt(body.scheduledAt) : null;
    const recipients = await prepareCampaignRecipients({
      centerId: campaignCenterId, segment: existing.segment, subject, bodyText, expectedRecipients: body.expectedRecipients,
    });
    const campaign = await markCampaignSending({ id: existing.id, centerId: campaignCenterId, scheduledAt });
    const queued = await runCampaignEnqueue({ centerId: campaignCenterId, campaignId: campaign.id, recipients, subject, bodyText, scheduledAt });
    sendJson(res, 200, { ok: true, campaign, queued, resendConfigured: Boolean(process.env.RESEND_API_KEY) });
    return;
  }

  if (action === 'cancelCampaign') {
    const result = await cancelCampaignRow({ id: body.id, centerId: requireConcreteCenter('cancelCampaign') });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  // Aperçu d'un message libre du composeur : même shell que l'envoi réel,
  // aucune écriture. Le front l'affiche dans l'iframe sandboxée existante.
  if (action === 'directEmailPreview') {
    const previewCenterId = requireConcreteCenter('aperçu email');
    sendJson(res, 200, { ok: true, ...buildDirectEmailPreview({ centerId: previewCenterId, subject: body.subject, body: body.body }) });
    return;
  }

  if (action === 'improveEmailWithAi') {
    const { getCenter } = require('../lib/ops-knowledge');
    const center = getCenter(centerId);
    const result = await improveEmailDraft({
      subject: body.subject,
      body: body.body,
      category: body.category || 'marketing',
      centerName: center?.name || 'votre centre',
    });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  sendError(res, 400, 'Action Ops POST inconnue.');
}

// ---- Helpers campagnes (partagés entre createCampaign et sendCampaign) ------
function parseCampaignScheduledAt(raw) {
  const when = new Date(raw || '');
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60000) {
    throw createHttpError('Date de programmation invalide (au moins 1 minute dans le futur).', 400);
  }
  return when.toISOString();
}

// Construit l'audience réelle + applique tous les garde-fous d'envoi (segment
// non vide, volume confirmé, aucun token {{...}} inconnu). Jette sinon.
async function prepareCampaignRecipients({ centerId, segment, subject, bodyText, expectedRecipients }) {
  const today = new Date().toISOString().slice(0, 10);
  const history = (await readAdminRangeState('2023-01-01', today, centerId)).reservations;
  const recipients = buildCampaignAudience({ history, segment, today });
  if (!recipients.length) throw createHttpError('Ce segment ne contient aucun client avec email : rien à envoyer.', 400);
  const expected = Number(expectedRecipients);
  if (!Number.isInteger(expected) || expected !== recipients.length) {
    throw createHttpError(`Le volume de destinataires a changé (${recipients.length} actuellement). Revérifie l'audience puis confirme à nouveau.`, 409);
  }
  const unknownTokens = findUnknownCampaignTokens(`${subject}\n${bodyText}`);
  if (unknownTokens.length) {
    throw createHttpError(`Variable(s) non reconnue(s) : ${unknownTokens.join(', ')}, seules {{prenom}} et {{nom}} sont remplacées.`, 400);
  }
  return recipients;
}

async function runCampaignEnqueue({ centerId, campaignId, recipients, subject, bodyText, scheduledAt }) {
  const identities = await listEmailIdentities({ centerId });
  const identity = identities.find((item) => item.isDefault) || null;
  const result = await enqueueCampaign({
    centerId, campaignId, recipients, subject, body: bodyText, scheduledAt,
    fromEmail: identity?.email || '', fromLabel: identity?.label || '',
    personalize: personalizeCampaignText,
  });
  return result.queued;
}

// LE FONDATEUR NE POSE JAMAIS DE PRISE SUR UN MAIL. Il ouvre des messages pour
// regarder comment tourne le produit, pas pour repondre a la place du centre :
// afficher « le fondateur s occupe de ce message » ferait attendre une equipe
// pour rien, et l habituerait a ignorer la pastille le jour ou elle compte. Il
// voit celles des autres, il n en pose aucune.
//
// Extrait en fonction nommee et exportee pour etre MESURABLE : une regle de ce
// genre, noyee dans un handler, ne se teste que par accident.
function priseIgnoreePourCetteSession(session) {
  return sessionHasPermission(session, 'platform.admin');
}

function getRequiredOpsPermission(method, action) {
  // Cockpit fondateur : permission de niveau PLATEFORME, jamais conferee par
  // un role verrouille (voir sessionHasPermission, lib/staff-auth.js). Une
  // session Direction recoit ici un 403, trace outcome=denied par PP2.
  if (['founderCockpit', 'founderAuditLog', 'founderAgents', 'founderIncidents', 'founderClients', 'founderCenters', 'founderTeam', 'founderCatalog', 'saveFormuleOverride', 'resetFormuleOverride', 'dismissIncident', 'platformClients', 'createClient', 'updateClientStatus', 'addClientCenter', 'setClientBilling', 'deleteClient', 'deleteCenter', 'requeueOpsJob'].includes(action)) return 'platform.admin';
  // Outillage FONDATEUR (stack IA, audit de stack) : longtemps derriere ai.ops,
  // une permission DE CENTRE que tout role Direction verrouille possede. Une
  // revue adverse a montre le trou : l'ecran cachait ces panneaux mais le
  // serveur repondait quand meme a une directrice. Meme regle que le cockpit.
  if (['agentStack', 'agentStackAudit'].includes(action)) return 'platform.admin';
  if (method === 'GET') {
    if (['communications', 'emailSamples'].includes(action)) return 'emails.view';
    // `job` = la lecture du poller de progression : mêmes permissions que
    // health (même surface, même sensibilité), plus les rôles marketing qui
    // déclenchent les jobs qu'ils suivent (plan marketing en live).
    if (action === 'health') return ['dashboard.view', 'ai.ops'];
    // Le journal d'audit se lit avec les droits de DIRECTION, pas avec
    // dashboard.view. Il contient qui a fait quoi dans le centre, y compris les
    // tentatives refusees : c'est un instrument de controle hierarchique, pas
    // une donnee d'exploitation. Un membre du bar n'a pas a lire la piste
    // d'activite de ses collegues. settings.manage est accepte en plus car
    // c'est le droit que porte deja la personne qui configure le centre.
    // Journal des modifications : outil PLATEFORME (2026-07-28). Il expose les
    // actions des crons, des workers et les tentatives refusees - la vie interne
    // de Pinlane. Il etait lisible par le gerant du centre (direction.view) ;
    // l'UI l'a quitte cote client, la permission serveur suit, sinon l'appel
    // resterait ouvert par lien direct.
    if (action === 'auditLog') return 'platform.admin';
    // Meme raisonnement pour l'apprentissage de l'IA : grille de jugement,
    // scores d'auto-evaluation, ADN d'ecriture. C'est le fonctionnement interne
    // du produit, lisible par la plateforme seule (demande du 2026-07-28 :
    // « cote admin uniquement »). Un gerant de centre n'a pas a y acceder,
    // meme par lien direct.
    if (action === 'aiLearning') return 'platform.admin';
    // Lecture de l'editeur tarifaire CLIENT : meme permission de CENTRE que ses
    // ecritures (saveClientFormuleOverride), JAMAIS platform.admin. Le fondateur
    // lit founderCatalog (platform.admin), le client lit clientCatalog.
    if (action === 'clientCatalog') return 'pricing.manage';
    // Lecture de l'editeur de blocage : meme permission de CENTRE que la config
    // et que ses ecritures (saveAvailabilityBlock), la personne qui parametre le
    // centre. Jamais platform.admin : c'est un reglage d'exploitation du centre.
    if (action === 'listAvailabilityBlocks') return 'settings.manage';
    if (action === 'job') return ['dashboard.view', 'ai.ops', 'campaigns.manage', 'marketing.agents'];
    if (action === 'knowledge') return ['dashboard.view', 'planning.view', 'ai.ops'];
    // Le switcher de centre doit se peupler pour TOUT role reel (chaque preset
    // porte au moins une permission de vue). La liste renvoyee est deja scopee
    // au tenant par listCentersForSession : aucune fuite meme au plus bas droit.
    if (action === 'menuCenters') return ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view'];
    if (action === 'pulse') return ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view'];
    if (action === 'emailClaims') return 'emails.view';
    if (action === 'agentQuestions') return 'emails.view';
    if (action === 'customRequests') return ['clients.view', 'reservations.view', 'dashboard.view'];
    if (['directionAnalytics', 'directionReports', 'emailInsights', 'directionComparison', 'directionRetention', 'directionAudience'].includes(action)) return 'direction.view';
    if (action === 'dashboardAnalytics') return ['dashboard.view', 'direction.view'];
    if (action === 'dailyMetrics') return ['dashboard.view', 'direction.view'];
    if (action === 'marketingInsights') return ['campaigns.manage', 'marketing.agents'];
    if (action === 'automationSettings') return ['emails.view', 'direction.view'];
    if (['customSequences', 'emailBrain'].includes(action)) return ['emails.view', 'direction.view'];
    if (action === 'relanceStats') return ['clients.view', 'emails.view'];
    if (action === 'suppressions') return ['emails.view', 'direction.view'];
    if (action === 'clientNotes') return 'clients.view';
    if (action === 'marketingWeek') return ['campaigns.manage', 'marketing.agents'];
    if (action === 'marketingRoi') return ['campaigns.manage', 'marketing.agents'];
    if (['marketingBrain', 'competitors', 'studioPacks', 'marketingBrief'].includes(action)) return ['campaigns.manage', 'marketing.agents'];
    if (action === 'emailStudio') return ['emails.view', 'direction.view'];
    if (['campaignAudience', 'listCampaigns'].includes(action)) return 'campaigns.manage';
    return 'ai.ops';
  }
  // Edition tarifaire CLIENT (cockpit centre) : permission de CENTRE
  // `pricing.manage`, JAMAIS platform.admin (reserve au fondateur). La portee
  // est forcee au centre de session (withCenter) et l'override global 'all' est
  // refuse cote lib (upsertClientFormuleOverride) : un tenant n'edite que SON tarif.
  if (['saveClientFormuleOverride', 'resetClientFormuleOverride'].includes(action)) return 'pricing.manage';
  // CRUD catalogue DB (formules/activites) : permission de CENTRE settings.manage,
  // la meme que la config du centre (saveCenterConfig). Le catalogue est partage
  // (formulas globales) aujourd hui ; le scoping per-centre est un raffinement
  // ulterieur. Jamais platform.admin : c est une edition d exploitation du centre.
  if (['createFormula', 'updateFormula', 'setFormulaSteps', 'deleteFormula', 'createActivity', 'updateActivity', 'deleteActivity'].includes(action)) return 'settings.manage';
  // Blocage granulaire de la disponibilite : permission de CENTRE settings.manage,
  // la meme que la config du centre (saveCenterConfig). Centre force a la session,
  // 'all' refuse (requireConcreteCenter + garde lib). Jamais platform.admin.
  if (['saveAvailabilityBlock', 'deleteAvailabilityBlock'].includes(action)) return 'settings.manage';
  // Telemetrie d'erreurs : TOUT membre du staff peut rapporter (chaque role
  // reel porte au moins une permission de vue). Pas de permission dediee :
  // le rapport d'un bug ne doit jamais echouer pour cause de droits.
  if (action === 'logClientError') return ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view'];
  // Parcours d'equipe : meme esprit que logClientError, toute session staff
  // legitime peut deposer son lot.
  if (action === 'activityLog') return ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view'];
  if (action === 'automationSettings') return ['settings.manage', 'emails.send', 'direction.view'];
  // L'aperçu ne fait que rendre un gabarit : il suffit de savoir lire les mails.
  // L'envoi de test et le renvoi font partir un vrai mail : `emails.send`.
  if (action === 'automationPreview') return ['emails.view', 'direction.view'];
  if (['sendAutomationTest', 'retryCommunication'].includes(action)) return 'emails.send';
  if (['customSequences', 'emailBrain'].includes(action)) return ['settings.manage', 'emails.send', 'direction.view'];
  if (action === 'sendClientRelance') return 'emails.send';
  if (action === 'clientNotes') return ['clients.edit', 'clients.view'];
  if (action === 'insightRedo') return ['campaigns.manage', 'marketing.agents'];
  if (['planActionDone', 'competitorSave', 'competitorDelete', 'competitorSweep', 'competitorAnalyzePost', 'marketingPlanGet', 'marketingPlanBuild', 'studioGenerate', 'propositionAction', 'propositionCreate', 'marketingAsk'].includes(action)) return ['campaigns.manage', 'marketing.agents'];
  if (['generateDirectionReport', 'saveDirectionReport'].includes(action)) return 'direction.view';
  if (['createCampaign', 'updateCampaign', 'sendCampaign', 'cancelCampaign'].includes(action)) return 'campaigns.manage';
  if (action === 'sendDirectEmail') return 'emails.send';
  // Ameliorer un brouillon, c'est preparer un envoi : meme droit que l'envoi.
  if (action === 'improveEmailDraft') return 'emails.send';
  if (action === 'analyzeInboundEmail') return ['emails.view', 'emails.send'];
  // Prendre la main sur un mail, c est se preparer a repondre : meme droit que
  // la lecture de la boite. Le refuser aux roles qui lisent sans envoyer les
  // rendrait invisibles a leurs collegues, donc plus dangereux, pas moins.
  if (['claimInboundEmail', 'releaseInboundEmail'].includes(action)) return 'emails.view';
  // Apprendre un fait au nom du centre engage TOUTES les reponses suivantes :
  // c est un reglage du produit, pas un geste de traitement de mail. Meme droit
  // que la configuration des textes de l agent.
  if (['answerAgentQuestion', 'forgetAgentFact'].includes(action)) return ['emails.send', 'direction.view'];
  // Couper le formulaire du site d un client est un geste de DIRECTION : il
  // change ce que voient les visiteurs du centre, hors de Pinlane. Meme droit
  // que le reste de la configuration du centre.
  if (action === 'setEmbedState') return ['settings.manage', 'direction.view'];
  if (['saveEmailTemplate', 'archiveEmailTemplate'].includes(action)) return ['campaigns.manage', 'direction.view'];
  if (['saveEmailIdentity', 'deleteEmailIdentity'].includes(action)) return ['settings.manage', 'direction.view'];
  if (action === 'improveEmailWithAi') return ['emails.view', 'direction.view', 'campaigns.manage'];
  if (action === 'directEmailPreview') return ['emails.view', 'emails.send'];
  if (action === 'customRequestStatus') return ['clients.view', 'reservations.edit', 'dashboard.view'];
  if (action === 'insightStatus') return ['campaigns.manage', 'marketing.agents'];
  if (['suppressionAdd', 'suppressionRemove'].includes(action)) return ['campaigns.manage', 'emails.send'];
  if (['communicationDraft', 'clientMessageComposer'].includes(action)) return 'emails.view';
  if (['enqueueReservation', 'dispatchDue', 'clientMessageSend'].includes(action)) return 'emails.send';
  if (['processJobs', 'enqueueJob'].includes(action)) return 'ai.ops';
  if (['plan', 'delay', 'delayImpact', 'delayApply', 'delayNotify', 'delayClear', 'delayRevert'].includes(action)) return ['planning.view', 'ai.ops'];
  return 'ai.ops';
}

// ---- PP1 : le point de passage du journal d'audit ---------------------------
//
// UN SEUL endroit instrumente couvre les 57 actions POST de ce fichier ET
// toute action ajoutee plus tard a la chaine de `if (action === ...)`, par
// construction. C'est la raison d'etre de ce placement : instrumenter les
// actions une par une garantissait qu'on en oublierait, et que la 58e, ecrite
// dans six mois, ne serait pas tracee.
//
// POLARITE VOLONTAIRE : tout ce qui est POST est trace PAR DEFAUT. La liste
// ci-dessous est une liste d'EXCLUSION, pas d'inclusion. Une action nouvelle
// est donc tracee sans que son auteur ait a y penser ; l'oubli va dans le sens
// de la tracabilite, jamais contre elle.
//
// Ces actions ne mutent rien : elles calculent et renvoient. Les tracer
// remplirait le journal de bruit et noierait les vraies modifications, ce qui
// degrade la lecture pour la directrice sans rien apporter en securite.
//
// TOUTE ENTREE DE CETTE LISTE EST UNE PROMESSE VERIFIABLE : "cette action
// n'ecrit rien". Une exclusion fausse cree un trou PERMANENT et INVISIBLE dans
// la tracabilite, ce qui est pire qu'une action bruyante. Avant d'en ajouter
// une, suivre le handler jusqu'au bout, y compris les valeurs PAR DEFAUT des
// fonctions qu'il appelle.
// Cas reel : marketingPlanGet figurait ici sous le libelle "lecture du plan".
// Son handler (ligne ~1479) appelle generateMarketingPlan(centerId, {}) quand
// aucun plan n'existe, or `persist` y vaut true PAR DEFAUT
// (lib/marketing-strategist.js) : le premier appel ECRIT un plan marketing en
// base. Une modification sans trace. Retiree de la liste, donc tracee.
const NON_MUTATING_POST_ACTIONS = new Set([
  'plan',              // planningAgent : calcul pur
  'delay',             // idem
  'delayImpact',       // computeDelayImpact : calcul pur
  'clientMessageComposer',
  'communicationDraft',
  'automationPreview', // previsualisation
  'directEmailPreview', // buildDirectEmailPreview : pur, ne touche ni base ni file
  'agentStackAudit',   // audit de lecture
  'logClientError',    // telemetrie plafonnee : le journal d'audit trace les
  'activityLog',       // parcours d'equipe : n'ecrit AUCUNE donnee metier ;
                       // sa seule ecriture est sa propre ligne d'audit
                       // (action parcours, posee par le handler pour
                       // embarquer les evenements que la liste blanche du
                       // contexte PP1 ne laisse pas passer). Une ligne PP1
                       // activityLog par lot doublerait chaque trace.
                       // actes de gestion, pas la meteo des consoles : le
                       // volume noierait la piste qui sert au controle.
]);

// Type d'objet touche, pour la piste "l'historique de CET objet". Deduit de
// l'action : les dispatchers ne connaissent pas les entites, mais le nom de
// l'action, lui, est stable.
function auditEntityFor(action, body = {}) {
  if (/^(saveCenterConfig|saveCenter|setCenterStatus)$/.test(action)) {
    return { entityType: 'center', entityId: body.centerId || body.center_id || '' };
  }
  // Suppressions proprietaire : l'id cible est body.id (withCenter ecrase
  // body.centerId avec le centre de session, voir le handler).
  if (action === 'deleteCenter') return { entityType: 'center', entityId: body.id || '' };
  if (action === 'deleteClient') return { entityType: 'client', entityId: body.id || '' };
  // CRUD catalogue : l entite est la formule / l activite editee (id dans le
  // corps, ou dans l objet cree). Rend la piste "l historique de CET objet" utile.
  if (/Formula/.test(action)) return { entityType: 'formula', entityId: body.id || (body.formula && body.formula.id) || '' };
  if (/Activity/.test(action)) return { entityType: 'activity', entityId: body.id || (body.activity && body.activity.id) || '' };
  if (/Campaign/i.test(action)) return { entityType: 'campaign', entityId: body.id || body.campaignId || '' };
  if (/EmailTemplate/i.test(action)) return { entityType: 'email_template', entityId: body.id || body.templateId || '' };
  if (/EmailIdentity/i.test(action)) return { entityType: 'email_identity', entityId: body.id || body.identityId || '' };
  if (/^suppression/.test(action)) return { entityType: 'marketing_suppression', entityId: '' };
  if (/^competitor/.test(action)) return { entityType: 'competitor', entityId: body.id || body.competitorId || '' };
  if (/OpsJob/i.test(action)) return { entityType: 'ops_job', entityId: body.id || '' };
  if (/Reservation|reservation/.test(action)) return { entityType: 'reservation', entityId: body.reservationId || (body.reservation && body.reservation.id) || '' };
  if (/^delay/.test(action)) return { entityType: 'delay_incident', entityId: body.incidentId || body.id || '' };
  if (/DirectionReport/i.test(action)) return { entityType: 'direction_report', entityId: body.id || '' };
  return { entityType: 'ops_action', entityId: body.id !== undefined && body.id !== null ? String(body.id) : '' };
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
      if (refuserPorteePlateforme(res, session, requestedCenterId)) return;
      await handleGet(req, res, { centerId: resolveEffectiveCenterId(session, requestedCenterId), session });
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
      if (refuserPorteePlateforme(res, session, requestedCenterId)) return;
      const effectiveCenterId = resolveEffectiveCenterId(session, requestedCenterId);

      const audited = !NON_MUTATING_POST_ACTIONS.has(action);
      const requestId = newRequestId();
      const entity = auditEntityFor(action, body);
      // Liste BLANCHE du contexte conserve. On ne journalise JAMAIS le corps de
      // requete entier de facon generique : ce fichier recoit des sujets et des
      // corps de mails, et surtout la reponse de certaines actions porte des
      // codes d'acces en clair. Le corps est de toute facon re-expurge par
      // redactSecrets dans lib/audit-log.js, mais la liste blanche est la
      // premiere barriere et la seule qui ne depende pas d'un motif.
      const auditContext = {
        requestedCenterId: requestedCenterId || '',
        hasBody: Boolean(body && Object.keys(body).length),
        bodyKeys: Object.keys(body || {}).slice(0, 40),
        id: body && body.id !== undefined ? String(body.id) : '',
        status: body && body.status ? String(body.status) : '',
      };
      const auditBase = {
        centerId: effectiveCenterId || 'libramont',
        ...actorFromSession(session),
        surface: 'api/ops.js',
        action,
        method: 'POST',
        entityType: entity.entityType,
        entityId: entity.entityId,
        requestId,
        context: auditContext,
      };

      // REGIME BLOQUANT : la trace s'ecrit AVANT la mutation. Si elle echoue,
      // writeAuditLogOrThrow jette et handlePost n'est jamais appele : rien
      // n'est modifie sans trace. C'est l'ordre qui porte la garantie, pas
      // l'intention. Ces actions (config, tarifs, statut de centre, envoi de
      // masse) sont rares et hors chemin chaud : le surcout d'un aller-retour
      // avant l'action est sans consequence, l'absence de trace en aurait une.
      if (audited && isBlockingAction(action)) {
        await writeAuditLogOrThrow({ ...auditBase, outcome: 'success' });
      }

      try {
        await handlePost(req, res, withCenter(body, effectiveCenterId), { centerId: effectiveCenterId, session });
      } catch (error) {
        // Une action qui echoue est une information d'audit : elle distingue
        // "personne n'a essaye" de "quelqu'un a essaye et ca a casse".
        if (audited) {
          await writeAuditLog({
            ...auditBase,
            outcome: 'error',
            context: { ...auditContext, erreur: String((error && error.message) || 'erreur').slice(0, 300) },
          });
        }
        throw error;
      }

      // REGIME NON BLOQUANT : la reponse est deja partie (handlePost a fait
      // sendJson). On ecrit apres, donc sans ajouter la moindre latence percue
      // par le staff. Un echec ici ne casse pas l'action, mais il crie :
      // console.error a prefixe stable + compteur expose dans l'action health.
      if (audited && !isBlockingAction(action)) {
        await writeAuditLog({ ...auditBase, outcome: 'success' });
      }
      return;
    }
    sendError(res, 405, 'Méthode non autorisée.');
  } catch (error) {
    const status = error && error.expose === true ? (error.statusCode || 400) : (error && error.statusCode >= 500 ? error.statusCode : 503);
    sendError(res, status, safeUserMessage(error, 'Opération impossible pour le moment. Réessayez dans un instant.'));
  }
};

// La table action -> permission est EXPOSEE pour etre auditee (gate
// scripts/permissions-audit-check.js). Elle reste la seule autorite : le gate
// la lit, il ne la recopie pas. Une regle recopiee dans un test derive du
// produit au premier changement, et le test finit par prouver une regle morte.
module.exports.getRequiredOpsPermission = getRequiredOpsPermission;
module.exports.__test = { priseIgnoreePourCetteSession };
