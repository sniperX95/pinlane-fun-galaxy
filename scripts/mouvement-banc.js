// LE BANC DU MOUVEMENT DE LA CONSOLE (2026-11-19).
//
// Ansar : « tout ce qui fait joli [...] est souvent très lourd et ça fait lagger ».
// Ce banc MESURE avant de toucher : la console du samedi chargé (fixture pic,
// 46 groupes), processeur bridé x4 comme une tablette modeste du comptoir, et
// pour chaque page :
//   - au repos, 3 s sans geste : le temps que le fil principal passe à travailler,
//     les recalculs de style et de mise en page, les images produites, et la
//     liste des animations sans fin qui tournent sur un élément VISIBLE ;
//   - des gestes réels (souris, molette, clavier, jamais un clic JavaScript) :
//     survol du planning, ouverture de la fenêtre Réserver, changement de page,
//     défilement ; pour chacun, les images produites, les à-coups (une image de
//     plus de 50 ms) et le temps de travail du fil principal.
//
// Le principe (learning/PRINCIPLES.md, « Le coupable de la lenteur n'est presque
// jamais celui qu'on soupçonne ») : couper UN suspect à la fois et comparer à la
// base. Les variantes cassent la page servie en mémoire, jamais le disque :
//   base            la page telle quelle
//   sansfin         les animations sans fin ne jouent qu'une fois
//   sansflou        aucun flou d'arrière-plan (backdrop-filter)
//   sanstransition  aucune transition
//   sansanimation   aucune animation CSS
//   reduit          le mouvement réduit du système : aucune fenêtre n'anime son entrée,
//                   la référence des gestes qui ouvrent une fenêtre
//
// LA FENETRE QUI S'OUVRE (2026-11-20, soir). Le gérant clique une réservation du
// planning : « pas fluide du tout », « trop lent ». Les gestes ouvrir-fiche (un vrai
// clic sur le nom d'une ligne du planning complet), fermer-fiche (Échap),
// ouvrir-reserver et fermer-reserver lisent en plus, à chaque image depuis le geste, ce
// que l'œil voit de la fenêtre : son opacité réelle (la sienne, celles de ses parents,
// celle de son contenu s'il joue sa propre entrée), moins la part qu'un calque opaque
// posé dessus cache (la forme qui volait de la ligne à la fiche). Ils rendent :
//   première  le clic jusqu'à la première image où la fenêtre existe (le rendu) ;
//   lisible   le clic jusqu'à la fenêtre lisible, opacité vue de 0,9 au moins ;
//   complète  le clic jusqu'à la fenêtre posée : opacité 1, échelle 1, plus rien ne bouge ;
//   à-coups   les images de plus de 50 ms APRÈS la première (le mouvement seul, le
//             rendu est donné à part : traitement du clic, renderPosInner) ;
//   fermée    pour la fermeture, la touche jusqu'à la dernière trace à l'écran.
//
// Usage : node scripts/mouvement-banc.js [variante,variante] [--cpu=4] [--sortie=fichier.json]
//         [--port=5231] [--gestes=ouvrir-fiche,fermer-fiche] [--fois=5]
// (--gestes : ces gestes seulement, sans les pages au repos ; --fois : chaque geste de
// fenêtre rejoué autant de fois, la médiane est rendue)
// Les chiffres absolus dépendent de la machine : on lit des RAPPORTS entre
// variantes mesurées dans la même série.
'use strict';

const fs = require('fs');
const path = require('path');
const F = require('./planning-v3-fixtures.js');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const NAVIGATEUR = process.env.PINLANE_BROWSER || (fs.existsSync(CHROME) ? CHROME : EDGE);
const args = process.argv.slice(2);
const opt = (nom, defaut) => { const a = args.find((x) => x.startsWith(`--${nom}=`)); return a ? a.split('=')[1] : defaut; };
const VARIANTES = (args.find((a) => !a.startsWith('--')) || 'base').split(',').filter(Boolean);
const CPU = Number(opt('cpu', '4'));
const SORTIE = opt('sortie', '');
const PORT = Number(opt('port', '5231'));
const GESTES = opt('gestes', '').split(',').filter(Boolean);
const FOIS = Math.max(1, Number(opt('fois', '1')) || 1);
const veut = (geste) => !GESTES.length || GESTES.includes(geste);

