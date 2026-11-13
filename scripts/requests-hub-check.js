// LA PAGE « DEMANDES SUR MESURE » SE SUFFIT A ELLE-MEME.
// La demande montre les mails recus et envoyes, un modele prepare la reponse et laisse les blancs.
// Ce gate pilote la vraie page (v5, le bureau des groupes) sur un fil qui a les trois cas, a la souris.
// La contre-epreuve sert un app-main.js ou un mail en file se dit envoye : la sonde doit rougir.
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

// La coupure de la contre-epreuve : servie au navigateur, jamais ecrite dans le depot.
let mutation = null;
let mutationPosee = false;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = p.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(ROOT, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    let corps = c;
    if (mutation && u.pathname === '/assets/app-main.js') {
      const t = c.toString('utf8').replace(/\r\n/g, '\n');
      if (t.includes(mutation.de)) { corps = t.split(mutation.de).join(mutation.vers); mutationPosee = true; }
    }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(corps);
  });
});

async function ouvrir(b) {
  const pg = await b.newPage({ viewport: { width: 1500, height: 1150 } });
  const erreurs = [];
  pg.on('pageerror', (e) => { erreurs.push(e.message); console.log('PAGEERROR', e.message); });
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
  await pg.waitForSelector('.bdg .bdg-l[data-item-id="501"]', { timeout: 10000 });
  // Un clic sur la ligne ouvre la demande ; ses mails se lisent dans la meme page.
  await pg.click('.bdg .bdg-l[data-item-id="501"]');
  await pg.waitForSelector('.bdg-lecture[data-request-id="501"] .bdg-mails', { timeout: 10000 });
  return { pg, erreurs };
}

const lireFil = (pg) => pg.evaluate(() => {
  const zone = document.querySelector('.bdg-lecture[data-request-id="501"] .bdg-mails-s');
  const mails = [...document.querySelectorAll('.bdg-lecture .bdg-mail-t')].map((b) => b.textContent.trim());
  return { present: !!zone, text: zone ? zone.textContent : '', sent: mails.filter((m) => /E-mail envoyé/.test(m)).length, received: mails.filter((m) => /Le client a écrit/.test(m)).length, adresse: location.pathname + location.search };
});

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const { pg, erreurs } = await ouvrir(b);
    const adresseAvant = await pg.evaluate(() => location.pathname + location.search);

    console.log(''); console.log('[Les mails du contact]');
    const thread = await lireFil(pg);
    ok(thread.present && thread.adresse === adresseAvant, 'les mails sont sur la demande, sans changer d ecran');
    ok(thread.received === 1, `les mails RECUS y sont (${thread.received})`);
    ok(thread.sent === 2, `les mails ENVOYES y sont (${thread.sent})`);
    ok(/en file/i.test(thread.text), 'un mail non parti est dit « en file », jamais presente comme envoye');

    console.log(''); console.log('[Les modeles de reponse]');
    await pg.click('.bdg-pin-pied button:has-text("Écrire au client")');
    await pg.waitForSelector('#reqComposer-501', { timeout: 5000 });
    const presets = await pg.evaluate(() => [...document.querySelectorAll('#reqComposer-501 .bdg-modeles button')].map((x) => x.textContent.trim()));
    ok(presets.join() === 'Demander des précisions,Proposer un autre jour', `deux modeles, pas plus (${presets.join(' | ')})`);
    await pg.click('#reqComposer-501 .bdg-modeles button:last-child');
    await pg.waitForTimeout(500);
    const filled = await pg.evaluate(() => ({
      subject: (document.getElementById('reqSubject-501') || {}).value || '',
      body: (document.getElementById('reqBody-501') || {}).value || '',
    }));
    ok(filled.subject.length > 0 && filled.body.length > 0, 'un modele remplit objet et message');
    ok(/\[ALTERNATIVE\]/.test(filled.body), 'le modele LAISSE les blancs a completer au lieu d inventer un creneau');
    const motsIA = await pg.evaluate(() => /\bIA\b|Améliorer|Réécrire/.test(document.querySelector('.bdg-lecture').innerText));
    ok(!motsIA, 'la reponse ne propose ni IA ni reecriture');

    console.log(''); console.log('[Annuler]');
    await pg.click('.bdg-pin-pied button:has-text("Annuler")');
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => !document.getElementById('reqComposer-501') && /Écrire au client/.test((document.querySelector('.bdg-pin-pied') || {}).textContent || '')), 'annuler referme la reponse, et « Écrire au client » revient');
    ok(erreurs.length === 0, `zero erreur JavaScript (${erreurs.length})`);
    await pg.close();

    console.log(''); console.log('[Contre-epreuve : ce gate sait-il rougir ?]');
    mutation = { de: "queued: ['en file', 'wait'],", vers: "queued: ['envoyé', 'ok']," };
    const coupe = await ouvrir(b);
    const aveugle = await lireFil(coupe.pg);
    ok(mutationPosee, 'la coupure est posee dans app-main.js servi (un mail en file se dit envoye)');
    ok(!/en file/i.test(aveugle.text), 'avec la coupure, la sonde ne lit plus « en file » : le gate ROUGIRAIT');
    await coupe.pg.close();
    mutation = null;
  } finally {
    await b.close();
    srv.close();
  }
  if (failures) { console.error('requests-hub-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log(''); console.log('requests-hub-check: ALL OK - tout se voit et se traite sur la page.');
});
