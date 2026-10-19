// LE PLANNING GLOBAL (onglet « Planning global », 2026-10-12) : toutes les
// activites du jour dans la grille d heures du bowling, une colonne par
// activite (assets/pinlane-planning-global.js).
//
// Une journee de vacances a Libramont, 22 groupes, 15:10 le samedi 24 octobre,
// la console reelle sur une API simulee dans la page (aucun reseau, aucune
// base). Pour l ordinateur 1440, le portable 1280, la tablette 800 x 1280 et
// le grand ecran 1920, en sombre et en clair :
//   [A] l onglet s appelle « Planning global », sa boite se montre, la liste du
//       jour vit dessous ;
//   [B] le planning tient dans le premier ecran ET le remplit (sa boite, pas la
//       page : la page defile vers la liste, comme sous le bowling) ;
//   [C] aucun nom, aucune etiquette (retard, à valider...) ni picto coupe,
//       aucune carte sur une autre, aucune tete de colonne coupee ;
//   [D] les infos d un groupe (pictos, etiquettes) vont a une carte qui vit
//       encore : celles de Noah ne sont pas sur son laser fini de 14:30 ;
//   [E] la bulle (souris) : tout le programme de Noah, sa note ; celle du
//       groupe en retard : son numero et « Arrivé » ; un groupe deja arrive n a
//       pas « Arrivé » ; elle reste quand on y entre, part quand on sort ;
//   [F] « Arrivé » ECRIT le pointage (PATCH) et toutes les cartes du groupe
//       passent a l ambre ;
//   [G] la recherche eteint les autres groupes sans retirer de carte ; « ⋯ »
//       ouvre ses gestes ;
//   [H] au doigt, toucher une carte ouvre la fiche ;
//   [H] au doigt, toucher une carte montre le programme du groupe, toucher
//       encore ouvre la fiche (2026-10-19) ;
//   [I] « Agrandir » ouvre le plein ecran et tout y tient ;
//   LA JOURNEE COMPLETE (2026-10-19, Movsar : « toutes les heures et le
//   planning complet et visibles même quand il n'y a rien ») :
//   [L] la journee chargee : chaque demi-heure de 10:00 a 23:30 (l ouverture a
//       la fermeture, rien de replie), les neuf activites du centre en
//       colonnes, celles sans groupe comprises ;
//   [M] les heures restent collees a gauche et les tetes en haut quand la
//       grille defile en elle-meme ;
//   [N] un jour sans reservation et un jour ferme gardent toute la grille
//       (heures d ouverture, toutes les colonnes) et un bandeau le dit ;
//   [P] la minute qui passe deplace la barre de l heure et les minutes de
//       retard sans reconstruire la grille ; un redessin rend le focus et le
//       defilement ;
//   [Q] une case vide du bowling ouvre la reservation rapide a son heure ;
//   [K] --contre-preuves : chaque regle retiree (en memoire, le disque n est
//       jamais touche) fait rougir sa lettre.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLANNING_GLOBAL_PORT || 5191);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JOUR = '2026-10-24';
const HEURE = '15:10';
const APPAREILS = {
  ordinateur: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-BE' },
  portable: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'fr-BE' },
  tablette: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' },
  grand: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'fr-BE' },
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };

let echecs = 0;
const lignes = [];
function ok(cond, label, detail = '') {
  lignes.push({ cond: Boolean(cond), label });
  if (!process.env.PG_SILENCE) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA JOURNEE : 22 groupes de 2 a 30 personnes, du matin au soir. Les pistes et
// les departs ne se chevauchent pas ; un groupe est en retard (Famille Simon),
// un autre a valider (FC Libramont U12) ; Noah a une note et deux parties.
// Format : celui que /api/staff-state sert a la console.
// ---------------------------------------------------------------------------
const min = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const GROUPES = [
  { nom: 'Famille Lambert', pax: 5, statut: 'paid', b: ['10:00', 60, [1]], a: ['11:00', 30] },
  { nom: 'Anniversaire Léa (8 ans)', pax: 12, statut: 'arrived', formule: 'f8', occasion: 'anniversaire', g: ['12:00', 120, 1], lib: ['playground', 'minigolf_blacklight', 'arcade_time'] },
  { nom: 'Scouts de Bastogne', pax: 24, statut: 'paid', b: ['11:00', 60, [4, 5, 6, 7]], l: ['12:00', 24] },
  { nom: 'Duo Martin', pax: 2, statut: 'paid', m: ['11:30', 45], t: ['12:15', 60, 1] },
  { nom: 'Famille Dubois', pax: 6, statut: 'arrived', l: ['12:30', 6], m: ['13:00', 45] },
  { nom: 'EVG de Thomas', pax: 10, statut: 'arrived', l: ['13:00', 10], b: ['13:30', 60, [1, 2]], t: ['14:30', 60, 2], note: 'Veut des boissons à table au billard', extras: ['u1', 'u1'] },
  { nom: 'Anniversaire Noah (10 ans)', pax: 14, statut: 'arrived', formule: 'f4', occasion: 'anniversaire', b: ['13:30', 60, [3, 4, 5]], l: ['14:30', 14], l2: ['15:00', 14], lib: ['minigolf_blacklight'], note: 'Gâteau au frigo, bougies 1 et 0' },
  { nom: 'Ardennes Logistique SA', pax: 30, statut: 'arrived', occasion: 'entreprise', l: ['14:00', 30], b: ['14:30', 60, [1, 2, 6, 7, 8]] },
  { nom: 'Famille Simon', pax: 4, statut: 'confirmed', d: ['15:00', 60, 1], a: ['16:00', 30] },
  { nom: 'Les ados du quartier', pax: 8, statut: 'confirmed', l: ['15:30', 8], m: ['16:00', 45] },
  { nom: 'Anniversaire Emma (9 ans)', pax: 10, statut: 'confirmed', formule: 'f7', occasion: 'anniversaire', g: ['15:30', 120, 2], lib: ['playground', 'minigolf_blacklight'] },
  { nom: 'Famille Petit', pax: 5, statut: 'confirmed', b: ['16:00', 60, [5]], a: ['17:00', 30] },
  { nom: 'FC Libramont U12', pax: 18, statut: 'confirmed', valider: true, l: ['16:30', 18], b: ['17:00', 60, [6, 7, 8]] },
  { nom: 'Couple Renard', pax: 2, statut: 'confirmed', b: ['17:30', 60, [1]] },
  { nom: 'Famille Collard', pax: 7, statut: 'pending', b: ['18:00', 60, [2, 3]], l: ['19:00', 7] },
  { nom: 'Collègues de la Poste', pax: 16, statut: 'confirmed', occasion: 'entreprise', l: ['18:30', 16], b: ['19:00', 60, [4, 5, 6]], extras: ['u1', 'u4'] },
  { nom: '30 ans de Julie', pax: 20, statut: 'confirmed', b: ['19:00', 90, [1, 2, 7, 8]], t: ['20:30', 60, 3], extras: ['u4', 'u2', 'u2'], note: 'Gâteau apporté par la famille' },
  { nom: 'Bande à Kevin', pax: 6, statut: 'confirmed', l: ['20:00', 6], m: ['20:30', 45], extras: ['u3'] },
  { nom: 'Équipe de volley', pax: 12, statut: 'confirmed', b: ['20:30', 60, [3, 4]], d: ['21:30', 60, 2] },
  { nom: 'Famille Henrard', pax: 4, statut: 'confirmed', b: ['21:00', 60, [5]] },
  { nom: 'EVJF de Sarah', pax: 9, statut: 'confirmed', occasion: 'evg', l: ['21:30', 9], b: ['22:00', 60, [1, 2]] },
  { nom: 'Amis de Marche', pax: 8, statut: 'pending', b: ['22:30', 60, [6, 7]] },
];
const EXTRAS = { u1: { id: 'u1', name: 'Cruche Bière', price: 18 }, u2: { id: 'u2', name: 'Cruche Soda', price: 12 }, u3: { id: 'u3', name: 'Pack Jetons', price: 10 }, u4: { id: 'u4', name: 'Tapas', price: 15 } };
const NOMS = { bowling: 'Bowling', laser_game: 'Laser Game', duckpin_bowling: 'Duckpin Bowling', billards: 'Billards', minigolf_blacklight: 'Minigolf Blacklight', arcade_time: 'Arcades', party_table: 'Table anniversaire' };
function journee(date) {
  return GROUPES.map((g, i) => {
    const blocs = [], items = [], etapes = [];
    if (g.b) { const [d, dur, pistes] = g.b; etapes.push(['bowling', d, dur]); blocs.push({ type: 'activity', resourceType: 'bowling_lane', activityId: 'bowling', startTime: d, endTime: hh(min(d) + dur), start: min(d), end: min(d) + dur, lanes: pistes, players: g.pax }); items.push({ activityId: 'bowling', planned: true, minutes: dur, duration: dur / 60 }); }
    for (const [cle, rang] of [['l', 1], ['l2', 2]]) {
      if (!g[cle]) continue;
      const [d, j] = g[cle];
      etapes.push(['laser_game', d, 25]);
      blocs.push({ type: 'activity', resourceType: 'laser_arena', activityId: 'laser_game', countIndex: rang, startTime: d, endTime: hh(min(d) + 25), start: min(d), end: min(d) + 25, players: j, weaponNeed: j, groupPlayers: j, groupWaveCount: 1 });
      if (rang === 1) items.push({ activityId: 'laser_game', planned: true, minutes: g.l2 ? 60 : 30, duration: g.l2 ? 1 : 0.5, games: g.l2 ? 2 : 1 });
    }
    (g.lib || []).forEach((id) => items.push({ activityId: id, planned: false, minutes: id === 'arcade_time' ? 30 : 45, sessions: 1 }));
    if (g.d) { const [d, dur, n] = g.d; etapes.push(['duckpin_bowling', d, dur]); items.push({ activityId: 'duckpin_bowling', planned: false, minutes: dur, duration: dur / 60, units: n, sessions: 1 }); }
    if (g.t) { const [d, dur, n] = g.t; etapes.push(['billards', d, dur]); items.push({ activityId: 'billards', planned: false, minutes: dur, units: n, hours: dur / 60, sessions: 1 }); }
    if (g.m) { const [d, dur] = g.m; etapes.push(['minigolf_blacklight', d, dur]); items.push({ activityId: 'minigolf_blacklight', planned: false, minutes: dur, sessions: 1 }); }
    if (g.a) { const [d, dur] = g.a; etapes.push(['arcade_time', d, dur]); items.push({ activityId: 'arcade_time', planned: false, minutes: dur, sessions: 1 }); }
    if (g.g) { const [d, dur, table] = g.g; etapes.push(['party_table', d, dur]); blocs.push({ type: 'activity', resourceType: 'party_table', activityId: 'party_table', startTime: d, endTime: hh(min(d) + dur), start: min(d), end: min(d) + dur, tableNeed: 1, table }); }
    const debut = Math.min(...etapes.map((e) => min(e[1])));
    const fin = Math.max(...etapes.map((e) => min(e[1]) + e[2]));
    const tri = etapes.slice().sort((x, y) => min(x[1]) - min(y[1]));
    const occ = {};
    const timeline = tri.map((e) => { occ[e[0]] = (occ[e[0]] || 0) + 1; return { type: 'activity', activityId: e[0], countIndex: occ[e[0]], label: NOMS[e[0]] || e[0], startTime: e[1], endTime: hh(min(e[1]) + e[2]) }; });
    const type = g.formule ? 'formule' : g.b ? 'bowling' : g.l ? 'laser' : 'visite';
    const prix = g.formule ? (g.formule === 'f4' ? 34 : 29) * g.pax : 39 * (g.b ? g.b[2].length * (g.b[1] / 60) : 0) + (g.l ? 10 * g.l[1] : 0) + (g.t ? 10 * g.t[2] : 0) + (g.d ? 20 * g.d[2] : 0) + (g.m ? 10 * g.pax : 0) + (g.a ? 5 * g.pax : 0);
    return {
      id: 90100 + i, name: g.nom, phone: '+32 470 ' + String(110000 + i * 7919).slice(0, 6).replace(/(\d{2})(\d{2})(\d{2})/, '$1 $2 $3'), email: `groupe${i + 1}@exemple.test`,
      centerId: 'libramont', date, startTime: tri[0][1], duration: g.b ? g.b[1] / 60 : 0.5, totalDuration: (fin - debut) / 60,
      type, formuleId: g.formule || '', label: g.formule ? 'FORMULE ' + g.formule.slice(1) : type === 'bowling' ? 'Bowling' : type === 'laser' ? 'Laser Game' : 'Visite',
      occasion: g.occasion || '', status: g.statut, pax: g.pax, lanes: g.b ? g.b[2] : [], price: Math.round(prix), basePrice: Math.round(prix),
      notes: g.note || '', channel: i % 3 === 0 ? 'staff' : 'public', validationStatus: g.valider ? 'staff_review' : 'confirmed',
      program: { items }, extras: (g.extras || []).map((id) => ({ ...EXTRAS[id] })), absentAt: null, amountPaid: g.statut === 'paid' ? Math.round(prix) : 0,
      opsPlan: { startTime: tri[0][1], arrivalTime: hh(debut - 10), endTime: hh(fin), assignedLanes: g.b ? g.b[2] : [], resourceBlocks: blocs, timeline },
      activityProgress: {}, createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-24T08:00:00.000Z',
    };
  });
}
const catalogue = require(path.join(ROOT, 'ops-knowledge', 'activities.json'));
const ACTIVITES = (Array.isArray(catalogue) ? catalogue : catalogue.activities || Object.values(catalogue)).filter((a) => a && a.id);

// ---------------------------------------------------------------------------
// LE SERVEUR : les fichiers du depot, une mutation au plus, compilee en memoire.
// ---------------------------------------------------------------------------
let mutationActive = null;
const desarmees = [];
function servir() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let f = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') f = path.join(ROOT, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    let corps = fs.readFileSync(f);
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    for (const m of mutationActive ? mutationActive.editions : []) {
      if (m.fichier !== rel) continue;
      const texte = corps.toString('utf8').replace(/\r\n/g, '\n');
      const n = texte.split(m.de).length - 1;
      if (n !== 1) desarmees.push(`${mutationActive.nom} : ancre trouvee ${n} fois dans ${m.fichier}`);
      corps = Buffer.from(texte.replace(m.de, () => m.vers), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(corps);
  });
  return new Promise((ok2, ko) => { server.once('error', ko); server.listen(PORT, '127.0.0.1', () => ok2(server)); });
}

