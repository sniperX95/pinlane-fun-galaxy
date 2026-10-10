'use strict';
// Deuxieme et troisieme parties a placer : le vrai geste souris doit retirer
// uniquement la troisieme du stock, sans changer le reste du dossier.
// Fixture API existante, pg remplace en memoire, aucun appel distant.
const assert = require('node:assert/strict');
process.env.PINLANE_CAPACITY_PORT = process.env.PINLANE_LASER_STOCK_PORT || '5084';
const { serveStatic, installMock } = require('./planning-capacity-ui-check');
const api = require('./activity-drag-contract-check');
const { chromium } = require('playwright-core');
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log('OK ' + message); }
function preserved(before, after) {
  for (const key of ['date', 'startTime', 'duration', 'totalDuration', 'price', 'basePrice', 'pax', 'program', 'extras', 'status']) {
    assert.deepEqual(after[key], before[key], key); checks++;
  }
  const outside = b => b.activityId !== 'laser_game' || `${b.countIndex || 1}.${b.groupWaveIndex || 1}` !== '3.1';
  for (const key of ['resourceBlocks', 'timeline']) {
    assert.deepEqual(after.opsPlan[key].filter(outside), before.opsPlan[key].filter(outside), key); checks++;
  }
}
async function main() {
  api.setStored(api.fixture('visit')); api.setOther([]);
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-09T12:00:00'));
    await page.exposeFunction('__qaReadReservation', () => api.getStored());
    await page.exposeFunction('__qaPatchActivity', body => api.call(body.activityMove, { id: body.id, centerId: body.centerId, baseUpdatedAt: body.baseUpdatedAt }));
    await installMock(page);
    await page.addInitScript(() => {
      const old = window.fetch;
      window.fetch = async (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin), method = init.method || 'GET';
        if (u.pathname === '/api/staff-state') {
          const r = await window.__qaReadReservation();
          return new Response(JSON.stringify({ ok: true, revision: r.updatedAt, reservations: [r], laneStatuses: {}, centerId: r.centerId }), { headers: { 'content-type': 'application/json' } });
        }
        if (u.pathname === '/api/staff-reservations' && method === 'PATCH') {
          const r = await window.__qaPatchActivity(JSON.parse(init.body));
          return new Response(JSON.stringify(r), { status: r.status, headers: { 'content-type': 'application/json' } });
        }
        if (!['GET', 'HEAD'].includes(method)) return new Response('{}', { status: 503 });
        return old(input, init);
      };
    });
    await page.goto('http://127.0.0.1:' + process.env.PINLANE_CAPACITY_PORT + '/', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await ensureStaffConsolesLoaded(); const r = await window.__qaReadReservation();
      state.currentDate = r.date; state.reservations = [r]; state.adminCenterId = r.centerId;
      state.staffMenuPage = 'planning'; state.staffResourceView = 'laser'; setView('staff');
      await loadStaffCenterConfig(true); renderStaff();
    });
    await page.waitForSelector('#laserPlanningGridWrap .lp-dep');
    await page.evaluate(async () => { await unscheduleLaserPass(99001, '2.1'); await unscheduleLaserPass(99001, '3.1'); });
    const stock = () => page.locator('#laserPlanningGridWrap .lp-jeton[data-laser-res-id="99001"]').evaluateAll(nodes => nodes.map(n => n.dataset.laserUnit));
    const pending = await stock();
    check(pending.includes('2.1') && pending.includes('3.1') && new Set(pending).size === pending.length, 'parties 2 et 3 distinctes dans le stock');
    const before = api.getStored();
    const jeton = page.locator('#laserPlanningGridWrap .lp-jeton[data-laser-res-id="99001"][data-laser-unit="3.1"]');
    await jeton.scrollIntoViewIfNeeded(); const from = await jeton.boundingBox();
    check(from && from.height > 0, 'troisieme partie visible');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 9, from.y + from.height / 2 - 9, { steps: 3 });
    await page.waitForTimeout(350);
    const destination = page.locator('#laserPlanningGridWrap .lp-dep[data-lp-t="19"] .lp-dep__jauge');
    await destination.scrollIntoViewIfNeeded(); const to = await destination.boundingBox();
    check(to && to.height > 0, 'depart de 19:00 visible');
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
    await page.waitForFunction(() => !lpEtat.enCours && !lpEtat.glisse); await page.waitForTimeout(400);
    const after = api.getStored(), third = after.opsPlan.resourceBlocks.find(b => b.activityId === 'laser_game' && b.countIndex === 3);
    check(third && third.startTime === '19:00' && third.players === 2, 'troisieme partie sauvegardee a 19:00 avec ses deux joueurs');
    check(third.endTime === '19:25', 'heure de fin de la troisieme partie conserve ses 25 minutes');
    preserved(before, after);
    const remaining = await stock();
    check(remaining.includes('2.1') && !remaining.includes('3.1'), 'deuxieme partie encore a placer, troisieme sortie du stock');
    assert.deepEqual(after.opsPlan.laserPassPlan.pendingUnits, before.opsPlan.laserPassPlan.pendingUnits.filter(u => u.unitKey !== '3.1')); checks++;
    check(errors.length === 0, 'aucune erreur navigateur ' + errors.join(' | '));
    console.log(JSON.stringify({ ok: true, checks, fixtureOnly: true }));
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
