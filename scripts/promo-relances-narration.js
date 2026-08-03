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
// tous les deux ce fichier : le mot apparait donc a l'instant ou il est
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

// --- CE FILM-CI --------------------------------------------------------------
//
// Adapte de `promo-narration.js`. Deux ecarts, et rien d'autre :
//
//   1. LA VOIX EST UN ARGUMENT. Movsar en a retenu DEUX, et le film sort en
//      deux versions. Le dossier Subify donne la mesure de l'autre approche :
//      un montage commun a fait tomber Kate a 50,64 % de phonation contre
//      64,10 % pour BKB, soit le plancher dur du skill. Sur un film court,
//      etirer la voix rapide pour qu'elle tienne dans les plans de la lente
//      ramene exactement la plainte n 1 de la pub Pinlane (« on a le temps de
//      dormir »). Chaque voix a donc SA table de plans, calculee sur SA prise.
//   2. Le format est carre, donc les plans sont plus courts et plus serres.
//
// Usage : node scripts/promo-relances-narration.js [kael|michael]

const ROOT = path.resolve(__dirname, '..');

const VOIX = {
  kael: { id: 'yG4Uc56cLYQyZFnWaYv2', nom: 'Kael' },
  michael: { id: 'IbTlccXlWxGVwnbGUHEd', nom: 'Michael' },
};
const CHOIX = (process.argv[2] || 'kael').toLowerCase();
if (!VOIX[CHOIX]) { console.error(`voix inconnue : ${CHOIX} (kael | michael)`); process.exit(1); }
const VOIX_ID = VOIX[CHOIX].id;
const MODELE = 'eleven_v3';
const FPS = 30;

const SORTIE_AUDIO = path.join(ROOT, `artifacts/promo-video/relances/voix-${CHOIX}.mp3`);
const SORTIE_TABLE = path.join(ROOT, `marketing/promo-video/shotcraft/src/relances/narration-${CHOIX}.json`);
fs.mkdirSync(path.dirname(SORTIE_AUDIO), { recursive: true });

// --- LA VOIX DIT CE QUE L'IMAGE MONTRE ---------------------------------------
//
// Les libelles viennent de `live-layout.json`, ecrit par le script de capture
// qui les a LUS DANS LE DOM. Ecrire « la confirmation, le rappel » a la main
// marcherait aujourd'hui et mentirait le jour ou une sequence est renommee :
// c'est exactement le defaut « ca dit piste 6 alors que c'est piste 5 ».
const LAYOUT = require(path.join(ROOT, 'marketing/promo-video/shotcraft/src/relances/live-layout.json'));
const SEQ = LAYOUT.donnees.sequences;
const ETEINTE = SEQ.find((s) => !s.allumee) || SEQ[SEQ.length - 1];
// Les trois sequences que la voix enumere : celles dont le titre se dit en une
// respiration. On les DESIGNE par leur position dans la page, pas par leur texte.
const CITEES = [1, 2, 3].map((i) => SEQ[i]);

// --- LA TABLE DE PLANS, SOURCE UNIQUE ----------------------------------------
//
// Elle vit ici et `shots.ts` la relit : les instants de la voix se calculent
// depuis elle, et la duree d'une meme phrase varie de 10 % d'une prise a
// l'autre. Deux tables tenues separement finiraient par se contredire.
const ORDRE = ['ouverture', 'page', 'cardA', 'sequences', 'enumere', 'eteinte',
  'cardB', 'veut', 'reponse', 'apprend', 'cardC', 'outro'];

// Plans PRODUIT : la duree pour laquelle leur animation est concue.
const FIXES = { sequences: 90, enumere: 155, eteinte: 105, veut: 110, reponse: 105, apprend: 125, outro: 130 };

// Planchers : le plan prend la duree que sa phrase exige, mais jamais moins que
// ce qu'il faut a son animation pour se derouler.
const PLANCHERS = { ouverture: 100, page: 120 };

