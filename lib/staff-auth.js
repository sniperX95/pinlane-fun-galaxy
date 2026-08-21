const crypto = require('crypto');
const { getPool } = require('./database');
const { loadOpsKnowledge } = require('./ops-knowledge');
const { sendError } = require('./http');

const SESSION_HOURS = 14;
const EMERGENCY_SESSION_HOURS = 2;
const EMERGENCY_SESSION_PREFIX = 'fgs_emergency_';
const STAFF_SESSION_COOKIE = 'pinlane_staff_session';
const DEFAULT_PLATFORM_OWNER_CODE = 'pinlane-owner-demo-code';

const STAFF_PERMISSION_GROUPS = [
  {
    id: 'pilotage',
    permissions: ['dashboard.view', 'direction.view', 'centers.switch', 'reports.export'],
  },
  {
    id: 'planning',
    permissions: ['planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'planning.past'],
  },
  {
    id: 'reservations',
    permissions: [
      'reservations.view',
      'reservations.create',
      'reservations.edit',
      'reservations.cancel',
      'reservations.status',
      'reservations.quick',
    ],
  },
  {
    id: 'clients',
    permissions: ['clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download'],
  },
  {
    id: 'communication',
    permissions: ['emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents'],
  },
  {
    id: 'administration',
    permissions: ['pricing.manage', 'users.manage', 'settings.manage', 'security.codes', 'ai.ops'],
  },
];

const ALL_PERMISSIONS = STAFF_PERMISSION_GROUPS.flatMap((group) => group.permissions);

// ---- HIERARCHIE DES PERMISSIONS (2026-08-19) --------------------------------
//
// « Tout ce qui est contenu dans une option doit etre une sous-option »
// (Movsar). Une permission d ACTION n a aucun sens sans la permission de VUE
// qui la porte : modifier une reservation qu on ne voit pas, envoyer un mail
// depuis une page fermee, marquer paye sans voir les montants. Ces couples
// etaient jusqu ici une convention non ecrite, et rien ne les tenait : un role
// pouvait porter emails.send sans emails.view et son porteur se heurtait a un
// ecran vide (la classe de bug payee sur la vue Manager le 2026-08-19).
//
// Cette table est la SOURCE DE VERITE, cote serveur. L editeur de roles la lit
// pour dessiner ses sous-options, et normalizePermissionHierarchy la fait
// respecter a CHAQUE ecriture : un appel API direct ne peut pas fabriquer un
// role incoherent, meme en contournant l ecran.
const PERMISSION_PARENTS = {
  // Pilotage : la direction et les exports sont des vues DU dashboard.
  'direction.view': 'dashboard.view',
  'reports.export': 'dashboard.view',
  // Planning : tout ce qui agit sur le planning suppose de le voir.
  'planning.bowling': 'planning.view',
  'planning.laser': 'planning.view',
  'planning.drag': 'planning.view',
  'planning.past': 'planning.view',
  // Reservations : creer, corriger, annuler, pointer supposent de les voir.
  'reservations.create': 'reservations.view',
  'reservations.quick': 'reservations.create',
  'reservations.edit': 'reservations.view',
  'reservations.cancel': 'reservations.view',
  'reservations.status': 'reservations.view',
  // Clients et caisse.
  'clients.edit': 'clients.view',
  'payments.markPaid': 'payments.view',
  'exports.download': 'clients.view',
  // Communication : envoyer, faire des campagnes et piloter les agents
  // supposent d ouvrir la page des emails.
  'emails.send': 'emails.view',
  'campaigns.manage': 'emails.view',
  'marketing.agents': 'emails.view',
  // Administration : generer un code d acces fait partie de la gestion des
  // acces, elle n a pas de sens toute seule.
  'security.codes': 'users.manage',
};

// Les enfants directs d une permission, dans l ordre de declaration.
function permissionChildren(permission) {
  return Object.keys(PERMISSION_PARENTS).filter((child) => PERMISSION_PARENTS[child] === permission);
}

// La chaine des parents d une permission (le plus proche d abord).
function permissionAncestors(permission) {
  const chain = [];
  let current = PERMISSION_PARENTS[permission];
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = PERMISSION_PARENTS[current];
  }
  return chain;
}

// UNE LISTE DE PERMISSIONS COHERENTE, quoi qu on lui donne.
// Regle unique et dans ce sens : une sous-option accordee REMONTE ses parents.
// (L inverse, retirer les enfants d un parent absent, punirait une coche
// deliberee ; ici on honore l intention exprimee en la rendant utilisable.)
function normalizePermissionHierarchy(permissions = []) {
  const result = new Set(Array.isArray(permissions) ? permissions : []);
  for (const permission of [...result]) {
    for (const ancestor of permissionAncestors(permission)) result.add(ancestor);
  }
  return [...result];
}

// ---- Permission de niveau PLATEFORME (cockpit fondateur) --------------------
//
// 'platform.admin' ouvre le cockpit fondateur : couts IA, sante interne,
// activite de TOUS les centres, prospects. Elle est volontairement HORS de
// STAFF_PERMISSION_GROUPS, et ce placement est la moitie de la securite :
//   1. elle n'entre pas dans ALL_PERMISSIONS, donc le raccourci role.locked
//      (role Direction) ne la confere JAMAIS : la direction d'un centre a tous
//      les droits DU CENTRE, pas ceux de la plateforme ;
//   2. elle n'apparait pas dans l'editeur de roles (permissionGroups), donc un
//      porteur de users.manage ne peut pas se l'accorder ; les ecritures de
//      roles la retirent de toute facon (stripPlatformPermissions).
// Elle n'est accordee que par le SEED (role platform-owner, migration 0032 +
// bootstrap) et par le jeton de secours signe du proprietaire plateforme.
const PLATFORM_PERMISSIONS = ['platform.admin'];
const PLATFORM_PERMISSION_SET = new Set(PLATFORM_PERMISSIONS);

function isPlatformPermission(permission) {
  return PLATFORM_PERMISSION_SET.has(permission);
}

// Retire les permissions plateforme d'une liste : applique sur TOUTE ecriture
// de role venue d'une requete (createRole, updateRolePermissions). Sans ce
// filtre, une direction porteuse de users.manage pourrait se fabriquer un role
// porteur de platform.admin : une escalade de privileges centre -> plateforme.
function stripPlatformPermissions(permissions = []) {
  return (Array.isArray(permissions) ? permissions : []).filter((item) => !isPlatformPermission(item));
}

// Permissions plateforme explicitement presentes dans une liste brute (lecture
// du role en base). Seul chemin par lequel platform.admin entre dans une
// session : la liste du role platform-owner seedee en base.
function platformPermissionsOf(permissions = []) {
  return (Array.isArray(permissions) ? permissions : []).filter((item) => isPlatformPermission(item));
}

// Le role du proprietaire de la plateforme (Pinlane, pas Fun Galaxy). Seede par
// bootstrapCenterAccess (installs neufs) et par la migration 0032 (prod).
// locked=true le protege des editions de permissions comme le role direction ;
// son code de role partage est neutralise en base (aucun login par code de
// role : le proprietaire se connecte par son code MEMBRE, PLATFORM_OWNER_CODE).
const PLATFORM_OWNER_ROLE = {
  id: 'platform-owner',
  name: 'Proprietaire plateforme',
  code: 'PL',
  summary: 'Acces plateforme',
  description: 'Cockpit fondateur Pinlane : tous les centres, couts IA, journal global.',
  tone: 'platform',
  permissions: [...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS],
  locked: true,
};

