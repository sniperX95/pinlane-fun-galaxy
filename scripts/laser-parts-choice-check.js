// CHAQUE PARTIE DE LASER SE PLACE A L'HEURE QU'ON VEUT.
//
// Movsar, 2026-08-20 : « ils peuvent placer toutes leurs parties de laser a
// n'importe quelle heure possible, ou juste une, ou juste deux ».
// Avant : le tunnel ne proposait QU'UNE heure pour « 3 parties ». La 1re etait
// posee, les deux autres partaient d'office « sur place », sans que le client
// puisse en decider. Le fil de visite porte maintenant UNE ETAPE PAR PARTIE.
//
// Ce gate conduit le vrai tunnel dans un navigateur et verifie le
// COMPORTEMENT :
//   1. trois parties -> trois etapes nommees (partie 1/3, 2/3, 3/3) ;
//   2. choisir une heure sur la 2e partie ne touche PAS aux autres, et la
//      requete de disponibilite porte la liste complete ;
//   3. « laisser cette partie sur place » ne relache QUE cette partie ;
//   4. le POST de reservation emporte les heures partie par partie ;
//   5. contre-epreuve : une seule partie garde le parcours d'avant (aucune
//      etape numerotee, aucun parametre en plus).
//
// Lancement : node scripts/laser-parts-choice-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const PORT = Number(process.env.PINLANE_LASERPARTS_PORT || 4243);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Prochain samedi : le seul jour ouvert de 10h a Minuit, donc le seul ou les
// trois heures de la fixture (15h, 17h, 19h) tiennent. Jamais aujourd'hui : le
// tunnel masque les creneaux deja passes.
function nextSaturday() {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== 6);
  return cursor.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', async () => {
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE-ERR', message.text()); });

  await page.addInitScript((DATE) => {
    window.__QA_CALLS__ = { availability: [], reservations: [] };
    const ACTIVITIES = [
      { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', unitLabel: '' },
      { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', unitLabel: '' },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    // Les heures possibles de l'arene : la MEME liste pour chaque partie, comme
    // le serveur la rend (une seule liste par activite).
    const times = ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']
      .map((time) => ({ time, remainingPlaces: 22, sharedSession: false, waveCount: 1 }));
    const anchorsFor = (count) => ({
      ok: true, reason: '', arrivalLeadMinutes: 15, hasTable: false, freePass: [], drinks: [],
      laserGames: count, laserOnSiteAvailable: false,
      activities: [{ activityId: 'laser_game', label: 'Laser Game', count, durationMinutes: 25, times }],
      defaultTimes: { laser_game: '15:00' },
    });
    // Le faux serveur repond comme le VRAI : un bloc par partie POSEE, et un
    // plan de pass pour celles qui restent. Un mock qui rendrait toujours un
    // seul bloc prouverait le contraire de ce qu'on teste.
    const finMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      const total = h * 60 + m + 25;
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const slot = (time, partTimes = null) => {
      const parties = (partTimes && partTimes.length ? partTimes : [time])
        .map((valeur, index) => ({ countIndex: index + 1, time: valeur }))
        .filter((partie) => partie.time);
      const attente = (partTimes || []).map((valeur, index) => ({ countIndex: index + 1, time: valeur }))
        .filter((partie) => !partie.time);
      return {
        time: parties[0]?.time || time, price: 75, laneCount: 0, duration: 0.5, totalDuration: 1.5, requiresLanes: false,
        opsPlan: {
          ok: true, startTime: parties[0]?.time || time, endTime: '19:25', totalMinutes: 265, assignedLanes: [], conflicts: [],
          risk: { level: 'low', score: 10, reasons: [] },
          resourceBlocks: parties.map((partie) => ({
            resourceType: 'laser_arena', activityId: 'laser_game', startTime: partie.time,
            endTime: finMinutes(partie.time), countIndex: partie.countIndex,
          })),
          timeline: [],
          laserPassPlan: attente.length ? {
            mode: 'manual_after_first', totalGames: parties.length + attente.length,
            scheduledGames: parties.length, remainingGames: attente.length,
            scheduledPasses: parties.map((partie) => ({ countIndex: partie.countIndex, status: 'scheduled', startTime: partie.time })),
            pendingPasses: attente.map((partie) => ({ countIndex: partie.countIndex, status: 'pending' })),
          } : null,
          anchorPlan: {
            mode: 'anchors_freedom', laserPlacement: 'scheduled',
            times: { laser_game: parties[0]?.time || time },
            laserGameTimes: partTimes || [time],
          },
        },
      };
    };
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
            day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      if (u.pathname === '/api/public-availability') {
        window.__QA_CALLS__.availability.push(u.search);
        const params = new URLSearchParams(u.search);
        let parties = 1;
        try {
          const program = JSON.parse(params.get('program') || '[]');
          const laser = program.find((item) => item.activityId === 'laser_game');
          parties = laser ? Number(laser.games) || 1 : 1;
        } catch (error) { parties = 1; }
        let partTimes = null;
        try {
          const brut = JSON.parse(params.get('laserGameTimes') || 'null');
          partTimes = Array.isArray(brut) ? brut : null;
        } catch (error) { partTimes = null; }
        return J({
          ok: true, date: DATE, slots: [slot('15:00', partTimes)], laneCount: 0, duration: 0.5,
          totalDuration: parties * 0.5, price: 25 * parties, requiresLanes: false,
          label: `Laser ${parties} partie${parties > 1 ? 's' : ''}`,
          anchors: anchorsFor(parties), message: '',
          program: { items: [{ activityId: 'laser_game', name: 'Laser Game', planned: true, games: parties, price: 25 * parties, priceKnown: true }], price: 25 * parties, priceComplete: true },
        });
      }
      if (u.pathname === '/api/public-reservations') {
        const body = JSON.parse(String(init.body || '{}'));
        window.__QA_CALLS__.reservations.push(body);
        return new Response(JSON.stringify({ ok: true, reservation: { id: 5151, ...body, status: 'pending' }, ops: {}, communications: [], warnings: [] }), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return nativeFetch(input, init);
    };
  }, DATE);

  await page.goto(`${BASE_URL}/?v=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof toggleBookingActivity === 'function');

  // ---------------------------------------------------------------------
  console.log('\n[1] Trois parties = trois etapes, chacune avec son heure');
  // ---------------------------------------------------------------------
  const arrive = await page.evaluate(async (DATE) => {
    state.booking.date = DATE;
    state.booking.pax = 8;
    state.booking.activities = {};
    toggleBookingActivity('laser_game');
    setBookingActivityOption('laser_game', 'games', 3);
    applyChosenActivitiesToBooking();
    window.__QA_CALLS__.availability = [];
    await goStep2();
    return { type: state.booking.type, calls: window.__QA_CALLS__.availability.length };
  }, DATE);
  await page.waitForTimeout(700);
  ok(arrive.type === 'visite', `trois parties passent par le fil de visite (type ${arrive.type})`);

  const etapes = await page.evaluate(() => [...document.querySelectorAll('.visit-rail-step .anchor-row-head strong')].map((node) => node.textContent.trim()));
  ok(etapes.length === 3, `trois etapes rendues (${etapes.length}) : ${JSON.stringify(etapes)}`);
  ok(etapes.filter((label) => /partie 1\/3/i.test(label)).length === 1
    && etapes.filter((label) => /partie 2\/3/i.test(label)).length === 1
    && etapes.filter((label) => /partie 3\/3/i.test(label)).length === 1,
    'chaque etape dit QUELLE partie elle place');

  // ---------------------------------------------------------------------
  console.log('\n[2] Choisir une heure sur la 2e partie ne touche pas aux autres');
  // ---------------------------------------------------------------------
  const avant = await page.evaluate(() => getBookingLaserPartTimes(createDefaultFormulaPreference(state.booking.preference || {})));
  ok(avant[0] === '15:00' && !avant[1] && !avant[2],
    `a l ouverture, seule la 1re partie est posee (${JSON.stringify(avant)})`);

  await page.evaluate(() => { window.__QA_CALLS__.availability = []; });
  const clic = await page.evaluate(async () => {
    const piste = document.querySelector('.anchor-track[data-anchor="laser_game"][data-part="2"]');
    const chip = piste ? piste.querySelector('.anchor-chip[data-time="17:00"]') : null;
    if (!chip) return { clique: false };
    chip.click();
    return { clique: true };
  });
  ok(clic.clique, 'la piste d heures de la 2e partie existe et porte 17:00');
  await page.waitForTimeout(900);
  const apres = await page.evaluate(() => getBookingLaserPartTimes(createDefaultFormulaPreference(state.booking.preference || {})));
  ok(apres[0] === '15:00' && apres[1] === '17:00' && !apres[2],
    `la 2e partie prend 17:00, les autres ne bougent pas (${JSON.stringify(apres)})`);

  // CE QUE L ECRAN MONTRE, pas seulement ce que l'etat retient. La mise a jour
  // en place visait la 1re ligne pour les trois parties : l'etat prenait 17:00
  // et le client ne voyait rien bouger. Un gate qui ne lit que l'etat aurait
  // valide ce silence.
  const ecran = await page.evaluate(() => {
    const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"][data-part="2"]');
    const chip = ligne ? ligne.querySelector('.anchor-chip[data-time="17:00"]') : null;
    return {
      retenue: (ligne?.querySelector('.anchor-row-pick') || {}).textContent || '',
      chipActive: Boolean(chip && chip.classList.contains('active')),
      relache: Boolean(ligne?.querySelector('.anchor-part-release')),
    };
  });
  ok(ecran.retenue.trim() === '17:00', `l ecran de la 2e partie affiche son heure (${JSON.stringify(ecran.retenue)})`);
  ok(ecran.chipActive, 'la pastille 17:00 de la 2e partie est marquee choisie');
  ok(ecran.relache, 'la 2e partie propose de la relacher sur place');

  // Le recapitulatif de droite doit porter LES DEUX rendez-vous : c'est ce que
  // le client valide.
  const resume = await page.evaluate(() => (document.querySelector('.formula-visit-summary') || {}).textContent || '');
  ok(/15:00/.test(resume) && /17:00/.test(resume),
    `le resume annonce les deux parties posees (${JSON.stringify(resume.replace(/\s+/g, ' ').slice(0, 140))})`);
  ok(/partie 1/i.test(resume) && /partie 2/i.test(resume), 'et il dit laquelle est laquelle');
  ok(/1 partie à placer|1 partie a placer/i.test(resume.replace(/\s+/g, ' ')),
    'il annonce aussi celle qui reste a placer sur place');

  const requete = await page.evaluate(() => window.__QA_CALLS__.availability.slice(-1)[0] || '');
  const envoye = new URLSearchParams(requete).get('laserGameTimes');
  ok(envoye === JSON.stringify(['15:00', '17:00', '']),
    `la demande porte la liste complete des parties (${envoye})`);

  // ---------------------------------------------------------------------
  console.log('\n[3] Relacher UNE partie ne relache que celle-la');
  // ---------------------------------------------------------------------
  await page.evaluate(async () => { await setFormulaLaserPartOnSite(0); });
  await page.waitForTimeout(900);
  const relache = await page.evaluate(() => getBookingLaserPartTimes(createDefaultFormulaPreference(state.booking.preference || {})));
  ok(!relache[0] && relache[1] === '17:00',
    `la 1re repart sur place, la 2e garde son heure (${JSON.stringify(relache)})`);

  // ---------------------------------------------------------------------
  console.log('\n[4] Le POST de reservation emporte les heures partie par partie');
  // ---------------------------------------------------------------------
  const poste = await page.evaluate(async () => {
    selectSlot(0);
    state.booking.name = 'QA PARTIES';
    state.booking.phone = '+32487000000';
    state.booking.email = 'qa@pinlane.test';
    window.__QA_CALLS__.reservations = [];
    await confirmBooking();
    return window.__QA_CALLS__.reservations[0] || null;
  });
  await page.waitForTimeout(500);
  ok(poste && Array.isArray(poste.preference?.laserGameTimes),
    `la reservation porte les heures par partie (${poste ? JSON.stringify(poste.preference?.laserGameTimes) : 'aucun envoi'})`);
  ok(poste && poste.preference.laserGameTimes[1] === '17:00',
    'la 2e partie part avec SON heure');
  ok(poste && Array.isArray(poste.program) && poste.program.some((item) => item.activityId === 'laser_game' && Number(item.games) === 3),
    'le panier annonce toujours 3 parties vendues');

  // ---------------------------------------------------------------------
  console.log('\n[5] CONTRE-EPREUVE : une seule partie garde le parcours d avant');
  // ---------------------------------------------------------------------
  const seule = await page.evaluate(async () => {
    state.booking.preference = createDefaultFormulaPreference({});
    state.booking.activities = {};
    toggleBookingActivity('laser_game');
    setBookingActivityOption('laser_game', 'games', 1);
    applyChosenActivitiesToBooking();
    window.__QA_CALLS__.availability = [];
    await goStep2();
    return { type: state.booking.type, query: window.__QA_CALLS__.availability.slice(-1)[0] || '' };
  });
  await page.waitForTimeout(700);
  const etapesSeule = await page.evaluate(() => [...document.querySelectorAll('.visit-rail-step .anchor-row-head strong')].map((node) => node.textContent.trim()));
  ok(seule.type === 'laser', `une seule partie reste sur le parcours direct (type ${seule.type})`);
  ok(!new URLSearchParams(seule.query).get('laserGameTimes'),
    'sa requete ne porte AUCUN parametre en plus (zero regression)');
  ok(!etapesSeule.some((label) => /partie \d+\//i.test(label)),
    `aucune etape numerotee pour une partie unique (${JSON.stringify(etapesSeule)})`);

  await browser.close();
  server.close();
  console.log('');
  if (failures) {
    console.log(`laser-parts-choice-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('laser-parts-choice-check: ALL OK - chaque partie de laser se place a l heure choisie.');
  process.exit(0);
});
