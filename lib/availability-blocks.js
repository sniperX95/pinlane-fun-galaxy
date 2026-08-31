// Blocage granulaire de la disponibilite (table availability_blocks,
// database/availability-blocks-schema.sql). Module SANS dependance vers
// lib/database.js : il ne fait que des predicats PURS + une lecture cachee
// fail-soft + un CRUD borne. Les points d'enforcement (public-availability,
// ops-engine, database) importent CE module ; jamais l'inverse (pas de cycle).
//
// DOCTRINE, verrouillee par scripts/availability-blocks-check.js :
//   1. AUCUN blocage = disponibilite STRICTEMENT identique a aujourd'hui, au
//      creneau pres. Chaque predicat rend `false` sur une liste vide : brancher
//      le module sans blocages ne retire aucun slot.
//   2. FAIL-SOFT. loadAvailabilityBlocks ne jette jamais : sur incident base,
//      il rend le dernier etat connu, ou une liste vide (donc dispo inchangee).
//      Meme mecanique de cache (TTL 30 s) que refreshCenterOverrides /
//      refreshFormuleOverrides.
//   3. PURETE. resolveBlocksForDate et les predicats ne mutent rien et ne
//      touchent pas la base : ils sont testables a la main.
//   4. BORNES COTE SERVEUR. Les ecritures valident le scope, les refs, la
//      recurrence et les heures. Le centerId est force par l'appelant (jamais
//      'all') : un centre ne pose de blocage que chez lui.
//
// UNITE DE TEMPS : les predicats raisonnent en MINUTES depuis minuit (0..1440).
// Un blocage jour entier a startMin/endMin null et couvre toute la journee ;
// sinon il couvre la plage demi-ouverte [startMin, endMin).

const SCOPE_TYPES = new Set(['center', 'lane', 'activity', 'formula']);
const RECURRENCES = new Set(['once', 'weekly']);
const CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCOPE_REF_PATTERN = /^[a-z0-9_-]{1,40}$/i;
const REASON_MAX = 200;
const CREATED_BY_MAX = 120;
const DAY_MINUTES = 24 * 60;
const TTL_MS = 30_000;

// ── Helpers temps ────────────────────────────────────────────────────────────

// 'HH:MM' | 'HH:MM:SS' | Date-like -> minutes depuis minuit, ou null.
function timeToMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
}

