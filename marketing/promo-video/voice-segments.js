// ASSEMBLE UNE VOIX OFF A PARTIR DE SEGMENTS, UN PAR PLAN.
//
// POURQUOI PAS UN SEUL FICHIER DE VOIX.
//
// Caler les plans sur une voix generee d'une traite oblige a DEVINER ou finit
// chaque phrase. On le deduit des silences : et ca ne marche pas : sur la voix
// de ce film, `silencedetect` trouve 37 blancs, presque tous inter-syllabes.
// Rien ne distingue « fin de phrase » de « respiration au milieu d'un mot
// compose ». Les bornes finissent ecrites a la main, et elles se desynchronisent
// des que la voix est regeneree.
//
// Ici chaque plan a SON fichier. La borne n'est plus deduite, elle est
// CONSTRUITE : debut = somme des durees precedentes. Regenerer un segment
// decale automatiquement tout ce qui suit, sans qu'aucune valeur soit a
// retoucher. Le montage ne peut plus se desynchroniser de la voix.
//
// Le script rogne aussi le silence de tete et de queue de chaque segment -
// ElevenLabs en ajoute environ 0,1 s de chaque cote, ce qui ferait 1,8 s de
// vide cumule sur neuf plans : puis pose des respirations CHOISIES entre eux.
//
// Sortie : <sortie>.wav + <sortie>-plans.js (window.PROMO_PLANS)
//
// Usage : node marketing/promo-video/voice-segments.js <dossier-seg> <sortie>

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.resolve(ROOT, process.argv[2] || 'artifacts/promo-video/seg');
const OUT = path.resolve(ROOT, process.argv[3] || 'artifacts/promo-video/voix-samedi-plans');

// Respiration APRES chaque plan, en secondes. C'est le rythme du film : une
// valeur par plan, assumee, plutot qu'un silence subi.
// La pause du plan 3 est la plus longue du film : c'est le silence AVANT la
// bascule. Sans elle, « le même samedi, avec Pinlane » arrive sans respiration
// et la charniere du recit passe inapercue.
const PAUSES = [0.18, 0.16, 0.52, 0.24, 0.18, 0.22, 0.00];

// Accelere l'ensemble une fois assemble. Les bornes des plans sont DIVISEES
// par le facteur mesure, pas par celui demande : `atempo` ne rend pas
// exactement le ratio annonce, et un ecart de 1 % sur 25 s fait un quart de
// seconde de decalage a la fin : assez pour que la voix parle sur le plan
// suivant. On mesure, on ne suppose pas.
const TEMPO = Number((process.argv.find((a) => a.startsWith('--tempo=')) || '--tempo=1').split('=')[1]);

// Texte reecrit en francais PARLE : le premier jet etait telegraphique
// (« Samedi. Onze heures quatre. Une resa tombe. »), ce qui sonne artificiel
// des qu'une voix de synthese le lit. Les liens logiques : « le temps que »,
// « sans que tu y penses » : sont ce qui fait entendre quelqu'un plutot
// qu'une liste.
// Le film parle en RESERVATIONS, plus en euros. « Six cent un euros, quatre
// reservations » sonnait faux : non parce que le chiffre etait mal dit, mais
// parce qu'il etait petit : on ne vend pas un outil de pilotage sur une
// journee a l'arret. Les nombres viennent desormais d'une journee pleine
// (38 reservations, 297 joueurs, 76 % d'occupation) et restent tous LUS SUR
// L'ECRAN montre a cote.
// RECIT AVANT / APRES. Les versions precedentes enumeraient des capacites, et
// Movsar l'a dit : « ça n'évolue pas ». Une liste n'a pas de milieu : ici la
// bascule du plan 4 EST le sujet du film : la meme journee, avant et apres.
const TEXTES = [
  'Samedi, dix-huit heures. Le téléphone sonne pour la sixième fois.',
  'Tu cherches dans ton cahier si la piste quatre est libre.',
  'Tu rappelleras. Ou pas.',
  'Le même samedi, avec Pinlane.',
  'Trente-huit réservations tombées toutes seules. Deux cent quatre-vingt-dix-sept joueurs.',
  "Soixante-seize pour cent d'occupation. Zéro saisie.",
  'Pinlane. La console de ton centre.',
];

