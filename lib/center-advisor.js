// Le conseil marketing sans aucune phrase préfaite.
//
// CE QUI CHANGE PAR RAPPORT À L'EXISTANT
// deriveIdeaCandidates + renderIdeaContent ÉCRIVENT la phrase, puis
// polishIdeaWithAi la fait reformuler par le modèle à partir d'UN seul chiffre,
// avec interdiction d'en ajouter. Résultat mesuré le 2026-09-09 : sur 67 idées,
// 39 sont un « plan fraîcheur » et 35 sont le même texte recopié d'un centre à
// l'autre. Le modèle ne peut rien faire d'autre : on lui donne une phrase et un
// nombre.
//
// Ici, aucune phrase de départ. Le modèle reçoit la FICHE ENTIÈRE (lib/
// center-facts.js), il choisit lui-même ce qui mérite d'être dit, et il déclare
// ce qu'il utilise. Ce sont les garde-fous (lib/center-guards.js) qui décident
// ensuite si sa sortie a le droit d'exister :
//   - tout nombre écrit doit exister dans la fiche ;
//   - tout fait cité doit exister dans la fiche ;
//   - la nature de l'affirmation doit être portée par les faits cités ;
//   - aucun nom propre non ancré.
// Rien de tout ça n'est laissé au jugement du modèle : c'est vérifié après coup,
// et un texte qui échoue est jeté, pas rattrapé.
const { callLlmJson } = require('./llm-client');
const {
  peutAffirmer, verifierProvenance, NATURES, sansAccentNiCasse, conseilDeRegleCommerciale,
  tiretsDeModele, sansTiretsDeModele,
} = require('./center-guards');
const { nomsPropresNonAncres } = require('./center-metrics');

// Les natures que le modèle a le droit de revendiquer. « regle_commerciale »
// n'y figure pas : elle n'est jamais une conclusion, et une proposition qui la
// vise doit passer par reformulerEnHypothese, pas par ce chemin.
const NATURES_PROPOSABLES = ['constat', 'levier_reversible', 'saisonnier'];

// Ce que le modèle voit d'un fait. On lui donne AUSSI ce que ce fait autorise :
// sans ça il propose un levier appuyé sur une anecdote, on le rejette, et il
// recommence. Lui dire d'avance coûte moins cher qu'un aller-retour.
function portefeuille(fiche) {
  return Object.values(fiche).map((f) => ({
    id: f.id,
    libelle: f.libelle,
    valeur: f.valeur,
    observations: f.n,
    fenetre: f.du && f.au ? `${f.du} -> ${f.au}` : '',
    moisCouverts: f.mois.length,
    calcul: f.source,
    peutPorter: NATURES_PROPOSABLES.filter((nature) => peutAffirmer(f, nature).autorise),
  }));
}

// Un fait qui ne peut porter aucune nature proposable ne sert à rien au modèle
// et grossit le prompt. On le garde quand même dans la fiche de vérification :
// un nombre qu'il contient reste un nombre légitime si le modèle le cite.
function faitsUtiles(fiche) {
  return portefeuille(fiche).filter((f) => f.peutPorter.length > 0);
}

// Y a-t-il de quoi PARLER, et pas seulement de quoi compter ?
// Defaut trouve par le gate : sur un centre a UNE reservation, registre_taille
// vaut 1, c'est un denombrement, donc affirmable, donc le modele etait appele
// et pouvait ecrire « tu as 1 reservation ». C'est vrai et sans interet, et ca
// coute un appel.
// Un comptage decrit, il ne renseigne pas : il faut au moins une ESTIMATION
// (taux, moyenne, classement) qui tienne debout, c'est-a-dire un comportement
// reellement mesure. Sans ca, le silence est la bonne reponse : c'est le cas
// d'un centre pas encore lance.
function porteDeQuoiParler(fiche) {
  return Object.values(fiche || {}).some(
    (f) => f.genre === 'estimation' && peutAffirmer(f, 'constat').autorise,
  );
}

// La normalisation (accents, casse, ponctuation aplatie) vit desormais dans
// lib/center-guards.js : la garde des regles commerciales en a besoin aussi,
// et deux copies d'un normaliseur finissent toujours par diverger.
// Les mots qu'un centre n'a PAS le droit d'ecrire, calcules par
// buildCenterFacts a partir de ses activites reelles. La liste de Libramont
// contient « golf o'clock », l'activite que Gembloux possede et lui pas : la
// garde inter-centres est deja dans la donnee, il suffisait de la lire.
// Le garde-fou des nombres ne couvre pas ce cas : « venez au Golf o'Clock »
// ne contient aucun chiffre.
function revendicationsInterdites(contenu, centerFacts) {
  const interdits = (centerFacts && centerFacts.forbiddenClaims) || [];
  const normalise = sansAccentNiCasse(contenu);
  return interdits.filter((claim) => {
    const aiguille = sansAccentNiCasse(claim);
    return aiguille && normalise.includes(aiguille);
  });
}

