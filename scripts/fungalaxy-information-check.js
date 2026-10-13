'use strict';
// Real form, real embed bridge, local fixture APIs. No reservation is sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright-core');
const mock = require('./dev-tunnel-server');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PINLANE_INFORMATION_PORT || 4598);
const origin = 'http://127.0.0.1:' + port;
const out = path.join(root, 'tests/artifacts/fungalaxy-information');
let checks = 0;
const measurements = [];
const closeMeasurements = [];
function check(condition, label) { assert.ok(condition, label); checks++; console.log('OK ' + label); }
// LE TEXTE SE LIT SANS SES ESPACES INSECABLES (2026-10-13) : le formulaire
// lie un nombre a son unite (« 54 € », « 6 joueurs / piste ») pour qu un
// telephone ne les coupe plus. Ce gate asserte les montants, les nombres et
// les phrases, pas l espace qui les tient ensemble.
const sansInsecable = (texte) => (texte === null || texte === undefined ? texte : String(texte).replace(/[\u00a0\u202f]/g, ' '));
const base = mock.createServer({port});
const serveFixture = base.listeners('request')[0];
const server = http.createServer((req,res) => {
  if (process.env.PINLANE_INFORMATION_BUILT === '1' && new URL(req.url,origin).pathname === '/assets/fungalaxy-booking.js') {
    const built=require('../tools/build-public').minifierJavascript(fs.readFileSync(path.join(root,'assets/fungalaxy-booking.js'),'utf8'),'assets/fungalaxy-booking.js',require('esbuild'));
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(built);return;
  }
  if (new URL(req.url,origin).pathname === '/information-host') {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#111}#before{height:1200px}#slot{width:100%;max-width:1100px;margin:auto}#after{height:1200px}</style></head><body><div id="before"></div><div id="slot"></div><div id="after"></div><script src="/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#slot" data-height="720" data-scroll-margin="24"></script></body></html>');
    return;
  }
  serveFixture.call(base,req,res);
});
async function geometry(page,frame,embedded,label,attempt=0) {
  const box = embedded ? await page.locator('iframe').boundingBox() : {y:0,height:page.viewportSize().height};
  const record = await frame.evaluate(({box,viewportHeight,label}) => {
    const d=document.querySelector('.fg-info-dialog'),r=d.getBoundingClientRect();
    const visibleTop=Math.max(0,-box.y),visibleBottom=Math.min(box.height,viewportHeight-box.y);
    // The host screen owns the visual centre. The visible iframe intersection
    // constrains the popup when the frame does not cover the entire screen.
    const hostCentre=viewportHeight/2-box.y;
    // Sur telephone (moins de 600 px), la fiche est un tiroir pose 8 px au-dessus
    // du bas de ce qu on voit (Movsar, 2026-10-07) : son centre attendu en decoule.
    const sheet=innerWidth<600;
    const wanted=sheet?visibleBottom-8-r.height/2:Math.max(visibleTop+r.height/2+8,Math.min(visibleBottom-r.height/2-8,hostCentre));
    const css=getComputedStyle(d);
    return {label,sheet,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:r.height,offsetHeight:d.offsetHeight,styleTop:d.style.top,styleMaxHeight:d.style.maxHeight,cssTop:css.top,cssBottom:css.bottom,cssTransform:css.transform,cssPosition:css.position,cssMargin:css.margin,hostVue:window.__qaVue,visibleTop,visibleBottom,wanted,center:(r.top+r.bottom)/2,open:d.open,iframeTop:box.y,iframeHeight:box.height};
  },{box,viewportHeight:page.viewportSize().height,label});
  record.settlementAttempt=attempt;
  measurements.push(record);
  const settled=record.open&&record.left>=-1&&record.right<=record.width+1&&record.top>=record.visibleTop-2&&record.bottom<=record.visibleBottom+2&&Math.abs(record.center-record.wanted)<=4;
  // Native iframe dialogs and their loaded photographs resize asynchronously.
  // Retry the same exact geometry contract, preserving each intermediate
  // measurement; a persistent error still fails after two seconds.
  if(!settled&&attempt<20){await page.waitForTimeout(100);return geometry(page,frame,embedded,label,attempt+1);}
  if(record.top<record.visibleTop-2||record.bottom>record.visibleBottom+2||Math.abs(record.center-record.wanted)>4)await page.screenshot({path:path.join(out,label.replace(/[^a-z0-9_-]/gi,'-')+'-geometry.png')});
  check(record.open && record.left>=-1 && record.right<=record.width+1,label+' modal fits horizontal viewport');
  check(record.top>=record.visibleTop-2 && record.bottom<=record.visibleBottom+2,label+' modal fits actual visible iframe intersection');
  check(Math.abs(record.center-record.wanted)<=4,label+(record.sheet?' phone sheet rests on the bottom of the visible intersection, not of the full iframe':' modal centered on host screen and constrained to visible intersection, not full iframe'));
}
async function mounted(page,embedded) {
  await page.goto(origin+(embedded?'/information-host':'/fungalaxy/libramont'),{waitUntil:'domcontentloaded'});
  if(embedded) await page.waitForSelector('iframe');
  const frame=embedded?await page.locator('iframe').elementHandle().then(handle=>handle.contentFrame()):page;
  await frame.waitForFunction(()=>document.querySelector('#dayLabel')?.textContent.trim()!=='Choisir un jour');
  await frame.fill('#paxInput','18');await frame.press('#paxInput','Enter');await frame.click('#goActivities');
  await frame.waitForSelector('.fg-scene[data-scene="activites"].is-active');
  return frame;
}
async function waitRestoredOverflow(frame,previous,label) {
  const start=Date.now(),immediate=await frame.evaluate(()=>document.body.style.overflow);
  // Borne de l attente, pas une mesure : 352 fermetures relevees le 2026-10-06
  // font 8 ms en mediane et 435 ms au pire en vert, et une seule au-dela de
  // 500 ms sur une machine chargee rougissait le gate sans aucun defaut.
  await frame.waitForFunction(value=>document.body.style.overflow===value,previous,{timeout:3000});
  closeMeasurements.push({label,previous,immediate,settled:await frame.evaluate(()=>document.body.style.overflow),elapsedMs:Date.now()-start});
}
async function popup(page,frame,button,embedded,label,expectedFragments=[]) {
  const before=await frame.locator('.fg-scene.is-active').textContent().then(sansInsecable);
  const overflowBefore=await frame.evaluate(()=>document.body.style.overflow);
  await button.scrollIntoViewIfNeeded();
  const control=await button.evaluate(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,label:b.getAttribute('aria-label'),radio:b.closest('[aria-checked]')?.getAttribute('aria-checked')}));
  check(control.width>=44&&control.height>=44&&control.label,label+' accessible 44px hit target');
  const icon=await button.evaluate(b=>{const el=b.querySelector('.fg-info-icon');if(!el)return null;const rect=el.getBoundingClientRect();return {width:rect.width,height:rect.height,radius:getComputedStyle(el).borderRadius};});
  check(icon&&icon.width>=18&&icon.width<=24&&icon.height>=18&&icon.height<=24,label+' small standard information circle inside large hitbox');
  const hit=await button.evaluate(b=>{const r=b.getBoundingClientRect(),target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {clickable:!!target&&b.contains(target),interceptor:target?.className||null};});
  if(!hit.clickable)await page.screenshot({path:path.join(out,label.replace(/[^a-z0-9_-]/gi,'-')+'-blocked.png')});
  check(hit.clickable,label+' information target is truly clickable at its center: '+JSON.stringify(hit));
  if(label.endsWith('/unselected-activity/0')){await button.focus();await page.keyboard.press('Enter');}else await button.click();
  await frame.waitForFunction(()=>document.querySelector('.fg-info-dialog')?.open);
  await page.waitForTimeout(300);
  await geometry(page,frame,embedded,label);
  const text=await frame.locator('.fg-info-text').textContent().then(sansInsecable);
  const title=await frame.locator('#fgInfoTitle').textContent().then(sansInsecable);
  check(title.trim().length>0&&text.trim().length>0,label+' meaningful named details');
  for(const fragment of expectedFragments) { const present=fragment==='sans cadeaux' ? /(?:sans|hors).{0,60}cadeaux/i.test(text) : text.includes(fragment); check(present,label+' preserves known rule '+fragment+(present?'':' in '+JSON.stringify(text))); }
  if(text.includes('Information longue pour vérifier le défilement')) {
    await frame.locator('.fg-info-body').evaluate(body=>{body.scrollTop=0;body.focus();});await page.keyboard.press('PageDown');await frame.waitForFunction(()=>document.querySelector('.fg-info-body').scrollTop>0,null,{timeout:2000}).catch(()=>{});
    check(await frame.locator('.fg-info-body').evaluate(body=>body.scrollTop>0),label+' long details are scrollable with the keyboard');
    const scroll=await frame.locator('.fg-info-body').evaluate(body=>{body.scrollTop=body.scrollHeight;const rect=body.getBoundingClientRect(),last=body.lastElementChild.getBoundingClientRect();return {canScroll:body.scrollHeight>body.clientHeight,scrolled:body.scrollTop>0,lastReachable:last.bottom<=rect.bottom+2&&last.bottom>=rect.top};});
    check(scroll.canScroll&&scroll.scrolled&&scroll.lastReachable,label+' long configured details scroll and final text remains reachable');
  }
  // La photo a le temps de finir de charger (3 s au plus) : une machine chargee
  // la recevait apres la verification. Une image cassee rougit toujours.
  await frame.locator('.fg-info-photo').evaluate(img=>img.hidden||img.complete||new Promise(done=>{img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});setTimeout(done,3000);}));
  check(await frame.locator('.fg-info-photo').evaluate(img=>img.hidden||img.complete&&img.naturalWidth>0&&!!img.alt),label+' actual photograph loads or is honestly absent');
  const focusBefore=await frame.evaluate(()=>document.activeElement?.outerHTML.slice(0,200));
  await page.keyboard.press('Tab');
  const focusAfterTab=await frame.evaluate(()=>({inside:document.querySelector('.fg-info-dialog').contains(document.activeElement),active:document.activeElement?.outerHTML.slice(0,200)}));
  await page.keyboard.press('Shift+Tab');
  const focusState=await frame.evaluate(()=>({inside:document.querySelector('.fg-info-dialog').contains(document.activeElement),active:document.activeElement?.outerHTML.slice(0,240),dialogOpen:document.querySelector('.fg-info-dialog').open}));
  check(focusAfterTab.inside&&focusState.inside,label+' native modal traps keyboard focus '+JSON.stringify({focusBefore,focusAfterTab,...focusState}));
  if(embedded) {
    await page.evaluate(()=>scrollBy(0,65));await page.waitForTimeout(100);
    await geometry(page,frame,true,label+' parent-scroll');
  }
  if(label.endsWith('/activity/0')||label.endsWith('/unselected-activity/0')||label.includes('/formula/f1')||label.includes('/formula/mm')||label.includes('/arcade/time-30')) await page.screenshot({path:path.join(out,label.replace(/[^a-z0-9_-]/gi,'-')+'.png')});
  await page.keyboard.press('Escape');
  // Native close events are queued separately from the open property update.
  // Await the exact previous scroll state before checking or reopening.
  await waitRestoredOverflow(frame,overflowBefore,label+' Escape');
  check(!await frame.locator('.fg-info-dialog').evaluate(d=>d.open),label+' Escape closes');
  check(await button.evaluate(b=>document.activeElement===b),label+' Escape restores exact opener focus');
  check(await frame.evaluate(()=>document.body.style.overflow)===overflowBefore,label+' closing restores previous page scroll state');
  check(await frame.locator('.fg-scene.is-active').textContent().then(sansInsecable)===before,label+' info does not toggle selection or change prices/options');
  await button.click();await frame.click('.fg-info-close');
  if(label.endsWith('/unselected-activity/0')) {
    const nextOpener=frame.locator('#gridAct [data-activity-info]').nth(1);
    // Click another real opener immediately after close; its title/focus must
    // supersede the previous opener without retaining a hidden overflow state.
    await nextOpener.click();
    await frame.waitForFunction(()=>document.querySelector('.fg-info-dialog').open);
    check((await frame.locator('#fgInfoTitle').textContent().then(sansInsecable))===await nextOpener.getAttribute('data-info-title'),label+' immediate reopen displays the next activity');
    check(await frame.evaluate(()=>document.body.style.overflow==='hidden'),label+' immediate reopen maintains the active modal scroll lock');
    await page.keyboard.press('Escape');
    await waitRestoredOverflow(frame,overflowBefore,label+' immediate reopen Escape');
    check(await nextOpener.evaluate(b=>document.activeElement===b),label+' immediate reopen restores the latest opener, never the old one');
  } else await waitRestoredOverflow(frame,overflowBefore,label+' close control');
  check(!await frame.locator('.fg-info-dialog').evaluate(d=>d.open),label+' close control works repeatedly');
  check(await frame.locator('.fg-info-dialog').count()===1,label+' one reusable dialog only');
  return text;
}
async function run() {
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.E2E_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const errors=[];let blockedWrites=0;
 try {
  for(const viewport of [{width:1440,height:844},{width:390,height:844},{width:320,height:844},{width:844,height:390}])for(const embedded of [false,true]) {
   const width=viewport.width;
   if(process.env.PINLANE_INFORMATION_CONTEXT&&process.env.PINLANE_INFORMATION_CONTEXT!==width+'/'+(embedded?'embed':'standalone'))continue;
   const context=await browser.newContext({viewport,reducedMotion:'reduce'});
   await context.addInitScript(()=>window.addEventListener('message',event=>{if(event.data?.type==='pinlane:vue')window.__qaVue=event.data;}));
   let metadata;
   await context.route('**/*',async route=>{const request=route.request();if(!request.url().startsWith(origin+'/'))return route.abort();if(!['GET','HEAD'].includes(request.method())){blockedWrites++;return route.abort();}
    if(new URL(request.url()).pathname==='/api/public-booking-meta') {
      const response=await route.fetch();const body=await response.json();
      const arcade=body.activities?.find(activity=>activity.id==='arcade_time');
      if(arcade)arcade.arcadeOffers=require('../lib/arcade-offers').defaults();
      const mini=body.activities?.find(activity=>activity.id==='minigolf_blacklight');
      if(mini)mini.description='Information longue pour vérifier le défilement. '+ 'Prends le temps de lire les règles et respecte les autres joueurs. '.repeat(35);
      if(body.formules?.[0])body.formules[0].notes=[...(body.formules[0].notes||[]),'Information longue pour vérifier le défilement. '+ 'Une précision du centre doit rester lisible même sur petit écran. '.repeat(35)];
      metadata=body;return route.fulfill({response,json:body});
    }return route.continue();});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const frame=await mounted(page,embedded),label=width+'/'+(embedded?'embed':'standalone');
   const activities=frame.locator('#gridAct [data-activity-info]');
   check(await frame.locator('#gridAct .fg-card.is-on').count()===0,label+' unselected activity fixture is really empty');
   check(await activities.count()===8,label+' all eight unselected activities expose information');
   for (const id of ['bowling','duckpin_bowling','fun_run']) {
    const item=frame.locator('#gridAct li[data-activity="'+id+'"]');
    const brief=await item.locator('.fg-card__rot').innerText().then(sansInsecable);
    const details=JSON.parse(await item.locator('[data-activity-info]').getAttribute('data-info-sections'));
    check(!/[×=]/.test(brief)&&(id==='fun_run' ? brief.includes('au choix') : brief.includes('joueurs / piste')),label+'/'+id+' before selection has no invented total');
    check(details[0].titre==='Le tarif'&&!details[0].lignes.some(line=>/[×=]/.test(line)),label+'/'+id+' before selection modal has catalogue tariff, no presumed selection');
   }
   await page.screenshot({path:path.join(out,label.replace('/','-')+'-unselected-cards.png')});
   for(let index=0;index<8;index++)await popup(page,frame,activities.nth(index),embedded,label+'/unselected-activity/'+index);
   await frame.locator('#gridAct .fg-card:not(.is-on)').evaluateAll(cards=>cards.forEach(card=>card.click()));
   check(!(await frame.locator('#gridAct').textContent().then(sansInsecable)).includes('Information longue pour vérifier le défilement'),label+' long explanations do not expand activity cards');
   check(await activities.count()===8,label+' all eight activities expose information');
   const selectedBowling=frame.locator('#gridAct li[data-activity="bowling"]');
   check((await selectedBowling.locator('.fg-card__rot').innerText().then(sansInsecable)).includes('× 39 € ='),label+' selected bowling preserves exact default 1-hour calculation');
   for(let index=0;index<8;index++) {
    const button=activities.nth(index),id=await button.getAttribute('data-activity-info'),activity=metadata.activities.find(value=>value.id===id),expected=[];
    if(activity.minAge)expected.push(String(activity.minAge));if(activity.maxAge)expected.push(String(activity.maxAge));if(activity.minPax)expected.push(String(activity.minPax));
    if(id==='arcade_time')expected.push('carte par personne');
    if(id==='bowling')expected.push('10 min');
    if(id==='minigolf_blacklight')expected.push('Information longue pour vérifier le défilement');
    await popup(page,frame,button,embedded,label+'/activity/'+index,expected);
   }
   // Cochee par la selection complete plus haut : la retoucher la decocherait
   // depuis le 2026-10-06 (journal Pinlane, entree 387).
   check(await frame.locator('#gridAct li[data-activity="arcade_time"] .fg-card').getAttribute('aria-checked')==='true',label+' MONTAGE arcades cochees par la selection complete');
   const arcade=frame.locator('#gridAct .fg-grid__item[data-activity="arcade_time"]');
   await arcade.locator('[data-compteur="participants"] input').fill('3');await arcade.locator('[data-compteur="participants"] input').press('Enter');
   for(const [id,total] of [['time-30',45],['time-60',90]]) {
    await arcade.locator('.fg-pill[data-cle="arcadeOfferId"][data-valeur="'+id+'"]').click();
    check((await arcade.locator('.fg-card__price').textContent().then(sansInsecable)).includes(total+' €'),label+' timed arcade chosen total remains exact');
    await popup(page,frame,arcade.locator('[data-activity-info]'),embedded,label+'/arcade/'+id,['3 joueurs','3 cartes','sans cadeaux','illimité']);
   }
   await arcade.locator('.fg-pill[data-cle="arcadeMode"][data-valeur="credit"]').click();
   await arcade.locator('[data-compteur="cards"] input').fill('2');await arcade.locator('[data-compteur="cards"] input').press('Enter');
   for(const [id,total,credits] of [['credit-10',20,10],['credit-25',50,35],['credit-35',70,50],['credit-50',100,75]]) {
    await arcade.locator('select').selectOption(id);
    check((await arcade.locator('.fg-card__price').textContent().then(sansInsecable)).includes(total+' €'),label+' credit arcade chosen total remains exact');
    await popup(page,frame,arcade.locator('[data-activity-info]'),embedded,label+'/arcade/'+id,['3 joueurs','2 cartes',credits+' crédits','cadeaux inclus','1,2 à 2,4']);
   }
   await frame.click('#tabFor');
   const formulas=frame.locator('.fg-scene.is-active [data-formula-info]');
   check(!(await frame.locator('#panelFor').textContent().then(sansInsecable)).includes('Information longue pour vérifier le défilement'),label+' long explanations do not expand formula cards');
   check(await formulas.count()>0,label+' formulas expose information');
   for(let index=0;index<await formulas.count();index++) {
    const button=formulas.nth(index),id=await button.getAttribute('data-formula-info'),formula=metadata.formules.find(value=>value.id===id);
    const expected=[...(formula.notes||[]).filter(note=>!(/cadeaux/i.test(note)&&(formula.desc||[]).some(d=>/cadeaux/i.test(d)))),...(formula.desc||[])];if(formula.minPax)expected.push(String(formula.minPax));
    const text=await popup(page,frame,button,embedded,label+'/formula/'+id,expected);
    if(formula.noHolidays)check(/hors vacances|(?:pas|non valable).{0,30}vacances|vacances.{0,30}(?:non|exclu|indispon)/i.test(text),label+'/'+id+' exposes known holiday exclusion');
    if(formula.kidsOnly)check(/enfants?/i.test(text),label+'/'+id+' exposes children-only audience');
    if(id==='f6'||id==='f7')check(text.includes("8 crédits d'arcade (8€) par enfant"),label+'/'+id+' explicitly includes eight arcade credits per child');
    if(id==='mm')check(text.includes('terminées à 12h')&&/hors jeux à cadeaux|cadeaux ne sont pas inclus/.test(text),label+'/'+id+' requires completion at noon and excludes prize games');
    if(id==='kfd')check((await button.locator('..').textContent().then(sansInsecable)).includes('Toutes les activités illimitées'),label+'/'+id+' exposes unlimited activities before selection');
    if(Array.isArray(formula.validDays)&&formula.validDays.length===1)check(text.toLowerCase().includes(['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][Number(formula.validDays[0])]),label+'/'+id+' exposes known valid weekday');
   }
   const availableKids=metadata.formules.find(formula=>formula.kidsOnly && formula.type==='per_pax' && formula.minPax<=16);
   check(!!availableKids,label+' fixture includes a children formula for price synchronization');
   // Demain au plus tot : le jour meme, la formule se refuse des que son heure
   // de fin est passee (Kids Fun Day finit a 17h ; le gate tournait rouge le soir).
   const kidsDate=new Date(metadata.today+'T12:00:00Z');kidsDate.setUTCDate(kidsDate.getUTCDate()+1);
   while(Array.isArray(availableKids.validDays)&&!availableKids.validDays.includes(kidsDate.getUTCDay()))kidsDate.setUTCDate(kidsDate.getUTCDate()+1);
   const kidsDay=kidsDate.toISOString().slice(0,10);
   await frame.click('.fg-scene[data-scene="activites"] [data-back]');await frame.click('#dayBtn');await frame.click('.fg-cal__day[data-date="'+kidsDay+'"]');await frame.click('#goActivities');await frame.click('#tabFor');
   const kidsCard=frame.locator('#gridFor [data-formule="'+availableKids.id+'"]');
   check(!await kidsCard.evaluate(card=>card.classList.contains('is-refus')),label+' children formula is available on fixture date');
   await kidsCard.click();
   const kidsControls=frame.locator('[data-kids-for="'+availableKids.id+'"]');
   await kidsControls.locator('[data-kids="-1"]').click();await kidsControls.locator('[data-kids="-1"]').click();
   check((await kidsControls.locator('.fg-kids__n').textContent().then(sansInsecable)).trim()==='16',label+' children counter independently changes from 18 to 16');
   const kidsPrice=(await kidsControls.locator('.fg-kids__prix').textContent().then(sansInsecable)).trim();
   const kidsAdults=(await kidsControls.locator('.fg-kids__adults').textContent().then(sansInsecable)).trim();
   check(kidsPrice.includes(String(Number(availableKids.price)*16)),label+' children formula price matches 16 paying children');
   await popup(page,frame,frame.locator('#gridFor [data-formula-info="'+availableKids.id+'"]'),embedded,label+'/selected-kids/'+availableKids.id,[kidsPrice,kidsAdults]);
   await frame.click('.fg-scene[data-scene="activites"] [data-back]');await frame.fill('#paxInput','31');await frame.press('#paxInput','Enter');await frame.click('#goActivities');
   await frame.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');await frame.click('.fg-occasion[data-type="amis"]');await frame.click('#smGoDate');await frame.check('#smFlexible');await frame.fill('#smPeriod','Vacances');await frame.click('.fg-sm-moment[data-moment="indifferent"]');await frame.click('#smGoEnvies');
   await frame.waitForSelector('.fg-scene[data-scene="sm-envies"].is-active');await frame.click('#smTabAct');
   const customActivities=frame.locator('#smGridAct [data-activity-info]');
   check(await frame.locator('#smGridAct .fg-card.is-on').count()===0,label+' custom unselected activity fixture is really empty');
   check(await customActivities.count()===8,label+' custom all eight unselected activities expose information');
   for(let index=0;index<8;index++)await popup(page,frame,customActivities.nth(index),embedded,label+'/custom-unselected-activity/'+index);
   await frame.locator('#smGridAct .fg-card:not(.is-on)').evaluateAll(cards=>cards.forEach(card=>card.click()));
   check(await customActivities.count()===8,label+' custom all eight activities expose information');
   for(let index=0;index<8;index++) {
    const button=customActivities.nth(index),id=await button.getAttribute('data-activity-info');
    await popup(page,frame,button,embedded,label+'/custom-activity/'+index,id==='bowling'||id==='arcade_time'?['31 joueurs']:[]);
   }
   const customFormulaTab=frame.locator('#smTabFor');
   if(await customFormulaTab.count())await customFormulaTab.click();
   const customFormulas=frame.locator('.fg-scene.is-active [data-formula-info]');
   check(await customFormulas.count()>0,label+' custom formulas expose information');
   for(let index=0;index<await customFormulas.count();index++) {
    const button=customFormulas.nth(index),id=await button.getAttribute('data-formula-info');
    const text=await popup(page,frame,button,embedded,label+'/custom-formula/'+index);
    if(id==='f6'||id==='f7')check(text.includes("8 crédits d'arcade (8€) par enfant"),label+'/custom/'+id+' explicitly includes eight arcade credits per child');
    if(id==='mm')check(text.includes('terminées à 12h')&&/hors jeux à cadeaux|cadeaux ne sont pas inclus/.test(text),label+'/custom/'+id+' requires completion at noon and excludes prize games');
    if(id==='kfd')check((await button.locator('..').textContent().then(sansInsecable)).includes('Toutes les activités illimitées'),label+'/custom/'+id+' exposes unlimited activities before selection');
   }
   await page.screenshot({path:path.join(out,'information-'+width+'-'+(embedded?'embed':'standalone')+'.png'),fullPage:false});
   await context.close();
  }
  check(errors.length===0,'no JavaScript errors: '+errors.join('; '));check(blockedWrites===0,'information flows attempt no API writes');
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({checks,blockedWrites,errors,measurements,closeMeasurements},null,2));console.log('PASS '+checks+' information assertions');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({checks,error:error.stack,measurements,closeMeasurements},null,2));console.error(error);process.exitCode=1;});
