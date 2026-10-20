// LE FORMULAIRE FUN GALAXY EST FLUIDE SUR UN TELEPHONE PEU PUISSANT
// (Movsar, 2026-10-19 : « le formulaire rame encore pour les appareils moins
// puissants, c est pas fluide, les animations d ouverture, fermeture etc.
// sont super lentes ; l idee c est pas de les supprimer mais d optimiser »).
//
// UN BANC, ANIMATION PAR ANIMATION. Le vrai formulaire (fungalaxy.html et ses
// fichiers) sur le mock du serveur de dev (scripts/dev-tunnel-server.js), dans
// Edge a la taille d un telephone (390x844, DPR 2, tactile), le processeur
// ralenti par CDP (Emulation.setCPUThrottlingRate, 4x puis 6x). Chaque geste
// du parcours est une fenetre de mesure, du toucher (horodatage de
// l evenement) a la fin de la derniere animation finie qu il a lancee :
//   - images perdues : rappels requestAnimationFrame, chaque ecart compte les
//     images de 16,7 ms qu il a sautees ;
//   - longues images (PerformanceObserver long-animation-frame) : nombre,
//     total, la plus longue, et le script qui les porte ;
//   - duree reelle contre duree prevue (la plus longue fin d animation,
//     delai compris) : ce qui deborde est un demarrage en retard ;
//   - latence du geste (Event Timing) ;
//   - Performance.getMetrics : layouts, recalculs de style, script, en
//     nombre et en ms ; avec --trace, les peintures et les layouts du fil
//     principal, par geste.
//
// Usage :
//   node scripts/formulaire-fluide-check.js --bench --base=<dossier A> [--cible=<dossier B>]
//        --runs=3 --rates=4,6 --out=<fichier.jsonl> [--embed] [--trace] [--pas=a,b]
//   node scripts/formulaire-fluide-check.js --report=<fichier.jsonl>
// A et B jouent le MEME parcours en alternance A/B/A/B : la charge de la
// machine pese autant sur l un que sur l autre (ratio, jamais seuil absolu).
//
// LE GATE (npm run test:formulaire-fluide) : sans argument, puis --mutate
// (les contre-epreuves). Voir gate().
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.resolve(__dirname, '..');
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1']; }));
const PORT = Number(process.env.PINLANE_FLUIDE_PORT || 4271);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' };
const FICHIERS_VARIANTE = ['fungalaxy.html', 'assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'assets/fungalaxy-sur-mesure.js', 'assets/fungalaxy-sur-mesure.css'];
const IMAGE = 1000 / 60;

// --- Le serveur : le mock, et les fichiers du formulaire depuis la racine de la variante ---
let racineVariante = ROOT;
let mutation = null; // [fichier, ancre, remplacement, ...] servi en memoire
let mutationServie = 0;
function appliquerMutation(fichier, texte) {
  if (!mutation || mutation[0] !== fichier) return texte;
  let s = texte.replace(/\r\n/g, '\n');
  for (let i = 1; i < mutation.length; i += 2) {
    if (s.split(mutation[i]).length !== 2) { console.error(`formulaire-fluide: la mutation ne trouve pas son ancre une seule fois dans ${fichier} : ${mutation[i].slice(0, 70)}`); process.exit(2); }
    s = s.replace(mutation[i], mutation[i + 1]);
  }
  mutationServie += 1;
  return s;
}
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let fichier = '';
    if (/^\/fungalaxy(\/[a-z0-9-]+)?\/?$/.test(url.pathname)) fichier = 'fungalaxy.html';
    else if (FICHIERS_VARIANTE.indexOf(url.pathname.slice(1)) >= 0) fichier = url.pathname.slice(1);
    if (url.pathname === '/fluide-hote.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hote</title><style>body{margin:0;background:#fff;font-family:sans-serif}header{height:72px;background:#222}#slot{max-width:1440px;margin:0 auto;padding:24px 0 60px}</style></head><body><header></header><div id="slot"></div><script src="/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#slot" data-height="720" data-track="datalayer"></script></body></html>');
      return;
    }
    if (fichier) {
      const chemin = path.join(racineVariante, fichier);
      fs.readFile(chemin, 'utf8', (err, contenu) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
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
function reinitialiserMock() {
  mock.occupationDev.length = 0;
  mock.blocagesDev.clear();
  const seaux = globalThis.__pinlaneRateBuckets;
  if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations)|custom-request/.test(k)).forEach((k) => seaux.delete(k));
}

