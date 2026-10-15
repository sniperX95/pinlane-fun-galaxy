// LE PLAN DIT LA MEME CHOSE QUE LA FICHE : MEME PISTE, MEME HEURE, MEME DUREE.
//
// Movsar, 2026-08-20 : « sur le planning bowling quand on veut modifier les
// choses d'une resa genre la piste ou le temps ça fonctionne pas ».
// Mesure au harnais, sur le VRAI chemin serveur (lib/reservation-ops +
// lib/ops-engine + lib/database), zero DB et zero reseau :
//
//   1. le moteur ne lisait JAMAIS les pistes demandees. Le staff coche la piste
//      5, la ligne de la reservation enregistre 5, et le PLAN ecrit 1 (la
//      premiere libre). Le planning se dessine depuis le plan : la carte ne
//      bougeait pas. Deux ecrans, deux verites.
//   2. une MODIFICATION reprenait le plan deja enregistre tel quel
//      (isTrustedClientPlan) : formule deplacee a 16:00 sur les pistes 1-2 ->
//      plan rendu 15:00 pistes 4-5, avec « Réservation mise à jour ».
//   3. une visite (plusieurs activites) replanifiait sur les ANCIENNES ancres :
//      son laser restait a l'heure d'avant le deplacement.
//
// Le gate prouve les trois, avec leur contre-epreuve : une piste demandee mais
// OCCUPEE ne bloque rien (le moteur reprend la main) et le plan reste coherent
// avec la ligne. Une regression sur l'un des trois rougit ici.
//
// Lancement : node scripts/plan-lane-fidelity-check.js

const path = require('path');

// -- Faux pool pg installe AVANT tout require applicatif (aucune base) --------
class InertPool {
  constructor(options = {}) { this.options = options; }
  async query() { return { rows: [], rowCount: 0 }; }
  async connect() { return { query: async () => ({ rows: [], rowCount: 0 }), release() {} }; }
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: InertPool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/gate';
process.env.DATABASE_SSL = 'disable';

const { prepareReservationOps } = require(path.join(__dirname, '..', 'lib', 'reservation-ops.js'));
const { normalizeReservationRequest } = require(path.join(__dirname, '..', 'lib', 'reservation-request.js'));
const { validateReservationResources } = require(path.join(__dirname, '..', 'lib', 'database.js'));

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// Le prochain samedi : Libramont ouvre 10:00-24:00 ce jour-la, donc aucune
// assertion ne depend de l'heure a laquelle le gate tourne. Hors vacances et
// feries (scripts/jour-de-test.js) : la formule 4 ne s y reserve pas.
const DATE = require('./jour-de-test').jourDeTest({ jour: 6 });
const ALL_LANES_FREE = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, 'active']));

function stateOf(reservations = []) {
  return async () => ({ reservations, laneStatuses: ALL_LANES_FREE });
}

