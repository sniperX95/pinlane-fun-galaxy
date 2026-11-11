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
// PINLANE_SANS_CONTRE_PREUVES=1 (la suite d avant mise en ligne, gates-lancer.js
// --sans-contre-preuves) : [L] verifie seulement que chaque coupure se monte
// encore, sans rejouer le parcours 35 fois (6 des 7 minutes de ce gate). Les
// coupures se rejouent la nuit et quand le diff touche ce fichier.
const SANS_CONTRE_PREUVES = process.env.PINLANE_SANS_CONTRE_PREUVES === '1';
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
  // UN DIMANCHE, TOUJOURS (2026-11-10). La date etait « dans vingt jours » et ce gate lit
  // « dimanche » dans la fiche : il n etait vert que le jour ou vingt jours plus tard tombait
  // un dimanche. Ecrit le 09/11, il a rougi des le 10/11 : la demande tombait un lundi, jour
  // ferme, et le parcours de 08:00 s arretait. Le premier dimanche a vingt jours ou plus, pris
  // a midi pour qu un changement d heure ne decale pas le jour ; l autre date deux jours avant.
  const dimanche = new Date(now + 20 * 24 * H);
  dimanche.setHours(12, 0, 0, 0);
  dimanche.setDate(dimanche.getDate() + ((7 - dimanche.getDay()) % 7));
  const D1 = ymd(dimanche.getTime());
  const D2 = ymd(dimanche.getTime() - 2 * 24 * H);
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
    { id: 803, centerId: 'libramont', contactName: 'Marc Lambert', company: '', email: 'marc@example.org', phone: '', requestedDate: '', pax: 24, occasion: 'anniversaire', message: '', status: 'in_progress', createdAt: iso(now - 50 * H), updatedAt: iso(now - 20 * H), payload: { demande: demande({ groupType: 'amis', groupTypeLabel: 'Amis, famille', organisation: '', participants: 24, companions: 0, invoice: false, vatNumber: '', contactRole: '' }) }, echeance: null, suivi: suivi('en-attente', { priseEnCharge: prise, reponses: 1, derniereReponse: reponse(iso(now - 20 * H)), proposition: { date: D1, type: 'visite', ref: 'programme', heure: '14:00', nom: 'Bowling + Laser Game', prix: 544, parJoueur: 17.55, fin: '16:00' }, historique: [prise, reponse(iso(now - 20 * H))] }) },
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
  const pistes = (d, f, liste) => ({ r: 'bowling_lane', nom: 'Bowling', d, f, joueurs: 31, pistes: liste, n: liste.length });
  const arene = (d, f, joueurs) => ({ r: 'laser_arena', nom: 'Laser Game', d, f, joueurs });
  const etude = {
    participants: 31, moment: 'apres-midi', momentLabel: 'Après-midi', sansDate: '',
    dates: [
      { date: D1, libelle: D1, principale: true, passee: false, ouvert: true, horaires: { de: '10:00', a: '22:00' }, fenetre: { de: 720, a: 1080, existe: true, raison: '' },
        formules: [{ id: 'f3', nom: 'Formule 3', panne: false, ok: true, prix: 868, parJoueur: 28, heures: ['12:00', '14:30'], heuresAilleurs: [], raison: '',
          plans: { '12:00': { fin: '15:30', blocs: [pistes('12:00', '13:00', [3, 4, 5, 6, 7, 8]), arene('13:00', '13:20', 16), arene('13:20', '13:40', 15)], reste: [{ n: 2, unite: 'piste' }, { n: 14, unite: 'arme' }] },
            '14:30': { fin: '18:00', blocs: [pistes('14:30', '15:30', [1, 2, 3, 4, 7, 8]), arene('15:30', '15:50', 16), arene('15:50', '16:10', 15)], reste: [{ n: 0, unite: 'piste' }, { n: 14, unite: 'arme' }] } } }],
        visite: { panne: false, ok: true, prix: 544, parJoueur: 17.55, prixComplet: true, depasse: 0, raison: '', proposition: { debut: '14:00', fin: '16:00' }, departs: [{ debut: '14:00', fin: '16:00', prix: 544, blocs: [pistes('14:00', '15:00', [3, 4, 5, 6, 7, 8]), arene('15:00', '15:20', 16), arene('15:20', '15:40', 15)], reste: [{ n: 2, unite: 'piste' }, { n: 14, unite: 'arme' }] },
          { debut: '15:00', fin: '17:00', prix: 544, blocs: [pistes('15:00', '16:00', [1, 2, 3, 4, 7, 8]), arene('16:00', '16:20', 16), arene('16:20', '16:40', 15)], reste: [{ n: 0, unite: 'piste' }, { n: 14, unite: 'arme' }] }],
          lignes: [{ nom: 'Bowling', prix: 234, detail: '1 h, 6 pistes' }, { nom: 'Laser Game', prix: 310, detail: '1 partie, en 2 vagues' }], heuresParActivite: [{ nom: 'Bowling', heures: ['14:00'] }] },
        occupation: { reservations: 2, joueurs: 20, capacites: { pistes: 8, armes: 30 }, blocs: [
          { r: 'bowling_lane', d: '10:30', f: '12:00', pistes: [1, 2, 3], libelle: 'Formule 2', joueurs: 12 },
          { r: 'laser_arena', nom: 'Laser Game', d: '12:00', f: '12:20', libelle: 'Formule 2', joueurs: 12 },
          { r: 'bowling_lane', d: '15:00', f: '16:00', pistes: [5, 6], libelle: 'Bowling', joueurs: 8 },
        ] } },
      { date: D2, libelle: D2, principale: false, passee: false, ouvert: false, horaires: null, fenetre: null, formules: [], visite: null, occupation: null },
    ],
  };
  const CORPS_IA = 'Bonjour Ansar,\n\nMerci pour votre demande pour un groupe de 31 personnes.\n\nLa Formule 3 est possible avec un départ à 12:00 ou 14:30, pour 868 € pour le groupe.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont';
  const etapeDe = (lead) => {
    if (lead.status === 'archived') return 'archivee';
    if (lead.status === 'handled') return 'traitee';
    return lead.suivi.reponses && !lead.suivi.messageClient ? 'en-attente' : 'a-traiter';
  };
  const clientDuBanc = () => ({ clientName: 'Ansar', visits: 3, lastVisit: ymd(now - 40 * 24 * H), reservationsAVenir: 0, prochaineReservation: null, depense: 1240, absences: 1,
        venues: [{ date: ymd(now - 40 * 24 * H), heure: '14:00', pax: 28, label: 'Formule 2', prix: 540 }, { date: ymd(now - 150 * 24 * H), heure: '10:00', pax: 22, label: 'Bowling + Laser Game', prix: 420 }, { date: ymd(now - 300 * 24 * H), heure: '16:00', pax: 16, label: 'Formule 1', prix: 280 }] });
  const J = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const natif = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
    const methode = String(init.method || 'GET').toUpperCase();
    if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: window.__QA__.sansForcer ? { ...session, role: { id: 'accueil', name: 'Accueil', locked: false }, permissions: [...perms, 'niveau:forcer:non'] } : session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
    if (u.pathname === '/api/staff-state') {
      const jourDemande = u.searchParams.get('date');
      const ouv = window.__QA__.ouvertures || [];
      const resas = (window.__QA__.resasDuJour || []).filter((r) => r.date === jourDemande);
      return J({ ok: true, revision: `qa:${JSON.stringify(ouv)}:${resas.length}`, reservations: resas, laneStatuses: {}, centerId: 'libramont', ouvertures: ouv });
    }
    if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
    if (u.pathname === '/api/ops' && methode === 'POST') {
      const corps = JSON.parse(init.body || '{}');
      window.__QA__.appels.push({ methode, action: corps.action, corps });
      const lead = leads.find((l) => String(l.id) === String(corps.id || corps.customRequestId));
      // L assistant de la fiche (2026-11-10) : une proposition et son mail, la consigne suivie a la lettre.
      if (corps.action === 'customRequestAssist') {
        if (window.__QA__.assist === 'panne') return J({ ok: false, error: 'Pinlane ne répond pas pour le moment.' }, 503);
        const c = String(corps.consigne || '');
        const plusTard = /15/.test(c);
        const prixImpose = /20 ?€/.test(c);
        const prix = prixImpose ? 620 : 544;
        const heure = plusTard ? '15:00' : '14:00';
        const fin = plusTard ? '17:00' : '16:00';
        const sans = window.__QA__.assist === 'rien';
        const proposition = sans ? null : { date: D1, type: 'libre', ref: 'programme', heure, fin, nom: 'Bowling + Laser Game', prix, parJoueur: Math.round((prix / 31) * 100) / 100, joueurs: 31, formule: '', activites: [{ id: 'bowling', nom: 'Bowling' }, { id: 'laser_game', nom: 'Laser Game' }], plus: false, prixLibre: prixImpose, verifiee: !plusTard, extras: [{ id: 'soft', nom: 'Soft', categorie: 'boissons', quantite: 31, prixUnitaire: 2.5, total: 77.5 }] };
        if (window.__QA__.assistLent && window.__QA__.appels.filter((a) => a.action === 'customRequestAssist').length === 1) await new Promise((r) => setTimeout(r, 1200));
        // Le temps que le test lise l ecran d attente : sans lui, la reponse revient avant la lecture.
        if (window.__QA__.assistAttente) await new Promise((r) => setTimeout(r, window.__QA__.assistAttente));
        // Une regle dite (« toujours… ») se propose a retenir ; « réserve » ouvre la carte de confirmation.
        const aRetenir = /toujours un soft/i.test(c) ? 'Toujours un soft par enfant aux anniversaires.' : '';
        const geste = proposition && /r[ée]serve/i.test(c) ? 'reserver' : '';
        return J({ ok: true, id: corps.id, proposition, consigneSuivie: true, source: 'ia', etude, client: clientDuBanc(), aRetenir, geste,
          pourquoi: 'C’est l’après-midi demandé, et le programme tient dans leur budget.',
          suggestions: ['Plutôt 15:00', 'Proposer la Formule 3 à 14:30', 'Le vendredi 4 décembre'],
          brouillon: { source: 'ia', raison: '', objet: 'Votre venue pour 31 personnes chez Fun Galaxy Libramont',
            corps: `Bonjour Ansar,\n\nMerci pour votre demande pour un groupe de 31 personnes.\n\nL’équipe vous propose le bowling et le laser game à ${heure}, avec une fin vers ${fin}, pour ${prix} € pour le groupe.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont`,
            pointsAVerifier: [...(plusTard ? ['D’après le planning, 15:00 n’est pas libre pour ce groupe : regardez-le avant d’envoyer.'] : []), '3 accompagnateurs non comptés dans les prix : à préciser au client si le centre leur facture quelque chose.'] } });
      }
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
      if (corps.action === 'ouvertureExceptionnelle') {
        if (window.__QA__.refusOuverture) return J({ ok: false, message: window.__QA__.refusOuverture }, 409);
        const autres = (window.__QA__.ouvertures || []).filter((o) => o.date !== corps.date);
        const ligne = corps.retirer ? null : { date: corps.date, open: corps.open, close: corps.close, motif: corps.motif || '' };
        window.__QA__.ouvertures = ligne ? [...autres, ligne] : autres;
        return J({ ok: true, action: corps.action, centerId: 'libramont', ouverture: ligne, ouvertures: window.__QA__.ouvertures });
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
      // La reservation en un clic (2026-11-11) : d abord ce qu elle donnerait, la creation au seul clic confirme.
      if (corps.action === 'customRequestBook' && lead) {
        const p = corps.proposition || {};
        const resume = { date: p.date, heure: p.heure, fin: p.fin || '', nom: p.nom, joueurs: p.joueurs, extras: p.extras || [], prix: p.prix, libre: true, conflits: [], refus: '', pistes: [3, 4], email: lead.email || '' };
        if (corps.confirme !== true) return J({ ok: true, id: lead.id, simulation: true, resume });
        const le = new Date().toISOString();
        lead.status = 'handled';
        lead.suivi = { ...lead.suivi, reservationId: 9001, historique: [...lead.suivi.historique, { type: 'statut', le, par: 'Rachel', statut: 'handled' }, { type: 'reservation', le, par: 'Rachel', reservationId: 9001, date: p.date }] };
        lead.suivi.etape = etapeDe(lead);
        return J({ ok: true, id: lead.id, simulation: false, resume, reservation: { id: 9001, date: p.date, startTime: p.heure, pax: p.joueurs, price: p.prix, email: lead.email || '' }, confirmation: Boolean(lead.email), demande: JSON.parse(JSON.stringify(lead)) });
      }
      return J({ ok: true });
    }
    if (u.pathname === '/api/ops') {
      const action = u.searchParams.get('action') || '';
      window.__QA__.appels.push({ methode, action, id: u.searchParams.get('id') || '' });
      if (action === 'customRequests') return J({ ok: true, centerId: 'libramont', customRequests: JSON.parse(JSON.stringify(leads)) });
      if (action === 'customRequestStudy') return J({ ok: true, id: Number(u.searchParams.get('id')), etude, client: clientDuBanc() });
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
// La fiche est prete quand Pinlane a propose (ou quand la suite d une reponse partie s affiche).
const attendreEtude = (page) => page.waitForSelector('.sm-ia-p, .sm-reponse, .sm-ia .sm-note', { timeout: 8000 });
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

    // [B] la fiche : ce qu ils demandent, puis ce que Pinlane propose
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    await page.waitForTimeout(300);
    r.entete = await page.evaluate(() => ({
      nom: (document.querySelector('.sm-tete h2') || {}).textContent || '',
      sous: ((document.querySelector('.sm-tete-t') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      liens: [...document.querySelectorAll('.sm-tete a')].map((a) => ({ t: a.textContent.trim(), href: a.getAttribute('href') })),
      retour: (document.querySelector('.sm-retour') || {}).textContent || '',
      boutons: [...document.querySelectorAll('.sm-tete button')].map((b) => b.textContent.trim()),
      liste: document.querySelectorAll('.sm-l').length,
    }));
    r.bandeau = await page.evaluate(() => { const b = document.querySelector('.sm-promis'); return b ? { t: b.innerText.replace(/\s+/g, ' ').trim(), cls: b.className } : null; });
    r.photoAilleurs = await page.evaluate(() => smPhotoDe('Bowling', 'un-autre-centre'));
    r.demandeTexte = await texte(page, '.sm-demande');
    r.envies = await page.evaluate(() => [...document.querySelectorAll('.sm-demande .sm-dem-envie')].map((e) => e.textContent.trim()));
    r.clientTexte = await texte(page, '.sm-client');
    r.venues = await page.evaluate(() => document.querySelectorAll('.sm-venues li').length);
    r.mots = await page.evaluate(() => document.querySelector('.sm-fiche').innerText);
    r.tete = await page.evaluate(() => { const t = document.querySelector('.sm-tete'); const e = t.querySelector('.sm-tete-n .sm-du'); return { date: Boolean(t.querySelector('.sm-date')), demande: Boolean(t.querySelector('.sm-demande')), etat: e ? { t: e.textContent.trim(), cls: e.className } : null, principal: (t.querySelector('.sm-p') || {}).textContent || '', haut: Math.round(t.getBoundingClientRect().height) }; });
    r.ia = await page.evaluate(() => {
      const t = (s) => ((document.querySelector(s) || {}).innerText || '').replace(/\s+/g, ' ').trim();
      return {
        quand: t('.sm-ia-quand'), quoi: t('.sm-ia-quoi'), prix: t('.sm-ia-prix'), pourquoi: t('.sm-ia-pq'),
        idees: [...document.querySelectorAll('.sm-ia-sg')].map((b) => b.textContent.trim()),
        appels: window.__QA__.appels.filter((a) => a.action === 'customRequestAssist').map((a) => ({ id: a.corps.id, consigne: a.corps.consigne, actuelle: a.corps.actuelle || null })),
        etudes: window.__QA__.appels.filter((a) => a.action === 'customRequestStudy').length,
        brouillons: window.__QA__.appels.filter((a) => a.action === 'customRequestDraft').length,
        ancien: Boolean(document.querySelector('.sm-j, .sm-jour, .sm-h, .sm-compose, .sm-envies')),
        ordre: [...document.querySelectorAll('.sm-une > section > h3')].map((h) => h.textContent.trim()),
      };
    });
    r.redaction = await page.evaluate(() => {
      const zone = document.querySelector('.sm-courrier textarea');
      return {
        points: [...document.querySelectorAll('.sm-verif span')].map((s) => s.textContent.trim()),
        objet: (document.querySelector('.sm-courrier input') || {}).value || '',
        corps: zone ? zone.value : '',
        envois: window.__QA__.envois.length,
        hautMessage: zone ? Math.round(zone.getBoundingClientRect().height) : 0,
        cache: zone ? zone.scrollHeight - zone.clientHeight : -1,
        statut: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
        mots: (document.querySelector('.sm-courrier') || {}).innerText || '',
        resume: Boolean(document.querySelector('.sm-courrier .sm-resume')),
        boutons: [...document.querySelectorAll('.sm-courrier .sm-actions button')].map((b) => b.textContent.trim()),
      };
    });
    await capture('fiche-sombre.png');
    await capture('fiche-sombre-page.png', { fullPage: true });

    // [F] les mails d avant la demande
    r.filAvant = await lignesMail(page);

    // [D] parler a Pinlane : la frappe qui tient, une idee touchee, une panne, une consigne
    r.envoisAvant = await page.evaluate(() => window.__QA__.envois.length);
    await page.fill('#smIaC-801', 'plutôt');
    await page.evaluate(() => renderStaffUtilityPage());
    r.frappe = await page.evaluate(() => (document.getElementById('smIaC-801') || {}).value || '');
    await page.locator('.sm-ia-sg', { hasText: 'Proposer la Formule 3' }).click();
    await page.waitForFunction(() => window.__QA__.appels.filter((a) => a.action === 'customRequestAssist').length === 2 && !document.querySelector('#smIa-801 .sm-ia-lit'), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    r.idee = await page.evaluate(() => { const a = window.__QA__.appels.filter((x) => x.action === 'customRequestAssist')[1]; return { consigne: a.corps.consigne, actuelle: a.corps.actuelle || null, statut: window.__QA__.appels.filter((x) => x.action === 'customRequestStatus').map((x) => x.corps.status) }; });
    r.garde = await page.evaluate(() => (document.querySelector('.sm-courrier textarea') || {}).value || '');
    await page.evaluate(() => { window.__QA__.assist = 'panne'; });
    await page.fill('#smIaC-801', 'plutôt 15 h');
    await page.click('#smIa-801 .sm-ia-c button[type=submit]');
    await page.waitForFunction(() => /Réessayez/.test((document.querySelector('#smIa-801') || {}).innerText || ''), null, { timeout: 8000 });
    r.panneIa = await page.evaluate(() => ({ texte: ((document.querySelector('#smIa-801') || {}).innerText || '').replace(/\s+/g, ' '), corps: (document.querySelector('.sm-courrier textarea') || {}).value || '', quand: ((document.querySelector('.sm-ia-quand') || {}).textContent || '').trim() }));
    await page.evaluate(() => { window.__QA__.assist = ''; window.__QA__.assistAttente = 900; });
    await page.fill('#smIaC-801', 'plutôt 15 h et fais 20 € par personne');
    await page.click('#smIa-801 .sm-ia-c button[type=submit]');
    await page.waitForSelector('#smIa-801 .sm-ia-lit', { timeout: 3000 }).catch(() => {});
    r.pendant = await page.evaluate(() => { window.__QA__.assistAttente = 0; return { lit: ((document.querySelector('#smIa-801 .sm-ia-lit') || {}).textContent || '').trim(), off: Boolean((document.querySelector('#smIa-801 .sm-ia-c button') || {}).disabled), lecture: Boolean((document.querySelector('.sm-courrier textarea') || {}).readOnly) }; });
    await page.waitForFunction(() => /15:00/.test((document.querySelector('.sm-ia-quand') || {}).textContent || ''), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    r.apres = await page.evaluate(() => {
      const t = (s) => ((document.querySelector(s) || {}).innerText || '').replace(/\s+/g, ' ').trim();
      const a = window.__QA__.appels.filter((x) => x.action === 'customRequestAssist').slice(-1)[0];
      return { quand: t('.sm-ia-quand'), prix: t('.sm-ia-prix'), consigne: a.corps.consigne, actuelle: a.corps.actuelle || null, corps: (document.querySelector('.sm-courrier textarea') || {}).value || '', points: [...document.querySelectorAll('.sm-verif span')].map((s) => s.textContent.trim()), saisie: (document.getElementById('smIaC-801') || {}).value || '' };
    });
    await capture('reponse-sombre.png', { fullPage: true });

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
      entete: ((document.querySelector('.sm-promis') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      reponse: ((document.querySelector('.sm-reponse') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      historique: (document.querySelector('.sm-hi') || {}).innerText || '',
      composeur: Boolean(document.querySelector('.sm-courrier')),
      principal: (document.querySelector('.sm-reponse .sm-p') || {}).textContent || '',
      ia: Boolean(document.querySelector('.sm-ia')),
    }));

    // [I] le oui du client : une carte relit la reservation, la fenetre Reserver reste a un clic
    await page.locator('.sm-reponse .sm-p', { hasText: 'Le client accepte' }).click({ timeout: 5000 });
    await page.waitForSelector('.sm-resa .sm-resa-l', { timeout: 5000 });
    r.carte = await page.evaluate(() => {
      const c = document.querySelector('.sm-resa');
      return {
        texte: (c.innerText || '').replace(/\s+/g, ' ').trim(),
        boutons: [...c.querySelectorAll('button')].map((x) => ({ t: x.textContent.trim(), off: x.disabled })),
        appels: window.__QA__.appels.filter((a) => a.action === 'customRequestBook').map((a) => ({ confirme: a.corps.confirme, centre: a.corps.centerId, heure: a.corps.proposition && a.corps.proposition.heure, prix: a.corps.proposition && a.corps.proposition.prix })),
      };
    });
    await page.locator('.sm-resa .sm-b', { hasText: 'Ouvrir dans Réserver' }).click({ timeout: 5000 });
    await page.waitForTimeout(500);
    r.resa = await page.evaluate(() => (typeof quickBookState !== 'undefined' && quickBookState ? { type: quickBookState.type, heure: quickBookState.startTime, bowling: Boolean(quickBookState.visit && quickBookState.visit.bowling && quickBookState.visit.bowling.on), laser: Boolean(quickBookState.visit && quickBookState.visit.laser_game && quickBookState.visit.laser_game.on), pax: quickBookState.pax, date: quickBookState.date, notes: quickBookState.notes, source: quickBookState.sourceRequestId, nom: quickBookState.name, prix: typeof getQuickBookCustomPrice === 'function' ? getQuickBookCustomPrice() : null } : null));
    await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });
    await page.waitForTimeout(200);
    await page.locator('.sm-resa .sm-lien', { hasText: 'Annuler' }).click({ timeout: 5000 });
    await page.waitForTimeout(200);
    r.carteFermee = await page.evaluate(() => !document.querySelector('.sm-resa'));
    // « Autre proposition » : Pinlane revient, la consigne attend, sans nouvel appel.
    await page.locator('.sm-reponse .sm-b', { hasText: 'Autre proposition' }).click();
    await page.waitForTimeout(300);
    r.autre = await page.evaluate(() => ({ ia: Boolean(document.querySelector('#smIa-801')), focus: (document.activeElement || {}).id || '', quand: ((document.querySelector('.sm-ia-quand') || {}).textContent || '').trim(), appels: window.__QA__.appels.filter((a) => a.action === 'customRequestAssist').length }));

    // [H] une demande en attente, puis une demande sans formulaire
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
    r.apresRetour = await page.evaluate(() => document.querySelectorAll('.sm-fiche').length);
    await page.locator('.sm-onglet', { hasText: 'En attente' }).click();
    await page.waitForSelector(ligne(803), { timeout: 5000 });
    await ouvrirFiche(page, 803);
    await attendreEtude(page).catch(() => null);
    await page.waitForTimeout(300);
    r.attente = await page.evaluate(() => ({ reponse: ((document.querySelector('.sm-reponse') || {}).innerText || '').replace(/\s+/g, ' ').trim(), client: ((document.querySelector('.sm-client') || {}).innerText || '').replace(/\s+/g, ' ').trim(), ia: Boolean(document.querySelector('.sm-ia')), appels: window.__QA__.appels.filter((a) => a.action === 'customRequestAssist' && String(a.corps.id) === '803').length }));
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
    await page.locator('.sm-onglet', { hasText: 'À traiter' }).click();
    await page.waitForSelector(ligne(807), { timeout: 5000 });
    await page.evaluate(() => setStaffRequestSegment('atraiter'));
    await page.waitForTimeout(300);
    await ouvrirFiche(page, 807);
    await page.waitForTimeout(600);
    r.libre = { texte: await texte(page, '.sm-fiche'), ia: await page.evaluate(() => Boolean(document.querySelector('#smIa-807 .sm-ia-c'))), appels: await page.evaluate(() => window.__QA__.appels.filter((a) => a.action === 'customRequestAssist' && String(a.corps.id) === '807').length) };

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

    // [I bis] la proposition a l ecran se reserve : la carte, puis le seul clic qui cree
    await page.evaluate(() => window.openStaffRequestsPage(801));
    await page.waitForSelector('#smIa-801 .sm-ia-p', { timeout: 8000 });
    r.extrasIa = await texte(page, '#smIa-801 .sm-ia-extras');
    await page.locator('#smIa-801 .sm-ia-g .sm-p', { hasText: 'Créer la réservation' }).click({ timeout: 5000 });
    await page.waitForSelector('.sm-resa .sm-resa-l', { timeout: 5000 });
    await page.locator('.sm-resa .sm-p', { hasText: 'Confirmer la réservation' }).click({ timeout: 5000 });
    await page.waitForSelector('.sm-resa-faite', { timeout: 5000 });
    r.faite = await page.evaluate(() => ({
      texte: ((document.querySelector('.sm-resa-faite') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      voir: [...document.querySelectorAll('.sm-resa-faite button')].some((b) => /Voir la réservation/.test(b.textContent)),
      appels: window.__QA__.appels.filter((a) => a.action === 'customRequestBook').map((a) => a.corps.confirme === true),
      ia: Boolean(document.querySelector('#smIa-801')),
    }));
    await page.click('.sm-retour');
    await page.waitForSelector('.sm-l', { timeout: 5000 });
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

// [Q] DEUX CONSIGNES VITE : la reponse la plus lente ne remplace pas la derniere.
// [R] UN MOT SUFFIT (2026-11-11) : « réserve » ouvre la carte de confirmation ; une regle dite se
// propose a retenir, et ne s apprend qu au clic.
async function unMotSuffit(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    await page.waitForSelector('#smIaC-801:not([readonly])', { timeout: 8000 });
    await page.fill('#smIaC-801', 'toujours un soft par enfant, et réserve');
    await page.locator('#smIa-801 .sm-ia-c .sm-p', { hasText: 'Changer' }).click({ timeout: 5000 });
    await page.waitForSelector('.sm-resa .sm-resa-l', { timeout: 8000 });
    r.carte = await page.evaluate(() => ({
      texte: ((document.querySelector('.sm-resa') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      appels: window.__QA__.appels.filter((a) => a.action === 'customRequestBook').map((a) => a.corps.confirme === true),
      retenir: ((document.querySelector('#smIa-801 .sm-ia-ret') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    await page.locator('#smIa-801 .sm-ia-ret .sm-b', { hasText: 'Retenir' }).click({ timeout: 5000 });
    await page.waitForFunction(() => window.__QA__.appels.some((a) => a.action === 'teachAgentFact'), null, { timeout: 5000 });
    await page.waitForTimeout(200);
    r.retenu = await page.evaluate(() => ({
      appel: (window.__QA__.appels.filter((a) => a.action === 'teachAgentFact')[0] || {}).corps || null,
      texte: ((document.querySelector('#smIa-801') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      bloc: Boolean(document.querySelector('#smIa-801 .sm-ia-ret')),
    }));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

function verifierUnMot(h) {
  section('R. UN MOT SUFFIT : RESERVER, RETENIR');
  ok(!h.panne, 'MONTAGE le parcours va au bout', h.panne || '');
  ok(Boolean(h.carte) && /Réserver pour ce groupe/.test(h.carte.texte) && JSON.stringify(h.carte.appels) === '[false]', '« réserve » ouvre la carte de confirmation, sans rien creer', JSON.stringify(h.carte));
  ok(Boolean(h.carte) && /À retenir pour les prochaines demandes : « Toujours un soft par enfant aux anniversaires\. »/.test(h.carte.retenir), 'la regle dite se propose a retenir', h.carte && h.carte.retenir);
  ok(Boolean(h.retenu && h.retenu.appel) && h.retenu.appel.reponse === 'Toujours un soft par enfant aux anniversaires.' && h.retenu.appel.centerId === 'libramont' && /demandes de groupe/.test(h.retenu.appel.question), 'retenir l apprend au centre ouvert, au seul clic', JSON.stringify(h.retenu && h.retenu.appel));
  ok(Boolean(h.retenu) && !h.retenu.bloc && /Pinlane s’en souviendra pour les prochaines demandes\./.test(h.retenu.texte), 'la fiche dit qu elle s en souviendra', h.retenu && h.retenu.texte.slice(0, 200));
  ok(!h.erreurs || h.erreurs.length === 0, 'MONTAGE zero erreur', JSON.stringify(h.erreurs || []));
}

async function deuxConsignes(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  try {
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    await page.evaluate(() => { window.__QA__.appels.length = 0; window.__QA__.assistLent = true; smIaLancer(801, 'plutôt 15 h'); smIaLancer(801, 'Proposer la Formule 3 à 14:30'); });
    await page.waitForTimeout(1800);
    r.final = await page.evaluate(() => ({
      quand: ((document.querySelector('.sm-ia-quand') || {}).textContent || '').trim(),
      corps: (document.querySelector('.sm-courrier textarea') || {}).value || '',
      appels: window.__QA__.appels.filter((a) => a.action === 'customRequestAssist').map((a) => a.corps.consigne),
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
      entete: ((document.querySelector('.sm-promis') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      bouton: (document.querySelector('.sm-tete button.sm-b-classer') || {}).textContent || '',
      dispos: document.querySelectorAll('.sm-ia').length,
    }));
    await page.locator('.sm-tete .sm-b', { hasText: 'Rouvrir' }).click();
    await page.waitForTimeout(600);
    r.rouverte = await page.evaluate(() => ({
      statuts: window.__QA__.appels.filter((a) => a.action === 'customRequestStatus').map((a) => a.corps.status),
      bouton: (document.querySelector('.sm-tete button.sm-b-classer') || {}).textContent || '',
    }));
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

// [O] LES FENETRES (2026-11-09, refaites le 2026-11-10 pour la fiche simple) : le planning du jour
// propose et la fiche du client s ouvrent par-dessus la demande, sans la quitter.
async function fenetres(browser) {
  const { ctx, page, erreurs } = await ouvrir(browser);
  const r = { erreurs };
  const ou = () => page.evaluate(() => ({ hash: location.hash, page: typeof getStaffMenuPage === 'function' ? getStaffMenuPage() : state.staffMenuPage }));
  try {
    r.D1 = await page.evaluate(() => window.__QA__.D1);
    await page.evaluate(({ d }) => {
      const base = { date: d, centerId: 'libramont', duration: 1, type: 'bowling', status: 'confirmed', label: 'Bowling', email: '', extras: [], notes: '' };
      window.__QA__.resasDuJour = [
        { ...base, id: 9101, name: 'Proximus', pax: 24, startTime: '08:00', lanes: [1, 2, 3, 4], occasion: 'teambuilding', price: 720, phone: '+32470000001' },
        { ...base, id: 9102, name: 'Famille Lemaire', pax: 8, startTime: '15:00', lanes: [5, 6], occasion: '', price: 96, phone: '+32470000002' },
      ];
    }, { d: r.D1 });
    await ouvrirFiche(page, 801);
    await attendreEtude(page);
    await page.waitForTimeout(300);
    const avant = await ou();
    await page.locator('.sm-ia-plan', { hasText: 'Voir le planning de ce jour' }).click();
    await page.waitForSelector('.sm-fen .sm-fen-planning .gf', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    r.planning = await page.evaluate(() => {
      const f = document.querySelector('.sm-fen');
      return f ? {
        titre: (f.querySelector('#smFenT') || {}).textContent || '',
        groupes: [...f.querySelectorAll('.gf-nom__t')].map((n) => n.textContent),
        marques: [...f.querySelectorAll('.gf-nom__m')].map((n) => n.textContent),
      } : null;
    });
    r.pagePlanning = { avant, apres: await ou() };
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    r.planningFerme = await page.evaluate(() => ({ ouverte: Boolean(document.querySelector('.sm-fen')), focus: ((document.activeElement && document.activeElement.textContent) || '').trim() }));
    const lien = page.locator('.sm-client .sm-lien', { hasText: 'Voir sa fiche client' });
    if (await lien.count()) {
      await lien.click();
      await page.waitForSelector('.sm-fen', { timeout: 4000 }).catch(() => {});
      r.client = await texte(page, '.sm-fen');
      r.pageClient = await ou();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  } catch (error) {
    r.panne = String((error && error.message) || error).split('\n')[0];
  } finally {
    await ctx.close();
  }
  return r;
}

function verifierFenetres(h) {
  section('O. LES FENETRES : LE PLANNING DU JOUR ET LE CLIENT, SANS QUITTER LA DEMANDE');
  if (!ok(!h.panne, 'MONTAGE le parcours va au bout', h.panne || '')) return;
  ok(h.erreurs.length === 0, 'MONTAGE zero erreur', h.erreurs.join(' | '));
  ok(Boolean(h.planning) && /^Planning du /.test(h.planning.titre) && h.planning.groupes.includes('Proximus'), 'le planning du jour propose s ouvre en fenetre, avec ses groupes', JSON.stringify(h.planning));
  ok(Boolean(h.planning) && h.planning.marques.includes('Team building'), 'le team building est marque au planning', JSON.stringify(h.planning && h.planning.marques));
  ok(Boolean(h.pagePlanning) && h.pagePlanning.apres.page === 'requests', 'la demande reste ouverte dessous', JSON.stringify(h.pagePlanning));
  ok(Boolean(h.planningFerme) && !h.planningFerme.ouverte && /Voir le planning de ce jour/.test(h.planningFerme.focus), 'Echap ferme la fenetre et rend la main au lien', JSON.stringify(h.planningFerme));
  ok(/Venues/.test(h.client || '') && /Absences/.test(h.client || '') && Boolean(h.pageClient) && h.pageClient.page === 'requests', 'le client s ouvre en fenetre, sans quitter la demande', JSON.stringify({ client: h.client, page: h.pageClient }));
}

function verifierDeuxConsignes(h) {
  section('Q. DEUX CONSIGNES VITE');
  if (!ok(!h.panne && h.final, 'MONTAGE le parcours va au bout', h.panne || '')) return;
  ok(JSON.stringify(h.final.appels) === '["plutôt 15 h","Proposer la Formule 3 à 14:30"]', 'deux consignes, deux appels, dans l ordre', JSON.stringify(h.final.appels));
  ok(/14:00/.test(h.final.quand) && /14:00/.test(h.final.corps) && !/15:00/.test(h.final.corps), 'la reponse lente de la premiere ne remplace pas la seconde', JSON.stringify(h.final).slice(0, 240));
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
  ok(JSON.stringify(s.apres.statuts) === '["archived"]' && s.apres.ouvert === '804' && /classée sans suite/.test(s.apres.entete), 'sans suite : la demande est classee, la fiche reste ouverte et le dit', JSON.stringify(s.apres));
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
  ok(/^Athénée de Libramont .*Ansar Bisultanov (Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\. \d{1,2} \S+ Après-midi 31 Formule 3 Bowling Laser Game/.test(r.ligne801), 'la ligne dit qui, quand, combien et quoi, dans cet ordre', r.ligne801);

  section('B. LA FICHE, EN TRES SIMPLE : CE QU ILS DEMANDENT EN TROIS PHRASES');
  ok(/Athénée de Libramont/.test(r.entete.nom) && /École, jeunesse/.test(r.entete.sous) && /reçue/.test(r.entete.sous), 'le groupe, son type, quand la demande est arrivee', JSON.stringify(r.entete));
  ok(/Toutes les demandes/.test(r.entete.retour) && r.entete.liste === 0, 'la fiche prend la page, un lien ramene a la liste', JSON.stringify(r.entete));
  ok(JSON.stringify(r.entete.boutons) === '["Sans suite"]' && !r.tete.principal, 'en tete : appeler et classer, rien d autre, le mail est deja pret plus bas', JSON.stringify([r.entete.boutons, r.tete.principal]));
  ok(!r.tete.date && !r.tete.demande && r.tete.etat && /is-soon/.test(r.tete.etat.cls) && /^Reste (1|2) h/.test(r.tete.etat.t) && r.tete.haut <= 120, 'l en-tete tient en une bande : le nom et son etat en aplat, la ligne du groupe, les gestes', JSON.stringify(r.tete));
  ok(r.entete.liens.length === 1 && r.entete.liens[0].t === 'Appeler' && r.entete.liens[0].href === 'tel:+32470112233', 'appeler le client est a un toucher', JSON.stringify(r.entete.liens));
  ok(r.bandeau && /is-soon/.test(r.bandeau.cls) && /Réponse promise avant/.test(r.bandeau.t), 'l heure promise au client se lit au-dessus de la proposition', JSON.stringify(r.bandeau));
  ok(/31 joueurs de 7 à 12 ans et 3 accompagnateurs/.test(r.demandeTexte) && /Dimanche \d{1,2} \S+ l’après-midi\s*ou le (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2} \S+/.test(r.demandeTexte) && /25 € par personne\s*soit 775 € pour 31 joueurs/.test(r.demandeTexte),
    'combien, quel age, quand, l autre date et leur budget, chacun a sa ligne', r.demandeTexte);
  ok(JSON.stringify(r.envies) === '["Formule 3","Bowling","Laser Game"]', 'ce qu ils veulent faire, en pastilles bien visibles', JSON.stringify(r.envies));
  ok(/pique-niquer sur place/.test(r.demandeTexte), 'le message du client est lu en entier', r.demandeTexte);
  ok(/Ansar Bisultanov, Enseignant/.test(r.clientTexte) && /\+32 470 11 22 33/.test(r.clientTexte) && /ansar@example\.org/.test(r.clientTexte), 'qui appeler ou ecrire', r.clientTexte);
  ok(/Facture au nom de Athénée de Libramont, TVA BE0123456789/.test(r.clientTexte), 'la facture et sa TVA', r.clientTexte);
  ok(/^Le client .*3 venues, la dernière le/.test(r.clientTexte) && /Pour 1 240 € au total/.test(r.clientTexte.replace(/ | /g, ' ')), 'le client deja venu est reconnu, avec ce qu il a represente', r.clientTexte);
  ok(/1 absence/.test(r.clientTexte), 'ses absences se voient', r.clientTexte);
  ok(r.venues === 3 && /Formule 2, 28 joueurs/.test(r.clientTexte) && /540 €/.test(r.clientTexte), 'ses dernieres venues se lisent, avec leur prix', r.clientTexte);
  ok(r.photoAilleurs === '', 'un autre client ne recoit pas les photos de ce centre', r.photoAilleurs);
  ok(!/\bIA\b|Touchez|moteur/.test(r.mots), 'la fiche ne parle ni d IA ni de moteur', (r.mots.match(/.{0,40}(\bIA\b|Touchez|moteur).{0,40}/) || [''])[0]);
  ok(!r.ia.ancien, 'plus de journee dessinee, ni de grille d heures, ni de composeur : une seule proposition', String(r.ia.ancien));
  ok(JSON.stringify(r.ia.ordre) === '["Ce qu’ils demandent","Pinlane propose","Le mail au client","Le client","Historique"]', 'de haut en bas : la demande, ce que Pinlane propose, le mail, le client, l historique', JSON.stringify(r.ia.ordre));

  section('C. PINLANE PROPOSE, DES L OUVERTURE');
  ok(r.ia.appels.length === 1 && r.ia.appels[0].id === 801 && r.ia.appels[0].consigne === '' && r.ia.etudes === 0 && r.ia.brouillons === 0, 'a l ouverture, une seule question a Pinlane pour cette demande, et aucun autre appel', JSON.stringify(r.ia));
  ok(/^Dimanche \d{1,2} \S+, de 14:00 à 16:00$/.test(r.ia.quand) && r.ia.quoi === 'Bowling et Laser Game pour 31 joueurs' && /^544 €, soit 17,55 € par joueur\. C’est dans leur budget\./.test(r.ia.prix), 'la proposition en trois lignes : quand, quoi pour combien, son prix par joueur face au budget', JSON.stringify(r.ia));
  ok(/après-midi demandé/.test(r.ia.pourquoi), 'pourquoi ce choix, en une phrase', r.ia.pourquoi);
  ok(JSON.stringify(r.ia.idees) === '["Plutôt 15:00","Proposer la Formule 3 à 14:30","Le vendredi 4 décembre"]', 'trois idees a toucher', JSON.stringify(r.ia.idees));
  ok(/14:00/.test(r.redaction.corps) && /544 €/.test(r.redaction.corps) && r.redaction.objet.length > 0 && !r.redaction.resume && !r.redaction.boutons.includes('Annuler'), 'le mail est deja ecrit sur cette proposition, sans la redire au-dessus', JSON.stringify({ c: r.redaction.corps.slice(0, 120), b: r.redaction.boutons }));
  ok(r.redaction.hautMessage >= 200 && r.redaction.cache <= 2, 'le mail se lit en entier, pas une ligne sur dix', JSON.stringify({ h: r.redaction.hautMessage, c: r.redaction.cache }));
  ok(r.redaction.points.length === 1 && /accompagnateurs non comptés/.test(r.redaction.points[0]), 'ce qu il faut verifier avant d envoyer est affiche', JSON.stringify(r.redaction.points));
  ok(JSON.stringify(r.redaction.statut) === '[]', 'ouvrir la fiche ne prend pas la demande en charge', JSON.stringify(r.redaction.statut));
  ok(!/\bIA\b/.test(r.redaction.mots), 'la reponse ne parle pas d IA', r.redaction.mots.slice(0, 200));
  ok(r.envoisAvant === 0 && r.redaction.envois === 0, 'AUCUN envoi : preparer ne fait partir aucun mail');

  section('D. PARLER A PINLANE');
  ok(r.frappe === 'plutôt', 'une consigne en cours de frappe tient au repeint de la page', r.frappe);
  ok(r.idee.consigne === 'Proposer la Formule 3 à 14:30' && r.idee.actuelle && r.idee.actuelle.type === 'libre' && r.idee.actuelle.heure === '14:00', 'une idee touchee part comme consigne, avec la proposition a l ecran', JSON.stringify(r.idee));
  ok(JSON.stringify(r.idee.statut) === '["in_progress"]', 'la premiere consigne prend la demande en charge', JSON.stringify(r.idee.statut));
  ok(/Réessayez/.test(r.panneIa.texte) && r.panneIa.corps === r.garde && /14:00/.test(r.panneIa.quand), 'Pinlane en panne le dit : la proposition et le mail restent', JSON.stringify(r.panneIa).slice(0, 240));
  ok(r.pendant.lit === 'Pinlane refait la proposition avec « plutôt 15 h et fais 20 € par personne ».' && r.pendant.off && r.pendant.lecture, 'pendant qu il travaille, Pinlane dit ce qu il fait, sans roue qui tourne, et le mail ne se touche pas', JSON.stringify(r.pendant));
  ok(/de 15:00 à 17:00/.test(r.apres.quand) && /^620 €, soit 20 € par joueur/.test(r.apres.prix) && r.apres.consigne === 'plutôt 15 h et fais 20 € par personne' && r.apres.actuelle && r.apres.actuelle.heure === '14:00', 'la consigne suivie, depuis la proposition a l ecran : la nouvelle heure et le prix par personne', JSON.stringify(r.apres).slice(0, 300));
  ok(/15:00/.test(r.apres.corps) && /620 €/.test(r.apres.corps) && r.apres.points.some((x) => /15:00 n’est pas libre/.test(x)) && r.apres.saisie === '', 'le mail suit, ce qui n est pas libre se signale, la case se vide', JSON.stringify(r.apres).slice(0, 300));

  section('F. LES MAILS D AVANT LA DEMANDE');
  ok(r.filAvant.length === 1 && /Le client a écrit/.test(r.filAvant[0]) && /Question pique-nique/.test(r.filAvant[0]), 'seuls les mails de la demande sont dans l historique', JSON.stringify(r.filAvant));

  section('G. UNE NOTE D EQUIPE');
  ok(JSON.stringify(r.note.appel) === '["Rappeler le directeur mardi pour le pique-nique."]' && /Note de Rachel/.test(r.note.fil), 'la note part au serveur et s affiche dans l historique', r.note.fil.slice(-160));

  section('E. L ENVOI : PAR LE CLIC DE L EQUIPE, RANGE DANS L HISTORIQUE');
  ok(r.envoi.corps && r.envoi.corps.action === 'sendDirectEmail' && r.envoi.corps.customRequestId === 801 && r.envoi.corps.to === 'ansar@example.org' && r.envoi.corps.draftSource === 'ia',
    'un envoi, a ce client, rattache a sa demande', JSON.stringify(r.envoi.corps && { a: r.envoi.corps.action, id: r.envoi.corps.customRequestId, s: r.envoi.corps.draftSource }));
  ok(JSON.stringify(r.envoi.statut) === '["in_progress"]', 'une demande deja prise en charge ne l est pas deux fois', JSON.stringify(r.envoi.statut));
  ok(r.envoi.segment === 'attente' && r.envoi.ouvert === '801' && /par Rachel\. Le client n’a pas encore répondu\./.test(r.envoi.entete), 'la fiche reste ouverte et dit ou elle en est', JSON.stringify({ s: r.envoi.segment, id: r.envoi.ouvert, e: r.envoi.entete }));
  ok(/E-mail envoyé par Rachel/.test(r.envoi.historique) && !r.envoi.composeur, 'l historique dit qui a repondu ; le courrier est referme', r.envoi.historique.slice(-200));
  ok(r.envoi.principal === 'Le client accepte, créer la réservation' && /Proposition envoyée/.test(r.envoi.reponse) && /620 €/.test(r.envoi.reponse) && /15:00/.test(r.envoi.reponse), 'la proposition partie reste lisible, et son oui est le geste principal', r.envoi.reponse.slice(0, 240));
  ok(!r.envoi.ia && r.autre.ia && r.autre.focus === 'smIaC-801' && /15:00/.test(r.autre.quand) && r.autre.appels === 4, 'Pinlane se range apres l envoi ; « Autre proposition » le rend, la consigne attend, sans nouvel appel', JSON.stringify({ avant: r.envoi.ia, apres: r.autre }));
  ok(r.envoi.corps && r.envoi.corps.proposition && r.envoi.corps.proposition.type === 'libre' && r.envoi.corps.proposition.heure === '15:00' && r.envoi.corps.proposition.prix === 620 && r.envoi.corps.proposition.joueurs === 31 && r.envoi.corps.proposition.date === r.D1,
    'la proposition part avec le mail, pour que tout poste la retrouve', JSON.stringify(r.envoi.corps && r.envoi.corps.proposition));

  section('I. RESERVER EN UN CLIC, OU PREREMPLIE');
  ok(Boolean(r.carte) && /Réserver pour ce groupe/.test(r.carte.texte) && /de 15:00 à 17:00/.test(r.carte.texte) && /31 joueurs/.test(r.carte.texte) && /620 €/.test(r.carte.texte) && /ansar@example\.org/.test(r.carte.texte),
    'le oui du client ouvre une carte qui relit la reservation : quand, combien, le prix, l e-mail de la confirmation', r.carte && r.carte.texte);
  ok(Boolean(r.carte) && r.carte.appels.length === 1 && r.carte.appels[0].confirme === false && r.carte.appels[0].centre === 'libramont' && r.carte.appels[0].heure === '15:00' && r.carte.appels[0].prix === 620,
    'la carte ne cree rien : une seule demande au serveur, sans confirmation, pour la proposition partie', JSON.stringify(r.carte && r.carte.appels));
  ok(Boolean(r.carte) && /Avec Soft × 31 \(77,50 €, compris dans le prix\)/.test(r.carte.texte), 'les extras choisis sont sur la carte, compris dans le prix', r.carte && r.carte.texte);
  ok(Boolean(r.carte) && r.carte.boutons.map((b) => b.t).join('|') === 'Confirmer la réservation|Ouvrir dans Réserver|Annuler' && r.carte.boutons.every((b) => !b.off), 'trois gestes : confirmer, tout regler dans Reserver, annuler', JSON.stringify(r.carte && r.carte.boutons));
  ok(r.carteFermee === true, 'annuler referme la carte sans rien creer', String(r.carteFermee));
  ok(/Avec Soft × 31 \(77,50 €, compris dans le prix\)\./.test(r.extrasIa || ''), 'la proposition de Pinlane dit ses extras', r.extrasIa);
  ok(Boolean(r.faite) && /Réservation créée/.test(r.faite.texte) && /La confirmation part au client par e-mail, à ansar@example\.org/.test(r.faite.texte) && r.faite.voir && !r.faite.ia,
    'confirmer cree la reservation : la carte le dit, la confirmation part, la proposition se range', JSON.stringify(r.faite));
  ok(Boolean(r.faite) && JSON.stringify(r.faite.appels.slice(-2)) === '[false,true]', 'la proposition a l ecran se relit, puis se cree au seul clic de confirmation', JSON.stringify(r.faite && r.faite.appels));
  ok(r.resa && r.resa.heure === '15:00' && r.resa.type === 'visite' && r.resa.bowling && r.resa.laser, 'la reservation reprend l heure et le programme proposes', JSON.stringify(r.resa));
  ok(r.resa && Number(r.resa.prix) === 620, 'et le prix pose par la consigne', JSON.stringify(r.resa && r.resa.prix));
  ok(r.resa && /proposition : Bowling \+ Laser Game, 15:00, 620 €/.test(r.resa.notes), 'la proposition est dans la note de la reservation', r.resa && r.resa.notes);
  ok(r.resa && r.resa.pax === 31 && r.resa.date === r.D1 && r.resa.source === 801 && /Ansar/.test(r.resa.nom) && /Demande sur mesure/.test(r.resa.notes) && /Athénée de Libramont/.test(r.resa.notes) && /3 accompagnateurs/.test(r.resa.notes),
    'les 31 joueurs, la date, le client et la demande en note', JSON.stringify(r.resa));
  ok(r.apresRetour === 0, 'le lien ramene a la liste', String(r.apresRetour));
  ok(r.attente && /envoyée/.test(r.attente.reponse) && /3 venues/.test(r.attente.client) && !r.attente.ia && r.attente.appels === 0, 'une demande en attente rouverte retrouve sa reponse et son client, sans relancer Pinlane', JSON.stringify(r.attente));

  section('H. UNE DEMANDE SANS FORMULAIRE');
  ok(/5 novembre/.test(r.libre.texte) && /Sortie de fin de trimestre/.test(r.libre.texte) && /pas de formulaire détaillé/.test(r.libre.texte) && r.libre.ia && r.libre.appels === 0, 'la demande sans formulaire dit ce qu elle a, et Pinlane attend qu on lui dise quoi proposer', JSON.stringify(r.libre).slice(0, 300));
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
    verifierDeuxConsignes(await deuxConsignes(browser));
    verifierUnMot(await unMotSuffit(browser));
    verifierHorloge(await horlogeDuBureau(browser));
    verifierAlerte(await alerteDuTableau(browser));
    verifierSansSuite(await sansSuite(browser));
    verifierFenetres(await fenetres(browser));

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
      { de: "    if ((staffRequestIa[key] || {}).rang !== rang) return;\n    const p = payload", vers: "    const p = payload", label: 'sans le rang, la reponse lente de Pinlane remplacerait la derniere consigne', run: deuxConsignes, rouge: (r) => Boolean(r.final) && /15:00/.test(r.final.quand) },
      { de: "    if (p) staffRequestChoix[key] = p; else delete staffRequestChoix[key];\n", vers: '', label: 'sans la proposition retenue, le mail partirait sans elle', rouge: (r) => Boolean(r.envoi && r.envoi.corps) && !r.envoi.corps.proposition },
      { de: "  if (texte && item.status === 'new' && peutGeste('reserver')) setStaffCustomRequestStatus(item.id, 'in_progress', { silencieux: true, suivre: true });\n", vers: '', label: 'sans la prise en charge, une consigne laisserait la demande nouvelle', rouge: (r) => Boolean(r.idee) && JSON.stringify(r.idee.statut) === '[]' },
      { de: "  staffRequestIa[key] = { ...(staffRequestIa[key] || {}), saisie: String(valeur || '') };\n", vers: '', label: 'sans la frappe gardee, un repeint effacerait la consigne en cours', rouge: (r) => typeof r.frappe === 'string' && r.frappe !== 'plutôt' },
      { de: "...(actuelle ? { actuelle: rqChoixPourLeServeur(actuelle) } : {}) }),", vers: '}),', label: 'sans la proposition a l ecran, Pinlane repartirait de zero a chaque consigne', rouge: (r) => Boolean(r.apres) && !r.apres.actuelle },
      { de: "    if (prixRetenu && typeof onQuickCustomPriceInput === 'function') onQuickCustomPriceInput(prixRetenu);\n", vers: '', label: 'sans le prix pose, la reservation reprendrait le prix du catalogue', rouge: (r) => Boolean(r.resa) && Number(r.resa.prix) !== 620 },
      { de: '        ...(staffRequestChoix[key] ? { proposition: staffRequestChoix[key] } : {}),\n', vers: '', label: 'sans la proposition au mail, le oui du client ne retrouverait rien', rouge: (r) => Boolean(r.envoi && r.envoi.corps) && !r.envoi.corps.proposition },
      { de: '    ...(heureRetenue ? { startTime: heureRetenue, heureSouhaitee: true } : {}),\n', vers: '', label: 'sans l heure, la reservation ne reprend pas la proposition', rouge: (r) => Boolean(r.resa) && r.resa.heure !== '15:00' },
      { fichier: 'assets/pinlane-staff.css', de: '.sm .sm-courrier textarea.input { min-height: 280px; }', vers: '.sm .sm-courrier textarea.input { min-height: 44px; height: 44px; }', label: 'la case du mail ramenee a une ligne', rouge: (r) => Boolean(r.redaction) && r.redaction.hautMessage < 200 },
      { de: '      if (da && db && da.t !== db.t) return da.t - db.t;', vers: '      if (da && db && da.t !== db.t) return 0;', label: 'sans l ordre de l echeance, le retard n est plus en tete', rouge: (r) => Array.isArray(r.ordre) && r.ordre[0] !== '802' },
      { de: "(thread.messages || []).filter(message => !debut || staffRequestTime(quandMail(message)) >= debut) : [];", vers: "(thread.messages || []) : [];", label: 'sans la coupe, les vieux mails reviennent dans l historique', rouge: (r) => Array.isArray(r.filAvant) && r.filAvant.length !== 1 },
      { de: "  if (reste <= 0) return { tone: 'late',", vers: "  if (false) return { tone: 'late',", label: 'sans le retard, une echeance depassee ne se voit plus', rouge: (r) => Array.isArray(r.ordre) && !(r.puce802 && r.puce802.t === 'En retard') },
      { de: '  // Demandes sur mesure : le compte a rebours de la reponse promise.\n  tickStaffRequestDues();\n', vers: '', label: 'sans le tic de la minute, le compte a rebours reste fige', run: horlogeDuBureau, rouge: (r) => Boolean(r.dixMinutes && r.dixMinutes.puce && r.avant && r.avant.puce) && r.dixMinutes.puce.t === r.avant.puce.t },
      { de: "  if (board.getAttribute('data-due-tones') !== staffRequestDueToneKey()) { renderStaffUtilityPage(); return; }\n", vers: '', label: 'sans le repeint au changement de ton, le sous-titre ne compte pas le nouveau retard', run: horlogeDuBureau, rouge: (r) => Boolean(r.ficheEchue) && Boolean(r.ficheEchue.marque) },
      { de: "getStaffCustomRequestItems().filter(item => staffRequestStage(item) === 'a-traiter').sort(staffRequestCompare('atraiter'));", vers: "getStaffCustomRequestItems().filter(item => item.status === 'new' || item.status === 'in_progress');", label: 'sans le filtre de l etape, l alerte liste une demande qui attend le client', run: alerteDuTableau, rouge: (r) => Array.isArray(r.lignes) && r.lignes.some((l) => l.id === '803') },
      { de: "  const wanted = String(state.staffRequestSelectedId || '');\n  if (!wanted) return null;\n", vers: "  const wanted = String(state.staffRequestSelectedId || '');\n  if (!wanted) return getStaffRequestRows()[0] || null;\n", label: 'sans la liste d abord, une demande s ouvrirait toute seule', rouge: (r) => Boolean(r.panne) || r.ficheAuDepart !== 0 },
      { de: "  return staffRequestStage(item) === 'a-traiter' || Boolean(staffRequestAutre[key]) || Boolean(staffRequestChoix[key]);", vers: "  return true;", label: 'sans le rangement, Pinlane resterait ouvert apres l envoi', rouge: (r) => Boolean(r.envoi) && r.envoi.ia === true },
      { de: "    ...mails.map(message => ({ le: quandMail(message), mail: message })),\n", vers: "", label: 'sans les mails dans l historique, le client qui ecrit ne se verrait pas', rouge: (r) => Array.isArray(r.filAvant) && r.filAvant.length !== 1 },
      { de: "(SM_PHOTOS[String(centerId || '')] || [])", vers: "(SM_PHOTOS[String(centerId || '')] || SM_PHOTOS.libramont)", label: 'sans la garde, un autre client recevrait les photos de ce centre', rouge: (r) => typeof r.photoAilleurs === 'string' && r.photoAilleurs !== '' },
      { de: "async function openStaffRequestDay(iso) {\n  if (!staffRequestDateOf(iso)) return;\n", vers: "async function openStaffRequestDay(iso) {\n  if (!staffRequestDateOf(iso)) return;\n  state.currentDate = iso; openStaffPlanningResource('all'); return;\n", label: 'sans la fenetre, le planning du jour ferait quitter la demande', run: (b) => fenetres(b), rouge: (r) => Boolean(r.pagePlanning) && (r.pagePlanning.apres.page !== 'requests' || !r.planning) },
      { de: "function openStaffRequestClient(id) {\n", vers: "function openStaffRequestClient(id) {\n  state.staffClientQuery = String(id); openStaffMenuPage('clients'); return;\n", label: 'sans la fenetre, la fiche client ferait quitter la demande', run: (b) => fenetres(b), rouge: (r) => !r.client || !r.pageClient || r.pageClient.page !== 'requests' },
      { fichier: 'assets/pinlane-planning-global.js', de: "    if (GF_GROUPES[occasion]) sortie.push({ cle: 'groupe', mot: GF_GROUPES[occasion] });", vers: "", label: 'sans la marque, le team building ne se verrait pas au planning', run: (b) => fenetres(b), rouge: (r) => Boolean(r.planning) && !r.planning.marques.includes('Team building') },
      { de: "setStaffCustomRequestStatus(${jid}, 'archived', { suivre: true })", vers: "setStaffCustomRequestStatus(${jid}, 'handled', { suivre: true })", label: 'sans suite ne doit pas classer la demande en terminee', run: sansSuite, rouge: (r) => Boolean(r.apres) && JSON.stringify(r.apres.statuts) !== '["archived"]' },
      { de: "centerId: getActiveOpsCenterId(), proposition, confirme }),", vers: "centerId: getActiveOpsCenterId(), proposition, confirme: true }),", label: 'sans la carte, le premier clic creerait la reservation sans la relire', rouge: (r) => Boolean(r.panne) || (Boolean(r.carte) && r.carte.appels.some((a) => a.confirme === true)) },
      { de: "    ${extras ? `<p>${escapeHtml(extras)}</p>` : ''}\n", vers: '', label: 'sans la ligne des extras, la carte tairait le soft et le gateau', rouge: (r) => Boolean(r.carte) && !/Avec Soft/.test(r.carte.texte) },
      { de: "  if (texte && fin.rang === rang && fin.geste === 'reserver' && fin.proposition && peutGeste('reserver')) smReserver(id);\n", vers: '', label: 'sans le geste, « réserve » laisserait la carte fermee', run: unMotSuffit, rouge: (r) => Boolean(r.panne) || !r.carte },
      { de: "      body: JSON.stringify({ action: 'teachAgentFact',", vers: "      body: JSON.stringify({ action: 'oublierAgentFact',", label: 'sans l apprentissage, retenir ne retiendrait rien', run: unMotSuffit, rouge: (r) => Boolean(r.panne) || !(r.retenu && r.retenu.appel) },
    ];
    if (SANS_CONTRE_PREUVES) console.log(`GATE-SAUTE-PARTIE contre-epreuves : ${essais.length} coupures montables mais pas rejouees (la nuit, ou quand le diff touche ce gate)`);
    for (const e of essais) {
      if (!montable(e.de, e.fichier) || (e.aussi && !montable(e.aussi.de))) continue;
      if (SANS_CONTRE_PREUVES) continue;
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
