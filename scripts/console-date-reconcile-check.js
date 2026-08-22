// LE GATE DE LA DATE DE TRAVAIL (2026-08-22, Edge headless).
//
// CE QUI A ETE MESURE EN PRODUCTION le 2026-08-22 (vrai jour : 22 aout) :
//
//   localStorage.funGalaxy_v4 portait TROIS dates de travail, toutes perimees,
//   et loadState() les rendait telles quelles :
//     currentDate                   = 2026-07-29
//     adminDate                     = 2026-07-21
//     staffReservationsSelectedDate = 2026-07-28
//
//   Dix ecrans affichaient alors le 29 juillet avec le badge « Aujourd hui » :
//   Dashboard, les trois Planning, Formules, Arrivees, Sessions, Evenements,
//   Pistes bowling, Laser Game. Les KPI en dessous etaient ceux du 29 juillet.
//   Et « + Reservation » ouvrait un formulaire annoncant « creee sur la date
//   affichee », DATE : mer. 29 juil. : un client encode au comptoir partait
//   24 jours dans le passe, sans la moindre alerte.
//
// CE QUE CE GATE VERROUILLE, et rien d autre :
//
//   [A] Une date de travail ANTERIEURE a aujourd hui est ramenee a aujourd hui
//       au demarrage. Mesure sur l ETAT et sur l ECRAN : le nom du mois perime
//       ne doit apparaitre nulle part dans la console rendue.
//   [B] Une date de travail POSTERIEURE est CONSERVEE. Un responsable qui
//       prepare le planning de la semaine prochaine et rafraichit sa page doit
//       retrouver sa date, pas etre ramene a aujourd hui de force.
//   [C] Contre-epreuve : on neutralise la ligne de production qui tient [A] et
//       on exige que la date perimee revienne. Sans elle, ce gate serait vert
//       meme si le correctif disparaissait.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/console-date-reconcile-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DATE_RECONCILE_PORT || 4311);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const CENTER = { id: 'libramont', name: 'Fun Galaxy Libramont' };

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

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

// Le double sert une session ouverte et des reponses vides : ce gate ne mesure
// ni le contenu des ecrans ni le reseau, seulement la DATE DE TRAVAIL. Toute
// route non citee rend { ok: true } pour que le boot aille au bout.
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, C }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'centers.switch', 'platform.admin'];
    const session = {
      token: 'qa', cookieBacked: false, centerId: C.id, expiresAt,
      member: { id: `${C.id}:platform-owner`, name: 'Movsar' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
      if (u.pathname === '/api/staff-state') return J({ ok: true, reservations: [], laneStatuses: {} });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today: '', durationOptions: [], formules: [], laserOptions: [], bowlingPrices: {},
          activities: [{ id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane', priceType: 'grid_bowling', planned: true, order: 1 }],
          center: { id: C.id, name: C.name, status: 'active', offerAvailability: {}, booking: { laneCount: 8 } },
        });
      }
      if (u.pathname === '/api/public-availability') return J({ ok: true, slots: [], program: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'menuCenters') {
          return J({ ok: true, owner: true, centers: [{ id: C.id, name: C.name, status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: { bowling: { laneCount: 8 } } }] });
        }
        if (action === 'centerConfig') {
          return J({ ok: true, centers: [{ id: C.id, name: C.name, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8 } } }], activities: [] });
        }
        return J({ ok: true, items: [], rows: [], formulas: [], activities: [], blocks: [], entries: [] });
      }
      return J({ ok: true });
    };
  }, { expiresAt, C: CENTER });
}

// La graine : l etat exact d une console laissee ouverte un autre jour.
async function seedStoredDates(page, dateStr) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ d, C, exp }) => {
    try {
      // Session deja ouverte : sans elle la page reste sur l ecran de connexion
      // et toute mesure d ECRAN porterait sur le formulaire de login, donc sur
      // rien du tout.
      localStorage.setItem('funGalaxy_auth_v1', JSON.stringify({
        token: 'qa', cookieBacked: false, centerId: C.id, expiresAt: exp,
        member: { id: `${C.id}:platform-owner`, name: 'Movsar' },
        role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
        permissions: ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'centers.switch', 'platform.admin'],
      }));
      localStorage.setItem('funGalaxy_v4', JSON.stringify({
        view: 'staff',
        staffMenuPage: 'dashboard',
        adminCenterId: C.id,
        currentDate: d,
        adminDate: d,
        staffReservationsSelectedDate: d,
        staffReservationsMonth: d.slice(0, 7),
        booking: { name: '', phone: '', email: '', pax: 4, date: d, type: 'bowling', mode: 'carte', activities: { bowling: { duration: 1 } } },
      }));
    } catch (e) {}
  }, { d: dateStr, C: CENTER, exp: expiresAt });
}

async function bootStaff(page) {
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffMenu === 'function',
    null, { timeout: 20000 },
  );
  await page.evaluate(() => {
    setView('staff');
    if (typeof setMenuPage === 'function') setMenuPage('dashboard');
    else if (typeof state !== 'undefined') { state.staffMenuPage = 'dashboard'; }
    if (typeof renderStaff === 'function') renderStaff();
    if (typeof renderStaffMenu === 'function') renderStaffMenu();
  });
  await page.waitForTimeout(600);
}

