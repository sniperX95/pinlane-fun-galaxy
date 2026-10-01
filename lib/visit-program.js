// LE PROGRAMME D'UNE VISITE : plusieurs activites dans une seule reservation.
//
// Le tunnel imposait un choix exclusif (bowling OU laser OU formule). Un groupe
// qui voulait bowling ET laser devait prendre une formule anniversaire ou
// telephoner, et personne ne savait que la moitie des visiteurs venaient aussi
// pour le minigolf, les billards ou les arcades.
//
// L'IDEE CENTRALE : une visite composee par le client EST une formule, ecrite a
// la volee. Le moteur (lib/ops-engine) sait deja enchainer plusieurs activites,
// placer les blocs, detecter les conflits, proposer des heures : c'est ce qu'il
// fait pour les formules du catalogue depuis le debut. On lui donne donc un
// document de formule SYNTHETIQUE au lieu d'ecrire un second moteur.
//
// CE QUI CONTRAINT LE CRENEAU : bowling et laser, rien d'autre. Les activites
// libres entrent dans le programme (annoncees, tarifees, visibles du staff) mais
// ne participent a AUCUN calcul de disponibilite.
//
// LE PRIX vient d'une seule source par ligne : les grilles de lib/booking-config
// pour bowling et laser (inchangees, au centime), le tarif de centre du
// catalogue pour les activites libres. Une ligne sans tarif saisi vaut null,
// jamais zero : "on ne sait pas" et "c'est gratuit" ne sont pas le meme message.

const {
  DURATION_OPTIONS,
  FUN_RUN_OPTIONS,
  LASER_GAME_OPTIONS,
  getBasePrice,
  getBilledLaneCount,
  getRequiredLaneCount,
  splitGroupIntoBowlingServices,
} = require('./booking-config');
const {
  activityEstimatedMinutes,
  activityLinePrice,
  activitySessionCount,
  activityUnitPlan,
  listCenterActivities,
} = require('./activity-catalog');

// Un panier plus long que le catalogue lui-meme est forcement forge.
const MAX_ITEMS = 12;
const SYNTHETIC_FORMULA_ID = 'visite';
// Confort duckpin par piste, comme le bowling : la valeur vit dans le
// catalogue (booking.capacityPerUnit) ; 6 n est que le repli.
const DUCKPIN_FALLBACK_CAPACITY = 6;
const BOWLING_ID = 'bowling';
const LASER_ID = 'laser_game';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items;
  return [];
}

function rejectOption(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.expose = true;
  return error;
}

// Une option ABSENTE prend la valeur par defaut ; une option FOURNIE mais hors
// grille est REFUSEE, jamais rabotee en silence. Remplacer 1h45 par 1h aurait
// facture une heure a quelqu'un qui croit en avoir reserve deux : le silence
// coute plus cher que le refus.
function normalizeDurationHours(value) {
  if (value === undefined || value === null || value === '') return 1;
  const option = DURATION_OPTIONS.find((item) => Number(item.value) === Number(value));
  if (!option) throw rejectOption('Durée indisponible pour cette activité. Choisissez une durée proposée.');
  return Number(option.value);
}

function normalizeGames(value) {
  if (value === undefined || value === null || value === '') return LASER_GAME_OPTIONS[0];
  const option = LASER_GAME_OPTIONS.find((item) => Number(item.games) === Math.trunc(Number(value)));
  if (!option) throw rejectOption('Nombre de parties indisponible. Choisissez une option proposée.');
  return option;
}

