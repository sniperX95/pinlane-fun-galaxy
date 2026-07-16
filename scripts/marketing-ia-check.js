// Test INTERACTIF de la page Marketing « machine de guerre » : 5 surfaces
// (refonte 2026-07-16 : Aujourd'hui · Ce qui marche · Studio · Concurrents ·
// Résultats). Playwright pilote de vrais clics sur la page servie avec mocks
// fetch : le héros € + toggles de période, le brief signé, la surface causale
// « Ce qui marche » (verdicts jour/météo + mémoire par contexte), le radar 14
// cellules (clic/explication/« Prépare-moi un post »), les cartes Proposition
// (ouvrir → réseau → copier → « Publié ? → Oui » = SEULE porte vers la mesure),
// le studio, la veille concurrent, les reçus, et l'hygiène : zéro jargon
// interne à l'écran, zéro bouton de relance manuelle, l'identité de l'employé.
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
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.__QA_ROI_CALLS__ = [];

    const briefBundle = () => {
      const radar = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        const level = i === 4 ? 'creux' : i === 6 ? 'fort' : (i === 9 ? 'calme' : 'normal');
        return { date, dow: d.getDay(), level, tmax: i === 2 ? 27 : 19, precipMm: i === 3 ? 12 : 0,
          event: i === 8 ? 'Foire de Libramont (à 5 min)' : '', resaCount: i === 6 ? 34 : (i === 0 ? 6 : 0),
          explanation: level === 'creux' ? `Jour ${date.slice(8, 10)} : très calme attendu, jour structurellement faible. Rien de posé.` : `Jour ${date.slice(8, 10)} : journée normale attendue.`,
          propositionKey: i === 4 ? 'plan:social-1' : null };
      });
      return {
        ok: true, centerId: 'libramont', today: dstr(0), generatedAt: new Date().toISOString(),
        networks: ['facebook', 'instagram', 'story'],
        paie: { euros: 1240, venues: 5, sent: 17, reviewClicks: 4, days: 30, young: false, firstVerdictDate: 'mardi 28 juillet',
          sources: [{ key: 'birthday_j30', label: 'Anniversaires', sent: 12, conversions: 3, revenue: 770 }, { key: 'relance', label: 'Relances', sent: 5, conversions: 2, revenue: 470 }] },
        brief: { text: 'Dimanche s\'annonce très calme, pluie annoncée, hors vacances. Je t\'ai préparé 2 posts et un email, tout est prêt plus bas. Du mouvement chez Bowling Arlon cette nuit, détail en bas de page.', degraded: false },
        pulse: { revenue30: 8334, visitors30: 540, avgBasket: 15.4, upcomingPax: 102, upcomingResa: 5, reservedRevenue: 2864, bestDay: { date: '2026-07-11', revenue: 4009, visitors: 234 } },
        radar, dataDays: 210, medianVisitors: 40,
        // « Ce qui marche » : faits causaux + mémoire par contexte (effet net).
        facts: {
          bestDay: { dow: 6, label: 'samedi', avgVisitors: 128, vsMedianPct: 121, confidence: 'solide' },
          worstDay: { dow: 2, label: 'mardi', avgVisitors: 34, vsMedianPct: -41, confidence: 'solide' },
          weather: { rainEffectPct: 12, heatEffectPct: -8, confidence: 'solide', sampleDays: 210 },
          holidayEffectPct: 46, trend4w: { pct: 9 }, bestMonth: null,
        },
        patterns: [
          { context: 'Post FB · événement local', kind: 'post', channel: 'facebook', netDeltaPct: 22, n: 3, confidence: 'signal' },
          { context: 'Email · jour calme', kind: 'email', channel: 'email', netDeltaPct: 14, n: 4, confidence: 'signal' },
        ],
        propositions: [
          { key: 'daily', id: null, trigger: 'pluie', why: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', whyShort: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', dueDate: dstr(0), kind: 'post', pinned: true, network: 'instagram', networks: { instagram: { text: 'Il pleut samedi ? Nos 8 pistes sont au sec, réserve la tienne.\n\n#bowling #libramont' } }, photoIdea: 'arrivée du groupe sous la pluie, strike final', imagePrompt: 'Rainy day bowling, no text, no logos', bestSlot: '17h-19h', status: 'proposed', signature: 'daily:x' },
          { key: 'plan:social-1', id: null, trigger: 'creux', why: 'Dimanche s\'annonce très calme : 12 visiteurs attendus. Je posterais mercredi pour le remplir.', whyShort: 'Dimanche s\'annonce très calme, je posterais mercredi pour le remplir.', dueDate: dstr(2), targetDate: dstr(4), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'plan:social-1' },
          { key: 'db:21', id: 21, trigger: 'concurrent', why: 'Bowling Arlon a lancé une offre étudiants, on répond ?', whyShort: 'Bowling Arlon a lancé une offre étudiants, on répond ?', dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Chez nous, pas besoin de carte étudiant pour passer une bonne soirée. 8 pistes, laser game, arcades.\n\n#bowling' } }, photoIdea: '', imagePrompt: '', bestSlot: '18h', status: 'proposed', signature: 'concurrent:x' },
          { key: 'db:22', id: 22, trigger: 'demande', why: 'Tu m\'as demandé : « soirée fluo », voilà ce que je posterais.', whyShort: 'Tu m\'as demandé : « soirée fluo », voilà ce que je posterais.', dueDate: dstr(3), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Soirée fluo samedi.' } }, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'demande:x' },
        ],
        receipts: [
          { id: 31, label: 'Post pluie du 03/07', tone: 'good', result: '+18 % de monde', redoable: true },
          { id: 32, label: 'Email réactivation du 25/06', tone: 'neutral', result: 'pas d\'effet mesurable', redoable: false },
          { id: 33, label: 'Post soirée fluo du 12/07', tone: 'pending', result: 'verdict le 26 juillet', redoable: false },
        ],
        veille: { count: 2, changed: [{ name: 'Bowling Arlon', diff: 'Nouvelle offre étudiants le mercredi.' }] },
      };
    };

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
        if (b.action === 'propositionAction') {
          if (b.propAction === 'variante' || b.propAction === 'autre_angle') {
            return J({ ok: true, result: { ok: true, id: 88, network: b.network || 'facebook', entry: { text: `Texte ${b.network || 'facebook'} fraichement écrit${b.angle ? ' (angle: ' + b.angle + ')' : ''}.`, photoIdea: 'photo test', imagePrompt: 'prompt test, no text, no logos', bestSlot: '18h' } } });
          }
          return J({ ok: true, result: { ok: true, id: b.id || 88, status: b.propAction === 'publiee' ? 'publiee' : 'refusee' } });
        }
        if (b.action === 'propositionCreate') return J({ ok: true, result: { ok: true, id: 99 } });
        if (b.action === 'insightRedo') return J({ ok: true, insight: { id: 99, status: 'proposed' } });
        if (b.action === 'competitorSave') return J({ ok: true, result: { ok: true, id: 2 } });
        if (b.action === 'competitorDelete') return J({ ok: true, result: { ok: true, id: 1 } });
        if (b.action === 'competitorAnalyzePost') return J({ ok: true, degraded: false, resume: 'Ils poussent une offre étudiants le mercredi.', offre: 'Mercredi étudiant -30%', prix: '9 €', ton: 'promo prix', riposte: 'Mets en avant ton ambiance et tes anniversaires plutôt que le prix.' });
        if (b.action === 'studioGenerate') return J({ ok: true, pack: { platform: b.platform, theme: 'Foire de Libramont', generationMode: 'ai', long: `Post ${b.platform} complet pour le test.`, short: `Court ${b.platform}.`, story: 'Story test.', photoIdea: 'Filmer un strike.', aiImagePrompt: 'Bowling scene, no text, no logos', hashtags: ['#bowling', '#test'], bestTime: '18h', quality: { score: 86, status: 'ready' } } });
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrief') return J(briefBundle());
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingRoi') {
        window.__QA_ROI_CALLS__.push(u.searchParams.get('days'));
        return J({ ok: true, centerId: 'libramont', days: Number(u.searchParams.get('days')) || 30, sent: 9, conversions: 2, revenue: 380, reviewClicks: 1, bySource: [{ key: 'relance', label: 'Relances', sent: 9, conversions: 2, revenue: 380 }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'competitors') {
        return J({ ok: true, competitors: [{ id: 1, name: 'Bowling Arlon', websiteUrl: 'https://bowlingarlon.be', instagramHandle: '', notes: '', enabled: true, lastCheckedAt: '2026-07-17T02:00:00Z', lastDiff: 'Nouvelle offre étudiants le mercredi.', rating: 4.2, reviewsCount: 210, placeId: 'ChIJxyz', placesCheckedAt: '2026-07-17T02:00:00Z', signals: [{ type: 'offre', label: 'Mercredi étudiant', price: '9 €' }, { type: 'anniversaire', label: 'Formule anniversaire', price: '12 €/enfant' }] }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'listCampaigns') return J({ ok: true, campaigns: [], segments: [{ id: 'all', label: 'Tous les clients' }], channel: {} });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], insights: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
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
  const go = async (tab) => { await page.evaluate((t) => window.mkwTab(t), tab); await page.waitForTimeout(300); };
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=mkw-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-tab').length === 5, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .br-cell').length >= 14, null, { timeout: 15000 });
    await page.waitForTimeout(400);

    console.log('\n[HYGIÈNE] identité, 5 surfaces, zéro jargon interne, zéro relance manuelle');
    // Collecte le texte de TOUTES les surfaces pour l'anti-jargon.
    let allText = '';
    for (const tab of ['today', 'works', 'studio', 'rivals', 'results']) {
      await go(tab);
      allText += ' ' + await page.evaluate(() => (document.getElementById('staffCampaignsPage').textContent || '').toLowerCase());
    }
    await go('today');
    const banned = ['attribution', 'last-touch', 'baseline', 'médiane', 'itération', 'insight', 'proposition volatile', 'signature'].filter((word) => allText.includes(word));
    const hygiene = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        tabs: [...root.querySelectorAll('.mkw-tab')].map((el) => el.textContent.trim()),
        refresh: [...root.querySelectorAll('button')].filter((el) => /actualiser|analyser maintenant/i.test(el.textContent)).length,
        sign: /ton employé marketing/i.test(root.textContent),
      };
    });
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(hygiene.tabs.join('|') === 'Aujourd’hui|Ce qui marche|Studio|Concurrents|Résultats', `les 5 surfaces dans l'ordre (${hygiene.tabs.join(', ')})`);
    ok(hygiene.refresh === 0, 'zéro bouton Actualiser/Analyser, l\'employé travaille la nuit');
    ok(banned.length === 0, `zéro jargon interne à l\'écran${banned.length ? ' (trouvé : ' + banned.join(', ') + ')' : ''}`);
    ok(hygiene.sign, 'l\'identité de l\'employé marketing est là');

    console.log('\n[AUJOURD\'HUI] le héros € + le brief signé');
    const hero = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        num: (root.querySelector('.mkw-hero-num') || {}).textContent || '',
        cap: (root.querySelector('.mkw-hero-cap') || {}).textContent || '',
        memo: (root.querySelector('.mkw-memo-text') || {}).textContent || '',
        memoNums: root.querySelectorAll('.mkw-memo-text .br-num').length,
        segs: [...root.querySelectorAll('.mkw-seg-btn')].map((el) => el.textContent.trim()),
      };
    });
    ok(/1[\s  ]?240/.test(hero.num), `le héros € commande (« ${hero.num.trim()} »)`);
    ok(/générés par tes publications/.test(hero.cap), 'la légende du héros est prudente');
    ok(/préparé/.test(hero.memo) && /Bowling Arlon/.test(hero.memo), 'le brief : vu + préparé + veille');
    ok(hero.memoNums >= 1, 'prose-preuve : les nombres du brief en mono');
    ok(hero.segs.join(',') === '7 j,30 j,90 j', 'toggles de période 7/30/90');
    // Le détail des sources se teste AVANT de changer la période (le refetch ROI
    // mocké ne renvoie qu'une source).
    const linkClicked = await page.evaluate(() => { const l = [...document.querySelectorAll('#staffCampaignsPage .mkw-link')].find((el) => /vient ce chiffre/.test(el.textContent)); if (l) { l.click(); return true; } return false; });
    await page.waitForTimeout(200);
    const src = await page.evaluate(() => ({
      rows: document.querySelectorAll('#staffCampaignsPage .mkw-src').length,
      method: /dernier message/.test((document.querySelector('#staffCampaignsPage .mkw-method') || {}).textContent || ''),
    }));
    ok(linkClicked, 'le lien « d\'où vient ce chiffre » est présent');
    ok(src.rows >= 2 && src.method, 'détail des sources (barres) + méthode en langage humain');
    await page.evaluate(() => { [...document.querySelectorAll('.mkw-seg-btn')].find((el) => /7 j/.test(el.textContent)).click(); });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => (window.__QA_ROI_CALLS__ || [])[0]) === '7', 'changer la période → refetch de la paie seule');

    console.log('\n[RADAR] les 14 prochains jours');
    const radar = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        cells: root.querySelectorAll('.br-cell').length,
        creux: root.querySelectorAll('.br-cell.lv-creux').length,
        fort: root.querySelectorAll('.br-cell.lv-fort').length,
        today: root.querySelectorAll('.br-cell.is-today').length,
        resa34: [...root.querySelectorAll('.br-cell-resa')].some((el) => /34/.test(el.textContent)),
        eventDot: root.querySelectorAll('.br-cell-event').length,
      };
    });
    ok(radar.cells === 14 && radar.today === 1, '14 cellules, aujourd\'hui cerclé');
    ok(radar.creux === 1 && radar.fort === 1 && radar.eventDot === 1, 'creux/fort teintés + point événement');
    ok(radar.resa34, 'les résas posées restent visibles (34)');
    await page.evaluate(() => { document.querySelectorAll('.br-cell')[4].click(); });
    await page.waitForTimeout(250);
    const explain = await page.evaluate(() => (document.querySelector('#staffCampaignsPage .br-radar-explain') || {}).textContent || '');
    ok(/très calme attendu/.test(explain) && /Voir la proposition/.test(explain), 'clic cellule creux → explication + lien vers la proposition');
    await page.evaluate(() => { document.querySelectorAll('.br-cell')[9].click(); });
    await page.waitForTimeout(250);
    const fill = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .br-radar-explain button')].find((el) => /Prépare-moi un post/.test(el.textContent));
      if (!btn) return { found: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate');
      return { found: true, posted: posts.length, trigger: posts[0] && posts[0].trigger };
    });
    ok(fill.found && fill.posted === 1 && fill.trigger === 'creux', 'jour calme → « Prépare-moi un post » → création');

    console.log('\n[PROPOSITIONS] les cartes prêtes à tirer');
    await page.waitForTimeout(500);
    const cards = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const list = [...root.querySelectorAll('.br-card')];
      return {
        count: list.length,
        firstWhy: (list[0] && list[0].querySelector('.br-card-why') || {}).textContent || '',
        more: [...root.querySelectorAll('button')].some((el) => /autre.*pour plus tard/i.test(el.textContent)),
        riposte: list.some((el) => /Bowling Arlon a lancé/.test(el.textContent)),
      };
    });
    ok(cards.count === 3 && cards.more, '3 cartes visibles + « + N autres pour plus tard »');
    ok(/Pluie annoncée samedi/.test(cards.firstWhy), 'la proposition du jour épinglée en tête');
    ok(cards.riposte, 'la riposte concurrence est une carte comme les autres');
    await page.evaluate(() => { const btn = [...document.querySelectorAll('.br-card button')].find((el) => /Voir le post/.test(el.textContent)); btn.click(); });
    await page.waitForTimeout(300);
    const openCard = await page.evaluate(() => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      return {
        present: Boolean(card),
        paper: (card && card.querySelector('.br-paper') || {}).textContent || '',
        oneText: card ? card.querySelectorAll('.br-paper').length : 0,
        nets: card ? [...card.querySelectorAll('.br-net')].map((el) => el.textContent) : [],
        noScore: card ? !/\d+\/100/.test(card.textContent) : false,
      };
    });
    ok(openCard.present && /pistes sont au sec/.test(openCard.paper) && /#bowling/.test(openCard.paper), 'le papier : UN texte final, hashtags intégrés');
    ok(openCard.oneText === 1 && openCard.noScore, 'jamais de versions empilées, jamais de score');
    ok(openCard.nets.join(',') === 'Facebook,Instagram,Story', 'réseaux du tenant (TikTok/LinkedIn absents)');
    const variant = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      const fb = [...card.querySelectorAll('.br-net')].find((el) => el.textContent === 'Facebook');
      fb.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'variante');
      const paper = (document.querySelector('#staffCampaignsPage .br-card.is-open .br-paper') || {}).textContent || '';
      return { posted: posts.length, network: posts[0] && posts[0].network, paper };
    });
    ok(variant.posted === 1 && variant.network === 'facebook' && /fraichement écrit/.test(variant.paper), 'réseau non généré → il s\'adapte (POST variante)');
    await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      const copy = [...card.querySelectorAll('button')].find((el) => /Copier le post/.test(el.textContent));
      copy.click();
      await new Promise((r) => setTimeout(r, 250));
    });
    ok(await page.evaluate(() => Boolean(document.querySelector('#staffCampaignsPage .br-published-ask'))), 'Copier → bandeau « Publié ? » (jamais publié sur simple copie)');
    const published = await page.evaluate(async () => {
      const yes = [...document.querySelectorAll('#staffCampaignsPage .br-published-ask button')].find((el) => /^Oui$/.test(el.textContent.trim()));
      yes.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'publiee');
      return { posted: posts.length, compact: (document.querySelector('#staffCampaignsPage .br-published-line') || {}).textContent || '' };
    });
    ok(published.posted === 1 && /je mesure pendant 14 jours/.test(published.compact), '« Oui » → publiée + carte compactée (la mesure démarre)');
    const ask = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 250));
      const chips = [...document.querySelectorAll('#staffCampaignsPage .br-chip')].map((el) => el.textContent);
      document.getElementById('brAskInput').value = 'un post pour la soirée fluo de samedi';
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Demander$/.test(el.textContent.trim()));
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate' && p.brief);
      return { chips, posted: posts.length, brief: posts[0] && posts[0].brief };
    });
    ok(ask.chips.length >= 2 && ask.chips.some((chip) => /Idée libre/.test(chip)), 'chips contextuelles au focus');
    ok(ask.posted === 1 && /soirée fluo/.test(ask.brief), 'Demander → création avec la phrase du gérant');

    console.log('\n[CE QUI MARCHE] l\'analyste causal + la mémoire par contexte');
    await go('works');
    const works = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        kpis: root.querySelectorAll('.mkw-kpi').length,
        kpiText: [...root.querySelectorAll('.mkw-kpi')].map((el) => el.textContent).join(' | '),
        verdicts: root.querySelectorAll('.mkw-verdict').length,
        verdictText: (root.querySelector('.mkw-verdicts') || {}).textContent || '',
        patterns: root.querySelectorAll('.mkw-pat').length,
        patternText: (root.querySelector('.mkw-patterns') || {}).textContent || '',
      };
    });
    ok(works.kpis === 4 && /8[\s  ]?334|8334/.test(works.kpiText) && /540/.test(works.kpiText), 'pouls business : CA + visiteurs (la page n\'est jamais vide)');
    ok(works.verdicts >= 4 && /Samedi/.test(works.verdictText) && /Mardi/.test(works.verdictText), 'verdicts : meilleur/pire jour, effet météo, vacances');
    ok(works.patterns === 2 && /\+22\s?%|22\s?%/.test(works.patternText), 'mémoire par contexte : ce qui convertit, par effet net');

    console.log('\n[STUDIO] pack de contenu par réseau');
    await go('studio');
    const studio = await page.evaluate(async () => {
      const root = document.getElementById('staffCampaignsPage');
      const tabs = root.querySelectorAll('.br-st-bar .br-net').length;
      const igTab = [...root.querySelectorAll('.br-st-bar .br-net')].find((el) => el.textContent === 'Instagram');
      if (igTab) igTab.click();
      await new Promise((r) => setTimeout(r, 150));
      document.getElementById('brStudioBrief').value = 'anniversaires ados';
      const gen = [...root.querySelectorAll('.br-st-bar button')].find((el) => /Générer|Régénérer/.test(el.textContent));
      gen.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'studioGenerate');
      const blocks = [...document.querySelectorAll('.br-st-block .br-st-label')].map((el) => el.textContent);
      const promptEn = /no text, no logos/.test((document.querySelector('.br-st-mono') || {}).textContent || '');
      return { tabs, posted: posts.length, platform: posts[0] && posts[0].platform, brief: posts[0] && posts[0].brief, blocks: blocks.length, promptEn };
    });
    ok(studio.tabs === 4, '4 réseaux dans le studio (Facebook/Instagram/TikTok/LinkedIn)');
    ok(studio.posted === 1 && studio.platform === 'instagram' && /ados/.test(studio.brief || ''), 'Générer → POST studioGenerate avec réseau + angle');
    ok(studio.blocks >= 5 && studio.promptEn, 'pack complet : longue/courte/story/hashtags/photo/prompt image (anglais)');

    console.log('\n[CONCURRENTS] la veille honnête');
    await go('rivals');
    await page.waitForTimeout(400);
    const rivals = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const adlink = root.querySelector('.mkw-riv-adlink');
      return {
        rows: root.querySelectorAll('.mkw-riv').length,
        name: /Bowling Arlon/.test(root.textContent),
        diff: /offre étudiants/.test(root.textContent),
        rating: /4[.,]2/.test(root.textContent) && /avis/.test(root.textContent),
        signals: root.querySelectorAll('.mkw-riv-sig').length,
        adHref: adlink ? adlink.getAttribute('href') : '',
        hasAdd: Boolean(document.getElementById('brCompName')) && Boolean(document.getElementById('brCompSite')),
      };
    });
    ok(rivals.rows >= 1 && rivals.name, 'les concurrents surveillés en cartes');
    ok(rivals.rating, 'la note Google (Places) affichée');
    ok(rivals.signals >= 1, 'offres/prix extraits du site (signaux structurés)');
    ok(/facebook\.com\/ads\/library/.test(rivals.adHref) && /q=Bowling%20Arlon/.test(rivals.adHref), 'lien Meta Ad Library (recherche de leurs pubs, sans scraping)');
    ok(rivals.diff, 'le changement détecté chez le concurrent est remonté');
    ok(rivals.hasAdd, 'ajout d\'un concurrent (nom + site)');
    // Colle-un-post → analyse IA + riposte.
    const analyze = await page.evaluate(async () => {
      const box = document.getElementById('brCompPost');
      if (!box) return { found: false };
      box.value = 'Mercredi étudiant : -30% sur le bowling pour toute la promo, sur présentation de la carte étudiant.';
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Analyser$/.test(el.textContent.trim()));
      btn.click();
      // Attendre le panneau lui-meme, pas une duree fixe : un sleep de 500 ms
      // rendait ce test flaky des que la machine etait chargee.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !document.querySelector('#staffCampaignsPage .mkw-analy, #staffCampaignsPage .mkw-analy-degraded')) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'competitorAnalyzePost');
      const panel = (document.querySelector('#staffCampaignsPage .mkw-analy') || {}).textContent || '';
      return { found: true, posted: posts.length, hadText: Boolean(posts[0] && posts[0].text), panel };
    });
    ok(analyze.found && analyze.posted === 1 && analyze.hadText, 'colle-un-post → POST competitorAnalyzePost avec le texte');
    ok(/étudiants/.test(analyze.panel) && /ambiance/.test(analyze.panel), 'l\'analyse affiche le signal + la riposte');

    console.log('\n[RÉSULTATS] le CA généré + les reçus mesurés');
    await go('results');
    const results = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const rows = [...root.querySelectorAll('.br-receipt')];
      return {
        hero: Boolean(root.querySelector('.mkw-hero-num')),
        eyebrow: /rapporté/i.test((root.querySelector('.mkw-eyebrow') || {}).textContent || ''),
        count: rows.length,
        good: rows.some((el) => el.className.includes('tone-good') && /\+18\s?% de monde/.test(el.textContent)),
        neutral: rows.some((el) => el.className.includes('tone-neutral') && /pas d'effet mesurable/.test(el.textContent)),
        pending: rows.some((el) => /verdict le 26 juillet/.test(el.textContent)),
        redo: rows.some((el) => /On le refait \?/.test(el.textContent)),
      };
    });
    ok(results.hero && results.eyebrow, 'le héros « ce que le marketing a rapporté » (l\'arme de vente)');
    ok(results.count === 3 && results.good && results.neutral && results.pending, 'reçus : bon en vert, neutre jamais rouge, verdict à venir');
    ok(results.redo, '« On le refait ? » sur les lignes positives');
    const redo = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .br-receipt button')].find((el) => /On le refait/.test(el.textContent));
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return (window.__QA_POSTS__ || []).filter((p) => p.action === 'insightRedo').length;
    });
    ok(redo === 1, '« On le refait ? » → clone en file');

    console.log('\n[EMAILS] les campagnes ont déménagé');
    await page.evaluate(() => { state.staffMenuPage = 'emails'; save(); renderStaff(); });
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => /campagne/i.test((document.getElementById('staffEmailsPage') || {}).textContent || '')), 'la section campagnes vit dans la page Emails');

    console.log(`\n${failures ? failures + ' FAIL' : ''}`);
    if (failures) { console.error('marketing-ia-check: FAIL'); process.exit(1); }
    console.log('marketing-ia-check: ALL OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error('marketing-ia-check CRASH:', error.stack || error.message); process.exit(1); });
