'use strict';
// Independent API contract: real handler/helper, isolated synthetic persistence.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),clone=v=>JSON.parse(JSON.stringify(v));
let stored,other=[],writes=0,replans=0,checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
const replace=(file,exports)=>{const id=require.resolve(path.join(root,file));require.cache[id]={id,filename:id,loaded:true,exports};};
const version='2026-10-05T08:00:00.000Z';
const realValidate=require(path.join(root,'lib/database.js')).validateReservationResources;
const conflict=current=>Object.assign(new Error('Reservation modified'),{statusCode:409,currentReservation:clone(current)});
const db={validateReservationResources:realValidate,getPool:()=>null,getReservationById:async()=>clone(stored),readStaffState:async()=>({reservations:[clone(stored),...clone(other)],laneStatuses:{},blocks:[]}),lireVersionAttendue:v=>v??null,memeVersion:(a,b)=>a===b,reservationModifieeEntreTemps:conflict,
 updateReservation:async patch=>{if(patch.baseUpdatedAt&&patch.baseUpdatedAt!==stored.updatedAt)throw conflict(stored);const candidate=patch.activityMove?require(path.join(root,'lib/reservation-activity-move')).buildActivityMove(stored,patch.activityMove):{...stored,...clone(patch)};writes++;stored={...candidate,updatedAt:'2026-10-05T08:01:00.000Z'};delete stored.activityMove;return clone(stored);},createOpsEvent:async()=>{},cancelReservationCommunications:async()=>[],cancelReservationOpsJobs:async()=>[]};
