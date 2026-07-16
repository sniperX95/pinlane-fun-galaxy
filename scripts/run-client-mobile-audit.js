/* Audit mobile du parcours client public (#clientView).
   Sert le front en local, stubbe l'API publique, et parcourt chaque etape aux
   largeurs 360/390/414px en mesurant le scroll horizontal, la hauteur des cartes
   formules et les cibles tactiles. Ecrit des captures dans artifacts/qa/.
   Usage: node scripts/run-client-mobile-audit.js [before|after]              */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_CLIENT_QA_PORT || 4188);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = path.join(ROOT, 'artifacts', 'qa');
const PHASE = (process.argv[2] || 'after').toLowerCase();
const WIDTHS = [360, 390, 414];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end('Forbidden'); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function installClientApi(page) {
  await page.addInitScript(() => {
    const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const json = (payload) => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `c-${Date.now()}` },
    });
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, window.location.origin);
      if (url.pathname === '/api/public-booking-meta') {
        return json({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [],
          center: { id: 'libramont', status: 'active',
            defaultSchedule: { regular: { '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } },
              holiday: { '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } } },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
            offerAvailability: {} } });
      }
      if (url.pathname === '/api/public-availability') {
        const type = url.searchParams.get('type');
        if (type === 'bowling' || type === 'laser') {
          const slots = ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'].map((time) => ({
            time, lanes: [1, 2], freeCount: 6,
            opsPlan: { startTime: time, endTime: toTime(toMin(time) + 60), totalMinutes: 60, arrivalTime: toTime(toMin(time) - 10), risk: { level: 'low' } },
          }));
          return json({ ok: true, slots, laneCount: 2, duration: 1, requiresLanes: type === 'bowling', label: type });
        }
        if (type !== 'formule') return json({ ok: true, slots: [] });
        const formuleId = url.searchParams.get('formuleId');
        // FORMULE a ancres (bowling + laser) : f1/f3/f4/ffm/bts
        const anchorFormules = ['f1', 'f3', 'f4', 'ffm', 'bts'];
        if (anchorFormules.includes(formuleId)) {
          let preferred = {};
          try { preferred = JSON.parse(url.searchParams.get('preferredTimes') || '{}') || {}; } catch (e) { preferred = {}; }
          const laserPlacement = url.searchParams.get('laserPlacement') === 'onsite' ? 'onsite' : 'scheduled';
          const anchors = { ok: true, arrivalLeadMinutes: 10, hasTable: false, freePass: [{ activityId: 'arcade_time', label: 'Arcades' }], drinks: ['2 cruches boissons'], laserGames: 1, laserOnSiteAvailable: true,
            activities: [
              { activityId: 'bowling', label: 'Bowling', count: 1, durationMinutes: 60, times: ['14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'].map((time) => ({ time, lanes: [1, 2] })) },
              { activityId: 'laser_game', label: 'Laser Game', count: 1, durationMinutes: 25, times: ['15:30', '16:00', '16:30', '17:00', '17:30', '18:00'].map((time) => ({ time, remainingPlaces: 22 })) },
            ], defaultTimes: { bowling: '15:00', laser_game: '16:30' } };
          const bowling = preferred.bowling || '15:00';
          const laser = laserPlacement === 'onsite' ? '' : (preferred.laser_game || '16:30');
          const firstStart = laser && toMin(laser) < toMin(bowling) ? laser : bowling;
          const arrival = toTime(toMin(firstStart) - 10);
          const visitEnd = toTime(Math.max(toMin(bowling) + 60, laser ? toMin(laser) + 25 : 0, toMin(firstStart) + 145));
          const slot = { time: firstStart, lanes: [1, 2], freeCount: 6, opsPlan: { startTime: firstStart, endTime: visitEnd, totalMinutes: toMin(visitEnd) - toMin(firstStart), arrivalTime: arrival, arrivalMinutes: 10,
            resourceBlocks: [ { resourceType: 'bowling_lane', activityId: 'bowling', label: 'Bowling', startTime: bowling, endTime: toTime(toMin(bowling) + 60), lanes: [1, 2] }, ...(laser ? [{ resourceType: 'laser_arena', activityId: 'laser_game', label: 'Laser Game', startTime: laser, endTime: toTime(toMin(laser) + 25), players: 8, countIndex: 1 }] : []) ],
            firstBowlingTime: bowling, firstLaserTime: laser || '', anchorPlan: { mode: 'anchors_freedom', laserPlacement, times: laser ? { bowling, laser_game: laser } : { bowling } },
            laserPassPlan: laser ? null : { remainingGames: 1 }, laserSharing: laser ? { mayShare: true } : null } };
          return json({ ok: true, slots: [slot], laneCount: 2, duration: 1, totalDuration: 2.5, price: 208, requiresLanes: true, label: 'FORMULE', anchors, suggestions: [], message: '' });
        }
        // FORMULE table + pass (arrivee) : f6/f7/f8
        const slots = ['14:00', '14:30', '15:00', '15:30', '16:00'].map((time) => {
          const arrival = toTime(toMin(time) - 10); const end = toTime(toMin(time) + 150);
          return { time, lanes: [], freeCount: 6, opsPlan: { startTime: time, endTime: end, totalMinutes: 150, arrivalTime: arrival, arrivalMinutes: 10,
            resourceBlocks: [{ resourceType: 'party_table', activityId: 'party_table', label: 'Table', startTime: arrival, endTime: end }] } };
        });
        return json({ ok: true, slots, laneCount: 0, duration: 2, totalDuration: 2.5, price: 24, requiresLanes: false, label: 'FORMULE',
          anchors: { ok: true, arrivalLeadMinutes: 10, hasTable: true, freePass: [{ activityId: 'playground', label: 'Plaine de jeux' }, { activityId: 'minigolf_blacklight', label: 'Mini Golf' }], drinks: ['2 cruches boissons'], laserGames: 0, laserOnSiteAvailable: false, activities: [], defaultTimes: null }, suggestions: [], message: '' });
      }
      if (url.pathname === '/api/public-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(init.body || '{}');
        return json({ ok: true, reservation: { ...body, id: 9991, lanes: body.lanes?.length ? body.lanes : [1, 2] }, ops: { validationStatus: 'confirmed', autoDecision: 'auto_confirmed' }, communications: [], warnings: [] });
      }
      return nativeFetch(input, init);
    };
  });
}

