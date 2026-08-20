// LES PARTIES DE LASER D'UNE VISITE SE VOIENT TOUTES, PAS UNE SEULE.
//
// Movsar, 2026-08-20 : « quand on reserve plusieurs activites dans un
// formulaire et qu'on met en plus laser et qu'on choisit plusieurs parties de
// laser game et d'autres activites, ça affiche que 1 partie dans les
// reservations et aussi sur le planning ».
//
// Ce que le harnais a mesure : le serveur enregistre bien les 3 parties
// (program.items[laser_game].games = 3, et opsPlan.laserPassPlan compte
// totalGames 3 / remainingGames 2). C'est la CONSOLE qui n'en voyait qu'une :
// `getLaserGameCountForReservation` ne lisait que `type === 'laser'` et l'id de
// formule. Une visite n'a ni l'un ni l'autre (son type vaut 'bowling' des
// qu'elle contient du bowling), donc le compte tombait a ZERO :
//   - aucun marqueur « x3 » sur la carte,
//   - « Partie 1/3 » ecrit « Partie unique »,
//   - et surtout : les 2 parties restantes n'entraient pas dans la file
//     « Parties a placer » (son filtre n'acceptait que laser/formule).
// Deux parties payees devenaient invisibles pour le comptoir.
//
// Le gate ouvre la VRAIE console avec une visite telle que le serveur l'ecrit,
// et compte ce qui s'affiche. Contre-epreuve incluse : une visite a UNE partie
// ne met rien dans la file, et un bowling seul ne change pas d'un pixel.
//
// Lancement : node scripts/visit-laser-parts-check.js