const duree = (f) => Number(execFileSync('ffprobe', ['-v', 'error',
  '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

// Premier et dernier instant ou ca parle. On ne se fie pas a la duree du
// fichier : le silence ajoute par le synthetiseur en fait partie.
function bornesParole(f) {
  // silencedetect ecrit sur stderr, pas sur stdout : execFileSync ne rend que
  // stdout et renvoyait donc null.
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f,
    '-af', 'silencedetect=noise=-40dB:d=0.04', '-f', 'null', '-'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const sortie = (r.stderr || '') + (r.stdout || '');
  const D = duree(f);
  const debuts = [...sortie.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const fins = [...sortie.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
  // Silence de tete = un silence qui commence a 0 (ou presque).
  const tete = (debuts.length && debuts[0] < 0.05 && fins.length) ? fins[0] : 0;
  // Silence de queue = un silence qui n'a pas de fin, ou qui finit au bout.
  const dernierDebut = debuts.length ? debuts[debuts.length - 1] : null;
  const queue = (dernierDebut !== null && debuts.length > fins.length) ? dernierDebut
    : (dernierDebut !== null && Math.abs(fins[fins.length - 1] - D) < 0.02 ? dernierDebut : D);
  return { tete: Math.max(0, tete - 0.02), queue: Math.min(D, queue + 0.03), D };
}

// PIEGE : les fichiers ElevenLabs se nomment `tts_<debut du texte>_<horodatage>`.
// Un tri alphabetique classe donc par CONTENU, pas par ordre de generation -
// « Dix-huit heures » passerait avant « Samedi ». On trie sur l'horodatage,
// seul champ qui porte l'ordre, et on refuse de deviner s'il manque.
const HORODATE = /_(\d{8}_\d{6})\.mp3$/;
const bruts = fs.readdirSync(DIR).filter((f) => f.endsWith('.mp3'));
const sansDate = bruts.filter((f) => !HORODATE.test(f));
if (sansDate.length) {
  console.error(`ECHEC : ${sansDate.length} fichier(s) sans horodatage, l'ordre serait devine : ${sansDate.join(', ')}`);
  process.exit(1);
}
const fichiers = bruts.sort((a, b) => HORODATE.exec(a)[1].localeCompare(HORODATE.exec(b)[1]));
if (fichiers.length !== TEXTES.length) {
  console.error(`ECHEC : ${fichiers.length} segments trouves pour ${TEXTES.length} textes attendus.`);
  process.exit(1);
}

const tmp = path.join(DIR, '.coupes');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const PLANS = [];
let curseur = 0;
const morceaux = [];

fichiers.forEach((f, i) => {
  const src = path.join(DIR, f);
  const b = bornesParole(src);
  const parle = b.queue - b.tete;
  const coupe = path.join(tmp, `c${String(i).padStart(2, '0')}.wav`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src,
    '-ss', String(b.tete), '-to', String(b.queue),
    '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', coupe]);
  const d = duree(coupe);
  const pause = PAUSES[i] || 0;
  PLANS.push({ i, texte: TEXTES[i], debut: +curseur.toFixed(3), fin: +(curseur + d).toFixed(3),
    duree: +d.toFixed(3), pause });
  console.log(`  plan ${i + 1}  ${curseur.toFixed(2)} -> ${(curseur + d).toFixed(2)}s`
    + `  (${d.toFixed(2)}s de parole, ${b.D.toFixed(2)}s brut, +${pause.toFixed(2)}s)  ${TEXTES[i].slice(0, 44)}`);
  morceaux.push(coupe);
  curseur += d + pause;
  if (pause > 0) {
    const sil = path.join(tmp, `s${String(i).padStart(2, '0')}.wav`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', `anullsrc=r=44100:cl=mono:d=${pause}`, '-c:a', 'pcm_s16le', sil]);
    morceaux.push(sil);
  }
});

const liste = path.join(tmp, 'liste.txt');
fs.writeFileSync(liste, morceaux.map((m) => `file '${m.replace(/\\/g, '/')}'`).join('\n'));
const wav = OUT + '.wav';
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', liste,
  '-c:a', 'pcm_s16le', wav]);

let totale = duree(wav);
// GARDE : la duree assemblee doit valoir la somme des plans et des pauses.
// Un ecart signale une coupe ratee ou un fichier manquant : silencieux sinon.
const attendue = PLANS.reduce((s, p) => s + p.duree + p.pause, 0);
const ecart = Math.abs(totale - attendue);
console.log(`\nvoix assemblee : ${totale.toFixed(2)}s (attendu ${attendue.toFixed(2)}s, ecart ${ecart.toFixed(3)}s)`);

if (TEMPO !== 1) {
  const brut = path.join(tmp, 'brut.wav');
  fs.copyFileSync(wav, brut);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', brut,
    '-filter:a', `atempo=${TEMPO}`, '-c:a', 'pcm_s16le', wav]);
  const apres = duree(wav);
  const facteur = totale / apres;          // mesure, pas suppose
  PLANS.forEach((p) => {
    p.debut = +(p.debut / facteur).toFixed(3);
    p.fin = +(p.fin / facteur).toFixed(3);
    p.duree = +(p.duree / facteur).toFixed(3);
    p.pause = +(p.pause / facteur).toFixed(3);
  });
  console.log(`tempo ${TEMPO} : ${totale.toFixed(2)}s -> ${apres.toFixed(2)}s (facteur mesure ${facteur.toFixed(4)})`);
  totale = apres;
}

fs.writeFileSync(OUT + '-plans.js',
  '// Genere par voice-segments.js : ne pas editer a la main.\n'
  + '// Chaque plan du montage se cale sur SON segment de voix : les bornes sont\n'
  + '// construites, pas deduites de silences.\n'
  + `window.PROMO_PLANS = ${JSON.stringify(PLANS, null, 2)};\n`
  + `window.PROMO_VOIX_DUREE = ${totale.toFixed(3)};\n`);
console.log(`bornes  : ${path.relative(ROOT, OUT + '-plans.js')}`);

if (ecart > 0.08) { console.error('ECHEC : la duree assemblee ne correspond pas aux plans'); process.exit(1); }
if (PLANS.some((p) => p.duree < 0.35)) {
  console.error('ECHEC : un plan dure moins de 0,35 s : segment vide ou mal coupe');
  process.exit(1);
}
console.log('OK : chaque plan porte de la parole, les bornes sont exactes');
