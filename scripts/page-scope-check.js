// Gate PERIMETRE DE PAGE : un bloc de la page Planning ne se peint QUE sur la
// page Planning.
//
// Pourquoi ce gate existe. Verbatim Movsar, 2026-08-14, capture a l'appui :
// « cette page qui s'affiche en bas de chaque endroit sur mon SaaS, ca va pas
// du tout ». C'etait la TROISIEME fois en une journee. Les deux correctifs
// precedents etaient JUSTES et pourtant INERTES :
//   1. « La liste du jour ne suit plus le visiteur » (214283b) donne un
//      identifiant a la boite et lui applique la meme decision qu'aux grilles ;
//   2. « Le masquage se deduit, il ne s'accepte plus en argument » (eee10cd)
//      ferme le trou de l'appelant qui oubliait l'argument.
// Les deux posaient bien `.hidden` sur #staffTableBox. Mais `.table-box`
// portait `display: flex` depuis le 2026-08-13 (le panneau borne a 704 px), et
// cette regle BATTAIT `.hidden` dans la cascade : meme specificite (une classe
// chacune), mais pinlane-staff.css est charge apres pinlane.css. La classe
// etait posee, la boite restait peinte. Mesure avant correctif : VISIBLE sur
// 16 des 18 entrees du menu, 1288x704 px.
//
// LA LECON, et c'est elle que ce gate materialise : UN CORRECTIF JAVASCRIPT
// QUI N'EST PAS VERIFIE A L'ECRAN PEUT ETRE EXACT ET NE RIEN CHANGER. Lire le
// code ne suffit pas : `classList.toggle('hidden')` a l'air correct dans les
// deux commits. Seule la MESURE du rectangle rendu tranche.
//
// CE QUE CE GATE PROUVE, EN CLIQUANT LE MENU POUR DE VRAI :
//   1. sur CHAQUE entree hors Planning, les six blocs de la page Planning ont
//      une boite nulle et un display none : rien ne depasse ;
//   2. sur les trois onglets de Planning, ils sont VISIBLES : le gate ne peut
//      pas passer au vert en masquant tout, ce qui serait le defaut symetrique ;
//   3. contre-epreuve par MUTATION : on ressert le CSS sans sa garde
//      `:not(.hidden)` et le gate doit rougir. Sans ca, « 0 defaut » peut
//      vouloir dire « la sonde ne regarde rien ».
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/page-scope-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_PAGE_SCOPE_PORT || 4272);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CSS_REL = 'assets/pinlane-staff.css';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Le serveur peut servir une VERSION MUTEE d'un fichier : c'est ce qui rend la
// contre-epreuve possible sans jamais ecrire dans le depot.
const overrides = new Map();

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    let filePath = path.join(ROOT, rel);
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

let failures = 0;
function ok(cond, label, detail = '') { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) failures += 1; return cond; }

// LES BLOCS QUI APPARTIENNENT A LA PAGE PLANNING, et rien d'autre. Ils sont
// declares ici en toutes lettres : un bloc ajoute a cette page demain devra
// entrer dans cette liste, sinon il repartira en vadrouille sans que personne
// ne le voie.
const BLOCS_PLANNING = {
  'liste du jour': '#staffTableBox',
  'grille bowling': '#planningBox',
  'grille laser': '#laserPlanningBox',
  'bandeau KPI': '#staffView .kpi-grid',
  'onglets de ressource': '#staffView .staff-resource-tabs',
  'en-tete de journee': '#staffView .staff-head',
};

// Les trois entrees de menu QUI SONT la page Planning (Planning > Bowling,
// Laser Game, Toutes). Partout ailleurs, les blocs ci-dessus n'ont rien a faire.
const CLES_PLANNING = new Set(['bowling', 'laser', 'complete']);

