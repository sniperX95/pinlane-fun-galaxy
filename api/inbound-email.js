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
const { getCenter, loadOpsKnowledge } = require('../lib/ops-knowledge');
const { domaineReception } = require('../lib/sender-domains');
const { enregistrerEvenementFournisseur, cleDEvenement } = require('../lib/email-events');

// LE BRUT D UN MAIL RECU, pour ses en-tetes seulement (2026-09-16). Le
// fournisseur ne rend pas toujours In-Reply-To et References dans `headers` ;
// le fichier brut (raw.download_url) les porte toujours. On ne lit que le
// debut : le bloc d en-tetes tient en quelques kilo-octets, une piece jointe
// peut en faire des milliers.
const LIMITE_BRUT_OCTETS = 256 * 1024;

async function recupererBrutParDefaut(url) {
  const reponse = await fetch(String(url), { headers: { Range: `bytes=0-${LIMITE_BRUT_OCTETS - 1}` } });
  if (!reponse || !reponse.ok) throw new Error(`brut illisible (HTTP ${reponse && reponse.status})`);
  const texte = await reponse.text();
  return String(texte || '').slice(0, LIMITE_BRUT_OCTETS);
}

// Les en-tetes rendus par le fournisseur, cles en minuscules. Deux formes
// existent chez lui : un objet { 'Message-ID': '...' } ou une liste de
// { name, value } ; les deux se lisent.
function entetesEnMinuscules(brut) {
  const entetes = {};
  if (Array.isArray(brut)) {
    for (const entree of brut) {
      const nom = String((entree && (entree.name || entree.key)) || '').trim().toLowerCase();
      if (nom && entetes[nom] === undefined) entetes[nom] = String((entree && entree.value) || '').trim();
    }
    return entetes;
  }
  if (brut && typeof brut === 'object') {
    for (const [nom, valeur] of Object.entries(brut)) {
      const cle = String(nom || '').trim().toLowerCase();
      if (cle && entetes[cle] === undefined) entetes[cle] = Array.isArray(valeur) ? valeur.map(String).join(' ') : String(valeur == null ? '' : valeur).trim();
    }
  }
  return entetes;
}

// Le bloc d en-tetes d un mail brut (RFC 5322) : jusqu a la premiere ligne
// vide, lignes de continuation (espace ou tabulation en tete) depliees.
function entetesDuBrut(brut) {
  const texte = String(brut || '').replace(/\r\n/g, '\n');
  const bloc = texte.split('\n\n')[0] || '';
  const depliees = [];
  for (const ligne of bloc.split('\n')) {
    if (/^[ \t]/.test(ligne) && depliees.length) depliees[depliees.length - 1] += ` ${ligne.trim()}`;
    else depliees.push(ligne);
  }
  const entetes = {};
  for (const ligne of depliees) {
    const deuxPoints = ligne.indexOf(':');
    if (deuxPoints <= 0) continue;
    const nom = ligne.slice(0, deuxPoints).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(nom)) continue;
    if (entetes[nom] === undefined) entetes[nom] = ligne.slice(deuxPoints + 1).trim();
  }
  return entetes;
}

// L enregistrement reel d un evenement du fournisseur : la base du produit.
// Require paresseux : le module de base n a pas a se charger pour un refus 401.
async function enregistrerEvenementParDefaut(args) {
  const { getPool } = require('../lib/database');
  return enregistrerEvenementFournisseur((texte, params) => getPool().query(texte, params), args);
}

// Cinq minutes : la fenetre standard d une signature de webhook. Assez large
// pour une horloge qui derive, trop courte pour un rejeu utile.
const TOLERANCE_SECONDES = 5 * 60;
// PLUS DE CENTRE PAR DEFAUT (2026-09-16). Un mail qu aucune adresse ne
// rattachait a un centre etait classe chez libramont : avec plusieurs clients,
// le courrier mal adresse de TOUS atterrissait dans la boite de Fun Galaxy.
// Il n est plus classe nulle part : la redirection garde sa copie dans la
// boite du centre, rien n est perdu, et l avertissement nomme les adresses.

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

function parSecretMaison(req) {
  const entetes = (req && req.headers) || {};
  const attendu = process.env.INBOUND_EMAIL_SECRET;
  return Boolean(attendu) && entetes['x-inbound-secret'] === attendu;
}

