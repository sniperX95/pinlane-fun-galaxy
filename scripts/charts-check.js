// Gate du moteur de graphiques window.PinlaneCharts (assets/pinlane-charts.js
// + assets/pinlane-charts.css). Page HTML minimale servie en memoire, rendu
// reel dans Edge headless (playwright-core), et preuves COMPORTEMENTALES :
//   1. le path de la ligne contient le bon nombre de points, coordonnees finies ;
//   2. l'animation SE PRODUIT : stroke-dashoffset et transform mesures a t0
//      puis t+250ms, valeurs differentes ;
//   3. prefers-reduced-motion emule (page.emulateMedia) : etat final IMMEDIAT ;
//   4. re-rendu avec le meme motionKey : etat final direct, pas de rejeu ;
//   5. donnees vides : message calme, aucune exception ;
//   6. extremes (tout a 0, un seul point, valeurs negatives ramenees a 0) ;
//   7. aucune erreur console.
// Contre-preuve par mutation : le script mute assets/pinlane-charts.js, verifie
// que le gate ROUGIT sur le check attendu, puis restaure par edition inverse
// (JAMAIS git checkout). Mutation sans effet = sortie en erreur.
// Lancement : node scripts/charts-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CHARTS_PORT || 4263);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LIB = path.join(ROOT, 'assets', 'pinlane-charts.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Page de test : UNIQUEMENT les tokens theme (pinlane.css) + le moteur.
// Pas de balise <header> (body.staff-mode header l'ecraserait a hauteur 0).
const PAGE_HTML = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate pinlane-charts</title>
<link rel="stylesheet" href="/assets/pinlane.css">
<link rel="stylesheet" href="/assets/pinlane-charts.css">
</head>
<body>
<main style="max-width:720px;margin:0 auto;padding:24px;display:grid;gap:24px">
  <div id="hostLine"></div>
  <div id="hostBar"></div>
  <div id="hostBarDates"></div>
  <div id="hostDonut"></div>
  <div id="hostDonutZero"></div>
  <div id="hostHeat"></div>
  <div id="hostEmpty"></div>
  <div id="hostZero"></div>
  <div id="hostSingle"></div>
  <div id="hostNeg"></div>
  <p><span id="hostCount"></span> <span id="hostCountPercent"></span></p>
</main>
<!-- Hotes d'ECHELLE, hors du main etroit : un enfant de 1100 px dans un main
     de 720 px faisait deborder la page, decalait la mise en page apres mesure et
     faisait rater les survols. Ici, alignes a gauche, ils ne decalent rien. -->
<div style="padding:0 0 24px">
  <div id="hostWide" style="width:1100px"></div>
  <div id="hostSpark" style="width:200px"></div>
