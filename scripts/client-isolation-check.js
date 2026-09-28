// LE GATE D ISOLATION PAR ENTREPRISE (2026-08-20).
//
// LA QUESTION POSEE, la seule qui compte pour Movsar : peut-on demarcher un
// deuxieme bowling sans risquer de casser le catalogue du premier ? Autrement
// dit : deux ENTREPRISES clientes distinctes ont-elles des catalogues
// DISJOINTS, et une ecriture chez l une laisse-t-elle l autre intacte ?
//
// LA MAILLE EST L ENTREPRISE (`clients.id`), PAS LE CENTRE. Verbatim Movsar du
// 2026-08-20 : « chaque centre de pinlane doit etre completement isole sauf si
// c de la meme organisation ». Deux centres d une MEME entreprise partagent
// leur catalogue : c est voulu, et ce gate le prouve aussi (sinon « isoler »
// deviendrait « cloisonner Libramont de Gembloux », ce que personne ne veut).
//
// CE QU IL VERROUILLE (les cinq fuites mesurees le 2026-08-20) :
//   A. `formulas` n avait AUCUNE portee (`id text primary key`). Une formule
//      creee par un client etait visible par TOUS.
//   B. `updateFormula` sur une formule du socle materialisait la ligne globale
//      et la patchait pour tout le monde (prix compris).
//   C. `deleteFormula` (soft delete `active=false`) sur une formule du socle
//      la retirait chez TOUS les clients.
//   D. La console n envoie aucun `centerId` dans `body.activity`, donc
//      `createActivity` retombait sur `center_id='all'` : l activite d un
//      client atterrissait chez tous.
//   E. Un centre INCONNU recevait HTTP 200 et un catalogue d emprunt.
//
// HONNETETE DU GATE : chaque etape exerce le VRAI code (handler api/ops.js,
// handler api/public-booking-meta.js, lib/catalog-store), jamais une
// reformulation. Un test qui verifie qu une chose EXISTE au lieu qu un effet SE
// PRODUISE est un faux vert : la derniere section CASSE la portee expres et
// exige que le gate rougisse.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif. La base de production n est jamais touchee.
// Lancement : node scripts/client-isolation-check.js

const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
// ZERO RESEAU, VRAIMENT : sans cet interrupteur, la synchronisation du
// calendrier scolaire (lib/booking-config) ouvrait une connexion TLS, et Node
// sous Windows plantait en sortant sur ce socket (« UV_HANDLE_CLOSING », code
// 127) apres « GATE VERT 38/38 ». Meme cause que client-tarifs (2026-09-28).
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-client-isolation-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-DDDD';

const ROOT = path.resolve(__dirname, '..');

// ── Les deux entreprises du gate ────────────────────────────────────────────
// ALPHA possede DEUX centres (c est ce qui prouve le partage intra-entreprise).
// BETA en possede un seul. Aucun des trois n existe dans ops-knowledge/centers.json :
// tout vient de la base, comme un vrai client provisionne depuis la console.
const ALPHA = 'alpha-loisirs';
const ALPHA_UN = 'alpha-un';
const ALPHA_DEUX = 'alpha-deux';
const BETA = 'beta-bowling';
const BETA_UN = 'beta-un';

let failures = 0;
let assertions = 0;
let currentSection = '';
function section(title) { currentSection = title; console.log(`\n${title}`); }
function ok(condition, label) {
  assertions += 1;
  if (condition) { console.log(`  [OK] ${label}`); return true; }
  failures += 1;
  console.log(`  [FAIL] ${label}`);
  return false;
}

