// La Simulation rush est un outil ADMIN DU SAAS, pas une fonction client.
//
// Contexte (2026-07-27) : Movsar a ouvert le site a Seb (gerant de Fun Galaxy)
// et a des testeurs exterieurs. La Simulation rush cree de VRAIES lignes dans
// la table reservations (channel sim-*) : elle gonfle le CA, peut declencher
// des messages, et n'a aucun sens pour un client. Elle doit rester reservee au
// proprietaire de la plateforme.
//
// Les gardes EXISTENT deja (api/simulation.js exige platform.admin ; les
// onglets ne sont rendus que pour platform.admin ; setOpsTab refuse l'appel
// direct ; stripPlatformPermissions empeche l'auto-attribution). Ce gate ne les
// ajoute pas : il les VERROUILLE. Tous les autres gates du repo mockent une
// session platform.admin, donc ils prouvent que le PROPRIETAIRE a acces - aucun
// ne prouve que le CLIENT ne l'a pas. C'est ce sens-la qui protege Movsar.
//
// Methode : comportemental partout ou la fonction est isolable (on execute la
// vraie fonction avec un contexte sans platform.admin), statique et structurel
// sinon, et contre-preuves par MUTATION pour prouver que ce gate sait rougir.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ===========================================================================
console.log('[1] SERVEUR : aucun verbe porteur de donnees sans platform.admin');
// ===========================================================================
const apiRel = 'api/simulation.js';
const apiSrc = read(apiRel);

// Chaque branche de verbe doit porter sa propre exigence. Compter globalement
// laisserait passer un verbe ajoute plus tard sans garde.
for (const verb of ['GET', 'POST']) {
  const start = apiSrc.indexOf(`req.method === '${verb}'`);
  if (start === -1) { ok(false, `branche ${verb} introuvable dans ${apiRel}`); continue; }
  const slice = apiSrc.slice(start, start + 400);
  ok(/requireStaffPermission\([^)]*'platform\.admin'/.test(slice),
    `${verb} exige platform.admin avant de servir quoi que ce soit`);
  ok(/if\s*\(!session\)\s*return/.test(slice),
    `${verb} sort immediatement si la session est refusee (pas de suite d'execution)`);
}

// Un verbe non traite ne doit pas tomber dans un fourre-tout permissif.
const handledVerbs = (apiSrc.match(/req\.method === '(GET|POST|PUT|PATCH|DELETE)'/g) || []).length;
ok(handledVerbs >= 2, `les verbes de donnees sont traites explicitement (obtenu ${handledVerbs})`);
ok(!/requireStaffPermission\([^)]*'(dashboard|direction|reservations|settings)\.[a-z]+'/.test(apiSrc),
  'aucune permission de niveau CENTRE ne suffit pour entrer dans api/simulation');

// ===========================================================================
console.log('\n[2] ATTRIBUTION : un client ne peut pas devenir proprietaire');
// ===========================================================================
const staffAuth = require(path.join(root, 'lib/staff-auth.js'));
const strip = staffAuth.__test && staffAuth.__test.stripPlatformPermissions;

ok(typeof strip === 'function', 'stripPlatformPermissions est atteignable pour etre testee');

// Comportemental : on passe la permission convoitee, elle doit disparaitre.
const stripped = strip(['reservations.view', 'platform.admin', 'users.manage']);
ok(!stripped.includes('platform.admin'),
  'stripPlatformPermissions retire platform.admin d une demande de role');
ok(stripped.includes('reservations.view') && stripped.includes('users.manage'),
  'stripPlatformPermissions ne retire QUE le niveau plateforme (pas de degat collateral)');

