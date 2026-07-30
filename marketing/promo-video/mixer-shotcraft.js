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

const TABLE = path.join(ROOT, 'marketing/promo-video/shotcraft/src/aifl/narration.json');
const VOIX = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/voix-ugc.mp3');
// UNE NAPPE COMPOSEE SUR LA STRUCTURE DU FILM, PAS UN MORCEAU POSE DESSOUS.
//
// « Je pense que tu peux encore mieux faire avec une musique de fond. » Le morceau
// precedent etait bon mais uniforme : il ne savait pas que le film raconte quelque
// chose. Celui-ci est compose section par section sur la table de plans —
// ouverture eparse, tension pendant les deux cartons du probleme, balayage
// ascendant au basculement, conduite pendant le mecanisme, recompense sur la
// preuve, resolution sur l'appel a l'action. Mesure de controle apres generation :
// -32 dB dans l'ouverture, -27 dans la tension, -13,6 dans la conduite. L'arc est
// dans le fichier, pas seulement dans le prompt.
const MUSIQUE = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/musique-arc.mp3');

// Bornes MESUREES dans la prise (silencedetect, seuil -34 dB, duree >= 0,75 s)
// et instant du film ou chaque phrase doit tomber, choisi sur le plan qu'elle
// decrit. Les deux colonnes de droite sont donc verifiables : la premiere par
// re-mesure de la prise, la seconde par la table de plans de `Main.tsx`.
// LES PHRASES VIENNENT DE LA TABLE DE NARRATION, PAS D'UNE LISTE ECRITE ICI.
//
// C'est le coeur de la correction : le film et le mixage lisent le MEME fichier,
// produit par `scripts/promo-narration.js` a partir de l'alignement caractere par
// caractere rendu par la synthese. Une liste maintenue a la main de chaque cote
// ne peut pas rester d'accord — et c'etait exactement le defaut entendu.
const NARR = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const PHRASES = NARR.lignes.map((l) => ({
  de: l.de, a: l.a, at: l.at, texte: l.texte, plan: l.cible,
}));

// Cibles de niveau, en dB de moyenne. La voix domine de ~10 dB les bruitages et
// de ~14 dB la musique : c'est l'ecart a partir duquel une narration reste
// intelligible sur un petit haut-parleur.
// -15 et non -17 : sur une publicite de trafic froid, la voix doit etre EN AVANT.
// Avec la nappe montee a -30 (voir plus bas), -17 ne laissait que 4,8 dB de marge
// dans le passage le plus doux de la narration. Deux dB de plus la degagent
// franchement sans toucher a la nappe, et le limiteur en bout de chaine absorbe
// les cretes.
const CIBLE_VOIX = -15;
const CIBLE_SFX = -27;
// -30, ET UNE ATTENUATION DOUCE PLUTOT QUE FORTE.
//
// Trois valeurs essayees, chacune mesuree. A -31 avec une attenuation de 7 dB,
// Movsar a redemande « rajoute une petite musique » alors qu'il y en avait une :
// pendant la parole elle tombait a -38, donc elle n'existait pas. A -27 la garde a
// refuse le mixage — dans un trou de 0,6 s la nappe remontait a -23,4 contre
// -21,1 pour la voix, soit 2,3 dB d'ecart : elle lui disputait la place.
//
// Le film parle 76 % du temps : une nappe qui ne s'entend QUE dans les trous ne
// s'entend jamais. Elle doit donc etre audible SOUS la parole — environ 10 dB
// sous elle — et l'attenuation ne fait que degager l'aigu, pas la faire
// disparaitre.
const CIBLE_MUSIQUE = -30;

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

