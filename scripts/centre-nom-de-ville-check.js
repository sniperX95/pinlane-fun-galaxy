// UN NOM DE VILLE N EST PAS UN CENTRE (2026-11-17, avant-lancement D4).
//
// normalizeStaffCenterId rangeait chez Fun Galaxy tout identifiant qui CONTENAIT « gembloux », « ciney »
// ou « libramont » : le personnel d un « bowling-gembloux » se connectait sur le centre d un autre client
// (ou pas du tout), et la console lisait et signait ses donnees avec le centre de Fun Galaxy.
//
// [S] LE SERVEUR (lib/staff-auth.js, la vraie fonction exportee) : les formes de Fun Galaxy (la ville seule,
//     la ville avec « Fun Galaxy », Libramont-Chevigny, « Fun Galaxy Centre », admin, pinlane) menent
//     toujours a leur centre ; un autre centre dont l identifiant contient une de ces villes passe tel quel.
// [C] LA CONSOLE (assets/app-main.js, la fonction lue dans le fichier) : la meme regle, et le meme verdict
//     que le serveur sur chaque cas.
//
// Les contre-preuves chargent le code mute en memoire : aucun fichier n est ecrit.
// Lancement : node scripts/centre-nom-de-ville-check.js [--contre-preuves]

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
['DATABASE_URL', 'POSTGRES_URL'].forEach((cle) => { delete process.env[cle]; });

const ANCIENNE_REGLE = "  if (['libramont', 'gembloux', 'ciney'].includes(clean)) return clean;\n  if (clean.includes('gembloux')) return 'gembloux';\n  if (clean.includes('ciney')) return 'ciney';\n  if (clean.includes('libramont')) return 'libramont';\n";
const MUTATIONS = {
  'serveur-ville-contenue': { f: 'lib/staff-auth.js', de: '  const funGalaxy = centreFunGalaxy(clean);\n  if (funGalaxy) return funGalaxy;\n', vers: ANCIENNE_REGLE, lettre: 'S' },
  'serveur-oublie-fun-galaxy': { f: 'lib/staff-auth.js', de: '^(?:(?:fun galaxy|fungalaxy)(?: (?:centre|center))?(?: de)? )?(${VILLES_FUN_GALAXY})$', vers: '^(${VILLES_FUN_GALAXY})$', lettre: 'S' },
  'console-ville-contenue': { f: 'assets/app-main.js', de: '  if (funGalaxy) {\n    const ville = funGalaxy[1] || funGalaxy[2];\n    return ville.startsWith(\'libramont\') ? \'libramont\' : ville;\n  }\n', vers: `  if (funGalaxy) {\n    const ville = funGalaxy[1] || funGalaxy[2];\n    return ville.startsWith('libramont') ? 'libramont' : ville;\n  }\n${ANCIENNE_REGLE.replace("  if (['libramont', 'gembloux', 'ciney'].includes(clean)) return clean;\n", '')}`, lettre: 'C' },
};
const MUTATION = (process.argv.find((a) => a.startsWith('--mutation=')) || '').slice('--mutation='.length);
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`mutation inconnue : ${MUTATION}`); process.exit(2); }
function muter(fichier, texte) {
  const m = MUTATION ? MUTATIONS[MUTATION] : null;
  const t = String(texte).split('\r\n').join('\n');
  if (!m || path.resolve(fichier) !== path.join(ROOT, m.f)) return t;
  if (t.split(m.de).length !== 2) throw new Error(`ANCRE DE MUTATION absente ou multiple (${MUTATION}) dans ${m.f}`);
  return t.split(m.de).join(m.vers);
}
const compiler = Module.prototype._compile;
Module.prototype._compile = function compilerMute(contenu, fichier) {
  return compiler.call(this, muter(fichier, contenu), fichier);
};

let rouges = 0;
let lettre = '';
function section(titre) { lettre = (titre.match(/^\[([A-Z])\]/) || [])[1] || ''; console.log(`\n${titre}`); }
function ok(condition, quoi, detail) {
  if (condition) { console.log(`ok    ${quoi}`); return; }
  rouges += 1;
  console.log(`ROUGE [${lettre}] ${quoi}${detail !== undefined ? ` : ${String(detail).slice(0, 300)}` : ''}`);
}

