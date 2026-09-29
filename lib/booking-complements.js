// LES COMPLEMENTS DE FIN DE RESERVATION : TROIS GENERATEURS, UNE SEULE REGLE.
//
// Demande de Movsar (2026-09-03) : « a la fin du formulaire, un peu comme un
// McDo, on propose autre chose : pour seulement 5 EUR de plus, vous avez du
// mini golf, une partie en plus, ou 30 minutes de bowling. Des trucs logiques,
// des prix logiques. » Puis la correction du 2026-09-04, mot pour mot : « Pas
// proposer plus de bowling, mais eventuellement une autre partie de laser game
// SI DISPO, ou golf, ou arcade 30 min. Faut etre smart et logique. »
//
// LE BOWLING EN PLUS EST ABANDONNE, ET CE MODULE NE PEUT PAS LE DIRE. Ce n est
// pas une intention, c est une propriete du decoupage : le seul generateur qui
// ajoute une ligne au programme (generateur C) refuse toute activite PLANIFIEE,
// c est-a-dire toute activite qui occupe une piste ou une arene. La meme regle,
// et c est voulu, interdit de proposer une PREMIERE partie de laser a qui n en
// a pas pris : ce serait un rendez-vous nouveau sur le dernier ecran, pas un
// petit plus. Aucune de ces deux interdictions n est ecrite en dur contre un
// identifiant : elles tombent toutes les deux de `planned`, que le catalogue du
// centre declare.
//
// ---------------------------------------------------------------------------
// LES TROIS GENERATEURS
// ---------------------------------------------------------------------------
//   [A] LA MONTEE DE FORMULE (livree au commit 9df64a7). Les formules du
//       catalogue de CE centre qui contiennent STRICTEMENT tout ce que le
//       client a deja, plus quelque chose.
//   [B] UNE PARTIE DE LASER EN PLUS. La visite contient deja du laser : on
//       propose le palier SUIVANT de la grille, un seul cran a la fois.
//   [C] UNE ACTIVITE LIBRE EN PLUS. Une activite que le centre vend, que la
//       visite ne contient pas encore, qui n occupe aucune ressource
//       planifiee, dont le groupe respecte le maximum, dont la dotation
//       declaree n est pas depassee, ET DONT LE PRIX EST CONNU.
//
// [A] sert le tunnel des FORMULES, [B] et [C] celui des VISITES composees a la
// carte. Une meme visite peut recevoir des cartes de [B] ET de [C] : ce sont le
// tri et le plafond qui tranchent, jamais l ordre du code.
//
// LES TROIS SORTENT PAR LE MEME CHEMIN. Un seul constructeur de carte
// (construireCarte), une seule loi finale (finaliserCartes : ecart strictement
// positif, tri par ecart croissant PAR PERSONNE, plafond de cartes), un seul
// vocabulaire (describeAddition, formatComplementAmount, libelleTempsTotal).
// Ecrire le filtre d ecart positif a trois endroits serait un decoupage rate,
// et surtout un gate desarme : une contre-epreuve ne pourrait plus le muter
// qu a un tiers.
//
// ---------------------------------------------------------------------------
// CE QUI A ETE MESURE AVANT D ECRIRE [B] ET [C] (2026-09-05, moteur en
// processus, snapshot vide, samedi, Libramont, 8 personnes)
// ---------------------------------------------------------------------------
//   1. LE PRIX D UNE PARTIE EN PLUS EST DEJA DANS LA GRILLE. LASER_GAME_OPTIONS
//      vend 1 partie 10 EUR, 2 parties 18, 3 parties 25, par personne. Aucun
//      montant n est donc invente ici, et aucun n est recopie : le chiffrage
//      est la DIFFERENCE DE DEUX CALCULS DE PROGRAMME (normalizeProgram, memes
//      options, sans heure de depart), exactement comme [A] compare deux prix
//      de formule.
//   2. LA PARTIE EN PLUS NE DEPLACE RIEN. Heures epinglees (bowling 14:00,
//      laser 15:00) : avec 1 partie, prix 158 et segments 14:00-15:00 /
//      15:00-15:25 ; avec 2 parties, prix 222 et EXACTEMENT LES MEMES
//      SEGMENTS. Idem a 22:00 / 23:00 contre une fermeture a minuit.
//   3. POURQUOI : la 2e partie n est pas planifiee a la reservation. Le moteur
//      rend laserPassPlan.mode = 'manual_after_first', scheduledGames 1,
//      remainingGames 1, pendingPasses [{countIndex:2, status:'pending'}]. La
//      partie est FACTUREE et marquee a placer sur place. C est le mode qui
//      existe DEJA quand un client coche 2 parties des le depart.
//   4. CONSEQUENCE : la carte DOIT dire que cette partie se place sur place
//      avec l equipe, sinon elle promet un horaire que le moteur ne reserve
//      pas. Et la carte VERIFIE que c est bien le cas : si le moteur venait a
//      PLANIFIER les parties ajoutees, il leur donnerait des heures que le
//      client n a jamais choisies, donc la carte se retire (code
//      'laser_planifie'). La note est lue du plan du moteur, jamais supposee.
//   5. LES ACTIVITES LIBRES NE SONT PAS TOUTES MUETTES, contrairement a ce que
//      « priceValue est null partout » laissait croire. priceValue est bien
//      vide pour les 16 activites libres des trois centres, mais deux d entre
//      elles tirent leur prix d une GRILLE et non d un tarif saisi : le duckpin
//      (grid_bowling : +78 EUR a 8 personnes, 2 pistes) et le fun run
//      (grid_fun_run). Le generateur [C] parle donc des aujourd hui a
//      Libramont, sans qu aucun gerant n ait rien saisi. Les autres (minigolf,
//      golf o Clock, arcades, billards, plaine de jeux) restent muettes tant
//      que leur tarif n est pas saisi, et c est honnete : un tarif absent n est
//      pas zero.
//   6. LE CATALOGUE DECIDE, JAMAIS LE CODE. Golf o Clock n existe qu a
//      Gembloux ; Ciney ne vend que du bowling et du laser, donc zero carte de
//      [C]. Aucune de ces trois listes n est ecrite ici.
//
// ---------------------------------------------------------------------------
// CE QUE [C] REFUSE, ET POURQUOI CHAQUE REFUS A COUTE QUELQUE CHOSE
// ---------------------------------------------------------------------------
//   * PRIX INCONNU = AUCUNE CARTE. Jamais « a regler sur place » a cote d un
//     argument de prix : ce serait fabriquer un litige au comptoir sur l ecran
//     meme ou le client valide.
//   * LE MAXIMUM DU GROUPE. Mesure : le fun run declare maxPax 5 et
//     normalizeProgram ne l applique PAS (il chiffre une session a 8
//     personnes). C est donc ici que le maximum se lit, sinon la carte vendrait
//     une session que le comptoir refuserait.
//   * LA DOTATION DECLAREE. Le duckpin de Libramont declare 2 pistes de 6
//     places : au-dela de 12 personnes, normalizeProgram marque la ligne
//     `rotation` (le groupe tourne). On ne propose pas une installation en
//     rotation comme un petit plus. La dotation n est pas recomptee ici : la
//     garde universelle de lib/reservation-ops (dotationDepassee, hissee au
//     commit 9df64a7 avant l aiguillage) est celle qui refuse une visite dont
//     la dotation est prise par d autres dossiers, et elle vaut desormais pour
//     toute visite.
//   * UNE LIGNE INCOMPLETE. Les options de la ligne candidate viennent des
//     defauts du CATALOGUE (defaultMinutes confronte a la grille des durees) et
//     partent selon le TYPE TARIFAIRE, jamais selon une liste d identifiants :
//     c est la regle du panier du tunnel (buildBookingProgramPayload) et celle
//     de normalizeProgram. Une ligne dont la duree ne serait pas un palier de
//     la grille serait refusee en 422 a la confirmation.
//
// ---------------------------------------------------------------------------
// CE QUI VAUT POUR LES TROIS
// ---------------------------------------------------------------------------
// LE CRENEAU RETENU EST NOMME, JAMAIS DEDUIT (revue du 2026-09-04). Sans
// creneau retenu, il n y a aucune heure a laquelle juger un complement, donc
// aucune carte.
//
// LA FAISABILITE PASSE PAR LA MEME PORTE QUE LA VALIDATION, sur la visite
// ENTIERE et aux heures DEJA RETENUES : aucun decalage n est tente. Une
// candidate a ancres (formule du catalogue, programme de visite) repasse par
// evaluateAnchoredCombination ; une candidate SANS ancre (la gamme pass
// liberte) passe par planningAgent a l heure d arrivee retenue, la porte que la
// disponibilite emprunte deja pour cette famille.
//
// LE MONTANT ANNONCE EST UNE BORNE HAUTE. Il se calcule SANS startTime, comme
// le fait deja api/public-availability pour le prix du creneau, et il est
// arrondi DES DEUX COTES comme la facture le fait (estimatePublicPrice rend
// Math.max(0, Math.round(base)) : deux arrondis independants ne se soustraient
// pas comme un arrondi de difference). L invariant du projet s ecrit en
// INEGALITE, jamais en egalite :
//
//      facture finale <= montant annonce
//
// (un palier tarifaire ne peut que faire BAISSER le prix : assertPricingUnderBase
// interdit qu un palier depasse le prix de base). Ecrire cet invariant en
// egalite ferait rougir un gate le jour ou le produit se comporterait
// exactement comme prevu.
//
// LE MONTANT SE DIT EN DEUX TEMPS, LE TOTAL D ABORD. Une partie de laser en
// plus vaut 8 EUR par personne mais 96 EUR sur un groupe de douze : annoncer le
// seul montant par personne serait une omission qui se paie en caisse.
//
// CE QUI NE BOUGE PAS, CE SONT LES HEURES RETENUES - PAS LA DUREE. La carte
// porte donc le nouveau temps total quand il differe.
//
// UNE OPTION IMPOSSIBLE NE S AFFICHE PAS, et elle n est jamais grisee avec sa
// raison. Les fonctions de jugement rendent bien une raison courte, mais c est
// le DIAGNOSTIC du module (sondes, gates, journal) : elle ne voyage pas jusqu au
// client. Si une carte meurt entre l affichage et le clic, le client lit ce que
// la disponibilite repond a la requete du clic, pas cette phrase-la.
const {
  DURATION_OPTIONS,
  LASER_GAME_OPTIONS,
  getBasePrice,
  getEffectiveFormules,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getRequiredLaneCount,
} = require('./booking-config');
const { getCenter, getFormula } = require('./ops-knowledge');
const catalogStore = require('./catalog-store');
const { planningAgent } = require('./ops-agents');
const { evaluateAnchoredCombination, getFormulaAnchorModel, timeToMinutes } = require('./ops-engine');
const { listCenterActivities } = require('./activity-catalog');
const { buildProgramFormula, minutesDUneSession, normalizeProgram } = require('./visit-program');