const PORT = Number(process.env.PINLANE_VISITLASER_PORT || 4231);
const http = require('http');
const fs = require('fs');
const p = require('path');
const ROOT = p.join(__dirname, '..');
const { chromium } = require(p.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FORMULES = require(p.join(ROOT, 'lib', 'booking-config.js')).FORMULES;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = p.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(ROOT, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(c);
  });
});

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()); });
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await pg.addInitScript(({ expiresAt, FORMULES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'clients.view', 'payments.view', 'payments.markPaid', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Date LOCALE, comme todayStr() : un toISOString() aurait pose la fixture la
    // veille passe minuit a Bruxelles et fait rougir le gate sans defaut reel.
    const localDay = new Date();
    const today = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;

    // LA VISITE, telle que le serveur l'ecrit (verifie au harnais serveur dans
    // scripts/plan-lane-fidelity-check) : type 'bowling', pas de formuleId, le
    // laser vit dans program.items, et le plan ne place que la 1re partie.
    const visite = (id, games, name) => ({
      id, name, phone: '+32487784816', email: 'v@x.be', date: today, startTime: '15:00',
      duration: 1, totalDuration: 2.5, pax: 8, price: 250, basePrice: 250, type: 'bowling',
      label: `Bowling 1h · Laser ${games} partie${games > 1 ? 's' : ''}`, lanes: [1, 2], laneCount: 2,
      status: 'pending', centerId: 'libramont', channel: 'public', activityProgress: {}, extras: [],
      program: {
        items: [
          { activityId: 'bowling', name: 'Bowling', planned: true, duration: 1, minutes: 60, price: 100, priceKnown: true },
          { activityId: 'laser_game', name: 'Laser Game', planned: true, games, duration: games * 0.5, minutes: games * 30, price: 150, priceKnown: true },
        ],
        price: 250, priceComplete: true,
      },
      opsPlan: {
        ok: true, startTime: '15:00', endTime: '16:55', totalMinutes: 115, assignedLanes: [1, 2], conflicts: [],
        risk: { level: 'low', score: 10, reasons: [] }, timeline: [],
        resourceBlocks: [
          { activityId: 'bowling', resourceType: 'bowling_lane', start: 900, end: 960, startTime: '15:00', endTime: '16:00', requiredLanes: 2, lanes: [1, 2], players: 8 },
          { activityId: 'laser_game', resourceType: 'laser_arena', start: 990, end: 1015, startTime: '16:30', endTime: '16:55', countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1, players: 8 },
        ],
        laserPassPlan: {
          mode: 'manual_after_first', totalGames: games, scheduledGames: 1, remainingGames: Math.max(0, games - 1),
          scheduledPasses: [{ countIndex: 1, status: 'scheduled', startTime: '16:30' }],
          pendingPasses: Array.from({ length: Math.max(0, games - 1) }, (_, i) => ({ countIndex: i + 2, status: 'pending' })),
        },
      },
    });

    const R = [
      visite(4101, 3, 'VISITE 3 PARTIES'),
      visite(4102, 1, 'VISITE 1 PARTIE'),
      // Temoin : bowling seul, aucun programme. Il ne doit RIEN changer.
      { id: 4103, name: 'BOWLING SEUL', phone: '+32487784817', email: 'b@x.be', date: today, startTime: '18:00', duration: 1, pax: 4, price: 40, basePrice: 40, type: 'bowling', label: 'Bowling Classique', lanes: [7], laneCount: 1, status: 'pending', centerId: 'libramont', channel: 'staff', activityProgress: {}, extras: [] },
    ];

    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: R, laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: R, laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: FORMULES, activities: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, FORMULES });

  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof window.setView === 'function');
  await pg.evaluate(() => window.setView('staff'));
  await pg.waitForFunction(() => typeof state !== "undefined" && (state.reservations || []).some((r) => Number(r.id) === 4101), null, { timeout: 20000 });

  // -- [1] LE COMPTE : ce que le produit croit avoir vendu ---------------------
  console.log('\n[1] Le compte de parties vient du PROGRAMME');
  const compte = await pg.evaluate(() => {
    const find = (id) => state.reservations.find((r) => Number(r.id) === id);
    return {
      visite3: getLaserGameCountForReservation(find(4101)),
      visite1: getLaserGameCountForReservation(find(4102)),
      bowling: getLaserGameCountForReservation(find(4103)),
      unites3: getLaserUnitsForReservation(find(4101)).length,
    };
  });
  ok(compte.visite3 === 3, `visite « 3 parties » : le produit en compte 3 (${compte.visite3})`);
  ok(compte.visite1 === 1, `visite « 1 partie » : le produit en compte 1 (${compte.visite1})`);
  ok(compte.bowling === 0, `temoin bowling seul : aucun laser (${compte.bowling})`);
  ok(compte.unites3 === 3, `3 unites plaçables pour la visite a 3 parties (${compte.unites3})`);

  // -- [2] LA FILE « PARTIES A PLACER » ---------------------------------------
  console.log('\n[2] Les parties non placees entrent dans la file');
  const file = await pg.evaluate(() => {
    const passes = getPendingLaserPasses(state.currentDate);
    return {
      total: passes.length,
      pour4101: passes.filter((x) => Number(x.reservation.id) === 4101).map((x) => `${x.countIndex}/${x.totalGames}`),
      pour4102: passes.filter((x) => Number(x.reservation.id) === 4102).length,
      pour4103: passes.filter((x) => Number(x.reservation.id) === 4103).length,
    };
  });
  ok(file.pour4101.join(' ') === '2/3 3/3', `les parties 2 et 3 attendent d etre placees (${JSON.stringify(file.pour4101)})`);
  ok(file.pour4102 === 0, 'une visite a UNE partie ne met rien en attente (contre-epreuve)');
  ok(file.pour4103 === 0, 'un bowling seul ne met rien en attente (contre-epreuve)');

  // -- [3] CE QUI EST DESSINE SUR LE PLANNING LASER ---------------------------
  console.log('\n[3] Le planning laser l ecrit a l ecran');
  await pg.evaluate(() => openStaffPlanningResource('laser'));
  await pg.waitForSelector('.laser-pass-queue, .laser-group-card', { timeout: 20000 });
  const ecran = await pg.evaluate(() => {
    const cartes = [...document.querySelectorAll('.laser-pass-card')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
    const groupes = [...document.querySelectorAll('.laser-group-card')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
    return {
      cartesEnAttente: cartes,
      groupes,
      entete: (document.querySelector('.laser-pass-queue-copy strong') || {}).textContent || '',
    };
  });
  const attente4101 = ecran.cartesEnAttente.filter((t) => /VISITE 3 PARTIES/.test(t));
  ok(attente4101.length === 2, `2 cartes « a placer » pour la visite (${attente4101.length}) : ${JSON.stringify(attente4101)}`);
  ok(attente4101.some((t) => /Partie 2\/3/.test(t)) && attente4101.some((t) => /Partie 3\/3/.test(t)),
    'les cartes disent QUELLE partie attend (2/3 et 3/3)');
  ok(/2/.test(ecran.entete), `l entete de la file annonce le compte (${JSON.stringify(ecran.entete)})`);
  const groupe4101 = ecran.groupes.find((t) => /VISITE 3 PARTIES/.test(t)) || '';
  ok(/P1\/3|Partie 1\/3/.test(groupe4101), `la session placee est nommee « partie 1/3 » (${JSON.stringify(groupe4101.slice(0, 120))})`);

  // -- [4] LE PLANNING BOWLING N'A PAS BOUGE ----------------------------------
  console.log('\n[4] La visite reste posee sur ses pistes de bowling');
  await pg.evaluate(() => openStaffPlanningResource('bowling'));
  await pg.waitForTimeout(600);
  const pistes = await pg.evaluate(() => {
    const find = (id) => state.reservations.find((r) => Number(r.id) === id);
    return getBowlingWindowsFromReservation(find(4101)).map((w) => `${w.lanes.join('+')}@${w.start}`);
  });
  ok(pistes.join(',') === '1+2@15', `bowling de la visite sur les pistes 1 et 2 a 15h (${JSON.stringify(pistes)})`);

  await b.close();
  srv.close();
  console.log('');
  if (failures) {
    console.log(`visit-laser-parts-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('visit-laser-parts-check: ALL OK');
  process.exit(0);
});
