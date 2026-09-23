// SERVEUR DE DEV DU TUNNEL : la page reelle + APIs mockees, pour REGARDER
// l'ecran soi-meme (lecon du 2026-08-15 : trois passes validees aux chiffres
// sans qu'un seul ecran soit regarde). Meme mecanique que le gate one-screen :
// statique + public-booking-meta fabrique + public-availability reel sur un
// instantane vide. Zero acces base.
//
// Lancement : node scripts/dev-tunnel-server.js  (port 4230)
//
//   http://127.0.0.1:4230/reserver                 le tunnel actuel
//   http://127.0.0.1:4230/fungalaxy/libramont      le formulaire Fun Galaxy (v3)
//   http://127.0.0.1:4230/reserver/libramont       le meme, tel qu il serait
//       pose sur le site de Fun Galaxy (fungalaxy-site.html, comme en prod)
//   http://127.0.0.1:4230/fungalaxy-local#booking  la page /contact/ de
//       fungalaxy.be, telechargee a chaque requete, avec le formulaire Fun
//       Galaxy monte a la place du Gravity Form, par embed.js. Rien n est
//       ecrit sur le site du client : c est une copie locale, en lecture.
//
// Le module s exporte aussi (metaPayload, createServer) pour les gates qui
// veulent le MEME mock que l ecran regarde a la main, sans le recopier.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const database = require('../lib/database');
// Hors reseau : la table statique des conges scolaires fait foi (c est le
// serveur de prod qui relit le calendrier officiel, pas le mock).
process.env.PINLANE_CALENDAR_SYNC = 'off';
const { BOWLING_PRICES, DURATION_OPTIONS, LASER_GAME_OPTIONS, FUN_RUN_OPTIONS, FORMULES } = require('../lib/booking-config');
const FUN_GALAXY_CENTER = require('../ops-knowledge/centers.json').centers.find((center) => center.id === 'libramont');

const PORT = Number(process.env.PINLANE_DEVTUNNEL_PORT || 4230);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: 'libramont' });
const availability = require('../api/public-availability.js');
// Le calendrier des prochains jours, calcule par le VRAI code du serveur (feries,
// conges scolaires, horaires de vacances du centre reel), sans base : blocages vides.
const { buildCalendar, calendarFromParam } = require('../api/public-booking-meta.js').__test;

const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  // Les textes du mock suivent la RICHESSE du catalogue de prod (prix saisi,
  // notes longues) : un mock plus court que la prod cache les cartes qui
  // regonflent (lecon du 2026-08-18, le CTA sous le pli n existait qu en prod).
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', note: 'accès à la journée', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs par session', order: 9, defaultMinutes: 15, units: 1, capacityPerUnit: 5 },
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

// La reponse de /api/public-booking-meta, avec les MEMES cles que la prod
// (api/public-booking-meta.js) : grilles reelles (lib/booking-config), identite
// et contact reels du centre (ops-knowledge/centers.json). Seule la liste des
// activites est un mock, faute de base.
function metaPayload(brandMode, calendarDays = 0, calendarFrom = '') {
  const info = FUN_GALAXY_CENTER.publicInfo || {};
  const bowling = FUN_GALAXY_CENTER.resources && FUN_GALAXY_CENTER.resources.bowling ? FUN_GALAXY_CENTER.resources.bowling : {};
  return {
    ok: true, today: TODAY, bookingHorizonDays: 365, durationOptions: DURATION_OPTIONS, formules: FORMULES, activities: ACTIVITIES,
    laserOptions: LASER_GAME_OPTIONS, bowlingPrices: BOWLING_PRICES, funRunOptions: FUN_RUN_OPTIONS,
    center: {
      id: 'libramont', status: 'active', demonstration: false,
      name: FUN_GALAXY_CENTER.name,
      city: info.city || '',
      identity: FUN_GALAXY_CENTER.identity,
      contact: { phone: info.phone || '', email: info.email || '' },
      branding: brandingFor(brandMode) || FUN_GALAXY_CENTER.branding,
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      activityAvailability: FUN_GALAXY_CENTER.activityAvailability || null,
      booking: {
        laneCount: Number(bowling.laneCount) || 8,
        normalCapacityPerLane: Number(bowling.normalCapacityPerLane) || 6,
        emergencyCapacityPerLane: Number(bowling.emergencyCapacityPerLane) || 7,
        bowlingPrices: BOWLING_PRICES, laserOptions: LASER_GAME_OPTIONS,
        laserArenaCapacity: Number(FUN_GALAXY_CENTER.resources && FUN_GALAXY_CENTER.resources.laser && FUN_GALAXY_CENTER.resources.laser.weaponCount) || null,
      },
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {}, formulaHolidayOff: false },
      ...(calendarDays ? { calendar: buildCalendar([], calendarDays, FUN_GALAXY_CENTER, 'libramont', calendarFrom) } : {}),
    },
  };
}

// Le POST est un FAUX : rien n est ecrit nulle part. Il renvoie un dossier
// qui reprend la demande (date, heure, groupe, contact, montant affiche) avec
// les cles que le vrai serveur rend (validationStatus, ops.autoDecision), pour
// que l ecran final se lise comme en prod. Comme le vrai serveur pour un
// dossier confirme (lib/ops-communications.js), la confirmation n est mise en
// file que si un e-mail est fourni. Le corps recu est garde en memoire pour
// les gates (dernierePose).
let compteur = 0;
const dernierePose = { body: null };
function fauxDossier(body) {
  compteur += 1;
  const b = body && typeof body === 'object' ? body : {};
  return {
    ok: true,
    reservation: {
      id: 4200 + compteur, centerId: b.centerId || 'libramont', channel: 'public', status: 'pending',
      validationStatus: 'confirmed', date: b.date || DATE, startTime: b.startTime || '', pax: Number(b.pax) || 0,
      name: b.name || '', email: b.email || '', phone: b.phone || '', type: b.type || 'visite', formuleId: b.formuleId || '',
      label: b.label || '', price: Number(b.price) || 0, opsPlan: b.opsPlan || null, lanes: Array.isArray(b.lanes) ? b.lanes : [],
    },
    ops: { validationStatus: 'confirmed', autoDecision: 'auto_confirmed', riskLevel: 'low', riskScore: 0, planWarning: '' },
    communications: b.email ? [{ channel: 'email', templateId: 'confirmation', recipient: b.email, status: 'queued' }] : [], warnings: [],
  };
}

