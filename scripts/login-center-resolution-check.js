// LE GATE DU CENTRE DE CONNEXION (2026-08-21).
//
// LA QUESTION POSEE : quand quelqu'un tape son code, qui decide du centre ?
// Reponse attendue : LE CODE. Pas l'ecran, pas le dernier centre consulte.
//
// LE BUG QU'IL VERROUILLE, mesure en production le 2026-08-21 : le login
// cherchait le code uniquement dans le centre affiche par la console
// (state.adminCenterId, garde en localStorage). Il suffisait d'avoir travaille
// chez un client pour que la console reste pointee sur SON centre, et alors :
//   - le staff Fun Galaxy se faisait refuser un code parfaitement valide ;
//   - le proprietaire de la plateforme aussi, faute de membre proprietaire sur
//     les centres nes dans la console (n4-bowling, mi12).
// Preuve prod du symptome : meme code, HTTP 200 sur libramont et HTTP 400
// « Code refuse ou acces bloque. » sur n4-bowling.
//
// CE QUE LE GATE EXIGE, et qui n'est pas la meme chose que « ca laisse entrer » :
// la session doit porter LE CENTRE DU CODE. Une session estampillee au centre
// affiche donnerait a son porteur le scope d'un autre client : la commodite ne
// doit jamais s'acheter avec une fuite de cloisonnement.
//
// HONNETETE DU GATE : la base en memoire OBEIT au SQL. Les inserts ecrivent
// vraiment (colonnes lues DANS la requete, jamais devinees), les selects
// filtrent et ordonnent vraiment, et created_at est strictement croissant comme
// des transactions successives en Postgres. La section [5] MUTE le fichier de
// production pour verifier que ce gate sait rougir, puis le restaure a
// l'identique.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif. La base de production n'est jamais touchee.
// Lancement : node scripts/login-center-resolution-check.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-login-center-secret-2026';
process.env.STAFF_DIRECTION_CODE = 'GATE-DIRECTION-2026-EEEE';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-FFFF';

const ROOT = path.resolve(__dirname, '..');
const STAFF_AUTH_PATH = path.join(ROOT, 'lib', 'staff-auth.js');
const ALPHA = { client: 'bowling-du-lac', center: 'lac-centre' };
const BETA = { client: 'bowling-du-nord', center: 'nord-centre' };

let failures = 0;
let assertions = 0;
function section(title) { console.log(`\n${title}`); }
function ok(condition, label, detail = '') {
  assertions += 1;
  if (condition) { console.log(`  [OK] ${label}`); return true; }
  failures += 1;
  console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  return false;
}

