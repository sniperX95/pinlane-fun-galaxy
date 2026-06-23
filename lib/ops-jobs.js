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
} = require('./ops-communications');

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
  const created = [];

  created.push(await createOpsJob({
    centerId,
    reservationId: reservation.id || null,
    jobType: 'dispatch_communications',
    priority: 90,
    runAt: options.dispatchAt || new Date().toISOString(),
    idempotencyKey: `reservation:${key}:job:dispatch_communications`,
    payload: { reservation },
  }));

  if (reservation.date && reservation.startTime) {
    const arrivalAt = zonedTimeToUtc(reservation.date, reservation.startTime);
    created.push(await createOpsJob({
      centerId,
      reservationId: reservation.id || null,
      jobType: 'reservation_no_show_watch',
      priority: 70,
      runAt: addMinutes(arrivalAt, 15).toISOString(),
      idempotencyKey: `reservation:${key}:job:no_show_watch`,
      payload: { reservation },
    }));
    created.push(await createOpsJob({
      centerId,
      reservationId: reservation.id || null,
      jobType: 'reservation_followup',
      priority: 40,
      runAt: addMinutes(arrivalAt, 24 * 60).toISOString(),
      idempotencyKey: `reservation:${key}:job:followup`,
      payload: { reservation },
    }));
  }

  return created;
}

async function handleDispatchCommunications(job) {
  const reservation = normalizeReservationPayload(job.payload?.reservation || {});
  if (reservation.id || reservation.email || reservation.phone) {
    await enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus,
    });
  }
  const dispatch = await dispatchDueCommunications({ limit: 25 });
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
  const subject = 'Merci pour votre visite chez Fun Galaxy';
  const body = [
    `Bonjour ${reservation.name || ''},`.trim(),
    '',
    'Merci d etre venu chez Fun Galaxy.',
    'Si tout sest bien passe, on sera ravi de vous revoir pour une prochaine session.',
    'Si quelque chose peut etre ameliore, repondez simplement a ce message: votre retour arrive directement a l equipe.',
    '',
    'Fun Galaxy',
  ].join('\n');
  const communication = await createCommunication({
    centerId,
    reservationId: reservation.id || job.reservationId || null,
    channel: 'email',
    templateId: 'post_visit_followup',
    recipient: email,
    subject,
    body: body.split('\n').map((line) => (line ? `<p>${line}</p>` : '<br>')).join(''),
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    idempotencyKey: `reservation:${reservationKey(reservation)}:post_visit_followup:email`,
    payload: { textBody: body },
  });
  const dispatch = await dispatchDueCommunications({ limit: 10 });
  return { communicationId: communication.id, dispatch };
}

async function processJob(job) {
  if (job.jobType === 'dispatch_communications') return handleDispatchCommunications(job);
  if (job.jobType === 'reservation_no_show_watch') return handleNoShowWatch(job);
  if (job.jobType === 'reservation_followup') return handleReservationFollowup(job);
  throw new Error(`Job Ops inconnu: ${job.jobType}`);
}

async function processDueOpsJobs({ limit = 25 } = {}) {
  const jobs = await listDueOpsJobs({ limit });
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

module.exports = {
  enqueueReservationAutomation,
  processDueOpsJobs,
};
