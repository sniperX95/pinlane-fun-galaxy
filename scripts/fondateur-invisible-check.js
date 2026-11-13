'use strict';
// LE FONDATEUR EST INVISIBLE AUX CENTRES, ET LES JOURNAUX SONT A LUI SEUL (2026-11-13).
//
// Ansar : « sur tout Pinlane, moi role fondateur Pinlane, j ouvre quelque chose ou quoi, ca doit pas
// afficher que c est ouvert ou lu ou fait par fondateur Pinlane, moi personne doit me voir, mais les
// autres roles du centre oui », et le Journal de l equipe, que la Direction lisait, est a lui seul.
//
// Le centre de Libramont : Marie (Direction), Luc (Manager), le fondateur (membre platform-owner, qui
// s appelle en base « Ansar Pinlane » : son nom ACTUEL, pas celui du seed) et sa session de secours.
// Pour chaque surface : la Direction et le Manager ne voient RIEN du fondateur, ce que fait Marie reste
// visible, le fondateur voit tout. Les serveurs sont les vrais (api/*.js), la base est en memoire et lit
// les colonnes et les valeurs DANS le SQL : un predicat absent du texte ne filtre rien.
//
//   [R] la regle partagee (lib/fondateur-invisible.js) sur une valeur de chaque surface
//   [E] Equipe & acces, par le vrai api/staff-auth.js : connexions, membres, roles, journal
//   [A] le journal d audit : readAuditLog, l historique d un dossier (vrai api/staff-reservations.js) et
//       le journal de la plateforme (vrai api/ops.js)
//   [M] les reponses du centre : la marque de requireStaffPermission, appliquee par sendJson, sur une
//       vraie route (api/staff-customer-notes.js) ; les vieux noms ecrits par le fondateur partent
//   [C] les contre-preuves : chaque filtre retire en memoire (le disque n est jamais ecrit) fait rougir
//       sa section
//
// Rien ne part : ni base, ni reseau, ni mail. Lancement : node scripts/fondateur-invisible-check.js
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_INSECURE_STAFF_CODES;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-fondateur-invisible-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-INVISIBLE-2026';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const LIB = (nom) => path.join(ROOT, 'lib', nom);
const API = (nom) => path.join(ROOT, 'api', nom);
const PORT = Number(process.env.PINLANE_FONDATEUR_INVISIBLE_PORT || 5367);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = process.env.PLATFORM_OWNER_CODE;
const CODES = { marie: 'MARIE-DIR-2026', luc: 'LUC-MGR-2026', fondateur: OWNER };
const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const lf = (t) => String(t).split('\r\n').join('\n');

let echecs = 0;
const SECTIONS = {};
let section = '';
// Ce qui a rougi pendant une contre-preuve (--detail l ecrit : on voit qu elle mord pour la bonne raison).
let rougesMuets = [];
function ok(condition, message, detail) {
  SECTIONS[section] = SECTIONS[section] || { ok: 0, ko: 0 };
  if (condition) { SECTIONS[section].ok += 1; if (!MUET) console.log(`ok    ${message}`); return true; }
  SECTIONS[section].ko += 1;
  if (MUET) rougesMuets.push(message);
  if (!MUET) {
    echecs += 1;
    console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`}`);
  }
  return false;
}
let MUET = false;

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE. Elle lit les colonnes et les valeurs DANS le SQL ; une requete qu elle ne connait
// pas est notee (NON_COUVERTES) et rend vide.
// ---------------------------------------------------------------------------
const NON_COUVERTES = [];
let horloge = Date.parse('2026-11-13T09:00:00.000Z');
const tic = () => { horloge += 1000; return new Date(horloge).toISOString(); };
const vide = () => ({ rows: [], rowCount: 0 });
const lignes = (rows) => ({ rows, rowCount: rows.length });
const plat = (texte) => String(texte).replace(/\s+/g, ' ').trim();
const hacher = (valeur) => crypto.createHash('sha256').update(`${process.env.STAFF_AUTH_SECRET}:${String(valeur || '').trim()}`).digest('hex');
let db;

