// TROIS LIVRABLES POUR LE TEMPLATE SHOTCRAFT : captures 2x, decoupes, layout.
//
// Adapte de `video-shotcraft/assets/scripts/capture-template.mjs`. Deux ecarts
// assumes par rapport au modele fourni :
//
//   1. Playwright et non Puppeteer — deja installe dans ce depot, et c'est le
//      meme moteur ; installer une seconde bibliotheque de pilotage pour un
//      script d'assets n'apporterait rien.
//   2. Pinlane est une SPA a routage par fragment (`#/staff/<page>`) et non par
//      chemin : on navigue en cliquant le menu, comme un utilisateur.
//
// Le reste suit le modele a la lettre, y compris sa ligne rouge : les donnees
// de demonstration doivent etre en place AVANT la capture. On passe donc par
// `?demo=1`, le mode du produit qui coupe le reseau, remplit une journee
// coherente et remplace l'enseigne avant le premier rendu.
//
// Sortie, aux noms attendus par le template :
//   public/textures/live/<page>-full.png     capture pleine page, densite 2
//   public/textures/live/<page>-empty.png    meme page, elements masques
//   public/textures/live/card<N>.png         decoupes a fond transparent
//   src/aifl/live-layout.json                bbox de chaque element
//
// Usage : node scripts/promo-shotcraft-assets.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SHOT = path.join(ROOT, 'marketing/promo-video/shotcraft');
const OUT = path.join(SHOT, 'public/textures/live');
const LAYOUT = path.join(SHOT, 'src/aifl/live-layout.json');
const PORT = 4611;
const BASE = `http://127.0.0.1:${PORT}`;

// 1920x1080 en densite 2 : la valeur du template. Le plan de page 3D est
// texture avec cette image, et c'est ce qui garde le texte net sous zoom.
const VIEW = { width: 1920, height: 1080 };
const DSF = 2;
const SETTLE = 900;

