// LE GATE DES ONGLETS DE CATEGORIE (2026-08-22, Edge headless).
//
// CE QUI A ETE MESURE le 2026-08-22 : une categorie creee par le gerant
// apparaissait bien comme SECTION dans « Activites & tarifs », avec son bouton
// « + Formule », mais la barre de filtres restait cablee sur cinq cles
// (Tout, Bowling, Laser Game, Anniversaires, Speciales). La formule creee dans
// une categorie inedite etait donc comptee avec les SPECIALES (« Speciales »
// passait de 6 a 7) et aucun onglet ne permettait de l isoler.
//
// CE QUE CE GATE VERROUILLE :
//   [A] chaque categorie creee a SON onglet, avec son compte a elle ;
//   [B] « Speciales » ne compte plus que la categorie speciale du socle, donc
//       la somme des onglets retombe sur le total ;
//   [C] cliquer l onglet d une categorie ne laisse que ses offres ;
//   [D] contre-epreuve : sans la liste des categories, l onglet disparait et la
//       formule repart dans « Speciales ».
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/pricing-family-chips-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FAMILY_CHIPS_PORT || 4314);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const CUSTOM_FAMILY = 'Soirees entreprise';

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
    const ext = path.extname(url.pathname).toLowerCase();
    if (url.pathname === '/' || url.pathname === '' || !ext) filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Trois categories : les deux du socle, plus une CREEE. Les libelles du socle
// sont volontairement ecrits avec leurs accents et le catalogue servi sans :
// la cle de categorie doit ignorer accents et casse, sinon « Formules speciales »
// et « Formules spéciales » deviendraient deux categories differentes.
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, CUSTOM_FAMILY }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'centers.switch', 'platform.admin', 'pricing.manage'];
    const session = {
      token: 'qa', cookieBacked: false, centerId: 'gate-centre', expiresAt,
      member: { id: 'gate-centre:platform-owner', name: 'Movsar' },
      role: { id: 'platform-owner', name: 'Proprietaire plateforme', locked: true },
      permissions: perms,
    };
    try {
      localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
      localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'prices', adminCenterId: 'gate-centre' }));
    } catch (e) {}
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const entry = (id, name, family) => ({
      id, name, bookingFamily: family, desc: ['Parties de bowling'], notes: [], priceType: 'per_pax', minPax: 1,
      source: 'seed', hasBowling: true, steps: [], validDays: null, notDuringHolidays: false,
      base: { priceValue: 20, priceOld: null },
      effective: { name, priceValue: 20, priceOld: null, removed: false, enabled: true },
      centerOverride: null,
    });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
      if (u.pathname === '/api/staff-state') return J({ ok: true, reservations: [], laneStatuses: {} });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'menuCenters') return J({ ok: true, owner: true, centers: [{ id: 'gate-centre', name: 'Centre du gate', status: 'active', clientId: 'gate', clientName: 'Gate', resources: { bowling: { laneCount: 8 } } }] });
        if (action === 'clientCatalog') {
          return J({
            ok: true, centerId: 'gate-centre',
            formulas: [
              entry('gate-anniv-1', 'ANNIV UN', 'Formules anniversaires'),
              entry('gate-anniv-2', 'ANNIV DEUX', 'Formules anniversaires'),
              entry('gate-spec-1', 'SPECIALE UNE', 'Formules speciales'),
              entry('gate-custom-1', 'SOIREE ENTREPRISE', CUSTOM_FAMILY),
            ],
            activities: [{ id: 'bowling', name: 'Bowling' }],
            centerActivityIds: ['bowling'],
            centerOpenDays: { regular: [0, 1, 2, 3, 4, 5, 6], holiday: [0, 1, 2, 3, 4, 5, 6] },
          });
        }
        return J({ ok: true, items: [], rows: [], formulas: [], activities: [], blocks: [], entries: [] });
      }
      return J({ ok: true });
    };
  }, { expiresAt, CUSTOM_FAMILY });
}

