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

const ROOT = path.resolve(__dirname, '..');
const SORTIE_AUDIO = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/voix-ugc.mp3');
const SORTIE_TABLE = path.join(ROOT, 'marketing/promo-video/shotcraft/src/aifl/narration.json');

// --- LA VOIX DIT CE QUE L'IMAGE MONTRE --------------------------------------
//
// « Il dit huit pistes, quarante-huit reservations, mais la le motion design
// montre UNE carte du planning : ca devrait plus parler de la carte qu'il met en
// evidence. » Le defaut n'etait pas le texte, c'etait qu'il decrivait la journee
// entiere pendant que la camera se fermait sur une reservation precise.
//
// La reservation mise en evidence est designee par la GEOMETRIE (la plus proche
// du centre de page), donc elle change des que la journee de demonstration
// change. On lit ses vraies valeurs dans le layout et on construit la phrase
// avec : la scene affiche « 11:00 · EVJF Camille · 11 joueurs · Piste 6 » et la
// voix dit « onze heures, onze joueurs, piste six ». Un seul fait, une seule
// source : elles ne peuvent plus se contredire.
const LAYOUT = require(path.join(ROOT, 'marketing/promo-video/shotcraft/src/aifl/live-layout.json'));
const HERO = (LAYOUT.projects && LAYOUT.projects.hero) || {};
if (!HERO.heure || !HERO.pax || !HERO.piste) {
  console.error('la reservation heros du layout n\'a ni heure, ni effectif, ni piste'
    + ' : relancer `node scripts/promo-shotcraft-assets.js`');
  process.exit(1);
}

// Les nombres s'ecrivent EN LETTRES dans le texte envoye a la synthese : « 11:00 »
// se lit « onze deux-points zero zero » chez certains modeles, et le bandeau
// affiche de toute facon le texte tel quel. « onze heures » y est plus lisible
// qu'un horaire technique.
const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
  'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante' };
