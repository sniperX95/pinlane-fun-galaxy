// Pages « Pistes bowling » et « Laser Game » de la console : des postes de
// PILOTAGE, pas des listes du jour (verdict Movsar 2026-08-25 : « elles ne
// servent a rien telles quelles, fais un truc super complet, vrm utile »).
// Le gate verifie des CHIFFRES calcules a la main sur un dataset impose :
// performance 30 jours par piste (heures, sous-utilisation), remplissage
// laser 30 jours, et que la maintenance (comportement historique) marche
// toujours. Presence sans comportement = faux vert : chaque assertion lit une
// VALEUR, pas un selecteur.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LANES_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

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
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.edit','reservations.status','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const dstr = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
    const R = [];
    let id = 70000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: new Date().toISOString(), ...o }); };
    // 30 DERNIERS JOURS, chiffres imposes :
    // piste 1 : 18 resas de 2 h = 36 h ; piste 2 : 9 resas de 2 h = 18 h ;
    // pistes 3-8 : rien (sous-utilisation a signaler).
    for (let i = 0; i < 18; i += 1) add({ name: `P1 ${i}`, phone: `+3247100${1000 + i}`, date: dstr(-1 - i), startTime: '14:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [1] });
    for (let i = 0; i < 9; i += 1) add({ name: `P2 ${i}`, phone: `+3247100${2000 + i}`, date: dstr(-1 - i), startTime: '18:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [2] });
    // LASER 30 jours : 10 lancements isoles de 15 joueurs -> remplissage moyen
    // 50 % (capacite 30), 150 joueurs.
    for (let i = 0; i < 10; i += 1) add({ name: `L ${i}`, phone: `+3247100${3000 + i}`, date: dstr(-1 - i), startTime: '19:00', duration: 1, pax: 15, price: 150, type: 'laser', label: 'Laser' });
    // AUJOURD HUI : piste 1 (2 h), piste 2 (1 h), un lancement laser 8 joueurs.
    add({ name: 'Jour P1', phone: '+32471009001', date: dstr(0), startTime: '14:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [1] });
    add({ name: 'Jour P2', phone: '+32471009002', date: dstr(0), startTime: '15:00', duration: 1, pax: 3, price: 30, type: 'bowling', label: 'Bowling', lanes: [2] });
    add({ name: 'Jour Laser', phone: '+32471009003', date: dstr(0), startTime: '15:00', duration: 1, pax: 8, price: 80, type: 'laser', label: 'Laser' });
    const build = () => R.map((r) => ({ ...r }));
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/staff-lanes') { const b = JSON.parse(init.body || '{}'); return J({ ok: true, lane: { lane: b.lane, status: b.status } }); }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests: [] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '22:00' }, '6': { open: '10:00', close: '22:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.__QA_BUILD__ = build;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=lanes-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = todayStr(); state.staffTheme = 'dark';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); openStaffMenuPage('lanes');
    });
    await page.waitForTimeout(900);

    console.log('\n[PISTES BOWLING : performance 30 jours]');
    const perf = await page.evaluate(() => {
      const bloc = document.querySelector('#staffUtilityPage .utility-perf');
      const rows = bloc ? [...bloc.querySelectorAll('.utility-perf-row')] : [];
      const lecture = (n) => {
        const row = rows.find((r) => (r.textContent || '').includes(`Piste ${n}`));
        return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
      };
      return { present: !!bloc, nb: rows.length, p1: lecture(1), p2: lecture(2), p3: lecture(3) };
    });
    ok(perf.present, 'le bloc « Performance 30 jours » existe');
    ok(perf.nb === 8, `une ligne par piste (${perf.nb})`);
    ok(/36\s*h/.test(perf.p1), `piste 1 : 36 h reservees sur 30 j (« ${perf.p1} »)`);
    ok(/18\s*h/.test(perf.p2), `piste 2 : 18 h reservees (« ${perf.p2} »)`);
    ok(/sous-utilis/i.test(perf.p3), `piste 3 (0 h) est signalee sous-utilisee (« ${perf.p3} »)`);
    ok(!/sous-utilis/i.test(perf.p1), 'piste 1 (la meilleure) n est PAS signalee');

    console.log('\n[PISTES BOWLING : le jour et la maintenance]');
    const jour = await page.evaluate(() => {
      const cartes = [...document.querySelectorAll('#staffUtilityPage .utility-lane')];
      const p1 = cartes.find((c) => /Piste 1\b/.test(c.textContent));
      return { cartes: cartes.length, p1: p1 ? p1.textContent.replace(/\s+/g, ' ') : '' };
    });
    ok(jour.cartes === 8, `8 cartes du jour (${jour.cartes})`);
    ok(/2h/.test(jour.p1), `piste 1 : 2 h occupees aujourd hui (« ${jour.p1.slice(0, 80)} »)`);
    // La maintenance MARCHE (comportement, pas presence) : basculer la piste 3.
    await page.evaluate(() => {
      const cartes = [...document.querySelectorAll('#staffUtilityPage .utility-lane')];
      const p3 = cartes.find((c) => /Piste 3\b/.test(c.textContent));
      const btn = [...p3.querySelectorAll('button')].find((b) => /Maintenance$/.test(b.textContent.trim()));
      btn.click();
    });
    await page.waitForTimeout(500);
    const maint = await page.evaluate(() => {
      const cartes = [...document.querySelectorAll('#staffUtilityPage .utility-lane')];
      const p3 = cartes.find((c) => /Piste 3\b/.test(c.textContent));
      return p3 ? p3.className : '';
    });
    ok(/maintenance/.test(maint), `la bascule maintenance marche toujours (${maint})`);

    console.log('\n[LASER GAME : remplissage et manque a gagner]');
    await page.evaluate(() => { openStaffMenuPage('laserGame'); });
    await page.waitForTimeout(900);
    const laser = await page.evaluate(() => {
      const bloc = document.querySelector('#staffUtilityPage .utility-perf');
      const texte = bloc ? bloc.textContent.replace(/\s+/g, ' ').trim() : '';
      const sessions = [...document.querySelectorAll('#staffUtilityPage .utility-session')];
      const ajout = sessions.length ? (sessions[0].querySelector('.utility-inline-action') || {}).textContent || '' : '';
      return { present: !!bloc, texte, sessions: sessions.length, ajout: ajout.trim() };
    });
    ok(laser.present, 'le bloc « Performance 30 jours » laser existe');
    ok(/10\b.*lancement/i.test(laser.texte), `10 lancements sur 30 j (« ${laser.texte.slice(0, 120)} »)`);
    ok(/150\b/.test(laser.texte), '150 joueurs sur 30 j');
    ok(/50\s*%/.test(laser.texte), 'remplissage moyen 50 % (15 joueurs / capacite 30)');
    ok(/150\b.*(vide|restee|libre)|(vide|restee|libre).*150/i.test(laser.texte), `150 places restees vides sur 30 j dites (« ${laser.texte.slice(0, 160)} »)`);
    ok(laser.sessions === 1, `le lancement du jour est liste (${laser.sessions})`);
    ok(/22 places/.test(laser.ajout), `la session du jour peut accueillir 22 joueurs de plus (« ${laser.ajout} »)`);

    ok(errs.length === 0, `zero erreur JS (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } catch (e) {
    console.error('\nlanes-laser-pages-check FAIL:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nlanes-laser-pages-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nlanes-laser-pages-check: ALL OK');
}
main();