// Meme empreinte que lib/staff-auth.hashSecret : le gate forge des jetons que
// le VRAI code d authentification reconnait, il ne court-circuite rien.
function hashSecret(value) {
  return crypto
    .createHash('sha256')
    .update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`)
    .digest('hex');
}

// ── Base en memoire ─────────────────────────────────────────────────────────
const db = {
  clients: [
    { id: ALPHA, name: 'Alpha Loisirs', status: 'active', plan: 'standard' },
    { id: BETA, name: 'Beta Bowling', status: 'active', plan: 'standard' },
  ],
  centers: [
    { id: ALPHA_UN, name: 'Alpha Un', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: ALPHA },
    { id: ALPHA_DEUX, name: 'Alpha Deux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: ALPHA },
    { id: BETA_UN, name: 'Beta Un', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: BETA },
  ],
  formulas: [],
  formula_steps: [],
  // CHAQUE ENTREPRISE A SA PROPRE LIGNE BOWLING (2026-08-21). Le socle livre
  // dans le code appartient desormais au client qui l a apporte : une autre
  // entreprise n en herite plus, meme pas de l activite « bowling ». C est
  // provisionClient qui pose ces lignes a la creation d un client, pour les
  // seules ressources que le moteur planifie. Sans elles, validateSteps refuse
  // une etape « 1 partie de bowling » avec « activite inconnue » : le gate le
  // verrait en 400 des la premiere ecriture.
  activities: [
    { id: 'bowling', center_id: 'all', owner_client_id: ALPHA, name: 'Bowling', resource_type: 'bowling_lane', source: 'seed', active: true, bookable: true, price_type: 'grid_bowling' },
    { id: 'bowling', center_id: 'all', owner_client_id: BETA, name: 'Bowling', resource_type: 'bowling_lane', source: 'seed', active: true, bookable: true, price_type: 'grid_bowling' },
  ],
  formule_overrides: [],
};

// Les mutations catalogue passent par des formes SQL precises. Une forme non
// reconnue est collectee : si le code de production change son SQL, ce gate le
// dit au lieu de repondre a sa place.
const UNHANDLED = [];

function normalizeSql(text) { return String(text).replace(/\s+/g, ' ').trim(); }

// La portee proprietaire d une ligne. Quand ce drapeau tombe, le fake se
// comporte EXACTEMENT comme une base d AVANT la migration 0042 : toute requete
// qui nomme owner_client_id echoue en 42703 (undefined_column) et les lignes
// rendues n en portent pas trace. C est le levier de la contre-preuve de la
// section [9] : elle prouve que c est bien la MIGRATION qui ferme la fuite, pas
// une complaisance du fake.
let SCOPE_COLUMN_PRESENT = true;
function ownerOf(row) { return SCOPE_COLUMN_PRESENT ? String(row.owner_client_id || 'all') : 'all'; }
function undefinedColumnError() {
  const error = new Error('column "owner_client_id" does not exist');
  error.code = '42703';
  return error;
}
// Projection d une ligne rendue au code applicatif : sans la colonne, elle
// n existe pas du tout dans le resultat.
function projected(row) {
  const copy = { ...row };
  if (!SCOPE_COLUMN_PRESENT) delete copy.owner_client_id;
  return copy;
}

class FakePool {
  async query(text, params = []) {
    const sql = normalizeSql(text);
    if (!SCOPE_COLUMN_PRESENT && /owner_client_id/i.test(sql)) throw undefinedColumnError();

    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^(create|alter|drop|comment on|insert into schema_migrations)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/insert into (staff_access_events|audit_log|client_errors)/i.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };

    // ── centres / clients ────────────────────────────────────────────────
    if (/from clients where id = \$1/i.test(sql)) {
      const row = db.clients.find((c) => c.id === params[0]);
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/from centers\b/i.test(sql)) {
      const wanted = params.map((v) => String(v == null ? '' : v));
      const scoped = /where/i.test(sql) && wanted.length
        ? db.centers.filter((row) => wanted.includes(row.id))
        : db.centers;
      return {
        rows: scoped.map((row) => ({
          ...row,
          client_name: (db.clients.find((c) => c.id === row.client_id) || {}).name || null,
        })),
        rowCount: scoped.length,
      };
    }
    if (/from clients\b/i.test(sql)) return { rows: db.clients.map((r) => ({ ...r })), rowCount: db.clients.length };

    // ── sessions staff ───────────────────────────────────────────────────
    if (/from staff_sessions s/i.test(sql) && /s\.token_hash = \$1/.test(sql)) {
      const row = SESSION_BY_HASH.get(String(params[0] || ''));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/from staff_(roles|members|sessions)/i.test(sql)) return { rows: [], rowCount: 0 };
    // Amorcage des acces staff (roles seed, derniere visite) : hors perimetre de
    // ce gate, mais reconnu explicitement pour que la section [8] ne compte que
    // les mutations CATALOGUE.
    if (/^(insert into|update) staff_/i.test(sql)) return { rows: [], rowCount: 0 };

    // ── formulas ─────────────────────────────────────────────────────────
    if (/^insert into formulas/i.test(sql)) return upsertFormula(sql, params);
    if (/^select id from formulas/i.test(sql)) {
      return { rows: db.formulas.map((r) => ({ id: r.id })), rowCount: db.formulas.length };
    }
    if (/from formulas where id = \$1/i.test(sql)) {
      // Lecture d une ligne pour patch : SCOPEE si le SQL porte la portee.
      const scoped = /owner_client_id = \$2/i.test(sql);
      const hit = db.formulas.find((r) => r.id === params[0] && (!scoped || ownerOf(r) === String(params[1])));
      return hit ? { rows: [projected(hit)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/from formulas/i.test(sql)) return { rows: db.formulas.map(projected), rowCount: db.formulas.length };

    // ── formula_steps ────────────────────────────────────────────────────
    if (/^insert into formula_steps/i.test(sql)) return upsertStep(sql, params);
    if (/^delete from formula_steps/i.test(sql)) {
      const scoped = /owner_client_id = \$2/i.test(sql);
      const before = db.formula_steps.length;
      db.formula_steps = db.formula_steps.filter((r) => !(r.formula_id === params[0] && (!scoped || ownerOf(r) === String(params[1]))));
      return { rows: [], rowCount: before - db.formula_steps.length };
    }
    if (/from formula_steps/i.test(sql)) return { rows: db.formula_steps.map(projected), rowCount: db.formula_steps.length };

    // ── activities ───────────────────────────────────────────────────────
    if (/^insert into activities/i.test(sql)) return upsertActivity(sql, params);
    if (/^select id from activities/i.test(sql)) {
      return { rows: db.activities.map((r) => ({ id: r.id })), rowCount: db.activities.length };
    }
    if (/from activities where id = \$1 and center_id = \$2/i.test(sql)) {
      const scoped = /owner_client_id = \$3/i.test(sql);
      const hit = db.activities.find((r) => r.id === params[0] && r.center_id === params[1]
        && (!scoped || ownerOf(r) === String(params[2])));
      return hit ? { rows: [projected(hit)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/from activities/i.test(sql)) return { rows: db.activities.map(projected), rowCount: db.activities.length };

    // ── overrides catalogue ──────────────────────────────────────────────
    if (/from formule_overrides/i.test(sql)) {
      return { rows: db.formule_overrides.map((r) => ({ ...r })), rowCount: db.formule_overrides.length };
    }

    // ── tables muettes pour ce gate ──────────────────────────────────────
    if (/from (reservations|lane_statuses|availability_blocks|communications|email_identities|center_automation_settings|marketing_suppressions|client_notes|daily_metrics)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/^(insert|update|delete)/i.test(sql)) UNHANDLED.push(sql.slice(0, 140));
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

// Colonnes d un insert, dans l ordre du SQL : le fake OBEIT au SQL au lieu de
// deviner. Une colonne ajoutee cote production entre donc toute seule.
function insertColumns(sql) {
  const match = sql.match(/^insert into \w+ \(([^)]*)\)/i);
  if (!match) return [];
  return match[1].split(',').map((c) => c.trim());
}

function rowFromInsert(sql, params) {
  const cols = insertColumns(sql);
  const row = {};
  cols.forEach((col, index) => {
    if (col === 'updated_at' || col === 'created_at') return;
    let value = params[index];
    if ((col === 'duration_model' || col === 'service_model' || col === 'order_constraints') && typeof value === 'string') {
      try { value = JSON.parse(value); } catch (error) { /* garde la chaine telle quelle */ }
    }
    row[col] = value;
  });
  return row;
}

function upsertFormula(sql, params) {
  const row = rowFromInsert(sql, params);
  const owner = ownerOf(row);
  const existing = db.formulas.find((r) => r.id === row.id && ownerOf(r) === owner);
  if (existing) Object.assign(existing, row);
  else db.formulas.push(row);
  return { rows: [], rowCount: 1 };
}

function upsertStep(sql, params) {
  const row = rowFromInsert(sql, params);
  const owner = ownerOf(row);
  const existing = db.formula_steps.find((r) => r.formula_id === row.formula_id
    && ownerOf(r) === owner && Number(r.position) === Number(row.position));
  if (existing) Object.assign(existing, row);
  else db.formula_steps.push(row);
  return { rows: [], rowCount: 1 };
}

function upsertActivity(sql, params) {
  const row = rowFromInsert(sql, params);
  const owner = ownerOf(row);
  const existing = db.activities.find((r) => r.id === row.id && r.center_id === row.center_id && ownerOf(r) === owner);
  if (existing) Object.assign(existing, row);
  else db.activities.push(row);
  return { rows: [], rowCount: 1 };
}

// ── Sessions staff forgees ──────────────────────────────────────────────────
const DIRECTION_PERMISSIONS = [
  'dashboard.view', 'direction.view', 'centers.switch',
  'planning.view', 'reservations.view', 'reservations.create', 'reservations.edit',
  'clients.view', 'clients.edit', 'pricing.manage', 'users.manage', 'settings.manage',
];
const TOKEN_ALPHA = 'fgs_gate_alpha_direction';
const TOKEN_BETA = 'fgs_gate_beta_direction';
function sessionRow({ token, centerId, memberId, memberName }) {
  return {
    token_hash: hashSecret(token),
    center_id: centerId,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    member_id: memberId,
    member_name: memberName,
    contact: '',
    member_status: 'active',
    role_id: 'direction',
    role_name: 'Direction',
    role_code: 'DI',
    permissions: DIRECTION_PERMISSIONS,
    locked: true,
  };
}
const SESSION_BY_HASH = new Map([
  [hashSecret(TOKEN_ALPHA), sessionRow({ token: TOKEN_ALPHA, centerId: ALPHA_UN, memberId: `${ALPHA_UN}:direction`, memberName: 'Direction Alpha' })],
  [hashSecret(TOKEN_BETA), sessionRow({ token: TOKEN_BETA, centerId: BETA_UN, memberId: `${BETA_UN}:direction`, memberName: 'Direction Beta' })],
]);

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

// ── Faux req / res ──────────────────────────────────────────────────────────
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    end(payload) { if (payload !== undefined && this.body === null) this.body = payload; this.ended = true; },
    write(chunk) { this.body = (this.body || '') + chunk; },
  };
}
function fakeReq({ method = 'GET', url = '/', token = '', body = null } = {}) {
  const headers = { host: '127.0.0.1', 'x-forwarded-for': '203.0.113.9' };
  if (token) headers['x-staff-session'] = token;
  const payload = body === null ? '' : JSON.stringify(body);
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() { if (payload) yield Buffer.from(payload, 'utf8'); },
  };
}
function jsonOf(res) { try { return JSON.parse(String(res.body || '')); } catch (error) { return null; } }

// ── Le code applicatif REEL ─────────────────────────────────────────────────
const opsHandler = require(path.join(ROOT, 'api', 'ops.js'));
const metaHandler = require(path.join(ROOT, 'api', 'public-booking-meta.js'));
const availabilityHandler = require(path.join(ROOT, 'api', 'public-availability.js'));
const { getPool } = require(path.join(ROOT, 'lib', 'database.js'));
const catalogStore = require(path.join(ROOT, 'lib', 'catalog-store.js'));
const { refreshCenterOverrides } = require(path.join(ROOT, 'lib', 'ops-knowledge.js'));

async function opsPost(token, body) {
  const req = fakeReq({ method: 'POST', url: '/api/ops', token, body });
  const res = fakeRes();
  await opsHandler(req, res);
  return { status: res.statusCode, json: jsonOf(res) };
}

async function opsGet(token, query) {
  const req = fakeReq({ method: 'GET', url: `/api/ops?${query}`, token });
  const res = fakeRes();
  await opsHandler(req, res);
  return { status: res.statusCode, json: jsonOf(res) };
}

// Le TUNNEL PUBLIC d un centre : la surface que voit un client final.
async function tunnel(centerId) {
  await catalogStore.refreshCatalog(getPool(), { force: true });
  const req = fakeReq({ method: 'GET', url: `/api/public-booking-meta?centerId=${encodeURIComponent(centerId)}` });
  const res = fakeRes();
  await metaHandler(req, res);
  const json = jsonOf(res);
  return {
    status: res.statusCode,
    json,
    formuleIds: json && Array.isArray(json.formules) ? json.formules.map((f) => f.id) : [],
    activityIds: json && Array.isArray(json.activities) ? json.activities.map((a) => a.id) : [],
    priceOf(id) {
      const hit = json && Array.isArray(json.formules) ? json.formules.find((f) => f.id === id) : null;
      return hit ? Number(hit.price) : null;
    },
  };
}

// Le VERDICT DE RESERVATION d'une formule pour un centre : afficher une offre
// qu'on ne peut pas reserver est le pire des deux mondes.
async function reservable(centerId, formuleId, date) {
  await catalogStore.refreshCatalog(getPool(), { force: true });
  const query = `centerId=${encodeURIComponent(centerId)}&date=${date}&type=formule&formuleId=${encodeURIComponent(formuleId)}&pax=4`;
  const req = fakeReq({ method: 'GET', url: `/api/public-availability?${query}` });
  const res = fakeRes();
  await availabilityHandler(req, res);
  const json = jsonOf(res);
  return {
    status: res.statusCode,
    ok: Boolean(json && json.ok),
    message: (json && json.message) || '',
    label: (json && json.label) || '',
  };
}

// Un samedi a venir : jamais aujourd'hui (les creneaux passes sont filtres), et
// calcule, jamais ecrit en dur (trois bombes d'horloge payees sur ce depot).
function nextSaturday(minDaysAhead = 3) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < minDaysAhead; i += 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() !== 6) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

const NEW_FORMULA = {
  id: 'alpha-nuit-blanche',
  name: 'ALPHA NUIT BLANCHE',
  family: 'Soiree',
  minPax: 4,
  priceType: 'per_pax',
  priceValue: 33,
  descriptionLines: ['2 h de bowling', 'Une boisson'],
  steps: [{ activityId: 'bowling', count: 1, durationMinutes: 120 }],
};

async function run() {
  const pool = getPool();
  await refreshCenterOverrides(pool, { force: true });

  section('[0] Le decor : deux entreprises, trois centres, aucun dans le fichier socle');
  const fileCenters = require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.map((c) => c.id);
  ok(![ALPHA_UN, ALPHA_DEUX, BETA_UN].some((id) => fileCenters.includes(id)),
    `aucun des trois centres du gate n est dans ops-knowledge/centers.json (fichier : ${fileCenters.join(', ')})`);
  const start = { alphaUn: await tunnel(ALPHA_UN), betaUn: await tunnel(BETA_UN) };
  ok(start.alphaUn.status === 200 && start.betaUn.status === 200, 'les deux tunnels repondent 200 au depart');
  // LE POINT DE COMPARAISON A CHANGE LE 2026-08-21. Avant, ces deux lignes
  // exigeaient que les deux entreprises servent le MEME socle : c'etait la
  // situation de depart, et le gate mesurait la divergence a partir de la.
  // Depuis, le socle livre dans le code appartient au client qui l'a apporte :
  // une entreprise neuve part de RIEN. Le point de comparaison devient donc le
  // vide, ce qui est plus severe, pas moins : toute formule qui apparait chez
  // l'un doit avoir ete creee par lui.
  ok(start.alphaUn.formuleIds.length === 0,
    `ALPHA part d un catalogue vide (${start.alphaUn.formuleIds.length} formules)`);
  ok(start.betaUn.formuleIds.length === 0,
    `BETA aussi (${start.betaUn.formuleIds.length} formules)`);

  section('[1] Une formule creee par ALPHA reste chez ALPHA');
  const created = await opsPost(TOKEN_ALPHA, { action: 'createFormula', formula: NEW_FORMULA });
  ok(created.status === 200 && created.json && created.json.ok === true,
    `ALPHA cree sa formule via api/ops (statut ${created.status}${created.json && created.json.error ? ` : ${created.json.error}` : ''})`);

  const afterCreate = {
    alphaUn: await tunnel(ALPHA_UN),
    alphaDeux: await tunnel(ALPHA_DEUX),
    betaUn: await tunnel(BETA_UN),
  };
  ok(afterCreate.alphaUn.formuleIds.includes(NEW_FORMULA.id),
    'le tunnel du centre createur la sert');
  ok(afterCreate.alphaDeux.formuleIds.includes(NEW_FORMULA.id),
    'le tunnel de l AUTRE centre de la MEME entreprise la sert aussi (partage intra-entreprise voulu)');
  ok(!afterCreate.betaUn.formuleIds.includes(NEW_FORMULA.id),
    'le tunnel de l AUTRE ENTREPRISE ne la sert PAS');

  section('[2] Les ecrans staff disent la meme chose que les tunnels');
  const alphaScreen = await opsGet(TOKEN_ALPHA, 'action=clientCatalog');
  const betaScreen = await opsGet(TOKEN_BETA, 'action=clientCatalog');
  const idsOf = (result) => {
    const list = result.json && result.json.catalog && Array.isArray(result.json.catalog.formulas)
      ? result.json.catalog.formulas
      : (result.json && Array.isArray(result.json.formulas) ? result.json.formulas : []);
    return list.map((f) => f.id);
  };
  ok(alphaScreen.status === 200 && idsOf(alphaScreen).length > 0,
    `l ecran catalogue d ALPHA repond (statut ${alphaScreen.status}, ${idsOf(alphaScreen).length} formules)`);
  ok(idsOf(alphaScreen).includes(NEW_FORMULA.id), 'ALPHA voit sa formule dans son ecran Activites & tarifs');
  ok(betaScreen.status === 200, `l ecran catalogue de BETA repond (statut ${betaScreen.status})`);
  ok(!idsOf(betaScreen).includes(NEW_FORMULA.id), 'BETA ne la voit PAS dans son ecran Activites & tarifs');

  section('[3] Le catalogue d une AUTRE entreprise ne se touche pas');
  // AVANT le 2026-08-21, ces deux sections editaient une formule du SOCLE (f1,
  // f2) pour montrer que le changement restait chez ALPHA. Ce scenario n a plus
  // de sens : le socle appartient au client qui l a apporte, et ALPHA ne le voit
  // meme pas. La regle a tester est devenue le REFUS, et il doit etre franc :
  // une ecriture qui repond 200 sans rien changer de visible est pire qu un 400.
  const seedTarget = 'f1';
  const refusedDelete = await opsPost(TOKEN_ALPHA, { action: 'deleteFormula', id: seedTarget });
  ok(refusedDelete.status === 400, `ALPHA ne peut pas retirer ${seedTarget}, qui n est pas a lui (statut ${refusedDelete.status})`);
  const refusedPatch = await opsPost(TOKEN_ALPHA, { action: 'updateFormula', id: seedTarget, patch: { priceValue: 999 } });
  ok(refusedPatch.status === 400, `ni en changer le prix (statut ${refusedPatch.status})`);
  const afterRefusals = { alphaUn: await tunnel(ALPHA_UN), betaUn: await tunnel(BETA_UN) };
  ok(afterRefusals.alphaUn.priceOf(seedTarget) !== 999, `le prix de ${seedTarget} n a pas bouge malgre l appel refuse`);

  section('[4] Un changement de prix chez ALPHA ne change rien chez BETA');
  // Le prix se change sur SA formule a lui, celle creee en [1].
  const target = NEW_FORMULA.id;
  const patched = await opsPost(TOKEN_ALPHA, { action: 'updateFormula', id: target, patch: { priceValue: 999 } });
  ok(patched.status === 200, `ALPHA passe SA formule ${target} a 999 EUR (statut ${patched.status})`);
  const afterPatch = { alphaUn: await tunnel(ALPHA_UN), alphaDeux: await tunnel(ALPHA_DEUX), betaUn: await tunnel(BETA_UN) };
  ok(afterPatch.alphaUn.priceOf(target) === 999, `ALPHA voit 999 EUR (obtenu ${afterPatch.alphaUn.priceOf(target)})`);
  ok(afterPatch.alphaDeux.priceOf(target) === 999, 'son SECOND centre aussi (partage intra-entreprise)');
  ok(!afterPatch.betaUn.formuleIds.includes(target), 'BETA ne connait toujours pas cette formule');

  section('[5] Une activite creee par ALPHA reste chez ALPHA');
  const activityCreated = await opsPost(TOKEN_ALPHA, {
    action: 'createActivity',
    activity: { name: 'Kara Box Alpha', bookable: true, priceType: 'per_pax', priceValue: 12, priceUnit: 'par personne' },
  });
  ok(activityCreated.status === 200 && activityCreated.json && activityCreated.json.ok === true,
    `ALPHA cree son activite via api/ops (statut ${activityCreated.status}${activityCreated.json && activityCreated.json.error ? ` : ${activityCreated.json.error}` : ''})`);
  const newActivityId = activityCreated.json && activityCreated.json.id ? String(activityCreated.json.id) : '';
  ok(Boolean(newActivityId), `l activite porte un identifiant (${newActivityId || 'aucun'})`);
  // Le TUNNEL n est pas la bonne surface ici : une activite creee n est vendable
  // qu une fois ACTIVEE par le centre (activityAvailability, lib/activity-catalog).
  // La surface qui dit « mon catalogue contient ceci » est l ecran Activites.
  const activityIdsOf = (result) => {
    const list = result.json && Array.isArray(result.json.activities) ? result.json.activities : [];
    return list.map((a) => a.id);
  };
  const alphaUnScreen = await opsGet(TOKEN_ALPHA, 'action=clientCatalog');
  const betaUnScreen = await opsGet(TOKEN_BETA, 'action=clientCatalog');
  ok(activityIdsOf(alphaUnScreen).includes(newActivityId), 'le catalogue d ALPHA la contient');
  ok(!activityIdsOf(betaUnScreen).includes(newActivityId), 'le catalogue de BETA ne la contient PAS');
  const betaTunnel = await tunnel(BETA_UN);
  ok(!betaTunnel.activityIds.includes(newActivityId), 'et le tunnel de BETA ne la propose pas davantage');

  section('[6] BETA ne peut pas toucher une formule d ALPHA');
  // Le prix de reference est celui du MOMENT, pas celui de la creation : la
  // section [4] vient de le passer a 999. Figer la valeur de depart ferait
  // rougir ce gate pour une raison etrangere au cloisonnement.
  const priceBeforeSteal = (await tunnel(ALPHA_UN)).priceOf(NEW_FORMULA.id);
  const steal = await opsPost(TOKEN_BETA, { action: 'updateFormula', id: NEW_FORMULA.id, patch: { priceValue: 1 } });
  ok(steal.status >= 400, `l ecriture croisee est refusee (statut ${steal.status})`);
  const afterSteal = await tunnel(ALPHA_UN);
  ok(afterSteal.priceOf(NEW_FORMULA.id) === priceBeforeSteal,
    `le prix d ALPHA n a pas bouge (${afterSteal.priceOf(NEW_FORMULA.id)} EUR)`);
  const betaAfterSteal = await tunnel(BETA_UN);
  ok(!betaAfterSteal.formuleIds.includes(NEW_FORMULA.id),
    'et la tentative n a pas fait apparaitre la formule chez BETA');

  section('[7] Un centre INCONNU ne recoit plus un catalogue d emprunt');
  const ghost = await tunnel('centre-qui-n-existe-pas');
  ok(ghost.status === 404, `le serveur repond 404 au lieu de 200 (obtenu ${ghost.status})`);
  ok(ghost.formuleIds.length === 0, `aucune formule n est servie (obtenu ${ghost.formuleIds.length})`);
  ok(Boolean(ghost.json && ghost.json.ok === false), 'la reponse dit franchement que le centre est inconnu');

  section('[8] La formule d ALPHA est RESERVABLE chez ALPHA, et inconnue chez BETA');
  const saturday = nextSaturday();
  const alphaVerdict = await reservable(ALPHA_UN, NEW_FORMULA.id, saturday);
  ok(alphaVerdict.status === 200 && alphaVerdict.ok,
    `ALPHA obtient un verdict de reservation (statut ${alphaVerdict.status}, ok=${alphaVerdict.ok}, "${alphaVerdict.message}")`);
  // Le defaut ferme le 2026-08-20 : api/public-availability resolvait la formule
  // dans la CONSTANTE FICHIER, donc toute offre creee en console etait
  // affichable et NON reservable (« Formule invalide », HTTP 500).
  ok(!/Formule invalide/i.test(alphaVerdict.message),
    `la formule custom n est pas rejetee comme invalide (message : "${alphaVerdict.message || 'aucun'}")`);
  ok(alphaVerdict.label === NEW_FORMULA.name,
    `le verdict porte le nom de SA formule (obtenu "${alphaVerdict.label}")`);
  const betaVerdict = await reservable(BETA_UN, NEW_FORMULA.id, saturday);
  ok(betaVerdict.label !== NEW_FORMULA.name,
    `BETA ne recoit jamais le nom de l offre d ALPHA (obtenu "${betaVerdict.label}")`);

  section('[9] Aucune ecriture SQL non reconnue par le fake');
  ok(UNHANDLED.length === 0, `toutes les mutations sont comprises (${UNHANDLED.length} inconnues${UNHANDLED.length ? ` : ${UNHANDLED[0]}` : ''})`);

  section('[10] CONTRE-PREUVE : la portee cassee expres doit faire rougir ce gate');
  SCOPE_COLUMN_PRESENT = false; // la base "oublie" la portee : retour au catalogue partage
  await catalogStore.refreshCatalog(pool, { force: true });
  const brokenAlpha = await tunnel(ALPHA_UN);
  const brokenBeta = await tunnel(BETA_UN);
  const leaked = brokenBeta.formuleIds.includes(NEW_FORMULA.id);
  SCOPE_COLUMN_PRESENT = true;
  await catalogStore.refreshCatalog(pool, { force: true });
  ok(leaked, 'sans portee, la formule d ALPHA fuit chez BETA (ou le retrait d ALPHA la prive) : le gate sait rougir');
  ok(brokenAlpha.formuleIds.length > 0, 'et le catalogue reste servi dans les deux cas (aucun ecran blanc)');
  const restored = await tunnel(BETA_UN);
  ok(!restored.formuleIds.includes(NEW_FORMULA.id),
    'la contre-preuve ne laisse aucun etat casse derriere elle');
}

run()
  .then(() => {
    console.log(`\n${failures === 0 ? 'GATE VERT' : 'GATE ROUGE'} : ${assertions - failures}/${assertions} assertions`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(`\nGATE ROUGE (exception dans "${currentSection}") :`, error && error.stack ? error.stack : error);
    process.exit(1);
  });
