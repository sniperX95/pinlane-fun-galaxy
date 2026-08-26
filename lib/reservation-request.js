const { LASER_GAME_OPTIONS, getBasePrice, getEffectiveFormules, getRequiredLaneCount } = require('./booking-config');
const { getCenter } = require('./ops-knowledge');
const { describeProgram, normalizeProgram, programReservationType } = require('./visit-program');

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
const OCCASION_VALUES = new Set(['anniversaire', 'amis', 'entreprise', 'ecole', 'evg', 'autre']);
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

function getLaserOptionFromGames(games) {
  const normalized = Math.max(1, Math.min(3, Math.trunc(Number(games || 1))));
  return LASER_GAME_OPTIONS.find((item) => Number(item.games) === normalized) || LASER_GAME_OPTIONS[0];
}

function getLaserOptionFromDuration(duration) {
  const numeric = Number(duration || 0);
  return LASER_GAME_OPTIONS.find((item) => Number(item.value) === numeric) || LASER_GAME_OPTIONS[0];
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
function applyProgram(request) {
  const raw = request.program;
  const hasProgramInput = Boolean(raw && (Array.isArray(raw) || Array.isArray(raw.items)));
  if (!hasProgramInput && request.type !== 'visite') return request;

  const program = normalizeProgram(raw || [], {
    dateStr: normalizeText(request.date),
    startTime: normalizeText(request.startTime),
    centerId: request.centerId,
    pax: request.pax,
    bowlingConfig: centerBowlingConfig(request.centerId),
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
  request.laserGames = laser ? Number(laser.games) : 0;
  request.games = request.laserGames;
  request.gameCount = request.laserGames;
  const totalHours = program.items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0) / 60;
  request.totalDuration = Math.max(Number(request.duration) || 0, Math.round(totalHours * 100) / 100);
  return request;
}

function applyPublicFieldGuardrails(request) {
  // Une formule retiree/desactivee par override catalogue (getEffectiveFormules
  // l'exclut) n'est plus proposee par le tunnel : le serveur doit refuser de la
  // creer, meme par formuleId direct. On refuse AVANT tout calcul de prix, avec
  // le meme message "indisponible" que la disponibilite (aucune reservation).
  if (request.type === 'formule') {
    const served = getEffectiveFormules(request.centerId || 'libramont');
    if (!served.some((item) => item.id === request.formuleId)) {
      throw new Error('Offre momentanement indisponible.');
    }
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
  const type = normalizeReservationType(input);
  const channel = normalizeText(input.channel, options.channel || 'public') || 'public';
  const request = {
    ...input,
    type,
    channel,
    centerId: normalizeText(input.centerId || input.center_id, options.centerId || 'libramont') || 'libramont',
    // Champ ADDITIF optionnel : ne casse pas le payload existant. Normalisé
    // côté serveur (source de vérité) pour la catégorisation staff déclarée.
    occasion: normalizeOccasion(input.occasion),
  };

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
    applyProgram(request);
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
      const referencePrice = Math.max(0, Math.round(Number(request.programPrice || 0)));
      request.basePrice = referencePrice;
      const prixEnvoye = Number(request.price);
      request.price = Number.isFinite(prixEnvoye) && prixEnvoye >= 0
        ? Math.round(prixEnvoye)
        : referencePrice;
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
    const laserOption = explicitGames
      ? getLaserOptionFromGames(explicitGames)
      : getLaserOptionFromDuration(input.duration || request.duration);
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
};
