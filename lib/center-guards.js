// Garde-fous de l'agent marketing : ce qui décide si une phrase a le droit
// d'exister. Module PUR (aucune DB, aucun réseau) pour rester testable seul.
//
// POURQUOI CE MODULE EXISTE
// L'agent produisait 39 idées « plan fraîcheur » sur 67, et 35 des 67 étaient
// le même texte recopié d'un centre à l'autre. La cause n'était pas le modèle :
// deriveIdeaCandidates écrit la phrase (renderIdeaContent) puis le modèle la
// reformule à partir d'UN seul chiffre (dataBasis), avec interdiction d'en
// ajouter. Un moteur à gabarits ne peut rien produire d'autre que de la
// répétition.
// En retirant les gabarits, on retire aussi le texte de référence auquel on
// comparait la sortie. Ces garde-fous le remplacent : le modèle écrit
// librement, et c'est la FICHE DE FAITS qui borne ce qu'il peut dire.

// ── UN FAIT ─────────────────────────────────────────────────────────────────
// Un fait n'est pas un nombre. C'est un nombre PLUS ce qui permet de juger
// jusqu'où on a le droit de s'en servir.
//   n      : combien d'observations le portent
//   du/au  : la fenêtre réelle des observations
//   mois   : les mois distincts couverts. La saisonnalité se lit LÀ, pas dans
//            le nombre de jours : 135 jours tous situés en juillet-août ne
//            couvrent aucun cycle.
//   source : la dérivation, rejouable à la main
//   genre  : DÉNOMBREMENT ou ESTIMATION. Distinction trouvée en écrivant le
//            gate : « 32 réservations sont sous 8 personnes » est vrai quel que
//            soit l'échantillon, c'est de l'arithmétique sur l'ensemble observé.
//            « le mardi est ton jour creux » généralise depuis 22 observations.
//            Les deux avaient la même barre, ce qui la rendait fausse dans les
//            deux sens : trop haute pour un comptage, trop basse pour un taux.
//            Défaut ESTIMATION : c'est le cas prudent.
const GENRES = new Set(['denombrement', 'estimation']);

// ── PERIODE ─────────────────────────────────────────────────────────────────
// Un fait a-t-il un RYTHME, ou n'est-il qu'un agregat ?
// Mesure sur un registre simule de 18 mois : 37 faits sur 39 pouvaient porter
// « saisonnier », dont panier_moyen, taux_annulation et trou_paiement. La barre
// ne regardait que la maturite du fait, jamais sa nature. « Ton trou de donnees
// de paiement est saisonnier » passait, et ca ne veut rien dire.
//
// Un fait periodique compare des tranches d'un cycle qui revient : les heures
// d'une journee, les jours d'une semaine, les mois d'une annee. Un agregat
// (panier moyen, taux de retour, chiffre total) ne compare rien : il resume.
// Seul le premier peut porter une affirmation qui parle de recurrence.
//
// FENETRE_GLISSANTE est a part et n'ouvre RIEN : une tendance a 90 jours
// compare deux periodes qui ne reviennent pas. C'est un mouvement, pas un
// rythme, et le confondre avec une saison est exactement la conclusion trop
// rapide qu'on cherche a empecher.
const PERIODES_RECURRENTES = new Set(['heure_jour', 'jour_semaine', 'mois_annee']);
const PERIODES = new Set([...PERIODES_RECURRENTES, 'fenetre_glissante']);

// ── AUDIENCE ────────────────────────────────────────────────────────────────
// A qui ce fait peut-il etre dit ? Le cycle publie un texte pret a coller sur
// Facebook. Sans cette distinction, rien n'empechait de proposer comme post
// « ton chiffre d'affaires est de 327 416 EUR », ni « 9,2 % de tes
// reservations n'ont pas de moyen de paiement ». Le premier est une fuite
// commerciale, le second n'a aucun sens pour un client.
// Le defaut est INTERNE, volontairement : un fait qu'on a oublie de classer ne
// part pas vers le public. La prudence va dans ce sens-la, jamais dans
// l'autre.
const AUDIENCES = new Set(['public', 'interne']);

