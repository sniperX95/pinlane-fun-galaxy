// N4 PEUT-IL ENCORE VENDRE SES PARTIES DE BOWLING ET SA KARA BOX ? (2026-08-21)
//
// Movsar : « si jamais les parties de bowling et de karaoke la pour N4 Bowling
// ne fonctionnent pas hein ».
//
// Question legitime : le chantier retire 11 activites du catalogue de N4 (celles
// de Fun Galaxy) et deplace le socle vers son proprietaire. Ce script verifie
// que ce qui reste MARCHE, avant tout deploiement.
//
// METHODE : il LIT la production (aucune ecriture), applique la migration 0044
// EN MEMOIRE, puis exerce les VRAIS handlers HTTP du tunnel avec ces lignes-la :
//   api/public-booking-meta  -> ce que N4 propose et a quel prix
//   api/public-availability  -> les creneaux et le montant d'une partie
// Aucune reformulation : ce sont les memes fichiers que la production sert.
//
// Lancement : node scripts/n4-booking-after-seed-check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const PROD_URL = process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;

const CENTER = 'n4-bowling';
const SEED_OWNER = 'fungalaxy';

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

// ── 1. Lire la production, puis appliquer 0044 EN MEMOIRE ────────────────────
async function loadProdRows() {
  const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
  const [formulas, steps, activities, centers, clients] = await Promise.all([
    pool.query('select * from formulas;'),
    pool.query('select * from formula_steps;'),
    pool.query('select * from activities;'),
    pool.query('select * from centers;'),
    pool.query('select * from clients;'),
  ]);
  await pool.end();
  return {
    formulas: formulas.rows,
    steps: steps.rows,
    activities: activities.rows,
    centers: centers.rows,
    clients: clients.rows,
  };
}

// Miroir EXACT de database/catalog-seed-ownership-schema.sql, applique aux
// lignes en memoire : d'abord la copie des activites du socle citees par les
// etapes d'un autre client, puis le deplacement du socle vers son proprietaire.
function applyMigration0044(rows) {
  const activities = rows.activities.map((row) => ({ ...row }));
  const usersOfSeed = new Set();
  for (const step of rows.steps) {
    const owner = String(step.owner_client_id || '');
    if (!owner || owner === 'all' || owner === SEED_OWNER) continue;
    if (!step.activity_id) continue;
    usersOfSeed.add(`${owner}|${step.activity_id}`);
  }
  const copies = [];
  for (const key of usersOfSeed) {
    const [owner, activityId] = key.split('|');
    const base = activities.find((a) => a.id === activityId && String(a.owner_client_id) === 'all');
    if (!base) continue;
    const already = activities.some((a) => a.id === activityId && a.center_id === base.center_id && String(a.owner_client_id) === owner);
    if (already) continue;
    copies.push({ ...base, owner_client_id: owner });
  }
  activities.push(...copies);
  for (const row of activities) {
    if (String(row.owner_client_id) === 'all') row.owner_client_id = SEED_OWNER;
  }
  return { ...rows, activities, copies };
}

// ── 2. Un faux pool alimente par ces lignes-la ───────────────────────────────
function makePool(rows) {
  const norm = (text) => String(text).replace(/\s+/g, ' ').trim();
  return {
    async query(text, params = []) {
      const sql = norm(text);
      if (/^(begin|commit|rollback)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/^(create|alter|drop|comment on)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/from formula_steps/i.test(sql)) return { rows: rows.steps, rowCount: rows.steps.length };
      if (/from formulas/i.test(sql)) return { rows: rows.formulas, rowCount: rows.formulas.length };
      if (/from activities/i.test(sql)) return { rows: rows.activities, rowCount: rows.activities.length };
      if (/from centers/i.test(sql)) return { rows: rows.centers, rowCount: rows.centers.length };
      if (/from clients/i.test(sql)) return { rows: rows.clients, rowCount: rows.clients.length };
      // Le tunnel lit aussi les reservations, blocages et statuts de piste :
      // un centre VIDE de reservations est le cas le plus favorable a la vente,
      // donc le plus severe si quelque chose refuse quand meme.
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: (t, p) => this.query(t, p), release() {} }; },
    async end() {},
    on() {},
  };
}

function fakeRes() {
  const out = { statusCode: 200, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    get statusCode() { return out.statusCode; },
    set statusCode(v) { out.statusCode = v; },
    end(payload) { if (payload && out.body == null) out.body = payload; },
    json(payload) { out.body = JSON.stringify(payload); },
  };
}

async function callHandler(handler, url) {
  const res = fakeRes();
  await handler({ method: 'GET', url, headers: { host: 'gate.local' }, socket: {} }, res);
  let parsed = null;
  try { parsed = JSON.parse(res.out.body); } catch (error) { parsed = null; }
  return { status: res.out.statusCode, json: parsed, raw: res.out.body };
}

function nextDow(targetDow) {
  const d = new Date();
  for (let i = 1; i <= 8; i += 1) {
    const probe = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (probe.getDay() === targetDow) {
      return `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, '0')}-${String(probe.getDate()).padStart(2, '0')}`;
    }
  }
  return '';
}

