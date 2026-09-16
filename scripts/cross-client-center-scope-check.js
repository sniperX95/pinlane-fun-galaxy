// Gate d'ISOLATION INTER-CLIENTS sur le CENTRE DEMANDE (2026-08-08).
//
// LA QUESTION POSEE : une session staff LEGITIME du client A peut-elle lire et
// ecrire les donnees d'un centre appartenant au client B, en forgeant un appel
// API qui porte `centerId=<centre de B>` ?
//
// Le chemin exact mis sous test, de bout en bout :
//   1. requireStaffPermission (lib/staff-auth.js) recoit le centre DEMANDE.
//      S'il differe du centre de SESSION, il n'exige qu'une chose :
//      sessionHasPermission(session, 'centers.switch'). Or 'centers.switch' est
//      dans ALL_PERMISSIONS, et sessionHasPermission renvoie true pour TOUTE
//      permission non-plateforme des que session.role.locked est vrai. Le role
//      Direction est locked. Donc toute Direction passe.
//   2. Il renvoie alors authorizedCenterId = le centre DEMANDE.
//   3. api/ops.js le repasse a resolveEffectiveCenterId, qui le donne aux
//      lecteurs (listOpsEvents, listCommunications...) et aux ecritures
//      (updateCustomRequestStatus...), lesquels filtrent sur center_id = $1.
// Aucune etape ne compare le client_id du centre demande a celui de la session.
//
// CE QUE CE GATE EXIGE (donc ce qu'il fait ROUGIR tant que ce n'est pas vrai) :
//   [A] une Direction du client A qui demande un centre du client B est REFUSEE
//       (403) par requireStaffPermission ;
//   [B] le dispatcher GET api/ops.js ne renvoie AUCUNE donnee du client B ;
//   [C] une ecriture POST visant une ligne du client B ne mute RIEN.
// Et ce qu'il exige de ne PAS casser (contre-preuves de non-regression) :
//   [D] le switch entre deux centres du MEME client reste autorise (c'est la
//       raison d'etre de 'centers.switch' : Fun Galaxy a 3 centres) ;
//   [E] le proprietaire plateforme (platform.admin) traverse toujours ;
//   [F] la liste des centres, elle, etait DEJA scopee (lib/center-scope.js) :
//       le contraste prouve que le trou est bien dans le scope de DONNEES, pas
//       dans la liste, et que ce gate ne re-teste pas ce qui est deja couvert
//       par scripts/center-tenant-isolation-check.js.
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache AVANT tout
// require applicatif. La base de prod n'est jamais touchee.
// Lancement : node scripts/cross-client-center-scope-check.js

const path = require('path');
const crypto = require('crypto');

