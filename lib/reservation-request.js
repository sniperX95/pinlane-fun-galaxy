const { LASER_GAME_OPTIONS, getBasePrice, getEffectiveFormules, getRequiredLaneCount } = require('./booking-config');
const { getCenter } = require('./ops-knowledge');
const { describeProgram, groupIsSplit, normalizeProgram, programReservationType } = require('./visit-program');
const { activityMinPax } = require('./activity-catalog');
const { PARTIES_LASER_MAX, optionLaserAuPalier } = require('./prix-palier');

function centerBowlingConfig(centerId) {
  try {
    return getCenter(centerId || 'libramont')?.resources?.bowling || null;
  } catch (error) {
    return null;
  }
}

// 'visite' est un type d'ENTREE (ce que le tunnel demande quand le client a
// compose plusieurs activites), jamais un type stocke : il se resout en
// bowling / laser / activite selon ce que le programme mobilise reellement.
// 'activite' est le seul type nouveau qui atteint la base, et seulement pour une
// visite qui n'occupe ni piste ni arene.
const KNOWN_TYPES = new Set(['bowling', 'laser', 'formule', 'visite', 'activite']);
// Occasion DÉCLARÉE par le client (source de vérité de la catégorisation staff).
// Valeur libre non reconnue → '' (traité comme « non précisé »).
// La liste DOIT couvrir les six chips du tunnel (BOOKING_OCCASIONS,
// assets/app-main.js) : 'evg' manquait ici, et un client qui cochait
// « EVG / EVJF » était rangé « non précisé » en base. Miroir de
// OCCASION_VALUES dans lib/database.js, qui accepte 'evg' depuis toujours.
// 'famille' (2026-09-24) : le formulaire Fun Galaxy demande l occasion pour
// les statistiques de la direction (« qui vient, pourquoi »), et une sortie
// en famille n y est ni « entre amis » ni « autre ». La console savait deja
// l afficher (« Sortie famille », pinlane-analytics-board, direction-insights).
const OCCASION_VALUES = new Set(['anniversaire', 'amis', 'famille', 'entreprise', 'ecole', 'evg', 'autre']);
const FORMULA_LABEL_PATTERN = /\bformule\b/i;
// Email requis à la création UNIQUEMENT côté CLIENT PUBLIC (via requireEmail) :
// les confirmations/rappels partent par mail. Côté STAFF le contact est libre
// (pas de requireEmail) : le comptoir crée une résa sans forcément tout saisir.
// Motif : une @ entourée de texte sans espace + un point dans le domaine.
// Validation front alignée (isValidEmail dans app-main.js, le tunnel de resa).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeOccasion(value) {
  const normalized = normalizeText(value).toLowerCase();
  return OCCASION_VALUES.has(normalized) ? normalized : '';
}

function normalizeReservationType(input = {}) {
  const explicit = normalizeText(input.type).toLowerCase();
  // 'activite' n'est jamais demande par un client : il se DERIVE d'un programme
  // sans ressource planifiee. Le recevoir tel quel sans programme n'aurait aucun
  // sens (ni piste, ni arene, ni activite nommee), on retombe sur bowling.
  if (explicit === 'activite' && !input.program) return 'bowling';
  if (KNOWN_TYPES.has(explicit)) return explicit;
  if (normalizeText(input.activityId).toLowerCase() === 'laser_game') return 'laser';
  if (normalizeText(input.formuleId || input.formulaId)) return 'formule';
  return 'bowling';
}

function planBelongsToType(plan, type) {
  if (!plan || typeof plan !== 'object') return false;
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  if (type === 'formule') return true;
  if (plan.formulaId || plan.formuleId || FORMULA_LABEL_PATTERN.test(normalizeText(plan.formulaName))) return false;
  if (type === 'bowling') return blocks.length ? blocks.every((block) => block.resourceType === 'bowling_lane') : true;
  if (type === 'laser') return blocks.length ? blocks.every((block) => block.resourceType === 'laser_arena') : true;
  return false;
}

function isPublicChannel(options = {}) {
  return normalizeText(options.channel, 'public').toLowerCase() === 'public';
}

