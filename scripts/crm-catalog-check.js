// Vérification Lots B+C (refonte data-driven) : CRM clients triable +
// classement rentabilité du catalogue. Zéro pageerror, ordres vérifiés.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4196;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'audit', 'crm-catalog');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const qaSource = fs.readFileSync(path.join(ROOT, 'scripts', 'run-visual-qa.js'), 'utf8').split('\n');
const startIdx = qaSource.findIndex((l) => l.startsWith('async function installQaApi'));
let endIdx = -1;
for (let i = startIdx + 1; i < qaSource.length; i++) { if (/^\}/.test(qaSource[i])) { endIdx = i; break; } }
const installQaApi = eval(`(${qaSource.slice(startIdx, endIdx + 1).join('\n').replace(/^async function installQaApi/, 'async function')})`);

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await installQaApi(page);
  // Stub dashboardAnalytics (le stub QA ne le connaît pas) : données réalistes.
  await page.addInitScript(() => {
    const attach = () => {
      const prevFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (url.pathname === '/api/ops' && url.searchParams.get('action') === 'dashboardAnalytics') {
          const daily = [];
          const end = new Date('2026-07-11T00:00:00Z');
          for (let i = 29; i >= 0; i -= 1) {
            const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
            const count = (i * 7) % 9;
            daily.push({ date: d.toISOString().slice(0, 10), count, revenue: count * 45, pax: count * 5, cancelled: 0 });
          }
          const analytics = {
            startDate: daily[0].date, endDate: daily[29].date,
            totals: { reservations: 120, revenue: 5400, pax: 600, cancelled: 3, cancelRate: 2.4, avgBasket: 45, paid: 84, paymentRate: 70, days: 30 },
            daily, weekly: [], monthly: [],
            byType: { bowling: { count: 80, revenue: 3600, pax: 400 }, laser: { count: 25, revenue: 1000, pax: 130 }, formule: { count: 15, revenue: 800, pax: 70 } },
            byChannel: [{ channel: 'en ligne', count: 55 }, { channel: 'staff', count: 65 }],
            byFormule: [], byOccasion: [], heatmap: [],
            occupancy: { scope: 'bowling', bookedLaneHours: 120, capacityLaneHours: 2100, rate: 5.7 },
            clients: { unique: 60, new: 20, returning: 40, returningRate: 66, multi: 12, top: [] },
          };
          const previous = { totals: { reservations: 100, revenue: 5000, pax: 500, cancelled: 4, cancelRate: 3.8, avgBasket: 50, paid: 60, paymentRate: 60, days: 30 }, clients: { unique: 50, returning: 30 } };
          return new Response(JSON.stringify({ ok: true, analytics, previous }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return prevFetch(input, init);
      };
    };
    setTimeout(attach, 0);
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  });

  // ---- CRM clients : tri colonnes + tris rapides ---------------------------
  await page.goto(`${BASE_URL}/#staff/clients`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  assert(await page.locator('.pv2-th-sort').count() === 5, '5 colonnes triables');
  assert(await page.locator('.pv2-quicksorts .pv2-chip-btn').count() === 4, '4 tris rapides');

  const spentOrder = async () => page.evaluate(() => getFilteredStaffClientRows().map((r) => r.spent));
  await page.evaluate(() => setStaffClientSort('spent'));
  await page.waitForTimeout(400);
  let spent = await spentOrder();
  assert(spent.length > 1, `assez de clients pour tester le tri (reçu ${spent.length})`);
  assert(spent.every((v, i) => i === 0 || spent[i - 1] >= v), `tri Dépensé desc réel (${spent.join(',')})`);
  await page.evaluate(() => setStaffClientSort('spent'));
  await page.waitForTimeout(400);
  spent = await spentOrder();
  assert(spent.every((v, i) => i === 0 || spent[i - 1] <= v), `tri Dépensé asc réel (${spent.join(',')})`);

  await page.evaluate(() => applyStaffClientQuickSort('frequent'));
  await page.waitForTimeout(400);
  const visits = await page.evaluate(() => getFilteredStaffClientRows().map((r) => r.reservations));
  assert(visits.every((v, i) => i === 0 || visits[i - 1] >= v), `tri rapide « plus fidèles » réel (${visits.join(',')})`);
  const summary = await page.evaluate(() => document.querySelector('.pv2-panel-head small')?.textContent || '');
  assert(summary.includes('cumulés'), 'résumé dépense cumulée de la sélection affiché');
  const ariaSorted = await page.locator('.pv2-th-sort[aria-sort="descending"], .pv2-th-sort[aria-sort="ascending"]').count();
  assert(ariaSorted === 1, 'aria-sort posé sur la colonne active');
  await page.screenshot({ path: path.join(OUT, '01-clients-tri.png'), fullPage: true });

  // ---- Catalogue : classement rentabilité ----------------------------------
  await page.goto(`${BASE_URL}/#staff/prices`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  assert(await page.locator('.pv2-quicksorts .pv2-chip-btn').count() >= 4, 'chips de classement présents');
  await page.evaluate(() => setStaffPricingSort('revenue'));
  await page.waitForTimeout(400);
  const revenues = await page.evaluate(() => getPricingRowsFiltered().map((r) => Number(r.revenue || 0)));
  assert(revenues.every((v, i) => i === 0 || revenues[i - 1] >= v), 'classement Top chiffre réel');
  assert(await page.locator('.pv2-rank').count() >= 1, 'badge de rang affiché sur le podium');
  const basketCells = await page.locator('.pv2-price-stats span:nth-child(4)').count();
  assert(basketCells > 0, 'panier moyen affiché par carte');
  await page.screenshot({ path: path.join(OUT, '02-catalogue-classement.png'), fullPage: true });

  // ---- Dashboard : board modulaire RETIRE (refonte 2026-07-23) --------------
  // Le tableau d'analyse personnalisable ne vit plus sur le dashboard (devenu
  // vue "du jour") : il a ete deplace dans la vue Activite de la Direction. Sa
  // couverture d'edition/persistance est prouvee par analytics-board-check.js et
  // direction-cockpit-check.js. Plus rien a verifier ici cote dashboard.

  // ---- Groupes : actions réelles + dismiss persisté ------------------------
  await page.goto(`${BASE_URL}/#staff/groups`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1600);
  assert(await page.locator('.groups-side-card h3:has-text("Agenda groupes")').count() === 1, 'agenda groupes présent');
  const agendaButtons = await page.locator('.groups-agenda-item[onclick]').count();
  const actionItems = await page.locator('.groups-action-item').count();
  console.log(`  [groupes] ${agendaButtons} entrée(s) agenda cliquables · ${actionItems} action(s) recommandée(s)`);
  if (actionItems > 0) {
    assert(await page.locator('.groups-action-dismiss').count() === actionItems, 'chaque action a un bouton traiter');
    const firstLabel = await page.locator('.groups-action-item strong').first().textContent();
    await page.locator('.groups-action-dismiss').first().click();
    await page.waitForTimeout(600);
    const after = await page.locator('.groups-action-item').count();
    assert(after < actionItems, `action traitée disparue (${actionItems} → ${after})`);
    const persisted = await page.evaluate(() => (state.dismissedGroupActions || []).length);
    assert(persisted >= 1, 'dismiss persisté dans le state');
    console.log(`  [groupes] action « ${firstLabel.trim()} » traitée et masquée`);
  }
  await page.screenshot({ path: path.join(OUT, '03-groupes-actions.png'), fullPage: true });

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) { console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1)); throw new Error(`${critical.length} erreur(s) page`); }
  await browser.close();
  server.close();
  console.log('CRM+CATALOG CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
