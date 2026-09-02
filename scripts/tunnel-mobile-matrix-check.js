// LE FORMULAIRE MOBILE NE REDEVIENT JAMAIS UNE BOUILLIE EN SILENCE.
//
// Refonte du 2026-09-01, apres le verdict Movsar (« il suffit qu un petit truc
// change et la version mobile devient super buggee ; quand je prends le clavier
// tout bouge ; plein de debordements caches derriere d autres boutons »).
// La matrice qui a dicte la refonte : 140 cellules normales + 48 etats clavier
// + subset WebKit ; les defauts mesures allaient du champ Email dont le bas
// validait le recapitulatif (recouvrement 1281px2) au paysage 844x390 aux
// champs INATTEIGNABLES (corps ecrase a 37px, aucun ancetre defilable).
//
// Ce gate rejoue les scenarios qui ont casse, sur les DEUX moteurs :
// Chromium/Edge (le rendu Android/Samsung) et WebKit (le moteur d iPhone).
//
//   A. STABILITE : focus pur d un champ a 390x844, SIX reperes ne bougent pas
//      de plus de 2px (le « tout bouge » chiffre).
//   B. CLAVIER (modele Android : le viewport retrecit) : 390x844 -> 390x480
//      pendant le focus Email : le champ reste ENTIEREMENT visible, zero
//      recouvrement avec le pied, et un tap dans le bas du champ touche LE
//      CHAMP (avant : il validait le recapitulatif). Retour 390x844 : les
//      reperes reviennent au pixel.
//   C. PETIT TELEPHONE + CLAVIER (320x568 -> 320x300, etape 1) : le champ date
//      focalise est tapable (avant : le tap ouvrait la modale sur mesure), et
//      le CTA Continuer est tapable une fois sa zone defilee.
//   D. PAYSAGE (844x390, contact) : les champs et le CTA sont visibles ou
//      atteignables en defilant leur zone (avant : corps a 37px, rien de
//      defilable).
//   D2. PAYSAGE, page venue : le centre du champ date se touche, avant et
//      apres le clavier (844x200). Avant la passe 244 : la sous-barre faisait
//      117px, le defileur 58px, le tap tombait dans le pied puis la sous-barre.
//   E. MODALE SUR MESURE : Envoyer est VISIBLE SANS DEFILER (pied collant) et
//      les deux boutons tiennent le plancher tactile 44px (la regle 40px avait
//      avale un correctif par la cascade).
//   F. WEBKIT : zero debordement horizontal, champ nom stable au focus,
//      Envoyer de la modale visible sans defiler : ce que casse un moteur, l
//      autre ne le voit pas.
//
// Contre-epreuves par MUTATION (edition inverse exacte, jamais git) :
//   (a) soin clavier debranche -> B rougit (champ colle au pied : 49px de
//       reserve au lieu des 90 minimum ; depuis la passe 244 le formulaire
//       raccourci tient dans 480px sans defiler, le tap traversant a disparu) ;
//   (b) sous-barre re-affichee en ecran court -> D2 rougit (clavier ouvert a
//       844x200, le centre du champ date tombe dans la sous-barre ; sans
//       clavier le soin le recentre dans les 58px qui restent, ce controle-la
//       reste un garde, pas un temoin ; l ancienne mutation « CTA re-colle »
//       n avait plus de regle sticky a reveiller depuis la passe 244, le CTA
//       venue est en flux partout : temoin dans tunnel-mobile-v2, m1) ;
//   (c) pied de modale de-colle -> E rougit (Envoyer sous le pli) ;
//   (d) plancher 40px remis -> E rougit (cible sous 44).
//
// Lancement : node scripts/tunnel-mobile-matrix-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium, webkit } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const PORT = Number(process.env.PINLANE_MOBILE_MATRIX_PORT || 4265);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = path.join(ROOT, 'assets', 'app-main.js');
const CSS = path.join(ROOT, 'assets', 'pinlane-client.css');
const DATE = '2026-09-12';