// --- LA VOIX EST COMPRESSEE AVANT TOUT ------------------------------------
//
// Une narration lue avec des intentions differentes n'a pas un niveau constant :
// la ligne jouee « plus bas, complice » sortait 5 dB sous la moyenne, et c'est
// exactement la que la garde d'intelligibilite tombait a 4 dB de marge. Monter le
// gain global n'aurait fait qu'ecraser les passages forts.
//
// On compresse donc la prise (ratio 3, seuil bas, attaque 15 ms) AVANT de calculer
// son gain : les passages doux remontent, les forts ne bougent presque pas, et le
// niveau devient regulier d'un bout a l'autre. C'est ce qu'on fait sur toute voix
// off ; ne pas le faire, c'est demander a l'auditeur de compenser au volume.
const VOIX_COMP = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/voix-compressee.wav');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', VOIX,
  // Seuil a 0,1 (~-20 dB) et non 0,045 (~-27 dB). MESURE QUI A CORRIGE CE
  // REGLAGE : a 0,045, la moyenne et la crete baissaient de la MEME quantite
  // (-5,7 et -5,6 dB) — le compresseur agissait sur la totalite du signal, donc
  // comme un simple atténuateur, sans rien resserrer. Un compresseur ne resserre
  // que ce qui DEPASSE son seuil : il faut le placer entre la moyenne et la crete.
  '-af', 'acompressor=threshold=0.1:ratio=4:attack=10:release=200:makeup=2,'
    + 'highpass=f=85,aresample=48000',
  '-c:a', 'pcm_s16le', VOIX_COMP]);
const avant = moyenne(VOIX);
const apres = moyenne(VOIX_COMP);
console.log(`voix : ${avant.moy} dB avant compression, ${apres.moy} dB apres`
  + ` (crete ${avant.max} -> ${apres.max} dB)`);

// LA NAPPE EST LEGEREMENT COMPRESSEE, PAS APLATIE.
//
// Son arc couvre 18 dB. Normalisee sur sa MOYENNE, son ouverture eparse tombait a
// -45 dB : plus une nappe discrete, une nappe absente. Une compression douce
// (ratio 2) ramene l'amplitude a ~9 dB, ce qui garde l'intention musicale — la
// musique ENTRE au basculement — tout en laissant l'ouverture audible.
const MUSIQUE_COMP = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/musique-comp.wav');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MUSIQUE,
  // Meme correction : l'arc de la nappe va de -32 (ouverture) a -13,6 (conduite).
  // Un seuil a 0,02 (~-34 dB) passait sous TOUT, donc n'aplatissait rien. A 0,063
  // (~-24 dB), seules les sections fortes sont resserrees, et le gain de
  // compensation remonte l'ensemble : l'ouverture reste relativement plus haute.
  '-af', 'acompressor=threshold=0.063:ratio=3:attack=80:release=1200:makeup=2,aresample=48000',
  '-c:a', 'pcm_s16le', MUSIQUE_COMP]);
const musAvant = moyenne(MUSIQUE);
const musApres = moyenne(MUSIQUE_COMP);
console.log(`musique : ${musAvant.moy} dB avant compression, ${musApres.moy} dB apres`);

const nSfx = moyenne(FILM);
const nVoix = apres;
const nMus = musApres;
console.log(`niveaux mesures — bruitages ${nSfx.moy} dB · voix ${nVoix.moy} dB · musique ${nMus.moy} dB`);

const gSfx = gain(nSfx.moy, CIBLE_SFX);
const gVoix = gain(nVoix.moy, CIBLE_VOIX);
const gMus = gain(nMus.moy, CIBLE_MUSIQUE);
console.log(`gains constants — bruitages x${gSfx.toFixed(3)} · voix x${gVoix.toFixed(3)} · musique x${gMus.toFixed(3)}`);

