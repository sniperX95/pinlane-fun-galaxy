// GATE DE CONTRASTE DE TOUTE LA CONSOLE (Edge headless, serveur statique local).
//
// POURQUOI CE GATE EXISTE
// -----------------------
// Le 2026-08-14, deux textes de la page Planning etaient sous le seuil AA alors
// que `test:planning-matrix` mesurait deja le contraste dans les deux themes et
// sortait vert : tous ses selecteurs etaient prefixes par `#planningGridWrap`,
// donc l'auditeur s'arretait a la grille et les deux defauts vivaient quelques
// pixels au-dessus. UN AUDITEUR QUI NE REGARDE QU'UNE REGION NE PROTEGE QUE
// CETTE REGION, et un auditeur qui regarde une LISTE DE SELECTEURS ne protege
// que les selecteurs qu'on a pense a ecrire.
//
// Ce gate-ci ne porte donc AUCUNE liste de selecteurs. Il balaye TOUT ce qui est
// reellement peint sur chaque ecran de la console, dans les deux themes, et
// mesure la couleur COMPOSITE : il remonte la pile des fonds semi-transparents
// jusqu'au premier fond opaque, et aplatit aussi une couleur de texte
// semi-transparente sur ce fond. C'est la couleur que l'oeil recoit, pas celle
// que la declaration annonce.
//
// PERIMETRE (le point entier du gate) : les onze entrees du menu du centre avec
// leurs onglets, les sept pages Plateforme, la vue Direction avec ses onglets,
// et les surfaces qui s'ouvrent par-dessus (fiche reservation Infos, fiche
// Modifier). Chaque ecran doit prouver qu'il a RENDU quelque chose : un ecran
// qui ne mesure rien serait vert pour rien, donc un plancher d'elements mesures
// est verifie ecran par ecran.
//
// SEUILS : 4.5:1 pour le texte, 3:1 pour le grand texte (>= 24px, ou >= 18.66px
// en gras) et pour la frontiere des controles de formulaire (WCAG 1.4.11).
//
// CONTRE-EPREUVE PAR MUTATION : a la fin, le gate degrade volontairement des
// jetons (--muted et --faint rapproches de leur fond) et exige que le balayage
// ROUGISSE. Sans elle, « 0 echec » pourrait vouloir dire « le balayage ne
// mesure rien ».
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/console-contrast-check.js
//   --json=<chemin>  ecrit toutes les mesures (pas seulement les echecs)

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CONTRAST_PORT || 4251);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JSON_OUT = (process.argv.find((a) => a.startsWith('--json=')) || '').slice('--json='.length);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return !!cond; }

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------------------
// Mock de session + API. Une seule session porte a la fois les permissions du
// centre ET platform.admin : c'est la seule facon d'atteindre les dix-huit
// entrees de menu dans une seule passe.
// ---------------------------------------------------------------------------
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = [
      'dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
      'reservations.view', 'reservations.status', 'clients.view', 'pricing.manage',
      'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents',
      'settings.manage', 'direction.view', 'users.manage', 'centers.switch', 'platform.admin',
    ];
    const qaSession = {
      token: 'contrast-qa', cookieBacked: false, centerId: 'libramont', expiresAt,
      member: { id: 'libramont:platform-owner', name: 'QA Pinlane' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const now = new Date().toISOString();
    const hier = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const vieux = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

    // --- Reservations du jour : un echantillon qui allume TOUS les etats -----
    // (confirmee, arrivee, payee, annulee, formule multi-etapes, laser, retard)
    // parce qu'un etat non rendu est un contraste non mesure.
    const buildReservations = (date) => ([
      { id: 9001, name: 'Anniversaire Lina', phone: '+32470860011', email: 'lina@example.test', date, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 120, type: 'bowling', label: 'Bowling classique', notes: 'Gateau a 15h', occasion: 'birthday' },
      { id: 9002, name: 'Famille Lambert', phone: '+32470860012', email: 'lambert@example.test', date, startTime: '14:30', duration: 1, lanes: [2], status: 'arrived', pax: 4, price: 39, type: 'bowling', label: 'Bowling classique' },
      { id: 9003, name: 'Entreprise Ardenne', phone: '+32470860013', email: 'ardenne@example.test', date, startTime: '15:00', duration: 1.5, lanes: [3, 5], status: 'paid', pax: 11, price: 308, type: 'formule', formuleId: 'formule3', label: 'FORMULE 3',
        plan: [
          { resourceType: 'bowling_lane', label: 'Bowling', start: '15:00', end: '16:30', lanes: [3, 5], players: 11 },
          { resourceType: 'laser_arena', label: 'Laser Game', start: '17:00', end: '17:25', players: 11, countIndex: 1 },
        ] },
      { id: 9004, name: 'Ecole Saint-Hubert', phone: '+32470860014', email: 'ecole@example.test', date, startTime: '17:00', duration: 2, lanes: [4, 6], status: 'confirmed', pax: 17, price: 234, type: 'bowling', label: 'Bowling 2h' },
      { id: 9005, name: 'Team Atelier Laser', phone: '+32470860015', email: 'laser@example.test', date, startTime: '16:30', duration: 1, lanes: [], status: 'confirmed', pax: 18, price: 180, type: 'laser', label: 'Laser x2',
        plan: [{ resourceType: 'laser_arena', label: 'Laser Game', start: '16:30', end: '16:55', players: 18, countIndex: 1 }] },
      { id: 9006, name: 'Groupe annule', phone: '+32470860016', email: 'annule@example.test', date, startTime: '19:00', duration: 1, lanes: [7], status: 'cancelled', pax: 8, price: 96, type: 'bowling', label: 'Bowling classique' },
      { id: 9007, name: 'Sabine Dupont', phone: '', email: '', date, startTime: '20:00', duration: 1, lanes: [8], status: 'confirmed', pax: 2, price: 24, type: 'bowling', label: 'Bowling classique',
        opsPlan: { delayFlag: { minutes: 15, from: '19:45', to: '20:00', flaggedAt: new Date().toISOString(), cleared: false } } },
    ]);
    const buildLaneStatuses = () => ({ 1: 'ok', 2: 'ok', 3: 'ok', 4: 'ok', 5: 'ok', 6: 'maintenance', 7: 'ok', 8: 'ok' });

    const founderBundle = {
      ok: true, generatedAt: now, testData: true,
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active' },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active' },
        { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned' },
      ],
      journalSince: hier,
      breakage: {
        mails: { window: '30 derniers jours', failed: 2, groups: [{ lastError: 'sandbox', count: 2 }], recent: [{ id: 501, centerId: 'libramont', recipient: 'client@test.be', subject: 'Rappel', lastError: 'sandbox', attempts: 2, createdAt: hier }] },
        jobs: { window: 'etat actuel', failed: 1, recent: [{ id: 88, centerId: 'libramont', jobType: 'reservation_followup', lastError: 'timeout enqueue', attempts: 3, maxAttempts: 20, updatedAt: hier }] },
        worker: { window: '24 dernieres heures', lastRun: { taskName: 'ops-jobs', status: 'ok', startedAt: now, finishedAt: now, error: '' }, failed24h: 0, tasks: [] },
        denied: { window: '7 derniers jours', count: 1, recent: [{ id: 3, centerId: 'libramont', occurredAt: hier, actorKind: 'staff', actorLabel: 'Directrice Demo', surface: 'api/ops.js', deniedReason: 'Permission insuffisante.', requestedCenter: '' }] },
        audit: { failures: 0 },
      },
      adoption: { window: '7 et 30 derniers jours', excludesPlatformOwner: true,
        perCenter: [
          { centerId: 'libramont', lastStaffAction: hier, actions7d: 14, actions30d: 61, lastLogin: hier, activeSessions: 1 },
          { centerId: 'gembloux', lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 },
        ],
        actions30d: [{ centerId: 'libramont', action: 'updateReservation', count: 22 }] },
      agents: {
        suggestions: { total: 12, pending: 2, lastAt: hier, window: 'depuis le debut' },
        insights: { byStatus: [{ status: 'pending', count: 3, lastAt: hier }], perCenter: [{ centerId: 'libramont', lastAt: hier, count30d: 5 }] },
        plans: [{ centerId: 'libramont', status: 'proposed', fromDate: '2026-07-20', toDate: '2026-09-14', mode: 'deterministe', createdAt: hier }],
        decisions: { d7: 4, lastAt: hier, window: '7 derniers jours' },
      },
      cost: { budgetUsd: 5, month: '2026-07', monthMeasured: true, spentUsd: 4.0023, calls: 645, updatedAt: now, projectionUsd: 5.9, dailyMeasured: false,
        months: [{ month: '2026-07', costUsd: 4.0023, calls: 645 }, { month: '2026-06', costUsd: 2.1, calls: 300 }] },
      leads: { window: 'depuis le debut', total: 1, byStatus: { new: 1 }, lastAt: hier, recent: [{ centerName: 'Bowling du Lac', priority: 'haute', status: 'new', createdAt: hier }] },
      sequences: { keys: [{ key: 'confirmation', label: 'Confirmation' }, { key: 'reminder_48h', label: 'Rappel avant la venue' }],
        perCenter: { libramont: { confirmation: { enabled: true }, reminder_48h: { enabled: true } }, gembloux: { confirmation: { enabled: true }, reminder_48h: { enabled: false } } } },
      audit: { entries: [{ id: 1, occurredAt: now, centerId: 'libramont', actorKind: 'staff', actorLabel: 'Directrice Demo', actorMemberId: 'libramont:demo', action: 'automationSettings', outcome: 'success', surface: 'api/ops.js' }] },
    };
    const agentsBundle = {
      ok: true, generatedAt: now, testData: true,
      agents: {
        marketing: { lastAt: hier, count7d: 3, count30d: 11, detail: 'insight' },
        emails: { lastAt: null, count7d: 0, count30d: 0 },
        suggestions: { lastAt: hier, count7d: 2, count30d: 12 },
        decisions: { lastAt: now, count7d: 4, count30d: 19 },
      },
      cost: { budgetUsd: 5, costPerAgentMeasured: false, months: [{ month: '2026-06', costUsd: 2.1, calls: 300 }, { month: '2026-07', costUsd: 4.0023, calls: 645 }] },
    };
    const incidentsBundle = {
      ok: true, generatedAt: now, testData: true,
      console: { window: '14 derniers jours', groups: [
        { message: 'TypeError lanes', count: 6, lastAt: recent, centers: ['libramont'], pages: ['planning'], stack: 'TypeError lanes\n    at renderPlanning' },
        { message: 'NetworkError /api/ops', count: 2, lastAt: vieux, centers: ['gembloux'], pages: ['emails'] },
      ] },
      breakage: founderBundle.breakage,
    };
    const clientsBundle = {
      ok: true, generatedAt: now, testData: true,
      centers: [
        { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', config: { done: 9, total: 10 }, adoption: { lastStaffAction: hier, actions7d: 14, actions30d: 61, lastLogin: hier, activeSessions: 1 }, topActors: [{ label: 'Directrice Demo', count30d: 41 }], mails: { sent30d: 118, failed30d: 3 }, sequences: { active: 3, total: 3 } },
        { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', config: { done: 6, total: 10 }, adoption: { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 }, topActors: [], mails: { sent30d: 0, failed30d: 0 }, sequences: { active: 1, total: 3 } },
        { id: 'ciney', name: 'Fun Galaxy Ciney', status: 'planned', config: { done: 2, total: 10 }, adoption: { lastStaffAction: null, actions7d: 0, actions30d: 0, lastLogin: null, activeSessions: 0 }, topActors: [], mails: null, sequences: { active: 0, total: 3 } },
      ],
    };
    const mkCenter = (id, name, status, laneCount, weaponCount, launches) => ({
      id, name, status, timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount, parallelLaunches: launches, canSplitGroupsCleanly: launches > 1, requiresCompleteGroupBeforeLaunch: launches === 1, riskLevel: 'managed' },
      },
      defaultSchedule: {
        regular: { 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' }, 0: { open: '10:00', close: '22:00' } },
        holiday: { 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' }, 0: { open: '10:00', close: '22:00' } },
      },
      holidaySettings: { enabled: true, overrides: [{ date: '2026-09-14', mode: 'holiday' }], formulaBlockedPeriods: ['public', 'school_short', 'manual'] },
      offerAvailability: { f6: false },
      activityAvailability: { bowling: true, laser_game: true, minigolf_blacklight: true, golf_oclock: status !== 'active', arcade_time: true, playground: true },
    });

    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      const p = u.pathname;
      if (p === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (p === '/api/staff-state') {
        const date = u.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        return J({ ok: true, revision: `contrast-${date}`, reservations: buildReservations(date), laneStatuses: buildLaneStatuses(), centerId: 'libramont' });
      }
      if (p === '/api/admin-range') {
        const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
        return J({ ok: true, reservations: buildReservations(d), emails: [], agentEvents: [], centerId: u.searchParams.get('centerId') || 'libramont' });
      }
      if (p === '/api/public-booking-meta') return J({ ok: true, center: { id: 'libramont', name: 'Fun Galaxy Libramont', branding: {} }, activities: [], formulas: [] });
      if (p === '/api/public-availability') return J({ ok: true, slots: [] });
      if (p === '/api/simulation') return J({ ok: true, run: null, communications: [], stats: {}, logs: [] });
      if (p === '/api/marketing-agents') return J({ ok: true, agents: [], suggestions: [], activations: [], orchestration: {} });
      if (p === '/api/staff-reservations' || p === '/api/staff-lanes') return J({ ok: true, reservation: null });
      if (p === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'founderCockpit') return J(founderBundle);
        if (action === 'founderAuditLog') return J({ ok: true, entries: founderBundle.audit.entries });
        if (action === 'founderAgents') return J(agentsBundle);
        if (action === 'founderIncidents') return J(incidentsBundle);
        if (action === 'founderClients') return J(clientsBundle);
        if (action === 'founderCenters') {
          return J({ ok: true, testData: true, resourceModel: { statusValues: ['active', 'planned', 'closed'], resources: {}, defaultSchedule: {} },
            centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', config: { status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30 } } }, members: 3, reservations30d: 40, revenue30d: 6000 }] });
        }
        if (action === 'platformClients') {
          return J({ ok: true, testData: true, clients: [{ id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard', contactEmail: '', contactPhone: '', notes: '', createdAt: now, centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', staff: 4 }], centerCount: 1, staffCount: 4 }], orphanCenters: [] });
        }
        if (action === 'founderCatalog') {
          return J({ ok: true, testData: true, centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }],
            formulas: [{ id: 'f1', name: 'FORMULE 1', family: 'Anniversaire', minPax: 6, price: { value: 26, oldValue: 34 }, steps: [{ activityId: 'bowling', count: 1 }], override: null, perCenter: {} }] });
        }
        if (action === 'founderTeam') {
          return J({ ok: true, testData: true,
            permissionsCatalog: [{ key: 'reservations.view', label: 'Voir les reservations', group: 'Reservations', assignable: true }, { key: 'platform.admin', label: 'Admin plateforme', group: 'Plateforme', assignable: false }],
            centers: [{ id: 'libramont', name: 'Fun Galaxy Libramont' }],
            roles: [{ id: 'staff', name: 'Staff', centerId: 'libramont', locked: false, permissions: ['reservations.view'], memberCount: 2 }],
            members: [{ id: 'libramont:demo', name: 'Demo', centerId: 'libramont', roleId: 'staff', roleName: 'Staff', status: 'active', lastLoginAt: null, hasCode: true }] });
        }
        if (action === 'centerConfig') {
          return J({ ok: true,
            centers: [mkCenter('libramont', 'Fun Galaxy Libramont', 'active', 8, 30, 1), mkCenter('gembloux', 'Fun Galaxy Gembloux', 'active', 8, 30, 3), mkCenter('ciney', 'Fun Galaxy Ciney', 'planned', 8, 30, 1)],
            activities: [
              { id: 'bowling', label: 'Bowling' }, { id: 'laser_game', label: 'Laser Game' },
              { id: 'minigolf_blacklight', label: 'Minigolf Blacklight' }, { id: 'golf_oclock', label: "Golf o'Clock" },
              { id: 'arcade_time', label: 'Arcade' }, { id: 'playground', label: 'Plaine de jeux' },
            ] });
        }
        if (method === 'POST') return J({ ok: true });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (p.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    window.__QA_RESERVATIONS__ = buildReservations;
    window.__QA_LANES__ = buildLaneStatuses;
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) {}
  }, { expiresAt });
}