// Les CARTONS n'ont pas de duree ecrite : elle se CALCULE depuis leur phrase.
const MARGE_CARTON = 0.22;
// Queue elastique des plans produit : jusqu'a 20 images de tenue en plus si la
// phrase en a besoin. Une demi-seconde de pose ne se voit pas, une phrase
// coupee au milieu s'entend.
const ELASTIQUE = 20;

// --- LE TEXTE ----------------------------------------------------------------
//
// Build in public : premiere personne, phrases courtes, aucun argument de vente.
// Ce qui distingue ce registre d'une publicite : on dit aussi ce qui MANQUE.
//
// AUCUN CHIFFRE N'EST CITE. Ceux qui sont a l'ecran viennent du mode
// demonstration : ils sont coherents entre eux mais ce ne sont pas des
// resultats. Les faire dire par la voix les transformerait en preuve, et c'est
// le genre de raccourci qui coute la credibilite qu'un build in public cherche.
//
// UNE INDICATION DE JEU PAR MOUVEMENT, PAS PAR PHRASE : le modele se
// re-interprete a chaque crochet, et douze intentions collees bout a bout
// s'entendent comme douze prises.
const LIGNES = [
  // --- MOUVEMENT 1 : ce que j'ai ajoute, et pourquoi -------------------------
  { decalage: 0.45, plan: 'ouverture', cible: 'aucun', jeu: '[posé, tu montres un truc dont tu es content]', texte: 'Cette semaine, j’ai ajouté les mails et les relances dans Pinlane.' },
  { decalage: 0.20, plan: 'page', cible: 'bandeau', texte: 'Ça, c’est la boîte du centre : ce qui part au client, et ce qui arrive.' },
  { decalage: 0.18, plan: 'cardA', cible: 'carton', jeu: '[plus bas, tu racontes]', texte: 'Avant, il fallait penser à écrire au client. Personne n’y pensait.' },

  // --- MOUVEMENT 2 : le mecanisme, montre ------------------------------------
  { decalage: 0.20, plan: 'sequences', cible: 'bandeau', texte: 'Maintenant, six séquences partent toutes seules.' },
  { decalage: 0.15, plan: 'enumere', cible: 'bandeau', texte: `${CITEES[0].titre}. ${CITEES[1].titre}. ${CITEES[2].titre}. Anniversaire.` },
  { decalage: 0.18, plan: 'eteinte', cible: 'bandeau', texte: 'Chacune s’allume ou se coupe. Rien ne part sans toi.' },

  // --- MOUVEMENT 3 : le morceau qui compte -----------------------------------
  { decalage: 0.18, plan: 'cardB', cible: 'carton', jeu: '[tu accélères, c’est le morceau qui compte]', texte: 'Mais le vrai morceau, c’est ce qui arrive.' },
  { decalage: 0.20, plan: 'veut', cible: 'bandeau', texte: 'Un client écrit. Avant d’ouvrir le mail, tu sais ce qu’il veut.' },
  { decalage: 0.18, plan: 'reponse', cible: 'bandeau', texte: 'Et la réponse est déjà écrite. Tu relis, tu envoies.' },
  { decalage: 0.18, plan: 'apprend', cible: 'bandeau', texte: 'Tu la corriges, l’agent retient. La fois d’après, il écrit comme toi.' },

  // --- MOUVEMENT 4 : ce qui manque, et la signature --------------------------
  { decalage: 0.18, plan: 'cardC', cible: 'carton', jeu: '[franc, sans vendre]', texte: 'Il manque la réception automatique. Pour l’instant, on colle le mail à la main.' },
  { decalage: 0.30, plan: 'outro', cible: 'aucun', texte: 'Pinlane.' },
];

