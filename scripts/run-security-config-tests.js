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
    /currentReservation\s*=\s*await getReservationById\(reservationId\)/,
    'delay apply must reload the real reservation',
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

  console.log('security-config-tests-ok');
} finally {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
