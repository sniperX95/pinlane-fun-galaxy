// LA NARRATION : UNE SEULE PRISE, ET LE TEXTE A L'ECRAN SUIT LA VOIX AU MOT.
//
// Le reproche auquel repond ce script : « quand il dit des choses, ca se dit pas
// en meme temps que le texte apparait ». C'etait exact, et c'etait structurel :
// les sous-titres etaient poses a des frames choisies a la main, la voix a des
// secondes choisies a la main. Deux tables independantes ne peuvent pas rester
// d'accord.
//
// Ici il n'y a plus qu'UNE table. On appelle l'API ElevenLabs
// `/with-timestamps`, qui rend l'audio ET l'alignement caractere par caractere.
// De cet alignement on tire, pour chaque ligne : ses bornes dans la prise, et la
// date de CHAQUE MOT relative au debut de la ligne. Le film et le mixage lisent
// tous les deux ce fichier — le mot apparait donc a l'instant ou il est
// prononce, par construction et non par reglage.
//
// Trois proprietes qui viennent gratuitement :
//   - UN SEUL TIMBRE : un seul appel, donc une seule prise (le defaut « on
//     dirait une personne differente a chaque fois » venait de plusieurs appels).
//   - Aucune detection de silence : les bornes viennent de l'alignement, pas
//     d'une heuristique sur les blancs (qui avait deja coupe « Toutes seules »
//     de sa phrase).
//   - Le texte affiche EST le texte dit. Il ne peut plus le contredire.
//
// Usage : node scripts/promo-narration.js

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SORTIE_AUDIO = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/voix-ugc.mp3');
const SORTIE_TABLE = path.join(ROOT, 'marketing/promo-video/shotcraft/src/aifl/narration.json');

const VOIX_ID = 'aQROLel5sQbj1vuIVi6B';   // Voix Nicolas Petit — narration FR pro
const MODELE = 'eleven_v3';
const FPS = 30;
const FILM = 1085 / FPS;                  // 36,17 s

// --- LE TEXTE ---------------------------------------------------------------
//
// Registre parle, pas institutionnel. Ce qui change par rapport a la version
// precedente (« Un centre de loisirs, un jeudi. Huit pistes : du bowling, du
// laser, des formules. ») : on parle a la premiere personne, en phrases courtes,
// avec une accroche des la premiere seconde, et on tutoie. Un gerant qui montre
// son ecran ne recite pas une fiche produit.
//
// `at` = l'instant du film ou la ligne commence, choisi sur le plan qu'elle
// decrit (voir la table de plans de `Main.tsx`). `cible` = ou son texte
// s'affiche : sur un carton plein ecran, dans le bandeau du bas, ou nulle part
// (quand l'image porte deja le mot : le logo, la signature).
const LIGNES = [
  { at: 0.60, cible: 'aucun', jeu: '[curieux, comme si tu montrais ton ecran a un pote]', texte: 'Regarde ça deux secondes.' },
  { at: 3.00, cible: 'bandeau', jeu: '[posé]', texte: 'Ça, c’est un jeudi. Huit pistes qui tournent.' },
  { at: 7.45, cible: 'carton', jeu: '[un peu plus vif]', texte: 'Les réservations tombent toutes seules.' },
  { at: 9.70, cible: 'bandeau', jeu: '[net]', texte: 'Zéro appel. Zéro saisie.' },
  { at: 12.90, cible: 'bandeau', jeu: '', texte: 'Un client ? Je le trouve en deux secondes.' },
  { at: 15.90, cible: 'bandeau', jeu: '[confiant]', texte: 'Le jour J, je sais qui arrive et combien.' },
  { at: 18.95, cible: 'carton', jeu: '', texte: 'Ce qui coince remonte tout seul.' },
  { at: 21.10, cible: 'bandeau', jeu: '', texte: 'Trié par heure. Sans que j’y touche.' },
  { at: 24.30, cible: 'carton', jeu: '[plus posé]', texte: 'Et le soir, tout est déjà compté.' },
  { at: 26.30, cible: 'bandeau', jeu: '', texte: 'Le chiffre, l’occupation, les arrivées. Tout est là.' },
  { at: 29.65, cible: 'carton', jeu: '[fier, sourire]', texte: 'Moi, je saisis plus rien.' },
  { at: 32.40, cible: 'aucun', jeu: '[net, chaleureux]', texte: 'Pinlane. La console de ton centre.' },
];

