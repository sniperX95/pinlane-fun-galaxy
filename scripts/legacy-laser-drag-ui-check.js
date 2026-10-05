'use strict';
// Real browser gesture -> production PATCH handler, with an isolated synthetic
// database. Legacy cards must be movable without refreshing or recalculating a visit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PINLANE_CAPACITY_PORT = process.env.PINLANE_LEGACY_LASER_PORT || '4802';
const { serveStatic, installMock } = require('./planning-capacity-ui-check');
const api = require('./activity-drag-contract-check');
const { chromium } = require('playwright-core');
const copy = value => JSON.parse(JSON.stringify(value));
const out = path.resolve(__dirname, '../tests/artifacts/legacy-laser-drag');
fs.mkdirSync(out, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log('OK ' + message); }

function fixture(kind, shape) {
  const row = api.fixture(kind === 'formula' ? 'formule' : 'visit');
  row.name = row.clientName = 'QA legacy ' + kind + ' ' + shape;
  row.startTime = '14:00';
  row.duration = 1;
  row.totalDuration = 2.5;
  row.pax = kind === 'formula' ? 6 : 7;
  row.lanes = kind === 'mixed' ? [1, 2] : [1];
  if (kind === 'formula') { row.formuleId = 'f1'; row.program = null; }
  else if (kind === 'laser-only') {
    row.type = 'laser'; row.program = null; row.formuleId = '';
    row.lanes = []; row.duration = .75; row.laserGames = 2;
  } else {
    row.program.items = [
      { activityId: 'bowling', participants: 7, duration: 1, price: 39 },
      { activityId: 'laser_game', participants: 5, games: 2,
        extraLaser: { offerId: 'extra', participants: 2, games: 3, baseGames: 2, price: 12.6 }, price: 102.6 },
    ];
  }
  const bowling = { type: 'activity', activityId: 'bowling', resourceType: 'bowling_lane', startTime: '14:00', endTime: '15:00', lanes: row.lanes, players: row.pax };
  const laser = { type: 'activity', activityId: 'laser_game', resourceType: 'laser_arena', startTime: '15:30', endTime: '15:55', countIndex: 1, groupWaveIndex: 1, players: kind === 'mixed' ? 5 : row.pax };
  if (shape === 'absent') delete row.opsPlan;
  else if (shape === 'null') row.opsPlan = null;
  else if (shape === 'empty') row.opsPlan = { resourceBlocks: [], timeline: [] };
  else if (shape === 'timeline-only') row.opsPlan = { timeline: [bowling, laser] };
  else if (shape === 'bowling-only') row.opsPlan = { resourceBlocks: [bowling], timeline: [bowling] };
  else throw new Error('Unknown shape');
  return row;
}

async function projection(page, id = 99001) {
  return page.evaluate(id => {
    const row = state.reservations.find(r => r.id === id);
    const lean = window => ({ unit: laserBlockUnitKey(window), start: Math.round(window.start * 60), end: Math.round(window.end * 60), players: window.players, lanes: window.lanes });
    return { laser: getLaserWindowsFromReservation(row).map(window => { const value = lean(window); delete value.lanes; return value; }), bowling: getBowlingWindowsFromReservation(row).map(window => lean({ ...window, players: window.players ?? getReservationActivityPlayers(row, 'bowling') })) };
  }, id);
}

