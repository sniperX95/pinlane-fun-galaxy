// LE FORMULAIRE EN GRAND ET LA PHOTO A SA HAUTEUR (2026-11-13).
//
// Ansar, devant le formulaire Pinlane pose sur fungalaxy.be dans la colonne de 1 100 px de leur page :
// « moi jle voulais comme ici » (la page Pinlane seule), puis « limage jaimerais bien quelle soit meme
// hauteur que [...] le formulaire [...] pour que ce soit symetrique ». Ce gate joue le VRAI formulaire
// (fungalaxy.html, servi par scripts/dev-tunnel-server.js, fausses donnees) dans un vrai navigateur :
//   [A] page seule, 1280, 1440 et 1920 px : sur l ecran de la date, la photo commence au haut du
//       formulaire et finit a son bas (a 2 px pres) ;
//   [B] embarque dans une page hote dont la colonne fait 1 100 px (comme fungalaxy.be) : le cadre prend
//       toute la largeur de l ecran, et la page hote ne glisse pas de gauche a droite ;
//   [C] embarque : la photo suit le formulaire, l etiquette du centre s aligne sur le bord gauche du
//       formulaire, et aucune ligne du formulaire ne depasse 1 280 px ;
//   [D] le formulaire change de hauteur (la fenetre change de largeur) : la photo le suit.
// --contre-preuves : deux mutations servies en memoire (le disque n est jamais touche) doivent rougir,
// la mesure de la photo retiree, et le seuil de 720 px remis dans embed.js.
'use strict';
['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE', 'TELEGRAM_SUJETS'].forEach((cle) => { delete process.env[cle]; });
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_SYMETRIE_PORT || 4294);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const banc = require('./dev-tunnel-server.js');

const MUTATIONS = {
  'photo-pas-mesuree': { fichier: '/assets/fungalaxy-booking.js', de: 'calePhotos.observe(corps);', vers: 'void corps;' },
  'seuil-720-remis': { fichier: '/embed.js', de: 'if (!frame.parentNode) return;', vers: 'if (!frame.parentNode || window.innerWidth > 720) return;' },
};

// La page hote imite fungalaxy.be : une colonne centree de 1 100 px, le script pose dedans.
const HOTE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#000;font-family:system-ui,sans-serif}#booking{padding:48px 0}.container{width:100%;max-width:1100px;margin:0 auto;padding:0 15px;box-sizing:border-box}</style>
</head><body><section id="booking"><div class="container"><h2 style="color:#fff">Réservez</h2></div></section>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#booking .container"></script></body></html>`;

let mutation = null;
async function contexte(browser, largeur) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(`${BASE_URL}/hote.html`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOTE }));
  if (mutation) {
    const m = MUTATIONS[mutation];
    await ctx.route((url) => url.pathname === m.fichier, async (route) => {
      const texte = fs.readFileSync(path.join(ROOT, m.fichier), 'utf8');
      if (!texte.includes(m.de)) { await route.fulfill({ status: 500, body: `ancre introuvable : ${m.de}` }); return; }
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: texte.replace(m.de, m.vers) });
    });
  }
  return ctx;
}

// La photo et le formulaire de l ecran de la date, mesures dans le document qui les porte.
const MESURE = () => {
  const scene = document.querySelector('.fg-scene.is-active[data-scene="date"]');
  if (!scene) return null;
  const photo = scene.querySelector('.fg-art');
  const corps = scene.querySelector('.fg-scene__body');
  const visibles = [...corps.children].filter((e) => e.offsetParent !== null && e.offsetHeight > 0);
  const r = (e) => e.getBoundingClientRect();
  // Les entrees animees (translate) se mesurent une fois finies : on lit les positions de mise en page.
  const haut = (e) => { let y = 0; let n = e; while (n && n !== document.body) { y += n.offsetTop; n = n.offsetParent; } return y; };
  const centre = document.querySelector('.fg-centre--cadre');
  return {
    photo: { haut: haut(photo), bas: haut(photo) + photo.offsetHeight, largeur: Math.round(r(photo).width) },
    formulaire: { haut: haut(visibles[0]), bas: haut(visibles[visibles.length - 1]) + visibles[visibles.length - 1].offsetHeight, gauche: Math.round(r(visibles[0]).left) },
    centre: centre && getComputedStyle(centre).display !== 'none' ? Math.round(r(centre).left) : null,
    bloc: Math.round(Math.max(r(photo).right, ...visibles.map((e) => r(e).right)) - Math.min(r(photo).left, ...visibles.map((e) => r(e).left))),
  };
};