async function measure(page, label) {
  return page.evaluate((lbl) => {
    const vw = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    const overflowX = Math.max(0, scrollW - vw);
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const offenders = [];
    document.querySelectorAll('#clientView *').forEach((el) => {
      if (!visible(el)) return; const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) offenders.push({ cls: String(el.className).slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) });
    });
    // Cibles tactiles < 44px
    const smallTargets = [];
    document.querySelectorAll('#clientView button:not([disabled]), #clientView a, #clientView input').forEach((el) => {
      if (!visible(el)) return; const r = el.getBoundingClientRect();
      if (r.height < 43 || r.width < 43) smallTargets.push({ cls: String(el.className).slice(0, 36), w: Math.round(r.width), h: Math.round(r.height) });
    });
    // Hauteur des cartes formules
    const cards = [...document.querySelectorAll('#clientView .formule-card')].filter(visible);
    const cardHeights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    const firstCard = cards[0]?.getBoundingClientRect();
    const cardsInViewport = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; }).length;
    // Inputs font-size (zoom iOS si < 16)
    const smallInputs = [];
    document.querySelectorAll('#clientView input').forEach((el) => { if (!visible(el)) return; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) smallInputs.push({ id: el.id, fs }); });
    // (a) Contenu des cartes formules : nombre d'inclusions (<li>) VISIBLES par
    // carte, en distinguant les cartes selectionnees (active) des autres. Objectif :
    // chaque carte NON selectionnee doit montrer > 1 inclusion (pas de tap requis).
    const cardContent = cards.map((c) => {
      const active = c.classList.contains('active');
      const lis = [...c.querySelectorAll('.formule-card-list li')].filter(visible);
      return { active, liVisible: lis.length };
    });
    // (b) Empilement des blocs label|texte (visit-line, recap-item, pass) : les
    // enfants directs doivent partager le meme x (colonne unique) avec des y
    // croissants : sinon = colonnes serrees illisibles sur mobile.
    const directCol = (el) => {
      const kids = [...el.children].filter(visible);
      if (kids.length < 2) return { stacked: true, sameX: true, inc: true, n: kids.length };
      const rects = kids.map((k) => k.getBoundingClientRect());
      const left0 = rects[0].left;
      const sameX = rects.every((r) => Math.abs(r.left - left0) <= 6);
      let inc = true;
      for (let i = 1; i < rects.length; i += 1) { if (rects[i].top < rects[i - 1].bottom - 6) { inc = false; break; } }
      return { stacked: sameX && inc, sameX, inc, n: kids.length };
    };
    const stacks = [];
    ['.visit-line', '.recap-item', '.anchor-free-head'].forEach((sel) => {
      document.querySelectorAll(`#clientView ${sel}`).forEach((el) => {
        if (!visible(el)) return;
        stacks.push({ sel, ...directCol(el) });
      });
    });
    return { label: lbl, vw, scrollW, overflowX, offenders: offenders.slice(0, 8), offendersCount: offenders.length,
      smallTargets: smallTargets.slice(0, 8), smallTargetsCount: smallTargets.length,
      cardCount: cards.length, cardHeights, firstCardH: firstCard ? Math.round(firstCard.height) : null, cardsInViewport, smallInputs,
      cardContent, stacks };
  }, label);
}

