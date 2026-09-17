// UN MAIL RECU N ENTRE QUE S IL VIENT VRAIMENT DE NOTRE FOURNISSEUR.
//
// POURQUOI CE GATE EXISTE (2026-09-06). Le point d entree /api/inbound-email
// n acceptait qu un en-tete maison, `x-inbound-secret`. Resend ne sait pas
// l envoyer : il SIGNE chaque appel (en-tetes `svix-id`, `svix-timestamp`,
// `svix-signature`). Brancher la reception voulait donc dire, soit refuser tous
// ses appels, soit ouvrir la porte a tout le monde. Or cette porte ECRIT dans
// la base et fait tourner l agent : n importe qui pourrait remplir la page
// Emails d un centre avec ce qu il veut.
//
// LES HUIT PROPRIETES :
//
//   [A] UN APPEL SIGNE PAR NOTRE FOURNISSEUR ENTRE. Signature calculee sur le
//       corps EXACT (id.horodatage.corps, HMAC-SHA256, base64) : le mail est
//       ingere, la reponse est 200.
//
//   [G] LE CORPS DU MAIL SE VA CHERCHER. Mesure du 2026-09-06 sur un vrai
//       mail : l enveloppe du webhook porte l expediteur, le destinataire, le
//       sujet et un IDENTIFIANT, et RIEN du contenu (le fournisseur l a voulu
//       ainsi pour que la requete reste petite). Chaque mail entrant etait donc
//       refuse en 400 « from et text requis ». Le contenu se recupere avec cet
//       identifiant ; un mail sans texte brut rend son HTML deshabille ; et si
//       la lecture echoue, la reponse est 503 pour que le fournisseur REESSAIE,
//       jamais 400 qui dirait « ce mail est mauvais ».
//
//   [H] LIRE ET ENVOYER SONT DEUX DROITS SEPARES. Mesure du 2026-09-06 sur la
//       production : la cle qui envoie nos mails est restreinte a l envoi, et le
//       fournisseur repond « This API key is restricted to only send emails »
//       quand on lui demande le contenu d un mail recu. La lecture prend donc sa
//       PROPRE cle (RESEND_INBOUND_API_KEY), et l envoi garde la sienne, qui
//       reste restreinte. Sans cle dediee on retombe sur celle d envoi, pour ne
//       pas casser une installation qui n en a qu une. Et quand le fournisseur
//       refuse, SA PHRASE remonte : c est elle qui a tranche ici, la ou
//       « lecture impossible » n apprenait rien.
//
//   [J] LE SUJET N EST UN DERNIER RECOURS QU APRES AVOIR CHERCHE LE CORPS.
//       Un mail reellement vide de corps existe (le tout est dans l objet) : le
//       refuser ferait perdre un vrai client. Mais un envoi qui n a NI corps NI
//       identifiant a aller chercher est un envoi incomplet, et l accepter en
//       recopiant son objet ferait entrer dans la boite un message dont personne
//       n a le contenu, sans que rien ne le signale. La difference n est pas
//       cosmetique : d un cote on a interroge le fournisseur et il a repondu
//       « vide », de l autre on n a jamais rien demande.
//
//   [B] TOUT LE RESTE EST REFUSE, EN 401, SANS RIEN ECRIRE. Pas de signature,
//       signature d un autre secret, corps modifie apres signature, en-tetes
//       partiels : dans les quatre cas, l ingestion n est jamais appelee.
//
//   [C] UN APPEL REJOUE EST REFUSE. Un appel valide capture puis renvoye une
//       heure plus tard ne passe pas : l horodatage sort de la tolerance.
//
//   [D] LE MAIL ARRIVE CHEZ LE CENTRE QUI L A RECU, ET CHEZ AUCUN AUTRE. Le
//       centre se lit sur l ADRESSE DESTINATAIRE, en lisant TOUTES les sources
//       (received_for, puis to), mais une adresse ne designe un centre que sur
//       NOTRE domaine de reception (`gembloux@inbound.pinlane.be`) ou si elle
//       est EXACTEMENT l adresse publique du centre (`gembloux@fungalaxy.be`) :
//       `gembloux@un-autre-bowling.be` ne classe rien chez Fun Galaxy. Plus de
//       centre par defaut (2026-09-16) : avec plusieurs clients, le courrier
//       non reconnu de TOUS atterrissait chez libramont ; il n est plus classe
//       nulle part, et l avertissement nomme les adresses. Le parametre d URL
//       ne sert plus qu aux essais de la plateforme, derriere le secret maison :
//       l URL du webhook est la meme pour tous les clients. L adresse recue et
//       le mode de routage partent a l ingestion.
//
//   [F] UN EVENEMENT QUI N EST PAS UNE RECEPTION N EST JAMAIS INGERE, MEME
//       SIGNE ET MEME S IL EN A L AIR. Un compte abonne a tous les evenements
//       (envoi, remise, rebond, plainte) nous envoie NOS PROPRES messages avec
//       la meme signature : les ingerer remplirait la page Emails de nos
//       envois, a l envers. Ils sont acquittes en 200 pour que le fournisseur
//       ne les rejoue pas, sans rien ecrire dans la boite de reception. Depuis
//       le 2026-09-16 ils sont ENREGISTRES comme evenements de suivi (remis,
//       ouvert, rebond : lib/email-events.js, gate email-events-check.js) :
//       ici l enregistrement est un espion, et on prouve qu il recoit
//       l evenement pendant que l ingestion ne recoit rien.
//
//   [E] LE CHEMIN MANUEL SURVIT. L en-tete `x-inbound-secret` continue de
//       fonctionner (c est lui qui permet de tester tout le circuit sans DNS),
//       et aucun secret n apparait dans une reponse d erreur.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile, le disque n est jamais touche).
//
// Usage : node scripts/inbound-webhook-check.js
'use strict';
const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const SECRET_MANUEL = 'secret-maison-pour-les-tests';
const SECRET_WEBHOOK = `whsec_${Buffer.from('cle-de-signature-du-fournisseur-2026').toString('base64')}`;
const AUTRE_SECRET = `whsec_${Buffer.from('la-cle-de-quelqu-un-d-autre-2026').toString('base64')}`;
process.env.INBOUND_EMAIL_SECRET = SECRET_MANUEL;
process.env.RESEND_WEBHOOK_SECRET = SECRET_WEBHOOK;