function autorise(brut, req) {
  if (parSecretMaison(req)) return true;
  const entetes = (req && req.headers) || {};
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
//
// TOUTES LES SOURCES SE LISENT, DANS L ORDRE (2026-09-08). `received_for` est
// l adresse a laquelle le fournisseur a accepte le mail ; `to` est l en-tete,
// qui garde l adresse D ORIGINE quand l hebergeur d un centre transfere (le
// client a ecrit a gembloux@fungalaxy.be, le mail nous arrive pour
// gembloux@inbound...). Selon le chemin, l une ou l autre est generique : ne
// lire que la premiere source non vide perdait le centre nomme dans la seconde.
function destinatairesDe(data) {
  const sources = [data && data.received_for, data && data.to, data && data.recipient, data && data.envelope_to];
  const adresses = [];
  for (const brut of sources) {
    const liste = Array.isArray(brut) ? brut : (brut ? [brut] : []);
    for (const entree of liste) {
      const adresse = entree && typeof entree === 'object'
        ? (entree.address || entree.email || '')
        : String(entree || '');
      const { email } = parseAddress(adresse);
      if (email && !adresses.includes(email)) adresses.push(email);
    }
  }
  return adresses;
}

// UNE ADRESSE NE DESIGNE UN CENTRE QUE SUR NOTRE DOMAINE DE RECEPTION, OU SI
// ELLE EST EXACTEMENT L ADRESSE PUBLIQUE QU UN CENTRE DECLARE (2026-09-16).
// Seule la partie avant l arobase etait lue, quel que soit le domaine : un
// en-tete `gembloux@un-autre-bowling.be` classait le mail chez Fun Galaxy
// Gembloux. Avec plusieurs clients, un nom de ville partage suffisait a faire
// lire les clients de l un par l autre.
function centreDeLAdressePublique(adresse) {
  let centres = [];
  try {
    centres = loadOpsKnowledge().centers || [];
  } catch (error) {
    return '';
  }
  const trouves = centres.filter((centre) => String((centre && centre.publicInfo && centre.publicInfo.email) || '').trim().toLowerCase() === adresse);
  // Une adresse partagee par deux centres ne designe personne.
  return trouves.length === 1 ? String(trouves[0].id) : '';
}

function centreDuDestinataire(adresses) {
  const reception = domaineReception();
  for (const email of adresses) {
    const adresse = String(email || '').trim().toLowerCase();
    const arobase = adresse.lastIndexOf('@');
    if (arobase <= 0) continue;
    const id = adresse.slice(arobase + 1) === reception
      ? centreConnu(adresse.slice(0, arobase))
      : centreDeLAdressePublique(adresse);
    if (id) return { id, adresse: email };
  }
  return null;
}

function createHandler({
  ingest = ingestInboundEmail,
  recupererContenu = recupererContenuParDefaut,
  enregistrerEvenement = enregistrerEvenementParDefaut,
  recupererBrut = recupererBrutParDefaut,
} = {}) {
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
    // clients. Depuis le 2026-09-16 ils sont ENREGISTRES (lib/email-events :
    // remis, ouvert, clique, rebond, plainte) puis acquittes en 200. Une
    // relivraison Svix rend « deduped » sans toucher un compteur ; une panne
    // interne rend 503 pour que le fournisseur reessaie, l operation etant
    // idempotente. Le test porte sur « received » et « inbound » plutot que
    // sur un nom exact, parce que ce nom a deja change chez eux.
    const type = String((body && body.type) || '').toLowerCase();
    if (type && !type.includes('received') && !type.includes('inbound')) {
      const evenement = body && body.data && typeof body.data === 'object' ? body.data : {};
      let resultat;
      try {
        resultat = await enregistrerEvenement({
          type,
          createdAt: (body && body.created_at) || evenement.created_at || null,
          data: evenement,
          eventKey: cleDEvenement(req.headers, type, evenement),
        });
      } catch (error) {
        console.warn(`inbound-email: evenement ${type} non enregistre (${String((error && error.message) || error).slice(0, 120)})`);
        sendError(res, 503, 'Evenement non enregistre pour le moment.');
        return;
      }
      if (!resultat || resultat.ignored) {
        sendJson(res, 200, { ok: true, ignored: (resultat && resultat.ignored) || type });
        return;
      }
      sendJson(res, 200, { ok: true, recorded: resultat.type || type, deduped: Boolean(resultat.deduped) });
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
    // LES EN-TETES QUI RATTACHENT LE MAIL A SON FIL (2026-09-16). Le Message-ID
    // du mail recu, et ceux qu il cite (In-Reply-To, References) : c est par
    // eux qu une reponse de client retrouve NOTRE message plutot que d ouvrir
    // une conversation a part. L enveloppe porte parfois le Message-ID ; le
    // reste vient du contenu recupere, ou du brut a defaut.
    let messageId = String(data.message_id || data.messageId || '').trim();
    let inReplyTo = String(data.in_reply_to || '').trim();
    let references = String(data.references || '').trim();
    // L enveloppe ne porte pas le corps : on va le chercher. Un envoi manuel,
    // lui, porte deja son texte et ne declenche aucun appel.
    let contenuCherche = false;
    if (!texte && !html && emailId) {
      try {
        const lu = await recupererContenu(emailId);
        texte = String((lu && lu.text) || '').trim();
        html = String((lu && lu.html) || '');
        contenuCherche = true;
        const entetes = entetesEnMinuscules(lu && lu.headers);
        messageId = messageId || String((lu && lu.message_id) || entetes['message-id'] || '').trim();
        inReplyTo = inReplyTo || String(entetes['in-reply-to'] || '').trim();
        references = references || String(entetes.references || '').trim();
        // Sans In-Reply-To ni References dans la reponse structuree, le brut
        // les porte : on ne le lit que dans ce cas, et un brut illisible ne
        // bloque rien (le fil se retrouvera par le sujet, ou sera nouveau).
        if (!inReplyTo && !references && lu && lu.raw && lu.raw.download_url) {
          try {
            const lus = entetesDuBrut(await recupererBrut(lu.raw.download_url));
            inReplyTo = String(lus['in-reply-to'] || '').trim();
            references = String(lus.references || '').trim();
            messageId = messageId || String(lus['message-id'] || '').trim();
          } catch (error) {
            console.warn(`inbound-email: brut du mail ${emailId} illisible, en-tetes de fil ignores (${String((error && error.message) || error).slice(0, 120)})`);
          }
        }
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
      // L ADRESSE PRIME SUR LE PARAMETRE D URL (2026-09-08). Un seul webhook
      // sert tous les centres ; si son URL porte `?centerId=libramont`, un
      // parametre prioritaire classait a Libramont TOUT ce qui arrivait,
      // Gembloux compris, sans erreur ni trace. Mesure sur la production : cinq
      // mails recus, cinq classes libramont, destinataire stocke nulle part.
      // Le parametre ne sert plus que si aucune adresse ne designe un centre ;
      // et quand on retombe sur le defaut, on le DIT, dans le journal et dans
      // la ligne ecrite, pour qu un mail mal classe se voie.
      const adresses = destinatairesDe(data);
      const parAdresse = centreDuDestinataire(adresses);
      // LE PARAMETRE D URL N EST PLUS QU UN OUTIL D ESSAI DE LA PLATEFORME
      // (2026-09-16). L URL du webhook est la meme pour tous les clients : sur
      // un vrai mail du fournisseur, `?centerId=` ne designe personne, et un
      // webhook fige sur libramont y classait tout le courrier non reconnu.
      const centreDemande = parSecretMaison(req) ? centreConnu(url.searchParams.get('centerId')) : '';
      if (!parAdresse && !centreDemande) {
        console.warn(`inbound-email: aucun centre reconnu, mail NON classe ; destinataires recus : ${adresses.join(', ') || '(aucun)'}`);
        sendJson(res, 200, { ok: true, ignored: 'destinataire-inconnu' });
        return;
      }
      const routage = parAdresse ? 'destinataire' : 'parametre';
      const centerId = parAdresse ? parAdresse.id : centreDemande;
      const destinataire = parAdresse ? parAdresse.adresse : (adresses[0] || '');
      const result = await ingest({
        centerId,
        from,
        fromName,
        subject,
        body: text,
        receivedAt: data.receivedAt || data.created_at || null,
        // L'ID du mail, pas celui de la livraison Svix : les reprises du meme
        // mail gardent leur identite, meme si leur horodatage change.
        provider: emailId ? String(data.provider || body.provider || 'resend') : '',
        providerEmailId: emailId,
        requestId: data.requestId || req.headers['idempotency-key'] || null,
        to: destinataire,
        routage,
        messageId,
        inReplyTo,
        references,
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
module.exports.__test = { recupererContenuParDefaut, texteDepuisHtml, entetesDuBrut, entetesEnMinuscules, recupererBrutParDefaut };
