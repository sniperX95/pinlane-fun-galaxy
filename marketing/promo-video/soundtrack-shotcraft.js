// BANDE-SON COMPLETE : voix + BGM + SFX CALES A L'IMAGE.
//
// Applique la methode du skill `video-shotcraft` (references/sound-design.md).
// C'est la couche qui manquait a tous les films precedents : ils n'avaient
// AUCUN bruitage. Un mouvement sans son sonne cheap quelle que soit la qualite
// de l'animation : c'est le diagnostic le plus utile qu'apporte ce skill.
//
// Quatre regles reprises telles quelles :
//
//   1. BGM d'abord, pour poser l'ossature d'energie, volume plafonne (~0.34)
//      afin de laisser du headroom aux SFX.
//   2. Vocabulaire choisi par TYPE DE FILM, pas par evenement d'interface :
//      whoosh (mouvement) / impact (arrivee) / riser (montee) / sparkle
//      (lumiere) / transition. Les timbres de jeu video sont exclus : le skill
//      documente un premier jet rejete d'une phrase : « trop comme un jeu ».
//      Le bruitage de matiere reelle (papier, mecanique) reste autorise quand
//      l'image montre vraiment cette matiere.
//   3. SFX cales IMAGE PAR IMAGE dans une table declarative unique, chaque
//      ligne commentee avec l'action qu'elle accompagne. Jamais « au feeling ».
//   4. Le son vient APRES le verrouillage de l'image.
//
// Livraison en DEUX versions comme prescrit : avec BGM, et sans BGM (SFX
// conserves) pour que Movsar puisse poser sa propre musique.
//
// Usage : node marketing/promo-video/soundtrack-shotcraft.js

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'artifacts/promo-video');
const SFXDIR = 'C:/Users/movsa/.claude/skills/video-shotcraft/assets/audio/sfx';
const VOIX = path.join(DIR, 'voix-bascule.wav');
const MUSIQUE = path.join(DIR, 'musique-samedi.mp3');
const BORNES = path.join(DIR, 'voix-bascule-plans.js');

global.window = {};
require(BORNES);
const P = global.window.PROMO_PLANS;
const DUREE = Number((global.window.PROMO_VOIX_DUREE + 0.6).toFixed(2));
const b = (i) => P[i].debut;          // debut du plan i, en secondes

// ===========================================================================
// LA TABLE. Chaque ligne : instant, son, volume, et l'ACTION qu'elle habille.
// Les instants sont derives des bornes de plans : jamais ecrits en dur, donc
// regenerer la voix les deplace tous ensemble.
// ===========================================================================
const SFX = [
  // --- AVANT : le chaos. Bruitage de MATIERE (papier), pas d'interface. ---
  { t: b(0) + 0.05, s: 'paper/paper-move-quick.mp3', v: 0.5 },   // 1re note se pose
  { t: b(0) + 0.55, s: 'paper/paper-slide.mp3', v: 0.42 },       // 2e note
  { t: b(1) + 0.10, s: 'paper/paper-move-quick.mp3', v: 0.5 },   // 3e note
  { t: b(1) + 0.42, s: 'paper/paper-slide.mp3', v: 0.42 },       // 4e note
  { t: b(1) + 0.95, s: 'paper/paper-slice-quick.mp3', v: 0.34 }, // la rature se trace
  { t: b(2) + 0.10, s: 'paper/paper-move-quick.mp3', v: 0.5 },   // 5e note
  { t: b(2) + 0.44, s: 'paper/paper-crumple-quick.mp3', v: 0.38 }, // 6e note, froissee
  { t: b(2) + 1.00, s: 'paper/paper-slice-quick.mp3', v: 0.34 }, // 2e rature

  // --- LA BASCULE : riser -> whoosh -> impact, la phrase sonore du skill. ---
  { t: b(3) - 0.85, s: 'riser/riser-cine.mp3', v: 0.46 },        // montee AVANT la coupe
  { t: b(3) + 0.02, s: 'transition/whoosh-big.mp3', v: 0.55 },   // le rideau balaie
  { t: b(3) + 0.28, s: 'impact/impact-cine-big.mp3', v: 0.5 },   // le produit atterrit
  { t: b(3) + 0.14, s: 'paper/paper-wind-blow.mp3', v: 0.3 },    // les notes emportees
  // Les neuf colonnes du planning tombent en place, une par une : un meme
  // bruit mecanique tres bas, decale de 50 ms, suit exactement l'animation.
  ...Array.from({ length: 9 }, (_, k) => ({
    t: b(3) + 0.12 + k * 0.05, s: 'mech/metal-drop-scifi-small.mp3', v: 0.16,
  })),

  // --- APRES : les compteurs. Bruit d'horlogerie, pas de bip de jeu. ---
  { t: b(4) + 0.12, s: 'counter/clock-knob-spin.mp3', v: 0.34 }, // 38 roule
  { t: b(4) + 0.95, s: 'impact/hit-weak.mp3', v: 0.3 },          // 38 se fige
  { t: b(4) + 0.40, s: 'counter/clock-knob-spin.mp3', v: 0.3 },  // 297 roule
  { t: b(4) + 1.35, s: 'impact/hit-weak.mp3', v: 0.3 },          // 297 se fige
  { t: b(5) + 0.12, s: 'counter/clock-knob-spin.mp3', v: 0.34 }, // 76 % roule
  { t: b(5) + 0.95, s: 'impact/hit-weak.mp3', v: 0.3 },          // se fige
  { t: b(5) + 1.30, s: 'counter/clock-tick-single.mp3', v: 0.3 }, // zero saisie

  // --- SIGNATURE : un seul point de lumiere, de qualite. Le skill est
  //     explicite : les halos en rafale font cheap, un eclat unique non. ---
  { t: b(6) + 0.05, s: 'transition/transition-soft.mp3', v: 0.4 },
  { t: b(6) + 0.22, s: 'impact/bass-hit-short.mp3', v: 0.42 },   // le logo se pose
  { t: b(6) + 0.30, s: 'light/sparkle-touch.mp3', v: 0.3 },      // l'eclat de marque
  // Le dossier ui/ contient surtout des sons de synthese, que le skill exclut
  // explicitement pour un film produit : on habille le bouton d'un impact mat.
  { t: b(6) + 1.05, s: 'impact/hit-weak.mp3', v: 0.24 },         // le bouton apparait
];

