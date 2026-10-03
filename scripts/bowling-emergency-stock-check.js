'use strict';
const assert = require('node:assert/strict');
const bench = require('./slot-holds-check');
// Extend the existing transaction bench only for actual staff PATCH queries.
// Production database code and the hold bench stay unchanged.
const { Pool } = require('pg');
const originalConnect = Pool.prototype.connect;
let laneRows = [];
Pool.prototype.connect = async function () {
  const client = await originalConnect.call(this);
  const originalQuery = client.query.bind(client);
  client.query = async (sql, values = []) => {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    if (/^select \* from reservations where id = \$1 (limit 1|for update);?$/.test(statement)) {
      const row = bench.base.reservations.get(Number(values[0]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (/^select lane_number, status, maintenance_from, maintenance_until, maintenance_note from lane_statuses/.test(statement)) {
      return { rows: structuredClone(laneRows), rowCount: laneRows.length };
    }
    if (/^update reservations set center_id = \$2,/.test(statement)) {
      const [id, center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type, formule_id, label, occasion, extras, payment_method, notes, ops_plan, risk_level, risk_score, validation_status, activity_progress, program, companions] = values;
      const previous = bench.base.reservations.get(Number(id));
      const row = { ...previous, center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type, formule_id, label, occasion, extras: JSON.parse(extras), payment_method, notes, ops_plan: JSON.parse(ops_plan), risk_level, risk_score, validation_status, activity_progress: JSON.parse(activity_progress), program: JSON.parse(program), companions, updated_at: new Date(bench.base.horloge + 1) };
      bench.base.reservations.set(Number(id), row);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    return originalQuery(sql, values);
  };
  return client;
};
let assertions = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function occupied(free) { return Array.from({length: 8-free}, (_, i) => bench.reservationLigne(900+i, '15:00', [i+1])); }
function request(players, price) { return bench.visite('15:00', [{activityId:'bowling', participants:players,duration:1}], {pax: Math.max(18,players), quotedPrice:price}); }
async function main() {
  const S = bench.charger();
  const { allocateBowlingCapacity } = require('../lib/bowling-allocation');
  const config = {normalCapacityPerLane:6,emergencyCapacityPerLane:7};
  for (const [players, free, lanes, partition, emergency] of [[7,1,1,[7],true],[13,2,2,[6,7],true],[14,2,2,[7,7],true],[7,2,2,[3,4],false]]) {
    const a = allocateBowlingCapacity({players,config,durationMinutes:60,allocate:n=>n<=free?Array.from({length:n},(_,i)=>i+1):null});
    equal(a.requiredLanes,lanes,'actual stock allocation'); equal(a.bowlingCapacity.lanePlayers,partition,'exact partition');equal(a.bowlingCapacity.emergency,emergency,'fallback only when stock insufficient');
  }
  equal(allocateBowlingCapacity({players:8,config,allocate:n=>n<=1?[1]:null}),null,'hard emergency maximum');
  equal(allocateBowlingCapacity({players:7,config:{...config,emergencyCapacityPerLane:6},allocate:n=>n<=1?[1]:null}),null,'disabled emergency');
  equal(allocateBowlingCapacity({players:6,config:{normalCapacityPerLane:5,emergencyCapacityPerLane:6},allocate:n=>n<=1?[1]:null}).bowlingCapacity.lanePlayers,[6],'configured bound');
  equal(allocateBowlingCapacity({players:7,config,requiredLanes:1,allocate:n=>n<=2?Array.from({length:n},(_,i)=>i+1):null}).requiredLanes,2,'legacy emergency hint cannot bypass normal available stock');
  for (const [players, free, price, emergency] of [[7,1,39,true],[13,2,78,true],[7,2,78,false]]) {
    bench.semer(occupied(free));
    const h = await bench.retenir(S,request(players,price));
    equal(h.statut,201,JSON.stringify(h)); equal(h.json.price,price,'server hold price');equal(h.json.bowlingCapacity.emergency,emergency,'hold metadata');
    equal(h.json.program.items[0].participants,players,'visitors and bowlers distinct');equal(h.json.program.items[0].price,price,'actual billed units');
    equal(h.json.program.items[0].priceKnown,true,'known price');
    if (emergency) { equal(h.json.bowlingCapacity.estimatedMinutes,70,'10min/player'); assert.match(h.json.emergencyWarning,/complète n’est pas garantie/); assertions++; }
    // Another lane becomes free after holding: the retained amount and plan remain stable.
    if (emergency) bench.base.reservations.delete(900);
    const c = await bench.confirmer(S,bench.avecContact({...request(players,price),holdToken:h.json.holdToken}));
    equal(c.statut,201,JSON.stringify(c));
    const saved = [...bench.base.reservations.values()].find(r=>r.channel==='public');
    equal(saved.price,price,'held price survives confirmation');equal(saved.program.items[0].price,price,'persisted programme price');equal(saved.program.items[0].participants,players,'persisted own participants');
  }
  bench.semer(occupied(1));
  const race = await Promise.all([bench.retenir(S,request(7,39)),bench.retenir(S,request(7,39))]);
  equal(race.map(r=>r.statut).sort(),[201,409],'atomic last-lane race');
  bench.semer(occupied(2));
  const forged = await bench.retenir(S,{...request(7,39),program:[{activityId:'bowling',participants:7,duration:1,bowlingCapacity:{emergency:true},laneCount:1}],laneCount:1});
  equal(forged.statut,409,'forged emergency is not trusted'); equal(forged.json.code,'price_changed','requires price review');equal(forged.json.price,78,'normal stock price canonical');
  bench.semer(occupied(5).map(r=>({...r,duration:3,total_duration:3})));
  async function largeHold(players) {
    const r = S.requete.normalizeReservationRequest(request(players), {channel:'public'});
    const ops = await S.ops.prepareReservationOps(r,'public');
    const token=S.db.nouveauJetonBlocage(); const signature=require('../lib/demande-publique').signatureDemande(r);
    const input={...r,...ops,name:'Memory Check',phone:'0470000000',email:'local@example.invalid',lanes:ops.opsPlan.assignedLanes,channel:'public'};
    await S.db.createSlotHold(input,{jeton:token,signatureDemande:signature});
    return {statut:201,json:ops,input,token,signature};
  }
  const services = await largeHold(70);
  equal(services.statut,201,JSON.stringify(services));equal(services.json.price,390,'two emergency services billed ten lanes');
  equal(services.json.program.items[0].billedLaneCount,10,'actual paid services');
  equal(services.json.opsPlan.resourceBlocks.filter(b=>b.resourceType==='bowling_lane').map(b=>b.bowlingCapacity.lanePlayers),[[7,7,7,7,7],[7,7,7,7,7]],'each service counts35 instead of70');
  const servicesConfirm = await S.db.createReservation({...services.input,holdToken:services.token,signatureDemande:services.signature});
  equal(servicesConfirm.price,390,'large held programme confirmed under lock');
  equal([...bench.base.reservations.values()].find(r=>r.channel==='public').program.items[0].billedLaneCount,10,'persisted billed services');
  bench.semer([]);
  const physical = await largeHold(55);
  equal(physical.statut,201,JSON.stringify(physical));equal(physical.json.bowlingCapacity.emergency,true,'physical park fallback marked');equal(physical.json.bowlingCapacity.lanePlayers,[6,7,7,7,7,7,7,7],'55-player partition');
  const configModule=require('../lib/booking-config');const visitModule=require('../lib/visit-program');
  const {bowlingPlanQuote}=require('../lib/bowling-allocation');
  const gamesCenter=require('../lib/ops-knowledge').getCenter('libramont');
  const previousPricing=gamesCenter.resources.bowling.pricing;
  try {
    gamesCenter.resources.bowling.pricing={mode:'per_game_per_person',minutesPerGame:60,minutesPerPlayerPerGame:10,tiers:[{days:[0,1,2,3,4,5,6],prices:[10,18,25]}]};
    for (const games of [2,3]) {
      const option=configModule.getBowlingGameOptions(gamesCenter.resources.bowling,bench.JOUR,{pax:7,laneCount:2}).find(item=>item.games===games);
      const body=bench.visite('15:00',[{activityId:'bowling',participants:7,duration:option.value,games:999}],{pax:18,quotedPrice:7*option.price});
      bench.semer(occupied(1).map(row=>({...row,duration:4,total_duration:4})));
      const held=await bench.retenir(S,body);
      equal(held.statut,201,JSON.stringify(held));equal(held.json.program.items[0].games,games,'contracted games come from validated tariff, not forged raw games');
      equal(held.json.price,7*option.price,'emergency leaves purchased per-game price unchanged');
      equal(held.json.bowlingCapacity.estimatedMinutes,70*games,'estimate counts all purchased games');
      equal(held.json.bowlingCapacity.speedWarning,true,'all purchased games exceed retained time');
      assert.match(held.json.emergencyWarning,new RegExp('pour '+games+' parties'));assertions++;
      assert.match(held.json.emergencyWarning,new RegExp('les '+games+' parties complètes ne sont pas garanties'));assertions++;
      equal(held.json.opsPlan.resourceBlocks.find(block=>block.resourceType==='bowling_lane').games,games,'operational resource block retains contracted games');
      equal(held.json.program.items[0].duration,option.value,'retained duration never silently extended');
      const done=await bench.confirmer(S,bench.avecContact({...body,holdToken:held.json.holdToken}));equal(done.statut,201,JSON.stringify(done));
      const row=[...bench.base.reservations.values()].find(item=>item.channel==='public');
      equal(row.program.items[0].games,games,'persisted programme keeps contracted games');
      equal(row.program.items[0].bowlingCapacity.estimatedMinutes,70*games,'persisted estimate covers all games');
      equal(row.price,7*option.price,'persisted price unchanged');
      bench.semer(occupied(2).map(row=>({...row,duration:4,total_duration:4})));
      const normal=await bench.retenir(S,body);equal(normal.statut,201,JSON.stringify(normal));
      equal(normal.json.bowlingCapacity.emergency,false,'normal lanes preferred for purchased games');
      equal(normal.json.bowlingCapacity.estimatedMinutes,40*games,'normal estimate uses actual lane distribution');
      equal(normal.json.bowlingCapacity.speedWarning,false,'normal planned game time is sufficient');
      equal(normal.json.price,7*option.price,'normal and emergency have same per-game price');
    }
    bench.semer(occupied(1).map(row=>({...row,duration:4,total_duration:4})));
    const direct=require('../lib/ops-engine').planReservation({type:'bowling',centerId:'libramont',date:bench.JOUR,pax:7,startTime:'15:00',duration:1.5},{reservations:(await S.db.readStaffState(bench.JOUR,'libramont')).reservations,laneStatuses:{}});
    equal(direct.recommended.resourceBlocks[0].bowlingCapacity.estimatedMinutes,140,'dedicated bowling uses server tariff option contract');
  } finally {gamesCenter.resources.bowling.pricing=previousPricing;}
  for (const rate of [0,10]) {
    const perGame={laneCount:8,...config,pricing:{mode:'per_game_per_person',minutesPerGame:60,tiers:[{days:[0,1,2,3,4,5,6],prices:[rate]}]}};
    const games=visitModule.normalizeProgram([{activityId:'bowling',duration:1,participants:7}],{centerId:'libramont',pax:18,dateStr:bench.JOUR,bowlingConfig:perGame});
    const allocation=allocateBowlingCapacity({players:7,config:perGame,durationMinutes:60,allocate:n=>n<=1?[8]:null});
    const quote=bowlingPlanQuote(games,{resourceBlocks:[{resourceType:'bowling_lane',...allocation}]},{centerId:'libramont',dateStr:bench.JOUR,bowlingConfig:perGame});
    equal(quote.program.price,7*rate,'per-game billing unchanged by emergency lane count');equal(quote.program.items[0].priceKnown,true,'known per-game zero/nonzero');
  }
  const oldBowling=configModule.BOWLING_PRICES[1],oldLaser=configModule.LASER_GAME_OPTIONS[0].price;
  try {
    configModule.BOWLING_PRICES[1]=0;configModule.LASER_GAME_OPTIONS[0].price=0;
    const free=visitModule.normalizeProgram([{activityId:'bowling',duration:1,participants:7},{activityId:'duckpin_bowling',duration:1,participants:6},{activityId:'laser_game',games:1,participants:2}],{centerId:'libramont',pax:18,dateStr:bench.JOUR});
    equal(free.items.map(i=>i.price),[0,0,0],'explicit free grid rates');equal(free.items.map(i=>i.priceKnown),[true,true,true],'zero is known across all grid activities');equal(free.priceComplete,true,'free programme complete');
  } finally {configModule.BOWLING_PRICES[1]=oldBowling;configModule.LASER_GAME_OPTIONS[0].price=oldLaser;}
  bench.semer(occupied(1).map(r=>({...r,start_time:'10:00',duration:12,total_duration:12})));
  const bureau=require('../lib/demande-bureau');
  const study=await bureau.etudierDemande({centerId:'libramont',pax:18,payload:{demande:{participants:18,moment:'apres-midi',date:bench.JOUR,activities:[{id:'bowling',name:'Bowling',participants:7,duration:1}],formulas:[]}}}, {
    jourDe:()=>({ouvert:true,schedule:{open:10,close:23}}),
    disponibilite:async(params)=>{
      const req=require('node:stream').Readable.from([]);req.method='GET';req.url='/api/public-availability?'+new URLSearchParams({centerId:'libramont',...params});req.headers={'x-forwarded-for':'10.99.90.1'};req.socket={remoteAddress:'10.99.90.1'};
      const res={statusCode:200,setHeader(){},end(s){this.text=s;}};await S.dispo(req,res);return {status:res.statusCode,json:JSON.parse(res.text)};
    }
  });
  equal(study.dates[0].visite.prix,39,'real availability SM study exact selected-slot price');equal(study.dates[0].visite.lignes[0].prix,39,'SM line exact actual price');equal(study.dates[0].visite.lignes[0].bowlingCapacity.lanePlayers,[7],'SM partition preserved');assert.match(bureau.etudeEnTexte(study),/complète n’est pas garantie/);assertions++;
  for(const [type,price] of [['bowling',39],['formule',196]]) {
    bench.semer(occupied(1));const body=bench.visite('15:00',[],{pax:7,type,program:undefined,formuleId:type==='formule'?'f3':undefined,quotedPrice:price,preference:{preferredTimes:{bowling:'15:00'}}});
    const held=await bench.retenir(S,body);equal(held.statut,201,JSON.stringify(held));equal(held.json.price,price,'plain/formula exact price');equal(held.json.bowlingCapacity.lanePlayers,[7],'plain/formula own allocation');
    equal(held.json.opsPlan.timeline.find(b=>b.resourceType==='bowling_lane').requiredLanes,1,'timeline synchronized with allocated block');
    const done=await bench.confirmer(S,bench.avecContact({...body,holdToken:held.json.holdToken}));equal(done.statut,201,JSON.stringify(done));
    const saved=[...bench.base.reservations.values()].find(r=>r.channel==='public');equal(saved.price,price,'plain/formula saved price');
    const mail=require('../lib/ops-communications').buildMessage({reservation:S.db.normalizeReservationPayload({...saved,name:saved.name,phone:saved.phone,startTime:saved.start_time,centerId:'libramont',opsPlan:saved.ops_plan}),templateId:'confirmation',channel:'email'});
    assert.match(mail.body,/complète n’est pas garantie/);assertions++;
  }
  bench.semer(occupied(1));
  const protectedHold=await bench.retenir(S,request(7,39));equal(protectedHold.statut,201,'policy test initial hold');
  const center=require('../lib/ops-knowledge').getCenter('libramont');const oldEmergency=center.resources.bowling.emergencyCapacityPerLane;
  // Retained allocations remain editable after another lane is released.
  bench.semer(occupied(1));
  const editHold = await bench.retenir(S, request(7,39));
  equal(editHold.statut,201,'staff edit initial emergency hold');
  equal((await bench.confirmer(S,bench.avecContact({...request(7,39),holdToken:editHold.json.holdToken}))).statut,201,'staff edit initial reservation');
  const editRow = [...bench.base.reservations.values()].find(row=>row.channel==='public');
  bench.base.reservations.delete(900);
  for (const patch of [{name:'Updated contact',phone:'0470111111'},{price:35,basePrice:39},{validationStatus:'pending'}]) {
    const changed = await S.db.updateReservation({id:editRow.id,...patch});
    equal(changed.lanes,[8],'staff commercial PATCH keeps retained emergency lane');
    equal(changed.program.items[0].participants,7,'staff PATCH keeps own participants');
    equal(changed.program.items[0].price,39,'staff PATCH keeps actual catalogue price');
  }
  const commercialProgram = structuredClone(bench.base.reservations.get(editRow.id).program);
  commercialProgram.price=34;commercialProgram.items[0].price=34;commercialProgram.items[0].name='Bowling updated';
  equal((await S.db.updateReservation({id:editRow.id,program:commercialProgram,price:34})).lanes,[8],'programme commercial price and label preserve operational allocation');
  const moreVisitors=await S.db.updateReservation({id:editRow.id,pax:20});
  equal(moreVisitors.pax,20,'global visitors remain independently editable');
  equal(moreVisitors.program.items[0].participants,7,'global visitors do not increase own bowlers');
  equal(moreVisitors.lanes,[8],'global visitors do not inflate retained lane allocation');
  for (const activityId of ['mini_golf','arcade']) {
    const freeRow={...structuredClone(bench.base.reservations.get(editRow.id)),id:998,type:'activite',lanes:[],ops_plan:activityId==='mini_golf'?{resourceBlocks:[],timeline:[]}:null,program:{items:[{activityId,participants:7,planned:false}],price:0,priceComplete:false}};
    bench.base.reservations.set(998,freeRow);
    equal((await S.db.updateReservation({id:998,pax:21})).pax,21,'free activity global pax changes without bowling guard');
    bench.base.reservations.delete(998);
  }
  const refusedEdit = async (patch,label) => {
    const before = structuredClone(bench.base.reservations.get(editRow.id));
    await assert.rejects(S.db.updateReservation({id:editRow.id,...patch}),/changer|changé|piste|capacité/);assertions++;
    equal(bench.base.reservations.get(editRow.id),before,label+' writes nothing');
  };
  const extraPlayer=structuredClone(commercialProgram);extraPlayer.items[0].participants=8;
  await refusedEdit({program:extraPlayer},'changed own participants');
  await refusedEdit({startTime:'15:30'},'changed time');
  const nextDate=new Date(bench.JOUR+'T12:00:00Z');nextDate.setUTCDate(nextDate.getUTCDate()+1);
  await refusedEdit({date:nextDate.toISOString().slice(0,10)},'changed date');
  const forgedPlan=structuredClone(bench.base.reservations.get(editRow.id).ops_plan);
  forgedPlan.resourceBlocks.find(block=>block.resourceType==='bowling_lane').bowlingCapacity.emergencyCapacityPerLane=8;
  await refusedEdit({opsPlan:forgedPlan},'forged resource metadata');
  try {
    center.resources.bowling.emergencyCapacityPerLane=6;
    await refusedEdit({name:'Config tightened'},'changed capacity config');
  } finally {center.resources.bowling.emergencyCapacityPerLane=oldEmergency;}
  laneRows=[{lane_number:8,status:'maintenance',maintenance_from:null,maintenance_until:null,maintenance_note:''}];
  try {await refusedEdit({name:'Unavailable lane'},'maintenance lane');} finally {laneRows=[];}
  const collision=bench.reservationLigne(999,'15:00',[8]);bench.base.reservations.set(999,collision);
  await refusedEdit({name:'Collision'},'colliding reservation');
  bench.base.reservations.delete(999);
  // Resume the existing hold-policy counterexample after the staff-edit fixture.
  bench.semer(occupied(1));
  const policyHold=await bench.retenir(S,request(7,39));
  try {
    center.resources.bowling.emergencyCapacityPerLane=6;
    const refused=await bench.confirmer(S,bench.avecContact({...request(7,39),holdToken:policyHold.json.holdToken}));equal(refused.statut,409,'trusted hold respects current maximum');equal([...bench.base.reservations.values()].filter(r=>r.channel==='public').length,0,'policy refusal writes no reservation');
  } finally {center.resources.bowling.emergencyCapacityPerLane=oldEmergency;}
  const heldInput={...S.requete.normalizeReservationRequest(request(7,39),{channel:'public'}),...protectedHold.json,name:'Local',phone:'0470000000',lanes:[8],channel:'public'};
  assert.throws(()=>S.db.validateReservationResources(heldInput,[],{8:'maintenance'},[],bench.JOUR),/changer|piste|capacité/);assertions++;
  bench.semer(occupied(2));
  const req=require('node:stream').Readable.from([]);req.method='GET';req.url='/api/public-availability?'+new URLSearchParams({centerId:'libramont',date:bench.JOUR,type:'bowling',pax:'7',duration:'1',allowEmergencySeventh:'1'});req.headers={'x-forwarded-for':'10.99.91.1'};req.socket={remoteAddress:'10.99.91.1'};
  const res={statusCode:200,setHeader(){},end(s){this.text=s;}};await S.dispo(req,res);const slot=JSON.parse(res.text).slots.find(s=>s.time==='15:00');
  equal(slot.lanes.length,2,'actual availability ignores legacy seventh hint when normal stock fits');equal(slot.price,78,'legacy availability canonical normal price');
  bench.semer(occupied(1));const snapshot=await S.db.readStaffState(bench.JOUR,'libramont');
  const current=visitModule.normalizeProgram([{activityId:'bowling',participants:7,duration:1},{activityId:'laser_game',participants:7,games:1}],{centerId:'libramont',pax:18,dateStr:bench.JOUR});
  const cards=require('../lib/booking-complements').buildVisitComplements({centerId:'libramont',date:bench.JOUR,pax:18,program:current,retainedSlot:{time:'15:00',opsPlan:{anchorPlan:{times:{bowling:'15:00',laser_game:'16:00'}}}},reservations:snapshot.reservations,laneStatuses:{},blocks:[]});
  equal(cards.find(c=>c.id==='laser:laser_game:2').deltaTotal,56,'laser upgrade delta retains actual emergency bowling amount');
  console.log(`bowling-emergency-stock-check: ${assertions} assertions OK (memory DB, no network)`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
