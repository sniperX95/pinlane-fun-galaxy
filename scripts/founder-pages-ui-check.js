// Gate des PAGES PROPRIETAIRE (categorie Plateforme) : rendu reel dans Edge
// headless (playwright-core), /api/ops mocke deterministe, interactions
// PILOTEES (vrais clics / saisies), preuves COMPORTEMENTALES (jamais une simple
// presence de chaine). Le harnais monte les VRAIES fonctions de rendu du front
// (renderPlatformClientsPage, renderStaffFounderCockpitPage,
// renderFounderCentresPage) dans un hote #staffCockpitPage, avec les seuls
// globaux dont elles dependent (apiRequest, escapeHtml, showAlert) stubbes.
//
// CE QUE CE GATE PROUVE :
//   1. Clients Pinlane : le KPI MRR affiche la VRAIE valeur quand
//      clientsWithPrice>0 ; affiche "a definir" (PAS "0 EUR") quand
//      clientsWithPrice===0 (regle d'honnetete) ;
//   2. editer le prix d'un client -> POST setClientBilling { clientId,
//      monthlyPrice } part avec le bon id et la bonne valeur ;
//   3. filtrer par statut reduit la liste affichee ;
//   4. Cockpit : la ligne de KPI business est presente + au moins un graphe
//      PinlaneCharts (svg .plc-svg de hauteur > 0) est monte ; le panneau
//      "Idees en attente" affiche N lignes et Appliquer poste insightStatus
//      avec l'id reel ;
//   5. Incidents : le panneau mails/jobs/worker duplique n'est PLUS present, le
//      bloc erreurs console l'est (dedup) ;
//   6. Centres : le client (clientName) est visible sur les cartes + une ligne
//      de totaux est presente (et le filtre statut reduit la liste).
//
// Contre-preuve par MUTATION (edition inverse exacte, jamais git checkout) :
//   A. neutraliser la regle "a definir" (honest = false) -> le check MRR
//      honnete (mrr-adefinir) ROUGIT ;
//   B. neutraliser l'envoi de clientId dans setClientBilling -> le check
//      edition (billing-clientid) ROUGIT.
// Mutation sans effet = sortie en erreur.
//
// Lancement : node scripts/founder-pages-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FOUNDER_UI_PORT || 4292);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LIB = path.join(ROOT, 'assets', 'founder-clients-platform.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Page de test : tokens theme + moteur graphes + les 3 modules proprietaire.
// Pas de <header> (body.staff-mode header l'ecraserait a hauteur 0). L'hote a
// une largeur fixe pour que grilles et graphes aient une boite reelle.
const PAGE_HTML = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate founder-pages-ui</title>
<link rel="stylesheet" href="/assets/pinlane.css">
<link rel="stylesheet" href="/assets/pinlane-charts.css">
<link rel="stylesheet" href="/assets/pinlane-staff.css">
<style> #staffCockpitPage { width: 960px; margin: 0 auto; } </style>
</head>
<body class="staff-mode">
<main style="padding:32px 24px">
  <div id="staffCockpitPage"></div>
</main>
<script src="/assets/pinlane-charts.js"></script>
<script src="/assets/founder-clients-platform.js"></script>
<script src="/assets/founder-cockpit.js"></script>
<script src="/assets/founder-centres.js"></script>
</body>
</html>`;

// Definitions injectees AVANT chaque navigation (survivent au reload) : stubs
// des globaux du front + mock apiRequest deterministe. window.__writes capture
// chaque POST ; window.__mrrMode bascule le scenario "aucun prix pose".
const INIT_SCRIPT = `
window.__writes = [];
window.__mrrMode = '';
window.showAlert = function () {};
window.escapeHtml = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
window.escapeJsString = function (v) { return String(v == null ? '' : v).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/\\r?\\n/g, ' '); };

