const { Pool } = require('pg');
const { getCenter, getFormula } = require('./ops-knowledge');
const {
  LASER_GAME_ARENA_MINUTES,
  MAX_PER_LANE,
  pairsForLaneCount,
  TOTAL_LANES,
  // La reponse VIVANTE au besoin en pistes d une formule (hasBowling derive des
  // steps du store). Importee sous un autre nom : ce fichier a sa propre
  // reservationNeedsLanes(payload), qui delegue la branche formule a celle-ci.
  reservationNeedsLanes: catalogFormuleNeedsLanes,
} = require('./booking-config');
const {
  simulationSqlExclusion,
  fabricatedSqlPredicate,
  demonstrationEmailPattern,
} = require('./simulation-filter');
const {
  isCenterClosedAt,
  isCenterClosedDuring,
  isLaneBlockedAt,
  isActivityBlockedAt,
  isFormulaBlockedOn,
  loadAvailabilityBlocks,
  resolveBlocksForDate,
  resolveBlocksOnClient,
} = require('./availability-blocks');

const VALID_STATUSES = new Set(['pending', 'arrived', 'paid', 'cancelled']);
const VALID_VALIDATION_STATUSES = new Set(['draft', 'requested', 'staff_review', 'confirmed', 'rejected']);
const VALID_LANE_STATUSES = new Set(['active', 'maintenance']);
// 'activite' : visite qui ne mobilise AUCUNE ressource planifiee (minigolf seul,
// billards seuls). Les trois autres types ne changent pas de sens : une visite
// avec du bowling reste de type 'bowling'. Voir lib/visit-program.
const VALID_RESERVATION_TYPES = new Set(['bowling', 'laser', 'formule', 'activite']);
// Occasion DÉCLARÉE (voir reservation-request.js). Toute valeur inconnue → ''.
const OCCASION_VALUES = new Set(['anniversaire', 'amis', 'entreprise', 'ecole', 'evg', 'autre']);
const CUSTOM_REQUEST_STATUSES = new Set(['new', 'in_progress', 'handled', 'archived']);

