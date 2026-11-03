// Gate de la page Tarifs & formules refaite (journal 452, 2026-11-03).
// Edge headless sur index.html reel, /api mocke avec un catalogue STATEFUL.
// Preuves COMPORTEMENTALES, sur l ecran :
//   1. la ligne FORMULE 1 s affiche avec son prix publie (26 EUR) ;
//   2. un clic sur son prix ouvre la planche, le champ Prix a le focus ;
//   3. taper 28 : la carte du formulaire client et le mail disent 280 EUR pour
//      10 personnes (prix x groupe, la regle de getBasePrice), la ligne garde
//      26 EUR et dit « modifié » tant que rien n est publie ;
//   4. vider le prix barre puis Publier : UN POST saveClientFormuleOverride,
//      signe du centre AFFICHE (session sur gembloux), patch priceValue 28 et
//      priceOld 0 (null retomberait sur le prix barre du catalogue) ;
//   5. apres relecture du catalogue, la ligne dit 28 EUR.
// Sortie 0 quand tout est vert, 1 sinon. Lancement : node scripts/tarifs-effets-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_TARIFS_PORT || 4371);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

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

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'reservations.view', 'pricing.manage', 'settings.manage', 'direction.view'];
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'gembloux', expiresAt,
      member: { id: 'gembloux:dir', name: 'Directrice' },
      role: { id: 'director', name: 'Direction', locked: false }, permissions: perms,
    };
    window.__tfPosts = [];
    const base = (id, name, price, old, desc) => ({
      id, name, family: 'Anniversaire', bookingFamily: 'Formules anniversaires', minPax: 6, priceType: 'per_pax',
      desc, notes: [], noHolidays: true, steps: [], source: 'seed',
      base: { priceValue: price, priceOld: old, humanValidation: 'recommended' },
      effective: { name, priceValue: price, priceOld: old, enabled: true, removed: false, humanValidation: 'recommended' },
      centerOverride: null,
    });
    window.__tfCatalog = {
      f1: base('f1', 'FORMULE 1', 26, 34, ['1h de Bowling', '1 partie Laser Game', '30 min arcades', '2 cruches boissons']),
      f2: base('f2', 'FORMULE 2', 30, 45, ['1 partie Minigolf', '2 parties Laser Game', '30 min arcades', '2 cruches boissons']),
    };
    const applyPatch = (id, patch) => {
      const e = window.__tfCatalog[id];
      if (!e || !patch) return;
      const co = e.centerOverride || {};
      ['name', 'priceValue', 'priceOld', 'enabled', 'removed', 'humanValidation'].forEach((k) => {
        if (k in patch) { e.effective[k] = patch[k]; co[k] = patch[k]; }
      });
      e.centerOverride = Object.keys(co).length ? co : null;
    };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      let u;
      try { u = new URL(raw, window.location.origin); } catch (e) { return nf(input, init); }
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession });
      if (u.pathname === '/api/ops') {
        if (method === 'POST') {
          let body = {};
          try { body = JSON.parse(init.body || '{}'); } catch (e) { body = {}; }
          window.__tfPosts.push(body);
          if (body.action === 'saveClientFormuleOverride') { applyPatch(body.formuleId, body.patch || {}); return J({ ok: true, action: body.action, override: {} }); }
          return J({ ok: true });
        }
        if (u.searchParams.get('action') === 'clientCatalog') {
          return J({ ok: true, testData: true, centerId: 'libramont', formulas: Object.values(window.__tfCatalog), activities: [], centerActivityIds: [], centerOpenDays: null });
        }
        return J({ ok: true });
      }
      if (u.pathname.endsWith('/public-availability')) return J({ ok: true, durees: { f1: { min: 135, max: 135 }, f2: { min: 150, max: 150 } } });
      if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], activities: [], center: null });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) { /* ignore */ }
  }, { expiresAt });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const failures = [];
  const ok = (cond, id, detail) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'}  ${id}${cond || !detail ? '' : `  [${detail}]`}`);
    if (!cond) failures.push(id);
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=tarifs-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(async () => { setView('staff'); await ensureStaffConsolesLoaded(); });
    await page.waitForFunction(() => typeof window.renderStaffPricingPage === 'function' && typeof state !== 'undefined', null, { timeout: 15000 });
    await page.evaluate(() => { if (typeof hasSavedAuth === 'function') hasSavedAuth(); state.staffMenuPage = 'prices'; setView('staff'); });
    await page.waitForSelector('#staffPricingPage [data-tf-prix="f1"]', { state: 'visible', timeout: 20000 });

    const ligne = (id) => page.evaluate((x) => {
      const el = document.querySelector(`#staffPricingPage [data-tf-ligne="${x}"]`);
      const m = el && el.querySelector('[data-tf-montant]');
      return { montant: m ? m.textContent.replace(/\s+/g, ' ').trim() : '', texte: el ? el.textContent.replace(/\s+/g, ' ') : '' };
    }, id);
    const l0 = await ligne('f1');
    ok(/^26\b/.test(l0.montant), 'ligne-prix-publie', l0.montant);

    await page.click('#staffPricingPage [data-tf-prix="f1"]');
    await page.waitForFunction(() => document.activeElement && document.activeElement.matches('[data-tf-champ="prix"]'), null, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => Boolean(document.activeElement && document.activeElement.matches('[data-tf-champ="prix"]'))), 'clic-prix-donne-le-focus');

    await page.keyboard.press('Control+A');
    await page.keyboard.type('28', { delay: 60 });
    await page.waitForTimeout(1200);
    const lieux = await page.evaluate(() => {
      const t = (k) => { const el = document.querySelector(`#staffPricingPage [data-tf-lieu="${k}"]`); return el ? el.textContent.replace(/\s+/g, ' ') : ''; };
      return { formulaire: t('formulaire'), mails: t('mails') };
    });
    ok(/280\s*€/.test(lieux.formulaire) && /28\s*€/.test(lieux.formulaire), 'formulaire-suit-le-brouillon', lieux.formulaire.slice(0, 160));
    ok(/280\s*€/.test(lieux.mails), 'mail-suit-le-brouillon', lieux.mails.slice(0, 160));
    const l1 = await ligne('f1');
    ok(/^26\b/.test(l1.montant) && /modifi/i.test(l1.texte), 'ligne-garde-le-publie', `${l1.montant} | ${l1.texte.slice(0, 80)}`);

    await page.click('#staffPricingPage [data-tf-champ="ancien"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    const centreAffiche = await page.evaluate(() => (typeof getCurrentStaffCenterId === 'function' ? getCurrentStaffCenterId() : ''));
    const bouton = await page.$('[data-tf-action="publier"]');
    if (bouton) await bouton.click();
    else await page.evaluate(() => window.tarifsPublier());
    await page.waitForFunction(() => window.__tfPosts.some((b) => b.action === 'saveClientFormuleOverride'), null, { timeout: 8000 }).catch(() => {});
    const posts = await page.evaluate(() => window.__tfPosts.filter((b) => b.action === 'saveClientFormuleOverride'));
    const p = posts[0] || {};
    ok(posts.length === 1 && p.formuleId === 'f1', 'un-post-par-formule', JSON.stringify(posts));
    ok(Boolean(centreAffiche) && p.centerId === centreAffiche && p.centerId !== 'gembloux', 'post-signe-du-centre-affiche', `${p.centerId} / ecran ${centreAffiche}`);
    ok(p.patch && p.patch.priceValue === 28, 'patch-prix', JSON.stringify(p.patch));
    ok(p.patch && p.patch.priceOld === 0, 'prix-barre-vide-envoie-zero', JSON.stringify(p.patch));

    await page.waitForFunction(() => {
      const m = document.querySelector('#staffPricingPage [data-tf-ligne="f1"] [data-tf-montant]');
      return m && /^28\b/.test(m.textContent.trim());
    }, null, { timeout: 8000 }).catch(() => {});
    const l2 = await ligne('f1');
    ok(/^28\b/.test(l2.montant), 'ligne-relue-apres-publication', l2.montant);
    ok(erreurs.length === 0, 'aucune-erreur-de-page', erreurs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\nROUGE : ${failures.length} echec(s)` : '\nVERT');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error('ERREUR', e && e.stack ? e.stack : e); process.exit(1); });
