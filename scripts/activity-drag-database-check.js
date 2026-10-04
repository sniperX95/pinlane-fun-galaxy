'use strict';
// Real database.js transaction and resource guards; pg is a local in-memory double.
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const bench = require('./slot-holds-check');
const { Pool } = require('pg');
const original = Pool.prototype.connect;
let writes = 0; const queries = []; let availability = [];
Pool.prototype.query = async function (sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } };
Pool.prototype.connect = async function () {
  const client = await original.call(this); const query = client.query.bind(client);
  client.query = async (sql, values = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim(); queries.push(s);
    if (s.includes('from availability_blocks') && s.includes('scope_type')) return { rows: structuredClone(availability), rowCount: availability.length };
    if (/^select \* from reservations where id = \$1 (limit 1|for update);?$/.test(s)) {
      const row = bench.base.reservations.get(Number(values[0])); return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (/^update reservations set center_id = \$2,/.test(s)) {
      writes++;
      const [id,center_id,channel,name,phone,email,date,start_time,duration,total_duration,lanes,pax,status,base_price,price,type,formule_id,label,occasion,extras,payment_method,notes,ops_plan,risk_level,risk_score,validation_status,activity_progress,program,companions] = values;
      const row = { ...bench.base.reservations.get(Number(id)),center_id,channel,name,phone,email,date,start_time,duration,total_duration,lanes,pax,status,base_price,price,type,formule_id,label,occasion,extras:JSON.parse(extras),payment_method,notes,ops_plan:JSON.parse(ops_plan),risk_level,risk_score,validation_status,activity_progress:JSON.parse(activity_progress),program:JSON.parse(program),companions,updated_at:new Date(bench.base.horloge + 1) };
      bench.base.reservations.set(Number(id), row); return { rows: [structuredClone(row)], rowCount: 1 };
    }
    return query(sql, values);
  }; return client;
};
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const laser = (at, countIndex = 1, players = 8) => ({ activityId:'laser_game',resourceType:'laser_arena',countIndex,groupWaveIndex:1,groupWaveCount:1,players,start:at,end:at+25,startTime:`${Math.floor(at/60)}:${String(at%60).padStart(2,'0')}`,endTime:`${Math.floor((at+25)/60)}:${String((at+25)%60).padStart(2,'0')}` });
const bowling = { activityId:'bowling',resourceType:'bowling_lane',start:900,end:960,startTime:'15:00',endTime:'16:00',lanes:[1,2],players:8,requiredLanes:2 };
function fixture() { return bench.reservationLigne(777,'15:00',[1,2],{ pax:8,status:'paid',price:178.34,base_price:173.34,total_duration:3,extras:[{name:'Drink',price:5}],ops_plan:{startTime:'15:00',endTime:'16:55',totalMinutes:115,assignedLanes:[1,2],resourceBlocks:[bowling,laser(990)],timeline:[bowling,laser(990)],laserPassPlan:{totalGames:2,scheduledGames:1,remainingGames:1}},program:{items:[{activityId:'bowling',name:'Bowling',planned:true,participants:8,duration:1,price:78,priceKnown:true},{activityId:'laser_game',name:'Laser',planned:true,participants:8,games:2,price:144,priceKnown:true}],price:222,priceComplete:true} }); }
async function main() {
  const { db } = bench.charger();
  const move = async activityMove => { const current = await db.getReservationById(777); return db.updateReservation({id:777,centerId:'libramont',baseUpdatedAt:new Date(current.updatedAt).toISOString(),activityMove}); };
  bench.semer([fixture()]); const before = await db.getReservationById(777);
  const saved = await move({activityId:'bowling',startTime:'17:30',lanes:[3,4]});
  equal(saved.opsPlan.resourceBlocks.filter(b=>b.resourceType==='laser_arena'),before.opsPlan.resourceBlocks.filter(b=>b.resourceType==='laser_arena'),'DB keeps Laser exactly');
  for (const field of ['date','startTime','duration','totalDuration','price','basePrice','program','extras','pax','type','formuleId','label','riskLevel','riskScore','validationStatus','status','companions','activityProgress','notes','occasion','name','phone','email','channel']) equal(saved[field],before[field],`DB preserves ${field}`);
  equal(saved.opsPlan.resourceBlocks[0].startTime,'17:30','DB persists only bowling move');
  const lock = queries.findIndex(s=>s.includes('pg_advisory_xact_lock')); const rowLock = queries.findIndex(s=>s.includes('for update')); const holds = queries.findIndex(s=>s.includes('select id, payload, expires_at from slot_holds'));
  equal(lock < rowLock && rowLock < holds,true,'date then row lock then holds fresh read');
  equal(queries.some(s=>s==='COMMIT'),true,'real transaction commits');
  async function denied(activityMove, pattern) { const count=writes;const original=structuredClone(bench.base.reservations.get(777));await assert.rejects(move(activityMove),pattern);checks++;equal(writes,count,'rejected move has no SQL update');equal(bench.base.reservations.get(777),original,'rejected move preserves row');equal(queries.at(-1),'ROLLBACK','real transaction rolls back'); }
  bench.semer([fixture(),bench.reservationLigne(778,'17:30',[3,4])]);
  await denied({activityId:'bowling',startTime:'17:30',lanes:[3,4]},/piste|créneau|libre/i);
  bench.semer([fixture()]);
  const retained=await bench.retenir({reservations:require('../api/public-reservations')},bench.BOWLING('17:30'));
  equal(retained.statut,201,'real public hold created in fixture only');
  await denied({activityId:'bowling',startTime:'17:30',lanes:[1,2]},/piste|créneau|libre/i);
  bench.semer([fixture(),bench.reservationLigne(779,'18:00',[],{type:'laser',pax:29,duration:0.5})]);
  await denied({activityId:'laser_game',unitKey:'1.1',startTime:'18:00'},/Laser Game complet/);
  bench.semer([fixture()]);
  availability=[{id:10,center_id:'libramont',scope_type:'lane',scope_ref:'3',recurrence:'once',date:bench.JOUR,start_time:'17:00',end_time:'19:00'}];
  await denied({activityId:'bowling',startTime:'17:30',lanes:[3,4]},/piste|créneau|indisponible|bloqu/i);availability=[];
  bench.semer([fixture()]);
  await assert.rejects(db.updateReservation({id:777,centerId:'gembloux',baseUpdatedAt:new Date(bench.base.reservations.get(777).updated_at).toISOString(),activityMove:{activityId:'bowling',startTime:'17:30',lanes:[1,2]}}),error=>error.statusCode===409);checks++;
  bench.semer([fixture()]);
  const outdated=new Date((await db.getReservationById(777)).updatedAt).toISOString();
  bench.base.avantVerrou=()=>{ const row=bench.base.reservations.get(777);row.updated_at=new Date(new Date(row.updated_at).getTime()+1000);row.notes='Another operator'; };
  const count=writes;await assert.rejects(db.updateReservation({id:777,centerId:'libramont',baseUpdatedAt:outdated,activityMove:{activityId:'bowling',startTime:'18:00',lanes:[1,2]}}),error=>error.statusCode===409);checks++;equal(writes,count,'concurrent version rejects before write');equal(bench.base.reservations.get(777).notes,'Another operator','concurrent note survives');
  bench.semer([fixture()]);
  const removed=await move({activityId:'laser_game',unitKey:'1.1',unplace:true});
  equal(removed.opsPlan.resourceBlocks.filter(b=>b.resourceType==='laser_arena'),[],'last laser removed persistently');
  equal(removed.opsPlan.laserManual,true,'manual flag prevents DB fallback phantom laser');
  const repl=await move({activityId:'laser_game',unitKey:'2.1',startTime:'18:00'});
  equal(repl.opsPlan.resourceBlocks.filter(b=>b.resourceType==='laser_arena').map(b=>b.countIndex),[2],'pending second game requeues without inventing first');
  bench.base.reservations.set(779,bench.reservationLigne(779,'19:00',[],{type:'laser',pax:29,duration:0.5}));
  const manualCount=writes;const other=await db.getReservationById(779);
  await assert.rejects(db.updateReservation({id:779,centerId:'libramont',baseUpdatedAt:new Date(other.updatedAt).toISOString(),activityMove:{activityId:'laser_game',unitKey:'1.1',startTime:'18:00'}}),/Laser Game complet/);checks++;equal(writes,manualCount,'persisted manual laser blocks next other reservation');
  const services=fixture();services.pax=18;services.lanes=[1,2,3];services.program.items[0].participants=18;services.program.items[1].participants=18;
  const s1={...bowling,players:12,groupWaveCount:2,groupWaveIndex:1};const s2={...bowling,players:6,requiredLanes:1,lanes:[3],groupWaveCount:2,groupWaveIndex:2,start:960,end:1020,startTime:'16:00',endTime:'17:00'};const otherLaser=laser(1110,1,18);
  services.ops_plan.resourceBlocks=[s1,s2,otherLaser];services.ops_plan.timeline=[s1,s2,otherLaser];services.ops_plan.assignedLanes=[1,2,3];bench.semer([services]);
  const multiservice=await move({activityId:'bowling',startTime:'14:00',lanes:[4,5,6]});
  equal(multiservice.opsPlan.resourceBlocks.filter(b=>b.resourceType==='bowling_lane').map(b=>[b.startTime,b.endTime,b.lanes,b.players]),[['14:00','15:00',[4,5],12],['15:00','16:00',[6],6]],'multiservice exact offsets and lane mapping persist through DB guards');
  equal(multiservice.opsPlan.resourceBlocks.find(b=>b.resourceType==='laser_arena'),otherLaser,'multiservice keeps later laser strict');
  const bowlingBefore=structuredClone(multiservice.opsPlan.resourceBlocks.filter(b=>b.resourceType==='bowling_lane'));
  const laserMoved=await move({activityId:'laser_game',unitKey:'1.1',startTime:'20:00'});
  equal(laserMoved.opsPlan.resourceBlocks.filter(b=>b.resourceType==='bowling_lane'),bowlingBefore,'laser move preserves multiservice lane mapping through DB');
  // API + real DB assembled: only auth / outbound communications are doubles.
  const authPath=require.resolve('../lib/staff-auth');const auth=require(authPath);
  require.cache[authPath].exports={...auth,getStaffSessionFromRequest:async()=>({centerId:'libramont',member:{id:1}}),requireStaffPermission:async()=>({centerId:'libramont',member:{id:1}})};
  const handler=require('../api/staff-reservations');
  async function patch(activityMove) { const row=await db.getReservationById(777);const req=Readable.from([Buffer.from(JSON.stringify({id:777,centerId:'libramont',baseUpdatedAt:new Date(row.updatedAt).toISOString(),activityMove}))]);req.method='PATCH';req.url='/api/staff-reservations';req.headers={'content-type':'application/json'};const res={statusCode:200,setHeader(){},end(value){this.body=JSON.parse(value);}};await handler(req,res);return res; }
  bench.semer([fixture()]);
  const assembled=await patch({activityId:'bowling',startTime:'18:00',lanes:[4,5]});
  equal(assembled.statusCode,200,'real PATCH plus real transaction succeeds');
  equal(assembled.body.reservation.opsPlan.resourceBlocks.find(b=>b.resourceType==='laser_arena').startTime,'16:30','assembled API/DB preserves Laser');
  equal(assembled.body.activityMove.unchangedActivities,true,'assembled API confirms explicit receipt');
  equal((await db.getReservationById(777)).opsPlan.resourceBlocks.find(b=>b.resourceType==='bowling_lane').startTime,'18:00','assembled write persists on fresh DB reload');
  const assembledWrites=writes;const blocked=await patch({activityId:'bowling',startTime:'16:30',lanes:[4,5]});
  equal(blocked.statusCode,422,'assembled same-group overlap refused');equal(writes,assembledWrites,'assembled refusal has no write');
  const knowledge=require('../lib/ops-knowledge');const center=knowledge.getCenter('libramont');const schedule=center.defaultSchedule;const day=new Date(`${bench.JOUR}T12:00:00Z`).getUTCDay();
  center.defaultSchedule={regular:{[day]:{open:'14:00',close:'26:00'}},holiday:{[day]:{open:'14:00',close:'26:00'}}};
  try {
    bench.semer([fixture()]);const overnight=await move({activityId:'bowling',startTime:'24:30',lanes:[3,4]});
    equal(overnight.opsPlan.resourceBlocks.find(b=>b.resourceType==='bowling_lane').startTime,'24:30','after-midnight move stays on service date');
    equal(overnight.opsPlan.resourceBlocks.find(b=>b.resourceType==='bowling_lane').endTime,'25:30','after-midnight end is unambiguous');
    await denied({activityId:'bowling',startTime:'25:30',lanes:[3,4]},/ouverture/);
  } finally {center.defaultSchedule=schedule;}
  const ops=require('../lib/reservation-ops');const built=await ops.prepareReservationOps({id:777,centerId:'libramont',name:'QA',phone:'0470000000',date:bench.JOUR,startTime:'15:00',pax:8,type:'formule',formuleId:'f1',duration:1,lanes:[1,2],laneCount:2,channel:'staff',allowPastStart:true},'staff',{readState:async()=>({reservations:[],laneStatuses:{}})});
  assert.ok(built.opsPlan?.resourceBlocks?.some(b=>b.resourceType==='bowling_lane'),'real engine formula fixture');checks++;
  const formula=fixture();formula.type='formule';formula.formule_id='f1';formula.ops_plan=built.opsPlan;formula.program=null;bench.semer([formula]);
  const formulaBefore=await db.getReservationById(777);const formulaMoved=await move({activityId:'bowling',startTime:'20:00',lanes:[3,4]});
  equal(formulaMoved.opsPlan.resourceBlocks.filter(b=>b.resourceType!=='bowling_lane'),formulaBefore.opsPlan.resourceBlocks.filter(b=>b.resourceType!=='bowling_lane'),'actual planning-engine formula keeps all other resource blocks');
  equal(formulaMoved.opsPlan.timeline.filter(b=>b.activityId!=='bowling'),formulaBefore.opsPlan.timeline.filter(b=>b.activityId!=='bowling'),'actual planning-engine formula keeps unrelated timeline');
  const legacyService=fixture();legacyService.lanes=[4,6];legacyService.pax=4;legacyService.program.items[0].participants=4;legacyService.program.items[1].participants=4;
  const l1={activityId:'bowling',resourceType:'bowling_lane',startTime:'14:00',endTime:'15:00',players:4,lanes:[4]};const l2={...l1,startTime:'15:00',endTime:'16:00',lanes:[6]};const keptLaser=laser(1110,1,4);legacyService.ops_plan.resourceBlocks=[l1,l2,keptLaser];legacyService.ops_plan.timeline=[l1,l2,keptLaser];bench.semer([legacyService]);
  const reversed=await move({activityId:'bowling',startTime:'14:00',lanes:[1,4],laneMapping:{4:4,6:1}});
  equal(reversed.opsPlan.resourceBlocks.filter(b=>b.resourceType==='bowling_lane').map(b=>[b.startTime,b.lanes]),[['14:00',[4]],['15:00',[1]]],'legacy multiservice missing metadata gets exact explicit lane mapping');
  console.log(JSON.stringify({ok:true,checks,writes,realDatabaseTransaction:true,fixtureOnly:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
