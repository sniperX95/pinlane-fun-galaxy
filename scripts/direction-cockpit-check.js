// Test INTERACTIF du POSTE D'OBSERVATION Direction (refonte 2026-07-21, vue
// #adminView, DOM d'accueil #adminContent, namespace dir-*).
//
// Playwright pilote de VRAIS clics et un vrai composant de plage sur une session
// direction mockee. Une assertion de PRESENCE de chaine serait un faux vert
// (dix precedents dans ce depot) : on rend la page, on interagit, on lit le DOM
// et le RESEAU.
//
// Ce qui est PROUVE en comportement :
//   [1] SHELL honnete : le hero porte le NOM DU CENTRE, le bandeau « donnees de
//       test » s'affiche parce que le SERVEUR l'a dit, la barre de controle et le
//       libelle de fenetre ont une hauteur reelle > 0 (barre de titre non
//       effondree : le piege body.admin-mode header{height:0} n'est pas touche
//       car la page n'emet aucun <header>).
//   [2] BARRE DE PLAGE (window.PinlaneDateRange) : montee, 3 controles focalisables,
//       hauteur > 0. Le composant reel est charge s'il existe, sinon un STUB
//       minimal conforme au contrat est injecte.
//   [3] RANGEE KPI : 6 tuiles dir-kpi, la valeur (countUp) lit le total serveur
//       exact, et chaque delta est la DIFFERENCE EXACTE des totals mockes
//       (courant vs previous), jamais un pourcentage sur base 0.
//   [4] GRAND GRAPHIQUE FOCUS : un SVG a hauteur > 0 dont le path compte
//       EXACTEMENT un point par jour servi par le mock (fenetre = granularite).
//   [5] INTERACTIVITE : cliquer une tuile KPI (Joueurs) change la metrique du
//       graphique focus : le path CHANGE et l'etat focus devient 'pax'.
//   [6] CHANGER LA PLAGE via le composant refait UN fetch directionAnalytics avec
//       les BONNES dates et re-rend : le focus compte alors les jours de la
//       NOUVELLE fenetre. Basculer la comparaison (previous/none) NE refait AUCUN
//       fetch (le bloc previous voyage avec l'analytique) et bascule les deltas.
//   [7] ABSENCE : plus AUCUN onglet ni pave « Signaux/Verifications continues/
//       Cockpit operationnel/Synthese executive » dans #adminContent, plus aucune
//       classe de l'ancien namespace (admin-panel/admin-kpi/ops-cockpit/
//       admin-health-panel/adm-trend-panel/admin-tabs) : mesure par querySelector.
//   [8] aucune erreur console fatale.
//  [8bis] LA MECANIQUE DU GATE LUI-MEME : un clic sur une cible absente sort en
//       « FAIL » NOMME dans une borne courte, il ne LEVE plus. Mesure du
//       2026-09-03 : la vue « Mes centres » avait disparu du nav, page.click a
//       attendu 30 s puis leve, et tout le reste du gate n'a pas tourne. La
//       sonde retire une pilule du DOM d'une page a part et verifie que le geste
//       rend un constat au lieu d'une exception, et que la page reste pilotable.
//   [9] CONTRE-PREUVE PAR MUTATION : on mute assets/admin-console.js (serie du
//       focus amputee d'un jour ; delta decale de 1), on verifie que les
//       invariants [4] et [3] ROUGISSENT sur une page fraiche, puis restauration
//       par EDITION INVERSE (reecriture du contenu exact d'origine, jamais git
//       checkout). Une mutation sans effet fait sortir le script en erreur.
//
// NOTE librairies : window.PinlaneCharts (assets/pinlane-charts.js) existe et est
// servi tel quel (le focus/les mini-courbes tracent des SVG reels). Le composant
// window.PinlaneDateRange (assets/pinlane-daterange.js) est construit en
// parallele : s'il est absent, un STUB conforme au contrat est injecte
// (mount rend 3 boutons, getValue/setValue marchent, onChange declenchable via
// window.__pinlaneDirRangeEmit).
//
// Captures : PINLANE_DIRECTION_SHOTS=<dossier> ecrit desktop 1400 + mobile 390
// dans les deux themes (bascule par setStaffTheme, le SEUL chemin qui pose
// data-theme).
//
// Lancement : node scripts/direction-cockpit-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DIRECTION_PORT || 4233);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// La refonte 2026-07-21 classe la page en VUES et STANDARDISE la hauteur des
// graphes de grille. Le cadrage vit dans une CSS livree a part (scratchpad ->
// a coller dans pinlane-staff.css par l'integrateur). Tant qu'elle n'est pas
// cablee, le gate l'injecte (meme logique que le stub du composant de plage) :
// on teste la page telle qu'elle sera une fois la CSS collee. C'est cette CSS
// qui rend les hauteurs de grille EGALES (240px) ; sans elle, chaque type de
// graphe garde sa hauteur naturelle et la standardisation ne se verifie pas.
const GATE_DIR_SIZING_CSS = `
  .dir-body { display: flex; flex-direction: column; gap: 16px; }
  .dir-view { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
  .dir-grid .dir-chart {
    height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .dir-grid .dir-chart > * { width: 100%; }
  .dir-grid .dir-chart.dir-chart-heat {
    height: auto;
    min-height: 180px;
    display: block;
    overflow: visible;
  }
  .dir-focus-chart { min-height: 200px; }
  .dir-nav {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    width: fit-content;
    max-width: 100%;
  }
  .dir-nav-indicator {
    position: absolute;
    top: 4px; bottom: 4px; left: 4px;
    width: calc((100% - 8px) / var(--dir-nav-count, 4));
    transform: translateX(calc(var(--dir-nav-index, 0) * 100%));
    pointer-events: none;
  }
  .dir-nav-pill { position: relative; z-index: 1; border: 0; background: transparent; padding: 8px 16px; cursor: pointer; font-family: inherit; }
  .dir-prov-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
  .dir-prov-card-wide { grid-column: 1 / -1; }
  .dir-prov-occ { height: 240px; margin-bottom: 14px; }
  .dir-prov-occ > * { height: 100%; }
  .dir-prov-occ .plc-svg { width: 100%; height: 100%; }
`;

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Stubs servis UNIQUEMENT si le fichier reel n'existe pas encore (librairies
// construites en parallele). Le stub charts n'est utilise que si
// assets/pinlane-charts.js manque (il existe ici, donc jamais). Le stub
// daterange CSS/JS couvre le cas ou l'integrateur aurait ajoute les <link>/
// <script> avant la livraison de la vraie lib.
const STUB_ASSETS = {
  '/assets/pinlane-charts.css': { type: 'text/css; charset=utf-8', body: '/* stub gate */' },
  '/assets/pinlane-daterange.css': { type: 'text/css; charset=utf-8', body: '/* stub gate : composant en cours de construction */' },
  '/assets/pinlane-daterange.js': { type: 'text/javascript; charset=utf-8', body: '/* stub gate : le vrai composant est injecte par addInitScript */' },
};

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) {
        const stub = STUB_ASSETS[url.pathname];
        if (stub) {
          res.writeHead(200, { 'Content-Type': stub.type, 'Cache-Control': 'no-store' });
          res.end(stub.body);
          return;
        }
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const DATERANGE_REAL_PATH = path.join(ROOT, 'assets', 'pinlane-daterange.js');
const DATERANGE_REAL_EXISTS = fs.existsSync(DATERANGE_REAL_PATH);

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  // Le composant de plage vit dans son propre fichier. Tant que l'integrateur
  // n'a pas ajoute le <script> a index.html, on l'injecte ici (etat integre
  // simule) : le gate teste la page telle qu'elle sera une fois cablee. Si le
  // fichier reel n'existe pas encore, un STUB conforme est injecte plus bas.
  if (DATERANGE_REAL_EXISTS) {
    await page.addInitScript({ path: DATERANGE_REAL_PATH });
  }
  await page.addInitScript(({ expiresAt, injectStub }) => {
    // ---- STUB window.PinlaneDateRange (conforme au contrat) ---------------
    // Injecte AVANT tout script de page. Si la vraie lib est chargee ensuite
    // par un <script> de index.html, elle ecrasera ce stub (addInitScript passe
    // en premier). mount rend 3 controles, getValue/setValue marchent, et
    // window.__pinlaneDirRangeEmit(next) declenche onChange avec une valeur
    // precise (fenetre deterministe pour les assertions reseau).
    if (injectStub) {
      const resolveHost = (h) => (typeof h === 'string' ? document.getElementById(h) : h);
      const granLabel = (g) => ({ day: 'jour', week: 'semaine', month: 'mois' }[g] || 'jour');
      window.PinlaneDateRange = {
        mount(host, opts) {
          const el = resolveHost(host);
          if (!el) return { getValue() { return null; }, setValue() {}, destroy() {} };
          const options = opts || {};
          let value = Object.assign({ start: '', end: '', granularity: 'day', compare: 'previous' }, options.value || {});
          const onChange = typeof options.onChange === 'function' ? options.onChange : function () {};
          function render() {
            el.innerHTML =
              '<button type="button" class="pdr-pill" data-role="range">Plage de dates | ' + value.start + ' → ' + value.end + ' ⌄</button>'
              + '<button type="button" class="pdr-pill" data-role="gran">Par ' + granLabel(value.granularity) + ' ⌄</button>'
              + '<button type="button" class="pdr-toggle" data-role="compare" aria-pressed="' + (value.compare !== 'none') + '">Comparer</button>';
            el.querySelector('[data-role="range"]').addEventListener('click', function () {
              const end = options.maxDate || value.end;
              const d = new Date(end + 'T00:00:00Z');
              d.setUTCDate(d.getUTCDate() - 6);
              emit({ start: d.toISOString().slice(0, 10), end, granularity: value.granularity, compare: value.compare });
            });
            el.querySelector('[data-role="gran"]').addEventListener('click', function () {
              const order = ['day', 'week', 'month'];
              const next = order[(order.indexOf(value.granularity) + 1) % order.length];
              emit({ start: value.start, end: value.end, granularity: next, compare: value.compare });
            });
            el.querySelector('[data-role="compare"]').addEventListener('click', function () {
              emit({ start: value.start, end: value.end, granularity: value.granularity, compare: value.compare === 'none' ? 'previous' : 'none' });
            });
          }
          function emit(next) {
            value = Object.assign({}, value, next);
            render();
            onChange(Object.assign({}, value));
          }
          render();
          window.__pinlaneDirRangeEmit = emit;
          window.__pinlaneDirRangeValue = () => Object.assign({}, value);
          return {
            getValue() { return Object.assign({}, value); },
            setValue(v) { value = Object.assign({}, value, v); render(); },
            destroy() { el.innerHTML = ''; if (window.__pinlaneDirRangeEmit === emit) window.__pinlaneDirRangeEmit = null; },
          };
        },
      };
    }

    // ---- Session direction VERROUILLEE (tous droits du centre), sans platform
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'emails.view', 'emails.send', 'campaigns.manage', 'marketing.agents', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Sophie', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = (() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })();
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });

    const reservations = [
      { id: 1, centerId: 'libramont', date: today, startTime: '14:00', duration: 1, name: 'Famille Dubois', phone: '+32470000001', email: 'a@x.be', status: 'pending', pax: 4, price: 60, type: 'bowling', lanes: [1] },
      { id: 2, centerId: 'libramont', date: today, startTime: '16:00', duration: 1, name: 'Anniversaire Lena', phone: '+32470000002', email: 'b@x.be', status: 'paid', pax: 8, price: 180, type: 'formule', formuleId: 'f1' },
      { id: 3, centerId: 'libramont', date: today, startTime: '18:00', duration: 1, name: 'Club Laser', phone: '+32470000003', email: 'c@x.be', status: 'arrived', pax: 10, price: 150, type: 'laser' },
    ];
    const communications = [
      { id: 1, centerId: 'libramont', channel: 'email', templateId: 'confirmation', recipient: 'a@x.be', subject: 'Confirmation', status: 'sent', sentAt: new Date().toISOString() },
      { id: 2, centerId: 'libramont', channel: 'email', templateId: 'reminder_48h', recipient: 'b@x.be', subject: 'Rappel', status: 'queued', scheduledAt: new Date().toISOString() },
    ];

    // Fixtures DETERMINISTES directionAnalytics : une ligne par jour de la
    // fenetre DEMANDEE, formules fixes, zero aleatoire. window.__DIR_SERVED__
    // enregistre ce qui a ete servi par fenetre (jours, totals, prevTotals,
    // nombre d'appels) : les assertions comparent le DOM a ce registre.
    const dirAddDays = (dateStr, days) => {
      const d = new Date(`${dateStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const buildDirectionFixture = (startDate, endDate) => {
      const daily = [];
      const monthlyMap = {};
      for (let d = startDate, i = 0; d <= endDate; d = dirAddDays(d, 1), i += 1) {
        const row = { date: d, count: 2 + (i % 4), revenue: 100 + i * 10, pax: 8 + (i % 5), cancelled: i % 2 };
        daily.push(row);
        const mk = d.slice(0, 7);
        monthlyMap[mk] = monthlyMap[mk] || { month: mk, count: 0, revenue: 0, pax: 0, cancelled: 0 };
        monthlyMap[mk].count += row.count; monthlyMap[mk].revenue += row.revenue;
        monthlyMap[mk].pax += row.pax; monthlyMap[mk].cancelled += row.cancelled;
      }
      const sum = (pick) => daily.reduce((s, r) => s + pick(r), 0);
      const totals = {
        reservations: sum((r) => r.count), revenue: sum((r) => r.revenue), pax: sum((r) => r.pax),
        cancelled: sum((r) => r.cancelled), cancelRate: 4.2, avgBasket: 38.5, paid: 10, paymentRate: 40, days: daily.length,
      };
      const prevTotals = {
        reservations: totals.reservations - 7, revenue: totals.revenue - 640, pax: totals.pax - 25,
        cancelled: 0, cancelRate: 0, avgBasket: 0, paid: 0, paymentRate: 0, days: daily.length,
      };
      const heatmap = Array.from({ length: 7 }, (_, wd) => ({ 14: wd + 1, 18: 2 + (wd % 3), 20: 1 }));
      return {
        analytics: {
          startDate, endDate, totals, daily, monthly: Object.values(monthlyMap),
          weekly: [{ weekStart: startDate, label: 'S1', count: totals.reservations, revenue: totals.revenue, pax: totals.pax, cancelled: totals.cancelled }],
          byType: {
            bowling: { count: 12, revenue: 720, pax: 44 },
            laser: { count: 6, revenue: 480, pax: 40 },
            formule: { count: 4, revenue: 640, pax: 30 },
          },
          byFormule: [
            { id: 'f1', label: 'Anniversaire', count: 3, revenue: 420, pax: 24 },
            { id: 'f2', label: 'Team building', count: 1, revenue: 220, pax: 10 },
          ],
          byOccasion: [{ occasion: 'anniversaire', count: 3 }],
          byChannel: [{ channel: 'en ligne', count: 14 }, { channel: 'staff', count: 10 }],
          heatmap,
          occupancy: { scope: 'bowling', bookedLaneHours: 42, capacityLaneHours: 320, rate: 13.1 },
          clients: {
            unique: 9, new: 4, returning: 5, returningRate: 55.6, multi: 2,
            top: [
              { key: 'p:470000009', name: 'Famille Test', phone: '+32470000009', email: 't@x.be', visits: 3, revenue: 210, pax: 6, firstVisit: startDate, lastVisit: endDate, favorite: 'bowling' },
              { key: 'p:470000010', name: 'Ecole Saint-Jean', phone: '+32470000010', email: 'e@x.be', visits: 2, revenue: 480, pax: 40, firstVisit: startDate, lastVisit: endDate, favorite: 'laser' },
            ],
          },
        },
        previous: {
          startDate: dirAddDays(startDate, -daily.length), endDate: dirAddDays(startDate, -1),
          totals: prevTotals,
          clients: { unique: 5, returning: 3 },
        },
      };
    };

    window.__OPS_CALLS__ = [];
    window.__DIR_SERVED__ = {};
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Sophie', contact: 's@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations, laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') {
        window.__OPS_CALLS__.push(u.pathname + u.search);
        return J({ ok: true, reservations, laneStatuses: lanes(), centerId: 'libramont' });
      }
      if (u.pathname === '/api/marketing-agents') return J({ ok: true, centers: [], updatedAt: new Date().toISOString() });
      if (u.pathname === '/api/ops' && m === 'GET') {
        window.__OPS_CALLS__.push(u.pathname + u.search);
        const action = u.searchParams.get('action') || '';
        if (action === 'communications') return J({ ok: true, communications });
        if (action === 'emailSamples') return J({ ok: true, samples: [] });
        if (action === 'suggestions') return J({ ok: true, suggestions: [] });
        if (action === 'events') return J({ ok: true, events: [] });
        if (action === 'agentStack') return J({ ok: true, stack: null, orchestration: null, ecosystem: null });
        if (action === 'health') return J({ ok: true, health: { communications: { sent: 1, queued: 1, failed: 0 }, delayIncidents: [] }, audit: { ok: true }, testData: true });
        if (action === 'auditLog') return J({ ok: true, centerId: 'libramont', entries: [], audit: { written: 0, failed: 0 } });
        if (action === 'knowledge') return J({ ok: true });
        if (action === 'directionAnalytics') {
          const winStart = u.searchParams.get('startDate') || today;
          const winEnd = u.searchParams.get('endDate') || today;
          const fixture = buildDirectionFixture(winStart, winEnd);
          const winKey = `${winStart}|${winEnd}`;
          const record = window.__DIR_SERVED__[winKey] || {
            days: fixture.analytics.daily.length,
            totals: fixture.analytics.totals,
            prevTotals: fixture.previous.totals,
            calls: 0,
          };
          record.calls += 1;
          window.__DIR_SERVED__[winKey] = record;
          return J({ ok: true, centerId: 'libramont', analytics: fixture.analytics, previous: fixture.previous });
        }
        // SECTIONS DE DECISION : fixtures DETERMINISTES (2 centres, 1 dormant),
        // servies pour toute fenetre. Le front ne recalcule rien : ces chiffres
        // atterrissent tels quels dans le DOM. Elles alimentent la contre-preuve.
        if (action === 'directionComparison') {
          return J({
            ok: true,
            testData: true,
            selfCenterId: 'libramont',
            centers: [
              { id: 'libramont', name: 'Libramont', reservations: 30, revenue: 4200, pax: 180, avgBasket: 42, occupancy: 61, clientsUnique: 24, isCurrent: true },
              { id: 'marche', name: 'Marche-en-Famenne', reservations: 22, revenue: 5100, pax: 150, avgBasket: 51, occupancy: 48, clientsUnique: 19, isCurrent: false },
            ],
          });
        }
        if (action === 'directionRetention') {
          return J({
            ok: true,
            testData: true,
            segment: { unique: 24, new: 14, returning: 10, returningRate: 41.7, multi: 4, avgBasketNew: 38, avgBasketReturning: 52 },
            lapsed: [
              { name: 'Famille Martin', phone: '+32470000020', email: 'martin@x.be', visits: 5, revenue: 640, lastVisit: dirAddDays(today, -95) },
            ],
            lapsedSinceDays: 60,
            topClients: [],
          });
        }
        // PROVENANCE : occasion declaree, canal, source marketing. Fixtures
        // DETERMINISTES (2 occasions, 2 canaux, 1 source), servies pour toute
        // fenetre. hasDeclaredOccasion/hasSource vrais (il y a de quoi tracer).
        // demographicsConnected FAUX : la carte Audience doit rester « a
        // connecter » (aucun chiffre d'age/sexe/zone). Le front ne recalcule
        // rien : ces chiffres atterrissent tels quels dans le DOM.
        if (action === 'directionAudience') {
          return J({
            ok: true,
            testData: true,
            totalReservations: 30,
            occasions: [
              { key: 'anniversaire', label: 'Anniversaire', count: 18, revenue: 2160, pax: 96, share: 60 },
              { key: 'team-building', label: 'Team building', count: 12, revenue: 1440, pax: 60, share: 40 },
            ],
            channels: [
              { key: 'en-ligne', label: 'En ligne', count: 21, revenue: 2520, share: 70 },
              { key: 'staff', label: 'Staff (sur place / tel.)', count: 9, revenue: 1080, share: 30 },
            ],
            sources: [
              { key: 'utm:meta-anniv', label: 'Meta Ads (anniversaire)', count: 7, revenue: 840, share: 100 },
            ],
            hasDeclaredOccasion: true,
            hasSource: true,
            demographicsSource: 'google-analytics',
            demographicsConnected: false,
          });
        }
        if (action === 'directionReports') return J({ ok: true, centerId: 'libramont', reports: [] });
        return J({ ok: true, entries: [], communications: [], samples: [], suggestions: [], events: [] });
      }
      if (u.pathname === '/api/ops' && m === 'POST') return J({ ok: true });
      if (u.pathname === '/api/simulation') { window.__OPS_CALLS__.push(u.pathname + u.search); return J({ ok: true, status: 'idle', simulation: null }); }
      if (u.pathname === '/api/public-booking-meta') {
        return J({ ok: true, today, durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: {}, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, injectStub: !DATERANGE_REAL_EXISTS });
}

// Compte les points ON-CURVE d'un attribut d de path SVG (M/L/H/V/C/S/Q/T,
// repetitions implicites comprises).
function countPathPoints(d) {
  const tokens = String(d || '').replace(/,/g, ' ').match(/[A-DF-Za-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const paramsPerPoint = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4 };
  let cmd = '';
  let points = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) { cmd = t.toUpperCase(); i += 1; continue; }
    const need = paramsPerPoint[cmd];
    if (!need) break;
    i += need;
    points += 1;
    if (cmd === 'M') cmd = 'L';
  }
  return points;
}

// Booter la page jusqu'au poste d'observation Direction rendu (6 tuiles KPI +
// focus trace). Reutilise par le harnais principal et par la contre-preuve.
async function bootDirection(page) {
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=dir-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  // CSS de cadrage des vues injectee (dir-views.css a venir dans pinlane-staff.css).
  await page.addStyleTag({ content: GATE_DIR_SIZING_CSS });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    state.adminTab = 'overview';
    state.staffMenuPage = 'dashboard';
    delete state.adminRange;
    delete state.adminFocusMetric;
    delete state.adminView; // vue par defaut deterministe : Synthese
    save();
    setView('admin');
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#adminContent .dir-kpi').length === 6
      && Boolean(document.querySelector('#dirFocusChart svg path')),
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(700);
}

// UN GATE NE MEURT PAS EN ROUTE, IL ROUGIT ET IL CONTINUE.
//
// Ce qui s'est passe le 2026-09-03 : la vue « Mes centres » avait ete mise
// derriere un declencheur conditionnel et ne se montait plus. `page.click` sur
// une pilule absente a attendu ses 30 000 ms par defaut (l'auto-attente de
// Playwright), puis a LEVE. L'exception est remontee hors du try d'assertions :
// les blocs suivants n'ont jamais tourne, et le journal s'arretait au milieu
// sans dire QUELLE cible manquait. Une sonde qui meurt ne mesure pas ce qu'elle
// pretend mesurer, et un « 43 assertions » tronque se lit comme « 43 assertions
// passees ».
//
// Trois consequences dans la mecanique, et aucune assertion affaiblie :
//   - l'attente est BORNEE (4 s) : on ne paie plus 30 s pour un constat ;
//   - la PRESENCE est asserte AVANT le clic, donc l'absence sort en « FAIL »
//     NOMME, avec le selecteur, au lieu d'une pile d'exception ;
//   - la fonction REND un booleen au lieu de lever : les assertions qui suivent
//     s'executent et rougissent d'elles-memes (la vue n'a pas bascule), ce qui
//     dit l'etendue reelle des degats au lieu de la cacher.
const ATTENTE_CIBLE = 4000;

// Le geste NU : il ne juge rien, il rapporte. C'est ce qui permet a la sonde de
// contre-preuve d'observer l'echec sans compter un FAIL de plus.
async function cliquerCible(page, selecteur) {
  const t0 = Date.now();
  const present = await page.waitForSelector(selecteur, { state: 'visible', timeout: ATTENTE_CIBLE })
    .then(() => true).catch(() => false);
  if (!present) return { present: false, clique: false, ms: Date.now() - t0, erreur: 'cible absente ou invisible' };
  try {
    await page.click(selecteur, { timeout: ATTENTE_CIBLE });
  } catch (error) {
    return { present: true, clique: false, ms: Date.now() - t0, erreur: String(error.message).split('\n')[0] };
  }
  return { present: true, clique: true, ms: Date.now() - t0, erreur: '' };
}

// Le geste ASSERTE : meme mecanique, plus une ligne de journal. UNE seule ligne
// par geste - la presence, le clic et son effet sont les trois moities du meme
// fait, et trois lignes pour un geste noieraient les 83 assertions de fond.
async function cliquerCibleAssertee(page, selecteur, nom, effet) {
  const r = await cliquerCible(page, selecteur);
  let effetOk = r.clique;
  if (r.clique && typeof effet === 'function') effetOk = await effet();
  const detail = !r.clique
    ? `${r.erreur} (abandon apres ${r.ms} ms)`
    : (effetOk ? '' : 'clic parti, mais SANS effet');
  return ok(effetOk, `[cible] ${nom} : « ${selecteur} » cliquee et suivie d effet${detail ? ` - ${detail}` : ''}`);
}

// Bascule de vue par CLIC sur la pilule du segmented nav (vrai chemin
// utilisateur), puis attente que l'etat de vue ait suivi. Reutilise par le
// harnais principal et les sondes de contre-preuve.
async function switchDirView(page, view) {
  const bascule = await cliquerCibleAssertee(
    page,
    `#adminContent .dir-nav-pill[data-view="${view}"]`,
    `bascule vers « ${view} »`,
    () => page.waitForFunction(
      (v) => {
        const D = window.PinlaneDirection;
        return Boolean(D && typeof D.getView === 'function' && D.getView() === v);
      },
      view,
      { timeout: 8000 },
    ).then(() => true).catch(() => false),
  );
  if (!bascule) return false;
  await page.waitForTimeout(250);
  return true;
}

// Mesures brutes du poste d'observation sur la fenetre COURANTE : DOM + registre
// du mock. Les chips attendues sont reconstruites depuis les totals servis et le
// formatMoney de l'app (difference EXACTE, jamais une valeur recopiee).
async function collectDirMeasures(page) {
  // Les valeurs KPI sont ANIMEES : PinlaneCharts.countUp les fait monter de 0
  // jusqu'au total en 450 ms, image par image (requestAnimationFrame). Lire sans
  // attendre, c'est lire un chiffre EN COURS DE MONTEE : ce gate a rougi avec
  // « 0 € » puis « 1 660 € » alors que l'affichage final valait exactement le
  // total serveur attendu. La cause est une attente qui ne mesurait pas le bon
  // evenement : `bootDirection` attend que les 6 tuiles EXISTENT, alors que le
  // countUp est declenche par une passe de montage POSTERIEURE. Les 700 ms qui
  // suivaient tombaient donc parfois au milieu de l'animation, et il a suffi
  // d'un script de plus au demarrage pour que ce soit systematique.
  // On attend donc les DEUX conditions qui disent « le compteur a fini » :
  //   - `plc-countup` posee : le countUp a bien ete appele sur cette tuile ;
  //   - `_plcRaf` a zero : plus aucune image n'est en attente.
  // Aucune valeur n'est acceptee au rabais : c'est toujours le chiffre FINAL
  // qui est compare au total servi.
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('#adminContent .dir-kpi .dir-kpi-value')];
    return els.length === 6 && els.every((el) => el.classList.contains('plc-countup') && !el._plcRaf);
  }, null, { timeout: 15000 });
  return page.evaluate(() => {
    const range = window.PinlaneDirection.getRange();
    const served = (window.__DIR_SERVED__ || {})[`${range.start}|${range.end}`] || null;
    const focusPaths = [...document.querySelectorAll('#dirFocusChart svg path')].map((p) => p.getAttribute('d') || '');
    const focusSvg = document.querySelector('#dirFocusChart svg');
    const chip = (metric) => {
      const el = document.querySelector(`.dir-kpi[data-metric="${metric}"] .dir-chip`);
      return el ? el.textContent.trim() : '';
    };
    const value = (metric) => {
      const el = document.getElementById(`dirKpiVal-${metric}`);
      return el ? el.textContent.trim() : '';
    };
    // La reference (« vs periode precedente ») a quitte la pastille le
    // 2026-07-27 : repetee dans six tuiles de 178 px, elle debordait
    // (« ...vs année précéden »). Elle est annoncee une fois en tete de page et
    // reste dans l'attribut title. Le CHIFFRE exact, lui, reste dans la
    // pastille - c'est ce que ce gate verifie.
    const refLabel = '';
    const euroChip = (cur, prev) => {
      const diff = cur - prev; const up = diff > 0;
      const pct = Math.round((Math.abs(diff) / Math.abs(prev)) * 100);
      return `${up ? '▲' : '▼'} ${up ? '+' : '-'}${formatMoney(Math.abs(diff))} (${up ? '+' : '-'}${pct}%)`;
    };
    const intChip = (cur, prev) => {
      const diff = cur - prev; const up = diff > 0;
      const pct = Math.round((Math.abs(diff) / Math.abs(prev)) * 100);
      const mag = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(diff)));
      return `${up ? '▲' : '▼'} ${up ? '+' : '-'}${mag} (${up ? '+' : '-'}${pct}%)`;
    };
    return {
      windowKey: `${range.start}|${range.end}`,
      compare: range.compare,
      served,
      focusPaths,
      focusPointCounts: focusPaths.map((d) => window.__countPathPoints__(d)),
      focusHeight: focusSvg ? focusSvg.getBoundingClientRect().height : 0,
      focusMetric: window.PinlaneDirection.getFocusMetric(),
      windowLabel: (document.querySelector('#dirWindowLabel .dir-window-range') || {}).textContent || '',
      values: { revenue: value('revenue'), reservations: value('reservations'), pax: value('pax') },
      chips: { revenue: chip('revenue'), reservations: chip('reservations'), pax: chip('pax'), occupancy: chip('occupancy') },
      expected: served ? {
        revenueValue: formatMoney(served.totals.revenue),
        revenueChip: euroChip(served.totals.revenue, served.prevTotals.revenue),
        reservationsChip: intChip(served.totals.reservations, served.prevTotals.reservations),
        paxChip: intChip(served.totals.pax, served.prevTotals.pax),
      } : null,
      servedAll: Object.entries(window.__DIR_SERVED__ || {}).map(([key, rec]) => ({ key, calls: rec.calls, days: rec.days })),
    };
  });
}