// ---------------------------------------------------------------------------
// LA SIGNATURE, ECRITE ICI D APRES LA SPECIFICATION, jamais importee du code
// mesure : un gate qui appellerait la fonction du produit pour fabriquer sa
// preuve validerait n importe quel bug present des deux cotes.
// ---------------------------------------------------------------------------
function signer(corps, { id = 'msg_2026', horodatage = Math.floor(Date.now() / 1000), secret = SECRET_WEBHOOK } = {}) {
  const cle = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signature = crypto.createHmac('sha256', cle).update(`${id}.${horodatage}.${corps}`).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': String(horodatage),
    'svix-signature': `v1,${signature}`,
  };
}

// ---------------------------------------------------------------------------
// LE MODULE MESURE, mutable en memoire.
// ---------------------------------------------------------------------------
const CIBLE = 'api/inbound-email.js';
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function chargerHandler(ingest, recupererContenu, enregistrerEvenement) {
  delete require.cache[require.resolve(path.join(ROOT, CIBLE))];
  const { createHandler } = require(path.join(ROOT, CIBLE));
  // L enregistrement des evenements du fournisseur (sent, delivered, bounced,
  // complained) ecrit en base : il est remplace par un espion, sa logique a son
  // propre gate (scripts/email-events-check.js). Ici la question est le
  // ROUTAGE : un evenement va au suivi, jamais a l ingestion.
  return createHandler({ ingest, recupererContenu, enregistrerEvenement });
}

// ---------------------------------------------------------------------------
// UN APPEL HTTP, sans reseau : le handler est le VRAI, req et res sont ceux
// qu il recevrait de la plateforme.
// ---------------------------------------------------------------------------
async function appeler({ corps, entetes = {}, requete = '/api/inbound-email', methode = 'POST', ingest = null, contenu = null } = {}) {
  const appels = [];
  const lectures = [];
  const evenements = [];
  const ingestion = ingest || (async (args) => { appels.push(args); return { communication: { id: 1 }, deduped: false }; });
  const handler = chargerHandler(async (args) => {
    appels.push(args);
    return ingestion === ingest ? ingestion(args) : { communication: { id: 1 }, deduped: false };
  }, async (emailId) => {
    lectures.push(emailId);
    if (typeof contenu === 'function') return contenu(emailId);
    if (contenu === 'echec') { const e = new Error('lecture refusee'); e.statusCode = 503; throw e; }
    return contenu || { text: 'Bonjour, avez-vous de la place ?', html: '' };
  }, async (args) => {
    evenements.push(args);
    return { ok: true, deduped: false, type: String(args.type || '').replace(/^email\./, '') };
  });
  const req = Object.assign(Readable.from([corps]), {
    method: methode,
    url: requete,
    headers: { host: 'app.pinlane.be', 'content-type': 'application/json', ...entetes },
  });
  let statut = 0;
  let rendu = '';
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) { rendu = String(chunk || ''); statut = res.statusCode; },
  };
  await handler(req, res);
  let corpsRendu = null;
  try { corpsRendu = JSON.parse(rendu); } catch (error) { corpsRendu = { brut: rendu }; }
  return { statut: statut || res.statusCode, corps: corpsRendu, appels, lectures, evenements };
}

// L ENVELOPPE REELLE, relevee sur la production le 2026-09-06 : elle ne porte
// AUCUN corps, seulement l identifiant du mail. C est la forme que le gate doit
// mesurer ; l ancienne fixture (avec un champ texte) validait un monde qui
// n existe pas.
function payload({ to = ['libramont@inbound.pinlane.be'], receivedFor, from = 'marie@exemple.be', subject = 'Anniversaire samedi', emailId = '7865d93e-c9e6-42a9-9ef2-8d92e09ecc06' } = {}) {
  return JSON.stringify({
    type: 'email.received',
    created_at: '2026-09-06T18:10:40.000Z',
    data: {
      attachments: [], bcc: [], cc: [],
      created_at: '2026-09-06T18:10:54.274Z',
      email_id: emailId,
      from,
      message_id: '<CA+q0sthV3rFhsMJ8J4xCJT@mail.gmail.com>',
      received_for: receivedFor === undefined ? to : receivedFor,
      subject,
      to,
    },
  });
}

