// TROIS LIVRABLES POUR LE TEMPLATE SHOTCRAFT : captures 2x, decoupes, layout.
//
// Adapte de `video-shotcraft/assets/scripts/capture-template.mjs`. Deux ecarts
// assumes par rapport au modele fourni :
//
//   1. Playwright et non Puppeteer : deja installe dans ce depot, et c'est le
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
    // `menu: null` : le planning EST la vue par defaut, il n'y a pas de cle de
    // menu pour lui. Il doit donc etre capture en premier, avant tout clic.
    // `pleinePage` : la planche sur laquelle les reservations atterrissent. Le
    // template descendait jusqu'a 3782 px parce que sa grille de projets
    // s'etalait sur toute cette hauteur. Mesure faite ici : nos 62 creneaux
    // tiennent dans 610 px. On cadre donc 1900 px : planning entier plus la
    // liste des reservations dessous : et la plongee se recale dessus.
    nom: 'projects', menu: null, hauteurCible: 1746, pleinePage: 1900,
    // Les reservations du planning : ce sont elles qui « volent » dans le plan
    // de distribution, donc elles sortent en decoupes transparentes.
    decoupes: [
      // `etaler` : prendre les dix reservations REPARTIES sur toute la journee,
      // pas les dix premieres dans l'ordre du DOM. Les dix premieres vivent
      // toutes dans les deux premieres pistes, en haut a gauche ; le plan de
      // distribution les fait tomber sur toute la page, il lui faut donc des
      // positions etalees, sinon la moitie droite du planning reste vide.
      { base: 'card', sel: '.booking', max: 10, transparent: true, etaler: true },
      // Les scenes attendent trois decoupes nommees : la barre laterale et deux
      // puces qui flottent au-dessus du plan de page.
      { base: 'nav', sel: '.planning-title-stack', max: 1, transparent: true, sansIndex: true },
      // La puce « recherche » est le CHAMP DE RECHERCHE, pas une reservation :
      // pointee sur `.booking` elle sortait le meme fichier que card1.png (md5
      // identique), et le plan de fin affichait deux fois la meme reservation.
      { base: 'float-search', sel: 'input[placeholder*="Recherch"]', max: 1, transparent: true, sansIndex: true },
      { base: 'float-stats', sel: '.lane-header', max: 1, transparent: true, sansIndex: true },
    ],
    boites: [
      { cle: 'bookings', sel: '.booking', tous: true, max: 10, etaler: true },
      { cle: 'titre', sel: '.planning-title-stack' },
      // Le champ de recherche du planning : le plan de distribution y fait
      // taper une requete, il lui faut sa position reelle.
      { cle: 'recherche', sel: 'input[placeholder*="Recherch"]' },
      { cle: 'colonnes', sel: '.lane-header', tous: true, max: 8 },
    ],
    // Planche vide : le meme planning sans ses reservations, pour que les
    // cartes aient une grille ou atterrir.
    masquerPourVide: '.booking',
  },
  // Le casting suit la FORME, pas le nom. Les trois scenes ci-dessous empilent
  // des blocs larges et bas (1104x224 et 1104x95 dans le template d'origine) :
  // leur donner des cartes KPI cote a cote produisait une image qui ne
  // ressemblait a rien une fois l'animation appliquee. Un inventaire des formes
  // du produit a designe les bons elements.
  {
    // Les lignes de detail qui tombent une par une = les cartes du Terrain.
    // Jusqu'au 2026-09-25 c'etait la liste des arrivees (lignes de 1073x84) ;
    // Terrain range les memes dossiers en trois colonnes, ses cartes sont
    // plus etroites et plus hautes : regarder l'image rendue avant de publier.
    nom: 'detail', menu: 'arrivals', hauteurCible: 1172,
    decoupes: [{ base: 'kpi', sel: '.terrain-card', max: 4, transparent: true }],
    boites: [{ cle: 'kpis', sel: '.terrain-card', tous: true, max: 5 }],
  },
  {
    // La pile qui s'empile = les evenements du mois, 24 lignes de 1073x91.
    //
    // Premier choix : les panneaux d'automatisation email. Rejete apres avoir
    // REGARDE l'image rendue : la journee de demonstration n'a aucun historique
    // d'emails, les panneaux affichaient « 0 recu · 0 en attente · 0 envoye ».
    // Un plan de pub qui montre des zeros dit que le produit ne fait rien.
    // La page Evenements n'existe plus (fondue dans Terrain le 2026-09-25) :
    // la pile reprend les cartes du Terrain, meme remarque de forme.
    nom: 'papers', menu: 'arrivals', hauteurCible: 1489,
    decoupes: [{ base: 'paper', sel: '.terrain-card', max: 5, attendus: 5, transparent: true }],
    boites: [{ cle: 'stats', sel: '.terrain-card', tous: true, max: 5 }],
  },
  {
    // Le document qui s'ecrit tout seul = le tableau de bord qui se remplit,
    // carte par carte.
    nom: 'wbr', menu: 'dashboard', hauteurCible: 1080,
    decoupes: [{ base: 'seq', sel: '.dash-card', max: 2, transparent: true }],
    boites: [
      { cle: 'sequences', sel: '.dash-card', tous: true, max: 6 },
      // « Prochaines arrivees » a ete retiree de la Vue d'ensemble le
      // 2026-08-14 : ce selecteur ne trouvait plus rien et l'extraction serait
      // sortie une liste vide sans le dire. Les lignes d'alerte jouent le meme
      // role dans le plan (un document qui se remplit ligne apres ligne).
      { cle: 'lignes', sel: '.dash-alert-row', tous: true, max: 3 },
      // Les quatre indicateurs du haut : le plan les allume un par un.
      { cle: "kpis", sel: ".dash-kpi", tous: true, max: 4 },
    ],
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

// `k` indices repartis sur `n` elements, premier et dernier inclus. Avec n=38 et
// k=10 : 0, 4, 8, 12, 16, 20, 24, 28, 32, 37, soit une reservation par tranche
// de la journee, donc reparties sur toutes les pistes.
// GARDE : la texture doit contenir EXACTEMENT la hauteur de page annoncee.
//
// Rien ne signalait qu'une capture de 1080 px etait publiee sous une hauteur de
// page de 1746 : le film l'etirait silencieusement, et les elements superposes
// (reservation heros, lignes qui tombent) derivaient de plus en plus de leur
// emplacement dans l'image. Un ecart d'un pixel arrete maintenant le script.
// Taille reelle d'un PNG, en pixels. En-tete PNG : largeur et hauteur en
// gros-boutiste aux octets 16..23.
const taillePng = (nom) => {
  const png = fs.readFileSync(path.join(OUT, nom));
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
};

const verifierTexture = (nom, hAttendue) => {
  const { w, h } = taillePng(nom);
  if (w !== VIEW.width * DSF || h !== Math.round(hAttendue * DSF)) {
    RATES.push(`${nom} : ${w}x${h} px alors que la page annonce`
      + ` ${hAttendue} CSS en densite ${DSF} (attendu ${VIEW.width * DSF}x${Math.round(hAttendue * DSF)})`);
  }
};

const etaler = (n, k) => (k >= n
  ? Array.from({ length: n }, (_, i) => i)
  : Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1))));

