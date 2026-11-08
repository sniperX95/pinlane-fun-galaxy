// LA PASSE SECURITE DU 2026-11-08 : chaque trou ferme, prouve par un REFUS sur le vrai code,
// puis par une contre-preuve qui remet l ancien code EN MEMOIRE et doit faire rougir.
//
// Demande d Ansar (07/11) : « bosser de fou sur toutes les securites, toutes les gardes,
// regarder si tout est bien analyse, s il ne manque rien ». Ce que ce gate exige :
//   [A] la portee 'all' (tous les clients) n est qu a la plateforme, sur TOUTES les routes :
//       POST /api/ops?centerId=all, corps sans centre, par une Direction de client : 403, la
//       demande de groupe d un autre client ne change pas, la tentative se trace ;
//   [B] « Voir les montants » vaut aussi au serveur : un role Marketing ne recoit aucun prix,
//       aucun encaisse, aucun chiffre d affaires, ni dans le planning du jour, ni dans la
//       plage de dates, ni dans les chiffres ; un Manager les recoit ;
//   [C] l export complet demande « Exporter » ET « Voir les montants » : le role Technique
//       (Réglages) est refuse, la Direction le prend, et le geste se trace au journal ;
//   [D] changer un prix du catalogue demande « Tarifs », meme avec « Réglages » ;
//   [E] un role qui gere l equipe sans etre la Direction ne change pas les droits de son
//       propre role, ne donne pas un droit qu il n a pas, ne fait pas une Direction par
//       modele, ne lit pas le code d une personne de la Direction ;
//   [F] un appareil bloque (8 codes faux) n essaie plus rien, meme en inventant un centre a
//       chaque essai, et le bon code n est meme pas verifie ;
//   [G] les lectures sans session ne remplissent plus le journal : une ligne par appareil,
//       par route et par heure ;
//   [H] une donnee de client ne part que chez Anthropic : sans sa cle, ni OpenAI ni Kimi ;
//   [J] ce qu un client ecrit ne devient jamais un lien dans un mail du centre ;
//   [O] un code de role change ferme les sessions ouvertes avec l ancien ;
//   [P] les petites portes : le limiteur compte l adresse donnee par Vercel, pas celle que le
//       client ecrit, et une adresse IPv6 par son bloc /64 ; le code de demonstration est
//       refuse en production ; la ligne du proprietaire ne change pas de role ;
//   [Q] un role qui modifie un dossier sans voir les montants ne touche a aucun montant : la
//       console renvoie le dossier entier, ses montants vides, et chaque ligne garde le sien ;
//   [R] la session de secours du proprietaire : limitee pendant une panne, et elle sonne ; l etat
//       hors ligne ne recopie pas le message du pilote de base ;
//   [S] une ecriture du personnel vient de la console : un site voisin (Sec-Fetch-Site) est
//       refuse, et les routes du personnel ne repondent plus aux autres origines ;
//   [T] glisser une activite demande le droit de sa ressource (bowling, laser) ;
//   [U] le plan interne (risque, consignes) ne part pas a un visiteur anonyme ;
//   [V] un corps public au-dela de 64 Ko est refuse avant d etre traite.
//   [W] la feuille imprimee, les deux Excel et la question libre a l IA suivent aussi le droit.
//
// Zero reseau, zero base : 'pg' est remplace avant tout require applicatif. Les contre-preuves
// compilent une source mutee en memoire : le disque n est jamais ecrit.
// Lancement : node scripts/securite-passe-check.js
'use strict';

for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|KIMI|MOONSHOT|TELEGRAM|BREVO|LLM_)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_INSECURE_STAFF_CODES;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-securite-passe-secret-2026';
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-SECURITE-2026';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const F = {
  staffAuth: path.join(ROOT, 'lib', 'staff-auth.js'),
  apiStaffAuth: path.join(ROOT, 'api', 'staff-auth.js'),
  ops: path.join(ROOT, 'api', 'ops.js'),
  staffState: path.join(ROOT, 'api', 'staff-state.js'),
  adminRange: path.join(ROOT, 'api', 'admin-range.js'),
  http: path.join(ROOT, 'lib', 'http.js'),
  llm: path.join(ROOT, 'lib', 'llm-client.js'),
  comms: path.join(ROOT, 'lib', 'ops-communications.js'),
  rateLimit: path.join(ROOT, 'lib', 'rate-limit.js'),
  reservations: path.join(ROOT, 'api', 'staff-reservations.js'),
  dispo: path.join(ROOT, 'api', 'public-availability.js'),
  meta: path.join(ROOT, 'api', 'public-booking-meta.js'),
  secoursApi: path.join(ROOT, 'lib', 'secours-api.js'),
  feuilleSecours: path.join(ROOT, 'lib', 'feuille-secours.js'),
  montantsRole: path.join(ROOT, 'lib', 'montants-role.js'),
  marketingAsk: path.join(ROOT, 'lib', 'marketing-ask.js'),
};

let echecs = 0;
function ok(condition, message, detail) {
  if (condition) { console.log(`ok    ${message}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`}`);
  return false;
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`).digest('hex');
}

// Copie figee des 29 droits : un gate de securite teste toujours le meme univers.
const TOUS = [
  'dashboard.view', 'direction.view', 'centers.switch', 'reports.export',
  'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past',
  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'reservations.quick',
  'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download',
  'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
  'pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops',
];
const MARKETING = ['dashboard.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'reports.export'];
const MANAGER = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'reservations.quick', 'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'emails.view', 'reports.export', 'pricing.manage'];
const TECHNIQUE = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'settings.manage', 'ai.ops'];
const CHEF = ['dashboard.view', 'reservations.view', 'clients.view', 'users.manage', 'security.codes'];
const EXPORTEUR = ['dashboard.view', 'clients.view', 'exports.download'];
// Un role fait main : il corrige les dossiers sans voir les montants.
const EDITEUR = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.past', 'reservations.view', 'reservations.edit'];
// Deux roles faits main : chacun ne gere qu une ressource.
const BOWLING_SEUL = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.drag', 'planning.past', 'reservations.view'];
const LASER_SEUL = ['dashboard.view', 'planning.view', 'planning.laser', 'planning.drag', 'planning.past', 'reservations.view'];

// ---------------------------------------------------------------------------
// L UNIVERS : Fun Galaxy (Libramont, Gembloux) et un autre client, MI-12.
// ---------------------------------------------------------------------------
const CENTRES = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'fungalaxy', client_name: 'Fun Galaxy' },
  { id: 'mi-12', name: 'MI-12 Bowling', status: 'active', timezone: 'Europe/Brussels', settings: null, client_id: 'mi-12-client', client_name: 'MI-12 SARL' },
];
const MARQUEUR_MI12 = 'FUITE-MI12-PROSPECT-CONFIDENTIEL';
let demandes;
function viderDemandes() {
  demandes = [
    { id: 1, center_id: 'libramont', contact_name: 'Prospect Fun Galaxy', email: 'a@exemple.be', phone: '+32470000001', message: 'demande', status: 'new' },
    { id: 2, center_id: 'mi-12', contact_name: 'Prospect MI-12', email: 'b@exemple.be', phone: '+32470000002', message: MARQUEUR_MI12, status: 'new' },
  ];
}
viderDemandes();

// Des montants qu on ne peut pas confondre avec autre chose, sur un jour PASSE (les chiffres
// de l accueil ne comptent pas l avenir), calcule a chaque passage : le gate ne vieillit pas.
const jourBelge = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(instant));
const JOUR = jourBelge(Date.now() - 3 * 86400000);
const PLAGE = `startDate=${jourBelge(Date.now() - 6 * 86400000)}&endDate=${jourBelge(Date.now() - 86400000)}`;
const SENTINELLES = { prix: 4321.75, base: 4999.5, paye: 1234.25, ligne: 3333.5, programme: 6666.25, extra: 77.25, remise: 'remise-sentinelle-7777' };
function reservationSentinelle(id) {
  return {
    id, center_id: 'libramont', channel: 'staff', type: 'bowling', date: JOUR, start_time: '14:00', duration: 1, total_duration: 1,
    pax: 6, name: 'Client Sentinelle', phone: '+32470000009', email: 'sentinelle@exemple.be', status: 'paid', payment_status: 'paid',
    price: SENTINELLES.prix, base_price: SENTINELLES.base, amount_paid: SENTINELLES.paye, discount_reason: SENTINELLES.remise,
    payment_method: 'cash', paid_at: `${JOUR}T15:00:00.000Z`, lanes: [1], notes: '',
    extras: [{ name: 'Boisson sentinelle', price: SENTINELLES.extra }],
    program: { items: [{ activityId: 'bowling', price: SENTINELLES.ligne, priceType: 'grid_bowling', priceKnown: true }], price: SENTINELLES.programme, priceComplete: true },
    payload: {}, ops_plan: {}, created_at: `${JOUR}T09:00:00.000Z`, updated_at: `${JOUR}T09:00:00.000Z`,
  };
}

const ROLES = {
  direction: { center_id: 'libramont', id: 'direction', name: 'Direction', code: 'DI', permissions: TOUS, locked: true, summary: '', description: '', tone: 'direction', access_code_hash: hashSecret('DI-AAAA-BBBB-CCCC-DDDD'), access_code_hint: '', access_code_enc: null },
  'staff-bar': { center_id: 'libramont', id: 'staff-bar', name: 'Staff bar', code: 'ST', permissions: ['dashboard.view'], locked: false, summary: '', description: '', tone: 'staff', access_code_hash: hashSecret('ST-AAAA-BBBB-CCCC-DDDD'), access_code_hint: '', access_code_enc: null },
  comptable: { center_id: 'libramont', id: 'comptable', name: 'Comptable', code: 'CO', permissions: ['dashboard.view', 'payments.view'], locked: false, summary: '', description: '', tone: 'staff', access_code_hash: hashSecret('CO-AAAA-BBBB-CCCC-DDDD'), access_code_hint: '', access_code_enc: null },
  'chef-equipe': { center_id: 'libramont', id: 'chef-equipe', name: 'Chef d’équipe', code: 'CH', permissions: CHEF, locked: false, summary: '', description: '', tone: 'manager', access_code_hash: hashSecret('CH-AAAA-BBBB-CCCC-DDDD'), access_code_hint: '', access_code_enc: null },
};
const MEMBRES = {
  'libramont:direction-locale': { center_id: 'libramont', id: 'libramont:direction-locale', name: 'Directrice', role_id: 'direction', status: 'active', access_code_enc: null },
  'libramont:chef': { center_id: 'libramont', id: 'libramont:chef', name: 'Chef d’équipe', role_id: 'chef-equipe', status: 'active', access_code_enc: null },
};

