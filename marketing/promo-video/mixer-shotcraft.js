// MIXAGE DU FILM SHOTCRAFT : bruitages (deja dans le rendu) + voix + musique.
//
// Trois principes, chacun paye au moins une fois sur les films precedents :
//
//   1. UNE SEULE PRISE DE VOIX, DECOUPEE. Sept appels de synthese donnaient sept
//      timbres (`stability: 0` fait varier le timbre a chaque appel). Ici la
//      prise est unique et on ne fait que la decouper sur ses SILENCES REELS,
//      mesures — les bornes ci-dessous viennent de `silencedetect`, pas d'une
//      estimation. La prise a ete generee avec des pauses explicites entre
//      phrases justement pour que ces frontieres soient non ambigues : la
//      version sans pauses avait des silences de virgule aussi longs que ses
//      fins de phrase, et le decoupage coupait « Toutes seules » de sa phrase.
//
//   2. UNE PHRASE PAR PLAN. Chaque phrase est posee a l'instant ou son image est
//      a l'ecran. C'est la reponse au reproche « le texte pas toujours correle
//      avec les images » : voix, sous-titre et image disent la meme chose au
//      meme moment.
//
//   3. GAINS CONSTANTS, CALCULES SUR MESURE. Jamais `loudnorm` en une passe :
//      il applique un gain VARIABLE dans le temps et avait creuse la musique
//      d'un film precedent a -41,7 dB alors que la source etait plate a -23,5.
//      On mesure chaque source, on calcule le gain constant qui l'amene a sa
//      cible, on l'applique.
//
// La musique est ATTENUEE SOUS LA VOIX (`sidechaincompress`) : c'est ce qui rend
// une narration intelligible sans monter la voix au point qu'elle ecrase tout.
//
// Usage : node marketing/promo-video/mixer-shotcraft.js <film.mp4> <sortie.mp4>
//         [--sans-musique]

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const FILM = path.resolve(ROOT, process.argv[2] || 'marketing/promo-video/shotcraft/out/pinlane-v2.mp4');
const SORTIE = path.resolve(ROOT, process.argv[3] || 'marketing/promo-video/shotcraft/out/pinlane-v2-mixe.mp4');
const SANS_MUSIQUE = process.argv.includes('--sans-musique');

const VOIX = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/voix-pauses.mp3');
const MUSIQUE = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/musique.mp3');

// Bornes MESUREES dans la prise (silencedetect, seuil -34 dB, duree >= 0,75 s)
// et instant du film ou chaque phrase doit tomber, choisi sur le plan qu'elle
// decrit. Les deux colonnes de droite sont donc verifiables : la premiere par
// re-mesure de la prise, la seconde par la table de plans de `Main.tsx`.
const PHRASES = [
  { de: 0.000, a: 5.896, at: 2.70, texte: 'Un centre de loisirs, un jeudi. Huit pistes…', plan: 'planning 8 pistes' },
  { de: 6.945, a: 9.312, at: 9.40, texte: 'Les réservations arrivent en ligne. Toutes seules.', plan: 'les résas se distribuent' },
  { de: 10.192, a: 12.396, at: 12.90, texte: 'Un client ? Tu le trouves en deux secondes.', plan: 'frappe + filtre + clic' },
  { de: 13.415, a: 17.206, at: 15.60, texte: 'Le jour J, tu sais qui arrive…', plan: 'page Arrivées' },
  { de: 18.387, a: 21.068, at: 20.90, texte: 'Les dossiers qui demandent une action…', plan: 'page Événements' },
  { de: 21.928, a: 25.579, at: 25.00, texte: 'Et le soir, tout est déjà compté…', plan: 'tableau de bord' },
  { de: 26.617, a: 28.880, at: 32.40, texte: 'Pinlane. La console de ton centre.', plan: 'signature' },
];