window.__bundles = function (action) {
  var now = new Date().toISOString();
  var hier = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  var recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  var vieux = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  var zero = window.__mrrMode === 'zero';
  if (action === 'platformClients') {
    return {
      ok: true, testData: true,
      platform: zero
        ? { mrr: 0, activeClients: 2, activeCenters: 2, revenue30dAll: 180, clientsWithPrice: 0, clientCount: 3, centerCount: 3 }
        : { mrr: 490, activeClients: 2, activeCenters: 2, revenue30dAll: 180, clientsWithPrice: 2, clientCount: 3, centerCount: 3 },
      clients: [
        { id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard', monthlyPrice: zero ? null : 490, revenue30d: 180, centerCount: 2, staffCount: 6,
          centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', staff: 4 }, { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', staff: 2 }] },
        { id: 'bowling-du-lac', name: 'Bowling du Lac', status: 'suspended', plan: 'standard', monthlyPrice: zero ? null : 200, revenue30d: 0, centerCount: 1, staffCount: 0,
          centers: [{ id: 'lac-centre', name: 'Bowling du Lac Centre', status: 'planned', staff: 0 }] },
        { id: 'solo-null', name: 'Client Sans Prix', status: 'active', plan: 'standard', monthlyPrice: null, revenue30d: 0, centerCount: 0, staffCount: 0, centers: [] }
      ],
      orphanCenters: []
    };
  }
  if (action === 'founderCenters') {
    return {
      ok: true, testData: true,
      resourceModel: { statusValues: ['active', 'planned', 'closed'], resources: {}, defaultSchedule: {} },
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', timezone: 'Europe/Brussels', config: { status: 'active', resources: { bowling: { laneCount: 8 } } }, members: 120, reservations30d: 40, revenue30d: 150 },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', config: { status: 'active' }, members: 60, reservations30d: 20, revenue30d: 30 },
        { id: 'lac-centre', name: 'Bowling du Lac Centre', status: 'planned', clientId: 'bowling-du-lac', clientName: 'Bowling du Lac', members: 0, reservations30d: 0, revenue30d: 0 },
        { id: 'orphan-x', name: 'Centre Orphelin', status: 'planned', clientId: null, clientName: null, members: 0, reservations30d: 0, revenue30d: 0 }
      ],
      totals: { members: 180, reservations30d: 60, revenue30d: 180, centerCount: 4 }
    };
  }
  if (action === 'founderAgents') {
    return {
      ok: true, generatedAt: now, testData: true,
      agents: { marketing: { lastAt: hier, count7d: 1, count30d: 3, detail: 'Idee pluie samedi' }, emails: { lastAt: null, count7d: 0, count30d: 0 }, suggestions: { lastAt: hier, count7d: 2, count30d: 12 }, decisions: { lastAt: now, count7d: 4, count30d: 19 } },
      pendingInsights: [
        { id: 101, status: 'pending', kind: 'idea', title: 'Idee pluie samedi', summary: 'Promo les jours de pluie', centerId: 'libramont', proposedAt: hier },
        { id: 102, status: 'pending', kind: 'insight', title: 'Creneau creux mardi', summary: 'Offre mardi apres-midi', centerId: 'gembloux', proposedAt: hier }
      ],
      cost: { budgetUsd: 5, costPerAgentMeasured: false, months: [{ month: '2026-06', costUsd: 2.1, calls: 300 }, { month: '2026-07', costUsd: 4.0, calls: 645 }] }
    };
  }
  if (action === 'founderCockpit') {
    return {
      ok: true, generatedAt: now, testData: true,
      centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active' }],
      breakage: { mails: { failed: 0 }, jobs: { failed: 0 }, worker: {}, denied: { count: 0 }, audit: { failures: 0 } },
      adoption: { window: '7 et 30 derniers jours', perCenter: [], actions30d: [] },
      agents: { suggestions: { total: 0 }, decisions: { d7: 0 }, insights: { perCenter: [] }, plans: [] },
      cost: { budgetUsd: 5, month: '2026-07', monthMeasured: false, months: [] },
      audit: { entries: [] },
      sequences: { keys: [], perCenter: {} },
      leads: { total: 0 }
    };
  }
  if (action === 'founderIncidents') {
    return {
      ok: true, generatedAt: now, testData: true,
      centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }, { id: 'gembloux', name: 'Fun Galaxy Gembloux' }],
      console: { window: '14 derniers jours', groups: [
        { id: '0000000000000000000000000000000000000001', message: 'TypeError lanes', count: 6, lastAt: recent, centers: ['libramont'], pages: ['planning'], stack: 'TypeError lanes at renderPlanning' },
        { id: '0000000000000000000000000000000000000002', message: 'NetworkError /api/ops', count: 2, lastAt: vieux, centers: ['gembloux'], pages: ['emails'], stack: '' }
      ] },
      breakage: { mails: { failed: 2, window: '30 derniers jours', recent: [{ id: 501, centerId: 'libramont', recipient: 'x@y.be', subject: 'Rappel', attempts: 2, createdAt: hier }] }, jobs: { failed: 0 }, worker: {}, denied: { count: 0 } }
    };
  }
  return { ok: true };
};

