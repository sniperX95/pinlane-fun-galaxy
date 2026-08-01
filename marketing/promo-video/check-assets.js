// ============================================================
// GARDE : AUCUNE IMAGE N'EST AFFICHEE PLUS GRANDE QUE SA SOURCE.
//
// « Le logo Pinlane, surtout le P avec le calendrier, il est flou. » Le fichier
// faisait 139 x 128 px et la scene l'affichait a 196 px de large, dans les trois
// plans ou il apparaissait. C'est le piege numero 1 du carnet (« un zoom qui
// agrandit une source est un flou, pas un zoom ») applique au logo du client, et
// il est passe pendant plusieurs versions parce que RIEN NE LE MESURAIT.
//
// Cette garde lit la definition reelle de chaque image de `public/`, cherche
// toutes les largeurs ecrites dans la scene pour cette image, et refuse le rendu
// si l'une depasse la source.
//
// LIMITE ASSUMEE, a connaitre : elle ne voit que les largeurs ECRITES EN CLAIR
// dans le meme element JSX. Une taille calculee (`zoom`, `scale`, un pourcentage
// du parent) lui echappe. Elle attrape le cas le plus frequent et le plus couteux,
// pas tous les cas. Pour les autres, la regle reste : la taille d'affichage est
// plafonnee par la definition native, et le script de capture ECRIT cette
// definition dans le layout pour que la scene la lise au lieu de la deviner.
//
// A ADAPTER : PUBLIC et SCENE.
//
// Usage : node check-assets.js [--public <dir>] [--scene <dir>]
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const PUBLIC = path.resolve(arg('--public', 'public'));
const SCENE = path.resolve(arg('--scene', 'src'));

// Ce que la scene consomme reellement : on ne juge pas les fichiers inutilises.
const IMAGES = /\.(png|jpe?g|webp|avif)$/i;

const listeRec = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listeRec(p, acc);
    else acc.push(p);
  }
  return acc;
};

const definition = (f) => {
  try {
    const t = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f],
    { encoding: 'utf8' }).trim().split(',');
    return { w: Number(t[0]), h: Number(t[1]) };
  } catch (e) {
    return null;
  }
};

if (!fs.existsSync(PUBLIC) || !fs.existsSync(SCENE)) {
  console.error(`dossier introuvable : ${!fs.existsSync(PUBLIC) ? PUBLIC : SCENE}`);
  process.exit(1);
}

const sources = listeRec(PUBLIC).filter((f) => IMAGES.test(f));
const code = listeRec(SCENE)
  .filter((f) => /\.(tsx?|jsx?)$/.test(f))
  .map((f) => ({ f, s: fs.readFileSync(f, 'utf8') }));

const ratees = [];
const lignes = [];

for (const src of sources) {
  const nom = path.basename(src);
  const def = definition(src);
  if (!def) { ratees.push(`${nom} : definition illisible`); continue; }

  // Toutes les largeurs ecrites dans les ~450 caracteres qui suivent une
  // reference a ce fichier : c'est la fenetre d'un element JSX typique.
  let maxLargeur = 0;
  let ou = '';
  for (const { f, s } of code) {
    const re = new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      const fenetre = s.slice(m.index, m.index + 450);
      for (const w of fenetre.matchAll(/\bwidth:\s*(\d+(?:\.\d+)?)/g)) {
        const v = Number(w[1]);
        if (v > maxLargeur) { maxLargeur = v; ou = path.basename(f); }
      }
    }
  }

  if (!maxLargeur) continue;           // image non utilisee, ou taille calculee
  const ratio = def.w / maxLargeur;
  lignes.push({ nom, def, maxLargeur, ratio, ou });
  if (ratio < 1) {
    ratees.push(`${nom} : source ${def.w} px, affichee jusqu'a ${maxLargeur} px dans ${ou}`
      + ` (agrandissement de ${Math.round((1 / ratio - 1) * 100)} %)`);
  }
}

lignes.sort((a, b) => a.ratio - b.ratio);
for (const l of lignes) {
  console.log(`  ${l.ratio >= 1 ? 'ok  ' : 'FLOU'} ${l.nom.padEnd(28)}`
    + ` source ${String(l.def.w).padStart(5)} px · affichee ${String(l.maxLargeur).padStart(4)} px`
    + ` · ratio ${l.ratio.toFixed(2)}`);
}
if (!lignes.length) {
  console.log('  aucune largeur ecrite en clair : la garde n\'a rien pu juger');
}

if (ratees.length) {
  console.error('\nECHEC : une image est affichee plus grande que sa source');
  ratees.forEach((r) => console.error('  - ' + r));
  console.error('\n  Extraire l\'asset a sa vraie definition depuis la source de marque,');
  console.error('  ou reduire la taille d\'affichage. On reduit toujours une image,');
  console.error('  jamais on ne l\'agrandit.');
  process.exit(1);
}
console.log(`\nOK : ${lignes.length} image(s) verifiee(s), aucun agrandissement`);
