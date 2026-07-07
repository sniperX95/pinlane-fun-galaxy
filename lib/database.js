const { Pool } = require('pg');
const { getCenter, getFormula } = require('./ops-knowledge');
const {
  LASER_GAME_ARENA_MINUTES,
  MAX_PER_LANE,
  PAIRS,
  TOTAL_LANES,
} = require('./booking-config');

const VALID_STATUSES = new Set(['pending', 'arrived', 'paid', 'cancelled']);
const VALID_VALIDATION_STATUSES = new Set(['draft', 'requested', 'staff_review', 'confirmed', 'rejected']);
const VALID_LANE_STATUSES = new Set(['active', 'maintenance']);
const VALID_RESERVATION_TYPES = new Set(['bowling', 'laser', 'formule']);
const BOWLING_FORMULE_IDS = new Set(['f1', 'f3', 'f4', 'bts', 'css', 'ffm']);

let pool;
let simulationSchemaReady = false;

function getSslConfig() {
  const mode = String(process.env.DATABASE_SSL || 'require').toLowerCase();
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && mode !== 'no-verify') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  }
  if (mode === 'disable' || mode === 'false') return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return true;
}

function getDatabaseConnectionString() {
  const raw = process.env.DATABASE_URL;
  const mode = String(process.env.DATABASE_SSL || 'require').toLowerCase();
  try {
    const url = new URL(raw);
    if (mode === 'disable' || mode === 'false') {
      url.searchParams.set('sslmode', 'disable');
    } else if (mode === 'no-verify') {
      url.searchParams.set('sslmode', 'no-verify');
    } else {
      url.searchParams.set('sslmode', 'verify-full');
    }
    return url.toString();
  } catch (error) {
    return raw;
  }
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseConnectionString(),
      ssl: getSslConfig(),
    });
  }

  return pool;
}

async function ensureSimulationSchema() {
  if (simulationSchemaReady) return;
  await getPool().query(`
    alter table reservations drop constraint if exists reservations_pax_check;
    alter table reservations
      add constraint reservations_pax_check check (pax > 0 and pax <= 240);

    create table if not exists ops_simulation_runs (
      id text primary key,
      center_id text not null default 'libramont',
      sim_date date not null,
      scenario text not null default 'rush_day',
      status text not null default 'running' check (status in ('running', 'finished', 'failed', 'cancelled')),
      step_index integer not null default 0,
      total_steps integer not null default 0,
      speed_factor integer not null default 90,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      finished_at timestamptz
    );

    create index if not exists ops_simulation_runs_center_idx
      on ops_simulation_runs (center_id, sim_date desc, created_at desc);

    create table if not exists ops_decision_logs (
      id bigserial primary key,
      center_id text not null default 'libramont',
      run_id text,
      reservation_id bigint references reservations(id) on delete set null,
      agent_id text not null,
      decision_type text not null,
      severity text not null default 'info' check (severity in ('info', 'medium', 'high', 'critical')),
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists ops_decision_logs_center_idx
      on ops_decision_logs (center_id, created_at desc);
    create index if not exists ops_decision_logs_run_idx
      on ops_decision_logs (run_id, created_at asc);

    drop trigger if exists ops_simulation_runs_set_updated_at on ops_simulation_runs;
    create trigger ops_simulation_runs_set_updated_at
    before update on ops_simulation_runs
    for each row
    execute function set_updated_at();
  `);
  simulationSchemaReady = true;
}

async function withTransaction(run) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error('Date invalide.');
  }
  return String(value);
}

function assertTime(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) {
    throw new Error('Heure invalide.');
  }
  return String(value);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, { required = false, fallback = '' } = {}) {
  const normalized = String(value ?? fallback).trim();
  if (required && !normalized) {
    throw new Error('Champ requis manquant.');
  }
  return normalized;
}

function isSimulationCommunicationInput(input = {}, payload = {}, idempotencyKey = '') {
  return payload.simulation === true
    || String(payload.simulation || '').toLowerCase() === 'true'
    || Boolean(payload.simulationRunId)
    || String(idempotencyKey || '').startsWith('simulation:')
    || String(input.templateId || input.template_id || '').startsWith('simulation_');
}

function normalizeExtras(extras) {
  if (!Array.isArray(extras)) return [];
  return extras
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: normalizeText(item.id, { fallback: '' }),
      name: normalizeText(item.name, { fallback: 'Extra' }),
      price: toNumber(item.price, 0),
    }));
}

// Per-center bowling bounds. Falls back to the historical constants when the
// center is unknown or the config lookup fails, so behaviour is unchanged for
// centers that keep the default 8-lane / 6-per-lane setup.
function resolveCenterLaneCount(centerId) {
  try {
    const value = Number(getCenter(centerId || 'libramont')?.resources?.bowling?.laneCount);
    return Number.isFinite(value) && value > 0 ? value : TOTAL_LANES;
  } catch (error) {
    return TOTAL_LANES;
  }
}

function resolveCenterNormalCapacity(centerId) {
  try {
    const value = Number(getCenter(centerId || 'libramont')?.resources?.bowling?.normalCapacityPerLane);
    return Number.isFinite(value) && value > 0 ? value : MAX_PER_LANE;
  } catch (error) {
    return MAX_PER_LANE;
  }
}

function normalizeLaneArray(lanes, maxLane = TOTAL_LANES) {
  if (!Array.isArray(lanes)) return [];
  return [...new Set(lanes.map((lane) => Number(lane)).filter((lane) => lane >= 1 && lane <= maxLane))].sort(
    (left, right) => left - right,
  );
}

function timeToNum(value) {
  const [hours, minutes] = assertTime(value).split(':').map(Number);
  return hours + minutes / 60;
}

function overlap(startA, durationA, startB, durationB) {
  return startA < startB + durationB && startB < startA + durationA;
}

function inferLaserGamesFromDuration(duration) {
  const hours = toNumber(duration, 0.5);
  if (hours >= 1.25) return 3;
  if (hours >= 0.75) return 2;
  return 1;
}

function splitLaserPlayers(pax, capacity = 30) {
  const players = Math.max(1, Math.trunc(toNumber(pax, 1)));
  const maxPerWave = Math.max(1, Math.trunc(toNumber(capacity, 30)));
  const waveCount = Math.max(1, Math.ceil(players / maxPerWave));
  const base = Math.floor(players / waveCount);
  const extra = players % waveCount;
  return Array.from({ length: waveCount }, (_, index) => base + (index < extra ? 1 : 0));
}

function laserBlocksFromCandidate(startTime, duration, pax, centerId = 'libramont') {
  const center = getCenter(centerId || 'libramont');
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const players = Math.max(1, Math.trunc(toNumber(pax, 1)));
  const games = inferLaserGamesFromDuration(duration);
  const waveSizes = splitLaserPlayers(players, weaponCount);
  // startTime = début exact de la première partie (l'accueil se fait avant,
  // hors ressources critiques) : l'arène est occupée dès cette heure.
  let cursor = timeToNum(startTime) * 60;
  let laserBriefed = false;
  const blocks = [];

  for (let game = 0; game < games; game += 1) {
    for (let waveIndex = 0; waveIndex < waveSizes.length; waveIndex += 1) {
      const durationMinutes = LASER_GAME_ARENA_MINUTES;
      const start = cursor;
      const end = start + durationMinutes;
      blocks.push({
        resourceType: 'laser_arena',
        activityId: 'laser_game',
        label: 'Laser Game',
        start: start / 60,
        end: end / 60,
        duration: durationMinutes / 60,
        startTime: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(Math.round(start % 60)).padStart(2, '0')}`,
        endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(Math.round(end % 60)).padStart(2, '0')}`,
        players: waveSizes[waveIndex],
        groupPlayers: players,
        groupWaveIndex: waveIndex + 1,
        groupWaveCount: waveSizes.length,
        countIndex: game + 1,
      });
      cursor = end;
      laserBriefed = true;
    }
    if (game < games - 1) cursor += 5;
  }

  return blocks;
}

function countFormulaLaserGames(formula) {
  return (formula?.steps || [])
    .filter((step) => step.activityId === 'laser_game')
    .reduce((sum, step) => sum + Math.max(1, Math.trunc(toNumber(step.count, 1))), 0);
}

