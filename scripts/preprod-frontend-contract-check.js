// Pure local contract tests: compile the current UI functions with mocked I/O.
// Run through run-isolated.cjs. No environment, DB, server or network is read.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const root = path.resolve(__dirname, '..');
const staff = fs.readFileSync(path.join(root, 'assets/staff-pages-v2.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/app-main.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets/api-client.js'), 'utf8');
const results = [];
function ok(pass, id, detail) { results.push({ pass: !!pass, id, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(detail)); }
function extract(source, start, indent, assignment = false) {
  const index = source.indexOf(start);
  if (index < 0) throw new Error('Missing real function: ' + start);
  const end = new RegExp('\\r?\\n' + ' '.repeat(indent) + '\\}' + (assignment ? ';' : '') + '\\r?\\n').exec(source.slice(index));
  if (!end) throw new Error('Missing function end: ' + start);
  return source.slice(index, index + end.index + end[0].length);
}
function sandbox(extra = {}) {
  const s = { console, URL, Date, crypto: webcrypto, setTimeout, clearTimeout, encodeURIComponent,
    state: { adminCenterId: 'libramont' }, location: { origin: 'http://127.0.0.1' },
    renderStaffEmailsPage() {}, renderStaffCampaignsPage() {}, scheduleCampaignsRender() {}, requestOpsAdminLoad() {}, toast() {}, save() {},
    esc: s => String(s ?? ''), money: n => String(n ?? 0) + ' €', ...extra };
  s.window = s; return vm.createContext(s);
}
async function inbound() {
  const posts = []; let fail = true;
  const s = sandbox({ pv2Mail: { analyzeDraft: { from: 'qa@example.test', body: 'Mail QA' } },
    apiRequest: async (url, options) => { posts.push(JSON.parse(options.body)); if (fail) throw new Error('response lost'); return { ok: true }; } });
  vm.runInContext(client, s);
  if (staff.includes('function pv2MessageAttempt(')) vm.runInContext(extract(staff, 'function pv2MessageAttempt(', 2), s);
  vm.runInContext(extract(staff, 'window.pv2AnalyzeSubmit = async function', 2, true), s);
  await s.pv2AnalyzeSubmit(); await s.pv2AnalyzeSubmit();
  s.pv2Mail.analyzeDraft.body = 'Mail corrigé'; fail = false; await s.pv2AnalyzeSubmit();
  s.pv2Mail.analyzeDraft = { from: 'qa@example.test', body: 'Mail corrigé' }; await s.pv2AnalyzeSubmit();
  const ids = posts.map(p => p.requestId);
  ok(ids.length === 4 && ids.every(x => /^[A-Za-z0-9:_-]{8,128}$/.test(x || '')) && ids[0] === ids[1] && ids[1] !== ids[2] && ids[2] !== ids[3], 'C5-retry-edit-new', ids);
}
async function requestReply() {
  const posts = [], toasts = []; let fail = true, pending = null;
  const draft = () => ({ open: true, busy: false, subject: 'Réponse QA', body: 'Contenu QA' });
  const item = { id: 73, email: 'qa@example.test', status: 'in_progress' };
  const s = sandbox({
    API_ENDPOINTS: { ops: '/api/ops' }, staffRequestReplyState: { 73: draft() },
    getStaffCustomRequestItems: () => [item], getActiveOpsCenterId: () => 'libramont',
    getCurrentStaffCenterName: () => 'Centre QA', getCurrentStaffCenterId: () => 'libramont', STAFF_OCCASION_LABELS: {},
    renderStaffUtilityPage() {}, loadStaffRequestThread() {}, setStaffCustomRequestStatus() {},
    // Le bureau des demandes (2026-09-29) : le composeur preremplit la reponse
    // avec le groupe et la date, l envoi range la reponse dans le suivi puis
    // suit la demande dans son onglet. Ces fonctions sont compilees pour de
    // vrai (liste ci-dessous) ; seul l ecran reste simule ici.
    staffCustomRequestsCache: { items: [item] }, focusStaffRequestComposer() {}, staffRequestSegmentOf: () => 'attente',
    toast: message => toasts.push(message),
    apiRequest: async (url, options) => {
      posts.push(JSON.parse(options.body));
      if (pending) await pending;
      if (fail) throw new Error('response lost');
      return { ok: true, resendConfigured: posts.length % 2 === 0 };
    },
  });
  vm.runInContext(client, s);
  for (const name of ['staffRequestSendReply', 'staffRequestReplyDraft', 'toggleStaffRequestReply', 'staffRequestPresetContext', 'crDemande', 'replaceStaffCustomRequest', 'followStaffRequest']) {
    vm.runInContext(extract(app, (name === 'staffRequestSendReply' ? 'async ' : '') + 'function ' + name + '(', 0), s);
  }
  await s.staffRequestSendReply(73); await s.staffRequestSendReply(73);
  const validId = id => /^[A-Za-z0-9:_-]{8,128}$/.test(id || '');
  ok(posts.length === 2 && validId(posts[0]?.attemptId) && posts[0].attemptId === posts[1].attemptId && !s.staffRequestReplyState[73].busy, 'C2-request-retry', posts.map(p => p.attemptId));
  s.toggleStaffRequestReply(73); s.toggleStaffRequestReply(73); await s.staffRequestSendReply(73);
  ok(validId(posts[2]?.attemptId) && posts[2].attemptId === posts[1].attemptId, 'C2-request-reopen-same-intent', posts.map(p => p.attemptId));
  const beforeSuccessToasts = toasts.length;
  s.staffRequestReplyDraft(73, 'body', 'Contenu corrigé'); fail = false; await s.staffRequestSendReply(73);
  ok(validId(posts[3]?.attemptId) && posts[3].attemptId !== posts[2].attemptId && posts[3].body === 'Contenu corrigé' && !s.staffRequestReplyState[73].open, 'C2-request-edit-after-failure', posts[3]);
  s.toggleStaffRequestReply(73); s.staffRequestReplyDraft(73, 'subject', 'Réponse QA'); s.staffRequestReplyDraft(73, 'body', 'Contenu corrigé');
  await s.staffRequestSendReply(73);
  ok(validId(posts[4]?.attemptId) && posts[4].attemptId !== posts[3].attemptId, 'C2-request-new-send', posts.map(p => p.attemptId));
  const successToasts = toasts.slice(beforeSuccessToasts);
  // La REGLE, pas la phrase : le message dit que la reponse est enregistree
  // et ou lire son etat d envoi, le meme quel que soit le fournisseur, et ne
  // dit jamais qu elle est partie (elle peut n etre qu en file). La phrase a
  // change le 2026-09-29 : les mails de la demande sont dans son dossier.
  ok(successToasts.length === 2 && successToasts[0] === successToasts[1] && successToasts.every(message => /^Réponse enregistrée/.test(message) && /état d.envoi/.test(message) && !/envoyée|est partie|a été envoy/i.test(message)), 'C2-request-toast-not-dispatch-proof', { resendConfigured: [true, false], toasts: successToasts });
  s.staffRequestReplyState[73] = draft(); fail = true;
  let release; pending = new Promise(resolve => { release = resolve; });
  const sending = s.staffRequestSendReply(73);
  const beforeDuplicate = posts.length;
  const duplicate = s.staffRequestSendReply(73);
  s.staffRequestReplyDraft(73, 'body', 'Édition pendant attente');
  release(); await Promise.all([sending, duplicate]); pending = null;
  ok(posts.length === beforeDuplicate && s.staffRequestReplyState[73].body === 'Édition pendant attente' && !s.staffRequestReplyState[73].busy, 'C2-request-busy-and-edit-preserved', { count: posts.length, beforeDuplicate, draft: s.staffRequestReplyState[73] });
  const beforeInvalid = posts.length; item.email = 'invalide'; await s.staffRequestSendReply(73);
  item.email = 'qa@example.test'; s.staffRequestReplyDraft(73, 'body', ''); await s.staffRequestSendReply(73);
  ok(posts.length === beforeInvalid, 'C2-request-validation-no-post', posts.length);
}
const sources = ['birthday_j30', 'winback', 'post_visit', 'campaign', 'manual', 'other'].map((key, i) => ({ key, label: 'Source ' + (i + 1), sent: null, conversions: null, revenue: null }));
async function roi() {
  let payload;
  const s = sandbox({ mkBrief: { data: { receipts: [], paie: { euros: 900, young: false } }, period: 30, payOpen: true }, apiRequest: async () => { if (payload instanceof Error) throw payload; return payload; } });
  vm.runInContext(extract(staff, 'window.mkBrPeriod = async function', 2, true), s);
  vm.runInContext(extract(staff, 'function mkwSources(', 2), s);
  vm.runInContext(extract(staff, 'function mkwHero(', 2), s);
  payload = { available: false, unavailableReason: 'query_failed', days: 90, revenue: null, conversions: null, sent: null, reviewClicks: null, excludedMissingSentAt: null, bySource: sources };
  await s.mkBrPeriod(90);
  let p = s.mkBrief.data.paie, html = s.mkwHero();
  ok(p.available === false && p.unavailableReason === 'query_failed' && p.euros === null && p.excludedMissingSentAt === null && p.sources.length === 6 && !p.young && !p.quietWindow, 'C6-unavailable-refetch', p);
  ok(html.includes('Mesure indisponible') && !html.includes('null') && !html.includes('0 €') && !html.includes('aucune visite') && sources.every(row => html.includes(row.label)) && html.includes('90 j'), 'C6-unavailable-render', html);
  payload = { available: true, days: 30, revenue: 0, conversions: 0, sent: 0, reviewClicks: 0, excludedMissingSentAt: 2, bySource: [] };
  await s.mkBrPeriod(30); p = s.mkBrief.data.paie; html = s.mkwHero();
  ok(p.available === true && p.young === true && p.excludedMissingSentAt === 2 && /exclu/i.test(html) && html.includes('2'), 'C6-real-zero-exclusion', { p, html });
  payload = { days: 7, revenue: 120, conversions: 3, sent: 5, reviewClicks: 0, bySource: [{ key: 'manual', label: 'Manuel', revenue: 120, sent: 5 }] };
  await s.mkBrPeriod(7); html = s.mkwHero();
  ok(s.mkBrief.data.paie.available !== false && html.includes('120 €') && !html.includes('Mesure indisponible'), 'C6-legacy-positive', html);
  payload = new Error('offline'); await s.mkBrPeriod(90); html = s.mkwHero();
  ok(s.mkBrief.data.paie.available === false && html.includes('Mesure indisponible') && !html.includes('120 €'), 'C6-network-no-stale-period', html);
}
async function ranges() {
  for (const name of ['loadStaffClientData', 'loadStaffReservationsData', 'pv2ResSearchEnsureData']) for (const failSecond of [false, true]) {
    const calls = [];
    const s = sandbox({
      API_ENDPOINTS: { adminRange: '/api/admin-range' },
      staffClientDataCache: { reservations: [{ id: 99 }], loaded: false }, staffReservationsDataCache: { reservations: [{ id: 99 }], loaded: false },
      pv2ResSearch: { rows: [{ id: 99 }], loaded: false },
      getStaffClientCacheKey: () => 'qa', getStaffReservationsCacheKey: () => 'qa', getActiveOpsCenterId: () => 'libramont',
      getStaffClientRange: () => ({ startDate: '2026-09-01', endDate: '2026-09-30' }), getStaffReservationsRange: () => ({ previousMonthStart: '2026-09-01', gridEnd: '2026-09-30' }),
      todayStr: () => '2026-09-12', addDays: date => date,
      isStaffClientsActive: () => false, isStaffReservationsActive: () => false, isStaffUtilityActive: () => false, isStaffPricingActive: () => false,
      apiRequest: async url => {
        calls.push(url); const second = new URL(url, 'http://127.0.0.1').searchParams.has('cursor');
        if (second && failSecond) throw new Error('413 ROW_TOO_LARGE');
        return { ok: true, reservations: [{ id: second ? 2 : 1 }], pagination: { hasMore: !second, nextCursor: second ? null : 'qa-next' } };
      },
    });
    vm.runInContext(client, s);
    vm.runInContext(extract(name.startsWith('pv2') ? staff : app, 'async function ' + name + '(', name.startsWith('pv2') ? 2 : 0), s);
    await s[name](true);
    const cache = name === 'loadStaffClientData' ? s.staffClientDataCache : name === 'loadStaffReservationsData' ? s.staffReservationsDataCache : s.pv2ResSearch;
    const rows = cache.reservations || cache.rows;
    ok(calls.length === 2 && (failSecond ? !!cache.error && rows.length === 1 && rows[0].id === 99 : cache.loaded && rows.length === 2), 'OPS05-' + name + (failSecond ? '-failure' : '-complete'), { calls, cache });
  }
}
(async () => {
  for (const check of [inbound, requestReply, roi, ranges]) try { await check(); } catch (e) { ok(false, check.name + '-execution', e.stack); }
  const out = path.join(root, 'artifacts/preprod-fixes-20260912/frontend'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'contracts.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length }));
  process.exitCode = results.some(r => !r.pass) ? 1 : 0;
})();