// Tester la fonction ne suffit pas : elle doit etre APPLIQUEE a chaque point
// d'ecriture de role. Une seule ecriture qui l'oublie rouvre l'escalade.
const authSrc = read('lib/staff-auth.js');
for (const [fn, marker] of [['createRole', 'async function createRole'], ['updateRolePermissions', 'async function updateRolePermissions']]) {
  const start = authSrc.indexOf(marker);
  if (start === -1) { ok(false, `${fn} introuvable dans lib/staff-auth.js`); continue; }
  const bodyEnd = authSrc.indexOf('\nasync function ', start + marker.length);
  const body = authSrc.slice(start, bodyEnd === -1 ? start + 4000 : bodyEnd);
  ok(body.includes('stripPlatformPermissions('),
    `${fn} passe les permissions demandees par stripPlatformPermissions`);
}

// Le raccourci role.locked (Direction) confere ALL_PERMISSIONS : si
// platform.admin y entrait, toute directrice de centre deviendrait proprietaire.
const all = staffAuth.ALL_PERMISSIONS || [];
ok(Array.isArray(all) && all.length > 0, `ALL_PERMISSIONS est peuple (obtenu ${all.length})`);
ok(!all.includes('platform.admin'),
  'platform.admin est HORS de ALL_PERMISSIONS : le role Direction ne l herite jamais');

// L editeur de roles ne doit pas la proposer : sinon un porteur de users.manage
// se la coche lui-meme.
const founderAdmin = read('lib/founder-admin.js');
const catalogEntry = founderAdmin.match(/'platform\.admin':[^\n]*/);
ok(!!catalogEntry, 'platform.admin est bien decrite dans le catalogue de permissions');
ok(/assignable:\s*false/.test(founderAdmin) || /NON[- ]assignable/i.test(founderAdmin),
  'le catalogue marque platform.admin comme non assignable');

// ===========================================================================
console.log('\n[3] FRONT : sans platform.admin, aucune surface de simulation');
// ===========================================================================
const consoleRel = 'assets/admin-console.js';
const consoleSrc = read(consoleRel);