function formulaFallbackLaserBlocks(reservation) {
  if (reservation.type !== 'formule' || !reservation.formuleId) return [];
  let formula = null;
  try {
    formula = getFormula(reservation.formuleId);
  } catch (error) {
    return [];
  }
  const games = countFormulaLaserGames(formula);
  if (!games) return [];
  const players = toNumber(reservation.pax, 1);
  const bowlingWindows = laneWindowsFromReservation(reservation);
  const preferredLaserTime = reservation.preference?.preferredLaserTime || reservation.opsPlan?.laserPassPlan?.scheduledPasses?.[0]?.startTime || '';
  // reservation.startTime = début exact de la première activité : sans bowling
  // planifié avant, le premier laser part à cette heure (plus d'offset accueil).
  const firstLaserStart = preferredLaserTime
    ? timeToNum(preferredLaserTime)
    : bowlingWindows.length
      ? Math.max(...bowlingWindows.map((window) => Number(window.start || 0) + Number(window.duration || 0))) + (5 / 60)
      : timeToNum(reservation.startTime);
  const bookingStartMinutes = Math.max(0, Math.round(firstLaserStart * 60));
  const bookingStart = `${String(Math.floor(bookingStartMinutes / 60)).padStart(2, '0')}:${String(bookingStartMinutes % 60).padStart(2, '0')}`;
  return laserBlocksFromCandidate(bookingStart, games * 0.5, players, reservation.centerId || reservation.center_id || 'libramont')
    .map((block) => ({
      ...block,
      formulaFallback: true,
    }));
}

function readBlockTime(block, key, fallback = 0) {
  const raw = block?.[key];
  if (Number.isFinite(Number(raw))) {
    const value = Number(raw);
    return value > 24 ? value / 60 : value;
  }
  const timeKey = key === 'start' ? 'startTime' : 'endTime';
  if (block?.[timeKey]) return timeToNum(block[timeKey]);
  return fallback;
}

function normalizeLaserArenaEnd(start, end) {
  const arenaEnd = start + (LASER_GAME_ARENA_MINUTES / 60);
  if (!Number.isFinite(Number(end)) || end <= start) return arenaEnd;
  return Math.min(end, arenaEnd);
}

function laneWindowsFromOpsPlan(opsPlan, fallbackLanes = [], maxLane = TOTAL_LANES) {
  const blocks = Array.isArray(opsPlan?.resourceBlocks) ? opsPlan.resourceBlocks : [];
  return blocks
    .filter((block) => block.resourceType === 'bowling_lane')
    .map((block) => {
      const start = readBlockTime(block, 'start');
      const end = readBlockTime(block, 'end', start + toNumber(block.durationMinutes, 60) / 60);
      return {
        start,
        duration: Math.max(0, end - start),
        lanes: normalizeLaneArray(block.lanes?.length ? block.lanes : fallbackLanes, maxLane),
      };
    })
    .filter((window) => window.duration > 0 && window.lanes.length > 0);
}

function laneWindowsFromReservation(reservation) {
  const maxLane = resolveCenterLaneCount(reservation.centerId || reservation.center_id);
  const fromPlan = laneWindowsFromOpsPlan(reservation.opsPlan, reservation.lanes || [], maxLane);
  if (fromPlan.length) return fromPlan;
  return [{
    start: timeToNum(reservation.startTime),
    duration: toNumber(reservation.duration, 0),
    lanes: normalizeLaneArray(reservation.lanes || [], maxLane),
  }];
}

function laneWindowsFromCandidate(startTime, duration, lanes, opsPlan = null, maxLane = TOTAL_LANES) {
  const fromPlan = laneWindowsFromOpsPlan(opsPlan, lanes || [], maxLane);
  if (fromPlan.length) return fromPlan;
  return [{
    start: timeToNum(startTime),
    duration: toNumber(duration, 0),
    lanes: normalizeLaneArray(lanes || [], maxLane),
  }];
}

function resourceBlocksFromReservation(reservation, resourceType) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const planned = blocks
    .filter((block) => block.resourceType === resourceType)
    .filter((block) => !(
      resourceType === 'laser_arena'
      && reservation.type === 'laser'
      && Number(block.countIndex || 1) > 1
      && !block.manualLaserPass
    ))
    .map((block) => {
      const start = readBlockTime(block, 'start');
      const rawEnd = readBlockTime(block, 'end', start + toNumber(block.durationMinutes, LASER_GAME_ARENA_MINUTES) / 60);
      const end = resourceType === 'laser_arena' ? normalizeLaserArenaEnd(start, rawEnd) : rawEnd;
      return {
        ...block,
        start,
        end,
        duration: Math.max(0, end - start),
        players: toNumber(block.players || block.pax || reservation.pax, reservation.pax || 0),
      };
    })
    .filter((block) => block.duration > 0);
  if (planned.length) return planned;
  if (resourceType === 'laser_arena' && reservation.type === 'laser') {
    const candidateBlocks = laserBlocksFromCandidate(
      reservation.startTime,
      reservation.duration,
      reservation.pax,
      reservation.centerId || reservation.center_id || 'libramont',
    );
    const duration = toNumber(reservation.duration, 0.5);
    const games = duration >= 1.25 ? 3 : duration >= 0.75 ? 2 : 1;
    return games > 1
      ? candidateBlocks.filter((block) => Number(block.countIndex || 1) === 1)
      : candidateBlocks;
  }
  if (resourceType === 'laser_arena' && reservation.type === 'formule') {
    return formulaFallbackLaserBlocks(reservation);
  }
  return [];
}

function ensureLaserCapacity(payload, reservations) {
  const candidateBlocks = resourceBlocksFromReservation(payload, 'laser_arena');
  if (!candidateBlocks.length) return;

  const center = getCenter(payload.centerId || 'libramont');
  const weaponCount = center.resources.laser?.weaponCount || 30;
  const parallelLaunches = center.resources.laser?.parallelLaunches || 1;
  const existingBlocks = reservations.flatMap((reservation) => resourceBlocksFromReservation(reservation, 'laser_arena'));

  candidateBlocks.forEach((candidate) => {
    const overlapping = existingBlocks.filter((existing) => overlap(candidate.start, candidate.duration, existing.start, existing.duration));
    const sessionKey = `${candidate.start}-${candidate.end}`;
    const sessionKeys = new Set(overlapping.map((existing) => `${existing.start}-${existing.end}`));
    const joinsExistingSession = sessionKeys.has(sessionKey);
    const launchCount = sessionKeys.size + (joinsExistingSession ? 0 : 1);
    const players = overlapping.reduce((sum, existing) => sum + toNumber(existing.players, 0), toNumber(candidate.players, 0));

    if (launchCount > parallelLaunches || players > weaponCount) {
      throw new Error(`Laser Game complet sur ce créneau (${players}/${weaponCount} joueurs, ${launchCount}/${parallelLaunches} lancement).`);
    }
  });
}

function reservationNeedsLanes(payload) {
  if (payload.type === 'bowling') return true;
  if (payload.type === 'formule' && payload.formuleId) return BOWLING_FORMULE_IDS.has(payload.formuleId);
  return Boolean(payload.requiresLanes || payload.lanes.length || payload.laneCount > 0);
}

// Neutralise toute injection HTML dans les champs libres saisis par le client
// (nom/téléphone/email). Ces valeurs sont réaffichées telles quelles dans la
// console staff/direction, les exports et les mails : sans ça, un nom piégé
// (ex. `<img src=x onerror=...>`) exécuterait du code chez le staff (XSS stocké).
// On retire les chevrons : impossible de former une balise sans `<`.
function stripUnsafeMarkup(value) {
  return String(value ?? '').replace(/[<>]/g, '');
}

