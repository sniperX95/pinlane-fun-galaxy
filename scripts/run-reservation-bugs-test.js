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
        // LA FENETRE SIMULE AVANT DE CREER (dryRun, 2026-10-08) : une
        // simulation n est pas une creation, elle ne se compte pas.
        if (body.dryRun) return jsonResponse({ ok: true, dryRun: true, plan: { disponible: true, debut: body.startTime || '', fin: '', blocs: [], etapes: [], prix: null } });
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

    // La piste cliquée n°8, au bord du parc, reste dans les 7 pistes du groupe qui grandit.
    // (La v5 avait un bouton « Compléter les pistes » ; Les seances, 2026-11-03, completent
    // d elles-memes, comme pour la piste 1 ci-dessus.)
    const b2bord = await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [8], allowPastStart: true });
      setQuickPax(40);
      return quickBookState.lanes.slice();
    }, { date: TEST_DATE });
    assert(b2bord.length === 7 && b2bord.includes(8), `40 joueurs depuis la piste n°8 : 7 pistes dont la n°8 (${b2bord.join('-')})`);

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
    // Les seances (2026-11-03) : le telephone se tape dans le champ du ticket (#qbQui,
    // nom OU telephone) ou sur la page Client (#qbPhone) ; le blur de chacun normalise
    // le numero et repeint. Créer ne cree qu une fois le nombre de joueurs choisi (une
    // entree qui donne pax le pose) et porte data-pret="1" quand le plan du serveur est la.
    console.log('\n[BUG 1] Un seul clic crée la réservation + anti double-submit');
    const creerPret = () => page.waitForFunction(() => { const b = document.getElementById('rvCreer'); return b && b.dataset.pret === '1'; }, null, { timeout: 8000 }).catch(() => {});
    const montage = () => page.evaluate(() => ({ focus: document.activeElement ? document.activeElement.id : '', valeur: document.activeElement ? document.activeElement.value : '', pret: (document.getElementById('rvCreer') || {}).dataset?.pret || '' }));
    const unClic = async () => {
      // UN SEUL clic réel sur « Créer »
      await page.click('#rvCreer');
      await page.waitForFunction(() => window.__RES_POSTS__ && window.__RES_POSTS__.length >= 1, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      return page.evaluate(() => window.__RES_POSTS__.length);
    };
    await seed([]);
    await page.evaluate(({ date }) => {
      window.__RES_POSTS__ = [];
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true, pax: 4 });
      quickBookState.name = 'Client Test';
      quickBookState.phone = '+32470111222';
      quickBookState.email = 'client@test.com';
      renderQuickBook();
    }, { date: TEST_DATE });
    await creerPret();
    // focus le champ téléphone : son blur déclenchait un re-render qui détruisait
    // le bouton avant l'arrivée du clic (le fameux « cliquer 2 fois »).
    await page.focus('#qbQui');
    const montageTicket = await montage();
    assert(montageTicket.focus === 'qbQui' && montageTicket.valeur.replace(/\D/g, '') === '32470111222' && montageTicket.pret === '1', `montage : le téléphone tapé dans le ticket (#qbQui) a le focus, Créer est prêt (${JSON.stringify(montageTicket)})`);
    const postsAfterOneClick = await unClic();
    assert(postsAfterOneClick === 1, `1 clic (champ tél. focus) → exactement 1 POST (obtenu ${postsAfterOneClick})`);

    // Le meme, le telephone tape sur la page Client (« E-mail, note, occasion »).
    await seed([]);
    await page.evaluate(({ date }) => {
      window.__RES_POSTS__ = [];
      openQuickBook({ date, startTime: '16:00', type: 'bowling', lanes: [1], allowPastStart: true, pax: 4 });
      quickBookState.name = 'Client Page';
      renderQuickBook();
    }, { date: TEST_DATE });
    await page.click('#rsL-client');
    await page.fill('#qbPhone', '0470 11 12 22');
    await creerPret();
    const montageClient = await montage();
    assert(montageClient.focus === 'qbPhone' && montageClient.valeur === '0470 11 12 22' && montageClient.pret === '1', `montage : le téléphone tapé sur la page Client (#qbPhone) a le focus, Créer est prêt (${JSON.stringify(montageClient)})`);
    const postsPageClient = await unClic();
    assert(postsPageClient === 1, `1 clic (téléphone de la page Client focus) → exactement 1 POST (obtenu ${postsPageClient})`);

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
    // (2026-10-27 : la recherche GRISE les autres groupes au lieu de les
    // retirer ; une piste prise ne parait plus libre. On compte donc les
    // cartes claires, et on verifie que rien n est retire.)
    console.log('\n[CHANTIER 1] Recherche planning : grise à la frappe + effacement rend tout');
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
      // (un planning cache ne se dessine plus : celui-ci se lit dans son onglet)
      setStaffResourceView('bowling');
      renderStaffData();
      const lire = () => {
        const cartes = Array.from(document.querySelectorAll('#planningGridWrap .booking'));
        return { total: cartes.length, claires: cartes.filter((c) => !c.classList.contains('is-grise')).map((c) => Number(c.dataset.bookingResId)) };
      };
      const initial = lire();
      // 1) Frappe : grise EN DIRECT le planning (pas seulement la liste).
      applyStaffSearch('Alice', { immediate: true });
      const afterType = lire();
      const planningInputVal = document.getElementById('globalPlanningSearchInput').value;
      const listInputVal = document.getElementById('searchInput').value;
      // 2) Effacement : tout redevient clair immédiatement (bug « vide »).
      applyStaffSearch('', { immediate: true });
      const afterClear = lire();
      // 3) Recherche téléphone.
      applyStaffSearch('222222', { immediate: true });
      const afterPhone = lire();
      applyStaffSearch('', { immediate: true });
      return { initial, afterType, afterClear, afterPhone, planningInputVal, listInputVal };
    }, { date: TEST_DATE });
    assert(search.initial.total === 2 && search.initial.claires.length === 2, `planning affiche les 2 réservations au départ (obtenu ${JSON.stringify(search.initial)})`);
    assert(search.afterType.total === 2 && search.afterType.claires.join() === '601', `taper « Alice » grise l autre groupe EN DIRECT, sans le retirer → 2 cartes, Alice seule claire (obtenu ${JSON.stringify(search.afterType)})`);
    assert(search.planningInputVal === 'Alice' && search.listInputVal === 'Alice', 'les champs de recherche jumeaux (planning + liste) restent synchronisés');
    assert(search.afterClear.total === 2 && search.afterClear.claires.length === 2, `EFFACER la recherche rend TOUT le planning clair immédiatement (obtenu ${JSON.stringify(search.afterClear)}, bug « vide » corrigé)`);
    assert(search.afterPhone.total === 2 && search.afterPhone.claires.join() === '602', `recherche par téléphone « 222222 » grise aussi le planning, Bob seul clair (obtenu ${JSON.stringify(search.afterPhone)})`);

    // ============ CHANTIER 2 : synchro live différentielle sobre ============
    console.log('\n[CHANTIER 2] Poll différentiel : une résa serveur apparaît sans action + tick 304 minuscule');
    const live = await page.evaluate(async ({ date }) => {
      state.view = 'staff';
      state.staffMenuPage = 'planning';
      state.staffResourceView = 'bowling';
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
      // Badges « obligatoire » (qb-req) absents dans la modale staff. Les seances : le
      // champ e-mail vit sur la page Client (« E-mail, note, occasion »), lue aussi.
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true });
      renderQuickBook();
      const accueil = document.querySelector('#quickBookOverlay').innerHTML;
      document.getElementById('rsL-client').click();
      const champEmail = Boolean(document.querySelector('#quickBookOverlay input[type="email"]'));
      const modalHtml = accueil + document.querySelector('#quickBookOverlay').innerHTML;
      const hasReqBadge = /qb-req|>obligatoire</i.test(modalHtml);
      const emailRequiredAttr = /type="email"[^>]*\brequired\b/i.test(modalHtml);
      return { noEmail, emptyAll, badEmail, goodEmail, hasReqBadge, emailRequiredAttr, champEmail };
    }, { date: TEST_DATE });
    assert(emailFront.noEmail.posts === 1, `staff sans email : la réservation part quand même (1 POST, obtenu ${emailFront.noEmail.posts})`);
    assert(emailFront.emptyAll.posts === 1 && emailFront.emptyAll.last && emailFront.emptyAll.last.name === 'Client', `staff nom/tél/email vides : accepté avec fallback nom « Client » (obtenu "${emailFront.emptyAll.last && emailFront.emptyAll.last.name}")`);
    assert(emailFront.badEmail.posts === 0 && /email invalide/i.test(emailFront.badEmail.error), `email mal formé saisi : refusé + message ("${emailFront.badEmail.error}")`);
    assert(emailFront.goodEmail.posts === 1, `email valide : la réservation part (1 POST, obtenu ${emailFront.goodEmail.posts})`);
    assert(!emailFront.hasReqBadge, 'aucun badge « OBLIGATOIRE » (qb-req) dans la modale staff');
    assert(emailFront.champEmail && !emailFront.emailRequiredAttr, `le champ email staff n'a plus l'attribut HTML required (champ lu sur la page Client : ${emailFront.champEmail})`);

    // ============ CHANTIER 3b : champ Joueurs : saisie sans perte de focus ============
    // Les seances (2026-11-03) : les joueurs se choisissent sur leurs touches (1 a 10, 12,
    // 15, 20) ; #qbPax est « Autre », pour un autre nombre, qui s applique a Entree ou a
    // la sortie du champ (onchange), plus a chaque chiffre.
    console.log('\n[CHANTIER 3b] Champ Joueurs : taper « 40 », backspace jusqu\'à vide, focus conservé');
    await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true });
      renderQuickBook();
    }, { date: TEST_DATE });
    const paxSelector = '#qbPax';
    const lirePax = () => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const touche = document.querySelector('#rsHaut [data-pax][aria-pressed="true"]');
      return { focused: document.activeElement === el, value: el.value, statePax: quickBookState.pax, touche: touche ? touche.dataset.pax : '' };
    }, paxSelector);
    await page.click(paxSelector);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.focus(); el.value = ''; }, paxSelector);
    // Tape « 40 » chiffre par chiffre.
    await page.type(paxSelector, '40', { delay: 20 });
    let paxStep = await lirePax();
    assert(paxStep.focused && paxStep.value === '40', `après « 40 » : focus conservé, champ = 40 (obtenu focus=${paxStep.focused} val=${paxStep.value})`);
    // Entree pose le nombre : etat = 40, et « Autre » le garde.
    await page.keyboard.press('Enter');
    paxStep = await lirePax();
    assert(paxStep.value === '40' && paxStep.statePax === 40, `Entrée pose « 40 » : état = 40, champ = 40 (obtenu val=${paxStep.value} pax=${paxStep.statePax})`);
    // Backspace jusqu'à vide : PAS de « 1 » forcé pendant la frappe, focus conservé.
    // v5 : le champ a la largeur de ses chiffres ; un clic au milieu pose le
    // curseur entre « 4 » et « 0 ». On efface depuis la fin, comme le doigt.
    await page.click(paxSelector);
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    paxStep = await lirePax();
    assert(paxStep.focused && paxStep.value === '', `backspace jusqu'à vide : focus conservé et champ vide, PAS de « 1 » forcé (obtenu focus=${paxStep.focused} val="${paxStep.value}")`);
    // Au blur seulement : normalisation vers 1 (entier >= 1), que sa touche montre.
    await page.evaluate((sel) => { document.querySelector(sel).blur(); }, paxSelector);
    const paxBlur = await lirePax();
    assert(paxBlur.statePax === 1 && paxBlur.touche === '1' && paxBlur.value === '', `au blur : valeur normalisée à 1, sur sa touche (obtenu val=${paxBlur.value} pax=${paxBlur.statePax} touche=${paxBlur.touche})`);
    // Toucher le nombre le selectionne en entier : la frappe le REMPLACE (« 40 » puis
    // 15 donne 15, pas 4015 ni 1540). « Autre » ne montre un nombre que hors des
    // touches : 40.
    await page.click(paxSelector);
    await page.keyboard.type('40', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.click(paxSelector);
    await page.keyboard.type('15', { delay: 20 });
    const tape = await lirePax();
    await page.keyboard.press('Enter');
    const remplace = await lirePax();
    assert(tape.value === '15' && remplace.statePax === 15, `toucher le nombre puis taper le remplace (obtenu val=${tape.value} pax=${remplace.statePax})`);
    await page.evaluate(() => closeQuickBook());

    // ============ CHANTIER 4 : les réglages d une ligne + l e-mail à un geste ============
    // LES OPTIONS REMISES EN ORDRE (2026-10-02, Movsar : « les + d options c est moche et
    // illogique ») : ce qui ouvre les reglages dit ce qu il ouvre, chaque section porte
    // son titre, l e-mail n est jamais noye dans les reglages d une ligne. Les seances
    // (2026-11-03) n ont plus de repli ni de chevrons : chaque ligne du ticket ouvre sa
    // page a gauche (Durée, Pistes, Laquelle, Heure) ; « E-mail, note, occasion », dans
    // le ticket, ouvre la page Client (e-mail, note pour l equipe).
    console.log('\n[CHANTIER 4] Chaque ligne ouvre ses réglages, l\'e-mail reste à un geste');
    const options = await page.evaluate(({ date }) => {
      openQuickBook({ date, startTime: '16:00', type: 'bowling', allowPastStart: true, pax: 4 });
      renderQuickBook();
      const ticket = document.querySelector('#quickBookOverlay .rs-tk');
      const lien = document.getElementById('rsL-client');
      const emailUnGeste = Boolean(lien && ticket && ticket.contains(lien) && lien.getClientRects().length && /E-mail/.test(lien.textContent));
      // La ligne Bowling du ticket : ce qu elle dit, puis la page qu elle ouvre.
      const ligne = document.getElementById('rsL-a-bowling');
      const ligneLabel = ligne ? ligne.getAttribute('aria-label') || '' : '';
      if (ligne) ligne.click();
      const corps = document.getElementById('rsCorps');
      const titre = ((document.getElementById('rsQ') || {}).textContent || '').trim();
      const blockLabels = [...corps.querySelectorAll('.rs-rang .rs-lbl')].map((el) => el.textContent.trim());
      const heure = corps.querySelector('[data-heure-l][aria-pressed="true"]');
      const departLabel = heure && blockLabels.includes('Heure') ? `Heure ${heure.dataset.heureL}` : '';
      const ligneHasEmail = /type="email"/i.test(corps.innerHTML);
      // La page Client : l e-mail et la note pour l equipe.
      const versClient = document.getElementById('rsL-client');
      if (versClient) versClient.click();
      const email = document.querySelector('#rsCorps input[type="email"]');
      const notes = document.getElementById('qbNotes');
      const noteLabel = notes ? ((notes.closest('label') || {}).textContent || '').trim() : '';
      return { emailUnGeste, emailClient: Boolean(email && email.getClientRects().length), ligneLabel, titre, blockLabels, departLabel, ligneHasEmail, hasNotesTextarea: Boolean(notes && notes.tagName === 'TEXTAREA' && notes.getClientRects().length), noteLabel };
    }, { date: TEST_DATE });
    assert(options.emailUnGeste && options.emailClient && !options.ligneHasEmail, `l'e-mail reste à un geste dans le billet (« E-mail, note, occasion »), jamais dans le détail d'une ligne (lien ${options.emailUnGeste}, page Client ${options.emailClient}, ligne ${options.ligneHasEmail})`);
    assert(!/mail/i.test(options.ligneLabel), `le libellé de ce qui ouvre les réglages ne mentionne pas « email » ("${options.ligneLabel}")`);
    assert(/^Bowling .*, changer$/.test(options.ligneLabel) && options.titre === 'Bowling', `la ligne dit ce qu elle ouvre, sa page porte son nom ("${options.ligneLabel}" -> "${options.titre}")`);
    assert(options.departLabel === 'Heure 16:00', `le départ précis se règle sur la ligne, à sa rangée Heure ("${options.departLabel}")`);
    assert(options.blockLabels.includes('Pistes'), `section des pistes présente et étiquetée (${options.blockLabels.join(', ')})`);
    assert(/Note pour l’équipe/.test(options.noteLabel), `la note pour l équipe est présente et étiquetée ("${options.noteLabel}")`);
    assert(!options.ligneHasEmail, 'l\'email n\'est pas noyé dans les réglages d\'une ligne');
    assert(options.hasNotesTextarea, 'les notes internes sont saisissables (page Client)');

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
