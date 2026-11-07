'use strict';
// UN CODE OUVRE SON CENTRE, ET L ECRAN EQUIPE & ACCES RESTE SUR LE CENTRE AFFICHE (2026-11-06).
//
// Ansar : « les codes et tout le systeme fonctionne pas parce que ca me connecte uniquement sur Libramont ».
// Lu en prod ce jour-la, en lecture seule (journal d audit, aucune valeur de code) : connecte a Libramont,
// Gembloux a l ecran, « Regenerer » sur Staff bar visait bien Gembloux, et le « Copier » d une seconde plus
// tard visait Libramont ; le code colle a ouvert Libramont. Meme chose a 12:47 avec Direction. Cause :
// runStaffAuthAction range la session que le serveur renvoie, et storeStaffAuthSession remettait le centre
// de l ecran sur celui de la session. Apres le premier geste de la page, les suivants (copier, regenerer,
// droits, bloquer, supprimer) partaient a Libramont sous un ecran qui disait Gembloux.
//
//   [S] le serveur : le vrai lib/staff-auth.js derriere le vrai api/staff-auth.js, sur une base en memoire
//       qui obeit au SQL. Un code ne a Gembloux (code de role, code de membre) ouvre Gembloux depuis l ecran
//       de connexion de Libramont ; un code de Libramont ouvre Libramont depuis celui de Gembloux.
//   [E] l ecran, en vrais clics dans la vraie console : le code fondateur tape a Libramont, Gembloux choisi
//       dans le menu des centres, Equipe & acces, Staff bar : Copier, Regenerer, Copier. Le code copie est
//       celui de Gembloux ; tape dans la fenetre de connexion, il ouvre Gembloux. Puis un code de Libramont,
//       tape depuis l ecran de Gembloux, ouvre Libramont.
//   [C] les contre-preuves, compilees en memoire (le disque n est jamais ecrit) : l ancienne ligne de
//       storeStaffAuthSession fait copier le code de Libramont et ouvre Libramont, [E] ROUGE ; une session
//       qui prend le centre de l ecran au lieu de celui du code fait rougir [S].
//
// Rien ne part : ni base, ni reseau, ni mail, et aucun code n est jamais ecrit dans la sortie.
// Lancement : node scripts/equipe-centre-check.js [--images=<dossier>]
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_INSECURE_STAFF_CODES;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-equipe-centre-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-EQUIPE-2026';

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const STAFF_AUTH = path.join(ROOT, 'lib', 'staff-auth.js');
const API_STAFF_AUTH = path.join(ROOT, 'api', 'staff-auth.js');
const PORT = Number(process.env.PINLANE_EQUIPE_CENTRE_PORT || 5317);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OWNER = process.env.PLATFORM_OWNER_CODE;
const IMAGES = (process.argv.find((a) => a.startsWith('--images=')) || '').slice('--images='.length);
const lf = (t) => String(t).split('\r\n').join('\n');

