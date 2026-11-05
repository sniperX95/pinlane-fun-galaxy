'use strict';
// LE BANC COMPLET : la vraie page et tous les vrais gestionnaires du depot, sur une base en memoire. Les reglages
// des centres sont ceux de la prod (lus publiquement), les horaires ceux du site. Rien ne part en ligne en ecriture.
const fs = require('fs');
const http = require('http');
const path = require('path');
const WT = path.resolve(__dirname, '..', '..');
const PROD = 'https://app.pinlane.be';
for (const nom of Object.keys(process.env)) if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i.test(nom)) delete process.env[nom];
process.chdir(WT);
const req_ = (rel) => require(path.join(WT, rel));
function mock(rel, exports) { const r = require.resolve(path.join(WT, rel)); require.cache[r] = { id: r, filename: r, loaded: true, exports }; }
mock('lib/rate-limit', { enforceRateLimit: () => false, checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }), getClientIp: () => 'banc' });

const HEURES_SITE = {
  regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
  holiday: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } },
};

const kn = req_('lib/ops-knowledge');
kn.refreshCenterOverrides = async () => false;
kn.refreshCatalog = async () => false;
const cfg = req_('lib/booking-config');
cfg.refreshFormuleOverrides = async () => false;
const database = req_('lib/database');
const RESAS = [];
const TOUS = [];
const HOLDS = [];
let id = 5000;
database.readAvailabilitySnapshot = async (date, centerId) => ({ date, centerId, laneStatuses: {}, blocks: [], reservations: RESAS.filter((r) => r.date === date && r.centerId === centerId) });
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
database.createSlotHold = async (p, o) => { HOLDS.push({ centerId: p.centerId, date: p.date }); return { expiresAt: new Date(Date.now() + 600000).toISOString(), minutes: 10, jeton: o && o.jeton }; };
database.readMatchingSlotHold = async () => null;
database.readUpsellSlotHold = async () => null;
database.releaseSlotHold = async () => ({ released: 1 });
if (database.reservationDejaConfirmee) database.reservationDejaConfirmee = async () => null;
database.createReservation = async (payload) => {
  const range = database.normalizeReservationPayload({ ...payload }, {});
  const row = { ...range, id: id += 1, date: payload.date, centerId: payload.centerId, status: range.status || 'pending', opsPlan: payload.opsPlan, program: payload.program, price: payload.price ?? range.price, pax: payload.pax };
  TOUS.push(row);
  RESAS.push(row);
  return row;
};
const rops = req_('lib/reservation-ops');
rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });
const reservations = req_('api/public-reservations.js');
const availability = req_('api/public-availability.js');
const meta = req_('api/public-booking-meta.js');

async function chargerReglages() {
  const lus = {};
  for (const c of ['libramont', 'gembloux']) lus[c] = await (await fetch(`${PROD}/api/public-booking-meta?centerId=${c}`)).json();
  const socleC = JSON.parse(fs.readFileSync(path.join(WT, 'ops-knowledge/centers.json'), 'utf8'));
  const fiche = (c) => (socleC.centers || socleC).find((x) => x.id === c);
  const reglage = (c) => {
    const m = lus[c].center;
    const res = fiche(c).resources || {};
    return {
      defaultSchedule: process.env.ESSAI_HEURES_PROD ? m.defaultSchedule : HEURES_SITE,
      holidaySettings: process.env.ESSAI_FERIES_PROD ? m.holidaySettings : { enabled: true, overrides: [], formulaBlockedPeriods: ['manual', 'public', 'school_short'] },
      offerAvailability: m.offerAvailability,
      activityAvailability: m.activityAvailability,
      branding: m.branding,
      resources: { ...res, laser: { ...(res.laser || {}), weaponCount: m.booking.laserArenaCapacity, parallelLaunches: m.booking.laserParallelLaunches, ...(m.booking.laserParallelLaunches > 1 ? { canSplitGroupsCleanly: true, requiresCompleteGroupBeforeLaunch: false } : {}) } },
    };
  };
  kn.applyCenterOverrides(new Map([['libramont', reglage('libramont')], ['gembloux', reglage('gembloux')]]));
  const socle = JSON.parse(fs.readFileSync(path.join(WT, 'ops-knowledge/activities.json'), 'utf8')).activities;
  const parId = new Map();
  for (const c of ['libramont', 'gembloux']) for (const a of lus[c].activities) if (a.priceValue != null) parId.set(a.id, a);
  const lignes = [...parId.values()].map((a, i) => { const b = socle.find((x) => x.id === a.id) || {}; return { id: a.id, center_id: null, name: b.name || a.name, resource_type: b.resourceType, duration_model: b.durationModel, service_model: b.serviceModel, risk_drivers: b.riskDrivers, planning_pressure: b.planningPressure, price_type: a.priceType, price_value: a.priceValue, price_unit: a.unitLabel || null, booking_order: i, bookable: true, active: true, source: 'seed' }; });
  req_('lib/catalog-store').applyCatalogState({ activities: lignes });
  return lus;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.avif': 'image/avif' };
function servirFichier(res, rel) {
  const p = path.join(WT, rel);
  if (!p.startsWith(path.join(WT)) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end('absent'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}
function creerServeur() {
  return http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://banc');
    try {
      if (u.pathname === '/api/public-booking-meta' && rq.method === 'POST') { rq.resume(); rs.writeHead(202, { 'Content-Type': 'application/json' }); rs.end('{"ok":true,"enregistres":0}'); return; }
      if (u.pathname === '/api/public-booking-meta') { await meta(rq, rs); return; }
      if (u.pathname === '/api/public-availability') { await availability(rq, rs); return; }
      if (u.pathname === '/api/public-holds') { rq.url = '/api/public-reservations?action=hold'; await reservations(rq, rs); return; }
      if (u.pathname === '/api/public-reservations') { await reservations(rq, rs); return; }
      if (u.pathname.startsWith('/api/')) { rq.resume(); rs.writeHead(204); rs.end(); return; }
      if (/^\/fungalaxy(\/|$)/.test(u.pathname)) { servirFichier(rs, 'fungalaxy.html'); return; }
      servirFichier(rs, decodeURIComponent(u.pathname.replace(/^\/+/, '')));
    } catch (e) {
      if (!rs.headersSent) rs.writeHead(500, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ ok: false, message: String(e.message) }));
    }
  });
}
module.exports = { WT, HEURES_SITE, RESAS, TOUS, HOLDS, chargerReglages, creerServeur, req_ };
