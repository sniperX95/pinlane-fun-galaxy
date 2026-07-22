// Gate d'ISOLATION MULTI-TENANT sur la LISTE des centres (fuite inter-clients).
//
// Le trou corrige : un client (Fun Galaxy : libramont/gembloux/ciney) voyait
// AUSSI les centres d'un AUTRE client (ex. mi-12) dans le switcher du menu ET
// dans les chips de la page Etablissement. Deux sources cote serveur servaient
// une liste NON scopee : l'action `knowledge` (baseline fichier) consommee par
// le switcher, et l'action `centerConfig` (listCenterConfigs = TOUS les centres
// DB). Le correctif introduit lib/center-scope.listCentersForSession, qui filtre
// la liste au client de la session SERVEUR, et cable les deux actions dessus,
// plus une action dediee `menuCenters` pour le switcher.
//
// Ce que ce gate PROUVE, sur le VRAI helper (pas un stub) :
//   1. Session CLIENT (fungalaxy, PAS platform.admin) -> UNIQUEMENT ses centres,
//      JAMAIS mi-12 ni un centre orphelin ni un autre client.
//   2. Session PROPRIETAIRE (platform.admin) -> TOUS les centres, chacun avec
//      clientId + clientName (mi-12 et orphelin presents), pour le groupement.
//   3. Session client d'un AUTRE client -> uniquement les siens (isolation croisee).
//   4. Centre orphelin (client_id null) -> visible seulement du proprietaire.
//   5. Contre-preuve de non-regression : requireStaffPermission garde toujours
//      le refus 403 de scope centre, et les DEUX actions (menuCenters/knowledge
//      + centerConfig) sont bien cablees sur listCentersForSession(pool, session).
//
// Le faux pool renvoie la liste COMPLETE non filtree : le filtrage est fait par
// le VRAI helper. Neutraliser le filtre client dans lib/center-scope.js fait
// donc ROUGIR le point 1 (le client verrait mi-12) ; neutraliser la garde
// platform.admin fait ROUGIR le contraste proprietaire/client. Contre-preuves
// par mutation + restauration inverse (documentees, executees a la main).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache avant tout
// require applicatif ; le helper recoit de toute facon le pool en parametre.
// Lancement : node scripts/center-tenant-isolation-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// -- Univers de test : deux clients + un centre orphelin -----------------------
// La liste COMPLETE que la DB renverrait. Le helper doit la filtrer par tenant.
const ALL_CENTER_ROWS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'mi-12', name: 'MI-12', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'mi-12-client', client_name: 'MI-12 SARL' },
  { id: 'namur-bowl', name: 'Namur Bowl', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'mi-12-client', client_name: 'MI-12 SARL' },
  { id: 'orphan-1', name: 'Centre Orphelin', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: null, client_name: null },
];

