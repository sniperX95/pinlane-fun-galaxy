// Test INTERACTIF du glisser-déposer du planning (Playwright pilote un vrai
// mousedown -> move -> up sur l'app servie localement). Couvre les régressions
// que `browser-modules` (vm, ne charge pas app-main), `visual` (screenshote sans
// piloter) et `node --check` (syntaxe seule) NE VOIENT PAS. Cf. leçon
// « ship-interactive-ui-tested » : ne plus livrer de drag non testé au glisser.
//
// Scénarios :
//   A. Bowling (mode normal) : déposer une carte ne fait PAS remonter la page.
//   B. Bowling : curseur près du bord haut pendant le drag ne happe PAS la page.
//   C. Laser PLEIN ÉCRAN : déposer une carte ne remet PAS la timeline en haut.
//   D. Laser : glisser une carte placée vers « Parties à placer » la dé-planifie.
//   E. Laser : re-glisser la carte en attente vers un slot la replace.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DRAG_PORT || 4193);
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
    const build = (date) => ([
      { id: 9001, name: 'Anniv Lina #9001', phone: '+32470860011', email: 'a@x.test', date, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 20, type: 'bowling', label: 'Bowling' },
      { id: 9002, name: 'Famille Lambert #9002', phone: '+32470860012', email: 'b@x.test', date, startTime: '14:30', duration: 1, lanes: [2], status: 'arrived', pax: 4, price: 39, type: 'bowling', label: 'Bowling' },
      { id: 9004, name: 'Ecole SH #9004', phone: '+32470860014', email: 'd@x.test', date, startTime: '18:00', duration: 2, lanes: [4,6,8], status: 'confirmed', pax: 17, price: 234, type: 'bowling', label: 'Bowling 2h' },
      { id: 9010, name: 'Ansar Bisultanov #9010', phone: '+32470860010', email: 'ansar@x.test', date, startTime: '17:30', duration: 0.5, lanes: [], status: 'confirmed', pax: 4, price: 20, type: 'laser', label: 'Laser direct' },
    ]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.__QA_PATCHES__ = [];
    window.__QA_STORE__ = {};
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10); const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, ...window.__QA_STORE__[r.id] } : r); return J({ ok: true, revision: `qa-${d}-${Object.keys(window.__QA_STORE__).length}`, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_PATCHES__.push(b);
        let merged = { ...b };
        try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) merged = { ...f, ...b }; } } catch (e) {}
        window.__QA_STORE__[b.id] = { startTime: merged.startTime, opsPlan: merged.opsPlan, lanes: merged.lanes };
        return J({ ok: true, reservation: merged, automation: { communications: 0, jobs: 0, refreshed: true } });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0,10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0,10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function seedBowling(page) {
  await page.evaluate(() => {
    // Date FIXE ouverte (samedi 10:00-24:00) → test déterministe, jamais faussé par
    // un jour de fermeture (ex. lundi) où la grille planning ne rend pas de créneaux.
    const d = '2026-07-18';
    state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = false; state.staffPlanningExpanded = false;
    state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
    save(); setView('staff'); renderStaff();
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  const pageTop = () => page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  const setPageTop = (v) => page.evaluate((val) => { (document.scrollingElement || document.documentElement).scrollTop = val; }, v);
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=drag-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await seedBowling(page);
    await page.waitForTimeout(400);

    // --- A : bowling normal, drop au centre, page immobile ---
    console.log('\n[A] Bowling normal : drop ne fait pas remonter la page');
    await setPageTop(400);
    const beforeA = await pageTop();
    const posA = await page.evaluate(() => {
      const src = document.querySelector('.booking[data-booking-res-id="9002"]');
      const tgt = document.querySelector('.slot-cell[data-bowling-drop-lane="5"][data-bowling-drop-start="16"]') || document.querySelector('.slot-cell[data-bowling-drop-lane="5"]');
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; };
      return { src: r(src), tgt: r(tgt), before: (state.reservations.find(x=>x.id===9002)||{}).startTime };
    });
    await page.mouse.move(posA.src.x, posA.src.y); await page.mouse.down();
    await page.mouse.move(posA.src.x + 8, posA.src.y + 8, { steps: 2 });
    await page.mouse.move(posA.tgt.x, Math.min(Math.max(posA.tgt.y, 150), 500), { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(350);
    const afterA = await pageTop();
    const movedA = await page.evaluate(() => (state.reservations.find(x=>x.id===9002)||{}).startTime);
    ok(Math.abs(afterA - beforeA) <= 20, `page immobile pendant le drop (${beforeA} -> ${afterA})`);
    ok(movedA !== posA.before, `la résa 9002 a bien été déplacée (${posA.before} -> ${movedA})`);

    // --- B : bowling, curseur près du bord haut, page immobile ---
    console.log('\n[B] Bowling : curseur au bord haut ne happe pas la page');
    await page.evaluate(() => { state.reservations = window.__QA_BUILD__(state.currentDate); save(); renderStaff(); });
    await page.waitForTimeout(150); await setPageTop(500);
    const beforeB = await pageTop();
    const posB = await page.evaluate(() => { const el = document.querySelector('.booking[data-booking-res-id="9004"]') || document.querySelector('.booking'); const b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; });
    await page.mouse.move(posB.x, posB.y); await page.mouse.down();
    await page.mouse.move(posB.x + 8, posB.y + 8, { steps: 2 });
    await page.mouse.move(posB.x, 30, { steps: 4 }); await page.waitForTimeout(600);
    const duringB = await pageTop();
    await page.mouse.up(); await page.waitForTimeout(150);
    ok(Math.abs(duringB - beforeB) <= 20, `page immobile malgré le bord haut (${beforeB} -> ${duringB})`);

    // --- F : le toast de confirmation ne doit pas voler les clics ---
    // Movsar, revue manager : « les reservations de 30 minutes dont le changement
    // d heure ne s applique pas ». Le drag lui-meme fonctionne (A et B le
    // prouvent) ; ce qui bloque, c est le toast affiche 2,5 s apres CHAQUE
    // deplacement. Il est en position fixed au-dessus du planning, et une carte
    // de 30 min ne fait que ~22 px de haut contre 40 px de toast : elle peut
    // etre TOTALEMENT recouverte, et n a alors plus aucun point de prise. Une
    // carte d 1 h ou 2 h en depasse toujours, d ou un defaut qui ne se voit que
    // sur les demi-heures.
    console.log('\n[F] Le toast de confirmation ne vole pas les clics du planning');
    // Le toast ne fait que ~248 px de large, centre dans la fenetre : la carte
    // doit tomber dans son rectangle en X ET en Y, sinon on ne teste rien. On
    // cherche donc d abord la piste dont la colonne passe sous son centre, et on
    // pose la reservation de 30 min sur CELLE-LA.
    const pisteF = await page.evaluate(() => {
      state.reservations = window.__QA_BUILD__(state.currentDate);
      state.staffResourceView = 'bowling'; state.staffPlanningExpanded = false;
      save(); renderStaff();
      toast('Bowling deplace a 16:00 piste 5');
      const tr = document.getElementById('toast').getBoundingClientRect();
      const centreX = tr.left + tr.width / 2;
      const cellule = [...document.querySelectorAll('.slot-cell[data-bowling-drop-lane]')]
        .find((c) => { const b = c.getBoundingClientRect(); return b.left <= centreX && b.right >= centreX; });
      return cellule ? Number(cellule.dataset.bowlingDropLane) : null;
    });
    if (ok(Number.isFinite(pisteF), `une piste passe sous le toast (piste ${pisteF})`)) {
      await page.evaluate((piste) => {
        state.reservations.push({ id: 9020, name: 'Demi heure #9020', phone: '+32470860020', email: 'f@x.test', date: state.currentDate, startTime: '20:00', duration: 0.5, lanes: [piste], status: 'confirmed', pax: 2, price: 12, type: 'bowling', label: 'Bowling 30 min' });
        save(); renderStaff();
      }, pisteF);
      await page.waitForTimeout(350);
      // On CONSTRUIT la situation au lieu de l esperer : le planning est fait
      // defiler jusqu a ce que la carte tombe dans le rectangle du toast.
      const posF = await page.evaluate((piste) => {
        toast('Bowling deplace a 16:00 piste 5');
        const toastEl = document.getElementById('toast');
        const carte = document.querySelector('.booking[data-booking-res-id="9020"]');
        if (!toastEl || !carte) return { erreur: 'carte ou toast absent' };
        let scroller = carte.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight + 4) scroller = scroller.parentElement;
        const tr = toastEl.getBoundingClientRect();
        const vise = tr.top + tr.height / 2;
        for (let essai = 0; essai < 12; essai += 1) {
          const cr = carte.getBoundingClientRect();
          const ecart = (cr.top + cr.height / 2) - vise;
          if (Math.abs(ecart) <= 2) break;
          if (scroller) scroller.scrollTop += ecart;
          else (document.scrollingElement || document.documentElement).scrollTop += ecart;
        }
        const cr = carte.getBoundingClientRect();
        const point = { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 };
        const dansLeToast = point.x >= tr.left && point.x <= tr.right && point.y >= tr.top && point.y <= tr.bottom;
        const dessous = document.elementFromPoint(point.x, point.y);
        const autrePiste = piste === 7 ? 5 : 7;
        const cible = document.querySelector(`.slot-cell[data-bowling-drop-lane="${autrePiste}"][data-bowling-drop-start="16"]`)
          || document.querySelector(`.slot-cell[data-bowling-drop-lane="${autrePiste}"]`);
        const cb = cible ? cible.getBoundingClientRect() : null;
        return {
          hauteurCarte: Math.round(cr.height),
          hauteurToast: Math.round(tr.height),
          dansLeToast,
          dessous: dessous ? `${dessous.tagName}#${dessous.id || 'sans-id'}` : 'rien',
          cestLeToast: !!(dessous && (dessous.id === 'toast' || (dessous.closest && dessous.closest('#toast')))),
          point,
          cible: cb ? { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 } : null,
          avant: (state.reservations.find((x) => x.id === 9020) || {}).startTime,
        };
      }, pisteF);
      if (ok(posF && !posF.erreur && posF.cible, `situation construite (carte ${posF && posF.hauteurCarte}px, toast ${posF && posF.hauteurToast}px)`)) {
        // Prerequis : sans lui, les assertions suivantes ne prouveraient rien.
        ok(posF.dansLeToast, `le point de prise tombe DANS le rectangle du toast (${posF.dansLeToast})`);
        ok(!posF.cestLeToast, `et atteint quand meme la carte, pas le toast (${posF.dessous})`);
        await page.mouse.move(posF.point.x, posF.point.y); await page.mouse.down();
        await page.mouse.move(posF.point.x + 8, posF.point.y - 8, { steps: 2 });
        await page.mouse.move(posF.cible.x, posF.cible.y, { steps: 8 });
        await page.mouse.up(); await page.waitForTimeout(400);
        const apresF = await page.evaluate(() => (state.reservations.find((x) => x.id === 9020) || {}).startTime);
        ok(apresF !== posF.avant, `la resa de 30 min a bien bouge malgre le toast (${posF.avant} -> ${apresF})`);
        // CONTRE-EPREUVE : sans toast, le meme geste doit marcher. Si celle-ci
        // echoue, l assertion precedente ne prouvait rien du tout.
        const posG = await page.evaluate(() => {
          document.getElementById('toast').classList.add('hidden');
          const carte = document.querySelector('.booking[data-booking-res-id="9020"]');
          const cible = document.querySelector('.slot-cell[data-bowling-drop-lane="1"][data-bowling-drop-start="12"]') || document.querySelector('.slot-cell[data-bowling-drop-lane="1"]');
          if (!carte || !cible) return null;
          const cr = carte.getBoundingClientRect(); const cb = cible.getBoundingClientRect();
          return { src: { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 }, tgt: { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, avant: (state.reservations.find((x) => x.id === 9020) || {}).startTime };
        });
        if (ok(!!posG, 'contre-epreuve : carte et cible presentes')) {
          await page.mouse.move(posG.src.x, posG.src.y); await page.mouse.down();
          await page.mouse.move(posG.src.x + 8, posG.src.y - 8, { steps: 2 });
          await page.mouse.move(posG.tgt.x, posG.tgt.y, { steps: 8 });
          await page.mouse.up(); await page.waitForTimeout(400);
          const apresG = await page.evaluate(() => (state.reservations.find((x) => x.id === 9020) || {}).startTime);
          ok(apresG !== posG.avant, `sans toast, le meme geste deplace bien la carte (${posG.avant} -> ${apresG})`);
        }
      }
    }

    // --- C/D/E : laser plein écran ---
    await page.evaluate(() => { state.reservations = window.__QA_BUILD__(state.currentDate); state.staffResourceView = 'laser'; state.staffLaserPlanningExpanded = true; save(); renderStaff(); });
    await page.waitForTimeout(400);

    console.log('\n[C] Laser plein écran : drop ne remet pas la timeline en haut');
    const agC = await page.evaluate(() => {
      const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
      const card = document.querySelector('.laser-group-card[onmousedown*="9010"]');
      if (!ag || !card) return { ok: false };
      const top = card.getBoundingClientRect().top - ag.getBoundingClientRect().top + ag.scrollTop;
      ag.scrollTop = Math.max(120, top - 240);
      return { ok: true, canScroll: ag.scrollHeight > ag.clientHeight + 1, scrollTop: ag.scrollTop };
    });
    if (ok(agC.ok && agC.canScroll, 'timeline laser défilable en plein écran')) {
      const posC = await page.evaluate(() => {
        const card = document.querySelector('.laser-group-card[onmousedown*="9010"]');
        const cb = card.getBoundingClientRect();
        const slots = [...document.querySelectorAll('.laser-session-slot.is-empty[data-laser-drop-start]')].map(s => ({ s, b: s.getBoundingClientRect() })).filter(o => o.b.top > 160 && o.b.bottom < window.innerHeight - 40);
        const pick = slots[Math.floor(slots.length/2)] || slots[0];
        return { card: { x: cb.x + cb.width/2, y: cb.y + cb.height/2 }, tgt: pick ? { x: pick.b.x + pick.b.width/2, y: pick.b.y + pick.b.height/2, t: pick.s.dataset.laserDropStart } : null };
      });
      if (ok(!!posC.tgt, 'un slot vide visible pour le drop')) {
        const beforeC = await page.evaluate(() => document.querySelector('.laser-planning-box.expanded .laser-agenda').scrollTop);
        await page.mouse.move(posC.card.x, posC.card.y); await page.mouse.down();
        await page.mouse.move(posC.card.x + 8, posC.card.y + 8, { steps: 2 });
        await page.mouse.move(posC.tgt.x, posC.tgt.y, { steps: 8 }); await page.mouse.up();
        await page.waitForTimeout(400);
        const afterC = await page.evaluate(() => { const a = document.querySelector('.laser-planning-box.expanded .laser-agenda'); return a ? a.scrollTop : null; });
        const movedC = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); const w = getLaserWindowsFromReservation(r); return w.length ? w[0].start : null; });
        ok(Math.abs(afterC - beforeC) <= 20, `timeline immobile pendant le drop (${beforeC} -> ${afterC})`);
        ok(movedC !== null && Math.abs(Number(movedC) - Number(posC.tgt.t)) <= 0.01, `la partie s'est bien déplacée (${posC.tgt.t})`);
      }
    }

    console.log('\n[D] Laser : glisser une carte placée vers « Parties à placer » = dé-planifier');
    await page.evaluate(() => {
      const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
      const card = document.querySelector('.laser-group-card[onmousedown*="9010"]');
      if (ag && card) { const top = card.getBoundingClientRect().top - ag.getBoundingClientRect().top + ag.scrollTop; ag.scrollTop = Math.max(0, top - 220); }
    });
    await page.waitForTimeout(150);
    const posD = await page.evaluate(() => {
      const card = document.querySelector('.laser-group-card[onmousedown*="9010"]');
      const queue = document.querySelector('.laser-pass-queue');
      if (!card || !queue) return null;
      const c = card.getBoundingClientRect(), q = queue.getBoundingClientRect();
      return { card: { x: c.x + c.width/2, y: c.y + c.height/2 }, queue: { x: q.x + q.width/2, y: Math.min(q.y + 120, q.y + q.height/2) } };
    });
    if (ok(!!posD, 'carte placée + file « Parties à placer » présentes')) {
      await page.mouse.move(posD.card.x, posD.card.y); await page.mouse.down();
      await page.mouse.move(posD.card.x + 8, posD.card.y + 8, { steps: 2 });
      await page.mouse.move(posD.queue.x, posD.queue.y, { steps: 10 }); await page.mouse.up();
      await page.waitForTimeout(450);
      const afterD = await page.evaluate(() => {
        const r = state.reservations.find(x => x.id === 9010);
        const patch = (window.__QA_PATCHES__ || []).slice(-1)[0] || null;
        return { windows: getLaserWindowsFromReservation(r).length, laserManual: !!r.opsPlan?.laserManual, pending: getPendingLaserPasses(state.currentDate).map(p => p.reservation.id), inQueue: !!document.querySelector('.laser-pass-card[onmousedown*="9010"]'), onGrid: !!document.querySelector('.laser-group-card[onmousedown*="9010"]'), skipReplan: patch ? patch.skipReplan : null, patchManual: patch ? !!patch.opsPlan?.laserManual : null };
      });
      ok(afterD.windows === 0, 'la partie quitte le planning');
      ok(afterD.laserManual === true, 'opsPlan.laserManual = true');
      ok(afterD.pending.includes(9010), 'apparaît dans « Parties à placer »');
      ok(afterD.inQueue && !afterD.onGrid, 'carte dans la file, plus sur le grid');
      ok(afterD.skipReplan === true && afterD.patchManual === true, 'PATCH persiste le marqueur (skipReplan + laserManual)');
      // survit à un poll serveur
      await page.evaluate(async () => { if (typeof refreshStaffState === 'function') { try { await refreshStaffState(); } catch (e) {} } });
      await page.waitForTimeout(300);
      const poll = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); return { w: getLaserWindowsFromReservation(r).length, p: getPendingLaserPasses(state.currentDate).map(x=>x.reservation.id) }; });
      ok(poll.w === 0 && poll.p.includes(9010), 'reste dé-placé après un poll serveur');

      console.log('\n[E] Laser : re-glisser la carte en attente vers un slot = replacer');
      const posE = await page.evaluate(() => {
        const card = document.querySelector('.laser-pass-card[onmousedown*="9010"]');
        const slots = [...document.querySelectorAll('.laser-session-slot.is-empty[data-laser-drop-start]')].map(s => ({ s, b: s.getBoundingClientRect() })).filter(o => o.b.top > 160 && o.b.bottom < window.innerHeight - 40);
        const pick = slots[Math.floor(slots.length/2)] || slots[0];
        if (!card || !pick) return null;
        const c = card.getBoundingClientRect();
        return { card: { x: c.x + c.width/2, y: c.y + c.height/2 }, tgt: { x: pick.b.x + pick.b.width/2, y: pick.b.y + pick.b.height/2, t: pick.s.dataset.laserDropStart } };
      });
      if (ok(!!posE, 'carte en attente + slot vide présents')) {
        await page.mouse.move(posE.card.x, posE.card.y); await page.mouse.down();
        await page.mouse.move(posE.card.x + 8, posE.card.y + 8, { steps: 2 });
        await page.mouse.move(posE.tgt.x, posE.tgt.y, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(450);
        const afterE = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); const w = getLaserWindowsFromReservation(r); return { start: w.length ? w[0].start : null, pending: getPendingLaserPasses(state.currentDate).map(p=>p.reservation.id), onGrid: !!document.querySelector('.laser-group-card[onmousedown*="9010"]') }; });
        ok(afterE.start !== null && Math.abs(Number(afterE.start) - Number(posE.tgt.t)) <= 0.01, `re-placée au créneau ${posE.tgt.t}`);
        ok(!afterE.pending.includes(9010) && afterE.onGrid, 'de retour sur le planning, plus dans la file');
      }
    }

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nlaser-drag-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nlaser-drag-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nlaser-drag-check: ALL OK');
}
main();
