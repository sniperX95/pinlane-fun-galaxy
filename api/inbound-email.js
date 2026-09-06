// Webhook de réception d'emails : POST /api/inbound-email
// Alimente la boîte de réception de la page « Emails & relances » : chaque
// email entrant est stocké (communications direction='inbound') AVEC son
// analyse par l'agent (intention, résumé, réponse proposée).
//
// DEUX FACONS D ETRE AUTORISE, ET AUCUNE AUTRE :
//
//   1. L en-tete maison `x-inbound-secret` === env INBOUND_EMAIL_SECRET. C est
//      lui qui permet d eprouver tout le circuit sans dependre du DNS.
//   2. LA SIGNATURE DU FOURNISSEUR (norme Svix, celle de Resend) : en-tetes
//      `svix-id`, `svix-timestamp`, `svix-signature`. Resend ne sait pas
//      envoyer d en-tete maison : sans cette verification, brancher la
//      reception voulait dire, soit refuser tous ses appels, soit ouvrir cette
//      porte a tout le monde. Or elle ECRIT en base et fait tourner l agent :
//      n importe qui pourrait remplir la page Emails d un centre.
//
// La signature couvre le corps EXACT (`id.horodatage.corps`), et l horodatage
// doit etre recent : une signature valide capturee ne peut donc pas etre
// rejouee plus tard, ni recollee sur un autre contenu.
//
// Compatible Resend Inbound (`type: 'email.received'`, données sous `data`)
// et POST générique { from, subject, text|body, receivedAt }.

// LE WEBHOOK NE PORTE QUE L ENVELOPPE (mesure du 2026-09-06 sur un vrai mail).
// Le fournisseur envoie l expediteur, le destinataire, le sujet et un
// IDENTIFIANT, et rien du contenu : les corps de mail ne passent pas dans une
// requete serverless. Le corps se recupere donc par un second appel, avec cet
// identifiant. Sans lui, chaque mail entrant repartait en 400.
const crypto = require('crypto');
const { readRawBody, sendError, sendJson } = require('../lib/http');
const { ingestInboundEmail } = require('../lib/email-agent');
const { getCenter } = require('../lib/ops-knowledge');

// Cinq minutes : la fenetre standard d une signature de webhook. Assez large
// pour une horloge qui derive, trop courte pour un rejeu utile.
const TOLERANCE_SECONDES = 5 * 60;
const CENTRE_PAR_DEFAUT = 'libramont';

