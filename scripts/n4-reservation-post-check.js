// UNE RESERVATION DE N4 ABOUTIT-ELLE VRAIMENT ? (2026-08-21)
//
// L'erreur qui a fait passer ce bug a travers une session entiere de
// verifications : on a mesure l'AFFICHAGE. Les creneaux sortaient, le prix
// sortait, donc « c'est repare ». Sauf que le client se faisait refuser a la
// DERNIERE etape, celle qui rapporte de l'argent.
//
// Ce script mesure la seule chose qui compte : une reservation qui ABOUTIT.
// Il rejoue le parcours complet du tunnel, dans l'ordre du navigateur :
//   1. GET api/public-availability   -> le creneau, ses pistes, son plan
//   2. POST api/public-reservations  -> la reservation, ou son refus
// avec les VRAIES lignes de production, dans un faux pool.
//
// AUCUNE ECRITURE EN PRODUCTION. La vraie base n'est ouverte que pour des
// SELECT, puis fermee AVANT que le moindre handler soit charge. Les handlers ne
// voient qu'un double en memoire : leurs INSERT ne quittent jamais ce process.
//
// Quatre cas, ceux que N4 vend : Kara Box seule, bowling seul, bowling +
// Kara Box, et une de ses formules.
//
// Lancement : node scripts/n4-reservation-post-check.js
//   --center=<id>  pour mesurer un autre centre (defaut n4-bowling)
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}
const PROD_URL = process.env.DATABASE_URL;
if (!PROD_URL) {
  console.error('n4-reservation-post-check: DATABASE_URL absent du .env.');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;

const argCenter = (process.argv.find((arg) => arg.startsWith('--center=')) || '').split('=')[1];
const CENTER = argCenter || 'n4-bowling';
const FREE_ACTIVITY = 'kara-box';
const PAX = 6;

let failures = 0;
let assertions = 0;
function section(title) { console.log(`\n${title}`); }
function ok(condition, label, detail = '') {
  assertions += 1;
  if (condition) { console.log(`  [OK] ${label}${detail ? ` :: ${detail}` : ''}`); return true; }
  failures += 1;
  console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`);
  return false;
}

// ── 1. Lire la production, puis la refermer ──────────────────────────────────
async function loadProdRows(dateStr) {
  const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
  try {
    const [formulas, steps, activities, centers, clients, reservations, laneStatuses, blocks] = await Promise.all([
      pool.query('select * from formulas;'),
      pool.query('select * from formula_steps;'),
      pool.query('select * from activities;'),
      pool.query('select * from centers;'),
      pool.query('select * from clients;'),
      pool.query("select * from reservations where center_id = $1 and date = $2;", [CENTER, dateStr]),
      pool.query('select * from lane_statuses where center_id = $1;', [CENTER]),
      pool.query('select * from availability_blocks where center_id = $1;', [CENTER]).catch(() => ({ rows: [] })),
    ]);
    return {
      formulas: formulas.rows,
      steps: steps.rows,
      activities: activities.rows,
      centers: centers.rows,
      clients: clients.rows,
      reservations: reservations.rows.map((row) => ({ ...row, date: dateStr })),
      laneStatuses: laneStatuses.rows,
      blocks: blocks.rows,
      formuleOverrides: [],
    };
  } finally {
    // La vraie base est refermee AVANT tout chargement de handler : plus aucune
    // connexion de production n'existe quand le code sous mesure s'execute.
    await pool.end();
  }
}

// ── 2. Le double, qui obeit au SQL ───────────────────────────────────────────
function undefinedColumn(name, table) {
  const error = new Error(`column "${name}" does not exist (table ${table})`);
  error.code = '42703';
  return error;
}

function project(rows, columnList, table) {
  const columns = String(columnList).split(',').map((part) => part.trim()).filter(Boolean);
  if (columns.length === 1 && columns[0] === '*') return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const out = {};
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) throw undefinedColumn(column, table);
      out[column] = row[column];
    }
    return out;
  });
}

function makePool(rows) {
  const inserted = [];
  let nextReservationId = 900001;

  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)\b/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };

    const insert = sql.match(/^insert into reservations \(([^)]+)\) values \(([^)]*)\)(?: returning (.+?);?)?$/i);
    if (insert) {
      const columns = insert[1].split(',').map((part) => part.trim());
      const row = { id: nextReservationId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      columns.forEach((column, index) => {
        const value = params[index];
        row[column] = typeof value === 'string' && /^[[{]/.test(value.trim()) ? JSON.parse(value) : value;
      });
      nextReservationId += 1;
      inserted.push(row);
      rows.reservations.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^insert into /i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(update|delete|create|alter|drop|comment on)\b/i.test(sql)) return { rows: [], rowCount: 0 };

    const select = sql.match(/^select (.+?) from ([a-z_]+)\b/i);
    if (!select) return { rows: [], rowCount: 0 };
    const columnList = select[1];
    const table = select[2].toLowerCase();
    if (/pg_advisory|now\(\)|current_/i.test(columnList)) return { rows: [], rowCount: 0 };

    const direct = {
      formulas: rows.formulas,
      formula_steps: rows.steps,
      activities: rows.activities,
      centers: rows.centers,
      clients: rows.clients,
      formule_overrides: rows.formuleOverrides,
    };
    if (direct[table]) {
      const out = project(direct[table], columnList, table);
      return { rows: out, rowCount: out.length };
    }
    if (table === 'reservations') {
      const [date, centerId] = params;
      let list = rows.reservations.filter((row) => row.date === date && row.center_id === centerId);
      if (/status <> 'cancelled'/i.test(sql)) list = list.filter((row) => row.status !== 'cancelled');
      const out = project(list, columnList, table);
      return { rows: out, rowCount: out.length };
    }
    if (table === 'lane_statuses') {
      const out = project(rows.laneStatuses, columnList, table);
      return { rows: out, rowCount: out.length };
    }
    if (table === 'availability_blocks') {
      const out = project(rows.blocks, columnList, table);
      return { rows: out, rowCount: out.length };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    inserted,
    query,
    async connect() { return { query: (text, params) => query(text, params), release() {} }; },
    async end() {},
    on() {},
  };
}

// ── 3. Les vrais handlers ────────────────────────────────────────────────────
function fakeRes() {
  const out = { statusCode: 200, body: null, headers: {} };
  return {
    out,
    setHeader(key, value) { out.headers[key] = value; },
    get statusCode() { return out.statusCode; },
    set statusCode(value) { out.statusCode = value; },
    end(payload) { if (payload != null && out.body == null) out.body = payload; },
    json(payload) { out.body = JSON.stringify(payload); },
  };
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.0.0.${(ipCounter % 250) + 1}`;
}

async function callGet(handler, url) {
  const res = fakeRes();
  const ip = nextIp();
  await handler(
    { method: 'GET', url, headers: { host: 'gate.local', 'x-forwarded-for': ip }, socket: { remoteAddress: ip } },
    res,
  );
  let json = null;
  try { json = JSON.parse(res.out.body); } catch (error) { json = null; }
  return { status: res.out.statusCode, json };
}

async function callPost(handler, body) {
  const ip = nextIp();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'gate.local', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = fakeRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.out.body); } catch (error) { json = null; }
  return { status: res.out.statusCode, json };
}