async function openPricing(page, tag) {
  await page.goto(`${BASE_URL}/?v=${tag}-${Date.now()}#/staff/prices`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.staffMenuPage === 'prices', null, { timeout: 20000 });
  await page.waitForTimeout(2200);
}

async function readChips(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('main button')]
      .filter((b) => /pv2PricingFilter/.test(b.getAttribute('onclick') || ''));
    return buttons.map((b) => ({
      key: (b.getAttribute('onclick').match(/pv2PricingFilter\('([^']*)'\)/) || [])[1] || '',
      text: b.textContent.replace(/\s+/g, ' ').trim(),
    }));
  });
}

async function readCardTitles(page) {
  return page.evaluate(() => [...document.querySelectorAll('main .pv2-price-card strong')].map((el) => el.textContent.trim()));
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const appOriginal = fs.readFileSync(APP, 'utf8');
  let failed = 0;

  try {
    section('[A] Chaque categorie creee a son onglet, et les comptes tombent juste');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page);
      await openPricing(page, 'chips-a');
      const chips = await readChips(page);
      const byKey = new Map(chips.map((c) => [c.key, c.text]));
      const custom = chips.find((c) => c.key.startsWith('family:'));

      record('un onglet porte la categorie creee', !!custom, custom ? `${custom.key} :: ${custom.text}` : chips.map((c) => c.key).join(' | '));
      record(
        'son libelle est celui saisi par le gerant',
        !!custom && /soirees entreprise/i.test(custom.text),
        custom ? custom.text : '',
      );
      record('il en compte UNE', !!custom && /1$/.test(custom.text.replace(/\s+/g, '')), custom ? custom.text : '');
      record(
        '« Speciales » ne compte plus que la categorie du socle',
        /1$/.test(String(byKey.get('special') || '').replace(/\s+/g, '')),
        byKey.get('special') || '(absent)',
      );
      record(
        '« Anniversaires » en compte deux',
        /2$/.test(String(byKey.get('formula') || '').replace(/\s+/g, '')),
        byKey.get('formula') || '(absent)',
      );

      section('[C] Cliquer l onglet d une categorie ne laisse que ses offres');
      await page.click(`main button[onclick*="pv2PricingFilter('${custom.key}')"]`);
      await page.waitForTimeout(900);
      const titles = await readCardTitles(page);
      record(
        'seule la formule de cette categorie reste',
        titles.length === 1 && /SOIREE ENTREPRISE/i.test(titles[0] || ''),
        titles.join(' | ') || 'aucune carte',
      );
      await context.close();
    }

    section('[D] CONTRE-EPREUVE : sans les onglets de categorie, la formule repart dans « Speciales »');
    {
      // La mutation doit reproduire l ETAT D AVANT, pas casser la page : couper
      // au milieu de la boucle levait une exception et le rendu tombait, ce qui
      // rendait les deux mesures vertes pour de mauvaises raisons.
      const anchor = 'function getPricingCustomFamilies(rows) {';
      const occurrences = appOriginal.split(anchor).length - 1;
      if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences})`);
      try {
        fs.writeFileSync(APP, appOriginal.replace(anchor, `${anchor}\r\n  return []; // mutation gate`));
        const context = await browser.newContext();
        const page = await context.newPage();
        await installMock(page);
        await openPricing(page, 'chips-d');
        const chips = await readChips(page);
        const custom = chips.find((c) => c.key.startsWith('family:'));
        const special = chips.find((c) => c.key === 'special');
        record(
          'sans la liste : plus d onglet de categorie, ce gate ROUGIRAIT',
          !custom,
          custom ? custom.key : 'aucun onglet family:',
        );
        record(
          'sans la liste : « Speciales » recompte la formule creee (2)',
          !!special && /2$/.test(special.text.replace(/\s+/g, '')),
          special ? special.text : '(absent)',
        );
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