function fait({
  id, libelle, valeur, n = 0, du = '', au = '', mois = [], source = '',
  genre = 'estimation', periode = '', audience = 'interne',
  // Un classement que le retrait d une seule ligne renverse. Porte par le
  // fait lui-meme et pas par son libelle : peutAffirmer doit pouvoir le lire
  // sans relire du francais.
  fragile = false, motifFragilite = '',
}) {
  return {
    id,
    libelle,
    valeur,
    n: Number(n) || 0,
    du: String(du || ''),
    au: String(au || ''),
    mois: [...new Set(mois || [])].sort(),
    source: String(source || ''),
    genre: GENRES.has(genre) ? genre : 'estimation',
    // Defaut vide : un fait qui ne declare pas de periode n'en a pas, donc il
    // ne portera aucune affirmation de recurrence. Le cas prudent, comme pour
    // le genre.
    periode: PERIODES.has(periode) ? periode : '',
    audience: AUDIENCES.has(audience) ? audience : 'interne',
    fragile: Boolean(fragile),
    motifFragilite: fragile ? String(motifFragilite || '') : '',
  };
}

// ── MATURITÉ ────────────────────────────────────────────────────────────────
// L'échelle historique (lib/center-metrics.js confidenceFor) déclare « solide »
// à 12 observations et mélange deux questions distinctes. On les sépare :
//   - le fait est-il assez nourri ?     -> n
//   - couvre-t-il assez de saisons ?    -> mois distincts
// Un fait peut être très nourri et totalement asaisonnier.
const N_ANECDOTE = 30;
const N_NOURRI = 100;
const MOIS_POUR_UNE_SAISON = 3;
const MOIS_POUR_UN_CYCLE = 12;

function maturite(f) {
  const nbMois = (f.mois || []).length;
  const n = Number(f.n) || 0;
  return {
    volume: n < N_ANECDOTE ? 'anecdote' : (n < N_NOURRI ? 'nourri' : 'dense'),
    saison: nbMois < MOIS_POUR_UNE_SAISON ? 'ponctuel'
      : (nbMois < MOIS_POUR_UN_CYCLE ? 'partiel' : 'cycle_complet'),
    n,
    mois: nbMois,
  };
}

// ── NATURE DE L'AFFIRMATION ─────────────────────────────────────────────────
// La couche qui manquait, et la seule qui répond au cas des anniversaires :
// même avec 10 000 réservations sur trois ans, « passe le minimum de 6 à 8 »
// reste indémontrable, parce que TOUT l'historique a été produit sous la règle
// des 6. Ce n'est pas un manque de données, c'est une impossibilité de nature :
// aucun seuil d'échantillon ne la lève.
const NATURES = {
  // Ce qui s'est passé. Un dénombrement se prouve par lui-même : compter les
  // lignes qui existent n'exige aucune puissance statistique. Une estimation
  // (taux, moyenne, classement) généralise et doit donc être nourrie.
  constat: {
    exige: (m, f) => f.genre === 'denombrement' || m.volume !== 'anecdote',
    refus: 'estimation calculee sur trop peu d observations pour etre affirmee',
  },
  // Un geste qu'on annule en un clic (heure de publication, cible d'un mail).
  // Le coût d'erreur est faible, la barre suit. Mais un geste s'appuie sur un
  // comportement, jamais sur un simple comptage : la barre reste celle de
  // l'estimation même pour un dénombrement.
  levier_reversible: {
    exige: (m) => m.volume !== 'anecdote' && m.saison !== 'ponctuel',
    refus: 'observations trop concentrees sur une seule periode pour recommander un geste',
  },
  // Une affirmation saisonnière exige d'avoir vu la saison dont on parle, ET de
  // tenir debout comme constat. Une affirmation sur les saisons est PLUS forte
  // qu'une description : elle ne peut pas en exiger moins.
  // Relevé en instrumentant le handler de l'agent : sur un registre riche, la
  // barre saisonnière passait sur 20 faits quand le constat n'en passait que
  // 18. Deux faits trop minces pour être simplement ENONCES pouvaient donc
  // porter une conclusion sur l'année. Chaque barre était defendable seule,
  // c'est leur ordre qui était faux.
  // Troisieme condition, ajoutee apres mesure : le fait doit AVOIR une periode
  // recurrente. Les deux premieres ne parlent que de la quantite de donnee ;
  // sur un registre de 18 mois, elles laissaient passer « ton panier moyen est
  // saisonnier » et « ton trou de donnees de paiement est saisonnier ». Un
  // agregat resume, il ne compare pas des tranches de cycle : il ne peut rien
  // dire d une recurrence, quelle que soit la quantite de donnee derriere lui.
  saisonnier: {
    exige: (m, f) => m.saison === 'cycle_complet'
      && PERIODES_RECURRENTES.has(f.periode)
      && NATURES.constat.exige(m, f),
    refus: 'la fenetre ne couvre pas une annee, ou le fait n a pas de periode qui revient, ou il est trop mince pour etre affirme',
  },
  // Prix, minimum de personnes, horaires, retrait d'une formule.
  regle_commerciale: {
    exige: () => false,
    refus: 'un changement de regle ne se conclut pas depuis un historique produit sous l ancienne regle',
  },
};

