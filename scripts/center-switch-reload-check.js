// LE GATE DE LA BASCULE DE CENTRE (2026-08-21, Edge headless).
//
// DEUX PLAINTES DE MOVSAR, deux invariants :
//
//   [A] « ca affiche aucun centre » : apres une connexion par le formulaire, le
//       selecteur de centre etait VIDE. loadMenuCenters n'etait appele que sur
//       le chemin de RESTAURATION de session (loadStaffAuthSession), jamais
//       apres submitLogin. Le switcher retombait donc sur le repli statique des
//       trois centres Fun Galaxy, filtre par le centre courant : pour un centre
//       ne dans la console (n4-bowling, mi12) ce repli est VIDE.
//
//   [B] « quand on change de centre ca recharge rien, ca change instant, ya des
//       chiffres identiques d'un centre a l'autre » : les caches sans cle de
//       centre (blocs de disponibilite, config d'etablissement, opsAdminCache,
//       adminDashboardCache) survivaient a la bascule. L'ecran reaffichait les
//       donnees du centre QUITTE sous le nom du nouveau : un etat faux et
//       credible, le pire des deux.
//
// CE QUI EST MESURE, jamais une presence de chaine : les requetes reellement
// parties (URL + centerId, comptees dans la page), l'etat des caches du VRAI
// code, et le DOM du popover. Les deux bascules sont de VRAIS CLICS dans le
// menu, pas des appels de fonction.
//
// Chaque invariant a sa contre-preuve : on neutralise la ligne de production
// qui le tient et on exige que la mesure redevienne celle du bug.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/center-switch-reload-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CENTER_SWITCH_PORT || 4297);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Deux centres de DEUX entreprises differentes, avec des donnees qui ne se
// ressemblent pas : c'est ce qui rend un melange visible.
const CENTER_A = { id: 'libramont', name: 'Fun Galaxy Libramont' };
const CENTER_B = { id: 'n4-bowling', name: 'N4 Bowling' };

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---- Mock : deux centres, des donnees distinctes, et un COMPTEUR d'appels ---
async function installMock(page, { withSession, breakCatalog = false }) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, withSession, breakCatalog, A, B }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'direction.view', 'centers.switch', 'settings.manage', 'emails.view', 'users.manage', 'platform.admin'];
    const sessionFor = (centerId) => ({
      token: 'qa', cookieBacked: false, centerId, expiresAt,
      member: { id: `${centerId}:platform-owner`, name: 'Movsar' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    });
    // Le serveur ouvre la session sur le centre DEMANDE : c'est le contrat
    // etabli par lib/staff-auth (le code dit le centre).
    window.__calls = [];
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });

    // Un bloc de disponibilite par centre, avec un motif RECONNAISSABLE : si le
    // motif de A survit a la bascule vers B, le melange se voit.
    const blocksFor = (centerId) => (centerId === B.id
      ? [
        { id: 901, centerId: B.id, scope: 'center', reason: 'BLOC-N4-UN', recurrence: 'once', date: '2026-09-01' },
        { id: 902, centerId: B.id, scope: 'center', reason: 'BLOC-N4-DEUX', recurrence: 'once', date: '2026-09-02' },
      ]
      : [{ id: 101, centerId: A.id, scope: 'center', reason: 'BLOC-LIBRAMONT', recurrence: 'once', date: '2026-09-03' }]);

    const configFor = (centerId) => ({
      ok: true,
      centers: [centerId === B.id
        ? { id: B.id, name: B.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 12 } } }
        : { id: A.id, name: A.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8 } } }],
      activities: [],
    });

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname.startsWith('/api/')) {
        window.__calls.push({
          path: u.pathname,
          action: u.searchParams.get('action') || (init && init.body && String(init.body).includes('"action"') ? JSON.parse(init.body).action : ''),
          centerId: u.searchParams.get('centerId') || '',
          method: (init && init.method) || 'GET',
        });
      }
      if (u.pathname === '/api/staff-auth') {
        const isPost = String((init && init.method) || 'GET').toUpperCase() === 'POST';
        const body = isPost && init.body ? JSON.parse(init.body) : {};
        if (isPost && body.action === 'login') {
          return J({ ok: true, authenticated: true, session: sessionFor(body.centerId || A.id) });
        }
        const wanted = u.searchParams.get('centerId') || A.id;
        return J({ ok: true, authenticated: true, session: sessionFor(wanted) });
      }
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        const centerId = u.searchParams.get('centerId') || A.id;
        if (action === 'menuCenters') {
          // Les RESSOURCES voyagent avec le centre : A a une arene laser, B
          // n'en a pas (weaponCount 0, l'etat reel de N4 en production).
          return J({ ok: true, owner: true, centers: [
            {
              id: A.id, name: A.name, status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy',
              resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30 } },
            },
            {
              id: B.id, name: B.name, status: 'active', clientId: 'n4-bowling', clientName: 'N4',
              // Etat REEL de N4 en production : aucune arene laser, et un
              // bowling vendu AUX PARTIES ET PAR PERSONNE, pas a la grille par
              // piste. C'est ce qui rend visible une grille qui n'est pas la
              // sienne.
              resources: {
                bowling: {
                  laneCount: 8,
                  pricing: {
                    mode: 'per_game_per_person', minutesPerGame: 60, minutesPerPlayerPerGame: 10,
                    tiers: [{ days: [3, 4], prices: [6, 11] }, { days: [0, 5, 6], prices: [7, 13] }],
                  },
                },
                laser: { weaponCount: 0 },
              },
            },
          ] });
        }
        if (action === 'listAvailabilityBlocks') return J({ ok: true, blocks: blocksFor(centerId) });
        if (action === 'centerConfig') return J(configFor(centerId));
        // LE CATALOGUE TARIFAIRE DE LA CONSOLE. Le vrai serveur deduit le centre
        // de la SESSION, pas d'un parametre d'URL : ce double fait pareil, il
        // lit le centre courant au moment de l'appel. Repondre a la place du
        // code (une liste figee) masquerait justement le bug recherche.
        if (action === 'clientCatalog') {
          const active = (typeof state !== 'undefined' && state.adminCenterId) ? state.adminCenterId : A.id;
          const entry = (id, name, family, price) => ({
            id, name, bookingFamily: family, desc: [], notes: [], priceType: 'per_pax', minPax: 6,
            source: 'custom', hasBowling: true, base: { priceValue: price, priceOld: null },
            effective: { name, priceValue: price, priceOld: null, removed: false, enabled: true },
            centerOverride: null,
          });
          return J({
            ok: true,
            formulas: active === B.id
              ? [entry('n4-jeudi-fou', 'JEUDI FOU N4', 'Formules speciales', 12)]
              : [entry('f1', 'FORMULE 1', 'Formules anniversaires', 26)],
            activities: active === B.id
              ? [{ id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane' }]
              : [{ id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane' }, { id: 'laser_game', name: 'Laser Game', resourceType: 'laser_arena' }],
          });
        }
        return J({ ok: true, communications: [], suggestions: [], events: [], samples: [] });
      }
      // Le CATALOGUE du centre : chacun a ses formules, aucune n'est partagee.
      // C'est ce que la console doit proposer a la reservation.
      if (u.pathname === '/api/public-booking-meta') {
        // Catalogue serveur en panne : c'est LA situation ou le repli statique
        // reprenait la main et vendait le catalogue de Fun Galaxy a tout le monde.
        if (breakCatalog) return new Response('{"ok":false}', { status: 500, headers: { 'content-type': 'application/json' } });
        const centerId = u.searchParams.get('centerId') || A.id;
        const formules = centerId === B.id
          ? [{ id: 'n4-jeudi-fou', name: 'JEUDI FOU N4', family: 'Formules N4', desc: [], price: 12, type: 'per_pax', minPax: 2, notes: [] }]
          : [{ id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: [], price: 26, type: 'per_pax', minPax: 6, notes: [] }];
        return J({
          ok: true, centerId, formules,
          activities: centerId === B.id ? [{ id: 'bowling', name: 'Bowling' }] : [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }],
          center: { id: centerId },
        });
      }
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], blocks: [] });
      return nf(input, init);
    };
    try {
      if (withSession) localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(sessionFor(A.id)));
      else localStorage.removeItem('funGalaxy_auth_v1');
    } catch (e) {}
  }, { expiresAt, withSession, breakCatalog, A: CENTER_A, B: CENTER_B });
}

