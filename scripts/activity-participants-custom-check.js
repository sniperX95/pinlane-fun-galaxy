'use strict';
// Real lazy custom form and real local API; synthetic contact, no real writes/sends.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');
const PORT = Number(process.env.PINLANE_CUSTOM_PARTICIPANTS_PORT || 4686);
const OUTPUT = path.resolve(__dirname, '../tests/artifacts/activity-participants');
const BROWSER = process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const COUNTS = { bowling: 7, laser_game: 3, minigolf_blacklight: 4, billards: 5,
  arcade_time: 2, playground: 6, duckpin_bowling: 13, fun_run: 8 };
let checks = 0;
function check(cond, message) { checks++; assert.ok(cond, message); console.log('OK ' + message); }
const card = id => `#smGridAct [data-sm-activity="${id}"]`;
const input = id => `${card(id)} [data-compteur="participants"] input`;
async function main() {
  const server = mock.createServer({ port: PORT });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER });
  fs.mkdirSync(OUTPUT, { recursive: true });
  try {
    const source = fs.readFileSync(path.resolve(__dirname, '../assets/fungalaxy-booking.js'), 'utf8');
    const sessions = { Math, Number, joueursDe: () => 240 };
    vm.createContext(sessions);
    vm.runInContext(source.slice(source.indexOf('  function sessionsPour(a)'), source.indexOf('  // Le groupe reste le nombre de visiteurs')), sessions);
    check(sessions.sessionsPour({ capacityPerUnit: 5, units: 1 }) === 48, 'normal240 players require48 Fun Run sessions');
    const bowlingPricing = { Math, Number, state: { onglet: 'activites' },
      meta: { center: { booking: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 } } },
      activite: () => ({ id: 'bowling' }), joueursDe: () => 100 };
    vm.createContext(bowlingPricing);
    vm.runInContext(source.slice(source.indexOf('  function pistesBowling()'), source.indexOf('  // LE CALCUL DES PISTES')), bowlingPricing);
    check(bowlingPricing.pistesBowling().pistes === 18, 'normal100 bowling players bill18 lanes across three balanced services');
    bowlingPricing.joueursDe = () => 1000;
    check(bowlingPricing.pistesBowling().pistes === 168, 'custom1000 bowling players bill168 lanes across21 balanced services');
    for (const width of [1440, 390, 375, 320]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage(); const errors = []; let posted;
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && r.url().includes('custom-request')) posted = r.postDataJSON(); });
      await page.goto(`http://127.0.0.1:${PORT}/fungalaxy/libramont?embed=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour');
      await page.fill('#paxInput', '18'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
      await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
      for (const [id, count] of Object.entries(COUNTS)) {
        const normal = `#gridAct [data-activity="${id}"]`;
        await page.locator(normal + ' .fg-card').click();
        await page.locator(normal + ' [data-compteur="participants"] input').fill(String(count));
        await page.locator(normal + ' [data-compteur="participants"] input').press('Tab');
      }
      await page.click('#gridAct [data-activity="bowling"] .fg-card');
      await page.click('#gridAct [data-activity="bowling"] .fg-pill[data-valeur="2"]');
      await page.click('#gridAct [data-activity="laser_game"] .fg-card');
      await page.click('#gridAct [data-activity="laser_game"] .fg-pill[data-valeur="2"]');
      await page.click('#gridAct [data-activity="billards"] .fg-card');
      await page.click('#gridAct [data-activity="billards"] [data-compteur="units"] [data-pas="1"]');
      await page.click('#gridAct [data-activity="billards"] .fg-pill[data-valeur="2"]');
      await page.click('#gridAct [data-activity="fun_run"] .fg-card');
      await page.click('#gridAct [data-activity="fun_run"] .fg-pill[data-valeur="15"]');
      const normalOptions = await page.locator('#gridAct .fg-pill').evaluateAll(nodes => nodes.map(n => ({ id: n.closest('[data-activity]').dataset.activity, key: n.dataset.cle, val: n.dataset.valeur })));
      await page.click('.fg-scene[data-scene="activites"] [data-back]');
      await page.fill('#paxInput', '31'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
      await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');
      await page.click('.fg-occasion[data-type="amis"]'); await page.click('#smGoDate');
      await page.check('#smFlexible'); await page.fill('#smPeriod', 'Prochaines vacances'); await page.click('.fg-sm-moment[data-moment="indifferent"]'); await page.click('#smGoEnvies');
      await page.waitForSelector('.fg-scene[data-scene="sm-envies"].is-active');
      for (const [id, count] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(count), `[${width}] ${id} imported subset`);
      const customOptions = await page.locator('#smGridAct .fg-pill').evaluateAll(nodes => nodes.map(n => ({ id: n.closest('[data-sm-activity]').dataset.smActivity, key: n.dataset.cle, val: n.dataset.valeur })));
      const canonicalOptions = xs => xs.map(x => JSON.stringify(x)).sort();
      check(JSON.stringify(canonicalOptions(customOptions)) === JSON.stringify(canonicalOptions(normalOptions)), `[${width}] exact same catalogue option choices as normal form`);
      for (const [id, key, value] of [['bowling', 'duration', '2'], ['laser_game', 'games', '2'], ['billards', 'hours', '2'], ['fun_run', 'minutes', '15']]) {
        check(await page.locator(`${card(id)} .fg-pill[data-cle="${key}"][data-valeur="${value}"]`).getAttribute('aria-checked') === 'true', `[${width}] imported ${id} ${key}`);
      }
      check(await page.locator(`${card('billards')} [data-compteur="units"] output`).textContent() === '2', `[${width}] imported two billard tables`);
      await page.locator(`${card('fun_run')} .fg-card`).click();
      await page.locator(input('fun_run')).fill('31'); await page.locator(input('fun_run')).press('Tab');
      check(/7 sessions/.test(await page.locator(`${card('fun_run')} .fg-card__rot`).textContent()), `[${width}] 31 Fun Run players rotate seven sessions`);
      await page.locator(input('fun_run')).fill('8'); await page.locator(input('fun_run')).press('Tab');
      await page.locator(`${card('bowling')} .fg-card`).click();
      await page.locator(input('bowling')).fill(''); await page.locator(input('bowling')).press('Tab');
      check(await page.locator(input('bowling')).inputValue() === '7', `[${width}] blank input restores prior subset`);
      await page.locator(`${card('bowling')} .fg-pill[data-valeur="1"]`).focus(); await page.keyboard.press('ArrowRight');
      check(await page.locator(input('bowling')).inputValue() === '7', `[${width}] option keyboard preserves count`);
      await page.locator(`${card('bowling')} .fg-pill[data-valeur="2"]`).click();
      const bounds = [];
      for (const id of Object.keys(COUNTS)) { await page.locator(`${card(id)} .fg-card`).click(); bounds.push(...await page.locator('#smGridAct .fg-activity-editor .fg-stepper').evaluateAll(nodes => nodes.flatMap(n => [...n.children].map(c => ({ width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height }))))); }
      check(bounds.every(b => b.width >= 44 && b.height >= 44), `[${width}] every counter target at least 44px`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `[${width}] no horizontal overflow`);
      await page.screenshot({ path: path.join(OUTPUT, `custom-activities-${width}.png`), fullPage: true });
      await page.click('.fg-scene[data-scene="sm-envies"] [data-back]');
      await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
      await page.fill('#smPax', '4'); await page.press('#smPax', 'Tab'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
      for (const [id, count] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(Math.min(count, 4)), `[${width}] group shrink clamps ${id}`);
      await page.click('.fg-scene[data-scene="sm-envies"] [data-back]'); await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
      await page.fill('#smPax', '31'); await page.press('#smPax', 'Tab'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
      for (const [id, count] of Object.entries(COUNTS)) {
        check(await page.locator(input(id)).inputValue() === String(Math.min(count, 4)), `[${width}] growth preserves explicit subset ${id}`);
        await page.locator(`${card(id)} .fg-card`).click();
        await page.locator(input(id)).fill(String(count)); await page.locator(input(id)).press('Tab');
      }
      check(await page.locator('#gridAct [data-activity="bowling"] input').inputValue() === '7', `[${width}] custom context preserves normal form options`);
      check((await page.locator('#smCount').textContent()).includes('539 €') && /sans Arcades/.test(await page.locator('#smCount').textContent()), `[${width}] known subtotal539 excludes unknown arcades`);
      if (width === 1440) {
        await page.click('.fg-scene[data-scene="sm-envies"] [data-back]'); await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
        await page.fill('#smPax', '1000'); await page.press('#smPax', 'Tab'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
        for (const id of ['bowling', 'fun_run', 'duckpin_bowling']) { await page.locator(`${card(id)} .fg-card`).click(); await page.locator(input(id)).fill('1000'); await page.locator(input(id)).press('Tab'); }
        await page.locator(`${card('bowling')} .fg-card`).click();
        await page.locator(`${card('bowling')} .fg-pill[data-valeur="1"]`).click();
        const bowlingNote = await page.locator(`${card('bowling')} .fg-card__rot`).textContent();
        check(/168 pistes/.test(bowlingNote) && /6[\s\u00a0\u202f]?552/.test(bowlingNote), '1000 bowling players use balanced168 lanes for6552EUR');
        check(/200 sessions/.test(await page.locator(`${card('fun_run')} .fg-card__rot`).textContent()), '1000 players require200 real Fun Run sessions');
        await page.click(`${card('duckpin_bowling')} [data-activity-info]`);
        const duckpin = await page.locator('.fg-info-text').textContent();
        check(/167 pistes/.test(duckpin) && /84 tours/.test(duckpin), '1000 duckpin players require167 paid lanes across84 real tours');
        await page.keyboard.press('Escape');
        await page.click('.fg-scene[data-scene="sm-envies"] [data-back]'); await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
        await page.fill('#smPax', '31'); await page.press('#smPax', 'Tab'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
        for (const id of ['bowling', 'fun_run', 'duckpin_bowling']) { await page.locator(`${card(id)} .fg-card`).click(); await page.locator(input(id)).fill(String(COUNTS[id])); await page.locator(input(id)).press('Tab'); }
        await page.locator(`${card('bowling')} .fg-card`).click();
        await page.locator(`${card('bowling')} .fg-pill[data-valeur="2"]`).click();
      }
      await page.click('#smTabFor'); await page.click('#smTabAct');
      check(await page.locator(input('duckpin_bowling')).inputValue() === '13', `[${width}] tab changes preserve activity options`);
      await page.click('#smGoContact');
      for (const [id, value] of [['smPrenom', 'QA'], ['smNom', 'Custom players'], ['smEmail', 'qa@pinlane.test'], ['smTel', '0470000000']]) await page.fill('#' + id, value);
      await page.check('#smConsent'); await page.click('#smGoRecap');
      await page.waitForSelector('.fg-scene[data-scene="sm-recap"].is-active');
      const recap = await page.locator('.fg-scene[data-scene="sm-recap"]').textContent();
      check(recap.includes('Bowling (7 joueurs') && recap.includes('Billards (5 joueurs · 2 tables · 2 heures)'), `[${width}] recap describes counts and option details`);
      check(recap.includes('539 €') && /sans Arcades.*prix à l’accueil/.test(recap), `[${width}] recap honest activity estimate`);
      await page.click('#smSend'); await page.waitForSelector('.fg-scene[data-scene="fin"].is-active');
      const receipt = await page.locator('#finBody').textContent();
      check(receipt.includes('Bowling (7 joueurs · 2 heures) : 156 €') && receipt.includes('539 €'), `[${width}] final custom receipt retains selected options and estimates`);
      check(/Arcades \(2 joueurs\) : prix à l’accueil/.test(receipt), `[${width}] final custom receipt makes unknown price explicit`);
      check(posted && posted.details.participants === 31, `[${width}] POST retains custom group size`);
      for (const [id, count] of Object.entries(COUNTS)) check(posted.details.activities.find(a => a.id === id).participants === count, `[${width}] POST ${id} count`);
      const bowling = posted.details.activities.find(a => a.id === 'bowling');
      const billiards = posted.details.activities.find(a => a.id === 'billards');
      check(bowling.duration === 2 && billiards.units === 2 && billiards.hours === 2, `[${width}] POST carries full selected options`);
      const stored = mock.dernierePose.demande.payload.demande.activities;
      check(stored.find(a => a.id === 'bowling').duration === 2 && stored.find(a => a.id === 'billards').units === 2, `[${width}] actual API storage preserves selected options`);
      for (const [id, count] of Object.entries(COUNTS)) check(stored.find(a => a.id === id).participants === count, `[${width}] storage ${id} count`);
      check(errors.length === 0, `[${width}] no browser errors: ${errors.join('; ')}`);
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/fungalaxy/libramont?embed=1`, { waitUntil: 'networkidle' });
    await page.fill('#paxInput', '31'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');
    await page.click('.fg-occasion[data-type="amis"]'); await page.click('#smGoDate');
    await page.check('#smFlexible'); await page.fill('#smPeriod', 'Vacances'); await page.click('.fg-sm-moment[data-moment="indifferent"]'); await page.click('#smGoEnvies');
    await page.locator(`${card('minigolf_blacklight')} .fg-card`).click();
    check(await page.locator(input('minigolf_blacklight')).inputValue() === '31', 'untouched custom activity starts with full group');
    await page.click('.fg-scene[data-scene="sm-envies"] [data-back]'); await page.click('.fg-scene[data-scene="sm-date"] [data-back]');
    await page.fill('#smPax', '40'); await page.press('#smPax', 'Tab'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
    check(await page.locator(input('minigolf_blacklight')).inputValue() === '40', 'untouched custom activity follows group increase');
    for (const scene of ['sm-envies', 'sm-date', 'sm-groupe']) await page.click(`.fg-scene[data-scene="${scene}"] [data-back]`);
    await page.fill('#paxInput', '18'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.locator('#gridAct [data-activity="bowling"] .fg-card').click();
    await page.locator('#gridAct [data-activity="bowling"] input').fill('7'); await page.locator('#gridAct [data-activity="bowling"] input').press('Tab');
    await page.click('#gridAct [data-activity="bowling"] .fg-pill[data-valeur="2"]');
    await page.click('.fg-scene[data-scene="activites"] [data-back]'); await page.fill('#paxInput', '31'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
    check(await page.locator(input('bowling')).inputValue() === '7' && await page.locator(`${card('bowling')} .fg-pill[data-valeur="2"]`).getAttribute('aria-checked') === 'true', 'reopened custom form imports updated base basket with full options');
    check(await page.locator(`${card('minigolf_blacklight')}.is-on`).count() === 0, 'updated base selection replaces stale imported activity');
    await page.locator(input('bowling')).fill('6'); await page.locator(input('bowling')).press('Tab');
    for (const scene of ['sm-envies', 'sm-date', 'sm-groupe']) await page.click(`.fg-scene[data-scene="${scene}"] [data-back]`);
    await page.click('#goActivities'); await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
    check(await page.locator(input('bowling')).inputValue() === '6', 'reopening unchanged base basket preserves custom edits');
    await page.locator(`${card('bowling')} .fg-card-select`).click(); await page.locator(`${card('arcade_time')} .fg-card`).click();
    const unknownOnly = await page.locator('#smCount').textContent();
    check(/Prix des activités à l’accueil : Arcades/.test(unknownOnly) && !unknownOnly.includes('0 €'), 'unknown-only activity selection never presented as zero/free');
    for (const scene of ['sm-envies', 'sm-date', 'sm-groupe']) await page.click(`.fg-scene[data-scene="${scene}"] [data-back]`);
    await page.fill('#paxInput', '41'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active');
    check(await page.inputValue('#smPax') === '41', 'base group change replaces prior custom group override');
    await page.click('#smGoDate'); await page.click('#smGoEnvies');
    for (const scene of ['sm-envies', 'sm-date', 'sm-groupe']) await page.click(`.fg-scene[data-scene="${scene}"] [data-back]`);
    const future = mock.metaPayload('', 90).center.calendar.find(day => day.open && day.date > mock.DATE).date;
    await page.click('#dayBtn'); await page.locator(`.fg-cal__day[data-date="${future}"]`).click(); await page.click('#goActivities');
    await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active'); await page.click('#smGoDate');
    check(!(await page.isChecked('#smFlexible')) && (await page.locator('#smDateLabel').textContent()).trim() !== 'Choisir un jour', 'base date change replaces prior custom flexible-date override');
    await page.click('#smGoEnvies');
    for (const scene of ['sm-envies', 'sm-date', 'sm-groupe']) await page.click(`.fg-scene[data-scene="${scene}"] [data-back]`);
    await page.fill('#paxInput', '18'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.click('#tabFor'); const formula = page.locator('#gridFor .fg-card:not(.is-refus):not(.is-off)').first();
    const formulaId = await formula.getAttribute('data-formule'); await formula.click();
    await page.click('.fg-scene[data-scene="activites"] [data-back]'); await page.fill('#paxInput', '31'); await page.press('#paxInput', 'Enter'); await page.click('#goActivities');
    await page.waitForSelector('.fg-scene[data-scene="sm-groupe"].is-active'); await page.click('#smGoDate'); await page.click('#smGoEnvies');
    check(await page.locator(`#smGridFor .fg-card[data-sm="${formulaId}"]`).getAttribute('aria-checked') === 'true', 'normal selected formula imported unchanged');
    await page.locator(`${card('bowling')} .fg-card`).click(); await page.locator(input('bowling')).fill('7'); await page.locator(input('bowling')).press('Tab');
    await page.locator(`${card('bowling')} .fg-pill[data-valeur="1"]`).click();
    check(/2 pistes/.test(await page.locator(`${card('bowling')} .fg-card__rot`).textContent()) && (await page.locator('#smCount').textContent()).includes('78 €'), 'custom subset bowling uses seven players even when normal form remains in formula mode');
    await ctx.close();
    console.log(`PASS ${checks} custom participant assertions`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