function motifsDeRejet(proposition, fiche, lieu, centerFacts = null) {
  const motifs = [];
  const contenu = `${proposition.titre || ''}\n${proposition.corps || ''}`;

  // 0. Une activite que ce centre ne propose pas, ou une promesse qu'il ne peut
  // pas tenir. Verifie AVANT le reste : c'est le mensonge le plus visible pour
  // un client qui se deplace.
  const interdites = revendicationsInterdites(contenu, centerFacts);
  if (interdites.length) motifs.push(`revendications absentes de ce centre : ${interdites.join(', ')}`);

  if (!String(proposition.corps || '').trim()) motifs.push('corps vide');

  // 1. PROVENANCE : aucun nombre inventé.
  const provenance = verifierProvenance(contenu, fiche);
  if (!provenance.propre) motifs.push(`nombres absents de la fiche : ${provenance.intrus.join(', ')}`);

  // 2. Les faits cités existent.
  const cites = Array.isArray(proposition.faitsUtilises) ? proposition.faitsUtilises : [];
  if (!cites.length) motifs.push('aucun fait cite : une proposition non sourcee ne se verifie pas');
  const inconnus = cites.filter((id) => !fiche[id]);
  if (inconnus.length) motifs.push(`faits inconnus : ${inconnus.join(', ')}`);

  // 3. La nature revendiquée est portée par CHACUN des faits cités. Un seul
  // fait trop maigre suffit à faire tomber l'affirmation : c'est le maillon
  // faible qui décide, pas la moyenne.
  const nature = String(proposition.nature || '');
  if (!NATURES_PROPOSABLES.includes(nature)) {
    motifs.push(`nature non proposable : ${nature || '(absente)'}`);
  } else {
    cites.filter((id) => fiche[id]).forEach((id) => {
      const verdict = peutAffirmer(fiche[id], nature);
      if (!verdict.autorise) motifs.push(`${id} ne porte pas « ${nature} » : ${verdict.motif}`);
    });
  }

  // 3bis. UN CHANGEMENT DE REGLE, QUELLE QUE SOIT LA NATURE DECLAREE.
  // Le controle 3 ne juge que la nature ANNONCEE, et « regle_commerciale »
  // n'est pas dans la liste que le modele peut annoncer : s'il conseille de
  // passer le minimum a 8 personnes, il cochera « levier_reversible ». Ce
  // controle-ci lit le texte, donc il attrape aussi le modele qui ment.
  const regleTouchee = conseilDeRegleCommerciale(contenu);
  if (regleTouchee.detecte) {
    motifs.push(`conseil de changer une regle commerciale (${regleTouchee.extraits.join(', ')}) : l historique a ete produit sous la regle actuelle, il ne peut pas valider son changement`);
  }

  // 4. Aucun nom propre non ancré (même garde que la réécriture d'idée : le
  // modèle s'est déjà trompé de province).
  //
  // Le socle DOIT contenir les activités du centre. Sans elles, la garde
  // rejetait « Golf o'Clock » et « Laser Game » comme des noms propres inventés,
  // y compris pour le centre qui les propose vraiment : l'agent devenait muet
  // sur ce qu'il vend. Défaut trouvé par le gate en écrivant la contre-preuve
  // inter-centres. Ce n'est pas un assouplissement : ce qui interdit une
  // activité étrangère, c'est forbiddenClaims (contrôle 0), qui la nomme
  // explicitement.
  const identite = centerFacts
    ? `${(centerFacts.activities || []).join(' ')} ${centerFacts.centerName || ''} ${centerFacts.city || ''} ${JSON.stringify(centerFacts.themes || {})}`
    : '';
  const socle = `${JSON.stringify(fiche)} ${(lieu && lieu.nom) || ''} ${(lieu && lieu.ville) || ''} ${identite}`;
  const suspects = nomsPropresNonAncres(contenu, socle);
  if (suspects.length) motifs.push(`noms propres non ancres : ${suspects.join(', ')}`);

  // 5. Le tiret cadratin, regle maison absolue. Il arrive ici par deux
  // chemins : le modele qui ecrit comme un modele, et la doctrine qui lui en
  // montre un (regle d ADN #63). Le prompt l interdit deja, ce controle le
  // prouve.
  const cadratins = tiretsDeModele(contenu);
  if (cadratins.length) motifs.push('tiret cadratin ou demi-cadratin : signature de modele, interdite partout');

  return motifs;
}

