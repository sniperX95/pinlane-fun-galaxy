// LE COMPTOIR VEND LES TABLES ET LES HEURES QU IL A CHOISIES.
//
// Mesure du 2026-08-31, la veille de l ouverture Fun Galaxy Libramont.
//
// Le tunnel public sait vendre une activite « per_unit_hour » (les billards a
// Libramont : 10 EUR la table et par heure en prod ; le mock du gate teste le
// MECANISME a 12 EUR, pas le montant du tenant). Il propose le nombre de tables ET
// la duree, et son programme part avec units et hours.
//
// La reservation rapide du COMPTOIR, elle, n avait aucun de ces deux reglages :
// `visit.others[id]` etait un simple booleen, et la ligne du programme ne
// portait que { activityId, pax }. lib/visit-program.js (l.141-142) retombe
// alors sur ses valeurs par defaut, units=1 et hours=1, sans un mot.
//
// CHIFFRE : trois tables reservees deux heures au comptoir sont facturees
// 12 EUR au lieu de 72. A chaque dossier billard pris a l accueil, tous les
// jours. Le mode « une seule activite » avait le meme trou, en pire : il
// n envoyait ni units, ni hours, ni minutes, ni participants.
//
// Cinq proprietes :
//   A. Une activite per_unit_hour cochee en visite propose SES DEUX reglages.
//   B. Le POST du comptoir porte les units et les hours choisis.
//   C. Le meme reglage existe quand l activite est SEULE, et part aussi.
//   D. Le nombre de tables proposees suit la DOTATION du catalogue, jamais une
//      liste figee : un centre qui declare 6 tables doit pouvoir en vendre 6.
//   E. Non-regression : le fun run garde ses minutes, la plaine ses enfants.
//
// Contre-epreuve par mutation : on retire units/hours de la ligne envoyee, on
// prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/quickbook-unit-hour-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets/app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_QBUNIT_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

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