window.apiRequest = function (url, opts) {
  opts = opts || {};
  if (opts && opts.method === 'POST') {
    var body = {};
    try { body = JSON.parse(opts.body); } catch (e) { body = {}; }
    window.__writes.push(body);
    return Promise.resolve({ ok: true });
  }
  var action = '';
  try { action = new URL(url, window.location.origin).searchParams.get('action') || ''; } catch (e) { action = ''; }
  return Promise.resolve(window.__bundles(action));
};
`;

const MUTATIONS = [
  {
    name: 'regle "a definir" neutralisee (honest force a false)',
    find: 'const honest = withPrice <= 0;',
    replace: 'const honest = false;',
    expect: 'mrr-adefinir',
  },
  {
    name: 'clientId retire du POST setClientBilling',
    find: "{ action: 'setClientBilling', clientId, monthlyPrice }",
    replace: "{ action: 'setClientBilling', monthlyPrice }",
    expect: 'billing-clientid',
  },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__founder-check') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE_HTML);
      return;
    }
    const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function applyEdit(file, find, replace) {
  const src = fs.readFileSync(file, 'utf8');
  const count = src.split(find).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count} occurrence(s)) : ${find}`);
  fs.writeFileSync(file, src.replace(find, replace));
}

// ---- Montage des pages via les VRAIES fonctions de rendu du front ----------
function mountClients(page) {
  return page.evaluate(() => window.renderPlatformClientsPage(document.getElementById('staffCockpitPage')));
}
function mountCentres(page) {
  return page.evaluate(() => window.renderFounderCentresPage(document.getElementById('staffCockpitPage')));
}
function mountCockpit(page, key) {
  return page.evaluate((k) => window.renderStaffFounderCockpitPage(document.getElementById('staffCockpitPage'), k), key);
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE: ${msg.text()}`); });
  await page.addInitScript(INIT_SCRIPT);

  try {
    await page.goto(`${BASE_URL}/__founder-check?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.PinlaneCharts && window.renderPlatformClientsPage && window.renderStaffFounderCockpitPage && window.renderFounderCentresPage, null, { timeout: 10000 });

    // ================== 4. COCKPIT : KPI business + graphe ==================
    await mountCockpit(page, 'cockpit');
    await page.waitForSelector('#staffCockpitPage [data-fck-panel="biz-kpis"] [data-kpi="mrr"]', { timeout: 10000 });
    await page.waitForSelector('#staffCockpitPage [data-fck-panel="biz-chart"] .plc-svg', { timeout: 10000 });
    const cp = await page.evaluate(() => {
      // Le bandeau du cockpit n'est plus un panneau qui contient des colonnes
      // .fck-stat : ce sont les cartes de stat de la console (refonte 2026-07-28).
      const mrr = document.querySelector('[data-fck-panel="biz-kpis"] [data-kpi="mrr"] .pv2-stat-value');
      const svg = document.querySelector('[data-fck-panel="biz-chart"] .plc-svg');
      return {
        kpis: !!document.querySelector('[data-fck-panel="biz-kpis"]'),
        mrrText: mrr ? mrr.textContent.trim() : '',
        svgH: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
        bars: document.querySelectorAll('[data-fck-panel="biz-chart"] .plc-bar').length,
      };
    });
    ok(cp.kpis, 'cockpit-biz-kpis', 'ligne KPI business absente');
    ok(cp.mrrText.includes('490'), 'cockpit-mrr-value', `MRR="${cp.mrrText}"`);
    ok(cp.svgH > 0, 'cockpit-chart-svg', `hauteur svg=${cp.svgH}`);
    ok(cp.bars >= 2, 'cockpit-chart-bars', `barres=${cp.bars}`);

    // ================== 4. COCKPIT (agents) : pendingInsights ===============
    await mountCockpit(page, 'cockpit-agents');
    await page.waitForSelector('#staffCockpitPage [data-fck-panel="agents-insights"]', { timeout: 10000 });
    const rows = await page.$$eval('[data-fck-panel="agents-insights"] tbody tr', (els) => els.length);
    ok(rows === 2, 'insights-rows', `lignes=${rows}`);
    await page.evaluate(() => {
      const panel = document.querySelector('[data-fck-panel="agents-insights"]');
      const btns = panel ? panel.querySelectorAll('button') : [];
      for (let i = 0; i < btns.length; i += 1) { if (btns[i].textContent.trim() === 'Appliquer') { btns[i].click(); break; } }
    });
    await page.waitForFunction(() => window.__writes.some((w) => w.action === 'insightStatus'), null, { timeout: 8000 });
    const iw = await page.evaluate(() => window.__writes.find((w) => w.action === 'insightStatus'));
    ok(iw && iw.id === 101 && iw.status === 'applied', 'insight-post', JSON.stringify(iw));

    // ================== 5. INCIDENTS : dedup ================================
    await mountCockpit(page, 'cockpit-incidents');
    await page.waitForSelector('#staffCockpitPage [data-fck-panel="console"]', { timeout: 10000 });
    const inc = await page.evaluate(() => ({
      console: !!document.querySelector('[data-fck-panel="console"]'),
      breakage: !!document.querySelector('[data-fck-panel="breakage"]'),
      count: document.querySelectorAll('#staffCockpitPage .fck-incident').length,
    }));
    ok(inc.console, 'incidents-console-present', 'bloc erreurs console absent');
    ok(!inc.breakage, 'incidents-breakage-absent', 'le panneau mails/jobs/worker duplique est encore la');
    ok(inc.count === 2, 'incidents-count', `groupes console=${inc.count}`);

    // ================== 6. CENTRES : clientName + totaux + filtre ===========
    await mountCentres(page);
    await page.waitForSelector('#staffCockpitPage [data-fca-panel="totals"]', { timeout: 10000 });
    const ce = await page.evaluate(() => ({
      totals: !!document.querySelector('[data-fca-panel="totals"]'),
      owners: Array.prototype.map.call(document.querySelectorAll('#staffCockpitPage .fca-owner-name'), (e) => e.textContent.trim()),
      cards: document.querySelectorAll('#staffCockpitPage .fck-center-grid .fck-center-card').length,
      filter: !!document.querySelector('#staffCockpitPage [data-fca-panel="filter"]'),
    }));
    ok(ce.totals, 'centres-totals', 'ligne de totaux absente');
    ok(ce.owners.includes('Fun Galaxy'), 'centres-clientname', JSON.stringify(ce.owners));
    ok(ce.owners.includes('sans client'), 'centres-orphan', JSON.stringify(ce.owners));
    ok(ce.filter, 'centres-filter-present', 'barre de filtre absente');
    await page.selectOption('#staffCockpitPage [data-fca-panel="filter"] .fca-status-filter', 'active');
    const cAfter = await page.$$eval('#staffCockpitPage .fck-center-grid .fck-center-card', (e) => e.length);
    ok(cAfter === 2 && cAfter < ce.cards, 'centres-status-filter', `avant=${ce.cards} apres=${cAfter}`);

    // ================== 1-3. CLIENTS PINLANE ================================
    await mountClients(page);
    await page.waitForSelector('#staffCockpitPage [data-fcp-panel="kpis"] [data-kpi="mrr"]', { timeout: 10000 });
    const cl = await page.evaluate(() => {
      const mrr = document.querySelector('[data-fcp-panel="kpis"] [data-kpi="mrr"] .fcp-kpi-num');
      return {
        mrrText: mrr ? mrr.textContent.trim() : '',
        cards: document.querySelectorAll('#staffCockpitPage .fcp-client-card').length,
      };
    });
    ok(cl.mrrText.includes('490') && !/definir/i.test(cl.mrrText), 'clients-mrr-real', `MRR="${cl.mrrText}"`);
    ok(cl.cards === 3, 'clients-cards', `cartes=${cl.cards}`);

    // 2. Edition du prix : POST setClientBilling { clientId, monthlyPrice }
    await page.fill('#staffCockpitPage .fcp-price-input[data-client="fungalaxy"]', '549');
    await page.evaluate(() => {
      const input = document.querySelector('.fcp-price-input[data-client="fungalaxy"]');
      input.closest('.fcp-billing').querySelector('.fcp-price-save').click();
    });
    await page.waitForFunction(() => window.__writes.some((w) => w.action === 'setClientBilling'), null, { timeout: 8000 });
    const bw = await page.evaluate(() => window.__writes.find((w) => w.action === 'setClientBilling'));
    ok(bw && bw.clientId === 'fungalaxy' && bw.monthlyPrice === 549, 'billing-clientid', JSON.stringify(bw));

    // 3. Filtre par statut reduit la liste (suspended -> 1 carte sur 3)
    await page.waitForSelector('#staffCockpitPage .fcp-status-filter', { timeout: 8000 });
    await page.selectOption('#staffCockpitPage .fcp-status-filter', 'suspended');
    const filtered = await page.$$eval('#staffCockpitPage .fcp-client-card', (e) => e.length);
    ok(filtered === 1 && filtered < cl.cards, 'clients-status-filter', `avant=${cl.cards} apres=${filtered}`);
    // Remise a zero du filtre pour la suite (etat propre avant le mode "zero")
    await page.selectOption('#staffCockpitPage .fcp-status-filter', 'all');

    // 1. Regle d'honnetete : aucun prix pose -> "a definir", jamais "0 EUR".
    // On attend que le MRR ne contienne plus "490" (donc que le rechargement
    // zero soit applique) puis on ASSERTE le libelle : sous mutation, le MRR
    // devient "0 EUR", et ce ok() rougit (pas un timeout).
    await page.evaluate(() => { window.__mrrMode = 'zero'; window.fcpReload(); });
    await page.waitForFunction(() => {
      const mrr = document.querySelector('[data-fcp-panel="kpis"] [data-kpi="mrr"] .fcp-kpi-num');
      return mrr && !/490/.test(mrr.textContent);
    }, null, { timeout: 8000 });
    const zt = await page.evaluate(() => {
      const mrr = document.querySelector('[data-fcp-panel="kpis"] [data-kpi="mrr"] .fcp-kpi-num');
      const hint = document.querySelector('[data-fcp-panel="kpis"] [data-kpi="mrr"] .fcp-kpi-hint');
      return { num: mrr ? mrr.textContent.trim() : '', hint: hint ? hint.textContent.trim() : '' };
    });
    ok(/definir/i.test(zt.num), 'mrr-adefinir', `MRR="${zt.num}" (doit dire "a definir", jamais un faux 0)`);
    ok(/0\s*\/\s*3/.test(zt.hint), 'mrr-hint', `indice="${zt.hint}"`);
  } catch (error) {
    ok(false, 'suite-exception', error.message);
  } finally {
    await page.close();
  }

  const fatal = consoleErrors.filter((e) => !/favicon|vercel-insights/i.test(e));
  ok(fatal.length === 0, 'console-clean', fatal.slice(0, 3).join(' | '));

  return failures;
}

