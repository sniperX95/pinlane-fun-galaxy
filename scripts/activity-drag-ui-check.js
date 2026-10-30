'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.PINLANE_CAPACITY_PORT=process.env.PINLANE_ACTIVITY_UI_PORT||'4752';
const {serveStatic,installMock}=require('./planning-capacity-ui-check');
const api=require('./activity-drag-contract-check');
const {chromium}=require('playwright-core');
const out=path.resolve(__dirname,'../tests/artifacts/activity-drag');fs.mkdirSync(out,{recursive:true});
const copy=v=>JSON.parse(JSON.stringify(v));let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;console.log('OK '+m);};
function preserved(before,after,activity,unit){
  for(const key of ['startTime','date','duration','totalDuration','pax','price','basePrice','program','status']){assert.deepEqual(after[key],before[key],key+' stays unchanged');checks++;}
  for(const key of ['timeline','resourceBlocks']){
    const outside=b=>activity==='bowling'?b.activityId!=='bowling':b.activityId!=='laser_game'||`${b.countIndex||1}.${b.groupWaveIndex||1}`!==unit;
    assert.deepEqual(after.opsPlan[key].filter(outside),before.opsPlan[key].filter(outside),key+' outside target stays unchanged');checks++;
  }
}
(async()=>{const server=await serveStatic();const browser=await chromium.launch({executablePath:process.env.E2E_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});const requests=[],errors=[];try{
  for(const type of ['visit','formule','custom_request']){
    const touch=type==='custom_request';api.setStored(api.fixture(type));api.setOther([]);
    const context=await browser.newContext({viewport:{width:1440,height:1100},hasTouch:touch});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('__qaReadReservation',()=>api.getStored());
    let release,paused=false;
    await page.exposeFunction('__qaPatchActivity',async body=>{requests.push(copy(body));if(paused)await new Promise(resolve=>{release=resolve;});return body.activityMove ? api.call(body.activityMove,{id:body.id,centerId:body.centerId,baseUpdatedAt:body.baseUpdatedAt}) : api.call(undefined,body);});
    await installMock(page);
    await page.addInitScript(()=>{const previous=window.fetch;window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.origin),method=init.method||'GET';
      if(u.pathname==='/api/staff-state'){const r=await window.__qaReadReservation();return new Response(JSON.stringify({ok:true,revision:r.updatedAt,reservations:[r],laneStatuses:{},centerId:r.centerId}),{headers:{'content-type':'application/json'}});}
      if(u.pathname==='/api/staff-reservations'&&method==='PATCH'){const result=await window.__qaPatchActivity(JSON.parse(init.body));return new Response(JSON.stringify(result),{status:result.status,headers:{'content-type':'application/json'}});}
      if(!['GET','HEAD'].includes(method))return new Response('{}',{status:503});return previous(input,init);};});
    await page.goto('http://127.0.0.1:'+process.env.PINLANE_CAPACITY_PORT+'/',{waitUntil:'networkidle'});
    await page.evaluate(async()=>{await ensureStaffConsolesLoaded();const r=await window.__qaReadReservation();state.currentDate=r.date;state.reservations=[r];state.adminCenterId=r.centerId;state.staffMenuPage='planning';state.staffResourceView='bowling';setView('staff');await loadStaffCenterConfig(true);renderStaff();});
    const before=api.getStored();await page.screenshot({path:path.join(out,type+'-before.png')});
    const source=page.locator('.booking[data-booking-res-id="99001"]').first(),target=page.locator('.slot-cell[data-bowling-drop-lane="2"][data-bowling-drop-start="14"]').first();
    await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();check(Boolean(a&&b),'real bowling drag targets exist '+type);
    const p={x:a.x+a.width/2,y:a.y+a.height/2},q={x:b.x+b.width/2,y:b.y+b.height/2};
    if(touch){const cdp=await context.newCDPSession(page);const event=(kind,points)=>cdp.send('Input.dispatchTouchEvent',{type:kind,touchPoints:points});await event('touchStart',[{...p,id:1}]);await page.waitForTimeout(450);for(let i=1;i<=10;i++){await event('touchMove',[{x:p.x+(q.x-p.x)*i/10,y:p.y+(q.y-p.y)*i/10,id:1}]);await page.waitForTimeout(20);}await event('touchEnd',[]);}
    else{await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+8,p.y+8,{steps:2});await page.mouse.move(q.x,q.y,{steps:10});await page.mouse.up();}
    await page.waitForFunction(()=>state.reservations.find(r=>r.id===99001)?.opsPlan?.resourceBlocks.find(b=>b.activityId==='bowling')?.startTime==='14:00');
    preserved(before,api.getStored(),'bowling');check(api.getStored().lanes[0]===2,'real handler persists selected bowling lane '+type);
    const read=await page.evaluate(()=>window.__qaReadReservation());assert.deepEqual(read,api.getStored());checks++;
    await page.screenshot({path:path.join(out,type+'-bowling-after.png')});
    let prior=api.getStored();await page.evaluate(async()=>{state.staffResourceView='laser';renderStaff();await scheduleLaserPass(99001,'3.1',19);});
    preserved(prior,api.getStored(),'laser_game','3.1');check(api.getStored().opsPlan.resourceBlocks.find(b=>b.activityId==='laser_game'&&b.countIndex===3).startTime==='19:00','laser extra subgroup saved at actual requested hour '+type);
    await page.evaluate(async()=>{await unscheduleLaserPass(99001,'3.1');});check(!api.getStored().opsPlan.resourceBlocks.some(b=>b.activityId==='laser_game'&&b.countIndex===3),'extra subgroup unplaced durably '+type);
    await page.evaluate(async()=>{await scheduleLaserPass(99001,'3.1',19.5);});check(api.getStored().opsPlan.resourceBlocks.find(b=>b.countIndex===3)?.players===2,'replaced extra subgroup keeps two participants '+type);
    const conflictBefore=api.getStored();await page.evaluate(async()=>{state.staffResourceView='bowling';renderStaff();await scheduleBowlingDrag(99001,2,16.5,2,14);});assert.deepEqual(api.getStored(),conflictBefore);checks++;
    check(/laser|chevauch|inchang/i.test(await page.locator('#planningMoveNotice').textContent()),'conflicting own laser is explained without moving anything '+type);
    await page.screenshot({path:path.join(out,type+'-conflict.png')});
    if(type==='visit'){
      paused=true;
      const priorDelayed=api.getStored();
      await page.evaluate(()=>{window.__pendingMove=scheduleBowlingDrag(99001,2,13,2,14);});
      for(let i=0;i<100&&!release;i++)await page.waitForTimeout(10);
      check(Boolean(release),'pending request reached real server bridge');
      const pending=await page.evaluate(()=>state.reservations.find(r=>r.id===99001));
      assert.deepEqual(pending.opsPlan,priorDelayed.opsPlan);checks++;
      check(api.getStored().opsPlan.resourceBlocks.find(b=>b.activityId==='bowling').startTime==='14:00','no optimistic movement or persistence before response');
      paused=false;release();await page.evaluate(()=>window.__pendingMove);
      check(api.getStored().opsPlan.resourceBlocks.find(b=>b.activityId==='bowling').startTime==='13:00','response confirms final bowling location');
      const concurrent={...api.getStored(),updatedAt:'2026-10-05T08:05:00.000Z',notes:'Note ajoutée sur un autre poste'};api.setStored(concurrent);
      await page.evaluate(async()=>{await scheduleBowlingDrag(99001,2,14,2,13);});
      assert.deepEqual(api.getStored(),concurrent);checks++;
      check((await page.evaluate(()=>state.reservations.find(r=>r.id===99001).notes))===concurrent.notes,'stale409 displays fresh colleague version');
      check(/autre poste|changé/.test(await page.locator('#planningMoveNotice').textContent()),'stale409 asks operator to review without replaying silently');
      const multi=api.fixture('visit');multi.lanes=[4,6];
      for(const key of ['resourceBlocks','timeline']){
        multi.opsPlan[key]=multi.opsPlan[key].filter(block=>block.activityId!=='bowling');
        multi.opsPlan[key].unshift({activityId:'bowling',resourceType:'bowling_lane',type:'activity',startTime:'13:00',endTime:'14:00',players:4,lanes:[4]}, {activityId:'bowling',resourceType:'bowling_lane',type:'activity',startTime:'14:00',endTime:'15:00',players:4,lanes:[6]});
      }
      api.setStored(multi);
      await page.evaluate(async()=>{state.reservations=[await window.__qaReadReservation()];renderStaff();await scheduleBowlingDrag(99001,1,14,6,14,true);});
      preserved(multi,api.getStored(),'bowling');
      const services=api.getStored().opsPlan.resourceBlocks.filter(b=>b.activityId==='bowling');
      console.log('QA split services',JSON.stringify(services),'request',JSON.stringify(requests.at(-1)),'notice',await page.locator('#planningMoveNotice').textContent());
      check(services.some(b=>b.startTime==='13:00'&&b.lanes[0]===4)&&services.some(b=>b.startTime==='14:00'&&b.lanes[0]===1),'split lane reverses lane order without swapping service assignments');
    }
    if(type==='formule'){
      const n=requests.length;let confirmation='';page.once('dialog',async dialog=>{confirmation=dialog.message();await dialog.dismiss();});
      await page.evaluate(async()=>{editRes(99001);state.activeTab='modifier';state.editState=etatEditionDepuis(state.selectedRes);state.editState.startTime='13:00';await saveEdit({preventDefault(){}});});
      check(/tout le dossier/.test(confirmation)&&/bowling|Bowling/.test(confirmation)&&/laser|Laser/.test(confirmation)&&/→/.test(confirmation),'global time edit confirms affected activities and before-after hours');
      check(requests.length===n,'dismissed global move sends no PATCH');
      page.once('dialog',async dialog=>{await dialog.accept();});
      await page.evaluate(async()=>{await saveEdit({preventDefault(){}});});
      check(requests.length===n+1&&!requests.at(-1).activityMove,'accepted global move uses existing explicit whole-dossier path');
      check(api.getStored().startTime==='13:00','accepted global arrival change is really saved');
      check(api.getStored().price===requests.at(-1).price,'saved global price matches the amount displayed and submitted');
    }
    await context.close();
  }
  check(requests.length>=15,'real UI actions reached local production handler');check(requests.filter(r=>r.activityMove).every(r=>Object.keys(r).every(k=>['id','centerId','baseUpdatedAt','activityMove'].includes(k))),'every drag request omits client plan prices and global edit fields');check(errors.length===0,'no browser JavaScript errors');
  fs.writeFileSync(path.join(out,'ui-proof.json'),JSON.stringify({checks,requests,errors,remoteWrites:0},null,2));console.log(JSON.stringify({ok:true,checks,artifacts:out}));
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e.stack);process.exit(1);});
