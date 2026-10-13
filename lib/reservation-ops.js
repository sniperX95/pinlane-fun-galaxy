const { createOpsEvent, readStaffState } = require('./database');
const { planningAgent } = require('./ops-agents');
const { dispatchDueCommunications, enqueueReservationCommunications } = require('./ops-communications');
const { enqueueReservationAutomation } = require('./ops-jobs');
const { normalizeReservationRequest, prixAvecExtras, prixEnvoye, renormalizeVisitProgram } = require('./reservation-request');
const { detecterSituations, decisionValidation } = require('./situations-validation');
const { buildProgramFormula, normalizeProgram } = require('./visit-program');
const { getCenter, getFormula } = require('./ops-knowledge');
const { getOperationalBowlingConfig } = require('./ops-engine');
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
    if (voulue.participants != null) suite.pax = Number(voulue.participants);
    if (id === 'bowling' && Number(voulue.duration) > 0) suite.durationMinutes = Math.round(Number(voulue.duration) * 60);
    if (id === 'bowling' && Number(voulue.games) > 0) suite.games = voulue.games;
    if (id === 'laser_game' && Number(voulue.games) > 0) suite.count = Math.max(1, Math.trunc(Number(voulue.games)));
    steps.push(suite);
  });
  voulues.forEach((item, id) => {
    if (!id) return;
    const suite = { activityId: id, count: 1 };
    if (item.participants != null) suite.pax = Number(item.participants);
    if (id === 'bowling' && Number(item.duration) > 0) suite.durationMinutes = Math.round(Number(item.duration) * 60);
    if (id === 'bowling' && Number(item.games) > 0) suite.games = item.games;
    if (id === 'laser_game' && Number(item.games) > 0) suite.count = Math.max(1, Math.trunc(Number(item.games)));
    steps.push(suite);
  });
  if (!steps.length) return null;
  return { ...base, steps, name: base.name };
}