(async () => {
  // =====================================================================
  console.log('[A] un appel signe par notre fournisseur entre');
  // =====================================================================
  const corps = payload();
  const bon = await appeler({ corps, entetes: signer(corps) });
  ok(bon.statut === 200 && bon.corps.ok === true, '[A] un appel signe est accepte', `HTTP ${bon.statut} ${JSON.stringify(bon.corps)}`);
  ok(bon.appels.length === 1 && bon.appels[0].from === 'marie@exemple.be' && /place/.test(bon.appels[0].body),
    '[A] le mail est bien remis a l ingestion, expediteur et texte compris', JSON.stringify(bon.appels[0] && { from: bon.appels[0].from, subject: bon.appels[0].subject }));

  // =====================================================================
  console.log('\n[B] tout le reste est refuse, sans rien ecrire');
  // =====================================================================
  const cas = [
    { nom: 'aucune signature, aucun en-tete maison', entetes: {} },
    { nom: 'signature calculee avec un AUTRE secret', entetes: signer(corps, { secret: AUTRE_SECRET }) },
    { nom: 'signature valide mais corps MODIFIE apres coup', entetes: signer(payload({ subject: 'autre chose' })) },
    { nom: 'en-tetes partiels (horodatage manquant)', entetes: (() => { const e = signer(corps); delete e['svix-timestamp']; return e; })() },
    { nom: 'en-tete maison avec la mauvaise valeur', entetes: { 'x-inbound-secret': 'pas-le-bon' } },
  ];
  for (const c of cas) {
    const r = await appeler({ corps, entetes: c.entetes });
    ok(r.statut === 401 && r.appels.length === 0, `[B] ${c.nom} : refuse en 401, rien n est ecrit`, `HTTP ${r.statut}, ${r.appels.length} ecriture(s)`);
  }

  // =====================================================================
  console.log('\n[C] un appel rejoue est refuse');
  // =====================================================================
  const vieux = signer(corps, { horodatage: Math.floor(Date.now() / 1000) - 3600 });
  const rejeu = await appeler({ corps, entetes: vieux });
  ok(rejeu.statut === 401 && rejeu.appels.length === 0, '[C] un appel valide rejoue une heure plus tard ne passe pas', `HTTP ${rejeu.statut}`);
  const frais = signer(corps, { horodatage: Math.floor(Date.now() / 1000) - 60 });
  const recent = await appeler({ corps, entetes: frais });
  ok(recent.statut === 200, '[C] un appel d il y a une minute passe (la tolerance n est pas nulle)', `HTTP ${recent.statut}`);

  // =====================================================================
  console.log('\n[D] le mail arrive chez le centre qui l a recu');
  // =====================================================================
  const versGembloux = payload({ to: ['gembloux@inbound.pinlane.be'] });
  const g = await appeler({ corps: versGembloux, entetes: signer(versGembloux) });
  ok(g.appels[0] && g.appels[0].centerId === 'gembloux', '[D] gembloux@... arrive chez Gembloux', g.appels[0] && g.appels[0].centerId);
  ok(bon.appels[0] && bon.appels[0].centerId === 'libramont', '[D] libramont@... arrive chez Libramont (ce n est pas une constante)', bon.appels[0] && bon.appels[0].centerId);
  const force = await appeler({ corps: versGembloux, entetes: signer(versGembloux), requete: '/api/inbound-email?centerId=libramont' });
  // POURQUOI L ADRESSE PRIME SUR LE PARAMETRE D URL (2026-09-08). Un seul
  // webhook sert tous les centres. Si son URL porte `?centerId=libramont`, un
  // parametre prioritaire classe a Libramont TOUT ce qui arrive, Gembloux
  // compris, sans erreur ni trace. Mesure sur la production : 5 mails recus,
  // 5 classes libramont, destinataire stocke nulle part. Le parametre ne sert
  // plus que quand aucune adresse ne designe un centre.
  ok(force.appels[0] && force.appels[0].centerId === 'gembloux', '[D] l ADRESSE prime sur le parametre d URL : un webhook fige sur libramont ne detourne pas Gembloux', force.appels[0] && force.appels[0].centerId);
  const forceEssai = await appeler({ corps: versGembloux, entetes: { 'x-inbound-secret': SECRET_MANUEL }, requete: '/api/inbound-email?centerId=libramont' });
  ok(forceEssai.appels[0] && forceEssai.appels[0].centerId === 'gembloux', '[D] meme sur le chemin d essai (secret maison), l ADRESSE prime sur le parametre d URL', forceEssai.appels[0] && forceEssai.appels[0].centerId);
  // PLUS DE CENTRE PAR DEFAUT (2026-09-16). Le courrier qu aucune adresse ne
  // rattache a un centre etait classe chez libramont : avec plusieurs clients,
  // celui de TOUS atterrissait chez Fun Galaxy. La redirection garde sa copie
  // dans la boite du centre : ne rien classer ne perd rien.
  const inventé = payload({ to: ['nimportequoi@inbound.pinlane.be'] });
  const inc = await appeler({ corps: inventé, entetes: signer(inventé) });
  ok(inc.statut === 200 && inc.appels.length === 0 && inc.corps.ignored === 'destinataire-inconnu',
    '[D] une adresse qui ne designe aucun centre n est classee NULLE PART (ni centre invente, ni centre par defaut)', `HTTP ${inc.statut}, ${inc.appels.length} ecriture(s), ${JSON.stringify(inc.corps)}`);
  const faux = await appeler({ corps, entetes: signer(corps), requete: '/api/inbound-email?centerId=centre-qui-n-existe-pas' });
  ok(faux.appels[0] && faux.appels[0].centerId === 'libramont', '[D] un parametre d URL qui ne designe aucun centre est ignore, pas ecrit tel quel', faux.appels[0] && faux.appels[0].centerId);
  // LE PARAMETRE D URL NE CLASSE PLUS UN VRAI MAIL DU FOURNISSEUR : l URL du
  // webhook est la meme pour tous les clients, elle ne designe personne.
  const inconnu = payload({ to: ['nimportequoi@inbound.pinlane.be'] });
  const parametreSeul = await appeler({ corps: inconnu, entetes: signer(inconnu), requete: '/api/inbound-email?centerId=gembloux' });
  ok(parametreSeul.statut === 200 && parametreSeul.appels.length === 0, '[D] sur un mail signe du fournisseur, le parametre d URL ne classe rien', `HTTP ${parametreSeul.statut}, ${parametreSeul.appels.length} ecriture(s)`);
  // Il reste l outil d essai de la plateforme, derriere le secret maison.
  const essai = await appeler({ corps: inconnu, entetes: { 'x-inbound-secret': SECRET_MANUEL }, requete: '/api/inbound-email?centerId=gembloux' });
  ok(essai.appels[0] && essai.appels[0].centerId === 'gembloux', '[D] avec le secret maison, le parametre d URL sert encore aux essais de la plateforme', essai.appels[0] && essai.appels[0].centerId);
  // LE DOMAINE COMPTE. Un autre client peut avoir un centre dans la meme ville :
  // son `gembloux@...` ne doit rien classer chez Fun Galaxy Gembloux.
  const autreClient = payload({ to: ['gembloux@un-autre-bowling.be'], receivedFor: ['boite@inbound.pinlane.be'] });
  const ac = await appeler({ corps: autreClient, entetes: signer(autreClient) });
  ok(ac.statut === 200 && ac.appels.length === 0, '[D] gembloux@un-autre-bowling.be ne classe rien chez Fun Galaxy Gembloux (seule notre adresse de reception, ou l adresse publique EXACTE du centre, designe un centre)', `HTTP ${ac.statut}, ${ac.appels.length} ecriture(s)${ac.appels[0] ? ` chez ${ac.appels[0].centerId}` : ''}`);
  // LE MAIL TRANSFERE PAR L HEBERGEUR DU CENTRE. L en-tete `to` garde l adresse
  // d origine (gembloux@fungalaxy.be) ; `received_for` porte celle a laquelle
  // le fournisseur l a accepte. Selon le chemin, l une ou l autre nomme le
  // centre : toutes les sources se lisent, dans l ordre.
  const transfere = payload({ to: ['gembloux@fungalaxy.be'], receivedFor: ['gembloux@inbound.pinlane.be'] });
  const t = await appeler({ corps: transfere, entetes: signer(transfere) });
  ok(t.appels[0] && t.appels[0].centerId === 'gembloux', '[D] un mail transfere par l hebergeur (to = adresse d origine) arrive chez Gembloux', t.appels[0] && t.appels[0].centerId);
  const generique = payload({ to: ['gembloux@fungalaxy.be'], receivedFor: ['boite@inbound.pinlane.be'] });
  const gen = await appeler({ corps: generique, entetes: signer(generique) });
  ok(gen.appels[0] && gen.appels[0].centerId === 'gembloux', '[D] received_for generique : l en-tete to est lu a son tour, le centre n est pas perdu', gen.appels[0] && gen.appels[0].centerId);
  // LE DESTINATAIRE ET LE MODE DE ROUTAGE SONT TRANSMIS. Sans eux, un mail mal
  // classe ne se distingue en rien d un mail bien classe, et personne ne peut
  // le prouver apres coup.
  ok(g.appels[0] && g.appels[0].to === 'gembloux@inbound.pinlane.be' && g.appels[0].routage === 'destinataire', '[D] l ingestion recoit l adresse qui a decide et le mode « destinataire »', JSON.stringify(g.appels[0] && { to: g.appels[0].to, routage: g.appels[0].routage }));
  ok(essai.appels[0] && essai.appels[0].routage === 'parametre', '[D] un centre venu du parametre d URL est marque « parametre »', essai.appels[0] && essai.appels[0].routage);
  // UN MAIL NON CLASSE SE DIT. Il laisse une ligne dans le journal, avec les
  // adresses recues : c est la seule chose qu on verra de l exterieur.
  async function appelerEnEcoutant(options) {
    const avertissements = [];
    const warnOriginal = console.warn;
    console.warn = (...args) => { avertissements.push(args.map(String).join(' ')); };
    try { await appeler(options); } finally { console.warn = warnOriginal; }
    return avertissements;
  }
  const avertis = await appelerEnEcoutant({ corps: inconnu, entetes: signer(inconnu) });
  ok(avertis.some((l) => /NON classe/.test(l) && /nimportequoi@inbound[.]pinlane[.]be/.test(l)), '[D] un mail non classe ecrit un avertissement qui nomme l adresse recue', JSON.stringify(avertis));
  const silencieux = await appelerEnEcoutant({ corps: versGembloux, entetes: signer(versGembloux) });
  ok(silencieux.length === 0, '[D] un mail bien route n ecrit aucun avertissement', JSON.stringify(silencieux));

  // =====================================================================
  console.log('\n[E] le chemin manuel survit, et aucun secret ne fuit');
  // =====================================================================
  const manuel = await appeler({ corps, entetes: { 'x-inbound-secret': SECRET_MANUEL } });
  ok(manuel.statut === 200 && manuel.appels.length === 1, '[E] l en-tete maison continue de fonctionner (tester sans DNS)', `HTTP ${manuel.statut}`);
  const refus = await appeler({ corps, entetes: {} });
  const trace = JSON.stringify(refus.corps);
  ok(!trace.includes(SECRET_MANUEL) && !trace.includes(SECRET_WEBHOOK) && !trace.includes('whsec_'),
    '[E] la reponse de refus ne contient aucun secret', trace.slice(0, 90));
  const mauvaise = await appeler({ corps: '{ ceci n est pas du json', entetes: signer('{ ceci n est pas du json') });
  ok(mauvaise.statut === 400, '[E] un corps illisible est refuse en 400, pas en 500', `HTTP ${mauvaise.statut}`);
  const enGet = await appeler({ corps, entetes: signer(corps), methode: 'GET' });
  ok(enGet.statut === 405, '[E] une methode autre que POST est refusee', `HTTP ${enGet.statut}`);

  // =====================================================================
  console.log('\n[G] le corps du mail se va chercher');
  // =====================================================================
  ok(bon.lectures.length === 1 && bon.lectures[0] === '7865d93e-c9e6-42a9-9ef2-8d92e09ecc06',
    '[G] le contenu est reclame avec l identifiant recu dans l enveloppe', JSON.stringify(bon.lectures));
  ok(bon.appels[0] && /place/.test(bon.appels[0].body),
    '[G] le texte recupere est celui qui part a l ingestion', JSON.stringify(bon.appels[0] && bon.appels[0].body));
  const htmlSeul = await appeler({ corps, entetes: signer(corps), contenu: { text: null, html: '<p>Bonjour,<br>nous serons 30.</p>' } });
  ok(htmlSeul.statut === 200 && htmlSeul.appels[0] && /nous serons 30\./.test(htmlSeul.appels[0].body) && !/</.test(htmlSeul.appels[0].body),
    '[G] un mail sans texte brut rend son HTML deshabille (le cas d une reponse Gmail)', JSON.stringify(htmlSeul.appels[0] && htmlSeul.appels[0].body));
  const echec = await appeler({ corps, entetes: signer(corps), contenu: 'echec' });
  ok(echec.statut === 503 && echec.appels.length === 0,
    '[G] si la lecture echoue : 503 pour que le fournisseur REESSAIE, et rien n est ecrit', `HTTP ${echec.statut}`);
  const vide = await appeler({ corps, entetes: signer(corps), contenu: { text: '', html: '' } });
  ok(vide.statut === 200 && vide.appels[0] && vide.appels[0].body === 'Anniversaire samedi',
    '[J] un mail dont le contenu recupere est VIDE entre quand meme, avec son objet pour corps',
    `HTTP ${vide.statut}, corps ${JSON.stringify(vide.appels[0] && vide.appels[0].body)}`);
  const sansRien = JSON.stringify({ from: 'marie@exemple.be', subject: 'Objet seul, aucun corps' });
  const refusIncomplet = await appeler({ corps: sansRien, entetes: { 'x-inbound-secret': SECRET_MANUEL } });
  ok(refusIncomplet.statut === 400 && refusIncomplet.appels.length === 0 && refusIncomplet.lectures.length === 0,
    '[J] un envoi sans corps NI identifiant est refuse : on n a rien a aller chercher, et son objet ne fait pas un mail',
    `HTTP ${refusIncomplet.statut}, ${refusIncomplet.appels.length} ecriture(s), ${refusIncomplet.lectures.length} lecture(s)`);

  const recu = await appeler({ corps: payload({ to: ['gembloux@inbound.pinlane.be'] }), entetes: signer(payload({ to: ['gembloux@inbound.pinlane.be'] })) });
  ok(recu.appels[0] && recu.appels[0].centerId === 'gembloux',
    '[G] le centre se lit sur received_for, la vraie cle de routage du fournisseur', recu.appels[0] && recu.appels[0].centerId);

  // =====================================================================
  console.log('\n[F] un evenement qui n est pas une reception n est jamais ingere');
  // =====================================================================
  // Ce corps a TOUT d un mail recu (expediteur, sujet, texte, et une VRAIE
  // adresse de reception d un centre) : seul son TYPE dit que c est un de nos
  // envois. Sans cette forme-la, la mutation ne prouverait rien : un evenement
  // sans texte serait refuse pour une autre raison, et depuis le 2026-09-16 un
  // destinataire qui ne designe aucun centre n est plus classe nulle part.
  const notreEnvoi = JSON.stringify({
    type: 'email.sent',
    data: { from: 'contact@pinlane.be', to: ['libramont@inbound.pinlane.be'], subject: 'Votre reservation', text: 'Bonjour, votre reservation est enregistree.' },
  });
  for (const evenement of ['email.sent', 'email.delivered', 'email.bounced', 'email.complained']) {
    const corpsEvenement = notreEnvoi.replace('email.sent', evenement);
    const r = await appeler({ corps: corpsEvenement, entetes: signer(corpsEvenement) });
    ok(r.statut === 200 && r.appels.length === 0,
      `[F] ${evenement} : acquitte en 200, rien n est ingere`, `HTTP ${r.statut}, ${r.appels.length} ecriture(s)`);
    // Le meme evenement va au SUIVI, avec la cle d idempotence du fournisseur
    // (svix-id) et la reponse qui dit ce qui a ete enregistre.
    ok(r.evenements.length === 1 && r.evenements[0].type === evenement && r.evenements[0].eventKey === 'msg_2026'
      && r.corps && r.corps.recorded === evenement.replace('email.', '') && r.corps.deduped === false,
      `[F] ${evenement} : enregistre comme evenement de suivi, cle = svix-id`, `${r.evenements.length} evenement(s), corps ${JSON.stringify(r.corps)}`);
  }
  // Un evenement NON SIGNE ne va nulle part : ni au suivi, ni a l ingestion.
  const rNonSigne = await appeler({ corps: notreEnvoi });
  ok(rNonSigne.statut === 401 && rNonSigne.evenements.length === 0 && rNonSigne.appels.length === 0,
    '[F] un evenement non signe n est ni enregistre ni ingere', `HTTP ${rNonSigne.statut}`);
  // L envoi manuel est un essai de la plateforme : il nomme son centre par le
  // parametre d URL. Sans centre, il n est classe nulle part, comme un vrai mail.
  const platSansType = JSON.stringify({ from: 'marie@exemple.be', subject: 'Sans enveloppe', text: 'Bonjour' });
  const rPlat = await appeler({ corps: platSansType, entetes: { 'x-inbound-secret': SECRET_MANUEL }, requete: '/api/inbound-email?centerId=libramont' });
  ok(rPlat.statut === 200 && rPlat.appels.length === 1 && rPlat.appels[0].centerId === 'libramont',
    '[F] un envoi manuel sans enveloppe (aucun type) reste ingere chez le centre qu il nomme', `HTTP ${rPlat.statut}, ${rPlat.appels.length} ecriture(s)`);
  const rPlatSansCentre = await appeler({ corps: platSansType, entetes: { 'x-inbound-secret': SECRET_MANUEL } });
  ok(rPlatSansCentre.statut === 200 && rPlatSansCentre.appels.length === 0,
    '[F] un envoi manuel qui ne nomme aucun centre n est classe nulle part', `HTTP ${rPlatSansCentre.statut}, ${rPlatSansCentre.appels.length} ecriture(s)`);

  // =====================================================================
  console.log('\n[H] lire et envoyer sont deux droits separes');
  // =====================================================================
  // On mesure le VRAI chemin de lecture (celui que le gate remplace ailleurs par
  // un bouchon), en interceptant l appel reseau : quelle cle part, et que se
  // passe-t-il quand le fournisseur refuse.
  const { __test } = require(path.join(ROOT, CIBLE));
  const lecture = __test && __test.recupererContenuParDefaut;
  ok(typeof lecture === 'function', '[H] le chemin de lecture reel est mesurable');
  const fetchOriginal = globalThis.fetch;
  const memoireEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_INBOUND_API_KEY: process.env.RESEND_INBOUND_API_KEY,
  };
  async function lireAvec({ envoi, reception, reponse }) {
    if (envoi === null) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = envoi;
    if (reception === null) delete process.env.RESEND_INBOUND_API_KEY; else process.env.RESEND_INBOUND_API_KEY = reception;
    let porteur = '';
    let url = '';
    globalThis.fetch = async (u, options) => {
      url = String(u);
      porteur = String(((options && options.headers) || {}).Authorization || '');
      return reponse || { ok: true, status: 200, json: async () => ({ text: 'ok', html: '' }) };
    };
    try {
      const valeur = await lecture('id-de-mesure');
      return { porteur, url, valeur, erreur: null };
    } catch (error) {
      return { porteur, url, valeur: null, erreur: error };
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }
  const hDediee = await lireAvec({ envoi: 'cle-d-envoi', reception: 'cle-de-lecture' });
  ok(hDediee.porteur === 'Bearer cle-de-lecture',
    '[H] quand une cle de lecture existe, c est ELLE qui part (pas celle d envoi)', hDediee.porteur);
  ok(/emails\/receiving\/id-de-mesure$/.test(hDediee.url),
    '[H] elle part bien sur le point de lecture du fournisseur', hDediee.url);
  const hRepli = await lireAvec({ envoi: 'cle-d-envoi', reception: null });
  ok(hRepli.porteur === 'Bearer cle-d-envoi',
    '[H] sans cle dediee on retombe sur celle d envoi : une installation a une seule cle continue de marcher', hRepli.porteur);
  const hAucune = await lireAvec({ envoi: null, reception: null });
  ok(hAucune.erreur && Number(hAucune.erreur.statusCode) === 503 && /cle/i.test(hAucune.erreur.message),
    '[H] aucune cle : 503 et un message qui NOMME la cle manquante', hAucune.erreur && hAucune.erreur.message);
  const refusFournisseur = { ok: false, status: 401, text: async () => '{"message":"This API key is restricted to only send emails"}' };
  const hRefus = await lireAvec({ envoi: 'cle-d-envoi', reception: null, reponse: refusFournisseur });
  ok(hRefus.erreur && /401/.test(hRefus.erreur.message) && /restricted to only send/.test(hRefus.erreur.message),
    '[H] un refus du fournisseur remonte SA PHRASE, pas un message maison', hRefus.erreur && hRefus.erreur.message);
  // Le message doit EXISTER avant qu on puisse le declarer propre : sans cette
  // premiere moitie, ce controle passerait au vert sur un message absent.
  ok(Boolean(hRefus.erreur && hRefus.erreur.message) && !/cle-d-envoi|cle-de-lecture/.test(String(hRefus.erreur.message)),
    '[H] et la cle n apparait nulle part dans ce message');
  if (memoireEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = memoireEnv.RESEND_API_KEY;
  if (memoireEnv.RESEND_INBOUND_API_KEY === undefined) delete process.env.RESEND_INBOUND_API_KEY; else process.env.RESEND_INBOUND_API_KEY = memoireEnv.RESEND_INBOUND_API_KEY;

  // =====================================================================
  console.log('\n[MUTATION] le gate sait-il rougir ?');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'la verification de signature est neutralisee',
      de: '    if (!autorise(brut, req)) {',
      vers: '    if (false) {',
      rejouer: async () => appeler({ corps, entetes: signer(corps, { secret: AUTRE_SECRET }) }),
      attendu: (r) => r.statut === 200 || r.appels.length > 0,
      libelle: 'une signature d un autre secret passerait',
    },
    {
      nom: 'la tolerance d horodatage est retiree',
      de: '  if (!Number.isFinite(age) || age > TOLERANCE_SECONDES) return false;',
      vers: '  if (false) return false;',
      rejouer: async () => appeler({ corps, entetes: vieux }),
      attendu: (r) => r.statut === 200,
      libelle: 'un appel rejoue passerait',
    },
    {
      nom: 'le sujet remplace le corps sans etre alle le chercher',
      de: "    const text = texte || texteDepuisHtml(html) || (contenuCherche ? subject : '');",
      vers: '    const text = texte || texteDepuisHtml(html) || subject;',
      rejouer: async () => appeler({
        corps: JSON.stringify({ from: 'marie@exemple.be', subject: 'Objet seul, aucun corps' }),
        entetes: { 'x-inbound-secret': SECRET_MANUEL },
        requete: '/api/inbound-email?centerId=libramont',
      }),
      attendu: (r) => r.statut === 200 && r.appels.length === 1,
      libelle: 'un envoi incomplet entrerait dans la boite avec son objet en guise de contenu',
    },
    {
      nom: 'la lecture reprend la cle d envoi',
      de: "  const cle = process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY;",
      vers: '  const cle = process.env.RESEND_API_KEY;',
      rejouer: async () => {
        delete require.cache[require.resolve(path.join(ROOT, CIBLE))];
        const mute = require(path.join(ROOT, CIBLE));
        process.env.RESEND_API_KEY = 'cle-d-envoi';
        process.env.RESEND_INBOUND_API_KEY = 'cle-de-lecture';
        let porteur = '';
        const original = globalThis.fetch;
        globalThis.fetch = async (u, options) => {
          porteur = String(((options && options.headers) || {}).Authorization || '');
          return { ok: true, status: 200, json: async () => ({ text: 'ok', html: '' }) };
        };
        try { await mute.__test.recupererContenuParDefaut('id-de-mesure'); } catch (error) { /* le porteur suffit */ }
        globalThis.fetch = original;
        delete process.env.RESEND_API_KEY;
        delete process.env.RESEND_INBOUND_API_KEY;
        return { porteur };
      },
      attendu: (r) => r.porteur === 'Bearer cle-d-envoi',
      libelle: 'la lecture repartirait avec la cle restreinte a l envoi, donc refusee',
    },
    {
      nom: 'la lecture du contenu est retiree',
      de: '      const lu = await recupererContenu(emailId);',
      vers: '      const lu = {};',
      rejouer: async () => appeler({ corps, entetes: signer(corps) }),
      // Le repli sur le SUJET fait que le mail passe encore, mais VIDE de son
      // contenu : c est exactement ce que la propriete interdit. La sonde vise
      // donc le corps ingere, pas le simple fait qu il y ait eu une ecriture.
      attendu: (r) => r.appels.length === 0 || !/place/.test(String(r.appels[0].body || '')),
      libelle: 'le mail entrerait sans une ligne de son contenu',
    },
    {
      nom: 'le filtre d evenement est retire',
      de: "    if (type && !type.includes('received') && !type.includes('inbound')) {",
      vers: '    if (false) {',
      rejouer: async () => appeler({ corps: notreEnvoi, entetes: signer(notreEnvoi) }),
      attendu: (r) => r.appels.length > 0,
      libelle: 'nos propres envois entreraient dans la page Emails',
    },
    {
      nom: 'le centre est fige sur libramont',
      de: '      const centerId = parAdresse ? parAdresse.id : centreDemande;',
      vers: "      const centerId = 'libramont';",
      rejouer: async () => appeler({ corps: versGembloux, entetes: signer(versGembloux) }),
      attendu: (r) => r.appels[0] && r.appels[0].centerId !== 'gembloux',
      libelle: 'un mail pour Gembloux atterrirait a Libramont',
    },
    {
      nom: 'le parametre d URL reprend la priorite sur l adresse',
      de: '      const centerId = parAdresse ? parAdresse.id : centreDemande;',
      vers: '      const centerId = centreDemande || (parAdresse ? parAdresse.id : centreDemande);',
      rejouer: async () => appeler({ corps: versGembloux, entetes: { 'x-inbound-secret': SECRET_MANUEL }, requete: '/api/inbound-email?centerId=libramont' }),
      attendu: (r) => r.appels[0] && r.appels[0].centerId !== 'gembloux',
      libelle: 'un essai fige sur libramont detournerait Gembloux',
    },
    {
      nom: 'le centre par defaut revient',
      de: "      const centreDemande = parSecretMaison(req) ? centreConnu(url.searchParams.get('centerId')) : '';",
      vers: "      const centreDemande = (parSecretMaison(req) ? centreConnu(url.searchParams.get('centerId')) : '') || 'libramont';",
      rejouer: async () => appeler({ corps: inconnu, entetes: signer(inconnu) }),
      attendu: (r) => r.appels.length > 0,
      libelle: 'le courrier non reconnu de tous les clients atterrirait chez Fun Galaxy Libramont',
    },
    {
      nom: 'le parametre d URL classe de nouveau un vrai mail du fournisseur',
      de: "      const centreDemande = parSecretMaison(req) ? centreConnu(url.searchParams.get('centerId')) : '';",
      vers: "      const centreDemande = centreConnu(url.searchParams.get('centerId'));",
      rejouer: async () => appeler({ corps: inconnu, entetes: signer(inconnu), requete: '/api/inbound-email?centerId=libramont' }),
      attendu: (r) => r.appels.length > 0,
      libelle: 'un webhook fige sur libramont y classerait le courrier non reconnu de tous les clients',
    },
    {
      nom: 'le domaine de l adresse n est plus lu',
      de: '    const id = adresse.slice(arobase + 1) === reception',
      vers: '    const id = true',
      rejouer: async () => appeler({ corps: autreClient, entetes: signer(autreClient) }),
      attendu: (r) => r.appels.length > 0 && r.appels[0].centerId === 'gembloux',
      libelle: 'le courrier d un autre bowling de Gembloux atterrirait chez Fun Galaxy Gembloux',
    },
    {
      nom: 'le destinataire n est plus transmis a l ingestion',
      de: '        to: destinataire,',
      vers: '',
      rejouer: async () => appeler({ corps: versGembloux, entetes: signer(versGembloux) }),
      attendu: (r) => r.appels[0] && !r.appels[0].to,
      libelle: 'un mail mal classe ne laisserait aucune trace de l adresse qui l a recu',
    },
    {
      nom: 'seule la premiere source d adresse est lue',
      de: '  const sources = [data && data.received_for, data && data.to, data && data.recipient, data && data.envelope_to];',
      vers: '  const sources = [data && (data.received_for || data.to || data.recipient || data.envelope_to)];',
      rejouer: async () => appeler({ corps: generique, entetes: signer(generique) }),
      // Le mail n arrive plus chez Gembloux : ailleurs, ou nulle part.
      attendu: (r) => !(r.appels[0] && r.appels[0].centerId === 'gembloux'),
      libelle: 'une adresse generique en received_for masquerait le centre nomme dans to',
    },
    {
      nom: 'le mail non classe redevient muet',
      de: "        console.warn(`inbound-email: aucun centre reconnu, mail NON classe ; destinataires recus : ${adresses.join(', ') || '(aucun)'}`);",
      vers: '',
      rejouer: async () => ({ avertis: await appelerEnEcoutant({ corps: inconnu, entetes: signer(inconnu) }) }),
      attendu: (r) => r.avertis.length === 0,
      libelle: 'un mail non classe ne laisserait aucune ligne dans le journal',
    },
  ];
  for (const c of contreEpreuves) {
    mutations = [{ fichier: CIBLE, de: c.de, vers: c.vers }];
    let verdict = false;
    try { verdict = c.attendu(await c.rejouer()); } catch (error) { verdict = false; }
    mutations = [];
    ok(verdict, `[mutation] « ${c.nom} » : ${c.libelle} (le gate ROUGIRAIT)`);
  }
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