// --- Le collecteur, pose avant tout script de la page -----------------------------
const COLLECTEUR = `(() => {
  const P = window.__fl = { frames: [], loaf: [], ev: [], geste: 0 };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration || 0, s: (e.scripts || []).map((x) => ({ f: x.sourceFunctionName || '', c: x.sourceCharPosition, u: String(x.sourceURL || '').split('/').pop().split('?')[0], d: x.duration, i: String(x.invoker || '').slice(0, 60) })) }))).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.ev.push([e.startTime, e.duration, e.name]))).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) {}
  ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, (e) => { P.geste = e.timeStamp; }, true));
  const tick = (now) => { P.frames.push(now); if (P.frames.length > 120000) P.frames.splice(0, 60000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // Les animations finies en cours (les sans fin, reflets et roues, ne comptent pas).
  const enCours = () => document.getAnimations().filter((a) => { const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; return t && t.iterations !== Infinity && (a.playState === 'running' || a.pending); });
  window.__flCalme = () => enCours().length === 0;
  // La fin du geste : plus aucune animation finie a deux relevés de suite, au
  // plus tot 150 ms apres le toucher (une transition naitra au recalcul
  // suivant). Releve toutes les 90 ms, jamais a chaque image :
  // document.getAnimations() force un recalcul de style, la sonde pesait sur
  // ce qu elle mesure. Chaque animation vue donne sa fin prevue (delai + duree
  // depuis le toucher) et sa fin reelle (son debut reel + delai + duree).
  window.__flFin = (depuis, plafond) => new Promise((resolve) => {
    const vues = new Map(); let calmes = 0;
    const tour = () => {
      const now = performance.now();
      const l = enCours();
      l.forEach((a) => { if (!vues.has(a)) vues.set(a, { nom: a.animationName || a.transitionProperty || a.id || '?', fin: a.effect.getComputedTiming().endTime, cible: a.effect.target ? (a.effect.target.id || String(a.effect.target.className || a.effect.target.tagName).split(' ')[0]) : '' }); const v = vues.get(a); if (a.startTime != null) v.debut = a.startTime; });
      calmes = l.length ? 0 : calmes + 1;
      if ((calmes >= 2 && now - depuis > 150) || now - depuis > plafond) {
        let prevue = 0, reelle = 0; const noms = {};
        vues.forEach((v) => { prevue = Math.max(prevue, v.fin); reelle = Math.max(reelle, (v.debut != null ? v.debut - depuis : 0) + v.fin); const k = v.nom + '@' + v.cible; noms[k] = (noms[k] || 0) + 1; });
        resolve({ fin: now, prevue: Math.round(prevue), reelle: Math.round(reelle), n: vues.size, noms: Object.entries(noms).sort((x, y) => y[1] - x[1]).slice(0, 8).map((x) => x[0] + (x[1] > 1 ? ' x' + x[1] : '')), plafond: now - depuis > plafond });
        return;
      }
      setTimeout(tour, 90);
    };
    tour();
  });
  window.__flFenetre = (t0, t1) => {
    const f = P.frames.filter((t) => t >= t0 && t <= t1);
    // perdues : sur toute la fenetre ; course : apres la premiere image du geste
    // (le demarrage, du toucher a cette image, se compte a part).
    let perdues = 0, pire = 0, course = 0;
    for (let i = 1; i < f.length; i += 1) { const d = f[i] - f[i - 1], n = Math.max(0, Math.round(d / ${IMAGE}) - 1); perdues += n; if (i >= 2) course += n; pire = Math.max(pire, d); }
    const demarrage = f.length > 1 ? Math.round(f[1] - t0) : 0;
    const loaf = P.loaf.filter((x) => x.t + x.d >= t0 && x.t <= t1);
    const scripts = {};
    loaf.forEach((x) => x.s.forEach((s) => { const k = (s.f || s.i || '?') + '@' + s.u + ':' + s.c; scripts[k] = (scripts[k] || 0) + s.d; }));
    const ev = P.ev.filter((x) => x[0] >= t0 - 30 && x[0] <= t1);
    return {
      images: Math.max(0, f.length - 1), perdues, course, demarrage, pire: Math.round(pire),
      loafN: loaf.length, loafMs: Math.round(loaf.reduce((s, x) => s + x.d, 0)), loafMax: Math.round(loaf.reduce((m, x) => Math.max(m, x.d), 0)), bloque: Math.round(loaf.reduce((s, x) => s + x.b, 0)),
      scripts: Object.entries(scripts).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0] + ' ' + Math.round(x[1]) + 'ms'),
      geste: ev.length ? Math.round(Math.max.apply(null, ev.map((x) => x[1]))) : 0,
    };
  };
})();`;

