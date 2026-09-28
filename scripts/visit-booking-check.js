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
// La date de la fixture doit tenir DEUX conditions, pas une seule.
//   1. un SAMEDI : c'est le jour dont la grille va de 10h a Minuit, la seule ou
//      les deux creneaux de la fixture (15h et 16h) tiennent ;
//   2. un jour STRICTEMENT FUTUR : le tunnel masque les creneaux deja passes de
//      la journee EN COURS (`filterPastSlotsForDate`, assets/booking-core.js).
// La date etait figee au 2026-08-08. Ce samedi-la est arrive : passe 14h30 heure
// de Bruxelles, les creneaux 15h et 16h sont devenus du passe, le filtre les a
// retires, `state.availableSlots` est reparti vide, `selectSlot(0)` n'a plus rien
// fait, et le POST est parti sans horaire ni programme. Trois assertions rouges
// pour une raison d'HORLOGE, jamais de produit : le meme code etait vert le matin
// et le lendemain. On vise donc le prochain samedi, toujours devant nous.
function nextSaturday() {
  // Le produit raisonne en heure de Bruxelles (BUSINESS_TIME_ZONE) : la machine
  // qui lance le gate peut etre ailleurs, c'est ce fuseau qui decide du jour.
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  // do/while : on avance d'au moins un jour, donc jamais aujourd'hui meme un samedi.
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== 6);
  return cursor.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

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
// Libramont depuis la validation des tarifs du 2026-08-01.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', note: '12 niveaux', order: 3, defaultMinutes: 45 },
  // Les bornes de duree font partie de ce que le catalogue expose (elles
  // decident des durees proposees au client) : une fixture qui les omet
  // ne ressemble plus au reel et teste autre chose. Valeurs du socle :
  // le billard se vend de 1 h a 3 h, sans demi-heure.
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: 10, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 180, stepMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', note: 'accès à la journée', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60, resourceType: 'duckpin_lane', units: 2, capacityPerUnit: 6 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', note: '5 joueurs max.', order: 9, defaultMinutes: 15 },
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
        return J({
          ok: true, date: DATE, slots: [slot('15:00'), slot('16:00')], laneCount: 2,
          duration: 1, totalDuration: 2.25, price: 222, requiresLanes: true,
          label: 'Votre visite', anchors: null, message: '',
          // Contrat reel de public-availability pour une visite : le serveur
          // renvoie le programme NORMALISE et son prix, jamais le calcul client.
          program: {
            items: [
              { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, laneCount: 2, price: 78, priceKnown: true },
              { activityId: 'laser_game', name: 'Laser Game', planned: true, games: 2, price: 144, priceKnown: true },
              { activityId: 'arcade_time', name: 'Arcades', planned: false, price: null, priceKnown: false },
            ],
            price: 222,
            priceComplete: false,
          },
        });
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
    state.booking.venueConfirmed = true;
    state.booking.activities = { bowling: { duration: 1 } };
    setView('client');
    syncBookingTypeUi();
  }, DATE);
  // LE PARCOURS REEL COMPTE DEUX PAS DEPUIS LES ACTIVITES. Depuis le 2026-08-26,
  // les reglages d activite ont leur propre ecran a TOUTES les largeurs (avant,
  // seulement sous 640 px) : « Continuer » mene d abord aux reglages, puis aux
  // heures. Ce helper fait ce que fait un client, pas moins : il rappelle
  // goStep2 tant qu on est encore a l etape 1, au plus deux fois. Il ne masque
  // rien - si l etape ne bouge pas, les assertions d apres rougissent comme
  // avant.
  await page.evaluate(() => {
    window.__QA_GO2__ = async () => {
      await goStep2();
      // Le bon signal est « on est reste sur l ecran de reglages », pas le rang
      // de l etape : le gate enchaine ses scenarios sans revenir a l etape 1, et
      // tester `state.step === 1` laissait le second pas de cote (mesure : etape
      // restee a 5, requete jamais partie, [8] rouge).
      if (typeof onMobileOptionsPage === 'function' && onMobileOptionsPage()) await goStep2();
      return state.step;
    };
  });
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
    await page.evaluate(() => { toggleBookingActivity('arcade_time'); });
    // Le montant TOURNE (compteur a rouleaux) : lire son texte en plein vol
    // recolte la piste de chiffres. On attend que les rouleaux soient poses,
    // meme lecon que settle() sur la geometrie (2026-08-18).
    await page.waitForFunction(() => !document.querySelector('#programSummary .program-total .t-reel'), { timeout: 4000 });
    const summary = await page.evaluate(() => ({
      items: [...document.querySelectorAll('#programSummary .program-item')].map(item => item.textContent.replace(/\s+/g, ' ').trim()),
      label: document.querySelector('#programSummary .program-total-label')?.textContent.trim() || '',
      total: document.querySelector('#programSummary .program-total')?.textContent.trim() || '',
      totalValue: document.querySelector('#programSummary .program-total')?.getAttribute('data-value') || '',
      type: state.booking.type,
      chosen: getChosenActivities().map((a) => a.id),
    }));
    ok(summary.chosen.join(',') === 'bowling,laser_game,arcade_time', `les trois activites sont retenues (${summary.chosen.join(',')})`);
    ok(summary.items.some(item => item.includes('Bowling')) && summary.items.some(item => item.includes('Laser Game 2 parties')) && summary.items.some(item => item.includes('Arcades')),
      `le programme se lit en trois lignes : "${summary.items.join(' | ')}"`);
    // 8 joueurs : bowling 1h sur 2 pistes (39x2) + laser 2 parties (18x8) = 222.
    ok(summary.label === 'À partir de' && summary.total === '222€' && summary.totalValue === 'à partir de 222€',
      `total "a partir de" tant qu une activite n a pas de tarif (obtenu "${summary.label} ${summary.total}")`);
    ok(summary.type === 'visite', 'le type derive passe a "visite" des qu il y a plus d une activite');

    // =====================================================================
    console.log('\n[3] La requete de disponibilite porte le panier complet');
    // =====================================================================
    await page.evaluate(() => { window.__QA_CALLS__.availability = []; return window.__QA_GO2__(); });
    await page.waitForTimeout(700);
    const availabilityCall = await page.evaluate(() => window.__QA_CALLS__.availability[0] || '');
    const availParams = new URLSearchParams(availabilityCall);
    const sentProgram = JSON.parse(availParams.get('program') || '[]');
    ok(availParams.get('type') === 'visite', `type=visite envoye (obtenu ${availParams.get('type')})`);
    ok(availParams.get('pax') === '8', 'le nombre de joueurs suit');
    ok(sentProgram.length === 3, `le panier envoye contient 3 lignes (obtenu ${sentProgram.length})`);
    ok(sentProgram.some((i) => i.activityId === 'bowling' && i.duration === 1), 'la ligne bowling porte sa duree');
    ok(sentProgram.some((i) => i.activityId === 'laser_game' && i.games === 2), 'la ligne laser porte ses parties');
    ok(sentProgram.some((i) => i.activityId === 'arcade_time'), 'la ligne arcades est presente');
    ok(!JSON.stringify(sentProgram).includes('price'), 'AUCUN prix n est envoye par le navigateur (le serveur recalcule)');

    // =====================================================================
    console.log('\n[4] L etape Valider reprend le programme et le prix du serveur');
    // =====================================================================
    const validationRecap = await page.evaluate(() => {
      selectSlot(0); // selectSlot prend l INDEX du creneau, pas ses valeurs
      document.getElementById('fName').value = 'Groupe QA';
      document.getElementById('fPhone').value = '+32470000000';
      document.getElementById('fEmail').value = 'qa@pinlane.test';
      goStep4();
      return {
        step: state.step,
        activities: [...document.querySelectorAll('#recapList .recap-program-item')]
          .map(item => item.textContent.replace(/\s+/g, ' ').trim()),
        total: document.getElementById('recapTotal')?.textContent.trim() || '',
        totalLabel: document.querySelector('#step4 .total-box strong')?.textContent.trim() || '',
        totalNote: document.querySelector('#step4 .total-box small')?.textContent.trim() || '',
      };
    });
    ok(validationRecap.step === 4, 'le formulaire arrive bien a l etape Valider');
    ok(validationRecap.activities.length === 3
      && validationRecap.activities.some(item => item.includes('Bowling'))
      && validationRecap.activities.some(item => item.includes('Laser Game'))
      && validationRecap.activities.some(item => item.includes('Arcades')),
    `le recap final nomme les 3 activites (${validationRecap.activities.join(' | ') || 'aucune'})`);
    ok(validationRecap.total === '222€' && validationRecap.totalLabel === 'À partir de'
      // « TOUT se regle sur place » (2026-08-25, Movsar) : rien ne
      // s encaisse en ligne, la note ne doit plus laisser croire qu une
      // partie se paie maintenant.
      && validationRecap.totalNote.includes('Tout se règle sur place'),
    `le recap final reprend le prix serveur honnete (${validationRecap.totalLabel} ${validationRecap.total}, ${validationRecap.totalNote})`);
    if (process.env.PINLANE_VISUAL_CAPTURE) {
      const captureDir = path.resolve(process.env.PINLANE_VISUAL_CAPTURE);
      fs.mkdirSync(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, 'validation-recap-1280.png'), fullPage: true });
      await page.setViewportSize({ width: 420, height: 1000 });
      await page.waitForTimeout(80);
      const mobileRecapLayout = await page.evaluate(() => {
        const total = document.querySelector('#step4 .total-box').getBoundingClientRect();
        const actions = document.querySelector('#step4 .step-actions');
        const actionBox = actions.getBoundingClientRect();
        return {
          position: getComputedStyle(actions).position,
          actionsTop: actionBox.top,
          totalBottom: total.bottom,
        };
      });
      ok(mobileRecapLayout.position === 'static'
        && mobileRecapLayout.actionsTop >= mobileRecapLayout.totalBottom,
      `mobile : les boutons suivent le total sans recouvrir les activites (${mobileRecapLayout.position})`);
      await page.screenshot({ path: path.join(captureDir, 'validation-recap-420.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 1000 });
    }

    // =====================================================================
    console.log('\n[5] Le POST de reservation porte le programme');
    // =====================================================================
    const posted = await page.evaluate(async () => {
      window.__QA_CALLS__.reservations = [];
      await confirmBooking();
      return window.__QA_CALLS__.reservations[0] || null;
    });
    ok(posted && Array.isArray(posted.program) && posted.program.length === 3,
      `le corps du POST contient le programme des 3 activites (${posted && posted.program ? posted.program.length : 'aucun'})`);
    ok(posted && posted.type === 'visite', `le POST declare type=visite (obtenu ${posted && posted.type})`);
    ok(posted && posted.program.some((i) => i.activityId === 'arcade_time'),
      'les arcades, qui n occupent aucune ressource, partent quand meme au serveur : c est tout l objet de la feature');

    // =====================================================================
    // =====================================================================
    console.log('');
    console.log('[5b] Le message du groupe ne parle de PISTES que si le bowling est pris');
    // =====================================================================
    // Movsar, 2026-08-21, capture de Fun Galaxy Libramont : 7 joueurs, SEULES
    // les Arcades cochees, et l'ecran annoncait « Maximum conseille : 6
    // joueurs par piste. Avec 7 joueurs, nous reservons 0 pistes cote a
    // cote. » Un compte de pistes pour une activite qui n'en occupe aucune,
    // et un « 0 pistes » absurde par-dessus.
    // La cause : le message dedie a la visite ne s'appliquait qu'a partir de
    // DEUX activites cochees ; avec une seule, on retombait sur le texte du
    // bowling seul. Le garde existait deja pour les formules (son commentaire
    // dit mot pour mot « evite un absurde 0 pistes cote a cote »), il
    // manquait au mode a la carte.
    const messageActiviteLibre = await page.evaluate(async () => {
      state.booking.pax = 7;
      state.booking.activities = {};
      toggleBookingActivity('arcade_time');
      applyChosenActivitiesToBooking();
      updatePaxAlert();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (document.getElementById('paxAlert') || {}).textContent || '';
    });
    ok(!/piste/i.test(messageActiviteLibre),
      `une activite libre seule ne parle JAMAIS de pistes : ${JSON.stringify(messageActiviteLibre.trim())}`);
    ok(/7 personne|7 joueur/.test(messageActiviteLibre),
      `le message parle quand meme du groupe : ${JSON.stringify(messageActiviteLibre.trim())}`);

    // Le bowling SEUL garde son compte de pistes : c'est la moitie qu'on ne
    // doit pas casser en corrigeant l'autre.
    const messageBowlingSeul = await page.evaluate(async () => {
      state.booking.activities = {};
      toggleBookingActivity('bowling');
      applyChosenActivitiesToBooking();
      updatePaxAlert();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (document.getElementById('paxAlert') || {}).textContent || '';
    });
    ok(/piste/i.test(messageBowlingSeul) && !/0 piste/i.test(messageBowlingSeul),
      `le bowling seul annonce toujours ses pistes : ${JSON.stringify(messageBowlingSeul.trim())}`);

    // =====================================================================
    console.log('\n[5c] La notif annonce duckpin et laser, pas seulement le bowling');
    // =====================================================================
    // Movsar, 2026-08-24 : « pour le duckpin ya pas de notif qui dit qu'au-delà
    // de 6 joueurs il faut 2 pistes et qu'il n'y a que 2 pistes max ; et quand
    // on prend toutes les activités la notif ne dit rien pour le laser game. »
    const notifDuckpin = await page.evaluate(async () => {
      state.booking.pax = 8;
      state.booking.activities = {};
      toggleBookingActivity('duckpin_bowling');
      applyChosenActivitiesToBooking();
      updatePaxAlert();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (document.getElementById('paxAlert') || {}).textContent || '';
    });
    ok(/2\s*pistes/i.test(notifDuckpin) && /duckpin/i.test(notifDuckpin),
      `8 joueurs au duckpin -> 2 pistes annoncees : ${JSON.stringify(notifDuckpin.trim())}`);
    const notifDuckpinPlafond = await page.evaluate(async () => {
      state.booking.pax = 15;
      updatePaxAlert();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (document.getElementById('paxAlert') || {}).textContent || '';
    });
    ok(/2\s*pistes/i.test(notifDuckpinPlafond) && !/3\s*pistes/i.test(notifDuckpinPlafond),
      `15 joueurs -> jamais une 3e piste duckpin inventee : ${JSON.stringify(notifDuckpinPlafond.trim())}`);
    ok(/tour de r|rotation|à la fois|a la fois/i.test(notifDuckpinPlafond),
      'au-dela du plafond, la notif explique le passage par rotation');
    const notifLaser = await page.evaluate(async () => {
      state.booking.pax = 7;
      state.booking.activities = {};
      toggleBookingActivity('bowling');
      toggleBookingActivity('laser_game');
      toggleBookingActivity('arcade_time');
      applyChosenActivitiesToBooking();
      updatePaxAlert();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (document.getElementById('paxAlert') || {}).textContent || '';
    });
    ok(/session/i.test(notifLaser) && /laser/i.test(notifLaser),
      `toutes les activites cochees -> le laser est annonce : ${JSON.stringify(notifLaser.trim())}`);

    console.log('\n[6] Une activite fermee ce jour est desactivee ET decochee');
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
    console.log('\n[7] Aucune activite cochee : on ne passe pas');
    // =====================================================================
    const blocked = await page.evaluate(async () => {
      setCenterDayStatus(null, 'libramont');
      state.booking.activities = {};
      syncBookingTypeUi();
      const before = state.step;
      window.__QA_CALLS__.availability = [];
      await window.__QA_GO2__();
      return { before, after: state.step, calls: window.__QA_CALLS__.availability.length };
    });
    ok(blocked.after === blocked.before && blocked.calls === 0,
      `sans activite : aucun appel de disponibilite et l etape ne change pas (etape ${blocked.after})`);

    // =====================================================================
    console.log('\n[8] Une seule activite planifiee garde le chemin HISTORIQUE');
    // =====================================================================
    const legacy = await page.evaluate(async () => {
      state.booking.activities = { bowling: { duration: 1 } };
      applyChosenActivitiesToBooking();
      syncBookingTypeUi();
      window.__QA_CALLS__.availability = [];
      await window.__QA_GO2__();
      return { type: state.booking.type, query: window.__QA_CALLS__.availability[0] || '' };
    });
    await page.waitForTimeout(300);
    const legacyParams = new URLSearchParams(legacy.query);
    ok(legacy.type === 'bowling', 'bowling seul reste de type "bowling"');
    ok(legacyParams.get('type') === 'bowling' && !legacyParams.get('program'),
      'sa requete est celle d avant : type=bowling, aucun panier (zero regression sur le parcours du jour)');
    ok(legacyParams.get('duration') === '1', 'la duree part comme avant');

    // =====================================================================
    console.log('\n[9] Cote STAFF : la fiche montre le programme complet');
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
        lignes: [...host.querySelectorAll('div[style*="justify-content:space-between"]')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
        monoEmpty: mono === '',
      };
    });
    ok(staff.rows === 4, `les 4 lignes du programme sont rendues (obtenu ${staff.rows})`);
    ok(staff.text.includes('Minigolf Blacklight') && staff.text.includes('Billards'),
      'les activites libres sont nommees sur la fiche');
    // LA REGLE, PAS LA PHRASE : la ligne des billards dit le nombre de tables
    // et la duree. Le libelle a change le 2026-09-28 (« 2 tables · 1h30 » avec
    // le catalogue charge, « 2 × 1h30 » sans lui) ; « 2 x 1.5h » ne disait
    // d ailleurs pas « tables ».
    const ligneBillards = (staff.lignes || []).find((l) => /^Billards/.test(l)) || '';
    ok(/\b2\b/.test(ligneBillards) && /1h30/.test(ligneBillards), `le detail des billards (2 tables, 1h30) est lisible (« ${ligneBillards} »)`);
    ok(staff.text.includes('planifié') && staff.text.includes('sur place'),
      'la fiche distingue ce qui est place au planning de ce qui se regle au comptoir');
    // La GARANTIE est qu une mention distincte annonce ce qui n est pas place au
    // planning ; la formulation, elle, a maigri le 2026-08-26 (Movsar : « evite
    // les textes comme ca »). « Sans reservation de ressource, a prevoir au
    // comptoir : » est devenu « Au comptoir », et chaque ligne concernee dit
    // toujours « sur place » (assertion juste au-dessus). On verifie donc les
    // DEUX moities de la garantie, pas une phrase.
    ok(staff.text.includes('Au comptoir'), `le comptoir est prevenu explicitement (${staff.text.slice(0, 160)})`);
    ok(staff.monoEmpty === true, 'une reservation mono-activite n affiche AUCUN bloc programme (fiche inchangee)');

    // =====================================================================
    console.log('\n[10] Le selecteur reste compact, symetrique et pilotable au clavier');
    // =====================================================================
    await bootClient(page, 'motion');
    const polish = await page.evaluate(async () => {
      const card = () => document.querySelector('#activityPicker .activity-card[data-activity="bowling"]');
      const before = card();
      toggleBookingActivity('laser_game');
      toggleBookingActivity('minigolf_blacklight');
      const sameNode = card() === before;

      const ring = document.querySelector('.activity-card.is-on .activity-check');
      const svg = ring?.querySelector('svg');
      const r = ring.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const dx = Math.abs((r.left + r.width / 2) - (s.left + s.width / 2));
      const dy = Math.abs((r.top + r.height / 2) - (s.top + s.height / 2));

      const settingsRows = [...document.querySelectorAll('[data-activity-options]')];
      const laserSettings = settingsRows.find(row => row.getAttribute('data-activity-options') === 'laser_game');
      const hiddenSettings = settingsRows.find(row => !row.classList.contains('is-visible'));
      const configurator = document.querySelector('[data-role="activity-configurator"]');
      const cardStyle = getComputedStyle(card());
      const checkStyle = getComputedStyle(svg);

      // Le montant TOURNE quand un choix le change (compteur a rouleaux,
      // transform seul) : l'echafaudage .t-reel n'existe que pendant le
      // changement, et il redevient du texte simple une fois tous les
      // rouleaux poses (900 ms + cascade, marge comprise).
      const total = document.querySelector('.program-total');
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const bumpedBefore = Boolean(total.querySelector('.t-reel'));
      setBookingActivityOption('bowling', 'duration', 2);
      const bumpedAfter = Boolean(document.querySelector('.program-total .t-reel'));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const rollCleaned = !document.querySelector('.program-total .t-reel');

      return {
        sameNode,
        dx: Math.round(dx * 100) / 100,
        dy: Math.round(dy * 100) / 100,
        configuratorVisible: Boolean(configurator && getComputedStyle(configurator).display !== 'none'),
        settingsRows: settingsRows.length,
        laserSettingsVisible: Boolean(laserSettings && getComputedStyle(laserSettings).display !== 'none'),
        hiddenSettingsHidden: Boolean(hiddenSettings && getComputedStyle(hiddenSettings).display === 'none'),
        noOptionsInsideCards: document.querySelectorAll('.activity-card [data-opt]').length === 0,
        hiddenButtonsFocusable: hiddenSettings
          ? [...hiddenSettings.querySelectorAll('button')].some(button => button.tabIndex >= 0)
          : true,
        cardTransition: cardStyle.transitionProperty,
        checkTransition: checkStyle.transitionProperty,
        bumpedBefore,
        bumpedAfter,
        rollCleaned,
        iconCount: document.querySelectorAll('#activityPicker .activity-icon svg').length,
      };
    });
    ok(polish.sameNode === true,
      'la carte survit au clic : la grille ne se reconstruit pas');
    ok(polish.dx <= 1 && polish.dy <= 1,
      `la coche est centree dans son anneau a ${polish.dx} / ${polish.dy} px pres`);
    // 6 depuis le 2026-08-18 : la plaine de jeux se regle en nombre d'enfants.
    // Depuis le 2026-08-26 le configurateur n est plus VISIBLE avec la grille
    // (il a son ecran) : on verifie donc qu il porte toujours les 6 lignes
    // parametrables et qu il ne montre pas les autres, sans exiger qu il soit a
    // l ecran a ce moment-la. Sa visibilite sur SON ecran est prouvee par la
    // matrice de largeurs plus bas et par les gates tactile et one-screen.
    ok(polish.settingsRows === 6 && polish.laserSettingsVisible && polish.hiddenSettingsHidden,
      `le panneau commun ne porte que les reglages selectionnes (${polish.settingsRows} lignes parametrables)`);
    ok(polish.noOptionsInsideCards,
      'aucun reglage ne gonfle une carte : la selection et la configuration sont separees');
    ok(polish.hiddenButtonsFocusable === false,
      'les reglages masques sont retires du parcours clavier');
    ok(/transform/.test(polish.cardTransition) && /opacity/.test(polish.checkTransition) && /filter/.test(polish.checkTransition),
      'les retours visuels declarent uniquement les proprietes utiles');
    ok(polish.bumpedBefore === false && polish.bumpedAfter === true,
      'changer une option fait TOURNER le montant (compteur a rouleaux .t-reel)');
    ok(polish.rollCleaned === true,
      'les rouleaux poses, le montant redevient du texte simple');
    ok(polish.iconCount === 8, `chaque activite porte son icone (${polish.iconCount}/8)`);

    // La pastille GLISSANTE du selecteur suit l'etat reel : la classe du
    // conteneur (is-formule) est ce qui la positionne. Si elle se desynchronise,
    // la pastille encadre le mauvais choix : un mensonge visuel.
    const segmented = await page.evaluate(() => {
      const container = document.getElementById('segCarte').closest('.segmented');
      const before = container.classList.contains('is-formule');
      setType('formule');
      const onFormule = container.classList.contains('is-formule');
      setType('carte');
      const backToCarte = container.classList.contains('is-formule');
      return { before, onFormule, backToCarte };
    });
    ok(segmented.before === false && segmented.onFormule === true && segmented.backToCarte === false,
      'la pastille du selecteur suit le choix (is-formule posee et retiree avec l etat)');

    await page.evaluate(() => {
      getCenterActivities().forEach((activity) => {
        if (!state.booking.activities[activity.id]) toggleBookingActivity(activity.id);
      });
    });
    const layouts = [];
    for (const target of [
      // UN ECRAN, UNE QUESTION - A TOUTES LES LARGEURS (2026-08-26). Les
      // reglages avaient leur page sous 640 px seulement ; sur ordinateur ils
      // faisaient FACE a la grille, sur le meme ecran. Movsar : « il y a trop
      // d informations [...] il y a des mamies de 60 ans qui reservent, elles
      // vont jamais comprendre autant d informations ». La garantie n est pas
      // supprimee, elle est RETOURNEE : ce qui etait « cote a cote, alignes »
      // devient « pas sur le meme ecran », et c est la branche settingsOnOwnPage
      // qui le verifie, celle-la meme qui protegeait deja le telephone.
      // Le recapitulatif a suivi les reglages sur LEUR ecran : il y dispose de
      // toute la largeur et se range en 3 colonnes au lieu de 2. Ce n est pas un
      // relachement : l assertion « aucun texte ne deborde de sa carte » plus bas
      // couvre la lisibilite, et le nombre de LIGNES (8) reste verifie.
      // QUATRE colonnes au-dessus de 1100 px depuis le 2026-08-27. Movsar : « le
      // fait qu on doit swip pour tout voir ca va pas, l ideal c est vrm de tout
      // avoir d un coup ». Mesure a 1280x720 : en 2 colonnes la grille demandait
      // 304 px pour 152 px visibles (4 rangees), la derniere entierement hors
      // champ. En 4 colonnes elle en demande 148 : depassement ZERO. Les
      // garde-fous ne bougent pas et restent verifies plus bas : 8 cartes, aucun
      // texte qui deborde, aucune cible sous 44 px.
      { width: 1280, expectedColumns: 4, expectedSummaryColumns: 3, settingsOnOwnPage: true },
      { width: 800, expectedColumns: 2, expectedSummaryColumns: 3, settingsOnOwnPage: true },
      // TELEPHONE : deux cartes par rangee depuis la refonte mobile du
      // 2026-08-15. Une carte d activite est un icone, un nom et un tarif :
      // elle n a jamais eu besoin de 390 px de large, et huit cartes empilees
      // coutaient 512 px de defilement pour rien. L assertion de troncature
      // ci-dessous garantit que la densite ne coupe aucun libelle.
      // REFONTE MOBILE 2026-08-18, second verdict de Movsar le meme jour :
      // « tout voir d un coup ». Sous 640 px : DEUX colonnes de cartes
      // compactes (les 8 visibles ensemble, prix en souffle court), et les
      // REGLAGES quittent l ecran pour LEUR page (« une autre page dans la
      // page ») : le configurateur ne s affiche plus avec la grille, il est
      // prouve sur sa page par les gates tactile et one-screen.
      { width: 420, expectedColumns: 2, expectedSummaryColumns: 1, settingsOnOwnPage: true },
    ]) {
      await page.setViewportSize({ width: target.width, height: 1200 });
      await page.waitForTimeout(80);
      const measured = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#activityPicker .activity-card')];
        const rects = cards.map(card => card.getBoundingClientRect());
        const columns = new Set(rects.map(rect => Math.round(rect.left))).size;
        // Les cartes d'une MEME RANGEE partagent leur hauteur (rangs de grille) ;
        // d'une rangee a l'autre la hauteur suit le contenu, jamais un texte
        // coupe ni un debordement hors de la carte.
        const rows = new Map();
        rects.forEach((rect) => {
          const key = Math.round(rect.top);
          rows.set(key, [...(rows.get(key) || []), rect.height]);
        });
        const rowSpread = Math.max(...[...rows.values()]
          .map(heights => Math.max(...heights) - Math.min(...heights)));
        const overflowing = cards.filter((card) => {
          const toggle = card.querySelector('.activity-toggle');
          return toggle && toggle.scrollHeight > toggle.clientHeight + 1;
        }).length;
        const grid = document.querySelector('[data-role="activity-grid"]').getBoundingClientRect();
        const settings = document.querySelector('[data-role="activity-configurator"]').getBoundingClientRect();
        const summary = document.querySelector('.program-summary');
        const summaryColumns = getComputedStyle(summary).gridTemplateColumns.split(' ').length;
        return {
          cards: cards.length,
          columns,
          rowSpread,
          overflowing,
          settingsGap: settings.top - grid.bottom,
          settingsBeside: settings.left >= grid.right + 4 && Math.abs(settings.top - grid.top) <= 4,
          settingsDisplayed: (() => {
            const el = document.querySelector('[data-role="activity-configurator"]');
            return Boolean(el && el.offsetParent !== null && el.getBoundingClientRect().height > 0);
          })(),
          visibleSettings: document.querySelectorAll('.activity-config-row.is-visible').length,
          summaryItems: document.querySelectorAll('.program-item').length,
          summaryColumns,
          billardsGroups: document.querySelectorAll('[data-activity-options="billards"] .activity-option-group').length,
        };
      });
      layouts.push({ ...target, ...measured });
      if (process.env.PINLANE_VISUAL_CAPTURE) {
        const captureDir = path.resolve(process.env.PINLANE_VISUAL_CAPTURE);
        fs.mkdirSync(captureDir, { recursive: true });
        await page.screenshot({ path: path.join(captureDir, `activity-picker-${target.width}.png`), fullPage: true });
      }
    }
    layouts.forEach((layout) => {
      ok(layout.cards === 8 && layout.columns === layout.expectedColumns,
        `${layout.width}px : 8 cartes sur ${layout.columns} colonne(s)`);
      ok(layout.rowSpread <= 1,
        `${layout.width}px : ecart de hauteur ${layout.rowSpread.toFixed(1)}px entre cartes d une meme rangee`);
      ok(layout.overflowing === 0,
        `${layout.width}px : aucun texte ne deborde de sa carte (${layout.overflowing})`);
      // A partir de 1100 px les reglages se placent A COTE de la grille (meme
      // rangee, alignes en haut) : c'est ce qui ramene l etape dans un ecran
      // reel. En dessous, ils restent sous la grille a 8-16 px.
      if (layout.settingsOnOwnPage) {
        // Telephone (2026-08-18) : les reglages ont LEUR page entre les
        // activites et les heures ; ils ne s affichent plus avec la grille.
        ok(layout.settingsDisplayed === false,
          `${layout.width}px : les reglages ne s affichent pas avec la grille (page options dediee)`);
      } else if (layout.width >= 1100) {
        ok(layout.settingsBeside === true,
          `${layout.width}px : les reglages font face a la grille (cote a cote, alignes)`);
      } else {
        ok(layout.settingsGap >= 8 && layout.settingsGap <= 16,
          `${layout.width}px : ${layout.settingsGap.toFixed(1)}px entre la grille et les reglages`);
      }
      ok(layout.visibleSettings === 6,
        `${layout.width}px : les 6 activites parametrables ont une ligne de reglages`);
      ok(layout.summaryItems === 8 && layout.summaryColumns === layout.expectedSummaryColumns,
        `${layout.width}px : recap structure en ${layout.summaryItems} lignes et ${layout.summaryColumns} colonne(s)`);
      ok(layout.billardsGroups === 2,
        `${layout.width}px : tables et duree des billards restent deux groupes distincts`);
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    if (process.env.PINLANE_VISUAL_CAPTURE) {
      const captureDir = path.resolve(process.env.PINLANE_VISUAL_CAPTURE);
      await page.evaluate(() => localStorage.removeItem('pinlane-theme'));
      await page.emulateMedia({ colorScheme: 'dark' });
      await bootClient(page, 'dark-capture');
      await page.evaluate(() => {
        getCenterActivities().forEach((activity) => {
          if (!state.booking.activities[activity.id]) toggleBookingActivity(activity.id);
        });
      });
      await page.screenshot({ path: path.join(captureDir, 'activity-picker-1280-dark.png'), fullPage: true });
      await page.evaluate(() => localStorage.removeItem('pinlane-theme'));
      await page.emulateMedia({ colorScheme: 'light' });
      await bootClient(page, 'after-dark-capture');
    }

    // Les choix de quantite et de duree suivent l'etat : revenir a l'etape 1
    // depuis les creneaux doit retrouver SES choix, pas les valeurs par
    // defaut. LA PROPRIETE N'A PAS BOUGE ; seule sa forme a change : ces
    // choix se faisaient a la liste deroulante (« fleche trop loin et c'est
    // moche », plainte du 2026-08-01) et se font desormais aux memes
    // pastilles que la duree du bowling. On interroge donc l'etat ACTIF des
    // pastilles, pas la valeur d'un <select> qui n'existe plus.
    const choix = await page.evaluate(() => {
      state.booking.activities.billards = { units: 3, hours: 2 };
      syncBookingTypeUi();
      const settings = document.querySelector('[data-activity-options="billards"]');
      const actif = (cle) => settings?.querySelector(`[data-opt="${cle}"].active`)?.getAttribute('data-val');
      return {
        units: actif('units'),
        hours: actif('hours'),
        // Contre-preuve : plus aucune liste deroulante dans le selecteur.
        selects: document.querySelectorAll('#activityPicker select').length,
      };
    });
    ok(choix.units === '3' && choix.hours === '2',
      `les choix refletent l etat (${choix.units} tables, ${choix.hours}h)`);
    ok(choix.selects === 0,
      `plus aucune liste deroulante dans le selecteur d activites (${choix.selects})`);

    // =====================================================================
    console.log('\n[11] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
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
          await window.__QA_GO2__();
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
        await window.__QA_GO2__();
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
