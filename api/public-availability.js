const {
  FORMULES,
  LASER_GAME_OPTIONS,
  currentTimeDecimal,
  getBasePrice,
  getEffectiveFormules,
  getFormuleArrivalWindow,
  getFormuleAvailability,
  getFormuleLaneDuration,
  getFormuleTotalDuration,
  getHolidayContext,
  getRequiredLaneCount,
  getSchedule,
  numToTime,
  refreshFormuleOverrides,
  refreshWalloniaSchoolHolidays,
  reservationNeedsLanes,
  roundUpHalfHour,
  timeToNum,
  todayStr,
  TOTAL_LANES,
  bookingDateOutOfRange,
  BOOKING_HORIZON_DAYS,
} = require('../lib/booking-config');
const { allocateLanes, getPool, readAvailabilitySnapshot } = require('../lib/database');
const { sendError, sendJson, setCors } = require('../lib/http');
const { enforceRateLimit } = require('../lib/rate-limit');
const { planningAgent } = require('../lib/ops-agents');
const {
  attenteDuSousGroupe,
  buildDefaultAnchorTimes,
  evaluateAnchoredCombination,
  getFormulaAnchorAvailability,
  getFormulaAnchorModel,
  getOperationalBowlingConfig,
} = require('../lib/ops-engine');
const { getCenter, getFormula, refreshCenterOverrides, refreshCatalog, publicBookingBlockReason } = require('../lib/ops-knowledge');
const {
  isCenterClosedAt,
  isCenterClosedDuring,
  isActivityBlockedAt,
  isActivityFullyBlockedOn,
  isFormulaBlockedOn,
  isFormulaFullyBlockedOn,
} = require('../lib/availability-blocks');
const { buildProgramFormula, describeProgram, groupIsSplit, normalizeProgram } = require('../lib/visit-program');
const { buildFormulaComplements, buildVisitComplements } = require('../lib/booking-complements');
// La projection d un scenario en creneau, la garde finale et les compositions
// par defaut d une formule : le code que l agent lit aussi (proposedArrivals),
// pour dire aux clients les heures et les durees que ce tunnel propose.
const {
  anchoredDefaultSlots,
  filterSlotsByFinalGuards,
  firstActivityTime,
  formulaOccupiedDuration,
  getFreeCount,
  laneWindowsFromReservation,
  plannedArrivalSlots,
  readBlockHour,
  slotPassesFinalGuards,
  toFormulaSlot,
} = require('../lib/availability-slots');

const LASER_ARENA_MINUTES = 25;
// Fenêtre d'accueil fixe AVANT la première activité : l'heure choisie par le
// client est l'heure exacte de début de sa première activité, l'accueil se
// fait 10 minutes avant (aligné sur lib/ops-engine.js).
const FORMULA_ARRIVAL_MINUTES = 10;
const FORMULA_TRANSITION_MINUTES = 5;
// Règle métier : TOUTE heure proposée au client est une heure pleine ou demie
// (15:00, 15:30, jamais 15:15 ni 16:40). Elle s'applique au début du
// PROGRAMME, c'est-à-dire au début de la PREMIÈRE activité, quelle qu'elle
// soit (bowling, laser, minigolf…). Les activités suivantes à l'intérieur du
// programme peuvent rester à des heures fines (enchaînement naturel).
const PROGRAM_GRID_MINUTES = 30;
// Les pistes de bowling restent en plus alignées :00/:30 même au milieu d'un
// programme (contrainte d'exploitation des pistes).
const BOWLING_GRID_MINUTES = PROGRAM_GRID_MINUTES;

// Une visite scindee peut facturer huit pistes au total tout en n'en occupant
// que quatre par service. La garde finale doit verifier l'occupation maximale
// d'UN bloc, pas le nombre facture ni l'union des pistes physiques.
function plannedLaneCount(plan, fallback = 0) {
  const blocks = Array.isArray(plan && plan.resourceBlocks) ? plan.resourceBlocks : [];
  const counts = blocks
    .filter((block) => block.resourceType === 'bowling_lane')
    .map((block) => Math.max(Number(block.requiredLanes) || 0, Array.isArray(block.lanes) ? block.lanes.length : 0));
  return counts.length ? Math.max(...counts) : Math.max(0, Number(fallback) || 0);
}

function getLaserOptionFromRequest(url, fallbackDuration = 0.5) {
  const requestedGames = Number(url.searchParams.get('laserGames') || url.searchParams.get('games') || url.searchParams.get('gameCount') || 0);
  if (requestedGames >= 1) {
    const normalizedGames = Math.max(1, Math.min(3, Math.trunc(requestedGames)));
    const option = LASER_GAME_OPTIONS.find((item) => Number(item.games) === normalizedGames);
    if (option) return option;
  }
  return LASER_GAME_OPTIONS.find((item) => Number(item.value) === Number(fallbackDuration)) || LASER_GAME_OPTIONS[0];
}

function laserWindowsFromReservation(reservation) {
  const blocks = Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : [];
  const planned = blocks
    .filter((block) => block.resourceType === 'laser_arena')
    .map((block) => {
      const start = readBlockHour(block, 'start') * 60;
      const rawEnd = readBlockHour(block, 'end', (start / 60) + (LASER_ARENA_MINUTES / 60)) * 60;
      return {
        start,
        end: Math.min(rawEnd, start + LASER_ARENA_MINUTES),
        players: Number(block.players || reservation.pax || 0),
      };
    })
    .filter((window) => window.end > window.start);
  if (planned.length) return planned;
  if (reservation.type === 'formule' || reservation.formuleId) {
    return getFormulaFallbackLaserWindows(reservation);
  }
  if (reservation.type === 'laser') {
    const start = Math.round(timeToNum(reservation.startTime) * 60);
    return [{
      start,
      end: start + LASER_ARENA_MINUTES,
      players: Number(reservation.pax || 0),
    }];
  }
  return [];
}

function getFormulaFallbackLaserWindows(reservation) {
  if (!reservation?.formuleId) return [];
  const formulaDoc = getFormula(reservation.formuleId);
  const games = getFormulaStepCount(formulaDoc, 'laser_game');
  if (!games) return [];

  const players = Math.max(1, Number(reservation.pax || 1));
  const bowlingWindows = laneWindowsFromReservation(reservation);
  // reservation.startTime = début exact de la première activité (l'accueil se
  // fait avant) : sans bowling planifié, le premier laser part à cette heure.
  const firstLaserStart = bowlingWindows.length
    ? Math.round(Math.max(...bowlingWindows.map((window) => window.start + window.duration)) * 60) + FORMULA_TRANSITION_MINUTES
    : Math.round(timeToNum(reservation.startTime) * 60);
  let cursor = Math.max(0, firstLaserStart);
  const windows = [];

  for (let index = 0; index < games; index += 1) {
    windows.push({
      start: cursor,
      end: cursor + LASER_ARENA_MINUTES,
      players,
      countIndex: index + 1,
      formulaFallback: true,
    });
    cursor += LASER_ARENA_MINUTES + FORMULA_TRANSITION_MINUTES;
  }

  return windows;
}