// L API DANS LA PAGE : session de la direction, la journee, le catalogue, le
// centre de Libramont ; un PATCH de statut s ecrit et se renvoie.
function installerMock(page, reservations) {
  const expiresAt = new Date(new Date(JOUR + 'T12:00:00Z').getTime() + 7 * 864e5).toISOString();
  return page.addInitScript(({ expiresAt, JOUR, RESERVATIONS, ACTIVITES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'payments.markPaid', 'clients.view', 'settings.manage', 'direction.view'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Accueil', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // (le lundi est ferme : le 26 octobre sert de jour ferme a [N])
    const semaine = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), d === 1 ? { closed: true } : { open: '10:00', close: '24:00' }]));
    const centre = { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, preferAdjacentLanes: true }, laser: { weaponCount: 30, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical', maxPlayers: 30 }, partyTables: { softCapacity: 6, hardCapacity: 8 } }, defaultSchedule: { regular: semaine, holiday: {} }, activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {}, classification: {}, customActivities: [] };
    const jours = { [JOUR]: RESERVATIONS };
    window.__JOURS__ = jours;
    window.__PATCHS__ = [];
    const J = (p, status = 200) => new Response(JSON.stringify(p), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), permissions: perms, locked: true }], members: [{ id: 'qa', name: 'Accueil', roleId: 'direction' }] } });
      if (u.pathname === '/api/staff-customer-notes' && m === 'GET') { const lot = u.searchParams.get('reservationIds'); const s = (id) => ({ eligible: true, clientKey: 'p:qa' + id, note: null }); if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), s(Number(id))])) }); return J({ ok: true, ...s(Number(u.searchParams.get('reservationId'))) }); }
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || JOUR; return J({ ok: true, revision: 'qa-' + d + '-' + window.__PATCHS__.length, reservations: jours[d] || [], laneStatuses: {}, centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: JOUR, durationOptions: [], formules: [], center: null, activities: ACTIVITES });
      if (u.pathname === '/api/ops') { if (u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: [centre], activities: [] }); return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} }); }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || JOUR; return J({ ok: true, reservations: jours[d] || [], emails: [], agentEvents: [], centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const corps = JSON.parse(init.body || '{}');
        window.__PATCHS__.push(corps);
        const i = (jours[JOUR] || []).findIndex((x) => String(x.id) === String(corps.id));
        if (i < 0) return J({ ok: false, error: 'introuvable' }, 404);
        if (corps.status) { jours[JOUR][i] = { ...jours[JOUR][i], status: corps.status, updatedAt: new Date().toISOString() }; return J({ ok: true, reservation: jours[JOUR][i] }); }
        return J({ ok: false, error: 'non gere' }, 400);
      }
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, JOUR, RESERVATIONS: reservations, ACTIVITES });
}

async function repos(page, ms = 350) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity) && !document.querySelector('[data-pl-anim]'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
}

async function monter(browser, appareil, theme) {
  const ctx = await browser.newContext({ ...appareil, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.clock.setFixedTime(new Date(`${JOUR}T${HEURE}:00+02:00`));
  await installerMock(page, journee(JOUR));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 60000 });
  await page.evaluate(async ({ jour, theme }) => {
    await ensureStaffConsolesLoaded();
    state.currentDate = jour; state.adminCenterId = 'libramont'; state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; state.staffTheme = theme;
    state.searchTerm = ''; state.staffStatusFilter = 'all'; state.staffPlanningExpanded = false; state.staffLaserPlanningExpanded = false; state.staffTableExpanded = false; state.staffGlobalExpanded = false;
    state.reservations = window.__JOURS__[jour].map((x) => ({ ...x }));
    document.documentElement.setAttribute('data-theme', theme);
    setView('staff');
    while (staffCenterConfigCache.loading) await new Promise((r) => setTimeout(r, 25));
    await loadStaffCenterConfig(true);
    renderStaff();
    window.scrollTo(0, 0);
  }, { jour: JOUR, theme });
  await repos(page, 400);
  return { ctx, page, erreurs };
}

