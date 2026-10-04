// Independent participant regression gate: real form, real local availability
// engine, synthetic contact only. No database writes or outgoing messages.
// node scripts/activity-participants-form-check.js
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright-core');
// The local server displays explicit mock tariffs; hydrate the engine with
// those same synthetic centre tariffs before it captures catalog references.
// Production tariffs intentionally remain untouched and may be unknown.
const catalog = require('../lib/activity-catalog');
const originalCatalog = catalog.listCenterActivities;
const fixtureTariffs = { minigolf_blacklight: 10, playground: 12, billards: 10 };
catalog.listCenterActivities = function participantFixture(centerId) {
  return originalCatalog(centerId).map(a => Object.hasOwn(fixtureTariffs, a.id)
    ? { ...a, priceValue: fixtureTariffs[a.id] } : a);
};
const mock = require('./dev-tunnel-server');
const { normalizeProgram } = require('../lib/visit-program');
const { normalizeReservationRequest } = require('../lib/reservation-request');
const { getCenter } = require('../lib/ops-knowledge');
const PORT = Number(process.env.PINLANE_PARTICIPANTS_PORT || 4679);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER = process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUTPUT = path.resolve(__dirname, '../tests/artifacts/activity-participants');
// Expectations calculated independently from the fixture business rules:
// 7 bowl -> 2 lanes; 3 laser x 18; 4 golf x 10; 2 tables x 2h x 10;
// 6 playground x 12; 13 duckpin -> 3 lane-hours over 2 tours;
// 8 funrun -> 2 fifteen-minute sessions x 30. Arcades unknown.
const COUNTS = { bowling: 7, laser_game: 3, minigolf_blacklight: 4,
  billards: 5, arcade_time: 2, playground: 6, duckpin_bowling: 13, fun_run: 8 };
const EXPECTED_PRICES = { bowling: 78, laser_game: 54, minigolf_blacklight: 40,
  billards: 40, playground: 72, duckpin_bowling: 117, fun_run: 60 };
const TOTAL = 461;
const LINES = Object.entries(COUNTS).map(([activityId, participants]) => ({ activityId, participants,
  ...(activityId === 'bowling' || activityId === 'duckpin_bowling' ? { duration: 1 } : {}),
  ...(activityId === 'laser_game' ? { games: 2 } : {}),
  ...(activityId === 'billards' ? { units: 2, hours: 2 } : {}),
  ...(activityId === 'fun_run' ? { minutes: 15 } : {}) }));
