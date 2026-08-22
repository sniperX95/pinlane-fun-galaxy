// LE GATE DES INGREDIENTS D UNE FORMULE (2026-08-22, Edge headless).
//
// CE QUI A ETE MESURE EN PRODUCTION le 2026-08-22 : le catalogue de formules
// appartient a la SOCIETE, les activites appartiennent au CENTRE, et rien ne
// verifiait que les deux se rejoignent.
//
//   Fun Galaxy Gembloux ne possede ni `playground` ni `party_table`.
//   f6, f7 et f8 les exigent. Ces trois formules etaient pourtant affichees
//   comme reservables : carte cliquable, prix calcule (240 EUR pour 8), puis
//   liste de creneaux VIDE avec « Aucun scenario automatique sur pour cette
//   formule ». Trois dates testees pour chacune, toutes a zero.
//   Bilan du jour : 2 formules mortes a Libramont, 5 a Gembloux, 14 a Ciney.
//
// CE QUE CE GATE VERROUILLE : une formule dont ce centre ne possede pas tous
// les ingredients est GRISEE, avec sa raison, au lieu d etre un cul-de-sac.
// Le meme catalogue reste intact la ou le centre a les ingredients : c est la
// contre-mesure qui empeche de « corriger » en cachant des offres vendables.
//
// Sortie 0 quand tout est vert. Sortie 1 sinon.
// Lancement : node scripts/formula-ingredients-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'assets', 'app-main.js');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_INGREDIENTS_PORT || 4313);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// L id de la formule est le meme des deux cotes : seule la DOTATION du centre
// change. C est ce qui rend la mesure concluante.
const FORMULA_ID = 'gate-formule-plaine';
const FORMULA_PLAIN_ID = 'gate-formule-bowling';

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

// hasPlayground = le centre possede la plaine de jeux. Rien d autre ne change
// entre les deux mondes : meme catalogue, memes horaires, meme date.
async function installMock(page, { hasPlayground }) {
  await page.addInitScript(({ hasPlayground, FORMULA_ID, FORMULA_PLAIN_ID }) => {
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    // Le catalogue de la SOCIETE : identique dans les deux centres.
    const formules = [
      {
        id: FORMULA_ID, name: 'FORMULE PLAINE', family: 'Formules anniversaires', type: 'per_pax', price: 20,
        minPax: 1, validDays: null, noHolidays: false, hasBowling: false,
        desc: ['1 entree a la plaine de jeu', '8 EUR d arcade par enfant'], notes: [],
      },
      {
        id: FORMULA_PLAIN_ID, name: 'FORMULE BOWLING', family: 'Formules anniversaires', type: 'per_pax', price: 26,
        minPax: 1, validDays: null, noHolidays: false, hasBowling: true, bowlingDur: 1,
        desc: ['Parties de bowling, chaussures comprises'], notes: [],
      },
    ];
    const activityAvailability = hasPlayground
      ? { bowling: true, arcade_time: true, playground: true }
      : { bowling: true, arcade_time: true };
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true,
          today: new Date().toISOString().slice(0, 10),
          durationOptions: [{ label: '1 heure', price: 39, value: 1 }],
          formules,
          laserOptions: [],
          bowlingPrices: { 1: 39 },
          activities: [
            { id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane', priceType: 'grid_bowling', planned: true, order: 1, minMinutes: 60, maxMinutes: 60, defaultMinutes: 60, stepMinutes: 30 },
            { id: 'arcade_time', name: 'Arcades', resourceType: 'soft_capacity', priceType: 'per_pax', planned: false, order: 2, defaultMinutes: 30 },
          ],
          center: {
            id: 'gate-centre', name: 'Centre du gate', status: 'active',
            offerAvailability: {}, activityAvailability,
            booking: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, bowlingPrices: { 1: 39 } },
            defaultSchedule: {
              regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '22:00' }, 6: { open: '10:00', close: '22:00' } },
              holiday: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '22:00' }, 6: { open: '10:00', close: '22:00' } },
            },
          },
        });
      }
      if (u.pathname === '/api/public-availability') return J({ ok: true, slots: [], program: null });
      return J({ ok: true });
    };
  }, { hasPlayground, FORMULA_ID, FORMULA_PLAIN_ID });
}

// Le meme monde, vu depuis la CONSOLE : session ouverte, catalogue de la
// societe, et la dotation du centre servie par le serveur (centerActivityIds).
async function installConsoleMock(page, { hasPlayground }) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ hasPlayground, expiresAt, FORMULA_ID, FORMULA_PLAIN_ID }) => {
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
    const entry = (id, name, desc) => ({
      id, name, bookingFamily: 'Formules anniversaires', desc, notes: [], priceType: 'per_pax', minPax: 1,
      source: 'seed', hasBowling: false, steps: [],
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
              entry(FORMULA_ID, 'FORMULE PLAINE', ['1 entree a la plaine de jeu']),
              entry(FORMULA_PLAIN_ID, 'FORMULE BOWLING', ['Parties de bowling, chaussures comprises']),
            ],
            activities: [
              { id: 'bowling', name: 'Bowling' },
              { id: 'playground', name: 'Plaine de jeux' },
            ],
            centerActivityIds: hasPlayground ? ['bowling', 'playground'] : ['bowling'],
          });
        }
        return J({ ok: true, items: [], rows: [], formulas: [], activities: [], blocks: [], entries: [] });
      }
      return J({ ok: true });
    };
  }, { hasPlayground, expiresAt, FORMULA_ID, FORMULA_PLAIN_ID });
}

