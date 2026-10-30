// LES CAPACITES DU CENTRE ONT UNE SOURCE (lot du 2026-09-28).
//
// La console lisait les constantes du socle (8 pistes, 30 armes, un seul
// lancement) a l allocation des pistes, dans les selecteurs de pistes, dans la
// capacite de l accueil et du planning, dans le tableau laser, dans Tarifs et
// dans la Direction, pendant que la grille lisait la configuration du centre.
// Gembloux declare 20 armes et six lancements paralleles, N4 n a pas d arene.
//
// PROUVE, sur l application reellement servie (Playwright, API simulees) :
//   A. centre a 6 pistes / 20 armes / 6 lancements (configuration staff) :
//      allocation, fiche de modification, reservation rapide, blocage de tout
//      le centre, disponibilite laser (lancement parallele accepte, armes
//      partagees), tableau laser, planning laser, occupation, Tarifs ;
//   B. centre a 12 pistes : les pistes 9 a 12 existent partout ;
//   C. centre a un seul lancement : le 2e lancement qui chevauche est refuse ;
//   D. role SANS configuration staff : les memes nombres, lus dans la reponse
//      du tunnel (public-booking-meta), plus la constante ; et la reponse du
//      tunnel d un AUTRE centre (restee en memoire apres une bascule) ne vaut
//      pas pour celui-ci ;
//   E. N4 (aucune arene) : la journee complete ne compte pas de laser fantome ;
//   F. Direction : capacite laser = armes x departs, pas de ligne laser sans
//      arene, debordement d arene detecte, un lancement partage compte une fois ;
//   S. serveur : public-booking-meta sert les lancements paralleles du centre.
//
// CONTRE-PREUVES : chaque regle est cassee EN MEMOIRE (le serveur statique sert
// le fichier mute, rien n est ecrit sur le disque) et le controle vise doit
// rougir. Une mutation qui ne fait rien rougir est un echec du gate.
//
// Lancement : node scripts/capacites-centre-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CAPACITES_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const JOUR = '2026-07-18';

