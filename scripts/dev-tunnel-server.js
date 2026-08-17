// SERVEUR DE DEV DU TUNNEL : la page reelle + APIs mockees, pour REGARDER
// l'ecran soi-meme (lecon du 2026-08-15 : trois passes validees aux chiffres
// sans qu'un seul ecran soit regarde). Meme mecanique que le gate one-screen :
// statique + public-booking-meta fabrique + public-availability reel sur un
// instantane vide. Zero acces base.
//
// Lancement : node scripts/dev-tunnel-server.js  (port 4230)
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const database = require('../lib/database');

const PORT = Number(process.env.PINLANE_DEVTUNNEL_PORT || 4230);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
];

// Le branding se regle a la volee : /?brand=aurora pose un exemple complet
// (couleur + axes de style), /?brand=none rien. Sert a VOIR la
// personnalisation sans toucher a une config.
function brandingFor(mode) {
  if (mode === 'aurora') {
    return {
      accent: '#7c3aed', accentStrong: '#6d28d9', accentSoft: '#f1e9fe', accentContrast: '#ffffff',
      radius: 'round', backdrop: 'aurora', cards: 'shadow', buttons: 'pill',
      dark: { accent: '#a78bfa', accentStrong: '#c4b5fd', accentSoft: '#2a1c4f', accentContrast: '#120a26' },
    };
  }
  if (mode === 'sharp') {
    return { accent: '#0f766e', accentStrong: '#0d5f58', accentSoft: '#e0f2f0', accentContrast: '#ffffff', radius: 'sharp', font: 'mono', cards: 'flat', buttons: 'rounded', backdrop: 'tint' };
  }
  return null;
}

function metaPayload(brandMode) {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
    center: {
      id: 'libramont', status: 'active',
      branding: brandingFor(brandMode),
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

let brandMode = String(process.env.PINLANE_DEVTUNNEL_BRAND || '').trim();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.searchParams.has('brand')) brandMode = url.searchParams.get('brand');
  if (url.pathname === '/api/public-booking-meta') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(metaPayload(brandMode))); return; }
  if (url.pathname === '/api/public-availability') { try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); } return; }
  if (url.pathname === '/api/public-reservations') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, reservation: { id: 1 }, ops: {}, communications: [], warnings: [] })); }); return; }
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '/reserver') filePath = path.join(ROOT, 'index.html');
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev-tunnel-server: http://127.0.0.1:${PORT}/reserver (brand: /?brand=aurora | sharp | none)`);
});
