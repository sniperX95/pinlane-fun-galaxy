// DETOURE le logo Pinlane sans crever le calendrier.
//
// Le probleme : dans ce logo, la couleur de fond sert DEUX roles. Sur la
// version claire, le blanc est a la fois le fond de l'image ET le papier du
// calendrier dans le monogramme ; sur la version sombre, c'est le noir. Un
// `colorkey` global enleve les deux et vide le calendrier — teste, verifie.
//
// Ce qui les distingue n'est pas la couleur mais la TOPOLOGIE : le fond touche
// le bord de l'image, le papier du calendrier est enferme dans le monogramme.
// On propage donc depuis les bords (remplissage par diffusion) et on ne rend
// transparent que ce qui est atteint.
//
// MODE « sur-noir » : extraction EXACTE, pas un seuil.
//
// Sur la declinaison sombre, le dessin est compose sur du noir pur. Or composer
// sur du noir, c'est exactement premultiplier : pixel = couleur x alpha. On
// inverse donc l'operation au lieu de la deviner —
//     alpha  = max(R, V, B)          (le noir vaut 0 sur les trois canaux)
//     couleur = pixel x 255 / alpha   (depremultiplication)
// Un pixel a mi-chemin entre le bleu et le fond ressort a demi transparent AVEC
// la bonne couleur : l'anticrenelage est reconstruit, pas approxime.
//
// Et le papier du calendrier redevient transparent — ce qui est le comportement
// VOULU sur fond sombre : le decor transparait, comme sur la planche d'origine
// posee sur noir. C'est le contraire du mode « sombre » (diffusion), qui le
// garde opaque pour un fond clair.
//
// Usage : node marketing/promo-video/logo-detourer.js <entree.png> <sortie.png> [clair|sombre|sur-noir]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SRC = process.argv[2];
const DST = process.argv[3];
const MODE = process.argv[4] || 'clair';
if (!SRC || !DST) { console.error('usage: logo-detourer.js <in.png> <out.png> [clair|sombre]'); process.exit(2); }

const inFile = path.resolve(ROOT, SRC);
const outFile = path.resolve(ROOT, DST);
const tmpRaw = path.join(path.dirname(outFile), '.logo-raw.bin');

const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0', inFile], { encoding: 'utf8' }).trim().split(',');
const W = Number(dims[0]), H = Number(dims[1]);

execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmpRaw]);
const rgb = fs.readFileSync(tmpRaw);

// --- Mode exact : depremultiplication d'un dessin compose sur noir ---------
if (MODE === 'sur-noir') {
  const rgba = Buffer.alloc(W * H * 4);
  let encre = 0;
  for (let i = 0, s = 0, d = 0; i < W * H; i++, s += 3, d += 4) {
    const a = Math.max(rgb[s], rgb[s + 1], rgb[s + 2]);
    if (a === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = rgba[d + 3] = 0; continue; }
    rgba[d] = Math.min(255, Math.round((rgb[s] * 255) / a));
    rgba[d + 1] = Math.min(255, Math.round((rgb[s + 1] * 255) / a));
    rgba[d + 2] = Math.min(255, Math.round((rgb[s + 2] * 255) / a));
    rgba[d + 3] = a;
    if (a > 24) encre++;
  }
  fs.writeFileSync(tmpRaw, rgba);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`, '-i', tmpRaw, '-frames:v', '1', outFile]);
  fs.rmSync(tmpRaw, { force: true });
  const pct = ((encre / (W * H)) * 100).toFixed(1);
  console.log(`${path.basename(outFile)} : ${W}x${H}, ${pct} % d'encre (mode sur-noir)`);
  if (encre < W * H * 0.01) { console.error('ECHEC : rien d\'opaque, l\'image n\'etait pas sur fond noir'); process.exit(1); }
  console.log('OK : alpha reconstruit par depremultiplication, anticrenelage exact');
  process.exit(0);
}

const luma = new Uint8Array(W * H);
for (let i = 0, p = 0; i < W * H; i++, p += 3) {
  luma[i] = (rgb[p] * 299 + rgb[p + 1] * 587 + rgb[p + 2] * 114) / 1000;
}

// « Fond » = pixel dont la luminance est du cote du fond. Marge large : les
// pixels d'anticrenelage au bord du dessin restent en dehors, ils garderont
// leur opacite et adouciront le contour.
const estFond = MODE === 'clair'
  ? (i) => luma[i] > 232
  : (i) => luma[i] < 26;

// Diffusion depuis les quatre bords. File explicite plutot que recursion :
// 1,5 million de pixels feraient exploser la pile.
const BG = new Uint8Array(W * H);
const file = new Int32Array(W * H);
let tete = 0, queue = 0;
const pousser = (i) => { if (!BG[i] && estFond(i)) { BG[i] = 1; file[queue++] = i; } };
for (let x = 0; x < W; x++) { pousser(x); pousser((H - 1) * W + x); }
for (let y = 0; y < H; y++) { pousser(y * W); pousser(y * W + W - 1); }
while (tete < queue) {
  const i = file[tete++];
  const x = i % W, y = (i / W) | 0;
  if (x > 0) pousser(i - 1);
  if (x < W - 1) pousser(i + 1);
  if (y > 0) pousser(i - W);
  if (y < H - 1) pousser(i + W);
}

// Alpha : 0 sur le fond atteint, 255 ailleurs. Les pixels d'anticrenelage
// n'etant pas atteints, le contour reste doux — et le calendrier, enferme,
// n'est jamais atteint : il reste plein.
const rgba = Buffer.alloc(W * H * 4);
let opaques = 0;
for (let i = 0, s = 0, d = 0; i < W * H; i++, s += 3, d += 4) {
  rgba[d] = rgb[s]; rgba[d + 1] = rgb[s + 1]; rgba[d + 2] = rgb[s + 2];
  rgba[d + 3] = BG[i] ? 0 : 255;
  if (!BG[i]) opaques++;
}
fs.writeFileSync(tmpRaw, rgba);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
  '-s', `${W}x${H}`, '-i', tmpRaw, '-frames:v', '1', outFile]);
fs.rmSync(tmpRaw, { force: true });

const pct = ((opaques / (W * H)) * 100).toFixed(1);
console.log(`${path.basename(outFile)} : ${W}x${H}, ${pct} % de pixels conserves (mode ${MODE})`);

// Garde-fou : si presque tout devient transparent, le seuil est mauvais et le
// dessin est perdu. Si presque rien ne l'est, le fond n'a pas ete detecte.
if (opaques < W * H * 0.02) { console.error('ECHEC : le dessin a ete efface, seuil trop large'); process.exit(1); }
if (opaques > W * H * 0.9) { console.error('ECHEC : le fond n\'a pas ete detecte'); process.exit(1); }
console.log('OK : fond retire, interieur du calendrier preserve');
