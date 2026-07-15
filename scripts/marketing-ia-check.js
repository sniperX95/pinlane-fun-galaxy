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
      if (u.pathname === '/api/marketing-agents') {
        if (m === 'POST') { const b = JSON.parse(init.body || '{}'); (window.__QA_MA_POSTS__ = window.__QA_MA_POSTS__ || []).push(b); }
        return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      }
      if (u.pathname === '/api/ops' && m === 'POST') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_POSTS__.push(b);
        if (b.action === 'insightStatus') return J({ ok: true, action: 'insightStatus', insight: { id: b.id, status: b.status } });
        if (b.action === 'insightRedo') return J({ ok: true, insight: { id: 99, status: 'proposed' } });
        if (b.action === 'planActionDone') return J({ ok: true, result: { ok: true, id: 88, status: 'applied' } });
        if (b.action === 'competitorSweep') return J({ ok: true, checked: 1, results: [{ id: 1, status: 'unchanged' }] });
        if (b.action === 'competitorSave') return J({ ok: true, result: { ok: true, id: 2 } });
        if (b.action === 'studioGenerate') {
          return J({ ok: true, pack: { platform: b.platform, date: dstr(0), theme: 'Angle test', generationMode: 'ai', brief: b.brief || '',
            long: 'Pack ' + b.platform + ' fraichement genere pour le test.', short: 'Court ' + b.platform + '.',
            story: 'Story test.', photoIdea: 'Photo test.', aiImagePrompt: 'Test prompt, no text, no logos',
            hashtags: ['#test'], bestTime: '18h', quality: { score: 86, longScore: 86, shortScore: 88, status: 'ready', iterations: [] } } });
        }
        if (b.action === 'competitorDelete') return J({ ok: true, result: { ok: true, id: 1 } });
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingInsights') return J({ ok: true, centerId: 'libramont', insights });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrain') {
        const t0 = new Date();
        const mkDays = Array.from({ length: 14 }, (_, i) => {
          const d = new Date(t0.getTime() + i * 864e5);
          const date = d.toISOString().slice(0, 10);
          const level = i === 4 ? 'creux' : i === 6 ? 'fort' : 'normal';
          return { date, label: 'jour ' + date.slice(8, 10) + '/' + date.slice(5, 7), dow: d.getUTCDay(),
            expected: level === 'creux' ? 12 : level === 'fort' ? 85 : 40, level,
            baselineSource: 'tes jours comparables', baselineSample: 12,
            tmax: i === 2 ? 27 : 20, precipMm: i === 3 ? 14 : 0, holidayLabel: '',
            booked: i === 6 ? { reservations: 4, pax: 120, revenue: 900 } : null,
            drivers: level === 'creux' ? ['jour structurellement faible'] : [] };
        });
        return J({ ok: true, centerId: 'libramont', today: t0.toISOString().slice(0, 10), dataDays: 140, medianVisitors: 40,
          outlook: mkDays,
          explainPast: [{ date: mkDays[0].date, label: 'samedi 12/07', actual: 30, expected: 80, deltaPct: -62, causes: ['28 °C ce jour-là'], summary: 'samedi 12/07 : 30 visiteurs (-62 % vs 80 attendus sur tes samedis comparables) — 28 °C ce jour-là.' }],
          plan: [
            { id: 'social:D4', type: 'social_push', channel: 'instagram', executeOn: mkDays[1].date, targetDate: mkDays[4].date, title: 'Post pour remplir ' + mkDays[4].label, why: '12 visiteurs attendus (ta médiane : 40). Poster 2-3 jours avant.', readyContent: 'Texte prêt à poster pour le creux.' },
            { id: 'harvest:D6', type: 'harvest', channel: 'terrain', executeOn: mkDays[6].date, targetDate: mkDays[6].date, title: 'Récolter le jour fort', why: '120 pers. déjà réservées — matière marketing gratuite.', readyContent: 'Checklist du jour fort.' },
          ],
          instagram: { date: t0.toISOString().slice(0, 10), themeId: 'heat', reason: '27 °C annoncés — le plan fraîcheur se poste avant le jour J.', caption: '27° annoncés vendredi — chez nous il fait frais toute la journée. Bowling, laser game, arcades.', visualBrief: 'À filmer : arrivée du groupe, bowling en action, sourire final.', bestTime: '17h-19h', bestTimeNote: 'Heuristique d\'audience — à ajuster avec tes stats Instagram.', hashtags: ['#bowling', '#lasergame', '#funGalaxy', '#ardenne', '#libramont'] },
        });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'studioPacks') {
        const mkPack = (platform) => ({ platform, date: dstr(0), theme: 'Pluie prévue (14 mm)', generationMode: 'ai', brief: '',
          long: 'Il pleut samedi ? Nos 8 pistes sont au sec — réserve la tienne.', short: 'Pluie samedi ? Bowling au sec.',
          story: 'Pluie samedi ? → Réserve ta piste.', photoIdea: 'Filmer un strike au moment fort.',
          aiImagePrompt: 'Rainy day bowling center, cozy neon, no text, no logos',
          hashtags: ['#bowling', '#libramont', '#pluie'], bestTime: '17h-19h',
          quality: { score: 88, longScore: 88, shortScore: 90, status: 'ready', iterations: [{ mode: 'rules', score: 74 }, { mode: 'ai_1', score: 88 }] } });
        return J({ ok: true, centerId: 'libramont', packs: { facebook: mkPack('facebook'), instagram: null, tiktok: null, linkedin: null } });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'competitors') {
        return J({ ok: true, centerId: 'libramont', competitors: [{ id: 1, name: 'Bowling Star', websiteUrl: 'https://bowlingstar.be', instagramHandle: 'bowlingstar', notes: '', enabled: true, lastCheckedAt: '2026-07-14T02:00:00Z', lastDiff: 'Nouvelle formule anniversaire à 15 €.' }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingRoi') {
        (window.__QA_ROI_CALLS__ = window.__QA_ROI_CALLS__ || []).push(u.searchParams.get('days'));
        return J({ ok: true, centerId: 'libramont', days: Number(u.searchParams.get('days')) || 30, sent: 17, conversions: 5, revenue: 1000, reviewClicks: 4, bySource: [
          { key: 'relance', label: 'Relances 1-clic', sent: 5, conversions: 2, revenue: 380 },
          { key: 'birthday_j30', label: 'Anniversaires J-30', sent: 12, conversions: 3, revenue: 620 },
          { key: 'reactivation', label: 'Réactivation dormants', sent: 0, conversions: 0, revenue: 0 },
          { key: 'custom', label: 'Séquences personnalisées', sent: 0, conversions: 0, revenue: 0 },
          { key: 'campaign', label: 'Campagnes', sent: 0, conversions: 0, revenue: 0 },
          { key: 'direct', label: 'Messages directs', sent: 0, conversions: 0, revenue: 0 },
        ] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingWeek') {
        const from = u.searchParams.get('from') || dstr(0);
        const to = u.searchParams.get('to') || dstr(6);
        (window.__QA_WEEK_CALLS__ = window.__QA_WEEK_CALLS__ || []).push({ from, to });
        const span = Math.min(31, Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 864e5) + 1);
        const days = Array.from({ length: span }, (_, i) => {
          const d = new Date(from + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
          const date = d.toISOString().slice(0, 10);
          return { date, tmax: i === 2 ? 26 : 19, precipMm: i === 3 ? 14 : 0, weatherCode: 3,
            holidayLabel: i === 4 ? 'Foire de Libramont' : '', isSchoolHoliday: false,
            events: i === 4 ? ['Foire de Libramont'] : [], ideas: i === 0 ? [{ id: 11, title: 'Post fraîcheur', channel: 'facebook', status: 'proposed' }] : [] };
        });
        return J({ ok: true, centerId: 'libramont', days });
      }
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

    console.log('\n[AUJOURD\u2019HUI] onglet par d\u00e9faut : h\u00e9ro + file d\u2019actions + 14 jours');
    const load = await page.evaluate(() => ({
      tabs: document.querySelectorAll('#staffCampaignsPage .mk-tabs .pv2-seg button').length,
      heroValue: (document.querySelector('#staffCampaignsPage .mk-hero-value') || {}).textContent || '',
      cards: document.querySelectorAll('#staffCampaignsPage .mk-act').length,
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="idea"]').length,
      instaCard: document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="insta"]').length,
      planCards: document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="plan"]').length,
      foldedByDefault: [...document.querySelectorAll('#staffCampaignsPage .mk-act-body')].every((d) => !d.open),
      hasCopy: !!document.querySelector('#staffCampaignsPage .mk-act[data-kind="idea"] button[onclick^="mkIaCopy"]'),
      cells: document.querySelectorAll('#staffCampaignsPage .mk-ol-day').length,
      wallGone: !document.querySelector('#staffCampaignsPage .mk-plan') && !document.querySelector('#staffCampaignsPage .mk-insta') && !document.querySelector('#staffCampaignsPage .mk-week'),
      menuLabel: [...document.querySelectorAll('.staff-menu button, .staff-menu a')].map((el) => el.textContent.trim()).filter((t) => /marketing/i.test(t)).length,
      gadgetGone: !document.querySelector('.pv2-xpbar') && !document.querySelector('.pv2-camp-hero'),
    }));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' \u2192 ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.tabs === 5, `4 onglets (obtenu ${load.tabs})`);
    ok(/1[\s\u00a0\u202f]?000/.test(load.heroValue), `h\u00e9ro : LE chiffre en euros en t\u00eate (${load.heroValue.trim()})`);
    ok(load.cards === 5 && load.ideas === 2 && load.instaCard === 1 && load.planCards === 2, `file unifi\u00e9e : 5 actions (insta 1 + plan 2 + id\u00e9es 2) — obtenu ${load.cards}`);
    ok(load.foldedByDefault, 'tous les textes REPLI\u00c9S par d\u00e9faut (z\u00e9ro mur de texte)');
    ok(load.hasCopy, 'bouton Copier sur les id\u00e9es');
    ok(load.cells === 14, `bande 14 jours dans Aujourd\u2019hui (${load.cells} cellules)`);
    ok(load.wallGone, 'anciens panneaux empil\u00e9s absents du DOM');
    ok(load.gadgetGone, 'studio gamifi\u00e9 (XP/hero) absent du DOM');

    console.log('\n[FAIT] \u00ab C\u2019est fait \u00bb sur une id\u00e9e \u2192 POST applied');
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="idea"] button')].find((x) => /fait/i.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const afterApplied = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'insightStatus'),
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="idea"]').length,
    }));
    ok(afterApplied.posts.length === 1 && afterApplied.posts[0].status === 'applied', 'POST insightStatus applied envoy\u00e9');
    ok(afterApplied.ideas === 1, 'la carte quitte la file apr\u00e8s \u00ab fait \u00bb');

    console.log('\n[IGNORER] \u2192 POST ignored');
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="idea"] button')].find((x) => /ignorer/i.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const afterIgnored = await page.evaluate(() => ({
      posts: window.__QA_POSTS__.filter((p) => p.action === 'insightStatus'),
      ideas: document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="idea"]').length,
    }));
    ok(afterIgnored.posts.length === 2 && afterIgnored.posts[1].status === 'ignored', 'POST insightStatus ignored envoy\u00e9');
    ok(afterIgnored.ideas === 0, 'plus d\u2019id\u00e9e en attente');

    console.log('\n[PLAN] \u00ab C\u2019est fait \u00bb sur une action du cerveau \u2192 POST planActionDone');
    const planPost = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .mk-act[data-kind="plan"] button')].find((x) => /fait/i.test(x.textContent));
      btn.click();
      await new Promise((r) => setTimeout(r, 450));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'planActionDone');
      const item = document.querySelector('#staffCampaignsPage .mk-act[data-kind="plan"]');
      return { count: posts.length, planAction: posts[0] ? posts[0].planAction : null, done: item ? item.className.includes('is-done') : false };
    });
    ok(planPost.count === 1 && planPost.planAction && planPost.planAction.id === 'social:D4' && planPost.planAction.title.length > 0, '\u00ab C\u2019est fait \u00bb \u2192 POST planActionDone avec l\u2019action compl\u00e8te');
    ok(planPost.done, 'action marqu\u00e9e faite dans la file (mesure J+14)');

    console.log('\n[INSTA] post du jour dans la file');
    const instaCard = await page.evaluate(() => {
      const card = document.querySelector('#staffCampaignsPage .mk-act[data-kind="insta"]');
      const body = card ? (card.querySelector('.mk-act-preview') || {}).textContent || '' : '';
      return { present: !!card, hasCaption: body.includes('frais'), hasTags: body.includes('#bowling'), copyBtn: !!(card && card.querySelector('button[onclick^="mkInstaCopy"]')) };
    });
    ok(instaCard.present && instaCard.hasCaption && instaCard.hasTags, 'post Instagram du jour : l\u00e9gende + hashtags dans le texte repli\u00e9');
    ok(instaCard.copyBtn, 'bouton \u00ab Copier le post \u00bb');
    const accordion = await page.evaluate(async () => {
      const bodies = [...document.querySelectorAll('#staffCampaignsPage .mk-act-body')];
      if (bodies.length < 2) return { enough: false };
      bodies[0].open = true;
      await new Promise((r) => setTimeout(r, 100));
      bodies[1].open = true;
      await new Promise((r) => setTimeout(r, 100));
      return { enough: true, openCount: document.querySelectorAll('#staffCampaignsPage .mk-act-body[open]').length };
    });
    ok(accordion.enough && accordion.openCount === 1, 'accordéon : un seul texte ouvert à la fois');
    const monoGone = await page.evaluate(() => !document.querySelector('#staffCampaignsPage .mk-act .mk-idea-content'));
    ok(monoGone, 'plus de bloc mono « terminal » dans la file');


    console.log('\n[P\u00c9RIODE] 7 jours \u2192 refetch metrics + ROI');
    const callsBefore = await page.evaluate(() => (window.__QA_METRICS_CALLS__ || []).length);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#staffCampaignsPage button')].find((x) => /7 jours/.test(x.textContent)); b.click(); });
    await page.waitForTimeout(400);
    const period = await page.evaluate(() => {
      const calls = window.__QA_METRICS_CALLS__ || [];
      const roiCalls = window.__QA_ROI_CALLS__ || [];
      return { count: calls.length, last: calls[calls.length - 1], lastRoi: roiCalls[roiCalls.length - 1] };
    });
    ok(period.count === callsBefore + 1, 'clic p\u00e9riode \u2192 refetch metrics');
    const spanDays = period.last ? Math.round((new Date(period.last.to) - new Date(period.last.from)) / 864e5) + 1 : 0;
    ok(spanDays === 7 && period.lastRoi === '7', `p\u00e9riode = 7 jours partout (metrics ${spanDays}, roi ${period.lastRoi})`);

    console.log('\n[R\u00c9TRO] explication des jours pass\u00e9s (repli\u00e9e)');
    const retro = await page.evaluate(() => {
      const details = document.querySelector('#staffCampaignsPage .mk-ol-past');
      return { present: !!details, folded: details ? !details.open : false, txt: details ? details.textContent : '' };
    });
    ok(retro.present && retro.folded && /samedi 12\/07/.test(retro.txt), 'r\u00e9tro pr\u00e9sente, repli\u00e9e, avec le samedi anormal');

    console.log('\n[DEMANDE] demande une id\u00e9e cibl\u00e9e (Aujourd\u2019hui)');
    const ask = await page.evaluate(async () => {
      const select = document.getElementById('mkAskObjective');
      const brief = document.getElementById('mkAskBrief');
      if (!select || !brief) return { found: false };
      select.value = 'meteo';
      brief.value = 'canicule annonc\u00e9e jeudi';
      mkIaAsk();
      await new Promise((r) => setTimeout(r, 400));
      const posts = window.__QA_MA_POSTS__ || [];
      return { found: true, run: posts.find((p) => p.action === 'run') || null };
    });
    ok(ask.found, 'champ objectif + brief pr\u00e9sents');
    ok(ask.run && ask.run.objective === 'meteo' && /canicule/.test(ask.run.brief || ''), 'POST run avec objectif m\u00e9t\u00e9o + brief');

    console.log('\n[PERFORMANCE] onglet : chiffres + ROI d\u00e9taill\u00e9 + appris + calendrier');
    await page.evaluate(() => mkSetTab('perf'));
    await page.waitForTimeout(600);
    const perf = await page.evaluate(() => ({
      stats: document.querySelectorAll('#staffCampaignsPage .mk-stats .pv2-stat').length,
      learned: document.querySelectorAll('#staffCampaignsPage .mk-learned').length,
      learnedTxt: (document.querySelector('#staffCampaignsPage .mk-learned small') || {}).textContent || '',
      roiPanel: !!document.querySelector('#staffCampaignsPage .mk-roi'),
      roiRows: document.querySelectorAll('#staffCampaignsPage .mk-roi-row').length,
      roiMethod: /dernier message|60 jours/.test((document.querySelector('#staffCampaignsPage .mk-roi-method') || {}).textContent || ''),
      feedGone: !document.querySelector('#staffCampaignsPage .mk-act'),
    }));
    ok(perf.stats === 4, `4 chiffres de p\u00e9riode (obtenu ${perf.stats})`);
    ok(perf.learned === 1 && /\+22\s?%/.test(perf.learnedTxt), `\u00ab Ce qu\u2019on a appris \u00bb avec mesure +22 % (\u00ab ${perf.learnedTxt.slice(0, 40)} \u00bb)`);
    ok(perf.roiPanel && perf.roiRows === 2 && perf.roiMethod, 'ROI d\u00e9taill\u00e9 par source + m\u00e9thodologie');
    ok(perf.feedGone, 'la file d\u2019actions ne pollue pas Performance');

    console.log('\n[\u00c0 VENIR] bande plage libre (Performance)');
    await page.evaluate(() => loadMarketingWeek(true));
    await page.waitForTimeout(500);
    const week = await page.evaluate(() => ({
      days: document.querySelectorAll('#staffCampaignsPage .mk-week-day').length,
      foire: /Foire/.test((document.querySelector('#staffCampaignsPage .mk-week') || {}).textContent || ''),
      inputs: document.querySelectorAll('#staffCampaignsPage .mk-week-range input[type=date]').length,
    }));
    ok(week.days === 7 && week.inputs === 2, `bande 7 jours + plage libre (obtenu ${week.days} j, ${week.inputs} dates)`);
    ok(week.foire, 'badge Foire visible');

    console.log('\n[ARCHIVE+REDO] historique + refaire une id\u00e9e valid\u00e9e (Performance)');
    const arch = await page.evaluate(async () => {
      const details = document.querySelector('#staffCampaignsPage .mk-archive');
      if (details) details.open = true;
      await new Promise((r) => setTimeout(r, 150));
      const items = details ? details.querySelectorAll('.mk-archive-list li').length : 0;
      const redoBtn = [...document.querySelectorAll('#staffCampaignsPage button')].find((x) => /refaire/i.test(x.textContent));
      if (redoBtn) redoBtn.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'insightRedo');
      return { archive: !!details, items, redo: posts.length, redoId: posts[0] && posts[0].id };
    });
    ok(arch.archive && arch.items >= 3, `archive d\u00e9pliable (${arch.items} items)`);
    ok(arch.redo === 1 && arch.redoId === 5, 'Refaire \u2192 POST insightRedo sur l\u2019id\u00e9e valid\u00e9e');

    console.log('\n[VEILLE] onglet concurrence');
    await page.evaluate(() => mkSetTab('watch'));
    await page.waitForTimeout(500);
    const watch = await page.evaluate(() => ({
      compRows: document.querySelectorAll('#staffCampaignsPage .mk-comp-row').length,
      compDiff: (document.querySelector('#staffCampaignsPage .mk-comp-status p') || {}).textContent || '',
      compForm: !!document.getElementById('mkCompName'),
    }));
    ok(watch.compRows === 1 && /anniversaire/.test(watch.compDiff), 'concurrent list\u00e9 avec son dernier changement');
    ok(watch.compForm, 'formulaire d\u2019ajout pr\u00e9sent');

    console.log('\n[CAMPAGNES] onglet campagnes email');
    await page.evaluate(() => mkSetTab('campaigns'));
    await page.waitForTimeout(400);
    const camp = await page.evaluate(() => /campagne/i.test((document.getElementById('staffCampaignsPage') || {}).textContent || ''));
    ok(camp, 'campagnes email accessibles');
    await page.evaluate(() => mkSetTab('today'));
    await page.waitForTimeout(400);

    console.log('\n[STUDIO] onglet studio : packs par réseau');
    await page.evaluate(() => mkSetTab('studio'));
    await page.waitForTimeout(600);
    const studio = await page.evaluate(() => ({
      channels: document.querySelectorAll('#staffCampaignsPage .mk-studio .pv2-seg button').length,
      blocks: [...document.querySelectorAll('#staffCampaignsPage .mk-st-label')].map((el) => el.textContent),
      badge: (document.querySelector('#staffCampaignsPage .mk-st-badge') || {}).textContent || '',
      copies: document.querySelectorAll('#staffCampaignsPage .mk-st-copy').length,
      promptEn: /no text, no logos/.test((document.querySelector('#staffCampaignsPage .mk-st-mono') || {}).textContent || ''),
    }));
    ok(studio.channels === 4, `4 réseaux dans le studio (${studio.channels})`);
    ok(studio.blocks.length >= 5 && /longue/i.test(studio.blocks[0] || ''), `pack Facebook : ${studio.blocks.length} blocs (longue/courte/story/hashtags/photo/prompt)`);
    ok(/prêt/i.test(studio.badge), 'badge contrôle qualité « Prêt à publier »');
    ok(studio.copies >= 5 && studio.promptEn, 'copier par bloc + prompt image IA en anglais');
    const gen = await page.evaluate(async () => {
      mkStudioChannel('instagram');
      await new Promise((r) => setTimeout(r, 200));
      const empty = !!document.querySelector('#staffCampaignsPage .mk-studio .pv2-empty');
      document.getElementById('mkStudioBrief').value = 'anniversaires ados';
      await mkStudioGenerate();
      await new Promise((r) => setTimeout(r, 300));
      const posts = (window.__QA_POSTS__ || []).filter((post) => post.action === 'studioGenerate');
      const longTxt = [...document.querySelectorAll('#staffCampaignsPage .mk-act-preview')].map((el) => el.textContent).join(' ');
      return { empty, posts: posts.length, platform: posts[0] && posts[0].platform, brief: posts[0] && posts[0].brief, rendered: /instagram/.test(longTxt) };
    });
    ok(gen.empty, 'canal sans pack → état vide propre');
    ok(gen.posts === 1 && gen.platform === 'instagram' && /ados/.test(gen.brief || ''), 'Générer → POST studioGenerate avec canal + brief');
    ok(gen.rendered, 'le pack généré s’affiche immédiatement');
    await page.evaluate(() => mkSetTab('today'));
    await page.waitForTimeout(300);

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
