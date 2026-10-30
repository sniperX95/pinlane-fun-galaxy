'use strict';
// Actual local availability + hold preparation. Synthetic stock/contact only.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');
const PORT = Number(process.env.PINLANE_EMERGENCY_PORT || 4691);
const OUT = path.resolve(__dirname, '../tests/artifacts/activity-participants');
let checks = 0;
function check(ok, label) { assert.ok(ok, label); checks++; console.log('OK ' + label); }
// LE TEXTE SE LIT SANS SES ESPACES INSECABLES (2026-10-13) : le formulaire
// lie un nombre a son unite (« 54 € », « 6 joueurs / piste ») pour qu un
// telephone ne les coupe plus. Ce gate asserte les montants, les nombres et
// les phrases, pas l espace qui les tient ensemble.
const sansInsecable = (texte) => (texte === null || texte === undefined ? texte : String(texte).replace(/[\u00a0\u202f]/g, ' '));
function stock(free) {
  mock.occupationDev.length = 0; mock.blocagesDev.clear();
  for (let n = 1; n <= 8 - free; n++) mock.occupationDev.push({ id: 700+n, centerId:'libramont', date:mock.DATE, startTime:'10:00', duration:14, totalDuration:14, lanes:[n], pax:6, status:'confirmed', validationStatus:'confirmed', type:'bowling', opsPlan:null, program:null, name:'Groupe' });
}
async function choose(page, players, duration = 1) {
  await page.goto(`http://127.0.0.1:${PORT}/fungalaxy/libramont?embed=1`, {waitUntil:'networkidle'});
  await page.waitForFunction(() => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour');
  // Le samedi du serveur de dev, pas aujourd hui : le stock synthetique est
  // pose sur mock.DATE, et le jour choisi d office (aujourd hui) n a plus de
  // creneau le soir. Le gate rougissait des 19:45 (suite du 2026-10-08). Hors
  // vacances, ce samedi peut tomber le mois suivant : le calendrier y avance.
  await page.click('#dayBtn');
  for (let k = 0; k < 4 && !(await page.locator(`.fg-cal__day[data-date="${mock.DATE}"]`).count()); k += 1) { await page.click('#calNext'); await page.waitForTimeout(300); }
  await page.locator(`.fg-cal__day[data-date="${mock.DATE}"]`).click();
  await page.click('#dayBtn');
  check(await page.locator(`.fg-cal__day[data-date="${mock.DATE}"]`).getAttribute('aria-selected') === 'true', 'emergency fixture selects its future Saturday');
  await page.fill('#paxInput', '18'); await page.press('#paxInput','Enter'); await page.click('#goActivities');
  await page.click('#gridAct li[data-activity="bowling"] .fg-card');
  const input = page.locator('#gridAct li[data-activity="bowling"] input[type="number"]');
  await input.fill(String(players)); await input.press('Enter');
  if(duration!==1) await page.click(`#gridAct li[data-activity="bowling"] .fg-pill[data-valeur="${duration}"]`);
  const initial = await page.locator('#gridAct li[data-activity="bowling"]').textContent().then(sansInsecable);
  check(initial.includes(`${Math.ceil(players/6)*(duration===2?78:39)} €`), `${players} initially priced with comfort capacity`);
  await page.click('#goHours'); await page.waitForFunction(() => !document.querySelector('#goContact').disabled, null, {timeout:60000});
}
async function finish(page, expected, players, emergency, afterHold) {
  await page.click('#goContact'); await page.waitForSelector('.fg-scene[data-scene="contact"].is-active');
  if(afterHold) afterHold();
  let text = await page.locator('#recallBody').textContent().then(sansInsecable);
  check(text.includes(`${expected} €`) && text.includes(`${players} joueurs`) && text.includes('18 personnes'), 'contact canonical money and subgroup');
  check(/70/.test(text) === emergency, 'contact emergency duration warning only when chosen');
  await page.fill('#cPrenom','QA'); await page.fill('#cNom','Emergency'); await page.fill('#cEmail','qa@pinlane.test'); await page.fill('#cTel','0470000000');
  await page.click('[data-occasion="amis"]'); await page.check('#cConsent'); await page.click('#goRecap');
  await page.waitForSelector('.fg-scene[data-scene="recap"].is-active');
  text = await page.locator('#recap').textContent().then(sansInsecable); check(text.includes(`${expected} €`), 'recap exact selected quote');
  await page.locator('#confirmBtn').evaluate(b=>b.click()); await page.waitForSelector('.fg-scene[data-scene="fin"].is-active');
  text = await page.locator('#finBody').textContent().then(sansInsecable); check(text.includes(`${expected} €`) && /70/.test(text) === emergency, 'receipt exact quote and capacity warning');
  check(mock.dernierePose.body.quotedPrice === expected, 'confirmation explicitly guards displayed amount');
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true}); const server=mock.createServer({port:PORT});
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.E2E_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const errors=[];
  try {
    for (const width of [1440,390,320]) {
      for (const [players,free,price,emergency,duration=1] of [[7,1,39,true],[13,2,78,true],[7,2,78,false],[7,1,78,true,2]]) {
        stock(free); const page=await browser.newPage({viewport:{width,height:900}}); page.on('pageerror',e=>errors.push(e.message));
        await choose(page,players,duration);
        const visit=await page.locator('.fg-visit').textContent().then(sansInsecable);
        check(visit.includes(`${price} €`), `[${width}] ${players}/${free} quote uses actual stock`);
        if(emergency) check(/70/.test(visit) && /10 min/.test(visit), 'chosen emergency allocation explains duration');
        if(players===13) check(visit.includes('6 + 7'), 'thirteen own participants explicitly split six plus seven');
        await page.waitForTimeout(500);
        const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('.fg-scene.is-active .fg-track, .fg-scene.is-active .fg-visit')].map(e=>({kind:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}));
        check(geometry.wide.every(e=>e.left>=-1&&e.right<=width+1), `[${width}] emergency detail stays inside viewport ${JSON.stringify(geometry)}`);
        check(/partie complète n’est pas garantie/.test(visit) === (emergency && duration===1), 'speed warning matches chosen duration');
        await page.screenshot({path:path.join(OUT,`emergency-${width}-${players}-${free}-${duration}h.png`),fullPage:true});
        await finish(page,price,players,emergency); await page.close();
      }
    }
    stock(1); const page=await browser.newPage(); await choose(page,7); stock(2);
    await page.click('#goContact'); await page.waitForFunction(()=>!document.querySelector('#hourErr').hidden);
    check(await page.locator('.fg-scene[data-scene="heures"]').evaluate(e=>e.classList.contains('is-active')), 'changed price requires explicit review before contact');
    check((await page.locator('#hourZone').textContent().then(sansInsecable)).includes('78 €'), 'changed price refreshed to canonical comfort quote');
    await finish(page,78,7,false); await page.close();
    stock(1); const heldPage=await browser.newPage(); await choose(heldPage,7);
    await finish(heldPage,39,7,true,()=>{ mock.occupationDev.pop(); });
    check(mock.dernierePose.body.quotedPrice===39, 'held emergency quote remains agreed price when another lane frees'); await heldPage.close();
    check(errors.length===0,'no JavaScript errors: '+errors.join('; ')); console.log(`PASS ${checks} assertions`);
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exit(1);});
