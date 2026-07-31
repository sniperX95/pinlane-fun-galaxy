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
// -18, ET NON -15. On ne monte pas la nappe en la poussant : le mixage tapait
// deja dans le limiteur, qui ravalait tout ce qu'on ajoutait (3 dB de nappe en
// plus n'en donnaient que 0,9 a l'arrivee). On BAISSE donc les autres pistes pour
// faire de la place, et une normalisation finale remonte l'ensemble d'un bloc —
// l'equilibre entre les trois est ce qui compte, pas leur niveau absolu.
const CIBLE_VOIX = -18;
const CIBLE_SFX = -30;
// -24. QUATRIEME REGLAGE, ET CELUI-CI EST FONDE SUR UNE MESURE DIRECTE.
//
// Movsar a redemande « une petite musique en fond » QUATRE fois. J'ai enfin
// isole la nappe du mixage livre — en soustrayant la version sans musique de la
// version avec — et mesure ce qui restait : -29,5 dB de moyenne, jusqu'a -34 dB
// par sections. Soit 11 a 15 dB sous la voix. Elle etait la au sens technique et
// absente au sens ou on l'entend.
//
// Le reste de ce commentaire garde l'historique des essais, parce qu'il explique
// pourquoi il a fallu quatre tours pour arriver a une mesure au lieu d'une
// garde indirecte.
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
// LA CIBLE EST UN NIVEAU AVANT ATTENUATION, PAS LE NIVEAU FINAL.
//
// Mesure qui a corrige ce reglage : cible a -24, nappe isolee du mixage a -29,4.
// L'ecart de 5,4 dB, c'est l'attenuation sous la voix — et le film parle 73 % du
// temps, donc elle s'applique presque partout. Je reglais une cible que le mixage
// ne voyait jamais.
// -25, ET NON -21. LA CIBLE EST PROPRE AU FICHIER, PAS AU MIXAGE.
//
// Le morceau a ete regenere sur la nouvelle structure (six mouvements, 76 s), et
// son arc porte plus de sections en conduite : -16,3 dB de moyenne contre -20 et
// des pour le precedent. A cible identique, la nappe est ressortie a 6,6 dB sous
// le mixage — la garde l'a refusee, dans le bon sens cette fois : elle disputait
// la place a la voix. Quatre dB de moins la remettent dans la fenetre.
//
// C'est la contrepartie de la mesure par soustraction : la garde attrape
// maintenant les DEUX cotes, pas seulement la nappe absente.
// -23 apres regeneration du morceau : son arc est plus creuse qu'avant (ouverture
// a -19,7 dB, conduite a -12,8), donc a cible egale il ressortait a 12,2 dB sous
// le mixage — dans la fenetre, mais a son bord bas. Deux dB le remettent au
// milieu. La cible se rejuge a CHAQUE nouveau fichier : elle decrit ce
// fichier-la, pas le mixage.
const CIBLE_MUSIQUE = -23;

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
  // Seuil remonte a 0,09 et ratio 4 : l'arc compose couvre 18 dB, et ses sections
  // sparses tombaient sous le seuil d'audibilite une fois la nappe normalisee sur
  // sa moyenne. On resserre plus fermement — l'intention musicale (la musique
  // ENTRE au basculement) survit, mais aucune section n'est plus inaudible.
  '-af', 'acompressor=threshold=0.09:ratio=4:attack=80:release=1200:makeup=2,aresample=48000',
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

// --- CHAQUE PHRASE EST PRELEVEE AVEC L'AIR QUI L'ENTOURE --------------------
//
// « La voix change et c'est pas fluide entre chaque. » La prise est pourtant
// UNIQUE — un seul appel, un seul timbre. Le defaut n'etait pas la synthese,
// c'etait le DECOUPAGE : `atrim` partait exactement du premier caractere aligne
// et s'arretait exactement au dernier. Une phrase coupee la perd son attaque
// (les occlusives sont tranchees en plein milieu) et sa chute (la fin de
// syllabe et la respiration), et les deux bouts nus se recollent en un point de
// montage audible. Quinze phrases, quinze points de montage : ca s'entend comme
// quinze prises differentes.
//
// On prend donc un peu avant et un peu apres, et on fond les deux extremites
// pour qu'aucun raccord ne claque. COMBIEN d'air exactement : voir juste en
// dessous — la premiere version le choisissait, la seconde le MESURE.
const FONDU = 0.04;

