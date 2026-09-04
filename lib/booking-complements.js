// LA MONTEE DE FORMULE : PROPOSER MIEUX, SANS JAMAIS DEPLACER LA VISITE.
//
// Demande de Movsar (2026-09-03) : « a la fin du formulaire, un peu comme un
// McDo, on propose autre chose : pour seulement 5 EUR de plus, vous avez du
// mini golf, une partie en plus, ou 30 minutes de bowling. Des trucs logiques,
// des prix logiques. »
//
// CE QUE CE MODULE SAIT FAIRE, ET RIEN D AUTRE. Il compare la formule DEJA
// COMPOSEE par le client aux autres formules du catalogue de SON centre, et ne
// garde que celles qui contiennent STRICTEMENT tout ce qu il a deja, plus
// quelque chose. C est la seule proposition qui parle des le premier jour, sur
// la donnee de production, sans qu aucun gerant n ait rien saisi : les 16
// activites libres vendables des trois centres ont toutes un prix nul, donc
// « minigolf pour 5 EUR » est aujourd hui indicible (le total varierait de
// 0,00 EUR). Les activites libres et les decalages d heure sont d autres lots.
//
// LE CRENEAU RETENU EST NOMME, JAMAIS DEDUIT (revue du 2026-09-04). La
// premiere version deduisait « le client a retenu son creneau » de
// `slots.length === 1`, ce qui n arrive QUE si le client re-clique une pastille
// d heure. Mesure dans le tunnel reel : sur le chemin par defaut (zero
// friction, f5 / 8 personnes), la reponse portait 25 creneaux, donc zero carte,
// donc AUCUNE proposition pour le client qui ne touche a rien - c est-a-dire le
// cas nominal. L appelant passe desormais le creneau retenu explicitement
// (`retainedSlot`) : la disponibilite le connait deja (combinaison par defaut
// d anchorMeta, ou le creneau unique d une revalidation).
//
// LES SIX CONDITIONS D UNE CARTE. Une formule candidate ne s affiche que si :
//   1. COUVERTURE STRICTE. Elle contient tout le contenu de la formule
//      courante (par activite : autant d unites ET autant de minutes), et au
//      moins une chose de plus. Une formule qui echange du contenu contre
//      d autre contenu n est pas une montee, c est un autre produit.
//   2. MEME UNITE DE PRIX. per_pax ne se compare pas a per_lane : la
//      difference de deux montants qui ne comptent pas la meme chose ne veut
//      rien dire.
//   3. PRIX EFFECTIF DE CE CENTRE. Les listes passent par getEffectiveFormules
//      (catalogue de l entreprise du centre, overrides de formule appliques
//      champ par champ) et les montants par getBasePrice avec le centerId.
//      Aucun repli sur le socle fichier : un centre d une autre entreprise
//      rend zero carte, jamais le catalogue de Fun Galaxy.
//   4. DELTA STRICTEMENT POSITIF. Une « montee » moins chere est une remise
//      deguisee : elle ne se propose pas ici.
//   5. MINPAX RESPECTE par le groupe (et, via le moteur, jour valide, vacances,
//      fenetre horaire, offre activee par le centre).
//   6. FAISABILITE AU CRENEAU DEJA RETENU, par la porte QUI CORRESPOND A LA
//      CANDIDATE. Une candidate a ancres (bowling, laser) repasse par
//      evaluateAnchoredCombination aux heures deja retenues : aucun decalage
//      n est tente, et une candidate qui exige une ancre sans heure retenue est
//      refusee par le moteur (code missing_anchor). Une candidate SANS ancre
//      (la gamme pass liberte : table anniversaire, playground, credit arcade)
//      n a aucune heure a juger par construction : composeAnchoredFormulaScenario
//      la refuse d office (code no_anchor), donc elle passe par la porte que la
//      disponibilite emprunte deja pour cette famille, planningAgent a l heure
//      d arrivee retenue. Mesure du 2026-09-04 : sans cette seconde porte, f6
//      vers f7 (+6 EUR par personne pour un Minigolf Blacklight, exactement la
//      demande citee plus haut) etait STRUCTURELLEMENT indicible.
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
// porte donc le nouveau temps total quand il differe (mesure : hlg vers f2 a 8
// personnes fait passer la visite de 1h30 a 3h, ancres inchangees).
//
// UNE OPTION IMPOSSIBLE NE S AFFICHE PAS, et elle n est jamais grisee avec sa
// raison. judgeFormulaUpgrade rend bien une raison courte, mais c est le
// DIAGNOSTIC du module (sondes, gates, journal) : elle ne voyage pas jusqu au
// client. Si une carte meurt entre l affichage et le clic, le client lit ce que
// la disponibilite repond a la requete du clic, pas cette phrase-la.
const {
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
// un rayon de supermarche.
const MAX_CARDS = 2;

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
// LES MOTS. Aucun libelle d activite, aucun montant, aucun identifiant n est
// ecrit ici : le nom vient du catalogue DE CE CENTRE (catalog-store, scope par
// entreprise), le libelle de repli du step lui-meme, les durees et les comptes
// de la donnee. Aucune lecture ne traverse la portee, meme pour un simple nom.
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
  if (!(deltaTotal > 0)) {
    return { ok: false, code: 'no_gain', reason: 'Cette formule ne coûte pas plus cher que la vôtre.' };
  }
  const deltaPerPax = Math.round((deltaTotal / Math.max(1, pax)) * 100) / 100;

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
  // CE QUI CHANGE VRAIMENT EN PLUS DU PRIX : la duree de la visite. Les heures
  // d ancre ne bougent pas, mais une montee peut doubler le temps sur place, et
  // la carte est ce que le client lit avant de dire oui.
  const currentTotal = Number(getFormuleTotalDuration(currentFormule)) || 0;
  const candidateTotal = Number(getFormuleTotalDuration(candidate)) || 0;
  const totalLabel = candidateTotal > 0 && currentTotal > 0 && candidateTotal !== currentTotal
    ? `Temps total : ${formatMinutes(candidateTotal * 60)} au lieu de ${formatMinutes(currentTotal * 60)}`
    : '';
  return {
    ok: true,
    code: '',
    reason: '',
    card: {
      formuleId: candidate.id,
      name: candidate.name,
      pax,
      deltaTotal,
      deltaPerPax,
      amountLabel: formatComplementAmount(deltaTotal, pax),
      adds,
      addsLabel: adds.join(' + '),
      totalLabel,
    },
  };
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

  if (!retainedSlot) return [];
  const opsPlan = retainedSlot.opsPlan || null;
  const anchorPlan = opsPlan ? opsPlan.anchorPlan : null;
  const retainedTime = String(retainedSlot.time || (opsPlan && opsPlan.startTime) || '');
  if (!/^\d{1,2}:\d{2}$/.test(retainedTime)) return [];

  let center = null;
  try {
    center = getCenter(centerId);
  } catch (error) {
    return [];
  }

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

  const anchorTimes = anchorTimesFromPlan(anchorPlan);
  const laserGameTimes = laserTimesFromPlan(anchorPlan);
  // LA SORTIE REGARDE L ABSENCE DE CHOIX, PLUS L ABSENCE D ANCRE. Une formule
  // pass liberte n a pas d heure d ancre PAR CONSTRUCTION : la refuser ici
  // excluait toute la gamme anniversaire (f6, f7, f8) et les formules a fenetre
  // ouverte. Une formule QUI A des ancres mais dont aucune heure n a ete
  // retenue, elle, n a rien a quoi juger : le moteur refuserait toutes les
  // candidates pour la mauvaise raison.
  if (getFormulaAnchorModel(currentDoc).anchors.length
    && !Object.keys(anchorTimes).length
    && !laserGameTimes.some((value) => Number.isFinite(value))) {
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
    anchorTimes,
    laserGameTimes,
    laserPlacement: anchorPlan && anchorPlan.laserPlacement === 'onsite' ? 'onsite' : 'scheduled',
    retainedTime,
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
  // LE MOINS CHER D ABORD : c est le seul ordre qui respecte le « pour
  // seulement X de plus » de la demande.
  cards.sort((left, right) => (left.deltaTotal - right.deltaTotal)
    || (left.formuleId < right.formuleId ? -1 : 1));
  return cards.slice(0, MAX_CARDS);
}

module.exports = {
  MAX_CARDS,
  buildFormulaComplements,
  judgeFormulaUpgrade,
  formatComplementAmount,
  formulaContent,
  coverageDiff,
  describeAddition,
};
