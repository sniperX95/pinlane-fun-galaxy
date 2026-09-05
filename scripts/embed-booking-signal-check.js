// LE SITE HOTE APPREND QU UNE RESERVATION VIENT D ETRE PRISE.
//
// POURQUOI CE GATE EXISTE. Le tunnel vit dans une iframe sur le site du centre
// (embed.js). Un cadre d une autre origine est opaque : GA4, GTM et le Pixel
// Meta du site ne voient ni le parcours ni la confirmation. Fun Galaxy mesure
// aujourd hui ses demandes de reservation par un evenement Meta
// « CompleteRegistration » branche sur son ancien formulaire (releve du
// 2026-09-05 sur fungalaxy.be) : poser Pinlane a la place couperait cette
// mesure en silence, et l agence du client l a demande noir sur blanc (« qu on
// ne perde pas en donnees »). Ce gate verrouille le signal qui la remplace.
//
// LES QUATRE PROPRIETES :
//
//   [A] A LA CONFIRMATION, LE SITE HOTE RECOIT L EVENEMENT. Son dataLayer porte
//       une entree `pinlane_booking` ET un CustomEvent `pinlane:booking` est
//       distribue, avec le montant REEL du dossier cree (relu dans la liste des
//       reservations du gate, jamais dans l ecran), le centre, la date, le
//       nombre de personnes, l identifiant du dossier et un statut.
//
//   [B] RIEN NE PART AVANT LA CONFIRMATION. Au recapitulatif, le dataLayer du
//       site hote est vide.
//
//   [C] AUCUNE DONNEE PERSONNELLE NE SORT DU CADRE. Ni le nom, ni le telephone,
//       ni l email du client n apparaissent dans ce qui est pousse au site.
//
//   [D] LE SIGNAL EST NECESSAIRE ET SUFFISANT. Contre-epreuves par mutation
//       servies en memoire : sans l emission dans le tunnel, le site ne recoit
//       rien ; sans le relais dans embed.js, le message arrive mais le
//       dataLayer reste vide.
//
// LE MONTAGE EST ASSERTE AVANT CHAQUE PROPRIETE : l iframe est posee par
// embed.js lui-meme (pas par une balise ecrite a la main), le tunnel atteint l
// ecran de confirmation, et UN dossier a ete cree par le vrai handler
// api/public-reservations (la base est remplacee par une liste en memoire, le
// .env du depot porte la production et n est jamais ouvert).
//
// Usage : node scripts/embed-booking-signal-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_EMBED_BOOKING_PORT || 4647);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function prochainSamedi() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = prochainSamedi();
const CENTRE = 'libramont';
const PAX = 8;
const FORMULE = 'f5';
// Le client mis en scene. Ces trois valeurs ne doivent JAMAIS atteindre le site
// hote : c est la propriete [C].
const CLIENT = { nom: 'Marie Dupont', telephone: '+32 470 00 00 00', email: 'marie@exemple.be' };

// ---------------------------------------------------------------------------
// LA BASE EST REMPLACEE PAR UNE LISTE EN MEMOIRE, les HANDLERS sont les vrais.
// ---------------------------------------------------------------------------
function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mock('lib/rate-limit', {
  enforceRateLimit: () => false,
  checkRateLimit: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  getClientIp: () => 'gate',
});

const database = require(path.join(ROOT, 'lib/database'));
const RESERVATIONS = [];
let nextId = 100;
database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({
  date, centerId, laneStatuses: {}, blocks: [],
  reservations: RESERVATIONS.filter((r) => r.date === date && (r.centerId || CENTRE) === centerId),
});
database.readStaffState = database.readAvailabilitySnapshot;
database.createOpsEvent = async () => ({});
database.createReservation = async (payload) => {
  const range = database.normalizeReservationPayload({ ...payload }, {});
  const row = { ...range, id: nextId += 1, date: payload.date, centerId: payload.centerId, status: range.status || 'pending' };
  RESERVATIONS.push(row);
  return row;
};

