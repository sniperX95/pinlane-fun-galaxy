// L ISOLATION DES MAILS ENTRE CLIENTS (2026-09-16).
//
// POURQUOI CE GATE EXISTE. Le 16 septembre, le domaine fungalaxy.be est verifie
// chez Resend, sur le compte UNIQUE que partagent tous les clients de Pinlane,
// et les identites d expediteur de Fun Galaxy basculent dessus. N4 Bowling et
// MI12 (centres de test) tournent deja en production. La consigne de Movsar :
// les mails de Fun Galaxy fonctionnent et ne sont visibles QUE par les centres
// de Fun Galaxy ; un autre bowling ne voit jamais leur existence, et leurs mails
// n interferent pas. Relu dans le code ce jour-la, plusieurs chemins la
// violaient :
//
//   [A] LE DOMAINE D ENVOI APPARTIENT A UN CLIENT. Seule la FORME de l adresse
//       etait verifiee : n importe quel client pouvait enregistrer une
//       identite @fungalaxy.be et signer en son nom, DKIM valide compris. Un
//       domaine neuf ne s ouvre plus que par la plateforme, personne ne prend
//       celui d un autre client, et le refus ne trahit pas l existence d un
//       autre client (meme message qu un domaine jamais declare).
//   [B] LES VARIABLES GLOBALES NE DESIGNENT QUE LA PLATEFORME. RESEND_FROM avec
//       un nom (« Fun Galaxy <...> »), RESEND_REPLY_TO ou STAFF_REVIEW_EMAIL sur
//       l adresse d un client signaient ou recevaient pour TOUS les autres ; une
//       adresse de reception posee en retour d un autre centre aussi.
//   [C] LA NOTIFICATION DE VALIDATION STAFF de tous les centres partait vers une
//       seule adresse, qui pouvait etre celle d un client.
//   [D] UN MAIL SANS CENTRE (l accuse de demande sur mesure du tunnel public)
//       etait signe « Fun Galaxy Libramont », et les reponses revenaient a
//       Libramont, pour les clients de n importe quel centre.
//   [E] LE STAFF D UN CLIENT POSAIT UNE PRISE sur un mail d un autre client par
//       son seul numero.
//   [F] LE BOUTON « ENVOYER UN TEST » partait sans l identite du centre : il
//       confirmait un envoi different de celui que recoivent les clients.
//
// Le routage des mails ENTRANTS (domaine de reception, plus de centre par
// defaut) est prouve par scripts/inbound-webhook-check.js.
//
// HONNETETE : le VRAI code (lib/sender-domains, lib/database, lib/ops-communications,
// api/public-booking-meta) sur une base en memoire ; 'pg' est remplace dans
// require.cache AVANT tout require applicatif, le reseau est une sonde. Chaque
// propriete a son CONTRASTE (Fun Galaxy continue de marcher, sinon la regle
// pourrait tout refuser et passer pour sure) et sa CONTRE-EPREUVE par mutation
// compilee en memoire (disque jamais touche).
//
// Usage : node scripts/email-tenant-isolation-check.js
'use strict';
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
delete process.env.INBOUND_EMAIL_DOMAIN;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE : deux vrais clients (Fun Galaxy, N4 Bowling) et MI12.
// ---------------------------------------------------------------------------
const CENTRES = [
  { id: 'libramont', client_id: 'fungalaxy', nom: 'Fun Galaxy Libramont' },
  { id: 'gembloux', client_id: 'fungalaxy', nom: 'Fun Galaxy Gembloux' },
  { id: 'ciney', client_id: 'fungalaxy', nom: 'Fun Galaxy Ciney' },
  { id: 'n4-bowling', client_id: 'n4-bowling', nom: 'N4 Bowling' },
  { id: 'mi12', client_id: 'mi12', nom: 'MI12' },
];
let IDENTITES = [];
let COMMUNICATIONS = [];
let PRISES = [];
let DEMANDES = [];
let INSERTIONS_IDENTITE = 0;

