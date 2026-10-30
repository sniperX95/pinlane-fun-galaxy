// G143 / DEP01: vrais scripts et middleware, services simules, localhost seulement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { chromium } = require('playwright-core');
const esbuild = require('esbuild');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts/preprod-fixes-20260912/csp');
const deploymentConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
// Edge, comme les autres gates : sans lui, Playwright cherche son propre
// Chromium, que le poste a et que les machines GitHub n ont pas (2026-10-30).
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'ok' : 'FAIL'} ${label}${detail ? ' ' + detail : ''}`);
  if (!condition) failures += 1;
}

function marketingHarness() {
  const filename = path.join(ROOT, 'scripts/marketing-ia-check.js');
  const source = fs.readFileSync(filename, 'utf8');
  const footer = source.lastIndexOf('main().catch(');
  assert(footer > 0, 'point d entree du gate marketing introuvable');
  const sandbox = { require: createRequire(filename), __dirname: path.dirname(filename), process,
    console, module: { exports: {} } };
  // Charge les vrais mocks/helpers, sans executer le long gate complet.
  vm.runInNewContext(source.slice(0, footer) + '\nmodule.exports = { installMock, '
    + 'waitForAsk: typeof waitForAsk === "function" ? waitForAsk : null };', sandbox, { filename });
  return { ...sandbox.module.exports, source };
}

async function marketingDelayCheck() {
  const harness = marketingHarness();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) { res.writeHead(503); res.end('API non simulee'); return; }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml' };
    fs.readFile(file, (err, body) => { res.writeHead(err ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(err ? '' : body); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base
      ? route.continue() : route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await harness.installMock(page);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.setView === 'function');
    await page.evaluate(() => { state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForFunction(() => document.querySelector('.mkw-chip-suggest'));
    const send = question => page.evaluate(q => {
      window.mkwMode('demander');
      const input = document.getElementById('brAskInput');
      input.value = q; input.dispatchEvent(new Event('input'));
      const asksBefore = window.__QA_ASKS__.length;
      window.mkwSend();
      return { question: q, asksBefore, centerId: 'libramont' };
    }, question);
    await send('Que fait Bowling Arlon ?');
    await page.waitForFunction(() => /Ce que fait Bowling Arlon/.test(document.querySelector('.mkw-turn-answer')?.textContent || '') && !document.querySelector('[aria-busy="true"]'));
    // Retarde la CONSOMMATION du corps, pas le contenu ni le rendu produit.
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async (input, init = {}) => {
        const response = await original(input, init);
        if (String(init.body || '').includes('capitale du danemark')) {
          const read = response.text.bind(response);
          response.text = async () => { await new Promise(resolve => setTimeout(resolve, 1400)); return read(); };
        }
        return response;
      };
    });
    let result;
    if (harness.waitForAsk) {
      const sent = await send('quelle est la capitale du danemark');
      const start = Date.now();
      result = await harness.waitForAsk(page, sent);
      check('G143 attend le corps retarde au-dela de 1 seconde', Date.now() - start >= 1400, JSON.stringify(result));
    } else {
      // Red-first : execute EXACTEMENT le bloc fautif du gate courant.
      const begin = harness.source.indexOf('    const unknown = await page.evaluate(');
      const end = harness.source.indexOf('\n    ok(', begin);
      assert(begin > 0 && end > begin);
      result = await vm.runInNewContext('(async () => {' + harness.source.slice(begin, end) + '; return unknown; })()', { page });
      result.pending = await page.locator('[aria-busy="true"]').count() > 0;
      console.log('G143 ancienne attente / corps retarde:', JSON.stringify(result));
    }
    check('G143 nouvelle reponse hors perimetre identifiee', /pas mon sujet/i.test(result.text) && !/copenhague/i.test(result.text) && !result.pending);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    if (harness.waitForAsk) {
      let rejected = false;
      try { await harness.waitForAsk(page, { question: 'question jamais envoyee', asksBefore: 999, centerId: 'libramont' }, 150); }
      catch (error) { rejected = /pending|requests|text/.test(error.message); console.log('G143 timeout attendu:', error.message); }
      check('G143 une ancienne reponse ne satisfait pas une nouvelle question', rejected);
    }
    check('G143 aucune erreur JS', errors.length === 0, JSON.stringify(errors));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

function loadMiddleware(env = {}, config = deploymentConfig) {
  const filename = path.join(ROOT, 'middleware.ts');
  const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const sandbox = { module: { exports: {} }, exports: {}, process: { env }, URL, Request, Response, Headers,
    TextEncoder, crypto: global.crypto, atob, require: name => name === '@vercel/functions'
      ? require('@vercel/functions/middleware') : name === './vercel.json' ? config
      : createRequire(filename)(name) };
  vm.runInNewContext(compiled, sandbox, { filename });
  return sandbox.module.exports;
}

async function cspCheck() {
  const { default: middleware, config } = loadMiddleware();
  const response = await middleware(new Request('https://pinlane.test/reserver/libramont'));
  const csp = response.headers.get('Content-Security-Policy') || '';
  check('DEP01 les directives de chargement ET iframe sont servies', csp.includes("default-src 'self'") && csp.includes("script-src 'self' 'unsafe-inline'") && csp.includes("frame-ancestors 'self'"), csp);
  const baseHeaders = deploymentConfig.headers.find(rule => rule.source === '/(.*)').headers;
  const base = baseHeaders.find(header => header.key.toLowerCase() === 'content-security-policy').value;
  const directives = value => value.split(';').map(part => part.trim()).filter(Boolean);
  const complete = value => directives(base).every(directive => directives(value).includes(directive))
    && directives(value).some(directive => directive.startsWith("frame-ancestors 'self'"));
  check('DEP01 chaque directive statique conserve sa valeur exacte', complete(csp));
  check('DEP01 aucune directive dupliquee', new Set(directives(csp).map(d => d.split(' ')[0])).size === directives(csp).length);
  check('DEP01 controle negatif: iframe seul est incomplet', !complete(directives(csp).find(d => d.startsWith('frame-ancestors')) || ''));
  check('DEP01 controle negatif: perdre script-src est detecte', !complete(directives(csp).filter(d => !d.startsWith('script-src ')).join('; ')));
  check('DEP01 toutes les routes restent couvertes', config.matcher === '/:path*');
  // Contre-preuve de source unique en memoire: la configuration importee
  // change et le middleware reprend exactement cette valeur, sans copie en dur.
  const changed = structuredClone(deploymentConfig);
  changed.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value += "; manifest-src 'self'";
  const changedResponse = await loadMiddleware({}, changed).default(new Request('https://pinlane.test/'));
  check('DEP01 une directive ajoutee a la source arrive dans la reponse', changedResponse.headers.get('Content-Security-Policy').includes("manifest-src 'self'"));
  const historical = directives(csp).find(d => d.startsWith('frame-ancestors'));
  const env = { EMBED_ORIGINS: 'https://customer.example.test, https://customer.example.test, https://customer.example.test/path',
    SITE_USERNAME: 'fixture-staff', SITE_PASSWORD: 'fixture-password', DIRECTOR_USERNAME: 'fixture-direction', DIRECTOR_PASSWORD: 'fixture-director-password', CRON_SECRET: 'fixture-cron' };
  const withEnv = loadMiddleware(env).default;
  const authorization = (username, password) => 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const cases = [
    ...['/', '/index.html', '/reserver', '/reserver/libramont', '/reserver/gembloux', '/demo', '/demo/demo.js', '/menu', '/menu/viewer.js', '/pro.html', '/public-form.html', '/embed.js', '/assets/boot-view.js', '/api/custom-request', '/api/healthz'].map(route => ({ route, status: 200 })),
    { route: '/direction.html', status: 401 },
    { route: '/direction.html', status: 200, auth: authorization(env.DIRECTOR_USERNAME, env.DIRECTOR_PASSWORD) },
    { route: '/fixture-private', status: 401 },
    { route: '/fixture-private', status: 200, auth: authorization(env.SITE_USERNAME, env.SITE_PASSWORD) },
    { route: '/api/cron/ops-jobs', status: 200, auth: 'Bearer ' + env.CRON_SECRET },
    { route: '/fixture-private', status: 503, noConfig: true },
  ];
  for (const scenario of cases) {
    const result = await (scenario.noConfig ? middleware : withEnv)(new Request('https://pinlane.test' + scenario.route,
      { headers: scenario.auth ? { authorization: scenario.auth } : {} }));
    const policy = result.headers.get('Content-Security-Policy') || '';
    check(`DEP01 route ${scenario.route} -> ${scenario.status}, CSP complete`, result.status === scenario.status && complete(policy));
    if (!scenario.noConfig) {
      const ancestors = directives(policy).find(d => d.startsWith('frame-ancestors')) || '';
      assert(historical.split(' ').every(origin => ancestors.split(' ').includes(origin)), 'une installation historique a disparu');
      assert.equal(ancestors.split(' ').filter(origin => origin === 'https://customer.example.test').length, 1);
      assert(!ancestors.includes('/path'));
    }
  }
  // Compile le vrai middleware avec son JSON, en memoire. Le runtime Vercel
  // reste une dependance externe; sa vraie fonction next() est executee ci-dessus.
  const bundle = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'middleware.ts')], bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', external: ['@vercel/functions'], write: false, metafile: true });
  check('DEP01 build middleware + import JSON', bundle.outputFiles[0].text.includes("default-src 'self'")
    && Object.keys(bundle.metafile.inputs).some(file => file.endsWith('vercel.json')));
  return csp;
}

async function renderCheck() {
  fs.mkdirSync(OUT, { recursive: true });
  const built = fs.mkdtempSync(path.join(OUT, 'public-build-'));
  for (const folder of ['assets', 'demo', 'menu']) fs.cpSync(path.join(ROOT, folder), path.join(built, folder), { recursive: true });
  for (const file of ['index.html', 'pro.html', 'public-form.html', 'embed.js']) {
    if (fs.existsSync(path.join(ROOT, file))) fs.copyFileSync(path.join(ROOT, file), path.join(built, file));
  }
  const buildLog = execFileSync(process.execPath, ['tools/build-public.js'], { cwd: ROOT,
    env: { ...process.env, BUILD_PUBLIC_ROOT: built }, encoding: 'utf8', windowsHide: true });
  console.log('DEP01 build-public en sous-copie:', buildLog.trim());
  check('DEP01 build-public transforme effectivement la copie', !/absent|laisse tel quel\s*:/i.test(buildLog)
    && fs.readFileSync(path.join(built, 'index.html'), 'utf8') !== fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const middleware = loadMiddleware().default;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const mw = await middleware(new Request(url));
      const headers = new Headers(deploymentConfig.headers[0].headers.map(h => [h.key, h.value]));
      for (const [key, value] of mw.headers) if (key !== 'x-middleware-next') headers.set(key, value);
      if (req.url === '/embed.js') headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      if (mw.status !== 200) { res.writeHead(mw.status, Object.fromEntries(headers)); res.end(await mw.text()); return; }
      if (url.pathname.startsWith('/api/')) { res.writeHead(503); res.end('API non simulee'); return; }
      const route = url.pathname === '/' || url.pathname.startsWith('/reserver') ? '/index.html'
        : url.pathname === '/demo' ? '/demo/index.html' : url.pathname;
      const file = path.join(built, route);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
      const body = fs.readFileSync(file);
      headers.set('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.writeHead(200, Object.fromEntries(headers)); res.end(body);
    } catch (error) { res.writeHead(404); res.end('Fichier absent'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
    const external = [], localAssets = [], pageErrors = [], unmocked = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(base + '/assets/')) localAssets.push({ url: new URL(response.url()).pathname, status: response.status() }); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue();
      external.push(url.href);
      const headers = { 'Access-Control-Allow-Origin': '*' };
      if (url.origin === 'https://cdn.vercel-insights.com') return route.fulfill({ headers, contentType: 'text/javascript', body: 'window.__CSP_ANALYTICS_STUB__ = true;' });
      if (url.origin === 'https://vitals.vercel-insights.com') return route.fulfill({ headers, contentType: 'application/json', body: '{}' });
      if (url.origin === 'https://fonts.googleapis.com') return route.fulfill({ headers, contentType: 'text/css', body: '@font-face{font-family:CspFixture;src:url(https://fonts.gstatic.com/csp-fixture.woff2)}' });
      if (url.origin === 'https://fonts.gstatic.com') return route.fulfill({ headers, contentType: 'font/woff2', body: fs.readFileSync(path.join(ROOT, 'assets/fonts/geist-latin.woff2')) });
      unmocked.push(url.href);
      return route.abort();
    });
    await marketingHarness().installMock(page);
    await page.addInitScript(() => {
      window.__CSP_VIOLATIONS__ = [];
      document.addEventListener('securitypolicyviolation', event => window.__CSP_VIOLATIONS__.push({ directive: event.effectiveDirective, uri: event.blockedURI }));
    });
    for (const route of ['/', '/reserver/libramont', '/reserver/gembloux', '/pro.html', '/demo']) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      check(`DEP01 rendu ${route} sous CSP complete`, response.status() === 200
        && (await response.headerValue('content-security-policy')).includes("default-src 'self'")
        && await page.locator('body').innerText().then(text => text.trim().length > 20));
      const violations = await page.evaluate(() => window.__CSP_VIOLATIONS__);
      check(`DEP01 assets permis ${route}`, violations.length === 0, JSON.stringify(violations));
    }
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => { state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark'; save(); setView('staff'); renderStaff(); });
    await page.waitForFunction(() => document.querySelector('.mkw-mode'));
    await page.locator('.mkw-mode').filter({ hasText: 'Demander' }).click();
    check('DEP01 onclick inline existant fonctionne', await page.locator('.mkw-mode').filter({ hasText: 'Demander' }).getAttribute('class').then(value => /active/.test(value)));
    check('DEP01 script inline initial + analytics autorise', await page.evaluate(() => Boolean(document.documentElement.dataset.theme) && window.__CSP_ANALYTICS_STUB__ === true));
    const integrations = await page.evaluate(async () => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/csp-fixture';
      await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; document.head.append(link); });
      await document.fonts.load('16px CspFixture');
      const vitals = await fetch('https://vitals.vercel-insights.com/csp-fixture');
      const cdn = await fetch('https://cdn.vercel-insights.com/csp-fixture');
      const frame = document.createElement('iframe'); frame.src = '/demo';
      await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
      return { font: document.fonts.check('16px CspFixture'), vitals: vitals.ok, cdn: cdn.ok, frame: frame.contentDocument.body.textContent.trim().length > 20 };
    });
    check('DEP01 fonts, connexions analytics et iframe self permis (mocks)', Object.values(integrations).every(Boolean), JSON.stringify(integrations));
    check('DEP01 JS CSS et polices locales effectivement charges', ['.js', '.css', '.woff2'].every(ext => localAssets.some(asset => asset.url.endsWith(ext) && asset.status === 200)));
    const violations = await page.evaluate(() => window.__CSP_VIOLATIONS__);
    check('DEP01 aucune violation sur le rendu permis', violations.length === 0, JSON.stringify(violations));
    check('DEP01 aucune erreur JS ou destination non simulee', pageErrors.length === 0 && unmocked.length === 0, JSON.stringify({ pageErrors, unmocked }));
    await page.screenshot({ path: path.join(OUT, 'render-built-csp.png'), fullPage: true });
    fs.writeFileSync(path.join(OUT, 'render-evidence.json'), JSON.stringify({ buildLog, localAssets, externalMocks: external, integrations, violations, pageErrors, unmocked }, null, 2));
    console.log('DEP01 preuves navigateur:', OUT);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

function clockCheck() {
  // Le vrai gate est rejoue depuis une autre date d'hote. Il doit recaler
  // toutes ses horloges lui-meme, avant ses imports et les vraies regles prix.
  const preload = 'const NativeDate = Date; global.Date = class extends NativeDate {'
    + 'constructor(...args) { super(...(args.length ? args : ["2030-01-15T10:00:00Z"])); }'
    + 'static now() { return NativeDate.parse("2030-01-15T10:00:00Z"); }};'
    + 'require("./scripts/center-advisor-check.js");';
  const output = execFileSync(process.execPath, ['-e', preload], { cwd: ROOT, env: process.env, encoding: 'utf8', windowsHide: true });
  check('G106 le gate complet passe meme depuis une horloge hote en 2030', output.includes('center-advisor-check: ALL OK'), `${output.split('\n').filter(line => line.startsWith('ok ')).length} controles`);
}

(async () => {
  await marketingDelayCheck();
  await cspCheck();
  await renderCheck();
  clockCheck();
  console.log(`preprod-csp-check: ${failures ? failures + ' ECHEC(S)' : 'ALL OK'}`);
  process.exitCode = failures ? 1 : 0;
// (un plantage sort tout de suite : un serveur encore ouvert gardait le gate
// en vie 40 min, le delai de son lanceur)
})().catch(error => { console.error(error.stack || error); process.exit(1); });