// `staff` : le programme du comptoir peut depasser la grille (4 parties,
// 2 h 30 de bowling) ; le relire sans lui le refuserait ici, apres l avoir
// accepte a l entree.
function buildVisitFormula(request, bowlingConfig = getCenter(request?.centerId || 'libramont').resources.bowling, { staff = false } = {}) {
  const items = request && request.program && Array.isArray(request.program.items) ? request.program.items : null;
  if (!items || !items.length) return null;
  const program = normalizeProgram(items, { centerId: request.centerId || 'libramont', pax: request.pax || 1, bowlingConfig, dateStr: request.date, staff });
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
// COMBIEN D UNITES CETTE LIGNE PREND-ELLE ?
//
// normalizeProgram a fait le calcul (joueurs / capacite d une unite, plafonne a
// la dotation) et l a ecrit dans laneCount : quand il est la, on le relit tel
// quel, sinon deux formules du meme nombre pourraient diverger.
//
// MAIS IL N EST PRESQUE JAMAIS LA (mesure du 2026-09-04). La liste blanche de
// normalizeReservationProgram (lib/database.js) conserve activityId, name,
// planned, duration, games, units, hours, minutes, price et priceKnown : PAS
// laneCount. Tout dossier RELU depuis la base comptait donc pour une seule
// unite, quelle que soit la taille du groupe, et deux pistes de duckpin se
// vendaient trois fois : un groupe de 12 (2 pistes) puis un groupe de 6, tous
// deux en HTTP 201. C est exactement le defaut que cette garde ferme.
//
// Le repli ne peut donc pas etre un « 1 » silencieux. Il refait le calcul avec
// les deux seules donnees qui survivent a l ecriture : le nombre de joueurs du
// dossier et la dotation declaree au catalogue. Meme regle que
// lib/visit-program.js, appliquee la ou la dotation se compare.
function unitesDemandees(item, activite, pax) {
  const compte = Number(item && item.laneCount);
  if (Number.isFinite(compte) && compte > 0) return Math.trunc(compte);
  // LES UNITES ENREGISTREES (2026-09-28). La base garde `units` : les tables
  // CHOISIES d une ligne de billard, les pistes de TOUS les tours d une ligne
  // de duckpin. En meme temps, une ligne n en tient jamais plus que la
  // dotation. Sans cette lecture, une table de billard sans capacite par
  // table retombait sur le repli ci-dessous (1 joueur = 1 table) : un groupe
  // de 8 aurait tenu les 6 tables.
  const enregistrees = Math.trunc(Number(item && item.units) || 0);
  if (enregistrees > 0) {
    const plafond = Math.trunc(Number(activite && activite.units) || 0);
    return plafond > 0 ? Math.min(plafond, enregistrees) : enregistrees;
  }
  const capacite = Math.max(1, Math.trunc(Number(activite && activite.capacityPerUnit) || 0));
  const joueurs = Math.max(1, Math.trunc(Number(item && item.participants != null ? item.participants : pax) || 0));
  const dotation = Math.trunc(Number(activite && activite.units) || 0);
  const voulues = Math.max(1, Math.ceil(joueurs / capacite));
  return dotation > 0 ? Math.min(dotation, voulues) : voulues;
}

// La duree PROPRE d une ligne de programme, en minutes. normalizeProgram ecrit
// `minutes` pour toutes les lignes qu il connait ; `duration` (en heures) est le
// repli, et une heure celui du repli.
function minutesLigne(item) {
  const minutes = Number(item && item.minutes);
  if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes);
  const heures = Number(item && item.duration);
  return Number.isFinite(heures) && heures > 0 ? Math.round(heures * 60) : 60;
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

// UNE ACTIVITE LIBRE N A PAS D HEURE, ELLE A UNE FENETRE.
//
// La garde comparait la fenetre ENTIERE de la visite demandee. Tant qu elle ne
// voyait que les visites 100 % libres d une seule ligne, cette fenetre valait la
// duree de l activite elle-meme. Hissee dans le chemin chaud, elle refusait des
// visites REALISABLES : mesure du 2026-09-04, deux groupes de 6 posent une piste
// de duckpin chacun de 15:00 a 16:00, puis une visite « bowling 1h a 15:00 +
// duckpin 1h » (2 heures) tombait en HTTP 409 - alors que ce groupe-la peut
// parfaitement jouer son duckpin de 16:00 a 17:00, quand les deux pistes sont
// libres. Le moteur conseille et previent, il n interdit jamais un choix
// realisable.
//
// La regle est donc : une ligne SANS heure imposee n est refusee que s il
// n existe AUCUNE place pour elle dans la fenetre de la visite. On cherche cette
// place demie par demie, la grille du produit.
//
// LES GROUPES DEJA RESERVES AUSSI (2026-09-30). La garde supposait qu un
// dossier deja pose tenait son unite pendant TOUTE sa visite : « on ne sait
// pas a quelle minute il ira sur la piste ». Mesure en prod le 30/09 : le
// dossier 1404 (10 joueurs a 13:30 : bowling, laser jusqu a 15:25, puis
// billard 1 h, plaine 1 h et duckpin 1 h 30, visite comptee jusqu a 19:00)
// tenait les 2 pistes de duckpin et une table de billard de 13:30 a 19:00. Un
// groupe de 20 ne se voyait proposer que 19:00, 19:30 et 20:00 pour son
// duckpin, et choisir un bowling faisait tomber toutes les heures de laser en
// « Complet pour votre groupe : billards complet ». Movsar : « bowling et
// lasergame ils peuvent choisir l heure, toutes les autres elles peuvent etre
// faites comme ils veulent sur place ».
//
// Chaque groupe, le nouveau comme les anciens, doit donc pouvoir jouer son
// activite libre QUELQUE PART dans sa visite, hors des moments ou le groupe
// ENTIER joue une activite a creneau. La garde cherche une repartition de
// toutes ces parties sur les unites du centre, et ne refuse que s il n en
// existe aucune : c est le seul refus vrai. Une activite qui tourne se
// repartit TOUR PAR TOUR, les tours d un groupe l un apres l autre : les 13
// sessions de 15 min du Fun Run d un groupe de 64 ne sont pas un bloc de
// 3 h 15, un autre groupe passe entre deux sessions. Les departs se cherchent
// a 5 minutes pres : sur place, on enchaine quand la piste se libere.
// Aucune heure n est promise au client pour une activite libre ; la
// repartition prouve seulement que les unites suffisent a tout le monde
// pendant les visites.
//
// L ancienne regle (chaque groupe deja pose tient son unite toute sa visite)
// reste le repli, stricte, dans les deux cas ou la repartition ne sait pas
// conclure : une recherche trop longue, et une journee deja trop chargee SANS
// le nouveau groupe (un dossier force au comptoir). On ne vend alors rien de
// plus que ce qu elle vendait.
const PAS_DE_PLACEMENT_MINUTES = 30;
const TRANCHE_MINUTES = 5;
const LIMITE_DE_RECHERCHE = 20000;
const RESSOURCES_A_CRENEAU = new Set(['bowling_lane', 'laser_arena', 'party_table']);
const RECHERCHE_TROP_LONGUE = 'repartition:trop-longue';

function minuteDuBloc(texte, nombre) {
  const heure = String(texte || '').slice(0, 5);
  if (/^\d{1,2}:\d{2}$/.test(heure)) return timeToMinutes(heure);
  const brut = Number(nombre);
  return Number.isFinite(brut) ? brut : null;
}

// LES MOMENTS OU LE GROUPE ENTIER EST PRIS par une activite a creneau. Une
// vague (« Bowling - groupe 1/2 ») n en prend qu une partie : l autre partie
// peut etre sur les pistes de duckpin pendant ce temps, la vague ne retire
// donc aucune heure au groupe.
function momentsDuGroupeEntier(opsPlan) {
  const blocs = opsPlan && Array.isArray(opsPlan.resourceBlocks) ? opsPlan.resourceBlocks : [];
  const moments = [];
  for (const bloc of blocs) {
    if (!bloc || !RESSOURCES_A_CRENEAU.has(bloc.resourceType)) continue;
    if (Number(bloc.groupWaveCount) > 1) continue;
    const joueurs = Number(bloc.players);
    const groupe = Number(bloc.groupPlayers);
    if (joueurs > 0 && groupe > 0 && joueurs < groupe) continue;
    const debut = minuteDuBloc(bloc.startTime, bloc.start);
    const fin = minuteDuBloc(bloc.endTime, bloc.end);
    if (debut === null || fin === null || !(fin > debut)) continue;
    moments.push({ debut, fin });
  }
  return moments;
}

// Les heures ou une partie de `minutes` peut commencer dans `fenetre`, de
// 5 en 5 minutes depuis le debut de la visite, plus la fin de chaque activite
// a creneau (on enchaine a 15:27 si le laser finit a 15:27).
function departsPossibles(fenetre, minutes, moments) {
  const dernier = Math.max(fenetre.debut, fenetre.fin - minutes);
  const candidats = new Set();
  for (let depart = fenetre.debut; depart <= dernier; depart += TRANCHE_MINUTES) candidats.add(depart);
  for (const moment of moments) {
    if (moment.fin > fenetre.debut && moment.fin <= dernier) candidats.add(moment.fin);
  }
  const tous = [...candidats].sort((a, b) => a - b);
  const libres = tous.filter((depart) => moments.every((moment) => !(depart < moment.fin && moment.debut < depart + minutes)));
  // Un groupe dont les activites libres ne tiennent pas hors de ses creneaux
  // se scinde sur place : on ne lui retire alors aucune heure.
  return libres.length ? libres : tous;
}

// LES TOURS D UNE LIGNE. Un tour prend les unites que la ligne tient a la
// fois, pendant sa part de la duree. Le nombre de tours est celui que le
// programme a compte (`sessions`) ; un dossier ancien qui ne l a pas garde le
// retrouve avec la capacite d une unite, comme lib/visit-program.
function toursDeLaLigne(ligne, activite, pax, dotation, fenetre, moments) {
  const unites = Math.min(dotation, unitesDemandees(ligne, activite, pax));
  const minutes = minutesLigne(ligne);
  const compte = Math.trunc(Number(ligne && ligne.sessions) || 0);
  const capacite = Math.trunc(Number(activite && activite.capacityPerUnit) || 0);
  const joueurs = Math.max(1, Math.trunc(Number(ligne && ligne.participants != null ? ligne.participants : pax) || 0));
  const tours = compte > 0 ? compte : (capacite > 0 ? Math.max(1, Math.ceil(joueurs / (capacite * unites))) : 1);
  const parTour = Math.max(TRANCHE_MINUTES, Math.ceil(minutes / tours));
  const departs = departsPossibles(fenetre, parTour, moments);
  const parties = [];
  for (let rang = 0; rang < tours; rang += 1) {
    parties.push({ unites, minutes: parTour, departs, precedente: rang ? parties[rang - 1] : null });
  }
  return parties;
}

// EXISTE-T-IL UNE REPARTITION ? Chaque partie prend `unites` pendant
// `minutes`, a l un de ses `departs`, et la somme ne depasse jamais la
// dotation ; le tour d un groupe commence quand son tour precedent finit.
// Recherche en profondeur : la ligne la plus contrainte d abord, ses tours
// dans l ordre, au plus tot d abord. Rend 'oui', 'non', ou 'inconnu' au-dela
// de sa borne.
function repartitionPossible(parties, dotation) {
  if (!parties.length) return 'oui';
  const origine = Math.min(...parties.map((partie) => partie.departs[0]));
  const bout = Math.max(...parties.map((partie) => partie.departs[partie.departs.length - 1] + partie.minutes));
  const charge = new Array(Math.ceil((bout - origine) / TRANCHE_MINUTES) + 1).fill(0);
  const rangs = new Map(parties.map((partie, rang) => [partie, rang]));
  const tete = (partie) => { let t = partie; while (t.precedente) t = t.precedente; return t; };
  const ordre = parties.slice().sort((a, b) => {
    const ta = tete(a);
    const tb = tete(b);
    return (ta.departs.length - tb.departs.length)
      || (tb.unites * tb.minutes - ta.unites * ta.minutes)
      || (rangs.get(ta) - rangs.get(tb))
      || (rangs.get(a) - rangs.get(b));
  });
  const places = new Map();
  let essais = 0;
  const poser = (rang) => {
    if (rang === ordre.length) return true;
    const partie = ordre[rang];
    const apres = partie.precedente && places.has(partie.precedente)
      ? places.get(partie.precedente) + partie.precedente.minutes
      : -Infinity;
    for (const depart of partie.departs) {
      if (depart < apres) continue;
      essais += 1;
      if (essais > LIMITE_DE_RECHERCHE) throw new Error(RECHERCHE_TROP_LONGUE);
      const de = Math.floor((depart - origine) / TRANCHE_MINUTES);
      const a = Math.ceil((depart + partie.minutes - origine) / TRANCHE_MINUTES);
      let tient = true;
      for (let tranche = de; tranche < a; tranche += 1) {
        if (charge[tranche] + partie.unites > dotation) { tient = false; break; }
      }
      if (!tient) continue;
      for (let tranche = de; tranche < a; tranche += 1) charge[tranche] += partie.unites;
      places.set(partie, depart);
      if (poser(rang + 1)) return true;
      places.delete(partie);
      for (let tranche = de; tranche < a; tranche += 1) charge[tranche] -= partie.unites;
    }
    return false;
  };
  try {
    return poser(0) ? 'oui' : 'non';
  } catch (error) {
    if (error && error.message === RECHERCHE_TROP_LONGUE) return 'inconnu';
    throw error;
  }
}

// Les parties reliees aux nouvelles par un chevauchement, de proche en proche :
// les autres ne peuvent ni les gener ni etre genees par elles.
function partiesLiees(nouvelles, deja) {
  const etendue = (partie) => ({ debut: partie.departs[0], fin: partie.departs[partie.departs.length - 1] + partie.minutes });
  const retenues = nouvelles.slice();
  let reste = deja.slice();
  let ajout = true;
  while (ajout) {
    ajout = false;
    const suivantes = [];
    for (const partie of reste) {
      const la = etendue(partie);
      if (retenues.some((retenue) => { const ici = etendue(retenue); return la.debut < ici.fin && ici.debut < la.fin; })) {
        retenues.push(partie);
        ajout = true;
      } else {
        suivantes.push(partie);
      }
    }
    reste = suivantes;
  }
  return retenues.slice(nouvelles.length);
}

// L ANCIENNE REGLE, stricte : la nouvelle partie cherche une place ou les
// groupes deja poses sont supposes presents sur toute leur visite.
function placeSurVisitesEntieres(item, activite, demande, minutes, visite, autres, dotation) {
  const dernierDepart = Math.max(visite.debut, visite.fin - minutes);
  for (let debut = visite.debut; debut <= dernierDepart; debut += PAS_DE_PLACEMENT_MINUTES) {
    const fin = debut + minutes;
    let prises = 0;
    for (const autre of autres) {
      const fenetre = fenetreReservation(autre);
      // Chevauchement STRICT : deux visites qui se touchent bout a bout
      // (14:00-15:00 puis 15:00-16:00) ne se disputent aucune piste.
      if (!(debut < fenetre.fin && fenetre.debut < fin)) continue;
      for (const ligne of itemsProgramme(autre)) {
        if (ligne && ligne.activityId === item.activityId) {
          prises += unitesDemandees(ligne, activite, autre.pax);
        }
      }
    }
    if (prises + demande <= dotation) return true;
  }
  return false;
}

// Rend le libelle de l activite saturee, ou une chaine vide si tout tient.
// `request.opsPlan` (le plan du creneau juge) dit quand le nouveau groupe est
// entier au bowling ou au laser ; sans plan, aucune heure ne lui est retiree.
function dotationDepassee(request, reservations) {
  const items = (request.program && Array.isArray(request.program.items)) ? request.program.items : [];
  if (!items.length) return '';
  const centerId = request.centerId || request.center_id || 'libramont';
  const visite = fenetreReservation(request);
  const autres = (Array.isArray(reservations) ? reservations : [])
    .filter((autre) => autre && String(autre.status || '').toLowerCase() !== 'cancelled');
  const momentsDemande = momentsDuGroupeEntier(request.opsPlan);
  for (const item of items) {
    let activite = null;
    try { activite = getCenterActivity(centerId, item.activityId); } catch (error) { activite = null; }
    const dotation = Number(activite && activite.units);
    if (!Number.isFinite(dotation) || dotation <= 0) continue; // absorbable
    const nom = activite.name || item.name || item.activityId;
    const demande = unitesDemandees(item, activite, request.pax);
    const minutes = minutesLigne(item);
    if (demande > dotation) return nom;
    const nouvelles = toursDeLaLigne(item, activite, request.pax, dotation, visite, momentsDemande);
    const deja = [];
    for (const autre of autres) {
      const lignes = itemsProgramme(autre).filter((ligne) => ligne && ligne.activityId === item.activityId);
      if (!lignes.length) continue;
      const fenetre = fenetreReservation(autre);
      const moments = momentsDuGroupeEntier(autre.opsPlan || autre.ops_plan);
      for (const ligne of lignes) deja.push(...toursDeLaLigne(ligne, activite, autre.pax, dotation, fenetre, moments));
    }
    const liees = partiesLiees(nouvelles, deja);
    const verdict = repartitionPossible([...nouvelles, ...liees], dotation);
    if (verdict === 'oui') continue;
    // Refus vrai : sans le nouveau groupe, tout le monde tenait.
    if (verdict === 'non' && repartitionPossible(liees, dotation) === 'oui') return nom;
    if (!placeSurVisitesEntieres(item, activite, demande, minutes, visite, autres, dotation)) return nom;
  }
  return '';
}

// LA DOTATION N EST PLUS COMPTEE ICI. Elle l est dans prepareReservationOps,
// AVANT l aiguillage : ce chemin-ci ne recoit que les visites 100 % libres, et
// une garde posee la ne voyait rien des que le meme dossier ajoutait du
// bowling ou du laser.
function buildFreeVisitPlanResult(request) {
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
    const item = items.find((entry) => entry.activityId === block.activityId);
    const suivant = { ...block, ...(item ? { players: item.participants ?? request.pax } : {}) };
    if (!ecart) return suivant;
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
      players: item.participants ?? request.pax,
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
    timeline: items.map((item) => ({ type: 'activity', activityId: item.activityId, label: item.name, players: item.participants ?? request.pax })),
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

// L ARENE POUR VOUS SEULS (2026-10-08, Movsar : « arène laser pour vous seuls
// possible »). Les blocs laser de CE dossier retiennent TOUTE la capacite de
// l arene : `players` vaut le nombre d armes, `joueursReels` garde le groupe.
// C est la seule ecriture : evaluateConflicts, ensureLaserCapacity, les
// sessions partageables et la grille du tunnel lisent deja `players`, ils
// voient donc la session pleine sans etre reecrits. Les prix ne bougent pas :
// ils se calculent par participant, sur le programme et le groupe, jamais sur
// un bloc. Un autre groupe deja dans la session rend la demande impossible, et
// le dossier le dit au lieu de partager en silence.
function privatiserArene(plan, capacite) {
  const conflits = [];
  const vus = new Set();
  const resourceBlocks = (Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []).map((bloc) => {
    if (!bloc || bloc.resourceType !== 'laser_arena') return bloc;
    const autres = Math.max(0, Math.trunc(Number(bloc.playersBefore) || 0));
    const heure = String(bloc.startTime || minutesToTime(Number(bloc.start) || 0)).slice(0, 5);
    const message = `Arène déjà occupée par ${autres} joueur${autres > 1 ? 's' : ''} à ${heure}.`;
    if (autres > 0 && !vus.has(message)) {
      vus.add(message);
      conflits.push({ type: 'arene', message, heure, joueurs: autres });
    }
    const reels = Math.trunc(Number(bloc.joueursReels ?? bloc.players) || 0);
    return {
      ...bloc,
      joueursReels: reels,
      players: capacite,
      weaponNeed: capacite,
      playersTotal: capacite + autres,
      remainingWeapons: 0,
      mayShareSession: false,
      arene: 'seuls',
    };
  });
  const laserSharing = plan.laserSharing && typeof plan.laserSharing === 'object'
    ? { ...plan.laserSharing, mayShare: false, remainingPlaces: 0, playersTotal: capacite }
    : plan.laserSharing;
  return { plan: { ...plan, resourceBlocks, laserSharing, arene: 'seuls' }, conflits };
}

// Le choix de l arene : celui de la demande, sinon celui deja porte par le plan
// enregistre (une modification au comptoir le garde), sinon le partage
// habituel ('auto').
function areneDemandee(request) {
  const voulue = request && request.preference && request.preference.arene;
  if (voulue === 'seuls' || voulue === 'auto') return voulue;
  return request && request.opsPlan && request.opsPlan.arene === 'seuls' ? 'seuls' : 'auto';
}

async function prepareReservationOps(body, channel = 'public', options = {}) {
  const request = normalizeReservationRequest(body, { channel });
  const centerId = request.centerId || request.center_id || 'libramont';
  // LE COMPTOIR, par le canal de confiance (l API le pose), jamais par le corps.
  const staff = channel === 'staff';
  const ignoreReservationId = Number(options.ignoreReservationId || request.ignoreReservationId || 0);
  // Les horaires retenus par d autres clients en train de reserver comptent
  // comme des reservations (migration 0049) ; ceux du client lui-meme, non.
  const readState = options.readState
    || ((date, center) => readStaffState(date, center, { avecBlocages: true, saufJeton: options.saufJeton || '' }));
  let planResult = null;

  try {
    const snapshot = await readState(request.date, centerId);
    const operationalBowling = getOperationalBowlingConfig(getCenter(centerId), snapshot.laneStatuses || {});
    renormalizeVisitProgram(request, operationalBowling, { channel });
    const reservations = ignoreReservationId
      ? snapshot.reservations.filter((reservation) => Number(reservation.id) !== ignoreReservationId)
      : snapshot.reservations;
    // UNE INSTALLATION COMPTEE NE SE VEND PAS DEUX FOIS, QUEL QUE SOIT LE
    // RESTE DU PROGRAMME (2026-09-04). La garde vivait dans
    // buildFreeVisitPlanResult, et l aiguillage ci-dessous ne traverse ce
    // chemin que si la visite est 100 % libre. Des qu une activite PLANIFIEE
    // entrait dans le meme dossier (bowling 1h + duckpin 1h), buildVisitFormula
    // rendait une formule, isFreeVisit tombait a false, et la visite partait
    // chez planningAgent qui ne connait que les pistes de bowling et les
    // arenes : les 2 pistes de duckpin de Libramont se revendaient autant de
    // fois qu on le demandait. La garde est donc hissee ici, avant tout choix
    // de moteur, et elle vaut pour toute requete qui porte un programme.
    //
    // CE QU ELLE FAIT D UNE RESERVATION DE FORMULE : rien, et c est
    // STRUCTUREL, pas un oubli. Un dossier qui ne porte qu un formuleId n a
    // pas de `program` : normalizeReservationRequest n appelle applyProgram
    // que pour le type 'visite' ou pour un body qui transporte deja un
    // programme (lib/reservation-request.js), donc dotationDepassee sort sur
    // son `items.length` vide. Les etapes de la formule ne sont pas lisibles
    // par la garde sous cette forme. Aucune formule ne vend aujourd hui une
    // installation a dotation finie (mesure du 2026-09-04 : les etapes de
    // ops-knowledge/formulas.json ne citent que des activites a units null,
    // et duckpin_bowling est le seul units>0 des trois centres). Le jour ou
    // une formule en vendra une, c est ICI qu il faudra deplier ses etapes en
    // programme avant l appel : la garde, elle, est deja universelle, c est
    // son ENTREE qui serait aveugle. Une formule MODIFIEE par le staff, elle,
    // transporte bien un programme et passe donc deja sous la garde.
    //
    // ELLE JUGE LE PLAN QUE LE MOTEUR VIENT DE POSER (2026-09-30) : ses blocs
    // disent quand le groupe entier est au bowling ou au laser, donc quand il
    // ne peut pas etre sur une piste de duckpin. Elle tourne donc apres
    // l aiguillage, et son refus remplace le plan.
    const isFormula = request.type === 'formule';
    const isDirectLaser = request.type === 'laser';
    // VISITE : le programme, pas le type, dit ce qu'il faut planifier. Sans ca,
    // une visite bowling + laser serait replanifiee comme un bowling seul
    // (request.type vaut 'bowling') et le laser disparaitrait du planning entre
    // l'ecran de reservation et la fiche staff.
    // Un dossier qui porte une FORMULE garde sa formule, adaptee a son
    // contenu : c est le seul chemin qui sait poser sa table anniversaire.
    const visitFormula = buildAdaptedFormula(request, body) || buildVisitFormula(request, operationalBowling, { staff });
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
      && !request.program
      && channel !== 'public'
      && (isFormula || isDirectLaser)
      && isTrustedClientPlan(request.opsPlan, request);
    // LE MOTIF VOYAGE DANS LE CHAMP QUI REMONTE. prepareReservationOps ne
    // renvoie que planResult.warning (sous le nom planWarning) : pose a null, la
    // phrase mourait dans reason, que personne ne relit. Cote STAFF le POST ne
    // regarde ni blockOnlineConfirmation ni planAvailable : la reservation
    // partait en base avec opsPlan NULL, validationStatus 'staff_review' et
    // AUCUNE raison a l ecran (mesure du 2026-09-04, comptoir, « bowling 1h +
    // duckpin 1h » sur une dotation saturee). Le motif atteint maintenant
    // api/staff-reservations.js (bloc ops) et le mail staff_review_request de
    // lib/ops-communications.js, tous deux deja cables pour l afficher. Le 409
    // public, lui, garde son propre message d alternatives : il ne depend que de
    // planResult.ok === false.
    planResult = isFreeVisit
        ? buildFreeVisitPlanResult(request)
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
            // Le nombre de pistes VOULU : le moteur ne le lit qu au comptoir,
            // au-dessus du minimum (planBowling).
            laneCount: request.laneCount,
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
    const planPose = planResult && planResult.plan && planResult.plan.recommended;
    const manque = dotationDepassee({ ...request, opsPlan: planPose || request.opsPlan || null }, reservations);
    if (manque) {
      const motifDotation = `${manque} est complet sur ce creneau.`;
      planResult = { ok: false, warning: motifDotation, reason: motifDotation, plan: null };
    }
  } catch (error) {
    // UNE BASE QUI NE REPOND PAS N EST PAS UN CRENEAU PRIS (2026-10-05). La
    // panne etait deguisee en « aucun plan » : le client lisait « choisissez un
    // autre horaire » et sa reservation se perdait. Elle remonte maintenant
    // telle quelle : l API la reconnait et transmet la demande au centre.
    if (estPanneBase(error)) throw error;
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
  let recommended = baseRecommended && requestLaserGames
    ? {
      ...baseRecommended,
      laserGames: requestLaserGames,
      games: requestLaserGames,
      laserPassPlan: baseRecommended.laserPassPlan
        ? { ...baseRecommended.laserPassPlan, totalGames: requestLaserGames }
        : baseRecommended.laserPassPlan,
    }
    : baseRecommended;
  // AU COMPTOIR, UNE PARTIE POSEE SE COMPTE (2026-10-08). Pour un laser seul,
  // la base et le moteur ne comptent une partie au-dela de la premiere que si
  // elle porte `manualLaserPass` (l ancien plan laissait les suivantes « a
  // placer »). Une visite laser seule pose chacune de ses parties a son heure :
  // sans la marque, sa 2e partie restait invisible pour le dossier suivant
  // (mesure : 20 + 20 joueurs acceptes a 15:30 sur 30 armes). Le tunnel garde
  // son comportement : seul le comptoir est touche.
  let areneConflits = [];
  if (staff && recommended && Array.isArray(recommended.resourceBlocks)) {
    if (request.type === 'laser') {
      recommended = {
        ...recommended,
        resourceBlocks: recommended.resourceBlocks.map((bloc) => (bloc && bloc.resourceType === 'laser_arena' && Number(bloc.countIndex || 1) > 1
          ? { ...bloc, manualLaserPass: true }
          : bloc)),
      };
    }
    if (areneDemandee(request) === 'seuls' && recommended.resourceBlocks.some((bloc) => bloc && bloc.resourceType === 'laser_arena')) {
      let capacite = 30;
      try { capacite = Math.trunc(Number(getCenter(centerId).resources.laser?.weaponCount) || 30); } catch (error) { capacite = 30; }
      const prive = privatiserArene(recommended, capacite);
      recommended = prive.plan;
      areneConflits = prive.conflits;
    }
  }
  if (recommended && recommended.ok !== false) {
    const { bowlingPlanQuote } = require('./bowling-allocation');
    const { getBasePrice, getBowlingGameOptions } = require('./booking-config');
    const center = getCenter(centerId);
    // `auPalier` : au comptoir, une duree hors grille (2 h 30) se facture au
    // palier puis a l unite (lib/prix-palier.js), jamais 0 EUR.
    const quote = bowlingPlanQuote(request.program, recommended, { centerId, dateStr: request.date, bowlingConfig: center.resources.bowling, auPalier: staff });
    if (quote.billedLaneCount) {
      const previousBase = Number(request.basePrice ?? request.programPrice ?? request.price) || 0;
      const extras = channel === 'public' ? 0 : (request.extras || []).reduce((sum, it) => sum + (Number(it.price) || 0), 0);
      const manualPrice = channel !== 'public' && Math.round(Number(request.price) * 100) !== Math.round((previousBase + extras) * 100);
      const perGame = request.type === 'bowling' && getBowlingGameOptions(center.resources.bowling, request.date, { pax: request.pax, laneCount: quote.billedLaneCount }) !== null;
      const basePrice = quote.program ? quote.program.price : perGame ? previousBase : getBasePrice(request.type, request.duration, quote.billedLaneCount, request.pax, request.formuleId, centerId, { bowlingConfig: center.resources.bowling, dateStr: request.date, auPalier: staff });
      if (quote.program) { request.program = quote.program; request.programPrice = basePrice; }
      request.basePrice = basePrice;
      if (!manualPrice) request.price = Math.round((basePrice + extras) * 100) / 100;
      request.laneCount = quote.laneCount;
      request.bowlingCapacity = quote.bowlingCapacity;
      request.emergencyWarning = quote.emergencyWarning;
    }
  }
  // UN DOSSIER CREE AU COMPTOIR SANS PRIX SE FACTURE A SA REFERENCE, EXTRAS
  // COMPRIS (2026-10-08). Le navigateur envoie d habitude le prix d un bowling,
  // d un laser ou d une formule ; quand il manquait, la base l ecrivait a 0 EUR
  // (normalizeReservationPayload : toNumber(undefined, 0)), y compris pour un
  // dossier « à placer », qui n a pas de plan pour le chiffrer. La reference
  // est celle du plan quand il y en a un (bowlingPlanQuote ci-dessus), sinon
  // la grille, au palier au-dela (lib/prix-palier.js : 4 parties, 2 h 30) ;
  // les extras s y ajoutent comme la console les compte. Un prix envoye, 0
  // compris, reste le prix facture : le comptoir decide. A la CREATION
  // seulement : une modification sans prix garde le prix enregistre, remise
  // comprise. Une visite est deja chiffree par normalizeReservationRequest.
  const creationSansPrix = staff && !ignoreReservationId && !request.program && prixEnvoye(request.price) === null;
  if (creationSansPrix) {
    if (!(Number(request.basePrice) > 0)) {
      const { getBasePrice, getRequiredLaneCount } = require('./booking-config');
      let bowlingConfig = null;
      try { bowlingConfig = getCenter(centerId).resources.bowling || null; } catch (error) { bowlingConfig = null; }
      const pistes = request.type === 'laser' ? 0
        : Math.max(Math.trunc(Number(request.laneCount) || 0), getRequiredLaneCount(request.type, request.pax, request.formuleId, bowlingConfig) || 0);
      request.basePrice = Math.round((Number(getBasePrice(request.type, request.duration, pistes, request.pax, request.formuleId || '', centerId,
        { bowlingConfig, dateStr: request.date, auPalier: true })) || 0) * 100) / 100;
    }
    request.price = prixAvecExtras(request.basePrice, request.extras);
  }
  const noSafePlan = planResult && planResult.ok === false;
  // LA VALIDATION SE DECIDE SUR LES FAITS DU PLAN (2026-10-05) : aucune place
  // sure (toujours), puis les situations que le centre a allumees dans
  // Etablissement > Regles, puis le mode de la formule (Tarifs & formules).
  const validation = decisionDeValidation({ recommended, planResult, request, centerId, channel });
  // Ce qui ne rentre pas : refuse en ligne (le client voit d autres horaires),
  // jamais « a valider ». Au comptoir, la personne qui force un dossier le
  // voit marque « a verifier », sans mail.
  const validationStatus = request.validationStatus
    || (validation.requise || (channel !== 'public' && validation.impossible) ? 'staff_review' : 'confirmed');
  const plannedTotalDuration = recommended?.totalMinutes
    ? Math.ceil(Number(recommended.totalMinutes) / 30) / 2
    : 0;
  const totalDuration = plannedTotalDuration
    ? Math.max(Number(request.totalDuration || request.duration || 0), plannedTotalDuration)
    : request.totalDuration;
  const normalizedVisit = request.program ? {
    program: request.program,
    type: request.type,
    label: request.label,
    programPrice: request.programPrice,
    basePrice: request.basePrice,
    price: request.price,
    duration: request.duration,
    laneCount: request.laneCount,
    requiresLanes: request.requiresLanes,
    laserGames: request.laserGames,
    games: request.games,
    gameCount: request.gameCount,
  } : {};

  return {
    ...normalizedVisit,
    ...(recommended?.resourceBlocks?.some((b) => b.resourceType === 'bowling_lane') ? {
      price: request.price, basePrice: request.basePrice, laneCount: request.laneCount,
      bowlingCapacity: request.bowlingCapacity, emergencyWarning: request.emergencyWarning,
    } : {}),
    ...(creationSansPrix ? { price: request.price, basePrice: request.basePrice } : {}),
    centerId,
    ...(totalDuration ? { totalDuration } : {}),
    ...(channel === 'public' && recommended?.startTime ? { startTime: recommended.startTime } : {}),
    // La decision voyage DANS le plan enregistre (ops_plan, jsonb) : aucune
    // colonne a ajouter, et la console la relit avec la reservation.
    opsPlan: recommended ? { ...recommended, validation: resumeValidation(validation) } : recommended,
    riskLevel: recommended?.risk?.level || '',
    riskScore: recommended?.risk?.score ?? null,
    validationStatus,
    requiresHumanReview: validationStatus === 'staff_review',
    autoDecision: validationStatus === 'staff_review' ? 'human_review_required' : 'auto_confirmed',
    blockOnlineConfirmation: channel === 'public' && (noSafePlan || validation.impossible),
    planAvailable: !noSafePlan,
    // L avertissement du comptoir (une formule hors vacances reservee ici,
    // lib/ops-engine planFormula) s ajoute a celui du plan : la fenetre le dit
    // avant le clic, en orange.
    planWarning: [planResult?.warning || request.emergencyWarning, !noSafePlan && planResult?.plan?.avertissementComptoir].filter(Boolean).join(' ') || null,
    // POURQUOI LE MOTEUR N A PAS DE PLAN (2026-10-08). Un refus d ancres
    // (« Choisissez une heure pour Bowling. », heure hors grille, arene pleine)
    // revient dans `reason`, que planWarning ne lit pas : la fenetre Reserver
    // le montre avant la creation. Champ a part, lu par la seule simulation.
    // Un scenario refuse par ses conflits (arene pleine pour un laser seul)
    // n a ni raison ni avertissement : son premier conflit bloquant le dit.
    // LA RAISON DU MOTEUR EST DANS SON PLAN (2026-10-12) : planningAgent
    // (lib/ops-agents.js) rend { ok, plan } et le refus vit dans plan.reason.
    // Lu seulement au premier niveau, il manquait toujours, et la fenetre
    // affichait « Pas de plan possible à cette heure. » a la place de « F4
    // indisponible pendant les vacances » ou « Minimum 6 personnes ».
    planRefusal: noSafePlan ? String(motifDuPlan(planResult)
      || ((recommended && Array.isArray(recommended.conflicts) ? recommended.conflicts : []).find((conflit) => conflit && conflit.severity === 'blocking') || {}).message || '') : '',
    // L arene demandee pour le groupe seul et deja occupee : la fenetre le dit
    // (conflit « arene »), la creation sans `forcer` est refusee par la base
    // (la session deborde), et « Créer quand même » la pose a placer.
    ...(areneConflits.length ? { areneConflits } : {}),
    validation: resumeValidation(validation),
  };
}

function estPanneBase(error) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || '');
  return ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', '57P01', '57P03', '53300', '08000', '08001', '08003', '08004', '08006'].includes(code)
    || /ECONNREFUSED|ETIMEDOUT|ECONNRESET|getaddrinfo|Connection terminated|terminating connection|too many clients|connect timeout/i.test(message);
}

// LE MOTIF D UN PLAN REFUSE : celui du premier niveau (dotation complete,
// visite libre, plan de confiance), sinon celui du moteur, que planningAgent
// range dans `plan` (planReservation rend { ok: false, reason }).
function motifDuPlan(planResult, { avertissementDabord = false } = {}) {
  if (!planResult || typeof planResult !== 'object') return '';
  const haut = avertissementDabord ? [planResult.warning, planResult.reason] : [planResult.reason, planResult.warning];
  const moteur = planResult.plan && typeof planResult.plan === 'object' ? [planResult.plan.reason, planResult.plan.warning] : [];
  const motif = [...haut, ...moteur].find((valeur) => typeof valeur === 'string' && valeur.trim());
  return motif ? motif.trim() : '';
}

// UNE SEULE DECISION POUR TOUS LES CHEMINS (creation publique, blocage des
// horaires, comptoir, modification). Le reglage du centre et l heure de
// fermeture du jour sont relus ici : un centre qui change de niveau le voit
// sur la reservation suivante.
function decisionDeValidation({ recommended = null, planResult = null, request = {}, centerId = '', channel = 'public' } = {}) {
  let center = null;
  try { center = getCenter(centerId); } catch (error) { center = null; }
  let schedule = null;
  try { schedule = require('./booking-config').getSchedule(request.date, center); } catch (error) { schedule = null; }
  // « Impossible » = le moteur a ECHOUE, rien d autre. Un plan reussi sans bloc
  // recommande (une visite d activites libres) se confirmait avant : il se
  // confirme toujours.
  const echec = planResult && planResult.ok === false;
  const plan = echec
    ? { ...(recommended || {}), ok: false, reason: motifDuPlan(planResult, { avertissementDabord: true }) }
    : (recommended || { ok: true, conflicts: [], resourceBlocks: [] });
  const detectees = detecterSituations({ plan, request, schedule, pax: request.pax });
  const modeFormule = (planResult && planResult.plan && planResult.plan.validationMode) || '';
  // AU COMPTOIR, la personne qui saisit EST l equipe : seules l impossibilite et
  // une formule « toujours validee » mettent le dossier en validation ; les
  // situations du niveau restent visibles « a surveiller ».
  const reglage = channel === 'staff' ? { niveau: 'minimal', situations: {} } : (center && center.validationEquipe) || null;
  return decisionValidation({ detectees, reglage, modeFormule });
}

// Ce que la reservation garde de la decision : des mots et des faits, lisibles
// par la console et le mail de l equipe. Jamais servi au public (il nomme
// parfois la taille d un autre groupe) : voir sansValidationInterne.
function resumeValidation(decision) {
  if (!decision) return null;
  return {
    requise: Boolean(decision.requise),
    niveau: decision.niveau,
    declencheurs: (decision.declencheurs || []).map(({ id, mot, detail, phrase }) => ({ id, mot, detail, phrase })),
    aSurveiller: (decision.aSurveiller || []).map(({ id, mot, detail, phrase }) => ({ id, mot, detail, phrase })),
    raison: decision.raison || '',
  };
}

function sansValidationInterne(objet) {
  if (!objet || typeof objet !== 'object') return objet;
  const copie = { ...objet };
  delete copie.validation;
  if (copie.opsPlan && typeof copie.opsPlan === 'object' && 'validation' in copie.opsPlan) {
    copie.opsPlan = { ...copie.opsPlan };
    delete copie.opsPlan.validation;
  }
  return copie;
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

  // LA CONFIRMATION PART DANS LA REQUETE (2026-09-05). Le worker Railway
  // n existe plus depuis le 23 juillet et le cron Vercel ne passe que toutes
  // les trois heures : l ecran de fin promettait « le mail arrive dans
  // quelques minutes » et le client attendait la prochaine fournee, quand
  // elle arrivait jusqu a lui. Seules les lignes DUES de CE dossier partent
  // ici (la confirmation ou l accuse de reception) ; le rappel J-2 garde son
  // heure. Un envoi qui echoue ne fait pas echouer la reservation : la ligne
  // reste en file pour le cron, et le motif remonte en avertissement.
  // LA COPIE DE SECOURS part en meme temps que la confirmation (2026-10-05) :
  // la boite de secours du centre a chaque reservation, entiere, des sa
  // creation, par le formulaire comme au comptoir.
  const { copieSecours } = require('./secours-envoi');
  await Promise.all([
    reservation.id
      ? dispatchDueCommunications({ limit: 5, centerId: reservation.centerId || '', reservationId: reservation.id })
        .catch((error) => { warnings.push(`dispatch:${error.message}`); })
      : null,
    copieSecours(reservation, { evenement: 'nouvelle' }).then((r) => { if (r && r.erreur) warnings.push(`secours:${r.erreur}`); }),
  ]);

  return { warnings, communications };
}

module.exports = {
  afterReservationCreated,
  // La garde de dotation, lue aussi par la disponibilite publique : l ecran
  // des heures juge chaque heure avec la MEME fonction que la validation.
  dotationDepassee,
  decisionDeValidation,
  prepareReservationOps,
  resumeValidation,
  sansValidationInterne,
};