function etatInitial() {
  // L etat de la production apres la bascule du 16 septembre.
  IDENTITES = [
    { id: 2, center_id: 'libramont', label: 'Fun Galaxy Libramont', email: 'libramont@fungalaxy.be', is_default: true },
    { id: 3, center_id: 'gembloux', label: 'Fun Galaxy Gembloux', email: 'gembloux@fungalaxy.be', is_default: true },
  ];
  COMMUNICATIONS = [{ id: 501, center_id: 'libramont', direction: 'inbound' }];
  PRISES = [];
  DEMANDES = [];
  INSERTIONS_IDENTITE = 0;
}

const lignes = (rows) => ({ rows, rowCount: rows.length });

async function requete(texte, params = []) {
  const sql = String(texte).replace(/\s+/g, ' ').trim();
  if (/^(begin|commit|rollback)/i.test(sql)) return lignes([]);
  if (sql === "select id, coalesce(client_id, '') as client_id from centers;") {
    return lignes(CENTRES.map((c) => ({ ...c })));
  }
  // Les fiches de centre en base : c est ce qui fait exister N4 Bowling et MI12
  // aux yeux du moteur, comme en production (refreshCenterOverrides).
  if (sql === 'select id, name, status, timezone, settings from centers;') {
    return lignes(CENTRES.map((c) => ({ id: c.id, name: c.nom, status: 'active', timezone: 'Europe/Brussels', settings: null })));
  }
  if (sql === 'select center_id, email from email_identities;') {
    return lignes(IDENTITES.map((i) => ({ center_id: i.center_id, email: i.email })));
  }
  if (/^select label, email from email_identities where center_id = \$1/i.test(sql)) {
    const tri = IDENTITES.filter((i) => i.center_id === params[0])
      .sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || (a.id - b.id));
    return lignes(tri.slice(0, 1).map((i) => ({ label: i.label, email: i.email })));
  }
  if (/^update email_identities set is_default = false where center_id = \$1/i.test(sql)) {
    IDENTITES.forEach((i) => { if (i.center_id === params[0]) i.is_default = false; });
    return lignes([]);
  }
  if (/^insert into email_identities/i.test(sql)) {
    INSERTIONS_IDENTITE += 1;
    const ligne = { id: 100 + IDENTITES.length, center_id: params[0], label: params[1], email: params[2], is_default: Boolean(params[3]) };
    IDENTITES.push(ligne);
    return lignes([{ ...ligne }]);
  }
  if (/^select 1 from communications where id = \$1 and center_id = \$2 and direction = 'inbound'/i.test(sql)) {
    return lignes(COMMUNICATIONS
      .filter((c) => c.id === Number(params[0]) && c.center_id === params[1] && c.direction === 'inbound')
      .map(() => ({ un: 1 })));
  }
  if (/^insert into ops_email_claims/i.test(sql)) {
    const existante = PRISES.find((p) => p.communication_id === Number(params[0]));
    if (existante && existante.expire > Date.now() && existante.member_id !== params[2]) return lignes([]);
    const prise = {
      communication_id: Number(params[0]), center_id: params[1], member_id: params[2], member_name: params[3],
      member_role: params[5], claimed_at: new Date().toISOString(), refreshed_at: new Date().toISOString(),
      expire: Date.now() + Number(params[4]) * 1000,
    };
    if (existante) Object.assign(existante, prise); else PRISES.push(prise);
    return lignes([{ ...prise, expires_at: new Date(prise.expire).toISOString() }]);
  }
  if (/^select \* from ops_email_claims where communication_id = \$1/i.test(sql)) {
    const avecCentre = /and center_id = \$2/i.test(sql);
    return lignes(PRISES
      .filter((p) => p.communication_id === Number(params[0]) && (!avecCentre || p.center_id === params[1]))
      .map((p) => ({ ...p, expires_at: new Date(p.expire).toISOString() })));
  }
  if (/^insert into custom_requests/i.test(sql)) {
    const ligne = {
      id: 9000 + DEMANDES.length, center_id: params[0], contact_name: params[1], company: params[2], email: params[3],
      phone: params[4], requested_date: params[5], pax: params[6], occasion: params[7], message: params[8],
      source: params[9], status: params[10], payload: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    DEMANDES.push(ligne);
    return lignes([{ ...ligne }]);
  }
  return lignes([]);
}