// LA COUPE SE CALE SUR LE SILENCE REEL, PAS SUR UN DECALAGE CHOISI.
//
// « Il dit "Inlane" au lieu de "Pinlane", et des fois il oublie les premiers
// mots. » Mesure qui a tranche : on compare, pour chaque phrase, l'instant
// annonce par l'alignement de la synthese et l'instant ou le silence se termine
// vraiment (`silencedetect`). L'ALIGNEMENT RETARDE L'ATTAQUE DE 38 A 284 ms
// selon la phrase — il date le premier caractere, pas le debut du son.
//
// Mon air d'entree etait une constante de 100 ms. Il suffisait pour la moitie
// des phrases et rognait l'autre moitie : la derniere ligne perdait 136 ms,
// c'est-a-dire exactement l'occlusion et l'explosion du « P » de Pinlane.
//
// Augmenter la constante n'aurait fait que deplacer le probleme (trop d'air sur
// les phrases qui n'en ont pas besoin, et collision avec la precedente). On
// MESURE donc : la coupe se pose dans le silence qui precede, un peu avant que
// le son ne commence. Une phrase ne peut plus perdre son attaque, quelle que
// soit la prise.
const APRES = 0.24;
const MARGE_ATTAQUE = 0.035;   // on entre dans le silence, pas au ras du son
const AIR_MAX = 0.45;