const PAGES = [
  ['dashboard'], ['planning', 'all'], ['planning', 'bowling'], ['planning', 'laser'],
  ['reservations'], ['arrivals'], ['clients'], ['requests'], ['emails'], ['campaigns'],
  ['establishment'], ['prices'], ['laserGame'], ['lanes'], ['secours'], ['cockpit'],
];

// Chaque variante transforme la CSS ou le JS servis, en mémoire.
function transformateur(variante) {
  if (variante === 'base') return null;
  return (rel, texte) => {
    if (!/\.css$/i.test(rel) && !/\.html$/i.test(rel)) return texte;
    if (variante === 'sansfin') return texte.replace(/\binfinite\b/g, '1');
    if (variante === 'sansflou') return texte.replace(/(-webkit-)?backdrop-filter\s*:[^;}]+/g, 'backdrop-filter:none');
    if (variante === 'sanstransition' && /\.html$/i.test(rel)) return texte.replace(/<\/head>/i, () => '<style>*,*::before,*::after{transition:none!important}</style></head>');
    if (variante === 'sansanimation' && /\.html$/i.test(rel)) return texte.replace(/<\/head>/i, () => '<style>*,*::before,*::after{animation:none!important}</style></head>');
    // Le témoin : un coût CONNU (un voile plein écran dont le fond glisse sans fin, repeint à
    // chaque image). Si le banc ne le voit pas au repos, il est aveugle.
    if (variante === 'temoin' && /\.html$/i.test(rel)) return texte.replace(/<\/body>/i, () => '<div id="mvtTemoin" style="position:fixed;inset:0;pointer-events:none;z-index:2147483000;background:linear-gradient(90deg,transparent,rgba(0,0,0,.03),transparent);background-size:200% 100%;animation:mvtTemoin 1s linear infinite"></div><style>@keyframes mvtTemoin{to{background-position:-200% 0}}</style></body>');
    return texte;
  };
}

// Dans la page : un compteur d'images et d'à-coups, et la liste des animations sans fin visibles.
const SONDE = `(() => {
  if (window.__mvt) return;
  const m = window.__mvt = { images: [], actif: false, loaf: 0 };
  let avant = 0;
  const boucle = (t) => { if (m.actif && avant) m.images.push(t - avant); avant = t; requestAnimationFrame(boucle); };
  requestAnimationFrame(boucle);
  try {
    new PerformanceObserver((liste) => { if (!m.actif) return; for (const e of liste.getEntries()) m.loaf += e.blockingDuration || 0; })
      .observe({ type: 'long-animation-frame', buffered: false });
  } catch (e) { m.loaf = -1; }
})()`;

// Dans la page : ce que l'œil voit de la fenêtre à chaque image, depuis le geste.
const SONDE_FENETRE = `(() => {
  if (window.__fen) return;
  const f = window.__fen = { surface: '', contenu: '', racine: '', actif: false, t0: 0, images: [], evenement: null, rendus: [] };
  const geste = (e) => { if (f.actif && !f.t0 && e.isTrusted) f.t0 = e.timeStamp; };
  document.addEventListener('click', geste, true);
  document.addEventListener('keydown', geste, true);
  const opacite = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const commun = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const boucle = (t) => {
    if (f.actif && f.t0) {
      const s = f.surface ? document.querySelector(f.surface) : null;
      let vue = 0, lisible = 0, echelle = 1;
      if (s) {
        const rs = s.getBoundingClientRect();
        let cache = 0;
        document.querySelectorAll('.pl-calque.pl-vol').forEach((v) => {
          const ov = Number(getComputedStyle(v).opacity);
          if (ov > 0) cache = Math.max(cache, ov * commun(v.getBoundingClientRect(), rs) / Math.max(1, rs.width * rs.height));
        });
        const c = f.contenu ? s.querySelector(f.contenu) : null;
        vue = opacite(s) * (1 - cache);
        lisible = vue * (c ? Number(getComputedStyle(c).opacity) : 1);
        const m = /matrix\\(([^,]+)/.exec(getComputedStyle(s).transform || '');
        echelle = m ? Number(m[1]) : 1;
      }
      // (ce qui bouge encore : la fenêtre, son voile, son contenu, les calques du mouvement)
      const bougent = document.getAnimations().filter((a) => {
        const x = a.effect && a.effect.target;
        if (a.playState !== 'running' || !x || x.nodeType !== 1) return false;
        if (a.effect.getComputedTiming().iterations === Infinity) return false;
        return x.classList.contains('pl-calque') || Boolean(f.racine && x.closest(f.racine));
      }).length;
      const traces = Array.prototype.filter.call(document.querySelectorAll('.pl-calque.pl-vol, .pl-calque.pl-voile'), (v) => Number(getComputedStyle(v).opacity) > 0.01).length;
      f.images.push({ t: t - f.t0, present: Boolean(s), vue, lisible, echelle, bougent, traces });
    }
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!f.actif || (e.name !== 'click' && e.name !== 'keydown')) continue;
        f.evenement = { traitement: e.processingEnd - e.processingStart, jusquALImage: e.duration };
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch (e) { /* (sans Event Timing, le traitement du geste n'est pas lu) */ }
})()`;