// Mutation courante, appliquee au contenu SERVI (jamais au fichier).
let mutation = null;

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      let body = content;
      if (mutation && path.relative(ROOT, filePath).split(path.sep).join('/') === mutation.file) {
        const texte = content.toString('utf8');
        if (!texte.includes(mutation.find)) {
          mutation.introuvable = true;
        } else {
          mutation.servie = true;
          body = Buffer.from(texte.replace(mutation.find, mutation.replace), 'utf8');
        }
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page, { restreint = false } = {}) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, restreint }) => {
    const toutes = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view', 'payments.view'];
    // Un role d accueil : ni reglages ni direction, donc pas de configuration staff.
    const perms = restreint ? toutes.filter((p) => p !== 'settings.manage' && p !== 'direction.view') : toutes;
    const roleId = restreint ? 'accueil' : 'direction';
    // Un role verrouille (Direction) a toutes les permissions du centre : le
    // role d accueil ne l est pas, sinon il garderait la configuration staff.
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId }, role: { id: roleId, name: restreint ? 'Accueil' : 'Direction', locked: !restreint }, permissions: perms };
    const openWeek = {};
    for (let jour = 0; jour < 7; jour += 1) openWeek[String(jour)] = { open: '10:00', close: '24:00' };
    window.__CFG__ = { lanes: 6, weapons: 20, parallel: 6, jeu: 'gembloux' };
    const centerFor = (id) => ({
      id, name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount: window.__CFG__.lanes, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount: window.__CFG__.weapons, parallelLaunches: window.__CFG__.parallel, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' },
        partyTables: null,
      },
      defaultSchedule: { regular: openWeek, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {}, classification: {}, customActivities: [],
    });
    // Un bloc laser pose, en minutes, comme le serveur les rend.
    const bloc = (debut, fin, joueurs) => ({
      resourceType: 'laser_arena', activityId: 'laser_game', start: debut, end: fin,
      startTime: `${String(Math.floor(debut / 60)).padStart(2, '0')}:${String(debut % 60).padStart(2, '0')}`,
      endTime: `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`,
      durationMinutes: fin - debut, players: joueurs, countIndex: 1, groupWaveIndex: 1, groupWaveCount: 1,
    });
    const laser = (id, nom, date, heure, joueurs, debut, fin) => ({
      id, name: nom, phone: '+32470860000', email: `l${id}@x.test`, date, startTime: heure, duration: 0.5, lanes: [],
      status: 'confirmed', pax: joueurs, price: 10 * joueurs, type: 'laser', label: 'Laser direct',
      opsPlan: { resourceBlocks: [bloc(debut, fin, joueurs)] },
    });
    const build = (date) => {
      const bowling = [
        { id: 9001, name: 'Groupe A #9001', phone: '+32470860011', email: 'a@x.test', date, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 20, type: 'bowling', label: 'Bowling' },
        { id: 9002, name: 'Groupe B #9002', phone: '+32470860012', email: 'b@x.test', date, startTime: '15:00', duration: 1, lanes: [3], status: 'confirmed', pax: 4, price: 39, type: 'bowling', label: 'Bowling' },
      ];
      if (window.__CFG__.jeu === 'n4') {
        // N4 : bowling seul, et une matinee pleine sur les 8 pistes (24 h piste).
        return [...bowling, { id: 9020, name: 'Seminaire #9020', phone: '+32470860020', email: 's@x.test', date, startTime: '10:00', duration: 3, lanes: [1, 2, 3, 4, 5, 6, 7, 8], status: 'confirmed', pax: 40, price: 600, type: 'bowling', label: 'Bowling' }];
      }
      return [
        ...bowling,
        // Lancement S1 17:30-17:55 partage par deux groupes (8 + 4).
        laser(9010, 'Laser C #9010', date, '17:30', 8, 1050, 1075),
        laser(9013, 'Laser D #9013', date, '17:30', 4, 1050, 1075),
        // Lancement S2 place a la main 17:45-18:10 : il chevauche S1.
        laser(9011, 'Laser E #9011', date, '17:45', 6, 1065, 1090),
        // Lancement S3 place a la main 20:10-20:35.
        laser(9012, 'Laser F #9012', date, '20:10', 10, 1210, 1235),
      ];
    };
    window.__QA_LASER__ = laser;
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: roleId, selectedMemberId: 'qa', roles: [{ id: roleId, name: qaSession.role.name, code: 'QA', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: !restreint, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId, status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      // Les notes client internes (API du 2026-10-05, journal Pinlane 378) : la console
      // les precharge pour chaque carte. Absente, elle repondait 404 et ce gate rougissait
      // sur « aucune erreur console ». Meme forme que lib/customer-notes.js (voir le
      // mock commun de planning-matrix-check.js).
      if (u.pathname === '/api/staff-customer-notes' && String(init.method || 'GET').toUpperCase() === 'GET') {
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        const lot = u.searchParams.get('reservationIds');
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') {
        // Ce que le serveur sert au tunnel, lisible par tous les roles.
        // Forme du vrai payload : le centre du tunnel ne porte PAS `resources`,
        // seulement ses nombres dans `booking`.
        const booking = { laneCount: window.__CFG__.lanes, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, laserArenaCapacity: window.__CFG__.weapons || null, laserParallelLaunches: window.__CFG__.parallel || null };
        const { resources, ...centreTunnel } = centerFor('libramont');
        return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: restreint ? { ...centreTunnel, booking } : null });
      }
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [centerFor(u.searchParams.get('centerId') || 'libramont')], activities: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, restreint });
}

// Pose une configuration de centre, recharge la configuration staff et rend.
async function poser(page, cfg, vue = 'bowling') {
  await page.evaluate(async ({ cfg, vue, jour }) => {
    window.__CFG__ = cfg;
    state.currentDate = jour; state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning'; state.staffResourceView = vue; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = false; state.staffPlanningExpanded = false;
    state.reservations = window.__QA_BUILD__(jour); state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 30)); }
    await loadStaffCenterConfig(true);
    renderStaff();
  }, { cfg, vue, jour: JOUR });
  await page.waitForTimeout(200);
}