function bowlingBlocks(ops) {
  return ((ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((block) => block.resourceType === 'bowling_lane');
}
function laserBlocks(ops) {
  return ((ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((block) => block.resourceType === 'laser_arena');
}
function lanesOf(block) {
  return (block && Array.isArray(block.lanes) ? block.lanes : []).map(Number).sort((left, right) => left - right).join(',');
}

const BOWLING = {
  id: 1000, centerId: 'libramont', channel: 'staff', name: 'TEST', phone: '+32400000000',
  email: 't@x.be', date: DATE, startTime: '15:00', duration: 1, totalDuration: 1,
  lanes: [4], pax: 4, status: 'pending', basePrice: 40, price: 40, type: 'bowling',
  formuleId: '', label: 'Bowling Classique', extras: [], laneCount: 1, requiresLanes: true,
  opsPlan: {
    ok: true, startTime: '15:00', endTime: '16:00', totalMinutes: 60, assignedLanes: [4], conflicts: [],
    risk: { level: 'low', score: 10, reasons: [] }, timeline: [],
    resourceBlocks: [{ activityId: 'bowling', resourceType: 'bowling_lane', start: 900, end: 960, startTime: '15:00', endTime: '16:00', requiredLanes: 1, lanes: [4] }],
  },
};

const VISITE = {
  id: 3000, centerId: 'libramont', channel: 'public', name: 'VISITE', phone: '+32400000001',
  email: 'v@x.be', date: DATE, startTime: '15:00', duration: 1, totalDuration: 2.5,
  lanes: [1, 2], pax: 8, status: 'pending', basePrice: 0, price: 250, type: 'bowling',
  formuleId: '', label: 'Bowling 1h · Laser 3 parties', extras: [], laneCount: 2, requiresLanes: true,
  program: {
    items: [
      { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, minutes: 60, price: 100, priceKnown: true },
      { activityId: 'laser_game', name: 'Laser Game', planned: true, games: 3, duration: 1.5, minutes: 90, price: 150, priceKnown: true },
    ],
    price: 250, priceComplete: true,
  },
  opsPlan: {
    ok: true, startTime: '15:00', endTime: '16:55', totalMinutes: 115, assignedLanes: [1, 2], conflicts: [],
    risk: { level: 'low', score: 10, reasons: [] }, timeline: [],
    resourceBlocks: [
      { activityId: 'bowling', resourceType: 'bowling_lane', start: 900, end: 960, startTime: '15:00', endTime: '16:00', requiredLanes: 2, lanes: [1, 2], players: 8 },
      { activityId: 'laser_game', resourceType: 'laser_arena', start: 990, end: 1015, startTime: '16:30', endTime: '16:55', countIndex: 1, players: 8 },
    ],
    laserPassPlan: {
      mode: 'manual_after_first', totalGames: 3, scheduledGames: 1, remainingGames: 2,
      scheduledPasses: [{ countIndex: 1, status: 'scheduled', startTime: '16:30' }],
      pendingPasses: [{ countIndex: 2, status: 'pending' }, { countIndex: 3, status: 'pending' }],
    },
  },
};

async function testCreationSurLaCaseCliquee() {
  console.log('\n[1] CREATION depuis une case du planning : la piste cliquee est la piste planifiee');
  const request = normalizeReservationRequest({
    centerId: 'libramont', channel: 'staff', name: 'CASE 5', phone: '+32400000000', email: '',
    date: DATE, startTime: '15:00', duration: 1, pax: 4, type: 'bowling',
    lanes: [5], laneCount: 1, requiresLanes: true,
  }, { channel: 'staff' });
  const ops = await prepareReservationOps(request, 'staff', { readState: stateOf([]) });
  const blocks = bowlingBlocks(ops);
  ok(blocks.length === 1, `un bloc bowling planifie (${blocks.length})`);
  ok(lanesOf(blocks[0]) === '5', `le bloc porte la piste CLIQUEE, pas la premiere libre (${lanesOf(blocks[0])})`);
  ok((ops.opsPlan.assignedLanes || []).join(',') === '5', `assignedLanes suit (${(ops.opsPlan.assignedLanes || []).join(',')})`);
}

async function testModificationPisteEtDuree() {
  console.log('\n[2] MODIFICATION bowling : piste 5 + 1h30 (la capture de Movsar)');
  const patch = { ...BOWLING, duration: 1.5, lanes: [5], laneCount: 1, channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: BOWLING.id, readState: stateOf([BOWLING]) });
  const block = bowlingBlocks(ops)[0];
  ok(Boolean(block), 'un bloc bowling est planifie');
  ok(lanesOf(block) === '5', `le plan place la reservation sur la piste 5 (${lanesOf(block)})`);
  ok(block && block.startTime === '15:00' && block.endTime === '16:30',
    `le plan dure 1h30 comme la fiche (${block ? `${block.startTime}-${block.endTime}` : 'aucun bloc'})`);
}

async function testPisteOccupeeNeBloquePas() {
  console.log('\n[3] CONTRE-EPREUVE : une piste demandee mais OCCUPEE ne bloque rien');
  const voisine = {
    ...BOWLING, id: 1001, lanes: [5], startTime: '15:00', duration: 1,
    opsPlan: {
      ...BOWLING.opsPlan, assignedLanes: [5],
      resourceBlocks: [{ ...BOWLING.opsPlan.resourceBlocks[0], lanes: [5] }],
    },
  };
  const patch = { ...BOWLING, lanes: [5], laneCount: 1, channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: BOWLING.id, readState: stateOf([BOWLING, voisine]) });
  const block = bowlingBlocks(ops)[0];
  ok(Boolean(block), 'le moteur rend quand meme un plan (aucun refus)');
  ok(block && lanesOf(block) !== '5', `la piste 5 etant prise, le moteur en attribue une autre (${lanesOf(block)})`);
  ok(ops.planAvailable === true, 'le creneau reste planifiable');
}

async function testFormuleDeplacee() {
  console.log('\n[4] MODIFICATION formule : le plan deja enregistre ne fait plus foi');
  const formule = {
    ...BOWLING, id: 2000, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', pax: 8,
    lanes: [4, 5], laneCount: 2, duration: 1, totalDuration: 2,
    opsPlan: {
      ...BOWLING.opsPlan, assignedLanes: [4, 5],
      resourceBlocks: [
        { activityId: 'bowling', resourceType: 'bowling_lane', start: 900, end: 960, startTime: '15:00', endTime: '16:00', requiredLanes: 2, lanes: [4, 5] },
        { activityId: 'laser_game', resourceType: 'laser_arena', start: 975, end: 1000, startTime: '16:15', endTime: '16:40', countIndex: 1, players: 8 },
      ],
    },
  };
  const patch = { ...formule, startTime: '16:00', lanes: [1, 2], laneCount: 2, channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: formule.id, readState: stateOf([formule]) });
  const block = bowlingBlocks(ops)[0];
  ok(Boolean(block), 'un bloc bowling est planifie');
  ok(block && block.startTime === '16:00', `le bowling part a l heure DEMANDEE (${block ? block.startTime : 'aucun bloc'})`);
  ok(lanesOf(block) === '1,2', `sur les pistes DEMANDEES (${lanesOf(block)})`);
}

// UNE VISITE QUI NE MOBILISE AUCUNE RESSOURCE (arcades seules, minigolf seul).
// Elle ne passe PAS par le moteur : buildFreeVisitPlanResult lui construit son
// plan a la main. Duree reelle du catalogue : 30 minutes.
const VISITE_LIBRE = {
  id: 4000, centerId: 'libramont', channel: 'staff', name: 'ARCADE', phone: '+32400000002',
  email: 'a@x.be', date: DATE, startTime: '15:00', duration: 0.5, totalDuration: 0.5,
  lanes: [], pax: 4, status: 'pending', basePrice: 0, price: 40, type: 'visite',
  formuleId: '', label: 'Arcades', extras: [], laneCount: 0, requiresLanes: false,
  program: {
    items: [
      { activityId: 'arcade_time', name: 'Arcades', planned: false, duration: 0.5, minutes: 30, price: 40, priceKnown: true },
    ],
    price: 40, priceComplete: true,
  },
  opsPlan: {
    ok: true, startTime: '15:00', endTime: '15:30', totalMinutes: 30, assignedLanes: [], conflicts: [],
    risk: { level: 'low', score: 10, reasons: [] }, timeline: [],
    resourceBlocks: [
      { activityId: 'arcade_time', resourceType: 'soft_capacity', start: 900, end: 930, startTime: '15:00', endTime: '15:30', countIndex: 1 },
    ],
  },
};

function softBlocks(ops) {
  return ((ops.opsPlan && ops.opsPlan.resourceBlocks) || []).filter((block) => block.resourceType === 'soft_capacity');
}

async function testVisiteDeplacee() {
  console.log('\n[5] MODIFICATION visite : tout l enchainement suit le deplacement');
  const patch = { ...VISITE, startTime: '16:00', lanes: [5, 6], laneCount: 2, channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: VISITE.id, readState: stateOf([VISITE]) });
  const bowling = bowlingBlocks(ops)[0];
  const laser = laserBlocks(ops)[0];
  ok(bowling && bowling.startTime === '16:00', `le bowling suit l heure demandee (${bowling ? bowling.startTime : 'aucun bloc'})`);
  ok(lanesOf(bowling) === '5,6', `sur les pistes demandees (${lanesOf(bowling)})`);
  ok(laser && laser.startTime === '17:30', `le laser est decale du MEME ecart, +1h (${laser ? laser.startTime : 'aucun bloc'})`);
  const pass = ops.opsPlan && ops.opsPlan.laserPassPlan;
  ok(pass && pass.totalGames === 3 && pass.remainingGames === 2,
    `les 3 parties vendues restent comptees, 2 a placer (${JSON.stringify(pass && { t: pass.totalGames, r: pass.remainingGames })})`);
}

