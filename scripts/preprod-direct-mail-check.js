// Actual legacy Direction mail sender, mocked I/O; no server, secrets or DB.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/admin-mail.js'), 'utf8');
const start = source.indexOf('async function msSendDirect(');
const end = /\r?\n\}\r?\n/.exec(source.slice(start));
assert(start >= 0 && end, 'Real sender must be present');
const sender = source.slice(start, start + end.index + end[0].length);
const fresh = () => ({ to: 'qa@example.test', subject: 'Objet', body: 'Corps', identityId: '1', category: 'information', templateRef: '' });
async function main() {
  const posts = [];
  const notices = [];
  let fail = true;
  let hold = null;
  const s = { console, crypto: webcrypto, Uint8Array, URL,
    msState: { draft: fresh(), sendBusy: false, aiTips: [], historyLoaded: true },
    msCenterId: () => 'libramont', msRefresh() {}, toast: value => notices.push(value), confirm: () => true,
    apiRequest: async (url, options) => {
      posts.push(JSON.parse(options.body));
      if (hold) await hold;
      if (fail) throw new Error('Response lost');
      return { ok: true, resendConfigured: true };
    } };
  s.window = s;
  const context = vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/api-client.js'), 'utf8'), context);
  vm.runInContext(sender, context);
  await context.msSendDirect();
  await context.msSendDirect();
  assert(posts.every(p => /^[A-Za-z0-9:_-]{8,128}$/.test(p.attemptId || '')), 'Every Direction send must carry an API-valid attemptId');
  assert.equal(posts[0].attemptId, posts[1].attemptId, 'Lost response retry keeps identity');
  assert.equal(s.msState.draft.body, 'Corps', 'Network failure preserves draft');
  s.msState.draft.body = 'Corps corrige';
  await context.msSendDirect();
  assert.notEqual(posts[1].attemptId, posts[2].attemptId, 'Edited content gets a new identity');
  const editedKey = posts[2].attemptId;
  fail = false;
  await context.msSendDirect();
  assert.equal(posts[3].attemptId, editedKey, 'Successful retry also retains the key');
  assert.equal(s.msState.draft.body, '', 'Successful send clears the draft');
  s.msState.draft = { ...fresh(), body: 'Corps corrige' };
  await context.msSendDirect();
  assert.notEqual(posts[4].attemptId, editedKey, 'New intentional message gets its own key');
  s.msState.draft = fresh();
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const pending = context.msSendDirect();
  const duplicate = context.msSendDirect();
  release();
  await Promise.all([pending, duplicate]);
  assert.equal(posts.length, 6, 'Two clicks while pending make one request');
  assert.equal(s.msState.sendBusy, false);
  assert(!notices.some(value => /mail envoye|mail envoyé/i.test(value)), 'Configured provider alone must not be reported as a sent message');
  console.log('PASS Direction mail: retry, edit, new intent, pending double click, preserved draft');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
