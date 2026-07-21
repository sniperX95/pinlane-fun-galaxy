// Gate du tableau d'analyse personnalisable window.PinlaneAnalyticsBoard
// (assets/pinlane-analytics-board.js + assets/pinlane-analytics-board.css).
// Page HTML minimale servie en memoire, rendu reel dans Edge headless
// (playwright-core), getAnalytics mocke deterministe, interactions PILOTEES
// (vrais clics + VRAI drag pointeur), preuves COMPORTEMENTALES (jamais de
// simple presence de chaine) :
//   1. le board monte N=3 widgets par defaut, chacun avec un SVG (hauteur>0) ;
//   2. entrer en mode edition affiche les badges supprimer + la tuile + ;
//   3. AJOUTER un widget via le choix -> la grille a N+1 widgets et la config
//      persiste (relecture de localStorage) ;
//   4. SUPPRIMER un widget -> N-1 + persiste ;
//   5. REORDONNER par un VRAI drag (page.mouse down/move/up sur la poignee) fait
//      passer le 1er widget apres le 2e : l'ordre de state persiste change dans
//      le bon sens (mesure de l'ordre avant/apres, pas juste "un drag a eu lieu") ;
//   6. changer la plage via PinlaneDateRange re-appelle getAnalytics avec les
//      bonnes dates ;
//   7. recharger la page (nouvelle instance, meme storageKey) restaure la config
//      personnalisee ;
//   8. zero erreur console.
// Plus : mode edition sous prefers-reduced-motion = aucune oscillation (jiggle
// coupe), badges toujours fonctionnels.
// Contre-preuve par mutation : le script mute le composant, verifie que le gate
// ROUGIT sur le check attendu (reinsertion a l'index de depose neutralisee ->
// l'ordre ne change plus ; ecriture localStorage neutralisee -> le reload ne
// restaure plus), puis restaure par edition inverse (JAMAIS git checkout).
// Mutation sans effet = sortie en erreur.
// Lancement : node scripts/analytics-board-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_BOARD_PORT || 4291);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LIB = path.join(ROOT, 'assets', 'pinlane-analytics-board.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const MAX_DATE = '2026-07-21';

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoFromDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function addDaysNode(iso, n) {
  const p = iso.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return isoFromDate(d);
}
const EXPECT_LAST7_START = addDaysNode(MAX_DATE, -6);
const EXPECT_LAST30_START = addDaysNode(MAX_DATE, -29);

// Page de test : tokens theme + moteur graphes + selecteur de plage + le board.
// Pas de <header> (body.staff-mode/admin-mode header l'ecraserait a hauteur 0).
// #host contraint a 420px : la grille auto-fit reste a 1 colonne, le reordre
// est donc purement vertical et deterministe.
const PAGE_HTML = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate pinlane-analytics-board</title>
<link rel="stylesheet" href="/assets/pinlane.css">
<link rel="stylesheet" href="/assets/pinlane-charts.css">
<link rel="stylesheet" href="/assets/pinlane-daterange.css">
<link rel="stylesheet" href="/assets/pinlane-analytics-board.css">
</head>
<body>
<main style="max-width:1000px;margin:0 auto;padding:48px 24px">
  <div id="host" style="width:420px"></div>
