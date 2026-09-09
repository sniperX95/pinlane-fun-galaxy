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
const { callLlmJson, llmProvider } = require('./llm-client');
const { isBudgetExhausted } = require('./llm-budget');
const {
  peutAffirmer, verifierProvenance, NATURES, sansAccentNiCasse, conseilDeRegleCommerciale,
  tiretsDeModele, sansTiretsDeModele, unitesIncoherentes, repetitionRecente, fuiteVersLePublic,
  reformulerEnHypothese, affirmationDeClassementFragile,
} = require('./center-guards');
const { nomsPropresNonAncres } = require('./center-metrics');

// Les natures que le modèle a le droit de revendiquer. « regle_commerciale »
// n'y figure pas : elle n'est jamais une conclusion, et une proposition qui la
// vise doit passer par reformulerEnHypothese, pas par ce chemin.
const NATURES_PROPOSABLES = ['constat', 'levier_reversible', 'saisonnier'];

// Ce que le modèle voit d'un fait. On lui donne AUSSI ce que ce fait autorise :
// sans ça il propose un levier appuyé sur une anecdote, on le rejette, et il
// recommence. Lui dire d'avance coûte moins cher qu'un aller-retour.
// Ce que le modele voit : les faits PUBLICS seulement. Le cycle publie un
// texte pret a coller pour des clients ; le chiffre d affaires, les trous de
// la donnee et la memoire des idees passees n'y ont pas leur place. Le gerant,
// lui, garde tout par le mode Demander.
function portefeuille(fiche) {
  return Object.values(fiche).filter((f) => f && f.audience === 'public').map((f) => ({
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
    (f) => f.audience === 'public' && f.genre === 'estimation' && peutAffirmer(f, 'constat').autorise,
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

  // 1bis. Un chiffre colle a une unite doit etre CELUI de cette unite. La
  // provenance ci-dessus dit seulement que le nombre existe quelque part.
  const unites = unitesIncoherentes(contenu, fiche);
  if (unites.length) motifs.push(`unites qui ne collent pas au centre : ${unites.join(', ')}`);

  // 1ter. AUCUN CHIFFRE RESERVE AU GERANT. La garde, la vraie : ne pas montrer
  // le chiffre d affaires au modele est du confort, ca ne prouve rien. Un
  // nombre present dans un fait interne et dans aucun fait public ne sort pas.
  const fuites = fuiteVersLePublic(contenu, fiche);
  if (fuites.length) motifs.push(`chiffres reserves au gerant : ${fuites.join(', ')}`);

  // 2. Les faits cités existent, ET ils sont publiables. Citer un fait interne
  // comme source d un post est une erreur meme si le texte n en reprend aucun
  // chiffre : la source d un message client est publique par definition.
  const cites = Array.isArray(proposition.faitsUtilises) ? proposition.faitsUtilises : [];
  if (!cites.length) motifs.push('aucun fait cite : une proposition non sourcee ne se verifie pas');
  const inconnus = cites.filter((id) => !fiche[id]);
  if (inconnus.length) motifs.push(`faits inconnus : ${inconnus.join(', ')}`);
  const prives = cites.filter((id) => fiche[id] && fiche[id].audience !== 'public');
  if (prives.length) motifs.push(`faits reserves au gerant, non publiables : ${prives.join(', ')}`);

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
  // Meme garde qu a la porte « Demander » : un superlatif pose sur un
  // classement que le retrait d une seule reservation renverse.
  const servee = affirmationDeClassementFragile(contenu, fiche);
  if (servee.detecte) {
    motifs.push(`classement trop serre affirme comme un resultat : ${servee.extraits.join(', ')}`);
  }

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


// UN REFUS N EST PAS UN SILENCE.
// Quand la seule chose qui bloque est le changement de regle commerciale, se
// taire est le pire des deux mondes : l'agent a vu quelque chose et n'en dit
// rien. Il rend donc une PISTE, qui est une question a trancher et non une
// conclusion : elle est marquee « hypothese », elle porte les chiffres en jeu,
// et elle dit si la comparaison existe deja au catalogue.
//
// Elle ne sort JAMAIS vers les clients : ses champs viennent de faits reserves
// au gerant, et elle est rendue a part de `proposition`, qui est le seul objet
// que le cycle publie.
function pisteDepuisLeRefus(proposition, fiche, motifs) {
  if (!motifs.some((m) => m.includes('regle commerciale'))) return null;
  const valeur = (id) => (fiche[id] ? String(fiche[id].valeur) : null);
  return reformulerEnHypothese({
    sujet: String((proposition && proposition.titre) || 'changement de regle commerciale evoque'),
    populationARisque: valeur('sous_le_minimum_de_la_formule') || valeur('groupes_par_taille'),
    chiffreARisque: valeur('chiffre_formule_locomotive') || valeur('ca_total'),
    comparaisonDisponible: valeur('comparaison_de_minimums'),
  });
}
async function proposerDepuisLaFiche({
  fiche, lieu = null, centerFacts = null, doctrine = '', historique = [], aujourdhui = '',
  fetchImpl = fetch, maxTokens = 700,
} = {}) {
  // UN REGISTRE ENDORMI NE CONSEILLE RIEN. Les faits restent vrais au PASSE :
  // le dossier du gerant les garde, et le mode Demander y repond toujours. Ce
  // qui devient impossible, c est le geste au present. « Publie un rappel pour
  // ton creneau de 18 h » sur un centre qui ne prend plus une reservation depuis
  // huit mois n est pas un conseil faible, c est un conseil faux : la fiche
  // decrit un centre qui n existe plus.
  if (fiche && fiche.registre_dormant) {
    return {
      proposition: null,
      motifs: [`le registre ne bouge plus : ${fiche.registre_dormant.valeur}`],
      silence: 'registre_dormant',
    };
  }

  // POURQUOI on ne parlera pas, dit avant de construire quoi que ce soit.
  // L'usage est declare ici EXPLICITEMENT et repete dans l'appel plus bas :
  // c'est la meme valeur des deux cotes, sinon on testerait la disponibilite
  // d'un fournisseur pour un usage et on appellerait avec un autre.
  // « sensitive » est le defaut de callLlm, donc ceci ne change RIEN au
  // comportement : ca le rend seulement visible. Ouvrir cet appel a OpenRouter
  // serait une decision de frontiere de donnees, pas un detail technique.
  const USAGE = 'sensitive';
  if (isBudgetExhausted()) {
    return { proposition: null, motifs: ['plafond de budget modele atteint : aucun appel'], silence: 'budget' };
  }
  if (!llmProvider(USAGE)) {
    return {
      proposition: null,
      motifs: ['aucun fournisseur de modele disponible pour cet usage : ce n est pas la matiere qui manque, c est la cle'],
      silence: 'sans_modele',
    };
  }

  const utiles = faitsUtiles(fiche || {});
  // Un comptage ne justifie pas qu on ecrive : il faut un comportement mesure.
  if (!porteDeQuoiParler(fiche)) {
    return {
      proposition: null,
      motifs: ['la fiche ne porte aucune estimation publiable et solide : rien a dire sur ce centre'],
      silence: 'rien_a_dire',
    };
  }
  // Une fiche qui ne porte rien ne se commente pas. C'est le cas d'un centre
  // pas encore lancé : le silence est la bonne réponse, pas une idée inventée.
  if (!utiles.length) {
    return {
      proposition: null,
      motifs: ['aucun fait publiable de la fiche ne porte une affirmation proposable'],
      silence: 'rien_a_dire',
    };
  }

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
      '- si la fiche ne dit rien d interessant, tu le dis au lieu de meubler ;',
      '- tout ce que tu ecris est destine aux CLIENTS du centre : jamais de chiffre d affaires, de marge, de trou de donnees ni de sujet interne ;',
      '- dejaDit liste ce qui a deja ete propose ici : ne le resserre pas, et ne le cite pas comme source.',
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
      // Contexte, pas matiere : ce que l'agent a deja dit a ce centre. Les
      // chiffres en ont ete retires a la construction de la fiche, donc rien
      // ne peut fuir par ici, et le modele n'a pas le droit de s'en servir
      // comme source (ces faits ne sont pas dans `faits`).
      dejaDit: (fiche.memoire_deja_dit && fiche.memoire_deja_dit.valeur) || undefined,
      dejaMesure: (fiche.memoire_resultats && fiche.memoire_resultats.valeur) || undefined,
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
    usage: USAGE,
    schemaName: 'conseil_ancre',
    maxTokens,
    timeoutMs: 15000,
    fetchImpl,
  });

  if (!resultat) return { proposition: null, motifs: ['le modele n a rien rendu'], silence: 'echec' };

  const proposition = {
    titre: String(resultat.titre || '').trim(),
    corps: String(resultat.corps || '').trim(),
    nature: String(resultat.nature || '').trim(),
    faitsUtilises: Array.isArray(resultat.faitsUtilises) ? resultat.faitsUtilises.map(String) : [],
  };
  const motifs = motifsDeRejet(proposition, fiche, lieu, centerFacts);
  // La repetition se juge APRES le reste : une idee fausse est fausse, qu elle
  // soit neuve ou non. Elle se juge ici, et pas dans motifsDeRejet, parce que
  // seul cet appel connait l historique du centre.
  const rabache = repetitionRecente(proposition, historique, aujourdhui);
  if (rabache.repete) motifs.push(`deja dit : ${rabache.motif}`);
  // Un texte qui echoue est JETE, jamais rapiece : reparer une sortie fausse
  // reviendrait a la reecrire nous-memes, donc a remettre un gabarit.
  if (motifs.length) {
    return {
      proposition: null,
      motifs,
      rejetee: proposition,
      silence: 'sortie_jetee',
      piste: pisteDepuisLeRefus(proposition, fiche, motifs),
    };
  }
  return { proposition, motifs: [] };
}

module.exports = {
  proposerDepuisLaFiche,
  pisteDepuisLeRefus,
  portefeuille,
  faitsUtiles,
  porteDeQuoiParler,
  motifsDeRejet,
  revendicationsInterdites,
  NATURES_PROPOSABLES,
};