const JEU = [
  { id: 80001, status: 'pending', off: false },
  { id: 80002, status: 'arrived', off: false },
  { id: 80003, status: 'paid', off: false },
  { id: 80004, status: 'pending', off: true },
];

async function installMock(page, jeu) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, jeu }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const openWeek = { '0': { open: '10:00', close: '24:00' }, '1': { open: '10:00', close: '24:00' }, '2': { open: '10:00', close: '24:00' }, '3': { open: '10:00', close: '24:00' }, '4': { open: '10:00', close: '24:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } };
    const centerFor = (id) => ({
      id, name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount: 24, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' },
        partyTables: null,
      },
      defaultSchedule: { regular: openWeek, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {}, classification: {}, customActivities: [],
    });
    const build = (date) => jeu.map((row, index) => ({
      id: row.id, name: `Client ${row.id}`, phone: '+3247086' + String(1000 + index),
      email: `qa${index}@x.test`, date, startTime: `${String(11 + (index % 8)).padStart(2, '0')}:00`,
      duration: 1, lanes: row.off ? [] : [1 + (index % 8)], status: row.status, pax: 4, price: 40,
      type: row.off ? 'formule' : 'bowling', formuleId: row.off ? 'f6' : null, label: '', notes: '',
    }));
    const laneStatuses = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: laneStatuses(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [centerFor(u.searchParams.get('centerId') || 'libramont')], activities: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, jeu });
}