// --- Les metriques CDP --------------------------------------------------------------
async function metriques(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  metrics.forEach((m) => { o[m.name] = m.value; });
  return o;
}
function delta(a, b) {
  return {
    layouts: (b.LayoutCount || 0) - (a.LayoutCount || 0),
    recalcs: (b.RecalcStyleCount || 0) - (a.RecalcStyleCount || 0),
    layoutMs: Math.round(((b.LayoutDuration || 0) - (a.LayoutDuration || 0)) * 1000),
    recalcMs: Math.round(((b.RecalcStyleDuration || 0) - (a.RecalcStyleDuration || 0)) * 1000),
    scriptMs: Math.round(((b.ScriptDuration || 0) - (a.ScriptDuration || 0)) * 1000),
    tacheMs: Math.round(((b.TaskDuration || 0) - (a.TaskDuration || 0)) * 1000),
  };
}
// Une trace du geste : ce que le fil principal du rendu a fait, image par image.
async function demarrerTrace(cdp) {
  const events = [];
  const sur = (p) => { events.push(...(p.value || [])); };
  cdp.on('Tracing.dataCollected', sur);
  await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack', 'blink'] } });
  return { events, sur };
}
async function finirTrace(cdp, trace, dump) {
  const fini = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await fini;
  cdp.off('Tracing.dataCollected', trace.sur);
  const ev = trace.events;
  // Le fil principal : celui qui porte le plus de recalculs de style.
  const comptes = {};
  ev.forEach((e) => { if (e.name === 'UpdateLayoutTree' || e.name === 'Layout') comptes[e.pid + ':' + e.tid] = (comptes[e.pid + ':' + e.tid] || 0) + 1; });
  const fil = (Object.entries(comptes).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  const principal = ev.filter((e) => e.ph === 'X' && e.pid + ':' + e.tid === fil);
  if (dump) fs.writeFileSync(dump, JSON.stringify(principal.map((e) => ({ n: e.name, ts: e.ts, dur: e.dur || 0, a: e.args && (e.args.data || e.args.beginData || e.args.elementCount != null ? { d: e.args.data && { f: e.args.data.functionName, l: e.args.data.lineNumber, u: String(e.args.data.url || '').split('/').pop(), st: (e.args.data.stackTrace || []).slice(0, 4).map((x) => x.functionName + ':' + x.lineNumber), clip: e.args.data.clip, node: e.args.data.nodeId, layer: e.args.data.layerId, nom: e.args.data.nodeName }, b: e.args.beginData && { dirty: e.args.beginData.dirtyObjects, total: e.args.beginData.totalObjects, st: (e.args.beginData.stackTrace || []).slice(0, 4).map((x) => x.functionName + ':' + x.lineNumber) }, el: e.args.elementCount } : null) }))));
  const somme = (nom) => { const l = principal.filter((e) => e.name === nom); return { n: l.length, ms: Math.round(l.reduce((s, e) => s + (e.dur || 0), 0) / 1000) }; };
  const parNom = {};
  principal.forEach((e) => { (parNom[e.name] = parNom[e.name] || { n: 0, ms: 0 }); parNom[e.name].n += 1; parNom[e.name].ms += (e.dur || 0) / 1000; });
  const raster = ev.filter((e) => e.ph === 'X' && /RasterTask|Rasterize/.test(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  const elements = principal.filter((e) => e.name === 'UpdateLayoutTree').reduce((s, e) => s + Number(e.args && e.args.elementCount || 0), 0);
  const sales = principal.filter((e) => e.name === 'Layout').reduce((s, e) => s + Number(e.args && e.args.beginData && e.args.beginData.dirtyObjects || 0), 0);
  // Les images presentees par le compositeur (PipelineReporter) et leur etat.
  const etats = {};
  ev.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.args && e.args.chrome_frame_reporter).forEach((e) => { const s = e.args.chrome_frame_reporter.state || '?'; etats[s] = (etats[s] || 0) + 1; });
  return {
    layout: somme('Layout'), style: somme('UpdateLayoutTree'), paint: somme('Paint'), prePaint: somme('PrePaint'), layerize: somme('Layerize'), commit: somme('Commit'),
    raster: Math.round(raster), elements, sales, etats,
    top: Object.entries(parNom).sort((a, b) => b[1].ms - a[1].ms).slice(0, 10).map(([n, v]) => `${n} ${Math.round(v.ms)}ms x${v.n}`),
  };
}

// --- Le parcours, geste par geste ------------------------------------------------------
const attendre = (cadre, fn, ms, arg) => cadre.waitForFunction(fn, arg, { timeout: ms || 60000, polling: 50 });
async function calme(cadre, ms) { try { await cadre.waitForFunction(() => window.__flCalme && window.__flCalme(), null, { timeout: ms || 5000, polling: 60 }); } catch (e) { /* on mesure quand meme */ } }

async function geste(ctx, nom, action, pret, options) {
  const o = options || {};
  if (ctx.filtre && !ctx.filtre.has(nom)) { await action(); if (pret) await pret(); await calme(ctx.f(), o.plafond || 6000); return; }
  await calme(ctx.f(), 6000);
  await ctx.f().evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const avant = await metriques(ctx.cdp);
  const trace = ctx.trace ? await demarrerTrace(ctx.cdp) : null;
  const profil = ctx.profil && ctx.profil.has(nom) && !(ctx.resultats[nom] || []).length;
  if (profil) { await ctx.cdp.send('Profiler.enable'); await ctx.cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await ctx.cdp.send('Profiler.start'); }
  const t0 = await ctx.f().evaluate(() => { window.__fl.geste = 0; return performance.now(); });
  try { await action(); if (pret) await pret(); } catch (e) { e.message = `[${nom}] ` + e.message; throw e; }
  const clic = await ctx.f().evaluate((t) => window.__fl.geste || t, t0);
  const fin = await ctx.f().evaluate(([c, p]) => window.__flFin(c, p), [clic, o.plafond || 6000]);
  const fen = await ctx.f().evaluate(([a, b]) => window.__flFenetre(a, b), [clic, fin.fin]);
  const traceRes = trace ? await finirTrace(ctx.cdp, trace, ctx.dump && ctx.dump.has(nom) && !(ctx.resultats[nom] || []).length ? path.join(ctx.dumpDir, `dump-${nom}.json`) : '') : null;
  if (profil) {
    const { profile } = await ctx.cdp.send('Profiler.stop');
    const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
    const parFn = {};
    profile.nodes.forEach((n) => { const k = (n.callFrame.functionName || '(anonyme)') + ':' + (n.callFrame.lineNumber + 1) + ' ' + String(n.callFrame.url || '').split('/').pop().split('?')[0]; parFn[k] = (parFn[k] || 0) + (n.hitCount || 0) * dt; });
    console.log(`  [profil ${nom}] ` + Object.entries(parFn).filter((x) => !/^(idle)|^(program)/.test(x[0])).sort((a, b) => b[1] - a[1]).slice(0, 22).map((x) => `${x[0]} ${Math.round(x[1])}ms`).join(' | '));
  }
  const apres = await metriques(ctx.cdp);
  const r = Object.assign({ ms: Math.round(fin.fin - clic), prevue: fin.prevue, reelle: fin.reelle, retard: Math.max(0, fin.reelle - fin.prevue), anims: fin.n, noms: fin.noms, plafond: fin.plafond }, fen, delta(avant, apres), traceRes ? { trace: traceRes } : {});
  (ctx.resultats[nom] = ctx.resultats[nom] || []).push(r);
}

async function cadreEmbarque(page) {
  await page.waitForSelector('iframe', { timeout: 60000 });
  const cadre = await (await page.$('iframe')).contentFrame();
  await cadre.waitForLoadState('load');
  return cadre;
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
async function allerAuMois(f, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${MOIS[mo - 1].charAt(0).toUpperCase()}${MOIS[mo - 1].slice(1)} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await f.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nomMois, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nomMois.toLowerCase());
    await f.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(f, (x) => document.querySelector('#calTitle').textContent.trim() !== x, 6000, titre);
  }
  await attendre(f, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.disabled && !b.classList.contains('is-loading'); }, 30000, dateStr);
}
const sceneActive = (f, nom, ms) => attendre(f, (n) => { const s = document.querySelector('.fg-scene[data-scene="' + n + '"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering'); }, ms || 60000, nom);