function getFormulaStepCount(formulaDoc, activityId) {
  return (formulaDoc?.steps || [])
    .filter((step) => step.activityId === activityId)
    .reduce((sum, step) => sum + Math.max(1, Number(step.count || 1)), 0);
}

// Ce que le client a choisi pour une activite libre, en une ligne. AUCUN
// montant ici : le prix a une seule source d'autorite (le programme rendu a
// l'etape 1 et le recapitulatif final), le repeter creerait une deuxieme
// verite qui divergera.
function describeFreeVisitItem(item) {
  if (item.units && item.hours) {
    const hours = Number(item.hours);
    const label = Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${String(Math.round((hours - Math.floor(hours)) * 60)).padStart(2, '0')}`;
    return `${item.units} table${item.units > 1 ? 's' : ''} · ${label}`;
  }
  if (item.games) return `${item.games} partie${item.games > 1 ? 's' : ''}`;
  return '';
}

function firstLaserBlock(scenario) {
  return (scenario?.resourceBlocks || []).find((block) => block.resourceType === 'laser_arena') || null;
}

function toLaserSlot(scenario, pax) {
  const laserBlock = firstLaserBlock(scenario);
  const sharing = scenario.laserSharing || {};
  return {
    time: scenario.startTime,
    lanes: [],
    freeCount: sharing.remainingPlaces ?? laserBlock?.remainingWeapons ?? 0,
    groupPlayers: Number(pax || sharing.requestedPlayers || 0),
    waveCount: sharing.waveCount || 1,
    launchCount: sharing.launchCount || 1,
    splitGroup: Boolean(sharing.splitGroup),
    maxSessionPlayers: sharing.playersTotal ?? laserBlock?.playersTotal ?? laserBlock?.players ?? 0,
    sharedSession: Boolean(sharing.sharedNow),
    mayShareSession: sharing.mayShare !== false,
    opsPlan: {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      totalMinutes: scenario.totalMinutes,
      arrivalTime: scenario.arrivalTime || null,
      arrivalMinutes: scenario.arrivalMinutes || null,
      bufferMinutes: scenario.bufferMinutes,
      risk: scenario.risk,
      staffSummary: scenario.staffSummary,
      assignedLanes: [],
      timeline: scenario.timeline || [],
      resourceBlocks: scenario.resourceBlocks || [],
      marketIntelligence: scenario.marketIntelligence || null,
      entitlements: scenario.entitlements || null,
      operationsChecklist: scenario.operationsChecklist || [],
      customerCommitment: scenario.customerCommitment || [],
      firstLaserTime: firstActivityTime(scenario, 'laser_game'),
      laserSharing: scenario.laserSharing || null,
    },
  };
}

module.exports = async (req, res) => {
  setCors(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Méthode non autorisée.');
    return;
  }

  if (enforceRateLimit(req, res, { scope: 'public-availability', limit: 60, windowMs: 60_000 })) {
    return;
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const date = String(url.searchParams.get('date') || '');
    // Meme horizon que l'ecriture : sans cette borne, l'ecran servait de vrais
    // creneaux pour 2028, une date que le calendrier des conges ne couvre pas.
    // Le passe n'est pas refuse ici : d'autres surfaces relisent des journees
    // ecoulees, et les creneaux passes sont deja filtres a l affichage.
    if (bookingDateOutOfRange(date) === 'far') {
      sendJson(res, 200, { ok: true, date, slots: [], message: `Les réservations sont ouvertes jusqu'à ${BOOKING_HORIZON_DAYS} jours à l'avance. Choisissez une date plus proche.` });
      return;
    }
    const centerId = String(url.searchParams.get('centerId') || 'libramont');
    // Reflect the latest per-center config edits (cached ~30s). Fails soft on a
    // DB outage: the file baseline is used so availability never breaks.
    try {
      await refreshCenterOverrides(getPool());
    } catch (error) {
      // Ignore: fall back to the file baseline.
    }
    // Carte d'overrides catalogue (prix / retrait) chaude AVANT tout calcul de
    // prix : l'apercu de creneau doit facturer le meme prix que la reservation
    // (public-reservations, lib/reservation-request). Fail-soft : sans base on
    // garde le dernier etat connu / le fichier socle.
    try {
      await refreshFormuleOverrides(getPool());
    } catch (error) {
      // Ignore: dernier etat connu / fichier.
    }
    // Catalogue unifie (formules / activites / steps) chaud AVANT tout calcul de
    // prix et d'ancrage. Fail-soft : sans base on garde le socle fichier.
    try {
      await refreshCatalog(getPool());
    } catch (error) {
      // Ignore: dernier etat connu / fichier.
    }
    let centerDoc = null;
    try {
      centerDoc = getCenter(centerId) || null;
    } catch (error) {
      centerDoc = null;
    }
    // CENTRE INCONNU : la meme reponse que public-booking-meta depuis le
    // 2026-08-20. Jusqu'au 2026-09-14, un identifiant invente recevait ici le
    // calendrier de repli (horaires historiques, catalogue par defaut, tout
    // libre) : un site mal branche proposait les creneaux d'un centre qui
    // n'existe pas. Sans centerId, 'libramont' comme depuis toujours. Un centre
    // qui n'existe qu'en base repond 404 tant que la base est muette, comme le
    // catalogue : sans sa configuration, ce calendrier ne dirait rien de vrai.
    if (!centerDoc) {
      sendError(res, 404, 'Centre inconnu.', { centerId: centerId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) });
      return;
    }
    // Meme verdict que l ecriture : un centre pas encore ouvert ne propose
    // aucun creneau, et il DIT pourquoi au lieu d inviter a changer de date.
    // Lu APRES le rechauffage : un centre ne dans la console n'existe qu'en
    // base, son statut avec lui. Lu avant (jusqu'au 2026-09-14), une instance
    // froide le croyait inconnu, son statut vide, et servait ses creneaux.
    const centerBlock = publicBookingBlockReason(centerId);
    if (centerBlock) {
      sendJson(res, 200, { ok: true, date, slots: [], message: centerBlock });
      return;
    }
    const centerBowlingConfig = centerDoc?.resources?.bowling || null;
    const centerLaneCount = Number(centerBowlingConfig?.laneCount) || TOTAL_LANES;
    const rawType = String(url.searchParams.get('type') || 'bowling');
    // 'visite' : plusieurs activites dans une meme reservation (bowling ET laser,
    // ou une activite libre seule). Les types historiques ne changent pas d'un
    // caractere : une visite a UNE seule activite planifiee continue de passer
    // par son chemin d'origine, c'est le tunnel qui n'envoie 'visite' que pour
    // les combinaisons qui n'existaient pas.
    const type = rawType === 'formule' ? 'formule'
      : rawType === 'laser' ? 'laser'
        : rawType === 'visite' ? 'visite' : 'bowling';
    // Borne haute alignée sur la contrainte SQL reservations_pax_check (pax <= 240) :
    // un pax géant non authentifié déclencherait des allocations de tableau
    // proportionnelles dans le moteur de planning (DoS). Le trunc neutralise aussi NaN.
    const pax = Math.min(240, Math.max(1, Math.trunc(Number(url.searchParams.get('pax')) || 1)));
    // Le calendrier scolaire officiel se relit fail-soft (24 h par instance,
    // delai borne) avant de lire les horaires du jour : les heures de vacances
    // suivent l annee en cours sans retaper la table. Un echec ou un delai
    // laisse la table statique faire foi.
    try { await refreshWalloniaSchoolHolidays(); } catch (error) { /* table statique */ }
    const formuleId = String(url.searchParams.get('formuleId') || '');
    const requestedDuration = Number(url.searchParams.get('duration') || (type === 'laser' ? 0.5 : 1));
    // Le catalogue DU CENTRE d'abord, la constante fichier seulement en repli.
    // Avant le 2026-08-20, cette ligne ne lisait QUE la constante : toute
    // formule creee depuis la console (donc absente du fichier) etait refusee
    // ici par « Formule invalide », alors que le tunnel venait de l'afficher.
    // Elle etait affichable et non reservable. getEffectiveFormules est deja
    // rafraichi plus haut dans ce handler, et il est scope par entreprise
    // (migration 0042) : un centre ne resout jamais la formule d'un autre.
    const formule = getEffectiveFormules(centerId).find((item) => item.id === formuleId)
      || FORMULES.find((item) => item.id === formuleId)
      || null;
    const firstActivityId = String(url.searchParams.get('firstActivityId') || '');
    const preferredBowlingTime = String(url.searchParams.get('preferredBowlingTime') || '');
    const preferredLaserTime = String(url.searchParams.get('preferredLaserTime') || '');
    const activityOrder = String(url.searchParams.get('activityOrder') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    let preferredTimes = {};
    try {
      preferredTimes = JSON.parse(String(url.searchParams.get('preferredTimes') || '{}')) || {};
    } catch (error) {
      preferredTimes = {};
    }
    // Panier de la visite. JSON malforme = panier vide (message clair), jamais
    // une 500 : cet endpoint est public et sa robustesse prime sur le diagnostic.
    let programInput = [];
    try {
      programInput = JSON.parse(String(url.searchParams.get('program') || '[]')) || [];
    } catch (error) {
      programInput = [];
    }
    if (preferredBowlingTime) preferredTimes.bowling = preferredBowlingTime;
    if (preferredLaserTime) preferredTimes.laser_game = preferredLaserTime;
    // UNE HEURE PAR PARTIE DE LASER (2026-08-20). Liste dans l'ordre des
    // parties : "16:30" = posee, "" = a placer sur place. Absente, le moteur
    // retombe sur l'ancre unique, donc l'ancien comportement.
    let laserGameTimes = [];
    try {
      const parsed = JSON.parse(String(url.searchParams.get('laserGameTimes') || '[]'));
      laserGameTimes = Array.isArray(parsed) ? parsed.slice(0, 12).map((item) => String(item || '').slice(0, 5)) : [];
    } catch (error) {
      laserGameTimes = [];
    }
    const pauseMinutes = 0;

    if (!date) {
      throw new Error('Date manquante.');
    }

    // Horaires + contexte vacances/feries resolus avec la config du centre
    // (grille staff, overrides ponctuels). Renvoyes au client pour que
    // l'affichage "Ouvert 10h - 22h" reflete la meme verite que le serveur.
    const holidayContext = getHolidayContext(date, centerDoc);
    const schedule = getSchedule(date, centerDoc);
    const scheduleMeta = {
      schedule: schedule ? { open: schedule.open, close: schedule.close, label: schedule.label } : null,
      holiday: {
        active: holidayContext.active,
        periodType: holidayContext.periodType,
        label: holidayContext.label,
      },
    };

    if (date < todayStr()) {
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: [],
        laneCount: 0,
        duration: 0,
        totalDuration: 0,
        price: 0,
        requiresLanes: false,
        label: type === 'formule' && formule ? formule.name : type === 'laser' ? 'Laser Game' : type === 'visite' ? 'Votre visite' : 'Bowling Classique',
        message: 'Cette date est déjà passée.',
      });
      return;
    }

    if (type === 'formule' && !formule) {
      throw new Error('Formule invalide.');
    }

    if (!schedule) {
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: [],
        laneCount: 0,
        duration: 0,
        totalDuration: 0,
        price: 0,
        requiresLanes: false,
        label: type === 'formule' ? formule.name : type === 'laser' ? 'Laser Game' : type === 'visite' ? 'Votre visite' : 'Bowling Classique',
        message: 'Le centre est fermé à cette date.',
      });
      return;
    }

    if (type === 'formule') {
      // Une formule retiree/desactivee par override catalogue (removed:true ou
      // enabled:false) sort de getEffectiveFormules : elle ne doit alors etre ni
      // recherchable ni reservable par formuleId direct. Meme reponse
      // "indisponible" que getFormuleAvailability, aucun creneau reservable.
      if (!getEffectiveFormules(centerId).some((item) => item.id === formuleId)) {
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: [],
          laneCount: getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig),
          duration: getFormuleLaneDuration(formule),
          totalDuration: getFormuleTotalDuration(formule),
          price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),
          requiresLanes: reservationNeedsLanes(type, formuleId),
          label: formule.name,
          message: 'Offre momentanement indisponible',
        });
        return;
      }
      const availability = getFormuleAvailability(formule, date, pax, '', centerDoc);
      if (!availability.ok) {
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: [],
          laneCount: getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig),
          duration: getFormuleLaneDuration(formule),
          totalDuration: getFormuleTotalDuration(formule),
          price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),
          requiresLanes: reservationNeedsLanes(type, formuleId),
          label: formule.name,
          message: availability.message,
        });
        return;
      }
    }

    const snapshot = await readAvailabilitySnapshot(date, centerId);
    const operationalBowlingConfig = getOperationalBowlingConfig(centerDoc, snapshot.laneStatuses || {});
    // Formule bloquee TOUTE la journee (scope 'formula', jour entier) : message
    // clair et aucun creneau, comme un refus de getFormuleAvailability. Un blocage
    // de PLAGE horaire ne coupe pas ici : ses creneaux sont retires par la garde
    // finale (validateReservationResources), au slot pres. Sans blocage : rien.
    if (type === 'formule' && isFormulaFullyBlockedOn(snapshot.blocks || [], date, formuleId)) {
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots: [],
        laneCount: getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig),
        duration: getFormuleLaneDuration(formule),
        totalDuration: getFormuleTotalDuration(formule),
        price: getBasePrice(type, getFormuleLaneDuration(formule), getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig), pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),
        requiresLanes: reservationNeedsLanes(type, formuleId),
        label: formule.name,
        message: 'Formule indisponible ce jour.',
      });
      return;
    }
    const laserOption = getLaserOptionFromRequest(url, requestedDuration);
    const duration = type === 'formule' ? getFormuleLaneDuration(formule) : type === 'laser' ? laserOption.value : requestedDuration;
    // FENETRE OUVERTE (MATIN MALIN, KIDS FUN DAY) : la visite dure jusqu a la
    // fin de la periode, l arrivee se choisit jusqu a la derniere demi-heure
    // avant. La duree estimee par les lignes de la formule (2 h, 5 h) ne borne
    // plus rien : elle vidait la liste des qu on n arrivait pas a l ouverture.
    // LA FENETRE D ARRIVEE VIENT DU MOTEUR (getFormuleArrivalWindow), la meme
    // que l agent lit pour dire aux clients quels jours et jusqu a quelle heure
    // une formule se reserve, et dont le navigateur porte la jumelle. Elle etait
    // ecrite ici en dur, demi-heure de marge comprise : changer la regle d un
    // cote aurait fait promettre par mail une heure que ce tunnel refuse.
    // Elle ne s applique qu a une FORMULE : une demande de bowling ou de laser
    // qui porterait un formuleId (aucun appel du site ne l envoie) n est plus
    // bornee par la plage d une formule qu elle ne reserve pas.
    const openWindow = Boolean(formule && formule.orderPolicy === 'open_window');
    const fenetreFormule = type === 'formule' && formule ? getFormuleArrivalWindow(formule, schedule) : null;
    // Ce qu une reservation de formule occupe SANS PLAN : sa duree estimee, ou
    // toute la periode pour une fenetre ouverte. Meme fonction que l agent.
    // Chaque creneau compose porte son plan, et la garde finale mesure alors la
    // visite planifiee : cette duree n est que son repli.
    const totalDuration = type === 'formule'
      ? formulaOccupiedDuration(formule, schedule)
      : type === 'laser' ? laserOption.value : requestedDuration;
    const laneCount = getRequiredLaneCount(type, pax, formuleId, centerBowlingConfig);
    const requiresLanes = reservationNeedsLanes(type, formuleId);
    let minTime = fenetreFormule ? fenetreFormule.earliestStart : schedule.open;
    let maxTime = fenetreFormule ? fenetreFormule.latestStart : schedule.close - totalDuration;

    if (date === todayStr()) {
      minTime = Math.max(minTime, roundUpHalfHour(currentTimeDecimal()));
    }

    // ── VISITE : plusieurs activites dans une seule reservation ──────────────
    // Deux cas, et un seul moteur.
    //   * au moins deux activites PLANIFIEES (bowling + laser) : on compose une
    //     formule a la volee et on la donne au moteur des formules, qui sait
    //     deja placer deux ressources, gerer les conflits et proposer les heures
    //     par ancre. Aucun second moteur n'est ecrit.
    //   * aucune activite planifiee (minigolf seul, billards seuls) : il n'y a
    //     rien a allouer. Les creneaux sont simplement les heures d'ouverture, a
    //     la demie, moins les fermetures du jour.
    if (type === 'visite') {
      // Le tarif d attente ne s applique que si le groupe est VRAIMENT scinde :
      // une ligne marquee `waitOffer` par un navigateur complaisant est sinon
      // facturee au tarif du catalogue, comme n importe quelle autre.
      const groupeScinde = groupIsSplit({ centerId, pax, items: Array.isArray(programInput) ? programInput : (programInput && programInput.items) || [] });
      const program = normalizeProgram(programInput, {
        centerId,
        pax,
        bowlingConfig: operationalBowlingConfig || centerBowlingConfig,
        dateStr: date,
        waitOffers: groupeScinde,
      });
      const visitLabel = 'Votre visite';
      // LA FIN QUE LE CLIENT LIT EST CELLE DE SA VISITE, pas celle du plan du
      // staff : `opsPlan.endTime` ne porte que les activites planifiees (plus la
      // marge de risque du staff), donc il annoncait « fin 15:05 » pour une
      // visite d 1 h 45. La reserve ne s ajoute QUE s il y a un plan : sur une
      // visite 100 % libre, le plan porte deja tout le programme.
      const reserveAffichee = program.plannedItems.length
        ? Math.max(0, Math.round(Number(program.freeMinutes) || 0))
        : 0;
      // CE QUI SE JOUE PENDANT L ATTENTE NE REPOUSSE PAS LA FIN. Le temps mort
      // se mesure sur le plan de CE creneau (les vagues n ont pas le meme ecart
      // partout), avec la regle du moteur, jamais une copie.
      const finDeVisiteMinutes = (slot) => {
        if (!slot || !slot.time) return null;
        const debut = Math.round(timeToNum(slot.time) * 60);
        const plan = slot.opsPlan || null;
        const marge = Math.max(0, Number(plan && plan.bufferMinutes) || 0);
        const finPlan = plan && plan.endTime ? Math.round(timeToNum(plan.endTime) * 60) - marge : debut;
        const creux = attenteDuSousGroupe(plan && plan.resourceBlocks);
        const couvert = Math.min(
          Math.max(0, Math.round(Number(program.waitMinutes) || 0)),
          Math.max(0, Math.round(Number(creux && creux.minutes) || 0)),
        );
        return Math.max(finPlan, debut) + Math.max(0, reserveAffichee - couvert);
      };
      const respondVisit = (slots, message, extra = {}) => {
        const creneaux = (Array.isArray(slots) ? slots : []).map((slot) => {
          const fin = finDeVisiteMinutes(slot);
          return fin === null ? slot : { ...slot, visitEndTime: numToTime(fin / 60) };
        });
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: creneaux,
          laneCount: program.laneCount,
          duration: program.plannedItems[0]?.duration || 0,
          totalDuration: Math.round((program.items.reduce((sum, item) => sum + (item.minutes || 0), 0) / 60) * 100) / 100,
          price: program.price,
          requiresLanes: program.hasBowling,
          label: visitLabel,
          program,
          // LES COMPLEMENTS DE VISITE : toujours presents, meme vides. Une cle
          // absente et une liste vide se lisent pareil cote client, mais une cle
          // toujours la dit que la question a ete posee - et les deux seuls
          // chemins qui savent y repondre (ceux qui ont un creneau compose) la
          // remplissent par leur bloc `extra`.
          complements: [],
          message,
          ...extra,
        });
      };

      if (!program.items.length) {
        respondVisit([], 'Choisissez au moins une activité.');
        return;
      }

      // Une activite fermee toute la journee (blocage staff) sort du programme
      // AVANT tout calcul : mieux vaut le dire que proposer un creneau pour une
      // activite qui n'ouvrira pas.
      const blockedItem = program.items.find((item) => isActivityFullyBlockedOn(snapshot.blocks || [], date, item.activityId));
      if (blockedItem) {
        respondVisit([], `${blockedItem.name} n'est pas disponible ce jour.`);
        return;
      }

      const engineContext = {
        reservations: snapshot.reservations,
        laneStatuses: snapshot.laneStatuses,
        blocks: snapshot.blocks || [],
      };
      const visitFormula = buildProgramFormula(program, { name: visitLabel });

      if (visitFormula) {
        let anchorMeta = null;
        try {
          // preferredTimes part AVEC la demande : sans lui, la liste d une
          // activite ignorait l heure deja retenue pour l autre et proposait
          // des heures que la validation refusait juste apres.
          anchorMeta = getFormulaAnchorAvailability({
            centerId, formula: visitFormula, date, pax, preferredTimes, laserGameTimes,
            // La fermeture se juge sur la VISITE ENTIERE : les activites libres
            // ne prennent aucune ressource, mais elles prennent du temps.
            reserveMinutes: program.freeMinutes,
            reserveLabel: program.freeLabel,
            reserveWaitMinutes: program.waitMinutes,
          }, engineContext);
        } catch (error) {
          anchorMeta = null;
        }
        // LA VISITE ENTIERE, PAS SEULEMENT SES CRENEAUX. Le document de formule
        // synthetique ne porte QUE le bowling et le laser, par conception : les
        // activites libres ne doivent participer a aucun calcul de
        // disponibilite (lib/visit-program.js). Consequence non voulue : elles
        // ne remontaient nulle part et l'ecran des creneaux amputait la visite
        // du client (Movsar, 2026-08-15 : « on voit pas toutes les activites
        // genre mini golf arcade etc »). On les rend ICI, en affichage pur,
        // avec la verite du catalogue sur leur tarif.
        if (anchorMeta && Array.isArray(program.freeItems) && program.freeItems.length) {
          anchorMeta = {
            ...anchorMeta,
            freePass: program.freeItems.map((item) => ({
              activityId: item.activityId,
              label: item.name,
              // « regle sur place » est une DONNEE (aucun tarif saisi pour
              // cette activite dans ce centre), jamais une supposition.
              onSitePayment: item.priceKnown !== true,
              detail: describeFreeVisitItem(item),
            })),
          };
        }
        const guardContext = {
          centerId,
          date,
          type: 'formule',
          formuleId: '',
          pax,
          duration: program.plannedItems[0]?.duration || 0,
          totalDuration: 0,
          laneCount: program.laneCount,
          requiresLanes: program.hasBowling,
          label: visitLabel,
          snapshot,
        };
        // LES COMPLEMENTS DE VISITE VOYAGENT AVEC LE CRENEAU QUI VIENT D ETRE
        // RETENU (2026-09-05). Meme regle que les montees de formule : ils sont
        // calcules APRES la garde finale, sur un creneau qui y a survecu, et ils
        // partent dans CETTE reponse, sans aucun aller-retour de plus.
        //
        // La garde injectee est celle du creneau retenu, avec l identite du
        // programme CANDIDAT : une activite ajoutee peut etre fermee toute la
        // journee, et un palier de laser en plus ne change ni les pistes ni le
        // besoin de pistes, mais rien ici ne le suppose - tout se relit du
        // programme candidat.
        // LE SOUS-GROUPE QUI ATTEND, lu sur le plan REELLEMENT pose. Quand le
        // moteur joue une activite en plusieurs vagues (« groupe 2/2 »), le
        // dernier groupe attend que les precedents aient joue : c est ce temps
        // mort que l offre d attente vient remplir. Rien n est recalcule ici a
        // partir d une regle refaite : on lit les blocs du plan.
        // Le sous-groupe qui attend, lu sur le plan REELLEMENT pose, avec la
        // regle du moteur : c est la meme que celle qui deduit le temps mort de
        // la reserve, et elle ne doit exister qu une fois.
        const attenteDuPlan = (retainedSlot) => attenteDuSousGroupe(
          retainedSlot && retainedSlot.opsPlan ? retainedSlot.opsPlan.resourceBlocks : null,
        );
        const complementsDeVisite = (retainedSlot) => {
          try {
            return buildVisitComplements({
              centerId,
              date,
              pax,
              program,
              retainedSlot,
              attente: attenteDuPlan(retainedSlot),
              priceOptions: { bowlingConfig: operationalBowlingConfig || centerBowlingConfig, dateStr: date },
              reservations: snapshot.reservations,
              laneStatuses: snapshot.laneStatuses,
              blocks: snapshot.blocks || [],
              passesFinalGuards: ({ scenario, program: candidat }) => {
                // Le programme COURANT a deja passe ce test plus haut ; la ligne
                // que le complement ajoute, elle, ne l a jamais passe.
                if ((candidat.items || []).some((item) => isActivityFullyBlockedOn(snapshot.blocks || [], date, item.activityId))) {
                  return false;
                }
                return slotPassesFinalGuards(
                  toFormulaSlot(scenario, snapshot, candidat.plannedItems[0]?.duration || 0),
                  {
                    ...guardContext,
                    laneCount: plannedLaneCount(scenario, candidat.laneCount),
                    requiresLanes: candidat.hasBowling,
                    duration: candidat.plannedItems[0]?.duration || 0,
                  },
                );
              },
            });
          } catch (error) {
            // Une proposition n est jamais une raison de casser une disponibilite :
            // sans elle, le tunnel se comporte exactement comme avant ce lot. Mais
            // elle laisse une trace, sinon « la proposition ne s affiche plus »
            // n aurait aucune cause lisible.
            console.error('[public-availability] complements visite', error && (error.stack || error.message));
            return [];
          }
        };
        const hasAnchorChoice = Boolean(preferredTimes.bowling || preferredTimes.laser_game
          || laserGameTimes.some((time) => time));
        if (!hasAnchorChoice) {
          // ZERO FRICTION, comme pour une formule : on ne rend pas une liste
          // vide. Une liste vide faisait afficher au client, DES SON ARRIVEE
          // sur l'ecran, un encadre rouge « Cette combinaison n'est pas
          // possible » alors qu'il n'avait rien choisi du tout. On compose donc
          // la premiere combinaison valide et on la propose.
          const defaultTimes = anchorMeta && anchorMeta.ok
            ? buildDefaultAnchorTimes({
              center: getCenter(centerId),
              formula: visitFormula,
              date,
              pax,
              model: getFormulaAnchorModel(visitFormula),
              candidatesByActivity: Object.fromEntries((anchorMeta.activities || [])
                .map((activity) => [activity.activityId, activity.times.filter((item) => item.ok !== false).map((item) => Math.round(timeToNum(item.time) * 60))])),
              reservations: snapshot.reservations,
              laneStatuses: snapshot.laneStatuses,
              blocks: snapshot.blocks || [],
            })
            : null;
          const defaultCombo = defaultTimes
            ? evaluateAnchoredCombination({
              center: getCenter(centerId),
              formula: visitFormula,
              date,
              pax,
              anchorTimes: defaultTimes,
              laserPlacement: 'scheduled',
              reserveMinutes: program.freeMinutes,
              reserveLabel: program.freeLabel,
              reserveWaitMinutes: program.waitMinutes,
              reservations: snapshot.reservations,
              laneStatuses: snapshot.laneStatuses,
              blocks: snapshot.blocks || [],
            })
            : null;
          const defaultSlots = defaultCombo && defaultCombo.ok
            ? filterSlotsByFinalGuards(
              [toFormulaSlot(defaultCombo.scenario, snapshot, program.plannedItems[0]?.duration || 0)],
              { ...guardContext, laneCount: plannedLaneCount(defaultCombo.scenario, program.laneCount) },
            )
            : [];
          respondVisit(
            defaultSlots,
            defaultSlots.length ? '' : 'Aucune combinaison disponible ce jour-là. Essayez une autre date ou un autre groupe.',
            { anchors: anchorMeta, complements: complementsDeVisite(defaultSlots[0] || null) },
          );
          return;
        }
        // UNE HEURE CHOISIE NE DOIT PAS EN EXIGER DEUX (entretien Seb,
        // 2026-09-17). Le client qui pose UNE heure, ou qui DECALE une activite
        // pour prendre l heure qu il veut, laisse l autre activite libre. Le
        // moteur repondait « Choisissez une heure pour Bowling » et fermait le
        // creneau : la reponse juste est de PLACER l activite restante autour de
        // l heure choisie. Ces defauts viennent de la grille elle-meme
        // (anchorMeta.defaultTimes, calcules avec les heures retenues) : le
        // client lit donc exactement ce que le moteur a compose.
        const heuresCompletes = { ...preferredTimes };
        const defautsDeLaGrille = (anchorMeta && anchorMeta.ok && anchorMeta.defaultTimes) || {};
        ((anchorMeta && anchorMeta.activities) || []).forEach((activity) => {
          const id = activity.activityId;
          if (!heuresCompletes[id] && defautsDeLaGrille[id]) heuresCompletes[id] = defautsDeLaGrille[id];
        });
        const partiesCompletes = laserGameTimes.some((time) => time)
          ? laserGameTimes
          : (heuresCompletes.laser_game ? [heuresCompletes.laser_game] : laserGameTimes);
        const plan = planningAgent(
          {
            centerId,
            date,
            type: 'formule',
            formula: visitFormula,
            pax,
            duration: program.plannedItems[0]?.duration || 0,
            preference: { preferredTimes: heuresCompletes, laserGameTimes: partiesCompletes, laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
            pauseMinutes,
          },
          engineContext,
        );
        const recommended = plan?.plan?.recommended;
        const guarded = recommended && recommended.ok
          ? filterSlotsByFinalGuards(
            [toFormulaSlot(recommended, snapshot, program.plannedItems[0]?.duration || 0)],
            { ...guardContext, laneCount: plannedLaneCount(recommended, program.laneCount) },
          )
          : [];
        respondVisit(
          guarded,
          guarded.length ? '' : (plan?.plan?.reason || 'Cette combinaison n’est plus disponible. Essayez une heure proche.'),
          { anchors: anchorMeta, suggestions: plan?.plan?.anchorSuggestions || [], complements: complementsDeVisite(guarded[0] || null) },
        );
        return;
      }

      // Visite 100 % libre : aucune ressource a reserver, donc aucun creneau a
      // refuser. On propose les heures d'ouverture a la demie et on laisse la
      // garde de fermeture faire son travail.
      const visitMinutes = program.items.reduce((sum, item) => sum + (item.minutes || 0), 0);
      const visitHours = Math.max(0.5, Math.round((visitMinutes / 60) * 2) / 2);
      const freeSlots = [];
      for (let value = Math.ceil(minTime * 2) / 2; value <= schedule.close - visitHours; value += 0.5) {
        const startMin = Math.round(value * 60);
        const endMin = startMin + Math.round(visitHours * 60);
        // La visite entiere, pas son seul depart : sinon on propose une heure
        // dont la fin tombe dans une fermeture ponctuelle.
        if (isCenterClosedDuring(snapshot.blocks || [], date, startMin, endMin)) continue;
        const startTime = numToTime(value);
        const endTime = numToTime(value + visitHours);
        freeSlots.push({
          time: startTime,
          lanes: [],
          freeCount: 0,
          opsPlan: {
            startTime,
            endTime,
            totalMinutes: Math.round(visitHours * 60),
            staffSummary: `${visitLabel} - ${pax} personne${pax > 1 ? 's' : ''} | ${describeProgram(program)} | Aucune ressource a bloquer`,
            assignedLanes: [],
            timeline: program.items.map((item) => ({ type: 'activity', activityId: item.activityId, label: item.name })),
            // Des blocs en capacite SOUPLE : ils disent au staff ce que le
            // groupe vient faire sans jamais occuper piste ni arene. C'est aussi
            // ce qui fait tomber la reservation dans l'onglet hors planning.
            resourceBlocks: program.items.map((item, index) => ({
              resourceType: 'soft_capacity',
              activityId: item.activityId,
              startTime,
              endTime,
              countIndex: index + 1,
            })),
          },
        });
        if (endMin >= Math.round(schedule.close * 60)) break;
      }
      respondVisit(freeSlots, freeSlots.length ? '' : 'Aucun horaire disponible ce jour-là.');
      return;
    }

    if (type === 'formule') {
      const formulaDoc = getFormula(formuleId);
      const engineContext = {
        reservations: snapshot.reservations,
        laneStatuses: snapshot.laneStatuses,
        blocks: snapshot.blocks || [],
      };
      // Modèle « Ancres + Liberté » : la dispo est exposée PAR ANCRE
      // (bowling/laser : heures :00/:30 vérifiées indépendamment) + une
      // combinaison par défaut valide. Les activités libres restent un pass
      // sans aucune heure, la table suit l'arrivée.
      const anchorModel = getFormulaAnchorModel(formulaDoc);
      let anchorMeta = null;
      try {
        anchorMeta = getFormulaAnchorAvailability({ centerId, formuleId, date, pax, preferredTimes, laserGameTimes }, engineContext);
      } catch (error) {
        anchorMeta = null;
      }
      const guardContext = {
        centerId,
        date,
        type,
        formuleId,
        pax,
        duration,
        totalDuration,
        laneCount,
        requiresLanes,
        label: formule.name,
        snapshot,
      };
      // LE CRENEAU RETENU, CELUI QUE LE TUNNEL VA VRAIMENT GARDER.
      //
      // Le composeur par defaut adopte tout seul la combinaison
      // `anchorMeta.defaultTimes` (assets/app-main.js adoptDefaultFormulaAnchors),
      // et « Valider ces horaires » n existe QUE pour le creneau qui porte ces
      // heures-la (renderFormulaAnchorStatus : sans correspondance, le bouton
      // n est pas rendu). Le creneau retenu est donc calculable ICI, sans
      // aller-retour de plus, et sans jamais deviner : aucune correspondance =
      // aucun creneau retenu = aucune carte.
      const creneauRetenuParDefaut = (slots, meta) => {
        const heures = (meta && meta.defaultTimes) || null;
        const cles = heures ? Object.keys(heures).filter((cle) => heures[cle]) : [];
        if (!cles.length) return null;
        return slots.find((slot) => {
          const posees = (slot && slot.opsPlan && slot.opsPlan.anchorPlan && slot.opsPlan.anchorPlan.times) || null;
          return posees && cles.every((cle) => posees[cle] === heures[cle]);
        }) || null;
      };
      const respondFormula = (slots, message, suggestions = [], retainedSlot = null) => {
        // LES MONTEES DE FORMULE VOYAGENT AVEC LE CRENEAU QUI VIENT D ETRE
        // RETENU (2026-09-04). Elles sont calculees APRES filterSlotsByFinalGuards,
        // sur un creneau qui a survecu a la garde : proposer une montee sur
        // un creneau que la garde vient de retirer serait proposer du vide. Et
        // elles partent dans CETTE reponse, sans aucun aller-retour de plus :
        // le tunnel a deja paye une requete pour son creneau.
        let complements = [];
        try {
          complements = buildFormulaComplements({
            centerId,
            formuleId,
            date,
            pax,
            retainedSlot,
            type,
            duration,
            priceOptions: { bowlingConfig: centerBowlingConfig, dateStr: date },
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
            blocks: snapshot.blocks || [],
            // LA MEME GARDE FINALE QUE LE CRENEAU RETENU, avec l identite de la
            // CANDIDATE : fermetures du jour, pistes et activites bloquees, et
            // surtout blocage de LA formule proposee, qui n a aucune raison
            // d etre celui de la formule courante.
            passesFinalGuards: ({ scenario, formule: candidate, laneCount: candidateLaneCount }) => (
              slotPassesFinalGuards(toFormulaSlot(scenario, snapshot, getFormuleLaneDuration(candidate)), {
                ...guardContext,
                formuleId: candidate.id,
                label: candidate.name,
                laneCount: candidateLaneCount,
                requiresLanes: reservationNeedsLanes(type, candidate.id),
                duration: getFormuleLaneDuration(candidate),
                totalDuration: getFormuleTotalDuration(candidate),
              })
            ),
          });
        } catch (error) {
          // Une proposition n est jamais une raison de casser une disponibilite :
          // sans elle, le tunnel se comporte exactement comme avant ce lot. Mais
          // elle laisse une trace : sinon « la proposition ne s affiche plus »
          // n aurait aucune cause lisible, et personne ne saurait si c est le
          // module qui casse ou une regle metier qui mord.
          console.error('[public-availability] complements', error && (error.stack || error.message));
          complements = [];
        }
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots,
          laneCount,
          duration,
          totalDuration,
          price: getBasePrice(type, duration, laneCount, pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),
          requiresLanes,
          label: formule.name,
          anchors: anchorMeta,
          suggestions,
          complements,
          message,
        });
      };

      if (anchorModel.anchors.length) {
        const laserPlacement = String(url.searchParams.get('laserPlacement') || '') === 'onsite' ? 'onsite' : 'scheduled';
        const hasAnchorChoice = Boolean(preferredTimes.bowling || preferredTimes.laser_game)
          || laserGameTimes.some((time) => time) || laserPlacement === 'onsite';

        if (hasAnchorChoice) {
          // Revalidation serveur de la combinaison choisie (source de vérité) :
          // soit LE créneau composé, soit un refus clair + suggestions proches.
          const plan = planningAgent(
            {
              centerId,
              date,
              type,
              formuleId,
              pax,
              duration,
              preference: {
                preferredTimes,
                laserGameTimes,
                laserPlacement,
                arrivalConfidence: 'normal',
              },
              pauseMinutes,
            },
            engineContext,
          );
          const recommended = plan?.plan?.recommended;
          const guarded = recommended && recommended.ok
            ? filterSlotsByFinalGuards(
              [toFormulaSlot(recommended, snapshot, duration)],
              { ...guardContext, laneCount: plannedLaneCount(recommended, laneCount) },
            )
            : [];
          if (guarded.length) {
            respondFormula(guarded, '', [], guarded[0]);
            return;
          }
          respondFormula(
            [],
            plan?.plan?.reason || 'Cette combinaison n’est plus disponible. Essayez une heure proche.',
            plan?.plan?.anchorSuggestions || [],
          );
          return;
        }

        // Défaut zéro friction : pour chaque heure possible de la première
        // ancre, la combinaison valide la plus simple (ancres enchaînées,
        // pass liberté autour). Le client peut ensuite modifier chaque ancre.
        // Composee et gardee par lib/availability-slots, que l agent lit aussi.
        const guardedDefaults = anchoredDefaultSlots({
          center: getCenter(centerId),
          formula: formulaDoc,
          date,
          pax,
          model: anchorModel,
          anchorMeta,
          snapshot,
          duration,
          guardContext,
        });
        respondFormula(
          guardedDefaults,
          guardedDefaults.length ? '' : 'Aucune combinaison disponible pour cette formule ce jour-là. Essayez une autre date ou un autre groupe.',
          [],
          creneauRetenuParDefaut(guardedDefaults, anchorMeta),
        );
        return;
      }

      // Formules sans ancre (table anniversaire + pass liberté) : le client
      // choisit simplement son heure d'arrivée : la table suit automatiquement.
      // Départs aux heures pleines ou demies, un plan par combinaison, triés
      // puis gardés : lib/availability-slots, que l agent lit aussi.
      const guardedSlots = plannedArrivalSlots({
        centerId,
        date,
        type,
        formuleId,
        pax,
        duration,
        minTime,
        maxTime,
        preference: {
          firstActivityId,
          activityOrder,
          arrivalConfidence: 'normal',
          preferredTimes,
        },
        pauseMinutes,
        snapshot,
        guardContext,
      });
      // Fenetre ouverte sans aucune arrivee (periode finie avant l ouverture,
      // par exemple MATIN MALIN un jour qui ouvre a 14:00) : la raison du
      // moteur, pas un message generique.
      let emptyMessage = 'Aucun scénario automatique sûr pour cette formule. Essayez un autre horaire ou contactez le centre.';
      if (!guardedSlots.length && openWindow) {
        const probe = planningAgent(
          { centerId, date, type, formuleId, pax, duration, preference: { arrivalConfidence: 'normal' }, pauseMinutes },
          { reservations: snapshot.reservations, laneStatuses: snapshot.laneStatuses, blocks: snapshot.blocks || [] },
        );
        if (probe && probe.plan && probe.plan.reason) emptyMessage = probe.plan.reason;
      }
      // UNE FORMULE SANS ANCRE N A PAS DE COMBINAISON PAR DEFAUT : le client
      // choisit une heure d arrivee dans la liste, et rien avant ce clic ne dit
      // laquelle. Le tunnel redemande donc cette reponse avec `retainedTime`
      // une fois le creneau retenu ; sans ce parametre, aucune carte, jamais
      // une carte jugee sur une heure que le client n a pas choisie.
      const heureRetenue = String(url.searchParams.get('retainedTime') || '').slice(0, 5);
      respondFormula(
        guardedSlots,
        guardedSlots.length ? '' : emptyMessage,
        [],
        /^\d{1,2}:\d{2}$/.test(heureRetenue)
          ? (guardedSlots.find((slot) => slot.time === heureRetenue) || null)
          : null,
      );
      return;
    }

    if (type === 'laser') {
      const slotsByTime = new Map();
      const candidateMinutes = new Set();

      // Départs Laser proposés au client : uniquement aux heures pleines ou
      // demies (grille :00/:30), on recale la borne basse si la config l'a
      // désalignée.
      const laserMinTime = Math.ceil(minTime * 2) / 2;
      for (let value = laserMinTime; value <= maxTime; value += 0.5) {
        candidateMinutes.add(Math.round(value * 60));
      }

      // Sessions partagées existantes : on ne propose de les rejoindre que si
      // leur départ tombe sur la grille client :00/:30 (les sessions décalées
      // par le staff restent gérables en interne, jamais proposées au client).
      snapshot.reservations
        .flatMap(laserWindowsFromReservation)
        .forEach((window) => {
          const startMinute = Math.round(Number(window.start || 0));
          if (startMinute % PROGRAM_GRID_MINUTES !== 0) return;
          if (startMinute >= Math.round(laserMinTime * 60) && startMinute <= Math.round(maxTime * 60)) {
            candidateMinutes.add(startMinute);
          }
        });

      for (const startMinute of [...candidateMinutes].sort((left, right) => left - right)) {
        const startTime = numToTime(startMinute / 60);
        const plan = planningAgent(
          {
            centerId,
            date,
            type,
            pax,
            startTime,
            duration,
            laserGames: laserOption.games,
            preference: {
              arrivalConfidence: pax >= 12 ? 'uncertain' : 'normal',
            },
          },
          {
            reservations: snapshot.reservations,
            laneStatuses: snapshot.laneStatuses,
            blocks: snapshot.blocks || [],
          },
        );
        const recommended = plan?.plan?.recommended;
        if (!recommended || !recommended.ok) continue;
        if (!slotsByTime.has(recommended.startTime)) {
          slotsByTime.set(recommended.startTime, toLaserSlot(recommended, pax));
        }
      }

      const slots = filterSlotsByFinalGuards(
        [...slotsByTime.values()].sort((left, right) => timeToNum(left.time) - timeToNum(right.time)),
        {
          centerId,
          date,
          type,
          formuleId: '',
          pax,
          duration,
          totalDuration,
          laneCount: 0,
          requiresLanes: false,
          label: `${laserOption.label} Laser Game`,
          laserGames: laserOption.games,
          snapshot,
        },
      );
      sendJson(res, 200, {
        ok: true,
        date,
        ...scheduleMeta,
        slots,
        laneCount: 0,
        duration,
        totalDuration,
        price: getBasePrice(type, duration, 0, pax, '', centerId),
        requiresLanes: false,
        label: `${laserOption.label} Laser Game`,
        laserGames: laserOption.games,
        message: slots.length ? '' : 'Aucun départ Laser Game disponible pour ces critères.',
      });
      return;
    }

    // Bowling classique : départs uniquement aux heures pleines ou demies
    // (grille :00/:30), on recale la borne basse si la config l'a désalignée.
    minTime = Math.ceil(minTime * 2) / 2;
    const blocks = snapshot.blocks || [];
    // Le bowling standalone ne passe PAS par le moteur (planningAgent) : il
    // faut donc y lire ici l'activation permanente 'bowling' (activityAvailability,
    // le on/off no-code du centre) que le moteur applique deja au laser. Decocher
    // le bowling => aucun creneau. Sans config le defaut reste actif (inchange).
    const bowlingActivityOff = centerDoc && centerDoc.activityAvailability
      && centerDoc.activityAvailability.bowling === false;
    const slots = [];
    if (!bowlingActivityOff) {
      for (let value = minTime; value <= maxTime; value += 0.5) {
        const startTime = numToTime(value);
        const startMin = Math.round(value * 60);
        const endMin = startMin + Math.round(Number(totalDuration || duration) * 60);
        // Centre ferme (scope 'center') a l'heure du depart, ou activite 'bowling'
        // bloquee (scope 'activity') sur la fenetre : creneau retire. Sans blocage
        // (liste vide) les predicats rendent false : grille strictement identique.
        if (isCenterClosedDuring(blocks, date, startMin, endMin)) continue;
        if (isActivityBlockedAt(blocks, date, 'bowling', startMin, endMin)) continue;
        const lanes = requiresLanes
          ? allocateLanes(laneCount, snapshot.reservations, snapshot.laneStatuses, startTime, duration, centerLaneCount, blocks, date)
          : [];

        if (!requiresLanes || lanes !== null) {
          slots.push({
            time: startTime,
            lanes: lanes || [],
            freeCount: getFreeCount(snapshot.reservations, snapshot.laneStatuses, startTime, duration, centerLaneCount, blocks, date),
          });
        }
      }
    }

    sendJson(res, 200, {
      ok: true,
      date,
      ...scheduleMeta,
      slots,
      laneCount,
      duration,
      totalDuration,
      price: getBasePrice(type, duration, laneCount, pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }),
      requiresLanes,
      label: type === 'formule' ? formule.name : 'Bowling Classique',
      message: slots.length ? '' : 'Aucun créneau disponible pour ces critères.',
    });
  } catch (error) {
    // Même politique que staff-reservations : les messages métier (français,
    // contrôlés) passent, les erreurs d'infrastructure (Postgres/Neon/réseau)
    // ne fuient jamais vers le public : on les log et on renvoie un 503 neutre.
    const raw = String((error && error.message) || '');
    const isInfra = !raw || /tuple concurrently|data transfer quota|ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated|relation .* does not exist|column .* does not exist|SQLSTATE|deadlock|current transaction is aborted/i.test(raw);
    if (isInfra) {
      console.error('[public-availability] échec', error && (error.stack || raw || error));
      sendError(res, 503, 'Disponibilités momentanément indisponibles. Réessayez dans un instant.');
      return;
    }
    sendError(res, 400, raw);
  }
};