const STAFF_ROLE_PRESETS = [
  {
    id: 'direction',
    name: 'Direction',
    code: 'DI',
    summary: 'Accès complet',
    description: 'Multi-centres, exports, mails, agents IA, utilisateurs et paramètres.',
    tone: 'direction',
    permissions: ALL_PERMISSIONS,
    locked: true,
  },
  {
    id: 'manager',
    name: 'Manager',
    code: 'MA',
    summary: 'Accès opérationnel',
    description: 'Planning, réservations, clients, caisse et suivi terrain.',
    tone: 'manager',
    permissions: [
      'dashboard.view',
      'planning.view',
      'planning.bowling',
      'planning.laser',
      'planning.drag',
      'planning.past',
      'reservations.view',
      'reservations.create',
      'reservations.edit',
      'reservations.cancel',
      'reservations.status',
      'reservations.quick',
      'clients.view',
      'clients.edit',
      'payments.view',
      'payments.markPaid',
      'emails.view',
      'reports.export',
    ],
  },
  {
    id: 'staff-bar',
    name: 'Staff bar',
    code: 'ST',
    summary: 'Accès terrain',
    description: 'Arrivées, statuts, réservation rapide, encaissement simple.',
    tone: 'staff',
    permissions: [
      'dashboard.view',
      'planning.view',
      'planning.bowling',
      'planning.laser',
      'reservations.view',
      'reservations.create',
      'reservations.status',
      'reservations.quick',
      'payments.view',
      'payments.markPaid',
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    code: 'MK',
    summary: 'Accès communication',
    description: 'Campagnes, emails, audience locale et agents marketing.',
    tone: 'marketing',
    permissions: [
      'dashboard.view',
      'clients.view',
      'emails.view',
      'emails.send',
      'campaigns.manage',
      'marketing.agents',
      'reports.export',
    ],
  },
  {
    id: 'technique',
    name: 'Technique',
    code: 'TE',
    summary: 'Accès maintenance',
    description: 'Pistes, laser, réglages centre et incidents opérationnels.',
    tone: 'technical',
    permissions: [
      'dashboard.view',
      'planning.view',
      'planning.bowling',
      'planning.laser',
      'planning.drag',
      'reservations.view',
      'settings.manage',
      'ai.ops',
    ],
  },
];

let schemaReady = false;
let schemaReadyPromise = null;

function normalizeText(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function normalizeStaffCenterId(value, fallback = 'libramont') {
  const raw = normalizeText(value, fallback);
  const clean = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!clean) return fallback;
  if (['libramont', 'gembloux', 'ciney'].includes(clean)) return clean;
  if (clean.includes('gembloux')) return 'gembloux';
  if (clean.includes('ciney')) return 'ciney';
  if (
    clean.includes('libramont')
    || clean === 'fun galaxy centre'
    || clean === 'fun galaxy center'
    || clean === 'fungalaxy centre'
    || clean === 'fungalaxy center'
    || clean === 'fun galaxy'
    || clean === 'fungalaxy'
    || clean === 'admin'
    || clean === 'pinlane'
  ) {
    return 'libramont';
  }

  return raw;
}

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

// Fail-secure: fallbacks (demo codes, dev signing secret) are OFF unless a
// developer explicitly opts in. A fresh checkout running outside Vercel with
// no env must never silently accept the publicly-known owner code.
function allowDevelopmentFallbacks() {
  if (isProductionRuntime()) return false;
  return process.env.ALLOW_INSECURE_STAFF_CODES === 'true';
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const WEAK_PRODUCTION_SECRET_VALUES = new Set([
  'admin',
  'adminfun',
  'change-me',
  'changeme',
  'demo',
  'fungalaxy-local-dev',
  'password',
  'pinlane-owner',
  'replace-me',
  'session-direction',
  'test',
]);

function assertStrongProductionSecret(name, value) {
  const clean = String(value || '').trim();
  if (!clean) return clean;
  if (!isProductionRuntime()) return clean;
  const normalized = clean.toLowerCase();
  const looksLikePlaceholder = normalized.includes('replace-with')
    || normalized.includes('example')
    || normalized.includes('placeholder');
  if (WEAK_PRODUCTION_SECRET_VALUES.has(normalized) || looksLikePlaceholder || clean.length < 12) {
    throw createHttpError(`${name} faible ou valeur de demonstration interdite en production.`, 500);
  }
  return clean;
}

function getAuthSecret() {
  const configured = process.env.STAFF_AUTH_SECRET
    || process.env.SITE_PASSWORD
    || process.env.DIRECTOR_PASSWORD;
  if (configured) return assertStrongProductionSecret('STAFF_AUTH_SECRET', configured);
  if (allowDevelopmentFallbacks()) {
    // Dev-only fixed secret. Never reuse DATABASE_URL as the signing key: a
    // leaked signing secret must not also expose database credentials.
    return 'pinlane-local-dev-signing-secret';
  }
  throw createHttpError('STAFF_AUTH_SECRET manquant en production.', 500);
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(`${getAuthSecret()}:${String(value || '').trim()}`).digest('hex');
}

// --- Chiffrement réversible des codes d'accès (copie sans régénération) -------
// Le hash SHA-256 (accessCodeMatches) reste l'unique référence de vérification
// au login : il n'est PAS modifié. En complément, on stocke une version
// chiffrée AES-256-GCM du code afin de pouvoir le RÉVÉLER (copier) sur demande
// d'un rôle autorisé, sans jamais changer le code ni l'écrire en clair au repos.
const ACCESS_CODE_ENC_VERSION = 1;
let accessCodeKeyCache = null;
let accessCodeKeyCacheSource = '';

function deriveAccessCodeKey() {
  const secret = getAuthSecret();
  if (accessCodeKeyCache && accessCodeKeyCacheSource === secret) return accessCodeKeyCache;
  // HKDF-SHA256 : dérive une clé de chiffrement 256 bits DISTINCTE du secret de
  // signature/hash. Sel + info constants lient la clé à STAFF_AUTH_SECRET sans
  // stocker ni coder en dur aucune clé. Une rotation du secret rend illisibles
  // les anciens ciphertexts (fail-secure : on régénère alors le code).
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('pinlane:staff-access-code:v1', 'utf8'),
    Buffer.from('access-code-encryption', 'utf8'),
    32,
  );
  accessCodeKeyCache = Buffer.from(derived);
  accessCodeKeyCacheSource = secret;
  return accessCodeKeyCache;
}

function encryptAccessCode(code) {
  const clean = String(code || '').trim();
  if (!clean) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAccessCodeKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format compact : [version(1) | iv(12) | authTag(16) | ciphertext] en base64.
  return Buffer.concat([Buffer.from([ACCESS_CODE_ENC_VERSION]), iv, authTag, ciphertext]).toString('base64');
}

function decryptAccessCode(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return '';
  try {
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length < 1 + 12 + 16 + 1 || buffer[0] !== ACCESS_CODE_ENC_VERSION) return '';
    const iv = buffer.subarray(1, 13);
    const authTag = buffer.subarray(13, 29);
    const ciphertext = buffer.subarray(29);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAccessCodeKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    return '';
  }
}

function safeTimingEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function accessCodeMatches(input, expected) {
  if (!input || !expected) return false;
  return safeTimingEqual(hashSecret(input), hashSecret(expected));
}

function createAccessCode(prefix = 'FG') {
  const safePrefix = String(prefix || 'FG').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4) || 'FG';
  const first = crypto.randomBytes(2).toString('hex').toUpperCase();
  const second = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${safePrefix}-${first}-${second}`;
}

function getDirectionCode() {
  if (process.env.STAFF_DIRECTION_CODE) return assertStrongProductionSecret('STAFF_DIRECTION_CODE', process.env.STAFF_DIRECTION_CODE);
  if (process.env.DIRECTOR_PASSWORD) return assertStrongProductionSecret('DIRECTOR_PASSWORD', process.env.DIRECTOR_PASSWORD);
  if (process.env.SITE_PASSWORD) return assertStrongProductionSecret('SITE_PASSWORD', process.env.SITE_PASSWORD);
  if (allowDevelopmentFallbacks()) return 'SESSION-DIRECTION';
  throw createHttpError('STAFF_DIRECTION_CODE manquant en production.', 500);
}

function getPlatformOwnerCode() {
  const configured = process.env.PLATFORM_OWNER_CODE
    || process.env.STAFF_OWNER_CODE
    || process.env.STAFF_DIRECTION_CODE
    || process.env.DIRECTOR_PASSWORD
    || process.env.SITE_PASSWORD;
  if (configured) return assertStrongProductionSecret('PLATFORM_OWNER_CODE', configured);
  if (allowDevelopmentFallbacks()) return DEFAULT_PLATFORM_OWNER_CODE;
  throw createHttpError('PLATFORM_OWNER_CODE manquant en production.', 500);
}

function isStaffAuthStorageError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return Boolean(
    message.includes('data transfer quota')
    || (message.includes('quota') && (message.includes('exceeded') || message.includes('limit')))
    || message.includes('database_url manquant')
    || message.includes('database unavailable')
    || message.includes('database connection')
    || message.includes('terminating connection')
    || message.includes('connection terminated')
    || message.includes('could not translate host name')
    || message.includes('getaddrinfo')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('etimedout')
  );
}

function publicStorageErrorMessage() {
  return 'Connexion staff temporairement limitee cote base de donnees. Acces proprietaire de secours disponible si votre code est autorise.';
}

function signEmergencyPayload(payloadBase64) {
  return crypto
    .createHmac('sha256', getAuthSecret())
    .update(String(payloadBase64 || ''))
    .digest('base64url');
}

function encodeEmergencyToken(payload) {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${EMERGENCY_SESSION_PREFIX}${payloadBase64}.${signEmergencyPayload(payloadBase64)}`;
}

