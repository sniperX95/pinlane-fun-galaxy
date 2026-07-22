// Gate du COCKPIT FONDATEUR : cloisonnement plateforme et honnetete du bundle,
// puis les TROIS pages dediees (founderAgents / founderIncidents /
// founderClients, lib/founder-cockpit.js).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif, et les sessions sont stubbees au niveau de
// lib/staff-auth. On exerce le VRAI dispatcher de api/ops.js (lecon des neuf
// faux verts du projet : tester l'outil ne prouve pas qu'il est branche).
// Le faux pool OBEIT AU TEXTE SQL sur les fixtures (motif de
// scripts/client-errors-check.js) : un filtre retire du code retire son effet
// dans le faux pool, et l'assertion rougit.
//
// CE QUE CE GATE PROUVE, chaque point contre-eprouve :
//   (a) une session DIRECTION (role verrouille, tous les droits du centre,
//       SANS platform.admin) recoit un REFUS serveur sur CHACUNE des actions
//       du cockpit, y compris les trois pages dediees. Le raccourci
//       role.locked ne confere jamais une permission plateforme.
//   (b) ce refus est TRACE dans audit_log avec outcome=denied.
//   (c) une session PLATEFORME (platform.admin explicite) obtient le bundle,
//       et le bundle dit la verite : testData = true tant que le SaaS n'est
//       pas lance.
//   (d) le bundle ne contient AUCUN secret (pas de cle, pas de code d'acces,
//       pas de hash) : c'est un ecran, pas un vidage de base.
//   (e) les TROIS builders rendent des COMPTES EXACTS sur fixtures (volumes
//       7/30 j, valides vs refutes, groupes d'erreurs console, volume mails),
//       l'exclusion du proprietaire plateforme est MESUREE (ses lignes
//       d'audit existent dans la fixture et n'apparaissent nulle part),
//       cost.costPerAgentMeasured reste false (registre global, jamais
//       ventile par agent) et chaque envelope porte testData = true.
//   (f) contre-preuve par MUTATION du code (edition inverse, jamais git
//       checkout) : exclusion plateforme retiree, honnetete du cout inversee,
//       mapping des erreurs console casse -> le gate ROUGIT a chaque fois.
//
// Lancement : node scripts/founder-cockpit-check.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Fixtures : le contenu que le faux pool sert aux requetes des builders.
// Toutes les dates derivent de NOW pour que les fenetres 7/30 jours soient
// des COMPORTEMENTS mesures, pas des chaines comparees.
// ---------------------------------------------------------------------------
const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const isoAgo = (ms) => new Date(NOW - ms).toISOString();

// Agent marketing : 4 insights. Attendus : d7 = 1, d30 = 3 (le 4e a 40 j),
// valides = 2, refutes = 1, dernier propose = 'Idee pluie samedi'.
// id + body ajoutes pour la section pendingInsights (le panneau
// Appliquer/Ignorer) : seul l'insight 'proposed' est actionnable. Les autres
// statuts (validated/refuted) ne doivent JAMAIS remonter comme en attente.
const MARKETING_INSIGHTS = [
  { id: 101, center_id: 'libramont', kind: 'idea', status: 'proposed', title: 'Idee pluie samedi', body: 'Promo pluie samedi', channel: 'email', at: NOW - 2 * DAY },
  { id: 102, center_id: 'libramont', kind: 'insight', status: 'validated', title: 'Meteo et frequentation', body: '', channel: '', at: NOW - 10 * DAY },
  { id: 103, center_id: 'gembloux', kind: 'idea', status: 'refuted', title: 'Idee refutee', body: '', channel: 'sms', at: NOW - 20 * DAY },
  { id: 104, center_id: 'libramont', kind: 'experiment', status: 'validated', title: 'Vieille experience', body: '', channel: '', at: NOW - 40 * DAY },
];

// Suggestions terrain : total 3, pending 2, d7 = 1, d30 = 2 (la 3e a 45 j).
const SUGGESTION_ROWS = [
  { status: 'pending', at: NOW - 1 * DAY },
  { status: 'applied', at: NOW - 9 * DAY },
  { status: 'pending', at: NOW - 45 * DAY },
];

// Decisions d'agents : d7 = 2, d30 = 3.
const DECISION_ROWS = [
  { at: NOW - 1 * DAY },
  { at: NOW - 3 * DAY },
  { at: NOW - 12 * DAY },
];

// Agent emails : la table existe (bascule testee plus bas), d7 = 1, d30 = 2.
let emailTablesExist = true;
const EMAIL_MEMORY_ROWS = [
  { intent: 'reservation', at: NOW - 2 * DAY },
  { intent: 'tarif', at: NOW - 8 * DAY },
];

const PLAN_ROWS = [
  { center_id: 'libramont', status: 'proposed', from_date: '2026-07-20', to_date: '2026-09-13', mode: 'rules', created_at: isoAgo(1 * DAY) },
];

// Registre llm_spend : GLOBAL et MENSUEL. cost_usd en chaine, comme pg rend
// les numeric.
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
const PREV_MONTH = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
})();
const LLM_MONTH_ROWS = [
  { month: CURRENT_MONTH, cost_usd: '1.23', calls: 10, updated_at: isoAgo(3600 * 1000) },
  { month: PREV_MONTH, cost_usd: '0.5', calls: 4, updated_at: isoAgo(31 * DAY) },
];