function nextDow(targetDow) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== targetDow);
  return cursor.toISOString().slice(0, 10);
}

const CONTACT = { name: 'Verification interne', email: 'verification@example.com', phone: '0470000000' };

function reason(result) {
  if (!result.json) return `statut ${result.status}, corps illisible`;
  const alternatives = Array.isArray(result.json.alternatives) ? result.json.alternatives.length : null;
  const suffix = alternatives === null ? '' : ` (alternatives: ${alternatives})`;
  return `statut ${result.status} :: ${result.json.message || 'ok'}${suffix}`;
}

// Le corps que le navigateur enverrait pour le creneau retenu : mêmes champs,
// mêmes pistes, même plan. Rien n'est reformule ici.
function bodyFromSlot(slot, base) {
  return {
    centerId: CENTER,
    date: base.date,
    startTime: slot.time,
    lanes: Array.isArray(slot.lanes) ? slot.lanes : [],
    opsPlan: slot.opsPlan || null,
    pax: base.pax,
    status: 'pending',
    // La duree n'est pas devinee : le tunnel reprend celle que
    // public-availability vient de rendre pour ce creneau (c'est la formule ou
    // le programme qui la fixe, pas le navigateur).
    duration: base.duration,
    totalDuration: base.totalDuration,
    ...CONTACT,
    ...base.payload,
  };
}

