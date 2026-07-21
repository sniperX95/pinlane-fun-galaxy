// Gate du PANNEAU DE CONTROLE FONDATEUR (lib/founder-admin.js) : les deux
// lecteurs cross-centres, prouves en COMPORTEMENT.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif (meme motif que scripts/founder-cockpit-check.js). Le faux
// pool OBEIT AU TEXTE SQL sur les fixtures : un filtre retire du code (annulees,
// fenetre 30 j, exclusion simulation) retire son effet dans le faux pool, et
// l'assertion rougit. On execute les VRAIS builders sur le faux pool, aucune
// fonction n'est stubbee.
//
// CE QUE CE GATE PROUVE, chaque point contre-eprouve par MUTATION (edition
// inverse, jamais git checkout) :
//   (a) buildFounderCenters rend TOUS les centres de la fixture (pas seulement
//       libramont), chacun avec un config ROUND-TRIPPABLE : les cles attendues
//       sont presentes et normalizeCenterConfig(config, id) redonne le meme
//       objet (idempotent), donc le front peut le renvoyer tel quel a
//       saveCenterConfig. Le statut vient de la config, un override est
//       fusionne, un marqueur horaire texte est preserve.
//   (b) la volumetrie 30 j est MESUREE : les annulees, les lignes hors fenetre
//       et les lignes de SIMULATION ne comptent pas dans reservations30d /
//       revenue30d ; membres = comptes actifs par centre.
//   (c) buildFounderTeam compte EXACTEMENT les membres par role, expose le
//       catalogue de permissions (toutes les permissions assignables), marque
//       platform.admin NON assignable, et NE contient AUCUN hash ni code en
//       clair (scan de motifs sur le JSON serialise + absence du marqueur ENC
//       de la fixture).
//
// Lancement : node scripts/founder-admin-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const isoAgo = (ms) => new Date(NOW - ms).toISOString();

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

// Quatre centres de la table centers. 'namur' n'existe PAS dans la baseline
// fichier (ops-knowledge/centers.json) : il prouve que la config retombe sur
// le defaut generique tout en restant round-trippable. gembloux porte un
// OVERRIDE (settings.config.resources.laser.weaponCount = 25) : il prouve que
// l'override est fusionne. namur porte un override de statut : il prouve que le
// statut affiche vient de la config, pas de la colonne brute.
const CENTER_ROWS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: { config: { resources: { laser: { weaponCount: 25 } } } } },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', timezone: 'Europe/Brussels', settings: null },
  { id: 'namur', name: 'Fun Galaxy Namur', status: 'active', timezone: 'Europe/Brussels', settings: { config: { status: 'planned' } } },
];

// Membres. Le marqueur SECRET-ENC-* dans access_code_enc est le PIEGE du scan :
// si un builder renvoyait la colonne chiffree, il apparaitrait dans le JSON.
// libramont : 3 actifs (direction, accueil, proprietaire) + 1 bloque (ancien).
// gembloux : 1 actif sans code copiable (access_code_enc null -> hasCode false).
const MEMBER_ROWS = [
  { id: 'libramont:demo-direction', center_id: 'libramont', name: 'Directrice Demo', role_id: 'direction', status: 'active', access_code_enc: 'SECRET-ENC-libramont-direction' },
  { id: 'libramont:accueil', center_id: 'libramont', name: 'Accueil', role_id: 'manager', status: 'active', access_code_enc: 'SECRET-ENC-libramont-accueil' },
  { id: 'libramont:ancien', center_id: 'libramont', name: 'Ancien', role_id: 'manager', status: 'blocked', access_code_enc: 'SECRET-ENC-libramont-ancien' },
  { id: 'libramont:platform-owner', center_id: 'libramont', name: 'Proprietaire plateforme', role_id: 'platform-owner', status: 'active', access_code_enc: 'SECRET-ENC-libramont-owner' },
  { id: 'gembloux:staff-1', center_id: 'gembloux', name: 'Staff Un', role_id: 'staff-bar', status: 'active', access_code_enc: null },
];

