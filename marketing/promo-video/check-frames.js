// Detecte les frames VIDES d'un film rendu.
//
// QUATRE VERSIONS DE CETTE GARDE. C'est l'exemple le plus net du projet qu'un
// vert ne prouve rien tant que la garde n'a pas su rougir a bon escient : et
// que chaque version doit etre eprouvee sur un film FAUTIF **et** sur un film
// valide, sinon on remplace un aveuglement par un faux positif.
//
//   v1. YMAX seul. Ne marche que sur une DA sombre, ou une frame vide est
//        noire. Sur un fond clair, une frame vide est CLAIRE : YMAX plafonne
//        et la garde la declare bonne. Aveugle sur toute la crea « Samedi ».
//
//   v2 : contraste (YMAX - YMIN) sur l'image entiere. Un pied de page
//        permanent et un degrade suffisent a le maintenir haut. Un film a ete
//        livre avec une frame ou il ne restait qu'un tiret et « pinlane.app ».
//
//   v3 : proportion de pixels porteurs (`blackframe`), sur la zone centrale.
//        Bonne idee, mauvaise mesure : `pblack` est un ENTIER en pourcentage,
//        donc un film sombre parfaitement valide y descend a 0 comme une frame
//        vide. Resolution insuffisante pour discriminer.
//
//   v4 : celle-ci. On decode la zone de contenu en gris et en petit, puis on
//        calcule l'ECART-TYPE de luminance frame par frame. Une image qui
//        porte du texte ou une interface a beaucoup de transitions clair/
//        sombre ; un aplat n'en a aucune, quelle que soit sa couleur. La
//        mesure est exacte, continue, et ne depend pas de la direction
//        artistique.
//
// Usage : node marketing/promo-video/check-frames.js <video.mp4> [--fps 25]

const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const file = process.argv[2];
if (!file) { console.error('usage: check-frames.js <video.mp4>'); process.exit(2); }
const iFps = process.argv.indexOf('--fps');
// La cadence se LIT dans le fichier. Elle etait supposee a 25 : sur un film a
// 30 i/s la garde annoncait des defauts a t=43 s dans un film de 36 s, ce qui
// rendait ses rapports impossibles a recouper avec l'image.
const FPS = iFps !== -1 ? Number(process.argv[iFps + 1]) : (() => {
  const r = require('child_process').spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', process.argv[2]], { encoding: 'utf8' });
  // `csv=p=0` ajoute une virgule en fin de ligne : un `split('/')` naif donnait
  // « 1,\r\n » comme denominateur, donc NaN, donc le repli silencieux a 25.
  const m = String(r.stdout || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : 25;
})();

// Seuil CALIBRE SUR DEUX FILMS REELS, un valide et un fautif : le n1 (sombre,
// valide par Movsar) ne descend jamais sous 10,7 ; la crea « Samedi » tombait
// a 3,5 sur ses trous. Un seuil a 7 separe les deux avec de la marge des deux
// cotes : un seuil qui ne laisse passer AUCUN film n'est pas une garde, c'est
// un blocage.
const ECART_MIN = 7;
// Zone de contenu : l'habillage permanent (entete, pied, barre) en est exclu,
// il ne doit jamais pouvoir servir d'alibi a un plan vide.
const CROP = 'crop=iw*0.86:ih*0.66:iw*0.07:ih*0.17';
const W = 160, H = 90;                  // deformation sans effet sur une statistique

const chemin = path.resolve(ROOT, file);
const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', chemin,
  '-vf', `${CROP},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'],
{ maxBuffer: 1024 * 1024 * 1024, encoding: 'buffer' });
const brut = r.stdout;
if (!brut || brut.length < W * H) { console.error('aucune frame analysee'); process.exit(2); }

const TAILLE = W * H;
const frames = [];
for (let f = 0; f * TAILLE + TAILLE <= brut.length; f++) {
  const base = f * TAILLE;
  let somme = 0, somme2 = 0;
  for (let i = 0; i < TAILLE; i++) {
    const v = brut[base + i];
    somme += v; somme2 += v * v;
  }
  const moy = somme / TAILLE;
  frames.push({ i: f, t: f / FPS, ecart: Math.sqrt(Math.max(0, somme2 / TAILLE - moy * moy)) });
}

const empty = frames.filter((f) => f.ecart < ECART_MIN);
const pire = frames.reduce((a, b) => (b.ecart < a.ecart ? b : a), frames[0]);
console.log(`${frames.length} frames analysees — ecart-type >= ${ECART_MIN} sur la zone de contenu`);
console.log(`  frame la plus pauvre : ${pire.ecart.toFixed(1)} a t=${pire.t.toFixed(2)}s`);

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
for (const run of runs) {
  const n = run.end - run.start + 1;
  console.log(`  frames ${run.start}-${run.end} (${(n / FPS).toFixed(2)}s a partir de t=${run.tStart.toFixed(2)}s)`);
}
process.exit(1);