const {
  BOWLING_PRICES, DURATION_OPTIONS, LASER_GAME_OPTIONS,
  getEffectiveFormules, getSchedule, resolveBowlingCapacity,
} = require(path.join(ROOT, 'lib/booking-config'));
const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge'));
const { listSellableActivities } = require(path.join(ROOT, 'lib/activity-catalog'));
const rops = require(path.join(ROOT, 'lib/reservation-ops'));
// Les hooks post-creation (emails, jobs) parlent au reseau : neutralises.
rops.afterReservationCreated = async () => ({ communications: [], warnings: [] });
const availabilityHandler = require(path.join(ROOT, 'api/public-availability.js'));
const reservationsHandler = require(path.join(ROOT, 'api/public-reservations.js'));

function metaPayload() {
  const centre = getCenter(CENTRE);
  const capacite = resolveBowlingCapacity(CENTRE);
  const horaire = getSchedule(DATE) || { open: 10, close: 24, label: '' };
  return {
    ok: true, today: DATE, bookingHorizonDays: 365, durationOptions: DURATION_OPTIONS,
    formules: getEffectiveFormules(CENTRE), laserOptions: LASER_GAME_OPTIONS, bowlingPrices: BOWLING_PRICES,
    activities: listSellableActivities({ centerId: CENTRE, availability: centre.activityAvailability || null }),
    center: {
      id: centre.id, name: centre.name || '', city: '', identity: centre.identity || null, status: centre.status || 'active',
      branding: centre.branding || null, defaultSchedule: centre.defaultSchedule || null,
      holidaySettings: centre.holidaySettings || { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: centre.offerAvailability || {}, activityAvailability: centre.activityAvailability || null,
      booking: { laneCount: capacite.laneCount, normalCapacityPerLane: capacite.normalCapacityPerLane, emergencyCapacityPerLane: capacite.emergencyCapacityPerLane, bowlingPrices: BOWLING_PRICES, laserOptions: LASER_GAME_OPTIONS },
      day: { date: DATE, open: true, schedule: horaire, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

// ---------------------------------------------------------------------------
// LA PAGE HOTE : le site d un centre, qui colle LA ligne d installation et
// ecoute ce qui lui arrive, comme le ferait un conteneur GTM.
// ---------------------------------------------------------------------------
const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<header style="height:56px;background:#1b1b2f"></header><main><h1>Réservez</h1>
<script>
window.dataLayer = [];
window.__messages = [];
window.__customs = [];
addEventListener('message', function (e) { if (e.data && typeof e.data.type === 'string') window.__messages.push(e.data.type); });
addEventListener('pinlane:booking', function (e) { window.__customs.push(e.detail); });
</script>
<script src="${BASE_URL}/embed.js" data-center="${CENTRE}"></script>
</main></body></html>`;

const overrides = new Map();
function sourceDisque(fichier) {
  return fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}
async function avecMutationClient(editions, fn) {
  editions.forEach(({ fichier, de, vers }) => {
    const source = sourceDisque(fichier);
    if (source.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${fichier} : ${de.slice(0, 70)}`);
    overrides.set(fichier, source.split(de).join(vers));
  });
  try { return await fn(); } finally { overrides.clear(); }
}

function serveur() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (url.pathname === '/api/public-booking-meta') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(metaPayload())); return; }
    if (url.pathname === '/api/public-availability') {
      try { await availabilityHandler(req, res); } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) })); }
      return;
    }
    if (url.pathname === '/api/public-reservations') {
      try { await reservationsHandler(req, res); } catch (error) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }));
      }
      return;
    }
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel === 'reserver' || rel.startsWith('reserver/')) rel = 'index.html';
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    const filePath = path.join(ROOT, rel);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------------------
// LE PARCOURS, dans l iframe posee par embed.js. Un contexte NEUF par scenario.
// ---------------------------------------------------------------------------
let enMutation = false;
async function parcours(browser) {
  RESERVATIONS.length = 0;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    if (enMutation) { console.log(`      (mutation) erreur JS : ${e.message}`); return; }
    ok(false, `erreur JS dans la page : ${e.message}`);
  });
  const lireHote = () => page.evaluate(() => ({
    pousses: (window.dataLayer || []).filter((e) => e && e.event === 'pinlane_booking'),
    customs: window.__customs.slice(),
    messages: window.__messages.slice(),
    iframes: document.querySelectorAll('iframe').length,
  }));
  try {
    await page.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) return { montage: { iframe: false }, hote: await lireHote() };
    await frame.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 20000 });
    await frame.evaluate(({ d, id, p }) => {
      state.view = 'client';
      state.booking.date = d;
      state.booking.pax = p;
      state.booking.venueConfirmed = true;
      setView('client');
      setType('formule');
      selectFormule(id);
      syncBookingTypeUi();
      goStep(1, { animate: false, focus: false });
    }, { d: DATE, id: FORMULE, p: PAX });
    await frame.waitForTimeout(300);
    await frame.evaluate(() => goStep2());
    await frame.waitForTimeout(1200);
    if (await frame.evaluate(() => Number(state.step) === 1)) { await frame.evaluate(() => goStep2()); await frame.waitForTimeout(1200); }
    await frame.waitForFunction(() => Array.isArray(state.availableSlots) && state.availableSlots.length > 0, null, { timeout: 20000 });
    await frame.evaluate(() => { const i = getCurrentFormulaAnchorSlotIndex(); if (i >= 0) selectSlot(i); });
    await frame.waitForTimeout(400);
    await frame.evaluate((c) => {
      document.getElementById('fName').value = c.nom;
      document.getElementById('fPhone').value = c.telephone;
      document.getElementById('fEmail').value = c.email;
      goStep4();
    }, CLIENT);
    await frame.waitForTimeout(700);
    const auRecap = await lireHote();
    const etapeRecap = await frame.evaluate(() => Number(state.step));
    await frame.evaluate(async () => { await confirmBooking(); });
    await frame.waitForFunction(() => Number(state.step) === 5, null, { timeout: 20000 }).catch(() => {});
    await frame.waitForTimeout(500);
    const etapeFinale = await frame.evaluate(() => Number(state.step));
    const hote = await lireHote();
    return {
      montage: { iframe: true, etapeRecap, etapeFinale, dossiers: RESERVATIONS.length, dossier: RESERVATIONS[0] || null },
      auRecap,
      hote,
    };
  } finally {
    await context.close();
  }
}