async function readDates(page) {
  return page.evaluate(() => ({
    today: typeof todayStr === 'function' ? todayStr() : '',
    currentDate: state.currentDate || '',
    adminDate: state.adminDate || '',
    reservationsDate: state.staffReservationsSelectedDate || '',
    reservationsMonth: state.staffReservationsMonth || '',
    bookingDate: (state.booking && state.booking.date) || '',
    screen: document.body.innerText.replace(/\s+/g, ' '),
  }));
}

// Le mois tel que la console l ECRIT, en abrege et sans accent : elle peint
// « Mer. 29 juil. 2026 », pas « juillet ». Comparer le mot long laissait passer
// n importe quoi (l assertion etait verte avant meme le correctif, elle
// mesurait un non-evenement).
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function monthStem(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const long = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return strip(long).slice(0, 4);
}
function shiftDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const appOriginal = fs.readFileSync(APP, 'utf8');
  let failed = 0;

  try {
    // Le jour de reference est celui du NAVIGATEUR, lu via todayStr() : le gate
    // ne code aucune date en dur, il reste vrai demain.
    let today = '';
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      await page.goto(`${BASE_URL}/?v=date-probe-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof todayStr === 'function', null, { timeout: 20000 });
      today = await page.evaluate(() => todayStr());
      await context.close();
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`todayStr() illisible : ${today}`);

    // 40 jours en arriere : garantit un mois different, donc une mesure d ecran
    // qui discrimine vraiment.
    const past = shiftDays(today, -40);
    const future = shiftDays(today, 7);

    section(`[A] Une date de travail perimee (${past}) est ramenee a aujourd hui (${today})`);
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      await seedStoredDates(page, past);
      await page.goto(`${BASE_URL}/?v=date-a-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      const got = await readDates(page);

      record('state.currentDate est ramene a aujourd hui', got.currentDate === today, `${got.currentDate} (attendu ${today})`);
      record('state.adminDate est ramene a aujourd hui', got.adminDate === today, `${got.adminDate} (attendu ${today})`);
      record('la date de la page Reservations est ramenee a aujourd hui', got.reservationsDate === today, `${got.reservationsDate} (attendu ${today})`);
      record('le mois du selecteur suit', got.reservationsMonth === today.slice(0, 7), `${got.reservationsMonth} (attendu ${today.slice(0, 7)})`);
      record('la date du formulaire de reservation est ramenee a aujourd hui', got.bookingDate === today, `${got.bookingDate} (attendu ${today})`);

      // L ECRAN, pas seulement l etat.
      const oldMonth = monthStem(past);
      const nowMonth = monthStem(today);
      const painted = strip(got.screen);
      if (oldMonth !== nowMonth) {
        record(
          `le mois perime (${oldMonth}...) n est peint nulle part dans la console`,
          !painted.includes(oldMonth),
          got.screen.slice(0, 200),
        );
        record(
          `le mois du jour (${nowMonth}...) est bien peint`,
          painted.includes(nowMonth),
          got.screen.slice(0, 200),
        );
      }
      await context.close();
    }

    section(`[B] Une date de travail future (${future}) est CONSERVEE`);
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      await seedStoredDates(page, future);
      await page.goto(`${BASE_URL}/?v=date-b-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      await bootStaff(page);
      const got = await readDates(page);
      record('state.currentDate garde la date future choisie', got.currentDate === future, `${got.currentDate} (attendu ${future})`);
      record('state.adminDate garde la date future choisie', got.adminDate === future, `${got.adminDate} (attendu ${future})`);
      record('la date de la page Reservations garde la date future', got.reservationsDate === future, `${got.reservationsDate} (attendu ${future})`);
      await context.close();
    }

    section('[C] CONTRE-EPREUVE : sans la reconciliation, la date perimee revient');
    {
      const anchor = 'reconcileWorkingDates(state);';
      const occurrences = appOriginal.split(anchor).length - 1;
      if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s))`);
      try {
        fs.writeFileSync(APP, appOriginal.replace(anchor, '/* mutation gate */'));
        const context = await browser.newContext();
        const page = await context.newPage();
        await installMock(page);
        await seedStoredDates(page, past);
        await page.goto(`${BASE_URL}/?v=date-c-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
        await bootStaff(page);
        const broken = await readDates(page);
        record(
          'sans la reconciliation : la console rouvre sur la date perimee, ce gate ROUGIRAIT',
          broken.currentDate === past && broken.adminDate === past,
          `currentDate=${broken.currentDate} adminDate=${broken.adminDate} (perime ${past})`,
        );
        // Et l ECRAN aussi : c est ce qui prouve que l assertion d ecran de [A]
        // discrimine vraiment au lieu de mesurer une page vide.
        const oldMonth = monthStem(past);
        if (oldMonth !== monthStem(today)) {
          record(
            `sans la reconciliation : le mois perime (${oldMonth}...) est bien peint a l ecran`,
            strip(broken.screen).includes(oldMonth),
            broken.screen.slice(0, 200),
          );
        }
        await context.close();
      } finally {
        fs.writeFileSync(APP, appOriginal); // ECRITURE INVERSE exacte
      }
      record('app-main.js est restaure a l identique', fs.readFileSync(APP, 'utf8') === appOriginal);
    }

  } catch (error) {
    console.error('\nERREUR DU GATE:', error && (error.stack || error.message || error));
    failed = 1;
  } finally {
    await browser.close();
    server.close();
  }

  const red = checks.filter(c => !c.ok).length;
  console.log(`\n${red || failed ? 'ECHEC' : 'ALL OK'} : ${checks.length - red}/${checks.length} verifications`);
  process.exit(red || failed ? 1 : 0);
})();