function minutesToTime(value) {
  if (value === null || value === undefined) return null;
  const total = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Colonne date pg (Date ou chaine) -> 'YYYY-MM-DD' ou null. Meme logique que
// dateColToStr de lib/database.js, dupliquee pour ne pas dependre du module.
function dateToISO(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const str = String(value).slice(0, 10);
  return ISO_DATE_PATTERN.test(str) ? str : null;
}

// Jour de semaine d'une date ISO, aligne sur Date.getDay() (0 = dimanche), la
// meme convention que getSchedule (lib/booking-config.js).
function dayOfWeekOf(dateISO) {
  const [year, month, day] = String(dateISO).split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

// ── Normalisation d'une ligne SQL en objet applicatif stable ─────────────────

function normalizeBlockRow(row) {
  return {
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    centerId: String(row.center_id || ''),
    scopeType: String(row.scope_type || ''),
    scopeRef: row.scope_ref === null || row.scope_ref === undefined ? null : String(row.scope_ref),
    recurrence: RECURRENCES.has(row.recurrence) ? row.recurrence : 'once',
    date: dateToISO(row.date),
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined ? null : Number(row.day_of_week),
    dateFrom: dateToISO(row.date_from),
    dateUntil: dateToISO(row.date_until),
    startMin: timeToMinutes(row.start_time),
    endMin: timeToMinutes(row.end_time),
    reason: String(row.reason || ''),
    createdBy: String(row.created_by || ''),
  };
}

// ── Resolution a la date + predicats PURS ────────────────────────────────────

// Les blocages ACTIFS pour cette date : once dont date == dateISO ; weekly dont
// day_of_week == jour(dateISO) ET dateISO dans [date_from, date_until] si bornes.
// Idempotent : re-resoudre une liste deja resolue rend le meme sous-ensemble.
function resolveBlocksForDate(blocks, dateISO) {
  if (!Array.isArray(blocks) || !ISO_DATE_PATTERN.test(String(dateISO || ''))) return [];
  const dow = dayOfWeekOf(dateISO);
  return blocks.filter((block) => {
    if (!block || !SCOPE_TYPES.has(block.scopeType)) return false;
    if (block.recurrence === 'weekly') {
      if (Number(block.dayOfWeek) !== dow) return false;
      if (block.dateFrom && dateISO < block.dateFrom) return false;
      if (block.dateUntil && dateISO > block.dateUntil) return false;
      return true;
    }
    return block.date === dateISO;
  });
}

// Un blocage couvre-t-il la MINUTE donnee ? Jour entier (start/end null) = oui.
function blockCoversMinute(block, minute) {
  if (block.startMin === null && block.endMin === null) return true;
  const start = block.startMin === null ? 0 : block.startMin;
  const end = block.endMin === null ? DAY_MINUTES : block.endMin;
  return minute >= start && minute < end;
}

// Un blocage couvre-t-il la FENETRE [startMin, endMin) ? Jour entier = oui.
// Fenetre absente (startMin/endMin non fournis) = oui (question "ce jour").
function blockCoversWindow(block, startMin, endMin) {
  if (block.startMin === null && block.endMin === null) return true;
  const bStart = block.startMin === null ? 0 : block.startMin;
  const bEnd = block.endMin === null ? DAY_MINUTES : block.endMin;
  if (startMin === null || startMin === undefined || endMin === null || endMin === undefined) return true;
  return startMin < bEnd && bStart < endMin; // chevauchement demi-ouvert
}

function isCenterClosedAt(blocks, dateISO, minute) {
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'center' && blockCoversMinute(block, minute));
}

// UNE FERMETURE ARRETE CE QUI LA TRAVERSE, PAS SEULEMENT CE QUI Y COMMENCE
// (2026-08-31). isCenterClosedAt ne regarde qu une MINUTE, celle du depart :
// une soiree privatisee de 18:00 a 24:00 laissait passer un bowling de deux
// heures lance a 17:00, qui occupait sa piste jusqu a 19:00, en pleine
// privatisation. Les portees PISTE et ACTIVITE testaient deja la fenetre
// entiere (blockCoversWindow) : c est la portee CENTRE, la plus large, qui
// etait la plus permissive.
//
// Le chevauchement est DEMI-OUVERT, comme partout ailleurs : une visite qui
// finit PILE au debut de la fermeture (16:00-18:00 contre une fermeture a
// 18:00) reste acceptee. C est la regle posee par le proprietaire, et elle
// vaut pour une fermeture comme pour une fin de journee.
//
// isCenterClosedAt est conserve : api/public-booking-meta s en sert pour
// resumer la FORME d une journee heure par heure, ce qui est bien une
// question sur une minute, pas sur une fenetre.
function isCenterClosedDuring(blocks, dateISO, startMin, endMin) {
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'center' && blockCoversWindow(block, startMin, endMin));
}

function isLaneBlockedAt(blocks, dateISO, laneNumber, startMin, endMin) {
  const lane = Number(laneNumber);
  if (!Number.isFinite(lane)) return false;
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'lane' && Number(block.scopeRef) === lane && blockCoversWindow(block, startMin, endMin));
}

function isActivityBlockedAt(blocks, dateISO, activityId, startMin, endMin) {
  const id = String(activityId || '');
  if (!id) return false;
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'activity' && String(block.scopeRef) === id && blockCoversWindow(block, startMin, endMin));
}

