// LA VISITE : plusieurs activites dans UNE reservation, prouvee dans un vrai
// navigateur, de la grille de choix jusqu'au corps du POST.
//
// Le tunnel imposait un choix exclusif (bowling OU laser OU formule) et ignorait
// tout ce que le centre vend d'autre. Ce gate verifie le COMPORTEMENT, jamais la
// presence d'une chaine :
//   1. la grille propose les activites REELLES du centre (billards compris) ;
//   2. cocher trois activites compose un programme et un total honnete ("a
//      partir de" tant qu'une activite n'a pas de tarif saisi) ;
//   3. la requete de disponibilite part en type=visite avec le panier complet ;
//   4. le POST de reservation porte le programme (le prix, lui, est recalcule
//      serveur : le navigateur n'est jamais cru) ;
//   5. une activite fermee ce jour est desactivee ET decochee ;
//   6. sans aucune activite cochee, on ne passe pas a l'etape des creneaux ;
//   7. une seule activite planifiee reste sur son chemin HISTORIQUE (type=bowling),
//      c'est ce qui garantit qu'on n'a pas deplace le sol sous les reservations
//      d'aujourd'hui.
// Puis une contre-preuve par MUTATION (le gate sait-il rougir ?) avec
// restauration par edition inverse, jamais git checkout.
//
// Lancement : node scripts/visit-booking-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_VISIT_PORT || 4207);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const DATE = '2026-08-08'; // samedi ouvert : deterministe, jamais un jour ferme

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

// Le catalogue servi par /api/public-booking-meta. Copie fidele de ce que rend
// lib/activity-catalog pour Libramont : deux planifiees, six libres, aucun tarif
// libre saisi (l'etat REEL de la prod tant que le client n'a pas donne ses prix).
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: null, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', order: 8, defaultMinutes: 30 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: 'par personne', order: 9, defaultMinutes: 30 },
];

