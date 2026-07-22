// Gate UI des BLOCAGES de disponibilite cote staff (page Etablissement,
// permission settings.manage) + leur VISUALISATION dans le planning bowling.
// Edge headless via playwright-core, index.html reel servi en memoire, session
// settings.manage mockee, /api/ops mocke (centerConfig + listAvailabilityBlocks
// STATEFUL : un save ajoute, un delete retire, le re-fetch reflete l'etat).
//
// La liste mockee respecte la VRAIE forme du serveur (lib/availability-blocks.js
// normalizeBlockRow) : startMin/endMin en minutes (null = jour entier),
// createdBy ; PAS startTime/endTime. Le client doit consommer cette forme.
//
// Preuves COMPORTEMENTALES (jamais une simple presence de chaine) :
//   1. la liste affiche les libelles humains corrects pour center/lane/activity/
//      formula, once ET weekly, jour entier VS plage horaire ;
//   2. creer "piste 3, mardi, 14:00-16:00" => POST saveAvailabilityBlock avec
//      scopeType:'lane', scopeRef:'3', recurrence:'weekly', dayOfWeek:2,
//      startTime:'14:00', endTime:'16:00' et SANS centerId dans le corps ;
//   3. creer "fermer le centre le 2026-08-15 toute la journee" => POST
//      scopeType:'center', recurrence:'once', date:'2026-08-15', sans start/end,
//      sans centerId ;
//   4. supprimer un blocage => POST deleteAvailabilityBlock avec l'id ; apres
//      re-fetch la liste ne le montre plus ;
//   5. planning bowling : un blocage sur le jour affiche marque la bonne piste
//      (element .planning-blocked[data-blocked-lane="3"] present).
// Puis DEUX contre-preuves par MUTATION du VRAI source (assets/app-main.js),
// restauration par EDITION INVERSE exacte (jamais git checkout) :
//   (a) neutraliser l'envoi de body.startTime -> le check 'save-lane-starttime' rougit ;
//   (b) neutraliser le calcul des fenetres de blocage piste -> 'planning-lane-blocked' rougit.
// Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/availability-blocks-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_AVB_PORT || 4251);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SRC = path.join(ROOT, 'assets', 'app-main.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Mutations ciblees du VRAI source. Les ancres multi-lignes sont exprimees en \n ;
// applyEdit les aligne sur la fin de ligne reelle du fichier.
const MUTATIONS = [
  {
    name: "envoi de body.startTime neutralise",
    find: '    body.startTime = start;\n    body.endTime = end;',
    replace: '    body.endTime = end;',
    expect: 'save-lane-starttime',
  },
  {
    name: 'calcul des fenetres de blocage piste neutralise',
    find: '    const laneWins = laneBlockWindows[i] || [];',
    replace: '    const laneWins = [];',
    expect: 'planning-lane-blocked',
  },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function applyEdit(find, replace) {
  const src = fs.readFileSync(SRC, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const f = find.split('\n').join(eol);
  const r = replace.split('\n').join(eol);
  const count = src.split(f).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count}) : ${find.slice(0, 46)}`);
  fs.writeFileSync(SRC, src.replace(f, r));
}

// Session settings.manage + centre 'gembloux', /api/ops mocke STATEFUL. La
// liste des blocages suit la VRAIE forme serveur (startMin/endMin/createdBy).
// addInitScript re-joue a chaque navigation -> etat frais par run.
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'reservations.view', 'reservations.status', 'settings.manage', 'direction.view', 'pricing.manage'];
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'gembloux', expiresAt,
      member: { id: 'gembloux:mgr', name: 'Directrice' },
      role: { id: 'director', name: 'Direction', locked: false }, permissions: perms,
    };

    const CENTER = {
      id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels',
      resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 }, laser: { weaponCount: 30, parallelLaunches: 1 } },
      activityAvailability: { bowling: true, laser_game: true, minigolf_blacklight: true },
      // Toutes les journees ouvertes 10h-22h : le mardi 2026-09-01 couvre bien
      // la plage 14:00-16:00 du blocage piste teste au planning.
      defaultSchedule: {
        regular: {
          0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' },
          2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' },
          4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '22:00' },
          6: { open: '10:00', close: '22:00' },
        },
        holiday: {},
      },
    };
    const ACTIVITIES = [
      { id: 'bowling', label: 'Bowling' },
      { id: 'laser_game', label: 'Laser Game' },
      { id: 'minigolf_blacklight', label: 'Minigolf Blacklight' },
    ];

    // Etat initial : couvre center/lane/activity/formula, once/weekly, jour
    // entier VS plage. Forme serveur reelle : startMin/endMin (minutes) + createdBy.
    window.__avbBlocks = [
      { id: 1, centerId: 'gembloux', scopeType: 'center', scopeRef: null, recurrence: 'once', date: '2026-08-15', dayOfWeek: null, dateFrom: null, dateUntil: null, startMin: null, endMin: null, reason: 'Jour ferie', createdBy: 'qa' },
      { id: 2, centerId: 'gembloux', scopeType: 'lane', scopeRef: '3', recurrence: 'weekly', date: null, dayOfWeek: 2, dateFrom: null, dateUntil: null, startMin: 840, endMin: 960, reason: 'Piste capricieuse', createdBy: 'qa' },
      { id: 3, centerId: 'gembloux', scopeType: 'formula', scopeRef: 'f1', recurrence: 'weekly', date: null, dayOfWeek: 0, dateFrom: null, dateUntil: null, startMin: null, endMin: null, reason: '', createdBy: 'qa' },
      { id: 4, centerId: 'gembloux', scopeType: 'activity', scopeRef: 'laser_game', recurrence: 'once', date: '2026-08-16', dayOfWeek: null, dateFrom: null, dateUntil: null, startMin: null, endMin: null, reason: 'Panne laser', createdBy: 'qa' },
    ];
    window.__avbSeq = 100;
    window.__avbPosts = [];
    const toMin = (t) => { if (!t) return null; const p = String(t).split(':').map(Number); return (p[0] * 60) + (p[1] || 0); };

    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(raw, window.location.origin); } catch (e) { return nf(input, init); }
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname === '/api/ops') {
        if (method === 'POST') {
          let body = {};
          try { body = JSON.parse(init.body || '{}'); } catch (e) { body = {}; }
          if (body.action === 'saveAvailabilityBlock') {
            window.__avbPosts.push(body);
            const id = ++window.__avbSeq;
            window.__avbBlocks.push({
              id, centerId: 'gembloux',
              scopeType: body.scopeType,
              scopeRef: body.scopeRef == null ? null : String(body.scopeRef),
              recurrence: body.recurrence,
              date: body.date || null,
              dayOfWeek: (body.dayOfWeek === 0 || body.dayOfWeek) ? Number(body.dayOfWeek) : null,
              dateFrom: body.dateFrom || null, dateUntil: body.dateUntil || null,
              startMin: toMin(body.startTime), endMin: toMin(body.endTime),
              reason: body.reason || '', createdBy: 'qa',
            });
            return J({ ok: true, action: body.action, block: { id } });
          }
          if (body.action === 'deleteAvailabilityBlock') {
            window.__avbPosts.push(body);
            window.__avbBlocks = window.__avbBlocks.filter((b) => Number(b.id) !== Number(body.id));
            return J({ ok: true, action: body.action, removed: 1 });
          }
          return J({ ok: true });
        }
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [CENTER], activities: ACTIVITIES });
        if (action === 'listAvailabilityBlocks') return J({ ok: true, centerId: 'gembloux', blocks: window.__avbBlocks.slice() });
        return J({ ok: true });
      }
      if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], center: null });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) { /* ignore */ }
  }, { expiresAt });
}

async function bootEstablishment(page) {
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=avb-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function' && typeof state !== 'undefined',
    null, { timeout: 15000 },
  );
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.adminCenterId = 'gembloux';
    state.currentDate = '2026-09-01'; // mardi normal (hors vacances)
    state.isHolidayMode = false;
    state.staffMenuPage = 'establishment';
    setView('staff');
  });
  // Panneau rendu (config chargee) puis blocages charges (liste peuplee).
  await page.waitForSelector('.availability-blocks #avb-scope', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#avbList .availability-item').length >= 4,
    null, { timeout: 15000 },
  );
}

function itemText(page, id) {
  return page.evaluate((blockId) => {
    const li = document.querySelector(`#avbList .availability-item[data-block-id="${blockId}"]`);
    const label = li && li.querySelector('.availability-item-label');
    return label ? label.textContent.trim() : '';
  }, id);
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });
  try {
    await bootEstablishment(page);

    // ---- 1. Libelles humains (center/lane/activity/formula, once/weekly, plage/jour) ----
    const t1a = await itemText(page, 1);
    ok(/Centre ferme/.test(t1a) && /2026-08-15/.test(t1a) && /toute la journee/.test(t1a), 'label-center-once-fullday', JSON.stringify(t1a));
    const t1b = await itemText(page, 2);
    ok(/Piste 3 bloquee/.test(t1b) && /tous les mardis/.test(t1b) && /14:00-16:00/.test(t1b), 'label-lane-weekly-range', JSON.stringify(t1b));
    const t1c = await itemText(page, 3);
    ok(/tous les dimanches/.test(t1c) && /FORMULE 1/.test(t1c) && /bloquee/.test(t1c), 'label-formula-weekly', JSON.stringify(t1c));
    const t1d = await itemText(page, 4);
    ok(/Laser Game/.test(t1d) && /2026-08-16/.test(t1d) && /bloque/.test(t1d), 'label-activity-once', JSON.stringify(t1d));

    // ---- 2. Creer "piste 3, mardi, 14:00-16:00" ----------------------------
    await page.selectOption('#avb-scope', 'lane');
    await page.selectOption('#avb-recurrence', 'weekly');
    await page.selectOption('#avb-lane', '3');
    await page.selectOption('#avb-dow', '2');
    await page.fill('#avb-start', '14:00');
    await page.fill('#avb-end', '16:00');
    await page.click('#avbSubmit');
    await page.waitForFunction(() => window.__avbPosts.some((p) => p.action === 'saveAvailabilityBlock' && p.scopeType === 'lane'), null, { timeout: 5000 }).catch(() => {});
    const saveLane = await page.evaluate(() => window.__avbPosts.filter((p) => p.action === 'saveAvailabilityBlock' && p.scopeType === 'lane').slice(-1)[0] || null);
    ok(saveLane && saveLane.scopeRef === '3', 'save-lane-scoperef', JSON.stringify(saveLane));
    ok(saveLane && saveLane.recurrence === 'weekly' && saveLane.dayOfWeek === 2, 'save-lane-weekly', JSON.stringify(saveLane));
    ok(saveLane && saveLane.startTime === '14:00', 'save-lane-starttime', JSON.stringify(saveLane));
    ok(saveLane && saveLane.endTime === '16:00', 'save-lane-endtime', JSON.stringify(saveLane));
    ok(saveLane && !('centerId' in saveLane), 'save-lane-no-centerid', saveLane ? `keys=${Object.keys(saveLane).join(',')}` : 'aucun POST');

    // ---- 3. Creer "fermer le centre le 2026-08-15 toute la journee" --------
    await page.selectOption('#avb-scope', 'center');
    await page.selectOption('#avb-recurrence', 'once');
    await page.fill('#avb-date', '2026-08-15');
    await page.click('#avbSubmit');
    await page.waitForFunction(() => window.__avbPosts.some((p) => p.action === 'saveAvailabilityBlock' && p.scopeType === 'center'), null, { timeout: 5000 }).catch(() => {});
    const saveCenter = await page.evaluate(() => window.__avbPosts.filter((p) => p.action === 'saveAvailabilityBlock' && p.scopeType === 'center').slice(-1)[0] || null);
    ok(saveCenter && saveCenter.recurrence === 'once' && saveCenter.date === '2026-08-15', 'save-center-once', JSON.stringify(saveCenter));
    ok(saveCenter && !('startTime' in saveCenter) && !('endTime' in saveCenter), 'save-center-fullday', JSON.stringify(saveCenter));
    ok(saveCenter && !('scopeRef' in saveCenter), 'save-center-no-scoperef', JSON.stringify(saveCenter));
    ok(saveCenter && !('centerId' in saveCenter), 'save-center-no-centerid', saveCenter ? `keys=${Object.keys(saveCenter).join(',')}` : 'aucun POST');

    // ---- 4. Supprimer un blocage (id 1) -> POST + disparait de la liste -----
    await page.click('#avbList .availability-item[data-block-id="1"] .availability-del');
    await page.waitForFunction(() => window.__avbPosts.some((p) => p.action === 'deleteAvailabilityBlock'), null, { timeout: 5000 }).catch(() => {});
    const del = await page.evaluate(() => window.__avbPosts.filter((p) => p.action === 'deleteAvailabilityBlock').slice(-1)[0] || null);
    ok(del && Number(del.id) === 1, 'delete-post-id', JSON.stringify(del));
    await page.waitForFunction(() => !document.querySelector('#avbList .availability-item[data-block-id="1"]'), null, { timeout: 5000 }).catch(() => {});
    const stillThere = await page.evaluate(() => !!document.querySelector('#avbList .availability-item[data-block-id="1"]'));
    ok(!stillThere, 'delete-removed-from-list', `encore present=${stillThere}`);

    // ---- 5. Planning bowling : la piste 3 est marquee bloquee le jour affiche ----
    await page.evaluate(() => {
      state.staffMenuPage = 'planning';
      state.currentDate = '2026-09-01';
      if (typeof renderStaff === 'function') renderStaff();
    });
    await page.waitForSelector('#planningGridWrap [data-blocked-lane="3"]', { timeout: 8000 }).catch(() => {});
    const planningState = await page.evaluate(() => ({
      blockedLane3: !!document.querySelector('#planningGridWrap [data-blocked-lane="3"]'),
      laneColBlocked: !!document.querySelector('#planningGridWrap .lane-col[data-lane="3"][data-blocked="1"]'),
      lanes: document.querySelectorAll('#planningGridWrap .lane-col').length,
    }));
    ok(planningState.blockedLane3 && planningState.laneColBlocked, 'planning-lane-blocked', JSON.stringify(planningState));
  } catch (error) {
    ok(false, 'suite-exception', error && error.message);
  } finally {
    await page.close();
  }
  return failures;
}

