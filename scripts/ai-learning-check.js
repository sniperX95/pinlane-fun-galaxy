// La page « Apprentissage de l'IA » : reservee a la plateforme, et honnete.
//
// Demande de Movsar (2026-07-28) : « j'aimerais pour moi cote admin uniquement
// un truc ou je peux voir l'evolution de l'IA integree, son apprentissage ».
// Deux choses doivent tenir dans le temps :
//
//   1. « cote admin uniquement » est une regle de SERVEUR. Cacher l'entree de
//      menu ne protege rien : l'action reste appelable par lien direct. Ce gate
//      verifie que api/ops.js exige platform.admin sur `aiLearning`, et que la
//      page est declaree platform.admin cote UI (les deux, pas l'un ou l'autre).
//   2. La page doit dire ce qu'elle NE SAIT PAS. L'apprentissage par les
//      resultats demande des publications mesurees ; tant qu'il n'y en a pas,
//      un tableau de bord d'IA qui affiche quand meme des courbes ment. Le
//      lecteur (lib/marketing-learning.js) doit donc marquer `measurement.empty`
//      et la page doit rendre un etat vide EXPLIQUE.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

const OPS = path.join(root, 'api/ops.js');
const APP = path.join(root, 'assets/app-main.js');
const COCKPIT = path.join(root, 'assets/founder-cockpit.js');
const LIB = path.join(root, 'lib/marketing-learning.js');

// ===========================================================================
console.log('[1] Le serveur exige platform.admin');
// ===========================================================================
const ops = fs.readFileSync(OPS, 'utf8');
const permLine = ops.match(/if \(action === 'aiLearning'\) return '([^']+)';/);
ok(Boolean(permLine), 'api/ops.js declare une permission pour aiLearning');
ok(permLine && permLine[1] === 'platform.admin', `la permission est platform.admin (lue : ${permLine ? permLine[1] : 'aucune'})`);
ok(/if \(action === 'aiLearning'\) \{/.test(ops), 'api/ops.js sert bien l action aiLearning');

// ===========================================================================
console.log('\n[2] L UI declare la page au meme niveau');
// ===========================================================================
const app = fs.readFileSync(APP, 'utf8');
const uiPerm = app.match(/'cockpit-ia': \[([^\]]+)\]/);
ok(Boolean(uiPerm), 'app-main.js declare les permissions de la page cockpit-ia');
ok(uiPerm && uiPerm[1].includes('platform.admin'), 'la page cockpit-ia exige platform.admin');
ok(/'cockpit-ia',/.test(app), 'cockpit-ia est une page connue (deep-link resolu, pas de retombee sur planning)');

// ===========================================================================
console.log('\n[3] Le lecteur distingue ce qui est APPRIS de ce qui est pose');
// ===========================================================================
const { isLearned, readEvidence } = require(LIB);
ok(isLearned('observed_sortie_locale', {}) === true,
  'un critere prefixe observed_ est compte comme appris');
ok(isLearned('center_truth', { signalType: '' }) === false,
  'un critere de depart sans signal n est PAS compte comme appris');
ok(isLearned('center_truth', { signalType: 'seed' }) === false,
  'un signal seed reste un critere de depart');
ok(isLearned('center_truth', { signalType: 'strategy_seed' }) === true,
  'un critere revu depuis une observation terrain est compte comme appris');
const evidence = readEvidence('{"source":"internal_playbook","signalType":"strategy_seed","keywords":["a","b"]}');
ok(evidence.source === 'internal_playbook' && evidence.keywords.length === 2,
  'l evidence JSON est lue (source + mots-cles)');
ok(readEvidence('pas du json').source === '',
  'une evidence illisible ne fait pas tomber la lecture');

// ===========================================================================
console.log('\n[4] L etat vide de l apprentissage par resultats est EXPLIQUE');
// ===========================================================================
const cockpit = fs.readFileSync(COCKPIT, 'utf8');
const emptyBlock = cockpit.slice(cockpit.indexOf('function renderIaMeasurement'), cockpit.indexOf('function renderIaGrid'));
ok(emptyBlock.includes('measurement.empty'), 'le rendu teste measurement.empty');
ok(/aucune proposition n\\?'a encore été publiée/.test(emptyBlock),
  'l etat vide dit POURQUOI il est vide (aucune publication mesuree)');
ok(emptyBlock.includes('14 jours'), 'il rappelle la condition de deblocage (la mesure a 14 jours)');
const lib = fs.readFileSync(LIB, 'utf8');
ok(/empty: rows\.length === 0 && armRows\.length === 0/.test(lib),
  'le lecteur marque empty quand les deux tables d apprentissage sont vides');

// ===========================================================================
console.log('\n[5] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const original = fs.readFileSync(OPS, 'utf8');
const anchor = "if (action === 'aiLearning') return 'platform.admin';";
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue dans api/ops.js');
} else {
  fs.writeFileSync(OPS, original.replace(anchor, "if (action === 'aiLearning') return 'dashboard.view';"));
  let downgraded = false;
  try {
    const mutated = fs.readFileSync(OPS, 'utf8').match(/if \(action === 'aiLearning'\) return '([^']+)';/);
    downgraded = Boolean(mutated) && mutated[1] !== 'platform.admin';
  } finally {
    fs.writeFileSync(OPS, original); // restauration par edition inverse
  }
  ok(downgraded, 'permission abaissee a dashboard.view : le gate ROUGIRAIT');
  const restored = fs.readFileSync(OPS, 'utf8').match(/if \(action === 'aiLearning'\) return '([^']+)';/);
  ok(restored && restored[1] === 'platform.admin', 'restauration inverse : platform.admin est revenu');
}

if (failures) {
  console.error(`\nai-learning-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nai-learning-check: ALL OK - lecture reservee a la plateforme, et ce qui manque est nomme.');
