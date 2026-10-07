// BANC DE MESURE DU FORMULAIRE FUN GALAXY SUR UN APPAREIL MODESTE.
//
// Deux variantes du MEME formulaire (A : les fichiers d un commit de
// reference, B : ceux du depot, ou --cible=<dossier>) jouent le MEME parcours,
// en alternance A/B/A/B, sur le MEME mock (scripts/dev-tunnel-server.js),
// dans un navigateur dont le processeur est ralenti (CDP
// Emulation.setCPUThrottlingRate) a la taille d un telephone d entree de gamme
// (360x740, DPR 2) et d une tablette modeste (800x1280). L alternance
// neutralise la charge de la machine (une suite qui tourne a cote pese autant
// sur A que sur B). --embed joue le formulaire dans le cadre d une page hote
// (embed.js), comme chez le client : c est le cas a mesurer.
//
// Ce qui est releve, par pas du parcours et pour la visite entiere :
//   - longues taches (PerformanceObserver longtask) : nombre, total ms ;
//   - images perdues : deltas requestAnimationFrame > 32 ms, et la plus longue ;
//   - latence des interactions (Event Timing) : la plus longue, la somme ;
//   - Performance.getMetrics : LayoutCount, RecalcStyleCount, LayoutDuration,
//     RecalcStyleDuration, ScriptDuration, TaskDuration (deltas par pas) ;
//   - couches composees, dans un passage a part (--layers) : LayerTree
//     reconstruit la liste des couches sur le fil principal a chaque peinture,
//     allume pendant une mesure de temps il la fausserait.
//
// Usage :
//   node scripts/fungalaxy-form-perf-bench.js --base=<dossier A> --runs=5
//        --rates=4,6 --devices=phone,tablet --out=<fichier.jsonl> --embed
//   node scripts/fungalaxy-form-perf-bench.js --report=<fichier.jsonl>
//   node scripts/fungalaxy-form-perf-bench.js --base=<dossier A> --shots=<dossier> --rate=4 --device=phone --embed
//   (--trace : une trace par pas, qui a pris le temps ; --layers : les couches)
//
// LE GATE (npm run test:fungalaxy-perf) : node scripts/fungalaxy-form-perf-bench.js --gate
// Des COMPTEURS et des RATIOS, jamais des millisecondes (un seuil absolu
// mesure l humeur de la machine, pas le code : lecon du 2026-08-26). Il joue
// le formulaire dans le cadre d une page hote et verifie ce que les correctifs
// du 2026-10-07 garantissent :
//   - un tiroir de carte ou une plage horaire qui s ouvre redimensionne le
//     cadre une ou deux fois, pas a chaque image, et le contenu ne deborde
//     jamais du cadre pendant la course ;
//   - la page hote qui defile ne fait pas recalculer le style du document
//     entier du cadre (moins d une demi-fois le document pour six defilements) ;
//   - un cadre qui ne change que de hauteur ne force aucun layout ;
//   - pendant que trois tiroirs s ouvrent, au plus 1,8 layout par image (la
//     maconnerie lit tout puis ecrit tout) ;
//   - un tiroir ferme sort du calcul (content-visibility: hidden), l ouvert y est ;
//   - aucune entree finie ne garde de couche composee permanente hors des cartes,
//     et un seul will-change dans la feuille (la photo qui derive en continu) ;
//   - un retour puis un aller sur l ecran des activites garde les memes cartes
//     (rien n est reconstruit quand le jour et le groupe n ont pas change) ;
//   - ce qui anime a chaque changement d ecran ne touche que opacity /
//     transform : le compositeur le joue sans la main.
// Contre-preuves : --gate --casse=vue | tenue | accents | fill | mesure | tiroir | couche | grilles
// (le fichier servi est casse expres a cet endroit : le gate doit rougir).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.resolve(__dirname, '..');
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1']; }));
// Le gate a son port a lui : il peut tourner pendant qu un banc A/B occupe l autre.
const PORT = Number(process.env.PINLANE_FG_PERF_PORT || (process.argv.indexOf('--gate') >= 0 ? 4262 : 4261));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEVICES = {
  phone: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const FICHIERS_VARIANTE = ['fungalaxy.html', 'assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'assets/fungalaxy-sur-mesure.js', 'assets/fungalaxy-sur-mesure.css'];

// --- Le serveur : le mock, et les fichiers du formulaire depuis la racine de la variante ---
let racineVariante = ROOT;
// Les contre-preuves du gate : un fichier servi casse expres, par des paires
// [ancre, remplacement] (chaque ancre doit se trouver une seule fois).
const MUTATIONS = {
  vue: ['assets/fungalaxy-booking.js', '      var haut = Number(d.hautCadre);', "      root.style.setProperty('--tunnel-vue-haut', (Number(d.cacheEnHaut) || 0) + 'px');\n      var haut = Number(d.hautCadre);"],
  tenue: ['assets/fungalaxy-booking.js', '    if (tiroirsEnCours.size) {\n      // La hauteur d arrivee', '    if (false) {\n      // La hauteur d arrivee'],
  accents: ['assets/fungalaxy-booking.js', '    if (accentsEnAttente || window.innerWidth === largeurAccents) return;', '    if (accentsEnAttente) return;'],
  fill: ['assets/fungalaxy-booking.css', '.fg-scene.is-active .fg-rise { animation: fg-rise 0.55s var(--fg-ease-out) backwards;', '.fg-scene.is-active .fg-rise { animation: fg-rise 0.55s var(--fg-ease-out) both;'],
  mesure: ['assets/fungalaxy-booking.js', 'var mesures = tuiles.map(function (tile) { return Math.ceil(tile.getBoundingClientRect().height); });', 'var mesures = null;', 'var col = i % colonnes, h = mesures[i];', 'var col = i % colonnes, h = Math.ceil(tile.getBoundingClientRect().height);'],
  tiroir: ['assets/fungalaxy-booking.css', 'visibility: hidden; content-visibility: hidden; transition: opacity 0.3s', 'visibility: hidden; transition: opacity 0.3s'],
  couche: ['assets/fungalaxy-booking.css', '  /* Pas de will-change (voir .fg-btn). */', '  will-change: transform;'],
  grilles: ['assets/fungalaxy-booking.js', 'if (empreinteGrilles() !== grillesRendues || state.selection.length !== selectionAvant || state.formuleId !== formuleAvant) {', 'if (true) {'],
};
let mutation = null;
function appliquerMutation(fichier, texte) {
  if (!mutation || mutation[0] !== fichier) return texte;
  let s = texte.replace(/\r\n/g, '\n');
  for (let i = 1; i < mutation.length; i += 2) {
    if (s.split(mutation[i]).length !== 2) { console.error(`fungalaxy-form-perf-bench: la mutation ne trouve pas son ancre une seule fois dans ${fichier} : ${mutation[i].slice(0, 60)}`); process.exit(2); }
    s = s.replace(mutation[i], mutation[i + 1]);
  }
  return s;
}
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let fichier = '';
    if (/^\/fungalaxy(\/[a-z0-9-]+)?\/?$/.test(url.pathname)) fichier = 'fungalaxy.html';
    else if (FICHIERS_VARIANTE.indexOf(url.pathname.slice(1)) >= 0) fichier = url.pathname.slice(1);
    if (url.pathname === '/perf-host.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hote</title><style>body{margin:0;background:#fff;font-family:sans-serif}header{height:72px;background:#222}#slot{max-width:1440px;margin:0 auto;padding:24px 0 60px}</style></head><body><header></header><div id="slot"></div><script src="/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#slot" data-height="720" data-track="datalayer"></script></body></html>');
      return;
    }
    if (fichier) {
      const chemin = path.join(racineVariante, fichier);
      fs.readFile(chemin, 'utf8', (err, contenu) => {
        if (err) { console.error(`fungalaxy-form-perf-bench: ${chemin} introuvable (${err.code})`); res.writeHead(404); res.end('Not found'); return; }
        const type = fichier.endsWith('.css') ? 'text/css' : fichier.endsWith('.js') ? 'text/javascript' : 'text/html';
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        res.end(appliquerMutation(fichier, contenu));
      });
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// --- Le collecteur, pose avant tout script de la page -----------------------------
const COLLECTEUR = `(() => {
  const P = window.__fgPerf = { frames: [], long: [], events: [] };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.events.push([e.startTime, e.duration, e.name, e.processingStart - e.startTime, e.processingEnd - e.processingStart]))).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) {}
  const tick = (now) => { if (P.frames.length < 60000) P.frames.push(now); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__fgFenetre = (t0, t1) => {
    const f = P.frames.filter((t) => t >= t0 && t <= t1);
    const deltas = []; for (let i = 1; i < f.length; i += 1) deltas.push(f[i] - f[i - 1]);
    const long = P.long.filter((x) => x[0] + x[1] >= t0 && x[0] <= t1);
    const ev = P.events.filter((x) => x[0] >= t0 - 50 && x[0] <= t1);
    return {
      ms: Math.round(t1 - t0),
      frames: deltas.length,
      dropped: deltas.filter((d) => d > 32).length,
      maxFrame: deltas.length ? Math.round(Math.max.apply(null, deltas)) : 0,
      longN: long.length,
      longMs: Math.round(long.reduce((s, x) => s + x[1], 0)),
      // Les entrees Event Timing d un meme geste (pointerdown, pointerup,
      // click...) se recouvrent : seule la plus longue dit la latence du pas.
      // La « somme » est celle des pires latences, pas a pas.
      evMax: ev.length ? Math.round(Math.max.apply(null, ev.map((x) => x[1]))) : 0,
      evSum: ev.length ? Math.round(Math.max.apply(null, ev.map((x) => x[1]))) : 0,
      evN: ev.length,
    };
  };
  window.__fgCalme = () => {
    const scene = document.querySelector('.fg-scene.is-active') || document.body;
    const racine = document.querySelector('.fg-cal:not([hidden])') || document.querySelector('dialog[open]') || document.querySelector('.fg-vitrine:not([hidden])') ? document.body : scene;
    try {
      return !racine.getAnimations({ subtree: true }).some((a) => { const t = a.effect && a.effect.getComputedTiming(); return a.playState === 'running' && t && t.iterations !== Infinity; });
    } catch (e) { return true; }
  };
})();`;

// --- Les metriques CDP --------------------------------------------------------------
const CLES_CDP = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'Nodes', 'JSHeapUsedSize'];
async function metriques(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  metrics.forEach((m) => { if (CLES_CDP.indexOf(m.name) >= 0) o[m.name] = m.value; });
  return o;
}
function deltaCdp(a, b) {
  return {
    layout: (b.LayoutCount || 0) - (a.LayoutCount || 0),
    recalc: (b.RecalcStyleCount || 0) - (a.RecalcStyleCount || 0),
    layoutMs: Math.round(((b.LayoutDuration || 0) - (a.LayoutDuration || 0)) * 1000),
    recalcMs: Math.round(((b.RecalcStyleDuration || 0) - (a.RecalcStyleDuration || 0)) * 1000),
    scriptMs: Math.round(((b.ScriptDuration || 0) - (a.ScriptDuration || 0)) * 1000),
    taskMs: Math.round(((b.TaskDuration || 0) - (a.TaskDuration || 0)) * 1000),
  };
}

// --- La trace d un pas : qui a pris le temps (attribution, pas comparaison) -----------------
// Tracing.start / Tracing.end autour d un pas ; les evenements complets (ph X)
// sont sommes par nom, les appels de fonction par nom de fonction, le recalcul
// de style par nombre d elements, le layout par objets sales.
async function demarrerTrace(cdp) {
  const events = [];
  const surDonnees = (p) => { events.push(...(p.value || [])); };
  cdp.on('Tracing.dataCollected', surDonnees);
  await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'disabled-by-default-devtools.timeline.invalidationTracking', 'disabled-by-default-devtools.timeline.frame'] } });
  return { events, surDonnees };
}
async function finirTrace(cdp, trace) {
  const fini = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await fini;
  cdp.off('Tracing.dataCollected', trace.surDonnees);
  const parNom = {}, fonctions = {};
  let elements = 0, sales = 0, recalcs = 0, layouts = 0;
  for (const e of trace.events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const n = e.name;
    (parNom[n] = parNom[n] || { n: 0, ms: 0 }); parNom[n].n += 1; parNom[n].ms += e.dur / 1000;
    if (n === 'FunctionCall' && e.args && e.args.data) { const f = (e.args.data.functionName || '(anonyme)') + ':' + (e.args.data.lineNumber || ''); (fonctions[f] = fonctions[f] || { n: 0, ms: 0 }); fonctions[f].n += 1; fonctions[f].ms += e.dur / 1000; }
    if (n === 'UpdateLayoutTree' && e.args) { elements += Number(e.args.elementCount || 0); recalcs += 1; }
    if (n === 'Layout' && e.args && e.args.beginData) { sales += Number(e.args.beginData.dirtyObjects || 0); layouts += 1; }
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1].ms - a[1].ms).slice(0, k).map(([nom, v]) => `${nom} ${Math.round(v.ms)}ms x${v.n}`);
  return { top: top(parNom, 14), fonctions: top(fonctions, 10), elementsRecalcules: elements, recalcs, objetsLayout: sales, layouts };
}