// LE CANAL DE CONFIANCE, jamais celui du corps : `options.channel` est pose par
// l API (le POST staff passe 'staff'), alors que `input.channel` vient de la
// requete. Les plafonds leves du comptoir ne s ouvrent que par lui.
function isStaffChannel(options = {}) {
  return normalizeText(options.channel).toLowerCase() === 'staff';
}

// LE PRIX ENVOYE PAR LE COMPTOIR, ou null s il n y en a pas (2026-10-08).
// `undefined`, `null` et la chaine vide disent « aucun prix » : lus par
// Number(), null et '' valaient 0, donc une visite OFFERTE que personne n avait
// decidee. Un 0 envoye, lui, reste un geste du comptoir.
function prixEnvoye(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const prix = Number(valeur);
  return Number.isFinite(prix) && prix >= 0 ? Math.round(prix * 100) / 100 : null;
}

// Les extras du comptoir (pizzas, cruches, arcades a l unite), additionnes
// comme la console les additionne (sumExtras, assets/booking-core.js) : elle
// compte la reference d un dossier comme base + extras et facture `price` seul
// (getReservationPriceState et renderPosCaisse, assets/app-main.js). Une autre
// somme ici, et le meme dossier passerait pour un prix saisi a la seconde
// lecture, ou s afficherait « Prix ajusté » sans que personne n y ait touche.
function totalExtrasComptoir(extras) {
  return Array.isArray(extras)
    ? Math.round(extras.reduce((somme, extra) => somme + (Number(extra && extra.price) || 0), 0) * 100) / 100
    : 0;
}

// La reference plus les extras, au centime, jamais sous zero.
function prixAvecExtras(reference, extras) {
  return Math.max(0, Math.round(((Number(reference) || 0) + totalExtrasComptoir(extras)) * 100) / 100);
}

// UN LASER SEUL AU COMPTOIR VA JUSQU A 12 PARTIES (2026-10-08). Le tunnel
// garde ses trois options, et une demande hors grille y retombe comme avant
// (borne a 3, puis la premiere option) : rien ne change pour lui.
function getLaserOptionFromGames(games, { staff = false } = {}) {
  const demandees = Math.trunc(Number(games || 1));
  const auComptoir = staff ? optionLaserAuPalier(LASER_GAME_OPTIONS, demandees) : null;
  if (auComptoir) return auComptoir;
  const normalized = Math.max(1, Math.min(3, demandees));
  return LASER_GAME_OPTIONS.find((item) => Number(item.games) === normalized) || LASER_GAME_OPTIONS[0];
}

function getLaserOptionFromDuration(duration, { staff = false } = {}) {
  const numeric = Number(duration || 0);
  const exacte = LASER_GAME_OPTIONS.find((item) => Number(item.value) === numeric);
  if (exacte) return exacte;
  const auComptoir = staff ? optionLaserAuPalier(LASER_GAME_OPTIONS, numeric * 2) : null;
  return auComptoir || LASER_GAME_OPTIONS[0];
}

function getExplicitLaserGames(input = {}) {
  const explicit = Number(input.laserGames || input.games || input.gameCount || 0);
  return explicit >= 1 ? explicit : 0;
}

function estimatePublicPrice(request) {
  const pax = Math.min(240, Math.max(1, Math.trunc(Number(request.pax) || 1)));
  const formuleId = normalizeText(request.formuleId || request.formulaId);
  const centerId = normalizeText(request.centerId || request.center_id) || undefined;
  const bowlingConfig = centerBowlingConfig(request.centerId || request.center_id);
  const laneCount = getRequiredLaneCount(request.type, pax, formuleId, bowlingConfig);
  // centerId passe a getBasePrice : le prix FACTURE reflete l'override catalogue
  // du centre (ou 'all'), coherent avec ce que le tunnel affiche.
  // bowlingConfig + date : un centre qui vend AUX PARTIES facture par personne
  // et selon le jour. Sans eux, le prix facture serait celui de la grille par
  // piste, donc different de celui que le tunnel vient d'afficher.
  return Math.max(0, Math.round(Number(getBasePrice(
    request.type,
    Number(request.duration || request.totalDuration || 0),
    laneCount,
    pax,
    formuleId,
    centerId,
    { bowlingConfig, dateStr: normalizeText(request.date) },
  )) || 0));
}