// ---------------------------------------------------------------------------
// LES DEUX SEULS REGLAGES, ET ILS SONT LUS.
//
// La premiere version portait une couche de reglages par centre
// (readCenterComplementSettings, un plafond par personne, un sens de tri)
// presentee comme « le point d entree du futur ecran gerant ». Mesure de la
// revue du 2026-09-04 : c etait un cul-de-sac. lib/center-config.js ne
// construit que onze cles connues dans normalizeCenterConfig et en retient dix
// dans toEditableConfig : la cle `complements` etait detruite a la
// normalisation d un centre ne en base et effacee au premier enregistrement de
// configuration depuis la console. Aucune de ces branches ne pouvait donc
// s executer - de l abstraction que rien n eprouve.
//
// Ne restent ici que les deux valeurs REELLEMENT lues. Le jour ou un ecran
// gerant les editera, l edition tient en deux lignes et elle est nommee ici
// pour qu on n ait pas a la redecouvrir : ajouter
// `complements: normalizeComplements(merged.complements)` dans
// normalizeCenterConfig (lib/center-config.js) ET dans toEditableConfig, puis
// lire center.complements a la place de ces constantes.
// ---------------------------------------------------------------------------
// Deux cartes au maximum : au-dela, le dernier ecran avant confirmation devient
// un rayon de supermarche. Le plafond vaut pour les TROIS generateurs reunis.
const MAX_CARDS = 2;

// ---------------------------------------------------------------------------
// LES MOTS. Aucun libelle d activite, aucun montant, aucun identifiant n est
// ecrit ici : le nom vient du catalogue DE CE CENTRE (catalog-store, scope par
// entreprise), le libelle de repli du step ou de la ligne, les durees et les
// comptes de la donnee. Aucune lecture ne traverse la portee, meme pour un
// simple nom.
// ---------------------------------------------------------------------------
function formatMinutes(total) {
  const minutes = Math.round(Number(total) || 0);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

function formatEuro(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}€` : `${rounded.toFixed(2).replace('.', ',')}€`;
}

// LE TOTAL D ABORD, LE PAR PERSONNE ENSUITE. A une seule personne les deux
// montants sont le meme nombre : la mention par personne disparait.
function formatComplementAmount(deltaTotal, pax) {
  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const total = `+${formatEuro(deltaTotal)}`;
  if (players <= 1) return total;
  return `${total}, soit ${formatEuro(deltaTotal / players)} par personne`;
}

// CE QUI CHANGE VRAIMENT EN PLUS DU PRIX : la duree de la visite. Les heures
// d ancre ne bougent pas, mais un complement peut doubler le temps sur place,
// et la carte est ce que le client lit avant de dire oui. Meme phrase pour les
// trois generateurs, en MINUTES : c est la seule unite que les trois
// possedent (une formule les compte en heures, un programme en minutes).
function libelleTempsTotal(minutesAvant, minutesApres) {
  const avant = Math.round(Number(minutesAvant) || 0);
  const apres = Math.round(Number(minutesApres) || 0);
  if (!(avant > 0) || !(apres > 0) || avant === apres) return '';
  return `Temps total : ${formatMinutes(apres)} au lieu de ${formatMinutes(avant)}`;
}

// « de Bowling » mais « d'Arcades » : l elision est une regle de la langue
// appliquee a une donnee, pas une liste de cas particuliers. Elle regarde la
// premiere lettre du nom rendu par le catalogue, jamais un identifiant.
//
// NI Y NI H : « d'Yoga » et « d'Handball » sont fautifs, et le catalogue d un
// gerant peut nommer une activite comme il veut. L apostrophe est la DROITE,
// celle qu ecrit deja le reste du bloc client (« Envie d'un peu plus ? ») : sur
// le meme encadre, deux apostrophes differentes a trois lignes d ecart.
function deName(name) {
  const first = String(name || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toLowerCase();
  return 'aeiou'.includes(first) ? `d'${name}` : `de ${name}`;
}

function additionName(addition, centerId) {
  let name = '';
  try {
    const activity = catalogStore.getActivityDoc(addition.key, centerId);
    name = (activity && activity.name) || '';
  } catch (error) {
    name = '';
  }
  if (!name) name = addition.label || addition.key;
  return name;
}