// (Il y avait ici une liste de noms de groupes appliquee par rang aux cartes.
// Elle avait l'air d'une donnee et n'en etait pas : le nom affiche n'etait pas
// celui de la carte. Les libelles se lisent maintenant dans le DOM.)

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
    console.error(`ECHEC : ${journee.resas} reservations seulement : assets inutilisables.`);
    process.exit(1);
  }

  const layout = { pageW: VIEW.width };

  // LE FOND DU FILM VIENT DU PRODUIT.
  //
  // La camera cadre un point de la page ; des qu'elle vise pres d'un bord, elle
  // montre du hors-page. Le template rendait cela INVISIBLE en peignant son
  // arriere-plan de la couleur exacte du fond de ses captures. Avec le creme du
  // template derriere une page Pinlane claire, le hors-page devenait une bande
  // grise franche : c'est ce qu'on voyait au premier rendu.
  const fond = await page.evaluate(() => {
    const lis = (el) => (el ? getComputedStyle(el).backgroundColor : '');
    const transparent = (c) => !c || c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);
    for (const el of [document.body, document.documentElement]) {
      const c = lis(el);
      if (!transparent(c)) return c;
    }
    return 'rgb(255,255,255)';
  });
  console.log(`fond de page mesure : ${fond}`);

  const bbox = (sel, index) => page.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i || 0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height) };
  }, [sel, index]);

  for (const pg of PAGES) {
    if (pg.menu) {
      // GARDE : une cle de menu qui ne correspond a rien laissait la page
      // precedente a l'ecran, et rien ne le signalait. Les quatre pages du
      // film seraient sorties identiques.
      const ok = await page.evaluate((k) => {
        const el = document.querySelector(`[data-fgx-menu-key="${k}"]`);
        if (!el) return false;
        el.click();
        return true;
      }, pg.menu);
      if (!ok) { RATES.push(`${pg.nom} : aucun menu « ${pg.menu} »`); continue; }
      await page.waitForTimeout(SETTLE + 900);
    }

    const entree = { pageH: await page.evaluate(() => document.documentElement.scrollHeight) };
    layout[pg.nom] = entree;

    // Recadre a la hauteur du template quand la page est plus longue ; sinon
    // pleine page (une page plus COURTE que la cible serait etiree).
    const hReelle = entree.pageH;
    const hCible = pg.hauteurCible && pg.hauteurCible < hReelle ? pg.hauteurCible : hReelle;
    entree.pageH = hCible;
    // `clip` SANS `fullPage` est borne au viewport : demander 1746 px de haut
    // rendait une image de 1080 px, que le film etirait ensuite sur 1746 ,
    // d'ou un decalage croissant entre les elements superposes et la texture
    // (119 px sur la reservation heros). `fullPage: true` fait porter le
    // decoupage sur la page entiere.
    await page.screenshot({ path: path.join(OUT, `${pg.nom}-full.png`),
      fullPage: true, clip: { x: 0, y: 0, width: VIEW.width, height: hCible } });
    verifierTexture(`${pg.nom}-full.png`, hCible);
    console.log(`  ${pg.nom}-full  (hauteur de page ${entree.pageH})`);

    entree.boxes = {};
    for (const b of pg.boites || []) {
      if (b.tous) {
        const n = await page.evaluate((s) => document.querySelectorAll(s).length, b.sel);
        const lot = [];
        const pris = b.etaler ? etaler(n, b.max || 12) : etaler(Math.min(n, b.max || 12), Math.min(n, b.max || 12));
        for (const i of pris) {
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

    // --- CE QUE LA RESERVATION AFFICHE VRAIMENT ----------------------------
    //
    // Les libelles du film venaient d'une liste ecrite dans ce script et
    // appliquee PAR RANG (`TITRES[i % TITRES.length]`). Rien ne garantissait que
    // « Ecole Saint-Joseph » soit le nom de la carte qu'on met en evidence a
    // l'ecran : c'etait de la decoration qui avait l'air d'une donnee.
    //
    // On lit donc le DOM. Le film peut alors DIRE ce que l'image MONTRE : c'est
    // ce qui manquait a la narration : « huit pistes, quarante-huit
    // reservations » pendant qu'un gros plan designe une carte precise.
    if (pg.nom === 'projects') {
      entree.reservations = await page.evaluate(() => {
        // LA PISTE SE LIT DANS LA COLONNE, PAS DANS UN ATTRIBUT.
        //
        // Movsar : « au debut ca dit piste 6, alors que c'est piste 5, l'endroit
        // ou le motion design montre la carte. » Verifie : `data-booking-lane`
        // est DEJA en base 1, et j'y ajoutais 1 : toutes les cartes etaient
        // decalees d'une colonne. Une base d'indexation se devine ; une position
        // a l'ecran se mesure. On cherche donc l'en-tete de colonne dont la
        // bande horizontale contient le centre de la reservation, et on lit SON
        // libelle. Le chiffre dit par la voix est alors celui que le spectateur
        // lit au-dessus de la carte, par construction.
        const colonnes = [...document.querySelectorAll('.lane-header')].map((el) => {
          const r = el.getBoundingClientRect();
          const n = (el.textContent.match(/(\d+)\s*$/) || [])[1];
          return { x: r.x + window.scrollX, w: r.width, piste: n ? Number(n) : null };
        });
        return [...document.querySelectorAll('.booking')].map((el) => {
        const lis = (s) => {
          const n = el.querySelector(s);
          return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
        };
        const r = el.getBoundingClientRect();
        const centre = r.x + window.scrollX + r.width / 2;
        const col = colonnes.find((c) => centre >= c.x && centre <= c.x + c.w);
        const plage = (el.getAttribute('data-range') || '').replace(/\s+/g, ' ').trim();
        // Les noms de classe viennent d'une SONDE du DOM rendu, pas d'un fichier
        // d'artefact : ma premiere version cherchait `.booking-meta`, qui
        // n'existe pas dans cette vue : les 62 cartes sont sorties sans effectif
        // et la garde les a toutes signalees.
        const pax = (lis('.bk-pax').match(/(\d+)/) || [])[1];
        return {
          x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
          nom: lis('.booking-name'),
          heure: plage.split('-')[0].trim(),
          plage,
          pax: pax ? Number(pax) : null,
          duree: lis('.bk-dur'),
          formule: lis('.b-tag'),
          piste: col ? col.piste : null,
          // On garde l'attribut pour pouvoir CHIFFRER l'ecart : c'est lui qui
          // avait mis « piste 6 » a la place de « piste 5 ».
          lane: Number(el.getAttribute('data-booking-lane')),
        };
        });
      });
      const creux = entree.reservations.filter((b) => !b.nom || !b.heure || !b.pax).length;
      if (creux) RATES.push(`projects : ${creux} reservation(s) sans nom, heure ou effectif`);
      const sansCol = entree.reservations.filter((b) => b.piste === null).length;
      if (sansCol) RATES.push(`projects : ${sansCol} reservation(s) sous aucune colonne : la piste serait inventee`);
      const ecarts = entree.reservations.filter((b) => b.piste !== null && b.piste !== b.lane).length;
      if (ecarts) {
        console.log(`  ${ecarts}/${entree.reservations.length} reservations ou data-booking-lane`
          + ` ne vaut PAS la colonne affichee : c'est la geometrie qui fait foi`);
      }
      console.log(`  ${entree.reservations.length} reservations lues (nom, heure, effectif, piste)`);
    }

    for (const d of pg.decoupes || []) {
      const n = await page.evaluate((s) => document.querySelectorAll(s).length, d.sel);
      if (!n) { RATES.push(`${pg.nom} : decoupe « ${d.sel} » ne trouve rien`); continue; }
      const combien = Math.min(n, d.max || 10);
      // L'index DOM et le numero de fichier sont deux choses distinctes : avec
      // `etaler`, card3.png est la 9e reservation du DOM. Le fichier suit le
      // RANG dans la selection, pour rester aligne sur `layout.projects.cards`.
      const pris = d.etaler ? etaler(n, combien) : etaler(combien, combien);
      for (let rang = 0; rang < pris.length; rang++) {
        const i = pris[rang];
        const el = page.locator(d.sel).nth(i);
        const nom = d.sansIndex ? `${d.base}.png` : `${d.base}${rang + 1}.png`;
        try {
          await el.screenshot({ path: path.join(OUT, nom), omitBackground: !!d.transparent, timeout: 6000 });
        } catch (e) {
          // REPLI PAR RECADRAGE. `element.screenshot` attend que l'element soit
          // stable et visible, et rend la main sur timeout : la barre laterale
          // et les onglets, hauts dans une page de 5282 px, echouaient ainsi.
          // Un recadrage sur leur bbox n'attend rien et donne la meme image ;
          // seule la transparence est perdue, sans consequence sur un element
          // pose sur un fond opaque.
          const r = await bbox(d.sel, i);
          if (r && r.w > 4 && r.h > 4) {
            await page.screenshot({ path: path.join(OUT, nom),
              clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
            console.log(`    ${nom} par recadrage (element instable)`);
          } else RATES.push(`${pg.nom} : ${nom} non capturee (${String(e.message).slice(0, 50)})`);
        }
      }
      console.log(`  ${combien} decoupes « ${d.base} »`);
      // Le template attend un nombre FIXE de fichiers par serie (paper1..paper5).
      // S'il en manque, il reste des <Img> pointant vers un fichier absent ,
      // Remotion echoue au rendu. On complete en rejouant les premieres.
      if (!d.sansIndex && d.attendus && combien < d.attendus) {
        for (let i = combien; i < d.attendus; i++) {
          const source = path.join(OUT, `${d.base}${(i % combien) + 1}.png`);
          if (fs.existsSync(source)) {
            fs.copyFileSync(source, path.join(OUT, `${d.base}${i + 1}.png`));
            console.log(`    ${d.base}${i + 1}.png complete depuis ${path.basename(source)}`);
          }
        }
      }
    }

    // --- LA PAGE LONGUE POUR LE PLAN DE DISTRIBUTION ------------------------
    //
    // Ce plan descend jusqu'a cy=3032 : le template y arrivait en PEIGNANT une
    // extension de papier vide sous sa capture, garnie de 16 cartes dupliquees.
    // Notre planning fait 5282 px de haut pour de vrai : on lui donne donc une
    // vraie page de 3782 px (10h -> ~19h, huit pistes) et de vraies
    // reservations. Rien de peint, rien de duplique.
    if (pg.pleinePage) {
      const hL = Math.min(pg.pleinePage, hReelle);
      const toutes = await page.evaluate(([sel, hMax]) => [...document.querySelectorAll(sel)]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
            w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((r) => r.y + r.h <= hMax && r.w > 8), [pg.masquerPourVide, hL]);
      const pris = etaler(toutes.length, Math.min(26, toutes.length));
      entree.pleine = { pageH: hL, cartes: pris.map((i, rang) => ({ file: `cardf${rang + 1}.png`, ...toutes[i] })) };
      for (let rang = 0; rang < pris.length; rang++) {
        const nom = `cardf${rang + 1}.png`;
        const r = toutes[pris[rang]];
        try {
          await page.locator(pg.masquerPourVide).nth(pris[rang]).screenshot({
            path: path.join(OUT, nom), omitBackground: true, timeout: 6000,
          });
        } catch (e) {
          await page.screenshot({ path: path.join(OUT, nom),
            clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
        }
      }
      console.log(`  ${pris.length} decoupes « cardf » (page longue ${hL} px)`);
    }

    if (pg.masquerPourVide) {
      await page.evaluate((s) => {
        document.querySelectorAll(s).forEach((e) => { e.style.visibility = 'hidden'; });
      }, pg.masquerPourVide);
      await page.waitForTimeout(400);
      // La planche vide est celle sur laquelle les cartes atterrissent : elle
      // suit la hauteur de la page longue, pas celle du plan large.
      const hVide = (entree.pleine && entree.pleine.pageH) || hCible;
      await page.screenshot({ path: path.join(OUT, `${pg.nom}-empty.png`),
        fullPage: true, clip: { x: 0, y: 0, width: VIEW.width, height: hVide } });
      verifierTexture(`${pg.nom}-empty.png`, hVide);
      await page.evaluate((s) => {
        document.querySelectorAll(s).forEach((e) => { e.style.visibility = ''; });
      }, pg.masquerPourVide);
      console.log(`  ${pg.nom}-empty`);
    }
  }

  // --- LE HEROS : la reservation que le plan d'ouverture montre en tres gros --
  //
  // Il se choisit par la geometrie, pas au hasard : parmi les dix retenues, la
  // plus HAUTE (une reservation de 2 h porte deux lignes de texte lisibles) et
  // la plus PROCHE du centre de page. Le centre compte : la camera cadre le
  // point (cx, cy) au milieu de l'image, donc un heros collé au bord gauche
  // fait apparaitre le vide hors-page : c'est exactement ce qui ratait au
  // premier rendu.
  const cartes = layout.projects.boxes.bookings;
  const score = (r) => Math.abs(r.x + r.w / 2 - VIEW.width / 2) - r.h * 6;
  let heros = 0;
  cartes.forEach((r, i) => { if (score(r) < score(cartes[heros])) heros = i; });
  const heroBox = cartes[heros];
  console.log(`  heros : reservation ${heros + 1} (${heroBox.w}x${heroBox.h} a x=${heroBox.x})`);

  // Densite du gros plan : plus elle est haute, plus la camera peut zoomer sans
  // etirer l'image. On tente 6, puis on retombe a 4 si Chromium refuse la
  // surface (1920x1746 en densite 6 = 120 Mpx).
  let densite = 0;
  for (const d of [6, 4]) {
    const c = await browser.newContext({ viewport: VIEW, deviceScaleFactor: d });
    const p = await c.newPage();
    try {
      await p.goto(`${BASE}/?demo=1&v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await p.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await p.waitForTimeout(2600);
      const n = await p.evaluate(() => document.querySelectorAll('.booking').length);
      const idx = etaler(n, 10)[heros];
      await p.locator('.booking').nth(idx).screenshot({
        path: path.join(OUT, 'card-hero-hires.png'), omitBackground: true, timeout: 20000,
      });
      densite = d;
      await c.close();
      break;
    } catch (e) {
      console.log(`  densite ${d} refusee (${String(e.message).slice(0, 60)})`);
      await c.close();
    }
  }
  if (!densite) RATES.push('card-hero-hires : aucune densite n\'a abouti');
  else console.log(`  card-hero-hires (densite ${densite}, ${heroBox.w * densite} px de large)`);

  await browser.close();
  server.close();

  // --- mise en forme au schema attendu par les scenes ---------------------
  const bo = (p, c) => ((layout[p] && layout[p].boxes && layout[p].boxes[c]) || []);
  const liste = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
  const borne = (r, hMax) => ({ ...r, y: Math.min(r.y, Math.max(0, hMax - r.h)) });

  const finales = { pageW: VIEW.width, bg: fond };

  // projects : les reservations deviennent les « cartes » qui volent.
  const hP = layout.projects.pageH;

  // Le texte se raccroche par la GEOMETRIE, pas par le rang : les bbox et les
  // textes sortent du meme DOM, donc leurs coordonnees absolues coincident, et
  // les deux listes n'ont ni le meme ordre ni la meme longueur (`etaler`).
  // Un rang commun aurait ete une hypothese de plus a tenir a jour.
  const RESAS = layout.projects.reservations || [];
  const texteDe = (r) => {
    const b = RESAS.find((z) => z.x === r.x && z.y === r.y);
    if (!b) { RATES.push(`reservation a (${r.x},${r.y}) : aucun texte lu dans le DOM`); return {}; }
    return { title: b.nom, heure: b.heure, plage: b.plage, pax: b.pax,
      duree: b.duree, formule: b.formule, piste: b.piste };
  };

  const bookings = bo('projects', 'bookings').map((r, i) => ({
    file: `card${i + 1}.png`, ...borne(r, hP), ...texteDe(r),
  }));
  finales.projects = {
    pageH: hP,
    // Le plan d'ouverture lit ces trois valeurs au lieu de les deviner :
    // quelle reservation est le heros, quelle image la montre en gros, et
    // jusqu'ou la camera peut zoomer avant d'etirer cette image (regle dure :
    // on reduit toujours une image, on ne l'agrandit jamais).
    heroIndex: heros,
    heroHires: 'card-hero-hires.png',
    heroZoomMax: densite || 1,
    // CE QUE LE PLAN D'OUVERTURE MET EN EVIDENCE, en toutes lettres. La scene
    // l'affiche et la narration le DIT : une seule source, donc l'image et la
    // voix ne peuvent plus se contredire.
    hero: texteDe(heroBox),
    // La page longue et ses 26 reservations, pour le plan de distribution.
    fullPageH: (layout.projects.pleine && layout.projects.pleine.pageH) || hP,
    cardsFull: ((layout.projects.pleine && layout.projects.pleine.cartes) || []).map((c) => ({
      ...c, ...texteDe(c),
    })),
    search: liste(layout.projects.boxes.recherche)[0] || { x: 1074, y: 40, w: 180, h: 30 },
    header: liste(layout.projects.boxes.titre)[0] || { x: 0, y: 0, w: VIEW.width, h: 61 },
    cards: bookings,
    sections: bo('projects', 'colonnes').slice(0, 5).map((r, i) => ({
      text: `Piste ${i + 1}`, ...borne(r, hP),
    })),
  };

  // detail : les KPI du tableau de bord tiennent le role des lignes de detail.
  const hD = layout.detail.pageH;
  finales.detail = {
    pageH: hD,
    rows: bo('detail', 'kpis').map((r) => borne(r, hD)),
    expPageH: hD,
  };

  // float : les puces qui flottent au-dessus du plan de page.
  finales.float = [
    { file: 'float-search.png', ...(liste(layout.projects.boxes.titre)[0] || { x: 60, y: 120, w: 350, h: 55 }) },
    { file: 'float-stats.png', ...(bo('projects', 'colonnes')[0] || { x: 60, y: 200, w: 251, h: 49 }) },
    { file: 'nav.png', ...(liste(layout.projects.boxes.titre)[0] || { x: 0, y: 0, w: 350, h: 55 }) },
  ];

  // wbr : les descriptions de sequences font les blocs du document.
  const hW = layout.wbr.pageH;
  const blocs = [...bo('wbr', 'sequences'), ...bo('wbr', 'lignes')]
    .map((r) => ({ ...borne(r, hW), tag: 'p' }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  finales.wbr = {
    pageH: hW,
    blocks: blocs.length ? blocs : [{ x: 576, y: 189, w: 400, h: 28, tag: 'p' }],
    leftRail: { x: 0, y: 61, w: 208, h: hW - 61 },
    kpis: bo("wbr", "kpis").map(function(r){return borne(r, hW);}),
    rightRail: { x: VIEW.width - 288, y: 61, w: 288, h: hW - 61 },
  };

  // papers : les statistiques de reservations s'empilent.
  const hS = layout.papers.pageH;
  const stats = bo('papers', 'stats').map((r) => borne(r, hS));
  finales.papers = {
    pageH: hS,
    cards: stats.length >= 5 ? stats.slice(0, 5)
      : [...stats, ...Array.from({ length: 5 - stats.length }, (_, k) => stats[k % Math.max(1, stats.length)])].slice(0, 5),
  };

  // GARDE : toute cle lue par les scenes doit exister et etre non vide.
  const exigees = [
    ['projects.cards', finales.projects.cards.length >= 10],
    ['projects.sections', finales.projects.sections.length >= 5],
    ['detail.rows', finales.detail.rows.length >= 4],
    ['float', finales.float.length >= 3],
    ['wbr.blocks', finales.wbr.blocks.length >= 1],
    ['papers.cards', finales.papers.cards.length === 5],
  ];
  exigees.filter(([, ok]) => !ok).forEach(([cle]) => RATES.push(`layout.${cle} incomplet`));

  const fichiers = fs.readdirSync(OUT);

  // TAILLE INTRINSEQUE DE CHAQUE DECOUPE, EN PX CSS.
  //
  // Le plan de fin assemble neuf elements pris sur toutes les pages, avec leurs
  // dimensions ecrites en dur (cartes 358x312, panneaux 1104x225…). Nos
  // elements ont d'autres proportions : laissees en dur, chaque image serait
  // ETIREE. La scene lit desormais ces tailles et n'impose que la largeur a
  // l'ecran : la hauteur suit le rapport reel de l'image.
  finales.assets = {};
  fichiers.filter((f) => f.endsWith('.png')).forEach((f) => {
    const { w, h } = taillePng(f);
    const d = f === 'card-hero-hires.png' ? (densite || DSF) : DSF;
    // `px` = la definition NATIVE en pixels reels. Le plan de fin s'en sert pour
    // ne jamais afficher une decoupe plus large qu'elle ne contient de pixels :
    // l'en-tete du planning (538 px de large) etait etale sur 1190 px, soit un
    // agrandissement de 4,4x, et ressortait mou et surdimensionne.
    finales.assets[f] = { w: Math.round(w / d), h: Math.round(h / d), px: w };
  });

  fs.writeFileSync(LAYOUT, JSON.stringify(finales, null, 2));
  console.log(`\n${fichiers.length} fichiers dans ${path.relative(ROOT, OUT)}`);
  console.log(`layout : ${path.relative(ROOT, LAYOUT)}`);

  // GARDE : une decoupe transparente entierement vide passerait inapercue.
  const vides = fichiers.filter((f) => f.startsWith('card') && fs.statSync(path.join(OUT, f)).size < 3000);
  if (vides.length) RATES.push(`decoupes quasi vides : ${vides.join(', ')}`);

  if (RATES.length) { console.log('\nPROBLEMES :'); RATES.forEach((r) => console.log('  - ' + r)); process.exit(1); }
  console.log('OK : captures, decoupes et layout prets pour le template');
})().catch((e) => { console.error(e); process.exit(1); });
