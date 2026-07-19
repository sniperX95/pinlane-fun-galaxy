const assert = require('assert');
const fs = require('fs');
const path = require('path');

const http = require('../lib/http').__test;
const staffAuth = require('../lib/staff-auth').__test;

const ENV_KEYS = [
  'ALLOW_INSECURE_STAFF_CODES',
  'DATABASE_URL',
  'DIRECTOR_PASSWORD',
  'NODE_ENV',
  'PLATFORM_OWNER_CODE',
  'PUBLIC_FORM_ORIGIN',
  'SITE_PASSWORD',
  'STAFF_AUTH_SECRET',
  'STAFF_DIRECTION_CODE',
  'STAFF_OWNER_CODE',
  'VERCEL',
  'VERCEL_ENV',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function readProjectFile(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

// Decoupe le bloc d'UNE fonction (du header jusqu'a l'accolade fermante en
// colonne 0) pour borner les assertions statiques : on ne veut surtout pas
// matcher n'importe quel === ailleurs dans le fichier.
function extractBlock(source, header, label) {
  const start = source.indexOf(header);
  assert.ok(start > -1, `${label} : bloc introuvable (${header})`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${label} : fin de bloc introuvable`);
  return source.slice(start, end + 2);
}

function resetEnv(values = {}) {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

function assertThrowsMessage(fn, pattern, label) {
  assert.throws(fn, (error) => {
    assert.match(error.message, pattern, label);
    assert.strictEqual(error.statusCode, 500, `${label} should be a server config failure`);
    return true;
  });
}

try {
  // Secure by default: a dev environment without the explicit opt-in flag must
  // NOT enable fallbacks or hand out the demo codes.
  resetEnv({ NODE_ENV: 'development' });
  assert.strictEqual(staffAuth.isProductionRuntime(), false);
  assert.strictEqual(staffAuth.allowDevelopmentFallbacks(), false, 'dev fallbacks must be opt-in');
  assertThrowsMessage(() => staffAuth.getPlatformOwnerCode(), /manquant/i, 'owner code needs opt-in or real secret');

  // Explicit opt-in re-enables the local demo codes.
  resetEnv({ NODE_ENV: 'development', ALLOW_INSECURE_STAFF_CODES: 'true' });
  assert.strictEqual(staffAuth.isProductionRuntime(), false);
  assert.strictEqual(staffAuth.allowDevelopmentFallbacks(), true);
  assert.strictEqual(staffAuth.getDirectionCode(), 'SESSION-DIRECTION');
  assert.strictEqual(staffAuth.getPlatformOwnerCode(), 'pinlane-owner-demo-code');
  assert.strictEqual(staffAuth.normalizeStaffCenterId('Fun Galaxy Centre'), 'libramont');
  assert.strictEqual(staffAuth.normalizeStaffCenterId('fun galaxy center'), 'libramont');
  assert.strictEqual(staffAuth.normalizeStaffCenterId('Fun Galaxy Gembloux'), 'gembloux');
  assert.strictEqual(staffAuth.normalizeStaffCenterId('Ciney'), 'ciney');
  assert.strictEqual(
    staffAuth.readSessionToken({ headers: { cookie: 'pinlane_staff_session=fgs_cookie_token' } }),
    'fgs_cookie_token',
  );
  assert.strictEqual(
    staffAuth.readSessionToken({
      headers: {
        cookie: 'pinlane_staff_session=fgs_cookie_token',
        'x-staff-session': 'fgs_header_token',
      },
    }),
    'fgs_header_token',
  );

  resetEnv({ PUBLIC_FORM_ORIGIN: 'https://fungalaxy.be' });
  assert.strictEqual(http.getAllowedOrigin('https://fungalaxy.be'), 'https://fungalaxy.be');
  assert.strictEqual(http.getAllowedOrigin('https://www.fungalaxy.be'), 'https://www.fungalaxy.be');
  assert.strictEqual(http.getAllowedOrigin('https://www.mngfunglxy.com'), 'https://www.mngfunglxy.com');
  assert.strictEqual(http.getAllowedOrigin('https://mngfunglxy.com'), 'https://mngfunglxy.com');
  assert.strictEqual(http.getAllowedOrigin('https://unknown.example'), 'https://fungalaxy.be');

  resetEnv({ NODE_ENV: 'production', ALLOW_INSECURE_STAFF_CODES: 'true' });
  assert.strictEqual(staffAuth.isProductionRuntime(), true);
  assert.strictEqual(staffAuth.allowDevelopmentFallbacks(), false, 'production must never enable fallback staff codes');
  assertThrowsMessage(() => staffAuth.getDirectionCode(), /manquant en production/i, 'missing direction code');
  assertThrowsMessage(() => staffAuth.getPlatformOwnerCode(), /manquant en production/i, 'missing owner code');
  assertThrowsMessage(() => staffAuth.getAuthSecret(), /manquant en production/i, 'missing auth secret');

  resetEnv({
    NODE_ENV: 'production',
    STAFF_AUTH_SECRET: 'change-me',
    STAFF_DIRECTION_CODE: 'SESSION-DIRECTION',
    PLATFORM_OWNER_CODE: 'PINLANE-OWNER',
  });
  assertThrowsMessage(() => staffAuth.getAuthSecret(), /interdite en production/i, 'weak auth secret');
  assertThrowsMessage(() => staffAuth.getDirectionCode(), /interdite en production/i, 'default direction code');
  assertThrowsMessage(() => staffAuth.getPlatformOwnerCode(), /interdite en production/i, 'default owner code');

  resetEnv({
    NODE_ENV: 'production',
    STAFF_AUTH_SECRET: 'staff-auth-secret-64-chars-local-test-value',
    STAFF_DIRECTION_CODE: 'direction-access-code-local-test',
    PLATFORM_OWNER_CODE: 'owner-access-code-local-test',
  });
  assert.strictEqual(staffAuth.getAuthSecret(), 'staff-auth-secret-64-chars-local-test-value');
  assert.strictEqual(staffAuth.getDirectionCode(), 'direction-access-code-local-test');
  assert.strictEqual(staffAuth.getPlatformOwnerCode(), 'owner-access-code-local-test');
  const emergency = staffAuth.createEmergencyOwnerSession({
    centerId: 'Fun Galaxy Gembloux',
    code: 'owner-access-code-local-test',
  });
  assert.ok(emergency.session.token.startsWith('fgs_emergency_'), 'emergency session token should be namespaced');
  assert.strictEqual(emergency.session.centerId, 'gembloux');
  assert.strictEqual(emergency.session.role.locked, true);
  assert.strictEqual(emergency.accessControl.emergency, true);
  assert.strictEqual(staffAuth.decodeEmergencyToken(emergency.session.token).centerId, 'gembloux');
  assert.strictEqual(
    staffAuth.createEmergencyOwnerSession({ centerId: 'libramont', code: 'wrong-owner-code-local-test' }),
    null,
  );

  const staffReservationsSource = readProjectFile('api/staff-reservations.js');
  assert.match(
    staffReservationsSource,
    /getReservationById\(body\.id\)/,
    'staff reservation patch/delete must load the real reservation before authorizing',
  );
  assert.match(
    staffReservationsSource,
    /requireStaffPermission\(req,\s*res,\s*permission,\s*\{\s*centerId:\s*current\.centerId/s,
    'staff reservation patch must authorize against the stored reservation center',
  );
  assert.doesNotMatch(
    staffReservationsSource,
    /requireStaffPermission\(req,\s*res,\s*permission,\s*\{\s*centerId:\s*body\.centerId/s,
    'staff reservation patch must not trust a user-supplied centerId',
  );
  assert.match(
    staffReservationsSource,
    /cancelReservationCommunications/,
    'reservation updates/deletes must cancel stale communications',
  );
  assert.match(
    staffReservationsSource,
    /cancelReservationOpsJobs/,
    'reservation updates/deletes must cancel stale automation jobs',
  );

  const opsSource = readProjectFile('api/ops.js');
  assert.match(
    opsSource,
    /const reservation\s*=\s*await getReservationById\(reservationId\)/,
    'delay impact/apply must reload the real reservation',
  );
  assert.match(
    opsSource,
    /const impact\s*=\s*computeDelayImpact\(\{[\s\S]{0,200}reservationId,[\s\S]{0,200}\}, context\);\s*const strategyId/,
    'delay apply must recompute the impact server-side, never trust a client-provided plan',
  );
  assert.match(
    opsSource,
    /requireStaffPermission\(req,\s*res,\s*\['reservations\.edit',\s*'planning\.drag'\]/,
    'delay apply must require edit/drag permission',
  );
  assert.match(
    opsSource,
    /cancelReservationCommunications/,
    'delay apply must cancel stale communications before scheduling new ones',
  );

  // --- Chiffrement réversible des codes d'accès (copie sans régénération) -----
  resetEnv({
    NODE_ENV: 'production',
    STAFF_AUTH_SECRET: 'staff-auth-secret-64-chars-local-test-value',
    STAFF_DIRECTION_CODE: 'direction-access-code-local-test',
    PLATFORM_OWNER_CODE: 'owner-access-code-local-test',
  });
  const plainCode = 'FG-A1B2-C3D4';
  const cipher = staffAuth.encryptAccessCode(plainCode);
  assert.ok(cipher && cipher.length > 0, 'access code must be encrypted at rest');
  assert.ok(!cipher.includes(plainCode), 'ciphertext must NOT contain the plaintext access code');
  assert.strictEqual(staffAuth.decryptAccessCode(cipher), plainCode, 'authorized reveal must round-trip to the real code');
  assert.strictEqual(staffAuth.deriveAccessCodeKey().length, 32, 'AES-256 key must be 32 bytes');
  assert.notStrictEqual(staffAuth.encryptAccessCode(plainCode), cipher, 'random IV must make each ciphertext unique');
  const tampered = Buffer.from(cipher, 'base64');
  tampered[tampered.length - 1] ^= 0xff;
  assert.strictEqual(staffAuth.decryptAccessCode(tampered.toString('base64')), '', 'GCM auth tag must reject tampered ciphertext');
  assert.strictEqual(staffAuth.encryptAccessCode(''), '', 'empty code must not produce ciphertext');
  // Rotation du secret => anciens ciphertexts illisibles (fail-secure).
  resetEnv({
    NODE_ENV: 'production',
    STAFF_AUTH_SECRET: 'rotated-staff-auth-secret-different-value',
    STAFF_DIRECTION_CODE: 'direction-access-code-local-test',
    PLATFORM_OWNER_CODE: 'owner-access-code-local-test',
  });
  assert.strictEqual(staffAuth.decryptAccessCode(cipher), '', 'ciphertext must not decrypt under a rotated secret');

  const staffAuthLibSource = readProjectFile('lib/staff-auth.js');
  assert.match(
    staffAuthLibSource,
    /return safeTimingEqual\(hashSecret\(input\), hashSecret\(expected\)\)/,
    'login verification must keep using the SHA-256 hash (unchanged authority)',
  );
  assert.match(
    staffAuthLibSource,
    /access_code_enc = \$5[\s\S]{0,200}encryptAccessCode\(accessCode\)/,
    'regenerateRoleCode must persist the encrypted code',
  );
  const staffAuthApiSource = readProjectFile('api/staff-auth.js');
  const revealIndex = staffAuthApiSource.indexOf("action === 'revealRoleCode'");
  const gateIndex = staffAuthApiSource.indexOf("requireStaffPermission(req, res, 'users.manage'");
  assert.ok(revealIndex > -1, 'revealRoleCode action must exist');
  assert.ok(gateIndex > -1 && gateIndex < revealIndex, 'reveal actions must be gated behind users.manage');
  assert.doesNotMatch(
    staffAuthLibSource,
    /addAccessEvent\([^)]*payload:\s*\{[^}]*code[^}]*\}/,
    'revealed access codes must never be written to the audit event payload',
  );

  // --- Comparaisons de secrets a temps constant (P2-9) ------------------------
  // Un === sur un secret fuit un signal de timing proportionnel au prefixe
  // correct. Le Basic Auth du middleware protege TOUT le site : c'est la
  // comparaison la plus exposee du projet.
  const middlewareSource = readProjectFile('middleware.ts');

  // Le middleware tourne sur le runtime Edge : node:crypto n'y est pas garanti.
  assert.doesNotMatch(
    middlewareSource,
    /require\(['"](node:)?crypto['"]\)|from\s+['"](node:)?crypto['"]/,
    'le middleware Edge ne doit jamais importer node:crypto',
  );

  const middlewareCompare = extractBlock(
    middlewareSource,
    'async function timingSafeEqualText',
    'middleware.ts timingSafeEqualText',
  );
  assert.match(
    middlewareCompare,
    /crypto\.subtle\.digest\('SHA-256'/,
    'la comparaison Edge doit passer par des empreintes SHA-256 de longueur fixe',
  );
  assert.match(
    middlewareCompare,
    /diff \|= leftBytes\[index\] \^ rightBytes\[index\]/,
    'la comparaison Edge doit accumuler un XOR sur toute la longueur',
  );
  assert.doesNotMatch(
    middlewareCompare,
    /break|return false/,
    'la boucle de comparaison ne doit jamais court-circuiter',
  );

  const credentialsBlock = extractBlock(
    middlewareSource,
    'async function credentialsMatch',
    'middleware.ts credentialsMatch',
  );
  assert.doesNotMatch(
    credentialsBlock,
    /credentials\.(username|password)\s*===/,
    'le Basic Auth ne doit plus comparer les identifiants avec ===',
  );
  assert.match(
    credentialsBlock,
    /timingSafeEqualText\(credentials\.username, username\)/,
    'le nom d utilisateur doit passer par la primitive a temps constant',
  );
  assert.match(
    credentialsBlock,
    /timingSafeEqualText\(credentials\.password, password\)/,
    'le mot de passe doit passer par la primitive a temps constant',
  );

  assert.doesNotMatch(
    middlewareSource,
    /get\('authorization'\)\s*===\s*`Bearer/,
    'le Bearer cron du middleware ne doit plus etre compare avec ===',
  );
  assert.match(
    middlewareSource,
    /timingSafeEqualText\(request\.headers\.get\('authorization'\) \|\| '', `Bearer \$\{cronSecret\}`\)/,
    'le Bearer cron du middleware doit passer par la primitive a temps constant',
  );

  const cronSource = readProjectFile('api/cron.js');
  const cronAuthBlock = extractBlock(cronSource, 'function isAuthorized(req)', 'api/cron.js isAuthorized');
  assert.doesNotMatch(
    cronAuthBlock,
    /===\s*`Bearer/,
    'le Bearer cron ne doit plus etre compare avec ===',
  );
  assert.match(
    cronAuthBlock,
    /timingSafeEqualText\(req\.headers\.authorization \|\| '', `Bearer \$\{expected\}`\)/,
    'le Bearer cron doit passer par la primitive a temps constant',
  );

  const cronCompare = extractBlock(
    cronSource,
    'function timingSafeEqualText(left, right)',
    'api/cron.js timingSafeEqualText',
  );
  assert.match(
    cronCompare,
    /crypto\.timingSafeEqual\(leftDigest, rightDigest\)/,
    'le cron Node doit utiliser crypto.timingSafeEqual',
  );
  assert.match(
    cronCompare,
    /createHash\('sha256'\)[\s\S]{0,200}createHash\('sha256'\)/,
    'les deux cotes doivent etre haches pour obtenir une longueur fixe',
  );
  assert.doesNotMatch(
    cronCompare,
    /\.length\s*!==/,
    'aucun court-circuit sur la longueur : timingSafeEqual leverait et refuirait la taille du secret',
  );

  console.log('security-config-tests-ok');
} finally {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
