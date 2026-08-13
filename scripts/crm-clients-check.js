// Test INTERACTIF de la page Clients FUSIONNÉE (Clients + Groupes, KISS).
// Playwright pilote de vrais clics : 4 segments (re-clic → Tous), « À venir »
// = la liste dense des venues (refonte 2026-08-13), « À relancer » = dormants +
// anniversaires ~1 an, fiche 3 chiffres, export CSV, tri. Cf. ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CRM_PORT || 4201);
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
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.edit','reservations.status','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Fixtures RELATIVES À AUJOURD'HUI RÉEL (todayStr/staffGroupToday) → déterministes
    // quel que soit le jour d'exécution : dormance, fenêtre anniversaire 335-395 j,
    // dossiers « à venir » filtrés sur la date réelle.
    const dstr = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };
    const iso = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString(); };
    const R = [];
    let id = 7000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: iso(0), ...o }); };
    // A : Marie : 3 visites passées + 1 FUTURE (+6 j, anniversaire, 12 pax) → À venir 7 j + 🎂 + comms
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-40), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-15), startTime: '16:00', pax: 10, price: 390, type: 'formule', formuleId: 'f1', label: 'FORMULE 1', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-3), startTime: '14:00', pax: 8, price: 260, type: 'bowling', label: 'Bowling', lanes: [1, 2] });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(6), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire', status: 'pending' });
    // B : Entreprise Nova : gros dépensier → VIP (top 20 %)
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-8), startTime: '18:00', pax: 30, price: 900, type: 'laser', label: 'Laser', occasion: 'entreprise' });
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-60), startTime: '19:00', pax: 24, price: 720, type: 'bowling', label: 'Bowling 2h', lanes: [3, 4, 5], duration: 2, occasion: 'entreprise' });
    // C : Paul : 1 seule visite ancienne → PAS « à relancer » (contrôle négatif)
    add({ name: 'Paul Martin', phone: '+32470111003', email: 'paul@test.be', date: dstr(-130), startTime: '17:00', pax: 4, price: 80, type: 'bowling', label: 'Bowling', lanes: [6] });
    // D : Sophie : nouvelle
    add({ name: 'Sophie Bernard', phone: '+32470111004', email: 'sophie@test.be', date: dstr(-2), startTime: '14:30', pax: 6, price: 120, type: 'laser', label: 'Laser' });
    // E : Lucas : multi-visites récentes → pas dormant
    add({ name: 'Lucas Petit', phone: '+32470111005', email: 'lucas@test.be', date: dstr(-25), startTime: '20:00', pax: 5, price: 100, type: 'bowling', label: 'Bowling', lanes: [7] });
    add({ name: 'Lucas Petit', phone: '+32470111005', email: 'lucas@test.be', date: dstr(-1), startTime: '21:00', pax: 6, price: 130, type: 'bowling', label: 'Bowling', lanes: [8] });
    // F : Georges : 3 visites, dernière -100 j → DORMANT à relancer
    add({ name: 'Georges Dupuis', phone: '+32470111006', email: 'georges@test.be', date: dstr(-200), startTime: '18:00', pax: 4, price: 90, type: 'bowling', label: 'Bowling', lanes: [1] });

    add({ name: 'Georges Dupuis', phone: '+32470111006', email: 'georges@test.be', date: dstr(-150), startTime: '18:00', pax: 4, price: 85, type: 'bowling', label: 'Bowling', lanes: [2] });
    add({ name: 'Georges Dupuis', phone: '+32470111006', email: 'georges@test.be', date: dstr(-100), startTime: '18:00', pax: 5, price: 110, type: 'bowling', label: 'Bowling', lanes: [3] });
    // G : Famille Kessler : anniversaire fêté il y a ~370 j → À relancer (ça revient !)
    add({ name: 'Famille Kessler', phone: '+32470111007', email: 'kessler@test.be', date: dstr(-370), startTime: '15:00', pax: 10, price: 350, type: 'formule', formuleId: 'f2', label: 'FORMULE 2', occasion: 'anniversaire' });
    // H : CONTROLE NEGATIF du badge anniversaire. Formule anniversaire PASSEE
    // (f6) mais prochaine reservation ordinaire : aucun « Anniv. a venir ».
    // Telephone DISTINCT des autres : la cle client est le telephone, un
    // doublon fusionnerait ce temoin avec un client existant.
    add({ name: 'Nadia Klein', phone: '+32470111008', email: 'nadia@test.be', date: dstr(-30), startTime: '15:00', pax: 10, price: 280, type: 'formule', formuleId: 'f6', label: 'FORMULE 6' });
    add({ name: 'Nadia Klein', phone: '+32470111008', email: 'nadia@test.be', date: dstr(9), startTime: '19:00', pax: 4, price: 78, type: 'bowling', label: 'Bowling', lanes: [2], status: 'pending' });
    const build = () => R.map((r) => ({ ...r }));
    const comms = [
      { id: 1, recipient: 'marie@test.be', reservationId: 7000, templateId: 'confirmation', subject: 'Votre réservation est confirmée', sentAt: iso(-40), status: 'delivered', direction: 'outbound', channel: 'email' },
      { id: 2, recipient: 'marie@test.be', reservationId: 7001, templateId: 'reminder_48h', subject: 'Rappel de votre venue', sentAt: iso(-17), status: 'sent', direction: 'outbound', channel: 'email' },
      { id: 3, recipient: 'marie@test.be', reservationId: 7002, templateId: 'thanks', subject: 'Merci de votre visite', sentAt: iso(-2), status: 'failed', direction: 'outbound', channel: 'email' },
    ];
    const leads = [
      { id: 501, contactName: 'Asso Les Lucioles', email: 'lucioles@test.be', phone: '+32470111099', occasion: 'anniversaire', requestedDate: dstr(10), pax: 14, status: 'new', message: 'Fête pour 14 enfants, budget à discuter.' },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const b = JSON.parse(init.body || '{}');
        (window.__QA_POSTS__ = window.__QA_POSTS__ || []).push(b);
        if (b.action === 'sendClientRelance') return J({ ok: true, communication: { id: 901, status: 'queued' } });
        if (b.action === 'clientNotes') return J({ ok: true });
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'relanceStats') return J({ ok: true, sent: 3, converted: 1, revenue: 180 });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'clientNotes') return J({ ok: true, note: null });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      // __QA_NO_LEADS__ : interrupteur de CONTRE-PREUVE. Il permet de vider la
      // file en cours de test et de prouver que les compteurs suivent la donnée
      // au lieu d'être décoratifs.
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests: window.__QA_NO_LEADS__ ? [] : leads });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '10:00', close: '22:00' }, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=crm-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = todayStr(); state.staffMenuPage = 'clients'; state.staffTheme = 'dark';
      state.staffClientSegment = 'tous'; state.staffGroupPrep = {};
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(700);

    console.log('\n[LOAD] page Clients fusionnée rendue sans erreur');
    const load = await page.evaluate(() => ({
      root: !!document.getElementById('staffClientsPage'),
      rows: document.querySelectorAll('#staffClientsPage table tbody tr').length,
      segs: [...document.querySelectorAll('#staffClientsPage .crm-seg .crm-seg-label')].map((b) => b.textContent.trim()),
      activeSeg: (document.querySelector('#staffClientsPage .crm-seg.is-active .crm-seg-label') || {}).textContent,
      statLinks: document.querySelectorAll('#staffClientsPage .crm-stat-link').length,
      clients: (typeof getStaffClientRows === 'function') ? getStaffClientRows().length : -1,
      groupsInMenu: !![...document.querySelectorAll('.staff-menu button, .staff-menu a')].find((el) => /groupes/i.test(el.textContent)),
      cols: document.querySelectorAll('#staffClientsPage table thead th').length,
    }));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''}`);
    ok(load.root, 'conteneur présent');
    ok(load.clients === 8, `8 clients agrégés (obtenu ${load.clients})`);
    ok(load.segs.length === 4 && load.segs.join(',') === 'Tous,À venir,À relancer,Clients clés', `4 segments (${load.segs.join(', ')})`);

    // Badge « Anniv. a venir » : il parle de l'AVENIR, il doit donc se decider
    // sur la prochaine reservation, jamais sur l historique du client.
    const bday = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffClientsPage tbody tr')];
      const read = (name) => {
        const tr = rows.find((r) => (r.textContent || '').includes(name));
        return tr ? /Anniv\. à venir/.test(tr.textContent || '') : null;
      };
      return { marie: read('Marie Dupont'), nadia: read('Nadia Klein') };
    });
    ok(bday.marie === true, `prochaine resa = formule anniversaire -> badge affiche (${bday.marie})`);
    ok(bday.nadia === false, `anniversaire PASSE + prochaine resa ordinaire -> aucun badge (${bday.nadia})`);
    ok((load.activeSeg || '').trim() === 'Tous', 'segment « Tous » actif par défaut');
    ok(load.statLinks === 4, '4 stats cliquables');
    ok(load.cols === 5, `table 5 colonnes max (obtenu ${load.cols})`);
    ok(!load.groupsInMenu, 'entrée « Groupes & anniversaires » retirée du menu');

    // BUG 3 : le compteur de demandes sur mesure doit se voir SANS être déjà
    // dans le segment « À venir ». On est ici sur « Tous » (défaut).
    console.log('\n[LEADS] compteur de demandes visible hors du filtre « À venir »');
    await page.waitForTimeout(400);
    const readLeadSignals = () => page.evaluate(() => {
      const seg = document.querySelector('#staffClientsPage .crm-seg[data-crm-seg="avenir"]');
      const tile = [...document.querySelectorAll('#staffClientsPage .crm-stat-link')].find((s) => /Demandes sur mesure/.test(s.textContent));
      const menuItem = document.querySelector('[data-fgx-menu-key="clients"]');
      return {
        segment: typeof getStaffClientSegment === 'function' ? getStaffClientSegment() : '',
        count: typeof getStaffNewCustomRequestCount === 'function' ? getStaffNewCustomRequestCount() : -1,
        segBadge: seg?.querySelector('.crm-seg-badge')?.textContent.trim() || '',
        tile: tile ? tile.textContent.replace(/\s+/g, ' ').trim() : '',
        menuItems: document.querySelectorAll('[data-fgx-menu-key]').length,
        menuBadge: menuItem?.querySelector('.fgx-menu-badge')?.textContent.trim() || '',
        menuDot: !!menuItem?.querySelector('.fgx-menu-dot'),
      };
    });
    const leadOn = await readLeadSignals();
    ok(leadOn.segment === 'tous', `segment actif = « tous », pas « avenir » (obtenu ${leadOn.segment})`);
    ok(leadOn.count === 1, `1 demande « new » comptée (obtenu ${leadOn.count})`);
    ok(/^1 nouvelle$/.test(leadOn.segBadge), `badge sur le segment « À venir » (obtenu « ${leadOn.segBadge} »)`);
    ok(/Demandes sur mesure/.test(leadOn.tile) && /\b1\b/.test(leadOn.tile), `tuile « Demandes sur mesure » chiffrée (« ${leadOn.tile} »)`);
    ok(leadOn.menuItems > 0, `menu staff rendu (${leadOn.menuItems} entrées)`);
    ok(leadOn.menuBadge === '1', `badge sidebar sur « Clients » (obtenu « ${leadOn.menuBadge} »)`);
    ok(leadOn.menuDot, 'point de rappel dans l\'icône (survit au menu replié et sous 1100px)');

    // CONTRE-PREUVE : file vidée côté serveur → les 4 signaux doivent tomber.
    // Sans ça, un badge codé en dur passerait le test ci-dessus.
    await page.evaluate(() => { window.__QA_NO_LEADS__ = true; loadStaffCustomRequests(true); });
    await page.waitForTimeout(500);
    const leadOff = await readLeadSignals();
    ok(leadOff.count === 0, `file vidée : compteur à 0 (obtenu ${leadOff.count})`);
    ok(!leadOff.segBadge, `file vidée : plus de badge de segment (obtenu « ${leadOff.segBadge} »)`);
    ok(/aucune en attente/.test(leadOff.tile), `file vidée : tuile « aucune en attente » (« ${leadOff.tile} »)`);
    ok(!leadOff.menuBadge && !leadOff.menuDot, 'file vidée : plus de badge ni de point dans la sidebar');
    await page.evaluate(() => { window.__QA_NO_LEADS__ = false; loadStaffCustomRequests(true); });
    await page.waitForTimeout(400);

    console.log('\n[VIP] clic segment VIP filtre, re-clic → retour Tous');
    await page.evaluate(() => document.querySelector('.crm-seg[data-crm-seg="vip"]').click());
    await page.waitForTimeout(200);
    const vip = await page.evaluate(() => ({
      names: [...document.querySelectorAll('#staffClientsPage tbody .crm-client-id strong')].map((s) => s.textContent),
      active: (document.querySelector('.crm-seg.is-active .crm-seg-label') || {}).textContent,
    }));
    // « VIP » renomme « Clients cles » le 2026-07-28 : sonorite d'agence, et le
    // seuil est desormais un montant reglable dans Etablissement.
    ok((vip.active || '').trim() === 'Clients clés', 'segment Clients cles actif');
    ok(vip.names.includes('Entreprise Nova'), 'VIP contient le top dépensier (Nova)');
    ok(!vip.names.includes('Paul Martin'), 'VIP exclut les petits clients');
    await page.evaluate(() => document.querySelector('.crm-seg[data-crm-seg="vip"]').click());
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => ((document.querySelector('.crm-seg.is-active .crm-seg-label') || {}).textContent || '').trim());
    ok(back === 'Tous', `re-clic sur VIP → retour à Tous (obtenu ${back})`);

    // Refonte du 2026-08-13 : « À venir » parle la MÊME langue que « Tous » :
    // une liste dense, cinq colonnes, une action par ligne. Le détail de la vue
    // et ses contre-épreuves vivent dans scripts/crm-groups-check.js ; ici on
    // prouve la cohabitation des deux onglets sur la même page.
    console.log('\n[AVENIR] segment À venir = la même liste que « Tous », adaptée aux venues');
    await page.evaluate(() => document.querySelector('.crm-seg[data-crm-seg="avenir"]').click());
    await page.waitForTimeout(400);
    const avenir = await page.evaluate(() => {
      const root = document.getElementById('staffClientsPage');
      const rows = [...root.querySelectorAll('.crm-table-avenir tbody tr:not(.crm-day)')];
      return {
        table: root.querySelectorAll('.crm-table-avenir').length,
        heads: [...root.querySelectorAll('.crm-table-avenir thead th')].map((h) => h.textContent.trim()),
        rows: rows.length,
        names: rows.map((r) => (r.querySelector('.crm-client-id strong') || {}).textContent || ''),
        days: root.querySelectorAll('.crm-table-avenir tbody tr.crm-day').length,
        cartes: root.querySelectorAll('.groups-dossier').length,
        checks: root.querySelectorAll('.groups-check-toggle').length,
        memo: root.querySelectorAll('.groups-memo').length,
        lead: /Lucioles/.test((root.querySelector('.crm-avenir-side') || {}).textContent || ''),
        height: Math.round(document.documentElement.scrollHeight),
      };
    });
    ok(avenir.table === 1, `la vue est UNE table dense (obtenu ${avenir.table})`);
    ok(avenir.heads.join('|') === 'Heure|Client|Réservation|Joueurs|', `5 colonnes : ${avenir.heads.join(' | ')}`);
    // Fixture : Marie (+6 j) et Nadia (+9 j) sont les deux seules résas futures.
    ok(avenir.rows === 2, `2 venues à venir listées (obtenu ${avenir.rows})`);
    ok(avenir.names.includes('Marie Dupont'), 'la venue de Marie (+6 j) est là');
    ok(avenir.names.includes('Nadia Klein'), 'la venue de Nadia (+9 j, profil NON-groupe) est là aussi : la vue ne filtre plus sur « groupe »');
    ok(avenir.days === 2, `un séparateur par jour (obtenu ${avenir.days})`);
    ok(avenir.cartes === 0 && avenir.checks === 0 && avenir.memo === 0, `ni carte, ni pastille de préparation, ni ligne d'habitudes (${avenir.cartes}/${avenir.checks}/${avenir.memo})`);
    ok(avenir.lead, 'la demande sur mesure (lead Lucioles) garde son panneau');
    ok(avenir.height < 1600, `page courte (${avenir.height} px)`);

    console.log('\n[RELANCER] la liste qui rapporte : dormants + anniversaires ~1 an, avec le pourquoi');
    await page.evaluate(() => document.querySelector('.crm-seg[data-crm-seg="relancer"]').click());
    await page.waitForTimeout(250);
    const rel = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffClientsPage tbody tr')].map((tr) => tr.textContent);
      return {
        names: [...document.querySelectorAll('#staffClientsPage tbody .crm-client-id strong')].map((s) => s.textContent),
        whyDormant: rows.some((t) => /Georges Dupuis/.test(t) && /Venu 3×|plus vu/.test(t)),
        whyBirthday: rows.some((t) => /Kessler/.test(t) && /[Aa]nniversaire/.test(t)),
        headers: [...document.querySelectorAll('#staffClientsPage thead th')].map((h) => h.textContent.trim()),
      };
    });
    ok(rel.names.includes('Georges Dupuis'), 'dormant multi-visites présent (Georges)');
    ok(rel.names.includes('Famille Kessler'), 'anniversaire ~1 an présent (Kessler)');
    ok(!rel.names.includes('Marie Dupont'), 'Marie exclue (résa à venir)');
    ok(!rel.names.includes('Paul Martin'), 'Paul exclu (1 seule visite)');
    ok(rel.whyDormant, 'colonne « Pourquoi » explique le dormant en français');
    ok(rel.whyBirthday, 'colonne « Pourquoi » explique l\'anniversaire qui revient');
    ok(rel.headers.some((h) => /Pourquoi/.test(h)), 'en-tête « Pourquoi » affiché');

    console.log('\n[STATS] les 4 chiffres déclenchent une décision');
    const stats = await page.evaluate(() => [...document.querySelectorAll('#staffClientsPage .crm-stat-link')].map((s) => s.textContent));
    ok(stats.some((t) => /À relancer/.test(t) && /2/.test(t)), 'stat « À relancer » compte 2 clients');
    ok(stats.some((t) => /À venir 7 j/.test(t)), 'stat « À venir 7 j » présente');
    ok(stats.some((t) => /Demandes sur mesure/.test(t) && /1/.test(t)), 'stat « Demandes sur mesure » compte le lead en attente');

    console.log('\n[FICHE] fiche KISS : 3 chiffres, prochaine venue cliquable, contacts cliquables');
    await page.evaluate(() => { setStaffClientSegment('tous'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#staffClientsPage tbody tr')].find((tr) => /Marie Dupont/.test(tr.textContent));
      row.click();
    });
    await page.waitForTimeout(300);
    const fiche = await page.evaluate(() => {
      const f = document.querySelector('#staffClientsPage .crm-fiche');
      return {
        name: /Marie Dupont/.test(f?.textContent || ''),
        kpis: f ? f.querySelectorAll('.crm-kpi').length : 0,
        next: !!f?.querySelector('.crm-next'),
        // CONTRE-PREUVE : les puces de prépa ont quitté la fiche le 2026-08-05
        // (demande du propriétaire) et « À venir » le 2026-08-13. Elles ne
        // doivent plus apparaître nulle part.
        nextChecks: f ? f.querySelectorAll('.crm-next .groups-check-toggle').length : 0,
        nextOpen: !!f?.querySelector('.crm-next .crm-next-open'),
        tel: !!f?.querySelector('a[href^="tel:"]'),
        mailto: !!f?.querySelector('a[href^="mailto:"]'),
        history: f ? f.querySelectorAll('details.crm-hist').length : 0,
        comms: /Messages & relances/.test(f?.textContent || ''),
        resend: !!f?.querySelector('[title="Renvoyer"]'),
        noEngagement: !/Engagement|comportemental|coup d'œil/i.test(f?.textContent || ''),
      };
    });
    ok(fiche.name, 'fiche de Marie affichée');
    ok(fiche.kpis === 3, `3 chiffres seulement (obtenu ${fiche.kpis})`);
    ok(fiche.next && fiche.nextChecks === 0, `bloc Prochaine venue SANS puces de prépa (obtenu ${fiche.nextChecks} : la checklist n'existe plus nulle part)`);
    ok(fiche.nextOpen, 'la prochaine venue est un bouton qui ouvre la réservation');
    // COMPORTEMENT, pas présence : le clic ouvre bien la fiche de la résa
    // future de Marie (POS détail : state.selectedRes porte son id).
    const nextOpened = await page.evaluate(() => {
      document.querySelector('#staffClientsPage .crm-next .crm-next-open').click();
      const overlay = document.getElementById('posOverlay');
      return {
        id: state.selectedRes ? state.selectedRes.id : null,
        tab: state.activeTab,
        overlayVisible: !!overlay && !overlay.classList.contains('hidden'),
      };
    });
    ok(nextOpened.id === 7003 && nextOpened.tab === 'details' && nextOpened.overlayVisible, `le clic ouvre la réservation future (id ${nextOpened.id}, overlay ${nextOpened.overlayVisible ? 'affiché' : 'ABSENT'})`);
    // Fermeture par le chemin RÉEL de l'app (closePos) : sans elle, l'overlay
    // resterait posé sur tout le reste du test et sur chaque capture.
    await page.evaluate(() => { closePos(); renderStaffClientsPage(); });
    await page.waitForTimeout(250);
    ok(fiche.tel && fiche.mailto, 'téléphone et email cliquables (tel:/mailto:)');
    ok(fiche.history >= 3, `historique dépliable (${fiche.history} résas)`);
    ok(fiche.comms && fiche.resend, 'messages envoyés + Renvoyer présents');
    ok(fiche.noEngagement, 'jauge engagement / profil comportemental / blabla supprimés');

    console.log('\n[EXPORT] CSV du segment courant');
    const csv = await page.evaluate(() => {
      let captured = null;
      const orig = window.downloadTextFile;
      window.downloadTextFile = (name, content, mime) => { captured = { name, content, mime }; };
      setStaffClientSegment('relancer');
      exportStaffClientsCsv();
      window.downloadTextFile = orig;
      return captured && { name: captured.name, lines: captured.content.split('\n').length, hasWhy: /Pourquoi relancer/.test(captured.content), hasGeorges: /Georges/.test(captured.content) };
    });
    ok(!!csv, 'export déclenche un téléchargement');
    ok(csv && csv.lines >= 3, `CSV non vide (${csv && csv.lines} lignes)`);
    ok(csv && csv.hasWhy && csv.hasGeorges, 'CSV relance contient le pourquoi + le dormant');
    console.log('\n[RELANCE] composer 1-clic + ROI + notes');
    await page.evaluate(() => { state.staffClientSegment = 'relancer'; renderStaffClientsPage(); if (typeof loadCrmRelanceStats === 'function') loadCrmRelanceStats(true); });
    await page.waitForTimeout(500);
    const relInfo = await page.evaluate(() => ({
      roi: (document.querySelector('#staffClientsPage .crm-roi-figures') || {}).textContent || '',
      btn: !!document.querySelector('#staffClientsPage [onclick*=crmOpenRelance]'),
    }));
    ok(relInfo.btn, 'bouton Relancer présent sur une ligne À relancer');
    ok(/3\s*relance/.test(relInfo.roi) && /180/.test(relInfo.roi), 'bandeau ROI relances affiché (' + relInfo.roi.trim().slice(0, 50) + ')');
    const relSend = await page.evaluate(async () => {
      const btn = document.querySelector('#staffClientsPage [onclick*=crmOpenRelance]');
      btn.click();
      await new Promise((r) => setTimeout(r, 250));
      const row = document.querySelector('#staffClientsPage .crm-composer');
      const subject = row ? (row.querySelector('.crm-composer-subject') || {}).value || '' : '';
      const send = row ? [...row.querySelectorAll('button')].find((x) => /envoyer/i.test(x.textContent)) : null;
      if (send) send.click();
      await new Promise((r) => setTimeout(r, 350));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'sendClientRelance');
      return { opened: !!row, subject, posts: posts.length, reason: posts[0] && posts[0].reason, closed: !document.querySelector('#staffClientsPage .crm-composer') };
    });
    ok(relSend.opened, 'composer relance ouvert');
    ok(relSend.subject.length > 3, 'objet prérempli (' + relSend.subject.slice(0, 30) + ')');
    ok(relSend.posts === 1 && ['dormant', 'birthday'].includes(relSend.reason), 'POST sendClientRelance parti (reason=' + relSend.reason + ')');
    ok(relSend.closed, 'composer refermé après envoi');
    const note = await page.evaluate(async () => {
      const rows2 = [...document.querySelectorAll('#staffClientsPage tbody tr')];
      if (rows2[0]) { rows2[0].click(); await new Promise((r) => setTimeout(r, 300)); }
      const input = document.querySelector('#staffClientsPage .crm-note-input');
      if (!input) return { found: false };
      input.value = 'Allergie arachide : enfant Lina';
      input.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 350));
      const posts = (window.__QA_POSTS__ || []).filter((p) => p.action === 'clientNotes');
      return { found: true, posts: posts.length, body: posts[0] && posts[0].body };
    });
    ok(note.found, 'champ notes présent dans la fiche');
    ok(note.posts >= 1 && /arachide/.test(note.body || ''), 'note sauvegardée au blur (POST clientNotes)');


    console.log('\n[RECHERCHE] frappe FLUIDE (un seul rendu par rafale) + focus unique');
    const typing = await page.evaluate(async () => {
      // Chaque lettre déclenchait un rebuild innerHTML COMPLET, synchrone,
      // DANS la frappe (retour Movsar : « super lent quand j'écris »). On
      // compte les rendus pendant une rafale de 10 lettres : le debounce doit
      // les coalescer en UN seul, sans perdre une lettre ni le focus.
      const orig = window.renderStaffClientsPage;
      let paints = 0;
      window.renderStaffClientsPage = function (...args) { paints += 1; return orig.apply(this, args); };
      const input = document.querySelector('#staffClientsPage .crm-search input');
      input.focus();
      const word = 'lefevre 06';
      for (const ch of word) {
        input.value = (input.value || '') + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 12));
      }
      const paintsDuringBurst = paints;
      await new Promise((r) => setTimeout(r, 350));
      window.renderStaffClientsPage = orig;
      const fresh = document.querySelector('#staffClientsPage .crm-search input');
      const style = getComputedStyle(fresh, null);
      fresh.focus();
      return {
        paintsDuringBurst,
        paintsTotal: paints,
        value: fresh.value,
        stateValue: state.staffClientQuery,
        focusAlive: document.activeElement === fresh,
        ring: getComputedStyle(document.activeElement).boxShadow,
      };
    });
    ok(typing.paintsDuringBurst === 0 && typing.paintsTotal === 1,
      `10 lettres = UN rendu apres la pause, zero pendant la rafale (${typing.paintsDuringBurst} pendant, ${typing.paintsTotal} total)`);
    ok(typing.value === 'lefevre 06' && typing.stateValue === 'lefevre 06', 'aucune lettre perdue (champ et etat identiques)');
    ok(typing.focusAlive, 'le focus survit au rendu differe');
    ok(typing.ring === 'none', 'UN SEUL anneau de focus : l\'input nu ne dessine rien (le conteneur s\'allume)');
    await page.evaluate(async () => { window.setStaffClientQuery(''); await new Promise((r) => setTimeout(r, 250)); });

    console.log('\n[TRI] les en-têtes de colonnes restent triables');
    await page.evaluate(() => { setStaffClientSegment('tous'); });
    await page.waitForTimeout(200);
    const sortInfo = await page.evaluate(() => {
      const before = JSON.stringify(state.staffClientSort);
      const th = [...document.querySelectorAll('#staffClientsPage th[aria-sort]')].find((t) => /dépens/i.test(t.textContent));
      if (th) th.click();
      return { before, hadTh: !!th, after: JSON.stringify(state.staffClientSort) };
    });
    ok(sortInfo.hadTh && sortInfo.before !== sortInfo.after, 'clic en-tête change le tri');

    // [SHOT] captures des 4 segments + fiche. Même règle que le gate emails :
    // setStaffTheme() est le SEUL chemin qui pose data-theme, et le clair + le
    // mobile doivent être REGARDÉS, pas supposés.
    if (process.env.CRM_SHOT) {
      const shotDir = process.env.CRM_SHOT;
      // Les toasts « nouvelle réservation » de la fixture s'empilent sur le
      // panneau fiche : on les retire des CAPTURES (pas des assertions).
      await page.evaluate(() => { const n = document.getElementById('newResNotifs'); if (n) n.remove(); });
      for (const seg of ['tous', 'avenir', 'relancer', 'vip']) {
        await page.evaluate((s) => { state.staffClientSegment = s; save(); renderStaffClientsPage(); }, seg);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${shotDir}/crm-fusion-${seg}.png`, clip: { x: 0, y: 0, width: 1400, height: 800 } });
      }
      // Fiche de MARIE pour les captures : c'est elle qui a une prochaine
      // venue, donc le bloc « Prochaine venue » se voit au lieu d'être supposé.
      await page.evaluate(() => {
        state.staffClientSegment = 'tous';
        const marie = getStaffClientRows().find((r) => /Marie/.test(r.name || ''));
        if (marie) state.staffSelectedClientId = marie.id;
        save(); renderStaffClientsPage();
      });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(350);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${shotDir}/crm-fiche-${theme}-desktop.png`, fullPage: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${shotDir}/crm-fiche-${theme}-mobile.png`, fullPage: true });
        await page.setViewportSize({ width: 1400, height: 900 });
      }
      await page.evaluate(() => { setStaffTheme('dark'); });
    }

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\ncrm-clients-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\ncrm-clients-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncrm-clients-check: ALL OK');
}
main();
