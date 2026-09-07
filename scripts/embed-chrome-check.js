// CHEZ LE CLIENT, ON NE REMET PAS NOTRE ENSEIGNE SUR LA SIENNE.
//
// Le parcours embarque s affiche DANS la page du centre. Cette page porte deja
// son logo, son menu et ses contacts. Si le cadre affiche les NOTRES par dessus,
// le visiteur voit deux logos et deux menus a quelques centimetres, et surtout
// un menu qui navigue DANS LE CADRE : cliquer « Activites » remplace le
// formulaire de reservation par une autre page de Pinlane, a l interieur du bloc
// du client, sans que rien ne l explique. C est un piege, pas une decoration.
//
// La regle existait deja, avec cette raison ecrite noir sur blanc dans le CSS
// (« le site du gerant porte deja sa marque et ses contacts »), mais elle etait
// enfermee dans une requete media telephone. Elle ne s appliquait donc pas la ou
// le client la verrait en premier : sur son ordinateur. Ce gate empeche qu elle
// y retourne.
//
// LES PROPRIETES :
//
//   [A] MONTAGE : le cadre est bien en mode embarque, et le parcours a bien un
//       en-tete quand il vit SEUL. Sans ces deux controles, un vert ne
//       prouverait que l absence d en-tete, pas son masquage.
//
//   [B] EN MODE EMBARQUE, NOTRE EN-TETE EST INVISIBLE A TOUTE LARGEUR. Le
//       telephone n est pas un cas particulier : c est la meme raison partout.
//
//   [C] ET LA SOUS-BARRE DU TUNNEL AUSSI. Elle repete les memes contacts.
//
// Usage : node scripts/embed-chrome-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_CHROME_PORT || 4241);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Les largeurs qui comptent : le telephone, la tablette, l ordinateur. La
// derniere est celle qui manquait, et c est la plus visible chez un client.
const LARGEURS = [
  { nom: 'telephone', width: 390, height: 844 },
  { nom: 'tablette', width: 900, height: 1000 },
  { nom: 'ordinateur', width: 1440, height: 1000 },
];

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return cond;
}

const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:sans-serif}header.site{height:56px;background:#1b1b2f}main{padding:12px}</style>
</head><body>
<header class="site"></header>
<main><h1>Reservez</h1><div class="bloc-resa"></div></main>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-target=".bloc-resa"></script>
</body></html>`;

function metaPayload() {
  return {
    ok: true,
    today: '2026-09-12',
    durationOptions: [],
    formules: [],
    activities: [{
      id: 'bowling', name: 'Bowling', planned: true, resourceType: 'bowling_lane',
      priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste',
      order: 1, defaultMinutes: 60, minMinutes: 60, maxMinutes: 60, stepMinutes: 30,
      note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: null,
    }],
    center: {
      id: 'libramont', status: 'active',
      // L IDENTITE EST CE QUI REMPLIT L EN-TETE : sans elle, l en-tete se rend
      // vide, sa hauteur tombe a zero, et le gate se declarerait satisfait sur
      // un en-tete qui n a jamais existe. Le montage [A] existe pour attraper
      // exactement ca.
      name: 'Fun Galaxy Libramont',
      city: 'Libramont',
      identity: {
        siteLinks: [
          { label: 'Activités', url: 'https://fungalaxy.be/activites/' },
          { label: 'Événements', url: 'https://fungalaxy.be/evenements/' },
          { label: 'Formules', url: 'https://fungalaxy.be/formules/' },
          { label: 'Contact', url: 'https://fungalaxy.be/contact/' },
        ],
      },
      defaultSchedule: { regular: { 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: '2026-09-12', open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveur() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (payload) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (url.pathname === '/api/public-booking-meta') return json(metaPayload());
    if (url.pathname.startsWith('/api/')) return json({ ok: true, slots: [], suggestions: [] });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/reserver' || p.startsWith('/reserver/')) p = '/index.html';
    const filePath = path.resolve(path.join(ROOT, p));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// CE QU ON LIT DANS LE CADRE. On mesure ce qui SE VOIT (rectangle a l ecran),
// pas seulement une propriete CSS : un en-tete en display:block mais de hauteur
// nulle ne generait personne, et un en-tete « masque » qui occupe 56 px si.
const LIRE = function () {
  const entete = document.querySelector('header');
  const sousBarre = document.querySelector('#clientView .tunnel-underbar');
  const boite = function (el) {
    if (!el) return { present: false, hauteur: 0, affichage: '' };
    const r = el.getBoundingClientRect();
    return { present: true, hauteur: Math.round(r.height), affichage: window.getComputedStyle(el).display };
  };
  return {
    modeEmbarque: document.body.classList.contains('embed-mode'),
    entete: boite(entete),
    sousBarre: boite(sousBarre),
    // Un menu dans le cadre navigue DANS le cadre : c est le piege a nommer.
    liensDeMenu: entete ? entete.querySelectorAll('a').length : 0,
  };
};

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A] MONTAGE : le parcours a bien un en-tete quand il vit seul');
    // =====================================================================
    // Sans ce controle, tout le reste passerait au vert sur un parcours qui n a
    // simplement jamais eu d en-tete.
    const seul = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const pageSeule = await seul.newPage();
    await pageSeule.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    await pageSeule.waitForTimeout(1500);
    const vuSeul = await pageSeule.evaluate(LIRE);
    ok(vuSeul.modeEmbarque === false,
      '[A] hors cadre, le parcours n est PAS en mode embarque');
    ok(vuSeul.entete.present && vuSeul.entete.hauteur > 20,
      '[A] et il porte bien un en-tete visible, avec son menu',
      `hauteur ${vuSeul.entete.hauteur}px, ${vuSeul.liensDeMenu} lien(s)`);
    await seul.close();

    // =====================================================================
    console.log('');
    console.log('[B] et [C] : dans le cadre du client, notre chrome disparait, A TOUTE LARGEUR');
    // =====================================================================
    for (const taille of LARGEURS) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await browser.newContext({ viewport: { width: taille.width, height: taille.height } });
      // eslint-disable-next-line no-await-in-loop
      const page = await ctx.newPage();
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2000);
      const cadre = page.frames().find((f) => f !== page.mainFrame());
      if (!ok(Boolean(cadre), `[A] ${taille.nom} : le cadre est monte dans la page du client`)) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.close();
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const vu = await cadre.evaluate(LIRE);
      ok(vu.modeEmbarque === true,
        `[A] ${taille.nom} MONTAGE : le parcours se sait embarque (body.embed-mode)`);
      ok(vu.entete.hauteur === 0,
        `[B] ${taille.nom} (${taille.width}px) : notre en-tete ne prend aucune place chez le client`,
        `hauteur ${vu.entete.hauteur}px, affichage ${vu.entete.affichage}`);
      ok(vu.sousBarre.hauteur === 0,
        `[C] ${taille.nom} : la sous-barre du tunnel non plus`,
        `hauteur ${vu.sousBarre.hauteur}px`);
      // eslint-disable-next-line no-await-in-loop
      await ctx.close();
    }

    console.log('');
    console.log(failures ? `${failures} controle(s) en echec.` : 'embed-chrome-check: ALL OK');
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
