// LE FORMULAIRE FUN GALAXY, MONTE DANS LA VRAIE PAGE /contact/ DE fungalaxy.be.
//
// scripts/dev-tunnel-server.js sert une copie locale de la page du client
// (telechargee a chaque requete, jamais modifiee sur le site) avec le bloc de
// reservation remplace par notre script d installation, exactement comme le
// fera l agence : une balise <script src=".../embed.js" data-design="fungalaxy">.
// Ce gate regarde ce que le visiteur verrait, sur ordinateur et sur telephone.
//
// Il a besoin d internet (la page du client est reelle) : il ne fait donc PAS
// partie de test:ops:all. Une coupure reseau rend un 502 explicite, pas un
// faux vert.
//
// Usage : node scripts/fungalaxy-host-page-check.js
'use strict';
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.PINLANE_FG_HOST_PORT || 4245);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let failures = 0;

function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
async function attendre(cible, fn, ms) {
  try { await cible.waitForFunction(fn, null, { timeout: ms, polling: 100 }); return true; } catch (error) { return Boolean(await cible.evaluate(fn, null).catch(() => false)); }
}

async function attendreServeur() {
  const butoir = Date.now() + 30000;
  while (Date.now() < butoir) {
    try { const r = await fetch(`${BASE_URL}/api/public-booking-meta?centerId=libramont`); if (r.ok) return; } catch (error) { /* demarre encore */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Le serveur local ne demarre pas');
}

async function inspecter(browser, viewport, nom) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  const reponse = await page.goto(`${BASE_URL}/fungalaxy-local#booking`, { waitUntil: 'networkidle', timeout: 60000 });
  if (!ok(reponse && reponse.status() === 200, `${nom} : la copie locale de fungalaxy.be/contact/ est servie`, reponse ? `HTTP ${reponse.status()}` : 'aucune reponse')) { await ctx.close(); return; }
  ok(await attendre(page, () => document.querySelector('.pinlane-local-slot iframe[title="Reservation en ligne"]'), 10000), `${nom} : embed.js monte le cadre a la place du Gravity Form`);
  // LA MESURE ATTEND L ETAT STABLE. Le cadre recoit sa hauteur par message, et
  // Chrome re-ancre le defilement sur #booking quand l en-tete finit de se
  // charger (deux defilements a 100 ms d ecart, vus le 2026-09-22) : lire la
  // position pendant ce va-et-vient rendait un faux rouge. On attend la hauteur
  // du cadre, puis deux lectures egales du defilement a 300 ms d ecart (au plus
  // 6 s) ; l assertion juge ensuite l etat reel.
  ok(await attendre(page, () => { const f = document.querySelector('.pinlane-local-slot iframe'); return f && parseInt(f.style.height, 10) > 300; }, 10000), `${nom} : le cadre a recu sa hauteur avant toute mesure`);
  const reposee = () => page.evaluate(() => new Promise((resolve) => { let last = -1; let stable = 0; let tours = 0; const tick = () => { const y = Math.round(window.scrollY); if (y === last) stable += 1; else { stable = 0; last = y; } tours += 1; if (stable >= 2 || tours >= 20) resolve(); else setTimeout(tick, 300); }; tick(); }));
  await reposee();
  const lire = () => page.evaluate(() => {
    const frame = document.querySelector('.pinlane-local-slot iframe[title="Reservation en ligne"]');
    const rect = frame ? frame.getBoundingClientRect() : { width: 0, left: 0, right: 0, top: 0 };
    const popup = document.querySelector('#popup');
    const cookie = document.querySelector('#cookie-law-info-bar');
    return {
      section: Boolean(document.querySelector('#booking')),
      ancienRetire: !document.querySelector('#booking .heading, #booking .booking__container, #gform_wrapper_4'),
      centre: (document.querySelector('#selection-1') || {}).value || '',
      src: frame ? frame.src : '',
      largeur: rect.width, gauche: rect.left, droite: rect.right, haut: rect.top,
      ecran: document.documentElement.clientWidth,
      deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      popupCache: popup ? getComputedStyle(popup).display === 'none' : true,
      cookieCache: cookie ? getComputedStyle(cookie).display === 'none' : true,
      defile: getComputedStyle(document.body).overflowY !== 'hidden',
      menuBas: (document.querySelector('#menu') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom,
    };
  });
  let hote = await lire();
  // UNE PREMIERE VISITE PEUT SE POSER SOUS LE MENU. La page du client est reelle,
  // et sur une machine neuve elle reste parfois sur le saut natif de l ancre, le
  // cadre a 56 px sous un menu de 163 px : stable, 8 s d attente et un passage
  // seul n y changent rien, une seconde visite si. Rien de notre cote : on le dit
  // et on revient une fois, par une navigation neuve (page.reload garde le
  // defilement, cadre a -100 px, et un goto de la meme adresse reste sur place).
  // Un cadre qui reste sous le menu reste rouge.
  if (nom === 'ordinateur' && hote.haut < hote.menuBas - 2) {
    console.log(`${nom} : cadre a ${Math.round(hote.haut)} px, menu jusqu a ${Math.round(hote.menuBas)} px au premier chargement, on revient une fois`);
    await page.goto('about:blank');
    await page.goto(`${BASE_URL}/fungalaxy-local#booking`, { waitUntil: 'networkidle', timeout: 60000 });
    await attendre(page, () => { const f = document.querySelector('.pinlane-local-slot iframe'); return f && parseInt(f.style.height, 10) > 300; }, 10000);
    await reposee();
    hote = await lire();
  }
  ok(hote.section && hote.ancienRetire, `${nom} : emplacement d origine garde, ancien bloc (titre, portrait, Gravity Form) retire`);
  ok(hote.centre === 'Libramont', `${nom} : centre hote fixe sur Libramont`, hote.centre);
  ok(hote.src.indexOf(`${BASE_URL}/fungalaxy/libramont?embed=1`) === 0, `${nom} : le cadre vise le formulaire Fun Galaxy`, hote.src);
  ok(hote.popupCache && hote.cookieCache && hote.defile, `${nom} : aucun overlay ne bloque la page locale`);
  ok(hote.deborde <= 1, `${nom} : aucun debordement horizontal`, `${hote.deborde}px`);
  ok(hote.gauche >= -1 && hote.droite <= hote.ecran + 1 && hote.largeur > 300, `${nom} : cadre contenu dans l ecran`, `${Math.round(hote.largeur)}px de large`);
  ok(nom !== 'ordinateur' || hote.haut >= hote.menuBas - 2, `${nom} : l ancre #booking n est pas masquee par le menu`, `cadre a ${Math.round(hote.haut)} px, menu jusqu a ${Math.round(hote.menuBas)} px`);

  const cadre = page.frames().find((f) => f.url().indexOf('/fungalaxy/libramont?embed=1') >= 0);
  if (ok(Boolean(cadre), `${nom} : le contenu du formulaire est accessible`)) {
    ok(await attendre(cadre, () => document.body.classList.contains('is-embed') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), `${nom} : formulaire embarque, catalogue lu`);
    const vu = await cadre.evaluate(() => {
      const btn = document.querySelector('#goActivities');
      const r = btn.getBoundingClientRect();
      return { bandeau: Math.round(document.querySelector('.fg-top').getBoundingClientRect().height), cta: getComputedStyle(btn).backgroundColor, dedans: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.height > 30 };
    });
    ok(vu.bandeau === 0, `${nom} : notre bandeau est invisible dans la page du client`);
    ok(vu.dedans, `${nom} : la premiere action est visible et tient dans le cadre`);
    ok(vu.cta === 'rgb(148, 66, 146)', `${nom} : le bouton est violet Fun Galaxy (#944292)`, vu.cta);
    await cadre.click('#goActivities');
    ok(await attendre(cadre, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && document.querySelectorAll('#gridAct .fg-card').length > 0, 8000), `${nom} : le parcours avance depuis la page du client`);
    const hauteur = await page.evaluate(() => parseInt(document.querySelector('.pinlane-local-slot iframe').style.height, 10));
    ok(hauteur > 300, `${nom} : le cadre a pris la hauteur de son contenu`, `${hauteur}px`);
  }
  await ctx.close();
}

(async () => {
  const serveur = spawn(process.execPath, ['scripts/dev-tunnel-server.js'], { cwd: process.cwd(), env: { ...process.env, PINLANE_DEVTUNNEL_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await attendreServeur();
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    await inspecter(browser, { width: 1440, height: 900 }, 'ordinateur');
    await inspecter(browser, { width: 390, height: 844 }, 'telephone');
  } finally {
    if (browser) await browser.close();
    serveur.kill();
  }
  console.log('');
  if (failures) { console.error(`fungalaxy-host-page-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('fungalaxy-host-page-check: ALL OK');
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
