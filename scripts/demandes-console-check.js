// LE BUREAU DES DEMANDES, DANS LA CONSOLE (2026-09-29).
//
// Movsar, capture de sa propre demande a l appui : « bcp plus complete, un
// systeme avec ia qui repond adapte, toute la page refaite, il doit y avoir
// toute les infos et ça doit etre bcp plus simple a gerer ». Ce gate pilote la
// page par de VRAIS clics, sur une file qui a tous les cas :
//   [A] la file : quatre a traiter (un en retard, un a deux heures, un client
//       qui a repondu, une demande sans formulaire), une en attente, une
//       traitee, une archivee ; l ordre suit l heure promise au client ;
//   [B] le dossier dit tout ce que le client a rempli ;
//   [C] « Ce jour-la » : l etude du moteur, prix par joueur et budget ;
//   [D] « Rediger la reponse » : l IA redige, l origine et les points a
//       verifier se lisent, rien ne part ; un brouillon du code se reconnait ;
//   [E] l envoi : la reponse se range dans le suivi, la page suit la demande
//       dans « En attente » ;
//   [F] les mails d avant la demande sont replies, un clic les rend ;
//   [G] une note d equipe s ajoute au suivi ;
//   [H] une demande sans formulaire ne declenche aucune etude ;
//   [I] « Creer la reservation » preremplit le client, ses joueurs, sa date ;
//   [J] aucun appel ne pose un statut que la base refuse (le « done » qui
//       laissait la demande a traiter apres chaque reservation creee) ;
//   [K] telephone : rien ne deborde ;
//   [M] l echeance suit l heure : la page laissee ouverte compte les minutes,
//       et le passage en retard se voit partout, dossier toujours ouvert ;
//   [N] l alerte du tableau de bord liste ce qui attend l equipe, pas ce qui
//       attend le client, dans l ordre de l heure promise ;
//   [L] contre-epreuves : le code casse expres fait rougir le gate.
// Les captures vont dans artifacts/demandes-console/.
const PORT = Number(process.env.PINLANE_DEMANDES_CONSOLE_PORT || 4419);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = p.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = p.join(ROOT, 'artifacts', 'demandes-console');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const APP = p.join(ROOT, 'assets', 'app-main.js');

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}
function section(titre) { console.log(`\n[${titre}]`); }

// Le serveur sert le depot tel quel, ou avec une mutation de app-main.js
// (contre-epreuves) : le fichier du depot n est jamais touche.
let mutation = null;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = p.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(ROOT, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    let corps = c;
    if (mutation && p.resolve(f) === APP) corps = Buffer.from(c.toString('utf8').split(mutation.de).join(mutation.vers), 'utf8');
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(corps);
  });
});

