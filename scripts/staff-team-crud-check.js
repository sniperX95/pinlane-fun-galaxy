// Gate CRUD equipe + gardes anti-lockout du controle d'acces staff.
//
// POURQUOI CE GATE. La page "Equipe & acces" gagne quatre mutations sensibles
// (renommer un role, supprimer un role, supprimer un membre) et deux invariants
// anti-lockout appliques COTE SERVEUR (G1 dernier responsable, G2 auto-lockout).
// Une regression sur l'une d'elles est une faille de securite ou une perte
// d'acces irreversible. On prouve donc, sur le VRAI code lib/staff-auth.js :
//   1. renameRole change le nom d'un role custom ; refuse un role verrouille.
//   2. deleteRole custom sans membre : supprime ; avec membres : refuse sans
//      casser la FK ni orpheliner ; role verrouille : refuse.
//   3. deleteMember supprime la ligne (et revoque les sessions).
//   4. G1 : bloquer / retrograder / supprimer le SEUL responsable actif -> refus
//      et AUCUNE ecriture (verifie via le pool mock).
//   5. G2 : agir sur soi-meme (bloquer / retrograder / supprimer) -> refus.
// Puis des CONTRE-PREUVES par mutation : on neutralise chaque garde dans le
// fichier source, on rejoue le scenario dans un process node FRAIS, on constate
// que la mutation PASSE desormais (la garde a bien des dents), et on restaure le
// fichier a l'octet pres (edition inverse exacte).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif, comme scripts/member-role-escalation-check.js. On exerce
// les VRAIES fonctions, jamais des stubs.
//
// Lancement : node scripts/staff-team-crud-check.js

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'lib', 'staff-auth.js');
const CENTER = 'libramont';

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---- Pool mock pilote par un scenario mutable partage ----------------------
// lib/database met en cache une seule instance `new Pool`, donc FakePool est un
// singleton : on change les donnees via l'objet `scenario`, et on journalise
// chaque ecriture pour prouver qu'aucune ne part quand une garde saute.

let scenario = freshScenario();

function freshScenario() {
  return { roles: {}, members: {}, writes: [], queries: [] };
}

function setScenario({ roles = [], members = [] } = {}) {
  scenario = freshScenario();
  roles.forEach((r) => { scenario.roles[r.id] = r; });
  members.forEach((m) => { scenario.members[m.id] = m; });
}

function role(id, { locked = false, permissions = ['dashboard.view'], name = id } = {}) {
  return {
    id,
    center_id: CENTER,
    name,
    code: id.slice(0, 2).toUpperCase(),
    summary: '',
    description: '',
    tone: locked ? 'direction' : 'custom',
    permissions,
    access_code_hint: '',
    access_code_enc: '',
    locked,
    updated_at: new Date().toISOString(),
  };
}

function member(id, roleId, { status = 'active', name = id } = {}) {
  return { id, center_id: CENTER, name, role_id: roleId, status };
}

function isWrite(sql) {
  return /^\s*(insert|update|delete)\b/i.test(sql);
}