// Les sessions forgees en base : le VRAI getStaffSessionFromToken les lit.
const SESSIONS = new Map();
function session(token, { memberId, memberName, roleId, roleName, permissions, locked = false, centre = 'libramont' }) {
  SESSIONS.set(hashSecret(token), {
    token_hash: hashSecret(token), center_id: centre, expires_at: new Date(Date.now() + 3600_000).toISOString(),
    member_id: memberId, member_name: memberName, contact: '', member_status: 'active',
    role_id: roleId, role_name: roleName, role_code: roleName.slice(0, 2).toUpperCase(), permissions, locked,
  });
  return token;
}
const T = {
  direction: session('fgs_gate_sec_direction', { memberId: 'libramont:direction-locale', memberName: 'Directrice', roleId: 'direction', roleName: 'Direction', permissions: TOUS, locked: true }),
  owner: session('fgs_gate_sec_owner', { memberId: 'libramont:platform-owner', memberName: 'Plateforme', roleId: 'platform-owner', roleName: 'Plateforme', permissions: [...TOUS, 'platform.admin'], locked: true }),
  marketing: session('fgs_gate_sec_marketing', { memberId: 'libramont:marketing', memberName: 'Marketing', roleId: 'marketing', roleName: 'Marketing', permissions: MARKETING }),
  manager: session('fgs_gate_sec_manager', { memberId: 'libramont:manager', memberName: 'Manager', roleId: 'manager', roleName: 'Manager', permissions: MANAGER }),
  technique: session('fgs_gate_sec_technique', { memberId: 'libramont:technique', memberName: 'Technique', roleId: 'technique', roleName: 'Technique', permissions: TECHNIQUE }),
  chef: session('fgs_gate_sec_chef', { memberId: 'libramont:chef', memberName: 'Chef d’équipe', roleId: 'chef-equipe', roleName: 'Chef d’équipe', permissions: CHEF }),
  exporteur: session('fgs_gate_sec_exporteur', { memberId: 'libramont:exporteur', memberName: 'Exporteur', roleId: 'exporteur', roleName: 'Exporteur', permissions: EXPORTEUR }),
  editeur: session('fgs_gate_sec_editeur', { memberId: 'libramont:editeur', memberName: 'Correcteur', roleId: 'correcteur', roleName: 'Correcteur', permissions: EDITEUR }),
  bowlingSeul: session('fgs_gate_sec_bowling', { memberId: 'libramont:bowling', memberName: 'Pistes', roleId: 'pistes', roleName: 'Pistes', permissions: BOWLING_SEUL }),
  laserSeul: session('fgs_gate_sec_laser', { memberId: 'libramont:laser', memberName: 'Arene', roleId: 'arene', roleName: 'Arene', permissions: LASER_SEUL }),
  analyste: session('fgs_gate_sec_analyste', { memberId: 'libramont:analyste', memberName: 'Analyste', roleId: 'analyste', roleName: 'Analyste', permissions: ['dashboard.view', 'direction.view'] }),
};

// ---------------------------------------------------------------------------
// LE FAUX MOTEUR SQL : il obeit au texte de la requete.
// ---------------------------------------------------------------------------
let sqlLog = [];
let audit = [];
let ecritures = [];
let panneBase = false;
class FakePool {
  async query(text, params = []) {
    if (panneBase) throw new Error('your project has exceeded the data transfer quota');
    const sql = String(text);
    sqlLog.push({ sql, params });
    const vide = { rows: [], rowCount: 0 };
    const lignes = (rows) => ({ rows, rowCount: rows.length });
    if (/select\s+id,\s*access_code_hash\s+from\s+staff_members\s+where\s+id\s*=\s*any/i.test(sql)) {
      const ids = Array.isArray(params[0]) ? params[0] : [];
      return lignes(ids.filter((id) => id.endsWith(':platform-owner')).map((id) => ({ id, access_code_hash: hashSecret(process.env.PLATFORM_OWNER_CODE) })));
    }
    if (/from\s+staff_sessions\s+s/i.test(sql) && /s\.token_hash\s*=\s*\$1/.test(sql)) {
      const row = SESSIONS.get(String(params[0] || ''));
      return row ? lignes([{ ...row }]) : vide;
    }
    if (/insert\s+into\s+audit_log/i.test(sql)) {
      let contexte = params[13];
      if (typeof contexte === 'string') { try { contexte = JSON.parse(contexte); } catch (e) { /* brut */ } }
      audit.push({ centerId: params[0], actorKind: params[1], actorLabel: params[3], surface: params[5], action: params[6], outcome: params[10], deniedReason: params[11], context: contexte });
      return lignes([{ id: audit.length, occurred_at: new Date().toISOString() }]);
    }
    if (/from\s+centers\b/i.test(sql) && /join\s+clients\b/i.test(sql)) return lignes(CENTRES.map((c) => ({ ...c })));
    if (/from\s+centers\b/i.test(sql)) {
      const voulus = params.map((v) => String(v || ''));
      const rows = /where/i.test(sql) && voulus.length ? CENTRES.filter((c) => voulus.includes(c.id)) : CENTRES;
      return lignes(rows.map((c) => ({ ...c })));
    }
    if (/^\s*select\s+\*\s+from\s+custom_requests/i.test(sql)) {
      const id = Number(params[0]);
      const portee = String(params[1] || '');
      return lignes(demandes.filter((d) => Number(d.id) === id && (portee === '' || d.center_id === portee)).map((d) => ({ ...d })));
    }
    if (/update\s+custom_requests/i.test(sql)) {
      const id = Number(params[0]);
      const portee = String(params[2] || '');
      const touchees = demandes.filter((d) => Number(d.id) === id && (portee === '' || d.center_id === portee));
      touchees.forEach((d) => { d.status = params[1]; });
      return lignes(touchees.map((d) => ({ ...d })));
    }
    if (/from\s+staff_roles\b/i.test(sql) && params.length >= 2) {
      const role = ROLES[String(params[1] || '')];
      return role && role.center_id === String(params[0] || '') ? lignes([{ ...role }]) : vide;
    }
    if (/update\s+staff_roles\b/i.test(sql)) {
      const role = ROLES[String(params[1] || '')];
      return role ? lignes([{ ...role }]) : vide;
    }
    if (/from\s+staff_members\b/i.test(sql) && params.length >= 2 && typeof params[1] === 'string' && MEMBRES[params[1]]) {
      return lignes([{ ...MEMBRES[params[1]] }]);
    }
    if (/^\s*update\s+reservations\s+set\s+center_id/i.test(sql)) {
      ecritures.push(params);
      return lignes([reservationSentinelle(Number(params[0]))]);
    }
    if (/from\s+reservations\b/i.test(sql) && /^\s*select/i.test(sql)) return lignes([reservationSentinelle(9101), reservationSentinelle(9102)]);
    return vide;
  }
  async connect() { const self = this; return { query: (t, p) => self.query(t, p), release() {} }; }
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool, Client: FakePool } };

// ---------------------------------------------------------------------------
// LE CHARGEUR : un graphe de modules neuf, avec ou sans mutation (en memoire).
// ---------------------------------------------------------------------------
const lf = (t) => String(t).split('\r\n').join('\n');
function viderLeCache() {
  for (const cle of Object.keys(require.cache)) if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[cle];
  delete globalThis.__pinlaneStaffLoginAttempts;
  delete globalThis.__pinlaneLecturesSansSession;
  delete globalThis.__pinlaneRateBuckets;
}
// Toutes les mutations d un meme fichier s appliquent a UNE source : compilees une a une,
// la seconde relirait le disque et effacerait la premiere. Les fichiers se compilent dans
// l ordre donne : celui dont les autres dependent d abord (lib avant api).
function poserMutations(fichier, paires) {
  let source = lf(fs.readFileSync(fichier, 'utf8'));
  for (const [avant, apres] of paires) {
    if (!source.includes(avant)) throw new Error(`contre-preuve sans ancre dans ${path.relative(ROOT, fichier)} : ${avant.slice(0, 90)}`);
    source = source.replace(avant, () => apres);
  }
  const m = new Module(fichier, module);
  m.filename = fichier;
  m.paths = Module._nodeModulePaths(path.dirname(fichier));
  require.cache[fichier] = m;
  m._compile(source, fichier);
  m.loaded = true;
}
function charger(mutations = []) {
  viderLeCache();
  const parFichier = new Map();
  for (const [fichier, avant, apres] of mutations) {
    if (!parFichier.has(fichier)) parFichier.set(fichier, []);
    parFichier.get(fichier).push([avant, apres]);
  }
  for (const [fichier, paires] of parFichier) poserMutations(fichier, paires);
  sqlLog = [];
  audit = [];
  ecritures = [];
  viderDemandes();
}

function requete({ method = 'GET', url, token = '', body = null, ip = '203.0.113.7', headers = {} }) {
  const charge = body === null ? null : JSON.stringify(body);
  const req = { method, url, headers: { host: 'app.pinlane.be', 'content-type': 'application/json', 'x-real-ip': ip, ...(token ? { 'x-staff-session': token } : {}), ...headers }, socket: { remoteAddress: ip } };
  if (charge !== null) req[Symbol.asyncIterator] = async function* lire() { yield Buffer.from(charge); };
  return req;
}
function reponse() {
  return {
    statusCode: 0, body: '', headers: {}, ended: false,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    getHeader(n) { return this.headers[String(n).toLowerCase()]; },
    writeHead(s) { this.statusCode = s; },
    end(c) { this.brut = Buffer.isBuffer(c) ? c : null; this.body = c === undefined ? '' : (Buffer.isBuffer(c) ? `[binaire ${c.length} octets]` : String(c)); this.ended = true; },
  };
}
async function appeler(fichier, options) {
  const handler = require(fichier);
  const req = requete(options);
  const res = reponse();
  res.req = req;
  try { await handler(req, res); } catch (error) { res.body = `exception:${error && error.message}`; }
  return res;
}
const contientUnMontant = (texte) => [SENTINELLES.prix, SENTINELLES.base, SENTINELLES.paye, SENTINELLES.ligne, SENTINELLES.programme, SENTINELLES.extra].some((v) => String(texte).includes(String(v))) || String(texte).includes(SENTINELLES.remise);