// Une VISITE : le programme est renormalise ici (le panier du navigateur n'est
// jamais lu tel quel), le type en est derive, et le prix est recalcule ligne par
// ligne. C'est ce chemin, et lui seul, qui autorise plusieurs activites dans une
// meme reservation.
function applyProgram(request, options = {}) {
  const raw = request.program;
  const hasProgramInput = Boolean(raw && (Array.isArray(raw) || Array.isArray(raw.items)));
  if (!hasProgramInput && request.type !== 'visite') return request;

  // LE TARIF D ATTENTE EST HONORE A LA RESERVATION, sous la MEME condition
  // qu a la disponibilite (groupIsSplit) : le client paie ce que la carte lui a
  // annonce, et un navigateur qui marque une ligne `waitOffer` sans groupe
  // scinde paie le tarif du catalogue.
  const lignesDemandees = Array.isArray(raw) ? raw : ((raw && raw.items) || []);
  const program = normalizeProgram(raw || [], {
    dateStr: normalizeText(request.date),
    startTime: normalizeText(request.startTime),
    centerId: request.centerId,
    pax: request.pax,
    bowlingConfig: options.bowlingConfig === undefined
      ? centerBowlingConfig(request.centerId)
      : options.bowlingConfig,
    waitOffers: groupIsSplit({ centerId: request.centerId, pax: request.pax, items: lignesDemandees }),
    publicBooking: options.publicBooking === true,
    staff: options.staff === true,
  });
  if (!program.items.length) {
    const error = new Error('Choisissez au moins une activité.');
    error.statusCode = 422;
    error.expose = true;
    throw error;
  }

  request.program = { items: program.items, price: program.price, priceComplete: program.priceComplete };
  request.type = programReservationType(program);
  // LE COMPTOIR GARDE LE NOM DE SON CAS SPECIAL. Un programme decrit par le
  // serveur (« Bowling 1h · Laser x1 · ... ») est juste, mais il efface la
  // reference que l equipe a en tete (« Formule 8 »). Le canal staff peut
  // donc imposer son libelle ; le tunnel public, lui, garde la description
  // derivee, qui est la seule honnete face a un client.
  const libelleImpose = !isPublicChannel({ channel: request.channel }) && normalizeText(request.label);
  request.label = (libelleImpose || describeProgram(program)).slice(0, 160);
  request.programPrice = program.price;

  const bowling = program.items.find((item) => item.activityId === 'bowling');
  const laser = program.items.find((item) => item.activityId === 'laser_game');
  // duration / laneCount / games restent les champs que TOUT le reste du produit
  // lit (planning, mails, statistiques) : la visite les remplit depuis ses
  // activites planifiees au lieu d'inventer un second vocabulaire.
  request.duration = bowling ? Number(bowling.duration) : (laser ? Number(laser.duration) : 0.5);
  request.laneCount = bowling ? Number(bowling.laneCount || 0) : 0;
  request.requiresLanes = Boolean(bowling);
  if (!bowling) request.lanes = [];
  request.laserGames = laser ? Number(laser.extraLaser?.games || laser.games) : 0;
  request.games = request.laserGames;
  request.gameCount = request.laserGames;
  const totalHours = program.items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0) / 60;
  request.totalDuration = Math.max(Number(request.duration) || 0, Math.round(totalHours * 100) / 100);
  return request;
}