let echecs = 0;
function ok(condition, message, detail) {
  if (condition) { console.log(`ok    ${message}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`}`);
  return false;
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE, qui lit les colonnes et les valeurs DANS le SQL (meme
// moteur que scripts/staff-access-codes-check.js, plus les centres d une meme
// entreprise et le journal d audit, que la page lit comme la prod).
// ---------------------------------------------------------------------------
let db;
const NON_COUVERTES = [];
let horloge = Date.parse('2026-11-06T11:40:00.000Z');
function tic() { horloge += 1000; return new Date(horloge).toISOString(); }
function viderBase() {
  db = {
    centers: [
      { id: 'libramont', name: 'Fun Galaxy Libramont', client_id: 'fungalaxy', status: 'active', timezone: 'Europe/Brussels', settings: {} },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', client_id: 'fungalaxy', status: 'active', timezone: 'Europe/Brussels', settings: {} },
      { id: 'ciney', name: 'Fun Galaxy Ciney', client_id: 'fungalaxy', status: 'active', timezone: 'Europe/Brussels', settings: {} },
    ],
    staff_roles: [], staff_members: [], staff_sessions: [], staff_access_events: [], audit_log: [],
  };
}
viderBase();
const vide = () => ({ rows: [], rowCount: 0 });
const lignes = (rows) => ({ rows, rowCount: rows.length });
const sqlPlat = (texte) => String(texte).replace(/\s+/g, ' ').trim();

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
    const brut = valeurs[i];
    const place = brut.match(/^\$(\d+)(::jsonb)?$/i);
    if (place) {
      let valeur = params[Number(place[1]) - 1];
      if (place[2] && typeof valeur === 'string') { try { valeur = JSON.parse(valeur); } catch (e) { /* chaine brute */ } }
      row[colonne] = valeur === undefined ? null : valeur;
    } else if (/^'([^']*)'$/.test(brut)) row[colonne] = brut.slice(1, -1);
    else if (/^now\(\)$/i.test(brut)) row[colonne] = tic();
    else if (/^(true|false)$/i.test(brut)) row[colonne] = /^true$/i.test(brut);
    else NON_COUVERTES.push(`valeur ${colonne} = ${brut}`);
  });
  return { table: tete[1], row, suite: sql.slice(fin) };
}

const CLES = {
  staff_roles: (r) => `${r.center_id}::${r.id}`,
  staff_members: (r) => String(r.id),
  staff_sessions: (r) => String(r.token_hash),
};

function inserer(sql, params) {
  const lu = lireInsert(sql, params);
  if (!lu) return null;
  const { table, row, suite } = lu;
  const store = db[table];
  if (!store) { NON_COUVERTES.push(`table ${table}`); return vide(); }
  if (table === 'staff_access_events' || table === 'audit_log') {
    const ligne = { ...row, id: store.length + 1, created_at: tic() };
    ligne.occurred_at = ligne.created_at;
    store.push(ligne);
    return lignes([{ id: ligne.id, occurred_at: ligne.occurred_at }]);
  }
  const cle = CLES[table];
  const existant = store.find((item) => cle(item) === cle(row));
  if (existant) {
    if (/do nothing/i.test(suite)) return vide();
    const affectations = (suite.match(/do update set (.*?)(?: returning |;|$)/i) || [])[1] || '';
    for (const morceau of affectations.split(',')) {
      const i = morceau.indexOf('=');
      if (i < 0) continue;
      const colonne = morceau.slice(0, i).trim();
      const valeur = morceau.slice(i + 1).trim().replace(/;$/, '');
      if (/^excluded\.\w+$/i.test(valeur)) existant[colonne] = row[valeur.split('.')[1]];
      else if (/^now\(\)$/i.test(valeur)) existant[colonne] = tic();
      else if (/^'([^']*)'$/.test(valeur)) existant[colonne] = valeur.slice(1, -1);
      else if (/^(true|false)$/i.test(valeur)) existant[colonne] = /^true$/i.test(valeur);
      else if (/^case when staff_members\.status = 'blocked' then 'blocked' else 'active' end$/i.test(valeur)) {
        existant[colonne] = existant.status === 'blocked' ? 'blocked' : 'active';
      } else NON_COUVERTES.push(`affectation ${colonne} = ${valeur}`.slice(0, 160));
    }
    existant.updated_at = tic();
    return lignes([{ ...existant }]);
  }
  const t = tic();
  const cree = { created_at: t, updated_at: t, ...row };
  store.push(cree);
  return lignes([{ ...cree }]);
}

const GARDE = "and (m.id <> (m.center_id || ':role:' || m.role_id) or r.access_code_hash = m.access_code_hash)";
const roleDe = (m) => db.staff_roles.find((r) => r.center_id === m.center_id && r.id === m.role_id);
function retenu(m, garde) {
  const role = roleDe(m);
  if (!role) return false;
  if (!garde) return true;
  return m.id !== `${m.center_id}:role:${m.role_id}` || role.access_code_hash === m.access_code_hash;
}
function majDepuis(sql, params, ligne, tete) {
  const affectations = sql.match(tete)[1];
  for (const morceau of affectations.split(',')) {
    const i = morceau.indexOf('=');
    const colonne = morceau.slice(0, i).trim();
    const valeur = morceau.slice(i + 1).trim();
    const place = valeur.match(/^\$(\d+)(::jsonb)?$/i);
    if (place) {
      let v = params[Number(place[1]) - 1];
      if (place[2] && typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { /* chaine brute */ } }
      ligne[colonne] = v;
    } else if (/^now\(\)$/i.test(valeur)) ligne[colonne] = tic();
    else if (/^(true|false)$/i.test(valeur)) ligne[colonne] = /^true$/i.test(valeur);
    else if (/^'([^']*)'$/.test(valeur)) ligne[colonne] = valeur.slice(1, -1);
    else NON_COUVERTES.push(`update ${colonne} = ${valeur}`.slice(0, 160));
  }
}

async function requete(texte, params = []) {
  const sql = sqlPlat(texte);
  if (/^(begin|commit|rollback)/i.test(sql)) return vide();
  if (/pg_advisory_xact_lock/i.test(sql)) return vide();
  if (/^(create|alter|drop|comment on)/i.test(sql)) return vide();
  if (/^insert into/i.test(sql)) { const r = inserer(sql, params); if (r) return r; }
  const garde = sql.includes(GARDE);

  if (/^select 1 from centers where id = \$1/i.test(sql)) return db.centers.some((c) => c.id === params[0]) ? lignes([{ '?column?': 1 }]) : vide();
  if (/^select id, coalesce\(client_id, ''\) as client_id from centers/i.test(sql)) return lignes(db.centers.map((c) => ({ id: c.id, client_id: c.client_id })));
  if (/^select m\.center_id from staff_members m join staff_roles r .* where m\.access_code_hash = \$1/i.test(sql)) {
    const eligibles = db.staff_members
      .filter((m) => m.access_code_hash === params[0] && m.status !== 'blocked' && retenu(m, garde))
      .sort((a, b) => {
        const vuA = a.last_seen ? Date.parse(a.last_seen) : -Infinity;
        const vuB = b.last_seen ? Date.parse(b.last_seen) : -Infinity;
        if (vuA !== vuB) return vuB - vuA;
        return (Date.parse(a.created_at) - Date.parse(b.created_at)) || String(a.center_id).localeCompare(String(b.center_id));
      });
    return eligibles[0] ? lignes([{ center_id: eligibles[0].center_id }]) : vide();
  }
  if (/^select center_id from staff_roles where access_code_hash = \$1/i.test(sql)) {
    const roles = db.staff_roles.filter((r) => r.access_code_hash === params[0])
      .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || String(a.center_id).localeCompare(String(b.center_id)));
    return roles[0] ? lignes([{ center_id: roles[0].center_id }]) : vide();
  }
  if (/^select id, access_code_hash from staff_members where id = any/i.test(sql)) {
    const ids = Array.isArray(params[0]) ? params[0] : [];
    return lignes(db.staff_members.filter((m) => ids.includes(m.id)).map((m) => ({ id: m.id, access_code_hash: m.access_code_hash })));
  }
  if (/^select m\.\*, r\.permissions/i.test(sql)) {
    const m = db.staff_members.find((x) => x.center_id === params[0] && x.access_code_hash === params[1] && x.status !== 'blocked' && retenu(x, garde));
    if (!m) return vide();
    const r = roleDe(m);
    return lignes([{ ...m, permissions: r.permissions || [], role_name: r.name, role_locked: r.locked }]);
  }
  if (/^select \* from staff_roles where center_id = \$1 and access_code_hash = \$2/i.test(sql)) {
    const r = db.staff_roles.find((x) => x.center_id === params[0] && x.access_code_hash === params[1]);
    return r ? lignes([{ ...r }]) : vide();
  }
  if (/from staff_roles where center_id = \$1 and id = \$2/i.test(sql) && /^select/i.test(sql)) {
    const r = db.staff_roles.find((x) => x.center_id === params[0] && x.id === params[1]);
    return r ? lignes([{ ...r }]) : vide();
  }
  if (/^select .* from staff_roles where center_id = \$1/i.test(sql)) return lignes(db.staff_roles.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })));
  if (/^select .* from staff_members where id = \$1/i.test(sql)) {
    const m = db.staff_members.find((x) => x.id === params[0]);
    return m ? lignes([{ ...m }]) : vide();
  }
  if (/^select .* from staff_members where center_id = \$1 and id = \$2/i.test(sql)) {
    const m = db.staff_members.find((x) => x.center_id === params[0] && x.id === params[1]);
    return m ? lignes([{ ...m }]) : vide();
  }
  if (/^select .* from staff_members where center_id = \$1/i.test(sql)) return lignes(db.staff_members.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })));
  if (/^select .* from staff_access_events where center_id = \$1/i.test(sql)) return lignes(db.staff_access_events.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })).reverse());
  if (/from staff_sessions s join staff_members m/i.test(sql)) {
    const s = db.staff_sessions.find((x) => x.token_hash === params[0] && Date.parse(x.expires_at) > Date.now());
    const m = s && db.staff_members.find((x) => x.id === s.member_id && x.status !== 'blocked');
    const r = m && roleDe(m);
    if (!r) return vide();
    return lignes([{
      token_hash: s.token_hash, center_id: s.center_id, expires_at: s.expires_at,
      member_id: m.id, member_name: m.name, contact: m.contact || '', member_status: m.status,
      role_id: m.role_id, role_name: r.name, role_code: r.code, permissions: r.permissions || [], locked: Boolean(r.locked),
    }]);
  }
  if (/^update staff_roles set (.*?) where center_id = \$1 and id = \$2/i.test(sql)) {
    const r = db.staff_roles.find((x) => x.center_id === params[0] && x.id === params[1]);
    if (!r) return vide();
    majDepuis(sql, params, r, /^update staff_roles set (.*?) where /i);
    return lignes([{ ...r }]);
  }
  if (/^update staff_members set status = \$2, last_seen = now\(\) where id = \$1/i.test(sql)) {
    const m = db.staff_members.find((x) => x.id === params[0]);
    if (!m) return vide();
    m.status = params[1];
    m.last_seen = tic();
    return lignes([{ ...m }]);
  }
  if (/^with touched_session as/i.test(sql)) {
    const m = db.staff_members.find((x) => x.id === params[1]);
    if (m) m.last_seen = tic();
    return vide();
  }
  if (/^delete from staff_sessions where expires_at <= now\(\)/i.test(sql)) {
    db.staff_sessions = db.staff_sessions.filter((x) => Date.parse(x.expires_at) > Date.now());
    return vide();
  }
  if (/^delete from staff_sessions where token_hash = \$1/i.test(sql)) {
    db.staff_sessions = db.staff_sessions.filter((x) => x.token_hash !== params[0]);
    return vide();
  }
  if (/from schema_migrations/i.test(sql)) return vide();
  // LES LECTURES DE L EQUIPE A PLUSIEURS CENTRES (2026-11-07) : les centres de
  // l entreprise, leurs roles, les lignes de leurs membres, et les autres lignes
  // d une meme personne (meme code). Lues DANS le SQL, comme le reste.
  const ids = (p) => (Array.isArray(p) ? p.map(String) : []);
  const partage = (m) => m.id === `${m.center_id}:role:${m.role_id}`;
  if (/^select id, name from centers where id = any\(\$1::text\[\]\)/i.test(sql)) {
    return lignes(db.centers.filter((c) => ids(params[0]).includes(c.id)).map((c) => ({ id: c.id, name: c.name || c.id })));
  }
  if (/^select center_id, id, name, locked, tone, permissions from staff_roles where center_id = any\(\$1::text\[\]\)/i.test(sql)) {
    return lignes(db.staff_roles.filter((r) => ids(params[0]).includes(r.center_id)).map((r) => ({ center_id: r.center_id, id: r.id, name: r.name, locked: Boolean(r.locked), tone: r.tone, permissions: r.permissions || [] })));
  }
  if (/^select id, center_id, role_id, status, last_seen, access_code_hash from staff_members where center_id = any\(\$1::text\[\]\)/i.test(sql)) {
    return lignes(db.staff_members.filter((m) => ids(params[0]).includes(m.center_id)).map((m) => ({ id: m.id, center_id: m.center_id, role_id: m.role_id, status: m.status, last_seen: m.last_seen || null, access_code_hash: m.access_code_hash })));
  }
  if (/^select distinct m\.center_id from staff_members s join staff_members m on m\.access_code_hash = s\.access_code_hash/i.test(sql)) {
    const s = db.staff_members.find((x) => x.id === params[0]);
    if (!s || partage(s)) return vide();
    return lignes([...new Set(db.staff_members.filter((x) => x.id !== s.id && x.access_code_hash === s.access_code_hash && x.status !== 'blocked' && !partage(x)).map((x) => x.center_id))].map((center_id) => ({ center_id })));
  }
  if (/^select m\.id as member_id, m\.name as member_name, m\.contact, m\.status as member_status, m\.role_id, r\.name as role_name/i.test(sql)) {
    const s = db.staff_members.find((x) => x.id === params[0]);
    if (!s || partage(s)) return vide();
    const m = db.staff_members.find((x) => x.center_id === params[1] && x.id !== s.id && x.access_code_hash === s.access_code_hash && x.status !== 'blocked' && !partage(x));
    const r = m && roleDe(m);
    if (!r) return vide();
    return lignes([{ member_id: m.id, member_name: m.name, contact: m.contact || '', member_status: m.status, role_id: m.role_id, role_name: r.name, role_code: r.code, permissions: r.permissions || [], locked: Boolean(r.locked) }]);
  }
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
// LES MUTATIONS : lib/staff-auth.js compile en memoire, assets/app-main.js servi
// en memoire. Le disque n est jamais ecrit.
// ---------------------------------------------------------------------------
const SERVEUR_AVANT = { fichier: 'lib/staff-auth.js', de: 'const resolvedCenterId = normalizeStaffCenterId(subject.member.center_id) || safeCenterId;', vers: 'const resolvedCenterId = safeCenterId;' };
const ECRAN_AVANT = { fichier: 'assets/app-main.js', de: '  // RANGER UNE SESSION NE CHANGE PAS LE CENTRE DE L ECRAN (2026-11-06). Seuls la', vers: "  state.adminCenterId = normalized.centerId || state.adminCenterId || 'libramont'; // RANGER UNE SESSION NE CHANGE PAS LE CENTRE DE L ECRAN (2026-11-06). Seuls la" };
function muter(texte, { de, vers }) {
  const t = lf(texte);
  if (t.split(de).length !== 2) throw new Error(`ancre absente ou multiple : ${de.slice(0, 70)}`);
  return t.split(de).join(vers);
}
let mutationServeur = null;
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  if (mutationServeur && path.resolve(nom) === STAFF_AUTH) return compileOrigine.call(this, muter(contenu, mutationServeur), nom);
  return compileOrigine.call(this, contenu, nom);
};
let handler = null;
function chargerServeur() {
  delete require.cache[require.resolve(STAFF_AUTH)];
  delete require.cache[require.resolve(API_STAFF_AUTH)];
  handler = require(API_STAFF_AUTH);
}

let ecranServi = null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const fiche = (c) => ({
  id: c.id, name: c.name, status: 'active', timezone: 'Europe/Brussels', clientId: 'fungalaxy',
  resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 }, laser: { weaponCount: c.id === 'gembloux' ? 20 : 30, parallelLaunches: 1 } },
  activityAvailability: { bowling: true, laser_game: true },
  defaultSchedule: { regular: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((j) => [j, { open: '10:00', close: '22:00' }])), holiday: {} },
});
// Tout le reste de l API repond sans rien faire : seule la connexion et l equipe sont jouees pour de vrai.
function doublure(u, rs) {
  const J = (p) => { rs.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); rs.end(JSON.stringify(p)); };
  const action = u.searchParams.get('action');
  if (u.pathname === '/api/ops' && (action === 'menuCenters' || action === 'centerConfig')) {
    return J({ ok: true, owner: true, centers: db.centers.slice(0, 2).map(fiche), activities: [{ id: 'bowling', label: 'Bowling' }, { id: 'laser_game', label: 'Laser Game' }] });
  }
  if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], durationOptions: [], center: null });
  return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], blocks: [], events: [], clients: [], suggestions: [], samples: [], centers: [], revision: 'equipe-centre' });
}
const serveur = http.createServer((rq, rs) => {
  const u = new URL(rq.url, BASE);
  if (u.pathname === '/api/staff-auth') {
    Promise.resolve(handler(rq, rs)).catch((e) => { if (!rs.headersSent) { rs.writeHead(500); rs.end(String(e && e.message)); } });
    return;
  }
  if (u.pathname.startsWith('/api/')) { doublure(u, rs); return; }
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); rs.end('absent'); return; }
  let contenu = fs.readFileSync(f);
  if (ecranServi && rel === ecranServi.fichier) contenu = muter(contenu.toString('utf8'), ecranServi);
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  rs.end(contenu);
});

// ---------------------------------------------------------------------------
// [S] LE SERVEUR, par de vraies requetes HTTP sur le vrai handler.
// ---------------------------------------------------------------------------
let nomCookie = '';
async function appel(corps, cookie = '') {
  const r = await fetch(`${BASE}/api/staff-auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corps) });
  const json = await r.json().catch(() => ({}));
  const pose = (r.headers.get('set-cookie') || '').split(';')[0];
  return { statut: r.status, json, cookie: pose && pose.startsWith(`${nomCookie}=`) && pose.length > nomCookie.length + 1 ? pose : '' };
}
const connecter = (centerId, code) => appel({ action: 'login', centerId, code });

