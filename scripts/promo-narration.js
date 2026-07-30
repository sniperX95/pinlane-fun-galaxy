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
// --- LA TABLE DE PLANS, SOURCE UNIQUE --------------------------------------
//
// Elle vit ICI et non dans `shots.ts` : ce script l'ecrit dans `narration.json`,
// et `shots.ts` la relit. Raison : les instants de la voix se calculent depuis
// elle, et la duree de chaque phrase varie d'un appel de synthese a l'autre (une
// meme phrase a mesure 2,29 s puis 2,43 s selon la prise). Deux tables tenues
// separement finiraient par se contredire — c'est le defaut qu'on vient de
// corriger sur les sous-titres, il n'y a aucune raison de le reintroduire ici.
//
// Les plans « card* » sont des cartons de typographie : leur duree se choisit
// librement, sans risque de figer une animation. Les plans produit gardent
// exactement la duree pour laquelle leur animation a ete concue — sauf `macro`,
// dont la camera recoit une cle supplementaire pour continuer a deriver.
const ORDRE = ['morning', 'cardA', 'cardB', 'card1', 'table', 'macro',
  'card2', 'chart', 'cardWbr', 'wbr', 'card3', 'outro'];

// Les plans PRODUIT gardent exactement la duree pour laquelle leur animation a
// ete concue. `macro` passe de 100 a 130 images et recoit une cle de camera
// supplementaire pour continuer a deriver au lieu de figer.
// `morning` porte DEUX phrases (l'accroche sur le logo, le contexte sur le
// planning) : c'est le seul plan produit qui en porte deux, donc le seul a avoir
// besoin de place. 268 images, et la derive de camera de `SceneOpen` s'etale
// jusque-la au lieu de se figer a 220.
const FIXES = { morning: 268, table: 190, macro: 130, chart: 105, wbr: 110, outro: 160 };

// Les CARTONS n'ont pas de duree ecrite : elle se CALCULE depuis la phrase qu'ils
// portent. C'est ce qui rend l'ensemble insensible au debit de la synthese — une
// meme phrase a mesure 2,29 s sur une prise et 2,91 s sur la suivante, et quatre
// phrases debordaient de leur plan quand les durees etaient fixees a la main.
const MARGE_CARTON = 0.55;

// QUEUE ELASTIQUE DES PLANS PRODUIT. Leur duree est celle de leur animation, mais
// on autorise jusqu'a 20 images de tenue supplementaire si la phrase en a besoin :
// une demi-seconde de pose avant la coupe ne se voit pas, alors qu'une phrase
// coupee au milieu s'entend. Sans cette elasticite, il fallait re-regler le texte
// a chaque appel de synthese — le debit varie de 10 % d'une prise a l'autre.
const ELASTIQUE = 20;

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
  // 1-2 : ON PARLE A QUELQU'UN QUI NE NOUS CONNAIT PAS. La premiere phrase
  // qualifie (« est-ce que ca me concerne ? »), la deuxieme montre le resultat
  // avant d'expliquer comment on y arrive.
  { decalage: 0.70, plan: 'morning', cible: 'aucun', jeu: '[direct, comme si tu interpellais quelqu’un]', texte: 'Tu gères un bowling, un laser game, un centre de loisirs ?' },
  { decalage: 'apres', plan: 'morning', cible: 'bandeau', jeu: '[posé]', texte: 'Ça, c’est une journée complète. Huit pistes, quarante-huit réservations.' },

  // 3-4 : LE PROBLEME, PUIS CE QU'IL COUTE. Un trafic froid ne sait pas encore
  // qu'il a un probleme : il faut le nommer avant de vendre quoi que ce soit.
  { decalage: 0.40, plan: 'cardA', cible: 'carton', jeu: '[plus bas, complice]', texte: 'Sauf qu’en vrai, ça se passe au téléphone. Tu notes sur un cahier, et tu espères que personne n’a déjà pris la même piste.' },
  { decalage: 0.40, plan: 'cardB', cible: 'carton', jeu: '[net, un peu plus grave]', texte: 'Un créneau oublié, c’est un groupe qui part ailleurs.' },

  // 5 : LE BASCULEMENT. On dit ce que c'est, en une phrase, sans jargon.
  { decalage: 0.40, plan: 'card1', cible: 'carton', jeu: '[clair, on ouvre]', texte: 'Pinlane, c’est le logiciel qui gère tout ça à ta place.' },

  // 6-10 : LE MECANISME, une etape par plan, chacune montree a l'ecran pendant
  // qu'elle est dite. C'est la partie qui manquait : on expliquait par titres.
  { decalage: 0.40, plan: 'table', cible: 'bandeau', jeu: '', texte: 'Tes clients réservent en ligne, et la résa se pose toute seule au bon créneau.' },
  { decalage: 'apres', plan: 'table', cible: 'bandeau', jeu: '[appuye]', texte: 'Tu cherches un client ? Deux secondes.' },
  { decalage: 0.40, plan: 'macro', cible: 'bandeau', jeu: '[confiant]', texte: 'Le jour même, tu vois qui arrive, à quelle heure, et combien ils sont.' },
  { decalage: 0.40, plan: 'card2', cible: 'carton', jeu: '', texte: 'Et ce qui demande une action remonte tout seul en haut de la liste.' },
  { decalage: 0.40, plan: 'chart', cible: 'bandeau', jeu: '', texte: 'Tous les dossiers du jour, déjà triés par heure.' },

  // 11-13 : LA PREUVE, puis le benefice en trois coups.
  { decalage: 0.40, plan: 'cardWbr', cible: 'carton', jeu: '[plus posé]', texte: 'Le soir, ton chiffre et ton taux d’occupation sont déjà calculés.' },
  { decalage: 0.40, plan: 'wbr', cible: 'bandeau', jeu: '', texte: 'Tout est là, sans que tu aies saisi une seule ligne.' },
  { decalage: 0.45, plan: 'card3', cible: 'carton', jeu: '[fier, appuyé]', texte: 'Zéro saisie. Zéro double réservation. Zéro appel manqué.' },

  // 14 : L'APPEL A L'ACTION. Un trafic froid a besoin qu'on lui dise quoi faire.
  { decalage: 0.60, plan: 'outro', cible: 'aucun', jeu: '[net, chaleureux]', texte: 'Pinlane. La console de ton centre. Le lien est juste en dessous.' },
];


