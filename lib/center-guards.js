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

function fait({ id, libelle, valeur, n = 0, du = '', au = '', mois = [], source = '', genre = 'estimation' }) {
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
  // Une affirmation saisonnière exige d'avoir vu la saison dont on parle.
  saisonnier: {
    exige: (m) => m.saison === 'cycle_complet',
    refus: 'la fenetre ne couvre pas une annee : la saisonnalite n est pas mesuree',
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

module.exports = {
  fait,
  maturite,
  peutAffirmer,
  reformulerEnHypothese,
  elire,
  distributionSuspecte,
  nombresDe,
  normaliserNombre,
  nombresAutorises,
  verifierProvenance,
  NATURES,
  N_ANECDOTE,
  N_NOURRI,
  MOIS_POUR_UNE_SAISON,
  MOIS_POUR_UN_CYCLE,
  N_POUR_ELIRE,
  PART_QUI_TRAHIT_UN_ARTEFACT,
  MIN_POUR_JUGER_UNE_DISTRIBUTION,
};