async function preparerCodes() {
  const fondateur = await connecter('libramont', OWNER);
  ok(fondateur.statut === 200 && fondateur.json.session && fondateur.json.session.centerId === 'libramont' && Boolean(fondateur.cookie), 'montage : le code fondateur, tape a Libramont, ouvre Libramont', { statut: fondateur.statut, centre: fondateur.json.session && fondateur.json.session.centerId });
  const nouveau = async (corps) => (await appel(corps, fondateur.cookie)).json.newAccessCode || '';
  return {
    fondateur,
    roleGembloux: await nouveau({ action: 'regenerateRoleCode', centerId: 'gembloux', roleId: 'staff-bar' }),
    membreGembloux: await nouveau({ action: 'createMember', centerId: 'gembloux', name: 'Accueil Gembloux', contact: '', roleId: 'staff-bar' }),
    roleLibramont: await nouveau({ action: 'regenerateRoleCode', centerId: 'libramont', roleId: 'staff-bar' }),
  };
}

async function jouerServeur(codes) {
  const r = {
    roleGembloux: await connecter('libramont', codes.roleGembloux),
    membreGembloux: await connecter('libramont', codes.membreGembloux),
    roleLibramont: await connecter('gembloux', codes.roleLibramont),
    surPlace: await connecter('gembloux', codes.roleGembloux),
    inconnu: await connecter('gembloux', 'ST-0000-0000-0000-0000'),
  };
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { statut: v.statut, centre: v.json.session ? v.json.session.centerId : '', membre: v.json.session && v.json.session.member ? v.json.session.member.id : '', erreur: v.json.error || '' }]));
}
const REGLES_SERVEUR = {
  roleGembloux: (s) => s.roleGembloux.statut === 200 && s.roleGembloux.centre === 'gembloux' && s.roleGembloux.membre === 'gembloux:role:staff-bar',
  membreGembloux: (s) => s.membreGembloux.statut === 200 && s.membreGembloux.centre === 'gembloux' && s.membreGembloux.membre.startsWith('gembloux:'),
  roleLibramont: (s) => s.roleLibramont.statut === 200 && s.roleLibramont.centre === 'libramont' && s.roleLibramont.membre === 'libramont:role:staff-bar',
};
const LIBELLES_SERVEUR = {
  roleGembloux: 'un code de role ne a Gembloux, tape sur l ecran de Libramont, ouvre Gembloux',
  membreGembloux: 'un code de membre ne a Gembloux, tape sur l ecran de Libramont, ouvre Gembloux',
  roleLibramont: 'un code de role de Libramont, tape sur l ecran de Gembloux, ouvre Libramont',
};