// --- PRONONCIATION : CE QUI EST DIT N'EST PAS TOUJOURS CE QUI EST ECRIT ------
//
// « La voix des fois elle prononce pas tres bien les mots. » La transcription ne
// le montre PAS : elle rend « Pinlane » meme quand la voix dit « pain-lane »,
// parce qu'elle choisit le mot le plus proche. Ma note de skill affirmait qu'une
// transcription correcte prouvait une bonne prononciation — c'est faux, elle
// prouve seulement qu'on a dit un mot reconnaissable.
//
// On corrige donc la prononciation LA OU ELLE SE CORRIGE : dans l'ecriture
// envoyee au modele. Le mot AFFICHE reste celui de gauche, le mot DIT est celui
// de droite. L'appariement caractere par caractere se fait sur la version dite,
// et les dates obtenues sont attribuees au mot affiche — les deux restent donc
// synchronises.
//
// « Pinlane » est le cas critique : c'est le nom de la marque, prononce deux fois
// dont une sur la signature. Le decoupage « Pinn-lane » evite la voyelle nasale
// francaise de « pin » (qui donne « pain ») et garde deux syllabes.
const PRONONCIATION = {
  Pinlane: 'Pinn-lane',
  'Pinlane.': 'Pinn-lane.',
};
const ditPour = (mot) => PRONONCIATION[mot] || mot;

// Indication de pause entre les lignes : elle donne du silence a l'endroit ou on
// coupe, et de l'air a la diction. Les indications entre crochets ne sont pas
// lues (verifie par transcription sur cette voix et ce modele).
// Calcule a l'appel et non au chargement : `enMots` est declare plus bas dans le
// fichier, et une constante fleche n'existe pas avant sa ligne.
const texteAEnvoyer = () => LIGNES
  .map((l) => `${l.jeu} ${enMots(l.texte).map(ditPour).join(' ')}`.trim())
  .join(' [longue pause] ');

const cle = (() => {
  const c = require('C:/Users/movsa/.claude.json');
  const k = c.projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error('cle ElevenLabs introuvable');
  return k;                               // jamais journalisee, jamais affichee
})();