// La file et le serveur simule, poses dans la page avant tout script.
function installer(expiresAt) {
  try { void window.localStorage; } catch (error) { return; }
  if (window.top !== window.self) return;
  const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.edit', 'reservations.quick', 'reservations.create', 'clients.view', 'clients.edit', 'emails.view', 'emails.send', 'direction.view', 'settings.manage'];
  const session = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
  const H = 3600000;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const echeance = (ms) => ({ date: ymd(now + ms), heure: hm(now + ms), instant: iso(now + ms) });
  const D1 = ymd(now + 20 * 24 * H);
  const D2 = ymd(now + 18 * 24 * H);
  window.__QA__ = { D1, D2, appels: [], envois: [], brouillon: 'ia' };
  const suivi = (etape, sur = {}) => ({ etape, priseEnCharge: null, reponses: 0, derniereReponse: null, messageClient: null, reservationId: null, notes: [], historique: [], ...sur });
  const demande = (sur = {}) => ({
    version: 1, groupType: 'ecole', groupTypeLabel: 'École, jeunesse', organisation: 'Athénée de Libramont', participants: 31, companions: 3, ages: ['7-12'],
    flexible: false, date: D1, alternativeDate: D2, period: '', moment: 'apres-midi', momentLabel: 'Après-midi',
    formulas: [{ id: 'f3', name: 'Formule 3' }], activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }],
    advice: false, budgetPerPerson: 25, contactRole: 'Enseignant', invoice: true, vatNumber: 'BE0123456789', ...sur,
  });
  const prise = { type: 'prise-en-charge', le: iso(now - 20 * H), par: 'Rachel' };
  const reponse = (le) => ({ type: 'reponse', le, par: 'Rachel', objet: 'Votre venue chez Fun Galaxy Libramont', source: 'ia' });
  const leads = [
    { id: 801, centerId: 'libramont', contactName: 'Ansar Bisultanov', company: 'Athénée de Libramont', email: 'ansar@example.org', phone: '+32 470 11 22 33', requestedDate: 'demande de 31 joueurs', pax: 31, occasion: 'ecole', message: 'Nous aimerions pique-niquer sur place à midi.', status: 'new', createdAt: iso(now - 3 * H), updatedAt: iso(now - 3 * H), payload: { demande: demande() }, echeance: echeance(2 * H), suivi: suivi('a-traiter') },
    { id: 802, centerId: 'libramont', contactName: 'Claire Dumont', company: 'Pharma SA', email: 'claire@example.org', phone: '+32 471 00 00 02', requestedDate: '', pax: 45, occasion: 'entreprise', message: '', status: 'in_progress', createdAt: iso(now - 30 * H), updatedAt: iso(now - 20 * H), payload: { demande: demande({ groupType: 'entreprise', groupTypeLabel: 'Entreprise, team building', organisation: 'Pharma SA', participants: 45, companions: 0, ages: ['adultes'], moment: 'soiree', momentLabel: 'Soirée', formulas: [], budgetPerPerson: 0, contactRole: 'Office manager' }) }, echeance: echeance(-1 * H), suivi: suivi('a-traiter', { priseEnCharge: prise, historique: [prise] }) },
    { id: 803, centerId: 'libramont', contactName: 'Marc Lambert', company: '', email: 'marc@example.org', phone: '', requestedDate: '', pax: 24, occasion: 'anniversaire', message: '', status: 'in_progress', createdAt: iso(now - 50 * H), updatedAt: iso(now - 20 * H), payload: { demande: demande({ groupType: 'amis', groupTypeLabel: 'Amis, famille', organisation: '', participants: 24, companions: 0, invoice: false, vatNumber: '', contactRole: '' }) }, echeance: null, suivi: suivi('en-attente', { priseEnCharge: prise, reponses: 1, derniereReponse: reponse(iso(now - 20 * H)), historique: [prise, reponse(iso(now - 20 * H))] }) },
    { id: 804, centerId: 'libramont', contactName: 'Sophie Martin', company: 'Scouts de Libramont', email: 'sophie@example.org', phone: '+32 472 00 00 04', requestedDate: '', pax: 36, occasion: 'ecole', message: '', status: 'in_progress', createdAt: iso(now - 60 * H), updatedAt: iso(now - 1 * H), payload: { demande: demande({ organisation: 'Scouts de Libramont', participants: 36 }) }, echeance: echeance(23 * H), suivi: suivi('a-traiter', { priseEnCharge: prise, reponses: 1, derniereReponse: reponse(iso(now - 26 * H)), messageClient: iso(now - 1 * H), historique: [prise, reponse(iso(now - 26 * H))] }) },
    { id: 805, centerId: 'libramont', contactName: 'Julien Petit', company: 'Club de foot', email: 'julien@example.org', phone: '', requestedDate: '', pax: 32, occasion: 'groupe', message: '', status: 'handled', createdAt: iso(now - 90 * H), updatedAt: iso(now - 40 * H), payload: { demande: demande({ organisation: 'Club de foot', participants: 32 }) }, echeance: null, suivi: suivi('traitee', { reservationId: 912, historique: [prise, { type: 'reservation', le: iso(now - 40 * H), par: 'Rachel', reservationId: 912, date: D1 }, { type: 'statut', le: iso(now - 40 * H), par: 'Rachel', statut: 'handled' }] }) },
    { id: 806, centerId: 'libramont', contactName: 'Comité des fêtes', company: '', email: 'comite@example.org', phone: '', requestedDate: '', pax: 40, occasion: 'groupe', message: '', status: 'archived', createdAt: iso(now - 200 * H), updatedAt: iso(now - 150 * H), payload: { demande: demande({ organisation: 'Comité des fêtes', participants: 40 }) }, echeance: null, suivi: suivi('archivee') },
    { id: 807, centerId: 'libramont', contactName: 'Ecole Saint-Roch', company: '', email: 'roch@example.org', phone: '+32 473 00 00 07', requestedDate: '5 novembre', pax: 42, occasion: 'ecole', message: 'Sortie de fin de trimestre pour deux classes.', status: 'new', createdAt: iso(now - 5 * H), updatedAt: iso(now - 5 * H), payload: {}, echeance: null, suivi: suivi('a-traiter') },
  ];
  const comms = [
    { id: 71, direction: 'outbound', recipient: 'ansar@example.org', subject: 'Votre réservation est confirmée', body: 'Bonjour Ansar, votre réservation du mois dernier est confirmée.', status: 'sent', createdAt: iso(now - 40 * 24 * H), sentAt: iso(now - 40 * 24 * H), payload: {} },
    { id: 72, direction: 'outbound', recipient: 'ansar@example.org', subject: 'Rappel : votre venue demain', body: 'Petit rappel de votre venue de demain.', status: 'sent', createdAt: iso(now - 39 * 24 * H), sentAt: iso(now - 39 * 24 * H), payload: {} },
    { id: 73, direction: 'inbound', recipient: 'ansar@example.org', subject: 'Question pique-nique', body: 'Bonjour, pouvons-nous apporter nos sandwichs ?', status: 'received', createdAt: iso(now - 3 * H + 5 * 60000), sentAt: iso(now - 3 * H + 5 * 60000), payload: {} },
  ];
  const etude = {
    participants: 31, moment: 'apres-midi', momentLabel: 'Après-midi', sansDate: '',
    dates: [
      { date: D1, libelle: D1, principale: true, passee: false, ouvert: true, horaires: { de: '10:00', a: '22:00' }, fenetre: { de: 720, a: 1080, existe: true, raison: '' },
        formules: [{ id: 'f3', nom: 'Formule 3', panne: false, ok: true, prix: 868, parJoueur: 28, heures: ['12:00', '14:30'], heuresAilleurs: [], raison: '' }],
        visite: { panne: false, ok: true, prix: 544, parJoueur: 17.55, prixComplet: true, depasse: 0, raison: '', proposition: { debut: '14:00', fin: '16:00' },
          lignes: [{ nom: 'Bowling', prix: 234, detail: '1 h, 6 pistes' }, { nom: 'Laser Game', prix: 310, detail: '1 partie, en 2 vagues' }], heuresParActivite: [{ nom: 'Bowling', heures: ['14:00'] }] },
        occupation: { reservations: 2, joueurs: 20 } },
      { date: D2, libelle: D2, principale: false, passee: false, ouvert: false, horaires: null, fenetre: null, formules: [], visite: null, occupation: null },
    ],
  };
  const CORPS_IA = 'Bonjour Ansar,\n\nMerci pour votre demande pour un groupe de 31 personnes.\n\nLa Formule 3 est possible avec un départ à 12:00 ou 14:30, pour 868 € pour le groupe.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont';
  const CORPS_CODE = 'Bonjour Ansar,\n\nMerci pour votre demande pour un groupe de 31 personnes.\n\nVoici ce que l’équipe peut vous proposer ce jour-là.\n\nBien à vous,\nFun Galaxy Libramont';
  const etapeDe = (lead) => {
    if (lead.status === 'archived') return 'archivee';
    if (lead.status === 'handled') return 'traitee';
    return lead.suivi.reponses && !lead.suivi.messageClient ? 'en-attente' : 'a-traiter';
  };
  const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const natif = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
    const methode = String(init.method || 'GET').toUpperCase();
    if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
    if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
    if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
    if (u.pathname === '/api/ops' && methode === 'POST') {
      const corps = JSON.parse(init.body || '{}');
      window.__QA__.appels.push({ methode, action: corps.action, corps });
      const lead = leads.find((l) => String(l.id) === String(corps.id || corps.customRequestId));
      if (corps.action === 'customRequestDraft') {
        if (window.__QA__.brouillon === 'vide') return J({ ok: true });
        const code = window.__QA__.brouillon === 'code';
        return J({ ok: true, id: corps.id, etude, brouillon: {
          source: code ? 'code' : 'ia', raison: code ? 'ia-refusee' : '',
          objet: 'Votre venue pour 31 personnes chez Fun Galaxy Libramont', corps: code ? CORPS_CODE : CORPS_IA,
          pointsAVerifier: ['3 accompagnateurs non comptés dans les prix : à préciser au client si le centre leur facture quelque chose.'], controle: { ok: true },
        } });
      }
      if (corps.action === 'sendDirectEmail') {
        window.__QA__.envois.push(corps);
        comms.push({ id: 5001, direction: 'outbound', recipient: corps.to, subject: corps.subject, body: corps.body, status: 'queued', createdAt: new Date().toISOString(), sentAt: null, payload: { textBody: corps.body } });
        if (lead) {
          const r = { type: 'reponse', le: new Date().toISOString(), par: 'Rachel', objet: corps.subject, communicationId: 5001, ...(corps.draftSource ? { source: corps.draftSource } : {}) };
          lead.suivi = { ...lead.suivi, reponses: lead.suivi.reponses + 1, derniereReponse: r, messageClient: null, historique: [...lead.suivi.historique, r] };
          lead.suivi.etape = etapeDe(lead);
          lead.echeance = null;
        }
        return J({ ok: true, communication: { id: 5001, status: 'queued' }, ...(lead ? { customRequest: JSON.parse(JSON.stringify(lead)) } : {}) });
      }
      if (corps.action === 'customRequestStatus' && lead) {
        lead.status = corps.status;
        const e = corps.status === 'in_progress' ? { type: 'prise-en-charge', le: new Date().toISOString(), par: 'Rachel' } : { type: 'statut', le: new Date().toISOString(), par: 'Rachel', statut: corps.status };
        lead.suivi = { ...lead.suivi, historique: [...lead.suivi.historique, e], ...(corps.status === 'in_progress' ? { priseEnCharge: e } : {}) };
        if (Number(corps.reservationId) > 0) {
          const resa = { type: 'reservation', le: new Date().toISOString(), par: 'Rachel', reservationId: Number(corps.reservationId), date: corps.reservationDate || '' };
          lead.suivi = { ...lead.suivi, reservationId: resa.reservationId, historique: [...lead.suivi.historique, resa] };
        }
        lead.suivi.etape = etapeDe(lead);
        return J({ ok: true, action: corps.action, customRequest: JSON.parse(JSON.stringify(lead)) });
      }
      if (corps.action === 'customRequestNote' && lead) {
        lead.suivi = { ...lead.suivi, notes: [...lead.suivi.notes, { type: 'note', le: new Date().toISOString(), par: 'Rachel', texte: corps.texte }] };
        return J({ ok: true, action: corps.action, customRequest: JSON.parse(JSON.stringify(lead)) });
      }
      return J({ ok: true });
    }
    if (u.pathname === '/api/ops') {
      const action = u.searchParams.get('action') || '';
      window.__QA__.appels.push({ methode, action, id: u.searchParams.get('id') || '' });
      if (action === 'customRequests') return J({ ok: true, centerId: 'libramont', customRequests: JSON.parse(JSON.stringify(leads)) });
      if (action === 'customRequestStudy') return J({ ok: true, id: Number(u.searchParams.get('id')), etude, client: { clientName: 'Ansar', visits: 3, lastVisit: ymd(now - 40 * 24 * H), reservationsAVenir: 0, prochaineReservation: null } });
      if (action === 'communications') {
        const qui = (u.searchParams.get('recipient') || '').toLowerCase();
        return J({ ok: true, communications: comms.filter((c) => c.recipient.toLowerCase() === qui) });
      }
      return J({ ok: true, communications: [], samples: [], suggestions: [], events: [] });
    }
    if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: ymd(now), durationOptions: [], formules: [], activities: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
    return natif(input, init);
  };
  window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
}

