// LA CONSOLE SUR UNE JOURNEE FIXE (2026-10-20, planning global v3).
//
// Six journees de Fun Galaxy Libramont, au format exact de GET /api/staff-state
// (scripts/fixtures/planning-v3/) :
//   calme   mardi 12/01/2027, 4 groupes      (dossiers DEMO de la prod)
//   normal  mercredi 13/01/2027, 12 groupes  (dossiers DEMO de la prod)
//   pic     samedi 16/01/2027, 46 groupes, 416 joueurs (dossiers DEMO de la prod)
//   vide    dimanche 17/01/2027, ouvert de 10:00 a 22:00, aucune reservation
//   ferme   lundi 18/01/2027, le centre est ferme
//   pire    le samedi pousse a bout : noms tres longs et tres courts, deux
//           activites inconnues, des absents, a valider et a cloturer, huit
//           pistes d un groupe puis huit groupes d une piste, 30 armes au
//           laser, une partie et une piste apres minuit, un programme de neuf
//           activites.
// Le centre (horaires, activites cochees, catalogue public) est celui de la
// prod : centre-libramont.json. Les trois premieres viennent de
// scripts/planning-v3-export.js ; les trois autres de `deriver` ici.
//
// LE MEME CHEMIN POUR UN HUMAIN ET POUR UN GATE : le serveur sert le depot et
// glisse dans index.html, avant tout autre script, l API simulee de la
// fixture demandee (aucun reseau, aucune base) ; la console demarre seule sur
// le planning global du jour.
//
//   node scripts/planning-v3-fixtures.js servir [--port 5197]
//     puis http://127.0.0.1:5197/?fixture=pic&heure=15:10
//     options d URL : fixture=calme|normal|pic|vide|ferme|pire, heure=HH:MM
//     (15:10 par defaut, figee ; 24:20 = 00:20 la nuit suivante, la console
//     reste sur la veille), tourne=1 (l heure avance), theme=dark|light,
//     plein=1 (Agrandir)
//   node scripts/planning-v3-fixtures.js capturer --sortie <dossier>
//     [--fixtures pic,pire] [--appareils grand,ordinateur,tablette,telephone]
//     [--modes normal,plein] [--themes dark] [--heure 15:10] [--extras | --extras-seuls]
//   node scripts/planning-v3-fixtures.js deriver   (reecrit vide, ferme, pire)
// Dans un gate : const { servir, monter } = require('./planning-v3-fixtures');
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOSSIER = path.join(__dirname, 'fixtures', 'planning-v3');
const PORT = Number(process.env.PINLANE_PLANNING_V3_PORT || 5197);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FIXTURES = ['calme', 'normal', 'pic', 'vide', 'ferme', 'pire'];
// Les ecrans de Movsar (ceux du gate planning-global-check.js).
const APPAREILS = {
  grand: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'fr-BE' },
  ordinateur: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-BE' },
  portable: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'fr-BE' },
  tablette: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'fr-BE' },
  'tablette-portrait': { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'fr-BE' },
  telephone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' },
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };

function lireJson(fichier) { return JSON.parse(fs.readFileSync(path.join(DOSSIER, fichier), 'utf8')); }
function lireFixture(nom) {
  if (!FIXTURES.includes(nom)) throw new Error(`fixture inconnue : ${nom} (${FIXTURES.join(', ')})`);
  return lireJson(`jour-${nom}.json`);
}
function lireCentre() { return lireJson('centre-libramont.json'); }

