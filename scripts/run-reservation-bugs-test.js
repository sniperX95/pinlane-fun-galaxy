// Reproduction + non-regression harness for the three staff booking bugs:
//   1) double-clic pour créer une réservation (le blur du téléphone mangeait le
//      1er clic) + anti double-submit,
//   2) capacité bowling faussée pour un grand groupe (extension auto des pistes),
//   3) capacité laser faussée (« complet » alors qu'il reste des places).
// Charge la vraie app (index.html) dans un navigateur avec des API mockées.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_BUGS_PORT || 4188);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_DATE = '2026-07-11'; // samedi (10h - Minuit) → 16:00 dans les horaires

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end('Forbidden'); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

async function installApi(page) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const qaSession = {
      token: 'bugs-token', cookieBacked: false, centerId: 'libramont', expiresAt,
      member: { id: 'qa', name: 'QA', roleId: 'direction' },
      role: { id: 'direction', name: 'Direction', locked: true },
      permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
        'reservations.view', 'reservations.create', 'reservations.status', 'reservations.quick'],
    };
    const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `t-${Date.now()}` },
    });
    window.__RES_POSTS__ = [];
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(rawUrl, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (url.pathname === '/api/staff-auth') {
        return jsonResponse({ ok: true, authenticated: true, session: qaSession,
          accessControl: { selectedRoleId: 'direction', roles: [], members: [], events: [], permissions: qaSession.permissions } });
      }
      if (url.pathname === '/api/staff-state') {
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        const laneStatuses = Array.from({ length: 8 }).reduce((acc, _, i) => { acc[i + 1] = 'active'; return acc; }, {});
        const extra = window.__EXTRA_RES__ || [];
        const revision = `r-${date}-${window.__STATE_REV__ || 0}`;
        const headers = init.headers || {};
        const inm = headers['If-None-Match'] || headers['if-none-match'] || '';
        // Poll différentiel : rien n'a changé => 304 CORPS VIDE (poids ~0 octet).
        if (inm && inm === revision) {
          window.__LAST_STATE_BYTES__ = 0;
          return new Response('', { status: 304, headers: { etag: revision } });
        }
        const bodyObj = { ok: true, revision, reservations: extra, laneStatuses, centerId: 'libramont' };
        const body = JSON.stringify(bodyObj);
        window.__LAST_STATE_BYTES__ = body.length;
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: revision } });
      }
      if (url.pathname === '/api/staff-reservations' && method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__RES_POSTS__.push(body);
        return jsonResponse({ ok: true, reservation: { ...body, id: 9990 + window.__RES_POSTS__.length } });
      }
      if (url.pathname === '/api/public-booking-meta') {
        return jsonResponse({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [],
          center: { id: 'libramont', status: 'active', defaultSchedule: null, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      }
      if (url.pathname.startsWith('/api/')) return jsonResponse({ ok: true, reservations: [], communications: [], samples: [], suggestions: [], events: [], agents: [], activations: [], orchestration: {} });
      return nativeFetch ? nativeFetch(input, init) : jsonResponse({ ok: true });
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await installApi(page);
    await page.goto(`${BASE_URL}/?v=bugs-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.openQuickBook === 'function' && typeof window.getLaserAvailability === 'function', null, { timeout: 15000 });

    const seed = (reservations) => page.evaluate(({ date, reservations }) => {
      state.currentDate = date;
      state.reservations = reservations || [];
      state.laneStatuses = Array.from({ length: 8 }).reduce((acc, _, i) => { acc[i + 1] = 'active'; return acc; }, {});
      // Pas de setView('staff') ici : il déclencherait un sync /api/staff-state
      // (mock renvoyant []) qui écraserait les réservations qu'on vient de semer.
    }, { date: TEST_DATE, reservations });

    // ================= BUG 2 : capacité bowling grand groupe =================
    console.log('\n[BUG 2] Capacité bowling : grand groupe (40 joueurs → 7 pistes)');
    await seed([]);
    const b2 = await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true });
      const requiredBefore = getRequiredLaneCount('bowling', quickBookState.pax, '');
      const lanesBefore = quickBookState.lanes.slice();
      setQuickPax(40); // le patron tape 40 joueurs
      const required = getRequiredLaneCount('bowling', 40, '');
      const summary = getQuickBookSummary();
      return { requiredBefore, lanesBefore, required, lanes: quickBookState.lanes.slice(), detail: summary.detail, total: summary.total };
    }, { date: TEST_DATE });
    assert(b2.requiredBefore === 1 && b2.lanesBefore.length === 1, `petit groupe initial garde 1 piste pré-remplie (${b2.lanesBefore.join(',')})`);
    assert(b2.required === 7, `40 joueurs exigent 7 pistes (getRequiredLaneCount=${b2.required})`);
    assert(b2.lanes.length === 7, `sélection auto-étendue à 7 pistes (obtenu ${b2.lanes.length}: ${b2.lanes.join('-')})`);
    assert(b2.lanes.includes(1), 'la piste cliquée (1) est incluse dans l\'extension');
    assert(/7 piste/.test(b2.detail), `Total estimé reflète 7 pistes ("${b2.detail}")`);
    assert(b2.total === 39 * 7, `prix reflète 7 pistes (39€×7=${39 * 7}, obtenu ${b2.total})`);

    // Validation OK avec 8 libres : allocation d'exactement les 7 requises
    const b2ok = await page.evaluate(({ date }) => {
      const alloc = allocateLanesIncludingSeed(7, [1], date, '16:00', 1);
      return { len: alloc ? alloc.length : 0, includes1: alloc ? alloc.includes(1) : false };
    }, { date: TEST_DATE });
    assert(b2ok.len === 7 && b2ok.includes1, '8 libres ≥ 7 requis → validation passe (7 pistes dont la n°1)');

    // Validation KO avec 6 libres (2 pistes en maintenance)
    const b2ko = await page.evaluate(({ date }) => {
      state.laneStatuses[7] = 'maintenance';
      state.laneStatuses[8] = 'maintenance'; // 6 pistes libres (1..6)
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true });
      setQuickPax(40);
      const alloc = allocateLanesIncludingSeed(7, [1], date, '16:00', 1);
      const lanes = quickBookState.lanes.slice();
      state.laneStatuses[7] = 'active';
      state.laneStatuses[8] = 'active';
      return { alloc, lanesLen: lanes.length };
    }, { date: TEST_DATE });
    assert(b2ko.alloc === null, '6 libres < 7 requis → allocation impossible (null)');
    assert(b2ko.lanesLen < 7, `6 libres → la sélection ne se sur-étend pas (reste ${b2ko.lanesLen})`);

    // Bouton « Compléter les pistes » en incluant la piste cliquée
    const b2btn = await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [8], allowPastStart: true });
      quickBookState.autoAssign = false; quickBookState.lanes = [8]; quickBookState.pax = 40;
      applyQuickSuggestedLanes();
      return quickBookState.lanes.slice();
    }, { date: TEST_DATE });
    assert(b2btn.length === 7 && b2btn.includes(8), `« Compléter les pistes » donne 7 pistes dont la cliquée n°8 (${b2btn.join('-')})`);

    // ================= BUG 3 : capacité laser =================
    console.log('\n[BUG 3] Capacité laser : session avec places restantes');
    // Session existante de 20 joueurs (30 armes) → il reste 10 places.
    await seed([{ id: 501, date: TEST_DATE, status: 'confirmed', type: 'laser', pax: 20, startTime: '16:00', duration: 0.5 }]);
    const b3 = await page.evaluate(({ date }) => {
      const book10 = getLaserAvailability(date, '16:00', 0.5, 10);
      const book11 = getLaserAvailability(date, '16:00', 0.5, 11);
      return { ok10: book10.ok, remaining10: book10.remainingPlaces, ok11: book11.ok, msg11: book11.message };
    }, { date: TEST_DATE });
    assert(b3.ok10 === true, `réserver 10 ≤ 10 places restantes → ACCEPTÉ (ok=${b3.ok10}, restera ${b3.remaining10})`);
    assert(b3.ok11 === false, `réserver 11 > 10 places restantes → REFUSÉ ("${b3.msg11}")`);

    // Session à 18 joueurs → il reste 12 places : offset d'arrivée différent (bug d'alignement)
    await seed([{ id: 502, date: TEST_DATE, status: 'confirmed', type: 'laser', pax: 18, startTime: '16:00', duration: 0.5 }]);
    const b3b = await page.evaluate(({ date }) => {
      const book12 = getLaserAvailability(date, '16:00', 0.5, 12); // 18+12 = 30
      const book13 = getLaserAvailability(date, '16:00', 0.5, 13); // 18+13 = 31
      const empty = getLaserAvailability(date, '20:00', 0.5, 10);   // créneau vide
      return { ok12: book12.ok, ok13: book13.ok, okEmpty: empty.ok, remEmpty: empty.remainingPlaces };
    }, { date: TEST_DATE });
    assert(b3b.ok12 === true, 'session 18/30 : ajouter 12 (=30) → ACCEPTÉ (join de session, pas 2e lancement)');
    assert(b3b.ok13 === false, 'session 18/30 : ajouter 13 (=31) → REFUSÉ');
    assert(b3b.okEmpty === true && b3b.remEmpty === 20, 'créneau vide : 10 joueurs OK, 20 places restantes');

    // ================= BUG 1 : double-clic / anti double-submit =================
    console.log('\n[BUG 1] Un seul clic crée la réservation + anti double-submit');
    await seed([]);
    await page.evaluate(({ date }) => {
      window.__RES_POSTS__ = [];
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true });
      quickBookState.name = 'Client Test';
      quickBookState.phone = '+32470111222';
      quickBookState.email = 'client@test.com';
      renderQuickBook();
      // focus le champ téléphone : son blur déclenchait un re-render qui détruisait
      // le bouton avant l'arrivée du clic (le fameux « cliquer 2 fois »).
      const inputs = [...document.querySelectorAll('#quickBookOverlay input')];
      const phone = inputs.find((i) => (i.getAttribute('onblur') || '').includes('onQuickPhoneBlur'));
      if (phone) phone.focus();
    }, { date: TEST_DATE });
    // UN SEUL clic réel sur « Créer la réservation »
    await page.click('#quickBookOverlay .qb-btn-save');
    await page.waitForFunction(() => window.__RES_POSTS__ && window.__RES_POSTS__.length >= 1, null, { timeout: 5000 }).catch(() => {});
    const postsAfterOneClick = await page.evaluate(() => window.__RES_POSTS__.length);
    assert(postsAfterOneClick === 1, `1 clic (champ tél. focus) → exactement 1 POST (obtenu ${postsAfterOneClick})`);

    // Anti double-submit : 2 appels concurrents → 1 seul POST
    const doubleSubmit = await page.evaluate(({ date }) => {
      window.__RES_POSTS__ = [];
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [2], allowPastStart: true });
      quickBookState.name = 'Client Double';
      quickBookState.phone = '+32470999888';
      quickBookState.email = 'double@test.com';
      const p1 = saveQuickBook();
      const p2 = saveQuickBook(); // doit être ignoré (submitting)
      return Promise.all([p1, p2]).then(() => window.__RES_POSTS__.length);
    }, { date: TEST_DATE });
    assert(doubleSubmit === 1, `2 saveQuickBook() concurrents → 1 seul POST (obtenu ${doubleSubmit})`);

    // ============ CHANTIER 1 : recherche planning en direct + effacement ============
    console.log('\n[CHANTIER 1] Recherche planning : filtre à la frappe + effacement ré-affiche tout');
    const search = await page.evaluate(({ date }) => {
      state.view = 'staff';
      state.staffMenuPage = 'planning';
      state.staffResourceView = 'all';
      state.currentDate = date;
      state.searchTerm = '';
      state.reservations = [
        { id: 601, date, status: 'confirmed', type: 'bowling', pax: 4, startTime: '16:00', duration: 1, lanes: [1], name: 'Alice Martin', phone: '+32470111111', email: 'alice@x.com' },
        { id: 602, date, status: 'confirmed', type: 'bowling', pax: 4, startTime: '18:00', duration: 1, lanes: [3], name: 'Bob Durand', phone: '+32470222222', email: 'bob@x.com' },
      ];
      renderStaffData();
      const countBookings = () => document.querySelectorAll('#planningGridWrap .booking').length;
      const initial = countBookings();
      // 1) Frappe : filtre EN DIRECT le planning (pas seulement la liste).
      applyStaffSearch('Alice', { immediate: true });
      const afterType = countBookings();
      const planningInputVal = document.getElementById('planningSearchInput').value;
      const listInputVal = document.getElementById('searchInput').value;
      // 2) Effacement : le planning se re-remplit immédiatement (bug « vide »).
      applyStaffSearch('', { immediate: true });
      const afterClear = countBookings();
      // 3) Recherche téléphone.
      applyStaffSearch('222222', { immediate: true });
      const afterPhone = countBookings();
      applyStaffSearch('', { immediate: true });
      return { initial, afterType, afterClear, afterPhone, planningInputVal, listInputVal };
    }, { date: TEST_DATE });
    assert(search.initial === 2, `planning affiche les 2 réservations au départ (obtenu ${search.initial})`);
    assert(search.afterType === 1, `taper « Alice » filtre le planning EN DIRECT → 1 booking (obtenu ${search.afterType})`);
    assert(search.planningInputVal === 'Alice' && search.listInputVal === 'Alice', 'les champs de recherche jumeaux (planning + liste) restent synchronisés');
    assert(search.afterClear === 2, `EFFACER la recherche ré-affiche TOUT le planning immédiatement (obtenu ${search.afterClear}, bug « vide » corrigé)`);
    assert(search.afterPhone === 1, `recherche par téléphone « 222222 » filtre aussi le planning (obtenu ${search.afterPhone})`);

    // ============ CHANTIER 2 : synchro live différentielle sobre ============
    console.log('\n[CHANTIER 2] Poll différentiel : une résa serveur apparaît sans action + tick 304 minuscule');
    const live = await page.evaluate(async ({ date }) => {
      state.view = 'staff';
      state.staffMenuPage = 'planning';
      state.staffResourceView = 'all';
      state.currentDate = date;
      state.reservations = [];
      window.__EXTRA_RES__ = [];
      // Révision unique : neutralise un éventuel poll de fond (4 s) qui aurait déjà
      // mis en cache une révision → on garantit un vrai chargement complet ici.
      window.__STATE_REV__ = 'load-' + Date.now();
      renderStaffData();
      // Premier sync : charge l'état (révision fraîche), planning vide.
      await syncDateReservations(date, { silent: true });
      const before = document.querySelectorAll('#planningGridWrap .booking').length;
      const bytesFullLoad = window.__LAST_STATE_BYTES__;
      // Tick SANS changement : le serveur renvoie 304 (corps vide, poids ~0).
      const changedNoop = await syncDateReservations(date, { silent: true });
      const bytesNoop = window.__LAST_STATE_BYTES__;
      // Une résa est prise EN LIGNE (autre poste / parcours public) côté serveur.
      window.__EXTRA_RES__ = [{ id: 701, date, status: 'confirmed', type: 'bowling', pax: 4, startTime: '16:00', duration: 1, lanes: [2], name: 'Résa En Ligne', phone: '+32470333333', email: 'online@x.com' }];
      window.__STATE_REV__ = 'changed-' + Date.now();
      // Prochain tick du poll : elle apparaît SANS aucune action utilisateur.
      const changed = await syncDateReservations(date, { silent: true });
      const after = document.querySelectorAll('#planningGridWrap .booking').length;
      const inStore = state.reservations.some((r) => Number(r.id) === 701);
      return { before, bytesFullLoad, changedNoop, bytesNoop, changed, after, inStore };
    }, { date: TEST_DATE });
    assert(live.before === 0, `planning vide avant la réservation en ligne (obtenu ${live.before})`);
    assert(live.changedNoop === false && live.bytesNoop === 0, `tick sans changement = 304 corps vide (0 octet, obtenu ${live.bytesNoop})`);
    assert(live.bytesFullLoad > live.bytesNoop, `un tick « rien changé » (${live.bytesNoop}o) est bien plus léger qu'un chargement complet (${live.bytesFullLoad}o)`);
    assert(live.changed === true && live.inStore, 'la résa prise EN LIGNE entre dans le store au tick suivant, sans action');
    assert(live.after === 1, `la résa en ligne apparaît sur le planning sans rechargement (obtenu ${live.after})`);

    // ============ CHANTIER 3 : contact STAFF libre (email non obligatoire) ============
    console.log('\n[CHANTIER 3] Contact staff libre : email NON obligatoire, badges OBLIGATOIRE absents');
    const emailFront = await page.evaluate(async ({ date }) => {
      const attempt = async (fields) => {
        window.__RES_POSTS__ = [];
        // On repart d'un planning vide à chaque essai : une création réussie
        // occuperait sinon la piste 1 à 16:00 et ferait échouer les suivantes.
        state.reservations = [];
        openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true });
        Object.assign(quickBookState, fields);
        await saveQuickBook();
        return { posts: window.__RES_POSTS__.length, error: quickBookState ? quickBookState.error : '', last: window.__RES_POSTS__[0] || null };
      };
      // Sans email : ACCEPTÉ côté staff (contact libre).
      const noEmail = await attempt({ name: 'Client Sans Mail', phone: '+32470444444', email: '' });
      // Sans nom NI email NI téléphone : ACCEPTÉ, avec fallback nom « Client ».
      const emptyAll = await attempt({ name: '', phone: '+32 ', email: '' });
      // Email présent mais mal formé : refusé (garde-fou format uniquement).
      const badEmail = await attempt({ name: 'Client', phone: '+32470444444', email: 'pas-un-email' });
      // Email valide : part normalement.
      const goodEmail = await attempt({ name: 'Client', phone: '+32470444444', email: 'client@test.com' });
      // Badges « obligatoire » (qb-req) absents dans la modale staff.
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true });
      renderQuickBook();
      const modalHtml = document.querySelector('#quickBookOverlay').innerHTML;
      const hasReqBadge = /qb-req|>obligatoire</i.test(modalHtml);
      const emailRequiredAttr = /type="email"[^>]*\brequired\b/i.test(modalHtml);
      return { noEmail, emptyAll, badEmail, goodEmail, hasReqBadge, emailRequiredAttr };
    }, { date: TEST_DATE });
    assert(emailFront.noEmail.posts === 1, `staff sans email : la réservation part quand même (1 POST, obtenu ${emailFront.noEmail.posts})`);
    assert(emailFront.emptyAll.posts === 1 && emailFront.emptyAll.last && emailFront.emptyAll.last.name === 'Client', `staff nom/tél/email vides : accepté avec fallback nom « Client » (obtenu "${emailFront.emptyAll.last && emailFront.emptyAll.last.name}")`);
    assert(emailFront.badEmail.posts === 0 && /email invalide/i.test(emailFront.badEmail.error), `email mal formé saisi : refusé + message ("${emailFront.badEmail.error}")`);
    assert(emailFront.goodEmail.posts === 1, `email valide : la réservation part (1 POST, obtenu ${emailFront.goodEmail.posts})`);
    assert(!emailFront.hasReqBadge, 'aucun badge « OBLIGATOIRE » (qb-req) dans la modale staff');
    assert(!emailFront.emailRequiredAttr, 'le champ email staff n\'a plus l\'attribut HTML required');

    // ============ CHANTIER 3b : champ Joueurs : saisie sans perte de focus ============
    console.log('\n[CHANTIER 3b] Champ Joueurs : taper « 40 », backspace jusqu\'à vide, focus conservé');
    await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true });
      renderQuickBook();
    }, { date: TEST_DATE });
    const paxSelector = '#quickBookOverlay input[type="number"]';
    await page.click(paxSelector);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.focus(); el.value = ''; }, paxSelector);
    // Tape « 40 » chiffre par chiffre.
    await page.type(paxSelector, '40', { delay: 20 });
    let paxStep = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return { focused: document.activeElement === el, value: el.value, statePax: quickBookState.pax };
    }, paxSelector);
    assert(paxStep.focused && paxStep.value === '40' && paxStep.statePax === 40, `après « 40 » : focus conservé, champ = 40, état = 40 (obtenu focus=${paxStep.focused} val=${paxStep.value} pax=${paxStep.statePax})`);
    // Backspace jusqu'à vide : PAS de « 1 » forcé pendant la frappe, focus conservé.
    await page.click(paxSelector);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    paxStep = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return { focused: document.activeElement === el, value: el.value };
    }, paxSelector);
    assert(paxStep.focused && paxStep.value === '', `backspace jusqu'à vide : focus conservé et champ vide, PAS de « 1 » forcé (obtenu focus=${paxStep.focused} val="${paxStep.value}")`);
    // Au blur seulement : normalisation vers 1 (entier >= 1).
    await page.evaluate((sel) => { document.querySelector(sel).blur(); }, paxSelector);
    const paxBlur = await page.evaluate((sel) => ({ value: document.querySelector(sel).value, statePax: quickBookState.pax }), paxSelector);
    assert(paxBlur.value === '1' && paxBlur.statePax === 1, `au blur : valeur normalisée à 1 (obtenu val=${paxBlur.value} pax=${paxBlur.statePax})`);
    await page.evaluate(() => closeQuickBook());

    // ============ CHANTIER 4 : « Plus d'options » repensé + email en essentiel ============
    console.log('\n[CHANTIER 4] Plus d\'options structuré + email remonté en champ essentiel');
    const options = await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true });
      quickBookState.moreOpen = false;
      renderQuickBook();
      const modal = document.querySelector('#quickBookOverlay .qb-modal');
      const toggle = document.querySelector('.qb-more-toggle');
      // Bloc essentiel = tout ce qui précède le bouton « Plus d'options ».
      const essentialHtml = modal.innerHTML.split(toggle.outerHTML)[0];
      const emailInEssential = /type="email"/i.test(essentialHtml);
      const toggleLabel = toggle.textContent.trim();
      quickBookState.moreOpen = true;
      renderQuickBook();
      const blockLabels = [...document.querySelectorAll('#quickBookOverlay .blk-label')].map((el) => el.textContent.trim());
      const helps = [...document.querySelectorAll('#quickBookOverlay .qb-block-help')].map((el) => el.textContent.trim());
      // Région « avancée » = tout ce qui suit le bouton « Plus d'options ».
      const toggle2 = document.querySelector('.qb-more-toggle');
      const advancedRegion = document.querySelector('#quickBookOverlay .qb-modal').innerHTML.split(toggle2.outerHTML)[1] || '';
      const advancedHasEmail = /type="email"/i.test(advancedRegion);
      const hasNotesTextarea = Boolean(document.querySelector('#quickBookOverlay textarea'));
      return { emailInEssential, toggleLabel, blockLabels, helps, advancedHasEmail, hasNotesTextarea };
    }, { date: TEST_DATE });
    assert(options.emailInEssential, 'l\'email reste un champ ESSENTIEL visible/saisissable (hors « Plus d\'options »)');
    assert(!/email/i.test(options.toggleLabel), `le libellé du repli ne mentionne plus « email » ("${options.toggleLabel}")`);
    assert(options.blockLabels.some((l) => /Créneau & disponibilité/i.test(l)), `section « Créneau & disponibilité » présente (${options.blockLabels.join(' | ')})`);
    assert(options.blockLabels.some((l) => /Durée & pistes/i.test(l)), 'section « Durée & pistes » présente et étiquetée');
    assert(options.blockLabels.some((l) => /Notes internes/i.test(l)), 'section « Notes internes » présente et étiquetée');
    assert(options.helps.length >= 3, `chaque section porte une aide courte (${options.helps.length} aides)`);
    assert(!options.advancedHasEmail, 'l\'email n\'est plus noyé dans « Plus d\'options »');
    assert(options.hasNotesTextarea, 'les notes internes sont saisissables dans « Plus d\'options »');

    assert(pageErrors.length === 0, `aucune erreur JS pendant le test (${pageErrors.join(' | ') || 'RAS'})`);
    console.log('\nreservation-bugs-test-ok');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error('\nreservation-bugs-test-FAILED:', error.message || error);
  process.exit(1);
});