function decodeEmergencyToken(token) {
  const safeToken = normalizeText(token, '');
  if (!safeToken.startsWith(EMERGENCY_SESSION_PREFIX)) return null;
  const tokenBody = safeToken.slice(EMERGENCY_SESSION_PREFIX.length);
  const [payloadBase64, signature] = tokenBody.split('.');
  if (!payloadBase64 || !signature) return null;
  if (!safeTimingEqual(signature, signEmergencyPayload(payloadBase64))) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (!payload || payload.kind !== 'platform-owner-emergency') return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function createEmergencyAccessControl(centerId = 'libramont') {
  const safeCenterId = normalizeStaffCenterId(centerId);
  const now = new Date().toISOString();
  let directionHint = '';
  try {
    directionHint = codeHint(getDirectionCode());
  } catch (error) {
    directionHint = '';
  }
  const ownerHint = codeHint(getPlatformOwnerCode());
  const roles = STAFF_ROLE_PRESETS.map((preset) => ({
    id: preset.id,
    centerId: safeCenterId,
    name: preset.name,
    code: preset.code,
    summary: preset.summary,
    description: preset.description,
    tone: preset.tone,
    permissions: safePermissions(preset.permissions),
    accessCode: '',
    accessCodeHint: preset.id === 'direction' ? directionHint : '',
    locked: Boolean(preset.locked),
    updatedAt: now,
  }));
  const ownerId = `${safeCenterId}:platform-owner-emergency`;
  return {
    centerId: safeCenterId,
    selectedRoleId: 'direction',
    selectedMemberId: ownerId,
    roles,
    members: [
      {
        id: ownerId,
        centerId: safeCenterId,
        name: 'Proprietaire plateforme',
        contact: 'Acces de secours signe',
        roleId: 'direction',
        status: 'active',
        code: ownerHint,
        accessCodeHint: ownerHint,
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
        emergency: true,
      },
    ],
    events: [
      {
        id: 0,
        label: 'Mode secours actif: base de donnees indisponible',
        at: now,
        type: 'emergency_owner_session',
        actorMemberId: ownerId,
        payload: { storageUnavailable: true },
      },
    ],
    permissionGroups: STAFF_PERMISSION_GROUPS,
    allPermissions: ALL_PERMISSIONS,
    emergency: true,
  };
}

function createSessionFromEmergencyPayload(token, payload) {
  const safeCenterId = normalizeStaffCenterId(payload.centerId || 'libramont');
  const expiresAt = new Date(Number(payload.exp)).toISOString();
  return {
    token,
    centerId: safeCenterId,
    expiresAt,
    member: {
      id: `${safeCenterId}:platform-owner-emergency`,
      name: 'Proprietaire plateforme',
      contact: 'Acces de secours signe',
      status: 'active',
      emergency: true,
    },
    role: {
      id: 'direction',
      name: 'Direction',
      code: 'DI',
      locked: true,
      emergency: true,
    },
    // Le jeton de secours n'existe que signe par PLATFORM_OWNER_CODE : son
    // porteur EST le proprietaire plateforme, il garde donc l'acces cockpit.
    permissions: [...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS],
    emergency: true,
  };
}

function createEmergencyOwnerSession({ centerId = 'libramont', code = '' } = {}) {
  const safeCenterId = normalizeStaffCenterId(centerId);
  const safeCode = normalizeText(code, '');
  if (!accessCodeMatches(safeCode, getPlatformOwnerCode())) return null;
  const expiresAtMs = Date.now() + EMERGENCY_SESSION_HOURS * 60 * 60 * 1000;
  const payload = {
    v: 1,
    kind: 'platform-owner-emergency',
    centerId: safeCenterId,
    memberId: `${safeCenterId}:platform-owner-emergency`,
    iat: Date.now(),
    exp: expiresAtMs,
  };
  const token = encodeEmergencyToken(payload);
  return {
    session: createSessionFromEmergencyPayload(token, payload),
    accessControl: createEmergencyAccessControl(safeCenterId),
  };
}

function codeHint(code) {
  const clean = String(code || '').trim();
  return clean ? `••••-${clean.slice(-4).toUpperCase()}` : '';
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const loginAttempts = globalThis.__pinlaneStaffLoginAttempts || new Map();
globalThis.__pinlaneStaffLoginAttempts = loginAttempts;

function makeLoginRateKey(centerId, fingerprint) {
  const source = `${normalizeText(centerId, 'libramont')}:${normalizeText(fingerprint, 'unknown')}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function getLoginAttemptBucket(centerId, fingerprint) {
  const key = makeLoginRateKey(centerId, fingerprint);
  const now = Date.now();
  const bucket = loginAttempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { failures: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, fresh);
    return { key, bucket: fresh };
  }
  return { key, bucket };
}

function assertLoginRateLimit(centerId, fingerprint) {
  const { bucket } = getLoginAttemptBucket(centerId, fingerprint);
  if (bucket.failures >= LOGIN_MAX_FAILURES) {
    throw createLoginRateLimitError(bucket);
  }
}

function createLoginRateLimitError(bucket) {
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  const error = createHttpError('Trop de tentatives. Reessayez dans quelques minutes.', 429);
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function isLoginRateLimited(centerId, fingerprint) {
  return getLoginAttemptBucket(centerId, fingerprint).bucket.failures >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(centerId, fingerprint) {
  const { bucket } = getLoginAttemptBucket(centerId, fingerprint);
  bucket.failures += 1;
}

function clearLoginFailures(centerId, fingerprint) {
  loginAttempts.delete(makeLoginRateKey(centerId, fingerprint));
}

function safePermissions(permissions = []) {
  // Les permissions plateforme sont admises en LECTURE (mapper le role
  // platform-owner, construire une session) : l'anti-escalade des ECRITURES
  // de roles est porte par stripPlatformPermissions aux points d'ecriture.
  const allowed = new Set([...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS]);
  const known = [...new Set((Array.isArray(permissions) ? permissions : []).filter((item) => allowed.has(item)))];
  // COHERENCE DE HIERARCHIE (2026-08-19) : une sous-option accordee remonte
  // ses parents. Ce point de passage est commun a toutes les ecritures de
  // role, donc un appel API direct ne peut pas fabriquer un role incoherent
  // en contournant l'editeur.
  return normalizePermissionHierarchy(known);
}

function getCenterIds() {
  try {
    const knowledge = loadOpsKnowledge();
    const ids = (knowledge.centers || []).map((center) => center.id).filter(Boolean);
    if (ids.length) return ids;
  } catch (error) {}
  return ['libramont', 'gembloux', 'ciney'];
}

// Fast-path cold start : détecte en UNE requête SQL que le schéma staff-auth
// est déjà provisionné ET que les codes bootstrap (direction / propriétaire
// plateforme) correspondent aux secrets d'environnement actuels. Sans ce
// raccourci, CHAQUE cold start serverless payait la DDL complète + le
// bootstrap des 3 centres (~20 allers-retours SQL, plusieurs secondes en
// prod). Toute anomalie (table absente, centre ou membre manquant, code
// tourné via env) => retour au bootstrap complet classique.
async function staffAuthSchemaAlreadyProvisioned() {
  try {
    const directionHash = hashSecret(getDirectionCode());
    const ownerHash = hashSecret(getPlatformOwnerCode());
    const expected = new Map();
    for (const centerId of getCenterIds()) {
      expected.set(`${centerId}:direction-local`, directionHash);
      expected.set(`${centerId}:platform-owner`, ownerHash);
    }
    const result = await getPool().query(
      'select id, access_code_hash from staff_members where id = any($1::text[]);',
      [[...expected.keys()]],
    );
    if (result.rowCount !== expected.size) return false;
    return result.rows.every((row) => row.access_code_hash === expected.get(row.id));
  } catch (error) {
    return false;
  }
}

async function ensureStaffAuthSchema() {
  if (schemaReady) return;
  // Mémoïse le bootstrap en cours : plusieurs requêtes concurrentes dans le même
  // process partagent la même promesse au lieu de lancer chacune la DDL.
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    if (await staffAuthSchemaAlreadyProvisioned()) return;
    await runStaffAuthSchemaBootstrap();
  })()
    .then(() => { schemaReady = true; })
    .catch((error) => { schemaReadyPromise = null; throw error; });
  return schemaReadyPromise;
}

async function runStaffAuthSchemaBootstrap() {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // Verrou advisory transactionnel : sérialise le bootstrap du schéma entre
    // TOUTES les instances serverless. Sans lui, plusieurs lambdas lancent en
    // parallèle au démarrage à froid des DDL non idempotentes sous concurrence
    // (create or replace function, drop/create trigger) qui modifient le
    // catalogue Postgres → erreur "tuple concurrently updated". Le lock est
    // relâché automatiquement au commit/rollback.
    await client.query('select pg_advisory_xact_lock(hashtext($1));', ['fungalaxy:staff-auth-schema']);
    await client.query(`
    create or replace function set_updated_at()
    returns trigger
    language plpgsql
    as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;

    create table if not exists staff_roles (
      center_id text not null default 'libramont',
      id text not null,
      name text not null,
      code text not null,
      summary text not null default '',
      description text not null default '',
      tone text not null default 'custom',
      permissions jsonb not null default '[]'::jsonb,
      access_code_hash text not null,
      access_code_hint text not null default '',
      locked boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (center_id, id)
    );

    create table if not exists staff_members (
      id text primary key,
      center_id text not null default 'libramont',
      name text not null,
      contact text not null default '',
      role_id text not null,
      status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
      access_code_hash text not null,
      access_code_hint text not null default '',
      last_seen timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (center_id, role_id) references staff_roles(center_id, id) on delete restrict
    );

    create index if not exists staff_members_center_idx on staff_members (center_id, role_id, status);

    -- Migration additive 0011 (fresh installs) : version chiffrée réversible du
    -- code d'accès, en complément du hash. Idempotent sur les installs existants.
    alter table staff_roles add column if not exists access_code_enc text;
    alter table staff_members add column if not exists access_code_enc text;

    create table if not exists staff_sessions (
      token_hash text primary key,
      center_id text not null default 'libramont',
      member_id text not null references staff_members(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      last_seen timestamptz not null default now()
    );

    create index if not exists staff_sessions_member_idx on staff_sessions (member_id, expires_at desc);

    create table if not exists staff_access_events (
      id bigserial primary key,
      center_id text not null default 'libramont',
      actor_member_id text,
      event_type text not null,
      label text not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists staff_access_events_center_idx on staff_access_events (center_id, created_at desc);

    drop trigger if exists staff_roles_set_updated_at on staff_roles;
    create trigger staff_roles_set_updated_at
    before update on staff_roles
    for each row
    execute function set_updated_at();

    drop trigger if exists staff_members_set_updated_at on staff_members;
    create trigger staff_members_set_updated_at
    before update on staff_members
    for each row
    execute function set_updated_at();
  `);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  for (const centerId of getCenterIds()) {
    await bootstrapCenterAccess(centerId);
  }
}

// ---- LE CODE DU PROPRIETAIRE NE DEPEND D'AUCUN CENTRE ----------------------
//
// PLATFORM_OWNER_CODE ouvre le centre qu'on lui demande, point. La session a
// pourtant besoin d'un membre (staff_sessions.member_id est une cle etrangere),
// donc ce membre se pose ICI, a la volee, au moment de la connexion : c'est un
// detail de stockage, pas une condition d'entree.
//
// Sans ca, le fondateur se faisait refuser l'entree chez ses propres clients :
// bootstrapCenterAccess ne tourne que sur getCenterIds(), qui lit le FICHIER
// ops-knowledge/centers.json, donc les centres nes DANS LA CONSOLE
// (n4-bowling, mi12) n'avaient ni role plateforme ni membre proprietaire. Le
// 2026-08-21, la prod repondait 200 sur libramont et 400 « Code refuse ou
// acces bloque » sur n4-bowling, pour le meme code.
//
// Cette fonction pose ces DEUX lignes-la et rien d'autre : ni role preset, ni
// code direction, qui restent propres aux centres du socle.
async function ensurePlatformOwnerAccess(centerId, executor = getPool()) {
  const safeCenterId = normalizeStaffCenterId(centerId);
  const platformOwnerCode = getPlatformOwnerCode();
  // Role plateforme : seul porteur de platform.admin. Son code de role
  // partage est neutralise ('verrouille:...' ne peut jamais egaler un digest
  // hex de hashSecret) : personne ne se connecte "en tant que role"
  // platform-owner, seul le MEMBRE proprietaire (code PLATFORM_OWNER_CODE)
  // ouvre une session porteuse de cette permission. Migration 0032 fait la
  // meme chose sur les installs deja provisionnes.
  await executor.query(
    `
      insert into staff_roles (
        center_id, id, name, code, summary, description, tone,
        permissions, access_code_hash, access_code_hint, locked
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'',true)
      on conflict (center_id, id) do update set
        permissions = excluded.permissions,
        locked = true,
        updated_at = now();
    `,
    [
      safeCenterId,
      PLATFORM_OWNER_ROLE.id,
      PLATFORM_OWNER_ROLE.name,
      PLATFORM_OWNER_ROLE.code,
      PLATFORM_OWNER_ROLE.summary,
      PLATFORM_OWNER_ROLE.description,
      PLATFORM_OWNER_ROLE.tone,
      JSON.stringify(safePermissions(PLATFORM_OWNER_ROLE.permissions)),
      'verrouille:aucun-code-de-role',
    ],
  );

  const platformOwnerMemberId = `${safeCenterId}:platform-owner`;
  await executor.query(
    `
      insert into staff_members (
        id, center_id, name, contact, role_id, status, access_code_hash, access_code_hint, access_code_enc
      ) values ($1,$2,$3,$4,$5,'active',$6,$7,$8)
      on conflict (id) do update set
        role_id = excluded.role_id,
        status = 'active',
        access_code_hash = excluded.access_code_hash,
        access_code_hint = excluded.access_code_hint,
        access_code_enc = excluded.access_code_enc,
        updated_at = now();
    `,
    [
      platformOwnerMemberId,
      safeCenterId,
      'Proprietaire plateforme',
      'Acces Pinlane',
      PLATFORM_OWNER_ROLE.id,
      hashSecret(platformOwnerCode),
      codeHint(platformOwnerCode),
      encryptAccessCode(platformOwnerCode),
    ],
  );
  return safeCenterId;
}

async function bootstrapCenterAccess(centerId = 'libramont') {
  centerId = normalizeStaffCenterId(centerId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const directionCode = getDirectionCode();
    for (const preset of STAFF_ROLE_PRESETS) {
      const bootstrapCode = preset.id === 'direction'
        ? directionCode
        : createAccessCode(preset.code);
      await client.query(
        `
          insert into staff_roles (
            center_id, id, name, code, summary, description, tone,
            permissions, access_code_hash, access_code_hint, locked, access_code_enc
          ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
          on conflict (center_id, id) do nothing;
        `,
        [
          centerId,
          preset.id,
          preset.name,
          preset.code,
          preset.summary,
          preset.description,
          preset.tone,
          JSON.stringify(safePermissions(preset.permissions)),
          hashSecret(bootstrapCode),
          codeHint(bootstrapCode),
          Boolean(preset.locked),
          encryptAccessCode(bootstrapCode),
        ],
      );
    }

    await client.query(
      `
        update staff_roles
        set access_code_hash = $3,
            access_code_hint = $4,
            permissions = $5::jsonb,
            locked = true,
            access_code_enc = $6,
            updated_at = now()
        where center_id = $1 and id = $2;
      `,
      [
        centerId,
        'direction',
        hashSecret(directionCode),
        codeHint(directionCode),
        JSON.stringify(ALL_PERMISSIONS),
        encryptAccessCode(directionCode),
      ],
    );

    const directionMemberId = `${centerId}:direction-local`;
    await client.query(
      `
        insert into staff_members (
          id, center_id, name, contact, role_id, status, access_code_hash, access_code_hint, access_code_enc
        ) values ($1,$2,$3,$4,$5,'active',$6,$7,$8)
        on conflict (id) do update set
          role_id = excluded.role_id,
          status = 'active',
          access_code_hash = excluded.access_code_hash,
          access_code_hint = excluded.access_code_hint,
          access_code_enc = excluded.access_code_enc,
          updated_at = now();
      `,
      [
        directionMemberId,
        centerId,
        'Poste direction',
        'Acces bootstrap securise',
        'direction',
        hashSecret(directionCode),
        codeHint(directionCode),
        encryptAccessCode(directionCode),
      ],
    );

    await ensurePlatformOwnerAccess(centerId, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mapRole(row, extra = {}) {
  return {
    id: row.id,
    centerId: row.center_id,
    name: row.name,
    code: row.code,
    summary: row.summary || '',
    description: row.description || '',
    tone: row.tone || 'custom',
    permissions: safePermissions(row.permissions || []),
    accessCode: row.access_code_hint || '',
    accessCodeHint: row.access_code_hint || '',
    codeCopyReady: Boolean(row.access_code_enc),
    locked: Boolean(row.locked),
    updatedAt: row.updated_at,
    ...extra,
  };
}

function mapMember(row, extra = {}) {
  return {
    id: row.id,
    centerId: row.center_id,
    name: row.name,
    contact: row.contact || '',
    roleId: row.role_id,
    status: row.status,
    code: row.access_code_hint || '',
    accessCodeHint: row.access_code_hint || '',
    codeCopyReady: Boolean(row.access_code_enc),
    lastSeen: row.last_seen || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    label: row.label,
    at: row.created_at,
    type: row.event_type,
    actorMemberId: row.actor_member_id || '',
    payload: row.payload || {},
  };
}

async function listAccessControl(centerId = 'libramont') {
  await ensureStaffAuthSchema();
  const safeCenterId = normalizeStaffCenterId(centerId);
  const [roles, members, events] = await Promise.all([
    getPool().query('select * from staff_roles where center_id = $1 order by locked desc, created_at asc, name asc;', [safeCenterId]),
    getPool().query('select * from staff_members where center_id = $1 order by created_at asc, name asc;', [safeCenterId]),
    getPool().query('select * from staff_access_events where center_id = $1 order by created_at desc limit 20;', [safeCenterId]),
  ]);
  return {
    centerId: safeCenterId,
    selectedRoleId: roles.rows.some((row) => row.id === 'manager') ? 'manager' : roles.rows[0]?.id || 'direction',
    selectedMemberId: members.rows[0]?.id || '',
    roles: roles.rows.map(mapRole),
    members: members.rows.map(mapMember),
    events: events.rows.map(mapEvent),
    permissionGroups: STAFF_PERMISSION_GROUPS,
    allPermissions: ALL_PERMISSIONS,
  };
}

async function addAccessEvent({ centerId = 'libramont', actorMemberId = '', eventType = 'access_change', label, payload = {} }) {
  await ensureStaffAuthSchema();
  await getPool().query(
    `
      insert into staff_access_events (center_id, actor_member_id, event_type, label, payload)
      values ($1,$2,$3,$4,$5::jsonb);
    `,
    [centerId, actorMemberId || null, eventType, label, JSON.stringify(payload || {})],
  );
}

async function getRole(centerId, roleId) {
  await ensureStaffAuthSchema();
  const result = await getPool().query(
    'select * from staff_roles where center_id = $1 and id = $2 limit 1;',
    [normalizeStaffCenterId(centerId), normalizeText(roleId, '')],
  );
  return result.rows[0] ? mapRole(result.rows[0]) : null;
}

// Etat AVANT d'un role ou d'un membre, pour le diff d'audit (PP3).
//
// LISTE BLANCHE STRICTE, et c'est tout l'interet de cette fonction : mapRole
// renvoie accessCode, accessCodeHint et codeCopyReady, mapMember renvoie code
// et accessCodeHint. Journaliser l'objet complet ferait entrer un indice de
// code d'acces dans la table d'audit, ce que la regle T1 interdit explicitement
// ("meme partiel"). Le motif d'expurgation de lib/audit-log.js les attraperait
// aussi, mais on ne fait pas dependre l'absence de fuite d'un seul filet : ici
// les champs sensibles ne sont jamais LUS, donc ils ne peuvent pas fuir.
//
// Les champs retenus sont exactement ceux dont le changement a une consequence :
// les permissions d'un role (qui peut faire quoi), le role d'un membre
// (promotion ou retrogradation) et son statut (actif, bloque).
async function getAuditSubjectSnapshot({ centerId = 'libramont', roleId = '', memberId = '' } = {}) {
  const safeCenterId = normalizeStaffCenterId(centerId);
  if (roleId) {
    const result = await getPool().query(
      'select id, name, permissions, tone, summary, locked from staff_roles where center_id = $1 and id = $2 limit 1;',
      [safeCenterId, normalizeText(roleId, '')],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      permissions: safePermissions(row.permissions || []),
      tone: row.tone || 'custom',
      summary: row.summary || '',
      locked: Boolean(row.locked),
    };
  }
  if (memberId) {
    const result = await getPool().query(
      'select id, name, role_id, status from staff_members where center_id = $1 and id = $2 limit 1;',
      [safeCenterId, normalizeText(memberId, '')],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      roleId: row.role_id,
      status: row.status,
    };
  }
  return null;
}

// ---- LE CODE DIT LE CENTRE, PAS L'INVERSE ---------------------------------
//
// La console garde en memoire le dernier centre consulte (state.adminCenterId).
// Tant que le login cherchait le code UNIQUEMENT dans ce centre-la, le centre
// affiche etait devenu une condition d'entree alors qu'il n'est qu'un souvenir
// d'interface : un membre de Fun Galaxy qui rouvrait la console apres un
// passage chez un client se faisait repondre « Code refuse ou acces bloque »
// avec un code parfaitement valide, et le proprietaire de la plateforme aussi.
//
// La regle est desormais : un code appartient a un centre, et c'est LUI qui
// decide ou la session s'ouvre. Trois etapes, et l'ordre compte :
//   1. le centre demande, parce qu'un code partage par plusieurs centres (le
//      code Direction du socle est le meme sur les trois Fun Galaxy) doit
//      d'abord ouvrir celui qu'on regarde ;
//   2. le code du PROPRIETAIRE de la plateforme, qui n'appartient a aucun
//      centre et les ouvre tous, meme un centre qui n'a jamais vu de membre
//      proprietaire ;
//   3. le centre D'ORIGINE du code, retrouve par son empreinte.
//
// Ce que ca n'ouvre pas : rien de plus qu'avant. La session porte le centre DU
// CODE, jamais celui qui etait affiche : le code d'un client ne donne pas plus
// acces a un autre client qu'hier. C'est la meme porte, ouverte sur la bonne
// piece au lieu d'etre refusee.
async function findLoginSubject(centerId, code) {
  const direct = await findLoginSubjectInCenter(centerId, code);
  if (direct) return direct;

  if (isPlatformOwnerCode(code)) {
    await ensurePlatformOwnerAccess(centerId);
    const owner = await findLoginSubjectInCenter(centerId, code);
    if (owner) return owner;
  }

  const homeCenterId = await findHomeCenterForCode(hashSecret(code));
  if (!homeCenterId || homeCenterId === centerId) return null;
  return findLoginSubjectInCenter(homeCenterId, code);
}

// getPlatformOwnerCode() JETTE en production quand le secret manque : la
// connexion d'un code ordinaire ne doit pas tomber avec lui.
function isPlatformOwnerCode(code) {
  try {
    return accessCodeMatches(code, getPlatformOwnerCode());
  } catch (error) {
    return false;
  }
}

// Le centre d'ORIGINE d'un code. Un membre l'emporte sur un role (c'est le
// niveau le plus precis), et quand plusieurs centres partagent le meme code on
// prend celui ou il a servi en dernier : c'est le centre de travail de la
// personne, pas un tirage au sort. Un membre bloque n'est jamais une origine.
async function findHomeCenterForCode(codeHash) {
  const member = await getPool().query(
    `
      select m.center_id
      from staff_members m
      join staff_roles r on r.center_id = m.center_id and r.id = m.role_id
      where m.access_code_hash = $1 and m.status <> 'blocked'
      order by m.last_seen desc nulls last, m.created_at asc, m.center_id asc
      limit 1;
    `,
    [codeHash],
  );
  if (member.rows[0]) return member.rows[0].center_id;
  const role = await getPool().query(
    `
      select center_id from staff_roles
      where access_code_hash = $1
      order by created_at asc, center_id asc
      limit 1;
    `,
    [codeHash],
  );
  return (role.rows[0] && role.rows[0].center_id) || '';
}

async function findLoginSubjectInCenter(centerId, code) {
  const codeHash = hashSecret(code);
  const [memberResult, roleResult] = await Promise.all([
    getPool().query(
      `
        select m.*, r.permissions, r.name as role_name, r.locked as role_locked
        from staff_members m
        join staff_roles r on r.center_id = m.center_id and r.id = m.role_id
        where m.center_id = $1 and m.access_code_hash = $2 and m.status <> 'blocked'
        limit 1;
      `,
      [centerId, codeHash],
    ),
    getPool().query(
      'select * from staff_roles where center_id = $1 and access_code_hash = $2 limit 1;',
      [centerId, codeHash],
    ),
  ]);

  if (memberResult.rows[0]) {
    return { member: memberResult.rows[0], role: await getRole(centerId, memberResult.rows[0].role_id) };
  }

  const roleRow = roleResult.rows[0];
  if (!roleRow) return null;

  const sharedMemberId = `${centerId}:role:${roleRow.id}`;
  await getPool().query(
    `
      insert into staff_members (
        id, center_id, name, contact, role_id, status, access_code_hash, access_code_hint, last_seen
      ) values ($1,$2,$3,$4,$5,'active',$6,$7,now())
      on conflict (id) do update set
        role_id = excluded.role_id,
        status = case when staff_members.status = 'blocked' then 'blocked' else 'active' end,
        last_seen = now()
      returning *;
    `,
    [
      sharedMemberId,
      centerId,
      `${roleRow.name} partagé`,
      'Code rôle',
      roleRow.id,
      codeHash,
      roleRow.access_code_hint || codeHint(code),
    ],
  );
  const member = await getPool().query('select * from staff_members where id = $1 limit 1;', [sharedMemberId]);
  if (member.rows[0]?.status === 'blocked') return null;
  return { member: member.rows[0], role: mapRole(roleRow) };
}

async function createSessionForMember(centerId, memberId) {
  const token = `fgs_${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = hashSecret(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await getPool().query('delete from staff_sessions where expires_at <= now();');
  await getPool().query(
    `
      insert into staff_sessions (token_hash, center_id, member_id, expires_at)
      values ($1,$2,$3,$4);
    `,
    [tokenHash, centerId, memberId, expiresAt],
  );
  return { token, expiresAt };
}

async function loginStaffByCode({ centerId = 'libramont', code = '', fingerprint = '' }) {
  await ensureStaffAuthSchema();
  const safeCenterId = normalizeStaffCenterId(centerId);
  const safeCode = normalizeText(code, '');
  const safeFingerprint = normalizeText(fingerprint, 'unknown');
  const rateLimited = isLoginRateLimited(safeCenterId, safeFingerprint);
  if (!safeCode || safeCode.length < 6) {
    if (rateLimited) {
      throw createLoginRateLimitError(getLoginAttemptBucket(safeCenterId, safeFingerprint).bucket);
    }
    recordLoginFailure(safeCenterId, safeFingerprint);
    throw new Error('Code d’accès invalide.');
  }
  const subject = await findLoginSubject(safeCenterId, safeCode);
  if (!subject) {
    if (rateLimited) {
      throw createLoginRateLimitError(getLoginAttemptBucket(safeCenterId, safeFingerprint).bucket);
    }
    recordLoginFailure(safeCenterId, safeFingerprint);
    await addAccessEvent({
      centerId: safeCenterId,
      eventType: 'login_failed',
      label: 'Tentative de connexion refusée',
    }).catch(() => null);
    throw new Error('Code refusé ou accès bloqué.');
  }
  // LE CENTRE DE LA SESSION EST CELUI DU MEMBRE, jamais celui que la console
  // affichait : ouvrir une session estampillee n4-bowling pour un membre de
  // Libramont donnerait a son porteur le scope d'un autre client.
  const resolvedCenterId = normalizeStaffCenterId(subject.member.center_id) || safeCenterId;
  const sessionToken = await createSessionForMember(resolvedCenterId, subject.member.id);
  await getPool().query('update staff_members set status = $2, last_seen = now() where id = $1;', [
    subject.member.id,
    subject.member.status === 'pending' ? 'active' : subject.member.status,
  ]);
  await addAccessEvent({
    centerId: resolvedCenterId,
    actorMemberId: subject.member.id,
    eventType: 'login_success',
    label: `${subject.member.name} connecté`,
  }).catch(() => null);
  clearLoginFailures(safeCenterId, safeFingerprint);
  const session = await getStaffSessionFromToken(sessionToken.token);
  return { session, accessControl: await listAccessControl(resolvedCenterId) };
}

function readSessionToken(req) {
  const cookieToken = readCookieValue(req, STAFF_SESSION_COOKIE);
  return String(
    req.headers['x-staff-session']
    || req.headers['x-fgx-session']
    || req.headers['x-fun-galaxy-session']
    || cookieToken
    || '',
  ).trim();
}

function readCookieValue(req, name) {
  const cookieHeader = String(req?.headers?.cookie || '');
  if (!cookieHeader || !name) return '';
  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch (error) {
    return cookie.slice(prefix.length);
  }
}

async function getStaffSessionFromToken(token) {
  const safeToken = normalizeText(token, '');
  if (!safeToken) return null;
  const emergencyPayload = decodeEmergencyToken(safeToken);
  if (emergencyPayload) {
    return createSessionFromEmergencyPayload(safeToken, emergencyPayload);
  }
  await ensureStaffAuthSchema();
  const result = await getPool().query(
    `
      select
        s.token_hash,
        s.center_id,
        s.expires_at,
        m.id as member_id,
        m.name as member_name,
        m.contact,
        m.status as member_status,
        m.role_id,
        r.name as role_name,
        r.code as role_code,
        r.permissions,
        r.locked
      from staff_sessions s
      join staff_members m on m.id = s.member_id
      join staff_roles r on r.center_id = m.center_id and r.id = m.role_id
      where s.token_hash = $1
        and s.expires_at > now()
        and m.status <> 'blocked'
      limit 1;
    `,
    [hashSecret(safeToken)],
  );
  const row = result.rows[0];
  if (!row) return null;
  // Un seul aller-retour SQL pour rafraîchir les deux last_seen : ce code est
  // sur le chemin chaud de CHAQUE requête staff authentifiée.
  await getPool().query(
    `
      with touched_session as (
        update staff_sessions set last_seen = now() where token_hash = $1
      )
      update staff_members set last_seen = now() where id = $2;
    `,
    [row.token_hash, row.member_id],
  ).catch(() => null);
  // Un role verrouille garde tous les droits DU CENTRE. Les droits PLATEFORME
  // ne viennent jamais du verrou : uniquement de la liste explicite du role
  // (seul le role platform-owner seede les porte).
  const permissions = row.locked
    ? [...ALL_PERMISSIONS, ...platformPermissionsOf(row.permissions || [])]
    : safePermissions(row.permissions || []);
  return {
    token: safeToken,
    centerId: row.center_id,
    expiresAt: row.expires_at,
    member: {
      id: row.member_id,
      name: row.member_name,
      contact: row.contact || '',
      status: row.member_status,
    },
    role: {
      id: row.role_id,
      name: row.role_name,
      code: row.role_code,
      locked: Boolean(row.locked),
    },
    permissions,
  };
}

async function getStaffSessionFromRequest(req) {
  return getStaffSessionFromToken(readSessionToken(req));
}

function sessionHasPermission(session, permission) {
  if (!permission) return true;
  if (!session) return false;
  const wanted = Array.isArray(permission) ? permission : [permission];
  const granted = new Set(Array.isArray(session.permissions) ? session.permissions : []);
  return wanted.some((item) => {
    // Une permission PLATEFORME ne beneficie jamais du raccourci role.locked :
    // elle doit etre explicitement portee par la session. C'est ce qui fait
    // qu'une session Direction (role verrouille, tous les droits du centre)
    // recoit un refus sur le cockpit fondateur : c'est le comportement que le
    // gate scripts/founder-cockpit-check.js prouve, refus trace compris.
    if (isPlatformPermission(item)) return granted.has(item);
    if (session.role?.locked) return true;
    return granted.has(item);
  });
}

function getRequestedCenterId(req, options = {}) {
  if (options.centerId) return normalizeText(options.centerId, '');
  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    return normalizeText(requestUrl.searchParams.get('centerId') || '', '');
  } catch (error) {
    return '';
  }
}

// ---- Isolation INTER-CLIENTS du centre demande ------------------------------
//
// 'centers.switch' autorise le passage d'un centre a un autre : c'est ce qui
// permet a la direction de Fun Galaxy d'aller de Libramont a Gembloux. Cette
// permission est dans ALL_PERMISSIONS, donc TOUT role verrouille (Direction) la
// porte, et sessionHasPermission la concede meme sans qu'elle soit listee. Elle
// ne disait rien du CLIENT proprietaire du centre demande : une direction du
// client A pouvait donc, en forgeant `centerId=<centre du client B>`, LIRE et
// ECRIRE les donnees de B. Prouve de bout en bout (dispatcher api/ops.js reel,
// requetes SQL reelles) par scripts/cross-client-center-scope-check.js.
//
// La regle appliquee ici est exactement celle que la LISTE des centres
// appliquait deja de son cote (lib/center-scope.listCentersForSession) : on ne
// traverse qu'a l'interieur de SON client ; seul platform.admin traverse les
// clients ; un centre orphelin (client_id vide) n'est traversable dans aucun
// sens. Le cloisonnement de la liste et celui des donnees disent desormais la
// meme chose, ce qui n'etait pas le cas : la liste cachait mi-12, l'API le
// servait.
//
// FAIL-CLOSED : si la relation centre -> client est illisible, on refuse. Ce
// n'est pas un arbitrage contre la disponibilite : la session elle-meme vient
// d'etre lue en base quelques lignes plus haut, donc une base muette a deja
// refuse la session avant d'arriver ici.
const CENTER_CLIENT_CACHE_TTL_MS = 60 * 1000;
let centerClientCache = { at: 0, map: null };

function normalizeCenterKey(value) {
  return String(value || '').trim().toLowerCase();
}

// Chemin CHAUD : cette resolution se fait sur chaque requete staff qui demande
// un centre autre que le sien. La relation centre -> client ne change qu'au
// provisioning d'un client (lib/platform-clients.js), donc un cache de 60 s
// coute au pire une minute de retard sur un rattachement, contre un aller-retour
// SQL par requete.
async function loadCenterClientMap() {
  const now = Date.now();
  if (centerClientCache.map && now - centerClientCache.at < CENTER_CLIENT_CACHE_TTL_MS) {
    return centerClientCache.map;
  }
  const result = await getPool().query("select id, coalesce(client_id, '') as client_id from centers;");
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(normalizeCenterKey(row.id), String(row.client_id || '').trim());
  }
  centerClientCache = { at: now, map };
  return map;
}

async function requestedCenterIsSameClient(sessionCenterId, requestedCenterId) {
  let map;
  try {
    map = await loadCenterClientMap();
  } catch (error) {
    return false;
  }
  const own = map.get(normalizeCenterKey(sessionCenterId));
  const wanted = map.get(normalizeCenterKey(requestedCenterId));
  // Centre inconnu de la base, ou orphelin des deux cotes : jamais traversable.
  if (!own || !wanted) return false;
  return own === wanted;
}

// Le centre `centerId` appartient-il a un AUTRE client que celui de la session ?
//
// Sert aux rares actions dont la CIBLE ne voyage PAS dans le scope de centre :
// `saveCenter` porte la sienne dans body.center.id et s'appelle avec
// { centerId: 'all' }, donc requireStaffPermission ne peut pas la voir. Le
// handler doit alors poser la question lui-meme.
//
// Un centre INCONNU de la base n'est pas "etranger" : c'est une CREATION
// (submitNewCenter, assets/app-main.js). On ne repond vrai que sur un centre
// qui EXISTE DEJA et appartient a quelqu'un d'autre. C'est la prise de controle
// qu'on interdit, pas la creation.
async function isCenterForeignToSession(session, centerId) {
  const wanted = normalizeCenterKey(centerId);
  if (!wanted) return false;
  if (sessionHasPermission(session, 'platform.admin')) return false;
  if (wanted === normalizeCenterKey(session && session.centerId)) return false;
  let map;
  try {
    map = await loadCenterClientMap();
  } catch (error) {
    return true;
  }
  if (!map.has(wanted)) return false;
  const own = map.get(normalizeCenterKey(session && session.centerId));
  const wantedClient = map.get(wanted);
  if (!own || !wantedClient) return true;
  return own !== wantedClient;
}

// ---- PP2 : le seul endroit du depot qui voit les REFUS ----------------------
//
// Sans cette instrumentation, la question "qu'est-ce qui a echoue, qu'est-ce
// qui a ete refuse" est structurellement irrepondable : les trois refus ci-
// dessous sont les seuls du controle d'acces, et ils repondaient jusqu'ici en
// silence. Un refus est le signal le plus interessant en securite, parce qu'il
// distingue une erreur de manipulation d'une tentative repetee.
//
// Ce garde est appele depuis ~20 sites sur 8 fichiers d'API. L'instrumenter ici
// couvre aussi tout futur endpoint qui l'utilisera.
//
// Regime NON BLOQUANT, volontairement : refuser de refuser parce que la trace
// ne s'ecrit pas transformerait une panne de journal en trou de securite (on
// laisserait passer). Un refus doit toujours refuser. L'echec de trace crie via
// le prefixe stable et le compteur de sante.
async function logAccessDenied(req, session, permission, reason, requestedCenterId) {
  // Require paresseux : lib/audit-log requiert lib/database, qui requiert
  // ce module dans certains chemins. Le charger au moment de l'appel evite un
  // cycle de require au chargement du processus.
  const { writeAuditLog, actorFromSession } = require('./audit-log');
  const actor = session
    ? actorFromSession(session)
    : { actorKind: 'public', actorMemberId: null, actorLabel: 'non authentifie', actorRoleId: null };
  let surface = '';
  try {
    surface = new URL(req.url, 'https://local').pathname;
  } catch (error) {
    surface = String(req.url || '').split('?')[0];
  }
  await writeAuditLog({
    // Un refus de scope centre se journalise dans le centre de la SESSION, pas
    // dans le centre demande : sinon la tentative d'intrusion apparaitrait dans
    // le journal de la victime et pas dans celui de l'auteur, et la directrice
    // du centre vise verrait une ligne qu'elle ne peut pas expliquer.
    centerId: (session && session.centerId) || 'libramont',
    ...actor,
    surface,
    action: 'accessDenied',
    method: String(req.method || ''),
    entityType: 'permission',
    entityId: Array.isArray(permission) ? permission.join('|') : String(permission || ''),
    outcome: 'denied',
    deniedReason: reason,
    context: {
      centreDemande: requestedCenterId || '',
      centreSession: (session && session.centerId) || '',
      permissionRequise: Array.isArray(permission) ? permission : [String(permission || '')],
    },
  });
}

async function requireStaffPermission(req, res, permission, options = {}) {
  const session = await getStaffSessionFromRequest(req);
  if (!session) {
    await logAccessDenied(req, null, permission, '401_no_session', getRequestedCenterId(req, options));
    sendError(res, 401, 'Session staff requise.');
    return null;
  }
  const requestedCenterId = getRequestedCenterId(req, options);
  const crossCenter = Boolean(requestedCenterId) && requestedCenterId !== session.centerId;
  if (crossCenter && !sessionHasPermission(session, 'centers.switch')) {
    // La tentative inter-centres. Un IDOR de ce type a deja ete corrige ici :
    // le refus existait, sa TRACE non. C'est desormais la ligne la plus
    // interessante du journal.
    await logAccessDenied(req, session, permission, '403_center_scope', requestedCenterId);
    sendError(res, 403, 'Acces centre insuffisant.');
    return null;
  }
  // Deuxieme barriere, INTER-CLIENTS : 'centers.switch' dit qu'on a le droit de
  // changer de centre, pas qu'on a le droit de changer de CLIENT.
  //
  // 'all' est volontairement hors de ce controle : ce n'est pas un centre mais
  // la portee plateforme (predicat neutre, voir centerScope dans api/ops.js).
  // Il ne designe le centre d'aucun client, il n'y a donc rien a comparer, et
  // le forcer dans ce test refuserait des actions de portee globale legitimes.
  if (
    crossCenter
    && requestedCenterId !== 'all'
    && !sessionHasPermission(session, 'platform.admin')
    && !(await requestedCenterIsSameClient(session.centerId, requestedCenterId))
  ) {
    // Motif DISTINCT de '403_center_scope', et c'est le but : une tentative
    // vers le centre d'un AUTRE CLIENT n'est pas une erreur de manipulation
    // interne, c'est la ligne la plus grave que ce journal puisse porter.
    await logAccessDenied(req, session, permission, '403_cross_client', requestedCenterId);
    sendError(res, 403, 'Acces centre insuffisant.');
    return null;
  }
  if (!sessionHasPermission(session, permission)) {
    await logAccessDenied(req, session, permission, '403_permission', requestedCenterId);
    sendError(res, 403, 'Permission insuffisante.');
    return null;
  }
  return {
    ...session,
    authorizedCenterId: requestedCenterId || session.centerId,
  };
}

function makeRoleId(name) {
  const slug = normalizeText(name, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `role-${Date.now().toString(36)}`;
}

async function createRole({ centerId = 'libramont', actorMemberId = '', name, permissions = [] }) {
  await ensureStaffAuthSchema();
  const safeName = normalizeText(name, '');
  if (!safeName) throw new Error('Nom de rôle manquant.');
  let roleId = makeRoleId(safeName);
  const exists = await getRole(centerId, roleId);
  if (exists) roleId = `${roleId}-${Date.now().toString(36)}`;
  const code = safeName.slice(0, 2).toUpperCase();
  const accessCode = createAccessCode(code);
  const result = await getPool().query(
    `
      insert into staff_roles (
        center_id, id, name, code, summary, description, tone,
        permissions, access_code_hash, access_code_hint, locked, access_code_enc
      ) values ($1,$2,$3,$4,$5,$6,'custom',$7::jsonb,$8,$9,false,$10)
      returning *;
    `,
    [
      centerId,
      roleId,
      safeName,
      code,
      'Rôle personnalisé',
      'Permissions à choisir manuellement.',
      JSON.stringify(safePermissions(stripPlatformPermissions(permissions.length ? permissions : ['dashboard.view', 'reservations.view']))),
      hashSecret(accessCode),
      codeHint(accessCode),
      encryptAccessCode(accessCode),
    ],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_created',
    label: `${safeName}: rôle créé`,
    payload: { roleId },
  });
  return { role: mapRole(result.rows[0], { accessCode }), accessCode };
}

// Renomme un role custom. Un role verrouille (Direction, proprietaire
// plateforme) refuse le renommage, comme il refuse l'edition de permissions :
// son nom fait partie de son identite systeme. Le code de role (badge 2
// lettres) et le code d'acces ne bougent pas, seul le libelle change. Borne le
// nom exactement comme createRole (normalizeText, non vide).
async function renameRole({ centerId = 'libramont', actorMemberId = '', roleId, name }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Role introuvable.');
  if (role.locked) throw new Error('Ce role systeme ne peut pas etre renomme.');
  const safeName = normalizeText(name, '');
  if (!safeName) throw new Error('Nom de role manquant.');
  const result = await getPool().query(
    `
      update staff_roles
      set name = $3
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, roleId, safeName],
  );
  if (!result.rowCount) throw new Error('Role introuvable.');
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_renamed',
    label: `${safeName}: role renomme`,
    payload: { roleId },
  });
  return mapRole(result.rows[0]);
}

// Supprime un role custom. Choix retenu : REFUS strict si le role porte encore
// des membres (voir plus bas), pas de reassignation silencieuse.
//
// Deux gardes serveur, dans cet ordre, AVANT toute ecriture :
//  1. role verrouille (Direction, proprietaire plateforme) : jamais supprimable.
//     C'est aussi ce qui rend la garde anti-lockout structurellement vraie pour
//     cette mutation : on ne peut pas supprimer le role qui porte la Direction,
//     donc supprimer un role ne peut jamais retirer le dernier responsable.
//  2. presence de membres : la FK staff_members(center_id, role_id) est
//     ON DELETE RESTRICT. On compte TOUS les membres du role (tout statut,
//     y compris bloques et le membre "code de role partage") : un seul restant
//     ferait echouer le DELETE au niveau base avec une erreur opaque. On refuse
//     proprement en amont avec le nombre a reassigner. Aucun membre orphelin,
//     aucune FK cassee.
async function deleteRole({ centerId = 'libramont', actorMemberId = '', roleId }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Role introuvable.');
  if (role.locked) throw new Error('Ce role systeme ne peut pas etre supprime.');
  const countResult = await getPool().query(
    'select count(*)::int as n from staff_members where center_id = $1 and role_id = $2;',
    [normalizeStaffCenterId(centerId), normalizeText(roleId, '')],
  );
  const memberCount = countResult.rows[0] ? Number(countResult.rows[0].n) : 0;
  if (memberCount > 0) {
    throw lockoutError(`Reassignez d'abord les ${memberCount} membre(s) de ce role avant de le supprimer.`);
  }
  const result = await getPool().query(
    'delete from staff_roles where center_id = $1 and id = $2 returning *;',
    [centerId, roleId],
  );
  if (!result.rowCount) throw new Error('Role introuvable.');
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_deleted',
    label: `${role.name}: role supprime`,
    payload: { roleId },
  });
  return mapRole(result.rows[0]);
}

async function updateRolePermissions({ centerId = 'libramont', actorMemberId = '', roleId, permissions }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
  if (role.locked) throw new Error('La direction garde tous les accès.');
  const result = await getPool().query(
    `
      update staff_roles
      set permissions = $3::jsonb
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, roleId, JSON.stringify(safePermissions(stripPlatformPermissions(permissions)))],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_permissions_updated',
    label: `${role.name}: permissions mises à jour`,
    payload: { roleId, permissions: safePermissions(stripPlatformPermissions(permissions)) },
  });
  return mapRole(result.rows[0]);
}

async function setRolePreset({ centerId = 'libramont', actorMemberId = '', roleId, presetId }) {
  const preset = STAFF_ROLE_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error('Preset introuvable.');
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
  if (role.locked) throw new Error('La direction garde tous les accès.');
  const result = await getPool().query(
    `
      update staff_roles
      set permissions = $3::jsonb,
          summary = $4,
          description = $5,
          tone = $6
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, roleId, JSON.stringify(safePermissions(preset.permissions)), preset.summary, preset.description, preset.tone],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_preset_applied',
    label: `${role.name}: preset ${preset.name} appliqué`,
    payload: { roleId, presetId },
  });
  return mapRole(result.rows[0]);
}

async function regenerateRoleCode({ centerId = 'libramont', actorMemberId = '', roleId }) {
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
  const accessCode = createAccessCode(role.code || role.name);
  const result = await getPool().query(
    `
      update staff_roles
      set access_code_hash = $3,
          access_code_hint = $4,
          access_code_enc = $5
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, roleId, hashSecret(accessCode), codeHint(accessCode), encryptAccessCode(accessCode)],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_code_regenerated',
    label: `${role.name}: code rôle régénéré`,
    payload: { roleId },
  });
  return { role: mapRole(result.rows[0], { accessCode }), accessCode };
}

// Révèle le code d'accès ACTUEL d'un rôle (déchiffrement AES-256-GCM) sans le
// régénérer. Le code en clair n'est renvoyé QUE dans la valeur de retour de
// cette fonction (jamais loggé, jamais persisté). L'appelant (api/staff-auth)
// est déjà gated à `users.manage` (Direction / Propriétaire plateforme).
async function revealRoleCode({ centerId = 'libramont', actorMemberId = '', roleId }) {
  await ensureStaffAuthSchema();
  const safeCenterId = normalizeStaffCenterId(centerId);
  const result = await getPool().query(
    'select access_code_enc from staff_roles where center_id = $1 and id = $2 limit 1;',
    [safeCenterId, normalizeText(roleId, '')],
  );
  if (!result.rows[0]) throw new Error('Rôle introuvable.');
  const code = decryptAccessCode(result.rows[0].access_code_enc);
  if (!code) return { code: '', needsRegenerate: true };
  // Trace d'audit : QUI a révélé QUEL code, sans jamais inclure le code.
  await addAccessEvent({
    centerId: safeCenterId,
    actorMemberId,
    eventType: 'role_code_revealed',
    label: 'Code rôle copié',
    payload: { roleId },
  });
  return { code, needsRegenerate: false };
}

async function revealMemberCode({ centerId = 'libramont', actorMemberId = '', memberId }) {
  await ensureStaffAuthSchema();
  const safeCenterId = normalizeStaffCenterId(centerId);
  const result = await getPool().query(
    'select access_code_enc from staff_members where center_id = $1 and id = $2 limit 1;',
    [safeCenterId, normalizeText(memberId, '')],
  );
  if (!result.rows[0]) throw new Error('Membre introuvable.');
  const code = decryptAccessCode(result.rows[0].access_code_enc);
  if (!code) return { code: '', needsRegenerate: true };
  await addAccessEvent({
    centerId: safeCenterId,
    actorMemberId,
    eventType: 'member_code_revealed',
    label: 'Code membre copié',
    payload: { memberId },
  });
  return { code, needsRegenerate: false };
}

async function createMember({ centerId = 'libramont', actorMemberId = '', name, contact = '', roleId = 'staff-bar' }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
  const safeName = normalizeText(name, '');
  if (!safeName) throw new Error('Nom du membre manquant.');
  const memberId = `${centerId}:member:${Date.now().toString(36)}:${crypto.randomBytes(2).toString('hex')}`;
  const accessCode = createAccessCode(role.code || 'FG');
  const result = await getPool().query(
    `
      insert into staff_members (
        id, center_id, name, contact, role_id, status, access_code_hash, access_code_hint, access_code_enc
      ) values ($1,$2,$3,$4,$5,'pending',$6,$7,$8)
      returning *;
    `,
    [memberId, centerId, safeName, normalizeText(contact, ''), roleId, hashSecret(accessCode), codeHint(accessCode), encryptAccessCode(accessCode)],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'member_created',
    label: `${safeName}: accès créé`,
    payload: { memberId, roleId },
  });
  return { member: mapMember(result.rows[0], { code: accessCode, accessCode }), accessCode };
}

// ---- Gardes anti-lockout (cote serveur) -----------------------------------
//
// Deux invariants protegent l'administration d'un centre. Ils s'appliquent aux
// mutations qui peuvent retirer un acces : updateMemberRole (retrogradation),
// toggleMemberStatus (blocage), deleteMember (suppression). deleteRole les
// respecte structurellement (il refuse les roles verrouilles, donc ne peut pas
// retirer la Direction). Aucune mutation ne part si une garde saute.
//
//  G1 - dernier responsable : au moins un membre ACTIF porteur d'un role
//       VERROUILLE (Direction / tous droits du centre) doit toujours rester.
//       Un role verrouille confere users.manage : si le compte tombe a zero,
//       plus personne ne peut administrer le centre (lockout).
//  G2 - auto-lockout : un membre ne peut pas se bloquer, se retrograder ni se
//       supprimer lui-meme. actorMemberId = membre de la session (l'API passe
//       session.member.id). Comparaison stricte, active seulement si les deux
//       identifiants sont non vides.

function lockoutError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.expose = true;
  return error;
}

function assertNotSelfTarget(actorMemberId, memberId, verb) {
  if (actorMemberId && memberId && String(actorMemberId) === String(memberId)) {
    throw lockoutError(`Vous ne pouvez pas vous ${verb} vous-meme.`);
  }
}

// Compte les membres ACTIFS porteurs d'un role verrouille sur un centre. C'est
// la mesure de l'invariant G1 : elle ne doit jamais tomber a zero par blocage,
// retrogradation ou suppression.
async function countActiveLockedMembers(centerId) {
  const result = await getPool().query(
    `
      select count(*)::int as n
      from staff_members m
      join staff_roles r on r.center_id = m.center_id and r.id = m.role_id
      where m.center_id = $1 and m.status = 'active' and r.locked = true;
    `,
    [normalizeStaffCenterId(centerId)],
  );
  return result.rows[0] ? Number(result.rows[0].n) : 0;
}

// G1 applique a un membre precis. Ne mord que si ce membre est ACTUELLEMENT un
// responsable actif (statut actif + role verrouille) : le retirer ferait
// baisser le compte, donc on refuse s'il est le dernier. Un membre bloque ou
// non verrouille sort tot (retirer un tel membre ne touche pas le compte).
async function assertNotLastActiveLocked(centerId, memberSnapshot) {
  if (!memberSnapshot || memberSnapshot.status !== 'active') return;
  const memberRole = await getRole(centerId, memberSnapshot.roleId);
  if (!memberRole || !memberRole.locked) return;
  const activeLocked = await countActiveLockedMembers(centerId);
  if (activeLocked <= 1) {
    throw lockoutError('Au moins un responsable Direction actif doit rester sur ce centre.');
  }
}

async function updateMemberRole({ centerId = 'libramont', actorMemberId = '', memberId, roleId }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
  // Anti-escalade centre -> plateforme, symetrique de stripPlatformPermissions
  // (ecriture de roles). Le durcissement des ecritures interdit de FABRIQUER un
  // role porteur de platform.admin ; ici on interdit d'ASSIGNER un role qui en
  // porte deja un (platform-owner est seede par centre). Sans ce refus, un
  // porteur de users.manage attribuerait platform-owner a un membre qu'il
  // controle et ouvrirait le cockpit fondateur (tous centres, couts, prospects).
  // La seule entree legitime dans platform.admin reste le code membre seede.
  if (platformPermissionsOf(role.permissions || []).length > 0) {
    const error = new Error('Ce rôle ne peut pas être attribué.');
    error.statusCode = 403;
    error.expose = true;
    throw error;
  }
  // G2 : un membre ne peut pas se retrograder (ni se re-roler) lui-meme. Barre
  // aussi l'auto-promotion d'un porteur de users.manage vers un role qu'il ne
  // detient pas. Aucune ecriture avant cette barriere.
  assertNotSelfTarget(actorMemberId, memberId, 'retrograder');
  // G1 : si on envoie ce membre vers un role NON verrouille et qu'il est le
  // dernier responsable actif, refuser. Un role verrouille en cible ne baisse
  // pas le compte : on ne verifie donc que les retrogradations. Best-effort :
  // si le membre est introuvable, le snapshot est null et l'UPDATE ci-dessous
  // rejette deja (rowCount 0 -> 'Membre introuvable') ; aucune retrogradation
  // fantome ne passe, on ne garde que ce qu'on peut lire.
  const current = await getAuditSubjectSnapshot({ centerId, memberId });
  if (current && !role.locked) {
    await assertNotLastActiveLocked(centerId, current);
  }
  const accessCode = createAccessCode(role.code || 'FG');
  const result = await getPool().query(
    `
      update staff_members
      set role_id = $3,
          status = case when status = 'blocked' then 'blocked' else 'pending' end,
          access_code_hash = $4,
          access_code_hint = $5,
          access_code_enc = $6
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, memberId, roleId, hashSecret(accessCode), codeHint(accessCode), encryptAccessCode(accessCode)],
  );
  if (!result.rowCount) throw new Error('Membre introuvable.');
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'member_role_updated',
    label: `${result.rows[0].name}: rôle changé`,
    payload: { memberId, roleId },
  });
  return { member: mapMember(result.rows[0], { code: accessCode, accessCode }), accessCode };
}