// UNE ADDITION SE DIT DANS L UNITE QUI LA DECRIT VRAIMENT.
//   - Une ligne de SERVICE se dit en quantite, jamais en minutes. Quand le
//     client en avait deja, ce sont les deux libelles de la donnee qui parlent
//     (« 2 cruches boissons au lieu de 1 boisson ») : eux disent la quantite,
//     le nom du catalogue ne la dit pas.
//   - Une activite DEJA presente est un SUPPLEMENT, pas un ajout. hlg vers f2
//     ajoute une SECONDE partie de laser : ecrire « Laser Game » a cote de
//     « Minigolf Blacklight », qui lui est vraiment nouveau, laisse croire au
//     client qu il decouvre deux activites alors qu il en paie une de plus.
//   - Une activite nouvelle se dit par son nom, avec sa duree quand elle en
//     vend une (« 30 min d'Arcades »).
//
// LES TROIS GENERATEURS PARLENT PAR CETTE FONCTION. Le generateur [C] lui donne
// la ligne de programme qu il vient de chiffrer, exactement comme [A] lui donne
// le contenu de formule qu il vient de comparer : un seul vocabulaire, donc
// aucune carte ne peut nommer une activite autrement qu une autre.
function describeAddition(addition, centerId) {
  const name = additionName(addition, centerId);
  if (addition.service) {
    if (addition.dejaPresent && addition.label && addition.labelCourant
      && addition.label !== addition.labelCourant) {
      return `${addition.label} au lieu de ${addition.labelCourant}`;
    }
    return addition.units > 1 ? `${addition.units}x ${name}` : name;
  }
  if (addition.units > 0) {
    if (addition.dejaPresent) {
      return `${addition.units} ${name} de plus`;
    }
    if (addition.perUnit > 0) {
      return addition.units > 1
        ? `${addition.units}x ${formatMinutes(addition.perUnit)} ${deName(name)}`
        : `${formatMinutes(addition.perUnit)} ${deName(name)}`;
    }
    return addition.units > 1 ? `${addition.units}x ${name}` : name;
  }
  return `${formatMinutes(addition.minutes)} ${deName(name)} en plus`;
}

// LE PRIX SE COMPARE COMME LA FACTURE L ARRONDIT. estimatePublicPrice rend
// Math.max(0, Math.round(base)) pour CHAQUE cote ; annoncer round2(a - b)
// annoncerait un ecart que la caisse ne facturerait pas des qu un gerant
// saisirait un prix a centimes depuis la console (mesure : 24,20 EUR et
// 28,50 EUR a 7 personnes, carte « +30,10€ », caisse 31 EUR).
function prixFacture(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

// ---------------------------------------------------------------------------
// LA CARTE : UNE SEULE FORME, QUEL QUE SOIT LE GENERATEUR.
//
// `id` est l identite de la carte dans la liste ET la valeur que le bouton
// porte cote client. Pour une montee de formule elle vaut l identifiant de la
// formule : le chemin d acceptation livre au commit 9df64a7 ne bouge pas d un
// caractere. Pour une carte de visite, elle nomme le generateur et sa cible.
//
// `patch` est ce que le client doit appliquer a son panier pour obtenir la
// visite proposee : un identifiant d activite et ses options, rien d autre.
// C est le SERVEUR qui derive ces options du catalogue - le navigateur ne
// devine aucune duree, aucun palier, aucun compte.
// ---------------------------------------------------------------------------
function construireCarte({
  id,
  kind,
  formuleId = '',
  patch = null,
  name,
  pax,
  deltaTotal,
  adds = [],
  totalLabel = '',
  noteLabel = '',
}) {
  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const montant = Math.round((Number(deltaTotal) || 0) * 100) / 100;
  return {
    id: String(id),
    kind,
    formuleId,
    patch,
    name: String(name || ''),
    pax: players,
    deltaTotal: montant,
    deltaPerPax: Math.round((montant / players) * 100) / 100,
    amountLabel: formatComplementAmount(montant, players),
    adds,
    addsLabel: adds.join(' + '),
    totalLabel,
    noteLabel,
  };
}

// ---------------------------------------------------------------------------
// LA LOI FINALE, ECRITE UNE SEULE FOIS POUR LES TROIS GENERATEURS.
//
//   1. ECART STRICTEMENT POSITIF. Un « complement » moins cher est une remise
//      deguisee, et un complement a zero euro est une ligne que le client
//      croira gratuite. Ni l un ni l autre ne se propose ici.
//   2. LE MOINS CHER PAR PERSONNE D ABORD : c est le seul ordre qui respecte
//      le « pour seulement X de plus » de la demande. Le total departage les
//      egalites, puis l identite de la carte rend le tri deterministe.
//   3. LE PLAFOND. Il s applique APRES le tri et APRES le melange des
//      generateurs : c est le prix qui decide de ce qui s affiche, jamais
//      l ordre dans lequel le code a produit les cartes.
//
// Un generateur peut demander un AUTRE ORDRE (l offre d attente : la plus
// proche du temps d attente d abord) ; l ecart positif et le plafond, eux,
// restent ecrits ici, une fois.
// ---------------------------------------------------------------------------
function parPrixParPersonne(gauche, droite) {
  return (gauche.deltaPerPax - droite.deltaPerPax)
    || (gauche.deltaTotal - droite.deltaTotal)
    || (gauche.id < droite.id ? -1 : 1);
}
function finaliserCartes(cartes, ordre = parPrixParPersonne) {
  const gardees = cartes.filter((carte) => carte && carte.deltaTotal > 0);
  gardees.sort(ordre);
  return gardees.slice(0, MAX_CARDS);
}

// ---------------------------------------------------------------------------
// LA PORTE DE PORTEE, UNE SEULE POUR LES TROIS GENERATEURS. Un centre absent
// de la fiche des centres n est pas un centre de cette plateforme : il ne rend
// aucune carte, et surtout il n herite jamais du catalogue de Fun Galaxy.
// ---------------------------------------------------------------------------
function centreDuTunnel(centerId) {
  try {
    return getCenter(centerId);
  } catch (error) {
    return null;
  }
}

// Les heures RETENUES, telles que le scenario du creneau les a figees. C est la
// meme source que selectSlot cote client (opsPlan.anchorPlan) : ce module ne
// reinvente aucune heure, il relit celles qui ont produit le creneau.
function anchorTimesFromPlan(anchorPlan) {
  const times = {};
  const raw = (anchorPlan && anchorPlan.times) || {};
  for (const [activityId, value] of Object.entries(raw)) {
    if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value)) {
      times[activityId] = timeToMinutes(value);
    }
  }
  return times;
}

function laserTimesFromPlan(anchorPlan) {
  const raw = (anchorPlan && anchorPlan.laserGameTimes) || [];
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((value) => (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value) ? timeToMinutes(value) : null));
}

// Ce qu un creneau retenu apporte de commun aux trois generateurs : son heure,
// ses heures d ancres, ses heures de parties, et le mode de placement du laser.
// Rend null quand aucun creneau n est retenu : il n y a alors aucune heure a
// laquelle juger quoi que ce soit.
function contexteDuCreneau(retainedSlot) {
  if (!retainedSlot) return null;
  const opsPlan = retainedSlot.opsPlan || null;
  const anchorPlan = opsPlan ? opsPlan.anchorPlan : null;
  const retainedTime = String(retainedSlot.time || (opsPlan && opsPlan.startTime) || '');
  if (!/^\d{1,2}:\d{2}$/.test(retainedTime)) return null;
  return {
    retainedTime,
    anchorTimes: anchorTimesFromPlan(anchorPlan),
    laserGameTimes: laserTimesFromPlan(anchorPlan),
    laserPlacement: anchorPlan && anchorPlan.laserPlacement === 'onsite' ? 'onsite' : 'scheduled',
  };
}

