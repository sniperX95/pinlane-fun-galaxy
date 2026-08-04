// LE MIXAGE, ET LA GARDE QUI MESURE LA NAPPE DANS LE FICHIER LIVRE.
//
// « Pourquoi y'a toujours pas de musique en fond ? » a ete pose QUATRE fois sur
// le film precedent alors que la musique etait la : a 11 a 15 dB sous la voix,
// donc inaudible. La garde qui la surveillait mesurait un PROXY.
//
// Ici on mesure par SOUSTRACTION : on produit le mixage sans la nappe, on
// soustrait les deux pistes, et on mesure ce qui reste. C'est cette nappe telle
// qu'elle sort reellement, attenuation et limiteur compris.
//
// Fenetre qui tient (mesuree sur le film precedent) : nappe isolee entre 7 et
// 14 dB sous le mixage. En dessous de 7 elle couvre la voix, au dela de 14 on
// ne l'entend plus.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head';
const SHOT = path.join(ROOT, 'marketing/promo-video/shotcraft');
const MUSIQUE = process.argv[2];
if (!MUSIQUE || !fs.existsSync(MUSIQUE)) { console.error('musique introuvable'); process.exit(1); }

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const mesure = (fichier) => {
  const r = require('child_process').spawnSync('ffmpeg',
    ['-hide_banner', '-i', fichier, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const sortie = (r.stderr || '') + (r.stdout || '');
  const moy = /mean_volume:\s*(-?[\d.]+) dB/.exec(sortie);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(sortie);
  return { moyenne: moy ? Number(moy[1]) : null, crete: max ? Number(max[1]) : null };
};

// La sonie visee pour le fichier livre. Les reseaux lisent autour de -14 LUFS ;
// -15 laisse une marge de crete sans sonner en dessous des autres videos du fil.
const CIBLE_LUFS = -15;

/** La SONIE INTEGREE, en LUFS. C'est ce que l'oreille et les plateformes
 *  entendent : elle ignore les silences, contrairement a la moyenne de niveau. */
const sonie = (fichier) => {
  const r = require('child_process').spawnSync('ffmpeg',
    ['-hide_banner', '-nostats', '-i', fichier, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const m = /I:\s*(-?[\d.]+) LUFS/.exec((r.stderr || '') + (r.stdout || ''));
  return m ? Number(m[1]) : null;
};

const CIBLE_MUSIQUE = -23;   // niveau vise pour la nappe, avant mixage
const CIBLE_MIX = -16;       // niveau du fichier livre
const rates = [];

for (const voix of ['kael', 'michael']) {
  const film = path.join(SHOT, `out/relances-${voix}.mp4`);
  if (!fs.existsSync(film)) { console.log(`${voix} : film absent, ignore`); continue; }
  console.log(`\n${voix}`);
  const duree = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', film], { encoding: 'utf8' }).trim());

  // La nappe est normalisee A LA SOURCE puis posee a un coefficient proche de 1.
  // `volume` est un COEFFICIENT, pas un niveau cible : un fichier a -47 dB joue
  // a x4 multiplie aussi son souffle.
  // ON MIXE, ON MESURE, ON CORRIGE. La cible est le MILIEU de la fenetre.
  const VISE = 10.5;
  const voixSeule = mesure(film);
  let cible = (voixSeule.moyenne === null ? -23 : voixSeule.moyenne - 10);
  const sortie = path.join(SHOT, `out/relances-${voix}-mixe.mp4`);
  const sansMusique = path.join(SHOT, `out/relances-${voix}-sans-musique.mp4`);
  const isolee = path.join(SHOT, `out/_isolee-${voix}.wav`);
  const nappe = path.join(SHOT, `out/_nappe-${voix}.wav`);

  // La version sans musique ne depend pas de la nappe : une seule fois.
  ff(['-i', film, '-af', `loudnorm=I=${CIBLE_MIX}:TP=-1.2:LRA=11`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', sansMusique]);

  let mMix = null;
  let mNappe = null;
  let ecart = null;
  for (let passe = 1; passe <= 3; passe += 1) {
    ff(['-i', MUSIQUE, '-t', String(duree),
      '-af', `loudnorm=I=${cible.toFixed(1)}:TP=-3:LRA=7,afade=t=in:st=0:d=1.6,afade=t=out:st=${(duree - 2.4).toFixed(2)}:d=2.4`,
      '-ar', '48000', '-ac', '2', nappe]);
    ff(['-i', film, '-i', nappe,
      '-filter_complex', `[1:a]volume=1[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=${CIBLE_MIX}:TP=-1.2:LRA=11[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', sortie]);
    // MESURE PAR SOUSTRACTION : le mixage moins sa version sans nappe EST la
    // nappe telle qu'elle sort du fichier livre, limiteur compris.
    ff(['-i', sortie, '-i', sansMusique,
      '-filter_complex', '[0:a][1:a]amerge=inputs=2,pan=mono|c0=c0-c1[a]',
      '-map', '[a]', '-ar', '48000', isolee]);
    mMix = mesure(sortie);
    mNappe = mesure(isolee);
    ecart = mMix.moyenne - mNappe.moyenne;
    console.log(`  passe ${passe} : consigne ${cible.toFixed(1)} dB  ->  ecart ${ecart.toFixed(1)} dB`);
    if (Math.abs(ecart - VISE) < 1.2) break;
    cible += ecart - VISE;   // trop faible : on monte ; trop forte : on descend
  }

  console.log(`  mixage        ${mMix.moyenne} dB (crete ${mMix.crete})`);
  console.log(`  nappe isolee  ${mNappe.moyenne} dB`);
  console.log(`  ecart         ${ecart.toFixed(1)} dB     [fenetre 7 a 14]`);


  if (ecart === null) rates.push(`${voix} : ecart non mesurable`);
  else if (ecart < 7) rates.push(`${voix} : nappe a ${ecart.toFixed(1)} dB sous le mixage, elle couvre la voix`);
  else if (ecart > 14) rates.push(`${voix} : nappe a ${ecart.toFixed(1)} dB sous le mixage, on ne l'entend pas (c'est le defaut pose quatre fois)`);

  // --- LA SONIE, MESUREE PUIS CORRIGEE, EN BOUCLE -------------------------
  // Une seule passe ne suffit pas : LE LIMITEUR RAVALE CE QU'ON AJOUTE. Un gain
  // de +10,7 dB n'a rendu que 8,2 dB de sonie, parce que les cretes ont ete
  // ecretees en route. C'est exactement le piege deja paye sur la nappe du film
  // precedent, et la reponse est la meme : mesurer le resultat, corriger de
  // l'ecart, recommencer.
  let sonieAvant = sonie(sortie);
  const depart = sonieAvant;
  for (let passe = 1; passe <= 4; passe += 1) {
    const gain = CIBLE_LUFS - sonieAvant;
    if (Math.abs(gain) < 0.5) break;
    for (const f of [sortie, sansMusique]) {
      const tmp = f.replace(/\.mp4$/, '-tmp.mp4');
      ff(['-i', f, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.86:level=disabled`,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', tmp]);
      fs.renameSync(tmp, f);
    }
    sonieAvant = sonie(sortie);
    console.log(`  sonie passe ${passe} : gain ${gain.toFixed(1)} dB -> ${sonieAvant} LUFS`);
  }
  console.log(`  sonie         ${depart} -> ${sonieAvant} LUFS     [cible ${CIBLE_LUFS}]`);
  if (sonieAvant !== null && Math.abs(sonieAvant - CIBLE_LUFS) > 1.2) {
    rates.push(`${voix} : sonie a ${sonieAvant} LUFS au lieu de ${CIBLE_LUFS}`);
  }

  // LA CRETE SE MESURE SUR CE QUI EST LIVRE, pas sur un intermediaire. Elle
  // etait relevee AVANT la boucle de gain, donc sur un fichier que personne ne
  // recoit : la garde rougissait sur une valeur qui n'existait plus.
  const creteFinale = mesure(sortie).crete;
  if (creteFinale !== null && creteFinale > -0.6) {
    rates.push(`${voix} : crete a ${creteFinale} dB apres gain, risque de saturation apres AAC`);
  }
  console.log(`  crete livree  ${creteFinale} dB`);

  // Livraison web : on REDUIT en lanczos depuis le rendu 2160, c'est la que se
  // gagne l'anticrenelage. CRF 20 et non 24 : mesure faite sur du texte bleu,
  // qui perd trois fois plus que le reste en 4:2:0.
  const web = path.join(SHOT, `out/relances-${voix}-web.mp4`);
  ff(['-i', sortie, '-vf', 'scale=1080:1080:flags=lanczos',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', web]);
  const ko = Math.round(fs.statSync(web).size / 1024);
  console.log(`  livre         ${(ko / 1024).toFixed(1)} Mo en 1080x1080`);
}

console.log('');
if (rates.length) { console.error('ECHEC :'); rates.forEach((r) => console.error('  - ' + r)); process.exit(1); }
console.log('OK : nappe audible sans couvrir la voix, aucune saturation.');
