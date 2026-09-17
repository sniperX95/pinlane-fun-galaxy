// LES FILS DE CONVERSATION DES MAILS (2026-09-16, migration 0047).
//
// POURQUOI CE GATE EXISTE. Movsar : « la reponse du client au meme mail reste
// dans le meme fil ; un nouveau mail du meme client qui n est pas une reponse
// est un autre fil ; on voit qui a lu, qui a repondu ». Avant 0047, chaque
// reponse faisait un message a part. Ce gate prouve, sur le VRAI code
// (lib/email-threads, lib/database.createCommunication, lib/email-agent,
// lib/ops-communications.sendDirectEmail et sendEmail, lib/email-events,
// api/ops.js) et une base en memoire, que :
//
//   [A] une reponse du client dont In-Reply-To cite NOTRE Message-ID rejoint
//       le fil de notre message ;
//   [B] References seul suffit ;
//   [C] un « Re: » sans en-tete rejoint le fil du meme contact au meme sujet
//       (moins de 90 jours) ; [C2] le MEME sujet SANS prefixe fait un fil neuf ;
//   [D] un nouveau mail du meme contact fait un nouveau fil (jamais de fusion
//       par simple adresse) ;
//   [E] une reponse manuelle (replyToCommunicationId) rejoint le fil, part avec
//       In-Reply-To et References vers le fournisseur, et prend « Re: » + le
//       sujet d origine si son sujet est vide ;
//   [F] une confirmation automatique cree son fil ; l evenement email.sent lui
//       donne son Message-ID ; la reponse du client la rejoint ;
//   [G] les statuts : open -> answered -> closed -> reouverture par un entrant ;
//   [H] un Message-ID d un AUTRE centre ne rattache jamais (isolation) ;
//   [I] marquerLu incremente, luParMoi et lecteurs sont justes, un id d un
//       autre centre est ignore ;
//   [J] listerFils : filtres, recherche, extrait sans citation, reponduPar ;
//   [K] emailThread d un autre centre repond 404 par le VRAI dispatcher.
//
// HONNETETE : 'pg' est remplace dans require.cache AVANT tout require
// applicatif, le reseau est une sonde, chaque propriete a son contraste, et
// chaque garde a sa CONTRE-EPREUVE par mutation compilee en memoire (crochet
// Module.prototype._compile, disque jamais touche, ancre absente = erreur).
//
// Usage : node scripts/email-threads-check.js
'use strict';
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-email-threads-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-EEEE';
process.env.RESEND_API_KEY = 'gate-fake-key';
process.env.RESEND_FROM = 'contact@pinlane.be';
process.env.PUBLIC_APP_URL = 'https://app.pinlane.be';
for (const cle of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'RESEND_REPLY_TO', 'CENTER_REPLY_TO', 'STAFF_REVIEW_EMAIL', 'RESERVATION_STAFF_EMAIL']) delete process.env[cle];

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE. Un moteur SQL BORNE : il reconnait les formes exactes
// que le code emet et OBEIT AU TEXTE des requetes (un filtre de centre n est
// applique que si le SQL le porte). C est ce qui permet aux contre-epreuves
// de rougir : une requete qui perd sa borne rend les lignes des autres.
// ---------------------------------------------------------------------------
const DB = { communications: [], email_threads: [], email_events: [], communication_reads: [], ops_email_claims: [], center_automation_settings: [], marketing_suppressions: [] };
const SEQ = { communications: 0, email_threads: 0, email_events: 0 };
const INCONNUES = [];
const now = () => new Date();
const iso = (date) => (date instanceof Date ? date : new Date(date)).toISOString();
const normaliseSujet = (sujet) => String(sujet || '').toLowerCase().replace(/\s+/g, ' ').trim();
const lignes = (rows) => ({ rows, rowCount: rows.length });
const clone = (row) => (row ? JSON.parse(JSON.stringify(row)) : row);
const ilike = (valeur, motif) => {
  const rx = new RegExp(`^${String(motif).replace(/[.*+?^${}()|[\]]/g, '\\$&').replace(/\\%|\\_/g, (m) => m).replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
  return rx.test(String(valeur || ''));
};

function reset() {
  for (const table of Object.keys(DB)) DB[table] = [];
  for (const table of Object.keys(SEQ)) SEQ[table] = 0;
  INCONNUES.length = 0;
}

function triFils(rows) {
  return rows.slice().sort((a, b) => (Date.parse(b.last_message_at) - Date.parse(a.last_message_at)) || (b.id - a.id));
}

function filtreFils(sql, params) {
  let rows = DB.email_threads.filter((t) => t.center_id === params[0]);
  if (/inbound_count > 0/.test(sql)) rows = rows.filter((t) => Number(t.inbound_count) > 0);
  const mStatut = sql.match(/and status = \$(\d+)/);
  if (mStatut) rows = rows.filter((t) => t.status === params[Number(mStatut[1]) - 1]);
  const mRecherche = sql.match(/contact_email ilike \$(\d+)/);
  if (mRecherche) {
    const motif = params[Number(mRecherche[1]) - 1];
    rows = rows.filter((t) => ilike(t.contact_email, motif) || ilike(t.contact_name, motif) || ilike(t.subject, motif));
  }
  return rows;
}

// La page Envoyes (listerEnvoyes) : le filtre OBEIT AU TEXTE de la requete,
// fragment par fragment, comme le ferait le moteur.
const drapeau = (payload, cle) => payload && (payload[cle] === true || payload[cle] === 'true');
const estManuel = (c) => drapeau(c.payload, 'direct') || drapeau(c.payload, 'directEmail') || drapeau(c.payload, 'relance') || drapeau(c.payload, 'clientMessage');
const estTest = (c) => drapeau(c.payload, 'test');
const estCampagne = (c) => Boolean(c.payload && c.payload.campaignId);
const horsSimulation = (c) => !(c.payload && c.payload.simulation) && !String(c.idempotency_key || '').startsWith('simulation:');
const il7 = () => Date.now() - 7 * 86400000;
const il30 = () => Date.now() - 30 * 86400000;
function filtreEnvoyes(sql, params) {
  let rows = DB.communications.filter((c) => c.center_id === params[0] && c.channel === 'email' && c.direction === 'outbound' && horsSimulation(c));
  if (/and payload->>'test' = 'true'/.test(sql)) rows = rows.filter(estTest);
  else if (/and coalesce\(payload->>'campaignId', ''\) <> ''/.test(sql)) rows = rows.filter(estCampagne);
  else if (/and \(payload->>'direct' = 'true'/.test(sql)) rows = rows.filter((c) => estManuel(c) && !estTest(c) && !estCampagne(c));
  else if (/and not \(payload->>'direct' = 'true'/.test(sql)) rows = rows.filter((c) => !estManuel(c) && !estTest(c) && !estCampagne(c));
  if (/status in \('queued', 'processing', 'draft'\)/.test(sql)) rows = rows.filter((c) => ['queued', 'processing', 'draft'].includes(c.status));
  else if (/status in \('sent', 'delivered'\)/.test(sql)) rows = rows.filter((c) => ['sent', 'delivered'].includes(c.status));
  else if (/delivered_at is not null/.test(sql)) rows = rows.filter((c) => c.delivered_at);
  else if (/opened_at is not null/.test(sql)) rows = rows.filter((c) => c.opened_at);
  else if (/status = 'failed'/.test(sql)) rows = rows.filter((c) => c.status === 'failed');
  else if (/template_id = 'staff_review_request'/.test(sql)) rows = rows.filter((c) => c.template_id === 'staff_review_request');
  const mRecherche = sql.match(/recipient ilike \$(\d+)/);
  if (mRecherche) {
    const motif = params[Number(mRecherche[1]) - 1];
    rows = rows.filter((c) => ilike(c.recipient, motif) || ilike(c.subject, motif));
  }
  return rows;
}

function dernierParFil(rows) {
  const parFil = new Map();
  for (const row of rows.slice().sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (b.id - a.id))) {
    if (!parFil.has(row.thread_id)) parFil.set(row.thread_id, row);
  }
  return [...parFil.values()];
}

// Les sessions staff forgees (motif de scripts/cross-client-center-scope-check.js).
function hashSecret(value) {
  return crypto.createHash('sha256').update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`).digest('hex');
}
const ALL_PERMISSIONS = [
  'dashboard.view', 'direction.view', 'centers.switch', 'reports.export', 'planning.view', 'planning.bowling', 'planning.laser',
  'planning.drag', 'planning.past', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.status', 'reservations.quick', 'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops',
];
const CENTER_ROWS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'n4-bowling', name: 'N4 Bowling', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'n4-bowling', client_name: 'N4 Bowling' },
];
const JETON_LIBRAMONT = 'fgs_gate_threads_libramont';
const SESSIONS = new Map([[hashSecret(JETON_LIBRAMONT), {
  token_hash: hashSecret(JETON_LIBRAMONT), center_id: 'libramont', expires_at: new Date(Date.now() + 3600000).toISOString(),
  member_id: 'libramont:kevin', member_name: 'Kevin', contact: 'kevin@fungalaxy.be', member_status: 'active',
  role_id: 'direction', role_name: 'Direction', role_code: 'DI', permissions: ALL_PERMISSIONS, locked: true,
}]]);