(async () => {
  const server = await serveur();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  try {
    console.log(`[date] samedi de reference : ${DATE}, ${CENTRE}, formule ${FORMULE}, ${PAX} personnes`);

    // =====================================================================
    console.log('\n[montage] embed.js pose l iframe, le tunnel confirme, le vrai handler cree UN dossier');
    // =====================================================================
    const r = await parcours(browser);
    const m = r.montage;
    ok(m.iframe && r.hote.iframes === 1, 'l iframe est posee par embed.js (une seule)');
    ok(m.etapeRecap === 4, 'le tunnel etait au recapitulatif avant la confirmation', `etape ${m.etapeRecap}`);
    ok(m.etapeFinale === 5, 'le tunnel atteint l ecran de confirmation', `etape ${m.etapeFinale}`);
    ok(m.dossiers === 1 && m.dossier && Number(m.dossier.price) > 0, 'un dossier a ete cree par api/public-reservations, avec un prix', m.dossier ? `id ${m.dossier.id}, ${m.dossier.price} EUR` : 'aucun');
    ok(r.hote.messages.includes('pinlane:height'), 'le canal postMessage fonctionne (la hauteur est arrivee au site)');

    // =====================================================================
    console.log('\n[B] rien ne part avant la confirmation');
    // =====================================================================
    ok(r.auRecap.pousses.length === 0 && r.auRecap.customs.length === 0 && !r.auRecap.messages.includes('pinlane:booking'),
      'au recapitulatif, le site n a recu aucun evenement de reservation');

    // =====================================================================
    console.log('\n[A] a la confirmation, le site recoit l evenement avec le montant reel');
    // =====================================================================
    const pousse = r.hote.pousses[0] || null;
    const detail = pousse && pousse.pinlane && typeof pousse.pinlane === 'object' ? pousse.pinlane : null;
    ok(r.hote.messages.filter((t) => t === 'pinlane:booking').length === 1, 'exactement un message pinlane:booking a traverse le cadre', `${r.hote.messages.filter((t) => t === 'pinlane:booking').length}`);
    ok(r.hote.pousses.length === 1 && Boolean(detail), 'le dataLayer du site porte exactement une entree pinlane_booking avec son detail', `${r.hote.pousses.length}`);
    ok(r.hote.customs.length === 1, 'un CustomEvent pinlane:booking a ete distribue sur la page hote', `${r.hote.customs.length}`);
    if (detail && m.dossier) {
      ok(detail.reservationId === String(m.dossier.id), 'l identifiant du dossier est celui cree par le serveur', `${detail.reservationId} vs ${m.dossier.id}`);
      ok(Number(detail.amount) === Number(m.dossier.price), 'le montant est celui du dossier cree (jamais un chiffre d ecran)', `${detail.amount} vs ${m.dossier.price}`);
      ok(detail.currency === 'EUR', 'la devise est EUR');
      ok(detail.center === CENTRE, 'le centre est celui de la ligne d installation', `${detail.center}`);
      ok(detail.date === DATE && Number(detail.pax) === PAX, 'date et nombre de personnes sont ceux du dossier', `${detail.date}, ${detail.pax}`);
      ok(detail.status === 'confirmed' || detail.status === 'received', 'le statut est confirmed ou received', `${detail.status}`);
      ok(JSON.stringify(r.hote.customs[0]) === JSON.stringify(detail), 'le CustomEvent porte le meme detail que le dataLayer');
    }

    // =====================================================================
    console.log('\n[C] aucune donnee personnelle ne sort du cadre');
    // =====================================================================
    const sorti = JSON.stringify({ p: r.hote.pousses, c: r.hote.customs }).toLowerCase();
    const fuites = ['marie', 'dupont', '470 00 00 00', 'exemple.be'].filter((t) => sorti.includes(t));
    ok(r.hote.pousses.length > 0 && fuites.length === 0, 'ni nom, ni telephone, ni email dans ce qui est pousse au site', fuites.length ? `fuite : ${fuites.join(', ')}` : '');

    // =====================================================================
    console.log('\n[D] contre-epreuves par mutation (servies en memoire, disque intact)');
    // =====================================================================
    enMutation = true;
    try {
      const sansEmission = await avecMutationClient([{
        fichier: 'assets/app-main.js',
        de: '  signalerReservationAuSite(dossierCree, state.booking.opsResult);',
        vers: '  /* mutation : le tunnel ne previent plus le site */',
      }], () => parcours(browser));
      ok(sansEmission.montage.etapeFinale === 5 && sansEmission.montage.dossiers === 1, 'montage de la contre-epreuve 1 : le tunnel confirme toujours');
      ok(sansEmission.hote.pousses.length === 0 && !sansEmission.hote.messages.includes('pinlane:booking'),
        'contre-epreuve 1 : sans l emission dans le tunnel, le site ne recoit rien');
    } catch (error) {
      ok(false, `contre-epreuve 1 impossible : ${error.message}`);
    }
    try {
      const sansRelais = await avecMutationClient([{
        fichier: 'embed.js',
        de: "if (data.type === 'pinlane:booking') {",
        vers: 'if (false) {',
      }], () => parcours(browser));
      ok(sansRelais.montage.etapeFinale === 5 && sansRelais.hote.messages.includes('pinlane:booking'), 'montage de la contre-epreuve 2 : le message atteint bien la page hote');
      ok(sansRelais.hote.pousses.length === 0 && sansRelais.hote.customs.length === 0,
        'contre-epreuve 2 : sans le relais d embed.js, le dataLayer du site reste vide');
    } catch (error) {
      ok(false, `contre-epreuve 2 impossible : ${error.message}`);
    }
    enMutation = false;
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
