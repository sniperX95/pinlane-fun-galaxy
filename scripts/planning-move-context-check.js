'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const main = fs.readFileSync('assets/app-main.js','utf8'), core = fs.readFileSync('assets/booking-core.js','utf8');
const bowling = main.slice(main.indexOf('async function scheduleBowlingSelection('), main.indexOf("document.addEventListener('keydown',event=>"));
const commit = main.slice(main.indexOf('async function commitPlanningMoveSelection('), main.indexOf('async function scheduleBowlingSelection('));
const laser = core.slice(core.indexOf('async function scheduleLaserPass('), core.indexOf('// Matérialise les vagues laser CONSERVÉES'));
let checks = 0;
async function scene(type, changed) {
  let center = 'libramont', finish, adopted = 0, rendered = 0;
  const row = { id: 21, date: '2026-10-10', startTime: '14:00', duration: 1, updatedAt: 'v1' };
  const ctx = vm.createContext({ state:{ currentDate:row.date, reservations:[row], staffAuthSession:{member:{id:1}} }, getCurrentStaffCenterId:()=>center,
    getAvailabilityLaneCount:()=>8, getBowlingDurationForReservation:()=>1, validateSlotWindow:()=>({ok:true}),
    numToTime:()=> '18:00', showPlanningMoveNotice(){}, toast(){}, renderStaffData(){rendered++;}, save(){},
    upsertReservationInState(){adopted++;}, markReservationMutation(){}, clearReservationMutation(){},
    laserUnitInfo:()=>({unitKey:'1.1'}), checkManualLaserPassPlacement:()=>({ok:true}),
    envoyerDeplacementActivite:()=>new Promise(resolve=>{finish=resolve;}),
    laserPassSaveSeq:0, laserPassLatestSeqByReservation:{},
  });
  ctx.state.laneStatuses = {};
  vm.runInContext(bowling + '\n' + laser, ctx);
  const promise = type === 'bowling' ? ctx.scheduleBowlingSelection({reservationId:21,sourceLanes:[1],targetLane:2,targetStart:18}) : ctx.scheduleLaserPass(21,'1.1',18);
  if(changed==='center') center='gembloux'; else if(changed==='date') ctx.state.currentDate='2026-10-11'; else ctx.state.staffAuthSession={member:{id:2}};
  finish({reservation:row}); await promise;
  assert.equal(adopted,0,`${type} ${changed} must not adopt old response`); checks++;
  assert.equal(rendered,0,`${type} ${changed} must not rerender old response`); checks++;
}
(async()=>{
  for(const type of ['bowling','laser']) for(const changed of ['center','date','session']) await scene(type,changed);
  const s={reservationId:1,sourceLanes:[1],targetLane:2,targetStart:18,date:'2026-10-10',centerId:'libramont',version:'v1',type:'bowling',saving:false};
  let cancelled=0, refreshed=0;
  const ctx=vm.createContext({planningMoveSelection:s,state:{currentDate:s.date,reservations:[{id:1,updatedAt:'v1'}]},getCurrentStaffCenterId:()=>s.centerId,
    renderPlanningMoveSelection(){refreshed++;},cancelPlanningMove(){cancelled++;},showPlanningMoveNotice(){},scheduleBowlingSelection:async()=>false});
  vm.runInContext(commit,ctx); await ctx.commitPlanningMoveSelection();
  assert.equal(cancelled,0,'failed move retains draft selection'); checks++;
  assert.equal(s.saving,false,'failed move re-enables controls'); checks++;
  assert.equal(refreshed,2,'failure refreshes unlocked panel'); checks++;
  console.log(`Planning context: ${checks} passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