class FakePool {
  constructor() {}
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  on() {}
  async end() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };

// LE RESEAU EST UNE SONDE : chaque envoi a Resend est capture, jamais emis.
const ENVOIS = [];
global.fetch = async (url, options = {}) => {
  let corps = null;
  try { corps = JSON.parse(options.body || '{}'); } catch (error) { corps = null; }
  ENVOIS.push({ url: String(url), corps });
  return { ok: true, status: 200, json: async () => ({ id: `gate_${ENVOIS.length}` }), text: async () => '' };
};

// ---------------------------------------------------------------------------
// MUTATIONS COMPILEES EN MEMOIRE (meme motif que dispatch-immediate-check).
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/sender-domains.js', 'lib/database.js', 'lib/ops-communications.js', 'api/public-booking-meta.js'];
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function charger() {
  for (const rel of MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
  return {
    domaines: require(path.join(ROOT, 'lib/sender-domains.js')),
    db: require(path.join(ROOT, 'lib/database.js')),
    comms: require(path.join(ROOT, 'lib/ops-communications.js')),
    publique: require(path.join(ROOT, 'api/public-booking-meta.js')),
  };
}

// L environnement HOSTILE : chaque variable globale pointe sur Fun Galaxy, comme
// si quelqu un les avait posees pour le premier client.
function environnementHostile() {
  process.env.RESEND_API_KEY = 'gate-fake-key';
  process.env.RESEND_FROM = 'Fun Galaxy <contact@pinlane.be>';
  process.env.RESEND_REPLY_TO = 'libramont@fungalaxy.be';
  process.env.STAFF_REVIEW_EMAIL = 'gembloux@fungalaxy.be';
  process.env.RESERVATION_STAFF_EMAIL = 'accueil@fungalaxy.be';
  process.env.CENTER_REPLY_TO = JSON.stringify({ 'n4-bowling': 'libramont@inbound.pinlane.be', libramont: 'libramont@inbound.pinlane.be' });
}

const FUN_GALAXY = /fun ?galaxy|fungalaxy|libramont/i;

async function essayer(fn) {
  try { return { valeur: await fn(), erreur: null }; } catch (erreur) { return { valeur: null, erreur }; }
}

async function enregistrer(m, centerId, email, { plateforme = false } = {}) {
  return essayer(() => m.db.saveEmailIdentity({ centerId, label: 'Essai', email, declarationPlateforme: plateforme }));
}

async function enveloppe(m, communication) {
  ENVOIS.length = 0;
  await m.comms.__test.sendEmail({ channel: 'email', subject: 'Votre reservation', body: '<p>Bonjour</p>', recipient: 'client@exemple.be', ...communication });
  return (ENVOIS[0] && ENVOIS[0].corps) || {};
}

async function notificationStaff(m, centerId) {
  const enfiles = [];
  await m.comms.enqueueReservationCommunications({
    id: 777, centerId, name: 'Client Essai', email: '', phone: '', date: '2026-10-01', startTime: '14:00',
    type: 'bowling', validationStatus: 'staff_review',
  }, {
    validationMode: 'staff_review',
    templatesOnly: ['staff_review_request'],
    enqueue: async (ligne) => { enfiles.push(ligne); return { id: enfiles.length }; },
    deps: { query: requete },
  });
  return enfiles.filter((l) => l.templateId === 'staff_review_request');
}

async function demandeSurMesure(m, centerId, ip) {
  ENVOIS.length = 0;
  const corps = JSON.stringify({
    kind: 'custom-request', centerId, contactName: 'Camille Essai', email: 'camille@exemple.be',
    message: 'Anniversaire pour douze enfants', occasion: 'anniversaire', pax: 12,
  });
  const req = Object.assign(Readable.from([corps]), {
    method: 'POST', url: '/api/public-booking-meta',
    headers: { host: 'app.pinlane.be', 'content-type': 'application/json', 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  });
  let rendu = '';
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(chunk) { rendu = String(chunk || ''); } };
  await m.publique(req, res);
  return { statut: res.statusCode, envoi: (ENVOIS[0] && ENVOIS[0].corps) || null, rendu };
}

async function envoiDeTest(m, centerId) {
  const enfiles = [];
  await m.comms.sendAutomationTest(
    { centerId, key: 'confirmation', member: { id: 'membre-essai', contact: 'staff@exemple.be' } },
    { deps: { query: requete }, enqueue: async (ligne) => { enfiles.push(ligne); return { id: 1 }; }, dispatch: async () => ({ results: [] }) },
  );
  return enfiles[0] || null;
}

(async () => {
  // Le moteur connait les centres de la base, comme en production.
  const knowledge = require(path.join(ROOT, 'lib/ops-knowledge'));
  await knowledge.refreshCenterOverrides({ query: requete }, { force: true });
  let n4Connu = false;
  try { n4Connu = knowledge.getCenter('n4-bowling').name === 'N4 Bowling'; } catch (erreur) { n4Connu = false; }
  ok(n4Connu, '[montage] N4 Bowling existe aux yeux du moteur (fiche chargee depuis la base)');

  // =====================================================================
  console.log('\n[A] le domaine d envoi appartient a un client');
  // =====================================================================
  etatInitial();
  let m = charger();
  const declarations = await m.domaines.chargerDeclarations(requete);
  const { expediteurAutorise } = m.domaines;
  // MONTAGE : sans ces deux faits, les refus ci-dessous ne prouveraient rien.
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge'));
  ok(/@fungalaxy\.be$/.test(String(getCenter('libramont').publicInfo.email)) && declarations.clientParCentre.get('n4-bowling') === 'n4-bowling',
    '[montage] Libramont declare une adresse publique @fungalaxy.be, et N4 Bowling est un client distinct');
  ok(expediteurAutorise('gembloux', 'reservations@fungalaxy.be', declarations),
    '[A] contraste : un centre Fun Galaxy utilise librement le domaine de SON client');
  ok(!expediteurAutorise('n4-bowling', 'libramont@fungalaxy.be', declarations),
    '[A] N4 Bowling ne peut PAS signer depuis @fungalaxy.be');
  ok(!expediteurAutorise('n4-bowling', 'x@fungalaxy.be', declarations, { declarationPlateforme: true }),
    '[A] meme la plateforme ne donne pas a un client le domaine qu un autre tient');
  ok(!expediteurAutorise('n4-bowling', 'resa@n4bowling.be', declarations)
    && expediteurAutorise('n4-bowling', 'resa@n4bowling.be', declarations, { declarationPlateforme: true }),
    '[A] un domaine neuf ne s ouvre que par la plateforme');
  ok(expediteurAutorise('n4-bowling', 'contact@pinlane.be', declarations) && expediteurAutorise('libramont', 'contact@pinlane.be', declarations),
    '[A] l adresse de la plateforme reste ouverte a tous');
  ok(!expediteurAutorise('libramont', 'libramont@inbound.pinlane.be', declarations, { declarationPlateforme: true }),
    '[A] une adresse de reception n est jamais un expediteur, meme pour son propre centre');
  ok(m.domaines.adresseDePlateforme('Fun Galaxy <contact@pinlane.be>') === 'contact@pinlane.be'
    && m.domaines.adresseDePlateforme('libramont@fungalaxy.be') === ''
    && m.domaines.adresseDePlateforme('libramont@inbound.pinlane.be') === '',
    '[A] une variable globale ne garde que l ADRESSE, et seulement si elle est de la plateforme');

  // =====================================================================
  console.log('\n[A2] la porte d enregistrement (saveEmailIdentity, le vrai)');
  // =====================================================================
  etatInitial();
  m = charger();
  const vol = await enregistrer(m, 'n4-bowling', 'libramont@fungalaxy.be');
  ok(Boolean(vol.erreur) && vol.erreur.expose === true && INSERTIONS_IDENTITE === 0,
    '[A2] le gerant de N4 Bowling qui saisit libramont@fungalaxy.be est refuse, rien n est ecrit', vol.erreur ? vol.erreur.message : 'accepte');
  const inconnu = await enregistrer(m, 'n4-bowling', 'resa@n4bowling.be');
  ok(Boolean(vol.erreur) && Boolean(inconnu.erreur) && vol.erreur.message === inconnu.erreur.message && !FUN_GALAXY.test(vol.erreur.message) && !/autre/i.test(vol.erreur.message),
    '[A2] le refus ne trahit rien : meme message pour le domaine d un autre client que pour un domaine jamais declare');
  const ouverture = await enregistrer(m, 'n4-bowling', 'resa@n4bowling.be', { plateforme: true });
  const suite = await enregistrer(m, 'n4-bowling', 'accueil@n4bowling.be');
  ok(!ouverture.erreur && !suite.erreur,
    '[A2] contraste : la plateforme ouvre n4bowling.be, puis le gerant de N4 y ajoute ses adresses', ouverture.erreur ? ouverture.erreur.message : (suite.erreur ? suite.erreur.message : ''));
  const retour = await enregistrer(m, 'gembloux', 'x@n4bowling.be');
  ok(Boolean(retour.erreur), '[A2] et Fun Galaxy ne peut pas prendre le domaine de N4 en retour (la regle est symetrique)');
  const funGalaxy = await enregistrer(m, 'gembloux', 'reservations@fungalaxy.be');
  ok(!funGalaxy.erreur, '[A2] contraste : Fun Galaxy Gembloux enregistre reservations@fungalaxy.be', funGalaxy.erreur ? funGalaxy.erreur.message : '');

  // =====================================================================
  console.log('\n[B] les variables globales ne designent que la plateforme');
  // =====================================================================
  etatInitial();
  environnementHostile();
  m = charger();
  const n4 = await enveloppe(m, { centerId: 'n4-bowling' });
  ok(/<contact@pinlane\.be>$/.test(String(n4.from)) && !FUN_GALAXY.test(String(n4.from)),
    '[B] un mail de N4 Bowling part de l adresse plateforme, sans le nom Fun Galaxy pose dans RESEND_FROM', `from=${n4.from}`);
  ok(!FUN_GALAXY.test(String(n4.reply_to || '')) && String(n4.reply_to || '') !== 'libramont@inbound.pinlane.be',
    '[B] ses clients ne repondent ni a Fun Galaxy (RESEND_REPLY_TO) ni dans la boite de reception de Libramont (CENTER_REPLY_TO)', `reply_to=${n4.reply_to || 'aucun'}`);
  const libramont = await enveloppe(m, { centerId: 'libramont', payload: { fromEmail: 'libramont@fungalaxy.be', fromLabel: 'Fun Galaxy Libramont' } });
  ok(libramont.from === 'Fun Galaxy Libramont <libramont@fungalaxy.be>' && libramont.reply_to === 'libramont@inbound.pinlane.be',
    '[B] contraste : Libramont signe de SON adresse et ses reponses reviennent dans SA boite Pinlane', `from=${libramont.from} reply_to=${libramont.reply_to}`);

  // =====================================================================
  console.log('\n[C] la notification de validation staff');
  // =====================================================================
  // STAFF_REVIEW_EMAIL EXISTE en production (noms des variables Vercel relus le
  // 2026-09-16, valeur jamais lue). La regle doit donc tenir QUELLE QUE SOIT sa
  // valeur : Fun Galaxy garde ses notifications si elle est a lui, et aucun
  // autre client n y envoie les siennes.
  const staffHostile = await notificationStaff(m, 'n4-bowling');
  ok(staffHostile.length === 0,
    '[C] une reservation de N4 Bowling n envoie PAS ses coordonnees a une boite staff Fun Galaxy posee en global', JSON.stringify(staffHostile.map((l) => l.recipient)));
  const staffProprietaire = await notificationStaff(m, 'libramont');
  ok(staffProprietaire.length === 1 && staffProprietaire[0].recipient === 'gembloux@fungalaxy.be',
    '[C] contraste : la MEME boite continue de recevoir les validations de Fun Galaxy, a qui elle appartient', JSON.stringify(staffProprietaire.map((l) => l.recipient)));
  process.env.STAFF_REVIEW_EMAIL = 'equipe@pinlane.be';
  const staffPlateforme = await notificationStaff(m, 'n4-bowling');
  ok(staffPlateforme.length === 1 && staffPlateforme[0].recipient === 'equipe@pinlane.be',
    '[C] contraste : une boite de la plateforme recoit les validations de tous les centres', JSON.stringify(staffPlateforme.map((l) => l.recipient)));
  process.env.STAFF_REVIEW_EMAIL = 'gembloux@fungalaxy.be';

  // =====================================================================
  console.log('\n[D] un mail sans centre, et la demande sur mesure du tunnel public');
  // =====================================================================
  const sansCentre = await enveloppe(m, {});
  ok(!FUN_GALAXY.test(String(sansCentre.from)) && !FUN_GALAXY.test(String(sansCentre.reply_to || '')),
    '[D] un mail parti sans centre n est signe par aucun centre, et ses reponses ne vont chez aucun', `from=${sansCentre.from} reply_to=${sansCentre.reply_to || 'aucun'}`);
  const dGembloux = await demandeSurMesure(m, 'gembloux', '203.0.113.11');
  ok(dGembloux.statut === 201 && Boolean(dGembloux.envoi), '[montage] la route publique enregistre la demande et envoie l accuse', `HTTP ${dGembloux.statut}`);
  ok(Boolean(dGembloux.envoi) && dGembloux.envoi.from === 'Fun Galaxy Gembloux <gembloux@fungalaxy.be>' && dGembloux.envoi.reply_to === 'gembloux@fungalaxy.be',
    '[D] contraste : la demande faite a Gembloux est accusee PAR Gembloux, et la reponse du client arrive a Gembloux (plus a Libramont)',
    dGembloux.envoi ? `from=${dGembloux.envoi.from} reply_to=${dGembloux.envoi.reply_to}` : '');
  const dN4 = await demandeSurMesure(m, 'n4-bowling', '203.0.113.12');
  const accuseN4 = dN4.envoi ? `${dN4.envoi.from}\n${dN4.envoi.reply_to || ''}\n${dN4.envoi.subject}\n${dN4.envoi.html}` : '';
  ok(dN4.statut === 201 && Boolean(dN4.envoi) && !FUN_GALAXY.test(accuseN4),
    '[D] la demande faite a N4 Bowling : AUCUNE trace de Fun Galaxy dans l en-tete, la reponse ou le contenu de l accuse',
    dN4.envoi ? `from=${dN4.envoi.from} reply_to=${dN4.envoi.reply_to || 'aucun'}` : `HTTP ${dN4.statut}`);

  // =====================================================================
  console.log('\n[E] la prise de main sur un mail recu');
  // =====================================================================
  etatInitial();
  m = charger();
  const priseEtrangere = await m.db.claimEmailThread({ communicationId: 501, centerId: 'n4-bowling', memberId: 'n4-direction', memberName: 'Inconnu N4', memberRole: 'Direction' });
  ok(priseEtrangere.ok === false && priseEtrangere.reason === 'communication_invalide' && PRISES.length === 0,
    '[E] le staff de N4 Bowling ne pose AUCUNE prise sur un mail de Libramont (reponse d un numero invalide)', JSON.stringify(priseEtrangere));
  const priseLegitime = await m.db.claimEmailThread({ communicationId: 501, centerId: 'libramont', memberId: 'libramont-sophie', memberName: 'Sophie', memberRole: 'Manager' });
  ok(priseLegitime.ok === true, '[E] contraste : l equipe de Libramont prend bien son propre mail');
  const priseApres = await m.db.claimEmailThread({ communicationId: 501, centerId: 'n4-bowling', memberId: 'n4-direction', memberName: 'Inconnu N4', memberRole: 'Direction' });
  ok(priseApres.ok === false && !priseApres.claim && !/Sophie/.test(JSON.stringify(priseApres)),
    '[E] et le refus ne renvoie pas a N4 le nom de qui ecrit chez Fun Galaxy', JSON.stringify(priseApres));

  // =====================================================================
  console.log('\n[F] l envoi de test part comme le vrai mail');
  // =====================================================================
  const testLibramont = await envoiDeTest(m, 'libramont');
  ok(Boolean(testLibramont) && testLibramont.payload.fromEmail === 'libramont@fungalaxy.be',
    '[F] le test de Libramont porte l identite de Libramont, comme ses vrais mails', testLibramont ? JSON.stringify({ fromEmail: testLibramont.payload.fromEmail }) : 'rien en file');
  const testN4 = await envoiDeTest(m, 'n4-bowling');
  ok(Boolean(testN4) && !testN4.payload.fromEmail,
    '[F] contraste : le test de N4 Bowling n herite d aucune identite de Fun Galaxy', testN4 ? JSON.stringify({ fromEmail: testN4.payload.fromEmail || null }) : 'rien en file');

  // =====================================================================
  console.log('\n[mutation] contre-epreuves (le gate ROUGIRAIT sans chaque garde)');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'un client peut prendre le domaine d un autre',
      fichier: 'lib/sender-domains.js',
      de: '    if (client !== moi && domaines.has(domaine)) return false;',
      vers: '    if (false) return false;',
      rejouer: async (mm) => enregistrer(mm, 'n4-bowling', 'x@fungalaxy.be', { plateforme: true }),
      rouge: (r) => !r.erreur,
    },
    {
      nom: 'un domaine neuf s ouvre sans la plateforme',
      fichier: 'lib/sender-domains.js',
      de: '  return Boolean(miens && miens.has(domaine));',
      vers: '  return true;',
      rejouer: async (mm) => enregistrer(mm, 'n4-bowling', 'resa@n4bowling.be'),
      rouge: (r) => !r.erreur,
    },
    {
      nom: 'la porte d enregistrement ne verifie plus le domaine',
      fichier: 'lib/database.js',
      de: '  if (!autorise) {',
      vers: '  if (false) {',
      rejouer: async (mm) => { await enregistrer(mm, 'n4-bowling', 'libramont@fungalaxy.be'); return INSERTIONS_IDENTITE; },
      rouge: (insertions) => insertions > 0,
    },
    {
      nom: 'RESEND_FROM est repris tel quel',
      fichier: 'lib/ops-communications.js',
      de: "  const configuredFrom = payloadFrom || adresseDePlateforme(process.env.RESEND_FROM) || 'onboarding@resend.dev';",
      vers: "  const configuredFrom = payloadFrom || process.env.RESEND_FROM || 'onboarding@resend.dev';",
      rejouer: async (mm) => enveloppe(mm, { centerId: 'n4-bowling' }),
      rouge: (e) => FUN_GALAXY.test(String(e.from)),
    },
    {
      nom: 'RESEND_REPLY_TO est repris tel quel',
      fichier: 'lib/ops-communications.js',
      de: '    adresseDePlateforme(process.env.RESEND_REPLY_TO),',
      vers: '    process.env.RESEND_REPLY_TO,',
      rejouer: async (mm) => enveloppe(mm, { centerId: 'n4-bowling' }),
      rouge: (e) => FUN_GALAXY.test(String(e.reply_to || '')),
    },
    {
      nom: 'une adresse de reception vaut pour n importe quel centre',
      fichier: 'lib/ops-communications.js',
      de: "  return adresseDeReceptionDUnAutreCentre(centre, adresse) ? '' : adresse;",
      vers: '  return adresse;',
      rejouer: async (mm) => enveloppe(mm, { centerId: 'n4-bowling' }),
      rouge: (e) => e.reply_to === 'libramont@inbound.pinlane.be',
    },
    {
      nom: 'la boite staff globale recoit les validations de tous les clients',
      fichier: 'lib/ops-communications.js',
      de: '    && !(await boiteStaffDUnAutreClient(centerId, staffEmail, deps))) {',
      vers: '    ) {',
      rejouer: async (mm) => notificationStaff(mm, 'n4-bowling'),
      rouge: (l) => l.some((x) => FUN_GALAXY.test(String(x.recipient))),
    },
    {
      nom: 'la boite staff est tenue pour etrangere a son propre client',
      fichier: 'lib/sender-domains.js',
      de: '    if (client !== moi && domaines.has(domaine)) return true;',
      vers: '    if (domaines.has(domaine)) return true;',
      rejouer: async (mm) => notificationStaff(mm, 'libramont'),
      rouge: (l) => l.length === 0,
    },
    {
      nom: 'un mail sans centre reprend l adresse de Libramont',
      fichier: 'lib/ops-communications.js',
      de: "  if (!String(centerId || '').trim()) return '';",
      vers: '',
      rejouer: async (mm) => enveloppe(mm, {}),
      rouge: (e) => FUN_GALAXY.test(String(e.reply_to || '')),
    },
    {
      nom: 'un mail sans centre reprend le nom de Libramont',
      fichier: 'lib/ops-communications.js',
      de: "  const centerLabel = (communication.centerId ? centerOrNull(communication.centerId)?.name : '') || 'Pinlane';",
      vers: "  const centerLabel = centerOrNull(communication.centerId)?.name || 'Pinlane';",
      rejouer: async (mm) => enveloppe(mm, {}),
      rouge: (e) => FUN_GALAXY.test(String(e.from)),
    },
    {
      nom: 'la route publique ne transmet plus le centre a l accuse',
      fichier: 'api/public-booking-meta.js',
      de: '    centerId,\n    id: lead.id,',
      vers: '    id: lead.id,',
      rejouer: async (mm) => demandeSurMesure(mm, 'gembloux', '203.0.113.21'),
      rouge: (r) => !r.envoi || r.envoi.from !== 'Fun Galaxy Gembloux <gembloux@fungalaxy.be>',
    },
    {
      nom: 'la prise ne verifie plus a qui appartient le mail',
      fichier: 'lib/database.js',
      de: "  if (!appartient.rows.length) return { ok: false, reason: 'communication_invalide' };",
      vers: '',
      rejouer: async (mm) => mm.db.claimEmailThread({ communicationId: 501, centerId: 'n4-bowling', memberId: 'n4-direction', memberName: 'Inconnu N4', memberRole: 'Direction' }),
      rouge: (r) => r.ok === true,
    },
    {
      nom: 'l envoi de test repart sans l identite du centre',
      fichier: 'lib/ops-communications.js',
      de: '    payload: { textBody: preview.textBody, test: true, sequence: key, ...sender },',
      vers: '    payload: { textBody: preview.textBody, test: true, sequence: key },',
      rejouer: async (mm) => envoiDeTest(mm, 'libramont'),
      rouge: (l) => !l || l.payload.fromEmail !== 'libramont@fungalaxy.be',
    },
  ];
  for (const c of contreEpreuves) {
    etatInitial();
    environnementHostile();
    let verdict = false;
    try {
      mutations = [{ fichier: c.fichier, de: c.de, vers: c.vers }];
      const mm = charger();
      verdict = c.rouge(await c.rejouer(mm));
    } catch (erreur) {
      verdict = false;
      console.log(`      (contre-epreuve impossible : ${erreur.message})`);
    } finally {
      mutations = [];
    }
    ok(verdict, `[mutation] « ${c.nom} » (le gate ROUGIRAIT)`);
  }
  charger();
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error('FAIL  gate interrompu :', (erreur && erreur.stack) || erreur);
  process.exit(1);
});
