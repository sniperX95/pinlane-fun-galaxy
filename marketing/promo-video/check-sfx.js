// ============================================================
// GARDE : LA TABLE DE BRUITAGES EST-ELLE VARIEE, COMPLETE, ET SANS DOUBLON ?
//
// « Les SFX de bowling c'est trop, il doit y en avoir qu'une. » Et plus tard,
// l'audit qui a suivi : DEUX WHOOSHES PORTAIENT ONZE ENTREES sur quarante-cinq
// fichiers disponibles. Toutes les ouvertures de carton sonnaient pareil, et un
// `impact-cine` n'avait jamais servi. Rien ne le mesurait : il a fallu auditer a
// la main pour s'en apercevoir.
//
// Cette garde lit la table de bruitages compilee (le fichier `sfx.ts` transpile,
// ou directement la liste exportee) et repond a quatre questions :
//
//   1. un fichier reference existe-t-il vraiment ? (un chemin faux donne un
//      SILENCE sans erreur, c'est le piege le plus couteux de la sonorisation)
//   2. un son deborde-t-il de la fin du film ?
//   3. un meme timbre porte-t-il trop d'entrees ? (monotonie)
//   4. deux sons tombent-ils sur la MEME image ? (empilement inaudible)
//
// A ADAPTER : PUBLIC et le chemin de la table.
//
// Usage : node check-sfx.js [--sfx src/aifl/sfx.ts] [--public public] [--narration src/aifl/narration.json]
// ============================================================

const fs = require('fs');
const path = require('path');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const SFX_SRC = path.resolve(arg('--sfx', 'src/aifl/sfx.ts'));
const PUBLIC = path.resolve(arg('--public', 'public'));
const NARR = path.resolve(arg('--narration', 'src/aifl/narration.json'));

if (!fs.existsSync(SFX_SRC)) {
  console.error(`table de bruitages introuvable : ${SFX_SRC}`);
  process.exit(1);
}

const src = fs.readFileSync(SFX_SRC, 'utf8');

// On ne transpile pas le TypeScript : on lit les `src:` et les `from:` du texte.
// C'est suffisant pour les quatre questions, et ca evite d'exiger une chaine de
// compilation pour faire tourner une garde qui doit rester rapide.
// ATTENTION AU FORMAT TERNAIRE. Les series alternees s'ecrivent
// `src: k % 2 === 0 ? 'a.mp3' : 'b.mp3'` : un motif ancre sur `src:` ne voit
// que le premier des deux, et la garde declare alors « jamais utilise » un
// fichier qui l'est. Premiere version de ce script : trois fichiers signales a
// tort. On releve donc TOUTE chaine qui nomme un echantillon.
const emplois = [...src.matchAll(/'([^']+\.(?:mp3|wav|m4a))'/g)].map((m) => m[1]);
if (!emplois.length) {
  console.error('aucun `src:` trouve dans la table : le format a change');
  process.exit(1);
}

const ratees = [];

// --- 1. chaque fichier existe -----------------------------------------------
// Un chemin faux ne leve AUCUNE erreur au rendu : Remotion joue du silence. Sur
// une table de soixante entrees, ca ne se remarque pas a l'oreille.
const dossierAudio = path.join(PUBLIC, 'audio');
const manquants = [...new Set(emplois)].filter(
  (f) => !fs.existsSync(path.join(dossierAudio, f)),
);
manquants.forEach((f) => ratees.push(`fichier introuvable : audio/${f}`));

// --- 2. diversite des timbres ------------------------------------------------
const compte = new Map();
emplois.forEach((f) => compte.set(f, (compte.get(f) || 0) + 1));
const classe = [...compte.entries()].sort((a, b) => b[1] - a[1]);

const disponibles = fs.existsSync(dossierAudio)
  ? fs.readdirSync(dossierAudio).filter((f) => /\.(mp3|wav|m4a)$/i.test(f))
  : [];
const inutilises = disponibles.filter((f) => !compte.has(f));

console.log(`table : ${emplois.length} entrees, ${compte.size} timbres distincts`);
console.log(`bibliotheque : ${disponibles.length} fichiers, ${inutilises.length} jamais utilises`);
console.log('');
console.log('les plus employes :');
classe.slice(0, 6).forEach(([f, n]) => {
  const part = ((n / emplois.length) * 100).toFixed(0);
  console.log(`  ${String(n).padStart(2)} fois (${part.padStart(2)} %)  ${f}`);
});

