// Roles staff : le SERVEUR fait autorite sur la liste, et les presets des deux
// cotes portent les memes identifiants.
//
// Incident (2026-07-27, remonte par Movsar) : la page « Equipe & acces » de Fun
// Galaxy affichait DEUX roles « Technique ». L'un d'eux etait intouchable - ni
// suppression, ni renommage, ni modification de permission : le serveur
// repondait « Role introuvable ».
//
// Cause : ensureStaffAccessControl fusionnait les presets LOCAUX avec la liste
// du serveur par id. Le preset local 'maintenance' n'ayant aucun equivalent en
// base (le serveur, lui, connait 'technique'), il survivait a la fusion et
// s'affichait comme un role a part entiere. Un role qui n'existe que dans le
// navigateur ne peut par definition pas etre modifie cote serveur.
//
// Le meme ecart cassait le bouton de preset « Technique » sur TOUS les roles :
// le client envoyait presetId='maintenance', le serveur repondait « Preset
// introuvable ».
//
// Ce gate execute la VRAIE fonction du fichier dans un bac a sable, sans
// navigateur et sans base.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const APP = path.join(root, 'assets/app-main.js');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Extrait une declaration de haut niveau jusqu'a sa fermeture en colonne 0.
// Insensible au style de fin de ligne (le repo vit en CRLF sur Windows).
function extractBlock(src, header, closing) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  const match = new RegExp(`\\r?\\n${closing}\\r?\\n`).exec(src.slice(start));
  return match ? src.slice(start, start + match.index + match[0].length) : null;
}

// Bac a sable : uniquement ce dont ensureStaffAccessControl a besoin.
function runEnsure(currentAccessControl) {
  const src = fs.readFileSync(APP, 'utf8'); // relecture : la mutation doit etre vue
  const parts = [
    extractBlock(src, 'const STAFF_PERMISSION_GROUPS = [', '\\];'),
    extractBlock(src, 'const STAFF_ROLE_PRESETS = [', '\\];'),
    extractBlock(src, 'function createStaffAccessCode(', '\\}'),
    extractBlock(src, 'function cloneStaffRolePreset(', '\\}'),
    extractBlock(src, 'function isPlatformStaffRole(', '\\}'),
    extractBlock(src, 'function ensureStaffAccessControl(', '\\}'),
  ];
  const missing = parts.findIndex(part => !part);
  if (missing >= 0) throw new Error(`bloc introuvable dans app-main.js (index ${missing})`);
  const sandbox = { state: { staffAccessControl: currentAccessControl }, out: null };
  vm.createContext(sandbox);
  vm.runInContext(`${parts.join('\n')}\nout = ensureStaffAccessControl();`, sandbox);
  return sandbox.out;
}

const serverRole = (id, name, permissions = ['dashboard.view']) => ({
  id, name, code: id.slice(0, 2).toUpperCase(), summary: 'sur mesure', permissions, locked: false, updatedAt: '2026-07-01T00:00:00.000Z',
});

// ===========================================================================
console.log('[1] Le serveur fait autorite : aucun role fantome');
// ===========================================================================

// Le cas exact de l'incident : le serveur ne connait PAS de role 'maintenance'.
const fromServer = runEnsure({
  selectedRoleId: 'direction',
  roles: [serverRole('direction', 'Direction'), serverRole('manager', 'Manager'), serverRole('technique', 'Technique')],
  members: [{ id: 'm1', name: 'Rachel', roleId: 'direction', status: 'active' }],
});
ok(fromServer.roles.length === 3,
  `la liste affichee vaut exactement celle du serveur (obtenu ${fromServer.roles.length}, attendu 3 : ${fromServer.roles.map(r => r.id).join(', ')})`);
ok(!fromServer.roles.some(role => role.id === 'maintenance'),
  'aucun role local ne s ajoute a la liste du serveur');

// Un role qui n'est PAS un preset (cree par le client) doit evidemment rester.
const custom = runEnsure({ roles: [serverRole('accueil-2', 'Accueil samedi')], members: [] });
ok(custom.roles.length === 1 && custom.roles[0].id === 'accueil-2',
  'un role sur mesure du serveur est conserve tel quel');