// -- Environnement deterministe ----------------------------------------------
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-cross-client-isolation-secret-2026';
process.env.STAFF_DIRECTION_CODE = 'GATE-DIRECTION-2026-AAAA';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-BBBB';

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Meme derivation que lib/staff-auth.hashSecret : c'est ce qui permet de forger
// une ligne staff_sessions coherente sans stub, donc d'exercer le VRAI
// getStaffSessionFromToken (et pas une session inventee en memoire).
function hashSecret(value) {
  return crypto
    .createHash('sha256')
    .update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`)
    .digest('hex');
}

// Copie de STAFF_PERMISSION_GROUPS (lib/staff-auth.js) : une FIXTURE, volontai-
// rement figee. Si la liste du produit change, ce gate teste toujours le meme
// univers, ce qui est le comportement voulu pour un test de securite.
const ALL_PERMISSIONS = [
  'dashboard.view', 'direction.view', 'centers.switch', 'reports.export',
  'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel',
  'reservations.status', 'reservations.quick',
  'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
  'pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops',
];

// -- Univers : DEUX clients Pinlane ------------------------------------------
// Fun Galaxy possede libramont/gembloux/ciney. MI-12 SARL possede mi-12.
const CENTER_ROWS = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'mi-12', name: 'MI-12 Bowling', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'mi-12-client', client_name: 'MI-12 SARL' },
];

// Marqueur unique : s'il apparait dans une reponse servie a Fun Galaxy, la
// donnee d'un autre client a fuite. Aucune assertion "de forme" ici.
const MARQUEUR_MI12 = 'FUITE-MI12-DONNEE-CONFIDENTIELLE';

const opsEvents = [
  { id: 1, center_id: 'libramont', reservation_id: null, formula_id: '', activity_id: '', event_type: 'reservation_created', payload: { note: 'evenement Fun Galaxy' }, created_at: '2026-08-01T10:00:00.000Z' },
  { id: 2, center_id: 'mi-12', reservation_id: null, formula_id: '', activity_id: '', event_type: 'reservation_created', payload: { note: MARQUEUR_MI12 }, created_at: '2026-08-01T11:00:00.000Z' },
];

const customRequests = [
  { id: 1, center_id: 'libramont', contact_name: 'Prospect Fun Galaxy', email: 'a@exemple.be', phone: '+32470000001', message: 'demande', status: 'new' },
  { id: 2, center_id: 'mi-12', contact_name: 'Prospect MI-12', email: 'b@exemple.be', phone: '+32470000002', message: MARQUEUR_MI12, status: 'new' },
];

// -- Sessions forgees en base (lignes staff_sessions + jointures) -------------
const DIRECTION_TOKEN = 'fgs_gate_direction_fungalaxy';
const OWNER_TOKEN = 'fgs_gate_owner_plateforme';

function sessionRow({ token, centerId, memberId, memberName, roleId, roleName, roleCode, permissions, locked }) {
  return {
    token_hash: hashSecret(token),
    center_id: centerId,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    member_id: memberId,
    member_name: memberName,
    contact: '',
    member_status: 'active',
    role_id: roleId,
    role_name: roleName,
    role_code: roleCode,
    permissions,
    locked,
  };
}

const SESSION_BY_HASH = new Map([
  // Direction LEGITIME du client Fun Galaxy, sur son centre libramont.
  [hashSecret(DIRECTION_TOKEN), sessionRow({
    token: DIRECTION_TOKEN,
    centerId: 'libramont',
    memberId: 'libramont:direction-local',
    memberName: 'Direction Fun Galaxy',
    roleId: 'direction',
    roleName: 'Direction',
    roleCode: 'DI',
    permissions: ALL_PERMISSIONS,
    locked: true,
  })],
  // Proprietaire de la PLATEFORME : lui a le droit de traverser les clients.
  [hashSecret(OWNER_TOKEN), sessionRow({
    token: OWNER_TOKEN,
    centerId: 'libramont',
    memberId: 'libramont:platform-owner',
    memberName: 'Proprietaire plateforme',
    roleId: 'platform-owner',
    roleName: 'Proprietaire plateforme',
    roleCode: 'PL',
    permissions: [...ALL_PERMISSIONS, 'platform.admin'],
    locked: true,
  })],
]);

// -- Faux moteur SQL ----------------------------------------------------------
// Il OBEIT AU TEXTE de la requete : il n'applique un filtre centre que si le SQL
// le porte vraiment. C'est ce qui rend ce gate capable de virer au rouge.
const sqlLog = [];
const auditRows = [];

class FakePool {
  constructor(options = {}) { this.options = options; }

  async query(text, params = []) {
    const sql = String(text);
    sqlLog.push({ sql, params });

    // Fast-path de provisioning (staffAuthSchemaAlreadyProvisioned) : on rend
    // exactement les lignes attendues pour que le bootstrap DDL soit saute.
    if (/select\s+id,\s*access_code_hash\s+from\s+staff_members\s+where\s+id\s*=\s*any/i.test(sql)) {
      const ids = Array.isArray(params[0]) ? params[0] : [];
      const rows = ids.map((id) => ({
        id,
        access_code_hash: id.endsWith(':platform-owner')
          ? hashSecret(process.env.PLATFORM_OWNER_CODE)
          : hashSecret(process.env.STAFF_DIRECTION_CODE),
      }));
      return { rows, rowCount: rows.length };
    }

    // Lecture de session (getStaffSessionFromToken).
    if (/from\s+staff_sessions\s+s/i.test(sql) && /s\.token_hash\s*=\s*\$1/.test(sql)) {
      const row = SESSION_BY_HASH.get(String(params[0] || ''));
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // Journal d'audit : on garde les lignes pour verifier que le refus est trace.
    if (/insert\s+into\s+audit_log/i.test(sql)) {
      auditRows.push({
        centerId: params[0], actorKind: params[1], actorMemberId: params[2],
        surface: params[5], action: params[6], outcome: params[10],
        deniedReason: params[11], context: params[13],
      });
      return { rows: [{ id: auditRows.length, occurred_at: new Date().toISOString() }], rowCount: 1 };
    }

    // Liste des centres jointe aux clients (lib/center-scope.js).
    if (/from\s+centers\b/i.test(sql) && /join\s+clients\b/i.test(sql)) {
      return { rows: CENTER_ROWS.map((row) => ({ ...row })), rowCount: CENTER_ROWS.length };
    }

    // Toute autre lecture de `centers` (dont la resolution de client qu'un
    // correctif ajouterait) : on rend les lignes brutes, filtrees si le SQL
    // porte un predicat d'id parametre.
    if (/from\s+centers\b/i.test(sql)) {
      const wanted = params.map((value) => String(value || ''));
      const rows = /where/i.test(sql) && wanted.length
        ? CENTER_ROWS.filter((row) => wanted.includes(row.id))
        : CENTER_ROWS;
      return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
    }

    // Lecture des evenements ops : filtre centre applique SEULEMENT si demande.
    if (/from\s+ops_events/i.test(sql)) {
      const scoped = /center_id\s*=\s*\$1/.test(sql)
        ? opsEvents.filter((row) => row.center_id === String(params[0] || ''))
        : opsEvents;
      return { rows: scoped.map((row) => ({ ...row })), rowCount: scoped.length };
    }

    // Upsert d'un centre (lib/center-config.upsertCenter, action saveCenter).
    // Le faux moteur applique VRAIMENT l'ecriture : si le code la laisse passer,
    // la fixture change et l'assertion [G] rougit.
    if (/insert\s+into\s+centers/i.test(sql)) {
      const id = String(params[0] || '');
      const cible = CENTER_ROWS.find((row) => row.id === id);
      if (cible) {
        cible.name = String(params[1] || cible.name);
        cible.status = String(params[2] || cible.status);
        return { rows: [{ ...cible }], rowCount: 1 };
      }
      const cree = { id, name: String(params[1] || ''), status: String(params[2] || 'active'), timezone: String(params[3] || 'Europe/Brussels'), settings: null, client_id: null, client_name: null };
      CENTER_ROWS.push(cree);
      return { rows: [{ ...cree }], rowCount: 1 };
    }

    // Ecriture par id sur les demandes sur mesure.
    if (/update\s+custom_requests/i.test(sql)) {
      const id = Number(params[0]);
      const scope = String(params[2] || '');
      const matched = customRequests.filter((row) => Number(row.id) === id && (scope === '' || row.center_id === scope));
      matched.forEach((row) => { row.status = params[1]; });
      return { rows: matched.map((row) => ({ ...row })), rowCount: matched.length };
    }

    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }

  async end() {}
}

const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };

const { requireStaffPermission } = require(path.join(ROOT, 'lib', 'staff-auth.js'));
const { listCentersForSession } = require(path.join(ROOT, 'lib', 'center-scope.js'));

// -- Faux req / res -----------------------------------------------------------
function makeReq({ method = 'GET', url, token, body = null }) {
  const charge = body === null ? null : JSON.stringify(body);
  const req = {
    method,
    url,
    headers: { host: 'app.pinlane.be', 'x-staff-session': token, 'content-type': 'application/json' },
  };
  if (charge !== null) {
    req[Symbol.asyncIterator] = async function* iterate() { yield Buffer.from(charge); };
  }
  return req;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(payload) { this.body = payload === undefined ? '' : String(payload); this.ended = true; },
    writeHead(status) { this.statusCode = status; },
    ended: false,
  };
  return res;
}

(async () => {
  // ==========================================================================
  console.log('[A] requireStaffPermission : Direction du client A -> centre du client B');
  // ==========================================================================
  {
    const req = makeReq({ url: '/api/ops?action=events&centerId=mi-12', token: DIRECTION_TOKEN });
    const res = makeRes();
    const session = await requireStaffPermission(req, res, ['dashboard.view', 'ai.ops'], { centerId: 'mi-12' });

    ok(session === null,
      `la garde REFUSE un centre appartenant a un autre client (obtenu ${session ? `authorizedCenterId=${session.authorizedCenterId}` : 'refus'})`);
    ok(res.statusCode === 403,
      `le refus est un 403 explicite (obtenu statusCode=${res.statusCode || 'aucune reponse'})`);
    const refus = auditRows.filter((row) => row.outcome === 'denied');
    ok(refus.length > 0,
      `le refus inter-clients laisse une trace d audit (obtenu ${refus.length} refus trace(s))`);
  }

  // ==========================================================================
  console.log('\n[B] dispatcher GET api/ops.js : aucune donnee du client B ne sort');
  // ==========================================================================
  {
    const opsPath = require.resolve(path.join(ROOT, 'api', 'ops.js'));
    delete require.cache[opsPath];
    const handler = require(opsPath);
    const req = makeReq({ url: '/api/ops?action=events&centerId=mi-12', token: DIRECTION_TOKEN });
    const res = makeRes();
    try { await handler(req, res); } catch (error) { res.body = `exception:${error && error.message}`; }

    ok(!res.body.includes(MARQUEUR_MI12),
      `la reponse ne contient AUCUNE donnee du client MI-12 (marqueur ${res.body.includes(MARQUEUR_MI12) ? 'PRESENT' : 'absent'})`);
    ok(res.statusCode === 403,
      `l appel forge repart en 403 (obtenu statusCode=${res.statusCode})`);
    ok(!/"centerId"\s*:\s*"mi-12"/.test(res.body),
      'la reponse ne confirme meme pas le centre etranger comme portee servie');
  }

  // ==========================================================================
  console.log('\n[C] dispatcher POST api/ops.js : aucune ECRITURE chez le client B');
  // ==========================================================================
  {
    const opsPath = require.resolve(path.join(ROOT, 'api', 'ops.js'));
    delete require.cache[opsPath];
    const handler = require(opsPath);
    const req = makeReq({
      method: 'POST',
      url: '/api/ops',
      token: DIRECTION_TOKEN,
      body: { action: 'customRequestStatus', centerId: 'mi-12', id: 2, status: 'handled' },
    });
    const res = makeRes();
    try { await handler(req, res); } catch (error) { res.body = `exception:${error && error.message}`; }

    const cible = customRequests.find((row) => row.id === 2);
    ok(cible.status === 'new',
      `la ligne du client MI-12 n a PAS ete mutee (statut obtenu: ${cible.status})`);
    ok(!res.body.includes(MARQUEUR_MI12),
      'le contenu de la demande du client MI-12 ne fuite pas dans la reponse');
    ok(res.statusCode === 403,
      `l ecriture forgee repart en 403 (obtenu statusCode=${res.statusCode})`);
  }

  // ==========================================================================
  console.log('\n[D] NON-REGRESSION : le switch DANS le meme client reste autorise');
  // ==========================================================================
  {
    const req = makeReq({ url: '/api/ops?action=events&centerId=gembloux', token: DIRECTION_TOKEN });
    const res = makeRes();
    const session = await requireStaffPermission(req, res, ['dashboard.view', 'ai.ops'], { centerId: 'gembloux' });
    ok(session !== null && session.authorizedCenterId === 'gembloux',
      `la Direction Fun Galaxy passe toujours de libramont a gembloux (obtenu ${session ? session.authorizedCenterId : 'REFUS'})`);

    const reqSame = makeReq({ url: '/api/ops?action=events', token: DIRECTION_TOKEN });
    const resSame = makeRes();
    const sessionSame = await requireStaffPermission(reqSame, resSame, ['dashboard.view', 'ai.ops'], {});
    ok(sessionSame !== null && sessionSame.authorizedCenterId === 'libramont',
      `sans centre demande, la session garde le sien (obtenu ${sessionSame ? sessionSame.authorizedCenterId : 'REFUS'})`);
  }

  // ==========================================================================
  console.log('\n[E] NON-REGRESSION : le proprietaire plateforme traverse les clients');
  // ==========================================================================
  {
    const req = makeReq({ url: '/api/ops?action=events&centerId=mi-12', token: OWNER_TOKEN });
    const res = makeRes();
    const session = await requireStaffPermission(req, res, ['dashboard.view', 'ai.ops'], { centerId: 'mi-12' });
    ok(session !== null && session.authorizedCenterId === 'mi-12',
      `platform.admin garde l acces cross-client (obtenu ${session ? session.authorizedCenterId : 'REFUS'})`);
  }

  // ==========================================================================
  console.log('\n[F] CONTRASTE : la LISTE des centres etait deja cloisonnee');
  // ==========================================================================
  {
    const centres = await listCentersForSession(new FakePool(), {
      centerId: 'libramont',
      role: { id: 'direction', locked: true },
      permissions: ALL_PERMISSIONS,
    });
    const ids = centres.map((c) => c.id).sort();
    ok(!ids.includes('mi-12'),
      `la liste servie a Fun Galaxy exclut deja mi-12 (obtenu ${JSON.stringify(ids)})`);
  }

  // ==========================================================================
  console.log('\n[G] saveCenter : la cible voyage dans body.center.id, hors du scope centre');
  // ==========================================================================
  // Ce chemin n'est PAS couvert par la garde de centre : l'action est appelee
  // avec { centerId: 'all' } (portee plateforme) et son objet cible est lu dans
  // body.center.id, jamais dans body.centerId. La garde inter-clients ne peut
  // donc rien y faire : le controle doit se faire sur la CIBLE, dans le handler.
  {
    const opsPath = require.resolve(path.join(ROOT, 'api', 'ops.js'));
    delete require.cache[opsPath];
    const handler = require(opsPath);
    const avant = { ...CENTER_ROWS.find((row) => row.id === 'mi-12') };
    const req = makeReq({
      method: 'POST',
      url: '/api/ops',
      token: DIRECTION_TOKEN,
      body: { action: 'saveCenter', center: { id: 'mi-12', name: 'RENOMME PAR FUN GALAXY', status: 'closed' } },
    });
    const res = makeRes();
    try { await handler(req, res); } catch (error) { res.body = `exception:${error && error.message}`; }

    const apres = CENTER_ROWS.find((row) => row.id === 'mi-12');
    ok(apres.name === avant.name,
      `le centre d un AUTRE client n a pas ete renomme (obtenu "${apres.name}")`);
    ok(apres.status === avant.status,
      `le centre d un AUTRE client n a pas ete ferme (obtenu "${apres.status}")`);
    ok(res.statusCode === 403,
      `la prise de controle repart en 403 (obtenu statusCode=${res.statusCode})`);

    // NON-REGRESSION 1 : renommer SON PROPRE centre reste possible. C'est le
    // chemin normal de la page Etablissement (assets/app-main.js, submitCenterConfig).
    delete require.cache[opsPath];
    const handler2 = require(opsPath);
    const reqOwn = makeReq({
      method: 'POST',
      url: '/api/ops',
      token: DIRECTION_TOKEN,
      body: { action: 'saveCenter', center: { id: 'gembloux', name: 'Fun Galaxy Gembloux Centre', status: 'active' } },
    });
    const resOwn = makeRes();
    try { await handler2(reqOwn, resOwn); } catch (error) { resOwn.body = `exception:${error && error.message}`; }
    const own = CENTER_ROWS.find((row) => row.id === 'gembloux');
    ok(own.name === 'Fun Galaxy Gembloux Centre',
      `un centre de SON client reste renommable (obtenu "${own.name}")`);

    // NON-REGRESSION 2 : creer un centre NEUF reste possible (submitNewCenter).
    // Un id inconnu n'appartient a personne : ce n'est pas une prise de controle.
    delete require.cache[opsPath];
    const handler3 = require(opsPath);
    const reqNew = makeReq({
      method: 'POST',
      url: '/api/ops',
      token: DIRECTION_TOKEN,
      body: { action: 'saveCenter', center: { id: 'arlon', name: 'Fun Galaxy Arlon', status: 'planned' } },
    });
    const resNew = makeRes();
    try { await handler3(reqNew, resNew); } catch (error) { resNew.body = `exception:${error && error.message}`; }
    ok(CENTER_ROWS.some((row) => row.id === 'arlon'),
      'la creation d un centre NEUF reste possible pour la direction');
  }

  // ==========================================================================
  console.log('\n[H] api/marketing-agents.js : la portee "all" est reservee au plateforme');
  // ==========================================================================
  // Ce dispatcher a le SIEN, hors du refuserPorteePlateforme de api/ops.js. Il
  // gardait 'all' sur 'centers.switch' (que toute Direction verrouillee possede),
  // donc getCenterIds('all') rendait les centres de TOUS les clients. Le moteur
  // est stubbe : on ne teste que la DECISION d'autorisation, pas un vrai cycle.
  {
    const maPath = require.resolve(path.join(ROOT, 'lib', 'marketing-agents.js'));
    require.cache[maPath] = {
      id: maPath,
      filename: maPath,
      loaded: true,
      exports: {
        getMarketingAgentStatus: async ({ centerId }) => ({ centerId, ok: true, stub: true }),
        runMarketingAgentCycle: async ({ centerId }) => ({ centerId, ok: true, stub: true }),
        recordMarketingFeedback: async () => ({ ok: true, stub: true }),
      },
    };
    const agentsPath = require.resolve(path.join(ROOT, 'api', 'marketing-agents.js'));
    delete require.cache[agentsPath];
    const handler = require(agentsPath);

    // Direction Fun Galaxy (centers.switch, PAS platform.admin) + centerId=all : REFUS.
    const reqAllStatus = makeReq({ url: '/api/marketing-agents?action=status&centerId=all', token: DIRECTION_TOKEN });
    const resAllStatus = makeRes();
    try { await handler(reqAllStatus, resAllStatus); } catch (error) { resAllStatus.body = `exception:${error && error.message}`; }
    ok(resAllStatus.statusCode === 403,
      `GET status centerId=all d une Direction repart en 403 (obtenu statusCode=${resAllStatus.statusCode})`);
    ok(!resAllStatus.body.includes(MARQUEUR_MI12),
      'aucune donnee d un autre client ne sort par le statut multi-centres');

    // Meme refus a l ECRITURE (POST run), le chemin qui declenche les cycles + LLM.
    const reqAllRun = makeReq({
      method: 'POST',
      url: '/api/marketing-agents',
      token: DIRECTION_TOKEN,
      body: { action: 'run', centerId: 'all' },
    });
    const resAllRun = makeRes();
    try { await handler(reqAllRun, resAllRun); } catch (error) { resAllRun.body = `exception:${error && error.message}`; }
    ok(resAllRun.statusCode === 403,
      `POST run centerId=all d une Direction repart en 403 (obtenu statusCode=${resAllRun.statusCode})`);

    // NON-REGRESSION : la Direction garde son PROPRE centre.
    const reqOwn = makeReq({ url: '/api/marketing-agents?action=status&centerId=libramont', token: DIRECTION_TOKEN });
    const resOwn = makeRes();
    try { await handler(reqOwn, resOwn); } catch (error) { resOwn.body = `exception:${error && error.message}`; }
    ok(resOwn.statusCode !== 403,
      `la Direction lit toujours le statut de SON centre (obtenu statusCode=${resOwn.statusCode})`);

    // NON-REGRESSION : le proprietaire plateforme garde la portee 'all'.
    const reqOwner = makeReq({ url: '/api/marketing-agents?action=status&centerId=all', token: OWNER_TOKEN });
    const resOwner = makeRes();
    try { await handler(reqOwner, resOwner); } catch (error) { resOwner.body = `exception:${error && error.message}`; }
    ok(resOwner.statusCode !== 403,
      `platform.admin garde la portee multi-centres (obtenu statusCode=${resOwner.statusCode})`);
  }

  if (failures) {
    console.error(`\ncross-client-center-scope-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ncross-client-center-scope-check: ALL OK');
})().catch((error) => {
  console.error('cross-client-center-scope-check: exception', error && (error.stack || error.message || error));
  process.exit(1);
});