// ---------------------------------------------------------------------------
// [E] L ECRAN, en vrais clics.
// ---------------------------------------------------------------------------
function espions() {
  window.__copies = [];
  window.__envois = [];
  const presse = { writeText: (t) => { window.__copies.push(String(t)); return Promise.resolve(); }, readText: () => Promise.resolve(window.__copies[window.__copies.length - 1] || '') };
  try { Object.defineProperty(navigator, 'clipboard', { value: presse, configurable: true }); } catch (e) { /* le test le verra */ }
  const nf = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const brut = typeof input === 'string' ? input : (input && input.url) || '';
    if (brut.includes('/api/staff-auth') && init && init.body) {
      try { const c = JSON.parse(init.body); window.__envois.push({ action: c.action, centre: c.centerId || '', role: c.roleId || '' }); } catch (e) { /* corps illisible */ }
    }
    return nf(input, init);
  };
}

const prete = (page) => page.waitForFunction(() => typeof window.renderStaffMenu === 'function' && typeof window.getCurrentStaffCenterId === 'function'
  && Boolean(state.staffAuthSession) && document.getElementById('authOverlay').classList.contains('hidden') && Boolean(document.querySelector('[data-fgx-center-menu]'))
  && !document.getElementById('staffConsoleLoadStatus'), null, { timeout: 30000 });