const silences = (() => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', VOIX_COMP,
    '-af', 'silencedetect=noise=-40dB:d=0.08', '-f', 'null', '-'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const t = String(r.stderr || '').replace(/\r/g, '');
  const debuts = [...t.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const fins = [...t.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return debuts.map((x, i) => ({ de: x, a: fins[i] })).filter((x) => x.a !== undefined);
})();
if (silences.length < PHRASES.length - 1) {
  console.error(`seulement ${silences.length} silences detectes pour ${PHRASES.length} phrases`
    + ' — la prise n\'est pas decoupable, verifier les pauses entre lignes');
  process.exit(1);
}

/** Ou le son commence-t-il VRAIMENT avant `t` ? (fin du dernier silence) */
const onde = (t) => {
  const s = silences.filter((x) => x.a <= t + 0.02).pop();
  return s ? s.a : null;
};
/** Et ou s'arrete-t-il apres `t` ? (debut du silence suivant) */
const repos = (t) => {
  const s = silences.find((x) => x.de >= t - 0.02);
  return s ? s.de : null;
};

// 1. L'ATTAQUE D'ABORD. Elle est prioritaire sur la chute : c'est elle qu'on
//    entend manquer.
PHRASES.forEach((p, i) => {
  const debutSon = onde(p.de);
  const besoin = debutSon === null ? 0.12 : Math.max(0, p.de - debutSon + MARGE_ATTAQUE);
  const prec = PHRASES[i - 1];
  const trouAvant = prec ? p.at - (prec.at + (prec.a - prec.de)) : p.at;
  p.avant = Math.min(AIR_MAX, besoin, Math.max(0, trouAvant - 0.06));
  p.debutSon = debutSon;
});

// 2. LA CHUTE PREND CE QUI RESTE dans le trou, une fois l'attaque de la suivante
//    servie. Elle s'arrete de toute facon au silence qui suit la phrase.
PHRASES.forEach((p, i) => {
  const suiv = PHRASES[i + 1];
  const trouApres = suiv ? suiv.at - (p.at + (p.a - p.de)) : Infinity;
  const finSon = repos(p.a);
  const utile = finSon === null ? APRES : Math.max(0.05, finSon - p.a + 0.05);
  p.apres = Math.min(APRES, utile,
    suiv ? Math.max(0, trouApres - (suiv.avant || 0) - 0.02) : APRES);
});

PHRASES.forEach((p, i) => {
  const prec = PHRASES[i - 1];
  const suiv = PHRASES[i + 1];
  const deb = Math.max(0, p.de - p.avant, prec ? prec.a + 0.02 : 0);
  const fin = Math.min(DV, p.a + p.apres, suiv ? suiv.de - 0.02 : DV);
  p.deb = +deb.toFixed(3);
  p.fin = +Math.max(fin, p.a).toFixed(3);
  // Le decalage vers l'amont doit etre RENDU au placement : sinon toute la
  // phrase avance et les mots ne tombent plus sur leurs images.
  p.pose = +(p.at - (p.de - p.deb)).toFixed(3);
});

// GARDE : AUCUNE PHRASE NE PERD SON ATTAQUE. C'est la garde qui manquait — le
// defaut etait audible depuis plusieurs versions et rien ne le mesurait.
const rognees = PHRASES.filter((p) => p.debutSon !== null && p.deb > p.debutSon - 0.005);
if (rognees.length) {
  rognees.forEach((p) => console.error(
    `  - « ${p.texte.slice(0, 44)}… » coupee a ${p.deb.toFixed(3)}s alors que le son`
    + ` commence a ${p.debutSon.toFixed(3)}s : ${Math.round((p.deb - p.debutSon) * 1000)} ms d'attaque perdus`));
  process.exit(1);
}

// GARDE : les segments elargis ne doivent pas se chevaucher.
const collisions = PHRASES.filter((p, i) => {
  const s = PHRASES[i + 1];
  return s && p.pose + (p.fin - p.deb) > s.pose + 0.01;
});
if (collisions.length) {
  collisions.forEach((p) => console.error(`  - « ${p.texte.slice(0, 40)}… » mord sur la phrase suivante`));
  process.exit(1);
}

const pire = PHRASES.reduce((m, p) => Math.min(m, p.debutSon === null ? 1 : p.debutSon - p.deb), 1);
const air = PHRASES.reduce((s, p) => s + (p.fin - p.deb) - (p.a - p.de), 0);
console.log(`decoupe : ${air.toFixed(2)}s d'air rendu · attaque la plus juste :`
  + ` ${Math.round(pire * 1000)} ms avant le son (aucune phrase rognee)`);

// --- construction du graphe ------------------------------------------------
const chaines = [];
// Le segment porte son air et ses deux fondus (voir plus haut) : plus aucun
// raccord ne claque, et l'attaque de chaque phrase est entiere.
const segment = (p, sortie) => {
  const ms = Math.round(p.pose * 1000);
  const duree = +(p.fin - p.deb).toFixed(3);
  return `[1:a]atrim=start=${p.deb}:end=${p.fin},asetpts=N/SR/TB,`
    + `afade=t=in:st=0:d=${FONDU},`
    + `afade=t=out:st=${Math.max(0, duree - FONDU).toFixed(3)}:d=${FONDU},`
    + `adelay=${ms}|${ms},volume=${gVoix.toFixed(4)}[${sortie}]`;
};

PHRASES.forEach((p, i) => { chaines.push(segment(p, `v${i}`)); });
const voixIn = PHRASES.map((_, i) => `[v${i}]`).join('');
chaines.push(`${voixIn}amix=inputs=${PHRASES.length}:normalize=0:dropout_transition=0,`
  + `apad=whole_dur=${D}[voix]`);
chaines.push(`[0:a]volume=${gSfx.toFixed(4)}[sfx]`);

// La chaine equivalente SANS musique, gardee pour la garde 2 : elle sert a
// produire la reference qu'on soustrait.
const chainesSansMusique = [];
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
    // Attenuation ALLEGEE (ratio 2, seuil 0,06) : elle degage la voix sans faire
  // disparaitre la nappe. Une nappe qui ne s'entend que dans les trous ne
  // s'entend jamais sur un film qui parle les trois quarts du temps.
  chaines.push('[mus][voixDuck]sidechaincompress=threshold=0.06:ratio=2:attack=10:release=600:makeup=1[musDuck]');
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

// Meme graphe, sans la piste musicale : les phrases, le meme gain, les memes
// bruitages, le meme limiteur. La difference avec le mixage complet est donc
// exactement la nappe.
PHRASES.forEach((p, i) => { chainesSansMusique.push(segment(p, `w${i}`)); });
chainesSansMusique.push(`${PHRASES.map((_, i) => `[w${i}]`).join('')}`
  + `amix=inputs=${PHRASES.length}:normalize=0:dropout_transition=0,apad=whole_dur=${D}[voixR]`);
chainesSansMusique.push(`[0:a]volume=${gSfx.toFixed(4)}[sfxR]`);
chainesSansMusique.push('[sfxR][voixR]amix=inputs=2:normalize=0,'
  + 'alimiter=limit=0.85:level=disabled,aresample=48000[out]');

const args = ['-y', '-v', 'error', '-i', FILM, '-i', VOIX_COMP];
if (!SANS_MUSIQUE) args.push('-i', MUSIQUE_COMP);
args.push('-filter_complex', chaines.join(';'),
  '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', '-shortest', SORTIE);
// PREMIERE PASSE : on fabrique le mixage a son equilibre, sans se soucier du
// niveau absolu. DEUXIEME PASSE : on mesure ce qu'il donne et on applique le gain
// unique qui l'amene a la cible. C'est ce qui permet de baisser les trois sources
// pour laisser respirer la nappe sans livrer un film trop faible.
const CIBLE_MIXAGE = -16.5;
execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
{
  const brut = moyenne(SORTIE);
  const g = gain(brut.moy, CIBLE_MIXAGE);
  if (Math.abs(20 * Math.log10(g)) > 0.3) {
    const provisoire = SORTIE.replace(/\.mp4$/, '-brut.mkv');
    fs.renameSync(SORTIE, provisoire);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', provisoire,
      '-af', `volume=${g.toFixed(4)},alimiter=limit=0.85:level=disabled,aresample=48000`,
      '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', SORTIE], { stdio: ['ignore', 'ignore', 'inherit'] });
    fs.unlinkSync(provisoire);
    console.log(`normalisation finale : ${brut.moy} dB -> cible ${CIBLE_MIXAGE} dB (x${g.toFixed(3)})`);
  }
}

