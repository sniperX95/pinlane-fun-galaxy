// Gate du COCKPIT FONDATEUR : cloisonnement plateforme et honnetete du bundle.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif, et les sessions sont stubbees au niveau de
// lib/staff-auth. On exerce le VRAI dispatcher de api/ops.js (lecon des neuf
// faux verts du projet : tester l'outil ne prouve pas qu'il est branche).
//
// CE QUE CE GATE PROUVE, chaque point contre-eprouve :
//   (a) une session DIRECTION (role verrouille, tous les droits du centre,
//       SANS platform.admin) recoit un REFUS serveur sur CHACUNE des actions
//       du cockpit. Le raccourci role.locked ne confere jamais une permission
//       plateforme.
//   (b) ce refus est TRACE dans audit_log avec outcome=denied : la tentative
//       d'acces au cockpit par un non-porteur est exactement le signal que le
//       journal existe pour capter.
//   (c) une session PLATEFORME (platform.admin explicite) obtient le bundle,
//       et le bundle dit la verite : testData = true tant que le SaaS n'est
//       pas lance (le front affiche le bandeau sur la foi de ce champ).
//   (d) le bundle ne contient AUCUN secret (pas de cle, pas de code d'acces,
//       pas de hash) : c'est un ecran, pas un vidage de base.
//
// Lancement : node scripts/founder-cockpit-check.js

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Faux pool pg : sert des reponses plausibles a TOUTES les requetes du bundle
// (le contenu importe peu, c'est le CLOISONNEMENT qu'on teste), et capture les
// INSERT du journal d'audit pour prouver la trace du refus.
// ---------------------------------------------------------------------------
const auditRows = [];

// La ligne de session que le faux pool sert a la requete de resolution
// (join staff_sessions/staff_members/staff_roles). C'est ce qui fait tourner
// le VRAI chemin : hashSecret, getStaffSessionFromToken, la regle
// "locked = tous les droits du centre + permissions plateforme EXPLICITES
// seulement", puis sessionHasPermission. Aucun stub de fonction.
let activeSessionRow = null;

function fakeRowsFor(sql) {
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
    return { rows: fakeRowsFor(sql) || [], rowCount: 0 };
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

const COCKPIT_ACTIONS = [
  { action: 'founderCockpit', method: 'GET' },
  { action: 'founderAuditLog', method: 'GET' },
  { action: 'requeueOpsJob', method: 'POST', body: { action: 'requeueOpsJob', id: 1, centerId: 'libramont' } },
];

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
  const SECRET_PATTERNS = [
    /access_code/i, /accessCode/, /token_hash/i, /sessionToken/i,
    /sk-[a-zA-Z0-9]{8}/, /re_[a-zA-Z0-9]{8}/, /postgres:\/\//i, /Bearer /,
  ];
  const leaked = SECRET_PATTERNS.filter((rx) => rx.test(serialized));
  ok(leaked.length === 0,
    `aucun motif de secret dans le bundle (${leaked.length ? `fuite: ${leaked.join(', ')}` : 'verifie sur le JSON complet'})`);

  // =========================================================================
  console.log('\n[C] contre-epreuve : platform.admin retire -> la meme session est refusee');
  // =========================================================================
  activeSessionRow = {
    ...SESSION_ROWS.platform,
    permissions: SESSION_ROWS.platform.permissions.filter((p) => p !== 'platform.admin'),
  };
  const res2 = makeRes();
  await opsHandler(makeReq('founderCockpit', 'GET'), res2);
  ok(res2.statusCode === 403 || res2.statusCode === 401,
    `sans platform.admin, la meme session est refusee (obtenu ${res2.statusCode}) : le role locked ne suffit pas`);

  if (failures) {
    console.error(`\nfounder-cockpit-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nfounder-cockpit-check: ALL OK');
})().catch((error) => {
  console.error('founder-cockpit-check: exception', error);
  process.exit(1);
});
