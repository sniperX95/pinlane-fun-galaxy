// Vérification manuelle onglet « Données » (admin-data.js) — rendu complet,
// interactions bilan, exports, zéro pageerror, light/dark/mobile.
// Réutilise le stub session du harnais visuel + stubbe les actions direction*.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4194;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'audit', 'data-hub');
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};

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
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const qaSource = fs.readFileSync(path.join(ROOT, 'scripts', 'run-visual-qa.js'), 'utf8').split('\n');
const startIdx = qaSource.findIndex((l) => l.startsWith('async function installQaApi'));
let endIdx = -1;
for (let i = startIdx + 1; i < qaSource.length; i++) { if (/^\}/.test(qaSource[i])) { endIdx = i; break; } }
const installQaApi = eval(`(${qaSource.slice(startIdx, endIdx + 1).join('\n').replace(/^async function installQaApi/, 'async function')})`);

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

// Jeu de données réaliste : 30 jours, 3 activités, formules, heatmap, clients.
function buildFakeAnalytics() {
  const daily = [];
  const heatmap = Array.from({ length: 7 }, () => ({}));
  const end = new Date('2026-07-11T00:00:00Z');
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const wd = (d.getUTCDay() + 6) % 7;
    const count = [3, 0, 2, 4, 5, 9, 11][wd] + (i % 3);
    daily.push({ date, count, revenue: count * 47, pax: count * 6, cancelled: i % 9 === 0 ? 1 : 0 });
    for (let k = 0; k < count; k += 1) {
      const h = 14 + ((k * 3 + wd) % 9);
      heatmap[wd][h] = (heatmap[wd][h] || 0) + 1;
    }
  }
  const totalCount = daily.reduce((s, d) => s + d.count, 0);
  const weekly = [];
  for (let w = 0; w < 5; w += 1) {
    const chunk = daily.slice(w * 7, w * 7 + 7).filter(Boolean);
    if (!chunk.length) continue;
    weekly.push({ weekStart: chunk[0].date, label: `S${w}`, count: chunk.reduce((s, d) => s + d.count, 0), revenue: chunk.reduce((s, d) => s + d.revenue, 0), pax: chunk.reduce((s, d) => s + d.pax, 0), cancelled: 0 });
  }
  return {
    startDate: daily[0].date,
    endDate: daily[daily.length - 1].date,
    totals: { reservations: totalCount, revenue: totalCount * 47, pax: totalCount * 6, cancelled: 4, cancelRate: 2.4, avgBasket: 47, days: 30 },
    daily,
    weekly,
    monthly: [{ month: '2026-06', count: 88, revenue: 4136, pax: 528, cancelled: 2 }, { month: '2026-07', count: 74, revenue: 3478, pax: 444, cancelled: 2 }],
    byType: {
      bowling: { count: Math.round(totalCount * 0.62), revenue: 4200, pax: 610 },
      laser: { count: Math.round(totalCount * 0.22), revenue: 1500, pax: 240 },
      formule: { count: Math.round(totalCount * 0.16), revenue: 1914, pax: 122 },
    },
    byFormule: [
      { id: 'f5', label: 'FORMULE 5', count: 9, revenue: 810, pax: 54 },
      { id: 'f1', label: 'FORMULE 1', count: 7, revenue: 602, pax: 42 },
      { id: 'f2', label: 'FORMULE 2', count: 5, revenue: 380, pax: 28 },
      { id: 'f7', label: 'FORMULE 7', count: 2, revenue: 122, pax: 9 },
    ],
    byOccasion: [{ occasion: 'anniversaire', count: 14 }, { occasion: 'entreprise', count: 5 }, { occasion: 'école', count: 3 }],
    byChannel: [{ channel: 'en ligne', count: Math.round(totalCount * 0.44) }, { channel: 'staff', count: Math.round(totalCount * 0.56) }],
    heatmap,
    occupancy: { scope: 'bowling', bookedLaneHours: 214, capacityLaneHours: 2176, rate: 9.8 },
    clients: {
      unique: 96, new: 61, returning: 35, returningRate: 36.5, multi: 18,
      top: [
        { key: 'p:1', name: 'Marie Lambert', phone: '+32 470 11 22 33', email: '', visits: 6, revenue: 512, pax: 8, firstVisit: '2026-03-02', lastVisit: '2026-07-09', favorite: 'bowling' },
        { key: 'p:2', name: 'Ansar Bisultanov', phone: '+32 471 44 55 66', email: '', visits: 4, revenue: 388, pax: 11, firstVisit: '2026-06-14', lastVisit: '2026-07-10', favorite: 'formule' },
        { key: 'e:3', name: 'Club Ardenne Laser', phone: '', email: 'club@ardenne.be', visits: 3, revenue: 341, pax: 18, firstVisit: '2026-05-20', lastVisit: '2026-07-05', favorite: 'laser' },
      ],
    },
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const pageErrors = [];
  const analytics = buildFakeAnalytics();
  const previous = { startDate: '2026-05-13', endDate: '2026-06-11', totals: { reservations: 118, revenue: 5340, pax: 690, cancelled: 6, cancelRate: 4.8, avgBasket: 45.2, days: 30 }, clients: { unique: 80, returning: 22 } };
  let savedBody = null;
  const report = {
    id: 41, centerId: 'libramont', periodType: 'week', periodStart: '2026-06-29', periodEnd: '2026-07-05',
    title: 'Bilan de la semaine du 2026-06-29', generatedBy: 'deterministic', generatedAt: '2026-07-11T09:00:00Z', editedAt: null, editedBy: '',
    bodyMd: '# Bilan de la semaine du 2026-06-29 — Fun Galaxy Libramont\n\n## Synthèse\n- **34 réservations** (en hausse de 12%) pour **1 598 €**.\n- **204 joueurs** accueillis.\n\n## Recommandations\n- Pousser la FORMULE 5 (locomotive).',
  };

  // installQaApi remplace window.fetch : on l'enveloppe (init scripts exécutés
  // dans l'ordre) pour intercepter uniquement les actions direction*.
  async function setupPage(context) {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await installQaApi(page);
    await page.addInitScript(({ analytics, previous, report }) => {
      window.__dhSaved = null;
      const attach = () => {
        const prevFetch = window.fetch;
        window.fetch = async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
          const body = init?.body ? JSON.parse(init.body) : {};
          const action = url.searchParams.get('action') || body.action;
          const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
          if (url.pathname === '/api/ops') {
            if (action === 'directionAnalytics') return json({ ok: true, analytics, previous });
            if (action === 'directionReports') return json({ ok: true, reports: [report] });
            if (action === 'generateDirectionReport') {
              return json({ ok: true, report: { ...report, id: 42, periodStart: '2026-07-06', periodEnd: '2026-07-12', generatedAt: new Date().toISOString() } });
            }
            if (action === 'saveDirectionReport') {
              window.__dhSaved = body.bodyMd;
              return json({ ok: true, report: { ...report, bodyMd: body.bodyMd, editedAt: new Date().toISOString(), editedBy: 'QA Pinlane' } });
            }
          }
          return prevFetch(input, init);
        };
      };
      // Le stub QA pose son fetch au même stade : on enveloppe après coup.
      setTimeout(attach, 0);
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    }, { analytics, previous, report });
    return page;
  }

  // ---- Light desktop : rendu complet + interactions -----------------------
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await setupPage(context);
    await page.goto(`${BASE_URL}/#staff/dashboard`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => setView('admin'));
    await page.waitForTimeout(2000);
    assert(await page.locator('#adminTabData').count() === 1, 'bouton onglet Données présent');
    await page.evaluate(() => setAdminTab('data'));
    await page.waitForTimeout(1500);
    const counts = await page.evaluate(() => ({
      tiles: document.querySelectorAll('.dh-tile').length,
      cols: document.querySelectorAll('.dh-col').length,
      rows: document.querySelectorAll('.dh-row').length,
      hm: document.querySelectorAll('.dh-hm-cell').length,
      tableRows: document.querySelectorAll('.dh-table tbody tr').length,
      reports: document.querySelectorAll('.dh-report-item').length,
    }));
    assert(counts.tiles === 6, `6 tuiles KPI (reçu ${counts.tiles})`);
    assert(counts.cols >= 30, `colonnes série quotidienne (reçu ${counts.cols})`);
    assert(counts.rows >= 8, `barres horizontales activités/formules (reçu ${counts.rows})`);
    assert(counts.hm >= 50, `cellules heatmap (reçu ${counts.hm})`);
    assert(counts.tableRows === 3, `table clients (reçu ${counts.tableRows})`);
    assert(counts.reports === 1, `liste bilans (reçu ${counts.reports})`);
    await page.screenshot({ path: path.join(OUT, '01-data-light-desktop.png'), fullPage: true });

    // Sélecteur de période → recharge en weekly
    await page.evaluate(() => dhSetRange('90j'));
    await page.waitForTimeout(900);
    const weeklyCols = await page.evaluate(() => document.querySelectorAll('.dh-col').length);
    assert(weeklyCols > 0 && weeklyCols < 30, `bucket hebdo sur 90j (reçu ${weeklyCols} colonnes)`);
    await page.evaluate(() => dhSetRange('30j'));
    await page.waitForTimeout(900);

    // Menu export
    await page.locator('.dh-controls .admin-btn').first().click();
    assert(await page.locator('#dhExportMenu:not(.hidden)').count() === 1, 'menu export ouvert');
    await page.screenshot({ path: path.join(OUT, '02-export-menu.png') });
    await page.locator('.dh-title').click();
    await page.waitForTimeout(200);

    // Bilan : ouvrir → modifier → enregistrer
    await page.evaluate(() => dhOpenReport(41));
    await page.waitForTimeout(400);
    assert(await page.locator('.dh-report-body h3').count() >= 1, 'bilan rendu en HTML');
    await page.screenshot({ path: path.join(OUT, '03-bilan-viewer.png'), fullPage: true });
    await page.evaluate(() => dhEditReport(41));
    await page.waitForTimeout(300);
    await page.locator('#dhReportEditor').fill('# Bilan édité par la direction\n\n- Chiffre validé.');
    await page.locator('.dh-report-actions .admin-btn.primary').click();
    await page.waitForTimeout(600);
    savedBody = await page.evaluate(() => window.__dhSaved);
    assert(savedBody && savedBody.includes('Bilan édité'), 'sauvegarde du bilan envoyée à l’API');
    const edited = await page.evaluate(() => document.querySelector('.dh-report-item .dh-report-meta')?.textContent || '');
    assert(edited.includes('édité'), `badge édité affiché (reçu "${edited}")`);

    // Générer un nouveau bilan (stub)
    await page.locator('.dh-report-gen .admin-btn').first().click();
    await page.waitForTimeout(700);
    const reportCount = await page.evaluate(() => document.querySelectorAll('.dh-report-item').length);
    assert(reportCount === 2, `nouveau bilan listé (reçu ${reportCount})`);
    await page.close();
    await context.close();
  }

  // ---- Dark desktop + light mobile : rendu ---------------------------------
  for (const [name, opts] of [
    ['04-data-dark-desktop', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }],
    ['05-data-light-mobile', { viewport: { width: 390, height: 844 }, colorScheme: 'light' }],
  ]) {
    const context = await browser.newContext(opts);
    const page = await setupPage(context);
    await page.goto(`${BASE_URL}/#staff/dashboard`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { setView('admin'); });
    await page.waitForTimeout(1800);
    await page.evaluate(() => setAdminTab('data'));
    await page.waitForTimeout(1500);
    assert(await page.locator('.dh-tile').count() === 6, `${name} : tuiles rendues`);
    // body a overflow-x:clip → le vrai test est : (1) impossible de scroller
    // horizontalement, (2) le hub lui-même tient dans le viewport.
    const probe = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const scrolled = window.scrollX;
      window.scrollTo(0, 0);
      const vw = document.documentElement.clientWidth;
      const hubRight = Math.max(0, ...[...document.querySelectorAll('.dh-wrap, .dh-wrap *:not(.dh-hm *):not(.dh-table *)')]
        .map((el) => el.getBoundingClientRect().right));
      return { scrolled, hubOver: Math.max(0, Math.round(hubRight - vw - 1)) };
    });
    console.log(`  [probe ${name}] scrollX=${probe.scrolled} hubOver=${probe.hubOver}`);
    if (probe.hubOver > 0) {
      const wide = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.dh-wrap *')]
          .filter((el) => el.getBoundingClientRect().width > vw)
          .slice(0, 6)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} w=${Math.round(el.getBoundingClientRect().width)}`);
      });
      console.log('  WIDE:', JSON.stringify(wide));
    }
    const overflow = Math.max(probe.scrolled, probe.hubOver);
    if (overflow > 0) {
      const offenders = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const clipped = (el) => {
          for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true;
          }
          return false;
        };
        return [...document.querySelectorAll('*')]
          .filter((el) => el.getBoundingClientRect().right > vw + 1 && !clipped(el))
          .slice(0, 8)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(el.getBoundingClientRect().right)} disp=${getComputedStyle(el).display} vis=${getComputedStyle(el).visibility}`);
      });
      console.log('OVERFLOW OFFENDERS:', JSON.stringify(offenders, null, 1));
      const chain = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        let el = [...document.querySelectorAll('*')].find((e) => e.getBoundingClientRect().right > vw + 1);
        const out = [];
        while (el && el !== document.body) {
          const cs = getComputedStyle(el);
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} w=${Math.round(el.getBoundingClientRect().width)} ox=${cs.overflowX} minw=${cs.minWidth} disp=${cs.display} flex=${cs.flex}`);
          el = el.parentElement;
        }
        return out;
      });
      console.log('CHAIN:', JSON.stringify(chain, null, 1));
    }
    assert(overflow <= 0, `${name} : pas de débordement horizontal (reçu ${overflow}px)`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    await page.close();
    await context.close();
  }

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) {
    console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1));
    throw new Error(`${critical.length} erreur(s) page`);
  }
  await browser.close();
  server.close();
  console.log('DATA HUB CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