</div>
<script src="/assets/pinlane-charts.js"></script>
</body>
</html>`;

const heatMatrix = Array.from({ length: 7 }, () => Array.from({ length: 10 }, () => 0));
heatMatrix[2][3] = 9;
heatMatrix[4][6] = 3;

const DATA = {
  line: [120, 180, 90, 240, 300, 260, 410, 380, 220, 510, 470, 530, 610, 720]
    .map((value, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, value })),
  bar: [
    { label: 'Lun', value: 120 }, { label: 'Mar', value: 260 }, { label: 'Mer', value: 90 },
    { label: 'Jeu', value: 500 }, { label: 'Ven', value: 340 }, { label: 'Sam', value: 180 },
  ],
  donut: [
    { label: 'Bowling', value: 5200 },
    { label: 'Laser Game', value: 3100, tone: 'success' },
    { label: 'Formules', value: 1700 },
  ],
  heat: {
    matrix: heatMatrix,
    rows: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
    cols: ['12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h'],
  },
  zero: Array.from({ length: 5 }, (_, i) => ({ date: `2026-07-0${i + 1}`, value: 0 })),
  single: [{ date: '2026-07-10', value: 42 }],
  neg: [{ label: 'A', value: -5 }, { label: 'B', value: 10 }],
  countValue: 1234,
};

// Contre-preuves : chaque mutation doit faire rougir un check PRECIS.
// La restauration est l'edition inverse exacte (replace -> find).
const MUTATIONS = [
  {
    name: 'smoothPathD saute le dernier segment de la courbe (un sommet en moins)',
    find: 'for (var t = 0; t < n - 1; t += 1) {',
    replace: 'for (var t = 0; t < n - 2; t += 1) {',
    expect: 'line-points',
  },
  {
    name: 'garde de premiere apparition neutralisee (wasSeen)',
    find: 'return Boolean(key) && SEEN.has(key);',
    replace: 'return Boolean(key) && false;',
    expect: 'replay-guard',
  },
  {
    // Le defaut d'origine : viewBox fixe + width:100% -> tout le dessin (texte
    // compris) etire par le rapport largeur_conteneur / 560.
    name: 'retour au viewBox fixe de 560 (SVG etire par la largeur du conteneur)',
    find: '    if (!w) return VB_W;',
    replace: '    if (w) return VB_W;',
    expect: 'scale-texte',
  },
  {
    name: 'sparkline redessinee avec les axes (mode spark ignore)',
    find: '    var spark = o.sparkline === true;',
    replace: '    var spark = false;',
    expect: 'sparkline',
  },
  {
    name: 'calcul du point le plus proche de la ligne neutralise (idx fige a 0)',
    find: '{ best = dx; idx = i; }',
    replace: '{ best = dx; idx = 0; }',
    expect: 'hover-line-last',
  },
  {
    // Aucune mutation ne couvrait les deux checks d'animation : ils pouvaient
    // rougir ou verdir sans que rien ne le prouve. Sans .plc-in, l'etat initial
    // reste pose pour toujours : aucune valeur intermediaire, rien ne se pose.
    name: 'la classe .plc-in n est jamais posee (l animation ne demarre pas)',
    find: '          if (wrap && wrap.isConnected) wrap.classList.add(\'plc-in\');',
    replace: '          if (false) wrap.classList.add(\'plc-in\');',
    expect: 'line-anim-progress',
  },
];

// Verdict sur une sonde d'animation : transition reelle (duree > 0), trois
// valeurs peintes le long de SA timeline, monotones dans le bon sens, au moins
// une STRICTEMENT entre le depart et l'arrivee, et arrivee atteinte.
function describeAnim(probe, from, to, sense) {
  if (!probe) return { ok: false, detail: 'aucune transition observee (la sonde ne s est jamais declenchee)' };
  if (probe.error) return { ok: false, detail: probe.error };
  const s = Array.isArray(probe.samples) ? probe.samples : [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const finite = s.length === 3 && s.every((v) => Number.isFinite(v));
  const monotone = finite && (sense === 'asc'
    ? s[0] <= s[1] && s[1] <= s[2]
    : s[0] >= s[1] && s[1] >= s[2]);
  const strictMid = finite && s.some((v) => v > lo && v < hi);
  const ok = probe.duration > 0 && finite && monotone && strictMid && probe.end === to;
  return {
    ok,
    detail: `duree ${probe.duration} ms, 25/50/75 % = ${s.join(' / ') || 'aucun'}, fin ${probe.end} (attendu ${to})`,
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__charts-check') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE_HTML);
      return;
    }
    const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function applyEdit(file, find, replace) {
  const src = fs.readFileSync(file, 'utf8');
  const count = src.split(find).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count} occurrence(s)) : ${find}`);
  fs.writeFileSync(file, src.replace(find, replace));
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
  // L URL VOYAGE AVEC LE TEXTE (voir daterange-check) : sans elle, le filtre
  // « vercel-insights » ne mord pas sur « Failed to load resource ».
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE: ${msg.text()}${msg.location && msg.location().url ? ` @${msg.location().url}` : ''}`); });
  try {
    await page.goto(`${BASE_URL}/__charts-check?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.PinlaneCharts && typeof window.PinlaneCharts.lineChart === 'function', null, { timeout: 10000 });

    // t0 : montage + mesures SYNCHRONES (aucun rAF n'a pu tourner : l'etat
    // initial de l'animation est encore pose).
    const t0 = await page.evaluate((D) => {
      const g = (id) => document.getElementById(id);
      const out = { threw: [] };
      const P = window.PinlaneCharts;
      out.api = ['lineChart', 'barChart', 'donutChart', 'heatmapChart', 'countUp'].every((k) => typeof P[k] === 'function');
      const scaleOf = (el) => {
        const t = el ? getComputedStyle(el).transform : '';
        if (!t || t === 'none') return 1;
        const v = t.match(/-?[\d.]+/g);
        return v && v.length >= 4 ? parseFloat(v[3]) : NaN;
      };
      try { P.lineChart(g('hostLine'), { series: D.line, format: 'euro', motionKey: 'gate|line' }); } catch (e) { out.threw.push(`line:${e.message}`); }
      try { P.barChart('hostBar', { series: D.bar, format: 'int', motionKey: 'gate|bar', height: 180 }); } catch (e) { out.threw.push(`bar:${e.message}`); }
      try { P.barChart(g('hostBarDates'), { series: D.line.slice(0, 5), format: 'int', motionKey: 'gate|bardates' }); } catch (e) { out.threw.push(`bardates:${e.message}`); }
      try { P.donutChart(g('hostDonut'), { parts: D.donut, format: 'euro', motionKey: 'gate|donut' }); } catch (e) { out.threw.push(`donut:${e.message}`); }
      try { P.donutChart(g('hostDonutZero'), { parts: [{ label: 'X', value: 0 }], format: 'int', motionKey: 'gate|donutzero' }); } catch (e) { out.threw.push(`donutzero:${e.message}`); }
      try { P.heatmapChart(g('hostHeat'), { matrix: D.heat.matrix, rowLabels: D.heat.rows, colLabels: D.heat.cols, motionKey: 'gate|heat' }); } catch (e) { out.threw.push(`heat:${e.message}`); }
      try { P.lineChart(g('hostEmpty'), { series: [], format: 'int', motionKey: 'gate|empty' }); } catch (e) { out.threw.push(`empty:${e.message}`); }
      try { P.lineChart(g('hostZero'), { series: D.zero, format: 'int', motionKey: 'gate|zero' }); } catch (e) { out.threw.push(`zero:${e.message}`); }
      // ECHELLE 1:1 : un graphe de 170 px dans un conteneur de 1100 px doit
      // mesurer 170 px et garder ses libelles a la taille de la CSS.
      try { P.lineChart(g('hostWide'), { series: D.line, format: 'euro', height: 170, motionKey: 'gate|wide' }); } catch (e) { out.threw.push(`wide:${e.message}`); }
      try { P.lineChart(g('hostSpark'), { series: D.line, format: 'int', sparkline: true, height: 40, motionKey: 'gate|spark' }); } catch (e) { out.threw.push(`spark:${e.message}`); }
      try { P.lineChart(g('hostSingle'), { series: D.single, format: 'int', motionKey: 'gate|single' }); } catch (e) { out.threw.push(`single:${e.message}`); }
      try { P.barChart(g('hostNeg'), { series: D.neg, format: 'int', motionKey: 'gate|neg' }); } catch (e) { out.threw.push(`neg:${e.message}`); }
      try { P.lineChart('hoteInexistant', { series: D.line, format: 'int', motionKey: 'gate|absent' }); P.lineChart(null, { series: D.line }); } catch (e) { out.threw.push(`absent:${e.message}`); }
      try { P.countUp(g('hostCount'), D.countValue, { format: 'euro' }); } catch (e) { out.threw.push(`count:${e.message}`); }
      out.countT0 = g('hostCount').textContent;

      const pathEl = g('hostLine').querySelector('.plc-line-path');
      out.lineD = pathEl ? pathEl.getAttribute('d') || '' : '';
      out.lineOff0 = pathEl ? parseFloat(getComputedStyle(pathEl).strokeDashoffset) : NaN;
      out.lineStroke = pathEl ? getComputedStyle(pathEl).stroke : '';
      out.yticks = g('hostLine').querySelectorAll('.plc-ytick').length;
      out.xticks = g('hostLine').querySelectorAll('.plc-xtick').length;
      out.hasDot = Boolean(g('hostLine').querySelector('.plc-line-dot'));
      // Plus AUCUN chiffre imprime dans la zone tracee : la valeur se lit sur
      // l'axe et au survol, le total vit dans l'en-tete de la carte.
      out.plotTexts = [...g('hostLine').querySelectorAll('svg text')].map((t) => t.getAttribute('class') || '');

      const probe = document.createElement('span');
      probe.style.color = 'var(--text)';
      probe.style.background = 'var(--success)';
      document.body.appendChild(probe);
      const pc = getComputedStyle(probe);
      out.tokenText = pc.color;
      out.tokenSuccess = pc.backgroundColor;
      probe.remove();

      const bars = g('hostBar').querySelectorAll('.plc-bar');
      out.barCount = bars.length;
      out.barScale0 = bars.length ? scaleOf(bars[0]) : NaN;
      out.barHeights = Array.from(bars).map((b) => parseFloat(b.getAttribute('height')));
      out.barDatesLabels = Array.from(g('hostBarDates').querySelectorAll('.plc-xtick')).map((t) => t.textContent.trim()).filter(Boolean).length;

      const segs = g('hostDonut').querySelectorAll('.plc-donut-seg');
      out.segCount = segs.length;
      out.segOff0 = segs.length ? parseFloat(getComputedStyle(segs[0]).strokeDashoffset) : NaN;
      out.legendShares = Array.from(g('hostDonut').querySelectorAll('.plc-legend-share')).map((e) => e.textContent);
      const swSuccess = g('hostDonut').querySelector('.plc-swatch.plc-tone-success');
      out.swatchSuccessColor = swSuccess ? getComputedStyle(swSuccess).backgroundColor : '';
      const swDefault = g('hostDonut').querySelector('.plc-swatch:not(.plc-tone-success)');
      out.swatchDefaultColor = swDefault ? getComputedStyle(swDefault).backgroundColor : '';
      out.donutZeroEmpty = Boolean(g('hostDonutZero').querySelector('.plc-empty')) && !g('hostDonutZero').querySelector('svg');

      out.heatCells = g('hostHeat').querySelectorAll('.plc-heat-cell').length;
      out.emptyText = (g('hostEmpty').querySelector('.plc-empty') || { textContent: '' }).textContent;
      out.emptyHasSvg = Boolean(g('hostEmpty').querySelector('svg'));
      out.zeroHasSvg = Boolean(g('hostZero').querySelector('svg'));
      out.zeroNaN = /NaN/.test(g('hostZero').innerHTML);
      out.zeroText = (g('hostZero').querySelector('.plc-empty') || { textContent: '' }).textContent;
      var wideSvg = g('hostWide').querySelector('svg');
      var wideTick = g('hostWide').querySelector('.plc-ytick');
      out.wideViewBox = wideSvg ? wideSvg.getAttribute('viewBox') : '';
      out.wideHostW = Math.round(g('hostWide').clientWidth);
      out.wideSvgH = wideSvg ? Math.round(wideSvg.getBoundingClientRect().height) : 0;
      out.wideTickH = wideTick ? Math.round(wideTick.getBoundingClientRect().height * 10) / 10 : 0;
      var sparkSvg = g('hostSpark').querySelector('svg');
      out.sparkH = sparkSvg ? Math.round(sparkSvg.getBoundingClientRect().height) : 0;
      out.sparkTexts = g('hostSpark').querySelectorAll('text').length;
      out.sparkPath = Boolean(g('hostSpark').querySelector('.plc-line-path'));
      out.singleDot = Boolean(g('hostSingle').querySelector('.plc-line-dot'));
      out.singleNaN = /NaN/.test(g('hostSingle').innerHTML);
      out.negHeights = Array.from(g('hostNeg').querySelectorAll('.plc-bar')).map((b) => parseFloat(b.getAttribute('height')));

      // Sonde d'animation. Elle vit DANS LA MEME FRAME que la pose de .plc-in,
      // et c'est tout l'interet : mountChart arme un double rAF, on en arme un
      // ici, apres lui (meme tache, donc meme file de callbacks, dans l'ordre
      // d'inscription). A la deuxieme frame, les graphes posent .plc-in, PUIS
      // notre callback tourne, quel que soit le temps ecoule entre les deux
      // frames. Ni ecouteur transitionstart (son ENVOI peut etre reporte apres
      // la fin d'une transition courte, et l'animation a alors disparu de
      // getAnimations : mesure du 2026-08-09, la barre en 220 ms rate une fois
      // sur deux), ni echantillonnage a l'horloge.
      window.__plcProbe = { line: null, bar: null };
      const probeAnim = (hostId, key, prop, selector, readValue) => {
        const host = g(hostId);
        const el = host && host.querySelector(selector);
        if (!el) { window.__plcProbe[key] = { error: `element absent (${selector})` }; return; }
        // Cette lecture force le recalcul de style : c'est elle qui fait NAITRE
        // la transition tout juste declenchee par la classe.
        readValue(el);
        const running = el.getAnimations();
        const animation = running.find((a) => a.transitionProperty === prop);
        if (!animation) {
          window.__plcProbe[key] = {
            error: `aucune transition sur ${prop} (observe : ${running.map((a) => a.transitionProperty || a.constructor.name).join(', ') || 'aucune'})`,
          };
          return;
        }
        const timing = animation.effect.getComputedTiming();
        const total = Number(timing.duration) || 0;
        const delay = Number(timing.delay) || 0;
        animation.pause();
        const samples = [0.25, 0.5, 0.75].map((part) => {
          animation.currentTime = delay + total * part;
          return readValue(el);
        });
        animation.finish();
        window.__plcProbe[key] = { duration: total, samples, end: readValue(el) };
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          probeAnim('hostLine', 'line', 'stroke-dashoffset', '.plc-line-path',
            (el) => parseFloat(getComputedStyle(el).strokeDashoffset));
          probeAnim('hostBar', 'bar', 'transform', '.plc-bar', scaleOf);
        });
      });

      // L ESPACE AVANT L EURO EST UNE ESPACE FINE INSECABLE (U+202F), PAS UNE
      // ESPACE ORDINAIRE, et elle s ecrit en ECHAPPEMENT parce que le caractere
      // est invisible dans un editeur. La bibliotheque s est alignee sur
      // formatMoney (app-main.js) le 2026-09-03 : les deux ecrivent le meme
      // montant sur le meme ecran, ils doivent l ecrire au meme octet. Les
      // attendus de ce gate etaient restes en espace ordinaire, donc quatre
      // checks comparaient « 1 234 € » a « 1 234 € », identiques a l oeil et
      // differents en octets. C est la reference qui suit la regle, jamais
      // l inverse.
      const nf = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
      const euro = (v) => `${nf.format(v)}\u202F€`;
      out.expectedEuro720 = euro(720);
      out.expectedEuro1234 = euro(D.countValue);
      return out;
    }, DATA);

    // L'animation ne se lit PLUS a un instant d'horloge. Deux mesures du
    // 2026-08-08 expliquent pourquoi, et elles se contredisent, ce qui est la
    // signature d'une course : au TOUT PREMIER chargement du processus
    // navigateur, le double rAF met ~130 ms a partir et la premiere frame
    // animee ne tombe qu'a ~325 ms (une lecture a t+250 ms voyait donc l'etat
    // de depart et rougissait) ; sous charge CPU au contraire, deux frames
    // consecutives peuvent etre separees de plus que la duree de la transition,
    // et un echantillonnage par requestAnimationFrame saute l'animation entiere
    // (mesure : 4 echantillons, aucun intermediaire). Deplacer le curseur ou
    // echantillonner plus vite ne fait que changer le cote du tirage au sort.
    //
    // La course est donc SUPPRIMEE : la sonde tourne DANS la frame ou .plc-in
    // est posee (voir son commentaire dans la capture t0), met la transition en
    // pause et lit la valeur peinte a 25/50/75 % de SA timeline. On attend
    // ensuite son resultat par une CONDITION, sur un setInterval qui ne depend
    // pas des frames, jamais par une duree choisie d'avance.
    const anim = await page.evaluate(() => new Promise((resolve) => {
      const done = () => window.__plcProbe && window.__plcProbe.line && window.__plcProbe.bar;
      if (done()) { resolve(window.__plcProbe); return; }
      const started = Date.now();
      // Butoir : une animation morte doit rendre la main et FAIRE ROUGIR avec
      // ce qu'elle a vu, jamais faire expirer le gate sur un timeout illisible.
      const id = setInterval(() => {
        if (done() || Date.now() - started > 4000) { clearInterval(id); resolve(window.__plcProbe); }
      }, 40);
    }));

    // Etat pose : on attend la CONDITION « tout est arrive », pas une duree.
    // L'ancien `waitForTimeout(950)` etait genereux face a des animations de
    // 600 ms, donc invisible - mais c'est la meme faute que celle corrigee
    // ci-dessus, et elle se reveille des que la machine rame. Le butoir laisse
    // les assertions rapporter la valeur observee au lieu d'expirer.
    await page.waitForFunction(() => {
      const g = (id) => document.getElementById(id);
      const num = (el, prop) => (el ? parseFloat(getComputedStyle(el)[prop]) : NaN);
      const path = g('hostLine').querySelector('.plc-line-path');
      const area = g('hostLine').querySelector('.plc-line-area');
      const segs = Array.from(g('hostDonut').querySelectorAll('.plc-donut-seg'));
      const heatFill = g('hostHeat').querySelectorAll('.plc-heat-cell .plc-heat-fill')[2 * 10 + 3];
      const count = g('hostCount');
      return num(path, 'strokeDashoffset') === 0
        && num(area, 'opacity') > 0.99
        && segs.length > 0 && segs.every((s) => num(s, 'strokeDashoffset') === 0)
        && num(heatFill, 'opacity') > 0
        && count && count._plcRaf === 0;
    }, null, { timeout: 6000 }).catch(() => {});
    const settled = await page.evaluate((D) => {
      const g = (id) => document.getElementById(id);
      const out = {};
      const scaleOf = (el) => {
        const t = el ? getComputedStyle(el).transform : '';
        if (!t || t === 'none') return 1;
        const v = t.match(/-?[\d.]+/g);
        return v && v.length >= 4 ? parseFloat(v[3]) : NaN;
      };
      const pathEl = g('hostLine').querySelector('.plc-line-path');
      out.lineOffEnd = pathEl ? parseFloat(getComputedStyle(pathEl).strokeDashoffset) : NaN;
      const area = g('hostLine').querySelector('.plc-line-area');
      out.areaOpacity = area ? parseFloat(getComputedStyle(area).opacity) : NaN;
      const segs = Array.from(g('hostDonut').querySelectorAll('.plc-donut-seg'));
      out.segOffEnd = segs.length ? Math.max(...segs.map((s) => parseFloat(getComputedStyle(s).strokeDashoffset))) : NaN;
      const fills = g('hostHeat').querySelectorAll('.plc-heat-cell .plc-heat-fill');
      const op = (i) => (fills[i] ? parseFloat(getComputedStyle(fills[i]).opacity) : NaN);
      out.heatMax = op(2 * 10 + 3);
      out.heatMid = op(4 * 10 + 6);
      out.heatZero = op(0);
      const cells = g('hostHeat').querySelectorAll('.plc-heat-cell');
      out.heatTitle = cells[2 * 10 + 3] ? cells[2 * 10 + 3].getAttribute('title') : '';
      out.countFinal = g('hostCount').textContent;
      // Re-rendu innerHTML avec le MEME motionKey : etat final immediat.
      const P = window.PinlaneCharts;
      P.lineChart(g('hostLine'), { series: D.line, format: 'euro', motionKey: 'gate|line' });
      const p2 = g('hostLine').querySelector('.plc-line-path');
      out.offReplay = p2 ? parseFloat(getComputedStyle(p2).strokeDashoffset) : NaN;
      P.barChart('hostBar', { series: D.bar, format: 'int', motionKey: 'gate|bar', height: 180 });
      out.scaleReplay = scaleOf(g('hostBar').querySelector('.plc-bar'));
      return out;
    }, DATA);

    // ---- Survol : infobulles pilotees a la vraie souris ------------------
    // Geometrie ecran des cibles (l'etat est pose apres settled : hostLine et
    // hostBar re-rendus, listeners de survol re-attaches). On deplace ensuite
    // le pointeur pour de vrai (page.mouse.move) et on lit le TEXTE + l'opacite
    // de l'infobulle .plc-tip.
    const geo = await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const svgRect = (host) => {
        const s = g(host).querySelector('.plc-svg');
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const barCenters = Array.from(g('hostBar').querySelectorAll('.plc-bar')).map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      // Point sur la mediane du trait de l'arc (getPointAtLength + CTM ecran) :
      // le centre de la bbox du segment tomberait dans le trou du donut.
      const segMids = Array.from(g('hostDonut').querySelectorAll('.plc-donut-seg')).map((s) => {
        const len = s.getTotalLength();
        const pt = s.getPointAtLength(len / 2);
        const m = s.getScreenCTM();
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      });
      return { line: svgRect('hostLine'), barCenters, segMids };
    });

    const readTip = (host) => page.evaluate((h) => {
      const g = (id) => document.getElementById(id);
      const chart = g(h).querySelector('.plc-chart');
      const tip = g(h).querySelector('.plc-tip');
      return {
        text: tip ? tip.textContent.trim() : '',
        opacity: tip ? parseFloat(getComputedStyle(tip).opacity) : 0,
        hovering: chart ? chart.classList.contains('plc-hovering') : false,
      };
    }, host);

    // U+202F, l espace fine insecable : voir la note sur `euro()` plus haut.
    const euro120 = `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(120)}\u202F€`;
    let lineTipLast = { text: '', opacity: 0, hovering: false };
    let lineTipFirst = { text: '', opacity: 0 };
    let lineTipLeave = { opacity: 1 };
    let barTip = { text: '', opacity: 0 };
    let barTipLeave = { opacity: 1 };
    let donutTip = { text: '', opacity: 0 };
    let donutTipLeave = { opacity: 1 };
    if (geo.line) {
      const midY = geo.line.top + geo.line.height / 2;
      await page.mouse.move(geo.line.right - 6, midY);
      await page.waitForTimeout(110);
      lineTipLast = await readTip('hostLine');
      await page.mouse.move(geo.line.left + 4, midY);
      await page.waitForTimeout(110);
      lineTipFirst = await readTip('hostLine');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(170);
      lineTipLeave = await readTip('hostLine');
    }
    if (geo.barCenters[3]) {
      await page.mouse.move(geo.barCenters[3].x, geo.barCenters[3].y);
      await page.waitForTimeout(110);
      barTip = await readTip('hostBar');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(170);
      barTipLeave = await readTip('hostBar');
    }
    if (geo.segMids[0]) {
      await page.mouse.move(geo.segMids[0].x, geo.segMids[0].y);
      await page.waitForTimeout(110);
      donutTip = await readTip('hostDonut');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(170);
      donutTipLeave = await readTip('hostDonut');
    }

    // ---- Assertions page normale -----------------------------------------
    ok(t0.api, 'api', 'les 5 fonctions du contrat doivent exister');
    ok(t0.threw.length === 0, 'sans-exception', t0.threw.join(' | '));
    // Courbe lissee monotone : chaque sommet est l'ancre M (1) ou la fin d'une
    // commande cubique C (n-1). La ligne passe donc par M + nb(C) sommets, et
    // porte 2 + 6*nb(C) nombres, tous finis.
    const dCurves = (t0.lineD.match(/C/g) || []).length;
    const dStarts = (t0.lineD.match(/M/g) || []).length;
    const dPoints = dStarts + dCurves;
    const dNums = (t0.lineD.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    ok(dPoints === DATA.line.length && dNums.length === 2 + dCurves * 6 && dNums.every(Number.isFinite),
      'line-points', `attendu ${DATA.line.length} sommets finis, trouve ${dPoints} (${dNums.length} nombres)`);
    ok(t0.lineOff0 > 900, 'line-anim-start', `dashoffset t0 = ${t0.lineOff0}`);
    // Interpolation prouvee : une transition de duree non nulle, dont la valeur
    // peinte DESCEND le long de sa timeline en passant strictement entre le
    // depart (1000) et l'arrivee (0), et qui finit a 0. Un saut brut de 1000 a
    // 0, ou une classe jamais posee, ne produit aucun de ces echantillons.
    const lineAnim = describeAnim(anim && anim.line, t0.lineOff0, 0, 'desc');
    ok(lineAnim.ok, 'line-anim-progress', lineAnim.detail);
    ok(settled.lineOffEnd < 1, 'line-anim-end', `dashoffset final = ${settled.lineOffEnd}`);
    ok(settled.areaOpacity > 0.99, 'line-area-end', `opacity aire = ${settled.areaOpacity}`);
    ok(t0.yticks >= 3 && t0.yticks <= 5, 'line-yticks', `${t0.yticks} graduations Y`);
    ok(t0.xticks >= 2 && t0.xticks <= 7, 'line-xticks', `${t0.xticks} labels X`);
    // Le dot marque la fin de serie ; les seuls textes du SVG sont les axes.
    // Une valeur collee au point tombait SUR la courbe, et dans un coin elle
    // flottait sans rattachement : le graphe porte une forme, pas un chiffre.
    const plotClasses = [...new Set(t0.plotTexts)].sort();
    ok(t0.hasDot && plotClasses.every((c) => c === 'plc-ytick' || c === 'plc-xtick'),
      'line-no-value-in-plot', `textes du trace : ${plotClasses.join(', ') || 'aucun'}`);
    ok(t0.lineStroke === t0.tokenText, 'line-color-token', `stroke ${t0.lineStroke} vs var(--text) ${t0.tokenText}`);
    ok(t0.barCount === DATA.bar.length, 'bar-count', `${t0.barCount} barres`);
    const barAnim = describeAnim(anim && anim.bar, t0.barScale0, 1, 'asc');
    ok(t0.barScale0 < 0.6 && barAnim.ok, 'bar-anim', `depart ${t0.barScale0} · ${barAnim.detail}`);
    ok(t0.barHeights.length === 6 && t0.barHeights[3] > t0.barHeights[0] && t0.barHeights[0] > t0.barHeights[2] && t0.barHeights.every((h) => Number.isFinite(h) && h >= 0),
      'bar-geometry', `hauteurs ${t0.barHeights.join(', ')}`);
    ok(t0.barDatesLabels >= 2, 'bar-date-labels', 'les series {date, value} doivent produire des labels X');
    ok(t0.segCount === DATA.donut.length, 'donut-segments', `${t0.segCount} segments`);
    ok(t0.segOff0 > 95 && settled.segOffEnd < 1, 'donut-draw', `offset t0 ${t0.segOff0} -> final ${settled.segOffEnd}`);
    ok(t0.legendShares.length === 3 && t0.legendShares[0].includes('52%') && t0.legendShares[1].includes('31%') && t0.legendShares[2].includes('17%'),
      'donut-shares', t0.legendShares.join(' | '));
    ok(t0.swatchSuccessColor === t0.tokenSuccess && t0.swatchDefaultColor === t0.tokenText,
      'donut-tone', `success ${t0.swatchSuccessColor} vs ${t0.tokenSuccess} ; defaut ${t0.swatchDefaultColor} vs ${t0.tokenText}`);
    ok(t0.donutZeroEmpty, 'donut-empty', 'parts a zero -> message calme sans anneau');
    ok(t0.heatCells === 70, 'heat-cells', `${t0.heatCells} cellules`);
    ok(settled.heatMax > 0.95 && settled.heatZero < 0.01 && settled.heatMid > 0.1 && settled.heatMid < settled.heatMax,
      'heat-intensity', `max ${settled.heatMax}, mid ${settled.heatMid}, zero ${settled.heatZero}`);
    ok(settled.heatTitle === 'Mer 15h : 9', 'heat-title', `"${settled.heatTitle}"`);
    ok(t0.emptyText === 'Pas encore de données sur la période.' && !t0.emptyHasSvg, 'empty-calm', `"${t0.emptyText}"`);
    // Serie presente mais TOUTE A ZERO : depuis 2026-07-27 on ne trace plus une
    // ligne plate a zero (200 px de vide qui laissent croire a une panne), on
    // ecrit la seule chose vraie. Le message est distinct de « pas de donnees ».
    ok(!t0.zeroHasSvg && !t0.zeroNaN && t0.zeroText === 'Aucune valeur sur cette période.',
      'zero-flat', `serie toute a 0 -> "${t0.zeroText}" (svg: ${t0.zeroHasSvg})`);
    ok(t0.singleDot && !t0.singleNaN, 'single-point', 'un seul point : dot present, pas de NaN');

    // ECHELLE 1:1 (2026-07-27). Le SVG etait dessine dans un viewBox fixe de
    // 560 px puis etire par 'width: 100%' : dans une carte de 1100 px tout etait
    // multiplie par ~2, texte compris (graduations de 11 px rendues a 22) et
    // hauteur comprise (170 px rendus a ~334). C'est ce que Movsar voyait sur la
    // page Direction : 'les graphs sont bugges et super gros'.
    const vbWide = Number(String(t0.wideViewBox).split(' ')[2] || 0);
    ok(Math.abs(vbWide - t0.wideHostW) <= 2,
      'scale-viewbox', `viewBox ${vbWide} vs conteneur ${t0.wideHostW} px`);
    ok(Math.abs(t0.wideSvgH - 170) <= 2,
      'scale-hauteur', `hauteur rendue ${t0.wideSvgH} px (demandee 170)`);
    ok(t0.wideTickH > 8 && t0.wideTickH < 16,
      'scale-texte', `graduation rendue a ${t0.wideTickH} px (CSS 11 px ; ~22 px = SVG etire)`);
    ok(t0.sparkPath && t0.sparkTexts === 0 && Math.abs(t0.sparkH - 40) <= 2,
      'sparkline', `courbe seule, ${t0.sparkTexts} texte(s), hauteur ${t0.sparkH} px`);
    ok(t0.negHeights.length === 2 && t0.negHeights[0] === 0 && t0.negHeights[1] > 0,
      'neg-clamped', `hauteurs ${t0.negHeights.join(', ')} (negatif attendu a 0)`);
    ok(settled.offReplay < 1 && settled.scaleReplay > 0.99,
      'replay-guard', `re-rendu meme motionKey : dashoffset ${settled.offReplay}, scaleY ${settled.scaleReplay} (etat final attendu)`);
    ok(t0.countT0 !== settled.countFinal && settled.countFinal === t0.expectedEuro1234,
      'countup', `t0 "${t0.countT0}" -> final "${settled.countFinal}" (attendu "${t0.expectedEuro1234}")`);

    // ---- Survol : preuves comportementales -------------------------------
    ok(lineTipLast.opacity > 0.5 && lineTipLast.hovering && lineTipLast.text.includes(t0.expectedEuro720),
      'hover-line-last', `survol point droit -> "${lineTipLast.text}" op ${lineTipLast.opacity} (attendu contient "${t0.expectedEuro720}")`);
    ok(lineTipFirst.opacity > 0.5 && lineTipFirst.text.includes(euro120),
      'hover-line-first', `survol point gauche -> "${lineTipFirst.text}" (attendu contient "${euro120}")`);
    ok(lineTipLeave.opacity < 0.5,
      'hover-line-leave', `sortie -> infobulle cachee, opacity ${lineTipLeave.opacity}`);
    ok(barTip.opacity > 0.5 && barTip.text.includes('500'),
      'hover-bar', `survol barre 500 -> "${barTip.text}" op ${barTip.opacity}`);
    ok(barTipLeave.opacity < 0.5,
      'hover-bar-leave', `sortie barre -> infobulle cachee, opacity ${barTipLeave.opacity}`);
    ok(donutTip.opacity > 0.5 && donutTip.text.includes('52%'),
      'hover-donut', `survol segment -> "${donutTip.text}" op ${donutTip.opacity} (part 52% attendue)`);
    ok(donutTipLeave.opacity < 0.5,
      'hover-donut-leave', `sortie segment -> infobulle cachee, opacity ${donutTipLeave.opacity}`);
  } catch (error) {
    ok(false, 'suite-exception', error.message);
  } finally {
    await page.close();
  }

  // ---- Page reduced-motion : etat final IMMEDIAT ------------------------
  const pageRm = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
  pageRm.on('pageerror', (e) => consoleErrors.push(`PAGEERROR(rm): ${e.message}`));
  pageRm.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE(rm): ${msg.text()}`); });
  try {
    await pageRm.emulateMedia({ reducedMotion: 'reduce' });
    await pageRm.goto(`${BASE_URL}/__charts-check?rm=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await pageRm.waitForFunction(() => window.PinlaneCharts && typeof window.PinlaneCharts.lineChart === 'function', null, { timeout: 10000 });
    const rm = await pageRm.evaluate((D) => {
      const g = (id) => document.getElementById(id);
      const out = { threw: [] };
      const P = window.PinlaneCharts;
      try { P.lineChart(g('hostLine'), { series: D.line, format: 'euro', motionKey: 'rm|line' }); } catch (e) { out.threw.push(`line:${e.message}`); }
      try { P.barChart(g('hostBar'), { series: D.bar, format: 'int', motionKey: 'rm|bar' }); } catch (e) { out.threw.push(`bar:${e.message}`); }
      try { P.heatmapChart(g('hostHeat'), { matrix: D.heat.matrix, rowLabels: D.heat.rows, colLabels: D.heat.cols, motionKey: 'rm|heat' }); } catch (e) { out.threw.push(`heat:${e.message}`); }
      try { P.countUp(g('hostCount'), D.countValue, { format: 'euro' }); } catch (e) { out.threw.push(`count:${e.message}`); }
      try { P.countUp(g('hostCountPercent'), 72, { format: 'percent' }); } catch (e) { out.threw.push(`countp:${e.message}`); }
      const pathEl = g('hostLine').querySelector('.plc-line-path');
      out.lineOff = pathEl ? parseFloat(getComputedStyle(pathEl).strokeDashoffset) : NaN;
      const bar = g('hostBar').querySelector('.plc-bar');
      const t = bar ? getComputedStyle(bar).transform : '';
      const v = t && t !== 'none' ? t.match(/-?[\d.]+/g) : null;
      out.barScale = !t || t === 'none' ? 1 : (v && v.length >= 4 ? parseFloat(v[3]) : NaN);
      const fills = g('hostHeat').querySelectorAll('.plc-heat-cell .plc-heat-fill');
      out.heatMax = fills[2 * 10 + 3] ? parseFloat(getComputedStyle(fills[2 * 10 + 3]).opacity) : NaN;
      out.countText = g('hostCount').textContent;
      out.countPercentText = g('hostCountPercent').textContent;
      // U+202F, l espace fine insecable : voir la note sur `euro()` plus haut.
      out.expectedEuro = `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(D.countValue)}\u202F€`;
      return out;
    }, DATA);
    ok(rm.threw.length === 0, 'rm-sans-exception', rm.threw.join(' | '));
    ok(rm.lineOff < 0.5, 'rm-line-immediat', `dashoffset a t0 = ${rm.lineOff} (0 attendu sans animation)`);
    ok(rm.barScale > 0.99, 'rm-bar-immediat', `scaleY a t0 = ${rm.barScale}`);
    ok(rm.heatMax > 0.95, 'rm-heat-immediat', `opacite max a t0 = ${rm.heatMax}`);
    ok(rm.countText === rm.expectedEuro, 'rm-countup-immediat', `"${rm.countText}" vs "${rm.expectedEuro}"`);
    ok(rm.countPercentText === '72%', 'rm-countup-percent', `"${rm.countPercentText}"`);
  } catch (error) {
    ok(false, 'rm-suite-exception', error.message);
  } finally {
    await pageRm.close();
  }

  const fatal = consoleErrors.filter((e) => !/favicon|vercel-insights/i.test(e));
  ok(fatal.length === 0, 'console-clean', fatal.slice(0, 3).join(' | '));

  return failures;
}

(async () => {
  const original = fs.readFileSync(LIB, 'utf8');
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('--- passe 1 : gate nominal ---');
    const base = await runSuite(browser, false);
    if (base.length) {
      console.error(`charts-check: ROUGE en nominal (${base.join(', ')})`);
      process.exitCode = 1;
      return;
    }

    for (const m of MUTATIONS) {
      console.log(`--- contre-preuve par mutation : ${m.name} ---`);
      applyEdit(LIB, m.find, m.replace);
      let red;
      try {
        red = await runSuite(browser, true);
      } finally {
        // Edition inverse exacte, jamais git checkout.
        applyEdit(LIB, m.replace, m.find);
      }
      if (fs.readFileSync(LIB, 'utf8') !== original) {
        console.error('charts-check: restauration ratee, le fichier differe de l\'original lu au demarrage');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`charts-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`charts-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`charts-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log(`charts-check: ALL OK (points finis, animation lue sur SA timeline puis repos attendu par condition, reduced-motion immediat, garde motionKey, vides calmes, extremes, console propre, ${MUTATIONS.length} contre-preuves par mutation)`);
  } finally {
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('charts-check: exception', error.message);
  process.exit(1);
});