(async () => {
  const DATE = nextDow(6); // samedi : N4 vend 7 EUR la partie du vendredi au dimanche
  console.log(`Centre mesure : ${CENTER} · date ${DATE} · ${PAX} personnes`);
  const rows = await loadProdRows(DATE);
  console.log(`Lignes de production lues (lecture seule, connexion refermee) : ${rows.formulas.length} formules · ${rows.activities.length} activites · ${rows.centers.length} centres · ${rows.reservations.length} reservations ce jour-la`);

  const centerRow = rows.centers.find((row) => row.id === CENTER);
  if (!centerRow) {
    console.error(`n4-reservation-post-check: le centre ${CENTER} n'existe pas en production.`);
    process.exit(1);
  }
  const fileCenters = require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.map((center) => center.id);
  console.log(`Ce centre est-il dans le FICHIER ops-knowledge/centers.json ? ${fileCenters.includes(CENTER) ? 'OUI' : 'NON (il n existe qu en base)'}`);

  const pool = makePool(rows);
  const pgPath = require.resolve(path.join(ROOT, 'node_modules', 'pg'));
  require.cache[pgPath] = {
    id: pgPath, filename: pgPath, loaded: true,
    exports: { Pool: function FakePool() { return pool; } },
  };
  const database = require(path.join(ROOT, 'lib', 'database.js'));
  database.getPool = () => pool;

  const availabilityHandler = require(path.join(ROOT, 'api', 'public-availability.js'));
  const metaHandler = require(path.join(ROOT, 'api', 'public-booking-meta.js'));
  const reservationHandler = require(path.join(ROOT, 'api', 'public-reservations.js'));

  const meta = await callGet(metaHandler, `/api/public-booking-meta?centerId=${CENTER}`);
  const formules = (meta.json && meta.json.formules) || [];
  const activityIds = ((meta.json && meta.json.activities) || []).map((activity) => activity.id);
  console.log(`Catalogue servi au tunnel : ${activityIds.join(', ') || 'aucune activite'} · ${formules.length} formule(s)`);

  // Un cas = une URL de creneaux + le corps de POST correspondant.
  const cases = [
    {
      title: `[1] ${FREE_ACTIVITY} seule`,
      pax: PAX,
      url: `/api/public-availability?centerId=${CENTER}&type=visite&date=${DATE}&pax=${PAX}&program=${encodeURIComponent(JSON.stringify([{ activityId: FREE_ACTIVITY }]))}`,
      payload: { type: 'visite', program: [{ activityId: FREE_ACTIVITY }] },
    },
    {
      title: '[2] bowling seul',
      pax: PAX,
      url: `/api/public-availability?centerId=${CENTER}&type=bowling&date=${DATE}&pax=${PAX}&duration=1`,
      payload: { type: 'bowling', duration: 1 },
    },
    {
      title: `[3] bowling + ${FREE_ACTIVITY}`,
      pax: PAX,
      url: `/api/public-availability?centerId=${CENTER}&type=visite&date=${DATE}&pax=${PAX}&program=${encodeURIComponent(JSON.stringify([{ activityId: 'bowling', duration: 1 }, { activityId: FREE_ACTIVITY }]))}`,
      payload: { type: 'visite', program: [{ activityId: 'bowling', duration: 1 }, { activityId: FREE_ACTIVITY }] },
    },
  ];
  if (formules.length) {
    const formule = formules[0];
    // Le groupe respecte le minimum DECLARE par la formule : « Min. 8
    // personnes » est une regle du produit, pas une panne. Mesurer avec 6
    // rendrait un refus legitime et masquerait ce qu'on cherche a prouver.
    const formulePax = Math.max(PAX, Number(formule.minPax) || 0);
    cases.push({
      title: `[4] formule ${formule.id} (${formulePax} personnes, min. ${formule.minPax || 1})`,
      pax: formulePax,
      url: `/api/public-availability?centerId=${CENTER}&type=formule&formuleId=${encodeURIComponent(formule.id)}&date=${DATE}&pax=${formulePax}`,
      payload: { type: 'formule', formuleId: formule.id, label: formule.name || formule.id },
    });
  }

  for (const item of cases) {
    section(`${item.title}`);
    const availability = await callGet(availabilityHandler, item.url);
    const slots = (availability.json && availability.json.slots) || [];
    const slotsOk = ok(availability.status === 200 && slots.length > 0, 'des creneaux sont proposes', `${slots.length} creneau(x), ${reason(availability)}`);
    if (!slotsOk) continue;

    // LA SEULE PREUVE QUI COMPTE : le POST aboutit.
    const answer = availability.json || {};
    const created = await callPost(reservationHandler, bodyFromSlot(slots[0], {
      date: DATE,
      pax: item.pax,
      duration: Number(answer.duration) || 0,
      totalDuration: Number(answer.totalDuration) || Number(answer.duration) || 0,
      payload: item.payload,
    }));
    const done = ok(created.status === 201, `la reservation de ${slots[0].time} ABOUTIT (201)`, reason(created));
    if (done) {
      const reservation = created.json.reservation || {};
      ok(Number(reservation.id) > 0, 'une ligne de reservation est rendue', `id ${reservation.id}, ${reservation.price} EUR, pistes ${(reservation.lanes || []).join('/') || 'aucune'}`);
    }
  }

  section('[5] Aucune ecriture n a atteint la production');
  ok(pool.inserted.length > 0, 'les INSERT ont bien ete captes par le double', `${pool.inserted.length} ligne(s) en memoire, 0 en base`);

  console.log(`\n${failures ? 'ECHEC' : 'ALL OK'} : ${assertions - failures}/${assertions} verifications`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('\nn4-reservation-post-check: ERREUR', error && (error.stack || error.message || error));
  process.exit(1);
});
