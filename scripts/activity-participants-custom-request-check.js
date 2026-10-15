'use strict';
// Pure request/study regressions: no database, mail or production mutations.
let assertions = 0;
const assert = new Proxy(require('node:assert/strict'), { get(target, key) {
  const value = target[key];
  return typeof value === 'function' ? (...args) => { assertions += 1; return value(...args); } : value;
} });
const custom = require('../lib/custom-request');
const bureau = require('../lib/demande-bureau');
const { normalizeProgram } = require('../lib/visit-program');
const { listCenterActivities } = require('../lib/activity-catalog');
const { jourDeTest, plusJours } = require('./jour-de-test');

async function main() {
  const group = 40;
  // Un samedi a venir, hors vacances et feries : le moteur refuse une date
  // passee. Le contexte injecte le suit : une semaine avant, un samedi.
  const date = jourDeTest({ jour: 6 });
  const activities = listCenterActivities('libramont');
  const source = { groupType: 'amis', participants: group, moment: 'apres-midi', date,
    activities: [{ id: 'bowling', participants: 6 }, { id: 'laser_game', participants: 7 }, { id: 'minigolf_blacklight', participants: 3 }], formulas: [] };
  const context = { today: plusJours(date, -7), nowHour: 12, horizonDays: 180, activites: activities, formules: [],
    jourDe: () => ({ open: true, schedule: { open: 10, close: 23 }, weekday: 6 }) };
  const result = custom.normaliserDemande(source, context);
  assert.equal(result.ok, true);
  assert.deepEqual(result.demande.activities.map((a) => a.participants), [6, 7, 3]);
  assert.equal(result.demande.participants, group);
  const legacy = custom.normaliserDemande({ ...source, activities: ['bowling', 'laser_game'] }, context);
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.demande.activities.map((a) => a.participants), [group, group]);
  for (const invalid of [0, -1, 41, 1.5, true, null, '', 'garbage']) {
    const verdict = custom.normaliserDemande({ ...source, activities: [{ id: 'bowling', participants: invalid }] }, context);
    assert.equal(verdict.status, 422, `reject invalid participants ${JSON.stringify(invalid)}`);
  }
  assert.equal(custom.normaliserDemande({ ...source, activities: [{ id: 'laser_game', participants: 1 }] }, context).status, 422);
  const boundedContext = { ...context, activites: [{ id: 'bounded', name: 'Bounded', minPax: 2, maxPax: 5 }] };
  assert.equal(custom.normaliserDemande({ ...source, activities: [{ id: 'bounded', participants: 6 }] }, boundedContext).status, 422);
  assert.equal(custom.normaliserDemande({ ...source, activities: [{ id: 'bounded', participants: 6 }] }, { ...boundedContext, activites: [{ ...boundedContext.activites[0], capacityPerUnit: 5 }] }).ok, true);
  let requested;
  let program;
  const item = { contactName: 'Local', pax: group, payload: { demande: result.demande } };
  const study = await bureau.etudierDemande(item, {
    aujourdhui: context.today,
    jourDe: () => ({ ouvert: true, schedule: { open: 10, close: 23 } }),
    disponibilite: async (params) => {
      requested = params;
      program = normalizeProgram(JSON.parse(params.program), { centerId: 'libramont', pax: params.pax, dateStr: date });
      return { status: 200, json: { ok: true, program, price: program.price,
        slots: [{ time: '14:00', visitEndTime: '16:00', opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', groupPlayers: 7 }] } }] } };
    },
  });
  assert.equal(requested.pax, group);
  assert.deepEqual(JSON.parse(requested.program).map((a) => a.participants), [6, 7, 3]);
  assert.equal(program.items[0].laneCount, 1);
  assert.equal(program.items[1].price, 70);
  assert.equal(program.items[2].price, null, 'unknown price remains unknown');
  const visit = study.dates[0].visite;
  assert.deepEqual(visit.lignes.map((l) => l.participants), [6, 7, 3]);
  assert.equal(visit.prix, program.price);
  assert.equal(visit.parJoueur, null, 'mixed participation does not invent a uniform tariff');
  assert.match(visit.lignes[0].detail, /6 joueurs/);
  assert.match(bureau.demandeEnTexte(item), /Laser Game \(7 joueurs\)/);
  assert.match(bureau.etudeEnTexte(study), /7 joueurs/);
  require('../lib/catalog-store').applyCatalogState({ centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }], activities: [{
    id: 'billards', center_id: 'all', owner_client_id: 'fungalaxy', name: 'Billards', resource_type: 'soft_capacity', active: true,
    price_type: 'per_unit_hour', price_value: '10.25', price_unit: 'par table et par heure', source: 'seed',
    duration_model: { type: 'open_range', defaultMinutes: 60 }, service_model: {},
  }] });
  const choices = [
    { id: 'bowling', participants: 6, duration: 1.5 },
    { id: 'laser_game', participants: 35, games: 2 },
    { id: 'minigolf_blacklight', participants: 17 },
    { id: 'billards', participants: 12, units: 2, hours: 2 },
    { id: 'duckpin_bowling', participants: 40, duration: 2 },
    { id: 'fun_run', participants: 31, minutes: 30 },
    { id: 'playground', participants: 8 },
  ];
  const full = custom.normaliserDemande({ ...source, participants: 80, activities: choices }, context);
  assert.equal(full.ok, true);
  const { getCenter } = require('../lib/ops-knowledge');
  const bowlingConfig = getCenter('libramont').resources.bowling;
  const base = normalizeProgram(choices.map((a) => ({ ...a, activityId: a.id })), { centerId: 'libramont', pax: 80, bowlingConfig, dateStr: date, publicBooking: true });
  let studiedProgram;
  const deps = { aujourdhui: context.today, jourDe: () => ({ ouvert: true, schedule: { open: 10, close: 23 } }),
    disponibilite: async (params) => {
      studiedProgram = normalizeProgram(JSON.parse(params.program), { centerId: 'libramont', pax: params.pax, bowlingConfig, dateStr: date, publicBooking: true });
      return { status: 200, json: { ok: true, program: studiedProgram, price: studiedProgram.price,
        slots: [{ time: '14:00', opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena' }, { resourceType: 'laser_arena' }] } }] } };
    } };
  const fullStudy = await bureau.etudierDemande({ centerId: 'libramont', payload: { demande: full.demande } }, deps);
  assert.deepEqual(studiedProgram.items, base.items, 'same choices produce exactly base programme options/prices/rotations');
  const byId = Object.fromEntries(base.items.map((a) => [a.activityId, a]));
  assert.equal(byId.bowling.duration, 1.5);
  assert.equal(byId.laser_game.games, 2);
  assert.equal(byId.laser_game.price, 630);
  assert.equal(byId.billards.price, 41, 'fractional tariff multiplied exactly by two tables and two hours');
  assert.equal(byId.duckpin_bowling.sessions, 4);
  assert.equal(byId.fun_run.sessions, 7);
  assert.equal(byId.fun_run.sessionMinutes, 30);
  assert.equal(fullStudy.dates[0].visite.prix, base.price);
  assert.equal(fullStudy.dates[0].visite.prixComplet, base.priceComplete);
  assert.match(fullStudy.dates[0].visite.lignes.find((a) => a.nom === 'Laser Game').detail, /2 vagues/);
  for (const [id, option, value] of [['bowling', 'duration', 1.75], ['laser_game', 'games', 1.5], ['fun_run', 'minutes', 22], ['billards', 'units', 2.5], ['billards', 'hours', 7]]) {
    assert.equal(custom.normaliserDemande({ ...source, activities: [{ id, participants: 3, [option]: value }] }, context).status, 422);
  }
  const bigSubset = custom.normaliserDemande({ ...source, participants: 1000, activities: [{ id: 'bowling', participants: 6, duration: 2 }] }, context);
  const bigStudy = await bureau.etudierDemande({ centerId: 'libramont', payload: { demande: bigSubset.demande } }, deps);
  assert.equal(bigStudy.participants, 1000);
  assert.equal(studiedProgram.pax, 6);
  assert.equal(bigStudy.dates[0].visite.ok, true);
  assert.equal(bigStudy.dates[0].visite.prix, 78);
  const allBig = custom.normaliserDemande({ ...source, participants: 1000, activities: [{ id: 'bowling', participants: 1000, duration: 1 }] }, context);
  const manual = await bureau.etudierDemande({ centerId: 'libramont', payload: { demande: allBig.demande } }, { ...deps, disponibilite: () => { throw new Error('large quote must not submit clamped availability'); } });
  const expectedBig = normalizeProgram([{ activityId: 'bowling', participants: 1000, duration: 1 }], { centerId: 'libramont', pax: 1000, participantLimit: 1000, bowlingConfig, dateStr: date });
  assert.equal(manual.dates[0].visite.prix, expectedBig.price);
  assert.equal(manual.dates[0].visite.prix, 6552, '21 balanced bowling services use 8 lanes each');
  assert.match(manual.dates[0].visite.lignes[0].detail, /21 services/);
  assert.equal(manual.dates[0].visite.lignes[0].participants, 1000);
  assert.equal(manual.dates[0].visite.ok, false);
  assert.match(manual.dates[0].visite.raison, /manuellement/);
  assert.match(bureau.etudeEnTexte(manual), /Montant calculé/);
  const ack = require('../lib/ops-communications').buildCustomRequestAck({ contactName: 'Local', pax: 80, demande: full.demande });
  assert.match(ack.details.find(([key]) => key === 'Activités')[1], /Billards \(12 joueurs, 2 tables, 2 h\)/);
  const { buildProgramFormula } = require('../lib/visit-program');
  const plan = require('../lib/ops-engine').evaluateAnchoredCombination({ center: getCenter('libramont'),
    formula: buildProgramFormula(normalizeProgram(choices.slice(0, 2).map((a) => ({ ...a, activityId: a.id })), { centerId: 'libramont', pax: 80, bowlingConfig, dateStr: date })),
    pax: 80, date, anchorTimes: { bowling: 600, laser_game: 720 }, reservations: [], laneStatuses: {}, blocks: [] });
  assert.equal(plan.ok, true);
  assert.equal(plan.scenario.resourceBlocks.find((b) => b.resourceType === 'bowling_lane').players, 6);
  const lasers = plan.scenario.resourceBlocks.filter((b) => b.resourceType === 'laser_arena');
  assert.equal(lasers.length, 2);
  assert.equal(lasers.reduce((sum, b) => sum + b.players, 0), 35);
  assert.equal(lasers.every((b) => b.groupPlayers === 35), true);
  const zeroStudy = await bureau.etudierDemande(item, { ...deps, disponibilite: async () => ({ status: 200, json: { ok: true, price: 0,
    program: { items: [{ activityId: 'bowling', name: 'Bowling', participants: 6, priceKnown: true, price: 0 }] }, slots: [{ time: '14:00' }] } }) });
  assert.equal(zeroStudy.dates[0].visite.prix, 0);
  assert.match(bureau.etudeEnTexte(zeroStudy), /0 € pour le groupe/);
  assert.match(bureau.brouillonDuCode(item, zeroStudy).corps, /0 € pour le groupe/);
  const zeroFormulaItem = { ...item, payload: { demande: { ...result.demande, activities: [], formulas: [{ id: 'f1', name: 'Formule 1' }] } } };
  const zeroFormula = await bureau.etudierDemande(zeroFormulaItem, { ...deps, disponibilite: async () => ({ status: 200, json: { ok: true, price: 0, slots: [{ time: '14:00' }] } }) });
  assert.equal(zeroFormula.dates[0].formules[0].prix, 0);
  assert.match(bureau.etudeEnTexte(zeroFormula), /0 € pour le groupe/);
  assert.match(bureau.brouillonDuCode(zeroFormulaItem, zeroFormula).corps, /0 € pour le groupe/);
  const manualDraft = bureau.brouillonDuCode({ centerId: 'libramont', payload: { demande: allBig.demande } }, manual);
  assert.match(manualDraft.corps, /horaires manuellement/);
  assert.equal(/n’ont plus de départ possible/.test(manualDraft.corps), false);
  assert.equal(custom.normaliserDemande({ ...source, activities: [{ id: 'billards', participants: 3, hours: 0.5 }] }, context).status, 422);
  const dynamic = { ...context, activites: [{ ...activities.find((a) => a.id === 'billards'), minMinutes: 30, maxMinutes: 180, stepMinutes: 30 }] };
  assert.equal(custom.normaliserDemande({ ...source, activities: [{ id: 'billards', participants: 3, hours: 0.5 }] }, dynamic).ok, true);
  const rotations = normalizeProgram([{ activityId: 'duckpin_bowling', participants: 1000, duration: 1 }, { activityId: 'fun_run', participants: 1000, minutes: 30 }],
    { centerId: 'libramont', pax: 1000, participantLimit: 1000, bowlingConfig, dateStr: date });
  const duck = rotations.items.find((a) => a.activityId === 'duckpin_bowling');
  const run = rotations.items.find((a) => a.activityId === 'fun_run');
  assert.equal(duck.units, 167);
  assert.equal(duck.laneCount, 2);
  assert.equal(duck.sessions, 84);
  assert.equal(duck.minutes, 5040);
  assert.equal(duck.price, 6513);
  assert.equal(run.sessions, 200);
  assert.equal(run.minutes, 6000);
  assert.equal(run.price, 11000);
  const normal240 = normalizeProgram([{ activityId: 'fun_run', participants: 240, minutes: 30 }], { centerId: 'libramont', pax: 240 });
  assert.equal(normal240.items[0].sessions, 48);
  assert.equal(normal240.items[0].minutes, 1440);
  assert.equal(normal240.items[0].price, 2640);
  const stored240 = require('../lib/database').normalizeReservationPayload({ centerId: 'libramont', type: 'activite', date, startTime: '10:00',
    duration: 0.5, pax: 240, name: 'Local', email: 'local@example.invalid', phone: '0471000000', program: normal240 }, {}).program;
  assert.equal(stored240.items[0].sessions, 48, 'stored rotations preserve all 48 passages');
  assert.equal(stored240.items[0].minutes, 1440);
  assert.equal(stored240.items[0].sessionMinutes, 30);
  const reread240 = normalizeProgram(stored240.items, { centerId: 'libramont', pax: 240 });
  assert.equal(reread240.price, 2640);
  assert.equal(reread240.items[0].sessions, 48);
  for (const [players, services, price] of [
    [49, null, 312], [56, null, 312], [57, [29, 28], 390],
    [97, [33, 32, 32], 702], [100, [34, 33, 33], 702],
  ]) {
    const bowling = normalizeProgram([{ activityId: 'bowling', participants: players, duration: 1 }], { centerId: 'libramont', pax: players, bowlingConfig, dateStr: date }).items[0];
    assert.equal(bowling.price, price, `${players} players bill each balanced service`);
    assert.deepEqual(bowling.services || null, services);
  }
  console.log(`activity-participants-custom-request-check: ALL OK (${assertions} assertions)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
