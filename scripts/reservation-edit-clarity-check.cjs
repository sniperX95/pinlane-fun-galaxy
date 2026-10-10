'use strict';
// Independent group/activity counts and editable multi-activity sheet, fixture only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PINLANE_CAPACITY_PORT = process.env.PINLANE_EDIT_CLARITY_PORT || '4786';
const { serveStatic, installMock } = require('./planning-capacity-ui-check');
const api = require('./activity-drag-contract-check');
const availability = Object.fromEntries(require('../lib/catalog-store').listActivities('libramont').map(item => [item.id, true]));
const catalog = require('../api/public-booking-meta').__test.activitesPubliques('libramont', { activityAvailability: availability });
const { chromium } = require('playwright-core');
const out = path.resolve(__dirname, '../artifacts/reservation-edit-clarity-20261010');
fs.mkdirSync(out, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log('OK ' + message); }
function fixture() {
  const r = api.fixture('bowling');
  Object.assign(r, { name: 'Groupe de démonstration', clientName: 'Groupe de démonstration', pax: 23, status: 'paid', lanes: [1, 2, 3, 4], notes: 'Anniversaire : prévoir une table après les activités.' });
  const items = r.program.items;
  Object.assign(items.find(i => i.activityId === 'bowling'), { participants: 23 });
  Object.assign(items.find(i => i.activityId === 'laser_game'), { participants: 6, games: 3 });
  delete items.find(i => i.activityId === 'laser_game').extraLaser;
  Object.assign(items.find(i => i.activityId === 'minigolf_blacklight'), { participants: 20 });
  items.push({ activityId: 'billards', participants: 19, duration: 1, units: 2, hours: 1, unitLabel: 'par table', price: 40 });
  for(const [activityId, participants] of [['arcade_time', 5], ['playground', 3], ['duckpin_bowling', 4], ['fun_run', 5]]) items.push({ activityId, participants, duration: 0.5, price: 20 });
  Object.assign(items.find(i => i.activityId === 'duckpin_bowling'), { participants: 23, units: 2, sessions: 2, duration: 1, unitLabel: 'par piste' });
  Object.assign(items.find(i => i.activityId === 'fun_run'), { participants: 15, sessions: 3, minutes: 45 });
  for (const key of ['resourceBlocks', 'timeline']) {
    const blocks = r.opsPlan[key];
    Object.assign(blocks.find(b => b.activityId === 'bowling'), { players: 23, lanes: [1, 2, 3, 4] });
    blocks.filter(b => b.activityId === 'laser_game').forEach(b => { b.players = 6; });
    blocks.find(b => b.activityId === 'minigolf_blacklight').players = 20;
    blocks.push({ activityId: 'billards', resourceType: 'soft_capacity', type: 'activity', startTime: '19:00', endTime: '20:00', players: 19, countIndex: 1, groupWaveIndex: 1 });
  }
  return r;
}
(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    for (const viewport of [{ width: 1702, height: 1045 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      api.setStored(fixture()); api.setOther([]);
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
      const page = await context.newPage(); const errors = [], writes = [], outside = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-10-09T12:00:00'));
      await page.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.protocol.startsWith('http') && u.hostname !== '127.0.0.1') { outside.push(u.origin); return route.abort(); }
        return route.continue();
      });
      await page.exposeFunction('__qaReadReservation', () => api.getStored());
      await page.exposeFunction('__qaPatchActivity', async body => { writes.push(body); return body.activityMove ? api.call(body.activityMove, { id: body.id, centerId: body.centerId, baseUpdatedAt: body.baseUpdatedAt }) : api.call(undefined, body); });
      await installMock(page);
      await page.addInitScript(() => {
        const original = window.fetch;
        window.fetch = async (input, init = {}) => {
          const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
          const method = init.method || 'GET';
          if (u.pathname === '/api/staff-state') { const r = await window.__qaReadReservation(); return new Response(JSON.stringify({ ok: true, revision: r.updatedAt, reservations: [r], laneStatuses: {}, centerId: r.centerId }), { headers: { 'content-type': 'application/json' } }); }
          if (u.pathname === '/api/staff-reservations' && method === 'PATCH') { const r = await window.__qaPatchActivity(JSON.parse(init.body)); return new Response(JSON.stringify(r), { status: r.status, headers: { 'content-type': 'application/json' } }); }
          if (!['GET', 'HEAD'].includes(method)) return new Response('{}', { status: 503 });
          return original(input, init);
        };
      });
      await page.goto('http://127.0.0.1:' + process.env.PINLANE_CAPACITY_PORT + '/', { waitUntil: 'networkidle' });
      await page.evaluate(async activities => { await ensureStaffConsolesLoaded(); const r = await window.__qaReadReservation(); state.currentDate = r.date; state.reservations = [r]; state.adminCenterId = r.centerId; state.staffMenuPage = 'planning'; setView('staff'); await loadStaffCenterConfig(true); setCenterActivities(activities); renderStaff(); openPos(r.id); setTab('modifier'); }, catalog);
      await page.waitForSelector('#editNameInput');
      const size = viewport.width + 'x' + viewport.height;
      check(await page.locator('#editPaxInput').inputValue() === '23', 'group count stays23 ' + size);
      check(await page.evaluate(() => state.editState.programmeEdite.laser_game.participants) === 6, 'Laser count stays6 independently ' + size);
      check(await page.locator('.dossier-laser-unit').count() === 3, 'all three passes remain reachable ' + size);
      check(await page.evaluate(() => { const m = document.querySelector('.edit-modal'); return m.scrollWidth <= m.clientWidth + 1; }), 'no horizontal overflow ' + size);
      check((await page.locator('[data-edit-activity]').count()) === 8, 'all eight selected activities displayed ' + size);
      check(await page.locator('[data-edit-activity="bowling"] .dossier-lanes').isVisible(), 'Bowling lanes directly available in own activity ' + size);
      check(await page.locator('#posOverlay [onclick="toggleEditProgrammeOuvert()"]').count() === 0, 'activity edits require no Adapter detour ' + size);
      check(await page.locator('[data-edit-activity="laser_game"] .dossier-activity-count').count() === 1, 'Laser participant editor not duplicated ' + size);
      check(await page.locator('[data-edit-activity="laser_game"] [aria-label="Nombre de parties Laser Game"]').count() === 1, 'Laser games edit has one clear control ' + size);
      check(await page.locator('#editPriceInput').isVisible() && await page.locator('#editPricePerPerson').isVisible(), 'total and per-person prices directly available ' + size);
      check(/2 tables.*1h/.test(await page.locator('[data-edit-activity="billards"] > .dossier-edit-help').innerText()), 'stored Billard tables and hours visible ' + size);
      check(/2 pistes.*2 tours de 1h/.test(await page.locator('[data-edit-activity="duckpin_bowling"] > .dossier-edit-help').innerText()), 'stored Duckpin lanes and rounds visible ' + size);
      check(/3 × 15 min/.test(await page.locator('[data-edit-activity="fun_run"] > .dossier-edit-help').innerText()), 'stored Fun Run passages visible ' + size);
      check(/journée/.test(await page.locator('[data-edit-activity="playground"] > .dossier-edit-help').innerText()), 'Playground day entry visible ' + size);
      await page.screenshot({ path: path.join(out, size + '-initial.png'), fullPage: false });
      const layout = await page.evaluate(() => ({ labels: [...document.querySelectorAll('.edit-modal label, .edit-modal h3, .edit-modal legend')].map(n => n.textContent.trim()), text: document.querySelector('.edit-modal').innerText }));
      fs.writeFileSync(path.join(out, size + '-content.json'), JSON.stringify(layout, null, 2));
      const schedule = page.locator('.dossier-laser-schedule');
      if(!(await schedule.evaluate(el => el.open))) await schedule.locator('summary').click();
      await page.locator('.dossier-laser-unit[data-laser-unit="2.1"]').scrollIntoViewIfNeeded();
      check(await page.locator('.dossier-laser-unit[data-laser-unit="2.1"] input').isVisible(), 'Laser hours can be expanded ' + size);
      await page.screenshot({ path: path.join(out, size + '-schedule.png'), fullPage: false });
      check(await page.locator('[data-edit-activity="bowling"] .dossier-lanes').isVisible(), 'lane controls remain directly accessible ' + size);
      await page.locator('#editPriceInput').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, size + '-price.png'), fullPage: false });
      await page.locator('#editPaxInput').fill('24');
      check(await page.locator('[data-edit-activity="laser_game"] .dossier-participants-explanation').innerText() === '6 joueurs au Laser sur 24 participants', 'group typing updates activity caption ' + size);
      check(await page.locator('#editPaxInput').evaluate(el => el === document.activeElement), 'group typing preserves field focus ' + size);
      await page.locator('#editPaxInput').fill('5');
      check(await page.locator('[data-edit-activity="laser_game"] .staff-stepper-value').innerText() === '5', 'smaller group clamps displayed activity count ' + size);
      check(await page.locator('[data-edit-activity="laser_game"] button[aria-label*="ajouter"]').isDisabled(), 'activity increment disabled at updated group maximum ' + size);
      check(await page.evaluate(() => getEditProgramItems().every(item => item.participants <= 5)), 'program payload counts fit smaller group ' + size);
      await page.evaluate(() => { state.editState = etatEditionDepuis(state.selectedRes); renderPos(); });
      // A draft change must not mutate data until Save. Reset it after proving that.
      await page.locator('#editNameInput').fill('Brouillon du comptoir');
      check(writes.length === 0 && api.getStored().name === 'Groupe de démonstration', 'typing is draft only ' + size);
      await page.evaluate(() => { state.editState = etatEditionDepuis(state.selectedRes); renderPos(); });
      check(await page.evaluate(() => { const r = state.selectedRes; return getReservationActivityPlayers(r, 'bowling') === 23 && getReservationActivityPlayers(r, 'minigolf_blacklight') === 20 && getReservationActivityPlayers(r, 'billards') === 19; }), 'all distinct activity counts preserved ' + size);
      const dialog = page.getByRole('dialog');
      await page.locator('#editNameInput').focus();
      for (let n = 0; n < 25; n++) await page.keyboard.press('Tab');
      check(await dialog.evaluate(el => el.contains(document.activeElement)), 'keyboard stays in sheet ' + size);
      check(errors.length === 0, 'no JavaScript errors ' + size + ' ' + errors.join('; '));
      console.log('Blocked external asset requests: ' + outside.length + ' ' + size);
      await context.close();
    }
    console.log(JSON.stringify({ ok: true, checks, fixtureOnly: true }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