async function scenarios(browser, echecs) {
  const controle = (cond, label, detail = '') => {
    if (!cond) echecs.push(label);
    if (!mutation) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  };
  const erreurs = [];
  // ---- A, B, C, E, F : role direction (configuration staff chargee) ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (msg) => { if (msg.type() === 'error') erreurs.push(`${msg.text()} ${msg.location().url || ''}`.trim()); });
  page.on('pageerror', (err) => erreurs.push(String(err && err.message)));
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=cap-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 15000 });

  const gembloux = { lanes: 6, weapons: 20, parallel: 6, jeu: 'gembloux' };
  await poser(page, gembloux, 'bowling');
  const a = await page.evaluate(async (jour) => {
    const r = {};
    r.prerequis = staffCenterConfigCache.loaded && staffCenterConfigCache.centers.length === 1;
    r.pistes = getAvailabilityLaneCount();
    r.libres = getFreeCount(jour, '11:00', 1);
    r.six = allocateLanes(6, jour, '11:00', 1);
    r.sept = allocateLanes(7, jour, '11:00', 1);
    editRes(9001);
    await new Promise((res) => setTimeout(res, 150));
    r.fiche = document.querySelectorAll('.lane-picker .lane-chip').length;
    closePos();
    openQuickBook({ date: jour, startTime: '11:00', type: 'bowling', duration: 1, pax: 4 });
    await new Promise((res) => setTimeout(res, 100));
    // La grille des pistes vit dans « Plus d options », repliee a l ouverture.
    toggleQuickBookMore();
    await new Promise((res) => setTimeout(res, 150));
    r.rapide = document.querySelectorAll('#quickBookOverlay .rv-pistes-choix [data-piste]').length;
    const overlay = document.getElementById('quickBookOverlay');
    r.rapideDiag = `overlay ${overlay ? (overlay.classList.contains('hidden') ? 'cache' : 'ouvert') : 'absent'}, ${overlay ? overlay.textContent.replace(/\s+/g, ' ').slice(0, 600) : ''}, type ${quickBookState && quickBookState.type}, grilles ${document.querySelectorAll('#quickBookOverlay .rv-pistes-choix').length}, boutons ${document.querySelectorAll('#quickBookOverlay .rv-pistes-choix [data-piste]').length}`;
    closeQuickBook();
    const avant = availabilityBlocksCache.blocks;
    availabilityBlocksCache.blocks = [{ id: 1, scopeType: 'center', scopeRef: null, recurrence: 'once', date: jour, startTime: null, endTime: null, reason: 'QA' }];
    r.blocage = Object.keys(getBowlingBlockWindows(jour, 10, 24)).map(Number).sort((x, y) => x - y);
    availabilityBlocksCache.blocks = avant;
    // Laser : le depart de 20:30 chevauche le lancement pose a 20:10 sans
    // pouvoir le rejoindre (20 min d ecart, le serveur en tolere 15).
    const candidat = getLaserCandidateWindows('20:30', 0.5, 4)[0];
    const existant = getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9012))[0];
    r.prerequisLaser = candidat.start < existant.end && candidat.end > existant.start && Math.abs(candidat.start - existant.start) * 60 > 15;
    r.parallele = getLaserAvailability(jour, '20:30', 0.5, 4, null);
    r.deborde = getLaserAvailability(jour, '20:30', 0.5, 11, null);
    return r;
  }, JOUR);
  controle(a.prerequis, 'A0 prerequis : configuration staff du centre chargee');
  controle(a.pistes === 6, 'A1 pistes du centre : 6', `obtenu ${a.pistes}`);
  controle(a.libres === 6 && Array.isArray(a.six) && a.six.length === 6 && Math.max(...a.six) <= 6 && !a.sept, 'A2 allocation : 6 pistes libres, aucune au-dela de 6, 7 refusees', `libres ${a.libres}, 6 -> ${JSON.stringify(a.six)}, 7 -> ${JSON.stringify(a.sept)}`);
  controle(a.fiche === 6, 'A3 fiche de modification : 6 pistes proposees', `obtenu ${a.fiche}`);
  controle(a.rapide === 6, 'A4 reservation rapide : 6 pistes dans la grille', a.rapide === 6 ? 'obtenu 6' : `obtenu ${a.rapide} (${a.rapideDiag})`);
  controle(JSON.stringify(a.blocage) === '[1,2,3,4,5,6]', 'A5 blocage de tout le centre : ses 6 pistes', `obtenu ${JSON.stringify(a.blocage)}`);
  controle(a.prerequisLaser, 'A6a prerequis : le depart de 20:30 chevauche le lancement de 20:10 sans le rejoindre');
  controle(a.parallele.ok === true, 'A6 laser : 2e lancement en parallele accepte (6 lancements, 14 joueurs sur 20 armes)', a.parallele.message || 'accepte');
  controle(a.deborde.ok === false && /il reste 10 places/.test(a.deborde.message), 'A7 laser : 21 joueurs sur 20 armes refuses, il reste 10 places', a.deborde.message);

  await poser(page, gembloux, 'laser');
  const laserVue = await page.evaluate((jour) => {
    const r = {};
    const modele = buildStaffLaserBoardModel();
    const html = renderStaffLaserBoard(modele);
    r.tableau = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    r.s1 = modele.sessions.find((s) => Math.abs(s.start - 17.5) < 0.01);
    r.s1 = r.s1 ? { arena: r.s1.arena, remaining: r.s1.remaining } : null;
    renderLaserPlanning();
    // Le planning dit, pour chaque depart, l arene entiere : ses groupes et
    // ceux d un lancement parallele encore en jeu a cette heure.
    const depart = (t) => {
      const rang = document.querySelector(`#laserPlanningGridWrap .lp-dep[data-lp-t="${t}"]`);
      if (!rang) return null;
      return {
        occupe: (rang.querySelector('.lp-dep__n b') || {}).textContent || '',
        reste: (rang.querySelector('.lp-dep__n small') || {}).textContent || '',
        dit: (rang.querySelector('.lp-dep__jauge') || { getAttribute: () => '' }).getAttribute('aria-label') || '',
        qui: ((rang.querySelector('.lp-qui') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      };
    };
    r.planning = { s1: depart(17.5), s2: depart(18) };
    renderKpis();
    r.occ = document.getElementById('kpiOcc')?.textContent || '';
    const win = getPlanningWindow(jour);
    const joueurs = state.reservations.reduce((somme, res) => somme + getLaserWindowsFromReservation(res).reduce((s, w) => s + Number(w.players || 0), 0), 0);
    r.joueurs = joueurs;
    r.occAttendue = `${Math.round((joueurs / (20 * Math.max((win.close - win.open) * 2, 1))) * 100)}%`;
    const ligne = getPricingRows().find((row) => row.id === 'laser-1') || {};
    r.tarif = { capacity: ligne.capacity, availability: ligne.availability, tags: ligne.tags };
    return r;
  }, JOUR);
  controle(laserVue.s1 && laserVue.s1.arena === 18 && laserVue.s1.remaining === 2
    && /18\/20/.test(laserVue.tableau) && /dont 6 joueurs sur un lancement en parallèle/.test(laserVue.tableau) && /Ajouter un groupe · 2 places/.test(laserVue.tableau),
  'A8 tableau laser : arene 18/20, 2 places, lancement parallele dit', JSON.stringify(laserVue.s1));
  // S2 (17:45-18:10) part dans la demi-heure de 17:30 et joue encore au
  // depart de 18:00 : 17:30 compte 12 + 6 ; 18:00 compte ses 6 armes prises
  // et dit pourquoi (jamais « Libre » ni « 20 places »).
  const p9 = laserVue.planning;
  controle(Boolean(p9.s1 && p9.s2) && p9.s1.occupe === '18' && p9.s1.reste === '2 places' && /^17:30 : 18 sur 20, 2 places\./.test(p9.s1.dit)
    && p9.s2.occupe === '6' && p9.s2.reste === '14 places' && /^18:00 : 6 sur 20, 14 places\. 6 en jeu jusqu’à 18:10\./.test(p9.s2.dit)
    && p9.s2.qui === '6 en jeu jusqu’à 18:10',
  'A9 planning laser : chaque depart compte l arene entiere et dit le lancement encore en jeu (17:30 18/20, 18:00 6/20)', JSON.stringify(p9));
  controle(laserVue.joueurs === 28 && laserVue.occ === laserVue.occAttendue, 'A10 occupation laser : armes x departs, pas x lancements', `affiche ${laserVue.occ}, attendu ${laserVue.occAttendue}`);
  controle(laserVue.tarif.capacity === '20 joueurs en même temps au plus' && laserVue.tarif.availability === '6 lancements simultanés' && (laserVue.tarif.tags || []).includes('20 armes'),
    'A11 tarifs laser : 20 armes, 6 lancements', JSON.stringify(laserVue.tarif));

  // ---- F : Direction (admin-console injecte a la demande) ----
  const f = await page.evaluate(async () => {
    await ensureAdminConsolesLoaded();
    const r = {};
    const centre20 = { id: 'qa', name: 'QA', status: 'active', resources: { bowling: { laneCount: 6 }, laser: { weaponCount: 20, parallelLaunches: 6 } } };
    const centreN4 = { id: 'qa', name: 'QA', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 0, parallelLaunches: 1 } } };
    const m = buildAdminMetrics(state.reservations, centre20);
    r.bowlingCapacity = m.bowlingCapacity; r.laserCapacity = m.laserCapacity; r.lancements = m.laserLaunches;
    const n4 = buildAdminMetrics(state.reservations, centreN4);
    r.n4 = { hasLaser: n4.hasLaser, laserCapacity: n4.laserCapacity };
    r.sansDebordement = findAdminLaserIssues(state.reservations, centre20).overCapacity.length;
    // 5 joueurs de plus sur le lancement pose a 17:45 : 12 + 11 = 23 armes.
    const renfort = window.__QA_LASER__(9014, 'Laser G #9014', state.currentDate, '17:45', 5, 1065, 1090);
    r.avecDebordement = findAdminLaserIssues([...state.reservations, renfort], centre20).overCapacity.length;
    return r;
  });
  controle(f.bowlingCapacity > 0 && f.laserCapacity === (f.bowlingCapacity / 6) * 20 * 2, 'F1 direction : capacite laser = armes x departs', `laser ${f.laserCapacity}, bowling ${f.bowlingCapacity}`);
  controle(f.n4.hasLaser === false && f.n4.laserCapacity === 0, 'F2 direction : N4 sans arene, pas de capacite laser', JSON.stringify(f.n4));
  controle(f.sansDebordement === 0 && f.avecDebordement >= 1, 'F3 direction : debordement d arene detecte a 20 armes', `sans ${f.sansDebordement}, avec ${f.avecDebordement}`);
  controle(f.lancements === 3, 'F4 direction : un lancement partage compte une fois', `obtenu ${f.lancements}`);

  // ---- B : 12 pistes ----
  await poser(page, { lanes: 12, weapons: 20, parallel: 6, jeu: 'gembloux' }, 'bowling');
  const b = await page.evaluate((jour) => {
    const r = { pistes: getAvailabilityLaneCount(), dix: allocateLanes(10, jour, '11:00', 1), colonnes: document.querySelectorAll('.lane-col').length };
    const avant = availabilityBlocksCache.blocks;
    availabilityBlocksCache.blocks = [{ id: 1, scopeType: 'center', scopeRef: null, recurrence: 'once', date: jour, startTime: null, endTime: null, reason: 'QA' }];
    r.blocage = Object.keys(getBowlingBlockWindows(jour, 10, 24)).length;
    availabilityBlocksCache.blocks = avant;
    return r;
  }, JOUR);
  controle(b.pistes === 12 && b.colonnes === 12 && Array.isArray(b.dix) && b.dix.length === 10 && Math.max(...b.dix) >= 10, 'B1 12 pistes : les pistes 9 a 12 existent et s attribuent', JSON.stringify(b));
  controle(b.blocage === 12, 'B2 12 pistes : le blocage du centre couvre les 12', `obtenu ${b.blocage}`);

  // ---- C : un seul lancement (Libramont) ----
  await poser(page, { lanes: 8, weapons: 30, parallel: 1, jeu: 'gembloux' }, 'laser');
  const c = await page.evaluate((jour) => getLaserAvailability(jour, '20:30', 0.5, 4, null), JOUR);
  controle(c.ok === false && /un seul lancement/.test(c.message), 'C1 un seul lancement : le 2e lancement qui chevauche est refuse', c.message);

  // ---- E : N4, aucune arene, journee complete ----
  await poser(page, { lanes: 8, weapons: 0, parallel: 1, jeu: 'n4' }, 'all');
  const e = await page.evaluate((jour) => {
    const reel = window.getAdminCenter;
    window.getAdminCenter = () => ({ id: 'n4-qa', name: 'N4 QA', status: 'active', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 0, parallelLaunches: 1 } } });
    renderKpis();
    window.getAdminCenter = reel;
    const win = getPlanningWindow(jour);
    const heuresPiste = state.reservations.reduce((s, res) => s + getBowlingWindowsFromReservation(res).reduce((t, w) => t + Number(w.duration || 0) * Math.max((w.lanes || []).length, 1), 0), 0);
    return { occ: document.getElementById('kpiOcc')?.textContent || '', attendu: `${Math.round((heuresPiste / (8 * Math.max(win.close - win.open, 1))) * 100)}%`, heuresPiste };
  }, JOUR);
  controle(e.heuresPiste === 26 && e.occ === e.attendu, 'E1 N4 journee complete : pas de laser fantome dans la capacite', `affiche ${e.occ}, attendu ${e.attendu}`);
  await page.close();

  // ---- D : role sans configuration staff ----
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page2.on('pageerror', (err) => erreurs.push(String(err && err.message)));
  await installMock(page2, { restreint: true });
  await page2.goto(`${BASE_URL}/?v=cap-r-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page2.waitForFunction(() => typeof window.loadCenterScheduleConfig === 'function', null, { timeout: 15000 });
  const d = await page2.evaluate(async () => {
    window.__CFG__ = { lanes: 6, weapons: 20, parallel: 6, jeu: 'gembloux' };
    await loadStaffCenterConfig(true);
    await loadCenterScheduleConfig();
    const r = {
      sansConfigStaff: !(staffCenterConfigCache.centers || []).length,
      pistes: getAvailabilityLaneCount(), armes: getAvailabilityLaserCapacity(), lancements: getAvailabilityLaserParallelLaunches(),
    };
    // Apres une bascule, la configuration du tunnel du centre PRECEDENT reste en
    // memoire jusqu a la reponse suivante : ses nombres ne valent pas ici.
    const tunnel = getCenterScheduleConfig();
    setCenterScheduleConfig({ ...tunnel, id: 'autre-centre' });
    r.autre = { pistes: getAvailabilityLaneCount(), armes: getAvailabilityLaserCapacity(), lancements: getAvailabilityLaserParallelLaunches() };
    setCenterScheduleConfig(tunnel);
    return r;
  });
  controle(d.sansConfigStaff, 'D0 prerequis : le role d accueil n a pas la configuration staff');
  controle(d.pistes === 6 && d.armes === 20 && d.lancements === 6, 'D1 role restreint : 6 pistes / 20 armes / 6 lancements lus du tunnel', JSON.stringify({ pistes: d.pistes, armes: d.armes, lancements: d.lancements }));
  controle(d.autre.pistes === 8 && d.autre.armes === 30 && d.autre.lancements === 1, 'D2 la config du tunnel d un autre centre ne vaut pas ici', JSON.stringify(d.autre));
  await page2.close();

  const utiles = erreurs.filter((texte) => !/favicon|vercel-insights|net::ERR/i.test(texte));
  controle(!utiles.length, 'Z aucune erreur JavaScript', utiles.slice(0, 3).join(' | '));
}

// ---- S : le serveur sert les lancements paralleles du centre ----
function chargerModule(fichier, remplacement) {
  const absolu = path.join(ROOT, fichier);
  let source = fs.readFileSync(absolu, 'utf8');
  if (remplacement) {
    if (!source.includes(remplacement.find)) throw new Error(`ancre introuvable dans ${fichier}`);
    source = source.replace(remplacement.find, remplacement.replace);
  }
  const m = new Module(absolu, module);
  m.filename = absolu;
  m.paths = Module._nodeModulePaths(path.dirname(absolu));
  m._compile(source, absolu);
  return m.exports;
}

async function serveur(echecs, remplacement = null) {
  class FakePool {
    async query() { return { rows: [], rowCount: 0 }; }
    async connect() { return { query: async () => ({ rows: [], rowCount: 0 }), release() {} }; }
    async end() {}
  }
  const pgPath = require.resolve('pg');
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake/fake';
  process.env.DATABASE_SSL = 'disable';
  const api = chargerModule('api/public-booking-meta.js', remplacement);
  const knowledge = require(path.join(ROOT, 'lib', 'ops-knowledge'));
  const appel = async () => {
    const req = { method: 'GET', url: '/api/public-booking-meta?centerId=libramont', headers: { host: 'localhost', 'x-forwarded-for': '10.9.9.9' }, socket: { remoteAddress: '10.9.9.9' } };
    const res = { statusCode: 0, headers: {}, body: '' };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk); };
    await api(req, res);
    return JSON.parse(res.body || '{}');
  };
  await appel();
  knowledge.applyCenterOverrides(new Map([['libramont', { resources: { laser: { weaponCount: 20, parallelLaunches: 6 } } }]]));
  const prerequis = knowledge.getCenter('libramont').resources.laser.parallelLaunches === 6;
  const payload = await appel();
  knowledge.applyCenterOverrides(new Map());
  const booking = (payload.center && payload.center.booking) || {};
  const bon = prerequis && booking.laserParallelLaunches === 6 && booking.laserArenaCapacity === 20;
  if (!bon) echecs.push('S1 serveur : public-booking-meta sert les lancements paralleles du centre');
  if (!remplacement) console.log(`${bon ? 'ok  ' : 'FAIL'}  S1 serveur : public-booking-meta sert les lancements paralleles du centre :: ${JSON.stringify({ prerequis, laserParallelLaunches: booking.laserParallelLaunches, laserArenaCapacity: booking.laserArenaCapacity })}`);
}

const MUTATIONS = [
  { vise: 'A2', file: 'assets/app-main.js', find: "for (let i = 1; i <= laneCount; i++) if (!occ.has(i) && state.laneStatuses[i] !== 'maintenance') count++;", replace: "for (let i = 1; i <= TOTAL_LANES; i++) if (!occ.has(i) && state.laneStatuses[i] !== 'maintenance') count++;" },
  { vise: 'A3', file: 'assets/app-main.js', find: '${Array.from({ length: getAvailabilityLaneCount() }, (_, index) => index + 1).map(lane => {', replace: '${Array.from({ length: TOTAL_LANES }, (_, index) => index + 1).map(lane => {' },
  { vise: 'A4', file: 'assets/app-main.js', find: '${Array.from({ length: getAvailabilityLaneCount() }, (_, idx) => idx + 1).map((lane) => {', replace: '${Array.from({ length: TOTAL_LANES }, (_, idx) => idx + 1).map((lane) => {' },
  { vise: 'A5', file: 'assets/app-main.js', find: 'for (let lane = 1; lane <= laneCount; lane += 1) push(lane, toWindow(block));', replace: 'for (let lane = 1; lane <= TOTAL_LANES; lane += 1) push(lane, toWindow(block));' },
  { vise: 'A6', file: 'assets/app-main.js', find: 'if (launchCount > lancementsMax) {', replace: 'if (launchCount > 1) {' },
  { vise: 'A7', file: 'assets/app-main.js', find: 'const postesArene = getAvailabilityLaserCapacity();', replace: 'const postesArene = LASER_GAME_MAX_PLAYERS;' },
  { vise: 'A8', file: 'assets/app-main.js', find: 'session.arena = getLaserSessionArenaPlayers(session, sessions);', replace: 'session.arena = session.players;' },
  { vise: 'A9', file: 'assets/app-main.js', find: 'const occupe = [...ici, ...holds, ...chevauche].reduce((s, w) => s + lpArene(w), 0);', replace: 'const occupe = [...ici, ...holds].reduce((s, w) => s + lpArene(w), 0);' },
  { vise: 'A9', file: 'assets/app-main.js', find: 'const enJeu = d.chevauche.filter(w => !w.enLigne);', replace: 'const enJeu = [];' },
  { vise: 'A10', file: 'assets/app-main.js', find: '? armes * lancementsDuJour', replace: '? armes * getAvailabilityLaserParallelLaunches() * lancementsDuJour' },
  { vise: 'A11', file: 'assets/app-main.js', find: 'capacity: `${armes} joueurs en même temps au plus`,', replace: 'capacity: `${LASER_GAME_MAX_PLAYERS} joueurs en même temps au plus`,' },
  { vise: 'E1', file: 'assets/app-main.js', find: '+ (avecArene ? lancementsDuJour : 0)', replace: '+ lancementsDuJour' },
  { vise: 'F1', file: 'assets/admin-console.js', find: 'weaponCount && openHours ? weaponCount * openHours * 2 : 0;', replace: 'weaponCount && openHours ? weaponCount * Number(laser.parallelLaunches || 1) * openHours * 2 : 0;' },
  { vise: 'F2', file: 'assets/admin-console.js', find: "const weaponCount = connait('laser') ? Math.max(0, Number(laser.weaponCount) || 0) : LASER_GAME_MAX_PLAYERS;", replace: 'const weaponCount = Number(laser.weaponCount || LASER_GAME_MAX_PLAYERS || 0);' },
  { vise: 'F3', file: 'assets/admin-console.js', find: 'const capacity = Math.max(1, Number(laser.weaponCount) || LASER_GAME_MAX_PLAYERS || 30);', replace: 'const capacity = Math.max(1, (Number(laser.weaponCount) || 30) * Number(laser.parallelLaunches || 1));' },
  { vise: 'F4', file: 'assets/admin-console.js', find: 'const laserLaunches = new Set(', replace: 'const laserLaunches = laserWindows.length || new Set(' },
  { vise: 'D1', file: 'assets/booking-core.js', find: 'getBookingCatalogConfig()?.laserParallelLaunches', replace: 'getBookingCatalogConfig()?.laserParallelLaunchesQA' },
  { vise: 'D2', file: 'assets/app-main.js', find: '|| config.id !== attendu ||', replace: '||' },
];

const MUTATION_SERVEUR = { vise: 'S1', find: 'laserParallelLaunches: Math.max(0, Math.trunc(Number(center?.resources?.laser?.parallelLaunches) || 0)) || null,', replace: '' };

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  let rouges = 0;
  try {
    console.log('\n[base] capacites reelles du centre');
    const base = [];
    await scenarios(browser, base);
    await serveur(base);
    if (base.length) { rouges += base.length; console.log(`\n${base.length} controle(s) rouge(s) sans mutation.`); }

    // Diagnostic seulement : la base sans les contre-preuves. Le gate de la
    // suite ne pose jamais cette variable.
    if (process.env.CAPACITES_BASE_SEULE === '1') throw new Error('contre-preuves sautees (CAPACITES_BASE_SEULE)');
    console.log('\n[contre-preuves] chaque regle cassee doit rougir');
    for (const m of MUTATIONS) {
      mutation = { ...m };
      const echecs = [];
      await scenarios(browser, echecs);
      const mord = mutation.servie && !mutation.introuvable && echecs.some((label) => label.startsWith(`${m.vise} `));
      console.log(`${mord ? 'ok  ' : 'FAIL'}  mutation ${m.vise} (${m.file}) ${mord ? 'rougit' : mutation.introuvable ? 'ANCRE INTROUVABLE' : 'NE ROUGIT PAS'}${echecs.length ? ` :: ${echecs.join(' ; ')}` : ''}`);
      if (!mord) rouges += 1;
    }
    mutation = null;
    const echecsServeur = [];
    await serveur(echecsServeur, MUTATION_SERVEUR);
    const mordServeur = echecsServeur.some((label) => label.startsWith('S1 '));
    console.log(`${mordServeur ? 'ok  ' : 'FAIL'}  mutation S1 (api/public-booking-meta.js) ${mordServeur ? 'rougit' : 'NE ROUGIT PAS'}`);
    if (!mordServeur) rouges += 1;
  } catch (error) {
    console.error('\ncapacites-centre-check FAIL:', error.stack || error.message);
    rouges += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (rouges) { console.error(`\ncapacites-centre-check: ${rouges} FAIL`); process.exit(1); }
  console.log('\ncapacites-centre-check: ALL OK');
}

main();