// ---------------------------------------------------------------------------
// LE BALAYAGE. Aucune liste de selecteurs : tout element visible qui porte du
// texte est mesure, et la frontiere de tout controle de formulaire visible.
// ---------------------------------------------------------------------------
const SWEEP = `
window.__CONSOLE_CONTRAST__ = function (label) {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); const hi = Math.max(l1, l2); const lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  // Le fond REELLEMENT PEINT : on empile les fonds semi-transparents jusqu'au
  // premier opaque. C'est la composite qui compte, pas la declaration.
  const bgOf = (el) => {
    let p = el;
    let acc = null;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        const eff = { r: c.r, g: c.g, b: c.b, a: c.a };
        acc = acc ? over(acc, eff) : eff;
        if (acc.a >= 0.999) return acc;
      }
      p = p.parentElement;
    }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor);
    const page = html && html.a > 0 ? html : { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, page) : page;
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // Ascendants : opacite nulle, content-visibility, ou conteneur replie.
    let p = el.parentElement;
    while (p) {
      const pc = getComputedStyle(p);
      if (pc.display === 'none' || pc.visibility === 'hidden') return false;
      if (parseFloat(pc.opacity) === 0) return false;
      if (p.tagName === 'DETAILS' && !p.open) return false;
      p = p.parentElement;
    }
    return true;
  };

  const inert = (el) => {
    // WCAG exempte les composants d'interface INACTIFS.
    if (el.closest('[disabled]')) return true;
    if (el.closest('[aria-disabled="true"]')) return true;
    if (el.closest('[inert]')) return true;
    return false;
  };

  const sig = (el) => {
    const cls = String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };

  const rows = [];
  const seen = new Set();
  const push = (el, kind, fgRaw, bg, required, note) => {
    const solid = fgRaw.a >= 0.999 ? fgRaw : over(fgRaw, bg);
    const r = Math.round(ratio(solid, bg) * 100) / 100;
    const key = label + '|' + kind + '|' + sig(el) + '|' + hex(solid) + '|' + hex(bg);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      screen: label, kind, sel: sig(el), ratio: r, required,
      fg: hex(solid), bg: hex(bg), note: note || '',
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48),
    });
  };

  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'NOSCRIPT' || tag === 'HEAD') continue;
    if (!visible(el)) continue;
    if (inert(el)) continue;

    const cs = getComputedStyle(el);
    const bg = bgOf(el);

    // --- 1. TEXTE : un noeud texte direct, non vide -------------------------
    let ownText = '';
    for (const n of el.childNodes) if (n.nodeType === 3) ownText += n.nodeValue;
    if (ownText.trim().length) {
      const hidden = el.closest('[aria-hidden="true"]');
      const fg = parse(cs.color);
      if (fg && fg.a > 0.05 && !hidden) {
        const size = parseFloat(cs.fontSize) || 14;
        const weight = Number(cs.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        push(el, 'texte', fg, bg, large ? 3 : 4.5, size + 'px/' + weight);
      }
    }

    // --- 2. TEXTE DE SUBSTITUTION (placeholder) -----------------------------
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.placeholder) {
      const ph = parse(getComputedStyle(el, '::placeholder').color);
      if (ph && ph.a > 0.05) {
        const size = parseFloat(cs.fontSize) || 14;
        push(el, 'placeholder', ph, bgOf(el), 4.5, size + 'px');
      }
    }

    // --- 3. FRONTIERE DES CONTROLES (WCAG 1.4.11, 3:1) ----------------------
    // Ce qui permet d'IDENTIFIER le controle : la bordure d'un champ, d'un
    // select, d'une case. Les filets decoratifs (separateurs de liste, bord de
    // carte) sont exemptes : le contenu s'identifie sans eux.
    const isControl = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      || el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox';
    if (isControl) {
      const bw = Math.max(parseFloat(cs.borderTopWidth) || 0, parseFloat(cs.borderLeftWidth) || 0);
      const bc = parse(cs.borderTopColor);
      if (bw >= 1 && bc && bc.a > 0.05) {
        // Le fond CONTRE lequel la bordure se detache est celui du PARENT.
        const around = el.parentElement ? bgOf(el.parentElement) : bg;
        push(el, 'controle', bc, around, 3, 'bordure ' + bw + 'px');
      }
    }

    // --- 4. INDICATEURS GRAPHIQUES D'ETAT (WCAG 1.4.11, 3:1) ----------------
    // Regle de COMPORTEMENT, pas liste de noms : un element sans texte, sans
    // enfant, avec un fond peint, et une boite petite mais pas un filet (4 a
    // 28px dans les deux sens) est une pastille d'etat, pas une decoration.
    if (!el.children.length && !(el.textContent || '').trim()) {
      const r = el.getBoundingClientRect();
      if (r.width >= 4 && r.height >= 4 && r.width <= 28 && r.height <= 28) {
        const own = parse(cs.backgroundColor);
        if (own && own.a > 0.05) {
          const around = el.parentElement ? bgOf(el.parentElement) : bg;
          push(el, 'indicateur', own, around, 3, Math.round(r.width) + 'x' + Math.round(r.height) + 'px');
        }
      }
    }
  }
  return rows;
};
`;