function isFormulaBlockedOn(blocks, dateISO, formuleId, startMin, endMin) {
  const id = String(formuleId || '');
  if (!id) return false;
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'formula' && String(block.scopeRef) === id && blockCoversWindow(block, startMin, endMin));
}

// Une formule est-elle bloquee TOUTE LA JOURNEE (blocage jour entier) ? Sert au
// message "indisponible" du tunnel, distinct d'un simple retrait de creneaux.
function isFormulaFullyBlockedOn(blocks, dateISO, formuleId) {
  const id = String(formuleId || '');
  if (!id) return false;
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'formula' && String(block.scopeRef) === id
      && block.startMin === null && block.endMin === null);
}

// Une activite est-elle bloquee TOUTE LA JOURNEE ? Pendant exact de
// isFormulaFullyBlockedOn pour le scope 'activity'. Sert au verdict public
// "laser ferme ce jour" ; un blocage de PLAGE ne repond pas oui ici (ses
// creneaux sont retires un par un par isActivityBlockedAt, au slot pres).
function isActivityFullyBlockedOn(blocks, dateISO, activityId) {
  const id = String(activityId || '');
  if (!id) return false;
  return resolveBlocksForDate(blocks, dateISO)
    .some((block) => block.scopeType === 'activity' && String(block.scopeRef) === id
      && block.startMin === null && block.endMin === null);
}

// ── Lecture cachee fail-soft (COPIE de la mecanique refreshCenterOverrides /
//    refreshFormuleOverrides : meme TTL 30 s, meme fail-soft) ─────────────────

const centerCache = new Map(); // centerId -> { blocks: [], loadedAt: number }

// Requete brute sur un "runner" (pool OU client de transaction). Isolee pour
// que le chemin cache (pool) et le chemin transactionnel (client, anti-course)
// partagent exactement le meme SQL.
async function queryBlocks(runner, centerId) {
  const result = await runner.query(
    `select id, center_id, scope_type, scope_ref, recurrence, date, day_of_week,
            date_from, date_until, start_time, end_time, reason, created_by
       from availability_blocks
      where center_id = $1;`,
    [String(centerId || '')],
  );
  return result.rows.map(normalizeBlockRow);
}

// Charge les blocages d'un centre (bruts, non resolus a une date). Cache
// TTL 30 s. Fail-soft : sur erreur, rend le dernier etat connu, sinon [].
async function loadAvailabilityBlocks(pool, centerId, { force = false } = {}) {
  const key = String(centerId || '');
  const now = Date.now();
  const entry = centerCache.get(key);
  if (!force && entry && now - entry.loadedAt < TTL_MS) return entry.blocks;
  try {
    const blocks = await queryBlocks(pool, key);
    centerCache.set(key, { blocks, loadedAt: now });
    return blocks;
  } catch (error) {
    // Un incident base ne doit jamais planter la dispo : on sert l'etat connu,
    // ou aucun blocage (comportement identique au comportement historique).
    return entry ? entry.blocks : [];
  }
}

// Rechauffe le cache comme refreshCenterOverrides : force le rechargement du
// centre donne (apres une ecriture), ou de tous les centres deja en cache.
async function refreshAvailabilityBlocks(pool, { centerId = '', force = true } = {}) {
  if (centerId) {
    await loadAvailabilityBlocks(pool, centerId, { force });
    return;
  }
  for (const key of [...centerCache.keys()]) {
    await loadAvailabilityBlocks(pool, key, { force });
  }
}

// Lecture FRAICHE sur un client de transaction (anti-course de createReservation) :
// contourne le cache, resout a la date, ne jette jamais la lecture elle-meme
// (l'appelant enveloppe l'appel dans un savepoint pour ne pas polluer la
// transaction si la table est absente). Rend les blocages ACTIFS a la date.
async function resolveBlocksOnClient(client, centerId, dateISO) {
  const blocks = await queryBlocks(client, centerId);
  return resolveBlocksForDate(blocks, dateISO);
}