function aimeComme(valeur, motif) {
  const re = new RegExp(`^${String(motif).split('%').map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(String(valeur ?? ''));
}

function lireInsert(sql, params) {
  const tete = sql.match(/^insert into (\w+) \(([^)]*)\) values \(/i);
  if (!tete) return null;
  let profondeur = 1;
  let fin = tete[0].length;
  for (; fin < sql.length && profondeur > 0; fin += 1) {
    if (sql[fin] === '(') profondeur += 1;
    else if (sql[fin] === ')') profondeur -= 1;
  }
  const colonnes = tete[2].split(',').map((v) => v.trim());
  const valeurs = sql.slice(tete[0].length, fin - 1).split(',').map((v) => v.trim());
  const row = {};
  colonnes.forEach((colonne, i) => {
    const brut = valeurs[i] || '';
    const place = brut.match(/^\$(\d+)(::jsonb)?$/i);
    if (place) {
      let valeur = params[Number(place[1]) - 1];
      if (place[2] && typeof valeur === 'string') { try { valeur = JSON.parse(valeur); } catch (e) { /* brut */ } }
      row[colonne] = valeur === undefined ? null : valeur;
    } else if (/^'([^']*)'$/.test(brut)) row[colonne] = brut.slice(1, -1);
    else if (/^now\(\)$/i.test(brut)) row[colonne] = tic();
    else if (/^(true|false)$/i.test(brut)) row[colonne] = /^true$/i.test(brut);
    else NON_COUVERTES.push(`valeur ${colonne} = ${brut}`);
  });
  return { table: tete[1], row };
}

// Le WHERE de readAuditLog, condition par condition. Une condition inconnue arrete la lecture : la base
// ne devine jamais un filtre.
function lireJournal(sql, params) {
  const where = (/ where (.+?) order by /.exec(sql) || [])[1] || '';
  const conditions = where ? where.split(' and ') : [];
  const tests = conditions.map((c) => {
    let m = /^(\w+) = \$(\d+)$/.exec(c);
    if (m) return (ligne) => String(ligne[m[1]]) === String(params[Number(m[2]) - 1]);
    m = /^occurred_at >= \$(\d+)::timestamptz$/.exec(c);
    if (m) return (ligne) => Date.parse(ligne.occurred_at) >= Date.parse(params[Number(m[1]) - 1]);
    m = /^coalesce\(actor_member_id, ''\) not like '([^']*)'$/.exec(c);
    if (m) return (ligne) => !aimeComme(ligne.actor_member_id || '', m[1]);
    throw new Error(`predicat du journal non simule : ${c}`);
  });
  const limite = Number(params[Number((/ limit \$(\d+)/.exec(sql) || [])[1]) - 1]) || 100;
  const choisies = db.audit_log.filter((ligne) => tests.every((t) => t(ligne)))
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id)
    .slice(0, limite);
  return lignes(choisies.map((ligne) => ({ ...ligne })));
}

const roleDe = (m) => db.staff_roles.find((r) => r.center_id === m.center_id && r.id === m.role_id);

async function requete(texte, params = []) {
  const sql = plat(texte);
  if (/^(begin|commit|rollback)/i.test(sql)) return vide();
  if (/pg_advisory/i.test(sql)) return vide();
  if (/^(create|alter|drop|comment on)/i.test(sql)) return vide();

  // L equipe.
  if (/^select id, access_code_hash from staff_members where id = any\(\$1::text\[\]\);?$/i.test(sql)) {
    const proprietaire = hacher(OWNER);
    return lignes((params[0] || []).map((id) => ({ id, access_code_hash: proprietaire })));
  }
  if (/^select distinct name from staff_members where id like \$1;?$/i.test(sql)) {
    return lignes([...new Set(db.staff_members.filter((m) => aimeComme(m.id, params[0])).map((m) => m.name))].map((name) => ({ name })));
  }
  if (/from staff_sessions s join staff_members m on m\.id = s\.member_id/i.test(sql)) {
    const s = db.staff_sessions.find((x) => x.token_hash === params[0] && Date.parse(x.expires_at) > Date.now());
    const m = s && db.staff_members.find((x) => x.id === s.member_id && x.status !== 'blocked');
    const r = m && roleDe(m);
    if (!r) return vide();
    return lignes([{ token_hash: s.token_hash, center_id: s.center_id, expires_at: s.expires_at, member_id: m.id, member_name: m.name, contact: m.contact || '', member_status: m.status, role_id: m.role_id, role_name: r.name, role_code: r.code, permissions: r.permissions, locked: Boolean(r.locked) }]);
  }
  if (/^with touched_session as/i.test(sql)) return vide();
  if (/^select m\.\*, r\.permissions, r\.name as role_name, r\.locked as role_locked from staff_members m join staff_roles r/i.test(sql)) {
    const m = db.staff_members.find((x) => x.center_id === params[0] && x.access_code_hash === params[1] && x.status !== 'blocked');
    const r = m && roleDe(m);
    return r ? lignes([{ ...m, permissions: r.permissions, role_name: r.name, role_locked: r.locked }]) : vide();
  }
  if (/^select \* from staff_roles where center_id = \$1 and access_code_hash = \$2/i.test(sql)) return vide();
  if (/^select \* from staff_roles where center_id = \$1 and id = \$2/i.test(sql)) {
    const r = db.staff_roles.find((x) => x.center_id === params[0] && x.id === params[1]);
    return r ? lignes([{ ...r }]) : vide();
  }
  if (/^select m\.center_id from staff_members m join staff_roles r/i.test(sql)) {
    const m = db.staff_members.find((x) => x.access_code_hash === params[0] && x.status !== 'blocked');
    return m ? lignes([{ center_id: m.center_id }]) : vide();
  }
  if (/^select center_id from staff_roles where access_code_hash = \$1/i.test(sql)) return vide();
  if (/^delete from staff_sessions where expires_at <= now\(\)/i.test(sql)) return vide();
  if (/^update staff_members set status = \$2, last_seen = now\(\) where id = \$1/i.test(sql)) {
    const m = db.staff_members.find((x) => x.id === params[0]);
    if (m) { m.status = params[1]; m.last_seen = tic(); }
    return vide();
  }
  if (/^select \* from staff_roles where center_id = \$1 order by/i.test(sql)) return lignes(db.staff_roles.filter((r) => r.center_id === params[0]).map((r) => ({ ...r })));
  if (/^select \* from staff_members where center_id = \$1 order by/i.test(sql)) return lignes(db.staff_members.filter((m) => m.center_id === params[0]).map((m) => ({ ...m })));
  if (/^select \* from staff_access_events where center_id = \$1 order by created_at desc limit 20/i.test(sql)) {
    return lignes(db.staff_access_events.filter((e) => e.center_id === params[0]).slice().reverse().slice(0, 20).map((e) => ({ ...e })));
  }
  if (/^select id, coalesce\(client_id, ''\) as client_id from centers/i.test(sql)) return lignes(db.centers.map((c) => ({ id: c.id, client_id: c.client_id })));
  if (/^select id, center_id, role_id, status, last_seen, access_code_hash from staff_members where center_id = any/i.test(sql)) {
    return lignes(db.staff_members.filter((m) => (params[0] || []).includes(m.center_id)).map((m) => ({ id: m.id, center_id: m.center_id, role_id: m.role_id, status: m.status, last_seen: m.last_seen || null, access_code_hash: m.access_code_hash })));
  }
  if (/^select id, name from centers where id = any/i.test(sql)) return lignes(db.centers.filter((c) => (params[0] || []).includes(c.id)).map((c) => ({ id: c.id, name: c.name })));
  if (/^select center_id, id, name, locked, tone, permissions from staff_roles where center_id = any/i.test(sql)) {
    return lignes(db.staff_roles.filter((r) => (params[0] || []).includes(r.center_id)).map((r) => ({ center_id: r.center_id, id: r.id, name: r.name, locked: r.locked, tone: r.tone, permissions: r.permissions })));
  }
  if (/^select 1 from centers where id = \$1/i.test(sql)) return db.centers.some((c) => c.id === params[0]) ? lignes([{ '?column?': 1 }]) : vide();

  // Les ecritures.
  if (/^insert into/i.test(sql)) {
    const lu = lireInsert(sql, params);
    if (!lu || !db[lu.table]) { NON_COUVERTES.push(sql.slice(0, 160)); return vide(); }
    const ligne = { ...lu.row, id: db[lu.table].length + 1, created_at: tic() };
    if (lu.table === 'audit_log') ligne.occurred_at = ligne.created_at;
    db[lu.table].push(ligne);
    return lignes([{ id: ligne.id, occurred_at: ligne.occurred_at || ligne.created_at }]);
  }

  // Le journal d audit et les dossiers.
  if (/^select .* from audit_log where /i.test(sql)) return lireJournal(sql, params);
  if (/^select \* from reservations where id = \$1 limit 1;?$/i.test(sql)) {
    const r = db.reservations.find((x) => Number(x.id) === Number(params[0]));
    return r ? lignes([{ ...r }]) : vide();
  }
  if (/^select id, phone, email from reservations where id = \$1 and center_id = \$2/i.test(sql)) {
    const r = db.reservations.find((x) => Number(x.id) === Number(params[0]) && x.center_id === params[1]);
    return r ? lignes([{ id: r.id, phone: r.phone, email: r.email }]) : vide();
  }
  if (/^select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = \$1 and client_key = any/i.test(sql)) {
    return lignes(db.client_notes.filter((n) => n.center_id === params[0] && (params[1] || []).includes(n.client_key)).map((n) => ({ client_key: n.client_key, body: n.body, version: n.updated_at, updated_by: n.updated_by })));
  }
  if (/from schema_migrations|from centers where id = \$1 limit 1/i.test(sql)) return vide();
  NON_COUVERTES.push(sql.slice(0, 160));
  return vide();
}

class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  async end() {}
  on() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool, Client: FakePool } };

// ---------------------------------------------------------------------------
// LE CENTRE ET SES TRACES.
// ---------------------------------------------------------------------------
const FONDATEUR = 'libramont:platform-owner';
const SECOURS = 'libramont:platform-owner-emergency';
function remplirBase() {
  const { ALL_PERMISSIONS, PLATFORM_PERMISSIONS, STAFF_ROLE_PRESETS } = require(LIB('staff-auth.js'));
  const manager = STAFF_ROLE_PRESETS.find((p) => p.id === 'manager');
  const t0 = '2026-11-01T08:00:00.000Z';
  db = {
    centers: [
      { id: 'libramont', name: 'Fun Galaxy Libramont', client_id: 'fungalaxy' },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', client_id: 'fungalaxy' },
    ],
    staff_roles: [
      { center_id: 'libramont', id: 'direction', name: 'Direction', code: 'DI', tone: 'direction', permissions: [...ALL_PERMISSIONS], locked: true, access_code_hash: 'x', access_code_hint: '', created_at: t0, updated_at: t0 },
      { center_id: 'libramont', id: 'manager', name: 'Manager', code: 'MA', tone: 'manager', permissions: [...manager.permissions], locked: false, access_code_hash: 'y', access_code_hint: '', created_at: t0, updated_at: t0 },
      { center_id: 'libramont', id: 'platform-owner', name: 'Proprietaire plateforme', code: 'PL', tone: 'platform', permissions: [...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS], locked: true, access_code_hash: 'verrouille:aucun-code-de-role', access_code_hint: '', created_at: t0, updated_at: t0 },
    ],
    staff_members: [
      { id: 'libramont:direction-marie', center_id: 'libramont', name: 'Marie Dumont', contact: 'marie@fungalaxy.be', role_id: 'direction', status: 'active', access_code_hash: hacher(CODES.marie), access_code_hint: '2026', created_at: t0, updated_at: t0, last_seen: null },
      { id: 'libramont:manager-luc', center_id: 'libramont', name: 'Luc Martin', contact: '', role_id: 'manager', status: 'active', access_code_hash: hacher(CODES.luc), access_code_hint: '2026', created_at: t0, updated_at: t0, last_seen: null },
      { id: FONDATEUR, center_id: 'libramont', name: NOM_ACTUEL, contact: 'Acces Pinlane', role_id: 'platform-owner', status: 'active', access_code_hash: hacher(OWNER), access_code_hint: '2026', created_at: t0, updated_at: t0, last_seen: null },
    ],
    staff_sessions: [],
    staff_access_events: [],
    audit_log: [],
    reservations: [
      { id: 9201, center_id: 'libramont', channel: 'staff', name: 'Famille Lambert', phone: '0470123456', email: 'lambert@exemple.be', date: '2026-11-15', start_time: '15:00', duration: 1, type: 'bowling', pax: 6, status: 'pending', price: 60, lanes: [3], notes: '', ops_plan: null, created_at: t0, updated_at: t0 },
    ],
    client_notes: [],
  };
  const journal = (champs) => db.audit_log.push({ id: db.audit_log.length + 1, center_id: 'libramont', actor_kind: 'staff', actor_role_id: null, surface: 'api/staff-reservations.js', method: 'PATCH', entity_type: 'reservation', entity_id: '9201', outcome: 'success', denied_reason: null, context: {}, request_id: '', ...champs });
  journal({ occurred_at: '2026-11-10T10:00:00.000Z', actor_member_id: 'libramont:direction-marie', actor_label: 'Marie Dumont', action: 'updateReservation', changes: { pax: { before: 4, after: 6 } } });
  journal({ occurred_at: '2026-11-11T10:00:00.000Z', actor_member_id: FONDATEUR, actor_label: NOM_ACTUEL, action: 'updateReservation', changes: { startTime: { before: '14:00', after: '15:00' } } });
  journal({ occurred_at: '2026-11-12T10:00:00.000Z', actor_member_id: SECOURS, actor_label: NOM_DE_NAISSANCE, action: 'updateReservation', changes: { date: { before: '2026-11-14', after: '2026-11-15' } } });
}

// ---------------------------------------------------------------------------
// LES SERVEURS : les vrais, recharges a chaque contre-preuve.
// ---------------------------------------------------------------------------
function purgerLeProjet() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(path.join(ROOT, 'lib') + path.sep) || cle.startsWith(path.join(ROOT, 'api') + path.sep)) delete require.cache[cle];
  }
}

// Les modules mutes entrent dans le cache AVANT tout le reste : qui les demande recoit la mutation.
function poserLesMutations(mutations) {
  purgerLeProjet();
  for (const { fichier, de, vers } of mutations) {
    const source = lf(fs.readFileSync(fichier, 'utf8'));
    if (!source.includes(de)) throw new Error(`contre-preuve sans ancre dans ${path.relative(ROOT, fichier)} : ${de.slice(0, 90)}`);
    const m = new Module(fichier, module);
    m.filename = fichier;
    m.paths = Module._nodeModulePaths(path.dirname(fichier));
    require.cache[fichier] = m;
    m._compile(source.split(de).join(vers), fichier);
    m.loaded = true;
  }
}

const ROUTES = { '/api/staff-auth': 'staff-auth.js', '/api/staff-reservations': 'staff-reservations.js', '/api/staff-customer-notes': 'staff-customer-notes.js', '/api/ops': 'ops.js' };
const serveur = http.createServer(async (req, res) => {
  const route = ROUTES[new URL(req.url, BASE).pathname];
  if (!route) { res.statusCode = 404; res.end('{}'); return; }
  try {
    await require(API(route))(req, res);
  } catch (error) {
    if (!res.writableEnded) { res.statusCode = 599; res.end(JSON.stringify({ ok: false, message: String(error && error.message) })); }
  }
});

async function appeler(chemin, { methode = 'GET', jeton = '', corps } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: { 'content-type': 'application/json', ...(jeton ? { 'x-staff-session': jeton } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  let json = null;
  try { json = JSON.parse(texte); } catch (e) { json = null; }
  return { statut: reponse.status, texte, json, cookie: reponse.headers.get('set-cookie') || '' };
}

async function connecter(code) {
  const r = await appeler('/api/staff-auth', { methode: 'POST', corps: { action: 'login', centerId: 'libramont', code } });
  const jeton = decodeURIComponent((/pinlane_staff_session=([^;]+)/.exec(r.cookie) || [])[1] || '');
  return { ...r, jeton };
}

async function sessionsDuBanc() {
  const marie = await connecter(CODES.marie);
  const luc = await connecter(CODES.luc);
  const fondateur = await connecter(CODES.fondateur);
  const staffAuth = require(LIB('staff-auth.js'));
  const secours = staffAuth.__test.createEmergencyOwnerSession({ centerId: 'libramont', code: OWNER });
  return { marie, luc, fondateur, secours: { jeton: secours ? secours.session.token : '', session: secours && secours.session } };
}

const traceDuFondateur = (texte) => /platform-owner|Ansar Pinlane|Proprietaire plateforme|Propriétaire plateforme/i.test(String(texte));

// ---------------------------------------------------------------------------
// [R] LA REGLE PARTAGEE.
// ---------------------------------------------------------------------------
function regle() {
  section = 'R';
  const F = require(LIB('fondateur-invisible.js'));
  const staffAuth = require(LIB('staff-auth.js'));
  const direction = { member: { id: 'libramont:direction-marie', name: 'Marie Dumont' }, role: { id: 'direction', locked: true }, permissions: [...staffAuth.ALL_PERMISSIONS] };
  const fondateur = { member: { id: FONDATEUR, name: NOM_ACTUEL }, role: { id: 'platform-owner', locked: true }, permissions: [...staffAuth.ALL_PERMISSIONS, 'platform.admin'] };
  const secours = staffAuth.__test.createEmergencyOwnerSession({ centerId: 'libramont', code: OWNER }).session;
  ok(F.estFondateur(fondateur) && F.estFondateur(secours) && !F.estFondateur(direction) && !F.estFondateur(null), '[R] estFondateur : la permission de plateforme, session de secours comprise, jamais la Direction verrouillee');
  ok(F.estMembreFondateur(FONDATEUR) && F.estMembreFondateur(SECOURS) && !F.estMembreFondateur('libramont:direction-marie') && !F.estMembreFondateur(''), '[R] une ligne ecrite est du fondateur par son membre (:platform-owner), secours compris');
  ok(F.signatureVisible(fondateur) === '' && F.signatureVisible(secours) === '' && F.signatureVisible(direction) === 'Marie Dumont', '[R] la signature d une trace : celle du membre, rien pour le fondateur');
  const noms = new Set(['ansar pinlane', 'proprietaire plateforme']);
  const note = (par, t, le) => `[equipe] ${JSON.stringify({ t, par, le })}`;
  const brut = {
    reservations: [{
      id: 9201, name: 'Famille Lambert',
      notes: ['Mot du client', note(NOM_ACTUEL, 'Allergie aux noix', '2026-11-10T10:00:00.000Z'), note('Marie Dumont', 'Gateau a 16 h', '2026-11-10T11:00:00.000Z')].join('\n'),
      extras: [{ name: 'Pizza × 6', par: NOM_DE_NAISSANCE }, { name: 'Boissons', par: 'Marie Dumont' }],
      opsPlan: { derniereModif: { le: '2026-11-11T10:00:00.000Z', par: 'Propriétaire plateforme', quoi: ['Heure 14:00 → 15:00'] } },
      activityProgress: { bowling: { done: true, by: NOM_ACTUEL }, laser: { done: true, by: 'Luc Martin' } },
    }],
    threads: [{ id: 3, lecteurs: [{ memberId: FONDATEUR, memberName: NOM_ACTUEL }, { memberId: 'libramont:direction-marie', memberName: 'Marie Dumont' }], reponduPar: { memberName: NOM_ACTUEL, at: '2026-11-12' }, prise: { memberId: SECOURS, memberName: NOM_DE_NAISSANCE } }],
    messages: [{ id: 8, sentBy: { memberId: FONDATEUR, memberName: NOM_ACTUEL }, lectures: [{ memberId: '', memberName: NOM_DE_NAISSANCE }] }],
    suivi: [{ type: 'prise-en-charge', par: NOM_ACTUEL }, { type: 'note', par: 'Luc Martin', texte: 'Rappeler mardi' }],
    members: [{ id: FONDATEUR, name: NOM_ACTUEL }, { id: 'libramont:direction-marie', name: 'Marie Dumont' }],
    archivedBy: `${FONDATEUR} ${NOM_ACTUEL}`,
    client: { name: 'Ansar Pinlane' },
  };
  const vu = F.masquerFondateur(brut, noms);
  const r = vu.reservations[0];
  ok(!traceDuFondateur(r.notes) && r.notes.includes('Allergie aux noix') && r.notes.includes('"par":"Marie Dumont"'), '[R] une note du fondateur garde son texte et perd son nom, celle de Marie garde le sien', r.notes);
  ok(r.extras[0].par === '' && r.extras[1].par === 'Marie Dumont' && r.opsPlan.derniereModif.par === '' && r.opsPlan.derniereModif.quoi.length === 1, '[R] sur mesure et derniere modification : le nom du fondateur part, la modification reste', r);
  ok(r.activityProgress.bowling.by === '' && r.activityProgress.bowling.done === true && r.activityProgress.laser.by === 'Luc Martin', '[R] une coche reste cochee, sans le nom du fondateur', r.activityProgress);
  ok(vu.threads[0].lecteurs.length === 1 && vu.threads[0].lecteurs[0].memberName === 'Marie Dumont' && vu.threads[0].reponduPar === null && vu.threads[0].prise === null, '[R] mails : sa lecture sort de la liste, sa reponse et sa prise n ont plus de nom', vu.threads[0]);
  ok(vu.messages[0].sentBy === null && vu.messages[0].lectures.length === 0, '[R] un vieux « lu par » qui ne garde que son nom sort aussi', vu.messages[0]);
  ok(vu.suivi[0].par === '' && vu.suivi[0].type === 'prise-en-charge' && vu.suivi[1].par === 'Luc Martin', '[R] le suivi d une demande garde l evenement, sans son nom', vu.suivi);
  ok(vu.members.length === 1 && vu.archivedBy === '' && vu.client.name === 'Ansar Pinlane', '[R] son membre et son identifiant partent ; le nom d un client ne se touche jamais', vu);
  ok(!traceDuFondateur(JSON.stringify({ ...vu, client: null })), '[R] plus aucune trace du fondateur dans la valeur masquee', JSON.stringify(vu).slice(0, 300));
  const rendues = F.notesRendues(`${r.notes}\n${note('', 'Nouvelle', '2026-11-13T10:00:00.000Z')}`, brut.reservations[0].notes, noms);
  ok(rendues.split('\n')[1] === brut.reservations[0].notes.split('\n')[1] && rendues.endsWith(note('', 'Nouvelle', '2026-11-13T10:00:00.000Z')), '[R] le chemin du retour : une note masquee redevient la ligne en base, une nouvelle reste nouvelle', rendues);
}

// ---------------------------------------------------------------------------
// [E] EQUIPE & ACCES.
// ---------------------------------------------------------------------------
async function equipe() {
  section = 'E';
  remplirBase();
  const s = await sessionsDuBanc();
  ok(s.marie.statut === 200 && s.luc.statut === 200 && s.fondateur.statut === 200 && s.marie.jeton && s.fondateur.jeton && s.secours.jeton, '[E] Marie, Luc et le fondateur se connectent (vraie route), la session de secours existe', [s.marie.statut, s.luc.statut, s.fondateur.statut]);
  const connexions = db.staff_access_events.filter((e) => e.event_type === 'login_success');
  ok(connexions.some((e) => e.actor_member_id === 'libramont:direction-marie' && e.label === 'Marie Dumont connecté'), '[E] la connexion de Marie entre dans les evenements du centre', connexions);
  ok(!connexions.some((e) => String(e.actor_member_id || '').includes(':platform-owner')) && !db.staff_access_events.some((e) => traceDuFondateur(e.label)), '[E] la connexion du fondateur n y entre pas', db.staff_access_events);
  ok(db.audit_log.some((l) => l.action === 'login' && l.actor_member_id === FONDATEUR), '[E] le journal d audit garde la connexion du fondateur (la securite en a besoin)', db.audit_log.map((l) => [l.action, l.actor_member_id]));
  ok(!traceDuFondateur(s.marie.texte) && Array.isArray(s.marie.json.accessControl.events) && s.marie.json.accessControl.events.length === 0, '[E] la reponse de connexion de la Direction : ni le fondateur, ni le journal', s.marie.texte.slice(0, 300));
  const vueMarie = await appeler('/api/staff-auth?centerId=libramont', { jeton: s.marie.jeton });
  const ac = (vueMarie.json && vueMarie.json.accessControl) || {};
  ok(vueMarie.statut === 200 && (ac.members || []).length === 2 && !(ac.members || []).some((m) => String(m.id).includes('platform-owner')), '[E] Direction : l equipe sans le membre du fondateur (ni sa derniere venue)', (ac.members || []).map((m) => m.id));
  ok(!(ac.roles || []).some((r) => r.id === 'platform-owner') && (ac.roles || []).length === 2, '[E] Direction : les roles sans celui de la plateforme', (ac.roles || []).map((r) => r.id));
  ok(Array.isArray(ac.events) && ac.events.length === 0, '[E] Direction : le journal de l equipe ne part pas (il est au fondateur)', ac.events);
  ok(!traceDuFondateur(vueMarie.texte), '[E] Direction : aucune trace du fondateur dans toute la reponse, meme par appel direct', vueMarie.texte.slice(0, 300));
  const vueFondateur = await appeler('/api/staff-auth?centerId=libramont', { jeton: s.fondateur.jeton });
  const acF = (vueFondateur.json && vueFondateur.json.accessControl) || {};
  ok((acF.members || []).some((m) => m.id === FONDATEUR) && (acF.roles || []).some((r) => r.id === 'platform-owner'), '[E] le fondateur voit tout : son membre et son role', (acF.members || []).map((m) => m.id));
  ok((acF.events || []).some((e) => e.label === 'Marie Dumont connecté'), '[E] le fondateur lit le journal de l equipe', acF.events);
  const vueSecours = await appeler('/api/staff-auth?centerId=libramont', { jeton: s.secours.jeton });
  ok(vueSecours.statut === 200 && ((vueSecours.json.accessControl || {}).events || []).length > 0, '[E] la session de secours est le fondateur : elle lit aussi le journal', vueSecours.texte.slice(0, 200));
  return s;
}

// ---------------------------------------------------------------------------
// [A] LE JOURNAL D AUDIT.
// ---------------------------------------------------------------------------
async function journalDAudit() {
  section = 'A';
  remplirBase();
  const { readAuditLog } = require(LIB('audit-log.js'));
  const parDefaut = await readAuditLog({ centerId: 'libramont', limit: 50 });
  ok(parDefaut.length === 1 && parDefaut[0].actorMemberId === 'libramont:direction-marie', '[A] readAuditLog : par defaut, ni le fondateur ni sa session de secours', parDefaut.map((l) => l.actorMemberId));
  const avecLui = await readAuditLog({ centerId: 'libramont', limit: 50, avecFondateur: true });
  ok(avecLui.length === 3, '[A] readAuditLog : avec avecFondateur, toutes les lignes (rien n est efface)', avecLui.map((l) => l.actorMemberId));
  const s = await sessionsDuBanc();
  const histo = async (jeton) => appeler('/api/staff-reservations?centerId=libramont&historique=9201', { jeton });
  const hMarie = await histo(s.marie.jeton);
  const hLuc = await histo(s.luc.jeton);
  const hFondateur = await histo(s.fondateur.jeton);
  const quoi = (r) => ((r.json && r.json.historique) || []).flatMap((e) => e.quoi);
  ok(hMarie.statut === 200 && quoi(hMarie).length === 1 && /4 → 6 joueurs/.test(quoi(hMarie)[0]) && hMarie.json.historique[0].par === 'Marie Dumont', '[A] historique, Direction : le geste de Marie reste, avec son nom', hMarie.texte.slice(0, 300));
  ok(!traceDuFondateur(hMarie.texte) && !/Heure 14:00|Date /.test(hMarie.texte), '[A] historique, Direction : rien de ce que le fondateur a fait sur le dossier', hMarie.texte.slice(0, 300));
  ok(hLuc.statut === 200 && !traceDuFondateur(hLuc.texte) && quoi(hLuc).length === 1, '[A] historique, Manager : pareil', hLuc.texte.slice(0, 300));
  ok(hFondateur.statut === 200 && quoi(hFondateur).length === 3 && hFondateur.texte.includes(NOM_ACTUEL), '[A] historique, fondateur : tout, ses gestes compris', hFondateur.texte.slice(0, 300));
  const plateforme = await appeler('/api/ops?action=auditLog&centerId=libramont', { jeton: s.fondateur.jeton });
  ok(plateforme.statut === 200 && ((plateforme.json && plateforme.json.entries) || []).some((l) => l.actorMemberId === FONDATEUR), '[A] Plateforme › Journal : le fondateur y lit ses propres lignes', plateforme.texte.slice(0, 300));
  const refus = await appeler('/api/ops?action=auditLog&centerId=libramont', { jeton: s.marie.jeton });
  ok(refus.statut === 403, '[A] la Direction n ouvre pas le journal de la plateforme', refus.statut);
}

// ---------------------------------------------------------------------------
// [M] LES REPONSES DU CENTRE.
// ---------------------------------------------------------------------------
async function reponses() {
  section = 'M';
  remplirBase();
  const { normalizeClientKey } = require(LIB('ops-communications.js'));
  const cle = normalizeClientKey({ phone: '0470123456' });
  db.client_notes.push({ center_id: 'libramont', client_key: cle, body: 'Client fidele, prefere la piste 3.', updated_at: '2026-11-12 10:00:00+00', updated_by: NOM_ACTUEL });
  const s = await sessionsDuBanc();
  const note = async (jeton) => appeler('/api/staff-customer-notes?centerId=libramont&reservationId=9201', { jeton });
  const nMarie = await note(s.marie.jeton);
  const nLuc = await note(s.luc.jeton);
  const nFondateur = await note(s.fondateur.jeton);
  const nSecours = await note(s.secours.jeton);
  const de = (r) => (r.json && r.json.note) || {};
  ok(nMarie.statut === 200 && de(nMarie).body === 'Client fidele, prefere la piste 3.' && de(nMarie).updatedBy === '', '[M] note client, Direction : le texte reste, le nom actuel du fondateur part (vieille ligne)', nMarie.texte);
  ok(nLuc.statut === 200 && de(nLuc).updatedBy === '' && !traceDuFondateur(nLuc.texte), '[M] note client, Manager : pareil', nLuc.texte);
  ok(de(nFondateur).updatedBy === NOM_ACTUEL && de(nSecours).updatedBy === NOM_ACTUEL, '[M] note client, fondateur et session de secours : son nom reste', [nFondateur.texte, nSecours.texte]);
  db.client_notes[0].updated_by = NOM_DE_NAISSANCE;
  const nMarie2 = await note(s.marie.jeton);
  ok(de(nMarie2).updatedBy === '', '[M] le nom de naissance du membre fondateur part aussi', nMarie2.texte);
  db.client_notes[0].updated_by = 'Marie Dumont';
  const nMarie3 = await note(s.marie.jeton);
  ok(de(nMarie3).updatedBy === 'Marie Dumont', '[M] le nom de Marie reste', nMarie3.texte);
}

// ---------------------------------------------------------------------------
// [C] LES CONTRE-PREUVES.
// ---------------------------------------------------------------------------
const CONTRE_PREUVES = [
  { nom: 'le membre du fondateur rendu a la Direction', section: 'E', jouer: equipe, fichier: LIB('staff-auth.js'),
    de: "const lesMembres = fondateur ? members.rows : members.rows.filter((row) => !estMembreFondateur(row.id));", vers: 'const lesMembres = members.rows;' },
  { nom: 'le journal de l equipe rendu a la Direction', section: 'E', jouer: equipe, fichier: LIB('staff-auth.js'),
    de: 'events: fondateur ? events.rows.map(mapEvent) : [],', vers: 'events: events.rows.map(mapEvent),' },
  { nom: 'la connexion du fondateur inscrite au centre', section: 'E', jouer: equipe, fichier: LIB('staff-auth.js'),
    de: 'if (!estMembreFondateur(subject.member.id)) {', vers: 'if (true) {' },
  { nom: 'le journal d audit lu sans le filtre', section: 'A', jouer: journalDAudit, fichier: LIB('audit-log.js'),
    de: 'if (options.avecFondateur !== true) {', vers: 'if (false) {' },
  { nom: 'l historique ouvert avec le fondateur pour tous', section: 'A', jouer: journalDAudit, fichiers: [
    { fichier: API('staff-reservations.js'), de: 'avecFondateur: estFondateur(sessionHistorique)', vers: 'avecFondateur: true' },
  ] },
  { nom: 'la marque des reponses jamais posee', section: 'M', jouer: reponses, fichier: LIB('staff-auth.js'),
    de: "res.__nomsDuFondateur = estFondateur(effective) ? null : await nomsDuFondateur();", vers: 'res.__nomsDuFondateur = null;' },
  { nom: 'sendJson qui ignore la marque', section: 'M', jouer: reponses, fichier: LIB('http.js'),
    de: 'const sansFondateur = res.__nomsDuFondateur ?', vers: 'const sansFondateur = false ?' },
  { nom: 'le nom actuel du fondateur jamais lu', section: 'M', jouer: reponses, fichier: LIB('fondateur-invisible.js'),
    de: "lus = (result && Array.isArray(result.rows) ? result.rows : []).map((row) => row && row.name).filter(Boolean);", vers: 'lus = [];' },
];

async function contrePreuves() {
  for (const cp of CONTRE_PREUVES) {
    const mutations = cp.fichiers || [{ fichier: cp.fichier, de: cp.de, vers: cp.vers }];
    let rouge = false;
    let erreur = '';
    MUET = true;
    rougesMuets = [];
    const avant = SECTIONS[cp.section] ? SECTIONS[cp.section].ko : 0;
    try {
      poserLesMutations(mutations);
      await cp.jouer();
      rouge = (SECTIONS[cp.section] ? SECTIONS[cp.section].ko : 0) > avant;
    } catch (e) {
      erreur = String(e && e.message);
      rouge = !/sans ancre/.test(erreur);
    } finally {
      MUET = false;
      purgerLeProjet();
    }
    section = 'C';
    ok(rouge, `[C] ${cp.nom} : la section [${cp.section}] rougit`, erreur || undefined);
    if (process.argv.includes('--detail')) console.log(`      ${erreur ? `erreur : ${erreur}` : rougesMuets.slice(0, 4).join('\n      ')}`);
  }
}

(async () => {
  await new Promise((resolve) => serveur.listen(PORT, '127.0.0.1', resolve));
  try {
    remplirBase();
    regle();
    await equipe();
    await journalDAudit();
    await reponses();
    if (!process.argv.includes('--sans-contre-preuves')) await contrePreuves();
  } catch (error) {
    echecs += 1;
    console.log(`FAIL  le banc s est arrete : ${error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`);
  } finally {
    serveur.close();
  }
  section = 'Z';
  const inconnues = [...new Set(NON_COUVERTES)];
  if (inconnues.length) console.log(`note  requetes non servies par la base en memoire (rendues vides) : ${inconnues.length}\n      ${inconnues.slice(0, 12).join('\n      ')}`);
  console.log(echecs ? `\n${echecs} echec(s).` : '\nfondateur-invisible : tout est vert.');
  process.exit(echecs ? 1 : 0);
})();
