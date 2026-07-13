// Test INTERACTIF de la page Emails & relances v2 (séquences automatiques).
// Playwright pilote de vrais clics : 5 cartes séquences (dont Anniversaire J-30
// et Réactivation ⭐), toggle → POST automationSettings, aperçu dépliable,
// stats 30 j, file opérationnelle conservée en bas. Contrats : spec
// marketing-suite-v2. Cf. leçon ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_EMAILS_PORT || 4217);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // État serveur simulé des séquences — le toggle mute ce state (contrat POST).
    const autoState = {
      confirmation: { enabled: true }, reminder_48h: { enabled: true }, post_visit: { enabled: true },
      birthday_j30: { enabled: true }, reactivation: { enabled: false },
    };
    const autoStats = {
      confirmation: { sent30d: 42, failed30d: 1 }, reminder_48h: { sent30d: 31, failed30d: 0 },
      post_visit: { sent30d: 28, failed30d: 2 }, birthday_j30: { sent30d: 4, failed30d: 0 }, reactivation: { sent30d: 0, failed30d: 0 },
    };
    const comms = [
      { id: 1, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'confirmation', recipient: 'a@x.be', subject: 'Votre réservation est confirmée', status: 'delivered', sentAt: new Date(Date.now() - 3600e3).toISOString(), payload: { textBody: 'Bonjour, votre réservation est confirmée.' } },
      { id: 2, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'reminder_48h', recipient: 'b@x.be', subject: 'Rappel de votre venue', status: 'queued', scheduledAt: new Date(Date.now() + 3600e3).toISOString(), payload: {} },
      { id: 3, centerId: 'libramont', channel: 'email', direction: 'outbound', templateId: 'birthday_j30', recipient: 'c@x.be', subject: 'L’anniversaire approche 🎂', status: 'failed', lastError: 'Mailbox full', attempts: 2, payload: {} },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && m === 'POST') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_POSTS__.push(b);
        if (b.action === 'automationSettings') {
          if (autoState[b.key]) autoState[b.key].enabled = !!b.enabled;
          return J({ ok: true, settings: JSON.parse(JSON.stringify(autoState)) });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'automationSettings') {
        return J({ ok: true, settings: JSON.parse(JSON.stringify(autoState)), stats: autoStats });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/simulation') return J({ ok: true, status: 'idle', simulation: null });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const missed = new Set();
  page.on('response', (r) => { if (r.status() === 404) { const u = new URL(r.url()); missed.add(u.pathname + u.search); } });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=em-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'emails'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(900);
    await page.waitForFunction(() => typeof opsAdminCache !== 'undefined' && (opsAdminCache.communications || []).length > 0, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);

    console.log('\n[LOAD] page Emails v2');
    const load = await page.evaluate(() => ({
      cards: document.querySelectorAll('#staffEmailsPage .mk-auto').length,
      labels: [...document.querySelectorAll('#staffEmailsPage .mk-auto-head strong')].map((el) => el.textContent),
      switches: document.querySelectorAll('#staffEmailsPage .mk-switch').length,
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
      statsTxt: (document.querySelector('#staffEmailsPage .mk-auto .mk-auto-stats') || {}).textContent || '',
      preview: !!document.querySelector('#staffEmailsPage .mk-auto-preview summary'),
      pipeline: document.querySelectorAll('#staffEmailsPage .pv2-pipe').length,
      tableRows: document.querySelectorAll('#staffEmailsPage .pv2-table tbody tr').length,
    }));
    if (missed.size) console.log('URLs 404 :', [...missed].slice(0, 5).join(' · '));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.cards === 5, `5 cartes séquences (obtenu ${load.cards})`);
    ok(load.labels.some((l) => /Anniversaire J-30/.test(l)) && load.labels.some((l) => /Réactivation/.test(l)), 'Anniversaire J-30 + Réactivation présentes');
    ok(load.onCount === 4, `4 séquences ON au départ (obtenu ${load.onCount})`);
    ok(/42 envoyés/.test(load.statsTxt), `stats 30 j affichées (${load.statsTxt.trim().slice(0, 40)})`);
    ok(load.preview, 'aperçu du message dépliable');
    ok(load.pipeline === 5 && load.tableRows === 3, `file opérationnelle conservée en bas (${load.pipeline} tuiles, ${load.tableRows} lignes)`);

    console.log('\n[TOGGLE] activer Réactivation → POST + switch ON');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Réactivation/.test(c.textContent));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOn = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings'),
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOn.posts.length === 1 && afterOn.posts[0].key === 'reactivation' && afterOn.posts[0].enabled === true, 'POST automationSettings {reactivation, true}');
    ok(afterOn.onCount === 5, 'switch Réactivation passé ON');

    console.log('\n[TOGGLE] couper Anniversaire J-30 → POST enabled:false');
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#staffEmailsPage .mk-auto')].find((c) => /Anniversaire J-30/.test(c.textContent));
      card.querySelector('.mk-switch').click();
    });
    await page.waitForTimeout(400);
    const afterOff = await page.evaluate(() => ({
      last: window.__QA_POSTS__.filter((p) => p.action === 'automationSettings').slice(-1)[0],
      onCount: document.querySelectorAll('#staffEmailsPage .mk-switch.is-on').length,
    }));
    ok(afterOff.last && afterOff.last.key === 'birthday_j30' && afterOff.last.enabled === false, 'POST {birthday_j30, false}');
    ok(afterOff.onCount === 4, 'switch repassé OFF');

    // capture optionnelle
    if (process.env.EMAILS_SHOT) {
      await page.screenshot({ path: `${process.env.EMAILS_SHOT}/emails-v2-dark.png`, fullPage: false });
    }

    if (process.env.EM_SHOT) { await page.screenshot({ path: process.env.EM_SHOT + '/emails-v2-dark.png', fullPage: false }); }
    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\nemails-page-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nemails-page-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nemails-page-check: ALL OK');
}
main();
