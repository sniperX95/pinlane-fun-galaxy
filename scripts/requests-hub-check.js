// LA PAGE « DEMANDES SUR MESURE » SE SUFFIT A ELLE-MEME.
// La fiche montre les mails recus et envoyes, un modele prepare la reponse et laisse les blancs.
// Ce gate pilote la vraie page sur un fil qui a les trois cas.
const PORT_ENV = Number(process.env.PINLANE_REQUESTS_PORT || 4227);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = p.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = PORT_ENV;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = p.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(ROOT, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(c);
  });
});

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1150 } });
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await pg.addInitScript((expiresAt) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'clients.edit', 'emails.view', 'emails.send', 'direction.view', 'settings.manage'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const iso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
    const leads = [{ id: 501, contactName: 'Asso Les Lucioles', company: 'Les Lucioles', email: 'lucioles@test.be', phone: '+32470111099', occasion: 'anniversaire', requestedDate: '2026-08-29', pax: 14, status: 'in_progress', message: 'On veut faire bowling 10h pour 14 enfants, budget a discuter.', createdAt: iso(30) }];
    const comms = [
      { id: 11, direction: 'inbound', recipient: 'lucioles@test.be', subject: 'Demande pour 14 enfants', body: 'Bonjour, on aimerait organiser un anniversaire pour 14 enfants le 29 aout.', status: 'received', createdAt: iso(30), sentAt: iso(30) },
      { id: 12, direction: 'outbound', recipient: 'lucioles@test.be', subject: 'Votre demande anniversaire chez Fun Galaxy Libramont', body: 'Bonjour, merci pour votre demande. Nous revenons vers vous avec une proposition.', status: 'sent', createdAt: iso(28), sentAt: iso(28) },
      { id: 13, direction: 'outbound', recipient: 'lucioles@test.be', subject: 'Relance : votre venue du 29', body: 'Petit rappel de notre proposition.', status: 'queued', createdAt: iso(2), sentAt: null },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && String(init.method || 'GET').toUpperCase() === 'POST') {
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action') || '';
        if (action === 'customRequests') return J({ ok: true, customRequests: leads });
        if (action === 'communications') {
          const recipient = (u.searchParams.get('recipient') || '').toLowerCase();
          return J({ ok: true, communications: recipient ? comms.filter((c) => c.recipient.toLowerCase() === recipient) : comms });
        }
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [] });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], activities: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, expiresAt);

  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof window.setView === 'function');
  await pg.evaluate(() => window.setView('staff'));
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => { if (typeof ensureStaffCustomRequests === 'function') ensureStaffCustomRequests(); });
  await pg.waitForTimeout(900);
  await pg.evaluate(() => window.openStaffMenuPage('requests'));
  await pg.waitForTimeout(1600);

  // Ouvre la fiche, charge le fil, applique un modele.
  console.log('' ); console.log('[Les mails du contact]');
  await pg.evaluate(() => window.selectStaffRequest(501));
  await pg.waitForTimeout(900);
  await pg.evaluate(() => window.toggleStaffRequestReply(501));
  await pg.waitForTimeout(500);
  const thread = await pg.evaluate(() => {
    const zone = document.querySelector('.sm-hi');
    const mails = [...document.querySelectorAll('.sm-hi-m')].map((b) => b.textContent.trim());
    return { present: !!zone, text: zone ? zone.textContent : '', sent: mails.filter((m) => /E-mail envoyé/.test(m)).length, received: mails.filter((m) => /Le client a écrit/.test(m)).length };
  });
  ok(thread.present, 'les mails sont sur la fiche, sans changer d ecran');
  ok(thread.received === 1, `les mails RECUS y sont (${thread.received})`);
  ok(thread.sent === 2, `les mails ENVOYES y sont (${thread.sent})`);
  ok(/en file/i.test(thread.text), 'un mail non parti est dit « en file », jamais presente comme envoye');

  console.log('' ); console.log('[Les modeles de reponse]');
  const presets = await pg.evaluate(() => [...document.querySelectorAll('.sm-modeles button')].map((b) => b.textContent.trim()));
  ok(presets.join() === 'Demander des précisions,Proposer un autre jour', `deux modeles, pas plus (${presets.join(' | ')})`);
  await pg.click('.sm-modeles button:last-child');
  await pg.waitForTimeout(500);
  const filled = await pg.evaluate(() => ({
    subject: (document.querySelector('.sm-courrier input') || {}).value || '',
    body: (document.querySelector('.sm-courrier textarea') || {}).value || '',
  }));
  ok(filled.subject.length > 0 && filled.body.length > 0, 'un modele remplit objet et message');
  ok(/\[ALTERNATIVE\]/.test(filled.body), 'le modele LAISSE les blancs a completer au lieu d inventer un creneau');
  const motsIA = await pg.evaluate(() => /\bIA\b|Améliorer|Réécrire/.test(document.querySelector('.sm-fiche').innerText));
  ok(!motsIA, 'la reponse ne propose ni IA ni reecriture');

  console.log('' ); console.log('[Annuler]');
  await pg.locator('.sm-courrier .sm-b', { hasText: 'Annuler' }).click();
  await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => !document.querySelector('.sm-courrier')), 'annuler referme la reponse');

  console.log('' ); console.log('[Contre-epreuve : ce gate sait-il rougir ?]');
  const blind = await pg.evaluate(() => {
    document.querySelectorAll('.sm-hi-m').forEach((el) => el.remove());
    return document.querySelectorAll('.sm-hi-m').length === 0;
  });
  ok(blind === true, 'fil vide expres : la sonde ne trouve plus les mails -> le gate ROUGIRAIT');

  await b.close();
  srv.close();
  if (failures) { console.error('requests-hub-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('' ); console.log('requests-hub-check: ALL OK - tout se voit et se traite sur la page.');
});