let failures = [];
function ok(cond, id, detail) {
  const good = Boolean(cond);
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${id}${good || !detail ? '' : `  [${detail}]`}`);
  if (!good) failures.push(id);
  return good;
}

// La forme PROD reelle de f1 + activites (meme fixture que les gates visit-*).
function metaPayload() {
  return {
    ok: true, today: DATE, durationOptions: [],
    formules: [{ id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game'], price: 26, type: 'per_pax', minPax: 6, oldPrice: 34, noHolidays: false, hasBowling: true, bowlingDur: 1, notes: [] }],
    activities: [
      { id: 'bowling', name: 'Bowling', planned: true, resourceType: 'bowling_lane', priceType: 'grid_bowling', priceValue: null, pricing: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60, minMinutes: 30, maxMinutes: 180, stepMinutes: 30, note: '', maxPax: null, units: 8, capacityPerUnit: 6, unitIds: ['1', '2'] },
      { id: 'laser_game', name: 'Laser Game', planned: true, resourceType: 'laser_arena', priceType: 'grid_laser', priceValue: null, pricing: null, unitLabel: 'par personne', order: 2, defaultMinutes: 25, minMinutes: 25, maxMinutes: 75, stepMinutes: 25, note: '', maxPax: null, units: null, capacityPerUnit: null, unitIds: [] },
    ],
    center: {
      id: 'libramont', status: 'active',
      defaultSchedule: { regular: { 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: DATE, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/api/public-booking-meta') return json(200, metaPayload());
    if (url.pathname.startsWith('/api/')) return json(200, { ok: true, slots: [], suggestions: [] });
    let filePath = path.resolve(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname)));
    if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function bootTunnel(page, step) {
  await page.goto(`${BASE_URL}/?v=mobile-matrix-${step}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep === 'function', null, { timeout: 15000 });
  await page.evaluate(({ step, date }) => {
    state.view = 'client';
    state.booking.date = date;
    state.booking.pax = 6;
    state.booking.mode = 'formule';
    state.booking.type = 'formule';
    state.booking.formuleId = 'f1';
    setView('client');
    syncBookingTypeUi();
    goStep(step, { animate: false, focus: false });
  }, { step, date: DATE });
  await page.waitForTimeout(450);
  // Les entrees echelonnees du tunnel durent ~440ms : mesurer avant le repos
  // fabrique des derives fantomes de 15-16px (meme lecon que visit-freedom).
  await page.waitForFunction(() => document.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length === 0, null, { timeout: 2000 }).catch(() => {});
}

// Le pas de contact : chez ce tunnel c est l etape qui porte #fName/#fEmail.
async function versContact(page) {
  await bootTunnel(page, 3);
  await page.waitForFunction(() => {
    const el = document.getElementById('fName');
    return Boolean(el && el.getBoundingClientRect().width > 0);
  }, null, { timeout: 8000 }).catch(() => {});
}

const MESURES = {
  reperes: () => {
    const ids = ['fName', 'fEmail', 'btnVenueContinue', 'fDate'];
    const points = {};
    document.querySelectorAll('#clientView .panel-title, #clientView .step-foot, body > header').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) points[`p${i}`] = { x: Math.round(r.x), y: Math.round(r.y) };
    });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) { const r = el.getBoundingClientRect(); if (r.width > 0) points[id] = { x: Math.round(r.x), y: Math.round(r.y) }; }
    }
    return points;
  },
  hit: ({ id, dy = 0 }) => {
    const el = document.getElementById(id);
    if (!el) return { absent: true };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = dy ? r.bottom + dy : r.top + r.height / 2;
    const found = document.elementFromPoint(x, y);
    const self = Boolean(found && (found === el || el.contains(found) || found.contains(el)));
    return { self, rect: { y: Math.round(r.y), b: Math.round(r.bottom) }, autre: self ? '' : (found ? `${found.tagName.toLowerCase()}.${String(found.className).split(' ')[0] || ''}` : 'rien') };
  },
  visible: (id) => {
    const el = document.getElementById(id);
    if (!el) return { absent: true };
    const r = el.getBoundingClientRect();
    return { fully: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0, y: Math.round(r.y), b: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight };
  },
  scrollMax: () => {
    document.querySelectorAll('#clientView *').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 2) el.scrollTop = el.scrollHeight;
    });
  },
  debordement: () => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  // Reserve entre le bas du champ et le haut du pied de l etape courante :
  // ce que le scroll-padding (96px) promet quand le navigateur defile seul.
  degagement: (id) => {
    const el = document.getElementById(id);
    if (!el) return { absent: true };
    const foot = document.querySelector('#clientView .step.is-current .step-foot') || document.querySelector('#clientView .step-foot');
    const r = el.getBoundingClientRect();
    const limite = foot ? foot.getBoundingClientRect().top : window.innerHeight;
    return { reserve: Math.round(limite - r.bottom), bas: Math.round(r.bottom), pied: Math.round(limite) };
  },
};

