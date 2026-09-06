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
//   [D] LE MAIL ARRIVE CHEZ LE CENTRE QUI L A RECU. Le centre se lit sur
//       l ADRESSE DESTINATAIRE (`libramont@...` va a Libramont, `gembloux@...`
//       a Gembloux) ; le parametre d URL prime quand il est donne ; une adresse
//       qui ne designe aucun centre connu ne fabrique pas un centre invente.
//
//   [F] UN EVENEMENT QUI N EST PAS UNE RECEPTION N EST JAMAIS INGERE, MEME
//       SIGNE ET MEME S IL EN A L AIR. Un compte abonne a tous les evenements
//       (envoi, remise, rebond, plainte) nous envoie NOS PROPRES messages avec
//       la meme signature : les ingerer remplirait la page Emails de nos
//       envois, a l envers. Ils sont acquittes en 200 pour que le fournisseur
//       ne les rejoue pas, sans rien ecrire.
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
function chargerHandler(ingest, recupererContenu) {
  delete require.cache[require.resolve(path.join(ROOT, CIBLE))];
  const { createHandler } = require(path.join(ROOT, CIBLE));
  return createHandler({ ingest, recupererContenu });
}

// ---------------------------------------------------------------------------
// UN APPEL HTTP, sans reseau : le handler est le VRAI, req et res sont ceux
// qu il recevrait de la plateforme.
// ---------------------------------------------------------------------------
async function appeler({ corps, entetes = {}, requete = '/api/inbound-email', methode = 'POST', ingest = null, contenu = null } = {}) {
  const appels = [];
  const lectures = [];
  const ingestion = ingest || (async (args) => { appels.push(args); return { communication: { id: 1 }, deduped: false }; });
  const handler = chargerHandler(async (args) => {
    appels.push(args);
    return ingestion === ingest ? ingestion(args) : { communication: { id: 1 }, deduped: false };
  }, async (emailId) => {
    lectures.push(emailId);
    if (typeof contenu === 'function') return contenu(emailId);
    if (contenu === 'echec') { const e = new Error('lecture refusee'); e.statusCode = 503; throw e; }
    return contenu || { text: 'Bonjour, avez-vous de la place ?', html: '' };
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
  return { statut: statut || res.statusCode, corps: corpsRendu, appels, lectures };
}

// L ENVELOPPE REELLE, relevee sur la production le 2026-09-06 : elle ne porte
// AUCUN corps, seulement l identifiant du mail. C est la forme que le gate doit
// mesurer ; l ancienne fixture (avec un champ texte) validait un monde qui
// n existe pas.
function payload({ to = ['libramont@inbound.pinlane.be'], from = 'marie@exemple.be', subject = 'Anniversaire samedi', emailId = '7865d93e-c9e6-42a9-9ef2-8d92e09ecc06' } = {}) {
  return JSON.stringify({
    type: 'email.received',
    created_at: '2026-09-06T18:10:40.000Z',
    data: {
      attachments: [], bcc: [], cc: [],
      created_at: '2026-09-06T18:10:54.274Z',
      email_id: emailId,
      from,
      message_id: '<CA+q0sthV3rFhsMJ8J4xCJT@mail.gmail.com>',
      received_for: to,
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
  ok(force.appels[0] && force.appels[0].centerId === 'libramont', '[D] le parametre d URL prime sur l adresse', force.appels[0] && force.appels[0].centerId);
  const inventé = payload({ to: ['nimportequoi@inbound.pinlane.be'] });
  const inc = await appeler({ corps: inventé, entetes: signer(inventé) });
  ok(inc.appels[0] && inc.appels[0].centerId === 'libramont', '[D] une adresse qui ne designe aucun centre connu ne fabrique pas un centre invente', inc.appels[0] && inc.appels[0].centerId);
  const faux = await appeler({ corps, entetes: signer(corps), requete: '/api/inbound-email?centerId=centre-qui-n-existe-pas' });
  ok(faux.appels[0] && faux.appels[0].centerId !== 'centre-qui-n-existe-pas', '[D] un parametre d URL qui ne designe aucun centre est ignore, pas ecrit tel quel', faux.appels[0] && faux.appels[0].centerId);

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
  // Ce corps a TOUT d un mail recu (expediteur, sujet, texte) : seul son TYPE
  // dit que c est un de nos envois. Sans cette forme-la, la mutation ne
  // prouverait rien (un evenement d envoi reel n a pas de texte, il serait
  // refuse pour une autre raison).
  const notreEnvoi = JSON.stringify({
    type: 'email.sent',
    data: { from: 'contact@pinlane.be', to: ['client@exemple.be'], subject: 'Votre reservation', text: 'Bonjour, votre reservation est enregistree.' },
  });
  for (const evenement of ['email.sent', 'email.delivered', 'email.bounced', 'email.complained']) {
    const corpsEvenement = notreEnvoi.replace('email.sent', evenement);
    const r = await appeler({ corps: corpsEvenement, entetes: signer(corpsEvenement) });
    ok(r.statut === 200 && r.appels.length === 0,
      `[F] ${evenement} : acquitte en 200, rien n est ecrit`, `HTTP ${r.statut}, ${r.appels.length} ecriture(s)`);
  }
  const platSansType = JSON.stringify({ from: 'marie@exemple.be', subject: 'Sans enveloppe', text: 'Bonjour' });
  const rPlat = await appeler({ corps: platSansType, entetes: { 'x-inbound-secret': SECRET_MANUEL } });
  ok(rPlat.statut === 200 && rPlat.appels.length === 1,
    '[F] un envoi manuel sans enveloppe (aucun type) reste ingere', `HTTP ${rPlat.statut}, ${rPlat.appels.length} ecriture(s)`);

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
      nom: 'le centre est fige sur le defaut',
      de: '    const centerId = centreDemande || centreDuDestinataire(data) || CENTRE_PAR_DEFAUT;',
      vers: '    const centerId = CENTRE_PAR_DEFAUT;',
      rejouer: async () => appeler({ corps: versGembloux, entetes: signer(versGembloux) }),
      attendu: (r) => r.appels[0] && r.appels[0].centerId !== 'gembloux',
      libelle: 'un mail pour Gembloux atterrirait a Libramont',
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
