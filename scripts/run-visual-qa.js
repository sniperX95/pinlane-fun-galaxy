const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_QA_PORT || 4179);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH =
  process.env.E2E_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = path.join(ROOT, 'artifacts', 'qa');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');

    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function installQaApi(page) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await page.addInitScript(({ expiresAt }) => {
    const qaSession = {
      token: 'visual-qa-token',
      cookieBacked: false,
      centerId: 'libramont',
      expiresAt,
      member: { id: 'qa-owner', name: 'QA Pinlane', roleId: 'direction' },
      role: { id: 'direction', name: 'Direction', locked: true },
      permissions: [
        'dashboard.view',
        'planning.view',
        'planning.bowling',
        'planning.laser',
        'reservations.view',
        'reservations.status',
        'clients.view',
        'pricing.manage',
        'emails.view',
        'campaigns.manage',
        'marketing.agents',
        'settings.manage',
        'direction.view',
        'users.manage',
      ],
    };

    const buildReservations = (date) => ([
      {
        id: 9001,
        name: 'Anniversaire Lina Formule texte tres long #9001',
        phone: '+32470860011',
        email: 'lina@example.test',
        date,
        startTime: '14:00',
        duration: 0.5,
        lanes: [1],
        status: 'confirmed',
        pax: 6,
        price: 20,
        type: 'bowling',
        label: 'Bowling classique',
      },
      {
        id: 9002,
        name: 'Famille Lambert Bowling trente minutes #9002',
        phone: '+32470860012',
        email: 'lambert@example.test',
        date,
        startTime: '14:30',
        duration: 1,
        lanes: [2],
        status: 'arrived',
        pax: 4,
        price: 39,
        type: 'bowling',
        label: 'Bowling classique',
      },
      {
        id: 9003,
        name: 'Entreprise Ardenne Formule Premium #9003',
        phone: '+32470860013',
        email: 'ardenne@example.test',
        date,
        startTime: '15:00',
        duration: 1.5,
        lanes: [3, 5],
        status: 'paid',
        pax: 11,
        price: 308,
        type: 'formule',
        formuleId: 'formule3',
        label: 'FORMULE 3',
        plan: [
          { resourceType: 'bowling_lane', label: 'Bowling', start: '15:00', end: '16:30', lanes: [3, 5], players: 11 },
          { resourceType: 'laser_arena', label: 'Laser Game', start: '17:00', end: '17:25', players: 11, countIndex: 1 },
        ],
      },
      {
        id: 9004,
        name: 'Ecole Saint-Hubert Bowling deux heures largeur #9004',
        phone: '+32470860014',
        email: 'ecole@example.test',
        date,
        startTime: '17:00',
        duration: 2,
        lanes: [4, 6, 8],
        status: 'confirmed',
        pax: 17,
        price: 234,
        type: 'bowling',
        label: 'Bowling 2h',
      },
      {
        id: 9005,
        name: 'Team Atelier Laser #9005',
        phone: '+32470860015',
        email: 'laser@example.test',
        date,
        startTime: '16:30',
        duration: 1,
        lanes: [],
        status: 'confirmed',
        pax: 18,
        price: 180,
        type: 'laser',
        label: 'Laser x2',
        plan: [
          { resourceType: 'laser_arena', label: 'Laser Game', start: '16:30', end: '16:55', players: 18, countIndex: 1 },
          { resourceType: 'laser_arena', label: 'Laser Game', start: '18:00', end: '18:25', players: 18, countIndex: 2 },
        ],
      },
    ]);

    const buildLaneStatuses = () => Array.from({ length: 8 }).reduce((acc, _, index) => {
      acc[index + 1] = 'active';
      return acc;
    }, {});

    const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        etag: `visual-qa-${Date.now()}`,
      },
    });

    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.__PINLANE_QA_ADMIN_RANGE_CALLS__ = [];
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(rawUrl, window.location.origin);

      if (url.pathname === '/api/staff-auth') {
        // Jeu réaliste calqué sur la shape attendue par ensureStaffAccessControl
        // (roles: id/name/code/summary/description/tone/permissions/accessCode/
        // updatedAt/locked · members: id/name/contact/roleId/status/code/lastSeen).
        const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
        return jsonResponse({
          ok: true,
          authenticated: true,
          session: qaSession,
          accessControl: {
            selectedRoleId: 'manager',
            selectedMemberId: 'member-rachel',
            roles: [
              {
                id: 'direction',
                name: 'Direction',
                code: 'DI',
                summary: 'Contrôle total multi-centres',
                description: 'Pour Rachel, Seb ou un administrateur responsable du produit.',
                tone: 'admin',
                accessCode: 'FG-24-DIRQ',
                updatedAt: minutesAgo(1440),
                locked: true,
              },
              {
                id: 'manager',
                name: 'Manager',
                code: 'MA',
                summary: 'Opérations, clients et caisse',
                description: 'Pour gérer une journée complète sans toucher à la sécurité.',
                tone: 'manager',
                accessCode: 'FG-24-MGRQ',
                updatedAt: minutesAgo(320),
                permissions: [
                  'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag',
                  'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick',
                  'clients.view', 'clients.edit', 'payments.view', 'payments.markPaid', 'exports.download', 'emails.view',
                ],
              },
              {
                id: 'staff-bar',
                name: 'Staff bar',
                code: 'ST',
                summary: 'Accueil et rush terrain',
                description: 'Pour voir les arrivées, créer vite, encaisser et clôturer.',
                tone: 'staff',
                accessCode: 'FG-24-BARQ',
                updatedAt: minutesAgo(95),
                permissions: [
                  'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
                  'reservations.view', 'reservations.create', 'reservations.status', 'reservations.quick',
                  'clients.view', 'payments.view', 'payments.markPaid',
                ],
              },
              {
                id: 'marketing',
                name: 'Marketing',
                code: 'MK',
                summary: 'Campagnes et communication',
                description: 'Pour préparer les contenus, emails et audiences locales.',
                tone: 'marketing',
                accessCode: 'FG-24-MKTQ',
                updatedAt: minutesAgo(2880),
                permissions: [
                  'dashboard.view', 'clients.view', 'emails.view', 'emails.send',
                  'campaigns.manage', 'marketing.agents', 'reports.export',
                ],
              },
            ],
            members: [
              { id: 'member-rachel', name: 'Rachel Fontaine', contact: 'rachel@fungalaxy.be', roleId: 'direction', status: 'active', code: 'FG-24-RCHL', lastSeen: minutesAgo(25) },
              { id: 'member-seb', name: 'Sébastien Charlier', contact: '+32 470 55 12 34', roleId: 'manager', status: 'active', code: 'FG-24-SEBC', lastSeen: minutesAgo(180) },
              { id: 'member-noa', name: 'Noa Willems', contact: 'noa.bar@fungalaxy.be', roleId: 'staff-bar', status: 'blocked', code: 'FG-24-NOAW', lastSeen: minutesAgo(60 * 24 * 8) },
              { id: 'member-lena', name: 'Léna Dubois', contact: 'lena.mkt@fungalaxy.be', roleId: 'marketing', status: 'pending', code: 'FG-24-LENA', lastSeen: null },
              { id: 'member-max', name: 'Maxime Georis', contact: 'Badge interne 07', roleId: 'staff-bar', status: 'active', code: 'FG-24-MAXG', lastSeen: minutesAgo(12) },
            ],
            events: [
              { id: 1, label: 'Code du rôle Manager régénéré', at: minutesAgo(45) },
              { id: 2, label: 'Accès de Noa Willems bloqué', at: minutesAgo(60 * 26) },
              { id: 3, label: 'Léna Dubois invitée sur Marketing', at: minutesAgo(60 * 30) },
            ],
            permissions: qaSession.permissions,
          },
        });
      }

      if (url.pathname === '/api/staff-state') {
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        return jsonResponse({
          ok: true,
          revision: `visual-qa-${date}`,
          reservations: buildReservations(date),
          laneStatuses: buildLaneStatuses(),
          centerId: 'libramont',
        });
      }

      if (url.pathname === '/api/public-availability') {
        const availabilityType = url.searchParams.get('type');
        if (availabilityType !== 'formule') return jsonResponse({ ok: true, slots: [] });
        window.__PINLANE_QA_AVAILABILITY_CALLS__ = window.__PINLANE_QA_AVAILABILITY_CALLS__ || [];
        window.__PINLANE_QA_AVAILABILITY_CALLS__.push(url.search);
        const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
        const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const formuleId = url.searchParams.get('formuleId');

        // FORMULE 7 (table + pass, aucune ancre) : chips = heures d'arrivée,
        // table bloquée de l'arrivée à la fin de visite.
        if (formuleId === 'f7') {
          const slots = ['14:00', '14:30', '15:00'].map((time) => {
            const start = toMin(time);
            const arrival = toTime(start - 10);
            const end = toTime(start + 150);
            return {
              time,
              lanes: [],
              freeCount: 6,
              opsPlan: {
                startTime: time,
                endTime: end,
                totalMinutes: 150,
                arrivalTime: arrival,
                arrivalMinutes: 10,
                bufferMinutes: 0,
                risk: { level: 'low', score: 15, reasons: [] },
                staffSummary: '',
                assignedLanes: [],
                timeline: [
                  { type: 'service', label: 'Arrivée & accueil', resourceType: 'bar_service', startTime: arrival, endTime: time },
                  { type: 'activity', activityId: 'party_table', label: 'Table anniversaire', resourceType: 'party_table', followsArrival: true, startTime: arrival, endTime: end, tableNeed: 1 },
                  { type: 'activity', activityId: 'playground', label: 'Playground', resourceType: 'soft_capacity', flexible: true, startTime: time, endTime: end },
                  { type: 'activity', activityId: 'minigolf_blacklight', label: 'Minigolf Blacklight', resourceType: 'soft_capacity', flexible: true, startTime: time, endTime: end },
                ],
                resourceBlocks: [
                  { resourceType: 'party_table', activityId: 'party_table', label: 'Table anniversaire', followsArrival: true, startTime: arrival, endTime: end, tableNeed: 1 },
                ],
                anchorPlan: null,
                laserPassPlan: null,
                customerCommitment: [],
              },
            };
          });
          return jsonResponse({
            ok: true,
            slots,
            laneCount: 0,
            duration: 2,
            totalDuration: 2.5,
            price: 24,
            requiresLanes: false,
            label: 'FORMULE 7',
            anchors: {
              ok: true,
              arrivalLeadMinutes: 10,
              hasTable: true,
              freePass: [
                { activityId: 'playground', label: 'Plaine de jeux' },
                { activityId: 'minigolf_blacklight', label: 'Mini Golf' },
                { activityId: 'arcade_time', label: 'Arcades' },
              ],
              drinks: ['2 cruches boissons'],
              laserGames: 0,
              laserOnSiteAvailable: false,
              activities: [],
              defaultTimes: null,
            },
            suggestions: [],
            message: '',
          });
        }

        // FORMULE 1 (ancres bowling + laser) : dispo PAR ANCRE + revalidation
        // de la combinaison choisie, refus + suggestions si chevauchement.
        let preferred = {};
        try { preferred = JSON.parse(url.searchParams.get('preferredTimes') || '{}') || {}; } catch (error) { preferred = {}; }
        const laserPlacement = url.searchParams.get('laserPlacement') === 'onsite' ? 'onsite' : 'scheduled';
        const anchors = {
          ok: true,
          arrivalLeadMinutes: 10,
          hasTable: false,
          freePass: [{ activityId: 'arcade_time', label: 'Arcades' }],
          drinks: ['2 cruches boissons'],
          laserGames: 1,
          laserOnSiteAvailable: true,
          activities: [
            { activityId: 'bowling', label: 'Bowling', count: 1, durationMinutes: 60, times: ['14:30', '15:00', '15:30', '16:00', '17:00'].map((time) => ({ time, lanes: [1, 2] })) },
            { activityId: 'laser_game', label: 'Laser Game', count: 1, durationMinutes: 25, times: ['15:30', '16:00', '16:30', '17:00', '17:30'].map((time) => ({ time, remainingPlaces: 22 })) },
          ],
          defaultTimes: { bowling: '15:00', laser_game: '16:30' },
        };
        const bowling = preferred.bowling || '15:00';
        const laser = laserPlacement === 'onsite' ? '' : (preferred.laser_game || '16:30');
        const overlaps = laser && toMin(laser) < toMin(bowling) + 65 && toMin(laser) + 30 > toMin(bowling);
        if (overlaps) {
          const fallbackLaser = toTime(toMin(bowling) + 90);
          return jsonResponse({
            ok: true,
            slots: [],
            laneCount: 2,
            duration: 1,
            totalDuration: 2.5,
            price: 208,
            requiresLanes: true,
            label: 'FORMULE 1',
            anchors,
            message: `Bowling (${bowling}) et Laser Game (${laser}) se chevauchent : décalez l'une des deux heures.`,
            suggestions: [
              { times: { bowling, laser_game: fallbackLaser }, label: `Bowling ${bowling} · Laser Game ${fallbackLaser}` },
            ],
          });
        }
        const firstStart = laser && toMin(laser) < toMin(bowling) ? laser : bowling;
        const arrival = toTime(toMin(firstStart) - 10);
        const lastEnd = Math.max(toMin(bowling) + 60, laser ? toMin(laser) + 25 : 0);
        const visitEnd = toTime(Math.max(lastEnd, toMin(firstStart) + 145));
        const anchorTimes = laser ? { bowling, laser_game: laser } : { bowling };
        const slot = {
          time: firstStart,
          lanes: [1, 2],
          freeCount: 6,
          opsPlan: {
            startTime: firstStart,
            endTime: visitEnd,
            totalMinutes: toMin(visitEnd) - toMin(firstStart),
            arrivalTime: arrival,
            arrivalMinutes: 10,
            bufferMinutes: 0,
            risk: { level: 'low', score: 15, reasons: [] },
            staffSummary: `Bowling ${bowling} | ${laser ? `Laser ${laser}` : 'Laser sur place'}`,
            assignedLanes: [1, 2],
            timeline: [
              { type: 'service', label: 'Arrivée & accueil', resourceType: 'bar_service', startTime: arrival, endTime: firstStart },
              { type: 'activity', activityId: 'bowling', label: 'Bowling', resourceType: 'bowling_lane', critical: true, startTime: bowling, endTime: toTime(toMin(bowling) + 60), lanes: [1, 2] },
              ...(laser ? [{ type: 'activity', activityId: 'laser_game', label: 'Laser Game', resourceType: 'laser_arena', critical: true, startTime: laser, endTime: toTime(toMin(laser) + 25), players: 8, countIndex: 1 }] : []),
              { type: 'activity', activityId: 'arcade_time', label: 'Arcades', resourceType: 'bar_service_then_autonomous', flexible: true, startTime: firstStart, endTime: visitEnd },
            ],
            resourceBlocks: [
              { resourceType: 'bowling_lane', activityId: 'bowling', label: 'Bowling', startTime: bowling, endTime: toTime(toMin(bowling) + 60), lanes: [1, 2], requiredLanes: 2 },
              ...(laser ? [{ resourceType: 'laser_arena', activityId: 'laser_game', label: 'Laser Game', startTime: laser, endTime: toTime(toMin(laser) + 25), players: 8, countIndex: 1 }] : []),
            ],
            firstBowlingTime: bowling,
            firstLaserTime: laser || '',
            anchorPlan: { mode: 'anchors_freedom', laserPlacement, times: anchorTimes },
            laserPassPlan: laser ? null : { mode: 'all_on_site', totalGames: 1, scheduledGames: 0, remainingGames: 1, scheduledPasses: [], pendingPasses: [{ countIndex: 1, status: 'pending' }] },
            laserSharing: laser ? { mayShare: true, sharedNow: false } : null,
            customerCommitment: [],
          },
        };
        return jsonResponse({
          ok: true,
          slots: [slot],
          laneCount: 2,
          duration: 1,
          totalDuration: 2.5,
          price: 208,
          requiresLanes: true,
          label: 'FORMULE 1',
          anchors,
          suggestions: [],
          message: '',
        });
      }

      if (url.pathname === '/api/public-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__PINLANE_QA_PUBLIC_POSTS__ = window.__PINLANE_QA_PUBLIC_POSTS__ || [];
        window.__PINLANE_QA_PUBLIC_POSTS__.push(body);
        return jsonResponse({
          ok: true,
          reservation: { ...body, id: 9991, lanes: body.lanes && body.lanes.length ? body.lanes : [1, 2] },
          ops: { riskLevel: 'low', riskScore: 15, validationStatus: 'confirmed', planWarning: null, autoDecision: 'auto_confirmed' },
          communications: [],
          warnings: [],
        });
      }

      if (url.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__PINLANE_QA_RES_POSTS__ = window.__PINLANE_QA_RES_POSTS__ || [];
        window.__PINLANE_QA_RES_POSTS__.push(body);
        return jsonResponse({ ok: true, reservation: { ...body, id: 9990 } });
      }

      if (url.pathname === '/api/public-booking-meta') {
        return jsonResponse({
          ok: true,
          today: new Date().toISOString().slice(0, 10),
          durationOptions: [],
          formules: [],
          center: {
            id: 'libramont',
            status: 'active',
            defaultSchedule: {
              regular: { '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } },
              holiday: { '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } },
            },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
            offerAvailability: {},
          },
        });
      }

      if (url.pathname === '/api/ops') {
        const opsAction = url.searchParams.get('action');
        if (opsAction === 'centerConfig') {
          const mkCenter = (id, name, status, laneCount, weaponCount, launches) => ({
            id, name, status, timezone: 'Europe/Brussels',
            resources: {
              bowling: { laneCount, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
              laser: { weaponCount, parallelLaunches: launches, canSplitGroupsCleanly: launches > 1, requiresCompleteGroupBeforeLaunch: launches === 1, riskLevel: 'managed' },
            },
            defaultSchedule: {
              regular: { '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } },
              holiday: { '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' }, '0': { open: '10:00', close: '22:00' } },
            },
            holidaySettings: {
              enabled: true,
              overrides: [{ date: '2026-09-14', mode: 'holiday' }],
              formulaBlockedPeriods: ['public', 'school_short', 'manual'],
            },
            offerAvailability: { f6: false },
            activityAvailability: { bowling: true, laser_game: true, minigolf_blacklight: true, golf_oclock: status !== 'active', arcade_time: true, playground: true },
          });
          return jsonResponse({
            ok: true,
            centers: [
              mkCenter('libramont', 'Fun Galaxy Libramont', 'active', 8, 30, 1),
              mkCenter('gembloux', 'Fun Galaxy Gembloux', 'active', 8, 30, 3),
              mkCenter('ciney', 'Fun Galaxy Ciney', 'planned', 8, 30, 1),
            ],
            activities: [
              { id: 'bowling', label: 'Bowling' }, { id: 'laser_game', label: 'Laser Game' },
              { id: 'minigolf_blacklight', label: 'Minigolf Blacklight' }, { id: 'golf_oclock', label: "Golf o'Clock" },
              { id: 'arcade_time', label: 'Arcade' }, { id: 'playground', label: 'Plaine de jeux' },
            ],
          });
        }
        return jsonResponse({
          ok: true,
          communications: [],
          samples: [],
          suggestions: [],
          events: [],
          ecosystem: null,
          agents: [],
          activations: [],
          orchestration: {},
        });
      }

      if (url.pathname === '/api/simulation') {
        return jsonResponse({ ok: true, run: null, communications: [], stats: {}, logs: [] });
      }

      if (url.pathname === '/api/admin-range') {
        window.__PINLANE_QA_ADMIN_RANGE_CALLS__.push(url.href);
        const rangeDate = url.searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
        return jsonResponse({
          ok: true,
          reservations: buildReservations(rangeDate),
          emails: [],
          agentEvents: [],
          centerId: url.searchParams.get('centerId') || 'libramont',
        });
      }

      return nativeFetch(input, init);
    };

    window.__PINLANE_QA_RESERVATIONS__ = buildReservations;
    window.__PINLANE_QA_LANES__ = buildLaneStatuses;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

async function waitForApp(page) {
  await page.goto(`${BASE_URL}/?v=visual-qa-${Date.now()}`, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
}

async function seedStressDay(page) {
  await page.evaluate(() => {
    const d = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const reservations = typeof window.__PINLANE_QA_RESERVATIONS__ === 'function'
      ? window.__PINLANE_QA_RESERVATIONS__(d)
      : [];

    state.currentDate = d;
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'bowling';
    state.staffTheme = 'dark';
    state.reservations = reservations;
    state.laneStatuses = typeof window.__PINLANE_QA_LANES__ === 'function'
      ? window.__PINLANE_QA_LANES__()
      : {};

    save();
    setView('staff');
    renderStaff();
  });
}

async function collectIssues(page, scopeLabel) {
  return page.evaluate((label) => {
    const viewportWidth = document.documentElement.clientWidth;
    const bodyOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
    const issues = [];

    if (bodyOverflowX > 2) {
      issues.push({ label, type: 'body-horizontal-overflow', value: bodyOverflowX });
    }

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const watched = [
      '.booking',
      '.staff-resource-tab',
      '.lane-header',
      '.clients-table-row',
      '.client-profile-panel',
      '.auth-card',
      '.reservations-calendar',
      '.reservations-day',
      '.events-workspace',
      '.event-row',
      '.events-now-card',
      '.events-day-digest',
      '.dash-kpi',
      '.dash-card',
      '.dash-status-strip',
      '.groups-page',
      '.groups-toolbar-card',
      '.groups-selected-card',
      '.groups-ledger-row',
      '.groups-side-card',
      '.admin-shell',
      '.admin-hero',
      '.admin-center-card',
      '.admin-kpi',
      '.admin-panel',
      '.admin-table-wrap',
      '.admin-insight',
      '.admin-health-card',
      '.ops-row',
      '.ops-stat',
      '.ops-review-item',
      '.ops-review-alt',
      '.ops-sim-profile',
      '.ops-sim-command-link',
      '.ops-sim-comm-row',
      '.ops-sim-card',
      '.ai-live-agent',
      '.ai-problem-card',
      '.staff-role-pill',
      '.staff-member-card',
      '.staff-code-card',
      '.staff-access-summary',
      '.establishment-read-card',
    ].join(',');

    document.querySelectorAll(watched).forEach((el) => {
      if (!visible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.left < -1 || rect.right > viewportWidth + 1) {
        issues.push({
          label,
          type: 'element-horizontal-overflow',
          selector: String(el.className),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth,
        });
      }
      if (el.scrollHeight > el.clientHeight + 4 && !el.classList.contains('clients-table-row')) {
        issues.push({
          label,
          type: 'element-vertical-clipped',
          selector: String(el.className),
          text: el.textContent.trim().slice(0, 100),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        });
      }
    });

    document.querySelectorAll('.booking-name, .booking-meta, .b-tag, .client-cell strong, .client-cell small').forEach((el) => {
      if (!visible(el)) return;
      if (el.scrollHeight > el.clientHeight + 3) {
        issues.push({
          label,
          type: 'text-vertical-clipped',
          selector: String(el.className),
          text: el.textContent.trim().slice(0, 90),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
        });
      }
    });

    return issues;
  }, scopeLabel);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function renderStaffPage(page, pageName) {
  await page.evaluate((target) => {
    state.staffMenuPage = target;
    save();
    renderStaff();
    if (typeof syncOpsSidebar === 'function') syncOpsSidebar();
  }, pageName);
  await page.waitForTimeout(700);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  const issues = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await installQaApi(page);
    await waitForApp(page);
    await seedStressDay(page);
    await page.locator('#staffView:not(.hidden)').waitFor({ timeout: 10000 });

    const lockedOverlayCount = await page.locator('#authOverlay:not(.hidden)').count();
    assert(!lockedOverlayCount, 'QA locale bloquee sur l ecran de connexion staff.');

    await page.waitForTimeout(700);

    await renderStaffPage(page, 'dashboard');
    await screenshot(page, 'staff-dashboard-reference');
    issues.push(...await collectIssues(page, 'staff-dashboard'));

    await renderStaffPage(page, 'planning');
    await page.waitForTimeout(700);
    await screenshot(page, 'staff-planning-stress');
    issues.push(...await collectIssues(page, 'staff-planning'));

    await renderStaffPage(page, 'clients');
    await screenshot(page, 'staff-clients-stress');
    issues.push(...await collectIssues(page, 'staff-clients'));

    await renderStaffPage(page, 'groups');
    await screenshot(page, 'staff-groups-stress');
    issues.push(...await collectIssues(page, 'staff-groups'));

    await renderStaffPage(page, 'reservations');
    await screenshot(page, 'staff-reservations-stress');
    issues.push(...await collectIssues(page, 'staff-reservations'));

    await renderStaffPage(page, 'emails');
    await screenshot(page, 'staff-emails-stress');
    issues.push(...await collectIssues(page, 'staff-emails'));

    await renderStaffPage(page, 'campaigns');
    await screenshot(page, 'staff-campaigns-stress');
    issues.push(...await collectIssues(page, 'staff-campaigns'));

    await renderStaffPage(page, 'prices');
    await screenshot(page, 'staff-pricing-stress');
    issues.push(...await collectIssues(page, 'staff-pricing'));

    await renderStaffPage(page, 'establishment');
    await page.waitForTimeout(500);
    await screenshot(page, 'staff-establishment');
    issues.push(...await collectIssues(page, 'staff-establishment'));
    // Mode édition (clic sur Modifier)
    const editBtn = page.locator('.establishment-editor-actions button', { hasText: 'Modifier' });
    if (await editBtn.count()) {
      await editBtn.first().click();
      await page.waitForTimeout(300);
      await screenshot(page, 'staff-establishment-edit');
      issues.push(...await collectIssues(page, 'staff-establishment-edit'));
      // Retour vue lecture pour que la passe light capture la vue par défaut
      const cancelBtn = page.locator('.establishment-editor-actions button', { hasText: 'Annuler' });
      if (await cancelBtn.count()) {
        await cancelBtn.first().click();
        await page.waitForTimeout(250);
      }
    }

    // Équipe & accès (page users) : rail rôles / éditeur permissions / panneau membres
    await renderStaffPage(page, 'users');
    await page.waitForTimeout(400);
    await screenshot(page, 'staff-users');
    issues.push(...await collectIssues(page, 'staff-users'));

    // Modale « Créer rôle » : ouverture, capture, fermeture Escape
    await page.locator('.utility-actions button', { hasText: 'Créer rôle' }).first().click();
    await page.locator('#staffAccessModalOverlay').waitFor({ timeout: 5000 });
    await screenshot(page, 'staff-users-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const modalStillOpen = await page.locator('#staffAccessModalOverlay').count();
    assert(!modalStillOpen, 'La modale de création d accès doit se fermer avec Escape.');

    // Passe thème clair sur les écrans clés (le système v2 est bi-thème)
    await page.evaluate(() => setStaffTheme('light'));
    await page.waitForTimeout(400);
    for (const lightPage of ['dashboard', 'planning', 'reservations', 'clients', 'users', 'establishment']) {
      await renderStaffPage(page, lightPage);
      await screenshot(page, `staff-${lightPage}-light`);
      issues.push(...await collectIssues(page, `staff-${lightPage}-light`));
    }
    await page.evaluate(() => setStaffTheme('dark'));
    await page.waitForTimeout(400);

    const adminRangeBeforeEvents = await page.evaluate(() => (
      Array.isArray(window.__PINLANE_QA_ADMIN_RANGE_CALLS__)
        ? window.__PINLANE_QA_ADMIN_RANGE_CALLS__.length
        : 0
    ));
    await renderStaffPage(page, 'events');
    await screenshot(page, 'staff-events-stress');
    issues.push(...await collectIssues(page, 'staff-events'));
    const adminRangeAfterEvents = await page.evaluate(() => (
      Array.isArray(window.__PINLANE_QA_ADMIN_RANGE_CALLS__)
        ? window.__PINLANE_QA_ADMIN_RANGE_CALLS__.length
        : 0
    ));
    assert(
      adminRangeAfterEvents === adminRangeBeforeEvents,
      'La page Evenements ne doit pas declencher /api/admin-range.'
    );

    // Vue Direction (console CEO) — overview + chaque onglet + sous-onglets ops.
    // Le mock renvoie peu de données admin : on valide surtout la structure
    // (pas d'overflow, pas de texte qui se chevauche) sur Mails & agents / Simulation.
    await page.evaluate(() => setView('admin'));
    await page.locator('#adminView:not(.hidden)').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await screenshot(page, 'direction-overview');
    issues.push(...await collectIssues(page, 'direction-overview'));

    for (const adminTab of ['overview', 'reservations', 'clients', 'ops', 'exports']) {
      await page.evaluate((tab) => setAdminTab(tab), adminTab);
      await page.waitForTimeout(650);
      await screenshot(page, `direction-${adminTab}`);
      issues.push(...await collectIssues(page, `direction-${adminTab}`));
    }

    // Sous-onglets du panneau ops (le drame historique se concentre ici)
    await page.evaluate(() => setAdminTab('ops'));
    await page.waitForTimeout(500);
    for (const opsTab of ['communications', 'samples', 'suggestions', 'stack', 'events', 'simulation']) {
      await page.evaluate((tab) => setOpsTab(tab), opsTab);
      await page.waitForTimeout(750);
      await screenshot(page, `direction-ops-${opsTab}`);
      issues.push(...await collectIssues(page, `direction-ops-${opsTab}`));
    }

    // Retour console staff pour la suite du parcours QA
    await page.evaluate(() => setView('staff'));
    await page.waitForTimeout(500);

    // Navigation staff → client via le popover du compte (regression: on doit
    // toujours pouvoir quitter la console pour revenir au site de réservation).
    await renderStaffPage(page, 'dashboard');
    await page.locator('[data-fgx-account-menu]').first().click();
    await page.waitForTimeout(250);
    await page.locator('[data-fgx-menu-action="client"]').first().click();
    await page.waitForTimeout(400);
    const backToClient = await page.locator('#clientView:not(.hidden)').count();
    assert(backToClient === 1, 'Le popover compte staff doit permettre de revenir à l espace client.');

    // Vue client (desktop) — parcours de réservation
    await page.evaluate(() => setView('client'));
    await page.waitForTimeout(700);
    await screenshot(page, 'client-booking-desktop');
    issues.push(...await collectIssues(page, 'client-booking-desktop'));

    // ------------------------------------------------------------------
    // Chantier 1 — icônes du popover compte staff visibles (dark + light)
    // ------------------------------------------------------------------
    await page.evaluate(() => setView('staff'));
    await renderStaffPage(page, 'dashboard');
    await page.locator('[data-fgx-account-menu]').first().click();
    await page.waitForTimeout(300);
    await screenshot(page, 'chantier1-account-menu-dark');
    const accountIconStyle = await page.evaluate(() => {
      const svg = document.querySelector('.fgx-menu-option-icon svg');
      if (!svg) return null;
      const style = window.getComputedStyle(svg);
      return { fill: style.fill, stroke: style.stroke };
    });
    assert(accountIconStyle, 'Le popover compte doit contenir des icônes SVG.');
    assert(accountIconStyle.fill === 'none', `Icônes popover compte : fill doit être none (reçu ${accountIconStyle && accountIconStyle.fill}).`);
    assert(accountIconStyle.stroke && accountIconStyle.stroke !== 'none', 'Icônes popover compte : stroke currentColor requis.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => setStaffTheme('light'));
    await page.waitForTimeout(300);
    await page.locator('[data-fgx-account-menu]').first().click();
    await page.waitForTimeout(300);
    await screenshot(page, 'chantier1-account-menu-light');
    await page.keyboard.press('Escape');
    await page.evaluate(() => setStaffTheme('dark'));
    await page.waitForTimeout(200);

    // ------------------------------------------------------------------
    // Chantier 2 — champ date client : une seule icône calendrier
    // ------------------------------------------------------------------
    await page.evaluate(() => setView('client'));
    await page.waitForTimeout(500);
    // getComputedStyle ne reflète pas ce pseudo-élément UA : on prouve le
    // masquage par diff de rendu avec un clone hors .date-input-wrap (où la
    // règle ne s'applique pas, donc indicateur natif visible).
    const withRuleShot = await page.locator('#fDate').screenshot();
    await page.evaluate(() => {
      const source = document.getElementById('fDate');
      const rect = source.getBoundingClientRect();
      const clone = source.cloneNode();
      clone.id = 'fDateNativeProbe';
      clone.style.cssText = `position:fixed;top:8px;left:8px;z-index:99999;width:${rect.width}px;height:${rect.height}px;`;
      document.body.appendChild(clone);
    });
    const withoutRuleShot = await page.locator('#fDateNativeProbe').screenshot();
    await page.evaluate(() => document.getElementById('fDateNativeProbe').remove());
    assert(!withRuleShot.equals(withoutRuleShot), 'L indicateur calendrier natif doit être masqué dans .date-input-wrap (rendu identique au clone non stylé).');
    await page.locator('.date-input-wrap').first().screenshot({ path: path.join(OUT_DIR, 'chantier2-date-field.png') });

    // ------------------------------------------------------------------
    // Chantier 3 — section formules compacte + règle vacances par période
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      setType('formule');
      state.booking.pax = 8;
      document.getElementById('fPax').value = 8;
      renderFormules();
    });
    await page.waitForTimeout(300);
    const offerHidden = await page.evaluate(() => !document.querySelector('#estab-offer-f6') && !Array.from(document.querySelectorAll('#formuleGrid .formule-name')).some(el => el.textContent.includes('FORMULE 6')));
    assert(offerHidden, 'Une offre désactivée par le staff (f6) doit disparaître de l espace client.');
    await screenshot(page, 'chantier3-formules-normal');
    issues.push(...await collectIssues(page, 'chantier3-formules'));
    // Date pendant le congé d'automne : bannière famille + cartes désactivées
    await page.evaluate(() => {
      state.booking.date = '2026-10-26';
      document.getElementById('fDate').value = '2026-10-26';
      updateSchedHint();
      renderFormules();
    });
    await page.waitForTimeout(250);
    const autumnState = await page.evaluate(() => ({
      groupAlert: Boolean(document.querySelector('.formule-group-alert')),
      f1Disabled: Array.from(document.querySelectorAll('#formuleGrid .formule-card')).some(row => row.textContent.includes('FORMULE 1') && row.classList.contains('disabled')),
      repeatedNote: Array.from(document.querySelectorAll('#formuleGrid .formule-card')).filter(row => row.textContent.includes('Non valable durant')).length,
    }));
    assert(autumnState.groupAlert, 'Congé d automne : la bannière famille vacances/férié doit apparaître.');
    assert(autumnState.f1Disabled, 'Congé d automne : les formules anniversaires doivent être désactivées.');
    assert(autumnState.repeatedNote === 0, 'La mention vacances ne doit plus être répétée sur chaque carte.');
    await screenshot(page, 'chantier3-formules-autumn-blocked');
    // Date pendant les grandes vacances : formules anniversaires accessibles
    await page.evaluate(() => {
      state.booking.date = '2026-07-15';
      document.getElementById('fDate').value = '2026-07-15';
      updateSchedHint();
      renderFormules();
    });
    await page.waitForTimeout(250);
    const summerState = await page.evaluate(() => ({
      groupAlert: Boolean(document.querySelector('.formule-group-alert')),
      f1Enabled: Array.from(document.querySelectorAll('#formuleGrid .formule-card')).some(row => row.textContent.includes('FORMULE 1') && !row.classList.contains('disabled')),
      schedHint: document.getElementById('schedHint').textContent,
    }));
    assert(!summerState.groupAlert, 'Grandes vacances : pas de blocage des formules anniversaires.');
    assert(summerState.f1Enabled, 'Grandes vacances : FORMULE 1 doit rester réservable.');
    assert(/Vacances d'ete|Ouvert/.test(summerState.schedHint), 'Le hint horaires doit refléter la période.');
    await screenshot(page, 'chantier3-formules-summer-open');

    // ------------------------------------------------------------------
    // Chantier 4 — état de chargement/vide des créneaux
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      goStep(2);
      slotLoading = true;
      state.availableSlots = [];
      renderSlots(null);
    });
    await page.waitForTimeout(250);
    const loadingState = await page.evaluate(() => ({
      spinner: Boolean(document.querySelector('#slotList .slot-spinner')),
      skeleton: document.querySelectorAll('#slotList .slot-skeleton').length,
      bigClock: Boolean(document.querySelector('#slotList svg[width="40"]')),
    }));
    assert(loadingState.spinner, 'État loading créneaux : spinner requis.');
    assert(loadingState.skeleton >= 4, 'État loading créneaux : grille squelette requise.');
    assert(!loadingState.bigClock, 'La grosse horloge flottante ne doit plus exister.');
    await screenshot(page, 'chantier4-slots-loading');
    await page.evaluate(() => {
      slotLoading = false;
      state.availableSlots = [];
      renderSlots(null);
    });
    await page.waitForTimeout(200);
    const emptyState = await page.evaluate(() => Boolean(document.querySelector('#slotList .slot-state-empty')));
    assert(emptyState, 'État vide créneaux : message structuré requis.');
    await screenshot(page, 'chantier4-slots-empty');
    await page.evaluate(() => goStep(1));

    // ------------------------------------------------------------------
    // Picker formule « Ancres + Liberté » — chips par ancre (:00/:30), défaut
    // valide pré-sélectionné, revalidation à chaque modification, refus +
    // suggestions, pass liberté SANS heure, payload de réservation correct.
    // ------------------------------------------------------------------
    const nextSaturdayIso = await page.evaluate(() => {
      const target = new Date();
      target.setDate(target.getDate() + ((6 - target.getDay() + 7) % 7 || 7));
      return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    });
    await page.evaluate(async (iso) => {
      window.__PINLANE_QA_AVAILABILITY_CALLS__ = [];
      window.__PINLANE_QA_PUBLIC_POSTS__ = [];
      state.booking.type = 'formule';
      state.booking.formuleId = 'f1';
      state.booking.pax = 8;
      state.booking.date = iso;
      state.booking.preference = createDefaultFormulaPreference();
      goStep(2);
      await fetchSlots({ showLoading: false });
    }, nextSaturdayIso);
    await page.waitForTimeout(300);

    // 1) Chips par ancre, toutes :00/:30, une ligne par ancre.
    const anchorPickerState = await page.evaluate(() => ({
      rows: Array.from(document.querySelectorAll('.anchor-row')).map(row => ({
        anchor: row.dataset.anchor,
        label: row.querySelector('.anchor-row-head strong')?.textContent.trim() || '',
        chips: Array.from(row.querySelectorAll('.anchor-chip')).map(el => el.textContent.trim()),
        active: Array.from(row.querySelectorAll('.anchor-chip.active')).map(el => el.textContent.trim()),
      })),
      summary: document.querySelector('.formula-visit-summary')?.textContent.replace(/\s+/g, ' ') || '',
      confirm: Boolean(document.querySelector('.formula-plan-confirm')),
      passText: document.querySelector('.anchor-free-pass')?.textContent.replace(/\s+/g, ' ') || '',
      head: document.querySelector('.formula-arrival-head')?.textContent || '',
    }));
    assert(anchorPickerState.rows.length === 2, `Picker ancres : une ligne par ancre attendue (reçu ${anchorPickerState.rows.length}).`);
    assert(anchorPickerState.rows[0].anchor === 'bowling' && anchorPickerState.rows[1].anchor === 'laser_game', 'Picker ancres : lignes Bowling puis Laser attendues.');
    anchorPickerState.rows.forEach((row) => {
      assert(row.chips.length >= 4, `Ancre ${row.anchor} : plusieurs chips d heures attendues.`);
      assert(row.chips.every(chip => /^\d{2}:(00|30)$/.test(chip)), `Ancre ${row.anchor} : toutes les chips doivent être :00/:30 (reçu ${row.chips.join(', ')}).`);
    });
    // 2) Défaut pré-sélectionné valide (zéro friction).
    assert(anchorPickerState.rows[0].active[0] === '15:00' && anchorPickerState.rows[1].active[0] === '16:30', `Picker ancres : la combinaison par défaut doit être pré-sélectionnée (reçu ${JSON.stringify(anchorPickerState.rows.map(r => r.active))}).`);
    assert(/Vos rendez-vous/.test(anchorPickerState.summary) && /Bowling 15:00/.test(anchorPickerState.summary) && /Laser Game 16:30/.test(anchorPickerState.summary), 'Picker ancres : le résumé doit afficher les rendez-vous par ancre.');
    assert(/14:50/.test(anchorPickerState.summary), 'Picker ancres : arrivée 10 min avant la première ancre (14:50).');
    assert(anchorPickerState.confirm, 'Picker ancres : bouton de validation requis quand la combinaison est valide.');
    // 5) Pass liberté visible, rassurant, sans AUCUNE heure.
    assert(/Pass liberté/.test(anchorPickerState.passText) && /à votre rythme/i.test(anchorPickerState.passText), 'Pass liberté : bloc distinct requis.');
    assert(/Arcades/.test(anchorPickerState.passText), 'Pass liberté : les activités libres doivent être listées.');
    assert(!/\d{1,2}:\d{2}/.test(anchorPickerState.passText), 'Pass liberté : aucune heure ne doit apparaître.');
    await screenshot(page, 'formula-anchors-desktop');
    issues.push(...await collectIssues(page, 'formula-anchors-desktop'));

    // 3) Modifier une ancre revalide la combinaison côté serveur.
    const callsBeforeChange = await page.evaluate(() => window.__PINLANE_QA_AVAILABILITY_CALLS__.length);
    await page.evaluate(() => setFormulaAnchorTime('laser_game', '17:30'));
    await page.waitForTimeout(350);
    const afterChange = await page.evaluate(() => ({
      calls: window.__PINLANE_QA_AVAILABILITY_CALLS__.length,
      lastCall: decodeURIComponent(window.__PINLANE_QA_AVAILABILITY_CALLS__[window.__PINLANE_QA_AVAILABILITY_CALLS__.length - 1] || ''),
      summary: document.querySelector('.formula-visit-summary')?.textContent.replace(/\s+/g, ' ') || '',
    }));
    assert(afterChange.calls > callsBeforeChange, 'Changer une ancre doit déclencher une revalidation serveur.');
    assert(/laser_game":"17:30/.test(afterChange.lastCall), `La revalidation doit porter la nouvelle heure laser (reçu ${afterChange.lastCall}).`);
    assert(/Laser Game 17:30/.test(afterChange.summary) && /Bowling 15:00/.test(afterChange.summary), 'Le résumé doit refléter la combinaison revalidée.');

    // 4) Combinaison impossible → message clair + suggestions proches.
    await page.evaluate(() => setFormulaAnchorTime('laser_game', '15:30'));
    await page.waitForTimeout(350);
    const invalidState = await page.evaluate(() => ({
      error: document.querySelector('.anchor-status-error')?.textContent.replace(/\s+/g, ' ') || '',
      suggestions: Array.from(document.querySelectorAll('.anchor-suggestion')).map(el => el.textContent.trim()),
      confirm: Boolean(document.querySelector('.formula-plan-confirm')),
    }));
    assert(/chevauchent/i.test(invalidState.error), 'Combinaison impossible : message clair requis.');
    assert(invalidState.suggestions.length >= 1, 'Combinaison impossible : suggestions proches requises.');
    assert(!invalidState.confirm, 'Combinaison impossible : pas de bouton de validation.');
    await screenshot(page, 'formula-anchors-invalid');
    issues.push(...await collectIssues(page, 'formula-anchors-invalid'));
    await page.evaluate(() => applyFormulaAnchorSuggestion(0));
    await page.waitForTimeout(350);
    const afterSuggestion = await page.evaluate(() => ({
      summary: document.querySelector('.formula-visit-summary')?.textContent.replace(/\s+/g, ' ') || '',
      error: Boolean(document.querySelector('.anchor-status-error')),
    }));
    assert(!afterSuggestion.error && /Bowling 15:00/.test(afterSuggestion.summary), 'Une suggestion appliquée doit redonner une combinaison valide.');

    // Option « Je place mes parties laser sur place ».
    await page.evaluate(() => setFormulaLaserPlacement('onsite'));
    await page.waitForTimeout(350);
    const onSiteState = await page.evaluate(() => ({
      laserDisabled: Array.from(document.querySelectorAll('.anchor-row[data-anchor="laser_game"] .anchor-chip')).every(el => el.disabled),
      summary: document.querySelector('.formula-visit-summary')?.textContent.replace(/\s+/g, ' ') || '',
      toggle: Boolean(document.querySelector('.anchor-onsite input:checked')),
    }));
    assert(onSiteState.toggle && onSiteState.laserDisabled, 'Option laser sur place : chips laser désactivées, toggle actif.');
    assert(!/Laser Game \d{2}:\d{2}/.test(onSiteState.summary), 'Option laser sur place : plus aucun rendez-vous laser fixé.');
    assert(/à placer sur place/i.test(onSiteState.summary), 'Option laser sur place : le crédit laser doit être annoncé.');
    await screenshot(page, 'formula-anchors-onsite');
    await page.evaluate(() => setFormulaLaserPlacement('scheduled'));
    await page.waitForTimeout(350);

    // 6) Payload final : blocs bowling/laser aux heures choisies + préférence
    //    d'ancres transmise au serveur (revalidation POST).
    await page.evaluate(async () => {
      await setFormulaAnchorTime('laser_game', '17:00');
    });
    await page.waitForTimeout(350);
    await page.evaluate(async () => {
      const index = getCurrentFormulaAnchorSlotIndex();
      selectSlot(index);
      state.booking.name = 'QA Ancres';
      state.booking.phone = '+32 470 12 34 56';
      state.booking.email = 'qa@example.test';
      await confirmBooking();
    });
    await page.waitForTimeout(400);
    const anchorPost = await page.evaluate(() => (window.__PINLANE_QA_PUBLIC_POSTS__ || [])[0] || null);
    assert(anchorPost, 'Le parcours ancres doit poster sur /api/public-reservations.');
    assert(anchorPost.type === 'formule' && anchorPost.formuleId === 'f1', 'Payload : formule préservée.');
    assert(anchorPost.startTime === '15:00', `Payload : startTime = première ancre (reçu ${anchorPost.startTime}).`);
    assert(anchorPost.preference?.preferredTimes?.bowling === '15:00' && anchorPost.preference?.preferredTimes?.laser_game === '17:00', 'Payload : les heures d ancre choisies sont transmises pour revalidation serveur.');
    const postBowling = (anchorPost.opsPlan?.resourceBlocks || []).find(block => block.resourceType === 'bowling_lane');
    const postLaser = (anchorPost.opsPlan?.resourceBlocks || []).find(block => block.resourceType === 'laser_arena');
    assert(postBowling?.startTime === '15:00' && postLaser?.startTime === '17:00', 'Payload : blocs bowling/laser aux heures choisies.');
    const successText = await page.evaluate(() => document.getElementById('successDetails')?.textContent.replace(/\s+/g, ' ') || '');
    assert(/Bowling 15:00/.test(successText) && /Laser Game 17:00/.test(successText), 'Confirmation : les rendez-vous par ancre doivent être annoncés.');
    assert(/à votre rythme/i.test(successText), 'Confirmation : le pass liberté doit être annoncé sans heure.');
    await screenshot(page, 'formula-anchors-confirmed');

    // Formule table (f7, aucune ancre) : chips d'arrivée + table dès l'arrivée
    // jusqu'à la fin de visite dans le payload.
    await page.evaluate(async (iso) => {
      window.__PINLANE_QA_PUBLIC_POSTS__ = [];
      resetBooking();
      state.booking.type = 'formule';
      state.booking.formuleId = 'f7';
      state.booking.pax = 8;
      state.booking.date = iso;
      state.booking.preference = createDefaultFormulaPreference();
      goStep(2);
      await fetchSlots({ showLoading: false });
    }, nextSaturdayIso);
    await page.waitForTimeout(300);
    await page.evaluate(() => setFormulaArrivalChoice('15:00'));
    await page.waitForTimeout(250);
    const tableState = await page.evaluate(() => ({
      summary: document.querySelector('.formula-visit-summary')?.textContent.replace(/\s+/g, ' ') || '',
      passText: document.querySelector('.anchor-free-pass')?.textContent.replace(/\s+/g, ' ') || '',
      chips: Array.from(document.querySelectorAll('.formula-arrival-chip')).map(el => el.textContent.trim()),
    }));
    assert(tableState.chips.every(chip => /^\d{2}:(00|30)$/.test(chip)), 'Formule table : chips d arrivée :00/:30.');
    assert(/table vous attend dès votre arrivée/i.test(tableState.summary), 'Formule table : « votre table vous attend dès votre arrivée » requis.');
    assert(!/Table \d{1,2}:\d{2}/.test(tableState.summary), 'Formule table : aucune heure de table à choisir.');
    assert(!/\d{1,2}:\d{2}/.test(tableState.passText), 'Formule table : pass liberté sans aucune heure.');
    await screenshot(page, 'formula-table-arrival');
    await page.evaluate(async () => {
      const index = state.availableSlots.findIndex(slot => slot.time === '15:00');
      selectSlot(index);
      state.booking.name = 'QA Table';
      state.booking.phone = '+32 470 65 43 21';
      state.booking.email = 'qa-table@example.test';
      await confirmBooking();
    });
    await page.waitForTimeout(400);
    const tablePost = await page.evaluate(() => (window.__PINLANE_QA_PUBLIC_POSTS__ || [])[0] || null);
    assert(tablePost, 'Formule table : la réservation doit être postée.');
    const tableBlock = (tablePost.opsPlan?.resourceBlocks || []).find(block => block.resourceType === 'party_table');
    assert(tableBlock, 'Formule table : bloc table interne requis dans le payload.');
    assert(tableBlock.startTime === '14:50', `Formule table : la table démarre à l arrivée (14:50, reçu ${tableBlock.startTime}).`);
    assert(tableBlock.endTime === tablePost.opsPlan.endTime, 'Formule table : la table reste bloquée jusqu à la fin de la visite.');
    await page.evaluate(() => resetBooking());

    // ------------------------------------------------------------------
    // Chantier 6 — les horaires alternatifs disparaissent au changement de contexte
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      showBookingAlternatives('Ce créneau ne tient plus.', [
        { date: '2026-07-16', startTime: '15:00', summary: 'Bowling 15:00 · piste 2', validationStatus: 'confirmed' },
        { date: '2026-07-16', startTime: '17:30', summary: 'Bowling 17:30 · piste 4', validationStatus: 'confirmed' },
      ]);
    });
    await page.waitForTimeout(200);
    assert(await page.locator('#alertBox .booking-alternatives').count() === 1, 'Les alternatives doivent s afficher.');
    await screenshot(page, 'chantier6-alternatives-visible');
    await page.evaluate(() => {
      const input = document.getElementById('fDate');
      input.value = '2026-07-17';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    assert(await page.locator('#alertBox .booking-alternatives').count() === 0, 'Changer de date doit purger les alternatives.');
    await page.evaluate(() => {
      showBookingAlternatives('Test reset', [{ date: '2026-07-16', startTime: '15:00', summary: 'Bowling 15:00', validationStatus: 'confirmed' }]);
      resetBooking();
    });
    await page.waitForTimeout(200);
    assert(await page.locator('#alertBox .booking-alternatives').count() === 0, 'resetBooking doit purger les alternatives.');
    await screenshot(page, 'chantier6-alternatives-cleared');

    // ------------------------------------------------------------------
    // Chantier 5 — Établissement : horaires vacances, exceptions, offres
    // ------------------------------------------------------------------
    await page.evaluate(() => setView('staff'));
    await renderStaffPage(page, 'establishment');
    await page.waitForTimeout(500);
    const readViewState = await page.evaluate(() => ({
      holidayCards: Array.from(document.querySelectorAll('.establishment-read-card h3')).map(el => el.textContent.trim()),
    }));
    assert(readViewState.holidayCards.some(title => /vacances/i.test(title)), 'Vue lecture Établissement : carte horaires vacances requise.');
    assert(readViewState.holidayCards.some(title => /Offres/i.test(title)), 'Vue lecture Établissement : carte offres requise.');
    await screenshot(page, 'chantier5-establishment-read');
    const editBtn2 = page.locator('.establishment-editor-actions button', { hasText: 'Modifier' });
    if (await editBtn2.count()) {
      await editBtn2.first().click();
      await page.waitForTimeout(300);
      const editState = await page.evaluate(() => ({
        holidayToggle: Boolean(document.getElementById('estab-holiday-enabled')),
        holidayRows: document.querySelectorAll('[id^="estab-hday-"][id$="-open"]').length,
        periodChecks: ['estab-fbp-public', 'estab-fbp-short', 'estab-fbp-summer'].every(id => document.getElementById(id)),
        overrideForm: Boolean(document.getElementById('estab-override-date')),
        overrideChip: Boolean(document.querySelector('.estab-override-chip')),
        offerToggles: document.querySelectorAll('[id^="estab-offer-"]').length,
        f6Off: document.getElementById('estab-offer-f6') && !document.getElementById('estab-offer-f6').checked,
      }));
      assert(editState.holidayToggle, 'Éditeur : toggle horaires vacances requis.');
      assert(editState.holidayRows === 7, 'Éditeur : 7 jours d horaires vacances requis.');
      assert(editState.periodChecks, 'Éditeur : cases par type de période requises.');
      assert(editState.overrideForm && editState.overrideChip, 'Éditeur : gestion des exceptions ponctuelles requise.');
      assert(editState.offerToggles >= 10, 'Éditeur : toggles d offres requis.');
      assert(editState.f6Off, 'Éditeur : l offre f6 désactivée doit apparaître décochée.');
      await screenshot(page, 'chantier5-establishment-edit');
      issues.push(...await collectIssues(page, 'chantier5-establishment-edit'));
      const cancelBtn2 = page.locator('.establishment-editor-actions button', { hasText: 'Annuler' });
      if (await cancelBtn2.count()) {
        await cancelBtn2.first().click();
        await page.waitForTimeout(250);
      }
    }
    await page.evaluate(() => setView('client'));
    await page.waitForTimeout(400);

    // ------------------------------------------------------------------
    // Réservation rapide contextuelle — UNE base + variantes par point
    // d'entrée : le contexte pré-remplit ET élague (jamais redemander ce
    // qui est déjà su), l'avancé vit replié dans « Plus d'options ».
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      setView('staff');
      // Samedi à venir : horaires garantis ouverts, pas de dépendance au jour du run.
      const target = new Date();
      target.setDate(target.getDate() + ((6 - target.getDay() + 7) % 7 || 7));
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      state.currentDate = iso;
      state.staffMenuPage = 'planning';
      state.reservations = window.__PINLANE_QA_RESERVATIONS__(iso);
      save();
      renderStaff();
    });
    await page.waitForTimeout(500);

    const readQuickBook = () => page.evaluate(() => {
      const modal = document.querySelector('.qb-modal');
      if (!modal) return null;
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return {
        title: modal.querySelector('h3')?.textContent.trim() || '',
        eyebrow: modal.querySelector('.ticket-id')?.textContent.trim() || '',
        interactive: Array.from(modal.querySelectorAll('button, input, select, textarea')).filter(visible).length,
        chips: Array.from(modal.querySelectorAll('.qb-context-chip .k')).map((el) => el.textContent.trim()),
        chipValues: Array.from(modal.querySelectorAll('.qb-context-chip .v')).map((el) => el.textContent.trim()),
        hasTypeRow: Boolean(modal.querySelector('.qb-type-row')),
        hasDateInput: Boolean(modal.querySelector('input[type="date"]')),
        hasTimeInput: Boolean(modal.querySelector('input[type="time"]')),
        hasPaxInput: Boolean(modal.querySelector('input[type="number"]')),
        hasNameInput: Boolean(modal.querySelector('input[placeholder="Marie Dupont"]')),
        hasEmailInput: Boolean(modal.querySelector('input[type="email"]')),
        hasSlotStrip: Boolean(modal.querySelector('.qb-slot-strip')),
        hasLaneGrid: Boolean(modal.querySelector('.qb-lane-grid')),
        hasFormuleGrid: Boolean(modal.querySelector('.qb-formule-grid')),
        durBtns: modal.querySelectorAll('.qb-dur-btn').length,
        moreToggle: Boolean(modal.querySelector('.qb-more-toggle')),
        lockChip: Boolean(modal.querySelector('.qb-chip-lock')),
        state: {
          type: quickBookState.type,
          date: quickBookState.date,
          startTime: quickBookState.startTime,
          lanes: [...quickBookState.lanes],
          autoAssign: quickBookState.autoAssign,
          lockStartTime: quickBookState.lockStartTime,
          name: quickBookState.name,
        },
      };
    });

    // 1) Base générique (bouton « Réservation rapide ») : 2 temps, moitié
    // d'éléments visibles minimum par rapport à l'ancienne modale (38).
    await page.evaluate(() => openQuickBook());
    await page.waitForTimeout(300);
    const qbGeneric = await readQuickBook();
    assert(qbGeneric, 'Réservation rapide générique : la modale doit s ouvrir.');
    assert(qbGeneric.title === 'Réservation rapide', `Générique : titre attendu « Réservation rapide » (reçu ${qbGeneric.title}).`);
    assert(qbGeneric.interactive <= 19, `Générique : max 19 éléments interactifs visibles à l ouverture — moitié de l ancienne modale (reçu ${qbGeneric.interactive}).`);
    assert(qbGeneric.hasTypeRow && qbGeneric.hasDateInput && qbGeneric.hasTimeInput && qbGeneric.hasPaxInput && qbGeneric.hasNameInput, 'Générique : les essentiels (activité, date, heure, joueurs, contact) doivent être visibles.');
    assert(!qbGeneric.hasSlotStrip && !qbGeneric.hasLaneGrid && !qbGeneric.hasEmailInput, 'Générique : créneaux, pistes et email doivent être repliés à l ouverture.');
    assert(qbGeneric.moreToggle, 'Générique : le bouton « Plus d options » est requis.');
    await screenshot(page, 'quickbook-generic');
    issues.push(...await collectIssues(page, 'quickbook-generic'));
    // Zéro perte de capacité : l'avancé replié rouvre tout.
    await page.evaluate(() => toggleQuickBookMore());
    await page.waitForTimeout(250);
    const qbGenericMore = await readQuickBook();
    assert(qbGenericMore.hasSlotStrip && qbGenericMore.hasLaneGrid && qbGenericMore.hasEmailInput && qbGenericMore.durBtns >= 4, 'Générique déplié : créneaux, grille pistes, durée et email doivent réapparaître.');
    await screenshot(page, 'quickbook-generic-more');
    issues.push(...await collectIssues(page, 'quickbook-generic-more'));
    await page.evaluate(() => closeQuickBook());

    // 2) Case du planning bowling : piste + date + heure acquises, jamais redemandées.
    await page.evaluate(() => quickFromCell(7, 15));
    await page.waitForTimeout(300);
    const qbCell = await readQuickBook();
    assert(/piste 7/.test(qbCell.title) && /15:00/.test(qbCell.title), `Case planning : titre contextuel « Réserver la piste 7 · 15:00 » attendu (reçu ${qbCell.title}).`);
    assert(!qbCell.hasTypeRow && !qbCell.hasDateInput && !qbCell.hasTimeInput, 'Case planning : activité, date et heure sont acquises — ne pas les redemander.');
    assert(qbCell.chips.includes('Piste') && qbCell.chips.includes('Départ') && qbCell.chips.includes('Date'), 'Case planning : les acquis doivent être rappelés en chips.');
    assert(qbCell.state.lanes.length === 1 && qbCell.state.lanes[0] === 7 && qbCell.state.startTime === '15:00' && qbCell.state.autoAssign === false, 'Case planning : piste 7 et 15:00 doivent être préremplies.');
    assert(qbCell.durBtns >= 4 && qbCell.hasNameInput && qbCell.hasPaxInput, 'Case planning : l essentiel restant = client, joueurs, durée.');
    assert(qbCell.interactive <= 19, `Case planning : la variante doit rester compacte (reçu ${qbCell.interactive}).`);
    await screenshot(page, 'quickbook-bowling-cell');
    issues.push(...await collectIssues(page, 'quickbook-bowling-cell'));
    // « Modifier » sur un acquis rouvre le contrôle (capacité préservée).
    await page.evaluate(() => unlockQuickField('startTime'));
    await page.waitForTimeout(250);
    const qbCellUnlocked = await readQuickBook();
    assert(qbCellUnlocked.hasTimeInput, 'Case planning : « Modifier » sur le départ doit rouvrir le champ heure.');
    // Soumission : payload identique au contrat existant (channel staff, pistes, statuts).
    await page.evaluate(() => { window.__PINLANE_QA_RES_POSTS__ = []; });
    await page.evaluate(async () => {
      quickBookState.name = 'QA Contexte';
      quickBookState.phone = '+32 470 11 22 33';
      await saveQuickBook();
    });
    await page.waitForTimeout(400);
    const qbPost = await page.evaluate(() => (window.__PINLANE_QA_RES_POSTS__ || [])[0] || null);
    assert(qbPost, 'Case planning : la création doit poster sur /api/staff-reservations.');
    assert(qbPost.type === 'bowling' && qbPost.startTime === '15:00' && Array.isArray(qbPost.lanes) && qbPost.lanes.length === 1 && Number(qbPost.lanes[0]) === 7, `Case planning : payload préservé (type/heure/piste) — reçu ${JSON.stringify({ type: qbPost.type, startTime: qbPost.startTime, lanes: qbPost.lanes })}.`);
    assert(qbPost.channel === 'staff' && qbPost.status === 'pending' && qbPost.requiresLanes === true && Number(qbPost.laneCount) === 1, 'Case planning : contrat API inchangé (channel, status, laneCount, requiresLanes).');
    assert(Number(qbPost.price) === Number(qbPost.basePrice) && Number(qbPost.pax) === 4 && Number(qbPost.duration) === 1, 'Case planning : montants et durée inchangés par défaut.');
    const qbClosedAfterSave = await page.evaluate(() => document.getElementById('quickBookOverlay').classList.contains('hidden') || !document.querySelector('.qb-modal'));
    assert(qbClosedAfterSave, 'Case planning : la modale doit se fermer après création.');

    // 3) Créneau vide du planning laser : départ + activité acquis.
    await page.evaluate(() => openQuickBook({ date: state.currentDate, startTime: '16:00', type: 'laser' }));
    await page.waitForTimeout(300);
    const qbLaser = await readQuickBook();
    assert(/Nouvelle session laser/.test(qbLaser.title) && /16:00/.test(qbLaser.title), `Laser : titre contextuel attendu (reçu ${qbLaser.title}).`);
    assert(!qbLaser.hasTypeRow && !qbLaser.hasTimeInput && !qbLaser.hasDateInput, 'Laser : activité, date et départ sont acquis.');
    assert(qbLaser.durBtns === 3 && !qbLaser.hasLaneGrid, 'Laser : le choix des parties (1/2/3) est l essentiel, pas les pistes.');
    assert(qbLaser.interactive <= 16, `Laser : variante compacte requise (reçu ${qbLaser.interactive}).`);
    await screenshot(page, 'quickbook-laser-slot');
    issues.push(...await collectIssues(page, 'quickbook-laser-slot'));
    await page.evaluate(() => closeQuickBook());

    // 4) Rejoindre un lancement laser existant : départ verrouillé.
    await page.evaluate(() => openQuickBookForLaserSession(18, 12));
    await page.waitForTimeout(300);
    const qbJoin = await readQuickBook();
    assert(/Rejoindre le lancement/.test(qbJoin.title), `Lancement laser : titre « Rejoindre le lancement » attendu (reçu ${qbJoin.title}).`);
    assert(qbJoin.state.lockStartTime === true && qbJoin.lockChip, 'Lancement laser : le départ doit être affiché verrouillé.');
    assert(!qbJoin.hasTimeInput && !qbJoin.hasTypeRow, 'Lancement laser : ni heure ni activité à redemander.');
    assert(qbJoin.interactive <= 13, `Lancement laser : variante minimale requise (reçu ${qbJoin.interactive}).`);
    await screenshot(page, 'quickbook-laser-session');
    issues.push(...await collectIssues(page, 'quickbook-laser-session'));
    await page.evaluate(() => closeQuickBook());

    // 5) Groupes & anniversaires : orientée formule.
    await page.evaluate(() => openQuickBook({ date: state.currentDate, type: 'formule' }));
    await page.waitForTimeout(300);
    const qbGroup = await readQuickBook();
    assert(/groupe/i.test(qbGroup.title) && /anniversaire/i.test(qbGroup.title), `Groupes : titre orienté groupe/anniversaire attendu (reçu ${qbGroup.title}).`);
    assert(qbGroup.hasFormuleGrid && !qbGroup.hasTypeRow && !qbGroup.hasLaneGrid, 'Groupes : le choix de formule est central, pistes et type repliés.');
    assert(qbGroup.interactive < 26, `Groupes : moins d éléments que l ancienne modale (reçu ${qbGroup.interactive}).`);
    await screenshot(page, 'quickbook-groupe');
    issues.push(...await collectIssues(page, 'quickbook-groupe'));
    await page.evaluate(() => closeQuickBook());

    // 6) Fiche client : coordonnées acquises, jamais resaisies.
    await page.evaluate(() => openQuickBook({ name: 'Marie Dupont', phone: '+32 470 00 00 01', email: 'marie@example.test', date: state.currentDate, type: 'bowling' }));
    await page.waitForTimeout(300);
    const qbClient = await readQuickBook();
    assert(/Marie Dupont/.test(qbClient.title), `Fiche client : titre nominatif attendu (reçu ${qbClient.title}).`);
    assert(!qbClient.hasNameInput && qbClient.chips.includes('Client'), 'Fiche client : le client acquis est rappelé, pas resaisi.');
    assert(qbClient.hasTimeInput && qbClient.hasPaxInput, 'Fiche client : il reste l heure et les joueurs.');
    await screenshot(page, 'quickbook-client');
    issues.push(...await collectIssues(page, 'quickbook-client'));
    // Thème clair : la variante contextuelle est bi-thème.
    await page.evaluate(() => setStaffTheme('light'));
    await page.waitForTimeout(300);
    await screenshot(page, 'quickbook-client-light');
    issues.push(...await collectIssues(page, 'quickbook-client-light'));
    await page.evaluate(() => { closeQuickBook(); setStaffTheme('dark'); });
    await page.waitForTimeout(200);

    await page.evaluate(() => setView('client'));
    await page.waitForTimeout(400);

    // Passe mobile (390×844) : staff clés + parcours client
    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    mobilePage.on('pageerror', (error) => pageErrors.push(`mobile: ${error.message}`));
    await installQaApi(mobilePage);
    await waitForApp(mobilePage);
    await seedStressDay(mobilePage);
    for (const mobileStaffPage of ['dashboard', 'planning', 'reservations', 'groups', 'users']) {
      await renderStaffPage(mobilePage, mobileStaffPage);
      await screenshot(mobilePage, `staff-${mobileStaffPage}-mobile`);
      issues.push(...await collectIssues(mobilePage, `staff-${mobileStaffPage}-mobile`));
    }
    await mobilePage.evaluate(() => setView('client'));
    await mobilePage.waitForTimeout(700);
    await screenshot(mobilePage, 'client-booking-mobile');
    issues.push(...await collectIssues(mobilePage, 'client-booking-mobile'));

    // Chantier 3 (mobile) : liste des formules compacte sur 390px
    await mobilePage.evaluate(() => {
      setType('formule');
      state.booking.pax = 8;
      document.getElementById('fPax').value = 8;
      renderFormules();
    });
    await mobilePage.waitForTimeout(300);
    await screenshot(mobilePage, 'chantier3-formules-mobile');
    issues.push(...await collectIssues(mobilePage, 'chantier3-formules-mobile'));

    // Picker « Ancres + Liberté » sur 390px : chips par ancre + pass liberté.
    await mobilePage.evaluate(async (iso) => {
      state.booking.type = 'formule';
      state.booking.formuleId = 'f1';
      state.booking.pax = 8;
      state.booking.date = iso;
      state.booking.preference = createDefaultFormulaPreference();
      goStep(2);
      await fetchSlots({ showLoading: false });
    }, nextSaturdayIso);
    await mobilePage.waitForTimeout(350);
    const mobileAnchorState = await mobilePage.evaluate(() => ({
      rows: document.querySelectorAll('.anchor-row').length,
      activeChips: Array.from(document.querySelectorAll('.anchor-chip.active')).map(el => el.textContent.trim()),
      pass: Boolean(document.querySelector('.anchor-free-pass')),
    }));
    assert(mobileAnchorState.rows === 2, 'Mobile : une ligne de chips par ancre.');
    assert(mobileAnchorState.activeChips.length === 2, 'Mobile : combinaison par défaut pré-sélectionnée.');
    assert(mobileAnchorState.pass, 'Mobile : bloc pass liberté visible.');
    await screenshot(mobilePage, 'formula-anchors-mobile');
    issues.push(...await collectIssues(mobilePage, 'formula-anchors-mobile'));
    await mobilePage.evaluate(() => resetBooking());

    // Console Direction (#adminView) en mobile — l'ancienne capture "direction-mobile"
    // ne couvrait que la page legacy direction.html.
    await mobilePage.evaluate(() => setView('admin'));
    await mobilePage.locator('#adminView:not(.hidden)').waitFor({ timeout: 10000 });
    await mobilePage.waitForTimeout(900);
    await screenshot(mobilePage, 'direction-overview-mobile');
    issues.push(...await collectIssues(mobilePage, 'direction-overview-mobile'));
    await mobilePage.close();

    // Pages autonomes : screenshots + overflow (pas d'assertions console — hors app)
    const standalonePages = [
      ['public-form', '/public-form.html'],
      ['direction', '/direction.html'],
      ['pro-landing', '/pro.html'],
    ];
    for (const [name, route] of standalonePages) {
      for (const [suffix, viewport] of [['desktop', { width: 1440, height: 920 }], ['mobile', { width: 390, height: 844 }]]) {
        const standalone = await browser.newPage({ viewport, deviceScaleFactor: suffix === 'mobile' ? 2 : 1 });
        await installQaApi(standalone);
        await standalone.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
        await standalone.waitForTimeout(600);
        // Le screenshot fullPage ne scrolle pas : l'IntersectionObserver du reveal
        // ne se déclenche jamais sous le fold — on force l'état final.
        await standalone.evaluate(() => {
          document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
        });
        await standalone.waitForTimeout(300);
        await screenshot(standalone, `${name}-${suffix}`);
        issues.push(...await collectIssues(standalone, `${name}-${suffix}`));
        await standalone.close();
      }
    }

    const blockingConsoleErrors = consoleErrors.filter((entry) => (
      !/favicon|net::ERR_ABORTED|Failed to load resource|Not found/i.test(entry)
    ));

    assert(!pageErrors.length, `Erreur JS navigateur: ${pageErrors.join(' | ')}`);
    assert(!blockingConsoleErrors.length, `Erreur console: ${blockingConsoleErrors.join(' | ')}`);
    assert(!issues.length, `QA visuelle: ${JSON.stringify(issues, null, 2)}`);

    console.log(JSON.stringify({ ok: true, screenshots: OUT_DIR }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
