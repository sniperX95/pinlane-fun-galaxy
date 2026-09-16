// LES CODES D ACCES QUE L ENVIRONNEMENT IMPOSAIT (2026-09-16).
//
// POURQUOI CE GATE EXISTE. Movsar demande a quoi servent les codes poses sur
// Vercel. Relu ce jour-la dans lib/staff-auth.js :
//
//   [A] STAFF_DIRECTION_CODE, reste du temps ou Pinlane ne servait que Fun
//       Galaxy, etait reecrit a chaque bootstrap comme code du role Direction
//       et du membre « Poste direction » de Libramont, Gembloux et Ciney : une
//       cle Direction globale, que les autres clients n ont jamais eue (leurs
//       codes Direction naissent uniques, a l ouverture du centre).
//   [B] Un code Direction change dans la console etait remis au demarrage
//       suivant, et un « Poste direction » bloque, reactive.
//   [C] Sans STAFF_AUTH_SECRET, la cle de signature devenait SITE_PASSWORD, le
//       mot de passe de la fenetre du navigateur : son porteur fabriquait un
//       jeton proprietaire de secours. Sans PLATFORM_OWNER_CODE, le code
//       Direction ou ce meme mot de passe devenait la cle maitre de TOUS les
//       clients.
//   [D] Un code de role regenere continuait d ouvrir le centre des qu il avait
//       servi une fois : le membre partage `<centre>:role:<role>` gardait son
//       empreinte. En prod, « Direction partage » et « Manager partage » de
//       Libramont portaient l empreinte d anciens codes.
//   [E] Contraste : le proprietaire entre partout, et le demarrage a froid
//       saute encore le bootstrap quand tout est en place.
//
// HONNETETE : le VRAI lib/staff-auth.js sur une base en memoire qui obeit au
// SQL qu il envoie ('pg' remplace dans require.cache AVANT tout require
// applicatif). Chaque propriete a son CONTRASTE (le bon code ouvre toujours,
// sinon une regle qui refuse tout passerait pour sure) et sa CONTRE-EPREUVE par
// mutation compilee en memoire (disque jamais touche) : sans sa garde, ROUGE.
//
// Usage : node scripts/staff-access-codes-check.js
'use strict';
const crypto = require('crypto');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const STAFF_AUTH = path.join(ROOT, 'lib', 'staff-auth.js');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

const SECRET = 'gate-staff-access-codes-secret-2026';
const OWNER = 'GATE-OWNER-ACCES-2026';
const ENV_DIRECTION = 'GATE-DIRECTION-ENV-2026';
const SITE = 'gate-site-password-2026';
const REFUS = 'Code refusé ou accès bloqué.';
const ACTEUR = 'libramont:platform-owner';