// --- Le parcours ----------------------------------------------------------------------
function attendre(cadre, fn, timeout) { return cadre.waitForFunction(fn, null, { timeout: timeout || 60000, polling: 50 }); }
async function calme(cadre, plafond) {
  // Les animations finies de l ecran courant doivent etre terminees (une
  // entree qui monte encore compte dans la hauteur et dans les images), sans
  // attendre plus que `plafond`.
  try { await cadre.waitForFunction(() => window.__fgCalme && window.__fgCalme(), null, { timeout: plafond || 4000, polling: 60 }); } catch (e) { /* plafond : on mesure quand meme */ }
}

async function pas(ctx, nom, action, fin, options) {
  const { cadre, cdp, resultats, shots } = ctx;
  const o = options || {};
  const avant = await metriques(cdp);
  let trace = null;
  if (ctx.trace) trace = await demarrerTrace(cdp);
  const t0 = await cadre.evaluate(() => performance.now());
  try {
    await action();
    if (fin) await fin();
  } catch (e) { e.message = `[${nom}] ` + e.message; throw e; }
  await calme(cadre, o.plafond);
  const t1 = await cadre.evaluate(() => performance.now());
  if (trace) { const resume = await finirTrace(cdp, trace); ctx.traces.push({ pas: nom, ...resume }); }
  const apres = await metriques(cdp);
  const fen = await cadre.evaluate(([a, b]) => window.__fgFenetre(a, b), [t0, t1]);
  const r = Object.assign({}, fen, deltaCdp(avant, apres), { layers: ctx.couches.n, layersDraw: ctx.couches.draw, layersMo: ctx.couches.mo || 0, nodes: apres.Nodes || 0 });
  if (resultats[nom]) {
    // Un pas repete (pax+, compteur) s additionne : une seule ligne par nom.
    const p = resultats[nom];
    ['ms', 'frames', 'dropped', 'longN', 'longMs', 'evSum', 'evN', 'layout', 'recalc', 'layoutMs', 'recalcMs', 'scriptMs', 'taskMs'].forEach((k) => { p[k] += r[k]; });
    ['maxFrame', 'evMax'].forEach((k) => { p[k] = Math.max(p[k], r[k]); });
    p.layers = r.layers; p.layersDraw = r.layersDraw; p.layersMo = r.layersMo; p.nodes = r.nodes;
  } else resultats[nom] = r;
  if (shots) {
    const page = ctx.page;
    await page.screenshot({ path: path.join(shots, `${String(Object.keys(resultats).length).padStart(2, '0')}-${nom}.png`), fullPage: false });
  }
}

