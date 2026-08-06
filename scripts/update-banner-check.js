// LE DETECTEUR DE MISE A JOUR EST PROUVE (2026-08-07).
//
// Contexte : la console est une SPA ; un onglet laisse ouvert teste une
// version perimee pendant des heures (« ca bug toujours » alors que la prod
// etait corrigee : verifie en rejouant les gates sur les bundles servis).
// Ce gate prouve la mecanique de bout en bout :
//   1. la page charge la version A ;
//   2. le serveur passe a la version B (l'index change) ;
//   3. le retour sur l'onglet declenche le controle -> le bandeau apparait ;
//   4. « Recharger » recharge VRAIMENT la page (navigation observee) ;
//   5. contre-preuve : tant que le serveur sert la MEME version, aucun
//      bandeau, jamais (zero faux positif).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_UPD_PORT || 4241);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Le serveur sert l'index REEL du repo, mais peut basculer la version des
// assets annoncee (v -> v-suivante) : c'est le « deploiement » simule.
let bumped = false;
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__bump') { bumped = true; res.writeHead(200); res.end('ok'); return; }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      if (filePath.endsWith('index.html') && bumped) {
        content = Buffer.from(String(content).replace(/staff-pages-v2\.js\?v=([0-9a-z]+)/, 'staff-pages-v2.js?v=$1-next'));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });

    console.log('\n[CONTRE-PREUVE] meme version servie : AUCUN bandeau');
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => !document.getElementById('plUpdateBar')), 'tant que le serveur sert la meme version, rien ne s\'affiche');

    console.log('\n[DEPLOIEMENT] le serveur change de version, l\'onglet revient');
    await page.evaluate((base) => fetch(`${base}/__bump`), BASE_URL);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => Boolean(document.getElementById('plUpdateBar')), null, { timeout: 8000 });
    const banner = await page.evaluate(() => (document.getElementById('plUpdateBar') || {}).textContent || '');
    ok(/mise à jour/.test(banner) && /Recharger/.test(banner), 'le bandeau « mise a jour prete » apparait au retour sur l\'onglet');

    console.log('\n[RECHARGER] le bouton recharge REELLEMENT');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }),
      page.click('#plUpdateBar button'),
    ]);
    ok(true, 'la page s\'est rechargee (navigation observee) : le gerant repart sur la version fraiche');
  } catch (error) {
    console.error('\nupdate-banner-check FAIL:', error.stack || error.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nupdate-banner-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nupdate-banner-check: ALL OK - un onglet ouvert apprend qu\'une version fraiche existe.');
}

main();