// L environnement tel que la prod le porte encore : les anciennes variables sont
// POSEES, avec des valeurs fortes. Plus rien ne doit s en servir.
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_INSECURE_STAFF_CODES;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = SECRET;
process.env.PLATFORM_OWNER_CODE = OWNER;
process.env.STAFF_DIRECTION_CODE = ENV_DIRECTION;
process.env.STAFF_OWNER_CODE = ENV_DIRECTION;
process.env.SITE_PASSWORD = SITE;
process.env.DIRECTOR_PASSWORD = SITE;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// Meme empreinte que lib/staff-auth.hashSecret : le gate pose des lignes que le
// VRAI code reconnait, il ne court-circuite rien.
function empreinte(code, secret = SECRET) {
  return crypto.createHash('sha256').update(`${secret}:${String(code || '').trim()}`).digest('hex');
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE, qui lit les colonnes et les valeurs DANS le SQL.
// ---------------------------------------------------------------------------
let db;
let DDL = 0;
const NON_COUVERTES = [];
let horloge = Date.parse('2026-09-16T08:00:00.000Z');
function tic() { horloge += 1000; return new Date(horloge).toISOString(); }
function viderBase() {
  db = { staff_roles: [], staff_members: [], staff_sessions: [], staff_access_events: [] };
  DDL = 0;
}
viderBase();

const vide = () => ({ rows: [], rowCount: 0 });
const lignes = (rows) => ({ rows, rowCount: rows.length });
function sqlPlat(texte) { return String(texte).replace(/\s+/g, ' ').trim(); }

function lireInsert(sql, params) {
  const tete = sql.match(/^insert into (\w+) \(([^)]*)\) values \(/i);
  if (!tete) return null;
  // La liste des valeurs contient des parentheses (now()) : on cherche SA
  // parenthese fermante, pas la premiere venue.
  let profondeur = 1;
  let fin = tete[0].length;
  for (; fin < sql.length && profondeur > 0; fin += 1) {
    if (sql[fin] === '(') profondeur += 1;
    else if (sql[fin] === ')') profondeur -= 1;
  }
  const match = [null, tete[1], tete[2], sql.slice(tete[0].length, fin - 1), sql.slice(fin)];
  const colonnes = match[2].split(',').map((v) => v.trim());
  const valeurs = match[3].split(',').map((v) => v.trim());
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
  return { table: match[1], row, suite: match[4] || '' };
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
  if (table === 'staff_access_events') { store.push({ ...row, created_at: tic() }); return lignes([{ id: store.length }]); }
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

// La garde de production sur le membre partage de role. La base ne l applique
// QUE si le SQL la porte : retirer la garde du code rend l ancien comportement.
const GARDE = "and (m.id <> (m.center_id || ':role:' || m.role_id) or r.access_code_hash = m.access_code_hash)";
function roleDe(membre) { return db.staff_roles.find((r) => r.center_id === membre.center_id && r.id === membre.role_id); }
function retenu(membre, garde) {
  const role = roleDe(membre);
  if (!role) return false;
  if (!garde) return true;
  return membre.id !== `${membre.center_id}:role:${membre.role_id}` || role.access_code_hash === membre.access_code_hash;
}

async function requete(texte, params = []) {
  const sql = sqlPlat(texte);
  if (/^(begin|commit|rollback)/i.test(sql)) return vide();
  if (/pg_advisory_xact_lock/i.test(sql)) return vide();
  if (/^(create|alter|drop|comment on)/i.test(sql)) { DDL += 1; return vide(); }
  if (/^insert into/i.test(sql)) { const r = inserer(sql, params); if (r) return r; }
  const garde = sql.includes(GARDE);

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
  if (/^select .* from staff_roles where center_id = \$1/i.test(sql)) {
    return lignes(db.staff_roles.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })));
  }
  if (/^select .* from staff_members where id = \$1/i.test(sql)) {
    const m = db.staff_members.find((x) => x.id === params[0]);
    return m ? lignes([{ ...m }]) : vide();
  }
  if (/^select .* from staff_members where center_id = \$1/i.test(sql)) {
    return lignes(db.staff_members.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })));
  }
  if (/^select .* from staff_access_events where center_id = \$1/i.test(sql)) {
    return lignes(db.staff_access_events.filter((x) => x.center_id === params[0]).map((x) => ({ ...x })));
  }
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
    const affectations = sql.match(/^update staff_roles set (.*?) where /i)[1];
    for (const morceau of affectations.split(',')) {
      const i = morceau.indexOf('=');
      const colonne = morceau.slice(0, i).trim();
      const valeur = morceau.slice(i + 1).trim();
      const place = valeur.match(/^\$(\d+)(::jsonb)?$/i);
      if (place) {
        let v = params[Number(place[1]) - 1];
        if (place[2] && typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { /* chaine brute */ } }
        r[colonne] = v;
      } else if (/^now\(\)$/i.test(valeur)) r[colonne] = tic();
      else if (/^(true|false)$/i.test(valeur)) r[colonne] = /^true$/i.test(valeur);
      else NON_COUVERTES.push(`update staff_roles ${colonne} = ${valeur}`);
    }
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
  if (/insert into audit_log|from schema_migrations/i.test(sql)) return vide();
  NON_COUVERTES.push(sql.slice(0, 160));
  return vide();
}

class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  async end() {}
  on() {}
}
const pgResolu = require.resolve('pg');
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };

