const { createOpsEvent, readStaffState } = require('./database');
const { planningAgent } = require('./ops-agents');
const { enqueueReservationCommunications } = require('./ops-communications');
const { enqueueReservationAutomation } = require('./ops-jobs');
const { normalizeReservationRequest } = require('./reservation-request');
const { shouldRequestHumanReview } = require('./validation-policy');
const { buildProgramFormula, normalizeProgram } = require('./visit-program');
const { getFormula } = require('./ops-knowledge');
const { getCenterActivity } = require('./activity-catalog');

function timeToMinutes(value) {
  const [hours, minutes = 0] = String(value || '0:00').split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function coerceMinute(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return timeToMinutes(value);
  return null;
}

function normalizeTimedItem(item) {
  if (!item || typeof item !== 'object') return item;
  const start = coerceMinute(item.start) ?? coerceMinute(item.startTime);
  const end = coerceMinute(item.end) ?? coerceMinute(item.endTime);
  if (start === null || end === null || end <= start) return item;
  return {
    ...item,
    start,
    end,
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    durationMinutes: Number(item.durationMinutes || end - start),
  };
}

function normalizeTrustedPlan(body, plan) {
  const resourceBlocks = Array.isArray(plan.resourceBlocks)
    ? plan.resourceBlocks.map(normalizeTimedItem)
    : [];
  const timeline = Array.isArray(plan.timeline)
    ? plan.timeline.map(normalizeTimedItem)
    : plan.timeline;
  const timedBlocks = resourceBlocks
    .map((block) => ({
      start: coerceMinute(block.start) ?? coerceMinute(block.startTime),
      end: coerceMinute(block.end) ?? coerceMinute(block.endTime),
      block,
    }))
    .filter((item) => item.start !== null && item.end !== null && item.end > item.start);
  const firstStart = timedBlocks.length ? Math.min(...timedBlocks.map((item) => item.start)) : null;
  const lastEnd = timedBlocks.length ? Math.max(...timedBlocks.map((item) => item.end)) : null;
  const bowlingBlocks = resourceBlocks.filter((block) => block.resourceType === 'bowling_lane');
  const laserBlocks = resourceBlocks.filter((block) => block.resourceType === 'laser_arena');
  const assignedLanes = [...new Set(bowlingBlocks.flatMap((block) =>
    (Array.isArray(block.lanes) ? block.lanes : [])
      .map((lane) => Number(lane))
      .filter((lane) => Number.isInteger(lane) && lane > 0)))];

  return {
    ...plan,
    startTime: firstStart !== null ? minutesToTime(firstStart) : plan.startTime,
    endTime: lastEnd !== null ? minutesToTime(lastEnd) : plan.endTime,
    totalMinutes: firstStart !== null && lastEnd !== null ? lastEnd - firstStart : Number(plan.totalMinutes || 0),
    resourceBlocks,
    timeline,
    assignedLanes: assignedLanes.length ? assignedLanes : plan.assignedLanes,
    firstBowlingTime: bowlingBlocks[0]?.startTime || plan.firstBowlingTime,
    firstLaserTime: laserBlocks[0]?.startTime || plan.firstLaserTime,
    staffSummary: plan.staffSummary || body.staffSummary || '',
  };
}

function isTrustedClientPlan(plan, body = {}) {
  if (!plan || typeof plan !== 'object') return false;
  if (!Array.isArray(plan.resourceBlocks) || !plan.resourceBlocks.length) return false;
  if (plan.startTime && body.startTime) {
    const bodyStart = String(body.startTime).slice(0, 5);
    const acceptedStarts = new Set([
      plan.startTime,
      plan.firstBowlingTime,
      plan.firstLaserTime,
      ...(plan.resourceBlocks || []).map((block) => block.startTime),
    ].filter(Boolean).map((value) => String(value).slice(0, 5)));
    const closeToPlannedStart = [...acceptedStarts].some((value) =>
      Math.abs(timeToMinutes(value) - timeToMinutes(bodyStart)) <= 15);
    if (!acceptedStarts.has(bodyStart) && !closeToPlannedStart) return false;
  }
  return plan.resourceBlocks.some((block) =>
    ['bowling_lane', 'laser_arena', 'party_table'].includes(block.resourceType)
    && (block.startTime || Number.isFinite(Number(block.start)))
    && (block.endTime || Number.isFinite(Number(block.end))),
  );
}

function buildTrustedClientPlanResult(body, plan) {
  const formulaId = body.formuleId || body.formulaId || plan.formulaId || '';
  const formulaName = body.type === 'laser'
    ? 'Laser Game'
    : body.label || plan.formulaName || '';
  const normalizedPlan = normalizeTrustedPlan(body, plan);
  const safePlan = {
    ...normalizedPlan,
    ok: normalizedPlan.ok !== false,
    formulaId,
    formulaName,
    conflicts: Array.isArray(normalizedPlan.conflicts) ? normalizedPlan.conflicts : [],
    risk: normalizedPlan.risk || { level: normalizedPlan.riskLevel || 'low', score: Number(normalizedPlan.riskScore || 20), reasons: [] },
    marketIntelligence: normalizedPlan.marketIntelligence || { qualityScore: 90, warnings: [] },
  };
  return {
    ok: true,
    warning: null,
    plan: {
      ok: true,
      formulaId,
      formulaName,
      validationMode: body.validationMode || plan.validationMode || 'recommended',
      recommended: safePlan,
      scenarios: [safePlan],
    },
  };
}

// La formule a la volee d'une visite, reconstruite depuis le programme DEJA
// normalise par lib/reservation-request (activites reellement vendues, options
// bornees). Rend null si la visite ne mobilise aucune ressource : il n'y a alors
// rien a planifier, et le plan du client (blocs en capacite souple) suffit.

// LA FORMULE DU DOSSIER, ADAPTEE A CE DOSSIER (2026-08-26).
//
// Le comptoir peut retirer ou ajouter une activite sur UNE reservation
// (« c est juste cas par cas, un truc special » : le catalogue du centre et
// le formulaire public ne bougent pas). Le contenu adapte arrive alors sous
// forme de programme.
//
// Sans cette fonction, ce dossier basculerait sur le chemin « visite libre »,
// qui ne sait planifier que le bowling et le laser et qui FILTRE la table
// anniversaire (FREE_VISIT_BLOCK_TYPES) : une formule 8 adaptee perdait sa
// table au planning, et la capacite tables du centre devenait fausse. On
// repart donc du document de la formule et on ne remplace que ce que le
// comptoir a reellement touche.
//
// Deux etapes ne sont jamais proposees a l edition parce que ce ne sont pas
// des activites vendables : la table et le service. Elles sont donc
// RECONDUITES telles quelles : ce que le centre a promis reste promis.
const ETAPES_NON_EDITABLES = new Set(['party_table', 'service_drinks']);

function buildAdaptedFormula(request, body) {
  const formuleId = String((body && (body.formuleId || body.formulaId)) || '').trim();
  if (!formuleId) return null;
  const items = request && request.program && Array.isArray(request.program.items) ? request.program.items : null;
  if (!items || !items.length) return null;
  let base = null;
  try {
    base = getFormula(formuleId, request.centerId || 'libramont');
  } catch (error) {
    return null;
  }
  if (!base || !Array.isArray(base.steps) || !base.steps.length) return null;

  const voulues = new Map(items.map((item) => [String(item.activityId || ''), item]));
  const steps = [];
  base.steps.forEach((step) => {
    const id = String(step.activityId || '');
    if (ETAPES_NON_EDITABLES.has(id)) { steps.push({ ...step }); return; }
    const voulue = voulues.get(id);
    if (!voulue) return;
    voulues.delete(id);
    const suite = { ...step };
    if (id === 'bowling' && Number(voulue.duration) > 0) suite.durationMinutes = Math.round(Number(voulue.duration) * 60);
    if (id === 'laser_game' && Number(voulue.games) > 0) suite.count = Math.max(1, Math.trunc(Number(voulue.games)));
    steps.push(suite);
  });
  voulues.forEach((item, id) => {
    if (!id) return;
    const suite = { activityId: id, count: 1 };
    if (id === 'bowling' && Number(item.duration) > 0) suite.durationMinutes = Math.round(Number(item.duration) * 60);
    if (id === 'laser_game' && Number(item.games) > 0) suite.count = Math.max(1, Math.trunc(Number(item.games)));
    steps.push(suite);
  });
  if (!steps.length) return null;
  return { ...base, steps, name: base.name };
}

function buildVisitFormula(request) {
  const items = request && request.program && Array.isArray(request.program.items) ? request.program.items : null;
  if (!items || !items.length) return null;
  const program = normalizeProgram(items, { centerId: request.centerId || 'libramont', pax: request.pax || 1 });
  return buildProgramFormula(program, { name: request.label || 'Votre visite' });
}

// Visite qui ne mobilise AUCUNE ressource (minigolf seul, billards seuls).
// Il n'y a rien a planifier : appeler le moteur ici serait pire que inutile,
// il retomberait sur planBowling (planReservation ne connait pas 'activite') et
// poserait des pistes pour un groupe qui vient jouer au minigolf.
//
// Le plan est donc construit ici, et les blocs sont FILTRES : une visite sans
// activite planifiee ne peut poser aucun bloc de ressource comptee, meme si le
// navigateur en envoie un.
const FREE_VISIT_BLOCK_TYPES = new Set(['bowling_lane', 'laser_arena', 'party_table', 'duckpin_lane']);

// UNE INSTALLATION COMPTEE NE SE VEND PAS DEUX FOIS (2026-08-31).
//
// Le catalogue range les activites en PLANIFIEES (bowling, laser : une
// ressource comptee, elles decident du creneau) et LIBRES (le centre les
// absorbe). Cette frontiere tient pour un minigolf : rien ne s y epuise.
// Elle est FAUSSE des qu une activite libre declare une DOTATION FINIE dans
// la fiche du centre. Mesure du 2026-08-31 sur la donnee de PROD de Fun
// Galaxy Libramont : duckpin_bowling porte units=2, capacityPerUnit=6 et
// meme les identifiants de ses deux pistes ("9", "10"). Le moteur s en
// servait pour le PRIX et pour la rotation du groupe, jamais pour la
// disponibilite : six groupes de 12 personnes reservaient le meme 15:00, six
// fois HTTP 201, douze pistes vendues pour deux qui existent, et le comptoir
// decouvrait les groupes en trop a leur arrivee.
//
// La garde compte des UNITES, pas des dossiers : deux groupes de six tiennent
// sur deux pistes, un groupe de douze les prend toutes. Une activite SANS
// dotation (units absent ou nul) n est pas touchee : "le centre absorbe"
// reste vrai pour le minigolf, les arcades, la plaine de jeux et le billard.
function unitesDemandees(item) {
  // normalizeProgram a deja fait le calcul (joueurs / capacite d une unite,
  // plafonne a la dotation) : c est laneCount. On ne le refait pas ici, sinon
  // deux formules du meme nombre pourraient diverger.
  const compte = Number(item && item.laneCount);
  return Number.isFinite(compte) && compte > 0 ? Math.trunc(compte) : 1;
}

function fenetreReservation(reservation) {
  const debut = timeToMinutes(String(reservation.startTime || reservation.start_time || '').slice(0, 5));
  const heures = Number(reservation.totalDuration ?? reservation.total_duration ?? reservation.duration ?? 0);
  const minutes = Number.isFinite(heures) && heures > 0 ? Math.round(heures * 60) : 60;
  return { debut, fin: debut + minutes };
}

function itemsProgramme(reservation) {
  const programme = reservation && reservation.program;
  if (Array.isArray(programme)) return programme;
  if (programme && Array.isArray(programme.items)) return programme.items;
  return [];
}

// Rend le libelle de l activite saturee, ou une chaine vide si tout tient.
function dotationDepassee(request, reservations) {
  const items = (request.program && Array.isArray(request.program.items)) ? request.program.items : [];
  if (!items.length) return '';
  const centerId = request.centerId || request.center_id || 'libramont';
  const demande = fenetreReservation(request);
  const autres = Array.isArray(reservations) ? reservations : [];
  for (const item of items) {
    let activite = null;
    try { activite = getCenterActivity(centerId, item.activityId); } catch (error) { activite = null; }
    const dotation = Number(activite && activite.units);
    if (!Number.isFinite(dotation) || dotation <= 0) continue; // absorbable
    let prises = 0;
    for (const autre of autres) {
      if (String(autre.status || '').toLowerCase() === 'cancelled') continue;
      const fenetre = fenetreReservation(autre);
      // Chevauchement STRICT : deux visites qui se touchent bout a bout
      // (14:00-15:00 puis 15:00-16:00) ne se disputent aucune piste.
      if (!(demande.debut < fenetre.fin && fenetre.debut < demande.fin)) continue;
      for (const ligne of itemsProgramme(autre)) {
        if (ligne && ligne.activityId === item.activityId) prises += unitesDemandees(ligne);
      }
    }
    if (prises + unitesDemandees(item) > dotation) {
      return activite.name || item.name || item.activityId;
    }
  }
  return '';
}

function buildFreeVisitPlanResult(request, reservations = []) {
  // AVANT TOUT : la dotation. Un plan pose sur une installation deja prise
  // n est pas un plan. ok:false remonte en 409 avec alternatives par le meme
  // chemin que le bowling complet (blockOnlineConfirmation).
  const manque = dotationDepassee(request, reservations);
  if (manque) {
    return { ok: false, warning: null, reason: `${manque} est complet sur ce creneau.`, plan: null };
  }
  const items = (request.program && Array.isArray(request.program.items)) ? request.program.items : [];
  const clientBlocks = Array.isArray(request.opsPlan?.resourceBlocks) ? request.opsPlan.resourceBlocks : [];
  const startTime = String(request.startTime || '').slice(0, 5);
  const totalMinutes = Math.max(30, Math.round(Number(request.totalDuration || 0) * 60));
  const endTime = minutesToTime(timeToMinutes(startTime) + totalMinutes);
  const conserves = clientBlocks.filter((block) => !FREE_VISIT_BLOCK_TYPES.has(block.resourceType));
  // LES BLOCS SUIVENT L'HEURE DEMANDEE. Ils viennent du plan que le CLIENT a vu,
  // donc de l'heure d'AVANT le changement : les reprendre tels quels laisse la
  // carte a son ancienne place sur le planning pendant que la fiche affiche la
  // nouvelle heure. Movsar, 2026-08-26 : « les reservations de 30 minutes dont le
  // changement d'heure ne s'applique pas » - une visite sans ressource (arcades,
  // minigolf, billards) dure justement 30 min au catalogue, et c'est ce chemin-la
  // qui la planifie. visitStartShiftMinutes ne sait pas voir ces blocs : il ne
  // regarde que bowling_lane et laser_arena. On translate donc tout l'enchainement
  // du meme ecart, exactement comme visitAnchorTimes le fait pour une visite AVEC
  // ressources. A la creation l'ecart vaut zero et rien ne bouge.
  const departs = conserves
    .filter((block) => block.startTime)
    .map((block) => timeToMinutes(String(block.startTime).slice(0, 5)));
  const ecart = (departs.length && startTime) ? timeToMinutes(startTime) - Math.min(...departs) : 0;
  const decale = (block) => {
    if (!ecart) return block;
    const suivant = { ...block };
    if (block.startTime) suivant.startTime = minutesToTime(timeToMinutes(String(block.startTime).slice(0, 5)) + ecart);
    if (block.endTime) suivant.endTime = minutesToTime(timeToMinutes(String(block.endTime).slice(0, 5)) + ecart);
    if (Number.isFinite(Number(block.start))) suivant.start = Number(block.start) + ecart;
    if (Number.isFinite(Number(block.end))) suivant.end = Number(block.end) + ecart;
    return suivant;
  };
  const blocks = (clientBlocks.length
    ? conserves.map(decale)
    : items.map((item, index) => ({
      resourceType: 'soft_capacity',
      activityId: item.activityId,
      startTime,
      endTime,
      countIndex: index + 1,
    })));
  const plan = {
    ok: true,
    startTime,
    endTime,
    totalMinutes,
    assignedLanes: [],
    conflicts: [],
    resourceBlocks: blocks,
    timeline: items.map((item) => ({ type: 'activity', activityId: item.activityId, label: item.name })),
    risk: { level: 'low', score: 10, reasons: [] },
    staffSummary: `${request.label || 'Visite'} - ${request.pax || 1} personne${(request.pax || 1) > 1 ? 's' : ''} | Aucune ressource a bloquer`,
    marketIntelligence: { qualityScore: 90, warnings: [] },
  };
  return { ok: true, warning: null, plan: { ok: true, formulaId: '', formulaName: request.label || 'Visite', validationMode: 'recommended', recommended: plan, scenarios: [plan] } };
}

// Les heures d'ancre a revalider. Elles viennent du plan que le CLIENT a vu
// (blocs de l'opsPlan), sinon des preferences transmises, sinon de l'heure de
// depart. On revalide donc exactement la combinaison affichee, jamais une autre.
//
// MODIFICATION STAFF : les ancres du plan datent d'AVANT le changement. Quand le
// staff decale la visite (2026-08-20 : « pour le temps ça fonctionne pas »), on
// translate tout l'enchainement du meme ecart au lieu de replanifier sur les
// vieilles heures - sinon la fiche affiche la nouvelle heure et le planning
// garde l'ancienne, exactement le defaut que Movsar voit a l'ecran.
function visitAnchorTimes(request, { shiftMinutes = 0 } = {}) {
  const fromPreference = (request.preference && request.preference.preferredTimes) || {};
  const times = { ...fromPreference };
  const blocks = Array.isArray(request.opsPlan?.resourceBlocks) ? request.opsPlan.resourceBlocks : [];
  const firstOf = (resourceType) => blocks.find((block) => block.resourceType === resourceType && block.startTime);
  const shifted = (value) => (shiftMinutes
    ? minutesToTime(timeToMinutes(String(value).slice(0, 5)) + shiftMinutes)
    : String(value).slice(0, 5));
  const bowlingBlock = firstOf('bowling_lane');
  const laserBlock = firstOf('laser_arena');
  if (bowlingBlock) times.bowling = shifted(bowlingBlock.startTime);
  if (laserBlock) times.laser_game = shifted(laserBlock.startTime);
  if (!times.bowling && !times.laser_game && request.startTime) {
    times[request.laserGames ? 'laser_game' : 'bowling'] = String(request.startTime).slice(0, 5);
  }
  return times;
}

// LES HEURES DE CHAQUE PARTIE DE LASER, telles qu'elles sont POSEES dans le
// plan enregistre. Le client peut en placer une, deux ou toutes (2026-08-20) :
// une modification staff doit garder SON choix, pas le reduire a la premiere.
// Une partie absente du plan reste vide : elle se place sur place.
function planLaserPartTimes(request, { shiftMinutes = 0 } = {}) {
  const blocks = Array.isArray(request.opsPlan?.resourceBlocks) ? request.opsPlan.resourceBlocks : [];
  const laserBlocks = blocks.filter((block) => block.resourceType === 'laser_arena' && block.startTime);
  if (!laserBlocks.length) {
    const declared = request.preference && Array.isArray(request.preference.laserGameTimes)
      ? request.preference.laserGameTimes
      : [];
    return declared;
  }
  const byPart = new Map();
  laserBlocks.forEach((block) => {
    const part = Math.max(1, Number(block.countIndex || 1));
    const start = String(block.startTime).slice(0, 5);
    // Un groupe scinde en vagues pose plusieurs blocs pour LA MEME partie :
    // l'heure de la partie est celle de sa premiere vague.
    if (!byPart.has(part) || timeToMinutes(start) < timeToMinutes(byPart.get(part))) byPart.set(part, start);
  });
  const total = Math.max(
    ...laserBlocks.map((block) => Math.max(1, Number(block.countIndex || 1))),
    Number(request.laserGames || request.games || 0) || 0,
  );
  return Array.from({ length: total }, (_, index) => {
    const time = byPart.get(index + 1);
    if (!time) return '';
    return shiftMinutes ? minutesToTime(timeToMinutes(time) + shiftMinutes) : time;
  });
}

// L'ecart entre l'heure demandee et l'heure du plan enregistre. Zero quand rien
// n'a bouge (creation, modification d'un autre champ) : le comportement
// historique reste alors byte pour byte le meme.
function visitStartShiftMinutes(request) {
  const blocks = Array.isArray(request.opsPlan?.resourceBlocks) ? request.opsPlan.resourceBlocks : [];
  const starts = blocks
    .filter((block) => ['bowling_lane', 'laser_arena'].includes(block.resourceType) && block.startTime)
    .map((block) => timeToMinutes(String(block.startTime).slice(0, 5)));
  if (!starts.length || !request.startTime) return 0;
  return timeToMinutes(String(request.startTime).slice(0, 5)) - Math.min(...starts);
}

// La grille :00/:30 est une regle sur ce que le CLIENT choisit, pas sur ce que
// le moteur a place tout seul : une formule replanifiee librement pose son laser
// a 17:55, et re-ancrer sur cette heure la ferait refuser. Une combinaison qui
// ne tombe pas sur la grille n'est donc pas re-ancree : le moteur reprend la
// main comme avant. Toute combinaison CHOISIE par un client, elle, est alignee
// par construction.
function anchorsFitGrid(times = {}, partTimes = []) {
  const valeurs = [...Object.values(times || {}), ...(partTimes || [])].filter(Boolean);
  return valeurs.every((value) => timeToMinutes(String(value).slice(0, 5)) % 30 === 0);
}

// UNE FORMULE MODIFIEE GARDE SA COMBINAISON. Sans ancres, le moteur replace le
// programme entier a sa facon : le client avait choisi bowling 15:00 et laser
// 17:00, la modification lui rendait un enchainement colle. On repart donc des
// heures du plan enregistre, translatees du meme ecart que l'horaire.
function editFormulaPreference(request, isEdit) {
  const preference = request.preference || {};
  if (!isEdit || !request.formuleId) return preference;
  const blocks = Array.isArray(request.opsPlan?.resourceBlocks) ? request.opsPlan.resourceBlocks : [];
  if (!blocks.some((block) => ['bowling_lane', 'laser_arena'].includes(block.resourceType))) return preference;
  const shiftMinutes = visitStartShiftMinutes(request);
  const times = visitAnchorTimes(request, { shiftMinutes });
  const laserGameTimes = planLaserPartTimes(request, { shiftMinutes });
  if (!anchorsFitGrid(times, laserGameTimes)) return preference;
  return {
    ...preference,
    preferredTimes: { ...(preference.preferredTimes || {}), ...times },
    laserGameTimes,
    laserPlacement: laserGameTimes.some((time) => time) || times.laser_game ? 'scheduled' : (preference.laserPlacement || 'scheduled'),
  };
}

// Les ancres d'une VISITE : celles du plan que le client a vu, translatees du
// meme ecart quand le staff la deplace. Hors grille apres translation, on ne
// force rien : le moteur replanifie, comme il le faisait avant les ancres.
function visitPreference(request, isEdit) {
  const shiftMinutes = isEdit ? visitStartShiftMinutes(request) : 0;
  const times = visitAnchorTimes(request, { shiftMinutes });
  const laserGameTimes = planLaserPartTimes(request, { shiftMinutes });
  if (shiftMinutes && !anchorsFitGrid(times, laserGameTimes)) return request.preference || {};
  return {
    ...(request.preference || {}),
    preferredTimes: times,
    laserGameTimes,
    laserPlacement: 'scheduled',
  };
}

async function prepareReservationOps(body, channel = 'public', options = {}) {
  const request = normalizeReservationRequest(body, { channel });
  const centerId = request.centerId || request.center_id || 'libramont';
  const ignoreReservationId = Number(options.ignoreReservationId || request.ignoreReservationId || 0);
  const readState = options.readState || readStaffState;
  let planResult = null;

  try {
    const snapshot = await readState(request.date, centerId);
    const reservations = ignoreReservationId
      ? snapshot.reservations.filter((reservation) => Number(reservation.id) !== ignoreReservationId)
      : snapshot.reservations;
    const isFormula = request.type === 'formule';
    const isDirectLaser = request.type === 'laser';
    // VISITE : le programme, pas le type, dit ce qu'il faut planifier. Sans ca,
    // une visite bowling + laser serait replanifiee comme un bowling seul
    // (request.type vaut 'bowling') et le laser disparaitrait du planning entre
    // l'ecran de reservation et la fiche staff.
    // Un dossier qui porte une FORMULE garde sa formule, adaptee a son
    // contenu : c est le seul chemin qui sait poser sa table anniversaire.
    const visitFormula = buildAdaptedFormula(request, body) || buildVisitFormula(request);
    const isFreeVisit = Boolean(request.program && Array.isArray(request.program.items)
      && request.program.items.length && !visitFormula);
    // UNE MODIFICATION NE FAIT JAMAIS CONFIANCE AU PLAN DEJA ENREGISTRE
    // (2026-08-20). `ignoreReservationId` n'est pose que sur un PATCH : le plan
    // porte par la requete est alors celui d'AVANT le changement. Le reprendre
    // tel quel, c'est reecrire les anciennes pistes et les anciennes heures sur
    // une reservation que le staff vient de deplacer - mesure au harnais :
    // formule deplacee a 16:00 sur les pistes 1-2, plan rendu 15:00 pistes 4-5,
    // « Réservation mise à jour » quand meme. Le raccourci existe pour la
    // CREATION (le navigateur vient de calculer ce plan pour cette demande), pas
    // pour l'edition.
    const isEdit = Boolean(ignoreReservationId);
    const trustedClientPlan = !isEdit
      && channel !== 'public'
      && (isFormula || isDirectLaser)
      && isTrustedClientPlan(request.opsPlan, request);
    planResult = isFreeVisit
      ? buildFreeVisitPlanResult(request, reservations)
      : trustedClientPlan
        ? buildTrustedClientPlanResult(request, request.opsPlan)
        : planningAgent(
        {
          centerId,
          date: request.date,
          type: visitFormula ? 'formule' : (request.type || 'bowling'),
          formuleId: request.formuleId || request.formulaId || '',
          ...(visitFormula ? { formula: visitFormula } : {}),
          pax: request.pax,
          startTime: request.startTime,
          duration: request.duration,
          // Les pistes DEMANDEES suivent jusqu'au moteur : sans elles, il
          // allouait les premieres libres et le planning ignorait le choix du
          // staff (voir preferredLanesFor dans lib/ops-engine).
          lanes: Array.isArray(request.lanes) ? request.lanes : [],
          laserGames: request.laserGames || request.games || request.gameCount || 0,
          preference: visitFormula
            ? visitPreference(request, isEdit)
            : editFormulaPreference(request, isEdit),
          channel,
          allowPastStart: channel === 'staff' && Boolean(request.allowPastStart),
          pauseMinutes: 0,
        },
        {
          reservations,
          laneStatuses: snapshot.laneStatuses,
        },
      );
  } catch (error) {
    planResult = {
      ok: false,
      warning: error.message || 'Plan Ops indisponible.',
      plan: null,
    };
  }

  const baseRecommended = planResult?.plan?.recommended || null;
  const requestLaserGames = request.type === 'laser'
    ? Number(request.laserGames || request.games || request.gameCount || 0)
    : 0;
  const recommended = baseRecommended && requestLaserGames
    ? {
      ...baseRecommended,
      laserGames: requestLaserGames,
      games: requestLaserGames,
      laserPassPlan: baseRecommended.laserPassPlan
        ? { ...baseRecommended.laserPassPlan, totalGames: requestLaserGames }
        : baseRecommended.laserPassPlan,
    }
    : baseRecommended;
  const blockingConflicts = recommended?.conflicts?.some((conflict) => conflict.severity === 'blocking');
  const noSafePlan = planResult && planResult.ok === false;
  // Choix ops Movsar (2026-07-18) : validation staff (et email) UNIQUEMENT si la
  // resa ne peut pas etre placee (pas de plan sur ou conflit bloquant) ou si
  // l'operateur l'exige. Le risque critique mais placable auto-confirme et
  // remonte dans « A surveiller » via riskLevel ci-dessous, sans email.
  const policyReview = shouldRequestHumanReview({
    validationMode: planResult?.plan?.validationMode,
    recommended,
  });
  const validationStatus = request.validationStatus
    || (noSafePlan || blockingConflicts || policyReview ? 'staff_review' : 'confirmed');
  const plannedTotalDuration = recommended?.totalMinutes
    ? Math.ceil(Number(recommended.totalMinutes) / 30) / 2
    : 0;
  const totalDuration = plannedTotalDuration
    ? Math.max(Number(request.totalDuration || request.duration || 0), plannedTotalDuration)
    : request.totalDuration;

  return {
    centerId,
    ...(totalDuration ? { totalDuration } : {}),
    ...(channel === 'public' && recommended?.startTime ? { startTime: recommended.startTime } : {}),
    opsPlan: recommended,
    riskLevel: recommended?.risk?.level || '',
    riskScore: recommended?.risk?.score ?? null,
    validationStatus,
    requiresHumanReview: validationStatus === 'staff_review',
    autoDecision: validationStatus === 'staff_review' ? 'human_review_required' : 'auto_confirmed',
    blockOnlineConfirmation: channel === 'public' && noSafePlan,
    planAvailable: !noSafePlan,
    planWarning: planResult?.warning || null,
  };
}

async function afterReservationCreated(reservation, body = {}) {
  const warnings = [];

  // Les trois hooks post-création (event, jobs, communications) sont
  // indépendants : on les lance en PARALLÈLE au lieu d'enchaîner les awaits.
  // Chemin chaud du POST staff : chaque aller-retour séquentiel évité compte.
  const [, , communications] = await Promise.all([
    createOpsEvent({
      centerId: reservation.centerId || 'libramont',
      reservationId: reservation.id,
      formulaId: reservation.formuleId || '',
      eventType: 'reservation_created',
      plannedMinutes: Number(reservation.totalDuration || reservation.duration || 0) * 60,
      payload: {
        channel: reservation.channel,
        validationStatus: reservation.validationStatus,
        riskLevel: reservation.riskLevel,
      },
      runLearning: false,
    }).catch((error) => {
      warnings.push(`event:${error.message}`);
      return null;
    }),
    enqueueReservationAutomation(reservation).catch((error) => {
      warnings.push(`jobs:${error.message}`);
      return [];
    }),
    enqueueReservationCommunications(reservation, {
      validationMode: reservation.validationStatus || body.validationStatus,
    }).catch((error) => {
      warnings.push(`communications:${error.message}`);
      return [];
    }),
  ]);

  return { warnings, communications };
}

module.exports = {
  afterReservationCreated,
  prepareReservationOps,
};