// ---------------------------------------------------------------------------
// L API SIMULEE, DANS LA PAGE. Elle s execute avant tout script de la console
// (la session, le theme, l heure, fetch) puis demarre la console sur le
// planning global du jour de la fixture. Un PATCH de statut s ecrit en memoire.
// ---------------------------------------------------------------------------
function mockNavigateur(cfg) {
  var params = new URLSearchParams(location.search);
  var fixture = cfg.fixture;
  var JOUR = fixture.staffState.date;
  var theme = params.get('theme') === 'light' ? 'light' : 'dark';
  var plein = params.get('plein') === '1';
  var p2 = function (n) { return String(n).padStart(2, '0'); };

  // L HEURE (mode humain) : celle de l URL, sinon celle de la fixture, figee
  // (tourne=1 la laisse avancer). Un gate la pose lui-meme (page.clock) et
  // passe horloge=externe.
  var heure = params.get('heure') || fixture.heure || '15:10';
  if (params.get('horloge') !== 'externe') {
    var hm = /^(\d{1,2}):(\d{2})$/.exec(heure);
    if (hm) {
      var j = JOUR.split('-').map(Number);
      var cible = new Date(j[0], j[1] - 1, j[2] + Math.floor(Number(hm[1]) / 24), Number(hm[1]) % 24, Number(hm[2]), 0, 0).getTime();
      var Natif = Date;
      var t0 = Natif.now();
      var figee = params.get('tourne') !== '1';
      var maintenant = function () { return figee ? cible : cible + (Natif.now() - t0); };
      var Fixe = function Date() {
        if (!(this instanceof Fixe)) return new Natif(maintenant()).toString();
        var a = Array.prototype.slice.call(arguments);
        return a.length ? new (Function.prototype.bind.apply(Natif, [null].concat(a)))() : new Natif(maintenant());
      };
      Fixe.prototype = Natif.prototype;
      Fixe.now = maintenant;
      Fixe.parse = Natif.parse;
      Fixe.UTC = Natif.UTC;
      window.Date = Fixe;
    }
  }

  var perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'payments.markPaid', 'clients.view', 'settings.manage', 'direction.view'];
  var expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
  var session = { token: 'fixture', cookieBacked: false, centerId: 'libramont', expiresAt: expiresAt, member: { id: 'fixture', name: 'Accueil', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
  try {
    localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
    localStorage.setItem('pinlane-theme', theme);
  } catch (e) { /* stockage bloque : la console redemandera l acces */ }

  var jours = {};
  jours[JOUR] = fixture.staffState.reservations.map(function (r) { return Object.assign({}, r); });
  window.__FIXTURE__ = { nom: fixture.fixture, jour: JOUR, jours: jours, patchs: [] };
  var dateLocale = function () { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  var J = function (corps, status) { return new Response(JSON.stringify(corps), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8' } }); };
  var etatDu = function (d) {
    var base = fixture.staffState;
    var res = jours[d] || [];
    return Object.assign({}, base, { date: d, reservations: res, holds: [], revision: 'fixture:' + fixture.fixture + ':' + d + ':' + window.__FIXTURE__.patchs.length });
  };
  var natif = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    init = init || {};
    var u = new URL(typeof input === 'string' ? input : input.url, location.origin);
    var m = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'fixture', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), permissions: perms, locked: true }], members: [{ id: 'fixture', name: 'Accueil', roleId: 'direction' }] } });
    if (u.pathname === '/api/staff-customer-notes' && m === 'GET') {
      var lot = u.searchParams.get('reservationIds');
      var s = function (id) { return { eligible: true, clientKey: 'fixture:' + id, note: null }; };
      if (lot !== null) { var parId = {}; lot.split(',').filter(Boolean).forEach(function (id) { parId[String(Number(id))] = s(Number(id)); }); return J({ ok: true, notesByReservationId: parId }); }
      return J(Object.assign({ ok: true }, s(Number(u.searchParams.get('reservationId')))));
    }
    if (u.pathname === '/api/staff-state') {
      var d = u.searchParams.get('date') || JOUR;
      if (Number(u.searchParams.get('days')) > 0) return J({ ok: true, centerId: 'libramont', endDate: d, days: [] });
      return J(etatDu(d));
    }
    if (u.pathname === '/api/public-booking-meta') return J(Object.assign({}, cfg.meta, { today: dateLocale() }));
    if (u.pathname === '/api/ops') {
      if (u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: [cfg.centre], activities: [] });
      return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
    }
    if (u.pathname === '/api/admin-range') { var d2 = u.searchParams.get('startDate') || JOUR; return J({ ok: true, reservations: jours[d2] || [], emails: [], agentEvents: [], centerId: 'libramont' }); }
    if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
      var corps = JSON.parse(init.body || '{}');
      window.__FIXTURE__.patchs.push(corps);
      var liste = jours[JOUR];
      var i = liste.findIndex(function (x) { return String(x.id) === String(corps.id); });
      if (i < 0) return J({ ok: false, error: 'introuvable' }, 404);
      if (corps.status) { liste[i] = Object.assign({}, liste[i], { status: corps.status, updatedAt: new Date().toISOString() }); return J({ ok: true, reservation: liste[i] }); }
      return J({ ok: false, error: 'non gere par la fixture' }, 400);
    }
    // Rien d autre ne part : une ecriture inconnue ne touche jamais un serveur.
    if (u.pathname.indexOf('/api/') === 0) return J({ ok: false, error: 'hors fixture' }, 404);
    return natif(input, init);
  };

  // LE DEMARRAGE : la console, le planning global, le jour de la fixture
  // (la sequence du gate planning-global-check.js).
  var attendre = function (cond, ms) {
    return new Promise(function (ok, ko) {
      var t = Date.now();
      (function tour() { try { if (cond()) return ok(); } catch (e) { /* pas encore */ } if (Date.now() - t > ms) return ko(new Error('console pas prete')); setTimeout(tour, 30); })();
    });
  };
  window.__fixturePrete = false;
  window.addEventListener('load', async function () {
    try {
      await attendre(function () { return typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function'; }, 60000);
      /* global state, ensureStaffConsolesLoaded, setView, staffCenterConfigCache, loadStaffCenterConfig, renderStaff */
      await ensureStaffConsolesLoaded();
      state.currentDate = JOUR; state.adminCenterId = 'libramont'; state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; state.staffTheme = theme;
      state.searchTerm = ''; state.staffStatusFilter = 'all'; state.staffPlanningExpanded = false; state.staffLaserPlanningExpanded = false; state.staffTableExpanded = false; state.staffGlobalExpanded = false;
      state.reservations = jours[JOUR].map(function (x) { return Object.assign({}, x); });
      document.documentElement.setAttribute('data-theme', theme);
      setView('staff');
      while (staffCenterConfigCache.loading) await new Promise(function (r) { setTimeout(r, 25); });
      await loadStaffCenterConfig(true);
      renderStaff();
      window.scrollTo(0, 0);
      if (plein) { var b = document.getElementById('globalPlanningToggle'); if (b && !document.getElementById('globalPlanningBox').classList.contains('expanded')) b.click(); }
      window.__fixturePrete = true;
    } catch (e) {
      window.__fixturePrete = 'echec : ' + e.message;
    }
  });
}

function scriptInjecte(nom) {
  const fx = lireFixture(nom);
  const centre = lireCentre();
  const cfg = { fixture: fx, centre: centre.center, meta: centre.publicBookingMeta };
  // (</script> ne peut pas sortir du JSON : les < sont echappes)
  return `<script>(${mockNavigateur.toString()})(${JSON.stringify(cfg).replace(/</g, '\\u003c')});</script>`;
}

// ---------------------------------------------------------------------------
// LE SERVEUR : les fichiers du depot ; index.html recoit l API simulee de la
// fixture de son URL (?fixture=pic par defaut).
// ---------------------------------------------------------------------------
function servir({ port = PORT } = {}) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let f = path.join(ROOT, decodeURIComponent(url.pathname));
      const accueil = url.pathname === '/' || url.pathname === '/index.html';
      if (accueil) f = path.join(ROOT, 'index.html');
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      let corps = fs.readFileSync(f);
      if (accueil) {
        const nom = url.searchParams.get('fixture') || 'pic';
        corps = Buffer.from(corps.toString('utf8').replace(/<head>/i, () => '<head>\n' + scriptInjecte(nom)), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(e.message));
    }
  });
  return new Promise((ok, ko) => { server.once('error', ko); server.listen(port, '127.0.0.1', () => ok(server)); });
}

