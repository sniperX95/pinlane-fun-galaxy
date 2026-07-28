// Aucune reservation ne vit dans le navigateur.
//
// Demande de Movsar (2026-07-28) : « comment ca local ? il doit rien y avoir en
// local dorenavant, tout doit etre en ligne ». Deux choses le trahissaient :
//   1. l'etat par defaut contenait QUATRE reservations ecrites en dur
//      (« Sophie Renard », « Marc Dubois »...). Sur un poste neuf ou apres un
//      vidage du navigateur, le planning affichait des clients qui n'existent
//      pas - et ils restaient la si le serveur ne repondait pas ;
//   2. save() ecrivait state.reservations dans localStorage. Une copie locale ne
//      sait pas RETIRER une ligne : elle a deja ressuscite des reservations
//      supprimees (journal du 2026-07-27, entrees 23 et 32 - 24 resas fantomes,
//      4 956 EUR affiches sur une base vide). Tant qu'elle existe, la classe de
//      bug revient.
//
// Ce gate execute les VRAIES fonctions du fichier dans un bac a sable : ce qui
// part au stockage, et ce qui revient au chargement.

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

function extractFunction(src, header) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  const match = /\r?\n\}\r?\n/.exec(src.slice(start));
  return match ? src.slice(start, start + match.index + match[0].length) : null;
}

// Bac a sable minimal : localStorage simule, state injecte.
function runStorage(currentState, storedRaw, options) {
  const src = fs.readFileSync(APP, 'utf8'); // relecture : la mutation doit etre vue
  const parts = [
    "const STORAGE_KEY = 'funGalaxy_v4';",
    'const TOTAL_LANES = 8;',
    "function todayStr() { return '2026-07-28'; }",
    // La constante des cles appartenant au serveur est LUE dans le fichier :
    // la recopier ici ferait passer le gate meme si la vraie liste changeait.
    (src.match(/const SERVER_OWNED_STATE_KEYS = \[[^\]]*\];/) || [''])[0],
    extractFunction(src, 'function statePersistablePayload('),
    extractFunction(src, 'function save('),
    extractFunction(src, 'function loadState('),
  ];
  const missing = parts.findIndex((part) => !part);
  if (missing >= 0) throw new Error(`bloc introuvable dans app-main.js (index ${missing})`);
  const store = new Map();
  if (storedRaw !== undefined) store.set('funGalaxy_v4', storedRaw);
  const sandbox = {
    state: currentState,
    window: {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    written: null,
    restored: null,
  };
  vm.createContext(sandbox);
  // skipSave : pour le cas MIGRATION, on ne doit pas ecraser le stockage legacy
  // avant de le relire - sinon le gate testerait son propre save() au lieu de la
  // reprise d un poste deja ouvert.
  const script = (options && options.skipSave)
    ? 'restored = loadState();'
    : 'save();\nwritten = localStorage.getItem(STORAGE_KEY);\nrestored = loadState();';
  vm.runInContext(`${parts.filter(Boolean).join('\n')}\n${script}`, sandbox);
  return { written: sandbox.written ? JSON.parse(sandbox.written) : null, restored: sandbox.restored };
}

// ===========================================================================
console.log('[1] Ce qui part dans le navigateur');
// ===========================================================================
const withData = {
  view: 'staff',
  staffTheme: 'dark',
  currentDate: '2026-07-28',
  reservations: [{ id: 1, name: 'Client reel', date: '2026-07-28', price: 120 }],
  laneStatuses: { 1: 'maintenance' },
  booking: { name: 'brouillon client', pax: 4 },
};
const first = runStorage(withData);
ok(Array.isArray(first.written.reservations) === false && first.written.reservations === undefined,
  'aucune reservation ecrite dans le stockage local');
ok(first.written.laneStatuses === undefined,
  'aucun etat de piste ecrit dans le stockage local (le serveur les sert)');
ok(first.written.staffTheme === 'dark' && first.written.currentDate === '2026-07-28',
  'les preferences d affichage restent, elles : theme et date');
ok(first.written.booking && first.written.booking.name === 'brouillon client',
  'le brouillon de reservation du client survit (il est a LUI, pas au serveur)');

// ===========================================================================
console.log('\n[2] Ce qui revient au chargement');
// ===========================================================================
// Poste deja ouvert AVANT ce changement : son stockage contient encore des
// reservations. Elles ne doivent pas remonter a l ecran.
const legacy = JSON.stringify({
  view: 'staff',
  staffTheme: 'light',
  reservations: [{ id: 99, name: 'Fantome du cache', date: '2026-07-28', price: 500 }],
  laneStatuses: { 3: 'maintenance' },
});
const migrated = runStorage(withData, legacy, { skipSave: true });
ok(Array.isArray(migrated.restored.reservations) && migrated.restored.reservations.length === 0,
  `un cache legacy ne ressuscite aucune reservation (obtenu ${migrated.restored.reservations.length})`);
ok(migrated.restored.staffTheme === 'light',
  'les preferences du poste sont conservees a la migration');
ok(Object.values(migrated.restored.laneStatuses || {}).every((status) => status === 'active'),
  'les pistes repartent actives, le serveur dira le reste');

// ===========================================================================
console.log('\n[3] Aucune reservation de demonstration dans le code');
// ===========================================================================
const source = fs.readFileSync(APP, 'utf8');
const demoNames = ['Sophie Renard', 'Marc Dubois', 'Laura Petit', 'Equipe Delta'];
const found = demoNames.filter((name) => source.includes(`'${name}'`) || source.includes(`"${name}"`));
ok(found.length === 0, `aucun client invente en dur (trouve : ${found.join(', ') || 'aucun'})`);
const fresh = runStorage(withData, null);
ok(Array.isArray(fresh.restored.reservations) && fresh.restored.reservations.length === 0,
  'poste neuf : le planning demarre VIDE, pas avec des clients fictifs');

// ===========================================================================
console.log('\n[4] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const original = fs.readFileSync(APP, 'utf8');
const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
const anchor = toFileEol("const SERVER_OWNED_STATE_KEYS = ['reservations', 'laneStatuses'];");
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue');
} else {
  fs.writeFileSync(APP, original.replace(anchor, toFileEol('const SERVER_OWNED_STATE_KEYS = [];')));
  let leaked = false;
  try {
    leaked = Array.isArray(runStorage(withData).written.reservations);
  } finally {
    fs.writeFileSync(APP, original); // restauration par edition inverse
  }
  ok(leaked, 'filtre neutralise : les reservations repartent dans le stockage -> le gate ROUGIRAIT');
  ok(runStorage(withData).written.reservations === undefined,
    'restauration inverse : le stockage redevient propre');
}

if (failures) {
  console.error(`\nno-local-reservations-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nno-local-reservations-check: ALL OK - les reservations vivent en ligne, le navigateur ne garde que des preferences.');
