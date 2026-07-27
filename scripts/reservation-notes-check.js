// BUG 4 : les demandes particulieres doivent etre REPERABLES dans les listes
// existantes. Ce gate pilote un vrai navigateur : il verifie que la liste dense
// du jour affiche un marqueur « Note a lire » et un marqueur d'occasion sur les
// reservations concernees, que la puce « Avec note » filtre reellement, et que
// rien de tout cela n'apparait quand la donnee ne le justifie pas.
// Contre-preuves incluses (controle negatif + mutation du source).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_NOTES_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const APP_MAIN = path.join(ROOT, 'assets', 'app-main.js');

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
    const perms = ['dashboard.view', 'planning.view', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'clients.view', 'clients.edit', 'emails.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    let id = 9100;
    const R = [];
    const add = (o) => { R.push({ id: id++, date: today, lanes: [], status: 'pending', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, type: 'bowling', label: 'Bowling', price: 100, pax: 6, ...o }); };
    // 1 : demande particuliere ecrite par le client + occasion declaree
    add({ name: 'Sarah Note', phone: '+32470900001', startTime: '15:00', lanes: [1], occasion: 'anniversaire', notes: 'Gateau a 16h30, allergie aux noix' });
    // 2 : occasion declaree SANS aucune note (controle : tag occasion, pas de tag note)
    add({ name: 'Team Vide', phone: '+32470900002', startTime: '16:00', lanes: [2], occasion: 'entreprise', notes: '' });
    // 3 : ni note ni occasion (controle negatif pur)
    add({ name: 'Client Neutre', phone: '+32470900003', startTime: '17:00', lanes: [3] });
    // 4 : notes UNIQUEMENT un marqueur de simulation -> ne doit JAMAIS compter
    add({ name: 'Resa Simulee', phone: '+32470900004', startTime: '18:00', lanes: [4], notes: '[SIM:run-42]' });
    const build = () => R.map(r => ({ ...r }));
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops') return J({ ok: true, customRequests: [], communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.__QA_BUILD__ = build;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// Etat de la liste du jour : marqueurs par client + puce de filtre.
const READ_LIST = () => {
  const cards = [...document.querySelectorAll('#resList .res-row')];
  const byName = {};
  cards.forEach((row) => {
    const text = row.textContent || '';
    const name = ['Sarah Note', 'Team Vide', 'Client Neutre', 'Resa Simulee'].find((n) => text.includes(n));
    if (!name) return;
    byName[name] = {
      note: !!row.querySelector('.reservation-tag.note'),
      occasion: row.querySelector('.reservation-tag.occasion')?.textContent.trim() || '',
    };
  });
  const chip = [...document.querySelectorAll('#resList .status-chip')].find((b) => /Avec note/.test(b.textContent));
  return {
    names: Object.keys(byName),
    byName,
    chipText: chip ? chip.textContent.replace(/\s+/g, ' ').trim() : '',
    chipActive: !!chip && chip.classList.contains('active'),
    visible: ['Sarah Note', 'Team Vide', 'Client Neutre', 'Resa Simulee'].filter((n) => cards.some((row) => (row.textContent || '').includes(n))),
    counts: typeof getStaffStatusCounts === 'function' ? getStaffStatusCounts(scopedStaffReservations(getStaffResourceView())) : null,
  };
};

async function boot(page) {
  await page.goto(`${BASE_URL}/?v=notes-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    state.currentDate = todayStr();
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'all';
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.reservations = window.__QA_BUILD__();
    save(); setView('staff'); renderStaff();
  });
  await page.waitForTimeout(600);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  const originalAppMain = fs.readFileSync(APP_MAIN, 'utf8');
  let mutated = false;
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await boot(page);

    console.log('\n[MARQUEURS] la liste du jour signale la note et l occasion');
    const base = await page.evaluate(READ_LIST);
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' -> ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(base.visible.length === 4, `les 4 reservations du jour sont listees (${base.visible.join(', ')})`);
    ok(base.byName['Sarah Note']?.note === true, 'la reservation porteuse d une demande affiche le marqueur « Note a lire »');
    ok(base.byName['Client Neutre']?.note === false, 'CONTROLE NEGATIF : une reservation sans note n affiche aucun marqueur');
    ok(base.byName['Resa Simulee']?.note === false, 'un marqueur de simulation [SIM:] ne compte PAS comme une demande');
    ok(/Anniversaire/.test(base.byName['Sarah Note']?.occasion || ''), `l occasion declaree est affichee (« ${base.byName['Sarah Note']?.occasion} »)`);
    ok(/Entreprise/.test(base.byName['Team Vide']?.occasion || ''), `occasion sans note : tag occasion seul (« ${base.byName['Team Vide']?.occasion} »)`);
    ok(base.byName['Team Vide']?.note === false, 'occasion declaree sans texte : pas de marqueur « Note a lire »');
    ok(base.counts && base.counts.notes === 1, `compteur de notes = 1, pas 2 (obtenu ${base.counts?.notes})`);

    console.log('\n[FILTRE] la puce « Avec note » isole les reservations concernees');
    ok(/Avec note/.test(base.chipText) && /1/.test(base.chipText), `puce « Avec note » chiffree (« ${base.chipText} »)`);
    // Vrai clic sur la puce : c'est l'interaction que le staff fait, pas un
    // appel de fonction. Un onclick casse doit faire rougir ce gate.
    await page.evaluate(() => [...document.querySelectorAll('#resList .status-chip')].find((b) => /Avec note/.test(b.textContent)).click());
    await page.waitForTimeout(400);
    const filtered = await page.evaluate(READ_LIST);
    ok(filtered.visible.length === 1 && filtered.visible[0] === 'Sarah Note', `filtre applique : seule la resa avec note reste (${filtered.visible.join(', ') || 'aucune'})`);
    ok(filtered.chipActive, 'la puce active est visuellement marquee');

    console.log('\n[RELACHE] plus aucune note -> le filtre ne peut pas laisser un ecran vide');
    await page.evaluate(() => {
      state.reservations = state.reservations.map((r) => ({ ...r, notes: '' }));
      save(); renderStaff();
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(READ_LIST);
    const filterAfter = await page.evaluate(() => state.staffStatusFilter);
    ok(filterAfter === 'all', `le filtre « notes » s est relache tout seul (obtenu ${filterAfter})`);
    ok(!after.chipText, 'la puce « Avec note » disparait quand il n y a plus de note');
    ok(after.visible.length === 4, `aucune reservation perdue (${after.visible.length}/4)`);

    console.log('\n[CONTRE-PREUVE] mutation du source : le gate doit rougir');
    // hasReservationNote neutralise -> plus aucun marqueur, plus aucune puce.
    // Fins de ligne CRLF dans le repo : la mutation se fait par regex tolerante.
    const broken = originalAppMain.replace(
      /function hasReservationNote\(reservation\) \{\r?\n\s*return !!getReservationNoteText\(reservation\);\r?\n\}/,
      'function hasReservationNote(reservation) { return false; }'
    );
    if (broken === originalAppMain) {
      ok(false, 'mutation impossible : la signature de hasReservationNote a change, ce gate ne prouve plus rien');
    } else {
      fs.writeFileSync(APP_MAIN, broken, 'utf8');
      mutated = true;
      await boot(page);
      const mutatedRead = await page.evaluate(READ_LIST);
      ok(mutatedRead.byName['Sarah Note']?.note === false && !mutatedRead.chipText,
        'source casse : marqueur ET puce disparaissent (le test verifiait bien un comportement)');
      fs.writeFileSync(APP_MAIN, originalAppMain, 'utf8');
      mutated = false;
      await boot(page);
      const restored = await page.evaluate(READ_LIST);
      ok(restored.byName['Sarah Note']?.note === true && /Avec note/.test(restored.chipText),
        'source restaure : marqueur et puce reviennent (edition inverse propre)');
    }

    if (errs.length) console.log('\nConsole errors:\n' + errs.join('\n'));
  } catch (e) {
    console.error('\nreservation-notes-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    if (mutated) fs.writeFileSync(APP_MAIN, originalAppMain, 'utf8');
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nreservation-notes-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreservation-notes-check: ALL OK');
}
main();
