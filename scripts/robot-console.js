'use strict';
// Le robot du toucher sur la console des equipes. Banc local : les fichiers du depot, les doublures du gate staff-console-perf
// (une journee chargee, aucune base), rien ne sort : toute requete hors du banc qui n est pas un GET est coupee.
// npm run robot:console (ordinateur, 25 min environ), ROBOT_W=820 tablette, ROBOT_W=390 telephone, ROBOT_PAGES=bowling,laser pour quelques pages.
// Il trouve ce qui ne repond pas, pas ce qui repond faux : les donnees sont des doublures.
const fs = require('fs');
const http = require('http');
const path = require('path');
const WT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(WT, 'node_modules/playwright-core'));
const BROWSER = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.ROBOT_PORT || 4395);
const BASE = `http://127.0.0.1:${PORT}`;
const LARGEUR = Number(process.env.ROBOT_W || 1280);
const HAUTEUR = LARGEUR < 700 ? 844 : 900;
const OUT = process.env.ROBOT_OUT || path.join(require('os').tmpdir(), 'pinlane-robot-console');
fs.mkdirSync(OUT, { recursive: true });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SEULES = process.env.ROBOT_PAGES ? process.env.ROBOT_PAGES.split(',') : null;

// Les morceaux deja eprouves, repris tels quels.
const robot = fs.readFileSync(path.join(WT, 'scripts/robot-toucher.js'), 'utf8');
const debut = robot.indexOf('function lister() {');
const fin = robot.indexOf('(async () => {');
// eslint-disable-next-line no-eval
const { lister, poserGuet, toucher } = (0, eval)(`(function (LARGEUR, dormir) { ${robot.slice(debut, fin).replace(/844/g, String(HAUTEUR))}; return { lister, poserGuet, toucher }; })`)(LARGEUR, dormir);
const gate = fs.readFileSync(path.join(WT, 'scripts/staff-console-perf-check.js'), 'utf8').replace(/\r\n/g, '\n');
const a = gate.indexOf('function installerMock(page) {');
const b = gate.indexOf('}, { expiresAt, JOUR });\n}', a) + '}, { expiresAt, JOUR });\n}'.length;
const samedi = new Date(); samedi.setDate(samedi.getDate() + ((6 - samedi.getDay() + 7) % 7 || 7));
const JOUR = `${samedi.getFullYear()}-${String(samedi.getMonth() + 1).padStart(2, '0')}-${String(samedi.getDate()).padStart(2, '0')}`;
// eslint-disable-next-line no-eval
const installerMock = (0, eval)(`(function (JOUR) { ${gate.slice(a, b)}; return installerMock; })`)(JOUR);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const serveur = http.createServer((rq, rs) => {
  const u = new URL(rq.url, BASE);
  if (u.pathname.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{"ok":true}'); return; }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const f = path.join(WT, rel);
  if (!f.startsWith(path.resolve(WT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end(); return; }
  rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(rs);
});

async function ouvrirPage(browser, hash) {
  const ctx = await browser.newContext({ viewport: { width: LARGEUR, height: HAUTEUR }, hasTouch: LARGEUR < 700, locale: 'fr-BE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(9000);
  page.__erreurs = [];
  page.__signes = 0;
  page.on('pageerror', (e) => { const m = String(e.message || e); if (!/sandboxed and lacks/.test(m)) page.__erreurs.push(m.slice(0, 170)); });
  page.on('dialog', (d) => { page.__signes += 1; d.dismiss().catch(() => {}); });
  page.on('popup', (p) => { page.__signes += 1; p.close().catch(() => {}); });
  page.on('download', () => { page.__signes += 1; });
  // Un selecteur natif (mois, date) s ouvre hors de la page : showPicker compte comme un signe,
  // comme un dialogue (2026-11-05, « novembre 2026 » dans Reservations passait pour mort).
  await page.exposeFunction('__robotSigne', () => { page.__signes += 1; });
  await page.addInitScript(() => {
    const avant = HTMLInputElement.prototype.showPicker;
    if (typeof avant !== 'function') return;
    HTMLInputElement.prototype.showPicker = function showPicker(...args) { try { window.__robotSigne(); } catch (error) { /* rien */ } return avant.apply(this, args); };
  });
  await page.route('**/*', (route) => { const r = route.request(); if (!r.url().startsWith(BASE) && r.method() !== 'GET') return route.abort(); return route.continue(); });
  await installerMock(page);
  await page.goto(`${BASE}/${hash || ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 30000 });
  await dormir(900);
  return { ctx, page };
}

(async () => {
  await new Promise((r) => serveur.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  // Les pages du menu, telles que le menu les montre.
  const depart = await ouvrirPage(browser, '#/staff/dashboard');
  const entrees = await depart.page.evaluate(() => [...new Set([...document.querySelectorAll('[data-fgx-menu-key]')].map((e) => e.getAttribute('data-fgx-menu-key')))]);
  console.log('pages du menu', entrees.length, entrees.join(' ').slice(0, 900));
  await depart.ctx.close();
  const bilan = [];
  const pages = SEULES || entrees;
  const ecrire = () => fs.writeFileSync(path.join(OUT, `resultat-${LARGEUR}.json`), JSON.stringify(bilan, null, 1));
  const file = pages.slice();
  const travailleur = async () => {
    while (file.length) {
      const cle = file.shift();
      const hash = /^(bowling|laser|complete)$/.test(cle) ? `#/staff/planning/${cle}` : /^emails-/.test(cle) ? `#/staff/emails/${cle.slice(7)}` : `#/staff/${cle}`;
      const ligne = { page: cle, total: 0, morts: [], couverts: [], introuvables: 0, horsEcran: 0, erreurs: [] };
      const t0 = Date.now();
      let cour = null;
      try {
        cour = await ouvrirPage(browser, hash);
        await dormir(600);
        await cour.page.screenshot({ path: path.join(OUT, `${cle.replace(/[^a-z0-9-]/gi, '_')}-${LARGEUR}.png`) });
        const brutes = await cour.page.evaluate(lister);
        // Une option deja choisie (la radio cochee de son label, aria-pressed) ne change rien quand on
        // la retouche, par construction : comme le robot du formulaire, deux exemplaires par sorte,
        // ceux qui ne sont pas choisis d abord (2026-11-05, « Encre (sobre) » passait pour morte).
        const coches = await cour.page.evaluate((chemins) => chemins.map((ch) => { const n = document.querySelector(ch); return Boolean(n && n.tagName === 'LABEL' && n.control && n.control.type === 'radio' && n.control.checked); }), brutes.map((c) => c.chemin));
        brutes.forEach((c, i) => { if (coches[i]) c.choisi = true; });
        const candidates = brutes.filter((c) => c.genre !== 'ligne' && !c.ferme && !(c.lien && /^(https?:|mailto:|tel:)/.test(c.lien)));
        const parSorte = {};
        candidates.forEach((c, i) => { (parSorte[c.signature] = parSorte[c.signature] || []).push(i); });
        const gardes = new Set();
        Object.values(parSorte).forEach((ix) => ix.filter((i) => !candidates[i].choisi).concat(ix.filter((i) => candidates[i].choisi)).slice(0, 2).forEach((i) => gardes.add(i)));
        const cibles = candidates.filter((c, i) => gardes.has(i));
        ligne.total = cibles.length;
        ligne.vu = brutes.length;
        await poserGuet(cour.page);
        for (const c of cibles.slice(0, 80)) {
          let r;
          const signes = cour.page.__signes;
          try { r = await toucher(cour.page, c); } catch (err) { r = { etat: 'erreur', message: String(err.message).split('\n')[0].slice(0, 110) }; }
          if (r.etat === 'mort' && (cour.page.__signes !== signes || /^(input|textarea|select)/.test(c.signature))) r.etat = 'vivant';
          if (r.couvert && r.etat !== 'vivant') ligne.couverts.push({ s: c.signature, t: c.texte, dessus: r.dessus });
          if (r.etat === 'mort') ligne.morts.push({ g: c.genre, s: c.signature, t: c.texte, l: c.l, h: c.h });
          if (r.etat === 'introuvable') ligne.introuvables += 1;
          if (r.etat === 'hors-ecran') ligne.horsEcran += 1;
          if (r.etat === 'erreur') ligne.erreurs.push(`TOUCHER ${c.signature} : ${r.message}`);
          if (cour.page.__erreurs.length) ligne.erreurs.push(...cour.page.__erreurs.splice(0).map((e) => `${c.signature} « ${c.texte.slice(0, 24)} » : ${e}`));
          if (r.etat === 'vivant' || r.etat === 'erreur') {
            await cour.ctx.close().catch(() => {});
            cour = await ouvrirPage(browser, hash);
            await dormir(250);
            await poserGuet(cour.page);
          }
        }
      } catch (err) {
        ligne.erreurs.push(`PAGE : ${String(err.message).split('\n')[0].slice(0, 170)}`);
      }
      if (cour) await cour.ctx.close().catch(() => {});
      ligne.secondes = Math.round((Date.now() - t0) / 1000);
      bilan.push(ligne);
      ecrire();
      console.log(`${cle} : ${ligne.total} cibles (${ligne.vu || 0} vues), ${ligne.morts.length} morts, ${ligne.couverts.length} couverts, ${ligne.introuvables} introuvables, ${ligne.horsEcran} hors ecran, ${ligne.erreurs.length} erreurs, ${ligne.secondes} s`);
    }
  };
  await Promise.all([travailleur(), travailleur(), travailleur()]);
  await browser.close();
  serveur.close();
  console.log('--- MORTS');
  const resume = {};
  for (const l of bilan) for (const m of l.morts) { const k = `${m.g} ${m.s}`; (resume[k] = resume[k] || { t: m.t, pages: new Set(), taille: `${m.l}x${m.h}` }).pages.add(l.page); }
  for (const [k, v] of Object.entries(resume)) console.log(`${k} ${v.taille} « ${v.t} » ${[...v.pages].slice(0, 5).join(',')}`);
  console.log('--- COUVERTS');
  const couverts = new Set(); for (const l of bilan) for (const c of l.couverts) couverts.add(`${l.page} ${c.s} « ${c.t} » sous ${c.dessus}`);
  for (const c of couverts) console.log(c);
  console.log('--- ERREURS');
  const errs = new Map(); for (const l of bilan) for (const e of l.erreurs) { const k = e.replace(/\d+/g, '#'); if (!errs.has(k)) errs.set(k, `${l.page} ${e}`); }
  for (const e of errs.values()) console.log(e);
  console.log('--- FIN');
  process.exit(bilan.some((l) => l.morts.length || l.couverts.length || l.erreurs.length) ? 1 : 0);
})().catch((e) => { console.error('ERREUR', e.stack || e.message); process.exit(1); });