// LA PAGE DU CLIENT, EN COPIE LOCALE. On telecharge /contact/ de fungalaxy.be
// a chaque requete (aucun cache : on regarde toujours la page du jour), on
// ancre ses liens relatifs sur le vrai site (<base>), on eteint ses overlays
// (popup, bandeau cookies), on vide le bloc #booking (titre, portrait, Gravity
// Form) et on y monte le formulaire par embed.js, exactement comme le fera
// l agence du client : une balise <script>, rien d autre.
const FUN_GALAXY_CONTACT_URL = 'https://fungalaxy.be/contact/';
async function funGalaxyHostPage(port) {
  const response = await fetch(FUN_GALAXY_CONTACT_URL, { headers: { 'User-Agent': 'Pinlane local integration preview' } });
  if (!response.ok) throw new Error(`Fun Galaxy ${response.status}`);
  let html = await response.text();
  const head = [
    '<base href="https://fungalaxy.be/">',
    '<meta name="robots" content="noindex,nofollow">',
    '<style data-pinlane-local-host>',
    'html,body{overflow-x:hidden}',
    'body.no-scroll{overflow-y:auto!important}',
    '#popup,#cookie-law-info-bar,.cli-modal-backdrop{display:none!important}',
    '#booking{scroll-margin-top:180px;padding:32px 0 72px}',
    '#booking>.container{width:min(1440px,100%);max-width:none}',
    '#booking>.container>*{display:none!important}',
    '#booking>.container>.pinlane-local-slot{display:block!important}',
    '#booking .pinlane-local-slot{width:100%}',
    '#booking .pinlane-local-slot iframe{background:#050505;display:block;width:100%;border:0}',
    '</style>',
  ].join('');
  html = html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  const embed = [
    '<script>',
    'document.body.classList.remove("no-scroll");',
    'var localCenter=document.getElementById("selection-1");',
    'if(localCenter)localCenter.value="Libramont";',
    'var localBooking=document.querySelector("#booking>.container");',
    'if(localBooking)localBooking.innerHTML="<div class=\\"pinlane-local-slot\\"></div>";',
    '</script>',
    '<script',
    ` src="http://127.0.0.1:${port}/embed.js"`,
    ' data-center="libramont"',
    ' data-design="fungalaxy"',
    ' data-target=".pinlane-local-slot"',
    ' data-height="720"',
    ' data-scroll-margin="32"',
    ' data-track="datalayer"',
    '></script>',
  ].join('');
  return html.replace(/<\/body>/i, `${embed}</body>`);
}

function createServer(options = {}) {
  const port = Number(options.port || PORT);
  let brandMode = String(process.env.PINLANE_DEVTUNNEL_BRAND || '').trim();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.searchParams.has('brand')) brandMode = url.searchParams.get('brand');
    if (url.pathname === '/fungalaxy-local' || url.pathname === '/fungalaxy-local/') {
      try {
        const html = await funGalaxyHostPage(port);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`Impossible de charger la copie locale de Fun Galaxy: ${error.message}`);
      }
      return;
    }
    if (url.pathname === '/api/public-booking-meta') {
      const calendarDays = Math.min(90, Math.max(0, Math.trunc(Number(url.searchParams.get('calendar')) || 0)));
      const calendarFrom = calendarFromParam(url.searchParams.get('calendarFrom'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(metaPayload(brandMode, calendarDays, calendarFrom)));
      return;
    }
    if (url.pathname === '/api/public-availability') { try { await availability(req, res); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false })); } return; }
    if (url.pathname === '/api/public-reservations') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (error) { parsed = null; }
        dernierePose.body = parsed;
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(fauxDossier(parsed)));
      });
      return;
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '/reserver' || /^\/reserver\/[a-z0-9-]+\/?$/.test(url.pathname)) filePath = path.join(ROOT, 'index.html');
    if (url.pathname === '/fungalaxy' || /^\/fungalaxy\/[a-z0-9-]+\/?$/.test(url.pathname)) filePath = path.join(ROOT, 'fungalaxy.html');
    // Comme en production (vercel.json) : /reserver/libramont sert le
    // formulaire Fun Galaxy tel qu il serait pose sur leur site.
    if (/^\/reserver\/libramont\/?$/.test(url.pathname)) filePath = path.join(ROOT, 'fungalaxy-site.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
}

module.exports = { ACTIVITIES, DATE, TODAY, PORT, createServer, metaPayload, dernierePose };

if (require.main === module) {
  createServer({ port: PORT }).listen(PORT, '127.0.0.1', () => {
    console.log(`dev-tunnel-server: http://127.0.0.1:${PORT}/reserver (brand: /?brand=aurora | sharp | none)`);
    console.log(`fun-galaxy-form:   http://127.0.0.1:${PORT}/fungalaxy/libramont`);
    console.log(`fun-galaxy-host:   http://127.0.0.1:${PORT}/fungalaxy-local#booking`);
  });
}
