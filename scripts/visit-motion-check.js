// LE MOUVEMENT DU TUNNEL PUBLIC, prouve par la mesure.
//
// Movsar : « rend ce truc bcp plus anime [...] mais faut que ca coute pas trop
// cher et que ca lag pas, ca doit etre bien fluide ». Une animation qui « a
// l'air fluide » ne prouve rien : ce gate lit le CSS REELLEMENT APPLIQUE et
// compte les images.
//
// CE QU'IL PROUVE :
//   1. aucune propriete de MISE EN PAGE n'est animee nulle part dans le
//      parcours client (height, width, top, margin, padding...), et les
//      animations propres au tunnel (`pl-*`) ne touchent que `transform` et
//      `opacity`. Lu dans les regles appliquees et dans les @keyframes du
//      document, jamais dans le fichier source ;
//   2. `prefers-reduced-motion: reduce` supprime REELLEMENT le mouvement :
//      aucune animation en vol au changement d'etape, transitions a zero,
//      et le defilement lance en JS passe en 'auto' ;
//   3. l'echelonnement est BORNE : aucun delai d'animation ne grandit avec le
//      nombre de creneaux ;
//   4. la piste d'heures horizontale ne piege ni le clavier ni l'information :
//      chaque heure est atteignable a la tabulation, le focus ramene l'heure
//      dans le champ, la piste ne vole pas le defilement vertical, et ce qui
//      depasse est signale (etat de la piste + boutons de deplacement) ;
//   5. les CHIFFRES de fluidite : images longues et taches longues pendant le
//      changement d'etape, le saut de moment et le choix d'une heure ;
//   6. la PREUVE EN RAFALE : les metriques DOM ne voyaient pas ce que Movsar
//      voyait (« plusieurs rafraichissements au clic »). Une rafale de
//      captures pendant le clic d'une heure, differenciees pixel a pixel,
//      prouve qu'un geste ne produit qu'UNE vague de changement, sans
//      reconstruire la piste ni faire sauter son defilement.
//
// CONTRE-EPREUVE PAR MUTATION sur 1, 2 et 6, restauration par edition inverse.
//
// Lancement : node scripts/visit-motion-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const opsEngine = require('../lib/ops-engine');
const { planningAgent } = require('../lib/ops-agents');

const CLIENT_CSS = path.join(ROOT, 'assets/pinlane-client.css');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_MOTION_TUNNEL_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

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

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// --- Serveur : vrai index.html, vraie disponibilite -------------------------
function firstActivityTime(scenario, activityId) {
  const block = (scenario.resourceBlocks || []).find((item) => item.activityId === activityId && !item.flexible);
  if (block?.startTime) return block.startTime;
  const step = (scenario.timeline || []).find((item) => item.activityId === activityId && !item.flexible);
  return step?.startTime || null;
}

function toSlot(scenario) {
  return {
    time: scenario.startTime, lanes: scenario.assignedLanes || [], freeCount: 4,
    opsPlan: {
      startTime: scenario.startTime, endTime: scenario.endTime, totalMinutes: scenario.totalMinutes,
      arrivalTime: scenario.arrivalTime || null, arrivalMinutes: scenario.arrivalMinutes || null,
      staffSummary: scenario.staffSummary, assignedLanes: scenario.assignedLanes || [],
      timeline: scenario.timeline || [], resourceBlocks: scenario.resourceBlocks || [],
      firstLaserTime: firstActivityTime(scenario, 'laser_game'), firstBowlingTime: firstActivityTime(scenario, 'bowling'),
      laserSharing: scenario.laserSharing || null, laserPassPlan: scenario.laserPassPlan || null,
      anchorPlan: scenario.anchorPlan || null, comfortNotices: scenario.comfortNotices || [],
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
  if (!(preferredTimes.bowling || preferredTimes.laser_game || laserPlacement === 'onsite')) return { ...base, slots: [], suggestions: [], message: '' };
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
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname === '/api/public-availability') return json(200, availabilityPayload(url.search));
    if (url.pathname === '/api/public-reservations') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => json(201, { ok: true, reservation: { id: 1 }, ops: {}, communications: [], warnings: [] })); return undefined; }
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

