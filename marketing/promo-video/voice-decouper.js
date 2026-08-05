// DECOUPE UNE PRISE UNIQUE EN PLANS, SANS TOUCHER A LA VOIX.
//
// POURQUOI CE SCRIPT REMPLACE `voice-segments.js`.
//
// Generer un fichier par plan donnait des bornes exactes, mais un DEFAUT
// majeur que Movsar a entendu tout de suite : « les voix font que de changer,
// on dirait une personne differente a chaque fois ». C'est exact, et c'est
// mecanique : a `stability: 0` (mode Creative), le synthetiseur varie le
// timbre a chaque appel. Sept appels, sept voix.
//
// Monter la stabilite aplatit le jeu ; garder sept appels garde sept timbres.
// La sortie est de generer UNE SEULE PRISE (donc un seul timbre, une seule
// intention d'ensemble) puis de la DECOUPER.
//
// Le decoupage ne devine pas : pour chaque frontiere, on estime sa position
// d'apres le NOMBRE DE CARACTERES du texte deja dit, puis on prend le silence
// reellement detecte le plus proche de cette estimation. Le texte donne la
// structure, l'audio donne la precision. Aucune borne ecrite a la main.
//
// Sortie : <sortie>.wav (copie de la prise) + <sortie>-plans.js
//
// Usage : node marketing/promo-video/voice-decouper.js <prise.mp3> <sortie>

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.resolve(ROOT, process.argv[2] || 'artifacts/promo-video/voix-unique/voix-une-prise.mp3');
const OUT = path.resolve(ROOT, process.argv[3] || 'artifacts/promo-video/voix-bascule');

// Le texte, decoupe en plans. C'est la SEULE chose a maintenir : les instants
// s'en deduisent.
const PLANS_TEXTE = [
  'Un centre de loisirs, un jeudi. Huit pistes : du bowling, du laser, des formules.',
  'Les réservations arrivent en ligne. Toutes seules.',
  'Un client ? Tu le trouves en deux secondes.',
  'Le jour J, tu sais qui arrive, à quelle heure, et combien ils sont.',
  'Les dossiers qui demandent une action remontent tout seuls.',
  'Et le soir, tout est déjà compté. Sans une seule saisie.',
  'Pinlane. La console de ton centre.',
];

