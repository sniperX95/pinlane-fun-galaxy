// RENDRE AU CLIENT SON ANCIEN FORMULAIRE, EN UN CLIC.
//
// Pourquoi ce gate existe. Le parcours Pinlane s installe sur le site du centre
// A LA PLACE de leur formulaire. Le jour ou quelque chose cloche un dimanche a
// 15 h, personne ne veut chercher les identifiants WordPress de l agence, ni
// attendre qu elle reponde. Il faut un interrupteur, et il faut qu il soit sur.
//
// La regle qui rend tout ca possible tient en une phrase : L ANCIEN FORMULAIRE
// N EST JAMAIS SUPPRIME DU SITE, il est seulement MASQUE par notre script. Ce
// qu on peut cacher, on peut le remontrer ; ce qu on a supprime, il faut le
// reconstruire.
//
// Ce gate monte une fausse page de client (leur formulaire + notre script) et
// verifie les deux etats et leurs bords.
//
// LES CINQ PROPRIETES :
//
//   [A] EN MARCHE : le parcours Pinlane s affiche, l ancien formulaire est
//       masque. C est l etat normal.
//
//   [B] COUPE : l ancien formulaire revient, le cadre Pinlane disparait. C est
//       la sortie de secours, et elle doit marcher sans toucher au site.
//
//   [C] UNE PANNE NE REND PAS L ANCIEN FORMULAIRE. Revenir en arriere est une
//       DECISION. Si une coupure reseau suffisait a basculer, le site du client
//       changerait de formulaire au gre du reseau, sans que personne ne l ait
//       voulu ni ne le comprenne.
//
//   [D] L ANCIEN FORMULAIRE EST MASQUE, JAMAIS RETIRE. S il quittait le DOM, le
//       retour en arriere deviendrait une intervention dans WordPress, c est a
//       dire exactement ce qu on cherche a eviter.
//
//   [E] SANS ANCIEN FORMULAIRE DECLARE, COUPER RETIRE QUAND MEME LE CADRE. Un
//       centre qui n a rien a quoi revenir doit pouvoir eteindre le parcours.
//
//   [F] LE CENTRE SUIT LA SELECTION DEJA FAITE PAR LE VISITEUR. Un site
//       multi-centres demande une fois ou l on va et retient la reponse. Un
//       centre FIXE dans la page enverrait un visiteur de Gembloux sur le
//       planning de Libramont : mauvais horaires, mauvais tarifs, et personne
//       ne s en apercevrait avant une reservation impossible a honorer.
//
//   [G] ET IL RETOMBE SUR LE DEFAUT QUAND RIEN N A ETE CHOISI. Une selection
//       absente ou illisible ne doit pas priver le visiteur du formulaire.
//
// Usage : node scripts/embed-killswitch-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_SWITCH_PORT || 4237);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// L etat que le faux serveur renvoie : 'actif', 'coupe', ou 'panne'.
let etatServeur = 'actif';

