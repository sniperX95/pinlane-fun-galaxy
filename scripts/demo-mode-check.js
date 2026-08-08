// LA DEMONSTRATION PUBLIQUE : elle tient au rechargement, et elle ne touche
// JAMAIS la production.
//
// Contexte (2026-08-08). `app.pinlane.be/demo` fait tourner la VRAIE
// application sur des donnees fabriquees. C'est l'argument le plus vendeur du
// produit, et il n'etait lie nulle part depuis la vitrine pour une seule
// raison : l'adresse ne survivait pas a un rechargement. L'application ecrit
// son chemin canonique dans l'URL a chaque changement de vue
// (`writeAppUrl(APP_ROUTE_PATH, ...)` avec APP_ROUTE_PATH = '/'), donc
// `history.replaceState` effacait `/demo` des le premier rendu. Rechargee,
// la page n'etait plus la demonstration mais la console reelle : le faux
// reseau ne se posait plus, la session bidon etait rejetee par le vrai
// serveur, et le prospect tombait sur l'ecran de code d'acces.
//
// CE QUE CE GATE VERROUILLE :
//   1. /demo reste /demo : au premier rendu, apres rechargement, apres
//      navigation interne, apres retour arriere.
//   2. Aucun code d'acces n'est demande en mode demonstration.
//   3. Le bandeau « donnees de demonstration » est present, visible et
//      permanent, et il ramene vers la vitrine.
//   4. ZERO requete vers /api/ ne quitte le navigateur - y compris une
//      TENTATIVE D'ECRITURE forcee depuis la page (POST de reservation, POST
//      d'envoi d'email). Le serveur de test compte tout ce qu'il recoit.
//   5. Aucune enseigne de client (« Fun Galaxy ») n'apparait.
//   6. La production ne bouge pas : `/` reste `/`, `/reserver` reste
//      `/reserver`.
// Puis une CONTRE-PREUVE par mutation : on retire la correction et on verifie
// que ce gate rougit.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_DEMO_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Tout ce que le serveur recoit sur /api/ PENDANT que la demonstration est a
// l'ecran est une FUITE. La surveillance se coupe le temps des pages reelles
// visitees par le scenario (/reserver, /), qui elles ont parfaitement le droit
// de parler au serveur : sans ca on compterait leur trafic legitime.
const fuites = [];
let surveille = false;
const surveiller = (etat) => { surveille = etat; };

// Le serveur de test rejoue les rewrites Vercel : /demo et /reserver -> index.html.
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const clean = url.pathname.replace(/\/+$/, '') || '/';
    if (clean.startsWith('/api/')) {
      if (surveille) fuites.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"ok":true,"fuite":true}');
      return;
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (clean === '/' || clean === '/reserver' || clean === '/demo') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  // La demonstration insiste jusqu'a 2 s pour imposer la vue staff : on la
  // laisse finir, sinon on mesure une URL intermediaire.
  await page.waitForTimeout(2600);
}

const urlOf = (page) => page.evaluate(() => ({ path: location.pathname, hash: location.hash, view: state.view }));

// Bloque le CDN externe (insights) : hors sujet et hors ligne en CI.
async function coupeCdn(page) {
  await page.route('https://cdn.vercel-insights.com/**', route => route.abort());
}

