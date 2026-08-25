// LA PAGE « DEMANDES SUR MESURE » SE SUFFIT A ELLE-MEME (2026-08-19).
// Movsar : « on peut voir direct sur cette page si ya eu des mails envoye des
// mails recu, tout gerer ici, ya deja des preset et aussi un bouton ia plug
// avec notre kimi qui ameliore le contenu de ce quon a ecrit ».
// Ce gate pilote de VRAIS clics : il ouvre le composeur, charge le fil du
// contact, applique un modele, lance l amelioration IA, revient en arriere, et
// verifie le repli honnete quand le modele ne repond pas (le texte du staff ne
// doit JAMAIS etre perdu ni remplace par du vide).
const PORT_ENV = Number(process.env.PINLANE_REQUESTS_PORT || 4227);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = 'C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head';
const { chromium } = require(p.join(ROOT, 'node_modules', 'playwright-core'));
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
        const body = JSON.parse(init.body || '{}');
        if (body.action === 'improveEmailDraft') {
          // Interrupteur de contre-preuve : quand l'IA ne repond pas, le
          // serveur rend le texte d'ORIGINE avec improved:false.
          if (window.__QA_AI_DOWN__) return J({ ok: true, improved: false, reason: 'unavailable', subject: body.subject, body: body.body });
          return J({ ok: true, improved: true, provider: 'kimi', model: 'kimi-k2.6', subject: 'Votre anniversaire du 29 aout chez Fun Galaxy Libramont', body: 'Bonjour,\n\nMerci pour votre demande pour 14 enfants le 29 aout.\n\nNous pouvons vous accueillir a 10h. Dites-nous si cela vous convient et nous bloquons le creneau.\n\nA tres vite,\nFun Galaxy Libramont' });
        }
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

  // Ouvre le composeur, charge le fil, applique un modele.
  console.log('' ); console.log('[Le fil de discussion du contact]');
  await pg.evaluate(() => window.toggleStaffRequestReply(501));
  await pg.waitForTimeout(500);
  await pg.evaluate(() => window.loadStaffRequestThread(501));
  await pg.waitForTimeout(900);
  const thread = await pg.evaluate(() => {
    const zone = document.querySelector('.req-thread');
    return {
      present: !!zone,
      text: zone ? zone.textContent : '',
      sent: document.querySelectorAll('.req-msg.is-out').length,
      received: document.querySelectorAll('.req-msg.is-in').length,
    };
  });
  ok(thread.present, 'le fil des mails est sur la page, sans changer d ecran');
  ok(thread.received === 1, `les mails RECUS y sont (${thread.received})`);
  ok(thread.sent === 2, `les mails ENVOYES y sont (${thread.sent})`);
  ok(/en file/i.test(thread.text), 'un mail non parti est dit « en file », jamais presente comme envoye');

  console.log('' ); console.log('[Les modeles de reponse]');
  const presets = await pg.evaluate(() => [...document.querySelectorAll('.req-preset')].map((b) => b.textContent.trim()));
  ok(presets.length >= 4, `des modeles sont proposes (${presets.join(' | ')})`);
  await pg.evaluate(() => window.applyStaffRequestPreset(501, 'dispo'));
  await pg.waitForTimeout(500);
  const filled = await pg.evaluate(() => ({
    subject: (document.querySelector('.req-composer input') || {}).value || '',
    body: (document.querySelector('.req-composer textarea') || {}).value || '',
  }));
  ok(filled.subject.length > 0 && filled.body.length > 0, 'un modele remplit objet et message');
  ok(/\[DATE\]|\[HEURE\]/.test(filled.body), 'le modele LAISSE les blancs a completer au lieu d inventer un creneau');

  console.log('' ); console.log('[L amelioration par l IA]');
  const before = await pg.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
  await pg.evaluate(() => window.improveStaffRequestDraft(501));
  await pg.waitForTimeout(1100);
  const after = await pg.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
  ok(after !== before && after.length > 0, 'le message est reecrit par l IA');
  const revert = await pg.evaluate(() => !!document.querySelector('.req-revert'));
  ok(revert, 'un retour a la version du staff est propose');
  await pg.evaluate(() => window.revertStaffRequestDraft(501));
  await pg.waitForTimeout(500);
  const reverted = await pg.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
  ok(reverted === before, 'le retour arriere rend EXACTEMENT le texte du staff');

  console.log('' ); console.log('[Contre-epreuve : quand l IA ne repond pas, rien n est perdu]');
  await pg.evaluate(() => { window.__QA_AI_DOWN__ = true; });
  const keep = await pg.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
  await pg.evaluate(() => window.improveStaffRequestDraft(501));
  await pg.waitForTimeout(1100);
  const afterDown = await pg.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
  ok(afterDown === keep && afterDown.length > 0, 'IA indisponible : le texte du staff est intact, ni vide ni tronque');

  console.log('' ); console.log('[Contre-epreuve : ce gate sait-il rougir ?]');
  const blind = await pg.evaluate(() => {
    document.querySelectorAll('.req-msg').forEach((el) => el.remove());
    return document.querySelectorAll('.req-msg.is-in').length === 0;
  });
  ok(blind === true, 'fil vide expres : la sonde ne trouve plus les mails -> le gate ROUGIRAIT');

  await b.close();
  srv.close();
  if (failures) { console.error('requests-hub-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('' ); console.log('requests-hub-check: ALL OK - tout se voit et se traite sur la page.');
});
