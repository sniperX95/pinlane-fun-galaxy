// Aucune balise <header> dans le HTML rendu par le JS.
//
// LE BUG (mesure le 2026-07-28). La page Marketing s'ouvrait sur des onglets
// nus : pas de titre, pas de pastille d'etat, pas de description. Cause : son
// en-tete etait un `<header class="mkw-head">`, et la feuille de style de la
// console porte depuis toujours
//
//     body.staff-mode header,
//     body.admin-mode header { display: block; width: 0; height: 0; ... }
//
// (elle masque l'en-tete du SITE PUBLIC quand on bascule en console). Toute
// balise <header> emise par le JS tombe dedans. Mesure sur la page reelle :
// getBoundingClientRect().height === 0 sur .mkw-head, et 0 aussi sur son titre.
// Le piege etait deja documente en commentaire dans SIX fichiers du bundle
// (founder-cockpit, founder-centres, founder-team, founder-tarifs,
// founder-clients-platform, pinlane-analytics-board) : tout le monde le
// connaissait, personne ne le verifiait. Trois fichiers etaient tombes dedans.
//
// Sous 768 px, une media query rend `width/height: auto` : le bloc reapparait
// sur mobile et reste invisible sur desktop. C'est ce qui rend le bug si facile
// a rater a l'oeil, et pourquoi ce gate lit le SOURCE et pas une capture.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ASSETS = path.join(root, 'assets');
const CSS = path.join(ASSETS, 'pinlane-staff.css');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// La regle qui pose le piege doit exister : si elle disparait un jour, ce gate
// n'a plus de raison d'etre et il doit le DIRE plutot que de passer au vert
// pour une mauvaise raison.
console.log('[1] La regle CSS qui ecrase les <header> existe toujours');
const css = fs.readFileSync(CSS, 'utf8');
const ruleFound = /body\.staff-mode header\s*,\s*\r?\n?\s*body\.admin-mode header\s*\{[^}]*height:\s*0/.test(css);
ok(ruleFound, 'body.staff-mode header / body.admin-mode header met la hauteur a 0');

// ===========================================================================
console.log('\n[2] Aucun <header> emis par les fichiers de la console');
// ===========================================================================
// Tous les assets JS sont scannes : la console monte app-main + staff-pages-v2
// + les modules founder-*, et un <header> ecrit dans n'importe lequel tombera
// dans la regle. On ne liste pas les fichiers a la main (une liste blanche
// oubliee est exactement ce qui a laisse passer le bug).
// On ignore les COMMENTAIRES : les six fichiers qui documentent le piege
// ecrivent « JAMAIS de balise <header> » et ne doivent pas se faire punir pour
// l'avoir dit. Les blocs /* */ sont remplaces par autant de sauts de ligne
// (les numeros de ligne restent justes), et le // de fin de ligne est coupe
// sauf quand il appartient a une URL (« https:// »).
function stripComments(source) {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, ' '));
  return withoutBlocks.split(/\r?\n/).map((line) => {
    const at = line.search(/(^|[^:])\/\//);
    if (at === -1) return line;
    return line.slice(0, line.indexOf('//', at));
  });
}

const files = fs.readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
const offenders = [];
for (const name of files) {
  const source = fs.readFileSync(path.join(ASSETS, name), 'utf8');
  stripComments(source).forEach((line, index) => {
    if (/<header[\s>]/.test(line)) offenders.push(`${name}:${index + 1}`);
  });
}
ok(offenders.length === 0, `aucune balise <header> rendue (trouve : ${offenders.join(', ') || 'aucune'})`);

// ===========================================================================
console.log('\n[3] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const target = path.join(ASSETS, 'staff-pages-v2.js');
const original = fs.readFileSync(target, 'utf8');
const anchor = '<section class="mkw-head">';
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue dans staff-pages-v2.js');
} else {
  fs.writeFileSync(target, original.replace(anchor, '<header class="mkw-head">'));
  let caught = false;
  try {
    caught = stripComments(fs.readFileSync(target, 'utf8')).some((line) => /<header[\s>]/.test(line));
  } finally {
    fs.writeFileSync(target, original); // restauration par edition inverse
  }
  ok(caught, 'en-tete Marketing repasse en <header> : le gate ROUGIRAIT');
  ok(!fs.readFileSync(target, 'utf8').includes(anchor.replace('section', 'header')),
    'restauration inverse : le fichier est revenu a <section>');
}

if (failures) {
  console.error(`\nno-header-tag-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nno-header-tag-check: ALL OK - aucun en-tete de console ne peut plus etre ecrase a hauteur zero.');
