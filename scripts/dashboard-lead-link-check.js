// L'ALERTE « DEMANDE SUR MESURE » MENE A SA PAGE DEDIEE (Movsar, 2026-08-19 :
// « l alerte pour ça c est mal relié, faut que ça emmene a notre categorie
// dediee pour gerer ça »). Ce gate pilote de VRAIS clics dans la console : il
// ouvre le panneau d'alertes, clique « Gérer cette demande », et exige
// d'atterrir sur la page Demandes sur mesure, sur LA carte concernee.
// Contre-epreuve incluse : une demande deja traitee ouvre le segment qui la
// contient, jamais un segment vide sur un clic parfaitement valide.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LEADLINK_PORT || 4212);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

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
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'clients.view', 'clients.edit', 'emails.view', 'emails.send', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Date du CENTRE, calculee comme todayStr() de l app (booking-core.js,
    // fuseau Europe/Brussels), jamais dans le fuseau du navigateur :
    // toISOString rendait la date UTC, et la date locale du navigateur, juste
    // sur un poste belge, est fausse sur un runner CI en UTC entre 22 h et
    // minuit UTC. Dans les deux cas les dates du mock glissaient d un jour.
    const dstr = (offset) => {
      const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const lire = (type) => Number(jour.find((part) => part.type === type)?.value);
      return new Date(Date.UTC(lire('year'), lire('month') - 1, lire('day') + offset)).toISOString().slice(0, 10);
    };
    // Deux demandes : une ACTIVE (celle que l'alerte annonce) et une DEJA
    // TRAITEE (la contre-epreuve du segment).
    const leads = [
      { id: 501, contactName: 'Asso Les Lucioles', email: 'lucioles@test.be', phone: '+32470111099', occasion: 'anniversaire', requestedDate: dstr(10), pax: 14, status: 'new', message: 'Fete pour 14 enfants, budget a discuter.' },
      { id: 502, contactName: 'Comite Ancien', email: 'ancien@test.be', phone: '+32470111098', occasion: 'entreprise', requestedDate: dstr(4), pax: 30, status: 'handled', message: 'Deja repondu la semaine derniere.' },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((acc, _, index) => { acc[index + 1] = 'active'; return acc; }, {});
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'qa-' + Date.now() } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && String(init.method || 'GET').toUpperCase() === 'POST') return J({ ok: true });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests: leads });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (error) => errs.push('PAGEERROR: ' + error.message));
  try {
    await installMock(page);
    // ON ATTEND LA CONDITION, PAS UN ETAT RESEAU FLOU. `networkidle` exige 500 ms
    // sans la moindre requete : sur une page qui charge ~3,3 Mio d actifs et
    // interroge son mock au boot, ce silence n arrive pas toujours dans les 45 s.
    // Ce gate a fait tomber la suite deux fois en une soiree (une fois
    // ERR_NAME_NOT_RESOLVED, une fois timeout de navigation) alors qu il passe
    // deux fois sur deux relance seul - et comme la chaine s arrete au premier
    // echec, il empechait tous les gates suivants de tourner. On attend le
    // chargement du document, puis la VRAIE condition d entree (setView defini),
    // qui etait deja verifiee juste en dessous.
    await page.goto(BASE_URL + '/?v=leadlink-' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1400);

    // La file des demandes vient du reseau : dans la vraie console elle est
    // demandee au boot (badge de la barre laterale). Le harnais demarre plus
    // vite que son propre mock, on l attend donc : sinon on mesurerait un
    // tableau de bord qui ne connait pas encore la demande.
    await page.evaluate(() => { if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests(); });
    await page.waitForFunction(() => typeof window.getStaffActiveCustomRequestCount === 'function' && window.getStaffActiveCustomRequestCount() > 0, null, { timeout: 10000 });

    console.log('\n[L alerte du tableau de bord]');
    await page.evaluate(() => window.openStaffDashboardDetail('alerts', 'lead'));
    await page.waitForSelector('.alert-lead', { timeout: 8000 });
    const alertText = await page.evaluate(() => (document.querySelector('.alert-lead') || {}).textContent || '');
    ok(/sur mesure à traiter/i.test(alertText), 'l alerte des demandes sur mesure est rendue');
    ok(/Asso Les Lucioles/.test(alertText), 'elle NOMME la demande qui attend (le contexte reste)');
    ok(/page Demandes sur mesure/i.test(alertText), 'sa note renvoie a la page dediee');

    const buttons = await page.evaluate(() => {
      const zone = document.querySelector('.alert-lead');
      if (!zone) return null;
      return [...zone.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
    });
    ok(Boolean(buttons) && buttons.some((label) => /Gérer cette demande/i.test(label)),
      'un bouton mene a la page (' + (buttons ? buttons.join(' | ') : 'n/a') + ')');
    ok(Boolean(buttons) && !buttons.some((label) => /Marquer trait/i.test(label) || /^Fiche$/i.test(label)),
      'les actions dupliquees ont quitte l alerte (elles vivent dans la page)');

    console.log('\n[Le clic mene VRAIMENT a la page dediee]');
    await page.click('.alert-lead .dashboard-detail-row-actions button.primary');
    await page.waitForTimeout(1000);
    const landed = await page.evaluate(() => ({
      // Mesure par le DOM : ce que l ecran MONTRE, pas une variable interne
      // (state n est pas expose sur window, une sonde qui l interroge rend
      // undefined et croit a une regression).
      onRequestsPage: !!document.querySelector('#staffUtilityPage .req-board'),
      pageTitle: ((document.querySelector('#staffUtilityPage h1, #staffUtilityPage .util-title') || {}).textContent || '').trim(),
      activeSegment: ((document.querySelector('.req-seg.active') || {}).textContent || '').trim(),
      overlayGone: !document.getElementById('staffDashboardDetailOverlay'),
      cardVisible: !!document.querySelector('.req-card[data-request-id="501"]'),
      called: !!document.querySelector('.req-card[data-request-id="501"].is-called'),
      boardText: (document.querySelector('.req-board') || {}).textContent || '',
    }));
    ok(landed.onRequestsPage, 'on atterrit sur la page Demandes sur mesure (titre : ' + landed.pageTitle + ')');
    ok(landed.overlayGone, 'le panneau d alertes se referme derriere nous');
    ok(/traiter/i.test(landed.activeSegment), 'le segment ouvert contient la demande (' + landed.activeSegment + ')');
    ok(landed.cardVisible, 'la carte de LA demande cliquee est a l ecran');
    ok(landed.called, 'elle est designee (repere is-called) : on ne cherche pas laquelle');
    ok(/Asso Les Lucioles/.test(landed.boardText), 'la page porte bien le contact attendu');
    // La REGLE, pas le libelle : la page porte l action de repondre et celle de
    // reserver (« Repondre par email » est devenu « Rediger la reponse » le
    // 2026-09-29, quand l IA s est mise a rediger a partir de l etude).
    ok(/Rédiger la réponse/.test(landed.boardText) && /Créer la réservation/.test(landed.boardText), 'et les actions de traitement, la ou elles vivent');

    console.log('\n[Contre-epreuve : une demande DEJA TRAITEE ouvre SON segment]');
    await page.evaluate(() => window.openStaffRequestsPage(502));
    await page.waitForTimeout(1000);
    const handled = await page.evaluate(() => ({
      activeSegment: ((document.querySelector('.req-seg.active') || {}).textContent || '').trim(),
      cardVisible: !!document.querySelector('.req-card[data-request-id="502"]'),
      // L etat vide se lit a son element, pas a une phrase : la sonde sur les
      // anciennes phrases ne pouvait plus rougir apres la refonte.
      emptyShown: Boolean(document.querySelector('.req-detail-empty')),
    }));
    ok(/traitées/i.test(handled.activeSegment), 'segment Traitees ouvert pour une demande traitee (' + handled.activeSegment + ')');
    ok(handled.cardVisible && !handled.emptyShown, 'sa carte est visible : la page n est pas vide sur un clic valide');

    console.log('\n[Contre-epreuve : ce gate sait-il rougir ?]');
    const blinded = await page.evaluate(() => {
      const card = document.querySelector('.req-card[data-request-id="502"]');
      if (!card) return null;
      card.setAttribute('data-request-id', 'casse');
      return !document.querySelector('.req-card[data-request-id="502"]');
    });
    ok(blinded === true, 'cible retiree expres : la sonde ne trouve plus la carte -> le gate ROUGIRAIT');

    ok(errs.length === 0, 'zero erreur console (' + errs.length + (errs.length ? ' : ' + errs[0] : '') + ')');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\ndashboard-lead-link-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('\ndashboard-lead-link-check: ALL OK - l alerte mene a la page dediee, sur la bonne demande.');
}

main().catch((error) => { console.error(error); process.exit(1); });