// L instant d une heure de la fixture a Bruxelles (24:20 = 00:20 le lendemain).
function instant(jour, heure) {
  const [h, mi] = String(heure).split(':').map(Number);
  const [a, mo, j] = jour.split('-').map(Number);
  const utc = Date.UTC(a, mo - 1, j + Math.floor(h / 24), h % 24, mi);
  const decalage = (t) => {
    const nom = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Brussels', timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName').value;
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(nom);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  };
  return new Date(utc - decalage(utc) * 60000);
}

async function repos(page, ms = 350) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity) && !document.querySelector('[data-pl-anim]'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
}

// LA CONSOLE MONTEE SUR UNE FIXTURE, l heure figee par Playwright.
async function monter(browser, { fixture = 'pic', appareil = 'ordinateur', theme = 'dark', plein = false, heure = '', mouvementReduit = false, port = PORT } = {}) {
  const fx = lireFixture(fixture);
  const ctx = await browser.newContext({ ...APPAREILS[appareil], serviceWorkers: 'block', timezoneId: 'Europe/Brussels', colorScheme: theme === 'light' ? 'light' : 'dark', reducedMotion: mouvementReduit ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.clock.setFixedTime(instant(fx.staffState.date, heure || fx.heure || '15:10'));
  await page.goto(`http://127.0.0.1:${port}/?fixture=${fixture}&theme=${theme}&horloge=externe${plein ? '&plein=1' : ''}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__fixturePrete !== false, null, { timeout: 60000 });
  const pret = await page.evaluate(() => window.__fixturePrete);
  if (pret !== true) throw new Error(`${fixture} ${appareil} : ${pret}`);
  await repos(page, 400);
  return { ctx, page, erreurs };
}

// ---------------------------------------------------------------------------
// LES CAPTURES : chaque fixture, chaque ecran, la vue normale et le plein
// ecran. Vue normale : le haut de la page (au telephone, la boite du planning
// remontee en haut, comme le gate). Plein ecran : l ecran entier.
// ---------------------------------------------------------------------------
async function capturer({ sortie, fixtures = FIXTURES, appareils = ['grand', 'ordinateur', 'tablette', 'telephone'], modes = ['normal', 'plein'], themes = ['dark'], heure = '', extras = false, port = PORT } = {}) {
  const { chromium } = require('playwright-core');
  fs.mkdirSync(sortie, { recursive: true });
  const serveur = await servir({ port });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const faites = [];
  const photo = async (page, nom) => { const f = path.join(sortie, nom + '.png'); await page.screenshot({ path: f }); faites.push(f); };
  try {
    for (const fixture of extras === 'seuls' ? [] : fixtures) {
      for (const appareil of appareils) {
        for (const theme of themes) {
          for (const mode of modes) {
            const { ctx, page, erreurs } = await monter(browser, { fixture, appareil, theme, plein: mode === 'plein', heure, port });
            try {
              if (mode === 'normal' && APPAREILS[appareil].viewport.width < 768) {
                await page.evaluate(() => { const b = document.getElementById('globalPlanningBox'); if (b) b.scrollIntoView({ block: 'start' }); });
                await repos(page, 200);
              }
              await photo(page, `${fixture}-${appareil}-${mode}${themes.length > 1 ? '-' + theme : ''}`);
              if (erreurs.length) console.log(`  ${fixture} ${appareil} ${mode} : ${erreurs.length} erreur(s) JS, ${erreurs[0]}`);
            } finally { await ctx.close(); }
          }
        }
      }
    }
    if (extras) {
      // Le panneau d un groupe ouvert (le defaut « toute la visite » qui
      // deborde), le pic en clair, la nuit apres minuit, le mouvement reduit.
      // (2026-10-20, code de 3981945 : le clic qui ouvre le panneau tient la
      // page 9 s au pic et 16 s au pire cas, machine chargee ; le temps est
      // ecrit a chaque capture)
      const panneau = async (fixture, nom, cle) => {
        const { ctx, page } = await monter(browser, { fixture, appareil: 'ordinateur', port });
        try {
          const carte = page.locator('#globalPlanningBox .gh-c', { hasText: nom }).first();
          const t = Date.now();
          await carte.click({ timeout: 90000 });
          await page.waitForSelector('#globalPlanningBox .gh-panneau:not([hidden])', { timeout: 90000 });
          console.log(`  ${fixture} : le panneau de « ${nom} » a mis ${Date.now() - t} ms`);
          await repos(page, 400);
          await photo(page, `${fixture}-ordinateur-panneau-${cle}`);
        } finally { await ctx.close(); }
      };
      await panneau('pic', 'Anniversaire Noah', 'noah');
      await panneau('pic', 'Famille Renard', 'renard-plaine');
      await panneau('pire', 'Collègues de bureau', 'neuf-activites');
      for (const [fixture, appareil, theme, h, mr, nom] of [
        ['pic', 'ordinateur', 'light', '', false, 'pic-ordinateur-normal-clair'],
        ['pire', 'ordinateur', 'dark', '24:20', false, 'pire-ordinateur-normal-0020'],
        ['pire', 'grand', 'dark', '', true, 'pire-grand-normal-mouvement-reduit'],
        ['pire', 'tablette-portrait', 'dark', '', false, 'pire-tablette-portrait-normal'],
        ['pire', 'portable', 'dark', '', false, 'pire-portable-normal'],
      ]) {
        const { ctx, page } = await monter(browser, { fixture, appareil, theme, heure: h, mouvementReduit: mr, port });
        try { await photo(page, nom); } finally { await ctx.close(); }
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  return faites;
}

// ---------------------------------------------------------------------------
// LES JOURS DERIVES : vide et ferme (le centre, sans dossier), et le pire cas
// tire du samedi. Deterministe : la meme commande rend les memes fichiers.
// ---------------------------------------------------------------------------
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
// (sans modulo : 25:00 est 01:00 la nuit suivante, l ecriture du moteur)
const enHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const NOTE_DEMO = '[DEMO-JOURS-2027-01] Dossier fictif de démonstration : aucun contact, aucun message.';

function blocBowling(debut, minutes, pistes, joueurs, rang = 1) {
  const s = enMin(debut);
  return { end: s + minutes, type: 'activity', label: 'Bowling', lanes: pistes.slice(), start: s, endTime: enHeure(s + minutes), players: joueurs, critical: true, startTime: debut, activityId: 'bowling', countIndex: rang, resourceType: 'bowling_lane', requiredLanes: pistes.length, durationMinutes: minutes, emergencyWarning: '' };
}
function blocLaser(debut, joueurs, rang, avant = 0) {
  const s = enMin(debut);
  return { end: s + 25, type: 'activity', label: 'Laser Game', lanes: [], start: s, endTime: enHeure(s + 25), players: joueurs, critical: true, startTime: debut, activityId: 'laser_game', countIndex: rang, weaponNeed: joueurs, groupPlayers: joueurs, playersTotal: avant + joueurs, resourceType: 'laser_arena', playersBefore: avant, sharedSession: avant > 0, groupWaveCount: 1, groupWaveIndex: 1, durationMinutes: 25, manualLaserPass: rang > 1, mayShareSession: true, remainingWeapons: Math.max(0, 30 - avant - joueurs) };
}
// Un dossier neuf sur le modele d un dossier DEMO du samedi.
function dossier(modele, { id, name, pax, status = 'pending', validationStatus = 'confirmed', type, blocs, items = null, notes = NOTE_DEMO, price, absentAt = null, extras = [], occasion = '' }) {
  const r = JSON.parse(JSON.stringify(modele));
  const debut = Math.min(...blocs.map((b) => b.start));
  const fin = Math.max(...blocs.map((b) => b.end));
  const pistes = [...new Set(blocs.filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes))].sort((a, b) => a - b);
  const bowling = blocs.filter((b) => b.resourceType === 'bowling_lane');
  Object.assign(r, {
    id, name, pax, status, validationStatus, type, occasion, extras, notes, absentAt,
    phone: '', email: '', formuleId: '', label: type === 'bowling' ? 'Bowling' : type === 'laser' ? 'Laser Game' : 'Visite',
    startTime: enHeure(debut), duration: bowling.length ? (bowling[0].end - bowling[0].start) / 60 : 0.5, totalDuration: (fin - debut) / 60,
    lanes: pistes, price, basePrice: price, amountPaid: status === 'paid' ? price : null, paidAt: status === 'paid' ? '2027-01-16T09:00:00.000Z' : null,
    program: items ? { items, price, priceComplete: false } : null, activityProgress: {}, clientKey: `demo:${id}`, acquisition: null,
  });
  const plan = r.opsPlan || {};
  delete plan.laserPassPlan;
  delete plan.laserManual;
  r.opsPlan = Object.assign(plan, {
    startTime: enHeure(debut), endTime: enHeure(fin + 5), arrivalTime: enHeure(debut - 10), arrivalMinutes: 10, bufferMinutes: 5, totalMinutes: fin - debut,
    assignedLanes: pistes, resourceBlocks: blocs, timeline: blocs.map((b) => ({ ...b })), conflicts: [],
  });
  return r;
}
function libre(activityId, name, minutes, extra = {}) { return { name, minutes, planned: false, sessions: 1, activityId, participants: extra.participants || undefined, ...extra }; }

function deriver() {
  const pic = lireFixture('pic');
  const vides = [
    { cle: 'vide', date: '2027-01-17', libelle: 'dimanche 17/01/2027, ouvert de 10:00 a 22:00, aucune reservation' },
    { cle: 'ferme', date: '2027-01-18', libelle: 'lundi 18/01/2027, le centre est ferme' },
  ];
  for (const v of vides) {
    const etat = { ...pic.staffState, date: v.date, reservations: [], holds: [], revision: `fixture:planning-v3:${v.cle}:${v.date}`, syncedAt: `${v.date}T08:00:00.000Z` };
    ecrire(`jour-${v.cle}.json`, { fixture: v.cle, libelle: v.libelle, heure: '15:10', source: 'derive de jour-pic.json (meme centre, aucun dossier) par scripts/planning-v3-fixtures.js deriver', staffState: etat });
  }

  const res = JSON.parse(JSON.stringify(pic.staffState.reservations));
  const par = (id) => { const r = res.find((x) => x.id === id); if (!r) throw new Error(`dossier ${id} absent du samedi`); return r; };
  const poserBowling = (r, debut, minutes, pistes) => {
    const b = blocBowling(debut, minutes, pistes, r.pax);
    r.startTime = debut; r.lanes = pistes.slice(); r.duration = minutes / 60; r.totalDuration = minutes / 60;
    r.opsPlan.startTime = debut; r.opsPlan.endTime = enHeure(b.end + 5); r.opsPlan.arrivalTime = enHeure(b.start - 10); r.opsPlan.assignedLanes = pistes.slice();
    r.opsPlan.resourceBlocks = [b]; r.opsPlan.timeline = [{ ...b }];
  };
  // LES NOMS : tres longs, tres courts.
  par(1609).name = 'DÉMO · Anniversaire de Marie-Charlotte Vanderstraeten-Delacroix et de ses cousins de Neufchâteau (10 ans)';
  par(1616).name = 'DÉMO · Royal Football Club Libramont-Chevigny U12 et leurs entraîneurs';
  par(1601).name = 'DÉMO · Anniversaire Gwendolyne-Maëlle (12 ans)';
  par(1630).name = 'DÉMO · Enterrement de vie de garçon de Romain-Alexandre et ses témoins';
  par(1627).name = 'DÉMO · Séminaire annuel Ardennes Logistique & Transports Internationaux SA';
  par(1617).name = 'Bo';
  par(1621).name = 'Wu';
  // DEUX ACTIVITES INCONNUES DU CATALOGUE (une colonne chacune, apres le billard).
  const li = par(1614);
  li.name = 'Li';
  li.program.items.push(libre('escape_room', 'Escape room « Le manoir hanté »', 60, { participants: li.pax }), libre('realite_virtuelle_multijoueur', 'Réalité virtuelle multijoueur', 30, { participants: li.pax }));
  // LES ETATS : un absent, un a cloturer (arrive, fini, pas paye), des a valider.
  par(1613).absentAt = '2027-01-16T11:50:00.000Z';
  poserBowling(par(1613), '11:00', 60, [3]);
  const dubois = par(1610);
  dubois.status = 'arrived';
  poserBowling(dubois, '11:00', 60, [2]);
  par(1622).validationStatus = 'staff_review';
  par(1636).validationStatus = 'staff_review';
  // UN PROGRAMME DE NEUF ACTIVITES (le panneau, la ligne « toute la visite »).
  const bureau = par(1622);
  bureau.program.items.push(
    libre('arcade_time', 'Arcades', 30, { participants: bureau.pax }), libre('billards', 'Billard', 60, { participants: bureau.pax, units: 2, hours: 1 }),
    libre('duckpin_bowling', 'Duckpin Bowling', 60, { participants: bureau.pax, units: 2, duration: 1 }), libre('playground', 'Playground', 60, { participants: bureau.pax }),
    libre('fun_run', 'Fun Run by PIXEL', 30, { participants: bureau.pax }), libre('escape_room', 'Escape room « Le manoir hanté »', 60, { participants: bureau.pax }),
  );
  bureau.notes = NOTE_DEMO + '\nBoissons à table au bar après le laser, facture au nom de la société, deux végétariens.';
  bureau.extras = [{ id: 'u1', name: 'Cruche Bière', price: 18 }, { id: 'u1', name: 'Cruche Bière', price: 18 }, { id: 'u4', name: 'Tapas', price: 15 }];

  const modeleBowling = par(1610);
  const modeleLaser = par(1612);
  const neufs = [];
  // HUIT PISTES POUR UN GROUPE, a 10:00.
  neufs.push(dossier(modeleBowling, { id: 9001, name: 'DÉMO · Fédération des clubs de bowling amateurs de la province de Luxembourg', pax: 40, status: 'paid', type: 'bowling', blocs: [blocBowling('10:00', 60, [1, 2, 3, 4, 5, 6, 7, 8], 40)], price: 312, notes: NOTE_DEMO + '\nGâteau au frigo, bougies 4 et 0, deux tables accolées près du bar.', occasion: 'entreprise' }));
  // HUIT GROUPES D UNE PISTE, de 12:00 a 13:00.
  const huit = [
    ['Al', 'paid'], ['DÉMO · Famille Vandenberghe-Lemaire', 'paid'], ['DÉMO · Amis de Jean-Christophe', 'arrived'], ['Ky', 'paid'],
    ['DÉMO · Cousins de Bertrix', 'pending'], ['DÉMO · Anniversaire Maximilien-Alexandre (14 ans)', 'paid'], ['DÉMO · Famille Ö', 'arrived'], ['DÉMO · Collègues du CPAS de Libramont-Chevigny', 'pending'],
  ];
  huit.forEach(([nom, statut], i) => {
    const pax = 3 + (i % 4);
    neufs.push(dossier(modeleBowling, { id: 9011 + i, name: nom, pax, status: statut, type: 'bowling', blocs: [blocBowling('12:00', 60, [i + 1], pax)], price: 39, occasion: i === 5 ? 'anniversaire' : '' }));
  });
  // 30 ARMES POUR UN SEUL GROUPE, a 12:30.
  neufs.push(dossier(modeleLaser, { id: 9021, name: 'DÉMO · Tournoi inter-écoles de la commune', pax: 30, status: 'arrived', type: 'laser', blocs: [blocLaser('12:30', 30, 1)], price: 300, occasion: 'ecole' }));
  // APRES MINUIT : deux pistes jusqu a 01:00, deux parties a 30 armes jusqu a 00:25.
  neufs.push(dossier(modeleBowling, { id: 9031, name: 'DÉMO · Nocturne des étudiants', pax: 14, status: 'pending', type: 'bowling', blocs: [blocBowling('23:30', 90, [7, 8], 14)], price: 117 }));
  neufs.push(dossier(modeleLaser, { id: 9032, name: 'DÉMO · Laser de minuit', pax: 30, status: 'pending', validationStatus: 'staff_review', type: 'laser', blocs: [blocLaser('23:30', 30, 1), blocLaser('24:00', 30, 2)], price: 600, extras: [{ id: 'u3', name: 'Pack Jetons', price: 10 }] }));
  const tous = res.concat(neufs).sort((a, b) => enMin(a.startTime) - enMin(b.startTime) || a.id - b.id);

  // Les ressources du pire cas : aucune piste prise deux fois au meme moment,
  // jamais plus de 30 armes dans une partie (sinon la fixture ment).
  const occupes = [];
  for (const r of tous) for (const b of (r.opsPlan && r.opsPlan.resourceBlocks) || []) {
    if (b.resourceType === 'bowling_lane') for (const p of b.lanes || []) occupes.push({ p, s: b.start, e: b.end, id: r.id });
  }
  for (let i = 0; i < occupes.length; i += 1) for (let j = i + 1; j < occupes.length; j += 1) {
    const a = occupes[i], b = occupes[j];
    if (a.p === b.p && a.id !== b.id && a.s < b.e && b.s < a.e) throw new Error(`pire : piste ${a.p} prise deux fois (${a.id}, ${b.id})`);
  }
  const armes = new Map();
  for (const r of tous) for (const b of (r.opsPlan && r.opsPlan.resourceBlocks) || []) if (b.resourceType === 'laser_arena') armes.set(b.start, (armes.get(b.start) || 0) + Number(b.players || 0));
  for (const [s, n] of armes) if (n > 30) throw new Error(`pire : ${n} armes a ${enHeure(s)}`);

  const etat = { ...pic.staffState, reservations: tous, revision: 'fixture:planning-v3:pire:2027-01-16' };
  ecrire('jour-pire.json', { fixture: 'pire', libelle: 'samedi 16/01/2027 pousse a bout (derive du pic)', heure: '15:10', source: 'derive de jour-pic.json par scripts/planning-v3-fixtures.js deriver', staffState: etat });
  return { pire: tous.length, armesMax: Math.max(...armes.values()) };
}
function ecrire(nom, objet) {
  // (en CRLF, comme le reste du depot)
  fs.writeFileSync(path.join(DOSSIER, nom), JSON.stringify(objet, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  console.log('ecrit', path.relative(ROOT, path.join(DOSSIER, nom)));
}

// ---------------------------------------------------------------------------
function option(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  if (i < 0) return defaut;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const liste = (v, defaut) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : defaut);

async function main() {
  const commande = process.argv[2];
  if (commande === 'deriver') { console.log(deriver()); return; }
  if (commande === 'servir') {
    const port = Number(option('port', PORT));
    await servir({ port });
    console.log(`console sur fixture : http://127.0.0.1:${port}/?fixture=pic&heure=15:10`);
    console.log(`fixtures : ${FIXTURES.join(', ')} ; options : heure=HH:MM (figee, 24:20 apres minuit), tourne=1, theme=light, plein=1`);
    return;
  }
  if (commande === 'capturer') {
    const sortie = option('sortie', null);
    if (!sortie || sortie === true) throw new Error('--sortie <dossier> manquant');
    const faites = await capturer({
      sortie: path.resolve(sortie),
      fixtures: liste(option('fixtures'), FIXTURES),
      appareils: liste(option('appareils'), undefined),
      modes: liste(option('modes'), undefined),
      themes: liste(option('themes'), undefined),
      heure: typeof option('heure') === 'string' ? option('heure') : '',
      extras: option('extras-seuls', false) === true ? 'seuls' : option('extras', false) === true,
      port: Number(option('port', PORT)),
    });
    console.log(`${faites.length} captures dans ${path.resolve(sortie)}`);
    return;
  }
  console.log('usage : node scripts/planning-v3-fixtures.js servir|capturer|deriver (voir l en-tete du fichier)');
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
else module.exports = { FIXTURES, APPAREILS, PORT, lireFixture, lireCentre, servir, monter, repos, instant, capturer, deriver };