// Les ancres des contre-preuves : les lignes du correctif, telles qu ecrites.
const ANCRE = {
  gardeAll: "  if (requestedCenterId === 'all' && !sessionHasPermission(session, 'platform.admin') && options.porteeAllVoulue !== true) {",
  opsPorteeRetenue: '      if (refuserPorteePlateforme(res, session, effectiveCenterId)) return;',
  marque: "  if (res && typeof res === 'object' && res.__montantsDuCatalogue !== true) res.__sansMontants = !sessionHasPermission(effective, 'payments.view');",
  export: "    if (action === 'exportComplet') return 'exports.download';",
  exportMontants: "    if (!sessionHasPermission(options.session, 'payments.view')) throw createHttpError('Le fichier complet contient les montants : votre rôle ne les voit pas.', 403, true);",
  prix: "    if (touchePrix && !sessionHasPermission(options.session, 'pricing.manage')) throw createHttpError('Changer un prix demande le droit « Tarifs ».', 403, true);",
  sonRole: "    if (!estDirection && ['updateRolePermissions', 'setRolePreset'].includes(action) && targetRoleId && targetRoleId === String((session.role && session.role.id) || '')) {",
  cleAppareil: '  const source = `appareil:${normalizeText(fingerprint, \'unknown\')}`;',
  sansSession: "    if (noterLectureSansSession(req)) await logAccessDenied(req, null, permission, '401_no_session', getRequestedCenterId(req, options));",
  llm: '  if (!sansDonneeClient) return null;',
  balisage: "    .replace(/\\b(?:https?:\\/\\/|www\\.)\\S+/gi, '(lien retiré)')",
  sessionsRole: "    await getPool().query('delete from staff_sessions where member_id = $1;', [porteurDuCode]);",
  plafondAdresse: 'const LOGIN_MAX_FAILURES_ADRESSE = 40;',
  comptePoste: "    { cle: `${adresse}|${normalizeText(appareil, '')}`, max: LOGIN_MAX_FAILURES },",
  droitsAjoutes: "    const manquants = droitsQueLaSessionNaPas(session, droitsDemandes.filter((droit) => !droitsDejaLa.has(String(droit))));",
  identiteParNom: "  if (ligne.name) return `nom:${nomSansQuantite(ligne.name)}|${ligne.parPersonne === true ? 1 : 0}|${ligne.offert === true ? 1 : 0}`;",
  ipDeConfiance: "  const brut = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for']",
  empreinteDeConfiance: "    req.headers['x-vercel-forwarded-for']\n    || req.headers['x-real-ip']\n    || req.headers['x-forwarded-for']",
  blocIPv6: 'function cleDeLAdresse(ip) {',
  codeDemo: '  DEFAULT_PLATFORM_OWNER_CODE,\n',
  lignePlateforme: "  if (String(memberId || '').endsWith(':platform-owner')) throw createHttpError('Cette ligne appartient à la plateforme.', 403);",
  retourMontants: "      if (res.__sansMontants) require('../lib/montants-role').retirerLesMontantsDuCorps(body, current);",
  limiteSecours: '  if (pleinSecours) throw createLoginRateLimitError(pleinSecours);',
  alerteSecours: "        await require('../lib/garde-securite').signalerSessionDeSecours().catch(() => null);",
  etatHorsLigne: "    storageMessage: 'Données temps réel temporairement indisponibles. Mode secours actif.',",
  autreSite: "  return site === 'same-site' || site === 'cross-site';",
  droitRessource: "        if (droitDeLaRessource && !sessionHasPermission(session, droitDeLaRessource)) throw createHttpError('Ce planning ne fait pas partie de votre rôle.', 403);",
  planAnonyme: '  res.__visiteurAnonyme = !(await sessionDuPersonnel(req));',
  corpsPublic: '      body = await readJson(req, { maxBytes: 64 * 1024 });',
  documentTransmis: '      sansMontants: Boolean(res.__sansMontants),',
  classeurRefuse: "  if (kind === 'excel' && sansMontants) throw Object.assign(new Error('Le classeur du jour contient les montants : votre rôle ne les voit pas.'), { statusCode: 403, expose: true });",
  prixImprime: "  const prix = [{ texte: ctx.sansMontants ? '···' : prixTexte(resa) }];",
  excelDonnees: "    if (action === 'exportDonnees' && res.__sansMontants) throw createHttpError('Le fichier contient les montants : votre rôle ne les voit pas.', 403, true);",
  siNombre: "  || (CLES_ARGENT_SI_NOMBRE.has(cle) && Boolean(objet) && typeof objet[cle] === 'number')\n",
  questionTransmise: "    const result = await answerMarketingQuestion(concreteCenterId, { question: String(body.question || ''), sansMontants: Boolean(res.__sansMontants) });",
  montantsRetenus: '  const montantsReserves = sansMontants ? montantsHorsCatalogue(texteVu, dossier) : [];',
};