function delta(avant, apres) {
  let worst = 0;
  for (const k of Object.keys(avant)) {
    if (!apres[k]) continue;
    worst = Math.max(worst, Math.abs(avant[k].x - apres[k].x), Math.abs(avant[k].y - apres[k].y));
  }
  return worst;
}

async function scenariosChromium(browser) {
  // --- A. STABILITE au focus pur -------------------------------------------
  let page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await versContact(page);
  const avantFocus = await page.evaluate(MESURES.reperes);
  await page.evaluate(() => document.getElementById('fName').focus());
  await page.waitForTimeout(450);
  const apresFocus = await page.evaluate(MESURES.reperes);
  ok(delta(avantFocus, apresFocus) <= 2, 'stabilite-focus-pur', `pire derive ${delta(avantFocus, apresFocus)}px`);

  // --- B. CLAVIER Android : 390x844 -> 390x480 sur Email -------------------
  await page.evaluate(() => document.getElementById('fEmail').focus());
  await page.setViewportSize({ width: 390, height: 480 });
  await page.waitForTimeout(600);
  const emailVisible = await page.evaluate(MESURES.visible, 'fEmail');
  ok(emailVisible.fully, 'clavier-champ-visible', JSON.stringify(emailVisible));
  const tapBas = await page.evaluate(MESURES.hit, { id: 'fEmail', dy: -6 });
  ok(tapBas.self, 'clavier-tap-bas-du-champ', `touche ${tapBas.autre || 'le champ'}`);
  // Un champ deja visible dans le viewport retreci n est PAS defile par le
  // navigateur : sans le soin il reste colle au pied (49px mesures a 480),
  // avec le soin (block:center) il garde 167px. On exige la reserve que le
  // scroll-padding promet, que le navigateur ait defile ou non.
  const degage = await page.evaluate(MESURES.degagement, 'fEmail');
  ok(!degage.absent && degage.reserve >= 90, 'clavier-champ-degage-du-pied', JSON.stringify(degage));
  ok(await page.evaluate(MESURES.debordement) === 0, 'clavier-zero-debordement-h');
  await page.evaluate(() => document.getElementById('fEmail').blur());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length === 0, null, { timeout: 2000 }).catch(() => {});
  const apresRetour = await page.evaluate(MESURES.reperes);
  ok(delta(avantFocus, apresRetour) <= 2, 'clavier-retour-au-pixel', `pire residu ${delta(avantFocus, apresRetour)}px`);
  await page.close();

  // --- C. PETIT TELEPHONE + CLAVIER : 320x568 -> 320x300, etape 1 ----------
  page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await bootTunnel(page, 1);
  await page.evaluate(() => { const f = document.getElementById('fDate'); if (f) f.focus(); });
  await page.setViewportSize({ width: 320, height: 300 });
  await page.waitForTimeout(700);
  const dateHit = await page.evaluate(MESURES.hit, { id: 'fDate' });
  ok(dateHit.self, 'court-tap-champ-date', `touche ${dateHit.autre || 'le champ'}`);
  // On defile JUSQU AU CTA (le geste reel), pas au-dela : un scroll force au
  // maximum le glisse sous la barre haute, un etat qu aucun doigt ne produit
  // en s arretant sur le bouton qu il cherche.
  await page.evaluate(() => { const b = document.getElementById('btnVenueContinue'); if (b) b.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(200);
  const ctaHit = await page.evaluate(MESURES.hit, { id: 'btnVenueContinue' });
  ok(ctaHit.self, 'court-tap-cta-apres-defilement', `touche ${ctaHit.autre || 'le CTA'}`);
  await page.close();

  // --- D. PAYSAGE 844x390 : contact atteignable ----------------------------
  page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await versContact(page);
  const atteignable = await page.evaluate(() => {
    const out = {};
    for (const id of ['fName', 'fPhone', 'fEmail']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = 'absent'; continue; }
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      out[id] = r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0 ? 'ok' : `y${Math.round(r.y)}-b${Math.round(r.bottom)}/vh${window.innerHeight}`;
    }
    return out;
  });
  ok(Object.values(atteignable).every((v) => v === 'ok'), 'paysage-champs-atteignables', JSON.stringify(atteignable));
  await page.close();

  // --- D2. PAYSAGE 844x390, page venue : le champ date se touche -----------
  page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await bootTunnel(page, 1);
  await page.evaluate(() => { const f = document.getElementById('fDate'); if (f) f.focus(); });
  await page.waitForTimeout(500);
  const paysageDate = await page.evaluate(MESURES.hit, { id: 'fDate' });
  ok(paysageDate.self, 'paysage-venue-tap-champ-date', `touche ${paysageDate.autre || 'le champ'}`);
  await page.setViewportSize({ width: 844, height: 200 });
  await page.waitForTimeout(700);
  const paysageClavier = await page.evaluate(MESURES.hit, { id: 'fDate' });
  ok(paysageClavier.self, 'paysage-venue-clavier-tap-champ-date', `touche ${paysageClavier.autre || 'le champ'}`);
  await page.close();

  // --- E. MODALE : Envoyer visible SANS defiler + plancher 44 --------------
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await bootTunnel(page, 1);
  await page.evaluate(() => { const b = document.querySelector('.bespoke-entry'); if (b) b.click(); else if (typeof openCustomRequest === 'function') openCustomRequest(); });
  await page.waitForSelector('#crSubmit', { timeout: 8000 });
  await page.waitForTimeout(350);
  const envoyer = await page.evaluate(MESURES.visible, 'crSubmit');
  ok(envoyer.fully, 'modale-envoyer-visible-sans-defiler', JSON.stringify(envoyer));
  ok(envoyer.h >= 44, 'modale-plancher-tactile-44', `hauteur ${envoyer.h}px`);
  await page.close();
}

