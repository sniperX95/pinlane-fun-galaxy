'use strict';
// Staff browser contract with synthetic persisted reservations, never remote writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.PINLANE_CAPACITY_PORT=process.env.PINLANE_TABLET_QA_PORT||'4792';
const {serveStatic,installMock}=require('./planning-capacity-ui-check'),{chromium}=require('playwright-core');
const out=path.resolve(__dirname,'../tests/artifacts/planning-tablet-controls');fs.mkdirSync(out,{recursive:true});
let checks=0;const failures=[],errors=[],requests=[],records=[];const check=(v,m)=>{checks++;if(!v)failures.push(m);console.log((v?'OK ':'FAIL ')+m);};
let stored,mode='ok',release;const clone=v=>JSON.parse(JSON.stringify(v));
const fixture=()=>({id:99001,name:'QA Groupe',phone:'+32470000000',email:'qa@example.test',centerId:'libramont',date:'2026-10-10',startTime:'15:00',duration:1,totalDuration:2,type:'bowling',status:'confirmed',pax:4,lanes:[1],price:39,basePrice:39,updatedAt:'2026-10-04T08:00:00Z',opsPlan:null,program:null});
async function setup(page,theme){await page.evaluate(async theme=>{await ensureStaffConsolesLoaded();const r=await window.__qaRead();setView('staff');while(staffCenterConfigCache.loading)await new Promise(r=>setTimeout(r,25));await loadStaffCenterConfig(true);state.currentDate=r.date;state.reservations=[r];state.adminCenterId=r.centerId;state.staffMenuPage='planning';state.staffResourceView='all';state.staffTheme=theme;state.searchTerm='';state.staffStatusFilter='all';renderStaff();renderTable();},theme);}
(async()=>{const server=await serveStatic(),browser=await chromium.launch({executablePath:process.env.E2E_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});try{
for(const width of[768,834,1024,1440,390])for(const theme of['light','dark']){
 stored=fixture();mode='ok';const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<1100}),page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',route=>{if(!['GET','HEAD'].includes(route.request().method()))return route.abort();return route.continue();});
 await page.exposeFunction('__qaRead',()=>clone(stored));
 await page.exposeFunction('__qaPatch',async body=>{requests.push(clone(body));if(mode==='wait')await new Promise(r=>release=r);if(mode==='fail')return{status:500,ok:false,message:'QA save failure'};if(body.baseUpdatedAt!==stored.updatedAt)return{status:409,code:'reservation_modifiee',reservation:clone(stored),error:'QA modified'};const allowed=['id','centerId','baseUpdatedAt','status','paymentMethod'];if(Object.keys(body).some(k=>!allowed.includes(k)))return{status:403,error:'Status-only permission requires targeted fields'};stored={...stored,status:body.status,...(body.paymentMethod?{paymentMethod:body.paymentMethod}:{}),updatedAt:new Date().toISOString()};return{status:200,ok:true,reservation:clone(stored)};});
 await installMock(page);await page.addInitScript(()=>{const old=window.fetch;window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(u.pathname==='/api/ops'&&u.searchParams.get('action')==='centerConfig'&&window.__qaClosed){const result=await old(input,init);const data=await result.json();for(const center of data.centers||[])center.defaultSchedule={regular:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,null])),holiday:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,null]))};return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}if(u.pathname==='/api/staff-state'){const r=await window.__qaRead();return new Response(JSON.stringify({ok:true,revision:r.updatedAt,reservations:[r],laneStatuses:{},centerId:r.centerId}),{headers:{'content-type':'application/json'}});}if(u.pathname==='/api/staff-reservations'&&init.method==='PATCH'){const r=await window.__qaPatch(JSON.parse(init.body));return new Response(JSON.stringify(r),{status:r.status,headers:{'content-type':'application/json'}});}return old(input,init);};});
 await page.goto('http://127.0.0.1:'+process.env.PINLANE_CAPACITY_PORT+'/',{waitUntil:'networkidle'});await setup(page,theme);
 await page.screenshot({path:path.join(out,width+'-'+theme+'-initial.png'),fullPage:true});
 const row=page.locator('#staffTableBox [data-res-row-id="99001"]');
 const density=await row.evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth+1}));records.push({width,theme,...density});check(!density.overflow,width+theme+' no horizontal page overflow');check(density.height<=300,width+theme+' single activity card remains compact');
 check(await row.locator('.gc-btn').evaluateAll(xs=>xs.every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44;})),width+theme+' card action touch targets44');
 await page.screenshot({path:path.join(out,width+'-'+theme+'-cards.png'),fullPage:true});
 const arrived=row.locator('button').filter({hasText:/^Arrivé$/}).first();check(await arrived.count()===1,width+theme+' arrival action exists');
 if(await arrived.count()){
  const before=clone(stored);mode='wait';await arrived.click();for(let i=0;i<30&&!release;i++)await page.waitForTimeout(10);check(Boolean(release),width+theme+' click sends arrival');
  check(await page.evaluate(()=>state.reservations[0].status==='confirmed'),width+theme+' pending arrival does not falsely claim saved');
  if(release){const n=requests.length;await page.evaluate(()=>setReservationStatusDirect(99001,'arrived'));check(requests.length===n,width+theme+' duplicate request suppressed');mode='ok';release();release=null;}
  await page.waitForTimeout(200);check(stored.status==='arrived',width+theme+' arrival persisted');check(stored.price===before.price&&JSON.stringify(stored.opsPlan)===JSON.stringify(before.opsPlan),width+theme+' arrival preserves price and plan');
  await page.reload({waitUntil:'networkidle'});await setup(page,theme);check(await page.evaluate(()=>state.reservations[0].status==='arrived'),width+theme+' fresh reload arrived');
 }
 if(width===768&&theme==='light'){
  stored=fixture();mode='fail';await setup(page,theme);const n=requests.length;
  await page.evaluate(()=>setReservationStatusDirect(99001,'arrived'));
  check(requests.length===n+1,'500 produces one request');check(stored.status==='confirmed','500 does not persist arrival');
  check(await page.evaluate(()=>state.reservations[0].status==='confirmed'),'500 leaves visible confirmed status');
  check(await page.locator('body').innerText().then(t=>t.includes('QA save failure')),'500 displays exact save failure');
  mode='ok';stored=fixture();await setup(page,theme);stored.notes='Operator changed note';stored.updatedAt='2026-10-04T09:00:00Z';const staleCount=requests.length;
  await page.evaluate(()=>setReservationStatusDirect(99001,'arrived'));
  check(requests.length===staleCount+1,'409 does not automatically replay arrival');check(stored.status==='confirmed','409 does not overwrite concurrent row');
  check(await page.evaluate(()=>state.reservations[0].notes==='Operator changed note'&&state.reservations[0].updatedAt==='2026-10-04T09:00:00Z'),'409 adopts fresh server note and version');
  stored=fixture();await setup(page,theme);
 }
 await page.evaluate(()=>{state.staffResourceView='bowling';renderStaff();togglePlanningExpanded();});
 const box=page.locator('#planningBox.expanded'),quick=box.locator('.planning-expanded-create'),date=box.locator('.staff-date-label');
 check(await box.count()===1,width+theme+' expanded planning active');check(await quick.isVisible(),width+theme+' expanded quick booking visible');check(await date.isVisible(),width+theme+' expanded date chooser visible');
 if(await quick.isVisible()){await quick.click();check(await page.locator('#quickBookOverlay:not(.hidden)').isVisible(),width+theme+' quick modal above fullscreen');check(await page.evaluate(()=>!!document.activeElement?.closest('#quickBookOverlay')),width+theme+' quick modal has focus');await page.keyboard.press('Escape');check(await page.locator('#quickBookOverlay').evaluate(e=>e.classList.contains('hidden')),width+theme+' quick Escape closes');}
 if(await date.isVisible()){await date.click();check(await page.locator('.staff-calendar-pop').isVisible(),width+theme+' date calendar above fullscreen');await page.keyboard.press('Escape');}
 await page.screenshot({path:path.join(out,width+'-'+theme+'-expanded.png')});
 if(width===768){
  await page.evaluate(async()=>{collapseStaffPlanningFullscreen();window.__qaClosed=true;while(staffCenterConfigCache.loading)await new Promise(r=>setTimeout(r,20));await loadStaffCenterConfig(true);const r=await window.__qaRead();state.reservations=[r,{...r,id:99002,name:'QA Laser fermé',type:'laser',startTime:'17:00',duration:.5,totalDuration:.5,lanes:[],pax:4,price:40}];state.staffResourceView='bowling';renderStaff();});
  check(await page.evaluate(()=>getPlanningWindow(state.currentDate).closed),'closed fixture is genuinely closed');
  check(await page.locator('#planningGridWrap .lane-col').count()===6,'closed day retains configured Bowling lane grid');
  check(await page.locator('#planningGridWrap [data-booking-res-id="99001"]').count()>0,'closed day retains saved Bowling block');
  check(await page.locator('#planningGridWrap .planning-closed-notice').isVisible(),'closed Bowling grid warns without availability');
  await page.screenshot({path:path.join(out,width+'-'+theme+'-closed-bowling.png')});
  await page.evaluate(()=>{state.staffResourceView='laser';renderStaff();});
  check(await page.locator('#laserPlanningGridWrap [data-laser-res-id="99002"]').count()>0,'closed day retains saved Laser block');
  check(await page.locator('#laserPlanningGridWrap .planning-closed-notice').isVisible(),'closed Laser grid warns without availability');
  check(await page.evaluate(()=>getPlanningWindow(state.currentDate).closed),'displaying saved grids does not reopen schedule');
  await page.screenshot({path:path.join(out,width+'-'+theme+'-closed-laser.png')});
 }
 await ctx.close();
}
check(errors.length===0,'no browser errors');fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({checks,failures,errors,requests,records,realDatabase:false,remoteWrites:0},null,2));if(failures.length)throw new Error(failures.join('\n'));console.log(JSON.stringify({ok:true,checks,out}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

