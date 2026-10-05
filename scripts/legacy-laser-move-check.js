'use strict';
// Real staff handler/resource validation; synthetic persistence only.
const assert = require('node:assert/strict');
const bridge = require('./activity-drag-contract-check');
const copy = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function main() {
  bridge.setOther([]);
  for (const type of ['formule', 'bowling']) for (const shape of [null, {}, {resourceBlocks:[]}, {resourceBlocks:[{activityId:'minigolf_blacklight', resourceType:'soft_capacity', startTime:'19:00',endTime:'19:30',players:2}],timeline:[{activityId:'minigolf_blacklight',resourceType:'soft_capacity',startTime:'19:00',endTime:'19:30',players:2}]}]) {
    const row = bridge.fixture();
    Object.assign(row,{type,formuleId:type==='formule'?'f1':null,startTime:'14:00',duration:1,lanes:[2],opsPlan:copy(shape),pax:4});
    row.program = type==='formule'?null:{items:[{activityId:'bowling',participants:4,duration:1},{activityId:'laser_game',participants:2,games:2}]};
    const before = copy(row);
    bridge.setStored(row);
    const result = await bridge.call({activityId:'laser_game',unitKey:'1.1',startTime:'17:00'});
    check(result.status===200,'legacy '+type+' plan '+JSON.stringify(shape)+' moves: '+JSON.stringify(result));
    const saved = result.reservation;
    for (const field of ['price','pax','lanes','startTime','duration','program','formuleId']) {assert.deepEqual(saved[field],before[field],field+' unchanged');checks++;}
    const bowling = saved.opsPlan.resourceBlocks.find(block=>block.resourceType==='bowling_lane');
    check(bowling.startTime==='14:00'&&bowling.endTime==='15:00'&&bowling.lanes[0]===2,'saved bowling anchor retained');
    check(saved.opsPlan.resourceBlocks.some(block=>block.resourceType==='laser_arena'&&block.countIndex===1&&block.startTime==='17:00'),'target part moved');
    if (type==='bowling') check(saved.opsPlan.resourceBlocks.some(block=>block.resourceType==='laser_arena'&&block.countIndex===2&&block.startTime==='16:00'&&block.players===2),'untouched second part matches visible half-hour fallback');
    if (shape?.timeline) {assert.deepEqual(saved.opsPlan.timeline.filter(block=>block.activityId!=='laser_game'),shape.timeline);checks++;}
  }
  const direct=bridge.fixture();Object.assign(direct,{type:'laser',program:null,formuleId:null,lanes:[],opsPlan:null,startTime:'15:00',duration:0.75,laserGames:2,pax:4});
  const large=copy(direct); large.pax=40; bridge.setStored(large);
  const wave=await bridge.call({activityId:'laser_game',unitKey:'1.2',startTime:'18:05'});
  check(wave.status===200,'large legacy group moves only the second wave');
  check(wave.reservation.opsPlan.resourceBlocks.find(b=>b.groupWaveIndex===1).startTime==='15:00','first wave retains its hour');
  check(wave.reservation.opsPlan.resourceBlocks.every(b=>b.players===20),'balanced wave players retained');
  const array=copy(direct); array.type='bowling'; array.lanes=[2]; array.duration=1; array.program=[{activityId:'bowling',participants:4},{activityId:'laser_game',participants:2,games:2}]; bridge.setStored(array);
  const arrayMoved=await bridge.call({activityId:'laser_game',unitKey:'1.1',startTime:'18:05'});
  check(arrayMoved.status===200,'legacy array program moves');
  check(arrayMoved.reservation.opsPlan.laserPassPlan.totalGames===2,'array program keeps two purchased games');
  check(arrayMoved.reservation.opsPlan.resourceBlocks.filter(b=>b.resourceType==='laser_arena').every(b=>b.players===2),'array program keeps Laser subgroup');
  bridge.setStored(direct);
  const pending=await bridge.call({activityId:'laser_game',unitKey:'2.1',startTime:'17:00'});
  check(pending.status===200,'legacy pending standalone second game places');
  check(pending.reservation.opsPlan.resourceBlocks.some(block=>block.countIndex===1&&block.startTime==='15:00'),'first standalone part keeps saved anchor');
  const manual=copy(direct);manual.opsPlan={laserManual:true,resourceBlocks:[],laserPassPlan:{totalGames:2}};bridge.setStored(manual);
  const manualPlaced=await bridge.call({activityId:'laser_game',unitKey:'2.1',startTime:'17:00'});
  check(manualPlaced.status===200,'explicit pending manual game places');
  check(!manualPlaced.reservation.opsPlan.resourceBlocks.some(block=>block.countIndex===1),'explicitly unplaced part never regenerated');
  const collision=copy(direct);collision.type='bowling';collision.lanes=[2];collision.duration=1;collision.program={items:[{activityId:'bowling',participants:4},{activityId:'laser_game',participants:4,games:2}]};bridge.setStored(collision);
  const rejected=await bridge.call({activityId:'laser_game',unitKey:'1.1',startTime:'15:30'});
  check(rejected.status===422,'legacy full group cannot overlap unchanged bowling');assert.deepEqual(bridge.getStored(),collision);checks++;
  const legacy=copy(direct);bridge.setStored(legacy);bridge.setOther([{...copy(direct),id:999999,pax:29,startTime:'17:00',opsPlan:{resourceBlocks:[{activityId:'laser_game',resourceType:'laser_arena',startTime:'17:00',endTime:'17:25',players:29,countIndex:1,groupWaveIndex:1}]}}]);
  const full=await bridge.call({activityId:'laser_game',unitKey:'1.1',startTime:'17:00'});check(full.status===409,'legacy fallback still honors other reservations capacity');assert.deepEqual(bridge.getStored(),legacy);checks++;
  console.log(JSON.stringify({ok:true,checks,fixtureOnly:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
