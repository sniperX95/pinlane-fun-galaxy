// LES FILS DE CONVERSATION DES MAILS (2026-09-16, migration 0047).
//
// POURQUOI. Chaque reponse d un client faisait une ligne a part dans la boite :
// « Re: Anniversaire samedi » quatre fois, sans lien entre elles, et personne
// ne savait qui avait lu quoi ni qui avait repondu. Un fil regroupe ce qui va
// ensemble : le message d origine, nos reponses, les reponses du client. Un
// NOUVEAU mail du meme client (sans en-tete de reponse, sans prefixe Re:) est
// une autre conversation : jamais de fusion par simple adresse.
//
// COMMENT UN MAIL TROUVE SON FIL, dans l ordre :
//   1. les en-tetes RFC 5322 (In-Reply-To, References) qui citent le
//      Message-ID d un de NOS messages du MEME centre : c est la preuve forte ;
//   2. sinon, seulement si le sujet porte un prefixe de reponse (Re:, Fwd:...),
//      le fil du meme centre, du meme contact, au meme sujet normalise, actif
//      depuis moins de 90 jours ;
//   3. sinon, un nouveau fil.
//
// TESTABLE SANS BASE : chaque fonction a effets recoit `query` en premier
// argument. Le cloisonnement est dans chaque requete : le centre voyage en
// parametre, jamais un fil, un message ou un Message-ID d un autre centre.
'use strict';

const PREFIXES_DE_REPONSE = /^\s*(?:(?:re|r[ée]|fwd?|tr|r[ée]f|aw)\s*:\s*)+/i;
const IDENTIFIANT_RX = /<[^<>\s]+>/g;

// « Re: Re: Fwd: Anniversaire » -> « Anniversaire ». En boucle : un logiciel
// qui prefixe « TR : » par-dessus un « Re: » ne doit rien laisser.
function sujetSansPrefixe(sujet) {
  let texte = String(sujet || '').trim();
  for (let tour = 0; tour < 10; tour += 1) {
    const suivant = texte.replace(PREFIXES_DE_REPONSE, '').trim();
    if (suivant === texte) break;
    texte = suivant;
  }
  return texte;
}

function sujetNormalise(sujet) {
  return sujetSansPrefixe(sujet).toLowerCase().replace(/\s+/g, ' ').trim();
}

function aUnPrefixeDeReponse(sujet) {
  return PREFIXES_DE_REPONSE.test(String(sujet || ''));
}

// Les identifiants « <...> » d un In-Reply-To ou d un References, sans doublon,
// dans l ordre d apparition.
function identifiantsDeLEntete(valeur) {
  const trouves = String(valeur || '').match(IDENTIFIANT_RX) || [];
  const uniques = [];
  for (const id of trouves) if (!uniques.includes(id)) uniques.push(id);
  return uniques;
}