async function parcours(ctx) {
  const { page } = ctx;
  const f = () => ctx.f();
  // 1. L arrivee : rideau, mots du titre, cascade d entree.
  await page.goto(ctx.embed ? `${BASE_URL}/fluide-hote.html` : `${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'load', timeout: 90000 });
  if (ctx.embed) { const c = await cadreEmbarque(page); ctx.f = () => c; }
  await attendre(f(), () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 90000);
  await calme(f(), 8000);
  // 2. Le calendrier : ouvrir, un mois puis l autre, choisir le jour du mock.
  await geste(ctx, 'calendrier-ouvre', () => f().click('#dayBtn'), () => attendre(f(), () => { const p = document.querySelector('#dayPop'); return p && !p.hidden && p.getClientRects().length; }));
  await geste(ctx, 'calendrier-mois', () => f().click('#calNext'), () => attendre(f(), () => !document.querySelector('#calGrid .is-loading')), { plafond: 3000 });
  await geste(ctx, 'calendrier-mois', () => f().click('#calPrev'), () => attendre(f(), () => !document.querySelector('#calGrid .is-loading')), { plafond: 3000 });
  await allerAuMois(f(), mock.DATE);
  await geste(ctx, 'calendrier-ferme', () => f().click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`), () => attendre(f(), () => document.querySelector('#dayPop').hidden));
  // 3. Le compteur de joueurs.
  for (let i = 0; i < 3; i += 1) await geste(ctx, 'compteur-joueurs', () => f().click('#paxPlus'), null, { plafond: 1500 });
  // 4. Vers les activites.
  await geste(ctx, 'scene-activites', () => f().click('#goActivities'), () => sceneActive(f(), 'activites'), { plafond: 6000 });
  await attendre(f(), () => document.querySelectorAll('#gridAct .fg-card').length > 0);
  // 5. Les cartes et leur tiroir.
  const item = (id) => `#gridAct li[data-activity="${id}"]`;
  for (const id of ['bowling', 'laser_game', 'minigolf_blacklight']) {
    await geste(ctx, 'tiroir-ouvre', () => f().click(`${item(id)} .fg-card`), () => attendre(f(), (x) => document.querySelector(`#gridAct li[data-activity="${x}"]`).classList.contains('is-on'), 10000, id), { plafond: 3000 });
  }
  await geste(ctx, 'tiroir-ferme', () => f().click(`${item('minigolf_blacklight')} .fg-card`), () => attendre(f(), () => !document.querySelector('#gridAct li[data-activity="minigolf_blacklight"]').classList.contains('is-on')), { plafond: 3000 });
  await geste(ctx, 'pastille', () => f().click(`${item('bowling')} .fg-pills .fg-pill:nth-child(2)`), null, { plafond: 2000 });
  for (let i = 0; i < 2; i += 1) await geste(ctx, 'compteur-activite', () => f().click(`${item('laser_game')} [data-pas="-1"]`), null, { plafond: 1500 });
  // 6. Les onglets : les formules, puis retour aux activites.
  await geste(ctx, 'onglet', () => f().click('#tabFor'), () => attendre(f(), () => { const p = document.querySelector('#panelFor'); return p && !p.hidden; }), { plafond: 4000 });
  await geste(ctx, 'onglet', () => f().click('#tabAct'), () => attendre(f(), () => { const p = document.querySelector('#panelAct'); return p && !p.hidden; }), { plafond: 4000 });
  // 7. La fenetre « i ».
  await geste(ctx, 'info-ouvre', () => f().click('#gridAct [data-activity-info="bowling"]'), () => attendre(f(), () => { const d = document.querySelector('dialog.fg-info-dialog'); return d && d.open; }), { plafond: 3000 });
  await geste(ctx, 'info-ferme', () => f().click('dialog.fg-info-dialog .fg-info-close'), () => attendre(f(), () => { const d = document.querySelector('dialog.fg-info-dialog'); return !d || !d.open; }), { plafond: 3000 });
  // 8. Les heures : le programme, ses lignes et ses plages.
  await geste(ctx, 'scene-heures', () => f().click('#goHours'), () => attendre(f(), () => { const z = document.querySelector('#hourZone'); const s = document.querySelector('.fg-scene[data-scene="heures"]'); return s && s.classList.contains('is-active') && !s.classList.contains('is-entering') && z && z.querySelector('.fg-etape.is-open') && !z.classList.contains('is-busy') && !z.querySelector('.fg-skel'); }, 90000), { plafond: 8000 });
  const ligne = '#hourZone .fg-etape.is-open';
  await geste(ctx, 'plage', () => f().click(`${ligne} .fg-period:not(.is-open) .fg-period__btn`), () => attendre(f(), () => document.querySelector('#hourZone .fg-etape.is-open .fg-period.is-open')), { plafond: 3000 });
  const cle = await f().evaluate(() => document.querySelector('#hourZone .fg-etape.is-open').dataset.cle);
  await geste(ctx, 'ligne-ferme', () => f().click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`), () => attendre(f(), (c) => !document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`).classList.contains('is-open'), 5000, cle), { plafond: 3000 });
  await geste(ctx, 'ligne-ouvre', () => f().click(`#hourZone .fg-etape[data-cle="${cle}"] .fg-etape__tete`), () => attendre(f(), (c) => document.querySelector(`#hourZone .fg-etape[data-cle="${c}"]`).classList.contains('is-open'), 5000, cle), { plafond: 3000 });
  // Une heure libre de la plage ouverte : le calcul, puis la ligne suivante.
  const heure = await f().evaluate(() => {
    const libres = Array.from(document.querySelectorAll('#hourZone .fg-etape.is-open .fg-period.is-open .fg-chip')).filter((x) => x.dataset.ok !== 'false' && x.dataset.state === 'ok' && !x.classList.contains('is-on') && !x.classList.contains('is-proposed'));
    return libres.length ? libres[0].dataset.time : '';
  });
  if (heure) {
    await geste(ctx, 'heure', () => f().click(`#hourZone .fg-etape.is-open .fg-period.is-open .fg-chip[data-time="${heure}"]`), () => attendre(f(), () => { const z = document.querySelector('#hourZone'); return !z.classList.contains('is-busy'); }, 60000), { plafond: 6000 });
  }
  await attendre(f(), () => !document.querySelector('#goContact').disabled && !document.querySelector('#hourZone').classList.contains('is-busy'), 60000);
  // 9. Les coordonnees, le recapitulatif et sa vitrine.
  await geste(ctx, 'scene-contact', () => f().click('#goContact'), () => sceneActive(f(), 'contact'), { plafond: 6000 });
  if (await f().evaluate(() => { const t = document.querySelector('#recallToggle'); return Boolean(t && t.getClientRects().length); })) {
    await geste(ctx, 'recap-replie', () => f().click('#recallToggle'), null, { plafond: 2000 });
    await geste(ctx, 'recap-replie', () => f().click('#recallToggle'), null, { plafond: 2000 });
  }
  await f().fill('#cPrenom', 'Camille');
  await f().fill('#cNom', 'Test');
  await f().fill('#cEmail', 'groupe@example.org');
  await f().fill('#cTel', '0491301667');
  await f().click('.fg-occasion[data-occasion="anniversaire"]');
  await f().check('#cConsent');
  await geste(ctx, 'scene-recap', () => f().click('#goRecap'), async () => { await sceneActive(f(), 'recap'); await attendre(f(), () => !document.querySelector('#vitrine').hasAttribute('data-attendue'), 15000); }, { plafond: 8000 });
  if (await f().evaluate(() => !document.querySelector('#vitrine').hidden)) {
    await geste(ctx, 'vitrine-ferme', () => f().click('#vitrine .fg-vitrine__non'), () => attendre(f(), () => document.querySelector('#vitrine').hidden, 5000), { plafond: 3000 });
  }
  // 10. La confirmation : l ecran final.
  await geste(ctx, 'scene-fin', () => f().click('#confirmBtn'), () => sceneActive(f(), 'fin', 60000), { plafond: 8000 });
}

