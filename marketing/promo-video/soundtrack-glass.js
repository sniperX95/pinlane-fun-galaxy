// Bande-son du montage rush (28 s), synthetisee par ffmpeg.
//
// Forme demandee : ca monte pendant ~19 s, ca se coupe net, suspens, puis BAM
// sur le logo. La musique doit donc RACONTER la meme chose que l'image, pas
// juste remplir le silence.
//
//   0 -> 19 s   MONTEE. Le spectre s'ouvre par couches successives (grave seul,
//               puis medium, puis aigu) et la pulsation se densifie. C'est ce
//               qui donne la sensation que "ca avance" sans changer de theme.
//   19 -> 23 s  TENSION. Tout se resserre, la pulsation double.
//   23 -> 25.1  SUSPENS. Coupe nette : il ne reste qu'un drone grave et un
//               chirp qui monte. Le vide fait le travail.
//   25.1        IMPACT. Puis accord plein qui resonne et retombe.
//
// Les reperes DOIVENT rester alignes sur PLANS[] de scene-rush.html.
//
// Usage : node marketing/promo-video/soundtrack-rush.js [--out pinlane-rush]

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO, 'artifacts', 'promo-video');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const NAME = arg('out', 'pinlane-rush');
const DUR = 19, SR = 48000;
const CUTS = [2.4, 7.2, 9.8, 13.0, 16.0];  // coupes de PLANS[]
const SUSPENS = 16.0, BAM = 17.4;

// La mineur.
const A1 = 55.00, A2 = 110.00, C3 = 130.81, E3 = 164.81, A3 = 220.00, C4 = 261.63, E4 = 329.63;
const parts = [];

// --- 1. NAPPE EN COUCHES ---------------------------------------------------
// Trois couches au meme accord mais filtrees differemment. Elles entrent l'une
// apres l'autre : le spectre s'ouvre, ce qui s'entend comme une montee alors
// que l'harmonie ne bouge pas. Toutes se coupent net a l'entree du suspens.
const layers = [
  { freqs: [A1, A2], cut: 240, in: 0.0, gain: 0.30 },
  { freqs: [E3, C3], cut: 850, in: 3.6, gain: 0.30 },
  { freqs: [A3, E4], cut: 2600, in: 8.0, gain: 0.22 },
];
layers.forEach((L) => L.freqs.forEach((f, k) => {
  parts.push({
    src: `sine=frequency=${(f + k * 0.6).toFixed(2)}:sample_rate=${SR}:duration=${DUR}`,
    filters: [
      `lowpass=f=${L.cut}`,
      `volume=${L.gain}`,
      `afade=t=in:st=${L.in}:d=2.2`,
      // Coupe a l'entree du suspens : c'est le silence qui cree la tension.
      `afade=t=out:st=${SUSPENS - .25}:d=0.45`,
    ],
  });
}));

// --- 2. PULSATION ----------------------------------------------------------
// 124 BPM. Une frappe sur deux au debut, toutes ensuite, doubles-croches sur
// la phase de tension : la densite rythmique porte la montee.
const BPM = 124, beat = 60 / BPM;
const pulse = [];
for (let t = 1.0; t < SUSPENS - .1; t += beat) {
  const phase = t < 6 ? 0 : t < 13 ? 1 : 2;
  const idx = Math.round(t / beat);
  if (phase === 0 && idx % 2 !== 0) continue;
  const amp = phase === 0 ? .30 : phase === 1 ? .62 : .92;
  pulse.push(`${amp}*exp(-26*(t-${t.toFixed(3)}))*between(t,${t.toFixed(3)},${(t + .24).toFixed(3)})`);
  if (phase === 2) {                                   // contretemps
    const off = t + beat / 2;
    if (off < SUSPENS - .1) pulse.push(`0.30*exp(-34*(t-${off.toFixed(3)}))*between(t,${off.toFixed(3)},${(off + .16).toFixed(3)})`);
  }
}
parts.push({
  src: `anoisesrc=color=brown:sample_rate=${SR}:duration=${DUR}:amplitude=1`,
  filters: [`bandpass=f=95:width_type=o:width=1.5`, `volume='${pulse.join('+')}':eval=frame`, `volume=1.0`],
});

