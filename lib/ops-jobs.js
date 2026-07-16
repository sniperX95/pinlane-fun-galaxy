const {
  createCommunication,
  createOpsEvent,
  createOpsJob,
  listDueOpsJobs,
  updateOpsJobStatus,
} = require('./database');
const {
  dispatchDueCommunications,
  enqueueReservationCommunications,
  getAutomationSettings,
  buildPostVisitMessage,
  emailShell,
} = require('./ops-communications');
const crypto = require('crypto');

// Base publique de l'app (liens trackés dans les emails). Le domaine prod est
// le fallback assumé : les liens doivent marcher même sans env dédiée.
function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://www.mngfunglxy.com').replace(/\/$/, '');
}

const BRUSSELS_TZ = 'Europe/Brussels';

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function getZonedParts(date, timeZone = BRUSSELS_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function zonedTimeToUtc(dateStr, timeStr, timeZone = BRUSSELS_TZ) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const [hour, minute = 0] = String(timeStr || '10:00').split(':').map(Number);
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(utc, timeZone);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const current = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    utc = new Date(utc.getTime() + (desired - current));
  }
  return utc;
}

function reservationKey(reservation = {}) {
  return reservation.id || [
    reservation.centerId || 'libramont',
    reservation.email || reservation.phone || reservation.name || 'manual',
    reservation.date || 'date',
    reservation.startTime || 'time',
    reservation.type || 'reservation',
  ].join(':');
}

function normalizeReservationPayload(reservation = {}) {
  return {
    ...reservation,
    centerId: reservation.centerId || reservation.center_id || 'libramont',
    startTime: reservation.startTime || reservation.start_time || '',
    formuleId: reservation.formuleId || reservation.formule_id || '',
    validationStatus: reservation.validationStatus || reservation.validation_status || '',
    riskLevel: reservation.riskLevel || reservation.risk_level || '',
    opsPlan: reservation.opsPlan || reservation.ops_plan || {},
  };
}

async function enqueueReservationAutomation(reservationInput, options = {}) {
  const reservation = normalizeReservationPayload(reservationInput);
  const centerId = reservation.centerId || 'libramont';
  const key = reservationKey(reservation);
  // Timing du merci post-visite réglable (0..3 j après la venue, défaut 1 j).
  // 0 jour = 3 h après l'arrivée (le temps de la session).
  let postVisitMinutes = 24 * 60;
  try {
    const automation = await getAutomationSettings(centerId);
    const offsetDays = automation.post_visit?.offsetDays;
    if (Number.isInteger(offsetDays)) postVisitMinutes = offsetDays === 0 ? 180 : offsetDays * 24 * 60;
  } catch (error) { /* défaut conservé */ }

  // Jobs indépendants (clés d'idempotence distinctes) : insertions en
  // PARALLÈLE : ce code est sur le chemin chaud des mutations staff.
  const jobs = [createOpsJob({
    centerId,
    reservationId: reservation.id || null,
    jobType: 'dispatch_communications',
    priority: 90,
    runAt: options.dispatchAt || new Date().toISOString(),
    idempotencyKey: `reservation:${key}:job:dispatch_communications`,
    payload: { reservation },
  })];

  if (reservation.date && reservation.startTime) {
    const arrivalAt = zonedTimeToUtc(reservation.date, reservation.startTime);
    jobs.push(createOpsJob({
      centerId,
      reservationId: reservation.id || null,
      jobType: 'reservation_no_show_watch',
      priority: 70,
      runAt: addMinutes(arrivalAt, 15).toISOString(),
      idempotencyKey: `reservation:${key}:job:no_show_watch`,
      payload: { reservation },
    }));
    jobs.push(createOpsJob({
      centerId,
      reservationId: reservation.id || null,
      jobType: 'reservation_followup',
      priority: 40,
      runAt: addMinutes(arrivalAt, postVisitMinutes).toISOString(),
      idempotencyKey: `reservation:${key}:job:followup`,
      payload: { reservation },
    }));
  }

  return Promise.all(jobs);
}

async function handleDispatchCommunications(job) {
  const reservation = normalizeReservationPayload(job.payload?.reservation || {});
  const centerId = reservation.centerId || job.centerId || 'libramont';
  if (reservation.id || reservation.email || reservation.phone) {
    await enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus,
    });
  }
  const dispatch = await dispatchDueCommunications({ limit: 25, centerId });
  return {
    checked: dispatch.checked || 0,
    sent: (dispatch.results || []).filter((result) => result.status === 'sent' || result.providerMessageId).length,
    results: dispatch.results || [],
  };
}

async function handleNoShowWatch(job) {
  const reservation = normalizeReservationPayload(job.payload?.reservation || {});
  const centerId = reservation.centerId || job.centerId || 'libramont';
  await createOpsEvent({
    centerId,
    reservationId: reservation.id || job.reservationId || null,
    eventType: 'no_show_watch_due',
    severity: 'info',
    payload: {
      reservationName: reservation.name || '',
      startTime: reservation.startTime || '',
      instruction: 'Verifier arrivee client; si absent, marquer retard/no-show et lancer alternative terrain.',
    },
  }).catch(() => null);
  return { event: 'no_show_watch_due', reservationId: reservation.id || null };
}