// Injecte le compteur de points cote page (reutilise par collectDirMeasures).
async function installPointCounter(page) {
  await page.evaluate(() => {
    window.__countPathPoints__ = function (d) {
      const tokens = String(d || '').replace(/,/g, ' ').match(/[A-DF-Za-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
      const paramsPerPoint = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4 };
      let cmd = ''; let points = 0; let i = 0;
      while (i < tokens.length) {
        const t = tokens[i];
        if (/^[A-Za-z]$/.test(t)) { cmd = t.toUpperCase(); i += 1; continue; }
        const need = paramsPerPoint[cmd];
        if (!need) break;
        i += need; points += 1;
        if (cmd === 'M') cmd = 'L';
      }
      return points;
    };
  });
}

// Invariants [4] et [3] reevalues sur une PAGE FRAICHE (fenetre par defaut, 30
// jours) : la sonde partagee entre la phase verte et la contre-preuve.
async function probeDirInvariants(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    await installPointCounter(page);
    const m = await collectDirMeasures(page);
    return {
      svgVisible: m.focusHeight > 0,
      focusPointsMatch: Boolean(m.served) && m.focusPointCounts.includes(m.served.days),
      deltaExact: Boolean(m.expected) && m.chips.revenue === m.expected.revenueChip,
      days: m.served ? m.served.days : -1,
      pointCounts: m.focusPointCounts,
      chip: m.chips.revenue,
      expectedChip: m.expected ? m.expected.revenueChip : '',
    };
  } finally {
    await page.close();
  }
}

