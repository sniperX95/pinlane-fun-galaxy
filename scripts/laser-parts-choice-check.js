// LES HEURES DE LASER SE CHOISISSENT DANS UNE SEULE LISTE.
//
// Movsar, 2026-08-20 : « ils peuvent placer toutes leurs parties de laser a
// n'importe quelle heure possible, ou juste une, ou juste deux », puis, sur la
// premiere version livree : « pourquoi faire 3 trucs differents comme ça, fais
// juste le choix sur une liste ou ils peuvent choisir jusqu'a 3 horaires ».
//
// Avant : UNE seule heure pour « 3 parties », les deux autres partaient d'office
// sur place, sans que le client ait son mot a dire. Premiere tentative : une
// etape par partie, donc trois pistes d'heures identiques l'une sous l'autre
// (la meme information, trois fois). Retenu : UNE liste, choix multiple, bornee
// au nombre de parties achetees.
//
// Ce gate conduit le vrai tunnel dans un navigateur et verifie le COMPORTEMENT :
//   1. une seule etape « Laser Game », une seule liste, qui annonce la regle ;
//   2. cliquer une 2e heure l'AJOUTE (elle ne remplace pas la 1re), et ça se VOIT
//      a l'ecran (pastille marquee, heures listees en tete) ;
//   3. au dernier choix la liste est pleine : les heures non retenues s'eteignent
//      et le compteur dit comment en liberer une ;
//   4. re-cliquer une heure retenue la retire ;
//   5. la requete de disponibilite ET le POST portent les heures retenues ;
//   6. contre-epreuve : une seule partie garde le parcours d'avant (choix unique,
//      aucun parametre en plus, aucun compteur).
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
// heures de la fixture tiennent. Jamais aujourd'hui : le tunnel masque les
// creneaux deja passes de la journee en cours.
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

  await page.addInitScript((jour) => {
    window.__QA_CALLS__ = { availability: [], reservations: [] };
    const ACTIVITIES = [
      { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', unitLabel: '' },
      { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', unitLabel: '' },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const times = ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']
      .map((time) => ({ time, remainingPlaces: 22, sharedSession: false, waveCount: 1 }));
    const anchorsFor = (count, avecBowling = false) => ({
      ok: true, reason: '', arrivalLeadMinutes: 15, hasTable: false, freePass: [], drinks: [],
      laserGames: count, laserOnSiteAvailable: false,
      activities: [
        ...(avecBowling ? [{ activityId: 'bowling', label: 'Bowling', count: 1, durationMinutes: 60, times }] : []),
        { activityId: 'laser_game', label: 'Laser Game', count, durationMinutes: 25, times },
      ],
      defaultTimes: avecBowling ? { bowling: '15:00', laser_game: '17:00' } : { laser_game: '15:00' },
    });
    // Le faux serveur repond comme le VRAI : un bloc par heure RETENUE, et un
    // plan de pass pour les parties qui restent. Un mock qui rendrait toujours
    // un seul bloc prouverait le contraire de ce qu'on teste.
    const finMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      const total = h * 60 + m + 25;
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const slot = (fallback, partTimes = null) => {
      const parties = (partTimes && partTimes.length ? partTimes : [fallback])
        .map((valeur, index) => ({ countIndex: index + 1, time: valeur }))
        .filter((partie) => partie.time);
      const attente = (partTimes || []).map((valeur, index) => ({ countIndex: index + 1, time: valeur }))
        .filter((partie) => !partie.time);
      return {
        time: parties[0]?.time || fallback, price: 75, laneCount: 0, duration: 0.5, totalDuration: 1.5, requiresLanes: false,
        opsPlan: {
          ok: true, startTime: parties[0]?.time || fallback, endTime: '23:59', totalMinutes: 265, assignedLanes: [], conflicts: [],
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
            times: { laser_game: parties[0]?.time || fallback },
            laserGameTimes: partTimes || [fallback],
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
          ok: true, today: jour, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
            offerAvailability: {},
            day: { date: jour, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
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
          ok: true, date: jour, slots: [slot('15:00', partTimes)], laneCount: 0, duration: 0.5,
          totalDuration: parties * 0.5, price: 25 * parties, requiresLanes: false,
          label: `Laser ${parties} partie${parties > 1 ? 's' : ''}`,
          anchors: anchorsFor(parties, params.get('program', '').includes('bowling')
            || String(params.get('program') || '').includes('bowling')), message: '',
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

  const lireEcran = () => page.evaluate(() => {
    const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"]');
    const actives = [...(ligne?.querySelectorAll('.anchor-chip.active') || [])].map((chip) => chip.dataset.time);
    const eteintes = [...(ligne?.querySelectorAll('.anchor-chip[disabled]') || [])].map((chip) => chip.dataset.time);
    return {
      retenue: ((ligne?.querySelector('.anchor-row-pick') || {}).textContent || '').trim(),
      compteur: ((ligne?.querySelector('.anchor-part-count') || {}).textContent || '').trim(),
      actives,
      eteintes: eteintes.length,
      etat: getChosenLaserTimes(createDefaultFormulaPreference(state.booking.preference || {})),
    };
  });
  const cliquer = async (time) => {
    await page.evaluate((valeur) => {
      const ligne = document.querySelector('.anchor-row[data-anchor="laser_game"]');
      const chip = ligne ? ligne.querySelector(`.anchor-chip[data-time="${valeur}"]`) : null;
      if (chip && !chip.disabled) chip.click();
    }, time);
    await page.waitForTimeout(900);
  };

  // ---------------------------------------------------------------------
  console.log('\n[1] Trois parties = UNE liste, pas trois blocs');
  // ---------------------------------------------------------------------
  const arrive = await page.evaluate(async (jour) => {
    state.booking.date = jour;
    state.booking.pax = 8;
    state.booking.activities = {};
    toggleBookingActivity('laser_game');
    setBookingActivityOption('laser_game', 'games', 3);
    applyChosenActivitiesToBooking();
    window.__QA_CALLS__.availability = [];
    await goStep2();
    // LE PARCOURS REEL COMPTE DEUX PAS. Depuis le 2026-08-26 les reglages
    // d activite ont leur propre ecran a TOUTES les largeurs : « Continuer »
    // mene d abord aux reglages, puis aux heures. On fait ce que fait un
    // client, pas moins. Si l ecran ne bouge pas, les assertions d apres
    // rougissent comme avant : rien n est masque ici.
    if (typeof onMobileOptionsPage === 'function' && onMobileOptionsPage()) await goStep2();
    return { type: state.booking.type };
  }, DATE);
  await page.waitForTimeout(800);
  ok(arrive.type === 'visite', `trois parties passent par le fil de visite (type ${arrive.type})`);

  const etape = await page.evaluate(() => ({
    lignes: document.querySelectorAll('.visit-rail-step .anchor-row[data-anchor="laser_game"]').length,
    pistes: document.querySelectorAll('.anchor-track[data-anchor="laser_game"]').length,
    detail: (document.querySelector('.anchor-row[data-anchor="laser_game"] .anchor-row-head small') || {}).textContent || '',
  }));
  ok(etape.lignes === 1, `UNE seule etape laser, pas une par partie (${etape.lignes})`);
  ok(etape.pistes === 1, `UNE seule liste d heures (${etape.pistes})`);
  ok(/3 heures/.test(etape.detail) && /sur place/.test(etape.detail),
    `elle annonce la regle : jusqu a 3 heures, le reste sur place (${JSON.stringify(etape.detail)})`);

  // ---------------------------------------------------------------------
  console.log('\n[2] Une 2e heure s AJOUTE, elle ne remplace pas la 1re');
  // ---------------------------------------------------------------------
  const ouverture = await lireEcran();
  ok(ouverture.etat.join(' ') === '15:00', `a l ouverture, une heure retenue (${JSON.stringify(ouverture.etat)})`);

  await page.evaluate(() => { window.__QA_CALLS__.availability = []; });
  await cliquer('17:00');
  const deux = await lireEcran();
  ok(deux.etat.join(' ') === '15:00 17:00', `deux heures retenues (${JSON.stringify(deux.etat)})`);
  ok(deux.actives.join(' ') === '15:00 17:00', `les DEUX pastilles sont marquees a l ecran (${JSON.stringify(deux.actives)})`);
  ok(deux.retenue === '15:00 · 17:00', `la tete d etape liste les deux heures (${JSON.stringify(deux.retenue)})`);
  ok(/2 heures sur 3/.test(deux.compteur) && /1 partie avec l/.test(deux.compteur),
    `le compteur dit ou on en est (${JSON.stringify(deux.compteur)})`);
  ok(deux.eteintes === 0, 'tant qu il reste une partie, aucune heure n est eteinte');

  const requete = await page.evaluate(() => window.__QA_CALLS__.availability.slice(-1)[0] || '');
  ok(new URLSearchParams(requete).get('laserGameTimes') === JSON.stringify(['15:00', '17:00', '']),
    `la demande porte les heures retenues (${new URLSearchParams(requete).get('laserGameTimes')})`);

  // ---------------------------------------------------------------------
  console.log('\n[3] A la 3e heure la liste est pleine, et elle le DIT');
  // ---------------------------------------------------------------------
  await cliquer('19:00');
  const pleine = await lireEcran();
  ok(pleine.etat.join(' ') === '15:00 17:00 19:00', `trois heures retenues (${JSON.stringify(pleine.etat)})`);
  ok(pleine.eteintes === 7, `les heures non retenues s eteignent (${pleine.eteintes} sur 10)`);
  ok(/3 heures sur 3/.test(pleine.compteur) && /retirer/.test(pleine.compteur),
    `le compteur explique comment en liberer une (${JSON.stringify(pleine.compteur)})`);

  // Un clic sur une heure eteinte ne fait RIEN : pas de remplacement silencieux.
  await cliquer('18:00');
  const apresClicMort = await lireEcran();
  ok(apresClicMort.etat.join(' ') === '15:00 17:00 19:00',
    `cliquer une heure eteinte ne remplace rien en douce (${JSON.stringify(apresClicMort.etat)})`);

  // ---------------------------------------------------------------------
  console.log('\n[4] Re-cliquer une heure retenue la retire');
  // ---------------------------------------------------------------------
  await cliquer('17:00');
  const retiree = await lireEcran();
  ok(retiree.etat.join(' ') === '15:00 19:00', `l heure re-cliquee est retiree (${JSON.stringify(retiree.etat)})`);
  ok(!retiree.actives.includes('17:00'), 'sa pastille n est plus marquee');
  ok(retiree.eteintes === 0, 'et la liste se rouvre');

  // ---------------------------------------------------------------------
  console.log('');
  console.log('[4b] VIDER la liste ne la verrouille pas');
  // ---------------------------------------------------------------------
  // Movsar, 2026-08-21 : « quand on decoche tous les choix on peut plus
  // refaire de choix ». Retirer la DERNIERE heure basculait laserPlacement
  // sur « onsite », ce qui desactivait toutes les pastilles. 'uand la visite
  // n'a qu'une seule ancre (laser seul), la case « je place sur place »
  // n'existe meme pas pour revenir en arriere : cul-de-sac complet, plus rien
  // n'est reservable. Le cas [4] s'arretait a une heure retiree sur trois ;
  // le bug n'apparait qu'au passage a ZERO.
  await cliquer('15:00');
  await cliquer('19:00');
  const videe = await lireEcran();
  ok(videe.etat.filter(Boolean).length === 0, `plus aucune heure retenue (${JSON.stringify(videe.etat)})`);
  ok(videe.eteintes === 0, `et AUCUNE pastille n est eteinte (${videe.eteintes} eteinte(s))`);
  await cliquer('16:00');
  const reprise = await lireEcran();
  ok(reprise.etat.filter(Boolean).join(' ') === '16:00',
    `on peut re-choisir une heure apres avoir tout vide (${JSON.stringify(reprise.etat)})`);
  // On remet l'etat que la suite du gate attend.
  await cliquer('16:00');
  await cliquer('15:00');
  await cliquer('19:00');
  const remise = await lireEcran();
  ok(remise.etat.filter(Boolean).join(' ') === '15:00 19:00',
    `etat restaure pour la suite (${JSON.stringify(remise.etat)})`);

  // ---------------------------------------------------------------------
  console.log('\n[5] Le POST de reservation emporte les heures retenues');
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
  const envoyees = poste && poste.preference && poste.preference.laserGameTimes;
  ok(Array.isArray(envoyees) && envoyees.filter(Boolean).join(' ') === '15:00 19:00',
    `la reservation part avec les heures retenues (${JSON.stringify(envoyees)})`);
  ok(poste && Array.isArray(poste.program) && poste.program.some((item) => item.activityId === 'laser_game' && Number(item.games) === 3),
    'et le panier annonce toujours 3 parties vendues');

  // ---------------------------------------------------------------------
  console.log('\n[6] CONTRE-EPREUVE : une seule partie garde le parcours d avant');
  // ---------------------------------------------------------------------
  const seule = await page.evaluate(async () => {
    state.booking.preference = createDefaultFormulaPreference({});
    state.booking.activities = {};
    toggleBookingActivity('laser_game');
    setBookingActivityOption('laser_game', 'games', 1);
    applyChosenActivitiesToBooking();
    window.__QA_CALLS__.availability = [];
    await goStep2();
    // LE PARCOURS REEL COMPTE DEUX PAS. Depuis le 2026-08-26 les reglages
    // d activite ont leur propre ecran a TOUTES les largeurs : « Continuer »
    // mene d abord aux reglages, puis aux heures. On fait ce que fait un
    // client, pas moins. Si l ecran ne bouge pas, les assertions d apres
    // rougissent comme avant : rien n est masque ici.
    if (typeof onMobileOptionsPage === 'function' && onMobileOptionsPage()) await goStep2();
    return { type: state.booking.type, query: window.__QA_CALLS__.availability.slice(-1)[0] || '' };
  });
  await page.waitForTimeout(700);
  const compteurSeul = await page.evaluate(() => document.querySelectorAll('.anchor-part-count').length);
  ok(seule.type === 'laser', `une seule partie reste sur le parcours direct (type ${seule.type})`);
  ok(!new URLSearchParams(seule.query).get('laserGameTimes'),
    'sa requete ne porte AUCUN parametre en plus (zero regression)');
  ok(compteurSeul === 0, `aucun compteur de parties pour une partie unique (${compteurSeul})`);

  // ---------------------------------------------------------------------
  console.log('\n[7] Une AUTRE activite garde son choix unique a cote de la liste');
  // ---------------------------------------------------------------------
  // Le defaut manquait : ce gate n avait que du laser, donc il n a pas vu que
  // le bowling perdait sa pastille (le multi-choix s appliquait a lui aussi).
  // C est le gate visuel qui l a attrape. Il est couvert ICI desormais.
  await page.evaluate(async (jour) => {
    state.booking.preference = createDefaultFormulaPreference({});
    state.booking.date = jour;
    state.booking.activities = {};
    toggleBookingActivity('bowling');
    setBookingActivityOption('bowling', 'duration', 1);
    toggleBookingActivity('laser_game');
    setBookingActivityOption('laser_game', 'games', 3);
    applyChosenActivitiesToBooking();
    await goStep2();
    // LE PARCOURS REEL COMPTE DEUX PAS. Depuis le 2026-08-26 les reglages
    // d activite ont leur propre ecran a TOUTES les largeurs : « Continuer »
    // mene d abord aux reglages, puis aux heures. On fait ce que fait un
    // client, pas moins. Si l ecran ne bouge pas, les assertions d apres
    // rougissent comme avant : rien n est masque ici.
    if (typeof onMobileOptionsPage === 'function' && onMobileOptionsPage()) await goStep2();
  }, DATE);
  await page.waitForTimeout(900);
  const deuxAncres = await page.evaluate(() => {
    const lire = (id) => {
      const ligne = document.querySelector(`.anchor-row[data-anchor="${id}"]`);
      return {
        presente: Boolean(ligne),
        actives: [...(ligne?.querySelectorAll('.anchor-chip.active') || [])].map((chip) => chip.dataset.time),
        multi: Boolean(ligne?.dataset.multi),
        compteur: Boolean(ligne?.querySelector('.anchor-part-count')),
      };
    };
    return { bowling: lire('bowling'), laser: lire('laser_game') };
  });
  ok(deuxAncres.bowling.presente && deuxAncres.laser.presente, 'les deux ancres sont rendues');
  ok(deuxAncres.bowling.actives.length === 1,
    `le bowling garde SA pastille par defaut (${JSON.stringify(deuxAncres.bowling.actives)})`);
  ok(!deuxAncres.bowling.multi && !deuxAncres.bowling.compteur,
    'et il n herite ni du multi-choix ni du compteur de parties');
  ok(deuxAncres.laser.multi && deuxAncres.laser.compteur,
    'la liste laser, elle, reste multiple et comptee');

  await browser.close();
  server.close();
  console.log('');
  if (failures) {
    console.log(`laser-parts-choice-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('laser-parts-choice-check: ALL OK - une liste, jusqu a 3 heures, et l ecran le dit.');
  process.exit(0);
});
