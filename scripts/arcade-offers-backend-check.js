'use strict';
const assert = require('node:assert/strict');
const bench = require('./slot-holds-check');
const { Pool } = require('pg');
const originalConnect = Pool.prototype.connect;
Pool.prototype.connect = async function () {
  const client = await originalConnect.call(this);const query=client.query.bind(client);
  client.query=async (sql,values=[])=>{
    const statement=String(sql).replace(/\s+/g,' ').trim();
    if (/^select \* from reservations where id = \$1 (limit 1|for update);?$/.test(statement)) {
      const row=bench.base.reservations.get(Number(values[0]));return {rows:row?[structuredClone(row)]:[],rowCount:row?1:0};
    }
    if (/^update reservations set center_id = \$2,/.test(statement)) {
      const [id,center_id,channel,name,phone,email,date,start_time,duration,total_duration,lanes,pax,status,base_price,price,type,formule_id,label,occasion,extras,payment_method,notes,ops_plan,risk_level,risk_score,validation_status,activity_progress,program,companions]=values;
      const row={...bench.base.reservations.get(Number(id)),center_id,channel,name,phone,email,date,start_time,duration,total_duration,lanes,pax,status,base_price,price,type,formule_id,label,occasion,extras:JSON.parse(extras),payment_method,notes,ops_plan:JSON.parse(ops_plan),risk_level,risk_score,validation_status,activity_progress:JSON.parse(activity_progress),program:JSON.parse(program),companions,updated_at:new Date(bench.base.horloge+1)};
      bench.base.reservations.set(Number(id),row);return{rows:[structuredClone(row)],rowCount:1};
    }
    return query(sql,values);
  };return client;
};
const arcade = require('../lib/arcade-offers');
const { normalizeCenterConfig } = require('../lib/center-config');
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function throws(fn, label) { assert.throws(fn, /Arcades/); checks++; }
function contains(text, pattern) { assert.match(text, pattern); checks++; }
async function main() {
  const S = bench.charger();
  const catalog = require('../lib/activity-catalog');
  const visit = require('../lib/visit-program');
  const publicContract = require('../lib/demande-publique');
  let center = require('../lib/ops-knowledge').getCenter('libramont');
  const originalOffers = center.activityOffers;
  const config = arcade.defaults();
  for (const id of ['libramont', 'gembloux', 'ciney']) equal(normalizeCenterConfig({}, id).activityOffers.arcade_time, config, 'FG defaults only');
  for (const id of ['demo', 'n4-bowling', 'other-tenant']) equal(normalizeCenterConfig({}, id).activityOffers.arcade_time, null, 'no foreign tenant default');
  for (const invalid of [
    {...config,timeOffers:[{id:'bad',minutes:0,price:15}]},
    {...config,timeOffers:[{id:'bad',minutes:30,price:-1}]},
    {...config,timeOffers:[{id:'bad',minutes:30,price:Infinity}]},
    {...config,timeOffers:[{id:'bad',minutes:30,price:NaN}]},
    {...config,timeOffers:[{id:'bad',minutes:30,price:null}]},
    {...config,timeOffers:[{id:'duplicate',minutes:30,price:15},{id:'duplicate',minutes:60,price:30}]},
    {...config,creditOffers:[{id:'none',price:0,credits:0,bonusCredits:0}]},
    {...config,creditGameCostMin:3,creditGameCostMax:2},
    {...config,enabled:'true'}, {...config,timeOffers:{}},
  ]) {
    throws(()=>arcade.normalizeArcadeOffers(invalid,{strict:true}),'strict invalid config');
    equal(arcade.normalizeArcadeOffers(invalid),null,'invalid config safely unavailable on read');
  }
  const custom=structuredClone(config);custom.timeOffers[0].price=12.34;
  equal(normalizeCenterConfig({activityOffers:{arcade_time:custom}},'libramont',{strict:true}).activityOffers.arcade_time.timeOffers[0].price,12.34,'per-center custom cents');
  equal(normalizeCenterConfig({activityOffers:{arcade_time:null}},'libramont').activityOffers.arcade_time,null,'explicit no configuration');
  const line=(mode,id,cards=3,participants=3)=>({activityId:'arcade_time',participants,arcadeMode:mode,arcadeOfferId:id,cards});
  const normalized=(item,pax=18)=>visit.normalizeProgram([item],{centerId:'libramont',pax,dateStr:bench.JOUR});
  for (const [mode,id,unit,totalCredits,minutes] of [['time','time-30',15,null,30],['time','time-60',30,null,60],['credit','credit-10',10,10,null],['credit','credit-25',25,35,null],['credit','credit-35',35,50,null],['credit','credit-50',50,75,null]]) {
    const program=normalized(line(mode,id));const item=program.items[0];
    equal(program.price,unit*3,'exact card price');equal(item.priceKnown,true,'known card amount');equal(item.cards,3,'card count');
    equal(item.participants,3,'own players');equal(item.arcadeOffer.price,unit,'server unit price');equal(item.arcadeOffer.mode,mode,'server mode');
    equal(item.arcadeOffer.prizeGamesIncluded,mode==='credit','prize game policy');equal(item.arcadeOffer.unlimited,mode==='time','unlimited policy');
    equal(item.durationEstimated,mode==='credit','credit time is estimate only');
    if (mode==='credit') {
      equal(item.arcadeOffer.totalCredits,totalCredits,'bonus credits added, not euros');
      equal(item.arcadeOffer.gameCostMin,1.2,'minimum game credits');equal(item.arcadeOffer.gameCostMax,2.4,'maximum game credits');
      contains(arcade.arcadeSummary(item),/durée de jeu variable/);
    } else equal(item.minutes,minutes,'purchased minutes');
    equal(normalized(item).items[0],item,'normalized replay remains exact');
    equal(S.db.normalizeReservationProgram?S.db.normalizeReservationProgram(program):S.db.normalizeReservationPayload({...bench.avecContact(bench.visite('15:00',[])),program}).program, {items:program.items.map(it=>({...it,planned:false})),price:program.price,priceComplete:true},'stored full contract');
  }
  for (const choice of [line('bogus','time-30'),line('credit','time-30'),line('time','disabled'),line('time','time-30',2),line('time','time-30',true,1),line('credit','credit-10',0),line('credit','credit-10',1001),line('credit','credit-10',1.5),line('credit','credit-10',Infinity)]) throws(()=>normalized(choice),'invalid purchase rejected');
  equal(normalized({...line('credit','credit-35'),price:0,arcadeOffer:{price:0,totalCredits:9999}}).price,105,'client cannot forge price or credits');
  equal(normalized(line('credit','credit-25',2,7)).price,50,'credit cards independent from own players');
  equal(normalized(line('credit','credit-25',1000,2)).price,25000,'one thousand credit cards can belong to two players');
  for (const invalid of [NaN,Infinity,true,1.5,'',null]) {
    if (invalid === null) continue; // Null is the same omitted card quantity used by old clients.
    throws(()=>normalized(line('credit','credit-10',invalid)),'malformed credit card quantity');
  }
  for (const invalid of [241,NaN,Infinity,true,1.5]) throws(()=>normalized(line('credit','credit-10',3,invalid)),'malformed own participants');
  equal(normalized(line('time','time-30',240,240),240).price,3600,'full normal participant limit');
  equal(visit.normalizeProgram([line('time','time-30',1000,1000)],{centerId:'libramont',pax:1000,participantLimit:1000}).price,15000,'full SM timed participant limit');
  const forged=normalized({...line('credit','credit-50'),arcadeOffer:{price:0,minutes:999,credits:999,bonusCredits:999,prizeGamesIncluded:false,unlimited:true}}).items[0];
  equal(forged.arcadeOffer.totalCredits,75,'forged bonus ignored');equal(forged.arcadeOffer.prizeGamesIncluded,true,'prize policy comes from server');equal(forged.arcadeOffer.unlimited,false,'credit card not forged as unlimited');
  equal(normalized({activityId:'arcade_time',participants:7}).items[0].price,null,'legacy arcade amount stays unknown');
  const request=(item,quotedPrice)=>bench.visite('15:00',[item],{pax:18,quotedPrice});
  throws(()=>S.requete.normalizeReservationRequest({...request(line('credit','credit-25'),75),extras:[{id:'arcades-temps',price:45}]},{channel:'public'}),'new cards cannot duplicate legacy extras');
  throws(()=>S.requete.normalizeReservationRequest({...request({...line('credit','credit-25'),activityId:undefined,id:'arcade_time'},75),extras:[{id:'arcades-argent',price:45,qty:0}]},{channel:'staff'}),'raw activity alias and fake zero qty cannot bypass actually billed extras');
  for(const channel of ['public','staff']) throws(()=>S.requete.normalizeReservationRequest({...request(line('time','time-30'),45),extras:[{id:'arcades-temps',price:50,qty:0}]},{channel}),`${channel}: positive timed extra remains billed despite zero qty and cannot duplicate purchased cards`);
  equal(S.requete.normalizeReservationRequest({...request(line('credit','credit-25'),75),extras:{'arcades-temps':{price:45}}},{channel:'staff'}).programPrice,75,'object extras are not automatically counted by actual caller');
  const sigA=publicContract.signatureDemande(S.requete.normalizeReservationRequest(request(line('credit','credit-25'),75),{channel:'public'}));
  const sigB=publicContract.signatureDemande(S.requete.normalizeReservationRequest(request(line('credit','credit-35'),105),{channel:'public'}));
  equal(sigA===sigB,false,'different same-duration packs cannot reuse held contract');
  // Quotes retained by a hold stay contractual even while the centre changes its catalogue.
  bench.semer([]);
  const frozenBody=request(line('credit','credit-25',2,7),50);
  const frozenHold=await bench.retenir(S,frozenBody);equal(frozenHold.statut,201,'hold before configuration change');
  // The public handler warms the registry; resolve its current object again.
  center=require('../lib/ops-knowledge').getCenter('libramont');
  const changedContract=structuredClone(config);changedContract.creditOffers[1].price=99;changedContract.creditOffers[1].bonusCredits=50;
  center.activityOffers={arcade_time:changedContract};
  equal(normalized(line('credit','credit-25',2,7)).price,198,'new current catalogue really changed before held confirmation');
  const frozenConfirm=await bench.confirmer(S,bench.avecContact({...frozenBody,holdToken:frozenHold.json.holdToken}));
  equal(frozenConfirm.statut,201,JSON.stringify(frozenConfirm));
  const frozenRow=[...bench.base.reservations.values()].find(r=>r.channel==='public');
  equal(frozenRow.price,50,'held price frozen after centre repricing');equal(frozenRow.program.items[0].arcadeOffer.totalCredits,35,'held credits and bonus frozen');
  center.activityOffers=originalOffers;
  bench.semer([]);
  const disabledBody=request(line('time','time-30'),45);
  const disabledHold=await bench.retenir(S,disabledBody);equal(disabledHold.statut,201,'hold before card disabled');
  center=require('../lib/ops-knowledge').getCenter('libramont');
  const disabledContract=structuredClone(config);disabledContract.timeOffers[0].enabled=false;center.activityOffers={arcade_time:disabledContract};
  throws(()=>normalized(line('time','time-30')),'new creation sees actual disabled offer');
  const disabledConfirm=await bench.confirmer(S,bench.avecContact({...disabledBody,holdToken:disabledHold.json.holdToken}));
  equal(disabledConfirm.statut,422,'disabled held card refuses explicitly rather than selling another card');equal([...bench.base.reservations.values()].filter(r=>r.channel==='public').length,0,'disabled card writes nothing');
  center.activityOffers=originalOffers;
  const otherCenter=require('../lib/ops-knowledge').getCenter('gembloux');const otherOriginal=otherCenter.activityOffers;
  const otherPricing=structuredClone(config);otherPricing.timeOffers[0].price=19;otherCenter.activityOffers={arcade_time:otherPricing};
  try {
    const foreign=visit.normalizeProgram([{...line('time','time-30'),arcadeOffer:arcade.quoteArcadeOffer(config,line('time','time-30'),3).arcadeOffer}],{centerId:'gembloux',pax:18,dateStr:bench.JOUR});
    equal(foreign.price,57,'foreign snapshot ignored in favour of current tenant offer');
    equal(foreign.items[0].arcadeOffer.price,19,'foreign snapshot cannot set unit price');
  } finally {otherCenter.activityOffers=otherOriginal;}
  try {
    center.activityOffers={arcade_time:custom};
    equal(normalized(line('time','time-30')).price,37.02,'center override computes exact cents');
    equal(catalog.getCenterActivity('gembloux','arcade_time').arcadeOffers.timeOffers[0].price,15,'other FG centre unaffected');
    const free=structuredClone(custom);free.timeOffers[0].price=0;center.activityOffers={arcade_time:free};
    equal(normalized(line('time','time-30')).items[0].priceKnown,true,'explicit zero is known');equal(normalized(line('time','time-30')).priceComplete,true,'free card total complete');
    const disabled=structuredClone(config);disabled.creditOffers[0].enabled=false;center.activityOffers={arcade_time:disabled};
    throws(()=>normalized(line('credit','credit-10')),'disabled card rejected');
  } finally {center.activityOffers=originalOffers;}
  bench.semer([]);
  const wrongPrice=await bench.retenir(S,request(line('credit','credit-35'),0));
  equal(wrongPrice.statut,409,'stale quoted card price explicit');equal(wrongPrice.json.code,'price_changed','review new price');equal(wrongPrice.json.price,105,'canonical card quote');
  bench.semer([]);
  const body=request(line('credit','credit-25',2,7),50);
  const held=await bench.retenir(S,body);equal(held.statut,201,JSON.stringify(held));equal(held.json.price,50,'held card exact amount');
  equal(held.json.program.items[0].arcadeOffer.totalCredits,35,'held bonus contract');
  const saved=await bench.confirmer(S,bench.avecContact({...body,holdToken:held.json.holdToken}));equal(saved.statut,201,JSON.stringify(saved));
  const row=[...bench.base.reservations.values()].find(r=>r.channel==='public');
  equal(row.program.items[0].cards,2,'persisted card count');equal(row.program.items[0].participants,7,'persisted own participants');equal(row.program.items[0].arcadeOffer.totalCredits,35,'persisted credits bonus');
  center.activityOffers={arcade_time:custom};custom.creditOffers[1].price=99;
  const reread=(await S.db.readStaffState(bench.JOUR,'libramont')).reservations.find(r=>r.id===row.id);
  equal(reread.program.items[0].arcadeOffer.price,25,'historical unit quote remains after catalog change');equal(reread.price,50,'historical total remains');
  const noLongerSold=structuredClone(config);noLongerSold.creditOffers[1].enabled=false;center.activityOffers={arcade_time:noLongerSold};
  for (const patch of [{name:'Contact updated'},{validationStatus:'pending'},{price:45}]) {
    const updated=await S.db.updateReservation({id:row.id,...patch});
    equal(updated.program.items[0].arcadeOffer.price,25,'nonoperational edit keeps original unit price after card disabled');
    equal(updated.program.items[0].arcadeOffer.totalCredits,35,'nonoperational edit keeps original bonus');
    equal(updated.program.items[0].cards,2,'nonoperational edit keeps purchased card count');
  }
  // Le vrai endpoint reçoit le DTO complet du comptoir, pas un PATCH minimal.
  let replans=0;
  const replace=(file,overrides)=>{const key=require.resolve('../'+file);const actual=require(key);require.cache[key].exports={...actual,...overrides};};
  const session={authorizedCenterId:'libramont',centerId:'libramont',member:{id:'memory',name:'Memory'}};
  replace('lib/staff-auth.js',{getStaffSessionFromRequest:async()=>session,requireStaffPermission:async()=>session});
  replace('lib/database.js',{getReservationById:async(id)=>(await S.db.readStaffState(bench.JOUR,'libramont')).reservations.find(r=>r.id===Number(id)),cancelReservationCommunications:async()=>[],cancelReservationOpsJobs:async()=>[],createOpsEvent:async()=>({})});
  replace('lib/audit-log.js',{writeAuditLog:async()=>({})});
  replace('lib/ops-knowledge.js',{refreshCenterOverrides:async()=>{}});
  replace('lib/booking-config.js',{refreshFormuleOverrides:async()=>{}});
  replace('lib/catalog-store.js',{refreshCatalog:async()=>{}});
  replace('lib/reservation-ops.js',{prepareReservationOps:async(...args)=>{replans++;return S.ops.prepareReservationOps(...args);}});
  const staffHandler=require('../api/staff-reservations');
  const patchStaff=async(body)=>{const req=require('node:stream').Readable.from([Buffer.from(JSON.stringify(body))]);req.method='PATCH';req.headers={};const res={statusCode:200,setHeader(){},end(value){this.body=JSON.parse(value);}};await staffHandler(req,res);return res;};
  const full=await S.db.updateReservation({id:row.id,price:50});
  for(const changes of [{name:'Full DTO contact'},{validationStatus:'confirmed'},{price:47},{pax:20}]) {
    const response=await patchStaff({...full,...changes,laneCount:0,requiresLanes:false});
    equal(response.statusCode,200,JSON.stringify(response.body));
    equal(response.body.reservation.program.items[0].arcadeOffer.price,25,'full DTO keeps disabled historical card contract');
  }
  equal(replans,0,'administrative full DTO and global visitors with explicit own players do not replan');
  const tooSmallGroup=await patchStaff({...full,pax:6});
  equal(tooSmallGroup.statusCode,422,'global visitors cannot shrink below seven own activity players');
  equal(replans,0,'invalid global shrink refuses before requoting disabled historical card');
  equal(bench.base.reservations.get(full.id).pax,20,'invalid group shrink writes nothing');
  const forgedFull=structuredClone(full);forgedFull.program.items[0].arcadeOffer.bonusCredits=999;forgedFull.program.items[0].price=0;
  const forgedEdit=await patchStaff({...forgedFull,name:'Metadata ignored'});
  equal(forgedEdit.statusCode,200,'derived metadata edit does not replan');
  equal(forgedEdit.body.reservation.program.items[0].arcadeOffer.bonusCredits,10,'client snapshot cannot replace saved bonus');
  for(const changes of [{date:'2030-01-01'},{startTime:'16:00'},{program:{items:[{...full.program.items[0],cards:3}]}},{program:{items:[{...full.program.items[0],participants:8}]}}]) {
    const previous=replans;const response=await patchStaff({...full,...changes});
    equal(replans,previous+1,'actual date/time/card/player change replans');
    equal(response.statusCode,422,'disabled current offer explicitly refuses an operational change');
  }
  const activeAgain=structuredClone(config);activeAgain.creditOffers[1].price=35;
  center.activityOffers={arcade_time:activeAgain};
  const newCards={...full.program.items[0],cards:3};
  const requoted=await patchStaff({id:full.id,program:{items:[newCards]},skipReplan:true});
  equal(requoted.statusCode,200,JSON.stringify(requoted.body));
  equal(requoted.body.reservation.program.items[0].arcadeOffer.price,35,'operational partial PATCH requotes current unit price despite old snapshot');
  equal(requoted.body.reservation.price,105,'three new cards count exact current quote');
  equal(requoted.body.reservation.program.items[0].cards,3,'operational partial PATCH saves new card count');
  equal(requoted.body.reservation.date,full.date,'partial operative PATCH retains current date');
  center.activityOffers=originalOffers;
  bench.semer(Array.from({length:7},(_,i)=>bench.reservationLigne(900+i,'15:00',[i+1])));
  const bowlingBody=request({activityId:'bowling',participants:7,duration:1},39);
  const bowlingHold=await bench.retenir(S,bowlingBody);equal(bowlingHold.statut,201,'physical emergency API edit initial hold');
  equal((await bench.confirmer(S,bench.avecContact({...bowlingBody,holdToken:bowlingHold.json.holdToken}))).statut,201,'physical emergency API edit initial save');
  const bowlingRow=[...bench.base.reservations.values()].find(r=>r.channel==='public');
  bench.base.reservations.delete(900);
  const bowlingFull=(await S.db.readStaffState(bench.JOUR,'libramont')).reservations.find(r=>r.id===bowlingRow.id);
  const beforeBowlingReplans=replans;
  for(const changes of [{name:'Full bowling contact'},{pax:20},{price:35}]) {
    const response=await patchStaff({...bowlingFull,...changes,laneCount:1,requiresLanes:true});
    equal(response.statusCode,200,JSON.stringify(response.body));
    equal(response.body.reservation.lanes,[8],'full DTO keeps actual emergency lane after another lane frees');
    equal(response.body.reservation.program.items[0].price,39,'full DTO keeps emergency allocated contract price');
  }
  equal(replans,beforeBowlingReplans,'unchanged own bowling players never replan from full DTO');
  const moreBowlers=structuredClone(bowlingFull.program);moreBowlers.items[0].participants=8;
  const bowlingChanged=await patchStaff({...bowlingFull,program:moreBowlers,laneCount:1,requiresLanes:true});
  equal(replans,beforeBowlingReplans+1,'actual own bowling players change replans');
  equal(bowlingChanged.statusCode,200,JSON.stringify(bowlingChanged.body));
  equal(bowlingChanged.body.reservation.lanes.length,2,'eight actual bowlers use two available lanes');
  const mail=require('../lib/ops-communications').buildMessage({reservation:reread,templateId:'confirmation',channel:'email'});
  contains(JSON.stringify(mail),/35 crédits/);contains(JSON.stringify(mail),/durée de jeu variable/);
  const sm=require('../lib/custom-request');
  const details=sm.normaliserDemande({groupType:'amis',participants:1000,ages:['adultes'],date:bench.JOUR,moment:'apres-midi',activities:[{id:'arcade_time',participants:1000,arcadeMode:'credit',arcadeOfferId:'credit-50',cards:1000}]},
    {today:new Date().toISOString().slice(0,10),nowHour:0,horizonDays:180,jourDe:()=>({open:true,schedule:{open:10,close:23}}),activites:catalog.listCenterActivities('libramont'),formules:[]});
  equal(details.ok,true,JSON.stringify(details));equal(details.demande.activities[0].price,50000,'SM thousand cards full quote');
  const bureau=require('../lib/demande-bureau');
  const study=await bureau.etudierDemande({centerId:'libramont',pax:1000,payload:{demande:details.demande}},{jourDe:()=>({ouvert:true,schedule:{open:10,close:23}}),disponibilite:async()=>{throw new Error('large quote must be local');}});
  equal(study.dates[0].visite.prix,50000,'large study card quote');equal(study.dates[0].visite.lignes[0].cards,1000,'study retains all cards');
  contains(bureau.etudeEnTexte(study),/75 crédits/);contains(sm.libelleActivite(details.demande.activities[0],1000),/durée de jeu variable/);
  console.log(`arcade-offers-backend-check: ${checks} assertions OK (memory DB, no network)`);
}
main().catch(error=>{console.error(error);process.exit(1);});
