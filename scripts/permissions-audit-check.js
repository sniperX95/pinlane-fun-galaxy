// AUDIT DU SYSTEME DE PERMISSIONS (2026-08-19, demande de Movsar apres les
// quatre defauts de la vue Manager : « ameliore toute la logique, test chaque
// permission pour chaque niveau, detecte tous les problemes »).
//
// Ce gate est STATIQUE : il croise les trois endroits ou une permission existe
// et exige qu'ils racontent la meme histoire.
//   1. la DECLARATION      : STAFF_PERMISSION_GROUPS (lib/staff-auth.js)
//   2. l'EXIGENCE SERVEUR  : requireStaffPermission dans api/*.js + la table
//                            action -> permission de api/ops.js (lue, pas recopiee)
//   3. la GARDE CLIENT     : canUseStaffPermission / STAFF_PAGE_PERMISSION_MAP
//
// Les defauts qu'il attrape, tous payes en vrai :
//   - une permission declaree que RIEN n'exige : une case a cocher qui ne fait
//     rien, donc un mensonge dans l'editeur de roles ;
//   - une permission exigee mais JAMAIS declaree : une case impossible a
//     accorder, donc une fonction inatteignable (typo comprise) ;
//   - une page du menu sans permission : elle s'ouvre a tout le monde ;
//   - un role preregle qui porte un droit d'ecriture sans le droit de lecture
//     correspondant : l'ecran est vide et l'action echoue (classe des bugs du
//     Manager) ;
//   - une page ouverte a un role dont les BLOCS appellent des API qu'il n'a pas :
//     exactement « API indisponible » et « Permission insuffisante ».
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  STAFF_PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  STAFF_ROLE_PRESETS,
} = require(path.join(ROOT, 'lib', 'staff-auth.js'));
const { getRequiredOpsPermission } = require(path.join(ROOT, 'api', 'ops.js'));

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// 1. Ce que le SERVEUR exige, releve dans le code lui-meme.
// ---------------------------------------------------------------------------
function serverRequiredPermissions() {
  const found = new Map(); // permission -> [ou]
  const note = (permission, where) => {
    if (!permission || permission === 'platform.admin') return;
    if (!found.has(permission)) found.set(permission, []);
    found.get(permission).push(where);
  };
  // a. les appels directs a requireStaffPermission dans api/*.js
  for (const file of fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'))) {
    const source = readFile(path.join('api', file));
    const calls = source.match(/requireStaffPermission\([^;]*?\)/gs) || [];
    for (const call of calls) {
      for (const hit of call.match(/'[a-z]+\.[a-zA-Z]+'/g) || []) note(hit.replace(/'/g, ''), file);
    }
  }
  // b. la table action -> permission de ops.js, interrogee action par action.
  const opsSource = readFile(path.join('api', 'ops.js'));
  const actions = new Set();
  for (const hit of opsSource.match(/action === '[a-zA-Z]+'/g) || []) actions.add(hit.split("'")[1]);
  for (const hit of opsSource.match(/'[a-zA-Z]+'(?=[,\]\s]*\.includes\(action\))/g) || []) actions.add(hit.replace(/'/g, ''));
  for (const block of opsSource.match(/\[[^\]]*\]\.includes\(action\)/g) || []) {
    for (const hit of block.match(/'[a-zA-Z]+'/g) || []) actions.add(hit.replace(/'/g, ''));
  }
  for (const action of actions) {
    for (const method of ['GET', 'POST']) {
      let required;
      try { required = getRequiredOpsPermission(method, action); } catch (error) { continue; }
      for (const permission of asList(required)) note(permission, `ops:${method}:${action}`);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 2. Ce que le CLIENT verifie.
// ---------------------------------------------------------------------------
function clientCheckedPermissions() {
  const found = new Set();
  const files = ['assets/app-main.js', 'assets/staff-pages-v2.js', 'assets/ops-console.js', 'assets/admin-console.js', 'assets/staff-menu.js'];
  for (const rel of files) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const source = readFile(rel);
    // Toutes les formes de garde cote ecran, pas seulement la plus ancienne :
    // requireClientPermission enveloppe canUseStaffPermission et pose le
    // message de refus. Un scanner qui n en connait qu une declare inertes des
    // permissions parfaitement branchees.
    for (const call of source.match(/(canUseStaffPermission|requireClientPermission)\([^)]*\)/g) || []) {
      for (const hit of call.match(/'[a-z]+\.[a-zA-Z]+'/g) || []) found.add(hit.replace(/'/g, ''));
    }
  }
  // La carte page -> permission du menu compte comme une garde client.
  const appMain = readFile('assets/app-main.js');
  const mapBlock = appMain.split('const STAFF_PAGE_PERMISSION_MAP = {')[1].split('};')[0];
  const pageMap = {};
  for (const line of mapBlock.split('\n')) {
    const match = line.match(/^\s*'?([a-zA-Z-]+)'?\s*:\s*\[([^\]]*)\]/);
    if (!match) continue;
    const perms = (match[2].match(/'[a-z]+\.[a-zA-Z]+'/g) || []).map((p) => p.replace(/'/g, ''));
    pageMap[match[1]] = perms;
    perms.forEach((p) => found.add(p));
  }
  return { found, pageMap };
}

function main() {
  const declared = new Set(ALL_PERMISSIONS);
  const server = serverRequiredPermissions();
  const { found: client, pageMap } = clientCheckedPermissions();

  console.log(`\n[Inventaire] ${declared.size} permissions declarees, ${server.size} exigees par le serveur, ${client.size} verifiees par l ecran`);

  console.log('\n[1. Toute permission declaree SERT a quelque chose]');
  const dead = [...declared].filter((permission) => !server.has(permission) && !client.has(permission));
  ok(dead.length === 0, `aucune case a cocher inerte${dead.length ? ' (' + dead.join(', ') + ')' : ''}`);

  console.log('\n[2. Toute permission exigee est DECLARABLE dans un role]');
  const undeclaredServer = [...server.keys()].filter((permission) => !declared.has(permission));
  ok(undeclaredServer.length === 0, `le serveur n exige rien d inaccordable${undeclaredServer.length ? ' (' + undeclaredServer.map((p) => p + ' <- ' + server.get(p)[0]).join(', ') + ')' : ''}`);
  const undeclaredClient = [...client].filter((permission) => !declared.has(permission) && permission !== 'platform.admin');
  ok(undeclaredClient.length === 0, `l ecran ne teste rien d inaccordable${undeclaredClient.length ? ' (' + undeclaredClient.join(', ') + ')' : ''}`);

  console.log('\n[3. Toute page du menu est gardee par une permission]');
  const menuBlock = readFile('assets/app-main.js').split('const STAFF_MENU_PAGES = [')[1].split('];')[0];
  const menuPages = (menuBlock.match(/'[a-zA-Z-]+'/g) || []).map((p) => p.replace(/'/g, ''));
  const unguarded = menuPages.filter((page) => !pageMap[page] || pageMap[page].length === 0);
  ok(unguarded.length === 0, `${menuPages.length} pages, aucune sans permission${unguarded.length ? ' (' + unguarded.join(', ') + ')' : ''}`);

  console.log('\n[4. Les roles preregles se tiennent debout]');
  // Un droit d'ECRIRE sans le droit de LIRE donne un ecran vide et une action
  // qui echoue : c'est la forme exacte des bugs du Manager.
  const IMPLIES = {
    'reservations.create': 'reservations.view',
    'reservations.edit': 'reservations.view',
    'reservations.cancel': 'reservations.view',
    'reservations.status': 'reservations.view',
    'reservations.quick': 'reservations.view',
    'clients.edit': 'clients.view',
    'payments.markPaid': 'payments.view',
    'emails.send': 'emails.view',
    'planning.bowling': 'planning.view',
    'planning.laser': 'planning.view',
    'planning.drag': 'planning.view',
    'planning.past': 'planning.view',
  };
  for (const role of STAFF_ROLE_PRESETS) {
    const perms = new Set(role.permissions || []);
    const unknown = [...perms].filter((permission) => !declared.has(permission));
    ok(unknown.length === 0, `role « ${role.name} » : aucune permission inconnue${unknown.length ? ' (' + unknown.join(', ') + ')' : ''}`);
    const orphans = [...perms].filter((permission) => IMPLIES[permission] && !perms.has(IMPLIES[permission]));
    ok(orphans.length === 0, `role « ${role.name} » : aucun droit d agir sans le droit de voir${orphans.length ? ' (' + orphans.map((p) => p + ' sans ' + IMPLIES[p]).join(', ') + ')' : ''}`);
  }

  console.log('\n[5. Une page ouverte a un role ne contient pas de bloc qu il ne peut pas charger]');
  // La regle nee des bugs du 2026-08-19 : si une page s'ouvre avec la
  // permission P, tout bloc de cette page qui appelle une API exigeant Q != P
  // doit etre garde cote client par Q. Sinon le role voit un refus brut.
  // Couples verifies ici, chacun corrige ce jour-la.
  const guarded = readFile('assets/staff-pages-v2.js') + readFile('assets/ops-console.js');
  const RULES = [
    { page: 'emails', blockPermission: 'campaigns.manage', marker: "canUseStaffPermission('campaigns.manage')", label: 'bloc Campagnes garde sur la page Emails' },
    { page: 'emails', blockPermission: 'platform.admin', marker: "canUseStaffPermission('platform.admin')", label: 'appel Simulation garde sur la page Emails' },
  ];
  for (const rule of RULES) {
    const opensWith = pageMap[rule.page] || [];
    const needsGuard = !opensWith.includes(rule.blockPermission);
    ok(!needsGuard || guarded.includes(rule.marker), `${rule.label} (page ouverte par ${opensWith.join('/')})`);
  }

  console.log('\n[6. Contre-epreuve : cet audit sait-il rougir ?]');
  const fakeDeclared = new Set(declared);
  fakeDeclared.add('fantome.permission');
  const fakeDead = [...fakeDeclared].filter((permission) => !server.has(permission) && !client.has(permission));
  ok(fakeDead.includes('fantome.permission'), 'une permission inventee est vue comme inerte -> l audit ROUGIRAIT');
  const fakeServer = new Map(server);
  fakeServer.set('typo.permision', ['faux.js']);
  const fakeUndeclared = [...fakeServer.keys()].filter((permission) => !declared.has(permission));
  ok(fakeUndeclared.includes('typo.permision'), 'une exigence non declarable est vue -> l audit ROUGIRAIT');

  if (failures) { console.error(`\npermissions-audit-check: ${failures} echec(s).`); process.exit(1); }
  console.log('\npermissions-audit-check: ALL OK - declaration, serveur et ecran racontent la meme histoire.');
}

main();