async function fenetre(page, cdp, geste, ms) {
  const lire = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await page.evaluate(() => { window.__mvt.images = []; window.__mvt.loaf = 0; window.__mvt.actif = true; });
  const a = await lire();
  const t0 = Date.now();
  if (geste) await geste();
  const reste = ms - (Date.now() - t0);
  if (reste > 0) await page.waitForTimeout(reste);
  const b = await lire();
  const sonde = await page.evaluate(() => { const m = window.__mvt; m.actif = false; return { images: m.images.slice(), loaf: m.loaf }; });
  const duree = (Date.now() - t0) / 1000;
  const im = sonde.images;
  const tri = im.slice().sort((x, y) => x - y);
  return {
    secondes: +duree.toFixed(2),
    filOccupe: +(((b.TaskDuration - a.TaskDuration) / duree) * 100).toFixed(1), // % du temps
    styles: Math.round(b.RecalcStyleCount - a.RecalcStyleCount),
    misesEnPage: Math.round(b.LayoutCount - a.LayoutCount),
    imagesParSeconde: +(im.length / duree).toFixed(1),
    acoups: im.filter((x) => x > 50).length,
    pireImage: Math.round(tri[tri.length - 1] || 0),
    p95: Math.round(tri[Math.floor(tri.length * 0.95)] || 0),
    bloque: Math.round(sonde.loaf),
  };
}

// Les fenêtres lues par SONDE_FENETRE : la boîte, son contenu, ce qui bouge avec elle, et la
// fonction de app-main.js qui la dessine (chronométrée seule).
const FICHE = { surface: '#posOverlay:not(.hidden) .edit-modal', contenu: '.pos-sheet', racine: '#posOverlay', rendu: 'renderPosInner' };
const RESERVER = { surface: '#quickBookOverlay:not(.hidden) .qb-modal', contenu: '', racine: '#quickBookOverlay', rendu: 'renderQuickBook' };

const mediane = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};

// Ce que la série d'images dit de l'ouverture (ou de la fermeture).
function analyser(lu, fermeture) {
  const im = lu.images;
  if (!lu.t0 || !im.length) return { erreur: 'aucun geste lu' };
  const t = (i) => (i >= 0 && i < im.length ? Math.round(im[i].t) : null);
  const acoups = (de, a) => {
    let n = 0, pire = 0;
    for (let k = Math.max(1, de + 1); k <= Math.min(a, im.length - 1); k++) {
      const d = im[k].t - im[k - 1].t;
      if (d > 50) n += 1;
      pire = Math.max(pire, d);
    }
    return { acoupsMouvement: n, pireMouvement: Math.round(pire) };
  };
  const base = { traitement: lu.evenement ? Math.round(lu.evenement.traitement) : null, jusquALImage: lu.evenement ? Math.round(lu.evenement.jusquALImage) : null, rendu: lu.rendus.length ? Math.round(lu.rendus[0]) : null };
  if (fermeture) {
    let j = -1;
    im.forEach((x, i) => { if ((x.present && x.vue > 0.01) || x.traces > 0 || x.bougent > 0) j = i; });
    return { ...base, fermee: j + 1 < im.length ? t(j + 1) : null, ...acoups(0, j + 1) };
  }
  const premiere = im.findIndex((x) => x.present);
  let j = -1;
  im.forEach((x, i) => { if (!x.present || x.lisible < 0.999 || Math.abs(x.echelle - 1) > 0.0005 || x.bougent > 0 || x.traces > 0) j = i; });
  return {
    ...base,
    premiere: t(premiere),
    vue: t(im.findIndex((x) => x.vue > 0.05)),
    lisible: t(im.findIndex((x) => x.lisible >= 0.9)),
    complete: j + 1 < im.length ? t(j + 1) : null,
    ...acoups(premiere, j + 1),
  };
}

