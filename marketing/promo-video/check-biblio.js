// ============================================================
// GARDE : LA BIBLIOTHEQUE EST-ELLE COMPLETE ET ACCESSIBLE DEPUIS LE PROJET ?
//
// « Faut pas qu'on ait que 10 demos et 100 qui sont pas la, avec a chaque fois
// les memes 10 SFX et les memes 10 animations. »
//
// L'audit qui a motive ce script a trouve exactement ca :
//   - les 161 apercus animes n'etaient PAS installes (ils vivent dans une
//     release GitHub, pas dans le depot git) : impossible de choisir un plan a
//     l'oeil hors ligne ;
//   - le projet n'avait que 45 bruitages sur 149, et CINQ FAMILLES ENTIERES
//     manquaient (film, fluid, glass, mech, scifi). On repiochait donc toujours
//     dans le meme petit vivier ;
//   - `@remotion/motion-blur` manquait, et huit demos ne compilent pas sans lui.
//
// Aucun de ces manques ne fait d'erreur : tout continue de marcher, en plus
// pauvre. C'est pour ca qu'il faut une garde.
//
// A ADAPTER : SHOTCRAFT et PROJET si les chemins changent.
//
// Usage : node check-biblio.js [--projet <dir du projet Remotion>]
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const SHOTCRAFT = path.join(os.homedir(), '.claude/skills/video-shotcraft');
const PROJET = path.resolve(arg('--projet', '.'));

const compte = (dir, motif) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const marche = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) marche(p);
      else if (motif.test(e.name)) n += 1;
    }
  };
  marche(dir);
  return n;
};

const ratees = [];
const alertes = [];

if (!fs.existsSync(SHOTCRAFT)) {
  console.error(`video-shotcraft introuvable : ${SHOTCRAFT}`);
  console.error('  git clone https://github.com/Vincentwei1021/video-shotcraft \\');
  console.error('            ~/.claude/skills/video-shotcraft');
  process.exit(1);
}

// --- ce que le depot doit contenir -------------------------------------------
const ATTENDU = [
  ['cartes de plans', 'gallery/source', /\.md$/, 104],
  ['demos (.tsx)', 'demos', /\.tsx$/, 153],
  ['bruitages', 'assets/audio/sfx', /\.mp3$/, 149],
  ['musiques de fond', 'assets/audio/bgm', /\.mp3$/, 5],
  ['documents de reference', 'references', /\.md$/, 6],
  // Ces trois-la etaient installes et INVISIBLES : jamais cites par mon skill
  // avant l'audit du 2026-08-01. `motion.ts` contenait deja l'oscillation
  // amortie que j'avais reecrite dans `scene3d.tsx`.
  ['composants reutilisables', 'assets/lib', /\.tsx$/, 6],
  ['helpers d animation', 'assets/lib/helpers', /\.(ts|tsx)$/, 4],
  ['squelette d energie', 'references/sequences', /\.md$/, 1],
  ['cartes rangees par famille', 'references/shots', /\.md$/, 104],
];

console.log('bibliotheque video-shotcraft :');
for (const [quoi, rel, motif, cible] of ATTENDU) {
  const n = compte(path.join(SHOTCRAFT, rel), motif);
  const etat = n >= cible ? 'ok' : 'INCOMPLET';
  console.log(`  ${etat.padEnd(10)} ${String(n).padStart(3)} / ${cible}  ${quoi}`);
  if (n < cible) ratees.push(`${quoi} : ${n} au lieu de ${cible} (depot incomplet ?)`);
}

// --- les apercus animes, qui ne sont PAS dans git -----------------------------
const clips = compte(path.join(SHOTCRAFT, 'gallery/media'), /\.mp4$/);
console.log(`  ${(clips >= 150 ? 'ok' : 'ABSENT').padEnd(10)} ${String(clips).padStart(3)} / 161  apercus animes`);
if (clips < 150) {
  ratees.push('apercus animes absents : impossible de choisir un plan a l\'oeil.'
    + '\n      cd ~/.claude/skills/video-shotcraft/gallery && ./fetch-media.sh');
}

// --- ce que le PROJET doit avoir recu -----------------------------------------
console.log('');
console.log('projet :');

const audioProjet = path.join(PROJET, 'public/audio');
const dispo = fs.existsSync(audioProjet)
  ? fs.readdirSync(audioProjet).filter((f) => /\.mp3$/.test(f))
  : [];
const biblio = [];
const sfxDir = path.join(SHOTCRAFT, 'assets/audio/sfx');
if (fs.existsSync(sfxDir)) {
  for (const fam of fs.readdirSync(sfxDir)) {
    const d = path.join(sfxDir, fam);
    if (!fs.statSync(d).isDirectory()) continue;
    fs.readdirSync(d).filter((f) => /\.mp3$/.test(f)).forEach((f) => biblio.push([fam, f]));
  }
}
const nomsProjet = new Set(dispo);
const parFamille = new Map();
biblio.forEach(([fam, f]) => {
  if (!parFamille.has(fam)) parFamille.set(fam, { total: 0, pris: 0 });
  const e = parFamille.get(fam);
  e.total += 1;
  if (nomsProjet.has(f)) e.pris += 1;
});
const totalPris = [...parFamille.values()].reduce((s, e) => s + e.pris, 0);
console.log(`  ${(totalPris >= biblio.length ? 'ok' : 'PARTIEL').padEnd(10)}`
  + ` ${String(totalPris).padStart(3)} / ${biblio.length}  bruitages accessibles`);

// UNE FAMILLE ENTIEREMENT ABSENTE EST LE VRAI DEFAUT. Il ne se voit pas : le
// film marche, il sonne juste toujours pareil.
const vides = [...parFamille.entries()].filter(([, e]) => e.pris === 0).map(([f]) => f);
const maigres = [...parFamille.entries()]
  .filter(([, e]) => e.pris > 0 && e.pris / e.total < 0.5)
  .map(([f, e]) => `${f} ${e.pris}/${e.total}`);
if (vides.length) {
  ratees.push(`familles de sons ABSENTES du projet : ${vides.join(', ')}`
    + '\n      cp ~/.claude/skills/video-shotcraft/assets/audio/sfx/*/*.mp3 public/audio/');
}
if (maigres.length) alertes.push(`familles a moins de la moitie : ${maigres.join(' · ')}`);

// --- la dependance que huit demos exigent -------------------------------------
const pkg = path.join(PROJET, 'package.json');
if (fs.existsSync(pkg)) {
  const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  const deps = { ...p.dependencies, ...p.devDependencies };
  const ok = !!deps['@remotion/motion-blur'];
  console.log(`  ${(ok ? 'ok' : 'MANQUE').padEnd(10)}      @remotion/motion-blur (8 demos en dependent)`);
  if (!ok) ratees.push('@remotion/motion-blur absent : huit demos ne compilent pas');
}

console.log('');
alertes.forEach((a) => console.log(`  note : ${a}`));
if (ratees.length) {
  console.error('\nECHEC :');
  ratees.forEach((r) => console.error('  - ' + r));
  process.exit(1);
}
console.log('OK : bibliotheque complete et entierement accessible depuis le projet.');
