const assert = require('node:assert/strict');
const { normalizeProgram, buildProgramFormula, describeProgram, groupIsSplit, attenteDesTours } = require('../lib/visit-program');
const { evaluateAnchoredCombination, getFormulaAnchorAvailability } = require('../lib/ops-engine');
const { getCenter } = require('../lib/ops-knowledge');
const { normalizeReservationRequest, renormalizeVisitProgram } = require('../lib/reservation-request');
const { prepareReservationOps } = require('../lib/reservation-ops');
const { listCenterActivities } = require('../lib/activity-catalog');
const { buildMessage } = require('../lib/ops-communications');

// LA DATE DU BANC EST LE PROCHAIN SAMEDI (2026-10-13). Ecrite en dur au
// 2026-10-10, elle est passee le lendemain : le gate refusait alors « Cette
// date est déjà passée » quel que soit le code, et coupait la chaine des
// participants avant ses sept autres maillons. Meme calcul que
// anchor-hours-truth-check (jour du centre, Europe/Brussels).
function prochainSamedi() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}

async function main() {
  const centerId = 'libramont';
  const date = prochainSamedi();
  const pax = 40;
  const lines = [
    { activityId: 'bowling', participants: 6, duration: 1 },
    { activityId: 'laser_game', participants: 7, games: 2 },
    { activityId: 'duckpin_bowling', participants: 6, duration: 1 },
    { activityId: 'fun_run', participants: 5, minutes: 30 },
  ];
  const program = normalizeProgram(lines, { centerId, pax, dateStr: date });
  assert.deepEqual(program.items.map((item) => item.participants), [6, 7, 6, 5]);
  assert.equal(program.items.find((item) => item.activityId === 'bowling').laneCount, 1);
  assert.equal(program.items.find((item) => item.activityId === 'laser_game').price, 126);
  assert.equal(program.items.find((item) => item.activityId === 'duckpin_bowling').units, 1);
  assert.equal(program.items.find((item) => item.activityId === 'fun_run').sessions, 1);
  assert.equal(program.items.find((item) => item.activityId === 'fun_run').price, 55);
  assert.deepEqual(normalizeProgram(program.items, { centerId, pax, dateStr: date }), program);
  assert.match(describeProgram(program), /Bowling 1h \(6 pers\.\)/);
  assert.match(describeProgram(program), /Laser 2 parties \(7 pers\.\)/);
  assert.equal(groupIsSplit({ centerId, pax, items: lines }), false);
  assert.equal(attenteDesTours({ centerId, pax, items: lines }), null);
  const formula = buildProgramFormula(program);
  const existing = { id: 1, centerId, date, type: 'laser', pax: 23, startTime: '15:00', duration: 0.5, opsPlan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', startTime: '15:00', endTime: '15:25', players: 23 }] } };
  const planned = evaluateAnchoredCombination({ center: getCenter(centerId), formula, pax, date, anchorTimes: { bowling: 840, laser_game: 900 }, reservations: [existing], laneStatuses: {}, blocks: [] });
  assert.equal(planned.ok, true, planned.reason);
  const blocks = planned.scenario.resourceBlocks;
  assert.equal(blocks.find((block) => block.resourceType === 'bowling_lane').players, 6);
  assert.equal(blocks.find((block) => block.resourceType === 'laser_arena').players, 7);
  assert.equal(blocks.find((block) => block.resourceType === 'laser_arena').groupPlayers, 7);
  const meta = getFormulaAnchorAvailability({ centerId, formula, date, pax, preferredTimes: { bowling: '14:00', laser_game: '15:00' } }, { reservations: [existing], laneStatuses: {}, blocks: [] });
  assert.equal(meta.activities.find((item) => item.activityId === 'laser_game').participants, 7);
  assert.equal(meta.activities.find((item) => item.activityId === 'laser_game').times.find((item) => item.time === '15:00').ok, true);
  for (const invalid of [0, -1, 41, 1.5, 'oops', true, '']) {
    assert.throws(() => normalizeProgram([{ activityId: 'bowling', participants: invalid }], { centerId, pax }), /participants/);
  }
  for (const activity of listCenterActivities(centerId)) {
    const count = Math.max(1, Number(activity.minPax) || 1);
    const item = normalizeProgram([{ activityId: activity.id, participants: count }], { centerId, pax }).items[0];
    assert.equal(item.participants, count, activity.id);
    const legacy = normalizeProgram([{ activityId: activity.id }], { centerId, pax: 8 }).items[0];
    assert.equal(legacy.participants, 8, `legacy ${activity.id}`);
  }
  const request = normalizeReservationRequest({ centerId, type: 'visite', pax, date, startTime: '14:00', firstName: 'Local', lastName: 'Check', email: 'local@example.invalid', program: lines, preference: { preferredTimes: { bowling: '14:00', laser_game: '15:00' } } }, { channel: 'public' });
  assert.equal(request.pax, 40);
  assert.equal(request.programPrice, program.price);
  const prepared = await prepareReservationOps(request, 'public', { readState: async () => ({ reservations: [], laneStatuses: {}, blocks: [] }) });
  assert.equal(prepared.planAvailable, true, JSON.stringify(prepared));
  assert.equal(prepared.opsPlan.resourceBlocks.find((block) => block.resourceType === 'laser_arena').players, 7);
  assert.equal(prepared.opsPlan.laserSharing.requestedPlayers, 7);
  const message = buildMessage({ reservation: { ...request, ...prepared, name: 'Local Check' }, templateId: 'confirmation', channel: 'email' });
  assert.equal(message.details.find((row) => row.label === 'Personnes présentes').value, '40');
  assert.match(message.details.find((row) => row.label === 'Laser Game').value, /^7 participants · 126/);
  const catalogStore = require('../lib/catalog-store');
  catalogStore.applyCatalogState({ centerClients: [{ id: centerId, client_id: 'fungalaxy' }], activities: [{
    id: 'billards', center_id: 'all', owner_client_id: 'fungalaxy', name: 'Billards', resource_type: 'soft_capacity', active: true,
    price_type: 'per_unit_hour', price_value: '10.25', price_unit: 'par table et par heure', source: 'seed',
    duration_model: { type: 'open_range', defaultMinutes: 60 }, service_model: {},
  }] });
  const centsBody = { centerId, type: 'visite', pax: 8, date, startTime: '14:00', program: [{ activityId: 'billards', participants: 3, units: 1, hours: 1 }], extras: [{ label: 'Extra', price: 0.35 }] };
  const cents = normalizeReservationRequest({ ...centsBody, price: 10.6 }, { channel: 'staff' });
  assert.equal(cents.basePrice, 10.25);
  assert.equal(cents.price, 10.6);
  renormalizeVisitProgram(cents, getCenter(centerId).resources.bowling, { channel: 'staff' });
  assert.equal(cents.price, 10.6);
  const manual = normalizeReservationRequest({ ...centsBody, price: 8.75 }, { channel: 'staff' });
  renormalizeVisitProgram(manual, getCenter(centerId).resources.bowling, { channel: 'staff' });
  assert.equal(manual.price, 8.75);
  const persisted = require('../lib/database').normalizeReservationPayload({ ...manual, name: 'Local Check', phone: '-', email: 'local@example.invalid' });
  assert.equal(persisted.price, 8.75);
  assert.equal(persisted.program.items[0].price, 10.25);
  assert.equal(persisted.program.items[0].participants, 3);
  const upsell = require('../lib/booking-complements').buildVisitComplements({
    centerId, date, pax: 8,
    program: normalizeProgram([{ activityId: 'bowling', participants: 6, duration: 1 }, { activityId: 'laser_game', participants: 2, games: 3 }, { activityId: 'duckpin_bowling' }, { activityId: 'fun_run' }], { centerId, pax: 8, dateStr: date }),
    retainedSlot: { time: '14:00', lanes: [], opsPlan: { anchorPlan: { times: { bowling: '14:00', laser_game: '15:00' } } } },
    priceOptions: { bowlingConfig: null, dateStr: date }, reservations: [], laneStatuses: {}, blocks: [],
  });
  assert.equal(upsell.find((card) => card.patch?.activityId === 'billards')?.deltaTotal, 10.25);
  catalogStore.applyCatalogState({ centerClients: [{ id: centerId, client_id: 'fungalaxy' }], activities: [{
    id: 'custom_participants', center_id: centerId, owner_client_id: 'fungalaxy', name: 'Custom participants', resource_type: 'soft_capacity',
    active: true, bookable: true, price_type: 'per_pax', price_value: '2.75', price_unit: 'par personne', source: 'custom',
    duration_model: { type: 'fixed', defaultMinutes: 30 }, service_model: {},
  }] });
  require('../lib/ops-knowledge').applyCenterOverrides(new Map([[centerId, { activityAvailability: { custom_participants: true } }]]));
  const custom = normalizeProgram([{ activityId: 'custom_participants', participants: 3 }], { centerId, pax: 20 });
  assert.equal(custom.items.length, 1);
  assert.equal(custom.items[0].participants, 3);
  assert.equal(custom.price, 8.25);
  const legacyCustom = normalizeProgram([{ activityId: 'custom_participants' }], { centerId, pax: 20 });
  assert.equal(legacyCustom.price, 55);
  assert.deepEqual(normalizeProgram(custom.items, { centerId, pax: 20 }), custom);
  require('../lib/ops-knowledge').applyCenterOverrides(new Map());
  catalogStore.applyCatalogState({ activities: [], formulas: [] });
  // Reuse the transactional in-memory PostgreSQL bench: this exercises the
  // actual public handlers and their advisory locks without a real database.
  const bench = require('./slot-holds-check');
  const server = bench.charger();
  bench.semer(Array.from({ length: 7 }, (_, i) => bench.reservationLigne(900 + i, '15:00', [i + 1])));
  const subset = bench.visite('15:00', [{ activityId: 'bowling', participants: 6, duration: 1 }], { pax: 20 });
  const race = await Promise.all([1, 2, 3].map(() => bench.retenir(server, subset)));
  assert.deepEqual(race.map((result) => result.statut).sort(), [201, 409, 409]);
  const held = race.find((result) => result.statut === 201);
  const token = held.json.holdToken;
  const holdingRow = [...bench.base.holds.values()].find((row) => !row.released_at);
  assert.equal(holdingRow.payload.pax, 20);
  assert.equal(holdingRow.payload.program.items[0].participants, 6);
  assert.equal(holdingRow.payload.opsPlan.resourceBlocks.find((block) => block.resourceType === 'bowling_lane').players, 6);
  const confirmed = await bench.confirmer(server, { ...bench.avecContact(subset), holdToken: token });
  assert.equal(confirmed.statut, 201, JSON.stringify(confirmed));
  const saved = [...bench.base.reservations.values()].find((row) => row.channel === 'public');
  assert.equal(saved.pax, 20);
  assert.equal(saved.program.items[0].participants, 6);
  assert.deepEqual(saved.lanes, holdingRow.payload.lanes);
  assert.equal([...bench.base.holds.values()].filter((row) => !row.released_at).length, 0);
  const again = await bench.confirmer(server, { ...bench.avecContact(subset), holdToken: token });
  assert.equal(again.statut, 200);
  assert.equal([...bench.base.reservations.values()].filter((row) => row.channel === 'public').length, 1);
  bench.semer([bench.reservationLigne(930, '15:00', [], {
    type: 'laser', pax: 23, duration: 0.5, total_duration: 0.5,
    ops_plan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', startTime: '15:00', endTime: '15:25', players: 23, groupPlayers: 23, countIndex: 1 }] },
  })]);
  const laserSubset = bench.visite('15:00', [{ activityId: 'laser_game', participants: 7, games: 1 }], { pax: 20 });
  const laserRace = await Promise.all([1, 2].map(() => bench.retenir(server, laserSubset)));
  assert.deepEqual(laserRace.map((result) => result.statut).sort(), [201, 409]);
  const laserHeld = laserRace.find((result) => result.statut === 201);
  const laserConfirmed = await bench.confirmer(server, { ...bench.avecContact(laserSubset), holdToken: laserHeld.json.holdToken });
  assert.equal(laserConfirmed.statut, 201, JSON.stringify(laserConfirmed));
  const laserSaved = [...bench.base.reservations.values()].find((row) => row.channel === 'public');
  assert.equal(laserSaved.pax, 20);
  assert.equal(laserSaved.program.items[0].participants, 7);
  assert.equal(laserSaved.price, 70);
  assert.equal(laserSaved.ops_plan.resourceBlocks.find((block) => block.resourceType === 'laser_arena').players, 7);
  console.log('activity-participants-backend-check OK');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
