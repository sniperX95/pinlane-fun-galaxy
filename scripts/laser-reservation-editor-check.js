'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.PINLANE_CAPACITY_PORT=process.env.PINLANE_LASER_EDITOR_PORT||'4770';
const {serveStatic,installMock}=require('./planning-capacity-ui-check');
const api=require('./activity-drag-contract-check');
const {chromium}=require('playwright-core');
const out=path.resolve(__dirname,'../tests/artifacts/laser-reservation-editor');fs.mkdirSync(out,{recursive:true});
let checks=0;function check(value,message){assert.ok(value,message);checks++;console.log('OK '+message);}
async function openSchedule(page){const d=page.locator('.dossier-laser-schedule');if(await d.count()&&!(await d.evaluate(el=>el.open)))await d.locator('summary').click();}
function preserved(before,after,unit){
  for(const key of ['date','startTime','duration','totalDuration','price','basePrice','pax','program','extras','status']){assert.deepEqual(after[key],before[key],key);checks++;}
  const outside=b=>b.activityId!=='laser_game'||`${b.countIndex||1}.${b.groupWaveIndex||1}`!==unit;
  for(const key of ['resourceBlocks','timeline']){assert.deepEqual(after.opsPlan?.[key]?.filter(outside),before.opsPlan?.[key]?.filter(outside));checks++;}
}
(async()=>{
  const server=await serveStatic(),browser=await chromium.launch({executablePath:process.env.E2E_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    for(const type of ['visit','formule','custom_request','legacy']){
      const fixture=api.fixture(type==='legacy'?'visit':type);
      if(type==='legacy'){fixture.type='laser';fixture.program=null;fixture.opsPlan=null;fixture.lanes=[];fixture.duration=1;fixture.pax=4;}
      api.setStored(fixture);api.setOther([]);
      const mobile=type==='custom_request';const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile});
      const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
      // La page vit la veille de la fixture (datee 2026-10-10 en dur) : a l heure
      // reelle, le groupe passerait aujourd hui, puis dans un jour passe. Le gate
      // ne fait que toucher et cliquer, une heure figee ne bloque aucun geste.
      await page.clock.setFixedTime(new Date('2026-10-09T12:00:00'));
      await page.exposeFunction('__qaReadReservation',()=>api.getStored());
      await page.exposeFunction('__qaPatchActivity',async body=>{requests.push(body);return body.activityMove?api.call(body.activityMove,{id:body.id,centerId:body.centerId,baseUpdatedAt:body.baseUpdatedAt}):api.call(undefined,body);});
      await installMock(page);await page.addInitScript(()=>{const old=window.fetch;window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.origin),method=init.method||'GET';
        if(u.pathname==='/api/staff-state'){const r=await window.__qaReadReservation();return new Response(JSON.stringify({ok:true,revision:r.updatedAt,reservations:u.searchParams.get('date')===r.date?[r]:[],laneStatuses:{},centerId:r.centerId}),{headers:{'content-type':'application/json'}});}
        if(u.pathname==='/api/staff-reservations'&&method==='PATCH'){const r=await window.__qaPatchActivity(JSON.parse(init.body));return new Response(JSON.stringify(r),{status:r.status,headers:{'content-type':'application/json'}});}
        if(!['GET','HEAD'].includes(method))return new Response('{}',{status:503});return old(input,init);};});
      await page.goto('http://127.0.0.1:'+process.env.PINLANE_CAPACITY_PORT+'/',{waitUntil:'networkidle'});
      await page.evaluate(async()=>{await ensureStaffConsolesLoaded();const r=await window.__qaReadReservation();state.currentDate=r.date;state.reservations=[r];state.adminCenterId=r.centerId;state.staffMenuPage='planning';state.staffResourceView='laser';setView('staff');await loadStaffCenterConfig(true);renderStaff();});
      // Le planning Laser de la maquette E : un groupe du jour est un bouton de
      // son depart (.lp-g), ou de la carte du prochain depart (.lp-groupe__sel)
      // le jour meme ; les departs joues se replient, on les rouvre d abord.
      await page.waitForSelector('#laserPlanningGridWrap .lp-dep',{timeout:10000});
      if(await page.locator('#laserPlanningGridWrap .lp-passe[aria-expanded="false"]').count())await page.locator('#laserPlanningGridWrap .lp-passe').click();
      const card=page.locator('#laserPlanningGridWrap :is(.lp-g, .lp-groupe__sel)[data-laser-res-id="99001"]').first();await card.scrollIntoViewIfNeeded();if(mobile)await card.tap();else await card.click();
      check(await page.evaluate(()=>state.selectedRes?.id===99001&&state.activeTab==='details'),'Laser card opens Infos '+type);
      await page.evaluate(()=>closePos());await card.focus();await page.keyboard.press('Enter');check(await page.evaluate(()=>state.selectedRes?.id===99001&&state.activeTab==='details'),'keyboard opens Infos '+type);
      check(await page.locator('.dossier-tabs').isVisible(),'keyboard opens actual reservation sheet '+type);
      // Une partie a placer se choisit au toucher (lpChoisir) : sa fiche s ouvre
      // par le bouton « Fiche » de la barre de placement.
      await page.evaluate(async()=>{closePos();await unscheduleLaserPass(99001,'2.1');});const pending=page.locator('#laserPlanningGridWrap .lp-jeton[data-laser-res-id="99001"]').first();await pending.click();await page.locator('#laserPlanningGridWrap .lp-placer button').filter({hasText:/^Fiche$/}).click();check(await page.evaluate(()=>state.selectedRes?.id===99001&&state.activeTab==='details'),'pending part opens Infos '+type);
      await page.locator('.dossier-tabs .tab').filter({hasText:'Modifier'}).click();
      check(await page.locator('.dossier-laser-editor').isVisible(),'direct Laser section '+type);
      check(await page.locator('.dossier-laser-unit').count()>=2,'each part listed '+type);
      check(await page.locator('[data-edit-activity="laser_game"] .dossier-activity-count').isVisible(),'participants and games available directly '+type);
      const unit='2.1',row=page.locator(`[data-laser-unit="${unit}"]`);await openSchedule(page);await row.locator('input').fill('19:00');const before=api.getStored();
      await row.getByRole('button',{name:/Placer|Déplacer/,exact:true}).click();await page.waitForFunction(()=>!dossierLaserSaving);
      check(api.getStored().opsPlan.resourceBlocks.some(b=>b.activityId==='laser_game'&&b.countIndex===2&&b.startTime==='19:00'),'direct unit saves through real API '+type+' '+await page.locator('#editError').textContent());
      if(type!=='legacy')preserved(before,api.getStored(),unit);
      check(requests.at(-1).activityMove.unitKey===unit&&!('startTime'in requests.at(-1)),'scoped intent only '+type);
      await openSchedule(page);await row.getByRole('button',{name:'Retirer du planning'}).click();await page.waitForFunction(()=>!dossierLaserSaving);check(!api.getStored().opsPlan.resourceBlocks.some(b=>b.activityId==='laser_game'&&b.countIndex===2),'unplace durable '+type);
      await openSchedule(page);await row.locator('input').fill('19:30');await row.getByRole('button',{name:'Placer',exact:true}).click();await page.waitForFunction(()=>!dossierLaserSaving);
      await page.reload({waitUntil:'networkidle'});await page.evaluate(async()=>{await ensureStaffConsolesLoaded();const r=await window.__qaReadReservation();state.reservations=[r];state.currentDate=r.date;state.adminCenterId=r.centerId;setView('staff');openPos(r.id);setTab('modifier');});
      await openSchedule(page);check(await row.locator('input').inputValue()==='19:30','reload keeps saved hour '+type);
      const n=requests.length;await page.locator('#editNameInput').fill('Brouillon non enregistré');await openSchedule(page);await row.locator('input').fill('20:00');await row.getByRole('button',{name:'Déplacer',exact:true}).click();check(requests.length===n,'unsaved draft blocks schedule '+type);check(/Enregistrez d’abord/.test(await page.locator('#editError').textContent()),'clear draft notice '+type);
      await page.evaluate(()=>{state.editState=etatEditionDepuis(state.selectedRes);renderPos();});const prior=api.getStored();api.setStored({...prior,updatedAt:'2026-10-05T08:09:00.000Z',notes:'Autre poste'});
      await openSchedule(page);await row.locator('input').fill('20:00');await row.getByRole('button',{name:'Déplacer',exact:true}).click();await page.waitForFunction(()=>!dossierLaserSaving);check(api.getStored().opsPlan.resourceBlocks.some(b=>b.countIndex===2&&b.startTime==='19:30'),'409 cannot move '+type);check(/autre poste|changé/.test(await page.locator('#editError').textContent()),'409 remains visible '+type);
      await page.evaluate(()=>{state.editError='';state.editState=etatEditionDepuis(state.selectedRes);renderPos();});
      await page.screenshot({path:path.join(out,type+'.png'),fullPage:true});
      check(await page.evaluate(()=>document.querySelector('.edit-modal').scrollWidth<=document.querySelector('.edit-modal').clientWidth+1),'editor has no horizontal overflow '+type);
      await page.locator('[data-edit-activity="laser_game"] .dossier-activity-count button[aria-label*="retirer"]').click();
      await page.locator('[data-edit-activity="laser_game"] .dossier-options button').filter({hasText:'1 partie'}).click();
      const expected=await page.evaluate(()=>({participants:state.editState.programmeEdite.laser_game.participants,games:state.editState.programmeEdite.laser_game.games,price:getEditPrixEstime()?.total}));
      check(expected.participants===3&&expected.games===1,'direct commercial controls update own participants and games '+type);
      await page.locator('.es-save').click();await page.waitForFunction(()=>!state.selectedRes);
      const saved=api.getStored(),laser=saved.program.items.find(i=>i.activityId==='laser_game');check(laser.participants===3&&laser.games===1,'participants and games saved by existing program API '+type);check(!requests.at(-1).activityMove,'commercial edit uses existing program contract '+type);check(saved.price===requests.at(-1).price,'saved price equals existing quote payload '+type);
      if(type==='legacy')check(saved.duration===.5&&requests.at(-1).duration===.5,'pure Laser single games control synchronizes saved duration '+type);
      else check(saved.program.items.find(i=>i.activityId==='bowling')?.duration===prior.program.items.find(i=>i.activityId==='bowling')?.duration,'Laser games edit preserves Bowling duration '+type);
      check(errors.length===0,'no JS errors '+type);await context.close();
    }
    console.log(JSON.stringify({ok:true,checks,fixtureOnly:true}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exit(1);});