const enLettres = (n) => {
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const d = Math.floor(n / 10) * 10;
  const u = n % 10;
  if (!DIZAINES[d]) return String(n);
  if (u === 0) return DIZAINES[d];
  if (u === 1) return `${DIZAINES[d]} et un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
};
const heureDite = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const heures = `${enLettres(h)} heure${h > 1 ? 's' : ''}`;
  return m ? `${heures} ${enLettres(m)}` : heures;
};

// LA VOIX SE CHANGE ICI, EN UNE LIGNE.
//
// Les voix de la bibliotheque partagee s'utilisent DIRECTEMENT par leur
// identifiant (verifie : HTTP 200), contrairement a ce que disait ma note de
// skill. Le compte de Movsar n'en contient que deux ; la bibliotheque en a des
// dizaines de francaises, dont plusieurs taguees « spots commerciaux ».
// `scripts/promo-essai-voix.js` en compare cinq sur la meme phrase.
//
//   aQROLel5sQbj1vuIVi6B  Nicolas Petit        (celle des versions 3 a 7)
//   c365oriviHmAhyLhpuN6  Adrien Clairon       spots commerciaux, gere l'anglais
//   DGTOOUoGpoP6UZ9uSWfA  Celian               contenu promotionnel, gere l'anglais
//   yG4Uc56cLYQyZFnWaYv2  Kael                 contenu de marque premium
//   jhQTaVBI6hnd0ESpmfIu  Jayce                publicite, voix grave
const VOIX_ID = 'yG4Uc56cLYQyZFnWaYv2';   // Kael
const MODELE = 'eleven_v3';
const FPS = 30;
// --- LA TABLE DE PLANS, SOURCE UNIQUE --------------------------------------
//
// Elle vit ICI et non dans `shots.ts` : ce script l'ecrit dans `narration.json`,
// et `shots.ts` la relit. Raison : les instants de la voix se calculent depuis
// elle, et la duree de chaque phrase varie d'un appel de synthese a l'autre (une
// meme phrase a mesure 2,29 s puis 2,43 s selon la prise). Deux tables tenues
// separement finiraient par se contredire : c'est le defaut qu'on vient de
// corriger sur les sous-titres, il n'y a aucune raison de le reintroduire ici.
//
// Les plans « card* » sont des cartons de typographie : leur duree se choisit
// librement, sans risque de figer une animation. Les plans produit gardent
// exactement la duree pour laquelle leur animation a ete concue : sauf `macro`,
// dont la camera recoit une cle supplementaire pour continuer a deriver.
// `cardC` est nouveau : la sequence du probleme se joue maintenant en TROIS
// temps au lieu de deux. « Il parle direct du telephone qui sonne mais le lien
// est pas fait » : il manquait la marche du milieu, celle qui relie la
// reservation qu'on vient de montrer a la facon dont elle arrive aujourd'hui.
const ORDRE = ['morning', 'cardA', 'cardB', 'cardC', 'card1', 'table', 'macro',
  'card2', 'chart', 'cardWbr', 'wbr', 'card3', 'outro'];

// Les plans PRODUIT gardent exactement la duree pour laquelle leur animation a
// ete concue. `macro` passe de 100 a 130 images et recoit une cle de camera
// supplementaire pour continuer a deriver au lieu de figer.
// `morning` porte DEUX phrases (l'accroche sur le logo, le contexte sur le
// planning) : c'est le seul plan produit qui en porte deux, donc le seul a avoir
// besoin de place. 268 images, et la derive de camera de `SceneOpen` s'etale
// jusque-la au lieu de se figer a 220.
const FIXES = { table: 190, macro: 130, chart: 105, wbr: 110, outro: 160 };

// `morning` N'EST PLUS UN PLAN A DUREE FIXE, C'EST UN PLANCHER.
//
// Il porte desormais TROIS phrases : la question qui qualifie (sur le logo), la
// presentation du planning (sur la vue large), et la reservation mise en
// evidence (sur le gros plan). Sa vue large ne tenait que 28 images : de quoi
// montrer la page, pas de quoi l'expliquer, et c'est exactement ce que Movsar a
// vu : « le "ça" on capte pas, parce qu'on comprend pas direct que c'est un
// planning ». Le plan prend donc la duree que ses phrases exigent, avec un
// plancher qui garantit que son animation a la place de se derouler.
//
// La scene ne devine pas ou couper : elle lit dans `narration.json` l'instant de
// la troisieme phrase et fait partir son gros plan la. Une phrase reecrite
// deplace la camera avec elle.
const PLANCHERS = { morning: 300 };

// Les CARTONS n'ont pas de duree ecrite : elle se CALCULE depuis la phrase qu'ils
// portent. C'est ce qui rend l'ensemble insensible au debit de la synthese : une
// meme phrase a mesure 2,29 s sur une prise et 2,91 s sur la suivante, et quatre
// phrases debordaient de leur plan quand les durees etaient fixees a la main.
// 0,30 ET NON 0,55. Seize plans x 0,25 s de queue en trop faisaient six
// secondes de film ou personne ne parle et ou rien ne se passe. Le fondu de
// sortie occupe les quatre dernieres images : 0,30 s laisse la phrase se poser
// sans laisser le plan trainer.
const MARGE_CARTON = 0.26;

// QUEUE ELASTIQUE DES PLANS PRODUIT. Leur duree est celle de leur animation, mais
// on autorise jusqu'a 20 images de tenue supplementaire si la phrase en a besoin :
// une demi-seconde de pose avant la coupe ne se voit pas, alors qu'une phrase
// coupee au milieu s'entend. Sans cette elasticite, il fallait re-regler le texte
// a chaque appel de synthese : le debit varie de 10 % d'une prise a l'autre.
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
// UNE INDICATION DE JEU TOUS LES QUATRE OU CINQ PLANS, PAS UNE PAR PHRASE.
//
// « La voix change et c'est pas fluide entre chaque. » Il y avait quatorze
// indications differentes pour quatorze phrases : le modele re-interprete a
// chaque crochet, donc il changeait de registre a chaque phrase : quatorze
// intentions collees bout a bout s'entendent comme quatorze prises.
// Une indication OUVRE un mouvement et les phrases suivantes la prolongent
// naturellement. Il en reste cinq, une par mouvement du film.
const LIGNES = [
  // --- MOUVEMENT 1 : ON QUALIFIE, ET ON MONTRE CE QU'ON REGARDE -------------
  //
  // « Ça, c'est une journée complète » : le « ça » ne designait rien pour
  // quelqu'un qui n'a jamais vu le produit, et « journée complète » ne veut rien
  // dire tant qu'on n'a pas compris qu'on regarde un planning. On NOMME donc
  // l'objet avant d'en parler, puis on explique sa grille, et seulement apres on
  // designe une reservation : pendant que la camera se ferme dessus.
  { decalage: 0.55, plan: 'morning', cible: 'aucun', jeu: '[énergique, souriant, tu interpelles quelqu’un]', texte: 'Tu gères un bowling, un laser game, un centre de loisirs ?' },
  { decalage: 'apres', plan: 'morning', cible: 'bandeau', texte: 'Ça, c’est ton planning du jour : chaque colonne, une piste, et chaque bloc, un groupe qui a réservé.' },
  { decalage: 'apres', plan: 'morning', cible: 'bandeau', texte: `Celui-là, c’est ${heureDite(HERO.heure)}, ${enLettres(HERO.pax)} joueurs, piste ${enLettres(HERO.piste)}.` },

  // --- MOUVEMENT 2 : LE PROBLEME, EN TROIS MARCHES --------------------------
  //
  // Il en manquait une, et c'est celle-la que Movsar a vu manquer : « ensuite
  // direct il parle du telephone qui sonne, mais le lien est pas fait ». On
  // passait de la reservation a l'ecran au comptoir sous pression sans dire
  // pourquoi les deux ont un rapport. La marche du milieu, c'est la question :
  // cette reservation, aujourd'hui, elle arrive comment ?
  { decalage: 0.18, plan: 'cardA', cible: 'carton', jeu: '[plus bas, complice, un peu pressé]', texte: 'Une résa comme celle-là, chez toi, elle arrive comment ? Neuf fois sur dix, au téléphone.' },
  { decalage: 0.18, plan: 'cardB', cible: 'carton', texte: 'Et le téléphone, il sonne quand t’es au comptoir. Trois groupes qui attendent, une commande à encaisser.' },
  { decalage: 0.18, plan: 'cardC', cible: 'carton', texte: 'Tu peux pas décrocher. Et l’appel que tu rates, c’est un groupe qui réserve ailleurs.' },

  // --- MOUVEMENT 3 : CE QUE C'EST, PUIS LE MECANISME ------------------------
  //
  // Une etape par plan, chacune MONTREE a l'ecran pendant qu'elle est dite. Les
  // phrases nomment ce que la page affiche vraiment : `table` fait voler les
  // reservations sur le planning puis tape une recherche, `macro` est la page des
  // arrivees du jour, `chart` la liste des evenements.
  { decalage: 0.18, plan: 'card1', cible: 'carton', jeu: '[ça s’ouvre, enjoué, la solution arrive]', texte: 'Pinlane, c’est le logiciel qui prend ces réservations à ta place, en ligne, jour et nuit.' },
  // Ces quatre phrases sont COURTES parce que leur plan est un plan produit : sa
  // duree est celle de son animation, et l'allonger la figerait (piege 78).
  // L'explication vit sur les cartons, la preuve sur le produit.
  { decalage: 0.18, plan: 'table', cible: 'bandeau', texte: 'Ton client réserve en ligne, et la résa se pose toute seule au bon créneau.' },
  // LA RECHERCHE EST A L'IMAGE : ELLE DOIT ETRE DITE. J'avais coupe cette phrase
  // pour tenir dans la duree du plan : et le plan continuait de taper « Dubois »
  // dans le champ de recherche puis de filtrer les vingt-six reservations,
  // pendant que la voix parlait d'autre chose. Une sequence qui joue sans
  // narration, sur du trafic froid, ne s'explique pas toute seule. Les deux
  // phrases sont donc raccourcies pour tenir a deux dans les 190 images.
  { decalage: 'apres', plan: 'table', cible: 'bandeau', texte: 'Tu cherches un groupe ? Tu tapes son nom, tu l’as.' },
  { decalage: 0.18, plan: 'macro', cible: 'bandeau', texte: 'Le jour même, tu vois qui arrive, à quelle heure, et combien ils sont, sans rien chercher.' },
  { decalage: 0.18, plan: 'card2', cible: 'carton', texte: 'Et ce qui demande une action, un acompte, un rappel, remonte tout seul en haut de la liste.' },
  { decalage: 0.18, plan: 'chart', cible: 'bandeau', texte: 'Tes anniversaires, tes groupes, tes soirées : tout au même endroit.' },

  // --- MOUVEMENT 4 : LA PREUVE, PUIS LE BENEFICE EN TROIS COUPS -------------
  { decalage: 0.18, plan: 'cardWbr', cible: 'carton', jeu: '[chaleureux, satisfait, tu constates le résultat]', texte: 'Le soir, ton chiffre et ton taux d’occupation sont déjà calculés.' },
  { decalage: 0.18, plan: 'wbr', cible: 'bandeau', texte: 'Tout est là, et tu n’as pas saisi une seule ligne de la journée.' },
  { decalage: 0.24, plan: 'card3', cible: 'carton', texte: 'Zéro saisie. Zéro double réservation. Zéro appel manqué.' },

  // --- L'APPEL A L'ACTION : un trafic froid a besoin qu'on lui dise quoi faire.
  { decalage: 0.40, plan: 'outro', cible: 'aucun', jeu: '[chaleureux, souriant, une invitation]', texte: 'Pinlane. La console de ton centre. Le lien est juste en dessous.' },
];


// --- PRONONCIATION : CE QUI EST DIT N'EST PAS TOUJOURS CE QUI EST ECRIT ------
//
// « La voix des fois elle prononce pas tres bien les mots. » La transcription ne
// le montre PAS : elle rend « Pinlane » meme quand la voix dit « pain-lane »,
// parce qu'elle choisit le mot le plus proche. Ma note de skill affirmait qu'une
// transcription correcte prouvait une bonne prononciation : c'est faux, elle
// prouve seulement qu'on a dit un mot reconnaissable.
//
// On corrige donc la prononciation LA OU ELLE SE CORRIGE : dans l'ecriture
// envoyee au modele. Le mot AFFICHE reste celui de gauche, le mot DIT est celui
// de droite. L'appariement caractere par caractere se fait sur la version dite,
// et les dates obtenues sont attribuees au mot affiche : les deux restent donc
// synchronises.
//
// « Pinlane » est le cas critique : c'est le nom de la marque, prononce deux fois
// dont une sur la signature. Le decoupage « Pinn-lane » evite la voyelle nasale
// francaise de « pin » (qui donne « pain ») et garde deux syllabes.
// Les mots ANGLAIS lus a la francaise sont le defaut le plus audible : « game »
// prononce « gamme » au lieu de « gueïme », « bowling » aplati. Ce sont les deux
// mots du metier de Movsar, dits dans la premiere phrase du film.
const PRONONCIATION = {
  Pinlane: 'Pinn-lane',
  bowling: 'bôling',
  game: 'gueïme',
};

// La cle est le mot NU : les jetons portent leur ponctuation (« bowling, »,
// « Pinlane. »), et une table indexee sur la forme ponctuee obligerait a
// enumerer chaque variante. On detache donc la ponctuation, on traduit, on la
// remet : et la casse initiale est preservee.
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

// Indication de pause entre les lignes : elle donne du silence a l'endroit ou on
// coupe, et de l'air a la diction. Les indications entre crochets ne sont pas
// lues (verifie par transcription sur cette voix et ce modele).
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
    res.setEncoding('utf8');
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
      rates.push(`ligne ${n + 1} finit a ${(l.at + l.duree).toFixed(2)}s, la ${n + 2} commence a ${suiv.at}s : chevauchement`);
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
    console.log(`  ATTENTION : moins de la moitie du film porte de la parole -`
      + ` c'est ce qui s'entend comme « on a le temps de dormir »`);
  }

  console.log('OK : chaque mot horodate, aucune ligne ne chevauche la suivante');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