// La page du CLIENT : son formulaire d origine, puis notre script. C est
// exactement ce qu on lui demande de coller, pas une reconstitution.
function pageClient(avecRepli) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fun Galaxy</title></head><body>
    <h1>Reserver</h1>
    <div id="gform_wrapper_1"><form><label>Ancien formulaire du site</label><input name="nom"></form></div>
    <script src="${BASE_URL}/embed.js" data-center="libramont" data-center-key="guest_selection"${avecRepli ? ' data-fallback="#gform_wrapper_1"' : ''}></script>
  </body></html>`;
}

function serveur() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/embed.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'embed.js')));
      return;
    }
    if (url.pathname === '/api/public-booking-meta') {
      if (etatServeur === 'panne') { res.writeHead(503); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, center: url.searchParams.get('center'), actif: etatServeur === 'actif' }));
      return;
    }
    if (url.pathname === '/reserver') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><title>Parcours</title><p>Parcours Pinlane</p>');
      return;
    }
    if (url.pathname === '/site' || url.pathname === '/site-sans-repli') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageClient(url.pathname === '/site'));
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

async function etatPage(page) {
  return page.evaluate(() => {
    const ancien = document.querySelector('#gform_wrapper_1');
    const cadre = document.querySelector('iframe');
    const style = ancien ? window.getComputedStyle(ancien) : null;
    return {
      ancienDansLePage: Boolean(ancien),
      ancienVisible: Boolean(ancien) && style.display !== 'none' && ancien.offsetParent !== null,
      cadre: Boolean(cadre),
      cadreSrc: cadre ? cadre.getAttribute('src') : '',
    };
  });
}

async function charger(page, chemin) {
  await page.goto(`${BASE_URL}${chemin}?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);
  return etatPage(page);
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    // =====================================================================
    console.log('[A] en marche : le parcours Pinlane remplace le formulaire');
    // =====================================================================
    etatServeur = 'actif';
    const marche = await charger(page, '/site');
    ok(marche.cadre && /\/reserver\?embed=1/.test(marche.cadreSrc),
      '[A] le parcours Pinlane est monte dans la page du client', marche.cadreSrc);
    ok(marche.ancienVisible === false,
      '[A] et l ancien formulaire est masque : le visiteur en voit UN seul');

    // =====================================================================
    console.log('\n[D] l ancien formulaire est masque, jamais retire');
    // =====================================================================
    ok(marche.ancienDansLePage === true,
      '[D] il est toujours dans la page : c est ce qui rend le retour possible sans toucher au site');

    // =====================================================================
    console.log('\n[B] coupe : l ancien formulaire revient');
    // =====================================================================
    etatServeur = 'coupe';
    const coupe = await charger(page, '/site');
    ok(coupe.ancienVisible === true,
      '[B] l ancien formulaire du client est de retour a l ecran');
    ok(coupe.cadre === false,
      '[B] et le cadre Pinlane a disparu : pas deux formulaires en meme temps');

    // =====================================================================
    console.log('\n[C] une panne ne rend PAS l ancien formulaire');
    // =====================================================================
    etatServeur = 'panne';
    const panne = await charger(page, '/site');
    ok(panne.cadre === true,
      '[C] lecture de l interrupteur en echec : le parcours reste en place');
    ok(panne.ancienVisible === false,
      '[C] et l ancien formulaire reste masque : basculer est une decision, pas un accident reseau');

    // =====================================================================
    console.log('\n[E] sans ancien formulaire declare, couper retire quand meme le cadre');
    // =====================================================================
    etatServeur = 'coupe';
    const sansRepli = await charger(page, '/site-sans-repli');
    ok(sansRepli.cadre === false,
      '[E] le cadre est retire meme quand rien n a ete declare comme repli');
    etatServeur = 'actif';
    const sansRepliActif = await charger(page, '/site-sans-repli');
    ok(sansRepliActif.cadre === true,
      '[E] et il revient des que l interrupteur est remis (le controle precedent mesure bien la coupure)');

    // =====================================================================
    console.log('\n[F] le centre suit la selection deja faite par le visiteur');
    // =====================================================================
    // On ecrit la selection AVEC LA CLE DU SITE, comme le site le ferait
    // lui-meme, puis on recharge : c est le seul moyen de prouver que les deux
    // lisent bien au meme endroit.
    etatServeur = 'actif';
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', 'Gembloux'); } catch (e) {} });
    const gembloux = await charger(page, '/site');
    ok(/center=gembloux/.test(gembloux.cadreSrc),
      '[F] un visiteur qui a choisi Gembloux ouvre le parcours de Gembloux', gembloux.cadreSrc);
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', 'Libramont'); } catch (e) {} });
    const libramont = await charger(page, '/site');
    ok(/center=libramont/.test(libramont.cadreSrc),
      '[F] et un visiteur qui a choisi Libramont, celui de Libramont', libramont.cadreSrc);

    // =====================================================================
    console.log('\n[G] et il retombe sur le defaut quand rien n a ete choisi');
    // =====================================================================
    await page.evaluate(() => { try { localStorage.removeItem('guest_selection'); } catch (e) {} });
    const sansChoix = await charger(page, '/site');
    ok(/center=libramont/.test(sansChoix.cadreSrc),
      '[G] aucune selection : le centre par defaut du bloc s applique', sansChoix.cadreSrc);
    await page.evaluate(() => { try { localStorage.setItem('guest_selection', '???'); } catch (e) {} });
    const illisible = await charger(page, '/site');
    ok(/center=libramont/.test(illisible.cadreSrc),
      '[G] une selection illisible ne prive personne de formulaire, elle est ignoree', illisible.cadreSrc);
    await page.evaluate(() => { try { localStorage.removeItem('guest_selection'); } catch (e) {} });

    if (errs.length) console.log('\nErreurs console :\n' + errs.slice(0, 5).join('\n'));
    console.log(failures ? `\n${failures} controle(s) en echec.` : '\nembed-killswitch-check: ALL OK');
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