if (process.argv.includes('--contre-preuves')) {
  const temoin = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (temoin.status !== 0) { console.log(`${temoin.stdout || ''}${temoin.stderr || ''}`.split('\n').filter((l) => /ROUGE|Error/.test(l)).join('\n')); console.log('\ncentre-nom-de-ville-check --contre-preuves: le gate est rouge sans mutation, aucune contre-preuve ne compte'); process.exit(1); }
  let rates = 0;
  for (const [nom, m] of Object.entries(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutation=${nom}`], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    const mord = r.status === 1 && sortie.includes(`ROUGE [${m.lettre}]`) && !/ANCRE DE MUTATION/.test(sortie);
    if (!mord) rates += 1;
    console.log(`${mord ? 'TUEE ' : 'VIVANTE'} ${nom} (attendu : ROUGE [${m.lettre}], sortie ${r.status})${mord ? '' : `\n${sortie.split('\n').filter((l) => /ROUGE|ANCRE|Error/.test(l)).slice(0, 6).join('\n')}`}`);
  }
  console.log(rates ? `\ncentre-nom-de-ville-check --contre-preuves: ${rates} mutation(s) vivante(s)` : '\ncentre-nom-de-ville-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(rates ? 1 : 0);
}

// Les formes de Fun Galaxy et leur centre.
const FUN_GALAXY = [
  ['libramont', 'libramont'], ['Gembloux', 'gembloux'], ['Ciney', 'ciney'],
  ['Fun Galaxy Gembloux', 'gembloux'], ['fun-galaxy-libramont', 'libramont'], ['Fun Galaxy de Ciney', 'ciney'],
  ['Fungalaxy Centre Gembloux', 'gembloux'], ['Gembloux Fun Galaxy', 'gembloux'], ['Libramont-Chevigny', 'libramont'],
  ['Fun Galaxy Centre', 'libramont'], ['fun galaxy center', 'libramont'], ['fungalaxy', 'libramont'],
  ['admin', 'libramont'], ['pinlane', 'libramont'], ['', 'libramont'],
];
// D autres centres dont l identifiant contient une ville de Fun Galaxy : ils passent tels quels.
const AUTRES = ['bowling-gembloux', 'gembloux-bowling', 'ciney-loisirs', 'laser-libramont', 'fun-galaxy-namur', 'bowling-atlas'];

section('[S] LE SERVEUR : lib/staff-auth.js, la fonction exportee');
const { normalizeStaffCenterId: serveur } = require('../lib/staff-auth');
for (const [entree, attendu] of FUN_GALAXY) ok(serveur(entree) === attendu, `« ${entree} » mene a ${attendu}`, serveur(entree));
for (const id of AUTRES) ok(serveur(id) === id, `« ${id} » reste son propre centre`, serveur(id));

section('[C] LA CONSOLE : assets/app-main.js, la fonction lue dans le fichier');
const fichierApp = path.join(ROOT, 'assets', 'app-main.js');
const app = muter(fichierApp, fs.readFileSync(fichierApp, 'utf8'));
function extraire(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  if (debut < 0) throw new Error(`fonction absente : ${nom}`);
  let i = src.indexOf('{', src.indexOf(')', debut));
  let profondeur = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') { profondeur -= 1; if (profondeur === 0) break; }
  }
  return src.slice(debut, i + 1);
}
const motif = app.match(/const PUBLIC_CENTER_ID_PATTERN = [^;]+;/);
if (!motif) throw new Error('constante absente : PUBLIC_CENTER_ID_PATTERN');
const bac = {};
vm.runInNewContext(`${motif[0]}\n${extraire(app, 'normalizeStaffCenterId')}\nthis.f = normalizeStaffCenterId;`, bac);
const console_ = bac.f;
for (const [entree, attendu] of FUN_GALAXY) ok(console_(entree) === attendu, `« ${entree} » mene a ${attendu}`, console_(entree));
for (const id of AUTRES) ok(console_(id) === id, `« ${id} » reste son propre centre`, console_(id));
const desaccords = [...FUN_GALAXY.map(([e]) => e), ...AUTRES].filter((e) => console_(e) !== serveur(e));
ok(desaccords.length === 0, 'la console et le serveur rendent le meme centre sur chaque cas', desaccords.join(', '));

console.log(rouges ? `\ncentre-nom-de-ville-check: ${rouges} ROUGE(S)` : '\ncentre-nom-de-ville-check: ALL OK');
process.exit(rouges ? 1 : 0);