// Etat lu DANS la page : caches du vrai code + appels reellement partis.
const READ_STATE = `(() => ({
  centerId: (typeof state !== 'undefined') ? state.adminCenterId : null,
  sessionCenterId: (typeof state !== 'undefined' && state.staffAuthSession) ? state.staffAuthSession.centerId : null,
  menuCentersLoaded: (typeof scopedCentersCache !== 'undefined') ? scopedCentersCache.loaded : null,
  menuCentersCount: (typeof getMenuCenters === 'function') ? getMenuCenters().length : -1,
  blocksLoaded: (typeof availabilityBlocksCache !== 'undefined') ? availabilityBlocksCache.loaded : null,
  blockReasons: (typeof availabilityBlocksCache !== 'undefined' ? (availabilityBlocksCache.blocks || []) : []).map(b => b.reason),
  configCenters: (typeof staffCenterConfigCache !== 'undefined' ? (staffCenterConfigCache.centers || []) : []).map(c => c.id),
  formuleIds: (typeof getEffectiveCatalogFormules === 'function' ? getEffectiveCatalogFormules() : []).map(f => f.id),
  menuKeys: [...document.querySelectorAll('.fgx-menu-nav [data-fgx-menu-key]')].map(n => n.dataset.fgxMenuKey),
  // Les onglets de ressource de la page Planning, mesures a la BOITE rendue :
  // une classe posee ne prouve rien, un rectangle nul si.
  resourceTabs: ['staffTabBowling', 'staffTabLaser', 'staffTabAll'].map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const r = el.getBoundingClientRect();
    const sub = el.querySelector('.sub');
    return { id, present: true, visible: r.width > 0 && r.height > 0, sub: sub ? sub.textContent.trim() : '' };
  }),
  // L'ECRAN Tarifs & formules, mesure sur les CARTES REELLEMENT PEINTES.
  // Le gate lisait jusqu'ici les cles du MENU : « aucun ecran de tarifs laser »
  // voulait dire « aucune entree de menu », pas « aucune carte laser dans la
  // page ». Une entree de menu masquee ne prouve rien sur ce que la page
  // affiche : c'est ce qui a laisse passer les deux defauts mesures ici.
  pricingCardTitles: [...document.querySelectorAll('.pv2-price-card .pv2-price-head strong')]
    .map(n => n.textContent.trim()),
  pricingSectionTitles: [...document.querySelectorAll('.pv2-catalog-section .pv2-section-head h3')]
    .map(n => n.textContent.trim()),
  calls: (window.__calls || []).slice(),
}))()`;

