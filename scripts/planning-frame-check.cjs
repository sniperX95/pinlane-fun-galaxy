'use strict';
// Fixture-only stable frame across Bowling and Laser, including return
// transitions and visible toolbar controls. No production API access.
// Since 2026-11-03 the three plannings (Bowling, Laser and « Toutes », the wall
// board) share one bar, #planningBarre: it must not move between them, nor coming
// back, nor under a counter filter, nor under a typed name, nor in fullscreen.
// What sits under the bar is compared per surface.
// --contre-preuves: a broken frame, served from memory, must turn red.
const fs=require('fs'),path=require('path'),Module=require('module');
process.env.PINLANE_RESERVER_PORT=process.env.PINLANE_FRAME_PORT||'5183';
const ROOT=path.resolve(__dirname,'..'),FILE=path.join(__dirname,'planning-laser-check.js');
const mod=new Module(FILE,module);mod.filename=FILE;mod.paths=Module._nodeModulePaths(__dirname);
mod._compile(fs.readFileSync(FILE,'utf8').replace(/main\(\)\.catch\([\s\S]*?\);\s*$/,'module.exports={journee,installerServeur};'),FILE);
const lp=mod.exports,fixture=require('./reserver-v5-check'),{chromium}=require('playwright-core');
const OUT=path.join(ROOT,'artifacts/planning-frame-20261010');
const GF_JS='assets/pinlane-planning-global.js',GF_CSS='assets/pinlane-planning-global.css';
// Each step opens a surface; `etat` puts Toutes in a state that must not move its frame.
const ETAPES=[{surface:'bowling'},{surface:'laser'},{surface:'all'},{surface:'bowling',retour:true},{surface:'all',retour:true},{surface:'all',retour:true,etat:'filtre'},{surface:'all',retour:true,etat:'nom'},{surface:'laser',retour:true}];
const MUTATIONS=[
  // The sheet takes the height of its rows: a filter shrinks it, the list below jumps.
  {nom:'hauteur-des-lignes',fichier:GF_JS,de:'    if (defile.style.height !== valeur) defile.style.height = valeur;',vers:'    if (defile.style.maxHeight !== valeur) defile.style.maxHeight = valeur;',attendu:/"key":"tableau","prop":"height"/},
  // The head band grows under a filter: everything below it moves.
  {nom:'bandeau-qui-grandit',fichier:GF_CSS,de:'button.gf-c.is-on, button.gf-c.is-on:hover { background: var(--text); color: var(--surface); }',vers:'button.gf-c.is-on, button.gf-c.is-on:hover { background: var(--text); color: var(--surface); }\n.pb-bande:has(.gf-c.is-on) { height: 60px; }',attendu:/"key":"kpi","prop":"height"/},
];
function comparer(capturesDuCadre,cles,variations){
  const [initial,...suite]=capturesDuCadre;
  for(const c of suite)for(const key of cles){
    const a=initial.metrics[key],b=c.metrics[key];
    if(!a?.visible||!b?.visible)continue;
    for(const prop of ['top','height','left',...(['title','headTitle','date','kpiLabel','kpiValue','tabLabel'].includes(key)?['font']:[])]){
      if((key==='box'&&prop==='height')||(key==='kpiValue'&&prop==='left'))continue;
      const delta=Math.abs(parseFloat(a[prop])-parseFloat(b[prop]));
      if(delta>1)variations.push({surface:c.metrics.surface,etat:c.etat||'',key,prop,before:a[prop],after:b[prop],delta});
    }
  }
}
async function jouer(browser,{datasets,viewports,mutation}){
  const results=[];
  for(const dataset of datasets)for(const viewport of viewports){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});await context.route('**/*',r=>new URL(r.request().url()).origin===fixture.BASE_URL?r.continue():r.abort());
    if(mutation){const source=fs.readFileSync(path.join(ROOT,mutation.fichier),'utf8').replace(/\r\n/g,'\n');await context.route(`**/${mutation.fichier}*`,r=>r.fulfill({status:200,contentType:mutation.fichier.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',body:source.replace(mutation.de,()=>mutation.vers)}));}
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const instant=new Date('2026-10-10T15:12:00');await page.clock.setFixedTime(instant);await fixture.installMock(page,{maintenant:instant.getTime()});await lp.installerServeur(page,dataset==='busy'?lp.journee():[]);
    await page.addInitScript(()=>{const prior=window.fetch;window.fetch=async(...args)=>{const result=await prior(...args),url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.origin);if(url.pathname==='/api/public-booking-meta'){const data=await result.json();data.center.day.schedule={open:10,close:24,label:'10h - 24h'};return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}return result;};});
    await fixture.boot(page,{installer:false});await page.evaluate(()=>{state.staffTheme='dark';applyStaffTheme();state.currentDate='2026-10-10';state.reservations=window.__LP_DOSSIERS__.map(d=>JSON.parse(JSON.stringify(d)));});
    for(const mode of ['window','full']){
      const captures=[];
      for(const [i,etape] of ETAPES.entries()){
        const {surface,etat,retour}=etape;
        await page.evaluate(({mode,surface,etat})=>{
          if(mode==='full')goFullscreenResource(surface);else{collapseStaffPlanningFullscreen();setStaffResourceView(surface);}
          if(etat==='filtre')setStaffStatusFilter('upcoming');
          else if(etat==='nom'){setStaffStatusFilter('all');applyStaffSearch('zzz',{immediate:true});}
          else{setStaffStatusFilter('all');applyStaffSearch('',{immediate:true});}
        },{mode,surface,etat});
        await page.waitForTimeout(450);
        const metrics=await page.evaluate(({surface})=>{
          const box=document.querySelector(surface==='bowling'?'#planningBox':surface==='laser'?'#laserPlanningBox':'#globalPlanningBox');
          const bounds=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight,visible:s.display!=='none'&&r.width>0&&r.height>0};};
          const head=document.getElementById('planningBarre'),bande=document.getElementById('planningBande');
          const title=head.querySelector('h1'),date=head.querySelector('.pb-date');
          const range=document.createRange();range.selectNodeContents(title);
          const titleContent=range.getBoundingClientRect(),dr=date?.getBoundingClientRect();
          // (the title of the bar is masked on purpose, clip-path on a 1 px box: it stays for
          // screen readers, its text range overflows a box nobody sees)
          const titleBox=title.getBoundingClientRect(),titleMasked=getComputedStyle(title).clipPath!=='none'&&titleBox.width<=1&&titleBox.height<=1;
          const titleCollision=!titleMasked&&!!dr&&titleContent.right>dr.left-4&&titleContent.top<dr.bottom&&titleContent.bottom>dr.top;
          const sw=head.querySelector('.fs-switch')?.getBoundingClientRect();
          const dateSwitchCollision=!!dr&&!!sw&&sw.width>0&&dr.left<sw.right&&dr.right>sw.left&&dr.top<sw.bottom&&dr.bottom>sw.top;
          const commandes=[...head.querySelectorAll('button,input')];
          const buttons=commandes.filter(e=>bounds(e).visible).map(e=>({text:e.textContent.trim()||e.getAttribute('placeholder'),...bounds(e),unobscured:(()=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(e===hit||e.contains(hit));})()}));
          return{surface,titleCollision,dateSwitchCollision,titleContent:{left:titleContent.left,right:titleContent.right,top:titleContent.top,bottom:titleContent.bottom},head:bounds(head),title:bounds(title),date:bounds(document.querySelector('#staffDateShort')),dateNav:bounds(date),kpi:bounds(bande),kpiLabel:bounds(bande.querySelector('.pb-k .gf-c__l')),kpiValue:bounds(bande.querySelector('.pb-k .gf-c__v')),tabLabel:bounds(head.querySelector('.pb-seg__b')),tabs:bounds(head.querySelector('.pb-seg')),box:bounds(box),headDate:bounds(date),switch:null,recherche:bounds(document.getElementById('gfRecherche')),tableau:bounds(box.querySelector('.gf-defile')),gf:{large:document.body.classList.contains('gf-large'),lignes:box.querySelectorAll('.gf-r').length,filtre:bande.querySelectorAll('.gf-c.is-on').length,rien:box.querySelectorAll('.gf-rien').length},buttons,viewport:{width:innerWidth,height:innerHeight}};
        },{surface});
        const name=`${viewport.width}x${viewport.height}-${dataset}-${mode}-${surface}${retour?'-return':''}${etat?`-${etat}`:''}-${i}`;
        await page.screenshot({path:path.join(OUT,`${name}.png`)});captures.push({name,etat,metrics});
      }
      // The one bar: Bowling, Laser, Toutes and the way back.
      const variations=[];
      comparer(captures,['head','title','date','dateNav','kpi','tabLabel','tabs','recherche'],variations);
      // What only Bowling and Laser show: their figures, their boxes.
      comparer(captures.filter(c=>c.metrics.surface!=='all'),['kpiLabel','kpiValue','box'],variations);
      // Under the bar, Toutes against itself.
      const toutes=captures.filter(c=>c.metrics.surface==='all');
      comparer(toutes,['box','tableau'],variations);
      // The set-up: a gate that does not reach the board must not pass.
      const montage=toutes.filter(c=>!c.metrics.gf.large||!c.metrics.kpi?.visible).map(c=>c.name);
      if(dataset==='busy'){
        if(!toutes[0].metrics.gf.lignes)montage.push('no row on the board');
        if(!toutes.find(c=>c.etat==='filtre').metrics.gf.filtre)montage.push('counter filter not on');
        if(!toutes.find(c=>c.etat==='nom').metrics.gf.rien)montage.push('typed name not applied');
      }
      const inaccessible=captures.flatMap(c=>c.metrics.buttons.filter(b=>b.top<0||b.bottom>viewport.height||b.left<0||b.right>viewport.width||!b.unobscured).map(b=>({surface:c.metrics.surface,text:b.text,box:b})));
      const collisions=captures.filter(c=>c.metrics.titleCollision||c.metrics.dateSwitchCollision).map(c=>({surface:c.metrics.surface,titleCollision:c.metrics.titleCollision,dateSwitchCollision:c.metrics.dateSwitchCollision,titleContent:c.metrics.titleContent,date:c.metrics.headDate,switch:c.metrics.switch}));
      const pass=!variations.length&&!inaccessible.length&&!collisions.length&&!errors.length&&!montage.length;
      results.push({dataset,viewport,mode,pass,variations,inaccessible,collisions,montage,captures,errors});
      if(!mutation)console.log(`${pass?'PASS':'FAIL'} ${viewport.width}x${viewport.height} ${dataset} ${mode} variations=${JSON.stringify(variations)} inaccessible=${JSON.stringify(inaccessible.slice(0,3))} titleCollisions=${JSON.stringify(collisions.slice(0,2))} montage=${JSON.stringify(montage)} errors=${JSON.stringify(errors.slice(0,2))}`);
    }
    await context.close();
  }
  return results;
}
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const server=await fixture.serveStatic(),browser=await chromium.launch({executablePath:fixture.BROWSER_PATH,headless:true});
  try{
    if(process.argv.includes('--contre-preuves')){
      for(const mutation of MUTATIONS){
        const source=fs.readFileSync(path.join(ROOT,mutation.fichier),'utf8').replace(/\r\n/g,'\n');
        if(source.split(mutation.de).length!==2){console.log(`FAIL contre-preuve ${mutation.nom}: anchor found ${source.split(mutation.de).length-1} times`);process.exitCode=1;continue;}
        const results=await jouer(browser,{datasets:['busy'],viewports:[{width:1440,height:900}],mutation});
        const vu=results.some(r=>mutation.attendu.test(JSON.stringify(r.variations)));
        console.log(`${vu?'ok  ':'FAIL'} contre-preuve ${mutation.nom}: the frame of Toutes ${vu?'turns red':`stays green ${JSON.stringify(results.flatMap(r=>r.variations).slice(0,3))}`}`);
        if(!vu)process.exitCode=1;
      }
      return;
    }
    const results=await jouer(browser,{datasets:['busy','empty'],viewports:[{width:1702,height:1045},{width:1440,height:900},{width:1366,height:768}]});
    fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));
    if(results.some(r=>!r.pass))process.exitCode=1;
  }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