const appel = () => new Promise((resolve, reject) => {
  const corps = JSON.stringify({
    text: texteAEnvoyer(),
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
  console.log(`appel ${MODELE}, ${texteAEnvoyer().length} caracteres, ${LIGNES.length} lignes`);
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
      // Les caracteres attendus sont ceux de la version DITE ; l'index (i, j)
      // reste celui du mot AFFICHE, donc les dates retombent au bon endroit.
      [...ditPour(mot)].filter(utile).forEach((c) => attendus.push({ c: nu(c), i, j }));
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

  // Passe 1 : mesurer chaque phrase, sans encore savoir ou elle tombe.
  const mesurees = LIGNES.map((ligne, i) => {
    const mots = enMots(ligne.texte).map((mot, j) => {
      const e = parMot.get(`${i}-${j}`);
      if (!e) rates.push(`ligne ${i + 1} : mot « ${mot} » sans horodatage`);
      return { m: mot, t0: e ? e.t0 : null, t1: e ? e.t1 : null };
    });
    const bornes = mots.filter((x) => x.t0 !== null);
    if (!bornes.length) { rates.push(`ligne ${i + 1} : aucun mot situe`); return null; }
    return { ligne, mots, de: bornes[0].t0, a: bornes[bornes.length - 1].t1 };
  });
  if (mesurees.some((x) => !x)) { rates.forEach((r) => console.log('  - ' + r)); process.exit(1); }

  // Passe 1 bis : RESOUDRE LES DECALAGES AUTOMATIQUES.
  //
  // `decalage: 'apres'` place la phrase juste apres la precedente, avec une
  // respiration. C'est la reponse a une erreur qui revenait a chaque
  // regeneration : deux phrases dans un meme plan, decalages regles a la main, et
  // le debit de la synthese qui bouge de 10 % — elles finissaient par se
  // chevaucher. Une valeur calculee ne peut plus deriver.
  const RESPIRATION = 0.40;
  mesurees.forEach((x, n) => {
    if (x.ligne.decalage !== 'apres') return;
    const prec = mesurees[n - 1];
    if (!prec) { x.ligne.decalage = 0.4; return; }
    // Decalage exprime depuis le debut du plan COURANT : on a besoin de savoir ou
    // finit la precedente, en absolu. Les deux phrases partagent leur plan, donc
    // la difference de leurs decalages suffit.
    const finPrec = prec.ligne.plan === x.ligne.plan
      ? prec.ligne.decalage + (prec.a - prec.de)
      : 0;
    x.ligne.decalage = +(finPrec + RESPIRATION).toFixed(3);
  });

  // Passe 2 : la chronologie. Duree d'un carton = ce que sa phrase exige.
  const DEPART = {};
  let curseur = 0;
  ORDRE.forEach((nom) => {
    const dessus = mesurees.filter((x) => x.ligne.plan === nom);
    const besoin = dessus.length
      ? Math.max(...dessus.map((x) => x.ligne.decalage + (x.a - x.de))) + MARGE_CARTON
      : 0;
    let d;
    if (FIXES[nom]) {
      d = FIXES[nom];
      const manque = Math.round(besoin * FPS) - d;
      if (manque > 0) {
        if (manque > ELASTIQUE) rates.push(`plan ${nom} : il manque ${manque} images pour ses phrases (elastique ${ELASTIQUE})`);
        else { d += manque; console.log(`  ${nom} : +${manque} images de tenue pour tenir sa phrase`); }
      }
    } else {
      d = Math.round(besoin * FPS);
    }
    DEPART[nom] = { from: curseur, duration: d };
    curseur += d;
  });
  const TOTAL = curseur;
  const FILM = TOTAL / FPS;
  console.log(`film : ${TOTAL} images, ${FILM.toFixed(2)}s`);

  const table = mesurees.map(({ ligne, mots: posees, de, a }, i) => {
    const at = DEPART[ligne.plan].from / FPS + ligne.decalage;
    return {
      i,
      texte: ligne.texte,
      cible: ligne.cible,
      plan: ligne.plan,
      at: +at.toFixed(3),
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
    // La phrase doit tenir dans SON plan : c'est ce qui garantit que le texte
    // parle de l'image a l'ecran. 0,2 s de tolerance sur la coupe, le temps du
    // fondu.
    const pl = DEPART[l.plan];
    const finPlan = (pl.from + pl.duration) / FPS;
    if (l.at + l.duree > finPlan + 0.2) {
      rates.push(`ligne ${n + 1} deborde du plan ${l.plan}`
        + ` (finit a ${(l.at + l.duree).toFixed(2)}s, le plan finit a ${finPlan.toFixed(2)}s)`);
    }
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
    + `  ${l.plan.padEnd(8)} ${l.cible.padEnd(8)} ${l.texte}`));

  if (rates.length) {
    console.log('\nPROBLEMES :');
    rates.forEach((r) => console.log('  - ' + r));
    process.exit(1);
  }

  fs.writeFileSync(SORTIE_TABLE, JSON.stringify({
    fps: FPS,
    // La structure du film, lue par `shots.ts`.
    plans: DEPART,
    total: TOTAL,
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