// Movsar, revue manager du 2026-08-26 : « les reservations de 30 minutes dont le
// changement d heure ne s applique pas ». Reproduit ici : une visite SANS
// ressource planifiee voit son startTime bouger, mais les blocs de son plan
// restent a l ancienne heure - donc le planning continue de la dessiner ou elle
// etait. Meme defaut de fond que [5], sur l autre chemin de planification.
async function testVisiteLibreDeplacee() {
  console.log('\n[5 bis] MODIFICATION visite SANS ressource : les blocs suivent l heure');
  const patch = { ...VISITE_LIBRE, startTime: '16:00', channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: VISITE_LIBRE.id, readState: stateOf([VISITE_LIBRE]) });
  const bloc = softBlocks(ops)[0];
  ok(ops.opsPlan && ops.opsPlan.startTime === '16:00',
    `le plan part a l heure demandee (${ops.opsPlan && ops.opsPlan.startTime})`);
  ok(bloc && bloc.startTime === '16:00',
    `le bloc de l activite suit l heure demandee (${bloc ? `${bloc.startTime}-${bloc.endTime}` : 'aucun bloc'})`);
  ok(bloc && bloc.endTime === '16:30',
    `et garde ses 30 minutes (${bloc ? `${bloc.startTime}-${bloc.endTime}` : 'aucun bloc'})`);
  // CONTRE-EPREUVE : a la CREATION, rien n a bouge, le bloc reste ou il est.
  const creation = await prepareReservationOps({ ...VISITE_LIBRE, channel: 'staff', allowPastStart: true }, 'staff', { readState: stateOf([]) });
  const blocNeuf = softBlocks(creation)[0];
  ok(blocNeuf && blocNeuf.startTime === '15:00',
    `a la creation le bloc ne se decale pas tout seul (${blocNeuf ? blocNeuf.startTime : 'aucun bloc'})`);
}

