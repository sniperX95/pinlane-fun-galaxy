// Gate du BLOCAGE GRANULAIRE de la disponibilite (lib/availability-blocks.js,
// table availability_blocks, database/availability-blocks-schema.sql) et de son
// ENFORCEMENT dans le vrai moteur (lib/database.js, lib/ops-engine.js).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif (motif de scripts/catalog-overrides-check.js et
// scripts/tenant-write-scope-check.js). Le faux pool OBEIT AU TEXTE SQL : il
// insere/lit/supprime les blocages, lit les reservations et les statuts de
// piste, et rend une reservation sur insert. Un filtre retire du code retire son
// effet dans le faux pool, et l'assertion rougit.
//
// CE QUE CE GATE PROUVE (comportement, pas presence de chaine) :
//   1. resolveBlocksForDate : once (date exacte), weekly (bon jour + bornes).
//   2. predicats : jour entier vs plage horaire, bord [start, end).
//   3. enforcement bout-en-bout via les VRAIES fonctions :
//        - lane bloquee 16h-18h un mardi => cette piste indisponible 16-18 ce
//          mardi (database.allocateLanes ET ops-engine.allocateLanes), DISPO
//          avant/apres et les autres jours ;
//        - center jour entier => aucun slot (grille) + creation refusee ;
//        - formula => formule indisponible (garde de creation) ;
//        - activity laser => sessions retirees (ensureLaserCapacity), laser
//          standalone bloque via le moteur (planLaser) ET via l'activation
//          permanente activityAvailability.laser_game=false ; creneaux de
//          formule retires (getFormulaAnchorAvailability).
//   4. SANS blocage => dispo STRICTEMENT identique (au slot pres).
//   5. anti-course : createReservation refuse un creneau bloque meme si le GET
//      (cache) l'avait laisse passer (blocage pose entre GET et POST).
//   6. CRUD borne : 'all' refuse, list scope au centre.
//   + 2 contre-preuves par MUTATION (edition inverse, jamais git checkout).
//
// Lancement : node scripts/availability-blocks-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Dates de reference (verifiees ci-dessous) : mardi et mercredi NORMAUX
// (hors vacances scolaires) pour un moteur au comportement simple.
// ---------------------------------------------------------------------------
// Jours FUTURS calcules a l execution (memes raisons que availability-day :
// les dates figees de la premiere version etaient AUJOURD HUI le jour de la
// mesure, et planLaser refuse un creneau du jour deja passe : le gate etait
// vert a l aube et rouge l apres-midi, par pure horloge). On saute les
// vacances scolaires wallonnes, leur grille changerait les verdicts.
const { WALLONIA_SCHOOL_HOLIDAYS } = require('../lib/booking-config');
function prochainJour(weekday) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const enConge = (iso) => WALLONIA_SCHOOL_HOLIDAYS.some((range) => iso >= range.start && iso <= range.end);
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); }
  while (cursor.getUTCDay() !== weekday || enConge(cursor.toISOString().slice(0, 10)));
  return cursor.toISOString().slice(0, 10);
}
function plusJours(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const TUE = prochainJour(2); // mardi futur
const WED = plusJours(TUE, 1); // le mercredi qui le suit

// ---------------------------------------------------------------------------
// Etat en memoire servi par le faux pool.
// ---------------------------------------------------------------------------
const store = {
  reservations: [],
  laneRows: [], // vide => toutes pistes actives (getLaneStatusMap complete)
  blockRows: [],
};
let resSeq = 1000;
let blockSeq = 0;

function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(value); } catch (error) { return fallback; }
}