// ---------------------------------------------------------------------------
// LES MESURES
// ---------------------------------------------------------------------------
function mesurer() {
  const gh = document.querySelector('#globalPlanningBox .gh');
  const grille = gh && gh.querySelector('.gh-grille');
  const boite = document.getElementById('globalPlanningBox');
  const liste = document.getElementById('staffTableBox');
  if (!gh || !grille) return { manque: true };
  const coupes = [];
  gh.querySelectorAll('.gh-c__nom').forEach((nom) => {
    if (!nom.offsetParent) return;
    const l1 = nom.closest('.gh-c__l1').getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(nom);
    if (Array.from(r.getClientRects()).some((x) => (x.top + x.bottom) / 2 > l1.bottom + 0.5 || x.right > l1.right + 1)) coupes.push('nom ' + nom.textContent);
  });
  gh.querySelectorAll('.gh-c__l1').forEach((l1) => { if (l1.offsetParent && l1.scrollWidth > l1.clientWidth + 1) coupes.push('large ' + l1.textContent.slice(0, 40)); });
  gh.querySelectorAll('.gh-c .gp-tag, .gh-c .gh-pictos .bk-flag').forEach((t) => {
    if (!t.offsetParent) return;
    const l1 = t.closest('.gh-c__l1').getBoundingClientRect();
    const r = t.getBoundingClientRect();
    if ((r.top + r.bottom) / 2 > l1.bottom + 0.5 || r.right > l1.right + 1 || t.scrollWidth > t.clientWidth + 0.5) coupes.push('etiquette ' + (t.textContent || t.getAttribute('aria-label')) + ' (' + t.closest('.gh-c').querySelector('.gh-c__nom').textContent + ')');
  });
  const chevauchements = [];
  gh.querySelectorAll('.gh-pile').forEach((pile) => {
    const cs = Array.from(pile.querySelectorAll('.gh-c')).map((c) => ({ n: c.querySelector('.gh-c__nom').textContent, r: c.getBoundingClientRect() }));
    for (let i = 0; i < cs.length; i += 1) for (let j = i + 1; j < cs.length; j += 1) {
      const a = cs[i].r, b = cs[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) chevauchements.push(cs[i].n + ' / ' + cs[j].n);
    }
  });
  Array.from(gh.querySelectorAll('.gh-entete__t')).filter((t) => t.scrollWidth > t.clientWidth + 0.5).forEach((t) => coupes.push('tete ' + t.textContent));
  // Les pictos de Noah : sur une carte qui vit encore.
  const noah = Array.from(gh.querySelectorAll('.gh-c')).filter((c) => /Noah/.test(c.textContent) && c.querySelector('.gh-pictos'));
  const rb = boite.getBoundingClientRect();
  const fixe = getComputedStyle(boite).position === 'fixed';
  const rl = liste && !liste.classList.contains('hidden') ? liste.getBoundingClientRect() : null;
  return {
    onglet: ((document.querySelector('#staffTabAll .main') || {}).textContent || '').trim(),
    defile: gh.classList.contains('is-defile'), tropSerre: gh.classList.contains('is-trop-serre'), hh: getComputedStyle(gh).getPropertyValue('--gh-h').trim(),
    boiteBas: Math.round(rb.bottom + (fixe ? 0 : scrollY)), innerH: innerHeight, pageLarge: document.documentElement.scrollWidth <= innerWidth + 1,
    grilleH: grille.scrollHeight <= grille.clientHeight + 1, grilleL: grille.scrollWidth <= grille.clientWidth + 1,
    listeDessous: rl ? rl.top >= rb.bottom - 1 : false,
    coupes, chevauchements,
    noahPictos: noah.map((c) => (c.className.match(/is-(fini|encours|avenir|retard)/) || [])[1]),
    // La barre de l heure dans la fenetre de la grille (sous les tetes collees).
    maintenantVu: (() => { const b = gh.querySelector('.gh-maintenant'); if (!b || b.hidden) return false; const r = b.getBoundingClientRect(), g = grille.getBoundingClientRect(); return r.top >= g.top + 40 && r.bottom <= g.bottom + 0.5; })(),
  };
}
const tient = (m) => !m.manque && m.boiteBas <= m.innerH && (m.defile || m.grilleH) && (m.tropSerre || m.grilleL) && m.pageLarge;
// Remplir l ecran : sa boite finit a moins de 60 px du bas, qu elle defile en
// elle-meme ou non (une grille ecrasee tiendrait, sans servir).
const remplit = (m) => !m.manque && m.boiteBas >= m.innerH - 60;
const propre = (m) => !m.manque && !m.coupes.length && !m.chevauchements.length;

async function lireBulle(page, carte) {
  const boite = await carte.boundingBox();
  return page.evaluate((c) => {
    const b = document.querySelector('#ghBulle.is-vue');
    if (!b || getComputedStyle(b).visibility !== 'visible') return { vue: false };
    const r = b.getBoundingClientRect();
    const dedans = r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const couvre = Boolean(c) && r.left < c.x + c.width - 1 && c.x < r.right - 1 && r.top < c.y + c.height - 1 && c.y < r.bottom - 1;
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return {
      vue: true, dedans, couvre, dessus: Boolean(h) && b.contains(h),
      nom: ((b.querySelector('.gh-b__nom') || {}).textContent || ''), lignes: b.querySelectorAll('.gh-b__prog li').length, ici: Boolean(b.querySelector('.gh-b__prog li.is-ici')),
      notes: b.querySelectorAll('.gh-b__note').length, appeler: Boolean(b.querySelector('.gh-b__tel')), arrive: Boolean(b.querySelector('[data-gh-arrive]')),
      groupe: document.querySelectorAll('#globalPlanningBox .gh-c.is-groupe').length,
    };
  }, boite);
}
const bulleBien = (b) => b.vue && b.dedans && !b.couvre && b.dessus;

