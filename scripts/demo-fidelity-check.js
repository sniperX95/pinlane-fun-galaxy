// L'ANTIDOTE A LA DERIVE : la demonstration decouplee dit-elle encore la
// verite sur le produit ?
//
// POURQUOI CE GATE EXISTE (2026-08-13). La demonstration publique executait
// jusqu'ici le VRAI code de la console avec un faux reseau. C'etait lourd,
// c'etait couple, et Movsar a tranche : « c'est une demo, un truc a part, et
// ca ne doit pas du tout etre branche avec le vrai ». Elle est donc devenue
// une page autonome (`demo/`), sans une ligne de code commune avec
// l'application.
//
// LE REVERS EST REEL, ET IL A DEJA COUTE. Le meme jour, trois maquettes de la
// vitrine ont du etre corrigees parce qu'elles montraient des choses que le
// produit ne fait plus : une LISTE DE CONTROLE AVANT VENUE supprimee du
// produit, un indicateur « Encaisse » qui n'a jamais existe, et un ecran
// « Reservations » qui etait en realite « Planning > Toutes ». La
// demonstration echappait a ce piege PARCE QU'ELLE executait le produit. En
// la decouplant, on recree exactement ce risque.
//
// CE GATE EST LA CONTREPARTIE DU DECOUPLAGE. Il ouvre la VRAIE console avec
// une session de test, il ouvre la demonstration, et il compare ce qui est
// verifiable de part et d'autre :
//   1. la liste, l'ORDRE et les libelles des entrees de menu ;
//   2. les intitules des indicateurs du planning ;
//   3. les intitules des onglets de ressource ;
//   4. les intitules des filtres de statut de la liste ;
//   5. le titre de l'ecran ;
//   6. les jetons de couleur, compares a DESIGN.md.
// Il rougit des que le produit bouge sans que la demonstration suive. Sans
// lui, le decouplage est un piege a retardement.
//
// CE QU'IL NE PRETEND PAS FAIRE : il ne compare pas les pixels, ni les
// donnees, ni les comportements. Il compare les MOTS que le produit affiche
// et que la demonstration promet. C'est exactement la classe d'erreur qui a
// mordu trois fois.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FIDELITY_PORT || 4237);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const DEMO_JS = path.join(ROOT, 'demo', 'demo.js');
const DEMO_DATA = path.join(ROOT, 'demo', 'demo-data.js');
const DEMO_CSS = path.join(ROOT, 'demo', 'demo.css');

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ->  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// Le serveur rejoue la reecriture Vercel : /demo sert demo/index.html.
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const clean = url.pathname.replace(/\/+$/, '') || '/';
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (clean === '/' || clean === '/reserver') filePath = path.join(ROOT, 'index.html');
    if (clean === '/demo') filePath = path.join(ROOT, 'demo', 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---- La session de test de la VRAIE console --------------------------------
// Reprise du montage de `scripts/menu-navigation-check.js` : une session
// complete en stockage local, et un `fetch` qui repond sans jamais sortir.
async function installerSession(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.manage',
      'direction.view', 'centers.switch', 'settings.manage', 'emails.view', 'emails.send',
      'campaigns.manage', 'marketing.agents', 'users.manage', 'clients.view', 'pricing.manage'];
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt,
      member: { id: 'libramont:qa', name: 'QA' },
      role: { id: 'direction', name: 'Direction', locked: true },
      permissions: perms,
    };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    window.fetch = async (input) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [], testData: true });
      return J({ ok: true });
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) { /* stockage refuse */ }
  }, { expiresAt });
}

