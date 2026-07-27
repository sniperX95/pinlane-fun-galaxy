// Detecte les frames VIDES d'un film rendu : les trous noirs aux coutures.
//
// Pourquoi ce script existe : la version precedente laissait ~12 frames de
// scene vide a chaque changement d'acte (le plan suivant montait depuis
// l'opacite 0 alors que le precedent venait d'etre detruit). En regardant six
// frames choisies a la main, on ne voit rien. Ici on les regarde TOUTES.
//
// Le discriminant est YMAX, pas la luminance moyenne : le fond est un degrade
// bleu qui remonte la moyenne meme quand il n'y a rien. Une frame qui porte du
// contenu contient forcement du blanc (texte, UI produit) et plafonne YMAX.
//
// Usage : node marketing/promo-video/check-frames.js artifacts/promo-video/x.mp4

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const file = process.argv[2];
if (!file) { console.error('usage: check-frames.js <video.mp4>'); process.exit(2); }

// Seuil : une frame qui ne contient aucun pixel au-dessus de ce niveau n'a ni
// texte ni interface a l'ecran. Le fond seul plafonne bien en dessous.
const YMAX_MIN = 150;

const out = execFileSync('ffmpeg', [
  '-v', 'error', '-i', path.resolve(ROOT, file),
  '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-',
  '-f', 'null', '-',
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const frames = [];
let pts = null;
for (const line of out.split(/\r?\n/)) {
  const mf = line.match(/^frame:(\d+)\s+pts:\d+\s+pts_time:([\d.]+)/);
  if (mf) { pts = { i: Number(mf[1]), t: Number(mf[2]) }; continue; }
  const mv = line.match(/lavfi\.signalstats\.YMAX=(\d+)/);
  if (mv && pts) { frames.push({ ...pts, y: Number(mv[1]) }); pts = null; }
}

if (!frames.length) { console.error('aucune frame analysee'); process.exit(2); }

const empty = frames.filter((f) => f.y < YMAX_MIN);
console.log(`${frames.length} frames analysees, YMAX seuil ${YMAX_MIN}`);

if (!empty.length) {
  console.log('OK : aucune frame vide');
  process.exit(0);
}

// Regroupe en plages : 12 frames consecutives = UN trou, pas 12 problemes.
const runs = [];
for (const f of empty) {
  const last = runs[runs.length - 1];
  if (last && f.i === last.end + 1) { last.end = f.i; last.tEnd = f.t; }
  else runs.push({ start: f.i, end: f.i, tStart: f.t, tEnd: f.t });
}
console.log(`\n${empty.length} frames vides en ${runs.length} trou(s) :`);
for (const r of runs) {
  const n = r.end - r.start + 1;
  console.log(`  frames ${r.start}-${r.end} (${(n / 30).toFixed(2)}s a partir de t=${r.tStart.toFixed(2)}s)`);
}
process.exit(1);
