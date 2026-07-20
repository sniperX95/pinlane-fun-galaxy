// Rendu VISUEL du cockpit fondateur : serveur statique + session platform.admin
// mockee + bundle founderCockpit plausible, captures desktop/mobile.
// Complement de scripts/founder-cockpit-check.js (qui prouve le CLOISONNEMENT
// cote serveur) : ici on REGARDE la page, on ne devine pas son rendu.
// Echoue si la page produit une erreur console fatale.
// Lancement : node scripts/founder-cockpit-shots.js [dossier-captures]

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FCK_PORT || 4241);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.argv[2] || path.join(ROOT, '.captures-founder');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

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

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'direction.view', 'centers.switch', 'settings.manage', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'users.manage', 'platform.admin'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'libramont:platform-owner', name: 'Movsar' }, role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true }, permissions: perms };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const now = new Date().toISOString();
    const hier = new Date(Date.now() - 26 * 3600 * 1000).toISOString();

    // Bundle plausible : quelques pannes, de l'adoption inegale, un agent
    // silencieux - le rendu doit etre juge sur des donnees VIVANTES, pas vides.
    const bundle = {
      ok: true, generatedAt: now, testData: true,
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active' },
        { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned' },
      ],
      journalSince: hier,
      breakage: {
        mails: { window: '30 derniers jours', failed: 2, groups: [{ lastError: 'You can only send testing emails...', count: 2 }], recent: [
          { id: 501, centerId: 'libramont', recipient: 'client@test.be', subject: 'Rappel de votre venue', lastError: 'sandbox', attempts: 2, createdAt: hier },
          { id: 502, centerId: 'gembloux', recipient: 'aut re@test.be', subject: 'Confirmation', lastError: 'sandbox', attempts: 1, createdAt: now },
        ] },
        jobs: { window: 'etat actuel', failed: 1, recent: [{ id: 88, centerId: 'libramont', jobType: 'reservation_followup', lastError: 'timeout enqueue', attempts: 3, maxAttempts: 20, updatedAt: hier }] },
        worker: { window: '24 dernieres heures pour les echecs', lastRun: { taskName: 'ops-jobs', status: 'ok', startedAt: now, finishedAt: now, error: '' }, failed24h: 0, tasks: [] },
        denied: { window: '7 derniers jours', count: 1, recent: [{ id: 3, centerId: 'libramont', occurredAt: hier, actorKind: 'staff', actorLabel: 'Directrice Demo', surface: 'api/ops.js', deniedReason: 'Permission insuffisante.', requestedCenter: '' }] },
        audit: { failures: 0 },
      },
      adoption: { window: '7 et 30 derniers jours', excludesPlatformOwner: true,
        perCenter: [
          { centerId: 'libramont', lastStaffAction: hier, actions7d: 14, actions30d: 61, lastLogin: hier, activeSessions: 1 },
          { centerId: 'gembloux', lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 },
        ],
        actions30d: [
          { centerId: 'libramont', action: 'updateReservation', count: 22 },
          { centerId: 'libramont', action: 'automationSettings', count: 9 },
          { centerId: 'libramont', action: 'sendClientRelance', count: 6 },
        ] },
      agents: {
        suggestions: { total: 12, pending: 2, lastAt: hier, window: 'depuis le debut' },
        insights: { byStatus: [{ status: 'pending', count: 3, lastAt: hier }], perCenter: [
          { centerId: 'libramont', lastAt: hier, count30d: 5 },
          { centerId: 'gembloux', lastAt: null, count30d: 0 },
        ] },
        plans: [{ centerId: 'libramont', status: 'proposed', fromDate: '2026-07-20', toDate: '2026-09-14', mode: 'deterministe', createdAt: hier }],
        decisions: { d7: 4, lastAt: hier, window: '7 derniers jours' },
      },
      cost: { budgetUsd: 5, month: '2026-07', monthMeasured: true, spentUsd: 4.0023, calls: 645, updatedAt: now, projectionUsd: 5.9, dailyMeasured: false,
        months: [{ month: '2026-07', costUsd: 4.0023, calls: 645 }, { month: '2026-06', costUsd: 2.1, calls: 300 }] },
      leads: { window: 'depuis le debut', total: 2, byStatus: { new: 2 }, lastAt: hier, recent: [
        { centerName: 'Bowling du Lac', priority: 'haute', status: 'new', createdAt: hier },
        { centerName: 'LaserZone Namur', priority: '', status: 'new', createdAt: hier },
      ] },
      sequences: { keys: [
        { key: 'confirmation', label: 'Confirmation' }, { key: 'reminder_48h', label: 'Rappel avant la venue' },
        { key: 'post_visit', label: 'Merci post-visite' },
      ], perCenter: {
        libramont: { confirmation: { enabled: true }, reminder_48h: { enabled: true }, post_visit: { enabled: true } },
        gembloux: { confirmation: { enabled: true }, reminder_48h: { enabled: false }, post_visit: { enabled: false } },
        ciney: { confirmation: { enabled: false }, reminder_48h: { enabled: false }, post_visit: { enabled: false } },
      } },
      audit: { entries: [
        { id: 1, occurredAt: now, centerId: 'libramont', actorKind: 'staff', actorLabel: 'Directrice Demo', actorMemberId: 'libramont:demo', action: 'automationSettings', outcome: 'success', surface: 'api/ops.js' },
        { id: 2, occurredAt: hier, centerId: 'libramont', actorKind: 'staff', actorLabel: 'Directrice Demo', actorMemberId: 'libramont:demo', action: 'founderCockpit', outcome: 'denied', surface: 'api/ops.js' },
        { id: 3, occurredAt: hier, centerId: 'gembloux', actorKind: 'worker', actorLabel: 'Worker Railway', actorMemberId: null, action: 'dispatch-communications', outcome: 'success', surface: 'lib/cron-tasks.js' },
      ] },
    };

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderCockpit') return J(bundle);
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'founderAuditLog') return J({ ok: true, entries: bundle.audit.entries });
      if (u.pathname === '/api/ops') return J({ ok: true });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    // La cle REELLE de la session persistee est funGalaxy_auth_v1 (voir
    // scripts/emails-page-check.js:149) : une cle inventee laisse la page
    // vide, canUseStaffPage('cockpit') ne trouvant aucune session.
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) {}
  }, { expiresAt });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=fck-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'cockpit';
      state.staffTheme = 'dark';
      save();
      setView('staff');
      renderStaff();
    });
    await page.waitForFunction(() => document.querySelectorAll('#staffCockpitPage .pv2-panel').length >= 3, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    // Garde-fous issus des defauts corriges le 2026-07-21 — verifications
    // COMPORTEMENTALES (hauteur reelle, couleur calculee, classe posee),
    // pas des presences de chaines :
    // 1. la barre de titre ne doit pas s'effondrer (body.staff-mode header
    //    ecrase tout <header> a hauteur 0 -> le cockpit emet des div/section) ;
    // 2. les titres de panneaux doivent avoir une hauteur ;
    // 3. un interrupteur actif est BLANC (couleur du texte), jamais vert :
    //    le vert reste reserve aux statuts ;
    // 4. le planning staff ne doit pas fuir sous la page cockpit.
    const etat = await page.evaluate(() => {
      const bar = document.querySelector('#staffCockpitPage .pv2-bar');
      const h1 = bar ? bar.querySelector('h1') : null;
      const h2 = document.querySelector('#staffCockpitPage .pv2-panel-head h2');
      const sw = document.querySelector('#staffCockpitPage .mk-switch.is-on');
      const pb = document.getElementById('planningBox');
      return {
        barreTitreVisible: Boolean(bar) && bar.offsetHeight > 0,
        titresPanneauxVisibles: Boolean(h2) && h2.offsetHeight > 0,
        switchActifBlanc: Boolean(sw) && Boolean(h1) && getComputedStyle(sw).backgroundColor === getComputedStyle(h1).color,
        planningCache: !pb || pb.classList.contains('hidden'),
      };
    });
    const rates = Object.entries(etat).filter(([, ok]) => !ok).map(([nom]) => nom);
    if (rates.length) {
      console.error('RENDU CASSE:', rates.join(', '));
      process.exit(1);
    }
    await page.screenshot({ path: path.join(OUT, 'founder-dark-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'founder-dark-mobile.png'), fullPage: true });
    const fatal = errs.filter((e) => !/localStorage|sandboxed|favicon|cdn\.vercel-insights/i.test(e));
    if (fatal.length) {
      console.error('ERREURS PAGE:', fatal.slice(0, 5));
      process.exit(1);
    }
    console.log(`captures ecrites dans ${OUT}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error('founder-cockpit-shots: exception', error.message); process.exit(1); });