// Un panier client -> un programme sur : activites reellement vendues par CE
// centre, options bornees, doublons fusionnes, prix recalcule ici (celui que le
// navigateur annonce n'est jamais lu).
// L OFFRE D ATTENTE DU CENTRE : ce qu il propose au sous-groupe qui patiente
// pendant que l autre joue, et a quel prix par personne. C est une DONNEE du
// centre (ops-knowledge/centers.json, cle `waitOffers`) : sans ligne declaree,
// aucune offre, et aucun prix invente. Elle ne vaut que pour une activite
// LIBRE : une activite planifiee prendrait une ressource, donc un creneau.
function centerWaitOffer(centerId, activityId) {
  let center = null;
  try {
    center = require('./ops-knowledge').getCenter(centerId);
  } catch (error) {
    return null;
  }
  const offres = Array.isArray(center && center.waitOffers) ? center.waitOffers : [];
  const offre = offres.find((item) => item && item.activityId === activityId) || null;
  if (!offre) return null;
  const prix = Number(offre.pricePerPax);
  if (!Number.isFinite(prix) || prix <= 0) return null;
  const minutes = Math.trunc(Number(offre.minutes) || 0);
  return { activityId, pricePerPax: prix, minutes: minutes > 0 ? minutes : 0 };
}

// Le palier d UNE session. Une ligne deja normalisee le porte a part
// (`sessionMinutes`) ; une ligne qui garde ses passages le retrouve en
// divisant le temps du groupe par eux ; une demande du tunnel envoie le palier
// choisi, sans passages.
// `sessionsDuGroupe` : les passages que CE groupe fait (capacite du
// catalogue). Une ligne ENREGISTREE avant que la base ne garde ses passages
// (2 lignes Fun Run en prod le 2026-09-28 : 195 et 180 minutes) n a plus que
// le temps du groupe : il se reconnait a ce qu il n est pas un palier de la
// grille alors que sa part par passage en est un.
function minutesDUneSession(raw, sessionsDuGroupe = 1) {
  if (!raw) return 0;
  const palier = Math.trunc(Number(raw.sessionMinutes) || 0);
  if (palier > 0) return palier;
  const minutes = Math.trunc(Number(raw.minutes) || 0);
  const passages = Math.trunc(Number(raw.sessions) || 0);
  if (minutes > 0 && passages > 1) return Math.round(minutes / passages);
  const groupe = Math.trunc(Number(sessionsDuGroupe) || 1);
  const estUnPalier = (m) => FUN_RUN_OPTIONS.some((option) => Number(option.minutes) === m);
  if (minutes > 0 && groupe > 1 && !estUnPalier(minutes) && minutes % groupe === 0 && estUnPalier(minutes / groupe)) {
    return minutes / groupe;
  }
  return minutes;
}

