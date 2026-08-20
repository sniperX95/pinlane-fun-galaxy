// UN MAIL SE LIT, IL NE S AFFICHE PAS EN CODE (2026-08-20).
// Movsar, capture a l appui : « c est super moche comment sont affiches les
// mails, tout est moche et mal designe et mal anime sur cette categorie ».
// La cause etait litterale : `communication.body` porte le GABARIT HTML complet
// (doctype, <head>, <meta charset>, <title> qui contient le preheader, styles
// inline), et la page le posait tel quel, echappe, dans un paragraphe. Le staff
// lisait « <meta name="viewport" content="width=device-width..." » a la place
// du message.
//
// Ce gate charge un fil qui contient un VRAI gabarit Pinlane et verifie que la
// page rend le TEXTE. Il verifie aussi la forme de la refonte : une file a
// gauche, une seule demande ouverte a droite, un seul fil a l ecran.
// Il produit enfin les captures dans artifacts/requests-inbox/.
const PORT_ENV = Number(process.env.PINLANE_REQUESTS_INBOX_PORT || 4231);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = p.resolve(__dirname, '..');
const { chromium } = require(p.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = p.join(ROOT, 'artifacts', 'requests-inbox');
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
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1150 } });
  const errs = [];
  pg.on('pageerror', (e) => { errs.push(e.message); console.log('PAGEERROR', e.message); });
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await pg.addInitScript((expiresAt) => {
    // Playwright injecte ce script dans TOUS les cadres, y compris l apercu du
    // mail qui tourne en bac a sable (origine opaque). Y toucher a
    // localStorage leve, et l erreur remonterait en « erreur console » de la
    // page alors qu elle vient du harnais, pas du produit. On sort tout de
    // suite quand on n est pas dans le document principal.
    try { void window.localStorage; } catch (error) { return; }
    if (window.top !== window.self) return;
    const perms =['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'clients.edit', 'emails.view', 'emails.send', 'direction.view', 'settings.manage'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const iso = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

    // Le gabarit REEL de lib/ops-communications.js, reduit a sa structure :
    // doctype, head complet, preheader cache bourre de caracteres invisibles,
    // puis le message dans des tables. C est exactement ce que la page rendait
    // en clair.
    const shell = (preheader, title, lines) => `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <title>${preheader}</title>
    <style>@media only screen and (max-width:480px){.fg-h1{font-size:18px !important;}}</style>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;">${preheader}${'&#8203;&nbsp;'.repeat(60)}</div>
    <table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600"><tr><td style="padding:26px 28px;">
        <h1 class="fg-h1" style="margin:0 0 16px;font-size:20px;">${title}</h1>
        ${lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${l}</p>`).join('')}
      </td></tr></table>
    </td></tr></table>
  </body>
</html>`;

    const leads = [
      { id: 701, contactName: 'Ansar Bisultanov', company: 'Test SPRL', email: 'ansar@test.be', phone: '+32487784816', occasion: 'entreprise', requestedDate: '12 octobre', pax: 70, status: 'in_progress', message: 'Team building pour 70 personnes, on cherche une formule bowling plus laser.', createdAt: iso(26) },
      { id: 702, contactName: 'Ecole Saint-Roch', company: '', email: 'ecole@test.be', phone: '+32471222333', occasion: 'ecole', requestedDate: '5 novembre', pax: 42, status: 'new', message: 'Sortie de fin de trimestre pour deux classes.', createdAt: iso(3) },
      { id: 703, contactName: 'Comite Ancien', email: 'ancien@test.be', phone: '', occasion: 'groupe', requestedDate: '', pax: 12, status: 'handled', message: 'Deja repondu la semaine derniere.', createdAt: iso(200) },
    ];

    const comms = [
      { id: 91, direction: 'inbound', recipient: 'ansar@test.be', subject: 'Team building 70 personnes', body: 'Bonjour, nous cherchons une formule pour 70 personnes le 12 octobre. Merci d avance.', status: 'received', createdAt: iso(26), sentAt: iso(26), payload: {} },
      // Mail SANS payload.textBody : le seul texte disponible est dans le HTML.
      // C est le cas qui cassait l affichage, et donc celui que ce gate garde.
      { id: 92, direction: 'outbound', recipient: 'ansar@test.be', subject: "C'est confirme : on vous attend jeudi 20 aout", status: 'sent', createdAt: iso(4), sentAt: iso(4), payload: {}, body: shell('Laser Game, 4 personnes, jeudi 20 aout a 14:00. Le paiement se fait sur place.', 'Votre reservation est confirmee', ['Bonjour Ansar,', 'Nous confirmons votre venue jeudi 20 aout a 14:00 pour 4 personnes.', 'A tres vite.']) },
      { id: 93, direction: 'outbound', recipient: 'ansar@test.be', subject: 'Proposition pour votre team building', status: 'queued', createdAt: iso(1), sentAt: null, payload: { textBody: 'Bonjour Ansar,\n\nVoici notre proposition pour 70 personnes.\n\nA tres vite.' }, body: shell('Proposition team building', 'Proposition', ['Bonjour Ansar,']) },
    ];

    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && String(init.method || 'GET').toUpperCase() === 'POST') return J({ ok: true });
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
  await pg.evaluate(() => window.openStaffRequestsPage(701));
  await pg.waitForTimeout(1800);

  console.log('');
  console.log('[La forme : une boite de reception, pas une pile de cartes]');
  const shape = await pg.evaluate(() => ({
    rail: !!document.querySelector('.req-rail'),
    items: document.querySelectorAll('.req-item').length,
    details: document.querySelectorAll('.req-detail').length,
    threads: document.querySelectorAll('.req-thread').length,
    openId: (document.querySelector('.req-card[data-request-id]') || {}).dataset ? document.querySelector('.req-card[data-request-id]').dataset.requestId : '',
    activeItems: document.querySelectorAll('.req-item.is-active').length,
    head: (() => {
      const h = document.querySelector('.req-detail-head');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { h: Math.round(r.height), name: ((h.querySelector('h3') || {}).textContent || '').trim(), badge: !!h.querySelector('.cr-badge') };
    })(),
    searchBox: (() => {
      const f = document.querySelector('.req-search-field');
      if (!f) return null;
      const style = window.getComputedStyle(f);
      return { height: Math.round(f.getBoundingClientRect().height), padLeft: style.paddingLeft };
    })(),
  }));
  ok(shape.rail && shape.items === 2, `la file liste les demandes actives (${shape.items} lignes)`);
  ok(shape.details === 1 && shape.threads === 1, `une seule demande ouverte et UN seul fil a l ecran (${shape.details} detail, ${shape.threads} fil)`);
  ok(shape.openId === '701', `c est bien la demande demandee qui est ouverte (${shape.openId})`);
  ok(shape.activeItems === 1, 'exactement une ligne de la file est designee comme active');
  // L en-tete porte le NOM du client et son statut. Il a disparu une fois
  // pendant la refonte sans qu aucune assertion ne bronche : la page restait
  // « jolie » et ne disait plus a qui on repond.
  ok(shape.head && shape.head.h >= 40 && /Ansar/.test(shape.head.name) && shape.head.badge,
    `l en-tete nomme le client et son statut (${shape.head ? shape.head.name + ', ' + shape.head.h + 'px' : 'absent'})`);
  ok(shape.searchBox && shape.searchBox.height <= 36 && parseInt(shape.searchBox.padLeft, 10) >= 26,
    `le champ de recherche garde sa place pour la loupe (${shape.searchBox ? shape.searchBox.height + 'px, padding ' + shape.searchBox.padLeft : 'absent'})`);

  console.log('');
  console.log('[Le mail se LIT : zero balise a l ecran]');
  const board = await pg.evaluate(() => (document.querySelector('.req-board') || {}).innerText || '');
  ok(!/<meta|<html|<head|doctype|charset=utf-8|font-size:|role="presentation"/i.test(board),
    'aucune balise ni style ne traine dans le texte visible');
  ok(!/\u200b|&#8203;|&nbsp;/.test(board), 'le bourrage invisible du preheader ne fuit pas dans l apercu');
  ok(/Nous confirmons votre venue jeudi 20 aout/.test(board) || /Bonjour Ansar/.test(board),
    'la PHRASE du mail est lisible dans l apercu');

  console.log('');
  console.log('[Le detail du mail deplie]');
  await pg.evaluate(() => window.toggleStaffRequestMessage('92'));
  await pg.waitForTimeout(420);
  const opened = await pg.evaluate(() => {
    const msg = document.querySelector('.req-msg[data-msg-id="92"]');
    const body = msg ? (msg.querySelector('.req-msg-body') || {}).textContent || '' : '';
    return {
      open: !!(msg && msg.classList.contains('is-open')),
      body,
      height: msg ? msg.querySelector('.req-msg-panel-clip').getBoundingClientRect().height : 0,
      hasHtmlToggle: !!(msg && msg.querySelector('.req-msg-view')),
    };
  });
  ok(opened.open && opened.height > 20, `le mail se deplie vraiment (hauteur ${Math.round(opened.height)}px)`);
  ok(/Nous confirmons votre venue jeudi 20 aout a 14:00 pour 4 personnes\./.test(opened.body),
    'le corps deplie rend le texte du mail, pas son gabarit');
  ok(!/<|style=|charset/i.test(opened.body), 'et rien du HTML ne subsiste dans ce corps');
  ok(opened.hasHtmlToggle, 'le rendu original reste consultable (bascule Texte / Mail recu)');

  console.log('');
  console.log('[Le rendu original s ouvre dans un cadre ISOLE]');
  await pg.evaluate(() => window.setStaffRequestMessageView('92', 'rendu'));
  await pg.waitForTimeout(600);
  const frame = await pg.evaluate(() => {
    const el = document.querySelector('.req-msg[data-msg-id="92"] .req-msg-frame');
    return el ? { present: true, sandbox: el.getAttribute('sandbox'), hasSrc: !!el.getAttribute('srcdoc') } : { present: false };
  });
  ok(frame.present && frame.hasSrc, 'le mail original est rendu dans un cadre');
  ok(frame.sandbox === '', 'ce cadre est en bac a sable total : ni script, ni acces a la console');
  await pg.evaluate(() => window.setStaffRequestMessageView('92', 'texte'));
  await pg.waitForTimeout(300);

  console.log('');
  console.log('[Un mail en file n est pas un mail parti]');
  const statuses = await pg.evaluate(() => [...document.querySelectorAll('.req-msg-status')].map((s) => s.textContent.trim()));
  ok(statuses.includes('en file'), `le statut se dit (${statuses.join(' | ')})`);
  ok(statuses.includes('envoyé') && statuses.includes('reçu'), 'envoye et recu se distinguent');

  console.log('');
  console.log('[Changer de demande change le detail, et lui seul]');
  await pg.evaluate(() => window.selectStaffRequest(702));
  await pg.waitForTimeout(1200);
  const switched = await pg.evaluate(() => ({
    openId: (document.querySelector('.req-card[data-request-id]') || {}).getAttribute('data-request-id'),
    name: ((document.querySelector('.req-detail-ident h3') || {}).textContent || '').trim(),
    details: document.querySelectorAll('.req-detail').length,
  }));
  ok(switched.openId === '702' && /Saint-Roch/.test(switched.name), `la demande ouverte a change (${switched.name})`);
  ok(switched.details === 1, 'toujours un seul detail : rien ne s empile');

  console.log('');
  console.log('[La recherche filtre la file]');
  await pg.evaluate(() => window.staffRequestSearchInput('roch'));
  await pg.waitForTimeout(500);
  const filtered = await pg.evaluate(() => document.querySelectorAll('.req-item').length);
  ok(filtered === 1, `la recherche ramene la file a la seule demande qui correspond (${filtered})`);
  await pg.evaluate(() => window.staffRequestSearchInput(''));
  await pg.waitForTimeout(400);

  console.log('');
  console.log('[La saisie survit au repaint]');
  await pg.evaluate(() => window.selectStaffRequest(701));
  await pg.waitForTimeout(700);
  await pg.evaluate(() => window.toggleStaffRequestReply(701));
  await pg.waitForTimeout(500);
  const typing = await pg.evaluate(async () => {
    const field = document.getElementById('reqBody-701');
    if (!field) return { ok: false };
    field.focus();
    field.setSelectionRange(8, 8);
    // Repaint force, exactement ce que fait une reponse reseau qui arrive.
    renderStaffUtilityPage();
    await new Promise((r) => setTimeout(r, 60));
    const again = document.getElementById('reqBody-701');
    return { ok: true, focused: document.activeElement === again, caret: again ? again.selectionStart : -1 };
  });
  ok(typing.ok && typing.focused, 'le champ garde le focus quand la page se repeint');
  ok(typing.caret === 8, `et le curseur reste ou il etait (position ${typing.caret})`);

  console.log('');
  console.log('[Captures]');
  await pg.evaluate(() => window.toggleStaffRequestReply(701));
  await pg.waitForTimeout(400);
  // Un mail DEPLIE sur la capture : c est la preuve visuelle du correctif.
  const stillOpen = await pg.evaluate(() => !!document.querySelector('.req-msg[data-msg-id="92"].is-open'));
  if (!stillOpen) await pg.evaluate(() => window.toggleStaffRequestMessage('92'));
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: p.join(SHOTS, 'inbox-dark.png'), fullPage: false });
  await pg.evaluate(() => { if (typeof setStaffTheme === 'function') setStaffTheme('light'); });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: p.join(SHOTS, 'inbox-light.png'), fullPage: false });
  await pg.evaluate(() => { if (typeof setStaffTheme === 'function') setStaffTheme('dark'); });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => window.toggleStaffRequestReply(701));
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: p.join(SHOTS, 'inbox-composer.png'), fullPage: false });
  await pg.setViewportSize({ width: 420, height: 900 });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: p.join(SHOTS, 'inbox-mobile.png'), fullPage: false });
  console.log('ok    captures ecrites dans artifacts/requests-inbox/');
  await pg.setViewportSize({ width: 1500, height: 1150 });

  console.log('');
  console.log('[Contre-epreuve : ce gate sait-il rougir ?]');
  // On reinjecte le gabarit LA OU il fuyait : dans la ligne d apercu, qui est
  // toujours visible. Un corps replie est masque pour de vrai (visibility),
  // donc innerText ne le lit pas : la sonde y serait aveugle sans le dire.
  const blind = await pg.evaluate(() => {
    const node = document.querySelector('.req-msg-preview');
    if (!node) return null;
    node.textContent = '<!doctype html><meta charset="utf-8">';
    return /<meta|doctype/i.test(document.querySelector('.req-board').innerText);
  });
  ok(blind === true, 'gabarit reinjecte expres : la sonde le voit -> le gate ROUGIRAIT');
  ok(errs.length === 0, 'zero erreur console (' + errs.length + (errs.length ? ' : ' + errs[0] : '') + ')');

  await b.close();
  srv.close();
  if (failures) { console.error('requests-inbox-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('');
  console.log('requests-inbox-check: ALL OK - le mail se lit, la page a une forme.');
});