// "Marie Dupont <marie@test.be>" → { email, name } ; adresse nue acceptée.
function parseAddress(raw = '') {
  const value = String(raw || '').trim();
  const match = value.match(/<([^>]+)>/);
  const email = (match ? match[1] : value).trim();
  const name = match ? value.slice(0, match.index).replace(/["']/g, '').trim() : '';
  return { email, name };
}

function signatureFournisseurValide(brut, entetes, secret) {
  const id = String(entetes['svix-id'] || entetes['webhook-id'] || '');
  const horodatage = String(entetes['svix-timestamp'] || entetes['webhook-timestamp'] || '');
  const signatures = String(entetes['svix-signature'] || entetes['webhook-signature'] || '');
  if (!secret || !id || !horodatage || !signatures) return false;
  const age = Math.abs(Date.now() / 1000 - Number(horodatage));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDES) return false;
  let attendue = null;
  try {
    const cle = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
    attendue = Buffer.from(crypto.createHmac('sha256', cle).update(`${id}.${horodatage}.${brut}`).digest('base64'));
  } catch (error) {
    return false;
  }
  // Comparaison en temps constant, et sur CHAQUE signature annoncee : le
  // fournisseur en envoie plusieurs pendant une rotation de cle.
  return signatures.split(/\s+/).some((entree) => {
    const [version, valeur] = String(entree).split(',');
    if (version !== 'v1' || !valeur) return false;
    const candidate = Buffer.from(valeur);
    return candidate.length === attendue.length && crypto.timingSafeEqual(candidate, attendue);
  });
}

// Le texte d un mail qui n a que du HTML (une reponse Gmail, par exemple).
// L agent lit du texte : lui donner des balises reviendrait a lui faire lire
// le code source de la reponse.
function texteDepuisHtml(html) {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// LIRE ET ENVOYER SONT DEUX DROITS SEPARES (2026-09-06). Mesure sur la
// production : la cle qui envoie nos mails est restreinte a l envoi, et le
// fournisseur repond « This API key is restricted to only send emails » des
// qu on lui demande le contenu d un mail recu. Chaque mail entrant repartait
// donc en 503.
//
// La lecture prend sa PROPRE cle, pour que celle d envoi reste restreinte :
// c est elle qui vit dans le plus de code, et une cle qui ne sait qu envoyer ne
// peut pas exposer une boite de reception. A defaut, on retombe sur la cle
// d envoi : une installation qui n en a qu une continue de marcher.
async function recupererContenuParDefaut(emailId) {
  const cle = process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY;
  if (!cle) {
    const error = new Error('aucune cle de lecture (RESEND_INBOUND_API_KEY)');
    error.statusCode = 503;
    throw error;
  }
  const reponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${cle}` },
  });
  if (!reponse || !reponse.ok) {
    // LE STATUT DU FOURNISSEUR REMONTE JUSQU A SA PROPRE CONSOLE (2026-09-06).
    // Un message generique nous a laisses aveugles : « lecture impossible » ne
    // dit pas si la cle manque de droits (403), si elle est mauvaise (401) ou
    // si le mail n existe plus (404). Le statut, jamais la cle.
    let detail = '';
    try { detail = String((await reponse.text()) || '').slice(0, 90); } catch (lecture) { detail = ''; }
    const error = new Error(`le fournisseur refuse la lecture (HTTP ${reponse && reponse.status}${detail ? ` : ${detail}` : ''})`);
    error.statusCode = 503;
    throw error;
  }
  return reponse.json();
}

function autorise(brut, req) {
  const entetes = (req && req.headers) || {};
  const attendu = process.env.INBOUND_EMAIL_SECRET;
  if (attendu && entetes['x-inbound-secret'] === attendu) return true;
  return signatureFournisseurValide(brut, entetes, process.env.RESEND_WEBHOOK_SECRET);
}

// UN CENTRE N EXISTE QUE S IL EST AU CATALOGUE. Sans ce filtre, l adresse
// destinataire (ou un parametre d URL) ecrirait n importe quel identifiant dans
// la base, et le mail serait rattache a un centre qui n existe pas.
function centreConnu(valeur) {
  const id = String(valeur || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) return '';
  try {
    return getCenter(id) ? id : '';
  } catch (error) {
    return '';
  }
}

// LE CENTRE SE LIT SUR L ADRESSE QUI A RECU. Un seul webhook sert tous les
// centres : `libramont@...` va a Libramont, `gembloux@...` a Gembloux. C est
// la donnee du mail qui decide, pas une constante ni un webhook par centre.
function centreDuDestinataire(data) {
  // `received_for` d abord : c est l adresse pour laquelle le fournisseur a
  // accepte le mail, donc la vraie cle de routage. `to` peut porter une liste
  // ou une copie qui ne nous concerne pas.
  const brut = data && (data.received_for || data.to || data.recipient || data.envelope_to);
  const liste = Array.isArray(brut) ? brut : (brut ? [brut] : []);
  for (const entree of liste) {
    const adresse = entree && typeof entree === 'object'
      ? (entree.address || entree.email || '')
      : String(entree || '');
    const { email } = parseAddress(adresse);
    const id = centreConnu(String(email || '').split('@')[0]);
    if (id) return id;
  }
  return '';
}

function createHandler({ ingest = ingestInboundEmail, recupererContenu = recupererContenuParDefaut } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'Méthode non autorisée.');
      return;
    }
    // LE CORPS D ABORD, EN OCTETS : la signature se calcule dessus, donc il se
    // lit AVANT toute analyse. Un corps illisible signe par le fournisseur est
    // une erreur de format (400) ; un corps quelconque non signe reste un 401.
    let brut = '';
    try {
      brut = await readRawBody(req);
    } catch (error) {
      sendError(res, Number(error && error.statusCode) || 400, 'Corps illisible.');
      return;
    }

    if (!autorise(brut, req)) {
      sendError(res, 401, 'Webhook non autorisé.');
      return;
    }

    let body;
    try {
      body = brut ? JSON.parse(brut) : {};
    } catch (error) {
      sendError(res, 400, 'Corps JSON invalide.');
      return;
    }

    // Enveloppe Resend (email.received) ou payload plat.
    // UN SEUL TYPE D EVENEMENT DEVIENT UN MAIL RECU. Un compte peut etre
    // abonne a TOUT (envoi, remise, rebond, plainte) : ces evenements portent
    // la meme signature et decrivent NOS PROPRES messages. Les ingerer
    // remplirait la page Emails de nos envois, presentes comme des messages de
    // clients. On les acquitte en 200 : un refus les ferait rejouer en boucle.
    // Le test porte sur « received » et « inbound » plutot que sur un nom
    // exact, parce que ce nom a deja change chez eux.
    const type = String((body && body.type) || '').toLowerCase();
    if (type && !type.includes('received') && !type.includes('inbound')) {
      sendJson(res, 200, { ok: true, ignored: type });
      return;
    }

    // L enveloppe du fournisseur porte le mail sous `data` ; un envoi manuel
    // n a pas d enveloppe du tout.
    const data = body && body.data && typeof body.data === 'object' ? body.data : (body || {});
    const fromRaw = data.from && typeof data.from === 'object'
      ? (data.from.email || data.from.address || '')
      : (data.from || '');
    const { email: from, name: fromName } = parseAddress(fromRaw);
    const subject = String(data.subject || '').trim();
    const emailId = String(data.email_id || data.id || '').trim();
    let texte = String(data.text || data.body || '').trim();
    let html = String(data.html || '');
    // L enveloppe ne porte pas le corps : on va le chercher. Un envoi manuel,
    // lui, porte deja son texte et ne declenche aucun appel.
    let contenuCherche = false;
    if (!texte && !html && emailId) {
      try {
        const lu = await recupererContenu(emailId);
        texte = String((lu && lu.text) || '').trim();
        html = String((lu && lu.html) || '');
        contenuCherche = true;
      } catch (error) {
        // 503 et non 400 : c est NOTRE lecture qui a echoue, pas le mail qui
        // est mauvais. Le fournisseur reessaie sur un 503 ; sur un 400 il
        // conclurait que ce mail ne passera jamais.
        sendError(res, Number(error && error.statusCode) || 503, `Lecture du mail impossible : ${String((error && error.message) || 'cause inconnue').slice(0, 140)}`);
        return;
      }
    }
    // LE SUJET N EST UN DERNIER RECOURS QU APRES AVOIR CHERCHE LE CORPS. Un mail
    // reellement vide de corps existe (tout est dans l objet), et le refuser
    // ferait perdre un vrai client. Mais un envoi qui n a NI corps NI
    // identifiant a aller chercher est un envoi incomplet : le laisser entrer en
    // recopiant son objet mettrait dans la boite un message dont personne n a le
    // contenu, sans que rien ne le signale.
    const text = texte || texteDepuisHtml(html) || (contenuCherche ? subject : '');
    if (!from || !from.includes('@') || !text) {
      sendError(res, 400, 'Payload invalide : from et contenu requis.');
      return;
    }

    try {
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const centreDemande = centreConnu(url.searchParams.get('centerId'));
      const centerId = centreDemande || centreDuDestinataire(data) || CENTRE_PAR_DEFAUT;
      const result = await ingest({
        centerId,
        from,
        fromName,
        subject,
        body: text,
        receivedAt: data.receivedAt || data.created_at || null,
      });
      sendJson(res, 200, {
        ok: true,
        id: result.communication?.id || null,
        deduped: Boolean(result.deduped),
      });
    } catch (error) {
      const status = error && error.expose === true ? 400 : 503;
      sendError(res, status, error && error.expose === true
        ? (error.message || 'Payload invalide.')
        : 'Réception impossible pour le moment.');
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test = { recupererContenuParDefaut, texteDepuisHtml };