async function ouvrirConsole(page) {
  await page.goto(`${BASE_URL}/?v=scope-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.evaluate(() => { if (typeof hasSavedAuth === 'function') hasSavedAuth(); setView('staff'); });
  await page.waitForTimeout(1200);
  // Les groupes replies cachent leurs sous-entrees : on deplie tout pour que
  // chaque entree du menu soit reellement cliquable.
  await page.evaluate(() => {
    document.querySelectorAll('[data-fgx-menu-toggle]').forEach((el) => {
      if (el.getAttribute('aria-expanded') !== 'true') el.click();
    });
  });
  await page.waitForTimeout(400);
}

// Parcourt le menu comme un humain et rend, pour chaque entree, l'etat mesure
// des six blocs.
async function balayerLeMenu(page) {
  const entrees = await page.evaluate(() => [...document.querySelectorAll('[data-fgx-menu-key]')].map((el) => ({
    cle: el.getAttribute('data-fgx-menu-key'),
    resource: el.getAttribute('data-ops-resource') || '',
    libelle: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28),
  })));
  const releve = [];
  for (const entree of entrees) {
    const clique = await page.evaluate(({ cle, resource }) => {
      const el = [...document.querySelectorAll('[data-fgx-menu-key]')]
        .find((n) => n.getAttribute('data-fgx-menu-key') === cle && (n.getAttribute('data-ops-resource') || '') === resource);
      if (!el) return false;
      el.click();
      return true;
    }, entree);
    if (!clique) continue;
    await page.waitForTimeout(650);
    const blocs = await page.evaluate((selecteurs) => {
      const out = {};
      for (const [nom, sel] of Object.entries(selecteurs)) {
        const el = document.querySelector(sel);
        if (!el) { out[nom] = { visible: false, boite: '0x0', display: 'absent' }; continue; }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out[nom] = {
          visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
          boite: `${Math.round(r.width)}x${Math.round(r.height)}`,
          display: cs.display,
        };
      }
      return out;
    }, BLOCS_PLANNING);
    releve.push({ ...entree, blocs });
  }
  return releve;
}

// Le CSS MUTE : on retire la garde `:not(.hidden)` du panneau de la liste, ce
// qui restaure exactement le defaut du 2026-08-14.
function cssSansLaGarde() {
  const source = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
  const mute = source.replace('.table-box:not(.hidden) {', '.table-box {');
  if (mute === source) {
    console.log('FAIL  contre-epreuve impossible : la garde `.table-box:not(.hidden)` est introuvable dans le CSS');
    failures += 1;
    return null;
  }
  return mute;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const erreursJs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => erreursJs.push(e.message));
    await installMock(page, JEU);
    await ouvrirConsole(page);
    const releve = await balayerLeMenu(page);

    console.log(`\n[1] PERIMETRE : ${releve.length} entrees de menu parcourues au clic\n`);
    ok(releve.length >= 15, 'le menu expose au moins 15 entrees cliquables', `${releve.length} entrees`);

    const horsPlanning = releve.filter((r) => !CLES_PLANNING.has(r.cle));
    const surPlanning = releve.filter((r) => CLES_PLANNING.has(r.cle));
    ok(surPlanning.length === 3, 'les trois onglets de Planning sont atteints', surPlanning.map((r) => r.cle).join(', '));

    // 1. Hors Planning : aucun bloc ne depasse.
    for (const page1 of horsPlanning) {
      const fautifs = Object.entries(page1.blocs).filter(([, v]) => v.visible);
      ok(
        fautifs.length === 0,
        `« ${page1.libelle} » (${page1.cle}) ne peint aucun bloc de la page Planning`,
        fautifs.length ? fautifs.map(([nom, v]) => `${nom} ${v.boite} display:${v.display}`).join(' | ') : ''
      );
    }

    // 2. Sur Planning : ils sont bien la. Un gate qui passe au vert en masquant
    //    tout serait le defaut symetrique, et il ne se verrait pas.
    for (const page2 of surPlanning) {
      ok(page2.blocs['liste du jour'].visible, `« ${page2.libelle} » affiche bien la liste du jour`, page2.blocs['liste du jour'].boite);
      ok(page2.blocs['bandeau KPI'].visible, `« ${page2.libelle} » affiche bien le bandeau KPI`, page2.blocs['bandeau KPI'].boite);
      ok(page2.blocs['onglets de ressource'].visible, `« ${page2.libelle} » affiche bien les onglets de ressource`, page2.blocs['onglets de ressource'].boite);
    }
    const bowling = surPlanning.find((r) => r.cle === 'bowling');
    const laser = surPlanning.find((r) => r.cle === 'laser');
    if (bowling) ok(bowling.blocs['grille bowling'].visible && !bowling.blocs['grille laser'].visible, 'onglet Bowling : la grille bowling seule', `${bowling.blocs['grille bowling'].boite} / laser ${bowling.blocs['grille laser'].display}`);
    if (laser) ok(laser.blocs['grille laser'].visible && !laser.blocs['grille bowling'].visible, 'onglet Laser Game : la grille laser seule', `${laser.blocs['grille laser'].boite} / bowling ${laser.blocs['grille bowling'].display}`);

    ok(erreursJs.length === 0, 'aucune erreur JavaScript pendant le balayage', erreursJs.join(' | '));

    // 3. CONTRE-EPREUVE : sans la garde CSS, le gate DOIT rougir.
    console.log('\n[2] CONTRE-EPREUVE PAR MUTATION : le CSS resservi sans sa garde `:not(.hidden)`\n');
    const mute = cssSansLaGarde();
    if (mute) {
      overrides.set(CSS_REL, mute);
      const pageMutee = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await installMock(pageMutee, JEU);
      await ouvrirConsole(pageMutee);
      const releveMute = await balayerLeMenu(pageMutee);
      overrides.delete(CSS_REL);
      const fuites = releveMute
        .filter((r) => !CLES_PLANNING.has(r.cle))
        .filter((r) => Object.values(r.blocs).some((v) => v.visible));
      ok(
        fuites.length > 0,
        'la sonde REGARDE vraiment : sans la garde CSS, la liste du jour fuit hors Planning',
        `${fuites.length} pages fautives, ex. ${fuites.slice(0, 4).map((f) => f.cle).join(', ')}`
      );
      await pageMutee.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures ? `${failures} verification(s) rouge(s)` : 'Tout est vert'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
