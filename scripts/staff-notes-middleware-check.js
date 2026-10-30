'use strict';
// Real middleware + real endpoint, synthetic database only. No network or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks += 1; console.log('PASS ' + label); }
function loadMiddleware(env) {
  const filename = path.join(root, 'middleware.ts');
  const code = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const sandbox = { module: { exports: {} }, exports: {}, process: { env }, URL, Request, Response, Headers,
    TextEncoder, crypto: global.crypto, atob, require: name => name === '@vercel/functions'
      ? require('@vercel/functions/middleware') : createRequire(filename)(name) };
  vm.runInNewContext(code, sandbox, { filename });
  return sandbox.module.exports.default;
}
let reads = 0;
class FakePool { async query(sql) { if (/\bselect\b/i.test(sql)) reads += 1; return { rows: [], rowCount: 0 }; } }
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = 'postgres://synthetic/notes_auth';
const endpoint = require('../api/staff-customer-notes');
async function unauthenticated(method, query) {
  const body = method === 'PATCH' ? JSON.stringify({ centerId: 'libramont', reservationId: 1, body: 'fixture' }) : '';
  const req = Readable.from([Buffer.from(body)]);
  req.method = method; req.url = '/api/staff-customer-notes' + query;
  req.headers = { 'content-type': 'application/json' };
  const result = { headers: {}, body: '', status: 0 };
  const res = { set statusCode(value) { result.status = value; }, get statusCode() { return result.status; },
    setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
    writeHead(status, headers = {}) { result.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(value) { result.body += value || ''; } };
  await endpoint(req, res);
  return result;
}
async function main() {
  const env = { SITE_USERNAME: 'fixture-staff', SITE_PASSWORD: 'fixture-password', DIRECTOR_USERNAME: 'fixture-director', DIRECTOR_PASSWORD: 'fixture-director-password' };
  const middleware = loadMiddleware(env);
  for (const method of ['GET', 'PATCH']) {
    const result = await middleware(new Request('https://pinlane.test/api/staff-customer-notes?centerId=libramont&reservationId=1', { method }));
    check(result.status === 200 && result.headers.get('x-middleware-next') === '1', method + ' notes reaches its staff session guard');
    check(!result.headers.has('www-authenticate'), method + ' notes cannot trigger browser Basic dialog');
  }
  const noBasicConfig = await loadMiddleware({})(new Request('https://pinlane.test/api/staff-customer-notes?centerId=libramont&reservationId=1'));
  check(noBasicConfig.status === 200, 'notes API does not depend on unrelated Basic site credentials');
  for (const route of ['/fixture-private', '/api/staff-customer-notes-extra', '/api/staff-customer-notes/private', '/direction.html']) {
    const result = await middleware(new Request('https://pinlane.test' + route));
    check(result.status === 401 && result.headers.has('www-authenticate'), 'private route protection remains: ' + route);
  }
  for (const [method, query] of [['GET', '?centerId=libramont&reservationId=1'], ['GET', '?centerId=libramont&reservationIds=1,2'], ['PATCH', '']]) {
    reads = 0;
    const result = await unauthenticated(method, query);
    check(result.status === 401 && JSON.parse(result.body).ok === false, method + query + ' endpoint retains JSON staff authentication');
    check(!result.headers['www-authenticate'], method + query + ' unauthenticated API response has no native Basic challenge');
    check(reads === 0, method + query + ' unauthenticated request reads no database');
  }
  console.log('staff-notes-middleware-check: ' + checks + ' PASS');
}
main().catch(error => { console.error(error.stack); process.exit(1); });