async function toggleMemberStatus({ centerId = 'libramont', actorMemberId = '', memberId }) {
  await ensureStaffAuthSchema();
  const current = await getAuditSubjectSnapshot({ centerId, memberId });
  if (!current) throw new Error('Membre introuvable.');
  // G2 : pas d'auto-blocage. G1 : ne pas bloquer le dernier responsable actif
  // (assertNotLastActiveLocked sort tot si le membre est deja bloque, donc le
  // deblocage passe toujours). Aucune ecriture avant ces gardes.
  assertNotSelfTarget(actorMemberId, memberId, 'bloquer');
  await assertNotLastActiveLocked(centerId, current);
  const result = await getPool().query(
    `
      update staff_members
      set status = case when status = 'blocked' then 'active' else 'blocked' end
      where center_id = $1 and id = $2
      returning *;
    `,
    [centerId, memberId],
  );
  if (!result.rowCount) throw new Error('Membre introuvable.');
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'member_status_toggled',
    label: `${result.rows[0].name}: ${result.rows[0].status === 'blocked' ? 'bloqué' : 'activé'}`,
    payload: { memberId, status: result.rows[0].status },
  });
  return mapMember(result.rows[0]);
}

// Suppression reelle d'un membre (la ligne staff_members disparait). Gardes
// serveur AVANT toute ecriture : G2 (pas d'auto-suppression) et G1 (ne pas
// supprimer le dernier responsable actif). On invalide d'abord ses sessions :
// la FK staff_sessions.member_id est ON DELETE CASCADE et suffirait, mais le
// DELETE explicite rend l'invalidation visible et testable, et ne laisse aucune
// session pendante meme si le schema evoluait.
async function deleteMember({ centerId = 'libramont', actorMemberId = '', memberId }) {
  await ensureStaffAuthSchema();
  const current = await getAuditSubjectSnapshot({ centerId, memberId });
  if (!current) throw new Error('Membre introuvable.');
  assertNotSelfTarget(actorMemberId, memberId, 'supprimer');
  await assertNotLastActiveLocked(centerId, current);
  await getPool().query('delete from staff_sessions where member_id = $1;', [memberId]);
  const result = await getPool().query(
    'delete from staff_members where center_id = $1 and id = $2 returning *;',
    [centerId, memberId],
  );
  if (!result.rowCount) throw new Error('Membre introuvable.');
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'member_deleted',
    label: `${result.rows[0].name}: acces supprime`,
    payload: { memberId },
  });
  return mapMember(result.rows[0]);
}