replace('lib/database.js',db);
const session={centerId:'libramont',authorizedCenterId:'libramont',member:{id:'qa',name:'QA'},role:{locked:true},permissions:['reservations.edit']};
replace('lib/staff-auth.js',{getStaffSessionFromRequest:async()=>session,requireStaffPermission:async()=>session});
replace('lib/reservation-ops.js',{prepareReservationOps:async()=>{replans++;return{};}});
replace('lib/ops-communications.js',{enqueueReservationCommunications:async()=>[]});replace('lib/ops-jobs.js',{enqueueReservationAutomation:async()=>[]});
replace('lib/audit-log.js',{writeAuditLog:async()=>({}),actorFromSession:()=>({}),buildChanges:()=>({}),newRequestId:()=> 'qa'});
// Keep real knowledge readers for helper catalogue/capacity, suppress DB warmups.
for(const [file,key]of[['lib/ops-knowledge.js','refreshCenterOverrides'],['lib/booking-config.js','refreshFormuleOverrides'],['lib/catalog-store.js','refreshCatalog']]){const original=require(path.join(root,file));replace(file,{...original,[key]:async()=>{}});}
const handler=require(path.join(root,'api/staff-reservations.js'));
async function call(activityMove,extras={}){const req=Readable.from([JSON.stringify({id:stored.id,centerId:stored.centerId,baseUpdatedAt:stored.updatedAt,activityMove,...extras})]);Object.assign(req,{method:'PATCH',url:'/api/staff-reservations',headers:{host:'localhost','content-type':'application/json'}});const res={statusCode:200,setHeader(){},end(b){this.body=JSON.parse(b);}};await handler(req,res);return{status:res.statusCode,...res.body};}
function fixture(type='visit'){
 const block=(activityId,startTime,endTime,countIndex=1,players=4,extra={})=>({activityId,resourceType:activityId==='bowling'?'bowling_lane':activityId==='laser_game'?'laser_arena':'soft_capacity',startTime,endTime,countIndex,groupWaveIndex:1,players,...extra});
 const blocks=[block('bowling','15:00','16:00',1,4,{lanes:[1]}),block('laser_game','16:15','16:40'),block('laser_game','16:45','17:10',2),block('laser_game','17:15','17:40',3,2),block('minigolf_blacklight','18:00','18:45',1,2)];
 return{id:99001,name:'QA Groupe',clientName:'QA Groupe',phone:'+32470000000',email:'qa@example.test',centerId:'libramont',date:'2026-10-10',startTime:'15:00',duration:1,totalDuration:3.75,type,formuleId:type==='formule'?'f1':'',status:'pending',pax:4,lanes:[1],price:147.60,basePrice:147.60,updatedAt:version,program:{items:[{activityId:'bowling',participants:4,duration:1,price:39},{activityId:'laser_game',participants:4,games:2,extraLaser:{offerId:'extra',participants:2,games:3,baseGames:2,price:12.6},price:84.6},{activityId:'minigolf_blacklight',participants:2,price:24}]},opsPlan:{timeline:blocks.map(b=>({...b,type:'activity'})),resourceBlocks:blocks,laserGames:3}};
}
function unchanged(before,after,id){for(const key of['timeline','resourceBlocks'])assert.deepEqual(after.opsPlan[key].filter(b=>b.activityId!==id),before.opsPlan[key].filter(b=>b.activityId!==id),key+' unrelated activities');for(const key of['price','basePrice','program','pax','date'])assert.deepEqual(after[key],before[key],key+' preserved');checks+=7;}
function projectFresh(reservation){const c=vm.createContext({console,state:{booking:{},reservations:[clone(reservation)]},document:{getElementById:()=>null}});vm.runInContext(fs.readFileSync(path.join(root,'assets/booking-core.js'),'utf8'),c);c.row=clone(reservation);return JSON.parse(JSON.stringify(vm.runInContext('({bowling:getBowlingWindowsFromReservation(row),laser:getLaserWindowsFromReservation(row)})',c)));}
async function main(){
 for(const type of['visit','formule','custom_request']){
  stored=fixture(type);other=[];writes=0;const before=clone(stored),r=await call({activityId:'bowling',startTime:'14:00',lanes:[2]});
  check(r.status===200,'Bowling API accepts independent move '+type+' '+JSON.stringify(r));check(r.activityMove?.unchangedActivities===true,'response confirms activity scope');unchanged(before,r.reservation,'bowling');
  const fresh=await db.getReservationById(stored.id);check(fresh.opsPlan.resourceBlocks.find(b=>b.activityId==='bowling').startTime==='14:00','fresh persisted bowling moved');
  const freshProjection=projectFresh(fresh);check(freshProjection.bowling[0].startTime==='14:00','real booking core reload renders moved bowling');const slot=b=>({startTime:b.startTime,endTime:b.endTime,countIndex:b.countIndex,players:b.players,unitKey:b.unitKey});assert.deepEqual(freshProjection.laser.map(slot),projectFresh(before).laser.map(slot));checks++;
  stored=fixture(type);const laserBefore=clone(stored),l=await call({activityId:'laser_game',unitKey:'3.1',startTime:'19:00'});
  check(l.status===200,'extra laser API accepts subgroup move '+type+' '+JSON.stringify(l));unchanged(laserBefore,l.reservation,'laser_game');
  for(const key of['timeline','resourceBlocks'])assert.deepEqual(l.reservation.opsPlan[key].filter(b=>b.activityId==='laser_game'&&b.countIndex!==3),laserBefore.opsPlan[key].filter(b=>b.activityId==='laser_game'&&b.countIndex!==3));checks+=2;
  const extra=l.reservation.opsPlan.resourceBlocks.find(b=>b.activityId==='laser_game'&&b.countIndex===3);check(extra.startTime==='19:00'&&extra.players===2,'extra pass keeps two participants');
  const freshLaser=projectFresh(await db.getReservationById(stored.id));check(freshLaser.laser.some(b=>b.countIndex===3&&b.startTime==='19:00'&&b.players===2),'real booking core reload retains extra subgroup slot');
 }
 stored=fixture();const before=clone(stored),stale=await call({activityId:'bowling',startTime:'14:00',lanes:[2]},{baseUpdatedAt:'stale'});check(stale.status===409,'stale version rejected409');assert.deepEqual(stored,before);checks++;
 stored=fixture();const prior=clone(stored),selfOverlap=await call({activityId:'bowling',startTime:'16:30',lanes:[2]});check(selfOverlap.status===409||selfOverlap.status===422,'own other activity overlap rejected');assert.deepEqual(stored,prior);checks++;
 stored=fixture();const unplaceBefore=clone(stored),unplaced=await call({activityId:'laser_game',unitKey:'3.1',unplace:true});check(unplaced.status===200,'extra subgroup can be unplaced');unchanged(unplaceBefore,unplaced.reservation,'laser_game');
 check(!projectFresh(await db.getReservationById(stored.id)).laser.some(b=>b.countIndex===3),'reload does not resurrect removed extra pass');
 const rePlaced=await call({activityId:'laser_game',unitKey:'3.1',startTime:'19:30'});check(rePlaced.status===200,'unplaced extra can be placed again '+JSON.stringify(rePlaced));check(projectFresh(await db.getReservationById(stored.id)).laser.some(b=>b.countIndex===3&&b.players===2&&b.startTime==='19:30'),'requeued extra retains subgroup two');
 check(rePlaced.reservation.opsPlan.timeline.some(b=>b.activityId==='laser_game'&&b.countIndex===3&&b.startTime==='19:30'&&b.players===2),'placing pending extra restores client/email timeline');
 stored=fixture();stored.pax=50;stored.program.items.find(i=>i.activityId==='laser_game').participants=50;
 for(const key of['timeline','resourceBlocks']){stored.opsPlan[key]=stored.opsPlan[key].filter(b=>b.activityId!=='laser_game'||b.countIndex!==1);for(const wave of[1,2])stored.opsPlan[key].push({activityId:'laser_game',resourceType:'laser_arena',type:'activity',startTime:wave===1?'20:00':'20:30',endTime:wave===1?'20:25':'20:55',countIndex:1,groupWaveIndex:wave,groupWaveCount:2,players:25,groupPlayers:50});}
 const waveBefore=clone(stored),waveMove=await call({activityId:'laser_game',unitKey:'1.2',startTime:'19:30'});check(waveMove.status===200,'one wave of large group moves independently');
 for(const key of['timeline','resourceBlocks'])assert.deepEqual(waveMove.reservation.opsPlan[key].filter(b=>b.activityId!=='laser_game'||b.countIndex!==1||b.groupWaveIndex!==2),waveBefore.opsPlan[key].filter(b=>b.activityId!=='laser_game'||b.countIndex!==1||b.groupWaveIndex!==2));checks+=2;
 check(projectFresh(await db.getReservationById(stored.id)).laser.some(b=>b.countIndex===1&&b.groupWaveIndex===2&&b.players===25&&b.startTime==='19:30'),'fresh projection retains own moved wave identity');
 const removedWave=await call({activityId:'laser_game',unitKey:'1.2',unplace:true});check(removedWave.status===200,'one wave can be unplaced without dropping siblings');
 const c=vm.createContext({console,state:{booking:{},reservations:[]},document:{getElementById:()=>null}});vm.runInContext(fs.readFileSync(path.join(root,'assets/booking-core.js'),'utf8'),c);const source=fs.readFileSync(path.join(root,'assets/app-main.js'),'utf8'),offset=source.indexOf('function getLaserGameCountForReservation('),end=source.indexOf('\nfunction ',offset+1);vm.runInContext(source.slice(offset,end),c);c.row=clone(removedWave.reservation);
 const pending=JSON.parse(JSON.stringify(vm.runInContext('getPendingLaserPassesForReservation(row)',c)));check(pending.some(p=>p.unitKey==='1.2'&&p.players===25),'fresh UI pass plan exposes missing wave with own25participants');
 check(removedWave.reservation.opsPlan.laserPassPlan.remainingGames>=1,'stored pass plan does not claim fully scheduled game when wave remains');
 stored=fixture();stored.opsPlan.timeline.push({type:'activity',activityId:'arcade_time',resourceType:'free',startTime:'20:00',endTime:'21:30',players:2});
 const lateFreeBefore=clone(stored),lateFreeMoved=await call({activityId:'bowling',startTime:'14:00',lanes:[2]});check(lateFreeMoved.status===200,'bowling moves with late free activity');unchanged(lateFreeBefore,lateFreeMoved.reservation,'bowling');check(lateFreeMoved.reservation.opsPlan.endTime==='21:30','visit end includes later timeline-only free activity');
 stored=fixture();other=[{...fixture(),id:99002,startTime:'14:00',lanes:[2],type:'bowling',opsPlan:{resourceBlocks:[{resourceType:'bowling_lane',activityId:'bowling',startTime:'14:00',endTime:'15:00',lanes:[2],players:4}]}}];
 const occupiedBefore=clone(stored),occupied=await call({activityId:'bowling',startTime:'14:00',lanes:[2]});check(occupied.status===409,'real capacity validation rejects occupied bowling409 '+JSON.stringify(occupied));assert.deepEqual(stored,occupiedBefore);checks++;
 stored=fixture();other=[{...fixture(),id:99003,type:'laser',pax:29,lanes:[],startTime:'19:00',opsPlan:{resourceBlocks:[{resourceType:'laser_arena',activityId:'laser_game',startTime:'19:00',endTime:'19:25',players:29,countIndex:1,groupWaveIndex:1}]}}];
 const fullBefore=clone(stored),full=await call({activityId:'laser_game',unitKey:'3.1',startTime:'19:00'});check(full.status===409,'real capacity validation rejects laser29+2 above30 '+JSON.stringify(full));assert.deepEqual(stored,fullBefore);checks++;
 stored=fixture();other=[];const tamperBefore=clone(stored),tamper=await call({activityId:'bowling',startTime:'14:00',lanes:[2]},{price:1});check(tamper.status===422||tamper.status===400,'move with financial override rejected');assert.deepEqual(stored,tamperBefore);checks++;
 check(replans===0,'activity gesture never replans whole visit');
 console.log(JSON.stringify({ok:true,checks,writes,replans,fixtureOnly:true}));
}
module.exports={handler,fixture,call,db,setStored:value=>{stored=clone(value);},getStored:()=>clone(stored),setOther:value=>{other=clone(value);}};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