async function parcours(ctx) {
  const { cadre, page } = ctx;
  const url = ctx.embed ? `${BASE_URL}/perf-host.html` : `${BASE_URL}/fungalaxy/libramont`;
  // 1. Le chargement : jusqu au catalogue lu, au rideau fini et a la cascade d entree posee.
  await pas(ctx, 'load', async () => { await page.goto(url, { waitUntil: 'load', timeout: 90000 }); if (ctx.embed) ctx.cadre = await cadreEmbarque(page); },
    async () => attendre(ctx.cadre, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 90000), { plafond: 6000 });
  const f = () => ctx.cadre;
  // 2. Le calendrier : ouvrir, mois suivant, un samedi, ferme.
  await pas(ctx, 'cal-open', () => f().click('#dayBtn'), () => attendre(f(), () => { const p = document.querySelector('#dayPop'); return p && !p.hidden && p.getClientRects().length; }));
  await pas(ctx, 'cal-next', () => f().click('#calNext'), () => f().waitForTimeout(80));
  const samedi = await f().evaluate(() => {
    const jours = Array.from(document.querySelectorAll('#calGrid .fg-cal__day:not([disabled])')).map((b) => b.dataset.date);
    return jours.find((d) => new Date(d + 'T12:00:00').getDay() === 6) || jours[jours.length - 1];
  });
  await pas(ctx, 'cal-pick', () => f().click(`#calGrid .fg-cal__day[data-date="${samedi}"]`), () => attendre(f(), () => document.querySelector('#dayPop').hidden));
  // 3. Le nombre de joueurs : trois pas.
  for (let i = 0; i < 3; i += 1) await pas(ctx, 'pax+', () => f().click('#paxPlus'), () => f().waitForTimeout(60), { plafond: 800 });
  // 4. Vers les activites.
  await pas(ctx, 'to-activites', () => f().click('#goActivities'), () => attendre(f(), () => { const s = document.querySelector('.fg-scene[data-scene="activites"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering') && document.querySelectorAll('#gridAct .fg-card').length > 0; }), { plafond: 5000 });
  // 5. Les cartes : cocher bowling, laser, minigolf ; decocher minigolf ; une pastille ; un compteur.
  const carte = (id) => `#gridAct .fg-card[data-activity="${id}"]`;
  const item = (id) => `#gridAct li[data-activity="${id}"]`;
  await pas(ctx, 'card-on', () => f().click(carte('bowling')), () => attendre(f(), () => document.querySelector('#gridAct li[data-activity="bowling"]').classList.contains('is-on')), { plafond: 2500 });
  await pas(ctx, 'card-on', () => f().click(carte('laser_game')), () => attendre(f(), () => document.querySelector('#gridAct li[data-activity="laser_game"]').classList.contains('is-on')), { plafond: 2500 });
  await pas(ctx, 'card-on', () => f().click(carte('minigolf_blacklight')), () => attendre(f(), () => document.querySelector('#gridAct li[data-activity="minigolf_blacklight"]').classList.contains('is-on')), { plafond: 2500 });
  await pas(ctx, 'card-off', () => f().click(carte('minigolf_blacklight')), () => attendre(f(), () => !document.querySelector('#gridAct li[data-activity="minigolf_blacklight"]').classList.contains('is-on')), { plafond: 2500 });
  await pas(ctx, 'pill', () => f().click(`${item('bowling')} .fg-pills .fg-pill:nth-child(2)`), () => f().waitForTimeout(60), { plafond: 1500 });
  // Le compteur du laser demarre au groupe entier (le « + » est eteint) : deux joueurs de moins.
  for (let i = 0; i < 2; i += 1) await pas(ctx, 'counter', () => f().click(`${item('laser_game')} [data-pas="-1"]`), () => f().waitForTimeout(60), { plafond: 1200 });
  // 6. Un defilement de l ecran des activites (sur la page hote en embarque).
  await pas(ctx, 'scroll', async () => { await page.mouse.move(180, 400); await page.mouse.wheel(0, 500); await page.waitForTimeout(250); await page.mouse.wheel(0, -500); }, () => page.waitForTimeout(200), { plafond: 1500 });
  // 7. La fenetre « i » : ouvrir, fermer.
  await pas(ctx, 'info-open', () => f().click('#gridAct [data-activity-info="bowling"]'), () => attendre(f(), () => { const d = document.querySelector('dialog.fg-info-dialog'); return d && d.open; }), { plafond: 2000 });
  await pas(ctx, 'info-close', () => f().click('dialog.fg-info-dialog .fg-info-close'), () => attendre(f(), () => { const d = document.querySelector('dialog.fg-info-dialog'); return !d || !d.open; }), { plafond: 1500 });
  // 8. Vers les heures : jusqu aux pistes rendues et au calcul fini.
  await pas(ctx, 'to-heures', () => f().click('#goHours'), () => attendre(f(), () => { const z = document.querySelector('#hourZone'); const s = document.querySelector('.fg-scene[data-scene="heures"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering') && z && z.querySelector('.fg-track') && !z.classList.contains('is-busy') && !z.querySelector('.fg-skel'); }, 90000), { plafond: 6000 });
  // 9. Une plage, une heure.
  await pas(ctx, 'period', () => f().click('#hourZone .fg-track .fg-period:last-child .fg-period__btn'), () => attendre(f(), () => document.querySelector('#hourZone .fg-track .fg-period:last-child').classList.contains('is-open')), { plafond: 2500 });
  await pas(ctx, 'chip', () => f().click('#hourZone .fg-period.is-open .fg-chip:not(.is-off):not(.is-on):not([data-ok="false"])'), () => attendre(f(), () => { const z = document.querySelector('#hourZone'); return z && !z.classList.contains('is-busy') && z.querySelector('.fg-chip.is-on'); }, 90000), { plafond: 3000 });
  // 10. Retour, deux fois : jusqu au premier ecran.
  await pas(ctx, 'back', () => f().click('.fg-scene[data-scene="heures"] [data-back]'), () => attendre(f(), () => { const s = document.querySelector('.fg-scene[data-scene="activites"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering'); }), { plafond: 5000 });
  await pas(ctx, 'back', () => f().click('.fg-scene[data-scene="activites"] [data-back]'), () => attendre(f(), () => { const s = document.querySelector('.fg-scene[data-scene="date"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering'); }), { plafond: 5000 });
  // 11. La demande sur mesure : la porte, un type, deux participants de plus.
  await pas(ctx, 'sm-open', () => f().click('#smDoorBtn'), () => attendre(f(), () => { const s = document.querySelector('.fg-scene[data-scene="sm-groupe"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering'); }, 90000), { plafond: 5000 });
  await pas(ctx, 'sm-type', () => f().click('#smTypes .fg-occasion:first-child'), () => f().waitForTimeout(60), { plafond: 1500 });
  for (let i = 0; i < 2; i += 1) await pas(ctx, 'sm-pax+', () => f().click('#smPaxPlus'), () => f().waitForTimeout(60), { plafond: 800 });
}