// ---------------------------------------------------------------------------
// PERIMETRE : chaque ecran atteignable de la console.
// ---------------------------------------------------------------------------
const SCREENS = [
  // Journee
  { id: 'dashboard', label: "Vue d'ensemble", page: 'dashboard' },
  { id: 'planning-bowling', label: 'Planning > Bowling', page: 'planning', resource: 'bowling' },
  { id: 'planning-laser', label: 'Planning > Laser Game', page: 'planning', resource: 'laser' },
  { id: 'planning-all', label: 'Planning > Toutes', page: 'planning', resource: 'all' },
  { id: 'reservations', label: 'Reservations', page: 'reservations' },
  { id: 'formules', label: 'Formules', page: 'formules' },
  // Terrain : une page depuis le 2026-09-25 (Arrivees, En cours et
  // Evenements fondues en trois colonnes).
  { id: 'terrain', label: 'Terrain', page: 'arrivals' },
  // Clients & marketing
  { id: 'clients-all', label: 'Clients > Tous', page: 'clients', groupTab: 'all' },
  { id: 'clients-birthdays', label: 'Clients > A venir', page: 'clients', groupTab: 'birthdays' },
  { id: 'clients-regular', label: 'Clients > Fideles', page: 'clients', groupTab: 'regular' },
  { id: 'clients-business', label: 'Clients > Entreprises', page: 'clients', groupTab: 'business' },
  { id: 'clients-followup', label: 'Clients > A relancer', page: 'clients', groupTab: 'followup' },
  { id: 'emails', label: 'Emails & relances', page: 'emails' },
  { id: 'campaigns', label: 'Marketing', page: 'campaigns' },
  // Administration
  { id: 'prices', label: 'Activites > Tarifs & formules', page: 'prices' },
  { id: 'lanes', label: 'Activites > Pistes bowling', page: 'lanes' },
  { id: 'laserGame', label: 'Activites > Laser Game', page: 'laserGame' },
  { id: 'users', label: 'Equipe & acces', page: 'users' },
  { id: 'estab-centre', label: 'Etablissement > Le centre', page: 'establishment', estabTab: 'centre' },
  { id: 'estab-horaires', label: 'Etablissement > Horaires', page: 'establishment', estabTab: 'horaires' },
  { id: 'estab-offres', label: 'Etablissement > Offres', page: 'establishment', estabTab: 'offres' },
  { id: 'estab-clients', label: 'Etablissement > Clients & groupes', page: 'establishment', estabTab: 'clients' },
  { id: 'estab-regles', label: 'Etablissement > Regles & comptoir', page: 'establishment', estabTab: 'regles' },
  // Plateforme
  { id: 'cockpit-clients-platform', label: 'Plateforme > Clients Pinlane', page: 'cockpit-clients-platform' },
  { id: 'cockpit', label: 'Plateforme > Cockpit', page: 'cockpit' },
  { id: 'cockpit-centres', label: 'Plateforme > Centres', page: 'cockpit-centres' },
  { id: 'cockpit-agents', label: 'Plateforme > Agents IA', page: 'cockpit-agents' },
  { id: 'cockpit-ia', label: 'Plateforme > Apprentissage IA', page: 'cockpit-ia' },
  { id: 'cockpit-incidents', label: 'Plateforme > Incidents', page: 'cockpit-incidents' },
  { id: 'cockpit-journal', label: 'Plateforme > Journal', page: 'cockpit-journal' },
  // Direction
  { id: 'direction-overview', label: 'Direction > Synthese', view: 'admin', adminTab: 'overview' },
  { id: 'direction-data', label: 'Direction > Donnees', view: 'admin', adminTab: 'data' },
  { id: 'direction-mail', label: 'Direction > Emails', view: 'admin', adminTab: 'mail' },
  { id: 'direction-reservations', label: 'Direction > Reservations', view: 'admin', adminTab: 'reservations' },
  { id: 'direction-ops', label: 'Direction > Ops', view: 'admin', adminTab: 'ops' },
  { id: 'direction-exports', label: 'Direction > Exports', view: 'admin', adminTab: 'exports' },
];