</main>
<script src="/assets/pinlane-charts.js"></script>
<script src="/assets/pinlane-daterange.js"></script>
<script src="/assets/pinlane-analytics-board.js"></script>
</body>
</html>`;

// Definitions injectees AVANT chaque navigation (survivent au reload) : mock
// deterministe + fonction de montage. getAnalytics enregistre chaque appel.
const INIT_SCRIPT = `
window.__PAB_MAX_DATE = ${JSON.stringify(MAX_DATE)};
window.__calls = [];
window.__buildAnalytics = function (start, end) {
  function fromISO(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
  function iso(d){function p(n){return (n<10?'0':'')+n;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
  var daily=[]; var d=fromISO(start); var endD=fromISO(end); var i=0; var sumC=0,sumR=0,sumP=0;
  while (d <= endD && i < 200) {
    var c=(i%7)+3; var r=c*35; var px=c*2+1;
    daily.push({date:iso(d),count:c,revenue:r,pax:px});
    sumC+=c; sumR+=r; sumP+=px; d.setDate(d.getDate()+1); i+=1;
  }
  return {
    totals:{reservations:sumC,revenue:sumR,pax:sumP,avgBasket:42,paymentRate:82,cancelRate:7},
    daily:daily,
    byType:{Bowling:{count:14,revenue:520,pax:36},Laser:{count:9,revenue:340,pax:22},Restaurant:{count:5,revenue:180,pax:12}},
    byChannel:[{channel:'Site',count:16},{channel:'Telephone',count:7},{channel:'Sur place',count:5}],
    occupancy:{rate:64}
  };
};
window.__mockAnalytics = function (start, end) {
  window.__calls.push({start:start,end:end});
  return Promise.resolve(window.__buildAnalytics(start, end));
};
window.__mountBoard = function (hostId, key) {
  window.__board = window.PinlaneAnalyticsBoard.mount(hostId || 'host', {
    storageKey: key || 'pab-check',
    getAnalytics: window.__mockAnalytics,
    defaultWidgets: [{metric:'revenue',viz:'line'},{metric:'byType',viz:'donut'},{metric:'reservations',viz:'bars'}],
    maxDate: window.__PAB_MAX_DATE
  });
  return window.__board;
};
`;

const MUTATIONS = [
  {
    name: 'reinsertion a l index de depose neutralisee',
    find: 'grid.insertBefore(card, ph);',
    replace: 'void ph;',
    expect: 'reorder-order',
  },
  {
    name: 'ecriture localStorage neutralisee',
    find: 'window.localStorage.setItem(storageKey, JSON.stringify(payload));',
    replace: 'void payload;',
    expect: 'reload-restore',
  },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__board-check') {
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

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE: ${msg.text()}`); });
  await page.addInitScript(INIT_SCRIPT);

  const sig = () => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.pab-widget'), (c) => c.getAttribute('data-metric') + ':' + c.getAttribute('data-viz')));
  const storedSig = () => page.evaluate(() => {
    try { const o = JSON.parse(localStorage.getItem('pab-check')); return o && o.widgets ? o.widgets.map((w) => w.metric + ':' + w.viz) : null; } catch (e) { return null; }
  });
  const widgetCount = () => page.evaluate(() => document.querySelectorAll('.pab-widget').length);
  const waitWidgets = (n) => page.waitForFunction((k) => document.querySelectorAll('.pab-widget').length === k, n, { timeout: 10000 });
  const waitRendered = () => page.waitForFunction(() => {
    const r = document.querySelector('.pab');
    return r && Number(r.getAttribute('data-render')) >= 1 && document.querySelectorAll('.pab-widget').length >= 3;
  }, null, { timeout: 10000 });

  try {
    await page.goto(`${BASE_URL}/__board-check?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.PinlaneAnalyticsBoard && window.PinlaneCharts && window.PinlaneDateRange, null, { timeout: 10000 });
    await page.evaluate(() => localStorage.removeItem('pab-check'));
    await page.evaluate(() => window.__mountBoard());
    await waitRendered();

    // ---- 1. N=3 widgets, chacun un SVG de hauteur > 0 ----------------------
    const t1 = await page.evaluate(() => {
      const cards = Array.prototype.slice.call(document.querySelectorAll('.pab-widget'));
      const svgHeights = cards.map((c) => {
        const svg = c.querySelector('.pab-widget-body svg');
        return svg ? Math.round(svg.getBoundingClientRect().height) : 0;
      });
      return {
        count: cards.length,
        svgHeights: svgHeights,
        allSvg: svgHeights.every((h) => h > 0),
        noHeader: document.querySelectorAll('#host header').length === 0,
        firstCall: (window.__calls[0] || null),
      };
    });
    ok(t1.count === 3, 'mount-3-widgets', `count=${t1.count}`);
    ok(t1.allSvg, 'each-widget-svg', `hauteurs SVG=${JSON.stringify(t1.svgHeights)}`);
    ok(t1.noHeader, 'no-header', 'aucune balise header ne doit etre emise');
    ok(t1.firstCall && t1.firstCall.start === EXPECT_LAST30_START && t1.firstCall.end === MAX_DATE,
      'mount-fetch-default', JSON.stringify(t1.firstCall));

    const sig0 = await sig();
    ok(eq(sig0, ['revenue:line', 'byType:donut', 'reservations:bars']), 'default-order', JSON.stringify(sig0));

    // ---- 2. Entrer en edition : badges supprimer + tuile + + jiggle --------
    await page.click('.pab-customize');
    const t2 = await page.evaluate(() => {
      const removes = Array.prototype.slice.call(document.querySelectorAll('.pab-remove'));
      const removeVisible = removes.filter((b) => getComputedStyle(b).display !== 'none').length;
      const addTile = document.querySelector('.pab-add-tile');
      const addVisible = addTile ? getComputedStyle(addTile).display !== 'none' : false;
      const w0 = document.querySelector('.pab-widget');
      const anim = w0 ? getComputedStyle(w0).animationName : '';
      return { removeVisible: removeVisible, addVisible: addVisible, anim: anim };
    });
    ok(t2.removeVisible === 3, 'edit-remove-badges', `badges visibles=${t2.removeVisible}`);
    ok(t2.addVisible, 'edit-add-tile', 'la tuile + doit etre visible en edition');
    ok(/pab-jiggle/.test(t2.anim), 'edit-jiggle', `animationName=${t2.anim}`);

    // ---- 5. Reordre par VRAI drag : 1er widget passe apres le 2e -----------
    // (fait avant l'ajout/suppression pour un ordre de depart connu)
    const geom = await page.evaluate(() => {
      const cards = document.querySelectorAll('.pab-widget');
      const h = cards[0].querySelector('.pab-handle').getBoundingClientRect();
      const c2 = cards[1].getBoundingClientRect();
      return {
        hx: h.left + h.width / 2, hy: h.top + h.height / 2,
        c2x: c2.left + c2.width / 2, c2y: c2.top + c2.height * 0.75,
      };
    });
    await page.mouse.move(geom.hx, geom.hy);
    await page.mouse.down();
    await page.mouse.move(geom.hx, geom.hy + 8); // franchit le seuil de drag
    await page.mouse.move((geom.hx + geom.c2x) / 2, (geom.hy + geom.c2y) / 2, { steps: 6 });
    await page.mouse.move(geom.c2x, geom.c2y, { steps: 6 });
    await page.mouse.up();
    await waitWidgets(3);

    const sig2 = await sig();
    const stored2 = await storedSig();
    ok(sig2[0] === 'byType:donut' && sig2[1] === 'revenue:line', 'reorder-order', `avant=${JSON.stringify(sig0)} apres=${JSON.stringify(sig2)}`);
    ok(eq(stored2, sig2), 'reorder-store', `dom=${JSON.stringify(sig2)} store=${JSON.stringify(stored2)}`);

    // ---- 3. Ajouter un widget (occupancy / tile) via le choix --------------
    await page.click('.pab-add-tile');
    await page.waitForSelector('.pab-picker', { timeout: 5000 });
    await page.click('.pab-pick-metric[data-pick-metric="occupancy"]');
    await page.click('.pab-pick-viz[data-pick-viz="tile"]');
    await page.click('.pab-picker-add');
    await waitWidgets(4);
    const sig3 = await sig();
    const stored3 = await storedSig();
    ok(sig3.length === 4, 'add-count', `count=${sig3.length}`);
    ok(sig3[3] === 'occupancy:tile', 'add-metric', JSON.stringify(sig3));
    ok(stored3 && stored3.length === 4 && stored3[3] === 'occupancy:tile', 'add-store', JSON.stringify(stored3));
    const tileTxt = await page.evaluate(() => {
      const c = document.querySelector('.pab-widget[data-metric="occupancy"] .pab-tile-value');
      return c ? c.textContent : '';
    });
    ok(/\d/.test(tileTxt) && /%/.test(tileTxt), 'add-tile-value', `valeur tuile="${tileTxt}"`);

    // ---- 4. Supprimer un widget (l'occupancy ajoute) -----------------------
    // force:true : la carte oscille en continu (jiggle), Playwright ne la juge
    // jamais "stable" ; on clique quand meme le badge a sa position vivante.
    await page.click('.pab-widget[data-metric="occupancy"] .pab-remove', { force: true });
    await waitWidgets(3);
    const sig4 = await sig();
    const stored4 = await storedSig();
    ok(sig4.length === 3, 'remove-count', `count=${sig4.length}`);
    ok(sig4.indexOf('occupancy:tile') === -1, 'remove-gone', JSON.stringify(sig4));
    ok(stored4 && stored4.length === 3 && stored4.indexOf('occupancy:tile') === -1, 'remove-store', JSON.stringify(stored4));

    // ---- Sortie du mode edition --------------------------------------------
    await page.click('.pab-customize');
    const editState = await page.evaluate(() => document.querySelector('.pab').getAttribute('data-editing'));
    ok(editState === 'false', 'exit-edit', `data-editing=${editState}`);

    // ---- 6. Changer la plage : getAnalytics rappele avec les bonnes dates --
    const callsBefore = await page.evaluate(() => window.__calls.length);
    await page.click('.pdr-range-trigger');
    await page.click('.pdr-preset[data-preset="last7"]');
    await page.waitForFunction((n) => window.__calls.length > n, callsBefore, { timeout: 10000 });
    const lastCall = await page.evaluate(() => window.__calls[window.__calls.length - 1]);
    ok(lastCall && lastCall.start === EXPECT_LAST7_START && lastCall.end === MAX_DATE,
      'range-refetch', JSON.stringify(lastCall));

    // ---- 7. Reload (nouvelle instance, meme storageKey) restaure la config -
    const sigBeforeReload = await sig();
    const rangePillBefore = await page.evaluate(() => {
      const el = document.querySelector('.pdr-range-value');
      return el ? el.textContent : '';
    });
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.PinlaneAnalyticsBoard && window.PinlaneCharts && window.PinlaneDateRange, null, { timeout: 10000 });
    await page.evaluate(() => window.__mountBoard());
    await waitRendered();
    const sigAfterReload = await sig();
    ok(eq(sigAfterReload, sigBeforeReload), 'reload-restore', `avant=${JSON.stringify(sigBeforeReload)} apres=${JSON.stringify(sigAfterReload)}`);
    const t7 = await page.evaluate(({ expStart, maxDate }) => {
      const fmt = (iso) => { const p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' }); };
      const el = document.querySelector('.pdr-range-value');
      return { pill: el ? el.textContent : '', expected: fmt(expStart) + ' → ' + fmt(maxDate) };
    }, { expStart: EXPECT_LAST7_START, maxDate: MAX_DATE });
    ok(t7.pill === t7.expected, 'reload-range', `pill="${t7.pill}" attendu="${t7.expected}" (avant reload="${rangePillBefore}")`);
  } catch (error) {
    ok(false, 'suite-exception', error.message);
  } finally {
    await page.close();
  }

  // ---- Mode edition sous reduced-motion : aucune oscillation --------------
  const pageRm = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  pageRm.on('pageerror', (e) => consoleErrors.push(`PAGEERROR(rm): ${e.message}`));
  pageRm.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE(rm): ${msg.text()}`); });
  await pageRm.addInitScript(INIT_SCRIPT);
  try {
    await pageRm.emulateMedia({ reducedMotion: 'reduce' });
    await pageRm.goto(`${BASE_URL}/__board-check?rm=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await pageRm.waitForFunction(() => window.PinlaneAnalyticsBoard && window.PinlaneCharts && window.PinlaneDateRange, null, { timeout: 10000 });
    await pageRm.evaluate(() => { localStorage.removeItem('pab-rm'); window.__mountBoard('host', 'pab-rm'); });
    await pageRm.waitForFunction(() => document.querySelectorAll('.pab-widget').length >= 3, null, { timeout: 10000 });
    await pageRm.click('.pab-customize');
    const rm = await pageRm.evaluate(() => {
      const w0 = document.querySelector('.pab-widget');
      const removes = Array.prototype.slice.call(document.querySelectorAll('.pab-remove'));
      return {
        anim: getComputedStyle(w0).animationName,
        removeVisible: removes.filter((b) => getComputedStyle(b).display !== 'none').length,
      };
    });
    ok(rm.anim === 'none', 'rm-no-jiggle', `animationName=${rm.anim} (aucune oscillation attendue)`);
    ok(rm.removeVisible === 3, 'rm-edit-badges', `badges visibles=${rm.removeVisible}`);
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
      console.error(`analytics-board-check: ROUGE en nominal (${base.join(', ')})`);
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
        applyEdit(LIB, m.replace, m.find); // edition inverse exacte, jamais git checkout
      }
      if (fs.readFileSync(LIB, 'utf8') !== original) {
        console.error('analytics-board-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`analytics-board-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`analytics-board-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`analytics-board-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('analytics-board-check: ALL OK (3 widgets + SVG, edition badges/tuile+/jiggle, ajout+persist, suppression+persist, reordre par vrai drag + persist, refetch sur changement de plage, restauration au reload, reduced-motion sans oscillation, console propre, 2 contre-preuves par mutation)');
  } finally {
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('analytics-board-check: exception', error.message);
  process.exit(1);
});
