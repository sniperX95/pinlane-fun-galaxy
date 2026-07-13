// Test INTERACTIF du suivi des activités de formule. Playwright pilote un vrai
// clic sur une case → assert toggle + PATCH minimal (permission-light, sans replan)
// + persistance (le mock persiste comme le vrai serveur skipReplan) + survie au poll
// + rendu grisé. Couvre détail réservation ET page « Formules ». Cf. leçon
// ship-interactive-ui-tested : ne pas livrer d'interaction non pilotée.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FORMULA_PORT || 4195);
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
    const perms = ['dashboard.view','planning.view','planning.bowling','planning.laser','reservations.view','reservations.create','reservations.edit','reservations.status','reservations.quick','clients.view','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Une formule F4 avec un opsPlan.timeline riche (minigolf + bowling + 2 laser + boissons).
    const build = (date) => ([
      { id: 9020, name: 'Anniversaire Emma #9020', phone: '+32470860020', email: 'emma@x.test', date, startTime: '15:00', duration: 1, lanes: [3,4], status: 'confirmed', pax: 8, price: 312, type: 'formule', formuleId: 'f4', label: 'FORMULE 4',
        opsPlan: { staffSummary: 'Formule 4 anniversaire', timeline: [
          { type:'service', label:'Arrivée & accueil', resourceType:'bar_service', startTime:'14:50', endTime:'15:00' },
          { type:'activity', activityId:'minigolf_blacklight', label:'Minigolf Blacklight', resourceType:'soft_capacity', startTime:'15:00', endTime:'15:30', countIndex:1 },
          { type:'activity', activityId:'bowling', label:'Bowling', resourceType:'bowling_lane', startTime:'15:30', endTime:'16:30', countIndex:1 },
          { type:'activity', activityId:'laser_game', label:'Laser Game', resourceType:'laser_arena', startTime:'16:45', endTime:'17:10', countIndex:1 },
          { type:'activity', activityId:'laser_game', label:'Laser Game', resourceType:'laser_arena', startTime:'17:15', endTime:'17:40', countIndex:2 },
          { type:'activity', activityId:'service_drinks', label:'2 cruches boissons', resourceType:'bar_service', startTime:'15:00', endTime:'17:40', countIndex:1 },
        ], resourceBlocks: [
          { resourceType:'bowling_lane', activityId:'bowling', startTime:'15:30', endTime:'16:30', lanes:[3,4], countIndex:1 },
          { resourceType:'laser_arena', activityId:'laser_game', startTime:'16:45', endTime:'17:10', countIndex:1 },
          { resourceType:'laser_arena', activityId:'laser_game', startTime:'17:15', endTime:'17:40', countIndex:2 },
        ] },
        activityProgress: {} },
      // F1 avec un plan VIDE : la checklist doit QUAND MÊME montrer les 4 activités
      // de F1 (bowling, laser, arcades, boissons) — la source est la DÉFINITION, pas le plan.
      { id: 9021, name: 'Groupe Lucas #9021', phone: '+32470860021', email: 'lucas@x.test', date, startTime: '16:00', duration: 1, lanes: [5,6], status: 'confirmed', pax: 6, price: 156, type: 'formule', formuleId: 'f1', label: 'FORMULE 1',
        opsPlan: { staffSummary: 'Formule 1', timeline: [] }, activityProgress: {} },
    ]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.__QA_PATCHES__ = [];
    window.__QA_STORE__ = {}; // persistance serveur : activity_progress par id
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10); const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, activityProgress: window.__QA_STORE__[r.id] } : r); return J({ ok: true, revision: `qa-${d}-${JSON.stringify(window.__QA_STORE__).length}`, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_PATCHES__.push(b);
        // Vrai serveur : activityProgress hors REPLAN_FIELDS ⇒ pas de replan ⇒ opsPlan conservé.
        let base = build(new Date().toISOString().slice(0,10)).find(r => Number(r.id) === Number(b.id)) || {};
        try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) base = f; } } catch (e) {}
        const ap = b.activityProgress && typeof b.activityProgress === 'object' ? b.activityProgress : (window.__QA_STORE__[b.id] || {});
        window.__QA_STORE__[b.id] = ap;
        const merged = { ...base, activityProgress: ap };
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