// Un geste qui ouvre ou ferme une fenêtre : la mesure générale de `fenetre`, et la lecture
// image par image de la sonde.
async function gesteFenetre(page, cdp, quoi, geste, ms, fermeture = false) {
  await page.evaluate((quoi) => {
    const f = window.__fen;
    Object.assign(f, { surface: quoi.surface, contenu: quoi.contenu, racine: quoi.racine, actif: true, t0: 0, images: [], evenement: null, rendus: [] });
    if (quoi.rendu && typeof window[quoi.rendu] === 'function' && !window[quoi.rendu].__banc) {
      const avant = window[quoi.rendu];
      const chrono = function () {
        const t = performance.now();
        try { return avant.apply(this, arguments); } finally { window.__fen.rendus.push(performance.now() - t); }
      };
      chrono.__banc = true;
      window[quoi.rendu] = chrono;
    }
  }, quoi);
  const general = await fenetre(page, cdp, geste, ms);
  const lu = await page.evaluate(() => {
    const f = window.__fen;
    f.actif = false;
    return { t0: f.t0, images: f.images.slice(), evenement: f.evenement, rendus: f.rendus.slice() };
  });
  return { ...general, ...analyser(lu, fermeture) };
}

// Le nom d'une ligne bien à l'écran du planning complet : là où le gérant clique.
async function nomDUneLigne(page, rang = 0) {
  return page.evaluate((rang) => {
    const vus = [];
    for (const tr of document.querySelectorAll('.gf-t tr.gf-r:not(.gf-retenue)')) {
      const nom = tr.querySelector('.gf-nom__t');
      const r = nom ? nom.getBoundingClientRect() : null;
      if (r && r.width > 10 && r.top > 140 && r.bottom < innerHeight - 40) vus.push({ x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 });
    }
    return vus.length ? vus[rang % vus.length] : null;
  }, rang);
}

// Un geste de fenêtre rejoué FOIS fois : la médiane de chaque mesure.
function regrouper(series) {
  const cles = [...new Set(series.flatMap((s) => Object.keys(s)))];
  const out = { fois: series.length };
  for (const c of cles) {
    const vals = series.map((s) => s[c]);
    out[c] = vals.every((v) => typeof v === 'number' || v === null) ? mediane(vals) : vals[0];
  }
  return out;
}

async function sansFinVisibles(page) {
  return page.evaluate(() => {
    const vus = [];
    for (const an of document.getAnimations()) {
      const t = an.effect && an.effect.getComputedTiming ? an.effect.getComputedTiming() : null;
      if (!t || t.iterations !== Infinity || an.playState !== 'running') continue;
      const cible = an.effect.target;
      if (!cible || !cible.isConnected) continue;
      const r = cible.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      if (!visible) continue;
      const nom = an.animationName || an.transitionProperty || an.id || '(js)';
      const quoi = (cible.id ? '#' + cible.id : '') + (cible.classList.length ? '.' + [...cible.classList].slice(0, 2).join('.') : cible.tagName.toLowerCase());
      vus.push(`${nom}@${quoi}${an.effect.pseudoElement || ''}`);
    }
    return [...new Set(vus)];
  });
}

async function aller(page, cle, vue) {
  await page.evaluate(({ cle, vue }) => {
    /* global state, renderStaff */
    state.staffMenuPage = cle;
    if (vue) state.staffResourceView = vue;
    renderStaff();
    window.scrollTo(0, 0);
  }, { cle, vue });
}

async function balayer(page, x0, y0, x1, y1, pas) {
  for (let i = 0; i <= pas; i++) {
    const p = i / pas;
    const ligne = Math.floor(p * 6);
    const xx = ligne % 2 ? x1 - (x1 - x0) * ((p * 6) % 1) : x0 + (x1 - x0) * ((p * 6) % 1);
    await page.mouse.move(xx, y0 + (y1 - y0) * p);
  }
}

