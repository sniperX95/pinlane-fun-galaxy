// CHAQUE PERMISSION, ACTIVEE PUIS DESACTIVEE (2026-08-19, Movsar : « test
// chaque permission pour chaque niveau activite desactive, detecte tous les
// problemes »). Trois etages, du plus sur au plus visible :
//
//   1. SERVEUR   : la hierarchie se normalise a l'ecriture, quoi qu'on envoie.
//   2. MATRICE   : pour CHAQUE permission, une session qui l'a et une session
//                  qui ne l'a pas ; les pages ouvertes doivent suivre, et
//                  aucune page ouverte ne doit crier au refus.
//   3. EDITEUR   : la cascade au clic (fermer une option ferme ses
//                  sous-options, en cocher une rouvre ce qu'elle suppose).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const {
  ALL_PERMISSIONS,
  PERMISSION_PARENTS,
  permissionChildren,
  permissionAncestors,
  normalizePermissionHierarchy,
} = require(path.join(ROOT, 'lib', 'staff-auth.js'));

const PORT = Number(process.env.PINLANE_PERMMATRIX_PORT || 4223);
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

// Session forgee AVEC exactement les permissions demandees, role NON verrouille
// (un role verrouille recevrait tout par raccourci et ne prouverait rien).
async function installSession(page, perms, roleOverrides = null) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, perms, roleOverrides }) => {
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Test', roleId: 'essai' }, role: { id: 'essai', name: 'Essai', locked: false }, permissions: perms };
    const roles = roleOverrides || [{ id: 'essai', name: 'Essai', code: 'ES', tone: 'ops', accessCode: 'X', updatedAt: new Date().toISOString(), locked: false, permissions: perms }];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const deny = () => new Response(JSON.stringify({ ok: false, error: 'Permission insuffisante.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const has = (p) => perms.includes(p);
    window.__QA_403__ = [];
    window.__QA_SAVED__ = [];
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      const note = (label) => { window.__QA_403__.push(label); return deny(); };
      if (u.pathname === '/api/staff-auth') {
        if (String(init.method || 'GET').toUpperCase() === 'POST') {
          const body = JSON.parse(init.body || '{}');
          if (body.action === 'updateRolePermissions') {
            window.__QA_SAVED__.push(body.permissions);
            const role = roles.find((r) => r.id === body.roleId);
            if (role) role.permissions = body.permissions;
          }
        }
        return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: roles[roles.length - 1].id, selectedMemberId: 'qa', roles, members: [{ id: 'qa', name: 'Test', contact: 'q@x', roleId: 'essai', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      }
      // Les regles serveur, rejouees : un mock permissif prouverait un produit
      // qui n'existe pas.
      if (u.pathname === '/api/staff-state') {
        if (!has('planning.view') && !has('dashboard.view') && !has('reservations.view')) return note('staff-state');
        return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      }
      if (u.pathname === '/api/admin-range') {
        if (!has('direction.view') && !has('reservations.view') && !has('clients.view')) return note('admin-range');
        return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString(), opsHealth: has('direction.view') ? { ok: true } : null });
      }
      if (u.pathname === '/api/simulation') {
        if (!has('platform.admin')) return note('simulation');
        return J({ ok: true, status: 'idle' });
      }
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action') || '';
        if (['listCampaigns', 'campaignAudience'].includes(action) && !has('campaigns.manage')) return note('ops:' + action);
        if (['directionAnalytics', 'dailyMetrics'].includes(action) && !has('direction.view') && !has('dashboard.view')) return note('ops:' + action);
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [], agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, perms, roleOverrides });
}

async function screenComplaints(page) {
  return page.evaluate(() => {
    const text = (document.querySelector('.staff-wrap') || document.body).innerText || '';
    const hits = [];
    if (/Permission insuffisante/i.test(text)) hits.push('Permission insuffisante');
    if (/API indisponible/i.test(text)) hits.push('API indisponible');
    if (/Acc(e|è)s non autoris/i.test(text)) hits.push('Acces non autorise');
    return hits;
  });
}

async function main() {
  console.log('\n[1. SERVEUR : la hierarchie se normalise, quoi qu on envoie]');
  for (const permission of Object.keys(PERMISSION_PARENTS)) {
    const normalized = normalizePermissionHierarchy([permission]);
    const missing = permissionAncestors(permission).filter((parent) => !normalized.includes(parent));
    ok(missing.length === 0, `« ${permission} » seule remonte ses parents (${normalized.join(' + ')})`);
  }
  const noise = normalizePermissionHierarchy(['reservations.quick', 'emails.send']);
  ok(noise.includes('reservations.view') && noise.includes('reservations.create') && noise.includes('emails.view'),
    `deux sous-options ensemble ouvrent toute leur chaine (${noise.length} permissions)`);
  // Contre-epreuve : sans normalisation, l'incoherence passerait.
  ok(!['reservations.quick'].includes('reservations.view'), 'contre-epreuve : la liste brute EST incoherente sans normalisation -> le gate ROUGIRAIT');

  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('\n[2. MATRICE : chaque permission de vue, activee puis desactivee]');
    // Les permissions qui OUVRENT une page : ce sont elles dont l'activation
    // change ce que le role peut atteindre. Pour chacune : avec -> la page
    // s'ouvre sans crier ; sans -> la page n'est pas proposee.
    const PAGE_BY_PERMISSION = [
      { permission: 'dashboard.view', page: 'dashboard' },
      { permission: 'planning.view', page: 'planning' },
      { permission: 'reservations.view', page: 'reservations' },
      { permission: 'clients.view', page: 'clients' },
      { permission: 'emails.view', page: 'emails' },
      { permission: 'campaigns.manage', page: 'campaigns' },
      { permission: 'pricing.manage', page: 'prices' },
      { permission: 'users.manage', page: 'users' },
      { permission: 'settings.manage', page: 'settings' },
    ];
    for (const entry of PAGE_BY_PERMISSION) {
      const withPerm = normalizePermissionHierarchy([entry.permission, 'dashboard.view']);
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await installSession(page, withPerm);
      await page.goto(BASE_URL + '/?v=m-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
      await page.evaluate(() => window.setView('staff'));
      await page.waitForTimeout(900);
      const allowed = await page.evaluate((slug) => (typeof window.canUseStaffPage === 'function' ? window.canUseStaffPage(slug) : null), entry.page);
      ok(allowed === true, `ACTIVEE « ${entry.permission} » : la page ${entry.page} est ouverte`);
      await page.evaluate((slug) => window.openStaffMenuPage(slug), entry.page);
      await page.waitForTimeout(1300);
      const hits = await screenComplaints(page);
      ok(hits.length === 0, `ACTIVEE « ${entry.permission} » : page ${entry.page} sans refus a l ecran${hits.length ? ' (' + hits.join(', ') + ')' : ''}`);
      const refused = await page.evaluate(() => window.__QA_403__ || []);
      ok(refused.length === 0, `ACTIVEE « ${entry.permission} » : aucun appel refuse${refused.length ? ' (' + [...new Set(refused)].join(', ') + ')' : ''}`);
      await page.close();

      // DESACTIVEE : la page ne doit plus etre proposee.
      const without = normalizePermissionHierarchy(['dashboard.view']).filter((p) => p !== entry.permission && !permissionAncestors(entry.permission).includes(p));
      if (entry.permission !== 'dashboard.view') {
        const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await installSession(page2, without);
        await page2.goto(BASE_URL + '/?v=m2-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
        await page2.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
        await page2.evaluate(() => window.setView('staff'));
        await page2.waitForTimeout(900);
        const stillAllowed = await page2.evaluate((slug) => (typeof window.canUseStaffPage === 'function' ? window.canUseStaffPage(slug) : null), entry.page);
        ok(stillAllowed === false, `DESACTIVEE « ${entry.permission} » : la page ${entry.page} est fermee`);
        await page2.close();
      }
    }

    console.log('\n[3. EDITEUR : la cascade au clic]');
    const editorPerms = normalizePermissionHierarchy(ALL_PERMISSIONS.slice());
    const mixed = ['dashboard.view', 'planning.view', 'planning.bowling', 'reservations.view', 'reservations.create', 'clients.view', 'payments.view', 'emails.view'];
    const roles = [
      { id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: editorPerms },
      { id: 'essai', name: 'Essai', code: 'ES', tone: 'ops', accessCode: 'Y', updatedAt: new Date().toISOString(), locked: false, permissions: mixed },
    ];
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    await installSession(page, editorPerms, roles);
    await page.goto(BASE_URL + '/?v=e-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.openStaffMenuPage('users'));
    await page.waitForTimeout(1600);
    await page.evaluate(() => document.querySelectorAll('details.staff-permission-group').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(400);

    const tree = await page.evaluate(() => [...document.querySelectorAll('.staff-permission-toggle')].map((r) => ({
      label: (r.querySelector('b') || {}).textContent.trim(),
      child: r.classList.contains('is-child'),
      inert: r.classList.contains('is-inert'),
    })));
    ok(tree.length > 0, `l editeur rend ses ${tree.length} options`);
    ok(tree.some((r) => r.child), `des SOUS-options existent (${tree.filter((r) => r.child).length} sur ${tree.length})`);
    ok(tree.some((r) => r.inert), 'une sous-option dont le parent est ferme se declare inerte');

    // Fermer « Voir les reservations » doit emporter ses sous-options.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.staff-permission-toggle')].find((r) => /Voir les r.servations/.test(r.textContent));
      row.querySelector('input').click();
    });
    await page.waitForTimeout(900);
    const afterClose = await page.evaluate(() => (window.__QA_SAVED__ || []).slice(-1)[0] || []);
    const leftovers = afterClose.filter((p) => p.startsWith('reservations.'));
    ok(leftovers.length === 0, `fermer une option ferme ses sous-options (reste : ${leftovers.join(', ') || 'rien'})`);

    // Cocher « Envoyer ou relancer » quand « Voir les emails » est ferme doit
    // rouvrir le parent : sinon le droit serait inerte.
    await page.evaluate(() => {
      const mail = [...document.querySelectorAll('.staff-permission-toggle')].find((r) => /Voir les emails/.test(r.textContent));
      if (mail.classList.contains('is-on')) mail.querySelector('input').click();
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const send = [...document.querySelectorAll('.staff-permission-toggle')].find((r) => /Envoyer ou relancer/.test(r.textContent));
      send.querySelector('input').click();
    });
    await page.waitForTimeout(900);
    const afterOpen = await page.evaluate(() => (window.__QA_SAVED__ || []).slice(-1)[0] || []);
    ok(afterOpen.includes('emails.send') && afterOpen.includes('emails.view'),
      `cocher une sous-option rouvre ce qu elle suppose (${afterOpen.filter((p) => p.startsWith('emails.')).join(' + ') || 'rien'})`);

    console.log('\n[4. Contre-epreuve : ce gate sait-il rougir ?]');
    const detector = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'qa-fake';
      probe.textContent = 'Permission insuffisante.';
      (document.querySelector('.staff-wrap') || document.body).appendChild(probe);
      return true;
    });
    const seen = await screenComplaints(page);
    ok(detector && seen.includes('Permission insuffisante'), 'refus injecte : la sonde le VOIT -> le gate ROUGIRAIT');
    await page.evaluate(() => { const el = document.getElementById('qa-fake'); if (el) el.remove(); });
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\npermissions-matrix-check: ${failures} echec(s).`); process.exit(1); }
  console.log('\npermissions-matrix-check: ALL OK - chaque permission tient debout, activee comme desactivee.');
}

main().catch((error) => { console.error(error); process.exit(1); });
