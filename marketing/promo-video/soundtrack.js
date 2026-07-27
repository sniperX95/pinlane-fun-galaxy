// Bande-son synthetisee, calee sur le decoupage de la video.
//
// Pas de banque de sons externe : tout est genere par ffmpeg (lavfi). L'interet
// n'est pas la prouesse, c'est que la musique reste EDITABLE avec la video -
// si une scene bouge de 2 s, on change une constante et on regenere, au lieu de
// recouper un fichier audio a la main.
//
// Parti pris musical : La mineur, nappe grave + pulsation, densite qui suit la
// narration (respiration au debut, dense sur la sequence rapide, resolution a
// la fin). Rien de melodique au premier plan : la voix off n'existe pas, mais
// le texte a l'ecran doit rester le sujet.
//
// Usage : node marketing/promo-video/soundtrack.js [--out nom] [--dur 52]

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO, 'artifacts', 'promo-video');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const DUR = Number(arg('dur', 52));
const NAME = arg('out', 'pinlane-demo');
const SR = 48000;

// --- reperes narratifs (secondes) : doivent suivre scene-produit.html --------
const MARKS = { hook: 0, titre: 1.8, s1: 6.4, s2: 15.4, six: 23.8, sixStart: 25.0, sixHold: 2.35, s4: 39.4, close: 46.6 };

// La mineur : la tonique grave porte, les quintes ouvrent sans etre joyeuses.
const A2 = 110.00, C3 = 130.81, E3 = 164.81, A3 = 220.00, E4 = 329.63;

const parts = [];   // { src, filters, gain }

// 1. NAPPE ------------------------------------------------------------------
// Trois sinus proches, legerement desaccordes : le battement entre elles cree
// un mouvement lent qu'une seule sinus n'aurait pas (elle sonnerait "test audio").
[[A2, 0.34, 0], [E3, 0.20, 0.7], [C3, 0.16, 1.3], [A3, 0.09, 2.1]].forEach(([f, g, det], i) => {
  parts.push({
    src: `sine=frequency=${(f + det).toFixed(2)}:sample_rate=${SR}:duration=${DUR}`,
    filters: [
      // Ouverture progressive du filtre = la nappe "s'ouvre" au fil du film.
      `lowpass=f=900`,
      `volume=${g}`,
      `afade=t=in:st=0:d=3.5`,
      `afade=t=out:st=${DUR - 4.5}:d=4.5`,
    ],
  });
});

// 2. PULSATION --------------------------------------------------------------
// 100 BPM = 0.6 s par temps. Un souffle filtre plutot qu'un kick synthetique :
// moins "demo de synthe", plus proche d'une nappe rythmique.
const BPM = 100, beat = 60 / BPM;
const pulseEnv = [];
for (let t = MARKS.s1; t < DUR - 3; t += beat) {
  // Densite : un temps sur deux au debut, tous les temps sur la sequence rapide.
  const dense = t >= MARKS.six && t < MARKS.s4;
  const idx = Math.round((t - MARKS.s1) / beat);
  if (!dense && idx % 2 !== 0) continue;
  const amp = dense ? 0.5 : 0.32;
  pulseEnv.push(`${amp}*exp(-28*(t-${t.toFixed(3)}))*between(t,${t.toFixed(3)},${(t + 0.22).toFixed(3)})`);
}
parts.push({
  src: `anoisesrc=color=brown:sample_rate=${SR}:duration=${DUR}:amplitude=1`,
  filters: [
    `bandpass=f=110:width_type=o:width=1.4`,
    `volume='${pulseEnv.join('+')}':eval=frame`,
    `volume=0.9`,
  ],
});

// 3. MARQUEURS DE SCENE -----------------------------------------------------
// Un point d'appui court a chaque bascule : l'oreille sait qu'on change de
// chapitre avant meme d'avoir lu le titre.
const hits = [MARKS.titre, MARKS.s1, MARKS.s2, MARKS.six, MARKS.s4, MARKS.close];
const hitEnv = hits.map((t) => `0.85*exp(-9*(t-${t}))*between(t,${t},${t + 0.9})`);
parts.push({
  src: `sine=frequency=${E4}:sample_rate=${SR}:duration=${DUR}`,
  filters: [`volume='${hitEnv.join('+')}':eval=frame`, `volume=0.16`, `aecho=0.8:0.85:420:0.28`],
});

// Souffle montant juste avant chaque bascule : prepare l'oreille au changement.
const riseEnv = hits.slice(1).map((t) => `0.7*pow(max(0,1-(${t}-t)/0.85),3)*between(t,${t - 0.85},${t})`);
parts.push({
  src: `anoisesrc=color=white:sample_rate=${SR}:duration=${DUR}:amplitude=1`,
  filters: [`highpass=f=1800`, `volume='${riseEnv.join('+')}':eval=frame`, `volume=0.10`],
});

// 4. TICKS DE LA SEQUENCE RAPIDE -------------------------------------------
// Six ecrans, six ticks : le montage s'entend. C'est ce qui donne la sensation
// de rythme sur ce bloc, plus que la musique elle-meme.
const tickEnv = [];
for (let i = 0; i < 6; i++) {
  const t = MARKS.sixStart + i * MARKS.sixHold;
  tickEnv.push(`0.9*exp(-30*(t-${t.toFixed(2)}))*between(t,${t.toFixed(2)},${(t + 0.3).toFixed(2)})`);
}
parts.push({
  src: `sine=frequency=1320:sample_rate=${SR}:duration=${DUR}`,
  filters: [`volume='${tickEnv.join('+')}':eval=frame`, `volume=0.075`, `aecho=0.8:0.7:180:0.22`],
});

// --- assemblage ------------------------------------------------------------
const inputs = [];
const chains = [];
parts.forEach((p, i) => {
  inputs.push('-f', 'lavfi', '-t', String(DUR), '-i', p.src);
  chains.push(`[${i}:a]${p.filters.join(',')}[a${i}]`);
});
const mixIn = parts.map((_, i) => `[a${i}]`).join('');
// dynaudnorm : evite qu'un pic de la sequence rapide ecrase la nappe.
// alimiter : plafond dur, aucune saturation sur un haut-parleur de telephone.
const graph = `${chains.join(';')};${mixIn}amix=inputs=${parts.length}:normalize=0[mix];`
  + `[mix]dynaudnorm=f=250:g=5:p=0.7,alimiter=limit=0.90,`
  + `afade=t=in:st=0:d=1.2,afade=t=out:st=${DUR - 3.2}:d=3.2[out]`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const wav = path.join(OUT_DIR, `${NAME}-audio.wav`);
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', graph, '-map', '[out]',
  '-ac', '2', '-ar', String(SR), wav], { stdio: ['ignore', 'ignore', 'pipe'] });

const sec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nk=1:nw=1', wav]).toString().trim());
console.log(`Bande-son : ${path.relative(REPO, wav)}  ${sec.toFixed(2)}s  ${(fs.statSync(wav).size / 1048576).toFixed(1)} Mo`);
console.log(`  ${parts.length} pistes | ${BPM} BPM | ${hits.length} bascules | 6 ticks de sequence`);