async function requete(texte, params = []) {
  const sql = String(texte).replace(/\s+/g, ' ').trim();
  const p = params || [];
  if (/^(begin|commit|rollback)/i.test(sql)) return lignes([]);

  // --- sessions staff (api/ops.js) ---------------------------------------
  if (/select id, access_code_hash from staff_members where id = any/i.test(sql)) {
    const ids = Array.isArray(p[0]) ? p[0] : [];
    return lignes(ids.filter((id) => id.endsWith(':platform-owner')).map((id) => ({ id, access_code_hash: hashSecret(process.env.PLATFORM_OWNER_CODE) })));
  }
  if (/from staff_sessions s/i.test(sql) && /s\.token_hash = \$1/.test(sql)) {
    const row = SESSIONS.get(String(p[0] || ''));
    return lignes(row ? [row] : []);
  }
  if (/insert into audit_log/i.test(sql)) return lignes([{ id: 1, occurred_at: iso(now()) }]);
  if (/from centers\b/i.test(sql)) {
    const rows = /where/i.test(sql) && p.length ? CENTER_ROWS.filter((row) => p.map(String).includes(row.id)) : CENTER_ROWS;
    return lignes(rows.map(clone));
  }

  // --- communications ------------------------------------------------------
  if (/^insert into communications \(/i.test(sql)) {
    const existante = p[11] ? DB.communications.find((c) => c.idempotency_key === p[11]) : null;
    if (existante) {
      if (/do nothing/i.test(sql)) return lignes([]);
      return lignes([clone(existante)]);
    }
    SEQ.communications += 1;
    const row = {
      id: SEQ.communications, center_id: p[0], reservation_id: p[1] || null, channel: p[2], direction: p[3], template_id: p[4],
      recipient: p[5], subject: p[6], body: p[7], status: p[8], scheduled_at: p[9], payload: JSON.parse(p[10] || '{}'), idempotency_key: p[11],
      thread_id: p[12] || null, message_id: p[13] || null, in_reply_to: p[14] || null, references_ids: p[15] || '',
      attempts: 0, max_attempts: 3, priority: 50, last_error: null, next_retry_at: null, locked_at: null, sent_at: null,
      provider_message_id: null, delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, bounced_at: null, complained_at: null,
      created_at: iso(new Date(Date.now() + SEQ.communications)),
    };
    DB.communications.push(row);
    return lignes([clone(row)]);
  }
  if (/^select \* from communications where idempotency_key = \$1/i.test(sql)) {
    return lignes(DB.communications.filter((c) => c.idempotency_key === p[0]).map(clone));
  }
  if (/^select thread_id from communications where/i.test(sql) && /message_id = any/i.test(sql)) {
    const borne = /center_id = \$1/.test(sql);
    const ids = Array.isArray(p[1]) ? p[1] : [];
    const rows = DB.communications
      .filter((c) => (!borne || c.center_id === p[0]) && ids.includes(c.message_id) && c.thread_id)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return lignes(rows.slice(0, 1).map((c) => ({ thread_id: c.thread_id })));
  }
  if (/^select id, center_id, direction, recipient, subject, payload, thread_id, created_at from communications where id = \$1 and center_id = \$2/i.test(sql)) {
    return lignes(DB.communications.filter((c) => c.id === Number(p[0]) && c.center_id === p[1]).map(clone));
  }
  if (/^select payload, message_id, references_ids, thread_id, subject from communications where id = \$1/i.test(sql)) {
    const borne = /center_id = \$2/.test(sql);
    return lignes(DB.communications
      .filter((c) => c.id === Number(p[0]) && (!borne || c.center_id === p[1]) && c.direction === 'inbound' && String(c.recipient).toLowerCase() === String(p[2]).toLowerCase())
      .map(clone));
  }
  if (/^update communications set thread_id = \$2 where id = \$1/i.test(sql)) {
    const borne = /center_id = \$3/.test(sql);
    const rows = DB.communications.filter((c) => c.id === Number(p[0]) && (!borne || c.center_id === p[2]));
    rows.forEach((c) => { c.thread_id = Number(p[1]); });
    return lignes(rows.map((c) => ({ id: c.id })));
  }
  if (/^select id, center_id, status, recipient from communications where provider_message_id = \$1/i.test(sql)) {
    return lignes(DB.communications.filter((c) => c.provider_message_id === p[0] && c.direction === 'outbound').map(clone));
  }
  if (/^update communications set message_id = \$2 where id = \$1/i.test(sql)) {
    const rows = DB.communications.filter((c) => c.id === Number(p[0]) && !c.message_id);
    rows.forEach((c) => { c.message_id = p[1]; });
    return lignes([]);
  }
  if (/^select \* from communications where thread_id = \$1 and center_id = \$2/i.test(sql)) {
    return lignes(DB.communications.filter((c) => c.thread_id === Number(p[0]) && c.center_id === p[1])
      .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || (a.id - b.id)).map(clone));
  }
  if (/^select distinct on \(thread_id\) id, thread_id, direction, body, payload, created_at, sent_at from communications/i.test(sql)) {
    const ids = p[0].map(Number);
    return lignes(dernierParFil(DB.communications.filter((c) => ids.includes(c.thread_id) && c.center_id === p[1])).map(clone));
  }
  if (/^select distinct on \(thread_id\) id, thread_id, payload, created_at from communications/i.test(sql)) {
    const ids = p[0].map(Number);
    return lignes(dernierParFil(DB.communications.filter((c) => ids.includes(c.thread_id) && c.center_id === p[1] && c.direction === 'inbound')).map(clone));
  }
  if (/^select distinct on \(thread_id\) thread_id, payload, sent_at, created_at from communications/i.test(sql)) {
    const ids = p[0].map(Number);
    return lignes(dernierParFil(DB.communications.filter((c) => ids.includes(c.thread_id) && c.center_id === p[1] && c.direction === 'outbound' && c.payload && c.payload.sentBy)).map(clone));
  }
  if (/^select count\(\*\)::int as n from communications where center_id = \$1 and direction = 'inbound' and coalesce\(payload->'analysis'->>'question'/i.test(sql)) {
    return lignes([{ n: DB.communications.filter((c) => c.center_id === p[0] && c.direction === 'inbound' && c.payload && c.payload.analysis && c.payload.analysis.question && !c.payload.analysis.questionRepondue).length }]);
  }
  if (/^select count\(\*\)::int as n from communications where/i.test(sql)) {
    return lignes([{ n: filtreEnvoyes(sql, p).length }]);
  }
  if (/^select c\.\*, exists\(select 1 from communications r where r\.thread_id = c\.thread_id/i.test(sql)) {
    const mLimit = sql.match(/limit \$(\d+) offset \$(\d+)/);
    const limit = Number(p[Number(mLimit[1]) - 1]);
    const offset = Number(p[Number(mLimit[2]) - 1]);
    const instant = (c) => Date.parse(c.sent_at || c.scheduled_at || c.created_at);
    const rows = filtreEnvoyes(sql, p).sort((a, b) => (instant(b) - instant(a)) || (b.id - a.id)).slice(offset, offset + limit);
    return lignes(rows.map((c) => ({
      ...clone(c),
      a_recu_une_reponse: DB.communications.some((r) => c.thread_id && r.thread_id === c.thread_id && r.center_id === c.center_id && r.direction === 'inbound' && Date.parse(r.created_at) > Date.parse(c.sent_at || c.created_at)),
    })));
  }
  if (/^select count\(\*\) filter \(where direction = 'inbound' and created_at > now\(\) - interval '7 days'\)::int as recus7j/i.test(sql)) {
    const rows = DB.communications.filter((c) => c.center_id === p[0] && c.channel === 'email' && horsSimulation(c));
    const recent = (valeur) => valeur && Date.parse(valeur) > il7();
    return lignes([{
      recus7j: rows.filter((c) => c.direction === 'inbound' && recent(c.created_at)).length,
      envoyes7j: rows.filter((c) => c.direction === 'outbound' && ['sent', 'delivered'].includes(c.status) && recent(c.sent_at || c.created_at)).length,
      remis7j: rows.filter((c) => c.direction === 'outbound' && recent(c.delivered_at)).length,
      ouverts7j: rows.filter((c) => c.direction === 'outbound' && recent(c.opened_at)).length,
      echecs7j: rows.filter((c) => c.direction === 'outbound' && c.status === 'failed' && recent(c.created_at)).length,
      en_attente: rows.filter((c) => c.direction === 'outbound' && ['queued', 'processing'].includes(c.status)).length,
      programmes24h: rows.filter((c) => c.direction === 'outbound' && c.status === 'queued' && c.scheduled_at && Date.parse(c.scheduled_at) > Date.now() && Date.parse(c.scheduled_at) <= Date.now() + 86400000).length,
    }]);
  }
  if (/^select template_id, count\(\*\) filter \(where status in \('sent', 'delivered'\)\)::int as sent30d/i.test(sql)) {
    const parTemplate = new Map();
    for (const c of DB.communications.filter((x) => x.center_id === p[0] && x.channel === 'email' && x.direction === 'outbound' && Date.parse(x.created_at) > il30() && horsSimulation(x))) {
      const cle = c.template_id || '';
      if (!parTemplate.has(cle)) parTemplate.set(cle, { template_id: cle, sent30d: 0, failed30d: 0, last_sent_at: null });
      const agg = parTemplate.get(cle);
      if (['sent', 'delivered'].includes(c.status)) agg.sent30d += 1;
      if (c.status === 'failed') agg.failed30d += 1;
      if (c.sent_at && (!agg.last_sent_at || Date.parse(c.sent_at) > Date.parse(agg.last_sent_at))) agg.last_sent_at = c.sent_at;
    }
    return lignes([...parTemplate.values()]);
  }
  if (/^select template_id, status, count\(\*\)::int as n from communications where center_id = \$1 and created_at > now\(\) - interval '30 days'/i.test(sql)) {
    const parCle = new Map();
    for (const c of DB.communications.filter((x) => x.center_id === p[0] && Date.parse(x.created_at) > il30())) {
      const cle = `${c.template_id}|${c.status}`;
      if (!parCle.has(cle)) parCle.set(cle, { template_id: c.template_id, status: c.status, n: 0 });
      parCle.get(cle).n += 1;
    }
    return lignes([...parCle.values()]);
  }
  if (/^select id from communications where center_id = \$1 and direction = 'inbound' and idempotency_key = \$2/i.test(sql)) {
    return lignes(DB.communications.filter((c) => c.center_id === p[0] && c.idempotency_key === p[1]).map((c) => ({ id: c.id })));
  }

  // --- email_threads -------------------------------------------------------
  if (/^insert into email_threads/i.test(sql)) {
    SEQ.email_threads += 1;
    const at = p[6] ? iso(p[6]) : iso(now());
    const row = {
      id: SEQ.email_threads, center_id: p[0], contact_email: p[1], contact_name: p[2], subject: p[3], status: 'open', origin: p[4],
      root_communication_id: p[5], message_count: 0, inbound_count: 0, outbound_count: 0, first_message_at: at, last_message_at: at,
      last_inbound_at: null, last_outbound_at: null, created_at: iso(now()), updated_at: iso(now()),
    };
    DB.email_threads.push(row);
    return lignes([{ id: row.id }]);
  }
  if (/^select id from email_threads where center_id = \$1 and lower\(contact_email\) = \$2 and lower\(btrim/i.test(sql)) {
    const limite = Date.now() - 90 * 86400000;
    const rows = triFils(DB.email_threads.filter((t) => t.center_id === p[0] && t.contact_email.toLowerCase() === p[1]
      && normaliseSujet(t.subject) === p[2] && Date.parse(t.last_message_at) > limite));
    return lignes(rows.slice(0, 1).map((t) => ({ id: t.id })));
  }
  if (/^select id from email_threads where id = \$1 and center_id = \$2/i.test(sql)) {
    return lignes(DB.email_threads.filter((t) => t.id === Number(p[0]) && t.center_id === p[1]).map((t) => ({ id: t.id })));
  }
  if (/^update email_threads set message_count = message_count \+ 1/i.test(sql)) {
    const fil = DB.email_threads.find((t) => t.id === Number(p[0]));
    if (!fil) return lignes([]);
    const at = p[1] ? iso(p[1]) : iso(now());
    const entrant = p[4] === true;
    fil.message_count += 1;
    fil.inbound_count += Number(p[2]);
    fil.outbound_count += Number(p[3]);
    if (Date.parse(at) > Date.parse(fil.last_message_at)) fil.last_message_at = at;
    if (Date.parse(at) < Date.parse(fil.first_message_at)) fil.first_message_at = at;
    if (entrant) fil.last_inbound_at = fil.last_inbound_at && Date.parse(fil.last_inbound_at) > Date.parse(at) ? fil.last_inbound_at : at;
    else fil.last_outbound_at = fil.last_outbound_at && Date.parse(fil.last_outbound_at) > Date.parse(at) ? fil.last_outbound_at : at;
    fil.status = entrant ? 'open' : (fil.status === 'closed' ? 'closed' : 'answered');
    fil.updated_at = iso(now());
    return lignes([]);
  }
  if (/^select \* from email_threads where id = \$1/i.test(sql)) {
    const borne = /center_id = \$2/.test(sql);
    return lignes(DB.email_threads.filter((t) => t.id === Number(p[0]) && (!borne || t.center_id === p[1])).map(clone));
  }
  if (/^select count\(\*\)::int as n from email_threads where center_id = \$1 and lower\(contact_email\) = \$2/i.test(sql)) {
    return lignes([{ n: DB.email_threads.filter((t) => t.center_id === p[0] && t.contact_email.toLowerCase() === p[1]).length }]);
  }
  if (/^select count\(\*\)::int as n from email_threads where/i.test(sql)) {
    return lignes([{ n: filtreFils(sql, p).length }]);
  }
  if (/^select \* from email_threads where/i.test(sql) && /order by last_message_at desc/i.test(sql)) {
    const mLimit = sql.match(/limit \$(\d+) offset \$(\d+)/);
    const limit = Number(p[Number(mLimit[1]) - 1]);
    const offset = Number(p[Number(mLimit[2]) - 1]);
    return lignes(triFils(filtreFils(sql, p)).slice(offset, offset + limit).map(clone));
  }
  if (/^select id, subject, status, last_message_at, message_count from email_threads where center_id = \$1/i.test(sql)) {
    return lignes(triFils(DB.email_threads.filter((t) => t.center_id === p[0] && t.contact_email.toLowerCase() === p[1] && t.id !== Number(p[2]))).slice(0, 10).map(clone));
  }
  if (/^update email_threads set status = \$3, updated_at = now\(\) where id = \$1 and center_id = \$2/i.test(sql)) {
    const rows = DB.email_threads.filter((t) => t.id === Number(p[0]) && t.center_id === p[1]);
    rows.forEach((t) => { t.status = p[2]; t.updated_at = iso(now()); });
    return lignes(rows.map(clone));
  }
  if (/^select count\(\*\) filter \(where status = 'open'\)::int as a_repondre/i.test(sql)) {
    const ouverts = DB.email_threads.filter((t) => t.center_id === p[0] && t.status === 'open' && (!/inbound_count > 0/.test(sql) || Number(t.inbound_count) > 0));
    return lignes([{ a_repondre: ouverts.length, plus_ancienne: ouverts.map((t) => t.last_inbound_at).filter(Boolean).sort()[0] || null }]);
  }

  // --- lectures, prises ----------------------------------------------------
  if (/^insert into communication_reads/i.test(sql)) {
    const borne = /c\.center_id = \$5/.test(sql);
    const ids = (p[0] || []).map(Number);
    const rows = [];
    for (const c of DB.communications.filter((x) => ids.includes(x.id) && (!borne || x.center_id === p[4]))) {
      const existante = DB.communication_reads.find((r) => r.communication_id === c.id && r.member_id === p[1]);
      if (existante) {
        existante.last_read_at = iso(now());
        existante.read_count += 1;
        existante.member_name = p[2];
        existante.member_role = p[3];
      } else {
        DB.communication_reads.push({ communication_id: c.id, member_id: p[1], member_name: p[2], member_role: p[3], first_read_at: iso(now()), last_read_at: iso(now()), read_count: 1 });
      }
      rows.push({ communication_id: c.id });
    }
    return lignes(rows);
  }
  if (/^select communication_id, member_id, member_name, member_role, last_read_at from communication_reads/i.test(sql)) {
    const ids = (p[0] || []).map(Number);
    return lignes(DB.communication_reads.filter((r) => ids.includes(r.communication_id)).map(clone));
  }
  if (/^select communication_id, member_id, member_name, member_role, first_read_at, last_read_at, read_count from communication_reads/i.test(sql)) {
    const ids = (p[0] || []).map(Number);
    return lignes(DB.communication_reads.filter((r) => ids.includes(r.communication_id)).map(clone));
  }
  if (/^select communication_id, member_id, member_name, member_role, expires_at from ops_email_claims/i.test(sql)) {
    const ids = (p[0] || []).map(Number);
    return lignes(DB.ops_email_claims.filter((r) => ids.includes(r.communication_id) && Date.parse(r.expires_at) > Date.now()).map(clone));
  }

  // --- evenements ----------------------------------------------------------
  if (/^insert into email_events/i.test(sql)) {
    if (DB.email_events.some((e) => e.event_key === p[3])) return lignes([]);
    SEQ.email_events += 1;
    const row = { id: SEQ.email_events, center_id: p[0], communication_id: p[1], provider: 'resend', provider_email_id: p[2], event_key: p[3], event_type: p[4], occurred_at: p[5], data: JSON.parse(p[6] || '{}'), created_at: iso(now()) };
    DB.email_events.push(row);
    return lignes([{ id: row.id }]);
  }
  if (/^select communication_id, event_type, occurred_at, data from email_events/i.test(sql)) {
    const ids = (p[0] || []).map(Number);
    return lignes(DB.email_events.filter((e) => ids.includes(e.communication_id)).map(clone));
  }
  if (/^select exists\(select 1 from email_events where center_id = \$1 and occurred_at > now\(\) - interval '30 days'\) as evenements/i.test(sql)) {
    const miens = DB.email_events.filter((e) => e.center_id === p[0]);
    return lignes([{
      evenements: miens.some((e) => Date.parse(e.occurred_at) > il30()),
      ouvertures: miens.some((e) => e.event_type === 'opened'),
      clics: miens.some((e) => e.event_type === 'clicked'),
    }]);
  }

  // --- reglages, identites, divers ------------------------------------------
  if (/^select settings from center_automation_settings where center_id = \$1/i.test(sql)) {
    return lignes(DB.center_automation_settings.filter((s) => s.center_id === p[0]).map((s) => ({ settings: s.settings })));
  }
  if (/^select settings->'custom_sequences' as sequences from center_automation_settings/i.test(sql)) {
    return lignes(DB.center_automation_settings.filter((s) => s.center_id === p[0]).map((s) => ({ sequences: (s.settings || {}).custom_sequences || null })));
  }
  if (/from email_identities/i.test(sql)) return lignes([]);
  if (/from marketing_suppressions/i.test(sql)) return lignes([]);
  if (/with due as/i.test(sql)) return lignes([]);
  // L historique du client lu par l agent (conversationAvecLeClient) : hors
  // du perimetre de ce gate, un client sans passe suffit.
  if (/to_char\(created_at, 'YYYY-MM-DD'\) as jour from communications/i.test(sql)) return lignes([]);
  // Toute requete qui touche une table MODELISEE ici et qu on n a pas reconnue
  // est un trou du gate : elle se voit. Le reste (catalogue, reservations,
  // memoire de l agent, blocages) est hors sujet et rend vide.
  if (/\b(communications|email_threads|email_events|communication_reads|ops_email_claims)\b/i.test(sql)) INCONNUES.push(sql.slice(0, 120));
  return lignes([]);
}

class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  on() {}
  async end() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };

// LE RESEAU EST UNE SONDE.
const ENVOIS = [];
global.fetch = async (url, options = {}) => {
  let corps = null;
  try { corps = JSON.parse(options.body || '{}'); } catch (error) { corps = null; }
  ENVOIS.push({ url: String(url), corps, headers: (options && options.headers) || {} });
  return { ok: true, status: 200, json: async () => ({ id: `gate_${ENVOIS.length}` }), text: async () => '' };
};

// ---------------------------------------------------------------------------
// MUTATIONS COMPILEES EN MEMOIRE.
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/email-threads.js', 'lib/database.js', 'lib/ops-communications.js', 'lib/email-events.js', 'lib/email-agent.js', 'lib/ops-jobs.js', 'api/ops.js'];
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
  const db = require(path.join(ROOT, 'lib/database.js'));
  const comms = require(path.join(ROOT, 'lib/ops-communications.js'));
  const fils = require(path.join(ROOT, 'lib/email-threads.js'));
  const evenements = require(path.join(ROOT, 'lib/email-events.js'));
  const agent = require(path.join(ROOT, 'lib/email-agent.js'));
  const ops = require(path.join(ROOT, 'api/ops.js'));
  return { db, comms, fils, evenements, agent, ops };
}

// ---------------------------------------------------------------------------
// LES GESTES. Chaque geste passe par le VRAI code : l ingestion de l agent,
// createCommunication (donc le rattachement au fil), sendDirectEmail, etc.
// ---------------------------------------------------------------------------
async function recevoir(m, { centerId = 'libramont', from = 'marie@exemple.be', fromName = 'Marie Dupont', subject, body = 'Bonjour, est-ce possible ?', messageId = '', inReplyTo = '', references = '' }) {
  const r = await m.agent.ingestInboundEmail({
    centerId, from, fromName, subject, body, provider: 'resend', providerEmailId: `in-${crypto.randomUUID()}`,
    messageId, inReplyTo, references, deps: { query: requete }, fetchImpl: async () => { throw new Error('reseau interdit'); },
  });
  return DB.communications.find((c) => c.id === Number(r.communication.id));
}
async function essayer(fn) {
  try { return { valeur: await fn(), erreur: null }; } catch (erreur) { return { valeur: null, erreur }; }
}
function fil(id) { return DB.email_threads.find((t) => t.id === Number(id)) || null; }
function ligne(id) { return DB.communications.find((c) => c.id === Number(id)) || null; }

async function reponseManuelle(m, { centerId = 'libramont', to = 'marie@exemple.be', replyToCommunicationId, subject = '', body = 'Oui, avec plaisir : 15 h vous conviendrait ?', member = { id: 'libramont:kevin', name: 'Kevin', role: 'Direction' } }) {
  const r = await m.comms.sendDirectEmail({ centerId, to, subject, body, replyToCommunicationId, attemptId: `gate-${crypto.randomUUID()}`, member });
  return ligne(r.communication.id);
}

async function envoiVersLeFournisseur(m, row) {
  ENVOIS.length = 0;
  await m.comms.__test.sendEmail(m.db.__test ? row : row);
  return (ENVOIS[0] && ENVOIS[0].corps) || {};
}

async function requeteHttp(m, { url, token = JETON_LIBRAMONT }) {
  const req = { method: 'GET', url, headers: { host: 'app.pinlane.be', 'x-staff-session': token } };
  const res = { statusCode: 0, body: '', setHeader() {}, end(chunk) { this.body = String(chunk || ''); } };
  await m.ops(req, res);
  let corps = null;
  try { corps = JSON.parse(res.body); } catch (error) { corps = { brut: res.body }; }
  return { statut: res.statusCode, corps };
}

// ---------------------------------------------------------------------------
(async () => {
  reset();
  let m = charger();
  const { db } = m;
  // MONTAGE : la base est vide et la fabrique de lignes est bien la vraie
  // (createCommunication avec ses 16 parametres, donc les colonnes 0047).
  const montage = await db.createCommunication({ centerId: 'libramont', channel: 'email', direction: 'inbound', templateId: 'inbound_email', recipient: 'montage@exemple.be', subject: 'Montage', body: 'x', status: 'received', idempotencyKey: 'gate:montage', payload: { textBody: 'x' }, messageId: '<montage@exemple.be>' });
  ok(montage.id === 1 && montage.threadId === 1 && ligne(1).message_id === '<montage@exemple.be>' && fil(1).status === 'open',
    '[montage] createCommunication ecrit le Message-ID, cree un fil et le laisse « à répondre »', JSON.stringify({ threadId: montage.threadId, statut: fil(1) && fil(1).status }));

  // =====================================================================
  console.log('\n[F] une confirmation automatique cree son fil, l evenement sent lui donne son Message-ID');
  // =====================================================================
  reset();
  m = charger();
  await m.comms.enqueueReservationCommunications(
    { id: 4001, centerId: 'libramont', name: 'Marie Dupont', email: 'marie@exemple.be', phone: '', date: '2026-12-05', startTime: '15:00', type: 'bowling', validationStatus: 'confirmed' },
    { templatesOnly: ['confirmation'], deps: { query: requete } },
  );
  const confirmation = DB.communications.find((c) => c.template_id === 'confirmation');
  ok(Boolean(confirmation) && Boolean(confirmation.thread_id) && fil(confirmation.thread_id).origin === 'outbound' && fil(confirmation.thread_id).status === 'answered' && fil(confirmation.thread_id).outbound_count === 1,
    '[F] la confirmation a son fil (origine sortante, statut « répondu », 1 sortant)', confirmation ? JSON.stringify(fil(confirmation.thread_id)) : 'aucune confirmation');
  // Le dispatcher a pose l identifiant du fournisseur (simule ici, le
  // dispatch est prouve par dispatch-immediate-check).
  confirmation.provider_message_id = 'resend-conf-1';
  confirmation.status = 'sent';
  const sent = await m.evenements.enregistrerEvenementFournisseur(requete, { type: 'email.sent', data: { email_id: 'resend-conf-1', message_id: '<conf-1@fungalaxy.be>' }, eventKey: 'svix-conf-1' });
  ok(sent.ok === true && sent.deduped === false && ligne(confirmation.id).message_id === '<conf-1@fungalaxy.be>',
    '[F] email.sent donne son Message-ID a la confirmation', `message_id=${ligne(confirmation.id).message_id}`);
  const reponseF = await recevoir(m, { subject: 'Re: C\'est confirmé : on vous attend samedi 5 décembre', inReplyTo: '<conf-1@fungalaxy.be>', body: 'Merci ! On sera 8 finalement.' });
  ok(reponseF.thread_id === confirmation.thread_id && fil(confirmation.thread_id).status === 'open' && fil(confirmation.thread_id).inbound_count === 1 && fil(confirmation.thread_id).message_count === 2,
    '[F] la reponse du client rejoint le fil de la confirmation, qui repasse « à répondre »', JSON.stringify(fil(confirmation.thread_id)));

  // =====================================================================
  console.log('\n[A][B] les en-tetes de reponse rattachent au fil de NOTRE message');
  // =====================================================================
  reset();
  m = charger();
  const question = await recevoir(m, { subject: 'Anniversaire samedi', messageId: '<q1@gmail.com>' });
  ok(Boolean(question.thread_id) && fil(question.thread_id).status === 'open' && fil(question.thread_id).contact_email === 'marie@exemple.be',
    '[A] montage : un premier mail recu ouvre un fil « à répondre »', JSON.stringify(fil(question.thread_id)));
  const reponse = await reponseManuelle(m, { replyToCommunicationId: question.id, subject: '' });
  ok(reponse.thread_id === question.thread_id && fil(question.thread_id).status === 'answered' && fil(question.thread_id).outbound_count === 1,
    '[E] la reponse manuelle rejoint le fil et le marque « répondu »', JSON.stringify(fil(question.thread_id)));
  ok(reponse.subject === 'Re: Anniversaire samedi', '[E] sujet vide -> « Re: » + sujet d origine', reponse.subject);
  ok(reponse.payload.inReplyTo === '<q1@gmail.com>' && reponse.payload.references === '<q1@gmail.com>' && reponse.payload.sentBy && reponse.payload.sentBy.memberName === 'Kevin' && reponse.payload.sentBy.memberRole === 'Direction',
    '[E] la reponse porte In-Reply-To, References et sentBy', JSON.stringify({ inReplyTo: reponse.payload.inReplyTo, references: reponse.payload.references, sentBy: reponse.payload.sentBy }));
  const versResend = await envoiVersLeFournisseur(m, m.db ? require(path.join(ROOT, 'lib/database.js')) && mapper(reponse) : reponse);
  ok(versResend.headers && versResend.headers['In-Reply-To'] === '<q1@gmail.com>' && versResend.headers.References === '<q1@gmail.com>',
    '[E] le POST vers le fournisseur porte les en-tetes In-Reply-To et References', JSON.stringify(versResend.headers || null));
  ok(!versResend.headers['List-Unsubscribe'], '[E] contraste : une reponse manuelle ne porte aucun en-tete de retrait');
  // Notre reponse a recu son Message-ID par l evenement sent.
  ligne(reponse.id).provider_message_id = 'resend-rep-1';
  await m.evenements.enregistrerEvenementFournisseur(requete, { type: 'email.sent', data: { email_id: 'resend-rep-1', message_id: '<rep-1@fungalaxy.be>' }, eventKey: 'svix-rep-1' });
  const suiteA = await recevoir(m, { subject: 'Re: Anniversaire samedi', inReplyTo: '<rep-1@fungalaxy.be>', references: '<q1@gmail.com> <rep-1@fungalaxy.be>', body: 'Parfait pour 15 h.' });
  ok(suiteA.thread_id === question.thread_id && fil(question.thread_id).message_count === 3 && fil(question.thread_id).status === 'open',
    '[A] In-Reply-To = notre Message-ID -> meme fil, qui redevient « à répondre »', JSON.stringify(fil(question.thread_id)));
  const suiteB = await recevoir(m, { subject: 'Autre chose comme sujet', references: '<q1@gmail.com> <rep-1@fungalaxy.be>', body: 'Et pour le gateau ?' });
  ok(suiteB.thread_id === question.thread_id && fil(question.thread_id).message_count === 4,
    '[B] References seul suffit, meme avec un sujet different', JSON.stringify({ threadId: suiteB.thread_id }));

  // =====================================================================
  console.log('\n[C][C2][D] sans en-tete : le prefixe de reponse decide, jamais la seule adresse');
  // =====================================================================
  const parSujet = await recevoir(m, { subject: 'RE : Anniversaire samedi', body: 'Je reconfirme.' });
  ok(parSujet.thread_id === question.thread_id, '[C] « RE : » sans en-tete rejoint le fil du meme contact au meme sujet', JSON.stringify({ threadId: parSujet.thread_id }));
  const memeSujetSansPrefixe = await recevoir(m, { subject: 'Anniversaire samedi', body: 'Nouvelle demande, autre date.' });
  ok(Boolean(memeSujetSansPrefixe.thread_id) && memeSujetSansPrefixe.thread_id !== question.thread_id,
    '[C2] le MEME sujet SANS prefixe fait un fil NEUF', JSON.stringify({ threadId: memeSujetSansPrefixe.thread_id, ancien: question.thread_id }));
  const nouveau = await recevoir(m, { subject: 'Bon cadeau', body: 'Vendez-vous des bons cadeaux ?' });
  ok(Boolean(nouveau.thread_id) && nouveau.thread_id !== question.thread_id && nouveau.thread_id !== memeSujetSansPrefixe.thread_id,
    '[D] un nouveau mail du meme contact fait un nouveau fil (aucune fusion par adresse)', JSON.stringify({ threadId: nouveau.thread_id }));
  const vieux = fil(nouveau.thread_id);
  vieux.last_message_at = new Date(Date.now() - 100 * 86400000).toISOString();
  const tardif = await recevoir(m, { subject: 'Re: Bon cadeau', body: 'Finalement oui.' });
  ok(tardif.thread_id !== nouveau.thread_id, '[C] un « Re: » sur un fil vieux de plus de 90 jours ouvre un fil neuf', JSON.stringify({ threadId: tardif.thread_id, ancien: nouveau.thread_id }));

  // =====================================================================
  console.log('\n[H] un Message-ID d un AUTRE centre ne rattache jamais');
  // =====================================================================
  // Le corps du mail de N4 porte un MARQUEUR : s il apparait dans une reponse
  // servie a Libramont, la donnee d un autre client a fuite.
  const MARQUEUR_N4 = 'FUITE-N4-DONNEE-CONFIDENTIELLE';
  const n4 = await recevoir(m, { centerId: 'n4-bowling', from: 'client@n4.be', subject: 'Piste vendredi', messageId: '<n4-1@gmail.com>', body: `Bonjour, ${MARQUEUR_N4}` });
  ok(fil(n4.thread_id).center_id === 'n4-bowling', '[H] montage : N4 Bowling a son propre fil');
  // Le MEME client ecrit aussi a Libramont : une adresse commune aux deux
  // centres ne fusionne rien, et un Message-ID de N4 ne rattache pas ici.
  const usurpation = await recevoir(m, { centerId: 'libramont', from: 'client@n4.be', subject: 'Re: Piste vendredi', inReplyTo: '<n4-1@gmail.com>', body: 'Et chez vous, une piste vendredi ?' });
  ok(usurpation.thread_id !== n4.thread_id && fil(usurpation.thread_id).center_id === 'libramont',
    '[H] un mail recu chez Libramont citant un Message-ID de N4 ouvre un fil chez Libramont, jamais chez N4', JSON.stringify({ threadId: usurpation.thread_id, n4: n4.thread_id }));
  const reponseEtrangere = await essayer(() => reponseManuelle(m, { centerId: 'libramont', to: 'client@n4.be', replyToCommunicationId: n4.id, subject: 'Re: Piste vendredi' }));
  ok(Boolean(reponseEtrangere.erreur) && reponseEtrangere.erreur.statusCode === 404,
    '[H] Libramont ne peut pas repondre a un mail recu par N4 (404, comme un id inexistant)', reponseEtrangere.erreur ? reponseEtrangere.erreur.message : 'accepte');

  // =====================================================================
  console.log('\n[G] les statuts : open -> answered -> closed -> reouverture par un entrant');
  // =====================================================================
  const filG = fil(nouveau.thread_id);
  ok(filG.status === 'open', '[G] montage : le fil « Bon cadeau » est « à répondre »');
  await reponseManuelle(m, { replyToCommunicationId: nouveau.id, subject: 'Re: Bon cadeau', body: 'Oui, au comptoir.' });
  ok(fil(nouveau.thread_id).status === 'answered', '[G] une reponse -> « répondu »');
  const termine = await m.fils.changerStatutFil(requete, { centerId: 'libramont', threadId: nouveau.thread_id, status: 'closed' });
  ok(termine && termine.status === 'closed', '[G] « Terminer » -> closed');
  const invalide = await essayer(() => m.fils.changerStatutFil(requete, { centerId: 'libramont', threadId: nouveau.thread_id, status: 'archive' }));
  ok(Boolean(invalide.erreur) && invalide.erreur.expose === true, '[G] un statut inconnu est refuse (erreur exposable)');
  const etranger = await m.fils.changerStatutFil(requete, { centerId: 'n4-bowling', threadId: nouveau.thread_id, status: 'open' });
  ok(etranger === null && fil(nouveau.thread_id).status === 'closed', '[G] N4 ne rouvre pas un fil de Libramont (aucune ligne)');
  await reponseManuelle(m, { replyToCommunicationId: nouveau.id, subject: 'Re: Bon cadeau', body: 'Et bonne journee.' });
  ok(fil(nouveau.thread_id).status === 'closed', '[G] un sortant sur un fil termine le laisse termine');
  fil(nouveau.thread_id).last_message_at = iso(now());
  const relance = await recevoir(m, { subject: 'Re: Bon cadeau', body: 'Une derniere question.' });
  ok(relance.thread_id === nouveau.thread_id && fil(nouveau.thread_id).status === 'open',
    '[G] un client qui ecrit ROUVRE un fil termine', JSON.stringify({ threadId: relance.thread_id, statut: fil(nouveau.thread_id).status }));

  // =====================================================================
  console.log('\n[I] qui a lu : marquerLu, luParMoi, lecteurs');
  // =====================================================================
  const kevin = { id: 'libramont:kevin', name: 'Kevin', role: 'Direction' };
  const sophie = { id: 'libramont:sophie', name: 'Sophie', role: 'Manager' };
  const lu1 = await m.fils.marquerLu(requete, { centerId: 'libramont', communicationIds: [relance.id, n4.id], member: kevin });
  ok(lu1.marques === 1 && DB.communication_reads.length === 1 && DB.communication_reads[0].communication_id === relance.id,
    '[I] marquerLu ecrit la lecture du mail de Libramont et IGNORE l id de N4', JSON.stringify(lu1));
  const lu2 = await m.fils.marquerLu(requete, { centerId: 'libramont', communicationIds: [relance.id], member: kevin });
  ok(lu2.marques === 1 && DB.communication_reads[0].read_count === 2, '[I] une seconde lecture incremente read_count (2)', JSON.stringify(DB.communication_reads[0]));
  await m.fils.marquerLu(requete, { centerId: 'libramont', communicationIds: [relance.id], member: sophie });
  const listeKevin = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'a-repondre', memberId: kevin.id });
  const filLu = listeKevin.threads.find((t) => t.id === nouveau.thread_id);
  ok(Boolean(filLu) && filLu.luParMoi === true && filLu.lecteurs.length === 2 && filLu.lecteurs.map((l) => l.memberName).sort().join(',') === 'Kevin,Sophie',
    '[I] luParMoi vrai pour Kevin, deux lecteurs listes', JSON.stringify(filLu && { luParMoi: filLu.luParMoi, lecteurs: filLu.lecteurs.map((l) => l.memberName) }));
  const listeAutre = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'a-repondre', memberId: 'libramont:lea' });
  const filNonLu = listeAutre.threads.find((t) => t.id === nouveau.thread_id);
  ok(Boolean(filNonLu) && filNonLu.luParMoi === false, '[I] luParMoi faux pour quelqu un qui n a pas lu');

  // =====================================================================
  console.log('\n[J] listerFils : filtres, recherche, extrait sans citation, reponduPar');
  // =====================================================================
  const citation = await recevoir(m, { from: 'paul@exemple.be', fromName: 'Paul Martin', subject: 'Re: Anniversaire de Tom', body: 'Ok pour 14 h.\n\nLe 16 sept. 2026, Fun Galaxy <libramont@fungalaxy.be> a écrit :\n> Bonjour Paul, 14 h ou 16 h ?\n> Merci' });
  // Un mail automatique parti sans reponse du client n est pas une conversation
  // de Recus (2026-09-17) : il reste dans Envoyes.
  DB.email_threads.push({ id: 9999, center_id: 'libramont', contact_email: 'auto@exemple.be', contact_name: '', subject: 'C est confirme', status: 'answered', origin: 'outbound', root_communication_id: null, message_count: 1, inbound_count: 0, outbound_count: 1, first_message_at: iso(now()), last_message_at: iso(now()), last_inbound_at: null, last_outbound_at: iso(now()), created_at: iso(now()), updated_at: iso(now()) });
  const tous = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'tous', memberId: kevin.id, limit: 50 });
  const filPaul = tous.threads.find((t) => t.id === citation.thread_id);
  ok(Boolean(filPaul) && filPaul.snippet === 'Ok pour 14 h.' && filPaul.contactName === 'Paul Martin',
    '[J] l extrait est la partie tapee, sans la citation', JSON.stringify(filPaul && filPaul.snippet));
  const aRepondre = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'a-repondre', memberId: kevin.id });
  const repondus = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'repondus', memberId: kevin.id });
  const termines = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'termines', memberId: kevin.id });
  ok(!tous.threads.some((t) => t.id === 9999) && !repondus.threads.some((t) => t.id === 9999),
    '[J] un mail automatique sans reponse du client n apparait pas dans Recus (ni Tous, ni Repondus)');
  ok(aRepondre.threads.every((t) => t.status === 'open') && repondus.threads.every((t) => t.status === 'answered') && termines.threads.every((t) => t.status === 'closed')
    && aRepondre.total + repondus.total + termines.total === tous.total && tous.total >= 5,
    '[J] les trois filtres partitionnent « tous »', JSON.stringify({ aRepondre: aRepondre.total, repondus: repondus.total, termines: termines.total, tous: tous.total }));
  ok(tous.threads.every((t) => t.centerId === 'libramont'), '[J] aucun fil de N4 dans la liste de Libramont');
  const recherche = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'tous', recherche: 'paul', memberId: kevin.id });
  ok(recherche.total === 1 && recherche.threads[0].id === citation.thread_id, '[J] la recherche trouve par nom de contact', JSON.stringify(recherche.total));
  const rechercheSujet = await m.fils.listerFils(requete, { centerId: 'libramont', filtre: 'tous', recherche: 'bon cadeau', memberId: kevin.id });
  ok(rechercheSujet.total >= 1 && rechercheSujet.threads.every((t) => /bon cadeau/i.test(t.subject)), '[J] la recherche trouve par sujet');
  const filQuestion = tous.threads.find((t) => t.id === question.thread_id);
  ok(Boolean(filQuestion) && filQuestion.reponduPar && filQuestion.reponduPar.memberName === 'Kevin' && filQuestion.reponduPar.memberRole === 'Direction' && filQuestion.messageCount === 5,
    '[J] reponduPar = le dernier sortant manuel (Kevin, Direction), messageCount juste', JSON.stringify(filQuestion && { reponduPar: filQuestion.reponduPar, messageCount: filQuestion.messageCount }));
  const charge = await m.fils.chargerFil(requete, { centerId: 'libramont', threadId: question.thread_id });
  ok(Boolean(charge) && charge.messages.length === 5 && charge.messages[0].direction === 'inbound' && charge.messages[1].origine === 'manuel' && charge.messages[1].sentBy.memberName === 'Kevin'
    && charge.messages.every((msg, i) => i === 0 || Date.parse(msg.createdAt) >= Date.parse(charge.messages[i - 1].createdAt)),
    '[J] chargerFil rend les messages dans l ordre, avec leur origine et leur auteur', JSON.stringify(charge && charge.messages.map((x) => `${x.direction}:${x.origine}`)));
  ok(Boolean(charge) && charge.contact.email === 'marie@exemple.be' && charge.contact.nbFils >= 3 && charge.contact.autresFils.every((f) => f.id !== question.thread_id),
    '[J] le contact porte ses autres conversations, sans la courante', JSON.stringify(charge && { nbFils: charge.contact.nbFils, autres: charge.contact.autresFils.length }));
  const chargeEtranger = await m.fils.chargerFil(requete, { centerId: 'n4-bowling', threadId: question.thread_id });
  ok(chargeEtranger === null, '[K] chargerFil : un fil de Libramont est invisible pour N4');

  // =====================================================================
  console.log('\n[K] le VRAI dispatcher : emailThread d un autre centre repond 404');
  // =====================================================================
  const propre = await requeteHttp(m, { url: `/api/ops?action=emailThread&id=${question.thread_id}` });
  ok(propre.statut === 200 && propre.corps && propre.corps.ok === true && Array.isArray(propre.corps.messages) && propre.corps.messages.length === 5,
    '[K] contraste : la Direction de Libramont lit son fil par /api/ops (200, 5 messages)', `HTTP ${propre.statut}`);
  const etrangerHttp = await requeteHttp(m, { url: `/api/ops?action=emailThread&id=${n4.thread_id}` });
  ok(etrangerHttp.statut === 404 && !JSON.stringify(etrangerHttp.corps).includes(MARQUEUR_N4),
    '[K] le fil de N4 repond 404 a Libramont, sans une ligne de son contenu', `HTTP ${etrangerHttp.statut} ${JSON.stringify(etrangerHttp.corps).slice(0, 80)}`);
  const listeHttp = await requeteHttp(m, { url: '/api/ops?action=emailThreads&filtre=tous' });
  ok(listeHttp.statut === 200 && listeHttp.corps.threads.length > 0 && listeHttp.corps.threads.every((t) => t.centerId === 'libramont')
    && !listeHttp.corps.threads.some((t) => t.id === n4.thread_id) && !JSON.stringify(listeHttp.corps).includes(MARQUEUR_N4),
    '[K] emailThreads ne liste que Libramont : ni le fil de N4, ni un mot de son contenu', `HTTP ${listeHttp.statut}, ${listeHttp.corps.total} fil(s)`);
  const envoyesHttp = await requeteHttp(m, { url: '/api/ops?action=emailSent&origine=manuel' });
  ok(envoyesHttp.statut === 200 && envoyesHttp.corps.messages.length >= 1 && envoyesHttp.corps.messages.every((x) => x.origine === 'manuel' && x.centerId === 'libramont' && x.sentBy && x.sentBy.memberName === 'Kevin'),
    '[K] emailSent (origine manuel) rend les reponses de Kevin, avec leur auteur et leur fil', `HTTP ${envoyesHttp.statut}, ${envoyesHttp.corps.total} message(s)`);
  const apercuHttp = await requeteHttp(m, { url: '/api/ops?action=emailOverview' });
  ok(apercuHttp.statut === 200 && apercuHttp.corps.aRepondre === aRepondre.total && Array.isArray(apercuHttp.corps.sequences) && apercuHttp.corps.sequences.length >= 6
    && apercuHttp.corps.suivi && apercuHttp.corps.suivi.evenementsRecus30j === true,
    '[K] emailOverview compte les fils a repondre et voit les evenements du fournisseur', `HTTP ${apercuHttp.statut} ${JSON.stringify(apercuHttp.corps && { aRepondre: apercuHttp.corps.aRepondre, sequences: (apercuHttp.corps.sequences || []).length, suivi: apercuHttp.corps.suivi })}`);
  ok(INCONNUES.length === 0, '[montage] le moteur SQL du gate a reconnu chaque requete du code', INCONNUES.slice(0, 3).join(' | '));

  // =====================================================================
  console.log('\n[mutation] contre-epreuves (le gate ROUGIRAIT sans chaque garde)');
  // =====================================================================
  const scenarioReponse = async (mm) => {
    reset();
    const q = await recevoir(mm, { subject: 'Anniversaire samedi', messageId: '<q1@gmail.com>' });
    const r = await reponseManuelle(mm, { replyToCommunicationId: q.id, subject: '' });
    return { q, r };
  };
  const contreEpreuves = [
    {
      nom: 'la recherche par Message-ID perd sa borne de centre',
      fichier: 'lib/email-threads.js',
      de: '       where center_id = $1 and message_id = any($2::text[]) and thread_id is not null',
      vers: '       where message_id = any($2::text[]) and thread_id is not null',
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { centerId: 'n4-bowling', from: 'client@n4.be', subject: 'Piste', messageId: '<n4-x@gmail.com>' });
        const b = await recevoir(mm, { centerId: 'libramont', from: 'client@n4.be', subject: 'Re: Piste', inReplyTo: '<n4-x@gmail.com>' });
        return b.thread_id === a.thread_id;
      },
      rouge: (fusion) => fusion === true,
    },
    {
      nom: 'le prefixe de reponse n est plus exige pour rattacher par sujet',
      fichier: 'lib/email-threads.js',
      de: '  if (aUnPrefixeDeReponse(subject)) {',
      vers: '  if (true) {',
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { subject: 'Anniversaire samedi' });
        const b = await recevoir(mm, { subject: 'Anniversaire samedi', body: 'Autre demande.' });
        return b.thread_id === a.thread_id;
      },
      rouge: (fusion) => fusion === true,
    },
    {
      nom: 'un mail sans fil trouve n en cree plus',
      fichier: 'lib/email-threads.js',
      de: '    if (!threadId) {\n      threadId = await creerFil(query, {',
      vers: '    if (false) {\n      threadId = await creerFil(query, {',
      rejouer: async (mm) => { reset(); const a = await recevoir(mm, { subject: 'Anniversaire samedi' }); return a.thread_id; },
      rouge: (threadId) => !threadId,
    },
    {
      nom: 'un entrant ne rouvre plus un fil',
      fichier: 'lib/email-threads.js',
      de: "  const entrant = direction === 'inbound';",
      vers: '  const entrant = false;',
      rejouer: async (mm) => { reset(); const a = await recevoir(mm, { subject: 'Anniversaire samedi' }); return fil(a.thread_id).status; },
      rouge: (statut) => statut !== 'open',
    },
    {
      nom: 'la reponse manuelle ne pose plus In-Reply-To',
      fichier: 'lib/ops-communications.js',
      de: "  if (inReplyTo) entetes['In-Reply-To'] = inReplyTo;",
      vers: '',
      rejouer: async (mm) => { const { r } = await scenarioReponse(mm); return envoiVersLeFournisseur(mm, mapper(r)); },
      rouge: (corps) => !corps.headers || !corps.headers['In-Reply-To'],
    },
    {
      nom: 'la reponse manuelle ne construit plus References',
      fichier: 'lib/ops-communications.js',
      de: "      references: `${String(ligne.references_ids || '').trim()} ${messageId}`.trim(),",
      vers: "      references: '',",
      rejouer: async (mm) => { const { r } = await scenarioReponse(mm); return envoiVersLeFournisseur(mm, mapper(r)); },
      rouge: (corps) => !corps.headers || !corps.headers.References,
    },
    {
      nom: 'le sujet vide d une reponse n est plus complete',
      fichier: 'lib/ops-communications.js',
      de: '    if (!finalSubject && reponseA.subject) finalSubject = `Re: ${sujetSansPrefixe(reponseA.subject)}`;',
      vers: '',
      rejouer: async (mm) => essayer(() => scenarioReponse(mm)),
      rouge: (r) => Boolean(r.erreur),
    },
    {
      nom: 'la reponse manuelle lit un mail recu d un autre centre',
      fichier: 'lib/ops-communications.js',
      de: '      `select payload, message_id, references_ids, thread_id, subject from communications where id = $1 and center_id = $2',
      vers: '      `select payload, message_id, references_ids, thread_id, subject from communications where id = $1',
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { centerId: 'n4-bowling', from: 'client@n4.be', subject: 'Piste' });
        return essayer(() => reponseManuelle(mm, { centerId: 'libramont', to: 'client@n4.be', replyToCommunicationId: a.id, subject: 'Re: Piste' }));
      },
      rouge: (r) => !r.erreur,
    },
    {
      nom: 'marquerLu accepte un mail d un autre centre',
      fichier: 'lib/email-threads.js',
      de: '     where c.id = any($1::bigint[]) and c.center_id = $5',
      vers: '     where c.id = any($1::bigint[])',
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { centerId: 'n4-bowling', from: 'client@n4.be', subject: 'Piste' });
        return mm.fils.marquerLu(requete, { centerId: 'libramont', communicationIds: [a.id], member: { id: 'libramont:kevin', name: 'Kevin', role: 'Direction' } });
      },
      rouge: (r) => r.marques > 0,
    },
    {
      nom: 'l extrait recopie la citation',
      fichier: 'lib/email-threads.js',
      de: "      snippet: dernier ? extrait(separerLeMessage(texteDuMessage(dernier)).message) : '',",
      vers: "      snippet: dernier ? extrait(texteDuMessage(dernier)) : '',",
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { subject: 'Re: Anniversaire de Tom', body: 'Ok pour 14 h.\n\nLe 16 sept. 2026, Fun Galaxy <libramont@fungalaxy.be> a écrit :\n> Bonjour Paul, 14 h ou 16 h ?' });
        const liste = await mm.fils.listerFils(requete, { centerId: 'libramont', filtre: 'tous', memberId: 'x' });
        return liste.threads.find((t) => t.id === a.thread_id).snippet;
      },
      rouge: (snippet) => snippet !== 'Ok pour 14 h.',
    },
    {
      nom: 'chargerFil perd sa borne de centre',
      fichier: 'lib/email-threads.js',
      de: "  const filResult = await query('select * from email_threads where id = $1 and center_id = $2 limit 1;', [id, centre]);",
      vers: "  const filResult = await query('select * from email_threads where id = $1 limit 1;', [id, centre]);",
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { subject: 'Anniversaire samedi' });
        return mm.fils.chargerFil(requete, { centerId: 'n4-bowling', threadId: a.thread_id });
      },
      rouge: (r) => r !== null,
    },
    {
      nom: 'le dispatcher ne renvoie plus 404 sur un fil etranger',
      fichier: 'api/ops.js',
      de: "    if (!fil) throw createHttpError('Conversation introuvable.', 404);\n    sendJson(res, 200, { ok: true, centerId, ...fil });",
      vers: "    sendJson(res, 200, { ok: true, centerId, ...(fil || {}) });",
      rejouer: async (mm) => {
        reset();
        const a = await recevoir(mm, { centerId: 'n4-bowling', from: 'client@n4.be', subject: 'Piste' });
        return requeteHttp(mm, { url: `/api/ops?action=emailThread&id=${a.thread_id}` });
      },
      rouge: (r) => r.statut !== 404,
    },
    {
      nom: 'createCommunication ne rattache plus les mails a un fil',
      fichier: 'lib/database.js',
      de: "  if (!communication || communication.channel !== 'email' || communication.threadId) return communication;",
      vers: '  if (true) return communication;',
      rejouer: async (mm) => { reset(); const a = await recevoir(mm, { subject: 'Anniversaire samedi' }); return a.thread_id; },
      rouge: (threadId) => !threadId,
    },
    {
      nom: 'Recus liste les mails automatiques sans reponse du client',
      fichier: 'lib/email-threads.js',
      de: "  let where = 'center_id = $1 and inbound_count > 0';",
      vers: "  let where = 'center_id = $1';",
      rejouer: async (mm) => { reset(); DB.email_threads.push({ id: 9999, center_id: 'libramont', contact_email: 'auto@exemple.be', contact_name: '', subject: 'C est confirme', status: 'answered', origin: 'outbound', root_communication_id: null, message_count: 1, inbound_count: 0, outbound_count: 1, first_message_at: iso(now()), last_message_at: iso(now()), last_inbound_at: null, last_outbound_at: iso(now()), created_at: iso(now()), updated_at: iso(now()) }); const r = await mm.fils.listerFils(requete, { centerId: 'libramont', filtre: 'tous' }); return r.threads.length; },
      rouge: (n) => n > 0,
    },
  ];
  for (const c of contreEpreuves) {
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

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error('FAIL  gate interrompu :', (erreur && erreur.stack) || erreur);
  process.exit(1);
});

// Une ligne de la base en memoire, dans la forme que sendEmail lit
// (mapCommunication : camelCase).
function mapper(row) {
  return {
    id: row.id, centerId: row.center_id, channel: row.channel, direction: row.direction, templateId: row.template_id,
    recipient: row.recipient, subject: row.subject, body: row.body, status: row.status, payload: row.payload || {},
    idempotencyKey: row.idempotency_key,
  };
}