async function ouvrir(browser, { largeur = 1500, hauteur = 1150, theme = 'dark', horloge = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  // Horloge pilotable ([M]) : le temps s ecoule normalement, le gate le fait
  // sauter de dix minutes, puis de deux heures.
  if (horloge) await page.clock.install({ time: new Date() });
  await page.addInitScript(installer, new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  // LA CONDITION, PAS UN SILENCE RESEAU : `networkidle` (500 ms sans requete)
  // n arrivait pas en fin de suite, machine chargee, et le gate tombait sur
  // un delai de navigation (suite du 2026-09-29, meme cause que
  // dashboard-lead-link). Le document, puis ce qu il faut pour ouvrir la console.
  await page.goto(`http://127.0.0.1:${PORT}/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.openStaffMenuPage === 'function', null, { timeout: 20000 });
  await page.evaluate((t) => { window.setView('staff'); if (typeof setStaffTheme === 'function') setStaffTheme(t); }, theme);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.openStaffMenuPage('requests'));
  await page.waitForSelector('.req-item', { timeout: 10000 });
  await page.waitForTimeout(500);
  return { ctx, page, erreurs };
}

const texte = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
const ordreDeLaFile = (page) => page.evaluate(() => [...document.querySelectorAll('.req-item')].map((b) => b.dataset.itemId));
const attendreEtude = (page) => page.waitForSelector('.req-daycard', { timeout: 8000 });

async function parcours(browser, { captures = true } = {}) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  const capture = (nom, options = {}) => (captures ? page.screenshot({ path: p.join(SHOTS, nom), fullPage: false, ...options }) : null);
  try {
    r.D1 = await page.evaluate(() => window.__QA__.D1);
    // [A] la file
    r.ordre = await ordreDeLaFile(page);
    r.onglets = await page.evaluate(() => [...document.querySelectorAll('.req-seg')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    r.archives = await texte(page, '.req-rail-link');
    r.sousTitre = await texte(page, '.utility-hero p');
    r.puce802 = await page.evaluate(() => { const c = document.querySelector('.req-item[data-item-id="802"] .req-due'); return c ? { t: c.innerText.trim(), cls: c.className } : null; });
    r.puce801 = await page.evaluate(() => { const c = document.querySelector('.req-item[data-item-id="801"] .req-due'); return c ? { t: c.innerText.trim(), cls: c.className } : null; });
    r.signal804 = await texte(page, '.req-item[data-item-id="804"] .req-item-snip');
    r.titre801 = await texte(page, '.req-item[data-item-id="801"] strong');

    // [B] le dossier
    await page.click('.req-item[data-item-id="801"]');
    await attendreEtude(page);
    await page.waitForTimeout(300);
    r.dossier = await texte(page, '.req-detail');
    r.entete = await page.evaluate(() => ({
      nom: (document.querySelector('.req-detail-ident h3') || {}).textContent || '',
      sous: (document.querySelector('.req-detail-sub') || {}).textContent || '',
      badge: (document.querySelector('.req-detail-head .cr-badge') || {}).textContent || '',
    }));
    r.bandeau = await page.evaluate(() => { const b = document.querySelector('.req-banner'); return b ? { t: b.innerText.replace(/\s+/g, ' ').trim(), cls: b.className } : null; });
    r.faits = await texte(page, '.req-facts');
    r.principal = await page.evaluate(() => { const b = document.querySelector('.req-actions button.primary'); return b ? b.textContent.trim() : ''; });

    // [C] l etude
    r.jours = await page.evaluate(() => [...document.querySelectorAll('.req-daycard')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()));
    r.etudeDemandee = await page.evaluate(() => window.__QA__.appels.filter((a) => a.action === 'customRequestStudy').map((a) => a.id));
    await capture('dossier-sombre.png');
    await capture('dossier-sombre-page.png', { fullPage: true });

    // [F] les mails d avant la demande
    r.filAvant = await page.evaluate(() => ({ msgs: document.querySelectorAll('.req-thread .req-msg').length, tete: (document.querySelector('.req-thread-count') || {}).textContent || '', bouton: (document.querySelector('.req-thread-older') || {}).textContent || '' }));
    await page.click('.req-thread-older');
    await page.waitForTimeout(300);
    r.filApres = await page.evaluate(() => ({ msgs: document.querySelectorAll('.req-thread .req-msg').length, marque: Boolean(document.querySelector('.req-day-mark')) }));
    await page.click('.req-thread-older');
    await page.waitForTimeout(200);

    // [D] rediger avec l IA
    r.envoisAvant = await page.evaluate(() => window.__QA__.envois.length);
    await page.click('.req-actions button.primary');
    await page.waitForSelector('.req-draft-origin', { timeout: 8000 });
    await page.waitForTimeout(400);
    r.redaction = await page.evaluate(() => ({
      appel: window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').map((a) => a.corps.id),
      origine: (document.querySelector('.req-draft-origin') || {}).textContent || '',
      points: [...document.querySelectorAll('.req-checks li')].map((li) => li.textContent.trim()),
      objet: (document.querySelector('.req-composer input') || {}).value || '',
      corps: (document.querySelector('.req-composer textarea') || {}).value || '',
      envois: window.__QA__.envois.length,
    }));
    await page.evaluate(() => focusStaffRequestComposer(801));
    await page.waitForTimeout(500);
    await capture('reponse-ia.png');
    await page.evaluate(() => { window.__QA__.brouillon = 'code'; });
    await page.click('.req-draft-btn');
    await page.waitForFunction(() => /citait un élément absent/.test((document.querySelector('.req-draft-origin') || {}).textContent || ''), null, { timeout: 8000 });
    r.code = await page.evaluate(() => ({ origine: (document.querySelector('.req-draft-origin') || {}).textContent || '', corps: (document.querySelector('.req-composer textarea') || {}).value || '', retour: Boolean(document.querySelector('.req-revert')) }));
    await page.click('.req-revert');
    await page.waitForTimeout(300);
    r.retour = await page.evaluate(() => ({ corps: (document.querySelector('.req-composer textarea') || {}).value || '', origine: (document.querySelector('.req-draft-origin') || {}).textContent || '' }));
    await page.evaluate(() => { window.__QA__.brouillon = 'vide'; });
    const garde = r.retour.corps;
    await page.click('.req-draft-btn');
    await page.waitForTimeout(700);
    r.vide = await page.evaluate(() => (document.querySelector('.req-composer textarea') || {}).value || '');
    r.garde = garde;
    await page.evaluate(() => { window.__QA__.brouillon = 'ia'; });

    // [G] une note d equipe
    await page.fill('#reqNote-801', 'Rappeler le directeur mardi pour le pique-nique.');
    await page.click('.req-note-form button');
    await page.waitForFunction(() => /Rappeler le directeur mardi/.test((document.querySelector('.req-timeline') || {}).textContent || ''), null, { timeout: 5000 });
    r.note = await page.evaluate(() => ({ appel: window.__QA__.appels.filter((a) => a.action === 'customRequestNote').map((a) => a.corps.texte), fil: (document.querySelector('.req-timeline') || {}).innerText || '' }));

    // [E] l envoi, par le clic de l equipe
    await page.click('.req-composer-actions button.primary');
    await page.waitForFunction(() => window.__QA__.envois.length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(1200);
    r.envoi = await page.evaluate(() => ({
      corps: window.__QA__.envois[0],
      statut: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
      onglet: (document.querySelector('.req-seg.active') || {}).textContent || '',
      ouvert: (document.querySelector('.req-card[data-request-id]') || {}).getAttribute ? document.querySelector('.req-card[data-request-id]').getAttribute('data-request-id') : '',
      badge: (document.querySelector('.req-detail-head .cr-badge') || {}).textContent || '',
      suivi: (document.querySelector('.req-timeline') || {}).innerText || '',
      composeur: Boolean(document.querySelector('.req-composer')),
      principal: (document.querySelector('.req-actions button.primary') || {}).textContent || '',
    }));

    // [I] la reservation preremplie
    await page.click('.req-actions button.primary');
    await page.waitForTimeout(500);
    r.resa = await page.evaluate(() => (typeof quickBookState !== 'undefined' && quickBookState ? { pax: quickBookState.pax, date: quickBookState.date, notes: quickBookState.notes, source: quickBookState.sourceRequestId, nom: quickBookState.name } : null));
    await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });

    // [H] une demande sans formulaire
    await page.evaluate(() => setStaffRequestSegment('atraiter'));
    await page.waitForTimeout(300);
    await page.click('.req-item[data-item-id="807"]');
    await page.waitForTimeout(600);
    r.libre = { texte: await texte(page, '.req-detail'), etudes: await page.evaluate(() => window.__QA__.appels.filter((a) => a.action === 'customRequestStudy' && a.id === '807').length) };

    // Les archives, au pied de la file
    await page.click('.req-rail-link');
    await page.waitForTimeout(400);
    r.fileArchives = await ordreDeLaFile(page);
    await page.click('.req-rail-link');
    await page.waitForTimeout(300);

    // En clair : le client qui a repondu, dossier complet
    if (captures) {
      await page.evaluate(() => { if (typeof setStaffTheme === 'function') setStaffTheme('light'); });
      await page.click('.req-item[data-item-id="804"]');
      await attendreEtude(page).catch(() => {});
      await page.waitForTimeout(600);
      await capture('dossier-clair.png');
    }
    r.erreursConsole = erreurs.slice();
  } catch (error) {
    // Le parcours rapporte ou il s est arrete, au lieu de planter le gate :
    // une contre-epreuve doit rougir sur SON assertion, pas sur une panne.
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

async function telephone(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844 });
  try {
    await page.click('.req-item[data-item-id="801"]');
    await attendreEtude(page).catch(() => {});
    await page.waitForTimeout(700);
    const mesure = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: window.innerWidth }));
    await page.screenshot({ path: p.join(SHOTS, 'telephone.png'), fullPage: false });
    return { mesure, erreurs };
  } finally { await ctx.close(); }
}

// [M] L ECHEANCE SUIT L HEURE. Un repere pose sur le tableau survit a une
// mise a jour sur place, pas a un repeint : dix minutes plus tard il doit
// etre la (les mails ouverts ne se sont pas recharges).
async function horlogeDuBureau(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser, { horloge: true });
  const r = { erreurs };
  const lire = () => page.evaluate(() => {
    const puce = document.querySelector('.req-item[data-item-id="801"] .req-due');
    const bandeau = document.querySelector('.req-banner');
    const dossier = document.querySelector('.req-detail[data-request-id]');
    return {
      puce: puce ? { t: puce.innerText.trim(), cls: puce.className } : null,
      bandeau: bandeau ? bandeau.innerText.replace(/\s+/g, ' ').trim() : '',
      sousTitre: ((document.querySelector('.utility-hero p') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      ouvert: dossier ? dossier.getAttribute('data-request-id') : '',
      marque: Boolean(document.querySelector('.req-board[data-qa-marque]')),
    };
  });
  try {
    await page.click('.req-item[data-item-id="801"]');
    await attendreEtude(page).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.req-board').setAttribute('data-qa-marque', '1'));
    r.avant = await lire();
    await page.clock.fastForward('10:00');
    await page.waitForTimeout(400);
    r.dixMinutes = await lire();
    await page.clock.fastForward('01:55:00');
    await page.waitForTimeout(700);
    r.echue = await lire();
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

// [N] L ALERTE DU TABLEAU DE BORD : ce qui attend l equipe.
async function alerteDuTableau(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await page.evaluate(() => window.openStaffDashboardDetail('alerts', 'lead'));
    await page.waitForSelector('.alert-lead', { timeout: 8000 });
    await page.waitForTimeout(300);
    r.titre = await texte(page, '.alert-lead');
    r.lignes = await page.evaluate(() => [...document.querySelectorAll('.alert-lead .dashboard-detail-row.lead')].map((l) => ({ id: l.getAttribute('data-item-id') || '', t: l.innerText.replace(/\s+/g, ' ').trim() })));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

function verifierHorloge(h) {
  section('M. L ECHEANCE SUIT L HEURE');
  if (!ok(!h.panne && h.avant && h.dixMinutes && h.echue, 'MONTAGE l horloge de la page se pilote', h.panne || '')) return;
  ok(h.erreurs.length === 0, 'MONTAGE zero erreur sous horloge pilotee', h.erreurs.join(' | '));
  ok(h.avant.puce && /^Reste (1 h 5\d|2 h)$/.test(h.avant.puce.t) && h.avant.ouvert === '801', 'au depart : environ deux heures, dossier ouvert', JSON.stringify({ p: h.avant.puce, o: h.avant.ouvert }));
  ok(h.dixMinutes.puce && h.avant.puce && h.dixMinutes.puce.t !== h.avant.puce.t && /^Reste 1 h [45]\d$/.test(h.dixMinutes.puce.t), 'dix minutes plus tard, la pastille a compte dix minutes', `${h.avant.puce && h.avant.puce.t} -> ${h.dixMinutes.puce && h.dixMinutes.puce.t}`);
  ok(/il reste 1 h [45]\d/.test(h.dixMinutes.bandeau), 'le bandeau du dossier aussi', h.dixMinutes.bandeau);
  ok(h.dixMinutes.marque && h.dixMinutes.ouvert === '801', 'sans repeindre la page : le dossier et ses mails restent en place', JSON.stringify({ m: h.dixMinutes.marque, o: h.dixMinutes.ouvert }));
  ok(h.echue.puce && h.echue.puce.t === 'En retard' && /is-late/.test(h.echue.puce.cls), 'l heure passee, la pastille passe en retard, en rouge', JSON.stringify(h.echue.puce));
  ok(/dépassée de \d+ min/.test(h.echue.bandeau), 'le bandeau dit de combien', h.echue.bandeau);
  ok(/4 à traiter, dont 2 en retard/.test(h.echue.sousTitre) && h.echue.ouvert === '801', 'le sous-titre compte le nouveau retard, dossier toujours ouvert', JSON.stringify({ s: h.echue.sousTitre, o: h.echue.ouvert }));
}

function verifierAlerte(a) {
  section('N. L ALERTE DU TABLEAU DE BORD');
  if (!ok(!a.panne && Array.isArray(a.lignes), 'MONTAGE l alerte s ouvre', a.panne || '')) return;
  ok(a.erreurs.length === 0, 'MONTAGE zero erreur', a.erreurs.join(' | '));
  const ids = a.lignes.map((l) => l.id);
  ok(JSON.stringify(ids) === JSON.stringify(['802', '801', '804', '807']), 'elle liste ce qui attend l equipe, dans l ordre de l heure promise', JSON.stringify(ids));
  ok(!ids.includes('803'), 'pas la demande qui attend le client');
  ok(/4 demandes sur mesure à traiter/.test(a.titre), 'son titre dit le meme chiffre', a.titre.slice(0, 120));
  ok(/En retard/.test((a.lignes[0] || {}).t || '') && /Reste/.test((a.lignes[1] || {}).t || ''), 'chaque ligne dit son heure promise', JSON.stringify(a.lignes.slice(0, 2)));
  ok(/Athénée de Libramont/.test((a.lignes[1] || {}).t || '') && /31 pers\./.test((a.lignes[1] || {}).t || ''), 'et le groupe du formulaire : organisation, joueurs', (a.lignes[1] || {}).t || '');
}

function verifier(r) {
  section('A. LA FILE : CE QUI ATTEND L EQUIPE, DANS L ORDRE DE L HEURE PROMISE');
  if (!ok(!r.panne, 'MONTAGE le parcours va jusqu au bout', r.panne)) return;
  ok(r.erreurs.length === 0, 'MONTAGE la page s ouvre sans erreur', r.erreurs.join(' | '));
  ok(JSON.stringify(r.ordre) === JSON.stringify(['802', '801', '804', '807']), 'a traiter : le retard, puis l echeance la plus proche, puis la demande sans echeance', JSON.stringify(r.ordre));
  ok(r.onglets.length === 3 && /À traiter\s*4/.test(r.onglets[0]) && /En attente\s*1/.test(r.onglets[1]) && /Traitées\s*1/.test(r.onglets[2]), 'trois onglets de travail et leurs comptes', JSON.stringify(r.onglets));
  ok(/Archivées \(1\)/.test(r.archives), 'les archives au pied de la file, a part du travail', r.archives);
  ok(/4 à traiter, dont 1 en retard/.test(r.sousTitre) && /1 en attente du client/.test(r.sousTitre) && /24 heures ouvrables/.test(r.sousTitre), 'le sous-titre dit ce qui attend, en une ligne', r.sousTitre);
  ok(r.puce802 && r.puce802.t === 'En retard' && /is-late/.test(r.puce802.cls), 'la demande en retard le dit, en rouge', JSON.stringify(r.puce802));
  ok(r.puce801 && /^Reste (1 h|2 h)/.test(r.puce801.t) && /is-soon/.test(r.puce801.cls), 'la demande a deux heures de l echeance dit ce qu il reste', JSON.stringify(r.puce801));
  ok(r.signal804 === 'Le client a répondu', 'le client qui a repondu remonte, et la file le dit', r.signal804);
  ok(r.titre801 === 'Athénée de Libramont', 'la ligne porte le nom de l organisation', r.titre801);

  section('B. LE DOSSIER DIT TOUT CE QUE LE CLIENT A REMPLI');
  ok(/Ansar Bisultanov/.test(r.entete.nom) && /Enseignant · Athénée de Libramont/.test(r.entete.sous) && /Nouvelle/.test(r.entete.badge), 'qui ecrit, sa fonction, son organisation, l etat de la demande', JSON.stringify(r.entete));
  ok(r.bandeau && /is-soon/.test(r.bandeau.cls) && /Réponse promise avant/.test(r.bandeau.t), 'l heure promise au client est en tete du dossier', JSON.stringify(r.bandeau));
  const f = r.faits;
  ok(/31 joueurs \+ 3 accompagnateurs/.test(f) && /7 à 12 ans/.test(f) && /Après-midi/.test(f) && /Formule 3/.test(f) && /Bowling/.test(f) && /Laser Game/.test(f)
    && /25 € par personne/.test(f) && /775 € pour 31 joueurs/.test(f) && /Au nom de Athénée de Libramont/.test(f) && /TVA BE0123456789/.test(f) && /Enseignant/.test(f),
  'groupe, ages, moment, envies, budget et total, facture, TVA, fonction : tout est la', f.slice(0, 400));
  ok(/pique-niquer sur place/.test(r.dossier), 'le message du client est lu en entier');
  ok(/Client connu : 3 venues/.test(f), 'le client deja venu est reconnu', f.slice(-200));
  ok(r.principal === 'Rédiger la réponse', 'une action principale, la bonne : rediger la reponse', r.principal);

  section('C. CE JOUR-LA : CE QUE LE MOTEUR DIT DE LA DATE');
  const [j1 = '', j2 = ''] = r.jours;
  ok(r.etudeDemandee.filter((id) => id === '801').length === 1, 'l etude est demandee pour le dossier ouvert, une fois', JSON.stringify(r.etudeDemandee));
  ok(/Ouvert 10:00 à 22:00/.test(j1) && /Après-midi : 12:00 à 18:00/.test(j1), 'le jour voulu : ouvert, et la plage de l apres-midi', j1.slice(0, 200));
  ok(/Formule 3/.test(j1) && /868 €/.test(j1) && /28 € \/ joueur/.test(j1) && /12:00/.test(j1) && /14:30/.test(j1), 'la formule : prix du groupe, prix par joueur, departs libres', j1);
  ok(/3 € de plus par joueur que le budget/.test(j1), 'au-dessus du budget, l ecart par joueur est dit', j1);
  ok(/544 €/.test(j1) && /17,55 € \/ joueur/.test(j1) && /Dans le budget/.test(j1) && /6 pistes/.test(j1) && /2 vagues/.test(j1), 'le programme des activites, son detail, et le budget tenu', j1);
  ok(/2 réservations, 20 joueurs/.test(j1) && /Voir le planning de ce jour/.test(j1), 'ce qui est deja prevu ce jour-la, et le planning a un clic', j1.slice(-160));
  ok(/autre date du client/.test(j2) && /Fermé/.test(j2), 'l autre date du client : fermee, dit comme tel', j2);

  section('D. REDIGER LA REPONSE : L IA ECRIT, RIEN NE PART');
  ok(JSON.stringify(r.redaction.appel) === '[801]', 'un clic, un brouillon demande pour cette demande', JSON.stringify(r.redaction.appel));
  ok(/Rédigée par l’IA à partir de la demande et des disponibilités réelles/.test(r.redaction.origine), 'l origine du texte est dite', r.redaction.origine);
  ok(r.redaction.points.length === 1 && /accompagnateurs non comptés/.test(r.redaction.points[0]), 'les points a verifier avant d envoyer sont affiches', JSON.stringify(r.redaction.points));
  ok(/868 €/.test(r.redaction.corps) && /Formule 3/.test(r.redaction.corps) && r.redaction.objet.length > 0, 'le brouillon remplit objet et message');
  ok(r.envoisAvant === 0 && r.redaction.envois === 0, 'AUCUN envoi : rediger ne fait partir aucun mail');
  ok(/citait un élément absent des faits/.test(r.code.origine) && /proposer ce jour-là/.test(r.code.corps) && r.code.retour, 'un brouillon du code se reconnait, et le texte d avant reste recuperable', r.code.origine);
  ok(r.retour.corps === r.redaction.corps && /Rédigée par l’IA/.test(r.retour.origine), '« Revenir a ma version » rend le texte d avant ET son origine');
  ok(r.vide === r.garde, 'un brouillon indisponible laisse le texte tel quel');

  section('G. UNE NOTE D EQUIPE');
  ok(JSON.stringify(r.note.appel) === '["Rappeler le directeur mardi pour le pique-nique."]' && /Note de Rachel/.test(r.note.fil), 'la note part au serveur et s affiche dans le suivi', r.note.fil.slice(-160));

  section('E. L ENVOI : PAR LE CLIC DE L EQUIPE, RANGE DANS LE SUIVI');
  ok(r.envoi.corps && r.envoi.corps.action === 'sendDirectEmail' && r.envoi.corps.customRequestId === 801 && r.envoi.corps.to === 'ansar@example.org' && r.envoi.corps.draftSource === 'ia',
    'un envoi, a ce client, rattache a sa demande, avec l origine du texte', JSON.stringify(r.envoi.corps && { a: r.envoi.corps.action, id: r.envoi.corps.customRequestId, s: r.envoi.corps.draftSource }));
  ok(JSON.stringify(r.envoi.statut) === '["in_progress"]', 'une demande nouvelle a laquelle on repond est prise en charge', JSON.stringify(r.envoi.statut));
  ok(/En attente/.test(r.envoi.onglet) && r.envoi.ouvert === '801' && /Attend le client/.test(r.envoi.badge), 'la page suit la demande dans « En attente » : on voit la reponse rangee', JSON.stringify({ o: r.envoi.onglet, id: r.envoi.ouvert, b: r.envoi.badge }));
  ok(/Réponse envoyée par Rachel/.test(r.envoi.suivi) && !r.envoi.composeur, 'le suivi dit qui a repondu ; le composeur est referme', r.envoi.suivi.slice(-200));
  ok(r.envoi.principal === 'Créer la réservation', 'en attente du client, l action suivante est la reservation', r.envoi.principal);

  section('F. LES MAILS D AVANT LA DEMANDE');
  ok(r.filAvant.msgs === 1 && /0 envoyé · 1 reçu/.test(r.filAvant.tete) && /Voir les 2 mails d’avant la demande/.test(r.filAvant.bouton), 'seuls les mails de la demande sont a l ecran ; les 2 plus anciens attendent un clic', JSON.stringify(r.filAvant));
  ok(r.filApres.msgs === 3 && r.filApres.marque, 'un clic les rend, avec le repere « Debut de la demande »', JSON.stringify(r.filApres));

  section('I. CREER LA RESERVATION, PREREMPLIE');
  ok(r.resa && r.resa.pax === 31 && r.resa.date === r.D1 && r.resa.source === 801 && /Ansar/.test(r.resa.nom) && /Demande sur mesure/.test(r.resa.notes) && /Athénée de Libramont/.test(r.resa.notes) && /3 accompagnateurs/.test(r.resa.notes),
    'les 31 joueurs, la date voulue, le client et la demande en note', JSON.stringify(r.resa));

  section('H. UNE DEMANDE SANS FORMULAIRE');
  ok(/Souhait/.test(r.libre.texte) && /5 novembre/.test(r.libre.texte) && /sans le formulaire détaillé/.test(r.libre.texte) && r.libre.etudes === 0, 'la demande libre dit ce qu elle a, et n interroge pas le moteur', r.libre.texte.slice(0, 200));
  ok(JSON.stringify(r.fileArchives) === '["806"]', 'les archives se lisent a part', JSON.stringify(r.fileArchives));
  ok(r.erreursConsole.length === 0, 'zero erreur dans la page sur tout le parcours', r.erreursConsole.join(' | '));
}

// [J] Aucun appel ne pose un statut que la base refuse. Le « done » de la
// reservation rapide renvoyait 400 : chaque reservation creee depuis une
// demande la laissait a traiter.
function statutsInvalides(source) {
  const valides = new Set(['new', 'in_progress', 'handled', 'archived']);
  return [...source.matchAll(/setStaffCustomRequestStatus\(\s*[^,()]+,\s*(['"])([^'"]*)\1/g)].map((m) => m[2]).filter((s) => !valides.has(s));
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    verifier(await parcours(browser));
    section('K. TELEPHONE');
    const t = await telephone(browser);
    ok(t.erreurs.length === 0 && t.mesure.large <= t.mesure.vue, `rien ne deborde a 390 px (${t.mesure.large} pour ${t.mesure.vue})`);
    verifierHorloge(await horlogeDuBureau(browser));
    verifierAlerte(await alerteDuTableau(browser));

    section('J. UN STATUT QUE LA BASE ACCEPTE');
    const source = fs.readFileSync(APP, 'utf8');
    const appels = [...source.matchAll(/setStaffCustomRequestStatus\(/g)].length;
    ok(appels >= 8 && statutsInvalides(source).length === 0, `chaque appel pose un statut de la base (${appels} appels lus)`, JSON.stringify(statutsInvalides(source)));
    ok(/setStaffCustomRequestStatus\(demandeOrigine, 'handled', \{[\s\S]{0,80}reservationId: payload\.reservation/.test(source), 'la reservation creee depuis une demande la classe traitee, reservation liee');

    section('L. CONTRE-EPREUVES');
    const montable = (de) => ok(source.split(de).length === 2, `contre-epreuve montable : « ${de.trim().slice(0, 70)} »`);
    const essais = [
      { de: '      if (da && db && da.t !== db.t) return da.t - db.t;', vers: '      if (da && db && da.t !== db.t) return 0;', label: 'sans l ordre de l echeance, le retard n est plus en tete', rouge: (r) => Array.isArray(r.ordre) && r.ordre[0] !== '802' },
      { de: '  const lies = messages.filter(message => !debut || quand(message) >= debut);', vers: '  const lies = messages;', label: 'sans la coupe du fil, les vieux mails reviennent sur la demande', rouge: (r) => Boolean(r.filAvant) && r.filAvant.msgs !== 1 },
      { de: "  if (reste <= 0) return { tone: 'late',", vers: "  if (false) return { tone: 'late',", label: 'sans le retard, une echeance depassee ne se voit plus', rouge: (r) => Array.isArray(r.ordre) && !(r.puce802 && r.puce802.t === 'En retard') },
      { de: '  // Demandes sur mesure : le compte a rebours de la reponse promise.\n  tickStaffRequestDues();\n', vers: '', label: 'sans le tic de la minute, le compte a rebours reste fige', run: horlogeDuBureau, rouge: (r) => Boolean(r.dixMinutes && r.dixMinutes.puce && r.avant && r.avant.puce) && r.dixMinutes.puce.t === r.avant.puce.t },
      { de: "  if (board.getAttribute('data-due-tones') !== staffRequestDueToneKey()) { renderStaffUtilityPage(); return; }\n", vers: '', label: 'sans le repeint au changement de ton, le sous-titre ne compte pas le nouveau retard', run: horlogeDuBureau, rouge: (r) => Boolean(r.echue) && !/dont 2 en retard/.test(r.echue.sousTitre) },
      { de: "getStaffCustomRequestItems().filter(item => staffRequestStage(item) === 'a-traiter').sort(staffRequestCompare('atraiter'));", vers: "getStaffCustomRequestItems().filter(item => item.status === 'new' || item.status === 'in_progress');", label: 'sans le filtre de l etape, l alerte liste une demande qui attend le client', run: alerteDuTableau, rouge: (r) => Array.isArray(r.lignes) && r.lignes.some((l) => l.id === '803') },
      { de: '    followStaffRequest(item.id);\n    // Une demande a laquelle on vient de repondre', vers: '    // Une demande a laquelle on vient de repondre', label: 'sans le suivi de la page, la demande repondue sort de la vue', rouge: (r) => Boolean(r.envoi) && (r.envoi.ouvert !== '801' || !/En attente/.test(r.envoi.onglet)), aussi: { de: "if (item.status === 'new') { setStaffCustomRequestStatus(item.id, 'in_progress', { silencieux: true, suivre: true }); return; }", vers: "if (item.status === 'new') { setStaffCustomRequestStatus(item.id, 'in_progress', { silencieux: true }); return; }" } },
    ];
    for (const e of essais) {
      if (!montable(e.de) || (e.aussi && !montable(e.aussi.de))) continue;
      mutation = { de: e.de, vers: e.vers };
      let r = null;
      try {
        if (e.aussi) {
          // Deux coupures dans le meme fichier : la seconde s applique sur la premiere.
          const une = source.split(e.de).join(e.vers);
          mutation = { de: source, vers: une.split(e.aussi.de).join(e.aussi.vers) };
        }
        r = await (e.run ? e.run(browser) : parcours(browser, { captures: false }));
      } finally { mutation = null; }
      ok(Boolean(r) && e.rouge(r), `${e.label} : ce gate ROUGIRAIT`, r && r.panne ? `parcours arrete : ${r.panne}` : '');
    }
    const casse = source.replace("setStaffCustomRequestStatus(demandeOrigine, 'handled', {", 'setStaffCustomRequestStatus(demandeOrigine, "done", {');
    ok(casse !== source && statutsInvalides(casse).includes('done'), 'avec le « done » d avant, la regle des statuts rougit');
    ok(fs.readFileSync(APP, 'utf8') === source, 'app-main.js du depot intact : les coupures ne vivaient que dans le serveur du gate');
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'demandes-console-check: ALL OK' : `demandes-console-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