// Meme empreinte que lib/staff-auth.hashSecret : le gate forge des lignes que
// le VRAI code d'authentification reconnait, il ne court-circuite rien.
function hashSecret(value) {
  return crypto
    .createHash('sha256')
    .update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`)
    .digest('hex');
}

// -- Base en memoire qui obeit au SQL ---------------------------------------
const db = {
  clients: [],
  centers: [],
  staff_roles: [],
  staff_members: [],
  staff_sessions: [],
  staff_access_events: [],
};

// Postgres donne a chaque transaction son propre now() : deux insertions
// successives ne partagent jamais leur created_at. Un compteur monotone
// reproduit cet ordre, dont depend le choix du centre quand un code est partage.
let clock = Date.parse('2026-08-21T08:00:00.000Z');
function nextStamp() { clock += 1000; return new Date(clock).toISOString(); }

function normalizeSql(text) { return String(text).replace(/\s+/g, ' ').trim(); }

// Lit les colonnes ET les valeurs DANS la requete : une ligne inseree porte ce
// que le SQL de production dit, jamais ce que ce fichier suppose.
function parseInsert(sql, params) {
  const match = sql.match(/^insert into (\w+) \(([^)]*)\) values \(([^)]*)\)(.*)$/i);
  if (!match) return null;
  const table = match[1];
  const columns = match[2].split(',').map((value) => value.trim());
  const values = match[3].split(',').map((value) => value.trim());
  const row = {};
  columns.forEach((column, index) => {
    const raw = values[index];
    if (raw === undefined) return;
    const placeholder = raw.match(/^\$(\d+)/);
    if (placeholder) {
      let value = params[Number(placeholder[1]) - 1];
      if (/::jsonb/i.test(raw) && typeof value === 'string') {
        try { value = JSON.parse(value); } catch (error) { /* laisse la chaine telle quelle */ }
      }
      row[column] = value === undefined ? null : value;
      return;
    }
    const literal = raw.match(/^'([^']*)'/);
    if (literal) { row[column] = literal[1]; return; }
    if (/^now\(\)$/i.test(raw)) { row[column] = nextStamp(); return; }
    if (/^(true|false)$/i.test(raw)) { row[column] = /^true$/i.test(raw); return; }
    row[column] = null;
  });
  return { table, row, tail: match[4] || '' };
}

const KEYS = {
  staff_roles: (row) => `${row.center_id}::${row.id}`,
  staff_members: (row) => String(row.id),
  staff_sessions: (row) => String(row.token_hash),
  clients: (row) => String(row.id),
  centers: (row) => String(row.id),
};

const UNHANDLED = [];

function applyInsert(sql, params) {
  const parsed = parseInsert(sql, params);
  if (!parsed) return null;
  const { table, row, tail } = parsed;
  const store = db[table];
  if (!store) return { rows: [], rowCount: 0 };
  if (table === 'staff_access_events') {
    store.push({ ...row, created_at: nextStamp() });
    return { rows: [{ id: store.length }], rowCount: 1 };
  }
  const key = KEYS[table];
  const existing = key ? store.find((item) => key(item) === key(row)) : null;
  if (existing) {
    if (/do nothing/i.test(tail)) return { rows: [{ ...existing }], rowCount: 0 };
    // do update set <col> = excluded.<col> : on rejoue EXACTEMENT les colonnes
    // que la requete nomme, pas la ligne entiere.
    const assignments = (tail.match(/do update set (.*?)(?: returning |;|$)/i) || [])[1] || '';
    for (const piece of assignments.split(',')) {
      const [rawColumn, rawValue] = piece.split('=').map((value) => (value || '').trim());
      const column = (rawColumn || '').replace(/;$/, '').trim();
      if (!column || !rawValue) continue;
      if (/^excluded\./i.test(rawValue)) existing[column] = row[rawValue.split('.')[1].replace(/[;\s]/g, '')];
      else if (/^now\(\)/i.test(rawValue)) existing[column] = nextStamp();
      else if (/^'([^']*)'/.test(rawValue)) existing[column] = rawValue.match(/^'([^']*)'/)[1];
      else if (/^(true|false)/i.test(rawValue)) existing[column] = /^true/i.test(rawValue);
    }
    existing.updated_at = nextStamp();
    return { rows: [{ ...existing }], rowCount: 1 };
  }
  const stamp = nextStamp();
  const created = { created_at: stamp, updated_at: stamp, ...row };
  if (!created.created_at) created.created_at = stamp;
  store.push(created);
  return { rows: [{ ...created }], rowCount: 1 };
}

// Ordre SQL rejoue a l'identique : last_seen decroissant (nulls en dernier),
// puis created_at croissant, puis center_id. C'est LUI qui decide du centre
// quand plusieurs partagent le meme code : le gate ne peut pas s'en dispenser
// sans repondre a la place du code.
function orderMembersLikeSql(rows) {
  return rows.slice().sort((a, b) => {
    const aSeen = a.last_seen ? Date.parse(a.last_seen) : -Infinity;
    const bSeen = b.last_seen ? Date.parse(b.last_seen) : -Infinity;
    if (aSeen !== bSeen) return bSeen - aSeen;
    const aMade = Date.parse(a.created_at || 0);
    const bMade = Date.parse(b.created_at || 0);
    if (aMade !== bMade) return aMade - bMade;
    return String(a.center_id).localeCompare(String(b.center_id));
  });
}

async function runQuery(text, params = []) {
  const sql = normalizeSql(text);
  if (/^(begin|commit|rollback)/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/^(create|alter|drop|comment on)/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/^insert into/i.test(sql)) {
    const inserted = applyInsert(sql, params);
    if (inserted) return inserted;
  }

  // -- resolution du centre d'origine d'un code -----------------------------
  if (/from staff_members m .* where m\.access_code_hash = \$1/i.test(sql)) {
    const eligible = db.staff_members.filter((member) => member.access_code_hash === params[0]
      && member.status !== 'blocked'
      && db.staff_roles.some((role) => role.center_id === member.center_id && role.id === member.role_id));
    const first = orderMembersLikeSql(eligible)[0];
    return first ? { rows: [{ center_id: first.center_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^select center_id from staff_roles where access_code_hash = \$1/i.test(sql)) {
    const matches = db.staff_roles
      .filter((role) => role.access_code_hash === params[0])
      .sort((a, b) => (Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0))
        || String(a.center_id).localeCompare(String(b.center_id)));
    return matches[0] ? { rows: [{ center_id: matches[0].center_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // -- lectures staff-auth --------------------------------------------------
  if (/^select id, access_code_hash from staff_members where id = any/i.test(sql)) {
    const ids = Array.isArray(params[0]) ? params[0] : [];
    const rows = db.staff_members
      .filter((row) => ids.includes(row.id))
      .map((row) => ({ id: row.id, access_code_hash: row.access_code_hash }));
    return { rows, rowCount: rows.length };
  }
  if (/^select id from centers/i.test(sql)) {
    return { rows: db.centers.map((row) => ({ id: row.id })), rowCount: db.centers.length };
  }
  if (/from staff_members m join staff_roles r/i.test(sql)) {
    const row = db.staff_members.find((member) => member.center_id === params[0]
      && member.access_code_hash === params[1]
      && member.status !== 'blocked');
    if (!row) return { rows: [], rowCount: 0 };
    const role = db.staff_roles.find((item) => item.center_id === row.center_id && item.id === row.role_id);
    if (!role) return { rows: [], rowCount: 0 };
    return { rows: [{ ...row, permissions: role.permissions || [], role_name: role.name, role_locked: role.locked }], rowCount: 1 };
  }
  if (/from staff_roles where center_id = \$1 and access_code_hash = \$2/i.test(sql)) {
    const row = db.staff_roles.find((item) => item.center_id === params[0] && item.access_code_hash === params[1]);
    return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/from staff_roles where center_id = \$1 and id = \$2/i.test(sql)) {
    const row = db.staff_roles.find((item) => item.center_id === params[0] && item.id === params[1]);
    return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/from staff_roles where center_id = \$1/i.test(sql)) {
    const rows = db.staff_roles.filter((item) => item.center_id === params[0]);
    return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
  }
  if (/from staff_members where id = \$1/i.test(sql)) {
    const row = db.staff_members.find((item) => item.id === params[0]);
    return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/from staff_members where center_id = \$1/i.test(sql)) {
    const rows = db.staff_members.filter((item) => item.center_id === params[0]);
    return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
  }
  if (/from staff_access_events where center_id = \$1/i.test(sql)) {
    const rows = db.staff_access_events.filter((item) => item.center_id === params[0]);
    return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
  }
  if (/from staff_sessions s/i.test(sql)) {
    const session = db.staff_sessions.find((item) => item.token_hash === params[0]);
    if (!session) return { rows: [], rowCount: 0 };
    if (new Date(session.expires_at).getTime() <= Date.now()) return { rows: [], rowCount: 0 };
    const member = db.staff_members.find((item) => item.id === session.member_id);
    if (!member || member.status === 'blocked') return { rows: [], rowCount: 0 };
    const role = db.staff_roles.find((item) => item.center_id === member.center_id && item.id === member.role_id);
    if (!role) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        token_hash: session.token_hash,
        center_id: session.center_id,
        expires_at: session.expires_at,
        member_id: member.id,
        member_name: member.name,
        contact: member.contact || '',
        member_status: member.status,
        role_id: member.role_id,
        role_name: role.name,
        role_code: role.code,
        permissions: role.permissions || [],
        locked: Boolean(role.locked),
      }],
      rowCount: 1,
    };
  }

  // -- ecritures ------------------------------------------------------------
  if (/^update staff_roles set/i.test(sql)) {
    const row = db.staff_roles.find((item) => item.center_id === params[0] && item.id === params[1]);
    if (!row) return { rows: [], rowCount: 0 };
    row.access_code_hash = params[2];
    row.access_code_hint = params[3];
    if (params[4] !== undefined) {
      try { row.permissions = JSON.parse(params[4]); } catch (error) { row.permissions = params[4]; }
    }
    row.locked = true;
    if (params[5] !== undefined) row.access_code_enc = params[5];
    return { rows: [{ ...row }], rowCount: 1 };
  }
  if (/^update staff_members set status = \$2/i.test(sql)) {
    const row = db.staff_members.find((item) => item.id === params[0]);
    if (!row) return { rows: [], rowCount: 0 };
    row.status = params[1];
    row.last_seen = nextStamp();
    return { rows: [{ ...row }], rowCount: 1 };
  }
  if (/^with touched_session/i.test(sql) || /^update staff_members set last_seen/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/^delete from staff_sessions/i.test(sql)) {
    db.staff_sessions = db.staff_sessions.filter((item) => new Date(item.expires_at).getTime() > Date.now());
    return { rows: [], rowCount: 0 };
  }
  if (/^update centers set client_id/i.test(sql)) {
    const row = db.centers.find((item) => item.id === params[0]);
    if (row) row.client_id = params[1];
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (/from clients where id = \$1/i.test(sql)) {
    const row = db.clients.find((item) => item.id === params[0]);
    return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/from centers\b/i.test(sql)) {
    return { rows: db.centers.map((row) => ({ ...row })), rowCount: db.centers.length };
  }
  if (/insert into audit_log|insert into client_errors|from schema_migrations/i.test(sql)) return { rows: [], rowCount: 0 };

  UNHANDLED.push(sql.slice(0, 160));
  return { rows: [], rowCount: 0 };
}

class FakePool {
  async query(text, params) { return runQuery(text, params); }
  async connect() { return { query: (text, params) => runQuery(text, params), release() {} }; }
  async end() {}
  on() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

const { getPool } = require(path.join(ROOT, 'lib', 'database.js'));
let staffAuth = require(STAFF_AUTH_PATH);
const { provisionClient } = require(path.join(ROOT, 'lib', 'platform-clients.js'));

function reloadStaffAuth() {
  for (const key of Object.keys(require.cache)) {
    if (/lib[\\/]staff-auth\.js$/.test(key)) delete require.cache[key];
  }
  staffAuth = require(STAFF_AUTH_PATH);
}

async function login(centerId, code) {
  try {
    const result = await staffAuth.loginStaffByCode({ centerId, code, fingerprint: `gate-${centerId}-${code}` });
    return { ok: true, session: result.session, accessControl: result.accessControl };
  } catch (error) {
    return { ok: false, message: String(error && error.message) };
  }
}

function codeOf(provisioned, roleName) {
  const hit = (provisioned.accessCodes || []).find((entry) => entry.role === roleName);
  return hit && hit.code;
}

(async () => {
  const alpha = await provisionClient(getPool(), {
    id: ALPHA.client, name: 'Bowling du Lac', center: { id: ALPHA.center, name: 'Bowling du Lac Centre' },
  });
  const beta = await provisionClient(getPool(), {
    id: BETA.client, name: 'Bowling du Nord', center: { id: BETA.center, name: 'Bowling du Nord Centre' },
  });
  const alphaDirection = codeOf(alpha, 'Direction');
  const betaDirection = codeOf(beta, 'Direction');
  ok(Boolean(alphaDirection && betaDirection && alphaDirection !== betaDirection), 'chaque client a recu SON code Direction');

  section('[1] Le code ouvre SON centre, meme quand la console en affiche un autre');
  const seedFromClient = await login(ALPHA.center, process.env.STAFF_DIRECTION_CODE);
  ok(seedFromClient.ok, 'le code Direction du socle n\'est plus refuse depuis la console d\'un client');
  ok(
    seedFromClient.ok && seedFromClient.session.centerId === 'libramont',
    'il ouvre le premier centre du socle, pas celui qui etait affiche',
    seedFromClient.ok ? seedFromClient.session.centerId : seedFromClient.message,
  );
  const clientFromSeed = await login('libramont', alphaDirection);
  ok(clientFromSeed.ok, 'et le code d\'un client entre depuis la console du socle');
  ok(
    clientFromSeed.ok && clientFromSeed.session.centerId === ALPHA.center,
    'la session porte le centre du CODE',
    clientFromSeed.ok ? clientFromSeed.session.centerId : clientFromSeed.message,
  );

  section('[2] Le dernier centre de travail l\'emporte quand un code est partage');
  await login('gembloux', process.env.STAFF_DIRECTION_CODE);
  const afterGembloux = await login(BETA.center, process.env.STAFF_DIRECTION_CODE);
  ok(
    afterGembloux.ok && afterGembloux.session.centerId === 'gembloux',
    'le code Direction ramene au centre ou il a servi en dernier',
    afterGembloux.ok ? afterGembloux.session.centerId : afterGembloux.message,
  );

  section('[3] Le code du proprietaire n\'appartient a aucun centre');
  ok(
    !db.staff_members.some((row) => row.id === `${BETA.center}:platform-owner`),
    'le centre du client n\'a jamais eu de membre proprietaire (etat de depart)',
  );
  const ownerOnClient = await login(BETA.center, process.env.PLATFORM_OWNER_CODE);
  ok(ownerOnClient.ok, 'le fondateur entre sur un centre client ne dans la console');
  ok(
    ownerOnClient.ok && ownerOnClient.session.centerId === BETA.center,
    'la session s\'ouvre SUR ce centre, pas sur un centre de repli',
    ownerOnClient.ok ? ownerOnClient.session.centerId : ownerOnClient.message,
  );
  ok(
    ownerOnClient.ok && ownerOnClient.session.permissions.includes('platform.admin'),
    'elle porte platform.admin',
  );
  const ownerRole = db.staff_roles.find((row) => row.center_id === BETA.center && row.id === 'platform-owner');
  ok(Boolean(ownerRole) && ownerRole.locked === true, 'le role plateforme pose a la volee est verrouille');
  ok(
    Boolean(ownerRole) && ownerRole.access_code_hash === 'verrouille:aucun-code-de-role',
    'il n\'ouvre AUCUN acces par code de role (seul le membre proprietaire ouvre une session)',
  );
  const ownerOnSeed = await login('ciney', process.env.PLATFORM_OWNER_CODE);
  ok(
    ownerOnSeed.ok && ownerOnSeed.session.centerId === 'ciney',
    'et il ouvre aussi n\'importe quel centre du socle',
    ownerOnSeed.ok ? ownerOnSeed.session.centerId : ownerOnSeed.message,
  );

  section('[4] Ce qui reste refuse');
  const unknown = await login(ALPHA.center, 'CODE-QUI-N-EXISTE-PAS-2026');
  ok(!unknown.ok && unknown.message === 'Code refusé ou accès bloqué.', 'un code inconnu est toujours refuse');
  const blockedCode = 'BLOQUE-1234-5678';
  db.staff_members.push({
    id: `${ALPHA.center}:member:bloque`,
    center_id: ALPHA.center,
    name: 'Ancien salarie',
    contact: '',
    role_id: 'staff',
    status: 'blocked',
    access_code_hash: hashSecret(blockedCode),
    access_code_hint: '',
    created_at: nextStamp(),
  });
  const blockedFromHere = await login(ALPHA.center, blockedCode);
  ok(!blockedFromHere.ok, 'un membre bloque reste dehors sur son propre centre');
  const blockedFromElsewhere = await login('libramont', blockedCode);
  ok(
    !blockedFromElsewhere.ok && blockedFromElsewhere.message === 'Code refusé ou accès bloqué.',
    'et la resolution de centre ne lui ouvre pas une porte derobee',
  );

  section('[5] Cloisonnement : une session ne prend jamais le centre affiche');
  const alphaFromBeta = await login(BETA.center, alphaDirection);
  ok(
    alphaFromBeta.ok && alphaFromBeta.session.centerId === ALPHA.center,
    'le code du client ALPHA tape sur la console de BETA ouvre ALPHA',
    alphaFromBeta.ok ? alphaFromBeta.session.centerId : alphaFromBeta.message,
  );
  ok(
    alphaFromBeta.ok && !alphaFromBeta.session.permissions.includes('platform.admin'),
    'une Direction de client n\'attrape aucune permission plateforme au passage',
  );
  ok(
    alphaFromBeta.ok && alphaFromBeta.accessControl.centerId === ALPHA.center,
    'et l\'equipe renvoyee est celle de SON centre',
  );

  section('[6] Contre-preuve par MUTATION du fichier de production');
  const original = fs.readFileSync(STAFF_AUTH_PATH, 'utf8');
  const mutated = original.replace(
    'const homeCenterId = await findHomeCenterForCode(hashSecret(code));',
    'const homeCenterId = \'\'; await findHomeCenterForCode(hashSecret(code));',
  );
  ok(mutated !== original, 'la resolution du centre d\'origine est bien la ligne mutee');
  try {
    fs.writeFileSync(STAFF_AUTH_PATH, mutated);
    reloadStaffAuth();
    const broken = await login(BETA.center, alphaDirection);
    ok(
      !broken.ok && broken.message === 'Code refusé ou accès bloqué.',
      'resolution neutralisee : le refus mesure en prod revient, ce gate ROUGIRAIT',
      broken.ok ? 'la connexion est passee quand meme' : broken.message,
    );
  } finally {
    fs.writeFileSync(STAFF_AUTH_PATH, original);
    reloadStaffAuth();
  }
  ok(fs.readFileSync(STAFF_AUTH_PATH, 'utf8') === original, 'fichier de production restaure a l\'identique');
  const restored = await login(BETA.center, alphaDirection);
  ok(restored.ok && restored.session.centerId === ALPHA.center, 'et le comportement correct est revenu');

  ok(UNHANDLED.length === 0, `aucune requete SQL non couverte par le gate (${UNHANDLED.length})`);
  if (UNHANDLED.length) UNHANDLED.slice(0, 5).forEach((sql) => console.log(`      ${sql}`));

  console.log(`\n${failures ? 'ECHEC' : 'ALL OK'} : ${assertions - failures}/${assertions} assertions`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
  process.exit(1);
});