// LE BON CRITERE N'EST PAS LA PART GLOBALE, C'EST LE ROLE.
//
// Premiere version de cette garde : un seuil sur la part de chaque timbre dans
// la table entiere. Testee sur la table d'AVANT la correction, celle ou six
// ouvertures de carton sur sept utilisaient le meme son, elle est restee VERTE :
// le fautif ne pesait que 9 % de la table. Un seuil global ne peut pas voir un
// defaut de role, parce qu'une table est surtout faite de sons de rythme.
//
// Ce qu'on mesure donc : LE SON D'ENTREE DE CHAQUE PLAN, c'est-a-dire celui pose
// a `S.<plan>.from` (ou a quelques images de la). C'est lui qui donne sa couleur
// a une ouverture, et c'est lui qui, repete, fait que « tout sonne pareil ».
const entrees = [...src.matchAll(/from:\s*S\.(\w+)\.from\s*([+-]\s*\d+)?\s*,\s*src:\s*'([^']+)'/g)]
  .map((m) => ({ plan: m[1], decalage: m[2] ? Number(m[2].replace(/\s/g, '')) : 0, src: m[3] }))
  .filter((x) => Math.abs(x.decalage) <= 6);

// Un seul son d'entree par plan : le premier.
const parPlan = new Map();
entrees.forEach((e) => { if (!parPlan.has(e.plan)) parPlan.set(e.plan, e.src); });

const parTimbre = new Map();
[...parPlan.entries()].forEach(([plan, f]) => {
  if (!parTimbre.has(f)) parTimbre.set(f, []);
  parTimbre.get(f).push(plan);
});

if (parPlan.size) {
  console.log('');
  console.log(`sons d'entree : ${parPlan.size} plans, ${parTimbre.size} timbres distincts`);
  [...parTimbre.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .forEach(([f, plans]) => console.log(`  ${String(plans.length).padStart(2)}x ${f.padEnd(26)} ${plans.join(', ')}`));
}

// SEUIL : deux plans peuvent partager un timbre d'entree (une reprise
// deliberee). TROIS, c'est une habitude, et ca s'entend.
const ENTREES_MAX = 2;
[...parTimbre.entries()].forEach(([f, plans]) => {
  if (plans.length > ENTREES_MAX) {
    ratees.push(`« ${f} » ouvre ${plans.length} plans (${plans.join(', ')}) :`
      + ' ces ouvertures sonnent pareil');
  }
});

// --- 3. collisions : deux sons sur la meme image ------------------------------
// Deux echantillons poses a la meme image ne s'additionnent pas dans l'oreille,
// ils se masquent. C'est du budget sonore depense pour rien, et souvent le signe
// d'une entree oubliee lors d'un recalage.
const instants = [...src.matchAll(/from:\s*([^,\n]+),\s*src:\s*'([^']+)'/g)]
  .map((m) => ({ expr: m[1].trim(), src: m[2] }));
const parExpr = new Map();
instants.forEach((x) => {
  if (!parExpr.has(x.expr)) parExpr.set(x.expr, []);
  parExpr.get(x.expr).push(x.src);
});
[...parExpr.entries()]
  .filter(([, l]) => l.length > 1)
  .forEach(([expr, l]) => {
    ratees.push(`${l.length} sons a la meme image (${expr}) : ${l.join(', ')}`);
  });

// --- 4. rien apres la fin du film --------------------------------------------
if (fs.existsSync(NARR)) {
  const n = JSON.parse(fs.readFileSync(NARR, 'utf8'));
  const total = n.total;
  const absolus = [...src.matchAll(/from:\s*(\d{3,})\b/g)].map((m) => Number(m[1]));
  absolus.filter((f) => f > total).forEach((f) => {
    ratees.push(`un son est pose a l'image ${f}, apres la fin du film (${total})`);
  });
}

console.log('');
if (inutilises.length && disponibles.length) {
  console.log(`non employes (${inutilises.length}) : ${inutilises.slice(0, 8).join(', ')}`
    + (inutilises.length > 8 ? '…' : ''));
  console.log('  -> y chercher un timbre avant d\'en reutiliser un deja pris.');
  console.log('');
}

if (ratees.length) {
  console.error('ECHEC :');
  ratees.forEach((r) => console.error('  - ' + r));
  process.exit(1);
}
console.log('OK : tous les fichiers existent, aucun timbre dominant, aucune collision.');