async function scenarioDemo(browser, { label }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await coupeCdn(page);
  surveiller(true);
  await boot(page, `${BASE_URL}/demo`);

  // ---- 1. L'adresse tient -------------------------------------------------
  const premier = await urlOf(page);
  ok(premier.path === '/demo', `${label} premier rendu : chemin = /demo (obtenu "${premier.path}")`);
  ok(premier.view === 'staff', `${label} premier rendu : la console est affichee (view=${premier.view})`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.waitForTimeout(2600);
  const apresRechargement = await urlOf(page);
  ok(apresRechargement.path === '/demo', `${label} RECHARGEMENT : chemin toujours /demo (obtenu "${apresRechargement.path}")`);
  ok(apresRechargement.view === 'staff', `${label} RECHARGEMENT : toujours la console (view=${apresRechargement.view})`);

  // ---- 2. Aucun code d'acces ---------------------------------------------
  const auth = await page.evaluate(() => {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return { present: false, visible: false };
    const style = getComputedStyle(overlay);
    return {
      present: true,
      visible: !overlay.classList.contains('hidden') && style.display !== 'none' && style.visibility !== 'hidden',
      locked: document.body.classList.contains('auth-locked'),
    };
  });
  ok(auth.visible === false, `${label} aucun ecran de code d'acces (overlay visible = ${auth.visible})`);
  ok(auth.locked === false, `${label} le corps n'est pas verrouille (auth-locked = ${auth.locked})`);

  // ---- 3. Le bandeau de demonstration -------------------------------------
  const bandeau = await page.evaluate(() => {
    const el = document.getElementById('pinlaneDemoBadge');
    if (!el) return { present: false };
    const style = getComputedStyle(el);
    const lien = el.querySelector('a[href]');
    return {
      present: true,
      visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.2,
      texte: (el.textContent || '').trim(),
      href: lien ? lien.getAttribute('href') : '',
      position: style.position,
    };
  });
  ok(bandeau.present === true, `${label} bandeau de demonstration present`);
  ok(bandeau.visible === true, `${label} bandeau visible`);
  ok(/d[ée]monstration/i.test(bandeau.texte || ''), `${label} le bandeau dit que ce sont des donnees de demonstration ("${(bandeau.texte || '').slice(0, 90)}")`);
  ok(/pinlane\.be/.test(bandeau.href || ''), `${label} le bandeau ramene vers la vitrine (href = "${bandeau.href}")`);
  ok(bandeau.position === 'fixed', `${label} le bandeau est permanent, pas dans le flux (position = ${bandeau.position})`);

  // ---- 4. Navigation interne, puis retour arriere -------------------------
  await page.evaluate(() => { if (typeof openStaffMenuPage === 'function') openStaffMenuPage('reservations'); });
  await page.waitForTimeout(600);
  const surResas = await urlOf(page);
  ok(surResas.path === '/demo', `${label} navigation interne (Reservations) : chemin toujours /demo (obtenu "${surResas.path}")`);
  ok(/#\/staff\//.test(surResas.hash), `${label} navigation interne : le fragment suit la page (obtenu "${surResas.hash}")`);

  await page.evaluate(() => { if (typeof openStaffMenuPage === 'function') openStaffMenuPage('clients'); });
  await page.waitForTimeout(600);
  const surClients = await urlOf(page);
  ok(surClients.path === '/demo', `${label} navigation interne (Clients) : chemin toujours /demo (obtenu "${surClients.path}")`);

  // ---- 4 bis. Le retour arriere du visiteur -------------------------------
  // Le vrai scenario : il arrive d'ailleurs, il entre dans la demonstration,
  // il fait « precedent », puis « suivant ». L'entree d'historique de la
  // demonstration doit avoir garde son chemin - c'est exactement ce que
  // `replaceState` detruisait.
  surveiller(false);
  await page.goto(`${BASE_URL}/reserver`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // AU PASSAGE, LA PREUVE QUE LA DEMONSTRATION N'A RIEN LAISSE DERRIERE ELLE.
  // On est sur une page REELLE, avec le stockage REEL : la session bidon de la
  // demonstration ne doit pas y etre. Sinon un membre du staff qui visite
  // /demo se retrouve deconnecte de sa console, et son poste repart interroger
  // l'API avec un jeton mort.
  const residu = await page.evaluate(() => {
    try {
      return {
        auth: window.localStorage.getItem('funGalaxy_auth_v1'),
        cles: Object.keys(window.localStorage),
      };
    } catch (error) { return { auth: null, cles: [] }; }
  });
  ok(!residu.auth || !/"token"\s*:\s*"demo"/.test(residu.auth),
    `la demonstration n a PAS laisse sa session dans le stockage reel (funGalaxy_auth_v1 = ${residu.auth ? String(residu.auth).slice(0, 50) : 'absent'})`);

  await page.goto(`${BASE_URL}/demo`, { waitUntil: 'domcontentloaded' });
  surveiller(true);
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.waitForTimeout(2600);

  surveiller(false);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const enArriere = await page.evaluate(() => location.pathname);
  ok(enArriere === '/reserver', `${label} RETOUR ARRIERE : on ressort de la demonstration vers la page precedente (obtenu "${enArriere}")`);

  await page.goForward({ waitUntil: 'domcontentloaded' });
  surveiller(true);
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.waitForTimeout(2600);
  const apresRetour = await urlOf(page);
  ok(apresRetour.path === '/demo', `${label} NAVIGATION AVANT : l entree d historique a garde /demo (obtenu "${apresRetour.path}")`);
  const overlayApresRetour = await page.evaluate(() => {
    const el = document.getElementById('authOverlay');
    return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  });
  ok(overlayApresRetour === false, `${label} NAVIGATION AVANT : toujours aucun code d'acces demande`);

  // ---- 5. Aucune enseigne de client --------------------------------------
  const marque = await page.evaluate(() => ({
    titre: document.title,
    corps: /fun\s*galaxy/i.test(document.body.innerText || ''),
    alts: [].some.call(document.querySelectorAll('img[alt]'), img => /fun\s*galaxy/i.test(img.getAttribute('alt') || '')),
  }));
  ok(marque.corps === false, `${label} aucune enseigne « Fun Galaxy » dans le texte affiche`);
  ok(marque.alts === false, `${label} aucune enseigne « Fun Galaxy » dans les textes alternatifs`);
  ok(/d[ée]monstration/i.test(marque.titre), `${label} le titre de l'onglet annonce la demonstration ("${marque.titre}")`);

  return page;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('\n[1] /demo : l adresse tient, le produit tourne, la marque est neutre');
    const page = await scenarioDemo(browser, { label: '' });

    // =====================================================================
    console.log('\n[2] LE RESEAU EST COUPE : rien ne peut ecrire en production');
    // =====================================================================
    // On ne se contente pas de constater qu aucun appel n a eu lieu : on FORCE
    // les deux ecritures les plus dangereuses du produit (creer une
    // reservation, envoyer un email) depuis la page elle-meme.
    const tentatives = await page.evaluate(async () => {
      const sortie = {};
      try {
        const r = await fetch('/api/public-reservations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'GATE ECRITURE', date: '2030-01-01', startTime: '10:00', pax: 4, lanes: [1] }),
        });
        sortie.reservation = await r.json();
      } catch (error) { sortie.reservation = { erreur: String(error) }; }
      try {
        const r = await fetch('/api/ops?action=sendDirectEmail', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'sendDirectEmail', to: 'gate@example.be', subject: 'GATE', body: 'GATE' }),
        });
        sortie.email = await r.json();
      } catch (error) { sortie.email = { erreur: String(error) }; }
      // XMLHttpRequest : l autre porte de sortie du navigateur.
      sortie.xhr = await new Promise(resolve => {
        try {
          const x = new XMLHttpRequest();
          x.open('POST', '/api/ops?action=sendDirectEmail');
          x.onloadend = () => resolve({ status: x.status, url: x.responseURL || '' });
          x.onerror = () => resolve({ status: 0, url: '' });
          x.send('{}');
        } catch (error) { resolve({ status: -1, url: String(error) }); }
      });
      // sendBeacon : la troisieme porte, celle qu on oublie.
      sortie.beacon = (() => {
        try { return navigator.sendBeacon('/api/ops', '{}'); } catch (error) { return 'exception'; }
      })();
      return sortie;
    });

    ok(tentatives.reservation && tentatives.reservation.fuite !== true,
      `POST /api/public-reservations : la reponse est FABRIQUEE, pas celle du serveur (${JSON.stringify(tentatives.reservation).slice(0, 90)})`);
    ok(tentatives.email && tentatives.email.fuite !== true,
      `POST /api/ops sendDirectEmail : la reponse est FABRIQUEE, pas celle du serveur (${JSON.stringify(tentatives.email).slice(0, 90)})`);
    ok(!/^https?:/.test(tentatives.xhr.url || '') || tentatives.xhr.url.startsWith('data:'),
      `XMLHttpRequest vers /api/ detourne hors du reseau (url = "${String(tentatives.xhr.url).slice(0, 60)}")`);

    await page.waitForTimeout(600);
    ok(fuites.length === 0, `ZERO requete /api/ recue par le serveur pendant toute la demonstration (recu : ${fuites.length ? fuites.join(' | ') : 'aucune'})`);

    await page.close();

    // =====================================================================
    console.log('\n[3] LA PRODUCTION NE BOUGE PAS');
    // =====================================================================
    surveiller(false);
    const prod = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await coupeCdn(prod);
    // Sans demonstration, aucun faux reseau : on rend le serveur muet pour
    // /api/ afin que la page se comporte comme un visiteur non authentifie.
    await prod.route('**/api/**', route => route.fulfill({
      status: 401, contentType: 'application/json', body: '{"ok":false,"authenticated":false}',
    }));
    await prod.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await prod.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
    await prod.evaluate(() => { setView('staff'); });
    await prod.waitForTimeout(600);
    const surRacine = await urlOf(prod);
    ok(surRacine.path === '/', `console reelle : chemin = / (obtenu "${surRacine.path}")`);
    ok(surRacine.hash.startsWith('#/staff/'), `console reelle : fragment = #/staff/... (obtenu "${surRacine.hash}")`);
    const overlayReel = await prod.evaluate(() => {
      const el = document.getElementById('authOverlay');
      return !!el && !el.classList.contains('hidden');
    });
    ok(overlayReel === true, 'console reelle SANS session : l ecran de code d acces s affiche toujours');
    const bandeauReel = await prod.evaluate(() => !!document.getElementById('pinlaneDemoBadge'));
    ok(bandeauReel === false, 'console reelle : AUCUN bandeau de demonstration');

    await prod.evaluate(() => { setView('client'); });
    await prod.waitForTimeout(500);
    const surClient = await urlOf(prod);
    ok(surClient.path === '/reserver', `parcours client : chemin = /reserver (obtenu "${surClient.path}")`);
    await prod.close();

    // =====================================================================
    console.log('\n[4] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol('  if (isDemoRoute()) pathname = DEMO_ROUTE_PATH;');
    if ((original.split(anchor).length - 1) !== 1) {
      ok(false, 'ancre de mutation introuvable ou ambigue (la correction a-t-elle bouge ?)');
    } else {
      fs.writeFileSync(APP, original.replace(anchor, toFileEol('  void DEMO_ROUTE_PATH;')));
      let mute = { path: '' };
      try {
        const mutant = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await coupeCdn(mutant);
        await boot(mutant, `${BASE_URL}/demo`);
        mute = await urlOf(mutant);
        await mutant.close();
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
      ok(mute.path !== '/demo',
        `correction retiree : l adresse retombe sur "${mute.path}" -> le gate ROUGIRAIT`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ndemo-mode-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\ndemo-mode-check: ALL OK - /demo tient au rechargement, ne demande aucun code, et ne peut rien ecrire en production.');
}

main().catch((err) => { console.error(err); process.exit(1); });
