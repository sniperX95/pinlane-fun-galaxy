// Vérification manuelle vague 5 (C8/C14) : parcours staff v2 + client + admin
// lazy-load + direction.html, avec assertions réseau sur admin/ops-console.
// Réutilise le stub API du harnais visuel (installQaApi de run-visual-qa.js).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:4191';
const OUT = path.join(ROOT, 'artifacts', 'audit', 'wave5');
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const requested = [];
  const pageErrors = [];
  page.on('request', (r) => requested.push(r.url()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const consoleLoaded = (name) => requested.some((u) => u.includes(`${name}.js`));

  await installQaApi(page);

  // ---- 1. Profil client : aucune console chargée -------------------------
  await page.goto(`${BASE_URL}/#client`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);
  assert(!consoleLoaded('admin-console') && !consoleLoaded('ops-console'),
    'client : admin/ops-console ne doivent pas être chargés');
  console.log('OK réseau client : admin-console + ops-console absents');
  await shot(page, '01-client-step1');
  // Parcours client : activité -> date -> suivant
  const laserCard = page.locator('[onclick*="laser"], button:has-text("Laser")').first();
  if (await laserCard.count()) { await laserCard.click().catch(() => {}); await page.waitForTimeout(400); }
  await shot(page, '02-client-activity');
  const nextBtn = page.locator('.btn-primary:visible').first();
  if (await nextBtn.count()) { await nextBtn.click().catch(() => {}); await page.waitForTimeout(500); }
  await shot(page, '03-client-step2');
  assert(!consoleLoaded('admin-console') && !consoleLoaded('ops-console'),
    'client (après navigation) : consoles toujours absentes');

  // ---- 2. Staff : pages v2 hors emails, consoles absentes ----------------
  const staffPages = ['dashboard', 'planning', 'reservations', 'clients', 'prices', 'campaigns', 'groups'];
  for (const p of staffPages) {
    await page.goto(`${BASE_URL}/#staff/${p}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1400);
    await shot(page, `10-staff-${p}`);
  }
  assert(!consoleLoaded('admin-console'), 'staff hors emails : admin-console absent');
  assert(!consoleLoaded('ops-console'), 'staff hors emails/settings : ops-console absent');
  console.log('OK réseau staff (7 pages) : consoles absentes');

  // Palette (Ctrl+K)
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await shot(page, '11-staff-palette');
  await page.keyboard.press('Escape');

  // ---- 3. Staff emails : ops-console chargé à la demande -----------------
  await page.goto(`${BASE_URL}/#staff/emails`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2000);
  assert(consoleLoaded('ops-console'), 'staff emails : ops-console.js doit être injecté');
  assert(!consoleLoaded('admin-console'), 'staff emails : admin-console.js reste absent');
  const emailRows = await page.locator('#staffEmailsPage .pv2-shell').count();
  assert(emailRows > 0, 'staff emails : page v2 rendue');
  await shot(page, '12-staff-emails-ops-lazy');
  console.log('OK réseau staff emails : ops-console injecté, admin-console absent');

  // ---- 4. Vue admin : chargement dynamique + 2 onglets --------------------
  await page.evaluate(() => setView('admin'));
  await page.waitForTimeout(2200);
  assert(consoleLoaded('admin-console'), 'admin : admin-console.js doit être injecté après setView');
  const adminVisible = await page.evaluate(() => !document.getElementById('adminView').classList.contains('hidden'));
  assert(adminVisible, 'admin : vue visible');
  const overviewHtml = await page.evaluate(() => document.getElementById('adminView').innerText.slice(0, 400));
  assert(overviewHtml.length > 50, 'admin : contenu rendu');
  await shot(page, '20-admin-overview');
  await page.evaluate(() => setAdminTab('reservations'));
  await page.waitForTimeout(900);
  await shot(page, '21-admin-tab-reservations');
  await page.evaluate(() => setAdminTab('clients'));
  await page.waitForTimeout(900);
  await shot(page, '22-admin-tab-clients');
  console.log('OK admin : console injectée, onglets Réservations + Clients rendus');

  // ---- 5. Deep-link #admin/reservations sur page neuve --------------------
  const page2 = await context.newPage();
  const requested2 = [];
  page2.on('request', (r) => requested2.push(r.url()));
  page2.on('pageerror', (e) => pageErrors.push('deep-link: ' + String(e)));
  await installQaApi(page2);
  await page2.goto(`${BASE_URL}/#admin/reservations`, { waitUntil: 'load', timeout: 45000 });
  await page2.waitForTimeout(2500);
  assert(requested2.some((u) => u.includes('admin-console.js')), 'deep-link : admin-console.js injecté au boot');
  const deepTab = await page2.evaluate(() => state.adminTab);
  assert(deepTab === 'reservations', `deep-link : onglet réservations attendu (reçu ${deepTab})`);
  const deepVisible = await page2.evaluate(() => !document.getElementById('adminView').classList.contains('hidden'));
  assert(deepVisible, 'deep-link : vue admin visible');
  await shot(page2, '23-admin-deeplink-reservations');
  console.log('OK deep-link #admin/reservations : consoles injectées au boot, onglet correct');
  await page2.close();

  // ---- 6. direction.html ---------------------------------------------------
  const page3 = await context.newPage();
  page3.on('pageerror', (e) => pageErrors.push('direction: ' + String(e)));
  await installQaApi(page3);
  await page3.goto(`${BASE_URL}/direction.html`, { waitUntil: 'networkidle', timeout: 45000 });
  await page3.waitForTimeout(1500);
  await shot(page3, '30-direction');
  await page3.close();

  const criticalErrors = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (criticalErrors.length) {
    console.log('PAGE ERRORS:', JSON.stringify(criticalErrors, null, 1));
    throw new Error(`${criticalErrors.length} erreur(s) page détectée(s)`);
  }

  await browser.close();
  console.log('WAVE5 MANUAL CHECK: ALL OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