(async () => {
  const original = fs.readFileSync(LIB, 'utf8');
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('--- passe 1 : gate nominal ---');
    const base = await runSuite(browser, false);
    if (base.length) {
      console.error(`founder-pages-ui-check: ROUGE en nominal (${base.join(', ')})`);
      process.exitCode = 1;
      return;
    }

    for (const m of MUTATIONS) {
      console.log(`--- contre-preuve par mutation : ${m.name} ---`);
      applyEdit(LIB, m.find, m.replace);
      let red;
      try {
        red = await runSuite(browser, true);
      } finally {
        applyEdit(LIB, m.replace, m.find); // edition inverse exacte, jamais git checkout
      }
      if (fs.readFileSync(LIB, 'utf8') !== original) {
        console.error('founder-pages-ui-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`founder-pages-ui-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`founder-pages-ui-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`founder-pages-ui-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    // Un gate qui conclut « ALL OK » alors que des assertions ont rougi est pire
    // qu'une absence de gate : on lit la derniere ligne et on deploie. Le code
    // de sortie etait bien 1, mais le message disait le contraire (constate le
    // 2026-07-28 : mrr-adefinir et billing-clientid rouges, « ALL OK » imprime).
    // `failures` vit dans une autre portee : on lit le code de sortie, qui est
    // deja pose a 1 par les blocs d'assertion.
    if (process.exitCode) {
      console.error('founder-pages-ui-check: FAIL - des assertions ont rougi (voir les lignes FAIL ci-dessus).');
      return;
    }
    console.log('founder-pages-ui-check: ALL OK (Clients KPI MRR honnete + edition prix + filtre statut ; Cockpit ligne KPI + graphe PinlaneCharts + pendingInsights/Appliquer ; Incidents dedup ; Centres clientName + totaux + filtre ; console propre ; 2 contre-preuves par mutation)');
  } finally {
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('founder-pages-ui-check: exception', error.message);
  process.exit(1);
});