// ===========================================================================
// GENERATEUR [A] : LA MONTEE DE FORMULE
// ===========================================================================
//
// LES CINQ CONDITIONS D UNE CARTE (la sixieme, l ecart positif, est la loi
// commune de finaliserCartes) :
//   1. COUVERTURE STRICTE. La candidate contient tout le contenu de la formule
//      courante (par activite : autant d unites ET autant de minutes), et au
//      moins une chose de plus. Une formule qui echange du contenu contre
//      d autre contenu n est pas une montee, c est un autre produit.
//   2. MEME UNITE DE PRIX. per_pax ne se compare pas a per_lane : la
//      difference de deux montants qui ne comptent pas la meme chose ne veut
//      rien dire.
//   3. PRIX EFFECTIF DE CE CENTRE. Les listes passent par getEffectiveFormules
//      (catalogue de l entreprise du centre, overrides de formule appliques
//      champ par champ) et les montants par getBasePrice avec le centerId.
//   4. MINPAX RESPECTE par le groupe (et, via le moteur, jour valide, vacances,
//      fenetre horaire, offre activee par le centre).
//   5. FAISABILITE AU CRENEAU DEJA RETENU, par la porte QUI CORRESPOND A LA
//      CANDIDATE. Mesure du 2026-09-04 : sans la seconde porte (planningAgent
//      pour la gamme pass liberte), f6 vers f7 (+6 EUR par personne pour un
//      Minigolf Blacklight, exactement la demande citee plus haut) etait
//      STRUCTURELLEMENT indicible.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LE CONTENU D UNE FORMULE, par activite. Une seule lecture des steps : autant
// d UNITES (count) et autant de MINUTES (count x durationMinutes) qu ils en
// declarent. Les deux axes comptent : deux formules peuvent porter une seule
// ligne d arcades chacune et n en offrir pas la meme duree.
//
// UNE LIGNE DE SERVICE N EST PAS UNE DUREE VENDUE. Un step qui porte un
// `resourceType` decrit un temps d EQUIPE (bar_service : 5 minutes pour servir
// deux cruches, 3 minutes pour une boisson), jamais ce que le client achete.
// Ces minutes ne comptent donc ni sur l axe de la couverture ni dans la phrase
// de la carte : sans cette distinction, la carte hlg vers f2 ecrivait
// « 5 min de Boissons » a cote d un supplement de 80 EUR (mesure du
// 2026-09-04, jeudi, 8 personnes).
// ---------------------------------------------------------------------------
function formulaContent(doc) {
  const content = new Map();
  for (const step of (doc && doc.steps) || []) {
    const key = String(step.activityId || step.resourceType || 'service');
    const units = Math.max(1, Math.trunc(Number(step.count) || 1));
    const service = Boolean(step.resourceType);
    const perUnit = !service && Number(step.durationMinutes) > 0 ? Number(step.durationMinutes) : 0;
    const entry = content.get(key) || { key, units: 0, minutes: 0, perUnit: 0, label: '', service: false };
    entry.units += units;
    entry.minutes += perUnit * units;
    if (perUnit > entry.perUnit) entry.perUnit = perUnit;
    if (service) entry.service = true;
    if (!entry.label && step.label) entry.label = String(step.label);
    content.set(key, entry);
  }
  return content;
}

// La candidate contient-elle STRICTEMENT tout le courant, et davantage ? Rend
// la liste des ajouts, jamais vide quand covers vaut vrai. Chaque ajout dit
// aussi s il porte sur une activite DEJA presente (un supplement) ou sur une
// activite nouvelle : c est cette difference que le client doit lire.
function coverageDiff(currentContent, candidateContent) {
  for (const [key, current] of currentContent) {
    const candidate = candidateContent.get(key);
    if (!candidate) return { covers: false, additions: [] };
    if (candidate.units < current.units || candidate.minutes < current.minutes) {
      return { covers: false, additions: [] };
    }
  }
  const additions = [];
  for (const [key, candidate] of candidateContent) {
    const current = currentContent.get(key);
    const units = candidate.units - (current ? current.units : 0);
    const minutes = candidate.minutes - (current ? current.minutes : 0);
    if (units > 0 || minutes > 0) {
      additions.push({
        key,
        units,
        minutes,
        perUnit: candidate.perUnit,
        label: candidate.label,
        service: candidate.service,
        dejaPresent: Boolean(current),
        labelCourant: current ? current.label : '',
      });
    }
  }
  return { covers: additions.length > 0, additions };
}

// ---------------------------------------------------------------------------
// LA PORTE DE FAISABILITE. Elle depend de la CANDIDATE, pas de la formule
// courante : composeAnchoredFormulaScenario refuse d office toute formule sans
// ancre (code no_anchor), donc juger la gamme pass liberte avec
// evaluateAnchoredCombination reviendrait a la refuser pour une raison qui
// n est pas la sienne.
// ---------------------------------------------------------------------------
function judgeCandidateFeasibility(context, candidate, candidateDoc) {
  const model = getFormulaAnchorModel(candidateDoc);
  if (model.anchors.length) {
    // LA VISITE ENTIERE, AUX HEURES DEJA RETENUES. Aucun decalage n est tente.
    return evaluateAnchoredCombination({
      center: context.center,
      formula: candidateDoc,
      date: context.date,
      pax: context.pax,
      anchorTimes: context.anchorTimes,
      laserPlacement: context.laserPlacement,
      reservations: context.reservations,
      laneStatuses: context.laneStatuses,
      blocks: context.blocks,
      laserGameTimes: context.laserGameTimes,
    });
  }
  // PASS LIBERTE : la formule n impose aucune heure, le client choisit son
  // arrivee. Meme appel que la disponibilite pour cette famille, a l heure
  // d arrivee RETENUE. La duree de piste vient de la formule elle-meme
  // (getFormuleLaneDuration), jamais d une valeur ecrite ici.
  const plan = planningAgent(
    {
      centerId: context.centerId,
      date: context.date,
      type: context.priceType,
      formuleId: candidate.id,
      pax: context.pax,
      startTime: context.retainedTime,
      duration: getFormuleLaneDuration(candidate),
      preference: { arrivalConfidence: 'normal' },
      pauseMinutes: 0,
    },
    {
      reservations: context.reservations,
      laneStatuses: context.laneStatuses,
      blocks: context.blocks,
    },
  );
  const recommended = plan && plan.plan ? plan.plan.recommended : null;
  if (!recommended || !recommended.ok) {
    return {
      ok: false,
      code: 'not_feasible',
      reason: (plan && plan.plan && plan.plan.reason) || "Cette option n'est plus disponible.",
      scenario: null,
    };
  }
  return { ok: true, code: '', reason: '', scenario: recommended };
}

