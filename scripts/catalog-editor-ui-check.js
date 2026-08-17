// Gate UI de l'editeur du CATALOGUE PARTAGE sur la page "Activites & tarifs"
// (page id `prices`, permission settings.manage). Edge headless via playwright-core,
// index.html reel servi en memoire, session settings.manage + centre precis mockee,
// /api/ops mocke STATEFUL (clientCatalog au chargement ; createFormula /
// setFormulaSteps / deleteFormula mutent l'etat, le clientCatalog suivant le
// reflete). Preuves COMPORTEMENTALES, jamais une simple presence de chaine :
//   1. "Ajouter une formule" ouvre une modale ; nom + prix + 1 step (bowling,
//      count 1) + Enregistrer -> un POST createFormula part avec
//      steps:[{activityId:'bowling',count:1,...}] et SANS centerId (ni au niveau
//      body, ni dans formula) ; la formule apparait apres re-fetch ;
//   2. "Modifier les activites" prefille les steps ; ajouter un step laser +
//      reordonner + Enregistrer -> un POST setFormulaSteps part avec la liste
//      (laser_game inclus, non vide, sans centerId) ;
//   3. "Supprimer la formule" (window.confirm) -> POST deleteFormula avec l'id ;
//      la ligne disparait apres re-fetch ;
//   4. reorder (monter/descendre) change l'ORDRE effectivement envoye ;
//   5. distinction "mon centre" vs "catalogue partage" presente a l'ecran.
// Puis DEUX contre-preuves par MUTATION (le gate sait rougir), restauration par
// EDITION INVERSE exacte (jamais git checkout) :
//   (a) neutraliser l'envoi des steps du create -> le check 1 (create-post-steps) rougit ;
//   (b) neutraliser le reorder -> le check 4 (reorder-order) rougit.
// Sortie 0 quand tout est vert, 1 sinon.
// Lancement : node scripts/catalog-editor-ui-check.js

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_PEV_PORT || 4251);
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
    name: 'envoi des steps du create neutralise',
    find: '    const createSteps = cevCollectSteps();',
    replace: '    const createSteps = [];',
    expect: 'create-post-steps',
  },
  {
    name: 'reorder neutralise',
    find: '    const moved = steps[index];\n    steps[index] = steps[target];\n    steps[target] = moved;',
    replace: '    void index;\n    void target;',
    expect: 'reorder-order',
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

// Session settings.manage + centre precis, /api/ops mocke STATEFUL. window.confirm
// force a true pour le test de suppression. addInitScript re-joue a chaque
// navigation -> etat frais par run.
async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'reservations.view', 'pricing.manage', 'settings.manage', 'direction.view'];
    const qaSession = {
      token: 'qa', cookieBacked: false, centerId: 'gembloux', expiresAt,
      member: { id: 'gembloux:mgr', name: 'Directrice' },
      role: { id: 'director', name: 'Direction', locked: false }, permissions: perms,
    };

    window.confirm = () => true;
    window.__cevPosts = [];
    const mkSteps = (arr) => (arr || []).map((s, i) => ({
      position: i,
      activityId: s.activityId != null ? String(s.activityId) : '',
      count: s.count != null ? Number(s.count) : 1,
      durationMinutes: s.durationMinutes != null ? Number(s.durationMinutes) : null,
      label: s.label != null ? String(s.label) : null,
      critical: s.critical === true,
      resourceType: s.resourceType != null ? String(s.resourceType) : null,
    }));
    // f1 : 2 steps (prefill + ajout laser). f2 : 2 steps distincts (reorder).
    // f3 : suppression.
    window.__cevCatalog = {
      f1: {
        id: 'f1', name: 'FORMULE 1', family: 'Anniversaire', minPax: 6, priceType: 'per_pax',
        source: 'seed', active: true, isBirthdayFormula: true, validDays: null,
        timeLimitMinMinutes: null, timeLimitMaxMinutes: null,
        base: { priceValue: 26, priceOld: 34 },
        effective: { name: 'FORMULE 1', priceValue: 26, priceOld: 34, enabled: true, removed: false },
        centerOverride: null,
        steps: mkSteps([{ activityId: 'bowling', count: 1, durationMinutes: 60, critical: true }, { activityId: 'minigolf_blacklight', count: 1 }]),
      },
      f2: {
        id: 'f2', name: 'FORMULE 2', family: 'Anniversaire', minPax: 6, priceType: 'per_pax',
        source: 'seed', active: true, isBirthdayFormula: true, validDays: null,
        timeLimitMinMinutes: null, timeLimitMaxMinutes: null,
        base: { priceValue: 30, priceOld: 45 },
        effective: { name: 'FORMULE 2', priceValue: 30, priceOld: 45, enabled: true, removed: false },
        centerOverride: null,
        steps: mkSteps([{ activityId: 'minigolf_blacklight', count: 1 }, { activityId: 'bowling', count: 1, durationMinutes: 60 }]),
      },
      f3: {
        id: 'f3', name: 'FORMULE 3', family: 'Anniversaire', minPax: 6, priceType: 'per_pax',
        source: 'seed', active: true, isBirthdayFormula: true, validDays: null,
        timeLimitMinMinutes: null, timeLimitMaxMinutes: null,
        base: { priceValue: 28, priceOld: 34 },
        effective: { name: 'FORMULE 3', priceValue: 28, priceOld: 34, enabled: true, removed: false },
        centerOverride: null,
        steps: mkSteps([{ activityId: 'bowling', count: 1, durationMinutes: 60 }]),
      },
    };
    window.__cevActivities = [
      { id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane' },
      { id: 'laser_game', name: 'Laser Game', resourceType: 'laser_arena' },
      { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', resourceType: 'soft_capacity' },
    ];
    const catList = () => Object.keys(window.__cevCatalog).map((k) => window.__cevCatalog[k]);

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
          if (body.action === 'createFormula') {
            window.__cevPosts.push(body);
            const f = body.formula || {};
            const id = `custom-${Object.keys(window.__cevCatalog).length + 1}`;
            window.__cevCatalog[id] = {
              id, name: f.name || 'Formule', family: f.family || '', minPax: f.minPax || 1,
              priceType: f.priceType || 'per_pax', source: 'custom', active: true,
              isBirthdayFormula: f.isBirthdayFormula === true, validDays: f.validDays || null,
              timeLimitMinMinutes: f.timeLimitMinMinutes != null ? f.timeLimitMinMinutes : null,
              timeLimitMaxMinutes: f.timeLimitMaxMinutes != null ? f.timeLimitMaxMinutes : null,
              base: { priceValue: f.priceValue != null ? f.priceValue : null, priceOld: f.priceOld != null ? f.priceOld : null },
              effective: { name: f.name || 'Formule', priceValue: f.priceValue != null ? f.priceValue : null, priceOld: f.priceOld != null ? f.priceOld : null, enabled: true, removed: false },
              centerOverride: null,
              steps: mkSteps(f.steps),
            };
            return J({ ok: true, action: body.action, id });
          }
          if (body.action === 'setFormulaSteps') {
            window.__cevPosts.push(body);
            const e = window.__cevCatalog[body.id];
            if (e) e.steps = mkSteps(body.steps);
            return J({ ok: true, action: body.action });
          }
          if (body.action === 'deleteFormula') {
            window.__cevPosts.push(body);
            delete window.__cevCatalog[body.id];
            return J({ ok: true, action: body.action });
          }
          if (body.action === 'updateFormula') {
            window.__cevPosts.push(body);
            const e = window.__cevCatalog[body.id];
            const p = body.patch || {};
            if (e) {
              if (p.name != null) { e.name = p.name; e.effective.name = p.name; }
              if (p.family != null) e.family = p.family;
              if (p.priceType != null) e.priceType = p.priceType;
              if (p.priceValue != null) { e.base.priceValue = p.priceValue; e.effective.priceValue = p.priceValue; }
              if (p.minPax != null) e.minPax = p.minPax;
            }
            return J({ ok: true, action: body.action });
          }
          return J({ ok: true });
        }
        if (u.searchParams.get('action') === 'clientCatalog') {
          return J({ ok: true, testData: true, centerId: 'gembloux', formulas: catList(), activities: window.__cevActivities });
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
  await page.goto(`${BASE_URL}/?v=cev-${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    () => typeof window.setView === 'function' && typeof window.renderStaffPricingPage === 'function' && typeof state !== 'undefined',
    null, { timeout: 15000 },
  );
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.staffMenuPage = 'prices';
    setView('staff');
  });
  // La section catalogue + une ligne apparaissent apres le fetch clientCatalog.
  await page.waitForSelector('#cevCatalogBlock', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('#staffPricingPage [data-cev-formula="f1"]', { state: 'visible', timeout: 15000 });
}

async function cevEnsureNoModal(page) {
  await page.evaluate(() => {
    if (typeof cevCloseModal === 'function') { try { window.cevCloseModal(); } catch (e) { /* ignore */ } }
    const o = document.getElementById('cevOverlay');
    if (o) o.remove();
  });
  await page.waitForFunction(() => !document.getElementById('cevOverlay'), null, { timeout: 5000 }).catch(() => {});
}

async function saveModal(page) {
  await page.click('#cevOverlay .pev-modal-foot .btn-primary');
}

async function runSuite(browser, quiet) {
  const failures = [];
  const ok = (cond, id, detail) => {
    const good = Boolean(cond);
    if (!quiet || !good) console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
    if (!good) failures.push(id);
  };

  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  try {
    await boot(page);

    // ---- 5. La PORTEE des actions est dite a l'ecran --------------------------
    // L'invariant est que l'operateur SACHE ce qui n'engage que son centre et
    // ce qui change tous les centres. Depuis la fusion en une carte par offre
    // (2026-08-17), cette distinction vit dans la legende du rayon formules,
    // plus dans deux bandeaux separes.
    const scopeText = await page.evaluate(() => document.getElementById('staffPricingPage').textContent || '');
    ok(/n'engage que ce centre/i.test(scopeText) && /TOUS les centres/.test(scopeText), 'scope-distinction',
      `centre=${/n'engage que ce centre/i.test(scopeText)} tous=${/TOUS les centres/.test(scopeText)}`);
    ok(await page.$('#cevAddFormula') !== null, 'catalog-add-btn');

    // ---- 1. "Ajouter une formule" -> modale -> createFormula avec steps ------
    await page.click('#cevAddFormula');
    await page.waitForSelector('#cevOverlay #cevName', { timeout: 10000 });
    ok(await page.$('#cevOverlay #cevStepsList') !== null, 'create-modal-open');
    await page.fill('#cevOverlay #cevName', 'Formule test QA');
    await page.fill('#cevOverlay #cevPrice', '30');
    await page.selectOption('#cevOverlay select[data-cev-idx="0"][data-cev-field="activityId"]', 'bowling');
    await saveModal(page);
    await page.waitForFunction(() => window.__cevPosts.some((p) => p.action === 'createFormula'), null, { timeout: 5000 }).catch(() => {});
    const posts1 = await page.evaluate(() => window.__cevPosts.slice());
    const create = posts1.find((p) => p.action === 'createFormula');
    const cStep = create && create.formula && Array.isArray(create.formula.steps) ? create.formula.steps[0] : null;
    ok(create && cStep && cStep.activityId === 'bowling' && cStep.count === 1, 'create-post-steps', JSON.stringify(create && create.formula && create.formula.steps));
    ok(create && !('centerId' in create) && create.formula && !('centerId' in create.formula), 'create-no-centerid',
      create ? `bodyKeys=${Object.keys(create).join(',')} formulaKeys=${Object.keys(create.formula || {}).join(',')}` : 'aucun POST');
    // Apparait apres re-fetch (mock stateful + pevReload).
    await page.waitForFunction(() => document.querySelector('#staffPricingPage [data-cev-formula="custom-4"]'), null, { timeout: 6000 }).catch(() => {});
    ok(await page.$('#staffPricingPage [data-cev-formula="custom-4"]') !== null, 'create-appears');

    // ---- 2. "Modifier les activites" (f1) : prefill + ajout laser + save -----
    await cevEnsureNoModal(page);
    await page.click('#staffPricingPage [data-cev-steps="f1"]');
    await page.waitForSelector('#cevOverlay #cevStepsList', { timeout: 10000 });
    const prefill = await page.$$eval('#cevOverlay .cev-step select[data-cev-field="activityId"]', (els) => els.map((e) => e.value));
    ok(prefill.length === 2 && prefill[0] === 'bowling', 'steps-prefill', JSON.stringify(prefill));
    await page.click('#cevOverlay #cevAddStep');
    await page.selectOption('#cevOverlay select[data-cev-idx="2"][data-cev-field="activityId"]', 'laser_game');
    // reorder : remonter le laser d'un cran (prouve que l'ordre est manipule ici aussi).
    await page.click('#cevOverlay [data-cev-move-up="2"]');
    await saveModal(page);
    await page.waitForFunction(() => window.__cevPosts.some((p) => p.action === 'setFormulaSteps' && p.id === 'f1'), null, { timeout: 5000 }).catch(() => {});
    const posts2 = await page.evaluate(() => window.__cevPosts.slice());
    const setF1 = posts2.filter((p) => p.action === 'setFormulaSteps' && p.id === 'f1').pop();
    const setIds = setF1 && Array.isArray(setF1.steps) ? setF1.steps.map((s) => s.activityId) : [];
    ok(setF1 && setIds.indexOf('laser_game') !== -1 && setIds.length === 3 && !('centerId' in setF1), 'steps-post-set', JSON.stringify(setF1 && setF1.steps));

    // ---- 4. reorder (f2) : monter/descendre change l'ordre effectivement envoye
    await cevEnsureNoModal(page);
    await page.click('#staffPricingPage [data-cev-steps="f2"]');
    await page.waitForSelector('#cevOverlay #cevStepsList', { timeout: 10000 });
    const beforeOrder = await page.$$eval('#cevOverlay .cev-step select[data-cev-field="activityId"]', (els) => els.map((e) => e.value));
    await page.click('#cevOverlay [data-cev-move-down="0"]');
    await saveModal(page);
    await page.waitForFunction(() => window.__cevPosts.some((p) => p.action === 'setFormulaSteps' && p.id === 'f2'), null, { timeout: 5000 }).catch(() => {});
    const posts4 = await page.evaluate(() => window.__cevPosts.slice());
    const setF2 = posts4.filter((p) => p.action === 'setFormulaSteps' && p.id === 'f2').pop();
    const sentOrder = setF2 && Array.isArray(setF2.steps) ? setF2.steps.map((s) => s.activityId) : [];
    ok(beforeOrder.length >= 2 && sentOrder.length >= 2 && sentOrder[0] === beforeOrder[1] && sentOrder[1] === beforeOrder[0],
      'reorder-order', JSON.stringify({ before: beforeOrder, sent: sentOrder }));

    // ---- 3. "Supprimer" (f3) -> deleteFormula + disparait apres re-fetch -----
    await cevEnsureNoModal(page);
    ok(await page.$('#staffPricingPage [data-cev-formula="f3"]') !== null, 'delete-target-present');
    await page.click('#staffPricingPage [data-cev-delete="f3"]');
    await page.waitForFunction(() => window.__cevPosts.some((p) => p.action === 'deleteFormula' && p.id === 'f3'), null, { timeout: 5000 }).catch(() => {});
    const posts3 = await page.evaluate(() => window.__cevPosts.slice());
    const del = posts3.find((p) => p.action === 'deleteFormula' && p.id === 'f3');
    ok(Boolean(del) && !('centerId' in (del || {})), 'delete-post', JSON.stringify(posts3[posts3.length - 1] || null));
    await page.waitForFunction(() => !document.querySelector('#staffPricingPage [data-cev-formula="f3"]'), null, { timeout: 6000 }).catch(() => {});
    ok(await page.$('#staffPricingPage [data-cev-formula="f3"]') === null, 'delete-gone');
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
      console.error(`catalog-editor-ui-check: ROUGE en nominal (${base.join(', ')})`);
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
        console.error('catalog-editor-ui-check: restauration ratee, le fichier differe de l\'original');
        process.exitCode = 1;
        return;
      }
      if (!red.length) {
        console.error(`catalog-editor-ui-check: MUTATION SANS EFFET (${m.name}) : le gate est reste vert, il ne prouve rien`);
        process.exitCode = 1;
        return;
      }
      if (!red.includes(m.expect)) {
        console.error(`catalog-editor-ui-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges observes : ${red.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(`mutation detectee comme prevu ("${m.expect}" ROUGE), code restaure a l'identique`);
    }

    console.log('--- passe finale : gate nominal apres restauration ---');
    const finalRun = await runSuite(browser, true);
    if (finalRun.length) {
      console.error(`catalog-editor-ui-check: ROUGE apres restauration (${finalRun.join(', ')})`);
      process.exitCode = 1;
      return;
    }
    console.log('catalog-editor-ui-check: ALL OK (ajout formule + steps sans centerId, prefill steps, setFormulaSteps ordonne, deleteFormula + disparition, reorder change l ordre, distinction mon centre vs catalogue ; 2 contre-preuves par mutation)');
  } finally {
    try {
      if (fs.readFileSync(SRC, 'utf8') !== original) fs.writeFileSync(SRC, original);
    } catch (e) { /* ignore */ }
    await browser.close();
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
})().catch((error) => {
  console.error('catalog-editor-ui-check: exception', error && (error.stack || error));
  process.exit(1);
});