(async () => {
  // =========================================================================
  console.log('[A] la portee « all » n est qu a la plateforme, sur toutes les routes');
  // =========================================================================
  charger();
  {
    const res = await appeler(F.ops, { method: 'POST', url: '/api/ops?centerId=all', token: T.direction, body: { action: 'customRequestStatus', id: 2, status: 'in_progress' } });
    ok(res.statusCode === 403, '[A] POST /api/ops?centerId=all sans centre dans le corps, par une Direction de client : 403', res.statusCode);
    ok(demandes.find((d) => d.id === 2).status === 'new', '[A] la demande de groupe de MI-12 n a pas change');
    ok(!res.body.includes(MARQUEUR_MI12), '[A] la reponse ne contient rien de MI-12');
    ok(audit.some((l) => l.outcome === 'denied' && l.deniedReason === '403_cross_client'), '[A] la tentative se trace comme une tentative vers un autre client', audit.map((l) => l.deniedReason));
    const etat = await appeler(F.staffState, { url: `/api/staff-state?centerId=all&date=${JOUR}`, token: T.direction });
    ok(etat.statusCode === 403, '[A] GET /api/staff-state?centerId=all par une Direction : 403 aussi (la garde est commune)', etat.statusCode);
  }
  charger();
  {
    const res = await appeler(F.ops, { method: 'POST', url: '/api/ops?centerId=all', token: T.owner, body: { action: 'customRequestStatus', id: 2, status: 'in_progress' } });
    ok(res.statusCode !== 403, '[A] contraste : le proprietaire de la plateforme passe', res.statusCode);
  }
  // Chaque couche mord seule : sans la garde commune, api/ops.js refuse encore ;
  // sans les deux, le trou d avant revient.
  charger([[F.staffAuth, ANCRE.gardeAll, "  if (false) {"]]);
  {
    const res = await appeler(F.ops, { method: 'POST', url: '/api/ops?centerId=all', token: T.direction, body: { action: 'customRequestStatus', id: 2, status: 'in_progress' } });
    ok(res.statusCode === 403 && demandes.find((d) => d.id === 2).status === 'new', '[A] contre-preuve : sans la garde commune, api/ops.js refuse encore la portee retenue', res.statusCode);
  }
  charger([[F.staffAuth, ANCRE.gardeAll, "  if (false) {"], [F.ops, ANCRE.opsPorteeRetenue, '']]);
  {
    const res = await appeler(F.ops, { method: 'POST', url: '/api/ops?centerId=all', token: T.direction, body: { action: 'customRequestStatus', id: 2, status: 'in_progress' } });
    ok(res.statusCode !== 403 || demandes.find((d) => d.id === 2).status !== 'new', '[A] contre-preuve : sans les deux gardes, le trou du 08/11 revient (ce gate le verrait)', { statut: res.statusCode, demande: demandes.find((d) => d.id === 2).status });
  }

  // =========================================================================
  console.log('\n[B] « Voir les montants » vaut au serveur');
  // =========================================================================
  charger();
  {
    const mk = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: T.marketing });
    const mg = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: T.manager });
    ok(mk.statusCode === 200 && /Client Sentinelle/.test(mk.body), '[B] Marketing lit bien le planning du jour (il en a le droit)', mk.statusCode);
    ok(!contientUnMontant(mk.body), '[B] planning du jour, role Marketing : aucun prix, aucun encaisse, aucune remise');
    ok(mg.statusCode === 200 && contientUnMontant(mg.body), '[B] contraste : le Manager recoit les montants', mg.statusCode);
    ok(String(mk.headers.etag || '').endsWith(':sans-montants') && !String(mg.headers.etag || '').endsWith(':sans-montants'), '[B] la revision sans montants n est pas celle avec montants (un poste ne garde pas l une pour l autre)', [mk.headers.etag, mg.headers.etag]);
    const plage = await appeler(F.adminRange, { url: `/api/admin-range?centerId=libramont&${PLAGE}`, token: T.marketing });
    ok(plage.statusCode === 200 && /Client Sentinelle/.test(plage.body) && !contientUnMontant(plage.body), '[B] plage de dates, role Marketing : les dossiers sans leurs montants', plage.statusCode);
    const chiffres = await appeler(F.ops, { url: `/api/ops?action=dashboardAnalytics&centerId=libramont&${PLAGE}`, token: T.marketing });
    const total = String(SENTINELLES.prix * 2);
    ok(chiffres.statusCode === 200 && !chiffres.body.includes(total) && !contientUnMontant(chiffres.body), '[B] chiffres de l accueil, role Marketing : ni chiffre d affaires ni encaisse', chiffres.statusCode);
    const chiffresMg = await appeler(F.ops, { url: `/api/ops?action=dashboardAnalytics&centerId=libramont&${PLAGE}`, token: T.manager });
    ok(chiffresMg.statusCode === 200 && chiffresMg.body.includes(total), '[B] contraste : le Manager lit le chiffre d affaires', chiffresMg.statusCode);
  }
  charger([[F.staffAuth, ANCRE.marque, '']]);
  {
    const mk = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: T.marketing });
    ok(contientUnMontant(mk.body), '[B] contre-preuve : sans la marque posee par la garde, les montants repartent (ce gate le verrait)');
  }

  // =========================================================================
  console.log('\n[C] l export complet : « Exporter » et « Voir les montants »');
  // =========================================================================
  charger();
  {
    const tech = await appeler(F.ops, { url: '/api/ops?action=exportComplet&centerId=libramont', token: T.technique });
    ok(tech.statusCode === 403, '[C] role Technique (Réglages, sans « Exporter ») : 403', tech.statusCode);
    const exp = await appeler(F.ops, { url: '/api/ops?action=exportComplet&centerId=libramont', token: T.exporteur });
    ok(exp.statusCode === 403 && /montants/.test(exp.body), '[C] « Exporter » sans « Voir les montants » : 403, avec la raison', [exp.statusCode, exp.body.slice(0, 120)]);
    audit = [];
    const dir = await appeler(F.ops, { url: '/api/ops?action=exportComplet&centerId=libramont', token: T.direction });
    ok(dir.statusCode === 200, '[C] contraste : la Direction prend le fichier', [dir.statusCode, dir.body.slice(0, 120)]);
    ok(audit.some((l) => l.action === 'exportComplet' && l.outcome === 'success'), '[C] le fichier pris se trace au journal (donc dans Modifications sur Telegram)', audit.map((l) => `${l.action}:${l.outcome}`));
    const { classer } = require(path.join(ROOT, 'lib', 'garde-journal.js'));
    const ligne = classer({ action: 'exportComplet', champs: {}, cles: [], entity_id: 'exportComplet', actor_label: 'Directrice' });
    ok(ligne && /export complet du centre/.test(String(ligne.ligne || '')), '[C] Modifications dit « export complet du centre téléchargé »', ligne);
  }
  charger([[F.ops, ANCRE.export, "    if (action === 'exportComplet') return ['exports.download', 'settings.manage', 'direction.view'];"], [F.ops, ANCRE.exportMontants, '']]);
  {
    const tech = await appeler(F.ops, { url: '/api/ops?action=exportComplet&centerId=libramont', token: T.technique });
    ok(tech.statusCode === 200, '[C] contre-preuve : avec la regle d avant, le role Technique emporte tout le centre (ce gate le verrait)', tech.statusCode);
  }

  // =========================================================================
  console.log('\n[D] un prix du catalogue ne change qu avec « Tarifs »');
  // =========================================================================
  charger();
  {
    const prix = await appeler(F.ops, { method: 'POST', url: '/api/ops', token: T.technique, body: { action: 'updateFormula', centerId: 'libramont', id: 'formule-test', patch: { priceValue: 1 } } });
    ok(prix.statusCode === 403 && /Tarifs/.test(prix.body), '[D] role Technique : changer le prix d une formule, 403', [prix.statusCode, prix.body.slice(0, 120)]);
    const act = await appeler(F.ops, { method: 'POST', url: '/api/ops', token: T.technique, body: { action: 'updateActivity', centerId: 'libramont', id: 'bowling', patch: { priceValue: 2 } } });
    ok(act.statusCode === 403 && /Tarifs/.test(act.body), '[D] role Technique : changer le prix d une activite, 403', act.statusCode);
    const nom = await appeler(F.ops, { method: 'POST', url: '/api/ops', token: T.technique, body: { action: 'updateFormula', centerId: 'libramont', id: 'formule-test', patch: { name: 'Nouveau nom' } } });
    ok(!/Tarifs/.test(nom.body), '[D] contraste : le nom d une formule suit toujours « Réglages »', nom.body.slice(0, 120));
  }
  charger([[F.ops, ANCRE.prix, '']]);
  {
    const prix = await appeler(F.ops, { method: 'POST', url: '/api/ops', token: T.technique, body: { action: 'updateFormula', centerId: 'libramont', id: 'formule-test', patch: { priceValue: 1 } } });
    ok(!/Tarifs/.test(prix.body), '[D] contre-preuve : sans la garde, le prix passe la barriere (ce gate le verrait)', prix.body.slice(0, 120));
  }

  // =========================================================================
  console.log('\n[E] un role qui gere l equipe sans etre la Direction');
  // =========================================================================
  charger();
  {
    const post = (token, body) => appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth?centerId=libramont', token, body: { centerId: 'libramont', ...body } });
    const soi = await post(T.chef, { action: 'updateRolePermissions', roleId: 'chef-equipe', permissions: [...CHEF, 'centers.switch'] });
    ok(soi.statusCode === 403, '[E] il ne change pas les droits de son propre role', [soi.statusCode, soi.body.slice(0, 120)]);
    const retire = await post(T.chef, { action: 'updateRolePermissions', roleId: 'comptable', permissions: ['payments.view'] });
    ok(retire.statusCode === 200, '[E] il decoche une case sur un role qui porte un droit qu il n a pas : ca passe', [retire.statusCode, retire.body.slice(0, 160)]);
    const ajoute = await post(T.chef, { action: 'updateRolePermissions', roleId: 'comptable', permissions: ['dashboard.view', 'payments.view', 'exports.download'] });
    ok(ajoute.statusCode === 403 && /un droit que/.test(ajoute.body), '[E] mais il n y ajoute pas un droit qu il n a pas', [ajoute.statusCode, ajoute.body.slice(0, 160)]);
    const cree = await post(T.chef, { action: 'createRole', name: 'Caisse', permissions: ['payments.view'] });
    ok(cree.statusCode === 403 && /un droit que/.test(cree.body), '[E] et il ne cree pas un role avec un droit qu il n a pas', [cree.statusCode, cree.body.slice(0, 160)]);
    const donne = await post(T.chef, { action: 'updateRolePermissions', roleId: 'staff-bar', permissions: ['dashboard.view', 'payments.view'] });
    ok(donne.statusCode === 403 && /un droit que/.test(donne.body), '[E] il ne donne pas un droit qu il n a pas (« Voir les montants »)', [donne.statusCode, donne.body.slice(0, 120)]);
    const modele = await post(T.chef, { action: 'setRolePreset', roleId: 'staff-bar', presetId: 'direction' });
    ok(modele.statusCode === 403, '[E] il ne fait pas une Direction par modele', modele.statusCode);
    const code = await post(T.chef, { action: 'revealMemberCode', memberId: 'libramont:direction-locale' });
    ok(code.statusCode === 403 && !/revealedCode/.test(code.body), '[E] il ne lit pas le code de la Directrice', [code.statusCode, code.body.slice(0, 120)]);
    const regen = await post(T.chef, { action: 'regenerateRoleCode', roleId: 'direction' });
    ok(regen.statusCode === 403, '[E] il ne change pas le code du role Direction', regen.statusCode);
    const dir = await post(T.direction, { action: 'updateRolePermissions', roleId: 'staff-bar', permissions: ['dashboard.view', 'payments.view'] });
    ok(!(dir.statusCode === 403 && /droit|direction/i.test(dir.body)), '[E] contraste : la Direction donne ce droit', [dir.statusCode, dir.body.slice(0, 120)]);
  }
  charger([[F.apiStaffAuth, ANCRE.droitsAjoutes, '    const manquants = droitsQueLaSessionNaPas(session, droitsDemandes);']]);
  {
    const retire = await appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth?centerId=libramont', token: T.chef, body: { centerId: 'libramont', action: 'updateRolePermissions', roleId: 'comptable', permissions: ['payments.view'] } });
    ok(retire.statusCode === 403, '[E] contre-preuve : a juger la liste entiere, decocher une case est refuse (ce gate le verrait)', [retire.statusCode, retire.body.slice(0, 120)]);
  }
  charger([[F.apiStaffAuth, ANCRE.sonRole, '    if (false) {']]);
  {
    const soi = await appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth?centerId=libramont', token: T.chef, body: { centerId: 'libramont', action: 'updateRolePermissions', roleId: 'chef-equipe', permissions: [...CHEF] } });
    ok(soi.statusCode !== 403, '[E] contre-preuve : sans la garde, son propre role se change (ce gate le verrait)', [soi.statusCode, soi.body.slice(0, 120)]);
  }

  // =========================================================================
  console.log('\n[F] un appareil bloque n essaie plus rien');
  // =========================================================================
  charger();
  {
    const { loginStaffByCode } = require(F.staffAuth);
    const statuts = [];
    for (let i = 0; i < 9; i += 1) {
      try { await loginStaffByCode({ centerId: `centre-invente-${i}`, code: 'FG-0000-0000-0000-0000', fingerprint: '198.51.100.20' }); statuts.push(200); } catch (error) { statuts.push(error.statusCode || 400); }
    }
    ok(statuts.slice(0, 8).every((s) => s !== 429) && statuts[8] === 429, '[F] 8 codes faux puis le 9e refuse en 429, meme en inventant un centre a chaque essai', statuts);
    sqlLog = [];
    let statut = 200;
    try { await loginStaffByCode({ centerId: 'libramont', code: process.env.PLATFORM_OWNER_CODE, fingerprint: '198.51.100.20' }); } catch (error) { statut = error.statusCode || 400; }
    ok(statut === 429, '[F] bloque, meme le bon code est refuse', statut);
    ok(!sqlLog.some((q) => /access_code_hash/i.test(q.sql)), '[F] et il n est meme pas cherche en base (aucun code n est verifie)', sqlLog.map((q) => q.sql.replace(/\s+/g, ' ').slice(0, 60)));
    let autre = 400;
    try { await loginStaffByCode({ centerId: 'libramont', code: 'FG-1111-1111-1111-1111', fingerprint: '198.51.100.99' }); } catch (error) { autre = error.statusCode || 400; }
    ok(autre !== 429, '[F] contraste : un autre appareil n est pas bloque', autre);
    const essai = async (appareil, ip = '198.51.100.70') => { try { await loginStaffByCode({ centerId: 'libramont', code: 'FG-2222-2222-2222-2222', fingerprint: ip, appareil }); return 200; } catch (error) { return error.statusCode || 400; } };
    for (let i = 0; i < 8; i += 1) await essai('tablette-accueil');
    ok(await essai('tablette-accueil') === 429, '[F] 8 fautes d une tablette la bloquent', 'tablette');
    ok(await essai('poste-bar') !== 429, '[F] mais les autres postes du meme wifi ne le sont pas', 'poste');
    const rafale = [];
    for (let i = 0; i < 45; i += 1) rafale.push(await essai(`navigateur-invente-${i}`, '198.51.100.71'));
    ok(rafale.slice(0, 40).every((s) => s !== 429) && rafale.slice(40).every((s) => s === 429), '[F] changer de navigateur a chaque essai ne contourne pas le plafond de l adresse (40)', rafale.join(','));
  }
  charger([[F.staffAuth, ANCRE.plafondAdresse, 'const LOGIN_MAX_FAILURES_ADRESSE = 100000;']]);
  {
    const { loginStaffByCode } = require(F.staffAuth);
    const rafale = [];
    for (let i = 0; i < 45; i += 1) { try { await loginStaffByCode({ centerId: 'libramont', code: 'FG-2222-2222-2222-2222', fingerprint: '198.51.100.72', appareil: `n-${i}` }); rafale.push(200); } catch (error) { rafale.push(error.statusCode || 400); } }
    ok(rafale.every((s) => s !== 429), '[F] contre-preuve : sans plafond d adresse, 45 essais passent (ce gate le verrait)', rafale.slice(-3).join(','));
  }
  charger([[F.staffAuth, ANCRE.comptePoste, "    { cle: `${adresse}`, max: LOGIN_MAX_FAILURES },"]]);
  {
    const { loginStaffByCode } = require(F.staffAuth);
    const essai = async (appareil) => { try { await loginStaffByCode({ centerId: 'libramont', code: 'FG-2222-2222-2222-2222', fingerprint: '198.51.100.73', appareil }); return 200; } catch (error) { return error.statusCode || 400; } };
    for (let i = 0; i < 8; i += 1) await essai('tablette-accueil');
    ok(await essai('poste-bar') === 429, '[F] contre-preuve : compte par adresse seule, tout le wifi est bloque (ce gate le verrait)', 'poste');
  }
  charger([[F.staffAuth, ANCRE.cleAppareil, "  const source = `${normalizeText(centerId, 'libramont')}:${normalizeText(fingerprint, 'unknown')}`;"]]);
  {
    const { loginStaffByCode } = require(F.staffAuth);
    const statuts = [];
    for (let i = 0; i < 9; i += 1) {
      try { await loginStaffByCode({ centerId: `centre-invente-${i}`, code: 'FG-0000-0000-0000-0000', fingerprint: '198.51.100.21' }); statuts.push(200); } catch (error) { statuts.push(error.statusCode || 400); }
    }
    ok(statuts[8] !== 429, '[F] contre-preuve : compte par centre demande, le 9e essai passe encore (ce gate le verrait)', statuts);
  }

  // =========================================================================
  console.log('\n[G] les lectures sans session ne remplissent plus le journal');
  // =========================================================================
  charger();
  {
    for (let i = 0; i < 50; i += 1) await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, ip: '192.0.2.50' });
    const n1 = audit.filter((l) => l.deniedReason === '401_no_session').length;
    ok(n1 === 1, '[G] 50 lectures sans session du meme appareil : 1 ligne au journal', n1);
    const r = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, ip: '192.0.2.50' });
    ok(r.statusCode === 401, '[G] et chaque lecture est toujours refusee (401)', r.statusCode);
    await appeler(F.adminRange, { url: '/api/admin-range?centerId=libramont&startDate=2026-11-01&endDate=2026-11-02', ip: '192.0.2.50' });
    await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, ip: '192.0.2.51' });
    const n2 = audit.filter((l) => l.deniedReason === '401_no_session').length;
    ok(n2 === 3, '[G] une autre route, un autre appareil : une ligne chacun', n2);
  }
  charger([[F.staffAuth, ANCRE.sansSession, "    await logAccessDenied(req, null, permission, '401_no_session', getRequestedCenterId(req, options));"]]);
  {
    for (let i = 0; i < 50; i += 1) await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, ip: '192.0.2.52' });
    const n = audit.filter((l) => l.deniedReason === '401_no_session').length;
    ok(n === 50, '[G] contre-preuve : sans la borne, 50 lectures font 50 lignes (ce gate le verrait)', n);
  }

  // =========================================================================
  console.log('\n[H] une donnee de client ne part que chez Anthropic');
  // =========================================================================
  charger();
  {
    const { llmProvider } = require(F.llm);
    process.env.OPENAI_API_KEY = 'gate-openai';
    ok(llmProvider('sensitive') === null, '[H] sans Anthropic, un usage sensible n a aucun modele (pas OpenAI)', llmProvider('sensitive'));
    ok(llmProvider('garde') === null, '[H] sans Anthropic, le bilan de la garde n a aucun modele', llmProvider('garde'));
    ok(llmProvider('mails') === null, '[H] sans Anthropic, les mails n ont aucun modele', llmProvider('mails'));
    ok(llmProvider('marketing') === 'openai', '[H] contraste : le marketing (sans donnee de client) garde OpenAI', llmProvider('marketing'));
    process.env.KIMI_API_KEY = 'gate-kimi';
    ok(llmProvider('sensitive') === null && llmProvider('marketing') === 'kimi', '[H] Kimi ne voit que le marketing');
    process.env.ANTHROPIC_API_KEY = 'gate-anthropic';
    ok(llmProvider('sensitive') === 'anthropic' && llmProvider('mails') === 'anthropic', '[H] avec sa cle, Anthropic recoit les usages sensibles et les mails');
    delete process.env.OPENAI_API_KEY; delete process.env.KIMI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  }
  charger([[F.llm, ANCRE.llm, '']]);
  {
    const { llmProvider } = require(F.llm);
    process.env.OPENAI_API_KEY = 'gate-openai';
    ok(llmProvider('sensitive') === 'openai', '[H] contre-preuve : sans la garde, un usage sensible partirait chez OpenAI (ce gate le verrait)', llmProvider('sensitive'));
    delete process.env.OPENAI_API_KEY;
  }

  // =========================================================================
  console.log('\n[J] ce qu un client ecrit ne devient jamais un lien');
  // =========================================================================
  charger();
  const piege = 'Acompte : [payer ici](https://phish.example/payer)\n[[bouton : Payer | https://phish.example/b]]\nwww.phish.example';
  const verifierMail = (html) => !/phish\.example/i.test(html) && !/href="https?:\/\/phish/i.test(html);
  {
    const oc = require(F.comms);
    const ack = oc.buildCustomRequestAck({ contactName: '[Paul](https://phish.example/nom)', message: piege, centerId: 'libramont' });
    const html = oc.emailShell({ title: ack.title, body: ack.body, details: ack.details, note: ack.note });
    ok(verifierMail(html), '[J] accuse d une demande de groupe : aucun lien du client dans le mail du centre');
    const conf = oc.buildMessage({ reservation: { id: 77, centerId: 'libramont', name: '[Clique ici](https://phish.example/x)', date: JOUR, startTime: '14:00', pax: 4, type: 'bowling', status: 'confirmed', program: { items: [] } }, templateId: 'confirmation', channel: 'email' });
    const htmlConf = oc.emailShell({ title: conf.title || conf.subject, body: conf.body, details: conf.details });
    ok(verifierMail(htmlConf), '[J] confirmation de reservation : le nom piege ne fait pas de lien');
    const legit = oc.emailShell({ title: 'Test', body: 'Voir [le site](https://fungalaxy.be) maintenant' });
    ok(/href="https:\/\/fungalaxy\.be"/.test(legit), '[J] contraste : un lien ecrit par l equipe reste un lien');
  }
  charger([[F.comms, ANCRE.balisage, '']]);
  {
    const oc = require(F.comms);
    const ack = oc.buildCustomRequestAck({ contactName: 'Paul', message: piege, centerId: 'libramont' });
    const html = oc.emailShell({ title: ack.title, body: ack.body });
    ok(!verifierMail(html), '[J] contre-preuve : sans le filtre, le lien du client part dans le mail (ce gate le verrait)');
  }

  // =========================================================================
  console.log('\n[O] un code de role change ferme les sessions de l ancien code');
  // =========================================================================
  charger();
  {
    const { regenerateRoleCode } = require(F.staffAuth);
    await regenerateRoleCode({ centerId: 'libramont', roleId: 'staff-bar' });
    ok(sqlLog.some((q) => /delete\s+from\s+staff_sessions\s+where\s+member_id\s*=\s*\$1/i.test(q.sql) && q.params[0] === 'libramont:role:staff-bar'), '[O] les sessions du porte-code « libramont:role:staff-bar » sont fermees');
    sqlLog = [];
    await regenerateRoleCode({ centerId: 'libramont', actorMemberId: 'libramont:role:staff-bar', sessionMemberId: 'libramont:role:staff-bar', sessionToken: 'fgs_session_du_geste', roleId: 'staff-bar' });
    const fermeture = sqlLog.find((q) => /delete\s+from\s+staff_sessions/i.test(q.sql));
    ok(fermeture && /token_hash\s*<>\s*\$2/.test(fermeture.sql) && fermeture.params[1] === hashSecret('fgs_session_du_geste'), '[O] la personne qui change le code avec ce code reste connectee, les autres sont fermees', fermeture && fermeture.sql);
  }
  charger([[F.staffAuth, ANCRE.sessionsRole, '']]);
  {
    const { regenerateRoleCode } = require(F.staffAuth);
    await regenerateRoleCode({ centerId: 'libramont', roleId: 'staff-bar' });
    ok(!sqlLog.some((q) => /delete\s+from\s+staff_sessions/i.test(q.sql)), '[O] contre-preuve : sans la ligne, les anciennes sessions restent (ce gate le verrait)');
  }

  // =========================================================================
  console.log('\n[P] les petites portes');
  // =========================================================================
  // Une requete de connexion dont le client ecrit lui-meme un X-Forwarded-For different a
  // chaque essai ; Vercel, lui, donne toujours la vraie adresse.
  const connexionForgee = (i, ip) => {
    const charge = JSON.stringify({ code: 'FG-0000-0000-0000-0000', centerId: `centre-invente-${i}` });
    const req = { method: 'POST', url: '/api/staff-auth', headers: { host: 'app.pinlane.be', 'content-type': 'application/json', 'x-forwarded-for': `6.6.6.${i}`, 'x-vercel-forwarded-for': ip, 'x-real-ip': ip }, socket: { remoteAddress: '10.0.0.1' } };
    req[Symbol.asyncIterator] = async function* lire() { yield Buffer.from(charge); };
    return req;
  };
  const neufConnexionsForgees = async (ip) => {
    const handler = require(F.apiStaffAuth);
    const statuts = [];
    for (let i = 0; i < 9; i += 1) {
      const res = reponse();
      try { await handler(connexionForgee(i, ip), res); } catch (error) { res.statusCode = 599; }
      statuts.push(res.statusCode);
    }
    return statuts;
  };
  const appelerLaPlateforme = async () => {
    const { updateMemberRole } = require(F.staffAuth);
    try { await updateMemberRole({ centerId: 'libramont', memberId: 'libramont:platform-owner', roleId: 'manager' }); return { statut: 200, message: '' }; } catch (error) { return { statut: error.statusCode || 0, message: String(error.message || '') }; }
  };
  // Le code de demonstration tel qu il est ecrit dans lib/staff-auth.js.
  const CODE_DEMO = /const DEFAULT_PLATFORM_OWNER_CODE = '([^']+)';/.exec(fs.readFileSync(F.staffAuth, 'utf8'))[1];
  const codeDeDemoEnProd = () => {
    const avant = { env: process.env.NODE_ENV, code: process.env.PLATFORM_OWNER_CODE };
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_OWNER_CODE = CODE_DEMO;
    try { return { statut: 200, message: '', valeur: require(F.staffAuth).__test.getPlatformOwnerCode() }; } catch (error) { return { statut: error.statusCode || 0, message: String(error.message || '') }; } finally {
      process.env.NODE_ENV = avant.env;
      process.env.PLATFORM_OWNER_CODE = avant.code;
    }
  };
  charger();
  {
    const { getClientIp, cleDeLAdresse } = require(F.rateLimit);
    const forge = { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } };
    ok(getClientIp(forge) === '203.0.113.9', '[P] limiteur des pages publiques : l adresse vient de Vercel, pas du X-Forwarded-For ecrit par le client', getClientIp(forge));
    const a = cleDeLAdresse('2001:db8:aa:bb:1:2:3:4');
    const b = cleDeLAdresse('2001:db8:aa:bb:ffff::9');
    ok(a === b && a !== cleDeLAdresse('2001:db8:aa:cc::1'), '[P] une adresse IPv6 compte par son bloc /64 : en changer dans le bloc ne remet pas le compteur a zero', [a, b]);
    ok(cleDeLAdresse('::ffff:203.0.113.9') === '203.0.113.9' && cleDeLAdresse('203.0.113.9') === '203.0.113.9', '[P] une adresse IPv4 reste elle-meme, meme ecrite en IPv6', cleDeLAdresse('::ffff:203.0.113.9'));
    const statuts = await neufConnexionsForgees('198.51.100.30');
    ok(statuts.slice(0, 8).every((s) => s !== 429) && statuts[8] === 429, '[P] connexion : changer son X-Forwarded-For a chaque essai ne contourne pas le blocage, le 9e essai est refuse en 429', statuts);
    const demo = codeDeDemoEnProd();
    ok(CODE_DEMO.length >= 12 && demo.statut === 500 && /^PLATFORM_OWNER_CODE faible ou valeur de demonstration/.test(demo.message), '[P] en production, le code de demonstration ecrit dans le code est refuse comme code du proprietaire', demo);
    const plateforme = await appelerLaPlateforme();
    ok(plateforme.statut === 403 && /appartient à la plateforme/.test(plateforme.message), '[P] la ligne du proprietaire de la plateforme ne change pas de role depuis un centre', plateforme);
  }
  charger([[F.rateLimit, ANCRE.ipDeConfiance, "  const brut = h['x-forwarded-for'] || h['x-vercel-forwarded-for'] || h['x-real-ip']"]]);
  {
    const { getClientIp } = require(F.rateLimit);
    const forge = { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' }, socket: { remoteAddress: '10.0.0.1' } };
    ok(getClientIp(forge) === '6.6.6.6', '[P] contre-preuve : l ordre d avant compte l adresse ecrite par le client (ce gate le verrait)', getClientIp(forge));
  }
  charger([[F.rateLimit, ANCRE.blocIPv6, "function cleDeLAdresse(ip) {\n  return String(ip || '').trim() || 'unknown';"]]);
  {
    const { cleDeLAdresse } = require(F.rateLimit);
    ok(cleDeLAdresse('2001:db8:aa:bb:1:2:3:4') !== cleDeLAdresse('2001:db8:aa:bb:ffff::9'), '[P] contre-preuve : compte par adresse entiere, deux adresses du meme bloc font deux compteurs (ce gate le verrait)');
  }
  charger([[F.apiStaffAuth, ANCRE.empreinteDeConfiance, "    req.headers['x-forwarded-for']\n    || req.headers['x-vercel-forwarded-for']\n    || req.headers['x-real-ip']"]]);
  {
    const statuts = await neufConnexionsForgees('198.51.100.31');
    ok(statuts[8] !== 429, '[P] contre-preuve : l empreinte d avant suit le X-Forwarded-For, le 9e essai passe encore (ce gate le verrait)', statuts);
  }
  charger([[F.staffAuth, ANCRE.codeDemo, '']]);
  {
    const demo = codeDeDemoEnProd();
    ok(demo.statut === 200 && demo.valeur === CODE_DEMO, '[P] contre-preuve : sans le code de demonstration dans la liste, la production l accepte (ce gate le verrait)', { statut: demo.statut, message: demo.message });
  }
  charger([[F.staffAuth, ANCRE.lignePlateforme, '']]);
  {
    const plateforme = await appelerLaPlateforme();
    ok(plateforme.statut !== 403, '[P] contre-preuve : sans la garde, la ligne de la plateforme passe la barriere (ce gate le verrait)', plateforme);
  }

  // =========================================================================
  console.log('\n[Q] sans voir les montants, modifier un dossier n en change aucun');
  // =========================================================================
  // Le dossier tel que la console le recoit, renvoye tel quel avec un nom corrige.
  const dossierDuPlanning = async (token) => {
    const lu = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token });
    return (JSON.parse(lu.body).reservations || []).find((r) => Number(r.id) === 9101) || null;
  };
  const corriger = (token, corps) => appeler(F.reservations, { method: 'PATCH', url: '/api/staff-reservations', token, body: corps });
  const ecrit = () => {
    const p = ecritures[ecritures.length - 1] || [];
    const lire = (v) => { try { return JSON.parse(v); } catch (e) { return null; } };
    return { nom: p[3], base: p[13], prix: p[14], extras: lire(p[19]) || [], programme: lire(p[27]) || {} };
  };
  charger();
  {
    const dossier = await dossierDuPlanning(T.editeur);
    ok(dossier && dossier.price === null && dossier.extras[0].price === null && dossier.program.items[0].price === null, '[Q] montage : la console du Correcteur recoit le dossier sans ses montants', dossier && { prix: dossier.price, extras: dossier.extras, programme: dossier.program });
    const res = await corriger(T.editeur, { ...dossier, name: 'Client Corrige', prixRaison: 'Prix revu au comptoir', baseUpdatedAt: dossier.updatedAt });
    const e = ecrit();
    ok(res.statusCode === 200 && e.nom === 'Client Corrige', '[Q] le dossier renvoye tel quel se corrige : le nom change', { statut: res.statusCode, corps: res.body.slice(0, 200), nom: e.nom });
    ok(e.prix === SENTINELLES.prix && e.base === SENTINELLES.base, '[Q] le prix et la base du dossier ne changent pas', { prix: e.prix, base: e.base });
    ok(e.extras.length === 1 && e.extras[0].price === SENTINELLES.extra, '[Q] le supplement garde son prix', e.extras);
    ok(e.programme.price === SENTINELLES.programme && e.programme.items && e.programme.items[0].price === SENTINELLES.ligne, '[Q] le programme garde ses montants', e.programme);
    ok(!contientUnMontant(res.body), '[Q] la reponse ne lui rend aucun montant', res.body.slice(0, 200));
    ecritures = [];
    const tape = await corriger(T.editeur, { ...dossier, price: 1, basePrice: 1, extras: [{ ...dossier.extras[0], price: 1 }], baseUpdatedAt: dossier.updatedAt });
    const t2 = ecrit();
    ok(tape.statusCode === 200 && t2.prix === SENTINELLES.prix && t2.base === SENTINELLES.base && t2.extras[0].price === SENTINELLES.extra, '[Q] un montant tape par ce role ne s ecrit pas non plus', { statut: tape.statusCode, prix: t2.prix, base: t2.base, extras: t2.extras });
    ecritures = [];
    const direction = await dossierDuPlanning(T.direction);
    const dir = await corriger(T.direction, { ...direction, price: 4000, prixRaison: 'Geste commercial', baseUpdatedAt: direction.updatedAt });
    ok(dir.statusCode === 200 && ecrit().prix === 4000, '[Q] contraste : la Direction change toujours un prix', { statut: dir.statusCode, corps: dir.body.slice(0, 200), prix: ecrit().prix });
    // Les lignes telles que la fenetre de modification les refait : ids par position, prix masques a 0.
    const { retirerLesMontantsDuCorps } = require(path.join(ROOT, 'lib', 'montants-role.js'));
    const stockees = [{ id: 'pizza-3', name: 'Pizza × 2', price: 20 }, { id: 'frites-1', name: 'Frites', price: 5 }];
    const lignes = (extras) => retirerLesMontantsDuCorps({ extras }, { extras: stockees }).extras;
    const memes = lignes([{ id: 'nourriture-1', name: 'Pizza × 2', price: 0 }, { id: 'nourriture-2', name: 'Frites', price: null }]);
    ok(memes[0].price === 20 && memes[1].price === 5, '[Q] des lignes refaites par position gardent leurs prix', memes);
    const unRetire = lignes([{ id: 'nourriture-1', name: 'Frites', price: 0 }]);
    ok(unRetire.length === 1 && unRetire[0].price === 5, '[Q] une ligne retiree ne donne pas son prix a la suivante', unRetire);
    const autreQuantite = lignes([{ id: 'nourriture-1', name: 'Pizza × 3', price: 0 }]);
    ok(autreQuantite[0].price === 30, '[Q] la quantite change, le prix de la ligne la suit', autreQuantite);
    const neuve = lignes([{ id: 'nourriture-1', name: 'Cafe', price: 3 }]);
    ok(neuve[0].price === 3, '[Q] une ligne neuve garde son propre prix', neuve);
  }
  charger([[path.join(ROOT, 'lib', 'montants-role.js'), ANCRE.identiteParNom, "  if (ligne.id) return `id:${ligne.id}`;"]]);
  {
    const { retirerLesMontantsDuCorps } = require(path.join(ROOT, 'lib', 'montants-role.js'));
    const extras = retirerLesMontantsDuCorps({ extras: [{ id: 'nourriture-1', name: 'Pizza × 2', price: 0 }] }, { extras: [{ id: 'pizza-3', name: 'Pizza × 2', price: 20 }] }).extras;
    ok(extras[0].price !== 20, '[Q] contre-preuve : reconnue par son id, la ligne perd son prix (ce gate le verrait)', extras);
  }
  // Le catalogue garde ses prix, meme quand son handler rappelle la garde.
  charger();
  {
    const r = await appeler(F.ops, { url: '/api/ops?action=centerConfig&centerId=libramont', token: T.technique });
    ok(r.statusCode === 200 && !/"price":null/.test(r.body) && /"price":\d/.test(r.body), '[Q] Technique lit les prix du catalogue dans Etablissement : il peut enregistrer', { statut: r.statusCode, corps: r.body.slice(0, 160) });
  }
  charger([[F.staffAuth, ANCRE.marque, "  if (res && typeof res === 'object') res.__sansMontants = !sessionHasPermission(effective, 'payments.view');"]]);
  {
    const r = await appeler(F.ops, { url: '/api/ops?action=centerConfig&centerId=libramont', token: T.technique });
    ok(/"price":null/.test(r.body), '[Q] contre-preuve : la deuxieme garde efface l exemption, les prix partent vides (ce gate le verrait)', { statut: r.statusCode, corps: r.body.slice(0, 160) });
  }
  charger([[F.reservations, ANCRE.retourMontants, '']]);
  {
    const dossier = await dossierDuPlanning(T.editeur);
    const res = await corriger(T.editeur, { ...dossier, name: 'Client Corrige', baseUpdatedAt: dossier.updatedAt });
    const e = ecrit();
    ok(res.statusCode !== 200 || !e.extras.length || e.extras[0].price !== SENTINELLES.extra, '[Q] contre-preuve : sans la garde, le supplement revient sans son prix (ce gate le verrait)', { statut: res.statusCode, extras: e.extras });
  }

  // =========================================================================
  console.log('\n[R] la session de secours du proprietaire');
  // =========================================================================
  let telegram = [];
  const fetchOriginal = globalThis.fetch;
  const avecTelegram = async (geste) => {
    process.env.TELEGRAM_JETON = 'gate';
    process.env.TELEGRAM_CHAT = '1';
    telegram = [];
    globalThis.fetch = async (url, init) => { telegram.push(String(JSON.parse(String((init && init.body) || '{}')).text || '')); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
    try { return await geste(); } finally { delete process.env.TELEGRAM_JETON; delete process.env.TELEGRAM_CHAT; globalThis.fetch = fetchOriginal; }
  };
  const connexionEnPanne = async (code, ip) => {
    panneBase = true;
    try { return await appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth', body: { action: 'login', centerId: 'libramont', code }, ip }); } finally { panneBase = false; }
  };
  const neufCodesFauxEnPanne = async (ip) => {
    const statuts = [];
    for (let i = 0; i < 9; i += 1) statuts.push((await connexionEnPanne('FG-0000-0000-0000-0000', ip)).statusCode);
    return statuts;
  };
  charger();
  await avecTelegram(async () => {
    const statuts = await neufCodesFauxEnPanne('198.51.100.40');
    ok(statuts.slice(0, 8).every((s) => s !== 200 && s !== 429) && statuts[8] === 429, '[R] base en panne : 8 codes faux, puis le 9e est refuse en 429', statuts);
    const bloque = await connexionEnPanne(process.env.PLATFORM_OWNER_CODE, '198.51.100.40');
    const secoursDit = () => telegram.filter((m) => /session de secours/.test(m));
    ok(bloque.statusCode === 429 && secoursDit().length === 0, '[R] bloque, meme le bon code du proprietaire est refuse', { statut: bloque.statusCode, telegram });
    const secours = await connexionEnPanne(process.env.PLATFORM_OWNER_CODE, '198.51.100.41');
    ok(secours.statusCode === 200 && /platform-owner-emergency/.test(secours.body), '[R] contraste : un autre appareil ouvre la session de secours avec le bon code', { statut: secours.statusCode, corps: secours.body.slice(0, 160) });
    ok(secoursDit().length === 1 && /^URGENT/.test(secoursDit()[0]), '[R] la session de secours ouverte sonne sur Telegram', telegram);
    panneBase = true;
    let horsLigne;
    try { horsLigne = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: 'fgs_faux_jeton' }); } finally { panneBase = false; }
    ok(horsLigne.statusCode === 200 && /storageMessage/.test(horsLigne.body) && !/quota/i.test(horsLigne.body), '[R] l etat hors ligne ne recopie pas le message du pilote de base', horsLigne.body.slice(0, 200));
  });
  // Une equipe qui reessaie ses codes pendant la panne n est pas bloquee quand la base revient.
  charger();
  await avecTelegram(async () => {
    const statuts = await neufCodesFauxEnPanne('198.51.100.44');
    const apres = await appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth', body: { action: 'login', centerId: 'libramont', code: 'FG-0000-0000-0000-0000' }, ip: '198.51.100.44' });
    ok(statuts[8] === 429 && apres.statusCode !== 429, '[R] la base revenue, le compteur de la panne ne bloque pas la connexion normale', { pendant: statuts[8], apres: apres.statusCode });
  });
  charger([[F.staffAuth, ANCRE.limiteSecours, '']]);
  await avecTelegram(async () => {
    const statuts = await neufCodesFauxEnPanne('198.51.100.42');
    ok(statuts[8] !== 429, '[R] contre-preuve : sans la limite, le 9e code s essaie encore (ce gate le verrait)', statuts);
  });
  charger([[F.apiStaffAuth, ANCRE.alerteSecours, '']]);
  await avecTelegram(async () => {
    const secours = await connexionEnPanne(process.env.PLATFORM_OWNER_CODE, '198.51.100.43');
    ok(secours.statusCode === 200 && !telegram.some((m) => /session de secours/.test(m)), '[R] contre-preuve : sans l alerte, la cle maitresse s ouvre en silence (ce gate le verrait)', { statut: secours.statusCode, telegram });
  });
  charger([[F.staffState, ANCRE.etatHorsLigne, `${ANCRE.etatHorsLigne}\n    storageError: error?.message || 'Base indisponible.',`]]);
  {
    panneBase = true;
    let horsLigne;
    try { horsLigne = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: 'fgs_faux_jeton' }); } finally { panneBase = false; }
    ok(/quota/i.test(horsLigne.body), '[R] contre-preuve : avec l ancien champ, le message du pilote sort (ce gate le verrait)', horsLigne.body.slice(0, 200));
  }

  // =========================================================================
  console.log('\n[S] une ecriture du personnel vient de la console');
  // =========================================================================
  const changerLaDemande = (headers) => appeler(F.ops, { method: 'POST', url: '/api/ops?centerId=libramont', token: T.direction, body: { action: 'customRequestStatus', id: 1, status: 'in_progress' }, headers });
  const etatDeLaDemande = () => demandes.find((d) => Number(d.id) === 1).status;
  charger();
  {
    for (const site of ['same-site', 'cross-site']) {
      const r = await changerLaDemande({ 'sec-fetch-site': site, origin: 'https://www.pinlane.be' });
      ok(r.statusCode === 403 && etatDeLaDemande() === 'new', `[S] une ecriture venue d un autre site (${site}) : 403, rien ne change`, { statut: r.statusCode, etat: etatDeLaDemande() });
    }
    const console_ = await changerLaDemande({ 'sec-fetch-site': 'same-origin' });
    ok(console_.statusCode === 200 && etatDeLaDemande() === 'in_progress', '[S] contraste : depuis la console, l ecriture passe', { statut: console_.statusCode, corps: console_.body.slice(0, 160) });
    viderDemandes();
    const outil = await changerLaDemande({});
    ok(outil.statusCode === 200 && etatDeLaDemande() === 'in_progress', '[S] un outil sans cet en-tete : la session decide', { statut: outil.statusCode });
    const lecture = await appeler(F.staffState, { url: `/api/staff-state?centerId=libramont&date=${JOUR}`, token: T.manager, headers: { 'sec-fetch-site': 'same-site' } });
    ok(lecture.statusCode === 200, '[S] une lecture n est pas une ecriture : elle passe', lecture.statusCode);
    const connexion = await appeler(F.apiStaffAuth, { method: 'POST', url: '/api/staff-auth', body: { action: 'login', centerId: 'libramont', code: process.env.PLATFORM_OWNER_CODE }, headers: { 'sec-fetch-site': 'cross-site' } });
    ok(connexion.statusCode === 403, '[S] la connexion non plus ne vient pas d un autre site', connexion.statusCode);
    for (const [route, url] of [['api/ops', F.ops], ['api/staff-auth', F.apiStaffAuth]]) {
      const r = await appeler(url, { url: `/${route}?centerId=libramont&action=centerConfig`, token: T.direction, headers: { origin: 'https://www.pinlane.be' } });
      ok(!r.headers['access-control-allow-origin'] && !r.headers['access-control-allow-credentials'], `[S] ${route} ne repond plus aux autres origines`, r.headers);
    }
    const publique = await appeler(F.meta, { method: 'OPTIONS', url: '/api/public-booking-meta', headers: { origin: 'https://www.fungalaxy.be' } });
    ok(publique.headers['access-control-allow-origin'] === 'https://www.fungalaxy.be', '[S] contraste : une route publique repond toujours au site du client', publique.headers);
  }
  charger([[F.staffAuth, ANCRE.autreSite, '  return false;']]);
  {
    const r = await changerLaDemande({ 'sec-fetch-site': 'same-site', origin: 'https://www.pinlane.be' });
    ok(r.statusCode === 200 && etatDeLaDemande() === 'in_progress', '[S] contre-preuve : sans la garde, un site voisin ecrit a la place de l employe (ce gate le verrait)', { statut: r.statusCode, etat: etatDeLaDemande() });
  }

  // =========================================================================
  console.log('\n[T] glisser une activite demande le droit de sa ressource');
  // =========================================================================
  const REFUS_RESSOURCE = 'Ce planning ne fait pas partie de votre rôle.';
  const glisser = (token, activityId) => appeler(F.reservations, { method: 'PATCH', url: '/api/staff-reservations', token, body: { id: 9101, centerId: 'libramont', activityMove: { activityId, startTime: '16:00', lanes: [4] } } });
  charger();
  {
    const a = await glisser(T.bowlingSeul, 'laser_game');
    ok(a.statusCode === 403 && a.body.includes(REFUS_RESSOURCE), '[T] sans « Gérer les sessions Laser Game », le laser ne se deplace pas', { statut: a.statusCode, corps: a.body.slice(0, 160) });
    const b = await glisser(T.laserSeul, 'bowling');
    ok(b.statusCode === 403 && b.body.includes(REFUS_RESSOURCE), '[T] sans « Gérer les pistes bowling », le bowling ne se deplace pas', { statut: b.statusCode, corps: b.body.slice(0, 160) });
    const c1 = await glisser(T.bowlingSeul, 'bowling');
    const c2 = await glisser(T.laserSeul, 'laser_game');
    ok(!c1.body.includes(REFUS_RESSOURCE) && !c2.body.includes(REFUS_RESSOURCE), '[T] contraste : chacun deplace sa ressource', { bowling: c1.body.slice(0, 120), laser: c2.body.slice(0, 120) });
  }
  charger([[F.reservations, ANCRE.droitRessource, '']]);
  {
    const a = await glisser(T.bowlingSeul, 'laser_game');
    ok(!a.body.includes(REFUS_RESSOURCE), '[T] contre-preuve : sans la garde, le laser se deplace sans son droit (ce gate le verrait)', { statut: a.statusCode, corps: a.body.slice(0, 160) });
  }

  // =========================================================================
  console.log('\n[U] le plan interne ne part pas a un visiteur anonyme');
  // =========================================================================
  const INTERNES = ['risk', 'staffSummary', 'marketIntelligence', 'entitlements', 'operationsChecklist'];
  const FUTUR = jourBelge(Date.now() + 14 * 86400000);
  const creneaux = async (token) => {
    const r = await appeler(F.dispo, { url: `/api/public-availability?date=${FUTUR}&type=laser&pax=8&centerId=libramont`, token });
    return { statut: r.statusCode, slots: (JSON.parse(r.body || '{}').slots || []), corps: r.body };
  };
  const internesVus = (slots) => [...new Set(slots.flatMap((s) => Object.keys(s.opsPlan || {}).filter((k) => INTERNES.includes(k))))];
  charger();
  {
    const anonyme = await creneaux('');
    ok(anonyme.slots.length > 0 && anonyme.slots[0].opsPlan && anonyme.slots[0].opsPlan.endTime, '[U] montage : un visiteur recoit des creneaux, leur heure de fin comprise', { statut: anonyme.statut, n: anonyme.slots.length, corps: anonyme.corps.slice(0, 200) });
    ok(internesVus(anonyme.slots).length === 0, '[U] aucun champ interne dans les creneaux d un visiteur', internesVus(anonyme.slots));
    const personnel = await creneaux(T.manager);
    ok(personnel.slots.length > 0 && internesVus(personnel.slots).length > 0, '[U] contraste : une vraie session du personnel garde son plan', internesVus(personnel.slots));
    const { sansValidationInterne } = require(path.join(ROOT, 'lib', 'reservation-ops.js'));
    const nettoye = sansValidationInterne({ opsPlan: { endTime: '12:00', risk: { score: 3 }, staffSummary: 'x', validation: {}, tableLimit: 2 } }).opsPlan;
    ok(nettoye.endTime === '12:00' && !('risk' in nettoye) && !('staffSummary' in nettoye) && !('validation' in nettoye) && !('tableLimit' in nettoye), '[U] la reponse a une reservation publique les retire aussi', nettoye);
  }
  charger([[F.dispo, ANCRE.planAnonyme, '  res.__visiteurAnonyme = false;']]);
  {
    const anonyme = await creneaux('');
    ok(internesVus(anonyme.slots).length > 0, '[U] contre-preuve : sans la regle, le risque part au visiteur (ce gate le verrait)', internesVus(anonyme.slots));
  }

  // =========================================================================
  console.log('\n[V] un corps public reste petit');
  // =========================================================================
  const tropGros = () => appeler(F.meta, { method: 'POST', url: '/api/public-booking-meta', body: { kind: 'erreur-formulaire', centerId: 'libramont', message: 'x'.repeat(100 * 1024) } });
  charger();
  {
    const r = await tropGros();
    ok(r.statusCode === 413, '[V] 100 Ko sur la route publique : refuse (413)', { statut: r.statusCode, corps: r.body.slice(0, 120) });
    const normal = await appeler(F.meta, { method: 'POST', url: '/api/public-booking-meta', body: { kind: 'inconnu' } });
    ok(normal.statusCode !== 413, '[V] contraste : un corps normal n est pas concerne', normal.statusCode);
  }
  charger([[F.meta, ANCRE.corpsPublic, '      body = await readJson(req);']]);
  {
    const r = await tropGros();
    ok(r.statusCode !== 413, '[V] contre-preuve : sans la borne, 100 Ko passent (ce gate le verrait)', r.statusCode);
  }

  // =========================================================================
  console.log('\n[W] les fichiers et la question libre suivent aussi « Voir les montants »');
  // =========================================================================
  const urlDocument = (action) => `/api/ops?action=${action}&centerId=libramont&date=${JOUR}`;
  const urlDonnees = (action) => `/api/ops?action=${action}&centerId=libramont&${PLAGE}`;
  // Les pages du PDF sont compressees : on les ouvre pour lire ce qui s imprime.
  const contenuDuPdf = (brut) => {
    const fichier = brut.toString('latin1');
    const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
    const pages = [];
    let m;
    while ((m = re.exec(fichier))) {
      const debut = m.index + m[0].length;
      pages.push(zlib.inflateSync(Buffer.from(fichier.slice(debut, debut + Number(m[1])), 'latin1')).toString('latin1'));
    }
    return pages.join('\n');
  };
  const imprimeUnMontant = (texte) => ['4321,75', '4999,50', '1234,25', '3333,50', '6666,25', '77,25'].some((v) => texte.includes(v));
  const feuille = async (token) => {
    const r = await appeler(F.ops, { url: urlDocument('feuilleSecours'), token });
    return { statut: r.statusCode, texte: r.brut ? contenuDuPdf(r.brut) : '' };
  };
  const classeur = (token) => appeler(F.ops, { url: urlDocument('classeurJour'), token });
  const estUnXlsx = (r) => Boolean(r.brut) && r.brut.slice(0, 2).toString('latin1') === 'PK';
  charger();
  {
    const technique = await feuille(T.technique);
    ok(technique.statut === 200 && technique.texte.includes('Client Sentinelle'), '[W] montage : la feuille de secours sort pour un role sans montants, avec ses reservations', technique.statut);
    ok(!imprimeUnMontant(technique.texte) && technique.texte.includes('\\267\\267\\267'), '[W] la feuille n imprime aucun prix : elle dit « ··· »');
    const manager = await feuille(T.manager);
    ok(manager.statut === 200 && imprimeUnMontant(manager.texte), '[W] contraste : le Manager lit les prix sur la feuille', manager.statut);
    const refuse = await classeur(T.technique);
    ok(refuse.statusCode === 403 && !refuse.brut, '[W] le classeur du jour se refuse sans le droit', refuse.statusCode);
    ok(/ne les voit pas/.test(refuse.body), '[W] le refus dit pourquoi', refuse.body.slice(0, 120));
    const accepte = await classeur(T.manager);
    ok(accepte.statusCode === 200 && estUnXlsx(accepte), '[W] contraste : le Manager recoit le classeur', accepte.statusCode);

    const donnees = await appeler(F.ops, { url: urlDonnees('donneesClients'), token: T.analyste });
    const lu = JSON.parse(donnees.body || '{}');
    const fiche = (lu.clients || [])[0] || {};
    ok(donnees.statusCode === 200 && fiche.visites > 0, '[W] montage : les donnees clients arrivent a un role Direction sans montants', { statut: donnees.statusCode, fiche });
    ok(fiche.depense === null && fiche.paye === null && fiche.panierMoyen === null, '[W] la fiche d un client ne dit plus ce qu il a depense ni paye', fiche);
    ok(lu.totaux.remises === null && lu.fidelite.depenseMoyenneParClient === null, '[W] ni les remises ni la depense moyenne', [lu.totaux.remises, lu.fidelite.depenseMoyenneParClient]);
    const direction = JSON.parse((await appeler(F.ops, { url: urlDonnees('donneesClients'), token: T.direction })).body || '{}');
    ok(direction.clients[0].depense > 0 && direction.fidelite.depenseMoyenneParClient > 0, '[W] contraste : la Direction lit ces montants', direction.clients[0]);
    const excelRefuse = await appeler(F.ops, { url: urlDonnees('exportDonnees'), token: T.analyste });
    ok(excelRefuse.statusCode === 403 && !excelRefuse.brut, '[W] l Excel des donnees clients se refuse sans le droit', excelRefuse.statusCode);
    const excel = await appeler(F.ops, { url: urlDonnees('exportDonnees'), token: T.direction });
    ok(excel.statusCode === 200 && estUnXlsx(excel), '[W] contraste : la Direction le recoit', excel.statusCode);
  }
  charger([[F.ops, ANCRE.documentTransmis, '      sansMontants: false,']]);
  {
    const technique = await feuille(T.technique);
    ok(imprimeUnMontant(technique.texte), '[W] contre-preuve : sans la marque transmise, la feuille imprime les prix (ce gate le verrait)');
    ok((await classeur(T.technique)).statusCode === 200, '[W] contre-preuve : sans la marque transmise, le classeur part (ce gate le verrait)');
  }
  charger([[F.secoursApi, ANCRE.classeurRefuse, '']]);
  ok((await classeur(T.technique)).statusCode === 200, '[W] contre-preuve : sans le refus, le classeur part (ce gate le verrait)');
  charger([[F.feuilleSecours, ANCRE.prixImprime, '  const prix = [{ texte: prixTexte(resa) }];']]);
  ok(imprimeUnMontant((await feuille(T.technique)).texte), '[W] contre-preuve : sans le masque, le prix s imprime (ce gate le verrait)');
  charger([[F.ops, ANCRE.excelDonnees, '']]);
  ok((await appeler(F.ops, { url: urlDonnees('exportDonnees'), token: T.analyste })).statusCode === 200, '[W] contre-preuve : sans le refus, l Excel part (ce gate le verrait)');
  charger([[F.montantsRole, ANCRE.siNombre, '']]);
  {
    const lu = JSON.parse((await appeler(F.ops, { url: urlDonnees('donneesClients'), token: T.analyste })).body || '{}');
    ok(lu.clients[0].depense > 0, '[W] contre-preuve : sans ces noms, la depense d un client repart (ce gate le verrait)', lu.clients[0].depense);
  }

  // La question libre : le serveur transmet la marque, le modele n ecrit pas de montant.
  const fauxAgent = (mutations = []) => {
    charger(mutations);
    const vus = [];
    const chemin = require.resolve(F.marketingAsk);
    require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { answerMarketingQuestion: async (centre, options) => { vus.push(options); return { ok: true, grounded: false, reason: 'sans_modele', question: options.question }; } } };
    return vus;
  };
  const poser = (token) => appeler(F.ops, { method: 'POST', url: '/api/ops', token, body: { action: 'marketingAsk', centerId: 'libramont', question: 'Combien on a fait ce mois ?' } });
  {
    const vus = fauxAgent();
    await poser(T.marketing);
    await poser(T.direction);
    ok(vus.length === 2 && vus[0].sansMontants === true && vus[1].sansMontants === false, '[W] la question libre sait si la personne voit les montants', vus);
  }
  {
    const vus = fauxAgent([[F.ops, ANCRE.questionTransmise, "    const result = await answerMarketingQuestion(concreteCenterId, { question: String(body.question || '') });"]]);
    await poser(T.marketing);
    ok(vus.length === 1 && vus[0].sansMontants !== true, '[W] contre-preuve : sans la marque transmise, le modele n est pas prevenu (ce gate le verrait)', vus);
  }
  const demander = async (reponse, sansMontants) => {
    const { answerMarketingQuestion } = require(F.marketingAsk);
    const { listBookingFormules } = require(path.join(ROOT, 'lib', 'catalog-store.js'));
    const { buildCenterFacts } = require(path.join(ROOT, 'lib', 'marketing-agents.js'));
    const appels = [];
    const resultat = await answerMarketingQuestion('libramont', { question: 'Comment va le mois ?', sansMontants }, {
      llmProvider: () => 'anthropic',
      isBudgetExhausted: () => false,
      buildMarketingBriefBundle: async () => ({ today: JOUR, dataDays: 210, pulse: { avgBasket: 15.4 }, facts: {}, radar: [], patterns: [], paie: {}, veille: {}, propositions: [], receipts: [] }),
      buildCenterFacts,
      getMergedFormulas: async () => listBookingFormules(),
      getFaitsAppris: async () => [],
      callLlmJson: async (options) => { appels.push(options); return { titre: 'Le mois', reponse, faits: [], jeNeSaisPas: [], action: 'aucune' }; },
    });
    return { resultat, consigne: appels[0] ? JSON.parse(appels[0].user).consigne : null };
  };
  const PHRASE_CHIFFREE = 'Ton panier moyen est de 15.4 €, donc chaque visiteur ramene ce montant.';
  charger();
  {
    const libre = await demander(PHRASE_CHIFFREE, false);
    ok(libre.resultat.grounded === true && !libre.consigne, '[W] contraste : avec le droit, la phrase chiffree passe', libre.resultat);
    const retenue = await demander(PHRASE_CHIFFREE, true);
    ok(retenue.resultat.grounded === false && retenue.resultat.reason === 'bloque', '[W] sans le droit, une reponse qui cite un montant du centre est retenue', retenue.resultat);
    ok(!JSON.stringify(retenue.resultat).includes('15.4'), '[W] le motif ne recite pas le montant retenu', retenue.resultat);
    ok(Boolean(retenue.consigne), '[W] le modele est prevenu de ne pas ecrire de montant');
    const { buildAskDossier } = require(F.marketingAsk);
    const { listBookingFormules } = require(path.join(ROOT, 'lib', 'catalog-store.js'));
    const { buildCenterFacts } = require(path.join(ROOT, 'lib', 'marketing-agents.js'));
    const dossier = buildAskDossier({ bundle: {}, centerFacts: buildCenterFacts('libramont'), formulas: listBookingFormules(), activities: [] });
    const public_ = dossier.formules.find((f) => /€/.test(f.prix));
    const publique = await demander(`Cette formule est a ${public_.prix}.`, true);
    ok(publique.resultat.grounded === true, '[W] contraste : un prix public du catalogue reste permis', publique.resultat);
  }
  charger([[F.marketingAsk, ANCRE.montantsRetenus, '  const montantsReserves = [];']]);
  ok((await demander(PHRASE_CHIFFREE, true)).resultat.grounded === true, '[W] contre-preuve : sans la regle, le montant part a la personne (ce gate le verrait)');

  console.log(echecs ? `\nsecurite-passe-check: ${echecs} FAIL` : '\nsecurite-passe-check: ALL OK');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('securite-passe-check CRASH:', error && error.stack ? error.stack : error);
  process.exit(1);
});