// ---------------------------------------------------------------------------
// LE JUGEMENT D UNE CANDIDATE. C est la fonction qui decide, et c est elle qui
// garde la RAISON COURTE d un refus. Cette raison est le DIAGNOSTIC du module
// (sondes, gates, journal) : elle ne part pas au client, qui relit la reponse
// de la disponibilite au moment du clic.
// ---------------------------------------------------------------------------
function judgeFormulaUpgrade(context, candidate) {
  const {
    centerId,
    pax,
    currentFormule,
    currentContent,
    currentPrice,
    priceOptions,
    priceType,
    priceDuration,
    passesFinalGuards,
  } = context;

  if (!candidate || candidate.id === currentFormule.id) {
    return { ok: false, code: 'same_formula', reason: 'Cette formule est déjà la vôtre.' };
  }
  if (String(candidate.type || '') !== String(currentFormule.type || '')) {
    return { ok: false, code: 'price_unit', reason: 'Cette formule ne se facture pas de la même façon.' };
  }
  if (pax < Math.max(1, Number(candidate.minPax) || 1)) {
    return { ok: false, code: 'min_pax', reason: `Minimum ${candidate.minPax} personnes pour ${candidate.name}.` };
  }

  let candidateDoc = null;
  try {
    candidateDoc = getFormula(candidate.id, centerId);
  } catch (error) {
    candidateDoc = null;
  }
  if (!candidateDoc) {
    return { ok: false, code: 'unknown_formula', reason: "Cette formule n'est plus au catalogue." };
  }

  const diff = coverageDiff(currentContent, formulaContent(candidateDoc));
  if (!diff.covers) {
    return { ok: false, code: 'not_covering', reason: 'Cette formule ne reprend pas tout ce que vous avez déjà.' };
  }

  // Les pistes se recomptent avec la MEME fonction que le handler : une
  // candidate sans bowling en demande zero, et le montant par piste d une
  // formule per_lane reste juste. Une candidate qui AJOUTE du bowling sera de
  // toute facon refusee plus bas par le moteur (ancre sans heure retenue).
  const candidateLaneCount = getRequiredLaneCount(
    priceType,
    pax,
    candidate.id,
    priceOptions && priceOptions.bowlingConfig,
  );
  const candidatePrice = getBasePrice(
    priceType,
    priceDuration,
    candidateLaneCount,
    pax,
    candidate.id,
    centerId,
    priceOptions,
  );
  const deltaTotal = prixFacture(candidatePrice) - prixFacture(currentPrice);

  const verdict = judgeCandidateFeasibility(context, candidate, candidateDoc);
  if (!verdict.ok) {
    return {
      ok: false,
      code: verdict.code || 'not_feasible',
      reason: verdict.reason || "Cette option n'est plus disponible.",
    };
  }
  // La MEME garde finale que le creneau retenu (fermetures, blocages de piste,
  // d activite ou de formule du jour). Injectee par l appelant : c est lui qui
  // tient l instantane et la validation de ressources.
  if (typeof passesFinalGuards === 'function'
    && !passesFinalGuards({ scenario: verdict.scenario, formule: candidate, laneCount: candidateLaneCount })) {
    return { ok: false, code: 'blocked', reason: "Cette option n'est pas disponible ce jour-là." };
  }

  const adds = diff.additions.map((addition) => describeAddition(addition, centerId));
  return {
    ok: true,
    code: '',
    reason: '',
    card: construireCarte({
      id: candidate.id,
      kind: 'formule',
      formuleId: candidate.id,
      name: candidate.name,
      pax,
      deltaTotal,
      adds,
      totalLabel: libelleTempsTotal(
        (Number(getFormuleTotalDuration(currentFormule)) || 0) * 60,
        (Number(getFormuleTotalDuration(candidate)) || 0) * 60,
      ),
    }),
  };
}

// ---------------------------------------------------------------------------
// LA LISTE SERVIE AVEC LE CRENEAU RETENU.
//
// `retainedSlot` est le creneau que le client A retenu (revalidation) ou VA
// retenir (combinaison par defaut du composeur, celle que le tunnel adopte tout
// seul). Sans creneau retenu, il n y a aucune heure a laquelle juger une
// montee, donc aucune carte.
// ---------------------------------------------------------------------------
function buildFormulaComplements(input) {
  const {
    centerId,
    formuleId,
    date,
    pax,
    retainedSlot,
    type,
    duration,
    priceOptions,
    reservations,
    laneStatuses,
    blocks,
    passesFinalGuards,
  } = input || {};

  const creneau = contexteDuCreneau(retainedSlot);
  if (!creneau) return [];

  const center = centreDuTunnel(centerId);
  if (!center) return [];

  // LE CATALOGUE DE CE CENTRE, jamais le socle. getEffectiveFormules rend une
  // liste VIDE pour un centre d une autre entreprise sans catalogue : c est une
  // reponse, pas une panne, et elle vaut zero carte.
  const catalogue = getEffectiveFormules(centerId);
  const currentFormule = catalogue.find((item) => item.id === formuleId) || null;
  if (!currentFormule) return [];

  let currentDoc = null;
  try {
    currentDoc = getFormula(formuleId, centerId);
  } catch (error) {
    currentDoc = null;
  }
  if (!currentDoc) return [];

  // LA SORTIE REGARDE L ABSENCE DE CHOIX, PLUS L ABSENCE D ANCRE. Une formule
  // pass liberte n a pas d heure d ancre PAR CONSTRUCTION : la refuser ici
  // excluait toute la gamme anniversaire (f6, f7, f8) et les formules a fenetre
  // ouverte. Une formule QUI A des ancres mais dont aucune heure n a ete
  // retenue, elle, n a rien a quoi juger : le moteur refuserait toutes les
  // candidates pour la mauvaise raison.
  if (getFormulaAnchorModel(currentDoc).anchors.length
    && !Object.keys(creneau.anchorTimes).length
    && !creneau.laserGameTimes.some((value) => Number.isFinite(value))) {
    return [];
  }

  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const priceType = type || 'formule';
  const currentLaneCount = getRequiredLaneCount(
    priceType,
    players,
    formuleId,
    priceOptions && priceOptions.bowlingConfig,
  );
  const context = {
    centerId,
    center,
    date,
    pax: players,
    currentFormule,
    currentContent: formulaContent(currentDoc),
    currentPrice: getBasePrice(priceType, duration, currentLaneCount, players, formuleId, centerId, priceOptions || {}),
    anchorTimes: creneau.anchorTimes,
    laserGameTimes: creneau.laserGameTimes,
    laserPlacement: creneau.laserPlacement,
    retainedTime: creneau.retainedTime,
    reservations: Array.isArray(reservations) ? reservations : [],
    laneStatuses: laneStatuses || {},
    blocks: Array.isArray(blocks) ? blocks : [],
    priceOptions: priceOptions || {},
    priceType,
    priceDuration: duration,
    passesFinalGuards,
  };

  const cards = [];
  for (const candidate of catalogue) {
    const verdict = judgeFormulaUpgrade(context, candidate);
    if (verdict.ok) cards.push(verdict.card);
  }
  return finaliserCartes(cards);
}

// ===========================================================================
// GENERATEURS [B] ET [C] : LA VISITE COMPOSEE A LA CARTE
// ===========================================================================

// La ligne d entree qui reproduit EXACTEMENT une ligne deja normalisee. Les
// options partent selon le TYPE TARIFAIRE, jamais selon une liste
// d identifiants : c est la regle du panier du tunnel
// (buildBookingProgramPayload, assets/app-main.js) et celle de normalizeProgram
// elle-meme. Sans elle, le duckpin (grid_bowling sans porter l identifiant
// 'bowling') perdrait sa duree et le fun run son palier de session : le
// programme candidat serait re-normalise autrement que le courant et la
// difference des deux prix ne voudrait plus rien dire.
function ligneDeProgramme(item, options = null) {
  const ligne = { activityId: item.activityId };
  if (item.priceType === 'grid_bowling') ligne.duration = Number(item.duration);
  if (item.priceType === 'grid_laser') ligne.games = Number(item.games);
  // Le palier d UNE session : `minutes` est le temps de tout le groupe.
  if (item.priceType === 'grid_fun_run') ligne.minutes = minutesDUneSession(item);
  if (item.units != null) ligne.units = Number(item.units);
  if (item.hours != null) ligne.hours = Number(item.hours);
  if (item.participants != null) ligne.participants = Number(item.participants);
  // Une ligne d attente reste une ligne d attente : sans le drapeau, elle
  // repassait au catalogue dans chaque programme candidat.
  if (item.waitOffer === true) ligne.waitOffer = true;
  return options ? { ...ligne, ...options } : ligne;
}

