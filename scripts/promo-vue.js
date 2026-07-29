// CAPTURE LES VUES LARGES DU PRODUIT (pas les details).
//
// La crea « avant / apres » a besoin d'une image qui porte a elle seule la
// moitie « apres » : le planning complet, ses huit pistes remplies. Un detail
// ne suffit pas — c'est la DENSITE qui prouve qu'un centre tourne.
//
// Difference avec promo-details.js : on ne vise pas un petit noeud a fort
// grossissement mais un grand bloc, donc la densite de capture est plus basse
// (2 au lieu de 4) pour ne pas fabriquer des images de 10 000 px inutiles.
// La regle reste la meme : la vue ne sera jamais AGRANDIE au montage, donc on
// capture au moins la largeur qu'elle occupera dans le film.
//
// Usage : node scripts/promo-vue.js [--dsf 2] [--theme light]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const DSF = Number(arg('dsf', 2));
const THEME = arg('theme', 'light');
const ZOOM = Number(arg('zoom', 1));
const CSS_W = 2560, CSS_H = 1440;
const PORT = 4609;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts/promo-clips', 'vues-' + THEME);

// Largeur minimale exigee : le film fait 2560 px CSS rendus a 1,5, et la vue
// occupe au plus 92 % du cadre. En dessous, on l'agrandirait.
const LARGEUR_MIN = Math.round(2560 * 0.92 * 1.5);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

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

const INIT = ([zoom, theme]) => {
  const poser = () => {
    if (!document.body) { requestAnimationFrame(poser); return; }
    const st = document.createElement('style');
    st.textContent = `body { zoom: ${zoom} }
      *, *::before, *::after { animation-duration:0s !important; transition-duration:0s !important }`;
    (document.head || document.documentElement).appendChild(st);
    const t = () => {
      if (document.documentElement.getAttribute('data-theme') !== theme) {
        document.documentElement.setAttribute('data-theme', theme);
      }
    };
    t();
    new MutationObserver(t).observe(document.documentElement, { attributes: true });
  };
  poser();
};

const RATES = [];
const FAITS = [];

async function capturerVue(page, cle, selecteur, opts = {}) {
  const box = await page.evaluate(([sel, marge]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 100) return null;
    return {
      x: Math.max(0, Math.round(r.left - marge)),
      y: Math.max(0, Math.round(r.top - marge)),
      w: Math.round(Math.min(r.width + marge * 2, window.innerWidth - Math.max(0, r.left - marge))),
      h: Math.round(Math.min(r.height + marge * 2, window.innerHeight - Math.max(0, r.top - marge))),
      hors: r.bottom > window.innerHeight || r.right > window.innerWidth,
    };
  }, [selecteur, opts.marge === undefined ? 10 : opts.marge]);

  if (!box) { RATES.push(`${cle} : « ${selecteur} » introuvable ou trop petit`); console.log(`   MANQUE ${cle}`); return; }
  const fichier = path.join(OUT, cle + '.png');
  await page.screenshot({ path: fichier, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const px = { w: Math.round(box.w * DSF), h: Math.round(box.h * DSF) };
  FAITS.push({ cle, cssW: box.w, cssH: box.h, w: px.w, h: px.h, ratio: +(box.w / box.h).toFixed(3) });
  const assez = px.w >= LARGEUR_MIN;
  console.log(`   ${cle} : ${box.w}x${box.h} css -> ${px.w}x${px.h} px  ${assez ? 'ok' : 'TROP PETITE'}`
    + (box.hors ? '  (coupee par le viewport)' : ''));
  if (!assez) RATES.push(`${cle} : ${px.w} px de large, il en faut ${LARGEUR_MIN} pour ne pas l'agrandir`);
  if (box.hors) RATES.push(`${cle} : le bloc depasse du viewport, la vue est tronquee`);
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DSF });
  await ctx.addInitScript(INIT, [ZOOM, THEME]);
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/?demo=1&v=vue-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);

  const journee = await page.evaluate(() => {
    let r = [];
    try { r = state.reservations || []; } catch (e) { r = []; }
    return { resas: r.length, joueurs: r.reduce((s, x) => s + (x.pax || 0), 0) };
  });
  console.log(`journee : ${journee.resas} réservations, ${journee.joueurs} joueurs`);
  if (journee.resas < 20) RATES.push(`journee trop pauvre : ${journee.resas} reservations`);

  console.log('VUES LARGES');
  // Le planning entier : c'est LUI qui porte la moitie « apres » du film.
  await capturerVue(page, 'vue-planning', '.planning-board, .staff-planning, .planning-grid', { marge: 0 });
  // Le conteneur de carte n'existe pas dans cette mise en page : on ne capture
  // pas une cible qu'on ne sait pas viser, on la retire.

  const go = async (k) => {
    await page.evaluate((key) => {
      const el = document.querySelector(`[data-fgx-menu-key="${key}"]`);
      if (el) el.click();
    }, k);
    await page.waitForTimeout(1600);
  };
  await go('dashboard');
  await capturerVue(page, 'vue-dashboard', '.dash-kpis, .dash-grid, main', { marge: 0 });

  await browser.close();
  server.close();

  const table = {};
  FAITS.forEach((f) => { table[f.cle] = { w: f.w, h: f.h, ratio: f.ratio, cssW: f.cssW }; });
  fs.writeFileSync(path.join(OUT, 'vues.js'),
    '// Genere par scripts/promo-vue.js — ne pas editer a la main.\n'
    + 'window.PROMO_VUES = ' + JSON.stringify(table, null, 2) + ';\n');

  console.log(`\n${FAITS.length} vues dans ${path.relative(ROOT, OUT)}`);
  if (RATES.length) { console.log('\nPROBLEMES :'); RATES.forEach((r) => console.log('  - ' + r)); process.exit(1); }
  console.log('OK : vues assez larges pour ne jamais etre agrandies');
})().catch((e) => { console.error(e); process.exit(1); });