function peutAffirmer(f, nature) {
  const regle = NATURES[nature];
  if (!regle) return { autorise: false, motif: `nature inconnue : ${nature}` };
  const m = maturite(f);
  // AVANT toute question de nature et de volume. Le volume repond a « y a-t-il
  // de la matiere », la fragilite repond a « le vainqueur tient-il ». Un
  // registre de 2 000 lignes peut porter un classement decide par une seule
  // d entre elles : attendre plus de donnee ne repare pas cet ecart-la.
  if (f && f.fragile) {
    return {
      autorise: false,
      motif: f.motifFragilite || 'classement renverse par une seule reservation',
      maturite: m,
    };
  }
  if (regle.exige(m, f)) return { autorise: true, maturite: m };
  return { autorise: false, motif: regle.refus, maturite: m };
}

// Un refus n'est pas un silence. Quand une règle commerciale est écartée,
// l'agent rend la question utile : le volume en jeu, l'argent en jeu, et la
// comparaison qui trancherait sans rien changer.
function reformulerEnHypothese({ sujet, populationARisque, chiffreARisque, comparaisonDisponible }) {
  return {
    sujet,
    statut: 'hypothese',
    aTester: true,
    populationARisque,
    chiffreARisque,
    comparaisonDisponible: comparaisonDisponible || null,
  };
}

// ── UN CLASSEMENT N'ÉLIT PAS SOUS UN SEUIL ──────────────────────────────────
// Relevé en construisant la fiche : « formule la plus rentable : FUN FRIDAY
// MADNESS, 450 EUR » sur UNE vente. Le fait était correctement étiqueté
// anecdote, mais il figurait dans la fiche au même rang que les autres, et un
// lecteur pressé en fait un conseil. Un classement doit donc refuser d'élire
// plutôt que produire un vainqueur fragile qu'on étiquettera ensuite : on
// écarte les candidats trop maigres AVANT de trier. S'il ne reste personne,
// il n'y a pas de champion, et c'est une réponse valable.
const N_POUR_ELIRE = 8;

function elire(candidats, score, { minN = N_POUR_ELIRE } = {}) {
  const liste = Array.isArray(candidats) ? candidats : [];
  const eligibles = liste.filter((c) => (Number(c.n) || 0) >= minN);
  if (!eligibles.length) {
    return { elu: null, motif: `aucun candidat n atteint ${minN} observations`, ecartes: liste.length };
  }
  const trie = eligibles.slice().sort((a, b) => score(b) - score(a));
  return { elu: trie[0], ecartes: liste.length - eligibles.length, dauphin: trie[1] || null };
}

// ── UNE DISTRIBUTION DÉGÉNÉRÉE EST UN ARTEFACT ──────────────────────────────
// Relevé sur la même exécution : 226 réservations sur 253 créées à 0h00, et
// 229 un mardi. Aucun public ne se comporte comme ça : c'est le script de seed
// qui a tout horodaté d'un coup. Une masse écrasée sur un seul seau n'est pas
// un fait sur les clients, c'est un fait sur la fabrication de la donnée.
// Sans cette garde l'agent conseille de publier à minuit.
const PART_QUI_TRAHIT_UN_ARTEFACT = 80;
// On ne declare pas une distribution fabriquee depuis une poignee de points :
// douze reservations toutes a 19h peuvent etre un vrai creneau. C'est le
// VOLUME qui autorise le jugement, pas le nombre de seaux.
// Premiere version : on sortait des qu'il n'y avait qu'un seul seau. C'etait
// l'inverse du bon critere, et le gate l'a montre : quarante lignes horodatees
// a la meme seconde par un seed formaient UN seul seau, donc le cas le plus
// degenere possible passait sans alerte.
const MIN_POUR_JUGER_UNE_DISTRIBUTION = N_ANECDOTE;