// LES OPTIONS D UNE LIGNE NOUVELLE, DERIVEES DU CATALOGUE. Une ligne
// incomplete se ferait refuser a la confirmation : normalizeProgram accepte une
// option ABSENTE (elle prend son defaut) mais REFUSE en 422 une option fournie
// hors grille. On ne pose donc que ce que le type tarifaire reclame, et on le
// prend du catalogue :
//   - grille des durees : le palier qui vaut exactement la duree par defaut de
//     l activite, sinon RIEN : une duree hors grille ne se propose pas (le
//     catalogue decide, le code n invente pas un palier) ;
//   - grille de session : la duree par defaut, que la grille resoudra ;
//   - tout le reste : rien, et normalizeProgram appliquera ses propres defauts
//     (une unite, une heure, tout le groupe) - les memes que le panier du
//     tunnel, donc aucune divergence possible entre les deux cotes.
// Rend null pour une activite dont le type tarifaire ne se derive pas : mieux
// vaut ne pas proposer que proposer une ligne que la confirmation refusera.
function optionsDuCatalogue(activity) {
  const minutes = Math.max(0, Math.trunc(Number(activity.defaultMinutes) || 0));
  if (activity.priceType === 'grid_bowling') {
    const palier = DURATION_OPTIONS.find((item) => Math.round(Number(item.value) * 60) === minutes) || null;
    return palier ? { duration: Number(palier.value) } : null;
  }
  if (activity.priceType === 'grid_fun_run') {
    return minutes > 0 ? { minutes } : null;
  }
  // Une activite PLANIFIEE ne passe jamais par ici (le generateur [C] les
  // refuse toutes en amont) : ce garde-fou dit seulement qu on ne saurait pas
  // deriver ses options si le catalogue en declarait une nouvelle.
  if (activity.priceType === 'grid_laser') return null;
  return {};
}

// Le temps total d une visite, en minutes : la somme des minutes de chaque
// ligne, SAUF ce qui se joue pendant l attente d un sous-groupe, qui ne compte
// que pour son debordement (la regle de la fin de visite de la disponibilite,
// finDeVisiteMinutes). Compte en entier, le minigolf offert aux 8 qui
// attendent 1 h faisait dire « Temps total : 4h45 au lieu de 3h45 » a une
// visite affichee « 3 h 10 sur place » (campagne du 2026-09-29).
function minutesDuProgramme(programme, attente = null) {
  const items = programme.items || [];
  const minutes = (item) => Number(item.minutes) || 0;
  const joue = items.filter((item) => item.waitOffer !== true).reduce((somme, item) => somme + minutes(item), 0);
  const pendantLAttente = items.filter((item) => item.waitOffer === true).reduce((somme, item) => somme + minutes(item), 0);
  const creux = Math.max(0, Number(attente && attente.minutes) || 0);
  return joue + Math.max(0, pendantLAttente - creux);
}

// LA MEME PORTE QUE LA VALIDATION, POUR UNE VISITE. Le document de formule
// synthetique ne porte que les activites qui contraignent le creneau, donc
// deux programmes qui different d une activite LIBRE posent au moteur
// exactement la meme question : on la lui pose une seule fois, par signature de
// ses etapes. Ce n est pas un raccourci de porte, c est un cache de reponse.
function porteDeLaVisite(context, programmeCandidat) {
  const formule = buildProgramFormula(programmeCandidat);
  if (!formule) {
    return { ok: false, code: 'no_planned', reason: "Cette option n'est plus disponible.", scenario: null };
  }
  const signature = JSON.stringify(formule.steps);
  if (context.portes.has(signature)) return context.portes.get(signature);
  const verdict = evaluateAnchoredCombination({
    center: context.center,
    formula: formule,
    date: context.date,
    pax: context.pax,
    anchorTimes: context.anchorTimes,
    laserPlacement: context.laserPlacement,
    reservations: context.reservations,
    laneStatuses: context.laneStatuses,
    blocks: context.blocks,
    laserGameTimes: context.laserGameTimes,
  });
  context.portes.set(signature, verdict);
  return verdict;
}

// Combien de parties de laser le moteur laisse-t-il A PLACER SUR PLACE dans ce
// scenario ? Zero quand il n y a pas de laser du tout (le plan vaut null).
function partiesEnAttente(scenario) {
  const plan = scenario && scenario.laserPassPlan ? scenario.laserPassPlan : null;
  return Math.max(0, Math.trunc(Number(plan && plan.remainingGames) || 0));
}

// Le jugement commun aux deux generateurs de visite : la porte du moteur, la
// garde finale de l appelant, puis la carte. Rend une raison courte de
// diagnostic quand il refuse, jamais un montant negatif filtre en douce (c est
// finaliserCartes qui tient cette loi-la).
function jugerProgrammeCandidat(context, candidat) {
  const verdict = porteDeLaVisite(context, candidat.programme);
  if (!verdict.ok) {
    return {
      ok: false,
      code: verdict.code || 'not_feasible',
      reason: verdict.reason || "Cette option n'est plus disponible.",
    };
  }
  // La MEME garde finale que le creneau retenu (fermetures du jour, pistes,
  // activites bloquees). Injectee par l appelant : c est lui qui tient
  // l instantane et la validation de ressources. Le programme candidat part
  // avec, parce qu une activite AJOUTEE peut etre fermee ce jour-la sans que
  // rien du creneau courant ne le dise.
  if (typeof context.passesFinalGuards === 'function'
    && !context.passesFinalGuards({ scenario: verdict.scenario, program: candidat.programme })) {
    return { ok: false, code: 'blocked', reason: "Cette option n'est pas disponible ce jour-là." };
  }
  if (typeof candidat.jugerScenario === 'function') {
    const refus = candidat.jugerScenario(verdict.scenario);
    if (refus) return refus;
  }
  return {
    ok: true,
    code: '',
    reason: '',
    card: construireCarte({
      id: candidat.id,
      kind: candidat.kind,
      patch: candidat.patch,
      name: candidat.name,
      pax: Number(candidat.pax) > 0 ? Math.trunc(Number(candidat.pax)) : context.pax,
      deltaTotal: prixFacture(candidat.programme.price) - prixFacture(context.currentPrice),
      adds: candidat.adds,
      // Une ligne qui ne reserve aucune place (une partie de laser jouee dans
      // la foulee, placee sur place) n annonce aucun temps total : son temps
      // depend des departs de l arene et des vagues du groupe.
      totalLabel: candidat.totalLabel !== undefined
        ? candidat.totalLabel
        : (candidat.allongeLaVisite === false ? '' : libelleTempsTotal(context.currentMinutes, minutesDuProgramme(candidat.programme, context.attente))),
      noteLabel: candidat.noteLabel !== undefined
        ? candidat.noteLabel
        : (typeof candidat.note === 'function' ? candidat.note(verdict.scenario) : ''),
    }),
  };
}

