const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_QA_PORT || 4179);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = path.join(ROOT, 'artifacts', 'qa');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');

    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function installQaApi(page) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await page.addInitScript(({ expiresAt }) => {
    const qaSession = {
      token: 'visual-qa-token',
      cookieBacked: false,
      centerId: 'libramont',
      expiresAt,
      member: { id: 'qa-owner', name: 'QA Pinlane', roleId: 'direction' },
      role: { id: 'direction', name: 'Direction', locked: true },
      permissions: [
        'dashboard.view',
        'planning.view',
        'planning.bowling',
        'planning.laser',
        'reservations.view',
        'reservations.status',
        'clients.view',
        'pricing.manage',
        'emails.view',
        'campaigns.manage',
        'marketing.agents',
        'settings.manage',
        'direction.view',
        'users.manage',
      ],
    };

    const buildReservations = (date) => ([
      {
        id: 9001,
        name: 'Anniversaire Lina Formule texte tres long #9001',
        phone: '+32470860011',
        email: 'lina@example.test',
        date,
        startTime: '14:00',
        duration: 0.5,
        lanes: [1],
        status: 'confirmed',
        pax: 6,
        price: 20,
        type: 'bowling',
        label: 'Bowling classique',
      },
      {
        id: 9002,
        name: 'Famille Lambert Bowling trente minutes #9002',
        phone: '+32470860012',
        email: 'lambert@example.test',
        date,
        startTime: '14:30',
        duration: 1,
        lanes: [2],
        status: 'arrived',
        pax: 4,
        price: 39,
        type: 'bowling',
        label: 'Bowling classique',
      },
      {
        id: 9003,
        name: 'Entreprise Ardenne Formule Premium #9003',
        phone: '+32470860013',
        email: 'ardenne@example.test',
        date,
        startTime: '15:00',
        duration: 1.5,
        lanes: [3, 5],
        status: 'paid',
        pax: 11,
        price: 308,
        type: 'formule',
        formuleId: 'formule3',
        label: 'FORMULE 3',
        plan: [
          { resourceType: 'bowling_lane', label: 'Bowling', start: '15:00', end: '16:30', lanes: [3, 5], players: 11 },
          { resourceType: 'laser_arena', label: 'Laser Game', start: '17:00', end: '17:25', players: 11, countIndex: 1 },
        ],
      },
      {
        id: 9004,
        name: 'Ecole Saint-Hubert Bowling deux heures largeur #9004',
        phone: '+32470860014',
        email: 'ecole@example.test',
        date,
        startTime: '17:00',
        duration: 2,
        lanes: [4, 6, 8],
        status: 'confirmed',
        pax: 17,
        price: 234,
        type: 'bowling',
        label: 'Bowling 2h',
      },
      {
        id: 9005,
        name: 'Team Atelier Laser #9005',
        phone: '+32470860015',
        email: 'laser@example.test',
        date,
        startTime: '16:30',
        duration: 1,
        lanes: [],
        status: 'confirmed',
        pax: 18,
        price: 180,
        type: 'laser',
        label: 'Laser x2',
        plan: [
          { resourceType: 'laser_arena', label: 'Laser Game', start: '16:30', end: '16:55', players: 18, countIndex: 1 },
          { resourceType: 'laser_arena', label: 'Laser Game', start: '18:00', end: '18:25', players: 18, countIndex: 2 },
        ],
      },
    ]);

    const buildLaneStatuses = () => Array.from({ length: 8 }).reduce((acc, _, index) => {
      acc[index + 1] = 'active';
      return acc;
    }, {});

    const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        etag: `visual-qa-${Date.now()}`,
      },
    });

    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.__PINLANE_QA_ADMIN_RANGE_CALLS__ = [];
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(rawUrl, window.location.origin);

      if (url.pathname === '/api/staff-auth') {
        return jsonResponse({
          ok: true,
          authenticated: true,
          session: qaSession,
          accessControl: {
            roles: [],
            members: [],
            permissions: qaSession.permissions,
          },
        });
      }

      if (url.pathname === '/api/staff-state') {
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        return jsonResponse({
          ok: true,
          revision: `visual-qa-${date}`,
          reservations: buildReservations(date),
          laneStatuses: buildLaneStatuses(),
          centerId: 'libramont',
        });
      }

      if (url.pathname === '/api/public-availability') {
        return jsonResponse({ ok: true, slots: [] });
      }

      if (url.pathname === '/api/admin-range') {
        window.__PINLANE_QA_ADMIN_RANGE_CALLS__.push(url.href);
        return jsonResponse({
          ok: true,
          reservations: [],
          emails: [],
          agentEvents: [],
          centerId: url.searchParams.get('centerId') || 'libramont',
        });
      }

      return nativeFetch(input, init);
    };

    window.__PINLANE_QA_RESERVATIONS__ = buildReservations;
    window.__PINLANE_QA_LANES__ = buildLaneStatuses;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