function testEcritureCoherente() {
  console.log('\n[6] A L ECRITURE : le plan porte les pistes REELLEMENT attribuees');
  // Le plan arrive avec la piste 1 (attribution automatique d'un vieux plan),
  // la demande porte la piste 5 : c'est la piste 5 qui doit finir PARTOUT.
  const resultat = validateReservationResources({
    ...BOWLING, lanes: [5], laneCount: 1,
    opsPlan: { ...BOWLING.opsPlan, assignedLanes: [1], resourceBlocks: [{ ...BOWLING.opsPlan.resourceBlocks[0], lanes: [1] }] },
  }, [], ALL_LANES_FREE);
  const planLanes = (resultat.payload.opsPlan.resourceBlocks[0].lanes || []).join(',');
  ok(resultat.lanes.join(',') === '5', `la ligne enregistre la piste 5 (${resultat.lanes.join(',')})`);
  ok(planLanes === '5', `le plan enregistre la MEME piste (${planLanes})`);
  ok((resultat.payload.opsPlan.assignedLanes || []).join(',') === '5', 'assignedLanes du plan suit aussi');
}

async function testDureeDeFormule() {
  console.log('\n[7] MODIFICATION formule : la duree saisie au comptoir vaut pour le plan');
  const formule = {
    ...BOWLING, id: 2001, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', pax: 8,
    lanes: [4, 5], laneCount: 2, duration: 1, totalDuration: 2,
    opsPlan: {
      ...BOWLING.opsPlan, assignedLanes: [4, 5],
      resourceBlocks: [
        { activityId: 'bowling', resourceType: 'bowling_lane', start: 900, end: 960, startTime: '15:00', endTime: '16:00', requiredLanes: 2, lanes: [4, 5] },
        { activityId: 'laser_game', resourceType: 'laser_arena', start: 975, end: 1000, startTime: '16:15', endTime: '16:40', countIndex: 1, players: 8 },
      ],
    },
  };
  const patch = { ...formule, duration: 1.5, laneCount: 2, channel: 'staff', allowPastStart: true };
  const ops = await prepareReservationOps(patch, 'staff', { ignoreReservationId: formule.id, readState: stateOf([formule]) });
  const block = bowlingBlocks(ops)[0];
  ok(block && block.startTime === '15:00' && block.endTime === '16:30',
    `le bowling de la formule dure 1h30 comme la fiche (${block ? `${block.startTime}-${block.endTime}` : 'aucun bloc'})`);

  // CONTRE-EPREUVE : cote PUBLIC la formule reste celle du catalogue. Une
  // requete forgee ne s'offre pas quatre heures de piste a 39 EUR.
  const publicOps = await prepareReservationOps({
    centerId: 'libramont', channel: 'public', name: 'FORGE', phone: '+32400000000', email: 'f@x.be',
    date: DATE, startTime: '15:00', duration: 4, pax: 8, type: 'formule', formuleId: 'f4',
  }, 'public', { readState: stateOf([]) });
  const publicBlock = bowlingBlocks(publicOps)[0];
  ok(publicBlock && publicBlock.endTime === '16:00',
    `cote public, la formule garde l heure de bowling du catalogue (${publicBlock ? `${publicBlock.startTime}-${publicBlock.endTime}` : 'aucun bloc'})`);
}

(async () => {
  await testCreationSurLaCaseCliquee();
  await testModificationPisteEtDuree();
  await testPisteOccupeeNeBloquePas();
  await testFormuleDeplacee();
  await testVisiteDeplacee();
  await testVisiteLibreDeplacee();
  await testDureeDeFormule();
  testEcritureCoherente();

  console.log('');
  if (failures) {
    console.log(`plan-lane-fidelity-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('plan-lane-fidelity-check: ALL OK');
})().catch((error) => {
  console.error('plan-lane-fidelity-check: exception', error);
  process.exit(1);
});