// Une election ROBUSTE : le vainqueur gagne-t-il encore sans sa plus grosse
// ligne ? On mesure deux choses et on les compare.
//
//   marge  = score(gagnant) - score(dauphin)        son avance
//   poids  = |score(gagnant) - score(gagnant affaibli)|  ce que pese UNE ligne
//
// fragile quand poids >= marge : une seule reservation suffit a effacer l avance.
//
// Le retrait ne porte que sur le GAGNANT, volontairement. La question n est pas
// « qui gagnerait si tout le monde perdait sa meilleure ligne » : c est
// « ce gagnant-ci tient-il debout sans la sienne ».
//
// Sans dauphin (un seul candidat passe la barre de volume) il n y a pas d ecart
// a effacer : l election est robuste par construction, et c est dit ici plutot
// que laisse a l interpretation.
//
// affaiblir() vient de l appelant : lui seul sait ce que « la plus grosse
// ligne » veut dire pour ses lignes (un prix, une duree, un nombre de personnes).
// Les gardes ne connaissent pas le schema du registre, et ne doivent pas.
function elireRobuste(candidats, score, options = {}) {
  const base = elire(candidats, score, options);
  if (!base.elu) return { ...base, fragile: false, marge: 0, poids: 0, motifFragilite: '' };
  if (!base.dauphin) {
    return { ...base, fragile: false, marge: Infinity, poids: 0, motifFragilite: '' };
  }
  const affaiblir = typeof options.affaiblir === 'function' ? options.affaiblir : null;
  const affaibli = affaiblir ? affaiblir(base.elu) : null;
  if (!affaibli) return { ...base, fragile: false, marge: 0, poids: 0, motifFragilite: '' };
  const marge = score(base.elu) - score(base.dauphin);
  const poids = Math.abs(score(base.elu) - score(affaibli));
  const fragile = poids >= marge;
  return {
    ...base,
    fragile,
    marge,
    poids,
    motifFragilite: fragile
      ? 'classement decide par une seule reservation : retirer la plus grosse ligne du vainqueur efface son avance'
      : '',
  };
}

function distributionSuspecte(seaux) {
  const entrees = Object.entries(seaux || {});
  const total = entrees.reduce((s, [, n]) => s + (Number(n) || 0), 0);
  if (!total || total < MIN_POUR_JUGER_UNE_DISTRIBUTION) return { suspecte: false, total };
  const [seau, n] = entrees.slice().sort((a, b) => b[1] - a[1])[0];
  const part = Math.round((n / total) * 1000) / 10;
  const suspecte = part >= PART_QUI_TRAHIT_UN_ARTEFACT;
  return {
    suspecte,
    seauDominant: seau,
    part,
    total,
    motif: suspecte
      ? `${part} % de la masse sur la seule valeur "${seau}" : distribution fabriquee, pas observee`
      : '',
  };
}

// ── PROVENANCE ──────────────────────────────────────────────────────────────
// Sans gabarit il n'y a plus de texte de référence : on compare donc à la
// FICHE ENTIÈRE. Tout nombre écrit par le modèle doit s'y trouver ; un nombre
// absent est une invention et le texte est rejeté.
//
// Les séparateurs de milliers du français : espace ordinaire, insécable (A0),
// fine insécable (202F, celle que pose toLocaleString('fr-FR')) et fine (2009).
// Les oublier coupe « 5 607 » en « 5 » et « 607 », donc rejette un texte VRAI.
// Un faux positif est pire qu'un trou : il rend la garde inutilisable, donc on
// la débranche, donc il n'y a plus de garde du tout.
const ESPACES_MILLIER = '\u0020\u00a0\u202f\u2009';

// [0-9] plutôt que \d : la classe est construite par concaténation, et un
// antislash qui traverse un outil de patch se perd en silence.
const MOTIF_NOMBRE = `[0-9][0-9${ESPACES_MILLIER}.,]*`;