// Indication de pause entre les lignes : elle donne du silence a l'endroit ou on
// coupe, et de l'air a la diction. Les indications entre crochets ne sont pas
// lues (verifie par transcription sur cette voix et ce modele).
const TEXTE = LIGNES.map((l) => `${l.jeu} ${l.texte}`.trim()).join(' [longue pause] ');

const cle = (() => {
  const c = require('C:/Users/movsa/.claude.json');
  const k = c.projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error('cle ElevenLabs introuvable');
  return k;                               // jamais journalisee, jamais affichee
})();

const appel = () => new Promise((resolve, reject) => {
  const corps = JSON.stringify({
    text: TEXTE,
    model_id: MODELE,
    language_code: 'fr',
    voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.4, use_speaker_boost: true },
  });
  const req = https.request({
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${VOIX_ID}/with-timestamps?output_format=mp3_44100_128`,
    method: 'POST',
    headers: { 'xi-api-key': cle, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) },
  }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} : ${d.slice(0, 300)}`));
      try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.write(corps);
  req.end();
});

// Comparaison insensible aux accents, a la casse et a la ponctuation : le modele
// normalise le texte avant de le prononcer, donc l'alignement ne contient pas
// forcement les memes caracteres que ce qu'on a envoye.
const nu = (c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’']/g, "'");
const utile = (c) => /[a-z0-9']/.test(nu(c));

// Decoupage en mots AFFICHABLES. Un jeton sans aucune lettre — le « ? » de
// « Un client ? Je le trouve », impose par la typographie francaise — n'a pas de
// date propre et n'a pas a en avoir : il se rattache au mot precedent, ce qui le
// garde aussi colle a lui a l'ecran.
const enMots = (texte) => texte.split(/\s+/).filter(Boolean).reduce((acc, jeton) => {
  const aDesLettres = [...jeton].some(utile);
  if (!aDesLettres && acc.length) acc[acc.length - 1] += ` ${jeton}`;
  else acc.push(jeton);
  return acc;
}, []);

(async () => {
  console.log(`appel ${MODELE}, ${TEXTE.length} caracteres, ${LIGNES.length} lignes`);
  const rep = await appel();
  const al = rep.alignment || rep.normalized_alignment;
  if (!al || !al.characters) throw new Error('pas d\'alignement dans la reponse');

  fs.mkdirSync(path.dirname(SORTIE_AUDIO), { recursive: true });
  fs.writeFileSync(SORTIE_AUDIO, Buffer.from(rep.audio_base64, 'base64'));
  const duree = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', SORTIE_AUDIO], { encoding: 'utf8' }).trim());
  console.log(`prise : ${duree.toFixed(2)}s, ${al.characters.length} caracteres alignes`);

  // --- APPARIEMENT CARACTERE UTILE PAR CARACTERE UTILE ----------------------
  //
  // L'alignement CONTIENT les indications de jeu entre crochets, meme si elles
  // ne sont pas prononcees (leurs durees sont nulles ou quasi nulles). Ma
  // premiere version marchait dans le flux brut et deraillait des le premier mot
  // : elle cherchait le « r » de « Regarde » et trouvait celui de « curieux ».
  //
  // On enleve donc d'abord les portions entre crochets, puis on ne garde que les
  // caracteres utiles (lettres, chiffres, apostrophes) des deux cotes. Les deux
  // suites doivent alors coincider terme a terme — c'est verifiable, et c'est
  // verifie ci-dessous.
  const C = al.characters;
  const T0 = al.character_start_times_seconds;
  const T1 = al.character_end_times_seconds;
  const rates = [];

  const flux = [];
  let dansCrochet = false;
  for (let n = 0; n < C.length; n++) {
    const c = C[n];
    if (c === '[') { dansCrochet = true; continue; }
    if (c === ']') { dansCrochet = false; continue; }
    if (dansCrochet) continue;
    if (utile(c)) flux.push({ c: nu(c), t0: T0[n], t1: T1[n] });
  }

  // Les caracteres attendus, dans l'ordre, avec de quoi savoir a quel mot de
  // quelle ligne chacun appartient.
  const attendus = [];
  LIGNES.forEach((ligne, i) => {
    enMots(ligne.texte).forEach((mot, j) => {
      [...mot].filter(utile).forEach((c) => attendus.push({ c: nu(c), i, j }));
    });
  });

  if (flux.length !== attendus.length) {
    rates.push(`${attendus.length} caracteres attendus, ${flux.length} alignes`);
  }
  const N = Math.min(flux.length, attendus.length);
  let desaccords = 0;
  for (let n = 0; n < N; n++) if (flux[n].c !== attendus[n].c) desaccords += 1;
  if (desaccords > 0) {
    rates.push(`${desaccords} caractere(s) en desaccord sur ${N} — l'appariement a derape`);
    for (let n = 0; n < N; n++) {
      if (flux[n].c !== attendus[n].c) {
        rates.push(`  premier ecart a ${n} : attendu « ${attendus[n].c} », aligne « ${flux[n].c} »`);
        break;
      }
    }
  }

  // Dates par mot : premier et dernier caractere de chaque mot.
  const parMot = new Map();
  for (let n = 0; n < N; n++) {
    const cle2 = `${attendus[n].i}-${attendus[n].j}`;
    const e = parMot.get(cle2);
    if (!e) parMot.set(cle2, { t0: flux[n].t0, t1: flux[n].t1 });
    else e.t1 = flux[n].t1;
  }

  const table = LIGNES.map((ligne, i) => {
    const mots = enMots(ligne.texte);
    const posees = mots.map((mot, j) => {
      const e = parMot.get(`${i}-${j}`);
      if (!e) rates.push(`ligne ${i + 1} : mot « ${mot} » sans horodatage`);
      return { m: mot, t0: e ? e.t0 : null, t1: e ? e.t1 : null };
    });
    const bornes = posees.filter((p) => p.t0 !== null);
    if (!bornes.length) { rates.push(`ligne ${i + 1} : aucun mot situe`); return null; }
    const de = bornes[0].t0;
    const a = bornes[bornes.length - 1].t1;
    return {
      i,
      texte: ligne.texte,
      cible: ligne.cible,
      at: ligne.at,
      de: +de.toFixed(3),
      a: +a.toFixed(3),
      duree: +(a - de).toFixed(3),
      // Dates RELATIVES au debut de la ligne : la ligne peut etre posee n'importe
      // ou dans le film, les mots suivront toujours la voix.
      mots: posees.map((p) => ({
        m: p.m,
        t0: p.t0 === null ? 0 : +(p.t0 - de).toFixed(3),
        t1: p.t1 === null ? 0 : +(p.t1 - de).toFixed(3),
      })),
    };
  });

  // --- GARDES ---------------------------------------------------------------
  const ok = table.filter(Boolean);
  if (ok.length !== LIGNES.length) rates.push(`${LIGNES.length - ok.length} ligne(s) non situee(s)`);
  ok.forEach((l, n) => {
    if (l.duree < 0.4) rates.push(`ligne ${n + 1} : ${l.duree}s, borne suspecte`);
    if (l.at + l.duree > FILM) rates.push(`ligne ${n + 1} : depasse la fin du film (${(l.at + l.duree).toFixed(2)}s > ${FILM.toFixed(2)}s)`);
    const suiv = ok[n + 1];
    if (suiv && l.at + l.duree > suiv.at + 0.02) {
      rates.push(`ligne ${n + 1} finit a ${(l.at + l.duree).toFixed(2)}s, la ${n + 2} commence a ${suiv.at}s — chevauchement`);
    }
    const sansT = l.mots.filter((m) => m.t1 === 0 && m.t0 === 0).length;
    if (sansT) rates.push(`ligne ${n + 1} : ${sansT} mot(s) sans horodatage`);
  });

  console.log('');
  ok.forEach((l, n) => console.log(
    `  ${String(n + 1).padStart(2)}. ${l.at.toFixed(2)}s +${l.duree.toFixed(2)}s`
    + `  ${l.cible.padEnd(8)} ${l.texte}`));

  if (rates.length) {
    console.log('\nPROBLEMES :');
    rates.forEach((r) => console.log('  - ' + r));
    process.exit(1);
  }

  fs.writeFileSync(SORTIE_TABLE, JSON.stringify({
    fps: FPS,
    audio: path.relative(ROOT, SORTIE_AUDIO).replace(/\\/g, '/'),
    dureePrise: +duree.toFixed(3),
    lignes: ok,
  }, null, 2));

  const parle = ok.reduce((s, l) => s + l.duree, 0);
  console.log(`\naudio : ${path.relative(ROOT, SORTIE_AUDIO)}`);
  console.log(`table : ${path.relative(ROOT, SORTIE_TABLE)}`);
  console.log(`${parle.toFixed(1)}s de parole sur ${FILM.toFixed(1)}s de film (${Math.round(parle / FILM * 100)} %)`);
  console.log('OK : chaque mot horodate, aucune ligne ne chevauche la suivante');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
