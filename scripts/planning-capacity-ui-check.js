// Gate Playwright - point 1 : le PLANNING STAFF lit la vraie capacite du centre
// affiche (config staff chargee), au lieu des constantes en dur 8 pistes / 30
// armes de booking-core. Pilote l app reellement servie, charge une config
// mockee via /api/ops?action=centerConfig, et compte les lignes de piste rendues.
//
// PROUVE :
//   - un centre configure a 6 pistes rend 6 lignes de piste (pas 8) ;
//   - la capacite laser du planning reflete la config (armes) ;
//   - SANS config (centers vides), repli byte-for-byte sur les constantes (8 / 30) ;
//   - contre-preuve : configure (6/12) != repli (8/30) -> la valeur vient bien de
//     la config, elle n est pas codee en dur a 6.
//
// Ne touche PAS au drag-drop : ce gate ne fait que verifier le NOMBRE de lignes
// et la capacite affichee ; laser-drag-check couvre l interaction elle-meme.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CAPACITY_PORT || 4197);
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
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view','planning.view','planning.bowling','planning.laser','planning.drag','reservations.view','reservations.create','reservations.edit','reservations.status','reservations.quick','clients.view','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Grille ouverte tous les jours -> planning toujours rendu, quel que soit le
    // jour reel. Vacances desactivees pour ecarter tout chemin ferie/conge.
    const openWeek = { '0': { open: '10:00', close: '24:00' }, '1': { open: '10:00', close: '24:00' }, '2': { open: '10:00', close: '24:00' }, '3': { open: '10:00', close: '24:00' }, '4': { open: '10:00', close: '24:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } };
    const centerFor = (id, laneCount, weaponCount) => ({
      id, name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' },
        partyTables: null,
      },
      defaultSchedule: { regular: openWeek, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {}, classification: {}, customActivities: [],
    });
    const build = (date) => ([
      { id: 9001, name: 'Groupe A #9001', phone: '+32470860011', email: 'a@x.test', date, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 20, type: 'bowling', label: 'Bowling' },
      { id: 9002, name: 'Groupe B #9002', phone: '+32470860012', email: 'b@x.test', date, startTime: '15:00', duration: 1, lanes: [3], status: 'confirmed', pax: 4, price: 39, type: 'bowling', label: 'Bowling' },
      { id: 9010, name: 'Laser C #9010', phone: '+32470860010', email: 'c@x.test', date, startTime: '17:30', duration: 0.5, lanes: [], status: 'confirmed', pax: 8, price: 40, type: 'laser', label: 'Laser direct' },
    ]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const nativeFetch = window.fetch.bind(window);
    window.__CFG_MODE__ = 'configured';
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') {
          const id = u.searchParams.get('centerId') || 'libramont';
          if (window.__CFG_MODE__ === 'empty') return J({ ok: true, centers: [], activities: [] });
          return J({ ok: true, centers: [centerFor(id, 6, 12)], activities: [] });
        }
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function applyMode(page, mode, resourceView) {
  await page.evaluate(async ({ mode, resourceView }) => {
    window.__CFG_MODE__ = mode;
    const d = '2026-07-18';
    state.currentDate = d; state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning'; state.staffResourceView = resourceView; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = false; state.staffPlanningExpanded = false;
    state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    // Un chargement de config declenche au boot (ensureStaffCenterConfigForPlanning)
    // peut etre en vol : loadStaffCenterConfig(true) se court-circuite si loading=true.
    // On attend qu il retombe, PUIS on force notre mode de facon deterministe.
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 30)); }
    await loadStaffCenterConfig(true);
    renderStaff();
  }, { mode, resourceView });
  await page.waitForTimeout(250);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=cap-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 15000 });

    // --- Scenario CONFIGURE : 6 pistes, 12 armes ---
    console.log('\n[1a] Centre configure a 6 pistes / 12 armes');
    await applyMode(page, 'configured', 'bowling');
    const confLanes = await page.evaluate(() => document.querySelectorAll('.lane-col').length);
    const confDrop = await page.evaluate(() => new Set([...document.querySelectorAll('[data-bowling-drop-lane]')].map(el => el.dataset.bowlingDropLane)).size);
    ok(confLanes === 6, `le planning rend 6 lignes de piste (obtenu ${confLanes})`);
    ok(confDrop === 6, `6 pistes distinctes cibles de drop (obtenu ${confDrop}) : capacite reduite reflete la config`);

    await applyMode(page, 'configured', 'laser');
    const confLaser = await page.evaluate(() => (document.getElementById('laserPlanningSub')?.textContent || ''));
    ok(/12\s*armes/.test(confLaser), `capacite laser du planning reflete la config (12 armes) : "${confLaser.trim()}"`);
    ok(!/30\s*armes/.test(confLaser), 'la capacite laser n est plus la constante 30 en dur');

    // --- Scenario REPLI : aucune config -> constantes 8 / 30 ---
    console.log('\n[1b] Aucune config -> repli sur les constantes (8 pistes / 30 armes)');
    await applyMode(page, 'empty', 'bowling');
    const fbLanes = await page.evaluate(() => document.querySelectorAll('.lane-col').length);
    ok(fbLanes === 8, `repli: 8 lignes de piste comme la constante TOTAL_LANES (obtenu ${fbLanes})`);

    await applyMode(page, 'empty', 'laser');
    const fbLaser = await page.evaluate(() => (document.getElementById('laserPlanningSub')?.textContent || ''));
    ok(/30\s*armes/.test(fbLaser), `repli: capacite laser = constante 30 armes (obtenu "${fbLaser.trim()}")`);

    // --- Contre-preuve : la valeur vient de la config, pas d un 6 code en dur ---
    console.log('\n[1c] Contre-preuve : configure (6/12) != repli (8/30)');
    ok(confLanes !== fbLanes, `pistes: configure ${confLanes} != repli ${fbLanes} (la valeur suit la config)`);
    ok(!/12\s*armes/.test(fbLaser), 'armes: le repli ne montre pas 12 (la valeur suit la config)');

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nplanning-capacity-ui-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nplanning-capacity-ui-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nplanning-capacity-ui-check: ALL OK');
}
main();
