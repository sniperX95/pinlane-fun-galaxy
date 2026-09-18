// Gate du selecteur window.PinlaneDateRange (assets/pinlane-daterange.js +
// assets/pinlane-daterange.css). Page HTML minimale servie en memoire, rendu
// reel dans Edge headless (playwright-core), interactions PILOTEES (vrais clics
// / vraies touches), preuves COMPORTEMENTALES (jamais de presence de chaine) :
//   1. mount rend les 3 controles et affiche la plage initiale formatee FR ;
//   2. clic "30 derniers jours" : onChange avec end=maxDate et
//      start=maxDate-29 (dates calculees, egalite stricte) ;
//   3. "Ce mois-ci" : start = 1er du mois de maxDate ;
//   4. changer la granularite : onChange granularity='week' ;
//   5. activer Comparer (compare='previous') puis Annee precedente
//      (compare='year'), desactiver (compare='none') ;
//   6. start>end saisi en Personnalise est borne : onChange ne recoit jamais
//      start>end (ici start ramene sur end) ;
//   7. clic exterieur ferme le popover (panneau retire du DOM,
//      aria-expanded='false') ;
//   8. Echap ferme ;
//   9. prefers-reduced-motion (emulateMedia) : pas d'animation d'ouverture
//      (opacite 1, transform none MESURES a t0) ; en motion normale, t0 mesure
//      opacite < 0.5 (l'animation EXISTE, contraste) ;
//  10. zero erreur console.
// Contre-preuve par mutation : le script mute assets/pinlane-daterange.js,
// verifie que le gate ROUGIT sur le check attendu, puis restaure par edition
// inverse (JAMAIS git checkout). Mutation sans effet = sortie en erreur.
// Lancement : node scripts/daterange-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DATERANGE_PORT || 4271);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LIB = path.join(ROOT, 'assets', 'pinlane-daterange.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const MAX_DATE = '2026-07-21';
const INIT_START = '2026-04-30';
const INIT_END = '2026-06-27';

// Reference de calcul cote Node (fuseau local, comme le composant). Sert a
// produire les valeurs attendues sans dupliquer une logique approximative.
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoFromDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function addDaysNode(iso, n) {
  const p = iso.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return isoFromDate(d);
}
const EXPECT_LAST30_START = addDaysNode(MAX_DATE, -29);
const EXPECT_THISMONTH_START = MAX_DATE.slice(0, 7) + '-01';

// Page de test : tokens theme (pinlane.css) + le composant. Pas de <header>
// (body.admin-mode header l'ecraserait a hauteur 0). Un bouton exterieur pour
// prouver la fermeture au clic dehors.
const PAGE_HTML = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate pinlane-daterange</title>
<link rel="stylesheet" href="/assets/pinlane.css">
<link rel="stylesheet" href="/assets/pinlane-daterange.css">
</head>
<body>
<main style="max-width:760px;margin:0 auto;padding:48px 24px;display:grid;gap:40px">
  <button id="outside" type="button">dehors</button>
  <div id="host"></div>