// `waitOffers` : l appelant a constate un groupe SCINDE (une activite
// planifiee qui ne prend pas tout le monde d un coup). Lui seul peut le dire :
// sans ce feu vert, une ligne marquee `waitOffer` est facturee au tarif du
// catalogue, exactement comme avant.
function normalizeProgram(input, { centerId = 'libramont', pax = 1, bowlingConfig = null, dateStr = '', startTime = '', waitOffers = false, publicBooking = false } = {}) {
  const people = Math.min(240, Math.max(1, Math.trunc(Number(pax) || 1)));
  const catalog = listCenterActivities(centerId);
  const byId = new Map(catalog.map((activity) => [activity.id, activity]));
  const seen = new Set();
  const items = [];

  for (const raw of toArray(input).slice(0, MAX_ITEMS)) {
    const activityId = String((raw && (raw.activityId || raw.id)) || '').trim();
    if (!activityId || seen.has(activityId)) continue;
    const activity = byId.get(activityId);
    // Activite inconnue du centre : ignoree en silence plutot que refusee. Le
    // catalogue d'un centre bouge (une activite se decoche), et un vieux lien de
    // reservation ne doit pas rendre le tunnel inutilisable.
    if (!activity) continue;
    seen.add(activityId);

    const item = {
      activityId,
      name: activity.name,
      planned: activity.planned === true,
      priceType: activity.priceType,
      unitLabel: activity.unitLabel || '',
    };
    // Une entree a la journee (plaine de jeux) : ses minutes restent une
    // estimation de temps sur place pour la fin de visite, le tunnel ne les
    // montre jamais comme ce qui est achete (Movsar, 2026-09-25 : « ça met 1h
    // dans le recap ... c est un acces toute la journée »).
    if (activity.dayAccess === true) item.dayAccess = true;

    if (activityId === BOWLING_ID) {
      item.duration = normalizeDurationHours(raw && (raw.duration ?? raw.durationHours));
      item.minutes = Math.round(item.duration * 60);
      // UN GROUPE TROP GRAND POUR LES PISTES JOUE EN PLUSIEURS SERVICES. La
      // ligne dure alors autant de fois sa duree, et se paie autant de fois ses
      // pistes. Un groupe qui tient rend UN service, et tout reste comme avant,
      // a l unite pres.
      const services = splitGroupIntoBowlingServices(people, bowlingConfig);
      // LA DUREE DE LA LIGNE RESTE CELLE D UN SERVICE. C est la ligne du temps du
      // moteur qui pose UN BLOC PAR SERVICE : multiplier ici aussi comptait deux
      // fois, et un groupe de 70 se voyait annoncer deux blocs de 2 h au lieu de
      // deux services d 1 h (mesure du 2026-09-19, plan 10:00 -> 14:10).
      if (services.length > 1) item.services = services.slice();
      // LES PISTES OCCUPEES EN MEME TEMPS, celles du premier service : les deux
      // moities d un groupe scinde ne sont jamais sur les pistes ensemble.
      item.laneCount = getRequiredLaneCount('bowling', services[0], '', bowlingConfig);
      // bowlingConfig + date : un centre qui vend AUX PARTIES facture par
      // personne et selon le jour. Sans eux, la ligne de programme partirait au
      // prix de la grille par piste, different de ce que le tunnel affiche.
      // getBilledLaneCount, lui, SOMME les pistes de chaque service : c est le
      // seul endroit ou se decide ce que coute un second service.
      item.price = getBasePrice('bowling', item.duration, getBilledLaneCount('bowling', people, '', bowlingConfig), people, '', centerId, { bowlingConfig, dateStr });
      item.priceKnown = item.price > 0;
    } else if (activity.resourceType === 'duckpin_lane') {
      // DUCKPIN (2026-08-24). Meme grille et meme regle de groupe que le
      // bowling, mais SES pistes a lui : le catalogue en declare 2 a
      // Libramont (booking.units). La ligne n avait ni duree lue (le recap
      // disait « 0.5h » en tete et « 1h » en dessous), ni compte de pistes,
      // ni prix (« montant confirme a votre arrivee » sous une carte qui
      // affiche la grille). Au-dela de la dotation, on n invente pas une
      // 3e piste : le groupe tourne, et le tunnel le dit.
      item.duration = normalizeDurationHours(raw && (raw.duration ?? raw.durationHours));
      // LES TOURS (audit du 2026-09-28, Movsar : « nous n avons que 2 pistes
      // avec 6 joueurs max », puis « plusieurs tours »). Au-dela de la
      // dotation, le groupe ne se tasse plus a 7 ou 8 par piste pendant la
      // meme heure : il joue en plusieurs tours, chacun de la duree choisie,
      // et chaque tour paie les pistes qu il occupe. 18 joueurs : 3 pistes,
      // 2 puis 1, deux heures, 3 x 39 EUR. Les pistes se deduisent TOUJOURS
      // du groupe : une ligne relue n impose pas ses anciennes pistes a un
      // groupe qui a change.
      const plan = activityUnitPlan(activity, people, { fallbackCapacity: DUCKPIN_FALLBACK_CAPACITY });
      item.units = plan.units;
      item.laneCount = plan.atOnce;
      item.sessions = plan.tours;
      item.rotation = plan.tours > 1;
      item.minutes = Math.round(item.duration * 60) * plan.tours;
      // La grille PAR PISTE, celle que la carte du tunnel affiche deja
      // (« des 20 EUR la piste ») : bowlingConfig null pour ne jamais basculer
      // sur le mode aux-parties d un centre qui ne l applique qu au bowling.
      // Les pistes de TOUS les tours : chacune est jouee, chacune se paie.
      item.price = getBasePrice('bowling', item.duration, plan.units, people, '', centerId, { bowlingConfig: null, dateStr });
      item.priceKnown = item.price > 0;
    } else if (activityId === LASER_ID) {
      const option = normalizeGames(raw && (raw.games ?? raw.laserGames));
      item.games = Number(option.games);
      item.duration = Number(option.value);
      item.minutes = Number(option.durationMinutes) || Math.round(option.value * 60);
      item.price = getBasePrice('laser', option.value, 0, people, '', centerId);
      item.priceKnown = item.price > 0;
      // Le laser se joue a deux au moins (catalogue : booking.minPax). La ligne
      // le dit ; le tunnel ne la propose pas, la porte publique la refuse.
      const minimum = Math.trunc(Number(activity.minPax) || 0);
      if (minimum > people) item.belowMinPax = minimum;
    } else {
      if (activity.priceType === 'per_unit_hour') {
        // LES TABLES SE CHOISISSENT (Movsar, 2026-09-28 : « tu dois permettre
        // de choisir combien de tables ils veulent et c 10 euro par heure et
        // par table »). Une par defaut ; au-dela de ce que le centre possede
        // (catalogue : units, reglable dans Etablissement), la demande est
        // REFUSEE avec le compte du centre, jamais rabotee en silence.
        const dotation = Math.trunc(Number(activity.units) || 0);
        const demandees = Math.trunc(Number(raw && raw.units) || 0);
        if (dotation > 0 && demandees > dotation) {
          const mot = (/par ([a-zà-ÿ]+)/i.exec(String(activity.unitLabel || '')) || [])[1] || 'unité';
          throw rejectOption(`${activity.name} : ${dotation} ${mot}${dotation > 1 ? 's' : ''} au plus.`);
        }
        // LE PLAFOND D UNE RESERVATION EN LIGNE (Movsar, 2026-09-30 : « ils
        // peuvent aller jusqu a 5 max de table ») : le formulaire s arrete la,
        // le serveur le tient pour une demande forgee. Refuse, jamais rabote.
        // Le comptoir n y est pas soumis : il vend toute la dotation (un
        // groupe au telephone). `publicBooking` vient de l appelant de
        // confiance (le canal impose par l API), jamais du corps de la demande.
        const plafond = Math.trunc(Number(activity.maxUnitsPerBooking) || 0);
        if (publicBooking && plafond > 0 && demandees > plafond) {
          const mot = (/par ([a-zà-ÿ]+)/i.exec(String(activity.unitLabel || '')) || [])[1] || 'unité';
          throw rejectOption(`${activity.name} : ${plafond} ${mot}${plafond > 1 ? 's' : ''} au plus par réservation.`);
        }
        item.units = activityUnitPlan(activity, people, { requested: demandees }).units;
        item.hours = Math.min(6, Math.max(0.5, Number(raw && raw.hours) || 1));
      }
      // Participants PROPRES a la ligne (2026-08-18) : la plaine de jeux se
      // paie PAR ENFANT, pas par membre du groupe (4 adultes + 2 enfants ne
      // font pas 6 entrees). Borne au groupe ; absent = tout le monde, le
      // comportement historique ne bouge pas d'un centime.
      if (activity.priceType === 'per_pax') {
        const declared = Math.trunc(Number(raw && raw.participants) || 0);
        item.participants = declared >= 1 ? Math.min(people, declared) : people;
      }
      // UNE SESSION CHOISIE EST UNE SESSION RESPECTEE. Les minutes n etaient
      // jamais lues de la demande : `activityEstimatedMinutes` retombait donc
      // toujours sur le PREMIER palier de la grille, et une session Fun Run de
      // 30 min etait enregistree, planifiee et facturee comme une de 15 min.
      // Un palier absent de la grille ne s invente pas au prorata : la fonction
      // reprend le premier, comme avant.
      // UNE LIGNE DEJA NORMALISEE SE RENORMALISE A L IDENTIQUE (audit du
      // 2026-09-28). Ses `minutes` sont le temps du GROUPE : trois passages de
      // 30 min font 90. Relues comme la duree d UNE session, elles ne
      // trouvaient aucun palier et retombaient sur le premier : 3 x 55 EUR
      // annonces au tunnel partaient a 3 x 30 EUR des que le serveur
      // renormalisait le programme. Le palier voyage donc a part.
      // UN GROUPE PLUS GRAND QUE L INSTALLATION TOURNE. Le Fun Run prend
      // 5 joueurs a la fois (catalogue : capacityPerUnit) : douze personnes
      // font trois passages, qui durent trois fois la session et se paient
      // trois fois. Avant, le maximum du catalogue faisait DISPARAITRE
      // l'activite au-dela de 5 joueurs, et la ligne chiffrait UNE session
      // pour tout le groupe (mesure citee dans lib/booking-complements).
      // Une activite sans capacite declaree passe en une fois, comme avant.
      // TOUT LE GROUPE NE FAIT PAS FORCEMENT LE FUN RUN (Movsar, 2026-10-01 :
      // « ajoute le choix de nombre de joueurs pour le fun run, imagine que 5
      // veulent le faire »). Les joueurs declares, bornes au groupe, font les
      // sessions, donc le temps et le prix ; absents, tout le groupe joue,
      // comme avant.
      if (activity.priceType === 'grid_fun_run') {
        const declares = Math.trunc(Number(raw && raw.participants) || 0);
        if (declares >= 1 && declares < people) item.participants = declares;
      }
      item.sessions = activitySessionCount(activity, activity.priceType === 'grid_fun_run' && item.participants ? item.participants : people);
      if (item.sessions > 1) item.rotation = true;
      const minutesDemandees = minutesDUneSession(raw, item.sessions);
      item.minutes = activityEstimatedMinutes(activity, {
        hours: item.hours == null ? null : item.hours,
        minutes: minutesDemandees > 0 ? minutesDemandees : null,
        sessions: item.sessions,
      });
      // dateStr + startTime : un palier de tarif borne par le jour ou l'heure
      // (migration 0043) ne peut s'appliquer que si on les connait. Sans
      // creneau, c'est le prix de BASE : le montant ne peut que baisser une
      // fois l'heure choisie, jamais monter.
      const price = activityLinePrice(activity, {
        // `minutes` : le palier de la grille, celui d'UNE session, jamais le
        // temps total du groupe, sinon trois passages de 15 min chercheraient
        // un palier de 45 qui n'existe pas et retomberaient sur le premier.
        pax: item.participants || people, units: item.units, hours: item.hours, dateStr, startTime,
        minutes: Math.round(item.minutes / item.sessions), sessions: item.sessions,
      });
      item.price = price;
      item.priceKnown = price != null;
      if (activity.priceType === 'grid_fun_run') item.sessionMinutes = Math.round(item.minutes / item.sessions);
      // TARIF D ATTENTE : il remplace le tarif du catalogue pour CETTE ligne,
      // et seulement pour les personnes qui attendent.
      const offreAttente = waitOffers && raw && raw.waitOffer === true && activity.planned !== true
        ? centerWaitOffer(centerId, activityId)
        : null;
      if (offreAttente) {
        const attendent = Math.trunc(Number(raw.participants) || 0);
        item.participants = attendent >= 1 ? Math.min(people, attendent) : people;
        if (offreAttente.minutes > 0) item.minutes = offreAttente.minutes;
        item.price = Math.round(offreAttente.pricePerPax * item.participants * 100) / 100;
        item.priceKnown = true;
        item.waitOffer = true;
        item.waitPricePerPax = offreAttente.pricePerPax;
      }
    }

    items.push(item);
  }

  // Ordre du programme = ordre du catalogue (bowling, laser, puis les libres) :
  // le client lit toujours sa visite dans le meme sens, quel que soit l'ordre de
  // ses clics.
  const order = new Map(catalog.map((activity, index) => [activity.id, index]));
  items.sort((a, b) => (order.get(a.activityId) ?? 99) - (order.get(b.activityId) ?? 99));

  const plannedItems = items.filter((item) => item.planned);
  const freeItems = items.filter((item) => !item.planned);
  const price = items.reduce((total, item) => total + (item.priceKnown ? Number(item.price) : 0), 0);

  return {
    items,
    plannedItems,
    freeItems,
    // LE TEMPS DES ACTIVITES LIBRES (entretien Seb, 2026-09-17). Elles ne
    // prennent aucune ressource, donc aucune capacite, mais elles prennent du
    // TEMPS et le centre ferme. Sans cette reserve, le moteur proposait une
    // arrivee a 20:30 pour bowling 1 h + minigolf 45 min dans un centre qui
    // ferme a 22:00, et annoncait « fin 21:35 ». Le chemin de la visite
    // 100 % libre comptait deja ces minutes : c est la meme verite pour les
    // deux chemins du meme produit.
    freeMinutes: freeItems.reduce((total, item) => total + Math.max(0, Math.round(Number(item.minutes) || 0)), 0),
    freeLabel: freeItems.map((item) => item.name).filter(Boolean).join(', '),
    // La part de `freeMinutes` qui se joue PENDANT l attente d un sous-groupe.
    // Le moteur la deduit de la reserve a hauteur du temps mort reel du plan :
    // une activite proposee au groupe qui patiente ne repousse pas la fin de la
    // visite, seul son debordement le fait.
    waitMinutes: freeItems.reduce((total, item) => total + (item.waitOffer === true ? Math.max(0, Math.round(Number(item.minutes) || 0)) : 0), 0),
    pax: people,
    price: Math.round(price * 100) / 100,
    // Au moins une ligne sans tarif connu : le tunnel doit dire "des X EUR" et
    // "le reste se regle sur place", jamais afficher un total qui ment.
    priceComplete: items.length > 0 && items.every((item) => item.priceKnown),
    hasBowling: items.some((item) => item.activityId === BOWLING_ID),
    hasLaser: items.some((item) => item.activityId === LASER_ID),
    laneCount: items.find((item) => item.activityId === BOWLING_ID)?.laneCount || 0,
  };
}