const readState = (page) => page.evaluate(READ_STATE);
const blockCalls = (calls, centerId) => calls.filter(c => c.action === 'listAvailabilityBlocks' && c.centerId === centerId).length;

// La page Tarifs & formules ouverte par le VRAI chemin : le clic du menu, pas
// un appel de fonction interne. Le groupe parent est deplie d'abord, sinon le
// sous-item existe dans le DOM sans etre atteignable.
async function openPricingPage(page) {
  await page.evaluate(() => {
    if (typeof setMenuGroupOpen === 'function') setMenuGroupOpen('activities', true);
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  });
  await page.waitForSelector('[data-fgx-menu-key="prices"]', { timeout: 10000 });
  // Clic DOM sur le bouton exact : un clic par coordonnees atterrissait sur le
  // voisin quand le groupe venait d'etre deplie (mesure : la page ouverte etait
  // « users »). C'est le VRAI listener delegue du menu qui traite l'evenement,
  // rien n'est court-circuite.
  await page.$eval('[data-fgx-menu-key="prices"]', (node) => node.click());
  await page.waitForFunction(
    () => typeof getStaffMenuPage === 'function' && getStaffMenuPage() === 'prices',
    null, { timeout: 10000 },
  );
  // La page se repeint quand le catalogue arrive : on attend une carte, pas un
  // delai fixe.
  await page.waitForFunction(
    () => document.querySelectorAll('.pv2-price-card').length > 0,
    null, { timeout: 15000 },
  ).catch(() => null);
}

async function openCenterMenu(page) {
  await page.waitForSelector('[data-fgx-center-menu]', { state: 'visible', timeout: 10000 });
  await page.click('[data-fgx-center-menu]');
  await page.waitForSelector('.fgx-menu-popover[data-popover-kind="center"]', { state: 'visible', timeout: 10000 });
}

async function listedCenters(page) {
  return page.$$eval('.fgx-menu-popover[data-popover-kind="center"] [data-fgx-center-option]', nodes => nodes.map(n => n.dataset.fgxCenterOption));
}

// Le resume d'un centre tel que l'utilisateur le LIT dans le switcher. Mesure
// dans le DOM, pas via une fonction interne au module du menu : c'est la ligne
// qui annoncait « 30 armes laser » a un centre qui n'en a aucune.
async function centerMetaInPopover(page, centerId) {
  await openCenterMenu(page);
  const meta = await page.$eval(
    `.fgx-menu-popover[data-popover-kind="center"] [data-fgx-center-option="${centerId}"] small`,
    (node) => node.textContent.trim(),
  ).catch(() => '');
  await page.keyboard.press('Escape').catch(() => null);
  return meta;
}