// Le catalogue du centre. Les billards declarent SIX tables (dotation) et se
// vendent de 1h a 4h par pas d une heure : c est la donnee du tenant qui doit
// gouverner les choix offerts, pas une liste ecrite dans le code. Les MONTANTS
// de ce mock (12 EUR...) testent le mecanisme, pas les prix reels du tenant
// (billards a 10 EUR en prod, mesure 2026-09-01) : les prix reels vivent en
// base et se verifient contre le meta prod, pas contre un fichier.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: 12, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 240, stepMinutes: 60, units: 6, capacityPerUnit: 4 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', order: 9, defaultMinutes: 15 },
];

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.quick', 'reservations.edit', 'reservations.status', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      // Les notes client internes (API du 2026-10-05, journal Pinlane 378) : la console
      // les precharge pour chaque carte. Absente, elle repondait 404 et ce gate rougissait
      // sur « aucune erreur console ». Meme forme que lib/customer-notes.js (voir le
      // mock commun de planning-matrix-check.js).
      if (u.pathname === '/api/staff-customer-notes' && String(init.method || 'GET').toUpperCase() === 'GET') {
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        const lot = u.searchParams.get('reservationIds');
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        // LA FENETRE SIMULE AVANT DE CREER (dryRun, 2026-10-08) : une
        // simulation n est pas une creation, elle ne se compte pas.
        if (corps.dryRun) return J({ ok: true, dryRun: true, plan: { disponible: true, debut: corps.startTime || '', fin: '', blocs: [], etapes: [], prix: null } });
        window.__QA_POSTS__.push(corps);
        return J({ ok: true, reservation: { id: 4242, date: today, startTime: '14:00', pax: 4, status: 'pending', type: 'visite', lanes: [] } });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
            day: { date: today, open: true, schedule: { open: 10, close: 22, label: '10h - 22h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, ACTIVITIES });
}

// La ligne « billards » du dernier POST, quel que soit le mode.
function ligneBillards(posts) {
  const dernier = posts[posts.length - 1];
  if (!dernier || !Array.isArray(dernier.program)) return null;
  return dernier.program.find((l) => l && l.activityId === 'billards') || null;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(BASE_URL + '/?v=qbu-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 5, null, { timeout: 15000 });

    // --- A. Les deux reglages existent -------------------------------------
    await page.evaluate(() => {
      window.openQuickBook({ date: (() => { const d = new Date(todayStr() + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() });
      window.setQuickStartTime('14:00');
      window.setQuickType('visite');
      window.toggleQuickVisitActivity('billards');
    });
    await page.waitForSelector('[data-rv-ligne="billards"]', { timeout: 8000 });
    // v5 (2026-10-08) : les reglages d une activite vivent dans le detail de
    // sa ligne ; le comptoir l ouvre au chevron, le gate aussi.
    await page.evaluate(() => {
      const ligne = document.querySelector('[data-rv-ligne="billards"]');
      if (ligne && !ligne.classList.contains('is-ouverte')) ligne.querySelector('.rv-ouvrir').click();
    });
    await page.waitForTimeout(400);

    const reglages = await page.evaluate(() => {
      const rangee = document.querySelector('[data-rv-ligne="billards"]');
      if (!rangee) return { absente: true, tables: [], durees: [] };
      const val = (sel) => [...rangee.querySelectorAll(sel)].map((b) => b.textContent.trim());
      return { absente: false, tables: val('[data-opt="units"]'), durees: val('[data-opt="hours"]') };
    });
    ok(!reglages.absente, 'la rangee Billards est bien dans le composeur');
    ok(reglages.tables.length > 0,
      `les billards proposent un nombre de tables (${reglages.tables.join(' | ') || 'AUCUN reglage'})`);
    ok(reglages.durees.length > 1,
      `et une duree a choisir (${reglages.durees.join(' | ') || 'AUCUNE duree'})`);

    // --- D. La dotation du catalogue gouverne les choix ---------------------
    ok(reglages.tables.length >= 6 && reglages.tables.includes('6'),
      `un centre qui declare 6 tables peut en vendre 6 (proposes : ${reglages.tables.join(' | ') || 'aucun'})`);

    // --- B. Le POST porte le choix du comptoir ------------------------------
    await page.evaluate(() => {
      window.setQuickVisitUnits('billards', 3);
      window.setQuickVisitHours('billards', 2);
    });
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      window.__QA_POSTS__.length = 0;
      await window.saveQuickBook();
    });
    await page.waitForTimeout(600);
    const enVisite = await page.evaluate(() => window.__QA_POSTS__.map((p) => ({ program: p.program })));
    const ligneVisite = ligneBillards(enVisite);
    ok(!!ligneVisite,
      `le comptoir a bien envoye une ligne billards (${JSON.stringify(enVisite[enVisite.length - 1] || null)})`);
    ok(ligneVisite && Number(ligneVisite.units) === 3,
      `3 tables choisies, 3 tables envoyees (units=${ligneVisite ? ligneVisite.units : 'ABSENT'})`);
    ok(ligneVisite && Number(ligneVisite.hours) === 2,
      `2 heures choisies, 2 heures envoyees (hours=${ligneVisite ? ligneVisite.hours : 'ABSENT'})`);

    // --- C. Le mode « une seule activite » n est pas un trou ----------------
    await page.evaluate(() => {
      window.openQuickBook({ date: (() => { const d = new Date(todayStr() + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() });
      window.setQuickStartTime('14:00');
      window.setQuickType('activity', 'billards');
      // v5 : les reglages vivent dans le detail de la ligne, au chevron.
      const ligne = document.querySelector('[data-rv-ligne="billards"]');
      if (ligne && !ligne.classList.contains('is-ouverte')) ligne.querySelector('.rv-ouvrir').click();
    });
    await page.waitForTimeout(500);
    const seule = await page.evaluate(() => ({
      tables: [...document.querySelectorAll('#quickBookOverlay [data-opt="units"]')].map((b) => b.textContent.trim()),
      durees: [...document.querySelectorAll('#quickBookOverlay [data-opt="hours"]')].map((b) => b.textContent.trim()),
    }));
    ok(seule.tables.length > 0 && seule.durees.length > 1,
      `activite seule : les reglages sont la aussi (${seule.tables.length} tables, ${seule.durees.length} durees)`);

    await page.evaluate(async () => {
      window.setQuickVisitUnits('billards', 2);
      window.setQuickVisitHours('billards', 3);
      window.__QA_POSTS__.length = 0;
      await window.saveQuickBook();
    });
    await page.waitForTimeout(600);
    const enSeule = await page.evaluate(() => window.__QA_POSTS__.map((p) => ({ program: p.program })));
    const ligneSeule = ligneBillards(enSeule);
    ok(ligneSeule && Number(ligneSeule.units) === 2 && Number(ligneSeule.hours) === 3,
      `activite seule : 2 tables x 3h partent bien (${ligneSeule ? `units=${ligneSeule.units} hours=${ligneSeule.hours}` : 'AUCUNE ligne billards'})`);

    // --- E. Non-regression : minutes et participants ------------------------
    await page.evaluate(async () => {
      window.openQuickBook({ date: (() => { const d = new Date(todayStr() + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() });
      window.setQuickStartTime('14:00');
      window.setQuickType('visite');
      window.toggleQuickVisitActivity('fun_run');
      window.toggleQuickVisitActivity('playground');
      window.setQuickVisitParticipants('playground', 2);
      window.__QA_POSTS__.length = 0;
      await window.saveQuickBook();
    });
    await page.waitForTimeout(600);
    const autres = await page.evaluate(() => {
      const p = window.__QA_POSTS__[window.__QA_POSTS__.length - 1];
      const prog = (p && p.program) || [];
      return {
        funRun: prog.find((l) => l.activityId === 'fun_run') || null,
        playground: prog.find((l) => l.activityId === 'playground') || null,
      };
    });
    ok(autres.funRun && Number(autres.funRun.minutes) > 0,
      `le fun run garde ses minutes (${autres.funRun ? autres.funRun.minutes : 'AUCUNE ligne'})`);
    ok(autres.playground && Number(autres.playground.participants) === 2,
      `la plaine de jeux garde ses enfants (${autres.playground ? autres.playground.participants : 'AUCUNE ligne'})`);
    ok(!(autres.funRun && autres.funRun.units != null),
      'une activite SANS tables ne recoit pas de cle units parasite');

    ok(errs.length === 0, `zero erreur console (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nquickbook-unit-hour-check: ${failures} defaut(s).`); process.exit(1); }
  console.log('\nquickbook-unit-hour-check: ALL OK (le comptoir vend les tables et les heures qu il a choisies)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(APP, 'utf8');
  const marqueur = "if (activite.priceType === 'per_unit_hour') {\r\n    ligne.units";
  const marqueurLf = marqueur.split('\r\n').join('\n');
  const trouve = source.includes(marqueur) ? marqueur : (source.includes(marqueurLf) ? marqueurLf : '');
  if (!trouve) {
    console.error('mutation impossible : la ligne units/hours est introuvable dans assets/app-main.js');
    process.exit(1);
  }
  // On remet le trou d avant : la ligne part sans units ni hours.
  const mute = source.replace(trouve, trouve.replace("activite.priceType === 'per_unit_hour'", 'false'));
  fs.writeFileSync(APP, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(APP, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans units/hours dans la ligne envoyee.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans units/hours, le comptoir facture 1 table 1 heure et le gate rougit.');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
