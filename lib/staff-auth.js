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
    permissions: ALL_PERMISSIONS,
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
  const allowed = new Set(ALL_PERMISSIONS);
  return [...new Set((Array.isArray(permissions) ? permissions : []).filter((item) => allowed.has(item)))];
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

async function bootstrapCenterAccess(centerId = 'libramont') {
  centerId = normalizeStaffCenterId(centerId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const directionCode = getDirectionCode();
    const platformOwnerCode = getPlatformOwnerCode();
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

    const platformOwnerMemberId = `${centerId}:platform-owner`;
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
        platformOwnerMemberId,
        centerId,
        'Proprietaire plateforme',
        'Acces Pinlane',
        'direction',
        hashSecret(platformOwnerCode),
        codeHint(platformOwnerCode),
        encryptAccessCode(platformOwnerCode),
      ],
    );
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

async function findLoginSubject(centerId, code) {
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
  const sessionToken = await createSessionForMember(safeCenterId, subject.member.id);
  await getPool().query('update staff_members set status = $2, last_seen = now() where id = $1;', [
    subject.member.id,
    subject.member.status === 'pending' ? 'active' : subject.member.status,
  ]);
  await addAccessEvent({
    centerId: safeCenterId,
    actorMemberId: subject.member.id,
    eventType: 'login_success',
    label: `${subject.member.name} connecté`,
  }).catch(() => null);
  clearLoginFailures(safeCenterId, safeFingerprint);
  const session = await getStaffSessionFromToken(sessionToken.token);
  return { session, accessControl: await listAccessControl(safeCenterId) };
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
  const permissions = row.locked ? ALL_PERMISSIONS : safePermissions(row.permissions || []);
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
  if (session.role?.locked) return true;
  if (Array.isArray(permission)) {
    return permission.some((item) => session.permissions.includes(item));
  }
  return session.permissions.includes(permission);
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
  if (
    requestedCenterId
    && requestedCenterId !== session.centerId
    && !sessionHasPermission(session, 'centers.switch')
  ) {
    // La tentative inter-centres. Un IDOR de ce type a deja ete corrige ici :
    // le refus existait, sa TRACE non. C'est desormais la ligne la plus
    // interessante du journal.
    await logAccessDenied(req, session, permission, '403_center_scope', requestedCenterId);
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
      JSON.stringify(safePermissions(permissions.length ? permissions : ['dashboard.view', 'reservations.view'])),
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
    [centerId, roleId, JSON.stringify(safePermissions(permissions))],
  );
  await addAccessEvent({
    centerId,
    actorMemberId,
    eventType: 'role_permissions_updated',
    label: `${role.name}: permissions mises à jour`,
    payload: { roleId, permissions: safePermissions(permissions) },
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

async function updateMemberRole({ centerId = 'libramont', actorMemberId = '', memberId, roleId }) {
  await ensureStaffAuthSchema();
  const role = await getRole(centerId, roleId);
  if (!role) throw new Error('Rôle introuvable.');
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

async function logoutStaff(token) {
  if (!token) return;
  if (decodeEmergencyToken(token)) return;
  await ensureStaffAuthSchema();
  await getPool().query('delete from staff_sessions where token_hash = $1;', [hashSecret(token)]);
}

module.exports = {
  ALL_PERMISSIONS,
  STAFF_PERMISSION_GROUPS,
  STAFF_ROLE_PRESETS,
  STAFF_SESSION_COOKIE,
  createEmergencyAccessControl,
  createEmergencyOwnerSession,
  normalizeStaffCenterId,
  createMember,
  createRole,
  getAuditSubjectSnapshot,
  getStaffSessionFromRequest,
  getStaffSessionFromToken,
  listAccessControl,
  loginStaffByCode,
  logoutStaff,
  regenerateRoleCode,
  revealRoleCode,
  revealMemberCode,
  requireStaffPermission,
  sessionHasPermission,
  isStaffAuthStorageError,
  publicStorageErrorMessage,
  setRolePreset,
  toggleMemberStatus,
  updateMemberRole,
  updateRolePermissions,
  __test: {
    allowDevelopmentFallbacks,
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
