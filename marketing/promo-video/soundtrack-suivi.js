// BANDE-SON de la pub : voix ElevenLabs DEVANT, musique dessous.
//
// Pourquoi ce script existe : le mix precedent avait exactement le meme niveau
// que la musique seule (-14,4 dB contre -14,3), et la voix passait 7,5 dB en
// dessous. Elle etait presente et inaudible. Un mix « fait » n'est pas un mix
// « verifie » : ici on MESURE le rapport voix/musique pendant la parole, et le
// script echoue si la voix ne domine pas.
//
// Usage : node marketing/promo-video/soundtrack-motion.js

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'artifacts/promo-video');
const VOIX = path.join(DIR, 'voix-v3.mp3');
const MUSIQUE = path.join(DIR, 'musique-suspens.mp3');
const OUT = path.join(DIR, 'mix-suivi.wav');
const DUREE = 14.4;

// Fenetre de marge voix/musique pendant la parole, bornee DES DEUX COTES.
// Trop bas : on ne suit plus le texte (le defaut du mix precedent, 7,5 dB a
// l'envers). Trop haut : la musique disparait des qu'on parle, et « une
// musique enjouee » qu'on n'entend jamais ne sert a rien.
const MARGE_MIN_DB = 7;
const MARGE_MAX_DB = 16;

const ff = (args, label) => {
  try {
    return execFileSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`echec ${label}: ${String(e.stderr || e.message).slice(0, 500)}`);
    process.exit(1);
  }
};

// mean_volume d'un extrait : c'est la mesure qui dit qui domine.
// volumedetect ecrit sur stderr, y compris quand ffmpeg reussit : execFileSync
// ne rend que stdout, il faut donc spawnSync pour lire le resultat.
function niveau(file, from, to) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-to', String(to),
    '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(String(r.stderr || ''));
  return m ? Number(m[1]) : null;
}

for (const f of [VOIX, MUSIQUE]) {
  if (!fs.existsSync(f)) { console.error(`manque ${path.relative(ROOT, f)}`); process.exit(1); }
}

console.log('1. voix : normalisation et calage');
const voixWav = path.join(DIR, 'tmp-voix.wav');
// La voix est normalisee SEULE et haut : c'est elle la reference du mix, pas
// la musique. apad + atrim garantissent la duree exacte du film.
ff(['-i', VOIX, '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9,apad', '-t', String(DUREE),
  '-ar', '48000', '-ac', '2', voixWav], 'voix');

console.log('2. musique : raccourcie, baissee, fondue');
const musWav = path.join(DIR, 'tmp-mus.wav');
ff(['-i', MUSIQUE, '-af',
  `atrim=0:${DUREE},asetpts=N/SR/TB,volume=-7dB,afade=t=out:st=${(DUREE - 0.45).toFixed(2)}:d=0.45`,
  '-ar', '48000', '-ac', '2', musWav], 'musique');

console.log('3. ducking : la musique se retire sous la voix');
const musDuck = path.join(DIR, 'tmp-mus-duck.wav');
// sidechaincompress pilote par la voix : des qu'elle parle, la musique plonge.
// ratio eleve + release court = la musique remonte dans chaque respiration,
// donc on l'entend quand meme vivre entre les phrases.
ff(['-i', musWav, '-i', voixWav, '-filter_complex',
  '[0:a][1:a]sidechaincompress=threshold=0.055:ratio=6:attack=10:release=300:makeup=2[out]',
  '-map', '[out]', '-ar', '48000', '-ac', '2', musDuck], 'ducking');

console.log('4. verification du rapport voix/musique pendant la parole');
// Trois fenetres relevees sur silencedetect, en pleine phrase.
const FENETRES = [[0.3, 1.2], [3.8, 5.0], [7.9, 9.1]];
let pire = Infinity;
for (const [from, to] of FENETRES) {
  const v = niveau(voixWav, from, to);
  const m = niveau(musDuck, from, to);
  if (v === null || m === null) { console.error('   mesure impossible'); process.exit(1); }
  const marge = v - m;
  pire = Math.min(pire, marge);
  console.log(`   ${from}-${to}s : voix ${v.toFixed(1)} dB / musique ${m.toFixed(1)} dB -> marge ${marge.toFixed(1)} dB`);
}

console.log('5. mix final');
ff(['-i', voixWav, '-i', musDuck, '-filter_complex',
  '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1:LRA=11[out]',
  '-map', '[out]', '-t', String(DUREE), '-ar', '48000', '-ac', '2', OUT], 'mix');

for (const f of [voixWav, musWav, musDuck]) fs.rmSync(f, { force: true });

const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nk=1:nw=1', OUT], { encoding: 'utf8' }).trim();
console.log(`\nMIX : ${path.relative(ROOT, OUT)}  ${Number(dur).toFixed(2)}s`);
console.log(`marge voix/musique la plus faible : ${pire.toFixed(1)} dB (minimum exige ${MARGE_MIN_DB})`);

if (pire < MARGE_MIN_DB) {
  console.error('\nECHEC : la voix ne passe pas devant la musique.');
  process.exit(1);
}
if (pire > MARGE_MAX_DB) {
  console.error(`\nECHEC : musique etouffee (${pire.toFixed(1)} dB sous la voix), on ne l'entend plus.`);
  process.exit(1);
}
console.log('OK : voix devant, musique toujours presente');