async function cadreEmbarque(page) {
  await page.waitForSelector('iframe', { timeout: 60000 });
  const el = await page.$('iframe');
  const cadre = await el.contentFrame();
  await cadre.waitForLoadState('load');
  return cadre;
}

// --- Les polices de Google, servies une fois et gardees : le reseau ne pese pas sur la mesure ---
const cachePolices = new Map();
async function routerPolices(context) {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const cle = route.request().url();
    if (!cachePolices.has(cle)) {
      try {
        const r = await route.fetch();
        cachePolices.set(cle, { status: r.status(), headers: r.headers(), body: await r.body() });
      } catch (e) { cachePolices.set(cle, null); }
    }
    const c = cachePolices.get(cle);
    if (!c) { await route.abort(); return; }
    await route.fulfill({ status: c.status, headers: c.headers, body: c.body });
  });
}

async function unPassage(browser, variante, racine, device, rate, options) {
  racineVariante = racine;
  const context = await browser.newContext(Object.assign({}, DEVICES[device], { locale: 'fr-BE' }));
  await routerPolices(context);
  await context.addInitScript(COLLECTEUR);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const couches = { n: 0, draw: 0, mo: 0 };
  // LayerTree reconstruit la liste des couches sur le fil principal a chaque
  // peinture : allume pendant une mesure de temps, il la fausse (plus de
  // couches, plus de surcout). Il ne s allume que dans un passage dedie
  // (--layers), qui ne sert qu a compter les couches.
  if (options.layers) try {
    await cdp.send('LayerTree.enable');
    // Les couches qui peignent, et la surface totale qu elles tiennent en
    // memoire video (largeur x hauteur x 4 octets, a l echelle du DPR) : ce
    // que le GPU recompose a chaque image. Un ralentissement du processeur ne
    // voit pas ce cout-la ; la surface des couches, si.
    cdp.on('LayerTree.layerTreeDidChange', (p) => {
      const l = p.layers || [];
      couches.n = l.length;
      couches.draw = l.filter((x) => x.drawsContent).length;
      couches.mo = Math.round(l.filter((x) => x.drawsContent).reduce((s, x) => s + (x.width || 0) * (x.height || 0) * 4, 0) / 1048576 * 10) / 10;
    });
  } catch (e) { /* pas de LayerTree : on garde 0 */ }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const ctx = { page, cadre: page, cdp, couches, resultats: {}, shots: options.shots, embed: options.embed, trace: options.trace, traces: [] };
  const debut = Date.now();
  let echec = '';
  try { await parcours(ctx); } catch (e) { echec = String(e && e.message || e).split('\n')[0]; }
  const total = {};
  Object.values(ctx.resultats).forEach((r) => {
    ['ms', 'frames', 'dropped', 'longN', 'longMs', 'evSum', 'evN', 'layout', 'recalc', 'layoutMs', 'recalcMs', 'scriptMs', 'taskMs'].forEach((k) => { total[k] = (total[k] || 0) + r[k]; });
    ['maxFrame', 'evMax'].forEach((k) => { total[k] = Math.max(total[k] || 0, r[k]); });
  });
  total.layersMax = Math.max.apply(null, Object.values(ctx.resultats).map((r) => r.layers).concat([0]));
  total.layersMoMax = Math.max.apply(null, Object.values(ctx.resultats).map((r) => r.layersMo || 0).concat([0]));
  total.nodes = (Object.values(ctx.resultats).slice(-1)[0] || {}).nodes || 0;
  const ligne = { variante, device, rate, embed: Boolean(options.embed), duree: Date.now() - debut, echec, erreurs: erreurs.slice(0, 5), total, pas: ctx.resultats, traces: ctx.traces };
  await context.close();
  return ligne;
}