// Roles. platform-owner porte platform.admin dans ses permissions (c'est le
// role qui l'a) : cela ne doit PAS declencher le scan de secret (permission,
// pas cle) et le catalogue le marque tout de meme non assignable.
const ROLE_ROWS = [
  { center_id: 'libramont', id: 'direction', name: 'Direction', permissions: ['dashboard.view', 'users.manage'], locked: true },
  { center_id: 'libramont', id: 'manager', name: 'Manager', permissions: ['dashboard.view', 'reservations.view'], locked: false },
  { center_id: 'libramont', id: 'platform-owner', name: 'Proprietaire plateforme', permissions: ['dashboard.view', 'platform.admin'], locked: true },
  { center_id: 'gembloux', id: 'staff-bar', name: 'Staff bar', permissions: ['dashboard.view'], locked: false },
];

// Evenements d'acces : login_success pour deux membres, plus un evenement d'un
// AUTRE type (piege du filtre event_type).
const ACCESS_EVENTS = [
  { actor_member_id: 'libramont:demo-direction', event_type: 'login_success', at: NOW - 1 * DAY },
  { actor_member_id: 'libramont:demo-direction', event_type: 'login_success', at: NOW - 9 * DAY },
  { actor_member_id: 'libramont:accueil', event_type: 'login_success', at: NOW - 5 * DAY },
  { actor_member_id: 'libramont:accueil', event_type: 'login_failed', at: NOW - 1 * DAY },
];

// Reservations. libramont attendu : 2 resa, 150 EUR de CA (100 + 50). Les
// pieges : une annulee (999), une hors fenetre a 45 j (777) et une de
// SIMULATION (channel sim-staff, 200) qui ne doivent JAMAIS compter.
// gembloux : 1 resa, 30 EUR.
const RES_ROWS = [
  { center_id: 'libramont', status: 'confirmed', at: NOW - 2 * DAY, price: 100, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 10 * DAY, price: 50, channel: '' },
  { center_id: 'libramont', status: 'cancelled', at: NOW - 3 * DAY, price: 999, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 45 * DAY, price: 777, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 1 * DAY, price: 200, channel: 'sim-staff' },
  { center_id: 'gembloux', status: 'confirmed', at: NOW - 4 * DAY, price: 30, channel: '' },
];

// ---------------------------------------------------------------------------
// Evaluateurs : la partie du faux pool qui OBEIT au texte SQL. Un filtre absent
// de la requete recue ne s'applique pas.
// ---------------------------------------------------------------------------
function activeMemberCountRows(sql) {
  let rows = MEMBER_ROWS.slice();
  if (/status = 'active'/.test(sql)) rows = rows.filter((r) => r.status === 'active');
  const map = new Map();
  rows.forEach((r) => map.set(r.center_id, (map.get(r.center_id) || 0) + 1));
  return [...map.entries()].map(([center_id, active]) => ({ center_id, active }));
}

function reservationVolumeRows(sql) {
  let rows = RES_ROWS.slice();
  if (/status <> 'cancelled'/.test(sql)) rows = rows.filter((r) => r.status !== 'cancelled');
  if (/interval '30 days'/.test(sql)) rows = rows.filter((r) => r.at > NOW - 30 * DAY);
  if (/not in \('sim-client', 'sim-staff'\)/.test(sql)) {
    rows = rows.filter((r) => r.channel !== 'sim-client' && r.channel !== 'sim-staff');
  }
  const map = new Map();
  rows.forEach((r) => {
    const entry = map.get(r.center_id) || { center_id: r.center_id, reservations: 0, revenue: 0 };
    entry.reservations += 1;
    entry.revenue += r.price;
    map.set(r.center_id, entry);
  });
  return [...map.values()];
}

function loginRows(sql) {
  let rows = ACCESS_EVENTS.slice();
  if (/event_type = 'login_success'/.test(sql)) rows = rows.filter((r) => r.event_type === 'login_success');
  const map = new Map();
  rows.forEach((r) => {
    const cur = map.get(r.actor_member_id);
    if (cur === undefined || r.at > cur) map.set(r.actor_member_id, r.at);
  });
  return [...map.entries()].map(([actor_member_id, at]) => ({ actor_member_id, last_login: new Date(at).toISOString() }));
}