function normaliserNombre(brut) {
  let s = String(brut).replace(new RegExp(`[${ESPACES_MILLIER}]`, 'g'), '');
  if (!s) return null;
  const dernierPoint = s.lastIndexOf('.');
  const derniereVirgule = s.lastIndexOf(',');
  if (dernierPoint >= 0 && derniereVirgule >= 0) {
    // Le séparateur décimal est le dernier des deux ; l'autre marque les milliers.
    const sep = dernierPoint > derniereVirgule ? '.' : ',';
    const millier = sep === '.' ? ',' : '.';
    s = s.split(millier).join('');
    if (sep === ',') s = s.replace(',', '.');
  } else if (derniereVirgule >= 0) {
    // Virgule seule : décimale si 1 ou 2 chiffres derrière, sinon milliers.
    s = (s.length - derniereVirgule - 1) <= 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (dernierPoint >= 0 && (s.length - dernierPoint - 1) === 3) {
    s = s.split('.').join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nombresDe(texte) {
  const trouves = [];
  const motif = new RegExp(MOTIF_NOMBRE, 'g');
  let m = motif.exec(String(texte || ''));
  while (m) {
    const brut = m[0].trim().replace(/[.,]$/, '');
    const valeur = normaliserNombre(brut);
    if (valeur !== null) trouves.push({ brut, valeur });
    m = motif.exec(String(texte || ''));
  }
  return trouves;
}

// L'ensemble des nombres qu'un texte a le DROIT de contenir.
function nombresAutorises(fiche) {
  const autorises = new Set();
  const avaler = (v) => {
    nombresDe(String(v)).forEach((x) => {
      // Un montant arrondi à l'euro reste le même fait : on tolère l'arrondi
      // du modèle dans les deux sens, jamais une valeur inventée.
      autorises.add(x.valeur);
      autorises.add(Math.round(x.valeur));
      autorises.add(Math.floor(x.valeur));
      autorises.add(Math.ceil(x.valeur));
    });
  };
  Object.values(fiche || {}).forEach((f) => {
    if (!f) return;
    avaler(f.valeur);
    if (f.n) avaler(f.n);
    if (f.du) avaler(f.du);
    if (f.au) avaler(f.au);
    (f.mois || []).forEach(avaler);
  });
  return autorises;
}

// Verdict de provenance. `intrus` non vide = le texte part à la poubelle.
function verifierProvenance(texte, fiche) {
  const autorises = nombresAutorises(fiche);
  const intrus = nombresDe(texte)
    .filter((x) => !autorises.has(x.valeur))
    .map((x) => x.brut);
  return { propre: intrus.length === 0, intrus: [...new Set(intrus)] };
}

// ── SANS ACCENT NI CASSE ────────────────────────────────────────────────────
// Une seule normalisation pour toutes les gardes lexicales. Elle vivait dans
// lib/center-advisor.js, pour les revendications interdites ; la garde des
// regles commerciales ci-dessous en a besoin aussi, et deux copies d'un
// normaliseur derivent toujours : celle qui aplatit les apostrophes et celle
// qui a oublie de le faire. Une seule autorite, importee par les deux.
//
// Ce qu'elle aplatit : accents (un accent de difference suffirait a passer au
// travers), casse, puis apostrophes, tirets, points et soulignes vers l'espace.
// Sans ce dernier point la liste des interdits contient « golf o'clock » mais
// pas « golf o clock », et il suffit de retirer une apostrophe pour passer.
// Le tiret est en DERNIERE position dans la classe : au milieu il formerait une
// plage de caracteres, et la garde ne verrait plus rien. Defaut paye une fois.
function sansAccentNiCasse(valeur) {
  return String(valeur || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(new RegExp('[' + String.fromCharCode(39, 8217, 96, 95, 46, 8211, 8212, 45) + ']', 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── UN CHANGEMENT DE REGLE NE SE DECLARE PAS, IL S'ECRIT ────────────────────
// NATURES.regle_commerciale refuse deja cette conclusion, mais seulement quand
// le modele la DECLARE. Il ne la declarera jamais : « regle_commerciale » ne
// figure meme pas dans les natures qu'il a le droit de choisir. S'il veut
// conseiller de passer le minimum anniversaire a 8 personnes, il ecrit le
// conseil et coche « levier_reversible ». L'etiquette ne protege que d'un
// modele honnete.
//
// C'est le cas nomme mot pour mot par Movsar : « il voit que les formules
// anniversaire sont a 6 personnes minimum, il constate que 8 serait plus
// rentable, il ne faut pas qu'il dise ca apres 10 reservations ». La garde de
// provenance ne l'attrape pas : 8 peut parfaitement exister dans la fiche (8
// personnes par reservation en moyenne), donc le nombre est legitime. Il faut
// lire le TEXTE, pas seulement les nombres.
//
// Deux conditions dans la MEME phrase, jamais une seule :
//   - un verbe de changement, a l'infinitif ou a l'imperatif ;
//   - l'objet d'une regle commerciale (prix, minimum, horaire, duree, formule).
// La conjonction est ce qui evite le faux positif. Les verbes conjugues a la
// 3e personne sont volontairement absents : « la frequentation baisse le mardi »
// DECRIT, « il faudrait baisser le minimum » RECOMMANDE, et c'est la forme du
// verbe qui les separe.
//
// Cout d'un faux positif ici : le conseil est jete, donc du silence sur ce
// cycle. C'est acceptable. Ca ne l'etait pas pour la garde de provenance, ou un
// faux positif frappe tout texte contenant un chiffre vrai et finirait par
// faire debrancher la garde entiere.
// Ce qui reste permis, et voulu : DECRIRE (« 32 reservations sont sous 8
// personnes »), et proposer un essai qui ne touche a aucune regle.
const VERBES_DE_CHANGEMENT = [
  'passer', 'passez', 'augmenter', 'augmentez', 'baisser', 'baissez',
  'monter', 'montez', 'remonter', 'remontez', 'descendre', 'descendez',
  'reduire', 'reduisez', 'relever', 'relevez', 'abaisser', 'abaissez',
  'fixer', 'fixez', 'changer', 'changez', 'modifier', 'modifiez',
  'supprimer', 'supprimez', 'retirer', 'retirez', 'ajuster', 'ajustez',
  'revoir', 'revoyez', 'doubler', 'doublez', 'limiter', 'limitez',
  'imposer', 'imposez', 'exiger', 'exigez', 'instaurer', 'instaurez',
];
const OBJETS_DE_REGLE = [
  'prix', 'tarif', 'tarifs', 'tarification', 'minimum', 'minimums',
  'seuil', 'seuils', 'horaire', 'horaires', 'duree', 'durees',
  'formule', 'formules', 'forfait', 'forfaits', 'acompte', 'acomptes',
];

function conseilDeRegleCommerciale(texte) {
  const extraits = [];
  // ORDRE : on decoupe le texte BRUT, puis on normalise chaque fragment.
  // L'inverse ne marche pas, et c'est ce que j'avais ecrit d'abord :
  // sansAccentNiCasse aplatit deja le point en espace, donc apres elle il ne
  // reste plus une seule frontiere de phrase et le texte entier redevient une
  // phrase unique. « Le prix est stable. Il faudrait changer la communication. »
  // serait alors rejete pour un verbe et un objet qui ne se sont jamais
  // rencontres. Bug trouve en relisant, la contre-preuve du gate le verrouille.
  String(texte || '').split(/[.!?;:\n]+/).forEach((brut) => {
    const phrase = ` ${sansAccentNiCasse(brut)} `;
    if (phrase.length <= 2) return;
    // Les bornes d'espaces sont indispensables : sans elles « depasser le mardi
    // creux » contient « passer » et serait pris pour un conseil de tarif.
    const verbe = VERBES_DE_CHANGEMENT.find((v) => phrase.includes(` ${v} `));
    if (!verbe) return;
    const objet = OBJETS_DE_REGLE.find((o) => phrase.includes(` ${o} `));
    if (!objet) return;
    extraits.push(`${verbe} + ${objet}`);
  });
  return { detecte: extraits.length > 0, extraits: [...new Set(extraits)] };
}

// ── LE TIRET CADRATIN EST UNE SIGNATURE ─────────────────────────────────────
// Regle maison absolue : le cadratin et le demi-cadratin sont la signature
// typographique d'un texte de modele, interdits partout. Un gate scanne deja
// les FICHIERS du depot, mais un conseil marketing n est pas un fichier : il
// est genere a l execution et publie tel quel dans la console du gerant, ou
// aucun gate ne passe.
//
// Ce n'est pas theorique. En mesurant l'ADN avant de le brancher : la regle
// active #63 contient un cadratin. Brancher cet ADN comme doctrine revient a
// mettre sous les yeux du modele un exemple de la chose quon lui interdit. Le
// prompt le lui interdit deja ; un prompt nest pas une garde.
//
// Les caracteres sont ecrits par leur code, jamais en clair : ce fichier est
// lui-meme scanne par le gate anti-cadratin.
const TIRETS_DE_MODELE = [String.fromCharCode(8212), String.fromCharCode(8211)];

function tiretsDeModele(texte) {
  const brut = String(texte || '');
  return TIRETS_DE_MODELE.filter((tiret) => brut.includes(tiret));
}

// Le meme probleme cote ENTREE : la doctrine quon injecte vient de la base et
// contient ces tirets. On ne les corrige pas en base (cest de la donnee, elle
// se corrige a la source, pas en douce a la lecture), mais on ne montre pas au
// modele un exemple de ce quon lui refuse : le conseil serait jete, et on
// perdrait un cycle pour notre propre faute.
function sansTiretsDeModele(texte) {
  let brut = String(texte || '');
  TIRETS_DE_MODELE.forEach((tiret) => { brut = brut.split(tiret).join(' '); });
  return brut.replace(/[ \t]{2,}/g, ' ');
}
// Tous les nombres qu un OBJET contient, a n importe quelle profondeur.
// nombresAutorises lit une fiche de faits, dont la forme est connue. Le mode
// Demander travaille sur un dossier LIBRE, reassemble a chaque question : meme
// regle (un nombre ecrit doit exister dans la matiere fournie), autre forme
// d entree.
// La profondeur est bornee pour la meme raison que dans le collecteur d
// origine : un dossier est un arbre, pas une liste, et rien ne garantit qu il
// reste petit le jour ou on lui ajoutera une section.
const PROFONDEUR_MAX_DOSSIER = 6;

function nombresDUnObjet(valeur) {
  const trouves = new Set();
  const avaler = (x) => {
    if (!Number.isFinite(x)) return;
    trouves.add(x);
    trouves.add(Math.round(x));
    trouves.add(Math.floor(x));
    trouves.add(Math.ceil(x));
  };
  const visiter = (v, profondeur) => {
    if (profondeur > PROFONDEUR_MAX_DOSSIER || v === null || v === undefined) return;
    if (typeof v === 'number') { avaler(v); return; }
    if (typeof v === 'string') { nombresDe(v).forEach((x) => avaler(x.valeur)); return; }
    if (Array.isArray(v)) { v.forEach((item) => visiter(item, profondeur + 1)); return; }
    if (typeof v === 'object') { Object.values(v).forEach((item) => visiter(item, profondeur + 1)); }
  };
  visiter(valeur, 0);
  return trouves;
}
// ── UN CHIFFRE COLLE A UNE UNITE ────────────────────────────────────────────
// La garde de provenance demande qu un nombre EXISTE dans la matiere. Elle ne
// peut pas dire s il est au BON ENDROIT : « nos 7 pistes de bowling » passait,
// parce que 7 traine dans « laser des 7 ans ». Le centre en a 8. Un client qui
// se deplace le voit au comptoir.
//
// Ici on lit des couples chiffre + unite, des deux cotes : dans le texte du
// modele et dans les faits de la fiche. Si la fiche declare des « pistes »,
// alors un nombre de pistes doit etre un de ceux qu elle declare.
//
// Deux choix assumes :
//   - une unite dont la fiche ne parle PAS ne contraint rien. Inventer une
//     contrainte sur ce qu on ne connait pas produirait des refus aveugles.
//   - une somme legitime est refusee : la fiche declare 8 pistes de bowling et
//     2 de duckpin, donc « 10 pistes au total » tombe. Le modele peut dire les
//     deux separement. Refuser une phrase vraie coute une phrase ; accepter
//     « 7 pistes » coute un client devant un comptoir.
const UNITES_VERIFIABLES = ['piste', 'joueur', 'table', 'trou', 'etage', 'niveau', 'borne', 'enfant', 'equipement', 'lancement'];

function couplesChiffreUnite(texte) {
  const motif = new RegExp('([0-9]+)\\s*(' + UNITES_VERIFIABLES.join('|') + ')s?\\b', 'gi');
  const couples = [];
  let trouve = motif.exec(sansAccentNiCasse(texte));
  while (trouve) {
    couples.push({ valeur: Number(trouve[1]), unite: String(trouve[2]).toLowerCase() });
    trouve = motif.exec(sansAccentNiCasse(texte));
  }
  return couples;
}

function unitesIncoherentes(contenu, fiche) {
  const declarees = new Map();
  Object.values(fiche || {}).forEach((f) => {
    if (!f) return;
    couplesChiffreUnite(f.valeur).forEach(({ valeur, unite }) => {
      if (!declarees.has(unite)) declarees.set(unite, new Set());
      declarees.get(unite).add(valeur);
    });
  });
  const fautes = [];
  couplesChiffreUnite(contenu).forEach(({ valeur, unite }) => {
    const connues = declarees.get(unite);
    if (!connues || connues.has(valeur)) return;
    fautes.push(`${valeur} ${unite}(s) alors que ce centre en declare ${[...connues].sort((a, b) => a - b).join(' ou ')}`);
  });
  return [...new Set(fautes)];
}
// ── NE PAS RESSERVIR LE MEME PLAT ───────────────────────────────────────────
// Dire au modele « ne te repete pas » est une consigne, pas une garde. Celle-ci
// compare ce qu'il propose a ce qui est deja parti pour ce centre :
//   - le meme titre, aux accents et a la ponctuation pres ;
//   - le meme JEU DE FAITS, qui est la substance de l'idee. Reformuler la meme
//     analyse sur exactement les memes faits reste la meme analyse, et c'est
//     precisement ce que produisait l'ancien moteur a gabarits.
//
// La consequence d'un refus est le silence de ce cycle. C'est la bonne : si la
// seule chose a dire est celle d'avant, il n'y a rien a dire.
//
// La fenetre est glissante et courte. Un sujet a le droit de revenir quand la
// donnee a bouge ; ce qu'on interdit, c'est de le resservir la semaine d'apres.
const JOURS_DE_MEMOIRE = 30;

function repetitionRecente(proposition, historique = [], aujourdhui = '') {
  const limite = Date.parse(`${aujourdhui}T00:00:00Z`) - JOURS_DE_MEMOIRE * 86400000;
  const recentes = (Array.isArray(historique) ? historique : []).filter((ligne) => {
    if (!ligne) return false;
    if (!aujourdhui) return true;
    const quand = Date.parse(String(ligne.proposed_at || ''));
    // Une ligne sans date lisible compte comme recente : en cas de doute on
    // retient la contrainte, jamais la permission.
    return !Number.isFinite(quand) || quand >= limite;
  });

  const titre = sansAccentNiCasse(proposition && proposition.titre);
  if (titre && recentes.some((ligne) => sansAccentNiCasse(ligne.title) === titre)) {
    return { repete: true, motif: 'ce titre a deja ete propose a ce centre' };
  }

  const cle = (ids) => [...new Set((ids || []).filter(Boolean).map(String))].sort().join('+');
  const cleProposee = cle(proposition && proposition.faitsUtilises);
  if (!cleProposee) return { repete: false, motif: '' };
  const dejaVue = recentes.some((ligne) => {
    const base = Array.isArray(ligne.data_basis) ? ligne.data_basis : [];
    return cle(base.map((item) => item && item.factId)) === cleProposee;
  });
  return dejaVue
    ? { repete: true, motif: 'la meme analyse, sur exactement les memes faits, est deja partie' }
    : { repete: false, motif: '' };
}

// ── UN CHIFFRE QUI N EXISTE QUE COTE INTERNE ────────────────────────────────
// La vraie garde. Ne montrer au modele que les faits publics est du confort :
// ca ne prouve rien, un modele peut ecrire un nombre qu'il n'a pas vu. Celle-ci
// se pose sur la SORTIE : un nombre present dans un fait interne et dans aucun
// fait public n'a pas le droit d'apparaitre dans un texte destine aux clients.
//
// L'intersection compte. 8 peut etre a la fois « 8 pistes » (public) et un
// montant interne ; on ne refuse que ce qui est EXCLUSIVEMENT interne. Sans
// cette precaution la garde mordrait sur des faits publics parfaitement
// citables, et une garde qui mord a tort finit debranchee.
function nombresReservesAuGerant(fiche) {
  const parAudience = (audience) => {
    const sous = {};
    Object.entries(fiche || {}).forEach(([cle, f]) => {
      if (f && f.audience === audience) sous[cle] = f;
    });
    return nombresAutorises(sous);
  };
  const publics = parAudience('public');
  const internes = parAudience('interne');
  const reserves = new Set();
  internes.forEach((valeur) => { if (!publics.has(valeur)) reserves.add(valeur); });
  return reserves;
}

function fuiteVersLePublic(texte, fiche) {
  const reserves = nombresReservesAuGerant(fiche);
  const intrus = nombresDe(texte).filter((x) => reserves.has(x.valeur)).map((x) => x.brut);
  return [...new Set(intrus)];
}
module.exports = {
  fait,
  maturite,
  peutAffirmer,
  reformulerEnHypothese,
  elire,
  elireRobuste,
  distributionSuspecte,
  nombresDe,
  normaliserNombre,
  nombresAutorises,
  nombresDUnObjet,
  nombresReservesAuGerant,
  fuiteVersLePublic,
  AUDIENCES,
  couplesChiffreUnite,
  unitesIncoherentes,
  verifierProvenance,
  PERIODES,
  PERIODES_RECURRENTES,
  sansAccentNiCasse,
  conseilDeRegleCommerciale,
  repetitionRecente,
  JOURS_DE_MEMOIRE,
  tiretsDeModele,
  sansTiretsDeModele,
  NATURES,
  N_ANECDOTE,
  N_NOURRI,
  MOIS_POUR_UNE_SAISON,
  MOIS_POUR_UN_CYCLE,
  N_POUR_ELIRE,
  PART_QUI_TRAHIT_UN_ARTEFACT,
  MIN_POUR_JUGER_UNE_DISTRIBUTION,
};
