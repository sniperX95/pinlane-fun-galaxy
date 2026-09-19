// Test INTERACTIF du segment « À venir » de la page Clients (refonte 2026-08-13).
// Playwright pilote de vrais clics. Il prouve QUATRE choses :
//   1. la page « Groupes & anniversaires » n'existe plus et tous ses chemins
//      d'accès retombent sur Clients / « À venir » ;
//   2. la vue liste TOUTES les réservations à venir, pas seulement celles des
//      profils classés « groupe » ou « anniversaire » (contre-épreuve : une
//      réservation de 2 personnes doit y être) ;
//   3. ce qui MANQUE est lu dans la donnée et disparaît quand on comble le
//      manque (contre-épreuve par mutation de la réservation) ;
//   4. tout ce qui a été supprimé l'est VRAIMENT : cartes, pastilles de
//      préparation, mètre « x/6 prêt », ligne d'habitudes, facettes
//      d'occasion, second champ de recherche, panneaux « À confirmer en
//      priorité » et « Charge à venir ».
// Cf. leçon ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_GROUPS_PORT || 4205);
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
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.edit','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Dates RELATIVES À AUJOURD'HUI RÉEL (la page s'ancre à todayStr(), pas state.currentDate).
    const base = new Date(); base.setHours(12, 0, 0, 0);
    const dstr = (o) => { const d = new Date(base); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
    const iso = (o) => { const d = new Date(base); d.setDate(d.getDate() + o); return d.toISOString(); };
    const R = []; let id = 8000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: iso(-1), ...o }); };
    // Anniversaire habitué (Marie) : passé + FUTUR (dans 4 j)
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-40), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-15), startTime: '16:00', pax: 10, price: 390, type: 'formule', formuleId: 'f1', label: 'FORMULE 1', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(4), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire', status: 'pending' });
    // Entreprise (groupe) : FUTUR (dans 10 j, acompte non payé → readiness bas)
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-60), startTime: '19:00', pax: 24, price: 720, type: 'bowling', label: 'Bowling 2h', lanes: [3,4,5], duration: 2, occasion: 'entreprise' });
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(10), startTime: '18:00', pax: 30, price: 900, type: 'laser', label: 'Laser', occasion: 'entreprise', status: 'pending' });
    // École (groupe) : FUTUR (dans 20 j)
    add({ name: 'École Saint-Jean', phone: '+32470111006', email: 'ecole@test.be', date: dstr(-5), startTime: '13:00', pax: 20, price: 300, type: 'formule', formuleId: 'f6', label: 'FORMULE 6', occasion: 'ecole' });
    add({ name: 'École Saint-Jean', phone: '+32470111006', email: 'ecole@test.be', date: dstr(20), startTime: '13:00', pax: 22, price: 330, type: 'formule', formuleId: 'f6', label: 'FORMULE 6', occasion: 'ecole', status: 'pending' });
    // Petit client NON-groupe : 2 personnes, un mardi soir. L'ancienne vue le
    // faisait DISPARAÎTRE (elle ne prenait que les profils groupe/anniversaire),
    // alors que c'est une venue à préparer comme une autre.
    add({ name: 'Paul Solo', phone: '+32470111099', email: 'paul@test.be', date: dstr(-2), startTime: '17:00', pax: 2, price: 40, type: 'bowling', label: 'Bowling', lanes: [6] });
    add({ id: 8900, name: 'Paul Solo', phone: '+32470111099', email: 'paul@test.be', date: dstr(2), startTime: '17:00', pax: 2, price: 40, type: 'bowling', label: 'Bowling', lanes: [6], status: 'pending' });
    // Réservation SANS email : le seul manque de contact du jeu de données.
    add({ id: 8901, name: 'Sans Adresse', phone: '+32470111077', email: '', date: dstr(3), startTime: '20:00', pax: 6, price: 120, type: 'laser', label: 'Laser', status: 'pending' });
    // DEUXIÈME venue le même jour que Paul : sans elle, chaque séparateur de
    // jour n'annoncerait qu'une ligne et sa recomposition serait triviale.
    add({ id: 8902, name: 'Duo Tardif', phone: '+32470111088', email: 'duo@test.be', date: dstr(2), startTime: '20:00', pax: 8, price: 200, type: 'laser', label: 'Laser', status: 'pending' });
    const build = () => R.map(r => ({ ...r }));
    const customRequests = [
      { id: 'cr1', contactName: 'Team Acme', company: 'Acme SA', email: 'events@acme.be', phone: '+32470999001', requestedDate: dstr(30), pax: 40, occasion: 'entreprise', message: 'Séminaire 40 pers, besoin devis', status: 'new', createdAt: iso(-1) },
      { id: 'cr2', contactName: 'Julie', company: '', email: 'julie@test.be', phone: '+32470999002', requestedDate: dstr(14), pax: 15, occasion: 'anniversaire', message: 'Anniv 15 enfants', status: 'in_progress', createdAt: iso(-3) },
    ];
    const comms = [{ id: 1, recipient: 'marie@test.be', reservationId: 8000, templateId: 'confirmation', subject: 'Confirmé', sentAt: iso(-38), status: 'delivered', direction: 'outbound' }];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0,10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '14:00', close: '22:00' }, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.__QA_BUILD__ = build;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=grp-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.staffMenuPage = 'planning'; state.staffTheme = 'dark'; state.staffClientSegment = 'tous';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(500);

    // [REDIRECT] la page « groups » n'existe plus : elle vit dans Clients (« À venir »)
    console.log('\n[REDIRECT] openStaffMenuPage("groups") → Clients, segment « À venir »');
    await page.evaluate(() => openStaffMenuPage('groups'));
    await page.waitForTimeout(600);
    await page.evaluate(async () => { try { if (typeof loadStaffCustomRequests === 'function') await loadStaffCustomRequests(true); } catch (e) {} });
    await page.waitForTimeout(400);
    const redir = await page.evaluate(() => ({
      page: state.staffMenuPage,
      segment: state.staffClientSegment,
      visible: !!document.getElementById('staffClientsPage') && !document.getElementById('staffClientsPage').classList.contains('hidden'),
      activeSeg: ((document.querySelector('#staffClientsPage .crm-seg.is-active .crm-seg-label') || {}).textContent || '').trim(),
      menuGroups: !![...document.querySelectorAll('button, a')].find((el) => /groupes & anniversaires/i.test(el.textContent || '')),
    }));
    ok(redir.page === 'clients', `staffMenuPage = clients (obtenu ${redir.page})`);
    ok(redir.segment === 'avenir', `segment = avenir (obtenu ${redir.segment})`);
    ok(redir.visible, 'conteneur clients affiché');
    ok(redir.activeSeg === 'À venir', `segment « À venir » actif (obtenu « ${redir.activeSeg} »)`);
    ok(!redir.menuGroups, 'entrée menu « Groupes & anniversaires » supprimée');

    // [LEGACY] un ancien onglet avec staffMenuPage='groups' sauvegardé retombe aussi sur Clients
    await page.evaluate(() => { state.staffMenuPage = 'groups'; save(); renderStaffData(); });
    await page.waitForTimeout(400);
    const legacy = await page.evaluate(() => ({ page: state.staffMenuPage, segment: state.staffClientSegment }));
    ok(legacy.page === 'clients' && legacy.segment === 'avenir', `état sauvegardé "groups" → redirigé (${legacy.page}/${legacy.segment})`);

    const root = '#staffClientsPage';
    // Affectation directe : setStaffClientSegment('avenir') sur un segment DÉJÀ
    // actif est un re-clic, il ramène à « Tous » (comportement voulu de la barre).
    await page.evaluate(() => { state.staffClientSegment = 'avenir'; state.staffClientListLimit = 40; save(); renderStaffClientsPage(); });
    await page.waitForTimeout(500);

    console.log('\n[LISTE] la MÊME table que « Tous », cinq colonnes, une ligne par venue');
    const liste = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const table = el.querySelector('.crm-table-avenir');
      const heads = table ? [...table.querySelectorAll('thead th')].map((h) => h.textContent.trim()) : [];
      const dayRows = table ? [...table.querySelectorAll('tbody tr.crm-day')] : [];
      const visitRows = table ? [...table.querySelectorAll('tbody tr:not(.crm-day)')] : [];
      const panel = el.querySelector('.crm-list-panel');
      const wrap = el.querySelector('.crm-table-wrap');
      return {
        hasTable: !!table,
        heads,
        days: dayRows.length,
        dayText: dayRows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
        visits: visitRows.length,
        rowHeight: visitRows[0] ? Math.round(visitRows[0].getBoundingClientRect().height) : 0,
        fontSize: visitRows[0] ? getComputedStyle(visitRows[0].querySelector('td')).fontSize : '',
        panelMax: panel ? getComputedStyle(panel).maxHeight : '',
        scrollsInside: !!wrap && wrap.scrollHeight > wrap.clientHeight + 1,
        pageHeight: Math.round(document.documentElement.scrollHeight),
        names: visitRows.map((r) => (r.querySelector('.crm-client-id strong') || {}).textContent || ''),
        foot: (el.querySelector('.crm-list-foot') || {}).textContent || '',
      };
    }, root);
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(liste.hasTable, 'la vue est une table .crm-table-avenir, pas un empilement de cartes');
    ok(liste.heads.join('|') === 'Heure|Client|Réservation|Joueurs|', `5 colonnes exactes (obtenu « ${liste.heads.join(' | ')} »)`);
    ok(liste.visits === 6, `6 réservations à venir listées (obtenu ${liste.visits})`);
    ok(liste.days === 5, `un séparateur par jour, 5 jours pour 6 venues (obtenu ${liste.days})`);
    ok(liste.fontSize === '12.5px', `corps de texte identique à « Tous » : 12,5 px (obtenu ${liste.fontSize})`);
    ok(liste.rowHeight > 0 && liste.rowHeight <= 60, `ligne dense (${liste.rowHeight} px, la carte d'avant en faisait 265)`);
    ok(liste.panelMax === '720px', `panneau borné à 720 px comme « Tous » (obtenu ${liste.panelMax})`);
    ok(liste.pageHeight < 1600, `page courte (${liste.pageHeight} px ; l'ancienne vue en faisait 4 372 avec 14 dossiers)`);
    ok(/6 affichées sur 6/.test(liste.foot.replace(/\s+/g, ' ')), `pied de liste qui dit ce qu'on voit (« ${liste.foot.replace(/\s+/g, ' ').trim()} »)`);

    // Le séparateur de jour doit se RECOMPOSER : son total de joueurs est la
    // somme des lignes qu'il annonce, sinon c'est un chiffre de façade.
    const recompose = await page.evaluate((sel) => {
      const rows = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr')];
      const out = [];
      let head = null; let sum = 0; let count = 0;
      const flush = () => { if (head) out.push({ head, sum, count }); };
      rows.forEach((r) => {
        if (r.classList.contains('crm-day')) { flush(); head = r.textContent.replace(/\s+/g, ' ').trim(); sum = 0; count = 0; return; }
        sum += Number((r.querySelector('td.num') || {}).textContent || 0); count += 1;
      });
      flush();
      return out.map((b) => ({
        ok: b.head.includes(`${b.count} réservation`) && b.head.includes(`${b.sum} joueur`),
        head: b.head,
      }));
    }, root);
    ok(recompose.some((b) => /2 réservations · 10 joueurs/.test(b.head)), `un jour porte DEUX venues et son total les additionne (${JSON.stringify(recompose.map((b) => b.head))})`);
    ok(recompose.length > 0 && recompose.every((b) => b.ok), `chaque en-tête de jour se recompose (${recompose.filter((b) => b.ok).length}/${recompose.length})`);

    console.log('\n[PORTÉE] la vue montre TOUTES les venues, pas seulement les « groupes »');
    ok(liste.names.includes('Paul Solo'), 'une réservation de 2 personnes (profil non-groupe) est listée : c\'est le filtre groupe/anniversaire qui a sauté');
    ok(!liste.names.includes('Client fantôme'), 'aucune ligne inventée');
    const passe = await page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr td.crm-cell-time strong')].length, root);
    ok(passe === 6, `aucune réservation PASSÉE dans la liste (${passe} lignes horodatées pour 6 venues futures)`);

    console.log('\n[MANQUE] deux faits seulement, lus dans la donnée, et ils disparaissent quand on comble');
    const gaps = await page.evaluate((sel) => {
      const rows = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')];
      const read = (name) => {
        const tr = rows.find((r) => ((r.querySelector('.crm-client-id strong') || {}).textContent || '') === name);
        return tr ? ((tr.querySelector('.crm-cell-badge .crm-pill') || {}).textContent || '') : null;
      };
      return {
        marie: read('Marie Dupont'),        // formule sans piste ni opsPlan
        paul: read('Paul Solo'),            // bowling AVEC piste + contact complet
        sansMail: read('Sans Adresse'),     // laser, pas de piste requise, pas d'email
        labels: [...new Set(rows.map((r) => ((r.querySelector('.crm-cell-badge .crm-pill') || {}).textContent || '')).filter(Boolean))],
      };
    }, root);
    ok(gaps.marie === 'Piste à placer', `formule sans ressource → « Piste à placer » (obtenu « ${gaps.marie} »)`);
    ok(gaps.paul === '', `bowling avec sa piste et un contact complet → rien à signaler (obtenu « ${gaps.paul} »)`);
    ok(gaps.sansMail === 'Contact incomplet', `réservation sans email → « Contact incomplet » (obtenu « ${gaps.sansMail} »)`);
    ok(gaps.labels.every((l) => ['Piste à placer', 'Contact incomplet'].includes(l)), `deux libellés possibles, pas six pastilles (obtenu ${JSON.stringify(gaps.labels)})`);

    // CONTRE-ÉPREUVE PAR MUTATION : on place la piste, le manque doit tomber.
    const comble = await page.evaluate((sel) => {
      state.reservations = state.reservations.map((r) => (String(r.name) === 'Marie Dupont' && r.status === 'pending' ? { ...r, lanes: [7, 8] } : r));
      renderStaffClientsPage();
      const rows = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')];
      const tr = rows.find((r) => ((r.querySelector('.crm-client-id strong') || {}).textContent || '') === 'Marie Dupont');
      return tr ? ((tr.querySelector('.crm-cell-badge .crm-pill') || {}).textContent || '') : null;
    }, root);
    ok(comble === '', `piste attribuée → le manque DISPARAÎT (obtenu « ${comble} ») : la colonne lit la donnée`);

    console.log('\n[SUPPRIMÉ] ce qui devait partir est parti');
    const gone = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const txt = el.textContent || '';
      const q = (s) => el.querySelectorAll(s).length;
      return {
        cartes: q('.groups-dossier'),
        pastilles: q('.groups-check-toggle, .groups-check'),
        metre: q('.groups-readiness, .groups-readiness-bar'),
        memo: q('.groups-memo'),
        facettes: q('.groups-facet'),
        prepFirst: q('.groups-prepfirst'),
        historique: q('.groups-history'),
        priorite: /À confirmer en priorité/i.test(txt),
        charge: /Charge à venir/i.test(txt),
        habitudes: /Habitué·e|vient à ~|réserve ~|annule (rarement|souvent)/i.test(txt),
        pretMetre: /\d\/\d prêt/.test(txt),
        recherches: q('input[type="search"], .crm-search input, .groups-search input'),
        boutonsVisibles: [...el.querySelectorAll('button')].filter((b) => b.offsetParent !== null).length,
      };
    }, root);
    ok(gone.cartes === 0, `zéro carte dossier (${gone.cartes})`);
    ok(gone.pastilles === 0, `zéro pastille de préparation (${gone.pastilles})`);
    ok(gone.metre === 0 && !gone.pretMetre, `zéro mètre « x/6 prêt » (${gone.metre})`);
    ok(gone.memo === 0 && !gone.habitudes, 'zéro ligne d\'habitudes en italique');
    ok(gone.facettes === 0 && gone.prepFirst === 0, `zéro facette d'occasion ni « À préparer d'abord » (${gone.facettes})`);
    ok(gone.historique === 0, `zéro dépliant « derniers passages » (${gone.historique})`);
    ok(!gone.priorite && !gone.charge, 'panneaux « À confirmer en priorité » et « Charge à venir » retirés');
    ok(gone.recherches === 1, `UN SEUL champ de recherche sur l'écran (obtenu ${gone.recherches})`);
    ok(gone.boutonsVisibles <= 30, `moins de 30 boutons visibles (obtenu ${gone.boutonsVisibles} ; l'ancienne vue en affichait 145)`);

    console.log('\n[ACTION] une seule action par ligne : la ligne entière ouvre la réservation');
    const clicOuvre = await page.evaluate((sel) => {
      const tr = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')]
        .find((r) => ((r.querySelector('.crm-client-id strong') || {}).textContent || '') === 'Paul Solo');
      tr.click();
      const overlay = document.getElementById('posOverlay');
      return { id: state.selectedRes ? state.selectedRes.id : null, visible: !!overlay && !overlay.classList.contains('hidden') };
    }, root);
    ok(clicOuvre.id === 8900 && clicOuvre.visible, `le clic ouvre la BONNE réservation (id ${clicOuvre.id}, fenêtre ${clicOuvre.visible ? 'affichée' : 'ABSENTE'})`);
    await page.evaluate(() => { closePos(); renderStaffClientsPage(); });
    await page.waitForTimeout(250);

    // CLAVIER : la ligne est focusable et Entrée fait la même chose que le clic.
    const clavier = await page.evaluate((sel) => {
      const tr = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')]
        .find((r) => ((r.querySelector('.crm-client-id strong') || {}).textContent || '') === 'Paul Solo');
      tr.focus();
      const focused = document.activeElement === tr;
      tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const overlay = document.getElementById('posOverlay');
      return { focused, tabindex: tr.getAttribute('tabindex'), role: tr.getAttribute('role'), id: state.selectedRes ? state.selectedRes.id : null, visible: !!overlay && !overlay.classList.contains('hidden') };
    }, root);
    ok(clavier.focused && clavier.tabindex === '0' && clavier.role === 'button', 'la ligne est atteignable au clavier (tabindex=0, role=button)');
    ok(clavier.id === 8900 && clavier.visible, 'Entrée ouvre la réservation, comme le clic');
    await page.evaluate(() => { closePos(); renderStaffClientsPage(); });
    await page.waitForTimeout(250);

    console.log('\n[RECHERCHE] le champ UNIQUE de la page filtre aussi cette liste');
    const cherche = await page.evaluate(async (sel) => {
      const input = document.querySelector(`${sel} .crm-search input`);
      input.focus();
      input.value = 'ecole';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const rows = [...document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')];
      const names = rows.map((r) => (r.querySelector('.crm-client-id strong') || {}).textContent || '');
      window.setStaffClientQuery('');
      await new Promise((r) => setTimeout(r, 400));
      const back = document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)').length;
      return { names, back };
    }, root);
    ok(cherche.names.length === 1 && /Saint-Jean/.test(cherche.names[0]), `la recherche réduit la liste à l'école (obtenu ${JSON.stringify(cherche.names)})`);
    ok(cherche.back === 6, `champ vidé → les 6 venues reviennent (obtenu ${cherche.back})`);

    console.log('\n[DEMANDES] les demandes sur mesure gardent leur panneau et leurs actions');
    const leads = await page.evaluate((sel) => {
      const side = document.querySelector(`${sel} .crm-avenir-side`);
      const cards = side ? side.querySelectorAll('.cr-card') : [];
      return {
        present: !!side,
        cards: cards.length,
        acme: /Team Acme/.test(side ? side.textContent : ''),
        actions: side ? [...side.querySelectorAll('.cr-actions button')].map((b) => b.textContent.trim()) : [],
      };
    }, root);
    ok(leads.present && leads.cards === 2, `panneau « Demandes sur mesure » avec ses 2 demandes (obtenu ${leads.cards})`);
    ok(leads.acme, 'la demande entreprise est lisible');
    ok(leads.actions.includes('Répondre') && leads.actions.includes('Archiver'), `les actions de traitement survivent (${JSON.stringify([...new Set(leads.actions)])})`);

    console.log('\n[ANCRAGE] la liste reste ancrée à AUJOURD\'HUI RÉEL');
    const anchor = await page.evaluate((sel) => {
      const count = () => document.querySelector(sel).querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)').length;
      const before = count();
      state.currentDate = '2025-01-01';
      save(); renderStaffClientsPage();
      return { before, after: count() };
    }, root);
    ok(anchor.before === anchor.after && anchor.after === 6, `changer state.currentDate ne bouge pas la liste (${anchor.before} → ${anchor.after})`);

    console.log('\n[TOUS] l\'onglet de référence n\'a pas bougé');
    const tous = await page.evaluate((sel) => {
      setStaffClientSegment('tous');
      const el = document.querySelector(sel);
      return {
        cols: el.querySelectorAll('.crm-table thead th').length,
        rows: el.querySelectorAll('.crm-table tbody tr').length,
        fiche: !!el.querySelector('.crm-fiche'),
        avenirTable: el.querySelectorAll('.crm-table-avenir').length,
      };
    }, root);
    ok(tous.cols === 5 && tous.rows >= 4, `« Tous » : table 5 colonnes, ${tous.rows} clients`);
    ok(tous.fiche, '« Tous » : la fiche client de droite est toujours là');
    ok(tous.avenirTable === 0, '« Tous » ne rend pas la table « À venir »');

    if (errs.length) console.log('\nConsole errors:\n' + errs.join('\n'));
  } catch (e) {
    console.error('\ncrm-groups-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\ncrm-groups-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncrm-groups-check: ALL OK');
}
main();
