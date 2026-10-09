'use strict';
// LA VERITE D UN DEPLACEMENT LASER (Movsar, 2026-10-07) : « on les drop sur une
// heure mais elle revient a son heure et en plus ca affiche un message en mode
// la resa a bien bouge alors que non ».
//
// Ce gate pilote le VRAI planning (Playwright, souris) sur le VRAI handler
// api/staff-reservations.js, la VRAIE transaction lib/database.js (pg en
// memoire, scripts/slot-holds-check.js) et le VRAI api/staff-state.js pour la
// relecture periodique. Aucune copie navigateur de la logique de placement,
// aucune ecriture distante.
//
// Pour chaque dossier (formule du moteur, laser direct ancien sans plan, grand
// groupe en deux vagues, visite a programme, formule sans blocs laser) :
//   1. la partie lachee sur une heure est RELUE en base a cette heure ;
//   2. le message de succes n apparait QUE si la base le prouve ; une relecture
//      staff-state (le poll) ne la ramene pas a son ancienne heure ;
//   3. un deplacement impossible (arene pleine) rend UNE ligne courte, aucune
//      ecriture, aucun succes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
const ROOT = path.resolve(__dirname, '..');
const bench = require('./slot-holds-check');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LMT_PORT || 4211);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const OUT = path.resolve(ROOT, 'tests/artifacts/laser-move-truth');
fs.mkdirSync(OUT, { recursive: true });
const JOUR = bench.JOUR;

let checks = 0;
const check = (cond, label) => { assert.ok(cond, label); checks += 1; console.log('OK ' + label); };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ── Le serveur reel, en memoire ─────────────────────────────────────────────
// Le banc des blocages ne simule pas la lecture par id ni l UPDATE complet du
// dossier : meme complement que activity-drag-database-check.js.
let ecrituresSql = 0;
// Les statuts de piste (maintenance) viennent d une table que le banc ne
// simule pas : servis d ici, poses par le cas qui en a besoin.
let statutsDePiste = [];
(() => {
  const { Pool } = require('pg');
  const connect = Pool.prototype.connect;
  Pool.prototype.query = async function (sql, values) { const client = await this.connect(); try { return await client.query(sql, values); } finally { client.release(); } };
  Pool.prototype.connect = async function () {
    const client = await connect.call(this);
    const query = client.query.bind(client);
    client.query = async (sql, values = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/^select \* from reservations where id = \$1 (limit 1|for update);?$/.test(s)) {
        const row = bench.base.reservations.get(Number(values[0]));
        return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (/from lane_statuses/.test(s)) return { rows: structuredClone(statutsDePiste), rowCount: statutsDePiste.length };
      if (/^update reservations set center_id = \$2,/.test(s)) {
        ecrituresSql += 1;
        const [id, center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type, formule_id, label, occasion, extras, payment_method, notes, ops_plan, risk_level, risk_score, validation_status, activity_progress, program, companions] = values;
        const row = { ...bench.base.reservations.get(Number(id)), center_id, channel, name, phone, email, date, start_time, duration, total_duration, lanes, pax, status, base_price, price, type, formule_id, label, occasion, extras: JSON.parse(extras), payment_method, notes, ops_plan: ops_plan ? JSON.parse(ops_plan) : null, risk_level, risk_score, validation_status, activity_progress: JSON.parse(activity_progress), program: program ? JSON.parse(program) : null, companions, updated_at: new Date() };
        bench.base.reservations.set(Number(id), row);
        return { rows: [structuredClone(row)], rowCount: 1 };
      }
      return query(sql, values);
    };
    return client;
  };
})();
const { db, ops } = (() => {
  const S = bench.charger();
  const session = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'qa', name: 'QA' }, role: { locked: true }, permissions: ['reservations.edit', 'planning.view', 'planning.laser', 'planning.drag'] };
  const authPath = require.resolve(path.join(ROOT, 'lib/staff-auth.js'));
  const auth = require(authPath);
  require.cache[authPath].exports = { ...auth, getStaffSessionFromRequest: async () => session, requireStaffPermission: async () => session };
  return { db: S.db, ops: S.ops };
})();
const staffReservations = require(path.join(ROOT, 'api/staff-reservations.js'));
const staffState = require(path.join(ROOT, 'api/staff-state.js'));

async function appelerHttp(handler, { methode, url, corps, entetes = {} }) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  req.method = methode; req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json', ...entetes };
  req.socket = { remoteAddress: '127.0.0.1' };
  const res = { statusCode: 200, entetes: {}, corps: '', setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await handler(req, res);
  return { status: res.statusCode, headers: res.entetes, body: res.corps };
}