// Groupes d'erreurs console, dans la forme que rend le SQL de
// lib/client-errors.loadClientErrorGroups (module deja gate par
// scripts/client-errors-check.js : ici on teste le MAPPING du builder vers
// les noms de champs que le front consomme).
const CLIENT_ERROR_GROUPS = [
  {
    stack_hash: 'a'.repeat(40),
    count: 3,
    last_at: isoAgo(3600 * 1000),
    first_at: isoAgo(3 * DAY),
    centers: ['libramont', 'gembloux'],
    pages: ['menu', 'planning'],
    sample_message: 'Boom menu',
    sample_source: 'https://www.mngfunglxy.com/assets/app-main.js',
    sample_stack_excerpt: 'TypeError: boom\n    at f (app-main.js:N:N)',
    members_touches: 2,
  },
  {
    stack_hash: 'b'.repeat(40),
    count: 1,
    last_at: isoAgo(2 * DAY),
    first_at: isoAgo(2 * DAY),
    centers: ['gembloux'],
    pages: ['emails'],
    sample_message: 'Deuxieme bug',
    sample_source: '',
    sample_stack_excerpt: '',
    members_touches: 1,
  },
];

// Lignes d'audit staff. Le PIEGE de la fixture : le proprietaire plateforme a
// LE PLUS d'actions (5, hier). S'il n'est pas exclu, il devient le premier
// acteur ET gonfle l'adoption : plusieurs assertions rougissent.
const AUDIT_STAFF_ROWS = [
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:demo-direction', actor_label: 'Directrice Demo', at: NOW - 2 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:demo-direction', actor_label: 'Directrice Demo', at: NOW - 2 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:demo-direction', actor_label: 'Directrice Demo', at: NOW - 10 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:accueil', actor_label: 'Accueil', at: NOW - 3 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:platform-owner', actor_label: 'Proprietaire plateforme', at: NOW - 1 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:platform-owner', actor_label: 'Proprietaire plateforme', at: NOW - 1 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:platform-owner', actor_label: 'Proprietaire plateforme', at: NOW - 1 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:platform-owner', actor_label: 'Proprietaire plateforme', at: NOW - 1 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:platform-owner', actor_label: 'Proprietaire plateforme', at: NOW - 1 * DAY },
  { center_id: 'gembloux', actor_kind: 'staff', actor_member_id: 'gembloux:staff-1', actor_label: '', at: NOW - 5 * DAY },
  { center_id: 'gembloux', actor_kind: 'staff', actor_member_id: 'gembloux:staff-1', actor_label: '', at: NOW - 5 * DAY },
  { center_id: 'libramont', actor_kind: 'staff', actor_member_id: 'libramont:ancien', actor_label: 'Ancien', at: NOW - 40 * DAY },
];

// Volume mails 30 j : libramont 4 envoyes (3 sent + 1 delivered) et 2 echecs,
// gembloux 1 envoye. Les pieges : une ligne hors fenetre (45 j) et une ligne
// ENTRANTE (inbound) qui ne doivent jamais compter.
const COMM_ROWS = [
  { center_id: 'libramont', direction: 'outbound', status: 'sent', at: NOW - 2 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'sent', at: NOW - 5 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'sent', at: NOW - 12 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'delivered', at: NOW - 1 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'failed', at: NOW - 3 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'failed', at: NOW - 8 * DAY },
  { center_id: 'libramont', direction: 'outbound', status: 'sent', at: NOW - 45 * DAY },
  { center_id: 'gembloux', direction: 'outbound', status: 'sent', at: NOW - 4 * DAY },
  { center_id: 'gembloux', direction: 'inbound', status: 'received', at: NOW - 1 * DAY },
];

// ---------------------------------------------------------------------------
// Evaluateurs : la partie du faux pool qui OBEIT au texte SQL. Les filtres
// (fenetres, exclusion plateforme, direction outbound) ne s'appliquent que si
// la requete recue les contient VRAIMENT : un code mute perd leur effet.
// ---------------------------------------------------------------------------
function marketingStatusKindRows() {
  const map = new Map();
  MARKETING_INSIGHTS.forEach((row) => {
    const key = `${row.status}|${row.kind}`;
    const entry = map.get(key) || { status: row.status, kind: row.kind, count: 0, last: 0 };
    entry.count += 1;
    entry.last = Math.max(entry.last, row.at);
    map.set(key, entry);
  });
  return [...map.values()].map((e) => ({ status: e.status, kind: e.kind, count: e.count, last_at: new Date(e.last).toISOString() }));
}

function marketingPerCenterRows() {
  const map = new Map();
  MARKETING_INSIGHTS.forEach((row) => {
    const entry = map.get(row.center_id) || { center_id: row.center_id, last: 0, d7: 0, d30: 0 };
    entry.last = Math.max(entry.last, row.at);
    if (row.at > NOW - 7 * DAY) entry.d7 += 1;
    if (row.at > NOW - 30 * DAY) entry.d30 += 1;
    map.set(row.center_id, entry);
  });
  return [...map.values()].map((e) => ({ center_id: e.center_id, last_at: new Date(e.last).toISOString(), d7: e.d7, d30: e.d30 }));
}

function marketingLatestRow() {
  const latest = MARKETING_INSIGHTS.slice().sort((a, b) => b.at - a.at)[0];
  return latest
    ? [{ title: latest.title, kind: latest.kind, status: latest.status, channel: latest.channel, proposed_at: new Date(latest.at).toISOString() }]
    : [];
}