async function shot(page, name) { await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }); }

async function walkSteps(page, width) {
  const results = [];
  const tag = `${PHASE}-${width}`;
  // Etape 1 - bowling (defaut)
  await page.evaluate(() => { if (typeof resetBooking === 'function') resetBooking(); setType('bowling'); });
  await page.waitForTimeout(250);
  results.push(await measure(page, 'step1-bowling'));
  await shot(page, `client-${tag}-step1-bowling`);
  // Etape 1 - bowling, GROUPE 15 joueurs : declenche l'encart warning orange
  // « Maximum conseille : 6 joueurs par piste... 3 pistes cote a cote ». Etat
  // exact du bug patron (carte + champ Date qui debordaient sur iPhone). On
  // simule aussi le chrome staff connecte (bouton Deconnexion visible).
  await page.evaluate(() => {
    const lb = document.getElementById('logoutBtn');
    if (lb) lb.classList.remove('hidden');
    setType('bowling');
    state.booking.pax = 15;
    document.getElementById('fPax').value = '15';
    if (typeof updatePaxAlert === 'function') updatePaxAlert();
    if (typeof goStep === 'function') goStep(1);
  });
  await page.waitForTimeout(300);
  results.push(await measure(page, 'step1-pax15-warning'));
  await shot(page, `client-${tag}-step1-pax15-warning`);
  await page.evaluate(() => { const lb = document.getElementById('logoutBtn'); if (lb) lb.classList.add('hidden'); if (typeof resetBooking === 'function') resetBooking(); setType('bowling'); });
  await page.waitForTimeout(200);
  // Etape 1 - formules (le gros probleme)
  await page.evaluate(() => setType('formule'));
  await page.waitForTimeout(300);
  results.push(await measure(page, 'step1-formules'));
  await shot(page, `client-${tag}-step1-formules`);
  // Selection formule a ancres
  await page.evaluate(() => { state.booking.pax = 8; if (typeof selectFormule === 'function') selectFormule('f1'); });
  await page.waitForTimeout(300);
  results.push(await measure(page, 'step1-formule-selected'));
  await shot(page, `client-${tag}-step1-formule-selected`);
  // Etape 2 - anchor picker
  await page.evaluate(() => { goStep2(); });
  await page.waitForTimeout(900);
  results.push(await measure(page, 'step2-anchors'));
  await shot(page, `client-${tag}-step2-anchors`);
  // Etape 3 - contact
  await page.evaluate(() => {
    const slot = (state.availableSlots || [])[0];
    if (slot) { state.booking.startTime = slot.time; state.booking.opsPlan = slot.opsPlan; }
    goStep(3);
  });
  await page.waitForTimeout(300);
  results.push(await measure(page, 'step3-contact'));
  await shot(page, `client-${tag}-step3-contact`);
  // Etape 4 - recap
  await page.evaluate(() => {
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32470000000';
    document.getElementById('fEmail').value = 'marie@email.com';
    goStep4();
  });
  await page.waitForTimeout(300);
  results.push(await measure(page, 'step4-recap'));
  await shot(page, `client-${tag}-step4-recap`);
  // Etape 1 - bowling slot grid (retour + bowling step2)
  await page.evaluate(() => { resetBooking(); setType('bowling'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => goStep2());
  await page.waitForTimeout(700);
  results.push(await measure(page, 'step2-bowling-slots'));
  await shot(page, `client-${tag}-step2-bowling-slots`);
  return results;
}

// Verification DESKTOP (1280px) : la refonte mobile ne doit RIEN changer au
// rendu large. On mesure la grille multi-colonnes des formules, la disposition
// en ligne du recap et des visit-line, et on capture des screenshots de preuve.
async function desktopCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await installClientApi(page);
  await page.goto(`${BASE_URL}/?v=cqa-desk-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => setView('client'));
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (typeof resetBooking === 'function') resetBooking(); setType('formule'); });
  await page.waitForTimeout(300);
  const formules = await page.evaluate(() => {
    const cardsWrap = document.querySelector('#clientView .formule-cards');
    const grid = document.querySelector('#clientView .formule-grid');
    const cols = cardsWrap ? getComputedStyle(cardsWrap).gridTemplateColumns : '';
    const trackCount = cols ? cols.split(' ').filter(Boolean).length : 0;
    const cards = [...document.querySelectorAll('#clientView .formule-card')].map((c) => c.getBoundingClientRect());
    let sameRowPairs = 0;
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        if (Math.abs(cards[i].top - cards[j].top) < 4 && Math.abs(cards[i].left - cards[j].left) > 20) sameRowPairs += 1;
      }
    }
    return { gridDisplay: grid ? getComputedStyle(grid).display : '', trackCount, cardCount: cards.length, sameRowPairs, firstCardW: cards[0] ? Math.round(cards[0].width) : null };
  });
  await page.screenshot({ path: path.join(OUT_DIR, `client-desktop-1280-${PHASE}-formules.png`), fullPage: false });
  // Etape 2 (visit-line en ligne) + etape 4 (recap en ligne)
  await page.evaluate(() => { state.booking.pax = 8; if (typeof selectFormule === 'function') selectFormule('f1'); goStep2(); });
  await page.waitForTimeout(900);
  const step2 = await page.evaluate(() => {
    const line = document.querySelector('#clientView .visit-line');
    if (!line) return { visitLineRow: null };
    const kids = [...line.children].map((k) => k.getBoundingClientRect());
    const row = kids.length >= 2 ? Math.abs(kids[0].top - kids[1].top) < 12 : true;
    return { visitLineRow: row };
  });
  await page.screenshot({ path: path.join(OUT_DIR, `client-desktop-1280-${PHASE}-step2.png`), fullPage: false });
  await page.evaluate(() => {
    const slot = (state.availableSlots || [])[0];
    if (slot) { state.booking.startTime = slot.time; state.booking.opsPlan = slot.opsPlan; }
    goStep(3);
    document.getElementById('fName').value = 'Marie Dupont';
    document.getElementById('fPhone').value = '+32470000000';
    document.getElementById('fEmail').value = 'marie@email.com';
    goStep4();
  });
  await page.waitForTimeout(300);
  const step4 = await page.evaluate(() => {
    const item = document.querySelector('#clientView .recap-item');
    if (!item) return { recapRow: null };
    const kids = [...item.children].map((k) => k.getBoundingClientRect());
    const row = kids.length >= 2 ? Math.abs(kids[0].top - kids[1].top) < 12 : true;
    return { recapRow: row };
  });
  await page.screenshot({ path: path.join(OUT_DIR, `client-desktop-1280-${PHASE}-step4.png`), fullPage: false });
  await page.close();
  return { formules, ...step2, ...step4 };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const report = {};
  let desktop = null;
  const consoleErrors = [];
  try {
    desktop = await desktopCheck(browser);
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${width}] ${m.text()}`); });
      page.on('pageerror', (e) => consoleErrors.push(`[${width}] PAGEERR ${e.message}`));
      await installClientApi(page);
      await page.goto(`${BASE_URL}/?v=cqa-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
      await page.evaluate(() => setView('client'));
      await page.waitForTimeout(400);
      report[width] = await walkSteps(page, width);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const summary = [];
  let worstOverflow = 0, totalSmallTargets = 0, maxCardH = 0;
  for (const width of WIDTHS) {
    for (const r of report[width]) {
      worstOverflow = Math.max(worstOverflow, r.overflowX);
      totalSmallTargets += r.smallTargetsCount;
      if (r.firstCardH) maxCardH = Math.max(maxCardH, r.firstCardH);
      summary.push(`[${width}] ${r.label.padEnd(24)} overflowX=${r.overflowX} offenders=${r.offendersCount} smallTargets=${r.smallTargetsCount} cards=${r.cardCount} firstCardH=${r.firstCardH} inViewport=${r.cardsInViewport} smallInputs=${r.smallInputs.length}`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `client-mobile-audit-${PHASE}.json`), JSON.stringify({ report, desktop, consoleErrors }, null, 2));
  console.log(`\n=== CLIENT MOBILE AUDIT (${PHASE}) ===`);
  console.log(summary.join('\n'));
  console.log(`\nworstOverflowX=${worstOverflow}px  totalSmallTargets=${totalSmallTargets}  maxFirstCardHeight=${maxCardH}px`);
  if (desktop) {
    console.log(`\n[DESKTOP 1280] formule-grid display=${desktop.formules.gridDisplay} gridTracks=${desktop.formules.trackCount} cards=${desktop.formules.cardCount} sameRowPairs=${desktop.formules.sameRowPairs} firstCardW=${desktop.formules.firstCardW}px  visitLineRow=${desktop.visitLineRow} recapRow=${desktop.recapRow}`);
  }
  if (consoleErrors.length) { console.log('\nConsole/page errors:'); console.log(consoleErrors.slice(0, 20).join('\n')); }
  // Detail offenders/smallTargets for the 390 formules step
  const f = report[390].find((r) => r.label === 'step1-formules');
  if (f) { console.log('\n[390 step1-formules] offenders:', JSON.stringify(f.offenders)); console.log('[390 step1-formules] smallTargets:', JSON.stringify(f.smallTargets)); console.log('[390 step1-formules] cardHeights:', JSON.stringify(f.cardHeights)); }

  // --- Assertions mobile (le script echoue si une regression est detectee) ---
  const failures = [];
  // (c) Chaque etape 390px (et 360/414) : aucun scroll horizontal.
  if (worstOverflow > 2) failures.push(`scroll horizontal detecte (worstOverflowX=${worstOverflow}px)`);
  // (c-bis) ASSERTION PAR ELEMENT (pas seulement le body) : sur CHAQUE etape et
  // CHAQUE largeur, aucun element de #clientView ne doit avoir rect.right >
  // innerWidth+1. Attrape le bug patron (carte/date qui debordent a l'etape 1
  // avec 15 joueurs) meme si document.scrollWidth reste clampe au viewport.
  for (const w of WIDTHS) {
    for (const r of report[w]) {
      if (r.offendersCount > 0) {
        const first = (r.offenders || []).map((o) => `${o.cls || 'el'}@${o.right}`).slice(0, 4).join(', ');
        failures.push(`element(s) hors viewport a ${w}px sur ${r.label} (${r.offendersCount} : ${first})`);
      }
    }
  }
  const formuleRows = WIDTHS.map((w) => report[w].find((r) => r.label === 'step1-formules')).filter(Boolean);
  formuleRows.forEach((r) => {
    if (r.cardCount < 10) failures.push(`peu de cartes formules visibles a ${r.vw}px (${r.cardCount})`);
    // (a) Cartes NON selectionnees : inclusions completes visibles SANS tap (> 1 <li>).
    const truncated = (r.cardContent || []).filter((c) => !c.active && c.liVisible <= 1);
    if (truncated.length) failures.push(`cartes formules tronquees a ${r.vw}px (${truncated.length} cartes non selectionnees ne montrent qu'une inclusion : tap requis)`);
  });
  // (b) Blocs label|texte (visit-line / recap-item / pass) empiles pleine largeur
  // a <=640 : enfants en colonne unique (meme x, y croissants).
  for (const w of WIDTHS) {
    for (const r of report[w]) {
      const badStacks = (r.stacks || []).filter((s) => !s.stacked);
      if (badStacks.length) {
        const sels = [...new Set(badStacks.map((s) => s.sel))].join(', ');
        failures.push(`blocs non empiles a ${w}px sur ${r.label} (${sels} en colonnes serrees)`);
      }
    }
  }
  // Un CTA principal ecrase (hauteur < 40px) sur step3/step4 = regression flex
  for (const w of WIDTHS) {
    for (const r of report[w]) {
      if (['step3-contact', 'step4-recap'].includes(r.label)) {
        const crushed = (r.smallTargets || []).some((t) => /btn-primary/.test(t.cls) && t.h < 40);
        if (crushed) failures.push(`CTA principal ecrase sur ${r.label} a ${w}px`);
      }
    }
  }
  // (d) DESKTOP 1280px NON REGRESSE : grille formules multi-colonnes conservee,
  // formule-grid en flex, recap/visit-line en ligne (pas empiles).
  if (desktop) {
    const d = desktop.formules;
    if (d.gridDisplay !== 'flex') failures.push(`desktop regresse : formule-grid n'est plus flex (${d.gridDisplay})`);
    if (d.trackCount < 2) failures.push(`desktop regresse : grille formules en 1 colonne (tracks=${d.trackCount})`);
    if (d.sameRowPairs < 1) failures.push('desktop regresse : plus aucune paire de cartes formules sur la meme ligne');
    if (desktop.visitLineRow === false) failures.push('desktop regresse : visit-line empilee au lieu d\'etre en ligne');
    if (desktop.recapRow === false) failures.push('desktop regresse : recap-item empile au lieu d\'etre en ligne');
  } else {
    failures.push('verification desktop 1280px absente');
  }
  if (consoleErrors.length) failures.push(`erreurs console/page: ${consoleErrors.length}`);
  if (failures.length) { console.error('\nASSERTIONS ECHOUEES:\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\nAssertions: OK, mobile (0 scroll horizontal, inclusions completes sans tap, blocs empiles, CTA non ecrase) + DESKTOP 1280 non regresse.');
}

main().catch((e) => { console.error(e); process.exit(1); });
