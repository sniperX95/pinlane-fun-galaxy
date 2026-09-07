// DANS UN CADRE QUI SUIT SON CONTENU, LA HAUTEUR NE DOIT PAS SE MORDRE LA QUEUE.
//
// Ce qui est arrive, mesure sur le site du client le 2026-09-07 : le parcours
// embarque clignotait a l ecran des activites, 279 changements de hauteur sur
// 280 images. Le corps passait de 548 a 570 px et retour, une fois par image.
// A l ecran, la page du client sautait sans arret : « ca fait epileptique ».
//
// LA CAUSE, ET ELLE EST STRUCTURELLE. Le tunnel adapte sa mise en page a la
// HAUTEUR DE LA FENETRE : sous 560 px il efface la carte « Groupe, entreprise
// ou besoin special ? », ecrite pour un telephone clavier ouvert. Dans un
// cadre, la hauteur de la fenetre EST celle du contenu. Donc : contenu court
// -> la regle s applique -> la carte disparait -> le contenu raccourcit ->
// le cadre raccourcit -> ... et dans l autre sens. Une boucle parfaite, qui
// n a besoin ni de souris ni de clic pour tourner.
//
// LA CORRECTION porte sur la REGLE, pas sur ce cas : toute adaptation a la
// hauteur de fenetre est portee sur `body:not(.embed-mode)`. Une adaptation a
// la place disponible n a aucun sens quand la place disponible est decidee par
// ce qu on y met.
//
// LES PROPRIETES :
//
//   [A] MONTAGE : le parcours est bien embarque, et sa hauteur tombe dans la
//       zone dangereuse (elle enjambe un seuil). Sans ce controle, un vert ne
//       prouverait que l absence de danger.
//
//   [B] LA HAUTEUR NE BOUGE PAS TOUTE SEULE, sans souris, sans clic.
//
//   [C] NI QUAND LA SOURIS BALAIE LES CARTES. C est le geste de la video.
//
//   [D] LA GARDE SERT A QUELQUE CHOSE : on la retire et la regle de hauteur
//       redecide dans le cadre. Selon l arithmetique du contenu ca donne un
//       clignotement ou un etat different mais stable : les deux sont des
//       defauts, et exiger le clignotement rendrait ce controle dependant d un
//       compte de pixels.
//
//   [E] ET LA MESURE SAIT VOIR UN CLIGNOTEMENT : une boucle fabriquee exprès la
//       fait rougir. Sans ce controle, [B] pourrait etre vert parce qu il ne
//       mesure rien.
//
//   Les deux mutations sont servies EN MEMOIRE : le disque n est jamais touche.
//
// Usage : node scripts/embed-hauteur-stable-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HAUTEUR_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CSS = path.join(ROOT, 'assets', 'pinlane-client.css');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return cond;
}

// La feuille servie : d origine, ou mutee en memoire pour la contre-epreuve.
let cssServi = fs.readFileSync(CSS, 'utf8');

