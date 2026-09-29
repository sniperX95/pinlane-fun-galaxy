// UN CENTRE NE DANS LA CONSOLE PEUT-IL ENCAISSER UNE RESERVATION ? (2026-08-21)
//
// Mesure sur la production : sur le tunnel d'un centre cree depuis la console
// (absent de ops-knowledge/centers.json), VALIDER une reservation echouait,
// alors que l'etape des creneaux, elle, affichait tout normalement.
//   activite LIBRE cochee -> HTTP 422 « Choisissez au moins une activite. »
//   bowling               -> HTTP 409 « Ce creneau ne peut pas etre planifie »
//                            avec alternatives: [] (aucune piste connue).
//
// LA CAUSE : api/public-reservations rechauffait le catalogue et les prix, mais
// PAS les overrides de centre. Sur une instance serverless fraiche, getCenter
// ne connaissait donc que les centres du FICHIER. Un centre absent du fichier
// n'avait ni horaire, ni pistes, ni activityAvailability : listCenterActivities
// ne retenait aucune activite libre (elle n'est gardee que si le centre l'a
// COCHEE), le programme partait vide, et reservation-request refusait en 422.
// Les deux autres handlers publics (public-availability, public-booking-meta)
// faisaient l'appel : c'est pour ca que l'AFFICHAGE marchait et que le bug a
// traverse une session entiere de verifications.
//
// CE QUE CE GATE PROUVE, sur le VRAI handler et de bout en bout :
//   [1] activite libre seule sur un centre ne en base  -> 201, resa creee
//   [2] bowling seul sur ce meme centre                -> 201, pistes attribuees
//   [3] bowling + activite libre                       -> 201, les deux lignes
//   [4] un centre du FICHIER n'a pas regresse          -> 201
//   [5] CONTRE-PREUVE par mutation : on neutralise la ligne ajoutee dans
//       api/public-reservations.js, le cas [1] doit RETROUVER un refus (404
//       « Centre inconnu » depuis le 2026-09-14, 422 avant), puis
//       restauration par ecriture inverse exacte (jamais git checkout).
//
// Zero reseau, zero base : un double Postgres alimente en memoire, qui OBEIT au
// SQL (il projette les colonnes demandees par la requete et rend l'erreur
// 42703 sur une colonne absente, comme le ferait une base pre-migration).
//
// Lancement : node scripts/center-console-reservation-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'public-reservations.js');

// Aucune chance d'atteindre une vraie base : pg est remplace plus bas, et
// l'URL pointe volontairement dans le vide.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
delete process.env.VERCEL;

// Le centre du gate n'existe QUE en base : son id ne figure pas dans
// ops-knowledge/centers.json (libramont, gembloux, ciney). C'est exactement la
// situation d'un centre cree depuis la console.
const CENTER = 'gate-console-centre';
const CLIENT = 'gate-client';
const FREE_ACTIVITY = 'gate-salle-libre';
const FILE_CENTER = 'libramont';

