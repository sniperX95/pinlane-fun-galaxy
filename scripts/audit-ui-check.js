// Test INTERACTIF de la surface de lecture du journal d'audit (page Emails).
//
// Playwright pilote de VRAIS clics. Une assertion qui verifierait la PRESENCE
// d'une fonction dans le fichier source serait un faux vert : ce depot en a
// deja connu sept. On ouvre donc le panneau pour de vrai, on lit le DOM rendu,
// et on verifie un COMPORTEMENT.
//
// Ce qui est prouve ici :
//   1. le panneau s'ouvre au clic et declenche un appel reseau scope au centre ;
//   2. les lignes rendues affichent l'acteur, l'action et le resultat ;
//   3. un refus est visuellement distingue (c'est le signal securite) ;
//   4. le detail avant/apres s'ouvre au clic et montre les DEUX valeurs ;
//   5. XSS : un nom d'acteur hostile est ECHAPPE, pas execute ;
//   6. la page n'envoie jamais un centre different de celui de la session.
//
// Lancement : node scripts/audit-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_AUDIT_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// Le nom d'acteur hostile est injecte tel qu'il arriverait de la base : c'est
// exactement le scenario ou un membre du staff se serait nomme avec du markup.
const XSS_NAME = '<img src=x onerror="window.__XSS_AUDIT__=1">Pirate';

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, XSS_NAME }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });

    window.__AUDIT_CALLS__ = [];
    const auditEntries = [
      {
        id: 3, centerId: 'libramont', occurredAt: new Date(Date.now() - 600e3).toISOString(),
        actorKind: 'staff', actorMemberId: 'm-42', actorLabel: 'Sophie Direction', actorRoleId: 'direction',
        surface: 'api/ops.js', action: 'saveCenterConfig', method: 'POST',
        entityType: 'center', entityId: 'libramont', outcome: 'success', deniedReason: '',
        changes: { price: { before: 20, after: 25 } }, context: {}, requestId: 'r-1',
      },
      {
        id: 2, centerId: 'libramont', occurredAt: new Date(Date.now() - 1200e3).toISOString(),
        actorKind: 'staff', actorMemberId: 'm-9', actorLabel: XSS_NAME, actorRoleId: 'staff-bar',
        surface: '/api/ops', action: 'accessDenied', method: 'POST',
        entityType: 'permission', entityId: 'settings.manage', outcome: 'denied',
        deniedReason: '403_center_scope',
        changes: {}, context: { centreDemande: 'gembloux' }, requestId: 'r-2',
      },
      {
        id: 1, centerId: 'libramont', occurredAt: new Date(Date.now() - 3600e3).toISOString(),
        actorKind: 'cron', actorMemberId: '', actorLabel: 'Cron Vercel', actorRoleId: '',
        surface: 'lib/cron-tasks.js', action: 'dispatch-communications', method: 'JOB',
        entityType: 'cron_task', entityId: 'dispatch-communications', outcome: 'success',
        deniedReason: '', changes: {}, context: { traites: 12 }, requestId: 'r-3',
      },
    ];

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'auditLog') {
        window.__AUDIT_CALLS__.push(u.search);
        const outcome = u.searchParams.get('outcome') || '';
        const kind = u.searchParams.get('actorKind') || '';
        let rows = auditEntries.slice();
        if (outcome) rows = rows.filter((r) => r.outcome === outcome);
        if (kind) rows = rows.filter((r) => r.actorKind === kind);
        return J({ ok: true, centerId: 'libramont', entries: rows, audit: { written: 3, failed: 0 } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'automationSettings') {
        return J({ ok: true, settings: {}, defaults: {}, stats: {} });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customSequences') {
        return J({ ok: true, sequences: [], limits: { maxSequences: 10, cap: [1, 100], triggers: {}, segments: {} } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'suppressions') {
        return J({ ok: true, entries: [], total: 0 });
      }
      if (u.pathname === '/api/ops' && m === 'GET') {
        return J({ ok: true, entries: [], events: [], communications: [], samples: [], suggestions: [], health: {}, templates: [], identities: [] });
      }
      if (u.pathname === '/api/ops' && m === 'POST') return J({ ok: true });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      if (u.pathname === '/api/public-booking-meta') {
        return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      }
      return nf(input, init);
    };
    // C'est CE seed qui authentifie la console cote client : sans lui la page
    // Emails ne se rend jamais et toute assertion sur son DOM serait un faux.
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, XSS_NAME });
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
    await page.goto(`${BASE_URL}/?v=au-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'emails';
      state.staffAuditOpen = false;
      save(); setView('staff'); renderStaff();
    });
    // On attend que la page Emails soit REELLEMENT rendue. Sans cette attente,
    // une assertion sur le DOM testerait une page vide et rendrait un faux
    // rouge (ou pire, un faux vert sur une negation).
    await page.waitForFunction(
      () => (document.getElementById('staffEmailsPage')?.innerHTML.length || 0) > 500,
      null,
      { timeout: 15000 },
    );
    await page.waitForTimeout(500);

    console.log('[1] le panneau existe et part FERME');
    const panelExists = await page.evaluate(() => Boolean([...document.querySelectorAll('.pv2-panel h2')].find((h) => h.textContent.includes('Journal des modifications'))));
    ok(panelExists, 'le panneau « Journal des modifications » est present sur la page Emails');
    const closedBody = await page.evaluate(() => Boolean(document.querySelector('[data-pv2-mount="audit"]')));
    ok(!closedBody, 'il est replie au depart (il ne charge rien tant qu on ne le demande pas)');
    const callsBefore = await page.evaluate(() => window.__AUDIT_CALLS__.length);
    ok(callsBefore === 0, `aucun appel reseau avant ouverture (obtenu ${callsBefore})`);

    console.log('\n[2] ouverture au CLIC (pas par appel de fonction)');
    await page.evaluate(() => {
      const head = [...document.querySelectorAll('.pv2-panel')].find((p) => p.textContent.includes('Journal des modifications'));
      head.querySelector('button').click();
    });
    await page.waitForTimeout(700);
    const openBody = await page.evaluate(() => Boolean(document.querySelector('[data-pv2-mount="audit"]')));
    ok(openBody, 'le clic ouvre le corps du panneau');
    const calls = await page.evaluate(() => window.__AUDIT_CALLS__.slice());
    ok(calls.length >= 1, `l ouverture declenche l appel au journal (obtenu ${calls.length})`);
    ok(calls.every((c) => c.includes('centerId=libramont')),
      'chaque appel porte le centre de la session, jamais un autre');
    ok(!calls.some((c) => /centerId=(?!libramont)/.test(c)),
      'aucun appel ne demande un centre different de celui de la session');

    console.log('\n[3] les lignes affichent qui, quoi, resultat');
    const table = await page.evaluate(() => {
      const body = document.querySelector('[data-pv2-mount="audit"]');
      return body ? body.innerText : '';
    });
    ok(table.includes('Sophie Direction'), 'l acteur humain est affiche');
    ok(table.includes('saveCenterConfig'), 'l action est affichee');
    ok(table.includes('Cron Vercel'), 'l acteur automatique est affiche et nomme');
    ok(table.includes('Refuse'), 'un refus est affiche comme tel');
    ok(table.includes('Autre centre'), 'le motif du refus est traduit en francais lisible');

    console.log('\n[4] le detail avant/apres s ouvre au CLIC');
    const beforeDetail = await page.evaluate(() => document.querySelector('[data-pv2-mount="audit"]').innerText.includes('Avant'));
    ok(!beforeDetail, 'le detail est replie au depart');
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-pv2-mount="audit"] tbody tr')];
      const target = rows.find((r) => r.textContent.includes('saveCenterConfig'));
      target.querySelector('button').click();
    });
    await page.waitForTimeout(500);
    const detail = await page.evaluate(() => document.querySelector('[data-pv2-mount="audit"]').innerText);
    ok(detail.includes('Avant') && detail.includes('Apres'), 'le detail montre les colonnes Avant et Apres');
    ok(/\b20\b/.test(detail) && /\b25\b/.test(detail),
      'les DEUX valeurs du changement de prix sont lisibles (20 puis 25), pas seulement la nouvelle');

    console.log('\n[5] XSS : le nom hostile est echappe, pas execute');
    const xssFired = await page.evaluate(() => Boolean(window.__XSS_AUDIT__));
    ok(!xssFired, 'aucun script injecte via le nom d acteur ne s est execute');
    const hasRawImg = await page.evaluate(() => Boolean(document.querySelector('[data-pv2-mount="audit"] img[onerror]')));
    ok(!hasRawImg, 'aucune balise img hostile n a ete construite dans le DOM');
    ok(detail.includes('Pirate'), 'le nom reste LISIBLE une fois echappe (on echappe, on ne supprime pas)');

    console.log('\n[6] le filtre « Refuse » refait un appel scope');
    const callsBeforeFilter = await page.evaluate(() => window.__AUDIT_CALLS__.length);
    await page.selectOption('#pv2AuditOutcome', 'denied');
    await page.waitForTimeout(700);
    const callsAfter = await page.evaluate(() => window.__AUDIT_CALLS__.slice());
    ok(callsAfter.length > callsBeforeFilter, 'changer le filtre declenche un nouvel appel');
    ok(callsAfter[callsAfter.length - 1].includes('outcome=denied'), 'le filtre voyage bien dans la requete');
    ok(callsAfter[callsAfter.length - 1].includes('centerId=libramont'),
      'le scope centre est TOUJOURS present, meme avec un filtre actif');
    const filtered = await page.evaluate(() => document.querySelector('[data-pv2-mount="audit"]').innerText);
    ok(!filtered.includes('saveCenterConfig'), 'la liste filtree ne montre plus les succes');
    ok(filtered.includes('accessDenied'), 'elle montre le refus');

    const fatal = errs.filter((e) => !/localStorage|sandboxed/i.test(e));
    ok(fatal.length === 0, `aucune erreur console fatale (obtenu ${fatal.length}${fatal.length ? ' : ' + fatal[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\naudit-ui-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\naudit-ui-check: ALL OK');
}

main().catch((error) => {
  console.error('audit-ui-check: exception', error);
  process.exit(1);
});
