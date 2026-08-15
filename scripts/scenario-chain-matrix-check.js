// LE GATE MATRICE DES SCENARIOS CALCULES (2026-08-15).
//
// LA REGLE PRODUIT QU'IL VERROUILLE, la seule qui nous distingue vraiment :
// le concurrent fait choisir au client une heure PAR activite en ne retirant
// que les heures deja prises ; le client peut s'assembler un programme creux ou
// infaisable. Chez nous, le moteur CALCULE les enchainements realisables sur
// l'inventaire commun (capacites, remise en etat, transitions, horaires) et NE
// PROPOSE QUE des scenarios qui tiennent. Le client choisit un scenario,
// jamais une liste d'heures a assembler lui-meme.
//
// CE QUE CE GATE PROUVE, sur une MATRICE et pas un cas :
//   croisement de : nombre d'activites enchainees (1 a 4) x ressources
//   partagees ou non x capacites (unites, joueurs par unite) x temps de remise
//   en etat (0 a 20 min) x charge du planning (jour vide, jour charge) x
//   mixage de groupes (off/on) x effectif par etape (P2) x etape optionnelle
//   (P2) x contrainte d'ordre (P3).
// Et pour CHAQUE cellule, les DEUX sens, parce qu'un gate a un seul tranchant
// ne prouve rien :
//   (a) aucune combinaison IMPOSSIBLE n'est jamais proposee : chaque scenario
//       propose est REJOUE bloc par bloc contre un ORACLE independant
//       (balayage minute par minute, implementation distincte du moteur) ;
//   (b) aucune combinaison POSSIBLE n'est jamais masquee : l'oracle enumere
//       tous les departs realisables de la grille et exige que le moteur les
//       propose TOUS (egalite d'ensembles stricte, pas d'inclusion).
// CONTRE-EPREUVES PAR MUTATION, dans les deux sens :
//   A1. un scenario forge sur une fenetre occupee est injecte dans la liste
//       proposee : le verificateur (a) DOIT rougir ;
//   A2. la ressource est re-declaree SANS remise en etat pendant que l'oracle
//       la garde : un moteur qui ignorerait la remise en etat proposerait de
//       l'impossible, le sens (a) DOIT le voir ;
//   B1. un scenario propose est retire de la liste : le verificateur (b) DOIT
//       voir le depart masque ;
//   B2. la ressource est re-declaree AVEC remise en etat pendant que l'oracle
//       n'en a pas : un moteur qui sur-masquerait, le sens (b) DOIT le voir.
//
// L'ORACLE EST UNE CONTRE-IMPLEMENTATION : il ne require RIEN du moteur. Ses
// constantes (grille 30, transition 5, accueil 10, marge de fin 30, pas 15)
// sont la SPEC du produit, redeclarees ici. Si le moteur derive de la spec, ce
// gate rougit : c'est son role.
//
// Zero reseau, zero base : le centre de test n'existe QUE par
// applyCenterRecords (le chemin d'un centre cree en console), et ses ressources
// n'existent QUE par la donnee resources.declared. C'est aussi la preuve P1 :
// aucune ligne de code, aucun deploiement, la declaration suffit.
// Lancement : node scripts/scenario-chain-matrix-check.js

process.env.NODE_ENV = 'test';

const { applyCenterRecords } = require('../lib/ops-knowledge');
const engine = require('../lib/ops-engine');

