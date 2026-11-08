'use strict';
// EQUIPE & ACCES : CE QUI N EST PAS PERMIS NE SE VOIT PAS, ET LE SERVEUR LE REFUSE (2026-11-07).
//
// Ansar : « si il a pas accès il peut pas voir sans que ça bug ». L equipe de Fun Galaxy : deux
// personnes en Direction a Libramont et a Gembloux, un Manager aux deux, une Assistant manager a
// Libramont seulement, un Staff bar par centre (Ciney n est pas construit).
//
//   [S] le serveur de l equipe (le vrai lib/staff-auth.js derriere le vrai api/staff-auth.js, sur
//       une base en memoire qui obeit au SQL) : chacun entre dans SES centres et pas dans les
//       autres ; sans « Équipe & accès », aucun geste d equipe ; la Direction ne se donne que par la
//       Direction ou la plateforme, et ne se renomme que par la plateforme ; on n ajoute personne
//       dans un centre qu on ne gere pas ; la connexion ne livre plus l equipe a qui ne la gere pas.
//   [T] la table des droits de api/ops.js : les ecritures (note client, formulaire du site, mails,
//       reglages du centre) demandent le droit d ecrire, la lecture ne suffit plus.
//   [P] le vrai api/staff-reservations.js, sa base remplacee par une sonde qui repond 418 : un 403
//       est un refus de droit, un 418 un geste passe. Glisser passe avec « Déplacer » ; un jour passe
//       ne se corrige, ne se deplace ni ne se supprime qu avec « Changer un jour passé » ; l accueil
//       (l etat) reste ouvert a qui le porte.
//   [E] l ecran, la vraie console, un role apres l autre : chacun ne voit que ses gestes (la Staff
//       bar ne glisse pas et n a pas la roue des pistes ; Technique glisse sans reserver ; le Manager
//       n exporte pas ; l Assistant manager n a que Libramont dans le menu des centres ; sans
//       « Équipe & accès », ni l entree ni la page).
//   [M] les montants a l ecran (passe securite du 2026-11-08) : le vrai filtre du serveur retire
//       les montants d un role sans « Voir les montants », et la console dit « ··· », jamais un
//       faux « 0 € » ni « Prix sur place » ; sa fiche de modification n a pas de champ de prix.
//   [C] les contre-preuves, compilees en memoire (le disque n est jamais ecrit) : « deplacer »
//       toujours vrai fait rougir [E] ; sans la garde du jour passe, [P] rougit ; sans la garde du
//       role Direction, [S] rougit.
//
// Rien ne part : ni base, ni reseau, ni mail, et aucun code n est jamais ecrit dans la sortie.
// Lancement : node scripts/equipe-acces-check.js [--sans-ecran]
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_INSECURE_STAFF_CODES;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-equipe-acces-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-ACCES-2026';

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const STAFF_AUTH = path.join(ROOT, 'lib', 'staff-auth.js');
const API_STAFF_AUTH = path.join(ROOT, 'api', 'staff-auth.js');
const MONTANTS_ROLE = path.join(ROOT, 'lib', 'montants-role.js');
const API_RESERVATIONS = path.join(ROOT, 'api', 'staff-reservations.js');
const PORT = Number(process.env.PINLANE_EQUIPE_ACCES_PORT || 5323);
const BASE = `http://127.0.0.1:${PORT}`;
const BASE_SONDE = `http://127.0.0.1:${PORT + 1}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OWNER = process.env.PLATFORM_OWNER_CODE;
const SANS_ECRAN = process.argv.includes('--sans-ecran');
const lf = (t) => String(t).split('\r\n').join('\n');
const jourDe = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(instant));
const AUJOURDHUI = jourDe(Date.now());
const HIER = jourDe(Date.now() - 86400000);

let echecs = 0;
function ok(condition, message, detail) {
  if (condition) { console.log(`ok    ${message}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`}`);
  return false;
}