// Plancher d'elements mesures par ecran : sous ce chiffre, l'ecran n'a pas
// rendu et son « zero echec » ne vaut rien.
const FLOOR = 12;

// Le theme de la console n'est PAS l'attribut data-theme : il est derive de
// state.staffTheme par applyStaffTheme(), et tout re-rendu le repose. Poser
// l'attribut a la main donnait un gate qui croyait mesurer le theme clair en
// mesurant le sombre : premiere version de ce fichier, 156 « echecs » tous
// releves deux fois dans le meme theme.
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    state.staffTheme = t === 'light' ? 'light' : 'dark';
    if (typeof applyStaffTheme === 'function') applyStaffTheme();
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(60);
}

async function assertTheme(page, theme) {
  const seen = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
  }));
  return seen.attr === theme && (theme === 'light' ? seen.surface === '#ffffff' : seen.surface === '#0a0a0a');
}

async function gotoScreen(page, s) {
  await page.evaluate(async (scr) => {
    const d = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    state.currentDate = d;
    state.adminCenterId = 'libramont';
    if (!state.reservations || !state.reservations.length) {
      state.reservations = window.__QA_RESERVATIONS__(d);
      state.laneStatuses = window.__QA_LANES__();
    }
    if (scr.view === 'admin') {
      state.adminTab = scr.adminTab || 'overview';
      setView('admin');
      if (typeof setAdminTab === 'function') setAdminTab(scr.adminTab || 'overview');
      if (typeof renderAdmin === 'function') renderAdmin();
      return;
    }
    state.staffMenuPage = scr.page;
    if (scr.resource) state.staffResourceView = scr.resource;
    if (scr.groupTab) state.staffGroupTab = scr.groupTab;
    if (scr.estabTab) state.establishmentTab = scr.estabTab;
    setView('staff');
    if (typeof loadStaffCenterConfig === 'function') { try { await loadStaffCenterConfig(true); } catch (e) {} }
    renderStaff();
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  }, s);
  await page.waitForTimeout(320);
}