function route(sql, params) {
  const s = sql.toLowerCase();

  // --- Ecritures ---
  if (/update staff_roles/.test(s) && /set\s+name/.test(s)) {
    const r = scenario.roles[params[1]];
    if (!r) return { rows: [], rowCount: 0 };
    r.name = params[2];
    return { rows: [{ ...r }], rowCount: 1 };
  }
  if (/delete from staff_roles/.test(s)) {
    const r = scenario.roles[params[1]];
    if (!r) return { rows: [], rowCount: 0 };
    delete scenario.roles[params[1]];
    return { rows: [{ ...r }], rowCount: 1 };
  }
  if (/delete from staff_sessions/.test(s)) {
    return { rows: [], rowCount: 1 };
  }
  if (/delete from staff_members/.test(s)) {
    const m = scenario.members[params[1]];
    if (!m) return { rows: [], rowCount: 0 };
    delete scenario.members[params[1]];
    return { rows: [{ ...m }], rowCount: 1 };
  }
  if (/update staff_members/.test(s) && /set\s+role_id/.test(s)) {
    const m = scenario.members[params[1]] || { id: params[1], center_id: params[0], name: 'Membre' };
    const row = { ...m, center_id: params[0], id: params[1], role_id: params[2], status: m.status === 'blocked' ? 'blocked' : 'pending' };
    scenario.members[params[1]] = row;
    return { rows: [row], rowCount: 1 };
  }
  if (/update staff_members/.test(s) && /set\s+status/.test(s)) {
    const m = scenario.members[params[1]];
    if (!m) return { rows: [], rowCount: 0 };
    m.status = m.status === 'blocked' ? 'active' : 'blocked';
    return { rows: [{ ...m }], rowCount: 1 };
  }
  if (/insert into staff_access_events/.test(s)) {
    return { rows: [], rowCount: 1 };
  }

  // --- Comptes ---
  if (/count\(\*\)/.test(s) && /join staff_roles/.test(s)) {
    const n = Object.values(scenario.members).filter((m) => {
      const r = scenario.roles[m.role_id];
      return m.status === 'active' && r && r.locked === true;
    }).length;
    return { rows: [{ n }], rowCount: 1 };
  }
  if (/count\(\*\)/.test(s) && /from staff_members where center_id = \$1 and role_id = \$2/.test(s)) {
    const n = Object.values(scenario.members).filter((m) => m.role_id === params[1]).length;
    return { rows: [{ n }], rowCount: 1 };
  }

  // --- Lectures ---
  if (/select id, name, role_id, status from staff_members/.test(s)) {
    const m = scenario.members[params[1]];
    return m
      ? { rows: [{ id: m.id, name: m.name, role_id: m.role_id, status: m.status }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/select \* from staff_roles/.test(s) && /id = \$2/.test(s)) {
    const r = scenario.roles[params[1]];
    return r ? { rows: [{ ...r }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // Bootstrap schema / listes / sonde de provisioning : vide plausible.
  return { rows: [], rowCount: 0 };
}

class FakePool {
  async query(text, params = []) {
    const sql = String(text);
    scenario.queries.push(sql);
    if (isWrite(sql)) scenario.writes.push({ sql, params });
    return route(sql, params);
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
// Le bootstrap staff-auth exige des codes d'acces en environnement : on active
// le repli de developpement prevu (refuse en production).
process.env.ALLOW_INSECURE_STAFF_CODES = 'true';

const staffAuth = require(path.join(ROOT, 'lib', 'staff-auth.js'));
const { renameRole, deleteRole, deleteMember, updateMemberRole, toggleMemberStatus, listAccessControl } = staffAuth;

// Execute une mutation en isolant les ecritures : renvoie si elle a ete refusee
// et combien d'ecritures sont parties (0 attendu quand une garde saute).
async function attempt(fn) {
  scenario.writes = [];
  let refused = false;
  let error = null;
  let result = null;
  try {
    result = await fn();
  } catch (e) {
    refused = true;
    error = e;
  }
  return { refused, error, result, wroteCount: scenario.writes.length };
}

// ---- Scenarios de contre-preuve (partages parent/enfant) -------------------
// Chacun rejoue UNE mutation qu'une garde doit refuser. En mode --probe,
// l'enfant sort 0 si REFUSEE (garde presente), 3 si PASSEE (garde absente).

const PROBES = {
  'g1-block': async () => {
    setScenario({ roles: [role('direction', { locked: true }), role('manager')], members: [member(`${CENTER}:dir`, 'direction')] });
    return toggleMemberStatus({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, memberId: `${CENTER}:dir` });
  },
  'g2-self-block': async () => {
    setScenario({ roles: [role('direction', { locked: true }), role('manager')], members: [member(`${CENTER}:dir`, 'direction'), member(`${CENTER}:m1`, 'manager')] });
    return toggleMemberStatus({ centerId: CENTER, actorMemberId: `${CENTER}:m1`, memberId: `${CENTER}:m1` });
  },
  'deleteRole-members': async () => {
    setScenario({ roles: [role('accueil')], members: [member(`${CENTER}:m1`, 'accueil')] });
    return deleteRole({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, roleId: 'accueil' });
  },
  'renameRole-locked': async () => {
    setScenario({ roles: [role('direction', { locked: true })] });
    return renameRole({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, roleId: 'direction', name: 'Renomme' });
  },
};

async function runProbe(id) {
  const probe = PROBES[id];
  if (!probe) {
    console.error(`probe inconnu: ${id}`);
    process.exit(2);
  }
  let refused = false;
  try {
    await probe();
  } catch (e) {
    refused = true;
  }
  // 0 = mutation refusee (garde tient) ; 3 = mutation passee (garde absente).
  process.exit(refused ? 0 : 3);
}

// Chaque contre-preuve : garde, id de probe, et l'edition qui la neutralise
// (chaine unique dans le fichier). find -> replace, restaure a l'octet pres.
const COUNTERPROOFS = [
  {
    label: 'G1 dernier responsable',
    probe: 'g1-block',
    find: '  if (activeLocked <= 1) {',
    replace: '  if (false && activeLocked <= 1) {',
  },
  {
    label: 'G2 auto-lockout',
    probe: 'g2-self-block',
    find: '  if (actorMemberId && memberId && String(actorMemberId) === String(memberId)) {',
    replace: '  if (false && actorMemberId && memberId && String(actorMemberId) === String(memberId)) {',
  },
  {
    label: 'deleteRole refus si membres',
    probe: 'deleteRole-members',
    find: '  if (memberCount > 0) {',
    replace: '  if (false && memberCount > 0) {',
  },
  {
    label: 'renameRole refus si verrouille',
    probe: 'renameRole-locked',
    find: "  if (role.locked) throw new Error('Ce role systeme ne peut pas etre renomme.');",
    replace: "  if (false && role.locked) throw new Error('Ce role systeme ne peut pas etre renomme.');",
  },
];

function probeExit(id) {
  const res = spawnSync(process.execPath, [__filename, '--probe', id], { encoding: 'utf8' });
  return res.status;
}

function runCounterProof(cp) {
  const original = fs.readFileSync(LIB, 'utf8');
  const occurrences = original.split(cp.find).length - 1;
  if (occurrences !== 1) {
    ok(false, `contre-preuve ${cp.label}: ancre introuvable ou ambigue (${occurrences} occurrence(s))`);
    return;
  }
  // Sonde de reference AVANT neutralisation : la garde doit tenir (exit 0).
  const before = probeExit(cp.probe);
  try {
    fs.writeFileSync(LIB, original.replace(cp.find, cp.replace));
    const after = probeExit(cp.probe);
    ok(
      before === 0 && after === 3,
      `contre-preuve ${cp.label}: garde tient (${before === 0 ? 'refus' : 'code ' + before}) puis, neutralisee, la mutation PASSE (${after === 3 ? 'passe' : 'code ' + after})`,
    );
  } finally {
    fs.writeFileSync(LIB, original);
  }
  // Restauration a l'octet pres.
  ok(fs.readFileSync(LIB, 'utf8') === original, `contre-preuve ${cp.label}: fichier restaure a l'identique`);
}

async function main() {
  // Prechauffe le schema une fois : le bootstrap DDL/inserts du mock ne doit pas
  // polluer les assertions "aucune ecriture" (schemaReady memoise ensuite).
  await listAccessControl(CENTER).catch(() => {});

  // (1) renameRole
  setScenario({ roles: [role('accueil', { name: 'Accueil' })] });
  const rename = await attempt(() => renameRole({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, roleId: 'accueil', name: 'Accueil VIP' }));
  ok(!rename.refused && rename.result && rename.result.name === 'Accueil VIP', `renameRole change le nom d'un role custom (recu: ${rename.result && rename.result.name})`);

  setScenario({ roles: [role('direction', { locked: true, name: 'Direction' })] });
  const renameLocked = await attempt(() => renameRole({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, roleId: 'direction', name: 'Pirate' }));
  ok(renameLocked.refused && renameLocked.wroteCount === 0, 'renameRole refuse un role verrouille, aucune ecriture');

  // (2) deleteRole
  setScenario({ roles: [role('accueil')], members: [] });
  const delRoleOk = await attempt(() => deleteRole({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, roleId: 'accueil' }));
  ok(!delRoleOk.refused && !scenario.roles.accueil, 'deleteRole supprime un role custom sans membre');

  setScenario({ roles: [role('accueil')], members: [member(`${CENTER}:m1`, 'accueil')] });
  const delRoleBusy = await attempt(() => deleteRole({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, roleId: 'accueil' }));
  ok(delRoleBusy.refused && delRoleBusy.wroteCount === 0 && scenario.roles.accueil, 'deleteRole refuse un role avec membres (FK preservee, aucune suppression)');

  setScenario({ roles: [role('direction', { locked: true })], members: [] });
  const delRoleLocked = await attempt(() => deleteRole({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, roleId: 'direction' }));
  ok(delRoleLocked.refused && delRoleLocked.wroteCount === 0, 'deleteRole refuse un role verrouille');

  // (3) deleteMember supprime la ligne
  setScenario({
    roles: [role('direction', { locked: true }), role('manager')],
    members: [member(`${CENTER}:dir`, 'direction'), member(`${CENTER}:m1`, 'manager')],
  });
  const delMember = await attempt(() => deleteMember({ centerId: CENTER, actorMemberId: `${CENTER}:dir`, memberId: `${CENTER}:m1` }));
  ok(!delMember.refused && !scenario.members[`${CENTER}:m1`], 'deleteMember supprime la ligne du membre');

  // (4) G1 dernier responsable : bloquer / retrograder / supprimer le seul
  // responsable actif -> refus, aucune ecriture.
  const lastDir = () => setScenario({
    roles: [role('direction', { locked: true }), role('manager')],
    members: [member(`${CENTER}:dir`, 'direction')],
  });
  lastDir();
  const g1Block = await attempt(() => toggleMemberStatus({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, memberId: `${CENTER}:dir` }));
  ok(g1Block.refused && g1Block.wroteCount === 0, 'G1: bloquer le dernier responsable actif -> refus, aucune ecriture');
  lastDir();
  const g1Demote = await attempt(() => updateMemberRole({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, memberId: `${CENTER}:dir`, roleId: 'manager' }));
  ok(g1Demote.refused && g1Demote.wroteCount === 0, 'G1: retrograder le dernier responsable actif -> refus, aucune ecriture');
  lastDir();
  const g1Delete = await attempt(() => deleteMember({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, memberId: `${CENTER}:dir` }));
  ok(g1Delete.refused && g1Delete.wroteCount === 0, 'G1: supprimer le dernier responsable actif -> refus, aucune ecriture');

  // G1 ne doit pas etre trop large : avec DEUX responsables actifs, en
  // retrograder un passe (pas de faux positif).
  setScenario({
    roles: [role('direction', { locked: true }), role('manager')],
    members: [member(`${CENTER}:dir1`, 'direction'), member(`${CENTER}:dir2`, 'direction')],
  });
  const g1Ok = await attempt(() => updateMemberRole({ centerId: CENTER, actorMemberId: `${CENTER}:ghost`, memberId: `${CENTER}:dir1`, roleId: 'manager' }));
  ok(!g1Ok.refused && g1Ok.result && g1Ok.result.member.roleId === 'manager', 'G1: avec deux responsables, en retrograder un PASSE (pas de faux positif)');

  // (5) G2 auto-lockout : agir sur soi-meme -> refus.
  const selfSetup = () => setScenario({
    roles: [role('direction', { locked: true }), role('manager')],
    members: [member(`${CENTER}:dir`, 'direction'), member(`${CENTER}:m1`, 'manager')],
  });
  selfSetup();
  const g2Block = await attempt(() => toggleMemberStatus({ centerId: CENTER, actorMemberId: `${CENTER}:m1`, memberId: `${CENTER}:m1` }));
  ok(g2Block.refused && g2Block.wroteCount === 0, 'G2: se bloquer soi-meme -> refus, aucune ecriture');
  selfSetup();
  const g2Demote = await attempt(() => updateMemberRole({ centerId: CENTER, actorMemberId: `${CENTER}:m1`, memberId: `${CENTER}:m1`, roleId: 'direction' }));
  ok(g2Demote.refused && g2Demote.wroteCount === 0, 'G2: se retrograder / se re-roler soi-meme -> refus, aucune ecriture');
  selfSetup();
  const g2Delete = await attempt(() => deleteMember({ centerId: CENTER, actorMemberId: `${CENTER}:m1`, memberId: `${CENTER}:m1` }));
  ok(g2Delete.refused && g2Delete.wroteCount === 0, 'G2: se supprimer soi-meme -> refus, aucune ecriture');

  // ---- Contre-preuves par mutation (edition inverse exacte) ----------------
  console.log('\ncontre-preuves (neutralisation de garde -> la mutation passe) :');
  for (const cp of COUNTERPROOFS) {
    runCounterProof(cp);
  }

  if (failures) {
    console.error(`\nstaff-team-crud-check: ${failures} echec(s).`);
    process.exit(1);
  }
  console.log('\nstaff-team-crud-check: ALL OK (CRUD equipe + gardes anti-lockout prouves, contre-preuves rouges puis restaurees)');
  process.exit(0);
}

const probeIndex = process.argv.indexOf('--probe');
if (probeIndex !== -1) {
  runProbe(process.argv[probeIndex + 1]).catch((error) => {
    console.error('probe erreur inattendue:', error && (error.stack || error.message));
    process.exit(2);
  });
} else {
  main().catch((error) => {
    console.error('staff-team-crud-check: erreur inattendue:', error && (error.stack || error.message));
    process.exit(1);
  });
}