async function installMock(page, { closedActivityIds = [] } = {}) {
  await page.addInitScript(({ DATE, ACTIVITIES, closedActivityIds }) => {
    window.__QA_CALLS__ = { availability: [], reservations: [] };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const slot = (time) => ({
      time,
      lanes: [1, 2],
      freeCount: 4,
      opsPlan: {
        startTime: time, endTime: '17:15', totalMinutes: 135, assignedLanes: [1, 2],
        resourceBlocks: [
          { resourceType: 'bowling_lane', activityId: 'bowling', startTime: time, endTime: '16:00', lanes: [1, 2] },
          { resourceType: 'laser_arena', activityId: 'laser_game', startTime: '16:30', endTime: '16:55' },
        ],
        timeline: [], staffSummary: 'Visite', firstBowlingTime: time, firstLaserTime: '16:30',
      },
    });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today: DATE, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
            offerAvailability: {},
            day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: closedActivityIds, unavailableFormulaReason: {} },
          },
        });
      }
      if (u.pathname === '/api/public-availability') {
        window.__QA_CALLS__.availability.push(u.search);
        return J({ ok: true, date: DATE, slots: [slot('15:00'), slot('16:00')], laneCount: 2, duration: 1, totalDuration: 2.25, price: 222, requiresLanes: true, label: 'Votre visite', anchors: null, message: '' });
      }
      if (u.pathname === '/api/public-reservations') {
        const body = JSON.parse(String(init.body || '{}'));
        window.__QA_CALLS__.reservations.push(body);
        return new Response(JSON.stringify({
          ok: true,
          reservation: { id: 4242, ...body, lanes: [1, 2], status: 'pending', price: 222, program: body.program ? { items: body.program.map((i) => ({ ...i, name: i.activityId, planned: i.activityId === 'bowling' || i.activityId === 'laser_game' })), price: 222, priceComplete: false } : null },
          ops: {}, communications: [], warnings: [],
        }), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return nativeFetch(input, init);
    };
  }, { DATE, ACTIVITIES, closedActivityIds });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function bootClient(page, cacheKey) {
  await page.goto(`${BASE_URL}/?v=visit-${cacheKey}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.syncBookingTypeUi === 'function', null, { timeout: 15000 });
  await page.evaluate((d) => {
    state.view = 'client';
    state.booking.date = d;
    state.booking.pax = 8;
    state.booking.mode = 'carte';
    state.booking.activities = { bowling: { duration: 1 } };
    setView('client');
    syncBookingTypeUi();
  }, DATE);
  await page.waitForTimeout(500);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });

  try {
    await installMock(page);
    await bootClient(page, 'base');

    // =====================================================================
    console.log('\n[1] La grille propose ce que le centre vend REELLEMENT');
    // =====================================================================
    const grid = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#activityPicker .activity-card')];
      return {
        count: cards.length,
        names: cards.map((c) => c.querySelector('.activity-name')?.textContent.trim()),
        prices: cards.map((c) => c.querySelector('.activity-price')?.textContent.trim()),
        checked: cards.filter((c) => c.classList.contains('is-on')).map((c) => c.querySelector('.activity-name')?.textContent.trim()),
      };
    });
    ok(grid.count === 8, `8 activites proposees pour Libramont (obtenu ${grid.count})`);
    ok(grid.names.includes('Billards'), 'Billards est proposé (il n existait dans AUCUN catalogue produit avant)');
    ok(grid.names.includes('Fun Run by PIXEL'), 'Fun Run by PIXEL est proposé');
    ok(grid.checked.length === 1 && grid.checked[0] === 'Bowling', 'a l ouverture, le bowling seul est coche (formulaire identique a avant)');
    ok(grid.prices.some((p) => p === 'réglé sur place'), 'une activite sans tarif saisi annonce "réglé sur place", jamais 0 EUR');

    // =====================================================================
    console.log('\n[2] Composer une visite : trois activites, un total honnete');
    // =====================================================================
    await page.evaluate(() => { toggleBookingActivity('laser_game'); });
    await page.evaluate(() => { setBookingActivityOption('laser_game', 'games', 2); });
    await page.evaluate(() => { toggleBookingActivity('minigolf_blacklight'); });
    await page.waitForTimeout(200);
    const summary = await page.evaluate(() => ({
      line: document.querySelector('#programSummary .program-line')?.textContent.trim() || '',
      total: document.querySelector('#programSummary .program-total')?.textContent.trim() || '',
      type: state.booking.type,
      chosen: getChosenActivities().map((a) => a.id),
    }));
    ok(summary.chosen.join(',') === 'bowling,laser_game,minigolf_blacklight', `les trois activites sont retenues (${summary.chosen.join(',')})`);
    ok(summary.line.includes('Bowling') && summary.line.includes('Laser 2 parties') && summary.line.includes('Minigolf'),
      `le programme se lit en clair : "${summary.line}"`);
    // 8 joueurs : bowling 1h sur 2 pistes (39x2) + laser 2 parties (18x8) = 222.
    ok(summary.total.startsWith('à partir de 222€'),
      `total "a partir de" tant qu une activite n a pas de tarif (obtenu "${summary.total}")`);
    ok(summary.type === 'visite', 'le type derive passe a "visite" des qu il y a plus d une activite');

    // =====================================================================
    console.log('\n[3] La requete de disponibilite porte le panier complet');
    // =====================================================================
    await page.evaluate(() => { window.__QA_CALLS__.availability = []; return goStep2(); });
    await page.waitForTimeout(700);
    const availabilityCall = await page.evaluate(() => window.__QA_CALLS__.availability[0] || '');
    const availParams = new URLSearchParams(availabilityCall);
    const sentProgram = JSON.parse(availParams.get('program') || '[]');
    ok(availParams.get('type') === 'visite', `type=visite envoye (obtenu ${availParams.get('type')})`);
    ok(availParams.get('pax') === '8', 'le nombre de joueurs suit');
    ok(sentProgram.length === 3, `le panier envoye contient 3 lignes (obtenu ${sentProgram.length})`);
    ok(sentProgram.some((i) => i.activityId === 'bowling' && i.duration === 1), 'la ligne bowling porte sa duree');
    ok(sentProgram.some((i) => i.activityId === 'laser_game' && i.games === 2), 'la ligne laser porte ses parties');
    ok(sentProgram.some((i) => i.activityId === 'minigolf_blacklight'), 'la ligne minigolf est presente');
    ok(!JSON.stringify(sentProgram).includes('price'), 'AUCUN prix n est envoye par le navigateur (le serveur recalcule)');

    // =====================================================================
    console.log('\n[4] Le POST de reservation porte le programme');
    // =====================================================================
    const posted = await page.evaluate(async () => {
      selectSlot(0); // selectSlot prend l INDEX du creneau, pas ses valeurs
      state.booking.name = 'Groupe QA';
      state.booking.phone = '+32470000000';
      state.booking.email = 'qa@pinlane.test';
      window.__QA_CALLS__.reservations = [];
      await confirmBooking();
      return window.__QA_CALLS__.reservations[0] || null;
    });
    ok(posted && Array.isArray(posted.program) && posted.program.length === 3,
      `le corps du POST contient le programme des 3 activites (${posted && posted.program ? posted.program.length : 'aucun'})`);
    ok(posted && posted.type === 'visite', `le POST declare type=visite (obtenu ${posted && posted.type})`);
    ok(posted && posted.program.some((i) => i.activityId === 'minigolf_blacklight'),
      'le minigolf, qui n occupe aucune ressource, part quand meme au serveur : c est tout l objet de la feature');

    // =====================================================================
    console.log('\n[5] Une activite fermee ce jour est desactivee ET decochee');
    // =====================================================================
    await page.evaluate(() => {
      setCenterDayStatus({ date: state.booking.date, open: true, unavailableActivityIds: ['minigolf_blacklight'], unavailableFormulaIds: [], unavailableFormulaReason: {}, closedWindows: [] }, 'libramont');
      state.booking.activities = { bowling: { duration: 1 }, minigolf_blacklight: {} };
      syncBookingTypeUi();
    });
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#activityPicker .activity-card')]
        .find((c) => c.querySelector('.activity-name')?.textContent.trim() === 'Minigolf Blacklight');
      return {
        off: card?.classList.contains('is-off'),
        disabled: card?.querySelector('.activity-toggle')?.disabled,
        label: card?.querySelector('.activity-price')?.textContent.trim(),
        stillChosen: Boolean(state.booking.activities.minigolf_blacklight),
        alert: document.getElementById('typeAlert')?.textContent || '',
      };
    });
    ok(closed.off === true && closed.disabled === true, 'la carte fermee est eteinte et non cliquable');
    ok(closed.label === 'Fermé ce jour', `la carte le DIT ("${closed.label}")`);
    ok(closed.stillChosen === false, 'et elle est retiree du programme : on ne part pas a l etape suivante avec un choix mort');
    ok(closed.alert.includes('Minigolf'), 'le bandeau nomme l activite fermee');

    // =====================================================================
    console.log('\n[6] Aucune activite cochee : on ne passe pas');
    // =====================================================================
    const blocked = await page.evaluate(async () => {
      setCenterDayStatus(null, 'libramont');
      state.booking.activities = {};
      syncBookingTypeUi();
      const before = state.step;
      window.__QA_CALLS__.availability = [];
      await goStep2();
      return { before, after: state.step, calls: window.__QA_CALLS__.availability.length };
    });
    ok(blocked.after === blocked.before && blocked.calls === 0,
      `sans activite : aucun appel de disponibilite et l etape ne change pas (etape ${blocked.after})`);

    // =====================================================================
    console.log('\n[7] Une seule activite planifiee garde le chemin HISTORIQUE');
    // =====================================================================
    const legacy = await page.evaluate(async () => {
      state.booking.activities = { bowling: { duration: 1 } };
      applyChosenActivitiesToBooking();
      syncBookingTypeUi();
      window.__QA_CALLS__.availability = [];
      await goStep2();
      return { type: state.booking.type, query: window.__QA_CALLS__.availability[0] || '' };
    });
    await page.waitForTimeout(300);
    const legacyParams = new URLSearchParams(legacy.query);
    ok(legacy.type === 'bowling', 'bowling seul reste de type "bowling"');
    ok(legacyParams.get('type') === 'bowling' && !legacyParams.get('program'),
      'sa requete est celle d avant : type=bowling, aucun panier (zero regression sur le parcours du jour)');
    ok(legacyParams.get('duration') === '1', 'la duree part comme avant');

    // =====================================================================
    console.log('\n[8] Cote STAFF : la fiche montre le programme complet');
    // =====================================================================
    // C'est la demande d'origine : « eux peuvent reserver et on doit voir ».
    // Le comptoir doit lire le minigolf et les billards sur la fiche, meme si
    // aucun des deux n'occupe la moindre ressource.
    const staff = await page.evaluate(() => {
      const reservation = {
        id: 1, name: 'Groupe QA', type: 'bowling', label: 'Bowling 1h · Laser 2 parties · Minigolf Blacklight',
        program: {
          items: [
            { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, price: 78, priceKnown: true },
            { activityId: 'laser_game', name: 'Laser Game', planned: true, games: 2, price: 144, priceKnown: true },
            { activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, price: null, priceKnown: false },
            { activityId: 'billards', name: 'Billards', planned: false, units: 2, hours: 1.5, price: null, priceKnown: false },
          ],
          price: 222,
          priceComplete: false,
        },
      };
      const html = renderReservationProgram(reservation);
      const mono = renderReservationProgram({ id: 2, type: 'bowling', label: 'Bowling Classique', program: null });
      const host = document.createElement('div');
      host.innerHTML = html;
      return {
        text: host.textContent.replace(/\s+/g, ' ').trim(),
        rows: host.querySelectorAll('div[style*="justify-content:space-between"]').length,
        monoEmpty: mono === '',
      };
    });
    ok(staff.rows === 4, `les 4 lignes du programme sont rendues (obtenu ${staff.rows})`);
    ok(staff.text.includes('Minigolf Blacklight') && staff.text.includes('Billards'),
      'les activites libres sont nommees sur la fiche');
    ok(staff.text.includes('Billards 2 x 1.5h'), 'le detail des billards (2 tables, 1h30) est lisible');
    ok(staff.text.includes('planifié') && staff.text.includes('sur place'),
      'la fiche distingue ce qui est place au planning de ce qui se regle au comptoir');
    ok(staff.text.includes('à prévoir au comptoir'), 'le comptoir est prevenu explicitement');
    ok(staff.monoEmpty === true, 'une reservation mono-activite n affiche AUCUN bloc programme (fiche inchangee)');

    // =====================================================================
    console.log('\n[9] Les deux plaintes exactes, devenues des assertions');
    // =====================================================================
    // « les coches sont pas bien cadrees » et « 0 animation, zero motion ».
    // Un correctif meurt en silence, une assertion crie.
    await bootClient(page, 'motion');
    const motion = await page.evaluate(async () => {
      const card = () => document.querySelector('#activityPicker .activity-card[data-activity="bowling"]');
      // 1. La carte SURVIT au clic : c'est la condition de toute animation.
      //    Tant que le bloc etait reecrit, aucune transition ne pouvait exister.
      const before = card();
      toggleBookingActivity('laser_game');
      toggleBookingActivity('minigolf_blacklight');
      const sameNode = card() === before;

      // 2. Centrage de la coche : on MESURE, on ne regarde pas.
      const ring = document.querySelector('.activity-card.is-on .activity-check');
      const svg = ring?.querySelector('svg');
      const r = ring.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const dx = Math.abs((r.left + r.width / 2) - (s.left + s.width / 2));
      const dy = Math.abs((r.top + r.height / 2) - (s.top + s.height / 2));

      // 3. Les options d'une carte NON cochee existent quand meme dans le DOM :
      //    sans ca, elles ne pourraient qu'apparaitre d'un coup.
      const closedCard = document.querySelector('#activityPicker .activity-card:not(.is-on)');
      const hiddenOptions = closedCard?.querySelector('.activity-options-inner');
      const rows = getComputedStyle(closedCard.querySelector('.activity-options')).gridTemplateRows;

      // 4. Les transitions sont reellement declarees (pas seulement ecrites).
      const cardStyle = getComputedStyle(card());
      const ringStyle = getComputedStyle(ring);

      // 5. Le montant reagit quand il change.
      const total = document.querySelector('.program-total');
      // On attend la fin de l'animation d'entree : la classe se retire d'elle
      // meme, sinon elle resterait posee et ne signalerait plus rien.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const bumpedBefore = total.classList.contains('is-bumped');
      setBookingActivityOption('bowling', 'duration', 2);
      const bumpedAfter = document.querySelector('.program-total').classList.contains('is-bumped');

      return {
        sameNode,
        dx: Math.round(dx * 100) / 100,
        dy: Math.round(dy * 100) / 100,
        hasHiddenOptions: Boolean(hiddenOptions && hiddenOptions.innerHTML.trim()),
        collapsedRows: rows,
        cardTransition: cardStyle.transitionProperty,
        ringTransition: ringStyle.transitionProperty,
        bumpedBefore,
        bumpedAfter,
        iconCount: document.querySelectorAll('#activityPicker .activity-icon svg').length,
      };
    });
    ok(motion.sameNode === true,
      'la carte SURVIT au clic (meme noeud DOM) : sans ca, aucune transition ne peut exister');
    ok(motion.dx <= 1 && motion.dy <= 1,
      `la coche est centree dans son anneau a ${motion.dx} / ${motion.dy} px pres (mesure, pas oeil)`);
    ok(motion.hasHiddenOptions === true && motion.collapsedRows.startsWith('0'),
      `les options d une carte non cochee sont deja dans le DOM et repliees (${motion.collapsedRows}) : elles se deplient au lieu d apparaitre`);
    ok(/transform/.test(motion.cardTransition) && /background-color/.test(motion.ringTransition),
      'les transitions sont declarees sur la carte et sur la coche');
    ok(motion.bumpedBefore === false && motion.bumpedAfter === true,
      'changer une option fait reagir le montant (classe is-bumped posee)');
    ok(motion.iconCount === 8, `chaque activite porte son icone (${motion.iconCount}/8)`);

    // Les listes deroulantes suivent l'etat : revenir a l'etape 1 depuis les
    // creneaux doit retrouver SES choix, pas les valeurs par defaut.
    const selects = await page.evaluate(() => {
      state.booking.activities.billards = { units: 3, hours: 2 };
      syncBookingTypeUi();
      const card = document.querySelector('.activity-card[data-activity="billards"]');
      return {
        units: card?.querySelector('select[data-opt-select="units"]')?.value,
        hours: card?.querySelector('select[data-opt-select="hours"]')?.value,
      };
    });
    ok(selects.units === '3' && selects.hours === '2',
      `les listes deroulantes refletent l etat (${selects.units} tables, ${selects.hours}h)`);

    // =====================================================================
    console.log('\n[10] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol("      params.set('program', JSON.stringify(buildBookingProgramPayload()));");
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      ok(false, `ancre de mutation introuvable ou ambigue (${occurrences})`);
    } else {
      fs.writeFileSync(APP, original.replace(anchor, toFileEol("      params.set('program', '[]');")));
      let mutatedProgram = null;
      try {
        await bootClient(page, 'mutation');
        mutatedProgram = await page.evaluate(async () => {
          toggleBookingActivity('laser_game');
          toggleBookingActivity('minigolf_blacklight');
          window.__QA_CALLS__.availability = [];
          await goStep2();
          const params = new URLSearchParams(window.__QA_CALLS__.availability[0] || '');
          return JSON.parse(params.get('program') || 'null');
        });
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
      ok(Array.isArray(mutatedProgram) && mutatedProgram.length === 0,
        'envoi du panier neutralise : la requete part vide -> le check 3 ROUGIRAIT');

      await bootClient(page, 'restore');
      const restored = await page.evaluate(async () => {
        toggleBookingActivity('laser_game');
        toggleBookingActivity('minigolf_blacklight');
        window.__QA_CALLS__.availability = [];
        await goStep2();
        const params = new URLSearchParams(window.__QA_CALLS__.availability[0] || '');
        return JSON.parse(params.get('program') || 'null');
      });
      ok(Array.isArray(restored) && restored.length === 3, 'restauration inverse : le panier repart complet');
    }

    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\nvisit-booking-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nvisit-booking-check: ALL OK - une visite peut contenir plusieurs activites, et le serveur les recoit toutes.');
}

main().catch((err) => { console.error(err); process.exit(1); });