async function logoutStaff(token) {
  if (!token) return;
  if (decodeEmergencyToken(token)) return;
  await ensureStaffAuthSchema();
  await getPool().query('delete from staff_sessions where token_hash = $1;', [hashSecret(token)]);
}

module.exports = {
  ALL_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PLATFORM_OWNER_ROLE,
  STAFF_PERMISSION_GROUPS,
  PERMISSION_PARENTS,
  permissionChildren,
  permissionAncestors,
  normalizePermissionHierarchy,
  STAFF_ROLE_PRESETS,
  STAFF_SESSION_COOKIE,
  createEmergencyAccessControl,
  createEmergencyOwnerSession,
  normalizeStaffCenterId,
  createMember,
  createRole,
  renameRole,
  deleteRole,
  deleteMember,
  getAuditSubjectSnapshot,
  getStaffSessionFromRequest,
  getStaffSessionFromToken,
  listAccessControl,
  ensurePlatformOwnerAccess,
  loginStaffByCode,
  logoutStaff,
  regenerateRoleCode,
  revealRoleCode,
  revealMemberCode,
  requireStaffPermission,
  isCenterForeignToSession,
  sessionHasPermission,
  isStaffAuthStorageError,
  publicStorageErrorMessage,
  setRolePreset,
  toggleMemberStatus,
  updateMemberRole,
  updateRolePermissions,
  __test: {
    allowDevelopmentFallbacks,
    isPlatformPermission,
    stripPlatformPermissions,
    platformPermissionsOf,
    encryptAccessCode,
    decryptAccessCode,
    deriveAccessCodeKey,
    getAuthSecret,
    getDirectionCode,
    getPlatformOwnerCode,
    createEmergencyOwnerSession,
    decodeEmergencyToken,
    isStaffAuthStorageError,
    isProductionRuntime,
    normalizeStaffCenterId,
    readCookieValue,
    readSessionToken,
  },
};
