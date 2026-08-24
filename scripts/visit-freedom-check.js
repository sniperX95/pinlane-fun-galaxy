// LA LIBERTE DU CLIENT sur l'ecran « Composez votre visite ».
//
// Arbitrage produit de Movsar, 2026-08-15 : « non ils doivent etre libre de
// choisir la date qu'ils veulent hein ». Le moteur CONSEILLE, il n'interdit
// jamais un choix realisable. Ce gate verifie le COMPORTEMENT, jamais la
// presence d'une chaine :
//   1. moteur : un trou de 150 min entre deux activites reste RESERVABLE, et
//      revient decore d'un avis de confort (duree lisible + heure pour
//      enchainer). Une impossibilite PHYSIQUE (chevauchement, hors grille,
//      hors horaires du centre, ressource prise) reste refusee.
//   2. navigateur : avec ce meme trou de 150 min, le client voit le bouton
//      « Valider ces horaires », il peut cliquer, et le POST part avec ses
//      heures telles quelles. C'etait LE defaut : le bouton n'existait pas.
//   3. l'avis n'est pas un mur : role="status" (pas alert), fond ambre
//      (--warning-soft, pas --danger-soft), et il porte une action.
//   4. design mesure sur une MATRICE largeurs x themes x volume : le fil de la
//      visite existe, l'ecart entre activites est ECRIT, les heures sont
//      rangees par moment de journee, aucun debordement horizontal, toutes les
//      cibles tactiles >= 44 px.
// Puis une CONTRE-EPREUVE par mutation : on remet le refus dans le moteur, on
// prouve que le gate rougit, on restaure par edition inverse.
//
// Lancement : node scripts/visit-freedom-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const opsEngine = require('../lib/ops-engine');
const { planningAgent } = require('../lib/ops-agents');

const APP = path.join(ROOT, 'assets/app-main.js');
const ENGINE = path.join(ROOT, 'lib/ops-engine.js');
const PORT = Number(process.env.PINLANE_FREEDOM_PORT || 4211);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Meme raison que visit-booking-check : un samedi STRICTEMENT futur, sinon les
// creneaux du jour passent et le gate rougit pour une raison d'horloge.
function nextSaturday() {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== 6);
  return cursor.toISOString().slice(0, 10);
}
const DATE = nextSaturday();
const CENTER = 'libramont';
const FORMULE = 'f1';
// Bowling 15:00 (1 h de piste) puis Laser 18:30 : 150 minutes de trou, la
// combinaison exacte de la capture de Movsar.
const GAP_BOWLING = '15:00';
const GAP_LASER = '18:30';
const GAP_MINUTES = 150;
// L heure la plus proche qui recollerait les deux activites : bowling se
// termine a 16:00, plus la transition, recale sur la grille :00/:30.
const TIGHTEN_TIME = '16:30';

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// --- Serveur : le vrai index.html, la vraie disponibilite ---------------------
// /api/public-availability est branche sur le MOTEUR REEL (planningAgent) : le
// navigateur recoit exactement ce que la production lui enverrait.
const posts = [];

function firstActivityTime(scenario, activityId) {
  const block = (scenario.resourceBlocks || []).find((item) => item.activityId === activityId && !item.flexible);
  if (block?.startTime) return block.startTime;
  const step = (scenario.timeline || []).find((item) => item.activityId === activityId && !item.flexible);
  return step?.startTime || null;
}

function toSlot(scenario) {
  return {
    time: scenario.startTime,
    lanes: scenario.assignedLanes || [],
    freeCount: 4,
    opsPlan: {
      startTime: scenario.startTime,
      endTime: scenario.endTime,
      totalMinutes: scenario.totalMinutes,
      arrivalTime: scenario.arrivalTime || null,
      arrivalMinutes: scenario.arrivalMinutes || null,
      staffSummary: scenario.staffSummary,
      assignedLanes: scenario.assignedLanes || [],
      timeline: scenario.timeline || [],
      resourceBlocks: scenario.resourceBlocks || [],
      firstLaserTime: firstActivityTime(scenario, 'laser_game'),
      firstBowlingTime: firstActivityTime(scenario, 'bowling'),
      laserSharing: scenario.laserSharing || null,
      laserPassPlan: scenario.laserPassPlan || null,
      anchorPlan: scenario.anchorPlan || null,
      comfortNotices: scenario.comfortNotices || [],
    },
  };
}