async function mesurerVariante(navigateur, variante) {
  const serveur = await F.servir({ port: PORT, transformer: transformateur(variante) });
  const res = { variante, cpu: CPU, pages: {}, gestes: {}, erreurs: [] };
  try {
    const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil: 'ordinateur', theme: 'light', heure: '15:10', port: PORT, mouvementReduit: variante === 'reduit' });
    await page.evaluate(SONDE);
    await page.evaluate(SONDE_FENETRE);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    for (const [cle, vue] of GESTES.length ? [] : PAGES) {
      const nom = vue ? `${cle}:${vue}` : cle;
      try {
        await aller(page, cle, vue);
        await page.waitForTimeout(1800);
        await page.mouse.move(2, 2);
        const repos = await fenetre(page, cdp, null, 3000);
        repos.sansFin = await sansFinVisibles(page);
        res.pages[nom] = repos;
      } catch (e) { res.erreurs.push(`${nom} : ${e.message.slice(0, 120)}`); }
    }

    // Les gestes, sur le planning complet puis le bowling.
    const vp = page.viewportSize();
    await aller(page, 'planning', 'all'); await page.waitForTimeout(1800);
    if (veut('survol-planning')) res.gestes['survol-planning'] = await fenetre(page, cdp, () => balayer(page, 280, 160, vp.width - 40, vp.height - 40, 60), 2500);
    if (veut('molette-planning')) {
      res.gestes['molette-planning'] = await fenetre(page, cdp, async () => {
        await page.mouse.move(vp.width / 2, vp.height / 2);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
      }, 2500);
    }
    // La fiche ouverte d'un vrai clic sur le nom d'une ligne, puis fermée à Échap.
    if (veut('ouvrir-fiche') || veut('fermer-fiche')) {
      const ouvertures = [];
      const fermetures = [];
      for (let i = 0; i < FOIS; i++) {
        await page.evaluate(() => window.scrollTo(0, 0));
        const nom = await nomDUneLigne(page, i);
        if (!nom) { res.erreurs.push('ouvrir-fiche : aucune ligne du planning à l écran'); break; }
        await page.mouse.move(nom.x, nom.y);
        await page.waitForTimeout(300);
        ouvertures.push(await gesteFenetre(page, cdp, FICHE, () => page.mouse.click(nom.x, nom.y), 1400));
        fermetures.push(await gesteFenetre(page, cdp, FICHE, () => page.keyboard.press('Escape'), 1000, true));
        await page.waitForTimeout(400);
      }
      if (veut('ouvrir-fiche')) res.gestes['ouvrir-fiche'] = regrouper(ouvertures);
      if (veut('fermer-fiche')) res.gestes['fermer-fiche'] = regrouper(fermetures);
    }
    if (veut('ouvrir-reserver') || veut('fermer-reserver')) {
      const ouvertures = [];
      const fermetures = [];
      for (let i = 0; i < FOIS; i++) {
        ouvertures.push(await gesteFenetre(page, cdp, RESERVER, () => page.locator('#planningReserver').click({ timeout: 5000 }), 1500));
        fermetures.push(await gesteFenetre(page, cdp, RESERVER, () => page.keyboard.press('Escape'), 1000, true));
        await page.waitForTimeout(400);
      }
      if (veut('ouvrir-reserver')) res.gestes['ouvrir-reserver'] = regrouper(ouvertures);
      if (veut('fermer-reserver')) res.gestes['fermer-reserver'] = regrouper(fermetures);
    }
    await aller(page, 'planning', 'bowling'); await page.waitForTimeout(1800);
    if (veut('survol-bowling')) res.gestes['survol-bowling'] = await fenetre(page, cdp, () => balayer(page, 280, 160, vp.width - 40, vp.height - 40, 60), 2500);
    if (veut('molette-bowling')) {
      res.gestes['molette-bowling'] = await fenetre(page, cdp, async () => {
        await page.mouse.move(vp.width / 2, vp.height / 2);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
      }, 2500);
    }
    // Changer de page au menu, à la souris.
    if (veut('menu-pages')) {
      res.gestes['menu-pages'] = await fenetre(page, cdp, async () => {
        for (const motif of [/R[ée]servations/, /Accueil/, /Planning/]) {
          const lien = page.locator('.ops-sidebar a, .ops-sidebar button').filter({ hasText: motif }).first();
          if (await lien.count()) { await lien.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); }
        }
      }, 3000);
    }
    res.erreurs.push(...erreurs.map((e) => 'page : ' + e.slice(0, 120)));
    await ctx.close();
  } finally {
    serveur.close();
  }
  return res;
}