// ── Ecritures bornees (CRUD) ─────────────────────────────────────────────────

function exposeError(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

function assertCenterId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'all' || !CENTER_ID_PATTERN.test(id)) {
    throw exposeError('Identifiant centre invalide (un centre precis est requis, jamais "all").');
  }
  return id;
}

// Valide + normalise une entree de blocage. centerId est impose par l'appelant.
function normalizeBlockInput(input = {}) {
  const centerId = assertCenterId(input.centerId);

  const scopeType = String(input.scopeType || '').trim().toLowerCase();
  if (!SCOPE_TYPES.has(scopeType)) throw exposeError('Portee de blocage invalide (center|lane|activity|formula).');

  let scopeRef = null;
  if (scopeType === 'center') {
    scopeRef = null;
  } else if (scopeType === 'lane') {
    const lane = Math.trunc(Number(input.scopeRef));
    if (!Number.isFinite(lane) || lane < 1 || lane > 200) throw exposeError('Numero de piste invalide.');
    scopeRef = String(lane);
  } else {
    const ref = String(input.scopeRef || '').trim();
    if (!SCOPE_REF_PATTERN.test(ref)) throw exposeError('Reference de blocage invalide (activite ou formule).');
    scopeRef = ref;
  }

  const recurrence = String(input.recurrence || 'once').trim().toLowerCase();
  if (!RECURRENCES.has(recurrence)) throw exposeError('Recurrence invalide (once|weekly).');

  let date = null;
  let dayOfWeek = null;
  let dateFrom = null;
  let dateUntil = null;
  if (recurrence === 'once') {
    date = String(input.date || '').trim();
    if (!ISO_DATE_PATTERN.test(date)) throw exposeError('Date requise pour un blocage ponctuel (YYYY-MM-DD).');
  } else {
    dayOfWeek = Math.trunc(Number(input.dayOfWeek));
    if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw exposeError('Jour de semaine requis pour un blocage hebdomadaire (0 = dimanche .. 6 = samedi).');
    }
    const rawFrom = String(input.dateFrom || '').trim();
    const rawUntil = String(input.dateUntil || '').trim();
    if (rawFrom) {
      if (!ISO_DATE_PATTERN.test(rawFrom)) throw exposeError('Borne de debut invalide (YYYY-MM-DD).');
      dateFrom = rawFrom;
    }
    if (rawUntil) {
      if (!ISO_DATE_PATTERN.test(rawUntil)) throw exposeError('Borne de fin invalide (YYYY-MM-DD).');
      dateUntil = rawUntil;
    }
    if (dateFrom && dateUntil && dateUntil < dateFrom) throw exposeError('La borne de fin precede la borne de debut.');
  }

  // Heures : les deux nulles (jour entier) ou les deux presentes avec end > start.
  const startMin = timeToMinutes(input.startTime);
  const endMin = timeToMinutes(input.endTime);
  const hasStart = input.startTime !== undefined && input.startTime !== null && input.startTime !== '';
  const hasEnd = input.endTime !== undefined && input.endTime !== null && input.endTime !== '';
  if (hasStart !== hasEnd) throw exposeError('Renseignez l heure de debut ET de fin, ou aucune (jour entier).');
  if (hasStart) {
    if (startMin === null || endMin === null) throw exposeError('Heure invalide (HH:MM).');
    if (!(endMin > startMin)) throw exposeError('L heure de fin doit suivre l heure de debut.');
  }

  return {
    centerId,
    scopeType,
    scopeRef,
    recurrence,
    date,
    dayOfWeek,
    dateFrom,
    dateUntil,
    startTime: hasStart ? minutesToTime(startMin) : null,
    endTime: hasEnd ? minutesToTime(endMin) : null,
    reason: String(input.reason || '').trim().slice(0, REASON_MAX),
    createdBy: String(input.createdBy || '').trim().slice(0, CREATED_BY_MAX),
  };
}