// Les pages, dans le vocabulaire du template. `menu` est la cle du menu
// lateral de Pinlane ; `nom` est le prefixe de fichier attendu par les scenes.
const PAGES = [
  {
    nom: 'planning', menu: 'planning',
    // Les reservations du planning : ce sont elles qui « volent » dans le plan
    // de distribution, donc elles sortent en decoupes transparentes.
    decoupes: [{ base: 'card', sel: '.booking', max: 10, transparent: true }],
    boites: [
      { cle: 'bookings', sel: '.booking', tous: true, max: 10 },
      { cle: 'titre', sel: '.planning-title-stack' },
      { cle: 'colonnes', sel: '.lane-header', tous: true, max: 8 },
    ],
    // Planche vide : le meme planning sans ses reservations, pour que les
    // cartes aient une grille ou atterrir.
    masquerPourVide: '.booking',
  },
  {
    nom: 'dashboard', menu: 'dashboard',
    decoupes: [
      { base: 'kpi', sel: '.dash-kpi', max: 4, transparent: true },
      { base: 'donut', sel: '.dash-donut-wrap', max: 1, transparent: true },
    ],
    boites: [
      { cle: 'kpis', sel: '.dash-kpi', tous: true, max: 4 },
      { cle: 'alerte', sel: '.dash-alerts' },
    ],
  },
  {
    nom: 'reservations', menu: 'reservations',
    decoupes: [{ base: 'row', sel: '.pv2-stat', max: 4, transparent: true }],
    boites: [{ cle: 'stats', sel: '.pv2-stat', tous: true, max: 4 }],
  },
  {
    nom: 'emails', menu: 'emails',
    decoupes: [{ base: 'seq', sel: '.mk-auto-card, .mk-auto-head', max: 5, transparent: true }],
    boites: [{ cle: 'sequences', sel: '.mk-auto-desc', tous: true, max: 6 }],
  },
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
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

const RATES = [];

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF });
  // Thème clair et animations figées : une capture prise a mi-transition sort
  // a demi transparente.
  await ctx.addInitScript(() => {
    const poser = () => {
      if (!document.body) { requestAnimationFrame(poser); return; }
      const st = document.createElement('style');
      st.textContent = '*,*::before,*::after{animation-duration:0s !important;'
        + 'transition-duration:0s !important}';
      document.head.appendChild(st);
      document.documentElement.setAttribute('data-theme', 'light');
    };
    poser();
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?demo=1&v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);

  // La ligne rouge du modele : verifier que les donnees sont bien la AVANT de
  // capturer. Une page vide donne des assets inutilisables.
  const journee = await page.evaluate(() => {
    let r = [];
    try { r = state.reservations || []; } catch (e) { r = []; }
    return { resas: r.length, joueurs: r.reduce((s, x) => s + (x.pax || 0), 0) };
  });
  console.log(`journee de demonstration : ${journee.resas} réservations, ${journee.joueurs} joueurs`);
  if (journee.resas < 20) {
    console.error(`ECHEC : ${journee.resas} reservations seulement — assets inutilisables.`);
    process.exit(1);
  }

  const layout = { pageW: VIEW.width };

  const bbox = (sel, index) => page.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i || 0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height) };
  }, [sel, index]);

  for (const pg of PAGES) {
    await page.evaluate((k) => {
      const el = document.querySelector(`[data-fgx-menu-key="${k}"]`);
      if (el) el.click();
    }, pg.menu);
    await page.waitForTimeout(SETTLE + 900);

    const entree = { pageH: await page.evaluate(() => document.documentElement.scrollHeight) };
    layout[pg.nom] = entree;

    await page.screenshot({ path: path.join(OUT, `${pg.nom}-full.png`), fullPage: true });
    console.log(`  ${pg.nom}-full  (hauteur de page ${entree.pageH})`);

    entree.boxes = {};
    for (const b of pg.boites || []) {
      if (b.tous) {
        const n = await page.evaluate((s) => document.querySelectorAll(s).length, b.sel);
        const lot = [];
        for (let i = 0; i < Math.min(n, b.max || 12); i++) {
          const r = await bbox(b.sel, i);
          if (r) lot.push(r);
        }
        entree.boxes[b.cle] = lot;
        if (!lot.length) RATES.push(`${pg.nom}.${b.cle} : « ${b.sel} » ne trouve rien`);
      } else {
        const r = await bbox(b.sel, 0);
        entree.boxes[b.cle] = r;
        if (!r) RATES.push(`${pg.nom}.${b.cle} : « ${b.sel} » ne trouve rien`);
      }
    }

    for (const d of pg.decoupes || []) {
      const n = await page.evaluate((s) => document.querySelectorAll(s).length, d.sel);
      if (!n) { RATES.push(`${pg.nom} : decoupe « ${d.sel} » ne trouve rien`); continue; }
      const combien = Math.min(n, d.max || 10);
      for (let i = 0; i < combien; i++) {
        const el = page.locator(d.sel).nth(i);
        const nom = `${d.base}${i + 1}.png`;
        try {
          await el.screenshot({ path: path.join(OUT, nom), omitBackground: !!d.transparent });
        } catch (e) { RATES.push(`${pg.nom} : ${nom} non capturee (${String(e.message).slice(0, 60)})`); }
      }
      console.log(`  ${combien} decoupes « ${d.base} »`);
    }

    if (pg.masquerPourVide) {
      await page.evaluate((s) => {
        document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; });
      }, pg.masquerPourVide);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${pg.nom}-empty.png`), fullPage: true });
      await page.evaluate((s) => {
        document.querySelectorAll(s).forEach((e) => { e.style.visibility = ''; });
      }, pg.masquerPourVide);
      console.log(`  ${pg.nom}-empty`);
    }
  }

  // Gros plan a densite 4 : le template exige une capture separee pour tout
  // element vu en tres gros, sinon son texte casse sous le zoom.
  await page.evaluate(() => {
    const el = document.querySelector('[data-fgx-menu-key="planning"]');
    if (el) el.click();
  });
  await page.waitForTimeout(1600);
  const ctx4 = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 4 });
  const p4 = await ctx4.newPage();
  await p4.goto(`${BASE}/?demo=1&v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await p4.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await p4.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p4.waitForTimeout(2600);
  const cible = p4.locator('.booking').nth(0);
  if (await cible.count()) {
    await cible.screenshot({ path: path.join(OUT, 'card1-hires.png'), omitBackground: true });
    console.log('  card1-hires (densite 4)');
  } else RATES.push('card1-hires : aucune reservation a capturer');
  await ctx4.close();

  await browser.close();
  server.close();

  fs.writeFileSync(LAYOUT, JSON.stringify(layout, null, 2));
  const fichiers = fs.readdirSync(OUT);
  console.log(`\n${fichiers.length} fichiers dans ${path.relative(ROOT, OUT)}`);
  console.log(`layout : ${path.relative(ROOT, LAYOUT)}`);

  // GARDE : une decoupe transparente entierement vide passerait inapercue.
  const vides = fichiers.filter((f) => f.startsWith('card') && fs.statSync(path.join(OUT, f)).size < 3000);
  if (vides.length) RATES.push(`decoupes quasi vides : ${vides.join(', ')}`);

  if (RATES.length) { console.log('\nPROBLEMES :'); RATES.forEach((r) => console.log('  - ' + r)); process.exit(1); }
  console.log('OK : captures, decoupes et layout prets pour le template');
})().catch((e) => { console.error(e); process.exit(1); });
