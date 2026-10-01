// CE QUE VOIT UN MANAGER (2026-08-19). Movsar : « la jdois donner code d acces
// pour un manager et regarde deja je test ici et regarde ça bug ».
// Le role Manager (staff_roles.manager, NON verrouille, 16 permissions reelles
// lues en base) ouvre des pages dont certains blocs appelaient des API
// reservees a la Direction : le calendrier des reservations affichait « API
// indisponible » et ne comptait que les jours deja visites, et le bloc
// Campagnes empilait « Permission insuffisante » sur une liste vide.
// Ce gate monte une session Manager AVEC SES VRAIES PERMISSIONS, ouvre chaque
// page qui lui est autorisee, et exige : aucun refus de permission a l ecran,
// aucun 403 reseau, et le calendrier peuple SANS avoir clique un seul jour.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_MANAGER_PORT || 4217);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// LES 16 PERMISSIONS REELLES du role manager de Libramont, relevees en base le
// 2026-08-19. Les recopier ici plutot que les deviner : un gate qui invente un
// role prouve le comportement d un role qui n existe pas.
const MANAGER_PERMISSIONS = [
  'clients.edit', 'clients.view', 'dashboard.view', 'emails.view',
  'payments.markPaid', 'payments.view', 'planning.bowling', 'planning.drag',
  'planning.laser', 'planning.view', 'reservations.cancel', 'reservations.create',
  'reservations.edit', 'reservations.quick', 'reservations.status', 'reservations.view',
];
// Ce que le Manager n a PAS, et qui commandait les blocs casses.
const MANAGER_DENIED = ['direction.view', 'campaigns.manage', 'emails.send', 'marketing.agents', 'settings.manage', 'users.manage'];

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