// ---------------------------------------------------------------------------
const ff = (args, label) => {
  try {
    return execFileSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`echec ${label}: ${String(e.stderr || e.message).slice(0, 700)}`);
    process.exit(1);
  }
};
function niveau(file, from, to) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-ss', String(from),
    '-t', String(Math.max(0.05, to - from)), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(String(r.stderr || ''));
  return m ? Number(m[1]) : null;
}

// GARDE : tout fichier de SFX doit exister. Un chemin faux donnerait un mix
// silencieux a cet endroit sans qu'aucune erreur ne remonte.
const manquants = [...new Set(SFX.map((x) => x.s))].filter((s) => !fs.existsSync(path.join(SFXDIR, s)));
if (manquants.length) {
  console.error('ECHEC : sons introuvables :\n  ' + manquants.join('\n  '));
  console.error(`(cherches dans ${SFXDIR})`);
  process.exit(1);
}
for (const f of [VOIX, MUSIQUE]) {
  if (!fs.existsSync(f)) { console.error(`manque ${path.relative(ROOT, f)}`); process.exit(1); }
}
// GARDE : aucun SFX ne doit tomber hors du film.
const horsFilm = SFX.filter((x) => x.t < 0 || x.t > DUREE - 0.05);
if (horsFilm.length) {
  console.error(`ECHEC : ${horsFilm.length} SFX hors du film (0 - ${DUREE}s)`);
  process.exit(1);
}

console.log(`${SFX.length} SFX cales sur ${P.length} plans, film de ${DUREE}s`);

// 1. voix, reference du mix
const voixWav = path.join(DIR, 'tmp-x-voix.wav');
ff(['-i', VOIX, '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9,apad', '-t', String(DUREE),
  '-ar', '48000', '-ac', '2', voixWav], 'voix');

// 2. BGM a gain fixe (jamais loudnorm : il applique un gain variable dans le
//    temps et creuse des passages entiers : mesure sur ce projet).
const MARGE_CIBLE = 10;
const meanVoix = niveau(voixWav, 0.4, Number(global.window.PROMO_VOIX_DUREE) - 0.4);
const meanMus = niveau(MUSIQUE, 0.4, Math.min(24, DUREE) - 0.4);
const GAIN = meanVoix - MARGE_CIBLE - meanMus;
console.log(`  voix ${meanVoix.toFixed(1)} dB, BGM ${meanMus.toFixed(1)} dB -> gain ${GAIN.toFixed(1)} dB`);
const musWav = path.join(DIR, 'tmp-x-mus.wav');
ff(['-i', MUSIQUE, '-af',
  `apad,atrim=0:${DUREE},asetpts=N/SR/TB,volume=${GAIN.toFixed(2)}dB,`
  + `afade=t=in:st=0:d=1.0,afade=t=out:st=${(DUREE - 1.7).toFixed(2)}:d=1.7`,
  '-ar', '48000', '-ac', '2', musWav], 'bgm');

