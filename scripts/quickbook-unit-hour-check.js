// LE COMPTOIR VEND LES TABLES ET LES HEURES QU IL A CHOISIES.
//
// Mesure du 2026-08-31, la veille de l ouverture Fun Galaxy Libramont.
//
// Le tunnel public sait vendre une activite « per_unit_hour » (les billards a
// Libramont : 10 EUR la table et par heure en prod ; le mock du gate teste le
// MECANISME a 12 EUR, pas le montant du tenant). Il propose le nombre de tables ET
// la duree, et son programme part avec units et hours.
//
// La reservation rapide du COMPTOIR, elle, n avait aucun de ces deux reglages :
// `visit.others[id]` etait un simple booleen, et la ligne du programme ne
// portait que { activityId, pax }. lib/visit-program.js (l.141-142) retombe
// alors sur ses valeurs par defaut, units=1 et hours=1, sans un mot.
//
// CHIFFRE : trois tables reservees deux heures au comptoir sont facturees
// 12 EUR au lieu de 72. A chaque dossier billard pris a l accueil, tous les
// jours. Le mode « une seule activite » avait le meme trou, en pire : il
// n envoyait ni units, ni hours, ni minutes, ni participants.
//
// Cinq proprietes :
//   A. Une activite per_unit_hour cochee en visite propose SES DEUX reglages.
//   B. Le POST du comptoir porte les units et les hours choisis.
//   C. Le meme reglage existe quand l activite est SEULE, et part aussi.
//   D. Le nombre de tables proposees suit la DOTATION du catalogue, jamais une
//      liste figee : un centre qui declare 6 tables doit pouvoir en vendre 6.
//   E. Non-regression : le fun run garde ses minutes, la plaine ses enfants.
//
// Contre-epreuve par mutation : on retire units/hours de la ligne envoyee, on
// prouve que le gate rougit. Depuis le 2026-11-03 la mutation se sert EN
// MEMOIRE (le serveur du gate rend app-main.js mute) : le disque n est jamais
// ecrit, d autres gates lisent le meme fichier au meme moment.
//
// LES SEANCES (2026-11-03) : la fenetre du comptoir a change d ecran. Le gate
// joue les gestes du comptoir : le nombre de joueurs (#rsHaut [data-pax]), la
// tuile #rsT-billards, qui s ajoute a la visite (chaque toucher ajoute, depuis le
// 2026-11-03) ou remplace le bowling seulement propose ; les reglages vivent sur
// la page de la ligne, ouverte par sa ligne du ticket (#rsL-a-billards :
// [data-opt="units"], [data-opt="hours"]) et « Créer » (#rvCreer) envoie.
//
// Lancement : node scripts/quickbook-unit-hour-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets/app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_QBUNIT_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