const centreAffiche = (page) => page.evaluate(() => ({
  ecran: getCurrentStaffCenterId(),
  session: state.staffAuthSession && state.staffAuthSession.centerId,
  membre: state.staffAuthSession && state.staffAuthSession.member && state.staffAuthSession.member.id,
  entete: (document.querySelector('[data-fgx-center-menu]') || {}).textContent ? document.querySelector('[data-fgx-center-menu]').textContent.replace(/\s+/g, ' ').trim() : '',
}));

async function seConnecter(page, code) {
  await page.locator('.entry-login').first().click();
  await page.locator('#authOverlay').waitFor({ state: 'visible' });
  await page.locator('#loginPass').fill(code);
  await page.locator('#authOverlay button[type="submit"]').click();
  await prete(page);
}
async function seDeconnecter(page) {
  await page.locator('[data-fgx-account-menu]').click();
  await page.locator('[data-fgx-menu-action="logout"]').click();
  await page.waitForFunction(() => !state.staffAuthSession, null, { timeout: 15000 });
  await page.goto(`${BASE}/?v=equipe-${Date.now()}`, { waitUntil: 'load' });
}
async function attendreCopie(page, avant) {
  await page.waitForFunction((n) => window.__copies.length > n, avant, { timeout: 15000 });
  return page.evaluate(() => window.__copies[window.__copies.length - 1]);
}
async function image(page, nom) {
  if (!IMAGES) return;
  fs.mkdirSync(IMAGES, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(IMAGES, `${nom}.png`) });
}

