// LE NUMERO DE RESERVATION MENE A LA RESERVATION (2026-11-06).
//
// Ansar : « chaque reservation a un numero, il faut au moins que tout ca soit
// reference et vraiment utile ; ce qui n est pas necessaire, retire-le ». Le
// numero est l identifiant de la reservation (reservations.id) : celui du
// dossier dans la console, du mail et de la confirmation du client, de
// Telegram et des exports. Il ouvre la reservation et se retrouve.
//
//   [A] le serveur, sur le vrai handler (GET /api/staff-reservations?numero=) :
//       le centre de l ecran rend le jour et l heure ; un autre centre du meme
//       client, pour une session qui peut y passer, rend son nom et rien
//       d autre ; un autre client, ou une session sans le droit de changer de
//       centre : le meme 404 qu un numero qui n existe pas ; des chiffres
//       seulement (422) ; une session sans droit de lecture (403).
//   [L] ce que la console comprend d une recherche (numeroReservationDe) :
//       « 1734 », « n° 1734 », « #1734 », « réservation 1734 » ; « 12 », « p3 »
//       ou un telephone restent ce qu ils etaient.
//   [M] les mails : « Réservation n° X » dans la carte de chaque mail d une
//       reservation, une seule fois, jamais en lien chez le client ; le bouton
//       de l equipe ouvre /?resa=X ; la version texte le porte ; le fichier
//       agenda le donne avec le telephone ; un texte reecrit par le centre
//       reste tel quel, et {{numero}} le lui donne.
//   [T] Telegram : « Réservation n° X » (l annonce, les modifications, un mail
//       revenu) s ouvre d un toucher, le texte reste du texte brut (une entite
//       text_link, juste au morceau coupe et apres la ligne du repli) ; une
//       demande de groupe n a plus de numero, « À traiter dans la console »
//       l ouvre ; un identifiant fait de chiffres ne s ecrit plus.
//   [E] les exports et la copie de secours l ecrivent comme partout ; la
//       demande de groupe n a plus de numero.
//   [R] ce qui est parti : « Ticket # », « requete », « Demande # »,
//       « blocage n° », « #id », « le dossier n° ».
//   [C] la console dans un navigateur : l adresse /?resa=X ouvre la reservation
//       d un autre jour et s efface ; la liste filtre sur le numero, au tableau
//       du jour comme a la liste de la ressource ; Entree ouvre celle d un autre
//       jour ; la liste vide propose de l ouvrir ; la page Reservations la
//       trouve parmi toutes les dates, annulee comprise.
//
// --contre-preuves : chaque regle retiree en memoire (code compile ou servi
// mute, le disque n est jamais touche) : la ligne qui la prouve doit rougir.
//
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/numero-reservation-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const CONTRE = process.argv.includes('--contre-preuves');
const PORT = Number(process.env.PINLANE_NUMERO_PORT || 5211);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;
const lire = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CRLF).join(LF);

