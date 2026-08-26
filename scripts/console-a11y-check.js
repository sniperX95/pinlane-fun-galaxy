// Gate ACCESSIBILITE CONSOLE (audit UX 2026-08-25, P1 : « planning et
// calendrier inaccessibles au clavier ; confirmations natives »).
// Ce que ce gate prouve, au GESTE (pas a la presence) :
//   1. les creneaux du planning bowling se prennent au clavier : focusables,
//      nommes (aria-label), Entree ouvre la resa rapide PREREMPLIE ;
//   2. les blocs de reservation du planning sont des cibles clavier nommees,
//      Entree ouvre le dossier ;
//   3. le calendrier des Reservations se parcourt aux FLECHES (vrais boutons,
//      jour selectionne porte aria-pressed), Entree selectionne le jour ;
//   4. annuler une reservation passe par un dialog PRODUIT (.staff-confirm),
//      jamais par confirm() natif : tout dialog natif rend le gate rouge.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_A11Y_PORT || 4232);
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
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.quick','reservations.edit','reservations.status','reservations.cancel','reservations.delete','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Date LOCALE, jamais toISOString : l app compare a todayStr() (local) ;
    // en zone UTC+2, entre minuit et 2 h, toISOString rend encore la veille
    // et les resas « du jour » du mock tombaient hier (rouge nocturne local,
    // 2026-08-26 ; un runner CI en UTC ne le voit jamais).
    const dstr = (off) => { const d = new Date(); d.setDate(d.getDate() + off); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const R = [
      { id: 81001, name: 'Clavier Un', phone: '+32471008101', date: dstr(0), startTime: '14:00', duration: 1, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [1], status: 'paid', centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: new Date().toISOString() },
      { id: 81002, name: 'Clavier Deux', phone: '+32471008102', date: dstr(-1), startTime: '18:00', duration: 1, pax: 3, price: 45, type: 'bowling', label: 'Bowling', lanes: [2], status: 'paid', centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: new Date().toISOString() },
    ];
    const build = () => R.map((r) => ({ ...r }));
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p, etag) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: etag || 'qa-stable' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') {
        const known = (init.headers && (init.headers['If-None-Match'] || init.headers['if-none-match'])) || '';
        if (known === 'qa-stable') return new Response(null, { status: 304, headers: { etag: 'qa-stable' } });
        return J({ ok: true, revision: 'qa-stable', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      }
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/staff-reservations') {
        const b = JSON.parse(init.body || '{}');
        const found = R.find((r) => String(r.id) === String(b.id)) || {};
        Object.assign(found, b);
        return J({ ok: true, reservation: { ...found } });
      }
      if (u.pathname === '/api/staff-lanes') { const b = JSON.parse(init.body || '{}'); return J({ ok: true, lane: { lane: b.lane, status: b.status } }); }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests: [] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '22:00' }, '6': { open: '10:00', close: '22:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
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
  // Tout dialog NATIF (confirm/alert/prompt) est un echec : la console parle
  // la langue du produit, pas celle du navigateur.
  page.on('dialog', (d) => { errs.push('DIALOG NATIF: ' + d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=a11y-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = todayStr(); state.staffTheme = 'dark';
      save(); setView('staff'); openStaffMenuPage('planning');
    });
    await page.waitForTimeout(1000);

    console.log('\n[PLANNING : les creneaux se prennent au clavier]');
    const cell = await page.evaluate(() => {
      const el = document.querySelector('.slot-cell.clickable');
      return el ? { tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), label: el.getAttribute('aria-label') || '' } : null;
    });
    ok(cell && cell.tabindex === '0' && cell.role === 'button' && /piste/i.test(cell.label),
      `un creneau est focusable, role button, nomme (${cell ? JSON.stringify(cell) : 'absent'})`);
    await page.evaluate(() => { document.querySelector('.slot-cell.clickable').focus(); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const quick = await page.evaluate(() => (typeof quickBookState !== 'undefined' && quickBookState
      ? { lane: (quickBookState.lanes || [])[0], type: quickBookState.type } : { lane: null, type: null }));
    ok(Number(quick.lane) >= 1 && quick.type === 'bowling',
      `Entree sur un creneau ouvre la resa rapide PREREMPLIE (piste ${quick.lane})`);
    await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });
    await page.waitForTimeout(300);

    const booking = await page.evaluate(() => {
      const el = document.querySelector('.booking');
      return el ? { tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), label: el.getAttribute('aria-label') || '' } : null;
    });
    ok(booking && booking.tabindex === '0' && booking.role === 'button' && /Clavier Un/.test(booking.label),
      `un bloc de resa est une cible clavier nommee (${booking ? JSON.stringify(booking) : 'absent'})`);
    await page.evaluate(() => { document.querySelector('.booking').focus(); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const dossier = await page.evaluate(() => state.selectedRes && state.selectedRes.name);
    ok(dossier === 'Clavier Un', `Entree sur le bloc ouvre le dossier (${dossier})`);
    await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });
    await page.waitForTimeout(300);

    console.log('\n[RESERVATIONS : le calendrier se parcourt aux fleches]');
    await page.evaluate(() => { openStaffMenuPage('reservations'); });
    await page.waitForTimeout(900);
    const cal = await page.evaluate(() => {
      const today = todayStr();
      const selected = document.querySelector('.pv2-cal-cell[aria-pressed="true"]');
      const cellToday = document.querySelector(`.pv2-cal-cell[data-cal-date="${today}"]`);
      return {
        buttons: [...document.querySelectorAll('button.pv2-cal-cell')].length,
        selectedDate: selected ? selected.dataset.calDate : '',
        todayFocusable: !!cellToday && cellToday.tagName === 'BUTTON',
      };
    });
    ok(cal.buttons >= 28, `les jours du calendrier sont de vrais boutons (${cal.buttons})`);
    ok(cal.selectedDate !== '', `le jour selectionne porte aria-pressed (${cal.selectedDate})`);
    ok(cal.todayFocusable, 'la cellule du jour est un bouton focusable');
    // Fleche gauche depuis aujourd hui -> le focus se pose sur hier.
    await page.evaluate(() => { document.querySelector(`.pv2-cal-cell[data-cal-date="${todayStr()}"]`).focus(); });
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    const apresFleche = await page.evaluate(() => {
      // Meme regle que le mock : date LOCALE (toISOString = la veille avant 2 h).
      const d = new Date(); d.setDate(d.getDate() - 1);
      const pad = (n) => String(n).padStart(2, '0');
      const hier = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return { attendu: hier, focus: document.activeElement ? document.activeElement.dataset.calDate || '' : '' };
    });
    ok(apresFleche.focus === apresFleche.attendu,
      `la fleche gauche deplace le focus d un jour (${apresFleche.focus} = ${apresFleche.attendu})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const selectionne = await page.evaluate(() => {
      const selected = document.querySelector('.pv2-cal-cell[aria-pressed="true"]');
      return selected ? selected.dataset.calDate : '';
    });
    ok(selectionne === apresFleche.attendu, `Entree selectionne le jour et aria-pressed suit (${selectionne})`);

    console.log('\n[ANNULATION : un dialog PRODUIT, jamais confirm() natif]');
    await page.evaluate(() => { cancelRes(81001); });
    await page.waitForTimeout(500);
    const dialog = await page.evaluate(() => {
      const box = document.querySelector('.staff-confirm');
      return {
        present: !!box,
        role: box ? box.getAttribute('role') : '',
        texte: box ? box.textContent.replace(/\s+/g, ' ').trim() : '',
        focusDansDialog: box ? box.contains(document.activeElement) : false,
      };
    });
    ok(dialog.present && dialog.role === 'alertdialog', `le dialog produit s ouvre (role ${dialog.role})`);
    ok(/annuler/i.test(dialog.texte), `il dit ce qu il fait (« ${dialog.texte.slice(0, 70)} »)`);
    ok(dialog.focusDansDialog, 'le focus est dans le dialog (clavier direct)');
    // Echap = non : rien ne change.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const apresEchap = await page.evaluate(() => ({
      dialog: !!document.querySelector('.staff-confirm'),
      statut: (state.reservations.find((r) => String(r.id) === '81001') || {}).status,
    }));
    ok(!apresEchap.dialog && apresEchap.statut === 'paid', `Echap referme sans rien detruire (statut ${apresEchap.statut})`);
    // Confirmer pour de vrai : le dossier passe annule.
    await page.evaluate(() => { cancelRes(81001); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('.staff-confirm [data-role="confirm-ok"]').click(); });
    await page.waitForTimeout(700);
    const statutFinal = await page.evaluate(() => (state.reservations.find((r) => String(r.id) === '81001') || {}).status);
    ok(statutFinal === 'cancelled', `confirmer annule vraiment le dossier (${statutFinal})`);

    ok(errs.length === 0, `zero erreur JS et zero dialog natif (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } catch (e) {
    console.error('\nconsole-a11y-check FAIL:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nconsole-a11y-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nconsole-a11y-check: ALL OK');
}
main();
