// L'ONGLET « MODIFIER » ENREGISTRE VRAIMENT, ET PARLE LA LANGUE DU TYPE.
// Movsar, sur capture : « quand on va dans modifier rien ne fonctionne ça
// fonctionne vrm pas », et « quand on va dans modifier pour un truc de laser
// game ça montre comme pour du bowling ».
// Deux defauts mesures au harnais :
//   1. le poll (~1,2 s) reconstruisait l etat d edition depuis le serveur
//      pendant la frappe. Le champ gardait la saisie (le DOM n est pas
//      re-rendu) mais l etat repartait des valeurs d origine : le PATCH
//      renvoyait la reservation INCHANGEE, avec un « Réservation mise à
//      jour » parfaitement mensonger.
//   2. la fiche parlait bowling a tout le monde : huit pistes affichees pour
//      une session laser qui n'en occupe aucune.
const PORT_ENV = Number(process.env.PINLANE_EDITSHEET_PORT || 4229);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = 'C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head';
const { chromium } = require(p.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = PORT_ENV;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

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

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()); });
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await pg.addInitScript((expiresAt) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'clients.view', 'payments.view', 'payments.markPaid', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // DATE LOCALE, comme l'app (todayStr). `toISOString()` rend de l'UTC :
    // passe minuit a Bruxelles, la fixture se serait posee la veille pendant
    // que la console affiche aujourd hui, et le gate aurait rougi sans qu'un
    // seul defaut de produit existe. Meme classe que les fixtures datees du
    // 2026-08-08.
    const localDay = new Date();
    const today = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;
    const R = [
      { id: 1332, name: 'TEST', phone: '+32487784816', email: 't@x.be', date: today, startTime: '10:00', duration: 1.5, pax: 23, price: 236, basePrice: 236, type: 'bowling', label: 'Bowling Classique', lanes: [3, 4, 5, 6], status: 'paid', centerId: 'libramont', channel: 'staff', activityProgress: {}, extras: [] },
      { id: 1333, name: 'LASER TEST', phone: '+32487784817', email: 'l@x.be', date: today, startTime: '14:00', duration: 0.5, pax: 10, price: 100, basePrice: 100, type: 'laser', label: 'Laser Game', lanes: [], status: 'pending', centerId: 'libramont', channel: 'staff', laserGames: 1, activityProgress: {}, extras: [] },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.__QA_PATCH__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { window.__QA_POLLS__ = (window.__QA_POLLS__ || 0) + 1; return J({ ok: true, revision: 'qa', reservations: R, laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' }); }
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: R, laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_PATCH__.push(body);
        const base = R.find((r) => String(r.id) === String(body.id)) || R[0];
        return J({ ok: true, reservation: { ...base, ...body } });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: [], activities: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, expiresAt);

  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof window.setView === 'function');
  await pg.evaluate(() => window.setView('staff'));
  await pg.waitForTimeout(1800);

  for (const [id, kind] of [[1332, 'BOWLING'], [1333, 'LASER']]) {
    console.log('');
    console.log('[' + kind + ' #' + id + ']');
    // Attendre que le planning ait REELLEMENT rendu la reservation avant de
    // cliquer : dans la chaine complete la machine est chargee, et un delai
    // fixe transforme un gate juste en gate qui rougit au hasard.
    await pg.waitForFunction((rid) => [...document.querySelectorAll('[onclick]')]
      .some((n) => String(n.getAttribute('onclick') || '').includes(String(rid))), id, { timeout: 20000 });
    await pg.evaluate((rid) => {
      const el = [...document.querySelectorAll('[onclick]')].find((n) => String(n.getAttribute('onclick') || '').includes(String(rid)));
      if (el) el.click();
    }, id);
    await pg.waitForSelector('.pos-tabs, .edit-form, [role="tab"]', { timeout: 15000 }).catch(() => {});
    await pg.evaluate(() => {
      const tab = [...document.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test(t.textContent.trim()));
      if (tab) tab.click();
    });
    // Le formulaire EST la condition d'entree du test : on l'attend au lieu de
    // parier sur une duree.
    await pg.waitForSelector('.edit-form #editNameInput', { timeout: 20000 });

    const form = await pg.evaluate(() => ({
      hasForm: !!document.querySelector('.edit-form'),
      lanePicker: !!document.querySelector('.lane-picker'),
      labels: [...document.querySelectorAll('.edit-form .lbl')].map((l) => l.textContent.trim()),
    }));
    ok(form.hasForm, 'le formulaire de modification est rendu');
    if (kind === 'BOWLING') {
      ok(form.lanePicker, 'bowling : le selecteur de pistes est la');
      ok(form.labels.includes('Durée'), 'bowling : la duree se compte en heures');
      ok(!form.labels.includes('Parties'), 'bowling : aucune notion de parties laser');
    } else {
      ok(!form.lanePicker, 'laser : AUCUN selecteur de pistes (il n en occupe pas)');
      ok(form.labels.includes('Parties'), 'laser : la duree se compte en PARTIES');
      ok(form.labels.includes('Sessions'), 'laser : ses sessions sont dites a la place des pistes');
      ok(!form.labels.includes('Pistes'), 'laser : le mot « Pistes » a disparu de sa fiche');
    }

    // LE COEUR : on tape, le poll passe, et l'enregistrement doit porter la
    // saisie. C'est ce qui ne marchait pas.
    await pg.fill('#editNameInput', 'NOUVEAU NOM');
    await pg.fill('#editPaxInput', '12');
    const pollsBefore = await pg.evaluate(() => window.__QA_POLLS__ || 0);
    // On attend qu'un VRAI rafraichissement passe, on ne le suppose pas : sans
    // cette preuve, « la saisie survit au poll » serait vert parce que rien ne
    // s'est produit, pas parce que le produit tient.
    await pg.waitForFunction((n) => (window.__QA_POLLS__ || 0) > n, pollsBefore, { timeout: 20000 });
    const pollsAfter = await pg.evaluate(() => window.__QA_POLLS__ || 0);
    ok(pollsAfter > pollsBefore, 'un rafraichissement automatique a REELLEMENT eu lieu pendant la saisie (' + pollsBefore + ' -> ' + pollsAfter + ')');
    const survived = await pg.evaluate(() => ({
      name: (document.getElementById('editNameInput') || {}).value,
      pax: (document.getElementById('editPaxInput') || {}).value,
    }));
    ok(survived.name === 'NOUVEAU NOM' && survived.pax === '12',
      'la saisie survit au rafraichissement automatique (' + JSON.stringify(survived) + ')');

    await pg.evaluate(() => {
      const f = document.querySelector('.edit-form');
      if (f) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await pg.waitForTimeout(1200);
    const sent = await pg.evaluate((rid) => (window.__QA_PATCH__ || []).filter((x) => String(x.id) === String(rid)).slice(-1)[0] || null, id);
    ok(sent && sent.name === 'NOUVEAU NOM', 'l enregistrement porte le NOM saisi (' + (sent ? sent.name : 'aucun envoi') + ')');
    ok(sent && Number(sent.pax) === 12, 'l enregistrement porte les JOUEURS saisis (' + (sent ? sent.pax : 'n/a') + ')');
    if (kind === 'BOWLING') {
      ok(sent && Array.isArray(sent.lanes) && sent.lanes.length === 2,
        '12 joueurs sur 6 par piste : 2 pistes reattribuees (' + (sent ? JSON.stringify(sent.lanes) : 'n/a') + ')');
    } else {
      ok(sent && Array.isArray(sent.lanes) && sent.lanes.length === 0,
        'laser : aucune piste envoyee (' + (sent ? JSON.stringify(sent.lanes) : 'n/a') + ')');
    }
    await pg.evaluate(() => { if (typeof closePos === 'function') closePos(); });
    await pg.waitForTimeout(400);
  }

  console.log('');
  console.log('[Contre-epreuve : le defaut rejoue, ce gate le voit-il ?]');
  // On refait vivre la panne : le DOM montre la saisie, l'etat est ramene aux
  // valeurs du serveur (ce que faisait le poll). Si l'envoi repart sur les
  // valeurs d'origine, la sonde d'enregistrement le detecte -> elle rougirait.
  await pg.evaluate((rid) => { window.__QA_PATCH__ = []; if (typeof openPos === 'function') openPos(rid); }, 1332);
  await pg.waitForTimeout(700);
  await pg.evaluate(() => {
    const tab = [...document.querySelectorAll('button, a, [role=\"tab\"]')].find((t) => /^Modifier$/i.test((t.textContent || '').trim()));
    if (tab) tab.click();
  });
  await pg.waitForSelector('.edit-form #editNameInput', { timeout: 20000 });
  await pg.fill('#editNameInput', 'SAISIE HUMAINE');
  // L'ecrasement d'antan, rejoue a la main par la fonction du produit.
  await pg.evaluate(() => { if (typeof setEditField === 'function') setEditField('name', 'TEST'); });
  // On lit l'ecran AVANT d'enregistrer : la fiche se referme apres, et un champ
  // disparu rendrait une chaine vide qu'on prendrait pour une mesure.
  const domKept = await pg.evaluate(() => (document.getElementById('editNameInput') || {}).value || '');
  await pg.evaluate(() => {
    const f = document.querySelector('.edit-form');
    if (f) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await pg.waitForTimeout(1200);
  const regressed = await pg.evaluate(() => (window.__QA_PATCH__ || []).slice(-1)[0] || null);
  ok(regressed && regressed.name === 'TEST' && domKept === 'SAISIE HUMAINE',
    'defaut rejoue : ecran « ' + domKept + ' » mais envoi « ' + (regressed ? regressed.name : 'aucun') + ' » -> le gate ROUGIRAIT');

  await b.close();
  srv.close();
  if (failures) { console.error(''); console.error('edit-sheet-check: ' + failures + ' echec(s).'); process.exit(1); }
  console.log('');
  console.log('edit-sheet-check: ALL OK - la fiche enregistre vraiment et parle la langue du type.');
});
