// Passe adversariale (2026-07-11) : preuves des fixes ADV-1..6 :
// A. Échec d'injection admin-console → panneau d'erreur + retry fonctionnel,
//    zéro ReferenceError même en cliquant le chrome statique de #adminView.
// B. openAdminCenter mémorise le centre avant chargement des consoles.
// C. direction.html : step simulation en 500 → bannière role=alert visible,
//    boucle auto stoppée, zéro unhandled rejection.
// D. direction.html : onglet Modèles vide → état vide explicite.
// E. Contrastes AA sur les éléments précédemment fautifs (light + dark).
// Réutilise le stub API du harnais visuel (installQaApi de run-visual-qa.js).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'audit', 'adversarial');
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end(); return; }
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

// Extraction d'installQaApi (lignes autonomes) du harnais officiel.
const qaSource = fs.readFileSync(path.join(ROOT, 'scripts', 'run-visual-qa.js'), 'utf8').split('\n');
const startIdx = qaSource.findIndex((l) => l.startsWith('async function installQaApi'));
let endIdx = -1;
for (let i = startIdx + 1; i < qaSource.length; i++) { if (/^\}/.test(qaSource[i])) { endIdx = i; break; } }
const installQaApi = eval(`(${qaSource.slice(startIdx, endIdx + 1).join('\n').replace(/^async function installQaApi/, 'async function')})`);

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`  [shot] ${name}`);
}

