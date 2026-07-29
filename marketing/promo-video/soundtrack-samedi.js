// BANDE-SON de la crea « Samedi » : voix devant, musique dessous.
//
// Difference avec les mix precedents : LES FENETRES DE MESURE NE SONT PLUS
// ECRITES A LA MAIN. Elles sont prises dans les bornes des plans, publiees par
// voice-segments.js — donc on mesure forcement pendant la parole. Des fenetres
// en dur finissent par tomber dans un silence quand la voix est regeneree, et
// une garde qui mesure du silence dit toujours que tout va bien.
//
// Usage : node marketing/promo-video/soundtrack-samedi.js

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'artifacts/promo-video');
// Une voix par version du film (masculine / feminine) : le nom de base est
// passe en argument, les trois fichiers en decoulent.
const BASE = process.argv[2] || 'voix-samedi-plans';
const SUFFIXE = process.argv[3] || '';
const VOIX = path.join(DIR, BASE + '.wav');
const MUSIQUE = path.join(DIR, 'musique-samedi.mp3');
const BORNES = path.join(DIR, BASE + '-plans.js');
const OUT = path.join(DIR, `pinlane-samedi${SUFFIXE}-audio.wav`);

const MARGE_MIN_DB = 7;
const MARGE_MAX_DB = 16;

for (const f of [VOIX, MUSIQUE, BORNES]) {
  if (!fs.existsSync(f)) { console.error(`manque ${path.relative(ROOT, f)}`); process.exit(1); }
}

global.window = {};
require(BORNES);
const PLANS = global.window.PROMO_PLANS;
const DUREE = Number((global.window.PROMO_VOIX_DUREE + 0.5).toFixed(2));

const ff = (args, label) => {
  try {
    return execFileSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`echec ${label}: ${String(e.stderr || e.message).slice(0, 500)}`);
    process.exit(1);
  }
};

// volumedetect ecrit sur stderr meme quand ffmpeg reussit.
//
// PIEGE PAYE ICI : avec `-ss` place AVANT `-i`, ffmpeg fait un seek d'entree et
// `-to` reste compte sur l'horloge du FICHIER D'ORIGINE — la fenetre demandee
// « 22,13 -> 23,13 » mesurait en fait de 22,13 jusqu'a la fin du morceau,
// fondu de sortie compris. La garde annoncait alors une musique a -45 dB sur
// un passage ou elle est a -30, et faisait echouer un mix correct.
// On passe donc `-ss` APRES `-i` et on donne une DUREE, pas une fin.
function niveau(file, from, to) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
    '-ss', String(from), '-t', String(Math.max(0.05, to - from)),
    '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(String(r.stderr || ''));
  return m ? Number(m[1]) : null;
}

// GARDE DE DUREE : la musique doit couvrir le film. En dessous, `apad` remplit
// la fin de silence et le film se termine sans musique — sans que rien ne le
// signale, puisque les fenetres de mesure tombent pendant la parole. La
// duree est LUE SUR LE FLUX et non sur l'entete du conteneur : sur un MP3,
// `format=duration` sous-estime.
const dureeFlux = (f) => Number(execFileSync('ffprobe', ['-v', 'error',
  '-select_streams', 'a', '-show_entries', 'format=duration:stream=duration',
  '-of', 'default=nk=1:nw=1', f], { encoding: 'utf8' }).trim().split(/\s+/)
  .map(Number).filter((n) => !Number.isNaN(n)).reduce((a, b) => Math.max(a, b), 0));
const dureeMus = dureeFlux(MUSIQUE);
if (dureeMus < DUREE - 0.05) {
  console.error(`ECHEC : musique de ${dureeMus.toFixed(2)}s pour un film de ${DUREE.toFixed(2)}s.`);
  console.error('La fin serait muette. Regenerer une piste plus longue ou raccourcir la voix.');
  process.exit(1);
}
console.log(`0. musique ${dureeMus.toFixed(2)}s pour un film de ${DUREE.toFixed(2)}s : couverture OK`);

console.log('1. voix : normalisation et calage');
const voixWav = path.join(DIR, 'tmp-s-voix.wav');
ff(['-i', VOIX, '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9,apad', '-t', String(DUREE),
  '-ar', '48000', '-ac', '2', voixWav], 'voix');

console.log('2. musique : gain CALCULE, pas normalise');
const musWav = path.join(DIR, 'tmp-s-mus.wav');