// Garde-fou SERVEUR (node) : un PATCH partiel (id + activityProgress, SANS name/phone,
// comme le toggle) ne doit PAS jeter « Champ requis manquant » — sinon le PATCH échoue
// en 400 et le client annule la coche (« active puis désactive direct »). Teste la VRAIE
// fonction serveur, pas le mock.
function serverGuard() {
  console.log('[SERVEUR] PATCH partiel activité ne casse pas sur name/phone requis');
  let normalizeReservationPayload;
  try { ({ normalizeReservationPayload } = require(path.join(ROOT, 'lib', 'database'))); }
  catch (e) { ok(false, 'require lib/database: ' + e.message); return; }
  const current = { id: 5, name: 'smile Pro', phone: '+32470000000', email: 'x@x.test', date: '2026-07-12', startTime: '15:00', duration: 1, totalDuration: 1, pax: 10, type: 'formule', formuleId: 'f1', centerId: 'libramont', activityProgress: {} };
  try {
    const p = normalizeReservationPayload({ id: 5, centerId: 'libramont', activityProgress: { 'bowling-1': { done: true, doneAt: '2026-07-12T10:00:00.000Z', by: 'Rachel' } } }, current);
    ok(p.name === 'smile Pro' && p.phone === '+32470000000', `PATCH partiel conserve name/phone (name="${p.name}")`);
    ok(!!(p.activityProgress && p.activityProgress['bowling-1'] && p.activityProgress['bowling-1'].done), 'activityProgress persisté par normalize');
  } catch (e) { ok(false, 'PATCH partiel a jeté (bug « Champ requis manquant ») : ' + e.message); }
}