function normalizeReservationPayload(input, defaults = {}) {
  const requestedType = normalizeText(input.type, { fallback: defaults.type || 'bowling' }).toLowerCase();
  const type = VALID_RESERVATION_TYPES.has(requestedType) ? requestedType : 'bowling';
  const centerId = normalizeText(input.centerId || input.center_id, { fallback: defaults.centerId || 'libramont' }) || 'libramont';
  const laneCountBound = resolveCenterLaneCount(centerId);
  const normalCapacityPerLane = resolveCenterNormalCapacity(centerId);
  const payload = {
    id: input.id ? Number(input.id) : defaults.id || null,
    centerId,
    channel: normalizeText(input.channel, { fallback: defaults.channel || 'staff' }) || 'staff',
    name: stripUnsafeMarkup(normalizeText(input.name, { required: true })),
    phone: stripUnsafeMarkup(normalizeText(input.phone, { required: true })),
    email: stripUnsafeMarkup(normalizeText(input.email, { fallback: '' })),
    date: assertDate(input.date || defaults.date),
    startTime: assertTime(input.startTime || defaults.startTime),
    duration: toNumber(input.duration, defaults.duration || 0),
    totalDuration: toNumber(input.totalDuration, defaults.totalDuration || input.duration || 0),
    lanes: normalizeLaneArray(input.lanes, laneCountBound),
    pax: Math.max(1, Math.trunc(toNumber(input.pax, defaults.pax || 1))),
    status: VALID_STATUSES.has(input.status) ? input.status : defaults.status || 'pending',
    basePrice: toNumber(input.basePrice, defaults.basePrice || 0),
    price: toNumber(input.price, defaults.price || 0),
    type,
    formuleId: normalizeText(input.formuleId, { fallback: defaults.formuleId || '' }) || null,
    label: normalizeText(input.label, { fallback: defaults.label || 'Bowling Classique' }) || 'Bowling Classique',
    extras: normalizeExtras(input.extras ?? defaults.extras),
    paymentMethod: normalizeText(input.paymentMethod, { fallback: defaults.paymentMethod || '' }) || null,
    notes: normalizeText(input.notes, { fallback: defaults.notes || '' }),
    opsPlan: input.opsPlan ?? input.ops_plan ?? defaults.opsPlan ?? null,
    riskLevel: normalizeText(input.riskLevel || input.risk_level, { fallback: defaults.riskLevel || '' }) || null,
    riskScore: input.riskScore ?? input.risk_score ?? defaults.riskScore ?? null,
    validationStatus: VALID_VALIDATION_STATUSES.has(input.validationStatus || input.validation_status)
      ? input.validationStatus || input.validation_status
      : defaults.validationStatus || 'confirmed',
    laneCount: Math.max(0, Math.trunc(toNumber(input.laneCount, defaults.laneCount ?? (Array.isArray(input.lanes) ? input.lanes.length : 0)))),
    requiresLanes: Boolean(input.requiresLanes ?? defaults.requiresLanes),
  };

  if (payload.duration <= 0) throw new Error('Durée invalide.');
  if (payload.type !== 'formule') payload.formuleId = null;
  if (payload.type === 'laser') {
    payload.laneCount = 0;
    payload.lanes = [];
    payload.requiresLanes = false;
  }
  if (payload.totalDuration <= 0) payload.totalDuration = payload.duration;
  if (reservationNeedsLanes(payload) && !payload.laneCount) {
    payload.laneCount = Math.max(1, Math.ceil(payload.pax / normalCapacityPerLane));
  }
  if (!reservationNeedsLanes(payload)) {
    payload.laneCount = 0;
    payload.lanes = [];
  }

  return payload;
}

function mapReservation(row) {
  const rawDate = row.date;
  const normalizedDate =
    rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : String(rawDate || '').slice(0, 10);

  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    date: normalizedDate,
    startTime: String(row.start_time || '').slice(0, 5),
    duration: toNumber(row.duration, 0),
    totalDuration: toNumber(row.total_duration, toNumber(row.duration, 0)),
    lanes: Array.isArray(row.lanes) ? row.lanes.map(Number) : [],
    pax: Number(row.pax || 0),
    status: row.status || 'pending',
    basePrice: toNumber(row.base_price, 0),
    price: toNumber(row.price, 0),
    type: row.type || 'bowling',
    formuleId: row.formule_id || '',
    label: row.label || 'Bowling Classique',
    extras: Array.isArray(row.extras) ? row.extras : [],
    paymentMethod: row.payment_method || '',
    notes: row.notes || '',
    channel: row.channel || 'staff',
    centerId: row.center_id || 'libramont',
    opsPlan: row.ops_plan || null,
    riskLevel: row.risk_level || '',
    riskScore: row.risk_score === null || row.risk_score === undefined ? null : Number(row.risk_score),
    validationStatus: row.validation_status || 'confirmed',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOpsEvent(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id || 'libramont',
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    formulaId: row.formula_id || '',
    activityId: row.activity_id || '',
    eventType: row.event_type,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    plannedMinutes: toNumber(row.planned_minutes, 0),
    actualMinutes: toNumber(row.actual_minutes, 0),
    reasonId: row.reason_id || '',
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

function mapCommunication(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id || 'libramont',
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    channel: row.channel,
    direction: row.direction || 'outbound',
    templateId: row.template_id || '',
    recipient: row.recipient || '',
    subject: row.subject || '',
    body: row.body || '',
    status: row.status || 'draft',
    providerMessageId: row.provider_message_id || '',
    idempotencyKey: row.idempotency_key || '',
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 3),
    priority: Number(row.priority || 50),
    lastError: row.last_error || '',
    scheduledAt: row.scheduled_at,
    nextRetryAt: row.next_retry_at,
    lockedAt: row.locked_at,
    sentAt: row.sent_at,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

function mapOpsJob(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id || 'libramont',
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    jobType: row.job_type,
    status: row.status || 'queued',
    priority: Number(row.priority || 50),
    runAt: row.run_at,
    lockedAt: row.locked_at,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 5),
    idempotencyKey: row.idempotency_key || '',
    payload: row.payload || {},
    result: row.result || {},
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function mapWorkerRun(row) {
  return {
    id: Number(row.id),
    workerName: row.worker_name || 'ops-worker',
    taskName: row.task_name || '',
    status: row.status || 'running',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: Number(row.duration_ms || 0),
    checkedCount: Number(row.checked_count || 0),
    result: row.result || {},
    error: row.error || '',
  };
}

function mapDelayIncident(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id || 'libramont',
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    delayMinutes: Number(row.delay_minutes || 0),
    reason: row.reason || '',
    status: row.status || 'proposed',
    previousStartTime: row.previous_start_time || '',
    proposedStartTime: row.proposed_start_time || '',
    impact: row.impact || {},
    communications: row.communications || {},
    idempotencyKey: row.idempotency_key || '',
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

function mapLaneStatusRows(rows) {
  return rows.reduce((accumulator, row) => {
    accumulator[Number(row.lane_number)] = row.status;
    return accumulator;
  }, {});
}

function buildStaffRevision(date, reservations, laneRows) {
  let latestTimestamp = 0;
  const reservationParts = reservations.map((reservation) => {
    const updatedAt = reservation.updatedAt ? new Date(reservation.updatedAt).getTime() : 0;
    if (updatedAt > latestTimestamp) latestTimestamp = updatedAt;
    return [
      reservation.id,
      reservation.status,
      reservation.startTime,
      reservation.duration,
      (reservation.lanes || []).join('-'),
      reservation.price,
      reservation.paymentMethod || '',
      updatedAt,
    ].join(':');
  });
  const laneParts = laneRows.map((row) => {
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (updatedAt > latestTimestamp) latestTimestamp = updatedAt;
    return `${Number(row.lane_number)}:${row.status}:${updatedAt}`;
  });
  return [date, latestTimestamp, reservationParts.join('|'), laneParts.join('|')].join('::');
}

async function lockDate(client, date, centerId = 'libramont') {
  await client.query('select pg_advisory_xact_lock(hashtext($1));', [`fungalaxy:${centerId}:${date}`]);
}

async function listReservationsForDate(client, date, ignoreId = null, centerId = 'libramont') {
  const values = [date, centerId];
  let sql = `
    select *
    from reservations
    where date = $1
      and center_id = $2
      and status <> 'cancelled'
  `;

  if (ignoreId) {
    values.push(ignoreId);
    sql += ' and id <> $3';
  }

  sql += ' order by start_time asc, id asc';
  const result = await client.query(sql, values);
  return result.rows.map(mapReservation);
}

async function getLaneStatusMap(client, centerId = 'libramont') {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const laneStatuses = mapLaneStatusRows(await readLaneStatusRows(client, safeCenterId));
  const laneCount = resolveCenterLaneCount(safeCenterId);
  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!laneStatuses[lane]) laneStatuses[lane] = 'active';
  }
  return laneStatuses;
}

function isMissingCenterLaneStatusColumn(error) {
  return error && error.code === '42703' && String(error.message || '').includes('center_id');
}

async function readLaneStatusRows(client, centerId = 'libramont', options = {}) {
  const columns = options.includeUpdatedAt ? 'lane_number, status, updated_at' : 'lane_number, status';
  try {
    const result = await client.query(
      `
        select ${columns}
        from lane_statuses
        where center_id = $1
        order by lane_number asc;
      `,
      [normalizeText(centerId, { fallback: 'libramont' })],
    );
    return result.rows;
  } catch (error) {
    if (!isMissingCenterLaneStatusColumn(error)) throw error;
    const result = await client.query(`
      select ${columns}
      from lane_statuses
      order by lane_number asc;
    `);
    return result.rows;
  }
}

function getOccupiedLanes(reservations, startTime, duration) {
  const occupied = new Set();
  const requestedStart = timeToNum(startTime);
  reservations.forEach((reservation) => {
    laneWindowsFromReservation(reservation).forEach((window) => {
      if (overlap(requestedStart, duration, window.start, window.duration)) {
        window.lanes.forEach((lane) => occupied.add(Number(lane)));
      }
    });
  });
  return occupied;
}

function allocateLanes(requiredCount, reservations, laneStatuses, startTime, duration, laneCount = TOTAL_LANES) {
  if (!requiredCount) return [];

  const occupied = getOccupiedLanes(reservations, startTime, duration);
  const available = [];
  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!occupied.has(lane) && laneStatuses[lane] !== 'maintenance') {
      available.push(lane);
    }
  }

  if (available.length < requiredCount) return null;

  if (requiredCount === 1) {
    for (const pair of PAIRS) {
      if (available.includes(pair[0]) && !available.includes(pair[1])) return [pair[0]];
      if (!available.includes(pair[0]) && available.includes(pair[1])) return [pair[1]];
    }
    return [available[0]];
  }

  if (requiredCount === 2) {
    for (const pair of PAIRS) {
      if (available.includes(pair[0]) && available.includes(pair[1])) return [...pair];
    }
  }

  for (let index = 0; index <= available.length - requiredCount; index += 1) {
    const group = [available[index]];
    let contiguous = true;
    for (let offset = 1; offset < requiredCount; offset += 1) {
      if (available[index + offset] === group[group.length - 1] + 1) {
        group.push(available[index + offset]);
      } else {
        contiguous = false;
        break;
      }
    }
    if (contiguous) return group;
  }

  return available.slice(0, requiredCount);
}