async function sweep(page, label) {
  return page.evaluate((l) => window.__CONSOLE_CONTRAST__(l), label);
}

async function boot(page) {
  await installMock(page);
  await page.addInitScript(SWEEP);
  await page.goto(`${BASE_URL}/?v=contrast-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaff === 'function', null, { timeout: 20000 });
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    setView('staff');
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  });
  await page.waitForSelector('.fgx-menu-nav [data-fgx-menu-key="cockpit"]', { state: 'visible', timeout: 20000 });
}

// Fiche reservation : elle s'ouvre PAR-DESSUS le planning, ses fonds sont
// empiles, et c'est exactement le cas ou une declaration ment sur la composite.
async function openSheet(page, tab) {
  const opened = await page.evaluate((wanted) => {
    const row = document.querySelector('#planningGridWrap .booking') || document.querySelector('[data-reservation-id]');
    if (!row) return false;
    const id = Number(row.getAttribute('data-reservation-id') || row.dataset.reservationId || 9001);
    if (typeof window.openReservationSheet === 'function') { window.openReservationSheet(id, wanted); return true; }
    if (typeof window.openReservationDetail === 'function') { window.openReservationDetail(id); return true; }
    row.click();
    return true;
  }, tab);
  await page.waitForTimeout(400);
  return opened;
}

async function closeSheet(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(180);
}

function summarise(rows) {
  const fails = rows.filter((r) => r.ratio < r.required - 0.0001);
  const byPair = new Map();
  fails.forEach((r) => {
    const k = `${r.fg} sur ${r.bg}`;
    if (!byPair.has(k)) byPair.set(k, { pair: k, ratio: r.ratio, required: r.required, count: 0, screens: new Set(), sels: new Set() });
    const e = byPair.get(k);
    e.count += 1; e.screens.add(r.screen); e.sels.add(r.sel);
    e.ratio = Math.min(e.ratio, r.ratio);
  });
  return { fails, byPair: [...byPair.values()].sort((a, b) => a.ratio - b.ratio) };
}

// ---------------------------------------------------------------------------
// [0] CONTROLES STATIQUES. Le balayage ne voit que ce qui est RENDU : une regle
// CSS fautive dans un ecran qu'aucun jeu de donnees n'allume lui echappe. Ces
// deux controles-la lisent la feuille elle-meme, donc ils couvrent tout.
// ---------------------------------------------------------------------------
const SRGB = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const LUM = (hex) => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16); const g = parseInt(n.slice(2, 4), 16); const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * SRGB(r) + 0.7152 * SRGB(g) + 0.0722 * SRGB(b);
};
const RATIO = (a, b) => { const l1 = LUM(a); const l2 = LUM(b); const hi = Math.max(l1, l2); const lo = Math.min(l1, l2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
// Clarte perceptuelle CIE L* : c'est elle qui dit si une hierarchie tient, pas
// le rapport de contraste (deux gris peuvent passer AA et etre indiscernables).
const LSTAR = (hex) => { const y = LUM(hex); return Math.round((y <= 0.008856 ? 903.3 * y : 116 * Math.cbrt(y) - 16) * 10) / 10; };

function readDesignTokens() {
  const design = fs.readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');
  const bloc = design.slice(design.indexOf('colors:'), design.indexOf('typography:'));
  const read = (mode) => {
    const start = bloc.indexOf(`  ${mode}:`);
    const end = mode === 'light' ? bloc.indexOf('  dark:') : bloc.length;
    const b = bloc.slice(start, end === -1 ? bloc.length : end);
    const t = {};
    [...b.matchAll(/^\s{4}([a-z0-9-]+):\s*"(#[0-9a-fA-F]{6})"/gm)].forEach((m) => { t[m[1]] = m[2].toLowerCase(); });
    return t;
  };
  return { light: read('light'), dark: read('dark') };
}

function readProductTokens() {
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'pinlane.css'), 'utf8');
  const lightBloc = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='dark']"));
  const darkBloc = css.slice(css.indexOf("[data-theme='dark']"), css.indexOf('3. RESET'));
  const read = (b) => {
    const t = {};
    [...b.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].forEach((m) => { t[m[1]] = m[2].toLowerCase(); });
    return t;
  };
  return { light: read(lightBloc), dark: read(darkBloc) };
}

function staticChecks() {
  console.log('\n[0] CONTROLES STATIQUES sur la feuille elle-meme');

  // (a) DESIGN.md est la source d'autorite : le produit ne derive pas d'elle.
  // La demonstration etait deja confrontee a DESIGN.md, le PRODUIT ne l'etait
  // pas : `--faint` valait #8f8f8f dans le document et #6f6f6f dans la console.
  const design = readDesignTokens();
  const prod = readProductTokens();
  ['light', 'dark'].forEach((mode) => {
    const cles = Object.keys(design[mode]).filter((k) => prod[mode][k] !== undefined);
    const div = cles.filter((k) => prod[mode][k] !== design[mode][k]);
    ok(cles.length >= 15, `[${mode}] ${cles.length} jetons du produit confrontes a DESIGN.md`);
    ok(div.length === 0, `[${mode}] chaque jeton du produit vaut ce que DESIGN.md declare${div.length ? ' :: ' + div.map((k) => `${k}: css ${prod[mode][k]} vs design ${design[mode][k]}`).join(' | ') : ''}`);
  });

  // (b) Aucun fond `-soft` ne porte le jeton PLEIN comme couleur de texte : le
  // couple accent/accent-soft plafonne a 4:1, et le systeme a deja un jeton
  // pour ce role, `-strong`. Ce controle-la est STATIQUE parce qu'un ecran qui
  // n'est pas rendu ne se mesure pas : le balayage n'en voyait que 5 sur 21.
  // Le fond et la couleur ne sont PAS toujours dans la meme regle : sur l'ecran
  // Equipe & acces, `.staff-permission-toggle.is-on` peint le fond et
  // `.staff-permission-toggle.is-on small` pose le texte. Un controle limite a
  // la meme regle est le meme angle mort, en plus petit : on collecte donc les
  // selecteurs qui PEIGNENT un fond -soft, puis on regarde tout selecteur qui
  // en DESCEND.
  const FILES = ['assets/pinlane.css', 'assets/pinlane-staff.css', 'assets/pinlane-charts.css', 'assets/pinlane-daterange.css', 'assets/pinlane-analytics-board.css'];
  const regles = [];
  FILES.forEach((f) => {
    const css = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const selRaw = m[1].trim().split('\n').pop().trim();
      if (!selRaw || selRaw.startsWith('@')) continue;
      selRaw.split(',').forEach((s) => {
        regles.push({
          f, ligne: css.slice(0, m.index).split('\n').length, sel: s.trim(), body: m[2],
          softBg: /background[^;]*:\s*[^;]*var\(--(accent|info)-soft\)/.test(m[2]),
          plainText: /(^|;)\s*color:\s*var\(--(accent|info)\)\s*(;|$)/.test(m[2]),
        });
      });
    }
  });
  const fonds = regles.filter((r) => r.softBg).map((r) => r.sel);
  const descend = (enfant, parent) => {
    if (enfant === parent) return true;
    if (!enfant.startsWith(parent)) return false;
    return /[\s.:>#[]/.test(enfant.charAt(parent.length));
  };
  const fautifs = regles
    .filter((r) => r.plainText && fonds.some((p) => descend(r.sel, p)))
    .map((r) => `${r.f}:${r.ligne} ${r.sel.slice(0, 70)}`);
  ok(fautifs.length === 0, `aucune regle ne pose --accent/--info en TEXTE sur un fond -soft (${fautifs.length} trouvee(s))`);
  if (fautifs.length) fautifs.slice(0, 25).forEach((l) => console.log(`     ${l}`));

  // (c) Les paires de jetons declarees par le systeme tiennent AA, calculees et
  // pas supposees. Le fond le plus SOMBRE qu'un texte tertiaire ait le droit
  // d'habiter en clair est --accent-soft, pas --subtle : c'est ce que l'audit
  // du 2026-08-14 a montre, et c'est ce que ce controle fige.
  const PAIRES = [
    ['light', 'faint', 'subtle', 4.5], ['light', 'faint', 'accent-soft', 4.5],
    ['light', 'faint', 'surface', 4.5], ['light', 'faint', 'page', 4.5],
    ['light', 'muted', 'subtle', 4.5], ['light', 'muted', 'accent-soft', 4.5],
    ['light', 'accent-strong', 'accent-soft', 4.5], ['light', 'success', 'success-soft', 4.5],
    ['light', 'warning', 'warning-soft', 4.5], ['light', 'danger', 'danger-soft', 4.5],
    ['dark', 'faint', 'subtle', 4.5], ['dark', 'faint', 'accent-soft', 4.5],
    ['dark', 'faint', 'surface', 4.5], ['dark', 'faint', 'raised', 4.5],
    ['dark', 'muted', 'subtle', 4.5], ['dark', 'muted', 'accent-soft', 4.5],
    ['dark', 'accent-strong', 'accent-soft', 4.5], ['dark', 'success', 'success-soft', 4.5],
    ['dark', 'warning', 'warning-soft', 4.5], ['dark', 'danger', 'danger-soft', 4.5],
    ['light', 'control-border', 'surface', 3], ['light', 'control-border', 'page', 3], ['light', 'control-border', 'subtle', 3],
    ['dark', 'control-border', 'surface', 3], ['dark', 'control-border', 'page', 3],
    ['dark', 'control-border', 'raised', 3], ['dark', 'control-border', 'subtle', 3],
  ];
  PAIRES.forEach(([mode, fg, bg, req]) => {
    const a = prod[mode][fg]; const b = prod[mode][bg];
    if (!a || !b) { ok(false, `[${mode}] le jeton --${fg} ou --${bg} n'existe pas`); return; }
    const r = RATIO(a, b);
    ok(r >= req, `[${mode}] --${fg} sur --${bg} : ${r}:1 (requis ${req}:1)`);
  });

  // (d) LA HIERARCHIE NE S'APLATIT PAS. Passer le seuil en rapprochant tous les
  // gris est le contournement evident de ce gate ; cette regle l'interdit. Six
  // unites de L* separent deux rangs de texte, sinon ils sont indiscernables.
  const MIN_DL = 4.5;
  ['light', 'dark'].forEach((mode) => {
    const t = LSTAR(prod[mode].text); const m = LSTAR(prod[mode].muted); const f = LSTAR(prod[mode].faint);
    const ordre = mode === 'light' ? (t < m && m < f) : (t > m && m > f);
    ok(ordre, `[${mode}] l'ordre text > muted > faint tient (L* ${t} / ${m} / ${f})`);
    ok(Math.abs(m - f) >= MIN_DL, `[${mode}] muted et faint restent distinguables : ${Math.round(Math.abs(m - f) * 10) / 10} L* (minimum ${MIN_DL})`);
    ok(Math.abs(t - m) >= MIN_DL, `[${mode}] text et muted restent distinguables : ${Math.round(Math.abs(t - m) * 10) / 10} L* (minimum ${MIN_DL})`);
  });
}