async function unPassage(browser, variante, racine, rate, options) {
  racineVariante = racine;
  reinitialiserMock();
  const context = await browser.newContext(TELEPHONE);
  await context.addInitScript(COLLECTEUR);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const ctx = { page, f: () => page, cdp, resultats: {}, embed: options.embed, trace: options.trace, filtre: options.filtre, profil: options.profil, dump: options.dump, dumpDir: options.dumpDir };
  const debut = Date.now();
  let echec = '';
  try { await parcours(ctx); } catch (e) { echec = String(e && e.message || e).split('\n')[0]; }
  await context.close();
  return { variante, rate, embed: Boolean(options.embed), duree: Date.now() - debut, echec, erreurs: erreurs.slice(0, 5), pas: ctx.resultats };
}

// --- Le rapport : medianes par (ralentissement, geste, variante) ------------------------
function mediane(l) { const s = l.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return NaN; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const somme = (l) => l.reduce((s, x) => s + x, 0);
// Un geste repete (trois tiroirs, trois « + ») se somme par passage, puis la mediane des passages.
function parPassage(lignes, nom, cle) { return lignes.map((l) => (l.pas[nom] || []).map((p) => (cle.split('.').reduce((o, k) => (o == null ? o : o[k]), p)))).filter((v) => v.length).map((v) => (cle === 'pire' || cle === 'loafMax' ? Math.max.apply(null, v) : somme(v))); }
function rapport(fichier) {
  const toutes = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const echecs = toutes.filter((l) => l.echec);
  if (echecs.length) console.log(`${echecs.length} passage(s) en echec : ${echecs.map((e) => `${e.variante}/${e.rate}x : ${e.echec}`).join(' | ')}`);
  const lignes = toutes.filter((l) => !l.echec);
  const rates = [...new Set(lignes.map((l) => l.rate))].sort();
  const variantes = [...new Set(lignes.map((l) => l.variante))].sort();
  const COL = [['perdues', 'perdues'], ['course', 'course'], ['demarrage', 'demarrage'], ['loafN', 'LoAF n'], ['loafMs', 'LoAF ms'], ['pire', 'pire img'], ['retard', 'retard'], ['geste', 'geste ms'], ['layouts', 'layouts'], ['layoutMs', 'layout ms'], ['recalcMs', 'style ms'], ['scriptMs', 'script ms'], ['trace.paint.n', 'paints'], ['trace.paint.ms', 'paint ms'], ['trace.layout.n', 'layouts(tr)']];
  for (const rate of rates) {
    const g = lignes.filter((l) => l.rate === rate);
    console.log(`\n=== ${rate}x · ${variantes.map((v) => `${v}: ${g.filter((l) => l.variante === v).length} passages`).join(', ')} ===`);
    const noms = [...new Set(g.flatMap((l) => Object.keys(l.pas)))];
    console.log('geste'.padEnd(20) + COL.map(([, lb]) => lb.padStart(variantes.length === 2 ? 17 : 10)).join(''));
    for (const nom of noms) {
      const cells = COL.map(([cle]) => {
        const vals = variantes.map((v) => mediane(parPassage(g.filter((l) => l.variante === v), nom, cle)));
        if (vals.every((x) => !Number.isFinite(x))) return ''.padStart(variantes.length === 2 ? 17 : 10);
        const txt = vals.map((x) => (Number.isFinite(x) ? String(Math.round(x)) : '-')).join('>');
        return txt.padStart(variantes.length === 2 ? 17 : 10);
      });
      console.log(nom.padEnd(20) + cells.join(''));
    }
    // Les durees prevue / reelle et ce qui anime (premier passage de A).
    const premier = g.find((l) => l.variante === variantes[0]);
    if (premier) for (const nom of noms) { const p = (premier.pas[nom] || [])[0]; if (p) console.log(`  ${nom.padEnd(18)} prevue ${p.prevue} ms, reelle ${p.reelle} ms, ${p.anims} anim : ${p.noms.join(', ')}${p.scripts && p.scripts.length ? ' | LoAF : ' + p.scripts.join(', ') : ''}${p.trace ? ' | ' + p.trace.top.slice(0, 6).join(', ') : ''}`); }
  }
}

async function bench() {
  const base = ARGS.base ? path.resolve(ARGS.base) : '';
  const cible = ARGS.cible ? path.resolve(ARGS.cible) : ROOT;
  const variantes = base ? [['A', base], ['B', cible]] : [['B', cible]];
  const runs = Number(ARGS.runs || 3);
  const rates = String(ARGS.rates || '4,6').split(',').map(Number);
  const out = ARGS.out ? path.resolve(ARGS.out) : '';
  const filtre = ARGS.pas ? new Set(String(ARGS.pas).split(',')) : null;
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    for (const rate of rates) {
      for (let run = 0; run < runs; run += 1) {
        for (const [variante, racine] of (run % 2 ? variantes.slice().reverse() : variantes)) {
          const ligne = await unPassage(browser, variante, racine, rate, { embed: ARGS.embed === '1', trace: ARGS.trace === '1', filtre, profil: ARGS.profil ? new Set(String(ARGS.profil).split(',')) : null, dump: ARGS.dump ? new Set(String(ARGS.dump).split(',')) : null, dumpDir: path.resolve(ARGS.dumpdir || '.') });
          ligne.run = run;
          const tot = (k) => somme(Object.values(ligne.pas).flat().map((p) => p[k] || 0));
          console.log(`${variante} ${rate}x #${run + 1}: ${ligne.echec ? 'ECHEC ' + ligne.echec + ' · ' : ''}perdues ${tot('perdues')} · LoAF ${tot('loafN')} (${tot('loafMs')} ms) · layouts ${tot('layouts')} · ${Math.round(ligne.duree / 1000)} s${ligne.erreurs.length ? ' · erreurs: ' + ligne.erreurs.join(' / ') : ''}`);
          if (out) fs.appendFileSync(out, JSON.stringify(ligne) + '\n');
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (out) rapport(out);
}

// --- LE GATE (npm run test:formulaire-fluide) ------------------------------------------
// Le tiroir d une carte d activite se deplie sur le compositeur (FLIP, voir
// tiroirSurCompositeur dans assets/fungalaxy-booking.js). Le gate compare, dans
// le MEME passage et le MEME navigateur, le formulaire tel qu il est et sa
// REFERENCE : les memes fichiers, la transition d avant (grid-template-rows),
// obtenue en faisant dire au navigateur qu il ne connait pas `translate`
// (le formulaire garde alors la feuille d avant, html sans .fg-flip). Des
// COMPTEURS et des RATIOS contre cette reference, jamais un seuil absolu :
//   [G1] ouvrir ou fermer un tiroir ne remet plus la page en page a chaque
//        image : sur les cinq gestes, au plus 40 % des layouts de la
//        reference (elle en fait un par image ; releve 2026-10-19, 4x : 31
//        contre 130, 0,24) ;
//   [G2] les cartes du dessous gardent leur place dans la mise en page
//        (offsetTop constant des le geste) et glissent a l ecran (au moins
//        cinq positions differentes : elles glissent, elles ne sautent pas) ;
//   [G3] le contenu du tiroir se devoile par un translate (une animation
//        `translate` sur sa boite pendant l ouverture) ;
//   [G4] meme rendu final : apres la meme suite de gestes, chaque carte a la
//        meme place, la meme taille et le meme tiroir que dans la reference ;
//   [G5] a 6x, les images perdues pendant la course (apres la premiere image
//        du geste), sommees sur dix gestes : au plus 60 % de la reference,
//        jouee en alternance dans le meme passage ;
//   [G6] mouvement reduit : pas de .fg-flip, aucun glissement, le tiroir
//        s ouvre quand meme.
// Contre-epreuves (--mutate) : chaque correctif est retire EN MEMOIRE (servi
// mute), un a la fois ; les assertions qui le portent doivent rougir, la
// mutation servie, sans qu aucun MONTAGE ne rougisse.
const MUTATIONS_GATE = [
  { nom: 'la rangee du tiroir s anime de nouveau en hauteur (grid-template-rows)', fichier: 'assets/fungalaxy-booking.css', de: '.fg-flip :is(#gridAct, #smGridAct) > .fg-grid__item > .fg-card__opt { transition: none; }', vers: '', attendu: ['[G1]', '[G5]'], passe2: true },
  { nom: 'les cartes du dessous sautent a leur place au lieu de glisser', fichier: 'assets/fungalaxy-booking.js', de: '      if (d || t._fgGlisse) glisser(t, d, 0);', vers: '      void d;', attendu: ['[G2]'] },
  { nom: 'le contenu du tiroir n est plus devoile par translate', fichier: 'assets/fungalaxy-booking.js', de: '      if (x.ouvre) { glisser(x.dedans, x.vu - x.H, 0, null, auCarre); glisser(x.boite, x.H - x.vu, 0, null, auCarre); return; }', vers: '      if (x.ouvre) return;', attendu: ['[G3]'] },
];
const PREUVE_MUTATION = '[mutation] servie en memoire :';
const SANS_TRANSLATE = () => {
  const brut = CSS.supports.bind(CSS);
  CSS.supports = function (a, b) { if (String(a).trim() === 'translate') return false; return arguments.length > 1 ? brut(a, b) : brut(a); };
};
const GESTES_TIROIR = [['bowling', true], ['laser_game', true], ['minigolf_blacklight', true], ['minigolf_blacklight', false], ['laser_game', false]];

async function ouvrirActivites(browser, { reference, cpu, reduit }) {
  reinitialiserMock();
  const context = await browser.newContext(Object.assign({}, TELEPHONE, reduit ? { reducedMotion: 'reduce' } : {}));
  await context.addInitScript(COLLECTEUR);
  if (reference) await context.addInitScript(SANS_TRANSLATE);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'load', timeout: 90000 });
  await attendre(page, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 90000);
  // Le jour du mock, jamais celui que le formulaire propose (aujourd hui : le
  // soir, plus rien n est reservable).
  await page.click('#dayBtn');
  await attendre(page, () => { const p = document.querySelector('#dayPop'); return p && !p.hidden && p.getClientRects().length; });
  await allerAuMois(page, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden);
  await page.click('#goActivities');
  await sceneActive(page, 'activites');
  await attendre(page, () => document.querySelectorAll('#gridAct .fg-card').length > 0);
  await calme(page, 8000);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  return { context, page, cdp, erreurs };
}
// Un geste sur une carte : les layouts du geste (CDP), les images perdues de
// la course, et, si demande, la place des cartes du dessous image par image.
async function gesteTiroir(ctx, id, ouvre, suivre) {
  const { page, cdp } = ctx;
  await calme(page, 6000);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (suivre) {
    await page.evaluate((x) => {
      const li = document.querySelector(`#gridAct li[data-activity="${x}"]`);
      const dessous = Array.from(document.querySelectorAll('#gridAct > li[data-activity]')).filter((t) => t !== li && t.style.gridColumn === li.style.gridColumn && t.offsetTop > li.offsetTop);
      const s = window.__fgSuivi = { cartes: dessous.map(() => []), devoile: false, n: dessous.length };
      const fin = performance.now() + 900;
      const tour = () => {
        // Seulement les images ou le geste a eu lieu (la carte est cochee).
        if (li.classList.contains('is-on')) {
          dessous.forEach((t, k) => s.cartes[k].push([t.offsetTop, Math.round(t.getBoundingClientRect().top * 10) / 10]));
          const d = li.querySelector('.fg-card__optin');
          if (d && d.getAnimations().some((a) => !a.transitionProperty && !a.animationName)) s.devoile = true;
        }
        if (performance.now() < fin) requestAnimationFrame(tour);
      };
      requestAnimationFrame(tour);
    }, id);
  }
  const m0 = await metriques(cdp);
  const t0 = await page.evaluate(() => { window.__fl.geste = 0; return performance.now(); });
  await page.click(`#gridAct li[data-activity="${id}"] .fg-card`);
  await attendre(page, ([x, o]) => document.querySelector(`#gridAct li[data-activity="${x}"]`).classList.contains('is-on') === o, 10000, [id, ouvre]);
  const clic = await page.evaluate((t) => window.__fl.geste || t, t0);
  const fin = await page.evaluate(([c]) => window.__flFin(c, 3000), [clic]);
  const fen = await page.evaluate(([a, b]) => window.__flFenetre(a, b), [clic, fin.fin]);
  const m1 = await metriques(cdp);
  const r = { layouts: (m1.LayoutCount || 0) - (m0.LayoutCount || 0), course: fen.course, images: fen.images };
  if (suivre) { await page.waitForTimeout(950); r.suivi = await page.evaluate(() => window.__fgSuivi); }
  return r;
}
async function etatFinal(page) {
  await calme(page, 6000);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100)))));
  return page.evaluate(() => {
    const g = document.querySelector('#gridAct').getBoundingClientRect();
    return Array.from(document.querySelectorAll('#gridAct > li[data-activity]')).map((li) => {
      const r = li.getBoundingClientRect(), opt = li.querySelector('.fg-card__opt');
      return `${li.dataset.activity}:${li.classList.contains('is-on') ? 'on' : 'off'}:${li.style.gridColumn}/${li.style.gridRow}:${Math.round(r.top - g.top)}+${Math.round(r.height)}:${opt ? Math.round(opt.getBoundingClientRect().height) : '-'}`;
    }).join(' | ');
  });
}

