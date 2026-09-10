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
  return Object.values(fiche || {}).some((f) => f.audience === 'public' && (
    // CE QUE LE CENTRE EST : ses jours d ouverture, ses prix. Vrai sans une
    // seule reservation, et c est le seul discours honnete d un centre qui
    // vient d ouvrir. Le fait le declare lui-meme (voir fait(), champ offre) :
    // un comptage du REGISTRE ne le declare pas, et le defaut d origine
    // (« tu as 1 reservation ») reste donc ferme.
    f.offre
    // OU un comportement mesure, assez nourri pour etre affirme.
    || (f.genre === 'estimation' && peutAffirmer(f, 'constat').autorise)
  ));
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
// Quels mots d une liste apparaissent dans un texte, accents et casse aplatis.
// Une seule mecanique pour les deux listes : les faire diverger reviendrait a
// ce qu un mot bloque par l une passe au travers de l autre.
function motsPresents(contenu, liste) {
  const normalise = sansAccentNiCasse(contenu);
  return (liste || []).filter((mot) => {
    const aiguille = sansAccentNiCasse(mot);
    return aiguille && normalise.includes(aiguille);
  });
}

function revendicationsInterdites(contenu, centerFacts) {
  return motsPresents(contenu, (centerFacts && centerFacts.forbiddenClaims) || []);
}

// Les mots que la FICHE rend indisponibles POUR L INSTANT. Un fait peut
// declarer qu une chose ne se dit pas en ce moment (une activite bloquee sur
// toute la fenetre) ; la lecture est generique pour qu un fait futur n oblige
// pas a rouvrir la garde.
function motsIndisponibles(fiche) {
  return Object.values(fiche || {})
    .flatMap((f) => (f && Array.isArray(f.motsInterdits) ? f.motsInterdits : []));
}

// Ce que le centre A mais ne peut pas honorer. Distinct de ce qu il n a pas :
// meme mecanique lexicale, autre verite, donc autre motif de rejet.
function revendicationsIndisponibles(contenu, fiche) {
  return motsPresents(contenu, motsIndisponibles(fiche));
}