// ---------------------------------------------------------------------------
// [B] UNE PARTIE DE LASER EN PLUS.
//
// UN SEUL CRAN A LA FOIS : le palier immediatement superieur de la grille, et
// rien au-dela. Le plafond de la grille est un plafond dur - le moteur refuse
// en 422 un nombre de parties hors grille, il ne le rabote pas.
//
// LA CARTE NE PROMET AUCUNE HEURE. Mesure du 2026-09-05 : les parties ajoutees
// arrivent en `pending` dans laserPassPlan, donc facturees et a placer sur
// place. La carte le dit, et elle VERIFIE que le moteur se comporte bien ainsi
// avant de le dire : si les parties ajoutees etaient planifiees, elles
// porteraient des heures que le client n a jamais choisies, et la carte se
// retire.
// ---------------------------------------------------------------------------
function cartesPalierLaser(context) {
  const cartes = [];
  const item = context.programme.items.find((ligne) => ligne.priceType === 'grid_laser');
  if (!item) return cartes;
  const partiesCourantes = Math.max(1, Math.trunc(Number(item.games) || 1));
  const palierCourant = LASER_GAME_OPTIONS.find((option) => Number(option.games) === partiesCourantes) || null;
  const suivant = LASER_GAME_OPTIONS
    .filter((option) => Number(option.games) > partiesCourantes)
    .sort((gauche, droite) => Number(gauche.games) - Number(droite.games))[0] || null;
  if (!palierCourant || !suivant) return cartes;

  const parties = Number(suivant.games);
  const ecartParties = parties - partiesCourantes;
  const programme = context.programmeAvec(context.lignesCourantes.map((ligne) => (
    ligne.activityId === item.activityId ? { ...ligne, games: parties } : ligne
  )));
  const ligneMontee = programme.items.find((ligne) => ligne.activityId === item.activityId) || null;
  if (!ligneMontee || Number(ligneMontee.games) !== parties) return cartes;

  const nom = additionName({ key: item.activityId, label: item.name }, context.centerId);
  const verdict = jugerProgrammeCandidat(context, {
    id: `laser:${item.activityId}:${parties}`,
    kind: 'laser',
    patch: { activityId: item.activityId, options: { games: parties } },
    name: nom,
    programme,
    // La partie en plus se joue dans la foulee, placee sur place : elle ne
    // reserve aucune place (mesure du 2026-09-05 : segments identiques a 1, 2
    // ou 3 parties). Le temps qu elle ajoute depend des departs de l arene et
    // des vagues du groupe : la carte n annonce aucun temps total, la fin de
    // visite affichee apres l ajout est celle du moteur, qui la compte.
    allongeLaVisite: false,
    // Les deux libelles viennent de la GRILLE : « 2 parties au lieu de 1
    // partie ». Aucun mot de quantite n est ecrit ici.
    adds: [`${suivant.label} au lieu de ${palierCourant.label}`],
    jugerScenario: (scenario) => {
      const gagnees = partiesEnAttente(scenario) - context.partiesEnAttenteCourantes;
      if (gagnees !== ecartParties) {
        return { ok: false, code: 'laser_planifie', reason: "Cette partie ne peut pas être ajoutée à cet horaire." };
      }
      return null;
    },
    note: () => (ecartParties > 1
      ? "Elles se jouent dans la foulée, l'équipe les place sur place."
      : "Elle se joue dans la foulée, l'équipe la place sur place."),
  });
  if (verdict.ok) cartes.push(verdict.card);
  return cartes;
}

// ---------------------------------------------------------------------------
// [C] UNE ACTIVITE LIBRE EN PLUS.
//
// Les cinq refus, dans l ordre ou ils coutent le moins cher a prononcer :
//   1. UNE ACTIVITE PLANIFIEE. Elle occupe une piste ou une arene : ce serait
//      un rendez-vous nouveau, pas un petit plus. C est cette regle-la, et
//      elle seule, qui interdit « plus de bowling » et « une premiere partie
//      de laser » - sans nommer aucun identifiant.
//   2. DEJA DANS LA VISITE. On ne propose pas ce que le client a deja coche.
//   3. LE MAXIMUM DU GROUPE, quand le catalogue en declare un.
//   4. LA LIGNE N EXISTE PAS APRES NORMALISATION : ce centre ne la vend pas
//      (normalizeProgram ignore en silence une activite inconnue de lui). Le
//      refus est donc porte par le catalogue, pas par une liste ecrite ici.
//   5. PRIX INCONNU, ou DOTATION DECLAREE DEPASSEE (le groupe tournerait).
// ---------------------------------------------------------------------------
function cartesActiviteLibre(context) {
  const cartes = [];
  const dejaLa = new Set(context.programme.items.map((ligne) => ligne.activityId));
  for (const activity of context.activites) {
    if (activity.planned) continue;
    if (dejaLa.has(activity.id)) continue;
    const maximum = Number(activity.maxPax);
    if (Number.isFinite(maximum) && maximum > 0 && context.pax > maximum) continue;
    const options = optionsDuCatalogue(activity);
    if (!options) continue;

    const programme = context.programmeAvec([
      ...context.lignesCourantes,
      { activityId: activity.id, ...options },
    ]);
    const ligne = programme.items.find((item) => item.activityId === activity.id) || null;
    if (!ligne) continue;
    if (ligne.priceKnown !== true) continue;
    if (ligne.rotation === true) continue;

    const verdict = jugerProgrammeCandidat(context, {
      id: `activite:${activity.id}`,
      kind: 'activite',
      patch: { activityId: activity.id, options },
      name: additionName({ key: activity.id, label: ligne.name }, context.centerId),
      programme,
      // LE MEME VOCABULAIRE QUE LA MONTEE DE FORMULE : une activite nouvelle se
      // dit par son nom, avec sa duree quand elle en vend une.
      adds: [describeAddition({
        key: activity.id,
        units: 1,
        minutes: Number(ligne.minutes) || 0,
        perUnit: Number(ligne.minutes) || 0,
        label: ligne.name,
        service: false,
        dejaPresent: false,
        labelCourant: '',
      }, context.centerId)],
    });
    if (verdict.ok) cartes.push(verdict.card);
  }
  return cartes;
}

// ---------------------------------------------------------------------------
// LES CARTES D UNE VISITE, SERVIES AVEC LE CRENEAU RETENU.
//
// `program` est le programme DEJA NORMALISE que la disponibilite vient de
// calculer : c est lui qui fait foi, jamais le panier brut du navigateur. Les
// deux generateurs en derivent des programmes candidats et les font chiffrer
// par la MEME fonction (normalizeProgram, memes options, sans heure de depart),
// puis la loi commune de finaliserCartes tranche.
//
// CE LOT NE SERT PAS LES VISITES 100 % LIBRES (minigolf seul, billards seuls).
// Elles n ont aucune activite planifiee, donc aucun creneau compose : la
// disponibilite rend 25 heures d ouverture et aucune n est « retenue » avant le
// clic du client. Il n y a donc rien a quoi juger un complement, et le module
// refuse de le deviner - exactement comme il refuse de deviner l heure d une
// formule a ancres sans heure retenue.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// [D] L OFFRE D ATTENTE. Un gros groupe qui ne rentre pas d un coup dans
// l arene joue en deux fois : pendant que le groupe A tire, le groupe B
// attend. Le centre declare ce qu il propose a ceux qui attendent et a quel
// prix (ops-knowledge/centers.json, `waitOffers`). Movsar, 2026-09-17 :
// « il faut proposer une activite le temps d attente pour le groupe B ».
//
// TROIS DIFFERENCES avec le generateur [C] :
//   1. il ne se declenche QUE si le plan fait attendre quelqu un ;
//   2. il ne facture que les personnes qui attendent, au tarif d attente du
//      centre (une donnee, jamais un prix invente ni un pourcentage devine) ;
//   3. il dit le tarif du catalogue quand il existe, pour que la remise soit
//      VERIFIABLE au lieu d etre annoncee.
function cartesOffreAttente(context) {
  const attente = context.attente;
  if (!attente || !(attente.personnes > 0)) return [];
  const offres = Array.isArray(context.center && context.center.waitOffers) ? context.center.waitOffers : [];
  if (!offres.length) return [];
  // UN SEUL PETIT PLUS POUR CEUX QUI ATTENDENT : une offre deja dans le
  // programme occupe le sous-groupe, une seconde ferait double emploi.
  if (context.programme.items.some((ligne) => ligne.waitOffer === true)) return [];
  const dejaLa = new Set(context.programme.items.map((ligne) => ligne.activityId));
  const cartes = [];
  for (const offre of offres) {
    const activity = context.activites.find((item) => item.id === (offre && offre.activityId)) || null;
    if (!activity || activity.planned) continue;
    if (dejaLa.has(activity.id)) continue;
    const maximum = Number(activity.maxPax);
    if (Number.isFinite(maximum) && maximum > 0 && attente.personnes > maximum) continue;

    const ligne = { activityId: activity.id, waitOffer: true, participants: attente.personnes };
    const programme = context.programmeAvec([...context.lignesCourantes, ligne], { waitOffers: true });
    const ajoutee = programme.items.find((item) => item.activityId === activity.id) || null;
    if (!ajoutee || ajoutee.waitOffer !== true || ajoutee.priceKnown !== true) continue;

    // Le tarif du CATALOGUE pour les memes personnes, quand il existe : c est
    // lui qui prouve la remise. Absent, on n annonce aucune remise.
    const auCatalogue = context.programmeAvec([...context.lignesCourantes, { activityId: activity.id, participants: attente.personnes }]);
    const ligneCatalogue = auCatalogue.items.find((item) => item.activityId === activity.id) || null;
    const prixCatalogue = ligneCatalogue && ligneCatalogue.priceKnown === true ? Number(ligneCatalogue.price) : null;
    const parPersonne = Number(ajoutee.waitPricePerPax) || 0;
    const parPersonneCatalogue = prixCatalogue !== null && attente.personnes > 0
      ? Math.round((prixCatalogue / attente.personnes) * 100) / 100
      : null;
    const remise = parPersonneCatalogue !== null && parPersonneCatalogue > parPersonne;

    const verdict = jugerProgrammeCandidat(context, {
      id: `attente:${activity.id}`,
      kind: 'attente',
      patch: { activityId: activity.id, options: { waitOffer: true, participants: attente.personnes } },
      name: `${ligneDeProgrammeNom(ajoutee)} pour le groupe qui attend`,
      programme,
      pax: attente.personnes,
      adds: [`${formatMinutes(Number(ajoutee.minutes) || 0)} pour ${attente.personnes} personne${attente.personnes > 1 ? 's' : ''}`],
      totalLabel: `${formatEuro(parPersonne)} par personne`,
      // LA RAISON D ABORD (le temps mort), la preuve de la remise ensuite, et
      // seulement quand le catalogue la prouve : une remise annoncee sans prix
      // de reference serait une promesse inverifiable.
      noteLabel: [
        attente.minutes > 0 ? `Pendant les ${formatMinutes(attente.minutes)} d'attente` : "Pendant l'attente",
        remise ? `au lieu de ${formatEuro(parPersonneCatalogue)} par personne` : '',
      ].filter(Boolean).join(', '),
    });
    // LES FAITS DE LA CARTE, pour qu un ecran les dise sans relire une phrase :
    // qui attend et combien de temps, ce que dure l offre, son prix par
    // personne, et celui du catalogue seulement quand il prouve la remise.
    if (verdict.ok) {
      cartes.push({
        ...verdict.card,
        attente: { personnes: attente.personnes, minutes: attente.minutes, dureeOffre: Math.round(Number(ajoutee.minutes) || 0) },
        prixParPersonne: parPersonne,
        prixCatalogueParPersonne: remise ? parPersonneCatalogue : null,
      });
    }
  }
  return cartes;
}

