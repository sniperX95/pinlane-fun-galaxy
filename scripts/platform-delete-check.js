// Gate de la SUPPRESSION plateforme (deleteCenter / deleteClient), cote
// proprietaire. Prouve en COMPORTEMENT, sur les VRAIES fonctions de
// lib/platform-clients.js (pool espionne, zero reseau, zero base) :
//
//   [A] ids invalides rejetes (erreur exposee), aucune ecriture ;
//   [B] un centre BASELINE (libramont, defini dans ops-knowledge/centers.json)
//       est REFUSE : sa ligne DB n'est qu'une projection du fichier, la
//       supprimer ne le supprimerait pas. Aucune requete d'ecriture ne part ;
//   [C] un centre qui porte des RESERVATIONS est REFUSE (les donnees metier ne
//       s'effacent jamais en silence). Aucune ecriture ;
//   [D] un centre DB nu se supprime dans UNE transaction : BEGIN, purge des
//       tables dependantes (FK), staff_members AVANT staff_roles (FK restrict),
//       la ligne centers en DERNIER, COMMIT. Le centre voyage en PARAMETRE ;
//   [E] un client qui possede encore des centres est BLOQUE (pas de cascade
//       silencieuse). Aucune ecriture ;
//   [F] un client sans centre se supprime ;
//   [G] ISOLATION : les deux actions sont gatees platform.admin dans
//       getRequiredOpsPermission (api/ops.js) et cablees sur la lib avec
//       body.id (jamais body.centerId, ecrase par withCenter) ;
//   [H] contre-preuves par MUTATION (edition inverse exacte, jamais git
//       checkout) : garde baseline neutralisee -> [B] rougirait ; garde
//       reservations neutralisee -> [C] rougirait ; actions retirees de la
//       liste platform.admin -> [G] rougirait. Mutation sans effet = sortie en
//       erreur (le gate ne prouverait rien).
//
// Lancement : node scripts/platform-delete-check.js
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const resolve = (p) => require.resolve(path.join(ROOT, p));

// --- Stubs des dependances lourdes (memes espions que platform-clients-check) --
function stub(relPath, exportsObj) {
  const id = resolve(relPath);
  const m = new Module(id);
  m.filename = id;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[id] = m;
}

stub('lib/center-config.js', {
  upsertCenter: async (pool, center) => ({ id: center.id, name: center.name, status: center.status }),
});
stub('lib/staff-auth.js', {
  ALL_PERMISSIONS: ['dashboard.view', 'direction.view', 'reservations.view', 'users.manage', 'settings.manage'],
  createRole: async ({ name }) => ({ role: { id: name.toLowerCase(), name }, accessCode: 'XX-0000' }),
});
stub('lib/database.js', { getPool: () => { throw new Error('getPool ne doit pas etre appele : le pool voyage en parametre'); } });

const platformClientsPath = resolve('lib/platform-clients.js');

function freshPlatformClients() {
  delete require.cache[platformClientsPath];
  return require(platformClientsPath);
}

// --- Faux pool : espionne chaque requete, obeit au TEXTE du SQL ---------------
function makePool(state) {
  const log = [];
  async function query(sql, params = []) {
    const s = String(sql).trim();
    log.push({ sql: s, params });
    if (/^select id, name from centers where id = \$1/i.test(s)) {
      return (state.centers || []).includes(params[0])
        ? { rowCount: 1, rows: [{ id: params[0], name: `Centre ${params[0]}` }] }
        : { rowCount: 0, rows: [] };
    }
    if (/^select count\(\*\)::int as n from reservations where center_id = \$1/i.test(s)) {
      return { rowCount: 1, rows: [{ n: state.reservations || 0 }] };
    }
    if (/^select id, name from clients where id = \$1/i.test(s)) {
      return (state.clients || []).includes(params[0])
        ? { rowCount: 1, rows: [{ id: params[0], name: `Client ${params[0]}` }] }
        : { rowCount: 0, rows: [] };
    }
    if (/^select count\(\*\)::int as n from centers where client_id = \$1/i.test(s)) {
      return { rowCount: 1, rows: [{ n: state.clientCenters || 0 }] };
    }
    if (/^delete from /i.test(s)) return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  }
  return { log, query, async connect() { return { query, release() {} }; } };
}

function writes(log) {
  return log.filter((entry) => /^(delete from|begin|commit|rollback)/i.test(entry.sql));
}

function indexOfSql(log, needle) {
  return log.findIndex((entry) => entry.sql.toLowerCase().startsWith(needle));
}

const checks = [];
let passed = 0;
function ok(name, cond, detail) {
  checks.push({ name, ok: !!cond });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
  if (cond) passed += 1;
}

async function captureError(run) {
  try { await run(); return null; } catch (error) { return error; }
}