async function jouer() {
  let echecs = 0;
  const ok = (cond, label) => { if (!mutation || !cond) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${mutation ? `[${mutation}] ` : ''}${label}`); if (!cond) echecs += 1; return cond; };
  const serveur = banc.createServer({ port: PORT });
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const attendreFormulaire = async (cible) => {
    await cible.waitForSelector('.fg-scene.is-active[data-scene="date"] .fg-title', { timeout: 30000 });
    await cible.waitForTimeout(1600);
  };
  try {
    for (const largeur of [1280, 1440, 1920]) {
      const ctx = await contexte(browser, largeur);
      const page = await ctx.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(e.message));
      await page.goto(`${BASE_URL}/fungalaxy`, { waitUntil: 'domcontentloaded' });
      await attendreFormulaire(page);
      const m = await page.evaluate(MESURE);
      ok(m && Math.abs(m.photo.haut - m.formulaire.haut) <= 2 && Math.abs(m.photo.bas - m.formulaire.bas) <= 2,
        `[A] page seule ${largeur} px : la photo va du haut au bas du formulaire (photo ${m && m.photo.haut}-${m && m.photo.bas}, formulaire ${m && m.formulaire.haut}-${m && m.formulaire.bas})`);
      if (largeur === 1440) {
        // [D] la fenetre retrecit : le formulaire grandit (ses colonnes passent a la ligne), la photo suit.
        await page.setViewportSize({ width: 960, height: 900 });
        await page.waitForTimeout(900);
        const n = await page.evaluate(MESURE);
        ok(n && n.formulaire.bas !== m.formulaire.bas && Math.abs(n.photo.bas - n.formulaire.bas) <= 2,
          `[D] a 960 px, le formulaire change de hauteur et la photo le suit (formulaire ${m && m.formulaire.bas} puis ${n && n.formulaire.bas}, photo ${n && n.photo.bas})`);
      }
      ok(erreurs.length === 0, `page seule ${largeur} px : aucune erreur JavaScript (${erreurs.join(' | ') || 'aucune'})`);
      await ctx.close();
    }

    for (const largeur of [1280, 1920]) {
      const ctx = await contexte(browser, largeur);
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/hote.html`, { waitUntil: 'domcontentloaded' });
      const iframe = await page.waitForSelector('#booking iframe', { timeout: 30000 });
      const cadre = await iframe.contentFrame();
      await attendreFormulaire(cadre);
      await page.waitForTimeout(600);
      const hote = await page.evaluate(() => {
        const f = document.querySelector('#booking iframe').getBoundingClientRect();
        return { x: Math.round(f.left), largeur: Math.round(f.width), ecran: document.documentElement.clientWidth, glisse: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      ok(hote.x <= 1 && Math.abs(hote.largeur - hote.ecran) <= 1, `[B] embarque ${largeur} px : le cadre prend toute la largeur de l ecran (x=${hote.x}, ${hote.largeur} px pour ${hote.ecran})`);
      ok(hote.glisse <= 0, `[B] embarque ${largeur} px : la page hote ne glisse pas de gauche a droite (${hote.glisse} px)`);
      const m = await cadre.evaluate(MESURE);
      ok(m && Math.abs(m.photo.haut - m.formulaire.haut) <= 2 && Math.abs(m.photo.bas - m.formulaire.bas) <= 2,
        `[C] embarque ${largeur} px : la photo va du haut au bas du formulaire (photo ${m && m.photo.haut}-${m && m.photo.bas}, formulaire ${m && m.formulaire.haut}-${m && m.formulaire.bas})`);
      ok(m && m.centre !== null && Math.abs(m.centre - m.formulaire.gauche) <= 2, `[C] embarque ${largeur} px : l etiquette du centre s aligne sur le formulaire (${m && m.centre} et ${m && m.formulaire.gauche})`);
      ok(m && m.bloc <= 1281, `[C] embarque ${largeur} px : le formulaire et sa photo tiennent dans 1 280 px (${m && m.bloc} px)`);
      await ctx.close();
    }
  } catch (e) {
    ok(false, `deroulement : ${String(e.message).split('\n')[0]}`);
  } finally {
    await browser.close();
    await new Promise((r) => serveur.close(r));
  }
  return echecs;
}

(async () => {
  if (process.argv.includes('--contre-preuves')) {
    let ratees = 0;
    for (const nom of Object.keys(MUTATIONS)) {
      mutation = nom;
      const echecs = await jouer();
      console.log(`${echecs > 0 ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${echecs > 0 ? `rougit (${echecs})` : 'reste verte'}`);
      if (echecs === 0) ratees += 1;
    }
    process.exit(ratees ? 1 : 0);
  }
  const echecs = await jouer();
  console.log(echecs ? `\nFAIL ${echecs}` : '\nOK');
  process.exit(echecs ? 1 : 0);
})();
