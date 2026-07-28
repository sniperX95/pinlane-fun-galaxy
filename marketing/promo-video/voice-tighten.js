// RESSERRE la voix off : chaque silence est plafonne, aucun n'est supprime.
//
// Pourquoi : un comedien de synthese respire a chaque ponctuation. Sur une pub
// de 25 s, ces respirations font plusieurs secondes de vide cumule, et le film
// parait mou meme quand le montage est rapide. Baisser la vitesse de lecture
// ne reglerait rien : ca accelere AUSSI les mots, la diction devient pressee.
// Ici on ne touche pas aux mots, on ne coupe que le blanc entre eux.
//
// Un silence n'est jamais supprime completement : sans respiration, on ne
// distingue plus les phrases. On le ramene a PLANCHER_MS.
//
// Usage : node marketing/promo-video/voice-tighten.js <entree.mp3> <sortie.mp3>

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SRC = process.argv[2];
const DST = process.argv[3];
if (!SRC || !DST) { console.error('usage: voice-tighten.js <in.mp3> <out.mp3>'); process.exit(2); }

const SEUIL_DB = -38;      // en dessous : c'est du silence
const MIN_S = 0.11;        // un blanc plus court n'est pas une pause, on le garde
const PLANCHER_S = 0.06;   // ce qu'il reste d'une pause apres resserrage

const inFile = path.resolve(ROOT, SRC);
const outFile = path.resolve(ROOT, DST);
if (!fs.existsSync(inFile)) { console.error(`manque ${SRC}`); process.exit(1); }

const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nk=1:nw=1', inFile], { encoding: 'utf8' }).trim());

// 1. Releve des silences.
const det = spawnSync('ffmpeg', ['-hide_banner', '-i', inFile,
  '-af', `silencedetect=noise=${SEUIL_DB}dB:d=${MIN_S}`, '-f', 'null', '-'], { encoding: 'utf8' });
const log = String(det.stderr || '');
const sil = [];
let open = null;
for (const line of log.split(/\r?\n/)) {
  const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
  if (s) { open = Number(s[1]); continue; }
  const e = /silence_end:\s*([\d.]+)/.exec(line);
  if (e && open !== null) { sil.push([Math.max(0, open), Number(e[1])]); open = null; }
}
if (open !== null) sil.push([open, dur]);

if (!sil.length) { console.log('aucun silence a resserrer'); fs.copyFileSync(inFile, outFile); process.exit(0); }

// 2. Segments a garder : la parole, plus un plancher de respiration.
//    On construit la liste des morceaux, puis on les recolle.
const garder = [];
let curseur = 0;
let gagne = 0;
for (const [a, b] of sil) {
  if (a > curseur) garder.push([curseur, a]);          // la parole avant le blanc
  const longueur = b - a;
  const reste = Math.min(longueur, PLANCHER_S);
  if (reste > 0.005) garder.push([a, a + reste]);      // la respiration, plafonnee
  gagne += longueur - reste;
  curseur = b;
}
if (curseur < dur) garder.push([curseur, dur]);

// 3. Recollage. atrim+concat plutot que N fichiers temporaires : une seule
//    passe ffmpeg, donc aucun artefact de re-encodage intermediaire.
const parts = garder.map(([a, b], i) =>
  `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=N/SR/TB[p${i}]`).join(';');
const inputs = garder.map((_, i) => `[p${i}]`).join('');
const filtre = `${parts};${inputs}concat=n=${garder.length}:v=0:a=1[out]`;

try {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', inFile,
    '-filter_complex', filtre, '-map', '[out]', outFile], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  console.error('echec recollage:', String(e.stderr || e.message).slice(0, 400));
  process.exit(1);
}

const nouvelle = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nk=1:nw=1', outFile], { encoding: 'utf8' }).trim());

const silTotal = sil.reduce((s, [a, b]) => s + (b - a), 0);
console.log(`${SRC} : ${dur.toFixed(2)}s, ${sil.length} silences (${silTotal.toFixed(2)}s cumules)`);
console.log(`${DST} : ${nouvelle.toFixed(2)}s  -  ${gagne.toFixed(2)}s de blanc retire`);

// Verification : la parole ne doit PAS avoir ete rognee. On compare la duree
// de parole (hors silences) avant et apres.
//
// PIEGE : mesurer l'avant avec d=0.14 et l'apres avec d=0.05 compare deux
// regles differentes. Le second seuil detecte aussi les micro-blancs entre les
// mots, donc il trouve « moins de parole » meme sur un fichier intact, et le
// controle echoue sur un faux positif. Les deux mesures utilisent donc la
// MEME detection.
const MESURE_D = 0.05;
function paroleDe(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
    '-af', `silencedetect=noise=${SEUIL_DB}dB:d=${MESURE_D}`, '-f', 'null', '-'], { encoding: 'utf8' });
  let total = 0, o = null;
  for (const line of String(r.stderr || '').split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) { o = Number(s[1]); continue; }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && o !== null) { total += Number(e[1]) - o; o = null; }
  }
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nk=1:nw=1', file], { encoding: 'utf8' }).trim());
  return d - total;
}
const parole = paroleDe(inFile);
const parole2 = paroleDe(outFile);
const ecart = Math.abs(parole2 - parole);
console.log(`parole : ${parole.toFixed(2)}s avant, ${parole2.toFixed(2)}s apres (ecart ${ecart.toFixed(2)}s)`);
if (ecart > 0.35) {
  console.error('\nECHEC : la duree de parole a bouge, des mots ont ete rognes.');
  process.exit(1);
}
console.log('OK : blancs resserres, aucun mot touche');
