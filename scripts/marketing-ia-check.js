// Test INTERACTIF de la page Marketing (conseiller data, insight-only).
// Playwright pilote de vrais clics : idées proposées avec contenu prêt,
// « C'est fait » → POST insightStatus applied, « Ignorer » → ignored,
// période 7/30/90 j → dailyMetrics, « Ce qu'on a appris » avec mesure.
// Cf. leçon ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_MK_PORT || 4213);
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
    const dstr = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
    const insights = [
      { id: 11, kind: 'idea', title: 'Post « plan fraîcheur » pour jeudi', body: 'Jeudi 25 °C annoncés. Sur tes 14 jours de données, les jours chauds sont encore peu nombreux — idée exploratoire.', channel: 'facebook', ready_content: '33° dehors, 21° chez nous. Bowling + laser au frais, portes ouvertes jusqu’à 22h.', data_basis: [{ id: 'forecast', label: 'Prévision jeudi : 25 °C', sampleSize: 14 }], status: 'proposed', proposed_at: new Date().toISOString(), applied_at: null, measured_at: null, result: null },
      { id: 12, kind: 'idea', title: 'Post « Foire de Libramont »', body: 'La Foire (100e édition) draine des familles à 5 minutes du centre du 24 au 27 juillet.', channel: 'facebook', ready_content: 'Trop de monde à la Foire ? Pause fraîcheur à 5 min, on est climatisés.', data_basis: [{ id: 'event', label: 'Foire de Libramont 24-27/07', sampleSize: null }], status: 'proposed', proposed_at: new Date().toISOString(), applied_at: null, measured_at: null, result: null },
      { id: 9, kind: 'idea', title: 'Offre mardi creux', body: 'Mardi hors vacances = jour le plus faible.', channel: 'offre', ready_content: '', data_basis: [], status: 'applied', proposed_at: new Date(Date.now() - 6 * 864e5).toISOString(), applied_at: new Date(Date.now() - 4 * 864e5).toISOString(), measured_at: null, result: null },
      { id: 5, kind: 'idea', title: 'Story pluie du samedi', body: '', channel: 'instagram', ready_content: '', data_basis: [], status: 'validated', proposed_at: new Date(Date.now() - 30 * 864e5).toISOString(), applied_at: new Date(Date.now() - 25 * 864e5).toISOString(), measured_at: new Date(Date.now() - 10 * 864e5).toISOString(), result: { verdict: 'validated', deltaPct: 22, sampleDays: 8, before: 31, after: 38 } },
    ];
    const mkRows = Array.from({ length: 14 }, (_, i) => ({ date: dstr(-13 + i), visitors: 30 + i, reservations_count: 6, cancellations_count: 0, revenue_total: 500 + i * 10, avg_basket: 80, weather_tmax: 20, weather_precip_mm: 2, is_school_holiday: false, is_public_holiday: false }));
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
        if (b.action === 'insightStatus') return J({ ok: true, action: 'insightStatus', insight: { id: b.id, status: b.status } });
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingInsights') return J({ ok: true, centerId: 'libramont', insights });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'dailyMetrics') {
        const from = u.searchParams.get('from');
        const rows = mkRows.filter((row) => !from || row.date >= from);
        window.__QA_METRICS_CALLS__ = (window.__QA_METRICS_CALLS__ || []).concat([{ from, to: u.searchParams.get('to') }]);
        return J({ ok: true, centerId: 'libramont', from, to: u.searchParams.get('to'), rows, totals: { visitors: rows.reduce((s, r) => s + r.visitors, 0), revenue: rows.reduce((s, r) => s + r.revenue_total, 0), days: rows.length }, bestDay: rows[rows.length - 1] || null, worstDay: rows[0] || null });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: [] });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'listCampaigns') return J({ ok: true, campaigns: [], segments: [{ id: 'all', label: 'Tous les clients' }], channel: {} });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=mk-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(800);

    console.log('\n[LOAD] page Marketing rendue');
    const load = await page.evaluate(() => ({
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-idea').length,
      firstTitle: (document.querySelector('#staffCampaignsPage .mk-idea strong') || {}).textContent || '',
      hasContent: !!document.querySelector('#staffCampaignsPage .mk-idea-content'),
      hasCopy: !!document.querySelector('#staffCampaignsPage .mk-idea button[onclick^="mkIaCopy"]'),
      learned: document.querySelectorAll('#staffCampaignsPage .mk-learned').length,
      learnedTxt: (document.querySelector('#staffCampaignsPage .mk-learned small') || {}).textContent || '',
      waiting: (document.querySelector('#staffCampaignsPage .mk-waiting') || {}).textContent || '',
      stats: document.querySelectorAll('#staffCampaignsPage .mk-stats .pv2-stat').length,
      menuLabel: [...document.querySelectorAll('.staff-menu button, .staff-menu a')].map((el) => el.textContent.trim()).filter((t) => /marketing/i.test(t)).length,
      gadgetGone: !document.querySelector('.pv2-xpbar') && !document.querySelector('.pv2-camp-hero'),
    }));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.ideas === 2, `2 idées proposées affichées (obtenu ${load.ideas})`);
    ok(load.hasContent && load.hasCopy, 'contenu prêt à copier + bouton Copier');
    ok(load.learned === 1 && /\+22\s?%/.test(load.learnedTxt), `« Ce qu'on a appris » avec mesure +22 % (obtenu « ${load.learnedTxt.slice(0, 60)} »)`);
    ok(/mardi creux/i.test(load.waiting), 'idée appliquée listée « en cours de mesure »');
    ok(load.stats === 4, `4 chiffres de période (obtenu ${load.stats})`);
    ok(load.gadgetGone, 'studio gamifié (XP/hero) absent du DOM');

    console.log('\n[FAIT] « C\'est fait » → POST applied');
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage .mk-idea button')].find((x) => /fait/i.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const afterApplied = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'insightStatus'),
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-idea').length,
      waiting: (document.querySelector('#staffCampaignsPage .mk-waiting') || {}).textContent || '',
    }));
    ok(afterApplied.posts.length === 1 && afterApplied.posts[0].status === 'applied', 'POST insightStatus applied envoyé');
    ok(afterApplied.ideas === 1, 'la carte quitte « À faire » après « fait »');
    ok(/fraîcheur|Foire|mardi/i.test(afterApplied.waiting), 'et rejoint « en cours de mesure »');

    console.log('\n[IGNORER] → POST ignored');
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage .mk-idea button')].find((x) => /ignorer/i.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const afterIgnored = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'insightStatus'),
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-idea').length,
    }));
    ok(afterIgnored.posts.length === 2 && afterIgnored.posts[1].status === 'ignored', 'POST insightStatus ignored envoyé');
    ok(afterIgnored.ideas === 0, 'plus d\'idée en attente → état vide propre au prochain rendu');

    console.log('\n[PÉRIODE] 7 jours → nouvelle requête dailyMetrics');
    const callsBefore = await page.evaluate(() => (window.__QA_METRICS_CALLS__ || []).length);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage button')].find((x) => /7 jours/.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const period = await page.evaluate(() => {
      const calls = window.__QA_METRICS_CALLS__ || [];
      return { count: calls.length, last: calls[calls.length - 1] };
    });
    ok(period.count === callsBefore + 1, 'clic période → refetch');
    const spanDays = period.last ? Math.round((new Date(period.last.to) - new Date(period.last.from)) / 864e5) + 1 : 0;
    ok(spanDays === 7, `période demandée = 7 jours (obtenu ${spanDays})`);

    // capture visuelle optionnelle
    if (process.env.MK_SHOT) {
      await page.evaluate(() => { loadMarketingIa(true); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${process.env.MK_SHOT}/marketing-ia-dark.png`, fullPage: false });
    }

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\nmarketing-ia-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nmarketing-ia-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nmarketing-ia-check: ALL OK');
}
main();