// --- Le rapport : medianes par (appareil, ralentissement, variante) ------------------------
function mediane(liste) { const l = liste.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!l.length) return NaN; const m = Math.floor(l.length / 2); return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2; }
function rapport(fichier) {
  const lignes = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => !l.echec);
  const echecs = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.echec);
  if (echecs.length) console.log(`${echecs.length} passage(s) en echec : ${echecs.map((e) => `${e.variante}/${e.device}/${e.rate}x : ${e.echec}`).join(' | ')}`);
  const groupes = {};
  lignes.forEach((l) => { const k = `${l.device}|${l.rate}|${l.embed ? 'embed' : 'page'}`; (groupes[k] = groupes[k] || {})[l.variante] = (groupes[k][l.variante] || []).concat([l]); });
  const CLES = [['longMs', 'longues taches ms'], ['longN', 'longues taches n'], ['dropped', 'images perdues'], ['maxFrame', 'image la + longue ms'], ['evMax', 'interaction max ms'], ['evSum', 'interactions somme ms'], ['layout', 'layouts'], ['recalc', 'recalcs style'], ['layoutMs', 'layout ms'], ['recalcMs', 'recalc ms'], ['scriptMs', 'script ms'], ['taskMs', 'taches ms'], ['layersMax', 'couches max'], ['layersMoMax', 'couches Mo max'], ['ms', 'duree parcours ms']];
  Object.keys(groupes).sort().forEach((k) => {
    const g = groupes[k];
    const variantes = Object.keys(g).sort();
    console.log(`\n=== ${k.replace(/\|/g, ' · ')}  (${variantes.map((v) => `${v}: ${g[v].length} passages`).join(', ')}) ===`);
    const entete = ['metrique'].concat(variantes).concat(variantes.length === 2 ? ['B/A'] : []);
    console.log(entete.map((s, i) => String(s).padEnd(i ? 10 : 26)).join(''));
    CLES.forEach(([cle, label]) => {
      const vals = variantes.map((v) => mediane(g[v].map((l) => l.total[cle])));
      const ratio = variantes.length === 2 && vals[0] ? (vals[1] / vals[0]).toFixed(2) : '';
      console.log([label].concat(vals.map((x) => Number.isFinite(x) ? String(Math.round(x * 10) / 10) : '-')).concat(ratio ? [ratio] : []).map((s, i) => String(s).padEnd(i ? 10 : 26)).join(''));
    });
    // Par pas : les interactions cles.
    const nomsPas = Object.keys((g[variantes[0]][0] || {}).pas || {});
    console.log('\n  par pas (mediane) : interaction max ms | longues taches ms | images perdues | layouts | script ms');
    nomsPas.forEach((nom) => {
      const cellule = (v) => { const ls = g[v].map((l) => l.pas[nom]).filter(Boolean); return ['evMax', 'longMs', 'dropped', 'layout', 'scriptMs', 'recalcMs', 'layoutMs', 'layersMo'].map((c) => Math.round(mediane(ls.map((p) => p[c] || 0)))).join('/'); };
      console.log(`  ${nom.padEnd(14)} ${variantes.map((v) => `${v}: ${cellule(v).padEnd(34)}`).join(' ')}`);
    });
  });
}