const requetes = [];
async function qaPatch(body) {
  requetes.push(body);
  return appelerHttp(staffReservations, { methode: 'PATCH', url: '/api/staff-reservations', corps: body });
}
async function qaStaffState(url, ifNoneMatch) {
  return appelerHttp(staffState, { methode: 'GET', url, entetes: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} });
}

// ── Dossiers de production, construits par le vrai moteur ───────────────────
const CENTRE = 'libramont';
async function planMoteur(demande) {
  const built = await ops.prepareReservationOps({ centerId: CENTRE, name: 'QA', phone: '0470000000', date: JOUR, channel: 'staff', allowPastStart: true, ...demande }, 'staff', { readState: async () => ({ reservations: [], laneStatuses: {} }) });
  assert.ok(built?.opsPlan?.resourceBlocks?.length, 'le vrai moteur rend un plan');
  return built.opsPlan;
}
function ligne(id, extra) {
  return bench.reservationLigne(id, extra.start_time || '15:00', extra.lanes || [], { name: `Dossier ${id}`, ...extra });
}

// ── Le navigateur ───────────────────────────────────────────────────────────
async function installerReseau(page) {
  await page.exposeFunction('__qaPatch', qaPatch);
  await page.exposeFunction('__qaStaffState', qaStaffState);
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p, status = 200, headers = {}) => new Response(JSON.stringify(p), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
    const entete = (init, nom) => { const h = init.headers || {}; if (typeof h.get === 'function') return h.get(nom) || ''; return h[nom] || h[nom.toLowerCase()] || ''; };
    const nativeFetch = window.fetch.bind(window);
    window.__NOTICES__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-customer-notes' && m === 'GET') {
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        const lot = u.searchParams.get('reservationIds');
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/staff-state') {
        const r = await window.__qaStaffState(u.pathname + u.search, entete(init, 'If-None-Match'));
        if (r.status === 304) return new Response(null, { status: 304, headers: { etag: r.headers.etag || '' } });
        return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', ...(r.headers.etag ? { etag: r.headers.etag } : {}) } });
      }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        if (window.__QA_MENTIR__) {
          // Un serveur qui dit oui sans rien ecrire : la console ne doit pas le croire.
          const b = JSON.parse(init.body || '{}');
          const courant = state.reservations.find((x) => Number(x.id) === Number(b.id));
          window.__QA_MENTIR__ = false;
          return J({ ok: true, reservation: { ...courant, updatedAt: new Date().toISOString() }, activityMove: { ...b.activityMove, unchangedActivities: true }, automation: {} });
        }
        const r = await window.__qaPatch(JSON.parse(init.body || '{}'));
        return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, centers: [] });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

