// Captures HAUTE RESOLUTION du produit pour la video promo.
//
// Les captures de artifacts/qa sont prises a 1440 px CSS sans sur-echantillon :
// affichees plein cadre dans une video, elles sont floues. Ici on rend a
// deviceScaleFactor=3, soit 4320 px reels. Le produit reste EXACTEMENT celui du
// code (meme HTML, meme CSS, memes fixtures que les gates) : seule la finesse
// du rendu change.
//
// Usage : node scripts/promo-shots-hd.js [--scale 3] [--out artifacts/promo-shots]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const SCALE = Number(arg('scale', 3));
const OUT = path.join(ROOT, arg('out', 'artifacts/promo-shots'));
const PORT = 4599;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Recupere une fonction de run-visual-qa SANS la dupliquer : on lit sa source et
// on l'evalue. installQaApi pose la session ET les fixtures de donnees
// (__PINLANE_QA_RESERVATIONS__) - sans elles les ecrans sortent vides, la base
// de production ayant ete purgee. Une copie divergerait au premier changement
// de fixtures cote gate.
function loadFromVisualQa(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8');
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error(name + ' introuvable dans run-visual-qa.js');
  const end = new RegExp('\\r?\\n\\}\\r?\\n').exec(src.slice(start));
  if (!end) throw new Error('fin de ' + name + ' introuvable');
  const body = src.slice(start, start + end.index + end[0].length);
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', body + '\nreturn ' + name + ';')(BASE_URL);
}

const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  server.listen(PORT, '127.0.0.1', () => resolve(server));
});

const SHOTS = [
  ['planning', 'planning'],
  ['reservations', 'reservations'],
  ['clients', 'clients'],
  ['emails', 'emails'],
  ['campaigns', 'marketing'],
  ['dashboard', 'dashboard'],
];

(async () => {
  const installQaApi = loadFromVisualQa('installQaApi');
  const seedStressDay = loadFromVisualQa('seedStressDay');
  const renderStaffPage = loadFromVisualQa('renderStaffPage');

  const server = await serve();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE });
  await installQaApi(page);
  await page.goto(`${BASE_URL}/?v=promo-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('pinlane-theme', 'dark'); } catch (e) {}
  });
  await seedStressDay(page);
  await page.waitForTimeout(1000);

  let filled = 0;
  for (const [key, name] of SHOTS) {
    await renderStaffPage(page, key);
    await page.waitForTimeout(1100);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });

    // Un ecran vide est inutilisable en pub : on le signale au lieu de le livrer.
    const empty = await page.evaluate(() => /Aucun (client|resultat|résultat)/i.test(document.body.innerText));
    const b = fs.readFileSync(file);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    console.log(`${empty ? 'VIDE' : 'ok  '} ${name.padEnd(14)} ${w}x${h}  ${Math.round(b.length / 1024)} Ko`);
    if (!empty) filled++;
  }

  await browser.close();
  server.close();
  console.log(`\n${filled}/${SHOTS.length} ecrans REMPLIS a x${SCALE} dans ${path.relative(ROOT, OUT)}`);
  if (!filled) { console.error('Tous les ecrans sont vides : les fixtures ne sont pas arrivees.'); process.exit(1); }
})().catch((e) => { console.error('promo-shots-hd:', e.message); process.exit(1); });