// La disponibilite connait les pistes en maintenance seulement apres lecture
// du snapshot. On recalcule alors le programme avec cette dotation du jour afin
// que le prix confirme exactement les services que le moteur va planifier.
// Un prix saisi volontairement au comptoir reste intact.
function renormalizeVisitProgram(request, bowlingConfig, options = {}) {
  if (!request || !request.program || !bowlingConfig) return request;
  const channel = normalizeText(options.channel, request.channel || 'public') || 'public';
  const previousBasePrice = Math.max(0, Math.round((Number(request.basePrice) || 0) * 100) / 100);
  const previousPrice = prixEnvoye(request.price);
  // Un prix egal a la reference plus les extras n est pas un prix saisi : il
  // suit la reference recalculee. Absent, il la suit aussi.
  const hasStaffOverride = channel !== 'public'
    && previousPrice !== null
    && Math.round(previousPrice * 100) !== Math.round(prixAvecExtras(previousBasePrice, request.extras) * 100);

  applyProgram(request, { bowlingConfig, publicBooking: channel === 'public', staff: isStaffChannel({ channel: options.channel }) });
  if (channel === 'public') return applyPublicFieldGuardrails(request);

  const referencePrice = Math.max(0, Math.round(Number(request.programPrice || 0) * 100) / 100);
  request.basePrice = referencePrice;
  // LES EXTRAS DU COMPTOIR (2026-10-02, « sur mesure » complet : arcades,
  // nourriture, cruches...) s ajoutent au montant d une visite, comme sur
  // tout dossier (reference = base + extras). Le tunnel public n en envoie
  // jamais : la regle ne touche que le canal staff.
  request.price = hasStaffOverride ? previousPrice : prixAvecExtras(referencePrice, request.extras);
  return request;
}

function applyPublicFieldGuardrails(request) {
  // Une formule retiree/desactivee par override catalogue (getEffectiveFormules
  // l'exclut) n'est plus proposee par le tunnel : le serveur doit refuser de la
  // creer, meme par formuleId direct. On refuse AVANT tout calcul de prix, avec
  // le meme message "indisponible" que la disponibilite (aucune reservation).
  let offreServie = null;
  if (request.type === 'formule') {
    const served = getEffectiveFormules(request.centerId || 'libramont');
    offreServie = served.find((item) => item.id === request.formuleId) || null;
    if (!offreServie) {
      throw new Error('Offre momentanement indisponible.');
    }
  }
  // LES ACCOMPAGNANTS ne valent que pour une offre reservee aux enfants (sa
  // description le dit, « pour les enfants de 5 a 12 ans ») : `pax` y compte
  // les enfants, qui jouent et paient, et les adultes qui les accompagnent
  // viennent en plus, sans payer l offre. Partout ailleurs, toute personne du
  // groupe joue et paie : un compte d accompagnants envoye de force est ignore.
  const accompagnants = Math.trunc(Number(request.companions));
  request.companions = offreServie && offreServie.kidsOnly && Number.isFinite(accompagnants)
    ? Math.min(500, Math.max(0, accompagnants))
    : 0;
  // LE LASER SE JOUE A DEUX AU MOINS. Le tunnel ne propose ni la carte ni les
  // departs sous ce minimum ; la porte publique refuse un envoi force : une
  // ligne de visite sous le minimum de son activite, ou un laser seul.
  const sousMinimum = request.program
    ? (request.program.items || []).find((item) => Number(item.belowMinPax) > 0)
    : null;
  const minimumLaser = request.type === 'laser' ? activityMinPax(request.centerId, 'laser_game') : 0;
  if (sousMinimum || (minimumLaser && Number(request.pax) < minimumLaser)) {
    const error = new Error(sousMinimum
      ? `${sousMinimum.name} se joue à ${sousMinimum.belowMinPax} joueurs minimum.`
      : `Le laser game se joue à ${minimumLaser} joueurs minimum.`);
    error.statusCode = 422;
    error.expose = true;
    throw error;
  }
  // Une VISITE est facturee ligne par ligne (lib/visit-program), pas par la
  // grille mono-activite : c'est son total qui fait foi.
  const price = request.program ? Number(request.programPrice || 0) : estimatePublicPrice(request);
  // Garde anti-abus : une activité publique payante à 0 € = durée non-standard
  // forgée (ex. bowling 1.75h absent de la grille tarifaire → prix 0 mais pistes
  // allouées). On refuse plutôt que d'offrir une partie gratuite.
  //
  // Pour une visite, la garde porte sur les activites PLANIFIEES : ce sont elles
  // qui immobilisent une ressource, et leur grille tarifaire est complete. Une
  // activite libre dont le centre n'a pas encore saisi le tarif vaut null (pas
  // zero) et se regle au comptoir : refuser la reservation pour ca reviendrait a
  // punir le client d'un champ que la direction n'a pas rempli.
  if (request.program) {
    const plannedUnpriced = request.program.items.find((item) => item.planned && !(Number(item.price) > 0));
    if (plannedUnpriced) {
      throw new Error('Durée indisponible pour cette activité. Choisissez une durée proposée.');
    }
  } else if (!(price > 0)) {
    throw new Error('Durée indisponible pour cette activité. Choisissez une durée proposée.');
  }
  request.channel = 'public';
  request.status = 'pending';
  request.basePrice = price;
  request.price = price;
  request.paymentMethod = null;
  request.payment_method = null;
  request.validationStatus = '';
  request.validation_status = '';
  request.validationMode = '';
  return request;
}

