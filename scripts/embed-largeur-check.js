// LE PARCOURS EMBARQUE N EST PAS UN ENCART : IL PREND LA PAGE.
//
// Movsar, le 2026-09-07, apres avoir regarde l embed sur telephone : « c est
// juste un espace dedie donc on se retrouve sur certains modeles de telephone
// a devoir basculer de gauche a droite pour tout voir [...] non, faut que ce
// soit libre », et « ya un fond un peu neon qui fait remarquer direct que le
// truc est ancre dans un espace rectangulaire, c est moche, pas pro ».
//
// LES DEUX MESURES QUI LUI ONT DONNE RAISON. Sur la vraie page du client, dans
// un ecran de 320 px, le cadre ne faisait que 244 px, pose a 38 px du bord :
// le conteneur du site porte un rembourrage lateral prevu pour du texte, et le
// parcours s y retrouvait a l etroit. Et `#clientView` peignait son propre
// fond opaque, donc un rectangle net au milieu de la page du client.
//
// LES PROPRIETES :
//
//   [A] MONTAGE : la page hote enferme bien le cadre (son conteneur a du
//       rembourrage lateral) et le parcours se sait embarque. Sans ce
//       controle, un vert ne prouverait que l absence de conteneur.
//
//   [B] SUR TELEPHONE, LE CADRE PREND TOUTE LA LARGEUR DE L ECRAN, a chaque
//       taille d une matrice de telephones reels, et ni la page hote ni le
//       parcours ne glissent de gauche a droite.
//
//   [C] LE PARCOURS NE PEINT AUCUN FOND en mode embarque : ce qui se voit
//       derriere lui est le fond du site, donc aucun rectangle.
//
//   [D] AU-DELA DE 720 px, LA COLONNE DU SITE EST RESPECTEE : une ligne de
//       texte pleine largeur ne se lit pas, et sortir du gabarit d un site sur
//       grand ecran serait une intrusion, pas un service.
//
//   [E] LA CONTRE-EPREUVE : on retire la mise en pleine largeur du script
//       d installation, servi en memoire, et [B] doit rougir.
//
// Usage : node scripts/embed-largeur-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_LARGEUR_PORT || 4248);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EMBED = path.join(ROOT, 'embed.js');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return cond;
}

// Le script d installation servi : d origine, ou mute EN MEMOIRE pour la
// contre-epreuve. Le disque n est jamais touche.
let embedServi = fs.readFileSync(EMBED, 'utf8');