(async () => {
  const prod = await loadProdRows();
  const migrated = applyMigration0044(prod);
  console.log(`Lignes de production lues : ${prod.formulas.length} formules · ${prod.activities.length} activites · ${prod.centers.length} centres`);
  console.log(`Migration 0044 appliquee en memoire : ${migrated.copies.length} copie(s) -> ${migrated.copies.map((c) => `${c.owner_client_id}/${c.id}`).join(', ') || 'aucune'}`);

  const pool = makePool(migrated);
  const pgPath = require.resolve('pg');
  require.cache[pgPath] = {
    id: pgPath, filename: pgPath, loaded: true,
    exports: { Pool: function FakePool() { return pool; } },
  };
  const database = require(path.join(ROOT, 'lib', 'database.js'));
  database.getPool = () => pool;

  const metaHandler = require(path.join(ROOT, 'api', 'public-booking-meta.js'));
  const availabilityHandler = require(path.join(ROOT, 'api', 'public-availability.js'));

  section('[1] Ce que N4 propose apres la migration');
  const meta = await callHandler(metaHandler, `/api/public-booking-meta?centerId=${CENTER}`);
  ok(meta.status === 200, `public-booking-meta repond (statut ${meta.status})`);
  const activities = (meta.json && meta.json.activities) || [];
  const formules = (meta.json && meta.json.formules) || [];
  const activityIds = activities.map((a) => a.id);
  ok(activityIds.includes('bowling'), 'le BOWLING est propose', activityIds.join(', ') || 'aucune');
  ok(activityIds.includes('kara-box'), 'la KARA BOX est proposee', activityIds.join(', ') || 'aucune');
  ok(
    !activityIds.includes('laser_game') && !activityIds.includes('minigolf_blacklight') && !activityIds.includes('karting_vr'),
    'et rien de Fun Galaxy ne traine',
    activityIds.join(', '),
  );
  ok(formules.length === 4, `ses 4 formules sont servies (${formules.length})`, formules.map((f) => f.id).join(', '));

  section('[2] Le tarif du bowling tient toujours');
  const bowling = activities.find((a) => a.id === 'bowling') || {};
  ok(Boolean(bowling.name), 'le bowling porte un nom', String(bowling.name || 'sans nom'));
  const pricing = bowling.pricing || (bowling.booking && bowling.booking.pricing) || null;
  ok(
    Boolean(pricing) || Boolean(bowling.priceType) || Boolean(bowling.booking && bowling.booking.priceType),
    'il porte un mode de tarification',
    JSON.stringify(pricing || bowling.priceType || (bowling.booking && bowling.booking.priceType) || null),
  );
  const kara = activities.find((a) => a.id === 'kara-box') || {};
  ok(Boolean(kara.name), 'la Kara Box porte un nom', String(kara.name || 'sans nom'));

  section('[3] Une partie de bowling se reserve encore');
  // Samedi : N4 vend 7 EUR la partie du vendredi au dimanche (journal 199).
  const saturday = nextDow(6);
  const bowlingCall = await callHandler(
    availabilityHandler,
    `/api/public-availability?centerId=${CENTER}&type=bowling&date=${saturday}&pax=6&duration=1`,
  );
  ok(bowlingCall.status === 200, `les creneaux bowling repondent (statut ${bowlingCall.status})`, saturday);
  const bowlingJson = bowlingCall.json || {};
  ok(bowlingJson.ok !== false, 'sans message de refus', String(bowlingJson.message || 'aucun'));
  ok(Number(bowlingJson.price) > 0, 'un prix est calcule pour 6 joueurs', `${bowlingJson.price} EUR`);
  ok(Array.isArray(bowlingJson.slots) && bowlingJson.slots.length > 0, 'des creneaux sont proposes', `${(bowlingJson.slots || []).length} creneaux`);

  section('[4] Une Kara Box se reserve encore');
  const karaCall = await callHandler(
    availabilityHandler,
    `/api/public-availability?centerId=${CENTER}&type=activity&firstActivityId=kara-box&date=${saturday}&pax=6&duration=1`,
  );
  ok(karaCall.status === 200, `les creneaux Kara Box repondent (statut ${karaCall.status})`);
  const karaJson = karaCall.json || {};
  ok(karaJson.ok !== false, 'sans message de refus', String(karaJson.message || 'aucun'));
  ok(Array.isArray(karaJson.slots) && karaJson.slots.length > 0, 'des creneaux sont proposes', `${(karaJson.slots || []).length} creneaux`);

  section('[5] Une formule de N4 se reserve encore');
  const formuleId = (formules[0] || {}).id || '';
  const formuleCall = await callHandler(
    availabilityHandler,
    `/api/public-availability?centerId=${CENTER}&type=formule&formuleId=${encodeURIComponent(formuleId)}&date=${saturday}&pax=6`,
  );
  ok(formuleCall.status === 200, `la formule ${formuleId} repond (statut ${formuleCall.status})`);
  const formuleJson = formuleCall.json || {};
  ok(formuleJson.ok !== false, 'sans « Formule invalide »', String(formuleJson.message || 'aucun'));

  console.log(`\n${failures ? 'ECHEC' : 'ALL OK'} : ${assertions - failures}/${assertions} verifications`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('\nERREUR:', error && (error.stack || error.message || error));
  process.exit(1);
});