// LA GRILLE D UN JOUR : ses etiquettes d heure, ses colonnes, son bandeau.
const COLONNES_DU_CENTRE = ['Bowling', 'Duckpin', 'Laser', 'Fun Run', 'Arcades', 'Minigolf', 'O’Clock', 'Plaine', 'Billard'];
function lireGrille() {
  const gh = document.querySelector('#globalPlanningBox .gh');
  const grille = gh && gh.querySelector('.gh-grille');
  if (!grille) return { manque: true, vide: Boolean(document.querySelector('#globalPlanningBox .gp-vide')) };
  return {
    heures: Array.from(grille.querySelectorAll('.gh-pile--h .gh-h')).map((h) => h.textContent.trim()),
    colonnes: Array.from(grille.querySelectorAll('.gh-entete:not(.gh-entete--h) .gh-entete__t')).map((t) => t.textContent.trim()),
    piles: grille.querySelectorAll('.gh-pile:not(.gh-pile--h)').length,
    cartes: grille.querySelectorAll('.gh-c').length,
    bandeau: ((gh.querySelector('.gh-bandeau') || {}).textContent || '').trim(),
    reserve: grille.querySelectorAll('.gh-pile.is-reserve').length,
    repli: Boolean(gh.querySelector('[data-gh-matin]')),
  };
}
const demiHeures = (de, a) => { const l = []; for (let m = min(de); m < min(a); m += 30) l.push(hh(m)); return l; };
const toutesLesHeures = (g, de, a) => !g.manque && JSON.stringify(g.heures) === JSON.stringify(demiHeures(de, a));
const toutesLesColonnes = (g) => !g.manque && JSON.stringify(g.colonnes) === JSON.stringify(COLONNES_DU_CENTRE) && g.piles === COLONNES_DU_CENTRE.length;

// LES HEURES ET LES TETES COLLEES : la grille, reduite a une petite fenetre,
// defile vers le bas et de cote ; la tete d une colonne reste en haut de la
// fenetre, la colonne des heures a sa gauche.
function lireCollees() {
  const grille = document.querySelector('#globalPlanningBox .gh-grille');
  if (!grille) return { manque: true };
  grille.style.maxHeight = '260px';
  grille.style.maxWidth = '520px';
  grille.scrollTop = 300;
  grille.scrollLeft = 260;
  const g = grille.getBoundingClientRect();
  const tete = grille.querySelector('.gh-entete:not(.gh-entete--h)').getBoundingClientRect();
  const coin = grille.querySelector('.gh-entete--h').getBoundingClientRect();
  const heures = grille.querySelector('.gh-pile--h').getBoundingClientRect();
  const r = { defileY: grille.scrollTop > 0, defileX: grille.scrollLeft > 0, teteHaut: Math.abs(tete.top - g.top - grille.clientTop), coinGauche: Math.abs(coin.left - g.left - grille.clientLeft), heuresGauche: Math.abs(heures.left - g.left - grille.clientLeft) };
  grille.style.maxWidth = '';
  return r;
}
const collees = (c) => !c.manque && c.defileY && c.defileX && c.teteHaut <= 1.5 && c.coinGauche <= 1.5 && c.heuresGauche <= 1.5;

