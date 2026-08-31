// LES CONSTANTES DE RESERVATION EXISTENT EN DOUBLE : ELLES DOIVENT DIRE PAREIL.
//
// lib/booking-config.js (le serveur, qui facture et planifie) et
// assets/booking-core.js (le navigateur, qui affiche et estime) declarent DIX-SEPT
// constantes de meme nom : le nombre de pistes, la capacite par piste, la grille
// bowling, les options laser, les formules, les vacances scolaires.
//
// Aucune ne diverge aujourd hui sur un CHIFFRE. Mais rien ne l empechait : une
// piste ajoutee d un cote, un tarif corrige de l autre, et le tunnel vend a un
// prix que le serveur ne pratique pas. C est exactement la classe de defaut qui
// a coute le duckpin sur-reserve et le « 120 EUR devenus 20 » de ce mois-ci.
//
// L ECART CONNU ET VOULU : les accents. lib/catalog-store.js fait de
// « Formules speciales » (sans accent) sa valeur canonique et lib/center-metrics.js
// mappe les libelles de conges sans accent vers leur version accentuee ; le
// navigateur, lui, affiche du francais correct. Les deux cotes se rejoignent par
// pliage d accents, deja documente dans assets/app-main.js (l.14102 et l.23115).
// Ce gate PLIE donc les accents sur les chaines, et reste STRICT sur tout le
// reste : un nombre, un identifiant, une longueur de liste, une structure.
//
// Quatre proprietes :
//   A. La LISTE des constantes en double est celle qu on croit : une nouvelle
//      jumelle ajoutee en silence fait rougir, pour forcer la decision.
//   B. Aucun CHIFFRE ne diverge (prix, capacites, minutes, minPax).
//   C. Aucune STRUCTURE ne diverge (memes ids, memes longueurs, memes cles).
//   D. Les seules differences restantes sont des accents, et on les compte.
//
// Contre-epreuve par mutation : on change TOTAL_LANES dans le navigateur, on
// prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/booking-constants-drift-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'assets/booking-core.js');
const CONFIG = path.join(ROOT, 'lib/booking-config.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

// Les jumelles comparables : meme nom des deux cotes ET exportees par le serveur.
const JUMELLES = [
  'TOTAL_LANES', 'MAX_PER_LANE', 'EMERGENCY_MAX_PER_LANE', 'PAIRS',
  'LASER_GAME_ARENA_MINUTES', 'BOWLING_PRICES', 'LASER_GAME_MAX_PLAYERS',
  'LASER_GAME_OPTIONS', 'FUN_RUN_OPTIONS', 'FUN_RUN_MAX_PAX',
  'DURATION_OPTIONS', 'FORMULES', 'WALLONIA_SCHOOL_HOLIDAYS',
];

function nomsDeclares(source) {
  const noms = new Set();
  const re = /^const ([A-Z][A-Z0-9_]{2,})\s*=/gm;
  let m;
  while ((m = re.exec(source))) noms.add(m[1]);
  return noms;
}

// Le navigateur n exporte rien : on evalue le fichier dans un bac a sable, puis
// on demande les constantes par une expression (un `const` de haut niveau ne se
// pose pas sur l objet de contexte).
function constantesDuNavigateur() {
  const source = fs.readFileSync(CORE, 'utf8');
  const bac = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, __out: null,
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  const collecte = `__out = { ${JUMELLES.map((n) => `'${n}': (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ')} };`;
  vm.runInContext(`${source}\n${collecte}`, bac, { timeout: 20000 });
  return bac.__out;
}

const plieAccents = (valeur) => String(valeur).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Compare en profondeur. Renvoie { chiffres, structures, accents } : les listes
// des chemins fautifs par nature d ecart.
function compare(a, b, chemin, sortie) {
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean' || typeof b === 'boolean') {
    if (a !== b) sortie.chiffres.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
    return;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return;
    if (plieAccents(a) === plieAccents(b)) sortie.accents.push(chemin);
    else sortie.structures.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { sortie.structures.push(`${chemin} : une liste d un seul cote`); return; }
    if (a.length !== b.length) { sortie.structures.push(`${chemin} : ${a.length} elements cote serveur, ${b.length} cote navigateur`); return; }
    a.forEach((item, index) => compare(item, b[index], `${chemin}[${index}]`, sortie));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const manquantes = cles.filter((cle) => !(cle in a) || !(cle in b));
    if (manquantes.length) { sortie.structures.push(`${chemin} : cles absentes d un cote (${manquantes.join(', ')})`); return; }
    cles.forEach((cle) => compare(a[cle], b[cle], `${chemin}.${cle}`, sortie));
    return;
  }
  if (a !== b) sortie.structures.push(`${chemin} : serveur=${JSON.stringify(a)} navigateur=${JSON.stringify(b)}`);
}

function main() {
  const serveur = require(CONFIG);
  const navigateur = constantesDuNavigateur();

  // --- A. La liste des jumelles n a pas grossi en silence -----------------
  const nomsServeur = nomsDeclares(fs.readFileSync(CONFIG, 'utf8'));
  const nomsNavigateur = nomsDeclares(fs.readFileSync(CORE, 'utf8'));
  const enDouble = [...nomsServeur].filter((nom) => nomsNavigateur.has(nom));
  const comparables = enDouble.filter((nom) => serveur[nom] !== undefined);
  const nouvelles = comparables.filter((nom) => !JUMELLES.includes(nom));
  ok(nouvelles.length === 0,
    `aucune jumelle comparable ajoutee sans decision (${enDouble.length} noms en double, ${comparables.length} comparables${nouvelles.length ? `, NOUVELLES : ${nouvelles.join(', ')}` : ''})`);
  const disparues = JUMELLES.filter((nom) => !comparables.includes(nom));
  ok(disparues.length === 0,
    `les jumelles connues sont toujours la (${disparues.join(', ') || 'toutes presentes'})`);

  // --- B, C, D. Aucun chiffre, aucune structure ; les accents, on les compte
  const sortie = { chiffres: [], structures: [], accents: [] };
  for (const nom of JUMELLES) {
    if (serveur[nom] === undefined || navigateur[nom] === undefined) {
      ok(false, `${nom} : illisible d un cote (serveur=${serveur[nom] === undefined ? 'absent' : 'ok'}, navigateur=${navigateur[nom] === undefined ? 'absent' : 'ok'})`);
      continue;
    }
    compare(serveur[nom], navigateur[nom], nom, sortie);
  }

  ok(sortie.chiffres.length === 0,
    `aucun CHIFFRE ne diverge entre le serveur et le navigateur (${sortie.chiffres.slice(0, 4).join(' | ') || 'zero ecart'})`);
  ok(sortie.structures.length === 0,
    `aucune STRUCTURE ne diverge (${sortie.structures.slice(0, 4).join(' | ') || 'zero ecart'})`);
  console.log(`  (${sortie.accents.length} libelles ne different que par les accents : ecart connu, plie par lib/catalog-store.js et lib/center-metrics.js)`);

  if (failures) {
    console.error(`\nbooking-constants-drift-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nbooking-constants-drift-check: ALL OK (les deux copies disent le meme prix et la meme capacite)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(CORE, 'utf8');
  const marqueur = 'const TOTAL_LANES = 8;';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : TOTAL_LANES est introuvable dans assets/booking-core.js');
    process.exit(1);
  }
  // Une neuvieme piste cote navigateur, aucune cote serveur : le tunnel vendrait
  // une piste qui n existe pas.
  const mute = source.replace(marqueur, 'const TOTAL_LANES = 9;');
  fs.writeFileSync(CORE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(CORE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec 9 pistes d un cote et 8 de l autre.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : une piste de plus dans le navigateur fait rougir le gate.');
  process.exit(0);
}

main();