// Attend que le cache des sections de decision de la fenetre COURANTE soit
// charge (comparaison ET retention), quel que soit le NOMBRE de lignes rendues :
// une mutation qui ampute une liste laisse le cache « loaded » mais change le DOM.
async function waitDirDecisionLoaded(page) {
  await page.waitForFunction(() => {
    const D = window.PinlaneDirection;
    if (!D || !D.decisionCache || typeof D.getInsightKey !== 'function') return false;
    const slot = D.decisionCache[D.getInsightKey()];
    return Boolean(slot && slot.comparison && slot.comparison.loaded && slot.retention && slot.retention.loaded);
  }, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

// Attend que la PROVENANCE de la fenetre COURANTE soit chargee (meme cache que
// les sections de decision, fetch parallele action=directionAudience). Utilise
// par la vue Provenance et sa contre-preuve.
async function waitDirAudienceLoaded(page) {
  await page.waitForFunction(() => {
    const D = window.PinlaneDirection;
    if (!D || !D.decisionCache || typeof D.getInsightKey !== 'function') return false;
    const slot = D.decisionCache[D.getInsightKey()];
    return Boolean(slot && slot.audience && slot.audience.loaded);
  }, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

// Mesures des sections de decision sur une PAGE FRAICHE (fenetre par defaut).
// Sonde partagee entre la phase verte [10] et la contre-preuve par mutation :
// le mock sert 2 centres et 1 dormant, donc 2 lignes de comparaison et 1 ligne
// de relance sont attendues. Une mutation qui casse le rendu fait mentir ces
// comptes -> l'invariant passe a false -> le gate ROUGIRAIT.
async function probeDirDecision(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    // Les sections de decision vivent desormais dans DEUX vues distinctes :
    // comparaison -> « Mes centres », dormants -> « Clients ». On visite chacune.
    await switchDirView(page, 'centres');
    await waitDirDecisionLoaded(page);
    await page.waitForTimeout(300);
    const cmpRows = await page.evaluate(() => document.querySelectorAll('#adminContent .dir-cmp-row').length);
    await switchDirView(page, 'clients');
    await waitDirDecisionLoaded(page);
    await page.waitForTimeout(300);
    const lapsedRows = await page.evaluate(() => document.querySelectorAll('#adminContent .dir-ret-lapsed-row').length);
    return {
      cmpRowsMatch: cmpRows === 2,
      lapsedRowsMatch: lapsedRows === 1,
      cmpRows,
      lapsedRows,
    };
  } finally {
    await page.close();
  }
}

// Invariants de la REORGANISATION en vues, sur une page fraiche : passer a
// « Activite » montre les graphes de grille (SVG traces) et CACHE le grand
// focus. Sonde partagee entre la phase verte et la contre-preuve : une mutation
// qui casse le routage de vue fait mentir ces booleens.
async function probeDirViews(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    await switchDirView(page, 'activite');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const ids = ['dirChartResas', 'dirChartPax', 'dirChartTypes', 'dirChartChannels'];
      const svgsWithHeight = ids.filter((id) => {
        const s = document.querySelector('#' + id + ' svg');
        return Boolean(s) && s.getBoundingClientRect().height > 0;
      }).length;
      return {
        svgsWithHeight,
        focusPresent: Boolean(document.querySelector('#dirFocusChart')),
      };
    });
    return {
      activiteGridVisible: r.svgsWithHeight === 4,
      activiteFocusHidden: r.focusPresent === false,
      svgsWithHeight: r.svgsWithHeight,
      focusPresent: r.focusPresent,
    };
  } finally {
    await page.close();
  }
}

