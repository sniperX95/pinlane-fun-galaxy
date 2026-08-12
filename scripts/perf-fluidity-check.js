// ==========================================================================
// GATE DE FLUIDITE : la console tient-elle 60 Hz sur une machine FAIBLE ?
// ==========================================================================
//
// LA PLAINTE, TEXTUELLE (Movsar, 2026-08-12) : « j'ai teste avec des pc pas
// tres puissants et ca rame, ca rame a mort, c'est inutilisable ». Les
// animations ne sont pas en cause en tant que telles : elles sont calibrees
// pour une machine correcte et RIEN dans le code ne s'adapte a une machine qui
// ne l'est pas. Entre « pleine qualite » et `prefers-reduced-motion`, il n'y
// avait aucun palier - et personne ne coche reduced-motion sur le PC du
// comptoir.
//
// CE QUI EST MESURE, ET POURQUOI CE SONT LES BONNES MESURES :
//
//   1. LES IMAGES AU REPOS. Personne ne regarde un compteur defiler en
//      permanence ; en revanche tout le monde regarde un ecran IMMOBILE toute
//      la soiree. Si l'immobile coute deja des images, tout le reste est perdu
//      d'avance. C'est la mesure qui compte le plus et c'est celle qu'aucun
//      gate ne faisait.
//   2. LES IMAGES PENDANT UN DEFILE DE CHIFFRES. C'est le moment ou une
//      reservation tombe pendant le service : le pire instant pour ramer.
//   3. LES SCANS DE DOCUMENT PAR IMAGE. Un `querySelectorAll(document)` par
//      frame d'animation est un defaut de STRUCTURE : il ne se voit pas sur une
//      machine rapide et il rend l'outil inutilisable sur une machine lente.
//      Le compter le rend visible avant qu'un client ne le subisse.
//   4. LES REFLOWS FORCES. `void offsetWidth` dans une boucle serialise style
//      et layout : le navigateur ne peut plus rien grouper.
//
// LE BRIDAGE CPU N'EST PAS UNE APPROXIMATION DE CONFORT : `setCPUThrottlingRate`
// est la meme primitive que l'onglet Performance de Chrome. 6x place la machine
// dans la zone d'un portable de bureau d'il y a cinq ans, qui est EXACTEMENT le
// parc des centres de bowling.
//
// CONTRE-EPREUVE INTEGREE : le scenario `--sans-palier` force le palier haut
// sur la machine bridee. Si les seuils passaient AUSSI sans le palier, ce gate
// ne prouverait rien - il echoue donc si la contre-epreuve ne se degrade pas.
//
// Lancement : node scripts/perf-fluidity-check.js [--bridage=6] [--json]

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PERF_PORT || 4321);
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const BRIDAGE = Number((process.argv.find((a) => a.startsWith('--bridage=')) || '').split('=')[1] || 6);
const JSON_OUT = process.argv.includes('--json');

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ->  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// Serveur statique du depot. Le mode demo coupe le reseau cote navigateur :
// aucune requete /api/ ne sort, donc aucune base n'est necessaire.
function serve() {
  return http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const rel = url === '/' || url === '/demo' || url === '/demo/' ? '/index.html' : url;
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

// ---- LES SONDES, POSEES AVANT TOUT SCRIPT DE LA PAGE ----------------------
// `addInitScript` s'execute avant le premier script du document : les
// compteurs voient donc TOUT, y compris la phase de demarrage.
const SONDES = () => {
  const w = window;
  w.__perf = { qsa: 0, reflow: 0, longs: [], frames: [] };

  const qsa = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function (...args) {
    w.__perf.qsa += 1;
    return qsa.apply(this, args);
  };

  // Un reflow force = lire une metrique geometrique apres avoir ecrit dans le
  // DOM. On compte les lectures : c'est leur nombre dans une boucle qui fait
  // le mal, pas la lecture isolee.
  ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft'].forEach((prop) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    if (!desc || !desc.get) return;
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() { w.__perf.reflow += 1; return desc.get.call(this); },
    });
  });

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__perf.longs.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* longtask non supporte : les images suffisent */ }
};