// -- 3a. COMPORTEMENTAL : on execute le vrai setOpsTab dans un bac a sable ou
//        canUseStaffPermission repond NON, et on tente l'appel direct.
function runSetOpsTab({ isOwner, requested }) {
  // RELECTURE a chaque appel, pas la copie chargee au demarrage : sinon la
  // sonde de mutation evaluerait l ancien texte et le gate se declarerait
  // capable de rougir sans l etre. (Detecte par sa propre contre-preuve.)
  const live = read(consoleRel);
  const fnSrc = live.slice(live.indexOf('function setOpsTab(tab)'));
  const body = fnSrc.slice(0, fnSrc.indexOf('\n}\n') + 3);
  const sandbox = {
    state: { opsPanelTab: 'activity' },
    save() {},
    renderOpsAdmin() {},
    loadOpsSimulationStatus() { sandbox.loaded = true; },
    canUseStaffPermission: (perm) => (perm === 'platform.admin' ? isOwner : true),
    isAdminPlatformOwner: () => isOwner,
    loaded: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${body}\nsetOpsTab(${JSON.stringify(requested)});`, sandbox);
  return { tab: sandbox.state.opsPanelTab, loaded: sandbox.loaded };
}

const asClient = runSetOpsTab({ isOwner: false, requested: 'simulation' });
ok(asClient.tab === 'activity',
  `appel direct setOpsTab('simulation') sans platform.admin -> retombe sur "${asClient.tab}" (attendu activity)`);
ok(asClient.loaded === false,
  'aucun chargement de l etat de simulation n est declenche pour un client');

const clientStack = runSetOpsTab({ isOwner: false, requested: 'stack' });
ok(clientStack.tab === 'activity', 'meme refus pour l onglet Stack IA (outillage plateforme)');

const asOwner = runSetOpsTab({ isOwner: true, requested: 'simulation' });
ok(asOwner.tab === 'simulation',
  'le proprietaire, lui, atteint bien la Simulation rush (le gate ne casse pas l outil)');
ok(asOwner.loaded === true, 'et son etat de simulation est charge');

// -- 3b. STRUCTUREL : les boutons vivent dans la branche gardee, pas ailleurs.
const renderStart = consoleSrc.indexOf('function renderAdminOpsPanel()');
const renderSrc = consoleSrc.slice(renderStart, renderStart + 1200);
const guardIdx = renderSrc.indexOf('isAdminPlatformOwner()');
const simIdx = renderSrc.indexOf('opsTabSimulation');
ok(guardIdx !== -1 && simIdx !== -1 && guardIdx < simIdx,
  'le bouton Simulation rush est rendu APRES la garde isAdminPlatformOwner, dans sa branche');
ok(/isAdminPlatformOwner\(\)\s*\n?\s*\?/.test(renderSrc),
  'la garde est un ternaire : sans platform.admin la branche entiere vaut chaine vide');

// Nulle part ailleurs dans la console : un second point d'entree non garde
// annulerait tout le reste.
const simButtons = (consoleSrc.match(/opsTabSimulation/g) || []).length;
ok(simButtons <= 2, `le bouton Simulation n a pas de point d entree parallele (${simButtons} occurrence(s))`);

// ===========================================================================
console.log('\n[4] CONTRE-PREUVES par MUTATION (ce gate sait-il rougir ?)');
// ===========================================================================
// Les ancres sont ecrites en \n mais les fichiers vivent en CRLF sur Windows :
// sans normalisation l ancre est introuvable et le gate rougirait pour une
// raison etrangere au code teste.
function toFileEol(text, original) {
  return original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}

function withMutation(relative, rawAnchor, rawReplacement, probe, label) {
  const abs = path.join(root, relative);
  const original = fs.readFileSync(abs, 'utf8');
  const anchor = toFileEol(rawAnchor, original);
  const replacement = toFileEol(rawReplacement, original);
  const count = original.split(anchor).length - 1;
  if (count !== 1) {
    ok(false, `ancre de mutation introuvable ou ambigue (${count}) : ${label}`);
    return;
  }
  fs.writeFileSync(abs, original.replace(anchor, replacement));
  let stillHolds = true;
  try {
    stillHolds = probe(fs.readFileSync(abs, 'utf8'));
  } finally {
    fs.writeFileSync(abs, original); // restauration par EDITION INVERSE
  }
  ok(!stillHolds, `mutation "${label}" : l invariant est viole, le gate ROUGIRAIT`);
  ok(probe(fs.readFileSync(abs, 'utf8')) === true, `restauration inverse "${label}" : l invariant tient de nouveau`);
}

// Sonde serveur : si on abaisse la permission du GET, le bloc 1 doit tomber.
withMutation(
  apiRel,
  "requireStaffPermission(req, res, 'platform.admin', { centerId: requestedCenterId });\n      if (!session) return;\n      await handleGet",
  "requireStaffPermission(req, res, 'direction.view', { centerId: requestedCenterId });\n      if (!session) return;\n      await handleGet",
  (src) => {
    const start = src.indexOf("req.method === 'GET'");
    return /requireStaffPermission\([^)]*'platform\.admin'/.test(src.slice(start, start + 400));
  },
  'permission du GET abaissee de platform.admin a direction.view',
);

// Sonde front : si la garde de setOpsTab saute, l appel direct doit passer.
withMutation(
  consoleRel,
  "state.opsPanelTab = platformTabs.includes(tab) && isAdminPlatformOwner() ? tab : 'activity';",
  "state.opsPanelTab = platformTabs.includes(tab) ? tab : 'activity';",
  () => runSetOpsTab({ isOwner: false, requested: 'simulation' }).tab === 'activity',
  'garde isAdminPlatformOwner retiree de setOpsTab (appel direct)',
);

if (failures) {
  console.error(`\nsimulation-access-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nsimulation-access-check: ALL OK - la Simulation rush reste au proprietaire de la plateforme.');