// La page hote IMITE le site du client : un conteneur avec du rembourrage
// lateral (mesure reelle : 38 px de chaque cote dans un ecran de 320 px) et
// un fond qui n est pas celui du parcours. C est cette page qui a revele les
// deux defauts.
const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#14121c;font-family:system-ui,sans-serif}
.container{width:100%;max-width:1100px;margin:0 auto;padding:0 12%;box-sizing:border-box}
h2{color:#fff;font-size:15px;margin:14px 0}</style>
</head><body>
<div class="container"><h2>Reservez votre venue</h2><div class="bloc-resa"></div></div>
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
    if (url.pathname === '/embed.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(embedServi); return; }
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


// Une matrice de telephones REELS, pas des largeurs rondes choisies pour
// arranger la mesure.
const TELEPHONES = [
  ['iPhone SE', 320, 568], ['Galaxy S8', 360, 740], ['iPhone 12 mini', 375, 812],
  ['iPhone 14', 390, 844], ['Pixel 7', 412, 915], ['iPhone 14 Pro Max', 430, 932],
  ['petite tablette', 600, 960],
];
const GRANDS = [['tablette', 768, 1024], ['13 pouces', 1280, 800], ['16 pouces', 1728, 1117]];

async function mesurer(browser, largeur, hauteur) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/host.html`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1800);
  const hote = await page.evaluate(() => {
    const doc = document.documentElement;
    const f = document.querySelector("iframe");
    const conteneur = document.querySelector(".container");
    const b = f ? f.getBoundingClientRect() : null;
    const style = conteneur ? getComputedStyle(conteneur) : null;
    return {
      vue: doc.clientWidth,
      pageDeborde: doc.scrollWidth - doc.clientWidth,
      cadre: b ? { l: Math.round(b.width), x: Math.round(b.left) } : null,
      rembourrage: style ? Math.round(parseFloat(style.paddingLeft) || 0) : 0,
    };
  });
  const cadre = page.frames().find((f) => f !== page.mainFrame());
  const dedans = cadre ? await cadre.evaluate(() => {
    const cv = document.getElementById("clientView");
    const cs = cv ? getComputedStyle(cv) : null;
    const cb = getComputedStyle(document.body);
    return {
      embarque: document.body.classList.contains("embed-mode"),
      deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fondVue: cs ? cs.backgroundImage + " | " + cs.backgroundColor : "",
      fondCorps: cb.backgroundImage + " | " + cb.backgroundColor,
    };
  }) : null;
  await ctx.close();
  return { hote, dedans };
}

// Transparent au sens strict : aucune image de fond, et une couleur a alpha 0.
const transparent = (valeur) => valeur.indexOf("none |") === 0 && valeur.indexOf("rgba(0, 0, 0, 0)") > 0;

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log("[A] MONTAGE : la page hote enferme bien le cadre");
    const temoin = await mesurer(browser, 390, 844);
    ok(temoin.hote.rembourrage > 20, "le conteneur de la page hote a du rembourrage lateral", temoin.hote.rembourrage + "px");
    ok(Boolean(temoin.dedans && temoin.dedans.embarque), "le parcours se sait embarque (body.embed-mode)");

    console.log("");
    console.log("[B] sur telephone, le cadre prend TOUTE la largeur de l ecran");
    for (const [nom, w, h] of TELEPHONES) {
      const m = await mesurer(browser, w, h);
      const c = m.hote.cadre;
      const plein = Boolean(c) && c.x <= 1 && c.l >= m.hote.vue - 2 && c.l <= m.hote.vue + 1;
      ok(plein, nom + " (" + w + "px) : le cadre couvre l ecran", c ? c.l + "px a x=" + c.x + " pour " + m.hote.vue + "px" : "cadre absent");
      ok(m.hote.pageDeborde <= 0, nom + " : la page ne glisse pas de gauche a droite", m.hote.pageDeborde + "px");
      ok(Boolean(m.dedans) && m.dedans.deborde <= 0, nom + " : le parcours ne deborde pas dans son cadre", m.dedans ? m.dedans.deborde + "px" : "cadre absent");
    }

    console.log("");
    console.log("[C] le parcours ne peint AUCUN fond : c est celui du site qui se voit");
    ok(transparent(temoin.dedans.fondVue), "aucun fond sur #clientView", temoin.dedans.fondVue);
    ok(transparent(temoin.dedans.fondCorps), "aucun fond sur le corps", temoin.dedans.fondCorps);

    console.log("");
    console.log("[D] au-dela de 720 px, la colonne du site est respectee");
    for (const [nom, w, h] of GRANDS) {
      const m = await mesurer(browser, w, h);
      const c = m.hote.cadre;
      ok(Boolean(c) && c.x > 1 && c.l < m.hote.vue, nom + " (" + w + "px) : le cadre reste dans la colonne du site", c ? c.l + "px a x=" + c.x + " pour " + m.hote.vue + "px" : "cadre absent");
      ok(m.hote.pageDeborde <= 0, nom + " : la page ne glisse pas de gauche a droite", m.hote.pageDeborde + "px");
    }

    console.log("");
    console.log("[E] LE GATE SAIT-IL ROUGIR ?");
    const original = embedServi;
    const ancre = "if (!frame.parentNode || window.innerWidth > 720) return;";
    const present = original.split(ancre).length - 1;
    if (ok(present === 1, "MONTAGE : la mise en pleine largeur est bien la, une seule fois", present + " occurrence(s)")) {
      embedServi = original.split(ancre).join("return;");
      const mute = await mesurer(browser, 390, 844);
      embedServi = original;
      const c = mute.hote.cadre;
      ok(Boolean(c) && c.l < mute.hote.vue - 20, "mise en pleine largeur retiree : le cadre redevient une colonne etroite", c ? c.l + "px pour " + mute.hote.vue + "px" : "cadre absent");
    }
    ok(fs.readFileSync(EMBED, "utf8") === original, "et le script sur le disque est intact (mutation servie en memoire)");
  } finally {
    await browser.close();
    srv.close();
  }
  if (failures) { console.error("embed-largeur-check: FAIL " + failures + " controle(s)"); process.exit(1); }
  console.log("");
  console.log("embed-largeur-check: ALL OK");
}

main().catch((error) => { console.error(error); process.exit(1); });
