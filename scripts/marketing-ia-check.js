// Test INTERACTIF de la page Marketing « Le Brief » (refonte 2026-07-17).
// Playwright pilote de vrais clics sur la page servie avec mocks fetch :
// la paie + toggles de période, le brief signé, le radar 14 cellules (clic,
// explication, « Prépare-moi un post »), les cartes Proposition (ouvrir,
// changer de réseau, copier → bandeau Publié ? → Oui = SEULE porte vers la
// mesure), la barre Demander à chips, les reçus, la veille en footer — et
// l'hygiène globale : zéro onglet, zéro bouton de relance, zéro jargon.
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
          explanation: level === 'creux' ? `Jour ${date.slice(8, 10)} : très calme attendu — jour structurellement faible. Rien de posé.` : `Jour ${date.slice(8, 10)} : journée normale attendue.`,
          propositionKey: i === 4 ? 'plan:social-1' : null };
      });
      return {
        ok: true, centerId: 'libramont', today: dstr(0), generatedAt: new Date().toISOString(),
        networks: ['facebook', 'instagram', 'story'],
        paie: { euros: 1240, venues: 5, sent: 17, reviewClicks: 4, days: 30, young: false, firstVerdictDate: 'mardi 28 juillet',
          sources: [{ key: 'birthday_j30', label: 'Anniversaires', sent: 12, conversions: 3, revenue: 770 }, { key: 'relance', label: 'Relances', sent: 5, conversions: 2, revenue: 470 }] },
        brief: { text: 'Dimanche s\'annonce très calme — pluie annoncée, hors vacances. Je t\'ai préparé 2 posts et un email — tout est prêt plus bas. Du mouvement chez Bowling Arlon cette nuit — détail en bas de page.', degraded: false },
        pulse: { revenue30: 8334, visitors30: 540, avgBasket: 15.4, upcomingPax: 102, upcomingResa: 5, reservedRevenue: 2864, bestDay: { date: '2026-07-11', revenue: 4009, visitors: 234 } },
        radar, dataDays: 90, medianVisitors: 40,
        propositions: [
          { key: 'daily', id: null, trigger: 'pluie', why: 'Pluie annoncée samedi — les familles vont chercher un plan au sec.', whyShort: 'Pluie annoncée samedi — les familles vont chercher un plan au sec.', dueDate: dstr(0), kind: 'post', pinned: true, network: 'instagram', networks: { instagram: { text: 'Il pleut samedi ? Nos 8 pistes sont au sec — réserve la tienne.\n\n#bowling #libramont' } }, photoIdea: 'arrivée du groupe sous la pluie, strike final', imagePrompt: 'Rainy day bowling, no text, no logos', bestSlot: '17h-19h', status: 'proposed', signature: 'daily:x' },
          { key: 'plan:social-1', id: null, trigger: 'creux', why: 'Dimanche s\'annonce très calme : 12 visiteurs attendus. Je posterais mercredi pour le remplir.', whyShort: 'Dimanche s\'annonce très calme — je posterais mercredi pour le remplir.', dueDate: dstr(2), targetDate: dstr(4), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'plan:social-1' },
          { key: 'db:21', id: 21, trigger: 'concurrent', why: 'Bowling Arlon a lancé une offre étudiants — on répond ?', whyShort: 'Bowling Arlon a lancé une offre étudiants — on répond ?', dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Chez nous, pas besoin de carte étudiant pour passer une bonne soirée. 8 pistes, laser game, arcades.\n\n#bowling' } }, photoIdea: '', imagePrompt: '', bestSlot: '18h', status: 'proposed', signature: 'concurrent:x' },
          { key: 'db:22', id: 22, trigger: 'demande', why: 'Tu m\'as demandé : « soirée fluo » — voilà ce que je posterais.', whyShort: 'Tu m\'as demandé : « soirée fluo » — voilà ce que je posterais.', dueDate: dstr(3), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: 'Soirée fluo samedi.' } }, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'demande:x' },
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
        if (b.action === 'studioGenerate') return J({ ok: true, pack: { platform: b.platform, theme: 'Foire de Libramont', generationMode: 'ai', long: `Post ${b.platform} complet pour le test.`, short: `Court ${b.platform}.`, story: 'Story test.', photoIdea: 'Filmer un strike.', aiImagePrompt: 'Bowling scene, no text, no logos', hashtags: ['#bowling', '#test'], bestTime: '18h', quality: { score: 86, status: 'ready' } } });
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrief') return J(briefBundle());
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingRoi') {
        window.__QA_ROI_CALLS__.push(u.searchParams.get('days'));
        return J({ ok: true, centerId: 'libramont', days: Number(u.searchParams.get('days')) || 30, sent: 9, conversions: 2, revenue: 380, reviewClicks: 1, bySource: [{ key: 'relance', label: 'Relances', sent: 9, conversions: 2, revenue: 380 }] });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'competitors') {
        return J({ ok: true, competitors: [{ id: 1, name: 'Bowling Arlon', websiteUrl: 'https://bowlingarlon.be', instagramHandle: '', notes: '', enabled: true, lastCheckedAt: '2026-07-17T02:00:00Z', lastDiff: 'Nouvelle offre étudiants le mercredi.' }] });
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
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=br-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'campaigns'; state.staffTheme = 'dark';
      save(); setView('staff'); renderStaff();
    });
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .br-cell').length >= 14, null, { timeout: 15000 });
    await page.waitForTimeout(400);

    console.log('\n[HYGIÈNE] zéro onglet, zéro relance, zéro jargon');
    const hygiene = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const text = (root.textContent || '').toLowerCase();
      // « pack » (de contenu) et « régénérer » sont du langage produit normal ;
      // les mots bannis sont le jargon INTERNE du moteur.
      const banned = ['attribution', 'last-touch', 'baseline', 'médiane', 'itération', 'insight', 'proposition volatile', 'signature'].filter((word) => text.includes(word));
      return {
        tabs: root.querySelectorAll('.mk-tabs, .pv2-seg').length,
        refresh: [...root.querySelectorAll('button')].filter((el) => /actualiser|analyser maintenant/i.test(el.textContent)).length,
        banned,
        zones: [...root.querySelectorAll('.br-zt')].map((el) => el.textContent.trim().toLowerCase()),
        sign: /ton employé marketing/.test(root.textContent),
      };
    });
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(hygiene.tabs === 0, 'zéro onglet, zéro segmented pill');
    ok(hygiene.refresh === 0, 'zéro bouton Actualiser/Analyser — l\'employé travaille la nuit');
    ok(hygiene.banned.length === 0, `zéro jargon à l\'écran${hygiene.banned.length ? ' (trouvé : ' + hygiene.banned.join(', ') + ')' : ''}`);
    ok(hygiene.zones.join('|').includes('14 prochains jours') && hygiene.zones.join('|').includes('prêt pour toi') && hygiene.zones.join('|').includes('ce que ça a donné'), 'les zones du mémo dans l\'ordre');
    ok(hygiene.sign, 'la signature de l\'employé est là');

    console.log('\n[Z1] la paie + le brief signé');
    const z1 = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        pay: (root.querySelector('.br-pay') || {}).textContent || '',
        payNum: (root.querySelector('.br-pay-num') || {}).textContent || '',
        memo: (root.querySelector('.br-memo-text') || {}).textContent || '',
        memoNums: root.querySelectorAll('.br-memo-text .br-num').length,
        toggles: [...root.querySelectorAll('.br-toggle')].map((el) => el.textContent.trim()),
      };
    });
    ok(/liées à/.test(z1.pay) && /1[\s  ]?240/.test(z1.payNum), `la phrase de paie prudente (« ${z1.pay.slice(0, 45)}… »)`);
    ok(/préparé/.test(z1.memo) && /Bowling Arlon/.test(z1.memo), 'le brief : vu + préparé + veille');
    ok(z1.memoNums >= 1, 'prose-preuve : les nombres du brief en mono');
    ok(z1.toggles.join(',') === '7 j,30 j,90 j', 'toggles texte 7/30/90');
    await page.evaluate(() => { [...document.querySelectorAll('.br-toggle')].find((el) => /7 j/.test(el.textContent)).click(); });
    await page.waitForTimeout(400);
    const periodCall = await page.evaluate(() => (window.__QA_ROI_CALLS__ || [])[0]);
    ok(periodCall === '7', 'changer la période → refetch de la paie seule');
    await page.evaluate(() => { const link = [...document.querySelectorAll('.br-link')].find((el) => /Voir le détail/.test(el.textContent)); if (link) link.click(); });
    await page.waitForTimeout(200);
    const payDetail = await page.evaluate(() => ({
      tickets: document.querySelectorAll('#staffCampaignsPage .br-pay-detail .br-ticket').length,
      method: /dernier message qu'elle a vu/.test((document.querySelector('#staffCampaignsPage .br-method') || {}).textContent || ''),
    }));
    ok(payDetail.tickets >= 3 && payDetail.method, 'détail en lignes ticket + méthode en une phrase humaine');

    console.log('\n[POULS] les KPIs business réels');
    const pulse = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const tiles = [...root.querySelectorAll('.br-kpi')].map((el) => el.textContent);
      return { count: tiles.length, all: tiles.join(' | ') };
    });
    ok(pulse.count === 5, `5 tuiles de KPIs business (obtenu ${pulse.count})`);
    ok(/8[\s  ]?334|8334/.test(pulse.all) && /540/.test(pulse.all) && /102/.test(pulse.all), 'CA + visiteurs + réservations à venir affichés (vraies données, page jamais vide)');
    ok(/234/.test(pulse.all), 'meilleure journée en preuve');

    console.log('\n[Z2] le radar');
    const radar = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        cells: root.querySelectorAll('.br-cell').length,
        creux: root.querySelectorAll('.br-cell.lv-creux').length,
        fort: root.querySelectorAll('.br-cell.lv-fort').length,
        today: root.querySelectorAll('.br-cell.is-today').length,
        resa34: [...root.querySelectorAll('.br-cell-resa')].some((el) => /34/.test(el.textContent)),
        temps: [...root.querySelectorAll('.br-cell-temp')].filter((el) => /°/.test(el.textContent)).length,
        summary: /attendues/.test((root.querySelector('.br-radar-sum') || {}).textContent || ''),
        eventDot: root.querySelectorAll('.br-cell-event').length,
        noAxis: !root.querySelector('.mk-ol-median') && !root.querySelector('.mk-ol-axis'),
      };
    });
    ok(radar.temps >= 10 && radar.summary, 'radar enrichi : température par jour + synthèse des réservations à venir');
    ok(radar.cells === 14 && radar.today === 1, '14 cellules, aujourd\'hui cerclé');
    ok(radar.creux === 1 && radar.fort === 1 && radar.eventDot === 1, 'creux/fort teintés + point événement');
    ok(radar.resa34, 'les résas posées restent visibles (34)');
    await page.evaluate(() => { document.querySelectorAll('.br-cell')[4].click(); });
    await page.waitForTimeout(250);
    const explain = await page.evaluate(() => ({
      text: (document.querySelector('#staffCampaignsPage .br-radar-explain') || {}).textContent || '',
      hasLink: /Voir la proposition/.test((document.querySelector('#staffCampaignsPage .br-radar-explain') || {}).textContent || ''),
    }));
    ok(/très calme attendu/.test(explain.text), 'clic cellule → explication humaine');
    ok(explain.hasLink, 'le creux pointe vers sa proposition');
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
    ok(fill.found && fill.posted === 1 && fill.trigger === 'creux', 'jour calme sans proposition → « Prépare-moi un post » → création');

    console.log('\n[Z3] les cartes Proposition');
    await page.waitForTimeout(600);
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
    ok(/Pluie annoncée samedi/.test(cards.firstWhy), 'la proposition du jour épinglée en tête, le POURQUOI comme titre');
    ok(cards.riposte, 'la riposte concurrence est une carte comme les autres');
    // Ouvrir la première carte (payload pré-généré → papier immédiat).
    await page.evaluate(() => { const btn = [...document.querySelectorAll('.br-card button')].find((el) => /Voir le post/.test(el.textContent)); btn.click(); });
    await page.waitForTimeout(300);
    const openCard = await page.evaluate(() => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      return {
        present: Boolean(card),
        paper: (card && card.querySelector('.br-paper') || {}).textContent || '',
        oneText: card ? card.querySelectorAll('.br-paper').length : 0,
        nets: card ? [...card.querySelectorAll('.br-net')].map((el) => el.textContent) : [],
        promptFolded: card ? Boolean(card.querySelector('.br-prompt') && !card.querySelector('.br-prompt[open]')) : false,
        noScore: card ? !/\d+\/100/.test(card.textContent) : false,
      };
    });
    ok(openCard.present && /pistes sont au sec/.test(openCard.paper) && /#bowling/.test(openCard.paper), 'le papier : UN texte final, hashtags intégrés');
    ok(openCard.oneText === 1 && openCard.noScore, 'jamais de versions empilées, jamais de score');
    ok(openCard.nets.join(',') === 'Facebook,Instagram,Story', 'réseaux du tenant (TikTok/LinkedIn absents)');
    ok(openCard.promptFolded, 'le prompt image replié derrière un disclosure');
    // Switch réseau non généré → POST variante + texte mis à jour.
    const variant = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      const fb = [...card.querySelectorAll('.br-net')].find((el) => el.textContent === 'Facebook');
      fb.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'variante');
      const paper = (document.querySelector('#staffCampaignsPage .br-card.is-open .br-paper') || {}).textContent || '';
      return { posted: posts.length, network: posts[0] && posts[0].network, paper };
    });
    ok(variant.posted === 1 && variant.network === 'facebook' && /fraichement écrit/.test(variant.paper), 'réseau non généré → il s\'adapte (POST variante) et le papier suit');
    // Copier → bandeau Publié ? → Oui = POST publiee, carte compactée.
    await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .br-card.is-open');
      const copy = [...card.querySelectorAll('button')].find((el) => /Copier le post/.test(el.textContent));
      copy.click();
      await new Promise((r) => setTimeout(r, 250));
    });
    const askBanner = await page.evaluate(() => Boolean(document.querySelector('#staffCampaignsPage .br-published-ask')));
    ok(askBanner, 'Copier → bandeau « Publié ? » (jamais publié sur simple copie)');
    const published = await page.evaluate(async () => {
      const yes = [...document.querySelectorAll('#staffCampaignsPage .br-published-ask button')].find((el) => /^Oui$/.test(el.textContent.trim()));
      yes.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'publiee');
      const line = document.querySelector('#staffCampaignsPage .br-published-line');
      return { posted: posts.length, compact: line ? line.textContent : '' };
    });
    ok(published.posted === 1 && /je mesure pendant 14 jours/.test(published.compact), '« Oui » → publiée + carte compactée (la mesure démarre)');
    // Pas maintenant → refusée + disparaît.
    const dismissed = await page.evaluate(async () => {
      const before = document.querySelectorAll('#staffCampaignsPage .br-card').length;
      const open = [...document.querySelectorAll('#staffCampaignsPage .br-card button')].find((el) => /Voir le post|Voir la riposte/.test(el.textContent));
      open.click();
      await new Promise((r) => setTimeout(r, 200));
      const not = [...document.querySelectorAll('#staffCampaignsPage .br-card button')].find((el) => /Pas maintenant/.test(el.textContent));
      not.click();
      await new Promise((r) => setTimeout(r, 350));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'refusee');
      return { posted: posts.length, after: document.querySelectorAll('#staffCampaignsPage .br-card:not(.is-published)').length, before };
    });
    ok(dismissed.posted === 1 && dismissed.after < dismissed.before, '« Pas maintenant » → refusée + la carte sort de la file');
    // Barre Demander : chips au focus, submit → création.
    const ask = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 250));
      const chips = [...document.querySelectorAll('#staffCampaignsPage .br-chip')].map((el) => el.textContent);
      const el2 = document.getElementById('brAskInput');
      el2.value = 'un post pour la soirée fluo de samedi';
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Demander$/.test(el.textContent.trim()));
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate' && p.brief);
      return { chips, posted: posts.length, brief: posts[0] && posts[0].brief };
    });
    ok(ask.chips.length >= 2 && ask.chips.some((chip) => /Idée libre/.test(chip)), 'chips contextuelles au focus');
    ok(ask.posted === 1 && /soirée fluo/.test(ask.brief), 'Demander → création avec la phrase du gérant');

    console.log('\n[STUDIO] pack de contenu par réseau');
    const studio = await page.evaluate(async () => {
      const root = document.getElementById('staffCampaignsPage');
      const tabs = root.querySelectorAll('.br-st-bar .br-net').length;
      // Générer un pack Instagram.
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

    console.log('\n[Z4] les reçus');
    const receipts = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffCampaignsPage .br-receipt')];
      return {
        count: rows.length,
        good: rows.some((el) => el.className.includes('tone-good') && /\+18\s?% de monde/.test(el.textContent)),
        neutral: rows.some((el) => el.className.includes('tone-neutral') && /pas d'effet mesurable/.test(el.textContent)),
        pending: rows.some((el) => /verdict le 26 juillet/.test(el.textContent)),
        redo: rows.some((el) => /On le refait \?/.test(el.textContent)),
      };
    });
    ok(receipts.count === 3 && receipts.good && receipts.neutral && receipts.pending, 'lignes ticket : bon en vert, neutre jamais rouge, verdict à venir');
    ok(receipts.redo, '« On le refait ? » sur les lignes positives');
    const redo = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .br-receipt button')].find((el) => /On le refait/.test(el.textContent));
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return (window.__QA_POSTS__ || []).filter((p) => p.action === 'insightRedo').length;
    });
    ok(redo === 1, '« On le refait ? » → clone en file');

    console.log('\n[FOOTER] la veille');
    const veille = await page.evaluate(async () => {
      const details = document.querySelector('#staffCampaignsPage .br-veille');
      const summary = details.querySelector('summary').textContent;
      const dot = Boolean(details.querySelector('.br-veille-dot'));
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      await new Promise((r) => setTimeout(r, 500));
      const rows = document.querySelectorAll('#staffCampaignsPage .br-veille-row').length;
      const hasAdd = Boolean(document.getElementById('brCompName'));
      return { summary, dot, rows, hasAdd };
    });
    ok(/Je surveille 2 concurrents/.test(veille.summary) && veille.dot, 'summary + point d\'alerte quand un diff est tombé');
    ok(veille.rows >= 1 && veille.hasAdd, 'déplié : liste + ajout d\'un site');

    console.log('\n[EMAILS] les campagnes ont déménagé');
    await page.evaluate(() => { state.staffMenuPage = 'emails'; save(); renderStaff(); });
    await page.waitForTimeout(700);
    const emailsPage = await page.evaluate(() => /campagne/i.test((document.getElementById('staffEmailsPage') || {}).textContent || ''));
    ok(emailsPage, 'la section campagnes vit dans la page Emails');

    console.log(`\n${failures ? failures + ' FAIL' : ''}`);
    if (failures) { console.error('marketing-ia-check: FAIL'); process.exit(1); }
    console.log('marketing-ia-check: ALL OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error('marketing-ia-check CRASH:', error.stack || error.message); process.exit(1); });