// Mesure d'images sur une duree donnee. On rend le p50 ET la pire image :
// une moyenne de 55 fps avec une image a 400 ms est vecue comme un blocage,
// pas comme « presque fluide ».
const MESURE_IMAGES = (ms) => new Promise((resolve) => {
  const t = [];
  let last = performance.now();
  const t0 = last;
  function tick(now) {
    t.push(now - last);
    last = now;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else {
      const tri = [...t].sort((a, b) => a - b);
      const p50 = tri[Math.floor(tri.length / 2)] || 0;
      const p95 = tri[Math.floor(tri.length * 0.95)] || 0;
      resolve({
        images: t.length,
        fps: Math.round(1000 / (p50 || 1)),
        p50: Math.round(p50 * 10) / 10,
        p95: Math.round(p95 * 10) / 10,
        pire: Math.round(Math.max(...t)),
      });
    }
  }
  requestAnimationFrame(tick);
});

// LES TROIS ECRANS QUI COMPTENT, choisis sur ce qu'ils coutent REELLEMENT
// (mesure du 2026-08-12, pas une intuition) :
//   campaigns : le bureau de l'agent marketing. Canvas WebGL PLEIN ECRAN
//               (1440x900 en DPR 1, quatre fois plus en DPR 2), plus une marque
//               en particules, deux surfaces en `backdrop-filter` et la seule
//               animation infinie reellement active de la console. C'est
//               l'ecran qui met un GPU integre a genoux.
//   clients   : douze compteurs animes et une liste en cascade. C'est l'ecran
//               ou le defile de chiffres se voit le plus, et celui ou Movsar
//               avait deja signale la frappe lente.
//   planning  : 4307 noeuds, le plus gros DOM de l'application. Ici ce n'est
//               pas le GPU qui souffre, c'est le style recalc.
const ECRANS = [
  { page: 'campaigns', label: 'campaigns (canvas WebGL plein ecran + verre)' },
  { page: 'clients', label: 'clients (12 compteurs + cascade)' },
  { page: 'planning', label: 'planning (4307 noeuds)' },
];

async function scenario(page, cdp, { palierForce, ecran }) {
  await page.addInitScript(SONDES);
  if (palierForce) {
    await page.addInitScript((p) => {
      try { window.localStorage.setItem('pinlane_perf_tier', p); } catch (e) {}
    }, palierForce);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: BRIDAGE });
  await page.goto(`http://127.0.0.1:${PORT}/?demo=1&page=${ecran}`, { waitUntil: 'load' });
  // La console monte en plusieurs vagues (scripts defer, premier rendu, poll).
  // On attend un ecran REELLEMENT peuple, sinon on mesure une page vide - c'est
  // exactement le piege du premier jet de ce banc, qui mesurait 60 fps sur un
  // planning pas encore rendu et se declarait content.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-pl-num], .booking, .res-row, canvas, .mkw-bcard').length > 2,
    null,
    { timeout: 30000 },
  ).catch(() => {});
  await page.waitForTimeout(2500);           // laisse retomber les animations d'entree

  const palier = await page.evaluate(() => document.documentElement.getAttribute('data-pl-perf') || '(aucun)');
  const decor = await page.evaluate(() => {
    let anim = 0; let infini = 0; let verre = 0;
    for (const e of document.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (cs.animationName && cs.animationName !== 'none') {
        anim += 1;
        if (cs.animationIterationCount === 'infinite') infini += 1;
      }
      if (cs.backdropFilter && cs.backdropFilter !== 'none') verre += 1;
    }
    const toiles = [...document.querySelectorAll('canvas')].map((c) => `${c.id || '?'}:${c.width}x${c.height}`);
    return { anim, infini, verre, toiles, noeuds: document.querySelectorAll('*').length };
  });

  // ---- 1. LE REPOS ---------------------------------------------------------
  await page.evaluate(() => { window.__perf.qsa = 0; window.__perf.reflow = 0; window.__perf.longs = []; });
  const repos = await page.evaluate(MESURE_IMAGES, 3000);
  const reposCout = await page.evaluate(() => ({ qsa: window.__perf.qsa, reflow: window.__perf.reflow, longs: window.__perf.longs.slice() }));

  // ---- 2. LE DEFILE DE CHIFFRES -------------------------------------------
  // On provoque un vrai changement de valeur sur tous les compteurs de tete,
  // exactement comme le fait l'arrivee d'une reservation pendant le service.
  await page.evaluate(() => { window.__perf.qsa = 0; window.__perf.reflow = 0; window.__perf.longs = []; });
  const defile = await page.evaluate(async (mesure) => {
    const f = new Function('return ' + mesure)();
    const cibles = [...document.querySelectorAll('[data-pl-num]')].slice(0, 12);
    cibles.forEach((el, i) => {
      const n = Number(String(el.textContent).replace(/[^\d]/g, '')) || 0;
      el.textContent = String(n + 7 + i);
    });
    const out = await f(1200);
    out.compteurs = cibles.length;
    return out;
  }, MESURE_IMAGES.toString());
  const defileCout = await page.evaluate(() => ({ qsa: window.__perf.qsa, reflow: window.__perf.reflow, longs: window.__perf.longs.slice() }));

  return { palier, decor, repos, reposCout, defile, defileCout };
}

