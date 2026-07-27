// ENREGISTREMENT de vraies interactions dans le produit, pour la video promo.
//
// Les versions precedentes faisaient panner des captures FIXES : on voyait le
// produit, jamais quelqu'un s'en servir. Ici Playwright pilote reellement
// l'application (remplir le formulaire, cliquer dans le planning, naviguer) et
// enregistre la video de la session. Ce qui est a l'ecran EST le produit en
// fonctionnement, pas une reconstitution.
//
// Sortie : un webm par scenario dans artifacts/promo-clips/, converti ensuite
// en mp4 par le montage.
//
// Usage : node scripts/promo-record.js [--w 2560] [--h 1440]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const W = Number(arg('w', 2560));
const H = Number(arg('h', 1440));
const OUT = path.join(ROOT, 'artifacts/promo-clips');
const PORT = 4601;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

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

// Un curseur visible est INDISPENSABLE : sans lui, les elements changent d'etat
// tout seuls et le spectateur ne comprend pas qu'on manipule le produit.
const CURSOR_CSS = `
  #__promoCursor{position:fixed;width:28px;height:28px;z-index:2147483647;pointer-events:none;
    left:0;top:0;transition:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.95))}
  #__promoRipple{position:fixed;width:18px;height:18px;border-radius:50%;z-index:2147483646;
    pointer-events:none;border:3px solid #3291ff;opacity:0}`;

async function installCursor(page) {
  await page.evaluate((css) => {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    const c = document.createElement('div');
    c.id = '__promoCursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 2l14 10.5-6.2.6 3.4 6.9-2.9 1.4-3.3-6.9L5 19z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const r = document.createElement('div');
    r.id = '__promoRipple';
    document.body.appendChild(r);
    window.__promoMove = (x, y) => { c.style.transform = `translate(${x}px, ${y}px)`; };
    window.__promoClick = (x, y) => {
      r.style.left = (x - 9) + 'px'; r.style.top = (y - 9) + 'px';
      r.style.transition = 'none'; r.style.opacity = '.95'; r.style.transform = 'scale(1)';
      requestAnimationFrame(() => {
        r.style.transition = 'transform .5s cubic-bezier(.2,.8,.3,1), opacity .5s';
        r.style.opacity = '0'; r.style.transform = 'scale(5)';
      });
      c.style.transform = `translate(${x}px, ${y}px) scale(.78)`;
      setTimeout(() => { c.style.transform = `translate(${x}px, ${y}px) scale(1)`; }, 130);
    };
  }, CURSOR_CSS);
}

// Deplacement humain : courbe, acceleration puis freinage. Une souris ne va
// jamais en ligne droite a vitesse constante.
async function moveTo(page, x, y, steps = 26) {
  const from = await page.evaluate(() => window.__promoAt || { x: 200, y: 200 });
  const cx = (from.x + x) / 2 + (y - from.y) * .22;
  const cy = (from.y + y) / 2 - (x - from.x) * .22;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * from.x + 2 * u * e * cx + e * e * x;
    const py = u * u * from.y + 2 * u * e * cy + e * e * y;
    await page.evaluate(([a, b]) => { window.__promoMove(a, b); window.__promoAt = { x: a, y: b }; }, [px, py]);
    await page.waitForTimeout(11);
  }
}

async function clickAt(page, sel, label) {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) { console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await page.waitForTimeout(170);
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [box.x, box.y]);
  await page.waitForTimeout(90);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, sel);
  await page.waitForTimeout(620);
  console.log(`   clic ${label}`);
  return true;
}

(async () => {
  const installQaApi = loadFromVisualQa('installQaApi');
  const seedStressDay = loadFromVisualQa('seedStressDay');
  const renderStaffPage = loadFromVisualQa('renderStaffPage');

  const server = await serve();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();

  // ---- SCENARIO 1 : le client reserve --------------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      recordVideo: { dir: path.join(OUT, 'raw-client'), size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (typeof setView === 'function') setView('client');
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1100);
    await installCursor(page);

    console.log('SCENARIO 1 - le client reserve');
    await page.waitForTimeout(500);
    await clickAt(page, '#fPax, [id="fPax"]', 'nombre de joueurs');
    await clickAt(page, '[data-type="laser"], [onclick*="laser"]', 'Laser Game');
    await clickAt(page, '#btnCheck, [onclick*="goStep2"], .btn-primary', 'Verifier les disponibilites');
    await page.waitForTimeout(1400);
    await ctx.close();
  }

  // ---- SCENARIO 2 : l'equipe pilote le centre ------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      recordVideo: { dir: path.join(OUT, 'raw-staff'), size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await seedStressDay(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await installCursor(page);

    console.log('SCENARIO 2 - l equipe pilote');
    // On NAVIGUE dans le menu comme un utilisateur, on ne saute pas d'ecran.
    for (const [sel, label] of [
      ['[data-fgx-menu-key="reservations"]', 'Reservations'],
      ['[data-fgx-menu-key="clients"]', 'Clients'],
      ['[data-fgx-menu-key="emails"]', 'Emails & relances'],
      ['[data-fgx-menu-key="campaigns"]', 'Marketing'],
    ]) {
      await clickAt(page, sel, label);
      await page.waitForTimeout(700);
    }
    // Retour au planning et clic sur une reservation reelle.
    await renderStaffPage(page, 'planning');
    await page.waitForTimeout(900);
    await clickAt(page, '.booking', 'une reservation du planning');
    await page.waitForTimeout(1500);
    await ctx.close();
  }

  await browser.close();
  server.close();

  const clips = [];
  for (const d of ['raw-client', 'raw-staff']) {
    const dir = path.join(OUT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.webm')) continue;
      const src = path.join(dir, f);
      const dst = path.join(OUT, `${d.replace('raw-', '')}.webm`);
      fs.renameSync(src, dst);
      const sec = (fs.statSync(dst).size / 1024).toFixed(0);
      clips.push(`${path.basename(dst)} (${sec} Ko)`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('\nclips enregistres : ' + (clips.join(', ') || 'AUCUN'));
  if (!clips.length) process.exit(1);
})().catch((e) => { console.error('promo-record:', e.message); process.exit(1); });