async function bootStaff(page, { page: staffPage = 'planning' } = {}) {
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffMenu === 'function',
    null, { timeout: 15000 },
  );
  await page.evaluate((key) => {
    setView('staff');
    if (typeof setMenuPage === 'function') setMenuPage(key);
    else if (typeof state !== 'undefined') { state.staffMenuPage = key; }
    if (typeof renderStaff === 'function') renderStaff();
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  }, staffPage);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let failed = 0;
  try {
    // ===================================================================== [A]
    section('[A] Apres une CONNEXION par le formulaire, le selecteur liste les centres');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: false });
      // Le navigateur garde le dernier centre consulte : celui d'un client, ne
      // dans la console. C'est l'etat exact de la capture de Movsar.
      await page.addInitScript((centerId) => {
        try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: centerId, view: 'client' })); } catch (e) {}
      }, CENTER_B.id);
      await page.goto(`${BASE_URL}/?v=switch-a-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.submitLogin === 'function', null, { timeout: 15000 });

      // VRAIE connexion par le formulaire (le mock accepte n'importe quel code).
      await page.evaluate(() => { setView('staff'); });
      await page.waitForSelector('#loginPass', { state: 'visible', timeout: 10000 });
      await page.fill('#loginPass', 'GATE-CODE-0000');
      await page.click('.auth-form button[type="submit"]');
      await page.waitForFunction(() => typeof hasSavedAuth === 'function' && hasSavedAuth(), null, { timeout: 15000 });
      await page.waitForFunction(() => typeof scopedCentersCache !== 'undefined' && scopedCentersCache.loaded, null, { timeout: 15000 })
        .catch(() => null);

      const st = await readState(page);
      record('la session ouverte porte le centre demande', st.sessionCenterId === CENTER_B.id, `centre=${st.sessionCenterId}`);
      record('la liste des centres du tenant est chargee apres le login', st.menuCentersLoaded === true, `loaded=${st.menuCentersLoaded}`);
      record('menuCenters a bien ete appele sur ce chemin', st.calls.some(c => c.action === 'menuCenters'), `${st.calls.filter(c => c.action === 'menuCenters').length} appel(s)`);

      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      await openCenterMenu(page);
      const listed = await listedCenters(page);
      record('le popover liste les DEUX centres', listed.length === 2, listed.join(',') || 'aucun');
      record('dont le centre du client, celui qui etait affiche', listed.includes(CENTER_B.id), listed.join(','));
      await context.close();
    }

    // -- contre-preuve [A] : sans l'appel, le popover est vide ----------------
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: false });
      await page.addInitScript((centerId) => {
        try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: centerId, view: 'client' })); } catch (e) {}
      }, CENTER_B.id);
      await page.goto(`${BASE_URL}/?v=switch-a2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.submitLogin === 'function', null, { timeout: 15000 });
      // On neutralise la ligne de production ajoutee dans submitLogin.
      await page.evaluate(() => { window.loadMenuCenters = async () => {}; });
      await page.evaluate(() => { setView('staff'); });
      await page.waitForSelector('#loginPass', { state: 'visible', timeout: 10000 });
      await page.fill('#loginPass', 'GATE-CODE-0000');
      await page.click('.auth-form button[type="submit"]');
      await page.waitForFunction(() => typeof hasSavedAuth === 'function' && hasSavedAuth(), null, { timeout: 15000 });
      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      await openCenterMenu(page);
      const listed = await listedCenters(page);
      record('contre-preuve [A] : sans le chargement, AUCUN centre listable', listed.length === 0, listed.join(',') || 'aucun');
      await context.close();
    }

    // ===================================================================== [B]
    section('[B] Changer de centre RECHARGE les donnees, il ne les recycle pas');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true });
      await page.goto(`${BASE_URL}/?v=switch-b-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && availabilityBlocksCache.loaded && (availabilityBlocksCache.blocks || []).length > 0,
        null, { timeout: 15000 },
      ).catch(() => null);

      const before = await readState(page);
      record('centre de depart charge : le bloc de Libramont est en memoire', before.blockReasons.includes('BLOC-LIBRAMONT'), before.blockReasons.join(',') || 'aucun');
      record('aucun appel pour le second centre a ce stade', blockCalls(before.calls, CENTER_B.id) === 0, `${blockCalls(before.calls, CENTER_B.id)} appel(s)`);

      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && (availabilityBlocksCache.blocks || []).some(b => String(b.reason).startsWith('BLOC-N4')),
        null, { timeout: 15000 },
      ).catch(() => null);

      const after = await readState(page);
      record('le centre courant a bascule', after.centerId === CENTER_B.id, `centre=${after.centerId}`);
      record('une VRAIE requete est partie pour le nouveau centre', blockCalls(after.calls, CENTER_B.id) >= 1, `${blockCalls(after.calls, CENTER_B.id)} appel(s)`);
      record('les blocs affiches sont ceux du nouveau centre', after.blockReasons.includes('BLOC-N4-UN'), after.blockReasons.join(',') || 'aucun');
      record('AUCUNE donnee du centre quitte ne survit', !after.blockReasons.includes('BLOC-LIBRAMONT'), after.blockReasons.join(',') || 'aucun');
      record('la config d etablissement suit aussi le nouveau centre', !after.configCenters.includes(CENTER_A.id), after.configCenters.join(',') || 'vide');

      section('[C] La console d un centre ne montre que CE QUE CE CENTRE A');
      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      const onB = await readState(page);
      record(
        'aucun planning Laser Game pour un centre sans arene',
        !onB.menuKeys.includes('laser'),
        onB.menuKeys.join(',') || 'menu vide',
      );
      record(
        'aucun ecran de tarifs Laser Game non plus',
        !onB.menuKeys.includes('laserGame'),
        onB.menuKeys.filter(k => /laser/i.test(k)).join(',') || 'aucun',
      );
      record('le planning bowling reste, lui', onB.menuKeys.includes('bowling'));
      const metaB = await centerMetaInPopover(page, CENTER_B.id);
      record('le resume du centre n annonce aucune arme laser', Boolean(metaB) && !/laser/i.test(metaB), metaB || 'vide');
      const tabsB = Object.fromEntries(onB.resourceTabs.map(t => [t.id, t]));
      record(
        'aucun onglet Planning Laser Game dans la page',
        tabsB.staffTabLaser && tabsB.staffTabLaser.visible === false,
        tabsB.staffTabLaser ? ('visible=' + tabsB.staffTabLaser.visible) : 'absent',
      );
      record(
        'l onglet bowling reste et annonce SES pistes',
        Boolean(tabsB.staffTabBowling && tabsB.staffTabBowling.visible && /piste/.test(tabsB.staffTabBowling.sub)),
        tabsB.staffTabBowling ? tabsB.staffTabBowling.sub : 'absent',
      );
      record(
        'les formules proposees sont CELLES DU CENTRE',
        onB.formuleIds.length === 1 && onB.formuleIds[0] === 'n4-jeudi-fou',
        onB.formuleIds.join(',') || 'aucune',
      );
      record(
        'et aucune formule du socle Fun Galaxy ne traine',
        !onB.formuleIds.includes('f1'),
        onB.formuleIds.join(',') || 'aucune',
      );

      section('[D] Retour sur un centre qui a tout : le laser revient');
      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_A.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_A.id, { timeout: 10000 });
      await page.waitForFunction(
        () => typeof getEffectiveCatalogFormules === 'function'
          && getEffectiveCatalogFormules().length === 1
          && getEffectiveCatalogFormules()[0].id === 'f1',
        null, { timeout: 15000 },
      ).catch(() => null);
      await page.evaluate(() => { if (typeof renderStaffMenu === 'function') renderStaffMenu(); });
      const onA = await readState(page);
      record('le planning Laser Game est de retour', onA.menuKeys.includes('laser'), onA.menuKeys.join(','));
      record('les tarifs Laser Game aussi', onA.menuKeys.includes('laserGame'));
      const metaA = await centerMetaInPopover(page, CENTER_A.id);
      const tabsA = Object.fromEntries(onA.resourceTabs.map(t => [t.id, t]));
      record(
        'l onglet Planning Laser Game est de retour, avec SES armes',
        Boolean(tabsA.staffTabLaser && tabsA.staffTabLaser.visible && /arme/.test(tabsA.staffTabLaser.sub)),
        tabsA.staffTabLaser ? (tabsA.staffTabLaser.sub || 'sans sous-titre') : 'absent',
      );
      record('le resume annonce ses armes laser', /laser/i.test(metaA), metaA || 'vide');
      record(
        'et les formules sont redevenues les siennes, RELUES au serveur',
        onA.formuleIds.length === 1 && onA.formuleIds[0] === 'f1',
        onA.formuleIds.join(',') || 'aucune',
      );
      record(
        'une requete de catalogue est partie pour chaque centre',
        onA.calls.filter(c => c.path === '/api/public-booking-meta' && c.centerId === CENTER_A.id).length >= 1
          && onA.calls.filter(c => c.path === '/api/public-booking-meta' && c.centerId === CENTER_B.id).length >= 1,
        onA.calls.filter(c => c.path === '/api/public-booking-meta').map(c => c.centerId).join(',') || 'aucune',
      );
      await context.close();
    }

    // -- contre-preuve [B] : sans la purge, les donnees de A survivent --------
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true });
      await page.goto(`${BASE_URL}/?v=switch-b2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await page.waitForFunction(
        () => typeof availabilityBlocksCache !== 'undefined' && availabilityBlocksCache.loaded && (availabilityBlocksCache.blocks || []).length > 0,
        null, { timeout: 15000 },
      ).catch(() => null);
      // On neutralise la purge : c'est l'etat d'AVANT le correctif.
      await page.evaluate(() => { window.resetCenterScopedCaches = () => {}; });
      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
      await page.waitForTimeout(1500);
      const stuck = await readState(page);
      record(
        'contre-preuve [B] : sans la purge, le bloc du centre QUITTE reste affiche',
        stuck.blockReasons.includes('BLOC-LIBRAMONT'),
        stuck.blockReasons.join(',') || 'aucun',
      );
      record(
        'contre-preuve [B] : et aucun bloc du nouveau centre n arrive',
        !stuck.blockReasons.some(r => String(r).startsWith('BLOC-N4')),
        stuck.blockReasons.join(',') || 'aucun',
      );
      await context.close();
    }
    // ===================================================================== [E]
    section('[E] Contre-preuves par MUTATION : sans ces deux gardes, le melange revient');
    {
      const MENU_SRC = path.join(ROOT, 'assets', 'staff-menu.js');
      const APP_SRC = path.join(ROOT, 'assets', 'app-main.js');
      const menuOriginal = fs.readFileSync(MENU_SRC, 'utf8');
      const appOriginal = fs.readFileSync(APP_SRC, 'utf8');
      // 1. le menu cesse de regarder ce que le centre possede
      const menuMutated = menuOriginal.replace('return count > 0;', 'return true;');
      // 2. le repli du socle redevient universel
      const appMutated = appOriginal.replace(
        'return FILE_SEED_CENTER_IDS.includes(centerId) ? FORMULES : [];',
        'return FORMULES;',
      );
      record('les deux lignes de production sont bien celles que l on mute', menuMutated !== menuOriginal && appMutated !== appOriginal);
      try {
        fs.writeFileSync(MENU_SRC, menuMutated);
        fs.writeFileSync(APP_SRC, appMutated);
        const context = await browser.newContext();
        const page = await context.newPage();
        await installMock(page, { withSession: true, breakCatalog: true });
        // Session ET ecran sur le centre SANS arene laser, des le premier rendu.
        await page.addInitScript((B) => {
          const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
          try {
            localStorage.setItem('funGalaxy_auth_v1', JSON.stringify({
              token: 'qa', cookieBacked: false, centerId: B, expiresAt,
              member: { id: `${B}:platform-owner`, name: 'Movsar' },
              role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
              permissions: ['dashboard.view', 'planning.view', 'direction.view', 'centers.switch', 'settings.manage', 'users.manage', 'platform.admin'],
            }));
            localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: B, view: 'client' }));
          } catch (e) {}
        }, CENTER_B.id);
        await page.goto(`${BASE_URL}/?v=switch-e-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
        await bootStaff(page);
        await page.waitForTimeout(1200);
        const broken = await readState(page);
        record(
          'menu non filtre : le Laser Game revient chez un centre sans arene, ce gate ROUGIRAIT',
          broken.menuKeys.includes('laser') || broken.menuKeys.includes('laserGame'),
          broken.menuKeys.filter(k => /laser/i.test(k)).join(',') || 'aucun',
        );
        record(
          'repli universel, catalogue serveur en panne : les formules de Fun Galaxy reviennent chez ce centre',
          broken.formuleIds.includes('f1'),
          broken.formuleIds.slice(0, 4).join(',') || 'aucune',
        );
        await context.close();
      } finally {
        fs.writeFileSync(MENU_SRC, menuOriginal);
        fs.writeFileSync(APP_SRC, appOriginal);
      }
      record(
        'les deux fichiers de production sont restaures a l identique',
        fs.readFileSync(MENU_SRC, 'utf8') === menuOriginal && fs.readFileSync(APP_SRC, 'utf8') === appOriginal,
      );

      // Le pendant SAIN de la contre-preuve, dans la meme panne : ce qui compte
      // n'est pas que le repli existe, c'est qu'il ne serve JAMAIS le catalogue
      // d'un autre client. Une liste vide se corrige a la seconde suivante, un
      // catalogue etranger se vend au telephone.
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true, breakCatalog: true });
      await page.addInitScript((B) => {
        try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: B, view: 'client' })); } catch (e) {}
      }, CENTER_B.id);
      await page.goto(`${BASE_URL}/?v=switch-e2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await page.waitForTimeout(1200);
      const safe = await readState(page);
      record(
        'code sain, meme panne : AUCUNE formule Fun Galaxy chez ce centre',
        !safe.formuleIds.includes('f1'),
        safe.formuleIds.join(',') || 'aucune (attendu)',
      );
      await context.close();
    }

    // ===================================================================== [F]
    // L'ECRAN, pas la cle de menu. Les sections precedentes prouvent que
    // l'ENTREE de menu « Laser Game » disparait chez un centre sans arene.
    // Elles ne disaient rien de ce que la PAGE Tarifs & formules peint, et
    // c'est la que les deux defauts vivaient (captures Movsar, 2026-08-21) :
    //   1. le catalogue tarifaire de la console SURVIVAIT a la bascule, donc
    //      Fun Galaxy voyait les formules de N4 sous son propre nom ;
    //   2. les cartes bowling et laser etaient construites depuis les
    //      constantes du socle (grille par piste 20/39/59/78, laser 10/18/25),
    //      quel que soit le centre : N4, qui n'a AUCUNE arene et vend aux
    //      parties, se voyait proposer les deux.
    section('[F] La page Tarifs & formules ne montre que le catalogue DE CE CENTRE');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { withSession: true });
      await page.goto(`${BASE_URL}/?v=switch-f-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      await openPricingPage(page);

      const onA = await readState(page);
      record('sur Fun Galaxy : SA formule est affichee', onA.pricingCardTitles.includes('FORMULE 1'), onA.pricingCardTitles.join(' | ') || 'aucune carte');
      record('sur Fun Galaxy : aucune formule de N4', !onA.pricingCardTitles.includes('JEUDI FOU N4'), onA.pricingCardTitles.join(' | ') || 'aucune carte');
      record('sur Fun Galaxy : la section Laser Game est la (30 armes)', onA.pricingSectionTitles.includes('Laser Game'), onA.pricingSectionTitles.join(' | ') || 'aucune section');

      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
      await openPricingPage(page);
      await page.waitForTimeout(600);

      const onB = await readState(page);
      record('sur N4 : SA formule est affichee', onB.pricingCardTitles.includes('JEUDI FOU N4'), onB.pricingCardTitles.join(' | ') || 'aucune carte');
      record(
        'AUCUNE formule de Fun Galaxy ne survit a la bascule',
        !onB.pricingCardTitles.includes('FORMULE 1'),
        onB.pricingCardTitles.join(' | ') || 'aucune carte',
      );
      record(
        'AUCUNE section Laser Game chez un centre sans arene',
        !onB.pricingSectionTitles.includes('Laser Game'),
        onB.pricingSectionTitles.join(' | ') || 'aucune section',
      );
      record(
        'AUCUNE offre de la grille par piste chez un centre qui vend aux parties',
        !onB.pricingCardTitles.some((title) => /^Bowling (30 min|1 heure|1h30|2 heures)$/.test(title)),
        onB.pricingCardTitles.join(' | ') || 'aucune carte',
      );
      record(
        'son bowling est annonce EN PARTIES, son vrai mode de vente',
        onB.pricingCardTitles.some((title) => /partie/i.test(title) && !/laser/i.test(title)),
        onB.pricingCardTitles.join(' | ') || 'aucune carte',
      );

      // Retour sur Fun Galaxy : ce qui est a lui revient INTACT. C'est la
      // moitie que Movsar a vue casser (« remets pour Fun Galaxy toutes les
      // formules de Fun Galaxy »).
      await openCenterMenu(page);
      await page.click(`[data-fgx-center-option="${CENTER_A.id}"]`);
      await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_A.id, { timeout: 10000 });
      await openPricingPage(page);
      await page.waitForTimeout(600);

      const backOnA = await readState(page);
      record('retour Fun Galaxy : SA formule est revenue', backOnA.pricingCardTitles.includes('FORMULE 1'), backOnA.pricingCardTitles.join(' | ') || 'aucune carte');
      record('retour Fun Galaxy : sa section Laser Game est revenue', backOnA.pricingSectionTitles.includes('Laser Game'), backOnA.pricingSectionTitles.join(' | ') || 'aucune section');
      record('retour Fun Galaxy : sa grille bowling par piste est revenue', backOnA.pricingCardTitles.some((title) => /^Bowling /.test(title)), backOnA.pricingCardTitles.join(' | ') || 'aucune carte');
      record('retour Fun Galaxy : aucune formule de N4 ne traine', !backOnA.pricingCardTitles.includes('JEUDI FOU N4'), backOnA.pricingCardTitles.join(' | ') || 'aucune carte');
      await context.close();
    }

    // ===================================================================== [G]
    // LES DEUX CONTRE-PREUVES DE [F]. Un gate qui ne sait pas rougir ne prouve
    // rien : on neutralise chaque ligne de production tour a tour et on exige
    // que la mesure redevienne EXACTEMENT celle des captures de Movsar.
    section('[G] Contre-preuves de [F] : chaque correctif retire ramene son bug');
    {
      const APP = path.join(ROOT, 'assets', 'app-main.js');
      const appOriginal = fs.readFileSync(APP, 'utf8');
      try {
        // Mutation 1 : la purge du catalogue tarifaire ne part plus.
        const purgeCall = "if (typeof window !== 'undefined' && typeof window.pevResetCatalogCache === 'function') window.pevResetCatalogCache();";
        if (appOriginal.split(purgeCall).length - 1 !== 1) throw new Error('ancre de mutation (purge catalogue) introuvable ou ambigue');
        fs.writeFileSync(APP, appOriginal.replace(purgeCall, "if (false) { /* mutation gate */ }"));
        {
          const context = await browser.newContext();
          const page = await context.newPage();
          await installMock(page, { withSession: true });
          await page.goto(`${BASE_URL}/?v=switch-g1-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
          await bootStaff(page);
          await openPricingPage(page);
          await openCenterMenu(page);
          await page.click(`[data-fgx-center-option="${CENTER_B.id}"]`);
          await page.waitForFunction((id) => typeof state !== 'undefined' && state.adminCenterId === id, CENTER_B.id, { timeout: 10000 });
          await openPricingPage(page);
          await page.waitForTimeout(800);
          const broken = await readState(page);
          record(
            'sans la purge : la formule de Fun Galaxy revient chez N4, ce gate ROUGIRAIT',
            broken.pricingCardTitles.includes('FORMULE 1'),
            broken.pricingCardTitles.join(' | ') || 'aucune carte',
          );
          await context.close();
        }

        // Mutation 2 : le filtre de ressource ne garde plus rien.
        const laserGuard = 'const laser = !sellsLaser ? [] :';
        if (appOriginal.split(laserGuard).length - 1 !== 1) throw new Error('ancre de mutation (filtre laser) introuvable ou ambigue');
        fs.writeFileSync(APP, appOriginal.replace(laserGuard, 'const laser = false ? [] :'));
        {
          const context = await browser.newContext();
          const page = await context.newPage();
          await installMock(page, { withSession: true });
          await page.addInitScript((B) => {
            try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ adminCenterId: B, view: 'client' })); } catch (e) {}
          }, CENTER_B.id);
          await page.goto(`${BASE_URL}/?v=switch-g2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
          await bootStaff(page);
          await openPricingPage(page);
          await page.waitForTimeout(800);
          const broken = await readState(page);
          record(
            'sans le filtre de ressource : le Laser Game revient chez un centre sans arene, ce gate ROUGIRAIT',
            broken.pricingSectionTitles.includes('Laser Game'),
            broken.pricingSectionTitles.join(' | ') || 'aucune section',
          );
          await context.close();
        }
      } finally {
        fs.writeFileSync(APP, appOriginal); // ECRITURE INVERSE exacte
      }
      record(
        'app-main.js est restaure a l identique',
        fs.readFileSync(APP, 'utf8') === appOriginal,
      );
    }

  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  } finally {
    await browser.close();
    server.close();
  }

  const red = checks.filter(c => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();