async function readFormulaCards(page) {
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof renderFormules === 'function', null, { timeout: 20000 });
  // On demande une date de DEMAIN : la fenetre « aujourd hui » depend de l heure
  // a laquelle le gate tourne, et un centre ferme le soir rendrait la mesure
  // dependante du moment de la journee.
  await page.evaluate(() => {
    const [y, m, d] = todayStr().split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    state.booking.date = next;
    state.booking.pax = 8;
    renderFormules();
  });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.formule-card')];
    return cards.map((card) => ({
      id: card.dataset.formuleId || '',
      disabled: card.disabled === true,
      text: card.innerText.replace(/\s+/g, ' ').trim(),
    }));
  });
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const appOriginal = fs.readFileSync(APP, 'utf8');
  let failed = 0;

  try {
    section('[A] Le centre POSSEDE la plaine de jeux : la formule reste reservable');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { hasPlayground: true });
      await page.goto(`${BASE_URL}/reserver/gate-centre?v=ing-a-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      const cards = await readFormulaCards(page);
      const plaine = cards.find(c => c.id === FORMULA_ID);
      const bowling = cards.find(c => c.id === FORMULA_PLAIN_ID);
      record('la formule a la plaine est presente', !!plaine, plaine ? '' : cards.map(c => c.id).join(' | ') || 'aucune carte');
      record('elle est reservable', !!plaine && !plaine.disabled, plaine ? `disabled=${plaine.disabled}` : '');
      record('la formule sans ingredient rare reste reservable', !!bowling && !bowling.disabled, bowling ? `disabled=${bowling.disabled}` : 'absente');
      await context.close();
    }

    section('[B] Le centre N A PAS la plaine : la formule est grisee, avec sa raison');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installMock(page, { hasPlayground: false });
      await page.goto(`${BASE_URL}/reserver/gate-centre?v=ing-b-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
      const cards = await readFormulaCards(page);
      const plaine = cards.find(c => c.id === FORMULA_ID);
      const bowling = cards.find(c => c.id === FORMULA_PLAIN_ID);
      record('la formule a la plaine est toujours affichee', !!plaine, plaine ? '' : 'carte absente');
      record('elle n est plus cliquable', !!plaine && plaine.disabled === true, plaine ? `disabled=${plaine.disabled}` : '');
      record(
        'la carte dit pourquoi',
        !!plaine && /indisponible dans ce centre/i.test(plaine.text),
        plaine ? plaine.text.slice(0, 120) : '',
      );
      record(
        'LA CONTRE-MESURE : la formule que le centre peut tenir reste reservable',
        !!bowling && bowling.disabled === false,
        bowling ? `disabled=${bowling.disabled}` : 'absente',
      );
      await context.close();
    }

    section('[D] La console le dit AUSSI au gerant, avec la meme regle');
    for (const hasPlayground of [true, false]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installConsoleMock(page, { hasPlayground });
      await page.goto(`${BASE_URL}/?v=ing-d-${hasPlayground}-${Date.now()}#/staff/prices`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => typeof state !== 'undefined' && state.staffMenuPage === 'prices', null, { timeout: 20000 });
      await page.waitForTimeout(2000);
      const seen = await page.evaluate(() => {
        const main = document.querySelector('main') || document.body;
        return main.innerText.replace(/\s+/g, ' ');
      });
      if (hasPlayground) {
        record(
          'centre dote : aucune alerte d ingredient manquant',
          !/pas r[ée]alisable ici/i.test(seen),
          seen.slice(0, 140),
        );
      } else {
        // L INGREDIENT EST NOMME DANS LE BADGE, pas seulement present quelque
        // part sur la page : la description de l offre contient deja le mot
        // « plaine », chercher dans tout l ecran ne prouverait rien.
        const badge = (seen.match(/Pas r[ée]alisable ici : il manque [^·|]{0,60}/) || [''])[0];
        record(
          'centre non dote : le badge nomme l ingredient manquant',
          /plaine de jeux/i.test(badge),
          badge || seen.slice(0, 140),
        );
      }
      await context.close();
    }

    section('[C] CONTRE-EPREUVE : sans la garde, le cul-de-sac revient');
    {
      const anchor = '    const missing = centerMissingActivityIds(getFormulaActivityIds(formule));';
      const occurrences = appOriginal.split(anchor).length - 1;
      if (occurrences !== 1) throw new Error(`ancre de mutation introuvable ou ambigue (${occurrences})`);
      try {
        fs.writeFileSync(APP, appOriginal.replace(anchor, '    const missing = [];'));
        const context = await browser.newContext();
        const page = await context.newPage();
        await installMock(page, { hasPlayground: false });
        await page.goto(`${BASE_URL}/reserver/gate-centre?v=ing-c-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
        const cards = await readFormulaCards(page);
        const plaine = cards.find(c => c.id === FORMULA_ID);
        record(
          'sans la garde : la formule impossible redevient cliquable, ce gate ROUGIRAIT',
          !!plaine && plaine.disabled === false,
          plaine ? `disabled=${plaine.disabled}` : 'carte absente',
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
