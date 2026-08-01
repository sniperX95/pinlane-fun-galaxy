// ============================================================
// LA PLANCHE-CONTACT : voir le MOUVEMENT d'un plan sans pouvoir lire la video.
//
// Le trou le plus large du pipeline : je ne peux pas regarder un film. Je rends
// des images fixes, une par une, et je juge chacune isolement. Tout ce qui se
// joue ENTRE deux images m'echappe : un plan qui ne bouge pas pendant trois
// secondes, une entree qui arrive trop tard, une animation qui finit avant que
// la phrase ne soit dite.
//
// Une planche-contact resout la moitie du probleme : N images echantillonnees
// regulierement dans un plan, assemblees en grille, lues d'un coup. On y voit
// la PROGRESSION. La premiere planche produite a immediatement revele 2,5 s ou
// seule une carte etait a l'ecran pendant que le texte se tapait.
//
// Ce qu'elle ne donne toujours pas : le rythme percu, le son, et la sensation de
// vitesse. Pour ca, il faut l'oeil de Movsar. Mais elle attrape les plans morts,
// et c'est le defaut qu'il a signale le plus souvent.
//
// A ADAPTER : rien. Le script lit `narration.json` pour connaitre les plans.
//
// Usage :
//   node planche-contact.js <film.mp4> --plan cardA
//   node planche-contact.js <film.mp4> --de 338 --a 498 [--n 12] [--cols 4]
//   node planche-contact.js <film.mp4> --tous          (une planche par plan)
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const drapeau = (n) => process.argv.includes(n);

const FILM = process.argv[2];
if (!FILM || !fs.existsSync(FILM)) {
  console.error('usage : node planche-contact.js <film.mp4> [--plan X | --de A --a B | --tous]');
  process.exit(1);
}

const TABLE = arg('--narration', 'src/aifl/narration.json');
const SORTIE = arg('--out', path.join(path.dirname(FILM), 'planches'));
const N = Number(arg('--n', 12));
const COLS = Number(arg('--cols', 4));

let plans = {};
let fps = 30;
if (fs.existsSync(TABLE)) {
  const n = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
  plans = n.plans || {};
  fps = n.fps || 30;
}

/** Une planche pour l'intervalle [de, a[ en images. */
const planche = (nom, de, a) => {
  const total = a - de;
  if (total < 2) return null;
  // Echantillonnage REGULIER : on veut voir la progression, pas les moments
  // interessants. Un echantillonnage sur les pics d'activite mentirait sur les
  // temps morts, qui sont precisement ce qu'on cherche.
  const pas = Math.max(1, Math.floor(total / N));
  const large = Math.round(1920 / COLS);
  fs.mkdirSync(SORTIE, { recursive: true });
  const out = path.join(SORTIE, `${nom}.png`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', FILM,
    '-vf', `select='between(n\\,${de}\\,${a - 1})*not(mod(n-${de}\\,${pas}))',`
      + `scale=${large}:-1,tile=${COLS}x${Math.ceil(N / COLS)}`,
    '-frames:v', '1', out]);
  const combien = Math.min(N, Math.ceil(total / pas));
  console.log(`  ${nom.padEnd(12)} images ${de} a ${a - 1}`
    + ` (${(total / fps).toFixed(1)}s) · ${combien} vignettes · ${path.relative('.', out)}`);
  return out;
};

if (drapeau('--tous')) {
  if (!Object.keys(plans).length) {
    console.error(`aucun plan : ${TABLE} introuvable`);
    process.exit(1);
  }
  console.log(`planches par plan, ${N} vignettes chacune :`);
  for (const [nom, p] of Object.entries(plans)) planche(nom, p.from, p.from + p.duration);
} else if (arg('--plan', null)) {
  const nom = arg('--plan');
  const p = plans[nom];
  if (!p) { console.error(`plan inconnu : ${nom}`); process.exit(1); }
  planche(nom, p.from, p.from + p.duration);
} else {
  const de = Number(arg('--de', 0));
  const a = Number(arg('--a', de + 120));
  planche(`images-${de}-${a}`, de, a);
}

console.log('\nLire chaque planche EN ENTIER : ce qu\'on cherche, ce sont les vignettes');
console.log('successives IDENTIQUES. Deux vignettes voisines qui se ressemblent, c\'est');
console.log('une demi-seconde de film ou rien ne se passe.');
console.log('');
console.log('ATTENTION : le pas d\'echantillonnage peut ENJAMBER un evenement court.');
console.log(`Ici ${N} vignettes, donc un pas de plusieurs dixiemes de seconde : tout ce`);
console.log('qui dure moins que ce pas peut etre absent de la planche SANS etre absent');
console.log('du film. Avant de conclure qu\'un effet manque, refaire une planche serree');
console.log('sur sa fenetre (--de / --a). Le piege a deja fait conclure a tort qu\'une');
console.log('mise au point ne se rendait pas.');
