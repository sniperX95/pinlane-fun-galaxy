// Gate UI de l'editeur tarifaire CLIENT sur la page Etablissement "Activites &
// tarifs" (page id `prices`, permission pricing.manage). Edge headless via
// playwright-core, index.html reel servi en memoire, session pricing.manage +
// centre precis mockee, /api/ops mocke (clientCatalog au chargement, ok au save,
// clientCatalog MIS A JOUR au re-fetch). Preuves COMPORTEMENTALES, jamais une
// simple presence de chaine :
//   1. la page prices garde l'analytics (stats + Copier/Exporter) ET affiche des
//      lignes editables (boutons Modifier) ;
//   2. VRAI clic sur Modifier -> la modale s'ouvre PREFILLED avec la valeur
//      courante (prix + nom) ;
//   3. changer le prix + Enregistrer -> une requete POST saveClientFormuleOverride
//      part avec le bon formuleId et patch.priceValue, SIGNEE du centre AFFICHE
//      (centerId=libramont ici, session mockee sur gembloux : la preuve que
//      l'ecriture suit l'ECRAN, pas la session), et apres
//      re-fetch la ligne montre la NOUVELLE valeur ;
//   4. toggle Retirer -> POST avec patch.removed=true ;
//   5. bouton Reinitialiser sur une formule personnalisee -> POST
//      resetClientFormuleOverride.
// Puis DEUX contre-preuves par MUTATION (le gate sait rougir), restauration par
// EDITION INVERSE exacte (jamais git checkout) :
//   (a) neutraliser l'envoi de patch.priceValue -> le check 3 (save-post-price) rougit ;
//   (b) neutraliser le re-render apres save -> le check "nouvelle valeur" (reload-shows-new) rougit ;
//   (c) neutraliser la signature centerId de pevBody -> save-signed-center rougit.
// Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/client-tarifs-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_PEV_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SRC = path.join(ROOT, 'assets', 'staff-pages-v2.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Deux mutations ciblees du VRAI source (assets/staff-pages-v2.js). Les ancres
// multi-lignes sont exprimees en \n ; applyEdit les aligne sur la fin de ligne
// reelle du fichier (CRLF sur ce repo).
const MUTATIONS = [
  {
    name: 'envoi de patch.priceValue neutralise',
    find: 'patch.priceValue = d.priceValue;',
    replace: 'void d.priceValue;',
    expect: 'save-post-price',
  },
  {
    name: 're-render apres save neutralise',
    find: "pevToast('Tarif mis à jour.');\n      pevDismissModal();\n      pevReload();",
    replace: "pevToast('Tarif mis à jour.');\n      pevDismissModal();\n      void 0;",
    expect: 'reload-shows-new',
  },
  {
    name: 'signature centerId de pevBody neutralisee',
    find: 'return JSON.stringify(centerId ? { ...payload, centerId } : payload);',
    replace: 'return JSON.stringify(payload);',
    expect: 'save-signed-center',
  },
];

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