// ---------------------------------------------------------------------------
// MUTATIONS COMPILEES EN MEMOIRE (le fichier sur disque n est jamais touche).
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  if (path.resolve(nom) !== STAFF_AUTH || !mutations.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of mutations) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ANCRE absente ou multiple : ${de.slice(0, 90)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function charger() {
  delete require.cache[require.resolve(STAFF_AUTH)];
  return require(STAFF_AUTH);
}

let tentative = 0;
async function connexion(m, centerId, code) {
  tentative += 1;
  try {
    const r = await m.loginStaffByCode({ centerId, code, fingerprint: `gate-codes-${tentative}` });
    return { ok: true, centre: r.session.centerId, membre: r.session.member && r.session.member.id, permissions: r.session.permissions || [] };
  } catch (erreur) {
    return { ok: false, message: String(erreur && erreur.message) };
  }
}
function essayerSync(fn) {
  try { return { ok: true, valeur: fn() }; } catch (erreur) { return { ok: false, message: String(erreur && erreur.message), statusCode: erreur && erreur.statusCode }; }
}
function membre(id) { return db.staff_members.find((x) => x.id === id); }
// Pose une ligne comme la base la laisserait : une seule ligne par identifiant.
function poserMembre(ligne) {
  db.staff_members = db.staff_members.filter((x) => x.id !== ligne.id);
  db.staff_members.push(ligne);
}
function role(centerId, id) { return db.staff_roles.find((x) => x.center_id === centerId && x.id === id); }

// ---------------------------------------------------------------------------
// [A] L ENVIRONNEMENT N IMPOSE PLUS AUCUN CODE DIRECTION
// ---------------------------------------------------------------------------
async function scenarioA(m) {
  const v = new Map();
  const proprio = await connexion(m, 'libramont', OWNER);
  v.set('[A] montage : bootstrap complet sur base vide, les roles Direction du socle existent',
    proprio.ok && DDL > 0 && ['libramont', 'gembloux', 'ciney'].every((c) => Boolean(role(c, 'direction'))));
  const interdites = [empreinte(ENV_DIRECTION), empreinte(SITE)];
  v.set('[A] aucune ligne ne porte le code Direction de l environnement ni le mot de passe du site',
    ![...db.staff_roles, ...db.staff_members].some((x) => interdites.includes(x.access_code_hash)));
  v.set('[A] aucun membre « Poste direction » n est cree', !db.staff_members.some((x) => /:direction-local$/.test(x.id)));
  const envLib = await connexion(m, 'libramont', ENV_DIRECTION);
  const envGem = await connexion(m, 'gembloux', ENV_DIRECTION);
  v.set('[A] le code Direction de l environnement est refuse a Libramont et a Gembloux',
    !envLib.ok && envLib.message === REFUS && !envGem.ok && envGem.message === REFUS);
  const site = await connexion(m, 'libramont', SITE);
  v.set('[A] le mot de passe du site est refuse comme code', !site.ok && site.message === REFUS);
  const direction = role('libramont', 'direction');
  const revele = await m.revealRoleCode({ centerId: 'libramont', actorMemberId: ACTEUR, roleId: 'direction' });
  const parCode = revele.code ? await connexion(m, 'libramont', revele.code) : { ok: false };
  v.set('[A] contraste : la Direction de Libramont a SON code, lisible par le proprietaire, et il ouvre le centre',
    Boolean(direction) && direction.locked === true && Boolean(revele.code)
      && empreinte(revele.code) === direction.access_code_hash && parCode.ok && parCode.centre === 'libramont');
  return v;
}

// ---------------------------------------------------------------------------
// [B] CE QUE LA CONSOLE CHANGE TIENT APRES UN REDEMARRAGE
// ---------------------------------------------------------------------------
async function scenarioB(m, recharger) {
  const v = new Map();
  await connexion(m, 'libramont', OWNER);
  // L etat que l ancien code a laisse en prod : role Direction et « Poste
  // direction » sur le code de l environnement.
  role('libramont', 'direction').access_code_hash = empreinte(ENV_DIRECTION);
  poserMembre({
    id: 'libramont:direction-local', center_id: 'libramont', name: 'Poste direction', contact: 'Acces bootstrap securise',
    role_id: 'direction', status: 'active', access_code_hash: empreinte(ENV_DIRECTION), access_code_hint: '', created_at: tic(), updated_at: tic(),
  });
  const avant = await connexion(m, 'libramont', ENV_DIRECTION);
  v.set('[B] montage : les lignes heritees ouvrent encore Libramont avec le code de l environnement (etat reel de la prod)', avant.ok);
  const { accessCode: nouveau } = await m.regenerateRoleCode({ centerId: 'libramont', actorMemberId: ACTEUR, roleId: 'direction' });
  membre('libramont:direction-local').status = 'blocked';
  // Redemarrage a froid avec une ligne proprietaire manquante : le bootstrap complet repasse.
  db.staff_members = db.staff_members.filter((x) => x.id !== 'ciney:platform-owner');
  const m2 = recharger();
  const ddlAvant = DDL;
  const proprio = await connexion(m2, 'libramont', OWNER);
  v.set('[B] montage : le redemarrage a bien rejoue le bootstrap complet',
    proprio.ok && DDL > ddlAvant && Boolean(membre('ciney:platform-owner')));
  v.set('[B] le code Direction change dans la console tient apres le redemarrage',
    Boolean(nouveau) && role('libramont', 'direction').access_code_hash === empreinte(nouveau));
  const parNouveau = await connexion(m2, 'libramont', nouveau);
  v.set('[B] et il ouvre Libramont', parNouveau.ok && parNouveau.centre === 'libramont');
  v.set('[B] « Poste direction » bloque dans la console reste bloque', membre('libramont:direction-local').status === 'blocked');
  const parEnv = await connexion(m2, 'libramont', ENV_DIRECTION);
  v.set('[B] le code de l environnement n ouvre plus Libramont', !parEnv.ok && parEnv.message === REFUS);
  return v;
}

// ---------------------------------------------------------------------------
// [C] AUCUN REPLI SUR LE MOT DE PASSE DU SITE NI SUR UN AUTRE CODE
// ---------------------------------------------------------------------------
function jeton(secret, charge) {
  const corps = Buffer.from(JSON.stringify(charge), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(corps).digest('base64url');
  return `fgs_emergency_${corps}.${signature}`;
}
async function scenarioC(m) {
  const v = new Map();
  const charge = {
    v: 1, kind: 'platform-owner-emergency', centerId: 'libramont', memberId: 'libramont:platform-owner-emergency',
    iat: Date.now(), exp: Date.now() + 60 * 60 * 1000,
  };
  const sauvegarde = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.STAFF_AUTH_SECRET;
    delete process.env.PLATFORM_OWNER_CODE;
    v.set('[C] montage : runtime de production, mot de passe du site et anciens codes poses',
      m.__test.isProductionRuntime() && process.env.SITE_PASSWORD === SITE
        && process.env.STAFF_DIRECTION_CODE === ENV_DIRECTION && process.env.STAFF_OWNER_CODE === ENV_DIRECTION && process.env.DIRECTOR_PASSWORD === SITE);
    const secret = essayerSync(() => m.__test.getAuthSecret());
    v.set('[C] sans STAFF_AUTH_SECRET, aucune cle de repli : refus net en production',
      !secret.ok && secret.statusCode === 500 && /manquant en production/i.test(secret.message));
    const proprio = essayerSync(() => m.__test.getPlatformOwnerCode());
    v.set('[C] sans PLATFORM_OWNER_CODE, ni le code Direction ni le mot de passe du site ne deviennent la cle maitre',
      !proprio.ok && proprio.statusCode === 500 && /manquant en production/i.test(proprio.message));
    const forge = essayerSync(() => m.__test.decodeEmergencyToken(jeton(SITE, charge)));
    v.set('[C] un jeton proprietaire signe avec le mot de passe du site n ouvre aucune session', !forge.ok || forge.valeur === null);
    process.env.STAFF_AUTH_SECRET = SECRET;
    const vrai = essayerSync(() => m.__test.decodeEmergencyToken(jeton(SECRET, charge)));
    const faux = essayerSync(() => m.__test.decodeEmergencyToken(jeton(SITE, charge)));
    v.set('[C] contraste : le meme jeton signe avec le vrai secret est reconnu, celui du mot de passe du site non',
      vrai.ok && Boolean(vrai.valeur) && vrai.valeur.kind === 'platform-owner-emergency' && faux.ok && faux.valeur === null);
  } finally {
    for (const cle of Object.keys(process.env)) if (!(cle in sauvegarde)) delete process.env[cle];
    Object.assign(process.env, sauvegarde);
  }
  return v;
}

// ---------------------------------------------------------------------------
// [D] UN CODE DE ROLE REMPLACE N OUVRE PLUS RIEN
// ---------------------------------------------------------------------------
async function scenarioD(m) {
  const v = new Map();
  await connexion(m, 'libramont', OWNER);
  const { accessCode: ancien } = await m.regenerateRoleCode({ centerId: 'libramont', actorMemberId: ACTEUR, roleId: 'manager' });
  const premiere = await connexion(m, 'libramont', ancien);
  v.set('[D] montage : le code de role a servi une fois, son membre partage porte son empreinte',
    premiere.ok && premiere.membre === 'libramont:role:manager'
      && Boolean(membre('libramont:role:manager')) && membre('libramont:role:manager').access_code_hash === empreinte(ancien));
  const { accessCode: actuel } = await m.regenerateRoleCode({ centerId: 'libramont', actorMemberId: ACTEUR, roleId: 'manager' });
  const ici = await connexion(m, 'libramont', ancien);
  v.set('[D] le code de role remplace est refuse sur son centre', !ici.ok && ici.message === REFUS);
  const ailleurs = await connexion(m, 'n4-bowling', ancien);
  v.set('[D] et depuis la console d un autre centre', !ailleurs.ok && ailleurs.message === REFUS);
  const parActuel = await connexion(m, 'libramont', actuel);
  v.set('[D] contraste : le code ACTUEL du role ouvre, sur le meme membre partage',
    parActuel.ok && parActuel.centre === 'libramont' && parActuel.membre === 'libramont:role:manager');
  const perso = 'PERSO-GATE-2026-ABCD';
  poserMembre({
    id: 'libramont:member:gate-perso', center_id: 'libramont', name: 'Salarie', contact: '', role_id: 'manager',
    status: 'active', access_code_hash: empreinte(perso), access_code_hint: '', created_at: tic(), updated_at: tic(),
  });
  const parPerso = await connexion(m, 'libramont', perso);
  v.set('[D] contraste : un membre ordinaire garde son code personnel', parPerso.ok && parPerso.membre === 'libramont:member:gate-perso');
  // Le cas de la prod : un code Direction commun aux centres du socle, change a
  // Libramont seulement, dont « Direction partage » garde l empreinte.
  const commun = 'DIRECTION-COMMUNE-GATE-2026';
  role('gembloux', 'direction').access_code_hash = empreinte(commun);
  poserMembre({
    id: 'libramont:role:direction', center_id: 'libramont', name: 'Direction partagé', contact: 'Code rôle', role_id: 'direction',
    status: 'active', access_code_hash: empreinte(commun), access_code_hint: '', last_seen: tic(), created_at: tic(), updated_at: tic(),
  });
  v.set('[D] montage : Libramont a un autre code Direction, Gembloux garde le code commun',
    role('libramont', 'direction').access_code_hash !== empreinte(commun) && role('gembloux', 'direction').access_code_hash === empreinte(commun));
  // Tape sur la console de Libramont, le code commun mene la ou il vaut encore
  // (resolution du centre d origine), jamais a Libramont qui l a remplace.
  const libAncien = await connexion(m, 'libramont', commun);
  v.set('[D] « Direction partage » n ouvre plus Libramont avec l ancien code : tape a Libramont, il mene a Gembloux ou il vaut encore',
    libAncien.ok && libAncien.centre === 'gembloux');
  const depuisN4 = await connexion(m, 'n4-bowling', commun);
  v.set('[D] le code encore valable a Gembloux y mene depuis une autre console, le membre perime ne detourne pas la resolution',
    depuisN4.ok && depuisN4.centre === 'gembloux');
  return v;
}

// ---------------------------------------------------------------------------
// [E] LE PROPRIETAIRE ENTRE PARTOUT, LE DEMARRAGE A FROID RESTE COURT
// ---------------------------------------------------------------------------
async function scenarioE(m, recharger) {
  const v = new Map();
  const lib = await connexion(m, 'libramont', OWNER);
  v.set('[E] le proprietaire entre a Libramont avec platform.admin', lib.ok && lib.centre === 'libramont' && lib.permissions.includes('platform.admin'));
  const n4 = await connexion(m, 'n4-bowling', OWNER);
  v.set('[E] et sur un centre ne dans la console (N4 Bowling)', n4.ok && n4.centre === 'n4-bowling' && n4.permissions.includes('platform.admin'));
  const m2 = recharger();
  const ddl = DDL;
  const froid = await connexion(m2, 'gembloux', OWNER);
  v.set('[E] le demarrage a froid saute le bootstrap quand tout est en place', froid.ok && DDL === ddl);
  db.staff_members = db.staff_members.filter((x) => x.id !== 'ciney:platform-owner');
  const m3 = recharger();
  const ddl2 = DDL;
  const repare = await connexion(m3, 'gembloux', OWNER);
  v.set('[E] contraste : une ligne proprietaire manquante relance le bootstrap, qui la repose',
    repare.ok && DDL > ddl2 && Boolean(membre('ciney:platform-owner')));
  return v;
}

const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE };

async function executer(cle, editions = []) {
  viderBase();
  mutations = editions;
  try {
    const m = charger();
    return await SCENARIOS[cle](m, charger);
  } finally {
    mutations = [];
  }
}

const L = (...lignesSource) => lignesSource.join(LF);
const MUTATIONS = [
  {
    nom: 'le preset Direction reprend STAFF_DIRECTION_CODE',
    scenario: 'A',
    cibles: ['[A] aucune ligne ne porte le code Direction de l environnement ni le mot de passe du site', '[A] le code Direction de l environnement est refuse a Libramont et a Gembloux'],
    editions: [{
      de: '      const bootstrapCode = createAccessCode(preset.code);',
      vers: "      const bootstrapCode = preset.id === 'direction' ? process.env.STAFF_DIRECTION_CODE : createAccessCode(preset.code);",
    }],
  },
  {
    nom: 'le bootstrap reecrit le code du role Direction',
    scenario: 'B',
    cibles: ['[B] le code Direction change dans la console tient apres le redemarrage', '[B] le code de l environnement n ouvre plus Libramont'],
    editions: [{
      de: L(
        '        set permissions = $3::jsonb,',
        '            locked = true,',
        '            updated_at = now()',
        '        where center_id = $1 and id = $2;',
        '      `,',
        '      [',
        '        centerId,',
        "        'direction',",
        '        JSON.stringify(ALL_PERMISSIONS),',
        '      ],',
      ),
      vers: L(
        '        set permissions = $3::jsonb,',
        '            locked = true,',
        '            access_code_hash = $4,',
        '            updated_at = now()',
        '        where center_id = $1 and id = $2;',
        '      `,',
        '      [',
        '        centerId,',
        "        'direction',",
        '        JSON.stringify(ALL_PERMISSIONS),',
        '        hashSecret(process.env.STAFF_DIRECTION_CODE),',
        '      ],',
      ),
    }],
  },
  {
    nom: 'le bootstrap repose et reactive « Poste direction »',
    scenario: 'B',
    cibles: ['[B] « Poste direction » bloque dans la console reste bloque', '[B] le code de l environnement n ouvre plus Libramont'],
    editions: [{
      de: '    await ensurePlatformOwnerAccess(centerId, client);',
      vers: L(
        '    await client.query(',
        '      `',
        '        insert into staff_members (',
        '          id, center_id, name, contact, role_id, status, access_code_hash, access_code_hint, access_code_enc',
        "        ) values ($1,$2,$3,$4,$5,'active',$6,$7,$8)",
        '        on conflict (id) do update set',
        '          role_id = excluded.role_id,',
        "          status = 'active',",
        '          access_code_hash = excluded.access_code_hash,',
        '          access_code_hint = excluded.access_code_hint,',
        '          access_code_enc = excluded.access_code_enc,',
        '          updated_at = now();',
        '      `,',
        '      [',
        '        `${centerId}:direction-local`,',
        '        centerId,',
        "        'Poste direction',",
        "        'Acces bootstrap securise',",
        "        'direction',",
        '        hashSecret(process.env.STAFF_DIRECTION_CODE),',
        '        codeHint(process.env.STAFF_DIRECTION_CODE),',
        '        encryptAccessCode(process.env.STAFF_DIRECTION_CODE),',
        '      ],',
        '    );',
        '    await ensurePlatformOwnerAccess(centerId, client);',
      ),
    }],
  },
  {
    nom: 'la cle de signature retombe sur SITE_PASSWORD',
    scenario: 'C',
    cibles: ['[C] sans STAFF_AUTH_SECRET, aucune cle de repli : refus net en production', '[C] un jeton proprietaire signe avec le mot de passe du site n ouvre aucune session'],
    editions: [{
      de: '  const configured = process.env.STAFF_AUTH_SECRET;',
      vers: L('  const configured = process.env.STAFF_AUTH_SECRET', '    || process.env.SITE_PASSWORD', '    || process.env.DIRECTOR_PASSWORD;'),
    }],
  },
  {
    nom: 'le code proprietaire retombe sur le code Direction et le mot de passe du site',
    scenario: 'C',
    cibles: ['[C] sans PLATFORM_OWNER_CODE, ni le code Direction ni le mot de passe du site ne deviennent la cle maitre'],
    editions: [{
      de: '  const configured = process.env.PLATFORM_OWNER_CODE;',
      vers: L(
        '  const configured = process.env.PLATFORM_OWNER_CODE',
        '    || process.env.STAFF_OWNER_CODE',
        '    || process.env.STAFF_DIRECTION_CODE',
        '    || process.env.DIRECTOR_PASSWORD',
        '    || process.env.SITE_PASSWORD;',
      ),
    }],
  },
  {
    nom: 'le membre partage s authentifie par sa propre empreinte (connexion)',
    scenario: 'D',
    cibles: ['[D] le code de role remplace est refuse sur son centre', '[D] « Direction partage » n ouvre plus Libramont avec l ancien code : tape a Libramont, il mene a Gembloux ou il vaut encore'],
    editions: [{
      de: L(
        "        where m.center_id = $1 and m.access_code_hash = $2 and m.status <> 'blocked'",
        "          and (m.id <> (m.center_id || ':role:' || m.role_id) or r.access_code_hash = m.access_code_hash)",
      ),
      vers: "        where m.center_id = $1 and m.access_code_hash = $2 and m.status <> 'blocked'",
    }],
  },
  {
    nom: 'le membre partage perime compte dans la resolution du centre d origine',
    scenario: 'D',
    cibles: ['[D] le code encore valable a Gembloux y mene depuis une autre console, le membre perime ne detourne pas la resolution'],
    editions: [{
      de: L(
        "      where m.access_code_hash = $1 and m.status <> 'blocked'",
        "        and (m.id <> (m.center_id || ':role:' || m.role_id) or r.access_code_hash = m.access_code_hash)",
      ),
      vers: "      where m.access_code_hash = $1 and m.status <> 'blocked'",
    }],
  },
  {
    nom: 'le demarrage a froid exige encore « Poste direction »',
    scenario: 'E',
    cibles: ['[E] le demarrage a froid saute le bootstrap quand tout est en place'],
    editions: [{
      de: '      expected.set(`${centerId}:platform-owner`, ownerHash);',
      vers: L('      expected.set(`${centerId}:platform-owner`, ownerHash);', "      expected.set(`${centerId}:direction-local`, 'plus-jamais-pose');"),
    }],
  },
];

