// ============================================================
// GARDE : LE FILM SE REPETE-T-IL LA OU IL NE FAUT PAS, ET VARIE-T-IL LA OU IL
// NE FAUT PAS NON PLUS ?
//
// LA REGLE A DEUX SENS, ET LA PREMIERE VERSION N'EN VOYAIT QU'UN.
//
// Movsar, en corrigeant cette garde : « faut pas non plus que ce soit trop abusé
// sur les restrictions. Il peut utiliser les memes animations plusieurs fois
// s'il y a une logique serieuse derriere. Par exemple une animation de texte, le
// mieux c'est de garder la meme tout le long, et pas changer d'animation pour le
// texte a chaque fois. Trop de restrictions tue la qualite aussi. »
//
// Il a raison. La version precedente comptait « compteur qui roule » et « flash
// de coupe » parmi les procedes a rationner, alors que ce sont justement ceux
// qui DOIVENT etre constants : c'est la facon dont le film traite ses chiffres
// et ses coupes. Un film ou chaque nombre s'anime differemment n'est pas riche,
// il est mal fini.
//
// D'ou trois regimes, et DEUX DEFAUTS OPPOSES :
//
//   CONSTANT   procede attache a un TYPE D'ELEMENT (le texte, les chiffres, les
//              coupes, les arrivees). Le defaut est la VARIATION : deux
//              traitements concurrents du meme type se lisent comme une
//              incoherence. On en veut UN, employe partout.
//
//   SPECTACLE  procede qui EST l'evenement d'un plan (un eclat, un trace qui se
//              dessine, un reflet qui traverse). Le defaut est la REPETITION :
//              rejoue, il ne produit plus rien. Deux fois au plus.
//
//   LIBRE      la texture du film. Ni imposee, ni rationnee.
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

// `type` : ce que le procede traite. Deux procedes de meme `type` en
// concurrence, c'est l'incoherence qu'on cherche.
const PROCEDES = [
  // --- CONSTANT : un seul traitement par type d'element ---------------------
  { nom: 'compteur qui roule', motif: /DigitRoll/, regime: 'constant', type: 'chiffre' },
  // (Il y avait ici un detecteur `tabular-nums`, retire : c'est une propriete
  //  TYPOGRAPHIQUE, pas un traitement d'animation, et elle vit A L'INTERIEUR du
  //  compteur qui roule pour aligner ses colonnes. La garde signalait donc le
  //  compteur comme concurrent de lui-meme.
  //  Lecon : un detecteur de PROCEDE doit matcher un mouvement, jamais un style.)
  { nom: 'flash de coupe', motif: /FlashCut/, regime: 'constant', type: 'coupe' },
  { nom: 'rideau de coupe', motif: /Rideau|Curtain|wipeCut/, regime: 'constant', type: 'coupe' },
  { nom: 'texte : flou et echelle', motif: /blur\(\$\{\(1 - (?:entree|t)\)/, regime: 'constant', type: 'texte' },
  { nom: 'texte : masque qui ouvre', motif: /clipPath[\s\S]{0,140}(?:mot|word)/i, regime: 'constant', type: 'texte' },
  { nom: 'arrivee en ressort', motif: /D3\.ressort\(|POP_EASE/, regime: 'constant', type: 'arrivee' },

  // --- SPECTACLE : deux fois au plus -----------------------------------------
  { nom: 'trace de chemin', motif: /strokeDashoffset/, regime: 'spectacle',
    alt: 'un element qui glisse le long du chemin, ou un masque qui l ouvre' },
  { nom: 'eclat / onde', motif: /D3\.Eclat|<Eclat /, regime: 'spectacle',
    alt: 'un impact sans onde, ou une variation de l ombre portee' },
  { nom: 'reflet qui traverse', motif: /D3\.Reflet|<Reflet /, regime: 'spectacle',
    alt: 'une arete lumineuse fixe, ou un halo qui pulse' },

  // --- LIBRE : la texture, sa constance EST le style -------------------------
  { nom: 'derive de camera', motif: /D3\.derive\(|Plateau/, regime: 'libre' },
  { nom: 'ombre de contact pilotee', motif: /D3\.ombre\(/, regime: 'libre' },
  { nom: 'halo', motif: /D3\.Halo|<Halo /, regime: 'libre' },
  { nom: 'flou directionnel', motif: /D3\.flou\(/, regime: 'libre' },
];

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
  const src = fs.readFileSync(f, 'utf8');
  const nom = path.basename(f).replace(/\.tsx?$/, '');
  for (const p of PROCEDES) {
    // LE FICHIER QUI DEFINIT UN COMPOSANT N'EN EST PAS UN EMPLOI. Regle
    // generale plutot qu'une liste de noms : `DigitRoll.tsx` et `FlashCut.tsx`
    // etaient comptes comme des usages d'eux-memes, ce qui faisait deux
    // alertes fausses sur trois.
    const saDefinition = new RegExp(nom, 'i').test(p.motif.source) || /^scene3d$/i.test(nom);
    if (p.motif.test(src) && !saDefinition) {
      if (!usage.has(p.nom)) usage.set(p.nom, []);
      usage.get(p.nom).push(nom);
    }
  }
}

console.log(`${fichiers.length} fichiers de scene analyses`);
console.log('');
const REGIME = { constant: 'constant ', spectacle: 'spectacle', libre: 'libre    ' };
[...usage.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([nom, scenes]) => {
    const p = PROCEDES.find((x) => x.nom === nom);
    console.log(`  ${String(scenes.length).padStart(2)} scenes  ${REGIME[p.regime]}  ${nom}`);
    if (scenes.length >= 2) console.log(`                        ${scenes.join(', ')}`);
  });

const ratees = [];

// --- DEFAUT 1 : deux traitements concurrents du meme type d'element -----------
const parType = new Map();
PROCEDES.filter((p) => p.regime === 'constant' && usage.has(p.nom)).forEach((p) => {
  if (!parType.has(p.type)) parType.set(p.type, []);
  parType.get(p.type).push(p);
});
[...parType.entries()].forEach(([type, procs]) => {
  if (procs.length > 1) {
    ratees.push(`INCOHERENCE : ${procs.length} traitements concurrents pour « ${type} »`
      + `\n      ${procs.map((p) => `${p.nom} -> ${usage.get(p.nom).join(', ')}`).join('\n      ')}`
      + '\n      N EN GARDER QU UN. Un film ou chaque element du meme type s anime'
      + '\n      autrement n est pas riche, il est mal fini.');
  }
});

// --- DEFAUT 2 : un effet spectaculaire rejoue --------------------------------
const MAX_SPECTACLE = 2;
PROCEDES.filter((p) => p.regime === 'spectacle' && usage.has(p.nom)).forEach((p) => {
  const scenes = usage.get(p.nom);
  if (scenes.length > MAX_SPECTACLE) {
    ratees.push(`REPETITION : « ${p.nom} » porte ${scenes.length} moments (${scenes.join(', ')})`
      + '\n      Rejoue, un effet spectaculaire ne produit plus rien.'
      + `\n      alternative : ${p.alt}`);
  }
});

console.log('');
if (ratees.length) {
  console.error('ECHEC :');
  ratees.forEach((r) => console.error('  - ' + r));
  console.error('');
  console.error('  104 recettes de plans : references/plans-shotcraft.md,');
  console.error('  puis references/selection.md pour le son qui va avec.');
  process.exit(1);
}
console.log('OK : un seul traitement par type d element, aucun effet spectaculaire rejoue.');
console.log('     Les procedes « constant » et « libre » PEUVENT etre partout :');
console.log('     c est leur constance qui fait le style.');
