const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fail = [];
const warn = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.vercel', '.npm-cache', 'artifacts'].includes(entry.name)) return [];
      return walk(rel);
    }
    return rel;
  });
}

function productionFiles() {
  const files = [
    'index.html',
    'public-form.html',
    'pro.html',
    'direction.html',
    'package.json',
    'middleware.ts',
    '.vercelignore',
    ...walk('assets'),
    ...walk('api'),
    ...walk('lib'),
    ...walk('scripts'),
  ];
  return files
    .filter((file) => /\.(html|css|js|json|ts|mjs|cjs|txt)$/i.test(file) || file === '.vercelignore')
    .filter((file) => !file.endsWith(path.join('scripts', 'run-quality-audit.js')));
}

function addFail(message) {
  fail.push(message);
}

function addWarn(message) {
  warn.push(message);
}

const index = read('index.html');
const staffCss = read(path.join('assets', 'pinlane-staff.css'));
const appMain = read(path.join('assets', 'app-main.js'));
const bookingCore = read(path.join('assets', 'booking-core.js'));
const adminConsole = read(path.join('assets', 'admin-console.js'));
const opsConsole = read(path.join('assets', 'ops-console.js'));
const storageAdapter = read(path.join('assets', 'storage-adapter.js'));
const staffAuthSession = read(path.join('assets', 'staff-auth-session.js'));
const apiClient = read(path.join('assets', 'api-client.js'));

if (!/assets\/pinlane\.css/.test(index) || !/assets\/app-main\.js/.test(index)) {
  addFail('index.html must stay a thin shell that loads assets/pinlane.css and assets/app-main.js.');
}
if (/<style[^>]*>(?:(?!<\/style>)[\s\S]){200,}<\/style>/i.test(index) || /<script(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S]){200,}<\/script>/i.test(index)) {
  addFail('index.html must not contain large inline CSS or JavaScript blocks.');
}
if (!/assets\/booking-core\.js/.test(index) || !/PinlaneBookingCore/.test(bookingCore)) {
  addFail('Booking constants and planning helpers must stay extracted from index.html.');
}
// C14 : la console admin n'est plus chargee au boot, app-main.js l'injecte
// dynamiquement a l'ouverture de la vue direction (garde de permission).
if (!/assets\/admin-console\.js/.test(appMain) || !/PinlaneAdminConsole/.test(adminConsole)) {
  addFail('Admin dashboard/rendering helpers must stay extracted and lazy-loaded via app-main.js.');
}
if (!/assets\/ops-console\.js/.test(appMain) || !/PinlaneOpsConsole/.test(opsConsole)) {
  addFail('Ops communications, agent stack and simulation helpers must stay extracted and lazy-loaded via app-main.js.');
}
if (/const\s+TOTAL_LANES\s*=/.test(index) || /const\s+FORMULES\s*=/.test(index)) {
  addFail('index.html must not re-own booking constants; keep them in assets/booking-core.js.');
}
if (!/function\s+getRequiredLaneCount/.test(bookingCore) || !/function\s+getLaserCandidateWindows/.test(bookingCore) || !/function\s+getSchedule/.test(bookingCore)) {
  addFail('assets/booking-core.js must expose the core planning helpers used by client and staff flows.');
}
if (!/assets\/storage-adapter\.js/.test(index) || !/PinlaneStorage/.test(storageAdapter)) {
  addFail('Local storage helpers must stay extracted from index.html.');
}
if (!/assets\/staff-auth-session\.js/.test(index) || !/PinlaneStaffAuthSession/.test(staffAuthSession)) {
  addFail('Staff session browser helpers must stay extracted from index.html.');
}
if (!/assets\/api-client\.js/.test(index) || !/PinlaneApiClient/.test(apiClient)) {
  addFail('API client browser helpers must stay extracted from index.html.');
}
if (!/window\.PinlaneStaffAuthSession/.test(staffAuthSession) || !/function\s+normalize/.test(staffAuthSession)) {
  addFail('assets/staff-auth-session.js must expose normalized staff session helpers.');
}
if (!/window\.PinlaneStorage/.test(storageAdapter) || !/function\s+getJson/.test(storageAdapter) || !/function\s+ensureMarker/.test(storageAdapter)) {
  addFail('assets/storage-adapter.js must expose resilient JSON storage helpers.');
}
if (!/window\.PinlaneApiClient/.test(apiClient) || !/function\s+request/.test(apiClient) || !/credentials:\s*'same-origin'/.test(apiClient)) {
  addFail('assets/api-client.js must expose the credential-aware browser API client.');
}