(async () => {
  const original = fs.readFileSync(SRC, 'utf8');
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('--- passe 1 : gate nominal ---');
    const base = await runSuite(browser, false);
    if (base.length) {
      console.error(`availability-blocks-ui-check: ROUGE en nominal (${base.join(', ')})`);
      process.exitCode = 1;
      return;
    }

    for (const m of MUTATIONS) {
      console.log(`--- contre-preuve par mutation : ${m.name} ---`);
      applyEdit(m.find, m.replace);
      let red;
      try {
        red = await runSuite(browser, true);
      } finally {
        applyEdit(m.replace, m.find); // edition inverse exacte, jamais git checkout
      }
      if (fs.readFileSync(SRC, 'utf8') !== original) {
        console.error('availability-blocks-ui-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`availability-blocks-ui-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`availability-blocks-ui-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`availability-blocks-ui-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('availability-blocks-ui-check: ALL OK (libelles humains center/lane/activity/formula once+weekly plage/jour, save lane weekly HH:MM sans centerId, save center once jour entier sans centerId, delete + disparition, planning piste marquee ; 2 contre-preuves par mutation)');
  } finally {
    try {
      if (fs.readFileSync(SRC, 'utf8') !== original) fs.writeFileSync(SRC, original);
    } catch (e) { /* ignore */ }
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('availability-blocks-ui-check: exception', error && (error.stack || error));
  process.exit(1);
});