async function scenariosWebkit(engine) {
  let browser;
  try { browser = await engine.launch({ headless: true }); }
  catch (error) {
    ok(false, 'webkit-lancement', error && error.message && error.message.slice(0, 100));
    return;
  }
  try {
    for (const [w, h] of [[390, 844], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await versContact(page);
      ok(await page.evaluate(MESURES.debordement) === 0, `webkit-${w}x${h}-zero-debordement`);
      const avant = await page.evaluate(MESURES.reperes);
      await page.evaluate(() => document.getElementById('fName').focus());
      await page.waitForTimeout(450);
      const apres = await page.evaluate(MESURES.reperes);
      ok(delta(avant, apres) <= 2, `webkit-${w}x${h}-stabilite-focus`, `pire derive ${delta(avant, apres)}px`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await bootTunnel(page, 1);
    await page.evaluate(() => { const b = document.querySelector('.bespoke-entry'); if (b) b.click(); else if (typeof openCustomRequest === 'function') openCustomRequest(); });
    await page.waitForSelector('#crSubmit', { timeout: 8000 });
    await page.waitForTimeout(350);
    const envoyer = await page.evaluate(MESURES.visible, 'crSubmit');
    ok(envoyer.fully && envoyer.h >= 44, 'webkit-modale-envoyer-visible-44', JSON.stringify(envoyer));
    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runSuite() {
  failures = [];
  const server = await serveStatic();
  const edge = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    await scenariosChromium(edge);
    await scenariosWebkit(webkit);
  } catch (error) {
    ok(false, 'suite-exception', error && error.message);
  } finally {
    await edge.close().catch(() => {});
    server.close();
  }
  return failures.slice();
}

function applyEdit(file, find, replace) {
  const src = fs.readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const f = find.split('\n').join(eol);
  const r = replace.split('\n').join(eol);
  const count = src.split(f).length - 1;
  if (count !== 1) throw new Error(`ancre introuvable ou non unique (${count}) : ${find.slice(0, 60)}`);
  fs.writeFileSync(file, src.split(f).join(r));
}

const MUTATIONS = [
  {
    name: 'soin clavier debranche',
    file: APP,
    find: '  bindCardTilt();\n  bindKeyboardCare();',
    replace: '  bindCardTilt();\n  void 0;',
    // Chromium ne defile pas un champ deja visible dans le viewport retreci :
    // sans le soin, Email reste a 49px du pied ; le soin le centre (167px).
    expect: 'clavier-champ-degage-du-pied',
  },
  {
    name: 'sous-barre re-affichee en ecran court',
    file: CSS,
    // Les deux lignes ensemble : la premiere existe aussi sous 640px.
    find: "  #clientView:not([data-step='5']) .tunnel-underbar { display: none; }\n  #clientView #step1.is-solo .step-foot { display: none; }",
    replace: '  /* mutation contre-epreuve */',
    expect: 'paysage-venue-clavier-tap-champ-date',
  },
  {
    name: 'pied de modale de-colle',
    file: CSS,
    find: '  position: sticky;\n  bottom: 0;\n  z-index: 2;\n  margin-left: -24px;',
    replace: '  z-index: 2;\n  margin-left: -24px;',
    expect: 'modale-envoyer-visible-sans-defiler',
  },
  {
    name: 'plancher 40px remis',
    file: CSS,
    find: '.bespoke-modal .cr-actions .btn-primary,\n.bespoke-modal .cr-actions .btn-secondary {\n  min-height: 44px;',
    replace: '.bespoke-modal .cr-actions .btn-primary,\n.bespoke-modal .cr-actions .btn-secondary {\n  min-height: 40px;',
    expect: 'modale-plancher-tactile-44',
  },
];

(async () => {
  console.log('--- passe 1 : gate nominal ---');
  const base = await runSuite();
  if (base.length) {
    console.error(`tunnel-mobile-matrix-check: ROUGE en nominal (${base.join(', ')})`);
    process.exit(1);
  }

  for (const m of MUTATIONS) {
    console.log(`--- contre-preuve par mutation : ${m.name} ---`);
    const original = fs.readFileSync(m.file, 'utf8');
    applyEdit(m.file, m.find, m.replace);
    let red;
    try { red = await runSuite(); }
    finally { fs.writeFileSync(m.file, original); }
    if (fs.readFileSync(m.file, 'utf8') !== original) {
      console.error('tunnel-mobile-matrix-check: restauration ratee');
      process.exit(1);
    }
    if (!red.includes(m.expect)) {
      console.error(`tunnel-mobile-matrix-check: la mutation "${m.name}" devait faire rougir "${m.expect}" ; rouges : ${red.join(', ') || 'aucun'}`);
      process.exit(1);
    }
    console.log(`mutation detectee ("${m.expect}" ROUGE), fichier restaure a l identique`);
  }

  console.log('--- passe finale : nominal apres restauration ---');
  const finale = await runSuite();
  if (finale.length) {
    console.error(`tunnel-mobile-matrix-check: ROUGE apres restauration (${finale.join(', ')})`);
    process.exit(1);
  }
  console.log('\ntunnel-mobile-matrix-check: ALL OK (stabilite au focus, clavier, ecran court, paysage, modale, WebKit ; 4 contre-preuves par mutation)');
})();