async function waitForApp(page) {
  await page.goto(`${BASE_URL}/?v=visual-qa-${Date.now()}`, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
}

async function seedStressDay(page) {
  await page.evaluate(() => {
    const d = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const reservations = typeof window.__PINLANE_QA_RESERVATIONS__ === 'function'
      ? window.__PINLANE_QA_RESERVATIONS__(d)
      : [];

    state.currentDate = d;
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'bowling';
    state.staffTheme = 'dark';
    state.reservations = reservations;
    state.laneStatuses = typeof window.__PINLANE_QA_LANES__ === 'function'
      ? window.__PINLANE_QA_LANES__()
      : {};

    save();
    setView('staff');
    renderStaff();
  });
}

async function collectIssues(page, scopeLabel) {
  return page.evaluate((label) => {
    const viewportWidth = document.documentElement.clientWidth;
    const bodyOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
    const issues = [];

    if (bodyOverflowX > 2) {
      issues.push({ label, type: 'body-horizontal-overflow', value: bodyOverflowX });
    }

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const watched = [
      '.booking',
      '.staff-resource-tab',
      '.lane-header',
      '.clients-table-row',
      '.client-profile-panel',
      '.auth-card',
      '.reservations-calendar',
      '.reservations-day',
      '.events-workspace',
      '.event-row',
      '.events-now-card',
      '.events-day-digest',
      '.dash-kpi',
      '.dash-card',
      '.dash-status-strip',
    ].join(',');

    document.querySelectorAll(watched).forEach((el) => {
      if (!visible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.left < -1 || rect.right > viewportWidth + 1) {
        issues.push({
          label,
          type: 'element-horizontal-overflow',
          selector: String(el.className),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth,
        });
      }
      if (el.scrollHeight > el.clientHeight + 4 && !el.classList.contains('clients-table-row')) {
        issues.push({
          label,
          type: 'element-vertical-clipped',
          selector: String(el.className),
          text: el.textContent.trim().slice(0, 100),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        });
      }
    });

    document.querySelectorAll('.booking-name, .booking-meta, .b-tag, .client-cell strong, .client-cell small').forEach((el) => {
      if (!visible(el)) return;
      if (el.scrollHeight > el.clientHeight + 3) {
        issues.push({
          label,
          type: 'text-vertical-clipped',
          selector: String(el.className),
          text: el.textContent.trim().slice(0, 90),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        });
      }
    });

    return issues;
  }, scopeLabel);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function renderStaffPage(page, pageName) {
  await page.evaluate((target) => {
    state.staffMenuPage = target;
    save();
    renderStaff();
    if (typeof syncOpsSidebar === 'function') syncOpsSidebar();
  }, pageName);
  await page.waitForTimeout(700);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  const issues = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await installQaApi(page);
    await waitForApp(page);
    await seedStressDay(page);
    await page.locator('#staffView:not(.hidden)').waitFor({ timeout: 10000 });

    const lockedOverlayCount = await page.locator('#authOverlay:not(.hidden)').count();
    assert(!lockedOverlayCount, 'QA locale bloquee sur l ecran de connexion staff.');

    await page.waitForTimeout(700);

    await renderStaffPage(page, 'dashboard');
    await screenshot(page, 'staff-dashboard-reference');
    issues.push(...await collectIssues(page, 'staff-dashboard'));

    await renderStaffPage(page, 'planning');
    await page.waitForTimeout(700);
    await screenshot(page, 'staff-planning-stress');
    issues.push(...await collectIssues(page, 'staff-planning'));

    await renderStaffPage(page, 'clients');
    await screenshot(page, 'staff-clients-stress');
    issues.push(...await collectIssues(page, 'staff-clients'));

    await renderStaffPage(page, 'reservations');
    await screenshot(page, 'staff-reservations-stress');
    issues.push(...await collectIssues(page, 'staff-reservations'));

    const adminRangeBeforeEvents = await page.evaluate(() => (
      Array.isArray(window.__PINLANE_QA_ADMIN_RANGE_CALLS__)
        ? window.__PINLANE_QA_ADMIN_RANGE_CALLS__.length
        : 0
    ));
    await renderStaffPage(page, 'events');
    await screenshot(page, 'staff-events-stress');
    issues.push(...await collectIssues(page, 'staff-events'));
    const adminRangeAfterEvents = await page.evaluate(() => (
      Array.isArray(window.__PINLANE_QA_ADMIN_RANGE_CALLS__)
        ? window.__PINLANE_QA_ADMIN_RANGE_CALLS__.length
        : 0
    ));
    assert(
      adminRangeAfterEvents === adminRangeBeforeEvents,
      'La page Evenements ne doit pas declencher /api/admin-range.'
    );

    const blockingConsoleErrors = consoleErrors.filter((entry) => (
      !/favicon|net::ERR_ABORTED|Failed to load resource|Not found/i.test(entry)
    ));

    assert(!pageErrors.length, `Erreur JS navigateur: ${pageErrors.join(' | ')}`);
    assert(!blockingConsoleErrors.length, `Erreur console: ${blockingConsoleErrors.join(' | ')}`);
    assert(!issues.length, `QA visuelle: ${JSON.stringify(issues, null, 2)}`);

    console.log(JSON.stringify({ ok: true, screenshots: OUT_DIR }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