async function proposerDepuisLaFiche({
  fiche, lieu = null, centerFacts = null, doctrine = '', fetchImpl = fetch, maxTokens = 700,
} = {}) {
  const utiles = faitsUtiles(fiche || {});
  // Un comptage ne justifie pas qu on ecrive : il faut un comportement mesure.
  if (!porteDeQuoiParler(fiche)) {
    return { proposition: null, motifs: ['la fiche ne porte aucune estimation solide : rien a dire sur ce centre'] };
  }
  // Une fiche qui ne porte rien ne se commente pas. C'est le cas d'un centre
  // pas encore lancé : le silence est la bonne réponse, pas une idée inventée.
  if (!utiles.length) return { proposition: null, motifs: ['aucun fait de la fiche ne porte une affirmation proposable'] };

  const resultat = await callLlmJson({
    stableSystem: [
      'Tu conseilles le gerant d un centre de loisirs indoor belge (bowling, laser game, arcades).',
      'On te donne la FICHE COMPLETE de son activite, calculee sur son registre de reservations.',
      'Tu choisis TOI-MEME ce qui merite d etre dit. Il n y a pas de sujet impose.',
      'REGLES DURES :',
      '- tu n ecris aucun nombre qui ne figure pas deja dans la fiche ;',
      '- tu cites les identifiants des faits que tu utilises, dans faitsUtilises ;',
      '- tu declares la nature de ton propos, et chaque fait cite doit pouvoir la porter (champ peutPorter) ;',
      '- tu ne recommandes JAMAIS de changer un prix, un minimum de personnes, un horaire ni de retirer une formule : l historique a ete produit sous les regles actuelles, il ne peut pas valider leur changement ;',
      '- si la fiche ne dit rien d interessant, tu le dis au lieu de meubler.',
      '- tu ne parles QUE des activites listees dans centre.activites, et jamais d un mot de centre.aNePasEcrire ;',
      'Ecris en francais, court, concret, sans emoji et sans tiret cadratin.',
      'Reponds uniquement en JSON conforme au schema.',
      // LA DOCTRINE D ECRITURE (lib/marketing-dna.js) : comment ecrire, jamais
      // quoi affirmer. Elle vient d une table alimentee par un workflow de
      // recherche, donc d un texte que personne ne relit avant chaque
      // generation, et 9 de ses 28 regles actives contiennent un chiffre
      // (80/20, 20 % du fil, 16 px).
      //
      // Elle n a AUCUNE autorite, et ce n est pas le prompt qui le garantit :
      // les gardes tournent APRES, sur la sortie, et ne lisent jamais la
      // doctrine. Un nombre venu d elle n est dans aucun fait de la fiche,
      // donc verifierProvenance le jette ; un nom propre venu d elle n est pas
      // dans le socle du centre, donc nomsPropresNonAncres le jette. Une
      // doctrine qui ordonnerait « cite les chiffres du secteur » ne changerait
      // donc rien au verdict. C est ce qui permet d injecter ici un texte
      // qu on n a pas ecrit soi-meme.
      //
      // Elle est placee APRES les regles dures, et le dit.
      ...(String(doctrine || '').trim() ? [
        '',
        'DOCTRINE D ECRITURE (la forme seulement, aucune autorite sur les faits) :',
        'Les regles ci-dessous disent COMMENT ecrire. Aucun de leurs nombres et aucun de leurs noms propres n a le droit d apparaitre dans ta reponse : ils ne sont pas des faits sur ce centre. En cas de conflit avec les REGLES DURES ci-dessus, les regles dures gagnent.',
        sansTiretsDeModele(doctrine).trim(),
      ] : []),
    ].join('\n'),
    user: JSON.stringify({
      lieu: lieu ? { nom: lieu.nom || '', ville: lieu.ville || '' } : undefined,
      // CE QUE CE CENTRE EST. Sans ca le modele ne connait que le registre : il
      // sait combien on a vendu, pas ce qu'on vend. Les deux centres de Fun
      // Galaxy n'ont ni les memes activites ni les memes themes (laser « Urban
      // Guerilla » sur 500 m2 a Libramont, « Star Wars » sur 370 m2 a Gembloux),
      // et l'un a un Golf o'Clock que l'autre n'a pas.
      centre: centerFacts ? {
        activites: centerFacts.activities || [],
        themes: centerFacts.themes || undefined,
        aNePasEcrire: centerFacts.forbiddenClaims || [],
      } : undefined,
      faits: utiles,
      naturesPossibles: NATURES_PROPOSABLES.map((n) => ({ nature: n, refusSi: NATURES[n].refus })),
    }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        titre: { type: 'string' },
        corps: { type: 'string' },
        nature: { type: 'string', enum: NATURES_PROPOSABLES },
        faitsUtilises: { type: 'array', items: { type: 'string' } },
      },
      required: ['titre', 'corps', 'nature', 'faitsUtilises'],
    },
    schemaName: 'conseil_ancre',
    maxTokens,
    timeoutMs: 15000,
    fetchImpl,
  });

  if (!resultat) return { proposition: null, motifs: ['le modele n a rien rendu'] };

  const proposition = {
    titre: String(resultat.titre || '').trim(),
    corps: String(resultat.corps || '').trim(),
    nature: String(resultat.nature || '').trim(),
    faitsUtilises: Array.isArray(resultat.faitsUtilises) ? resultat.faitsUtilises.map(String) : [],
  };
  const motifs = motifsDeRejet(proposition, fiche, lieu, centerFacts);
  // Un texte qui echoue est JETE, jamais rapiece : reparer une sortie fausse
  // reviendrait a la reecrire nous-memes, donc a remettre un gabarit.
  if (motifs.length) return { proposition: null, motifs, rejetee: proposition };
  return { proposition, motifs: [] };
}

module.exports = {
  proposerDepuisLaFiche,
  portefeuille,
  faitsUtiles,
  porteDeQuoiParler,
  motifsDeRejet,
  revendicationsInterdites,
  NATURES_PROPOSABLES,
};