let echecs = 0;
let silence = false;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`);
  return Boolean(cond);
}

// ---------------------------------------------------------------------------
// [A] LE SERVEUR. La relation centre -> client, lue par requestedCenterIsSameClient.
// ---------------------------------------------------------------------------
const CLIENTS = { libramont: 'fungalaxy', gembloux: 'fungalaxy', arlon: 'un-autre-client' };
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
const lecturesDossier = [];
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === "select id, coalesce(client_id, '') as client_id from centers;") {
    const rows = Object.entries(CLIENTS).map(([id, clientId]) => ({ id, client_id: clientId }));
    return { rows, rowCount: rows.length };
  }
  if (/^select \* from reservations where id = \$1 limit 1;?$/.test(s)) lecturesDossier.push(params[0]);
  return queryDuBanc.call(this, sql, params);
};

const DIRECTION = (centre = 'libramont') => B.sessionDuRole('direction', { nom: 'Ansar', centre });
const MANAGER = (centre = 'libramont') => B.sessionDuRole('manager', { nom: 'Rachel', centre });
const SANS_DROIT = () => ({ centerId: 'libramont', member: { id: 'm-x', name: 'X' }, role: { id: 'x', locked: false }, permissions: [] });
const DOSSIER = (id, centre, champs = {}) => B.ligne(id, { center_id: centre, name: `Famille ${id}`, start_time: '15:00', lanes: [1], ...champs });

async function scenarioServeur(mutations = []) {
  B.semer([DOSSIER(1734, 'libramont'), DOSSIER(1735, 'gembloux'), DOSSIER(1736, 'arlon')]);
  lecturesDossier.length = 0;
  const m = B.monter({ mutations, session: MANAGER() });
  const demander = async (session, numero, centre = 'libramont') => {
    m.changerSession(session);
    const r = await m.appeler('GET', `/api/staff-reservations?numero=${encodeURIComponent(numero)}&centerId=${encodeURIComponent(centre)}`);
    return { statut: r.statut, json: r.json, brut: JSON.stringify(r.json) };
  };
  return {
    ici: await demander(MANAGER(), '1734'),
    autreCentreDirection: await demander(DIRECTION(), '1735'),
    autreClientDirection: await demander(DIRECTION(), '1736'),
    autreCentreManager: await demander(MANAGER(), '1735'),
    inconnu: await demander(MANAGER(), '99999'),
    lettres: await demander(MANAGER(), '17a4'),
    vide: await demander(MANAGER(), ''),
    sansDroit: await demander(SANS_DROIT(), '1734'),
    lectures: lecturesDossier.length,
  };
}
const ATTENDU_404 = (n) => `Aucune réservation n° ${n} dans ce centre.`;
function jugerServeur(v) {
  const r = v.ici.json.reservation || {};
  const libre = v.ici.statut === 200 && r.id === 1734 && r.centerId === 'libramont' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) && r.startTime === '15:00' && r.name === 'Famille 1734';
  const passage = v.autreCentreDirection.statut === 200 && v.autreCentreDirection.json.centre === 'gembloux' && !('reservation' in v.autreCentreDirection.json) && !/Famille 1735/.test(v.autreCentreDirection.brut);
  const autreClient = v.autreClientDirection.statut === 404 && v.autreClientDirection.json.message === ATTENDU_404('1736') && !/arlon|Famille/.test(v.autreClientDirection.brut);
  const sansPassage = v.autreCentreManager.statut === 404 && v.autreCentreManager.json.message === ATTENDU_404('1735') && !/gembloux|Famille/.test(v.autreCentreManager.brut);
  const inconnu = v.inconnu.statut === 404 && v.inconnu.json.message === ATTENDU_404('99999');
  const chiffres = v.lettres.statut === 422 && v.vide.statut === 422;
  const droit = v.sansDroit.statut === 403;
  return { libre, passage, autreClient, sansPassage, inconnu, chiffres, droit };
}
async function groupeServeur() {
  const v = await scenarioServeur();
  const j = jugerServeur(v);
  ok(j.libre, '[A] dans le centre de l ecran : le numero rend la reservation (jour, heure, nom)', v.ici);
  ok(j.passage, '[A] un autre centre du meme client, pour la direction : le nom du centre et rien d autre', v.autreCentreDirection);
  ok(j.autreClient, '[A] un autre client : le meme 404 qu un numero inconnu, sans nom de centre ni de client', v.autreClientDirection);
  ok(j.sansPassage, '[A] un role sans le droit de changer de centre : le meme 404, rien n est revele', v.autreCentreManager);
  ok(j.inconnu, '[A] un numero qui n existe pas : 404 « Aucune réservation n° X dans ce centre. »', v.inconnu);
  ok(j.chiffres, '[A] des chiffres seulement : 422 pour « 17a4 » et pour un numero vide', { lettres: v.lettres.statut, vide: v.vide.statut });
  ok(j.droit, '[A] une session sans droit de lecture : 403, avant toute lecture', v.sansDroit);
  ok(v.lectures >= 1 && v.lectures <= 6, '[A] une lecture du dossier par demande valide, aucune pour un refus', v.lectures);
}

// ---------------------------------------------------------------------------
// [L] LA LECTURE D UNE RECHERCHE.
// ---------------------------------------------------------------------------
function lecteurDuNumero(source = lire('assets/app-main.js')) {
  const a = source.indexOf('function numeroReservationDe(texte) {');
  const b = source.indexOf('function reservationPorteLeNumero(', a);
  if (a < 0 || b < 0) return null;
  // eslint-disable-next-line no-eval
  return (0, eval)(`(function () { ${source.slice(a, b)}; return numeroReservationDe; })`)();
}
const CAS_LECTURE = [
  ['1734', '1734'], ['n° 1734', '1734'], ['N°1734', '1734'], ['n°\u00a01734', '1734'], ['#1734', '1734'], ['no 1734', '1734'],
  ['réservation 1734', '1734'], ['reservation n° 1734', '1734'], ['Résa 1734', '1734'], ['dossier 1734', '1734'], ['  1734  ', '1734'],
  ['n° 12', '12'], ['12', ''], ['3', ''], ['p3', ''], ['0470 12 34 56', ''], ['1734a', ''], ['Dupont', ''], ['15:00', ''], ['12 j', ''],
];
function groupeLecture() {
  const lecteur = lecteurDuNumero();
  ok(typeof lecteur === 'function', '[L] la console a sa lecture du numero (numeroReservationDe)');
  if (!lecteur) return;
  const faux = CAS_LECTURE.filter(([texte, attendu]) => lecteur(texte) !== attendu).map(([texte, attendu]) => `${texte} -> ${lecteur(texte)} (attendu ${attendu || 'rien'})`);
  ok(!faux.length, '[L] « 1734 », « n° 1734 », « #1734 », « réservation 1734 » donnent 1734 ; « 12 », « p3 », un telephone ou une heure ne sont pas un numero', faux);
}

// ---------------------------------------------------------------------------
// [M] LES MAILS.
// ---------------------------------------------------------------------------
const CLIENT_MAILS = ['request_received', 'confirmation', 'reminder_48h', 'delay_update'];
function rechargerComms() {
  const chemin = require.resolve(path.join(ROOT, 'lib/ops-communications.js'));
  delete require.cache[chemin];
  return require(chemin);
}
async function scenarioMails() {
  const c = rechargerComms();
  const echantillons = c.buildEmailSamples();
  const parModele = Object.fromEntries(echantillons.map((e) => [e.templateId, e]));
  const fois = (html) => (String(html).match(/n° 9001/g) || []).length;
  const lienSurLeNumero = (html) => /<a\b[^>]*>[^<]*n° 9001/.test(html) || /resa=9001/.test(html);
  const reservation = { id: 4242, centerId: 'libramont', name: 'Marie Dupont', email: 'marie@test.be', phone: '+32470123456', date: '2026-12-12', startTime: '15:00', pax: 6, type: 'formule', formuleId: 'f4', label: 'FORMULE 4' };
  const confirmation = c.buildMessage({ reservation, templateId: 'confirmation', channel: 'email' });
  const ics = String((confirmation.pieceJointe && confirmation.pieceJointe.contenu) || '').replace(/\r\n[ \t]/g, '');
  const reecrit = c.buildMessage({ reservation, templateId: 'confirmation', channel: 'email', overrides: { body: 'Bonjour {{prenom}}, à bientôt chez {{centre}}.' } });
  const avecVariable = c.buildMessage({ reservation, templateId: 'confirmation', channel: 'email', overrides: { body: 'Bonjour {{prenom}}, votre numéro : {{numero}}.' } });
  const enfiles = [];
  await c.enqueueReservationCommunications({ ...reservation, date: '2027-03-13' }, {
    validationMode: 'confirmed',
    enqueue: async (row) => { enfiles.push(row); return { id: 0 }; },
    deps: { query: async () => ({ rows: [] }) },
  });
  const textes = Object.fromEntries(enfiles.filter((r) => r.channel === 'email').map((r) => [r.templateId, String((r.payload && r.payload.textBody) || '')]));
  // Un centre qui a reecrit sa confirmation : sa version texte reste la sienne.
  const enfilesReecrits = [];
  const reglages = { confirmation: { enabled: true, body: 'Bonjour {{prenom}}, à bientôt.' } };
  await c.enqueueReservationCommunications({ ...reservation, date: '2027-03-13' }, {
    validationMode: 'confirmed',
    enqueue: async (row) => { enfilesReecrits.push(row); return { id: 0 }; },
    deps: { query: async (sql) => (String(sql).includes('center_automation_settings') && String(sql).trim().startsWith('select') ? { rows: [{ settings: reglages }] } : { rows: [] }) },
  });
  const confirmationReecrite = enfilesReecrits.find((r) => r.channel === 'email' && r.templateId === 'confirmation');
  return {
    clients: CLIENT_MAILS.map((id) => ({ id, fois: parModele[id] ? fois(parModele[id].html) : -1, lien: parModele[id] ? lienSurLeNumero(parModele[id].html) : true })),
    equipe: ['staff_review_request', 'staff_alert', 'delay_staff_attention'].map((id) => ({ id, fois: parModele[id] ? fois(parModele[id].html) : -1 })),
    bouton: parModele.staff_review_request ? /href="[^"]*\/\?resa=9001"[^>]*>[\s\S]{0,400}?Ouvrir la réservation</.test(parModele.staff_review_request.html) : false,
    ics,
    reecrit: { corps: reecrit.body, carte: Array.isArray(reecrit.details) },
    avecVariable: avecVariable.body,
    textes,
    texteReecrit: confirmationReecrite ? String((confirmationReecrite.payload && confirmationReecrite.payload.textBody) || '') : null,
  };
}
function jugerMails(v) {
  return {
    clients: v.clients.every((x) => x.fois === 1 && !x.lien),
    equipe: v.equipe.every((x) => x.fois === 1),
    bouton: v.bouton,
    // (la virgule s echappe dans un fichier agenda : « \, »)
    ics: /Une question \? [^\n]*?\\, en donnant le n° 4242\./.test(v.ics),
    reecrit: v.reecrit.corps === 'Bonjour Marie, à bientôt chez Fun Galaxy Libramont.' && !v.reecrit.carte,
    variable: /votre numéro : 4242\./.test(v.avecVariable),
    texteConfirmation: /\n\nRéservation n° 4242$/.test(v.textes.confirmation || ''),
    texteRappel: /\n\nRéservation n° 4242$/.test(v.textes.reminder_48h || ''),
    texteReecrit: v.texteReecrit === 'Bonjour Marie, à bientôt.',
  };
}
async function groupeMails() {
  const v = await scenarioMails();
  const j = jugerMails(v);
  ok(j.clients, '[M] chaque mail du client porte « Réservation n° X » une fois, en texte, jamais en lien', v.clients);
  ok(j.equipe, '[M] les mails de l equipe sur une reservation portent son numero, une fois', v.equipe);
  ok(j.bouton, '[M] le bouton du mail « à valider » ouvre CETTE reservation (/?resa=X)');
  ok(j.ics, '[M] le fichier agenda donne le numero avec le telephone du centre', v.ics.slice(v.ics.indexOf('DESCRIPTION'), v.ics.indexOf('DESCRIPTION') + 300));
  ok(j.reecrit, '[M] un texte reecrit par le centre reste tel quel, sans carte ni numero ajoute', v.reecrit);
  ok(j.variable, '[M] {{numero}} donne le numero au texte du centre', v.avecVariable);
  ok(j.texteReecrit, '[M] la version texte d une confirmation reecrite par le centre reste son texte, sans numero ajoute', v.texteReecrit);
  ok(j.texteConfirmation && j.texteRappel, '[M] la version texte de la confirmation et du rappel finit par « Réservation n° X »', { confirmation: (v.textes.confirmation || '').slice(-60), rappel: (v.textes.reminder_48h || '').slice(-60) });
}

// ---------------------------------------------------------------------------
// [T] TELEGRAM.
// ---------------------------------------------------------------------------
function recharger(rel) {
  const chemin = require.resolve(path.join(ROOT, rel));
  delete require.cache[chemin];
  return require(chemin);
}
async function scenarioTelegram() {
  const alertes = recharger('lib/garde-alertes.js');
  const annonces = recharger('lib/garde-annonces.js');
  const journal = recharger('lib/garde-journal.js');
  if (typeof annonces.reprendreLesAnnonces === 'function') annonces.reprendreLesAnnonces();
  const GROUPE = '-1001234567';
  const env = { TELEGRAM_JETON: 'jeton-du-banc', TELEGRAM_CHAT: '4242', TELEGRAM_GROUPE: GROUPE, TELEGRAM_SUJETS: 'pannes:2,reservations:3,modifications:4,bilans:5', PUBLIC_APP_URL: 'https://app.pinlane.be' };
  let refus = false;
  let partis = [];
  const fetcher = async (url, options) => {
    const corps = JSON.parse(options.body);
    if (refus && String(corps.chat_id) === GROUPE) return new Response('{"ok":false}', { status: 400 });
    partis.push(corps);
    return new Response('{"ok":true}', { status: 200 });
  };
  const liens = (corps) => (corps.entities || []).map((e) => ({ vu: corps.text.slice(e.offset, e.offset + e.length), url: e.url, type: e.type }));
  const annonce = annonces.texteReservation({ id: 1734, centerId: 'gembloux', channel: 'public', date: '2026-11-14', startTime: '15:00', pax: 12, program: { items: [{ name: 'Bowling' }] }, price: 286 });
  partis = [];
  await alertes.envoyerTelegram(annonce, { sujet: 'reservations', env, fetcher });
  const direct = partis.map(liens);
  partis = [];
  refus = true;
  await alertes.envoyerTelegram(annonce, { sujet: 'reservations', env, fetcher });
  refus = false;
  const repli = partis.map((c) => ({ prefixe: /^\(Le groupe Pinlane refuse/.test(c.text), liens: liens(c) }));
  // Un long message (plus de 3500 caracteres) part en morceaux : chaque lien tombe juste dans le sien.
  const lignes = Array.from({ length: 160 }, (_, i) => `14:${String(i % 60).padStart(2, '0')} Seb : réservation n° ${2000 + i} (samedi 14/11 16:00) déplacée de 15:00 à 16:00`);
  partis = [];
  await alertes.envoyerTelegram(['Modifications', 'Gembloux', ...lignes].join('\n'), { sujet: 'modifications', env, fetcher });
  const morceaux = partis.map((c) => ({ n: (c.text.match(/n° \d+/g) || []).length, liens: liens(c) }));
  partis = [];
  await annonces.annoncerDemande({ id: 61, centerId: 'gembloux', pax: 35, occasion: 'anniversaire', requestedDate: 'samedi 21 novembre 2026, après-midi' }, { env, fetcher });
  const demande = partis.map((c) => ({ texte: c.text, liens: liens(c) }));
  const sansChiffres = journal.classer({ action: 'sendCampaign', entity_type: 'campaign', entity_id: '12', champs: {} });
  const demandeJournal = journal.classer({ action: 'saveCenterConfig', entity_type: 'custom_request', entity_id: '61', champs: {} });
  return { direct, repli, morceaux, demande, sansChiffres, demandeJournal };
}
function jugerTelegram(v) {
  const justes = (liste) => liste.length > 0 && liste.every((l) => l.type === 'text_link' && /^n° (\d+)$/.test(l.vu) && l.url === `https://app.pinlane.be/?resa=${l.vu.slice(3)}`);
  return {
    annonce: v.direct.length === 1 && v.direct[0].length === 1 && justes(v.direct[0]) && v.direct[0][0].vu === 'n° 1734',
    repli: v.repli.length === 1 && v.repli[0].prefixe && justes(v.repli[0].liens) && v.repli[0].liens[0].vu === 'n° 1734',
    morceaux: v.morceaux.length >= 2 && v.morceaux.every((m) => m.n === m.liens.length && justes(m.liens)),
    demande: v.demande.length === 1 && !/n° 61/.test(v.demande[0].texte) && /\nÀ traiter dans la console$/.test(v.demande[0].texte)
      && v.demande[0].liens.length === 1 && v.demande[0].liens[0].vu === 'À traiter dans la console' && v.demande[0].liens[0].url === 'https://app.pinlane.be/?demande=61&centre=gembloux',
    chiffres: Boolean(v.sansChiffres.ligne) && !/\(12\)/.test(v.sansChiffres.ligne) && Boolean(v.demandeJournal.ligne) && !/61/.test(v.demandeJournal.ligne),
  };
}
async function groupeTelegram() {
  const v = await scenarioTelegram();
  const j = jugerTelegram(v);
  ok(j.annonce, '[T] l annonce d une reservation : « n° X » est un lien vers /?resa=X, le texte reste brut', v.direct);
  ok(j.repli, '[T] le groupe refuse, le message part a Ansar avec sa ligne devant : le lien tombe toujours sur « n° X »', v.repli);
  ok(j.morceaux, '[T] un long message coupe en morceaux : chaque numero de chaque morceau a son lien, juste', v.morceaux.map((m) => `${m.n}/${m.liens.length}`));
  ok(j.demande, '[T] une demande de groupe : plus de numero, « À traiter dans la console » l ouvre dans son centre', v.demande);
  ok(j.chiffres, '[T] les modifications n ecrivent plus un identifiant fait de chiffres (campagne, demande)', { campagne: v.sansChiffres, demande: v.demandeJournal });
}