function normalizeReservationRequest(input = {}, options = {}) {
  require('./arcade-offers').assertNoDuplicateArcadeCharge(input);
  const type = normalizeReservationType(input);
  const channel = normalizeText(input.channel, options.channel || 'public') || 'public';
  const request = {
    ...input,
    type,
    channel,
    // AUCUN repli 'libramont' : une ecriture qui ne nomme pas son centre est
    // une erreur d'APPELANT, pas une reservation du premier tenant. Mesure du
    // 2026-09-01 : un POST public sans centerId etait ECRIT chez Libramont,
    // qui consommait pistes et capacite pour un dossier destine ailleurs. Les
    // entrees HTTP refusent en 422 avant d'arriver ici, le staff transmet le
    // centre de sa session ; ce garde-fou attrape tout nouvel appelant oublieux.
    centerId: normalizeText(input.centerId || input.center_id, options.centerId || '') || '',
    // Champ ADDITIF optionnel : ne casse pas le payload existant. Normalisé
    // côté serveur (source de vérité) pour la catégorisation staff déclarée.
    occasion: normalizeOccasion(input.occasion),
  };
  if (!request.centerId) {
    const error = new Error('Centre manquant : precisez le centre de la reservation.');
    error.statusCode = 422;
    throw error;
  }

  if (input.pax !== undefined && input.pax !== null && input.pax !== '') {
    // Borne alignée sur la contrainte SQL reservations_pax_check (pax <= 240) :
    // empêche un pax forgé de déclencher des allocations mémoire dans le moteur
    // de planning (planningAgent) avant que la contrainte SQL ne s'applique (DoS).
    request.pax = Math.min(240, Math.max(1, Math.trunc(Number(input.pax) || 1)));
  }

  request.email = normalizeText(input.email);
  // Requis UNIQUEMENT aux points de création (POST staff/public) qui passent
  // requireEmail. Les ré-utilisations internes (alternatives, préparation ops)
  // renormalisent sans imposer le contact.
  if (options.requireEmail) {
    if (!request.email) {
      const error = new Error('Email requis pour la réservation.');
      error.statusCode = 422;
      error.expose = true;
      throw error;
    }
    if (!EMAIL_PATTERN.test(request.email)) {
      const error = new Error('Adresse email invalide.');
      error.statusCode = 422;
      error.expose = true;
      throw error;
    }
  }

  // VISITE : un programme prime sur tout le reste. Il pose lui-meme le type
  // final, le libelle, la duree, les pistes et le prix, puis on sort : les blocs
  // mono-activite qui suivent ecraseraient le laser d'une visite bowling+laser
  // (laserGames = 0) et son plan (planBelongsToType exige des blocs homogenes).
  const hasProgram = Boolean(input.program
    && (Array.isArray(input.program) ? input.program.length : Array.isArray(input.program.items) && input.program.items.length));
  if (type === 'visite' || hasProgram) {
    applyProgram(request, { publicBooking: isPublicChannel(options), staff: isStaffChannel(options) });
    request.formuleId = '';
    request.formulaId = '';
    request.validationMode = request.validationMode === 'staff_review' ? request.validationMode : '';
    if (isPublicChannel(options)) {
      applyPublicFieldGuardrails(request);
    } else {
      // Canal STAFF : le programme normalise fait foi comme REFERENCE
      // (basePrice) ; un prix envoye par le comptoir (prix d ami, offre
      // sur mesure) reste le prix FACTURE. Sans prix envoye, la reference
      // facture : une visite creee au comptoir ne part plus a 0.
      //
      // « AUCUN PRIX ENVOYE » ET « PRIX ENVOYE = 0 » NE SONT PAS LA MEME
      // CHOSE : offrir une visite (0 EUR, les amis du proprietaire) est une
      // decision du comptoir, pas une valeur manquante. Un simple `> 0`
      // remplacait silencieusement le geste par le prix catalogue, et le
      // client se voyait facturer ce qu on venait de lui offrir.
      //
      // SANS PRIX ENVOYE, LA REFERENCE ET SES EXTRAS (2026-10-08, sonde du
      // coordinateur). Le prix pose ici valait la reference seule : relu par
      // renormalizeVisitProgram, il differait de base + extras et passait
      // pour un prix SAISI, si bien que les extras (« Pizza × 2 », 20 EUR)
      // sortaient du prix enregistre alors que la fiche et la caisse les
      // listent et facturent `price` seul. Un prix envoye, 0 compris, reste
      // tel quel.
      const referencePrice = Math.max(0, Math.round(Number(request.programPrice || 0) * 100) / 100);
      request.basePrice = referencePrice;
      const envoye = prixEnvoye(request.price);
      request.price = envoye !== null ? envoye : prixAvecExtras(referencePrice, request.extras);
    }
    return request;
  }

  if (type !== 'formule') {
    request.formuleId = '';
    request.formulaId = '';
    request.validationMode = request.validationMode === 'staff_review' ? request.validationMode : '';
    if (!planBelongsToType(request.opsPlan || request.ops_plan, type)) {
      request.opsPlan = null;
      request.ops_plan = null;
    }
  }

  if (type === 'bowling') {
    request.label = !request.label || FORMULA_LABEL_PATTERN.test(normalizeText(request.label))
      ? 'Bowling Classique'
      : request.label;
    request.laserGames = 0;
    request.games = 0;
    request.gameCount = 0;
    request.requiresLanes = request.requiresLanes ?? true;
  }

  if (type === 'laser') {
    const explicitGames = getExplicitLaserGames(input);
    const staff = isStaffChannel(options);
    // Au comptoir, au-dela de 12 parties on refuse au lieu de ramener en
    // silence a 3 : un groupe facture 3 parties qui croit en avoir pris 13.
    if (staff && explicitGames > PARTIES_LASER_MAX) {
      const error = new Error(`Nombre de parties indisponible : de 1 à ${PARTIES_LASER_MAX} parties.`);
      error.statusCode = 422;
      error.expose = true;
      throw error;
    }
    const laserOption = explicitGames
      ? getLaserOptionFromGames(explicitGames, { staff })
      : getLaserOptionFromDuration(input.duration || request.duration, { staff });
    request.label = !request.label || FORMULA_LABEL_PATTERN.test(normalizeText(request.label))
      ? 'Laser Game'
      : request.label;
    request.duration = Number(laserOption.value);
    request.totalDuration = Number(request.totalDuration || laserOption.value);
    if (Number(request.totalDuration) < Number(laserOption.value)) request.totalDuration = Number(laserOption.value);
    request.laserGames = Number(laserOption.games);
    request.games = Number(laserOption.games);
    request.gameCount = Number(laserOption.games);
    request.requiresLanes = false;
    request.lanes = [];
    request.laneCount = 0;
  }

  if (type === 'formule') {
    request.formuleId = normalizeText(input.formuleId || input.formulaId || request.formuleId);
    request.formulaId = request.formuleId;
    if (!request.formuleId) {
      throw new Error('Formule manquante.');
    }
  }

  if (isPublicChannel(options)) {
    applyPublicFieldGuardrails(request);
  }

  return request;
}

module.exports = {
  normalizeReservationRequest,
  normalizeReservationType,
  normalizeOccasion,
  planBelongsToType,
  prixAvecExtras,
  prixEnvoye,
  renormalizeVisitProgram,
  totalExtrasComptoir,
};
