const assert = require('assert');

const staffAuth = require('../lib/staff-auth').__test;

const ENV_KEYS = [
  'ALLOW_INSECURE_STAFF_CODES',
  'DATABASE_URL',
  'DIRECTOR_PASSWORD',
  'NODE_ENV',
  'PLATFORM_OWNER_CODE',
  'SITE_PASSWORD',
  'STAFF_AUTH_SECRET',
  'STAFF_DIRECTION_CODE',
  'STAFF_OWNER_CODE',
  'VERCEL',
  'VERCEL_ENV',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

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
  resetEnv({ NODE_ENV: 'development' });
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

  console.log('security-config-tests-ok');
} finally {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
