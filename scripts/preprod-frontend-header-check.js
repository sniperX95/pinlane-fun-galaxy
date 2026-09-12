// Targeted marketing header check. Run only via run-isolated.cjs.
// Real app + fixtures from scripts/run-visual-qa.js; no sensitive env or remote I/O.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts/preprod-fixes-20260912/frontend/header');
const qa = fs.readFileSync(path.join(__dirname, 'run-visual-qa.js'), 'utf8');
const currentCss = fs.readFileSync(path.join(ROOT, 'assets/pinlane-staff.css'), 'utf8');
// Remove only the two corrective rules in this mobile media query, in memory.
// No Git/history dependency: short checkouts still exercise the current UI.
const mobileFix = /(@media \(max-width: 720px\) \{\r?\n[ \t]+\.mkw-head \{ padding-top: var\(--space-6\); \}\r?\n)([ \t]+\.mkw-head-id \{ flex-wrap: wrap; \}\r?\n[ \t]+\.mkw-head-main \{ flex: 1 1 180px; \}\r?\n)/g;
const fixes = [...currentCss.matchAll(mobileFix)];
const mutatedCss = currentCss.replace(mobileFix, '$1');
const results = [], measurements = [], errors = [], blocked = [];
const witnessMarkup = new Map();
let baseUrl;
function ok(pass, id, detail) { results.push({ pass: !!pass, id, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(detail)); }
function fixture(name) {
  const start = qa.indexOf('async function ' + name + '(');
  const end = /\r?\n\}\r?\n/.exec(qa.slice(start));
  if (start < 0 || !end) throw new Error('Missing fixture ' + name);
  return new Function('BASE_URL', qa.slice(start, start + end.index + end[0].length) + '\nreturn ' + name)(baseUrl);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, baseUrl).pathname).slice(1) || 'index.html';
  if (req.method !== 'GET' || !/^(index\.html$|assets\/|favicon\.)/.test(rel) || rel.includes('..')) { res.writeHead(403); return res.end(); }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': (mime[path.extname(rel)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(err ? '' : data);
  });
});
async function main({ capture = false } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  ok(fixes.length === 1 && currentCss.length - mutatedCss.length === fixes[0][2].length && mutatedCss !== currentCss, 'header-exact-in-memory-mutation', { matches: fixes.length, removedRules: fixes[0]?.[2] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [320, 390]) for (const theme of ['light', 'dark']) for (const version of ['mutated-css', 'current']) {
      const id = `${version}-${width}-${theme}`;
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => {
          const u = new URL(route.request().url());
          if (u.origin !== baseUrl) { blocked.push(u.hostname); return route.abort(); }
          if (version === 'mutated-css' && u.pathname === '/assets/pinlane-staff.css') return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: mutatedCss });
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(7000);
        page.on('pageerror', error => errors.push({ id, message: error.message }));
        await fixture('installQaApi')(page);
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => typeof setView === 'function');
        await fixture('seedStressDay')(page);
        await page.waitForFunction(() => typeof renderStaffCampaignsPage === 'function');
        await page.evaluate(t => {
          setStaffTheme(t); state.staffMenuPage = 'campaigns'; renderStaff(); renderStaffCampaignsPage();
        }, theme);
        await page.locator('.mkw-head').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        await page.evaluate(() => window.scrollTo(0, 0));
        const measure = () => page.locator('.mkw-head').evaluate(head => {
          const main = head.querySelector('.mkw-head-main'), desc = head.querySelector('.mkw-head-desc'), nav = head.querySelector('.mkw-head-nav');
          const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          const d = box(desc), n = box(nav), style = getComputedStyle(desc);
          const range = document.createRange(); range.selectNodeContents(desc);
          const lineTops = [...new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.y)))];
          return { text: desc.textContent.trim(), desc: d, main: box(main), head: box(head), nav: n, lines: lineTops.length,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && d.height > 0,
            overflow: desc.scrollWidth > desc.clientWidth + 1,
            overlap: d.x < n.right && d.right > n.x && d.y < n.bottom && d.bottom > n.y,
            controls: [...nav.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label') || b.textContent.trim(), ...box(b) })) };
        });
        const m = await measure(); measurements.push({ id, ...m });
        const markupKey = `${width}-${theme}`, markup = await page.locator('.mkw-head').evaluate(el => el.outerHTML);
        if (version === 'mutated-css') witnessMarkup.set(markupKey, markup);
        const sameMarkup = witnessMarkup.get(markupKey) === markup;
        ok(sameMarkup && m.visible && m.text.includes('Vous validez, rien ne part tout seul.') && m.controls.length >= 3 && m.controls.every(c => c.width > 0 && c.height > 0), 'header-content-' + id, { ...m, sameMarkup });
        if (version === 'mutated-css') ok(m.desc.width < 180 || m.lines > 4 || m.overlap, 'header-mutated-defect-' + id, { width: m.desc.width, lines: m.lines, overlap: m.overlap });
        else {
          ok(m.desc.width >= 180 && m.lines <= 4 && !m.overflow && !m.overlap && m.desc.x >= 0 && m.desc.right <= width, 'header-readable-' + id, m);
          await page.evaluate(() => window.scrollTo(0, 180));
          const scrolled = await measure();
          ok(Math.abs(scrolled.desc.width - m.desc.width) < 1 && scrolled.lines === m.lines, 'header-scroll-invariant-' + id, { width: scrolled.desc.width, lines: scrolled.lines });
          await page.evaluate(() => window.scrollTo(0, 0));
          // Optional focused proof; routine gate runs do not generate screenshots.
          if (capture && width === 320 && theme === 'light') await page.screenshot({ path: path.join(OUT, 'header-320-light.png') });
        }
      } catch (error) { ok(false, id + '-execution', error.message); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); server.close(); }
  ok(!errors.length, 'header-browser-errors', errors);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, measurements, errors, blocked }, null, 2));
  console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length, output: OUT }));
  process.exitCode = results.some(r => !r.pass) ? 1 : 0;
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
