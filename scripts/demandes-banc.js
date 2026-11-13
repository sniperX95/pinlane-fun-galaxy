// LE BANC DES DEMANDES SUR MESURE (v5, 2026-11-13).
//
// La vraie console du depot, servie telle quelle (ou avec une coupure pour les contre-epreuves), et
// un faux serveur qui tient le contrat de la v5 : la file des demandes, leurs mails, le client connu,
// customRequestBook (simulation puis creation), sendDirectEmail, customRequestStatus, customRequestNote,
// teachAgentFact, customRequestDraft, et POST /api/assistant en mode demande, en flux (lectures, texte,
// cartes reservation_demande et mail_demande, fin avec la demande enregistree). L etat vit dans ce
// processus : une page rechargee retrouve ce qui a ete prepare, envoye ou reserve.
//
// Aucune base, aucun envoi, aucun appel sortant : le banc refuse de demarrer si une cle de base ou
// d envoi est dans l environnement.
//
// Le gate scripts/demandes-console-check.js et les images de la page passent par ici.
// Seul : node scripts/demandes-banc.js [--port=4433] [--flux=<fichier .sse enregistre>]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CENTRE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/planning-v3/centre-libramont.json'), 'utf8'));
const JOUR_TYPE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/planning-v3/jour-normal.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const SECRETS = ['DATABASE_URL', 'POSTGRES_URL', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_JETON', 'TELEGRAM_CHAT', 'TELEGRAM_GROUPE'];

const H = 3600000;
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const hm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const iso = (ms) => new Date(ms).toISOString();
const copie = (x) => JSON.parse(JSON.stringify(x));
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const enLettres = (jour) => { const d = new Date(`${jour}T12:00:00`); return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`; };
const minutes = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const heure = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const euros = (v) => `${new Intl.NumberFormat('fr-BE', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v)} €`;

// LES DATES DU BANC : la demande vise toujours un dimanche (le centre y ouvre a 10:00), a vingt jours ou
// plus, pris a midi pour qu un changement d heure ne decale pas le jour ; l autre date deux jours avant.
function datesDuBanc(now) {
  const dimanche = new Date(now + 20 * 24 * H);
  dimanche.setHours(12, 0, 0, 0);
  dimanche.setDate(dimanche.getDate() + ((7 - dimanche.getDay()) % 7));
  return { D1: ymd(dimanche.getTime()), D2: ymd(dimanche.getTime() - 2 * 24 * H) };
}

// == LES DONNEES ==
function donnees(now) {
  const { D1, D2 } = datesDuBanc(now);
  const echeance = (ms) => ({ date: ymd(now + ms), heure: hm(now + ms), instant: iso(now + ms) });
  const suivi = (etape, sur = {}) => ({ etape, priseEnCharge: null, reponses: 0, derniereReponse: null, messageClient: null, reservationId: null, notes: [], historique: [], consignes: [], pinlane: null, ...sur });
  const demande = (sur = {}) => ({
    version: 1, groupType: 'ecole', groupTypeLabel: 'École, jeunesse', organisation: 'Athénée de Libramont', participants: 31, companions: 3, ages: ['7-12'],
    flexible: false, date: D1, alternativeDate: D2, period: '', moment: 'apres-midi', momentLabel: 'Après-midi',
    formulas: [], activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }, { id: 'minigolf_blacklight', name: 'Minigolf Blacklight' }],
    advice: false, budgetPerPerson: 25, contactRole: 'Enseignant', invoice: true, vatNumber: 'BE0123456789', ...sur,
  });
  const prise = { type: 'prise-en-charge', le: iso(now - 20 * H), par: 'Rachel' };
  const reponse = (le, sur = {}) => ({ type: 'reponse', le, par: 'Rachel', objet: 'Votre venue chez Fun Galaxy Libramont', source: 'ia', ...sur });
  const leads = [
    { id: 801, centerId: 'libramont', contactName: 'Ansar Bisultanov', company: 'Athénée de Libramont', email: 'ansar@example.org', phone: '+32 470 11 22 33', requestedDate: 'demande de 31 joueurs', pax: 31, occasion: 'ecole', message: 'Nous aimerions pique-niquer sur place à midi, avant les activités. Deux enseignants et un parent accompagnent les élèves.', status: 'new', createdAt: iso(now - 3 * H), updatedAt: iso(now - 3 * H), payload: { demande: demande() }, echeance: echeance(2 * H), suivi: suivi('a-traiter') },
    { id: 802, centerId: 'libramont', contactName: 'Claire Dumont', company: 'Pharma SA', email: 'claire@example.org', phone: '+32 471 00 00 02', requestedDate: '', pax: 45, occasion: 'entreprise', message: 'Soirée d’équipe après le séminaire, plutôt vers 19:00.', status: 'in_progress', createdAt: iso(now - 30 * H), updatedAt: iso(now - 20 * H), payload: { demande: demande({ groupType: 'entreprise', groupTypeLabel: 'Entreprise, team building', organisation: 'Pharma SA', participants: 45, companions: 0, ages: ['adultes'], moment: 'soiree', momentLabel: 'Soirée', activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }], budgetPerPerson: 0, contactRole: 'Office manager' }) }, echeance: echeance(-1 * H), suivi: suivi('a-traiter', { priseEnCharge: prise, historique: [prise] }) },
    { id: 803, centerId: 'libramont', contactName: 'Marc Lambert', company: '', email: 'marc@example.org', phone: '', requestedDate: '', pax: 24, occasion: 'anniversaire', message: '', status: 'in_progress', createdAt: iso(now - 50 * H), updatedAt: iso(now - 20 * H), payload: { demande: demande({ groupType: 'amis', groupTypeLabel: 'Amis, famille', organisation: '', participants: 24, companions: 0, invoice: false, vatNumber: '', contactRole: '', activities: [{ id: 'bowling', name: 'Bowling' }, { id: 'laser_game', name: 'Laser Game' }] }) }, echeance: null, suivi: suivi('en-attente', { priseEnCharge: prise, reponses: 1, historique: [prise] }) },
    { id: 804, centerId: 'libramont', contactName: 'Sophie Martin', company: 'Scouts de Libramont', email: 'sophie@example.org', phone: '+32 472 00 00 04', requestedDate: '', pax: 36, occasion: 'ecole', message: '', status: 'in_progress', createdAt: iso(now - 60 * H), updatedAt: iso(now - 1 * H), payload: { demande: demande({ organisation: 'Scouts de Libramont', participants: 36, groupTypeLabel: 'Mouvement de jeunesse', contactRole: 'Cheftaine', activities: [{ id: 'laser_game', name: 'Laser Game' }, { id: 'arcade_time', name: 'Arcades' }] }) }, echeance: echeance(23 * H), suivi: suivi('a-traiter', { priseEnCharge: prise, reponses: 1, messageClient: iso(now - 1 * H), historique: [prise] }) },
    { id: 805, centerId: 'libramont', contactName: 'Julien Petit', company: 'Club de foot', email: 'julien@example.org', phone: '', requestedDate: '', pax: 32, occasion: 'groupe', message: '', status: 'handled', createdAt: iso(now - 90 * H), updatedAt: iso(now - 40 * H), payload: { demande: demande({ organisation: 'Club de foot', participants: 32, groupTypeLabel: 'Club, association' }) }, echeance: null, suivi: suivi('traitee', { reservationId: 912, historique: [prise, { type: 'reservation', le: iso(now - 40 * H), par: 'Rachel', reservationId: 912, date: D1 }, { type: 'statut', le: iso(now - 40 * H), par: 'Rachel', statut: 'handled' }] }) },
    { id: 806, centerId: 'libramont', contactName: 'Comité des fêtes', company: '', email: 'comite@example.org', phone: '', requestedDate: '', pax: 40, occasion: 'groupe', message: '', status: 'archived', createdAt: iso(now - 200 * H), updatedAt: iso(now - 150 * H), payload: { demande: demande({ organisation: 'Comité des fêtes', participants: 40, groupTypeLabel: 'Club, association' }) }, echeance: null, suivi: suivi('archivee', { historique: [{ type: 'statut', le: iso(now - 150 * H), par: 'Rachel', statut: 'archived' }] }) },
    { id: 807, centerId: 'libramont', contactName: 'Ecole Saint-Roch', company: '', email: 'roch@example.org', phone: '+32 473 00 00 07', requestedDate: '5 novembre', pax: 42, occasion: 'ecole', message: 'Sortie de fin de trimestre pour deux classes.', status: 'new', createdAt: iso(now - 5 * H), updatedAt: iso(now - 5 * H), payload: {}, echeance: null, suivi: suivi('a-traiter') },
  ];
  // La demande de Pharma SA a deja sa preparation (un collegue l a ouverte ce matin) ; celle des
  // scouts aussi, mais le client a ecrit depuis : elle est perimee.
  const L = (id) => leads.find((l) => l.id === id);
  poserPreparation(L(802), { heure: '19:00', le: iso(now - 4 * H), par: 'Rachel' });
  poserPreparation(L(804), { heure: '14:00', le: iso(now - 26 * H), par: 'Rachel' });
  L(804).suivi.pinlane = { ...L(804).suivi.pinlane, perimee: true, perimeePourquoi: 'mail-du-client' };
  // La proposition partie chez Marc Lambert : la reservation de Pinlane, gardee dans le suivi avec la
  // preparation qui l a donnee.
  const partie = poserPreparation(L(803), { heure: '14:00', le: iso(now - 21 * H), par: 'Rachel' }).reservation;
  const r803 = reponse(iso(now - 20 * H), { objet: `Votre après-midi du ${enLettres(D1)} chez Fun Galaxy Libramont`, proposition: partie.action.reservation });
  L(803).suivi = { ...L(803).suivi, derniereReponse: r803, proposition: partie.action.reservation, historique: [prise, r803] };
  L(804).suivi.derniereReponse = reponse(iso(now - 26 * H));
  L(804).suivi.historique.push(L(804).suivi.derniereReponse);

  const comms = [
    { id: 71, direction: 'outbound', recipient: 'ansar@example.org', subject: 'Votre réservation est confirmée', body: 'Bonjour Ansar, votre réservation du mois dernier est confirmée.', status: 'sent', createdAt: iso(now - 40 * 24 * H), sentAt: iso(now - 40 * 24 * H), payload: {} },
    { id: 72, direction: 'outbound', recipient: 'ansar@example.org', subject: 'Rappel, votre venue demain', body: 'Petit rappel de votre venue de demain.', status: 'sent', createdAt: iso(now - 39 * 24 * H), sentAt: iso(now - 39 * 24 * H), payload: {} },
    { id: 73, direction: 'inbound', recipient: 'ansar@example.org', subject: 'Question pique-nique', body: 'Bonjour, pouvons-nous apporter nos sandwichs pour le midi ? Merci, Ansar', status: 'received', createdAt: iso(now - 3 * H + 5 * 60000), sentAt: iso(now - 3 * H + 5 * 60000), payload: {} },
    { id: 74, direction: 'outbound', recipient: 'marc@example.org', subject: r803.objet, body: 'Bonjour Marc,\n\nVoici la proposition pour l’anniversaire.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont', status: 'sent', createdAt: r803.le, sentAt: r803.le, payload: {} },
    { id: 75, direction: 'outbound', recipient: 'sophie@example.org', subject: 'Votre venue chez Fun Galaxy Libramont', body: 'Bonjour Sophie,\n\nVoici notre proposition pour les scouts.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont', status: 'sent', createdAt: iso(now - 26 * H), sentAt: iso(now - 26 * H), payload: {} },
    { id: 76, direction: 'inbound', recipient: 'sophie@example.org', subject: 'Re: Votre venue chez Fun Galaxy Libramont', body: 'Bonjour, merci ! Est-ce possible plutôt à 15:00 ? Nous serons 36.\n\nLe jeu. 12 nov. a écrit :\n> Voici notre proposition pour les scouts.', status: 'received', createdAt: iso(now - 1 * H), sentAt: iso(now - 1 * H), payload: {} },
  ];
  // Le planning du dimanche : une journee type du centre, ramenee a ce jour, sans le mot « demo » ; son
  // groupe d entreprise y vient en team building.
  const resasDuJour = JOUR_TYPE.staffState.reservations.map((r) => ({
    ...copie(r), date: D1, name: String(r.name || '').replace(/^D[ÉE]MO · /, ''), notes: '', occasion: r.occasion === 'entreprise' ? 'teambuilding' : r.occasion,
  }));
  return { D1, D2, leads, comms, resasDuJour };
}

// LE CLIENT CONNU (customRequestStudy) : trois venues, une absence.
function clientDe(lead, now) {
  if (!lead || lead.email !== 'ansar@example.org') return null;
  return {
    clientName: 'Ansar', visits: 3, lastVisit: ymd(now - 40 * 24 * H), reservationsAVenir: 0, prochaineReservation: null, depense: 1240, absences: 1,
    venues: [{ date: ymd(now - 40 * 24 * H), heure: '14:00', pax: 28, label: 'Formule 2', prix: 540 }, { date: ymd(now - 150 * 24 * H), heure: '10:00', pax: 22, label: 'Bowling et Laser Game', prix: 420 }, { date: ymd(now - 300 * 24 * H), heure: '16:00', pax: 16, label: 'Formule 1', prix: 280 }],
  };
}

// == LES CARTES DE PINLANE ==
// La reservation : bowling une heure sur six pistes, puis le laser en deux groupes (et les arcades pour
// les scouts). Le prix du moteur : 24 € par joueur, 744 € pour 31.
function carteReservation(lead, { heure: depart = '14:00', prix = null, soft = false } = {}) {
  const d = lead.payload.demande;
  const joueurs = Number(d.participants) || Number(lead.pax) || 0;
  const date = d.date;
  const t = minutes(depart);
  const veut = (id) => (d.activities || []).some((a) => a.id === id);
  const programme = [];
  const lignes = [];
  let fin = t;
  if (veut('bowling')) {
    const pistes = Math.min(8, Math.ceil(joueurs / 6));
    programme.push({ activityId: 'bowling', participants: joueurs, duration: 1 });
    lignes.push({ activite: 'bowling', nom: 'Bowling', debut: heure(fin), fin: heure(fin + 60), detail: `1 h, ${joueurs} joueurs, pistes ${Array.from({ length: pistes }, (_, i) => i + 3 - (pistes > 6 ? 2 : 0)).join(', ')}` });
    fin += 60;
  }
  if (veut('laser_game')) {
    const a = Math.ceil(joueurs / 2);
    programme.push({ activityId: 'laser_game', participants: joueurs, games: 1, groupes: [a, joueurs - a] });
    lignes.push({ activite: 'laser_game', nom: 'Laser Game', debut: heure(fin), fin: heure(fin + 40), detail: `1 partie, ${joueurs} joueurs en 2 groupes (${a} puis ${joueurs - a})` });
    fin += 40;
  }
  if (veut('arcade_time')) {
    programme.push({ activityId: 'arcade_time', participants: joueurs });
    lignes.push({ activite: 'arcade_time', nom: 'Arcades', debut: heure(fin), fin: heure(fin + 30), detail: `${joueurs} joueurs, 30 min` });
    fin += 30;
  }
  const prixMoteur = joueurs * 24 + (soft ? joueurs * 2.5 : 0);
  const negocie = prix != null && prix !== prixMoteur;
  const total = prix != null ? prix : prixMoteur;
  const quand = enLettres(date);
  const supplements = soft ? [{ nom: 'Soft', qte: joueurs, parPersonne: true }] : [];
  const resume = {
    quand, date, heure: depart, joueurs, disponible: true, debut: depart, fin: heure(fin), lignes, supplements, prix: total,
    ...(negocie ? { prixNegocie: true, prixRaison: 'Prix de groupe accordé par l’équipe', prixHabituel: prixMoteur } : {}),
    refus: '', conflits: [], nom: lead.contactName, telephone: lead.phone, email: lead.email,
  };
  return {
    type: 'geste', geste: 'reservation_demande', centre: 'libramont', demande: lead.id,
    texte: `Réservation du ${quand} à ${depart} pour ${joueurs} joueurs, ${lignes.map((l) => `${l.nom} (${l.detail})`).join(', ')}.`,
    resume,
    action: { action: 'customRequestBook', id: lead.id, reservation: { date, startTime: depart, pax: joueurs, programme, supplements: soft ? [{ article: 'soft', par_personne: true }] : [], prix: negocie ? total : null, raisonPrix: negocie ? 'Prix de groupe accordé par l’équipe' : '', note: '' } },
  };
}

function carteMail(lead, resa) {
  const r = resa.resume;
  const prenom = String(lead.contactName || '').split(/\s+/)[0] || '';
  const d = lead.payload.demande;
  const qui = d.groupType === 'ecole' ? `${r.joueurs} élèves` : `${r.joueurs} personnes`;
  const parPersonne = Math.round((r.prix / r.joueurs) * 100) / 100;
  const objet = `Votre ${d.moment === 'soiree' ? 'soirée' : 'après-midi'} du ${r.quand} chez Fun Galaxy Libramont`;
  const programme = r.lignes.map((l) => `- ${l.nom} de ${l.debut} à ${l.fin}`).join('\n');
  const midi = /pique-niquer/.test(lead.message || '') ? '\n\nPour le pique-nique de midi, la salle du rez-de-chaussée vous est ouverte dès 12:00.' : '';
  const corps = `Bonjour ${prenom},\n\nMerci pour votre demande pour ${qui}. Voici ce que l’équipe vous propose le ${r.quand}, à partir de ${r.heure}.\n\n${programme}\n\nLe prix est de ${euros(r.prix)} pour le groupe, soit ${euros(parPersonne)} par personne${r.supplements.length ? ', soft compris' : ''}.${midi}\n\nDites-nous si cela vous convient, la place reste réservée pour vous le temps de votre réponse.\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont`;
  const points = Number(d.companions) > 0 ? [`${d.companions} accompagnateurs ne sont pas comptés dans le prix. Précisez au client si le centre leur facture quelque chose.`] : [];
  return {
    type: 'geste', geste: 'mail_demande', centre: 'libramont', demande: lead.id, source: 'ia',
    texte: `Envoyer la proposition à ${lead.contactName} <${lead.email}>.`,
    resume: { a: `${lead.contactName} <${lead.email}>`, objet, corps, points },
    action: { action: 'sendDirectEmail', customRequestId: lead.id, to: lead.email, name: lead.contactName, subject: objet, body: corps, category: 'direct', templateRef: 'demande-sur-mesure', draftSource: 'ia', draftOriginal: { subject: objet, body: corps }, proposition: resa.action.reservation },
  };
}

const garder = (c) => (c ? { resume: c.resume, action: c.action, ...(c.source ? { source: c.source } : {}) } : null);
const SUGGESTIONS = ['Plutôt à 15:00', 'Ajouter un soft par enfant', 'Le laser en deux groupes de 16 et 15'];

function poserPreparation(lead, { heure: depart, le, par, consigne = '', prix = null, soft = false, texte = '' }) {
  const reservation = carteReservation(lead, { heure: depart, prix, soft });
  const mail = carteMail(lead, reservation);
  lead.suivi.pinlane = {
    le, par, consigne, texte: texte || `J’ai préparé la réservation du ${reservation.resume.quand} à ${depart} et le mail de proposition.`,
    reservation: garder(reservation), mail: garder(mail), geste: null, suggestions: SUGGESTIONS, perimee: false,
  };
  return { reservation, mail };
}

// L etape d une demande, recalculee comme le serveur (lib/demande-bureau) apres chaque geste.
function etapeDe(lead) {
  if (lead.status === 'archived') return 'archivee';
  if (lead.status === 'handled') return 'traitee';
  return lead.suivi.reponses && !lead.suivi.messageClient ? 'en-attente' : 'a-traiter';
}

// == LE FLUX DE PINLANE (POST /api/assistant, mode demande) ==
// Ce que la consigne change : « 15 » deplace a 15:00, « 20 € » pose un prix de groupe, « soft » ajoute un
// soft par joueur ; « laisse tomber » propose de classer sans suite, « note que… » une note ; « toujours… »
// propose une regle a retenir.
function fluxDemande(lead, consigne, { mode = 'ok', maintenant = Date.now(), qui = 'Rachel' } = {}) {
  const c = String(consigne || '');
  const d = lead.payload && lead.payload.demande;
  const ev = [];
  const etape = (id, phrase, fini) => { ev.push(['etape', { id, etat: 'cours', cleSource: 'demande', nomSource: 'La demande', phrase, libelle: phrase, unite: 'lignes' }]); ev.push(['lecture', { id, lues: 0, total: 0 }]); ev.push(['etape', { id, etat: 'fini', ...fini }]); };
  ev.push(['debut', { modele: 'Sonnet', centres: [{ id: 'libramont', nom: 'Fun Galaxy Libramont' }], sources: [] }]);
  etape('lire', 'Je lis la demande et ses mails', { trouve: `${d ? d.participants : lead.pax} joueurs, ${d ? enLettres(d.date) : 'sans date'}` });
  etape('planning', `Je lis le planning du ${d ? enLettres(d.date) : 'jour demandé'}`, { trouve: '12 groupes déjà là, 2 pistes et l’arène libres à 14:00', lues: 12 });
  if (mode === 'rien') {
    ev.push(['texte', { delta: `Le ${enLettres(d.date)}, le planning est complet l’après-midi pour ${d.participants} joueurs. ` }]);
    ev.push(['texte', { delta: 'Dites-moi une autre date ou un autre moment.' }]);
    return { evenements: ev, fin: { texte: `Le ${enLettres(d.date)}, le planning est complet l’après-midi pour ${d.participants} joueurs. Dites-moi une autre date ou un autre moment.` }, preparation: null };
  }
  if (mode === 'erreur') return { evenements: [...ev, ['erreur', { message: 'L’assistant a été interrompu. Réessayez.' }]], fin: null, preparation: null };
  const avant = lead.suivi.pinlane;
  // Les gestes : rien de la reservation ni du mail ne change.
  if (/laisse tomber/i.test(c) || /^note /i.test(c)) {
    const note = /^note /i.test(c) ? c.replace(/^note (que |qu’|qu')?/i, '').replace(/^\w/, (x) => x.toUpperCase()).replace(/\.?$/, '.') : '';
    const geste = note
      ? { type: 'geste', geste: 'note_demande', centre: 'libramont', demande: lead.id, texte: `Noter dans le suivi « ${note} ».`, resume: { texte: note }, action: { action: 'customRequestNote', id: lead.id, texte: note } }
      : { type: 'geste', geste: 'sans_suite_demande', centre: 'libramont', demande: lead.id, texte: 'Classer la demande sans suite.', resume: { pourquoi: 'consigne' }, action: { action: 'customRequestStatus', id: lead.id, status: 'archived' } };
    etape('geste', 'Je prépare le geste à valider', { trouve: 'À valider sous la réponse' });
    ev.push(['proposition', geste]);
    const texte = note ? 'La note est prête, elle s’ajoute au suivi à votre clic.' : 'Le classement sans suite attend votre clic.';
    ev.push(['texte', { delta: texte }]);
    return { evenements: ev, fin: { texte }, preparation: avant ? { ...avant, geste: { resume: geste.resume, action: geste.action }, le: iso(maintenant), consigne: c } : null, consigne: c, texte };
  }
  const depart = /15/.test(c) ? '15:00' : (lead.id === 802 ? '19:00' : '14:00');
  const prix = /20 ?€/.test(c) ? 20 * (Number(d.participants) || 0) : null;
  const soft = /soft/i.test(c);
  const reservation = carteReservation(lead, { heure: depart, prix, soft });
  etape('resa', 'Je prépare la réservation', { trouve: 'À valider sous la réponse' });
  ev.push(['proposition', reservation]);
  const mail = carteMail(lead, reservation);
  etape('mail', 'J’écris le mail de proposition', { trouve: 'À valider sous la réponse' });
  ev.push(['proposition', mail]);
  if (/toujours un soft/i.test(c)) ev.push(['proposition', { texte: 'Toujours un soft par enfant aux anniversaires.' }]);
  const texte = c
    ? `J’ai refait la réservation${depart !== '14:00' ? ` à ${depart}` : ''}${prix ? ` pour ${euros(prix)}` : ''}${soft ? ' avec un soft par joueur' : ''} et le mail qui la propose.`
    : `J’ai préparé la réservation du ${reservation.resume.quand} à ${depart} et le mail de proposition.`;
  for (const morceau of texte.match(/.{1,24}(\s|$)/g)) ev.push(['texte', { delta: morceau }]);
  return {
    evenements: ev,
    fin: { texte },
    consigne: c,
    texte,
    preparation: { le: iso(maintenant), par: qui, consigne: c, texte, reservation: garder(reservation), mail: garder(mail), geste: null, suggestions: SUGGESTIONS, perimee: false },
  };
}

// Un flux enregistre (le vrai serveur, Projects/pinlane/assets/sur-mesure-2026-11-13/flux/) : ses blocs tels
// quels ; sa demande de fin est ramenee a la demande ouverte du banc.
function fluxEnregistre(fichier, lead) {
  const brut = fs.readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');
  const evenements = brut.split('\n\n').map((bloc) => {
    const type = (/^event: (.+)$/m.exec(bloc) || [])[1];
    const data = (/^data: (.+)$/m.exec(bloc) || [])[1];
    if (!type || !data) return null;
    try { return [type.trim(), JSON.parse(data)]; } catch (e) { return null; }
  }).filter(Boolean);
  const fin = evenements.find(([t]) => t === 'fin');
  const p = fin && fin[1].demande && fin[1].demande.suivi ? fin[1].demande.suivi.pinlane : null;
  return { evenements: evenements.filter(([t]) => t !== 'fin'), fin: fin ? { ...fin[1], demande: undefined } : { texte: '' }, preparation: p || null, consigne: '', texte: fin ? fin[1].texte : '', lead };
}

// == LE SERVEUR ==
function creerBanc({ port = 0, root = ROOT, mutation = () => null, now = Date.now() } = {}) {
  const presents = SECRETS.filter((k) => process.env[k]);
  if (presents.length) throw new Error(`banc : retirez ${presents.join(', ')} de l environnement avant de lancer le banc`);
  const base = donnees(now);
  const etat = {
    ...base,
    role: 'direction',
    // mode : ok, panne (503), limite (429), rien (aucune carte), erreur (le flux s interrompt) ;
    // pas : ms entre deux evenements ; lent : ms de plus avant la fin du premier appel ; arret : nombre
    // d evenements apres lequel le flux attend relacher() ; flux : un fichier enregistre a rejouer.
    assistant: { mode: 'ok', pas: 40, lent: 0, arret: null, flux: '' },
    appels: [],
    envois: [],
    assistantAppels: [],
    ouvertures: [],
    creees: [],
    attente: null,
  };
  const lead = (id) => etat.leads.find((l) => String(l.id) === String(id));
  const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.edit', 'reservations.quick', 'reservations.create', 'clients.view', 'clients.edit', 'emails.view', 'emails.send', 'direction.view', 'settings.manage', 'payments.view'];
  const session = () => {
    const expiresAt = iso(Date.now() + 24 * H);
    if (etat.role === 'accueil') {
      const p = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.edit', 'reservations.quick', 'reservations.create', 'clients.view'];
      return { token: 'banc', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'banc-accueil', name: 'Léa', roleId: 'accueil' }, role: { id: 'accueil', name: 'Accueil', locked: false }, permissions: p };
    }
    return { token: 'banc', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'banc', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
  };
  const json = (res, corps, statut = 200) => { res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(corps)); };
  const lireCorps = (req) => new Promise((resolve) => { let b = ''; req.on('data', (x) => { b += x; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } }); });
  const sortie = (l) => { const c = copie(l); c.suivi.etape = etapeDe(l); return c; };
  const qui = () => session().member.name;

  async function ops(req, res, u) {
    const methode = req.method.toUpperCase();
    if (methode === 'GET') {
      const action = u.searchParams.get('action') || '';
      etat.appels.push({ m: 'GET', chemin: '/api/ops', action, id: u.searchParams.get('id') || '', t: Date.now() });
      if (action === 'customRequests') return json(res, { ok: true, centerId: 'libramont', customRequests: etat.leads.map(sortie) });
      if (action === 'customRequestStudy') return json(res, { ok: true, id: Number(u.searchParams.get('id')), etude: null, client: clientDe(lead(u.searchParams.get('id')), now) });
      if (action === 'communications') {
        const qui2 = (u.searchParams.get('recipient') || '').toLowerCase();
        return json(res, { ok: true, communications: etat.comms.filter((c) => c.recipient.toLowerCase() === qui2) });
      }
      if (action === 'centerConfig') return json(res, { ok: true, centers: [CENTRE.center], activities: [] });
      return json(res, { ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
    }
    const corps = await lireCorps(req);
    etat.appels.push({ m: 'POST', chemin: '/api/ops', action: corps.action, corps, t: Date.now() });
    const l = lead(corps.id || corps.customRequestId);
    const le = iso(Date.now());
    if (corps.action === 'sendDirectEmail') {
      etat.envois.push(corps);
      const id = 5000 + etat.envois.length;
      etat.comms.push({ id, direction: 'outbound', recipient: corps.to, subject: corps.subject, body: corps.body, status: 'queued', createdAt: le, sentAt: null, payload: { textBody: corps.body } });
      if (l) {
        const r = { type: 'reponse', le, par: qui(), objet: corps.subject, communicationId: id, ...(corps.draftSource ? { source: corps.draftSource } : {}), ...(corps.proposition ? { proposition: corps.proposition } : {}) };
        l.suivi = { ...l.suivi, reponses: l.suivi.reponses + 1, derniereReponse: r, proposition: corps.proposition || l.suivi.proposition || null, messageClient: null, historique: [...l.suivi.historique, r] };
        l.echeance = null;
      }
      return json(res, { ok: true, communication: { id, status: 'queued' }, ...(l ? { customRequest: sortie(l) } : {}) });
    }
    if (corps.action === 'customRequestStatus' && l) {
      l.status = corps.status;
      const e = corps.status === 'in_progress' ? { type: 'prise-en-charge', le, par: qui() } : { type: 'statut', le, par: qui(), statut: corps.status };
      l.suivi = { ...l.suivi, historique: [...l.suivi.historique, e], ...(corps.status === 'in_progress' ? { priseEnCharge: e } : {}) };
      return json(res, { ok: true, action: corps.action, customRequest: sortie(l) });
    }
    if (corps.action === 'customRequestNote' && l) {
      l.suivi = { ...l.suivi, notes: [...l.suivi.notes, { type: 'note', le, par: qui(), texte: corps.texte }] };
      return json(res, { ok: true, action: corps.action, customRequest: sortie(l) });
    }
    // Le mail du code (sans IA) : le modele du centre, rempli avec le jour de la demande.
    if (corps.action === 'customRequestDraft' && l) {
      const d = l.payload && l.payload.demande;
      const jour = d && !d.flexible ? ` Le ${enLettres(d.date)}, l’équipe peut vous accueillir à 14:00 pour ${d.participants} joueurs.` : '';
      return json(res, { ok: true, id: l.id, etude: null, brouillon: { source: 'code', raison: 'ia-absente', objet: 'Votre demande chez Fun Galaxy Libramont', corps: `Bonjour,\n\nMerci pour votre demande.${jour}\n\nBien à vous,\nL’équipe de Fun Galaxy Libramont`, pointsAVerifier: [] } });
    }
    if (corps.action === 'teachAgentFact') return json(res, { ok: true, fait: { id: 31, question: corps.question, reponse: corps.reponse } });
    if (corps.action === 'ouvertureExceptionnelle') {
      const autres = etat.ouvertures.filter((o) => o.date !== corps.date);
      const ligne = corps.retirer ? null : { date: corps.date, open: corps.open, close: corps.close, motif: corps.motif || '' };
      etat.ouvertures = ligne ? [...autres, ligne] : autres;
      return json(res, { ok: true, action: corps.action, centerId: 'libramont', ouverture: ligne, ouvertures: etat.ouvertures });
    }
    // RESERVER : d abord ce que la reservation donnerait, la creation au seul clic confirme.
    if (corps.action === 'customRequestBook' && l) {
      const forme = corps.reservation && typeof corps.reservation === 'object' ? corps.reservation : null;
      const ancienne = !forme && corps.proposition && typeof corps.proposition === 'object' ? corps.proposition : null;
      if (!forme && !ancienne) return json(res, { ok: false, message: 'Rien à réserver.' }, 400);
      const carte = forme
        ? carteReservation(l, { heure: forme.startTime, prix: forme.prix != null ? Number(forme.prix) : null, soft: (forme.supplements || []).length > 0 })
        : { resume: { date: ancienne.date, heure: ancienne.heure, fin: ancienne.fin || '', joueurs: ancienne.joueurs, prix: ancienne.prix, lignes: [], nom: ancienne.nom, pistes: [3, 4], conflits: [], refus: '', disponible: true } };
      const resume = { ...carte.resume, email: l.email || '', quand: enLettres((forme || ancienne).date) };
      if (corps.confirme !== true) return json(res, { ok: true, id: l.id, simulation: true, resume });
      const id = 9001 + etat.creees.length;
      const modele = etat.resasDuJour[0];
      const resa = { ...copie(modele), id, name: l.contactName, email: l.email, phone: l.phone, date: resume.date, startTime: resume.heure, pax: resume.joueurs, price: resume.prix, basePrice: resume.prix, status: 'confirmed', type: 'visite', label: 'Demande sur mesure', occasion: l.occasion, notes: 'Demande sur mesure', channel: 'staff' };
      etat.creees.push(resa);
      if (resume.date === base.D1) etat.resasDuJour.push(resa);
      l.status = 'handled';
      l.suivi = { ...l.suivi, reservationId: id, historique: [...l.suivi.historique, { type: 'statut', le, par: qui(), statut: 'handled' }, { type: 'reservation', le, par: qui(), reservationId: id, date: resume.date }] };
      return json(res, { ok: true, id: l.id, simulation: false, resume, reservation: { id, date: resume.date, startTime: resume.heure, pax: resume.joueurs, price: resume.prix, email: l.email || '' }, confirmation: Boolean(l.email), demande: sortie(l) });
    }
    return json(res, { ok: true });
  }

  // POST /api/assistant : le mode demande seulement.
  async function assistant(req, res) {
    if (req.method !== 'POST') return json(res, { ok: true });
    const corps = await lireCorps(req);
    const l = lead(corps.demandeId);
    const consigne = Array.isArray(corps.messages) && corps.messages.length ? String(corps.messages[corps.messages.length - 1].content || '') : '';
    const rang = etat.assistantAppels.length + 1;
    etat.assistantAppels.push({ ...corps, consigne, t: Date.now() });
    const a = etat.assistant;
    if (!l || corps.demandeId == null) return json(res, { ok: false, message: 'Demande introuvable.' }, 404);
    if (session().role.id === 'accueil') return json(res, { ok: false, message: 'Accès refusé.' }, 403);
    if (a.mode === 'panne') return json(res, { ok: false, message: 'L\'assistant n\'est pas encore branché.' }, 503);
    if (a.mode === 'limite') return json(res, { ok: false, message: 'Le plafond mensuel de l\'assistant est atteint.' }, 429);
    const plan = a.flux ? fluxEnregistre(a.flux, l) : fluxDemande(l, consigne, { mode: a.mode, qui: qui() });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' });
    let coupe = false;
    res.on('close', () => { if (!res.writableEnded) coupe = true; });
    const ecrire = (type, d) => { if (!coupe && !res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(d)}\n\n`); };
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    let n = 0;
    for (const [type, d] of plan.evenements) {
      if (coupe) return;
      ecrire(type, d);
      n += 1;
      if (a.arret != null && n === a.arret) await new Promise((r) => { etat.attente = r; });
      // eslint-disable-next-line no-await-in-loop
      await pause(a.pas);
      if (type === 'erreur') { res.end(); return; }
    }
    if (a.lent && rang === 1) await pause(a.lent);
    if (coupe || !plan.fin) { if (!res.writableEnded) res.end(); return; }
    // LA PREPARATION S ENREGISTRE SUR LA DEMANDE : la consigne et son resultat, dans le suivi.
    if (plan.preparation) {
      l.suivi.pinlane = plan.preparation;
      l.status = l.status === 'new' && plan.consigne ? 'in_progress' : l.status;
    }
    if (plan.consigne) {
      const e = { type: 'pinlane', le: iso(Date.now()), par: qui(), consigne: plan.consigne, texte: plan.texte };
      l.suivi.historique = [...l.suivi.historique, e];
      l.suivi.consignes = [...(l.suivi.consignes || []), { le: e.le, par: e.par, texte: plan.consigne, resultat: plan.texte }];
    }
    ecrire('fin', { ...plan.fin, verite: null, identites: {}, modele: 'Sonnet', demande: plan.preparation || plan.consigne ? sortie(l) : null, preparationEnregistree: Boolean(plan.preparation) });
    res.end();
  }

  function fichier(req, res, u) {
    let f = path.join(root, decodeURIComponent(u.pathname));
    if (u.pathname === '/') f = path.join(root, 'index.html');
    if (!path.resolve(f).startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (e, c) => {
      if (e) { res.writeHead(404); res.end(); return; }
      let corps = c;
      const m = mutation();
      if (m && path.resolve(f) === path.join(root, m.fichier || 'assets/app-main.js')) {
        corps = Buffer.from(c.toString('utf8').replace(/\r\n/g, '\n').split(m.de).join(m.vers), 'utf8');
      }
      // La session du personnel, posee avant tout script de la page.
      if (u.pathname === '/') {
        const pose = `<script>try{localStorage.setItem('funGalaxy_auth_v1',${JSON.stringify(JSON.stringify(session()))});}catch(e){}</script>`;
        corps = Buffer.from(c.toString('utf8').replace(/<head>/i, (x) => `${x}${pose}`), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  }

  const serveur = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://banc');
    try {
      if (u.pathname === '/api/staff-auth') return json(res, { ok: true, authenticated: true, session: session(), accessControl: { selectedRoleId: session().role.id, selectedMemberId: session().member.id, roles: [{ id: session().role.id, name: session().role.name, code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: iso(now), locked: session().role.locked, permissions: session().permissions }], members: [], events: [], permissions: session().permissions } });
      if (u.pathname === '/api/staff-state') {
        const jour = u.searchParams.get('date') || base.D1;
        if (Number(u.searchParams.get('days')) > 0) return json(res, { ok: true, centerId: 'libramont', endDate: jour, days: [] });
        const resas = jour === base.D1 ? etat.resasDuJour : [];
        return json(res, { ...JOUR_TYPE.staffState, date: jour, reservations: resas, holds: [], ouvertures: etat.ouvertures, revision: `banc:${jour}:${resas.length}:${etat.ouvertures.length}` });
      }
      if (u.pathname === '/api/admin-range') return json(res, { ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont', revision: 'banc', syncedAt: iso(now) });
      if (u.pathname === '/api/public-booking-meta') return json(res, { ...CENTRE.publicBookingMeta, today: ymd(Date.now()) });
      if (u.pathname === '/api/staff-customer-notes') return json(res, { ok: true, eligible: true, clientKey: 'banc', note: null, notesByReservationId: {} });
      if (u.pathname === '/api/staff-reservations' && req.method === 'GET') {
        const n = Number(u.searchParams.get('numero'));
        const r = etat.creees.find((x) => x.id === n) || etat.resasDuJour.find((x) => x.id === n) || null;
        return json(res, r ? { ok: true, reservation: r, centre: 'libramont' } : { ok: false, message: 'Introuvable.' }, r ? 200 : 404);
      }
      if (u.pathname === '/api/ops') return await ops(req, res, u);
      if (u.pathname === '/api/assistant') return await assistant(req, res);
      if (u.pathname.startsWith('/api/')) return json(res, { ok: false, error: 'hors banc' }, 404);
      return fichier(req, res, u);
    } catch (erreur) {
      if (!res.headersSent) json(res, { ok: false, message: String(erreur && erreur.message) }, 500);
      return undefined;
    }
  });

  return {
    etat,
    lead,
    url: '',
    async ecouter() {
      await new Promise((resolve) => serveur.listen(port, '127.0.0.1', resolve));
      this.url = `http://127.0.0.1:${serveur.address().port}`;
      return this.url;
    },
    // Le flux arrete par `arret` repart.
    relacher() { const r = etat.attente; etat.attente = null; if (r) r(); },
    fermer() {
      if (etat.attente) this.relacher();
      const ferme = new Promise((resolve) => serveur.close(() => resolve()));
      if (typeof serveur.closeAllConnections === 'function') serveur.closeAllConnections();
      return ferme;
    },
  };
}

module.exports = { creerBanc, datesDuBanc, fluxDemande, carteReservation, carteMail };

if (require.main === module) {
  const arg = (nom) => (process.argv.find((a) => a.startsWith(`--${nom}=`)) || '').split('=').slice(1).join('=');
  const banc = creerBanc({ port: Number(arg('port') || 4433) });
  if (arg('flux')) banc.etat.assistant.flux = path.resolve(arg('flux'));
  banc.etat.assistant.pas = 260;
  banc.ecouter().then((url) => console.log(`banc des demandes sur ${url}/ (console, puis Demandes sur mesure)`));
}