function applyEdit(find, replace) {
  const src = fs.readFileSync(SRC, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const f = find.split('\n').join(eol);
  const r = replace.split('\n').join(eol);
  const count = src.split(f).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count}) : ${find.slice(0, 46)}`);
  fs.writeFileSync(SRC, src.replace(f, r));
}

// Session pricing.manage + centre precis, et /api/ops mocke avec un catalogue
// client STATEFUL : le POST save/reset mute l'etat, le clientCatalog suivant le
// reflete. addInitScript re-joue a chaque navigation -> etat frais par run.
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'reservations.view', 'pricing.manage', 'settings.manage', 'direction.view'];
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'gembloux', expiresAt,
      member: { id: 'gembloux:mgr', name: 'Directrice' },
      role: { id: 'director', name: 'Direction', locked: false }, permissions: perms,
    };

    window.__pevPosts = [];
    // f1 : socle non personnalise (prix 26). f2 : deja personnalise (prix 35,
    // centerOverride pose) -> son bouton Reinitialiser doit apparaitre.
    window.__pevCatalog = {
      f1: { id: 'f1', name: 'FORMULE 1', family: 'Anniversaire', minPax: 6, base: { priceValue: 26, priceOld: 34 }, effective: { name: 'FORMULE 1', priceValue: 26, priceOld: 34, enabled: true, removed: false }, centerOverride: null, steps: [] },
      f2: { id: 'f2', name: 'FORMULE 2', family: 'Anniversaire', minPax: 6, base: { priceValue: 30, priceOld: 45 }, effective: { name: 'FORMULE 2', priceValue: 35, priceOld: 45, enabled: true, removed: false }, centerOverride: { priceValue: 35 }, steps: [] },
    };
    const catList = () => Object.keys(window.__pevCatalog).map((k) => window.__pevCatalog[k]);
    const applyPatch = (id, patch) => {
      const e = window.__pevCatalog[id];
      if (!e || !patch || typeof patch !== 'object') return;
      const co = e.centerOverride || {};
      if ('name' in patch) { e.effective.name = patch.name; co.name = patch.name; }
      if ('priceValue' in patch) { e.effective.priceValue = patch.priceValue; co.priceValue = patch.priceValue; }
      if ('priceOld' in patch) { e.effective.priceOld = patch.priceOld; if (patch.priceOld == null) delete co.priceOld; else co.priceOld = patch.priceOld; }
      if ('enabled' in patch) { e.effective.enabled = patch.enabled; co.enabled = patch.enabled; }
      if ('removed' in patch) { e.effective.removed = patch.removed; if (patch.removed) co.removed = true; else delete co.removed; }
      e.centerOverride = Object.keys(co).length ? co : null;
    };
    const resetOne = (id) => {
      const e = window.__pevCatalog[id];
      if (!e) return;
      e.effective = { name: e.name, priceValue: e.base.priceValue, priceOld: e.base.priceOld, enabled: true, removed: false };
      e.centerOverride = null;
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
          if (body.action === 'saveClientFormuleOverride') {
            window.__pevPosts.push(body);
            applyPatch(body.formuleId, body.patch || {});
            return J({ ok: true, action: body.action, override: {} });
          }
          if (body.action === 'resetClientFormuleOverride') {
            window.__pevPosts.push(body);
            resetOne(body.formuleId);
            return J({ ok: true, action: body.action });
          }
          return J({ ok: true });
        }
        if (u.searchParams.get('action') === 'clientCatalog') {
          return J({ ok: true, testData: true, centerId: 'gembloux', formulas: catList() });
        }
        return J({ ok: true });
      }
      if (u.pathname.endsWith('/public-booking-meta')) return J({ ok: true, formules: [], center: null });
      if (u.pathname.startsWith('/api/')) return J({ ok: true, reservations: [], laneStatuses: {}, communications: [] });
      return nf(input, init);
    };
    try { localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession)); } catch (e) { /* ignore */ }
  }, { expiresAt });
}

async function boot(page) {
  await installMock(page);
  await page.goto(`${BASE_URL}/?v=pev-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  // OPS-07 : l'entree staff declenche les modules ; leurs exports ne sont
  // plus disponibles depuis le seul boot public. Garder les controles suivants.
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate(async () => {
    setView('staff');
    await ensureStaffConsolesLoaded();
  });
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffPricingPage === 'function' && typeof state !== 'undefined',
    null, { timeout: 15000 },
  );
  // Vue staff sur la page prices (permission pricing.manage presente dans la session).
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.staffMenuPage = 'prices';
    setView('staff');
  });
  // Boutons Modifier presents (lignes editables) puis catalogue charge : le badge
  // "personnalise" de f2 n'apparait qu'apres le fetch clientCatalog + re-render.
  await page.waitForSelector('#staffPricingPage [data-pev-edit="f1"]', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('#staffPricingPage [data-pev-edit="f2"]');
    const card = btn && btn.closest('.pv2-price-card');
    return card && /personnalis/i.test(card.textContent);
  }, null, { timeout: 15000 });
}

function cardAmountText(page, formuleId) {
  return page.evaluate((id) => {
    const btn = document.querySelector(`#staffPricingPage [data-pev-edit="${id}"]`);
    const card = btn && btn.closest('.pv2-price-card');
    const amt = card && card.querySelector('.pv2-price-amount');
    return amt ? amt.textContent.trim() : '';
  }, formuleId);
}

