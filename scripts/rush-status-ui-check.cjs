'use strict';
// Real browser interactions, synthetic reservations and intercepted PATCH only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PINLANE_STATUS_PORT = process.env.PINLANE_RUSH_PORT || '4787';
const helpers = require('./status-toggle-check');
const { chromium } = require('playwright-core');
const { fixture } = require('./activity-drag-contract-check');
const out = path.resolve(__dirname, '../artifacts/rush-status-20261010');
fs.mkdirSync(out, { recursive: true });
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; console.log('OK ' + label); }
function group(id, status, startTime) {
  const r = fixture('visit');
  Object.assign(r, { id, status, startTime, name: 'Groupe rush ' + id, date: '2026-07-18', paymentMethod: status === 'paid' ? 'Carte Bancaire' : '' });
  r.program.items.forEach(item => { item.planned = ['bowling', 'laser_game'].includes(item.activityId); });
  return r;
}
(async () => {
  const server = await helpers.serveStatic();
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1702, height: 1045 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.clock.install({ time: new Date('2026-07-18T13:00:00') });
    await helpers.installMock(page);
    await helpers.installStatusPatchMock(page);
    await page.goto('http://127.0.0.1:' + process.env.PINLANE_STATUS_PORT + '/', { waitUntil: 'networkidle' });
    await helpers.bootStaff(page);
    await helpers.gelerReleves(page);
    const rows = [group(17001, 'pending', '15:00'), group(17002, 'arrived', '15:30'), group(17003, 'paid', '16:00')];
    await page.evaluate(rows => { state.reservations = rows; state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; state.staffStatusFilter = 'all'; state.searchTerm = ''; renderStaff(); }, rows);
    const card = id => page.locator('#resList [data-res-row-id="' + id + '"]');
    await card(17001).waitFor();
    const snapshot = id => page.evaluate(id => { const list = document.querySelector('#resList'); const row = list.querySelector('[data-res-row-id="' + id + '"]'); return { ids: [...list.querySelectorAll('[data-res-row-id]')].map(n => n.dataset.resRowId), top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height, compact: row.classList.contains('is-done'), text: row.innerText, steps: row.querySelectorAll('.gc-step').length }; }, id);
    async function clickStatus(id, label, expected, paymentMethod) {
      const locator = card(id).locator('.gc-actions button').filter({ hasText: label }).first();
      await locator.scrollIntoViewIfNeeded();
      const before = await snapshot(id);
      const calls = await page.evaluate(() => window.__QA_PATCH__.calls);
      await helpers.retenirEcho(page);
      await locator.click();
      check(await page.evaluate(id => state.reservations.find(r => r.id === id).status, id) !== expected, 'no optimistic false status before server ' + label);
      await helpers.libererEcho(page);
      const after = await snapshot(id);
      check(await page.evaluate(id => state.reservations.find(r => r.id === id).status, id) === expected, 'server confirms status ' + label);
      check(await page.evaluate(() => window.__QA_PATCH__.calls) === calls + 1, 'single PATCH ' + label);
      check(JSON.stringify(after.ids) === JSON.stringify(before.ids), 'stable chronological card order ' + label);
      check(Math.abs(after.top - before.top) <= 3, 'card stays at same viewport position ' + label + ' ' + before.top + ' -> ' + after.top);
      check(!after.compact && after.height > 150 && /Bowling/.test(after.text) && /Laser Game/.test(after.text), 'full programme remains after ' + label);
      if (paymentMethod) check(await page.evaluate(id => state.reservations.find(r => r.id === id).paymentMethod, id) === paymentMethod, 'payment method retained ' + label);
    }
    check(!(await snapshot(17003)).compact, 'already paid future activity is not compacted');
    await clickStatus(17001, 'Arrivé', 'arrived');
    await clickStatus(17001, 'Carte', 'paid', 'Carte Bancaire');
    await clickStatus(17002, 'Espèces', 'paid', 'Espèces');
    await page.screenshot({ path: path.join(out, 'paid-active-list.png'), fullPage: false });
    for (const [id, selectedWord] of [[17001, 'Carte'], [17002, 'Espèces']]) {
      await card(id).locator('.gc-who h4').click();
      const selected = page.locator('.gc-sheet-states [aria-pressed="true"]');
      await selected.first().waitFor();
      check(await selected.count() === 1 && (await selected.innerText()).includes(selectedWord), 'one selected payment choice ' + selectedWord);
      check(await selected.evaluate(n => n.classList.contains('is-selected') || n.classList.contains('active')), 'selected status has visual class ' + selectedWord);
      const color = await selected.evaluate(n => ({ background: getComputedStyle(n).backgroundColor, marker: getComputedStyle(n, '::before').maskImage }));
      check(color.background !== 'rgba(0, 0, 0, 0)' && color.marker !== 'none', 'selected status has filled background and check marker ' + selectedWord);
      await selected.hover();
      const hover = await selected.evaluate(n => ({ background: getComputedStyle(n).backgroundColor, marker: getComputedStyle(n, '::before').maskImage, pressed: n.getAttribute('aria-pressed') }));
      check(hover.background !== 'rgba(0, 0, 0, 0)' && hover.marker !== 'none' && hover.pressed === 'true', 'hover preserves selected status fill and check ' + selectedWord);
      await page.screenshot({ path: path.join(out, 'selected-' + id + '.png'), fullPage: false });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { const r = state.reservations[0]; r.status = 'pending'; delete window.__QA_PATCH__.persistes[r.id]; window.__QA_PATCH__.mode = 'fail'; renderStaffData(); });
    const failBefore = await snapshot(17001);
    await helpers.retenirEcho(page);
    await card(17001).locator('.gc-actions button').filter({ hasText: 'Arrivé' }).first().click();
    await helpers.libererEcho(page);
    check(await page.evaluate(() => state.reservations[0].status) === 'pending', 'failed server does not mark arrival');
    check(JSON.stringify((await snapshot(17001)).ids) === JSON.stringify(failBefore.ids), 'failed server preserves card order');
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'echo'; setStaffStatusFilter('upcoming'); });
    check(await card(17001).isVisible() && await page.locator('#resList [data-res-row-id]').count() === 1, 'upcoming filter has the honest remaining pending group');
    await card(17001).locator('.gc-actions button').filter({ hasText: 'Arrivé' }).first().scrollIntoViewIfNeeded();
    const targetedBefore = await snapshot(17001);
    await helpers.retenirEcho(page);
    await card(17001).locator('.gc-actions button').filter({ hasText: 'Arrivé' }).first().click();
    await helpers.libererEcho(page);
    check(await page.evaluate(() => state.staffStatusFilter) === 'all', 'leaving targeted filter returns to Tout rather than hiding active group');
    check(Math.abs((await snapshot(17001)).top - targetedBefore.top) <= 3, 'targeted filter action keeps group at same viewport height');
    // The clock passes scheduled hours: a not-yet-played third Laser pass must stay actionable.
    await page.clock.setFixedTime(new Date('2026-07-18T20:00:00'));
    await page.evaluate(() => { const r = state.reservations[2]; r.opsPlan.timeline = r.opsPlan.timeline.filter(b => b.countIndex !== 3); r.opsPlan.resourceBlocks = r.opsPlan.resourceBlocks.filter(b => b.countIndex !== 3); renderStaffData(); });
    check(!(await snapshot(17003)).compact, 'past nominal end with unfinished/unplaced third pass remains full');
    check(await card(17003).isVisible(), 'paid unfinished group remains visible');
    await page.evaluate(() => { const r = state.reservations[1]; r.activityProgress = Object.fromEntries(getGroupeProgramme(r).filter(e => e.coche).map(e => [e.coche, { done: true, doneAt: new Date().toISOString(), by: 'QA' }])); renderStaffData(); });
    check(await card(17002).evaluate(n => n.classList.contains('is-done') && n.closest('.gc-section').classList.contains('done')), 'paid and explicitly all-done group becomes compact completed card');
    await page.evaluate(() => setStaffStatusFilter('paid'));
    check(await page.locator('#resList [data-res-row-id]').count() === 1 && await card(17002).count() === 1, 'Terminées filter contains only explicitly completed paid group');
    await page.evaluate(() => setStaffStatusFilter('all'));
    check(errors.length === 0, 'no JavaScript errors ' + errors.join('; '));
    console.log(JSON.stringify({ ok: true, checks, fixtureOnly: true }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