// LA MUTATION : la ligne envoyee perd units et hours (le trou d avant).
const MARQUEUR = "if (activite.priceType === 'per_unit_hour') {\n    ligne.units";
const lf = (texte) => texte.split('\r\n').join('\n');
const MUTEE = process.env.PINLANE_QBUNIT_MUTATION === '1';
let mutationServie = false;

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      let corps = content;
      if (MUTEE && path.resolve(filePath) === path.resolve(APP)) {
        const texte = lf(content.toString('utf8'));
        if (texte.includes(MARQUEUR)) {
          corps = Buffer.from(texte.replace(MARQUEUR, MARQUEUR.replace("activite.priceType === 'per_unit_hour'", 'false')), 'utf8');
          mutationServie = true;
        }
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Le catalogue du centre. Les billards declarent SIX tables (dotation) et se
// vendent de 1h a 4h par pas d une heure : c est la donnee du tenant qui doit
// gouverner les choix offerts, pas une liste ecrite dans le code. Les MONTANTS
// de ce mock (12 EUR...) testent le mecanisme, pas les prix reels du tenant
// (billards a 10 EUR en prod, mesure 2026-09-01) : les prix reels vivent en
// base et se verifient contre le meta prod, pas contre un fichier.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: 12, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60, minMinutes: 60, maxMinutes: 240, stepMinutes: 60, units: 6, capacityPerUnit: 4 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', order: 9, defaultMinutes: 15 },
];

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.quick', 'reservations.edit', 'reservations.status', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
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
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        // LA FENETRE SIMULE AVANT DE CREER (dryRun, 2026-10-08) : une
        // simulation n est pas une creation, elle ne se compte pas.
        if (corps.dryRun) return J({ ok: true, dryRun: true, plan: { disponible: true, debut: corps.startTime || '', fin: '', blocs: [], etapes: [], prix: null } });
        window.__QA_POSTS__.push(corps);
        return J({ ok: true, reservation: { id: 4242, date: today, startTime: '14:00', pax: 4, status: 'pending', type: 'visite', lanes: [] } });
      }
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
            day: { date: today, open: true, schedule: { open: 10, close: 22, label: '10h - 22h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, ACTIVITIES });
}

// La ligne « billards » du dernier POST, quel que soit le mode.
function ligneBillards(posts) {
  const dernier = posts[posts.length - 1];
  if (!dernier || !Array.isArray(dernier.program)) return null;
  return dernier.program.find((l) => l && l.activityId === 'billards') || null;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(BASE_URL + '/?v=qbu-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 5, null, { timeout: 15000 });
    if (MUTEE) console.log(mutationServie ? '[mutation servie]' : '[mutation NON servie]');

    const demain = await page.evaluate(() => { const d = new Date(todayStr() + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    // Les gestes du comptoir. « Créer » ne part qu une fois le nombre de
    // joueurs choisi (« Combien de joueurs ? ») : le gate le choisit d abord.
    const ouvrir = async (prefill) => {
      await page.evaluate((p) => window.openQuickBook(p), { date: demain, startTime: '14:00', phone: '0470 12 34 56', ...prefill });
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv #rsLignes .rs-tk-a', { timeout: 8000 });
      await page.click('#rsHaut [data-pax="4"]');
      await page.waitForSelector('#rsHaut [data-pax="4"].is-on', { timeout: 3000 });
    };
    // Un toucher sur la tuile l ajoute au ticket sans quitter l ecran des
    // activites ; sa ligne du ticket ouvre sa page, ou vivent ses reglages.
    const ajouter = async (id) => {
      if (!(await page.locator('#quickBookOverlay .qb-modal.rv.is-q-activites').count())) await page.click('#rsRetour');
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-activites', { timeout: 3000 });
      await page.click(`#rsT-${id}`);
      await page.waitForSelector(`#rsL-a-${id}`, { timeout: 3000 }).catch(() => {});
      await page.click(`#rsL-a-${id}`);
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-ligne', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    };
    const auTicket = () => page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay #rsLignes .rs-tk-a[data-activite]')].map((e) => e.dataset.activite));
    // Les reglages des billards, lus sur la page de leur ligne.
    const reglagesBillards = () => page.evaluate(() => {
      const modale = document.querySelector('#quickBookOverlay .qb-modal.rv');
      const titre = ((document.getElementById('rsQ') || {}).textContent || '').trim();
      const ouverte = Boolean(modale && modale.classList.contains('is-q-ligne') && titre === 'Billards' && document.getElementById('rsL-a-billards'));
      const val = (sel) => [...document.querySelectorAll(`#rsCorps ${sel}`)].map((b) => b.textContent.trim());
      const choisi = (cle) => { const b = document.querySelector(`#rsCorps [data-opt="${cle}"][aria-pressed="true"]`); return b ? b.dataset.val : ''; };
      return { absente: !ouverte, tables: ouverte ? val('[data-opt="units"]') : [], durees: ouverte ? val('[data-opt="hours"]') : [], units: choisi('units'), hours: choisi('hours') };
    });
    // « Créer », comme au comptoir, et ce qui part au serveur.
    const creer = async () => {
      await page.evaluate(() => { window.__QA_POSTS__.length = 0; });
      await page.click('#rvCreer');
      await page.waitForFunction(() => window.__QA_POSTS__.length > 0, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      return page.evaluate(() => window.__QA_POSTS__.map((p) => ({ program: p.program })));
    };

    // --- A. Les deux reglages existent -------------------------------------
    // Une visite : le bowling choisi (l entree « bowling a 14:00 », comme une
    // case du planning), puis la tuile Billards, qui s ajoute, et la page de sa
    // ligne.
    await ouvrir({ type: 'bowling' });
    await ajouter('billards');
    const reglages = await reglagesBillards();
    const visite = await auTicket();
    ok(!reglages.absente && visite.join(' + ') === 'bowling + billards', `la ligne Billards est au ticket, en visite, et sa page s ouvre (${visite.join(' + ') || 'rien'})`);
    ok(reglages.tables.length > 0,
      `les billards proposent un nombre de tables (${reglages.tables.join(' | ') || 'AUCUN reglage'})`);
    ok(reglages.durees.length > 1,
      `et une duree a choisir (${reglages.durees.join(' | ') || 'AUCUNE duree'})`);

    // --- D. La dotation du catalogue gouverne les choix ---------------------
    ok(reglages.tables.length >= 6 && reglages.tables.includes('6'),
      `un centre qui declare 6 tables peut en vendre 6 (proposes : ${reglages.tables.join(' | ') || 'aucun'})`);

    // --- B. Le POST porte le choix du comptoir ------------------------------
    await page.click('#rsCorps [data-opt="units"][data-val="3"]');
    await page.click('#rsCorps [data-opt="hours"][data-val="2"]');
    await page.waitForTimeout(300);
    const choisis = await reglagesBillards();
    ok(choisis.units === '3' && choisis.hours === '2', `prerequis : 3 tables et 2 h sont pressees a l ecran (units ${choisis.units || 'aucun'}, hours ${choisis.hours || 'aucune'})`);
    const enVisite = await creer();
    const ligneVisite = ligneBillards(enVisite);
    ok(!!ligneVisite,
      `le comptoir a bien envoye une ligne billards (${JSON.stringify(enVisite[enVisite.length - 1] || null)})`);
    ok(ligneVisite && Number(ligneVisite.units) === 3,
      `3 tables choisies, 3 tables envoyees (units=${ligneVisite ? ligneVisite.units : 'ABSENT'})`);
    ok(ligneVisite && Number(ligneVisite.hours) === 2,
      `2 heures choisies, 2 heures envoyees (hours=${ligneVisite ? ligneVisite.hours : 'ABSENT'})`);

    // --- C. Le mode « une seule activite » n est pas un trou ----------------
    // La tuile Billards remplace le bowling seulement propose a l ouverture :
    // les billards seuls, et la page de leur ligne.
    await ouvrir({});
    await ajouter('billards');
    await page.waitForTimeout(100);
    const seule = await reglagesBillards();
    const seuleAuTicket = await auTicket();
    ok(!seule.absente && seuleAuTicket.join(' + ') === 'billards', `prerequis : les billards seuls au ticket, leur page ouverte (${seuleAuTicket.join(' + ') || 'rien'})`);
    ok(seule.tables.length > 0 && seule.durees.length > 1,
      `activite seule : les reglages sont la aussi (${seule.tables.length} tables, ${seule.durees.length} durees)`);

    await page.click('#rsCorps [data-opt="units"][data-val="2"]');
    await page.click('#rsCorps [data-opt="hours"][data-val="3"]');
    await page.waitForTimeout(300);
    const enSeule = await creer();
    const ligneSeule = ligneBillards(enSeule);
    ok(ligneSeule && Number(ligneSeule.units) === 2 && Number(ligneSeule.hours) === 3,
      `activite seule : 2 tables x 3h partent bien (${ligneSeule ? `units=${ligneSeule.units} hours=${ligneSeule.hours}` : 'AUCUNE ligne billards'})`);

    // --- E. Non-regression : minutes et participants ------------------------
    // La visite bowling + fun run + plaine ; la plaine descend a 2 enfants par le
    // moins de sa page.
    await ouvrir({ type: 'bowling' });
    await ajouter('fun_run');
    await ajouter('playground');
    for (let i = 0; i < 2; i += 1) {
      await page.click('#rsCorps .rs-pas [aria-label$="un de moins"]');
      await page.waitForTimeout(250);
    }
    const enfants = await page.evaluate(() => ((document.querySelector('#rsCorps .rs-pas > b') || {}).textContent || '').trim());
    ok(enfants === '2', `prerequis : la plaine dit 2 enfants a l ecran (${enfants || 'aucun compteur'})`);
    await creer();
    const autres = await page.evaluate(() => {
      const p = window.__QA_POSTS__[window.__QA_POSTS__.length - 1];
      const prog = (p && p.program) || [];
      return {
        funRun: prog.find((l) => l.activityId === 'fun_run') || null,
        playground: prog.find((l) => l.activityId === 'playground') || null,
      };
    });
    ok(autres.funRun && Number(autres.funRun.minutes) > 0,
      `le fun run garde ses minutes (${autres.funRun ? autres.funRun.minutes : 'AUCUNE ligne'})`);
    ok(autres.playground && Number(autres.playground.participants) === 2,
      `la plaine de jeux garde ses enfants (${autres.playground ? autres.playground.participants : 'AUCUNE ligne'})`);
    ok(!(autres.funRun && autres.funRun.units != null),
      'une activite SANS tables ne recoit pas de cle units parasite');

    ok(errs.length === 0, `zero erreur console (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nquickbook-unit-hour-check: ${failures} defaut(s).`); process.exit(1); }
  console.log('\nquickbook-unit-hour-check: ALL OK (le comptoir vend les tables et les heures qu il a choisies)');
}

if (process.argv.includes('--mutate')) {
  // L ancre doit exister UNE fois : une ancre morte ou ambigue ne prouve rien.
  const occurrences = lf(fs.readFileSync(APP, 'utf8')).split(MARQUEUR).length - 1;
  if (occurrences !== 1) {
    console.error(`mutation impossible : la ligne units/hours apparait ${occurrences} fois dans assets/app-main.js (attendu : 1)`);
    process.exit(1);
  }
  // On remet le trou d avant, servi en memoire au navigateur du gate : la ligne
  // part sans units ni hours.
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, PINLANE_QBUNIT_MUTATION: '1' } });
  console.log(run.stdout || '');
  if (!String(run.stdout || '').includes('[mutation servie]')) {
    console.error('CONTRE-EPREUVE RATEE : la mutation n a pas ete servie au navigateur.');
    process.exit(1);
  }
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans units/hours dans la ligne envoyee.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans units/hours, le comptoir facture 1 table 1 heure et le gate rougit.');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
