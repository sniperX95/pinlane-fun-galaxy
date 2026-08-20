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
  LASER_GAME_OPTIONS,
  getBasePrice,
  getRequiredLaneCount,
} = require('./booking-config');
const {
  activityEstimatedMinutes,
  activityLinePrice,
  listCenterActivities,
} = require('./activity-catalog');

// Un panier plus long que le catalogue lui-meme est forcement forge.
const MAX_ITEMS = 12;
const SYNTHETIC_FORMULA_ID = 'visite';
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
function normalizeProgram(input, { centerId = 'libramont', pax = 1, bowlingConfig = null, dateStr = '', startTime = '' } = {}) {
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

    if (activityId === BOWLING_ID) {
      item.duration = normalizeDurationHours(raw && (raw.duration ?? raw.durationHours));
      item.minutes = Math.round(item.duration * 60);
      item.laneCount = getRequiredLaneCount('bowling', people, '', bowlingConfig);
      // bowlingConfig + date : un centre qui vend AUX PARTIES facture par
      // personne et selon le jour. Sans eux, la ligne de programme partirait au
      // prix de la grille par piste, different de ce que le tunnel affiche.
      item.price = getBasePrice('bowling', item.duration, item.laneCount, people, '', centerId, { bowlingConfig, dateStr });
      item.priceKnown = item.price > 0;
    } else if (activityId === LASER_ID) {
      const option = normalizeGames(raw && (raw.games ?? raw.laserGames));
      item.games = Number(option.games);
      item.duration = Number(option.value);
      item.minutes = Number(option.durationMinutes) || Math.round(option.value * 60);
      item.price = getBasePrice('laser', option.value, 0, people, '', centerId);
      item.priceKnown = item.price > 0;
    } else {
      if (activity.priceType === 'per_unit_hour') {
        item.units = Math.min(20, Math.max(1, Math.trunc(Number(raw && raw.units) || 1)));
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
      item.minutes = activityEstimatedMinutes(activity, { hours: item.hours == null ? null : item.hours });
      // dateStr + startTime : un palier de tarif borne par le jour ou l'heure
      // (migration 0043) ne peut s'appliquer que si on les connait. Sans
      // creneau, c'est le prix de BASE : le montant ne peut que baisser une
      // fois l'heure choisie, jamais monter.
      const price = activityLinePrice(activity, {
        pax: item.participants || people, units: item.units, hours: item.hours, dateStr, startTime,
      });
      item.price = price;
      item.priceKnown = price != null;
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
    if (item.units) return `${item.name} ${item.units}x ${formatHours(item.hours)}`;
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

function formatHours(value) {
  const hours = Number(value) || 0;
  if (!hours) return '';
  if (Number.isInteger(hours)) return `${hours}h`;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return whole ? `${whole}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}

module.exports = {
  MAX_ITEMS,
  SYNTHETIC_FORMULA_ID,
  buildProgramFormula,
  describeProgram,
  normalizeProgram,
  programReservationType,
};