let failures = 0;
let cellCount = 0;
let startsChecked = 0;
let proposalsReplayed = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n${title}`); }

// ── LA SPEC (redeclaree, jamais importee du moteur) ─────────────────────────
const GRID = 30;            // tout depart client tombe sur :00/:30
const SLOT_STEP = 15;       // pas interne de la fenetre horaire
const TRANSITION = 5;       // minutes entre deux activites enchainees
const ARRIVAL = 10;         // accueil avant la premiere activite
const END_MARGIN = 30;      // marge de fin de journee sur le dernier depart
const OPEN_MIN = 10 * 60;   // le centre de test ouvre 10:00
const CLOSE_MIN = 20 * 60;  // et ferme 20:00

const CENTER_ID = 'matrix-center';

// Les pools declares du centre de test. C'est LA DONNEE qui remplace les
// constantes de code : le gate ne touche jamais une ligne du moteur pour
// exister.
const DECLARED = [
  { id: 'salle_a', name: 'Salle A', units: 1, capacityPerUnit: 10, cleanupMinutes: 0, allowGroupMixing: false },
  { id: 'salle_b', name: 'Salle B', units: 1, capacityPerUnit: 10, cleanupMinutes: 20, allowGroupMixing: false },
  { id: 'duo', name: 'Duo', units: 2, capacityPerUnit: 4, cleanupMinutes: 15, allowGroupMixing: false },
  { id: 'mix_arena', name: 'Arene mixable', units: 1, capacityPerUnit: 12, cleanupMinutes: 0, allowGroupMixing: true },
];

function declareCenter(declared = DECLARED) {
  applyCenterRecords([{
    id: CENTER_ID,
    name: 'Matrix Center',
    status: 'active',
    timezone: 'Europe/Brussels',
    config: {
      status: 'active',
      defaultSchedule: {
        regular: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, { open: '10:00', close: '20:00' }])),
      },
      resources: { declared },
    },
  }]);
}

// Un mercredi a venir (jamais aujourd'hui, jamais un week-end : le risque
// week-end ne doit pas dependre du jour ou le gate tourne).
function nextWednesday(minDaysAhead = 3) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < minDaysAhead; i += 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() !== 3) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}
const DATE = nextWednesday();

// ── L'ORACLE (contre-implementation independante) ───────────────────────────
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const toTime = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
const ceilTo = (v, step) => Math.ceil(v / step) * step;

function declOf(declared, resourceType) {
  return declared.find((d) => d.id === resourceType) || null;
}

// Pose la chaine a un depart donne : sequentielle, TRANSITION minutes entre
// deux activites, aucune autre regle.
function layoutChain(steps, startMinutes) {
  let cursor = startMinutes;
  const blocks = [];
  steps.forEach((step, index) => {
    blocks.push({
      resourceType: step.resourceType,
      start: cursor,
      end: cursor + step.durationMinutes,
      players: Number(step.pax || step.groupPax),
    });
    cursor += step.durationMinutes;
    if (index < steps.length - 1) cursor += TRANSITION;
  });
  return { blocks, end: cursor };
}

// Capacite d'un jeu de blocs sur les pools declares, minute par minute.
// Sessions = fenetre exacte identique ; mixage : les joueurs s'additionnent et
// remplissent les installations ensemble ; sinon chaque groupe garde les
// siennes ; la remise en etat etend l'occupation de l'installation.
function oracleCapacityOk(declared, allBlocks) {
  for (const decl of declared) {
    const mine = allBlocks.filter((b) => b.resourceType === decl.id);
    if (!mine.length) continue;
    const sessions = new Map();
    mine.forEach((b) => {
      const key = `${b.start}-${b.end}`;
      if (!sessions.has(key)) sessions.set(key, { start: b.start, end: b.end, players: 0, units: 0 });
      const s = sessions.get(key);
      s.players += Math.max(1, Number(b.players || 1));
      s.units += Math.ceil(Math.max(1, Number(b.players || 1)) / decl.capacityPerUnit);
    });
    const occupations = [...sessions.values()].map((s) => ({
      start: s.start,
      end: s.end + decl.cleanupMinutes,
      units: decl.allowGroupMixing ? Math.ceil(s.players / decl.capacityPerUnit) : s.units,
    }));
    const dayStart = Math.min(...occupations.map((o) => o.start));
    const dayEnd = Math.max(...occupations.map((o) => o.end));
    for (let minute = dayStart; minute < dayEnd; minute += 1) {
      let demand = 0;
      occupations.forEach((o) => { if (minute >= o.start && minute < o.end) demand += o.units; });
      if (demand > decl.units) return false;
    }
  }
  return true;
}

// Tous les departs REALISABLES de la journee pour une chaine donnee, selon la
// spec. C'est la reference des deux sens.
function oracleFeasibleStarts(declared, steps, existingBlocks) {
  const chainTotal = layoutChain(steps, 0).end;
  const firstStart = ceilTo(ceilTo(OPEN_MIN + ARRIVAL, SLOT_STEP), GRID);
  const lastStart = CLOSE_MIN - chainTotal - END_MARGIN;
  const starts = [];
  for (let start = firstStart; start <= lastStart; start += GRID) {
    const { blocks } = layoutChain(steps, start);
    if (oracleCapacityOk(declared, [...existingBlocks, ...blocks])) starts.push(start);
  }
  return starts;
}

// ── Verificateur (a) : rejouer un scenario propose, bloc par bloc ───────────
// Rend la liste des violations (vide = scenario reellement realisable).
function replayProposal(declared, steps, scenario, existingBlocks) {
  const violations = [];
  const start = toMin(scenario.startTime);
  if (start % GRID !== 0) violations.push(`depart ${scenario.startTime} hors grille :00/:30`);

  const declaredBlocks = (scenario.resourceBlocks || [])
    .filter((b) => declOf(declared, b.resourceType))
    .map((b) => ({
      resourceType: b.resourceType,
      start: Number(b.start),
      end: Number(b.end),
      players: Number(b.players || 0),
    }))
    .sort((l, r) => l.start - r.start);

  const expected = layoutChain(steps, start);
  if (declaredBlocks.length !== expected.blocks.length) {
    violations.push(`${declaredBlocks.length} bloc(s) au lieu de ${expected.blocks.length}`);
  } else {
    expected.blocks.forEach((exp, i) => {
      const got = declaredBlocks[i];
      if (got.resourceType !== exp.resourceType || got.start !== exp.start || got.end !== exp.end) {
        violations.push(`bloc ${i + 1}: ${got.resourceType} ${toTime(got.start)}-${toTime(got.end)} au lieu de ${exp.resourceType} ${toTime(exp.start)}-${toTime(exp.end)}`);
      }
    });
  }

  if (start < OPEN_MIN + ARRIVAL) violations.push('accueil avant l\'ouverture');
  const chainEnd = expected.end;
  if (chainEnd + END_MARGIN > CLOSE_MIN) violations.push('fin de programme au-dela de la marge de fermeture');

  if (!oracleCapacityOk(declared, [...existingBlocks, ...declaredBlocks])) {
    violations.push('capacite depassee sur au moins une ressource (remise en etat comprise)');
  }
  return violations;
}

// ── Verificateur des deux sens sur les ensembles de departs ─────────────────
function compareStarts(engineStarts, oracleStarts) {
  const engineSet = new Set(engineStarts);
  const oracleSet = new Set(oracleStarts);
  return {
    impossibleProposed: engineStarts.filter((s) => !oracleSet.has(s)),
    possibleMasked: oracleStarts.filter((s) => !engineSet.has(s)),
  };
}

// ── Une reservation existante posee sur le planning ─────────────────────────
let reservationId = 100;
function loadReservation(resourceType, startTime, durationMinutes, players, requiredUnits = null) {
  const start = toMin(startTime);
  const end = start + durationMinutes;
  reservationId += 1;
  return {
    id: reservationId,
    type: 'formule',
    startTime,
    pax: players,
    date: DATE,
    opsPlan: {
      resourceBlocks: [{
        resourceType,
        start,
        end,
        startTime,
        endTime: toTime(end),
        players,
        ...(requiredUnits ? { requiredUnits } : {}),
      }],
    },
  };
}
function blocksOf(reservations) {
  return reservations.flatMap((r) => r.opsPlan.resourceBlocks.map((b) => ({
    resourceType: b.resourceType,
    start: b.start,
    end: b.end,
    players: b.players,
  })));
}

// ── La cellule de matrice ───────────────────────────────────────────────────
function runCase(name, { chainSteps, pax, existing = [], preference = {}, oracleSteps = null, declared = DECLARED }) {
  cellCount += 1;
  const includedSteps = (oracleSteps || chainSteps)
    .map((s) => ({ ...s, groupPax: pax }));
  const result = engine.planScenarioChain({
    centerId: CENTER_ID,
    date: DATE,
    pax,
    steps: chainSteps,
    lockOrder: true,
    preference,
  }, { reservations: existing, laneStatuses: {} });

  const existingBlocks = blocksOf(existing);
  const engineStarts = result.scenarios.map((s) => toMin(s.startTime));
  const oracleStarts = oracleFeasibleStarts(declared, includedSteps, existingBlocks);
  startsChecked += result.checkedStarts;

  // Sens (a) : chaque scenario propose rejoue proprement.
  let replayViolations = 0;
  result.scenarios.forEach((scenario) => {
    proposalsReplayed += 1;
    const violations = replayProposal(declared, includedSteps, scenario, existingBlocks);
    if (violations.length) {
      replayViolations += 1;
      console.log(`      violation ${scenario.startTime}: ${violations.join(' ; ')}`);
    }
  });
  ok(replayViolations === 0, `${name} : (a) ${result.scenarios.length} scenario(s) propose(s), tous rejouables bloc par bloc`);

  // Egalite stricte des ensembles : les deux sens d'un coup.
  const { impossibleProposed, possibleMasked } = compareStarts(engineStarts, oracleStarts);
  ok(impossibleProposed.length === 0, `${name} : (a) aucun depart impossible propose (${impossibleProposed.map(toTime).join(', ') || 'vide'})`);
  ok(possibleMasked.length === 0, `${name} : (b) aucun depart possible masque (${possibleMasked.map(toTime).join(', ') || 'vide'}) ; oracle ${oracleStarts.length}, moteur ${engineStarts.length}`);
  return { result, engineStarts, oracleStarts, existingBlocks, includedSteps };
}

// ═══ LA MATRICE ═════════════════════════════════════════════════════════════
declareCenter();

section('[1] Longueur 1 : une seule activite, jour vide puis jour charge');
runCase('1 activite, jour vide', {
  pax: 4,
  chainSteps: [{ activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 60 }],
});
runCase('1 activite, salle occupee 14:00-16:00', {
  pax: 4,
  chainSteps: [{ activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 60 }],
  existing: [loadReservation('salle_a', '14:00', 120, 6)],
});

section('[2] Remise en etat : l\'occupation depasse la fenetre du client');
runCase('1 activite, salle B (remise 20 min), occupation 14:00-15:00', {
  pax: 4,
  chainSteps: [{ activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 }],
  existing: [loadReservation('salle_b', '14:00', 60, 6)],
});
// La meme salle deux fois dans une chaine : la remise en etat (20) depasse la
// transition (5), une seule installation ne peut pas enchainer. Zero scenario.
const sharedB = runCase('2 passages salle B enchaines (remise 20 > transition 5)', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_b1', label: 'Salle B 1', resourceType: 'salle_b', durationMinutes: 30 },
    { activityId: 'act_b2', label: 'Salle B 2', resourceType: 'salle_b', durationMinutes: 30 },
  ],
});
ok(sharedB.result.scenarios.length === 0 && sharedB.oracleStarts.length === 0,
  'salle unique + remise en etat : l\'enchainement est refuse PARTOUT, moteur et oracle d\'accord');
// Deux installations absorbent le meme enchainement (remise 15, unites 2).
runCase('2 passages Duo enchaines (2 unites absorbent la remise en etat)', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_d1', label: 'Duo 1', resourceType: 'duo', durationMinutes: 30 },
    { activityId: 'act_d2', label: 'Duo 2', resourceType: 'duo', durationMinutes: 30 },
  ],
});

section('[3] Capacites : le groupe s\'etale sur plusieurs installations');
// pax 7 sur Duo (cap 4) = 2 unites requises : une occupation d'1 unite en face
// masque tous les departs qui la chevauchent (remise en etat comprise).
runCase('pax 7 sur Duo (2 unites requises), 1 unite deja prise 13:00-14:00', {
  pax: 7,
  chainSteps: [{ activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 60 }],
  existing: [loadReservation('duo', '13:00', 60, 3, 1)],
});
// pax 9 = 3 unites > 2 : structurellement impossible, zero scenario.
const structural = runCase('pax 9 sur Duo (3 unites > 2 disponibles)', {
  pax: 9,
  chainSteps: [{ activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 30 }],
});
ok(structural.result.scenarios.length === 0, 'groupe plus grand que le pool entier : aucun scenario, jamais');

section('[4] Mixage de groupes : rejoindre une session existante');
// Session existante 8 joueurs 14:00-14:45 sur l'arene mixable (cap 12, 1 unite).
const mixLoad = [loadReservation('mix_arena', '14:00', 45, 8)];
const joinable = runCase('pax 4 rejoint la session de 8 (8+4=12, ca tient)', {
  pax: 4,
  chainSteps: [{ activityId: 'act_m', label: 'Arene', resourceType: 'mix_arena', durationMinutes: 45 }],
  existing: mixLoad,
});
ok(joinable.engineStarts.includes(toMin('14:00')),
  '(b) mixage : le depart 14:00 (session partagee, fenetre exacte) est bien PROPOSE, pas masque');
const overflow = runCase('pax 5 deborde la session de 8 (8+5=13 > 12)', {
  pax: 5,
  chainSteps: [{ activityId: 'act_m', label: 'Arene', resourceType: 'mix_arena', durationMinutes: 45 }],
  existing: mixLoad,
});
ok(!overflow.engineStarts.includes(toMin('14:00')),
  '(a) mixage : le depart 14:00 qui deborderait la session est bien REFUSE');

section('[5] Longueurs 3 et 4 : ressources croisees sous charge');
runCase('3 activites (salle A, Duo, salle B), planning charge', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 },
    { activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 30 },
    { activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 },
  ],
  existing: [
    loadReservation('salle_a', '11:00', 60, 6),
    loadReservation('salle_b', '16:00', 120, 6),
  ],
});
runCase('4 activites, 4 ressources, planning charge sur 3 pools', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 },
    { activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 30 },
    { activityId: 'act_m', label: 'Arene', resourceType: 'mix_arena', durationMinutes: 45 },
    { activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 },
  ],
  existing: [
    loadReservation('salle_a', '11:00', 60, 6),
    loadReservation('duo', '12:00', 90, 3, 1),
    loadReservation('duo', '12:00', 90, 3, 1),
    loadReservation('salle_b', '17:00', 60, 6),
  ],
});

section('[6] P2 : effectif par etape et etape optionnelle');
// L'etape porte SON effectif : 3 joueurs sur Duo = 1 unite, meme si le groupe
// fait 7. Une unite etant deja prise, seul l'effectif d'etape rend ca possible.
const stepPax = runCase('groupe de 7 mais 3 seulement sur Duo (1 unite requise)', {
  pax: 7,
  chainSteps: [{ activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 60, pax: 3 }],
  existing: [loadReservation('duo', '10:30', 570, 3, 1)],
});
ok(stepPax.result.scenarios.length > 0
  && stepPax.result.scenarios.every((s) => s.resourceBlocks.every((b) => Number(b.requiredUnits) === 1)),
  'P2 effectif : requiredUnits = 1 partout (l\'effectif d\'etape prime sur le groupe)');
const groupPax = runCase('le meme groupe de 7 SANS effectif d\'etape (2 unites requises)', {
  pax: 7,
  chainSteps: [{ activityId: 'act_d', label: 'Duo', resourceType: 'duo', durationMinutes: 60 }],
  existing: [loadReservation('duo', '10:30', 570, 3, 1)],
});
ok(groupPax.result.scenarios.length === 0, 'P2 contraste : sans effectif d\'etape, la journee chargee ne passe plus');

// Etape optionnelle retiree : la chaine se replanifie sans elle. La salle B
// etant pleine, garder l'etape = zero scenario ; la retirer = des scenarios.
const optionalKept = runCase('etape optionnelle GARDEE, salle B pleine toute la journee', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 },
    { activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30, optional: true },
  ],
  existing: [loadReservation('salle_b', '10:00', 600, 6)],
});
ok(optionalKept.result.scenarios.length === 0, 'P2 optionnel : gardee, l\'etape bloquee bloque la chaine');
const optionalDropped = runCase('la meme etape optionnelle RETIREE par le client', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 },
    { activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30, optional: true },
  ],
  existing: [loadReservation('salle_b', '10:00', 600, 6)],
  preference: { excludedOptionalActivityIds: ['act_b'] },
  oracleSteps: [{ activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 }],
});
ok(optionalDropped.result.scenarios.length > 0
  && optionalDropped.result.scenarios.every((s) => !s.resourceBlocks.some((b) => b.resourceType === 'salle_b')),
  'P2 optionnel : retiree, la chaine se replanifie sans le bloc salle B');

section('[7] P3 : contrainte d\'ordre declaree par la donnee');
// Chaine verrouillee : chaque scenario respecte l'ordre canonique.
const locked = runCase('ordre verrouille salle A puis salle B', {
  pax: 4,
  chainSteps: [
    { activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 30 },
    { activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 },
  ],
});
ok(locked.result.scenarios.every((s) => {
  const order = s.resourceBlocks.map((b) => b.resourceType);
  return order.indexOf('salle_a') < order.indexOf('salle_b');
}), 'P3 : tous les scenarios respectent l\'ordre declare');
// Et sur les VRAIES ressources bowling/laser (centre fichier Libramont, via
// planReservation, le vrai point d'entree) : sans contrainte, le moteur genere
// aussi un ordre laser-d'abord ; la contrainte declaree l'interdit.
{
  const p3Doc = {
    id: 'p3_test', name: 'P3', minPax: 1, price: { type: 'per_pax', value: 0 },
    steps: [
      { activityId: 'bowling', count: 1, durationMinutes: 60, critical: true },
      { activityId: 'laser_game', count: 1, critical: true },
    ],
  };
  const runP3 = (doc) => engine.planReservation({
    type: 'formule', centerId: 'libramont', date: DATE, pax: 4, startTime: '14:00', formula: doc,
  }, { reservations: [], laneStatuses: {} });
  const laserFirst = (result) => (result.scenarios || []).some((s) => {
    const order = (s.resourceBlocks || []).map((b) => b.resourceType);
    return order.includes('laser_arena') && order.includes('bowling_lane')
      && order.indexOf('laser_arena') < order.indexOf('bowling_lane');
  });
  const without = runP3(p3Doc);
  const withC = runP3({ ...p3Doc, orderConstraints: [['bowling', 'laser_game']] });
  ok(laserFirst(without), 'P3 temoin : SANS contrainte, un ordre laser-d\'abord est bien genere');
  ok(!laserFirst(withC) && (withC.scenarios || []).length > 0,
    'P3 : AVEC orderConstraints [[bowling, laser_game]], plus aucun ordre laser-d\'abord ne sort');
}

section('[8] CONTRE-EPREUVES PAR MUTATION (les deux tranchants coupent-ils ?)');
// A1 : scenario forge sur une fenetre occupee, injecte dans la liste proposee.
{
  const base = runCase('cellule temoin pour les mutations', {
    pax: 4,
    chainSteps: [{ activityId: 'act_a', label: 'Salle A', resourceType: 'salle_a', durationMinutes: 60 }],
    existing: [loadReservation('salle_a', '14:00', 120, 6)],
  });
  const real = base.result.scenarios[0];
  const forged = {
    ...real,
    startTime: '14:30',
    resourceBlocks: real.resourceBlocks.map((b) => ({
      ...b, start: toMin('14:30'), end: toMin('15:30'), startTime: '14:30', endTime: '15:30',
    })),
  };
  const violations = replayProposal(DECLARED, base.includedSteps, forged, base.existingBlocks);
  ok(violations.length > 0, 'MUTATION A1 : le scenario forge sur la fenetre occupee fait ROUGIR le sens (a)');
  // B1 : un scenario propose est retire : le sens (b) doit voir le trou.
  const amputated = base.engineStarts.slice(1);
  const { possibleMasked } = compareStarts(amputated, base.oracleStarts);
  ok(possibleMasked.length > 0, 'MUTATION B1 : retirer un scenario propose fait ROUGIR le sens (b)');
}
// A2 : le moteur croit "remise en etat 0" mais la spec la maintient a 20 :
// un moteur qui ignorerait la remise en etat proposerait de l'impossible.
{
  declareCenter(DECLARED.map((d) => (d.id === 'salle_b' ? { ...d, cleanupMinutes: 0 } : d)));
  const mutated = engine.planScenarioChain({
    centerId: CENTER_ID, date: DATE, pax: 4,
    steps: [{ activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 }],
    lockOrder: true,
  }, { reservations: [loadReservation('salle_b', '14:00', 60, 6)], laneStatuses: {} });
  const engineStarts = mutated.scenarios.map((s) => toMin(s.startTime));
  const oracleStarts = oracleFeasibleStarts(DECLARED,
    [{ resourceType: 'salle_b', durationMinutes: 30, groupPax: 4 }].map((s) => ({ ...s })),
    [{ resourceType: 'salle_b', start: toMin('14:00'), end: toMin('15:00'), players: 6 }]);
  const { impossibleProposed } = compareStarts(engineStarts, oracleStarts);
  ok(impossibleProposed.length > 0,
    'MUTATION A2 : un moteur sans remise en etat propose de l\'impossible, le sens (a) le voit');
}
// B2 : l'inverse : le moteur sur-masque (remise en etat 60 au lieu de 20).
{
  declareCenter(DECLARED.map((d) => (d.id === 'salle_b' ? { ...d, cleanupMinutes: 60 } : d)));
  const mutated = engine.planScenarioChain({
    centerId: CENTER_ID, date: DATE, pax: 4,
    steps: [{ activityId: 'act_b', label: 'Salle B', resourceType: 'salle_b', durationMinutes: 30 }],
    lockOrder: true,
  }, { reservations: [loadReservation('salle_b', '14:00', 60, 6)], laneStatuses: {} });
  const engineStarts = mutated.scenarios.map((s) => toMin(s.startTime));
  const oracleStarts = oracleFeasibleStarts(DECLARED,
    [{ resourceType: 'salle_b', durationMinutes: 30, groupPax: 4 }],
    [{ resourceType: 'salle_b', start: toMin('14:00'), end: toMin('15:00'), players: 6 }]);
  const { possibleMasked } = compareStarts(engineStarts, oracleStarts);
  ok(possibleMasked.length > 0,
    'MUTATION B2 : un moteur qui sur-masque cache du possible, le sens (b) le voit');
}
// Restauration de la declaration nominale.
declareCenter();

console.log(`\ncellules: ${cellCount} | departs testes: ${startsChecked} | scenarios rejoues: ${proposalsReplayed} | echecs: ${failures}`);
if (failures > 0) {
  console.log('scenario-chain-matrix: FAILURES');
  process.exit(1);
}
console.log('scenario-chain-matrix: ALL OK - rien d\'impossible propose, rien de possible masque, mutations rouges dans les deux sens.');
