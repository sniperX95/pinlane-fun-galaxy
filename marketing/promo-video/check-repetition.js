// ============================================================
// GARDE : LE FILM SE REPETE-T-IL, ALORS QU'IL Y AVAIT MIEUX A PRENDRE ?
//
// « Faut pas utiliser la meme animation ou le meme SFX 3 fois ou plus alors
// qu'il y en a d'autres bien mieux pour le truc. »
//
// `check-sfx.js` couvre le SON. Rien ne couvrait le MOUVEMENT. Or c'est la
// regle la plus repetee par l'auteur de `video-shotcraft` sur ses propres
// cartes : « un procede ne fait le sujet qu'une seule fois », « un pousse
// brutal ≤ 2 fois par film ». Un deuxieme emploi du meme effet ne produit plus
// rien, et le spectateur le sent avant de savoir pourquoi.
//
// Ce script lit la scene et compte les PROCEDES, pas les lignes de code. Un
// procede est reconnu a sa signature : un ressort, un flou qui se resorbe, un
// trace de chemin, une derive de camera, un reflet qui traverse, un compteur
// qui roule, un eclat.
//
// CE QU'IL NE PEUT PAS FAIRE : juger si deux emplois sont justifies. Une serie
// de cartes qui se posent utilise legitimement le meme ressort dix fois. Il
// compte donc les SCENES distinctes qui emploient un procede, pas les
// occurrences.
//
// A ADAPTER : SCENE, et la table PROCEDES si le vocabulaire du projet change.
//
// Usage : node check-repetition.js [--scene src/aifl]
// ============================================================

const fs = require('fs');
const path = require('path');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const SCENE = path.resolve(arg('--scene', 'src/aifl'));
if (!fs.existsSync(SCENE)) {
  console.error(`scene introuvable : ${SCENE}`);
  process.exit(1);
}

// La signature d'un procede, et l'alternative a regarder quand il revient trop.
const PROCEDES = [
  ['ressort (depassement puis pose)', /D3\.ressort\(|POP_EASE|1\.25,\s*0\.3/,
    'un flou directionnel qui se resorbe, ou une arrivee en ligne droite decelerante'],
  ['flou directionnel qui se resorbe', /D3\.flou\(|blur\(\$\{\(1 - /,
    'un ressort, ou une entree par masque'],
  ['trace de chemin (stroke-dashoffset)', /strokeDashoffset/,
    'un element qui glisse le long du chemin, ou un masque qui l ouvre'],
  ['derive de camera', /D3\.derive\(|Plateau/,
    'une camera fixe, si le plan a deja beaucoup de mouvement interne'],
  ['reflet qui traverse', /D3\.Reflet|Reflet /,
    'une arete lumineuse fixe, ou un halo qui pulse'],
  ['eclat / onde', /D3\.Eclat|Eclat /,
    'un impact sans onde, ou une variation de l ombre portee'],
  ['halo', /D3\.Halo|Halo /,
    'un fond degrade fixe'],
  ['compteur qui roule', /DigitRoll/,
    'un chiffre qui apparait d un coup avec un impact'],
  ['flash de coupe', /FlashCut/,
    'une coupe seche, ou un rideau'],
  ['ombre de contact pilotee', /D3\.ombre\(/,
    'une ombre fixe, si l objet ne change pas d altitude'],
];

// TEXTURE ou SUJET : c'est la distinction qui compte, pas le seuil.
//
// Premiere version : un plafond unique pour tous les procedes. Elle a signale le
// flou directionnel dans six fichiers, dont `scene3d` qui le DEFINIT et les deux
// composants de texte qui l'emploient pour la meme raison. C'etait un faux
// positif, et le reflexe aurait ete de relever le seuil : ca aurait rendu la
// garde decorative, comme la premiere version de `check-sfx.js`.
//
// La regle de l'auteur du depot dit « un procede ne fait le SUJET qu'une seule
// fois ». Un flou d'entree, une derive de camera, une ombre pilotee ne sont pas
// des sujets : ce sont des traitements de fond, et leur constance EST le style.
// Un ressort de decollage, un trace de chemin, un eclat, un compteur qui roule
// sont des sujets : ils portent un moment, et un moment ne se rejoue pas.
// Le depart : les courbes d'easing et les traitements de fond sont des
// TEXTURES. Ce qui PORTE un moment est un SUJET. Un ressort est une maniere
// d'arriver, pas un evenement ; un trace de chemin ou un compteur qui roule
// EST l'evenement du plan.
const TEXTURE = new Set([
  'derive de camera',
  'ombre de contact pilotee',
  'flou directionnel qui se resorbe',
  'halo',
  'ressort (depassement puis pose)',
]);
// Un sujet peut revenir DEUX fois (une reprise deliberee se lit comme un rappel).
// A la troisieme, c'est une habitude.
const MAX = 2;

// On lit chaque fichier de scene comme UNE scene.
const fichiers = [];
const marche = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) marche(p);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) fichiers.push(p);
  }
};
marche(SCENE);

const usage = new Map();
for (const f of fichiers) {
  const s = fs.readFileSync(f, 'utf8');
  const nom = path.basename(f).replace(/\.tsx?$/, '');
  for (const [proc, motif] of PROCEDES) {
    // LE FICHIER QUI DEFINIT UN COMPOSANT N'EN EST PAS UN EMPLOI. Premiere
    // version : une liste de noms en dur, qui ne couvrait que `scene3d`.
    // `DigitRoll.tsx` et `FlashCut.tsx` etaient donc comptes comme des usages
    // d'eux-memes, et deux des trois alertes etaient fausses. La regle
    // generale : si le motif du procede nomme ce fichier, c'est sa definition.
    const estSaDefinition = new RegExp(nom, 'i').test(motif.source)
      || /^scene3d$/i.test(nom);
    if (motif.test(s) && !estSaDefinition) {
      if (!usage.has(proc)) usage.set(proc, []);
      usage.get(proc).push(nom);
    }
  }
}

console.log(`${fichiers.length} fichiers de scene analyses`);
console.log('');
const classe = [...usage.entries()].sort((a, b) => b[1].length - a[1].length);
classe.forEach(([proc, scenes]) => {
  const r = TEXTURE.has(proc) ? 'texture' : 'sujet  ';
  console.log(`  ${String(scenes.length).padStart(2)} scenes  ${r}  ${proc}`);
  if (scenes.length >= 2) console.log(`                       ${scenes.join(', ')}`);
});

const inutilises = PROCEDES.filter(([p]) => !usage.has(p)).map(([p]) => p);
if (inutilises.length) {
  console.log('');
  console.log(`procedes jamais employes (${inutilises.length}) : ${inutilises.join(' · ')}`);
}

const ratees = [];
classe.forEach(([proc, scenes]) => {
  if (TEXTURE.has(proc)) return;
  if (scenes.length > MAX) {
    const alt = (PROCEDES.find(([p]) => p === proc) || [])[2];
    ratees.push(`« ${proc} » dans ${scenes.length} scenes (${scenes.join(', ')})`
      + `\n      alternative : ${alt}`);
  }
});

console.log('');
if (ratees.length) {
  console.error('ECHEC : le film se repete');
  ratees.forEach((r) => console.error('  - ' + r));
  console.error('');
  console.error('  104 recettes de plans sont disponibles :');
  console.error('  references/plans-shotcraft.md, puis references/selection.md pour le son.');
  process.exit(1);
}
console.log(`OK : aucun procede SUJET employe dans plus de ${MAX} scenes.`);
