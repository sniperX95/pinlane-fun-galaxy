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
  formatDurationLabel: value => `${value}h`, getRuntimeBowlingConfig: () => null, getFreeCount: () => 12,
});
vm.runInContext(fs.readFileSync(path.join(root, 'assets/booking-core.js'), 'utf8'), ctx);
ctx.testCatalog = catalog;
vm.runInContext('setCenterActivities(testCatalog)', ctx);
const functions = ['getQuickBookLaneNeed', 'bowlingCapacityMessage', 'getEditBowlingCapacityNeed', 'debutBowlingEdition', 'participantsLigneProgramme', 'nomActivite', 'catalogueDeLigne', 'ligneALaJournee', 'detailLigneProgramme', 'detailLigneProgrammeSansEffectif', 'detailUnitesLigne', 'buildEditProgramFromReservation', 'estimerPrixProgramme', 'getEditProgramItems', 'editionChangeLePrix', 'editArcadeTimingChanged', 'editProgramAChange', 'ensureQuickVisit', 'getQuickVisitOptions', 'getQuickVisitParticipants', 'getQuickVisitMinutes', 'getQuickVisitUnits', 'getQuickVisitHours', 'ligneProgrammeQuick', 'renderActivityParticipantsControl', 'setQuickVisitParticipants', 'setEditActivityParticipants', 'syncQuickBookDuration', 'getQuickBookSummaryActivites'];
for (const name of functions) {
  const from = app.indexOf(`function ${name}(`);
  assert.ok(from >= 0, name);
  const to = app.indexOf('\nfunction ', from + 1);
  vm.runInContext(app.slice(from, to < 0 ? undefined : to), ctx);
}
for (const name of ['activityParticipantsBounds', 'getQuickBookCustomPrice', 'getEditPriceValue', 'getLaserGameCountForReservation', 'getBookingActivityParticipants', 'getChosenActivities', 'normalizeBookingMode', 'deriveBookingType', 'buildBookingProgramPayload', 'applyChosenActivitiesToBooking', 'activityHourChoices', 'activityUnitChoices', 'renderActivityOptions', 'renderStaffArcadeOptions', 'renderActivityOptionsWithoutParticipants', 'renderProgramSummary', 'renderActivitesCourtes', 'resumeProgrammeReservation']) {
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
// Explicit free prices remain known; legacy totals0 carry no such promise.
for(const name of ['prixDossierConnu','getMoyenPaiementLabel','renderGroupePrix','renderGroupeActions','activityPriceHint','isUpcomingReservationStatus']) {
  const from=app.indexOf('function '+name+'(');
  vm.runInContext(app.slice(from,app.indexOf('\nfunction ',from+1)),ctx);
}
ctx.formatMoney=value=>value+'€';ctx.formatMoneyCentimes=value=>value+'€';ctx.isReservationAwaitingReview=()=>false;
ctx.GROUPE_MOYENS=[{valeur:'cash',mot:'Espèces'}];
ctx.freePrice={id:1,pax:18,status:'arrived',price:0,program:{priceComplete:true,items:[{activityId:'minigolf_blacklight',participants:3,price:0,priceKnown:true}]}};
ctx.unknownPrice={id:2,pax:18,status:'arrived',price:0,program:{priceComplete:false,items:[{activityId:'arcade_time',participants:5,price:0,priceKnown:false}]}};
assert.match(run('renderGroupePrix(freePrice)'),/<b>0€/);
assert.match(run('renderGroupeActions(freePrice,{etat:"closing"})'),/Encaisser 0€/);
assert.match(run('renderGroupePrix(unknownPrice)'),/Prix sur place/);
assert.equal(run('prixDossierConnu({price:0})'),false);
assert.equal(run('prixDossierConnu({price:null,program:{priceComplete:true}})'),false);
assert.equal(run('prixDossierConnu({price:0,basePrice:39})'),true,'waived positive reference is known0');
assert.equal(run('prixDossierConnu({price:0,program:[{price:0,priceKnown:true}]})'),true);
assert.match(run('activityPriceHint({priceType:"per_pax",priceValue:0},3)'),/0€/);
assert.equal(run('activityPriceHint({priceType:"per_pax",priceValue:null},3)'),'réglé sur place');
// An unconfigured historical Arcade line has no purchased card contract.
// Exercise known zero on the per-person minigolf tariff; configured free
// Arcade cards are covered independently by arcade-offers-staff-check.
const golfPriceBefore = catalog.find(item=>item.id==='minigolf_blacklight').priceValue;
catalog.find(item=>item.id==='minigolf_blacklight').priceValue=0;
assert.equal(run("estimerPrixProgramme([{activityId:'minigolf_blacklight',participants:5}],18,'2026-10-06','14:00').complet"),true);
assert.equal(run("estimerPrixProgramme([{activityId:'minigolf_blacklight',participants:5}],18,'2026-10-06','14:00').total"),0);
ctx.quickBookState.visit.others.arcade_time = false;
assert.doesNotMatch(run('getQuickBookSummaryActivites().detail'),/réglées sur place/);
assert.equal(run('getQuickBookSummaryActivites().total'),0);
ctx.quickBookState.visit.others.arcade_time = true;
catalog.find(item=>item.id==='minigolf_blacklight').priceValue=golfPriceBefore;
assert.equal(run("estimerPrixProgramme([{activityId:'arcade_time',participants:5}],18,'2026-10-06','14:00').complet"),false);
// Real game pricing: 80 visitors accompany only6 bowlers. With10 players
assert.equal(run("getActivitySessionCount(getCenterActivity('fun_run'),240)"),48);
assert.equal(run("getActivitySessionCount(getCenterActivity('fun_run'),1000)"),200);
assert.equal(run("getActivityUnitPlan(getCenterActivity('duckpin_bowling'),1000).units"),167);
assert.equal(run("getActivityUnitPlan(getCenterActivity('duckpin_bowling'),1000).tours"),84);
assert.equal(run("getFreeActivityPrice(getCenterActivity('fun_run'),{pax:240,minutes:30})"),2640);
assert.equal(run("getFreeActivityPrice(getCenterActivity('fun_run'),{pax:1000,minutes:30})"),11000);
assert.equal(run("estimerPrixProgramme([{activityId:'duckpin_bowling',participants:1000,duration:1}],1000,'2026-10-06','14:00').total"),167*39);
assert.equal(run("getActivityUnitPlan(getCenterActivity('billards'),1000,999).units"),5,'physical table selection still bounded by catalog installation');
for(const name of ['crActivites','applyStaffRequestActivitiesToQuickBook','setQuickVisitActivityDuration','renderQuickVisitOptions','renderStaffRequestStudyLines','renderStaffRequestStudyDay','renderStaffRequestTimes','renderStaffRequestBudgetTag']) {
  const from=app.indexOf('function '+name+'(');assert.ok(from>=0,name);
  vm.runInContext(app.slice(from,app.indexOf('\nfunction ',from+1)),ctx);
}
ctx.customChoice={participants:18,activities:[{id:'bowling',name:'Bowling',participants:6,duration:1.5},{id:'laser_game',name:'Laser Game',participants:4,games:3},{id:'minigolf_blacklight',name:'Minigolf',participants:3},{id:'billards',name:'Billard',participants:8,units:2,hours:2},{id:'duckpin_bowling',name:'Duckpin',participants:6,duration:0.5},{id:'fun_run',name:'Fun Run',participants:6,minutes:30},{id:'arcade_time',name:'Arcades',participants:5}]};
ctx.quickBookState={pax:18,type:'bowling',date:'2026-10-06',startTime:'14:00',sourceRequestId:55};
assert.equal(run('applyStaffRequestActivitiesToQuickBook(customChoice)'),true);
assert.equal(ctx.quickBookState.pax,18);assert.equal(ctx.quickBookState.sourceRequestId,55);
assert.equal(ctx.quickBookState.visit.bowling.duration,1.5);
{
  const from=app.indexOf('async function saveQuickBook(');
  vm.runInContext(app.slice(from,app.indexOf('\nfunction ',from+1)),ctx);
  // La fenetre v5 tient la liste de ses resas (rvResas) : une seule ici.
  ctx.document={querySelector:()=>null,getElementById:()=>null};ctx.toast=()=>{};ctx.rvResas=[ctx.quickBookState];
  ctx.quickBookState.pax=1000;ctx.quickBookState.name='Groupe';ctx.quickBookState.phone='';ctx.quickBookState.email='';ctx.quickBookState.submitting=false;
  run('saveQuickBook()');
  assert.match(ctx.quickBookState.error,/240 personnes.*planifiée manuellement/);
  assert.equal(ctx.quickBookState.pax,1000,'manual group is refused without silently reducing its size');
  assert.equal(ctx.quickBookState.visit.options.bowling.participants,6);
  assert.equal(ctx.quickBookState.submitting,false);
  ctx.quickBookState.pax=18;
}
assert.equal(ctx.quickBookState.visit.laser_game.games,3);
assert.equal(run("ligneProgrammeQuick('duckpin_bowling').duration"),0.5);
assert.equal(run("ligneProgrammeQuick('billards').units"),2);
assert.equal(run("ligneProgrammeQuick('billards').hours"),2);
assert.equal(run("ligneProgrammeQuick('fun_run').minutes"),30);
assert.equal(run("ligneProgrammeQuick('fun_run').participants"),6);
assert.match(run('crActivites(customChoice).join(" | ")'),/Billard : 8 joueurs.*2 tables.*2h/);
assert.match(run("renderQuickVisitOptions({id:'duckpin_bowling'})"),/setQuickVisitActivityDuration/);
assert.equal(run('getQuickBookSummaryActivites().total'),359.75);
run("setQuickVisitActivityDuration('duckpin_bowling',2)");
assert.equal(run("ligneProgrammeQuick('duckpin_bowling').duration"),2);
assert.equal(ctx.quickBookState.visit.bowling.duration,1.5);
ctx.staffRequestEuro=n=>n+' €';ctx.staffRequestLongDate=()=>'';ctx.staffRequestClock=()=>'';ctx.STAFF_REQUEST_ICONS={calendar:''};
ctx.manualStudy={date:'2026-10-06',ouvert:true,horaires:{de:'10:00',a:'22:00'},formules:[],visite:{ok:false,raison:'Horaires à étudier manuellement',prix:1170,lignes:[{nom:'Bowling',participants:300,detail:'3 services de1h',prix:1170}]}};
assert.match(run('renderStaffRequestStudyDay(manualStudy,{moment:"indifferent"},customChoice)'),/300 joueurs.*3 services de1h.*1170 €/);
assert.match(run('renderStaffRequestStudyDay(manualStudy,{moment:"indifferent"},customChoice)'),/Horaires à étudier manuellement/);
ctx.manualStudy.visite.ok=true;ctx.manualStudy.visite.prix=0;ctx.manualStudy.visite.parJoueur=0;ctx.manualStudy.visite.lignes=[{nom:'Minigolf',participants:3,prix:0}];
assert.match(run('renderStaffRequestStudyDay(manualStudy,{moment:"indifferent"},customChoice)'),/3 joueurs.*0 €/);
assert.doesNotMatch(run('renderStaffRequestStudyDay(manualStudy,{moment:"indifferent"},customChoice)'),/Prix à confirmer/);
// per lane, group80 incorrectly produces60min for one game; the6 bowlers
// need30min, which fits the45min left before closing.
{
  const from=app.indexOf('function ajusterDureesAvantFermeture(');
  vm.runInContext(app.slice(from,app.indexOf('\nfunction ',from+1)),ctx);
  ctx.getBookingCatalogConfig=()=>({normalCapacityPerLane:10,emergencyCapacityPerLane:10,laneCount:8,bowlingPricing:{mode:'per_game_per_person',minutesPerPlayerPerGame:4,tiers:[{days:[0,1,2,3,4,5,6],prices:[8,14]}]}});
  ctx.heuresJusquALaFermeture=()=>0.75;
  ctx.save=()=>{};
  run('let dureesRamenees=[]');
  ctx.state.booking={mode:'carte',pax:80,date:'2026-10-06',activities:{bowling:{duration:1,participants:6}}};
  assert.equal(run("getBowlingGameOptions(state.booking.date,{pax:80,laneCount:getRequiredLaneCount('bowling',80,'')})[0].value"),1,'counterexample global visitors do not fit remaining45min');
  assert.equal(run("getBowlingGameOptions(state.booking.date,{pax:6,laneCount:getRequiredLaneCount('bowling',6,'')})[0].value"),0.5,'own bowlers fit remaining45min');
  assert.equal(run('ajusterDureesAvantFermeture()'),true);
  assert.equal(ctx.state.booking.activities.bowling.duration,0.5);
  assert.equal(ctx.state.booking.activities.bowling.participants,6);
  assert.equal(ctx.state.booking.pax,80);
  assert.equal(run('ajusterDureesAvantFermeture()'),false,'already fitting selection stays stable');
  const changed=app.replace('pax: participants, laneCount: getRequiredLaneCount(\'bowling\', participants, \'\')','pax: state.booking.pax, laneCount: getRequiredLaneCount(\'bowling\', state.booking.pax, \'\')');
  const start=changed.indexOf('function ajusterDureesAvantFermeture(');
  vm.runInContext(changed.slice(start,changed.indexOf('\nfunction ',start+1)),ctx);
  ctx.state.booking.activities.bowling.duration=1;
  assert.equal(run('ajusterDureesAvantFermeture()'),false,'old global-player mutation cannot reduce to the fitting30min game');
}
console.log('PASS staff participant allocation: prices, all counters, edit roundtrip, formula contract, group reduction, mono conversion, detail semantics.');

ctx.getBookingCatalogConfig=()=>({normalCapacityPerLane:6,emergencyCapacityPerLane:7,laneCount:12});
assert.equal(run('getBowlingCapacityPlan(7,1).requiredCount'),1);
assert.deepEqual(Array.from(run('getBowlingCapacityPlan(13,2).bowlingCapacity.lanePlayers')),[6,7]);
assert.equal(run('getBowlingCapacityPlan(13,3).bowlingCapacity.emergency'),false);
assert.equal(run('getBowlingCapacityPlan(7,2).requiredCount'),2);
assert.equal(run('getBowlingCapacityPlan(7,1).bowlingCapacity.speedWarning'),true);
assert.equal(run('getBowlingCapacityPlan(7,1,90).bowlingCapacity.speedWarning'),false);
ctx.getFreeCount=()=>1;
ctx.quickBookState={pax:18,type:'visite',duration:1,date:'2026-10-06',startTime:'14:00',visit:{bowling:{on:true,duration:1},options:{bowling:{participants:7}},others:{}}};
assert.equal(run('getQuickBookLaneNeed().requiredCount'),1);
assert.equal(run("ligneProgrammeQuick('bowling').laneCount"),1);
assert.equal(run("getQuickBookSummaryActivites().total"),39);
assert.match(run("detailLigneProgramme({...ligneProgrammeQuick('bowling'),duration:1},{pax:18})"),/7 joueurs.*70 min.*pas garanti/);
console.log('Emergency real stock capacity and own7 of group18 pricing: PASS');

ctx.goStep=()=>{};
{
  const from=app.indexOf('function selectSlot(');
  vm.runInContext(app.slice(from,app.indexOf('\nfunction ',from+1)),ctx);
}
ctx.state.booking={type:'visite',pax:18};
ctx.state.availableSlots=[{time:'14:00',lanes:[1],price:39,program:{items:[{activityId:'bowling',participants:7,laneCount:1}],price:39},bowlingCapacity:run('getBowlingCapacityPlan(7,1).bowlingCapacity')}];
run('selectSlot(0)');
assert.equal(ctx.state.booking.laneCount,1);
assert.equal(ctx.state.booking.serverPrice,39);
assert.equal(ctx.state.booking.serverProgram.items[0].participants,7);
assert.equal(ctx.state.booking.bowlingCapacity.speedWarning,true);
ctx.getBookingCatalogConfig=()=>({normalCapacityPerLane:4,emergencyCapacityPerLane:5,laneCount:12});
assert.equal(run('getBowlingCapacityPlan(7,1).requiredCount'),2,'configured emergency5 refuses7 on one');
assert.equal(run('getBowlingCapacityPlan(9,2).requiredCount'),2,'configured emergency5 allows9 on two');
assert.equal(run('getBowlingCapacityPlan(9,3).requiredCount'),3,'configured normal4 wins when3 available');
console.log('Generic selectedslot price/program and settings authority: PASS');