async function jouerEcran(browser, { prefixe, codeLibramont }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-BE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message)));
  try {
    await page.addInitScript(espions);
    await page.goto(`${BASE}/?v=equipe-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function');
    // Le fondateur tape son code a Libramont, comme Ansar a 12:42.
    await seConnecter(page, OWNER);
    const depart = await centreAffiche(page);
    // Gembloux dans le menu des centres : la page se recharge sur Gembloux.
    await page.evaluate(() => { window.__avantBascule = true; });
    await page.locator('[data-fgx-center-menu]').click();
    await page.locator('[data-fgx-center-option="gembloux"]').click();
    await page.waitForFunction(() => !window.__avantBascule && typeof window.getCurrentStaffCenterId === 'function' && getCurrentStaffCenterId() === 'gembloux' && Boolean(document.querySelector('[data-fgx-menu-key="users"]')), null, { timeout: 30000 });
    // (la page Equipe & acces du 2026-11-07 : onglet Roles, Staff bar, son code partage)
    await page.locator('[data-fgx-menu-key="users"]').first().click();
    await page.locator('[data-equipe-page]').waitFor({ state: 'visible' });
    await page.locator('[data-eq="onglet"][data-valeur="roles"]').click();
    await page.locator('.eq-rail-role', { hasText: 'Staff bar' }).first().click();
    await page.waitForFunction(() => /Staff bar/.test((document.querySelector('.eq-role-tete h3') || {}).textContent || ''));
    const bouton = (geste) => page.locator(`[data-eq="${geste}"][data-role="staff-bar"]`).first();
    let n = await page.evaluate(() => window.__copies.length);
    await bouton('copier-code-role').click();
    const premiereCopie = await attendreCopie(page, n);
    n += 1;
    await bouton('nouveau-code-role').click();
    const codeRegenere = await attendreCopie(page, n);
    n += 1;
    await page.waitForTimeout(300);
    await bouton('copier-code-role').click();
    const codeCopie = await attendreCopie(page, n);
    const apresGestes = await centreAffiche(page);
    const envois = await page.evaluate(() => window.__envois.slice());
    await image(page, `${prefixe}-1-equipe-gembloux`);
    // Deconnexion, puis le code copie tape dans la fenetre de connexion.
    await seDeconnecter(page);
    await seConnecter(page, codeCopie);
    const avecCodeCopie = await centreAffiche(page);
    await image(page, `${prefixe}-2-connexion-code-copie`);
    // Et un code de Libramont, tape depuis l ecran de Gembloux.
    await seDeconnecter(page);
    const ecranAvantLibramont = await page.evaluate(() => getCurrentStaffCenterId());
    await seConnecter(page, codeLibramont);
    const avecCodeLibramont = await centreAffiche(page);
    await image(page, `${prefixe}-3-connexion-code-libramont`);
    const revelations = envois.filter((e) => e.action === 'revealRoleCode');
    const regenerations = envois.filter((e) => e.action === 'regenerateRoleCode');
    return {
      depart, apresGestes, avecCodeCopie, avecCodeLibramont, ecranAvantLibramont, erreurs,
      revelations, regenerations,
      memeCode: codeCopie === codeRegenere,
      premierCopieGembloux: premiereCopie !== codeLibramont,
    };
  } finally {
    await ctx.close();
  }
}

const REGLES_ECRAN = {
  copierApresRegenerer: (e) => e.revelations.length === 2 && e.revelations[1].centre === 'gembloux' && e.revelations[1].role === 'staff-bar',
  ecranResteGembloux: (e) => e.apresGestes.ecran === 'gembloux' && /Gembloux/.test(e.apresGestes.entete),
  copieEstLeCodeRegenere: (e) => e.memeCode,
  codeGemblouxOuvreGembloux: (e) => e.avecCodeCopie.session === 'gembloux' && e.avecCodeCopie.ecran === 'gembloux' && /Gembloux/.test(e.avecCodeCopie.entete),
  codeLibramontOuvreLibramont: (e) => e.ecranAvantLibramont === 'gembloux' && e.avecCodeLibramont.session === 'libramont' && e.avecCodeLibramont.ecran === 'libramont' && /Libramont/.test(e.avecCodeLibramont.entete),
};
const LIBELLES_ECRAN = {
  copierApresRegenerer: 'Gembloux a l ecran : Regenerer puis Copier, la copie demande le code de Gembloux',
  ecranResteGembloux: 'apres ces gestes, la console travaille toujours sur Gembloux',
  copieEstLeCodeRegenere: 'le code copie est celui que Regenerer vient de creer',
  codeGemblouxOuvreGembloux: 'ce code, tape dans la fenetre de connexion, ouvre Gembloux',
  codeLibramontOuvreLibramont: 'un code de Libramont, tape depuis l ecran de Gembloux, ouvre Libramont',
};

async function main() {
  await new Promise((resoudre, rejeter) => { serveur.once('error', rejeter); serveur.listen(PORT, '127.0.0.1', resoudre); });
  let browser = null;
  try {
    chargerServeur();
    nomCookie = require(STAFF_AUTH).STAFF_SESSION_COOKIE;

    console.log('\n[S] le serveur : un code ouvre SON centre');
    const codes = await preparerCodes();
    ok(Object.values(codes).slice(1).every((c) => typeof c === 'string' && c.length >= 6) && new Set(Object.values(codes).slice(1)).size === 3, 'montage : trois codes neufs, rendus par Regenerer et Nouveau membre');
    const s = await jouerServeur(codes);
    for (const [cle, regle] of Object.entries(REGLES_SERVEUR)) ok(regle(s), LIBELLES_SERVEUR[cle], s[cle]);
    ok(s.surPlace.statut === 200 && s.surPlace.centre === 'gembloux', 'contraste : le meme code, tape sur l ecran de Gembloux, ouvre Gembloux', s.surPlace);
    ok(s.inconnu.statut >= 400 && !s.inconnu.centre, 'contraste : un code inconnu est refuse', s.inconnu);
    const traces = db.audit_log.filter((x) => x.action === 'regenerateRoleCode').map((x) => x.center_id);
    ok(traces.join(',') === 'gembloux,libramont', 'le journal d audit dit le centre de chaque Regenerer, comme en prod', traces);

    console.log('\n[E] l ecran Equipe & acces, en vrais clics');
    const { chromium } = require(require.resolve('playwright-core', { paths: [ROOT] }));
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    const e = await jouerEcran(browser, { prefixe: 'apres', codeLibramont: codes.roleLibramont });
    ok(e.depart.session === 'libramont' && e.depart.ecran === 'libramont' && e.depart.membre === 'libramont:platform-owner', 'montage : la vraie fenetre de connexion ouvre la session du fondateur a Libramont', e.depart);
    ok(e.regenerations.length === 1 && e.regenerations[0].centre === 'gembloux' && e.revelations.length === 2 && e.revelations[0].centre === 'gembloux', 'montage : Copier puis Regenerer partent bien a Gembloux, l ecran affiche', { regen: e.regenerations, rev: e.revelations });
    ok(e.premierCopieGembloux, 'montage : la premiere copie n est pas le code de Libramont');
    for (const [cle, regle] of Object.entries(REGLES_ECRAN)) ok(regle(e), LIBELLES_ECRAN[cle], { apres: e.apresGestes, copie: e.avecCodeCopie, libramont: e.avecCodeLibramont, rev: e.revelations });
    ok(e.erreurs.length === 0, 'aucune erreur JavaScript dans la console', e.erreurs.slice(0, 3));

    console.log('\n[C] les contre-preuves');
    ecranServi = ECRAN_AVANT;
    const avant = await jouerEcran(browser, { prefixe: 'avant', codeLibramont: codes.roleLibramont });
    ecranServi = null;
    const rougesEcran = Object.keys(REGLES_ECRAN).filter((cle) => !REGLES_ECRAN[cle](avant));
    ok(['copierApresRegenerer', 'ecranResteGembloux', 'codeGemblouxOuvreGembloux'].every((cle) => rougesEcran.includes(cle)), 'l ancienne ligne de storeStaffAuthSession : Copier vise Libramont et le code ouvre Libramont, [E] ROUGE', { rouges: rougesEcran, copie: avant.avecCodeCopie, rev: avant.revelations });
    mutationServeur = SERVEUR_AVANT;
    chargerServeur();
    const sAvant = await jouerServeur(await preparerCodes());
    mutationServeur = null;
    chargerServeur();
    const rougesServeur = Object.keys(REGLES_SERVEUR).filter((cle) => !REGLES_SERVEUR[cle](sAvant));
    ok(rougesServeur.length === 3, 'une session qui prend le centre de l ecran au lieu de celui du code : [S] ROUGE', { rouges: rougesServeur, roleGembloux: sAvant.roleGembloux });
    const sRevenu = await jouerServeur(await preparerCodes());
    ok(Object.values(REGLES_SERVEUR).every((regle) => regle(sRevenu)), 'le vrai fichier recharge, [S] redevient vert');
  } finally {
    if (browser) await browser.close().catch(() => {});
    serveur.close();
  }
  const uniques = [...new Set(NON_COUVERTES)];
  ok(uniques.length === 0, `aucune requete SQL non couverte par le gate (${uniques.length})`, uniques.slice(0, 4));
  console.log(echecs ? `\nequipe-centre-check : ${echecs} echec(s)` : '\nequipe-centre-check : vert');
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => { console.error(erreur && erreur.stack ? erreur.stack : erreur); process.exit(1); });