// Repli hors ligne / premiere ouverture : sans reponse serveur, les presets
// restent la, sinon la page serait vide.
const offline = runEnsure({});
ok(offline.roles.length > 0, `sans liste serveur, les presets servent de repli (${offline.roles.length} roles)`);
ok(offline.roles.some(role => role.id === 'direction'), 'le repli contient bien Direction');

// La selection ne doit pas designer un role disparu.
ok(fromServer.roles.some(role => role.id === fromServer.selectedRoleId),
  `le role selectionne existe dans la liste (${fromServer.selectedRoleId})`);

// ===========================================================================
console.log('\n[2] Les presets client et serveur portent les MEMES ids');
// ===========================================================================
const serverPresets = require(path.join(root, 'lib', 'staff-auth')).STAFF_ROLE_PRESETS;
const clientBlock = extractBlock(fs.readFileSync(APP, 'utf8'), 'const STAFF_ROLE_PRESETS = [', '\\];');
const clientIds = [...clientBlock.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]);
const serverIds = serverPresets.map(preset => preset.id);
const orphans = clientIds.filter(id => !serverIds.includes(id));
ok(orphans.length === 0,
  `aucun preset client sans equivalent serveur (orphelins : ${orphans.join(', ') || 'aucun'})`);
ok(serverIds.every(id => clientIds.includes(id)),
  `tout preset serveur a son bouton cote client (manquants : ${serverIds.filter(id => !clientIds.includes(id)).join(', ') || 'aucun'})`);

// ===========================================================================
console.log('\n[3] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const original = fs.readFileSync(APP, 'utf8');
const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));

// 3a : on retablit la fusion d'avant (presets ajoutes a la liste serveur).
const anchorA = toFileEol("  const roles = serverRoles.length\n    ? serverRoles.map(role => {");
const mutationA = toFileEol("  const roles = [].length\n    ? serverRoles.map(role => {");
if ((original.split(anchorA).length - 1) !== 1) {
  ok(false, 'ancre de mutation [3a] introuvable ou ambigue');
} else {
  fs.writeFileSync(APP, original.replace(anchorA, mutationA));
  let phantomBack = false;
  try {
    const mutated = runEnsure({ roles: [serverRole('direction', 'Direction')], members: [] });
    phantomBack = mutated.roles.length > 1;
  } finally {
    fs.writeFileSync(APP, original); // restauration par edition inverse
  }
  ok(phantomBack, 'fusion retablie : des roles locaux reapparaissent -> le gate ROUGIRAIT');
  const restored = runEnsure({ roles: [serverRole('direction', 'Direction')], members: [] });
  ok(restored.roles.length === 1, 'restauration inverse : la liste redevient celle du serveur');
}

// 3b : on desaligne un id de preset client.
const anchorB = toFileEol("    id: 'technique',\n    name: 'Technique',\n    code: 'TE',\n    summary: 'Accès maintenance',");
const mutationB = toFileEol("    id: 'maintenance',\n    name: 'Technique',\n    code: 'TE',\n    summary: 'Accès maintenance',");
if ((original.split(anchorB).length - 1) !== 1) {
  ok(false, 'ancre de mutation [3b] introuvable ou ambigue');
} else {
  fs.writeFileSync(APP, original.replace(anchorB, mutationB));
  let detected = false;
  try {
    const block = extractBlock(fs.readFileSync(APP, 'utf8'), 'const STAFF_ROLE_PRESETS = [', '\\];');
    const ids = [...block.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]);
    detected = ids.some(id => !serverIds.includes(id));
  } finally {
    fs.writeFileSync(APP, original);
  }
  ok(detected, "id de preset desaligne : detecte -> le gate ROUGIRAIT");
}

if (failures) {
  console.error(`\nstaff-roles-source-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nstaff-roles-source-check: ALL OK - la liste des roles vient du serveur, les presets sont alignes.');