async function main() {
  serverGuard();
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=formula-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      // Date FIXE ouverte (samedi) → déterministe, jamais faussé par un jour fermé.
      const d = '2026-07-18';
      state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; state.staffTheme = 'dark';
      state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(400);

    // Modèle : checklist = définition COMPLÈTE de la formule (pas le plan)
    console.log('\n[MODÈLE] checklist = toutes les activités de LA formule');
    const model = await page.evaluate(() => {
      const r4 = state.reservations.find(x => x.id === 9020);
      const r1 = state.reservations.find(x => x.id === 9021);
      const it4 = getFormulaActivityChecklist(r4);
      const it1 = getFormulaActivityChecklist(r1);
      return {
        f4: { keys: it4.map(i => i.key), labels: it4.map(i => i.label), summary: getFormulaActivityProgressSummary(r4) },
        f1: { keys: it1.map(i => i.key), labels: it1.map(i => i.label) },
      };
    });
    ok(model.f4.keys.length === 5, `F4 : 5 activités (${JSON.stringify(model.f4.keys)})`);
    ok(model.f4.keys.includes('laser_game-1') && model.f4.keys.includes('laser_game-2'), 'F4 : « 2 parties laser » = 2 items séparés');
    ok(model.f4.summary.done === 0 && model.f4.summary.total === 5, `F4 : 0/5 au départ`);
    // LA vérif clé : F1 a un plan VIDE mais montre quand même SES 4 activités.
    ok(model.f1.keys.length === 4, `F1 (plan vide) montre quand même 4 activités (${JSON.stringify(model.f1.keys)})`);
    ok(model.f1.keys.join(',') === 'bowling-1,laser_game-1,arcade_time-1,service_drinks-1', 'F1 : bowling + laser + arcades + boissons (liste exacte de F1)');
    ok(model.f1.labels.includes('Arcades') && model.f1.labels.some(l => /boissons/i.test(l)), 'F1 : Arcades + Boissons présents (absents du plan)');

    // [SYNC] le miroir client FORMULA_ACTIVITY_STEPS doit matcher ops-knowledge/formulas.json
    console.log('\n[SYNC] miroir client == source serveur (formulas.json)');
    const serverFormulas = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops-knowledge', 'formulas.json'), 'utf8')).formulas;
    const clientSteps = await page.evaluate(() => {
      const out = {};
      const ids = ['f1','f2','f3','f4','f5','f6','f7','f8','bts','mm','css','kfd','hlg','ffm'];
      ids.forEach(id => { const s = window.PinlaneBookingCore.getFormulaActivitySteps(id); out[id] = s ? s.map(x => `${x.a}:${x.c}`) : null; });
      return out;
    });
    let syncMismatch = [];
    serverFormulas.forEach(f => {
      const serverSeq = f.steps.map(s => `${s.activityId}:${Number(s.count || 1)}`);
      const clientSeq = clientSteps[f.id];
      if (!clientSeq || clientSeq.join('|') !== serverSeq.join('|')) syncMismatch.push(`${f.id}: serveur[${serverSeq.join(',')}] vs client[${clientSeq ? clientSeq.join(',') : 'ABSENT'}]`);
    });
    ok(syncMismatch.length === 0, `miroir synchronisé pour les ${serverFormulas.length} formules${syncMismatch.length ? ' — DÉRIVE: ' + syncMismatch.join(' ; ') : ''}`);

    // [DÉTAIL] ouvrir la résa + cocher « Bowling » par un VRAI clic
    console.log('\n[DÉTAIL] clic réel sur une case');
    await page.evaluate(() => { if (typeof openStaffReservationDetail === 'function') openStaffReservationDetail(9020); else openPos(9020); });
    await page.waitForTimeout(300);
    const detail0 = await page.evaluate(() => ({
      rows: document.querySelectorAll('#posOverlay .activity-check-row').length,
      done: document.querySelectorAll('#posOverlay .activity-check-row.is-done').length,
    }));
    ok(detail0.rows === 5, `checklist affichée dans le détail (${detail0.rows} lignes)`);
    ok(detail0.done === 0, 'aucune activité cochée au départ');
    // clic sur la 2e ligne (Bowling ; l'ordre suit la timeline : minigolf, bowling, laser1, laser2, boissons)
    const clicked = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll('#posOverlay .activity-check-row')];
      const target = rows.find(r => /Bowling/i.test(r.textContent)) || rows[1];
      if (!target) return null;
      target.click();
      return true;
    });
    ok(clicked, 'ligne « Bowling » cliquée');
    await page.waitForTimeout(400);
    const afterClick = await page.evaluate(() => {
      const r = state.reservations.find(x => x.id === 9020);
      const patch = (window.__QA_PATCHES__ || []).slice(-1)[0] || null;
      return {
        bowlingDone: !!(r.activityProgress && r.activityProgress['bowling-1'] && r.activityProgress['bowling-1'].done),
        by: r.activityProgress?.['bowling-1']?.by || '',
        summaryDone: getFormulaActivityProgressSummary(r).done,
        domDone: document.querySelectorAll('#posOverlay .activity-check-row.is-done').length,
        patchKeys: patch ? Object.keys(patch).sort() : [],
        patchStored: !!(window.__QA_STORE__[9020] && window.__QA_STORE__[9020]['bowling-1']),
      };
    });
    ok(afterClick.bowlingDone, 'bowling-1 marqué done dans l\'état');
    ok(afterClick.by === 'Rachel', `« fait par » = membre courant (obtenu "${afterClick.by}")`);
    ok(afterClick.summaryDone === 1, 'résumé passe à 1/5');
    ok(afterClick.domDone === 1, 'la ligne est grisée (is-done) dans le DOM');
    ok(JSON.stringify(afterClick.patchKeys) === JSON.stringify(['activityProgress','centerId','id']), `PATCH minimal { id, centerId, activityProgress } (obtenu ${JSON.stringify(afterClick.patchKeys)})`);
    ok(afterClick.patchStored, 'le serveur (mock) a persisté activity_progress');

    // [POLL] la coche survit à un rafraîchissement serveur
    console.log('\n[POLL] survie au rafraîchissement serveur');
    await page.evaluate(async () => { if (typeof refreshStaffState === 'function') { try { await refreshStaffState(); } catch (e) {} } });
    await page.waitForTimeout(300);
    const afterPoll = await page.evaluate(() => {
      const r = state.reservations.find(x => x.id === 9020);
      return { bowlingDone: !!(r.activityProgress?.['bowling-1']?.done), summaryDone: getFormulaActivityProgressSummary(r).done, opsPlanIntact: Array.isArray(r.opsPlan?.timeline) && r.opsPlan.timeline.length === 6 };
    });
    ok(afterPoll.bowlingDone && afterPoll.summaryDone === 1, 'bowling toujours fait après le poll');
    ok(afterPoll.opsPlanIntact, 'opsPlan (timeline) intact — pas de replan destructeur');

    // [PAGE FORMULES] navigation + clic depuis la page dédiée
    console.log('\n[PAGE FORMULES] carte + clic');
    await page.evaluate(() => { if (typeof openStaffMenuPage === 'function') openStaffMenuPage('formules'); else { state.staffMenuPage = 'formules'; save(); renderStaff(); } });
    await page.waitForTimeout(400);
    const fpage = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#staffUtilityPage .formules-card')];
      const emma = cards.find(c => /Emma/.test(c.textContent));
      const lucas = cards.find(c => /Lucas/.test(c.textContent));
      return {
        cards: cards.length,
        emmaRows: emma ? emma.querySelectorAll('.activity-check-row').length : 0,
        emmaDone: emma ? emma.querySelectorAll('.activity-check-row.is-done').length : 0,
        lucasRows: lucas ? lucas.querySelectorAll('.activity-check-row').length : 0,
        title: (document.querySelector('#staffUtilityPage .utility-hero h1') || {}).textContent || '',
      };
    });
    ok(fpage.cards >= 2, `page Formules : ${fpage.cards} cartes`);
    ok(fpage.emmaRows === 5, `checklist F4 dans la carte Emma (${fpage.emmaRows} lignes)`);
    ok(fpage.lucasRows === 4, `checklist F1 COMPLÈTE dans la carte Lucas malgré plan vide (${fpage.lucasRows} lignes)`);
    ok(fpage.emmaDone === 1, 'la coche faite au détail est reflétée ici (1 grisée sur Emma)');
    ok(/Formule/i.test(fpage.title), `titre page = "${fpage.title}"`);
    // coche « Minigolf » depuis la page Formules (dans la carte Emma)
    const clicked2 = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#staffUtilityPage .formules-card')];
      const emma = cards.find(c => /Emma/.test(c.textContent));
      const rows = emma ? [...emma.querySelectorAll('.activity-check-row')] : [];
      const target = rows.find(r => /Minigolf/i.test(r.textContent));
      if (!target) return false; target.click(); return true;
    });
    ok(clicked2, 'ligne « Minigolf » cliquée depuis la page Formules');
    await page.waitForTimeout(400);
    const afterClick2 = await page.evaluate(() => {
      const r = state.reservations.find(x => x.id === 9020);
      const cards = [...document.querySelectorAll('#staffUtilityPage .formules-card')];
      const emma = cards.find(c => /Emma/.test(c.textContent));
      return { done: getFormulaActivityProgressSummary(r).done, minigolf: !!(r.activityProgress?.['minigolf_blacklight-1']?.done), doneRows: emma ? emma.querySelectorAll('.activity-check-row.is-done').length : 0 };
    });
    ok(afterClick2.minigolf && afterClick2.done === 2, `minigolf coché → 2/5 (obtenu ${afterClick2.done})`);
    ok(afterClick2.doneRows === 2, '2 lignes grisées sur la page');

    // [PILL PLANNING] la carte bowling porte la pill 2/5
    console.log('\n[PILL PLANNING] indicateur sur la carte');
    await page.evaluate(() => { state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; save(); renderStaff(); });
    await page.waitForTimeout(300);
    const pill = await page.evaluate(() => {
      const el = document.querySelector('.booking[data-booking-res-id="9020"] .activity-pill');
      return el ? el.textContent.trim() : null;
    });
    ok(pill && pill.replace(/\s/g,'').startsWith('2/5'), `pill « 2/5 » sur la carte planning (obtenu "${pill}")`);

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nformula-activity-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nformula-activity-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nformula-activity-check: ALL OK');
}
main();