function lanesConflict(reservations, startTime, duration, lanes, opsPlan = null, maxLane = TOTAL_LANES) {
  if (!lanes.length) return [];
  const candidateWindows = laneWindowsFromCandidate(startTime, duration, lanes, opsPlan, maxLane);
  return reservations.filter(
    (reservation) => candidateWindows.some((candidate) =>
      laneWindowsFromReservation(reservation).some((existing) =>
        overlap(candidate.start, candidate.duration, existing.start, existing.duration)
        && existing.lanes.some((lane) => candidate.lanes.includes(Number(lane))),
      ),
    ),
  );
}

function ensureAssignableLanes(payload, reservations, laneStatuses) {
  if (!reservationNeedsLanes(payload)) {
    return [];
  }

  const requiredCount = payload.laneCount || payload.lanes.length;
  if (!requiredCount) return [];

  const laneCount = resolveCenterLaneCount(payload.centerId);
  const requestedLanes = normalizeLaneArray(payload.lanes, laneCount);
  const requestedAreUsable =
    requestedLanes.length === requiredCount &&
    requestedLanes.every((lane) => laneStatuses[lane] !== 'maintenance') &&
    lanesConflict(reservations, payload.startTime, payload.duration, requestedLanes, payload.opsPlan, laneCount).length === 0;

  if (requestedAreUsable) {
    return requestedLanes;
  }

  if (laneWindowsFromOpsPlan(payload.opsPlan, requestedLanes, laneCount).length) {
    throw new Error('Ce créneau vient de changer. Merci de relancer la recherche avant de confirmer.');
  }

  const allocated = allocateLanes(requiredCount, reservations, laneStatuses, payload.startTime, payload.duration, laneCount);
  if (!allocated || allocated.length < requiredCount) {
    throw new Error(`Aucune piste disponible pour ${requiredCount} piste(s) sur ce créneau.`);
  }

  return allocated;
}

// Règle métier : toute heure d'ENTRÉE choisie par le client tombe sur une
// heure pleine ou demie (15:00, 15:30 — jamais 15:15). Le refus est appliqué
// ici, à la validation/création : la disponibilité ne fait que proposer,
// cette garde fait foi même face à un payload forgé.
// - FORMULE : startTime = début exact de la PREMIÈRE activité du programme
//   (bowling, laser, minigolf…) → doit être :00/:30.
// - BOWLING : chaque fenêtre de piste occupée (blocs opsPlan, ou fallback
//   startTime/duration sans plan) doit démarrer :00/:30, même au milieu
//   d'un programme.
// Les décalages staff (updateReservation) restent volontairement libres.
const PROGRAM_GRID_MINUTES = 30;