async function installMock(page, perms, denied) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, perms, denied }) => {
    // Session MANAGER : role NON verrouille (locked: false). C'est le coeur du
    // test : un role verrouille recevrait tout par raccourci et ne prouverait
    // rien.
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'mgr', name: 'Manager partage', roleId: 'manager' }, role: { id: 'manager', name: 'Manager', locked: false }, permissions: perms };
    const dstr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
    // Des reservations REPARTIES sur le mois : c'est ce qui permet de dire si
    // le calendrier est peuple d'un coup ou seulement jour par jour.
    const R = [];
    let id = 9000;
    const add = (o) => R.push({ id: id++, lanes: [1], status: 'confirmed', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, type: 'bowling', label: 'Bowling', ...o });
    [-6, -4, -2, 0, 2, 5, 8].forEach((offset, index) => {
      add({ name: 'Client ' + (index + 1), phone: '+3247000000' + index, email: 'c' + index + '@test.be', date: dstr(offset), startTime: '14:00', pax: 4 + index, price: 39 + index });
    });
    const lanes = () => Array.from({ length: 8 }).reduce((acc, _, i) => { acc[i + 1] = 'active'; return acc; }, {});
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'qa-' + Date.now() } });
    // Le mock REJOUE la regle serveur : toute API dont la permission n'est pas
    // dans la session repond 403, exactement comme requireStaffPermission. Un
    // mock permissif prouverait un produit qui n'existe pas.
    const deny = () => new Response(JSON.stringify({ ok: false, error: 'Permission insuffisante.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const has = (p) => perms.includes(p);
    window.__QA_403__ = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      const note403 = (label) => { window.__QA_403__.push(label); return deny(); };
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'manager', selectedMemberId: 'mgr', roles: [{ id: 'manager', name: 'Manager', code: 'MG', tone: 'ops', accessCode: 'X', updatedAt: new Date().toISOString(), locked: false, permissions: perms }], members: [{ id: 'mgr', name: 'Manager partage', contact: 'm@x', roleId: 'manager', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') {
        if (!has('planning.view') && !has('dashboard.view') && !has('reservations.view')) return note403('staff-state');
        return J({ ok: true, revision: 'qa', reservations: R, laneStatuses: lanes(), centerId: 'libramont' });
      }
      if (u.pathname === '/api/admin-range') {
        // La regle CORRIGEE : direction.view OU reservations.view.
        if (!has('direction.view') && !has('reservations.view') && !has('clients.view')) return note403('admin-range');
        return J({ ok: true, reservations: R, laneStatuses: lanes(), centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString(), opsHealth: has('direction.view') ? { ok: true } : null });
      }
      if (u.pathname === '/api/simulation') {
        // Regle serveur reelle : platform.admin, que meme la Direction n a pas.
        if (!has('platform.admin')) return note403('simulation');
        return J({ ok: true, status: 'idle' });
      }
      if (u.pathname === '/api/ops' && String(init.method || 'GET').toUpperCase() === 'POST') return J({ ok: true });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action') || '';
        if (['listCampaigns', 'campaignAudience'].includes(action) && !has('campaigns.manage')) return note403('ops?action=' + action);
        if (action === 'customRequests') return J({ ok: true, customRequests: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
    window.__QA_DENIED__ = denied;
  }, { expiresAt, perms, denied });
}

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

// Un refus de permission VU A L ECRAN. On cherche les mots que le serveur
// renvoie, pas une classe CSS : c'est ce que le manager lit.
async function screenComplaints(page) {
  return page.evaluate(() => {
    const text = (document.querySelector('.staff-wrap') || document.body).innerText || '';
    const hits = [];
    if (/Permission insuffisante/i.test(text)) hits.push('Permission insuffisante');
    if (/API indisponible/i.test(text)) hits.push('API indisponible');
    if (/Acces centre insuffisant|Accès centre insuffisant/i.test(text)) hits.push('Acces centre insuffisant');
    if (/Accès non autorisé/i.test(text)) hits.push('Acces non autorise');
    return hits;
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  const missing = new Set();
  page.on('response', (r) => { if (r.status() === 404) missing.add(new URL(r.url()).pathname); });
  page.on('requestfailed', (r) => missing.add('FAILED ' + new URL(r.url()).pathname));
  page.on('pageerror', (error) => errs.push('PAGEERROR: ' + error.message));
  try {
    await installMock(page, MANAGER_PERMISSIONS, MANAGER_DENIED);
    await page.goto(BASE_URL + '/?v=manager-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1600);

    console.log('\n[La session est bien celle d un MANAGER, pas d une Direction]');
    const identity = await page.evaluate(() => ({
      locked: !!(window.canUseStaffPermission && window.canUseStaffPermission('settings.manage')),
      mayReservations: !!(window.canUseStaffPermission && window.canUseStaffPermission('reservations.view')),
      mayCampaigns: !!(window.canUseStaffPermission && window.canUseStaffPermission('campaigns.manage')),
      mayDirection: !!(window.canUseStaffPermission && window.canUseStaffPermission('direction.view')),
    }));
    ok(identity.mayReservations, 'il peut voir les reservations (permission reelle du role)');
    ok(!identity.mayCampaigns, 'il ne peut PAS gerer les campagnes (permission absente du role)');
    ok(!identity.mayDirection, 'il n a PAS la vue direction');
    ok(!identity.locked, 'son role n est pas verrouille (sinon le test ne prouverait rien)');

    console.log('\n[Page RESERVATIONS : le calendrier se remplit SANS cliquer un jour]');
    await page.evaluate(() => window.openStaffMenuPage('reservations'));
    await page.waitForTimeout(2200);
    const resa = await page.evaluate(() => {
      const text = (document.querySelector('.staff-wrap') || document.body).innerText || '';
      // Les cases du mois qui portent un compte reel (« N réservations » depuis
      // le lot D du 02/10, « N résa » avant) : lues par la case elle-meme, le
      // panneau du jour dit aussi « N réservations ».
      const filled = [...document.querySelectorAll('.pv2-cal-cell .pv2-cal-meta')].filter((m) => /\d+\s*réservation/.test(m.textContent)).length;
      return { filled, apiDown: /API indisponible/i.test(text), waiting: /En attente du serveur/i.test(text) };
    });
    ok(!resa.apiDown, 'aucun bandeau « API indisponible »');
    ok(resa.filled > 0, 'le calendrier porte des comptes reels sans aucun clic (' + resa.filled + ' cases)');

    console.log('\n[Page EMAILS : le bloc Campagnes ne crie plus a la permission]');
    await page.evaluate(() => window.openStaffMenuPage('emails'));
    await page.waitForTimeout(2200);
    const emails = await page.evaluate(() => {
      const text = (document.querySelector('.staff-wrap') || document.body).innerText || '';
      return {
        permissionShown: /Permission insuffisante/i.test(text),
        campaignsBlock: /Campagnes email/i.test(text),
        stacked: /Permission insuffisante/i.test(text) && /Aucune campagne/i.test(text),
      };
    });
    ok(!emails.permissionShown, 'aucun « Permission insuffisante » a l ecran');
    ok(!emails.campaignsBlock, 'le bloc Campagnes est absent pour ce role (il ne peut pas le charger)');
    ok(!emails.stacked, 'plus d empilement erreur + liste vide');

    console.log('\n[Toutes les pages autorisees : rien ne crie]');
    const pages = ['dashboard', 'planning', 'reservations', 'clients', 'requests', 'emails'];
    for (const target of pages) {
      await page.evaluate((slug) => window.openStaffMenuPage(slug), target);
      await page.waitForTimeout(1400);
      const hits = await screenComplaints(page);
      ok(hits.length === 0, 'page ' + target + ' : aucun refus a l ecran' + (hits.length ? ' (' + hits.join(', ') + ')' : ''));
    }

    const denied403 = await page.evaluate(() => window.__QA_403__ || []);
    ok(denied403.length === 0, 'aucun appel API refuse pendant tout le parcours' + (denied403.length ? ' (' + [...new Set(denied403)].join(', ') + ')' : ''));

    console.log('\n[Contre-epreuve : le gate sait-il rougir ?]');
    // On retire reservations.view de la session cote client : la page
    // Reservations doit redevenir muette, et la sonde doit le voir.
    // Ce qui doit savoir rougir ici, c est le DETECTEUR d ecran : on injecte
    // le refus exact que le manager voyait, et la sonde doit le voir. (Muter la
    // session ne prouverait rien : elle vit en memoire, hors de portee, piege
    // deja paye ce jour-la sur un autre gate.)
    const detector = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'qa-fake-denial';
      probe.textContent = 'Permission insuffisante.';
      (document.querySelector('.staff-wrap') || document.body).appendChild(probe);
      return true;
    });
    const seen = await screenComplaints(page);
    ok(detector && seen.includes('Permission insuffisante'),
      'refus injecte expres : la sonde le VOIT -> le gate ROUGIRAIT (' + seen.join(', ') + ')');
    await page.evaluate(() => { const el = document.getElementById('qa-fake-denial'); if (el) el.remove(); });
    const cleaned = await screenComplaints(page);
    ok(cleaned.length === 0, 'restauration inverse : l ecran est de nouveau muet');

    console.log('\n' + '[404 rencontres : ' + missing.size + ' chemin(s) distinct(s)]');
    [...missing].slice(0, 12).forEach((m) => console.log('    - ' + m));
    ok(errs.length === 0, 'zero erreur console (' + errs.length + (errs.length ? ' : ' + errs[0] : '') + ')');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\nmanager-view-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('\nmanager-view-check: ALL OK - un Manager travaille sans se heurter a un refus.');
}

main().catch((error) => { console.error(error); process.exit(1); });
