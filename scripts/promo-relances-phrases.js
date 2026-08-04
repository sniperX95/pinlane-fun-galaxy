// DECOUPER LA PRISE EN UN FICHIER PAR PHRASE, POUR QUE LE FILM N'AIT JAMAIS A
// CHERCHER DANS UN MP3.
//
// Symptome : « il y a des debuts de phrases qui sont oublies ». Mesure sur le
// film livre, par transcription : les lignes 1 a 5 sont intactes, les lignes 6 a
// 12 perdent TOUTES leur premier mot. Et ces premiers mots sont les connecteurs
// (« Et », « Mais », « Parce », « Il ») : les plus courts, donc les plus fragiles.
//
// LA CAUSE. Chaque phrase etait jouee par une sequence qui ouvrait son propre
// element audio et devait CHERCHER dans le MP3 a la position voulue. Plus la
// position est profonde dans le fichier, plus le decodeur met de temps a se
// caler, et il avale le debut. Une amorce de 0,3 s a suffi pour les cinq
// premieres lignes et pas pour les suivantes : le defaut est PROGRESSIF, ce qui
// explique qu'une constante ne puisse pas le corriger.
//
// LA CORRECTION. Chaque phrase devient SON PROPRE FICHIER. Le film le joue
// depuis le debut, donc il n'y a plus aucune recherche, donc plus rien a avaler.
// C'est aussi ce qui avait marche dans les essais de montage ffmpeg : la decoupe
// individuelle etait correcte, c'est l'assemblage qui echouait. On garde ce qui
// marchait et on laisse Remotion faire le reste.
//
// Usage : node scripts/promo-relances-phrases.js [kael|michael]

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHOIX = (process.argv[2] || 'kael').toLowerCase();
const AUDIO = path.join(ROOT, 'marketing/promo-video/shotcraft/public/audio');
const PRISE = path.join(AUDIO, `prise-${CHOIX}.mp3`);
const TABLE = path.join(ROOT, `marketing/promo-video/shotcraft/src/relances/narration-${CHOIX}.json`);

if (!fs.existsSync(PRISE)) { console.error(`prise introuvable : ${PRISE}`); process.exit(1); }
const N = JSON.parse(fs.readFileSync(TABLE, 'utf8'));

// LA COUPE SE CALE SUR LES SILENCES MESURES, pas sur l'alignement : celui-ci
// date le premier CARACTERE et non le premier SON, avec 38 a 284 ms d'ecart
// selon la phrase. Une constante d'air ne peut pas tenir.
const releverSilences = () => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', PRISE,
    '-af', 'silencedetect=noise=-34dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' });
  const texte = (r.stderr || '') + (r.stdout || '');
  const out = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let m = re.exec(texte);
  while (m) { out.push({ de: Number(m[1]), a: Number(m[2]) }); m = re.exec(texte); }
  return out;
};
const SILENCES = releverSilences();
const dureePrise = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', PRISE], { encoding: 'utf8' }).trim());

// L'ATTAQUE EST PRIORITAIRE SUR LA CHUTE : une phrase amputee de sa premiere
// consonne s'entend, une queue raccourcie de 100 ms ne s'entend pas.
const MARGE_ATTAQUE = 0.12;
const AIR_QUEUE = 0.30;

const rates = [];
const decoupe = N.lignes.map((l, i) => {
  const avant = SILENCES.filter((s) => s.a <= l.de + 0.03).pop();
  let depart = avant ? Math.max(avant.a - MARGE_ATTAQUE, avant.de + 0.01) : l.de - MARGE_ATTAQUE;
  if (depart > l.de - 0.04) depart = l.de - MARGE_ATTAQUE;
  depart = Math.max(0, depart);
  const apres = SILENCES.find((s) => s.de >= l.a - 0.03);
  const fin = Math.min(apres ? apres.de + 0.08 : l.a + AIR_QUEUE, l.a + AIR_QUEUE, dureePrise);
  const longueur = fin - depart;

  const f = path.join(AUDIO, `phrase-${CHOIX}-${i}.mp3`);
  // `atrim` ET NON `-ss`. Mesure sur cette prise : `-i fichier -ss X -t Y` rend
  // un fichier SILENCIEUX des que X depasse une quinzaine de secondes, alors que
  // le fichier contient du son partout (verifie par `atrim` fenetre par
  // fenetre). `-ss` negocie avec les trames MP3 ; `atrim` travaille APRES le
  // decodage, donc a l'echantillon pres. C'est la primitive fiable ici, et c'est
  // la quatrieme fois de ce film que `-ss` ment.
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-i', PRISE,
    '-af', `atrim=start=${depart.toFixed(4)}:end=${fin.toFixed(4)},asetpts=N/SR/TB,`
      + `afade=t=in:st=0:d=0.012,afade=t=out:st=${Math.max(0, longueur - 0.09).toFixed(3)}:d=0.09`,
    '-ar', '44100', '-ac', '1', '-b:a', '192k', f], { stdio: ['ignore', 'pipe', 'pipe'] });

  const vraie = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
  if (Math.abs(vraie - longueur) > 0.15) {
    rates.push(`phrase ${i + 1} : ${vraie.toFixed(2)}s au lieu de ${longueur.toFixed(2)}s`);
  }

  // GARDE `chaque-phrase-sonne` : il doit y avoir du SON dans le fichier. Une
  // duree correcte ne prouve rien sur le contenu, quatre montages successifs
  // l'ont montre.
  const v = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f,
    '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const mv = /mean_volume:\s*(-?[\d.]+) dB/.exec((v.stderr || '') + (v.stdout || ''));
  const niveau = mv ? Number(mv[1]) : null;
  if (niveau === null || niveau < -55) rates.push(`phrase ${i + 1} : silencieuse (${niveau} dB)`);

  // GARDE `attaque-preservee` : combien de silence avant le premier son ?
  const marge = l.de - depart;
  if (marge < 0.03) rates.push(`phrase ${i + 1} : coupee ${(marge * 1000).toFixed(0)} ms avant le son, trop juste`);

  return { i, fichier: path.basename(f), longueur: vraie, amorce: marge, niveau, texte: l.texte };
});

console.log(`${decoupe.length} phrases decoupees depuis une prise de ${dureePrise.toFixed(2)}s`);
decoupe.forEach((d) => console.log(`  ${String(d.i + 1).padStart(2)}. ${d.longueur.toFixed(2)}s`
  + `  amorce ${(d.marge * 1000).toFixed(0)} ms  ${String(d.niveau).padStart(6)} dB  ${d.texte.slice(0, 42)}`));

if (rates.length) {
  console.error('\nECHEC :');
  rates.forEach((r) => console.error('  - ' + r));
  process.exit(1);
}
// LE MANIFESTE. `amorce` est le silence garde AVANT le premier son : la scene
// recule la sequence d'autant pour que la voix tombe quand meme a son instant.
// Sans lui, chaque phrase partirait 120 a 350 ms trop tard, et le decalage
// varierait d'une phrase a l'autre.
const MANIFESTE = path.join(ROOT, `marketing/promo-video/shotcraft/src/relances/phrases-${CHOIX}.json`);
fs.writeFileSync(MANIFESTE, `${JSON.stringify(decoupe.map((d) => ({
  i: d.i, fichier: d.fichier, amorce: Number(d.amorce.toFixed(4)), duree: d.longueur,
})), null, 2)}
`);
console.log(`manifeste : ${path.relative(ROOT, MANIFESTE)}`);
console.log('OK : chaque phrase a son fichier, sonne, et garde son attaque.');