// Une page hote de 1100 px de large : c est la largeur du bloc de reservation
// du client, et c est elle qui active la requete « min-width: 1100px ».
const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;background:#000;font-family:system-ui,sans-serif}.hote{width:1100px;margin:0 auto}</style>
</head><body>
<div class="hote"><div class="bloc-resa"></div></div>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-target=".bloc-resa"></script>
</body></html>`;

const ACTIVITES = [
  ['bowling', 'Bowling', 'bowling_lane', 'grid_bowling', null, 'par piste', 60],
  ['laser_game', 'Laser Game', 'laser_arena', 'grid_laser', null, 'par personne', 22],
  ['minigolf_blacklight', 'Minigolf Blacklight', 'soft_capacity', 'per_pax', 10, 'par personne', 45],
  ['billards', 'Billards', 'soft_capacity', 'per_unit_hour', 10, 'par table et par heure', 60],
  ['arcade_time', 'Arcades', 'bar_service_then_autonomous', 'per_pax', null, 'par personne', 30],
  ['playground', 'Playground', 'soft_capacity', 'per_pax', 12, 'par enfant', 60],
  ['duckpin_bowling', 'Duckpin Bowling', 'duckpin_lane', 'grid_bowling', null, 'par piste', 60],
  ['fun_run', 'Fun Run by PIXEL', 'soft_capacity', 'grid_fun_run', null, 'la session', 30],
].map(([id, name, resourceType, priceType, priceValue, unitLabel, defaultMinutes], i) => ({
  id, name, planned: i < 2, resourceType, priceType, priceValue, pricing: null, unitLabel,
  order: i + 1, defaultMinutes, minMinutes: defaultMinutes, maxMinutes: defaultMinutes, stepMinutes: 30,
  note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null,
}));

// Un SAMEDI, jour ouvert : un jour ferme n affiche aucune activite, et le gate
// mesurerait une page vide en croyant mesurer l ecran des activites.
const JOUR = '2026-09-12';

function meta() {
  return {
    ok: true, today: JOUR, durationOptions: [], formules: [],
    activities: ACTIVITES.map((a) => ({ ...a })),
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '24:00' }, 1: { open: '10:00', close: '24:00' }, 2: { open: '10:00', close: '24:00' }, 3: { open: '10:00', close: '24:00' }, 4: { open: '10:00', close: '24:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: JOUR, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveur() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (p) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(p)); };
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    // La feuille passe par la memoire : c est ce qui permet de muter sans
    // toucher au disque.
    if (url.pathname === '/assets/pinlane-client.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(cssServi); return; }
    if (url.pathname === '/api/public-booking-meta') return json(meta());
    if (url.pathname.startsWith('/api/')) return json({ ok: true, slots: [], suggestions: [] });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const f = path.resolve(path.join(ROOT, p));
    if (!f.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, contenu) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(contenu);
    });
  });
  return new Promise((r, j) => { srv.once('error', j); srv.listen(PORT, '127.0.0.1', () => r(srv)); });
}

// Amene le parcours a l ecran des activites, celui de la video.
async function jusquAuxActivites(page) {
  await page.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2500);
  const cadre = page.frames().find((f) => f !== page.mainFrame());
  if (!cadre) return null;
  await cadre.evaluate((jour) => { const c = document.getElementById('fDate'); if (c) { c.value = jour; c.dispatchEvent(new Event('change', { bubbles: true })); } }, JOUR);
  await page.waitForTimeout(900);
  for (let i = 0; i < 2; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await cadre.evaluate(() => { const b = document.querySelector('#clientView .step.is-current .s1-continue'); if (b) b.click(); });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1400);
  }
  await page.waitForTimeout(1200);
  return cadre;
}

// Compte les changements de hauteur du corps du cadre, image par image.
async function battements(cadre, ms) {
  return cadre.evaluate((duree) => new Promise((res) => {
    const v = [];
    const t0 = performance.now();
    const tic = () => {
      v.push(Math.max(document.body.scrollHeight, document.body.offsetHeight));
      if (performance.now() - t0 < duree) requestAnimationFrame(tic); else res(v);
    };
    requestAnimationFrame(tic);
  }), ms);
}

function verdict(suite) {
  let chg = 0;
  for (let i = 1; i < suite.length; i += 1) if (suite[i] !== suite[i - 1]) chg += 1;
  return { images: suite.length, min: Math.min(...suite), max: Math.max(...suite), changements: chg };
}

async function mesurerUnePasse(browser, avecSouris) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    const cadre = await jusquAuxActivites(page);
    if (!cadre) return { erreur: 'pas de cadre' };
    const cartes = await cadre.evaluate(() => Array.from(document.querySelectorAll('#clientView .activity-toggle'))
      .filter((x) => x.offsetParent !== null)
      .map((x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }));
    const zone = await page.evaluate(() => {
      const f = document.querySelector('iframe[src*="/reserver"]');
      const r = f.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), h: Math.round(r.height) };
    });
    if (!avecSouris) {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(500);
      return { cartes: cartes.length, hauteur: zone.h, suite: verdict(await battements(cadre, 2500)) };
    }
    const balayage = (async () => {
      for (let tour = 0; tour < 3; tour += 1) {
        for (const c of cartes) {
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.move(zone.x + c.x, zone.y + c.y, { steps: 3 });
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(70);
        }
      }
    })();
    const suite = verdict(await battements(cadre, 2500));
    await balayage;
    return { cartes: cartes.length, hauteur: zone.h, suite };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A] MONTAGE : le parcours est embarque et sa hauteur enjambe un seuil');
    // =====================================================================
    const repos = await mesurerUnePasse(browser, false);
    ok(repos.cartes >= 6,
      '[A] l ecran des activites est bien atteint', repos.cartes + ' carte(s)');
    // Le piege vit autour de 560 px : si le cadre en est loin, le controle
    // suivant ne prouverait rien.
    ok(repos.hauteur > 470 && repos.hauteur < 700,
      '[A] et la hauteur du cadre est dans la zone du seuil de 560 px', repos.hauteur + 'px');

    // =====================================================================
    console.log('');
    console.log('[B] la hauteur ne bouge pas toute seule');
    // =====================================================================
    ok(repos.suite.changements === 0,
      '[B] sans souris ni clic, la hauteur du contenu ne change pas',
      repos.suite.images + ' images, ' + repos.suite.min + '-' + repos.suite.max + ', ' + repos.suite.changements + ' changement(s)');

    // =====================================================================
    console.log('');
    console.log('[C] ni quand la souris balaie les cartes');
    // =====================================================================
    const souris = await mesurerUnePasse(browser, true);
    ok(souris.suite.changements === 0,
      '[C] la souris qui passe d une carte a l autre ne fait pas respirer la page',
      souris.suite.images + ' images, ' + souris.suite.min + '-' + souris.suite.max + ', ' + souris.suite.changements + ' changement(s)');

    // =====================================================================
    console.log('');
    console.log('[D] LE GATE SAIT-IL ROUGIR ?');
    // =====================================================================
    // DEUX CONTRE-EPREUVES, PARCE QU IL Y A DEUX CHOSES A PROUVER.
    //
    // La premiere : la garde SERT A QUELQUE CHOSE. On la retire et la regle de
    // hauteur se remet a decider dans le cadre. Selon les chiffres du contenu,
    // ca donne soit un clignotement, soit un etat different mais STABLE : les
    // deux sont des defauts, et exiger le clignotement rendrait ce controle
    // dependant d une arithmetique de pixels. Ce qui se verifie, c est que la
    // regle MORD a nouveau.
    const original = cssServi;
    const ancre = ":where(body:not(.embed-mode)) #clientView .step-foot .bespoke-entry { display: none; }";
    const present = original.split(ancre).length - 1;
    if (ok(present === 1, '[D] MONTAGE : la garde de la requete a 560 px est bien la, une seule fois', present + ' occurrence(s)')) {
      cssServi = original.split(ancre).join("#clientView .step-foot .bespoke-entry { display: none; }");
      const mute = await mesurerUnePasse(browser, false);
      cssServi = original;
      const aChange = mute.suite.changements > 6 || mute.hauteur !== repos.hauteur;
      ok(aChange,
        '[D] garde retiree : la regle de hauteur redecide dans le cadre',
        'avec la garde ' + repos.hauteur + 'px stable, sans elle ' + mute.hauteur + 'px avec ' + mute.suite.changements + ' changement(s)');
    }

    // La seconde : LA MESURE SAIT VOIR UN CLIGNOTEMENT. Sans elle, [B] pourrait
    // etre vert parce qu il ne mesure rien. On fabrique donc une boucle
    // certaine : sous 560 px, on AJOUTE de la hauteur, ce qui repasse au-dessus
    // du seuil, ce qui retire la hauteur ajoutee. Aucune arithmetique de
    // contenu ne peut la faire converger.
    // Le seuil doit etre AU-DESSUS de la hauteur courante, sinon la regle ne
    // s applique jamais et la boucle ne demarre pas : c est l erreur du premier
    // essai, ou l oscillateur restait sagement immobile et rendait un vert creux.
    const seuil = repos.hauteur + 60;
    // On AJOUTE de la marge au conteneur plutot qu une hauteur minimale a un
    // element : une hauteur minimale peut etre deja depassee et ne rien ajouter
    // du tout (premier essai : l oscillateur restait immobile et rendait un vert
    // creux), une marge s ajoute toujours. La boucle devient certaine.
    const oscillateur = original + '\n@media (max-height: ' + seuil + 'px) { body.embed-mode #clientView { padding-bottom: 300px; } }\n';
    cssServi = oscillateur;
    const boucle = await mesurerUnePasse(browser, false);
    cssServi = original;
    ok(boucle.suite.changements > 6,
      '[E] une boucle fabriquee exprès fait bien rougir la mesure de [B]',
      boucle.suite.images + ' images, ' + boucle.suite.min + '-' + boucle.suite.max + ', ' + boucle.suite.changements + ' changement(s)');

    ok(fs.readFileSync(CSS, 'utf8') === original,
      '[D] et la feuille sur le disque est intacte (mutations servies en memoire)');

    console.log('');
    console.log(failures ? failures + ' controle(s) en echec.' : 'embed-hauteur-stable-check: ALL OK');
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('FAIL  gate interrompu :', (error && error.stack) || error);
  process.exit(1);
});