let failures = 0;
let assertions = 0;
function ok(cond, label, detail) {
  assertions += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ── Le double Postgres ───────────────────────────────────────────────────────
//
// Regle du depot : un double OBEIT au SQL. Il lit la liste de colonnes DANS la
// requete et ne rend que celles-la ; une colonne absente de la fixture leve
// l'erreur 42703 (undefined_column) comme un vrai Postgres, ce dont
// lib/catalog-store se sert pour detecter une base pre-migration.
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

function makePool(state) {
  const emitted = [];
  let nextReservationId = 9001;

  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    emitted.push(sql);

    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)\b/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };

    // INSERT de reservation : la ligne rendue est construite depuis les COLONNES
    // citees par la requete et les parametres, dans leur ordre. Repondre une
    // ligne toute faite reviendrait a repondre a la place du code.
    const insert = sql.match(/^insert into reservations \(([^)]+)\) values \(([^)]*)\)(?: returning (.+?);?)?$/i);
    if (insert) {
      const columns = insert[1].split(',').map((part) => part.trim());
      const row = { id: nextReservationId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      columns.forEach((column, index) => {
        const value = params[index];
        row[column] = typeof value === 'string' && /^[[{]/.test(value.trim())
          ? JSON.parse(value)
          : value;
      });
      nextReservationId += 1;
      state.reservations.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^insert into /i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(update|delete|create|alter|drop|comment on)\b/i.test(sql)) return { rows: [], rowCount: 0 };

    const select = sql.match(/^select (.+?) from ([a-z_]+)\b/i);
    if (!select) return { rows: [], rowCount: 0 };
    const columnList = select[1];
    const table = select[2].toLowerCase();

    if (/pg_advisory|now\(\)|current_/i.test(columnList)) return { rows: [], rowCount: 0 };

    if (table === 'centers') {
      const rows = project(state.centers, columnList, table);
      return { rows, rowCount: rows.length };
    }
    if (table === 'formulas') {
      const rows = project(state.formulas, columnList, table);
      return { rows, rowCount: rows.length };
    }
    if (table === 'formula_steps') {
      const rows = project(state.steps, columnList, table);
      return { rows, rowCount: rows.length };
    }
    if (table === 'activities') {
      const rows = project(state.activities, columnList, table);
      return { rows, rowCount: rows.length };
    }
    if (table === 'reservations') {
      // Le filtre du SQL est APPLIQUE, pas devine : date et centre viennent des
      // parametres, l'exclusion des annulees vient de la clause.
      const [date, centerId] = params;
      let rows = state.reservations.filter((row) => row.date === date && row.center_id === centerId);
      if (/status <> 'cancelled'/i.test(sql)) rows = rows.filter((row) => row.status !== 'cancelled');
      return { rows: project(rows, columnList, table), rowCount: rows.length };
    }
    // lane_statuses, availability_blocks, formule_overrides, ops_* : le centre
    // du gate n'en a aucune. C'est le cas le PLUS favorable a la vente, donc le
    // plus severe si quelque chose refuse quand meme.
    return { rows: [], rowCount: 0 };
  }

  return {
    emitted,
    query,
    async connect() { return { query: (text, params) => query(text, params), release() {} }; },
    async end() {},
    on() {},
  };
}

// ── La fixture : un centre qui n'existe qu'en base ───────────────────────────
const OPEN_DAY = { open: '10:00', close: '23:00' };
function fixture() {
  return {
    centers: [{
      id: CENTER,
      client_id: CLIENT,
      name: 'Centre de la console',
      status: 'active',
      timezone: 'Europe/Brussels',
      settings: {
        config: {
          status: 'active',
          resources: { bowling: { laneCount: 6, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 }, laser: null, partyTables: null },
          // La case que la direction coche dans Etablissement. Sans les
          // overrides de centre rechauffes, personne ne la lit.
          activityAvailability: { bowling: true, [FREE_ACTIVITY]: true },
          defaultSchedule: {
            regular: { 0: OPEN_DAY, 1: OPEN_DAY, 2: OPEN_DAY, 3: OPEN_DAY, 4: OPEN_DAY, 5: OPEN_DAY, 6: OPEN_DAY },
            holiday: {},
          },
        },
      },
    }],
    // Le catalogue de ce centre lui appartient : un centre ne dans la console
    // part d'un catalogue vide et n'a que ce qu'il cree (catalog-store,
    // FILE_SEED_OWNER_CLIENT_ID).
    activities: [
      {
        id: 'bowling', center_id: CENTER, owner_client_id: CLIENT, name: 'Bowling',
        resource_type: 'bowling_lane', duration_model: { type: 'fixed_or_selected', defaultMinutes: 60 },
        service_model: null, risk_drivers: null, planning_pressure: null,
        bookable: true, price_type: 'grid_bowling', price_value: null, price_unit: 'par piste',
        booking_order: 1, source: 'custom', active: true, pricing: null,
      },
      {
        id: FREE_ACTIVITY, center_id: CENTER, owner_client_id: CLIENT, name: 'Salle privative',
        resource_type: 'soft_capacity', duration_model: { type: 'package_window', defaultMinutes: 60 },
        service_model: null, risk_drivers: null, planning_pressure: null,
        bookable: true, price_type: 'per_pax', price_value: 10, price_unit: 'par personne',
        booking_order: 2, source: 'custom', active: true, pricing: null,
      },
    ],
    formulas: [],
    steps: [],
    reservations: [],
  };
}

// ── Le VRAI handler, sur un registre de modules frais ────────────────────────
//
// Les caches de lib/ops-knowledge et lib/catalog-store vivent au niveau module
// (TTL de 30 s) : sans purge, le deuxieme cas herite de l'etat du premier et ne
// prouverait plus rien. On ne purge que les modules du depot, jamais pg (qui
// doit rester remplace) ni le reste de node_modules.
const PG_PATH = require.resolve('pg');
let activePool = null;
require.cache[PG_PATH] = {
  id: PG_PATH,
  filename: PG_PATH,
  loaded: true,
  exports: { Pool: function FakePool() { return activePool; } },
};

function purgeRepoModules() {
  for (const key of Object.keys(require.cache)) {
    if (key === PG_PATH) continue;
    if (!key.startsWith(ROOT)) continue;
    if (key.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (key === __filename) continue;
    delete require.cache[key];
  }
}

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

// Le POST tel que le tunnel l'envoie. lib/http readJson consomme la requete
// comme un flux (`for await (const chunk of req)`) : un objet avec un `on()`
// bricole ne suffirait pas, on passe donc un VRAI Readable.
function fakeReq(body, ip) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/api/public-reservations';
  req.headers = { host: 'gate.local', 'content-type': 'application/json', 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  return req;
}

let ipCounter = 0;
async function postReservation(body) {
  purgeRepoModules();
  activePool = makePool(fixture());
  const handler = require(HANDLER_PATH);
  // Une IP differente par appel : le limiteur de debit du handler (10 par
  // minute) ne doit jamais etre la raison d'un refus dans ce gate.
  ipCounter += 1;
  const res = fakeRes();
  await handler(fakeReq(body, `10.0.0.${ipCounter}`), res);
  let json = null;
  try { json = JSON.parse(res.out.body); } catch (error) { json = null; }
  return { status: res.out.statusCode, json, pool: activePool };
}

function nextDate(offsetDays) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return cursor.toISOString().slice(0, 10);
}

// UN JOUR OU LIBRAMONT OUVRE. Le centre du gate est ouvert 7 j/7, mais le
// cas [4] (non-regression) reserve chez LIBRAMONT : « aujourd hui + 7 »
// tombait un lundi sur sept sur son jour de fermeture et le gate rougissait
// tout seul (mesure le 2026-08-24, meme maladie que le selecteur de date de
// run-ops-tests, corrigee le meme jour). Un gate qui depend du jour ou on le
// lance apprend a ignorer ses rouges.
const DATE = (() => {
  const { getSchedule } = require(path.join(ROOT, 'lib', 'booking-config.js'));
  for (let offset = 7; offset <= 20; offset += 1) {
    const candidate = nextDate(offset);
    if (getSchedule(candidate)) return candidate;
  }
  return nextDate(7);
})();

// Le corps EXACT que le tunnel envoie (assets/app-main.js) : il porte les
// pistes du creneau que le client vient de choisir. Un POST sans `lanes` serait
// refuse pour une raison qui n'a rien a voir avec ce qu'on mesure ici.
const CONTACT = { name: 'Gate Console', email: 'gate@example.com', phone: '0470000000' };

function visitBody(centerId, items, lanes = []) {
  return {
    centerId,
    type: 'visite',
    program: items,
    date: DATE,
    startTime: '15:00',
    pax: 6,
    lanes,
    ...CONTACT,
  };
}

function bowlingBody(centerId) {
  return {
    centerId, type: 'bowling', date: DATE, startTime: '15:00', duration: 1, pax: 6, lanes: [1],
    ...CONTACT,
  };
}

function reason(result) {
  if (!result.json) return `statut ${result.status}, corps illisible`;
  return `statut ${result.status} :: ${result.json.message || result.json.error || 'ok'}`;
}

(async () => {
  console.log(`[0] Le centre du gate est bien ABSENT du fichier (date de test ${DATE})`);
  const fileCenters = require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.map((center) => center.id);
  ok(!fileCenters.includes(CENTER), `${CENTER} n'est pas dans ops-knowledge/centers.json`, fileCenters.join(', '));
  ok(fileCenters.includes(FILE_CENTER), `${FILE_CENTER} y est (temoin de non-regression)`);

  console.log('\n[1] Une activite LIBRE seule, sur un centre ne dans la console');
  const free = await postReservation(visitBody(CENTER, [{ activityId: FREE_ACTIVITY }]));
  const freeCreated = ok(free.status === 201, 'la reservation est CREEE (201)', reason(free));
  if (freeCreated) {
    const program = free.json && free.json.reservation && free.json.reservation.program;
    const ids = program && Array.isArray(program.items) ? program.items.map((item) => item.activityId) : [];
    ok(ids.includes(FREE_ACTIVITY), "l'activite libre est bien au programme", ids.join(', ') || 'aucune');
    ok(Number(free.json.reservation.price) === 60, 'et elle est facturee 10 EUR x 6 personnes', `${free.json.reservation.price} EUR`);
  }

  console.log('\n[2] Le bowling seul, sur ce meme centre');
  const bowling = await postReservation(bowlingBody(CENTER));
  const bowlingCreated = ok(bowling.status === 201, 'la reservation est CREEE (201)', reason(bowling));
  if (bowlingCreated) {
    const lanes = (bowling.json.reservation && bowling.json.reservation.lanes) || [];
    ok(lanes.length > 0, 'des pistes REELLES du centre lui sont attribuees', lanes.join(', ') || 'aucune');
  }

  console.log('\n[3] Bowling + activite libre dans la meme visite');
  const both = await postReservation(visitBody(CENTER, [{ activityId: 'bowling', duration: 1 }, { activityId: FREE_ACTIVITY }], [1]));
  const bothCreated = ok(both.status === 201, 'la reservation est CREEE (201)', reason(both));
  if (bothCreated) {
    const program = both.json.reservation && both.json.reservation.program;
    const ids = program && Array.isArray(program.items) ? program.items.map((item) => item.activityId) : [];
    ok(ids.includes('bowling') && ids.includes(FREE_ACTIVITY), 'les DEUX lignes sont au programme', ids.join(', ') || 'aucune');
  }

  console.log('\n[4] Non-regression : un centre du FICHIER reserve toujours');
  const legacy = await postReservation(bowlingBody(FILE_CENTER));
  ok(legacy.status === 201, `${FILE_CENTER} cree toujours sa reservation (201)`, reason(legacy));

  console.log('\n[5] CONTRE-PREUVE : sans la ligne ajoutee, le centre ne dans la console redevient inconnu');
  // Le rechauffage vit dans lib/demande-publique.js depuis le 2026-09-29
  // (les portes d une demande publique, partagees avec le blocage des
  // horaires) : c est la que la contre-preuve le retire.
  const PORTE_PATH = path.join(ROOT, 'lib', 'demande-publique.js');
  const original = fs.readFileSync(PORTE_PATH, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const anchor = 'try { await refreshCenterOverrides(getPool()); }';
  const occurrences = original.split(anchor).length - 1;
  if (occurrences !== 1) {
    console.error(`center-console-reservation-check: ancre de mutation introuvable ou ambigue (${occurrences}). Le correctif attendu dans lib/demande-publique.js n'est pas la.`);
    process.exit(1);
  }
  const mutated = original.replace(anchor, `try { await Promise.resolve(); /* mutation gate */ }`);
  fs.writeFileSync(PORTE_PATH, mutated);
  let mutatedResult = null;
  try {
    mutatedResult = await postReservation(visitBody(CENTER, [{ activityId: FREE_ACTIVITY }]));
  } finally {
    fs.writeFileSync(PORTE_PATH, original); // ECRITURE INVERSE exacte
  }
  // Depuis le 2026-09-14 (public-center-guard-check), le handler refuse un
  // centre inconnu en 404 AVANT de construire la visite. Sans le rechauffage,
  // le centre ne dans la console est inconnu d'une instance froide : le refus
  // attendu est donc ce 404, et non plus le 422 « Choisissez au moins une
  // activite » d'avant, qui arrivait plus loin pour la meme cause.
  const redAgain = ok(
    Boolean(mutatedResult && mutatedResult.status === 404 && /inconnu/i.test(String((mutatedResult.json && mutatedResult.json.message) || ''))),
    'mutation : le handler refuse de nouveau, en 404 « Centre inconnu » (le gate SAIT rougir)',
    mutatedResult ? reason(mutatedResult) : 'aucune reponse',
  );
  ok(fs.readFileSync(PORTE_PATH, 'utf8') === original, `restauration : ${path.basename(PORTE_PATH)} identique a l'original`);
  ok(eol === '\r\n' || eol === '\n', 'fins de ligne preservees', eol === '\r\n' ? 'CRLF' : 'LF');
  if (!redAgain) {
    console.error('center-console-reservation-check: MUTATION SANS EFFET, ce gate ne prouve rien.');
    process.exit(1);
  }

  console.log('\n[6] Apres restauration, le cas [1] repasse au vert');
  const restored = await postReservation(visitBody(CENTER, [{ activityId: FREE_ACTIVITY }]));
  ok(restored.status === 201, 'la reservation est de nouveau CREEE (201)', reason(restored));

  if (failures) {
    console.error(`\ncenter-console-reservation-check: ${failures} FAIL sur ${assertions} verifications`);
    process.exit(1);
  }
  console.log(`\ncenter-console-reservation-check: ALL OK (${assertions} verifications, contre-preuve par mutation incluse)`);
  process.exit(0);
})().catch((error) => {
  console.error('center-console-reservation-check: exception', error && (error.stack || error));
  process.exit(1);
});