// LE GROUPE EST-IL SCINDE ? Une activite planifiee qui ne prend pas tout le
// monde d un coup impose plusieurs passages : le moteur joue alors en vagues
// (« Laser Game - groupe 2/2 ») et un sous-groupe attend son tour. C est la
// SEULE situation ou le tarif d attente du centre s applique. La regle est
// ecrite ICI, une fois, pour la disponibilite ET pour la reservation : deux
// copies auraient fini par diverger, et l une des deux facture.
//
// Deux cas : l arene laser, qui refuse un groupe entier (weaponCount), et
// depuis le 2026-09-29 une activite LIBRE qui tourne (attenteDesTours : le
// duckpin au-dela de ses pistes, le Fun Run au-dela d une session).
// AUCUN REPLI SUR UN CENTRE : sans centre nomme, la reponse est « je ne sais
// pas », donc NON. Un defaut 'libramont' aurait fait juger un groupe sur l arene
// de Libramont (30 armes) pour un centre qui n en a pas autant, et le tarif
// d attente, qui est SOUS le catalogue, se serait applique a tort. Meme regle
// que l ecriture d une reservation, qui refuse en 422 sans centre.
function groupIsSplit({ centerId = '', pax = 1, items = [] } = {}) {
  const maison = String(centerId || '').trim();
  if (!maison) return false;
  const people = Math.max(1, Math.trunc(Number(pax) || 1));
  const lignes = Array.isArray(items) ? items : [];
  const veutLaser = lignes.some((item) => {
    const id = String((item && (item.activityId || item.id)) || '').trim();
    return id === LASER_ID;
  });
  if (veutLaser) {
    let center = null;
    try {
      center = require('./ops-knowledge').getCenter(maison);
    } catch (error) {
      center = null;
    }
    const armes = Math.trunc(Number(center && center.resources && center.resources.laser && center.resources.laser.weaponCount) || 0);
    if (armes > 0 && people > armes) return true;
  }
  return Boolean(attenteDesTours({ centerId: maison, pax: people, items: lignes }));
}