function motifsDeRejet(proposition, fiche, lieu, centerFacts = null) {
  const motifs = [];
  const contenu = `${proposition.titre || ''}\n${proposition.corps || ''}`;

  // 0. Une activite que ce centre ne propose pas, ou une promesse qu'il ne peut
  // pas tenir. Verifie AVANT le reste : c'est le mensonge le plus visible pour
  // un client qui se deplace.
  const interdites = revendicationsInterdites(contenu, centerFacts);
  if (interdites.length) motifs.push(`revendications absentes de ce centre : ${interdites.join(', ')}`);
  // Le centre l a, il ne peut pas le tenir. Le motif le DIT : sinon le gerant
  // corrige une configuration qui est juste.
  const indisponibles = revendicationsIndisponibles(contenu, fiche);
  if (indisponibles.length) {
    motifs.push(`activites bloquees sur toute la fenetre : ${indisponibles.join(', ')}`);
  }

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
// LA VOIX DE LA MAISON, lue au fichier du depot. Meme fichier que la porte
// EMAIL, meme chemin, pour la meme raison qu il n existe qu un catalogue : une
// entreprise a UN ton, et deux portes qui en ont deux ne sont plus la meme
// entreprise.
//
// FAIL-SOFT : sans fichier, la porte ecrit comme avant. Une voix absente est
// une perte de qualite, jamais une reponse fausse ; la faire echouer
// couperait la seule porte publique du centre pour un fichier manquant.
function voixDeLaMaison() {
  try {
    const chemin = require('path').join(__dirname, '..', 'ops-knowledge', 'marketing-brain', 'voice.md');
    // Le fichier est en CRLF comme presque tout le depot. Les retours chariot
    // arrivaient tels quels dans le prompt : sans effet sur le sens, mais un
    // prompt se lit, et une porte qui se relit se corrige.
    return require('fs').readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
  } catch (error) {
    return '';
  }
}

async function proposerDepuisLaFiche({
  fiche, lieu = null, centerFacts = null, doctrine = '', historique = [], aujourdhui = '',
  fetchImpl = fetch, maxTokens = 700,
} = {}) {
  // UN CENTRE QUI N EST PAS DECLARE ACTIF NE CONSEILLE RIEN, et cette garde
  // passe avant toutes les autres : un centre « planned » n ouvre pas encore,
  // un centre « closed » a ferme. Ce n est pas une deduction tiree du registre,
  // c est une declaration du gerant, et elle est immediate la ou la dormance
  // attend son delai.
  if (fiche && fiche.statut_du_centre) {
    return {
      proposition: null,
      motifs: [`ce centre n est pas declare actif : ${fiche.statut_du_centre.valeur}`],
      silence: 'statut_du_centre',
    };
  }

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

  // ET UN CENTRE QUI N OUVRE PAS NON PLUS. Meme raisonnement, autre cause :
  // le registre peut etre plein et vivant, si le centre n ouvre aucun jour de
  // la fenetre (fermeture annuelle, travaux, saison), « viens ce soir » est
  // faux. Le mode Demander garde tous les faits ; seul le geste au present
  // disparait. Place AVANT le budget et le fournisseur : c est une question de
  // CE centre, pas de la plateforme.
  if (fiche && fiche.centre_ferme) {
    return {
      proposition: null,
      motifs: [`le centre n ouvre pas : ${fiche.centre_ferme.valeur}`],
      silence: 'centre_ferme',
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
  // Retirer de la liste POSITIVE ce que la liste negative interdit, en
  // passant par le MEME normaliseur que la garde. Comparer les libelles
  // d activites entre eux marcherait aujourd hui et casserait le jour ou un
  // nom d activite change : les mots interdits, eux, sont ce que la garde
  // cherche reellement dans le texte.
  const aRetirer = motsIndisponibles(fiche).map(sansAccentNiCasse).filter(Boolean);
  const estIndisponible = (nom) => {
    const plat = sansAccentNiCasse(nom);
    return aRetirer.some((mot) => plat.includes(mot));
  };
  // Un comptage ne justifie pas qu on ecrive : il faut un comportement mesure.
  if (!porteDeQuoiParler(fiche)) {
    return {
      proposition: null,
      motifs: ['ni horaires, ni prix, ni comportement mesure assez solide : rien a dire sur ce centre'],
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
      // AUCUNE ACTIVITE N EST NOMMEE ICI. Elles sont PAR CENTRE et arrivent
      // dans centre.activites, deja filtrees de ce qui est ferme aujourd hui.
      // La version precedente en nommait trois en dur (« bowling, laser game,
      // arcades ») : c est la description de Libramont et de personne d autre.
      // La garde de sortie rattrape une revendication fausse, elle ne rattrape
      // pas l AMORCE : un modele amorce sur ces trois-la sous-utilise le Golf
      // O'Clock du centre qui en a un.
      'Tu conseilles le gerant d un centre de loisirs indoor belge.',
      // CE QUE LA FICHE PORTE VRAIMENT. Elle n est plus calculee sur le seul
      // registre depuis que l offre y entre, et les faits d offre sont vrais
      // sans une seule vente. Le dire n est pas un detail : c est exactement
      // l etat de Fun Galaxy depuis la remise a zero de sa base, et un modele
      // a qui l on annonce « tout vient du registre » se mefie de ces faits-la
      // au moment ou ce sont les seuls qu il ait.
      'On te donne la FICHE de ce centre : son OFFRE (jours d ouverture, prix) et son REGISTRE de reservations.',
      'Les faits d OFFRE sont vrais sans aucune vente : un centre qui vient d ouvrir a deja de quoi parler.',
      // L etat du moment est INTERNE : ces faits n arrivent pas au modele, seul
      // leur EFFET lui arrive. Sans cette phrase il peut croire la liste des
      // activites incomplete, et tenter de la completer lui-meme.
      'L etat du moment est DEJA applique a ce que tu recois : centre.activites ne liste que ce qui est ouvert aujourd hui, et centre.aNePasEcrire porte ce qui ne l est pas.',
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
      //
      // LA VOIX DE LA MAISON ENTRE PAR LE MEME CANAL, et avant les regles ADN :
      // elle vient d un fichier du depot, revu et versionne, la ou l ADN vient
      // d une table que personne ne relit avant chaque generation. Elle porte
      // exactement le meme statut : la forme, jamais les faits, et les gardes
      // de sortie ne la lisent pas. Son « 1-3 emojis max » perd donc contre la
      // regle dure « sans emoji », que l en-tete ci-dessous arbitre.
      ...(() => {
        const voix = sansTiretsDeModele(voixDeLaMaison()).trim();
        const regles = sansTiretsDeModele(String(doctrine || '')).trim();
        if (!voix && !regles) return [];
        return [
          '',
          'DOCTRINE D ECRITURE (la forme seulement, aucune autorite sur les faits) :',
          'Les regles ci-dessous disent COMMENT ecrire. Aucun de leurs nombres et aucun de leurs noms propres n a le droit d apparaitre dans ta reponse : ils ne sont pas des faits sur ce centre. En cas de conflit avec les REGLES DURES ci-dessus, les regles dures gagnent.',
          ...(voix ? [voix] : []),
          ...(regles ? [regles] : []),
        ];
      })(),
    ].join('\n'),
    user: JSON.stringify({
      lieu: lieu ? { nom: lieu.nom || '', ville: lieu.ville || '' } : undefined,
      // QUEL JOUR ON EST, dans le fuseau du centre et avec le meme calcul que
      // la porte email. Midi UTC pour ancrer la journee sans risque de bascule.
      jour: (() => {
        const { jourDuCentre } = require('./center-facts');
        const lu = jourDuCentre(aujourdhui ? `${aujourdhui}T12:00:00Z` : undefined);
        return lu ? { date: lu.date, enToutesLettres: lu.enToutesLettres } : undefined;
      })(),
      // CE QUE CE CENTRE EST. Sans ca le modele ne connait que le registre : il
      // sait combien on a vendu, pas ce qu'on vend. Les deux centres de Fun
      // Galaxy n'ont ni les memes activites ni les memes themes (laser « Urban
      // Guerilla » sur 500 m2 a Libramont, « Star Wars » sur 370 m2 a Gembloux),
      // et l'un a un Golf o'Clock que l'autre n'a pas.
      centre: centerFacts ? {
        // Une activite bloquee sort de la liste POSITIVE en meme temps qu elle
        // entre dans la liste negative : lui donner les deux reviendrait a lui
        // dire « tu as un laser game » et « n ecris jamais laser game » dans le
        // meme message, et un modele qui tranche ce conflit tranche au hasard.
        activites: (centerFacts.activities || [])
          .filter((nom) => !estIndisponible(nom)),
        themes: centerFacts.themes || undefined,
        // EXACTEMENT la liste que motifsDeRejet appliquera. Le modele doit
        // etre juge sur la regle qu on lui a donnee, jamais sur une autre.
        aNePasEcrire: [...(centerFacts.forbiddenClaims || []), ...motsIndisponibles(fiche)],
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
  revendicationsIndisponibles,
  motsIndisponibles,
  NATURES_PROPOSABLES,
};