async function gate() {
  const indice = Number(process.env.PINLANE_FLUIDE_MUTATION || 0);
  const m = indice ? MUTATIONS_GATE[indice - 1] : null;
  if (m) mutation = [m.fichier, m.de, m.vers];
  let echecs = 0;
  const ok = (cond, label, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined && detail !== '' ? `  (${detail})` : ''}`); if (!cond) echecs += 1; return cond; };
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  const total = (l) => l.reduce((s, x) => s + x, 0);
  try {
    // --- Passage 1 (4x) : les compteurs, le suivi image par image, le rendu final ---
    const res = {};
    for (const reference of [true, false]) {
      const ctx = await ouvrirActivites(browser, { reference, cpu: 4 });
      const flip = await ctx.page.evaluate(() => document.documentElement.classList.contains('fg-flip'));
      ok(flip === !reference, `MONTAGE ${reference ? 'la reference garde la transition d avant (sans .fg-flip)' : 'le formulaire deplie ses tiroirs sur le compositeur (.fg-flip)'}`);
      const gestes = [];
      for (const [id, ouvre] of GESTES_TIROIR) gestes.push(await gesteTiroir(ctx, id, ouvre, id === 'laser_game' && ouvre));
      res[reference ? 'ref' : 'flip'] = { gestes, fin: await etatFinal(ctx.page), erreurs: ctx.erreurs };
      await ctx.context.close();
    }
    const { ref, flip } = res;
    const layouts = (g) => g.gestes.map((x) => x.layouts);
    ok(Math.min(...layouts(ref)) >= 10, 'MONTAGE la reference remet la page en page pendant ses tiroirs (au moins 10 layouts par geste)', layouts(ref).join(' '));
    const ratio = total(layouts(flip)) / Math.max(1, total(layouts(ref)));
    ok(ratio <= 0.4, '[G1] ouvrir ou fermer un tiroir : sur les cinq gestes, au plus 40 % des layouts de la reference', `formulaire ${layouts(flip).join(' ')} ; reference ${layouts(ref).join(' ')} ; ${ratio.toFixed(2)}`);
    // Les cartes sous le laser (meme colonne) pendant son ouverture.
    const sRef = ref.gestes[1].suivi, sFlip = flip.gestes[1].suivi;
    const distincts = (l, k) => new Set(l.map((x) => x[k])).size;
    ok(sRef.n > 0 && sRef.cartes.every((l) => distincts(l, 0) >= 5), 'MONTAGE dans la reference, les cartes du dessous descendent par la mise en page (offsetTop change d image en image)', sRef.cartes.map((l) => `${distincts(l, 0)} places sur ${l.length} images`).join(' ; ') || 'aucune carte dessous');
    const fixes = sFlip.cartes.every((l) => l.length >= 5 && distincts(l, 0) === 1);
    const glissent = sFlip.n > 0 && sFlip.cartes.every((l) => distincts(l, 1) >= 5);
    ok(fixes && glissent, '[G2] les cartes du dessous gardent leur place dans la mise en page et glissent a l ecran', sFlip.cartes.map((l) => `${distincts(l, 0)} place(s), ${distincts(l, 1)} positions sur ${l.length} images`).join(' ; ') || 'aucune carte dessous');
    ok(sFlip.devoile === true, '[G3] le contenu du tiroir se devoile par un translate pendant l ouverture');
    ok(flip.fin === ref.fin, '[G4] meme rendu final que la reference (places, tailles, tiroirs)', flip.fin === ref.fin ? '' : `\n      formulaire ${flip.fin}\n      reference  ${ref.fin}`);
    ok(ref.erreurs.length === 0 && flip.erreurs.length === 0, 'aucune erreur de page', ref.erreurs.concat(flip.erreurs).slice(0, 3).join(' / '));

    // --- Passage 2 (6x) : les images perdues de la course, en alternance avec la reference ---
    if (!m || m.passe2) {
      const course = { ref: [], flip: [] }, repos = [];
      // Une seconde au repos, avant et apres les gestes : une machine prise
      // par autre chose (un rendu, une autre suite) fait perdre des images a
      // une page immobile ; la course ne mesure alors plus le formulaire
      // (releve 2026-10-19, un rendu Blender a cote : 6 a 50 images perdues
      // par seconde au repos, le ratio passait de 0,30 a 0,57 puis 2,49 ;
      // machine calme : 0 partout). Un trouble qui ne tombe que pendant les
      // gestes peut lui echapper : un [G5] rouge se rejoue machine libre.
      const auRepos = (page) => page.evaluate(() => new Promise((r) => { const t = performance.now(); setTimeout(() => r(window.__flFenetre(t, performance.now()).perdues), 1000); }));
      for (let tour = 0; tour < 2; tour += 1) {
        for (const reference of tour % 2 ? [false, true] : [true, false]) {
          const ctx = await ouvrirActivites(browser, { reference, cpu: 6 });
          repos.push(await auRepos(ctx.page));
          for (const [id, ouvre] of GESTES_TIROIR) course[reference ? 'ref' : 'flip'].push((await gesteTiroir(ctx, id, ouvre, false)).course);
          await calme(ctx.page, 6000);
          repos.push(await auRepos(ctx.page));
          await ctx.context.close();
        }
      }
      // Le repos ne juge que la course qui rougit : un ratio tenu malgre une
      // machine occupee est tenu (releve 2026-10-20, une autre suite a cote :
      // 10 a 23 images perdues au repos, [G5] vert quand meme).
      const g5 = total(course.flip) <= 0.6 * total(course.ref);
      ok(g5 || total(repos) <= 8, 'MONTAGE la machine est au calme pendant la mesure a 6x (au repos, au plus 8 images perdues en huit secondes ; jugee quand [G5] rougit)', repos.join(' '));
      ok(total(course.ref) >= 15, 'MONTAGE la reference perd des images pendant ses tiroirs a 6x (au moins 15 sur dix gestes)', `${total(course.ref)} : ${course.ref.join(' ')}`);
      ok(total(course.flip) <= 0.6 * total(course.ref), '[G5] a 6x, les images perdues pendant la course : au plus 60 % de la reference', `${total(course.flip)} contre ${total(course.ref)} (${(total(course.flip) / Math.max(1, total(course.ref))).toFixed(2)}) ; formulaire ${course.flip.join(' ')}`);
    }

    // --- Mouvement reduit : rien ne glisse, le tiroir s ouvre ---
    const reduit = await ouvrirActivites(browser, { reference: false, cpu: 1, reduit: true });
    await reduit.page.click('#gridAct li[data-activity="bowling"] .fg-card');
    await reduit.page.waitForTimeout(150);
    const r = await reduit.page.evaluate(() => ({ flip: document.documentElement.classList.contains('fg-flip'), on: document.querySelector('#gridAct li[data-activity="bowling"]').classList.contains('is-on'), glissades: document.getAnimations().filter((a) => !a.transitionProperty && !a.animationName).length, tiroir: Math.round(document.querySelector('#gridAct li[data-activity="bowling"] .fg-card__opt').getBoundingClientRect().height) }));
    ok(!r.flip && r.on && r.glissades === 0 && r.tiroir > 0, '[G6] mouvement reduit : pas de .fg-flip, aucun glissement, le tiroir s ouvre', JSON.stringify(r));
    await reduit.context.close();
  } finally {
    await browser.close();
    srv.close();
  }
  if (m) ok(mutationServie > 0, 'MONTAGE la mutation a ete servie au formulaire', String(mutationServie));
  if (m && mutationServie) console.log(`${PREUVE_MUTATION} ${m.nom}`);
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nformulaire-fluide-check: ${echecs} FAIL${m ? ` (contre-epreuve : ${m.nom})` : ''}`); process.exit(1); }
  console.log('\nformulaire-fluide-check: ALL OK (le tiroir se deplie sur le compositeur : quelques layouts au lieu d un par image, la course garde ses images, meme rendu final)');
}
function contreEpreuves() {
  const { spawn } = require('child_process');
  const avant = FICHIERS_VARIANTE.map((f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } });
  let ratees = 0;
  const lancer = (i) => new Promise((resolve) => {
    const m = MUTATIONS_GATE[i];
    const fils = spawn(process.execPath, [__filename], { env: { ...process.env, PINLANE_FLUIDE_MUTATION: String(i + 1), PINLANE_FLUIDE_PORT: String(PORT + 1 + i) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    fils.stdout.on('data', (d) => { sortie += d; });
    fils.stderr.on('data', (d) => { sortie += d; });
    fils.on('close', (code) => {
      const lignes = sortie.split(/\r?\n/);
      const mordu = sortie.includes(`${PREUVE_MUTATION} ${m.nom}`);
      const rouges = m.attendu.filter((a) => lignes.some((l) => l.startsWith(`FAIL  ${a}`)));
      const montage = lignes.filter((l) => l.startsWith('FAIL  MONTAGE'));
      if (code === 1 && mordu && rouges.length === m.attendu.length && !montage.length) console.log(`contre-epreuve OK : ${m.attendu.join(' et ')} rougit quand ${m.nom}.`);
      else { ratees += 1; console.log(sortie); console.log(`CONTRE-EPREUVE RATEE (code ${code}, mutation ${mordu ? 'servie' : 'JAMAIS servie'}, rouges ${rouges.join(' ') || 'aucun'} sur ${m.attendu.join(' ')}, ${montage.length} montage(s) rouge(s)) : ${m.nom}.`); }
      resolve();
    });
  });
  (async () => {
    for (let i = 0; i < MUTATIONS_GATE.length; i += 1) await lancer(i);
    FICHIERS_VARIANTE.forEach((f, k) => { let now = ''; try { now = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { now = ''; } if (now !== avant[k]) { console.log(`LE DISQUE A ETE ECRIT : ${f}`); ratees += 1; } });
    if (ratees) { console.log(`\nformulaire-fluide-check --mutate: ${ratees} contre-epreuve(s) ratee(s).`); process.exit(1); }
    console.log(`\nformulaire-fluide-check --mutate: contre-epreuve OK : ${MUTATIONS_GATE.length} mutations, chacune rougit sur ses assertions, et aucun fichier n a ete ecrit.`);
  })();
}

async function main() {
  if (ARGS.report) { rapport(path.resolve(ARGS.report)); return; }
  if (ARGS.bench) { await bench(); return; }
  if (ARGS.mutate) { contreEpreuves(); return; }
  await gate();
}
main().catch((e) => { console.error(e); process.exit(1); });
