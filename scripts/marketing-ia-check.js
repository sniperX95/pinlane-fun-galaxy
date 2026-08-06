// Test INTERACTIF du BUREAU Marketing (refonte 2026-08-06, voir
// MARKETING-AGENT-DESIGN.md) : le fil de l'agent (brief + radar integre +
// propositions en tours + reponses assemblees), le composer a DEUX MODES
// (Demander = reponse locale sourcee, Creer = propositionCreate reel), le
// tableau d'actions (A valider / En cours / A surveiller, calme quand vide,
// entree animee d'une action neuve), les deep-links avec intention (veille ->
// Marche avec le concurrent surligne), et LE CENTRE QUI GOUVERNE (bascule de
// centre = remise a zero prouvee). Les profondeurs gardent leurs preuves :
// Plan (poignees planActionDone, honnetete), Creations (badge note+mode,
// fabrication reelle), Marche (veille honnete, ADN retenu), Impact (heros
// euros seul exemplaire, recus, verdicts, memoire par contexte).
// Playwright pilote de VRAIS clics ; chaque section porte sa contre-preuve.
// Cf. lecon ship-interactive-ui-tested + lecon du mock complaisant (entree 93
// du journal) : ce mock REFUSE les actions inconnues au lieu de les tolerer.
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
    window.__QA_BRIEF_CENTERS__ = [];
    // Les creations du gerant VIVENT : un propositionCreate reapparait dans le
    // brief suivant, comme en prod (insert en base -> refetch). Sans ca, le
    // test de l'arrivee animee dans « A valider » serait infalsifiable.
    window.__QA_CREATED__ = [];

    const briefBundle = (centerId) => {
      if (centerId === 'gembloux') {
        // Un centre DIFFERENT rend un brief DIFFERENT : c'est la preuve de
        // scope de la section [CENTRE]. Marqueur textuel unique.
        return {
          ok: true, centerId: 'gembloux', today: dstr(0), generatedAt: new Date().toISOString(),
          networks: ['facebook', 'instagram', 'story'],
          paie: { euros: 0, venues: 0, sent: 0, reviewClicks: 0, days: 30, young: true, quietWindow: false, firstVerdictDate: 'mardi 25 août', sources: [] },
          brief: { text: 'Brief de Gembloux : semaine tranquille, rien d\'urgent, je garde un oeil sur tes réservations.', degraded: false },
          pulse: { revenue30: 0, visitors30: 0, avgBasket: 0, upcomingPax: 0, upcomingResa: 0, reservedRevenue: 0, bestDay: null },
          radar: Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return { date: d.toISOString().slice(0, 10), dow: d.getDay(), level: 'normal', tmax: 18, precipMm: 0, event: '', resaCount: 0, explanation: 'Journée normale attendue.', propositionKey: null }; }),
          dataDays: 8, medianVisitors: 0,
          facts: { bestDay: null, worstDay: null, weather: null, holidayEffectPct: null, holidayEffectConfidence: null, trend4w: null, bestMonth: null },
          patterns: [], propositions: [], receipts: [],
          veille: { count: 0, changed: [] },
        };
      }
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
          // Hygiène de file (bug prod 17/07) : une consigne PÉRIMÉE et un
          // DOUBLON mot pour mot injectés exprès : ils ne doivent JAMAIS
          // s'afficher (le serveur filtre désormais, le front reste le filet).
          { key: 'db:97', id: 97, trigger: 'evenement', why: 'PERIME ne doit pas apparaitre.', whyShort: 'PERIME ne doit pas apparaitre.', dueDate: dstr(-2), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'perime:x' },
          { key: 'db:96', id: 96, trigger: 'chaleur', why: 'JOURVISEPASSE ne doit pas apparaitre.', whyShort: 'JOURVISEPASSE ne doit pas apparaitre.', dueDate: null, targetDate: dstr(-1), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'vise:x' },
          { key: 'db:98', id: 98, trigger: 'pluie', why: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', whyShort: 'Pluie annoncée samedi, les familles vont chercher un plan au sec.', dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: {}, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: 'doublon:x' },
          ...window.__QA_CREATED__,
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
        if (b.action === 'propositionCreate') {
          const id = 990 + window.__QA_CREATED__.length;
          const brief = String(b.brief || '').trim();
          const why = b.trigger === 'creux' && b.targetDate
            ? `Tu m'as demandé de remplir le ${b.targetDate} : voilà ce que je posterais.`
            : `Tu m'as demandé : « ${brief} », voilà ce que je posterais.`;
          window.__QA_CREATED__.push({ key: `db:${id}`, id, trigger: b.trigger === 'creux' ? 'creux' : 'demande', why, whyShort: why, dueDate: dstr(1), kind: 'post', pinned: false, network: 'facebook', networks: { facebook: { text: `Post prêt : ${brief || b.targetDate}.` } }, photoIdea: '', imagePrompt: '', bestSlot: '', status: 'proposed', signature: `qa:${id}` });
          return J({ ok: true, result: { ok: true, id } });
        }
        if (b.action === 'insightRedo') return J({ ok: true, insight: { id: 99, status: 'proposed' } });
        if (b.action === 'planActionDone') return J({ ok: true, result: { ok: true, id: 55, status: 'applied' } });
        if (b.action === 'competitorSave') return J({ ok: true, result: { ok: true, id: 2 } });
        if (b.action === 'competitorDelete') return J({ ok: true, result: { ok: true, id: 1 } });
        if (b.action === 'competitorAnalyzePost') return J({ ok: true, degraded: false, resume: 'Ils poussent une offre étudiants le mercredi.', offre: 'Mercredi étudiant -30%', prix: '9 €', ton: 'promo prix', riposte: 'Mets en avant ton ambiance et tes anniversaires plutôt que le prix.', adn: [{ nom: 'creneau precis', regle: 'Annoncer un créneau précis rend l\'offre concrète.' }, { nom: 'urgence datee', regle: 'Une échéance datée déclenche la décision.' }], dnaLearned: 2 });
        if (b.action === 'studioGenerate') return J({ ok: true, pack: { platform: b.platform, theme: 'Foire de Libramont', generationMode: 'ai', long: `Post ${b.platform} complet pour le test.`, short: `Court ${b.platform}.`, story: 'Story test.', photoIdea: 'Filmer un strike.', aiImagePrompt: 'Bowling scene, no text, no logos', hashtags: ['#bowling', '#test'], bestTime: '18h', quality: { score: 86, status: 'ready', iterations: [{ mode: 'rules', score: 84 }, { mode: 'ai_1', score: 86, blocked: false }] } } });
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
        // Leçon du mock complaisant (journal 93) : une action que le serveur ne
        // connaît pas reçoit une ERREUR, jamais un ok de complaisance.
        return J({ ok: false, error: `Action Ops inconnue du mock : ${b.action}` });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'marketingBrief') {
        const centerId = u.searchParams.get('centerId') || 'libramont';
        window.__QA_BRIEF_CENTERS__.push(centerId);
        return J(briefBundle(centerId));
      }
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
    // LE BUREAU : fil + tableau + composer, radar 14 cellules DANS le fil.
    await page.waitForFunction(() => document.querySelector('#staffCampaignsPage .mkw-desk .mkw-fil') && document.querySelector('#staffCampaignsPage .mkw-board') && document.querySelector('#staffCampaignsPage .mkw-composer'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-fil .mkw-cell').length >= 14, null, { timeout: 15000 });
    await page.waitForTimeout(400);

    // Captures optionnelles (PINLANE_MK_SHOTS=<dossier>) : REGARDER le bureau
    // au lieu de le deviner, meme harnais que les gates emails et crm.
    if (process.env.PINLANE_MK_SHOTS) {
      const shotDir = process.env.PINLANE_MK_SHOTS;
      fs.mkdirSync(shotDir, { recursive: true });
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(450);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: require('path').join(shotDir, `marketing-${theme}-desktop.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: require('path').join(shotDir, `marketing-${theme}-mobile.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.evaluate(() => { setStaffTheme('dark'); });
      await page.waitForTimeout(300);
      console.log(`[SHOTS] captures ecrites dans ${shotDir}`);
    }

    console.log('\n[HYGIENE] le bureau : identite, rail 4 profondeurs, zero theatre, zero jargon');
    let allText = '';
    for (const tab of ['feed', 'plan', 'studio', 'rivals', 'results']) {
      await go(tab);
      allText += ' ' + await page.evaluate(() => (document.getElementById('staffCampaignsPage').textContent || '').toLowerCase());
    }
    await go('feed');
    const banned = ['attribution', 'last-touch', 'baseline', 'médiane', 'itération', 'insight', 'proposition volatile', 'signature'].filter((word) => allText.includes(word));
    const hygiene = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      return {
        nav: [...root.querySelectorAll('.mkw-rail-link')].map((el) => el.textContent.trim()),
        railHome: root.querySelectorAll('.mkw-rail-home').length,
        theatre: root.querySelectorAll('.mkw-turn-avatar, .mkw-bubble, .mkw-thinking, .mkw-fold, .mkw-suggest, .mkw-cmd-bar').length,
        desk: Boolean(root.querySelector('.mkw-desk .mkw-fil') && root.querySelector('.mkw-desk .mkw-board')),
        composerInFil: Boolean(root.querySelector('.mkw-fil .mkw-composer #brAskInput')),
        modes: [...root.querySelectorAll('.mkw-modes .mkw-mode')].map((el) => el.textContent.trim()),
        title: (root.querySelector('.mkw-head-title') || {}).textContent || '',
        desc: (root.querySelector('.mkw-head-desc') || {}).textContent || '',
        refresh: [...root.querySelectorAll('button')].filter((el) => /actualiser|analyser maintenant/i.test(el.textContent)).length,
        kpis: root.querySelectorAll('.mkw-kpi, .mkw-counters, .pv2-stat').length,
        heroInFil: root.querySelectorAll('.mkw-fil .mkw-hero').length,
      };
    });
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' -> ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(hygiene.nav.join('|') === 'Plan|Créations|Marché|Impact', `rail = 4 profondeurs, rien d'autre (${hygiene.nav.join(', ')})`);
    ok(hygiene.railHome === 0, 'le bureau n\'est PAS un onglet : aucune entree « maison » dans le rail');
    ok(hygiene.desk && hygiene.composerInFil, 'la grille du bureau : le fil a gauche, le tableau a droite, le composer dans le fil');
    ok(hygiene.modes.join('|') === 'Demander|Créer', `le composer porte ses DEUX modes (${hygiene.modes.join(', ')})`);
    ok(hygiene.theatre === 0, `ZERO theatre : ni avatar, ni bulle decorative, ni indicateur de pensee, ni pli (obtenu ${hygiene.theatre})`);
    ok(hygiene.title === 'Marketing' && /rien ne part tout seul/i.test(hygiene.desc) && /Fun Galaxy Libramont/.test(hygiene.desc), 'l\'en-tete dit l\'identite, LE CENTRE et la promesse de validation');
    ok(hygiene.refresh === 0, 'zero bouton Actualiser/Analyser : le travail se fait chaque matin');
    ok(banned.length === 0, `zero jargon interne a l'ecran${banned.length ? ' (trouve : ' + banned.join(', ') + ')' : ''}`);
    ok(hygiene.kpis === 0, 'plus aucune rangee de compteurs muets : le tableau d\'actions porte l\'etat');
    ok(hygiene.heroInFil === 0, 'le heros EUR ne vit PAS dans le fil (une seule maison : Impact)');

    console.log('\n[FIL] le brief du matin, radar integre, veille inline, pointeur Impact');
    const fil = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const brief = root.querySelector('.mkw-turn-brief');
      return {
        briefTurn: Boolean(brief),
        text: (brief && brief.querySelector('.mkw-brief-text') || {}).textContent || '',
        nums: brief ? brief.querySelectorAll('.mkw-brief-text .br-num').length : 0,
        radarInBrief: brief ? brief.querySelectorAll('.mkw-cell').length : 0,
        veilleToggle: Boolean(brief && brief.querySelector('.mkw-ctx-toggle')),
        impact: [...(brief ? brief.querySelectorAll('.mkw-ctx-line') : [])].map((el) => el.textContent).join(' '),
      };
    });
    ok(fil.briefTurn && /préparé/.test(fil.text) && /Bowling Arlon/.test(fil.text), 'le tour d\'ouverture : vu + prepare + veille');
    ok(fil.nums >= 1, 'prose-preuve : les nombres du brief en mono');
    ok(fil.radarInBrief === 14, `le radar 14 jours vit DANS le tour du brief (${fil.radarInBrief} cellules)`);
    ok(/1[\s  ]?240/.test(fil.impact) && /Voir Impact/.test(fil.impact), 'le pointeur Impact : la ligne compacte + le chemin (jamais un second heros)');
    const veille = await page.evaluate(async () => {
      document.querySelector('#staffCampaignsPage .mkw-ctx-toggle').click();
      await new Promise((r) => setTimeout(r, 250));
      const body = document.querySelector('#staffCampaignsPage .mkw-ctx-body');
      return { open: Boolean(body), text: body ? body.textContent : '' };
    });
    ok(veille.open && /offre étudiants/.test(veille.text) && /Voir dans Marché/.test(veille.text), 'la veille se deploie INLINE dans le fil, avec le chemin vers Marché');

    console.log('\n[RADAR] explication au clic, valeur du creux, « Prépare-moi un post »');
    await page.evaluate(() => { document.querySelectorAll('#staffCampaignsPage .mkw-cell')[4].click(); });
    await page.waitForTimeout(250);
    const explain = await page.evaluate(() => (document.querySelector('#staffCampaignsPage .mkw-radar-explain') || {}).textContent || '');
    ok(/très calme attendu/.test(explain) && /Voir la proposition/.test(explain), 'clic cellule creux -> explication + lien vers la proposition');
    ok(/panier moyen mesuré/.test(explain) && /15\s?€/.test(explain), 'la valeur du creux en euros (panier mesure, pas une projection)');
    await page.evaluate(() => { document.querySelectorAll('#staffCampaignsPage .mkw-cell')[9].click(); });
    await page.waitForTimeout(250);
    const fill = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#staffCampaignsPage .mkw-radar-explain button')].find((el) => /Prépare-moi un post/.test(el.textContent));
      if (!btn) return { found: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate');
      return { found: true, posted: posts.length, trigger: posts[0] && posts[0].trigger };
    });
    ok(fill.found && fill.posted === 1 && fill.trigger === 'creux', 'jour calme -> « Prepare-moi un post » -> creation reelle');
    await page.waitForFunction(() => !window.mkBrief.busy, null, { timeout: 8000 });
    await page.waitForTimeout(300);

    console.log('\n[TOURS] les propositions sont des tours ; une demande rend le tour du gerant');
    const tours = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const turns = [...root.querySelectorAll('.mkw-fil > .mkw-turn, .mkw-fil > .mkw-turn-prop')];
      const userTurns = [...root.querySelectorAll('.mkw-fil .mkw-turn.is-user .mkw-turn-user-body')].map((el) => el.textContent.trim());
      const props = [...root.querySelectorAll('.mkw-fil .mkw-prop .mkw-prop-why')].map((el) => el.textContent);
      // La demande db:22 doit produire : tour gerant (« soirée fluo ») PUIS la carte.
      const userIdx = turns.findIndex((el) => el.classList.contains('is-user') && /soirée fluo/.test(el.textContent));
      const cardIdx = turns.findIndex((el) => /voilà ce que je posterais/.test(el.textContent) && el.classList.contains('mkw-turn-prop'));
      return { userTurns, props: props.length, order: userIdx >= 0 && cardIdx > userIdx, txt: root.querySelector('.mkw-fil').textContent };
    });
    ok(tours.userTurns.some((t) => t === 'soirée fluo'), 'la demande du gerant est SON tour, sa phrase citee depuis l\'objet serveur');
    ok(tours.order, 'l\'ordre du dialogue est tenu : le tour du gerant PUIS la reponse de l\'agent');
    ok(tours.props >= 4, `les propositions du matin sont toutes des tours (${tours.props})`);
    ok(!/PERIME/.test(tours.txt) && !/JOURVISEPASSE/.test(tours.txt), 'hygiene de file : perimee et visee-passee ne s\'affichent JAMAIS');
    ok((tours.txt.match(/Pluie annoncée samedi, les familles/g) || []).length === 1, 'le meme conseil mot pour mot ne s\'affiche qu\'une fois');

    console.log('\n[ATELIER] ouvrir, adapter au reseau, copier, « Publié ? » = la seule porte');
    await page.evaluate(async () => {
      const card = [...document.querySelectorAll('#staffCampaignsPage .mkw-fil .mkw-prop')][0];
      [...card.querySelectorAll('button')].find((el) => /Voir le post/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 300));
    });
    const openCard = await page.evaluate(() => {
      const card = document.querySelector('#staffCampaignsPage .mkw-fil .mkw-prop.is-open');
      return {
        present: Boolean(card),
        paper: (card && card.querySelector('.mkw-paper') || {}).textContent || '',
        nets: card ? [...card.querySelectorAll('.mkw-net')].map((el) => el.textContent) : [],
        noScore: card ? !/\d+\/100/.test(card.textContent) : false,
      };
    });
    ok(openCard.present && /pistes sont au sec/.test(openCard.paper), 'l\'atelier s\'ouvre dans le fil : le texte final pret a copier');
    ok(openCard.nets.join(',') === 'Facebook,Instagram,Story' && openCard.noScore, 'reseaux du tenant, jamais de score interne');
    const variant = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-fil .mkw-prop.is-open');
      [...card.querySelectorAll('.mkw-net')].find((el) => el.textContent === 'Facebook').click();
      await new Promise((r) => setTimeout(r, 500));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'variante');
      const paper = (document.querySelector('#staffCampaignsPage .mkw-fil .mkw-prop.is-open .mkw-paper') || {}).textContent || '';
      return { posted: posts.length, network: posts[0] && posts[0].network, paper };
    });
    ok(variant.posted === 1 && variant.network === 'facebook' && /fraichement écrit/.test(variant.paper), 'reseau non genere -> il s\'adapte (POST variante)');
    await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-fil .mkw-prop.is-open');
      [...card.querySelectorAll('button')].find((el) => /Copier le post/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 250));
    });
    ok(await page.evaluate(() => Boolean(document.querySelector('#staffCampaignsPage .mkw-published-ask'))), 'Copier -> bandeau « Publie ? » (jamais publie sur simple copie)');
    const published = await page.evaluate(async () => {
      [...document.querySelectorAll('#staffCampaignsPage .mkw-published-ask button')].find((el) => /^Oui$/.test(el.textContent.trim())).click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionAction' && p.propAction === 'publiee');
      return { posted: posts.length, compact: (document.querySelector('#staffCampaignsPage .mkw-prop-published') || {}).textContent || '' };
    });
    ok(published.posted === 1 && /la mesure court 14 jours/.test(published.compact), '« Oui » -> publiee + carte compactee (la mesure demarre)');

    console.log('\n[COMPOSER] deux contrats : Créer prepare un livrable reel, la frappe survit');
    const compose = await page.evaluate(async () => {
      // Mode Créer par defaut ; la frappe doit survivre a un re-render complet.
      const input = document.getElementById('brAskInput');
      input.focus();
      input.value = 'un post pour la soirée fluo de samedi';
      input.dispatchEvent(new Event('input'));
      document.querySelectorAll('#staffCampaignsPage .mkw-cell')[2].click();
      await new Promise((r) => setTimeout(r, 300));
      const survived = (document.getElementById('brAskInput') || {}).value || '';
      const focusAlive = document.activeElement && document.activeElement.id === 'brAskInput';
      const boardBefore = document.querySelectorAll('#staffCampaignsPage .mkw-board .mkw-bcard').length;
      [...document.querySelectorAll('#staffCampaignsPage .mkw-composer-send')].find((el) => /Préparer/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 700));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'propositionCreate' && p.brief);
      const cards = [...document.querySelectorAll('#staffCampaignsPage .mkw-board .mkw-bcard')];
      const fresh = cards.filter((el) => el.classList.contains('is-new'));
      return {
        survived, focusAlive,
        posted: posts.length, brief: posts.length ? posts[posts.length - 1].brief : '',
        cleared: (document.getElementById('brAskInput') || {}).value === '',
        boardBefore, boardAfter: cards.length,
        freshCount: fresh.length, freshText: fresh.map((el) => el.textContent).join(' '),
        userTurn: [...document.querySelectorAll('#staffCampaignsPage .mkw-fil .mkw-turn.is-user')].some((el) => /soirée fluo de samedi/.test(el.textContent)),
      };
    });
    ok(compose.survived === 'un post pour la soirée fluo de samedi' && compose.focusAlive, 'le texte tape ET le focus survivent a un re-rendu complet');
    ok(compose.posted === 1 && /soirée fluo/.test(compose.brief), '« Préparer » envoie propositionCreate avec la phrase du gerant');
    ok(compose.cleared, 'l\'envoi vide la ligne');
    ok(compose.boardAfter === compose.boardBefore + 1, `le livrable arrive dans « À valider » (${compose.boardBefore} -> ${compose.boardAfter})`);
    ok(compose.freshCount === 1 && /soirée fluo/.test(compose.freshText), 'l\'action NEUVE porte son entree animee (.is-new), et elle seule');
    ok(compose.userTurn, 'le fil rend le tour du gerant pour sa creation (objet serveur, pas un echo local)');
    const once = await page.evaluate(async () => {
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 200));
      return document.querySelectorAll('#staffCampaignsPage .mkw-bcard.is-new').length;
    });
    ok(once === 0, 'CONTRE-PREUVE : l\'entree ne joue qu\'UNE fois (plus aucune .is-new au paint suivant)');

    console.log('\n[DEMANDER] la reponse est assemblee du bundle, sourcee, et sait dire « je ne sais pas »');
    const asked = await page.evaluate(async () => {
      window.mkwMode('demander');
      await new Promise((r) => setTimeout(r, 150));
      const chip = [...document.querySelectorAll('#staffCampaignsPage .mkw-chip-suggest')].find((el) => /Remplir/.test(el.textContent));
      if (chip) chip.click();
      await new Promise((r) => setTimeout(r, 200));
      const filled = (document.getElementById('brAskInput') || {}).value || '';
      const postsBefore = (window.__QA_POSTS__ || []).length;
      [...document.querySelectorAll('#staffCampaignsPage .mkw-composer-send')].find((el) => /Demander/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      const answer = document.querySelector('#staffCampaignsPage .mkw-turn-answer:last-of-type');
      return {
        filled,
        postsDelta: (window.__QA_POSTS__ || []).length - postsBefore,
        answer: answer ? answer.textContent : '',
        actions: answer ? [...answer.querySelectorAll('button')].map((el) => el.textContent.trim()) : [],
        source: (answer && answer.querySelector('.mkw-ans-src') || {}).textContent || '',
      };
    });
    ok(/^Comment remplir/.test(asked.filled), 'la suggestion remplit la question ET bascule le mode');
    ok(asked.postsDelta === 0, 'CONTRE-PREUVE : une question ne declenche AUCUN appel serveur (reponse locale)');
    ok(/très calme attendu/.test(asked.answer), 'la reponse cite l\'explication REELLE du radar (phrase serveur)');
    ok(/panier moyen mesuré/.test(asked.answer) && /15/.test(asked.answer), 'et la valeur du creux vient du panier MESURE du bundle');
    ok(/assemblé/.test(asked.source), 'la SOURCE de la reponse est dite a l\'ecran');
    ok(asked.actions.some((a) => /Voir la proposition|Prépare-moi un post/.test(a)), 'la reponse porte une action REELLE');
    const unknown = await page.evaluate(async () => {
      const input = document.getElementById('brAskInput');
      input.value = 'quelle est la capitale du danemark';
      input.dispatchEvent(new Event('input'));
      const postsBefore = (window.__QA_POSTS__ || []).length;
      window.mkwSend();
      await new Promise((r) => setTimeout(r, 300));
      const answers = document.querySelectorAll('#staffCampaignsPage .mkw-turn-answer');
      const last = answers[answers.length - 1];
      return { text: last ? last.textContent : '', postsDelta: (window.__QA_POSTS__ || []).length - postsBefore };
    });
    ok(/Je ne sais pas encore analyser ça librement/.test(unknown.text) && unknown.postsDelta === 0,
      'question hors perimetre -> l\'agent DIT qu\'il ne sait pas, n\'invente rien, n\'appelle rien');

    console.log('\n[TABLEAU] trois groupes honnetes, chaque rangee est reelle');
    const board = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const groups = [...root.querySelectorAll('.mkw-bgroup')];
      const heads = groups.map((g) => (g.querySelector('h3') || {}).textContent || '');
      const validate = groups[0] ? groups[0].textContent : '';
      const running = groups[1] ? groups[1].textContent : '';
      const watch = groups[2] ? groups[2].textContent : '';
      return {
        heads,
        badge: (groups[0] && groups[0].querySelector('.mkw-bcount') || {}).textContent || '',
        facts: (groups[0] && [...groups[0].querySelectorAll('.mkw-bcard')] || []).every((el) => /Voir les faits/.test(el.textContent)),
        pending: /verdict le 26 juillet/.test(running),
        watchCreux: /calme/.test(watch),
        watchArlon: /Bowling Arlon a bougé/.test(watch),
        watchFoire: /Foire de Libramont/.test(watch),
        noLearning: !/J'apprends encore/.test(watch),
      };
    });
    ok(board.heads.join('|') === 'À valider|En cours|À surveiller', `les trois groupes du tableau (${board.heads.join(', ')})`);
    ok(Number(board.badge) >= 4 && board.facts, 'chaque carte « À valider » compte et porte « Voir les faits »');
    ok(board.pending, '« En cours » = la mesure J+14 REELLE (verdict date), pas un spinner inventé');
    ok(board.watchCreux && board.watchArlon && board.watchFoire, '« À surveiller » : jour calme + concurrent + evenement, tous reels');
    ok(board.noLearning, 'CONTRE-PREUVE : a 210 j de recul, AUCUNE ligne « j\'apprends encore » (elle serait fausse)');
    const goFacts = await page.evaluate(async () => {
      const card = document.querySelector('#staffCampaignsPage .mkw-board .mkw-bcard');
      const why = (card.querySelector('.mkw-bcard-why') || {}).textContent || '';
      card.click();
      await new Promise((r) => setTimeout(r, 400));
      const open = document.querySelector('#staffCampaignsPage .mkw-fil .mkw-prop.is-open');
      return { why, opened: Boolean(open), match: open ? open.textContent.includes(why.slice(0, 30)) : false };
    });
    ok(goFacts.opened && goFacts.match, '« Voir les faits » ouvre LA carte du fil (meme objet, pas une copie)');
    const calm = await page.evaluate(async () => {
      const saved = JSON.stringify(window.mkBrief.data);
      const b = window.mkBrief.data;
      b.propositions = [];
      b.receipts = [];
      b.veille = { count: 0, changed: [] };
      b.radar = b.radar.map((d) => ({ ...d, level: 'normal', event: '' }));
      window.mkBrief.published = {};
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 250));
      const empties = document.querySelectorAll('#staffCampaignsPage .mkw-bempty').length;
      const fake = document.querySelectorAll('#staffCampaignsPage .mkw-bcard, #staffCampaignsPage .mkw-brow').length;
      window.mkBrief.data = JSON.parse(saved);
      window.renderStaffCampaignsPage();
      await new Promise((r) => setTimeout(r, 250));
      return { empties, fake };
    });
    ok(calm.empties >= 2 && calm.fake <= 1, `CONTRE-PREUVE : sans rien a faire, le tableau est CALME (${calm.empties} lignes vides honnetes, ${calm.fake} rangee(s))`);

    console.log('\n[CENTRE] le centre selectionne gouverne TOUT : bascule = remise a zero');
    const scope = await page.evaluate(async () => {
      state.adminCenterId = 'gembloux';
      window.renderStaffCampaignsPage();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !/Brief de Gembloux/.test((document.querySelector('#staffCampaignsPage .mkw-brief-text') || {}).textContent || '')) {
        await new Promise((r) => setTimeout(r, 80));
      }
      const text = (document.querySelector('#staffCampaignsPage .mkw-brief-text') || {}).textContent || '';
      const centers = [...(window.__QA_BRIEF_CENTERS__ || [])];
      const thread = window.mkw.thread.length;
      const learning = /J'apprends encore/.test(document.querySelector('#staffCampaignsPage .mkw-board').textContent);
      state.adminCenterId = 'libramont';
      window.renderStaffCampaignsPage();
      const back = Date.now() + 6000;
      while (Date.now() < back && !/Bowling Arlon/.test((document.querySelector('#staffCampaignsPage .mkw-turn-brief') || {}).textContent || '')) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return { text, centers, thread, learning, restored: /Bowling Arlon/.test((document.querySelector('#staffCampaignsPage .mkw-turn-brief') || {}).textContent || '') };
    });
    ok(/Brief de Gembloux/.test(scope.text), 'basculer de centre RECHARGE le brief du bon centre (plus jamais la data d\'un autre)');
    ok(scope.centers.includes('gembloux'), `le fetch porte le centre selectionne (${scope.centers.join(' -> ')})`);
    ok(scope.thread === 0, 'les tours de session meurent avec le changement de centre');
    ok(scope.learning, 'a 8 j de donnees, le tableau DIT « j\'apprends encore » (l\'honnetete suit le centre)');
    ok(scope.restored, 'le retour a Libramont restaure son bureau');

    console.log('\n[PLAN] les semaines, leurs poignees, l\'honnetete');
    await go('plan');
    await page.waitForFunction(() => document.querySelectorAll('#staffCampaignsPage .mkw-plan-week').length > 0, null, { timeout: 8000 }).catch(() => null);
    const plan = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const weeks = [...root.querySelectorAll('.mkw-plan-week')];
      const txt = root.textContent || '';
      return {
        count: weeks.length,
        confs: weeks.map((w) => (w.querySelector('.mkw-plan-conf') || {}).textContent || ''),
        goals: weeks.map((w) => (w.querySelector('.mkw-plan-goal') || {}).textContent || ''),
        checks: root.querySelectorAll('.mkw-plan-check').length,
        current: root.querySelectorAll('.mkw-plan-week.is-current').length,
        bridges: [...root.querySelectorAll('button')].filter((b) => /Préparer ce post au Studio/.test(b.textContent)).length,
        freshness: /construit le/.test(txt),
        back: [...root.querySelectorAll('.mkw-back')].map((b) => b.textContent.trim()).join(''),
        text: txt,
      };
    });
    ok(plan.count === 3, `les semaines du plan sont rendues (${plan.count})`);
    ok(plan.checks >= 3 && plan.current === 1 && plan.bridges >= 2, 'poignees « C\'est fait », semaine courante marquee, ponts vers Créations');
    ok(plan.freshness && /Foire de Libramont/.test(plan.text), 'fraicheur affichee + le pourquoi cite le fait date reel');
    ok(/Rien de daté/.test(plan.confs.join('|')) && /fond de commerce/i.test(plan.goals.join('|')), 'une semaine sans fait date est dite « Rien de daté », fond de commerce assume');
    ok(/pas encore assez de recul/i.test(plan.text) && /dates certaines/i.test(plan.text), 'le plan avoue qu\'il ne sait pas encore ce qui marche ICI');
    ok(/Retour au bureau/.test(plan.back), 'la profondeur porte son retour explicite vers le bureau');
    for (const mot of ['confiance', 'horizon', 'pattern', 'prior', 'déterministe']) {
      ok(!new RegExp(mot, 'i').test(plan.text), `zero jargon « ${mot} » dans la surface`);
    }
    ok(!new RegExp('[\\u2014\\u2013]').test(plan.text), 'aucun tiret cadratin dans le plan affiche');
    const done = await page.evaluate(async () => {
      const check = document.querySelector('#staffCampaignsPage .mkw-plan-check:not(.is-done)');
      if (!check) return { found: false };
      check.click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'planActionDone');
      return { found: true, posted: posts.length, id: posts[0] && posts[0].planAction && posts[0].planAction.id, noted: /noté, je mesure/.test(document.getElementById('staffCampaignsPage').textContent) };
    });
    ok(done.found && done.posted === 1 && /^strategist:/.test(done.id || '') && done.noted, '« C\'est fait » -> planActionDone + « noté, je mesure »');
    const bridge = await page.evaluate(async () => {
      [...document.querySelectorAll('#staffCampaignsPage button')].find((b) => /Préparer ce post au Studio/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      return { tab: window.mkBrief.tab, brief: (document.getElementById('brStudioBrief') || {}).value || '' };
    });
    ok(bridge.tab === 'studio' && bridge.brief.length > 5, 'le pont Plan -> Créations pre-remplit l\'angle');

    console.log('\n[CRÉATIONS] l\'atelier honnete');
    const studio = await page.evaluate(async () => {
      const root = document.getElementById('staffCampaignsPage');
      const tabs = root.querySelectorAll('.mkw-st-bar .mkw-net').length;
      const igTab = [...root.querySelectorAll('.mkw-st-bar .mkw-net')].find((el) => el.textContent === 'Instagram');
      if (igTab) igTab.click();
      await new Promise((r) => setTimeout(r, 150));
      const brief = document.getElementById('brStudioBrief');
      brief.value = 'anniversaires ados';
      brief.dispatchEvent(new Event('input'));
      [...root.querySelectorAll('.mkw-st-gen button')].find((el) => /Générer|Régénérer/.test(el.textContent)).click();
      await new Promise((r) => setTimeout(r, 400));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'studioGenerate');
      return {
        tabs, posted: posts.length, platform: posts[0] && posts[0].platform, brief: posts[0] && posts[0].brief,
        blocks: [...document.querySelectorAll('.mkw-st-block .mkw-st-label')].length,
        promptEn: /no text, no logos/.test((document.querySelector('.mkw-st-mono') || {}).textContent || ''),
        badge: (document.querySelector('.mkw-st-badge') || {}).textContent || '',
        craft: (document.querySelector('.mkw-craft') || {}).textContent || '',
        briefSurvived: (document.getElementById('brStudioBrief') || {}).value || '',
      };
    });
    ok(studio.tabs === 4, '4 reseaux dans Créations');
    ok(studio.posted === 1 && studio.platform === 'instagram' && /ados/.test(studio.brief || ''), 'Générer -> POST studioGenerate avec reseau + angle');
    ok(studio.blocks >= 5 && studio.promptEn, 'pack complet : longue/courte/story/hashtags/photo/prompt image (anglais)');
    ok(/note 86\/100/.test(studio.badge) && /écrit par l’IA|écrit par l'IA/.test(studio.badge), 'le badge dit la note ET l\'auteur reel');
    ok(/comment il s’est fait|comment il s'est fait/.test(studio.craft) && /84/.test(studio.craft) && /86/.test(studio.craft), 'la fabrication reelle est montree');
    ok(studio.briefSurvived === 'anniversaires ados', 'l\'angle tape survit a la generation');

    console.log('\n[MARCHÉ] la veille honnete + le deep-link avec intention');
    await go('rivals');
    await page.waitForTimeout(400);
    const rivals = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const adlink = root.querySelector('.mkw-riv-adlink');
      return {
        rows: root.querySelectorAll('.mkw-riv').length,
        name: /Bowling Arlon/.test(root.textContent),
        rating: /4[.,]2/.test(root.textContent) && /avis/.test(root.textContent),
        signals: root.querySelectorAll('.mkw-riv-sig').length,
        adHref: adlink ? adlink.getAttribute('href') : '',
        labels: root.querySelectorAll('.mkw-label').length,
        matin: /chaque matin/.test(root.textContent) && !/chaque nuit/.test(root.textContent),
      };
    });
    ok(rivals.rows >= 1 && rivals.name && rivals.rating, 'les concurrents surveilles, note Google affichee');
    ok(rivals.signals >= 1 && /facebook\.com\/ads\/library/.test(rivals.adHref), 'signaux structures + lien Meta Ad Library');
    ok(rivals.labels >= 2 && rivals.matin, 'labels d\'accessibilite + « chaque matin » (verite du cron)');
    const analyze = await page.evaluate(async () => {
      const box = document.getElementById('brCompPost');
      box.value = 'Mercredi étudiant : -30% sur le bowling pour toute la promo, sur présentation de la carte étudiant.';
      box.dispatchEvent(new Event('input'));
      [...document.querySelectorAll('#staffCampaignsPage button')].find((el) => /^Analyser$/.test(el.textContent.trim())).click();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !document.querySelector('#staffCampaignsPage .mkw-analy, #staffCampaignsPage .mkw-analy-degraded')) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'competitorAnalyzePost');
      return {
        posted: posts.length,
        panel: (document.querySelector('#staffCampaignsPage .mkw-analy') || {}).textContent || '',
        learned: (document.querySelector('#staffCampaignsPage .mkw-analy-learned') || {}).textContent || '',
        toStudio: [...document.querySelectorAll('#staffCampaignsPage .mkw-analy button')].some((el) => /En faire un post/.test(el.textContent)),
      };
    });
    ok(analyze.posted === 1 && /ambiance/.test(analyze.panel), 'colle-un-post -> analyse + riposte');
    ok(/J’ai retenu 2 techniques|J'ai retenu 2 techniques/.test(analyze.learned) && analyze.toStudio, 'l\'apprentissage est MONTRE + pont vers Créations');
    // Le deep-link avec intention : depuis le bureau, la veille ouvre Marché
    // avec LE concurrent surligne.
    const intent = await page.evaluate(async () => {
      window.mkwTab('feed');
      await new Promise((r) => setTimeout(r, 300));
      window.mkwGoRival('Bowling Arlon');
      await new Promise((r) => setTimeout(r, 500));
      const focus = document.querySelector('#staffCampaignsPage .mkw-riv.is-focus');
      return { tab: window.mkBrief.tab, focused: Boolean(focus), name: focus ? focus.getAttribute('data-riv-name') : '' };
    });
    ok(intent.tab === 'rivals' && intent.focused && intent.name === 'Bowling Arlon', 'veille -> Marché : LE concurrent arrive surligne (intention conservee)');

    console.log('\n[IMPACT] la maison unique de la preuve');
    await go('results');
    const results = await page.evaluate(() => {
      const root = document.getElementById('staffCampaignsPage');
      const rows = [...root.querySelectorAll('.mkw-receipt')];
      return {
        heroNum: (root.querySelector('.mkw-hero-num') || {}).textContent || '',
        eyebrow: /rapporté/i.test((root.querySelector('.mkw-eyebrow') || {}).textContent || ''),
        cap: (root.querySelector('.mkw-hero-cap') || {}).textContent || '',
        segs: [...root.querySelectorAll('.mkw-seg-btn')].map((el) => el.textContent.trim()),
        count: rows.length,
        good: rows.some((el) => el.className.includes('tone-good') && /\+18\s?% de monde/.test(el.textContent)),
        pending: rows.some((el) => /verdict le 26 juillet/.test(el.textContent)),
        redo: rows.some((el) => /On le refait \?/.test(el.textContent)),
        verdicts: root.querySelectorAll('.mkw-verdict').length,
        verdictText: (root.querySelector('.mkw-verdicts') || {}).textContent || '',
        patterns: root.querySelectorAll('.mkw-pat').length,
        basis: root.querySelectorAll('.mkw-pat-basis').length,
      };
    });
    ok(results.eyebrow && /1[\s  ]?240/.test(results.heroNum), 'le heros EUR vit ICI, seul exemplaire');
    ok(/visites honorées liées à tes messages/.test(results.cap), 'libelle exact : des MESSAGES et des VISITES HONOREES');
    ok(results.segs.join(',') === '7 j,30 j,90 j', 'toggles de periode 7/30/90');
    ok(results.count === 3 && results.good && results.pending && results.redo, 'recus : bon en vert, verdict a venir, « On le refait ? »');
    ok(results.verdicts >= 4 && /-6%/.test(results.verdictText) && !/\+-/.test(results.verdictText), 'verdicts causaux, signe honnete (-6%, jamais +-6%)');
    ok(results.patterns === 2 && results.basis === 1, 'memoire par contexte, ligne brute etiquetee « brut »');
    await page.evaluate(() => { const l = [...document.querySelectorAll('#staffCampaignsPage .mkw-link')].find((el) => /vient ce chiffre/.test(el.textContent)); if (l) l.click(); });
    await page.waitForTimeout(200);
    const src = await page.evaluate(() => ({
      rows: document.querySelectorAll('#staffCampaignsPage .mkw-src').length,
      method: (document.querySelector('#staffCampaignsPage .mkw-src-panel .mkw-method') || {}).textContent || '',
    }));
    ok(src.rows >= 2 && /dernier message reçu/.test(src.method) && /annulées/.test(src.method), 'sources detaillees + methode honnete (recu, exclusions dites)');
    await page.evaluate(() => { [...document.querySelectorAll('.mkw-seg-btn')].find((el) => /7 j/.test(el.textContent)).click(); });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => (window.__QA_ROI_CALLS__ || [])[0]) === '7', 'changer la periode -> refetch de la paie seule');

    console.log('\n[EMAILS] les campagnes ont demenage');
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