function formatGridMinutes(startMinutes) {
  const hours = String(Math.floor(startMinutes / 60)).padStart(2, '0');
  const minutes = String(startMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function ensureProgramStartAlignment(payload) {
  if (payload.type === 'formule') {
    const startMinutes = Math.round(timeToNum(payload.startTime) * 60);
    if (startMinutes % PROGRAM_GRID_MINUTES !== 0) {
      const error = new Error(`Une formule démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30) — départ ${formatGridMinutes(startMinutes)} refusé.`);
      error.expose = true;
      throw error;
    }
  }
  if (!reservationNeedsLanes(payload)) return;
  laneWindowsFromReservation(payload).forEach((window) => {
    const startMinutes = Math.round(Number(window.start || 0) * 60);
    if (startMinutes % PROGRAM_GRID_MINUTES !== 0) {
      const error = new Error(`Le bowling démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30) — départ ${formatGridMinutes(startMinutes)} refusé.`);
      error.expose = true;
      throw error;
    }
  });
}

function validateReservationResources(input, reservations = [], laneStatuses = {}) {
  const payload = normalizeReservationPayload(input, { channel: input.channel || 'public' });
  ensureProgramStartAlignment(payload);
  const lanes = ensureAssignableLanes(payload, reservations, laneStatuses);
  ensureLaserCapacity({ ...payload, lanes }, reservations);
  return {
    ok: true,
    lanes,
    payload: { ...payload, lanes },
  };
}

async function createReservation(input) {
  return withTransaction(async (client) => {
    const payload = normalizeReservationPayload(input, { channel: input.channel || 'public' });
    // Refuse toute nouvelle réservation sur un centre non ouvert (ex. Ciney
    // "Prévu", sans pistes/armes réelles) : sinon on allouerait des ressources
    // fantômes (fallback 8 pistes / 30 armes) sur un site qui n'existe pas
    // physiquement → corruption des données opérationnelles.
    const centerStatus = String(getCenter(payload.centerId)?.status || 'active').toLowerCase();
    if (centerStatus !== 'active') {
      const error = new Error("Ce centre n'est pas encore ouvert aux réservations.");
      error.expose = true;
      throw error;
    }
    ensureProgramStartAlignment(payload);
    await lockDate(client, payload.date, payload.centerId);
    const reservations = await listReservationsForDate(client, payload.date, null, payload.centerId);
    const laneStatuses = await getLaneStatusMap(client, payload.centerId);
    const lanes = ensureAssignableLanes(payload, reservations, laneStatuses);
    ensureLaserCapacity(payload, reservations);

    const result = await client.query(
      `
        insert into reservations (
          center_id,
          channel,
          name,
          phone,
          email,
          date,
          start_time,
          duration,
          total_duration,
          lanes,
          pax,
          status,
          base_price,
          price,
          type,
          formule_id,
          label,
          extras,
          payment_method,
          notes,
          ops_plan,
          risk_level,
          risk_score,
          validation_status
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int[],$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21::jsonb,$22,$23,$24
        )
        returning *;
      `,
      [
        payload.centerId,
        payload.channel,
        payload.name,
        payload.phone,
        payload.email,
        payload.date,
        payload.startTime,
        payload.duration,
        payload.totalDuration,
        lanes,
        payload.pax,
        payload.status,
        payload.basePrice,
        payload.price,
        payload.type,
        payload.formuleId,
        payload.label,
        JSON.stringify(payload.extras),
        payload.paymentMethod,
        payload.notes,
        payload.opsPlan ? JSON.stringify(payload.opsPlan) : null,
        payload.riskLevel,
        payload.riskScore,
        payload.validationStatus,
      ],
    );

    return mapReservation(result.rows[0]);
  });
}

async function updateReservation(input) {
  if (!input || !input.id) {
    throw new Error('Reservation introuvable.');
  }

  return withTransaction(async (client) => {
    const currentResult = await client.query('select * from reservations where id = $1 limit 1;', [Number(input.id)]);
    if (!currentResult.rowCount) {
      throw new Error('Reservation inexistante.');
    }

    const current = mapReservation(currentResult.rows[0]);
    const payload = normalizeReservationPayload(input, current);
    await lockDate(client, payload.date, payload.centerId);
    const reservations = await listReservationsForDate(client, payload.date, payload.id, payload.centerId);
    const laneStatuses = await getLaneStatusMap(client, payload.centerId);
    const lanes = ensureAssignableLanes(payload, reservations, laneStatuses);
    ensureLaserCapacity(payload, reservations);

    const result = await client.query(
      `
        update reservations
        set
          center_id = $2,
          channel = $3,
          name = $4,
          phone = $5,
          email = $6,
          date = $7,
          start_time = $8,
          duration = $9,
          total_duration = $10,
          lanes = $11::int[],
          pax = $12,
          status = $13,
          base_price = $14,
          price = $15,
          type = $16,
          formule_id = $17,
          label = $18,
          extras = $19::jsonb,
          payment_method = $20,
          notes = $21,
          ops_plan = $22::jsonb,
          risk_level = $23,
          risk_score = $24,
          validation_status = $25,
          updated_at = now()
        where id = $1
        returning *;
      `,
      [
        payload.id,
        payload.centerId,
        payload.channel,
        payload.name,
        payload.phone,
        payload.email,
        payload.date,
        payload.startTime,
        payload.duration,
        payload.totalDuration,
        lanes,
        payload.pax,
        payload.status,
        payload.basePrice,
        payload.price,
        payload.type,
        payload.formuleId,
        payload.label,
        JSON.stringify(payload.extras),
        payload.paymentMethod,
        payload.notes,
        payload.opsPlan ? JSON.stringify(payload.opsPlan) : null,
        payload.riskLevel,
        payload.riskScore,
        payload.validationStatus,
      ],
    );

    return mapReservation(result.rows[0]);
  });
}

async function getReservationById(id) {
  if (!id) throw new Error('Reservation introuvable.');
  const result = await getPool().query('select * from reservations where id = $1 limit 1;', [Number(id)]);
  if (!result.rowCount) return null;
  return mapReservation(result.rows[0]);
}

async function deleteReservation(id) {
  if (!id) throw new Error('Reservation introuvable.');
  return withTransaction(async (client) => {
    const existing = await client.query('select id, date, center_id from reservations where id = $1 limit 1;', [Number(id)]);
    if (!existing.rowCount) {
      return { ok: true };
    }
    await lockDate(client, existing.rows[0].date, existing.rows[0].center_id || 'libramont');
    await client.query('delete from reservations where id = $1;', [Number(id)]);
    return { ok: true };
  });
}

async function readStaffState(date, centerId = 'libramont') {
  const safeDate = assertDate(date);
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const client = await getPool().connect();
  try {
    const [reservationResult, laneRows] = await Promise.all([
      client.query(
        `
          select *
          from reservations
          where date = $1
            and center_id = $2
            and status <> 'cancelled'
          order by start_time asc, id asc;
        `,
        [safeDate, safeCenterId],
      ),
      readLaneStatusRows(client, safeCenterId, { includeUpdatedAt: true }),
    ]);

    const reservations = reservationResult.rows.map(mapReservation);
    const revision = buildStaffRevision(safeDate, reservations, laneRows);

    return {
      date: safeDate,
      centerId: safeCenterId,
      reservations,
      laneStatuses: mapLaneStatusRows(laneRows),
      revision,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}

async function readAdminRangeState(startDate, endDate, centerId = 'libramont') {
  const safeStartDate = assertDate(startDate);
  const safeEndDate = assertDate(endDate);
  if (safeEndDate < safeStartDate) {
    throw new Error('Periode invalide.');
  }
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const client = await getPool().connect();
  try {
    const [reservationResult, laneRows] = await Promise.all([
      client.query(
        `
          select *
          from reservations
          where date >= $1
            and date <= $2
            and center_id = $3
          order by date asc, start_time asc, id asc;
        `,
        [safeStartDate, safeEndDate, safeCenterId],
      ),
      readLaneStatusRows(client, safeCenterId, { includeUpdatedAt: true }),
    ]);

    const reservations = reservationResult.rows.map(mapReservation);
    const revision = buildStaffRevision(`${safeStartDate}:${safeEndDate}`, reservations, laneRows);

    return {
      startDate: safeStartDate,
      endDate: safeEndDate,
      centerId: safeCenterId,
      reservations,
      laneStatuses: mapLaneStatusRows(laneRows),
      revision,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}

async function readAvailabilitySnapshot(date, centerId = 'libramont') {
  const safeDate = assertDate(date);
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const client = await getPool().connect();
  try {
    const [reservationResult, laneRows] = await Promise.all([
      client.query(
        `
          select *
          from reservations
          where date = $1
            and center_id = $2
            and status <> 'cancelled'
          order by start_time asc, id asc;
        `,
        [safeDate, safeCenterId],
      ),
      readLaneStatusRows(client, safeCenterId),
    ]);

    return {
      date: safeDate,
      centerId: safeCenterId,
      reservations: reservationResult.rows.map(mapReservation),
      laneStatuses: mapLaneStatusRows(laneRows),
    };
  } finally {
    client.release();
  }
}

async function updateLaneStatus(lane, status, centerId = 'libramont') {
  const laneNumber = Number(lane);
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  if (!Number.isInteger(laneNumber) || laneNumber < 1 || laneNumber > resolveCenterLaneCount(safeCenterId)) {
    throw new Error('Numero de piste invalide.');
  }
  if (!VALID_LANE_STATUSES.has(status)) {
    throw new Error('Statut de piste invalide.');
  }

  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1));', [`fungalaxy:${safeCenterId}:lane:${laneNumber}`]);
    let result;
    try {
      result = await client.query(
        `
          insert into lane_statuses (center_id, lane_number, status, updated_at)
          values ($1, $2, $3, now())
          on conflict (center_id, lane_number)
          do update set status = excluded.status, updated_at = now()
          returning center_id, lane_number, status, updated_at;
        `,
        [safeCenterId, laneNumber, status],
      );
    } catch (error) {
      if (!isMissingCenterLaneStatusColumn(error)) throw error;
      result = await client.query(
        `
          insert into lane_statuses (lane_number, status, updated_at)
          values ($1, $2, now())
          on conflict (lane_number)
          do update set status = excluded.status, updated_at = now()
          returning lane_number, status, updated_at;
        `,
        [laneNumber, status],
      );
      result.rows[0].center_id = safeCenterId;
    }
    return {
      centerId: result.rows[0].center_id,
      lane: Number(result.rows[0].lane_number),
      status: result.rows[0].status,
      updatedAt: result.rows[0].updated_at,
    };
  });
}

function mapSimulationRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    centerId: row.center_id,
    simDate: String(row.sim_date || '').slice(0, 10),
    scenario: row.scenario,
    status: row.status,
    stepIndex: Number(row.step_index || 0),
    totalSteps: Number(row.total_steps || 0),
    speedFactor: Number(row.speed_factor || 0),
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function mapDecisionLog(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id,
    runId: row.run_id || '',
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    agentId: row.agent_id,
    decisionType: row.decision_type,
    severity: row.severity,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

async function createSimulationRun(input) {
  await ensureSimulationSchema();
  const result = await getPool().query(
    `
      insert into ops_simulation_runs (
        id,
        center_id,
        sim_date,
        scenario,
        status,
        step_index,
        total_steps,
        speed_factor,
        payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      returning *;
    `,
    [
      normalizeText(input.id, { required: true }),
      normalizeText(input.centerId, { fallback: 'libramont' }),
      assertDate(input.simDate || input.date),
      normalizeText(input.scenario, { fallback: 'rush_day' }),
      normalizeText(input.status, { fallback: 'running' }),
      Math.max(0, Math.trunc(toNumber(input.stepIndex, 0))),
      Math.max(0, Math.trunc(toNumber(input.totalSteps, 0))),
      Math.max(1, Math.trunc(toNumber(input.speedFactor, 90))),
      JSON.stringify(input.payload || {}),
    ],
  );
  return mapSimulationRun(result.rows[0]);
}

async function getSimulationRun(runId) {
  await ensureSimulationSchema();
  const result = await getPool().query('select * from ops_simulation_runs where id = $1 limit 1;', [normalizeText(runId, { required: true })]);
  return mapSimulationRun(result.rows[0]);
}

async function getLatestSimulationRun({ centerId = 'libramont', date = null } = {}) {
  await ensureSimulationSchema();
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const values = [safeCenterId];
  let sql = 'select * from ops_simulation_runs where center_id = $1';
  if (date) {
    values.push(assertDate(date));
    sql += ' and sim_date = $2';
  }
  sql += ' order by created_at desc limit 1;';
  const result = await getPool().query(sql, values);
  return mapSimulationRun(result.rows[0]);
}

async function updateSimulationRun(runId, patch = {}) {
  await ensureSimulationSchema();
  const current = await getSimulationRun(runId);
  if (!current) throw new Error('Simulation introuvable.');
  const payload = patch.payload || current.payload || {};
  const result = await getPool().query(
    `
      update ops_simulation_runs
      set
        status = $2,
        step_index = $3,
        total_steps = $4,
        payload = $5::jsonb,
        finished_at = case when $2 in ('finished', 'failed', 'cancelled') then coalesce(finished_at, now()) else finished_at end
      where id = $1
      returning *;
    `,
    [
      current.id,
      normalizeText(patch.status, { fallback: current.status }),
      Math.max(0, Math.trunc(toNumber(patch.stepIndex, current.stepIndex))),
      Math.max(0, Math.trunc(toNumber(patch.totalSteps, current.totalSteps))),
      JSON.stringify(payload),
    ],
  );
  return mapSimulationRun(result.rows[0]);
}

async function createDecisionLog(input) {
  await ensureSimulationSchema();
  const result = await getPool().query(
    `
      insert into ops_decision_logs (
        center_id,
        run_id,
        reservation_id,
        agent_id,
        decision_type,
        severity,
        payload
      ) values ($1,$2,$3,$4,$5,$6,$7::jsonb)
      returning *;
    `,
    [
      normalizeText(input.centerId, { fallback: 'libramont' }),
      normalizeText(input.runId, { fallback: '' }) || null,
      input.reservationId ? Number(input.reservationId) : null,
      normalizeText(input.agentId, { required: true }),
      normalizeText(input.decisionType, { required: true }),
      normalizeText(input.severity, { fallback: 'info' }),
      JSON.stringify(input.payload || {}),
    ],
  );
  return mapDecisionLog(result.rows[0]);
}

async function listDecisionLogs({ centerId = 'libramont', runId = '', limit = 200 } = {}) {
  await ensureSimulationSchema();
  const values = [normalizeText(centerId, { fallback: 'libramont' }), Math.min(Math.max(Number(limit) || 200, 1), 1000)];
  let sql = `
    select *
    from ops_decision_logs
    where center_id = $1
  `;
  if (runId) {
    values.push(normalizeText(runId, { fallback: '' }));
    sql += ` and run_id = $3`;
  }
  sql += ` order by created_at desc limit $2;`;
  const result = await getPool().query(sql, values);
  return result.rows.map(mapDecisionLog);
}

async function deleteSimulationData({ centerId = 'libramont', runId = '' } = {}) {
  await ensureSimulationSchema();
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeRunId = normalizeText(runId, { fallback: '' });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const params = [safeCenterId];
    let runClause = '';
    if (safeRunId) {
      params.push(safeRunId);
      runClause = 'and coalesce(payload->>\'simulationRunId\', run_id, \'\') = $2';
    }
    const communicationResult = await client.query(
      `
        delete from communications
        where center_id = $1
          and (
            payload->>'simulation' = 'true'
            ${safeRunId ? "and payload->>'simulationRunId' = $2" : ''}
          );
      `,
      params,
    );
    const eventResult = await client.query(
      `
        delete from ops_events
        where center_id = $1
          and payload->>'simulation' = 'true'
          ${safeRunId ? "and payload->>'simulationRunId' = $2" : ''};
      `,
      params,
    );
    const suggestionResult = await client.query(
      `
        delete from ops_agent_suggestions
        where center_id = $1
          and payload->>'simulation' = 'true'
          ${safeRunId ? "and payload->>'simulationRunId' = $2" : ''};
      `,
      params,
    );
    const reservationResult = await client.query(
      `
        delete from reservations
        where center_id = $1
          and (
            channel in ('sim-client', 'sim-staff')
            or notes like '[SIM:%'
          )
          ${safeRunId ? "and notes like ('[SIM:' || $2 || ']%')" : ''};
      `,
      params,
    );
    const logResult = await client.query(
      `
        delete from ops_decision_logs
        where center_id = $1
          and payload->>'simulation' = 'true'
          and coalesce(run_id, '') <> ''
          ${safeRunId ? 'and run_id = $2' : `
          and run_id in (
            select id
            from ops_simulation_runs
            where center_id = $1
          )`};
      `,
      params,
    );
    const runResult = await client.query(
      `
        delete from ops_simulation_runs
        where center_id = $1
          ${safeRunId ? 'and id = $2' : ''};
      `,
      params,
    );
    await client.query('COMMIT');
    return {
      ok: true,
      deleted: {
        communications: communicationResult.rowCount || 0,
        events: eventResult.rowCount || 0,
        suggestions: suggestionResult.rowCount || 0,
        reservations: reservationResult.rowCount || 0,
        decisionLogs: logResult.rowCount || 0,
        runs: runResult.rowCount || 0,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createOpsEvent(input) {
  const centerId = normalizeText(input.centerId || input.center_id, { fallback: 'libramont' });
  const eventType = normalizeText(input.eventType || input.event_type, { required: true });
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};

  const result = await getPool().query(
    `
      insert into ops_events (
        center_id,
        reservation_id,
        formula_id,
        activity_id,
        event_type,
        planned_start,
        planned_end,
        actual_start,
        actual_end,
        planned_minutes,
        actual_minutes,
        reason_id,
        payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      returning *;
    `,
    [
      centerId,
      input.reservationId || input.reservation_id || null,
      normalizeText(input.formulaId || input.formula_id, { fallback: '' }) || null,
      normalizeText(input.activityId || input.activity_id, { fallback: '' }) || null,
      eventType,
      input.plannedStart || input.planned_start || null,
      input.plannedEnd || input.planned_end || null,
      input.actualStart || input.actual_start || null,
      input.actualEnd || input.actual_end || null,
      input.plannedMinutes ?? input.planned_minutes ?? null,
      input.actualMinutes ?? input.actual_minutes ?? null,
      normalizeText(input.reasonId || input.reason_id, { fallback: '' }) || null,
      JSON.stringify(payload),
    ],
  );

  return mapOpsEvent(result.rows[0]);
}

async function listOpsEvents({ centerId = 'libramont', limit = 500, since = null } = {}) {
  const values = [normalizeText(centerId, { fallback: 'libramont' }), Math.min(Math.max(Number(limit) || 500, 1), 2000)];
  let sql = `
    select *
    from ops_events
    where center_id = $1
  `;
  if (since) {
    values.push(since);
    sql += ` and created_at >= $3`;
  }
  sql += ` order by created_at desc limit $2;`;
  const result = await getPool().query(sql, values);
  return result.rows.map(mapOpsEvent);
}

async function saveAgentSuggestions(suggestions = []) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];
  const saved = [];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const suggestion of suggestions) {
      const centerId = normalizeText(suggestion.centerId, { fallback: 'libramont' });
      const suggestionType = normalizeText(suggestion.suggestionType, { fallback: 'duration_adjustment' });
      const dedupeKey = normalizeText(suggestion.dedupeKey, {
        fallback: [
          centerId,
          suggestionType,
          suggestion.formulaId || suggestion.payload?.formulaId || '',
          suggestion.activityId || suggestion.payload?.activityId || '',
          suggestion.recommendedAdjustmentMinutes ?? suggestion.payload?.recommendedAdjustmentMinutes ?? '',
        ].join(':'),
      });
      const result = await client.query(
        `
          insert into ops_agent_suggestions (
            center_id,
            agent_id,
            suggestion_type,
            dedupe_key,
            severity,
            confidence,
            payload
          ) values ($1,$2,$3,$4,$5,$6,$7::jsonb)
          on conflict (dedupe_key)
          where dedupe_key is not null
          do update set
            severity = excluded.severity,
            confidence = greatest(ops_agent_suggestions.confidence, excluded.confidence),
            payload = excluded.payload,
            status = case when ops_agent_suggestions.status = 'rejected' then 'rejected' else 'pending' end
          returning *;
        `,
        [
          centerId,
          normalizeText(suggestion.agentId, { fallback: 'learning-agent' }),
          suggestionType,
          dedupeKey,
          normalizeText(suggestion.severity, { fallback: 'medium' }),
          toNumber(suggestion.confidence, 0),
          JSON.stringify(suggestion),
        ],
      );
      saved.push(result.rows[0]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return saved;
}

async function listAgentSuggestions({ centerId = 'libramont', status = 'pending', limit = 100 } = {}) {
  const values = [
    normalizeText(centerId, { fallback: 'libramont' }),
    normalizeText(status, { fallback: 'pending' }),
    Math.min(Math.max(Number(limit) || 100, 1), 500),
  ];
  const result = await getPool().query(
    `
      select *
      from ops_agent_suggestions
      where center_id = $1
        and status = $2
      order by confidence desc, created_at desc
      limit $3;
    `,
    values,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    centerId: row.center_id,
    agentId: row.agent_id,
    suggestionType: row.suggestion_type,
    dedupeKey: row.dedupe_key || '',
    severity: row.severity,
    status: row.status,
    confidence: toNumber(row.confidence, 0),
    payload: row.payload || {},
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by || '',
  }));
}

async function createCommunication(input) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const idempotencyKey = normalizeText(input.idempotencyKey || input.idempotency_key, { fallback: '' }) || null;
  const simulationCommunication = isSimulationCommunicationInput(input, payload, idempotencyKey);
  const values = [
    normalizeText(input.centerId || input.center_id, { fallback: 'libramont' }),
    input.reservationId || input.reservation_id || null,
    normalizeText(input.channel, { required: true }),
    normalizeText(input.direction, { fallback: 'outbound' }),
    normalizeText(input.templateId || input.template_id, { fallback: '' }) || null,
    normalizeText(input.recipient, { fallback: '' }),
    normalizeText(input.subject, { fallback: '' }),
    normalizeText(input.body, { fallback: '' }),
    simulationCommunication ? 'draft' : normalizeText(input.status, { fallback: 'queued' }),
    input.scheduledAt || input.scheduled_at || null,
    JSON.stringify(payload),
    idempotencyKey,
  ];

  const result = await getPool().query(
    `
      insert into communications (
        center_id,
        reservation_id,
        channel,
        direction,
        template_id,
        recipient,
        subject,
        body,
        status,
        scheduled_at,
        payload,
        idempotency_key
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
      on conflict (idempotency_key)
      where idempotency_key is not null
      do update set
        recipient = case
          when communications.status in ('sent', 'delivered')
          then communications.recipient
          else excluded.recipient
        end,
        subject = case
          when communications.status in ('sent', 'delivered')
          then communications.subject
          else excluded.subject
        end,
        body = case
          when communications.status in ('sent', 'delivered')
          then communications.body
          else excluded.body
        end,
        scheduled_at = case
          when communications.status in ('sent', 'delivered')
          then communications.scheduled_at
          else excluded.scheduled_at
        end,
        payload = case
          when communications.status in ('sent', 'delivered')
          then communications.payload
          else excluded.payload
        end,
        status = case
          when excluded.payload->>'simulation' = 'true'
            or coalesce(excluded.payload->>'simulationRunId', '') <> ''
            or coalesce(excluded.idempotency_key, '') like 'simulation:%'
          then 'draft'
          when communications.status in ('sent', 'delivered')
          then communications.status
          when communications.status in ('cancelled', 'failed', 'queued', 'processing', 'draft')
          then excluded.status
          else communications.status
        end,
        locked_at = case
          when excluded.payload->>'simulation' = 'true'
            or coalesce(excluded.payload->>'simulationRunId', '') <> ''
            or coalesce(excluded.idempotency_key, '') like 'simulation:%'
          then null
          when communications.status in ('sent', 'delivered')
          then communications.locked_at
          else null
        end,
        last_error = case
          when communications.status in ('sent', 'delivered')
          then communications.last_error
          else null
        end,
        next_retry_at = case
          when communications.status in ('sent', 'delivered')
          then communications.next_retry_at
          else null
        end
      returning *;
    `,
    values,
  );

  return mapCommunication(result.rows[0]);
}

async function listDueCommunications({
  limit = 25,
  staleAfterMinutes = 10,
  centerId = '',
  reservationId = null,
} = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: '' });
  const safeReservationId = Number.isInteger(Number(reservationId)) && Number(reservationId) > 0
    ? Number(reservationId)
    : null;
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        with due as (
          select id
          from communications
          where (
              status = 'queued'
              or (
                status = 'processing'
                and locked_at is not null
                and locked_at < now() - ($2::int * interval '1 minute')
              )
            )
            and (scheduled_at is null or scheduled_at <= now())
            and (next_retry_at is null or next_retry_at <= now())
            and coalesce(payload->>'simulation', 'false') <> 'true'
            and coalesce(payload->>'simulationRunId', '') = ''
            and coalesce(idempotency_key, '') not like 'simulation:%'
            and ($3 = '' or center_id = $3)
            and ($4::int is null or reservation_id = $4::int)
          order by coalesce(next_retry_at, scheduled_at, created_at) asc, priority desc, id asc
          limit $1
          for update skip locked
        )
        update communications communication
        set
          status = 'processing',
          locked_at = now(),
          last_error = case
            when communication.status = 'processing' then communication.last_error
            else null
          end
        from due
        where communication.id = due.id
        returning communication.*;
      `,
      [
        Math.min(Math.max(Number(limit) || 25, 1), 100),
        Math.min(Math.max(Number(staleAfterMinutes) || 10, 1), 120),
        safeCenterId,
        safeReservationId,
      ],
    );
    return result.rows.map(mapCommunication);
  });
}

async function listCommunications({ centerId = 'libramont', status = '', limit = 100 } = {}) {
  const values = [
    normalizeText(centerId, { fallback: 'libramont' }),
    Math.min(Math.max(Number(limit) || 100, 1), 500),
  ];
  let sql = `
    select *
    from communications
    where center_id = $1
  `;

  if (status) {
    values.push(normalizeText(status, { fallback: '' }));
    sql += ` and status = $3`;
  }

  sql += ` order by created_at desc limit $2;`;
  const result = await getPool().query(sql, values);
  return result.rows.map(mapCommunication);
}

async function cancelReservationCommunications({ reservationId, centerId = 'libramont', reason = 'reservation_changed' } = {}) {
  const safeReservationId = Number(reservationId);
  if (!Number.isInteger(safeReservationId) || safeReservationId <= 0) return [];
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeReason = normalizeText(reason, { fallback: 'reservation_changed' });
  const result = await getPool().query(
    `
      update communications
      set
        status = 'cancelled',
        locked_at = null,
        next_retry_at = null,
        last_error = $3
      where reservation_id = $1
        and center_id = $2
        and status in ('draft', 'queued', 'processing')
      returning *;
    `,
    [safeReservationId, safeCenterId, safeReason],
  );
  return result.rows.map(mapCommunication);
}

async function updateCommunicationStatus(id, patch = {}) {
  const result = await getPool().query(
    `
      update communications
      set
        status = coalesce($2, status),
        provider_message_id = coalesce($3, provider_message_id),
        attempts = attempts + coalesce($4, 0),
        last_error = $5,
        locked_at = case
          when $2 = 'processing' then now()
          when $2 in ('draft', 'queued', 'sent', 'delivered', 'failed', 'cancelled') then null
          else locked_at
        end,
        sent_at = case when $2 in ('sent', 'delivered') then coalesce(sent_at, now()) else sent_at end,
        next_retry_at = $6,
        payload = coalesce($7::jsonb, payload)
      where id = $1
      returning *;
    `,
    [
      Number(id),
      patch.status || null,
      patch.providerMessageId || null,
      Number(patch.incrementAttempts || 0),
      patch.lastError || null,
      patch.nextRetryAt || patch.next_retry_at || null,
      patch.payload ? JSON.stringify(patch.payload) : null,
    ],
  );
  if (!result.rowCount) throw new Error('Communication introuvable.');
  return mapCommunication(result.rows[0]);
}

async function createOpsJob(input = {}) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const idempotencyKey = normalizeText(input.idempotencyKey || input.idempotency_key, { fallback: '' }) || null;
  const result = await getPool().query(
    `
      insert into ops_jobs (
        center_id,
        reservation_id,
        job_type,
        status,
        priority,
        run_at,
        max_attempts,
        idempotency_key,
        payload
      ) values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8,$9::jsonb)
      on conflict (idempotency_key)
      where idempotency_key is not null
      do update set
        center_id = excluded.center_id,
        reservation_id = excluded.reservation_id,
        priority = greatest(ops_jobs.priority, excluded.priority),
        run_at = excluded.run_at,
        max_attempts = greatest(ops_jobs.max_attempts, excluded.max_attempts),
        payload = excluded.payload,
        status = case
          when ops_jobs.status = 'done' then ops_jobs.status
          else excluded.status
        end,
        attempts = case when ops_jobs.status = 'done' then ops_jobs.attempts else 0 end,
        locked_at = case when ops_jobs.status = 'done' then ops_jobs.locked_at else null end,
        finished_at = case when ops_jobs.status = 'done' then ops_jobs.finished_at else null end,
        last_error = case when ops_jobs.status = 'done' then ops_jobs.last_error else null end,
        updated_at = now()
      returning *;
    `,
    [
      normalizeText(input.centerId || input.center_id, { fallback: 'libramont' }),
      input.reservationId || input.reservation_id || null,
      normalizeText(input.jobType || input.job_type, { required: true }),
      normalizeText(input.status, { fallback: 'queued' }),
      Math.min(Math.max(Number(input.priority || 50), 1), 100),
      input.runAt || input.run_at || null,
      Math.min(Math.max(Number(input.maxAttempts || input.max_attempts || 5), 1), 20),
      idempotencyKey,
      JSON.stringify(payload),
    ],
  );
  return mapOpsJob(result.rows[0]);
}

async function cancelReservationOpsJobs({ reservationId, centerId = 'libramont', reason = 'reservation_changed' } = {}) {
  const safeReservationId = Number(reservationId);
  if (!Number.isInteger(safeReservationId) || safeReservationId <= 0) return [];
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeReason = normalizeText(reason, { fallback: 'reservation_changed' });
  const result = await getPool().query(
    `
      update ops_jobs
      set
        status = 'cancelled',
        locked_at = null,
        last_error = $3,
        finished_at = coalesce(finished_at, now()),
        updated_at = now()
      where reservation_id = $1
        and center_id = $2
        and status in ('queued', 'processing')
      returning *;
    `,
    [safeReservationId, safeCenterId, safeReason],
  );
  return result.rows.map(mapOpsJob);
}

async function listDueOpsJobs({ limit = 25, staleAfterMinutes = 10, centerId = '' } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: '' });
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        with due as (
          select id
          from ops_jobs
          where (
              status = 'queued'
              or (
                status = 'processing'
                and locked_at is not null
                and locked_at < now() - ($2::int * interval '1 minute')
              )
            )
            and run_at <= now()
            and attempts < max_attempts
            and ($3 = '' or center_id = $3)
          order by run_at asc, priority desc, id asc
          limit $1
          for update skip locked
        )
        update ops_jobs job
        set
          status = 'processing',
          locked_at = now(),
          last_error = case when job.status = 'processing' then job.last_error else null end,
          updated_at = now()
        from due
        where job.id = due.id
        returning job.*;
      `,
      [
        Math.min(Math.max(Number(limit) || 25, 1), 100),
        Math.min(Math.max(Number(staleAfterMinutes) || 10, 1), 120),
        safeCenterId,
      ],
    );
    return result.rows.map(mapOpsJob);
  });
}