// Lignes actionnables : OBEIT au statut demande par le SQL (le filtre est lu
// dans la requete, pas suppose), pour qu'une mutation du statut cible fasse
// virer l'assertion au rouge.
function pendingInsightRows(sql) {
  const m = sql.match(/status = '(\w+)'/);
  const wanted = m ? m[1] : 'proposed';
  return MARKETING_INSIGHTS
    .filter((row) => row.status === wanted)
    .slice()
    .sort((a, b) => (b.at - a.at) || (b.id - a.id))
    .map((row) => ({
      id: row.id,
      center_id: row.center_id,
      kind: row.kind,
      title: row.title,
      body: row.body || '',
      proposed_at: new Date(row.at).toISOString(),
      created_at: new Date(row.at).toISOString(),
    }));
}

function countAggregate(rows) {
  const within = (days) => rows.filter((r) => r.at > NOW - days * DAY).length;
  const last = rows.length ? Math.max(...rows.map((r) => r.at)) : 0;
  return {
    total: rows.length,
    d7: within(7),
    d30: within(30),
    last_at: last ? new Date(last).toISOString() : null,
  };
}

function auditRowsFiltered(sql) {
  let rows = AUDIT_STAFF_ROWS.slice();
  if (sql.includes("actor_kind = 'staff'")) rows = rows.filter((r) => r.actor_kind === 'staff');
  if (sql.includes("not like '%:platform-owner'")) {
    rows = rows.filter((r) => !String(r.actor_member_id || '').endsWith(':platform-owner'));
  }
  return rows;
}