function motifIlike(texte) {
  return String(texte || '').replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

function entier(valeur) {
  const nombre = Number(valeur);
  return Number.isSafeInteger(nombre) && nombre > 0 ? nombre : null;
}

function texteBrut(valeur) {
  return String(valeur || '').trim();
}

function mapFil(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    centerId: row.center_id || '',
    contactEmail: row.contact_email || '',
    contactName: row.contact_name || '',
    subject: row.subject || '',
    status: row.status || 'open',
    origin: row.origin || 'inbound',
    rootCommunicationId: row.root_communication_id ? Number(row.root_communication_id) : null,
    messageCount: Number(row.message_count || 0),
    inboundCount: Number(row.inbound_count || 0),
    outboundCount: Number(row.outbound_count || 0),
    firstMessageAt: row.first_message_at || null,
    lastMessageAt: row.last_message_at || null,
    lastInboundAt: row.last_inbound_at || null,
    lastOutboundAt: row.last_outbound_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// Le suivi de remise d une ligne `communications` (colonnes 0047). Partage par
// le fil et par la liste des envoyes : une seule forme a l ecran.
function resumeSuivi(row = {}) {
  const lire = (serpent, chameau) => (row[serpent] !== undefined ? row[serpent] : row[chameau]);
  return {
    deliveredAt: lire('delivered_at', 'deliveredAt') || null,
    openedAt: lire('opened_at', 'openedAt') || null,
    openCount: Number(lire('open_count', 'openCount') || 0),
    clickedAt: lire('clicked_at', 'clickedAt') || null,
    clickCount: Number(lire('click_count', 'clickCount') || 0),
    bouncedAt: lire('bounced_at', 'bouncedAt') || null,
    complainedAt: lire('complained_at', 'complainedAt') || null,
    lastError: String(lire('last_error', 'lastError') || ''),
  };
}

// Meme regle que getStaffEmailOrigin cote console, avec les valeurs fines que
// la page Envoyes filtre : inbound, auto, manuel, campagne, test.
function origineDuMessage(row = {}) {
  if (row.direction === 'inbound' || row.status === 'received') return 'inbound';
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const drapeau = (valeur) => valeur === true || valeur === 'true';
  if (drapeau(payload.test)) return 'test';
  if (payload.campaignId) return 'campagne';
  if (drapeau(payload.direct) || drapeau(payload.directEmail) || drapeau(payload.relance) || drapeau(payload.clientMessage)) return 'manuel';
  return 'auto';
}

const LIBELLES_SEQUENCES = {
  request_received: 'Demande reçue',
  confirmation: 'Confirmation',
  reminder_48h: 'Rappel avant la venue',
  post_visit_followup: 'Merci post-visite',
  birthday_j30: '30 jours avant l anniversaire',
  reactivation: 'Réactiver les clients dormants',
  delay_update: 'Changement d horaire',
  delay_change: 'Ajustement de planning',
  staff_review_request: 'Réservation à valider',
  staff_alert: 'Alerte terrain',
  delay_staff_attention: 'Décision retard',
  reminder_day_sms: 'Rappel SMS',
  inbound_email: 'Mail reçu',
};

// Les noms des sequences personnalisees du centre, pour lire « Relance J+7 »
// au lieu de « custom_cs_x7k2 ». Fail-soft : sans lecture, le libelle generique.
async function libellesDesSequences(query, centerId) {
  const perso = new Map();
  try {
    const result = await query(
      "select settings->'custom_sequences' as sequences from center_automation_settings where center_id = $1 limit 1;",
      [centerId],
    );
    const liste = result.rows && result.rows[0] ? result.rows[0].sequences : null;
    for (const sequence of Array.isArray(liste) ? liste : []) {
      if (sequence && sequence.id) perso.set(String(sequence.id), String(sequence.name || ''));
    }
  } catch (error) { /* le libelle generique suffit */ }
  return (templateId) => {
    const id = String(templateId || '');
    if (!id) return '';
    if (LIBELLES_SEQUENCES[id]) return LIBELLES_SEQUENCES[id];
    if (id.startsWith('custom_')) return perso.get(id.slice(7)) || 'Séquence personnalisée';
    if (id.startsWith('test_')) {
      const cle = id.slice(5);
      if (cle === 'design') return 'Test du design';
      if (cle === 'custom') return 'Test d une séquence personnalisée';
      return `Test : ${LIBELLES_SEQUENCES[cle] || cle}`;
    }
    if (id.startsWith('campaign_')) return 'Campagne';
    if (id.startsWith('studio_')) return 'Message manuel';
    if (id.startsWith('relance_')) return 'Relance';
    if (id.startsWith('client_')) return 'Message client';
    if (id.startsWith('simulation_')) return 'Simulation';
    return '';
  };
}

// Le texte lisible d un message : l alternative texte quand elle existe, sinon
// le corps, deshabille de son HTML s il en a.
function texteDuMessage(row = {}) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const texte = String(payload.textBody || '').trim();
  if (texte) return texte;
  const corps = String(row.body || '');
  if (!/<[a-z!/][^>]*>/i.test(corps)) return corps.trim();
  return corps
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/tr|\/h1|\/li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// La partie tapee par la personne et la citation, avec la regle partagee par
// l ecran et par l agent (assets/email-thread.js).
function separerLeMessage(texte) {
  const { separerCitation, historiqueLisible } = require('../assets/email-thread.js');
  const parts = separerCitation(texte);
  return {
    message: parts.message || String(texte || '').trim(),
    historique: historiqueLisible(parts.historique || ''),
  };
}

function extrait(texte, longueur = 160) {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim();
  return propre.length > longueur ? `${propre.slice(0, longueur - 1).trim()}…` : propre;
}

function mapPrise(row) {
  if (!row) return null;
  return {
    memberId: row.member_id || '',
    memberName: row.member_name || '',
    memberRole: row.member_role || '',
    expiresAt: row.expires_at || null,
  };
}

// ---------------------------------------------------------------------------
// RESOLUTION D UN FIL
// ---------------------------------------------------------------------------
async function resoudreFilEntrant(query, { centerId, contactEmail = '', subject = '', inReplyTo = '', references = '' } = {}) {
  const centre = texteBrut(centerId);
  if (!centre) return { threadId: null, via: '' };
  const ids = identifiantsDeLEntete(inReplyTo);
  for (const id of identifiantsDeLEntete(references)) if (!ids.includes(id)) ids.push(id);
  if (ids.length) {
    const result = await query(
      `select thread_id from communications
       where center_id = $1 and message_id = any($2::text[]) and thread_id is not null
       order by created_at desc limit 1;`,
      [centre, ids],
    );
    const trouve = result.rows && result.rows[0] ? entier(result.rows[0].thread_id) : null;
    if (trouve) return { threadId: trouve, via: 'en-tete' };
  }
  if (aUnPrefixeDeReponse(subject)) {
    const result = await query(
      `select id from email_threads
       where center_id = $1 and lower(contact_email) = $2
         and lower(btrim(regexp_replace(subject, '\\s+', ' ', 'g'))) = $3
         and last_message_at > now() - interval '90 days'
       order by last_message_at desc limit 1;`,
      [centre, String(contactEmail || '').trim().toLowerCase(), sujetNormalise(subject)],
    );
    const trouve = result.rows && result.rows[0] ? entier(result.rows[0].id) : null;
    if (trouve) return { threadId: trouve, via: 'sujet' };
  }
  return { threadId: null, via: '' };
}

async function creerFil(query, {
  centerId, contactEmail = '', contactName = '', subject = '', origin = 'inbound', rootCommunicationId = null, at = null,
} = {}) {
  const result = await query(
    `insert into email_threads (center_id, contact_email, contact_name, subject, status, origin, root_communication_id, first_message_at, last_message_at)
     values ($1, $2, $3, $4, 'open', $5, $6, coalesce($7::timestamptz, now()), coalesce($7::timestamptz, now()))
     returning id;`,
    [
      texteBrut(centerId),
      String(contactEmail || '').trim().toLowerCase(),
      String(contactName || '').trim().slice(0, 200),
      sujetSansPrefixe(subject).slice(0, 500),
      origin === 'outbound' ? 'outbound' : 'inbound',
      entier(rootCommunicationId),
      at || null,
    ],
  );
  return result.rows && result.rows[0] ? entier(result.rows[0].id) : null;
}

// Un fil pour un message deja en base qui n en a pas (le message repondu, par
// exemple) : cree ET rattache, pour que le fil compte bien son premier message.
async function filPourMessageExistant(query, ligne) {
  const payload = ligne.payload && typeof ligne.payload === 'object' ? ligne.payload : {};
  const threadId = await creerFil(query, {
    centerId: ligne.center_id,
    contactEmail: ligne.recipient,
    contactName: payload.contactName || payload.fromName || payload.clientName || payload.name || '',
    subject: ligne.subject,
    origin: ligne.direction === 'outbound' ? 'outbound' : 'inbound',
    rootCommunicationId: ligne.id,
    at: ligne.created_at || null,
  });
  if (!threadId) return null;
  await rattacherAuFil(query, { communicationId: ligne.id, threadId, direction: ligne.direction, at: ligne.created_at || null, centerId: ligne.center_id });
  return threadId;
}

async function resoudreFilSortant(query, { centerId, recipient = '', replyToCommunicationId = null, threadId = null } = {}) {
  const centre = texteBrut(centerId);
  if (!centre) return { threadId: null, via: '' };
  const fourni = entier(threadId);
  if (fourni) {
    const result = await query('select id from email_threads where id = $1 and center_id = $2 limit 1;', [fourni, centre]);
    if (result.rows && result.rows[0]) return { threadId: fourni, via: 'fourni' };
  }
  const repondu = entier(replyToCommunicationId);
  if (repondu) {
    const result = await query(
      `select id, center_id, direction, recipient, subject, payload, thread_id, created_at
       from communications where id = $1 and center_id = $2 limit 1;`,
      [repondu, centre],
    );
    const ligne = result.rows && result.rows[0];
    if (ligne) {
      const existant = entier(ligne.thread_id);
      if (existant) return { threadId: existant, via: 'reponse' };
      const cree = await filPourMessageExistant(query, ligne);
      if (cree) return { threadId: cree, via: 'reponse' };
    }
  }
  return { threadId: null, via: '' };
}

// Rattache un message a son fil et met le fil a jour : compteurs, dates et
// STATUT. Un entrant rouvre TOUJOURS (un client qui ecrit attend une reponse,
// meme sur un fil termine) ; un sortant marque « repondu », sauf si le fil a
// ete termine a la main.
async function rattacherAuFil(query, { communicationId, threadId, direction = 'outbound', at = null, centerId = '' } = {}) {
  const id = entier(communicationId);
  const fil = entier(threadId);
  if (!id || !fil) return false;
  const entrant = direction === 'inbound';
  const centre = texteBrut(centerId);
  const majMessage = await query(
    `update communications set thread_id = $2 where id = $1${centre ? ' and center_id = $3' : ''} returning id;`,
    centre ? [id, fil, centre] : [id, fil],
  );
  if (!majMessage.rows || !majMessage.rows.length) return false;
  await query(
    `update email_threads set
       message_count = message_count + 1,
       inbound_count = inbound_count + $3,
       outbound_count = outbound_count + $4,
       last_message_at = greatest(last_message_at, coalesce($2::timestamptz, now())),
       first_message_at = least(first_message_at, coalesce($2::timestamptz, now())),
       last_inbound_at = case when $5::boolean then greatest(coalesce(last_inbound_at, coalesce($2::timestamptz, now())), coalesce($2::timestamptz, now())) else last_inbound_at end,
       last_outbound_at = case when $5::boolean then last_outbound_at else greatest(coalesce(last_outbound_at, coalesce($2::timestamptz, now())), coalesce($2::timestamptz, now())) end,
       status = case when $5::boolean then 'open' when status = 'closed' then 'closed' else 'answered' end,
       updated_at = now()
     where id = $1;`,
    [fil, at || null, entrant ? 1 : 0, entrant ? 0 : 1, entrant],
  );
  return true;
}

// Appelee par createCommunication (lib/database.js) pour tout mail sans fil.
// FAIL-SOFT, sans exception : un fil manquant ne bloque jamais un envoi ni une
// reception. Le fil se rattrape plus tard (migration, rejeu) ; un mail perdu
// ne se rattrape pas.
async function assurerFilPourCommunication(query, communication) {
  try {
    if (!communication || communication.channel !== 'email') return null;
    const existant = entier(communication.threadId !== undefined ? communication.threadId : communication.thread_id);
    if (existant) return existant;
    const id = entier(communication.id);
    const centerId = texteBrut(communication.centerId || communication.center_id);
    if (!id || !centerId) return null;
    const payload = communication.payload && typeof communication.payload === 'object' ? communication.payload : {};
    const direction = communication.direction === 'inbound' ? 'inbound' : 'outbound';
    const at = communication.createdAt || communication.created_at || null;
    let threadId = null;
    if (direction === 'inbound') {
      const trouve = await resoudreFilEntrant(query, {
        centerId,
        contactEmail: communication.recipient,
        subject: communication.subject,
        inReplyTo: payload.inReplyTo || communication.inReplyTo || communication.in_reply_to || '',
        references: payload.references || communication.references || communication.references_ids || '',
      });
      threadId = trouve.threadId;
    } else {
      const trouve = await resoudreFilSortant(query, {
        centerId,
        recipient: communication.recipient,
        replyToCommunicationId: payload.replyToCommunicationId,
        threadId: payload.threadId,
      });
      threadId = trouve.threadId;
    }
    if (!threadId) {
      threadId = await creerFil(query, {
        centerId,
        contactEmail: communication.recipient,
        contactName: payload.contactName || payload.fromName || payload.clientName || payload.name || '',
        subject: communication.subject,
        origin: direction,
        rootCommunicationId: id,
        at,
      });
    }
    if (!threadId) return null;
    const rattache = await rattacherAuFil(query, { communicationId: id, threadId, direction, at, centerId });
    return rattache ? threadId : null;
  } catch (error) {
    console.warn(`email-threads: fil non rattache pour le message ${communication && communication.id} (${String((error && error.message) || error).slice(0, 140)})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// LECTURE
// ---------------------------------------------------------------------------
const FILTRES = { 'a-repondre': 'open', repondus: 'answered', termines: 'closed', tous: '' };

async function listerFils(query, { centerId, filtre = 'a-repondre', recherche = '', limit = 50, offset = 0, memberId = '' } = {}) {
  const centre = texteBrut(centerId);
  if (!centre) return { threads: [], total: 0 };
  const statut = Object.prototype.hasOwnProperty.call(FILTRES, filtre) ? FILTRES[filtre] : 'open';
  const borne = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const saut = Math.max(Number(offset) || 0, 0);
  const params = [centre];
  let where = 'center_id = $1';
  if (statut) {
    params.push(statut);
    where += ` and status = $${params.length}`;
  }
  const mots = String(recherche || '').trim().slice(0, 120);
  if (mots) {
    params.push(`%${motifIlike(mots)}%`);
    const n = params.length;
    where += ` and (contact_email ilike $${n} or contact_name ilike $${n} or subject ilike $${n})`;
  }
  const compte = await query(`select count(*)::int as n from email_threads where ${where};`, params);
  const total = Number((compte.rows && compte.rows[0] && compte.rows[0].n) || 0);
  const page = await query(
    `select * from email_threads where ${where} order by last_message_at desc, id desc limit $${params.length + 1} offset $${params.length + 2};`,
    [...params, borne, saut],
  );
  const fils = (page.rows || []).map(mapFil);
  if (!fils.length) return { threads: [], total };
  const ids = fils.map((fil) => fil.id);

  const derniers = await query(
    `select distinct on (thread_id) id, thread_id, direction, body, payload, created_at, sent_at
     from communications where thread_id = any($1::bigint[]) and center_id = $2
     order by thread_id, created_at desc, id desc;`,
    [ids, centre],
  );
  const derniersEntrants = await query(
    `select distinct on (thread_id) id, thread_id, payload, created_at
     from communications where thread_id = any($1::bigint[]) and center_id = $2 and direction = 'inbound'
     order by thread_id, created_at desc, id desc;`,
    [ids, centre],
  );
  const entrantIds = (derniersEntrants.rows || []).map((row) => Number(row.id));
  const lectures = entrantIds.length
    ? await query(
      `select communication_id, member_id, member_name, member_role, last_read_at
       from communication_reads where communication_id = any($1::bigint[]) order by last_read_at asc;`,
      [entrantIds],
    )
    : { rows: [] };
  const prises = entrantIds.length
    ? await query(
      `select communication_id, member_id, member_name, member_role, expires_at
       from ops_email_claims where communication_id = any($1::bigint[]) and expires_at > now();`,
      [entrantIds],
    )
    : { rows: [] };
  const reponses = await query(
    `select distinct on (thread_id) thread_id, payload, sent_at, created_at
     from communications where thread_id = any($1::bigint[]) and center_id = $2 and direction = 'outbound'
       and coalesce(payload->>'sentBy', '') <> ''
     order by thread_id, created_at desc, id desc;`,
    [ids, centre],
  );

  const dernierParFil = new Map((derniers.rows || []).map((row) => [Number(row.thread_id), row]));
  const entrantParFil = new Map((derniersEntrants.rows || []).map((row) => [Number(row.thread_id), row]));
  const reponseParFil = new Map((reponses.rows || []).map((row) => [Number(row.thread_id), row]));
  const lecturesParMessage = new Map();
  for (const row of lectures.rows || []) {
    const cle = Number(row.communication_id);
    if (!lecturesParMessage.has(cle)) lecturesParMessage.set(cle, []);
    lecturesParMessage.get(cle).push({ memberId: row.member_id || '', memberName: row.member_name || '', memberRole: row.member_role || '', lastReadAt: row.last_read_at || null });
  }
  const priseParMessage = new Map((prises.rows || []).map((row) => [Number(row.communication_id), mapPrise(row)]));
  const moi = texteBrut(memberId);

  const threads = fils.map((fil) => {
    const dernier = dernierParFil.get(fil.id) || null;
    const entrant = entrantParFil.get(fil.id) || null;
    const analyse = entrant && entrant.payload && typeof entrant.payload === 'object' && entrant.payload.analysis && typeof entrant.payload.analysis === 'object'
      ? entrant.payload.analysis
      : null;
    const lecteurs = entrant ? (lecturesParMessage.get(Number(entrant.id)) || []) : [];
    const reponse = reponseParFil.get(fil.id) || null;
    const sentBy = reponse && reponse.payload && typeof reponse.payload === 'object' && reponse.payload.sentBy && typeof reponse.payload.sentBy === 'object'
      ? reponse.payload.sentBy
      : null;
    return {
      ...fil,
      lastDirection: dernier ? (dernier.direction === 'inbound' ? 'inbound' : 'outbound') : fil.origin,
      snippet: dernier ? extrait(separerLeMessage(texteDuMessage(dernier)).message) : '',
      lastInboundId: entrant ? Number(entrant.id) : null,
      luParMoi: Boolean(moi && lecteurs.some((lecteur) => lecteur.memberId === moi)),
      lecteurs,
      prise: entrant ? (priseParMessage.get(Number(entrant.id)) || null) : null,
      intention: analyse ? String(analyse.intent || '') : '',
      question: Boolean(analyse && String(analyse.question || '').trim() && !analyse.questionRepondue),
      reponduPar: sentBy
        ? { memberName: String(sentBy.memberName || ''), memberRole: String(sentBy.memberRole || ''), at: reponse.sent_at || reponse.created_at || null }
        : null,
    };
  });
  return { threads, total };
}

function mapperMessage(row, { evenements = [], lectures = [], prise = null, libelle = () => '' } = {}) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const direction = row.direction === 'inbound' ? 'inbound' : 'outbound';
  const texte = texteDuMessage(row);
  const parts = separerLeMessage(texte);
  const origine = origineDuMessage(row);
  const sentBy = payload.sentBy && typeof payload.sentBy === 'object' ? payload.sentBy : null;
  const relaye = direction === 'inbound' && Boolean(payload.contactSource) && payload.contactSource !== 'expediteur';
  return {
    id: Number(row.id),
    direction,
    subject: row.subject || '',
    body: row.body || '',
    textBody: texte,
    message: parts.message,
    historique: parts.historique,
    createdAt: row.created_at || null,
    sentAt: row.sent_at || null,
    receivedAt: payload.receivedAt || null,
    status: row.status || '',
    templateId: row.template_id || '',
    origine,
    sequenceLabel: origine === 'auto' ? libelle(row.template_id) : '',
    sentBy,
    // Un mail du formulaire du site (2026-09-17) : le client, pas l adresse
    // technique du site, qui reste lisible dans `via`.
    fromEmail: relaye ? String(row.recipient || '') : String(payload.fromEmail || payload.from || ''),
    fromLabel: relaye ? String(payload.contactName || '') : String(payload.fromLabel || payload.fromName || ''),
    via: relaye ? String(payload.relais || payload.from || '') : '',
    recipient: row.recipient || '',
    providerMessageId: row.provider_message_id || '',
    messageId: row.message_id || '',
    inReplyTo: row.in_reply_to || '',
    suivi: resumeSuivi(row),
    evenements,
    lectures,
    prise,
    analysis: direction === 'inbound' && payload.analysis && typeof payload.analysis === 'object' ? payload.analysis : null,
    reservationId: row.reservation_id ? Number(row.reservation_id) : null,
    errorReason: String(row.last_error || ''),
    threadId: row.thread_id ? Number(row.thread_id) : null,
  };
}

async function chargerFil(query, { centerId, threadId } = {}) {
  const centre = texteBrut(centerId);
  const id = entier(threadId);
  if (!centre || !id) return null;
  const filResult = await query('select * from email_threads where id = $1 and center_id = $2 limit 1;', [id, centre]);
  const fil = filResult.rows && filResult.rows[0] ? mapFil(filResult.rows[0]) : null;
  if (!fil) return null;
  const lignes = await query(
    'select * from communications where thread_id = $1 and center_id = $2 order by created_at asc, id asc;',
    [id, centre],
  );
  const rows = lignes.rows || [];
  const ids = rows.map((row) => Number(row.id));
  const [evenements, lectures, prises, libelle] = await Promise.all([
    ids.length
      ? query(
        `select communication_id, event_type, occurred_at, data from email_events
         where communication_id = any($1::bigint[]) order by occurred_at asc, id asc;`,
        [ids],
      )
      : { rows: [] },
    ids.length
      ? query(
        `select communication_id, member_id, member_name, member_role, first_read_at, last_read_at, read_count
         from communication_reads where communication_id = any($1::bigint[]) order by first_read_at asc;`,
        [ids],
      )
      : { rows: [] },
    ids.length
      ? query(
        `select communication_id, member_id, member_name, member_role, expires_at
         from ops_email_claims where communication_id = any($1::bigint[]) and expires_at > now();`,
        [ids],
      )
      : { rows: [] },
    libellesDesSequences(query, centre),
  ]);
  const evenementsPar = new Map();
  for (const row of evenements.rows || []) {
    const cle = Number(row.communication_id);
    if (!evenementsPar.has(cle)) evenementsPar.set(cle, []);
    evenementsPar.get(cle).push({ type: row.event_type || '', occurredAt: row.occurred_at || null, data: row.data && typeof row.data === 'object' ? row.data : {} });
  }
  const lecturesPar = new Map();
  for (const row of lectures.rows || []) {
    const cle = Number(row.communication_id);
    if (!lecturesPar.has(cle)) lecturesPar.set(cle, []);
    lecturesPar.get(cle).push({
      memberId: row.member_id || '', memberName: row.member_name || '', memberRole: row.member_role || '',
      firstReadAt: row.first_read_at || null, lastReadAt: row.last_read_at || null, readCount: Number(row.read_count || 0),
    });
  }
  const prisePar = new Map((prises.rows || []).map((row) => [Number(row.communication_id), mapPrise(row)]));
  const messages = rows.map((row) => mapperMessage(row, {
    evenements: evenementsPar.get(Number(row.id)) || [],
    lectures: lecturesPar.get(Number(row.id)) || [],
    prise: prisePar.get(Number(row.id)) || null,
    libelle,
  }));

  const contactEmail = fil.contactEmail.toLowerCase();
  const [autres, nb] = await Promise.all([
    query(
      `select id, subject, status, last_message_at, message_count from email_threads
       where center_id = $1 and lower(contact_email) = $2 and id <> $3
       order by last_message_at desc limit 10;`,
      [centre, contactEmail, id],
    ),
    query('select count(*)::int as n from email_threads where center_id = $1 and lower(contact_email) = $2;', [centre, contactEmail]),
  ]);
  return {
    thread: fil,
    messages,
    contact: {
      email: fil.contactEmail,
      name: fil.contactName,
      autresFils: (autres.rows || []).map((row) => ({
        id: Number(row.id), subject: row.subject || '', status: row.status || 'open', lastMessageAt: row.last_message_at || null, messageCount: Number(row.message_count || 0),
      })),
      nbFils: Number((nb.rows && nb.rows[0] && nb.rows[0].n) || 0),
    },
  };
}

// ---------------------------------------------------------------------------
// LECTURES PAR L EQUIPE, STATUT
// ---------------------------------------------------------------------------
async function marquerLu(query, { centerId, communicationIds = [], member = {} } = {}) {
  const centre = texteBrut(centerId);
  const ids = [...new Set((Array.isArray(communicationIds) ? communicationIds : []).map(entier).filter(Boolean))].slice(0, 200);
  const memberId = texteBrut(member && member.id);
  if (!centre || !ids.length || !memberId) return { marques: 0 };
  const result = await query(
    `insert into communication_reads (communication_id, member_id, member_name, member_role, first_read_at, last_read_at, read_count)
     select c.id, $2, $3, $4, now(), now(), 1
     from communications c
     where c.id = any($1::bigint[]) and c.center_id = $5
     on conflict (communication_id, member_id) do update
       set last_read_at = now(),
           read_count = communication_reads.read_count + 1,
           member_name = excluded.member_name,
           member_role = excluded.member_role
     returning communication_id;`,
    [ids, memberId, String((member && member.name) || '').slice(0, 120), String((member && member.role) || '').slice(0, 80), centre],
  );
  return { marques: Number(result.rowCount !== undefined ? result.rowCount : (result.rows || []).length) };
}

const STATUTS_DE_FIL = ['open', 'answered', 'closed'];

async function changerStatutFil(query, { centerId, threadId, status } = {}) {
  const centre = texteBrut(centerId);
  const id = entier(threadId);
  const statut = String(status || '').trim();
  if (!centre || !id) return null;
  if (!STATUTS_DE_FIL.includes(statut)) {
    const error = new Error('Statut de conversation inconnu.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const result = await query(
    'update email_threads set status = $3, updated_at = now() where id = $1 and center_id = $2 returning *;',
    [id, centre, statut],
  );
  return result.rows && result.rows[0] ? mapFil(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// VUE GLOBALE ET ENVOYES
// ---------------------------------------------------------------------------
const HORS_SIMULATION = "coalesce(payload->>'simulation', '') = '' and coalesce(idempotency_key, '') not like 'simulation:%'";

async function compteursDeLaBoite(query, { centerId } = {}) {
  const centre = texteBrut(centerId);
  const vide = {
    aRepondre: 0, plusAncienneAttenteAt: null, recus7j: 0, envoyes7j: 0, remis7j: 0, ouverts7j: 0, echecs7j: 0,
    enAttente: 0, programmes24h: 0, questions: 0,
    suivi: { evenementsRecus30j: false, ouverturesObservees: false, clicsObserves: false },
  };
  if (!centre) return vide;
  const [messages, fils, evenements, questions] = await Promise.all([
    query(
      `select
         count(*) filter (where direction = 'inbound' and created_at > now() - interval '7 days')::int as recus7j,
         count(*) filter (where direction = 'outbound' and status in ('sent', 'delivered') and coalesce(sent_at, created_at) > now() - interval '7 days')::int as envoyes7j,
         count(*) filter (where direction = 'outbound' and delivered_at > now() - interval '7 days')::int as remis7j,
         count(*) filter (where direction = 'outbound' and opened_at > now() - interval '7 days')::int as ouverts7j,
         count(*) filter (where direction = 'outbound' and status = 'failed' and created_at > now() - interval '7 days')::int as echecs7j,
         count(*) filter (where direction = 'outbound' and status in ('queued', 'processing'))::int as en_attente,
         count(*) filter (where direction = 'outbound' and status = 'queued' and scheduled_at > now() and scheduled_at <= now() + interval '24 hours')::int as programmes24h
       from communications
       where center_id = $1 and channel = 'email' and ${HORS_SIMULATION};`,
      [centre],
    ),
    query(
      `select count(*) filter (where status = 'open')::int as a_repondre,
              min(last_inbound_at) filter (where status = 'open') as plus_ancienne
       from email_threads where center_id = $1;`,
      [centre],
    ),
    query(
      `select
         exists(select 1 from email_events where center_id = $1 and occurred_at > now() - interval '30 days') as evenements,
         exists(select 1 from email_events where center_id = $1 and event_type = 'opened') as ouvertures,
         exists(select 1 from email_events where center_id = $1 and event_type = 'clicked') as clics;`,
      [centre],
    ),
    query(
      `select count(*)::int as n from communications
       where center_id = $1 and direction = 'inbound'
         and coalesce(payload->'analysis'->>'question', '') <> ''
         and coalesce(payload->'analysis'->>'questionRepondue', '') = '';`,
      [centre],
    ),
  ]);
  const m = (messages.rows && messages.rows[0]) || {};
  const f = (fils.rows && fils.rows[0]) || {};
  const e = (evenements.rows && evenements.rows[0]) || {};
  const q = (questions.rows && questions.rows[0]) || {};
  return {
    aRepondre: Number(f.a_repondre || 0),
    plusAncienneAttenteAt: f.plus_ancienne || null,
    recus7j: Number(m.recus7j || 0),
    envoyes7j: Number(m.envoyes7j || 0),
    remis7j: Number(m.remis7j || 0),
    ouverts7j: Number(m.ouverts7j || 0),
    echecs7j: Number(m.echecs7j || 0),
    enAttente: Number(m.en_attente || 0),
    programmes24h: Number(m.programmes24h || 0),
    questions: Number(q.n || 0),
    suivi: {
      evenementsRecus30j: e.evenements === true,
      ouverturesObservees: e.ouvertures === true,
      clicsObserves: e.clics === true,
    },
  };
}

const ORIGINES = ['tous', 'auto', 'manuel', 'campagne', 'test'];
const STATUTS_ENVOYES = ['tous', 'attente', 'envoyes', 'remis', 'ouverts', 'echecs', 'a-valider'];
const DRAPEAUX_MANUELS = "(payload->>'direct' = 'true' or payload->>'directEmail' = 'true' or payload->>'relance' = 'true' or payload->>'clientMessage' = 'true')";

async function listerEnvoyes(query, { centerId, origine = 'tous', statut = 'tous', recherche = '', limit = 100, offset = 0 } = {}) {
  const centre = texteBrut(centerId);
  if (!centre) return { messages: [], total: 0 };
  const params = [centre];
  const clauses = [`center_id = $1`, `channel = 'email'`, `direction = 'outbound'`, HORS_SIMULATION];
  const choixOrigine = ORIGINES.includes(origine) ? origine : 'tous';
  if (choixOrigine === 'test') clauses.push("payload->>'test' = 'true'");
  else if (choixOrigine === 'campagne') clauses.push("coalesce(payload->>'campaignId', '') <> ''");
  else if (choixOrigine === 'manuel') clauses.push(`${DRAPEAUX_MANUELS} and coalesce(payload->>'test', '') <> 'true' and coalesce(payload->>'campaignId', '') = ''`);
  else if (choixOrigine === 'auto') clauses.push(`not ${DRAPEAUX_MANUELS} and coalesce(payload->>'test', '') <> 'true' and coalesce(payload->>'campaignId', '') = ''`);
  const choixStatut = STATUTS_ENVOYES.includes(statut) ? statut : 'tous';
  if (choixStatut === 'attente') clauses.push("status in ('queued', 'processing', 'draft')");
  else if (choixStatut === 'envoyes') clauses.push("status in ('sent', 'delivered')");
  else if (choixStatut === 'remis') clauses.push('delivered_at is not null');
  else if (choixStatut === 'ouverts') clauses.push('opened_at is not null');
  else if (choixStatut === 'echecs') clauses.push("status = 'failed'");
  else if (choixStatut === 'a-valider') clauses.push("template_id = 'staff_review_request'");
  const mots = String(recherche || '').trim().slice(0, 120);
  if (mots) {
    params.push(`%${motifIlike(mots)}%`);
    clauses.push(`(recipient ilike $${params.length} or subject ilike $${params.length})`);
  }
  const where = clauses.join(' and ');
  const borne = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const saut = Math.max(Number(offset) || 0, 0);
  const [compte, page, libelle] = await Promise.all([
    query(`select count(*)::int as n from communications where ${where};`, params),
    query(
      `select c.*,
              exists(select 1 from communications r where r.thread_id = c.thread_id and r.center_id = c.center_id
                       and r.direction = 'inbound' and r.created_at > coalesce(c.sent_at, c.created_at)) as a_recu_une_reponse
       from communications c where ${where}
       order by coalesce(c.sent_at, c.scheduled_at, c.created_at) desc, c.id desc
       limit $${params.length + 1} offset $${params.length + 2};`,
      [...params, borne, saut],
    ),
    libellesDesSequences(query, centre),
  ]);
  const messages = (page.rows || []).map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const origineLigne = origineDuMessage(row);
    return {
      id: Number(row.id),
      centerId: row.center_id || centre,
      reservationId: row.reservation_id ? Number(row.reservation_id) : null,
      direction: 'outbound',
      templateId: row.template_id || '',
      recipient: row.recipient || '',
      subject: row.subject || '',
      body: row.body || '',
      textBody: String(payload.textBody || ''),
      status: row.status || '',
      providerMessageId: row.provider_message_id || '',
      attempts: Number(row.attempts || 0),
      lastError: String(row.last_error || ''),
      scheduledAt: row.scheduled_at || null,
      sentAt: row.sent_at || null,
      createdAt: row.created_at || null,
      fromEmail: String(payload.fromEmail || ''),
      fromLabel: String(payload.fromLabel || ''),
      clientName: String(payload.clientName || ''),
      campaignId: payload.campaignId || null,
      origine: origineLigne,
      sequenceLabel: origineLigne === 'auto' ? libelle(row.template_id) : (origineLigne === 'test' ? libelle(row.template_id) : ''),
      sentBy: payload.sentBy && typeof payload.sentBy === 'object' ? payload.sentBy : null,
      suivi: resumeSuivi(row),
      threadId: row.thread_id ? Number(row.thread_id) : null,
      messageId: row.message_id || '',
      aRecuUneReponse: row.a_recu_une_reponse === true,
    };
  });
  return { messages, total: Number((compte.rows && compte.rows[0] && compte.rows[0].n) || 0) };
}

module.exports = {
  sujetSansPrefixe,
  sujetNormalise,
  aUnPrefixeDeReponse,
  identifiantsDeLEntete,
  resoudreFilEntrant,
  resoudreFilSortant,
  creerFil,
  rattacherAuFil,
  assurerFilPourCommunication,
  listerFils,
  chargerFil,
  marquerLu,
  changerStatutFil,
  resumeSuivi,
  origineDuMessage,
  libellesDesSequences,
  compteursDeLaBoite,
  listerEnvoyes,
  mapFil,
  __test: { texteDuMessage, extrait, motifIlike, LIBELLES_SEQUENCES },
};