async function updateOpsJobStatus(id, patch = {}) {
  const result = await getPool().query(
    `
      update ops_jobs
      set
        status = coalesce($2, status),
        attempts = attempts + coalesce($3, 0),
        last_error = $4,
        result = coalesce($5::jsonb, result),
        run_at = coalesce($6::timestamptz, run_at),
        locked_at = case
          when $2 = 'processing' then now()
          when $2 in ('queued', 'done', 'failed', 'cancelled') then null
          else locked_at
        end,
        finished_at = case when $2 in ('done', 'failed', 'cancelled') then coalesce(finished_at, now()) else finished_at end,
        updated_at = now()
      where id = $1
      returning *;
    `,
    [
      Number(id),
      patch.status || null,
      Number(patch.incrementAttempts || 0),
      patch.lastError || null,
      patch.result ? JSON.stringify(patch.result) : null,
      patch.runAt || patch.run_at || null,
    ],
  );
  if (!result.rowCount) throw new Error('Job Ops introuvable.');
  return mapOpsJob(result.rows[0]);
}

async function createWorkerRun(input = {}) {
  const result = await getPool().query(
    `
      insert into ops_worker_runs (worker_name, task_name, status, result)
      values ($1,$2,'running',$3::jsonb)
      returning *;
    `,
    [
      normalizeText(input.workerName || input.worker_name, { fallback: 'ops-worker' }),
      normalizeText(input.taskName || input.task_name, { required: true }),
      JSON.stringify(input.result || {}),
    ],
  );
  return mapWorkerRun(result.rows[0]);
}