// Invariant des HAUTEURS STANDARDISEES : dans la vue Activite, les 4 graphes de
// colonne ont la MEME hauteur (offsetHeight, ecart <= 3px). Sonde partagee : une
// mutation qui retire le gabarit d'un hote fait diverger les hauteurs.
async function probeDirGridHeights(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    await switchDirView(page, 'activite');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirChartResas svg')), null, { timeout: 8000 });
    await page.waitForTimeout(250);
    const heights = await page.evaluate(() => ['dirChartResas', 'dirChartPax', 'dirChartTypes', 'dirChartChannels']
      .map((id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().height) : -1; }));
    const valid = heights.filter((h) => h > 0);
    const spread = valid.length ? Math.max(...valid) - Math.min(...valid) : 999;
    return {
      equalHeights: valid.length === 4 && spread <= 3,
      heights,
      spread,
    };
  } finally {
    await page.close();
  }
}

// Invariants de la vue PROVENANCE, sur une page fraiche : occasions (barChart
// trace + 2 lignes de table), sources (1 ligne), et carte Audience « a
// connecter » qui cite Google Analytics SANS aucun chiffre (honnetete
// demographique). Sonde partagee entre la phase verte [11] et la contre-preuve :
// une mutation qui casse un de ces blocs fait mentir un de ces booleens.
async function probeDirProvenance(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    await switchDirView(page, 'provenance');
    await waitDirAudienceLoaded(page);
    await page.waitForFunction(
      () => Boolean(document.querySelector('#adminContent .dir-prov-audience')),
      null,
      { timeout: 10000 },
    );
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const occSvg = document.querySelector('#dirProvOccChart svg');
      const audCard = document.querySelector('#adminContent .dir-prov-audience');
      const audText = audCard ? (audCard.textContent || '') : '';
      return {
        occChartH: occSvg ? Math.round(occSvg.getBoundingClientRect().height) : 0,
        occRows: document.querySelectorAll('#adminContent [aria-label="Pourquoi ils viennent"] tbody tr').length,
        srcRows: document.querySelectorAll('#adminContent [aria-label="Sources marketing"] tbody tr').length,
        audiencePresent: Boolean(audCard),
        audienceMentionsGA: /google analytics/i.test(audText),
        audiencePillPresent: Boolean(audCard && audCard.querySelector('.dir-prov-audience-pill')),
        audienceHasDigit: /\d/.test(audText),
      };
    });
    return {
      occChartTraced: r.occChartH > 0,
      occRowsMatch: r.occRows === 2,
      sourcesRowsMatch: r.srcRows === 1,
      audienceHonest: r.audiencePresent && r.audienceMentionsGA && r.audiencePillPresent && r.audienceHasDigit === false,
      noFakeAudienceNumber: r.audiencePresent && r.audienceHasDigit === false,
      occChartH: r.occChartH,
      occRows: r.occRows,
      srcRows: r.srcRows,
      audienceHasDigit: r.audienceHasDigit,
    };
  } finally {
    await page.close();
  }
}