// LE SOUS-GROUPE QUI ATTEND SUR UNE ACTIVITE QUI TOURNE (2026-09-29). Movsar :
// « pour les groupes ou il faut split la session, le groupe A joue et le
// groupe B doit attendre que le groupe A termine : a ce moment-la dis-le et
// propose une activite qui dure a peu pres le temps d attente ». Au-dela de
// son installation, une activite libre se joue en tours (duckpin : 2 pistes de
// 6, 18 joueurs = 12 puis 6) ou en sessions (Fun Run : 5 a la fois, 12 = 5, 5
// puis 2). MEME CONVENTION que attenteDuSousGroupe (lib/ops-engine) pour les
// vagues d une activite planifiee : les personnes du DERNIER tour, et le temps
// entre le premier depart et le sien. Entre plusieurs activites qui tournent,
// l attente la plus longue. Les lignes d offre d attente ne comptent pas : ce
// sont elles qui remplissent ce temps.
function attenteDesTours({ centerId = '', pax = 1, items = [] } = {}) {
  const maison = String(centerId || '').trim();
  if (!maison) return null;
  const people = Math.max(1, Math.trunc(Number(pax) || 1));
  const lignes = (Array.isArray(items) ? items : []).filter((item) => item && item.waitOffer !== true);
  if (!lignes.length) return null;
  let programme = null;
  try {
    programme = normalizeProgram(lignes, { centerId: maison, pax: people });
  } catch (error) {
    return null;
  }
  const catalogue = listCenterActivities(maison);
  let meilleure = null;
  (programme.items || []).forEach((item) => {
    const tours = Math.trunc(Number(item && item.sessions) || 0);
    if (!item || item.rotation !== true || tours < 2 || item.planned) return;
    const activity = catalogue.find((entry) => entry.id === item.activityId) || null;
    if (!activity) return;
    let places = 0;
    let minutesParTour = 0;
    if (activity.resourceType === 'duckpin_lane') {
      const plan = activityUnitPlan(activity, people, { fallbackCapacity: DUCKPIN_FALLBACK_CAPACITY });
      places = plan.atOnce * plan.perUnit;
      minutesParTour = Math.round((Number(item.duration) || 0) * 60);
    } else {
      const capacite = Math.trunc(Number(activity.capacityPerUnit) || 0);
      places = capacite * Math.max(1, Math.trunc(Number(activity.units) || 1));
      minutesParTour = Math.round((Number(item.minutes) || 0) / tours);
    }
    if (!(places > 0) || !(minutesParTour > 0)) return;
    const personnes = people - (tours - 1) * places;
    const minutes = (tours - 1) * minutesParTour;
    if (personnes > 0 && minutes > 0 && (!meilleure || minutes > meilleure.minutes)) {
      meilleure = { personnes, minutes, activityId: item.activityId, tours };
    }
  });
  return meilleure;
}