async function monterPlanning(page) {
  await page.goto(`${BASE_URL}/?v=lmt-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.syncDateReservations === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    const t = toast; window.toast = (m) => { window.__NOTICES__.push({ toast: String(m) }); return t(m); };
    const n = showPlanningMoveNotice; window.showPlanningMoveNotice = (a, b, c) => { window.__NOTICES__.push({ title: String(a), message: String(b || ''), tone: String(c || 'warning') }); return n(a, b, c); };
  });
}

// Recharge la journee depuis le serveur (comme le poll) et impose la vue laser agrandie.
async function recharger(page) {
  await page.evaluate(async (d) => {
    pendingReservationMutations.clear(); reservationInFlightMutations.clear();
    state.adminCenterId = 'libramont'; state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'laser'; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = true; state.staffPlanningExpanded = false;
    setView('staff');
    await syncDateReservations(d, { silent: true });
    renderStaff();
  }, JOUR);
  let pret = false;
  for (let essai = 0; essai < 8 && !pret; essai += 1) {
    pret = await page.evaluate(() => { const wrap = document.querySelector('.laser-planning-box.expanded #laserPlanningGridWrap'); return Boolean(wrap && wrap.querySelector('.lp .lp-dep')) && wrap.getBoundingClientRect().height > 100; });
    if (!pret) { await page.evaluate(() => { state.staffResourceView = 'laser'; state.staffLaserPlanningExpanded = true; renderStaff(); }); await page.waitForTimeout(300); }
  }
  assert.ok(pret, 'planning laser (un rang par depart) rendu et mesurable');
}

// Les fenetres laser d un dossier telles que la console les PROJETTE.
const fenetres = (page, id) => page.evaluate((id) => {
  const r = state.reservations.find((x) => Number(x.id) === Number(id));
  if (!r) return null;
  return getLaserWindowsFromReservation(r).map((w) => ({ unit: laserBlockUnitKey(w), start: Number(w.start), startTime: numToTime(Number(w.start)) })).sort((a, b) => a.start - b.start);
}, id);
const fenetresBase = async (page, id) => {
  const row = await db.getReservationById(id);
  return page.evaluate((row) => getLaserWindowsFromReservation(row).map((w) => ({ unit: laserBlockUnitKey(w), start: Number(w.start), startTime: numToTime(Number(w.start)) })).sort((a, b) => a.start - b.start), row);
};

// Amene un element du planning Laser (maquette E) dans la bande ou le pointeur
// ne fait rien defiler : pendant un glisser, le planning defile seul a moins
// de 96 px du haut de son cadre et du haut de la file « À placer »
// (lpDefilerDemarrer). Rend le point a viser, ou la raison.
function amener(page, selecteur) {
  return page.evaluate((selecteur) => {
    const el = document.querySelector(selecteur);
    const cadre = lpDefileur();
    if (!el || !cadre) return { raison: `${selecteur} : ${el ? 'aucun cadre de defilement' : 'absent'}` };
    const pageEntiere = cadre === document.scrollingElement || cadre === document.documentElement;
    const r = pageEntiere ? { top: 0, bottom: innerHeight } : cadre.getBoundingClientRect();
    const file = document.querySelector('#laserPlanningGridWrap .lp-file');
    const wrap = document.getElementById('laserPlanningGridWrap');
    const rangees = [...document.querySelectorAll('#laserPlanningGridWrap .lp-dep')];
    const limite = Math.min(innerHeight, r.bottom, file ? file.getBoundingClientRect().top : Infinity);
    const tient = wrap && wrap.querySelector('.lp-compact') && wrap.scrollHeight <= wrap.clientHeight + 2
      && rangees.length > 0 && rangees.every(e => { const b = e.getBoundingClientRect(); return b.top >= Math.max(0, r.top) && b.bottom <= limite; });
    // Aucun defilement si toute la journee tient : les derniers departs sont
    // de vraies cibles, meme dans l ancienne bande reservee au defilement.
    const marge = tient ? 4 : 96 + 12;
    const haut = Math.max(0, r.top) + marge;
    const bas = limite - marge;
    for (let essai = 0; essai < 14; essai += 1) {
      const b = el.getBoundingClientRect();
      const ecart = (b.top + b.height / 2) - (haut + bas) / 2;
      if (Math.abs(ecart) <= 2) break;
      cadre.scrollTop += ecart;
    }
    const b = el.getBoundingClientRect();
    const y = b.top + b.height / 2;
    if (!(b.height > 4 && y > haut && y < bas)) return { raison: `${selecteur} au centre ${Math.round(y)}, bande ${Math.round(haut)}-${Math.round(bas)}, fenetre ${innerHeight}` };
    return { x: b.left + Math.min(b.width / 2, 60), y };
  }, selecteur);
}

// Glisser une unite (groupe pose dans son depart, ou jeton de la file « À
// placer ») jusqu au rang d un depart. Saisie, l unite fait passer le planning
// en choix (la file grandit de sa barre) : la cible s amene ensuite dans la
// bande. Un jeton se saisit dans la file, et le pointeur y saute d un coup
// vers sa cible : la bande au-dessus de la file ferait defiler au passage.
async function glisser(page, { id, unit, vers, enFile = false }) {
  const selecteur = enFile
    ? `#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="${id}"][data-laser-unit="${unit}"]`
    : `#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="${id}"][data-laser-unit="${unit}"]`;
  const source = enFile
    ? await page.evaluate((selecteur) => { const j = document.querySelector(selecteur); if (!j) return null; j.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = j.getBoundingClientRect(); return b.height > 4 && b.top >= 0 && b.bottom <= innerHeight ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : { raison: `jeton ${Math.round(b.top)}-${Math.round(b.bottom)}, fenetre ${innerHeight}` }; }, selecteur)
    : await amener(page, selecteur);
  if (!(source && source.y)) {
    const etat = await page.evaluate((id) => {
      const r = state.reservations.find((x) => Number(x.id) === Number(id));
      const file = [...document.querySelectorAll('#laserPlanningGridWrap .lp-jeton')].map((el) => `${el.dataset.laserResId}/${el.dataset.laserUnit}`);
      const attente = r ? getPendingLaserPassesForReservation(r).map((p) => p.unitKey) : null;
      return `file=${JSON.stringify(file)} ; attente=${JSON.stringify(attente)} ; plan=${JSON.stringify(r?.opsPlan?.laserPassPlan)} ; blocs=${JSON.stringify((r?.opsPlan?.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').map((b) => [b.countIndex, b.groupWaveIndex, b.startTime, b.manualLaserPass]))}`;
    }, id);
    assert.fail(`groupe ${id}/${unit} a l ecran${source && source.raison ? ' :: ' + source.raison : ''} :: ${etat}`);
  }
  await page.evaluate(() => { window.__NOTICES__ = []; });
  const avant = requetes.length;
  await page.mouse.move(source.x, source.y); await page.mouse.down();
  await page.mouse.move(source.x + 8, source.y + (enFile ? 0 : 8), { steps: 2 });
  const cible = await amener(page, `#laserPlanningGridWrap .lp-dep[data-lp-t="${vers}"] .lp-dep__jauge`);
  const leve = await page.evaluate((vers) => ({ glisse: Boolean(lpEtat.glisse), classes: (document.querySelector(`#laserPlanningGridWrap .lp-dep[data-lp-t="${vers}"]`) || {}).className || '' }), vers);
  if (!(cible && cible.y) || !leve.glisse) { await page.mouse.up(); assert.fail(`groupe ${id}/${unit} leve et rang ${vers} dans la vue (leve ${leve.glisse})${cible && cible.raison ? ' :: ' + cible.raison : ''}`); }
  await page.mouse.move(cible.x, cible.y, { steps: enFile ? 1 : 12 }); await page.mouse.up();
  // La reponse du serveur et son traitement : on attend que plus rien ne soit en vol.
  await page.waitForFunction(() => !lpEtat.enCours && !lpEtat.glisse && !lpEtat.geste, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  return {
    requetes: requetes.slice(avant),
    notices: await page.evaluate(() => window.__NOTICES__.slice()),
    classes: leve.classes,
    raisons: await page.evaluate(() => [...document.querySelectorAll('#laserPlanningGridWrap .lp-placer.is-raison .lp-placer__t')].map((e) => e.textContent.replace(/\s+/g, ' ').trim())),
  };
}

const succes = (notices) => notices.filter((n) => (n.toast && /plac/i.test(n.toast)) || n.tone === 'success');
const refus = (notices) => notices.filter((n) => n.tone === 'warning' || (n.toast && !/plac/i.test(n.toast)));
const mots = (texte) => String(texte || '').trim().split(/\s+/).filter(Boolean).length;

async function verifierDeplacement(page, { id, unit, vers, label, enFile = false, autres = [] }) {
  const avantUi = await fenetres(page, id);
  const avantBase = await fenetresBase(page, id);
  const resultat = await glisser(page, { id, unit, vers, enFile });
  const apresBase = await fenetresBase(page, id);
  const uniteBase = apresBase.find((w) => w.unit === unit);
  console.log(`   ${label} :: base avant ${JSON.stringify(avantBase)} -> apres ${JSON.stringify(apresBase)} ; notices ${JSON.stringify(resultat.notices)} ; rang vise ${resultat.classes}`);
  check(resultat.requetes.length === 1 && resultat.requetes[0].activityMove?.unitKey === unit && resultat.requetes[0].activityMove?.startTime === numToTime(vers), `${label} : UNE requete ciblee ${unit} -> ${numToTime(vers)}`);
  check(uniteBase && Math.abs(uniteBase.start - vers) < 0.001, `${label} : la base porte ${unit} a ${numToTime(vers)} (lu ${uniteBase ? uniteBase.startTime : 'absente'})`);
  for (const autre of avantBase.filter((w) => w.unit !== unit)) {
    const encore = apresBase.find((w) => w.unit === autre.unit);
    check(encore && Math.abs(encore.start - autre.start) < 0.001, `${label} : ${autre.unit} reste a ${autre.startTime}`);
  }
  check(succes(resultat.notices).length === 1 && refus(resultat.notices).length === 0, `${label} : un seul message, de succes, apres preuve serveur`);
  const immediat = (await fenetres(page, id)).find((w) => w.unit === unit);
  check(immediat && Math.abs(immediat.start - vers) < 0.001, `${label} : l ecran montre ${unit} a ${numToTime(vers)} juste apres`);
  // LA RELECTURE PERIODIQUE : deux polls, dont un a la revision connue (304).
  await page.evaluate(async (d) => { await syncDateReservations(d, { silent: true }); await syncDateReservations(d, { silent: true }); renderStaffData(); }, JOUR);
  const relu = (await fenetres(page, id)).find((w) => w.unit === unit);
  check(relu && Math.abs(relu.start - vers) < 0.001, `${label} : apres relecture staff-state, ${unit} est toujours a ${numToTime(vers)} (lu ${relu ? relu.startTime : 'absente'})`);
  // Et les autres dossiers du jour n ont pas bouge.
  for (const autreId of autres) {
    const a = await fenetresBase(page, autreId);
    check(a.length > 0, `${label} : le dossier ${autreId} garde ses ${a.length} fenetre(s)`);
  }
  return resultat;
}

function numToTime(value) { const minutes = Math.round(Number(value) * 60); return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }

// ── LES DECLENCHEURS DE PRODUCTION DU REFUS, sans navigateur ────────────────
// Avant le 2026-10-07, chacun de ces dossiers voyait sa partie Laser refusee
// par une regle de CREATION qui ne concernait pas le geste. Vrai handler, vraie
// transaction : la partie doit etre relue en base a l heure lachee.
async function patchHttp(id, activityMove) {
  const row = await db.getReservationById(id);
  const r = await appelerHttp(staffReservations, { methode: 'PATCH', url: '/api/staff-reservations', corps: { id, centerId: CENTRE, baseUpdatedAt: new Date(row.updatedAt).toISOString(), activityMove } });
  let json = {}; try { json = JSON.parse(r.body); } catch (e) { json = {}; }
  return { status: r.status, ...json };
}
const laserBase = async (id, unitKey) => {
  const row = await db.getReservationById(id);
  const cle = (b) => `${Number(b.countIndex || 1)}.${Number(b.groupWaveIndex || 1)}`;
  return (row.opsPlan?.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena' && cle(b) === unitKey).map((b) => b.startTime);
};
async function declencheursDeProduction(planF1) {
  const moteur = () => ligne(7201, { start_time: '15:00', lanes: [1, 2], pax: 8, type: 'formule', formule_id: 'f1', label: 'FORMULE 1', price: 180, base_price: 180, total_duration: 3, ops_plan: structuredClone(planF1) });
  const cas = [
    { label: 'voisin bowling deja sur la piste 2 a 15:00 (double attribution existante)', voisins: [ligne(7202, { start_time: '15:00', lanes: [2, 3], pax: 4 })] },
    { label: 'bowling du dossier au-dela de la capacite normale (14 sur 2 pistes), pistes libres ailleurs', modifier: (d) => { d.pax = 14; d.ops_plan.resourceBlocks.forEach((b) => { if (b.resourceType === 'bowling_lane') b.players = 14; }); } },
    { label: 'piste du dossier passee en maintenance apres coup', statuts: [{ lane_number: 1, status: 'maintenance', updated_at: new Date(), maintenance_from: null, maintenance_until: null, maintenance_note: '' }] },
    { label: 'dossier decale hors grille par le plan de retard (15:15)', modifier: (d) => { d.start_time = '15:15'; d.ops_plan.startTime = '15:15'; d.ops_plan.resourceBlocks.forEach((b) => { if (b.resourceType === 'bowling_lane') { b.start = 915; b.end = 975; b.startTime = '15:15'; b.endTime = '16:15'; } }); } },
    { label: 'ligne et plan en desaccord sur les pistes (ancien dossier : ligne [5,6], plan [1,2])', modifier: (d) => { d.lanes = [5, 6]; }, voisins: [ligne(7202, { start_time: '15:00', lanes: [5, 6], pax: 4 })] },
  ];
  for (const c of cas) {
    const dossier = moteur(); if (c.modifier) c.modifier(dossier);
    bench.semer([dossier, ...(c.voisins || [])]);
    statutsDePiste = c.statuts || [];
    try {
      const r = await patchHttp(7201, { activityId: 'laser_game', unitKey: '1.1', startTime: '19:00' });
      check(r.status === 200 && r.activityMove?.unchangedActivities === true, `${c.label} : la partie Laser bouge (HTTP ${r.status}${r.message ? ' ' + r.message : ''})`);
      check(JSON.stringify(await laserBase(7201, '1.1')) === JSON.stringify(['19:00']), `${c.label} : relue en base a 19:00`);
      const apres = await db.getReservationById(7201);
      check(JSON.stringify(apres.lanes) === JSON.stringify(dossier.lanes) && apres.startTime === dossier.start_time && apres.pax === dossier.pax, `${c.label} : pistes, heure et effectif du dossier intacts`);
    } finally { statutsDePiste = []; }
  }
  // Le serveur refuse encore ce qui est vraiment impossible, en une ligne.
  bench.semer([moteur(), ligne(7203, { start_time: '19:00', lanes: [], pax: 29, type: 'laser', label: 'Laser Game', duration: 0.5, total_duration: 0.5, ops_plan: null })]);
  const ecrituresAvantRefus = ecrituresSql;
  const plein = await patchHttp(7201, { activityId: 'laser_game', unitKey: '1.1', startTime: '19:00' });
  check(plein.status === 409 && plein.ok === false, `arene pleine : refus 409 (${plein.message})`);
  check(mots(plein.message) <= 14 && /complet/i.test(plein.message), `arene pleine : une ligne courte qui dit pourquoi (${mots(plein.message)} mots)`);
  check(JSON.stringify(await laserBase(7201, '1.1')) === JSON.stringify(['17:00']), 'arene pleine : la base est inchangee');
  bench.semer([moteur(), ligne(7204, { start_time: '18:00', lanes: [3, 4], pax: 4 })]);
  const piste = await patchHttp(7201, { activityId: 'bowling', startTime: '18:00', lanes: [3, 4] });
  check(ecrituresSql === ecrituresAvantRefus, 'refus serveur : aucun UPDATE SQL');
  check(piste.status === 409 && /^Piste 3, 4 déjà prise de 18:00-19:00\.$/.test(piste.message || ''), `piste prise : refus 409 nomme la piste et l heure (${piste.message})`);
  const voisinIntact = await db.getReservationById(7201);
  check(voisinIntact.opsPlan.resourceBlocks.find((b) => b.resourceType === 'bowling_lane').startTime === '15:00', 'piste prise : la base est inchangee');
  bench.semer([moteur(), ligne(7204, { start_time: '18:00', lanes: [5, 6], pax: 4 })]);
  const libre = await patchHttp(7201, { activityId: 'bowling', startTime: '18:00', lanes: [3, 4] });
  check(libre.status === 200 && (await db.getReservationById(7201)).opsPlan.resourceBlocks.find((b) => b.resourceType === 'bowling_lane').startTime === '18:00', 'piste libre : le bowling bouge toujours');
  // Une partie ne se pose pas sur une autre partie du MEME groupe (memes joueurs,
  // une seule arene) : le serveur refuse comme l ecran, sans rien ecrire.
  // La formule f1 n a qu une partie : on lui en ajoute une deuxieme, une heure
  // apres la premiere, et on pose la 1.1 dessus.
  const dossierDeux = moteur();
  const premiere = (dossierDeux.ops_plan.resourceBlocks || []).find((b) => b.resourceType === 'laser_arena');
  check(Boolean(premiere), 'MONTAGE meme groupe : la formule f1 porte une partie Laser a doubler');
  const heure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const autrePartie = { ...premiere, countIndex: 2, groupWaveIndex: 1, start: premiere.start + 60, end: premiere.end + 60, startTime: heure(premiere.start + 60), endTime: heure(premiere.end + 60) };
  dossierDeux.ops_plan.resourceBlocks.push(autrePartie);
  bench.semer([dossierDeux]);
  const ecrituresAvantGroupe = ecrituresSql;
  const surSoi = await patchHttp(7201, { activityId: 'laser_game', unitKey: '1.1', startTime: autrePartie.startTime });
  // Refus de buildActivityMove (lib/reservation-activity-move.js), 422.
  check(surSoi.status === 422 && /^Ce déplacement chevauche le Laser Game à \d\d:\d\d\. Cet horaire reste inchangé\.$/.test(surSoi.message || ''), `meme groupe : refus 422 en une ligne (${surSoi.message})`);
  check(ecrituresSql === ecrituresAvantGroupe && JSON.stringify(await laserBase(7201, '1.1')) === JSON.stringify(['17:00']), 'meme groupe : aucun UPDATE, la base est inchangee');
}

async function main() {
  const planTemoin = await planMoteur({ id: 7201, startTime: '15:00', pax: 8, type: 'formule', formuleId: 'f1', duration: 1, lanes: [1, 2], laneCount: 2 });
  await declencheursDeProduction(planTemoin);
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') erreurs.push('CONSOLE: ' + msg.text()); });
  try {
    await installerReseau(page);
    await monterPlanning(page);

    // ── Dossiers ──────────────────────────────────────────────────────────
    const planF1 = await planMoteur({ id: 7101, startTime: '15:00', pax: 8, type: 'formule', formuleId: 'f1', duration: 1, lanes: [1, 2], laneCount: 2 });
    const planGros = await planMoteur({ id: 7103, startTime: '13:00', pax: 45, type: 'formule', formuleId: 'f1', duration: 1, lanes: [3, 4, 5, 6, 7, 8], laneCount: 6 });
    const programme = { items: [{ activityId: 'bowling', participants: 6, duration: 1, price: 58.5 }, { activityId: 'laser_game', participants: 6, games: 2, price: 72 }], price: 130.5, priceComplete: true };
    const planVisite = await planMoteur({ id: 7104, startTime: '11:00', pax: 6, type: 'visite', duration: 1, lanes: [], laneCount: 2, program: programme, preference: { preferredTimes: { bowling: '11:00', laser_game: '12:30' }, laserGameTimes: ['12:30', '13:00'], laserPlacement: 'scheduled' } });
    const planTot = await planMoteur({ id: 7105, startTime: '10:00', pax: 6, type: 'formule', formuleId: 'f1', duration: 1, lanes: [7, 8], laneCount: 2 });
    const planSansLaser = { ...planTot, resourceBlocks: planTot.resourceBlocks.filter((b) => b.resourceType !== 'laser_arena'), timeline: (planTot.timeline || []).filter((b) => b.activityId !== 'laser_game') };
    const dossiers = [
      ligne(7101, { start_time: '15:00', lanes: [1, 2], pax: 8, type: 'formule', formule_id: 'f1', label: 'FORMULE 1', price: 180, base_price: 180, total_duration: 3, ops_plan: planF1 }),
      ligne(7102, { start_time: '17:40', lanes: [], pax: 6, type: 'laser', label: 'Laser Game', duration: 1, total_duration: 1, price: 72, base_price: 72, ops_plan: null }),
      ligne(7103, { start_time: '13:00', lanes: [3, 4, 5, 6, 7, 8], pax: 45, type: 'formule', formule_id: 'f1', label: 'FORMULE 1', price: 900, base_price: 900, total_duration: 3, ops_plan: planGros }),
      ligne(7104, { start_time: '11:00', lanes: [1, 2], pax: 6, type: 'bowling', label: 'Visite', duration: 1, total_duration: 2.5, price: 130.5, base_price: 130.5, program: programme, ops_plan: planVisite }),
      ligne(7105, { start_time: '10:00', lanes: [7, 8], pax: 6, type: 'formule', formule_id: 'f1', label: 'FORMULE 1', price: 90, base_price: 90, total_duration: 3, ops_plan: planSansLaser }),
      // Le declencheur rapporte : un voisin deja sur la piste 2 a 15:00, comme 7101.
      ligne(7106, { start_time: '15:00', lanes: [2, 3], pax: 4, label: 'Bowling voisin' }),
    ];
    bench.semer(dossiers);
    await recharger(page);
    const ids = dossiers.map((d) => d.id);
    const presents = await page.evaluate(() => state.reservations.map((r) => r.id).sort());
    check(JSON.stringify(presents) === JSON.stringify(ids.slice().sort()), `les ${ids.length} dossiers sont servis par le vrai staff-state`);
    for (const id of ids) console.log(`   ${id} :: ${JSON.stringify(await fenetres(page, id))}`);
    await page.screenshot({ path: path.join(OUT, 'avant.png') });

    // 1. Formule du moteur : partie unique 17:00 -> 19:00.
    await verifierDeplacement(page, { id: 7101, unit: '1.1', vers: 19, label: 'formule moteur', autres: [7103, 7104] });
    // 2. Laser direct ancien (sans plan) : partie 1 dessinee a 18:00 -> 20:00.
    await verifierDeplacement(page, { id: 7102, unit: '1.1', vers: 20, label: 'laser direct ancien, partie 1', autres: [7101] });
    //    puis sa partie 2, depuis la file « Parties a placer » -> 21:00.
    await verifierDeplacement(page, { id: 7102, unit: '2.1', vers: 21, label: 'laser direct ancien, partie 2 en file', enFile: true, autres: [7101] });
    // 3. Grand groupe : la vague 2 seule -> 18:30 (la vague 1 reste). La cible
    //    s amene dans la vue une fois la vague saisie : la souris ne defile pas.
    const vagues = await fenetres(page, 7103);
    check(vagues.length === 2 && vagues.every((w) => w.unit.startsWith('1.')), `le grand groupe a deux vagues (${JSON.stringify(vagues)})`);
    await verifierDeplacement(page, { id: 7103, unit: '1.2', vers: 18.5, label: 'grand groupe, vague 2', autres: [7101, 7102] });
    // 4. Visite a programme : partie 2 -> 15:30 (la rangee 10:30 reste sous l en-tete colle, hors de portee de la souris).
    const visite = await fenetres(page, 7104);
    check(visite.some((w) => w.unit === '2.1'), `la visite montre sa partie 2 (${JSON.stringify(visite)})`);
    await verifierDeplacement(page, { id: 7104, unit: '2.1', vers: 15.5, label: 'visite programme, partie 2', autres: [7101] });
    // 5. Formule sans blocs laser (dessinee par repli) : -> 14:00.
    const repli = await fenetres(page, 7105);
    check(repli.length === 1, `la formule sans bloc laser est dessinee par repli (${JSON.stringify(repli)})`);
    await verifierDeplacement(page, { id: 7105, unit: '1.1', vers: 14, label: 'formule sans bloc laser (repli)', autres: [7101] });
    await page.screenshot({ path: path.join(OUT, 'apres.png') });

    // 6. REFUS : l arene est pleine a 17:30 (29 joueurs) ; 8 de plus ne tiennent pas.
    bench.base.reservations.set(7190, ligne(7190, { start_time: '17:30', lanes: [], pax: 29, type: 'laser', label: 'Laser Game', duration: 0.5, total_duration: 0.5, price: 290, base_price: 290, ops_plan: null }));
    await recharger(page);
    const avantRefus = await fenetresBase(page, 7101);
    const ecritures = requetes.length;
    const r = await glisser(page, { id: 7101, unit: '1.1', vers: 17.5 });
    console.log(`   refus :: notices ${JSON.stringify(r.notices)} ; barre ${JSON.stringify(r.raisons)} ; rang vise ${r.classes}`);
    check(succes(r.notices).length === 0, 'refus : aucun message de succes');
    // Le planning de la maquette E refuse AVANT le serveur, avec ses regles
    // (lpVerdict) : la raison s ecrit dans la barre de placement, rien ne part.
    check(r.requetes.length === 0 && requetes.length === ecritures, `refus : aucune requete au serveur (${requetes.length - ecritures})`);
    check(r.raisons.length === 1 && refus(r.notices).length === 0, 'refus : UN message, dans la barre de placement');
    const texte = r.raisons[0] || '';
    check(mots(texte) <= 16, `refus : court (${mots(texte)} mots) : « ${texte} »`);
    check(/place|complet/i.test(texte), 'refus : il dit pourquoi (capacite)');
    assert.deepEqual(await fenetresBase(page, 7101), avantRefus); checks += 1; console.log('OK refus : la base est inchangee');
    const relu = (await fenetres(page, 7101)).find((w) => w.unit === '1.1');
    check(relu && Math.abs(relu.start - avantRefus.find((w) => w.unit === '1.1').start) < 0.001, 'refus : la carte reste a son heure a l ecran');
    // Le groupe reste pris apres un refus : « Annuler » rend la main, sans rien envoyer.
    await page.locator('#laserPlanningGridWrap .lp-placer button').filter({ hasText: /^Annuler$/ }).click();
    check(await page.evaluate(() => !lpEtat.choisi && !document.querySelector('#laserPlanningGridWrap .lp.is-choix')) && requetes.length === ecritures, 'refus : « Annuler » rend la main sans rien envoyer');

    // 7. CONTRE-EPREUVE DU SUCCES : un 200 qui ne prouve pas le nouvel horaire
    //    n est pas un succes. Le serveur repond oui sans rien ecrire ; la
    //    console ne doit ni le croire ni deplacer la carte.
    await recharger(page);
    const avantMensonge = await fenetresBase(page, 7102);
    await page.evaluate(() => { window.__QA_MENTIR__ = true; });
    const menti = await glisser(page, { id: 7102, unit: '2.1', vers: 22 });
    console.log(`   serveur qui ment :: notices ${JSON.stringify(menti.notices)}`);
    check(succes(menti.notices).length === 0, 'serveur qui ment : aucun message de succes sur un simple 200');
    check(refus(menti.notices).length === 1, 'serveur qui ment : UN message qui demande d actualiser');
    assert.deepEqual(await fenetresBase(page, 7102), avantMensonge); checks += 1; console.log('OK serveur qui ment : la base est inchangee');
    const resteMenti = (await fenetres(page, 7102)).find((w) => w.unit === '2.1');
    check(resteMenti && Math.abs(resteMenti.start - avantMensonge.find((w) => w.unit === '2.1').start) < 0.001, 'serveur qui ment : la carte reste a son heure a l ecran');

    check(erreurs.length === 0, `aucune erreur navigateur (${erreurs.join(' | ')})`);
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify({ checks, requetes, ecrituresSql, erreurs, remoteWrites: 0, jour: JOUR }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, requetes: requetes.length, ecrituresSql, jour: JOUR }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error('\nlaser-move-truth-check FAIL:', error.stack || error.message); process.exitCode = 1; });