// Contraste WCAG calculé dans la page : couleur de texte vs premier fond opaque.
const CONTRAST_FN = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return { selector, missing: true };
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const parse = (str) => { const m = str.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return p[3] === 0 ? null : p.slice(0, 3); };
  const color = parse(getComputedStyle(el).color);
  let node = el, bg = null;
  while (node && node !== document.documentElement) {
    bg = parse(getComputedStyle(node).backgroundColor);
    if (bg) break;
    node = node.parentElement;
  }
  if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
  const l1 = lum(color), l2 = lum(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { selector, ratio: Math.round(ratio * 100) / 100, color: color.join(','), bg: bg.join(',') };
}`;

async function checkContrast(page, selectors, label) {
  for (const sel of selectors) {
    const r = await page.evaluate(`(${CONTRAST_FN})(${JSON.stringify(sel)})`);
    if (r.missing) { console.log(`  [contraste ${label}] ${sel} : absent du DOM (état non atteint), skip`); continue; }
    console.log(`  [contraste ${label}] ${sel} : ${r.ratio}:1 (${r.color} sur ${r.bg})`);
    assert(r.ratio >= 4.5, `${label} ${sel} : contraste ${r.ratio} < 4.5`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const pageErrors = [];

  // ---- A. Échec d'injection admin → panneau + retry ----------------------
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push('lazyfail: ' + String(e)));
    let blockAdmin = true;
    await page.route('**/admin-console.js*', (route) => (blockAdmin ? route.abort() : route.continue()));
    await installQaApi(page);
    await page.goto(`${BASE_URL}/#staff/dashboard`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => setView('admin'));
    await page.waitForTimeout(1500);
    const panelVisible = await page.evaluate(() => {
      const p = document.getElementById('adminConsoleLoadError');
      return !!p && p.offsetParent !== null;
    });
    assert(panelVisible, 'lazyfail : panneau adminConsoleLoadError visible');
    await shot(page, 'A1-lazyfail-panneau');
    // Clic réel sur un onclick statique du chrome admin : pointer-events:none
    // doit l'avaler : zéro ReferenceError.
    const tab = page.locator('#adminTabOverview');
    await tab.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.locator('.admin-btn:has-text("Excel compta")').click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    const refErrors = pageErrors.filter((e) => /ReferenceError|is not defined/i.test(e));
    assert(refErrors.length === 0, `lazyfail : ReferenceError après clics chrome mort → ${refErrors.join(' | ')}`);
    // Retry : on débloque le script, le bouton doit réinjecter et rendre.
    blockAdmin = false;
    await page.locator('#adminConsoleLoadError button').click();
    await page.waitForTimeout(2500);
    const recovered = await page.evaluate(() => ({
      panelGone: !document.getElementById('adminConsoleLoadError'),
      rendered: (document.getElementById('adminContent')?.innerText || '').length > 30,
      clicksBack: document.getElementById('adminView').style.pointerEvents === '',
    }));
    assert(recovered.panelGone, 'retry : panneau retiré après succès');
    assert(recovered.rendered, 'retry : adminContent rendu après réinjection');
    assert(recovered.clicksBack, 'retry : pointer-events restauré');
    await shot(page, 'A2-retry-recovered');
    console.log('OK A : lazyfail : panneau + zéro ReferenceError + retry fonctionnel');

    // ---- B. openAdminCenter avant chargement des consoles ----------------
    const page2 = await context.newPage();
    page2.on('pageerror', (e) => pageErrors.push('center: ' + String(e)));
    await installQaApi(page2);
    await page2.goto(`${BASE_URL}/#staff/dashboard`, { waitUntil: 'load', timeout: 45000 });
    await page2.waitForTimeout(1200);
    const centerHeld = await page2.evaluate(() => {
      if (typeof setAdminCenter === 'function') return 'consoles-deja-chargees';
      openAdminCenter('gembloux');
      return state.adminCenterId;
    });
    assert(centerHeld === 'gembloux', `openAdminCenter : centre mémorisé avant injection (reçu ${centerHeld})`);
    await page2.evaluate(() => setView('admin'));
    await page2.waitForTimeout(2500);
    const centerAfter = await page2.evaluate(() => state.adminCenterId);
    assert(centerAfter === 'gembloux', `openAdminCenter : centre conservé après injection (reçu ${centerAfter})`);
    console.log('OK B : premier switch de centre conservé à travers le lazy-load');
    await page2.close();
    await page.close();
    await context.close();
  }

  // ---- C + D. direction.html : step 500 géré + Modèles vide --------------
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push('direction: ' + String(e)));
    await installQaApi(page);
    // Sur-stub simulation : status = run actif, step = 500.
    await page.addInitScript(() => {
      const prevFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (url.pathname.includes('/api/simulation')) {
          const body = init?.body ? JSON.parse(init.body) : {};
          const action = body.action || url.searchParams.get('action');
          if (action === 'status' || action === 'start') {
            return new Response(JSON.stringify({ ok: true, run: { id: 'r1', status: 'running', simDate: '2026-07-11', stepIndex: 2, totalSteps: 40 }, stats: {}, logs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          if (action === 'step') {
            return new Response(JSON.stringify({ ok: false, message: 'Erreur interne simulation.' }), { status: 500, headers: { 'content-type': 'application/json' } });
          }
        }
        return prevFetch(input, init);
      };
    });
    await page.goto(`${BASE_URL}/direction.html`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    // D : Modèles vide
    await page.evaluate(() => setTab('samples'));
    await page.waitForTimeout(400);
    const emptyState = await page.evaluate(() => document.querySelector('#content .empty')?.textContent || '');
    assert(emptyState.includes('Aucun modèle'), `Modèles vide : état vide attendu (reçu "${emptyState.slice(0, 60)}")`);
    await shot(page, 'D1-direction-modeles-vide');
    // C : step 500
    await page.evaluate(() => setTab('simulation'));
    await page.waitForTimeout(600);
    await page.evaluate(() => stepSimulation(8));
    await page.waitForTimeout(900);
    const simState = await page.evaluate(() => ({
      banner: document.querySelector('.error-banner')?.textContent || '',
      auto: state.simAuto,
    }));
    assert(simState.banner.includes('simulation impossible'), `sim step 500 : bannière attendue (reçu "${simState.banner.slice(0, 80)}")`);
    assert(simState.auto === false, 'sim step 500 : boucle auto stoppée');
    const dirErrors = pageErrors.filter((e) => e.startsWith('direction:'));
    assert(dirErrors.length === 0, `sim step 500 : unhandled rejection → ${dirErrors.join(' | ')}`);
    await shot(page, 'C1-direction-step500-bannière');
    console.log('OK C+D : direction : step 500 géré proprement, Modèles a un état vide');
    await page.close();
    await context.close();
  }

  // ---- E. Contrastes light + dark -----------------------------------------
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(`contrast-${scheme}: ` + String(e)));
    await installQaApi(page);
    await page.goto(`${BASE_URL}/#client`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);
    await checkContrast(page, [
      '#clientView .hero-kicker',
      '#clientView .seg-btn.active',
      '#clientView .dur-pill.active',
      '#clientView .dur-pill.active .price',
      '#clientView .pax-alert span',
      '#clientView .pax-alert b',
    ], `client-step1-${scheme}`);
    await shot(page, `E1-client-step1-${scheme}`);
    // Onglet Formules : prix barrés (--faint) + meta + badge accent.
    const formulesBtn = page.locator('.seg-btn:has-text("Formules")').first();
    if (await formulesBtn.count()) {
      await formulesBtn.click();
      await page.waitForTimeout(800);
      await checkContrast(page, [
        '#clientView .formule-card-price s',
        '#clientView .formule-card-meta',
        '#clientView .badge-best',
      ], `client-formules-${scheme}`);
      await shot(page, `E2-client-formules-${scheme}`);
    }
    await page.close();
    await context.close();
  }
  console.log('OK E : contrastes AA sur les éléments précédemment fautifs (light + dark)');

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) {
    console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1));
    throw new Error(`${critical.length} erreur(s) page détectée(s)`);
  }

  await browser.close();
  server.close();
  console.log('ADVERSARIAL MANUAL CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