// Le TYPE de reservation derive du programme. On n'invente un type nouveau que
// pour le cas qui n'existait pas (aucune ressource planifiee) : `type` est lu a
// plus de 260 endroits, et un quatrieme type generalise aurait demande de tous
// les auditer.
function programReservationType(program) {
  if (!program || !program.items.length) return 'bowling';
  if (program.hasBowling) return 'bowling';
  if (program.hasLaser) return 'laser';
  return 'activite';
}

// Le document de formule SYNTHETIQUE donne au moteur. Il ne porte que les
// activites qui contraignent le creneau : les libres n'ont pas a peser sur le
// placement des pistes et de l'arene.
// Rend null quand la visite n'a aucune activite planifiee : il n'y a alors rien
// a planifier, et le moteur n'a pas a etre appele.
function buildProgramFormula(program, { name = 'Votre visite' } = {}) {
  if (!program || !program.plannedItems.length) return null;
  const steps = program.plannedItems.map((item) => {
    if (item.activityId === BOWLING_ID) {
      return { activityId: BOWLING_ID, count: 1, durationMinutes: item.minutes, critical: true };
    }
    return { activityId: LASER_ID, count: Number(item.games) || 1, critical: true };
  });
  return {
    id: SYNTHETIC_FORMULA_ID,
    name,
    family: 'Visite',
    minPax: 1,
    // Le prix ne passe PAS par le document : il est calcule ligne par ligne dans
    // normalizeProgram. Un montant pose ici serait une deuxieme verite.
    price: { type: 'per_pax', value: 0 },
    orderPolicy: 'flexible',
    humanValidation: 'recommended',
    steps,
  };
}

