const {
  FORMULES,
  LASER_GAME_OPTIONS,
  currentTimeDecimal,
  getBasePrice,
  getBowlingGameOptions,
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
  mesurerLaVisite,
  buildDefaultAnchorTimes,
  evaluateAnchoredCombination,
  getFormulaAnchorAvailability,
  getFormulaAnchorModel,
  getOperationalBowlingConfig,
  plancherDuJour,
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
const { attenteDesTours, buildProgramFormula, describeProgram, groupIsSplit, normalizeProgram } = require('../lib/visit-program');
const { activityMinPax } = require('../lib/activity-catalog');
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
  // Une ligne a installations (tables de billard, pistes de duckpin) : leur
  // nombre, la duree, et les tours d un groupe plus grand que la dotation.
  // Le mot vient du catalogue (« par table et par heure », « par piste »).
  const heures = Number(item.hours) || Number(item.duration) || 0;
  if (item.units && heures) {
    const label = Number.isInteger(heures) ? `${heures} h` : `${Math.floor(heures)} h ${String(Math.round((heures - Math.floor(heures)) * 60)).padStart(2, '0')}`;
    const units = Math.trunc(Number(item.units)) || 1;
    const mot = (/par ([a-zà-ÿ]+)/i.exec(String(item.unitLabel || '')) || [])[1] || 'table';
    const tours = Math.max(1, Math.trunc(Number(item.sessions) || 1));
    const nombre = `${units} ${mot}${units > 1 ? 's' : ''}`;
    return tours > 1 ? `${nombre} · ${tours} tours de ${label}` : `${nombre} · ${label}`;
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
    if (bookingDateOutOfRange(date) === 'invalid') {
      sendJson(res, 400, { ok: false, message: 'Date invalide. Choisissez une date du calendrier.' });
      return;
    }
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
    // LA DUREE DE CHAQUE FORMULE, pour ses cartes (Movsar, 2026-09-30 : « mettre
    // le temps que ca dure chaque formule »). Les plans que le tunnel propose
    // ce jour-la a ce groupe, sur une journee VIDE : la duree d une formule ne
    // depend pas des reservations des autres. Le meme code que l agent mail
    // (proposedArrivals). Un groupe sous le minimum d une formule se mesure au
    // minimum : sa carte dit deja pourquoi elle ne se prend pas, la duree reste
    // vraie. Une formule a fenetre ouverte (MATIN MALIN, KIDS FUN DAY) n a pas
    // de duree, elle a une plage, deja ecrite sur sa carte.
    if (rawType === 'durees') {
      const { proposedArrivals, dureesSurPlace } = require('../lib/availability-slots');
      const durees = {};
      const formulaAvailability = {};
      let liveSnapshot = null;
      for (const f of getEffectiveFormules(centerId)) {
        const document = getFormula(f.id);
        const calendar = getFormuleAvailability(f, date, pax, '', centerDoc);
        if (!calendar.ok) formulaAvailability[f.id] = { available: false, reason: calendar.message, code: 'calendar' };
        if (!document) continue;
        if (String(document.orderPolicy || '') === 'open_window') {
          if (!calendar.ok) continue;
          const schedule = getSchedule(date, centerDoc);
          const window = schedule && getFormuleArrivalWindow(f, schedule);
          let reason = !schedule ? 'Le centre est fermé à cette date.' : '';
          let slots = [];
          if (schedule && window) {
            const minTime = Math.max(window.earliestStart, date === todayStr() ? roundUpHalfHour(currentTimeDecimal()) : window.earliestStart);
            const maxTime = window.latestStart;
            if (minTime > maxTime) reason = `${f.name} : plus aucune arrivée disponible avant ${numToTime(Number(f.timeLimit?.max || schedule.close))}.`;
            else {
              liveSnapshot ||= await readAvailabilitySnapshot(date, centerId, { saufJeton: String(req.headers['x-pinlane-hold'] || '').trim() });
              const duration = getFormuleLaneDuration(f);
              const guardContext = { centerId, date, type: 'formule', formuleId: f.id, pax, duration, totalDuration: formulaOccupiedDuration(f, schedule), laneCount: getRequiredLaneCount('formule', pax, f.id, centerDoc.resources.bowling), requiresLanes: reservationNeedsLanes('formule', f.id), label: f.name, snapshot: liveSnapshot };
              slots = plannedArrivalSlots({ centerId, date, type: 'formule', formuleId: f.id, pax, duration, minTime, maxTime, preference: { arrivalConfidence: 'normal' }, pauseMinutes: 0, snapshot: liveSnapshot, guardContext });
              if (isFormulaFullyBlockedOn(liveSnapshot.blocks || [], date, f.id)) slots = [];
              if (!slots.length) reason = `${f.name} : aucune arrivée disponible pendant la période de cette formule.`;
            }
          }
          formulaAvailability[f.id] = { available: slots.length > 0, reason, code: slots.length ? '' : 'no_slots' };
          continue;
        }
        const groupe = Math.max(pax, Math.trunc(Number(f.minPax) || 1));
        // Un jour ou la formule ne se prend pas (ses jours, les vacances) : sa
        // duree se lit au prochain jour ou elle se prend, 14 jours au plus. Ce
        // qu elle dure tient a ce qu elle contient, pas au jour ; sa carte dit
        // deja pourquoi elle ne se prend pas ce jour-la.
        let d = null;
        for (let decalage = 0; decalage <= 14 && !d; decalage += 1) {
          const [an, mois, jour] = date.split('-').map(Number);
          const ce = decalage ? new Date(Date.UTC(an, mois - 1, jour + decalage)).toISOString().slice(0, 10) : date;
          d = dureesSurPlace(proposedArrivals({ centerId, date: ce, formule: f, pax: groupe, blocks: [], avecPlan: true }));
        }
        if (d) durees[f.id] = d;
      }
      sendJson(res, 200, { ok: true, date, pax, durees, formulaAvailability });
      return;
    }
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
    // `softReserve=1` (formulaire Fun Galaxy) : le temps des activites libres
    // est un conseil, pas un interdit ; les heures qui le rognent restent
    // valables avec un avertissement, et la visite finit a la fermeture.
    const reserveSoft = url.searchParams.get('softReserve') === '1';
    let preferredTimes = {};
    try {
      preferredTimes = JSON.parse(String(url.searchParams.get('preferredTimes') || '{}')) || {};
    } catch (error) {
      preferredTimes = {};
    }
    // Panier de la visite. JSON malforme = panier vide (message clair), jamais
    // une 500 : cet endpoint est public et sa robustesse prime sur le diagnostic.
    let programInput = [];
    let upsellChoices = {};
    try { const rawChoices = JSON.parse(String(url.searchParams.get('upsellChoices') || '{}')); if (rawChoices && !Array.isArray(rawChoices) && typeof rawChoices === 'object' && Object.keys(rawChoices).length <= 6) upsellChoices = rawChoices; } catch (_) { /* Invalid optional choices do not alter the requested booking. */ }
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
    // L HEURE D ARCADE CHOISIE (2026-10-13), avec une heure d arrivee : le
    // moteur la pose a cette heure-la (lib/ops-engine.js poserArrivee).
    let heureArcade = /^\d{1,2}:\d{2}$/.test(String(url.searchParams.get('arcade') || '').trim())
      ? String(url.searchParams.get('arcade')).trim()
      : '';
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

    // UNE HEURE POSEE DEVENUE PASSEE (2026-09-30). Le client qui hesite au
    // passage de l heure garde une heure que le moteur refuse (elle commence
    // avant le plancher du jour : maintenant + delai) ; CHAQUE autre heure
    // disait alors « Fin après 22:00 », une raison fausse, et le message
    // parlait de « formule » pour une visite. L heure passee sort de la
    // demande, le moteur repropose, et la reponse la nomme (`heuresPassees`)
    // : le formulaire la retire a son tour et le dit sur la piste.
    const plancher = plancherDuJour(date);
    if (plancher !== null && preferredTimes && typeof preferredTimes === 'object') {
      const passee = (t) => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t) && Math.round(timeToNum(t) * 60) < plancher;
      const heuresPassees = [];
      Object.keys(preferredTimes).forEach((id) => {
        if (id === 'laser_game' || !passee(preferredTimes[id])) return;
        heuresPassees.push({ activityId: id, time: preferredTimes[id] });
        delete preferredTimes[id];
      });
      const partiesPassees = new Set(laserGameTimes.filter(passee));
      if (passee(preferredTimes.laser_game)) partiesPassees.add(preferredTimes.laser_game);
      if (partiesPassees.size) {
        [...partiesPassees].sort().forEach((t) => heuresPassees.push({ activityId: 'laser_game', time: t }));
        laserGameTimes = laserGameTimes.filter((t) => t && !passee(t));
        if (laserGameTimes.length) preferredTimes.laser_game = laserGameTimes[0];
        else delete preferredTimes.laser_game;
      }
      if (passee(heureArcade)) {
        heuresPassees.push({ activityId: 'arcade_time', time: heureArcade });
        heureArcade = '';
      }
      if (heuresPassees.length) scheduleMeta.heuresPassees = heuresPassees;
    }

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

    // LES HORAIRES RETENUS PAR D AUTRES CLIENTS en train de reserver comptent
    // comme pris (migration 0049) ; ceux du client qui demande, non : il
    // revient sur la page des horaires et retrouve son propre choix libre.
    // Le jeton voyage dans un en-tete, jamais dans l adresse (journaux).
    const saufJeton = String(req.headers['x-pinlane-hold'] || '').trim();
    const snapshot = await readAvailabilitySnapshot(date, centerId, { saufJeton });
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
      const lignesDemandees = Array.isArray(programInput) ? programInput : (programInput && programInput.items) || [];
      const groupeScinde = groupIsSplit({ centerId, pax, items: lignesDemandees });
      // L ATTENTE D UNE ACTIVITE LIBRE QUI TOURNE (duckpin en tours, Fun Run en
      // sessions) : la meme pour tous les creneaux, elle ne depend que du
      // groupe et du programme. Celle des vagues d une activite planifiee se lit
      // sur le plan de chaque creneau ; la plus longue des deux compte.
      const attenteTours = attenteDesTours({ centerId, pax, items: lignesDemandees });
      const laPlusLongue = (a, b) => (!a ? b : !b ? a : (Number(b.minutes) > Number(a.minutes) ? b : a));
      const program = normalizeProgram(programInput, {
        centerId,
        pax,
        bowlingConfig: operationalBowlingConfig || centerBowlingConfig,
        dateStr: date,
        waitOffers: groupeScinde,
        publicBooking: true,
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
      // La mesure elle-meme vit dans le moteur (mesurerLaVisite) : la fenetre
      // Reserver de l equipe lit la meme fin que le client (2026-10-13). Les
      // trous entre les activites a creneau y absorbent le libre, moins ce que
      // les parties de laser jouees dans la foulee y prennent deja (Movsar :
      // « il ne compte pas les activités qui sont dans la foulée »).
      const mesureDeVisite = (slot) => {
        if (!slot || !slot.time) return null;
        const plan = slot.opsPlan || null;
        return mesurerLaVisite({
          debut: Math.round(timeToNum(slot.time) * 60),
          plan,
          libre: reserveAffichee,
          attenteLibre: program.waitMinutes,
          creux: laPlusLongue(attenteDuSousGroupe(plan && plan.resourceBlocks), attenteTours),
        });
      };
      const finDeVisiteMinutes = (slot) => {
        const mesure = mesureDeVisite(slot);
        return mesure ? mesure.apresLePlan + mesure.libreApres : null;
      };
      // CE QUI NE TIENDRA PAS, NOMME (Movsar, 2026-10-01 : « faut dire ce qui
      // sera pas possible de jouer [...] quand y plusieurs comme ça faut dire
      // tout ce qui se jouera pas et les heures choisi doivent etre
      // laisser »). Les heures de bowling et de laser restent celles du plan :
      // ce qui saute, ce sont les activites sans heure, dans l ordre du
      // programme, des que le temps qui reste avant la fermeture ne suffit
      // plus (une plus courte, plus loin, peut encore tenir). Une partie a
      // heure qui finirait apres la fermeture (le laser joue a la suite ne
      // ferme jamais une heure) est nommee aussi. Meme mesure que la fin.
      const ceQuiNeTiendraPas = (slot, fermeture) => {
        const mesure = mesureDeVisite(slot);
        if (!mesure) return [];
        const hors = [];
        const vues = new Set();
        const nomPlanifie = (id) => ((program.plannedItems || []).find((item) => item.activityId === id) || {}).name || id;
        const partiesDe = (id) => Math.max(1, Number(((program.plannedItems || []).find((item) => item.activityId === id) || {}).games) || 1);
        ((slot.opsPlan && slot.opsPlan.resourceBlocks) || []).forEach((bloc) => {
          if (!bloc || !bloc.endTime || bloc.resourceType === 'soft_capacity') return;
          const finBloc = Math.round(timeToNum(bloc.endTime) * 60);
          const cle = `${bloc.activityId}#${bloc.countIndex || 1}`;
          if (!(finBloc > fermeture) || vues.has(cle)) return;
          vues.add(cle);
          hors.push({
            activityId: bloc.activityId,
            name: nomPlanifie(bloc.activityId),
            ...(partiesDe(bloc.activityId) > 1 ? { partie: Number(bloc.countIndex) || 1 } : {}),
            heure: bloc.startTime,
          });
        });
        // Les parties de laser sans heure se jouent a la suite, en fin de plan
        // (laserPassPlan.followOnMinutes, compte dans sa fin) : celles qui
        // finiraient apres la fermeture ne se joueront pas.
        const passes = (slot.opsPlan && slot.opsPlan.laserPassPlan) || null;
        const enAttente = (passes && Array.isArray(passes.pendingPasses)) ? passes.pendingPasses : [];
        const aLaSuite = Math.max(0, Number(passes && passes.followOnMinutes) || 0);
        if (enAttente.length && aLaSuite > 0) {
          const parPartie = aLaSuite / enAttente.length;
          const depart = mesure.apresLePlan - aLaSuite;
          enAttente.forEach((partie, rang) => {
            if (depart + (rang + 1) * parPartie > fermeture) {
              hors.push({ activityId: 'laser_game', name: nomPlanifie('laser_game'), partie: Number(partie.countIndex) || rang + 2, sansHeure: true });
            }
          });
        }
        const placeApres = Math.max(0, fermeture - mesure.apresLePlan);
        let place = Math.max(0, reserveAffichee - Math.max(0, mesure.libreApres - placeApres));
        (program.freeItems || []).forEach((item) => {
          const minutes = Math.max(0, Math.round(Number(item.minutes) || 0));
          if (minutes <= place) {
            place -= minutes;
            return;
          }
          hors.push({ activityId: item.activityId, name: item.name || item.activityId, minutes, ...(item.dayAccess ? { dayAccess: true } : {}) });
        });
        return hors;
      };
      // UNE INSTALLATION COMPTEE SE JUGE A L ECRAN DES HEURES (audit du
      // 2026-09-28 : le duckpin complet ne se decouvrait qu au clic final, en
      // 409, le formulaire rempli). La garde de dotation de la validation
      // (lib/reservation-ops, dotationDepassee) juge ici chaque heure
      // proposee, sur la fenetre de visite que le client lit : une heure ou
      // les pistes de duckpin ou les tables de billard sont prises ne
      // s affiche plus. La MEME fonction que la validation, jamais une copie.
      // Une garde qui jette laisse l heure : la validation, elle, tranchera.
      const dureeDuProgramme = Math.max(30, program.items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0));
      const dotationDuCreneau = (slot, fin, programme = program) => {
        if (!slot || !slot.time) return '';
        const debut = Math.round(timeToNum(slot.time) * 60);
        const minutes = Number.isFinite(fin) && fin > debut ? fin - debut : dureeDuProgramme;
        try {
          return require('../lib/reservation-ops').dotationDepassee(
            { centerId, program: programme, pax, startTime: slot.time, totalDuration: minutes / 60, opsPlan: slot.opsPlan || null },
            snapshot.reservations || [],
          );
        } catch (error) {
          return '';
        }
      };
      // LA MEME GARDE, HEURE PAR HEURE (campagne du 2026-09-29). Chaque heure de
      // la grille se juge sur la visite que SON plan pose (lib/ops-engine,
      // visitFeasibilityAt), avec la fenetre de finDeVisiteMinutes, comme la
      // validation : une heure « rien ne coince » ne tombe plus ensuite sur
      // « Duckpin complet », et l heure proposee d office tient.
      // Les installations qui ont ferme au moins une heure : quand plus aucune
      // ne reste, le message les nomme au lieu d un « aucune combinaison ».
      const installationsPleines = new Set();
      const gardeDesInstallations = (scenario) => {
        if (!scenario || !scenario.startTime) return '';
        const slot = { time: scenario.startTime, opsPlan: { endTime: scenario.endTime, bufferMinutes: scenario.bufferMinutes, resourceBlocks: scenario.resourceBlocks || [], laserPassPlan: scenario.laserPassPlan || null } };
        const pleine = dotationDuCreneau(slot, finDeVisiteMinutes(slot));
        if (pleine) installationsPleines.add(pleine);
        return pleine;
      };
      const respondVisit = (slots, message, extra = {}) => {
        const liste = Array.isArray(slots) ? slots : [];
        const completes = [];
        const creneaux = liste.filter((slot) => {
          const complete = dotationDuCreneau(slot, finDeVisiteMinutes(slot));
          if (complete) completes.push(complete);
          return !complete;
        }).map((slot) => {
          const fin = finDeVisiteMinutes(slot);
          if (fin === null) return slot;
          // LA VISITE PEUT DEBORDER LA FERMETURE : en mode souple, et quand
          // les parties de laser jouees a la suite la depassent (elles ne
          // ferment jamais une heure). La fin affichee s arrete a la
          // fermeture, et le manque est dit a part (`visitShortfallMinutes`),
          // pour que l ecran l explique.
          const fermeture = Math.round(Number(schedule.close) * 60);
          if (Number.isFinite(fermeture) && fermeture > 0 && fin > fermeture) {
            return {
              ...slot,
              visitEndTime: numToTime(fermeture / 60),
              visitEndsAtClose: true,
              visitShortfallMinutes: fin - fermeture,
              visitShortfallItems: ceQuiNeTiendraPas(slot, fermeture),
            };
          }
          return { ...slot, visitEndTime: numToTime(fin / 60) };
        });
        sendJson(res, 200, {
          ok: true,
          date,
          ...scheduleMeta,
          slots: creneaux.map((slot) => {
            const quote = require('../lib/bowling-allocation').bowlingPlanQuote(program, slot.opsPlan, { centerId, dateStr: date, bowlingConfig: centerBowlingConfig });
            return quote.billedLaneCount ? { ...slot, ...quote, price: quote.program.price } : slot;
          }),
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
          // Toutes les heures proposees tombaient sur une installation deja
          // prise : on nomme laquelle, et les complements calcules pour un
          // creneau qui ne s affiche plus partent avec lui.
          ...(!creneaux.length && completes.length ? {
            message: liste.length > 1
              ? `${completes[0]} : complet ce jour-là. Essayez une autre date.`
              : `${completes[0]} : complet pendant votre visite. Choisissez une autre heure.`,
            complements: [],
          } : {}),
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
      // Une activite sous son minimum de joueurs (le laser se joue a deux) ne
      // se planifie pas : on le dit au lieu de rendre une liste vide muette.
      const sousMinimum = program.items.find((item) => Number(item.belowMinPax) > 0);
      if (sousMinimum) {
        respondVisit([], `${sousMinimum.name} se joue à ${sousMinimum.belowMinPax} joueurs minimum.`);
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
            reserveSoft,
            gardeDeVisite: gardeDesInstallations,
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
              participants: item.participants ?? pax,
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
        const attenteDuPlan = (retainedSlot) => laPlusLongue(
          attenteDuSousGroupe(retainedSlot && retainedSlot.opsPlan ? retainedSlot.opsPlan.resourceBlocks : null),
          attenteTours,
        );
        const complementsDeVisite = (retainedSlot) => {
          try {
            return buildVisitComplements({
              centerId,
              date,
              pax,
              program,
              retainedSlot,
              upsellChoices,
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
                // Une table ou une piste que d autres dossiers tiennent deja ne se
                // propose pas en complement : la validation la refuserait. La
                // fenetre jugee est celle de la visite AGRANDIE du complement.
                if (retainedSlot && retainedSlot.time) {
                  const debutRetenu = Math.round(timeToNum(retainedSlot.time) * 60);
                  const minutesCandidat = (candidat.items || []).reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
                  const finCandidat = Math.max(Number(finDeVisiteMinutes(retainedSlot)) || 0, debutRetenu + minutesCandidat);
                  if (dotationDuCreneau(retainedSlot, finCandidat, candidat)) return false;
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
              // LA MEME SOUPLESSE QUE LA GRILLE (Movsar, 2026-10-01 : « ça
              // montre impossible mais quand on coche une heure ça montre que
              // c possible »). La grille marquait ces heures « serrees », et la
              // combinaison proposee d office les refusait faute de ce drapeau.
              reserveSoft,
              reservations: snapshot.reservations,
              laneStatuses: snapshot.laneStatuses,
              blocks: snapshot.blocks || [],
            })
            : null;
          const gardes = defaultCombo && defaultCombo.ok
            ? filterSlotsByFinalGuards(
              [toFormulaSlot(defaultCombo.scenario, snapshot, program.plannedItems[0]?.duration || 0)],
              { ...guardContext, laneCount: plannedLaneCount(defaultCombo.scenario, program.laneCount) },
            )
            : [];
          // LE MODE SOUPLE NE VEND PAS UNE INSTALLATION PLEINE. Une activite
          // complete toute la journee « tient » apres la fermeture, la ou plus
          // rien ne la bloque : la combinaison proposee d office ne s appuie
          // jamais sur ce trou. Elle laisse alors le message qui nomme
          // l installation pleine (gate tours-dotation-check).
          const fermetureDuJour = Math.round(Number(schedule.close) * 60);
          const defaultSlots = gardes.filter((slot) => {
            const fin = finDeVisiteMinutes(slot);
            if (!(fin > fermetureDuJour) || !installationsPleines.size) return true;
            return !ceQuiNeTiendraPas(slot, fermetureDuJour).some((h) => installationsPleines.has(h.name));
          });
          respondVisit(
            defaultSlots,
            defaultSlots.length ? '' : (installationsPleines.size
              ? `${[...installationsPleines][0]} : complet ce jour-là. Essayez une autre date.`
              : 'Aucune combinaison disponible ce jour-là. Essayez une autre date ou un autre groupe.'),
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
            timeline: program.items.map((item) => ({ type: 'activity', activityId: item.activityId, label: item.name, players: item.participants ?? pax })),
            // Des blocs en capacite SOUPLE : ils disent au staff ce que le
            // groupe vient faire sans jamais occuper piste ni arene. C'est aussi
            // ce qui fait tomber la reservation dans l'onglet hors planning.
            resourceBlocks: program.items.map((item, index) => ({
              resourceType: 'soft_capacity',
              activityId: item.activityId,
              players: item.participants ?? pax,
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
      // LA FORMULE PAR HEURE D ARRIVEE (2026-10-12). `arrival=HH:MM` : le
      // programme qui commence a cette heure (le groupe fait d abord le libre
      // de la formule, puis le bowling et le laser des qu ils sont libres).
      // `arrivals=1` : chaque heure d arrivee de la journee, son verdict et le
      // resume de son programme, jugee avec les heures deja posees. Sans ces
      // deux parametres, rien ne change. Avec `arrival`, la grille par activite
      // (anchorMeta) se juge AVEC l arrivee (2026-10-13, plus bas) ; la liste
      // seule ne la calcule pas.
      const heureArrivee = String(url.searchParams.get('arrival') || '').trim().slice(0, 8);
      const listeArrivees = url.searchParams.get('arrivals') === '1';
      // `arcades=1` avec `arrival` (2026-10-13) : les heures d arcade de cette
      // arrivee, chacune jugee par la porte de la reservation. Seules : ni la
      // grille des activites ni le plan, que la demande sans elle rend deja.
      const listeArcades = url.searchParams.get('arcades') === '1' && Boolean(heureArrivee);
      const demandeArrivee = Boolean(heureArrivee) || listeArrivees;
      let anchorMeta = null;
      try {
        anchorMeta = (listeArrivees && !heureArrivee) || listeArcades ? null : getFormulaAnchorAvailability({ centerId, formuleId, date, pax, preferredTimes, laserGameTimes }, engineContext);
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
      // LA FIN D UNE FORMULE SE DIT COMME CELLE D UNE VISITE (Movsar,
      // 2026-09-29 : « le truc pour compter l heure est foire ») : sans la
      // marge de risque de l equipe, que `opsPlan.endTime` contient, et
      // arretee a la fermeture quand les parties de laser jouees a la suite la
      // depassent, le manque dit a part. L ecran annoncait la marge comme du
      // temps de visite.
      const finDeFormule = (slot) => {
        const plan = slot && slot.opsPlan;
        if (!plan || !plan.endTime || !slot.time) return slot;
        const debut = Math.round(timeToNum(slot.time) * 60);
        const fin = Math.max(debut, Math.round(timeToNum(plan.endTime) * 60) - Math.max(0, Number(plan.bufferMinutes) || 0));
        const fermeture = Math.round(Number(schedule && schedule.close) * 60);
        if (Number.isFinite(fermeture) && fermeture > 0 && fin > fermeture) {
          return { ...slot, visitEndTime: numToTime(fermeture / 60), visitEndsAtClose: true, visitShortfallMinutes: fin - fermeture };
        }
        return { ...slot, visitEndTime: numToTime(fin / 60) };
      };
      // `extra` : les cles de la formule par heure d arrivee, ajoutees en fin de
      // reponse et seulement quand elle est demandee.
      const respondFormula = (slots, message, suggestions = [], retainedSlot = null, extra = {}) => {
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
          slots: (Array.isArray(slots) ? slots : []).map(finDeFormule).map((slot) => {
            const quote = require('../lib/bowling-allocation').bowlingPlanQuote(null, slot.opsPlan);
            return quote.billedLaneCount ? { ...slot, ...quote,
              price: getBasePrice(type, duration, quote.billedLaneCount, pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }) } : slot;
          }),
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
          ...extra,
        });
      };

      if (demandeArrivee) {
        // Chaque heure se juge par la porte de la reservation (le moteur avec
        // l arrivee, puis la garde finale) : lib/availability-slots,
        // formulaArrivalEntries. La liste et l heure seule disent donc la meme
        // chose que le POST qui suivra.
        const { formulaArrivalEntries, formulaArrivalAnchorGrid } = require('../lib/availability-slots');
        const { listFormulaArrivalTimes, FORMULA_ARRIVAL_MINUTES, minutesToTime } = require('../lib/ops-engine');
        const { formulaVisitOf } = require('../lib/formula-visit');
        const reglage = formulaVisitOf(centerDoc);
        const gardeDuPlan = (scenario) => ({ ...guardContext, laneCount: plannedLaneCount(scenario, laneCount) });
        const sansCreneau = ({ slot: _slot, ...entree }) => entree;
        // Les heures deja posees par le client restent les siennes : seules
        // les autres se cherchent. La liste des arrivees se juge AVEC elles
        // (2026-10-13) : le bowling pose a 14:00, l arrivee de 10:00 dit son
        // attente au lieu d une visite qui ne serait plus la sienne.
        const posees = {
          preferredTimes,
          ...(laserGameTimes.length ? { laserGameTimes } : {}),
          laserPlacement: String(url.searchParams.get('laserPlacement') || '') === 'onsite' ? 'onsite' : 'scheduled',
          ...(heureArcade ? { arcadeTime: heureArcade } : {}),
        };
        // LE DERNIER CHOIX GAGNE (Movsar, 2026-10-13 : « c est vraiment pas
        // normal de pouvoir choisir aucun horaire »). Une arrivee se juge avec
        // les heures posees qui restent apres elle et ses dix minutes
        // d accueil ; celles d avant, l ecran les libere quand le client la
        // choisit, et l entree le dit (`releases`). Juger toute la liste avec
        // le bowling pose a 13:00 disait « trop tard » a toutes les arrivees
        // de l apres-midi.
        const minutesDe = (texte) => {
          const m = /^(\d{1,2}):(\d{2})$/.exec(String(texte || ''));
          return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
        };
        const poseesApres = (heure) => {
          const seuil = minutesDe(heure) + FORMULA_ARRIVAL_MINUTES;
          const garde = (texte) => !(minutesDe(texte) < seuil);
          const heures = {};
          const releases = [];
          Object.entries(preferredTimes || {}).forEach(([id, texte]) => {
            if (id === 'laser_game') return;
            if (garde(texte)) heures[id] = texte; else releases.push(id);
          });
          const parties = laserGameTimes.length ? laserGameTimes : (preferredTimes.laser_game ? [preferredTimes.laser_game] : []);
          const partiesGardees = parties.filter(garde);
          if (partiesGardees.length < parties.length) releases.push('laser_game');
          if (partiesGardees.length) heures.laser_game = partiesGardees[0];
          // Les arcades posees avant cette arrivee (ou pendant son accueil) se
          // liberent comme le reste : la frise les range.
          const { arcadeTime: _arcade, ...sansArcade } = posees;
          const arcadeGardee = Boolean(heureArcade) && garde(heureArcade);
          if (heureArcade && !arcadeGardee) releases.push('arcade_time');
          return {
            releases,
            preference: { ...sansArcade, preferredTimes: heures, ...(laserGameTimes.length ? { laserGameTimes: partiesGardees } : {}), ...(arcadeGardee ? { arcadeTime: heureArcade } : {}) },
          };
        };
        let journee = null;
        const toutesLesArrivees = () => {
          if (!journee) {
            const grille = listFormulaArrivalTimes({ centerId, formuleId, date });
            if (!grille.ok) {
              journee = [];
            } else {
              const memo = new Map();
              const parGroupe = new Map();
              grille.times.forEach((heure) => {
                const apres = poseesApres(heure);
                const cle = apres.releases.join(',');
                if (!parGroupe.has(cle)) parGroupe.set(cle, { ...apres, times: [] });
                parGroupe.get(cle).times.push(heure);
              });
              const verdicts = new Map();
              parGroupe.forEach((groupe) => {
                formulaArrivalEntries({ centerId, date, formuleId, pax, duration, preference: groupe.preference, times: groupe.times, snapshot, guardFor: gardeDuPlan, memo })
                  .forEach((entree, rang) => verdicts.set(groupe.times[rang], groupe.releases.length ? { ...entree, releases: groupe.releases } : entree));
              });
              journee = grille.times.map((heure) => verdicts.get(heure));
            }
          }
          return journee;
        };
        const extra = {
          arrivalBounds: {
            arrivalFirst: reglage.arrivalFirst,
            maxWaitMinutes: reglage.maxWaitMinutes,
            maxVisitMinutes: reglage.maxVisitMinutes,
            freeDurationPolicy: reglage.freeDurationPolicy,
            // Les minutes d accueil apres l arrivee : l ecran libere avec elles
            // les heures posees avant une arrivee choisie (poseesApres).
            welcomeMinutes: FORMULA_ARRIVAL_MINUTES,
          },
        };
        // LES HEURES D ARCADE D UNE ARRIVEE (Movsar, 2026-10-13 : « ils peuvent
        // choisir heure d arrivee mais aussi arcade [...] mettre arcade pendant
        // temps d attente »). De la fin de l accueil a la fermeture, sur la
        // grille ; chacune jugee par la porte de la reservation, avec les heures
        // posees. Une arcade sur une activite que le client a posee la libere (le
        // dernier choix gagne) : l entree le dit (`releases`, `conflict`) et se
        // juge sans elle, le moteur la replace autour des arcades.
        const lesHeuresDArcade = () => {
          const { freeStepHasTime, freeStepMinutes } = require('../lib/formula-visit');
          const { getActivity } = require('../lib/ops-knowledge');
          const modele = getFormulaAnchorModel(formulaDoc, { freeDurationPolicy: reglage.freeDurationPolicy });
          const etape = (modele.freeSteps || []).find((step) => freeStepHasTime(step, getActivity(step.activityId)?.durationModel));
          const arrivee = minutesDe(heureArrivee);
          if (!etape || !Number.isFinite(arrivee) || !schedule) return [];
          const duree = freeStepMinutes(etape, getActivity(etape.activityId)?.durationModel, reglage.freeDurationPolicy);
          const fermeture = Math.round(Number(schedule.close) * 60);
          const memo = new Map();
          const juger = (preference) => formulaArrivalEntries({ centerId, date, formuleId, pax, duration, preference, times: [heureArrivee], snapshot, guardFor: gardeDuPlan, memo })[0] || {};
          const resume = (time, verdict, conflit = null) => (verdict.ok
            ? { time, ok: true, ...(verdict.endTime ? { endTime: verdict.endTime } : {}), ...(verdict.warning ? { warning: verdict.warning } : {}), ...(conflit ? { releases: [conflit.activityId], conflict: conflit } : {}) }
            : { time, ok: false, code: verdict.code || 'arrival_none', reason: verdict.reason || 'Indisponible', shortReason: verdict.shortReason || 'Indisponible' });
          const sansLaPose = (preference, conflit) => {
            const heures = { ...(preference.preferredTimes || {}) };
            if (conflit.activityId !== 'laser_game') {
              delete heures[conflit.activityId];
              return { ...preference, preferredTimes: heures };
            }
            const parties = (preference.laserGameTimes || []).filter((partie) => partie && partie !== conflit.time);
            if (parties.length) heures.laser_game = parties[0]; else delete heures.laser_game;
            return { ...preference, preferredTimes: heures, ...(preference.laserGameTimes ? { laserGameTimes: parties } : {}) };
          };
          // La fin de l accueil d abord (10:10 pour une arrivee a 10:00) : les
          // arcades des l arrivee, quand les pistes et l arene sont pleines ;
          // puis la grille des demi-heures.
          const finAccueil = arrivee + FORMULA_ARRIVAL_MINUTES;
          const candidates = [];
          for (let t = Math.ceil(finAccueil / 30) * 30; t + duree <= fermeture; t += 30) candidates.push(t);
          if (finAccueil % 30 && finAccueil % 5 === 0 && finAccueil + duree <= fermeture) candidates.unshift(finAccueil);
          const liste = [];
          for (const t of candidates) {
            const time = minutesToTime(t);
            const essai = { ...posees, arcadeTime: time };
            const verdict = juger(essai);
            const conflit = verdict.ok ? null : verdict.conflict;
            const posee = Boolean(conflit) && (conflit.activityId === 'laser_game'
              ? (laserGameTimes.includes(conflit.time) || preferredTimes.laser_game === conflit.time)
              : Boolean(preferredTimes[conflit.activityId]));
            liste.push(!verdict.ok && verdict.code === 'arcade_overlap' && posee
              ? resume(time, juger(sansLaPose(essai, conflit)), conflit)
              : resume(time, verdict));
          }
          return liste;
        };
        if (listeArcades) {
          respondFormula([], '', [], null, { ...extra, arcadeTimes: reglage.arrivalFirst ? lesHeuresDArcade() : [] });
          return;
        }
        if (listeArrivees) {
          const entrees = reglage.arrivalFirst ? toutesLesArrivees() : [];
          extra.arrivals = entrees.map(sansCreneau);
          extra.firstAcceptableArrival = (entrees.find((entree) => entree.ok) || {}).time || null;
        }
        // ARRIVER PLUS TARD, MEME PROGRAMME (2026-10-13, Movsar : « des pop up
        // adaptées en fonction du temps libre »). L attente d avant la premiere
        // activite, quand rien ne la couvre, se rend au client : la plus tardive
        // des demi-heures (trois essais au plus) qui ne libere aucune heure
        // posee, garde le bowling et le laser aux memes heures et attend moins.
        // Chaque essai passe par la porte de la reservation, avec les heures
        // posees du client : c est la visite qu il aura en la touchant.
        const memoArrivee = new Map();
        const arriveePlusTard = (entree) => {
          const debut = minutesDe(entree.time) + FORMULA_ARRIVAL_MINUTES;
          const attente = (entree.frise || []).find((segment) => segment.kind === 'wait' && segment.placement === 'before' && minutesDe(segment.gapStartTime) === debut);
          if (!attente) return null;
          const memes = (autre) => JSON.stringify(autre.anchors || {}) === JSON.stringify(entree.anchors || {})
            && JSON.stringify(autre.laserGameTimes || []) === JSON.stringify(entree.laserGameTimes || []);
          let essais = 0;
          for (let k = Math.floor(Number(attente.minutes) / 30); k >= 1 && essais < 3; k -= 1) {
            const time = minutesToTime(minutesDe(entree.time) + 30 * k);
            const apres = poseesApres(time);
            if (apres.releases.length) continue;
            essais += 1;
            const [autre] = formulaArrivalEntries({ centerId, date, formuleId, pax, duration, preference: apres.preference, times: [time], snapshot, guardFor: gardeDuPlan, memo: memoArrivee });
            if (autre && autre.ok && memes(autre) && Number(autre.waitMinutes) < Number(entree.waitMinutes)) {
              return { time, waitMinutes: Number(autre.waitMinutes), savedMinutes: Number(entree.waitMinutes) - Number(autre.waitMinutes), ...(autre.endTime ? { endTime: autre.endTime } : {}) };
            }
          }
          return null;
        };
        if (heureArrivee) {
          const [entree] = formulaArrivalEntries({ centerId, date, formuleId, pax, duration, preference: posees, times: [heureArrivee], snapshot, guardFor: gardeDuPlan, memo: memoArrivee });
          // LES HEURES DES ACTIVITES RESTENT A CHOISIR (2026-10-13) : chacune
          // jugee avec cette arrivee et les autres heures posees, par la meme
          // porte. Le client change son bowling sans perdre son arrivee.
          // L heure proposee de chaque activite est celle du plan de CETTE
          // arrivee, aucune quand elle est refusee : celle de la journee sans
          // arrivee (bowling 10:00 pour une arrivee a 10:30) se disait
          // « proposé » sur une heure refusee.
          try {
            anchorMeta = formulaArrivalAnchorGrid({ centerId, date, formuleId, pax, duration, arrival: heureArrivee, preference: posees, anchorMeta, snapshot, guardFor: gardeDuPlan, proposees: entree.ok ? entree.anchors : null });
          } catch (error) {
            console.error('[public-availability] grille avec arrivee', error && (error.stack || error.message));
            anchorMeta = null;
          }
          if (entree.ok) {
            let plusTard = null;
            try {
              plusTard = arriveePlusTard(entree);
            } catch (error) {
              console.error('[public-availability] arrivee plus tard', error && (error.stack || error.message));
            }
            respondFormula([entree.slot], '', [], null, { ...extra, arrival: { ...sansCreneau(entree), ...(plusTard ? { later: plusTard } : {}) } });
            return;
          }
          // LA PREMIERE ARRIVEE QUI TIENT CE JOUR-LA, quand le refus tient a
          // la journee et pas a la demande elle-meme (centre qui ne propose
          // pas l arrivee, formule sans activite a heure fixe).
          const chercher = !['arrival_disabled', 'no_anchor', 'arrival_invalid'].includes(entree.code);
          const possibles = chercher ? toutesLesArrivees().filter((item) => item.ok) : [];
          const premiere = possibles.length ? possibles[0].time : null;
          const suivante = possibles.find((item) => item.time > (entree.time || '')) || null;
          const suite = !chercher ? '' : premiere ? ` Première arrivée possible ce jour-là : ${premiere}.` : ' Aucune arrivée possible ce jour-là.';
          respondFormula([], `${entree.reason}${suite}`, [], null, {
            ...extra,
            arrival: {
              ...sansCreneau(entree),
              ...(chercher ? { firstAcceptableTime: premiere, nextAcceptableTime: suivante ? suivante.time : null } : {}),
            },
          });
          return;
        }
        if (!reglage.arrivalFirst) {
          respondFormula([], 'La réservation par heure d’arrivée n’est pas proposée par ce centre.', [], null, extra);
          return;
        }
        respondFormula([], extra.firstAcceptableArrival ? '' : 'Aucune arrivée possible pour cette formule ce jour-là.', [], null, extra);
        return;
      }

      if (anchorModel.anchors.length) {
        const laserPlacement = String(url.searchParams.get('laserPlacement') || '') === 'onsite' ? 'onsite' : 'scheduled';
        const hasAnchorChoice = Boolean(preferredTimes.bowling || preferredTimes.laser_game)
          || laserGameTimes.some((time) => time) || laserPlacement === 'onsite';

        if (hasAnchorChoice) {
          // UNE HEURE CHOISIE N EN EXIGE PAS DEUX, EN FORMULE AUSSI (2026-09-29,
          // meme regle que la visite composee depuis l entretien Seb du
          // 2026-09-17, plus haut). Toucher une heure de laser dans la FORMULE 4
          // repondait « Choisissez une heure pour Bowling. » : la visite
          // disparaissait de l ecran et le bouton se grisait, alors que la
          // grille venait de dire l heure possible. L ancre restee libre prend
          // l heure que la grille propose, calculee avec les heures retenues
          // (anchorMeta.defaultTimes) : celle que l ecran montre deja en
          // proposition. Un laser place sur place n a pas d heure : il n en
          // recoit pas.
          const heuresCompletes = { ...preferredTimes };
          const defautsDeLaGrille = (anchorMeta && anchorMeta.ok && anchorMeta.defaultTimes) || {};
          ((anchorMeta && anchorMeta.activities) || []).forEach((activity) => {
            const id = activity.activityId;
            if (id === 'laser_game' && laserPlacement === 'onsite') return;
            if (!heuresCompletes[id] && defautsDeLaGrille[id]) heuresCompletes[id] = defautsDeLaGrille[id];
          });
          const partiesCompletes = laserGameTimes.some((time) => time) || laserPlacement === 'onsite'
            ? laserGameTimes
            : (heuresCompletes.laser_game ? [heuresCompletes.laser_game] : laserGameTimes);
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
                preferredTimes: heuresCompletes,
                laserGameTimes: partiesCompletes,
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
        if (date === todayStr() && minTime > maxTime) emptyMessage = `${formule.name} : plus aucune arrivée disponible avant ${numToTime(Number(formule.timeLimit?.max || schedule.close))}.`;
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
      // Le laser se joue a deux au moins : sous le minimum, aucun depart.
      const minimumLaser = activityMinPax(centerId, 'laser_game');

      // Départs Laser proposés au client : uniquement aux heures pleines ou
      // demies (grille :00/:30), on recale la borne basse si la config l'a
      // désalignée.
      const laserMinTime = Math.ceil(minTime * 2) / 2;
      for (let value = laserMinTime; pax >= minimumLaser && value <= maxTime; value += 0.5) {
        candidateMinutes.add(Math.round(value * 60));
      }

      // Sessions partagées existantes : on ne propose de les rejoindre que si
      // leur départ tombe sur la grille client :00/:30 (les sessions décalées
      // par le staff restent gérables en interne, jamais proposées au client).
      snapshot.reservations
        .flatMap(laserWindowsFromReservation)
        .forEach((window) => {
          if (pax < minimumLaser) return;
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
        message: pax < minimumLaser
          ? `Le laser game se joue à ${minimumLaser} joueurs minimum.`
          : (slots.length ? '' : 'Aucun départ Laser Game disponible pour ces critères.'),
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
        const allocation = requiresLanes ? require('../lib/bowling-allocation').allocateBowlingCapacity({ players: pax, config: centerBowlingConfig,
          requiredLanes: laneCount, durationMinutes: Math.round(duration * 60),
          allocate: (count) => allocateLanes(count, snapshot.reservations, snapshot.laneStatuses, startTime, duration, centerLaneCount, blocks, date) }) : null;
        const lanes = requiresLanes
          ? allocation?.lanes || null
          : [];

        if (!requiresLanes || lanes !== null) {
          slots.push({
            time: startTime,
            lanes: lanes || [],
            ...(allocation ? { ...allocation, laneCount: allocation.lanes.length,
              price: getBasePrice(type, duration, type === 'bowling' && getBowlingGameOptions(centerBowlingConfig, date, { pax, laneCount }) !== null ? laneCount : allocation.lanes.length, pax, formuleId, centerId, { bowlingConfig: centerBowlingConfig, dateStr: date }) } : {}),
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