// Un module compile en memoire avec une mutation : ses require relatifs restent ceux du depot.
function compilerMute(fichier, avant, apres) {
  const source = lf(fs.readFileSync(fichier, 'utf8'));
  if (!source.includes(avant)) throw new Error(`contre-preuve sans ancre dans ${path.relative(ROOT, fichier)} : ${avant.slice(0, 80)}`);
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  m._compile(source.replace(avant, apres), fichier);
  return m.exports;
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
// LES REQUETES DE L EQUIPE A PLUSIEURS CENTRES (2026-11-07) : la meme personne
// dans deux centres (meme code), son nom, son blocage, son nouveau code, ses
// centres. Lues DANS le SQL, comme le reste du moteur.
// ---------------------------------------------------------------------------
const estPartage = (m) => m.id === `${m.center_id}:role:${m.role_id}`;
const ids = (p) => (Array.isArray(p) ? p.map(String) : []);
function requeteEquipe(sql, params) {
  if (/^select m\.id as member_id, m\.name as member_name, m\.contact, m\.status as member_status, m\.role_id, r\.name as role_name, r\.code as role_code, r\.permissions, r\.locked from staff_members s join staff_members m on m\.access_code_hash = s\.access_code_hash and m\.center_id = \$2 and m\.id <> s\.id join staff_roles r on r\.center_id = m\.center_id and r\.id = m\.role_id where s\.id = \$1 and m\.status <> 'blocked' and s\.id <> \(s\.center_id \|\| ':role:' \|\| s\.role_id\) and m\.id <> \(m\.center_id \|\| ':role:' \|\| m\.role_id\) limit 1;?$/i.test(sql)) {
    const s = db.staff_members.find((x) => x.id === params[0]);
    if (!s || estPartage(s)) return vide();
    const m = db.staff_members.find((x) => x.center_id === params[1] && x.id !== s.id && x.access_code_hash === s.access_code_hash && x.status !== 'blocked' && !estPartage(x));
    const r = m && roleDe(m);
    if (!r) return vide();
    return lignes([{ member_id: m.id, member_name: m.name, contact: m.contact || '', member_status: m.status, role_id: m.role_id, role_name: r.name, role_code: r.code, permissions: r.permissions || [], locked: Boolean(r.locked) }]);
  }
  if (/^select distinct m\.center_id from staff_members s join staff_members m on m\.access_code_hash = s\.access_code_hash and m\.id <> s\.id where s\.id = \$1 and m\.status <> 'blocked' and s\.id <> \(s\.center_id \|\| ':role:' \|\| s\.role_id\) and m\.id <> \(m\.center_id \|\| ':role:' \|\| m\.role_id\);?$/i.test(sql)) {
    const s = db.staff_members.find((x) => x.id === params[0]);
    if (!s || estPartage(s)) return vide();
    const centres = [...new Set(db.staff_members.filter((x) => x.id !== s.id && x.access_code_hash === s.access_code_hash && x.status !== 'blocked' && !estPartage(x)).map((x) => x.center_id))];
    return lignes(centres.map((center_id) => ({ center_id })));
  }
  if (/^select id, center_id, role_id, status, last_seen, access_code_hash from staff_members where center_id = any\(\$1::text\[\]\);?$/i.test(sql)) {
    return lignes(db.staff_members.filter((x) => ids(params[0]).includes(x.center_id)).map((x) => ({ id: x.id, center_id: x.center_id, role_id: x.role_id, status: x.status, last_seen: x.last_seen || null, access_code_hash: x.access_code_hash })));
  }
  if (/^select id, name from centers where id = any\(\$1::text\[\]\);?$/i.test(sql)) {
    return lignes(db.centers.filter((c) => ids(params[0]).includes(c.id)).map((c) => ({ id: c.id, name: c.name })));
  }
  if (/^select name from centers where id = \$1 limit 1;?$/i.test(sql)) {
    const c = db.centers.find((x) => x.id === params[0]);
    return c ? lignes([{ name: c.name }]) : vide();
  }
  if (/^select center_id, id, name, locked, tone, permissions from staff_roles where center_id = any\(\$1::text\[\]\)/i.test(sql)) {
    return lignes(db.staff_roles.filter((r) => ids(params[0]).includes(r.center_id)).map((r) => ({ center_id: r.center_id, id: r.id, name: r.name, locked: Boolean(r.locked), tone: r.tone, permissions: r.permissions || [] })));
  }
  if (/^select \* from staff_members where access_code_hash = \$1 and id <> \$2;?$/i.test(sql)) {
    return lignes(db.staff_members.filter((x) => x.access_code_hash === params[0] && x.id !== params[1]).map((x) => ({ ...x })));
  }
  if (/^select count\(\*\)::int as n from staff_members m join staff_roles r on r\.center_id = m\.center_id and r\.id = m\.role_id where m\.center_id = \$1 and m\.status = 'active' and r\.locked = true;?$/i.test(sql)) {
    return lignes([{ n: db.staff_members.filter((m) => m.center_id === params[0] && m.status === 'active' && (roleDe(m) || {}).locked).length }]);
  }
  if (/^update staff_members set name = \$2 where id = any\(\$1::text\[\]\) returning \*;?$/i.test(sql)) {
    const touches = db.staff_members.filter((x) => ids(params[0]).includes(x.id));
    touches.forEach((x) => { x.name = params[1]; x.updated_at = tic(); });
    return lignes(touches.map((x) => ({ ...x })));
  }
  if (/^update staff_members set status = 'blocked' where id = any\(\$1::text\[\]\) returning \*;?$/i.test(sql)) {
    const touches = db.staff_members.filter((x) => ids(params[0]).includes(x.id));
    touches.forEach((x) => { x.status = 'blocked'; });
    return lignes(touches.map((x) => ({ ...x })));
  }
  if (/^update staff_members set status = case when last_seen is null then 'pending' else 'active' end where id = any\(\$1::text\[\]\) returning \*;?$/i.test(sql)) {
    const touches = db.staff_members.filter((x) => ids(params[0]).includes(x.id));
    touches.forEach((x) => { x.status = x.last_seen ? 'active' : 'pending'; });
    return lignes(touches.map((x) => ({ ...x })));
  }
  if (/^update staff_members set access_code_hash = \$2, access_code_hint = \$3, access_code_enc = \$4 where id = any\(\$1::text\[\]\);?$/i.test(sql)) {
    const touches = db.staff_members.filter((x) => ids(params[0]).includes(x.id));
    touches.forEach((x) => { x.access_code_hash = params[1]; x.access_code_hint = params[2]; x.access_code_enc = params[3]; });
    return lignes(touches.map((x) => ({ ...x })));
  }
  if (/^update staff_members set role_id = \$3 where center_id = \$1 and id = \$2( returning \*)?;?$/i.test(sql)) {
    const m = db.staff_members.find((x) => x.center_id === params[0] && x.id === params[1]);
    if (!m) return vide();
    m.role_id = params[2];
    return lignes([{ ...m }]);
  }
  if (/^delete from staff_sessions where member_id = any\(\$1::text\[\]\);?$/i.test(sql)) {
    db.staff_sessions = db.staff_sessions.filter((x) => !ids(params[0]).includes(x.member_id));
    return vide();
  }
  if (/^delete from staff_sessions where member_id = \$1;?$/i.test(sql)) {
    db.staff_sessions = db.staff_sessions.filter((x) => x.member_id !== params[0]);
    return vide();
  }
  if (/^delete from staff_members where center_id = \$1 and id = \$2( returning \*)?;?$/i.test(sql)) {
    const avant = db.staff_members.filter((x) => x.center_id === params[0] && x.id === params[1]);
    db.staff_members = db.staff_members.filter((x) => !(x.center_id === params[0] && x.id === params[1]));
    return lignes(avant.map((x) => ({ ...x })));
  }
  if (/^delete from staff_members where id = any\(\$1::text\[\]\) returning \*;?$/i.test(sql)) {
    const avant = db.staff_members.filter((x) => ids(params[0]).includes(x.id));
    db.staff_members = db.staff_members.filter((x) => !ids(params[0]).includes(x.id));
    return lignes(avant.map((x) => ({ ...x })));
  }
  return null;
}
const requeteOrigine = requete;
// eslint-disable-next-line no-func-assign
requete = async function requeteEtendue(texte, params = []) {
  const reponse = requeteEquipe(sqlPlat(texte), params);
  return reponse || requeteOrigine(texte, params);
};

// ---------------------------------------------------------------------------
// LE SERVEUR : la connexion et l equipe pour de vrai ; le reste repond a vide,
// sauf le jour du planning, qui porte une reservation a glisser.
// ---------------------------------------------------------------------------
let handler = null;
function chargerServeur() { handler = require(API_STAFF_AUTH); }
function chargerServeurMute(avant, apres) { handler = compilerMute(API_STAFF_AUTH, avant, apres); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const fiche = (c) => ({
  id: c.id, name: c.name, status: 'active', timezone: 'Europe/Brussels', clientId: 'fungalaxy',
  resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 }, laser: { weaponCount: 30, parallelLaunches: 1 } },
  activityAvailability: { bowling: true, laser_game: true },
  defaultSchedule: { regular: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((j) => [j, { open: '10:00', close: '22:00' }])), holiday: {} },
});
// La reservation du jour, sur la piste 3 de Libramont : ce que chaque role glisse ou non.
const RESAS = [{
  id: 9201, centerId: 'libramont', date: AUJOURDHUI, startTime: '15:00', duration: 1, type: 'bowling', lanes: [3], pax: 6,
  name: 'Groupe Martin', phone: '', status: 'confirmed', price: 60, basePrice: 60, extras: [{ name: 'Boisson', price: 12 }], updatedAt: '2026-11-07T09:00:00.000Z',
  opsPlan: { resourceBlocks: [{ resourceType: 'bowling_lane', activityId: 'bowling', startTime: '15:00', endTime: '16:00', lanes: [3], players: 6 }] },
}];
async function doublure(u, rs, rq) {
  const J = (p) => { rs.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); rs.end(JSON.stringify(p)); };
  const action = u.searchParams.get('action');
  if (u.pathname === '/api/ops' && (action === 'menuCenters' || action === 'centerConfig')) {
    return J({ ok: true, owner: true, centers: db.centers.map(fiche), activities: [{ id: 'bowling', label: 'Bowling' }, { id: 'laser_game', label: 'Laser Game' }] });
  }
  if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], durationOptions: [], center: null });
  const centre = u.searchParams.get('centerId') || 'libramont';
  const reservations = u.pathname === '/api/staff-state' ? RESAS.filter((r) => r.centerId === centre) : [];
  const jour = { ok: true, reservations, laneStatuses: {}, communications: [], blocks: [], events: [], clients: [], suggestions: [], samples: [], centers: [], revision: 'gate' };
  // Le vrai filtre du serveur (lib/montants-role.js) : la vraie session decide.
  if (u.pathname === '/api/staff-state') {
    const { getStaffSessionFromRequest, sessionHasPermission } = require(STAFF_AUTH);
    const session = await getStaffSessionFromRequest(rq);
    if (session && !sessionHasPermission(session, 'payments.view')) return J(require(MONTANTS_ROLE).sansMontants(jour));
  }
  return J(jour);
}
let MUTATION_ECRAN = null;
const serveur = http.createServer((rq, rs) => {
  const u = new URL(rq.url, BASE);
  if (u.pathname === '/api/staff-auth') {
    Promise.resolve(handler(rq, rs)).catch((e) => { if (!rs.headersSent) { rs.writeHead(500); rs.end(String(e && e.message)); } });
    return;
  }
  if (u.pathname.startsWith('/api/')) { doublure(u, rs, rq).catch((e) => { if (!rs.headersSent) { rs.writeHead(500); rs.end(String(e && e.message)); } }); return; }
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); rs.end('absent'); return; }
  let corps = fs.readFileSync(f);
  if (MUTATION_ECRAN && rel === 'assets/app-main.js') {
    const texte = lf(corps.toString('utf8'));
    if (!texte.includes(MUTATION_ECRAN[0])) { rs.writeHead(500); rs.end('ancre absente'); return; }
    corps = Buffer.from(texte.replace(MUTATION_ECRAN[0], MUTATION_ECRAN[1]), 'utf8');
  }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  rs.end(corps);
});

