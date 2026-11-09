// LES DEMANDES SUR MESURE, DANS LA CONSOLE (refaites le 2026-11-09).
//
// Ansar : « plus logique, moins IA, plus serieux et beaucoup plus simple ». Une liste, puis une
// fiche. Ce gate pilote la page par de VRAIS clics, sur une liste qui a tous les cas :
//   [A] la liste : quatre a traiter (un en retard, un a deux heures, un client qui a repondu, une
//       demande sans formulaire), une en attente, une reservee, une sans suite ; l ordre suit
//       l heure promise au client ; rien ne s ouvre tout seul ;
//   [B] la fiche dit tout ce que le client a rempli ;
//   [C] les disponibilites : ce que le moteur dit de la date, prix par joueur, budget depasse ;
//   [D] choisir une heure prepare le mail avec le modele, sans IA, et rien ne part ;
//   [E] l envoi : la reponse se range dans l historique, la fiche reste ouverte ;
//   [F] les mails d avant la demande ne polluent pas l historique ;
//   [G] une note d equipe s ajoute a l historique ;
//   [H] une demande sans formulaire ne declenche aucune etude ;
//   [I] « Creer la reservation » preremplit le client, ses joueurs, sa date ;
//   [J] aucun appel ne pose un statut que la base refuse ;
//   [K] telephone : rien ne deborde ;
//   [M] l echeance suit l heure, sans repeindre la page ;
//   [N] l alerte du tableau de bord liste ce qui attend l equipe ;
//   [S] sans suite et rouvrir ;
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
    // Les ancres sont ecrites en LF ; une copie extraite par git sous Windows
    // est en CRLF : le fichier servi casse est ramene en LF avant la coupure.
    if (mutation && p.resolve(f) === (mutation.fichier ? p.join(ROOT, mutation.fichier) : APP)) corps = Buffer.from(c.toString('utf8').replace(/\r\n/g, '\n').split(mutation.de).join(mutation.vers), 'utf8');
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
        visite: { panne: false, ok: true, prix: 544, parJoueur: 17.55, prixComplet: true, depasse: 0, raison: '', proposition: { debut: '14:00', fin: '16:00' }, departs: [{ debut: '14:00', fin: '16:00', prix: 544 }, { debut: '15:00', fin: '17:00', prix: 544 }],
          lignes: [{ nom: 'Bowling', prix: 234, detail: '1 h, 6 pistes' }, { nom: 'Laser Game', prix: 310, detail: '1 partie, en 2 vagues' }], heuresParActivite: [{ nom: 'Bowling', heures: ['14:00'] }] },
        occupation: { reservations: 2, joueurs: 20 } },
      { date: D2, libelle: D2, principale: false, passee: false, ouvert: false, horaires: null, fenetre: null, formules: [], visite: null, occupation: null },
    ],
  };
  const CORPS_IA = 'Bonjour Ansar,\n\nMerci pour votre demande pour un groupe de 31 personnes.\n\nLa Formule 3 est possible avec un départ à 12:00 ou 14:30, pour 868 € pour le groupe.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont';
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
        if (window.__QA__.brouillon === 'perime') return J({ ok: true, id: corps.id, etude, brouillon: null, choixPerime: true });
        const code = window.__QA__.brouillon === 'code' || corps.sansIA === true;
        // La premiere reponse traine : la seconde arrive avant elle.
        if (window.__QA__.lent && window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').length === 1) await new Promise((r) => setTimeout(r, 1200));
        return J({ ok: true, id: corps.id, etude, brouillon: {
          source: code ? 'code' : 'ia', raison: code ? 'ia-absente' : '',
          objet: 'Votre venue pour 31 personnes chez Fun Galaxy Libramont', corps: `${CORPS_IA}${window.__QA__.lent && corps.choix ? ` Depart ${corps.choix.heure}.` : ''}`,
          pointsAVerifier: ['3 accompagnateurs non comptés dans les prix : à préciser au client si le centre leur facture quelque chose.'], controle: { ok: true },
        } });
      }
      if (corps.action === 'sendDirectEmail') {
        window.__QA__.envois.push(corps);
        comms.push({ id: 5001, direction: 'outbound', recipient: corps.to, subject: corps.subject, body: corps.body, status: 'queued', createdAt: new Date().toISOString(), sentAt: null, payload: { textBody: corps.body } });
        if (lead) {
          const r = { type: 'reponse', le: new Date().toISOString(), par: 'Rachel', objet: corps.subject, communicationId: 5001, ...(corps.draftSource ? { source: corps.draftSource } : {}), ...(corps.proposition ? { proposition: corps.proposition } : {}) };
          lead.suivi = { ...lead.suivi, reponses: lead.suivi.reponses + 1, derniereReponse: r, proposition: corps.proposition || lead.suivi.proposition || null, messageClient: null, historique: [...lead.suivi.historique, r] };
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
    if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: ymd(now), durationOptions: [], formules: [], activities: [{ id: 'bowling', name: 'Bowling', active: true, price: 10, unit: 'heure' }, { id: 'laser_game', name: 'Laser Game', active: true, price: 10, unit: 'partie' }], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
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
  await page.waitForSelector('.sm-l, .sm-fiche', { timeout: 10000 });
  await page.waitForTimeout(500);
  return { ctx, page, erreurs };
}

const texte = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
const ordreDeLaListe = (page) => page.evaluate(() => [...document.querySelectorAll('.sm-l')].map((b) => b.dataset.itemId));
const attendreEtude = (page) => page.waitForSelector('.sm-jour', { timeout: 8000 });
const ligne = (id) => `.sm-l[data-item-id="${id}"]`;
const ouvrirFiche = (page, id) => page.click(`${ligne(id)} .sm-l-n`);
const lignesMail = (page) => page.evaluate(() => [...document.querySelectorAll('.sm-hi-m')].map((b) => b.closest('div').innerText.replace(/\s+/g, ' ').trim()));

async function parcours(browser, { captures = true } = {}) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  const capture = (nom, options = {}) => (captures ? page.screenshot({ path: p.join(SHOTS, nom), fullPage: false, ...options }) : null);
  try {
    r.D1 = await page.evaluate(() => window.__QA__.D1);
    // [A] la liste
    r.ordre = await ordreDeLaListe(page);
    r.onglets = await page.evaluate(() => [...document.querySelectorAll('.sm-onglet')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    r.ficheAuDepart = await page.evaluate(() => document.querySelectorAll('.sm-fiche').length);
    r.sousTitre = await texte(page, '.utility-hero p');
    r.actualiser = await page.evaluate(() => [...document.querySelectorAll('.utility-actions button')].map((b) => b.textContent.trim()));
    const pastille = (id) => page.evaluate((s) => { const c = document.querySelector(s); return c ? { t: c.innerText.trim(), cls: c.className } : null; }, `${ligne(id)} .sm-du`);
    r.puce802 = await pastille(802);
    r.puce801 = await pastille(801);
    r.signal804 = await texte(page, `${ligne(804)} .sm-l-r small`);
    r.titre801 = await texte(page, `${ligne(801)} .sm-l-n`);
    r.ligne801 = await texte(page, ligne(801));
    await capture('liste-sombre.png');

    // [B] la fiche
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    await page.waitForTimeout(300);
    r.entete = await page.evaluate(() => ({
      nom: (document.querySelector('.sm-tete h2') || {}).textContent || '',
      sous: ((document.querySelector('.sm-tete p') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      retour: (document.querySelector('.sm-retour') || {}).textContent || '',
      boutons: [...document.querySelectorAll('.sm-tete button')].map((b) => b.textContent.trim()),
      liste: document.querySelectorAll('.sm-l').length,
    }));
    r.bandeau = await page.evaluate(() => { const b = document.querySelector('.sm-promis'); return b ? { t: b.innerText.replace(/\s+/g, ' ').trim(), cls: b.className } : null; });
    r.faits = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sm-s .sm-dl > div')].map((l) => [l.querySelector('dt').textContent, l.querySelector('dd').innerText.replace(/\s+/g, ' ').trim()])));
    r.mots = await page.evaluate(() => document.querySelector('.sm-fiche').innerText);
    r.vide = await texte(page, '.sm-c2 > .sm-actions');

    // [C] les disponibilites
    r.jours = await page.evaluate(() => [...document.querySelectorAll('.sm-jour, .sm-jour-off')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()));
    r.etudeDemandee = await page.evaluate(() => window.__QA__.appels.filter((a) => a.action === 'customRequestStudy').map((a) => a.id));
    await capture('fiche-sombre.png');
    await capture('fiche-sombre-page.png', { fullPage: true });

    // [F] les mails d avant la demande
    r.filAvant = await lignesMail(page);

    // [D] choisir une heure
    r.envoisAvant = await page.evaluate(() => window.__QA__.envois.length);
    const heure = page.locator('.sm-o', { hasText: 'Bowling + Laser Game' }).locator('.sm-h', { hasText: '14:00' });
    await heure.click();
    await page.waitForSelector('.sm-courrier textarea', { timeout: 8000 });
    await page.waitForFunction(() => /868 €/.test((document.querySelector('.sm-courrier textarea') || {}).value || ''), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    r.touche = await page.evaluate(() => {
      const on = document.querySelector('.sm-h.is-on');
      return { pressee: on ? on.getAttribute('aria-pressed') : '', heure: on ? on.innerText.replace(/\s+/g, ' ').trim() : '', resume: ((document.querySelector('.sm-courrier .sm-resume') || {}).innerText || '').replace(/\s+/g, ' ').trim() };
    });
    r.redaction = await page.evaluate(() => {
      const zone = document.querySelector('.sm-courrier textarea');
      const appel = window.__QA__.appels.filter((a) => a.action === 'customRequestDraft')[0] || { corps: {} };
      return {
        appel: window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').map((a) => a.corps.id),
        choix: appel.corps.choix || null,
        sansIA: appel.corps.sansIA,
        points: [...document.querySelectorAll('.sm-verif span')].map((s) => s.textContent.trim()),
        objet: (document.querySelector('.sm-courrier input') || {}).value || '',
        corps: zone ? zone.value : '',
        envois: window.__QA__.envois.length,
        hautMessage: zone ? Math.round(zone.getBoundingClientRect().height) : 0,
        cache: zone ? zone.scrollHeight - zone.clientHeight : -1,
        statut: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
        mots: document.querySelector('.sm-courrier').innerText,
      };
    });
    await capture('reponse-sombre.png', { fullPage: true });
    // Un message qui ne se prepare pas laisse le texte tel quel.
    r.garde = r.redaction.corps;
    await page.evaluate(() => { window.__QA__.brouillon = 'vide'; });
    await page.locator('.sm-o', { hasText: 'Bowling + Laser Game' }).locator('.sm-h', { hasText: '15:00' }).click();
    await page.waitForTimeout(800);
    r.apresVide = await page.evaluate(() => (document.querySelector('.sm-courrier textarea') || {}).value || '');
    await page.evaluate(() => { window.__QA__.brouillon = 'ia'; });
    await heure.click();
    await page.waitForTimeout(800);

    // [G] une note d equipe
    await page.fill('#reqNote-801', 'Rappeler le directeur mardi pour le pique-nique.');
    await page.click('.sm-historique .sm-actions button');
    await page.waitForFunction(() => /Rappeler le directeur mardi/.test((document.querySelector('.sm-hi') || {}).textContent || ''), null, { timeout: 5000 });
    r.note = await page.evaluate(() => ({ appel: window.__QA__.appels.filter((a) => a.action === 'customRequestNote').map((a) => a.corps.texte), fil: (document.querySelector('.sm-hi') || {}).innerText || '' }));

    // [E] l envoi, par le clic de l equipe
    await page.click('.sm-courrier .sm-p');
    await page.waitForFunction(() => window.__QA__.envois.length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(1200);
    r.envoi = await page.evaluate(() => ({
      corps: window.__QA__.envois[0],
      statut: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
      segment: state.staffRequestSegment,
      ouvert: (document.querySelector('.sm-fiche') || { getAttribute() { return ''; } }).getAttribute('data-request-id'),
      entete: ((document.querySelector('.sm-tete p') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      reponse: ((document.querySelector('.sm-c2') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      historique: (document.querySelector('.sm-hi') || {}).innerText || '',
      composeur: Boolean(document.querySelector('.sm-courrier')),
      principal: (document.querySelector('.sm-c2 .sm-p') || {}).textContent || '',
      dispos: document.querySelectorAll('.sm-jour').length,
    }));
    await page.locator('.sm-c2 .sm-b', { hasText: 'Autre proposition' }).click();
    await attendreEtude(page);
    await page.waitForTimeout(200);
    r.autre = await page.evaluate(() => ({ dispos: document.querySelectorAll('.sm-jour').length, gardee: (document.querySelector('.sm-h.is-on') || {}).innerText || '' }));

    // [I] la reservation preremplie
    await page.locator('.sm-c2 .sm-p', { hasText: 'Le client accepte' }).click();
    await page.waitForTimeout(500);
    r.resa = await page.evaluate(() => (typeof quickBookState !== 'undefined' && quickBookState ? { type: quickBookState.type, heure: quickBookState.startTime, bowling: Boolean(quickBookState.visit && quickBookState.visit.bowling && quickBookState.visit.bowling.on), laser: Boolean(quickBookState.visit && quickBookState.visit.laser_game && quickBookState.visit.laser_game.on), pax: quickBookState.pax, date: quickBookState.date, notes: quickBookState.notes, source: quickBookState.sourceRequestId, nom: quickBookState.name } : null));
    await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });

    // [H] une demande sans formulaire
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
    r.apresRetour = await page.evaluate(() => document.querySelectorAll('.sm-fiche').length);
    await page.evaluate(() => setStaffRequestSegment('atraiter'));
    await page.waitForTimeout(300);
    await ouvrirFiche(page, 807);
    await page.waitForTimeout(600);
    r.libre = { texte: await texte(page, '.sm-fiche'), etudes: await page.evaluate(() => window.__QA__.appels.filter((a) => a.action === 'customRequestStudy' && a.id === '807').length) };

    // Terminees : la reservee et la sans suite, cote a cote
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
    await page.locator('.sm-onglet', { hasText: 'Terminées' }).click();
    await page.waitForTimeout(400);
    r.terminees = await ordreDeLaListe(page);
    r.terminees805 = await texte(page, `${ligne(805)} .sm-l-r`);
    r.terminees806 = await texte(page, `${ligne(806)} .sm-l-r`);
    await page.evaluate(() => setStaffRequestSegment('atraiter'));
    await page.waitForTimeout(300);

    // En clair : le client qui a repondu
    if (captures) {
      await page.evaluate(() => { if (typeof setStaffTheme === 'function') setStaffTheme('light'); });
      await ouvrirFiche(page, 804);
      await attendreEtude(page).catch(() => {});
      await page.waitForTimeout(600);
      await capture('fiche-clair.png');
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
    const liste = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: window.innerWidth }));
    await ouvrirFiche(page, 801);
    await attendreEtude(page).catch(() => {});
    await page.waitForTimeout(700);
    const mesure = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: window.innerWidth }));
    await page.screenshot({ path: p.join(SHOTS, 'telephone.png'), fullPage: false });
    return { liste, mesure, erreurs };
  } finally { await ctx.close(); }
}

// [P] LE PLANNING A BOUGE PENDANT QU ON ECRIVAIT : le serveur refuse l heure, rien ne s ecrit.
async function heurePerimee(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await page.evaluate(() => { window.__QA__.brouillon = 'perime'; });
    await ouvrirFiche(page, 804);
    await attendreEtude(page);
    await page.locator('.sm-o', { hasText: 'Formule 3' }).locator('.sm-h').first().click();
    await page.waitForFunction(() => window.__QA__.appels.some((a) => a.action === 'customRequestDraft'), null, { timeout: 8000 });
    await page.waitForTimeout(500);
    r.lu = await page.evaluate(() => ({ choisies: document.querySelectorAll('.sm-h.is-on').length, mail: Boolean(document.querySelector('.sm-courrier')), consigne: ((document.querySelector('.sm-c2') || {}).innerText || '').replace(/\s+/g, ' ').trim() }));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

// [Q] DEUX HEURES TOUCHEES VITE : la reponse la plus lente ne remplace pas la derniere.
async function deuxHeures(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await page.evaluate(() => { window.__QA__.lent = 1; });
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    const programme = page.locator('.sm-o', { hasText: 'Bowling + Laser Game' });
    const appels = (n) => page.waitForFunction((k) => window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').length === k, n, { timeout: 8000 });
    await programme.locator('.sm-h', { hasText: '14:00' }).click();
    await appels(1);
    await programme.locator('.sm-h', { hasText: '15:00' }).click();
    await appels(2);
    await page.waitForTimeout(1800);
    r.lu = await page.evaluate(() => ({
      heures: window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').map((a) => a.corps.choix && a.corps.choix.heure),
      corps: (document.querySelector('.sm-courrier textarea') || {}).value || '',
      choisie: ((document.querySelector('.sm-h.is-on') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    }));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

// [M] L ECHEANCE SUIT L HEURE. Un repere pose sur la page survit a une mise a jour sur place,
// pas a un repeint.
async function horlogeDuBureau(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser, { horloge: true });
  const r = { erreurs };
  const lire = () => page.evaluate(() => {
    const puce = document.querySelector('.sm-l[data-item-id="801"] .sm-du');
    const bandeau = document.querySelector('.sm-promis');
    const fiche = document.querySelector('.sm-fiche');
    return {
      puce: puce ? { t: puce.innerText.trim(), cls: puce.className } : null,
      bandeau: bandeau ? bandeau.innerText.replace(/\s+/g, ' ').trim() : '',
      sousTitre: ((document.querySelector('.utility-hero p') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      ouvert: fiche ? fiche.getAttribute('data-request-id') : '',
      marque: Boolean(document.querySelector('.sm[data-qa-marque]')),
    };
  });
  try {
    await page.evaluate(() => document.querySelector('.sm').setAttribute('data-qa-marque', '1'));
    r.avant = await lire();
    await page.clock.fastForward('10:00');
    await page.waitForTimeout(400);
    r.dixMinutes = await lire();
    await ouvrirFiche(page, 801);
    await attendreEtude(page).catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.sm').setAttribute('data-qa-marque', '1'));
    r.ficheAvant = await lire();
    await page.clock.fastForward('10:00');
    await page.waitForTimeout(400);
    r.ficheApres = await lire();
    await page.clock.fastForward('01:45:00');
    await page.waitForTimeout(700);
    r.ficheEchue = await lire();
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
    await page.waitForTimeout(300);
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

// [S] SANS SUITE, ET LE RETOUR EN ARRIERE.
async function sansSuite(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await ouvrirFiche(page, 804);
    await attendreEtude(page);
    await page.locator('.sm-tete .sm-b', { hasText: 'Sans suite' }).click();
    await page.waitForFunction(() => window.__QA__.appels.some((a) => a.action === 'customRequestStatus'), null, { timeout: 5000 });
    await page.waitForTimeout(500);
    r.apres = await page.evaluate(() => ({
      statuts: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
      ouvert: (document.querySelector('.sm-fiche') || { getAttribute() { return ''; } }).getAttribute('data-request-id'),
      entete: ((document.querySelector('.sm-tete p') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      bouton: (document.querySelector('.sm-tete .sm-b') || {}).textContent || '',
      dispos: document.querySelectorAll('.sm-jour').length,
    }));
    await page.locator('.sm-tete .sm-b', { hasText: 'Rouvrir' }).click();
    await page.waitForTimeout(600);
    r.rouverte = await page.evaluate(() => ({
      statuts: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
      bouton: (document.querySelector('.sm-tete .sm-b') || {}).textContent || '',
    }));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

function verifierPerimee(h) {
  section('P. LE PLANNING A BOUGE : L HEURE N EST PLUS POSSIBLE');
  if (!ok(!h.panne && h.lu, 'MONTAGE le parcours va au bout', h.panne || '')) return;
  ok(h.lu.choisies === 0 && !h.lu.mail && /Choisissez une heure/.test(h.lu.consigne), 'l heure refusee se retire, aucun mail ne s ecrit dessus', JSON.stringify(h.lu));
}

function verifierDeuxHeures(h) {
  section('Q. DEUX HEURES TOUCHEES VITE');
  if (!ok(!h.panne && h.lu, 'MONTAGE les deux heures sont touchees', h.panne || '')) return;
  ok(JSON.stringify(h.lu.heures) === '["14:00","15:00"]', 'chaque heure touchee demande son mail', JSON.stringify(h.lu.heures));
  ok(/Depart 15:00\./.test(h.lu.corps) && !/Depart 14:00\./.test(h.lu.corps) && /15:00/.test(h.lu.choisie), 'le mail affiche est celui de la derniere heure touchee', JSON.stringify(h.lu));
}

function verifierHorloge(h) {
  section('M. L ECHEANCE SUIT L HEURE');
  if (!ok(!h.panne && h.avant && h.dixMinutes && h.echue, 'MONTAGE l horloge de la page se pilote', h.panne || '')) return;
  ok(h.erreurs.length === 0, 'MONTAGE zero erreur sous horloge pilotee', h.erreurs.join(' | '));
  ok(h.avant.puce && /^Reste (1 h 5\d|2 h)$/.test(h.avant.puce.t), 'au depart : environ deux heures', JSON.stringify(h.avant.puce));
  ok(h.dixMinutes.puce && h.avant.puce && h.dixMinutes.puce.t !== h.avant.puce.t && /^Reste 1 h [45]\d$/.test(h.dixMinutes.puce.t), 'dix minutes plus tard, la liste a compte dix minutes', `${h.avant.puce && h.avant.puce.t} -> ${h.dixMinutes.puce && h.dixMinutes.puce.t}`);
  ok(h.dixMinutes.marque, 'sans repeindre la liste', JSON.stringify(h.dixMinutes.marque));
  ok(/il reste 1 h [34]\d/.test(h.ficheApres.bandeau), 'la fiche aussi compte les minutes', h.ficheApres.bandeau);
  ok(h.ficheApres.marque && h.ficheApres.ouvert === '801', 'sans repeindre la fiche : ses mails restent en place', JSON.stringify({ m: h.ficheApres.marque, o: h.ficheApres.ouvert }));
  ok(/dépassée de \d+ min/.test(h.ficheEchue.bandeau) && h.ficheEchue.ouvert === '801', 'l heure passee, la fiche dit de combien et reste ouverte', h.ficheEchue.bandeau);
  ok(h.echue.puce && h.echue.puce.t === 'En retard' && /is-late/.test(h.echue.puce.cls), 'de retour a la liste, la ligne est en retard, en rouge', JSON.stringify(h.echue.puce));
  ok(/^2 en retard$/.test(h.echue.sousTitre), 'le sous-titre compte le nouveau retard', JSON.stringify(h.echue.sousTitre));
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

function verifierSansSuite(s) {
  section('S. SANS SUITE, ET ROUVRIR');
  if (!ok(!s.panne && s.apres, 'MONTAGE le parcours va au bout', s.panne || '')) return;
  ok(s.erreurs.length === 0, 'MONTAGE zero erreur', s.erreurs.join(' | '));
  ok(JSON.stringify(s.apres.statuts) === '["archived"]' && s.apres.ouvert === '804' && /Sans suite/.test(s.apres.entete), 'sans suite : la demande est classee, la fiche reste ouverte et le dit', JSON.stringify(s.apres));
  ok(s.apres.bouton === 'Rouvrir' && s.apres.dispos === 0, 'une demande sans suite ne propose plus rien, elle se rouvre', JSON.stringify(s.apres));
  ok(JSON.stringify(s.rouverte.statuts) === '["archived","in_progress"]' && s.rouverte.bouton === 'Sans suite', 'rouvrir la remet au travail', JSON.stringify(s.rouverte));
}

function verifier(r) {
  section('A. LA LISTE : CE QUI ATTEND L EQUIPE, DANS L ORDRE DE L HEURE PROMISE');
  if (!ok(!r.panne, 'MONTAGE le parcours va jusqu au bout', r.panne)) return;
  ok(r.erreurs.length === 0, 'MONTAGE la page s ouvre sans erreur', r.erreurs.join(' | '));
  ok(JSON.stringify(r.ordre) === JSON.stringify(['802', '801', '804', '807']), 'a traiter : le retard, puis l echeance la plus proche, puis la demande sans echeance', JSON.stringify(r.ordre));
  ok(r.onglets.length === 3 && /À traiter\s*4/.test(r.onglets[0]) && /En attente du client\s*1/.test(r.onglets[1]) && /Terminées\s*2/.test(r.onglets[2]), 'trois onglets et leurs comptes', JSON.stringify(r.onglets));
  ok(r.ficheAuDepart === 0, 'la page s ouvre sur la liste : rien ne s ouvre tout seul', String(r.ficheAuDepart));
  ok(r.sousTitre === '1 en retard', 'le sous-titre ne dit que le retard, les onglets disent le reste', r.sousTitre);
  ok(!r.actualiser.includes('Actualiser'), 'plus de bouton Actualiser : la page suit toute seule', JSON.stringify(r.actualiser));
  ok(r.puce802 && r.puce802.t === 'En retard' && /is-late/.test(r.puce802.cls), 'la demande en retard le dit, en rouge', JSON.stringify(r.puce802));
  ok(r.puce801 && /^Reste (1 h|2 h)/.test(r.puce801.t) && /is-soon/.test(r.puce801.cls), 'la demande a deux heures de l echeance dit ce qu il reste', JSON.stringify(r.puce801));
  ok(r.signal804 === 'Le client a répondu', 'le client qui a repondu se voit dans la liste', r.signal804);
  ok(r.titre801 === 'Athénée de Libramont', 'la ligne porte le nom de l organisation', r.titre801);
  ok(/31/.test(r.ligne801) && /après-midi/.test(r.ligne801) && /Formule 3, Bowling, Laser Game/.test(r.ligne801) && /Ansar Bisultanov/.test(r.ligne801), 'la ligne dit qui, combien, quand et quoi', r.ligne801);

  section('B. LA FICHE DIT TOUT CE QUE LE CLIENT A REMPLI');
  ok(/Athénée de Libramont/.test(r.entete.nom) && /École, jeunesse/.test(r.entete.sous) && /Reçue/.test(r.entete.sous), 'le groupe, son type, quand la demande est arrivee', JSON.stringify(r.entete));
  ok(/Toutes les demandes/.test(r.entete.retour) && r.entete.liste === 0, 'la fiche prend la page, un lien ramene a la liste', JSON.stringify(r.entete));
  ok(JSON.stringify(r.entete.boutons) === '["Sans suite"]', 'un seul geste de classement', JSON.stringify(r.entete.boutons));
  ok(r.bandeau && /is-soon/.test(r.bandeau.cls) && /Réponse promise avant/.test(r.bandeau.t), 'l heure promise au client est en tete de la fiche', JSON.stringify(r.bandeau));
  const f = r.faits;
  ok(f.Personnes === '31 joueurs et 3 accompagnateurs' && f['Âges'] === '7 à 12 ans' && /après-midi/.test(f.Date) && /autre/i.test('autre') && Boolean(f['Autre date']), 'combien, quel age, quand, et l autre date', JSON.stringify(f));
  ok(/Formule 3/.test(f.Souhaits) && /Bowling/.test(f.Souhaits) && /Laser Game/.test(f.Souhaits) && f.Budget === '25 € par personne', 'ce qu ils veulent et leur budget', JSON.stringify(f));
  ok(/pique-niquer sur place/.test(f.Message), 'le message du client est lu en entier', f.Message);
  ok(/Ansar Bisultanov, Enseignant/.test(f.Contact) && /\+32 470 11 22 33/.test(f['Téléphone']) && f['E-mail'] === 'ansar@example.org', 'qui appeler ou ecrire', JSON.stringify(f));
  ok(/Athénée de Libramont/.test(f.Facture) && /TVA BE0123456789/.test(f.Facture), 'la facture et sa TVA', f.Facture);
  ok(/^3 venues/.test(f['Déjà venu']), 'le client deja venu est reconnu', f['Déjà venu']);
  ok(!/\bIA\b|Touchez|moteur/.test(r.mots), 'la fiche ne parle ni d IA ni de moteur', (r.mots.match(/.{0,40}(\bIA\b|Touchez|moteur).{0,40}/) || [''])[0]);
  ok(/Écrire au client/.test(r.vide) && /Créer la réservation/.test(r.vide), 'sans heure choisie : ecrire, ou reserver', r.vide);

  section('C. LES DISPONIBILITES : CE QUE LE MOTEUR DIT DE LA DATE');
  const [j1 = '', j2 = ''] = r.jours;
  ok(r.etudeDemandee.filter((id) => id === '801').length === 1, 'l etude est demandee pour la fiche ouverte, une fois', JSON.stringify(r.etudeDemandee));
  ok(/Ouvert de 10:00 à 22:00/.test(j1) && /Après-midi de 12:00 à 18:00/.test(j1), 'le jour voulu : ouvert, et la plage de l apres-midi', j1.slice(0, 200));
  ok(/Formule 3/.test(j1) && /868 €/.test(j1) && /28 €/.test(j1) && /12:00/.test(j1) && /14:30/.test(j1), 'la formule : prix du groupe, prix par joueur, departs libres', j1);
  ok(/3 € au-dessus du budget/.test(j1), 'au-dessus du budget, l ecart par joueur est dit', j1);
  ok(/544 €/.test(j1) && /17,55 €/.test(j1) && !/Dans le budget/.test(j1) && /6 pistes/.test(j1) && /2 vagues/.test(j1) && /14:00/.test(j1) && /15:00/.test(j1), 'le programme des activites, son detail, et tous ses departs ; ce qui tient le budget n a rien a dire', j1);
  ok(/2 réservations et 20 joueurs/.test(j1) && /Voir le planning de ce jour/.test(j1), 'ce qui est deja prevu ce jour-la, et le planning a un clic', j1.slice(-160));
  ok(/autre date du client/.test(j2) && /fermé/.test(j2), 'l autre date du client : fermee, dit comme tel', j2);

  section('D. CHOISIR UNE HEURE : LE MAIL SE PREPARE, RIEN NE PART');
  ok(r.touche.pressee === 'true' && /14:00/.test(r.touche.heure), 'l heure choisie est marquee', JSON.stringify(r.touche));
  ok(/Bowling \+ Laser Game/.test(r.touche.resume) && /544 €/.test(r.touche.resume) && /à 14:00/.test(r.touche.resume) && /fin vers 16:00/.test(r.touche.resume) && /17,55 € par joueur/.test(r.touche.resume), 'le programme, le prix, le jour et l heure', r.touche.resume);
  ok(r.redaction.choix && r.redaction.choix.date === r.D1 && r.redaction.choix.type === 'visite' && r.redaction.choix.ref === 'programme' && r.redaction.choix.heure === '14:00', 'le mail est demande pour CETTE proposition', JSON.stringify(r.redaction.choix));
  ok(r.redaction.sansIA === true, 'le mail vient du modele, pas de l IA', String(r.redaction.sansIA));
  ok(r.redaction.hautMessage >= 200 && r.redaction.cache <= 2, 'le mail se lit en entier, pas une ligne sur dix', JSON.stringify({ h: r.redaction.hautMessage, c: r.redaction.cache }));
  ok(JSON.stringify(r.redaction.statut) === '["in_progress"]', 'choisir une heure prend la demande en charge', JSON.stringify(r.redaction.statut));
  ok(JSON.stringify(r.redaction.appel) === '[801]', 'un clic, un mail demande pour cette demande', JSON.stringify(r.redaction.appel));
  ok(r.redaction.points.length === 1 && /accompagnateurs non comptés/.test(r.redaction.points[0]), 'ce qu il faut verifier avant d envoyer est affiche', JSON.stringify(r.redaction.points));
  ok(/868 €/.test(r.redaction.corps) && /Formule 3/.test(r.redaction.corps) && r.redaction.objet.length > 0, 'objet et message sont remplis');
  ok(!/\bIA\b/.test(r.redaction.mots), 'la reponse ne parle pas d IA', r.redaction.mots.slice(0, 200));
  ok(r.envoisAvant === 0 && r.redaction.envois === 0, 'AUCUN envoi : preparer ne fait partir aucun mail');
  ok(r.apresVide === r.garde, 'un message qui ne se prepare pas laisse le texte tel quel');

  section('F. LES MAILS D AVANT LA DEMANDE');
  ok(r.filAvant.length === 1 && /Le client a écrit/.test(r.filAvant[0]) && /Question pique-nique/.test(r.filAvant[0]), 'seuls les mails de la demande sont dans l historique', JSON.stringify(r.filAvant));

  section('G. UNE NOTE D EQUIPE');
  ok(JSON.stringify(r.note.appel) === '["Rappeler le directeur mardi pour le pique-nique."]' && /Note de Rachel/.test(r.note.fil), 'la note part au serveur et s affiche dans l historique', r.note.fil.slice(-160));

  section('E. L ENVOI : PAR LE CLIC DE L EQUIPE, RANGE DANS L HISTORIQUE');
  ok(r.envoi.corps && r.envoi.corps.action === 'sendDirectEmail' && r.envoi.corps.customRequestId === 801 && r.envoi.corps.to === 'ansar@example.org' && r.envoi.corps.draftSource === 'code',
    'un envoi, a ce client, rattache a sa demande', JSON.stringify(r.envoi.corps && { a: r.envoi.corps.action, id: r.envoi.corps.customRequestId, s: r.envoi.corps.draftSource }));
  ok(JSON.stringify(r.envoi.statut) === '["in_progress"]', 'une demande nouvelle a laquelle on repond est prise en charge', JSON.stringify(r.envoi.statut));
  ok(r.envoi.segment === 'attente' && r.envoi.ouvert === '801' && /En attente du client/.test(r.envoi.entete), 'la fiche reste ouverte et dit ou elle en est', JSON.stringify({ s: r.envoi.segment, id: r.envoi.ouvert, e: r.envoi.entete }));
  ok(/E-mail envoyé par Rachel/.test(r.envoi.historique) && !r.envoi.composeur, 'l historique dit qui a repondu ; le courrier est referme', r.envoi.historique.slice(-200));
  ok(r.envoi.principal === 'Le client accepte, créer la réservation' && /Proposition envoyée/.test(r.envoi.reponse) && /544 €/.test(r.envoi.reponse) && /14:00/.test(r.envoi.reponse), 'la proposition partie reste lisible, et son oui est le geste suivant', JSON.stringify({ p: r.envoi.principal, t: r.envoi.reponse }));
  ok(r.envoi.dispos === 0 && r.autre.dispos === 1 && /14:00/.test(r.autre.gardee), 'les disponibilites se rangent ; « Autre proposition » les rend, l heure partie marquee', JSON.stringify({ avant: r.envoi.dispos, apres: r.autre }));
  ok(r.envoi.corps && r.envoi.corps.proposition && r.envoi.corps.proposition.heure === '14:00' && r.envoi.corps.proposition.prix === 544 && r.envoi.corps.proposition.date === r.D1, 'la proposition part avec le mail, pour que tout poste la retrouve', JSON.stringify(r.envoi.corps && r.envoi.corps.proposition));

  section('I. CREER LA RESERVATION, PREREMPLIE');
  ok(r.resa && r.resa.heure === '14:00' && r.resa.type === 'visite' && r.resa.bowling && r.resa.laser, 'la reservation reprend l heure et le programme proposes', JSON.stringify(r.resa));
  ok(r.resa && /proposition : Bowling \+ Laser Game, 14:00, 544 €/.test(r.resa.notes), 'la proposition est dans la note de la reservation', r.resa && r.resa.notes);
  ok(r.resa && r.resa.pax === 31 && r.resa.date === r.D1 && r.resa.source === 801 && /Ansar/.test(r.resa.nom) && /Demande sur mesure/.test(r.resa.notes) && /Athénée de Libramont/.test(r.resa.notes) && /3 accompagnateurs/.test(r.resa.notes),
    'les 31 joueurs, la date voulue, le client et la demande en note', JSON.stringify(r.resa));
  ok(r.apresRetour === 0, 'le lien ramene a la liste', String(r.apresRetour));

  section('H. UNE DEMANDE SANS FORMULAIRE');
  ok(/5 novembre/.test(r.libre.texte) && /Sortie de fin de trimestre/.test(r.libre.texte) && /Écrire au client/.test(r.libre.texte) && !/Disponibilités/.test(r.libre.texte) && r.libre.etudes === 0, 'la demande libre dit ce qu elle a, et n interroge pas le moteur', r.libre.texte.slice(0, 300));
  ok(JSON.stringify([...r.terminees].sort()) === '["805","806"]' && r.terminees805 === 'Réservée' && r.terminees806 === 'Sans suite', 'les terminees disent comment elles ont fini', JSON.stringify([r.terminees, r.terminees805, r.terminees806]));
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
    ok(t.erreurs.length === 0 && t.liste.large <= t.liste.vue && t.mesure.large <= t.mesure.vue, `rien ne deborde a 390 px (liste ${t.liste.large}, fiche ${t.mesure.large}, pour ${t.mesure.vue})`);
    verifierPerimee(await heurePerimee(browser));
    verifierDeuxHeures(await deuxHeures(browser));
    verifierHorloge(await horlogeDuBureau(browser));
    verifierAlerte(await alerteDuTableau(browser));
    verifierSansSuite(await sansSuite(browser));

    section('J. UN STATUT QUE LA BASE ACCEPTE');
    // Le fichier tel que sur le disque (verifie intact a la fin), et sa forme
    // en LF, sur laquelle les ancres des coupures se cherchent (une copie
    // extraite par git sous Windows est en CRLF).
    const brut = fs.readFileSync(APP, 'utf8');
    const source = brut.replace(/\r\n/g, '\n');
    const appels = [...source.matchAll(/setStaffCustomRequestStatus\(/g)].length;
    ok(appels >= 6 && statutsInvalides(source).length === 0, `chaque appel pose un statut de la base (${appels} appels lus)`, JSON.stringify(statutsInvalides(source)));
    ok(/setStaffCustomRequestStatus\(demandeOrigine, 'handled', \{[\s\S]{0,80}reservationId: payload\.reservation/.test(source), 'la reservation creee depuis une demande la classe traitee, reservation liee');

    section('L. CONTRE-EPREUVES');
    const lireLf = (rel) => fs.readFileSync(p.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const montable = (de, fichier) => ok((fichier ? lireLf(fichier) : source).split(de).length === 2, `contre-epreuve montable : « ${de.trim().slice(0, 70)} »`);
    const essais = [
      { de: "    if (rang !== staffRequestDraftRang[key]) return;\n    // Le planning a bouge", vers: "    // Le planning a bouge", label: 'sans le rang, la reponse lente remplacerait la derniere', run: deuxHeures, rouge: (r) => Boolean(r.lu) && !/Depart 15:00\./.test(r.lu.corps) },
      { de: "if (current.busy || (current.drafting && current.draftQuoi === quoi)) return;", vers: "if (current.busy || current.drafting) return;", label: 'sans la relance, la seconde heure n aurait pas son mail', run: deuxHeures, rouge: (r) => Boolean(r.panne) || (Boolean(r.lu) && !/Depart 15:00\./.test(r.lu.corps)) },
      { de: '        ...(staffRequestChoix[key] ? { proposition: staffRequestChoix[key] } : {}),\n', vers: '', label: 'sans la proposition au mail, le oui du client ne retrouverait rien', rouge: (r) => Boolean(r.envoi && r.envoi.corps) && !r.envoi.corps.proposition },
      { de: "...(choix ? { choix: { date: choix.date, type: choix.type, ref: choix.ref, heure: choix.heure } } : {}) }),", vers: '}),', label: 'sans l heure dans la demande, le mail parlerait de tout', rouge: (r) => Boolean(r.panne) || (Boolean(r.redaction) && !r.redaction.choix) },
      { de: 'centerId: getActiveOpsCenterId(), sansIA: true, ...(choix', vers: 'centerId: getActiveOpsCenterId(), ...(choix', label: 'sans la consigne, l IA ecrirait le mail', rouge: (r) => Boolean(r.redaction) && r.redaction.sansIA !== true },
      { de: '    ...(choix ? { startTime: choix.heure, heureSouhaitee: true } : {}),\n', vers: '', label: 'sans l heure, la reservation ne reprend pas la proposition', rouge: (r) => Boolean(r.resa) && r.resa.heure !== '14:00' },
      { de: '  if (!formuleRetenue && d) applyStaffRequestActivitiesToQuickBook(d);', vers: '', label: 'sans le programme, la reservation serait vide', rouge: (r) => Boolean(r.resa) && !(r.resa.bowling && r.resa.laser) },
      { de: '    if (payload && payload.choixPerime) {', vers: '    if (false) {', label: 'sans le refus, une heure prise serait ecrite au client', run: heurePerimee, rouge: (r) => Boolean(r.lu) && r.lu.choisies !== 0 },
      { fichier: 'assets/pinlane-staff.css', de: '.sm .sm-courrier textarea.input { min-height: 280px; }', vers: '.sm .sm-courrier textarea.input { min-height: 44px; height: 44px; }', label: 'la case du mail ramenee a une ligne', rouge: (r) => Boolean(r.redaction) && r.redaction.hautMessage < 200 },
      { de: '      if (da && db && da.t !== db.t) return da.t - db.t;', vers: '      if (da && db && da.t !== db.t) return 0;', label: 'sans l ordre de l echeance, le retard n est plus en tete', rouge: (r) => Array.isArray(r.ordre) && r.ordre[0] !== '802' },
      { de: "(thread.messages || []).filter(message => !debut || staffRequestTime(quandMail(message)) >= debut) : [];", vers: "(thread.messages || []) : [];", label: 'sans la coupe, les vieux mails reviennent dans l historique', rouge: (r) => Array.isArray(r.filAvant) && r.filAvant.length !== 1 },
      { de: "  if (reste <= 0) return { tone: 'late',", vers: "  if (false) return { tone: 'late',", label: 'sans le retard, une echeance depassee ne se voit plus', rouge: (r) => Array.isArray(r.ordre) && !(r.puce802 && r.puce802.t === 'En retard') },
      { de: '  // Demandes sur mesure : le compte a rebours de la reponse promise.\n  tickStaffRequestDues();\n', vers: '', label: 'sans le tic de la minute, le compte a rebours reste fige', run: horlogeDuBureau, rouge: (r) => Boolean(r.dixMinutes && r.dixMinutes.puce && r.avant && r.avant.puce) && r.dixMinutes.puce.t === r.avant.puce.t },
      { de: "  if (board.getAttribute('data-due-tones') !== staffRequestDueToneKey()) { renderStaffUtilityPage(); return; }\n", vers: '', label: 'sans le repeint au changement de ton, le sous-titre ne compte pas le nouveau retard', run: horlogeDuBureau, rouge: (r) => Boolean(r.ficheEchue) && Boolean(r.ficheEchue.marque) },
      { de: "getStaffCustomRequestItems().filter(item => staffRequestStage(item) === 'a-traiter').sort(staffRequestCompare('atraiter'));", vers: "getStaffCustomRequestItems().filter(item => item.status === 'new' || item.status === 'in_progress');", label: 'sans le filtre de l etape, l alerte liste une demande qui attend le client', run: alerteDuTableau, rouge: (r) => Array.isArray(r.lignes) && r.lignes.some((l) => l.id === '803') },
      { de: "  const wanted = String(state.staffRequestSelectedId || '');\n  if (!wanted) return null;\n", vers: "  const wanted = String(state.staffRequestSelectedId || '');\n  if (!wanted) return getStaffRequestRows()[0] || null;\n", label: 'sans la liste d abord, une demande s ouvrirait toute seule', rouge: (r) => Boolean(r.panne) || r.ficheAuDepart !== 0 },
      { de: "  return staffRequestStage(item) === 'a-traiter' || Boolean(staffRequestAutre[key]) || Boolean(staffRequestChoix[key]);", vers: "  return true;", label: 'sans le rangement, les disponibilites resteraient apres l envoi', rouge: (r) => Boolean(r.envoi) && r.envoi.dispos !== 0 },
      { de: "    ...mails.map(message => ({ le: quandMail(message), mail: message })),\n", vers: "", label: 'sans les mails dans l historique, le client qui ecrit ne se verrait pas', rouge: (r) => Array.isArray(r.filAvant) && r.filAvant.length !== 1 },
      { de: "setStaffCustomRequestStatus(${jid}, 'archived', { suivre: true })", vers: "setStaffCustomRequestStatus(${jid}, 'handled', { suivre: true })", label: 'sans suite ne doit pas classer la demande en terminee', run: sansSuite, rouge: (r) => Boolean(r.apres) && JSON.stringify(r.apres.statuts) !== '["archived"]' },
    ];
    for (const e of essais) {
      if (!montable(e.de, e.fichier) || (e.aussi && !montable(e.aussi.de))) continue;
      mutation = { de: e.de, vers: e.vers, fichier: e.fichier };
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
    ok(fs.readFileSync(APP, 'utf8') === brut, 'app-main.js du depot intact : les coupures ne vivaient que dans le serveur du gate');
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'demandes-console-check: ALL OK' : `demandes-console-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