// ---- Ce qu'on lit, des deux cotes ------------------------------------------
// Les selecteurs de gauche sont ceux du PRODUIT, ceux de droite ceux de la
// demonstration. Un texte se normalise avant comparaison (espaces, apostrophes
// typographiques, casse) : ce qu'on compare est le MOT, pas sa ponctuation.
function normaliser(t) {
  return String(t || '')
    .replace(/\s+/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase();
}

const LIRE_PRODUIT = `(() => {
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  const nav = document.querySelector('.fgx-menu-nav') || document.querySelector('.ops-sidebar');
  const entrees = nav ? [].map.call(nav.querySelectorAll('[data-fgx-menu-key],[data-fgx-menu-toggle]'), (el) => {
    const cle = el.getAttribute('data-fgx-menu-key') || el.getAttribute('data-fgx-menu-toggle');
    // Le libelle vit dans un span dedie ; a defaut on prend le premier
    // fragment de texte, sans les compteurs ni les pastilles.
    const lab = el.querySelector('.fgx-menu-label, .label, span:not(.badge)');
    return { cle, libelle: txt(lab) || txt(el).split('  ')[0] };
  }) : [];
  const kpis = [].map.call(document.querySelectorAll('#staffView .kpi'), (k) => {
    const l = k.querySelector('.kpi-label, .label, .k-lab');
    return txt(l) || txt(k).split(/\\d/)[0];
  });
  const onglets = [].map.call(document.querySelectorAll('#staffView .staff-resource-tab'), (t) => txt(t.querySelector('.main')));
  const filtres = [].map.call(document.querySelectorAll('#staffView .status-chip'), (c) => {
    const clone = c.cloneNode(true);
    [].forEach.call(clone.querySelectorAll('span'), (s) => s.remove());
    return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
  });
  const titre = txt(document.querySelector('#staffView .staff-head h1'))
    || txt(document.querySelector('#staffView h1'));
  return { entrees, kpis, onglets, filtres, titre };
})()`;

const LIRE_DEMO = `(() => {
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  const entrees = [].map.call(document.querySelectorAll('[data-d-menu]'), (el) => ({
    cle: el.getAttribute('data-d-menu'),
    libelle: txt(el.querySelector('.d-nav-libelle')),
    verrou: el.classList.contains('is-verrou'),
    cadenas: !!el.querySelector('.d-cadenas'),
  }));
  const kpis = [].map.call(document.querySelectorAll('.d-kpi .d-kpi-lib'), txt);
  const onglets = [].map.call(document.querySelectorAll('.d-onglet b'), txt);
  const filtres = [].map.call(document.querySelectorAll('.d-puce'), (c) => {
    const clone = c.cloneNode(true);
    [].forEach.call(clone.querySelectorAll('b'), (b) => b.remove());
    return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
  });
  const titre = txt(document.querySelector('.d-tete-titre h1'));
  return { entrees, kpis, onglets, filtres, titre };
})()`;

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let produit = null;
  let demo = null;
  try {
    // =====================================================================
    console.log('\n[1] LA VRAIE CONSOLE : ce que le produit affiche aujourd hui');
    // =====================================================================
    const vraie = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await vraie.route('https://cdn.vercel-insights.com/**', (r) => r.abort());
    await installerSession(vraie);
    await vraie.goto(`${BASE_URL}/?v=fid-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await vraie.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
    await vraie.evaluate(() => {
      if (typeof hasSavedAuth === 'function') hasSavedAuth();
      setView('staff');
      if (typeof openStaffMenuPage === 'function') openStaffMenuPage('planning');
      if (typeof renderStaffMenu === 'function') renderStaffMenu();
    });
    await vraie.waitForTimeout(1600);
    produit = await vraie.evaluate(LIRE_PRODUIT);
    await vraie.close();
    ok(produit.entrees.length > 0, `la console reelle rend son menu (${produit.entrees.length} entrees lues)`);
    ok(produit.kpis.length > 0, `la console reelle rend ses indicateurs (${produit.kpis.length} lus)`);

    // =====================================================================
    console.log('\n[2] LA DEMONSTRATION : ce qu elle promet');
    // =====================================================================
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('https://cdn.vercel-insights.com/**', (r) => r.abort());
    // `?guide=0` : l'ecran plein tout de suite. On lit des libelles, pas une
    // mise en scene, et un bloc pas encore revele n'est pas dans le flux.
    await page.goto(`${BASE_URL}/demo?guide=0`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('[data-d-menu]', { timeout: 15000 });
    await page.waitForTimeout(500);
    demo = await page.evaluate(LIRE_DEMO);
    await page.close();

    // =====================================================================
    console.log('\n[3] LE MENU : memes cles, meme ORDRE, memes libelles');
    // =====================================================================
    // Le produit expose des GROUPES (planning, arrivals, prices) qui portent
    // des enfants ; la demonstration n'affiche que l'entree parente. On
    // compare donc la sequence des entrees que la demonstration montre, dans
    // l'ordre ou le produit les expose.
    const clesDemo = demo.entrees.map((e) => e.cle);
    const clesProduit = produit.entrees.map((e) => e.cle);
    const clesProduitFiltrees = clesProduit.filter((c) => clesDemo.indexOf(c) !== -1);
    // Une cle vue deux fois cote produit (bouton de marque + entree de nav)
    // ne doit pas casser la comparaison : on deduplique en gardant l'ordre.
    const dedup = clesProduitFiltrees.filter((c, i) => clesProduitFiltrees.indexOf(c) === i);

    const manquantes = clesDemo.filter((c) => clesProduit.indexOf(c) === -1);
    ok(manquantes.length === 0,
      'chaque entree de la demonstration existe dans le produit',
      manquantes.length ? `INTROUVABLES DANS LE PRODUIT : ${manquantes.join(', ')}` : `${clesDemo.length} entrees`);

    ok(dedup.join(' > ') === clesDemo.join(' > '),
      'les entrees sont dans le MEME ORDRE que dans le produit',
      dedup.join(' > ') === clesDemo.join(' > ') ? 'ordre identique' : `produit: ${dedup.join(' > ')}  |  demo: ${clesDemo.join(' > ')}`);

    // Les libelles, un par un. C'est la classe d'erreur qui a mordu trois
    // fois : le produit renomme un ecran, la maquette garde l'ancien nom.
    demo.entrees.forEach((e) => {
      const cote = produit.entrees.filter((p) => p.cle === e.cle && normaliser(p.libelle))[0];
      if (!cote) return;
      ok(normaliser(cote.libelle) === normaliser(e.libelle),
        `[menu ${e.cle}] meme libelle que le produit`,
        normaliser(cote.libelle) === normaliser(e.libelle) ? e.libelle : `produit "${cote.libelle}" vs demo "${e.libelle}"`);
    });

    // Deux ecrans ouverts, neuf grises : c'est la decision produit du jour.
    const ouverts = demo.entrees.filter((e) => !e.verrou).map((e) => e.cle);
    const verrouilles = demo.entrees.filter((e) => e.verrou);
    ok(ouverts.length === 2 && ouverts.indexOf('planning') !== -1 && ouverts.indexOf('campaigns') !== -1,
      'exactement deux ecrans ouverts : planning et marketing', ouverts.join(', '));
    ok(verrouilles.length === demo.entrees.length - 2,
      `les ${demo.entrees.length - 2} autres entrees sont grisees`, `${verrouilles.length} grisees`);
    ok(verrouilles.every((e) => e.cadenas),
      'chaque entree grisee porte un cadenas : l etat ne tient pas a la couleur seule',
      `${verrouilles.filter((e) => e.cadenas).length}/${verrouilles.length}`);

    // =====================================================================
    console.log('\n[4] LES LIBELLES D ECRAN : indicateurs, onglets, filtres, titre');
    // =====================================================================
    const compare = (nomListe, cotesProduit, cotesDemo) => {
      cotesDemo.forEach((valeur) => {
        const trouve = cotesProduit.some((p) => normaliser(p) === normaliser(valeur));
        ok(trouve, `[${nomListe}] « ${valeur} » existe dans le produit`,
          trouve ? '' : `absent du produit. Le produit affiche : ${cotesProduit.map((v) => `« ${v} »`).join(', ') || 'rien'}`);
      });
    };
    compare('indicateur', produit.kpis, demo.kpis);
    compare('onglet', produit.onglets, demo.onglets);
    compare('filtre', produit.filtres, demo.filtres);
    ok(normaliser(produit.titre) === normaliser(demo.titre),
      'le titre de l ecran est celui du produit',
      normaliser(produit.titre) === normaliser(demo.titre) ? demo.titre : `produit "${produit.titre}" vs demo "${demo.titre}"`);

    // =====================================================================
    console.log('\n[5] LES JETONS DE COULEUR : recopies de DESIGN.md, pas partages');
    // =====================================================================
    // La demonstration declare ses propres jetons plutot que d'importer la
    // feuille du produit : une feuille partagee aurait recree la dependance
    // qu'on vient de couper. En echange ils peuvent deriver, donc on les
    // confronte a la source d'autorite.
    const design = fs.readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');
    const css = fs.readFileSync(DEMO_CSS, 'utf8');
    const blocDesign = design.slice(design.indexOf('colors:'), design.indexOf('typography:'));
    const lireDesign = (mode) => {
      const debut = blocDesign.indexOf(`  ${mode}:`);
      const suite = mode === 'light' ? blocDesign.indexOf('  dark:') : blocDesign.length;
      const bloc = blocDesign.slice(debut, suite === -1 ? blocDesign.length : suite);
      const table = {};
      [...bloc.matchAll(/^\s{4}([a-z0-9-]+):\s*"(#[0-9a-fA-F]{6})"/gm)].forEach((m) => { table[m[1]] = m[2].toLowerCase(); });
      return table;
    };
    const lireCss = (portee) => {
      const bloc = portee === 'light'
        ? css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
        : css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('* { box-sizing'));
      const table = {};
      [...bloc.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].forEach((m) => { table[m[1]] = m[2].toLowerCase(); });
      return table;
    };
    ['light', 'dark'].forEach((mode) => {
      const attendu = lireDesign(mode);
      const obtenu = lireCss(mode);
      const cles = Object.keys(attendu).filter((k) => obtenu[k] !== undefined);
      const divergents = cles.filter((k) => obtenu[k] !== attendu[k]);
      ok(cles.length >= 12, `[${mode}] la demonstration declare les jetons du produit`, `${cles.length} jetons confrontes`);
      ok(divergents.length === 0, `[${mode}] chaque jeton vaut ce que DESIGN.md declare`,
        divergents.length ? divergents.map((k) => `${k}: demo ${obtenu[k]} vs design ${attendu[k]}`).join(' | ') : 'aucun ecart');
    });

    // =====================================================================
    console.log('\n[6] LES VERITES DU PRODUIT que la demonstration ne doit jamais trahir');
    // =====================================================================
    // ON LIT LE CODE, PAS LES COMMENTAIRES. La premiere version de ce bloc
    // rougissait sur ses propres commentaires, qui disent precisement « le
    // produit ne modelise aucun acompte ». Meme piege que celui trouve dans
    // `occupancy-check.js` : un gate qui lit ses propres avertissements se
    // denonce lui-meme et on apprend a ignorer son rouge.
    const sansCommentaires = (texte) => texte
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const source = sansCommentaires(fs.readFileSync(DEMO_JS, 'utf8'))
      + '\n' + sansCommentaires(fs.readFileSync(DEMO_DATA, 'utf8'));
    // Pinlane N'ENCAISSE PAS et ne modelise aucun acompte. Un « acompte »
    // affiche ici tiendrait jusqu'au premier rendez-vous, pas plus.
    ok(!/acompte/i.test(source), 'aucune mention d acompte : le produit n en a pas',
      (source.match(/.{0,40}acompte.{0,40}/i) || [''])[0]);
    ok(!/encaiss[ée]\s*[:·]|\bencaissés\b/i.test(source),
      'aucun indicateur « Encaisse » : le produit suit un statut, il n encaisse pas');
    // L'agent PREPARE, il ne publie pas.
    const publie = source.match(/[^.]*\bpubli(e|era|ons|ez)\b[^.]*/gi) || [];
    const publieSansGarde = publie.filter((p) => !/ne publie rien|sans toi|sans vous|jamais/i.test(p));
    ok(publieSansGarde.length === 0,
      'l agent PREPARE, il ne publie jamais tout seul',
      publieSansGarde.length ? publieSansGarde.join(' || ') : 'aucune promesse de publication autonome');
    // Aucune enseigne, ville ou activite qui n'existe pas dans le produit.
    ok(!/fun\s*galaxy|libramont|gembloux|ciney/i.test(source),
      'aucune enseigne ni ville du vrai client dans le code de la demonstration');
    ok(!/\bpadel\b|escape\s*game|trampoline|paintball|karting(?!\s*VR)/i.test(source),
      'aucune activite que le moteur ne planifie pas (padel, escape game, karting)');

    // =====================================================================
    console.log('\n[7] CONTRE-PREUVE par mutation : ce gate sait-il rougir ?');
    // =====================================================================
    // Sans elle, les assertions ci-dessus pourraient etre vraies par accident.
    // On renomme une entree de menu dans la demonstration et on verifie que la
    // comparaison avec le produit tombe.
    const original = fs.readFileSync(DEMO_JS, 'utf8');
    const ancre = "libelle: 'Planning', ico: 'calendrier', ouvert: true";
    if ((original.split(ancre).length - 1) !== 1) {
      ok(false, 'ancre de mutation introuvable (la table MENU a-t-elle bouge ?)');
    } else {
      fs.writeFileSync(DEMO_JS, original.replace(ancre, "libelle: 'Agenda du jour', ico: 'calendrier', ouvert: true"));
      let mute = { entrees: [] };
      try {
        const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await p2.route('https://cdn.vercel-insights.com/**', (r) => r.abort());
        await p2.goto(`${BASE_URL}/demo?guide=0&v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p2.waitForSelector('[data-d-menu]', { timeout: 15000 });
        mute = await p2.evaluate(LIRE_DEMO);
        await p2.close();
      } finally {
        fs.writeFileSync(DEMO_JS, original); // restauration par edition inverse
      }
      const libelleMute = (mute.entrees.filter((e) => e.cle === 'planning')[0] || {}).libelle || '';
      const cotePlanning = produit.entrees.filter((p) => p.cle === 'planning' && normaliser(p.libelle))[0];
      const divergerait = !!cotePlanning && normaliser(cotePlanning.libelle) !== normaliser(libelleMute);
      ok(divergerait,
        'un ecran renomme dans la demonstration seule fait DIVERGER la comparaison -> le gate rougirait',
        `demo mutee = "${libelleMute}", produit = "${cotePlanning ? cotePlanning.libelle : '?'}"`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ndemo-fidelity-check: FAIL ${failures} assertion(s).`);
    console.error('LA DEMONSTRATION A DERIVE DU PRODUIT, ou le produit a bouge sans elle.');
    console.error('Corriger demo/demo.js et demo/demo-data.js pour dire ce que le produit fait AUJOURD HUI.');
    process.exit(1);
  }
  console.log('\ndemo-fidelity-check: ALL OK - la demonstration decouplee dit encore la verite sur le produit.');
}

main().catch((err) => { console.error(err); process.exit(1); });