let nomCookie = '';
async function appel(corps, cookie = '') {
  const r = await fetch(`${BASE}/api/staff-auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corps) });
  const json = await r.json().catch(() => ({}));
  const pose = (r.headers.get('set-cookie') || '').split(';')[0];
  return { statut: r.status, json, cookie: pose && pose.startsWith(`${nomCookie}=`) && pose.length > nomCookie.length + 1 ? pose : '' };
}
async function lire(centre, cookie) {
  const r = await fetch(`${BASE}/api/staff-auth?centerId=${encodeURIComponent(centre)}`, { headers: cookie ? { cookie } : {} });
  return { statut: r.status, json: await r.json().catch(() => ({})) };
}
const message = (rep) => String((rep.json && (rep.json.error || rep.json.message)) || '');

// ---------------------------------------------------------------------------
// L EQUIPE, posee par la plateforme comme Ansar la decrit. Des noms neutres :
// les vrais noms ne vont pas dans le depot.
// ---------------------------------------------------------------------------
const EQUIPE = [
  ['libramont', 'Directrice', 'directrice@exemple.be', 'direction', ['gembloux']],
  ['libramont', 'Directeur', 'directeur@exemple.be', 'direction', ['gembloux']],
  ['libramont', 'Gérant', 'gerant@exemple.be', 'manager', ['gembloux']],
  ['libramont', 'Assistante', 'assistante@exemple.be', 'assistant-manager', []],
  ['libramont', 'Staff bar', 'Tablette du bar', 'staff-bar', []],
  ['gembloux', 'Staff bar', 'Tablette du bar', 'staff-bar', []],
  ['libramont', 'Technique', 'Poste atelier', 'technique', []],
];
const codes = {};
const cookies = {};
let proprio = '';
let chefRoleId = '';
async function poserEquipe() {
  const fondateur = await appel({ action: 'login', centerId: 'libramont', code: OWNER });
  ok(fondateur.statut === 200 && Boolean(fondateur.cookie), 'montage : le code de la plateforme ouvre la console', { statut: fondateur.statut, erreur: message(fondateur) });
  proprio = fondateur.cookie;
  for (const [centre, nom, contact, roleId, autresCentres] of EQUIPE) {
    const rep = await appel({ action: 'createMember', centerId: centre, name: nom, contact, roleId, autresCentres }, proprio);
    ok(rep.statut === 200 && Boolean(rep.json.newAccessCode), `montage : ${nom} (${roleId}) a ${[centre, ...autresCentres].join(' et ')}`, { statut: rep.statut, erreur: message(rep) });
    codes[`${centre}:${nom}`] = rep.json.newAccessCode;
  }
  // Un role fait main qui gere l equipe sans etre la Direction.
  const chef = await appel({ action: 'createRole', centerId: 'libramont', name: 'Chef d’équipe', permissions: ['dashboard.view', 'planning.view', 'reservations.view', 'users.manage'] }, proprio);
  chefRoleId = String((chef.json.createdRole && chef.json.createdRole.id) || '');
  ok(chef.statut === 200 && Boolean(chefRoleId), 'montage : le role « Chef d’équipe » (gere l equipe, pas la Direction)', { statut: chef.statut, erreur: message(chef) });
  const membre = await appel({ action: 'createMember', centerId: 'libramont', name: 'Chef', contact: '', roleId: chefRoleId }, proprio);
  ok(membre.statut === 200 && Boolean(membre.json.newAccessCode), 'montage : une personne avec ce role', { statut: membre.statut, erreur: message(membre) });
  codes['libramont:Chef'] = membre.json.newAccessCode;
  // Un role fait main : il corrige les dossiers sans voir les montants.
  const correcteur = await appel({ action: 'createRole', centerId: 'libramont', name: 'Correcteur', permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'reservations.view', 'reservations.edit'] }, proprio);
  const correcteurId = String((correcteur.json.createdRole && correcteur.json.createdRole.id) || '');
  ok(correcteur.statut === 200 && Boolean(correcteurId), 'montage : le role « Correcteur » (modifie, sans voir les montants)', { statut: correcteur.statut, erreur: message(correcteur) });
  const unCorrecteur = await appel({ action: 'createMember', centerId: 'libramont', name: 'Correcteur', contact: '', roleId: correcteurId }, proprio);
  ok(unCorrecteur.statut === 200 && Boolean(unCorrecteur.json.newAccessCode), 'montage : une personne avec ce role', { statut: unCorrecteur.statut, erreur: message(unCorrecteur) });
  codes['libramont:Correcteur'] = unCorrecteur.json.newAccessCode;
  for (const cle of Object.keys(codes)) {
    const [centre] = cle.split(':');
    const rep = await appel({ action: 'login', centerId: centre, code: codes[cle] });
    cookies[cle] = rep.cookie;
    ok(rep.statut === 200 && Boolean(rep.cookie), `montage : ${cle.replace(':', ', ')} entre avec son code`, { statut: rep.statut, erreur: message(rep) });
  }
}
async function membreId(centre, nom) {
  const rep = await lire(centre, proprio);
  const m = ((rep.json.accessControl && rep.json.accessControl.members) || []).find((x) => x.name === nom && !String(x.id).includes(':role:'));
  return m ? m.id : '';
}

// ---------------------------------------------------------------------------
// [S] LE SERVEUR DE L EQUIPE
// ---------------------------------------------------------------------------
async function verifierEquipe() {
  const roleA = (rep) => String((rep.json.session && rep.json.session.role && rep.json.session.role.name) || '');
  const dirG = await lire('gembloux', cookies['libramont:Directrice']);
  ok(dirG.statut === 200 && roleA(dirG) === 'Direction', '[S] la Directrice entre a Gembloux en Direction', { statut: dirG.statut, role: roleA(dirG) });
  const gerG = await lire('gembloux', cookies['libramont:Gérant']);
  ok(gerG.statut === 200 && roleA(gerG) === 'Manager', '[S] le Gerant entre a Gembloux en Manager', { statut: gerG.statut, role: roleA(gerG) });
  const gerC = await lire('ciney', cookies['libramont:Gérant']);
  ok(gerC.statut === 403, '[S] le Gerant n entre pas a Ciney (aucun acces la-bas)', { statut: gerC.statut });
  const assG = await lire('gembloux', cookies['libramont:Assistante']);
  ok(assG.statut === 403, '[S] l Assistante n entre pas a Gembloux', { statut: assG.statut });
  const assL = await lire('libramont', cookies['libramont:Assistante']);
  const centresAss = (assL.json.session && assL.json.session.centres) || null;
  ok(assL.statut === 200 && roleA(assL) === 'Assistant manager' && Array.isArray(centresAss) && centresAss.join(',') === 'libramont', '[S] l Assistante entre a Libramont, son seul centre', { statut: assL.statut, role: roleA(assL), centres: centresAss });

  const bar = await appel({ action: 'login', centerId: 'libramont', code: codes['libramont:Staff bar'] });
  ok(bar.statut === 200 && !bar.json.accessControl, '[S] la connexion de la Staff bar ne livre pas la liste de l equipe', { statut: bar.statut, equipe: Boolean(bar.json.accessControl) });
  const barCree = await appel({ action: 'createMember', centerId: 'libramont', name: 'Intrus', contact: '', roleId: 'staff-bar' }, cookies['libramont:Staff bar']);
  ok(barCree.statut === 403, '[S] la Staff bar ne cree personne', { statut: barCree.statut });
  const gerCree = await appel({ action: 'createMember', centerId: 'libramont', name: 'Intrus', contact: '', roleId: 'staff-bar' }, cookies['libramont:Gérant']);
  ok(gerCree.statut === 403, '[S] le Manager ne cree personne (pas « Équipe & accès »)', { statut: gerCree.statut });

  const chefDir = await appel({ action: 'createMember', centerId: 'libramont', name: 'Intrus', contact: '', roleId: 'direction' }, cookies['libramont:Chef']);
  ok(chefDir.statut === 403 && /direction/i.test(message(chefDir)), '[S] un role qui gere l equipe sans etre la Direction ne donne pas la Direction', { statut: chefDir.statut, message: message(chefDir) });
  const idBar = await membreId('libramont', 'Staff bar');
  const chefMonte = await appel({ action: 'updateMemberRole', centerId: 'libramont', memberId: idBar, roleId: 'direction' }, cookies['libramont:Chef']);
  ok(chefMonte.statut === 403, '[S] ... ni en changeant le role d une personne', { statut: chefMonte.statut });
  const chefCree = await appel({ action: 'createMember', centerId: 'libramont', name: 'Renfort', contact: '', roleId: 'staff-bar' }, cookies['libramont:Chef']);
  ok(chefCree.statut === 200, '[S] ... mais il ajoute une Staff bar : la garde ne vise que la Direction', { statut: chefCree.statut, message: message(chefCree) });
  const chefAilleurs = await appel({ action: 'setMemberCenter', centerId: 'libramont', memberId: idBar, cibleCenterId: 'gembloux', roleId: 'staff-bar' }, cookies['libramont:Chef']);
  ok(chefAilleurs.statut === 403, '[S] il n ajoute personne a Gembloux, un centre qu il ne gere pas', { statut: chefAilleurs.statut });

  const dirRenomme = await appel({ action: 'renameRole', centerId: 'libramont', roleId: 'direction', name: 'Direction générale' }, cookies['libramont:Directrice']);
  ok(dirRenomme.statut === 403, '[S] la Direction ne renomme pas son propre role', { statut: dirRenomme.statut });
  const proRenomme = await appel({ action: 'renameRole', centerId: 'libramont', roleId: 'direction', name: 'Direction générale' }, proprio);
  const proRetour = await appel({ action: 'renameRole', centerId: 'libramont', roleId: 'direction', name: 'Direction' }, proprio);
  ok(proRenomme.statut === 200 && proRetour.statut === 200, '[S] la plateforme renomme le role Direction (et le remet)', { aller: proRenomme.statut, retour: proRetour.statut, message: message(proRenomme) });

  const idAss = await membreId('libramont', 'Assistante');
  const ajout = await appel({ action: 'setMemberCenter', centerId: 'libramont', memberId: idAss, cibleCenterId: 'gembloux', roleId: 'staff-bar' }, proprio);
  const assG2 = await lire('gembloux', cookies['libramont:Assistante']);
  ok(ajout.statut === 200 && assG2.statut === 200 && roleA(assG2) === 'Staff bar', '[S] la plateforme donne Gembloux a l Assistante, en Staff bar la-bas', { ajout: ajout.statut, lecture: assG2.statut, role: roleA(assG2) });
  const retrait = await appel({ action: 'setMemberCenter', centerId: 'libramont', memberId: idAss, cibleCenterId: 'gembloux', roleId: '' }, proprio);
  const assG3 = await lire('gembloux', cookies['libramont:Assistante']);
  ok(retrait.statut === 200 && assG3.statut === 403, '[S] ... et le lui retire : elle n y entre plus', { retrait: retrait.statut, lecture: assG3.statut });

  const idGer = await membreId('libramont', 'Gérant');
  const bloque = await appel({ action: 'setMemberBlocked', centerId: 'libramont', memberId: idGer, bloque: true }, proprio);
  const gerApres = await lire('libramont', cookies['libramont:Gérant']);
  const gerCode = await appel({ action: 'login', centerId: 'gembloux', code: codes['libramont:Gérant'] });
  ok(bloque.statut === 200 && gerApres.json.authenticated === false && gerCode.statut !== 200, '[S] bloque, le Gerant perd sa session et son code n ouvre plus aucun centre', { bloque: bloque.statut, session: gerApres.json.authenticated, code: gerCode.statut });
  const debloque = await appel({ action: 'setMemberBlocked', centerId: 'libramont', memberId: idGer, bloque: false }, proprio);
  const gerRevient = await appel({ action: 'login', centerId: 'libramont', code: codes['libramont:Gérant'] });
  cookies['libramont:Gérant'] = gerRevient.cookie;
  ok(debloque.statut === 200 && gerRevient.statut === 200, '[S] debloque, son code le fait entrer de nouveau', { debloque: debloque.statut, code: gerRevient.statut });

  const idDir = await membreId('libramont', 'Directrice');
  const soiMeme = await appel({ action: 'setMemberBlocked', centerId: 'libramont', memberId: idDir, bloque: true }, cookies['libramont:Directrice']);
  ok(soiMeme.statut >= 400 && soiMeme.statut < 500, '[S] personne ne se bloque soi-meme', { statut: soiMeme.statut });
}

// ---------------------------------------------------------------------------
// [T] LA TABLE DES DROITS DE api/ops.js
// ---------------------------------------------------------------------------
function verifierTable() {
  const { getRequiredOpsPermission: droit } = require(path.join(ROOT, 'api', 'ops.js'));
  const liste = (v) => (Array.isArray(v) ? v : [v]);
  const seul = (methode, action, attendu) => ok(JSON.stringify(liste(droit(methode, action))) === JSON.stringify([attendu]), `[T] ${methode} ${action} demande ${attendu}`, droit(methode, action));
  seul('POST', 'clientNotes', 'clients.edit');
  seul('GET', 'clientNotes', 'clients.view');
  seul('POST', 'setEmbedState', 'settings.manage');
  seul('POST', 'saveEmailTemplate', 'campaigns.manage');
  seul('POST', 'archiveEmailTemplate', 'campaigns.manage');
  seul('POST', 'saveEmailIdentity', 'settings.manage');
  seul('POST', 'deleteEmailIdentity', 'settings.manage');
  seul('POST', 'teachAgentFact', 'emails.send');
  seul('POST', 'saveCenterConfig', 'settings.manage');
  seul('POST', 'saveCenter', 'settings.manage');
  seul('POST', 'setCenterStatus', 'settings.manage');
  for (const action of ['automationSettings', 'emailDesign', 'customSequences', 'emailBrain']) {
    const lu = liste(droit('POST', action));
    ok(!lu.includes('direction.view') && lu.includes('emails.send'), `[T] POST ${action} : un droit d ecriture, plus « Direction »`, lu);
  }
  for (const action of ['customRequestStatus', 'customRequestNote']) {
    const lu = liste(droit('POST', action));
    ok(!lu.includes('dashboard.view') && lu.includes('clients.view'), `[T] POST ${action} : la page des demandes, plus la Vue d ensemble`, lu);
  }
  const config = liste(droit('GET', 'centerConfig'));
  ok(config.includes('settings.manage') && !config.includes('ai.ops'), '[T] GET centerConfig suit son handler, sans ai.ops', config);
}

// ---------------------------------------------------------------------------
// [P] LE VRAI api/staff-reservations.js, SA BASE REMPLACEE PAR UNE SONDE. Un
// 403 est le refus de droit ; un 418 dit que le geste a passe les gardes et
// touche la base (qui ne repond pas).
// ---------------------------------------------------------------------------
const PROBE = new Map([
  [9101, { id: 9101, centerId: 'libramont', date: AUJOURDHUI, status: 'confirmed', name: 'Sonde du jour', updatedAt: '2026-11-07T09:00:00.000Z' }],
  [9102, { id: 9102, centerId: 'libramont', date: HIER, status: 'confirmed', name: 'Sonde d hier', updatedAt: '2026-11-06T09:00:00.000Z' }],
]);
let sonde = null;
function chargerSonde(mutation = null) {
  const chemin = require.resolve(path.join(ROOT, 'lib', 'database.js'));
  const vrai = require.cache[chemin];
  if (!vrai) throw new Error('lib/database.js doit etre charge avant la sonde');
  const leve = () => { const e = new Error('SONDE'); e.statusCode = 418; throw e; };
  const faux = new Proxy(vrai.exports, {
    get(cible, cle) {
      if (cle === 'getReservationById') return async (id) => { const r = PROBE.get(Number(id)); return r ? { ...r } : null; };
      const v = cible[cle];
      if (typeof v === 'function' && cle !== 'getPool') return () => leve();
      return v;
    },
  });
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: faux };
  try {
    if (mutation) sonde = compilerMute(API_RESERVATIONS, mutation[0], mutation[1]);
    else { delete require.cache[require.resolve(API_RESERVATIONS)]; sonde = require(API_RESERVATIONS); }
  } finally {
    require.cache[chemin] = vrai;
  }
}
const serveurSonde = http.createServer((rq, rs) => {
  Promise.resolve(sonde(rq, rs)).catch((e) => { if (!rs.headersSent) { rs.writeHead(500); rs.end(String(e && e.message)); } });
});
async function sonder(methode, corps, qui) {
  const r = await fetch(`${BASE_SONDE}/api/staff-reservations`, { method: methode, headers: { 'content-type': 'application/json', cookie: cookies[qui] || '' }, body: JSON.stringify({ centerId: 'libramont', ...corps }) });
  return r.status;
}
const GLISSER = { activityMove: { activityId: 'bowling', startTime: '16:00', lanes: [4] } };
async function verifierReservations() {
  chargerSonde();
  ok(await sonder('PATCH', { id: 9101, ...GLISSER }, 'libramont:Technique') === 418, '[P] Technique (« Déplacer », sans « Modifier ») glisse une reservation du jour');
  ok(await sonder('PATCH', { id: 9101, ...GLISSER }, 'libramont:Staff bar') === 403, '[P] la Staff bar ne glisse pas : 403');
  ok(await sonder('PATCH', { id: 9102, ...GLISSER }, 'libramont:Technique') === 403, '[P] Technique ne glisse pas une reservation d hier : 403');
  ok(await sonder('PATCH', { id: 9102, ...GLISSER }, 'libramont:Gérant') === 418, '[P] le Manager (« Changer un jour passé ») glisse celle d hier');
  ok(await sonder('PATCH', { id: 9102, name: 'Corrige' }, 'libramont:Assistante') === 403, '[P] l Assistante ne corrige pas un dossier d hier : 403');
  ok(await sonder('PATCH', { id: 9101, name: 'Corrige' }, 'libramont:Assistante') === 418, '[P] ... et corrige celui du jour');
  ok(await sonder('PATCH', { id: 9102, status: 'arrived' }, 'libramont:Assistante') === 418, '[P] ... l accueil reste ouvert : elle pointe un groupe d hier');
  ok(await sonder('PATCH', { id: 9102, status: 'cancelled' }, 'libramont:Assistante') === 403, '[P] ... mais n annule pas un dossier d hier : 403');
  ok(await sonder('DELETE', { id: 9102 }, 'libramont:Assistante') === 403, '[P] ... ni ne le supprime : 403');
  ok(await sonder('DELETE', { id: 9102 }, 'libramont:Gérant') === 418, '[P] le Manager supprime le dossier d hier');
}

// ---------------------------------------------------------------------------
// [E] L ECRAN : la vraie console, un role apres l autre.
// ---------------------------------------------------------------------------
const prete = (page) => page.waitForFunction(() => typeof window.renderStaffMenu === 'function' && typeof window.getCurrentStaffCenterId === 'function'
  && Boolean(state.staffAuthSession) && document.getElementById('authOverlay').classList.contains('hidden') && Boolean(document.querySelector('[data-fgx-center-menu]'))
  && !document.getElementById('staffConsoleLoadStatus'), null, { timeout: 30000 });
async function ouvrir(browser, code) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-BE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message)));
  await page.goto(`${BASE}/?v=acces-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function');
  await page.locator('.entry-login').first().click();
  await page.locator('#authOverlay').waitFor({ state: 'visible' });
  await page.locator('#loginPass').fill(code);
  await page.locator('#authOverlay button[type="submit"]').click();
  await prete(page);
  return { ctx, page, erreurs };
}
const GESTES = ['reserver', 'deplacer', 'etat', 'encaisser', 'modifier', 'annuler', 'supprimer', 'retard', 'prevenir', 'fermerPiste', 'ecrire', 'exporter', 'noterClient'];
async function releve(page) {
  await page.evaluate(() => window.openStaffMenuPage('planning'));
  await page.evaluate(() => { if (typeof pbChanger === 'function') pbChanger('bowling'); });
  await page.waitForFunction(() => document.querySelector('#planningGridWrap .booking[data-booking-res-id="9201"]'), null, { timeout: 20000 }).catch(() => {});
  return page.evaluate(({ gestes, hier }) => {
    const carte = document.querySelector('#planningGridWrap .booking[data-booking-res-id="9201"]');
    const table = Object.fromEntries(gestes.map((g) => [g, peutGeste(g)]));
    table.deplacerHier = peutGeste('deplacer', hier);
    table.modifierHier = peutGeste('modifier', hier);
    table.annulerHier = peutGeste('annuler', hier);
    const barre = document.getElementById('planningReserver');
    return {
      table,
      carte: Boolean(carte),
      carteGlisse: Boolean(carte && carte.hasAttribute('onmousedown')),
      carteClavier: Boolean(carte && carte.hasAttribute('aria-keyshortcuts')),
      roues: document.querySelectorAll('#planningGridWrap .lane-header .settings').length,
      casesReservables: document.querySelectorAll('#planningGridWrap .slot-cell.clickable').length,
      casesCibles: document.querySelectorAll('#planningGridWrap .slot-cell[data-bowling-drop-lane]').length,
      reserverBarre: Boolean(barre && !barre.hidden),
      entreeEquipe: Boolean(document.querySelector('[data-fgx-menu-key="users"]')),
    };
  }, { gestes: GESTES, hier: HIER });
}
async function pageEquipe(page) {
  await page.evaluate(() => window.openStaffMenuPage('users'));
  await page.waitForTimeout(900);
  return page.evaluate(() => Boolean(document.querySelector('[data-equipe-page]')));
}
async function centresDuMenu(page) {
  await page.locator('[data-fgx-center-menu]').first().click();
  await page.waitForTimeout(400);
  const lus = await page.evaluate(() => [...document.querySelectorAll('[data-fgx-center-option]')].map((e) => e.getAttribute('data-fgx-center-option')));
  await page.keyboard.press('Escape');
  return lus;
}
async function menuDuPlanning(page) {
  const bouton = page.locator('[onclick*="togglePlanningActionsMenu"]').first();
  if (!(await bouton.count())) return '';
  await bouton.click();
  await page.waitForTimeout(300);
  const texte = await page.evaluate(() => (document.querySelector('.staff-action-popover') || {}).textContent || '');
  await page.keyboard.press('Escape');
  return texte;
}
const TOUS = Object.fromEntries([...GESTES, 'deplacerHier', 'modifierHier', 'annulerHier'].map((g) => [g, true]));
const ATTENDU = {
  'Staff bar': { ...TOUS, deplacer: false, deplacerHier: false, modifier: false, modifierHier: false, annuler: false, annulerHier: false, supprimer: false, retard: false, prevenir: false, fermerPiste: false, ecrire: false, exporter: false, noterClient: false },
  Technique: { ...TOUS, reserver: false, deplacerHier: false, etat: false, encaisser: false, modifier: false, modifierHier: false, annuler: false, annulerHier: false, supprimer: false, prevenir: false, ecrire: false, exporter: false, noterClient: false },
  'Gérant': { ...TOUS, ecrire: false, exporter: false },
  Assistante: { ...TOUS, deplacerHier: false, modifierHier: false, annulerHier: false, ecrire: false, exporter: false },
  Directrice: { ...TOUS },
};
const ecarts = (lu, attendu) => Object.keys(attendu).filter((g) => Boolean(lu[g]) !== attendu[g]);
// Ce qui rougit sous la mutation « deplacer toujours vrai » : la Staff bar ne doit pas pouvoir glisser.
const staffBarNeGlissePas = (r) => r.carte && !r.carteGlisse && !r.carteClavier && r.table.deplacer === false;

async function verifierEcran(browser) {
  const lu = {};
  for (const nom of ['Staff bar', 'Technique', 'Gérant', 'Assistante', 'Directrice']) {
    const { ctx, page, erreurs } = await ouvrir(browser, codes[`libramont:${nom}`]);
    try {
      const r = await releve(page);
      lu[nom] = r;
      ok(r.carte && r.casesCibles > 0, `[E] ${nom} : montage, la reservation du jour et la grille sont dessinees`, { carte: r.carte, cases: r.casesCibles });
      const e = ecarts(r.table, ATTENDU[nom]);
      ok(!e.length, `[E] ${nom} : chaque geste suit le role (${GESTES.length + 3} gestes lus)`, e.map((g) => `${g}=${r.table[g]}`));
      if (nom === 'Staff bar') {
        ok(staffBarNeGlissePas(r), '[E] Staff bar : la carte s ouvre mais ne se glisse pas (ni souris, ni doigt, ni touche M)', r);
        ok(r.roues === 0, '[E] Staff bar : pas de roue dentee sur les pistes', { roues: r.roues });
        ok(r.casesReservables > 0 && r.reserverBarre, '[E] Staff bar : les cases vides et « + Réservation » restent (elle reserve)', { cases: r.casesReservables, barre: r.reserverBarre });
      }
      if (nom === 'Technique') {
        ok(r.carteGlisse && r.roues > 0, '[E] Technique : la carte se glisse et la roue des pistes est la', { glisse: r.carteGlisse, roues: r.roues });
        ok(r.casesReservables === 0 && !r.reserverBarre && r.casesCibles > 0, '[E] Technique : aucune case ne reserve et pas de « + Réservation », les cases restent des cibles', { reservables: r.casesReservables, barre: r.reserverBarre, cibles: r.casesCibles });
      }
      if (nom === 'Gérant') {
        const menu = await menuDuPlanning(page);
        ok(Boolean(menu) && !/Exporter le jour/.test(menu) && /Nouvelle réservation ici/.test(menu), '[E] Manager : le menu du planning n offre pas l export, il offre la reservation', menu.slice(0, 160));
      }
      if (nom === 'Assistante') {
        const centres = await centresDuMenu(page);
        ok(!centres.includes('gembloux'), '[E] Assistante : le menu des centres ne propose pas Gembloux', centres);
      }
      if (nom === 'Directrice') {
        const centres = await centresDuMenu(page);
        ok(centres.includes('gembloux') && centres.includes('libramont'), '[E] Direction : le menu des centres propose ses deux centres', centres);
      }
      const voitEquipe = await pageEquipe(page);
      const doit = nom === 'Directrice';
      ok(r.entreeEquipe === doit && voitEquipe === doit, `[E] ${nom} : ${doit ? 'l entree et la page Équipe & accès sont la' : 'ni l entree ni la page Équipe & accès'}`, { entree: r.entreeEquipe, page: voitEquipe });
      ok(erreurs.length === 0, `[E] ${nom} : aucune erreur JavaScript`, erreurs.slice(0, 3));
    } finally {
      await ctx.close();
    }
  }
  return lu;
}

// ---------------------------------------------------------------------------
// [M] LES MONTANTS A L ECRAN
// ---------------------------------------------------------------------------
const UN_MONTANT = /\d\s*€/;
const PRIX_INVENTE = /Prix sur place|Prix au comptoir/;
async function dossierCharge(page) {
  await page.evaluate(() => window.openStaffMenuPage('planning'));
  await page.waitForFunction(() => Array.isArray(state.reservations) && state.reservations.some((r) => Number(r.id) === 9201), null, { timeout: 20000 });
  return page.evaluate(() => { const r = state.reservations.find((x) => Number(x.id) === 9201); return { prix: r.price, base: r.basePrice, extras: r.extras }; });
}
async function ficheOuverte(page, geste) {
  await page.evaluate(geste);
  await page.waitForFunction(() => { const o = document.getElementById('posOverlay'); return o && !o.classList.contains('hidden') && o.innerText.length > 30; }, null, { timeout: 15000 });
  return page.evaluate(() => document.getElementById('posOverlay').innerText);
}
async function accueilAffiche(page) {
  await page.evaluate(() => { closePos(); window.openStaffMenuPage('dashboard'); });
  await page.waitForTimeout(1200);
  return page.evaluate(() => document.body.innerText);
}
async function verifierMontants(browser) {
  const tech = await ouvrir(browser, codes['libramont:Technique']);
  try {
    const dossier = await dossierCharge(tech.page);
    ok(dossier.prix === null && dossier.extras[0].price === null, '[M] montage : le vrai filtre du serveur retire les montants de Technique', dossier);
    const fiche = await ficheOuverte(tech.page, () => openPos(9201));
    ok(fiche.includes('···') && !UN_MONTANT.test(fiche), '[M] Technique : la fiche dit « ··· », aucun montant, pas de faux « 0 € »', fiche.slice(0, 500));
    ok(!PRIX_INVENTE.test(fiche), '[M] Technique : et pas « Prix sur place », qui serait faux', fiche.slice(0, 500));
    const accueil = await accueilAffiche(tech.page);
    ok(!UN_MONTANT.test(accueil), '[M] Technique : l accueil n affiche aucun montant', (UN_MONTANT.exec(accueil) || [''])[0]);
    ok(tech.erreurs.length === 0, '[M] Technique : aucune erreur JavaScript', tech.erreurs.slice(0, 3));
  } finally { await tech.ctx.close(); }
  const manager = await ouvrir(browser, codes['libramont:Gérant']);
  try {
    const dossier = await dossierCharge(manager.page);
    const fiche = await ficheOuverte(manager.page, () => openPos(9201));
    ok(dossier.prix === 60 && UN_MONTANT.test(fiche) && !fiche.includes('···'), '[M] contraste : le Manager recoit et lit les montants', { prix: dossier.prix, fiche: fiche.slice(0, 200) });
  } finally { await manager.ctx.close(); }
  const correcteur = await ouvrir(browser, codes['libramont:Correcteur']);
  try {
    await dossierCharge(correcteur.page);
    const texte = await ficheOuverte(correcteur.page, () => editRes(9201));
    const lu = await correcteur.page.evaluate(() => ({ modification: Boolean(state.editState) && state.activeTab === 'modifier', champ: Boolean(document.getElementById('editPriceInput') || document.getElementById('editPricePerPerson')) }));
    ok(lu.modification && !lu.champ, '[M] Correcteur : la fiche de modification s ouvre, sans champ de prix', lu);
    ok(!UN_MONTANT.test(texte), '[M] Correcteur : aucun montant dans la fiche de modification', (UN_MONTANT.exec(texte) || [''])[0]);
    ok(correcteur.erreurs.length === 0, '[M] Correcteur : aucune erreur JavaScript', correcteur.erreurs.slice(0, 3));
  } finally { await correcteur.ctx.close(); }
}

// ---------------------------------------------------------------------------
// [C] LES CONTRE-PREUVES
// ---------------------------------------------------------------------------
async function contrePreuves(browser) {
  // [S] sans la garde du role Direction, le Chef d equipe la donne.
  chargerServeurMute('if (roleDonne && !peutDonnerLeRole(session, roleDonne)) {', 'if (false) {');
  const mute = await appel({ action: 'createMember', centerId: 'libramont', name: 'Intrus mute', contact: '', roleId: 'direction' }, cookies['libramont:Chef']);
  ok(mute.statut === 200, '[C] sans la garde du role Direction, [S] rougit : le Chef d equipe donne la Direction', { statut: mute.statut });
  chargerServeur();
  // [P] sans la garde du jour passe, l Assistante corrige le dossier d hier.
  chargerSonde(['if ((!gesteDAccueil || changeLAnnulation) && (jourPasse(current.date) || jourPasse(body.date))) {', 'if (false) {']);
  ok(await sonder('PATCH', { id: 9102, name: 'Corrige' }, 'libramont:Assistante') === 418, '[C] sans la garde du jour passe, [P] rougit : l Assistante corrige le dossier d hier');
  chargerSonde(['if (dateValide(current.date) && current.date < aujourdhuiABruxelles()) {', 'if (false) {']);
  ok(await sonder('DELETE', { id: 9102 }, 'libramont:Assistante') === 418, '[C] sans la garde du jour passe sur DELETE, [P] rougit : l Assistante supprime le dossier d hier');
  // [P] sans la regle « Déplacer », glisser redemande « Modifier » : Technique est refuse.
  chargerSonde(["? ['planning.drag', 'reservations.edit']", "? 'reservations.edit'"]);
  ok(await sonder('PATCH', { id: 9101, ...GLISSER }, 'libramont:Technique') === 403, '[C] sans la regle « Déplacer », [P] rougit : Technique ne glisse plus');
  chargerSonde();
  if (!browser) return;
  // [E] « deplacer » toujours vrai : la Staff bar glisse a l ecran.
  MUTATION_ECRAN = ["deplacer: (peut, jour) => peut(['planning.drag', 'reservations.edit']) && jour(),", 'deplacer: () => true,'];
  const { ctx, page } = await ouvrir(browser, codes['libramont:Staff bar']);
  try {
    const r = await releve(page);
    ok(r.carte && !staffBarNeGlissePas(r), '[C] « deplacer » toujours vrai, [E] rougit : la carte de la Staff bar se glisse', { carte: r.carte, glisse: r.carteGlisse });
  } finally {
    await ctx.close();
    MUTATION_ECRAN = null;
  }
  // [M] sans le masque des formateurs, l ecran invente un montant.
  MUTATION_ECRAN = ['function montantsMasques() {\n  return typeof', 'function montantsMasques() {\n  return false && typeof'];
  const sansMasque = await ouvrir(browser, codes['libramont:Technique']);
  try {
    await dossierCharge(sansMasque.page);
    const fiche = await ficheOuverte(sansMasque.page, () => openPos(9201));
    ok(UN_MONTANT.test(fiche) || PRIX_INVENTE.test(fiche), '[C] sans le masque, [M] rougit : la fiche invente un montant ou un « Prix sur place »', fiche.slice(0, 300));
  } finally {
    await sansMasque.ctx.close();
    MUTATION_ECRAN = null;
  }
}

async function main() {
  await new Promise((ok2, ko) => { serveur.once('error', ko); serveur.listen(PORT, '127.0.0.1', ok2); });
  await new Promise((ok2, ko) => { serveurSonde.once('error', ko); serveurSonde.listen(PORT + 1, '127.0.0.1', ok2); });
  let browser = null;
  try {
    chargerServeur();
    nomCookie = require(STAFF_AUTH).STAFF_SESSION_COOKIE;
    await poserEquipe();
    await verifierEquipe();
    verifierTable();
    await verifierReservations();
    if (!SANS_ECRAN) {
      const { chromium } = require(require.resolve('playwright-core', { paths: [ROOT] }));
      browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
      await verifierEcran(browser);
      await verifierMontants(browser);
    }
    await contrePreuves(browser);
  } finally {
    if (browser) await browser.close().catch(() => {});
    serveur.close();
    serveurSonde.close();
  }
  const uniques = [...new Set(NON_COUVERTES)];
  ok(!uniques.length, 'la base en memoire couvre tout le SQL joue (sinon une lecture serait fausse)', uniques.slice(0, 6));
  console.log(echecs ? `\nequipe-acces : ${echecs} echec(s)` : '\nequipe-acces : tout est vert');
  process.exit(echecs ? 1 : 0);
}
main().catch((erreur) => { console.error(erreur && erreur.stack ? erreur.stack : erreur); process.exit(1); });