function tableau(series) {
  const lignes = [];
  const noms = [...new Set(series.flatMap((s) => Object.keys(s.pages)))];
  lignes.push('AU REPOS (3 s) : fil occupé % | recalculs de style | images/s | animations sans fin visibles');
  for (const n of noms) {
    lignes.push(`  ${n.padEnd(20)} ` + series.map((s) => {
      const p = s.pages[n]; if (!p) return `${s.variante}: -`;
      return `${s.variante}: ${String(p.filOccupe).padStart(5)}% ${String(p.styles).padStart(4)} st ${String(p.imagesParSeconde).padStart(5)} i/s ${p.sansFin.length} fin`;
    }).join(' | '));
  }
  lignes.push('GESTES : images/s | à-coups >50 ms | pire image ms | fil occupé % | bloqué ms');
  const gestes = [...new Set(series.flatMap((s) => Object.keys(s.gestes)))];
  for (const g of gestes) {
    lignes.push(`  ${g.padEnd(20)} ` + series.map((s) => {
      const x = s.gestes[g]; if (!x) return `${s.variante}: -`;
      return `${s.variante}: ${String(x.imagesParSeconde).padStart(5)} i/s ${String(x.acoups).padStart(3)} ac ${String(x.pireImage).padStart(4)} ms ${String(x.filOccupe).padStart(5)}% ${String(x.bloque).padStart(5)} bl`;
    }).join(' | '));
  }
  const fenetres = gestes.filter((g) => series.some((s) => s.gestes[g] && s.gestes[g].fois));
  if (fenetres.length) {
    lignes.push('FENETRES, ms depuis le geste (médiane) : première image | vue | lisible >= 0,9 | complète (ou fermée) | à-coups du mouvement | pire image du mouvement | traitement du geste | geste jusqu à l image | rendu seul');
    const n = (v) => String(v == null ? '-' : v).padStart(4);
    for (const g of fenetres) {
      for (const s of series) {
        const x = s.gestes[g];
        if (!x) continue;
        const fin = x.complete !== undefined ? x.complete : x.fermee;
        lignes.push(`  ${g.padEnd(16)} ${s.variante.padEnd(10)} x${x.fois} ${n(x.premiere)} ${n(x.vue)} ${n(x.lisible)} ${n(fin)} | ${n(x.acoupsMouvement)} ac ${n(x.pireMouvement)} ms | ${n(x.traitement)} ${n(x.jusquALImage)} ${n(x.rendu)}`);
      }
    }
  }
  return lignes.join('\n');
}

(async () => {
  for (const k of ['DATABASE_URL', 'RESEND_API_KEY', 'TELEGRAM_JETON', 'ANTHROPIC_API_KEY', 'VERCEL']) delete process.env[k];
  const navigateur = await chromium.launch({ executablePath: NAVIGATEUR, headless: true });
  const series = [];
  try {
    for (const v of VARIANTES) {
      const t = Date.now();
      const r = await mesurerVariante(navigateur, v);
      series.push(r);
      console.error(`variante ${v} mesurée en ${Math.round((Date.now() - t) / 1000)} s`);
    }
  } finally { await navigateur.close(); }
  console.log(tableau(series));
  const base = series[0];
  if (base) {
    console.log('\nANIMATIONS SANS FIN VISIBLES (' + base.variante + ') :');
    for (const [n, p] of Object.entries(base.pages)) if (p.sansFin.length) console.log(`  ${n} : ${p.sansFin.join(', ')}`);
  }
  for (const s of series) if (s.erreurs.length) console.log(`\nERREURS ${s.variante} :\n  ` + s.erreurs.slice(0, 12).join('\n  '));
  if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify(series, null, 2));
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