// --- 3. MARQUEURS DE COUPE -------------------------------------------------
// Un appui sur chaque coupe : le montage s'entend autant qu'il se voit.
const hits = CUTS.map((t) => `0.8*exp(-11*(t-${t}))*between(t,${t},${t + .8})`);
parts.push({
  src: `sine=frequency=${C4}:sample_rate=${SR}:duration=${DUR}`,
  filters: [`volume='${hits.join('+')}':eval=frame`, `volume=0.13`, `aecho=0.8:0.85:340:0.25`],
});

// Souffle court avant chaque coupe : prepare l'oreille.
const rise = CUTS.map((t) => `0.8*pow(max(0,1-(${t}-t)/0.5),3)*between(t,${t - .5},${t})`);
parts.push({
  src: `anoisesrc=color=white:sample_rate=${SR}:duration=${DUR}:amplitude=1`,
  filters: [`highpass=f=2400`, `volume='${rise.join('+')}':eval=frame`, `volume=0.09`],
});

// --- 4. SUSPENS ------------------------------------------------------------
// Drone grave seul : plus rien d'autre ne joue, on entend le vide.
parts.push({
  src: `sine=frequency=${A1}:sample_rate=${SR}:duration=${DUR}`,
  filters: [`volume=0.16`, `afade=t=in:st=${SUSPENS}:d=0.5`, `afade=t=out:st=${BAM - .12}:d=0.2`],
});
// Chirp montant : la frequence grimpe en quadratique, l'oreille sait qu'un
// evenement arrive avant de savoir lequel.
parts.push({
  src: `aevalsrc='sin(2*PI*(220*(t-${SUSPENS})+380*pow(max(0,t-${SUSPENS}),2)))':s=${SR}:d=${DUR}`,
  filters: [
    `volume='0.55*pow(max(0,(t-${SUSPENS})/${(BAM - SUSPENS).toFixed(2)}),2.2)*between(t,${SUSPENS},${BAM})':eval=frame`,
    `volume=0.28`, `highpass=f=200`,
  ],
});

// --- 5. IMPACT + RESOLUTION ------------------------------------------------
// Le BAM : un coup grave large bande, court.
parts.push({
  src: `anoisesrc=color=brown:sample_rate=${SR}:duration=${DUR}:amplitude=1`,
  filters: [
    `lowpass=f=260`,
    `volume='1.0*exp(-9*(t-${BAM}))*between(t,${BAM},${BAM + 1.2})':eval=frame`,
    `volume=3.2`,
  ],
});
// L'accord qui repond au coup et tient jusqu'a la fin : la resolution.
[[A2, .52], [E3, .40], [C4, .30], [E4, .20]].forEach(([f, g]) => {
  parts.push({
    src: `sine=frequency=${f}:sample_rate=${SR}:duration=${DUR}`,
    filters: [
      `volume='${g}*(exp(-1.4*(t-${BAM}))*0.45+0.55)*between(t,${BAM},${DUR})':eval=frame`,
      `afade=t=out:st=${DUR - 1.1}:d=1.1`, `aecho=0.8:0.8:520:0.22`,
    ],
  });
});

// --- assemblage ------------------------------------------------------------
const inputs = [], chains = [];
parts.forEach((p, i) => {
  inputs.push('-f', 'lavfi', '-t', String(DUR), '-i', p.src);
  chains.push(`[${i}:a]${p.filters.join(',')}[a${i}]`);
});
// PAS de dynaudnorm ici : il remonterait le suspens et detruirait le contraste
// qui fait tout l'effet. On se contente d'un limiteur pour le plafond.
const graph = `${chains.join(';')};${parts.map((_, i) => `[a${i}]`).join('')}`
  + `amix=inputs=${parts.length}:normalize=0[mix];`
  + `[mix]acompressor=threshold=0.10:ratio=6:attack=6:release=140:makeup=3,volume=4.2,alimiter=limit=0.97,afade=t=in:st=0:d=0.6,afade=t=out:st=${DUR - 1.4}:d=1.4[out]`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const wav = path.join(OUT_DIR, `${NAME}-audio.wav`);
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', graph, '-map', '[out]',
  '-ac', '2', '-ar', String(SR), wav], { stdio: ['ignore', 'ignore', 'pipe'] });

console.log(`Bande-son rush : ${path.relative(REPO, wav)} (${(fs.statSync(wav).size / 1048576).toFixed(1)} Mo)`);
console.log(`  ${parts.length} pistes | ${BPM} BPM | montee 0-19s | suspens ${SUSPENS}s | impact ${BAM}s`);