// L OFFRE QUI DURE A PEU PRES LE TEMPS D ATTENTE D ABORD (Movsar, 2026-09-28 :
// « propose une activite qui dure un peu pres le temps d attente »), la moins
// chere par personne ensuite. La loi finale est celle de finaliserCartes :
// ecart strictement positif, deux cartes au plus.
function finaliserAttente(cartes) {
  const ecart = (carte) => Math.abs((Number(carte.attente && carte.attente.dureeOffre) || 0) - (Number(carte.attente && carte.attente.minutes) || 0));
  return finaliserCartes(cartes, (gauche, droite) => (ecart(gauche) - ecart(droite))
    || (gauche.deltaPerPax - droite.deltaPerPax)
    || (gauche.id < droite.id ? -1 : 1));
}

// Le nom d une ligne, sans sa duree : la carte porte deja la duree a part.
function ligneDeProgrammeNom(ligne) {
  return String((ligne && ligne.name) || '').trim() || 'Activité';
}

function buildVisitComplements(input) {
  const {
    centerId,
    date,
    pax,
    program,
    retainedSlot,
    priceOptions,
    reservations,
    laneStatuses,
    blocks,
    passesFinalGuards,
  } = input || {};

  const creneau = contexteDuCreneau(retainedSlot);
  if (!creneau) return [];

  const center = centreDuTunnel(centerId);
  if (!center) return [];

  const items = program && Array.isArray(program.items) ? program.items : [];
  if (!items.length) return [];
  // Sans activite planifiee, il n y a pas de creneau compose a tenir : voir le
  // commentaire ci-dessus.
  if (!items.some((item) => item.planned)) return [];

  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const options = priceOptions || {};
  const lignesCourantes = items.map((item) => ligneDeProgramme(item));
  // UNE OFFRE D ATTENTE DEJA ACCEPTEE garde son tarif dans chaque programme
  // candidat : la disponibilite l a admise pour cette visite (groupe scinde).
  const avecAttente = items.some((item) => item.waitOffer === true);
  const programmeAvec = (lignes, extra = {}) => normalizeProgram(lignes, {
    centerId,
    pax: players,
    bowlingConfig: options.bowlingConfig || null,
    dateStr: options.dateStr || date,
    waitOffers: avecAttente,
    ...extra,
  });
  // LE PRIX DE DEPART SE RECALCULE PAR LE MEME CHEMIN QUE LES CANDIDATS. Le
  // servir depuis `program.price` mesurerait deux chemins differents : si la
  // reconstruction des lignes derivait d un centime, l ecart annonce porterait
  // cette derive au lieu du complement. Ici, une derive de reconstruction se
  // simplifie des deux cotes de la soustraction.
  const programmeCourant = programmeAvec(lignesCourantes);
  // CE QUE LE PLAN IMPOSE : quand une activite planifiee ne prend pas tout le
  // monde d un coup, un sous-groupe attend son tour. L appelant le calcule sur
  // le creneau retenu ; sans lui, aucune offre d attente.
  const attente = (input && input.attente && Number(input.attente.personnes) > 0)
    ? { personnes: Math.trunc(Number(input.attente.personnes)), minutes: Math.max(0, Math.trunc(Number(input.attente.minutes) || 0)) }
    : null;

  const context = {
    centerId,
    center,
    date,
    pax: players,
    programme: programmeCourant,
    lignesCourantes,
    programmeAvec,
    currentPrice: programmeCourant.price,
    currentMinutes: minutesDuProgramme(programmeCourant, attente),
    activites: listCenterActivities(centerId),
    anchorTimes: creneau.anchorTimes,
    laserGameTimes: creneau.laserGameTimes,
    laserPlacement: creneau.laserPlacement,
    retainedTime: creneau.retainedTime,
    reservations: Array.isArray(reservations) ? reservations : [],
    laneStatuses: laneStatuses || {},
    blocks: Array.isArray(blocks) ? blocks : [],
    passesFinalGuards,
    portes: new Map(),
    partiesEnAttenteCourantes: 0,
    attente,
  };
  // Combien de parties sont DEJA a placer sur place au creneau retenu : c est
  // la reference contre laquelle le generateur [B] verifie que sa partie en
  // plus est bien « pending » et non planifiee a une heure inventee.
  const porteCourante = porteDeLaVisite(context, programmeCourant);
  if (!porteCourante.ok) return [];
  context.partiesEnAttenteCourantes = partiesEnAttente(porteCourante.scenario);

  // L OFFRE D ATTENTE SE FINALISE A PART. Elle ne repond pas au meme besoin
  // (« envie d un peu plus ? ») mais a une contrainte du plan : un sous-groupe
  // attend son tour. La faire concourir au tri par prix par personne l aurait
  // fait tomber derriere une partie de laser a 3 EUR, ou sortir par le plafond.
  return [
    ...finaliserAttente(cartesOffreAttente(context)),
    ...finaliserCartes([
      ...cartesPalierLaser(context),
      ...cartesActiviteLibre(context),
    ]),
  ];
}

module.exports = {
  MAX_CARDS,
  buildFormulaComplements,
  buildVisitComplements,
  judgeFormulaUpgrade,
  finaliserCartes,
  construireCarte,
  formatComplementAmount,
  libelleTempsTotal,
  formulaContent,
  coverageDiff,
  describeAddition,
  ligneDeProgramme,
  optionsDuCatalogue,
};
