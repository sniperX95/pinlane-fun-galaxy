// LE RESUME DU PROGRAMME DIT LE PRIX QUE LE SERVEUR FACTURERA.
//
// Mesure du 2026-09-01 sur la PROD reelle (Playwright + GET public-availability),
// la nuit avant l'ouverture Fun Galaxy Libramont :
//
//   duckpin, 13 joueurs, 1 h : l'ecran affichait « 3 pistes / 117 EUR » quand
//   le serveur facture 78 EUR (2 pistes + rotation). A 2 h : 234 affiches,
//   156 factures. Le MEME ecran se contredisait : la notif disait deja
//   « 2 pistes, le groupe joue par rotation », et le recapitulatif final 78.
//
// Cause : la branche grid_bowling de renderProgramSummary comptait les pistes
// du BOWLING (ceil(pax/6), jamais plafonne par la dotation) ; le serveur
// (lib/visit-program.js) plafonne par activity.units et fait tourner le groupe.
// Jamais surfacture (le serveur fait foi), mais le tunnel mentait VERS LE HAUT
// au moment exact ou le client decide : reservation abandonnee.
//
// Ce gate prouve la PARITE ecran/serveur, sur la vraie page et le vrai premier
// maillon serveur (normalizeReservationRequest hydrate du catalogue fixture,
// patron de la sonde a7) :
//   A. MONTAGE : la page boote, le duckpin se resout, le resume se rend, et le
//      serveur calcule (78 EUR pour 13 joueurs 1 h). Prouve que le gate mesure.
//   B. PARITE duckpin : pour pax 6 / 12 / 13 / 18 et 1 h / 2 h, le total DOM
//      est EXACTEMENT le prix du serveur, et le detail dit le compte de pistes
//      plafonne (jamais « 3 pistes » pour 2 de dotation).
//   C. NON-REGRESSION bowling : pas de plafond duckpin applique au bowling
//      (13 joueurs = 3 pistes, parite conservee).
//
// Contre-epreuve par mutation : on remet le compte de pistes non plafonne dans
// renderProgramSummary, le gate doit rougir sur B, restauration a l'identique.
//
// Lancement : node scripts/duckpin-summary-parity-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const PORT = Number(process.env.PINLANE_DUCKPIN_PORT || 4263);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CENTER = 'libramont';
const DATE = '2026-09-12';

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// La forme REELLE des deux activites en prod (GET public-booking-meta, 2026-08-31).
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, resourceType: 'bowling_lane', priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60, minMinutes: 30, maxMinutes: 180, stepMinutes: 30, note: '', maxPax: null, units: 8, capacityPerUnit: 6, unitIds: ['1', '2', '3', '4', '5', '6', '7', '8'] },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, resourceType: 'duckpin_lane', priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60, minMinutes: 60, maxMinutes: 60, stepMinutes: 30, note: '', maxPax: null, units: 2, capacityPerUnit: 6, unitIds: ['9', '10'] },
];

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [],
    activities: ACTIVITIES.map((a) => ({ ...a })),
    center: {
      id: CENTER, status: 'active',
      defaultSchedule: { regular: { 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

// --- SERVEUR : le vrai premier maillon, hydrate du meme catalogue ------------
function serverPrices() {
  const activityCatalog = require(path.join(ROOT, 'lib', 'activity-catalog.js'));
  const originale = activityCatalog.listCenterActivities;
  activityCatalog.listCenterActivities = function patched(centerId) {
    if (String(centerId || '') === CENTER) return ACTIVITIES.map((a) => ({ ...a }));
    return originale.call(this, centerId);
  };
  const { normalizeReservationRequest } = require(path.join(ROOT, 'lib', 'reservation-request.js'));
  const price = (activityId, pax, duration) => {
    const req = normalizeReservationRequest(
      {
        name: 'QA Duckpin', phone: '0470000000', email: 'qa@example.com', centerId: CENTER,
        date: DATE, startTime: '14:00', type: 'visite', pax,
        program: [{ activityId, duration }],
      },
      { channel: 'public', requireEmail: true },
    );
    const ligne = (req.program && req.program.items || []).find((item) => item.activityId === activityId) || {};
    return { price: Number(req.price), laneCount: Number(ligne.laneCount || 0) };
  };
  return price;
}

function serveStatic() {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname.startsWith('/api/')) return json(200, { ok: true, slots: [], suggestions: [] });
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// --- CLIENT : la vraie page, le vrai renderProgramSummary --------------------
async function domSummary(page, activityId, pax, duration) {
  return page.evaluate(({ activityId, pax, duration }) => {
    state.view = 'client';
    state.booking.mode = 'carte';
    state.booking.pax = pax;
    state.booking.date = state.booking.date || null;
    state.booking.activities = { [activityId]: { duration } };
    renderProgramSummary();
    const host = document.getElementById('programSummary');
    const item = host.querySelector(`.program-item[data-activity="${activityId}"]`);
    const totalText = (host.querySelector('.program-total') || {}).textContent || '';
    return {
      detail: item ? item.textContent.replace(/\s+/g, ' ').trim() : null,
      total: Number((totalText.match(/(\d+)\s*€/) || [])[1] || NaN),
      resolvable: typeof getCenterActivity === 'function' ? Boolean(getCenterActivity(activityId)) : null,
    };
  }, { activityId, pax, duration });
}

async function main() {
  const price = serverPrices();

  // --- A. MONTAGE serveur ---------------------------------------------------
  const ref = price('duckpin_bowling', 13, 1);
  ok(ref.price === 78 && ref.laneCount === 2,
    `montage serveur : 13 joueurs 1 h = ${ref.price} EUR sur ${ref.laneCount} pistes (attendu 78 / 2)`);

  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  try {
    await page.goto(`${BASE_URL}/?v=duckpin-parity`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderProgramSummary === 'function'
      || typeof renderProgramSummary === 'function', null, { timeout: 15000 });

    const montage = await domSummary(page, 'duckpin_bowling', 6, 1);
    ok(montage.resolvable === true && Boolean(montage.detail) && Number.isFinite(montage.total),
      `montage client : le resume se rend (detail « ${montage.detail} », total ${montage.total})`);

    // --- B. PARITE duckpin --------------------------------------------------
    for (const [pax, duration] of [[6, 1], [12, 1], [13, 1], [18, 1], [13, 2]]) {
      const attendu = price('duckpin_bowling', pax, duration);
      const vu = await domSummary(page, 'duckpin_bowling', pax, duration);
      const pistesOk = new RegExp(`\\b${attendu.laneCount} piste`).test(vu.detail || '');
      ok(vu.total === attendu.price && pistesOk,
        `duckpin ${pax} joueurs ${duration} h : ecran ${vu.total} EUR « ${vu.detail} » == serveur ${attendu.price} EUR / ${attendu.laneCount} pistes`);
    }

    // --- C. NON-REGRESSION bowling ------------------------------------------
    const bowlingAttendu = price('bowling', 13, 1);
    const bowlingVu = await domSummary(page, 'bowling', 13, 1);
    ok(bowlingVu.total === bowlingAttendu.price && new RegExp(`\\b${bowlingAttendu.laneCount} piste`).test(bowlingVu.detail || ''),
      `bowling 13 joueurs 1 h : ecran ${bowlingVu.total} EUR « ${bowlingVu.detail} » == serveur ${bowlingAttendu.price} EUR / ${bowlingAttendu.laneCount} pistes (pas de plafond duckpin applique au bowling)`);
  } catch (error) {
    ok(false, `exception : ${error && error.message}`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }

  if (failures) {
    console.error(`\nduckpin-summary-parity-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nduckpin-summary-parity-check: ALL OK (le resume dit le prix que le serveur facturera)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(APP, 'utf8');
  const marqueur = "        ? (plafond ? Math.min(plafond, voulues) : voulues)";
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le plafond duckpin est introuvable dans assets/app-main.js');
    process.exit(1);
  }
  // On remet le compte non plafonne : 13 joueurs redeviennent 3 pistes / 117 EUR.
  const mute = source.replace(marqueur, '        ? voulues');
  fs.writeFileSync(APP, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(APP, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans le plafond.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : retirer le plafond fait rougir le gate.');
  process.exit(0);
} else {
  main();
}