function topActorRows(sql) {
  let rows = auditRowsFiltered(sql);
  if (sql.includes("interval '30 days'")) rows = rows.filter((r) => r.at > NOW - 30 * DAY);
  const map = new Map();
  rows.forEach((r) => {
    const label = r.actor_label && r.actor_label !== '' ? r.actor_label : String(r.actor_member_id || '');
    const key = `${r.center_id}|${label}`;
    const entry = map.get(key) || { center_id: r.center_id, actor_label: label, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  });
  return [...map.values()].sort((a, b) => (b.count - a.count) || (a.actor_label < b.actor_label ? -1 : 1));
}

function adoptionPerCenterRows(sql) {
  const rows = auditRowsFiltered(sql);
  const map = new Map();
  rows.forEach((r) => {
    const entry = map.get(r.center_id) || { center_id: r.center_id, last: 0, d7: 0, d30: 0 };
    entry.last = Math.max(entry.last, r.at);
    if (r.at > NOW - 7 * DAY) entry.d7 += 1;
    if (r.at > NOW - 30 * DAY) entry.d30 += 1;
    map.set(r.center_id, entry);
  });
  return [...map.values()].map((e) => ({ center_id: e.center_id, last_action: new Date(e.last).toISOString(), d7: e.d7, d30: e.d30 }));
}

function commVolumeRows(sql) {
  let rows = COMM_ROWS.slice();
  if (sql.includes("direction = 'outbound'")) rows = rows.filter((r) => r.direction === 'outbound');
  if (sql.includes("interval '30 days'")) rows = rows.filter((r) => r.at > NOW - 30 * DAY);
  const map = new Map();
  rows.forEach((r) => {
    const entry = map.get(r.center_id) || { center_id: r.center_id, sent: 0, failed: 0 };
    if (r.status === 'sent' || r.status === 'delivered') entry.sent += 1;
    if (r.status === 'failed') entry.failed += 1;
    map.set(r.center_id, entry);
  });
  return [...map.values()];
}

function llmSpendRows(sql, params) {
  const rows = LLM_MONTH_ROWS.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
  const m = sql.match(/where month = \$(\d+)/i);
  if (m) {
    const month = params[Number(m[1]) - 1];
    return rows.filter((r) => r.month === month);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Faux pool pg : sert les fixtures ci-dessus aux requetes des builders,
// des reponses plausibles au reste du bundle, et capture les INSERT du
// journal d'audit pour prouver la trace du refus.
// ---------------------------------------------------------------------------
const auditRows = [];

// La ligne de session que le faux pool sert a la requete de resolution
// (join staff_sessions/staff_members/staff_roles). C'est ce qui fait tourner
// le VRAI chemin : hashSecret, getStaffSessionFromToken, la regle
// "locked = tous les droits du centre + permissions plateforme EXPLICITES
// seulement", puis sessionHasPermission. Aucun stub de fonction.
let activeSessionRow = null;

function fakeRowsFor(sql, params) {
  if (/insert into audit_log/i.test(sql)) return null; // traite a part
  if (/from staff_sessions s/i.test(sql)) {
    return activeSessionRow ? [activeSessionRow] : [];
  }
  if (/from centers/i.test(sql)) {
    return [
      { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active' },
    ];
  }
  // ── Fixtures des trois builders ──
  if (/group by status, kind/i.test(sql)) return marketingStatusKindRows();
  if (/from marketing_insights/i.test(sql) && /::int as d7/i.test(sql)) return marketingPerCenterRows();
  // La requete des lignes actionnables selectionne `, body,` : marqueur stable
  // (independant de la valeur du statut, donc la mutation du filtre garde son
  // effet). A tester AVANT la requete "dernier propose" (elles partagent
  // `order by proposed_at desc`).
  if (/from marketing_insights/i.test(sql) && /, body,/.test(sql)) return pendingInsightRows(sql);
  if (/from marketing_insights/i.test(sql) && /order by proposed_at desc/i.test(sql)) return marketingLatestRow();
  if (/from ops_agent_suggestions/i.test(sql)) {
    const agg = countAggregate(SUGGESTION_ROWS);
    const pending = SUGGESTION_ROWS.filter((r) => r.status === 'pending').length;
    return [{ total: agg.total, pending, d7: agg.d7, d30: agg.d30, last_at: agg.last_at }];
  }
  if (/from ops_decision_logs/i.test(sql)) {
    const agg = countAggregate(DECISION_ROWS);
    return [{ d7: agg.d7, d30: agg.d30, last_at: agg.last_at }];
  }
  if (/to_regclass/i.test(sql)) {
    return [{ reg: emailTablesExist ? 'email_agent_memory' : null }];
  }
  if (/from email_agent_memory/i.test(sql)) {
    const agg = countAggregate(EMAIL_MEMORY_ROWS);
    const latest = EMAIL_MEMORY_ROWS.slice().sort((a, b) => b.at - a.at)[0];
    return [{ total: agg.total, d7: agg.d7, d30: agg.d30, last_at: agg.last_at, last_intent: latest ? latest.intent : null }];
  }
  if (/from marketing_plans/i.test(sql)) return PLAN_ROWS.slice();
  if (/from llm_spend/i.test(sql)) return llmSpendRows(sql, params);
  if (/group by stack_hash/i.test(sql)) return CLIENT_ERROR_GROUPS.slice();
  if (/from audit_log/i.test(sql) && /group by 1, 2/i.test(sql)) return topActorRows(sql);
  if (/from audit_log/i.test(sql) && /as last_action/i.test(sql)) return adoptionPerCenterRows(sql);
  if (/event_type = 'login_success'/i.test(sql)) {
    return [{ center_id: 'libramont', last_login: isoAgo(1 * DAY) }];
  }
  if (/from staff_sessions/i.test(sql) && /::int as active/i.test(sql)) {
    return [{ center_id: 'libramont', active: 2 }];
  }
  if (/::int as sent/i.test(sql)) return commVolumeRows(sql);
  // Toutes les autres lectures du bundle : vide plausible (compteurs a zero).
  return [];
}

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    if (/insert into audit_log/i.test(sql)) {
      const cols = (sql.match(/insert into audit_log \(([^)]+)\)/i) || [null, ''])[1]
        .split(',').map((c) => c.trim()).filter(Boolean);
      const row = {};
      cols.forEach((col, i) => { row[col] = params[i]; });
      auditRows.push(row);
      return { rows: [{ id: auditRows.length, occurred_at: new Date().toISOString() }], rowCount: 1 };
    }
    return { rows: fakeRowsFor(sql, params) || [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
// Le bootstrap de schema staff-auth se declenche (le faux pool repond "rien de
// provisionne") et exige des codes d'acces en environnement. On active le
// repli de developpement du module lui-meme plutot que d'inventer des codes :
// c'est le chemin prevu pour les tests locaux, et il est refuse en production.
process.env.ALLOW_INSECURE_STAFF_CODES = 'true';
// Le plafond LLM teste est le DEFAUT du code (5 USD), pas une valeur locale.
delete process.env.LLM_MONTHLY_BUDGET_USD;

// ---------------------------------------------------------------------------
// Deux LIGNES de session (pas des objets session) : le vrai code fait tout le
// reste. La regle testee vit dans getStaffSessionFromToken (locked = tous les
// droits du centre + plateforme EXPLICITE seulement) et sessionHasPermission.
// ---------------------------------------------------------------------------
const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();

const SESSION_ROWS = {
  direction: {
    token_hash: 'ignore-par-le-faux-pool',
    center_id: 'libramont',
    expires_at: FUTURE,
    member_id: 'libramont:demo-direction',
    member_name: 'Directrice Demo',
    contact: '',
    member_status: 'active',
    role_id: 'direction',
    role_name: 'Direction',
    role_code: 'DIR',
    // Role verrouille SANS permission plateforme explicite : la session
    // recevra ALL_PERMISSIONS (droits du centre) mais JAMAIS platform.admin.
    permissions: [],
    locked: true,
  },
  platform: {
    token_hash: 'ignore-par-le-faux-pool',
    center_id: 'libramont',
    expires_at: FUTURE,
    member_id: 'libramont:platform-owner',
    member_name: 'Proprietaire plateforme',
    contact: '',
    member_status: 'active',
    role_id: 'platform-owner',
    role_name: 'Proprietaire plateforme',
    role_code: 'PL',
    permissions: ['direction.view', 'centers.switch', 'platform.admin'],
    locked: true,
  },
};

const opsPath = require.resolve('../api/ops.js');
delete require.cache[opsPath];
const opsHandler = require('../api/ops.js');

const founderLibPath = path.join(ROOT, 'lib', 'founder-cockpit.js');
function freshFounderLib() {
  delete require.cache[require.resolve(founderLibPath)];
  return require(founderLibPath);
}

const activeToken = () => 'jeton-de-test';

function makeReq(action, method = 'GET', body = null) {
  const charge = body ? JSON.stringify(body) : '';
  return {
    method,
    url: `/api/ops?action=${encodeURIComponent(action)}`,
    // Le jeton staff voyage dans x-staff-session (readSessionToken,
    // lib/staff-auth.js), PAS dans Authorization : une premiere version de ce
    // gate l'envoyait en Bearer et obtenait 401 partout, y compris pour la
    // session plateforme, ce qui rendait la section [A] verte pour une
    // MAUVAISE raison (pas de session du tout, au lieu de permission refusee).
    headers: { 'content-type': 'application/json', 'x-staff-session': activeToken(), host: 'localhost' },
    async *[Symbol.asyncIterator]() { if (charge) yield Buffer.from(charge); },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: '',
    setHeader() {},
    writeHead(code) { this.statusCode = code; this.headersSent = true; },
    end(chunk) { this.body += chunk || ''; this.headersSent = true; },
  };
  return res;
}

async function getJson(action) {
  const res = makeRes();
  await opsHandler(makeReq(action, 'GET'), res);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (error) { payload = null; }
  return { status: res.statusCode, payload };
}

const COCKPIT_ACTIONS = [
  { action: 'founderCockpit', method: 'GET' },
  { action: 'founderAuditLog', method: 'GET' },
  { action: 'founderAgents', method: 'GET' },
  { action: 'founderIncidents', method: 'GET' },
  { action: 'founderClients', method: 'GET' },
  { action: 'requeueOpsJob', method: 'POST', body: { action: 'requeueOpsJob', id: 1, centerId: 'libramont' } },
];

const FOUNDER_GET_ACTIONS = ['founderCockpit', 'founderAgents', 'founderIncidents', 'founderClients'];

const SECRET_PATTERNS = [
  /access_code/i, /accessCode/, /token_hash/i, /sessionToken/i,
  /sk-[a-zA-Z0-9]{8}/, /re_[a-zA-Z0-9]{8}/, /postgres:\/\//i, /Bearer /,
];

function envelopeOk(payload) {
  return Boolean(payload)
    && payload.ok === true
    && payload.testData === true
    && !Number.isNaN(Date.parse(payload.generatedAt));
}

// ---------------------------------------------------------------------------
// Sondes reutilisees par les sections vertes ET par la contre-preuve par
// mutation : chacune repond "l'invariant tient-il ?" sur le VRAI comportement
// (builder execute sur le faux pool), jamais sur une presence de chaine.
// ---------------------------------------------------------------------------
async function probeOwnerExclusion(mod) {
  const bundle = await mod.buildFounderClients();
  const libr = (bundle.centers || []).find((c) => c.id === 'libramont') || {};
  const actorsList = Array.isArray(libr.topActors) ? libr.topActors : [];
  const serialized = JSON.stringify(actorsList);
  return actorsList.length === 2
    && actorsList[0] && actorsList[0].label === 'Directrice Demo' && actorsList[0].count30d === 3
    && actorsList[1] && actorsList[1].label === 'Accueil' && actorsList[1].count30d === 1
    && !serialized.includes('platform-owner')
    && !serialized.includes('Proprietaire plateforme');
}

async function probeCostHonesty(mod) {
  const bundle = await mod.buildFounderAgents();
  return Boolean(bundle.cost) && bundle.cost.costPerAgentMeasured === false;
}

async function probeConsoleMapping(mod) {
  const bundle = await mod.buildFounderIncidents();
  const groups = (bundle.console && bundle.console.groups) || [];
  return groups.length === 2
    && groups[0].message === 'Boom menu'
    && groups[0].count === 3;
}

async function probePendingInsights(mod) {
  const bundle = await mod.buildFounderAgents();
  const list = bundle.pendingInsights || [];
  return list.length === 1
    && list[0] && list[0].id === 101
    && list[0].status === 'pending'
    && list[0].title === 'Idee pluie samedi';
}

(async () => {
  // =========================================================================
  console.log('[A] une session DIRECTION est refusee sur CHAQUE action du cockpit');
  // =========================================================================
  activeSessionRow = SESSION_ROWS.direction;
  for (const entry of COCKPIT_ACTIONS) {
    auditRows.length = 0;
    const res = makeRes();
    try { await opsHandler(makeReq(entry.action, entry.method, entry.body), res); } catch (error) { /* le refus repond, il ne jette pas */ }
    ok(res.statusCode === 403 || res.statusCode === 401,
      `${entry.action} : refus serveur pour Direction (obtenu ${res.statusCode})`);
    ok(!String(res.body).includes('"ok":true'),
      `${entry.action} : aucun contenu du cockpit ne fuit dans la reponse`);
    const denied = auditRows.filter((row) => row.outcome === 'denied');
    ok(denied.length > 0,
      `${entry.action} : le refus est TRACE dans audit_log (outcome=denied, ${denied.length} ligne(s))`);
  }

  // =========================================================================
  console.log('\n[B] une session PLATEFORME obtient le bundle, et le bundle dit la verite');
  // =========================================================================
  activeSessionRow = SESSION_ROWS.platform;
  const res = makeRes();
  await opsHandler(makeReq('founderCockpit', 'GET'), res);
  ok(res.statusCode === 200, `founderCockpit : 200 pour platform.admin (obtenu ${res.statusCode})`);
  let bundle = null;
  try { bundle = JSON.parse(res.body); } catch (error) { bundle = null; }
  ok(Boolean(bundle && bundle.ok), 'le bundle est un JSON valide avec ok=true');
  ok(bundle && bundle.testData === true,
    'testData=true : le bundle dit que le SaaS n est pas lance (le bandeau du front repose sur ce champ)');
  ok(bundle && Array.isArray(bundle.centers) && bundle.centers.length === 2,
    `les centres viennent de la table centers (obtenu ${bundle && bundle.centers ? bundle.centers.length : 'aucun'})`);

  // (d) AUCUN SECRET dans le bundle : ni nom de champ sensible, ni motif de
  // cle. On cherche dans le JSON serialise complet.
  const serialized = JSON.stringify(bundle);
  const leaked = SECRET_PATTERNS.filter((rx) => rx.test(serialized));
  ok(leaked.length === 0,
    `aucun motif de secret dans le bundle (${leaked.length ? `fuite: ${leaked.join(', ')}` : 'verifie sur le JSON complet'})`);

  // =========================================================================
  console.log('\n[C] la page Agents IA : comptes exacts, dates reelles, cout honnete');
  // =========================================================================
  const agentsResp = await getJson('founderAgents');
  ok(agentsResp.status === 200, `founderAgents : 200 pour platform.admin (obtenu ${agentsResp.status})`);
  const agentsBundle = agentsResp.payload || {};
  ok(envelopeOk(agentsBundle), 'envelope { ok, generatedAt, testData:true } sur founderAgents');
  const marketing = (agentsBundle.agents && agentsBundle.agents.marketing) || {};
  ok(marketing.count7d === 1 && marketing.count30d === 3,
    `agent marketing : volumes 7 j / 30 j exacts sur fixture (obtenu ${marketing.count7d} / ${marketing.count30d}, attendu 1 / 3)`);
  ok(marketing.validated === 2 && marketing.refuted === 1,
    `agent marketing : valides vs refutes mesures (obtenu ${marketing.validated} / ${marketing.refuted}, attendu 2 / 1)`);
  ok(marketing.lastAt === isoAgo(2 * DAY),
    'agent marketing : lastAt = la date REELLE du dernier insight (silence detectable)');
  ok(String(marketing.detail).includes('Idee pluie samedi'),
    `agent marketing : le dernier propose est nomme (obtenu "${marketing.detail}")`);
  const kindIdea = (marketing.byKind || []).find((k) => k.kind === 'idea') || {};
  ok(kindIdea.count === 2, `agent marketing : ventilation par kind (idea = ${kindIdea.count}, attendu 2)`);
  const mkLibr = (marketing.perCenter || []).find((c) => c.centerId === 'libramont') || {};
  const mkGemb = (marketing.perCenter || []).find((c) => c.centerId === 'gembloux') || {};
  ok(mkLibr.count30d === 2 && mkGemb.count30d === 1,
    `agent marketing : ventilation par centre (libramont ${mkLibr.count30d}, gembloux ${mkGemb.count30d}, attendu 2 et 1)`);

  const sugg = (agentsBundle.agents && agentsBundle.agents.suggestions) || {};
  ok(sugg.total === 3 && sugg.pending === 2 && sugg.count7d === 1 && sugg.count30d === 2,
    `suggestions terrain : total ${sugg.total}, en attente ${sugg.pending}, 7 j ${sugg.count7d}, 30 j ${sugg.count30d} (attendu 3, 2, 1, 2)`);
  const deci = (agentsBundle.agents && agentsBundle.agents.decisions) || {};
  ok(deci.count7d === 2 && deci.count30d === 3 && deci.lastAt === isoAgo(1 * DAY),
    `decisions : 7 j ${deci.count7d}, 30 j ${deci.count30d}, avec la vraie date (attendu 2, 3)`);
  const mailsAgent = (agentsBundle.agents && agentsBundle.agents.emails) || {};
  ok(mailsAgent.count7d === 1 && mailsAgent.count30d === 2 && mailsAgent.lastAt === isoAgo(2 * DAY),
    `agent emails (tables presentes) : 7 j ${mailsAgent.count7d}, 30 j ${mailsAgent.count30d} (attendu 1, 2)`);

  const planRows = (agentsBundle.plans && agentsBundle.plans.rows) || [];
  ok(planRows.length === 1 && planRows[0].centerId === 'libramont'
    && planRows[0].status === 'proposed' && planRows[0].fromDate === '2026-07-20' && planRows[0].mode === 'rules',
  'plans marketing : la ligne fixture ressort avec les champs du front (centerId, status, fromDate, mode)');

  // pendingInsights : les lignes ACTIONNABLES du panneau Appliquer/Ignorer.
  // Seul l'insight 'proposed' remonte ; son etat de base est traduit dans le
  // 'pending' que le front asservit (collectActionableInsights). Un id
  // NUMERIQUE est indispensable (sinon aucun bouton cote front).
  const pendingInsights = agentsBundle.pendingInsights || [];
  ok(Array.isArray(pendingInsights) && pendingInsights.length === 1,
    `pendingInsights : 1 ligne actionnable (le seul insight 'proposed'), obtenu ${Array.isArray(pendingInsights) ? pendingInsights.length : 'non-tableau'}`);
  const pend = pendingInsights[0] || {};
  ok(typeof pend.id === 'number' && Number.isFinite(pend.id) && pend.id === 101,
    `pendingInsights : id NUMERIQUE de la ligne (obtenu ${pend.id}) : sans lui, le front n affiche aucun bouton`);
  ok(pend.status === 'pending',
    `pendingInsights : l etat 'proposed' de la base est traduit en 'pending' attendu par le front (obtenu "${pend.status}")`);
  ok(pend.title === 'Idee pluie samedi' && pend.centerId === 'libramont' && pend.kind === 'idea',
    `pendingInsights : titre, centre et kind mappes (obtenu ${JSON.stringify({ title: pend.title, centerId: pend.centerId, kind: pend.kind })})`);
  ok(pend.proposedAt === isoAgo(2 * DAY),
    'pendingInsights : proposedAt = la date REELLE du propose (pas un faux zero de date)');
  ok(!pendingInsights.some((p) => ['validated', 'refuted', 'applied', 'ignored'].includes(String(p.title).toLowerCase()))
    && !pendingInsights.some((p) => p.id === 102 || p.id === 103 || p.id === 104),
  'pendingInsights : aucun insight deja arbitre (valide/refute) ne fuite dans la file en attente');

  const cost = agentsBundle.cost || {};
  ok(cost.budgetUsd === 5,
    `plafond LLM : defaut 5 USD sans LLM_MONTHLY_BUDGET_USD (obtenu ${cost.budgetUsd})`);
  ok(Array.isArray(cost.months) && cost.months.length === 2
    && cost.months[0].month === CURRENT_MONTH && cost.months[0].costUsd === 1.23 && cost.months[0].calls === 10,
  `cout mensuel : mois courant en tete avec cout et appels exacts (obtenu ${JSON.stringify(cost.months && cost.months[0])})`);
  ok(cost.costPerAgentMeasured === false,
    'costPerAgentMeasured = false : le registre est GLOBAL, aucun cout ventile par agent n est invente');
  const agentsSerialized = JSON.stringify(agentsBundle);
  ok(!SECRET_PATTERNS.some((rx) => rx.test(agentsSerialized)),
    'aucun motif de secret dans le bundle founderAgents');

  // Bascule COMPORTEMENTALE : sans la table email_agent_memory, la carte
  // emails disparait (le front dira "aucune donnee"), elle ne devient pas un
  // zero qui ressemble a une mesure.
  emailTablesExist = false;
  const founderLib = require(founderLibPath);
  const withoutEmails = await founderLib.buildFounderAgents();
  ok(!withoutEmails.agents.emails && Boolean(withoutEmails.agents.marketing),
    'sans la table email_agent_memory, la carte emails est ABSENTE et les autres cartes restent');
  emailTablesExist = true;

  // =========================================================================
  console.log('\n[D] la page Incidents : groupes console mappes pour le front, casse reprise');
  // =========================================================================
  const incResp = await getJson('founderIncidents');
  ok(incResp.status === 200, `founderIncidents : 200 pour platform.admin (obtenu ${incResp.status})`);
  const incBundle = incResp.payload || {};
  ok(envelopeOk(incBundle), 'envelope { ok, generatedAt, testData:true } sur founderIncidents');
  const consoleSection = incBundle.console || {};
  const groups = consoleSection.groups || [];
  ok(consoleSection.window === '14 derniers jours',
    `la fenetre des erreurs console est annoncee (obtenu "${consoleSection.window}")`);
  ok(groups.length === 2, `2 groupes d erreurs console (obtenu ${groups.length})`);
  const g0 = groups[0] || {};
  const g1 = groups[1] || {};
  ok(g0.message === 'Boom menu' && g0.count === 3 && g0.id === 'a'.repeat(40),
    `groupe de tete : message, compte et id mappes sur les noms du front (obtenu "${g0.message}", ${g0.count})`);
  ok(String(g0.stack).includes('TypeError'),
    'le champ stack (nom du front) porte l extrait de stack du groupe');
  ok(Array.isArray(g0.centers) && g0.centers.length === 2 && g0.pages.length === 2,
    'centres et pages touches exposes en listes');
  ok(g0.membersTouches === 2, `membres touches comptes (obtenu ${g0.membersTouches})`);
  ok(Date.parse(g0.lastAt) > Date.parse(g1.lastAt),
    'ordre verifie sur les VALEURS lastAt : le plus recent d abord');
  const breakage = incBundle.breakage || {};
  ok(breakage.mails && breakage.mails.failed === 0 && breakage.jobs && breakage.jobs.failed === 0,
    'la casse existante (mails, jobs) est reprise par les MEMES loaders : files vides, zeros calmes');
  ok(breakage.worker && breakage.worker.lastRun === null && breakage.denied && breakage.denied.count === 0,
    'worker et refus repris aussi : aucun passage, aucun refus dans la fixture');
  ok(breakage.audit && typeof breakage.audit === 'object',
    'la sante du journal d audit accompagne le triage');

  // =========================================================================
  console.log('\n[E] la page Clients : config posee, adoption, acteurs SANS le proprietaire');
  // =========================================================================
  const cliResp = await getJson('founderClients');
  ok(cliResp.status === 200, `founderClients : 200 pour platform.admin (obtenu ${cliResp.status})`);
  const cliBundle = cliResp.payload || {};
  ok(envelopeOk(cliBundle), 'envelope { ok, generatedAt, testData:true } sur founderClients');
  ok(cliBundle.excludesPlatformOwner === true,
    'excludesPlatformOwner=true : la page annonce son exclusion');
  const cliCenters = cliBundle.centers || [];
  ok(cliCenters.length === 2, `une carte par centre de la table centers (obtenu ${cliCenters.length})`);
  const libr = cliCenters.find((c) => c.id === 'libramont') || {};
  const gemb = cliCenters.find((c) => c.id === 'gembloux') || {};
  ok(libr.name === 'Fun Galaxy Libramont' && libr.status === 'active',
    'identite du centre : nom et statut de la table centers');
  ok(libr.config && libr.config.done === 3 && libr.config.total === 3
    && libr.config.lanes === 8 && libr.config.laserWeapons === 30 && libr.config.hoursDefined === true,
  `config posee libramont : 3/3 (8 pistes, 30 armes, horaires definis), obtenu ${JSON.stringify(libr.config)}`);
  ok(gemb.config && gemb.config.done === 2 && gemb.config.hoursDefined === false && gemb.config.laserWeapons === 20,
    `config posee gembloux : 2/3, un marqueur texte n est PAS un horaire pose, obtenu ${JSON.stringify(gemb.config)}`);
  ok(libr.adoption && libr.adoption.actions7d === 3 && libr.adoption.actions30d === 4,
    `adoption libramont SANS le proprietaire : 7 j ${libr.adoption && libr.adoption.actions7d}, 30 j ${libr.adoption && libr.adoption.actions30d} (attendu 3 et 4 ; avec lui ce serait 8 et 9)`);
  ok(libr.adoption.lastStaffAction === isoAgo(2 * DAY),
    'derniere action staff libramont : celle de la directrice, PAS celle du proprietaire d hier');
  ok(libr.adoption.activeSessions === 2 && Boolean(libr.adoption.lastLogin),
    'sessions actives et derniere connexion remontees pour libramont');
  ok(gemb.adoption && gemb.adoption.actions30d === 2 && gemb.adoption.activeSessions === 0 && gemb.adoption.lastLogin === null,
    'gembloux : 2 actions 30 j, aucune session active, jamais connecte (null, pas un faux zero de date)');
  ok(await probeOwnerExclusion(founderLib),
    'top acteurs libramont : Directrice Demo (3) puis Accueil (1), le proprietaire plateforme (5 actions hier) est ABSENT');
  const gembActors = Array.isArray(gemb.topActors) ? gemb.topActors : [];
  ok(gembActors.length === 1 && gembActors[0].label === 'gembloux:staff-1' && gembActors[0].count30d === 2,
    `top acteurs gembloux : repli sur le member_id quand le label est vide (obtenu ${JSON.stringify(gembActors)})`);
  ok(libr.mails && libr.mails.sent30d === 4 && libr.mails.failed30d === 2,
    `volume mails libramont 30 j : ${libr.mails && libr.mails.sent30d} envoyes, ${libr.mails && libr.mails.failed30d} echecs (attendu 4 et 2 ; la ligne a 45 j ne compte pas)`);
  ok(gemb.mails && gemb.mails.sent30d === 1 && gemb.mails.failed30d === 0,
    'volume mails gembloux : 1 envoye, 0 echec (la ligne ENTRANTE ne compte pas)');
  const defaults = require('../lib/ops-communications').getAutomationDefaults();
  const defaultKeys = Object.keys(defaults);
  const defaultActive = defaultKeys.filter((key) => defaults[key].enabled).length;
  ok(libr.sequences && libr.sequences.total === defaultKeys.length && libr.sequences.active === defaultActive,
    `sequences libramont : ${libr.sequences && libr.sequences.active} / ${libr.sequences && libr.sequences.total} actives (defauts du produit, aucun ecart stocke)`);
  const cliSerialized = JSON.stringify(cliBundle);
  ok(!SECRET_PATTERNS.some((rx) => rx.test(cliSerialized)),
    'aucun motif de secret dans le bundle founderClients');
  ok(!cliSerialized.includes('platform-owner') && !cliSerialized.includes('Proprietaire plateforme'),
    'le proprietaire plateforme n apparait NULLE PART dans le JSON complet de la page Clients');

  // =========================================================================
  console.log('\n[F] contre-epreuve : platform.admin retire -> la meme session est refusee partout');
  // =========================================================================
  activeSessionRow = {
    ...SESSION_ROWS.platform,
    permissions: SESSION_ROWS.platform.permissions.filter((p) => p !== 'platform.admin'),
  };
  for (const action of FOUNDER_GET_ACTIONS) {
    const res2 = makeRes();
    await opsHandler(makeReq(action, 'GET'), res2);
    ok(res2.statusCode === 403 || res2.statusCode === 401,
      `${action} : sans platform.admin, la meme session est refusee (obtenu ${res2.statusCode}) : le role locked ne suffit pas`);
  }
  activeSessionRow = SESSION_ROWS.platform;

  // =========================================================================
  console.log('\n[G] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
  // =========================================================================
  async function withMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(founderLibPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`founder-cockpit-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`founder-cockpit-check: la mutation n'a rien change au fichier : ${label}`);
      process.exit(1);
    }
    fs.writeFileSync(founderLibPath, mutated);
    let holds = true;
    try {
      holds = await probe(freshFounderLib());
    } finally {
      // Restauration par EDITION INVERSE : reecriture du contenu exact
      // d'origine, jamais git checkout.
      fs.writeFileSync(founderLibPath, original);
    }
    if (holds) {
      console.error(`founder-cockpit-check: MUTATION SANS EFFET, le gate ne sait pas rougir sur ce point : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    const restoredHolds = await probe(freshFounderLib());
    ok(restoredHolds, `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  await withMutation(
    "      -- jamais le proprietaire plateforme dans le top des acteurs\n      and coalesce(actor_member_id, '') not like '%:platform-owner'",
    "      -- jamais le proprietaire plateforme dans le top des acteurs\n      and coalesce(actor_member_id, '') not like '%:personne-exclue'",
    probeOwnerExclusion,
    'exclusion du proprietaire plateforme retiree du top des acteurs',
  );

  await withMutation(
    'costPerAgentMeasured: false,',
    'costPerAgentMeasured: true,',
    probeCostHonesty,
    'honnetete du cout inversee (cout par agent pretendu mesure)',
  );

  await withMutation(
    'message: group.sampleMessage,',
    "message: '',",
    probeConsoleMapping,
    'mapping du message des groupes console casse',
  );

  // pendingInsights : deviner le filtre de statut vers un etat deja arbitre
  // (validated) ferait remonter 2 lignes non actionnables dans le panneau
  // Appliquer/Ignorer -> la sonde (1 seule ligne, l insight propose) rougit.
  await withMutation(
    "where status = 'proposed'",
    "where status = 'validated'",
    probePendingInsights,
    'filtre des insights actionnables devie vers un statut deja arbitre',
  );

  if (failures) {
    console.error(`\nfounder-cockpit-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nfounder-cockpit-check: ALL OK');
})().catch((error) => {
  console.error('founder-cockpit-check: exception', error);
  process.exit(1);
});