// --- verification ----------------------------------------------------------
const nOut = moyenne(SORTIE);
console.log(`\nsortie : ${path.relative(ROOT, SORTIE)}`);
console.log(`niveau global ${nOut.moy} dB (crete ${nOut.max} dB)`);

// GARDE 1 : pas de saturation.
if (nOut.max > -0.5) { console.error('ECHEC : crete a ' + nOut.max + ' dB, ca sature'); process.exit(1); }

// GARDE 2 : LA NAPPE EST-ELLE AUDIBLE, ET LA VOIX PASSE-T-ELLE AU-DESSUS ?
//
// Les trois versions precedentes de cette garde comparaient le niveau GLOBAL de
// deux fenetres du mixage. C'est un proxy, et un mauvais : avec une nappe
// volontairement presente, l'ecart entre « avec voix » et « sans voix » se
// resserre, et la garde criait au loup pendant que Movsar, lui, n'entendait
// toujours pas la musique.
//
// On mesure maintenant la nappe ELLE-MEME. On produit le mixage sans musique,
// on le soustrait du mixage complet, et ce qui reste EST la musique — rien
// d'autre. Deux exigences sur ce residu :
//   - assez fort pour exister (au-dessus de -32 dB de moyenne) ;
//   - assez bas pour laisser passer la voix (au moins 5 dB sous elle).
if (!SANS_MUSIQUE) {
  const sansMus = SORTIE.replace(/\.mp4$/, '-ref-sans-musique.mp4');
  const argsRef = ['-y', '-v', 'error', '-i', FILM, '-i', VOIX_COMP,
    '-filter_complex', chainesSansMusique.join(';'),
    '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'pcm_s16le',
    '-shortest', sansMus.replace(/\.mp4$/, '.mkv')];
  execFileSync('ffmpeg', argsRef, { stdio: ['ignore', 'ignore', 'inherit'] });
  const seule = SORTIE.replace(/\.mp4$/, '-nappe-seule.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', SORTIE, '-i', sansMus.replace(/\.mp4$/, '.mkv'),
    '-filter_complex', '[0:a][1:a]amerge=inputs=2,pan=mono|c0=c0-c1',
    '-c:a', 'pcm_s16le', seule], { stdio: ['ignore', 'ignore', 'inherit'] });

  const nappe = moyenne(seule);
  const global = moyenne(SORTIE);
  console.log(`nappe isolee : ${nappe.moy} dB (crete ${nappe.max}) · mixage ${global.moy} dB`);
  fs.unlinkSync(sansMus.replace(/\.mp4$/, '.mkv'));
  fs.unlinkSync(seule);

  // LE CRITERE EST UN ECART, PAS UN NIVEAU ABSOLU.
  //
  // Un seuil en dB absolus ne veut rien dire : il depend du niveau general du
  // mixage, qu'une normalisation finale deplace. Ce qui s'entend, c'est la
  // DISTANCE entre la nappe et le reste. Au-dela de 14 dB elle passe inapercue —
  // c'est ce qui s'est produit quatre fois de suite. En deca de 7 dB elle
  // dispute sa place a la voix.
  const ecart = global.moy - nappe.moy;
  console.log(`ecart nappe / mixage : ${ecart.toFixed(1)} dB (fenetre visee : 7 a 14)`);
  if (ecart > 14) {
    console.error(`ECHEC : la nappe est ${ecart.toFixed(1)} dB sous le mixage — on ne l'entendra pas`);
    process.exit(1);
  }
  if (ecart < 7) {
    console.error(`ECHEC : la nappe n'est qu'a ${ecart.toFixed(1)} dB sous le mixage — elle couvre la voix`);
    process.exit(1);
  }
}

// (L'ancienne garde 3 mesurait la nappe dans une fenetre « sans voix » du
// mixage. Elle est remplacee par la mesure directe ci-dessus : on isole la nappe
// par soustraction au lieu de l'estimer depuis un trou de la narration, qui ne
// contenait de toute facon jamais que du bruitage.)

// GARDE 3 : la duree ne doit pas bouger.
const DS = duree(SORTIE);
if (Math.abs(DS - D) > 0.12) {
  console.error(`ECHEC : duree ${DS.toFixed(2)}s au lieu de ${D.toFixed(2)}s`);
  process.exit(1);
}

console.log('\nphrase -> plan :');
PHRASES.forEach((p, i) => console.log(
  `  ${(i + 1)}. ${p.pose.toFixed(2)}s (${(p.fin - p.deb).toFixed(2)}s)  ${p.plan.padEnd(9)} ${p.texte}`));
console.log('\nOK : voix dominante, nappe audible, pas de saturation, duree intacte');