let checks = 0;
function check(condition, message, detail) {
  checks += 1;
  assert.ok(condition, message + (detail === undefined ? '' : `: ${JSON.stringify(detail)}`));
  console.log(`OK ${message}`);
}
function verifyProgram(program, label) {
  const items = program.items || program;
  for (const [id, n] of Object.entries(COUNTS)) {
    const it = items.find(x => x.activityId === id);
    check(it && it.participants === n, `${label} ${id}: ${n} participants`, it);
    if (Object.hasOwn(EXPECTED_PRICES, id)) check(it.price === EXPECTED_PRICES[id], `${label} ${id}: independent price ${EXPECTED_PRICES[id]}`, it.price);
  }
  if (!Array.isArray(program)) {
    check(program.price === TOTAL, `${label} known subtotal ${TOTAL}`, program.price);
    check(program.priceComplete === false, `${label} arcades keeps total incomplete`);
  }
  const duck = items.find(x => x.activityId === 'duckpin_bowling');
  const bowling = items.find(x => x.activityId === 'bowling');
  const fun = items.find(x => x.activityId === 'fun_run');
  check(bowling.laneCount === 2, `${label} bowling uses two lanes for seven players`, bowling);
  check(duck.units === 3 && duck.laneCount === 2 && duck.sessions === 2 && duck.minutes === 120,
    `${label} duckpin uses three paid lanes across two tours`, duck);
  check(fun.sessions === 2 && fun.minutes === 30, `${label} funrun eight players takes two sessions`, fun);
  const unknown = items.find(x => x.activityId === 'arcade_time');
  check(unknown.priceKnown === false, `${label} unknown arcades never marked free`, unknown);
}
async function mounted(page, pax = 18) {
  await page.goto(`${BASE}/fungalaxy/libramont?embed=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour');
  // Availability must use the same future business day as the synthetic engine.
  // Today's auto-selected date can have no remaining slots when this gate runs late.
  await page.click('#dayBtn');
  await page.locator(`.fg-cal__day[data-date="${mock.DATE}"]`).click();
  await page.click('#dayBtn');
  check(await page.locator(`.fg-cal__day[data-date="${mock.DATE}"]`).getAttribute('aria-selected') === 'true', 'participant fixture selects its future Saturday');
  await page.press('#dayBtn', 'Escape');
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await page.click('#goActivities');
  await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
}
const card = id => `#gridAct li[data-activity="${id}"]`;
const input = id => `${card(id)} [data-compteur="participants"] input[type="number"]`;
async function setCount(page, id, n) {
  await page.locator(input(id)).fill(String(n));
  await page.locator(input(id)).press('Enter');
}
async function selectAll(page) {
  for (const id of Object.keys(COUNTS)) {
    await page.locator(`${card(id)} .fg-card`).click();
    await page.locator(input(id)).waitFor({ state: 'visible' });
    check(await page.locator(input(id)).inputValue() === '18', `${id} initially follows whole group`);
    await setCount(page, id, COUNTS[id]);
  }
  await page.locator(`${card('laser_game')} .fg-pill[data-valeur="2"]`).click();
  await page.locator(`${card('billards')} [data-compteur="units"] [data-pas="1"]`).click();
  await page.locator(`${card('billards')} .fg-pill[data-valeur="2"]`).click();
}
async function verifyReceipt(page, container, width) {
  const lines = await page.locator(`${container} .fg-recap__item`).evaluateAll(xs => xs.map(x => ({
    name: x.querySelector('.fg-recap__name').textContent.trim(),
    detail: x.querySelector('.fg-recap__detail').textContent.replace(/\s+/g, ' ').trim() })));
  for (const [id, n] of Object.entries(COUNTS)) {
    const name = mock.ACTIVITIES.find(a => a.id === id).name;
    const line = lines.find(x => x.name === name);
    check(line && line.detail.startsWith(`${n} ${id === 'playground' ? 'enfants' : 'joueurs'}`), `[${width}] ${container} spells out ${id} participants`, line);
  }
  const text = (await page.locator(container).textContent()).replace(/\s+/g, ' ');
  check(text.includes('18 personnes') && text.includes('461 €') && /sans Arcades.*prix à l’accueil/.test(text), `[${width}] ${container} group, known total and missing tariff clearly stated`, text);
}
async function adversarialSourceChecks() {
  const source = fs.readFileSync(path.resolve(__dirname, '../assets/fungalaxy-booking.js'), 'utf8');
  const holdsSource = source.slice(source.indexOf('  function enFile(fn)'), source.indexOf('  // La reservation est faite'));
  const requests = [];
  const adoptedQuotes = [];
  let resolveOld;
  const context = { blocage: { version: 0, file: Promise.resolve(), jeton: '', cle: '', etat: '' },
    fetch: (url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (body.release) return Promise.resolve({ status: 200 });
      return new Promise(resolve => { resolveOld = resolve; });
    }, Date, JSON, Number, String, Math, Promise, clearInterval() {}, setInterval() { return 1; }, rendreBlocage() {}, cleBlocage() { return 'new-three'; }, actualiserDevis(x) { adoptedQuotes.push(x); }, tic() {} };
  vm.createContext(context); vm.runInContext(holdsSource, context);
  const old = context.retenir({ participants: 8 }, 'old-eight');
  await Promise.resolve();
  context.libererBlocage();
  resolveOld({ status: 201, json: async () => ({ ok: true, holdToken: 'old-token',
    serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }) });
  const verdict = await old;
  check(verdict.obsolete === true && context.blocage.jeton === '' && context.blocage.etat === '', 'delayed hold after count change is discarded');
  check(requests.some(body => body.release === true && body.holdToken === 'old-token'), 'delayed stale hold token released immediately');
  const next = context.retenir({ participants: 3 }, 'new-three');
  await new Promise(resolve => setImmediate(resolve));
  resolveOld({ status: 201, json: async () => ({ ok: true, holdToken: 'new-token',
    serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }) });
  await next;
  check(context.blocage.jeton === 'new-token' && context.blocage.cle === 'new-three', 'new participants hold survives obsolete earlier response');
  context.libererBlocage(); await context.blocage.file;
  const obsoleteQuote = context.retenir({ participants: 7 }, 'old-emergency-seven');
  await new Promise(resolve => setImmediate(resolve));
  context.libererBlocage();
  resolveOld({ status: 409, json: async () => ({ ok: false, code: 'price_changed', price: 39, program: { items: [{ activityId: 'bowling', participants: 7 }] } }) });
  const obsoleteVerdict = await obsoleteQuote;
  check(obsoleteVerdict.obsolete === true && !adoptedQuotes.some(x => x.price === 39), 'late emergency price_changed cannot replace newer participant quote');
  const obsoleteArcade = context.retenir({ participants: 3, arcadeMode: 'credit', arcadeOfferId: 'credit-25', cards: 2 }, 'old-credit-cards');
  await new Promise(resolve => setImmediate(resolve)); context.libererBlocage();
  resolveOld({ status: 409, json: async () => ({ ok: false, code: 'price_changed', price: 52.7, program: { items: [{ activityId: 'arcade_time', participants: 3, cards: 2, arcadeMode: 'credit', arcadeOfferId: 'credit-25', arcadeOffer: { mode: 'credit', id: 'credit-25', price: 26.35, bonusCredits: 12 } }] } }) });
  const oldArcadeVerdict = await obsoleteArcade;
  check(oldArcadeVerdict.obsolete === true && !adoptedQuotes.some(x => x.price === 52.7), 'late credit offer price_changed cannot replace a newer timed-card choice');
  const priceStart = source.indexOf('  function tarifConnu(');
  const pricing = { meta: {}, state: { selection: ['golf', 'billards', 'playground'] }, Number, Math, isFinite,
    reglageBillard: () => ({ units: 2, hours: 1 }), motUnite: () => 'table', insecable: s => s,
    heuresLabel: n => n + 'h', euros: n => n + ' €', seCompteParEnfant: a => a.id === 'playground',
    enfantsPlaine: () => 3, optionChoisie: () => null, joueursDe: () => 3, joueurs: n => n + ' joueurs', reglageArcade: () => null };
  vm.createContext(pricing); vm.runInContext(source.slice(priceStart, source.indexOf('  /* --- Le fil', priceStart)), pricing);
  for (const [id, priceType] of [['golf', 'per_pax'], ['billards', 'per_unit_hour'], ['playground', 'per_pax']]) {
    const free = { id, priceType, priceValue: 0, unitLabel: 'par personne' };
    check(pricing.prixCarte(free, false).startsWith('0 €'), `explicit zero ${id} shown as known zero price`);
    check(/Prix à l’accueil/.test(pricing.prixCarte({ ...free, priceValue: null }, false)), `unknown ${id} remains price at reception`);
    check(catalog.activityLinePrice(free, { pax: 3, units: 2, hours: 1 }) === 0, `server ${id} agrees explicit zero is known`);
  }
}
async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const server = mock.createServer({ port: PORT });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER });
  const errors = [];
  const layoutFailures = [];
  try {
    await adversarialSourceChecks();
    const normalized = normalizeProgram(LINES, { centerId: 'libramont', pax: 18,
      bowlingConfig: getCenter('libramont').resources.bowling, dateStr: mock.DATE });
    verifyProgram(normalized, 'server');
    const stored = normalizeReservationRequest({ centerId: 'libramont', date: mock.DATE,
      startTime: '14:00', type: 'visite', pax: 18, program: LINES,
      name: 'QA Participants', phone: '0470000000', email: 'participants@pinlane.test' }, { channel: 'public' });
    check(stored.pax === 18, 'stored dossier retains total visitors');
    verifyProgram(stored.program, 'stored');
    const reloaded = normalizeProgram(JSON.parse(JSON.stringify(stored.program)), { centerId: 'libramont', pax: 18,
      bowlingConfig: getCenter('libramont').resources.bowling, dateStr: mock.DATE });
    verifyProgram(reloaded, 'JSON roundtrip');
    for (const participants of [999, -3, 0, 2.9, 'bad']) {
      assert.throws(() => normalizeProgram([{ activityId: 'minigolf_blacklight', participants }],
        { centerId: 'libramont', pax: 18 }), /participants/);
      check(true, `server rejects forged participant count ${participants}`);
    }
    const defaultCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const defaultPage = await defaultCtx.newPage();
    await mounted(defaultPage, 6);
    for (const id of ['bowling', 'minigolf_blacklight']) await defaultPage.locator(`${card(id)} .fg-card`).click();
    await defaultPage.click('.fg-scene[data-scene="activites"] [data-back]');
    await defaultPage.fill('#paxInput', '12'); await defaultPage.press('#paxInput', 'Enter');
    await defaultPage.click('#goActivities');
    for (const id of ['bowling', 'minigolf_blacklight']) check(await defaultPage.locator(input(id)).inputValue() === '12', `${id} untouched all-group counter follows group increase`);
    await defaultCtx.close();
    for (const width of [1440, 390, 375, 320]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 },
        ...(width < 500 ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      const availability = [];
      page.on('request', r => { if (r.url().includes('/api/public-availability?') && new URL(r.url()).searchParams.get('type') === 'visite') availability.push(r.url()); });
      await mounted(page);
      await selectAll(page);
      for (const [typed, expected] of [['', '7'], ['8.7', '8'], ['999', '18'], ['-4', '1'], ['7', '7']]) {
        await page.locator(input('bowling')).fill(typed);
        await page.locator(input('bowling')).press('Tab');
        check(await page.locator(input('bowling')).inputValue() === expected, `[${width}] typed ${JSON.stringify(typed)} settles to ${expected} on blur`);
      }
      for (const [id, n] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(n), `[${width}] ${id} retains independent count`);
      // Changing price options and toggling cards must preserve all counts.
      await page.locator(`${card('bowling')} .fg-pill[data-valeur="2"]`).click();
      check(await page.locator(input('bowling')).inputValue() === '7', `[${width}] duration change preserves bowling players`);
      await page.locator(`${card('bowling')} .fg-pill[data-valeur="1"]`).click();
      await page.locator(`${card('minigolf_blacklight')} .fg-card`).click();
      await page.locator(`${card('minigolf_blacklight')} .fg-card`).click();
      check(await page.locator(input('minigolf_blacklight')).inputValue() === '4', `[${width}] deselect/reselect preserves subset`);
      // UI lower bound is two for laser. Group remains eighteen.
      await setCount(page, 'laser_game', 1);
      check(await page.locator(input('laser_game')).inputValue() === '2', `[${width}] laser enforces two-player minimum`);
      await setCount(page, 'laser_game', 3);
      await setCount(page, 'minigolf_blacklight', 999);
      check(await page.locator(input('minigolf_blacklight')).inputValue() === '18', `[${width}] player input clamps to visitors`);
      await setCount(page, 'minigolf_blacklight', 4);
      await page.click('#tabFor');
      check(await page.locator('#gridFor [data-compteur="participants"]').count() === 0, `[${width}] packaged formulas retain their own fixed group rules`);
      await page.click('#tabAct');
      for (const [id, n] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(n), `[${width}] tab switch keeps ${id} subset`);
      await page.click('.fg-scene[data-scene="activites"] [data-back]');
      await page.fill('#paxInput', '4'); await page.press('#paxInput', 'Enter');
      await page.click('#goActivities');
      for (const [id, n] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(Math.min(n, 4)), `[${width}] group shrink clamps ${id} while preserving smaller subset`);
      await page.click('.fg-scene[data-scene="activites"] [data-back]');
      await page.fill('#paxInput', '18'); await page.press('#paxInput', 'Enter');
      await page.click('#goActivities');
      for (const [id, n] of Object.entries(COUNTS)) check(await page.locator(input(id)).inputValue() === String(Math.min(n, 4)), `[${width}] increasing group again retains explicit ${id} subset`);
      for (const [id, n] of Object.entries(COUNTS)) await setCount(page, id, n);
      const layout = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('#gridAct [data-compteur="participants"]')];
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          counters: boxes.map(b => { const r = b.getBoundingClientRect(); const p = b.closest('li').getBoundingClientRect();
            const f = b.querySelector('input'); return { fits: r.left >= p.left - 1 && r.right <= p.right + 1,
              font: parseFloat(getComputedStyle(f).fontSize), label: !!(f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.labels.length),
              targets: [...b.querySelectorAll('button,input')].map(x => { const q = x.getBoundingClientRect(); return { w: q.width, h: q.height }; }) }; }) };
      });
      check(!layout.overflow && layout.counters.length === 8 && layout.counters.every(x => x.fits && x.font >= 11.5 && x.label), `[${width}] counters fit cards, readable, named`, layout);
      const usable = layout.counters.every(x => x.targets.every(t => t.h >= 44 && t.w >= 44));
      if (!usable) layoutFailures.push({ width, counters: layout.counters });
      else check(true, `[${width}] counter touch targets remain usable`);
      await page.screenshot({ path: path.join(OUTPUT, `activities-${width}.png`), fullPage: true });
      await page.click('#goHours');
      await page.waitForFunction(() => !document.querySelector('#goContact').disabled, null, { timeout: 60000 });
      const query = new URL(availability[availability.length - 1]).searchParams;
      check(query.get('date') === mock.DATE, `[${width}] availability uses the chosen future fixture date`);
      check(Number(query.get('pax')) === 18, `[${width}] availability keeps total visitors`);
      const sent = JSON.parse(query.get('program'));
      for (const [id, n] of Object.entries(COUNTS)) check(sent.find(x => x.activityId === id).participants === n, `[${width}] availability sends ${id} count`);
      const response = await fetch(availability[availability.length - 1]).then(r => r.json());
      verifyProgram(response.program, `[${width}] availability`);
      check(response.price === TOTAL, `[${width}] availability known total`, response.price);
      await page.click('#goContact');
      await page.waitForSelector('.fg-scene[data-scene="contact"].is-active');
      await verifyReceipt(page, '#recallBody', width);
      const holds = mock.dernierePose.blocages.filter(x => x.action === 'hold');
      check(holds.length > 0 && holds.at(-1).corps.pax === 18, `[${width}] temporary hold keeps visitors`);
      for (const [id, n] of Object.entries(COUNTS)) check((holds.at(-1).corps.program.items || holds.at(-1).corps.program).find(x => x.activityId === id).participants === n, `[${width}] temporary hold keeps ${id} players`);
      await page.fill('#cPrenom', 'QA'); await page.fill('#cNom', 'Participants');
      await page.fill('#cEmail', 'participants@pinlane.test'); await page.fill('#cTel', '0470000000');
      await page.click('[data-occasion="amis"]'); await page.check('#cConsent');
      await page.click('#goRecap');
      await page.waitForSelector('.fg-scene[data-scene="recap"].is-active');
      await verifyReceipt(page, '#recap', width);
      // Existing upsell invitation is orthogonal to participant selection.
      // Dismiss it if the timed invitation has already opened.
      if (await page.locator('#vitrine .fg-vitrine__non').isVisible()) await page.locator('#vitrine .fg-vitrine__non').click();
      await page.screenshot({ path: path.join(OUTPUT, `recap-${width}.png`), fullPage: true });
      // A timer can open another optional invitation between screenshot and
      // click; the production handler cancels it synchronously on confirmation.
      await page.locator('#confirmBtn').evaluate(b => b.click());
      await page.waitForSelector('.fg-scene[data-scene="fin"].is-active', { timeout: 20000 });
      const receipt = (await page.locator('#finBody').textContent()).replace(/\s+/g, ' ');
      for (const [id, n] of Object.entries(COUNTS)) {
        const name = mock.ACTIVITIES.find(a => a.id === id).name;
        check(receipt.includes(`${name} (${n} ${id === 'playground' ? 'enfants' : 'joueurs'})`), `[${width}] final receipt spells out ${id} count`, receipt);
      }
      check(receipt.includes('18 personnes') && receipt.includes('461 €') && /sans Arcades.*prix à l’accueil/.test(receipt), `[${width}] final receipt keeps visitor total and partial amount`, receipt);
      await page.screenshot({ path: path.join(OUTPUT, `receipt-${width}.png`), fullPage: true });
      const post = mock.dernierePose.body;
      check(post && post.pax === 18 && post.price === TOTAL, `[${width}] final POST visitors and subtotal`, post && { pax: post.pax, price: post.price });
      for (const [id, n] of Object.entries(COUNTS)) check((post.program.items || post.program).find(x => x.activityId === id).participants === n, `[${width}] final POST retains ${id} count`);
      await ctx.close();
      mock.blocagesDev.clear();
    }
    check(errors.length === 0, 'no browser JS errors', errors);
    check(layoutFailures.length === 0, 'all viewports retain 44px high counter targets', layoutFailures);
    console.log(`PASS ${checks} assertions; screenshots ${OUTPUT}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