// ---------------------------------------------------------------------------
// [E] LES EXPORTS ET LA COPIE DE SECOURS. [R] CE QUI EST PARTI.
// ---------------------------------------------------------------------------
function groupeExportsEtRetraits() {
  const s = rechargerSecours();
  const resa = { id: 9123, centerId: 'libramont', name: 'Dupont', phone: '+32 470 12 34 56', email: 'd@x.be', date: '2026-12-12', startTime: '15:30', pax: 8, type: 'bowling', label: 'Bowling', lanes: [3], price: 80, basePrice: 80, status: 'confirmed', validationStatus: 'confirmed', channel: 'public', notes: '', extras: [], createdAt: '2026-11-06T08:00:00Z' };
  const copie = s.mailCopieReservation(resa, { evenement: 'nouvelle', centre: { name: 'Fun Galaxy Libramont' } });
  const texteCopie = `${copie.text} ${copie.html}`;
  ok(/Réservation[^\n]{0,40}n° 9123/.test(copie.text) && !/#9123|Référence/.test(texteCopie), '[E] la copie de secours ecrit « Réservation n° X », plus « Référence #X »', copie.text.slice(copie.text.indexOf('Dossier'), copie.text.indexOf('Dossier') + 120));
  const demande = s.mailCopieDemandeSurMesure({ id: 77, centerId: 'libramont', contactName: 'Claire', pax: 42, requestedDate: '2026-12-12', email: 'c@x.be', phone: '0470' }, { centre: { name: 'Fun Galaxy Libramont' } });
  ok(!/Demande #|#77|n° 77|Référence/.test(`${demande.text} ${demande.html}`), '[E] la copie d une demande de groupe ne porte plus de numero de demande');
  const excel = lire('lib/export-excel.js');
  ok(/titre: 'N° de réservation', type: 'entier'/.test(excel) && !/'Référence'/.test(excel), '[E] l export complet : une colonne « N° de réservation », plus de « Référence » (ni pour les demandes)');
  const direction = lire('assets/admin-console.js');
  ok(/excelRow\(\['N° de réservation', 'Date'/.test(direction) && /Number\(reservation\.id\) \|\| ''/.test(direction) && !/`#\$\{reservation\.id\}`/.test(direction), '[E] l export de la direction : « N° de réservation », le numero tel quel, plus « Réf. #X »');
  const retraits = [
    ['assets/app-main.js', /Ticket #/, 'le « Ticket # » du ticket de caisse'],
    ['assets/app-main.js', /blocage n° \$\{id\}/, 'le « blocage n° X »'],
    ['assets/app-main.js', /la réservation #\$\{id\}/, 'le « #X » de la suppression'],
    ['assets/staff-pages-v2.js', /requete \$\{/, 'le code de requete du journal'],
    ['assets/staff-pages-v2.js', /objet \$\{esc\(entry\.entityType\)\}/, 'l « objet type #id » du journal'],
    ['assets/tour-controle.js', /dossier n° \$\{r\.id\}/, 'le « dossier n° X » inerte de la Tour'],
    ['assets/ops-console.js', /Réservation #\$\{/, 'le « Réservation #X » de la simulation'],
    ['lib/secours-mails.js', /Demande #\$\{|`#\$\{r\.id\}`/, 'les « #X » de la copie de secours'],
    ['lib/reserver-fenetre.js', /le dossier n°/, 'le « dossier n° X » du comptoir'],
  ].filter(([fichier, motif]) => motif.test(lire(fichier))).map(([, , quoi]) => quoi);
  ok(!retraits.length, '[R] plus aucun numero qui ne mene nulle part (ticket, requete, objet #id, demande, blocage, simulation)', retraits);
  const liens = [
    ['assets/staff-pages-v2.js', /ouvrirReservationNumero\('\$\{id\}'\)">Réservation n°&nbsp;\$\{id\}/, 'le journal des actions'],
    ['assets/tour-controle.js', /ouvrirReservationNumero\('\$\{r\.id\}'\)">réservation n°&nbsp;\$\{r\.id\}/, 'la Tour de controle'],
    ['assets/ops-console.js', /ouvrirReservationNumero\('\$\{String\(log\.reservationId\)\}'\)">Réservation n°&nbsp;/, 'la simulation'],
  ].filter(([fichier, motif]) => !motif.test(lire(fichier))).map(([, , ou]) => ou);
  ok(!liens.length, '[R] la ou le numero reste dans la console, il ouvre la reservation', liens);
}
function rechargerSecours() {
  const chemin = require.resolve(path.join(ROOT, 'lib/secours-mails.js'));
  delete require.cache[chemin];
  return require(chemin);
}

// ---------------------------------------------------------------------------
// [C] LA CONSOLE DANS UN NAVIGATEUR. Les doublures de la console (une journee
// chargee, aucune base) sont celles du gate staff-console-perf, reprises telles
// quelles ; ce gate y ajoute la lecture du numero.
// ---------------------------------------------------------------------------
const jourBruxelles = (decalage = 0) => {
  const d = new Date(Date.now() + decalage * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(d);
};
const JOUR = jourBruxelles(0);
const AUTRE_JOUR = jourBruxelles(3);
const AUTRE_JOUR_2 = jourBruxelles(5);
// Les identifiants que la doublure donne : 70000 + jour du mois x 200, piste 1 a 10:00 d abord.
const premierId = (date) => 70000 + Number(date.slice(8, 10)) * 200;
function chargerDoublure() {
  const gate = lire('scripts/staff-console-perf-check.js');
  const a = gate.indexOf('function installerMock(page) {');
  const fin = '}, { expiresAt, JOUR });\n}';
  const b = gate.indexOf(fin, a);
  if (a < 0 || b < 0) throw new Error('doublure de staff-console-perf-check introuvable');
  // eslint-disable-next-line no-eval
  return (0, eval)(`(function (JOUR) { ${gate.slice(a, b + fin.length)}; return installerMock; })`)(JOUR);
}

let mutationsServies = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
function servir() {
  return http.createServer((rq, rs) => {
    const u = new URL(rq.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{"ok":true}'); return; }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(path.resolve(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end(); return; }
    const relatif = rel.split(path.sep).join('/');
    const editions = mutationsServies.filter((m) => m.fichier === relatif);
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (!editions.length) { fs.createReadStream(f).pipe(rs); return; }
    let texte = fs.readFileSync(f, 'utf8').split(CRLF).join(LF);
    for (const { de, vers } of editions) {
      if (texte.split(de).length - 1 !== 1) { rs.end(`throw new Error('ancre absente : ${relatif}');`); return; }
      texte = texte.split(de).join(vers);
    }
    rs.end(texte);
  });
}

async function ouvrir(browser, installerMock, chemin) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-BE', timezoneId: 'Europe/Brussels' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message || e).slice(0, 200)));
  await installerMock(page);
  await page.addInitScript(({ jours }) => {
    const avant = window.fetch;
    window.__NUMEROS__ = [];
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (u.pathname === '/api/staff-reservations' && u.searchParams.has('numero')) {
        const n = u.searchParams.get('numero');
        window.__NUMEROS__.push(n);
        const repondre = (corps, status) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
        for (const d of jours) {
          const r = window.__JOUR__(d).find((x) => String(x.id) === n);
          if (r) return repondre({ ok: true, reservation: { id: r.id, centerId: 'libramont', date: r.date, startTime: r.startTime, name: r.name, pax: r.pax, status: r.status } }, 200);
        }
        return repondre({ ok: false, message: `Aucune réservation n° ${n} dans ce centre.` }, 404);
      }
      return avant(input, init);
    };
  }, { jours: [JOUR, AUTRE_JOUR, AUTRE_JOUR_2] });
  await page.goto(`http://127.0.0.1:${PORT}${chemin}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.ouvrirReservationNumero === 'function', null, { timeout: 60000 });
  return { ctx, page, erreurs };
}
const ficheOuverte = (page, id) => page.waitForFunction((n) => {
  const o = document.querySelector('#posOverlay');
  // (la fiche ecrit « n° » et le numero avec une espace insecable)
  return o && !o.classList.contains('hidden') && state.selectedRes && String(state.selectedRes.id) === String(n) && o.textContent.replace(/\s+/g, ' ').indexOf(`n° ${n}`) >= 0;
}, id, { timeout: 20000 }).then(() => true, () => false);

async function scenarioLien(browser, installerMock) {
  const id = premierId(AUTRE_JOUR);
  const { ctx, page, erreurs } = await ouvrir(browser, installerMock, `/?resa=${id}`);
  const ouverte = await ficheOuverte(page, id);
  const etat = await page.evaluate((n) => ({ jour: state.currentDate, adresse: location.search, vue: state.view, numeros: window.__NUMEROS__.slice(), chargee: (state.reservations || []).some((r) => String(r.id) === String(n)), choisie: state.selectedRes ? state.selectedRes.id : null, fiche: (document.querySelector('#posOverlay') || {}).className || '', texte: ((document.querySelector('#posOverlay') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 260), page: state.staffMenuPage, avis: ((document.querySelector('#toast, .toast') || {}).textContent || '').slice(0, 120) }), id);
  await ctx.close();
  return { ouverte, ...etat, id, erreurs };
}
async function preparerListe(page, vue) {
  await page.evaluate(async ({ JOUR, vue }) => {
    if (typeof ensureStaffConsolesLoaded === 'function') await ensureStaffConsolesLoaded();
    if (typeof closePos === 'function') closePos();
    state.currentDate = JOUR; state.staffMenuPage = 'planning'; state.staffResourceView = vue; state.staffStatusFilter = 'all';
    state.reservations = window.__JOUR__(JOUR).map((x) => ({ ...x }));
    setView('staff');
    renderStaff();
  }, { JOUR, vue });
}
async function scenarioListe(browser, installerMock) {
  const { ctx, page, erreurs } = await ouvrir(browser, installerMock, '/');
  const idDuJour = premierId(JOUR) + 7;
  const resultat = {};
  for (const vue of ['bowling', 'all']) {
    await preparerListe(page, vue);
    resultat[vue] = await page.evaluate(async ({ idDuJour }) => {
      const autres = window.__JOUR__(state.currentDate).filter((r) => r.id !== idDuJour).map((r) => r.name);
      const cible = window.__JOUR__(state.currentDate).find((r) => r.id === idDuJour);
      const lireListe = () => (document.getElementById('resList') || {}).textContent || '';
      applyStaffSearch(`n° ${idDuJour}`, { immediate: true });
      rendreLaListe();
      const texte = lireListe();
      const tableau = typeof window.gfIdsTrouves === 'function' ? window.gfIdsTrouves() : null;
      applyStaffSearch('', { immediate: true });
      return {
        cible: texte.indexOf(cible.name) >= 0,
        intrus: autres.filter((nom) => texte.indexOf(nom) >= 0).length,
        tableau: tableau ? [...tableau].map(String) : null,
      };
    }, { idDuJour });
  }
  // Un numero d un autre jour : la liste vide propose de l ouvrir, le bouton l ouvre.
  await preparerListe(page, 'bowling');
  const idAutre = premierId(AUTRE_JOUR) + 3;
  const vide = await page.evaluate(({ idAutre }) => {
    applyStaffSearch(String(idAutre), { immediate: true });
    rendreLaListe();
    const bouton = document.querySelector(`#resList [data-ouvrir-numero="${idAutre}"]`);
    const titre = ((document.querySelector('#resList .e-title') || {}).textContent || '').replace(/\s+/g, ' ');
    if (bouton) bouton.click();
    return { bouton: Boolean(bouton), titre };
  }, { idAutre });
  vide.ouverte = await ficheOuverte(page, idAutre);
  // Entree dans la recherche de la liste : la reservation d un autre jour s ouvre.
  await preparerListe(page, 'bowling');
  const idEntree = premierId(AUTRE_JOUR_2) + 5;
  const champ = await page.$('#searchInput');
  let entree = { champ: Boolean(champ), ouverte: false };
  if (champ) {
    await page.evaluate((v) => { const c = document.getElementById('searchInput'); c.value = v; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }, `n° ${idEntree}`);
    entree.ouverte = await ficheOuverte(page, idEntree);
  }
  await ctx.close();
  return { liste: resultat, idDuJour: String(idDuJour), vide, entree, erreurs };
}
async function scenarioToutesDates(browser, installerMock) {
  const { ctx, page, erreurs } = await ouvrir(browser, installerMock, '/');
  // La page lit la fenetre a partir de son propre jour (deux mois en arriere) :
  // la doublure rend les reservations de ce premier jour.
  const id = await page.evaluate(async () => {
    if (typeof ensureStaffConsolesLoaded === 'function') await ensureStaffConsolesLoaded();
    const fenetre = addDays(todayStr(), -60);
    // Annulee : le client qui appelle avec ce numero doit entendre ce qu elle est devenue.
    const ligne = window.__JOUR__(fenetre)[2];
    ligne.status = 'cancelled';
    await window.pv2ResSearchEnsureData(true);
    return ligne.id;
  });
  const trouve = await page.evaluate(({ id }) => window.pv2ResSearchMatches(`n° ${id}`).map((r) => String(r.id)), { id });
  const nom = await page.evaluate(({ id }) => window.pv2ResSearchMatches('Groupe').some((r) => r.id === id), { id });
  await ctx.close();
  return { trouve, id: String(id), parNomAnnuleeCachee: !nom, erreurs };
}
function jugerConsole(lien, liste, toutes) {
  return {
    lien: lien.ouverte && lien.jour === AUTRE_JOUR && !/resa=/.test(lien.adresse) && lien.vue === 'staff',
    liste: liste.liste.bowling.cible && liste.liste.bowling.intrus === 0,
    tableau: liste.liste.all.cible && liste.liste.all.intrus === 0 && Array.isArray(liste.liste.all.tableau) && liste.liste.all.tableau.includes(liste.idDuJour),
    vide: liste.vide.bouton && /Pas de réservation n° \d+ ce jour-là/.test(liste.vide.titre) && liste.vide.ouverte,
    entree: liste.entree.champ && liste.entree.ouverte,
    toutes: toutes.trouve.length === 1 && toutes.trouve[0] === toutes.id && toutes.parNomAnnuleeCachee,
  };
}

async function lancerNavigateur() {
  const { chromium } = require(require.resolve('playwright-core', { paths: [ROOT] }));
  return chromium.launch({ executablePath: BROWSER_PATH, headless: true });
}
async function scenarioConsole(browser, installerMock) {
  const lien = await scenarioLien(browser, installerMock);
  const liste = await scenarioListe(browser, installerMock);
  const toutes = await scenarioToutesDates(browser, installerMock);
  return { lien, liste, toutes };
}
async function groupeConsole(browser, installerMock) {
  const { lien, liste, toutes } = await scenarioConsole(browser, installerMock);
  const j = jugerConsole(lien, liste, toutes);
  ok(j.lien, '[C] l adresse /?resa=X ouvre la reservation d un autre jour, sur son jour, puis s efface de la barre', lien);
  ok(j.liste, '[C] la liste de la ressource filtre sur le numero tape (« n° X ») : cette reservation, et elle seule', liste.liste.bowling);
  ok(j.tableau, '[C] le tableau du jour trouve le numero comme un nom (gfTrouve), la liste suit', liste.liste.all);
  ok(j.vide, '[C] un numero d un autre jour : « Pas de réservation n° X ce jour-là » et un bouton qui l ouvre', liste.vide);
  ok(j.entree, '[C] Entree sur « n° X » dans la recherche de la liste ouvre la reservation d un autre jour', liste.entree);
  ok(j.toutes, '[C] la page Reservations trouve le numero parmi toutes les dates, annulee comprise (un nom, lui, cache les annulees)', toutes);
  const erreurs = [...lien.erreurs, ...liste.erreurs, ...toutes.erreurs];
  ok(!erreurs.length, '[C] aucune erreur dans la console du navigateur', erreurs);
}

// ---------------------------------------------------------------------------
// CONTRE-PREUVES.
// ---------------------------------------------------------------------------
async function contrePreuvesNode() {
  const serveur = async (nom, fichier, de, vers, regle) => B.contrePreuve(ok, {
    nom, fichier, de, vers, libelle: regle,
    rejouer: (mutations) => scenarioServeur(mutations),
    attendu: (v) => { const j = jugerServeur(v); return j[regle]; },
  });
  await serveur('centre', 'api/staff-reservations.js', '        if (dossier && centre && sonCentre === centre) {', '        if (dossier) {', 'sansPassage');
  await serveur('client', 'api/staff-reservations.js', '  return requestedCenterIsSameClient(session.centerId, centre);', '  return true;', 'autreClient');
  await serveur('droit', 'api/staff-reservations.js', "  if (!sessionHasPermission(session, 'centers.switch')) return false;\n", '', 'sansPassage');
  await serveur('chiffres', 'api/staff-reservations.js', "        if (!/^\\d{1,12}$/.test(numero)) {", '        if (false) {', 'chiffres');

  // Les mails : chaque regle retiree en memoire (le module est recompile).
  const mail = async (nom, de, vers, regle) => {
    const compile = require('module').prototype._compile;
    const cible = path.join(ROOT, 'lib/ops-communications.js');
    require('module').prototype._compile = function (contenu, fichier) {
      if (fichier !== cible) return compile.call(this, contenu, fichier);
      const texte = contenu.split(CRLF).join(LF);
      if (texte.split(de).length - 1 !== 1) throw new Error(`ancre absente : ${de.slice(0, 60)}`);
      return compile.call(this, texte.split(de).join(vers), fichier);
    };
    let rouge = false;
    let mesure = '';
    try {
      silence = true;
      const v = await scenarioMails();
      rouge = !jugerMails(v)[regle];
      mesure = regle;
    } catch (error) {
      rouge = !/ancre absente/.test(error.message);
      mesure = error.message;
    } finally {
      silence = false;
      require('module').prototype._compile = compile;
      rechargerComms();
    }
    ok(rouge, `contre-preuve « ${nom} » : le gate ROUGIT (${regle})`, mesure);
  };
  await mail('carte', "  return id ? [{ label: 'Réservation', value: `n° ${id}` }] : [];", '  return [];', 'clients');
  await mail('bouton', "  return id ? `${publicAppUrl()}/?resa=${id}` : `${publicAppUrl()}/`;", '  return `${publicAppUrl()}/`;', 'bouton');
  await mail('texte', "  return id && corps.trim() ? `${corps}\\n\\nRéservation n° ${id}` : corps;", '  return corps;', 'texteConfirmation');
  await mail('reecrit', 'textBody: Array.isArray(message.details) ? texteAvecNumero(message.body, reservation) : message.body,', 'textBody: texteAvecNumero(message.body, reservation),', 'texteReecrit');
  await mail('variable', "  numero: 'num[eé]ro',\n", '', 'variable');

  const telegram = async (nom, fichier, de, vers, regle) => {
    const compile = require('module').prototype._compile;
    const cible = path.join(ROOT, fichier);
    require('module').prototype._compile = function (contenu, f) {
      if (f !== cible) return compile.call(this, contenu, f);
      const texte = contenu.split(CRLF).join(LF);
      if (texte.split(de).length - 1 !== 1) throw new Error(`ancre absente : ${de.slice(0, 60)}`);
      return compile.call(this, texte.split(de).join(vers), f);
    };
    let rouge = false;
    let mesure = '';
    try {
      silence = true;
      const v = await scenarioTelegram();
      rouge = !jugerTelegram(v)[regle];
      mesure = regle;
    } catch (error) {
      rouge = !/ancre absente/.test(error.message);
      mesure = error.message;
    } finally {
      silence = false;
      require('module').prototype._compile = compile;
      ['lib/garde-alertes.js', 'lib/garde-annonces.js', 'lib/garde-journal.js'].forEach(recharger);
    }
    ok(rouge, `contre-preuve « ${nom} » : le gate ROUGIT (${regle})`, mesure);
  };
  await telegram('telegram', 'lib/garde-alertes.js', '  if (entites.length) corps.entities = entites;\n', '', 'annonce');
  await telegram('morceau', 'lib/garde-alertes.js', '  const entites = entitesDesLiens(texte, { env, liens });', "  const entites = entitesDesLiens(String(texte).replace(/^\\(Le groupe Pinlane refuse[^\\n]*\\n/, ''), { env, liens });", 'repli');
  await telegram('demande', 'lib/garde-annonces.js', '  lignes.push(A_TRAITER);', '  lignes.push(`Demande n° ${d.id}, à traiter dans la console`);', 'demande');
  await telegram('identifiant', 'lib/garde-journal.js', "const quoi = l.entity_id && !/^\\d+$/.test(String(l.entity_id)) && ", 'const quoi = l.entity_id && ', 'chiffres');
}
async function contrePreuvesConsole(browser, installerMock) {
  const servie = async (nom, fichier, de, vers, regle, scenario) => {
    mutationsServies = [{ fichier, de, vers }];
    let rouge = false;
    let mesure = '';
    try {
      silence = true;
      const v = await scenario();
      rouge = !v[regle];
      mesure = JSON.stringify(v).slice(0, 160);
    } catch (error) {
      rouge = true;
      mesure = error.message;
    } finally {
      silence = false;
      mutationsServies = [];
    }
    ok(rouge, `contre-preuve « ${nom} » : le gate ROUGIT (${regle})`, mesure);
  };
  const lienSeul = async () => { const lien = await scenarioLien(browser, installerMock); return { lien: lien.ouverte && lien.jour === AUTRE_JOUR && !/resa=/.test(lien.adresse) }; };
  const listeSeule = async () => { const liste = await scenarioListe(browser, installerMock); const j = jugerConsole({ ouverte: true, jour: AUTRE_JOUR, adresse: '', vue: 'staff' }, liste, { trouve: ['x'], id: 'x', parNomAnnuleeCachee: true }); return j; };
  const toutesSeule = async () => { const toutes = await scenarioToutesDates(browser, installerMock); return { toutes: toutes.trouve.length === 1 && toutes.trouve[0] === toutes.id }; };
  await servie('lien', 'assets/app-main.js', '  if (isAuthenticated) ouvrirReservationDuLien();\n', '', 'lien', lienSeul);
  await servie('liste', 'assets/app-main.js', '      : res.filter(r => reservationPorteLeNumero(r, numeroCherche) || ', '      : res.filter(r => ', 'liste', listeSeule);
  await servie('tableau', 'assets/pinlane-planning-global.js', '    if (numero && String(r.id) === numero) return true;\n', '', 'tableau', listeSeule);
  await servie('entree', 'assets/app-main.js', "  if (e.target && e.target.id === 'searchInput' && !e.isComposing) entreeRechercheNumero(e);\n", '', 'entree', listeSeule);
  await servie('vide', 'assets/app-main.js', " onclick=\"ouvrirReservationNumero('${numeroCherche}')\">", '>', 'vide', listeSeule);
  await servie('toutes', 'assets/staff-pages-v2.js', '    if (parNumero.length) return parNumero;\n', '', 'toutes', toutesSeule);
}

// ---------------------------------------------------------------------------
(async () => {
  let browser = null;
  let serveur = null;
  try {
    if (!CONTRE) {
      await groupeServeur();
      groupeLecture();
      await groupeMails();
      await groupeTelegram();
      groupeExportsEtRetraits();
    } else {
      await contrePreuvesNode();
    }
    serveur = servir();
    await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
    browser = await lancerNavigateur();
    const installerMock = chargerDoublure();
    if (!CONTRE) await groupeConsole(browser, installerMock);
    else await contrePreuvesConsole(browser, installerMock);
  } catch (error) {
    ok(false, 'le gate a plante', error && error.stack ? error.stack.split(LF).slice(0, 4).join(' | ') : String(error));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serveur) serveur.close();
  }
  B.sortir('numero-reservation', echecs, CONTRE ? 'chaque regle retiree rougit' : 'le numero mene a la reservation, partout');
})();