(async () => {
  const { chromium } = require('playwright-core');
  const serveur = serve();
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));

  // `--use-gl=swiftshader` n'est pas un artifice de laboratoire : c'est ce que
  // Chrome fait DE LUI-MEME sur un poste dont le pilote graphique est absent ou
  // sur liste noire, ce qui decrit une bonne part des PC de comptoir. On mesure
  // donc une configuration reelle, et la plus defavorable.
  const lancement = {
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  };
  if (BROWSER_PATH) lancement.executablePath = BROWSER_PATH;
  else lancement.channel = 'msedge';        // meme repli que les autres gates du depot
  const browser = await chromium.launch(lancement);

  async function mesurer(opts) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    const cdp = await page.context().newCDPSession(page);
    const out = await scenario(page, cdp, opts);
    out.erreurs = erreurs;
    await page.close();
    return out;
  }

  console.log(`\n== fluidite de la console, CPU bride ${BRIDAGE}x, WebGL logiciel ==\n`);

  const releve = {};
  for (const { page: ecran, label } of ECRANS) {
    const m = await mesurer({ palierForce: null, ecran });
    releve[ecran] = m;
    console.log(`-- ${label}`);
    console.log(`   palier ${m.palier} | ${m.decor.noeuds} noeuds, ${m.decor.anim} animes (${m.decor.infini} infinies), ${m.decor.verre} verre, toiles [${m.decor.toiles.join(', ') || 'aucune'}]`);
    console.log(`   repos  : ${String(m.repos.fps).padStart(2)} fps   p50 ${m.repos.p50} ms  p95 ${m.repos.p95} ms  pire ${m.repos.pire} ms`);
    console.log(`            ${m.reposCout.qsa} scans doc, ${m.reposCout.reflow} lectures geo, ${m.reposCout.longs.length} taches longues`);
    console.log(`   activite: ${String(m.defile.fps).padStart(2)} fps   p50 ${m.defile.p50} ms  p95 ${m.defile.p95} ms  pire ${m.defile.pire} ms   (${m.defile.compteurs} compteur(s) pousse(s))`);
    console.log(`            ${m.defileCout.qsa} scans doc, ${m.defileCout.reflow} lectures geo, ${m.defileCout.longs.length} taches longues`);
    console.log('');
  }

  if (JSON_OUT) {
    const dest = path.join(ROOT, 'perf-releve.json');
    fs.writeFileSync(dest, JSON.stringify({ bridage: BRIDAGE, releve }, null, 2));
    console.log(`  -> ${path.relative(ROOT, dest)} ecrit\n`);
  }

  // ---- LES SEUILS ----------------------------------------------------------
  // Ils portent sur l'ecran le PIRE, pas sur une moyenne : c'est l'ecran le
  // pire qui fait dire « c'est inutilisable ».
  const tous = Object.values(releve);
  const pireRepos = Math.min(...tous.map((m) => m.repos.fps));
  // On juge sur le p95, pas sur la PIRE image. La pire image attrape aussi bien
  // un vrai defaut qu'un ramasse-miettes ou un rendu de page : d'un passage a
  // l'autre elle vaut 33 ou 100 ms sans que le code ait bouge, et un seuil pose
  // dessus rougit au hasard. Un gate qui rougit au hasard finit ignore, donc
  // inutile. Le p95 separe tout aussi nettement (133 ms avant, 17 ms apres) et
  // ne bouge pas d'un passage a l'autre.
  const pireAcoup = Math.max(...tous.map((m) => m.repos.p95));
  const pireActivite = Math.min(...tous.map((m) => m.defile.fps));
  const pireScans = Math.max(...tous.map((m) => m.defileCout.qsa));
  const erreurs = tous.flatMap((m) => m.erreurs);

  ok(erreurs.length === 0, 'aucune erreur JavaScript', erreurs.slice(0, 2).join(' | '));
  ok(pireRepos >= 50, 'un ecran immobile ne coute presque rien', pireRepos + ' fps sur le pire ecran');
  ok(pireAcoup < 40, 'aucun a-coup visible au repos', 'p95 ' + pireAcoup + ' ms sur le pire ecran');
  ok(pireActivite >= 45, 'un ecran qui bouge reste fluide', pireActivite + ' fps sur le pire ecran');
  ok(pireScans < 30, 'une animation ne rescanne pas le document a chaque image', pireScans + ' scans');

  /* ---- LA CONTRAINTE DE MOVSAR, VERIFIEE ----------------------------------
     « sans enlever les animations ». Un gate de performance qui ne mesure que
     des images finit toujours par etre satisfait en supprimant ce qui bouge :
     c'est la facon la plus simple d'atteindre 60 fps, et c'est exactement ce
     qui n'est pas demande. On compte donc ce qui vit A L'ECRAN, au palier le
     plus sobre - celui ou la tentation de couper serait la plus forte. */
  console.log('');
  const anims = tous.map((m) => m.decor.anim);
  const toiles = releve.campaigns.decor.toiles.length;
  ok(Math.min(...anims) >= 10, 'chaque ecran garde ses animations au palier sobre', anims.join(' / ') + ' elements animes');
  ok(toiles >= 2, 'la page marketing garde ses deux toiles (texture + marque)', toiles + ' toile(s)');
  ok(releve.campaigns.decor.verre >= 2, 'les surfaces en verre sont conservees', releve.campaigns.decor.verre + ' surface(s)');

  /* ---- LA CONTRE-EPREUVE --------------------------------------------------
     On force le palier haut sur la MEME machine bridee. Le shader plein ecran
     redemarre alors, et l'ecran marketing doit s'effondrer. S'il ne s'effondre
     PAS, c'est que la mesure ne voit pas ce qu'elle pretend voir : le gate
     serait vert pour de mauvaises raisons, et il doit rougir. */
  console.log('');
  const temoin = await mesurer({ palierForce: 'full', ecran: 'campaigns' });
  console.log(`-- contre-epreuve : palier force a "full" sur la machine bridee`);
  console.log(`   campaigns repos : ${temoin.repos.fps} fps (p50 ${temoin.repos.p50} ms) contre ${releve.campaigns.repos.fps} fps au palier automatique`);
  ok(temoin.repos.fps < releve.campaigns.repos.fps - 10,
    'sans le palier, la meme machine s effondre : la mesure teste bien quelque chose',
    temoin.repos.fps + ' fps force contre ' + releve.campaigns.repos.fps + ' fps adapte');

  await browser.close();
  serveur.close();
  console.log(failures === 0 ? '\nOK : la console tient sur une machine faible.' : `\n${failures} echec(s).`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('PLANTAGE', e); process.exit(1); });