// ---------------------------------------------------------------------------
// POURQUOI PAS `loudnorm` SUR LA MUSIQUE.
//
// En une passe, loudnorm applique un gain VARIABLE DANS LE TEMPS : il s'adapte
// a ce qu'il a entendu jusque-la. Mesure faite sur cette piste — source plate
// a 0,6 dB pres sur tout le morceau, sortie creusee a -41,7 dB sur le dernier
// plan, soit 18 dB de trou invente. La musique disparaissait pile sur la
// signature de marque.
//
// La bonne operation est un simple DECALAGE : on mesure la voix, on mesure la
// musique, et on calcule le gain qui place la seconde a MARGE_CIBLE sous la
// premiere. Un gain constant ne peut pas creuser un passage.
// ---------------------------------------------------------------------------
// 9 et non 11 : le gain place la musique a MARGE_CIBLE sous la voix AVANT
// ducking, et le sidechain lui reprend encore 3 a 6 dB pendant la parole.
// Viser 11 faisait donc atterrir a 17 — au-dessus du plafond, musique inaudible.
// La cible est un point de depart, pas le resultat.
const MARGE_CIBLE = 9;
const meanVoix = niveau(voixWav, 0.4, Number(global.window.PROMO_VOIX_DUREE) - 0.4);
const meanMus = niveau(MUSIQUE, 0.4, Math.min(24, DUREE) - 0.4);
if (meanVoix === null || meanMus === null) { console.error('ECHEC : mesure impossible'); process.exit(1); }
const GAIN = meanVoix - MARGE_CIBLE - meanMus;
console.log(`   voix ${meanVoix.toFixed(1)} dB, musique ${meanMus.toFixed(1)} dB -> gain ${GAIN.toFixed(1)} dB`);
// Ni dynaudnorm ni loudnorm : un gain fixe, des fondus, rien d'autre.
// apad AVANT atrim : si la musique est plus courte que le film, la couper a
// une duree qu'elle n'a pas laisserait du silence a la fin sans rien signaler.
ff(['-i', MUSIQUE, '-af',
  `apad,atrim=0:${DUREE},asetpts=N/SR/TB,volume=${GAIN.toFixed(2)}dB,`
  + `afade=t=in:st=0:d=0.4,afade=t=out:st=${(DUREE - 0.6).toFixed(2)}:d=0.6`,
  '-ar', '48000', '-ac', '2', musWav], 'musique');

console.log('3. ducking leger, en appoint seulement');
const musDuck = path.join(DIR, 'tmp-s-duck.wav');
// Le niveau etant deja pose par le gain calcule, le sidechain ne fait que
// degager les attaques. Un ducking ferme n'a pas de sens ici : la voix est
// quasi continue, il ne se relacherait jamais.
ff(['-i', musWav, '-i', voixWav, '-filter_complex',
  '[0:a][1:a]sidechaincompress=threshold=0.10:ratio=1.9:attack=20:release=400:makeup=1[out]',
  '-map', '[out]', '-ar', '48000', '-ac', '2', musDuck], 'ducking');

console.log('4. verification, sur des fenetres PRISES DANS LES PLANS');
// Milieu de chaque plan qui dure assez pour porter une mesure. Ce sont des
// instants ou l'on SAIT que la voix parle, puisque le plan est defini par elle.
const FENETRES = PLANS
  .filter((p) => p.fin - p.debut > 1.2)
  .map((p) => {
    const c = (p.debut + p.fin) / 2;
    return [+(c - 0.5).toFixed(2), +(c + 0.5).toFixed(2)];
  });
if (FENETRES.length < 3) { console.error('ECHEC : pas assez de plans mesurables'); process.exit(1); }

let pire = Infinity, pireMusique = -Infinity;
for (const [from, to] of FENETRES) {
  const v = niveau(voixWav, from, to);
  const m = niveau(musDuck, from, to);
  if (v === null || m === null) { console.error('   mesure impossible'); process.exit(1); }
  const marge = v - m;
  pire = Math.min(pire, marge);
  pireMusique = Math.max(pireMusique, marge);
  console.log(`   ${from}-${to}s : voix ${v.toFixed(1)} / musique ${m.toFixed(1)} -> marge ${marge.toFixed(1)} dB`);
}

console.log('5. mix final');
ff(['-i', voixWav, '-i', musDuck, '-filter_complex',
  '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1:LRA=11[out]',
  '-map', '[out]', '-t', String(DUREE), '-ar', '48000', '-ac', '2', OUT], 'mix');

for (const f of [voixWav, musWav, musDuck]) fs.rmSync(f, { force: true });

const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nk=1:nw=1', OUT], { encoding: 'utf8' }).trim();
console.log(`\nMIX : ${path.relative(ROOT, OUT)}  ${Number(dur).toFixed(2)}s`);
console.log(`marge voix/musique : ${pire.toFixed(1)} a ${pireMusique.toFixed(1)} dB `
  + `(bande exigee ${MARGE_MIN_DB}-${MARGE_MAX_DB}, sur ${FENETRES.length} fenetres)`);

if (pire < MARGE_MIN_DB) { console.error('\nECHEC : la voix ne passe pas devant la musique.'); process.exit(1); }
if (pireMusique > MARGE_MAX_DB) {
  console.error(`\nECHEC : musique etouffee (jusqu'a ${pireMusique.toFixed(1)} dB sous la voix).`);
  process.exit(1);
}
console.log('OK : voix devant, musique toujours presente');
