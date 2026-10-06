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
    pret = await page.evaluate(() => { const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda'); return Boolean(ag) && ag.getBoundingClientRect().height > 100; });
    if (!pret) { await page.evaluate(() => { state.staffResourceView = 'laser'; state.staffLaserPlanningExpanded = true; renderStaff(); }); await page.waitForTimeout(300); }
  }
  assert.ok(pret, 'agenda laser rendu et mesurable');
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

// Glisser une unite (carte posee ou carte de la file) jusqu au DEBUT d une rangee.
async function glisser(page, { id, unit, vers, enFile = false }) {
  const pos = await page.evaluate(({ id, unit, vers, enFile }) => {
    const ag = document.querySelector('.laser-planning-box.expanded .laser-agenda');
    const carte = document.querySelector(`${enFile ? '.laser-pass-card' : '.laser-group-card'}[data-laser-res-id="${id}"][data-laser-unit="${unit}"]`);
    const ligne = document.querySelector(`.laser-agenda-row[data-laser-time-start="${vers}"]`);
    if (!ag || !carte || !ligne) {
      const r = state.reservations.find((x) => Number(x.id) === Number(id));
      const file = [...document.querySelectorAll('.laser-pass-card')].map((el) => `${el.dataset.laserResId}/${el.dataset.laserUnit}`);
      const attente = r ? getPendingLaserPassesForReservation(r).map((p) => p.unitKey) : null;
      return { raison: `agenda=${Boolean(ag)} carte=${Boolean(carte)} ligne=${Boolean(ligne)} ; file=${JSON.stringify(file)} ; attente=${JSON.stringify(attente)} ; plan=${JSON.stringify(r?.opsPlan?.laserPassPlan)} ; blocs=${JSON.stringify((r?.opsPlan?.resourceBlocks || []).filter((b) => b.resourceType === 'laser_arena').map((b) => [b.countIndex, b.groupWaveIndex, b.startTime, b.manualLaserPass]))}` };
    }
    const haut = 150, bas = window.innerHeight - 40, milieu = haut + (bas - haut) / 2;
    const scroller = enFile ? null : ag;
    for (let essai = 0; essai < 14 && scroller; essai += 1) {
      const bc = carte.getBoundingClientRect(), bl = ligne.getBoundingClientRect();
      const centre = ((bc.top + bc.height / 2) + (bl.top + bl.height / 2)) / 2;
      const ecart = centre - milieu;
      if (Math.abs(ecart) <= 2) break;
      scroller.scrollTop += ecart;
    }
    if (enFile) { ligne.scrollIntoView({ block: 'center' }); carte.scrollIntoView({ block: 'nearest' }); }
    const c = carte.getBoundingClientRect(), l = ligne.getBoundingClientRect();
    const visible = (r) => r.height > 4 && r.top > haut && r.bottom < bas;
    if (!visible(c) || !visible(l)) return { raison: `carte ${Math.round(c.top)}-${Math.round(c.bottom)}, ligne ${Math.round(l.top)}-${Math.round(l.bottom)}, fenetre ${window.innerHeight}` };
    return { carte: { x: c.x + c.width / 2, y: c.y + c.height / 2 }, cible: { x: l.x + Math.min(l.width - 40, l.width * 0.45), y: l.top + 2 } };
  }, { id, unit, vers, enFile });
  assert.ok(pos && pos.carte, `carte ${id}/${unit} et rangee ${vers} visibles ensemble${pos && pos.raison ? ' :: ' + pos.raison : ''}`);
  await page.evaluate(() => { window.__NOTICES__ = []; });
  const avant = requetes.length;
  await page.mouse.move(pos.carte.x, pos.carte.y); await page.mouse.down();
  await page.mouse.move(pos.carte.x + 8, pos.carte.y + 8, { steps: 2 });
  await page.mouse.move(pos.cible.x, pos.cible.y, { steps: 12 }); await page.mouse.up();
  // La reponse du serveur et son traitement : on attend que plus rien ne soit en vol.
  await page.waitForFunction(() => !planningMoveSelection?.saving && !laserPointerDrag, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  return { requetes: requetes.slice(avant), notices: await page.evaluate(() => window.__NOTICES__.slice()) };
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
  console.log(`   ${label} :: base avant ${JSON.stringify(avantBase)} -> apres ${JSON.stringify(apresBase)} ; notices ${JSON.stringify(resultat.notices)}`);
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
    // 3. Grand groupe : la vague 2 seule -> 18:30 (la vague 1 reste). Les cibles
    //    restent a moins de trois heures de la carte : la souris ne defile pas.
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
    console.log(`   refus :: notices ${JSON.stringify(r.notices)}`);
    check(succes(r.notices).length === 0, 'refus : aucun message de succes');
    check(refus(r.notices).length === 1, 'refus : UN message');
    const texte = refus(r.notices)[0] || {};
    check(mots(`${texte.title || ''} ${texte.message || texte.toast || ''}`) <= 16, `refus : court (${mots(`${texte.title || ''} ${texte.message || texte.toast || ''}`)} mots) : « ${texte.title || ''} · ${texte.message || texte.toast || ''} »`);
    check(/complet|plein|arme|joueur/i.test(`${texte.title || ''} ${texte.message || texte.toast || ''}`), 'refus : il dit pourquoi (capacite)');
    assert.deepEqual(await fenetresBase(page, 7101), avantRefus); checks += 1; console.log('OK refus : la base est inchangee');
    const relu = (await fenetres(page, 7101)).find((w) => w.unit === '1.1');
    check(relu && Math.abs(relu.start - avantRefus.find((w) => w.unit === '1.1').start) < 0.001, 'refus : la carte reste a son heure a l ecran');
    console.log(`   refus :: ${requetes.length - ecritures} requete(s) serveur`);

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
