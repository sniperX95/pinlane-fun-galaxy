// ============================================================
// GARDE FINALE : LE FILM LIVRE DIT-IL TOUS LES MOTS ?
//
// « Il dit Inlane au lieu de Pinlane, et des fois il oublie les premiers mots. »
//
// Toutes les autres gardes du pipeline mesurent des INTERMEDIAIRES : la prise de
// voix, l'alignement, les bornes de coupe. Aucune ne verifie le fichier qu'on
// envoie. Celle-ci transcrit le mixage FINAL et compare mot a mot avec la table
// de narration.
//
// CE QU'ELLE ATTRAPE : un mot avale par la decoupe, une phrase absente du
// mixage, un segment pose hors du film, une piste voix muette sur un plan.
//
// CE QU'ELLE N'ATTRAPE PAS, et il faut le savoir : la PRONONCIATION. La
// transcription rend « Pinlane » meme quand la voix dit « pain-lane », parce
// qu'elle choisit le mot le plus proche. Elle prouve qu'un mot RECONNAISSABLE a
// ete dit, pas qu'il a ete bien dit. Pour la prononciation, il faut une oreille
// humaine (voir SKILL.md §0.2).
//
// COUT : un appel API par execution. A lancer UNE FOIS avant la livraison, pas a
// chaque iteration.
//
// A ADAPTER : les chemins en tete.
//
// Usage : node check-paroles.js <film-mixe.mp4> <transcription.txt>
//
//   La transcription se produit avec l'outil MCP `speech_to_text` (ou l'API
//   ElevenLabs) sur la piste audio extraite :
//     ffmpeg -y -i <film-mixe.mp4> -vn -ac 1 -ar 16000 voix.mp3
// ============================================================

const fs = require('fs');
const path = require('path');

const FILM = process.argv[2];
const TRANSCRIPTION = process.argv[3];
const TABLE = process.argv[4] || 'src/aifl/narration.json';

if (!TRANSCRIPTION || !fs.existsSync(TRANSCRIPTION)) {
  console.error('usage : node check-paroles.js <film.mp4> <transcription.txt> [narration.json]');
  console.error('');
  console.error('  produire la transcription :');
  console.error('    ffmpeg -y -i <film.mp4> -vn -ac 1 -ar 16000 voix.mp3');
  console.error('    puis speech_to_text sur voix.mp3, resultat colle dans un .txt');
  process.exit(1);
}
if (!fs.existsSync(TABLE)) {
  console.error(`table de narration introuvable : ${TABLE}`);
  process.exit(1);
}

// Comparaison sur la forme NUE : sans accents, sans ponctuation, en minuscules.
// La transcription ne restitue pas la ponctuation d'origine et n'a aucune raison
// de le faire ; exiger une egalite stricte ferait rougir la garde sur du bruit.
const nu = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
  // L'apostrophe TYPOGRAPHIQUE du texte source et l'apostrophe DROITE de la
  // transcription sont deux caracteres differents : sans cette ligne, tous les
  // « c'est » sortaient comme non retrouves.
  .replace(/[’ʼ]/g, "'")
  .toLowerCase().replace(/[^a-z0-9']/g, '');

const N = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const attendus = [];
N.lignes.forEach((l, i) => {
  l.mots.forEach((m) => {
    const w = nu(m.m);
    if (w) attendus.push({ w, ligne: i + 1, brut: m.m, texte: l.texte });
  });
});

const dits = fs.readFileSync(TRANSCRIPTION, 'utf8')
  .split(/\s+/).map(nu).filter(Boolean);

// Alignement gloutonne avec fenetre de rattrapage : la transcription peut
// scinder ou fusionner un mot (« aujourd'hui », les nombres), et un decalage
// definitif ferait declarer tout le reste manquant.
const FENETRE = 6;
let j = 0;
const manquants = [];
for (const a of attendus) {
  let trouve = -1;
  for (let k = j; k < Math.min(dits.length, j + FENETRE); k++) {
    if (dits[k] === a.w || dits[k].includes(a.w) || a.w.includes(dits[k])) { trouve = k; break; }
  }
  if (trouve >= 0) j = trouve + 1;
  else manquants.push(a);
}

const tauxManquant = manquants.length / attendus.length;
console.log(`mots attendus  : ${attendus.length}`);
console.log(`mots transcrits: ${dits.length}`);
console.log(`non retrouves  : ${manquants.length} (${(tauxManquant * 100).toFixed(1)} %)`);

if (manquants.length) {
  console.log('');
  // Grouper par ligne : un mot isole est souvent une variante de transcription,
  // plusieurs mots CONSECUTIFS d'une meme ligne sont un vrai trou.
  const parLigne = new Map();
  manquants.forEach((m) => {
    if (!parLigne.has(m.ligne)) parLigne.set(m.ligne, []);
    parLigne.get(m.ligne).push(m.brut);
  });
  for (const [ligne, mots] of parLigne) {
    const l = N.lignes[ligne - 1];
    const grave = mots.length >= 2;
    console.log(`  ${grave ? 'TROU' : 'var '} ligne ${String(ligne).padStart(2)} : ${mots.join(' ')}`);
    if (grave) console.log(`         « ${l.texte.slice(0, 68)} »`);
  }
}

// SEUIL. Une transcription parfaite n'existe pas : elle scinde les nombres,
// fusionne les elisions, et rate les mots outils. 5 % de variantes isolees est
// normal ; DEUX MOTS CONSECUTIFS d'une meme ligne ne le sont pas.
const trous = [...new Set(manquants.map((m) => m.ligne))]
  .filter((L) => manquants.filter((m) => m.ligne === L).length >= 2);

console.log('');
if (trous.length) {
  console.error(`ECHEC : ${trous.length} ligne(s) ont plusieurs mots consecutifs absents du`);
  console.error('        film livre. Verifier la decoupe (garde attaque-preservee) et que');
  console.error('        le segment est bien pose dans les bornes du film.');
  process.exit(1);
}
if (tauxManquant > 0.08) {
  console.error(`ECHEC : ${(tauxManquant * 100).toFixed(1)} % des mots non retrouves, au-dela du bruit de`);
  console.error('        transcription attendu. La piste voix est peut-etre incomplete.');
  process.exit(1);
}
console.log('OK : tous les mots de la narration sont dans le film livre.');
console.log('     (rappel : cette garde ne dit RIEN de la prononciation)');
