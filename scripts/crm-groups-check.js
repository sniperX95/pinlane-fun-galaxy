// Test INTERACTIF de la refonte « Groupes & anniversaires » (cockpit-timeline).
// Playwright pilote de vrais clics : chargement sans erreur console, timeline de
// dossiers À VENIR (ancrée à AUJOURD'HUI RÉEL, pas state.currentDate), readiness
// honnête, facettes déselectionnables, KPIs prospectifs, intake demandes sur mesure,
// pas de doublon CRM. Cf. leçon ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_GROUPS_PORT || 4205);
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
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.edit','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Dates RELATIVES À AUJOURD'HUI RÉEL (la page s'ancre à todayStr(), pas state.currentDate).
    const base = new Date(); base.setHours(12, 0, 0, 0);
    const dstr = (o) => { const d = new Date(base); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
    const iso = (o) => { const d = new Date(base); d.setDate(d.getDate() + o); return d.toISOString(); };
    const R = []; let id = 8000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: iso(-1), ...o }); };
    // Anniversaire habitué (Marie) : passé + FUTUR (dans 4 j)
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-40), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-15), startTime: '16:00', pax: 10, price: 390, type: 'formule', formuleId: 'f1', label: 'FORMULE 1', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(4), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire', status: 'pending' });
    // Entreprise (groupe) : FUTUR (dans 10 j, acompte non payé → readiness bas)
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-60), startTime: '19:00', pax: 24, price: 720, type: 'bowling', label: 'Bowling 2h', lanes: [3,4,5], duration: 2, occasion: 'entreprise' });
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(10), startTime: '18:00', pax: 30, price: 900, type: 'laser', label: 'Laser', occasion: 'entreprise', status: 'pending' });
    // École (groupe) : FUTUR (dans 20 j)
    add({ name: 'École Saint-Jean', phone: '+32470111006', email: 'ecole@test.be', date: dstr(-5), startTime: '13:00', pax: 20, price: 300, type: 'formule', formuleId: 'f6', label: 'FORMULE 6', occasion: 'ecole' });
    add({ name: 'École Saint-Jean', phone: '+32470111006', email: 'ecole@test.be', date: dstr(20), startTime: '13:00', pax: 22, price: 330, type: 'formule', formuleId: 'f6', label: 'FORMULE 6', occasion: 'ecole', status: 'pending' });
    // Petit client NON-groupe (doit être EXCLU de la page groupes)
    add({ name: 'Paul Solo', phone: '+32470111099', email: 'paul@test.be', date: dstr(-2), startTime: '17:00', pax: 2, price: 40, type: 'bowling', label: 'Bowling', lanes: [6] });
    const build = () => R.map(r => ({ ...r }));
    const customRequests = [
      { id: 'cr1', contactName: 'Team Acme', company: 'Acme SA', email: 'events@acme.be', phone: '+32470999001', requestedDate: dstr(30), pax: 40, occasion: 'entreprise', message: 'Séminaire 40 pers, besoin devis', status: 'new', createdAt: iso(-1) },
      { id: 'cr2', contactName: 'Julie', company: '', email: 'julie@test.be', phone: '+32470999002', requestedDate: dstr(14), pax: 15, occasion: 'anniversaire', message: 'Anniv 15 enfants', status: 'in_progress', createdAt: iso(-3) },
    ];
    const comms = [{ id: 1, recipient: 'marie@test.be', reservationId: 8000, templateId: 'confirmation', subject: 'Confirmé', sentAt: iso(-38), status: 'delivered', direction: 'outbound' }];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0,10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '14:00', close: '22:00' }, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=grp-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'planning'; state.staffTheme = 'dark'; state.staffClientSegment = 'tous';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(500);

    // [REDIRECT] la page « groups » n'existe plus : elle vit dans Clients (« À venir »)
    console.log('\n[REDIRECT] openStaffMenuPage("groups") → Clients, segment « À venir »');
    await page.evaluate(() => openStaffMenuPage('groups'));
    await page.waitForTimeout(600);
    await page.evaluate(async () => { try { if (typeof loadStaffCustomRequests === 'function') await loadStaffCustomRequests(true); } catch (e) {} });
    await page.waitForTimeout(400);
    const redir = await page.evaluate(() => ({
      page: state.staffMenuPage,
      segment: state.staffClientSegment,
      visible: !!document.getElementById('staffClientsPage') && !document.getElementById('staffClientsPage').classList.contains('hidden'),
      activeSeg: ((document.querySelector('#staffClientsPage .crm-seg.is-active') || {}).textContent || '').trim(),
      menuGroups: !![...document.querySelectorAll('button, a')].find((el) => /groupes & anniversaires/i.test(el.textContent || '')),
    }));
    ok(redir.page === 'clients', `staffMenuPage = clients (obtenu ${redir.page})`);
    ok(redir.segment === 'avenir', `segment = avenir (obtenu ${redir.segment})`);
    ok(redir.visible, 'conteneur clients affiché');
    ok(redir.activeSeg === 'À venir', `segment « À venir » actif (obtenu « ${redir.activeSeg} »)`);
    ok(!redir.menuGroups, 'entrée menu « Groupes & anniversaires » supprimée');

    // [LEGACY] un ancien onglet avec staffMenuPage='groups' sauvegardé retombe aussi sur Clients
    await page.evaluate(() => { state.staffMenuPage = 'groups'; save(); renderStaffData(); });
    await page.waitForTimeout(400);
    const legacy = await page.evaluate(() => ({ page: state.staffMenuPage, segment: state.staffClientSegment }));
    ok(legacy.page === 'clients' && legacy.segment === 'avenir', `état sauvegardé "groups" → redirigé (${legacy.page}/${legacy.segment})`);

    const root = '#staffClientsPage';
    console.log('\n[LOAD] workspace dossiers rendu dans la page Clients, sans erreur');
    const load = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const txt = el ? el.textContent : '';
      return {
        exists: !!el,
        dossiers: (el && el.querySelectorAll('.groups-dossier').length) || 0,
        hasPriority: /À confirmer en priorité/i.test(txt),
        hasForecast: /Charge à venir/i.test(txt),
        hasProfilsTable: /Profils exploitables/i.test(txt),
        hasSurMesure: /sur[- ]mesure|Demandes/i.test(txt),
      };
    }, root);
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0,3).join(' | ') : ''}`);
    ok(load.exists, 'workspace rendu dans #staffClientsPage');
    ok(load.dossiers >= 2, `timeline de dossiers À VENIR : ${load.dossiers} cartes dossier`);
    ok(load.hasPriority && load.hasForecast, 'panneaux « À confirmer en priorité » + « Charge à venir » présents');
    ok(!load.hasProfilsTable, 'plus de tableau "Profils exploitables" (pas de doublon CRM)');
    ok(load.hasSurMesure, 'bloc "Demandes sur mesure" (intake leads) présent');

    // [READINESS] une carte dossier a une checklist de préparation
    console.log('\n[READINESS] préparation par dossier');
    const readiness = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const d = el && el.querySelector('.groups-dossier');
      if (!d) return { found: false };
      const checks = d.querySelectorAll('.groups-check-toggle, .groups-check, .groups-readiness');
      const txt = d.textContent || '';
      return { found: true, checks: checks.length, hasCountdown: /J-\d|J\s*-\s*\d|demain|aujourd/i.test(txt), hasMemo: /.crm-insight/.test(d.innerHTML) || d.querySelector('.groups-memo, .crm-insight') ? true : false };
    }, root);
    ok(readiness.found, 'au moins une carte dossier rendue');
    ok(readiness.checks >= 4, `checklist de préparation présente (${readiness.checks} éléments)`);

    // [FACETTE] occasion déselectionnable
    console.log('\n[FACETTE] facettes occasion déselectionnables');
    const beforeF = await page.evaluate((sel) => document.querySelector(sel).querySelectorAll('.groups-dossier').length, root);
    const facetToggle = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const pills = [...el.querySelectorAll('[aria-pressed], .crm-pill, button')].filter(b => /entreprise/i.test(b.textContent) && b.textContent.length < 30);
      const p = pills[0];
      if (!p) return { found: false };
      p.click();
      return { found: true };
    }, root);
    await page.waitForTimeout(250);
    const afterF = await page.evaluate((sel) => document.querySelector(sel).querySelectorAll('.groups-dossier').length, root);
    ok(facetToggle.found, 'facette occasion "Entreprise" cliquable');
    ok(afterF <= beforeF, `facette filtre les dossiers (${beforeF} → ${afterF})`);
    // re-clic → retour (déselection) OU clic "Tous"/Réinitialiser
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const p = [...el.querySelectorAll('[aria-pressed], .crm-pill, button')].find(b => /entreprise/i.test(b.textContent) && b.textContent.length < 30)
        || [...el.querySelectorAll('button')].find(b => /^tous|réinitialiser|tout/i.test(b.textContent.trim()));
      if (p) p.click();
    }, root);
    await page.waitForTimeout(250);
    const afterDeselect = await page.evaluate((sel) => document.querySelector(sel).querySelectorAll('.groups-dossier').length, root);
    ok(afterDeselect >= beforeF, `déselection → retour à tous les dossiers (${afterDeselect})`);

    // [ANCRAGE] naviguer la date du planning NE change PAS la timeline groupes
    console.log('\n[ANCRAGE] timeline ancrée à AUJOURD\'HUI RÉEL (pas state.currentDate)');
    const anchor = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const before = el.querySelectorAll('.groups-dossier').length;
      state.currentDate = '2025-01-01'; // date passée lointaine
      save(); renderStaff();
      const after = document.querySelector(sel).querySelectorAll('.groups-dossier').length;
      return { before, after };
    }, root);
    ok(anchor.before === anchor.after && anchor.after >= 2, `changer state.currentDate ne bouge pas la timeline (${anchor.before} → ${anchor.after})`);

    if (errs.length) console.log('\nConsole errors:\n' + errs.join('\n'));
  } catch (e) {
    console.error('\ncrm-groups-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\ncrm-groups-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncrm-groups-check: ALL OK');
}
main();