(async () => {
  const { deleteCenter, deleteClient } = freshPlatformClients();

  console.log('\n[A] ids invalides rejetes (expose), aucune ecriture');
  let pool = makePool({});
  let err = await captureError(() => deleteCenter(pool, { id: 'MAJUSCULE INVALIDE' }));
  ok('id centre invalide rejete (expose)', err && err.expose === true);
  err = await captureError(() => deleteClient(pool, { id: '' }));
  ok('id client vide rejete (expose)', err && err.expose === true);
  ok('aucune requete d ecriture emise', writes(pool.log).length === 0);

  console.log('\n[B] centre BASELINE (fichier centers.json) refuse');
  pool = makePool({ centers: ['libramont'] });
  err = await captureError(() => deleteCenter(pool, { id: 'libramont' }));
  ok('libramont (baseline) refuse, erreur exposee', err && err.expose === true, err && err.message);
  ok('le refus est motive (fichier / non supprimable)', err && /fichier|non supprimable/i.test(err.message || ''));
  ok('aucune ecriture (ni BEGIN ni delete) sur refus baseline', writes(pool.log).length === 0);

  console.log('\n[C] centre avec RESERVATIONS refuse');
  pool = makePool({ centers: ['mi-12'], reservations: 5 });
  err = await captureError(() => deleteCenter(pool, { id: 'mi-12' }));
  ok('centre avec 5 reservations refuse, erreur exposee', err && err.expose === true, err && err.message);
  ok('le refus nomme le nombre de reservations', err && /5 reservation/i.test(err.message || ''));
  ok('aucune ecriture (ni BEGIN ni delete) sur refus reservations', writes(pool.log).length === 0);

  console.log('\n[D] centre DB nu : transaction complete, ordre des dependances');
  pool = makePool({ centers: ['mi-12'], reservations: 0 });
  const out = await deleteCenter(pool, { id: 'mi-12' });
  ok('suppression rendue avec id + nom', out && out.id === 'mi-12' && /mi-12/.test(out.name || ''));
  const log = pool.log;
  const iBegin = indexOfSql(log, 'begin');
  const iMembers = indexOfSql(log, 'delete from staff_members');
  const iRoles = indexOfSql(log, 'delete from staff_roles');
  const iCenters = indexOfSql(log, 'delete from centers');
  const iCommit = indexOfSql(log, 'commit');
  ok('transaction ouverte avant toute suppression', iBegin !== -1 && iBegin < iMembers);
  ok('staff_members purge AVANT staff_roles (FK restrict)', iMembers !== -1 && iRoles !== -1 && iMembers < iRoles);
  ok('la ligne centers part en DERNIER, apres ses dependances', iCenters > iRoles && iCenters !== -1);
  ok('COMMIT apres le delete centers, aucun ROLLBACK', iCommit > iCenters && indexOfSql(log, 'rollback') === -1);
  const centersDelete = log[iCenters] || { sql: '', params: [] };
  ok('le centre voyage en PARAMETRE, jamais concatene', /where center_id = \$1|where id = \$1/.test(centersDelete.sql) && centersDelete.params[0] === 'mi-12');
  const purged = log.filter((e) => /^delete from /i.test(e.sql)).map((e) => e.sql.match(/^delete from (\w+)/i)[1]);
  ['staff_sessions', 'lane_statuses', 'communications', 'ops_jobs', 'campaigns', 'email_templates', 'email_identities', 'marketing_suppressions'].forEach((table) => {
    ok(`dependance FK purgee : ${table}`, purged.includes(table));
  });
  ok('les RESERVATIONS ne sont JAMAIS purgees par ce chemin', !purged.includes('reservations'));

  console.log('\n[E] client avec centres BLOQUE (pas de cascade silencieuse)');
  pool = makePool({ clients: ['lac'], clientCenters: 2 });
  err = await captureError(() => deleteClient(pool, { id: 'lac' }));
  ok('client avec 2 centres refuse, erreur exposee', err && err.expose === true, err && err.message);
  ok('le refus nomme le nombre de centres', err && /2 centre/i.test(err.message || ''));
  ok('aucune ecriture sur refus', writes(pool.log).length === 0);

  console.log('\n[F] client sans centre supprime');
  pool = makePool({ clients: ['lac'], clientCenters: 0 });
  const outClient = await deleteClient(pool, { id: 'lac' });
  ok('client supprime, id + nom rendus', outClient && outClient.id === 'lac' && /lac/i.test(outClient.name || ''));
  const clientDelete = pool.log.find((e) => /^delete from clients/i.test(e.sql)) || { sql: '', params: [] };
  ok('delete clients parametre sur le bon id', /where id = \$1/.test(clientDelete.sql) && clientDelete.params[0] === 'lac');

  console.log('\n[G] isolation : gate platform.admin + cablage body.id');
  const opsSource = fs.readFileSync(path.join(ROOT, 'api', 'ops.js'), 'utf8');
  const gateRx = /if \(\[[^\]]*'deleteClient'[^\]]*'deleteCenter'[^\]]*\]\.includes\(action\)\) return 'platform\.admin';/;
  ok('deleteClient et deleteCenter sont dans la liste platform.admin de getRequiredOpsPermission', gateRx.test(opsSource));
  ok('handler deleteClient cable sur la lib avec body.id', /if \(action === 'deleteClient'\)[\s\S]{0,200}deleteClient\(getPool\(\), \{ id: body\.id \}\)/.test(opsSource));
  ok('handler deleteCenter cable sur la lib avec body.id', /if \(action === 'deleteCenter'\)[\s\S]{0,300}deleteCenter\(pool, \{ id: body\.id \}\)/.test(opsSource));

  console.log('\n[H] contre-preuves par MUTATION : le gate sait rougir, restauration inverse');
  async function withLibMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(platformClientsPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`platform-delete-check: ancre introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(platformClientsPath, original.replace(anchor, replacement));
    let holds = true;
    try {
      holds = await probe(freshPlatformClients());
    } finally {
      fs.writeFileSync(platformClientsPath, original);
    }
    if (holds) {
      console.error(`platform-delete-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(`mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`, true);
    const restored = await probe(freshPlatformClients());
    ok(`restauration inverse "${label}" : l'invariant tient de nouveau`, restored);
  }

  // L'invariant tient quand le refus baseline SE PRODUIT (erreur exposee, zero ecriture).
  const probeBaseline = async (mod) => {
    const p = makePool({ centers: ['libramont'] });
    const e = await captureError(() => mod.deleteCenter(p, { id: 'libramont' }));
    return Boolean(e && e.expose === true) && writes(p.log).length === 0;
  };
  await withLibMutation(
    'if (BASELINE_CENTER_IDS.has(centerId)) {',
    'if (false) {',
    probeBaseline,
    'garde baseline neutralisee : un centre fichier deviendrait supprimable',
  );

  // L'invariant tient quand un centre avec reservations est refuse sans ecriture.
  const probeReservations = async (mod) => {
    const p = makePool({ centers: ['mi-12'], reservations: 3 });
    const e = await captureError(() => mod.deleteCenter(p, { id: 'mi-12' }));
    return Boolean(e && e.expose === true) && writes(p.log).length === 0;
  };
  await withLibMutation(
    'if (reservationCount > 0) {',
    'if (false) {',
    probeReservations,
    'garde reservations neutralisee : les donnees metier partiraient en silence',
  );

  // L'invariant tient quand un client avec centres est BLOQUE sans ecriture.
  const probeClientBlocked = async (mod) => {
    const p = makePool({ clients: ['lac'], clientCenters: 2 });
    const e = await captureError(() => mod.deleteClient(p, { id: 'lac' }));
    return Boolean(e && e.expose === true) && writes(p.log).length === 0;
  };
  await withLibMutation(
    'if (centerCount > 0) {',
    'if (false) {',
    probeClientBlocked,
    'blocage client-avec-centres neutralise : cascade silencieuse possible',
  );

  // Isolation : retirer les deux actions de la liste platform.admin doit faire
  // rougir la sonde [G] (sinon un role de centre pourrait supprimer un client).
  {
    const opsPath = path.join(ROOT, 'api', 'ops.js');
    const original = fs.readFileSync(opsPath, 'utf8');
    const anchor = "'deleteClient', 'deleteCenter', ";
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`platform-delete-check: ancre ops.js introuvable ou ambigue (${occurrences})`);
      process.exit(1);
    }
    fs.writeFileSync(opsPath, original.replace(anchor, ''));
    let holds = true;
    try {
      holds = gateRx.test(fs.readFileSync(opsPath, 'utf8'));
    } finally {
      fs.writeFileSync(opsPath, original);
    }
    if (holds) {
      console.error('platform-delete-check: MUTATION SANS EFFET sur la liste platform.admin');
      process.exit(1);
    }
    ok("mutation \"actions retirees de platform.admin\" : la sonde d'isolation ROUGIRAIT", true);
    ok('restauration inverse ops.js : la liste platform.admin tient de nouveau', gateRx.test(fs.readFileSync(opsPath, 'utf8')));
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nplatform-delete-check: ${passed}/${checks.length} verts.`);
  if (failed.length) { console.error(`platform-delete-check: ECHEC (${failed.length} rouge(s)).`); process.exit(1); }
  console.log('platform-delete-check: ALL OK (suppression gatee platform.admin ; baseline et reservations refusees ; client avec centres bloque ; transaction ordonnee ; contre-preuves par mutation)');
  process.exit(0);
})().catch((e) => { console.error('platform-delete-check: exception', (e && e.stack) || e); process.exit(1); });
