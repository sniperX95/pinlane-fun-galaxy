// Real staff functions + real browser pricing core, isolated from network/write APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/app-main.js'), 'utf8');
const catalog = [
  { id: 'bowling', name: 'Bowling', priceType: 'grid_bowling' },
  { id: 'laser_game', name: 'Laser Game', priceType: 'grid_laser' },
  { id: 'minigolf_blacklight', name: 'Minigolf', priceType: 'per_pax', priceValue: 10 },
  { id: 'billards', name: 'Billard', priceType: 'per_unit_hour', priceValue: 10, unitLabel: 'par table', units: 5 },
  { id: 'duckpin_bowling', name: 'Duckpin', priceType: 'grid_bowling', units: 2, capacityPerUnit: 6 },
  { id: 'fun_run', name: 'Fun Run', priceType: 'grid_fun_run', capacityPerUnit: 5 },
  { id: 'playground', name: 'Playground', priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', dayAccess: true },
  { id: 'arcade_time', name: 'Arcades', priceType: 'per_pax', priceValue: null, defaultMinutes:30 },
];
const ctx = vm.createContext({ console, state: { booking: {}, selectedRes: null, editState: null }, quickBookState: null,
  getCenterActivity: id => catalog.find(item => item.id === id), resolveDisplayFormule: () => null,
  renderQuickBook: () => {}, renderPos: () => {}, escapeHtml: value => String(value),
  formatDurationLabel: value => `${value}h`, getRuntimeBowlingConfig: () => null,
});
vm.runInContext(fs.readFileSync(path.join(root, 'assets/booking-core.js'), 'utf8'), ctx);
ctx.testCatalog = catalog;
vm.runInContext('setCenterActivities(testCatalog)', ctx);
const functions = ['participantsLigneProgramme', 'nomActivite', 'catalogueDeLigne', 'ligneALaJournee', 'detailLigneProgramme', 'detailLigneProgrammeSansEffectif', 'detailUnitesLigne', 'buildEditProgramFromReservation', 'estimerPrixProgramme', 'getEditProgramItems', 'editionChangeLePrix', 'editProgramAChange', 'ensureQuickVisit', 'getQuickVisitOptions', 'getQuickVisitParticipants', 'getQuickVisitMinutes', 'getQuickVisitUnits', 'getQuickVisitHours', 'ligneProgrammeQuick', 'renderActivityParticipantsControl', 'setQuickVisitParticipants', 'setEditActivityParticipants', 'syncQuickBookDuration', 'getQuickBookSummaryActivites'];
for (const name of functions) {
  const from = app.indexOf(`function ${name}(`);
  assert.ok(from >= 0, name);
  const to = app.indexOf('\nfunction ', from + 1);
  vm.runInContext(app.slice(from, to < 0 ? undefined : to), ctx);
}
for (const name of ['activityParticipantsBounds', 'getQuickBookCustomPrice', 'getEditPriceValue', 'getLaserGameCountForReservation', 'getBookingActivityParticipants', 'getChosenActivities', 'normalizeBookingMode', 'deriveBookingType', 'buildBookingProgramPayload', 'applyChosenActivitiesToBooking', 'activityHourChoices', 'activityUnitChoices', 'renderActivityOptions', 'renderActivityOptionsWithoutParticipants', 'renderProgramSummary', 'renderActivitesCourtes', 'resumeProgrammeReservation']) {
  const from = app.indexOf(`function ${name}(`);
  vm.runInContext(app.slice(from, app.indexOf('\nfunction ', from + 1)), ctx);
}
{
  const from = app.indexOf('function activityCountsChildren(');
  vm.runInContext(app.slice(from, app.indexOf('\nfunction ', from + 1)), ctx);
}
function run(source) { return vm.runInContext(source, ctx); }
ctx.quickBookState = { pax: 18, type: 'visite', date: '2026-10-06', startTime: '14:00', visit: { bowling: { on: true, duration: 1 }, laser_game: { on: true, games: 2 }, others: { minigolf_blacklight: true, billards: true }, options: { bowling: { participants: 6 }, laser_game: { participants: 4 }, minigolf_blacklight: { participants: 3 }, billards: { participants: 8, units: 2, hours: 2 } } } };
const summary = run('getQuickBookSummaryActivites()');
assert.equal(summary.total, 39 + 72 + 30 + 40);
assert.match(summary.detail, /Bowling : 6 joueurs/);
assert.equal(run("ligneProgrammeQuick('billards').units"), 2);
assert.equal(run("ligneProgrammeQuick('billards').participants"), 8);
for (const item of catalog) assert.match(run(`renderActivityParticipantsControl('${item.id}')`), /aria-label=.*Joueurs|aria-label=.*joueurs|aria-label=.*enfants/);
ctx.state.selectedRes = { pax: 18, program: { items: [ { activityId: 'bowling', duration: 1, participants: 6 }, { activityId: 'laser_game', games: 2, participants: 4 }, { activityId: 'billards', units: 2, hours: 2, participants: 8 } ] } };
run('state.editState = { pax: 18, programmeEdite: buildEditProgramFromReservation(state.selectedRes) }; state.editState.programmeEditeInitial = JSON.stringify(state.editState.programmeEdite)');
assert.deepEqual(Array.from(run('getEditProgramItems().map(item => item.participants)')), [6, 4, 8]);
assert.equal(run('editProgramAChange()'), false);
assert.equal(run('estimerPrixProgramme(getEditProgramItems(),18,"2026-10-06","14:00").total'), 151);
run("setEditActivityParticipants('laser_game', 2)");
assert.equal(run('getEditProgramItems()[1].participants'), 2);
assert.equal(run('editionChangeLePrix()'), true);
ctx.state.selectedRes.formuleId = 'f1';
assert.equal(run('editionChangeLePrix()'), false, 'allocation does not discount purchased formula');
ctx.quickBookState.pax = 3;
assert.equal(run("getQuickVisitParticipants('bowling')"), 3);
ctx.quickBookState = { pax: 18, type: 'bowling', duration: 1, visit: { bowling: { on: true, duration: 1 }, laser_game: { on: false }, others: {} } };
run("setQuickVisitParticipants('bowling', 6)");
assert.equal(ctx.quickBookState.type, 'visite');
assert.equal(ctx.quickBookState.pax, 18);
assert.equal(run("ligneProgrammeQuick('bowling').participants"), 6);
assert.match(run("detailLigneProgramme({ activityId:'laser_game', participants:4, games:2 }, {pax:18})"), /^4 joueurs/);
assert.match(run("detailLigneProgramme({ activityId:'playground', participants:2 }, {pax:18})"), /^2 enfants.*toute la journée/);
catalog.find(item => item.id === 'minigolf_blacklight').priceValue = 10.25;
assert.equal(run("estimerPrixProgramme([{activityId:'minigolf_blacklight',participants:3}],18,'2026-10-06','14:00').total"), 30.75);
assert.equal(run("estimerPrixProgramme([{activityId:'duckpin_bowling',duration:1,participants:6}],18,'2026-10-06','14:00').total"), 39);
assert.equal(run("estimerPrixProgramme([{activityId:'fun_run',minutes:30,participants:4}],18,'2026-10-06','14:00').total"), 55);
assert.equal(run("estimerPrixProgramme([{activityId:'fun_run',minutes:30,participants:6}],18,'2026-10-06','14:00').total"), 110);
ctx.quickBookState.customPrice = '30.75';
assert.equal(run('getQuickBookCustomPrice()'), 30.75);
ctx.state.editState.price = '30.75';
assert.equal(run('getEditPriceValue()'), 30.75);
assert.equal(run("participantsLigneProgramme({participants:8})"), 8);
run("setQuickVisitParticipants('laser_game', 1)");
assert.equal(run("getQuickVisitParticipants('laser_game')"), 2);
ctx.laserSubset = { pax:40, type:'visite', date:'2026-10-06', startTime:'14:00', status:'pending', program:{ items:[{activityId:'laser_game', games:3, participants:7}] }, opsPlan:{ resourceBlocks:[{resourceType:'laser_arena',activityId:'laser_game',countIndex:1,players:7,groupPlayers:7,start:840,end:865,startTime:'14:00',endTime:'14:25'}],laserPassPlan:{scheduledPasses:[{countIndex:1,startTime:'14:00'}]} } };
assert.deepEqual(Array.from(run('getLaserUnitsForReservation(laserSubset).map(unit=>unit.players)')), [7,7,7]);
assert.deepEqual(Array.from(run('getPendingLaserPassesForReservation(laserSubset).map(unit=>unit.players)')), [7,7]);
assert.equal(run("buildManualLaserPassBlocks(laserSubset,'2.1',15)[0].players"), 7);
assert.equal(run("buildManualLaserPassBlocks(laserSubset,'2.1',15)[0].groupPlayers"), 7);
run("laserSubset.opsPlan.resourceBlocks.push(buildManualLaserPassBlocks(laserSubset,'2.1',15)[0])");
assert.equal(run("removeLaserPassFromPlan(laserSubset,'2.1')[0].groupPlayers"), 7);
assert.equal(run("getReservationActivityPlayers({pax:40,program:[{activityId:'laser_game',participants:7}]},'laser_game')"), 7);
ctx.quickBookState = {pax:40,type:'visite',visit:{bowling:{on:false},laser_game:{on:true,games:3},others:{billards:true},options:{laser_game:{participants:7},billards:{participants:8,hours:2,units:2}}}};
run('syncQuickBookDuration()');
assert.equal(ctx.quickBookState.totalDuration, 3.5);
assert.equal(run("estimerPrixProgramme([{activityId:'bowling',duration:1,participants:70}],100,'2026-10-06','14:00').total"), 12 * 39);
ctx.quickBookState = {pax:18,type:'activity',activityId:'fun_run',visit:{bowling:{on:false},laser_game:{on:false},others:{},options:{fun_run:{participants:6,minutes:30}}}};
run('syncQuickBookDuration()');
assert.equal(ctx.quickBookState.totalDuration, 1);
assert.equal(run("activityParticipantsBounds('laser_game',40).min"), 2);
catalog.find(item => item.id === 'fun_run').maxPax = 5;
assert.equal(run("activityParticipantsBounds('fun_run',40).max"), 40, 'unit capacity rotates rather than capping visitors');
// A legacy Fun Run line has only aggregate minutes; recover its chosen tier
// from the activity players rather than the visitors accompanying them.
ctx.legacyRun = {pax:18,program:{items:[{activityId:'fun_run',minutes:60,participants:6}]}};
assert.equal(run("buildEditProgramFromReservation(legacyRun).othersOptions.fun_run.minutes"), 30);
ctx.state.booking = {mode:'carte',pax:18,date:'2026-10-06',startTime:'14:00',activities:{bowling:{duration:1,participants:6},laser_game:{games:2,participants:4},minigolf_blacklight:{participants:3},billards:{units:2,hours:2,participants:8}}};
assert.equal(run('deriveBookingType()'), 'visite');
assert.deepEqual(Array.from(run('buildBookingProgramPayload().map(item=>item.participants)')), [6,4,3,8]);
ctx.createDefaultFormulaPreference = () => ({});
ctx.attributsOptionTropLongue = () => '';
ctx.blocNoteOptionsFermeture = () => '';
run('applyChosenActivitiesToBooking()');
assert.equal(ctx.state.booking.pax,18);
assert.equal(ctx.state.booking.laneCount,1);
for (const item of catalog) assert.match(run(`renderActivityOptions(getCenterActivity('${item.id}'),{},18)`), /data-role="participants-input"/);
ctx.state.booking.activities = {bowling:{duration:1,participants:6}};
assert.equal(run('deriveBookingType()'),'visite','single subset follows program API path');
ctx.state.booking.activities = {bowling:{duration:1,participants:18}};
assert.equal(run('deriveBookingType()'),'visite', 'fixture bowling has no planned metadata; real backend catalog does');
catalog.find(item=>item.id==='bowling').planned=true;
assert.equal(run('deriveBookingType()'),'bowling');
assert.equal(run("getBookingActivityParticipants(getCenterActivity('bowling'),{participants:0})"),1);
ctx.arcadeVisit = {pax:18,program:{items:[{activityId:'minigolf_blacklight',participants:3,minutes:45},{activityId:'arcade_time',participants:5,minutes:30}]}};
assert.match(run('renderActivitesCourtes(arcadeVisit)'),/Minigolf · 3/);
assert.match(run('renderActivitesCourtes(arcadeVisit)'),/Arcades · 5/);
assert.match(run('resumeProgrammeReservation(arcadeVisit)'),/Arcades 5 joueurs/);
assert.equal(run("estimerPrixProgramme(arcadeVisit.program.items,18,'2026-10-06','14:00').complet"),false);
assert.equal(run("estimerPrixProgramme(arcadeVisit.program.items,18,'2026-10-06','14:00').total"),30.75);
ctx.quickBookState = {pax:18,type:'visite',date:'2026-10-06',visit:{bowling:{on:false},laser_game:{on:false},others:{minigolf_blacklight:true,arcade_time:true},options:{minigolf_blacklight:{participants:3},arcade_time:{participants:5}}}};
assert.match(run('getQuickBookSummaryActivites().detail'),/Arcades : 5 joueurs/);
assert.match(run('getQuickBookSummaryActivites().detail'),/hors activités réglées sur place/);
console.log('PASS staff participant allocation: prices, all counters, edit roundtrip, formula contract, group reduction, mono conversion, detail semantics.');