// --- PRONONCIATION : CE QUI EST DIT N'EST PAS TOUJOURS CE QUI EST ECRIT -------
//
// « Pinlane » est le cas critique : la voix precedente le rendait « Inlane ».
// Le decoupage evite la voyelle nasale francaise de « pin » (qui donne « pain »)
// et garde deux syllabes. Il est dit deux fois, dont une sur la signature.
const PRONONCIATION = {
  Pinlane: 'Pinn-lane',
};

// La cle est le mot NU : les jetons portent leur ponctuation, et une table
// indexee sur la forme ponctuee obligerait a enumerer chaque variante.
const ditPour = (mot) => {
  const m = mot.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  if (!m) return mot;
  const [, avant, coeur, apres] = m;
  const cle = coeur.toLowerCase();
  const remplacement = PRONONCIATION[coeur] || PRONONCIATION[cle];
  if (!remplacement) return mot;
  const majuscule = coeur[0] && coeur[0] === coeur[0].toUpperCase() && coeur[0] !== coeur[0].toLowerCase();
  const dit = majuscule ? remplacement[0].toUpperCase() + remplacement.slice(1) : remplacement;
  return `${avant}${dit}${apres}`;
};

// Calcule a l'appel et non au chargement : `enMots` est declare plus bas dans le
// fichier, et une constante fleche n'existe pas avant sa ligne.
// Une ligne SANS indication de jeu prolonge le registre de la precedente : c'est
// tout l'interet : le modele ne se re-interprete que la ou on le lui demande.
const texteAEnvoyer = () => LIGNES
  .map((l) => `${l.jeu || ''} ${enMots(l.texte).map(ditPour).join(' ')}`.trim())
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
    // `style` a 0,25 et non 0,4. Un style eleve EXAGERE l'interpretation : le
    // modele place des accents toniques la ou il croit qu'il y a de l'emphase, et
    // c'est un candidat serieux pour « les intonations c'est mal fait ». A 0,25 la
    // lecture reste vivante sans etre jouee.
    // « Faut qu'ils soient plus enjoués, comme une vraie vidéo promo. »
    // `style` remonte a 0,45 : c'est le levier d'expressivite. Il avait ete baisse
    // a 0,25 pour calmer des intonations fautives : mais la cause etait la VOIX,
    // pas le reglage, et avec une voix juste on peut de nouveau jouer.
    // `stability` a 0,4 : un peu plus de relief. Le risque historique de ce
    // reglage (le timbre qui change d'un appel a l'autre) n'existe plus, puisque
    // tout le film tient dans UN SEUL appel.
    // `speed` a 1,04 : quatre pour cent plus vif. Une voix promo avance.
    // RETOUR AUX REGLAGES QUE MOVSAR AVAIT VALIDES A L'ECOUTE.
    //
    // Il a choisi cette voix sur un comparatif genere a `style: 0.25`, puis n'a
    // pas aime le film ou je l'avais poussee a 0,45 avec `speed` 1,04 : « change
    // un truc beaucoup plus pro ». Un `style` eleve sur ce modele SUR-JOUE : la
    // lecture devient appuyee, et une lecture appuyee ne sonne pas
    // professionnelle, elle sonne synthetique.
    //
    // L'enjouement reste demande, mais il vient desormais des INDICATIONS DE JEU
    // et de l'ecriture, pas d'un curseur qui exagere tout uniformement.
    voice_settings: {
      stability: 0.5, similarity_boost: 0.85, style: 0.28,
      // 1,10 ET NON 1,0. « On a le temps de dormir, il parle des fois trop
    // lentement. » Mesure faite avant de toucher au curseur : 40,0 s de
    // phonation pure sur 73,6 s de film : 44 % de silence. Le debit est un des
    // trois leviers, les deux autres sont les creux INTERNES aux phrases et les
    // trous ENTRE elles, traites plus bas.
    // Le `style` reste a 0,28 : c'est lui que Movsar avait valide a l'oreille, et
    // c'est en le poussant a 0,45 que la voix avait sonne sur-jouee. On ne bouge
    // qu'un curseur a la fois.
    // 1,14 apres mesure du premier essai a 1,10 : les creux INTERNES n'avaient pas
    // bouge (15,3 s), et l'analyse fine dit pourquoi : sur ces 15,3 s il n'y a que
    // 7,7 s de vraies pauses (>180 ms), le reste est l'interstice normal entre
    // deux mots, qu'on ne peut pas supprimer sans hacher la diction. Le seul
    // levier qui agit encore sur cette part-la est le debit.
    use_speaker_boost: true, speed: 1.14,
    },
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

