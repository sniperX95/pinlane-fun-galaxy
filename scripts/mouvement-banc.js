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
//
// Usage : node scripts/mouvement-banc.js [variante,variante] [--cpu=4] [--sortie=fichier.json]
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
    const { ctx, page, erreurs } = await F.monter(navigateur, { fixture: 'pic', appareil: 'ordinateur', theme: 'light', heure: '15:10', port: PORT });
    await page.evaluate(SONDE);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    for (const [cle, vue] of PAGES) {
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
    res.gestes['survol-planning'] = await fenetre(page, cdp, () => balayer(page, 280, 160, vp.width - 40, vp.height - 40, 60), 2500);
    res.gestes['molette-planning'] = await fenetre(page, cdp, async () => {
      await page.mouse.move(vp.width / 2, vp.height / 2);
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    }, 2500);
    res.gestes['ouvrir-reserver'] = await fenetre(page, cdp, async () => {
      await page.locator('#planningReserver').click({ timeout: 5000 });
    }, 1500);
    res.gestes['fermer-reserver'] = await fenetre(page, cdp, () => page.keyboard.press('Escape'), 1000);
    await aller(page, 'planning', 'bowling'); await page.waitForTimeout(1800);
    res.gestes['survol-bowling'] = await fenetre(page, cdp, () => balayer(page, 280, 160, vp.width - 40, vp.height - 40, 60), 2500);
    res.gestes['molette-bowling'] = await fenetre(page, cdp, async () => {
      await page.mouse.move(vp.width / 2, vp.height / 2);
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    }, 2500);
    // Changer de page au menu, à la souris.
    res.gestes['menu-pages'] = await fenetre(page, cdp, async () => {
      for (const motif of [/R[ée]servations/, /Accueil/, /Planning/]) {
        const lien = page.locator('.ops-sidebar a, .ops-sidebar button').filter({ hasText: motif }).first();
        if (await lien.count()) { await lien.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); }
      }
    }, 3000);
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