async function main() {
  staticChecks();
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const all = [];
  try {
    await boot(page);
    console.log('\n[1] BALAYAGE DE TOUTE LA CONSOLE, dans les DEUX themes');
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      ok(await assertTheme(page, theme), `le theme ${theme} est REELLEMENT applique avant de mesurer`);
      for (const s of SCREENS) {
        await gotoScreen(page, s);
        await setTheme(page, theme); // un re-rendu repose le theme depuis state
        const label = `${theme} · ${s.label}`;
        const rows = await sweep(page, label);
        all.push(...rows);
        ok(rows.length >= FLOOR, `${label} : ${rows.length} elements mesures (plancher ${FLOOR})`);
        // Les surfaces qui s'ouvrent par-dessus le planning : leurs fonds sont
        // EMPILES, c'est exactement le cas ou une declaration ment.
        if (s.id === 'planning-bowling') {
          for (const t of ['infos', 'edit']) {
            if (await openSheet(page, t)) {
              const sub = await sweep(page, `${theme} · Fiche reservation (${t})`);
              all.push(...sub);
              ok(sub.length >= FLOOR, `${theme} · Fiche reservation (${t}) : ${sub.length} elements mesures`);
              await closeSheet(page);
            }
          }
          await gotoScreen(page, s);
          await setTheme(page, theme);
          // Messages transitoires : le bandeau de confirmation et la carte de
          // nouvelle reservation vivent au-dessus de tout, jamais mesures avant.
          const msgs = await page.evaluate(() => {
            let n = 0;
            if (typeof toast === 'function') { toast('Reservation enregistree'); n += 1; }
            if (typeof notifyNewReservation === 'function') {
              try { notifyNewReservation({ id: 9999, name: 'Nouvelle famille', startTime: '21:00', label: 'Bowling classique', pax: 5 }); n += 1; } catch (e) {}
            }
            return n;
          });
          if (msgs > 0) {
            await page.waitForTimeout(200);
            const sub = await sweep(page, `${theme} · Messages (bandeau + nouvelle reservation)`);
            all.push(...sub);
            ok(sub.length >= FLOOR, `${theme} · Messages : ${sub.length} elements mesures`);
            await page.evaluate(() => {
              document.getElementById('toast')?.classList.add('hidden');
              const r = document.getElementById('newResNotifs'); if (r) r.innerHTML = '';
            });
          }
        }
      }
    }

    console.log('\n[2] ECHECS DE CONTRASTE (4.5:1 texte · 3:1 grand texte et controles)');
    const { fails, byPair } = summarise(all);
    console.log(`     ${all.length} mesures au total, ${fails.length} sous le seuil, ${byPair.length} paires de couleur fautives`);
    byPair.forEach((p) => {
      const screens = [...p.screens].slice(0, 4).join(' / ');
      console.log(`     ${p.pair} : ${p.ratio}:1 (requis ${p.required}:1) x${p.count} · ${[...p.sels].slice(0, 3).join(', ')} · ${screens}${p.screens.size > 4 ? ' …' : ''}`);
    });
    ok(fails.length === 0, `aucun echec AA sur toute la console : ${fails.length} echec(s)`);

    console.log('\n[3] CONTRE-EPREUVE PAR MUTATION : le balayage doit ROUGIR quand un jeton se degrade');
    // Sans elle, « 0 echec » peut vouloir dire « le balayage ne mesure rien ».
    // La mutation se joue dans les DEUX themes, avec des gris qui se rapprochent
    // du fond DE CE THEME : degrader vers le clair sur un fond noir ne prouve
    // rien, et c'est le piege dans lequel la premiere version est tombee.
    const MUTATIONS = {
      // The console now declares these tokens on its body. Mutating :root
      // only changes an inherited fallback and leaves the rendered staff
      // palette intact, yielding a false counterexample (zero -> zero).
      light: 'body:is(.staff-mode,.admin-mode){--muted:#cfcfcf !important;--faint:#d6d6d6 !important;--text:#b4b4b4 !important;}',
      dark: 'body:is(.staff-mode,.admin-mode){--muted:#242424 !important;--faint:#202020 !important;--text:#2a2a2a !important;}',
    };
    for (const theme of ['light', 'dark']) {
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForFunction(() => typeof window.renderStaff === 'function', null, { timeout: 20000 });
      await page.evaluate(() => { if (typeof hasSavedAuth === 'function') hasSavedAuth(); setView('staff'); });
      await setTheme(page, theme);
      await gotoScreen(page, SCREENS[1]);
      await setTheme(page, theme);
      const before = (await sweep(page, `mutation-avant-${theme}`)).filter((r) => r.ratio < r.required).length;
      const originalTokens = await page.evaluate(() => ['--text', '--muted', '--faint'].map(token => getComputedStyle(document.body).getPropertyValue(token).trim()));
      const mutationStyle = await page.addStyleTag({ content: MUTATIONS[theme] });
      await page.waitForTimeout(150);
      const mutatedTokens = await page.evaluate(() => ['--text', '--muted', '--faint'].map(token => getComputedStyle(document.body).getPropertyValue(token).trim()));
      const expectedTokens = theme === 'light' ? ['#b4b4b4', '#cfcfcf', '#d6d6d6'] : ['#2a2a2a', '#242424', '#202020'];
      ok(mutatedTokens.every((token, index) => token === expectedTokens[index] && token !== originalTokens[index]), `${theme} : la mutation atteint les trois jetons effectivement resolus sur la console`);
      const after = (await sweep(page, `mutation-apres-${theme}`)).filter((r) => r.ratio < r.required).length;
      console.log(`     FAIL attendu : ${theme}, jetons degrades, echecs ${before} -> ${after}`);
      ok(after >= before + 10, `${theme} : la mutation des jetons fait rougir le balayage (${before} -> ${after})`);
      await mutationStyle.evaluate(style => style.remove());
      // Let color transitions finish before comparing the restored palette.
      await page.waitForTimeout(300);
      const restored = (await sweep(page, `mutation-restauree-${theme}`)).filter((r) => r.ratio < r.required).length;
      ok(restored === before, `${theme} : retirer la mutation restaure exactement le resultat AA (${restored} == ${before})`);
    }
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});

    if (JSON_OUT) {
      fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify(all, null, 1), 'utf8');
      console.log(`\n     mesures completes ecrites dans ${JSON_OUT}`);
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${failures === 0 ? 'OK' : 'ECHEC'} : ${failures} verification(s) rouge(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
