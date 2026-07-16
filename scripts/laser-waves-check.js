// Gate INTERACTIF : indépendance des VAGUES laser (Playwright pilote un vrai drag).
// Un gros groupe joue 1 jeu laser en plusieurs vagues (pas assez d'armes d'un coup) ;
// chaque vague doit être plaçable SÉPARÉMENT : glisser une vague ne déplace QU'elle.
// Couvre le bug "déplacer une vague déplace les deux" + non-régression 2 jeux distincts.
// SEED=twowaves|distinct, DRAG_UNIT=jeu.vague (défaut 1.2). Cf. ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LFD_PORT || 4207);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const SEED = process.env.SEED || 'twowaves';
  await page.addInitScript(({ expiresAt, SEED }) => {
    window.__SEED__ = SEED;
    const perms = ['dashboard.view','planning.view','planning.laser','planning.drag','reservations.view','reservations.edit','reservations.status','clients.view','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const lb = (countIndex, waveIndex, waveCount, players, sMin, eMin) => ({ type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', countIndex, critical: true, start: sMin, end: eMin, startTime: `${String(Math.floor(sMin/60)).padStart(2,'0')}:${String(sMin%60).padStart(2,'0')}`, endTime: `${String(Math.floor(eMin/60)).padStart(2,'0')}:${String(eMin%60).padStart(2,'0')}`, durationMinutes: eMin - sMin, players, groupPlayers: players, groupWaveIndex: waveIndex, groupWaveCount: waveCount });
    // Scénario via SEED : 'twowaves' (réel : 1 jeu, 45 j → 2 vagues) | 'distinct' (2 jeux)
    const CFG = {
      twowaves: { formuleId: 'f1', label: 'FORMULE 1', pax: 45, blocks: [lb(1, 1, 2, 23, 1015, 1040), lb(1, 2, 2, 22, 1045, 1070)] },
      distinct: { formuleId: 'f4', label: 'FORMULE 4', pax: 20, blocks: [lb(1, 1, 1, 20, 1015, 1040), lb(2, 1, 1, 20, 1045, 1070)] },
    }[SEED] || { formuleId: 'f1', label: 'FORMULE 1', pax: 45, blocks: [lb(1, 1, 2, 23, 1015, 1040), lb(1, 2, 2, 22, 1045, 1070)] };
    const build = (date) => ([{
      id: 9500, name: 'Groupe Formule laser', phone: '+32470999500', email: 'f@x.test', date,
      startTime: '15:00', duration: 3, lanes: [], status: 'confirmed', pax: CFG.pax, price: 468,
      type: 'formule', formuleId: CFG.formuleId, label: CFG.label,
      opsPlan: { formulaId: CFG.formuleId, startTime: '15:00', resourceBlocks: CFG.blocks, laserPassPlan: { mode: 'manual_after_first', totalGames: 2, scheduledGames: 2, remainingGames: 0 } },
    }]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.__QA_PATCHES__ = []; window.__QA_STORE__ = {};
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10); const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, ...window.__QA_STORE__[r.id] } : r); return J({ ok: true, revision: `qa-${d}-${Object.keys(window.__QA_STORE__).length}`, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') { const b = JSON.parse(init.body || '{}'); window.__QA_PATCHES__.push(b); let merged = { ...b }; try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) merged = { ...f, ...b }; } } catch (e) {} window.__QA_STORE__[b.id] = { startTime: merged.startTime, opsPlan: merged.opsPlan, lanes: merged.lanes }; return J({ ok: true, reservation: merged, automation: { communications: 0, jobs: 0, refreshed: true } }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0,10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0,10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, SEED });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=lfd-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      const d = '2026-07-18'; // samedi (10:00-24:00 ouvert dans le planning mock)
      state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'laser'; state.staffTheme = 'dark';
      state.staffLaserPlanningExpanded = true; state.staffPlanningExpanded = false;
      state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(500);

    const DRAG_UNIT = process.env.DRAG_UNIT || '1.2'; // unité (jeu.vague) à glisser

    // État initial : toutes les unités laser (jeu.vague) et leurs positions
    const beforeReal = await page.evaluate(() => {
      const r = state.reservations.find(x => x.id === 9500);
      const uf = (x) => `${Number(x.countIndex || 1)}.${Number(x.groupWaveIndex || 1)}`;
      const w = getLaserWindowsFromReservation(r).map(x => ({ unit: uf(x), start: x.start, startTime: x.startTime })).sort((a,b)=>a.start-b.start);
      return { windows: w, cardCount: document.querySelectorAll('.laser-group-card[onmousedown*="9500"]').length };
    });
    console.log('AVANT : unités:', JSON.stringify(beforeReal.windows), '| cartes:', beforeReal.cardCount);
    if (process.env.LASER_SHOT) {
      await page.evaluate(() => {
        const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
        const card = document.querySelector('.laser-group-card[onmousedown*="9500"]');
        if (ag && card) { const top = card.getBoundingClientRect().top - ag.getBoundingClientRect().top + ag.scrollTop; ag.scrollTop = Math.max(0, top - 180); }
      });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${process.env.LASER_SHOT}/laser-waves.png`, clip: { x: 0, y: 0, width: 1200, height: 700 } });
    }
    ok(beforeReal.cardCount === beforeReal.windows.length, `1 carte par unité (${beforeReal.cardCount})`);
    ok(beforeReal.windows.some(w => w.unit === DRAG_UNIT), `unité ${DRAG_UNIT} présente au départ`);
    const startBefore = Object.fromEntries(beforeReal.windows.map(w => [w.unit, w.start]));

    // Amener la carte de l'unité ciblée au milieu du viewport
    await page.evaluate((unit) => {
      const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
      const card = [...document.querySelectorAll('.laser-group-card[onmousedown*="9500"]')]
        .find(c => c.getAttribute('onmousedown').includes(`, '${unit}')`));
      if (ag && card) { const top = card.getBoundingClientRect().top - ag.getBoundingClientRect().top + ag.scrollTop; ag.scrollTop = Math.max(0, top - 260); }
    }, DRAG_UNIT);
    await page.waitForTimeout(200);

    const pos = await page.evaluate((args) => {
      const { unit, avoid } = args;
      const card = [...document.querySelectorAll('.laser-group-card[onmousedown*="9500"]')]
        .find(c => c.getAttribute('onmousedown').includes(`, '${unit}')`));
      const slots = [...document.querySelectorAll('.laser-session-slot.is-empty[data-laser-drop-start]')]
        .map(s => ({ s, b: s.getBoundingClientRect(), t: Number(s.dataset.laserDropStart) }))
        .filter(o => o.b.top > 150 && o.b.bottom < window.innerHeight - 40)
        .filter(o => avoid.every(a => Math.abs(o.t - a) >= 1.0));
      const pick = slots[0];
      if (!card || !pick) return null;
      const c = card.getBoundingClientRect();
      return { card: { x: c.x + c.width/2, y: c.y + c.height/2 }, tgt: { x: pick.b.x + pick.b.width/2, y: pick.b.y + pick.b.height/2, t: pick.t } };
    }, { unit: DRAG_UNIT, avoid: beforeReal.windows.map(w => w.start) });
    if (!ok(!!pos, `carte ${DRAG_UNIT} + slot vide visible éloigné trouvés`)) { throw new Error('setup drag introuvable'); }

    await page.evaluate(() => {
      window.__NOTICES__ = [];
      if (typeof showPlanningMoveNotice === 'function') { const orig = showPlanningMoveNotice; window.showPlanningMoveNotice = (a,b,c) => { window.__NOTICES__.push({ a, b, c }); return orig(a,b,c); }; }
      if (typeof toast === 'function') { const t = toast; window.toast = (m) => { window.__NOTICES__.push({ toast: m }); return t(m); }; }
    });
    await page.mouse.move(pos.card.x, pos.card.y); await page.mouse.down();
    await page.mouse.move(pos.card.x + 8, pos.card.y + 8, { steps: 2 });
    await page.mouse.move(pos.tgt.x, pos.tgt.y, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(500);
    const trace = await page.evaluate(() => ({ patches: (window.__QA_PATCHES__||[]).map(p => ({ laser: (p.opsPlan?.resourceBlocks||[]).filter(b=>b.resourceType==='laser_arena').map(b=>`${b.countIndex}.${b.groupWaveIndex||1}@${b.startTime}`) })), notices: window.__NOTICES__ || [] }));
    console.log('TRACE dernier patch:', JSON.stringify(trace.patches.slice(-1)));
    console.log('TRACE notices:', JSON.stringify(trace.notices));

    const after = await page.evaluate(() => {
      const r = state.reservations.find(x => x.id === 9500);
      const uf = (x) => `${Number(x.countIndex || 1)}.${Number(x.groupWaveIndex || 1)}`;
      const w = getLaserWindowsFromReservation(r).map(x => ({ unit: uf(x), start: x.start, startTime: x.startTime })).sort((a,b)=>a.start-b.start);
      return { windows: w };
    });
    console.log(`APRÈS drag unité ${DRAG_UNIT} → ${pos.tgt.t}h :`, JSON.stringify(after.windows));

    const startAfter = Object.fromEntries(after.windows.map(w => [w.unit, w.start]));
    const draggedMoved = Math.abs((startAfter[DRAG_UNIT] ?? -99) - pos.tgt.t) < 0.02;
    const othersKept = beforeReal.windows
      .filter(w => w.unit !== DRAG_UNIT)
      .every(w => Math.abs((startAfter[w.unit] ?? -99) - startBefore[w.unit]) < 0.02);
    const sameCount = after.windows.length === beforeReal.windows.length;
    ok(sameCount, `même nombre d'unités après drag (${after.windows.length}/${beforeReal.windows.length})`);
    ok(draggedMoved, `l'unité ${DRAG_UNIT} s'est déplacée à ${pos.tgt.t}h (obtenu ${startAfter[DRAG_UNIT] != null ? startAfter[DRAG_UNIT].toFixed(2) : 'absente'})`);
    ok(othersKept, `les AUTRES unités n'ont PAS bougé (indépendance des vagues)`);
    if (!othersKept) console.log('\n>>> BUG : déplacer une vague a aussi déplacé les autres.');

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\nlaser-waves-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nlaser-waves-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nlaser-waves-check: ALL OK');
}
main();