// Decoupage en mots AFFICHABLES. Un jeton sans aucune lettre : le « ? » de
// « Un client ? Je le trouve », impose par la typographie francaise : n'a pas de
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
  // suites doivent alors coincider terme a terme : c'est verifiable, et c'est
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
    rates.push(`${desaccords} caractere(s) en desaccord sur ${N} : l'appariement a derape`);
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
  // le debit de la synthese qui bouge de 10 % : elles finissaient par se
  // chevaucher. Une valeur calculee ne peut plus deriver.
  // 0,24 : une respiration, pas un silence. A 0,40 les deux phrases d'un meme
  // plan se lisaient comme deux plans.
  const RESPIRATION = 0.24;
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
    if (PLANCHERS[nom]) {
      // Plan a PLANCHER : il prend la duree de ses phrases, jamais moins que le
      // temps dont son animation a besoin.
      d = Math.max(PLANCHERS[nom], Math.round(besoin * FPS));
    } else if (FIXES[nom]) {
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
      rates.push(`ligne ${n + 1} finit a ${(l.at + l.duree).toFixed(2)}s, la ${n + 2} commence a ${suiv.at}s, chevauchement`);
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

  // --- DENSITE : LE CHIFFRE QUI DECRIT « ON A LE TEMPS DE DORMIR » ----------
  //
  // « Faut que ce soit beaucoup plus dynamique, la on a le temps de dormir, il
  // parle des fois trop lentement. » Un ressenti de rythme se mesure, et il se
  // decompose en TROIS termes qu'on corrige separement :
  //
  //   phonation    = la somme des durees de mots. C'est le seul temps ou il se
  //                  passe quelque chose a l'oreille.
  //   creux INTERNES = les silences DANS les phrases. Ils viennent de la
  //                  ponctuation : eleven_v3 marque un temps a chaque point.
  //                  Trois points dans une phrase font deux silences.
  //   trous ENTRE   = les silences entre deux phrases. Ils viennent des marges
  //                  de plan, pas de la voix.
  //
  // Premiere mesure, avant correction : 40,0 s de phonation sur 73,6 s, soit
  // 44 % de silence : 15,2 s dedans, 16,9 s entre. Les deux moities comptaient
  // autant, et je n'aurais pas devine laquelle traiter sans les separer.
  const phonation = ok.reduce((s, l) => s + l.mots.reduce((t, m) => t + (m.t1 - m.t0), 0), 0);
  const dedans = ok.reduce((s, l) => s + l.duree, 0) - phonation;
  const entre = FILM - phonation - dedans;
  const motsTotal = ok.reduce((s, l) => s + l.mots.length, 0);
  console.log(`densite : ${phonation.toFixed(1)}s de phonation (${Math.round(phonation / FILM * 100)} %)`
    + ` · ${dedans.toFixed(1)}s de creux internes · ${entre.toFixed(1)}s entre les phrases`
    + ` · ${Math.round(motsTotal / phonation * 60)} mots/min`);
  if (phonation / FILM < 0.5) {
    console.log(`  ATTENTION : moins de la moitie du film porte de la parole,`
      + ` c'est ce qui s'entend comme « on a le temps de dormir »`);
  }

  console.log('OK : chaque mot horodate, aucune ligne ne chevauche la suivante');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