const duree = (f) => Number(execFileSync('ffprobe', ['-v', 'error',
  '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

// Silences reellement presents dans la prise. Seuil a -34 dB : plus selectif
// que -40, il ignore les micro-pauses entre syllabes qui rendaient la detection
// inutilisable sur les essais precedents (37 « blancs » pour 7 phrases).
function silences(f) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f,
    '-af', 'silencedetect=noise=-34dB:d=0.16', '-f', 'null', '-'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const texte = String(r.stderr || '');
  const debuts = [...texte.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const fins = [...texte.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
  return debuts.map((d, i) => ({ debut: d, fin: fins[i] !== undefined ? fins[i] : d, milieu: (d + (fins[i] || d)) / 2 }))
    .filter((s) => s.fin > s.debut);
}

if (!fs.existsSync(SRC)) { console.error(`prise introuvable : ${path.relative(ROOT, SRC)}`); process.exit(1); }
const D = duree(SRC);
const creux = silences(SRC);
console.log(`prise : ${D.toFixed(2)}s, ${creux.length} silences detectes`);
if (creux.length < PLANS_TEXTE.length - 1) {
  console.error(`ECHEC : ${creux.length} silences pour ${PLANS_TEXTE.length - 1} frontieres a placer.`);
  console.error('Marquer davantage les fins de phrase dans le texte, ou baisser le seuil.');
  process.exit(1);
}

// Estimation par le texte : proportion de caracteres dits avant chaque
// frontiere. La parole n'est pas exactement proportionnelle au texte, mais
// l'ecart est bien plus petit que l'espacement entre deux silences : donc le
// silence le plus proche est le bon.
// ON RAISONNE EN TEMPS DE PAROLE, PAS EN TEMPS D'HORLOGE.
//
// Estimer sur la duree totale suppose un debit constant : mais 2 s de silences
// s'y intercalent, et chaque silence decale tout ce qui suit. Les estimations
// tardives arrivaient 2,6 s en avance et l'affectation choisissait des silences
// internes aux phrases.
//
// La position d'un silence est donc mesuree en PAROLE ECOULEE : son debut moins
// la somme des silences qui le precedent. Comparee a une estimation elle aussi
// exprimee en parole, la correspondance devient directe.
const paroleTotale = D - creux.reduce((s, c) => s + (c.fin - c.debut), 0);
creux.forEach((c, j) => {
  const avant = creux.slice(0, j).reduce((s, x) => s + (x.fin - x.debut), 0);
  c.parole = c.debut - avant;
});
const total = PLANS_TEXTE.join(' ').length;
let cumul = 0;
const attendus = [];
for (let i = 0; i < PLANS_TEXTE.length - 1; i++) {
  cumul += PLANS_TEXTE[i].length + 1;
  attendus.push((cumul / total) * paroleTotale);
}

// AFFECTATION GLOBALE, PAS FRONTIERE PAR FRONTIERE.
//
// Choisir pour chaque frontiere le silence le plus proche echoue : la frontiere
// 2/3 a pris un silence INTERNE au plan 2 (« Tu cherches dans ton cahier |
// si la piste quatre est libre »), parce qu'il tombait a 0,38 s de son
// estimation contre 0,88 s pour le bon. Le plan 3 se retrouvait a 0,31 s.
//
// Un choix glouton ne peut pas voir cette erreur : elle n'apparait qu'en
// regardant l'ENSEMBLE. On resout donc par programmation dynamique : la suite
// ORDONNEE de k silences qui minimise la somme des ecarts. Chaque frontiere
// accepte un moins bon voisin si cela permet aux suivantes d'etre justes.
const k = attendus.length;
const n = creux.length;
const INF = Infinity;
// cout[i][j] = meilleur cout pour placer les frontieres 0..i, la i-eme sur le
// silence j.
const cout = Array.from({ length: k }, () => new Array(n).fill(INF));
const prov = Array.from({ length: k }, () => new Array(n).fill(-1));
for (let j = 0; j < n; j++) cout[0][j] = Math.abs(creux[j].parole - attendus[0]);
for (let i = 1; i < k; i++) {
  for (let j = i; j < n; j++) {
    const propre = Math.abs(creux[j].parole - attendus[i]);
    for (let q = i - 1; q < j; q++) {
      if (cout[i - 1][q] === INF) continue;
      const total2 = cout[i - 1][q] + propre;
      if (total2 < cout[i][j]) { cout[i][j] = total2; prov[i][j] = q; }
    }
  }
}
let fin = -1, meilleur = INF;
for (let j = k - 1; j < n; j++) if (cout[k - 1][j] < meilleur) { meilleur = cout[k - 1][j]; fin = j; }
if (fin === -1) { console.error('ECHEC : aucune suite ordonnee de silences ne convient'); process.exit(1); }
const indices = new Array(k);
for (let i = k - 1, j = fin; i >= 0; i--) { indices[i] = j; j = prov[i][j]; }
const frontieres = indices.map((j) => creux[j]);
console.log(`decoupage : ecart total ${meilleur.toFixed(2)}s sur ${k} frontieres`);

const PLANS = [];
let depart = 0;
PLANS_TEXTE.forEach((txt, i) => {
  const f = frontieres[i];
  const fin = f ? f.debut : D;
  PLANS.push({ i, texte: txt, debut: +depart.toFixed(3), fin: +fin.toFixed(3),
    duree: +(fin - depart).toFixed(3), pause: f ? +(f.fin - f.debut).toFixed(3) : 0 });
  const ecart = f ? Math.abs(f.parole - attendus[i]) : 0;
  console.log(`  plan ${i + 1}  ${depart.toFixed(2)} -> ${fin.toFixed(2)}s`
    + `  (attendu ${attendus[i] ? attendus[i].toFixed(2) : '-'}, ecart ${ecart.toFixed(2)}s)  ${txt.slice(0, 46)}`);
  depart = f ? f.fin : D;
});

const wav = OUT + '.wav';
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', SRC, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

fs.writeFileSync(OUT + '-plans.js',
  '// Genere par voice-decouper.js : ne pas editer a la main.\n'
  + '// UNE SEULE prise de voix, decoupee : le timbre est constant d\'un plan a\n'
  + '// l\'autre. Sept prises separees donnaient sept voix differentes.\n'
  + `window.PROMO_PLANS = ${JSON.stringify(PLANS, null, 2)};\n`
  + `window.PROMO_VOIX_DUREE = ${D.toFixed(3)};\n`);

const trop = PLANS.filter((p) => p.duree < 0.5);
console.log(`\nvoix : ${D.toFixed(2)}s en ${PLANS.length} plans`);
console.log(`bornes : ${path.relative(ROOT, OUT + '-plans.js')}`);
if (trop.length) {
  console.error(`ECHEC : ${trop.length} plan(s) sous 0,5 s : decoupage suspect`);
  process.exit(1);
}
// Un ecart important entre l'estimation et le silence retenu signale que le
// texte ne correspond plus a la prise.
const pireEcart = Math.max(...attendus.map((a, i) => (frontieres[i] ? Math.abs(frontieres[i].parole - a) : 0)));
console.log(`ecart maximal estimation/silence : ${pireEcart.toFixed(2)}s`);
if (pireEcart > 1.2) {
  console.error('ECHEC : une frontiere est tombee loin de son estimation, le texte ne colle pas a la prise');
  process.exit(1);
}
console.log('OK : une seule voix, decoupee sur ses vrais silences');