async function bootTunnel(page, key) {
  await page.goto(`${BASE_URL}/?v=motion-${key}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 15000 });
  await page.evaluate((date) => {
    state.view = 'client';
    state.booking.date = date;
    state.booking.pax = 10;
    state.booking.mode = 'formule';
    state.booking.type = 'formule';
    state.booking.formuleId = 'f1';
    state.booking.preference = { preferredTimes: { bowling: '15:00', laser_game: '18:30' }, laserPlacement: 'scheduled' };
    setView('client');
    syncBookingTypeUi();
    goStep(1, { animate: false, focus: false });
  }, DATE);
  await page.waitForTimeout(400);
}

// Proprietes dont l'animation force un recalcul de mise en page a chaque image.
const LAYOUT_PROPERTIES = [
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left', 'inset', 'inset-block', 'inset-inline',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-size', 'line-height', 'letter-spacing', 'gap', 'row-gap', 'column-gap',
  'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'flex-basis', 'grid-template-columns', 'grid-template-rows',
];

// Lit les @keyframes DU DOCUMENT (regles reellement chargees) et l'ensemble des
// proprietes que chaque animation touche.
const READ_KEYFRAMES = (layoutProperties) => {
  const animations = {};
  const forbidden = [];
  for (const sheet of [...document.styleSheets]) {
    let rules;
    try { rules = [...sheet.cssRules]; } catch (error) { continue; }
    for (const rule of rules) {
      if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
      const props = new Set();
      for (const frame of [...rule.cssRules]) {
        for (let index = 0; index < frame.style.length; index += 1) props.add(frame.style[index]);
      }
      animations[rule.name] = [...props].sort();
      [...props].forEach((property) => { if (layoutProperties.includes(property)) forbidden.push(`${rule.name}:${property}`); });
    }
  }
  return { animations, forbidden };
};

// Parcourt TOUS les elements du parcours client et lit leur transition/animation
// telles qu'appliquees, pas telles qu'ecrites.
// `transition-property: all` avec une duree nulle est la valeur INITIALE de
// CSS : tout element sans transition la porte. Seule une duree non nulle
// signale une vraie transition, c'est donc la seule qu'on juge.
const READ_APPLIED = (layoutProperties) => {
  const offenders = [];
  const delays = [];
  const toMs = (value) => {
    const text = String(value).trim();
    const number = parseFloat(text);
    if (!Number.isFinite(number)) return 0;
    return text.endsWith('ms') ? number : number * 1000;
  };
  document.querySelectorAll('#clientView, #clientView *').forEach((element) => {
    const style = getComputedStyle(element);
    const properties = style.transitionProperty.split(',').map((value) => value.trim());
    const durations = style.transitionDuration.split(',').map(toMs);
    const name = (element.className || element.tagName).toString().split(' ')[0] || element.tagName;
    properties.forEach((property, index) => {
      const duration = durations[index % durations.length] || 0;
      if (duration <= 0) return;
      if (property === 'all') offenders.push(`${name}: transition-property: all`);
      if (layoutProperties.includes(property)) offenders.push(`${name}: transition ${property}`);
    });
    if (style.animationName && style.animationName !== 'none') {
      style.animationDelay.split(',').forEach((value) => {
        const ms = toMs(value);
        if (Number.isFinite(ms)) delays.push(Math.round(ms));
      });
    }
  });
  return { offenders, maxDelay: delays.length ? Math.max(...delays) : 0, delayCount: delays.length };
};

const START_PERF = () => {
  window.__frames = [];
  window.__long = [];
  try {
    window.__po = new PerformanceObserver((list) => { list.getEntries().forEach((entry) => window.__long.push(Math.round(entry.duration))); });
    window.__po.observe({ entryTypes: ['longtask'] });
  } catch (error) { window.__po = null; }
  let last = performance.now();
  window.__raf = true;
  const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__raf) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

const STOP_PERF = () => {
  window.__raf = false;
  if (window.__po) window.__po.disconnect();
  const deltas = window.__frames.slice(1);
  return {
    frames: deltas.length,
    dropped: deltas.filter((value) => value > 32).length,
    maxFrame: deltas.length ? Math.round(Math.max(...deltas) * 10) / 10 : 0,
    longTasks: window.__long.length,
    longTaskMax: window.__long.length ? Math.max(...window.__long) : 0,
  };
};

async function measureInteraction(page, label, action) {
  await page.evaluate(START_PERF);
  await action();
  await page.waitForTimeout(900);
  const result = await page.evaluate(STOP_PERF);
  console.log(`      ${label} : ${result.frames} images, ${result.dropped} au-dessus de 32 ms (max ${result.maxFrame} ms), ${result.longTasks} tache(s) longue(s)`);
  return result;
}

async function checkProperties(page) {
  console.log('\n[1] Ce qui bouge : transform et opacity, jamais la mise en page');
  const keyframes = await page.evaluate(READ_KEYFRAMES, LAYOUT_PROPERTIES);
  ok(keyframes.forbidden.length === 0,
    `aucune image cle n anime une propriete de mise en page${keyframes.forbidden.length ? ` (${keyframes.forbidden.join(', ')})` : ''}`);
  // Le prefixe `pl-` couvre TOUT le depot (console staff comprise) : on juge
  // strictement les animations du PARCOURS, celles qui viennent d'etre posees.
  const TUNNEL_ANIMATIONS = [
    'pl-step-enter-forward', 'pl-step-enter-back',
    'pl-step-leave-forward', 'pl-step-leave-back',
    'pl-client-enter',
    'pl-advice-in', 'pl-advice-out',
    // Recettes reprises des trois bibliotheques fournies, ramenees a la
    // grammaire du depot : cascade d'arrivee, capsule du creneau retenu,
    // respiration du sceau de confirmation.
    'pl-rise', 'pl-chip-pop', 'pl-seal-breathe',
  ];
  const allowed = new Set(['transform', 'opacity']);
  TUNNEL_ANIMATIONS.forEach((name) => {
    const props = keyframes.animations[name];
    ok(Array.isArray(props), `le mouvement « ${name} » est charge`);
    if (!Array.isArray(props)) return;
    ok(props.every((property) => allowed.has(property)),
      `« ${name} » ne touche que transform et opacity (${props.join(' + ')})`);
  });

  const applied = await page.evaluate(READ_APPLIED, LAYOUT_PROPERTIES);
  ok(applied.offenders.length === 0,
    `aucune transition appliquee ne porte sur la mise en page ni sur « all »${applied.offenders.length ? ` (${applied.offenders.slice(0, 4).join(' | ')})` : ''}`);
  // Echelonnement BORNE : un delai qui grandit avec le nombre de creneaux fait
  // ramer l'ecran des la vingtieme pastille.
  ok(applied.maxDelay <= 200, `l echelonnement est borne : plus grand delai ${applied.maxDelay} ms (plafond 200)`);
}

async function checkReducedMotion(page) {
  console.log('\n[2] prefers-reduced-motion : tout se pose, rien ne bouge');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootTunnel(page, 'reduce');
  const reduced = await page.evaluate(async () => {
    const seen = { classes: [], running: 0 };
    goStep(2);
    const step = document.getElementById('step2');
    seen.classes = [...step.classList];
    seen.running = document.getAnimations().filter((animation) => {
      const timing = animation.effect && animation.effect.getTiming();
      return timing && Number(timing.duration) > 1;
    }).length;
    const rail = getComputedStyle(document.querySelector('#clientView .progress-rail-fill'));
    return {
      ...seen,
      prefers: typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : null,
      railTransition: rail.transitionDuration,
      stepAnimation: getComputedStyle(step).animationName,
    };
  });
  ok(reduced.prefers === true, 'la page sait que le mouvement reduit est demande');
  ok(!reduced.classes.some((name) => name.startsWith('is-entering') || name.startsWith('is-leaving')),
    `aucune classe de mouvement n est posee sur l etape (${reduced.classes.join(' ') || 'aucune'})`);
  ok(reduced.stepAnimation === 'none', `aucune animation sur l etape qui arrive (${reduced.stepAnimation})`);
  ok(reduced.running === 0, `aucune animation de plus d une milliseconde en vol (${reduced.running})`);
  // 0,01 ms est la valeur du reset global de DESIGN.md §8 : instantane a l oeil.
  const railMs = reduced.railTransition.trim().endsWith('ms')
    ? parseFloat(reduced.railTransition)
    : parseFloat(reduced.railTransition) * 1000;
  ok(railMs <= 1, `le rail de progression se pose sans transition perceptible (${reduced.railTransition})`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function checkTrack(page) {
  console.log('\n[3] La piste d heures : ni piege clavier, ni information cachee');
  await bootTunnel(page, 'track');
  await page.evaluate(() => goStep2());
  await page.waitForTimeout(900);

  const track = await page.evaluate(() => {
    const element = document.querySelector('.anchor-track[data-anchor="bowling"]');
    if (!element) return null;
    const style = getComputedStyle(element);
    const chips = [...element.querySelectorAll('.anchor-chip')];
    return {
      chips: chips.length,
      focusable: chips.every((chip) => !chip.disabled && chip.tabIndex >= 0),
      overflowY: style.overflowY,
      overflowX: style.overflowX,
      overscrollX: style.overscrollBehaviorX,
      scrollable: element.scrollWidth > element.clientWidth,
      overflowState: element.dataset.overflow,
      nudges: [...(element.closest('.anchor-periods')?.querySelectorAll('.anchor-track-nudge') || [])]
        .map((button) => `${button.dataset.direction}:${button.disabled ? 'off' : 'on'}`),
      // Rien d'atteignable ne doit vivre en dehors du contenu defilable.
      insideContent: chips.every((chip) => chip.offsetLeft - element.offsetLeft + chip.offsetWidth <= element.scrollWidth + 1),
    };
  });
  ok(Boolean(track), 'la piste du bowling existe');
  ok(track.chips >= 20, `la piste porte la journee entiere (${track.chips} heures)`);
  ok(track.focusable, 'chaque heure est atteignable a la tabulation');
  ok(track.overflowY === 'hidden', `la piste ne defile jamais verticalement (overflow-y: ${track.overflowY})`);
  ok(track.overscrollX === 'contain', `la piste ne vole pas le defilement de la page (overscroll-behavior-x: ${track.overscrollX})`);
  ok(track.scrollable && track.overflowState !== 'none', `ce qui depasse est signale (etat « ${track.overflowState} »)`);
  ok(track.nudges.includes('1:on'), `un bouton mene aux heures suivantes (${track.nudges.join(', ')})`);
  ok(track.insideContent, 'aucune heure ne vit en dehors du contenu defilable');

  // Le focus clavier RAMENE l'heure dans le champ : c'est ce qui rend la piste
  // utilisable sans souris ni doigt.
  const focusBrings = await page.evaluate(async () => {
    const element = document.querySelector('.anchor-track[data-anchor="bowling"]');
    element.scrollLeft = 0;
    const chips = [...element.querySelectorAll('.anchor-chip')];
    const last = chips[chips.length - 1];
    last.focus();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const frame = element.getBoundingClientRect();
    const box = last.getBoundingClientRect();
    return { scrollLeft: Math.round(element.scrollLeft), visible: box.left >= frame.left - 1 && box.right <= frame.right + 1 };
  });
  ok(focusBrings.scrollLeft > 0 && focusBrings.visible,
    `donner le focus a la derniere heure la ramene dans le champ (scrollLeft ${focusBrings.scrollLeft})`);

  // Au bout de la piste, le bouton qui n'a plus rien a montrer s'eteint.
  const atEnd = await page.evaluate(async () => {
    const element = document.querySelector('.anchor-track[data-anchor="bowling"]');
    element.scrollLeft = element.scrollWidth;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      state: element.dataset.overflow,
      nudges: [...element.closest('.anchor-periods').querySelectorAll('.anchor-track-nudge')]
        .map((button) => `${button.dataset.direction}:${button.disabled ? 'off' : 'on'}`),
    };
  });
  ok(atEnd.state === 'start' && atEnd.nudges.includes('1:off') && atEnd.nudges.includes('-1:on'),
    `arrive au bout, l indicateur et les boutons le disent (${atEnd.state} / ${atEnd.nudges.join(', ')})`);
}

// Le sceau du bouton de confirmation : il accuse, il travaille, il scelle, et
// il ne redessine JAMAIS une largeur ni une hauteur.
async function checkSeal(page) {
  console.log('\n[3b] Le sceau du bouton de confirmation');
  await bootTunnel(page, 'seal');
  const seal = await page.evaluate(() => {
    const button = document.getElementById('btnConfirmBooking');
    setBookingSubmitBusy(true);
    const busy = { classes: [...button.classList], aria: button.getAttribute('aria-busy'), label: button.querySelector('.btn-label') ? button.querySelector('.btn-label').textContent.trim().slice(0, 20) : '' };
    const box = button.getBoundingClientRect();
    sealBookingSubmit();
    const sealed = { classes: [...button.classList], width: Math.round(box.width), height: Math.round(box.height) };
    const after = button.getBoundingClientRect();
    // `getComputedStyle` rend un objet VIVANT : lu apres la remise a zero
    // ci-dessous, il aurait donne l'etat du bouton au repos. On fige la valeur.
    const checkTransition = String(getComputedStyle(button.querySelector('.btn-seal-check')).transitionProperty);
    setBookingSubmitBusy(false);
    return { busy, sealed, sameBox: Math.abs(after.width - box.width) < 1 && Math.abs(after.height - box.height) < 1, checkTransition };
  });
  ok(seal.busy.classes.includes('is-sealing'), `le clic accuse reception (${seal.busy.classes.join(' ')})`);
  ok(seal.busy.aria === 'true', 'le bouton se declare occupe pour la synthese vocale');
  ok(/Confirmer/.test(seal.busy.label), `le libelle reste dans le DOM, il ne fait que s effacer ("${seal.busy.label}")`);
  ok(seal.sealed.classes.includes('is-sealed'), 'le succes scelle le bouton');
  ok(seal.sameBox, 'la boite du bouton ne change NI de largeur NI de hauteur pendant tout le sceau');
  ok(/stroke-dashoffset/.test(seal.checkTransition), `la coche se dessine par son trace (${seal.checkTransition})`);
}

// --- LA PREUVE EN RAFALE ----------------------------------------------------
// Les métriques DOM (mutations, réseau, longtask) ne voyaient PAS ce que
// Movsar voyait : « on clique sur un bouton ça fait plusieurs
// rafraîchissements ». La preuve est VISUELLE : une rafale de captures pendant
// le geste, différenciées pixel à pixel dans le navigateur. Un geste propre ne
// change des pixels QUE dans la zone légitimement animée, en UNE vague.
async function burstDiff(page, action, { durationMs = 1100 } = {}) {
  const before = await page.evaluate(() => {
    const track = document.querySelector('.anchor-track[data-anchor="bowling"]');
    if (track) track.__burstMark = true;
    return { scrollLeft: track ? Math.round(track.scrollLeft) : -1, scrollY: Math.round(window.scrollY) };
  });
  const frames = [];
  const startedAt = Date.now();
  let acted = false;
  while (Date.now() - startedAt < durationMs) {
    if (!acted && Date.now() - startedAt >= 60) { await action(); acted = true; }
    frames.push({ t: Date.now() - startedAt, shot: await page.screenshot({ fullPage: false }) });
  }
  const events = [];
  for (let index = 1; index < frames.length; index += 1) {
    const result = await page.evaluate(async ([b64a, b64b]) => {
      const load = (b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = 'data:image/png;base64,' + b64;
      });
      const [ia, ib] = await Promise.all([load(b64a), load(b64b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { n: -1 };
      const canvas = new OffscreenCanvas(ia.width, ia.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(ia, 0, 0);
      const da = ctx.getImageData(0, 0, ia.width, ia.height).data;
      ctx.clearRect(0, 0, ia.width, ia.height);
      ctx.drawImage(ib, 0, 0);
      const db = ctx.getImageData(0, 0, ia.width, ia.height).data;
      let n = 0;
      for (let k = 0; k < da.length; k += 4) {
        if (Math.abs(da[k] - db[k]) > 8 || Math.abs(da[k + 1] - db[k + 1]) > 8 || Math.abs(da[k + 2] - db[k + 2]) > 8) n += 1;
      }
      return { n, total: ia.width * ia.height };
    }, [frames[index - 1].shot.toString('base64'), frames[index].shot.toString('base64')]);
    if (result.n > 0) events.push({ t: frames[index].t, pixels: result.n, share: result.n / result.total });
  }
  const after = await page.evaluate(() => {
    const track = document.querySelector('.anchor-track[data-anchor="bowling"]');
    return {
      sameTrack: Boolean(track && track.__burstMark),
      scrollLeft: track ? Math.round(track.scrollLeft) : -1,
      scrollY: Math.round(window.scrollY),
    };
  });
  return {
    frames: frames.length,
    events,
    bigWaves: events.filter((event) => event.share > 0.08).length,
    sameTrack: after.sameTrack,
    trackScrollKept: before.scrollLeft === after.scrollLeft,
    pageScrollKept: before.scrollY === after.scrollY,
  };
}

function describeBurst(result) {
  const waves = result.events.map((event) => `${event.t}ms:${Math.round(event.share * 1000) / 10}%`).join(', ');
  return `${result.frames} images, ${result.events.length} changement(s) [${waves || 'aucun'}]`;
}

async function clickFreshChip(page) {
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.anchor-row[data-anchor="bowling"] .anchor-chip')]
      .find((item) => !item.classList.contains('active') && !item.disabled);
    if (chip) chip.click();
  });
}

async function checkClickCalm(page) {
  console.log('\n[3c] Un clic d heure = UNE vague de changement, jamais des rafraichissements');
  await bootTunnel(page, 'calm');
  await page.evaluate(() => goStep2());
  await page.waitForTimeout(1200);
  const result = await burstDiff(page, () => clickFreshChip(page));
  console.log(`      ${describeBurst(result)}`);
  ok(result.events.length > 0, 'le clic change bien quelque chose a l ecran');
  ok(result.bigWaves <= 1,
    `au plus UNE vague depasse 8 % de l ecran (${result.bigWaves}) : pas de reconstruction en cascade`);
  ok(result.sameTrack, 'la piste d heures n est pas reconstruite par le clic (meme noeud DOM)');
  ok(result.trackScrollKept, 'le defilement de la piste ne saute pas');
  ok(result.pageScrollKept, 'la page ne defile pas toute seule');
  return result;
}

async function checkFluidity(page) {
  console.log('\n[4] Fluidite mesuree (60 Hz : une image « normale » vaut ~16,8 ms,');
  console.log('    le signal utile est donc l image PERDUE au-dela de 32 ms et la tache longue)');
  const results = {};
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await bootTunnel(page, `perf-${width}`);
    console.log(`    ${width} px :`);
    results[`step-${width}`] = await measureInteraction(page, 'changement d etape 1 vers 2', () => page.evaluate(() => goStep2()));
    results[`period-${width}`] = await measureInteraction(page, 'saut de moment de journee', () => page.evaluate(() => {
      const tab = [...document.querySelectorAll('.anchor-period-tab')].find((item) => !item.classList.contains('active'));
      if (tab) tab.click();
    }));
    results[`pick-${width}`] = await measureInteraction(page, 'choix d une heure', () => page.evaluate(() => {
      const chip = [...document.querySelectorAll('.anchor-chip')].find((item) => !item.classList.contains('active') && !item.disabled);
      if (chip) chip.click();
    }));
    results[`back-${width}`] = await measureInteraction(page, 'retour arriere (sens inverse)', () => page.evaluate(() => goStep(1)));
  }
  Object.entries(results).forEach(([key, value]) => {
    ok(value.longTasks === 0, `${key} : aucune tache longue sur le fil principal (${value.longTasks})`);
    // Une seule image perdue reste dans le bruit d'un ordonnanceur ; deux, non.
    ok(value.dropped <= 1, `${key} : ${value.dropped} image perdue au plus (max ${value.maxFrame} ms)`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

// --- CONTRE-EPREUVE PAR MUTATION --------------------------------------------
async function checkMutations(page) {
  console.log('\n[5] CONTRE-EPREUVE par mutation (ce gate sait-il rougir ?)');

  // (a) une animation de mise en page glissee dans le mouvement d'etape.
  const css = fs.readFileSync(CLIENT_CSS, 'utf8');
  const cssAnchor = '@keyframes pl-step-enter-forward {';
  ok(css.split(cssAnchor).length - 1 === 1, 'ancre CSS de mutation unique');
  try {
    fs.writeFileSync(CLIENT_CSS, css.replace(cssAnchor, `${cssAnchor}\n  from { height: 0; }`));
    await bootTunnel(page, 'mutation-css');
    const mutated = await page.evaluate(READ_KEYFRAMES, LAYOUT_PROPERTIES);
    ok(mutated.forbidden.some((entry) => entry.startsWith('pl-step-enter-forward:height')),
      `hauteur animee dans le mouvement d etape : le check [1] ROUGIRAIT (${mutated.forbidden.join(', ')})`);
  } finally {
    fs.writeFileSync(CLIENT_CSS, css);
  }
  await bootTunnel(page, 'restore-css');
  const restoredCss = await page.evaluate(READ_KEYFRAMES, LAYOUT_PROPERTIES);
  ok(restoredCss.forbidden.length === 0, 'restauration inverse : plus aucune propriete de mise en page animee');

  // (b) le respect du mouvement reduit desactive.
  const app = fs.readFileSync(APP, 'utf8');
  const jsAnchor = "  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;";
  ok(app.split(jsAnchor).length - 1 === 1, 'ancre JS de mutation unique');
  try {
    fs.writeFileSync(APP, app.replace(jsAnchor, '  return false;'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bootTunnel(page, 'mutation-js');
    const mutated = await page.evaluate(() => {
      goStep(2);
      const step = document.getElementById('step2');
      return { classes: [...step.classList], prefers: prefersReducedMotion() };
    });
    ok(mutated.prefers === false && mutated.classes.some((name) => name.startsWith('is-entering')),
      `mouvement reduit ignore : l etape bouge quand meme (${mutated.classes.join(' ')}) : le check [2] ROUGIRAIT`);
  } finally {
    fs.writeFileSync(APP, app);
  }
  await bootTunnel(page, 'restore-js');
  const restoredJs = await page.evaluate(() => {
    goStep(2);
    return { classes: [...document.getElementById('step2').classList], prefers: prefersReducedMotion() };
  });
  ok(restoredJs.prefers === true && !restoredJs.classes.some((name) => name.startsWith('is-entering')),
    'restauration inverse : le mouvement reduit est de nouveau respecte');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // (c) la reconstruction en cascade d'avant (trois rendus complets par clic
  // d'heure) remise expres : la rafale doit la voir, sinon elle ne protege
  // rien. Deux anchors : le rendu « occupe » redevient un innerHTML complet,
  // et le fetch re-rend une deuxieme fois.
  const app2 = fs.readFileSync(APP, 'utf8');
  const syncAnchor = 'if (!syncFormulaAnchorUi(formule, { busy: true })) renderSlots(formule);';
  const fetchAnchor = 'await fetchSlots({ showLoading: false, render: false });';
  ok(app2.split(syncAnchor).length - 1 === 1 && app2.split(fetchAnchor).length - 1 === 1,
    'ancres JS de mutation flicker uniques');
  let mutatedBurst = null;
  try {
    fs.writeFileSync(APP, app2
      .replace(syncAnchor, 'renderSlots(formule);')
      .replace(fetchAnchor, 'await fetchSlots({ showLoading: false });'));
    await bootTunnel(page, 'mutation-flicker');
    await page.evaluate(() => goStep2());
    await page.waitForTimeout(1200);
    mutatedBurst = await burstDiff(page, () => clickFreshChip(page));
    console.log(`      mutation : ${describeBurst(mutatedBurst)}`);
  } finally {
    fs.writeFileSync(APP, app2);
  }
  ok(mutatedBurst.bigWaves >= 2 || !mutatedBurst.sameTrack,
    `reconstruction remise expres : ${mutatedBurst.bigWaves} grande(s) vague(s), piste ${mutatedBurst.sameTrack ? 'conservee' : 'RECONSTRUITE'} -> le check [3c] ROUGIRAIT`);
  await bootTunnel(page, 'restore-flicker');
  await page.evaluate(() => goStep2());
  await page.waitForTimeout(1200);
  const calmAgain = await burstDiff(page, () => clickFreshChip(page));
  ok(calmAgain.bigWaves <= 1 && calmAgain.sameTrack,
    `restauration inverse : le clic redevient UNE vague (${calmAgain.bigWaves}) sur la meme piste`);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await bootTunnel(page, 'base');
    await page.evaluate(() => goStep2());
    await page.waitForTimeout(900);
    await checkProperties(page);
    await checkReducedMotion(page);
    await checkTrack(page);
    await checkSeal(page);
    await checkClickCalm(page);
    await checkFluidity(page);
    await checkMutations(page);
    ok(consoleErrors.length === 0, `aucune erreur console (${consoleErrors.length})${consoleErrors.length ? ' : ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`\nvisit-motion-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nvisit-motion-check: ALL OK - le tunnel bouge sans rien recalculer, et se tait quand on le lui demande.');
}

main().catch((error) => { console.error(error); process.exit(1); });