async function clickSave(page) {
  await page.click('#pevOverlay .pev-modal-foot .btn-primary');
}

async function ensureNoModal(page) {
  await page.evaluate(() => {
    if (typeof pevCloseModal === 'function') { try { pevCloseModal(); } catch (e) { /* ignore */ } }
    const o = document.getElementById('pevOverlay');
    if (o) o.remove();
  });
  await page.waitForFunction(() => !document.getElementById('pevOverlay'), null, { timeout: 5000 }).catch(() => {});
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  try {
    await boot(page);

    // ---- 1. Analytics preservee + lignes editables -------------------------
    const t1 = await page.evaluate(() => {
      const scope = document.getElementById('staffPricingPage');
      const btns = Array.prototype.slice.call(scope.querySelectorAll('button'));
      return {
        hasStats: !!scope.querySelector('.pv2-stats'),
        copier: btns.some((b) => /Copier/i.test(b.textContent)),
        exporter: btns.some((b) => /Exporter/i.test(b.textContent)),
        editBtns: scope.querySelectorAll('[data-pev-edit]').length,
      };
    });
    ok(t1.hasStats && t1.copier && t1.exporter, 'analytics-preserved', JSON.stringify(t1));
    ok(t1.editBtns > 0, 'editable-rows', `boutons Modifier=${t1.editBtns}`);

    // ---- 2. Clic Modifier -> modale prefilled ------------------------------
    await page.click('#staffPricingPage [data-pev-edit="f1"]');
    await page.waitForSelector('#pevOverlay #pevPrice', { timeout: 10000 });
    const t2 = await page.evaluate(() => ({
      price: document.getElementById('pevPrice').value,
      name: document.getElementById('pevName').value,
    }));
    ok(t2.price === '26', 'modal-prefill-price', `value=${JSON.stringify(t2.price)}`);
    ok(t2.name === 'FORMULE 1', 'modal-prefill-name', `value=${JSON.stringify(t2.name)}`);

    // ---- 3. Changer le prix + Enregistrer ----------------------------------
    await page.fill('#pevOverlay #pevPrice', '55');
    await clickSave(page);
    // Attentes BORNEES + swallow : sous mutation, l'absence de POST / re-render
    // doit rougir le check attendu, pas jeter une exception qui masque l'id.
    await page.waitForFunction(() => window.__pevPosts.some((p) => p.action === 'saveClientFormuleOverride'), null, { timeout: 5000 }).catch(() => {});
    const posts3 = await page.evaluate(() => window.__pevPosts.slice());
    const save = posts3.find((p) => p.action === 'saveClientFormuleOverride' && p.formuleId === 'f1');
    ok(save && save.patch && save.patch.priceValue === 55, 'save-post-price', JSON.stringify(save || posts3[posts3.length - 1] || null));
    // DOCTRINE (2026-08-31, alignee sur catalog-editor-ui-check) : chaque
    // ecriture tarifaire est SIGNEE du centre AFFICHE. Le serveur PREFERE ce
    // centerId (resolveEffectiveCenterId), le valide (centers.switch + barriere
    // inter-clients) et ne retombe sur la session qu'a defaut. La session de ce
    // harnais est sur gembloux et l'ecran sur libramont : exiger libramont
    // prouve que l'ecriture suit l'ECRAN. (L'ancienne version exigeait
    // l'ABSENCE de centerId : la satisfaire aurait envoye l'edition d'un
    // fondateur multi-centres sur le centre de sa session, exactement le bug
    // corrige le 2026-08-21 sur le catalogue.)
    ok(Boolean(save) && save.centerId === 'libramont', 'save-signed-center', save ? `centerId=${save.centerId}` : 'aucun POST');

    await page.waitForFunction(() => {
      const btn = document.querySelector('#staffPricingPage [data-pev-edit="f1"]');
      const card = btn && btn.closest('.pv2-price-card');
      const amt = card && card.querySelector('.pv2-price-amount');
      return amt && /55/.test(amt.textContent);
    }, null, { timeout: 5000 }).catch(() => {});
    const amount3 = await cardAmountText(page, 'f1');
    ok(/55/.test(amount3), 'reload-shows-new', `montant carte f1="${amount3}"`);

    // ---- 4. Toggle Retirer -> POST patch.removed=true ----------------------
    await ensureNoModal(page);
    await page.click('#staffPricingPage [data-pev-edit="f1"]');
    await page.waitForSelector('#pevOverlay button[aria-label="Retirer du catalogue"]', { timeout: 10000 });
    await page.click('#pevOverlay button[aria-label="Retirer du catalogue"]');
    await clickSave(page);
    await page.waitForFunction(() => window.__pevPosts.some((p) => p.action === 'saveClientFormuleOverride' && p.patch && p.patch.removed === true), null, { timeout: 5000 }).catch(() => {});
    const posts4 = await page.evaluate(() => window.__pevPosts.slice());
    const removed = posts4.find((p) => p.action === 'saveClientFormuleOverride' && p.formuleId === 'f1' && p.patch && p.patch.removed === true);
    ok(Boolean(removed) && removed.centerId === 'libramont', 'save-post-removed', JSON.stringify(posts4[posts4.length - 1] || null));

    // ---- 5. Reinitialiser sur une formule personnalisee (f2) ---------------
    await ensureNoModal(page);
    await page.click('#staffPricingPage [data-pev-edit="f2"]');
    await page.waitForSelector('#pevOverlay .pev-modal-foot', { timeout: 10000 });
    const hasReset = await page.evaluate(() => Array.prototype.slice
      .call(document.querySelectorAll('#pevOverlay .pev-modal-foot button'))
      .some((b) => /initialis/i.test(b.textContent)));
    ok(hasReset, 'reset-button-shown', `Reinitialiser present=${hasReset}`);
    await page.evaluate(() => {
      const b = Array.prototype.slice.call(document.querySelectorAll('#pevOverlay .pev-modal-foot button')).find((x) => /initialis/i.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForFunction(() => window.__pevPosts.some((p) => p.action === 'resetClientFormuleOverride'), null, { timeout: 5000 }).catch(() => {});
    const posts5 = await page.evaluate(() => window.__pevPosts.slice());
    const reset = posts5.find((p) => p.action === 'resetClientFormuleOverride' && p.formuleId === 'f2');
    ok(Boolean(reset) && reset.centerId === 'libramont', 'reset-post', JSON.stringify(posts5[posts5.length - 1] || null));
  } catch (error) {
    ok(false, 'suite-exception', error && error.message);
  } finally {
    await page.close();
  }
  return failures;
}

(async () => {
  const original = fs.readFileSync(SRC, 'utf8');
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('--- passe 1 : gate nominal ---');
    const base = await runSuite(browser, false);
    if (base.length) {
      console.error(`client-tarifs-ui-check: ROUGE en nominal (${base.join(', ')})`);
      process.exitCode = 1;
      return;
    }

    for (const m of MUTATIONS) {
      console.log(`--- contre-preuve par mutation : ${m.name} ---`);
      applyEdit(m.find, m.replace);
      let red;
      try {
        red = await runSuite(browser, true);
      } finally {
        applyEdit(m.replace, m.find); // edition inverse exacte, jamais git checkout
      }
      if (fs.readFileSync(SRC, 'utf8') !== original) {
        console.error('client-tarifs-ui-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`client-tarifs-ui-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`client-tarifs-ui-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`client-tarifs-ui-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('client-tarifs-ui-check: ALL OK (analytics preservee, lignes editables, modale prefilled, save priceValue signe du centre affiche + nouvelle valeur affichee, toggle removed, reset ; 3 contre-preuves par mutation)');
  } finally {
    // Ultime garde-fou : si une exception a laisse le fichier mute, on restaure.
    try {
      if (fs.readFileSync(SRC, 'utf8') !== original) fs.writeFileSync(SRC, original);
    } catch (e) { /* ignore */ }
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('client-tarifs-ui-check: exception', error && (error.stack || error));
  process.exit(1);
});