function availabilityPayload(search) {
  const params = new URLSearchParams(search);
  const pax = Math.max(1, Number(params.get('pax') || 10));
  const preferredTimes = JSON.parse(params.get('preferredTimes') || '{}');
  const laserPlacement = params.get('laserPlacement') === 'onsite' ? 'onsite' : 'scheduled';
  const context = { reservations: [], laneStatuses: {} };
  const anchors = opsEngine.getFormulaAnchorAvailability({ centerId: CENTER, formuleId: FORMULE, date: DATE, pax }, context);
  const base = { ok: true, date: DATE, laneCount: 2, duration: 1, totalDuration: 2, price: 300, requiresLanes: true, label: 'FORMULE 1', anchors };
  if (!(preferredTimes.bowling || preferredTimes.laser_game || laserPlacement === 'onsite')) {
    return { ...base, slots: [], suggestions: [], message: '' };
  }
  const plan = planningAgent({
    centerId: CENTER, date: DATE, type: 'formule', formuleId: FORMULE, pax, duration: 1,
    preference: { preferredTimes, laserPlacement, arrivalConfidence: 'normal' },
  }, context);
  const recommended = plan?.plan?.recommended;
  if (recommended && recommended.ok) return { ...base, slots: [toSlot(recommended)], suggestions: [], message: '' };
  return { ...base, slots: [], suggestions: plan?.plan?.anchorSuggestions || [], message: plan?.plan?.reason || '' };
}

