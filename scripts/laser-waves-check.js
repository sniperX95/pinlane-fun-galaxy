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
  await require('./activity-drag-ui-fixture').installActivityMoveFixture(page);
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
    window.__QA_PATCHES__ = []; window.__QA_STORE__ = {};
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10); const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, ...window.__QA_STORE__[r.id] } : r); return J({ ok: true, revision: `qa-${d}-${Object.keys(window.__QA_STORE__).length}`, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') { const b = JSON.parse(init.body || '{}'); window.__QA_PATCHES__.push(b); if (b.activityMove) { const current={...state.reservations.find(r=>Number(r.id)===Number(b.id)),centerId:'libramont'};const result=await window.__qaActivityMove({current,body:b});if(!result.ok)return new Response(JSON.stringify(result),{status:result.status,headers:{'content-type':'application/json'}});window.__QA_STORE__[b.id]=result.reservation;return J(result); } let merged = { ...b }; try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) merged = { ...f, ...b }; } } catch (e) {} window.__QA_STORE__[b.id] = { startTime: merged.startTime, opsPlan: merged.opsPlan, lanes: merged.lanes }; return J({ ok: true, reservation: merged, automation: { communications: 0, jobs: 0, refreshed: true } }); }
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
    const seed = () => {
      const d = '2026-07-18'; // samedi (10:00-24:00 ouvert dans le planning mock)
      state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'laser'; state.staffTheme = 'dark';
      state.staffLaserPlanningExpanded = true; state.staffPlanningExpanded = false;
      state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
      save(); setView('staff'); renderStaff();
    };
    await page.evaluate(seed);
    await page.waitForTimeout(500);
    // L AGENDA DOIT MESURER QUELQUE CHOSE. Le demarrage de la console est
    // asynchrone : un rendu tardif reprend la main apres le seed et referme le
    // planning laser. Les cartes existent alors dans le DOM, mais tous leurs
    // rectangles valent zero (mesure : « carte 0-0, cible 0-0, agenda defilable
    // 0>0 »), et le geste tombe dans le vide. On re-impose la vue tant que
    // l agenda ne mesure rien.
    let agendaPret = false;
    for (let essai = 0; essai < 8 && !agendaPret; essai += 1) {
      agendaPret = await page.evaluate(() => {
        const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
        return Boolean(ag) && ag.getBoundingClientRect().height > 100;
      });
      if (!agendaPret) { await page.evaluate(seed); await page.waitForTimeout(400); }
    }
    ok(agendaPret, 'montage : l agenda du planning laser est rendu et mesurable');

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

    // ON CHOISIT LA CIBLE, PUIS ON L AMENE DANS LA VUE AVEC LA CARTE.
    // L ancien montage defilait pour amener la CARTE au milieu, puis cherchait
    // un slot vide qui se trouvait PAR CHANCE dans la bande visible et assez
    // loin des heures deja prises : un lancement sur deux n en trouvait aucun.
    const pos = await page.evaluate((args) => {
      const { unit, avoid } = args;
      const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
      const card = [...document.querySelectorAll('.laser-group-card[onmousedown*="9500"]')]
        .find(c => c.getAttribute('onmousedown').includes(`, '${unit}')`));
      if (!ag || !card) return { raison: `agenda=${Boolean(ag)} carte=${Boolean(card)}` };
      const eligibles = [...document.querySelectorAll('.laser-session-slot.is-empty[data-laser-drop-start]')]
        .map(el => ({ el, t: Number(el.dataset.laserDropStart) }))
        .filter(o => avoid.every(a => Math.abs(o.t - a) >= 1.0));
      if (!eligibles.length) return { raison: `aucun slot vide a 1h des heures prises (${document.querySelectorAll('.laser-session-slot.is-empty[data-laser-drop-start]').length} vides au total)` };
      // La plus proche de la carte : elles tiennent alors ensemble dans la vue.
      const cible = eligibles
        .map(o => ({ ...o, d: Math.abs(o.el.getBoundingClientRect().top - card.getBoundingClientRect().top) }))
        .sort((a, b) => a.d - b.d)[0];
      const hautBande = 150;
      const basBande = window.innerHeight - 40;
      const milieuVise = hautBande + (basBande - hautBande) / 2;
      for (let essai = 0; essai < 12; essai += 1) {
        const bc = card.getBoundingClientRect();
        const bs = cible.el.getBoundingClientRect();
        const centre = ((bc.top + bc.height / 2) + (bs.top + bs.height / 2)) / 2;
        const ecart = centre - milieuVise;
        if (Math.abs(ecart) <= 2) break;
        ag.scrollTop += ecart;
      }
      const c = card.getBoundingClientRect();
      const b = cible.el.getBoundingClientRect();
      const dansLaBande = (r) => r.height > 4 && r.top > hautBande && r.bottom < basBande;
      if (!dansLaBande(c) || !dansLaBande(b)) return { raison: `bande ${hautBande}-${Math.round(basBande)}, carte ${Math.round(c.top)}-${Math.round(c.bottom)}, cible ${Math.round(b.top)}-${Math.round(b.bottom)}, agenda defilable ${ag.scrollHeight}>${ag.clientHeight}` };
      // DEPUIS LE 2026-10-05 (journaux 378 et 380), une partie lachee sur une
      // ligne de 30 min prend l heure SOUS LE POINTEUR, a 5 min pres
      // (laserTimeFromPoint) : au milieu de la ligne 18:30, c est 18:45. On lache
      // donc 2 px sous le haut de la ligne, la ou l heure attendue est son debut.
      const ligne = cible.el.closest('.laser-agenda-row[data-laser-time-start]') || cible.el;
      const rl = ligne.getBoundingClientRect();
      const debut = Number(ligne.dataset.laserTimeStart ?? cible.t);
      return { card: { x: c.x + c.width/2, y: c.y + c.height/2 }, tgt: { x: b.x + b.width/2, y: rl.top + 2, t: debut } };
    }, { unit: DRAG_UNIT, avoid: beforeReal.windows.map(w => w.start) });
    if (!ok(Boolean(pos && pos.card), `carte ${DRAG_UNIT} + slot vide amenes dans la vue${pos && pos.raison ? ' :: ' + pos.raison : ''}`)) { throw new Error('setup drag introuvable'); }

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
