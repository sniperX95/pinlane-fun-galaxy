// Test INTERACTIF de la page Marketing : 5 surfaces (RUN C, 2026-07-17 :
// Aujourd'hui · Le plan · Studio · Concurrents · Résultats : « Ce qui marche »
// a fusionné dans Résultats, la maison unique de la preuve). Playwright pilote
// de vrais clics sur la page servie avec mocks fetch : la ligne de voix + la
// paie compacte, le radar 14 cellules (clic/explication/valeur du creux en
// euros/« Prépare-moi un post »), les cartes Proposition (ouvrir → réseau →
// copier → « Publié ? → Oui » = SEULE porte vers la mesure), la barre de
// demande qui SURVIT à un re-render, le plan avec ses poignées (« C'est
// fait » → planActionDone, pont Studio, fraîcheur affichée), l'atelier Studio
// (badge honnête note+mode, fabrication réelle), la veille (erreur dite,
// apprentissage montré, riposte → Studio), le héros € dans Résultats avec ses
// libellés exacts, les reçus, les verdicts causaux, la mémoire par contexte.
// Et l'hygiène : zéro jargon interne, zéro bouton de relance, l'identité.
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
        paie: { euros: 1240, venues: 5, sent: 17, reviewClicks: 4, days: 30, young: false, quietWindow: false, firstVerdictDate: 'mardi 28 juillet',
          sources: [{ key: 'birthday_j30', label: 'Anniversaires', sent: 12, conversions: 3, revenue: 770 }, { key: 'relance', label: 'Relances', sent: 5, conversions: 2, revenue: 470 }] },
        brief: { text: 'Dimanche s\'annonce très calme, pluie annoncée, hors vacances. Je t\'ai préparé 2 posts et un email, tout est prêt plus bas. Du mouvement chez Bowling Arlon ce matin, détail dans l\'onglet Concurrents.', degraded: false },
        pulse: { revenue30: 8334, visitors30: 540, avgBasket: 15.4, upcomingPax: 102, upcomingResa: 5, reservedRevenue: 2864, bestDay: { date: '2026-07-11', revenue: 4009, visitors: 234 } },
        radar, dataDays: 210, medianVisitors: 40,
        facts: {
          bestDay: { dow: 6, label: 'samedi', avgVisitors: 128, vsMedianPct: 121, confidence: 'solide' },
          worstDay: { dow: 2, label: 'mardi', avgVisitors: 34, vsMedianPct: -41, confidence: 'solide' },
          weather: { rainEffectPct: 12, heatEffectPct: -8, confidence: 'solide', sampleDays: 210 },
          holidayEffectPct: -6, holidayEffectConfidence: 'signal', trend4w: { pct: 9 }, bestMonth: null,
        },
        patterns: [
          { context: 'Post FB · événement local', kind: 'post', channel: 'facebook', netDeltaPct: 22, basis: 'net', n: 3, confidence: 'signal' },
          { context: 'Email · jour calme', kind: 'email', channel: 'email', netDeltaPct: 14, basis: 'brut', n: 4, confidence: 'signal' },
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
        if (b.action === 'planActionDone') return J({ ok: true, result: { ok: true, id: 55, status: 'applied' } });
        if (b.action === 'competitorSave') return J({ ok: true, result: { ok: true, id: 2 } });
        if (b.action === 'competitorDelete') return J({ ok: true, result: { ok: true, id: 1 } });
        if (b.action === 'competitorAnalyzePost') return J({ ok: true, degraded: false, resume: 'Ils poussent une offre étudiants le mercredi.', offre: 'Mercredi étudiant -30%', prix: '9 €', ton: 'promo prix', riposte: 'Mets en avant ton ambiance et tes anniversaires plutôt que le prix.', adn: [{ nom: 'creneau precis', regle: 'Annoncer un créneau précis rend l\'offre concrète.' }, { nom: 'urgence datee', regle: 'Une échéance datée déclenche la décision.' }], dnaLearned: 2 });
        if (b.action === 'studioGenerate') return J({ ok: true, pack: { platform: b.platform, theme: 'Foire de Libramont', generationMode: 'ai', long: `Post ${b.platform} complet pour le test.`, short: `Court ${b.platform}.`, story: 'Story test.', photoIdea: 'Filmer un strike.', aiImagePrompt: 'Bowling scene, no text, no logos', hashtags: ['#bowling', '#test'], bestTime: '18h', quality: { score: 86, status: 'ready', iterations: [{ mode: 'rules', score: 84 }, { mode: 'ai_1', score: 86, blocked: false }] } } });
        // LE PLAN : un plan realiste, avec les 3 confiances possibles, dont une
        // semaine « routine » qui DOIT s'afficher honnetement plutot que d'etre
        // masquee ou maquillee en opportunite. Semaines calees sur AUJOURD'HUI
        // pour tester les etats passee / cette semaine / a venir.
        if (b.action === 'marketingPlanGet' || b.action === 'marketingPlanBuild') {
          const monday = (() => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d; })();
          const w = (offset) => { const from = new Date(monday); from.setDate(from.getDate() + offset * 7); const to = new Date(from); to.setDate(to.getDate() + 6); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; };
          return J({ ok: true, planId: 7, status: 'proposed', plan: {
            mode: 'ai', centerId: 'libramont', generatedAt: new Date().toISOString(),
            context: { hasMeasuredEvidence: false, patternsSolides: 0, semainesRejetees: 0, motifsRejet: [] },
            weeks: [
              { index: 1, ...w(0), confiance: 'calendrier', objectif: 'Remplir les journees des vacances', pourquoi: "Vacances d'ete : les enfants sont libres en journee.", actions: ['Un post formules famille'], faits: [{ type: 'conge_scolaire', label: "Vacances d'ete 2026" }] },
              { index: 2, ...w(1), confiance: 'calendrier', objectif: 'Capter le flux de la Foire', pourquoi: 'Foire de Libramont du 24 au 27, a 5 minutes.', actions: ['Un post avant', 'Un rappel le jour fort'], faits: [{ type: 'evenement_local', label: 'Foire de Libramont' }] },
              { index: 3, ...w(2), confiance: 'routine', objectif: 'Le fond de commerce : anniversaires et groupes', pourquoi: "Aucun evenement ni conge date cette semaine.", actions: ['Un post anniversaire enfant'], faits: [] },
            ],
          } });
        }
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrief') return J(briefBundle());
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'studioPacks') return J({ ok: true, packs: { facebook: null, instagram: null, tiktok: null, linkedin: null } });
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
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-cell').length >= 14, null, { timeout: 15000 });
    await page.waitForTimeout(400);

    console.log('\n[HYGIÈNE] identité, 5 surfaces, zéro jargon interne, zéro relance manuelle');
    let allText = '';
    for (const tab of ['today', 'plan', 'studio', 'rivals', 'results']) {
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
        kpis: root.querySelectorAll('.mkw-kpi').length,
      };
    });
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(hygiene.tabs.join('|') === 'Aujourd’hui|Le plan|Studio|Concurrents|Résultats', `les 5 surfaces dans l'ordre (${hygiene.tabs.join(', ')})`);
    ok(hygiene.refresh === 0, 'zéro bouton Actualiser/Analyser, l\'employé travaille la nuit');
    ok(banned.length === 0, `zéro jargon interne à l\'écran${banned.length ? ' (trouvé : ' + banned.join(', ') + ')' : ''}`);
    ok(hygiene.sign, 'l\'identité de l\'employé marketing est là');
    ok(hygiene.kpis === 0, 'le pulse business a quitté la zone Marketing (il vit en Direction)');

    console.log('\n[AUJOURD\'HUI] la voix + la paie compacte');
    const today = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        voice: (root.querySelector('.mkw-voice-text') || {}).textContent || '',
        voiceNums: root.querySelectorAll('.mkw-voice-text .br-num').length,
        payline: (root.querySelector('.mkw-payline-text') || {}).textContent || '',
        paylineLink: [...root.querySelectorAll('.mkw-payline button')].some((el) => /Voir le détail/.test(el.textContent)),
        hero: root.querySelectorAll('.mkw-hero').length,
      };
    });
    ok(/préparé/.test(today.voice) && /Bowling Arlon/.test(today.voice), 'la voix : vu + préparé + veille');
    ok(today.voiceNums >= 1, 'prose-preuve : les nombres de la voix en mono');
    ok(/1[\s  ]?240/.test(today.payline) && /30 derniers jours/.test(today.payline), 'la paie compacte rappelle le chiffre');
    ok(today.paylineLink, 'et pointe vers Résultats (la maison de la preuve)');
    ok(today.hero === 0, 'le héros € ne vit PAS dans Aujourd\'hui (une seule maison)');

    console.log('\n[RADAR] les 14 prochains jours');
    const radar = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        cells: root.querySelectorAll('.mkw-cell').length,
        creux: root.querySelectorAll('.mkw-cell.lv-creux').length,
        fort: root.querySelectorAll('.mkw-cell.lv-fort').length,
        today: root.querySelectorAll('.mkw-cell.is-today').length,
        resa34: [...root.querySelectorAll('.mkw-cell-resa')].some((el) => /34/.test(el.textContent)),
        eventDot: root.querySelectorAll('.mkw-cell-event').length,
      };
    });
    ok(radar.cells === 14 && radar.today === 1, '14 cellules, aujourd\'hui cerclé');
    ok(radar.creux === 1 && radar.fort === 1 && radar.eventDot === 1, 'creux/fort teintés + point événement');
    ok(radar.resa34, 'les résas posées restent visibles (34)');
    await page.evaluate(() => { document.querySelectorAll('.mkw-cell')[4].click(); });
    await page.waitForTimeout(250);
    const explain = await page.evaluate(() => (document.querySelector('#staffCampaignsPage .mkw-radar-explain') || {}).textContent || '');
    ok(/très calme attendu/.test(explain) && /Voir la proposition/.test(explain), 'clic cellule creux → explication + lien vers la proposition');
    ok(/panier moyen mesuré/.test(explain) && /15\s?€/.test(explain), 'la valeur du creux est dite en euros (panier moyen mesuré, pas une projection)');
    await page.evaluate(() => { document.querySelectorAll('.mkw-cell')[9].click(); });
    await page.waitForTimeout(250);
    const fill = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .mkw-radar-explain button')].find((el) => /Prépare-moi un post/.test(el.textContent));
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
      const list = [...root.querySelectorAll('.mkw-prop')];
      return {
        count: list.length,
        firstWhy: (list[0] && list[0].querySelector('.mkw-prop-why') || {}).textContent || '',
        more: [...root.querySelectorAll('button')].some((el) => /autre.*pour plus tard/i.test(el.textContent)),
        riposte: list.some((el) => /Bowling Arlon a lancé/.test(el.textContent)),
      };
    });
    ok(cards.count === 3 && cards.more, '3 cartes visibles + « + N autres pour plus tard »');
    ok(/Pluie annoncée samedi/.test(cards.firstWhy), 'la proposition du jour épinglée en tête');
    ok(cards.riposte, 'la riposte concurrence est une carte comme les autres');
    await page.evaluate(() => { const btn = [...document.querySelectorAll('.mkw-prop button')].find((el) => /Voir le post/.test(el.textContent)); btn.click(); });
    await page.waitForTimeout(300);
    const openCard = await page.evaluate(() => {
      const card = document.querySelector('#staffCampaignsPage .mkw-prop.is-open');
      return {
        present: Boolean(card),
        paper: (card && card.querySelector('.mkw-paper') || {}).textContent || '',
        oneText: card ? card.querySelectorAll('.mkw-paper').length : 0,
        nets: card ? [...card.querySelectorAll('.mkw-net')].map((el) => el.textContent) : [],
        noScore: card ? !/\d+\/100/.test(card.textContent) : false,
      };
    });
    ok(openCard.present && /pistes sont au sec/.test(openCard.paper) && /#bowling/.test(openCard.paper), 'le papier : UN texte final, hashtags intégrés');
    ok(openCard.oneText === 1 && openCard.noScore, 'jamais de versions empilées, jamais de score sur une proposition');
    ok(openCard.nets.join(',') === 'Facebook,Instagram,Story', 'réseaux du tenant (TikTok/LinkedIn absents)');
    const variant = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-prop.is-open');
      const fb = [...card.querySelectorAll('.mkw-net')].find((el) => el.textContent === 'Facebook');
      fb.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'variante');
      const paper = (document.querySelector('#staffCampaignsPage .mkw-prop.is-open .mkw-paper') || {}).textContent || '';
      return { posted: posts.length, network: posts[0] && posts[0].network, paper };
    });
    ok(variant.posted === 1 && variant.network === 'facebook' && /fraichement écrit/.test(variant.paper), 'réseau non généré → il s\'adapte (POST variante)');
    await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-prop.is-open');
      const copy = [...card.querySelectorAll('button')].find((el) => /Copier le post/.test(el.textContent));
      copy.click();
      await new Promise((r) => setTimeout(r, 250));
    });
    ok(await page.evaluate(() => Boolean(document.querySelector('#staffCampaignsPage .mkw-published-ask'))), 'Copier → bandeau « Publié ? » (jamais publié sur simple copie)');
    const published = await page.evaluate(async () => {
      const yes = [...document.querySelectorAll('#staffCampaignsPage .mkw-published-ask button')].find((el) => /^Oui$/.test(el.textContent.trim()));
      yes.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'publiee');
      return { posted: posts.length, compact: (document.querySelector('#staffCampaignsPage .mkw-prop-published') || {}).textContent || '' };
    });
    ok(published.posted === 1 && /je mesure pendant 14 jours/.test(published.compact), '« Oui » → publiée + carte compactée (la mesure démarre)');

    console.log('\n[DEMANDE] la barre qui survit aux re-renders (le bug focus est mort)');
    const ask = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.focus();
      await new Promise((r) => setTimeout(r, 150));
      const wrap = document.getElementById('mkwAsk');
      const focusVisible = wrap && wrap.classList.contains('is-focused');
      const chips = [...document.querySelectorAll('#staffCampaignsPage .mkw-chip')].map((el) => el.textContent);
      // On tape, puis on force un RE-RENDER complet (clic radar) : le texte
      // doit survivre : c'était le bug bloquant de l'audit (4.1).
      input.value = 'un post pour la soirée fluo de samedi';
      input.dispatchEvent(new Event('input'));
      document.querySelectorAll('.mkw-cell')[2].click();
      await new Promise((r) => setTimeout(r, 300));
      const survived = (document.getElementById('brAskInput') || {}).value || '';
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Demander$/.test(el.textContent.trim()));
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate' && p.brief);
      return { focusVisible, chips, survived, posted: posts.length, brief: posts[0] && posts[0].brief };
    });
    ok(ask.focusVisible, 'le focus révèle les chips SANS re-render (classe, pas innerHTML)');
    ok(ask.chips.length >= 2 && ask.chips.some((chip) => /Idée libre/.test(chip)), 'chips contextuelles présentes');
    ok(ask.survived === 'un post pour la soirée fluo de samedi', 'le texte tapé SURVIT à un re-render complet');
    ok(ask.posted === 1 && /soirée fluo/.test(ask.brief), 'Demander → création avec la phrase du gérant');

    console.log('\n[STUDIO] l\'atelier honnête');
    await go('studio');
    const studio = await page.evaluate(async () => {
      const root = document.getElementById('staffCampaignsPage');
      const tabs = root.querySelectorAll('.mkw-st-bar .mkw-net').length;
      const packsLoaded = (window.__QA_POSTS__ || []).length >= 0; // GET studioPacks est passe par fetch mock
      const igTab = [...root.querySelectorAll('.mkw-st-bar .mkw-net')].find((el) => el.textContent === 'Instagram');
      if (igTab) igTab.click();
      await new Promise((r) => setTimeout(r, 150));
      const brief = document.getElementById('brStudioBrief');
      brief.value = 'anniversaires ados';
      brief.dispatchEvent(new Event('input'));
      const gen = [...root.querySelectorAll('.mkw-st-gen button')].find((el) => /Générer|Régénérer/.test(el.textContent));
      gen.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'studioGenerate');
      const blocks = [...document.querySelectorAll('.mkw-st-block .mkw-st-label')].map((el) => el.textContent);
      const promptEn = /no text, no logos/.test((document.querySelector('.mkw-st-mono') || {}).textContent || '');
      const badge = (document.querySelector('.mkw-st-badge') || {}).textContent || '';
      const craft = (document.querySelector('.mkw-craft') || {}).textContent || '';
      const briefSurvived = (document.getElementById('brStudioBrief') || {}).value || '';
      return { tabs, packsLoaded, posted: posts.length, platform: posts[0] && posts[0].platform, brief: posts[0] && posts[0].brief, blocks: blocks.length, promptEn, badge, craft, briefSurvived };
    });
    ok(studio.tabs === 4, '4 réseaux dans le studio (Facebook/Instagram/TikTok/LinkedIn)');
    ok(studio.posted === 1 && studio.platform === 'instagram' && /ados/.test(studio.brief || ''), 'Générer → POST studioGenerate avec réseau + angle');
    ok(studio.blocks >= 5 && studio.promptEn, 'pack complet : longue/courte/story/hashtags/photo/prompt image (anglais)');
    ok(/note 86\/100/.test(studio.badge) && /écrit par l’IA|écrit par l'IA/.test(studio.badge), 'le badge dit la note ET l\'auteur réel (IA ou filet)');
    ok(/fabrication/.test(studio.craft) && /84/.test(studio.craft) && /86/.test(studio.craft), 'la fabrication réelle est montrée (chaque passage noté)');
    ok(!/je réécris jusqu/.test((await page.evaluate(() => document.getElementById('staffCampaignsPage').textContent))), 'la surpromesse « je réécris jusqu\'à ce que ça passe » est morte');
    ok(studio.briefSurvived === 'anniversaires ados', 'l\'angle tapé survit à la génération');

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
        labels: root.querySelectorAll('.mkw-label').length,
        matin: /chaque matin/.test(root.textContent) && !/chaque nuit/.test(root.textContent),
      };
    });
    ok(rivals.rows >= 1 && rivals.name, 'les concurrents surveillés en cartes');
    ok(rivals.rating, 'la note Google (Places) affichée');
    ok(rivals.signals >= 1, 'offres/prix extraits du site (signaux structurés)');
    ok(/facebook\.com\/ads\/library/.test(rivals.adHref) && /q=Bowling%20Arlon/.test(rivals.adHref), 'lien Meta Ad Library (recherche de leurs pubs, sans scraping)');
    ok(rivals.diff, 'le changement détecté chez le concurrent est remonté');
    ok(rivals.labels >= 2, 'les champs d\'ajout portent de vrais labels (accessibilité)');
    ok(rivals.matin, 'l\'inspection est dite « chaque matin » (le sweep tourne à ~10h15, pas la nuit)');
    const analyze = await page.evaluate(async () => {
      const box = document.getElementById('brCompPost');
      if (!box) return { found: false };
      box.value = 'Mercredi étudiant : -30% sur le bowling pour toute la promo, sur présentation de la carte étudiant.';
      box.dispatchEvent(new Event('input'));
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Analyser$/.test(el.textContent.trim()));
      btn.click();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !document.querySelector('#staffCampaignsPage .mkw-analy, #staffCampaignsPage .mkw-analy-degraded')) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'competitorAnalyzePost');
      const panel = (document.querySelector('#staffCampaignsPage .mkw-analy') || {}).textContent || '';
      const learned = (document.querySelector('#staffCampaignsPage .mkw-analy-learned') || {}).textContent || '';
      const toStudio = [...document.querySelectorAll('#staffCampaignsPage .mkw-analy button')].some((el) => /En faire un post/.test(el.textContent));
      return { found: true, posted: posts.length, hadText: Boolean(posts[0] && posts[0].text), panel, learned, toStudio };
    });
    ok(analyze.found && analyze.posted === 1 && analyze.hadText, 'colle-un-post → POST competitorAnalyzePost avec le texte');
    ok(/étudiants/.test(analyze.panel) && /ambiance/.test(analyze.panel), 'l\'analyse affiche le signal + la riposte');
    ok(/J’ai retenu 2 techniques|J'ai retenu 2 techniques/.test(analyze.learned), 'l\'apprentissage est MONTRÉ (« J\'ai retenu N techniques »)');
    ok(analyze.toStudio, 'la riposte n\'est plus un cul-de-sac : « En faire un post » → Studio');

    console.log('\n[LE PLAN] les 8 semaines, avec leurs poignées');
    await go('plan');
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-plan-week').length > 0, null, { timeout: 8000 }).catch(() => null);
    const plan = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const weeks = [...root.querySelectorAll('.mkw-plan-week')];
      const txt = root.textContent || '';
      return {
        count: weeks.length,
        posted: (window.__QA_POSTS__ || []).filter((p) => p.action === 'marketingPlanGet').length,
        confs: weeks.map((w) => (w.querySelector('.mkw-plan-conf') || {}).textContent || ''),
        tones: weeks.map((w) => w.className),
        goals: weeks.map((w) => (w.querySelector('.mkw-plan-goal') || {}).textContent || ''),
        checks: root.querySelectorAll('.mkw-plan-check').length,
        current: root.querySelectorAll('.mkw-plan-week.is-current').length,
        bridges: [...root.querySelectorAll('button')].filter((b) => /Préparer ce post au Studio/.test(b.textContent)).length,
        freshness: /construit le/.test(txt),
        text: txt,
        rebuild: Boolean([...root.querySelectorAll('button')].find((b) => /Reconstruire le plan/.test(b.textContent))),
      };
    });
    ok(plan.posted === 1, 'ouvrir « Le plan » charge le plan (1 seul appel, pas en boucle)');
    ok(plan.count === 3, `les 3 semaines du plan sont rendues (obtenu ${plan.count})`);
    ok(plan.checks >= 4, 'chaque action porte sa case « C\'est fait » (le plan n\'est plus une image)');
    ok(plan.current === 1, 'la semaine en cours est marquée « cette semaine »');
    ok(plan.bridges >= 3, 'chaque semaine a son pont « Préparer ce post au Studio »');
    ok(plan.freshness, 'la fraîcheur du plan est affichée (« construit le … »)');
    ok(/Foire de Libramont/.test(plan.text), 'le « pourquoi » cite le fait daté réel');
    ok(/Rien de daté/.test(plan.confs.join('|')), 'une semaine sans fait daté est affichée « Rien de daté »');
    ok(/fond de commerce/i.test(plan.goals.join('|')), 'et son objectif renvoie au fond de commerce, sans prétexte inventé');
    ok(plan.tones.some((c) => /tone-muted/.test(c)), 'la semaine « routine » est calme (liseré neutre), pas une alerte');
    ok(plan.tones.some((c) => /tone-info/.test(c)), 'la semaine datée est mise en avant');
    ok(/pas encore assez de recul/i.test(plan.text) && /dates certaines/i.test(plan.text),
      'le plan avoue en tête qu\'il ne sait pas encore ce qui marche ICI (aucune mesure)');
    ok(plan.rebuild, 'le gérant peut reconstruire le plan à la main');
    for (const mot of ['confiance', 'horizon', 'pattern', 'prior', 'déterministe']) {
      ok(!new RegExp(mot, 'i').test(plan.text), `zéro jargon « ${mot} » dans la surface`);
    }
    ok(!new RegExp('[\\u2014\\u2013]').test(plan.text), 'aucun tiret cadratin dans le plan affiché');
    // La poignée : « C'est fait » → planActionDone avec un id conforme au
    // contrat serveur, et l'état devient « noté, je mesure ».
    const done = await page.evaluate(async () => {
      const check = document.querySelector('#staffCampaignsPage .mkw-plan-check:not(.is-done)');
      if (!check) return { found: false };
      check.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'planActionDone');
      const noted = /noté, je mesure/.test(document.getElementById('staffCampaignsPage').textContent);
      return { found: true, posted: posts.length, id: posts[0] && posts[0].planAction && posts[0].planAction.id, noted };
    });
    ok(done.found && done.posted === 1 && /^strategist:/.test(done.id || ''), '« C\'est fait » → planActionDone (id au contrat serveur)');
    ok(done.noted, 'l\'action cochée dit « noté, je mesure » (la boucle J+14 démarre)');
    // Le pont : « Préparer ce post au Studio » ouvre l'atelier pré-rempli.
    const bridge = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage button')].find((b) => /Préparer ce post au Studio/.test(b.textContent));
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        tab: window.mkBrief.tab,
        brief: (document.getElementById('brStudioBrief') || {}).value || '',
      };
    });
    ok(bridge.tab === 'studio' && bridge.brief.length > 5, 'le pont Plan → Studio pré-remplit l\'angle');

    console.log('\n[RÉSULTATS] la maison unique de la preuve');
    await go('results');
    const results = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const rows = [...root.querySelectorAll('.mkw-receipt')];
      return {
        hero: Boolean(root.querySelector('.mkw-hero-num')),
        heroNum: (root.querySelector('.mkw-hero-num') || {}).textContent || '',
        eyebrow: /rapporté/i.test((root.querySelector('.mkw-eyebrow') || {}).textContent || ''),
        cap: (root.querySelector('.mkw-hero-cap') || {}).textContent || '',
        chips: (root.querySelector('.mkw-hero-chips') || {}).textContent || '',
        segs: [...root.querySelectorAll('.mkw-seg-btn')].map((el) => el.textContent.trim()),
        count: rows.length,
        good: rows.some((el) => el.className.includes('tone-good') && /\+18\s?% de monde/.test(el.textContent)),
        neutral: rows.some((el) => el.className.includes('tone-neutral') && /pas d'effet mesurable/.test(el.textContent)),
        pending: rows.some((el) => /verdict le 26 juillet/.test(el.textContent)),
        redo: rows.some((el) => /On le refait \?/.test(el.textContent)),
        verdicts: root.querySelectorAll('.mkw-verdict').length,
        verdictText: (root.querySelector('.mkw-verdicts') || {}).textContent || '',
        patterns: root.querySelectorAll('.mkw-pat').length,
        patternText: (root.querySelector('.mkw-patterns') || {}).textContent || '',
        basis: root.querySelectorAll('.mkw-pat-basis').length,
      };
    });
    ok(results.hero && results.eyebrow && /1[\s  ]?240/.test(results.heroNum), 'le héros € vit ICI, seul exemplaire');
    ok(/réservations liées à tes messages/.test(results.cap), 'libellé exact : des MESSAGES, des réservations liées (pas « publications », pas « venues »)');
    ok(/réservations liées/.test(results.chips) && !/clics avis Google/.test(results.chips), 'les chips ne mélangent plus les clics avis (transactionnels) au ROI');
    ok(results.segs.join(',') === '7 j,30 j,90 j', 'toggles de période 7/30/90');
    ok(results.count === 3 && results.good && results.neutral && results.pending, 'reçus : bon en vert, neutre jamais rouge, verdict à venir');
    ok(results.redo, '« On le refait ? » sur les lignes positives');
    ok(results.verdicts >= 4 && /Samedi/.test(results.verdictText) && /Mardi/.test(results.verdictText), 'les verdicts causaux ont déménagé ici (meilleur/pire jour, météo, vacances)');
    ok(/-6%/.test(results.verdictText) && !/\+-/.test(results.verdictText), 'un effet vacances négatif s\'affiche -6%, jamais « +-6% »');
    ok(results.patterns === 2 && /\+22\s?%|22\s?%/.test(results.patternText), 'mémoire par contexte : ce qui convertit, par effet net');
    ok(results.basis === 1, 'une ligne au delta brut est étiquetée « brut » (l\'en-tête ne ment plus)');
    // Le détail des sources + la méthode honnête (« reçu », pas « vu »).
    await page.evaluate(() => { const l = [...document.querySelectorAll('#staffCampaignsPage .mkw-link')].find((el) => /vient ce chiffre/.test(el.textContent)); if (l) l.click(); });
    await page.waitForTimeout(200);
    const src = await page.evaluate(() => ({
      rows: document.querySelectorAll('#staffCampaignsPage .mkw-src').length,
      method: (document.querySelector('#staffCampaignsPage .mkw-src-panel .mkw-method') || {}).textContent || '',
      extra: (document.querySelector('#staffCampaignsPage .mkw-src-extra') || {}).textContent || '',
    }));
    ok(src.rows >= 2, 'détail des sources (barres)');
    ok(/dernier message que le client a reçu/.test(src.method) && /annulées sont exclues/.test(src.method), 'la méthode dit « reçu » (pas « vu ») et exclut les annulées');
    ok(/emails de suivi post-visite/.test(src.extra), 'les clics avis Google sont affichés avec leur vraie origine (hors ROI)');
    await page.evaluate(() => { [...document.querySelectorAll('.mkw-seg-btn')].find((el) => /7 j/.test(el.textContent)).click(); });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => (window.__QA_ROI_CALLS__ || [])[0]) === '7', 'changer la période → refetch de la paie seule');
    const redo = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .mkw-receipt button')].find((el) => /On le refait/.test(el.textContent));
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