function fakeRowsFor(sql) {
  if (/from centers/i.test(sql)) {
    // buildFounderCenters demande les settings ; buildFounderTeam non.
    return /settings/i.test(sql)
      ? CENTER_ROWS.map((row) => ({ ...row }))
      : CENTER_ROWS.map((row) => ({ id: row.id, name: row.name }));
  }
  if (/from staff_members/i.test(sql) && /as active/i.test(sql)) return activeMemberCountRows(sql);
  if (/from staff_members/i.test(sql)) return MEMBER_ROWS.map((row) => ({ ...row }));
  if (/from reservations/i.test(sql)) return reservationVolumeRows(sql);
  if (/from staff_roles/i.test(sql)) return ROLE_ROWS.map((row) => ({ ...row, permissions: row.permissions.slice() }));
  if (/from staff_access_events/i.test(sql)) return loginRows(sql);
  return [];
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text) {
    return { rows: fakeRowsFor(String(text)) || [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t) => self.query(t), release() {} };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';

// center-config est pur (aucune base) : on l'utilise pour PROUVER le round-trip.
const { normalizeCenterConfig } = require(path.join(ROOT, 'lib', 'center-config'));
const { ALL_PERMISSIONS } = require(path.join(ROOT, 'lib', 'staff-auth'));

const founderAdminPath = path.join(ROOT, 'lib', 'founder-admin.js');
function freshFounderAdmin() {
  delete require.cache[require.resolve(founderAdminPath)];
  return require(founderAdminPath);
}

const CONFIG_REQUIRED_KEYS = [
  'status', 'timezone', 'resources', 'activityAvailability',
  'holidaySettings', 'offerAvailability', 'classification', 'customActivities',
];

const SECRET_PATTERNS = [
  /access_code/i, /accessCode/, /_hash/i, /token_hash/i,
  /SECRET-ENC/, /sk-[a-zA-Z0-9]{8}/, /re_[a-zA-Z0-9]{8}/, /postgres:\/\//i,
];

// Sondes reutilisees par les sections vertes ET par la contre-preuve par
// mutation : chacune repond "l'invariant tient-il ?" sur le VRAI comportement.
async function probeReservationHonesty(mod) {
  const bundle = await mod.buildFounderCenters();
  const libr = (bundle.centers || []).find((c) => c.id === 'libramont') || {};
  return libr.reservations30d === 2 && libr.revenue30d === 150;
}

async function probeMemberCount(mod) {
  const bundle = await mod.buildFounderTeam();
  const manager = (bundle.roles || []).find((r) => r.centerId === 'libramont' && r.id === 'manager') || {};
  return manager.memberCount === 2;
}

async function probePlatformNotAssignable(mod) {
  const bundle = await mod.buildFounderTeam();
  const entry = (bundle.permissionsCatalog || []).find((p) => p.key === 'platform.admin');
  return Boolean(entry) && entry.assignable === false;
}

(async () => {
  const mod = freshFounderAdmin();

  // =========================================================================
  console.log('[A] buildFounderCenters : tous les centres, config round-trippable');
  // =========================================================================
  const centersBundle = await mod.buildFounderCenters();
  ok(centersBundle && centersBundle.ok === true && centersBundle.testData === true
    && !Number.isNaN(Date.parse(centersBundle.generatedAt)),
  'envelope { ok, generatedAt, testData:true } sur buildFounderCenters');
  ok(centersBundle.resourceModel && centersBundle.resourceModel.resources
    && centersBundle.resourceModel.resources.bowling
    && centersBundle.resourceModel.resources.bowling.fields.laneCount.max === 40
    && centersBundle.resourceModel.defaultSchedule
    && Array.isArray(centersBundle.resourceModel.defaultSchedule.blocks),
  'resourceModel decrit resources (bornes) et defaultSchedule (contrat de champs)');

  const centers = centersBundle.centers || [];
  ok(centers.length === 4, `les 4 centres de la fixture ressortent (obtenu ${centers.length})`);
  const byId = new Map(centers.map((c) => [c.id, c]));
  ok(['libramont', 'gembloux', 'ciney', 'namur'].every((id) => byId.has(id)),
    'chaque id de la table centers est present (pas seulement libramont)');

  // Round-trip + cles attendues sur CHAQUE centre.
  let roundTripHolds = true;
  let keysHold = true;
  for (const center of centers) {
    if (!CONFIG_REQUIRED_KEYS.every((key) => key in center.config)) keysHold = false;
    const renormalized = normalizeCenterConfig(center.config, center.id);
    if (JSON.stringify(renormalized) !== JSON.stringify(center.config)) roundTripHolds = false;
  }
  ok(keysHold, `chaque config porte les cles editables attendues (${CONFIG_REQUIRED_KEYS.join(', ')})`);
  ok(roundTripHolds,
    'config ROUND-TRIPPABLE : normalizeCenterConfig(config, id) redonne le meme objet (le front peut le renvoyer a saveCenterConfig)');

  const libr = byId.get('libramont');
  const gemb = byId.get('gembloux');
  const namur = byId.get('namur');
  ok(libr.config.defaultSchedule && typeof libr.config.defaultSchedule === 'object'
    && libr.config.defaultSchedule.regular && libr.config.defaultSchedule.regular['6'],
  'libramont : la grille horaire jour par jour est une config editable (bloc regular, jour 6 pose)');
  ok(gemb.config.defaultSchedule === 'same_as_libramont_public_schedule',
    'gembloux : le marqueur horaire TEXTE est preserve tel quel (non transforme en grille)');
  ok(gemb.config.resources.laser && gemb.config.resources.laser.weaponCount === 25,
    `gembloux : l override settings.config est FUSIONNE (laser.weaponCount = ${gemb.config.resources.laser && gemb.config.resources.laser.weaponCount}, attendu 25)`);
  ok(namur.status === 'planned' && !('defaultSchedule' in namur.config),
    'namur (hors baseline) : statut issu de la config (planned), aucune grille horaire posee, config quand meme valide');

  // =========================================================================
  console.log('\n[B] buildFounderCenters : volumetrie 30 j mesuree, simulation exclue');
  // =========================================================================
  ok(libr.reservations30d === 2 && libr.revenue30d === 150,
    `libramont : ${libr.reservations30d} resa / ${libr.revenue30d} EUR sur 30 j (attendu 2 / 150 : annulee, 45 j et simulation exclues)`);
  ok(gemb.reservations30d === 1 && gemb.revenue30d === 30,
    `gembloux : ${gemb.reservations30d} resa / ${gemb.revenue30d} EUR (attendu 1 / 30)`);
  const ciney = byId.get('ciney');
  ok(ciney.reservations30d === 0 && ciney.revenue30d === 0 && ciney.members === 0,
    'ciney : aucune activite (zeros francs, pas de fuite d un autre centre)');
  ok(libr.members === 3 && gemb.members === 1,
    `membres actifs : libramont ${libr.members}, gembloux ${gemb.members} (le bloque d libramont ne compte pas ; attendu 3 et 1)`);

  // =========================================================================
  console.log('\n[C] buildFounderTeam : comptes par role, catalogue, aucun secret');
  // =========================================================================
  const teamBundle = await mod.buildFounderTeam();
  ok(teamBundle && teamBundle.ok === true && teamBundle.testData === true
    && !Number.isNaN(Date.parse(teamBundle.generatedAt)),
  'envelope { ok, generatedAt, testData:true } sur buildFounderTeam');

  const roles = teamBundle.roles || [];
  const roleByKey = new Map(roles.map((r) => [`${r.centerId}|${r.id}`, r]));
  const direction = roleByKey.get('libramont|direction') || {};
  const manager = roleByKey.get('libramont|manager') || {};
  const owner = roleByKey.get('libramont|platform-owner') || {};
  const staffBar = roleByKey.get('gembloux|staff-bar') || {};
  ok(direction.memberCount === 1 && manager.memberCount === 2 && owner.memberCount === 1 && staffBar.memberCount === 1,
    `membres par role EXACTS : direction ${direction.memberCount}, manager ${manager.memberCount}, platform-owner ${owner.memberCount}, staff-bar ${staffBar.memberCount} (attendu 1, 2, 1, 1)`);
  ok(direction.locked === true && manager.locked === false,
    'le verrou du role est expose (direction verrouillee, manager non)');

  const members = teamBundle.members || [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const ancien = memberById.get('libramont:ancien') || {};
  const accueil = memberById.get('libramont:accueil') || {};
  const gembStaff = memberById.get('gembloux:staff-1') || {};
  ok(ancien.status === 'disabled' && accueil.status === 'active',
    `le statut est mappe (bloque -> disabled : ${ancien.status} ; actif -> active : ${accueil.status})`);
  ok(accueil.roleName === 'Manager',
    `le membre porte le nom de son role (accueil -> ${accueil.roleName})`);
  ok(memberById.get('libramont:demo-direction').lastLoginAt === isoAgo(1 * DAY),
    'lastLoginAt = derniere connexion REELLE (login_success le plus recent, pas un echec)');
  ok(gembStaff.lastLoginAt === null,
    'un membre jamais connecte a lastLoginAt null (pas un faux zero de date)');
  ok(accueil.hasCode === true && gembStaff.hasCode === false,
    `hasCode = booleen derive de la version chiffree, jamais la valeur (accueil ${accueil.hasCode}, gembloux ${gembStaff.hasCode})`);

  const catalog = teamBundle.permissionsCatalog || [];
  const catalogKeys = new Set(catalog.map((p) => p.key));
  ok(ALL_PERMISSIONS.every((key) => catalogKeys.has(key)),
    `le catalogue couvre TOUTES les permissions assignables (${ALL_PERMISSIONS.length} attendues)`);
  ok(catalog.every((p) => p.key && p.label && p.group && typeof p.assignable === 'boolean'),
    'chaque entree du catalogue porte key, label FR, group et assignable');
  const platformEntry = catalog.find((p) => p.key === 'platform.admin');
  ok(platformEntry && platformEntry.assignable === false,
    'platform.admin est LISTE mais marque NON assignable (escalade centre -> plateforme)');
  ok(catalog.filter((p) => p.assignable).every((p) => p.key !== 'platform.admin'),
    'aucune entree assignable ne porte platform.admin');

  // Aucun secret nulle part dans le JSON complet des deux bundles.
  const teamSerialized = JSON.stringify(teamBundle);
  const centersSerialized = JSON.stringify(centersBundle);
  const leakedTeam = SECRET_PATTERNS.filter((rx) => rx.test(teamSerialized));
  const leakedCenters = SECRET_PATTERNS.filter((rx) => rx.test(centersSerialized));
  ok(leakedTeam.length === 0,
    `aucun motif de secret dans buildFounderTeam${leakedTeam.length ? ` (fuite: ${leakedTeam.join(', ')})` : ''}`);
  ok(leakedCenters.length === 0,
    `aucun motif de secret dans buildFounderCenters${leakedCenters.length ? ` (fuite: ${leakedCenters.join(', ')})` : ''}`);
  ok(!teamSerialized.includes('SECRET-ENC'),
    'le marqueur ENC des fixtures n apparait PAS : la colonne chiffree n est jamais serialisee');

  // =========================================================================
  console.log('\n[D] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
  // =========================================================================
  async function withMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(founderAdminPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`founder-admin-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`founder-admin-check: la mutation n'a rien change au fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(founderAdminPath, mutated);
    let holds = true;
    try {
      holds = await probe(freshFounderAdmin());
    } finally {
      fs.writeFileSync(founderAdminPath, original);
    }
    if (holds) {
      console.error(`founder-admin-check: MUTATION SANS EFFET, le gate ne sait pas rougir sur ce point : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    const restoredHolds = await probe(freshFounderAdmin());
    ok(restoredHolds, `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  // Exclusion simulation retiree du CA/comptes 30 j -> la ligne sim-staff (200)
  // recompte -> libramont passe a 3 resa / 350 EUR.
  await withMutation(
    'and ${simulationSqlExclusion()}',
    'and 1 = 1',
    probeReservationHonesty,
    'exclusion de la simulation retiree de la volumetrie 30 j',
  );

  // Compte des membres par role casse (incrementation neutralisee) -> tous les
  // memberCount tombent a 0.
  await withMutation(
    '(memberCountByRole.get(key) || 0) + 1',
    '(memberCountByRole.get(key) || 0) + 0',
    probeMemberCount,
    'compte des membres par role neutralise',
  );

  // platform.admin bascule en assignable -> escalade proposable a l attribution.
  await withMutation(
    'group: \'Plateforme\', assignable: false',
    'group: \'Plateforme\', assignable: true',
    probePlatformNotAssignable,
    'platform.admin repasse assignable (garde d escalade inversee)',
  );

  if (failures) {
    console.error(`\nfounder-admin-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nfounder-admin-check: ALL OK');
})().catch((error) => {
  console.error('founder-admin-check: exception', error);
  process.exit(1);
});
