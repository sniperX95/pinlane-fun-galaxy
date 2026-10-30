'use strict';
// Local in-memory centre/holds only. No production database or messages.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');
const { defaults } = require('../lib/arcade-offers');
const PORT = Number(process.env.PINLANE_ARCADE_FORM_PORT || 4696);
const OUT = path.resolve(__dirname, '../tests/artifacts/activity-participants');
const selector = '#gridAct li[data-activity="arcade_time"]';
let checks = 0;
function check(value, label) { assert(value, label); checks++; console.log('OK ' + label); }
// LE TEXTE SE LIT SANS SES ESPACES INSECABLES (2026-10-13) : le formulaire
// lie un nombre a son unite (« 54 € », « 6 joueurs / piste ») pour qu un
// telephone ne les coupe plus. Ce gate asserte les montants, les nombres et
// les phrases, pas l espace qui les tient ensemble.
const sansInsecable = (texte) => (texte === null || texte === undefined ? texte : String(texte).replace(/[\u00a0\u202f]/g, ' '));
async function number(page, root, key, value) {
  const input = page.locator(`${root} [data-compteur="${key}"] input`);
  await input.fill(String(value)); await input.press('Tab');
}
async function mode(page, root, value) { await page.click(`${root} .fg-pill[data-cle="arcadeMode"][data-valeur="${value}"]`); }
async function mounted(page) {
  // Le formulaire se monte sur ses lectures. Une lecture perdue l a laisse une
  // fois sur « Choisir un jour » 30 s durant, sur GitHub : on dit ce qui a echoue
  // et on recharge une fois. Un formulaire qui ne se monte jamais reste rouge.
  const problemes = [];
  const noter = (m) => { if (m.type() === 'error') problemes.push(`${m.text()} ${m.location().url || ''}`.trim()); };
  const perdue = (r) => problemes.push(`${(r.failure() || {}).errorText} ${r.url()}`);
  page.on('console', noter); page.on('requestfailed', perdue);
  for (let essai = 1; ; essai += 1) {
    await page.goto(`http://127.0.0.1:${PORT}/fungalaxy/libramont?embed=1`, { waitUntil: 'domcontentloaded', timeout:60000 });
    const monte = await page.waitForFunction(() => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', null, { timeout:15000 }).then(() => true, () => false);
    if (monte) break;
    const vu = problemes.slice(0, 3).join(' ; ') || 'aucune erreur vue';
    if (essai === 2) throw new Error(`le formulaire ne se monte pas : ${vu}`);
    console.log(`mounted : pas de jour apres 15 s, rechargement (${vu})`);
  }
  page.off('console', noter); page.off('requestfailed', perdue);
  // LE SAMEDI DU MOCK, JAMAIS AUJOURD HUI (2026-10-14) : le formulaire ouvre
  // sur le jour meme ; a 21 h 20 il ne restait plus 60 min d arcades avant la
  // fermeture, « Continuer » restait gris et time-60 attendait 30 s.
  await page.click('#dayBtn');
  for (let k = 0; k < 4 && !(await page.locator(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`).count()); k += 1) {
    await page.click('#calNext'); await page.waitForTimeout(300);
  }
  await page.waitForFunction((d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.waitForFunction(() => document.querySelector('#dayPop').hidden);
  await page.fill('#paxInput', '18'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
  await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
  await page.click(selector + ' .fg-card'); await number(page, selector, 'participants', 3);
}
async function finish(page, expected) {
  const response = page.waitForResponse(r => r.url().includes('/api/public-availability?'));
  await page.click('#goHours');
  const reponse = await response;
  check(new URL(reponse.url()).searchParams.get('date') === mock.DATE, 'MONTAGE hours are asked for the mock Saturday, never today');
  const availability = await reponse.json();
  await page.waitForFunction(() => !document.querySelector('#goContact').disabled);
  const timeline=await page.locator('.fg-scene[data-scene="heures"]').textContent().then(sansInsecable);
  check(!/cadeaux inclus|sans cadeaux|hors jeux permettant|crédits\/jeu|Durée variable/.test(timeline),'timeline keeps arcade choice compact and leaves access details in information popup');
  const item = availability.program.items.find(i => i.activityId === 'arcade_time');
  check(!item.arcadeOffer.description || !timeline.includes(item.arcadeOffer.description),'timeline omits the centre long arcade description');
  check(item.price === expected.price && item.participants === 3 && item.cards === expected.cards, 'server quote uses own players and independent cards');
  check(item.arcadeOffer.id === expected.id && item.arcadeOffer.mode === expected.mode, 'server snapshot preserves chosen offer');
  if (expected.mode === 'credit') check(item.durationEstimated === true && item.arcadeOffer.totalCredits === expected.credits, 'credit duration is only estimate and bonus is credits');
  await page.click('#goContact'); await page.waitForSelector('.fg-scene[data-scene="contact"].is-active');
  await page.fill('#cPrenom', 'QA'); await page.fill('#cNom', 'Arcades'); await page.fill('#cEmail', 'arcades@pinlane.test'); await page.fill('#cTel', '0470000000');
  await page.click('[data-occasion="amis"]'); await page.check('#cConsent'); await page.click('#goRecap');
  await page.waitForSelector('.fg-scene[data-scene="recap"].is-active');
  const recap = await page.locator('#recap').textContent().then(sansInsecable);
  check(recap.includes(`${expected.cards} cartes`) && recap.includes('3 joueurs'), 'recap says both card quantity and player subset');
  check(!/cadeaux inclus|sans cadeaux|hors jeux permettant|crédits\/jeu|Durée variable/.test(recap),'recap does not repeat detailed arcade explanations');
  check(!item.arcadeOffer.description || !recap.includes(item.arcadeOffer.description),'price recap omits the centre long arcade description');
  if (expected.mode === 'credit') check(!/30 min|30 minutes/.test(recap) && /bonus/.test(recap) && !/cadeaux inclus|crédits\/jeu|Durée variable/.test(recap), 'credit recap keeps credits and bonus without detailed access explanations');
  await page.locator('#confirmBtn').evaluate(b => b.click());
  await page.waitForSelector('.fg-scene[data-scene="fin"].is-active');
  const post = mock.dernierePose.body, sent = (post.program.items || post.program).find(i => i.activityId === 'arcade_time');
  check(sent.arcadeMode === expected.mode && sent.arcadeOfferId === expected.id && sent.cards === expected.cards, 'POST carries exact mode, offer and card count');
  check(post.quotedPrice === expected.price, 'POST guards exactly displayed total');
  const receipt = await page.locator('#finBody').textContent().then(sansInsecable);
  check(receipt.includes(`${expected.cards} cartes`) && receipt.includes('3 joueurs'), 'receipt preserves players and card count');
  check(!/cadeaux inclus|sans cadeaux|hors jeux permettant|crédits\/jeu|Durée variable/.test(receipt)&&(!item.arcadeOffer.description||!receipt.includes(item.arcadeOffer.description)),'receipt keeps purchased offer compact without centre access description');
  if (expected.mode === 'credit') check(!/30 min|30 minutes/.test(receipt) && receipt.includes(String(expected.credits)), 'credit receipt preserves total credits and promises no duration');
}
async function informationMatrix(browser, errors) {
  for (const width of [1440,390,320]) {
    const ctx = await browser.newContext({viewport:{width,height:750},reducedMotion:'reduce'}), page = await ctx.newPage();
    page.on('pageerror',e=>errors.push(e.message)); await mounted(page);
    await page.locator('#gridAct .fg-card:not(.is-on)').evaluateAll(nodes=>nodes.forEach(n=>n.click()));
    for (const custom of [false,true]) {
      const grid=custom?'#smGridAct':'#gridAct';
      check(await page.locator(grid+' [data-activity-info]').count()===8,`[${width}] ${custom?'custom':'standard'} all eight information controls`);
      check(!/confort|10 min par joueur|min de règles/.test(await page.locator(grid).textContent().then(sansInsecable)),'long comfort and preparation notes leave activity cards');
      const before=await page.locator(grid).textContent().then(sansInsecable);
      const buttons=page.locator(grid+' [data-activity-info]');
      for (let i=0;i<8;i++) {
        const btn=buttons.nth(i), id=await btn.getAttribute('data-activity-info'), expected=await btn.getAttribute('data-info-text');
        await btn.click();
        check(await page.locator('.fg-info-dialog').evaluate(d=>d.open),'information opens native modal');
        check(await page.locator('.fg-info-text').textContent().then(sansInsecable)===expected,'all precise activity information reaches popup intact');
        check(await page.locator('.fg-info-photo').evaluate(img=>img.complete&&img.naturalWidth>0&&!!img.alt),'actual activity photo loads with useful alternative');
        check(await page.locator('.fg-info-dialog').evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'modal fits both viewport axes');
        check(await btn.evaluate(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44;}),'information control is at least 44px');
        if(id==='bowling') check(/confort/.test(expected)&&/10 min par joueur/.test(expected),'bowling comfort and emergency pace preserved in popup');
        if(id==='laser_game') check(/min de règles/.test(expected),'laser preparation details preserved in popup');
        if(id==='minigolf_blacklight') check(await page.locator('.fg-info-body').evaluate(body=>{body.scrollTop=body.scrollHeight;const rect=body.getBoundingClientRect(),last=body.lastElementChild.getBoundingClientRect();return body.scrollHeight>body.clientHeight&&body.scrollTop>0&&last.bottom<=rect.bottom+2&&last.bottom>=rect.top;}),'long configured description scrolls and its final text stays reachable inside the viewport');
        await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
        check(await page.evaluate(()=>document.querySelector('.fg-info-dialog').contains(document.activeElement)),'keyboard focus stays inside modal');
        if(id==='bowling') await page.screenshot({path:path.join(OUT,`activity-info-${custom?'custom':'standard'}-${width}.png`)});
        await page.keyboard.press('Escape');
        check(await btn.evaluate(b=>document.activeElement===b),'Escape restores information button focus');
      }
      check(await page.locator(grid).textContent().then(sansInsecable)===before,'opening information preserves selection, options, quantities and amount');
      const laser=grid+(custom?' [data-sm-activity="laser_game"]':' li[data-activity="laser_game"]');
      const oldPlayers=await page.locator(laser+' [data-compteur="participants"] input').inputValue();
      await number(page,laser,'participants',3);
      for(const [games,unit,total] of [[2,18,54],[3,25,75]]) {
        await page.click(laser+' .fg-pill[data-cle="games"][data-valeur="'+games+'"]');
        const beforePopup=await page.locator(custom?'#smCount':'#actCount').textContent().then(sansInsecable);
        check((await page.locator(laser+' .fg-card__price').textContent().then(sansInsecable)).includes(total+' €'),'laser selected games determine exact card total '+games);
        await page.click(laser+' [data-activity-info]');
        check((await page.locator('.fg-info-text').textContent().then(sansInsecable)).includes(unit+' € / personne × 3 = '+total+' €'),'laser popup uses selected unit tariff rather than single-game baseline '+games);
        await page.keyboard.press('Escape');
        check(await page.locator(custom?'#smCount':'#actCount').textContent().then(sansInsecable)===beforePopup,'laser popup preserves actual basket total '+games);
      }
      await page.click(laser+' .fg-pill[data-cle="games"][data-valeur="1"]');await number(page,laser,'participants',oldPlayers);
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'information matrix does not create horizontal overflow');
      await buttons.first().click();await page.click('.fg-info-close');
      check(!await page.locator('.fg-info-dialog').evaluate(d=>d.open),'close cross dismisses popup');
      await buttons.first().click();await page.mouse.click(1,1);
      check(!await page.locator('.fg-info-dialog').evaluate(d=>d.open),'backdrop dismisses popup');
      if(!custom) {
        await page.click('.fg-scene[data-scene="activites"] [data-back]');await page.fill('#paxInput','31');await page.press('#paxInput','Enter');await page.click('#goActivities');
        await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');await page.click('.fg-occasion[data-type="amis"]');await page.click('#smGoDate');await page.check('#smFlexible');await page.fill('#smPeriod','Vacances');await page.click('.fg-sm-moment[data-moment="indifferent"]');await page.click('#smGoEnvies');
      } else {
        await page.click('.fg-scene[data-scene="sm-envies"] [data-back]');await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
        await page.fill('#smPax','1000');await page.press('#smPax','Tab');await page.click('#smGoDate');await page.click('#smGoEnvies');
        for(const id of ['bowling','duckpin_bowling']) {
          const root='#smGridAct [data-sm-activity="'+id+'"]';await number(page,root,'participants',1000);await page.click(root+' [data-activity-info]');
          const content=await page.locator('.fg-info-text').textContent().then(sansInsecable);
          check(!content.includes('tout le groupe en même temps') && /se relaient/.test(content),'1000 participants never promise simultaneous whole-group access');
          if(id==='bowling') check(/168 pistes/.test(content) && /6[\s\u00a0\u202f]?552/.test(content),'1000 bowling participants retain168 billed lanes and6552EUR');
          else check(/167 pistes/.test(content) && /84 tours/.test(content),'1000 duckpin participants retain167 billed lanes and84 rotations');
          await page.keyboard.press('Escape');
        }
      }
    }
    await ctx.close();
  }
}
async function gemblouxInformation(browser,errors) {
  const ctx=await browser.newContext({viewport:{width:320,height:750},reducedMotion:'reduce'}),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/public-booking-meta?**',async route=>{
    const response=await route.fetch(),json=await response.json();json.center.id='gembloux';json.center.name='Fun Galaxy Gembloux';
    json.activities=json.activities.filter(a=>a.id==='arcade_time');
    json.activities.push({id:'golf_oclock',name:'Golf O’Clock',priceType:'per_pax',priceValue:12.5,unitLabel:'par personne',minPax:1,maxPax:6,note:'12 trous',order:2});
    await route.fulfill({status:200,json});
  });
  await page.goto(`http://127.0.0.1:${PORT}/fungalaxy/gembloux?embed=1`);await page.waitForFunction(()=>document.querySelector('#dayLabel').textContent.trim()!=='Choisir un jour');
  await page.fill('#paxInput','4');await page.press('#paxInput','Enter');await page.click('#goActivities');
  for(const id of ['golf_oclock','arcade_time']) {
    const root='#gridAct li[data-activity="'+id+'"]';await page.click(root+' .fg-card');await number(page,root,'participants',3);
    await page.click(root+' [data-activity-info]');
    check(await page.locator('#fgInfoTitle').textContent().then(sansInsecable)===(id==='golf_oclock'?'Golf O’Clock':'Arcades'),'Gembloux popup preserves actual activity identity');
    const text=await page.locator('.fg-info-text').textContent().then(sansInsecable);check(text.includes('3 joueurs'),'Gembloux popup uses chosen subgroup');
    if(id==='golf_oclock') {
      check(text.includes('12 trous')&&text.includes('12,5 €'),'Gembloux Golf O’Clock preserves exact centre tariff and holes');
      check(await page.locator('.fg-info-photo').evaluate(img=>img.getAttribute('src')==='/assets/fungalaxy/gembloux-golf-salle-800.webp'&&img.complete&&img.naturalWidth>0),'Gembloux Golf O’Clock uses proven Gembloux activity photo');
    } else {
      check(await page.locator('.fg-info-photo').evaluate(img=>img.hidden&&!img.getAttribute('src')),'Gembloux Arcades does not reuse a foreign-centre photo after golf popup');
      check(text.includes('45 €')&&/(?:une|1) carte par personne/i.test(text),'Gembloux Arcades preserves centre price and per-person card rule');
    }
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}
(async () => {
  const activity = mock.ACTIVITIES.find(a => a.id === 'arcade_time');
  const golf=mock.ACTIVITIES.find(a=>a.id==='minigolf_blacklight'), golfDescription=golf.description;
  golf.description='Description du parcours configurée par le centre. '.repeat(20);
  activity.arcadeOffers = defaults();
  const server = mock.createServer(); await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  fs.mkdirSync(OUT, { recursive: true });
  const errors = [];
  try {
    await informationMatrix(browser,errors);
    await gemblouxInformation(browser,errors);
    if(process.env.PINLANE_ACTIVITY_INFO_ONLY) { check(errors.length===0,'information UI has no JavaScript errors'); console.log(`activity-info: ALL OK (${checks} assertions)`); return; }
    const cases = [{ mode:'time',id:'time-30',cards:3,price:45 },{ mode:'time',id:'time-60',cards:3,price:90 },
      {mode:'credit',id:'credit-10',cards:2,price:20,credits:10},{mode:'credit',id:'credit-25',cards:2,price:50,credits:35},
      {mode:'credit',id:'credit-35',cards:2,price:70,credits:50},{mode:'credit',id:'credit-50',cards:2,price:100,credits:75}];
    for (const width of process.env.PINLANE_ARCADE_CANONICAL_ONLY ? [] : [1440,390,320]) {
      for (const c of cases) {
        const ctx = await browser.newContext({ viewport:{width,height:900},reducedMotion:'reduce' }); const page = await ctx.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await mounted(page);
        if(c.mode === 'credit') { await mode(page,selector,'credit'); await page.selectOption(selector+' select',c.id); await number(page,selector,'cards',2); }
        else await page.click(`${selector} .fg-pill[data-cle="arcadeOfferId"][data-valeur="${c.id}"]`);
        const text = await page.locator(selector+' .fg-card__price').textContent().then(sansInsecable);
        check(await page.locator(selector+' .fg-pill[data-cle="arcadeMode"][data-valeur="time"] small').textContent().then(sansInsecable)==='Sans cadeaux',`[${width}] ${c.id} timed mode never promises unlimited time`);
        check(text.includes(String(c.price)) && text.includes(`${c.cards} cartes`), `[${width}] ${c.id} own total and card quantity`);
        check(await page.locator(selector+' [data-compteur="cards"]').count() === (c.mode==='credit'?1:0), `[${width}] ${c.id} timed cards cannot be altered`);
        await page.click(selector+' [data-activity-info]');
        const information=await page.locator('.fg-info-text').textContent().then(sansInsecable);
        check(information.includes(`${c.cards} cartes`) && information.includes('3 joueurs') && (c.mode==='time'?/illimité/.test(information)&&/(?:sans|hors)[^.]{0,60}cadeaux/.test(information):information.includes(`${c.credits} crédits`) && /cadeaux inclus/.test(information) && /1,2 à 2,4/.test(information)),`[${width}] ${c.id} popup preserves counts, credits and exact access rights`);
        await page.keyboard.press('Escape');
        const targets = await page.locator(selector+' .fg-stepper>*,'+selector+' .fg-pill,'+selector+' select').evaluateAll(nodes => nodes.filter(n=>n.getBoundingClientRect().height>0).map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)})));
        check(targets.every(x=>x.w>=44 && x.h>=44 && x.font>=12), `[${width}] ${c.id} keyboard/touch targets >=44px and text >=12px`);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `[${width}] ${c.id} no overflow`);
        if(c.id==='credit-25') await page.screenshot({path:path.join(OUT,`arcades-credit-${width}.png`),fullPage:true});
        if(c.id==='time-30') await page.screenshot({path:path.join(OUT,`arcades-time-${width}.png`),fullPage:true});
        if(width===1440 || c.id==='credit-25') await finish(page,c);
        await ctx.close(); mock.blocagesDev.clear();
      }
      const ctx = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}); const page=await ctx.newPage();
      page.on('pageerror', e=>errors.push(e.message)); await mounted(page);
      await mode(page,selector,'credit');
      check(await page.locator(selector+' [data-compteur="cards"] input').inputValue()==='3','untouched credit card count follows own players');
      await number(page,selector,'participants',5);
      check(await page.locator(selector+' [data-compteur="cards"] input').inputValue()==='5','untouched credit card default grows with subgroup');
      await number(page,selector,'cards',9);await page.selectOption(selector+' select','credit-35');
      await mode(page,selector,'time'); await page.click(selector+' .fg-pill[data-valeur="time-60"]'); await mode(page,selector,'credit');
      check(await page.locator(selector+' select').inputValue()==='credit-35' && await page.locator(selector+' [data-compteur="cards"] input').inputValue()==='9','mode toggling retains credit offer and explicit cards');
      await mode(page,selector,'time');check(await page.locator(selector+' .fg-pill[data-valeur="time-60"]').getAttribute('aria-checked')==='true','mode toggling retains timed offer');await mode(page,selector,'credit');
      await page.click('.fg-scene[data-scene="activites"] [data-back]'); await page.fill('#paxInput','2');await page.press('#paxInput','Enter');await page.click('#goActivities');
      check(await page.locator(selector+' [data-compteur="participants"] input').inputValue()==='2' && await page.locator(selector+' [data-compteur="cards"] input').inputValue()==='9','group shrink clamps players but preserves explicit cards');
      await page.click('.fg-scene[data-scene="activites"] [data-back]');await page.fill('#paxInput','31');await page.press('#paxInput','Enter');await page.click('#goActivities');
      await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active'); await page.click('.fg-occasion[data-type="amis"]');await page.click('#smGoDate');await page.check('#smFlexible');await page.fill('#smPeriod','Prochaines vacances');await page.click('.fg-sm-moment[data-moment="indifferent"]');await page.click('#smGoEnvies');
      await page.waitForSelector('.fg-scene[data-scene="sm-envies"].is-active');const sm='#smGridAct [data-sm-activity="arcade_time"]';
      check(await page.locator(sm+' .fg-pill[data-cle="arcadeMode"][data-valeur="time"] small').textContent().then(sansInsecable)==='Sans cadeaux',`[${width}] custom timed mode says exact excluded prize games`);
      check(await page.locator(sm+' select').inputValue()==='credit-35' && await page.locator(sm+' [data-compteur="cards"] input').inputValue()==='9','custom form imports credit offer and independent cards');
      await mode(page,sm,'time'); await page.click(sm+' .fg-pill[data-valeur="time-30"]'); await mode(page,sm,'credit');
      check(await page.locator(sm+' select').inputValue()==='credit-35','custom string option modes preserve remembered offer');
      await page.selectOption(sm+' select','credit-50');await number(page,sm,'cards',4);
      check((await page.locator(sm+' .fg-card__price').textContent().then(sansInsecable)).includes('200') && (await page.locator('#smCount').textContent().then(sansInsecable)).includes('200'),'custom subtotal uses card count rather than players');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'custom arcade choices no horizontal overflow');
      await page.screenshot({path:path.join(OUT,`arcades-custom-${width}.png`),fullPage:true});
      await page.click('#smGoContact');
      for(const [id,value] of [['smPrenom','QA'],['smNom','Arcades'],['smEmail','arcades@pinlane.test'],['smTel','0470000000']]) await page.fill('#'+id,value);
      await page.check('#smConsent');await page.click('#smGoRecap');await page.waitForSelector('.fg-scene[data-scene="sm-recap"].is-active');
      const customRecap=await page.locator('.fg-scene[data-scene="sm-recap"]').textContent().then(sansInsecable);
      check(customRecap.includes('4 cartes') && customRecap.includes('25 bonus') && !/30 min/.test(customRecap),'custom recap states bought cards and credits without estimated duration');
      check(!/cadeaux inclus|sans cadeaux|hors jeux permettant|crédits\/jeu|Durée variable|Le temps de jeu dépend des machines/.test(customRecap),'custom recap leaves detailed arcade access rules in the information popup');
      await page.click('#smSend');await page.waitForSelector('.fg-scene[data-scene="fin"].is-active');
      const saved=mock.dernierePose.demande.payload.demande.activities.find(i=>i.id==='arcade_time');
      check(saved.arcadeMode==='credit' && saved.arcadeOfferId==='credit-50' && saved.cards===4 && saved.participants===2,'actual custom API preserves string choice, card count and subset');
      check((await page.locator('#finBody').textContent().then(sansInsecable)).includes('4 cartes'),'custom receipt spells out independent cards');
      await ctx.close();mock.blocagesDev.clear();
    }
    // Server-authoritative refresh: meta stays stale, response says the new deal.
    // Independent visitor scenario: preserve the real per-IP limiter, while
    // isolating this quote test from the preceding offer matrix's request quota.
    const ctx=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':'192.0.2.250'}}), page=await ctx.newPage();
    page.on('pageerror',e=>errors.push(e.message));await mounted(page);await mode(page,selector,'credit');await page.selectOption(selector+' select','credit-25');await number(page,selector,'cards',2);
    const canonicalAvailability=page.waitForResponse(r=>r.url().includes('/api/public-availability?'));
    await page.click('#goHours');
    const canonicalResponse=await canonicalAvailability;
    check(canonicalResponse.status()===200,'canonical refresh scenario receives successful availability: '+JSON.stringify(await canonicalResponse.json()));
    await page.waitForFunction(()=>!document.querySelector('#goContact').disabled);
    let changed=false;
    await page.route('**/api/public-holds',async route=>{
      const body=route.request().postDataJSON();
      if(body.release || changed) return route.continue();
      changed=true;const response=await route.fetch(),json=await response.json();
      const ar=json.program.items.find(i=>i.activityId==='arcade_time');
      ar.arcadeOffer.price=26.35;ar.arcadeOffer.bonusCredits=12;ar.arcadeOffer.totalCredits=37;ar.arcadeOffer.gameCostMin=1.5;ar.arcadeOffer.gameCostMax=2.5;ar.arcadeOffer.description='Description corrigée par le centre';ar.price=52.7;json.price=52.7;json.program.price=52.7;
      if(json.program.freeItems) json.program.freeItems=json.program.freeItems.map(i=>i.activityId==='arcade_time'?ar:i);
      await route.fulfill({status:409,json:{...json,ok:false,code:'price_changed'}});
    });
    await page.click('#goContact');await page.waitForFunction(()=>document.querySelector('#hourErr')?.textContent.includes('Le montant a changé'));
    check(await page.locator('.fg-scene[data-scene="heures"].is-active').count()===1,'price_changed requires review and explicit retry before contact');
    check((await page.locator('#hourSum').textContent().then(sansInsecable)).includes('52,7'),'canonical price_changed replaces stale visit total');
    await page.click('.fg-scene[data-scene="heures"] [data-back]');await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
    check((await page.locator(selector+' .fg-card__price').textContent().then(sansInsecable)).includes('52,7'),'return to activity shows canonical total despite stale meta');
    await page.click(selector+' [data-activity-info]');
    const canonicalOption = await page.locator(selector+' select option:checked').textContent().then(sansInsecable);
    const canonicalPopup = await page.locator('.fg-info-text').textContent().then(sansInsecable);
    const canonicalDataset = await page.locator(selector+' [data-activity-info]').evaluate(button => ({ text: button.dataset.infoText, sections: JSON.parse(button.dataset.infoSections || 'null') }));
    console.log(JSON.stringify({ canonicalOption, canonicalPopup, canonicalDataset }));
    check(canonicalOption.includes('26,35'),'canonical unit price 26,35 replaces the stale selected card price');
    check(canonicalOption.includes('12 bonus'),'canonical bonus 12 replaces the stale selected card bonus');
    check(canonicalPopup.includes('1,5 à 2,5'),'canonical machine costs 1,5 to 2,5 replace stale popup details');
    check(canonicalPopup.includes('Description corrigée par le centre'),'canonical centre description replaces stale popup details');
    check(canonicalDataset.text.includes('1,5 à 2,5') && canonicalDataset.text.includes('Description corrigée par le centre')
      && Array.isArray(canonicalDataset.sections) && JSON.stringify(canonicalDataset.sections).includes('Description corrigée par le centre'),
      'canonical footer text and structured sections stay connected to the popup snapshot');
    await page.keyboard.press('Escape');
    await number(page,selector,'cards',3);
    check((await page.locator(selector+' .fg-card__price').textContent().then(sansInsecable)).includes('79,05'),'card quantity recalculates canonical cents without stale price');
    await ctx.close();mock.blocagesDev.clear();
    activity.arcadeOffers.timeOffers[0].price=0;
    const freeCtx=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':'192.0.2.251'}}), free=await freeCtx.newPage();
    await mounted(free);
    check((await free.locator(selector+' .fg-card__price').textContent().then(sansInsecable)).includes('0 €') && !(await free.locator(selector).textContent().then(sansInsecable)).includes('Prix à l’accueil'),'explicit zero-price offer is known and free rather than unknown');
    await free.click('.fg-scene[data-scene="activites"] [data-back]');await free.fill('#paxInput','31');await free.press('#paxInput','Enter');await free.click('#goActivities');
    await free.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');await free.click('.fg-occasion[data-type="amis"]');await free.click('#smGoDate');await free.check('#smFlexible');await free.fill('#smPeriod','Vacances');await free.click('.fg-sm-moment[data-moment="indifferent"]');await free.click('#smGoEnvies');
    check((await free.locator('#smCount').textContent().then(sansInsecable)).includes('0 €') && !(await free.locator('#smCount').textContent().then(sansInsecable)).includes('prix à l’accueil'),'custom zero estimate is explicitly known');
    await freeCtx.close();activity.arcadeOffers.timeOffers[0].price=15;
    check(errors.length===0,'no page JavaScript errors throughout offer matrix');
    console.log(`arcade-offers-form-check: ALL OK (${checks} assertions)`);
  } finally { await browser.close();server.close();delete activity.arcadeOffers; golf.description=golfDescription; }
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