</main>
<script src="/assets/pinlane-daterange.js"></script>
</body>
</html>`;

const MUTATIONS = [
  {
    name: 'calcul "30 derniers jours" decale (-29 -> -30)',
    find: 'addDays(maxDate, -29)',
    replace: 'addDays(maxDate, -30)',
    expect: 'last30-start',
  },
  {
    name: 'garde start<=end de clampRange neutralisee',
    find: 'if (cmp(s, e) > 0) { s = e; }',
    replace: 'if (false) { s = e; }',
    expect: 'custom-order',
  },
];

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__daterange-check') {
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

const MOUNT_INIT = `(function(){
  window.__changes = [];
  window.__pdr = window.PinlaneDateRange.mount('host', {
    value: { start: '${INIT_START}', end: '${INIT_END}', granularity: 'day', compare: 'none' },
    maxDate: '${MAX_DATE}',
    onChange: function (v) { window.__changes.push(v); },
  });
})();`;

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
  // L URL VOYAGE AVEC LE TEXTE : le texte d un sous-chargement rate ne la
  // porte pas, et le filtre plus bas (favicon, vercel-insights) ne pouvait
  // donc jamais mordre sur un echec reseau.
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE: ${msg.text()}${msg.location && msg.location().url ? ` @${msg.location().url}` : ''}`); });

  const lastChange = () => page.evaluate(() => window.__changes[window.__changes.length - 1] || null);

  try {
    await page.goto(`${BASE_URL}/__daterange-check?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.PinlaneDateRange && typeof window.PinlaneDateRange.mount === 'function', null, { timeout: 10000 });
    await page.evaluate(MOUNT_INIT);

    // ---- 1. Trois controles + plage initiale formatee FR --------------------
    const t1 = await page.evaluate(() => {
      const fmt = (iso) => {
        const p = iso.split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
          .toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
      };
      return {
        hasThree: Boolean(document.querySelector('.pdr-range-trigger')
          && document.querySelector('.pdr-gran-trigger')
          && document.querySelector('.pdr-compare-toggle')),
        rangeText: document.querySelector('.pdr-range-value').textContent,
        expectedRange: fmt('2026-04-30') + ' → ' + fmt('2026-06-27'),
        granText: document.querySelector('.pdr-gran-value').textContent,
        val: window.__pdr.getValue(),
        noHeader: document.querySelectorAll('#host header').length === 0,
      };
    });
    ok(t1.hasThree, 'controls-3', 'les 3 controles doivent exister');
    ok(t1.rangeText === t1.expectedRange, 'range-initial-fr', `"${t1.rangeText}" vs "${t1.expectedRange}"`);
    ok(t1.granText === 'Par jour', 'gran-initial', `"${t1.granText}"`);
    ok(t1.val.start === INIT_START && t1.val.end === INIT_END && t1.val.granularity === 'day' && t1.val.compare === 'none',
      'getvalue-initial', JSON.stringify(t1.val));
    ok(t1.noHeader, 'no-header', 'aucune balise header ne doit etre emise');

    // ---- 2. "30 derniers jours" : end=maxDate, start=maxDate-29 --------------
    await page.click('.pdr-range-trigger');
    await page.click('.pdr-preset[data-preset="last30"]');
    const c2 = await lastChange();
    ok(c2 && c2.end === MAX_DATE && c2.start === EXPECT_LAST30_START,
      'last30-start', c2 ? `start ${c2.start} (attendu ${EXPECT_LAST30_START}), end ${c2.end}` : 'aucun onChange');
    ok(c2 && c2.start <= c2.end, 'last30-order', c2 ? `${c2.start} <= ${c2.end}` : 'aucun onChange');

    // ---- 3. "Ce mois-ci" : start = 1er du mois de maxDate -------------------
    await page.click('.pdr-range-trigger');
    await page.click('.pdr-preset[data-preset="thisMonth"]');
    const c3 = await lastChange();
    ok(c3 && c3.start === EXPECT_THISMONTH_START && c3.end === MAX_DATE,
      'thismonth-start', c3 ? `start ${c3.start} (attendu ${EXPECT_THISMONTH_START}), end ${c3.end}` : 'aucun onChange');

    // ---- 4. Granularite -> week --------------------------------------------
    await page.click('.pdr-gran-trigger');
    await page.click('.pdr-item[data-gran="week"]');
    const c4 = await lastChange();
    ok(c4 && c4.granularity === 'week', 'gran-week', c4 ? c4.granularity : 'aucun onChange');
    const granPill = await page.evaluate(() => document.querySelector('.pdr-gran-value').textContent);
    ok(granPill === 'Par semaine', 'gran-pill-week', granPill);

    // ---- 5. Comparer : previous -> year -> none ----------------------------
    await page.click('.pdr-compare-toggle');
    const c5a = await lastChange();
    ok(c5a && c5a.compare === 'previous', 'compare-on-previous', c5a ? c5a.compare : 'aucun onChange');
    await page.click('.pdr-compare-trigger');
    await page.click('.pdr-item[data-compare="year"]');
    const c5b = await lastChange();
    ok(c5b && c5b.compare === 'year', 'compare-year', c5b ? c5b.compare : 'aucun onChange');
    await page.click('.pdr-compare-toggle');
    const c5c = await lastChange();
    ok(c5c && c5c.compare === 'none', 'compare-off-none', c5c ? c5c.compare : 'aucun onChange');

    // ---- 6. Personnalise : start>end borne (onChange jamais start>end) ------
    await page.click('.pdr-range-trigger');
    await page.evaluate(() => {
      const e = document.querySelector('.pdr-date-end');
      e.value = '2026-07-03';
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const c6 = await page.evaluate(() => {
      const s = document.querySelector('.pdr-date-start');
      s.value = '2026-07-20'; // apres la fin 2026-07-03, sous maxDate
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return window.__changes[window.__changes.length - 1] || null;
    });
    ok(c6 && c6.start <= c6.end, 'custom-order', c6 ? `${c6.start} <= ${c6.end}` : 'aucun onChange');
    ok(c6 && c6.start === '2026-07-03' && c6.end === '2026-07-03',
      'custom-clamp', c6 ? `${c6.start} / ${c6.end}` : 'aucun onChange');
    // Ferme le popover encore ouvert (edition Personnalise ne ferme pas).
    await page.keyboard.press('Escape');

    // ---- 7. Clic exterieur ferme -------------------------------------------
    await page.click('.pdr-gran-trigger');
    const open7 = await page.evaluate(() => ({
      hasPanel: Boolean(document.querySelector('.pdr-gran-panel')),
      expanded: document.querySelector('.pdr-gran-trigger').getAttribute('aria-expanded'),
    }));
    await page.click('#outside');
    const closed7 = await page.evaluate(() => ({
      hasPanel: Boolean(document.querySelector('.pdr-gran-panel')),
      expanded: document.querySelector('.pdr-gran-trigger').getAttribute('aria-expanded'),
    }));
    ok(open7.hasPanel && open7.expanded === 'true', 'outside-precondition', JSON.stringify(open7));
    ok(!closed7.hasPanel && closed7.expanded === 'false', 'outside-close', JSON.stringify(closed7));

    // ---- 8. Echap ferme -----------------------------------------------------
    await page.click('.pdr-range-trigger');
    const open8 = await page.evaluate(() => Boolean(document.querySelector('.pdr-range-panel')));
    await page.keyboard.press('Escape');
    const closed8 = await page.evaluate(() => ({
      hasPanel: Boolean(document.querySelector('.pdr-range-panel')),
      expanded: document.querySelector('.pdr-range-trigger').getAttribute('aria-expanded'),
    }));
    ok(open8, 'escape-precondition', 'le popover doit etre ouvert avant Echap');
    ok(!closed8.hasPanel && closed8.expanded === 'false', 'escape-close', JSON.stringify(closed8));

    // ---- 9a. Motion normale : t0 mesure l'animation d'ouverture -------------
    const anim = await page.evaluate(() => {
      const trig = document.querySelector('.pdr-range-trigger');
      if (document.querySelector('.pdr-range-panel')) trig.click(); // ferme si ouvert
      trig.click(); // ouvre (synchrone : aucun rAF n'a encore tourne)
      const panel = document.querySelector('.pdr-range-panel');
      const cs = getComputedStyle(panel);
      const out = { opacity: parseFloat(cs.opacity), transform: cs.transform };
      trig.click(); // referme
      return out;
    });
    ok(anim.opacity < 0.5, 'anim-start-opacity', `opacite t0 = ${anim.opacity} (animation d'entree attendue)`);
    ok(anim.transform !== 'none', 'anim-start-transform', `transform t0 = ${anim.transform}`);
  } catch (error) {
    ok(false, 'suite-exception', error.message);
  } finally {
    await page.close();
  }

  // ---- 9b. reduced-motion : etat final IMMEDIAT a t0 -----------------------
  const pageRm = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  pageRm.on('pageerror', (e) => consoleErrors.push(`PAGEERROR(rm): ${e.message}`));
  pageRm.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`CONSOLE(rm): ${msg.text()}`); });
  try {
    await pageRm.emulateMedia({ reducedMotion: 'reduce' });
    await pageRm.goto(`${BASE_URL}/__daterange-check?rm=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await pageRm.waitForFunction(() => window.PinlaneDateRange && typeof window.PinlaneDateRange.mount === 'function', null, { timeout: 10000 });
    const rm = await pageRm.evaluate((maxDate) => {
      window.PinlaneDateRange.mount('host', {
        value: { start: '2026-04-30', end: '2026-06-27', granularity: 'day', compare: 'none' },
        maxDate: maxDate,
        onChange: function () {},
      });
      const trig = document.querySelector('.pdr-range-trigger');
      trig.click();
      const panel = document.querySelector('.pdr-range-panel');
      const cs = getComputedStyle(panel);
      return { opacity: parseFloat(cs.opacity), transform: cs.transform };
    }, MAX_DATE);
    ok(rm.opacity > 0.99, 'rm-immediate-opacity', `opacite t0 = ${rm.opacity} (1 attendu sans animation)`);
    ok(rm.transform === 'none' || rm.transform === 'matrix(1, 0, 0, 1, 0, 0)', 'rm-immediate-transform', `transform t0 = ${rm.transform}`);
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
      console.error(`daterange-check: ROUGE en nominal (${base.join(', ')})`);
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
        console.error('daterange-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`daterange-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`daterange-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`daterange-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('daterange-check: ALL OK (3 controles + FR, presets calcules, granularite, comparaison, borne start<=end, clic exterieur + Echap, reduced-motion immediat, console propre, 2 contre-preuves par mutation)');
  } finally {
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('daterange-check: exception', error.message);
  process.exit(1);
});