const functionDecls = [...index.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
  .map((match) => match[1]);
const extractedBrowserSources = [appMain, bookingCore, adminConsole, opsConsole];
const extractedFunctionDecls = extractedBrowserSources.flatMap((source) => (
  [...source.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1])
));
const functionCounts = functionDecls.reduce((acc, name) => {
  acc[name] = (acc[name] || 0) + 1;
  return acc;
}, {});
const duplicates = Object.entries(functionCounts).filter(([, count]) => count > 1);
if (duplicates.length) {
  addFail(`Duplicate global functions: ${duplicates.map(([name, count]) => `${name} x${count}`).join(', ')}`);
}

const assignedNames = [
  ...index.matchAll(/(?:window\.|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g),
].map((match) => match[1]);

const knownNames = new Set([
  ...functionDecls,
  ...extractedFunctionDecls,
  ...assignedNames,
  'Array',
  'Boolean',
  'Date',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'clearInterval',
  'clearTimeout',
  'console',
  'document',
  'event',
  'navigator',
  'parseFloat',
  'parseInt',
  'setInterval',
  'setTimeout',
  'toast',
  'window',
]);

const keywordCalls = new Set(['catch', 'for', 'function', 'if', 'return', 'switch', 'while']);
const handlers = [...index.matchAll(/onclick=(['"])(.*?)\1/gs)].map((match) => match[2]);
const missingCalls = new Map();
for (const handler of handlers) {
  for (const match of handler.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    const previous = handler[match.index - 1] || '';
    if (previous === '.' || previous === '?') continue;
    if (keywordCalls.has(name)) continue;
    if (!knownNames.has(name)) {
      missingCalls.set(name, (missingCalls.get(name) || 0) + 1);
    }
  }
}
if (missingCalls.size) {
  addFail(`Missing onclick handlers: ${[...missingCalls.entries()].map(([name, count]) => `${name} x${count}`).join(', ')}`);
}

if (/onclick=""|onclick=''/g.test(index)) {
  addFail('Empty onclick attributes found.');
}

if (/onclick="\$\{[^"]*\?\s*''|onclick="\$\{[^"]*:\s*''/g.test(index)) {
  addFail('Dynamic empty onclick branch found. Use disabled state instead.');
}

if (/href=["']#["']|javascript:void/gi.test(index)) {
  addFail('Placeholder links found.');
}

if (!/setStaffTheme\('light'\)/.test(appMain)) {
  addFail('Light theme button is not wired to setStaffTheme("light").');
}

if (!/function\s+apiRequest[\s\S]{0,500}window\.location\.origin/.test(appMain)) {
  addFail('apiRequest must resolve relative API URLs against window.location.origin.');
}

if (!/body\.staff-mode\s+#logoutBtn,\s*body\.admin-mode\s+#logoutBtn\s*\{[\s\S]{0,500}display:\s*none\s*!important[\s\S]{0,500}top:\s*auto\s*!important[\s\S]{0,500}bottom:\s*auto\s*!important/.test(staffCss)) {
  addFail('Global logout button must be hidden and position-reset in staff/admin mode (assets/pinlane-staff.css).');
}

const staffMenu = read(path.join('assets', 'staff-menu.js'));
if (!/data-fgx-menu-action="logout"/.test(staffMenu) || !/typeof\s+logout\s*===\s*'function'/.test(staffMenu)) {
  addFail('Staff menu account popover must expose a working logout action.');
}

const stylesheetLinks = [...index.matchAll(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+\.css)(?:\?[^"']*)?["']\s*>/gi)]
  .map((match) => match[1]);
const expectedStylesheets = ['./assets/pinlane.css', './assets/pinlane-staff.css', './assets/pinlane-charts.css', './assets/pinlane-client.css'];
if (JSON.stringify(stylesheetLinks) !== JSON.stringify(expectedStylesheets)) {
  addFail('index.html must load exactly pinlane.css, pinlane-staff.css, pinlane-charts.css, pinlane-client.css in that order (DESIGN.md §8).');
}

if (!/body\.staff-mode\s+#logoutBtn,\s*body\.admin-mode\s+#logoutBtn[\s\S]{0,420}visibility:\s*hidden\s*!important[\s\S]{0,420}pointer-events:\s*none\s*!important/.test(staffCss)) {
  addFail('Staff layer must hard-hide the global logout button in staff/admin mode.');
}
if (!/\.fgx-menu-popover\s*\{[\s\S]{0,520}max-height:\s*min\(420px,\s*calc\(100dvh - 96px\)\)\s*!important[\s\S]{0,520}overflow:\s*auto\s*!important/.test(staffCss)) {
  addFail('Staff layer must constrain staff menu popovers to prevent oversized overlays.');
}
if (!/body\.staff-mode\s+main,\s*body\.admin-mode\s+main\s*\{[\s\S]{0,360}width:\s*calc\(100vw - var\(--fgx-sidebar-width\)\)\s*!important[\s\S]{0,360}margin-left:\s*var\(--fgx-sidebar-width\)\s*!important/.test(staffCss)) {
  addFail('Staff layer must keep staff/admin main content inside the viewport beside the sidebar.');
}

const obsoleteStylesheets = [
  'app-shell.css',
  'staff-dashboard.css',
  'staff-clients.css',
  'staff-reservations.css',
  'staff-pricing.css',
  'staff-emails.css',
  'staff-campaigns.css',
  'pro-sober-theme.css',
  'staff-menu.css',
  'production-hardening.css',
  'premium-finish.css',
  'promptly-product-theme.css',
  'app-final-guard.css',
  'pinlane-kiss-refactor.css',
  'pinlane-v2.css',
  'pinlane-design-system.css',
];
for (const sheet of obsoleteStylesheets) {
  if (fs.existsSync(path.join(root, 'assets', sheet))) {
    addFail(`Obsolete legacy stylesheet must be deleted: assets/${sheet}`);
  }
}
for (const page of ['index.html', 'public-form.html', 'pro.html', 'direction.html']) {
  const html = read(page);
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) {
    addFail(`${page} must not load remote Google Fonts; Geist is self-hosted (DESIGN.md §4).`);
  }
}
/* Le branding tenant (logos SVG inline dans le HTML) garde ses couleurs ; seule l'UI est tokenisée. */
for (const file of productionFiles()) {
  if (!/\.css$/i.test(file)) continue;
  if (/#b8ad9b|#b356ad|#5ec8c8/i.test(read(file))) {
    addFail(`Legacy palette value (platinum/magenta/teal) found in ${file}; use DESIGN.md v2 tokens.`);
  }
}

const vercelIgnore = read('.vercelignore');
for (const required of ['.env', '.env.*', 'audit-*.png', 'artifacts']) {
  if (!vercelIgnore.split(/\r?\n/).includes(required)) {
    addFail(`.vercelignore missing ${required}`);
  }
}

const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts?.['db:migrate'] !== 'node scripts/run-db-migrations.js') {
  addFail('package.json must expose db:migrate for database migrations.');
}
if (packageJson.scripts?.['db:migrate:plan'] !== 'node scripts/run-db-migrations.js --plan') {
  addFail('package.json must expose db:migrate:plan for safe migration review.');
}
if (packageJson.scripts?.['test:e2e'] !== 'node scripts/run-webapp-smoke-tests.js') {
  addFail('package.json must expose test:e2e for browser smoke tests.');
}
if (packageJson.scripts?.['test:browser-modules'] !== 'node scripts/run-browser-module-tests.js') {
  addFail('package.json must expose test:browser-modules for extracted browser modules.');
}
if (!packageJson.devDependencies?.['playwright-core']) {
  addFail('package.json must include playwright-core for browser smoke tests.');
}

const migrationRunner = read(path.join('scripts', 'run-db-migrations.js'));
for (const migrationId of ['0001_core_reservations', '0002_ops_engine', '0003_staff_access_control']) {
  if (!migrationRunner.includes(migrationId)) {
    addFail(`Migration runner missing ${migrationId}`);
  }
}
if (!/schema_migrations/.test(migrationRunner) || !/checksum/.test(migrationRunner) || !/getMigrationPlan/.test(migrationRunner)) {
  addFail('Migration runner must track applied migrations with checksums.');
}

const webappSmoke = read(path.join('scripts', 'run-webapp-smoke-tests.js'));
if (!/playwright-core/.test(webappSmoke) || !/PINLANE_E2E_STAFF_CODE/.test(webappSmoke) || !/authOverlay/.test(webappSmoke)) {
  addFail('Browser smoke test must cover public page and staff login gate.');
}

const gitIgnore = read('.gitignore');
const gitIgnoreLines = new Set(gitIgnore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
for (const required of [
  '.env',
  '.env.*',
  '!.env.example',
  'node_modules/',
  '.npm-cache/',
  '.playwright-cli/',
  '.vercel/',
  '.vercel-cli/',
  'artifacts/',
  'output/',
  'audit-*.png',
  '*.log',
]) {
  if (!gitIgnoreLines.has(required)) {
    addFail(`.gitignore missing ${required}`);
  }
}

const staffAuthSource = read(path.join('lib', 'staff-auth.js'));
if (!/function\s+allowDevelopmentFallbacks\(\)\s*\{\s*if\s*\(\s*isProductionRuntime\(\)\s*\)\s*return\s+false;/.test(staffAuthSource)) {
  addFail('Staff auth fallbacks must be impossible in production runtime.');
}
if (!/WEAK_PRODUCTION_SECRET_VALUES/.test(staffAuthSource) || !/assertStrongProductionSecret/.test(staffAuthSource)) {
  addFail('Staff auth must reject weak production staff codes and auth secrets.');
}
if (!/STAFF_SESSION_COOKIE\s*=\s*'pinlane_staff_session'/.test(staffAuthSource) || !/readCookieValue\(req,\s*STAFF_SESSION_COOKIE\)/.test(staffAuthSource)) {
  addFail('Staff auth must accept HttpOnly cookie-backed staff sessions.');
}
if (!/update staff_roles[\s\S]{0,260}where center_id = \$1 and id = \$2/.test(staffAuthSource)) {
  addFail('Staff auth bootstrap must rotate the locked direction role access code.');
}
if (!/on conflict \(id\) do update set[\s\S]{0,180}access_code_hash = excluded\.access_code_hash[\s\S]{0,180}access_code_hint = excluded\.access_code_hint/.test(staffAuthSource)) {
  addFail('Staff auth bootstrap must rotate the direction member access code.');
}

const http = read(path.join('lib', 'http.js'));
if (/Access-Control-Allow-Origin['"],\s*['"]\*/.test(http)) {
  addFail('CORS wildcard found in lib/http.js.');
}
if (!/Access-Control-Allow-Credentials['"],\s*['"]true/.test(http)) {
  addFail('CORS must allow credentials for cookie-backed staff sessions.');
}
if (!/mngfunglxy\.com/.test(http)) {
  addFail('lib/http.js must default to the production domain allowlist.');
}

const staffAuthApi = read(path.join('api', 'staff-auth.js'));
if (!/Set-Cookie/.test(staffAuthApi) || !/HttpOnly/.test(staffAuthApi) || !/SameSite=Lax/.test(staffAuthApi)) {
  addFail('Staff auth API must set and clear an HttpOnly SameSite cookie.');
}
if (/token:\s*session\.token/.test(staffAuthApi)) {
  addFail('Staff auth API must not expose the raw staff session token in JSON.');
}

const secretPattern = new RegExp('re_[A-Za-z0-9_]{20,}|Admin' + 'Fun');
const mojibakePattern = /[\u00C2\u00C3\uFFFD]|\u00E2[\u0080-\u00BF\u20AC]|ï¿½/;
const hiddenOpsNoise = /roadmap_only|Prototype actif|A brancher|SMS a brancher|reconnecting/i;
const mojibakeStrictPattern = /[\u00C2\u00C3\uFFFD]|\u00E2[\u0080-\u00BF\u20AC]|ï¿½|Ã¯Â¿Â½/;
for (const file of productionFiles()) {
  const content = read(file);
  if (secretPattern.test(content)) addFail(`Secret-like value leaked in ${file}`);
  if (mojibakePattern.test(content) || mojibakeStrictPattern.test(content)) addFail(`Mojibake text found in ${file}`);
  if (hiddenOpsNoise.test(content)) addFail(`Hidden operational placeholder leaked in ${file}`);
}

const transitionAllCount = (index.match(/transition:\s*all\b/g) || []).length;
if (transitionAllCount) {
  addWarn(`Legacy CSS still has ${transitionAllCount} transition: all declaration(s). New hardening CSS overrides the critical surfaces.`);
}
if (/will-change:\s*all\b/.test(index)) {
  addFail('will-change: all found.');
}
if (/background-clip:\s*text/i.test(index)) {
  addFail('Gradient text pattern found.');
}

if (warn.length) {
  console.log('Warnings:');
  warn.forEach((message) => console.log(`- ${message}`));
}

if (fail.length) {
  console.error('Quality audit failed:');
  fail.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('Quality audit passed.');