// Cree un blocage (ou met a jour celui d'id fourni, scope au centre). centerId
// force par l'appelant, jamais 'all' : un centre ne bloque que chez lui.
async function upsertAvailabilityBlock(pool, input = {}) {
  const value = normalizeBlockInput(input);
  const id = input.id !== undefined && input.id !== null && input.id !== '' ? Math.trunc(Number(input.id)) : null;

  if (id) {
    if (!Number.isFinite(id) || id <= 0) throw exposeError('Identifiant de blocage invalide.');
    const result = await pool.query(
      `update availability_blocks set
         scope_type = $3, scope_ref = $4, recurrence = $5, date = $6, day_of_week = $7,
         date_from = $8, date_until = $9, start_time = $10, end_time = $11,
         reason = $12, created_by = $13, updated_at = now()
       where id = $1 and center_id = $2
       returning id, center_id, scope_type, scope_ref, recurrence, date, day_of_week,
                 date_from, date_until, start_time, end_time, reason, created_by;`,
      [id, value.centerId, value.scopeType, value.scopeRef, value.recurrence, value.date, value.dayOfWeek,
        value.dateFrom, value.dateUntil, value.startTime, value.endTime, value.reason, value.createdBy],
    );
    if (!result.rowCount) throw exposeError('Blocage introuvable pour ce centre.');
    return normalizeBlockRow(result.rows[0]);
  }

  const result = await pool.query(
    `insert into availability_blocks
       (center_id, scope_type, scope_ref, recurrence, date, day_of_week,
        date_from, date_until, start_time, end_time, reason, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id, center_id, scope_type, scope_ref, recurrence, date, day_of_week,
               date_from, date_until, start_time, end_time, reason, created_by;`,
    [value.centerId, value.scopeType, value.scopeRef, value.recurrence, value.date, value.dayOfWeek,
      value.dateFrom, value.dateUntil, value.startTime, value.endTime, value.reason, value.createdBy],
  );
  return normalizeBlockRow(result.rows[0]);
}

// Supprime un blocage du centre (jamais d'un autre centre : scope center_id).
async function deleteAvailabilityBlock(pool, { centerId, id } = {}) {
  const center = assertCenterId(centerId);
  const blockId = Math.trunc(Number(id));
  if (!Number.isFinite(blockId) || blockId <= 0) throw exposeError('Identifiant de blocage invalide.');
  const result = await pool.query(
    `delete from availability_blocks where id = $1 and center_id = $2;`,
    [blockId, center],
  );
  return { ok: true, removed: result.rowCount || 0 };
}

// Liste les blocages du centre (pour l'editeur). Scope au centre en parametre.
async function listAvailabilityBlocks(pool, centerId) {
  const center = assertCenterId(centerId);
  const result = await pool.query(
    `select id, center_id, scope_type, scope_ref, recurrence, date, day_of_week,
            date_from, date_until, start_time, end_time, reason, created_by
       from availability_blocks
      where center_id = $1
      order by scope_type asc, id asc;`,
    [center],
  );
  return result.rows.map(normalizeBlockRow);
}

module.exports = {
  // predicats purs + resolution
  resolveBlocksForDate,
  isCenterClosedAt,
  isCenterClosedDuring,
  isLaneBlockedAt,
  isActivityBlockedAt,
  isFormulaBlockedOn,
  isFormulaFullyBlockedOn,
  isActivityFullyBlockedOn,
  // lecture cachee fail-soft + lecture fraiche transactionnelle
  loadAvailabilityBlocks,
  refreshAvailabilityBlocks,
  resolveBlocksOnClient,
  // CRUD borne
  upsertAvailabilityBlock,
  deleteAvailabilityBlock,
  listAvailabilityBlocks,
  // exposes pour tests/outillage
  normalizeBlockRow,
  normalizeBlockInput,
  timeToMinutes,
};