function normalizeReservationOccasion(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return OCCASION_VALUES.has(normalized) ? normalized : '';
}

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
    // Plafond de connexions EXPLICITE (pg vaut 10 par défaut, implicitement).
    // Ce pool n'est pas partagé : chaque instance de fonction Vercel a le sien,
    // et le worker Railway (workers/ops-worker.js) garde en plus son propre
    // process ouvert. Le plafond réel côté Neon vaut donc
    // (max x instances Vercel simultanées) + (max du worker) : un jour de rush,
    // le défaut implicite de 10 par instance peut saturer la limite du plan.
    // Un défaut prudent de 5 laisse de la marge tout en gardant assez de
    // connexions pour les requêtes concurrentes d'une même instance chaude.
    // Suite logique (NON faite ici, décision infra) : pointer DATABASE_URL sur
    // l'endpoint poolé (PgBouncer) de Neon, ou un gestionnaire de connexions
    // partagé. Rien dans ce dépôt ne prouve lequel des deux endpoints est en
    // service : à vérifier côté infra avant de monter cette valeur.
    pool = new Pool({
      connectionString: getDatabaseConnectionString(),
      ssl: getSslConfig(),
      max: Math.max(1, Math.trunc(Number(process.env.DATABASE_POOL_MAX) || 5)),
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

// Les traces automatiques du moteur portent un marqueur en tete de ligne, ce
// qui permet de les retirer plus tard sans jamais toucher a ce que le staff a
// ecrit lui-meme. Le marqueur est masque a l'affichage (getReservationNoteText).
const RESERVATION_NOTE_TAG = '[ops:';

function mergeReservationNotes(current, noteAppend, noteDropTag) {
  let lignes = String(current || '').split('\n');
  if (noteDropTag) {
    const prefixe = `${RESERVATION_NOTE_TAG}${noteDropTag}]`;
    lignes = lignes.filter((ligne) => !ligne.trimStart().startsWith(prefixe));
  }
  if (noteAppend) lignes.push(noteAppend);
  return lignes.filter((ligne) => String(ligne).trim()).join('\n');
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

// Minutes depuis minuit -> "HH:MM". Une seule ecriture de cette conversion dans
// le fichier (formatGridMinutes en derive) : deux formatages d'heure qui
// divergent, c'est deux horaires differents pour le meme instant.
function minutesToClock(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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

function ensureLaserCapacity(payload, reservations, blocks = [], dateISO = '') {
  const candidateBlocks = resourceBlocksFromReservation(payload, 'laser_arena');
  if (!candidateBlocks.length) return;

  // Activite bloquee (scope 'activity', ref 'laser_game') sur la fenetre d'une
  // session : refus franc, comme un Laser Game complet. Sans blocage la liste
  // est vide : le predicat rend false, aucune session n'est retiree.
  if (Array.isArray(blocks) && blocks.length) {
    candidateBlocks.forEach((candidate) => {
      const startMin = Math.round(Number(candidate.start || 0) * 60);
      const endMin = Math.round(Number(candidate.end || 0) * 60);
      if (isActivityBlockedAt(blocks, dateISO, 'laser_game', startMin, endMin || startMin + 1)) {
        const error = new Error('Le Laser Game est indisponible sur ce créneau.');
        error.expose = true;
        throw error;
      }
    });
  }

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
  // Le besoin en pistes d une formule se lit dans le CATALOGUE VIVANT (steps du
  // store via booking-config), plus dans un Set fige : une formule custom creee
  // en live avec un step bowling verrouille ses pistes comme les historiques.
  // (Le Set BOWLING_FORMULE_IDS ne connaissait que f1/f3/f4/bts/css/ffm : toute
  // nouvelle formule bowling passait laneCount=0, zero verrou anti-double-piste.)
  if (payload.type === 'formule' && payload.formuleId) return catalogFormuleNeedsLanes('formule', payload.formuleId);
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

// État de complétion des activités de formule. Objet plat borné :
//   { "<activityId>-<countIndex>": { done:bool, doneAt:string, by:string } }
// Défensif : rejette tout ce qui n'est pas une entrée conforme, borne les tailles
// (clé abusive / payload forgé staff). Une clé « non faite » n'est pas stockée.
function normalizeActivityProgress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  let count = 0;
  for (const rawKey of Object.keys(input)) {
    if (count >= 100) break;
    const key = String(rawKey).slice(0, 80);
    const value = input[rawKey];
    if (!value || typeof value !== 'object') continue;
    if (!value.done) continue; // seules les activités FAITES sont conservées
    out[key] = {
      done: true,
      doneAt: typeof value.doneAt === 'string' ? value.doneAt.slice(0, 40) : '',
      by: stripUnsafeMarkup(normalizeText(value.by, { fallback: '' })).slice(0, 80),
    };
    count += 1;
  }
  return out;
}

// Programme d'une visite tel qu'il sera STOCKE. Le contenu vient de
// lib/visit-program (seule autorite sur les activites vendues, les options et le
// prix) ; cette fonction est une derniere borne de forme, pas une validation
// metier : elle refuse ce qui n'a pas la tete d'un programme plutot que de
// laisser passer un jsonb arbitraire en base.
function normalizeReservationProgram(value) {
  if (!value || typeof value !== 'object') return null;
  // Deux formes acceptees, comme a la planification : le document complet
  // ({ items, price, priceComplete }) et la simple LISTE d activites. La
  // lecture acceptait deja le tableau (lib/reservation-request.js), seule
  // l ecriture le refusait : un appelant qui envoyait sa liste voyait son
  // programme ecrit NULL, donc efface, sans le moindre message.
  const items = Array.isArray(value) ? value : (Array.isArray(value.items) ? value.items : null);
  if (!items || !items.length) return null;
  const safeItems = items.slice(0, 12).map((item) => {
    const out = {
      activityId: String(item.activityId || '').slice(0, 60),
      name: stripUnsafeMarkup(String(item.name || '')).slice(0, 120),
      planned: item.planned === true,
    };
    if (item.duration != null) out.duration = Number(item.duration) || 0;
    if (item.games != null) out.games = Math.trunc(Number(item.games) || 0);
    if (item.units != null) out.units = Math.trunc(Number(item.units) || 0);
    if (item.hours != null) out.hours = Number(item.hours) || 0;
    if (item.minutes != null) out.minutes = Math.trunc(Number(item.minutes) || 0);
    out.price = item.price == null ? null : Number(item.price);
    out.priceKnown = item.priceKnown === true;
    return out;
  }).filter((item) => item.activityId);
  if (!safeItems.length) return null;
  return {
    items: safeItems,
    price: Number(value.price) || 0,
    priceComplete: value.priceComplete === true,
  };
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
    // PATCH partiel (statut, activité cochée…) : name/phone absents du body → on
    // reprend ceux de la réservation existante (defaults), sinon un update qui ne
    // renvoie pas le contact échouait en « Champ requis manquant ». POST : defaults
    // vide → required s'applique toujours.
    name: stripUnsafeMarkup(normalizeText(input.name ?? defaults.name, { required: true })),
    phone: stripUnsafeMarkup(normalizeText(input.phone ?? defaults.phone, { required: true })),
    email: stripUnsafeMarkup(normalizeText(input.email ?? defaults.email, { fallback: '' })),
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
    occasion: normalizeReservationOccasion(input.occasion ?? defaults.occasion),
    extras: normalizeExtras(input.extras ?? defaults.extras),
    paymentMethod: normalizeText(input.paymentMethod, { fallback: defaults.paymentMethod || '' }) || null,
    notes: normalizeText(input.notes, { fallback: defaults.notes || '' }),
    activityProgress: normalizeActivityProgress(input.activityProgress ?? input.activity_progress ?? defaults.activityProgress ?? {}),
    // Programme de la visite (plusieurs activites). Deja normalise en amont par
    // lib/visit-program (borne, prix recalcule) : ici on ne fait que le porter.
    program: normalizeReservationProgram(input.program ?? defaults.program),
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
    occasion: row.occasion || '',
    extras: Array.isArray(row.extras) ? row.extras : [],
    paymentMethod: row.payment_method || '',
    notes: row.notes || '',
    activityProgress: row.activity_progress && typeof row.activity_progress === 'object' ? row.activity_progress : {},
    // null pour toutes les reservations mono-activite (historiques comprises) :
    // le staff retombe alors sur type + label, comme avant.
    program: row.program && typeof row.program === 'object' ? row.program : null,
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
    // Progression live (0028). Tolerant a l'absence des colonnes pendant la
    // fenetre de deploiement : select * -> undefined -> valeurs neutres.
    steps: Array.isArray(row.steps) ? row.steps : [],
    stepsTotal: Number.isFinite(Number(row.steps_total)) && row.steps_total !== null && row.steps_total !== undefined
      ? Number(row.steps_total)
      : null,
    startedAt: row.started_at || null,
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

// Colonne pg `date` → 'YYYY-MM-DD' : pg la matérialise en Date à minuit
// LOCAL ; toISOString() (UTC) décalerait d'un jour en zone positive.
function dateColToStr(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

// Maintenance datée : « maintenance » ne s'applique qu'aux dates couvertes
// par la fenêtre [maintenance_from, maintenance_until] (borne nulle =
// illimité). Hors fenêtre la piste est réservable : levée automatique.
function resolveLaneStatusForDate(row, dateStr) {
  if (row.status !== 'maintenance' || !dateStr) return row.status;
  const from = dateColToStr(row.maintenance_from);
  const until = dateColToStr(row.maintenance_until);
  if (from && dateStr < from) return 'active';
  if (until && dateStr > until) return 'active';
  return 'maintenance';
}

function mapLaneStatusRows(rows, forDate = '') {
  const dateStr = forDate ? String(forDate).slice(0, 10) : '';
  return rows.reduce((accumulator, row) => {
    accumulator[Number(row.lane_number)] = dateStr ? resolveLaneStatusForDate(row, dateStr) : row.status;
    return accumulator;
  }, {});
}

// Détail des fenêtres pour l'UI (planning, alertes), uniquement les pistes
// dont le statut brut est maintenance.
function buildLaneMaintenanceInfo(rows) {
  const info = {};
  for (const row of rows) {
    if (row.status !== 'maintenance') continue;
    info[Number(row.lane_number)] = {
      from: dateColToStr(row.maintenance_from),
      until: dateColToStr(row.maintenance_until),
      note: row.maintenance_note || '',
    };
  }
  return info;
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

async function getLaneStatusMap(client, centerId = 'libramont', forDate = '') {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const laneStatuses = mapLaneStatusRows(await readLaneStatusRows(client, safeCenterId), forDate);
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
  const columns = (options.includeUpdatedAt
    ? 'lane_number, status, updated_at'
    : 'lane_number, status') + ', maintenance_from, maintenance_until, maintenance_note';
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

function allocateLanes(requiredCount, reservations, laneStatuses, startTime, duration, laneCount = TOTAL_LANES, blocks = [], dateISO = '') {
  if (!requiredCount) return [];

  const occupied = getOccupiedLanes(reservations, startTime, duration);
  // Fenetre demandee en minutes, pour tester un blocage de piste a l'heure pres
  // (scope 'lane' de availability_blocks). Sans blocage la liste est vide et le
  // predicat rend false : allocation strictement identique a aujourd'hui.
  const startMin = Math.round(timeToNum(startTime) * 60);
  const endMin = startMin + Math.round(Number(duration || 0) * 60);
  const available = [];
  for (let lane = 1; lane <= laneCount; lane += 1) {
    if (!occupied.has(lane)
      && laneStatuses[lane] !== 'maintenance'
      && !isLaneBlockedAt(blocks, dateISO, lane, startMin, endMin)) {
      available.push(lane);
    }
  }

  if (available.length < requiredCount) return null;

  const pairs = pairsForLaneCount(laneCount);

  if (requiredCount === 1) {
    for (const pair of pairs) {
      if (available.includes(pair[0]) && !available.includes(pair[1])) return [pair[0]];
      if (!available.includes(pair[0]) && available.includes(pair[1])) return [pair[1]];
    }
    return [available[0]];
  }

  if (requiredCount === 2) {
    for (const pair of pairs) {
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

// Une piste demandee est-elle bloquee (scope 'lane') sur SA fenetre reelle ?
// On teste chaque fenetre de piste du payload (blocs opsPlan, ou startTime /
// duration en repli), a l'heure pres. Sans blocage la liste est vide : false.
function requestedLaneIsBlocked(payload, lane, blocks, dateISO) {
  return laneWindowsFromReservation(payload).some((window) => {
    if (!window.lanes.map(Number).includes(Number(lane))) return false;
    const startMin = Math.round(Number(window.start || 0) * 60);
    const endMin = startMin + Math.round(Number(window.duration || 0) * 60);
    return isLaneBlockedAt(blocks, dateISO, Number(lane), startMin, endMin || startMin + 1);
  });
}

// LE PLAN PORTE LES PISTES REELLEMENT ATTRIBUEES, jamais d'autres (2026-08-20).
// La ligne de la reservation (colonne `lanes`) et les blocs du plan disaient
// deux choses differentes : la fiche lisait la ligne, le planning lisait les
// blocs, et le staff voyait sa piste changer d'un ecran a l'autre. Un seul fait,
// ecrit deux fois, doit etre ecrit pareil.
// Sans piste a poser (laser, visite libre) : le plan est rendu tel quel.
function withPlanLanes(opsPlan, lanes = []) {
  const blocks = Array.isArray(opsPlan?.resourceBlocks) ? opsPlan.resourceBlocks : null;
  if (!blocks || !lanes.length) return opsPlan;
  const bowlingBlocks = blocks.filter((block) => block.resourceType === 'bowling_lane');
  if (!bowlingBlocks.length) return opsPlan;
  const wanted = lanes.join(',');
  const same = bowlingBlocks.every((block) => (Array.isArray(block.lanes) ? block.lanes : [])
    .map(Number).sort((left, right) => left - right).join(',') === wanted);
  if (same) return opsPlan;
  return {
    ...opsPlan,
    resourceBlocks: blocks.map((block) => (block.resourceType === 'bowling_lane'
      ? { ...block, lanes: [...lanes] }
      : block)),
    assignedLanes: [...lanes],
  };
}

// UN PLAN QUI N'A PAS ETE REPLANIFIE SUIT QUAND MEME LE DEPLACEMENT.
// Quand la replanification echoue (combinaison d'ancres refusee, moteur sans
// creneau sur), le plan enregistre revient tel quel : il decrit l'ANCIEN
// horaire. La ligne dit 16:00, le plan dit 15:00, et le planning - qui dessine
// le plan - ne bouge pas : c'est la capture de Movsar du 2026-08-20 (fiche a
// 1h30 piste 5, planning a 1h piste 4).
// Ici on translate le plan du meme ecart que l'horaire, et on recale la duree
// des blocs bowling sur la duree de la ligne. Rien a translater = plan rendu
// tel quel (creation, changement d'un champ qui ne touche pas l'horaire).
function shiftPlanMinutes(opsPlan, deltaMinutes, durationHours) {
  const blocks = Array.isArray(opsPlan?.resourceBlocks) ? opsPlan.resourceBlocks : null;
  if (!blocks) return opsPlan;
  const shiftItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const hasStart = Number.isFinite(Number(item.start)) || typeof item.startTime === 'string';
    if (!hasStart) return item;
    const start = readBlockTime(item, 'start');
    const end = readBlockTime(item, 'end', start);
    const nextStart = Math.round(start * 60) + deltaMinutes;
    const nextEnd = item.resourceType === 'bowling_lane' && Number(durationHours) > 0
      ? nextStart + Math.round(Number(durationHours) * 60)
      : Math.round(end * 60) + deltaMinutes;
    return {
      ...item,
      start: nextStart,
      end: nextEnd,
      startTime: minutesToClock(nextStart),
      endTime: minutesToClock(nextEnd),
      durationMinutes: Math.max(0, nextEnd - nextStart),
    };
  };
  const shiftClock = (value) => {
    if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) return value;
    const [hours, minutes] = value.split(':').map(Number);
    return minutesToClock(hours * 60 + minutes + deltaMinutes);
  };
  return {
    ...opsPlan,
    ...(opsPlan.startTime ? { startTime: shiftClock(opsPlan.startTime) } : {}),
    ...(opsPlan.endTime ? { endTime: shiftClock(opsPlan.endTime) } : {}),
    ...(opsPlan.firstBowlingTime ? { firstBowlingTime: shiftClock(opsPlan.firstBowlingTime) } : {}),
    ...(opsPlan.firstLaserTime ? { firstLaserTime: shiftClock(opsPlan.firstLaserTime) } : {}),
    resourceBlocks: blocks.map(shiftItem),
    ...(Array.isArray(opsPlan.timeline) ? { timeline: opsPlan.timeline.map(shiftItem) } : {}),
  };
}

// Le plan a-t-il ete REELLEMENT recalcule pour cette modification ? Sinon c'est
// celui d'avant, mot pour mot, et il ment sur l'horaire qu'on vient de changer.
function planIsUnchanged(nextPlan, previousPlan) {
  if (!nextPlan || !previousPlan) return false;
  try {
    return JSON.stringify(nextPlan) === JSON.stringify(previousPlan);
  } catch (error) {
    return false;
  }
}

function ensureAssignableLanes(payload, reservations, laneStatuses, blocks = [], dateISO = '') {
  if (!reservationNeedsLanes(payload)) {
    return [];
  }

  const requiredCount = payload.laneCount || payload.lanes.length;
  if (!requiredCount) return [];

  const laneCount = resolveCenterLaneCount(payload.centerId);
  const requestedLanes = normalizeLaneArray(payload.lanes, laneCount);
  // On teste les pistes DEMANDEES sur les fenetres du plan, pas les pistes que
  // le plan porte : sans ca, le controle validait l'attribution automatique du
  // moteur pendant qu'on ecrivait le choix du staff dans la ligne.
  const requestedPayload = { ...payload, opsPlan: withPlanLanes(payload.opsPlan, requestedLanes) };
  const requestedAreUsable =
    requestedLanes.length === requiredCount &&
    requestedLanes.every((lane) => laneStatuses[lane] !== 'maintenance') &&
    requestedLanes.every((lane) => !requestedLaneIsBlocked(requestedPayload, lane, blocks, dateISO)) &&
    lanesConflict(reservations, payload.startTime, payload.duration, requestedLanes, requestedPayload.opsPlan, laneCount).length === 0;

  if (requestedAreUsable) {
    return requestedLanes;
  }

  if (laneWindowsFromOpsPlan(payload.opsPlan, requestedLanes, laneCount).length) {
    throw new Error('Ce créneau vient de changer. Merci de relancer la recherche avant de confirmer.');
  }

  const allocated = allocateLanes(requiredCount, reservations, laneStatuses, payload.startTime, payload.duration, laneCount, blocks, dateISO);
  if (!allocated || allocated.length < requiredCount) {
    throw new Error(`Aucune piste disponible pour ${requiredCount} piste(s) sur ce créneau.`);
  }

  return allocated;
}

// Règle métier : toute heure d'ENTRÉE choisie par le client tombe sur une
// heure pleine ou demie (15:00, 15:30, jamais 15:15). Le refus est appliqué
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
  return minutesToClock(startMinutes);
}

function ensureProgramStartAlignment(payload) {
  if (payload.type === 'formule') {
    const startMinutes = Math.round(timeToNum(payload.startTime) * 60);
    if (startMinutes % PROGRAM_GRID_MINUTES !== 0) {
      const error = new Error(`Une formule démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30), départ ${formatGridMinutes(startMinutes)} refusé.`);
      error.expose = true;
      throw error;
    }
  }
  if (!reservationNeedsLanes(payload)) return;
  laneWindowsFromReservation(payload).forEach((window) => {
    const startMinutes = Math.round(Number(window.start || 0) * 60);
    if (startMinutes % PROGRAM_GRID_MINUTES !== 0) {
      const error = new Error(`Le bowling démarre uniquement aux heures pleines ou demies (ex. 15:00, 15:30), départ ${formatGridMinutes(startMinutes)} refusé.`);
      error.expose = true;
      throw error;
    }
  });
}

// Blocages de PORTEE non couverts par les gardes de piste/laser : centre ferme,
// formule indisponible, activite bowling bloquee. Refus franc et EXPOSE si le
// creneau demande tombe sur un blocage actif. Sans blocage (liste vide) c'est un
// no-op : la disponibilite reste strictement identique au comportement historique.
function assertReservationNotBlocked(payload, blocks, dateISO) {
  if (!Array.isArray(blocks) || !blocks.length) return;
  const startMin = Math.round(timeToNum(payload.startTime) * 60);
  const spanHours = Math.max(Number(payload.totalDuration || 0), Number(payload.duration || 0), 0);
  const endMin = spanHours > 0 ? startMin + Math.round(spanHours * 60) : startMin + 1;

  // La FENETRE, pas la seule minute de depart : une reservation qui traverse
  // une fermeture ponctuelle l occupe tout autant qu une qui y commence.
  if (isCenterClosedDuring(blocks, dateISO, startMin, endMin)) {
    const error = new Error('Le centre est fermé sur ce créneau.');
    error.expose = true;
    throw error;
  }
  if (payload.type === 'formule' && payload.formuleId
    && isFormulaBlockedOn(blocks, dateISO, payload.formuleId, startMin, endMin)) {
    const error = new Error('Cette formule est indisponible sur ce créneau.');
    error.expose = true;
    throw error;
  }
  // Activite 'bowling' bloquee : couvre le bowling standalone ET la piste d'une
  // formule. Le Laser Game (activite) est traite par ensureLaserCapacity.
  const usesBowling = payload.type === 'bowling' || (payload.type === 'formule' && reservationNeedsLanes(payload));
  if (usesBowling && isActivityBlockedAt(blocks, dateISO, 'bowling', startMin, endMin)) {
    const error = new Error('Le bowling est indisponible sur ce créneau.');
    error.expose = true;
    throw error;
  }
}

function validateReservationResources(input, reservations = [], laneStatuses = {}, blocks = [], dateISO = '') {
  const payload = normalizeReservationPayload(input, { channel: input.channel || 'public' });
  const effectiveDate = dateISO || payload.date;
  ensureProgramStartAlignment(payload);
  assertReservationNotBlocked(payload, blocks, effectiveDate);
  const lanes = ensureAssignableLanes(payload, reservations, laneStatuses, blocks, effectiveDate);
  ensureLaserCapacity({ ...payload, lanes }, reservations, blocks, effectiveDate);
  return {
    ok: true,
    lanes,
    payload: { ...payload, lanes, opsPlan: withPlanLanes(payload.opsPlan, lanes) },
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
    const laneStatuses = await getLaneStatusMap(client, payload.centerId, payload.date);
    // Anti-course des blocages : on RELIT les blocages FRAIS, DANS la transaction,
    // sur le client verrouille. Un blocage pose entre le GET (qui a laisse passer)
    // et ce POST est ainsi vu ici. Enveloppe savepoint : si la table est absente
    // (migration 0037 non encore jouee), l'erreur ne pollue pas la transaction et
    // on retombe sur "aucun blocage" (dispo identique au comportement historique).
    let blocks = [];
    try {
      await client.query('savepoint availability_blocks_read');
      blocks = await resolveBlocksOnClient(client, payload.centerId, payload.date);
      await client.query('release savepoint availability_blocks_read');
    } catch (error) {
      try { await client.query('rollback to savepoint availability_blocks_read'); } catch (rollbackError) { /* savepoint deja perdu */ }
      blocks = [];
    }
    assertReservationNotBlocked(payload, blocks, payload.date);
    const lanes = ensureAssignableLanes(payload, reservations, laneStatuses, blocks, payload.date);
    // Le plan enregistre porte les pistes REELLEMENT attribuees : la fiche et le
    // planning ne peuvent plus se contredire.
    payload.opsPlan = withPlanLanes(payload.opsPlan, lanes);
    ensureLaserCapacity(payload, reservations, blocks, payload.date);

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
          occasion,
          extras,
          payment_method,
          notes,
          ops_plan,
          risk_level,
          risk_score,
          validation_status,
          activity_progress,
          program
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::int[],$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22::jsonb,$23,$24,$25,$26::jsonb,$27::jsonb
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
        payload.occasion,
        JSON.stringify(payload.extras),
        payload.paymentMethod,
        payload.notes,
        payload.opsPlan ? JSON.stringify(payload.opsPlan) : null,
        payload.riskLevel,
        payload.riskScore,
        payload.validationStatus,
        JSON.stringify(payload.activityProgress || {}),
        payload.program ? JSON.stringify(payload.program) : null,
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
    const laneStatuses = await getLaneStatusMap(client, payload.centerId, payload.date);
    // LE PLAN SUIT LA RESERVATION, MEME QUAND LA REPLANIFICATION A ECHOUE.
    // Plan inchange + horaire deplace = plan perime : on le translate du meme
    // ecart (et on recale la duree des blocs bowling) au lieu d'ecrire un plan
    // qui decrit le creneau d'hier.
    const startShift = Math.round((timeToNum(payload.startTime) - timeToNum(current.startTime)) * 60);
    const durationChanged = Math.abs(Number(payload.duration || 0) - Number(current.duration || 0)) > 0.001;
    if (planIsUnchanged(payload.opsPlan, current.opsPlan) && (startShift !== 0 || durationChanged)) {
      payload.opsPlan = shiftPlanMinutes(payload.opsPlan, startShift, payload.duration);
    }
    const lanes = ensureAssignableLanes(payload, reservations, laneStatuses);
    // Meme regle qu'a la creation : le plan ecrit les pistes attribuees, sinon
    // le planning continue de dessiner la reservation la ou elle n'est plus.
    payload.opsPlan = withPlanLanes(payload.opsPlan, lanes);
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
          occasion = $19,
          extras = $20::jsonb,
          payment_method = $21,
          notes = $22,
          ops_plan = $23::jsonb,
          risk_level = $24,
          risk_score = $25,
          validation_status = $26,
          activity_progress = $27::jsonb,
          program = $28::jsonb,
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
        payload.occasion,
        JSON.stringify(payload.extras),
        payload.paymentMethod,
        payload.notes,
        payload.opsPlan ? JSON.stringify(payload.opsPlan) : null,
        payload.riskLevel,
        payload.riskScore,
        payload.validationStatus,
        JSON.stringify(payload.activityProgress || {}),
        payload.program ? JSON.stringify(payload.program) : null,
      ],
    );

    return mapReservation(result.rows[0]);
  });
}

// Application ATOMIQUE d'un plan de retard multi-réservations : toutes les
// modifications (heures, pistes, plans) passent dans UNE transaction, validées
// sur l'état FINAL du planning (les updates séquentiels échoueraient sur les
// états transitoires d'une cascade). Volontairement non gaté par la grille
// :00/:30 : un décalage retard est un ajustement staff hors grille.
async function applyReservationScheduleUpdates({ centerId = 'libramont', date, updates = [] } = {}) {
  if (!Array.isArray(updates) || !updates.length) throw new Error('Aucune modification à appliquer.');
  const safeDate = assertDate(date);
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });

  return withTransaction(async (client) => {
    await lockDate(client, safeDate, safeCenterId);
    const reservations = await listReservationsForDate(client, safeDate, null, safeCenterId);
    const laneStatuses = await getLaneStatusMap(client, safeCenterId, safeDate);
    const laneCount = resolveCenterLaneCount(safeCenterId);
    const byId = new Map(reservations.map((reservation) => [Number(reservation.id), reservation]));

    const merged = updates.map((update) => {
      const current = byId.get(Number(update.id));
      if (!current) {
        const error = new Error(`Réservation ${update.id} introuvable sur ${safeDate} : le planning a changé, relancez l'analyse.`);
        error.expose = true;
        throw error;
      }
      const lanes = normalizeLaneArray(Array.isArray(update.lanes) ? update.lanes : current.lanes, laneCount);
      return {
        current,
        next: {
          ...current,
          startTime: assertTime(update.startTime || current.startTime),
          lanes,
          opsPlan: update.opsPlan !== undefined ? update.opsPlan : current.opsPlan,
          // UNE TRACE AUTOMATIQUE QUI S AJOUTE DOIT AUSSI SAVOIR SE RETIRER.
          // Movsar, 2026-08-14 : « quand on enleve le retard, ca ne retire pas
          // le message ». Retirer un retard AJOUTAIT une ligne « Retard retire,
          // creneau d origine restaure » par-dessus la ligne « Retard +10 min
          // applique » : la note grossissait a chaque aller-retour et finissait
          // par raconter l historique du logiciel au lieu de la consigne du
          // client. Les lignes automatiques portent donc un marqueur, et une
          // operation peut demander leur retrait au lieu d en empiler une de
          // plus. Les notes ECRITES PAR LE STAFF ne portent pas ce marqueur et
          // ne sont jamais touchees.
          notes: mergeReservationNotes(current.notes, update.noteAppend, update.noteDropTag),
        },
      };
    });

    // État final du planning = réservations non touchées + versions modifiées.
    const finalState = reservations.map((reservation) => {
      const found = merged.find((item) => Number(item.current.id) === Number(reservation.id));
      return found ? found.next : reservation;
    });

    for (const item of merged) {
      const next = item.next;
      const othersFinal = finalState.filter((reservation) => Number(reservation.id) !== Number(next.id));
      const maintenanceLane = next.lanes.find((lane) => laneStatuses[lane] === 'maintenance');
      if (maintenanceLane) {
        const error = new Error(`La piste ${maintenanceLane} est en maintenance : plan de retard invalide.`);
        error.expose = true;
        throw error;
      }
      const conflicts = lanesConflict(othersFinal, next.startTime, next.duration, next.lanes, next.opsPlan, laneCount);
      if (conflicts.length) {
        const error = new Error('Le planning vient de changer : le plan de retard ne passe plus. Relancez l\'analyse.');
        error.expose = true;
        throw error;
      }
      ensureLaserCapacity(next, othersFinal);
    }

    const updated = [];
    for (const item of merged) {
      const next = item.next;
      const result = await client.query(
        `
          update reservations
          set
            start_time = $2,
            lanes = $3::int[],
            ops_plan = $4::jsonb,
            notes = $5,
            updated_at = now()
          where id = $1
          returning *;
        `,
        [
          Number(next.id),
          next.startTime,
          next.lanes,
          next.opsPlan ? JSON.stringify(next.opsPlan) : null,
          next.notes || '',
        ],
      );
      if (!result.rowCount) throw new Error(`Réservation ${next.id} disparue pendant l'application du retard.`);
      updated.push(mapReservation(result.rows[0]));
    }

    return updated;
  });
}

async function getDelayIncidentById(id) {
  if (!id) return null;
  const result = await getPool().query('select * from ops_delay_incidents where id = $1 limit 1;', [Number(id)]);
  if (!result.rowCount) return null;
  return mapDelayIncident(result.rows[0]);
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
      laneStatuses: mapLaneStatusRows(laneRows, safeDate),
      laneMaintenance: buildLaneMaintenanceInfo(laneRows),
      revision,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}

// Lecteur ANALYTIQUE (direction, analytics, audiences de campagne) : les
// reservations de simulation en sont exclues par defaut, cf lib/simulation-filter.js.
// `options.includeSimulation = true` = opt-in de la console de simulation.
async function readAdminRangeState(startDate, endDate, centerId = 'libramont', options = {}) {
  const safeStartDate = assertDate(startDate);
  const safeEndDate = assertDate(endDate);
  if (safeEndDate < safeStartDate) {
    throw new Error('Periode invalide.');
  }
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const simulationClause = options.includeSimulation === true ? '' : `and ${simulationSqlExclusion()}`;
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
            ${simulationClause}
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
      laneStatuses: mapLaneStatusRows(laneRows, safeStartDate),
      laneMaintenance: buildLaneMaintenanceInfo(laneRows),
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
    const [reservationResult, laneRows, rawBlocks] = await Promise.all([
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
      // Blocages granulaires du centre (cache TTL 30 s, fail-soft : sur incident
      // base, rend l'etat connu ou []). Jamais de throw : la dispo ne casse pas.
      loadAvailabilityBlocks(client, safeCenterId),
    ]);

    return {
      date: safeDate,
      centerId: safeCenterId,
      reservations: reservationResult.rows.map(mapReservation),
      laneStatuses: mapLaneStatusRows(laneRows, safeDate),
      // Blocages ACTIFS a la date, a cote de laneStatuses. Champ ADDITIF : les
      // appelants existants qui ne le lisent pas restent inchanges.
      blocks: resolveBlocksForDate(rawBlocks, safeDate),
    };
  } finally {
    client.release();
  }
}

async function updateLaneStatus(lane, status, centerId = 'libramont', options = {}) {
  const laneNumber = Number(lane);
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  if (!Number.isInteger(laneNumber) || laneNumber < 1 || laneNumber > resolveCenterLaneCount(safeCenterId)) {
    throw new Error('Numero de piste invalide.');
  }
  if (!VALID_LANE_STATUSES.has(status)) {
    throw new Error('Statut de piste invalide.');
  }

  // Fenêtre de maintenance datée (optionnelle) : validée ici, remise à zéro
  // dès que la piste repasse active.
  const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
  const maintenanceFrom = status === 'maintenance' && DATE_RX.test(String(options.maintenanceFrom || '')) ? options.maintenanceFrom : null;
  const maintenanceUntil = status === 'maintenance' && DATE_RX.test(String(options.maintenanceUntil || '')) ? options.maintenanceUntil : null;
  if (maintenanceFrom && maintenanceUntil && maintenanceUntil < maintenanceFrom) {
    throw Object.assign(new Error('Fenêtre de maintenance invalide : la fin précède le début.'), { expose: true });
  }
  const maintenanceNote = status === 'maintenance' ? String(options.note || '').slice(0, 200) : '';

  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1));', [`fungalaxy:${safeCenterId}:lane:${laneNumber}`]);
    let result;
    try {
      result = await client.query(
        `
          insert into lane_statuses (center_id, lane_number, status, maintenance_from, maintenance_until, maintenance_note, updated_at)
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (center_id, lane_number)
          do update set status = excluded.status,
            maintenance_from = excluded.maintenance_from,
            maintenance_until = excluded.maintenance_until,
            maintenance_note = excluded.maintenance_note,
            updated_at = now()
          returning center_id, lane_number, status, maintenance_from, maintenance_until, maintenance_note, updated_at;
        `,
        [safeCenterId, laneNumber, status, maintenanceFrom, maintenanceUntil, maintenanceNote],
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
    const row = result.rows[0];
    return {
      centerId: row.center_id,
      lane: Number(row.lane_number),
      status: row.status,
      maintenanceFrom: dateColToStr(row.maintenance_from),
      maintenanceUntil: dateColToStr(row.maintenance_until),
      maintenanceNote: row.maintenance_note || '',
      updatedAt: row.updated_at,
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

// `recipient` (2026-08-19) : le fil de discussion d'UN contact, envoyes et
// recus melanges dans l'ordre du temps. Il sert la page « Demandes sur
// mesure », ou il faut voir ce qui est deja parti avant de repondre. La
// comparaison est insensible a la casse : une adresse saisie au comptoir et la
// meme adresse venue du formulaire public ne s'ecrivent pas pareil.
async function listCommunications({ centerId = 'libramont', status = '', limit = 100, reservationId = null, recipient = '' } = {}) {
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
    sql += ` and status = $${values.length}`;
  }

  const safeReservationId = Number(reservationId);
  if (Number.isInteger(safeReservationId) && safeReservationId > 0) {
    values.push(safeReservationId);
    sql += ` and reservation_id = $${values.length}`;
  }

  const safeRecipient = normalizeText(recipient, { fallback: '' }).toLowerCase();
  if (safeRecipient) {
    values.push(safeRecipient);
    sql += ` and lower(recipient) = $${values.length}`;
  }

  sql += ` order by created_at desc limit $2;`;
  const result = await getPool().query(sql, values);
  return result.rows.map(mapCommunication);
}

// LE POULS D UN CENTRE : une empreinte de ce que la page Emails affiche.
//
// Pourquoi : la page se chargeait UNE fois et ne rebougeait plus. Il fallait
// recharger a la main pour voir un mail arrive, et deux personnes sur la meme
// boite pouvaient repondre au meme message sans le savoir. Rafraichir les six
// blocs toutes les quelques secondes couterait cher pour rien : 99 % du temps
// rien n a bouge. On lit donc d abord cette empreinte, minuscule, et on ne
// recharge que si elle a change.
//
// L empreinte se construit sur `xmin`, le numero de transaction que Postgres
// range dans chaque ligne : il change a CHAQUE modification de la ligne, quelle
// que soit la colonne touchee. Un compteur de lignes raterait un passage de
// « en file » a « envoye » ; une date de derniere modification n existe pas sur
// ces tables. `xmin` attrape tout, sans migration.
//
// La fenetre est bornee (les N dernieres lignes) pour deux raisons : c est
// exactement ce que la page montre, et le cout ne grandit pas avec l historique.
// La fenetre du planning : large devant (une reservation se prend des mois a
// l avance) et courte derriere (le passe ne bouge plus). Bornee par la DATE et
// non par un nombre de lignes, parce que c est la date qui decide de ce que le
// planning montre, et parce que l index (center_id, date, start_time) sert
// exactement cette lecture.
const POULS_COMMUNICATIONS = 300;
const POULS_SUGGESTIONS = 120;

async function getOpsPulse({ centerId = 'libramont' } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const result = await getPool().query(
    `
      select
        coalesce((
          select md5(string_agg(c.id::text || ':' || c.xmin::text, ',' order by c.id desc))
          from (
            select id, xmin from communications
            where center_id = $1
            order by id desc
            limit ${POULS_COMMUNICATIONS}
          ) c
        ), 'vide') as communications,
        coalesce((
          select md5(string_agg(s.id::text || ':' || s.xmin::text, ',' order by s.id desc))
          from (
            select id, xmin from ops_agent_suggestions
            where center_id = $1
            order by id desc
            limit ${POULS_SUGGESTIONS}
          ) s
        ), 'vide') as suggestions,
        coalesce((
          select max(id)::text from ops_events where center_id = $1
        ), 'vide') as evenements,
        coalesce((
          select md5(string_agg(p.communication_id::text || ':' || p.member_id || ':' || p.member_role || ':' || p.claimed_at::text, ',' order by p.communication_id))
          from ops_email_claims p
          where p.center_id = $1 and p.expires_at > now()
        ), 'vide') as prises,
        coalesce((
          select md5(string_agg(r.id::text || ':' || r.xmin::text, ',' order by r.id))
          from reservations r
          where r.center_id = $1
            and r.date between (current_date - interval '60 days') and (current_date + interval '180 days')
        ), 'vide') as reservations;
    `,
    [safeCenterId],
  );
  const row = (result.rows && result.rows[0]) || {};
  return {
    centerId: safeCenterId,
    empreinte: [
      row.communications || 'vide',
      row.suggestions || 'vide',
      row.evenements || 'vide',
      row.prises || 'vide',
      row.reservations || 'vide',
    ].join('.'),
    at: new Date().toISOString(),
  };
}

// LA PRISE DE MAIN SUR UN MAIL RECU : « je m en occupe ».
//
// Deux personnes peuvent ouvrir la meme boite. Sans ce signal, chacune redige
// sa reponse sans savoir que l autre redige la sienne, et le client en recoit
// deux. La synchronisation vivante ne suffit pas : elle montre une reponse une
// fois PARTIE, pas pendant qu on l ecrit.
//
// Trois choix, tous deliberes :
//
//   1. UNE EXPIRATION, PAS UN VERROU A LIBERER. Un onglet ferme, un navigateur
//      qui plante ou une pause cafe ne doivent jamais bloquer un message pour
//      toujours. L ecran rafraichit sa prise tant qu il est ouvert ; des qu il
//      s arrete, elle tombe toute seule.
//   2. ON NE VOLE PAS UNE PRISE VIVANTE. Deux ecrans qui demandent en meme
//      temps : le premier arrive garde la main, le second est INFORME de qui
//      l a, il ne se voit pas repondre « c est bon » a tort.
//   3. LA PRISE EST CONSULTATIVE. Elle previent, elle n interdit pas : le
//      produit ne sait pas ce qui se passe dans la piece, et une gerante doit
//      pouvoir passer outre en connaissance de cause.
const PRISE_DUREE_SECONDES = 180;

async function claimEmailThread({
  communicationId,
  centerId = 'libramont',
  memberId = '',
  memberName = '',
  memberRole = '',
  ttlSeconds = PRISE_DUREE_SECONDES,
} = {}) {
  const id = Number(communicationId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'communication_invalide' };
  const safeMemberId = normalizeText(memberId, { fallback: '' });
  if (!safeMemberId) return { ok: false, reason: 'membre_inconnu' };
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeName = normalizeText(memberName, { fallback: '' });
  const safeRole = normalizeText(memberRole, { fallback: '' });
  const duree = Math.min(Math.max(Number(ttlSeconds) || PRISE_DUREE_SECONDES, 30), 900);

  // `where` sur le DO UPDATE : c est lui qui empeche le vol. Une prise vivante
  // tenue par quelqu un d autre ne remplit aucune des deux conditions, la mise
  // a jour ne s applique pas, et rien n est renvoye.
  const pose = await getPool().query(
    `
      insert into ops_email_claims (communication_id, center_id, member_id, member_name, member_role, claimed_at, refreshed_at, expires_at)
      values ($1, $2, $3, $4, $6, now(), now(), now() + make_interval(secs => $5))
      on conflict (communication_id) do update
        set member_id = excluded.member_id,
            member_name = excluded.member_name,
            member_role = excluded.member_role,
            center_id = excluded.center_id,
            refreshed_at = now(),
            expires_at = excluded.expires_at,
            claimed_at = case
              when ops_email_claims.member_id = excluded.member_id then ops_email_claims.claimed_at
              else now()
            end
      where ops_email_claims.expires_at < now()
         or ops_email_claims.member_id = excluded.member_id
      returning *;
    `,
    [id, safeCenterId, safeMemberId, safeName, duree, safeRole],
  );
  if (pose.rowCount > 0) return { ok: true, claim: mapEmailClaim(pose.rows[0]) };

  // Refus : on renvoie QUI tient la main. Un refus muet laisserait l ecran
  // afficher « personne » alors que quelqu un ecrit.
  const tenue = await getPool().query(
    'select * from ops_email_claims where communication_id = $1;',
    [id],
  );
  return {
    ok: false,
    reason: 'prise_par_quelqu_un_d_autre',
    claim: tenue.rows[0] ? mapEmailClaim(tenue.rows[0]) : null,
  };
}

async function releaseEmailThread({ communicationId, memberId = '' } = {}) {
  const id = Number(communicationId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'communication_invalide' };
  const safeMemberId = normalizeText(memberId, { fallback: '' });
  if (!safeMemberId) return { ok: false, reason: 'membre_inconnu' };
  // On ne relache QUE sa propre prise : sans cette condition, fermer son onglet
  // libererait le mail que le collegue est en train d ecrire.
  const result = await getPool().query(
    'delete from ops_email_claims where communication_id = $1 and member_id = $2 returning communication_id;',
    [id, safeMemberId],
  );
  return { ok: result.rowCount > 0 };
}

async function listActiveEmailClaims({ centerId = 'libramont' } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const result = await getPool().query(
    `
      select * from ops_email_claims
      where center_id = $1 and expires_at > now()
      order by claimed_at desc
      limit 200;
    `,
    [safeCenterId],
  );
  return result.rows.map(mapEmailClaim);
}

function mapEmailClaim(row) {
  return {
    communicationId: Number(row.communication_id),
    centerId: row.center_id || 'libramont',
    memberId: row.member_id || '',
    memberName: row.member_name || '',
    memberRole: row.member_role || '',
    claimedAt: row.claimed_at,
    refreshedAt: row.refreshed_at,
    expiresAt: row.expires_at,
  };
}

// CE QUE L AGENT NE SAIT PAS, VU DE LA BASE.
//
// Les questions ne vivent pas dans une table a part : elles sont attachees au
// MAIL qui les a fait naitre. C est le bon endroit, parce que la question n a de
// sens qu avec son exemple sous les yeux ; et ca evite une table de plus a
// tenir synchronisee avec les mails qu on supprime.
//
// Une question disparait de la liste des qu on y a repondu (marquee dans le
// payload), pas quand le mail est traite : l agent apprend une fois, pour tous
// les messages suivants.
async function listAgentQuestions({ centerId = 'libramont', limit = 50 } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const result = await getPool().query(
    `
      select id, subject, recipient, created_at, payload
      from communications
      where center_id = $1
        and direction = 'inbound'
        and coalesce(payload->'analysis'->>'question', '') <> ''
        and coalesce(payload->'analysis'->>'questionRepondue', '') = ''
      order by id desc
      limit $2;
    `,
    [safeCenterId, safeLimit],
  );
  return result.rows.map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const analysis = payload.analysis || {};
    return {
      communicationId: Number(row.id),
      question: String(analysis.question || ''),
      sujet: String(analysis.intentLabel || analysis.intent || ''),
      mailSujet: String(row.subject || ''),
      mailDe: String(payload.from || row.recipient || ''),
      extrait: String(payload.textBody || '').slice(0, 300),
      recuLe: row.created_at,
    };
  });
}

// Marque une question comme repondue, et remplace l analyse du mail par celle
// que l agent produit MAINTENANT qu il sait : sans ca, la reponse proposee a
// l ecran resterait la pirouette d avant l apprentissage.
async function marquerQuestionRepondue({ communicationId, analyse = null, par = '' } = {}) {
  const id = Number(communicationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const morceau = { analysis: { ...(analyse || {}), questionRepondue: new Date().toISOString(), questionReponduePar: String(par || '').slice(0, 60) } };
  const result = await getPool().query(
    `update communications
       set payload = payload || $2::jsonb
     where id = $1 and direction = 'inbound'
     returning *;`,
    [id, JSON.stringify(morceau)],
  );
  return result.rows[0] ? mapCommunication(result.rows[0]) : null;
}

async function getInboundCommunication(communicationId) {
  const id = Number(communicationId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const result = await getPool().query(
    "select * from communications where id = $1 and direction = 'inbound' limit 1;",
    [id],
  );
  return result.rows[0] ? mapCommunication(result.rows[0]) : null;
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

// Remet en file un mail en échec, pour renvoi manuel depuis la page Emails.
// ISOLATION MULTI-TENANT : le prédicat porte l'id ET le center_id, et le centre
// voyage en PARAMÈTRE. Un id appartenant à un autre centre ne rend aucune ligne
// et lève un 404 exposé, jamais un 503 qui masquerait la cause.
// SEUL le statut `failed` est repris, et c'est délibéré :
//   - `sent` : le renvoyer ferait un doublon chez le client.
//   - `cancelled` : ce n'est PAS un échec, c'est une suppression VOULUE.
//     cancelReservationCommunications l'applique quand une réservation est
//     modifiée ou annulée (last_error = 'reservation_changed'), et cancelCampaign
//     quand une campagne est stoppée. Remettre ces mails en file enverrait au
//     client la confirmation d'une réservation qui n'existe plus.
// Le message d'erreur ci-dessous dit déjà « seuls les mails en échec » : le
// prédicat le respecte maintenant à la lettre.
async function requeueCommunication(id, centerId = 'libramont') {
  const safeId = Number(id);
  if (!Number.isInteger(safeId) || safeId <= 0) {
    const error = new Error('Message introuvable.');
    error.expose = true;
    error.statusCode = 404;
    throw error;
  }
  const result = await getPool().query(
    `
      update communications
      set
        status = 'queued',
        attempts = 0,
        last_error = '',
        locked_at = null,
        next_retry_at = null,
        scheduled_at = now()
      where id = $1
        and center_id = $2
        and status = 'failed'
      returning *;
    `,
    [safeId, normalizeText(centerId, { fallback: 'libramont' })],
  );
  if (!result.rowCount) {
    const error = new Error('Message introuvable, ou déjà envoyé : seuls les mails en échec peuvent être renvoyés.');
    error.expose = true;
    error.statusCode = 404;
    throw error;
  }
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

// Ecrit une etape de progression REELLE sur un job (0028). Appele uniquement
// par les handlers de lib/ops-jobs.js, au moment ou le travail decrit demarre :
// jamais par la boucle de dispatch (une etape ecrite par la boucle serait une
// fausse progression). `reset` remet le journal a zero au debut d'un handler :
// sur un retry, la timeline repart honnetement (ce que CETTE tentative fait).
// Ne jette JAMAIS : une ecriture de progression ne doit pas tuer le job, et le
// code doit tolerer l'absence des colonnes pendant la fenetre de deploiement.
async function appendOpsJobStep(id, label, { stepsTotal = null, reset = false } = {}) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return false;
  const entry = JSON.stringify([{ label: String(label || '').slice(0, 200), at: new Date().toISOString() }]);
  try {
    await getPool().query(
      `
        update ops_jobs
        set
          steps = case when $3::boolean then $2::jsonb else coalesce(steps, '[]'::jsonb) || $2::jsonb end,
          steps_total = coalesce($4::int, steps_total),
          started_at = case when $3::boolean then now() else coalesce(started_at, now()) end,
          updated_at = now()
        where id = $1;
      `,
      [jobId, entry, reset === true, Number.isInteger(stepsTotal) ? stepsTotal : null],
    );
    return true;
  } catch (error) {
    return false;
  }
}

// Lecture d'UN job (action `job` de /api/ops, pour le poller de progression).
// Scope centre obligatoire cote appelant : un job d'un autre centre rend null.
async function getOpsJob(id, { centerId = '' } = {}) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return null;
  const safeCenterId = normalizeText(centerId, { fallback: '' });
  const result = await getPool().query(
    `select * from ops_jobs where id = $1 and ($2 = '' or center_id = $2);`,
    [jobId, safeCenterId],
  );
  return result.rows[0] ? mapOpsJob(result.rows[0]) : null;
}

// Revendique UN job precis pour un traitement immediat (declenchement UI).
// Atomique : un seul statement, donc pas de double traitement possible face au
// worker Railway (lui prend les jobs via for update skip locked ; ici le job
// passe processing avec locked_at frais, le worker ne le reprendra que si le
// verrou devient obsolete, ce qui est exactement le filet de retry voulu).
async function claimOpsJob(id) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return null;
  const result = await getPool().query(
    `
      update ops_jobs
      set status = 'processing', locked_at = now(), updated_at = now()
      where id = $1
        and status = 'queued'
        and run_at <= now()
        and attempts < max_attempts
      returning *;
    `,
    [jobId],
  );
  return result.rows[0] ? mapOpsJob(result.rows[0]) : null;
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

// PROVENANCE DES DONNEES D'UN CENTRE : ses reservations contiennent-elles des
// lignes fabriquees (simulation, jeu de demonstration) ?
//
// Une seule question, une seule reponse, et elle vient de la BASE. C'est ce qui
// decide du bandeau "donnees de test" de l'ecran Direction (api/ops.js action
// health) : avant, ce bandeau etait un `true` ecrit en dur, donc il s'affichait
// aussi sur un centre dont chaque ligne est une vraie reservation payee.
//
// `exists` et pas `count` : savoir s'il y en a suffit, on ne montre aucun
// nombre. Le predicat vit dans lib/simulation-filter.js, avec les marqueurs.
async function centerHasFabricatedReservations({ centerId = 'libramont' } = {}) {
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' });
  const result = await getPool().query(
    `
      select 1
      from reservations
      where center_id = $1
        and ${fabricatedSqlPredicate(2)}
      limit 1;
    `,
    [safeCenterId, demonstrationEmailPattern()],
  );
  return result.rowCount > 0;
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

function mapCustomRequest(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id || 'libramont',
    contactName: row.contact_name || '',
    company: row.company || '',
    email: row.email || '',
    phone: row.phone || '',
    requestedDate: row.requested_date || '',
    pax: Number(row.pax || 0),
    occasion: row.occasion || '',
    message: row.message || '',
    source: row.source || 'client',
    status: row.status || 'new',
    payload: row.payload || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Demande SUR MESURE (lead) : stockée hors du planning. N'alloue ni créneau ni
// ressource. Convertie en vraie réservation par le staff si elle aboutit.
async function createCustomRequest(input = {}) {
  const status = CUSTOM_REQUEST_STATUSES.has(input.status) ? input.status : 'new';
  const result = await getPool().query(
    `
      insert into custom_requests (
        center_id, contact_name, company, email, phone,
        requested_date, pax, occasion, message, source, status, payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      returning *;
    `,
    [
      normalizeText(input.centerId, { fallback: 'libramont' }) || 'libramont',
      normalizeText(input.contactName, { fallback: '' }),
      normalizeText(input.company, { fallback: '' }),
      normalizeText(input.email, { fallback: '' }),
      normalizeText(input.phone, { fallback: '' }),
      normalizeText(input.requestedDate, { fallback: '' }),
      Math.max(0, Math.trunc(toNumber(input.pax, 0))),
      normalizeReservationOccasion(input.occasion),
      normalizeText(input.message, { fallback: '' }),
      normalizeText(input.source, { fallback: 'client' }) || 'client',
      status,
      JSON.stringify(input.payload && typeof input.payload === 'object' ? input.payload : {}),
    ],
  );
  return mapCustomRequest(result.rows[0]);
}

async function listCustomRequests({ centerId = '', status = '', limit = 100 } = {}) {
  const filters = [];
  const params = [];
  if (centerId && centerId !== 'all') {
    params.push(centerId);
    filters.push(`center_id = $${params.length}`);
  }
  if (status && CUSTOM_REQUEST_STATUSES.has(status)) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(300, Math.trunc(Number(limit) || 100))));
  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const result = await getPool().query(
    `select * from custom_requests ${where} order by created_at desc limit $${params.length};`,
    params,
  );
  return result.rows.map(mapCustomRequest);
}

async function updateCustomRequestStatus(id, status, { centerId = '' } = {}) {
  if (!CUSTOM_REQUEST_STATUSES.has(status)) {
    const error = new Error('Statut de demande invalide.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  // Scope centre (isolation multi-tenant) : un id d'un autre centre rend 404,
  // jamais une mutation trans-centre ni une fuite du contenu de la demande
  // (nom, contact, besoin du prospect). Même pattern que setInsightStatus
  // (lib/center-metrics.js) : centerId vide = accès plateforme, prédicat neutre.
  const result = await getPool().query(
    "update custom_requests set status = $2 where id = $1 and ($3 = '' or center_id = $3) returning *;",
    [Number(id), status, String(centerId || '')],
  );
  if (!result.rowCount) {
    const error = new Error('Demande introuvable.');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  return mapCustomRequest(result.rows[0]);
}

// --- Campagnes email (campaigns, migration 0015) ---
// Les stats d'envoi ne sont JAMAIS stockées : elles sont relues en direct
// depuis communications (templateId = campaign_<id>) : un seul état de vérité.

// Statut AFFICHÉ = dérivé de l'état réel de la file d'envoi, jamais figé.
// Le statut stocké ne connaît pas 'sent'/'failed' (pas de writer côté worker) :
// on le calcule à la lecture pour que « En envoi » devienne « Envoyée » quand
// la file est vidée, et qu'une campagne 100 % en échec ne mente pas.
function deriveCampaignStatus(stored, { sent, failed, queued, scheduledAt }) {
  if (stored === 'cancelled' || stored === 'draft') return stored;
  const scheduledFuture = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  if (stored === 'scheduled' && scheduledFuture) return 'scheduled';
  if (queued > 0) return 'sending';
  if (sent > 0) return failed > 0 ? 'sent_partial' : 'sent';
  if (failed > 0) return 'failed';
  return 'sent';
}

function mapCampaign(row) {
  const sent = Number(row.sent || 0);
  const failed = Number(row.failed || 0);
  const queued = Number(row.queued || 0);
  return {
    id: Number(row.id),
    centerId: row.center_id,
    name: row.name,
    objective: row.objective || '',
    segment: row.segment,
    subject: row.subject || '',
    body: row.body || '',
    status: row.status,
    storedStatus: row.status,
    scheduledAt: row.scheduled_at,
    recipientCount: Number(row.recipient_count || 0),
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    opens: Number(row.opens || 0),
    clicks: Number(row.clicks || 0),
    sent,
    failed,
    queued,
  };
}

async function createCampaignRow({ centerId, name, objective, segment, subject, body, status, scheduledAt, recipientCount, createdBy }) {
  const result = await getPool().query(
    `insert into campaigns (center_id, name, objective, segment, subject, body, status, scheduled_at, recipient_count, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *;`,
    [centerId, name, objective || '', segment, subject || '', body || '', status, scheduledAt || null, Number(recipientCount || 0), createdBy || ''],
  );
  return mapCampaign(result.rows[0]);
}

async function listCampaigns({ centerId = 'libramont', limit = 30 } = {}) {
  const result = await getPool().query(
    `select c.*,
       coalesce(s.sent, 0) as sent,
       coalesce(s.failed, 0) as failed,
       coalesce(s.queued, 0) as queued
     from campaigns c
     left join (
       select template_id,
         count(*) filter (where status = 'sent') as sent,
         count(*) filter (where status = 'failed') as failed,
         count(*) filter (where status in ('queued', 'processing')) as queued
       from communications
       where template_id like 'campaign_%'
       group by template_id
     ) s on s.template_id = 'campaign_' || c.id
     where c.center_id = $1
     order by c.created_at desc
     limit $2;`,
    [centerId, Math.min(Number(limit) || 30, 100)],
  );
  return result.rows.map((row) => {
    const campaign = mapCampaign(row);
    campaign.status = deriveCampaignStatus(row.status, campaign);
    return campaign;
  });
}

async function getCampaignRow({ id, centerId = 'libramont' }) {
  const result = await getPool().query(
    `select * from campaigns where id = $1 and center_id = $2;`,
    [Number(id), centerId],
  );
  return result.rows[0] ? mapCampaign(result.rows[0]) : null;
}

// Édition réservée aux brouillons : une campagne partie n'est plus modifiable.
async function updateCampaignRow({ id, centerId = 'libramont', name, objective, segment, subject, body }) {
  const result = await getPool().query(
    `update campaigns set name = $3, objective = $4, segment = $5, subject = $6, body = $7
     where id = $1 and center_id = $2 and status = 'draft'
     returning *;`,
    [Number(id), centerId, name, objective || '', segment, subject || '', body || ''],
  );
  if (!result.rowCount) throw Object.assign(new Error('Brouillon introuvable ou déjà envoyé.'), { expose: true });
  return mapCampaign(result.rows[0]);
}

// Transition brouillon → envoi (immédiat ou programmé), une seule fois.
async function markCampaignSending({ id, centerId = 'libramont', scheduledAt = null }) {
  const result = await getPool().query(
    `update campaigns set status = $3, scheduled_at = $4
     where id = $1 and center_id = $2 and status = 'draft'
     returning *;`,
    [Number(id), centerId, scheduledAt ? 'scheduled' : 'sending', scheduledAt || null],
  );
  if (!result.rowCount) throw Object.assign(new Error('Brouillon introuvable ou déjà envoyé.'), { expose: true });
  return mapCampaign(result.rows[0]);
}

// Garde anti-doublon : un re-clic (ou un retry après timeout apparent) ne doit
// pas recréer une campagne identique déjà partie. Renvoie l'id existant s'il y en a.
async function findRecentDuplicateCampaign({ centerId = 'libramont', segment, subject, body, withinMinutes = 3 }) {
  const result = await getPool().query(
    `select id from campaigns
     where center_id = $1 and segment = $2 and subject = $3 and body = $4
       and status in ('scheduled', 'sending')
       and created_at > now() - ($5 || ' minutes')::interval
     order by created_at desc limit 1;`,
    [centerId, segment, subject || '', body || '', String(Number(withinMinutes) || 3)],
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

async function cancelCampaignRow({ id, centerId = 'libramont' }) {
  return withTransaction(async (client) => {
    // On n'annule que ce qui peut réellement l'être : un brouillon, ou une
    // campagne dont il reste des envois EN FILE. Sinon (tout est parti), refus
    // explicite : plus de « Annulée · 0 envoi stoppé » mensonger.
    const campaign = await client.query(
      `update campaigns set status = 'cancelled'
       where id = $1 and center_id = $2 and status in ('draft', 'scheduled', 'sending')
         and (status = 'draft' or exists (
           select 1 from communications where template_id = $3 and status = 'queued'
         ))
       returning *;`,
      [Number(id), centerId, `campaign_${Number(id)}`],
    );
    if (!campaign.rowCount) throw Object.assign(new Error('Campagne introuvable, déjà envoyée ou déjà terminée, rien à annuler.'), { expose: true });
    const cancelled = await client.query(
      `update communications set status = 'cancelled'
       where template_id = $1 and status = 'queued'
       returning id;`,
      [`campaign_${Number(id)}`],
    );
    return { campaign: mapCampaign(campaign.rows[0]), cancelledCommunications: cancelled.rowCount };
  });
}

// --- Studio mails (email_templates + email_identities, migration 0013) ---

const EMAIL_TEMPLATE_CATEGORIES = new Set(['marketing', 'promotion', 'information', 'serieux', 'relance']);

function mapEmailTemplate(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id,
    name: row.name,
    category: row.category,
    subject: row.subject || '',
    body: row.body || '',
    createdBy: row.created_by || '',
    updatedAt: row.updated_at,
    archived: Boolean(row.archived),
  };
}

async function listEmailTemplates({ centerId = 'libramont', includeArchived = false } = {}) {
  const result = await getPool().query(
    `select * from email_templates
     where center_id = $1 ${includeArchived ? '' : 'and archived = false'}
     order by category asc, updated_at desc;`,
    [centerId],
  );
  return result.rows.map(mapEmailTemplate);
}

async function saveEmailTemplate({ id = null, centerId = 'libramont', name, category, subject = '', body = '', createdBy = '' }) {
  const safeName = normalizeText(name, { required: true });
  const safeCategory = EMAIL_TEMPLATE_CATEGORIES.has(category) ? category : 'marketing';
  if (id) {
    const result = await getPool().query(
      `update email_templates
       set name = $3, category = $4, subject = $5, body = $6, updated_at = now()
       where id = $1 and center_id = $2
       returning *;`,
      [Number(id), centerId, safeName, safeCategory, String(subject || ''), String(body || '')],
    );
    if (!result.rowCount) throw new Error('Modèle introuvable.');
    return mapEmailTemplate(result.rows[0]);
  }
  const result = await getPool().query(
    `insert into email_templates (center_id, name, category, subject, body, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning *;`,
    [centerId, safeName, safeCategory, String(subject || ''), String(body || ''), String(createdBy || '')],
  );
  return mapEmailTemplate(result.rows[0]);
}

async function archiveEmailTemplate({ id, centerId = 'libramont' }) {
  const result = await getPool().query(
    'update email_templates set archived = true, updated_at = now() where id = $1 and center_id = $2 returning *;',
    [Number(id), centerId],
  );
  if (!result.rowCount) throw new Error('Modèle introuvable.');
  return mapEmailTemplate(result.rows[0]);
}

function mapEmailIdentity(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id,
    label: row.label,
    email: row.email,
    isDefault: Boolean(row.is_default),
  };
}

async function listEmailIdentities({ centerId = 'libramont' } = {}) {
  const result = await getPool().query(
    'select * from email_identities where center_id = $1 order by is_default desc, id asc;',
    [centerId],
  );
  return result.rows.map(mapEmailIdentity);
}

async function saveEmailIdentity({ id = null, centerId = 'libramont', label, email, isDefault = false }) {
  const safeLabel = normalizeText(label, { required: true });
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) throw Object.assign(new Error('Adresse email invalide.'), { expose: true });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (isDefault) await client.query('update email_identities set is_default = false where center_id = $1;', [centerId]);
    let result;
    if (id) {
      result = await client.query(
        'update email_identities set label = $3, email = $4, is_default = $5 where id = $1 and center_id = $2 returning *;',
        [Number(id), centerId, safeLabel, safeEmail, Boolean(isDefault)],
      );
      if (!result.rowCount) throw new Error('Identité introuvable.');
    } else {
      result = await client.query(
        'insert into email_identities (center_id, label, email, is_default) values ($1, $2, $3, $4) returning *;',
        [centerId, safeLabel, safeEmail, Boolean(isDefault)],
      );
    }
    await client.query('COMMIT');
    return mapEmailIdentity(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEmailIdentity({ id, centerId = 'libramont' }) {
  const result = await getPool().query(
    'delete from email_identities where id = $1 and center_id = $2 returning id;',
    [Number(id), centerId],
  );
  if (!result.rowCount) throw new Error('Identité introuvable.');
  return { deleted: Number(id) };
}

// Lignes agrégées pour l'analyse mails (hors simulation, canal email).
async function getEmailInsightRows({ centerId = 'libramont' } = {}) {
  const pool = getPool();
  // Les envois de test du staff (`test_<séquence>`) portent de vraies erreurs
  // de fournisseur, mais ce sont des essais : les compter dans l'analyse
  // fausserait le taux de réussite et le classement des causes d'échec.
  const notSim = "channel = 'email' and center_id = $1 and coalesce(payload->>'simulation', '') = ''"
    + " and coalesce(template_id, '') not like 'test\_%'";
  const [statusCounts, templateCounts, hourCounts, failureReasons, weeklySeries] = await Promise.all([
    pool.query(`select status, count(*)::int as count from communications where ${notSim} group by status;`, [centerId]),
    pool.query(`select coalesce(template_id, 'direct') as template_id, count(*)::int as count
      from communications where ${notSim} and created_at > now() - interval '30 days'
      group by 1 order by 2 desc limit 8;`, [centerId]),
    pool.query(`select extract(dow from created_at)::int as dow, extract(hour from created_at)::int as hour, count(*)::int as count
      from communications where ${notSim} and status = 'sent' and created_at > now() - interval '90 days'
      group by 1, 2 order by 3 desc limit 12;`, [centerId]),
    pool.query(`select coalesce(nullif(last_error, ''), 'inconnue') as reason, count(*)::int as count
      from communications where ${notSim} and status = 'failed' and created_at > now() - interval '90 days'
      group by 1 order by 2 desc limit 5;`, [centerId]),
    pool.query(`select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as count
      from communications where ${notSim} and created_at > now() - interval '8 weeks'
      group by 1 order by 1 asc;`, [centerId]),
  ]);
  return {
    statusCounts: statusCounts.rows,
    templateCounts: templateCounts.rows,
    hourCounts: hourCounts.rows,
    failureReasons: failureReasons.rows,
    weeklySeries: weeklySeries.rows,
  };
}

// --- Bilans direction (direction_reports, migration 0012) ---

function mapDirectionReport(row) {
  return {
    id: Number(row.id),
    centerId: row.center_id,
    periodType: row.period_type,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    title: row.title || '',
    bodyMd: row.body_md || '',
    generatedBy: row.generated_by || 'deterministic',
    generatedAt: row.generated_at,
    editedAt: row.edited_at,
    editedBy: row.edited_by || '',
  };
}

async function listDirectionReports({ centerId = 'libramont', limit = 24 } = {}) {
  const result = await getPool().query(
    `select * from direction_reports
     where center_id = $1
     order by period_start desc, period_type asc
     limit $2;`,
    [centerId, Math.min(Number(limit) || 24, 100)],
  );
  return result.rows.map(mapDirectionReport);
}

// Régénérer un bilan écrase le corps généré (mais on garde l'unicité
// centre+type+période : un seul bilan par semaine/mois).
async function upsertDirectionReport({ centerId, periodType, periodStart, periodEnd, title, bodyMd, generatedBy }) {
  const result = await getPool().query(
    `insert into direction_reports (center_id, period_type, period_start, period_end, title, body_md, generated_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (center_id, period_type, period_start)
     do update set period_end = excluded.period_end, title = excluded.title,
       body_md = excluded.body_md, generated_by = excluded.generated_by,
       generated_at = now(), edited_at = null, edited_by = null
     returning *;`,
    [centerId, periodType, periodStart, periodEnd, title, bodyMd, generatedBy || 'deterministic'],
  );
  return mapDirectionReport(result.rows[0]);
}

// Scope centre obligatoire côté appelant (api/ops.js passe requireConcreteCenter) :
// éditer le bilan de direction d'un AUTRE centre par id incrémental doit rendre
// 404, pas une écriture silencieuse. Le prédicat neutre ($5 = '') reste possible
// pour un futur appelant plateforme, mais l'appelant actuel ne l'utilise pas.
async function updateDirectionReportBody({ id, bodyMd, title, editedBy, centerId = '' }) {
  const result = await getPool().query(
    `update direction_reports
     set body_md = $2, title = coalesce(nullif($3, ''), title), edited_at = now(), edited_by = $4
     where id = $1 and ($5 = '' or center_id = $5)
     returning *;`,
    [Number(id), String(bodyMd || ''), String(title || ''), String(editedBy || ''), String(centerId || '')],
  );
  if (!result.rowCount) {
    const error = new Error('Bilan introuvable.');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  return mapDirectionReport(result.rows[0]);
}

// Mise à jour CIBLÉE du suivi d'activités : écrit UNIQUEMENT activity_progress, sans
// re-normaliser ni re-valider pistes/laser/créneau (cocher une activité ne change RIEN
// au planning). Évite les faux refus « Ce créneau vient de changer » / « Champ requis »
// que déclenchait le passage par updateReservation complet.
async function setReservationActivityProgress(id, centerId, activityProgress) {
  const reservationId = Number(id);
  if (!Number.isFinite(reservationId)) throw new Error('Reservation introuvable.');
  const safeCenterId = normalizeText(centerId, { fallback: 'libramont' }) || 'libramont';
  const payload = JSON.stringify(normalizeActivityProgress(activityProgress));
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `update reservations
         set activity_progress = $3::jsonb, updated_at = now()
       where id = $1 and center_id = $2
       returning *;`,
      [reservationId, safeCenterId, payload],
    );
    if (!result.rowCount) throw new Error('Reservation inexistante.');
    return mapReservation(result.rows[0]);
  } finally {
    client.release();
  }
}

module.exports = {
  TOTAL_LANES,
  allocateLanes,
  normalizeReservationPayload,
  normalizeActivityProgress,
  setReservationActivityProgress,
  applyReservationScheduleUpdates,
  createReservation,
  createCustomRequest,
  listCustomRequests,
  updateCustomRequestStatus,
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
  getDelayIncidentById,
  getReservationById,
  centerHasFabricatedReservations,
  getOpsHealth,
  getOpsJob,
  appendOpsJobStep,
  claimOpsJob,
  getLatestSimulationRun,
  getPool,
  getSimulationRun,
  listDueOpsJobs,
  listDecisionLogs,
  listDueCommunications,
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
  deriveCampaignStatus,
  readAvailabilitySnapshot,
  readAdminRangeState,
  readStaffState,
  saveAgentSuggestions,
  updateSimulationRun,
  updateCommunicationStatus,
  requeueCommunication,
  updateLaneStatus,
  updateOpsJobStatus,
  updateReservation,
  // Le vocabulaire ferme des occasions. Les deux ecritures y passent :
  // une reservation par normalizeReservationOccasion, une demande sur
  // mesure par la meme fonction depuis createCustomRequest. La fiche
  // marketing compare les deux colonnes : elle interroge cette liste au
  // lieu d en recopier une, sinon la comparaison mentirait le jour ou le
  // vocabulaire bougerait d un seul cote.
  OCCASION_VALUES,
  // La reponse du tunnel sur l arene laser : combien de parties une formule
  // y consomme. La fiche marketing (lib/center-facts) l interroge avant de
  // publier un prix, plutot que de relire les steps de son cote : annoncer
  // une formule que ensureLaserCapacity refuse est une promesse fausse.
  // Elle est pure (elle ne lit que les steps du document) et ne touche ni
  // pool ni reseau.
  countFormulaLaserGames,
  validateReservationResources,
};