// Cibles de niveau, en dB de moyenne. La voix domine de ~10 dB les bruitages et
// de ~14 dB la musique : c'est l'ecart a partir duquel une narration reste
// intelligible sur un petit haut-parleur.
const CIBLE_VOIX = -17;
const CIBLE_SFX = -27;
const CIBLE_MUSIQUE = -31;

const duree = (f) => Number(execFileSync('ffprobe', ['-v', 'error',
  '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

// `volumedetect` ecrit sur stderr, et sur Windows les lignes portent un \r qui
// fait echouer une comparaison naive.
const moyenne = (f, args = []) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args, '-i', f, '-map', '0:a',
    '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const t = String(r.stderr || '').replace(/\r/g, '');
  const m = t.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const x = t.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!m) throw new Error(`niveau illisible pour ${path.basename(f)}`);
  return { moy: Number(m[1]), max: x ? Number(x[1]) : 0 };
};

const gain = (mesure, cible) => Math.pow(10, (cible - mesure) / 20);

const D = duree(FILM);
console.log(`film : ${D.toFixed(2)}s`);

['voix', 'musique'].forEach((n, i) => {
  const f = i === 0 ? VOIX : MUSIQUE;
  if (!fs.existsSync(f)) { console.error(`${n} introuvable : ${path.relative(ROOT, f)}`); process.exit(1); }
});

const nSfx = moyenne(FILM);
const nVoix = moyenne(VOIX);
const nMus = moyenne(MUSIQUE);
console.log(`niveaux mesures — bruitages ${nSfx.moy} dB · voix ${nVoix.moy} dB · musique ${nMus.moy} dB`);

const gSfx = gain(nSfx.moy, CIBLE_SFX);
const gVoix = gain(nVoix.moy, CIBLE_VOIX);
const gMus = gain(nMus.moy, CIBLE_MUSIQUE);
console.log(`gains constants — bruitages x${gSfx.toFixed(3)} · voix x${gVoix.toFixed(3)} · musique x${gMus.toFixed(3)}`);

// GARDE : aucune phrase ne doit sortir de la prise ni depasser la fin du film,
// et deux phrases ne doivent pas se chevaucher.
const DV = duree(VOIX);
const ratees = [];
let finPrec = 0;
PHRASES.forEach((p, i) => {
  if (p.a > DV + 0.01) ratees.push(`phrase ${i + 1} : borne ${p.a}s hors de la prise (${DV.toFixed(2)}s)`);
  if (p.at + (p.a - p.de) > D) ratees.push(`phrase ${i + 1} : depasse la fin du film`);
  if (p.at < finPrec - 0.01) ratees.push(`phrase ${i + 1} : chevauche la precedente`);
  finPrec = p.at + (p.a - p.de);
});
if (ratees.length) { ratees.forEach((r) => console.error('  - ' + r)); process.exit(1); }

// --- construction du graphe ------------------------------------------------
const chaines = [];
PHRASES.forEach((p, i) => {
  const ms = Math.round(p.at * 1000);
  chaines.push(`[1:a]atrim=start=${p.de}:end=${p.a},asetpts=N/SR/TB,`
    + `adelay=${ms}|${ms},volume=${gVoix.toFixed(4)}[v${i}]`);
});
const voixIn = PHRASES.map((_, i) => `[v${i}]`).join('');
chaines.push(`${voixIn}amix=inputs=${PHRASES.length}:normalize=0:dropout_transition=0,`
  + `apad=whole_dur=${D}[voix]`);
chaines.push(`[0:a]volume=${gSfx.toFixed(4)}[sfx]`);

let mix;
if (SANS_MUSIQUE) {
  chaines.push('[voix]asplit=1[voixOut]');
  mix = '[sfx][voixOut]amix=inputs=2:normalize=0';
} else {
  // La voix sert DEUX fois : une fois au mixage, une fois comme declencheur de
  // l'attenuation de la musique. D'ou le `asplit`.
  chaines.push('[voix]asplit=2[voixMix][voixDuck]');
  chaines.push(`[2:a]atrim=0:${D},asetpts=N/SR/TB,volume=${gMus.toFixed(4)},`
    + `afade=t=in:st=0:d=1.6,afade=t=out:st=${(D - 2.4).toFixed(2)}:d=2.4[mus]`);
  // ATTENUATION SOUS LA VOIX : la musique baisse de ~7 dB des que la voix parle,
  // et remonte en 400 ms. Sans ca, il faut monter la voix jusqu'a ecraser les
  // bruitages pour rester intelligible.
  chaines.push('[mus][voixDuck]sidechaincompress=threshold=0.02:ratio=5:attack=6:release=400:makeup=1[musDuck]');
  mix = '[sfx][voixMix][musDuck]amix=inputs=3:normalize=0';
}
// `alimiter` en bout de chaine : plafond a -1 dBFS. `amix normalize=0` ne
// normalise rien (c'est voulu), donc rien n'empeche la somme de saturer.
// `level=disabled` EST INDISPENSABLE.
//
// Par defaut `alimiter` REMET SA SORTIE A 0 dB apres avoir limite (option
// `level`, activee d'office). Consequence mesuree : baisser le plafond de 0,89
// a 0,75 rendait le mixage PLUS fort (-18,5 puis -17,5 dB de moyenne) et la
// crete montait vers 0 — l'inverse de ce qu'on demandait. Le plafond ne veut
// dire quelque chose que si l'auto-niveau est coupe.
chaines.push(`${mix},alimiter=limit=0.85:level=disabled,aresample=48000[out]`);

const args = ['-y', '-v', 'error', '-i', FILM, '-i', VOIX];
if (!SANS_MUSIQUE) args.push('-i', MUSIQUE);
args.push('-filter_complex', chaines.join(';'),
  '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', '-shortest', SORTIE);
execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });

// --- verification ----------------------------------------------------------
const nOut = moyenne(SORTIE);
console.log(`\nsortie : ${path.relative(ROOT, SORTIE)}`);
console.log(`niveau global ${nOut.moy} dB (crete ${nOut.max} dB)`);

// GARDE 1 : pas de saturation.
if (nOut.max > -0.5) { console.error('ECHEC : crete a ' + nOut.max + ' dB, ca sature'); process.exit(1); }

// GARDE 2 : la voix doit DOMINER. On compare une fenetre ou elle parle a une
// fenetre ou elle se tait — si l'ecart est faible, elle est noyee.
const parle = moyenne(SORTIE, ['-ss', '26.0', '-t', '2.0']);
const tait = moyenne(SORTIE, ['-ss', '30.0', '-t', '1.6']);
const marge = parle.moy - tait.moy;
console.log(`fenetre parlee ${parle.moy} dB · fenetre muette ${tait.moy} dB · marge ${marge.toFixed(1)} dB`);
if (marge < 4) {
  console.error(`ECHEC : la voix ne domine que de ${marge.toFixed(1)} dB, elle sera noyee`);
  process.exit(1);
}

// GARDE 3 : la nappe hors-voix doit rester AUDIBLE (le defaut inverse : une
// musique si basse qu'elle n'existe pas).
if (!SANS_MUSIQUE && tait.moy < -45) {
  console.error(`ECHEC : hors voix, la nappe est a ${tait.moy} dB — inaudible`);
  process.exit(1);
}

// GARDE 4 : la duree ne doit pas bouger.
const DS = duree(SORTIE);
if (Math.abs(DS - D) > 0.12) {
  console.error(`ECHEC : duree ${DS.toFixed(2)}s au lieu de ${D.toFixed(2)}s`);
  process.exit(1);
}

console.log('\nphrase -> plan :');
PHRASES.forEach((p, i) => console.log(
  `  ${(i + 1)}. ${p.at.toFixed(2)}s (${(p.a - p.de).toFixed(2)}s)  ${p.plan.padEnd(26)} ${p.texte}`));
console.log('\nOK : voix dominante, nappe audible, pas de saturation, duree intacte');
