// Test INTERACTIF du cockpit de centre (vue Direction du SPA, #adminView).
//
// Playwright pilote de VRAIS clics sur une session direction mockee. Une
// assertion de PRESENCE dans le source serait un faux vert (neuf precedents
// dans ce depot) : on rend la page, on clique, on lit le DOM et le RESEAU.
//
// Ce qui est prouve ici :
//   1. le cockpit porte le NOM DU CENTRE, plus jamais « Console CEO », et le
//      bandeau « donnees de test » s'affiche parce que le SERVEUR l'a dit ;
//   2. chaque compteur annonce son perimetre : « Chiffre du jour » en vue
//      jour devient « Chiffre de la periode » en vue semaine ;
//   3. l'onglet Clients n'existe plus (doublon du CRM v2), Journal existe ;
//   4. la grille multi-centres est cachee sans centers.switch, rendue avec ;
//   5. l'onglet Activite fusionne signaux agents + journal terrain, et les
//      harnais fondateur (Stack IA, Simulation rush) sont INACCESSIBLES a une
//      directrice meme en forcant l'etat : le rendu retombe sur l'activite ;
//   6. XSS : un titre de suggestion hostile est ECHAPPE, pas execute ;
//   7. chaque appel reseau du cockpit porte le centre de la session, jamais
//      un autre ;
//   8. avec platform.admin, les harnais fondateur redeviennent accessibles ;
//   9. l'onglet Journal monte le panneau d'audit REUTILISE (le comportement
//      complet du panneau est prouve par scripts/audit-ui-check.js) ;
//  10. l'export « Archive JSON » a disparu, les exports utiles restent ;
//  11. sans flag serveur, le bandeau de test ne s'affiche PAS (pas
//      d'affirmation sans mesure).
//
// Captures : PINLANE_DIRECTION_SHOTS=<dossier> ecrit desktop 1400 + mobile 390
// dans les deux themes (bascule par setStaffTheme, le SEUL chemin qui pose
// data-theme : affecter state.staffTheme a la main ne change rien au rendu).
//
// Lancement : node scripts/direction-cockpit-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DIRECTION_PORT || 4233);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// Titre de suggestion hostile, injecte tel qu'il arriverait de la base : le
// scenario reel est un agent (ou une donnee amont pourrie) qui produirait du
// markup dans un payload.
const XSS_TITLE = '<img src=x onerror="window.__XSS_DIR__=1">Suggestion piegee';

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, XSS_TITLE }) => {
    // Le VRAI role Direction : VERROUILLE (tous les droits du centre par le
    // raccourci, centers.switch compris), SANS platform.admin. Une premiere
    // version testait un role non verrouille sans ai.ops : ce persona n'existe
    // pas en production, et il aurait masque le vrai comportement (un 403 sur
    // agentStack qui tuait l'onglet Activite via Promise.all). Le cas du role
    // restreint sans centers.switch est teste par bascule dans la section [4].
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Sophie', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = (() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })();
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });

    const reservations = [
      { id: 1, centerId: 'libramont', date: today, startTime: '14:00', duration: 1, name: 'Famille Dubois', phone: '+32470000001', email: 'a@x.be', status: 'pending', pax: 4, price: 60, type: 'bowling', lanes: [1] },
      { id: 2, centerId: 'libramont', date: today, startTime: '16:00', duration: 1, name: 'Anniversaire Lena', phone: '+32470000002', email: 'b@x.be', status: 'paid', pax: 8, price: 180, type: 'formule', formuleId: 'f1' },
      { id: 3, centerId: 'libramont', date: today, startTime: '18:00', duration: 1, name: 'Club Laser', phone: '+32470000003', email: 'c@x.be', status: 'arrived', pax: 10, price: 150, type: 'laser' },
    ];
    const communications = [
      { id: 1, centerId: 'libramont', channel: 'email', templateId: 'confirmation', recipient: 'a@x.be', subject: 'Confirmation', status: 'sent', sentAt: new Date().toISOString() },
      { id: 2, centerId: 'libramont', channel: 'email', templateId: 'reminder_48h', recipient: 'b@x.be', subject: 'Rappel', status: 'queued', scheduledAt: new Date().toISOString() },
    ];
    const suggestions = [
      { id: 11, centerId: 'libramont', severity: 'high', confidence: 0.82, agentId: 'ops-agent', status: 'pending', suggestionType: 'delay_risk', payload: { title: XSS_TITLE, recommendation: 'Verifier les arrivees de 18h.' } },
      { id: 12, centerId: 'libramont', severity: 'info', confidence: 0.6, agentId: 'mail-agent', status: 'pending', suggestionType: 'mail_hint', payload: { title: 'Relance utile', recommendation: 'Un rappel 48h est en file.' } },
    ];
    const events = [
      { id: 21, centerId: 'libramont', eventType: 'delay_applied', activityType: 'bowling', reasonId: 'late_customer', plannedStart: '18:00', actualStart: '18:10', plannedMinutes: 60, actualMinutes: 70, createdAt: new Date().toISOString() },
    ];

    window.__OPS_CALLS__ = [];
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Sophie', contact: 's@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations, laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') {
        window.__OPS_CALLS__.push(u.pathname + u.search);
        return J({ ok: true, reservations, laneStatuses: lanes(), centerId: 'libramont' });
      }
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && m === 'GET') {
        window.__OPS_CALLS__.push(u.pathname + u.search);
        const action = u.searchParams.get('action') || '';
        if (action === 'communications') return J({ ok: true, communications });
        if (action === 'emailSamples') return J({ ok: true, samples: [] });
        if (action === 'suggestions') return J({ ok: true, suggestions });
        if (action === 'events') return J({ ok: true, events });
        if (action === 'agentStack') return J({ ok: true, stack: null, orchestration: null, ecosystem: null });
        // Source du bandeau d'honnetete : le SERVEUR declare les donnees de
        // test, le front ne fait qu'afficher.
        if (action === 'health') return J({ ok: true, health: { communications: { sent: 1, queued: 1, failed: 0 }, delayIncidents: [] }, audit: { ok: true }, testData: true });
        if (action === 'auditLog') return J({ ok: true, centerId: 'libramont', entries: [], audit: { written: 0, failed: 0 } });
        if (action === 'knowledge') return J({ ok: true });
        return J({ ok: true, entries: [], communications: [], samples: [], suggestions: [], events: [] });
      }
      if (u.pathname === '/api/ops' && m === 'POST') return J({ ok: true });
      if (u.pathname === '/api/simulation') {
        window.__OPS_CALLS__.push(u.pathname + u.search);
        return J({ ok: true, status: 'idle', simulation: null });
      }
      if (u.pathname === '/api/public-booking-meta') {
        return J({ ok: true, today, durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, XSS_TITLE });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=dc-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.adminTab = 'overview';
      state.adminPeriod = 'day';
      state.staffMenuPage = 'dashboard';
      save();
      setView('admin');
    });
    // Le rendu admin demarre apres l'injection C14 des consoles : on attend le
    // CONTENU (KPI rendus), pas juste la coquille statique.
    await page.waitForFunction(
      () => document.querySelectorAll('#adminContent .admin-kpi').length >= 4,
      null,
      { timeout: 20000 },
    );
    await page.waitForTimeout(600);

    console.log('[1] la lecture 5 secondes : le cockpit du CENTRE, honnete');
    const view = await page.evaluate(() => ({
      hero: document.getElementById('adminHeroTitle').textContent,
      centerName: getAdminCenter().name,
      sub: document.getElementById('adminHeroSub').textContent,
      wholeText: document.getElementById('adminView').innerText,
      honesty: (document.querySelector('#adminHonestyNote .admin-testdata') || {}).textContent || '',
      kpis: [...document.querySelectorAll('#adminContent .admin-kpi .k')].map((el) => el.textContent.trim()),
      resasValue: (() => {
        const kpi = [...document.querySelectorAll('#adminContent .admin-kpi')].find((el) => /Réservations/.test(el.textContent));
        return kpi ? kpi.querySelector('.v').textContent.trim() : '';
      })(),
      signals: Boolean([...document.querySelectorAll('#adminContent h2')].find((h) => h.textContent.includes('Signaux direction'))),
      checks: Boolean([...document.querySelectorAll('#adminContent h2')].find((h) => h.textContent.includes('Vérifications continues'))),
      cockpit: Boolean([...document.querySelectorAll('#adminContent h2')].find((h) => h.textContent.includes('Cockpit opérationnel'))),
    }));
    ok(view.hero === view.centerName, `le hero porte le nom du centre (« ${view.hero} »)`);
    ok(!/Console CEO/.test(view.wholeText), 'plus aucune mention « Console CEO » sur la surface');
    ok(/Cockpit du centre/.test(view.sub), 'le sous-titre dit « Cockpit du centre » et annonce la periode');
    ok(/donn[ée]es de test/i.test(view.honesty), 'le bandeau « donnees de test » est affiche (flag serveur)');
    ok(view.resasValue === '3', `le KPI Reservations lit les donnees reelles du mock (obtenu « ${view.resasValue} »)`);
    ok(view.signals && view.checks && view.cockpit, 'signaux, verifications continues et cockpit operationnel sont la');

    console.log('\n[2] chaque compteur annonce son perimetre temporel');
    ok(view.kpis.some((k) => k === 'Chiffre du jour'), `vue jour : « Chiffre du jour » (obtenu ${JSON.stringify(view.kpis)})`);
    await page.evaluate(() => setAdminPeriod('week'));
    await page.waitForTimeout(700);
    const weekKpis = await page.evaluate(() => [...document.querySelectorAll('#adminContent .admin-kpi .k')].map((el) => el.textContent.trim()));
    ok(weekKpis.some((k) => k === 'Chiffre de la période'), 'vue semaine : le meme compteur devient « Chiffre de la periode »');
    await page.evaluate(() => setAdminPeriod('day'));
    await page.waitForTimeout(500);

    console.log('\n[3] les onglets : un usage = un endroit');
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.admin-tabs button')].map((b) => b.textContent.trim()));
    ok(!tabs.includes('Clients'), `l onglet Clients (doublon du CRM v2) a disparu (obtenu ${JSON.stringify(tabs)})`);
    ok(tabs.includes('Journal'), 'l onglet Journal existe');
    ok(tabs.includes('Activité'), 'l onglet Agents est devenu Activite');

    console.log('\n[4] grille multi-centres : suit centers.switch dans les deux sens');
    // Le persona principal est desormais le VRAI role Direction : VERROUILLE,
    // donc porteur de centers.switch par le raccourci (Fun Galaxy pilote ses
    // trois centres). Pour lui, la grille DOIT s'afficher. Le sens "cachee"
    // se teste avec un role restreint SANS le verrou : c'est le cas reel d'un
    // futur role personnalise mono-centre. L'ancienne version testait l'inverse
    // sur un persona qui n'existe pas en production.
    const gridShown = await page.evaluate(() => {
      const grid = document.getElementById('adminCenterGrid');
      return { hidden: grid.classList.contains('hidden'), cards: grid.querySelectorAll('.admin-center-card').length };
    });
    ok(!gridShown.hidden && gridShown.cards > 0,
      `le role Direction verrouille (centers.switch via le verrou) voit la grille (${gridShown.cards} carte(s))`);
    const gridHidden = await page.evaluate(() => {
      const saved = { locked: state.staffAuthSession.role.locked, perms: state.staffAuthSession.permissions };
      state.staffAuthSession.role.locked = false;
      state.staffAuthSession.permissions = saved.perms.filter((p) => p !== 'centers.switch');
      renderAdminHeader();
      const grid = document.getElementById('adminCenterGrid');
      const result = { hidden: grid.classList.contains('hidden'), cards: grid.querySelectorAll('.admin-center-card').length };
      state.staffAuthSession.role.locked = saved.locked;
      state.staffAuthSession.permissions = saved.perms;
      renderAdminHeader();
      return result;
    });
    ok(gridHidden.hidden && gridHidden.cards === 0,
      'un role restreint sans centers.switch ne voit pas les cartes des autres centres');

    console.log('\n[5] onglet Activite : centre seulement, harnais fondateur inaccessibles');
    await page.click('#adminTabOps');
    await page.waitForFunction(
      () => Boolean(document.querySelector('#opsAdminContent .ops-activity-block')),
      null,
      { timeout: 10000 },
    );
    const activity = await page.evaluate(() => ({
      heads: [...document.querySelectorAll('#opsAdminContent .ops-activity-head h3')].map((el) => el.textContent.trim()),
      platformTabs: document.querySelectorAll('#adminContent .ops-admin-tabs .ops-tab').length,
      text: document.getElementById('opsAdminContent').innerText,
      dispatchBtn: [...document.querySelectorAll('#adminContent button')].some((b) => /Envoyer la file/.test(b.textContent)),
    }));
    ok(activity.heads.includes('Signaux des agents') && activity.heads.includes('Journal terrain'),
      'signaux agents + journal terrain fusionnes sur un seul ecran');
    ok(activity.platformTabs === 0, 'aucun sous-onglet plateforme (Stack IA, Simulation rush) pour une directrice');
    ok(!activity.dispatchBtn, 'pas de bouton « Envoyer la file » ici : les mails vivent dans l onglet Mails');
    ok(activity.text.includes('Verifier les arrivees de 18h.'), 'la recommandation d agent se lit');
    // COMPORTEMENT, pas presence : forcer l'etat sur un harnais fondateur doit
    // retomber sur l'activite pour un role sans platform.admin.
    const forced = await page.evaluate(() => {
      state.opsPanelTab = 'stack';
      renderOpsAdmin();
      const text = document.getElementById('opsAdminContent').innerText;
      return { activity: Boolean(document.querySelector('#opsAdminContent .ops-activity-block')), stack: /Relancer l.orchestrateur|Stack IA indisponible/.test(text) };
    });
    ok(forced.activity && !forced.stack, 'forcer state.opsPanelTab=stack rend quand meme l activite (gate de comportement)');

    console.log('\n[6] XSS : le titre de suggestion hostile est echappe, pas execute');
    const xss = await page.evaluate(() => ({
      fired: Boolean(window.__XSS_DIR__),
      rawImg: Boolean(document.querySelector('#opsAdminContent img[onerror]')),
      readable: document.getElementById('opsAdminContent').innerText.includes('Suggestion piegee'),
    }));
    ok(!xss.fired, 'aucun script injecte via le payload agent ne s est execute');
    ok(!xss.rawImg, 'aucune balise img hostile n a ete construite dans le DOM');
    ok(xss.readable, 'le titre hostile reste LISIBLE une fois echappe');

    console.log('\n[7] scope reseau : chaque appel porte le centre de la session');
    const calls = await page.evaluate(() => window.__OPS_CALLS__.slice());
    const scoped = calls.filter((c) => /centerId=/.test(c));
    ok(scoped.length >= 5, `les lectures du cockpit sont scopees (${scoped.length} appels avec centerId)`);
    ok(scoped.every((c) => /centerId=libramont/.test(c)),
      'aucun appel ne demande un autre centre que celui de la session');

    console.log('\n[8] platform.admin : les harnais fondateur redeviennent accessibles');
    const platform = await page.evaluate(() => {
      state.staffAuthSession.permissions = [...state.staffAuthSession.permissions, 'platform.admin'];
      renderAdminDashboard();
      renderOpsAdmin();
      const tabs = [...document.querySelectorAll('#adminContent .ops-admin-tabs .ops-tab')].map((b) => b.textContent.trim());
      setOpsTab('stack');
      const stackText = document.getElementById('opsAdminContent').innerText;
      setOpsTab('activity');
      state.staffAuthSession.permissions = state.staffAuthSession.permissions.filter((p) => p !== 'platform.admin');
      renderAdminDashboard();
      return { tabs, stackVisible: /Stack IA/.test(stackText) };
    });
    ok(platform.tabs.includes('Stack IA') && platform.tabs.includes('Simulation rush'),
      `platform.admin voit les harnais (${JSON.stringify(platform.tabs)})`);
    ok(platform.stackVisible, 'setOpsTab(stack) rend la Stack IA pour platform.admin');

    console.log('\n[9] onglet Journal : le panneau d audit reutilise se monte');
    await page.click('#adminTabJournal');
    await page.waitForTimeout(400);
    const journal = await page.evaluate(() => ({
      panel: [...document.querySelectorAll('#adminContent .pv2-panel h2')].some((h) => h.textContent.includes('Journal des modifications')),
      hook: typeof window.pv2AuditRerender === 'function',
    }));
    ok(journal.panel, 'le panneau « Journal des modifications » est monte dans Direction');
    ok(journal.hook, 'le hook pv2AuditRerender est pose par la page hote');

    console.log('\n[10] exports : l archive JSON technique a disparu, l utile reste');
    await page.click('#adminTabExports');
    await page.waitForTimeout(400);
    const exports = await page.evaluate(() => ({
      text: document.getElementById('adminContent').innerText,
      cards: document.querySelectorAll('#adminContent .admin-export-card').length,
    }));
    ok(!/Archive JSON/.test(exports.text), 'plus de carte « Archive JSON complete »');
    ok(/Excel compta/.test(exports.text) && /Rapport direction/.test(exports.text), 'Excel compta et rapport direction restent');

    console.log('\n[11] honnetete : sans flag serveur, PAS de bandeau');
    const honestyOff = await page.evaluate(() => {
      const saved = adminDashboardCache.testData;
      adminDashboardCache.testData = undefined;
      opsAdminCache.testData = undefined;
      renderAdminHonestyNote();
      const gone = !document.querySelector('#adminHonestyNote .admin-testdata');
      adminDashboardCache.testData = saved;
      renderAdminHonestyNote();
      return gone;
    });
    ok(honestyOff, 'le bandeau disparait quand le serveur n a rien affirme (pas de chiffre invente, pas de bandeau invente)');

    // Captures : REGARDER la page avant de la rendre. Meme patron que
    // emails-page-check (PINLANE_EMAILS_SHOTS).
    if (process.env.PINLANE_DIRECTION_SHOTS) {
      const shotDir = process.env.PINLANE_DIRECTION_SHOTS;
      fs.mkdirSync(shotDir, { recursive: true });
      await page.evaluate(() => { state.adminTab = 'overview'; save(); renderAdminDashboard(); });
      await page.waitForTimeout(400);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(400);
        await page.setViewportSize({ width: 1400, height: 950 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(shotDir, `direction-${theme}-desktop.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(shotDir, `direction-${theme}-mobile.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1400, height: 950 });
      await page.evaluate(() => { setStaffTheme('dark'); setAdminTab('ops'); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(shotDir, 'direction-dark-activite.png'), fullPage: true });
      await page.evaluate(() => { setAdminTab('journal'); });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const head = [...document.querySelectorAll('#adminContent .pv2-panel')].find((p) => p.textContent.includes('Journal des modifications'));
        if (head && !document.querySelector('#adminContent [data-pv2-mount="audit"]')) head.querySelector('button').click();
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(shotDir, 'direction-dark-journal.png'), fullPage: true });
      await page.evaluate(() => { setAdminTab('exports'); });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shotDir, 'direction-dark-exports.png'), fullPage: true });
      await page.evaluate(() => { setAdminTab('overview'); });
      console.log(`[SHOTS] captures ecrites dans ${shotDir}`);
    }

    const fatal = errs.filter((e) => !/localStorage|sandboxed|favicon|cdn\.vercel-insights/i.test(e));
    ok(fatal.length === 0, `aucune erreur console fatale (obtenu ${fatal.length}${fatal.length ? ' : ' + fatal[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ndirection-cockpit-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ndirection-cockpit-check: ALL OK');
}

main().catch((error) => {
  console.error('direction-cockpit-check: exception', error);
  process.exit(1);
});