(async () => {
  for (const cle of Object.keys(SCENARIOS)) {
    const verdicts = await executer(cle);
    for (const [label, valeur] of verdicts) ok(valeur === true, label);
  }
  ok(NON_COUVERTES.length === 0, `toute requete SQL du code est servie par la base en memoire (${NON_COUVERTES.length} non couverte)`,
    NON_COUVERTES.slice(0, 5).join(' | '));

  console.log('\n[mutation] contre-epreuves (le gate ROUGIRAIT sans chaque garde)');
  const vues = new Set();
  for (const c of MUTATIONS) {
    let verdict = false;
    let detail = '';
    try {
      const verdicts = await executer(c.scenario, c.editions);
      const absentes = c.cibles.filter((label) => !verdicts.has(label));
      if (absentes.length) detail = `cible inconnue : ${absentes[0]}`;
      else {
        const rougies = c.cibles.filter((label) => verdicts.get(label) !== true);
        verdict = rougies.length > 0;
        detail = verdict ? `rougit : ${rougies[0]}` : 'aucune cible ne rougit';
      }
    } catch (erreur) {
      const message = String(erreur && erreur.message);
      if (/^ANCRE/.test(message)) detail = message;
      else { verdict = true; detail = `le scenario casse : ${message.slice(0, 90)}`; }
    }
    c.editions.forEach((e) => vues.add(e.de));
    ok(verdict, `[mutation] « ${c.nom} »`, detail);
  }
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');
  ok(vues.size === MUTATIONS.length, '[mutation] chaque contre-epreuve vise une ancre distincte');

  console.log(`\n${failures ? `ECHEC : ${failures} controle(s) rouge(s)` : 'ALL OK : codes d acces, aucune cle venue de l environnement'}`);
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error('ERREUR DU GATE', erreur && (erreur.stack || erreur.message || erreur));
  process.exit(1);
});