// Ce que le staff lit sur la fiche : le programme en une ligne.
function describeProgram(program) {
  if (!program || !program.items.length) return '';
  return program.items.map((item) => {
    if (item.activityId === BOWLING_ID) return `Bowling ${formatHours(item.duration)}`;
    if (item.activityId === LASER_ID) return `Laser ${item.games} partie${item.games > 1 ? 's' : ''}`;
    if (item.units) return `${item.name} ${detailUnites(item)}`;
    // Le compte declare ne s'ecrit que s'il dit quelque chose (une partie du
    // groupe) : « Playground 2 enfants » informe le comptoir, « 6 » pour un
    // groupe de 6 ne ferait que du bruit.
    if (item.participants && item.participants !== program.pax) {
      const unit = /enfant/i.test(item.unitLabel || '') ? 'enfant' : 'pers.';
      return `${item.name} ${item.participants} ${unit}${item.participants > 1 && unit === 'enfant' ? 's' : ''}`;
    }
    return item.name;
  }).join(' · ');
}

// Ce qu une ligne a installations occupe, en une ligne : « 3 pistes · 2 tours
// de 1h », « 2 tables · 2h ». Le mot vient du catalogue (« par piste », « par
// table et par heure »), la duree de la ligne (heures d une table, duree d une
// piste), les tours de ses sessions.
function detailUnites(item) {
  const units = Math.max(1, Math.trunc(Number(item.units) || 1));
  const mot = (/par ([a-zà-ÿ]+)/i.exec(String(item.unitLabel || '')) || [])[1] || '';
  const nombre = mot ? `${units} ${mot}${units > 1 ? 's' : ''}` : `${units}x`;
  const duree = formatHours(Number(item.hours) || Number(item.duration) || 0);
  const tours = Math.max(1, Math.trunc(Number(item.sessions) || 1));
  if (!duree) return nombre;
  return tours > 1 ? `${nombre} · ${tours} tours de ${duree}` : `${nombre} · ${duree}`;
}

function formatHours(value) {
  const hours = Number(value) || 0;
  if (!hours) return '';
  if (Number.isInteger(hours)) return `${hours}h`;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return whole ? `${whole}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

module.exports = {
  attenteDesTours,
  groupIsSplit,
  MAX_ITEMS,
  SYNTHETIC_FORMULA_ID,
  buildProgramFormula,
  describeProgram,
  minutesDUneSession,
  normalizeProgram,
  programReservationType,
};