// 3. la nappe de SFX : chaque son retarde a son instant, puis tout melange.
//    `normalize=0` est indispensable : sinon amix divise par le nombre
//    d'entrees et la nappe devient inaudible.
const entrees = [];
const filtres = [];
SFX.forEach((x, k) => {
  entrees.push('-i', path.join(SFXDIR, x.s));
  const ms = Math.round(x.t * 1000);
  filtres.push(`[${k}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,`
    + `adelay=${ms}|${ms},volume=${x.v}[s${k}]`);
});
const sfxWav = path.join(DIR, 'tmp-x-sfx.wav');
ff([...entrees, '-filter_complex',
  `${filtres.join(';')};${SFX.map((_, k) => `[s${k}]`).join('')}`
  + `amix=inputs=${SFX.length}:normalize=0:duration=longest[out]`,
  '-map', '[out]', '-t', String(DUREE), '-ar', '48000', '-ac', '2', sfxWav], 'nappe sfx');

// 4. ducking leger de la BGM sous la voix (la nappe SFX n'est pas duckee :
//    elle doit frapper en meme temps que l'image).
const musDuck = path.join(DIR, 'tmp-x-duck.wav');
ff(['-i', musWav, '-i', voixWav, '-filter_complex',
  '[0:a][1:a]sidechaincompress=threshold=0.10:ratio=1.9:attack=20:release=400:makeup=1[out]',
  '-map', '[out]', '-ar', '48000', '-ac', '2', musDuck], 'ducking');

// 5. verification, sur des fenetres PRISES DANS LES PLANS
const FENETRES = P.filter((p) => p.fin - p.debut > 1.2).map((p) => {
  const c = (p.debut + p.fin) / 2;
  return [+(c - 0.5).toFixed(2), +(c + 0.5).toFixed(2)];
});
let pire = Infinity, pireMus = -Infinity;
for (const [from, to] of FENETRES) {
  const v = niveau(voixWav, from, to);
  const m = niveau(musDuck, from, to);
  const marge = v - m;
  pire = Math.min(pire, marge); pireMus = Math.max(pireMus, marge);
}
const meanSfx = niveau(sfxWav, 0.2, DUREE - 0.2);
console.log(`  marge voix/BGM : ${pire.toFixed(1)} a ${pireMus.toFixed(1)} dB`);
console.log(`  niveau moyen de la nappe SFX : ${meanSfx.toFixed(1)} dB`);

// 6. les deux mixes
const mixer = (avecBgm, sortie) => {
  const src = avecBgm ? [voixWav, musDuck, sfxWav] : [voixWav, sfxWav];
  ff([...src.flatMap((f) => ['-i', f]), '-filter_complex',
    `${src.map((_, k) => `[${k}:a]`).join('')}amix=inputs=${src.length}:normalize=0:duration=first,`
    + 'loudnorm=I=-14:TP=-1:LRA=11[out]',
    '-map', '[out]', '-t', String(DUREE), '-ar', '48000', '-ac', '2', sortie], 'mix');
};
const avec = path.join(DIR, 'pinlane-shotcraft-audio.wav');
const sans = path.join(DIR, 'pinlane-shotcraft-audio-sansbgm.wav');
mixer(true, avec);
mixer(false, sans);

for (const f of [voixWav, musWav, musDuck, sfxWav]) fs.rmSync(f, { force: true });

console.log(`\nMIX avec BGM : ${path.relative(ROOT, avec)}`);
console.log(`MIX sans BGM : ${path.relative(ROOT, sans)}`);
if (pire < 7) { console.error('ECHEC : la voix ne passe pas devant la BGM'); process.exit(1); }
if (pireMus > 16) { console.error('ECHEC : BGM etouffee'); process.exit(1); }
if (meanSfx === null || meanSfx < -46) {
  console.error(`ECHEC : nappe SFX quasi muette (${meanSfx} dB) : verifier adelay/normalize`);
  process.exit(1);
}
console.log('OK : voix devant, BGM presente, nappe SFX audible');