async function finishWorkerRun(id, patch = {}) {
  const result = await getPool().query(
    `
      update ops_worker_runs
      set
        status = coalesce($2, status),
        finished_at = now(),
        duration_ms = round(extract(epoch from (now() - started_at)) * 1000)::int,
        checked_count = coalesce($3, checked_count),
        result = coalesce($4::jsonb, result),
        error = $5
      where id = $1
      returning *;
    `,
    [
      Number(id),
      patch.status || null,
      Number.isFinite(Number(patch.checkedCount || patch.checked_count)) ? Number(patch.checkedCount || patch.checked_count) : null,
      patch.result ? JSON.stringify(patch.result) : null,
      patch.error || null,
    ],
  );
  if (!result.rowCount) throw new Error('Run worker introuvable.');
  return mapWorkerRun(result.rows[0]);
}

async function createDelayIncident(input = {}) {
  const impact = input.impact && typeof input.impact === 'object' ? input.impact : {};
  const communications = input.communications && typeof input.communications === 'object' ? input.communications : {};
  const idempotencyKey = normalizeText(input.idempotencyKey || input.idempotency_key, { fallback: '' }) || null;
  const result = await getPool().query(
    `
      insert into ops_delay_incidents (
        center_id,
        reservation_id,
        delay_minutes,
        reason,
        status,
        previous_start_time,
        proposed_start_time,
        impact,
        communications,
        idempotency_key,
        applied_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,case when $5 = 'applied' then now() else null end)
      on conflict (idempotency_key)
      where idempotency_key is not null
      do update set
        status = excluded.status,
        proposed_start_time = excluded.proposed_start_time,
        impact = excluded.impact,
        communications = excluded.communications,
        applied_at = case when excluded.status = 'applied' then coalesce(ops_delay_incidents.applied_at, now()) else ops_delay_incidents.applied_at end
      returning *;
    `,
    [
      normalizeText(input.centerId || input.center_id, { fallback: 'libramont' }),
      input.reservationId || input.reservation_id || null,
      Number(input.delayMinutes || input.delay_minutes || 0),
      normalizeText(input.reason, { fallback: '' }),
      normalizeText(input.status, { fallback: 'proposed' }),
      input.previousStartTime || input.previous_start_time || null,
      input.proposedStartTime || input.proposed_start_time || null,
      JSON.stringify(impact),
      JSON.stringify(communications),
      idempotencyKey,
    ],
  );
  return mapDelayIncident(result.rows[0]);
}