async function drag(page, card, hour = 18, fraction = 1 / 6) {
  const target = page.locator(`.laser-agenda-row[data-laser-time-start="${hour}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.focus(); await page.keyboard.press('m');
  check(await card.evaluate(el => el.classList.contains('is-move-selected')), 'source selects directly without a movement menu');
  await target.scrollIntoViewIfNeeded();
  const a = await card.boundingBox(), b = await target.boundingBox();
  assert.ok(a && b, 'laser source and drop row rendered');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 2 });
  await page.mouse.move(b.x + Math.min(120, b.width / 2), b.y + b.height * fraction, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const requests = [], errors = [], results = [];
  let otherReservations = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('__qaReadReservation', () => api.getStored());
    await page.exposeFunction('__qaReadOthers', () => otherReservations);
    await page.exposeFunction('__qaLegacyMove', async body => {
      requests.push(copy(body));
      const result = await api.call(body.activityMove, { id: body.id, centerId: body.centerId, baseUpdatedAt: body.baseUpdatedAt });
      results.push({ request: copy(body), status: result.status, message: result.message });
      return result;
    });
    await installMock(page);
    await page.addInitScript(() => {
      const prior = window.fetch;
      window.fetch = async (input, init = {}) => {
        const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (u.pathname === '/api/staff-state') {
          const r = await window.__qaReadReservation();
          return new Response(JSON.stringify({ ok: true, reservations: [r, ...await window.__qaReadOthers()], revision: r.updatedAt, laneStatuses: {}, centerId: r.centerId }), { headers: { 'content-type': 'application/json' } });
        }
        if (u.pathname === '/api/staff-reservations' && init.method === 'PATCH') {
          const r = await window.__qaLegacyMove(JSON.parse(init.body));
          return new Response(JSON.stringify(r), { status: r.status, headers: { 'content-type': 'application/json' } });
        }
        if (!['GET', 'HEAD'].includes(init.method || 'GET')) return new Response('{}', { status: 503 });
        return prior(input, init);
      };
    });
    api.setStored(fixture('mixed', 'null')); api.setOther([]);
    await page.goto(`http://127.0.0.1:${process.env.PINLANE_CAPACITY_PORT}/#/staff/planning`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await ensureStaffConsolesLoaded(); const r = await window.__qaReadReservation();
      state.adminCenterId = r.centerId; state.currentDate = r.date; state.reservations = [r];
      state.staffMenuPage = 'planning'; state.staffResourceView = 'laser'; setView('staff');
      await loadStaffCenterConfig(true); renderStaff();
    });
    let fixtureId = 99100;
    for (const kind of ['formula', 'mixed', 'laser-only']) {
      for (const shape of ['absent', 'null', 'empty', ...(kind !== 'laser-only' ? ['timeline-only', 'bowling-only'] : [])]) {
        const before = fixture(kind, shape); before.id = fixtureId++; api.setStored(before); api.setOther([]);
        await page.evaluate(async () => {
          cancelPlanningMove(false); pendingReservationMutations.clear(); reservationInFlightMutations.clear();
          state.reservations = [await window.__qaReadReservation()]; renderStaff();
          document.getElementById('planningMoveNotice')?.remove();
        });
        const projected = await projection(page, before.id);
        check(projected.laser.length > 0, `legacy ${kind}/${shape} really has a visible Laser card`);
        const first = projected.laser[0], card = page.locator(`.laser-group-card[data-laser-res-id="${before.id}"][data-laser-unit="${first.unit}"]`).first();
        const countBefore = requests.length;
        await drag(page, card);
        check(requests.length === countBefore + 1, `real direct drag reaches PATCH ${kind}/${shape}`);
        const result = results.at(-1);
        check(result.status === 200, `legacy ${kind}/${shape} saves rather than asks refresh: ${JSON.stringify(result)}`);
        check(requests.at(-1).activityMove.startTime === '18:05', 'drop resolves the requested five-minute time');
        await page.waitForFunction(() => pendingReservationWriteIds.size === 0);
        await page.waitForFunction(({id,unit}) => getLaserWindowsFromReservation(state.reservations.find(r=>r.id===id)).some(w=>laserBlockUnitKey(w)===unit && Math.round(w.start*60)===1085), {id:before.id,unit:first.unit});
        const after = api.getStored(), projectedAfter = await projection(page, before.id);
        const target = projectedAfter.laser.find(window => window.unit === first.unit);
        check(target?.start === 18 * 60 + 5 && target.end - target.start === first.end - first.start && target.players === first.players, 'moved unit retains duration and its own participants ' + JSON.stringify({ first, target }));
        assert.deepEqual(projectedAfter.laser.filter(w => w.unit !== first.unit), projected.laser.filter(w => w.unit !== first.unit), 'every other visible laser unit retains time and participants'); checks++;
        assert.deepEqual(projectedAfter.bowling, projected.bowling, 'visible bowling retains exact start/end and lanes'); checks++;
        for (const key of ['startTime', 'date', 'duration', 'totalDuration', 'pax', 'price', 'basePrice', 'program', 'status']) { assert.deepEqual(after[key], before[key], `${key} preserved for ${kind}/${shape}`); checks++; }
        check(await page.locator('#planningMoveSelection').count() === 0, 'no movement panel');
        if (shape === 'null') await page.screenshot({ path: path.join(out, kind + '-after.png') });
      }
    }
    // UI capacity reason before a write, never misleading refresh instructions.
    const legacy = fixture('mixed', 'null'); legacy.id = 99300; api.setStored(legacy);
    const occupied = { ...fixture('laser-only', 'null'), id: 99002, startTime: '18:05', duration: .5, laserGames: 1, pax: 29 };
    occupied.opsPlan = {resourceBlocks:[{activityId:'laser_game',resourceType:'laser_arena',startTime:'18:05',endTime:'18:30',players:29,countIndex:1,groupWaveIndex:1}]};
    api.setOther([occupied]); otherReservations = [occupied];
    await page.evaluate(async o => { cancelPlanningMove(false); state.reservations = [await window.__qaReadReservation(), o]; renderStaff(); }, occupied);
    await page.waitForTimeout(750);
    const beforeConflict = api.getStored(), requestCount = requests.length;
    await drag(page, page.locator('.laser-group-card[data-laser-res-id="99300"]').first());
    check(requests.length === requestCount, 'full Laser launch blocked before a write');
    check(/complet|34\/30|capacit/i.test(await page.locator('#planningMoveNotice').textContent()), 'capacity collision explains capacity, not refresh');
    assert.deepEqual(api.getStored(), beforeConflict); checks++;
    check(errors.length === 0, 'no browser JavaScript errors');
    check(requests.every(r => Object.keys(r).every(k => ['id', 'centerId', 'baseUpdatedAt', 'activityMove'].includes(k))), 'gesture never submits client prices or global edits');
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ checks, results, requests, errors, remoteWrites: 0 }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, fixtures: 13, remoteWrites: 0 }));
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
