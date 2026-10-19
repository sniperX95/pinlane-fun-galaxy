'use strict';
delete process.env.DATABASE_URL;delete process.env.POSTGRES_URL;delete process.env.RESEND_API_KEY;
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),{chromium}=require('playwright-core');
const PORT=Number(process.env.PINLANE_LIVE_CARD_PORT||4642);
const root=path.resolve(__dirname,'..'),mock=require('./dev-tunnel-server'),base=mock.createServer({port:PORT});
const source=fs.readFileSync(path.join(root,'assets/fungalaxy-booking.js'),'utf8').replace(/\r\n/g,'\n');
const instrumented=source.replace('\n})();','\nwindow.__formulaLive={set:function(date,pax){state.date=date;state.pax=pax;disponibilitesFormulesTemps={};rendreFormules();}, select:function(id){state.formuleId=id;rendreFormules();},state:state};\n})();');
const built=require('../tools/build-public').minifierJavascript(instrumented,'assets/fungalaxy-booking.js',require('esbuild'));
const server=http.createServer((req,res)=>{if(new URL(req.url,'http://localhost').pathname==='/assets/fungalaxy-booking.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(built);return;}base.emit('request',req,res);});
let checks=0;function ok(c,label){assert.ok(c,label);checks++;console.log('OK '+label);}
async function main(){await new Promise(r=>server.listen(PORT,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.E2E_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});let writes=0,requests=0,reason='Aucun créneau ne permet de terminer avant midi.',available=false,delays=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('**/api/public-booking-meta*',async route=>{const response=await route.fetch(),j=await response.json();j.formules.forEach(f=>{if(f.id==='mm'){f.validDays=[];f.noHolidays=false;f.offerOff=false;}});await route.fulfill({response,json:j});});
 await page.route('**/api/public-availability*',async route=>{if(route.request().method()!=='GET'){writes++;return route.abort();}const q=new URL(route.request().url()).searchParams;if(q.get('type')!=='durees')return route.continue();requests++;const localAvailable=available,localReason=reason;if(delays)await new Promise(r=>setTimeout(r,q.get('pax')==='18'?250:10));try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,date:q.get('date'),pax:Number(q.get('pax')),durees:{},formulaAvailability:{mm:{available:localAvailable,reason:localReason}}})});}catch(_){}});
 await page.goto('http://127.0.0.1:'+PORT+'/fungalaxy/libramont');await page.waitForFunction(()=>document.body.classList.contains('is-ready'));
 await page.evaluate(date=>window.__formulaLive.set(date,18),mock.DATE);
 await page.waitForFunction(()=>document.querySelector('[data-formule="mm"]').getAttribute('aria-disabled')==='true');
 ok((await page.locator('[data-formule="mm"] .fg-for__off').innerText())===reason,'morning without real slot is unavailable with authoritative reason');
 await page.evaluate(()=>window.__formulaLive.select('mm'));
 await page.evaluate(date=>window.__formulaLive.set(date,18),mock.DATE);
 await page.waitForFunction(()=>window.__formulaLive.state.formuleId==='');ok(true,'selected formula is cleared when its real last slot disappears');
 reason='La période du matin est terminée pour aujourd’hui.';await page.evaluate(date=>window.__formulaLive.set(date,19),mock.DATE);
 await page.waitForFunction(()=>document.querySelector('[data-formule="mm"] .fg-for__off')?.textContent.includes('terminée'));
 ok(true,'elapsed morning is stated without guessed client clock');
 available=true;reason='';await page.evaluate(date=>window.__formulaLive.set(date,20),mock.DATE);
 await page.waitForFunction(()=>!document.querySelector('[data-formule="mm"]').hasAttribute('aria-disabled'));ok(true,'a valid real arrival restores the formula card');
 delays=true;available=false;reason='Ancienne réponse';await page.evaluate(date=>window.__formulaLive.set(date,18),mock.DATE);
 available=true;await page.evaluate(date=>window.__formulaLive.set(date,21),mock.DATE);await page.waitForTimeout(350);
 ok(await page.locator('[data-formule="mm"]').getAttribute('aria-disabled')===null,'late response for old participant count cannot disable current card');
 ok(requests<=7,'one shared durations request per actual choice, no fourteen formula probes');
 ok(errors.length===0&&writes===0,'no JavaScript error or API write');console.log('PASS '+checks+' formula live card assertions');
}finally{await browser.close();server.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