// ---------------------------------------------------------------------------
// Faux pool pg : obeit au texte SQL sur les fixtures ci-dessus.
// ---------------------------------------------------------------------------
class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);

    // Transaction / verrous : sans effet dans le faux moteur.
    if (/^\s*(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ ok: true }], rowCount: 1 };

    // ── reservations ──
    if (/insert into reservations/i.test(sql)) {
      const p = params;
      const row = {
        id: (resSeq += 1),
        center_id: p[0], channel: p[1], name: p[2], phone: p[3], email: p[4],
        date: p[5], start_time: p[6], duration: p[7], total_duration: p[8], lanes: p[9], pax: p[10],
        status: p[11], base_price: p[12], price: p[13], type: p[14], formule_id: p[15], label: p[16],
        occasion: p[17], extras: safeJson(p[18], []), payment_method: p[19], notes: p[20],
        ops_plan: p[21] ? safeJson(p[21], null) : null, risk_level: p[22], risk_score: p[23],
        validation_status: p[24], activity_progress: safeJson(p[25], {}),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      store.reservations.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/from reservations/i.test(sql)) {
      const date = params[0];
      const center = params[1];
      const rows = store.reservations.filter((r) => r.date === date && r.center_id === center && r.status !== 'cancelled');
      return { rows, rowCount: rows.length };
    }

    // ── lane_statuses ──
    if (/from lane_statuses/i.test(sql)) {
      const center = params[0];
      const rows = store.laneRows.filter((r) => r.center_id === center);
      return { rows, rowCount: rows.length };
    }

    // ── availability_blocks ──
    if (/insert into availability_blocks/i.test(sql)) {
      const p = params;
      const row = {
        id: (blockSeq += 1),
        center_id: p[0], scope_type: p[1], scope_ref: p[2], recurrence: p[3], date: p[4], day_of_week: p[5],
        date_from: p[6], date_until: p[7], start_time: p[8], end_time: p[9], reason: p[10], created_by: p[11],
      };
      store.blockRows.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/update availability_blocks/i.test(sql)) {
      const p = params;
      const row = store.blockRows.find((r) => Number(r.id) === Number(p[0]) && r.center_id === p[1]);
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        scope_type: p[2], scope_ref: p[3], recurrence: p[4], date: p[5], day_of_week: p[6],
        date_from: p[7], date_until: p[8], start_time: p[9], end_time: p[10], reason: p[11], created_by: p[12],
      });
      return { rows: [row], rowCount: 1 };
    }
    if (/delete from availability_blocks/i.test(sql)) {
      const before = store.blockRows.length;
      store.blockRows = store.blockRows.filter((r) => !(Number(r.id) === Number(params[0]) && r.center_id === params[1]));
      return { rows: [], rowCount: before - store.blockRows.length };
    }
    if (/from availability_blocks/i.test(sql)) {
      const center = params[0];
      const rows = store.blockRows.filter((r) => r.center_id === center);
      return { rows, rowCount: rows.length };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
process.env.DATABASE_SSL = 'disable';

const { Pool } = require('pg');
const pool = new Pool();

const dbPath = require.resolve('../lib/database');
const ab = require('../lib/availability-blocks');
const opsEngine = require('../lib/ops-engine');
const { applyCenterOverrides } = require('../lib/ops-knowledge');
let db = require('../lib/database');

// ---------------------------------------------------------------------------
// Fabriques de blocages (forme des lignes SQL, snake_case, comme pg).
// ---------------------------------------------------------------------------
function rawBlock(patch = {}) {
  return {
    id: patch.id || null,
    center_id: patch.center_id || 'libramont',
    scope_type: patch.scope_type,
    scope_ref: patch.scope_ref === undefined ? null : patch.scope_ref,
    recurrence: patch.recurrence || 'once',
    date: patch.date === undefined ? null : patch.date,
    day_of_week: patch.day_of_week === undefined ? null : patch.day_of_week,
    date_from: patch.date_from === undefined ? null : patch.date_from,
    date_until: patch.date_until === undefined ? null : patch.date_until,
    start_time: patch.start_time === undefined ? null : patch.start_time,
    end_time: patch.end_time === undefined ? null : patch.end_time,
    reason: patch.reason || '',
    created_by: patch.created_by || '',
  };
}

// Blocages NORMALISES (non resolus) : les predicats et le moteur re-resolvent a
// la date, donc on peut passer une liste unique + la date voulue.
function normBlocks(rawRows) {
  return rawRows.map(ab.normalizeBlockRow);
}

function baseReservation(patch = {}) {
  return {
    centerId: 'libramont',
    channel: 'public',
    name: 'Test Client',
    phone: '+32470000000',
    email: 'test@exemple.be',
    date: TUE,
    startTime: '15:00',
    duration: 1,
    pax: 6,
    type: 'bowling',
    ...patch,
  };
}

async function setStoreBlocks(rows, { refresh = true } = {}) {
  store.blockRows = rows.slice();
  if (refresh) await ab.refreshAvailabilityBlocks(pool, { centerId: 'libramont', force: true });
}

async function captureError(run) {
  try { await run(); return null; } catch (error) { return error; }
}

(async () => {
  ok(new Date(TUE + 'T12:00:00Z').getUTCDay() === 2, `${TUE} est bien un mardi (dow 2)`);
  ok(new Date(WED + 'T12:00:00Z').getUTCDay() === 3, `${WED} est bien un mercredi (dow 3)`);

  // =========================================================================
  console.log('\n[1] resolveBlocksForDate : once (date exacte) + weekly (jour + bornes)');
  // =========================================================================
  const onceBlocks = normBlocks([rawBlock({ scope_type: 'center', recurrence: 'once', date: TUE })]);
  ok(ab.resolveBlocksForDate(onceBlocks, TUE).length === 1, 'once actif a sa date exacte');
  ok(ab.resolveBlocksForDate(onceBlocks, WED).length === 0, 'once inactif un autre jour');

  const weeklyBlocks = normBlocks([rawBlock({ scope_type: 'center', recurrence: 'weekly', day_of_week: 2 })]);
  ok(ab.resolveBlocksForDate(weeklyBlocks, TUE).length === 1, 'weekly actif le bon jour de semaine (mardi)');
  ok(ab.resolveBlocksForDate(weeklyBlocks, WED).length === 0, 'weekly inactif un autre jour (mercredi)');

  const bounded = normBlocks([rawBlock({ scope_type: 'center', recurrence: 'weekly', day_of_week: 2, date_from: plusJours(TUE, 7), date_until: plusJours(TUE, 28) })]);
  ok(ab.resolveBlocksForDate(bounded, TUE).length === 0, 'weekly borne : mardi AVANT date_from => inactif');
  ok(ab.resolveBlocksForDate(bounded, plusJours(TUE, 14)).length === 1, 'weekly borne : mardi DANS [from, until] => actif');
  ok(ab.resolveBlocksForDate(bounded, plusJours(TUE, 35)).length === 0, 'weekly borne : mardi APRES date_until => inactif');

  // =========================================================================
  console.log('\n[2] predicats : jour entier vs plage horaire, bord [start, end)');
  // =========================================================================
  const fullDayCenter = normBlocks([rawBlock({ scope_type: 'center', date: TUE })]);
  ok(ab.isCenterClosedAt(fullDayCenter, TUE, 10 * 60) && ab.isCenterClosedAt(fullDayCenter, TUE, 21 * 60),
    'center jour entier : ferme a toute heure du jour');
  ok(!ab.isCenterClosedAt(fullDayCenter, WED, 10 * 60), 'center jour entier : ouvert un autre jour');

  const rangeCenter = normBlocks([rawBlock({ scope_type: 'center', date: TUE, start_time: '14:00', end_time: '16:00' })]);
  ok(!ab.isCenterClosedAt(rangeCenter, TUE, 13 * 60 + 59), 'plage : 13:59 hors plage => ouvert');
  ok(ab.isCenterClosedAt(rangeCenter, TUE, 14 * 60), 'plage : 14:00 (bord bas inclus) => ferme');
  ok(ab.isCenterClosedAt(rangeCenter, TUE, 15 * 60 + 59), 'plage : 15:59 => ferme');
  ok(!ab.isCenterClosedAt(rangeCenter, TUE, 16 * 60), 'plage : 16:00 (bord haut exclu) => ouvert');

  const laneRange = normBlocks([rawBlock({ scope_type: 'lane', scope_ref: '3', date: TUE, start_time: '16:00', end_time: '18:00' })]);
  ok(ab.isLaneBlockedAt(laneRange, TUE, 3, 16 * 60, 17 * 60), 'lane : chevauchement 16-17 dans 16-18 => bloquee');
  ok(!ab.isLaneBlockedAt(laneRange, TUE, 3, 18 * 60, 19 * 60), 'lane : 18-19 (bord [start,end)) => libre');
  ok(!ab.isLaneBlockedAt(laneRange, TUE, 3, 14 * 60, 15 * 60), 'lane : 14-15 avant la plage => libre');
  ok(!ab.isLaneBlockedAt(laneRange, TUE, 4, 16 * 60, 17 * 60), 'lane : une AUTRE piste (4) reste libre');

  const fullDayFormula = normBlocks([rawBlock({ scope_type: 'formula', scope_ref: 'f1', date: TUE })]);
  ok(ab.isFormulaFullyBlockedOn(fullDayFormula, TUE, 'f1'), 'formule jour entier detectee (isFormulaFullyBlockedOn)');
  ok(!ab.isFormulaFullyBlockedOn(normBlocks([rawBlock({ scope_type: 'formula', scope_ref: 'f1', date: TUE, start_time: '18:00', end_time: '20:00' })]), TUE, 'f1'),
    'formule PLAGE horaire n est pas un blocage jour entier');

  // =========================================================================
  console.log('\n[3] enforcement PISTE : database.allocateLanes + ops-engine.allocateLanes');
  // =========================================================================
  // Piste 3 bloquee le mardi 16h-18h. laneStatuses vide => toutes non-maintenance.
  const laneBlocks = normBlocks([rawBlock({ scope_type: 'lane', scope_ref: '3', recurrence: 'weekly', day_of_week: 2, start_time: '16:00', end_time: '18:00' })]);
  const center = require('../lib/ops-knowledge').getCenter('libramont');

  // database.allocateLanes : requiredCount 8 sur 8 pistes => une piste retiree suffit a rendre null.
  ok(db.allocateLanes(8, [], {}, '16:00', 1, 8, laneBlocks, TUE) === null,
    'database.allocateLanes : mardi 16:00, piste 3 bloquee => 8 pistes impossibles (null)');
  ok(Array.isArray(db.allocateLanes(8, [], {}, '14:00', 1, 8, laneBlocks, TUE)) && db.allocateLanes(8, [], {}, '14:00', 1, 8, laneBlocks, TUE).length === 8,
    'database.allocateLanes : mardi 14:00 (AVANT la plage) => 8 pistes OK');
  ok(Array.isArray(db.allocateLanes(8, [], {}, '18:00', 1, 8, laneBlocks, TUE)) && db.allocateLanes(8, [], {}, '18:00', 1, 8, laneBlocks, TUE).length === 8,
    'database.allocateLanes : mardi 18:00 (APRES la plage) => 8 pistes OK');
  ok(Array.isArray(db.allocateLanes(8, [], {}, '16:00', 1, 8, laneBlocks, WED)) && db.allocateLanes(8, [], {}, '16:00', 1, 8, laneBlocks, WED).length === 8,
    'database.allocateLanes : MERCREDI 16:00 (autre jour) => 8 pistes OK (weekly mardi seulement)');
  ok(Array.isArray(db.allocateLanes(8, [], {}, '16:00', 1, 8, [], TUE)) && db.allocateLanes(8, [], {}, '16:00', 1, 8, [], TUE).length === 8,
    'database.allocateLanes : SANS blocage, mardi 16:00 => 8 pistes OK (comportement historique)');

  // ops-engine.allocateLanes : start/end en MINUTES.
  ok(opsEngine.allocateLanes(center, {}, [], 16 * 60, 17 * 60, 8, laneBlocks, TUE) === null,
    'ops-engine.allocateLanes : mardi 16:00, piste 3 bloquee => null (VRAI moteur)');
  const oe18 = opsEngine.allocateLanes(center, {}, [], 18 * 60, 19 * 60, 8, laneBlocks, TUE);
  ok(Array.isArray(oe18) && oe18.length === 8, 'ops-engine.allocateLanes : mardi 18:00 => 8 pistes OK');
  const oeWed = opsEngine.allocateLanes(center, {}, [], 16 * 60, 17 * 60, 8, laneBlocks, WED);
  ok(Array.isArray(oeWed) && oeWed.length === 8, 'ops-engine.allocateLanes : mercredi 16:00 => 8 pistes OK');

  // =========================================================================
  console.log('\n[3b] enforcement CENTRE : jour entier => aucun slot + creation refusee');
  // =========================================================================
  const centerFullDay = normBlocks([rawBlock({ scope_type: 'center', date: TUE })]);
  // Grille bowling (mardi 14h-22h) : chaque depart passe le filtre isCenterClosedAt ?
  const scheduleOpen = 14; const scheduleClose = 22;
  let slotsFullDay = 0; let slotsNoBlock = 0;
  for (let value = scheduleOpen; value <= scheduleClose - 1; value += 0.5) {
    if (!ab.isCenterClosedAt(centerFullDay, TUE, Math.round(value * 60))) slotsFullDay += 1;
    if (!ab.isCenterClosedAt([], TUE, Math.round(value * 60))) slotsNoBlock += 1;
  }
  ok(slotsFullDay === 0, 'center jour entier : AUCUN depart ne passe la grille (0 slot)');
  ok(slotsNoBlock > 0, 'sans blocage : la grille garde ses departs (comportement historique)');

  // Garde de creation (la meme fonction que la garde finale du GET).
  const centerBlockErr = await captureError(() => db.validateReservationResources(baseReservation({ startTime: '15:00' }), [], {}, centerFullDay, TUE));
  ok(centerBlockErr instanceof Error && centerBlockErr.expose === true, 'validateReservationResources : centre ferme => refus expose');
  ok(!(await captureError(() => db.validateReservationResources(baseReservation({ startTime: '15:00' }), [], {}, [], TUE))),
    'validateReservationResources : SANS blocage, le meme creneau passe (identique a aujourd hui)');

  // =========================================================================
  console.log('\n[3c] enforcement FORMULE : formule bloquee => indisponible');
  // =========================================================================
  const formulaPayload = baseReservation({ type: 'formule', formuleId: 'f1', startTime: '14:00', duration: 1 });
  const formulaBlock = normBlocks([rawBlock({ scope_type: 'formula', scope_ref: 'f1', date: TUE })]);
  const formulaErr = await captureError(() => db.validateReservationResources(formulaPayload, [], {}, formulaBlock, TUE));
  ok(formulaErr instanceof Error && formulaErr.expose === true, 'validateReservationResources : formule f1 bloquee => refus expose');
  ok(!(await captureError(() => db.validateReservationResources(formulaPayload, [], {}, [], TUE))),
    'validateReservationResources : SANS blocage, la formule f1 passe');
  // Une AUTRE formule (f3) n est pas touchee par le blocage de f1.
  ok(!(await captureError(() => db.validateReservationResources(baseReservation({ type: 'formule', formuleId: 'f3', startTime: '14:00', duration: 1 }), [], {}, formulaBlock, TUE))),
    'validateReservationResources : le blocage de f1 ne touche pas f3 (portee respectee)');

  // =========================================================================
  console.log('\n[3d] enforcement ACTIVITE laser : sessions retirees + laser standalone bloque');
  // =========================================================================
  const laserPayload = baseReservation({ type: 'laser', startTime: '15:00', duration: 0.5, pax: 10 });
  const laserActivityBlock = normBlocks([rawBlock({ scope_type: 'activity', scope_ref: 'laser_game', date: TUE })]);
  // ensureLaserCapacity n est pas exportee : on l atteint par la garde finale
  // exportee validateReservationResources, qui l appelle avec les blocages.
  const laserCapErr = await captureError(() => db.validateReservationResources(laserPayload, [], {}, laserActivityBlock, TUE));
  ok(laserCapErr instanceof Error && laserCapErr.expose === true, 'validateReservationResources : laser_game bloque => refus expose (ensureLaserCapacity)');
  ok(!(await captureError(() => db.validateReservationResources(laserPayload, [], {}, [], TUE))),
    'validateReservationResources : SANS blocage, la session laser passe');

  // Laser standalone via le VRAI moteur (planLaser lit context.blocks).
  const laserPlanBlocked = opsEngine.planLaser({ centerId: 'libramont', date: TUE, pax: 10, startTime: '15:00', duration: 0.5 },
    { reservations: [], laneStatuses: {}, blocks: laserActivityBlock });
  ok(laserPlanBlocked.ok === false, 'planLaser : activite laser bloquee => aucun creneau (ok:false)');
  const laserPlanFree = opsEngine.planLaser({ centerId: 'libramont', date: TUE, pax: 10, startTime: '15:00', duration: 0.5 },
    { reservations: [], laneStatuses: {}, blocks: [] });
  ok(laserPlanFree.ok === true, 'planLaser : SANS blocage => creneau laser disponible');

  // Activation PERMANENTE : decocher laser_game (activityAvailability) bloque le laser standalone.
  applyCenterOverrides(new Map([['libramont', { activityAvailability: { laser_game: false } }]]));
  const laserPermOff = opsEngine.planLaser({ centerId: 'libramont', date: TUE, pax: 10, startTime: '15:00', duration: 0.5 }, { reservations: [], laneStatuses: {} });
  applyCenterOverrides(new Map());
  ok(laserPermOff.ok === false, 'planLaser : activityAvailability.laser_game=false => laser standalone bloque');
  ok(opsEngine.planLaser({ centerId: 'libramont', date: TUE, pax: 10, startTime: '15:00', duration: 0.5 }, { reservations: [], laneStatuses: {} }).ok === true,
    'planLaser : activation restauree => laser standalone de nouveau disponible');

  // Creneaux de FORMULE utilisant le laser retires (getFormulaAnchorAvailability, moteur).
  const anchorBlocked = opsEngine.getFormulaAnchorAvailability({ centerId: 'libramont', formuleId: 'f1', date: TUE, pax: 6 },
    { reservations: [], laneStatuses: {}, blocks: laserActivityBlock });
  ok(anchorBlocked.ok === false, 'getFormulaAnchorAvailability : laser bloque => aucune heure pour f1 (ok:false)');
  const anchorFree = opsEngine.getFormulaAnchorAvailability({ centerId: 'libramont', formuleId: 'f1', date: TUE, pax: 6 },
    { reservations: [], laneStatuses: {}, blocks: [] });
  ok(anchorFree.ok === true && anchorFree.activities.some((a) => a.activityId === 'laser_game' && a.times.length > 0),
    'getFormulaAnchorAvailability : SANS blocage => des heures laser proposees');

  // =========================================================================
  console.log('\n[4] SANS blocage : readAvailabilitySnapshot expose blocks:[] et rien ne change');
  // =========================================================================
  await setStoreBlocks([]);
  const snapEmpty = await db.readAvailabilitySnapshot(TUE, 'libramont');
  ok(Array.isArray(snapEmpty.blocks) && snapEmpty.blocks.length === 0, 'snapshot.blocks est un tableau vide sans blocage');
  ok(Array.isArray(snapEmpty.reservations) && snapEmpty.laneStatuses && typeof snapEmpty.laneStatuses === 'object',
    'snapshot conserve reservations + laneStatuses (champ blocks purement additif)');
  await setStoreBlocks([rawBlock({ scope_type: 'lane', scope_ref: '5', date: TUE, start_time: '16:00', end_time: '18:00' })]);
  const snapBlocked = await db.readAvailabilitySnapshot(TUE, 'libramont');
  ok(snapBlocked.blocks.length === 1 && snapBlocked.blocks[0].scopeType === 'lane' && Number(snapBlocked.blocks[0].scopeRef) === 5,
    'snapshot.blocks contient le blocage resolu a la date (lane 5)');
  const snapWed = await db.readAvailabilitySnapshot(WED, 'libramont');
  ok(snapWed.blocks.length === 0, 'snapshot un autre jour : le blocage ponctuel de mardi ne remonte pas');

  // =========================================================================
  console.log('\n[5] anti-course : createReservation refuse un creneau bloque pose APRES le GET');
  // =========================================================================
  // GET : aucun blocage, cache chaud vide.
  await setStoreBlocks([]);
  const okCreate = await db.createReservation(baseReservation({ startTime: '15:00' }));
  ok(okCreate && Number(okCreate.id) > 0, 'sans blocage : le creneau se reserve (le GET l aurait laisse passer)');

  // Blocage pose APRES le GET : on ecrit le store SANS rechauffer le cache (le
  // GET, cached, ne le verrait pas encore). createReservation relit FRAIS dans
  // la transaction (resolveBlocksOnClient, hors cache) et doit refuser.
  await setStoreBlocks([rawBlock({ scope_type: 'center', date: TUE })], { refresh: false });
  const cachedGet = await ab.loadAvailabilityBlocks(pool, 'libramont'); // cache encore vide
  ok(cachedGet.length === 0, 'le cache GET est encore vide (fenetre de course reelle)');
  const raceErr = await captureError(() => db.createReservation(baseReservation({ startTime: '15:00' })));
  ok(raceErr instanceof Error, 'createReservation refuse le creneau desormais bloque (relecture fraiche dans la transaction)');
  ok(store.reservations.filter((r) => r.date === TUE && r.start_time === '15:00' && r.status !== 'cancelled' && r.center_id === 'libramont').length === 1,
    'aucune reservation fantome ecrite pendant le refus (seule celle du GET subsiste)');

  // =========================================================================
  console.log('\n[6] CRUD borne : centerId force, "all" refuse, list scope au centre');
  // =========================================================================
  await setStoreBlocks([]);
  const created = await ab.upsertAvailabilityBlock(pool, { centerId: 'libramont', scopeType: 'lane', scopeRef: '2', recurrence: 'once', date: TUE, startTime: '10:00', endTime: '12:00', reason: 'entretien' });
  ok(created && created.id > 0 && created.scopeType === 'lane' && Number(created.scopeRef) === 2, 'upsertAvailabilityBlock cree un blocage borne');
  const listed = await ab.listAvailabilityBlocks(pool, 'libramont');
  ok(listed.length === 1 && listed[0].id === created.id, 'listAvailabilityBlocks rend le blocage du centre');
  const allRejected = await captureError(() => ab.upsertAvailabilityBlock(pool, { centerId: 'all', scopeType: 'center', recurrence: 'once', date: TUE }));
  ok(allRejected instanceof Error && allRejected.expose === true, 'upsertAvailabilityBlock refuse centerId "all" (un centre ne bloque que chez lui)');
  const badScope = await captureError(() => ab.upsertAvailabilityBlock(pool, { centerId: 'libramont', scopeType: 'lane', recurrence: 'once', date: TUE }));
  ok(badScope instanceof Error, 'upsertAvailabilityBlock refuse un scope lane sans numero de piste');
  const badHours = await captureError(() => ab.upsertAvailabilityBlock(pool, { centerId: 'libramont', scopeType: 'center', recurrence: 'once', date: TUE, startTime: '16:00', endTime: '14:00' }));
  ok(badHours instanceof Error, 'upsertAvailabilityBlock refuse end_time <= start_time');
  const removed = await ab.deleteAvailabilityBlock(pool, { centerId: 'libramont', id: created.id });
  ok(removed.removed === 1 && (await ab.listAvailabilityBlocks(pool, 'libramont')).length === 0, 'deleteAvailabilityBlock retire le blocage du centre');

  // =========================================================================
  console.log('\n[7] contre-preuves par MUTATION (edition inverse, le gate sait rougir)');
  // =========================================================================
  async function withMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(dbPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`availability-blocks-check: ancre de mutation introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`availability-blocks-check: mutation sans effet sur le fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(dbPath, mutated);
    let holds = true;
    try {
      delete require.cache[dbPath];
      holds = await probe(require('../lib/database'));
    } finally {
      fs.writeFileSync(dbPath, original); // restauration par EDITION INVERSE
      delete require.cache[dbPath];
      db = require('../lib/database');
    }
    if (holds) {
      console.error(`availability-blocks-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l invariant est viole, le gate ROUGIRAIT`);
    const restored = await probe(db);
    ok(restored, `restauration inverse "${label}" : l invariant tient de nouveau`);
  }

  // Sonde PISTE : la piste 3 bloquee mardi 16:00 rend 8 pistes impossibles (null).
  const laneProbe = async (mod) => mod.allocateLanes(8, [], {}, '16:00', 1, 8, laneBlocks, TUE) === null;
  await withMutation(
    '&& !isLaneBlockedAt(blocks, dateISO, lane, startMin, endMin)',
    '&& true',
    laneProbe,
    'filtre de piste bloquee neutralise dans allocateLanes',
  );

  // Sonde ANTI-COURSE : createReservation refuse un creneau bloque (center jour entier).
  const raceProbe = async (mod) => {
    await setStoreBlocks([rawBlock({ scope_type: 'center', date: TUE })], { refresh: false });
    const err = await captureError(() => mod.createReservation(baseReservation({ startTime: '15:30' })));
    return err instanceof Error; // invariant tient si la creation est refusee
  };
  // Depuis le deplacement d activite (2026-10-05), « const blocks = await
  // resolveBlocksOnClient(...) » existe aussi dans updateReservation : l ancre
  // garde deux espaces devant `blocks`, que seule l affectation de
  // createReservation porte (l autre a « const » devant).
  await withMutation(
    '  blocks = await resolveBlocksOnClient(client, payload.centerId, payload.date);',
    '  blocks = [];',
    raceProbe,
    'relecture fraiche des blocages retiree de createReservation (fenetre de course rouverte)',
  );

  await setStoreBlocks([]);

  if (failures) {
    console.error(`\navailability-blocks-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\navailability-blocks-check: ALL OK');
})().catch((error) => {
  console.error('availability-blocks-check: exception', error);
  process.exit(1);
});