// --- Le gate : un budget en ratio, et la forme des regles ---------------------------------
function proprietesDesKeyframes(css, nom) {
  const debut = css.indexOf('@keyframes ' + nom + ' ');
  if (debut < 0) return null;
  // Le bloc entier : des accolades comptees depuis la premiere.
  let i = css.indexOf('{', debut), prof = 0, fin = -1;
  for (; i < css.length; i += 1) { if (css[i] === '{') prof += 1; else if (css[i] === '}') { prof -= 1; if (prof === 0) { fin = i; break; } } }
  if (fin < 0) return null;
  const bloc = css.slice(css.indexOf('{', debut) + 1, fin);
  const props = [];
  bloc.replace(/\{([^}]*)\}/g, (_, corps) => { corps.split(';').forEach((d) => { const p = d.split(':')[0].trim(); if (p) props.push(p); }); return ''; });
  return props;
}
// Les evenements d une trace, sur le fil principal du rendu (celui qui porte
// les recalculs de style) : le cadre embarque partage ce fil avec la page hote.
async function tracer(cdp, action) {
  const events = [];
  const sur = (p) => { events.push(...(p.value || [])); };
  cdp.on('Tracing.dataCollected', sur);
  await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] } });
  await action();
  const fini = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await fini;
  cdp.off('Tracing.dataCollected', sur);
  const comptes = {};
  events.forEach((e) => { if (e.name === 'UpdateLayoutTree' || e.name === 'Layout') comptes[e.pid + ':' + e.tid] = (comptes[e.pid + ':' + e.tid] || 0) + 1; });
  const fil = (Object.entries(comptes).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  return events.filter((e) => e.ph === 'X' && e.pid + ':' + e.tid === fil);
}
const deuxImages = (cadre) => cadre.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// Pendant un geste, image par image : le contenu du cadre depasse-t-il le
// cadre (une bande du bas coupee par la page hote) ?
function sonderCoupes(cadre, duree) {
  return cadre.evaluate((d) => {
    window.__fgCoupes = { images: 0, coupees: 0, pire: 0 };
    const fin = performance.now() + d;
    const t = () => { const c = window.__fgCoupes; const deb = document.body.scrollHeight - window.innerHeight; c.images += 1; if (deb > 2) { c.coupees += 1; c.pire = Math.max(c.pire, deb); } if (performance.now() < fin) requestAnimationFrame(t); };
    requestAnimationFrame(t);
  }, duree);
}
async function gate() {
  const casse = ARGS.casse || '';
  if (casse && !MUTATIONS[casse]) { console.error(`fungalaxy-form-perf-bench: contre-preuve inconnue ${casse}`); process.exit(2); }
  mutation = casse ? MUTATIONS[casse] : null;
  let echecs = 0;
  const ok = (cond, label, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!cond) echecs += 1; return cond; };
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // --- La forme des regles, lue dans la feuille SERVIE (mutation comprise), sans ses commentaires ---
    const css = appliquerMutation('assets/fungalaxy-booking.css', fs.readFileSync(path.join(ROOT, 'assets/fungalaxy-booking.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    const willChange = (css.match(/will-change\s*:/g) || []).length;
    const willChangePhoto = /\.fg-art img \{[^}]*will-change: transform;/.test(css);
    ok(willChange === 1 && willChangePhoto, 'un seul will-change dans la feuille, celui de la photo qui derive en continu', `${willChange} occurrence(s)`);
    const COMPOSITEUR = ['opacity', 'transform', 'translate', 'scale'];
    ['fg-seg-fill', 'fg-step-in', 'fg-word', 'fg-rise', 'fg-fade-in', 'fg-fade-out', 'fg-slide-in', 'fg-slide-out', 'fg-settle', 'fg-drift'].forEach((nom) => {
      const props = proprietesDesKeyframes(css, nom);
      ok(Boolean(props) && props.length > 0 && props.every((p) => COMPOSITEUR.indexOf(p) >= 0), `@keyframes ${nom} n anime que des proprietes du compositeur`, props ? props.join(', ') : 'absent');
    });

    // --- Le formulaire tel que le client le voit : dans le cadre d une page hote (embed.js) ---
    const context = await browser.newContext(Object.assign({}, DEVICES.phone, { locale: 'fr-BE' }));
    await routerPolices(context);
    await context.addInitScript(COLLECTEUR);
    // Cote hote : chaque hauteur que le cadre poste.
    await context.addInitScript(() => {
      if (location.pathname !== '/perf-host.html') return;
      window.__fgHauteurs = [];
      window.addEventListener('message', (e) => { if (e.data && e.data.type === 'pinlane:height') window.__fgHauteurs.push(e.data.height); });
    });
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`${BASE_URL}/perf-host.html`, { waitUntil: 'load', timeout: 90000 });
    const cadre = await cadreEmbarque(page);
    await attendre(cadre, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 90000);
    await calme(cadre, 6000);
    const ctx = { page, cadre, cdp, couches: { n: 0, draw: 0, mo: 0 }, resultats: {}, shots: '', embed: true, trace: false, traces: [] };
    const scene = (nom) => cadre.waitForFunction((n) => { const s = document.querySelector('.fg-scene[data-scene="' + n + '"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering'); }, nom, { timeout: 60000, polling: 50 });
    await cadre.click('#goActivities');
    await attendre(cadre, () => { const s = document.querySelector('.fg-scene[data-scene="activites"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering') && document.querySelectorAll('#gridAct .fg-card').length > 0; });
    await calme(cadre, 5000);
    const nbHauteurs = () => page.evaluate(() => window.__fgHauteurs.length);

    // 1. Un tiroir de carte qui s ouvre (0,4 s) : la hauteur du cadre est
    //    posee d emblee, pas suivie image par image (avant : une quinzaine de
    //    redimensionnements, chacun un layout du document entier) ; et le
    //    contenu ne deborde jamais du cadre pendant la course.
    let avant = await nbHauteurs();
    await sonderCoupes(cadre, 900);
    await pas(ctx, 'card-on', () => cadre.click('#gridAct .fg-card[data-activity="bowling"]'), () => cadre.waitForTimeout(900), { plafond: 2500 });
    let coupes = await cadre.evaluate(() => window.__fgCoupes);
    let postees = (await nbHauteurs()) - avant;
    const hauteursTiroir = await page.evaluate((n) => window.__fgHauteurs.slice(n).join(' > '), avant);
    // La bande d informations sous la carte (immediate), la maconnerie qui la
    // place, puis la hauteur d arrivee : trois au plus, contre une par image.
    ok(postees <= 3, 'un tiroir de carte qui s ouvre redimensionne le cadre au plus trois fois, pas a chaque image', `${postees} hauteur(s) postee(s) : ${hauteursTiroir}`);
    ok(coupes.coupees <= 1, 'pendant cette ouverture, le contenu ne deborde pas du cadre (au plus une image)', `${coupes.coupees}/${coupes.images} images coupees, au pire ${coupes.pire} px`);
    for (const id of ['laser_game', 'minigolf_blacklight']) {
      await pas(ctx, 'card-on', () => cadre.click(`#gridAct .fg-card[data-activity="${id}"]`), () => cadre.waitForFunction((x) => document.querySelector(`#gridAct li[data-activity="${x}"]`).classList.contains('is-on'), id, { timeout: 10000, polling: 50 }), { plafond: 2500 });
    }
    const cvConnu = await cadre.evaluate(() => CSS.supports('content-visibility', 'hidden'));
    const etats = await cadre.evaluate(() => Array.from(document.querySelectorAll('#gridAct li[data-activity]')).map((li) => ({ id: li.dataset.activity, on: li.classList.contains('is-on'), cv: getComputedStyle(li.querySelector('.fg-card__optin')).contentVisibility })));
    ok(etats.filter((e) => e.on).length === 3, 'trois cartes cochees', etats.filter((e) => e.on).map((e) => e.id).join(', '));
    if (cvConnu) ok(etats.filter((e) => e.on).every((e) => e.cv === 'visible') && etats.filter((e) => !e.on).every((e) => e.cv === 'hidden'), 'tiroir ferme : content-visibility hidden ; tiroir ouvert : visible', etats.map((e) => `${e.id}:${e.on ? 'on' : 'off'}/${e.cv}`).join(' '));
    else console.log('skip  content-visibility inconnu de ce navigateur');
    const r = ctx.resultats['card-on'];
    const ratio = r.layout / Math.max(1, r.frames);
    ok(ratio <= 1.8, 'au plus 1,8 layout par image pendant que trois tiroirs s ouvrent (la maconnerie lit tout puis ecrit tout)', `${r.layout} layouts / ${r.frames} images = ${ratio.toFixed(2)}`);

    // 2. La page hote defile : le cadre recoit la zone visible a chaque image.
    //    Elle ne doit pas recalculer le style du document entier (avant : une
    //    variable heritee posee sur la racine, un millier d elements par image).
    const elements = await cadre.evaluate(() => document.getElementsByTagName('*').length);
    const evDefil = await tracer(cdp, async () => {
      for (const y of [120, 240, 360, 480, 600, 720]) { await page.evaluate((v) => window.scrollTo(0, v), y); await deuxImages(page); }
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const recalcules = evDefil.filter((e) => e.name === 'UpdateLayoutTree').reduce((s, e) => s + Number(e.args && e.args.elementCount || 0), 0);
    ok(recalcules < elements / 2, 'six defilements de la page hote recalculent moins d une demi-fois le document du cadre', `${recalcules} elements recalcules, ${elements} dans le document : ${(recalcules / elements).toFixed(2)} fois`);

    // 3. Le cadre ne change que de hauteur (la page hote le redimensionne) :
    //    rien ne relit la position des mots du titre dans une image (layout force).
    const cadreHtml = await page.$('iframe');
    const evHauteur = await tracer(cdp, async () => {
      for (let i = 0; i < 6; i += 1) { await cadreHtml.evaluate((f, n) => { f.style.height = (f.getBoundingClientRect().height + 40) + 'px'; }, i); await deuxImages(page); }
    });
    const images = evHauteur.filter((e) => e.name === 'FireAnimationFrame');
    const forces = evHauteur.filter((e) => e.name === 'Layout' && images.some((f) => e.ts >= f.ts && e.ts <= f.ts + f.dur)).length;
    ok(forces === 0, 'un cadre qui ne change que de hauteur ne force aucun layout dans une image', `${forces} layout(s) force(s) en ${images.length} rappels d image`);

    // 4. Retour au jour puis avance sans rien changer : les cartes ne sont pas
    //    reconstruites (memes noeuds, tiroirs ouverts compris).
    const premiereCarte = await cadre.evaluateHandle(() => document.querySelector('#gridAct .fg-card'));
    await cadre.click('.fg-scene[data-scene="activites"] [data-back]');
    await scene('date');
    await calme(cadre, 4000);
    await cadre.click('#goActivities');
    await scene('activites');
    await calme(cadre, 4000);
    const memeNoeud = await cadre.evaluate((avant) => avant === document.querySelector('#gridAct .fg-card') && avant.isConnected, premiereCarte);
    ok(memeNoeud, 'revenir sur les activites sans rien changer garde les memes cartes (aucune reconstruction)');

    // 5. Une plage horaire qui s ouvre sur l ecran des heures : meme regle que le tiroir.
    await cadre.click('#goHours');
    await attendre(cadre, () => { const z = document.querySelector('#hourZone'); const s = document.querySelector('.fg-scene[data-scene="heures"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering') && z && z.querySelector('.fg-track') && !z.classList.contains('is-busy') && !z.querySelector('.fg-skel'); }, 90000);
    await calme(cadre, 6000);
    avant = await nbHauteurs();
    await sonderCoupes(cadre, 900);
    await cadre.click('#hourZone .fg-track .fg-period:last-child .fg-period__btn');
    await cadre.waitForTimeout(900);
    coupes = await cadre.evaluate(() => window.__fgCoupes);
    postees = (await nbHauteurs()) - avant;
    ok(postees <= 1, 'une plage horaire qui s ouvre redimensionne le cadre au plus une fois', `${postees} hauteur(s) postee(s)`);
    ok(coupes.coupees <= 1, 'pendant cette ouverture, le contenu ne deborde pas du cadre (au plus une image)', `${coupes.coupees}/${coupes.images} images coupees, au pire ${coupes.pire} px`);

    // 6. Une entree finie ne garde pas son etat d arrivee : en fill both, le
    //    navigateur la tient pour en cours et garde a l element sa couche
    //    composee pour toujours. Seules les cartes la gardent (leur fill
    //    l emporte sur l opacite d une carte grisee, rendu a ne pas changer),
    //    et la photo (fg-settle, que la derive relaie).
    await calme(cadre, 4000);
    const restes = await cadre.evaluate(() => document.getAnimations().filter((a) => {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      const cible = a.effect && a.effect.target;
      return a.playState === 'finished' && /both|forwards/.test(t.fill) && a.animationName !== 'fg-settle' && !(cible && cible.closest && cible.closest('.fg-card'));
    }).map((a) => `${a.animationName}@${a.effect.target.className || a.effect.target.tagName}`));
    ok(restes.length === 0, 'aucune entree finie ne garde de couche permanente hors des cartes', restes.slice(0, 6).join(' '));

    ok(erreurs.length === 0, 'aucune erreur de page', erreurs.slice(0, 3).join(' / '));
    await context.close();
  } finally {
    await browser.close();
    srv.close();
  }
  if (echecs) { console.error(`\nfungalaxy-form-perf-bench --gate : ${echecs} FAIL${casse ? ` (contre-preuve ${casse} : le rouge est attendu)` : ''}`); process.exit(1); }
  console.log(`\nfungalaxy-form-perf-bench --gate : ALL OK${casse ? ` (contre-preuve ${casse} : le gate aurait du rougir)` : ''}`);
  if (casse) process.exit(1);
}

async function main() {
  if (ARGS.report) { rapport(ARGS.report); return; }
  if (ARGS.gate) { await gate(); return; }
  const base = ARGS.base ? path.resolve(ARGS.base) : '';
  // --cible : un autre dossier que le depot pour B (une variante d essai).
  const cible = ARGS.cible ? path.resolve(ARGS.cible) : ROOT;
  const variantes = base ? [['A', base], ['B', cible]] : [['B', cible]];
  const runs = Number(ARGS.runs || 5);
  const rates = String(ARGS.rates || ARGS.rate || '4,6').split(',').map(Number);
  const devices = String(ARGS.devices || ARGS.device || 'phone,tablet').split(',');
  const out = ARGS.out ? path.resolve(ARGS.out) : '';
  const shots = ARGS.shots ? path.resolve(ARGS.shots) : '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const device of devices) {
      for (const rate of rates) {
        for (let run = 0; run < runs; run += 1) {
          for (const [variante, racine] of variantes) {
            const dossierShots = shots ? path.join(shots, `${variante}-${device}-${rate}x`) : '';
            if (dossierShots) fs.mkdirSync(dossierShots, { recursive: true });
            const ligne = await unPassage(browser, variante, racine, device, rate, { shots: dossierShots, embed: ARGS.embed === '1', trace: ARGS.trace === '1', layers: ARGS.layers === '1' });
            if (ARGS.trace === '1') ligne.traces.forEach((t) => { console.log(`  [${t.pas}] recalcs ${t.recalcs} (${t.elementsRecalcules} elements) · layouts ${t.layouts} (${t.objetsLayout} objets)
     ${t.top.join(' | ')}
     fn: ${t.fonctions.join(' | ')}`); });
            ligne.run = run;
            const t = ligne.total;
            console.log(`${variante} ${device} ${rate}x #${run + 1}: ${ligne.echec ? 'ECHEC ' + ligne.echec : ''} long ${t.longMs} ms (${t.longN}) · perdues ${t.dropped}/${t.frames} · evMax ${t.evMax} · layouts ${t.layout} · recalcs ${t.recalc} · script ${t.scriptMs} ms · couches ${t.layersMax} · ${Math.round(ligne.duree / 1000)} s${ligne.erreurs.length ? ' · erreurs: ' + ligne.erreurs.join(' / ') : ''}`);
            if (out) fs.appendFileSync(out, JSON.stringify(ligne) + '\n');
          }
          if (shots || ARGS.trace === '1') break;
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (out) rapport(out);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { serveur, COLLECTEUR, DEVICES, BASE_URL, BROWSER_PATH, routerPolices, attendre, calme, cadreEmbarque, demarrerTrace, finirTrace, metriques, deltaCdp, poserRacine: (r) => { racineVariante = r; } };