// Signal de MONTAGE du board de la vue Analyse : un widget trace (SVG hauteur>0)
// OU la barre de plage propre du board avec au moins un controle. Reutilise par
// la phase verte et la contre-preuve.
async function waitDirAnalyseMounted(page) {
  await page.waitForFunction(() => {
    const slot = document.getElementById('dirAnalyseSlot');
    if (!slot || !slot.querySelector('.pab')) return false;
    const svg = slot.querySelector('.pab-widget-body svg');
    const svgOk = Boolean(svg) && svg.getBoundingClientRect().height > 0;
    const range = slot.querySelector('.pab-range');
    const rangeOk = Boolean(range) && range.querySelectorAll('button, input, select').length > 0;
    return svgOk || rangeOk;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

function readDirAnalyseState(page) {
  return page.evaluate(() => {
    const slot = document.getElementById('dirAnalyseSlot');
    const host = slot ? slot.querySelector('[data-board-instance]') : null;
    const svg = slot ? slot.querySelector('.pab-widget-body svg') : null;
    const range = slot ? slot.querySelector('.pab-range') : null;
    const controls = document.getElementById('dirControls');
    let storageKey = '';
    try { storageKey = window.localStorage.getItem('pinlane-direction-board') ? 'pinlane-direction-board' : ''; } catch (e) { storageKey = ''; }
    return {
      id: host ? host.getAttribute('data-board-instance') : '',
      widgetSvgH: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
      rangeControls: range ? range.querySelectorAll('button, input, select').length : 0,
      globalControlsHidden: controls ? (controls.hidden === true || controls.offsetHeight === 0) : false,
      storageKey,
    };
  });
}

// Invariants de la vue ANALYSE, sur une page fraiche : le board se monte (widget
// trace OU barre de plage propre) et, apres un aller-retour Synthese -> Analyse,
// l'hote PERSISTE (meme data-board-instance : aucun re-montage). Sonde partagee
// entre la phase verte [12] et la contre-preuve : une mutation qui recree l'hote
// a chaque rendu fait diverger l'identifiant (sameNode passe a false).
async function probeDirAnalyse(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  try {
    await bootDirection(page);
    await switchDirView(page, 'activite');
    await waitDirAnalyseMounted(page);
    const first = await readDirAnalyseState(page);
    // Aller-retour : passage par Synthese, puis on relit l'hote au retour sur
    // Activite (sans exiger un board plein : une mutation peut le vider, seul
    // l'identifiant du noeud est compare -> preuve de persistance de l'hote).
    await switchDirView(page, 'synthese');
    await page.waitForTimeout(200);
    await switchDirView(page, 'activite');
    await page.waitForFunction(() => {
      const slot = document.getElementById('dirAnalyseSlot');
      return Boolean(slot && slot.querySelector('[data-board-instance]'));
    }, null, { timeout: 10000 });
    await page.waitForTimeout(200);
    const second = await readDirAnalyseState(page);
    return {
      mounted: first.widgetSvgH > 0 || first.rangeControls > 0,
      sameNode: Boolean(first.id) && first.id === second.id,
      id1: first.id,
      id2: second.id,
      widgetSvgH: first.widgetSvgH,
      rangeControls: first.rangeControls,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  try {
    await bootDirection(page);
    await installPointCounter(page);

    console.log(`[0] composant de plage : ${DATERANGE_REAL_EXISTS ? 'assets/pinlane-daterange.js REEL' : 'STUB injecte (lib en construction)'}`);

    console.log('\n[1] SHELL : nom du centre, bandeau de test, barre de controle non effondree');
    const shell = await page.evaluate(() => ({
      hero: (document.getElementById('adminHeroTitle') || {}).textContent || '',
      centerName: getAdminCenter().name,
      honesty: (document.querySelector('#adminHonestyNote .admin-testdata') || {}).textContent || '',
      controlsH: (document.getElementById('dirControls') || {}).offsetHeight || 0,
      labelH: (document.getElementById('dirWindowLabel') || {}).offsetHeight || 0,
      windowText: (document.querySelector('#dirWindowLabel .dir-window-range') || {}).textContent || '',
      noHeader: document.querySelectorAll('#adminContent header').length === 0,
    }));
    ok(shell.hero === shell.centerName, `le hero porte le nom du centre (« ${shell.hero} »)`);
    // Le bandeau se declenche toujours sur le flag serveur (stub testData:true
    // plus haut) ; son TEXTE, lui, parle desormais de la fiabilite des chiffres
    // et non de l'etat commercial de Pinlane.
    ok(/chiffres non fiables/i.test(shell.honesty) && !/SaaS/i.test(shell.honesty),
      `le bandeau de fiabilite est affiche (flag serveur) et ne parle pas du lancement du SaaS (« ${shell.honesty} »)`);
    ok(shell.controlsH > 0 && shell.labelH > 0, `barre de controle + libelle de fenetre a hauteur reelle > 0 (${shell.controlsH}px / ${shell.labelH}px)`);
    ok(/→/.test(shell.windowText), `le libelle de fenetre est toujours visible (« ${shell.windowText} »)`);
    ok(shell.noHeader, 'aucun <header> emis dans #adminContent (piege body.admin-mode header{height:0} evite)');

    console.log('\n[2] BARRE DE PLAGE : montee, 3 controles focalisables, hauteur > 0');
    const rangeBar = await page.evaluate(() => {
      const host = document.getElementById('dirRangeHost');
      // Seuls les controles VISIBLES comptent (un declencheur masque n'est pas
      // un controle offert). getClientRects filtre le hidden sans dependre du CSS.
      const controls = host ? [...host.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0) : [];
      return {
        mounted: Boolean(host && host.children.length),
        controlCount: controls.length,
        height: host ? host.getBoundingClientRect().height : 0,
        focusable: controls.length > 0 && controls.every((b) => b.tabIndex >= 0 && !b.disabled),
      };
    });
    ok(rangeBar.mounted && rangeBar.height > 0, `le composant de plage est monte et visible (${Math.round(rangeBar.height)}px)`);
    ok(rangeBar.controlCount >= 3 && rangeBar.focusable, `au moins 3 controles focalisables (obtenu ${rangeBar.controlCount})`);

    console.log('\n[3] RANGEE KPI : 6 tuiles, valeur = total serveur, deltas = difference exacte');
    const kpiLabels = await page.evaluate(() => [...document.querySelectorAll('#adminContent .dir-kpi .dir-kpi-label')].map((el) => el.textContent.trim()));
    ok(kpiLabels.length === 6, `6 tuiles KPI (obtenu ${kpiLabels.length} : ${JSON.stringify(kpiLabels)})`);
    const m0 = await collectDirMeasures(page);
    ok(Boolean(m0.served), `le mock a servi la fenetre par defaut (${m0.windowKey}, ${m0.served ? m0.served.days : '?'} jours)`);
    ok(m0.values.revenue === m0.expected.revenueValue, `KPI Chiffre d'affaires = total serveur exact (obtenu « ${m0.values.revenue} », attendu « ${m0.expected.revenueValue} »)`);
    ok(m0.chips.revenue === m0.expected.revenueChip, `delta CA = difference exacte (obtenu « ${m0.chips.revenue} », attendu « ${m0.expected.revenueChip} »)`);
    ok(m0.chips.reservations === m0.expected.reservationsChip, `delta Reservations = difference exacte (obtenu « ${m0.chips.reservations} »)`);
    ok(m0.chips.pax === m0.expected.paxChip, `delta Joueurs = difference exacte (obtenu « ${m0.chips.pax} »)`);

    console.log('\n[4] GRAND GRAPHIQUE FOCUS : un point par jour servi, hauteur > 0');
    ok(m0.focusHeight > 0, `le graphique focus est un SVG a hauteur reelle > 0 (${Math.round(m0.focusHeight)}px)`);
    ok(m0.focusPointCounts.includes(m0.served.days), `le path du focus compte un point par jour servi (points: ${JSON.stringify(m0.focusPointCounts)}, jours: ${m0.served.days})`);
    ok(m0.focusMetric === 'revenue', `metrique focus par defaut = chiffre d'affaires (obtenu « ${m0.focusMetric} »)`);

    console.log('\n[5] INTERACTIVITE : cliquer la tuile Joueurs change la metrique du focus (le path change)');
    const focusBefore = m0.focusPaths.join('|');
    await cliquerCibleAssertee(page, '.dir-kpi[data-metric="pax"]', 'tuile KPI Joueurs',
      () => page.waitForFunction(() => window.PinlaneDirection.getFocusMetric() === 'pax', null, { timeout: 4000 })
        .then(() => true).catch(() => false));
    await page.waitForTimeout(400);
    const afterClick = await page.evaluate(() => ({
      metric: window.PinlaneDirection.getFocusMetric(),
      paths: [...document.querySelectorAll('#dirFocusChart svg path')].map((p) => p.getAttribute('d') || '').join('|'),
      activePax: document.querySelector('.dir-kpi[data-metric="pax"]').classList.contains('is-active'),
      activeRevenue: document.querySelector('.dir-kpi[data-metric="revenue"]').classList.contains('is-active'),
    }));
    ok(afterClick.metric === 'pax', `l'etat focus est passe a « pax » (obtenu « ${afterClick.metric} »)`);
    ok(afterClick.paths !== focusBefore, 'le path du graphique focus a CHANGE apres le clic (geometrie differente)');
    ok(afterClick.activePax && !afterClick.activeRevenue, 'la tuile active a bascule de CA vers Joueurs (une seule active)');
    // On repose le focus sur CA pour la suite (deltas lus sur la meme metrique).
    await page.evaluate(() => setDirFocusMetric('revenue'));
    await page.waitForTimeout(200);

    console.log('\n[6] CHANGER LA PLAGE via le composant : UN fetch aux bonnes dates, focus recompte');
    // Cible = preset "7 derniers jours" (maxDate-6 .. maxDate) : 7 jours servis.
    // On declenche via le VRAI composant (clic sur la pilule de plage puis le
    // preset) quand il est monte ; sinon via le hook onChange du stub.
    const usedStub = await page.evaluate(() => typeof window.__pinlaneDirRangeEmit === 'function');
    const targetWin = await page.evaluate(() => {
      const maxDate = todayStr();
      const d = new Date(maxDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6);
      return { start: d.toISOString().slice(0, 10), end: maxDate };
    });
    const targetKey = `${targetWin.start}|${targetWin.end}`;
    const callsBefore = await page.evaluate((k) => ((window.__DIR_SERVED__ || {})[k] ? window.__DIR_SERVED__[k].calls : 0), targetKey);
    if (usedStub) {
      await page.evaluate(({ start, end }) => window.__pinlaneDirRangeEmit({ start, end, granularity: 'day', compare: 'previous' }), targetWin);
    } else {
      // Vrai composant : ouvrir le popover de plage, choisir "7 derniers jours".
      // Meme mecanique bornee que les pilules : un popover qui ne s ouvre pas
      // donne un FAIL nomme, pas une exception qui avale la fin du gate.
      await cliquerCibleAssertee(page, '#dirRangeHost .pdr-range-trigger', 'ouverture du popover de plage',
        () => page.waitForSelector('#dirRangeHost [data-preset="last7"]', { timeout: ATTENTE_CIBLE })
          .then(() => true).catch(() => false));
      await cliquerCibleAssertee(page, '#dirRangeHost [data-preset="last7"]', 'preset « 7 derniers jours »');
    }
    const fenetreServie = await page.waitForFunction(
      (k) => Boolean((window.__DIR_SERVED__ || {})[k]) && Boolean(document.querySelector('#dirFocusChart svg path')),
      targetKey,
      { timeout: 15000 },
    ).then(() => true).catch(() => false);
    ok(fenetreServie, `[cible] la nouvelle fenetre ${targetKey} a bien ete servie et retracee`);
    await page.waitForTimeout(500);
    const m1 = await collectDirMeasures(page);
    ok(m1.windowKey === targetKey, `changement declenche via le composant (${usedStub ? 'stub onChange' : 'clic preset reel'}) : la fenetre active est la nouvelle plage (${m1.windowKey})`);
    ok(Boolean(m1.served) && m1.served.days === 7, `la nouvelle fenetre fait 7 jours servis (obtenu ${m1.served ? m1.served.days : '?'})`);
    ok(m1.focusPointCounts.includes(7), `le focus recompte : 7 points pour 7 jours (points: ${JSON.stringify(m1.focusPointCounts)})`);
    const callsAfter = await page.evaluate((k) => window.__DIR_SERVED__[k].calls, targetKey);
    ok(callsAfter - callsBefore === 1, `EXACTEMENT un fetch directionAnalytics pour la nouvelle fenetre (obtenu ${callsAfter - callsBefore})`);
    ok(/→/.test(m1.windowLabel), `le libelle de fenetre a suivi (« ${m1.windowLabel} »)`);

    // Basculer la comparaison NE refait AUCUN fetch (le bloc previous voyage avec
    // l'analytique) et bascule les deltas vers l'etat neutre.
    const compareToggle = await page.evaluate((k) => {
      const before = window.__DIR_SERVED__[k].calls;
      const next = Object.assign({}, window.PinlaneDirection.getRange(), { compare: 'none' });
      window.PinlaneDirection.applyRange(next);
      return { before };
    }, `${targetWin.start}|${targetWin.end}`);
    await page.waitForTimeout(400);
    const afterCompare = await page.evaluate((arg) => ({
      calls: window.__DIR_SERVED__[arg.k].calls,
      before: arg.before,
      chip: (document.querySelector('.dir-kpi[data-metric="revenue"] .dir-chip') || {}).textContent || '',
    }), { k: `${targetWin.start}|${targetWin.end}`, before: compareToggle.before });
    ok(afterCompare.calls === afterCompare.before, `basculer la comparaison ne coute AUCUN fetch (calls ${afterCompare.before} -> ${afterCompare.calls})`);
    ok(/sur la période/.test(afterCompare.chip), `comparaison OFF => delta neutre « sur la période » (obtenu « ${afterCompare.chip.trim()} »)`);

    console.log('\n[7] ABSENCE : plus d onglet ni pave de l ancienne page dans #adminContent');
    const absence = await page.evaluate(() => ({
      adminPanel: document.querySelectorAll('#adminContent .admin-panel').length,
      adminKpi: document.querySelectorAll('#adminContent .admin-kpi').length,
      cockpit: document.querySelectorAll('#adminContent .ops-cockpit').length,
      health: document.querySelectorAll('#adminContent .admin-health-panel').length,
      trends: document.querySelectorAll('#adminContent .adm-trend-panel').length,
      tabs: document.querySelectorAll('#adminContent .admin-tabs').length,
      forbiddenH2: [...document.querySelectorAll('#adminContent h2')]
        .map((h) => h.textContent || '')
        .filter((t) => /Signaux direction|V[ée]rifications continues|Cockpit op[ée]rationnel|Synth[èe]se ex[ée]cutive/.test(t)).length,
      dirRoot: document.querySelectorAll('#adminContent .dir-root').length,
      dirKpi: document.querySelectorAll('#adminContent .dir-kpi').length,
    }));
    ok(absence.adminPanel === 0 && absence.adminKpi === 0 && absence.cockpit === 0 && absence.health === 0 && absence.trends === 0 && absence.tabs === 0,
      `zero classe de l ancien namespace dans #adminContent (${JSON.stringify(absence)})`);
    ok(absence.forbiddenH2 === 0, 'zero pave « Signaux/Verifications/Cockpit/Synthese » dans #adminContent');
    ok(absence.dirRoot === 1 && absence.dirKpi === 6, 'la nouvelle page dir-* est bien la (dir-root + 6 dir-kpi)');

    const fatal = errs.filter((e) => !/localStorage|sandboxed|favicon|cdn\.vercel-insights/i.test(e));
    ok(fatal.length === 0, `[8] aucune erreur console fatale (obtenu ${fatal.length}${fatal.length ? ' : ' + fatal[0] : ''})`);

    console.log('\n[10] VUES : segmented nav 5 vues, Synthese=focus, Activite=graphes enrichis + board (focus cache), Clients+Mes centres, plage GLOBALE');
    // La barre de plage vit HORS des vues (#dirControls) : elle doit rester
    // visible et mesurable sur chaque vue (fenetre globale). Sonde reutilisable.
    const rangeVisible = () => page.evaluate(() => {
      const label = document.getElementById('dirWindowLabel');
      const host = document.getElementById('dirRangeHost');
      return Boolean(label && label.offsetHeight > 0 && host && host.getBoundingClientRect().height > 0);
    });

    // Vue par defaut = Synthese : le segmented nav offre 4 vues dans l'ordre, la
    // pilule Synthese est active, le grand focus est la, la grille d'activite non.
    const navState = await page.evaluate(() => {
      const active = document.querySelector('#adminContent .dir-nav-pill.is-active');
      return {
        pills: [...document.querySelectorAll('#adminContent .dir-nav-pill')].map((b) => b.getAttribute('data-view')),
        activeView: active ? active.getAttribute('data-view') : '',
        view: window.PinlaneDirection.getView(),
        focusPresent: Boolean(document.querySelector('#dirFocusChart svg')),
        gridPresent: Boolean(document.querySelector('#dirChartResas')),
      };
    });
    ok(navState.pills.length === 5 && ['synthese', 'activite', 'clients', 'centres', 'provenance'].every((v, i) => navState.pills[i] === v)
      && !navState.pills.includes('analyse'),
      `le segmented nav offre 5 vues dans l'ordre, plus aucune vue Analyse orpheline (obtenu ${JSON.stringify(navState.pills)})`);
    ok(navState.view === 'synthese' && navState.activeView === 'synthese', `vue par defaut = Synthese (pilule active « ${navState.activeView} »)`);
    ok(navState.focusPresent && !navState.gridPresent, 'Synthese montre le grand graphe focus et PAS la grille d activite');
    ok(await rangeVisible(), 'la barre de plage est visible sur la vue Synthese');

    // Activite : les 4 graphes de grille sont traces, le focus est CACHE, et les
    // graphes d'une meme grille ont des hauteurs EGALES (standardisation).
    await switchDirView(page, 'activite');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirChartResas svg')), null, { timeout: 8000 });
    await page.waitForTimeout(250);
    const act = await page.evaluate(() => {
      const ids = ['dirChartResas', 'dirChartPax', 'dirChartTypes', 'dirChartChannels'];
      const heights = ids.map((id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().height) : -1; });
      const svgsWithHeight = ids.filter((id) => { const s = document.querySelector('#' + id + ' svg'); return Boolean(s) && s.getBoundingClientRect().height > 0; }).length;
      const valid = heights.filter((h) => h > 0);
      return {
        heights,
        svgsWithHeight,
        spread: valid.length ? Math.max(...valid) - Math.min(...valid) : 999,
        validCount: valid.length,
        focusPresent: Boolean(document.querySelector('#dirFocusChart')),
        heatHeight: (() => { const el = document.querySelector('#dirChartHeatmap .plc-heat-grid'); return el ? Math.round(el.getBoundingClientRect().height) : 0; })(),
      };
    });
    ok(act.svgsWithHeight === 4, `Activite : les 4 graphes de grille sont traces (SVG hauteur > 0) (obtenu ${act.svgsWithHeight})`);
    ok(act.focusPresent === false, 'passer a Activite CACHE le grand graphe focus (#dirFocusChart absent)');
    ok(act.validCount === 4 && act.spread <= 3, `les graphes d une meme grille ont des hauteurs EGALES (ecart ${act.spread}px, hauteurs ${JSON.stringify(act.heights)})`);
    ok(act.heatHeight > 0, `la heatmap pleine largeur est tracee dans la vue Activite (${act.heatHeight}px)`);
    ok(await rangeVisible(), 'la barre de plage reste visible sur la vue Activite');

    // Mes centres : la comparaison inter-centres (2 lignes, centre courant
    // surligne, meilleur par colonne marque), focus toujours cache.
    await switchDirView(page, 'centres');
    await waitDirDecisionLoaded(page);
    await page.waitForFunction(() => document.querySelectorAll('#adminContent .dir-cmp-row').length === 2, null, { timeout: 15000 });
    const centres = await page.evaluate(() => {
      const cmpRows = [...document.querySelectorAll('#adminContent .dir-cmp-row')];
      return {
        cmpSectionPresent: Boolean(document.querySelector('#adminContent .dir-cmp')),
        cmpRowCount: cmpRows.length,
        currentHighlighted: cmpRows.filter((r) => r.classList.contains('is-current')).length,
        currentIsLibramont: (document.querySelector('#adminContent .dir-cmp-row.is-current .dir-cmp-center') || {}).textContent || '',
        bestMarks: document.querySelectorAll('#adminContent .dir-cmp-best-mark').length,
        focusPresent: Boolean(document.querySelector('#dirFocusChart')),
      };
    });
    ok(centres.cmpSectionPresent && centres.cmpRowCount === 2 && !centres.focusPresent, `Mes centres montre la comparaison (2 lignes) et PAS le focus (obtenu ${centres.cmpRowCount} lignes)`);
    ok(centres.currentHighlighted === 1 && /Libramont/.test(centres.currentIsLibramont), `le centre courant (isCurrent) est surligne, un seul (« ${centres.currentIsLibramont} »)`);
    ok(centres.bestMarks > 0, `le meilleur de chaque colonne est marque discretement (obtenu ${centres.bestMarks} marques)`);
    ok(await rangeVisible(), 'la barre de plage reste visible sur la vue Mes centres');

    // Clients : top clients + top formules + toute la section Retention (segment
    // + dormants a relancer). Comptes lus dans le DOM (jamais une presence de chaine).
    await switchDirView(page, 'clients');
    await waitDirDecisionLoaded(page);
    await page.waitForFunction(
      () => document.querySelectorAll('#adminContent .dir-ret-lapsed-row').length === 1
        && document.querySelectorAll('#adminContent .dir-ret-stat').length >= 4,
      null,
      { timeout: 15000 },
    );
    const clients = await page.evaluate(() => ({
      tablesPresent: Boolean(document.querySelector('#adminContent .dir-tables')),
      retSectionPresent: Boolean(document.querySelector('#adminContent .dir-ret')),
      lapsedRowCount: document.querySelectorAll('#adminContent .dir-ret-lapsed-row').length,
      segStats: document.querySelectorAll('#adminContent .dir-ret-stat').length,
      lapsedHead: (document.querySelector('#adminContent .dir-ret-lapsed-head') || {}).textContent || '',
      lapsedLast: (document.querySelector('#adminContent .dir-ret-lapsed-row .dir-ret-last') || {}).textContent || '',
      focusPresent: Boolean(document.querySelector('#dirFocusChart')),
    }));
    ok(clients.tablesPresent && clients.retSectionPresent && !clients.focusPresent, 'Clients regroupe tables (formules/clients) + Retention, sans le focus');
    ok(clients.lapsedRowCount === 1, `« Clients a relancer » contient EXACTEMENT 1 dormant (obtenu ${clients.lapsedRowCount})`);
    ok(clients.segStats >= 4, `le bloc segment nouveaux vs recurrents expose ses statistiques (obtenu ${clients.segStats} tuiles)`);
    ok(/pas revenu.*plus de 60 jours/.test(clients.lapsedHead), `la phrase actionnable annonce le seuil de dormance (« ${clients.lapsedHead.trim()} »)`);
    ok(/il y a/.test(clients.lapsedLast), `le dernier passage est rendu en relatif « il y a X » (obtenu « ${clients.lapsedLast.trim()} »)`);
    ok(await rangeVisible(), 'la barre de plage reste visible sur la vue Clients');

    // Retour a Synthese : la fenetre GLOBALE n'a pas bouge en changeant de vue
    // (le focus recompte la meme fenetre 7 jours choisie a l'etape [6]).
    await switchDirView(page, 'synthese');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirFocusChart svg path')), null, { timeout: 8000 });
    const backToSynthese = await page.evaluate(() => ({
      view: window.PinlaneDirection.getView(),
      focusPresent: Boolean(document.querySelector('#dirFocusChart svg')),
      windowLabel: (document.querySelector('#dirWindowLabel .dir-window-range') || {}).textContent || '',
    }));
    ok(backToSynthese.view === 'synthese' && backToSynthese.focusPresent, 'retour a Synthese : le grand focus est de nouveau la');
    ok(backToSynthese.windowLabel === m1.windowLabel, `la fenetre globale a tenu a travers les vues (« ${backToSynthese.windowLabel} »)`);

    console.log('\n[11] VUE PROVENANCE : occasions (barChart + table), canaux (donut), sources (table), et carte Audience « a connecter » SANS faux chiffre');
    await switchDirView(page, 'provenance');
    await waitDirAudienceLoaded(page);
    await page.waitForFunction(() => Boolean(document.querySelector('#dirProvOccChart svg'))
      && Boolean(document.querySelector('#adminContent .dir-prov-audience')), null, { timeout: 12000 });
    await page.waitForTimeout(300);
    const prov = await page.evaluate(() => {
      const occSvg = document.querySelector('#dirProvOccChart svg');
      const chanSvg = document.querySelector('#dirProvChanChart svg');
      const audCard = document.querySelector('#adminContent .dir-prov-audience');
      const audText = audCard ? (audCard.textContent || '') : '';
      const pill = audCard ? audCard.querySelector('.dir-prov-audience-pill') : null;
      return {
        provSectionPresent: Boolean(document.querySelector('#adminContent .dir-prov')),
        occChartH: occSvg ? Math.round(occSvg.getBoundingClientRect().height) : 0,
        occRows: document.querySelectorAll('#adminContent [aria-label="Pourquoi ils viennent"] tbody tr').length,
        chanChartH: chanSvg ? Math.round(chanSvg.getBoundingClientRect().height) : 0,
        srcRows: document.querySelectorAll('#adminContent [aria-label="Sources marketing"] tbody tr').length,
        audiencePresent: Boolean(audCard),
        audienceMentionsGA: /google analytics/i.test(audText),
        audiencePillText: pill ? (pill.textContent || '') : '',
        audienceHasDigit: /\d/.test(audText),
        focusPresent: Boolean(document.querySelector('#dirFocusChart')),
      };
    });
    ok(prov.provSectionPresent && !prov.focusPresent, 'Provenance montre sa section et PAS le grand focus');
    ok(prov.occChartH > 0, `« Pourquoi ils viennent » : le barChart des occasions est trace (${prov.occChartH}px)`);
    ok(prov.occRows === 2, `la table des occasions liste les 2 occasions servies (obtenu ${prov.occRows})`);
    ok(prov.chanChartH > 0, `« Canaux de reservation » : le donutChart des canaux est trace (${prov.chanChartH}px)`);
    ok(prov.srcRows === 1, `« Sources marketing » : la table liste la source servie (obtenu ${prov.srcRows})`);
    ok(prov.audiencePresent && prov.audienceMentionsGA, 'la carte Audience « a connecter » cite Google Analytics');
    ok(/à venir/i.test(prov.audiencePillText), `la pilule inerte annonce « Connecter Google Analytics (à venir) » (obtenu « ${prov.audiencePillText.trim()} »)`);
    ok(prov.audienceHasDigit === false, 'AUCUN chiffre (age/sexe/zone) dans la carte Audience (honnetete demographique)');
    ok(await rangeVisible(), 'la barre de plage reste visible sur la vue Provenance');
    await switchDirView(page, 'synthese');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirFocusChart svg path')), null, { timeout: 8000 });

    console.log('\n[12] BOARD DANS ACTIVITE (fusion) : plus de vue Analyse, board personnalisable monte EN BAS d Activite, hote PERSISTANT au retour, plage GLOBALE visible');
    // Fusion 2026-07-23 : le segmented nav n'offre plus que 5 vues, PLUS aucune
    // pilule Analyse. Le board (ex-vue Analyse) vit desormais dans la vue Activite.
    const navFive = await page.evaluate(() => [...document.querySelectorAll('#adminContent .dir-nav-pill')].map((b) => b.getAttribute('data-view')));
    ok(navFive.length === 5 && !navFive.includes('analyse'), `le segmented nav offre 5 vues, plus aucune pilule Analyse (obtenu ${JSON.stringify(navFive)})`);

    // Aller sur Activite monte le board reel (window.PinlaneAnalyticsBoard, deja
    // charge par la page) : au moins un widget trace (SVG hauteur>0) OU sa barre
    // de plage propre presente. Sa donnee vient du mock directionAnalytics via
    // getAnalytics -> apiRequest (meme chemin que le poste d'observation).
    await switchDirView(page, 'activite');
    await waitDirAnalyseMounted(page);
    const analyse1 = await readDirAnalyseState(page);
    ok(analyse1.widgetSvgH > 0 || analyse1.rangeControls > 0,
      `Activite monte le board en bas (widget SVG ${analyse1.widgetSvgH}px OU barre de plage ${analyse1.rangeControls} controles)`);
    ok(Boolean(analyse1.id), `le board pose une reference stable au montage (data-board-instance « ${analyse1.id} »)`);
    ok(analyse1.storageKey === 'pinlane-direction-board', 'le board persiste sa config sous la cle DISTINCTE pinlane-direction-board');
    ok(!analyse1.globalControlsHidden, 'la barre de plage GLOBALE reste VISIBLE sur Activite (le board porte SA propre plage libre, sans conflit)');

    // Aller-retour : Synthese puis Activite. La barre GLOBALE reste sur Synthese,
    // et revenir sur Activite conserve le MEME noeud (data-board-instance identique)
    // : le board n'est PAS recree, donc sa config/edition/plage libre survivent.
    await switchDirView(page, 'synthese');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirFocusChart svg path')), null, { timeout: 8000 });
    ok(await rangeVisible(), 'la barre de plage GLOBALE est sur Synthese apres un passage par Activite');
    await switchDirView(page, 'activite');
    await page.waitForFunction(() => {
      const slot = document.getElementById('dirAnalyseSlot');
      return Boolean(slot && slot.querySelector('[data-board-instance]'));
    }, null, { timeout: 10000 });
    const analyse2 = await readDirAnalyseState(page);
    ok(Boolean(analyse2.id) && analyse2.id === analyse1.id,
      `revenir sur Activite conserve le MEME noeud de board (« ${analyse1.id} » -> « ${analyse2.id} »)`);
    await switchDirView(page, 'synthese');
    await page.waitForFunction(() => Boolean(document.querySelector('#dirFocusChart svg path')), null, { timeout: 8000 });

    if (process.env.PINLANE_DIRECTION_SHOTS) {
      const shotDir = process.env.PINLANE_DIRECTION_SHOTS;
      fs.mkdirSync(shotDir, { recursive: true });
      await page.evaluate(() => { setDirFocusMetric('revenue'); });
      await page.waitForTimeout(300);
      // Une capture par VUE (la reorganisation se voit vue par vue) et par theme.
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { setStaffTheme(t); }, theme);
        await page.waitForTimeout(300);
        for (const view of ['synthese', 'activite', 'clients', 'centres', 'provenance']) {
          await switchDirView(page, view);
          await page.setViewportSize({ width: 1400, height: 950 });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(shotDir, `direction-${theme}-${view}-desktop.png`), fullPage: true });
        }
        await switchDirView(page, 'synthese');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(shotDir, `direction-${theme}-mobile.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1400, height: 950 });
      await switchDirView(page, 'synthese');
      console.log(`[SHOTS] captures ecrites dans ${shotDir}`);
    }

    // =====================================================================
    console.log('\n[8bis] LA MECANIQUE ELLE-MEME : une cible absente rougit, elle ne tue pas le gate');
    // =====================================================================
    // On retire une pilule du DOM d'une page A PART et on tente le geste NU
    // (`cliquerCible`, celui qui rapporte au lieu d'asserter : la sonde ne doit
    // pas compter un FAIL pour une absence qu'elle provoque elle-meme). Ce qui
    // est mesure : le geste REND un constat au lieu de LEVER, et il abandonne
    // dans sa borne au lieu des 30 000 ms de l'auto-attente Playwright.
    const pageSonde = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    try {
      await bootDirection(pageSonde);
      const retiree = await pageSonde.evaluate(() => {
        const pill = document.querySelector('#adminContent .dir-nav-pill[data-view="centres"]');
        if (!pill) return false;
        pill.remove();
        return true;
      });
      ok(retiree, 'la sonde a bien retire la pilule « centres » du DOM (sans elle, rien ne serait teste)');
      let leve = false;
      const constat = await cliquerCible(pageSonde, '#adminContent .dir-nav-pill[data-view="centres"]')
        .catch(() => { leve = true; return null; });
      ok(!leve && constat !== null && constat.present === false && constat.clique === false,
        `un clic sur une pilule absente REND un constat au lieu de lever (leve=${leve}, ${constat ? `present=${constat.present}` : 'aucun constat'})`);
      ok(Boolean(constat) && constat.ms < 12000,
        `et il abandonne dans sa borne : ${constat ? constat.ms : '?'} ms (l auto-attente Playwright en aurait pris 30 000)`);
      // Et la page reste pilotable APRES l'echec : c'est ce qui prouve que la
      // suite du gate aurait tourne.
      const encoreVivante = await pageSonde.evaluate(() => document.querySelectorAll('#adminContent .dir-nav-pill').length);
      ok(encoreVivante >= 4, `la page reste pilotable apres l echec (${encoreVivante} pilules encore la)`);
    } finally {
      await pageSonde.close();
    }

    console.log('\n[9] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
    const consolePath = path.join(ROOT, 'assets', 'admin-console.js');
    const applyMutation = (anchor, replacement, label) => {
      const original = fs.readFileSync(consolePath, 'utf8');
      const occurrences = original.split(anchor).length - 1;
      if (occurrences !== 1) {
        console.error(`direction-cockpit-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
        process.exit(1);
      }
      const mutated = original.replace(anchor, replacement);
      if (mutated === original) {
        console.error(`direction-cockpit-check: la mutation n'a rien change au fichier : ${label}`);
        process.exit(1);
      }
      fs.writeFileSync(consolePath, mutated);
      return original;
    };
    const runMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirInvariants(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    // Meme protocole pour les SECTIONS DE DECISION : la sonde est le compte de
    // lignes rendues (2 centres / 1 dormant). Amputer une liste doit faire mentir
    // ce compte ; une mutation sans effet fait sortir le script en erreur.
    const runDecisionMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirDecision(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET (decision), le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    // Contre-preuve du ROUTAGE DE VUE : casser la branche « Activite » (elle rend
    // le focus au lieu de la grille) doit faire disparaitre les graphes de grille
    // apres un clic sur la pilule Activite. Sonde = probeDirViews.
    const runViewMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirViews(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET (vue), le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    // Contre-preuve des HAUTEURS STANDARDISEES : retirer le gabarit d'un hote de
    // grille (classe dir-chart -> dir-chart-x, sans regle de hauteur) fait diverger
    // sa hauteur des autres. Sonde = probeDirGridHeights.
    const runHeightMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirGridHeights(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET (hauteur), le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    // Contre-preuve de la vue PROVENANCE : casser un bloc (chart des occasions,
    // table des sources, ou INJECTER un faux chiffre dans la carte Audience) doit
    // faire mentir la sonde probeDirProvenance. Une mutation sans effet fait
    // sortir le script en erreur.
    const runProvenanceMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirProvenance(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET (provenance), le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    // Contre-preuve de la vue ANALYSE : casser la persistance de l'hote du board
    // (recreer un conteneur a chaque rendu au lieu d'en garder UN) doit faire
    // diverger le data-board-instance entre l'aller et le retour. Sonde =
    // probeDirAnalyse (invariant sameNode). Une mutation sans effet fait sortir
    // le script en erreur.
    const runAnalyseMutation = async (anchor, replacement, invariantKey, label) => {
      const original = applyMutation(anchor, replacement, label);
      let probe = null;
      try {
        probe = await probeDirAnalyse(browser);
      } finally {
        fs.writeFileSync(consolePath, original);
      }
      if (!probe || probe[invariantKey] !== false) {
        console.error(`direction-cockpit-check: MUTATION SANS EFFET (analyse), le gate ne sait pas rougir : ${label} (${JSON.stringify(probe)})`);
        process.exit(1);
      }
      ok(true, `mutation « ${label} » : l'invariant ${invariantKey} est viole, le gate ROUGIRAIT`);
    };
    await runMutation(
      'return dirDays.map((row) => (asLabels',
      'return dirDays.slice(0, -1).map((row) => (asLabels',
      'focusPointsMatch',
      'serie du focus amputee de son dernier jour',
    );
    await runMutation(
      'const dirDiff = cur - ref;',
      'const dirDiff = cur - ref - 1;',
      'deltaExact',
      'delta decale de 1 (plus la difference exacte des totals)',
    );
    await runDecisionMutation(
      'centers.map((center) => dirCmpRowHtml(center, best, currentId))',
      'centers.slice(0, -1).map((center) => dirCmpRowHtml(center, best, currentId))',
      'cmpRowsMatch',
      'comparaison amputee d un centre (plus 2 lignes rendues)',
    );
    await runDecisionMutation(
      'lapsed.map((client) => dirRetLapsedRowHtml(client))',
      'lapsed.slice(0, -1).map((client) => dirRetLapsedRowHtml(client))',
      'lapsedRowsMatch',
      'liste de dormants amputee (plus 1 ligne a relancer)',
    );
    await runViewMutation(
      "if (view === 'activite') return dirGridHtml() + dirAnalyseHtml();",
      "if (view === 'activite') return dirFocusHtml();",
      'activiteGridVisible',
      'vue Activite qui rend le focus au lieu de la grille (routage de vue casse)',
    );
    await runHeightMutation(
      '<div class="dir-chart" id="dirChartPax"></div>',
      '<div class="dir-chart-x" id="dirChartPax"></div>',
      'equalHeights',
      'un hote de grille sans gabarit de hauteur (dir-chart -> dir-chart-x)',
    );
    await runProvenanceMutation(
      'id="dirProvOccChart"></div>',
      'id="dirProvOccChartX"></div>',
      'occChartTraced',
      'hote du barChart des occasions renomme (le graphe ne se monte plus)',
    );
    await runProvenanceMutation(
      'sources.map((row) => ',
      'sources.slice(0, -1).map((row) => ',
      'sourcesRowsMatch',
      'table des sources amputee de sa derniere ligne',
    );
    await runProvenanceMutation(
      "pas encore connectée.",
      "pas encore connectée. Age moyen 34 ans.",
      'noFakeAudienceNumber',
      'faux chiffre demographique injecte dans la carte Audience',
    );
    await runAnalyseMutation(
      'if (!dirAnalyseContainer) {',
      'if (true) {',
      'sameNode',
      'hote du board Analyse recree a chaque rendu (plus de noeud persistant : la config du board serait perdue au retour)',
    );
    const restored = await probeDirInvariants(browser);
    ok(restored.svgVisible && restored.focusPointsMatch && restored.deltaExact,
      'restauration inverse : les invariants du poste d observation tiennent de nouveau sur une page fraiche');
    const restoredDecision = await probeDirDecision(browser);
    ok(restoredDecision.cmpRowsMatch && restoredDecision.lapsedRowsMatch,
      'restauration inverse : 2 lignes de comparaison et 1 dormant reviennent sur une page fraiche');
    const restoredViews = await probeDirViews(browser);
    ok(restoredViews.activiteGridVisible && restoredViews.activiteFocusHidden,
      'restauration inverse : Activite remontre ses 4 graphes et cache le focus sur une page fraiche');
    const restoredHeights = await probeDirGridHeights(browser);
    ok(restoredHeights.equalHeights,
      `restauration inverse : les graphes de grille reviennent a hauteur egale (ecart ${restoredHeights.spread}px)`);
    const restoredProv = await probeDirProvenance(browser);
    ok(restoredProv.occChartTraced && restoredProv.occRowsMatch && restoredProv.sourcesRowsMatch && restoredProv.audienceHonest,
      'restauration inverse : Provenance retrace ses occasions, ses sources et sa carte Audience honnete sur une page fraiche');
    const restoredAnalyse = await probeDirAnalyse(browser);
    ok(restoredAnalyse.mounted && restoredAnalyse.sameNode,
      `restauration inverse : le board Analyse se monte et son hote persiste au retour sur une page fraiche (${restoredAnalyse.id1} -> ${restoredAnalyse.id2})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\ndirection-cockpit-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ndirection-cockpit-check: ALL OK');
}

main().catch((error) => {
  console.error('direction-cockpit-check: exception', error);
  process.exit(1);
});