// ---------------------------------------------------------------------------
// LES SCENARIOS
// ---------------------------------------------------------------------------
async function scenarios(browser, { appareils = Object.keys(APPAREILS), themes = ['dark', 'light'] } = {}) {
  for (const nom of appareils) {
    for (const theme of themes) {
      const appareil = APPAREILS[nom];
      const ici = `${nom} ${theme}`;
      const { ctx, page, erreurs } = await monter(browser, appareil, theme);
      try {
        const lu = await page.evaluate(mesurer);
        ok(!lu.manque && lu.onglet === 'Planning global' && lu.listeDessous, `[A] ${ici} : l onglet « Planning global », sa boite, la liste dessous`, lu.manque ? 'pas de planning' : { onglet: lu.onglet, listeDessous: lu.listeDessous });
        if (lu.manque) continue;
        ok(tient(lu) && remplit(lu), `[B] ${ici} : le planning tient dans le premier ecran et le remplit`, { boiteBas: lu.boiteBas, innerH: lu.innerH, hh: lu.hh, defile: lu.defile });
        ok(propre(lu), `[C] ${ici} : rien de coupe, aucune carte sur une autre`, { coupes: lu.coupes.slice(0, 4), chevauchements: lu.chevauchements.slice(0, 3) });
        ok(lu.noahPictos.length > 0 && lu.noahPictos.every((e) => e !== 'fini'), `[D] ${ici} : les pictos de Noah sont sur une carte qui vit encore`, lu.noahPictos);

        if (!appareil.hasTouch) {
          const noah = page.locator('#globalPlanningBox .gh-c.is-encours', { hasText: 'Noah' }).first();
          await noah.hover();
          await page.waitForTimeout(650);
          const b1 = await lireBulle(page, noah);
          ok(bulleBien(b1) && b1.lignes >= 4 && b1.ici && b1.notes >= 1 && b1.groupe >= 2 && /Noah/.test(b1.nom), `[E] ${ici} : la bulle de Noah dit tout son programme et sa note`, b1);
          // Chaque bulle s ouvre a neuf : la souris sort, la bulle d avant part
          // (une bulle ouverte peut couvrir la carte voisine, comme a l ecran).
          const aNeuf = async (carte) => {
            await page.mouse.move(2, 2, { steps: 2 });
            await page.waitForTimeout(450);
            await carte.hover();
            await page.waitForTimeout(650);
            return lireBulle(page, carte);
          };
          const ardennes = page.locator('#globalPlanningBox .gh-c', { hasText: 'Ardennes Logistique' }).first();
          const b0 = await aNeuf(ardennes);
          ok(b0.vue && /Ardennes/.test(b0.nom) && !b0.arrive, `[E] ${ici} : un groupe deja arrive n a pas « Arrivé »`, b0);
          const simon = page.locator('#globalPlanningBox .gh-c', { hasText: 'Famille Simon' }).first();
          const b2 = await aNeuf(simon);
          ok(bulleBien(b2) && /Simon/.test(b2.nom) && b2.appeler && b2.arrive, `[E] ${ici} : la bulle du groupe en retard montre son numero et « Arrivé »`, b2);
          const bb = await page.locator('#ghBulle').boundingBox();
          await page.mouse.move(bb.x + bb.width / 2, bb.y + 12, { steps: 3 });
          await page.waitForTimeout(350);
          const gardee = await page.evaluate(() => { const b = document.querySelector('#ghBulle.is-vue'); return b ? (b.querySelector('.gh-b__nom') || {}).textContent : ''; });
          ok(/Simon/.test(gardee || ''), `[E] ${ici} : la bulle reste quand la souris y entre`, gardee);
          if (nom === 'ordinateur' && /Simon/.test(gardee || '')) {
            await page.locator('#ghBulle [data-gh-arrive]').click();
            await page.waitForTimeout(800);
            const apres = await page.evaluate(() => ({
              patch: (window.__PATCHS__ || []).filter((p) => p.status === 'arrived').map((p) => p.id),
              teintes: Array.from(document.querySelectorAll('#globalPlanningBox .gh-c')).filter((c) => /Famille Simon/.test(c.textContent)).map((c) => (c.className.match(/t-\w+/) || [''])[0]),
            }));
            ok(apres.patch.length === 1 && apres.patch[0] === 90108 && apres.teintes.length > 0 && apres.teintes.every((t) => t === 't-arr'), `[F] ${ici} : « Arrivé » ecrit le pointage et le groupe passe a l ambre`, apres);
          } else if (nom === 'ordinateur') {
            ok(false, `[F] ${ici} : « Arrivé » ecrit le pointage et le groupe passe a l ambre`, 'la bulle de Famille Simon n est pas ouverte');
          }
          await page.mouse.move(2, 2, { steps: 2 });
          await page.waitForTimeout(450);
          const partie = await page.evaluate(() => !document.querySelector('#ghBulle.is-vue') && !document.querySelector('#globalPlanningBox .gh.a-groupe'));
          ok(partie, `[E] ${ici} : la bulle part quand la souris sort`);
          const avant = await page.evaluate(() => document.querySelectorAll('#globalPlanningBox .gh-c').length);
          await page.fill('#globalPlanningSearchInput', 'noah');
          await page.waitForTimeout(400);
          const ch = await page.evaluate(() => ({ cartes: document.querySelectorAll('#globalPlanningBox .gh-c').length, ternes: document.querySelectorAll('#globalPlanningBox .gh-c.is-terne').length, noahTerne: Array.from(document.querySelectorAll('#globalPlanningBox .gh-c.is-terne')).some((c) => /Noah/.test(c.textContent)) }));
          ok(ch.cartes === avant && ch.ternes > 0 && !ch.noahTerne, `[G] ${ici} : la recherche eteint les autres groupes sans retirer de carte`, { avant, ...ch });
          await page.fill('#globalPlanningSearchInput', '');
          await page.waitForTimeout(300);
          await page.click('#globalPlanningBox .planning-more-btn');
          await page.waitForTimeout(200);
          const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.staff-action-popover button')).map((x) => x.textContent.trim()));
          ok(menu.includes('Voir la liste des réservations') && menu.includes('Feuille de secours (PDF)') && menu.includes('Agrandir le planning'), `[G] ${ici} : « ⋯ » ouvre ses gestes`, menu);
          await page.evaluate(() => closeStaffFloatingMenus());
          // [Q] Une case vide du bowling (12:30, entre les Scouts et l EVG) :
          // la reservation rapide a cette heure, au bowling.
          const caseVide = await page.evaluate(() => {
            const pile = document.querySelector('#globalPlanningBox .gh-pile.is-reserve[data-gh-cle="bowling"]');
            const racine = document.querySelector('#globalPlanningBox .gh');
            const grille = racine && racine.querySelector('.gh-grille');
            if (!pile || !grille) return null;
            const h = parseFloat(getComputedStyle(racine).getPropertyValue('--gh-h'));
            grille.scrollTop = Math.max(0, h * 2.5 - 40);
            const r = pile.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + h * 2.75 };
          });
          await page.waitForTimeout(150);
          if (caseVide) { await page.mouse.move(caseVide.x, caseVide.y, { steps: 2 }); await page.waitForTimeout(120); }
          const fantome = await page.evaluate(() => { const f = document.querySelector('#globalPlanningBox .gh-ajout'); return f && !f.hidden ? f.textContent : ''; });
          if (caseVide) await page.mouse.click(caseVide.x, caseVide.y);
          await page.waitForTimeout(400);
          const rapide = await page.evaluate(() => ({ ouverte: typeof quickBookState !== 'undefined' && Boolean(quickBookState), heure: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.startTime : null, type: typeof quickBookState !== 'undefined' && quickBookState ? quickBookState.type : null }));
          ok(rapide.ouverte && rapide.heure === '12:30' && rapide.type === 'bowling' && fantome === '+ 12:30', `[Q] ${ici} : une case vide du bowling ouvre la reservation rapide a son heure`, { ...rapide, fantome });
          await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });
          await page.mouse.move(2, 2);
          await repos(page, 200);
        } else {
          // [H] AU DOIGT, DEUX TEMPS : le premier toucher montre le programme
          // (la bulle, ses cartes allumees), le second ouvre la fiche.
          const petit = page.locator('#globalPlanningBox .gh-c', { hasText: 'Famille Petit' }).first();
          await petit.scrollIntoViewIfNeeded();
          await petit.tap();
          await page.waitForTimeout(500);
          const premier = await page.evaluate(() => ({ nom: state.selectedRes && state.selectedRes.name, bulle: ((document.querySelector('#ghBulle.is-vue .gh-b__nom') || {}).textContent || ''), lignes: document.querySelectorAll('#ghBulle.is-vue .gh-b__prog li').length, groupe: document.querySelectorAll('#globalPlanningBox .gh-c.is-groupe').length }));
          ok(!premier.nom && /Famille Petit/.test(premier.bulle) && premier.lignes >= 2 && premier.groupe >= 2, `[H] ${ici} : toucher une carte montre le programme du groupe`, premier);
          await petit.tap();
          await page.waitForTimeout(500);
          const fiche = await page.evaluate(() => ({ nom: state.selectedRes && state.selectedRes.name, bulle: Boolean(document.querySelector('#ghBulle.is-vue')) }));
          ok(fiche.nom === 'Famille Petit' && !fiche.bulle, `[H] ${ici} : toucher encore ouvre sa fiche`, fiche);
          await page.evaluate(() => closePos());
          await page.waitForTimeout(300);
        }

        // [L] LA JOURNEE CHARGEE, COMPLETE : chaque demi-heure de l ouverture a
        // la fermeture, rien de replie, les neuf activites du centre.
        const charge = await page.evaluate(lireGrille);
        ok(toutesLesHeures(charge, '10:00', '24:00') && !charge.repli, `[L] ${ici} : la journee chargee montre chaque demi-heure de 10:00 a 23:30`, { heures: charge.heures && [charge.heures[0], charge.heures[charge.heures.length - 1], charge.heures.length], repli: charge.repli });
        ok(toutesLesColonnes(charge), `[L] ${ici} : les neuf activites du centre ont leur colonne, vides comprises`, charge.colonnes);

        // [M] Les heures collees a gauche, les tetes en haut.
        const col = await page.evaluate(lireCollees);
        ok(collees(col), `[M] ${ici} : les heures restent a gauche et les tetes en haut quand la grille defile`, col);
        await page.evaluate(() => { const w = document.getElementById('globalPlanningGridWrap'); w._ghHtml = null; w._ghJourDessine = null; renderGlobalPlanningSurface(); });
        await repos(page, 200);

        // [P] LA MINUTE QUI PASSE : la meme grille, la barre deplacee, le
        // retard recompte ; puis un redessin rend le focus et le defilement.
        const avantTic = await page.evaluate(() => {
          const g = document.querySelector('#globalPlanningBox .gh-grille');
          window.__grilleTic = g;
          window.__carteTic = g.querySelector('.gh-c');
          const gh = document.querySelector('#globalPlanningBox .gh');
          const retard = Array.from(gh.querySelectorAll('.gh-c .gp-tag.is-retard .gh-min')).map((n) => n.textContent);
          return { now: Number(getComputedStyle(gh).getPropertyValue('--gh-now')), etiquette: (gh.querySelector('.gh-maintenant-h') || {}).textContent, retard };
        });
        await page.clock.setFixedTime(new Date(`${JOUR}T15:11:00+02:00`));
        await page.evaluate(() => tickHorlogeStaff());
        await repos(page, 200);
        const apresTic = await page.evaluate(() => {
          const g = document.querySelector('#globalPlanningBox .gh-grille');
          const gh = document.querySelector('#globalPlanningBox .gh');
          const retard = Array.from(gh.querySelectorAll('.gh-c .gp-tag.is-retard .gh-min')).map((n) => n.textContent);
          return { meme: g === window.__grilleTic && window.__carteTic.isConnected, now: Number(getComputedStyle(gh).getPropertyValue('--gh-now')), etiquette: (gh.querySelector('.gh-maintenant-h') || {}).textContent, retard };
        });
        ok(apresTic.meme && Math.abs(apresTic.now - avantTic.now - 1 / 60) < 1e-3 && avantTic.etiquette === '15:10' && apresTic.etiquette === '15:11' && (avantTic.retard.length > 0 || nom === 'ordinateur') && apresTic.retard.length === avantTic.retard.length && apresTic.retard.every((n, i) => Number(n) === Number(avantTic.retard[i]) + 1), `[P] ${ici} : la minute deplace la barre et le retard sans reconstruire la grille`, { avantTic, apresTic });
        await page.clock.setFixedTime(new Date(`${JOUR}T${HEURE}:00+02:00`));
        const garde = await page.evaluate(async () => {
          const wrap = document.getElementById('globalPlanningGridWrap');
          const g = wrap.querySelector('.gh-grille');
          const carte = Array.from(wrap.querySelectorAll('.gh-c')).find((c) => /Ardennes/.test(c.textContent));
          carte.focus();
          const k = carte.getAttribute('data-gh-k');
          g.scrollTop = Math.min(g.scrollHeight - g.clientHeight, 37);
          const y = g.scrollTop;
          wrap._ghHtml = null;
          renderGlobalPlanningSurface();
          await new Promise((r) => requestAnimationFrame(() => r()));
          const g2 = wrap.querySelector('.gh-grille');
          return { refait: g2 !== g, focus: document.activeElement && document.activeElement.getAttribute('data-gh-k') === k, y, y2: g2.scrollTop };
        });
        ok(garde.refait && garde.focus && Math.abs(garde.y2 - garde.y) <= 1, `[P] ${ici} : un redessin rend le focus et le defilement`, garde);
        await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); renderGlobalPlanningSurface(); });

        // [N] UN JOUR SANS RESERVATION, UN JOUR FERME : toute la grille, un bandeau.
        const jourDe = (d) => page.evaluate(async ({ d, JOUR }) => { state.currentDate = d; if (d === JOUR) state.reservations = window.__JOURS__[JOUR].map((x) => ({ ...x })); renderStaff(); await new Promise((r) => setTimeout(r, 60)); }, { d, JOUR });
        await jourDe('2026-10-25');
        await repos(page, 200);
        const vide = await page.evaluate(lireGrille);
        ok(toutesLesHeures(vide, '10:00', '24:00') && toutesLesColonnes(vide) && vide.cartes === 0 && /Aucune réservation/.test(vide.bandeau) && !vide.vide, `[N] ${ici} : un jour sans reservation garde toute sa grille et le dit`, vide);
        await jourDe('2026-10-26');
        await repos(page, 200);
        const ferme = await page.evaluate(lireGrille);
        ok(toutesLesHeures(ferme, '10:00', '22:00') && toutesLesColonnes(ferme) && /Centre fermé ce jour-là/.test(ferme.bandeau) && ferme.reserve === 0, `[N] ${ici} : un jour ferme garde sa grille, le bandeau « Centre fermé ce jour-là », aucune case a reserver`, ferme);
        await jourDe(JOUR);
        await repos(page, 250);
        await page.click('#globalPlanningToggle');
        if (!appareil.hasTouch) await page.mouse.move(2, 2);
        await repos(page, 300);
        const ag = await page.evaluate(mesurer);
        const plein = await page.evaluate(() => ({ ouvert: document.getElementById('globalPlanningBox').classList.contains('expanded'), bouton: document.getElementById('globalPlanningToggle').textContent }));
        // (la journee entiere a 13 px ne tient pas toujours sans defiler, 14 h
        // sur 800 px : la grille defile alors en elle-meme, ouverte sur l heure)
        ok(plein.ouvert && plein.bouton === 'Réduire' && tient(ag) && (!ag.defile || ag.maintenantVu) && propre(ag), `[I] ${ici} : « Agrandir » ouvre le plein ecran, tout y tient sans defiler ou s ouvre sur l heure qu il est`, { plein, defile: ag.defile, maintenantVu: ag.maintenantVu, coupes: (ag.coupes || []).slice(0, 3) });
        await page.click('#globalPlanningToggle');
        await repos(page, 200);
        ok(erreurs.length === 0, `[A] ${ici} : zero erreur JS`, erreurs.slice(0, 3));
      } finally {
        await ctx.close();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// [K] LES CONTRE-PREUVES : chaque regle retiree fait rougir sa lettre.
// ---------------------------------------------------------------------------
const MODULE = 'assets/pinlane-planning-global.js';
const MUTATIONS = [
  // (2026-10-19 : la mutation « etiquettes », les etiquettes hors de
  // l essentiel, ne rougit plus : a 13 px sur des heures de 66 a 72 px, la
  // journee type laisse a chaque carte la place de ses etiquettes, sur les
  // quatre ecrans et les deux themes. La regle reste dans le module ; il lui
  // faut une journee plus serree pour etre reprouvee.)
  // La boite mesuree a la page : la liste dessous ecrase la grille
  // (au portable, la grille qui defile s ecrase et ne remplit plus l ecran)
  { nom: 'hauteur', lettre: '[B] portable light', appareils: ['portable'], themes: ['light'],
    editions: [{ fichier: MODULE, de: '      : Math.ceil(boite.getBoundingClientRect().bottom + window.scrollY + GH.bas - window.innerHeight);', vers: '      : document.documentElement.scrollHeight - window.innerHeight;' }] },
  // Les infos d un groupe a la premiere carte a egalite, finie ou pas.
  { nom: 'carte-vive', lettre: '[D] ordinateur light', appareils: ['ordinateur'], themes: ['light'],
    editions: [{ fichier: MODULE, de: "        var vive = ghEtat(s, m) !== 'fini';\n", vers: '        var vive = true;\n' }] },
  // « Arrivé » sans ses gardes : un groupe deja arrive le propose.
  { nom: 'gardes-arrive', lettre: '[E] ordinateur light : un groupe deja arrive', appareils: ['ordinateur'], themes: ['light'],
    editions: [{ fichier: MODULE, de: "    var peutArriver = m.aujourdHui && g.etat === 'upcoming' && r.status !== 'paid' && r.status !== 'arrived' && typeof setReservationStatusDirect === 'function';", vers: "    var peutArriver = typeof setReservationStatusDirect === 'function';" }] },
  // Le rendu des donnees (sondage, statut) oublie le planning global : la carte
  // ne passe pas a l ambre apres « Arrivé ».
  { nom: 'rendu-donnees', lettre: '[F] ordinateur light', appareils: ['ordinateur'], themes: ['light'],
    editions: [{ fichier: 'assets/app-main.js', de: '  renderLaserPlanning();\n  renderGlobalPlanningSurface();\n  renderTable();\n}\n\nfunction applyOptimisticReservation(', vers: '  renderLaserPlanning();\n  renderTable();\n}\n\nfunction applyOptimisticReservation(' }] },
  // LA JOURNEE COMPLETE (2026-10-19). Les heures lues ailleurs que dans les
  // horaires du centre : le jour vide perd son matin et son soir, le jour
  // ferme son bandeau.
  { nom: 'heures-du-centre', lettre: '[N] ordinateur dark', appareils: ['ordinateur'], themes: ['dark'],
    editions: [{ fichier: MODULE, de: "fenetre: typeof getPlanningWindow === 'function' ? getPlanningWindow(jour) : { open: 10, close: 22, closed: false } };", vers: "fenetre: { open: 14, close: 20, closed: false } };" }] },
  // Une colonne seulement pour une activite reservee : Fun Run et O’Clock disparaissent.
  { nom: 'colonnes-du-centre', lettre: '[L] ordinateur dark', appareils: ['ordinateur'], themes: ['dark'],
    editions: [{ fichier: MODULE, de: 'return c.groupes > 0 || gpColonneDuCentre(c); })', vers: 'return c.groupes > 0; })' }] },
  // Les heures qui defilent avec la grille, puis les tetes.
  { nom: 'heures-collees', lettre: '[M] ordinateur dark', appareils: ['ordinateur'], themes: ['dark'],
    editions: [{ fichier: 'assets/pinlane-planning-global.css', de: '.gh-pile--h { position: sticky; left: 0;', vers: '.gh-pile--h { position: relative; left: 0;' }] },
  { nom: 'tetes-collees', lettre: '[M] ordinateur dark', appareils: ['ordinateur'], themes: ['dark'],
    editions: [{ fichier: 'assets/pinlane-planning-global.css', de: '  position: sticky; top: 0; z-index: 7;', vers: '  position: relative; top: 0; z-index: 7;' }] },
  // L heure qu il est remise dans le dessin : chaque minute reconstruit la grille.
  { nom: 'tic-sans-dessin', lettre: '[P] ordinateur dark', appareils: ['ordinateur'], themes: ['dark'],
    editions: [{ fichier: MODULE, de: `'<i class="gh-maintenant" aria-hidden="true" hidden></i>'`, vers: `'<i class="gh-maintenant" aria-hidden="true" hidden data-t="' + m.maintenant + '"></i>'` }] },
];

async function main() {
  const serveur = await servir();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!process.argv.includes('--contre-preuves')) {
      // (PG_APPAREILS=tablette PG_THEMES=dark : un sous-ensemble, pour iterer)
      await scenarios(browser, { appareils: process.env.PG_APPAREILS ? process.env.PG_APPAREILS.split(',') : undefined, themes: process.env.PG_THEMES ? process.env.PG_THEMES.split(',') : undefined });
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PG_MUTATIONS || process.env.PG_MUTATIONS.split(',').includes(x.nom))) {
        const garde = lignes.length;
        const avant = echecs;
        mutationActive = m;
        process.env.PG_SILENCE = '1';
        try { await scenarios(browser, { appareils: m.appareils, themes: m.themes }); } catch (e) { lignes.push({ cond: false, label: `crash ${e.message}` }); }
        delete process.env.PG_SILENCE;
        mutationActive = null;
        const rouges = lignes.slice(garde).filter((l) => !l.cond).map((l) => l.label);
        lignes.length = garde;
        echecs = avant;
        ok(rouges.some((l) => l.startsWith(m.lettre)), `[K] mutation ${m.nom} : « ${m.lettre} » rougit`, rouges.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
      ok(desarmees.length === 0, '[K] chaque mutation a trouve son ancre une fois', desarmees.join(' | '));
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  if (echecs) { console.error(`\nplanning-global-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-global-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
// (la journee et l API simulee servent aussi aux captures avant/apres)
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
else module.exports = { journee, installerMock, repos, JOUR, HEURE };