async function getOpsHealth({ centerId = 'libramont', limit = 20 } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const [communications, jobs, workerRuns, delayIncidents] = await Promise.all([
    getPool().query(
      `
        select status, count(*)::int as count
        from communications
        where center_id = $1
        group by status
        order by status asc;
      `,
      [safeCenterId],
    ),
    getPool().query(
      `
        select status, count(*)::int as count
        from ops_jobs
        where center_id = $1
        group by status
        order by status asc;
      `,
      [safeCenterId],
    ),
    getPool().query(
      `
        select *
        from ops_worker_runs
        order by started_at desc
        limit $1;
      `,
      [safeLimit],
    ),
    getPool().query(
      `
        select *
        from ops_delay_incidents
        where center_id = $1
        order by created_at desc
        limit $2;
      `,
      [safeCenterId, safeLimit],
    ),
  ]);

  const byStatus = (rows) => rows.reduce((accumulator, row) => {
    accumulator[row.status] = Number(row.count || 0);
    return accumulator;
  }, {});

  return {
    centerId: safeCenterId,
    communications: byStatus(communications.rows),
    jobs: byStatus(jobs.rows),
    workerRuns: workerRuns.rows.map(mapWorkerRun),
    delayIncidents: delayIncidents.rows.map(mapDelayIncident),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  TOTAL_LANES,
  createReservation,
  createCommunication,
  createDelayIncident,
  createDecisionLog,
  createOpsEvent,
  createOpsJob,
  createSimulationRun,
  createWorkerRun,
  cancelReservationCommunications,
  cancelReservationOpsJobs,
  deleteSimulationData,
  deleteReservation,
  ensureSimulationSchema,
  finishWorkerRun,
  getReservationById,
  getOpsHealth,
  getLatestSimulationRun,
  getPool,
  getSimulationRun,
  listDueOpsJobs,
  listDecisionLogs,
  listDueCommunications,
  listCommunications,
  listAgentSuggestions,
  listOpsEvents,
  readAvailabilitySnapshot,
  readAdminRangeState,
  readStaffState,
  saveAgentSuggestions,
  updateSimulationRun,
  updateCommunicationStatus,
  updateLaneStatus,
  updateOpsJobStatus,
  updateReservation,
  validateReservationResources,
};