// GARDE : aucune phrase ne doit sortir de la prise ni depasser la fin du film,
// et deux phrases ne doivent pas se chevaucher.
const DV = duree(VOIX_COMP);
const ratees = [];
let finPrec = 0;
PHRASES.forEach((p, i) => {
  // La derniere borne de l'alignement peut depasser de quelques millisecondes la
  // duree que rapporte le conteneur mp3 (bourrage de l'encodeur). Mesure sur
  // plusieurs prises : jusqu'a 110 ms de depassement. On borne au lieu d'echouer ;
  // au-dela de 250 ms en revanche, c'est une vraie incoherence.
  if (p.a > DV) {
    if (p.a > DV + 0.25) ratees.push(`phrase ${i + 1} : borne ${p.a}s tres au-dela de la prise (${DV.toFixed(2)}s)`);
    p.a = +DV.toFixed(3);
  }
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
  chaines.push(`[2:a]apad=whole_dur=${D + 1},atrim=0:${D},asetpts=N/SR/TB,volume=${gMus.toFixed(4)},`
    + `afade=t=in:st=0:d=1.6,afade=t=out:st=${(D - 2.4).toFixed(2)}:d=2.4[mus]`);
  // ATTENUATION SOUS LA VOIX : la musique baisse de ~7 dB des que la voix parle,
  // et remonte en 400 ms. Sans ca, il faut monter la voix jusqu'a ecraser les
  // bruitages pour rester intelligible.
    // ratio 2,5 et non 5 : l'attenuation retire environ 3 dB, pas 7. La nappe
  // reste presente pendant la parole au lieu de s'effacer.
  chaines.push('[mus][voixDuck]sidechaincompress=threshold=0.03:ratio=2.5:attack=8:release=550:makeup=1[musDuck]');
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

const args = ['-y', '-v', 'error', '-i', FILM, '-i', VOIX_COMP];
if (!SANS_MUSIQUE) args.push('-i', MUSIQUE_COMP);
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

// GARDE 2 : la voix doit DOMINER.
//
// On compare une fenetre ou elle parle a une fenetre ou elle se tait. Ces deux
// fenetres sont DERIVEES de la table de narration, pas ecrites en dur : la
// version precedente pointait 30,0 s comme « muette », or apres reecriture du
// texte une phrase y parlait — la garde mesurait 2,7 dB d'ecart et accusait le
// mixage alors que c'etait sa propre fenetre qui etait fausse.
const plusLongue = PHRASES.reduce((a, b) => ((b.a - b.de) > (a.a - a.de) ? b : a));
const wParle = { ss: (plusLongue.at + 0.35).toFixed(2), t: Math.min(1.6, plusLongue.a - plusLongue.de - 0.5).toFixed(2) };
// Le plus grand trou entre deux phrases, borne par la fin du film.
let trou = { ss: 0, t: 0 };
PHRASES.forEach((p, i) => {
  const debutTrou = p.at + (p.a - p.de);
  const finTrou = i + 1 < PHRASES.length ? PHRASES[i + 1].at : D;
  // On ecarte deux zones : le fondu de sortie (la nappe y baisse deja) et tout le
  // plan de signature (riser + impact y sont les bruitages les plus forts du
  // film). Sans cette seconde exclusion, la garde mesurait l'impact et annoncait
  // 4,4 dB de marge — un chiffre qui ne parlait pas de la nappe du tout.
  if (debutTrou > D - 3) return;
  const debutOutro = (NARR.plans && NARR.plans.outro ? NARR.plans.outro.from / NARR.fps : D);
  if (debutTrou > debutOutro - 1) return;
  if (finTrou - debutTrou > trou.t) trou = { ss: debutTrou + 0.25, t: finTrou - debutTrou - 0.45 };
});
const wTait = { ss: trou.ss.toFixed(2), t: Math.min(1.6, trou.t).toFixed(2) };
console.log(`fenetres derivees — parlee a ${wParle.ss}s (${wParle.t}s) · muette a ${wTait.ss}s (${wTait.t}s)`);

const parle = moyenne(SORTIE, ['-ss', wParle.ss, '-t', wParle.t]);
const tait = moyenne(SORTIE, ['-ss', wTait.ss, '-t', wTait.t]);
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