function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [], formules: [],
    activities: [
      { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, order: 1, defaultMinutes: 60 },
      { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, order: 2, defaultMinutes: 25 },
    ],
    center: {
      id: CENTER, status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname === '/api/public-availability') return json(200, availabilityPayload(url.search));
    if (url.pathname === '/api/public-reservations') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body || '{}'); } catch (error) { parsed = null; }
        posts.push(parsed);
        json(201, { ok: true, reservation: { id: 9001, ...(parsed || {}), lanes: [1, 2], status: 'pending', price: 300 }, ops: {}, communications: [], warnings: [] });
      });
      return undefined;
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return undefined; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
    return undefined;
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function bootFormula(page, key, { bowling, laser, pax = 10 }) {
  await page.goto(`${BASE_URL}/?v=freedom-${key}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep2 === 'function', null, { timeout: 15000 });
  await page.evaluate(async (input) => {
    state.view = 'client';
    state.booking.date = input.date;
    state.booking.pax = input.pax;
    state.booking.mode = 'formule';
    state.booking.type = 'formule';
    state.booking.formuleId = 'f1';
    state.booking.preference = {
      preferredTimes: { bowling: input.bowling || '', laser_game: input.laser || '' },
      laserPlacement: 'scheduled',
    };
    setView('client');
    syncBookingTypeUi();
    await goStep2();
  }, { date: DATE, bowling, laser, pax });
  await page.waitForTimeout(800);
}

// Mesure de l'ecran : structure et pixels, jamais d'estimation.
const MEASURE = () => {
  const picker = document.querySelector('.formula-anchor-picker');
  const advice = document.querySelector('.visit-rail-advice');
  const confirm = document.querySelector('.formula-plan-confirm');
  const style = advice ? getComputedStyle(advice) : null;
  // Couleurs des JETONS resolues dans le theme courant : on compare l avis a
  // --warning et a --danger, jamais a une valeur en dur.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;border-top:1px solid var(--danger);color:var(--warning)';
  document.body.appendChild(probe);
  const probeStyle = getComputedStyle(probe);
  const tokens = { danger: probeStyle.borderTopColor, warning: probeStyle.color };
  probe.remove();
  return {
    tokens,
    pickerHeight: picker ? Math.round(picker.getBoundingClientRect().height) : 0,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    railSteps: document.querySelectorAll('.visit-rail > .visit-rail-step').length,
    railLinks: document.querySelectorAll('.visit-rail > .visit-rail-link').length,
    railOrder: [...document.querySelectorAll('.anchor-row')].map((row) => row.dataset.anchor),
    periodTabs: [...document.querySelectorAll('.anchor-period-tab')].map((tab) => tab.querySelector('.anchor-period-name')?.textContent.trim()),
    periodCounts: [...document.querySelectorAll('.anchor-period-tab')].map((tab) => Number(tab.querySelector('.anchor-period-count')?.textContent.trim() || 0)),
    // L heure vit dans la ligne « heure » de la CARTE de creneau (le creneau
    // n est plus une pastille nue : il porte aussi sa fin et sa qualification).
    activeChips: [...document.querySelectorAll('.anchor-chip.active')]
      .map((chip) => (chip.querySelector('.slot-card-time') || chip).textContent.trim()),
    // La carte REPOND aux questions que la pastille laissait ouvertes : quand
    // ca finit, et ce que vaut ce creneau. Les deux se lisent a l ecran.
    cardsWithEnd: [...document.querySelectorAll('.anchor-chip')]
      .filter((chip) => /^→ \d{2}:\d{2}$/.test((chip.querySelector('.slot-card-end') || {}).textContent?.trim() || '')).length,
    cardsTotal: document.querySelectorAll('.anchor-chip').length,
    chainedTagged: [...document.querySelectorAll('.anchor-chip.is-chained')]
      .every((chip) => (chip.querySelector('.slot-card-tag') || {}).textContent?.trim() === 'Enchaîné'),
    // « Affichee » = reellement sous les yeux. Depuis que les heures vivent
    // dans une piste horizontale, une pastille peut avoir une hauteur tout en
    // etant hors du champ de sa piste : on croise donc avec la fenetre ET avec
    // le cadre visible de la piste.
    visibleChips: [...document.querySelectorAll('.anchor-chip')].filter((chip) => {
      const box = chip.getBoundingClientRect();
      if (box.height <= 0 || box.top >= window.innerHeight || box.bottom <= 0) return false;
      const track = chip.closest('.anchor-track');
      if (!track) return true;
      const frame = track.getBoundingClientRect();
      return box.right > frame.left + 1 && box.left < frame.right - 1;
    }).length,
    // Toutes les heures du jour vivent dans le DOM d'une seule piste : plus
    // aucune n'est retiree derriere un filtre.
    reachableChips: document.querySelectorAll('.anchor-chip').length,
    chipTimesValid: [...document.querySelectorAll('.anchor-chip')]
      .every((chip) => /^\d{2}:(00|30)$/.test((chip.querySelector('.slot-card-time') || chip).textContent.trim())),
    picks: [...document.querySelectorAll('.anchor-row-pick')].map((el) => el.textContent.trim()),
    linkText: document.querySelector('.visit-rail-link')?.textContent.replace(/\s+/g, ' ').trim() || '',
    advice: advice ? {
      role: advice.getAttribute('role'),
      text: advice.textContent.replace(/\s+/g, ' ').trim(),
      color: style.color,
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
      action: advice.querySelector('.visit-rail-advice-action')?.textContent.trim() || '',
    } : null,
    dangerBoxes: document.querySelectorAll('.anchor-status-error').length,
    confirm: confirm ? { present: true, disabled: confirm.disabled, height: Math.round(confirm.getBoundingClientRect().height) } : { present: false },
    // Toute cible tactile de l'ecran : bouton, entree, etiquette cliquable.
    smallTargets: [...document.querySelectorAll('.formula-anchor-picker button, .formula-anchor-picker label')]
      .filter((el) => { const box = el.getBoundingClientRect(); return box.height > 0 && box.height < 44; })
      .map((el) => `${(el.className || el.tagName).toString().split(' ')[0]}:${Math.round(el.getBoundingClientRect().height)}`),
  };
};

function parseRgb(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((item) => parseFloat(item));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function relativeLuminance({ r, g, b }) {
  const channel = (value) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

async function measureCell(page, width, theme) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate((value) => { document.documentElement.setAttribute('data-theme', value); }, theme);
  await page.waitForTimeout(140);
  return page.evaluate(MEASURE);
}

// --- 1. MOTEUR ---------------------------------------------------------------
function checkEngine() {
  console.log('\n[1] MOTEUR : le confort conseille, il n interdit plus');
  const context = { reservations: [], laneStatuses: {} };
  const plan = (preferredTimes, extra = {}) => planningAgent({
    centerId: CENTER, date: DATE, type: 'formule', formuleId: FORMULE, pax: 10,
    preference: { preferredTimes, ...extra },
  }, context);

  const wide = plan({ bowling: GAP_BOWLING, laser_game: GAP_LASER });
  ok(wide.ok === true, `un trou de ${GAP_MINUTES} min reste reservable (ok=${wide.ok}, code=${wide.plan.refusalCode || '-'})`);
  const notice = (wide.plan.recommended?.comfortNotices || []).find((item) => item.code === 'anchor_gap');
  ok(Boolean(notice), 'le trou revient comme AVIS de confort, pas comme refus');
  ok(notice?.gapMinutes === GAP_MINUTES, `l avis dit l attente reelle (${notice?.gapMinutes} min)`);
  ok(notice?.gapLabel === '2 h 30', `l avis se lit en clair pour un client ("${notice?.gapLabel}")`);
  ok(notice?.severity === 'advice', 'l avis se declare comme avis, jamais comme blocage');
  ok(notice?.tightenTime === TIGHTEN_TIME, `l avis propose l heure qui enchaine (${notice?.tightenTime})`);
  const laserBlock = (wide.plan.recommended?.resourceBlocks || []).find((block) => block.resourceType === 'laser_arena');
  ok(laserBlock?.startTime === GAP_LASER, `le moteur reserve EXACTEMENT l heure choisie (${laserBlock?.startTime}), il ne la corrige pas en douce`);

  const comfortable = plan({ bowling: '15:00', laser_game: '16:30' });
  ok(comfortable.ok === true && (comfortable.plan.recommended.comfortNotices || []).length === 0,
    'une combinaison confortable ne fabrique aucun avis (zero bruit)');

  console.log('\n[1b] MOTEUR : l impossible reste impossible');
  const overlap = plan({ bowling: '15:00', laser_game: '15:30' });
  ok(overlap.ok === false && overlap.plan.refusalCode === 'anchor_overlap',
    `un chevauchement reste refuse (${overlap.plan.refusalCode || 'accepte'})`);
  const offGrid = plan({ bowling: '15:00', laser_game: '16:15' });
  ok(offGrid.ok === false && offGrid.plan.refusalCode === 'off_grid',
    `une heure hors grille reste refusee (${offGrid.plan.refusalCode || 'accepte'})`);
  const beforeOpening = plan({ bowling: '08:00', laser_game: '16:30' });
  ok(beforeOpening.ok === false, 'une heure hors des horaires du centre reste refusee');
  // Ressource physiquement prise : les 8 pistes occupees a 15:00.
  const busy = planningAgent({
    centerId: CENTER, date: DATE, type: 'formule', formuleId: FORMULE, pax: 10,
    preference: { preferredTimes: { bowling: '15:00', laser_game: '16:30' } },
  }, {
    reservations: Array.from({ length: 8 }, (unused, index) => ({
      id: 500 + index, date: DATE, type: 'bowling', startTime: '15:00', duration: 1, pax: 6, lanes: [index + 1], status: 'confirmed',
    })),
    laneStatuses: {},
  });
  ok(busy.ok === false, 'une ressource deja prise reste un refus (la liberte n est pas l anarchie)');
}

// --- 2 et 3. NAVIGATEUR ------------------------------------------------------
async function checkBrowser(page) {
  console.log('\n[2] NAVIGATEUR : le client PEUT valider une visite a 150 min de trou');
  await bootFormula(page, 'gap', { bowling: GAP_BOWLING, laser: GAP_LASER });
  const gapView = await measureCell(page, 1280, 'dark');
  ok(gapView.confirm.present === true && gapView.confirm.disabled === false,
    'le bouton « Valider ces horaires » existe et est actif (il n existait PAS avant)');
  ok(gapView.dangerBoxes === 0, 'plus aucun encadre de refus rouge pour un simple inconfort');
  ok(gapView.activeChips.length === 2 && gapView.activeChips.includes(GAP_BOWLING) && gapView.activeChips.includes(GAP_LASER),
    `les deux heures choisies restent retenues (${gapView.activeChips.join(', ')})`);

  const posted = await page.evaluate(async () => {
    const index = getCurrentFormulaAnchorSlotIndex();
    if (index < 0) return { index };
    selectSlot(index);
    state.booking.name = 'QA Liberte';
    state.booking.phone = '+32 470 00 00 00';
    state.booking.email = 'qa-liberte@pinlane.test';
    await confirmBooking();
    return { index, step: state.step };
  });
  await page.waitForTimeout(500);
  const body = posts[posts.length - 1];
  ok(posted.index >= 0, `le creneau compose existe cote client (index ${posted.index})`);
  ok(Boolean(body), 'la reservation part vraiment au serveur');
  ok(body?.preference?.preferredTimes?.bowling === GAP_BOWLING && body?.preference?.preferredTimes?.laser_game === GAP_LASER,
    `le POST porte les heures assumees par le client (${body?.preference?.preferredTimes?.bowling} / ${body?.preference?.preferredTimes?.laser_game})`);
  const postedLaser = (body?.opsPlan?.resourceBlocks || []).find((block) => block.resourceType === 'laser_arena');
  ok(postedLaser?.startTime === GAP_LASER, `le plan poste garde le laser a ${GAP_LASER} (recu ${postedLaser?.startTime})`);

  console.log('\n[3] L AVIS : il propose, il ne gronde pas');
  await bootFormula(page, 'advice', { bowling: GAP_BOWLING, laser: GAP_LASER });
  for (const theme of ['dark', 'light']) {
    const cell = await measureCell(page, 1280, theme);
    ok(cell.advice?.role === 'status', `${theme} : l avis est un role="status", jamais un role="alert"`);
    ok(/2 h 30/.test(cell.advice?.text || ''), `${theme} : l avis dit l attente en clair ("${(cell.advice?.text || '').slice(0, 40)}")`);
    ok(!/[Rr]approchez|impossible|Trop d/.test(cell.advice?.text || ''),
      `${theme} : l avis ne donne aucun ordre et n annonce aucune impossibilite`);
    ok(cell.advice?.action === `Enchaîner à ${TIGHTEN_TIME}`,
      `${theme} : l avis porte une action concrete ("${cell.advice?.action}")`);
    const foreground = parseRgb(cell.advice?.color);
    const background = parseRgb(cell.advice?.background);
    const ratio = foreground && background ? contrastRatio(foreground, background) : 0;
    ok(ratio >= 4.5, `${theme} : contraste du texte de l avis ${ratio}:1 (>= 4.5)`);
    // Ambre = attention (DESIGN.md §3 : « Ambre = arrivee/attention »), rouge =
    // bloque. Un avis n est pas un blocage : il ne prend jamais --danger.
    ok(cell.advice?.borderColor === cell.tokens.warning && cell.advice?.borderColor !== cell.tokens.danger,
      `${theme} : l avis porte la couleur d attention et non celle du refus (${cell.advice?.borderColor} vs danger ${cell.tokens.danger})`);
  }

  console.log('\n[3b] GARDER CET HORAIRE : ecarter l avis est un droit, pas une perte d info');
  await bootFormula(page, 'dismiss', { bowling: GAP_BOWLING, laser: GAP_LASER });
  const dismissed = await page.evaluate(async () => {
    const ghost = document.querySelector('.visit-rail-advice-ghost');
    const label = ghost ? ghost.textContent.trim() : '';
    if (ghost) ghost.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const gapLink = document.querySelector('.visit-rail-gap');
    return {
      label,
      adviceGone: !document.querySelector('.visit-rail-advice'),
      gapText: gapLink ? gapLink.textContent.trim() : '',
    };
  });
  ok(dismissed.label === 'Garder cet horaire', `l avis propose de garder son horaire ("${dismissed.label}")`);
  ok(dismissed.adviceGone, 'garder son horaire retire l avis : le choix du client est respecte');
  ok(/2 h 30/.test(dismissed.gapText), `l attente reste DITE par le maillon ("${dismissed.gapText}") : l information ne disparait jamais`);
  const stillAway = await page.evaluate(async () => {
    await revalidateFormulaAnchors();
    return { adviceBack: Boolean(document.querySelector('.visit-rail-advice')) };
  });
  ok(stillAway.adviceBack === false, 'une revalidation ne ressuscite pas l avis ecarte');
  const revived = await page.evaluate(async () => {
    await setFormulaAnchorTime('laser_game', '19:00');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const advice = document.querySelector('.visit-rail-advice');
    return { adviceBack: Boolean(advice), text: advice ? advice.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '' };
  });
  ok(revived.adviceBack === true, `l attente a change : l avis revient de lui-meme ("${revived.text}")`);

  console.log('\n[4] LE FIL DE LA VISITE et la hierarchie des heures');
  // L etat de [3b] a deplace le laser : on repart de la paire de reference.
  await bootFormula(page, 'rail', { bowling: GAP_BOWLING, laser: GAP_LASER });
  const rail = await measureCell(page, 1280, 'dark');
  ok(rail.railSteps === 3, `le fil porte les deux activites ET le pass liberte (${rail.railSteps} etapes)`);
  ok(rail.railLinks === 1, `le lien entre les deux activites est represente (${rail.railLinks})`);
  ok(rail.picks.includes(GAP_BOWLING) && rail.picks.includes(GAP_LASER),
    `chaque etape affiche l heure retenue dans son titre (${rail.picks.join(', ')})`);
  // Les onglets de moment ont ete RETIRES (2026-08-24, verdict Movsar : ils
  // ne servaient a rien depuis que la grille montre toute la journee d un
  // coup). L invariant qui compte : aucune heure n est cachee derriere un
  // filtre, et l ordre du jour reste celui des moments (data-period-start).
  ok(rail.periodTabs.length === 0,
    `plus aucun onglet de moment ne filtre les heures (${rail.periodTabs.length})`);
  ok(rail.cardsTotal >= 50 && rail.visibleChips === rail.cardsTotal,
    `toute la journee est sous les yeux, sans onglet (${rail.visibleChips}/${rail.cardsTotal})`);
  ok(rail.chipTimesValid, 'toutes les heures proposees restent des heures :00/:30');
  // Le format CARTE demande par Movsar : « les cartes [...] cest bcp plus pro
  // et beau ». Chaque creneau dit sa FIN, et l enchainement se lit en toutes
  // lettres au lieu d un point colore.
  ok(rail.cardsWithEnd === rail.cardsTotal && rail.cardsTotal > 0,
    `chaque creneau porte son heure de fin (${rail.cardsWithEnd}/${rail.cardsTotal})`);
  ok(rail.chainedTagged, 'le creneau qui enchaine le DIT en toutes lettres, jamais par la couleur seule');

  // Ordre CHRONOLOGIQUE : laser a 11:00 puis bowling a 15:00 => laser en tete.
  await bootFormula(page, 'order', { bowling: '15:00', laser: '11:00' });
  const reversed = await measureCell(page, 1280, 'dark');
  ok(reversed.railOrder.join(',') === 'laser_game,bowling',
    `le fil suit l ordre reel de la visite, pas l ordre du catalogue (${reversed.railOrder.join(', ')})`);

  console.log('\n[5] MATRICE largeurs x themes x volume');
  const cells = [];
  for (const pax of [8, 20]) {
    await bootFormula(page, `matrix-${pax}`, { bowling: GAP_BOWLING, laser: GAP_LASER, pax });
    for (const width of [1280, 768, 390]) {
      for (const theme of ['dark', 'light']) {
        const measured = await measureCell(page, width, theme);
        cells.push({ pax, width, theme, ...measured });
      }
    }
  }
  cells.forEach((cell) => {
    const tag = `${cell.pax} joueurs / ${cell.width}px / ${cell.theme}`;
    ok(cell.scrollW <= cell.clientW, `${tag} : aucun debordement horizontal (${cell.scrollW} <= ${cell.clientW})`);
    ok(cell.confirm.present === true, `${tag} : le client peut valider`);
    ok(cell.smallTargets.length === 0, `${tag} : toutes les cibles >= 44 px${cell.smallTargets.length ? ` (${cell.smallTargets.join(', ')})` : ''}`);
    ok(cell.railLinks === 1 && /2 h 30/.test(cell.linkText), `${tag} : l ecart entre les deux activites est ecrit`);
  });
  const mobile = cells.find((cell) => cell.width === 390 && cell.theme === 'dark' && cell.pax === 8);
  // L ecran mesurait 1732 px de haut sur un telephone avant la refonte, avec 53
  // pastilles identiques deroulees d un bloc. Le budget garde la marche.
  // Budget RELEVE en connaissance de cause (2026-08-18) : la piste defilante
  // qui cachait les heures est devenue une grille qui les montre TOUTES
  // (decision produit de Movsar : « on voit tout mieux »). La contrepartie
  // est de la hauteur de contenu, qui defile dans SA zone (la page, elle, ne
  // defile jamais : gate one-screen). Mesure a la bascule : 1975 px.
  ok(mobile.pickerHeight <= 2100, `mobile 390px : l ecran tient en ${mobile.pickerHeight} px (budget 2100, grille complete assumee)`);
  // Budget releve 26 -> 32 (2026-08-18, refonte mobile) : les chips passent
  // de ~57 a 44 px de haut (densite demandee par Movsar, grille reine), donc
  // l ecran en montre mecaniquement plus. L invariant defendu reste le meme :
  // jamais le mur des 53 pastilles d avant, et la page ne defile pas.
  ok(mobile.visibleChips <= 32, `mobile 390px : ${mobile.visibleChips} pastilles affichees a la fois, jamais le mur des 53 d avant`);
  // La piste horizontale a supprime le filtre par moment de journee : les 53
  // heures des deux activites sont TOUTES dans le DOM, atteignables au doigt,
  // aux fleches ou par saut de moment. Avant, 29 d'entre elles n'existaient pas
  // tant qu'on n'avait pas change d'onglet.
  ok(mobile.reachableChips === 53, `mobile 390px : les ${mobile.reachableChips} heures du jour sont toutes atteignables sans changer d onglet`);
}

// --- 6. CONTRE-EPREUVE PAR MUTATION -----------------------------------------
// On remet le refus d origine dans le moteur et on prouve que l assertion
// centrale de ce gate rougit. Restauration par edition inverse, jamais git.
function checkMutation() {
  console.log('\n[6] CONTRE-EPREUVE par mutation (ce gate sait-il rougir ?)');
  const original = fs.readFileSync(ENGINE, 'utf8');
  const anchor = 'comfortNotices.push({';
  const occurrences = original.split(anchor).length - 1;
  if (occurrences !== 1) {
    ok(false, `ancre de mutation introuvable ou ambigue (${occurrences})`);
    return;
  }
  const mutated = original.replace(anchor, "return { ok: false, code: 'anchor_gap', reason: 'mutation' }; comfortNotices.push({");
  let probe = null;
  try {
    fs.writeFileSync(ENGINE, mutated);
    const script = `const { planningAgent } = require(${JSON.stringify(path.join(ROOT, 'lib/ops-agents'))});
const result = planningAgent({ centerId: ${JSON.stringify(CENTER)}, date: ${JSON.stringify(DATE)}, type: 'formule', formuleId: ${JSON.stringify(FORMULE)}, pax: 10, preference: { preferredTimes: { bowling: ${JSON.stringify(GAP_BOWLING)}, laser_game: ${JSON.stringify(GAP_LASER)} } } }, { reservations: [], laneStatuses: {} });
process.stdout.write(JSON.stringify({ ok: result.ok, code: result.plan.refusalCode || '' }));`;
    probe = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' }));
  } finally {
    fs.writeFileSync(ENGINE, original); // restauration par edition inverse
  }
  ok(probe && probe.ok === false && probe.code === 'anchor_gap',
    `refus remis dans le moteur : le client est de nouveau bloque (ok=${probe?.ok}, code=${probe?.code}) -> le check [1] ROUGIRAIT`);

  const script = `const { planningAgent } = require(${JSON.stringify(path.join(ROOT, 'lib/ops-agents'))});
const result = planningAgent({ centerId: ${JSON.stringify(CENTER)}, date: ${JSON.stringify(DATE)}, type: 'formule', formuleId: ${JSON.stringify(FORMULE)}, pax: 10, preference: { preferredTimes: { bowling: ${JSON.stringify(GAP_BOWLING)}, laser_game: ${JSON.stringify(GAP_LASER)} } } }, { reservations: [], laneStatuses: {} });
process.stdout.write(JSON.stringify({ ok: result.ok, notices: (result.plan.recommended.comfortNotices || []).length }));`;
  const restored = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' }));
  ok(restored.ok === true && restored.notices === 1, 'restauration inverse : la liberte revient avec son avis');
}

// La decision « Garder cet horaire » rendue muette expres : le clic ne
// memorise plus rien, l avis reste plante -> les checks de [3b] rougiraient.
async function checkDismissMutation(page) {
  console.log('\n[6b] CONTRE-EPREUVE : ecarter l avis doit vraiment l ecarter');
  const original = fs.readFileSync(APP, 'utf8');
  const anchor = '  formulaAdviceDismissed = signature;';
  const occurrences = original.split(anchor).length - 1;
  if (occurrences !== 1) {
    ok(false, `ancre de mutation dismiss introuvable ou ambigue (${occurrences})`);
    return;
  }
  let muted = null;
  try {
    fs.writeFileSync(APP, original.replace(anchor, "  formulaAdviceDismissed = '';"));
    await bootFormula(page, 'mutation-dismiss', { bowling: GAP_BOWLING, laser: GAP_LASER });
    muted = await page.evaluate(async () => {
      const ghost = document.querySelector('.visit-rail-advice-ghost');
      if (ghost) ghost.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { adviceStill: Boolean(document.querySelector('.visit-rail-advice')) };
    });
  } finally {
    fs.writeFileSync(APP, original); // restauration par edition inverse
  }
  ok(muted && muted.adviceStill === true,
    'decision rendue muette expres : l avis reste plante -> le check [3b] ROUGIRAIT');
  await bootFormula(page, 'restore-dismiss', { bowling: GAP_BOWLING, laser: GAP_LASER });
  const back = await page.evaluate(async () => {
    const ghost = document.querySelector('.visit-rail-advice-ghost');
    if (ghost) ghost.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { adviceGone: !document.querySelector('.visit-rail-advice') };
  });
  ok(back.adviceGone === true, 'restauration inverse : garder son horaire ecarte de nouveau l avis');
}

async function main() {
  checkEngine();
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await checkBrowser(page);
    await checkDismissMutation(page);
    ok(consoleErrors.length === 0, `aucune erreur console (${consoleErrors.length})${consoleErrors.length ? ' : ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
  checkMutation();

  if (failures) {
    console.error(`\nvisit-freedom-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nvisit-freedom-check: ALL OK - le moteur conseille, il n interdit plus un choix realisable.');
}

main().catch((error) => { console.error(error); process.exit(1); });