async function handleReservationFollowup(job) {
  const reservation = normalizeReservationPayload(job.payload?.reservation || {});
  const email = String(reservation.email || '').trim();
  if (!email) return { skipped: true, reason: 'email_absent' };
  const centerId = reservation.centerId || job.centerId || 'libramont';
  // Texte personnalisable par le gérant (page Emails) ; défaut historique.
  let overrides = null;
  try {
    overrides = (await getAutomationSettings(centerId)).post_visit;
  } catch (error) {
    overrides = null;
  }
  const message = buildPostVisitMessage({ name: reservation.name || '' }, overrides);
  const subject = message.subject;
  const body = message.body;
  // Bouton « avis Google » tracké quand le gérant a configuré sa fiche
  // (éditeur de la séquence Merci post-visite). Token 128 bits → /api/r.
  const reviewUrl = String(overrides?.reviewUrl || '').trim();
  const reviewToken = reviewUrl ? crypto.randomBytes(16).toString('hex') : null;
  const action = reviewToken
    ? { href: `${publicBaseUrl()}/api/r?k=${reviewToken}`, label: 'Laissez-nous un avis Google, ça prend 30 secondes' }
    : null;
  const communication = await createCommunication({
    centerId,
    reservationId: reservation.id || job.reservationId || null,
    channel: 'email',
    templateId: 'post_visit_followup',
    recipient: email,
    subject,
    // emailShell : habillage standard + échappement HTML (le nom du client
    // était interpolé sans échappement dans l'ancien rendu inline).
    body: emailShell({ title: subject, body, preheader: subject, action }),
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    idempotencyKey: `reservation:${reservationKey(reservation)}:post_visit_followup:email`,
    payload: {
      textBody: body,
      ...(reviewToken ? { reviewToken, reviewUrl } : {}),
    },
  });
  const dispatch = await dispatchDueCommunications({ limit: 10, centerId, reservationId: reservation.id || job.reservationId || null });
  return { communicationId: communication.id, dispatch };
}

// LE STRATEGE sur la queue (Phase 4).
//
// Pourquoi ici et pas dans le cron : le cron marketing est « au mieux ». S'il
// echoue, personne ne le sait et le plan n'existe pas pendant une semaine. La
// queue apporte ce qui manquait : retries, backoff, last_error visible, et
// idempotence.
// La generation est idempotente cote SQL (index unique center_id + from_date
// tant que le plan n'est pas archive), donc un retry remplace le plan au lieu
// d'en creer un second. C'est ce qui rend le passage sur la queue sur.
async function handleMarketingPlan(job) {
  const { generateMarketingPlan } = require('./marketing-strategist');
  const centerId = job.payload?.centerId || job.centerId || 'libramont';
  const weeks = Number(job.payload?.weeks) || undefined;
  const { plan, saved } = await generateMarketingPlan(centerId, { weeks });
  return {
    centerId,
    planId: saved ? saved.id : null,
    mode: plan.mode,
    semaines: plan.weeks.length,
    // Remonte dans ops_jobs.result : si le garde-fou d'ancrage se met a rejeter
    // des semaines, ca se voit dans la queue sans lire un log.
    semainesRejetees: plan.context.semainesRejetees,
  };
}

async function processJob(job) {
  if (job.jobType === 'dispatch_communications') return handleDispatchCommunications(job);
  if (job.jobType === 'reservation_no_show_watch') return handleNoShowWatch(job);
  if (job.jobType === 'reservation_followup') return handleReservationFollowup(job);
  if (job.jobType === 'marketing_plan') return handleMarketingPlan(job);
  throw new Error(`Job Ops inconnu: ${job.jobType}`);
}

async function processDueOpsJobs({ limit = 25, centerId = '' } = {}) {
  const jobs = await listDueOpsJobs({ limit, centerId });
  const results = [];

  for (const job of jobs) {
    try {
      const result = await processJob(job);
      const updated = await updateOpsJobStatus(job.id, {
        status: 'done',
        incrementAttempts: 1,
        result,
      });
      results.push({ id: job.id, jobType: job.jobType, status: updated.status, result });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const exhausted = attempts >= Number(job.maxAttempts || 5);
      const retryAt = addMinutes(new Date(), Math.min(60, attempts * 5)).toISOString();
      const updated = await updateOpsJobStatus(job.id, {
        status: exhausted ? 'failed' : 'queued',
        incrementAttempts: 1,
        runAt: exhausted ? null : retryAt,
        lastError: error.message || String(error),
        result: { failedAt: new Date().toISOString() },
      });
      results.push({
        id: job.id,
        jobType: job.jobType,
        status: updated.status,
        error: error.message || String(error),
      });
    }
  }

  return {
    ok: true,
    action: 'ops-jobs',
    checked: jobs.length,
    results,
  };
}

// Enfile le plan hebdo. Appele par le cron, qui n'est plus qu'un declencheur :
// le vrai travail (et ses retries) vit sur la queue.
//
// La cle d'idempotence porte le lundi de la semaine : le cron peut se declencher
// dix fois, il n'y aura qu'UN job par centre et par semaine. C'est la seule
// facon de mettre un appel LLM sur une queue a retries sans payer dix fois.
async function enqueueWeeklyMarketingPlans({ centerIds = ['libramont', 'gembloux'], today = null } = {}) {
  const { mondayOf, isoDate } = require('./marketing-strategist');
  const monday = mondayOf(today || isoDate(new Date()));
  const out = [];
  for (const centerId of centerIds) {
    const job = await createOpsJob({
      centerId,
      jobType: 'marketing_plan',
      priority: 70, // moins urgent qu'une communication client
      idempotencyKey: `marketing_plan:${centerId}:${monday}`,
      payload: { centerId, weeks: 8 },
    }).catch(() => null);
    out.push({ centerId, monday, jobId: job ? job.id : null });
  }
  return { ok: true, monday, enqueued: out };
}

module.exports = {
  enqueueReservationAutomation,
  enqueueWeeklyMarketingPlans,
  processDueOpsJobs,
  __test: { handleReservationFollowup, handleMarketingPlan, publicBaseUrl },
};