const sqlLog = [];

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    sqlLog.push({ sql, params });
    // La requete de scope : centres joints a clients. Le faux moteur renvoie la
    // liste COMPLETE non filtree (le filtrage est la responsabilite du helper).
    // nullif(client_id,'') -> deja null/valeur dans nos fixtures, on reflete tel quel.
    if (/from\s+centers\b/i.test(sql) && /left\s+join\s+clients\b/i.test(sql)) {
      return { rows: ALL_CENTER_ROWS.map((row) => ({ ...row })), rowCount: ALL_CENTER_ROWS.length };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

const { listCentersForSession } = require(path.join(ROOT, 'lib', 'center-scope.js'));

function readProjectFile(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

// Sessions plausibles. sessionHasPermission (lib/staff-auth) ne concede
// platform.admin QUE si la session la porte explicitement (jamais via role
// verrouille) : c'est cette semantique reelle qu'on exerce.
const CLIENT_SESSION = {
  centerId: 'libramont',
  role: { id: 'direction', name: 'Direction', locked: true },
  permissions: ['dashboard.view', 'direction.view', 'centers.switch', 'settings.manage', 'users.manage'],
};
const OTHER_CLIENT_SESSION = {
  centerId: 'mi-12',
  role: { id: 'direction', name: 'Direction', locked: true },
  permissions: ['dashboard.view', 'direction.view', 'centers.switch', 'settings.manage'],
};
const ORPHAN_SESSION = {
  centerId: 'orphan-1',
  role: { id: 'manager', name: 'Manager', locked: false },
  permissions: ['dashboard.view', 'settings.manage'],
};
const OWNER_SESSION = {
  centerId: 'libramont',
  role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
  permissions: ['dashboard.view', 'direction.view', 'centers.switch', 'settings.manage', 'users.manage', 'platform.admin'],
};

function ids(list) { return list.map((c) => c.id).sort(); }

(async () => {
  // -- [1] CLIENT Fun Galaxy : UNIQUEMENT ses centres --------------------------
  console.log('[1] Session CLIENT (fungalaxy, libramont, sans platform.admin)');
  const clientCenters = await listCentersForSession(new FakePool(), CLIENT_SESSION);
  const clientIds = ids(clientCenters);
  ok(JSON.stringify(clientIds) === JSON.stringify(['ciney', 'gembloux', 'libramont']),
    `le client ne voit QUE ses 3 centres fungalaxy (obtenu ${JSON.stringify(clientIds)})`);
  ok(!clientCenters.some((c) => c.id === 'mi-12' || c.id === 'namur-bowl'),
    'le client ne voit JAMAIS les centres d un autre client (mi-12 / namur-bowl)');
  ok(!clientCenters.some((c) => c.id === 'orphan-1'),
    'le client ne voit JAMAIS un centre orphelin (client_id null)');
  ok(clientCenters.every((c) => c.clientId === 'fungalaxy'),
    'chaque centre rendu porte bien le clientId de la session (fungalaxy)');

  // -- [2] PROPRIETAIRE : TOUS les centres, groupables par client --------------
  console.log('\n[2] Session PROPRIETAIRE (platform.admin)');
  const ownerCenters = await listCentersForSession(new FakePool(), OWNER_SESSION);
  const ownerIds = ids(ownerCenters);
  ok(ownerIds.length === ALL_CENTER_ROWS.length,
    `le proprietaire voit TOUS les centres (${ownerIds.length}/${ALL_CENTER_ROWS.length})`);
  ok(ownerCenters.some((c) => c.id === 'mi-12' && c.clientId === 'mi-12-client' && c.clientName === 'MI-12 SARL'),
    'mi-12 present avec clientId + clientName (groupement possible)');
  ok(ownerCenters.some((c) => c.id === 'orphan-1' && c.clientId === null),
    'le centre orphelin est visible du proprietaire (clientId null)');
  const distinctClients = new Set(ownerCenters.map((c) => c.clientId || ''));
  ok(distinctClients.size >= 3,
    `plusieurs clients presents pour declencher le groupement (obtenu ${distinctClients.size})`);

  // -- [3] Isolation CROISEE : client d un AUTRE client ------------------------
  console.log('\n[3] Session CLIENT de mi-12-client (isolation croisee)');
  const otherCenters = await listCentersForSession(new FakePool(), OTHER_CLIENT_SESSION);
  const otherIds = ids(otherCenters);
  ok(JSON.stringify(otherIds) === JSON.stringify(['mi-12', 'namur-bowl']),
    `mi-12-client ne voit QUE ses centres (obtenu ${JSON.stringify(otherIds)})`);
  ok(!otherCenters.some((c) => ['libramont', 'gembloux', 'ciney'].includes(c.id)),
    'mi-12-client ne voit JAMAIS les centres fungalaxy');

  // -- [4] Centre ORPHELIN : visible seulement du proprietaire -----------------
  console.log('\n[4] Centre orphelin (client_id null)');
  const orphanCenters = await listCentersForSession(new FakePool(), ORPHAN_SESSION);
  const orphanIds = ids(orphanCenters);
  ok(JSON.stringify(orphanIds) === JSON.stringify(['orphan-1']),
    `une session dont le centre est orphelin ne voit QUE son centre (obtenu ${JSON.stringify(orphanIds)})`);
  ok(!orphanCenters.some((c) => ['libramont', 'mi-12'].includes(c.id)),
    'une session orpheline ne voit ni fungalaxy ni un autre client');
  ok(!clientCenters.some((c) => c.id === 'orphan-1') && ownerCenters.some((c) => c.id === 'orphan-1'),
    'l orphelin n apparait chez AUCUN client mais bien chez le proprietaire (contraste)');

  // -- [5] CABLAGE + non-regression du refus de scope centre -------------------
  console.log('\n[5] Cablage serveur + garde de scope centre');
  const opsSource = readProjectFile('api/ops.js');
  // Les DEUX actions doivent tirer leur liste du helper scope, avec la SESSION
  // serveur (jamais une valeur du client). Une regression qui rebrancherait
  // centerConfig sur listCenterConfigs (tous les centres) ferait rougir ici.
  ok(/if \(action === 'centerConfig'\)/.test(opsSource) &&
     /const centers = await listCentersForSession\(pool, session\);/.test(opsSource),
    'centerConfig est cable sur listCentersForSession(pool, session)');
  ok(/if \(action === 'menuCenters'\)/.test(opsSource) &&
     /listCentersForSession\(getPool\(\), options\.session\)/.test(opsSource),
    'l action switcher menuCenters est cablee sur listCentersForSession(session)');
  ok(/if \(action === 'knowledge'\)[\s\S]{0,600}listCentersForSession\(getPool\(\), options\.session\)/.test(opsSource),
    'l action knowledge scope aussi sa liste centers (defense en profondeur)');
  ok(!/const centers = await listCenterConfigs\(pool\);/.test(opsSource),
    'centerConfig ne sert plus la liste NON scopee listCenterConfigs(pool)');

  // La garde de scope centre de requireStaffPermission (refus 403 inter-centres)
  // ne doit pas avoir ete affaiblie : une resa/action forgee sur un centre hors
  // du client reste refusee sans centers.switch.
  const authSource = readProjectFile('lib/staff-auth.js');
  ok(/requestedCenterId !== session\.centerId[\s\S]{0,120}sessionHasPermission\(session, 'centers\.switch'\)/.test(authSource) &&
     /sendError\(res, 403, 'Acces centre insuffisant\.'\)/.test(authSource),
    'requireStaffPermission garde toujours le refus 403 de scope centre (non-regression)');

  if (failures) {
    console.error(`\ncenter-tenant-isolation-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ncenter-tenant-isolation-check: ALL OK');
})().catch((error) => {
  console.error('center-tenant-isolation-check: exception', error && (error.stack || error.message || error));
  process.exit(1);
});
