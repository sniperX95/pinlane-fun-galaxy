// Gate Playwright - LES BOUTONS D'ETAT (Confirme / Arrive / Paye).
//
// Pourquoi ce gate existe. Verbatim Movsar : « quand on clique sur Arrive,
// Paye ou Confirme, ca fait quelque chose, puis il y a un deuxieme check avec
// un message et ca rafraichit, donc ca fait comme si on avait appuye deux fois,
// c'est pas pro visuellement. »
//
// La cause n'etait pas le rendu optimiste, elle etait dans ce qu'on comparait.
// `setReservationStatusDirect` peignait l'etat tout de suite (1er rendu), puis
// l'echo serveur arrivait ~300 ms plus tard avec un `updatedAt` NEUF. Ce champ
// ne se dessine nulle part, mais il etait dans la signature qui decide du
// re-rendu : la liste entiere se redessinait une DEUXIEME fois pour un ecran
// rigoureusement identique, et un message venait par-dessus. Trois signaux
// pour une action.
//
// CE QU'IL PROUVE, EN CLIQUANT POUR DE VRAI :
//   1. un clic = UN SEUL redessin de la liste, et zero message de succes
//   2. la bascule est IMMEDIATE (le bouton est actif avant la reponse serveur)
//   3. l'echo serveur qui ne change QUE `updatedAt` ne redessine rien
//   4. contre-epreuve : un echo qui change une valeur VISIBLE redessine bien
//      (sinon « 0 redessin » voudrait dire « l'ecran ne se met jamais a jour »)
//   5. echec serveur : l'etat revient en arriere ET un message d'erreur sort
//   6. les trois boutons se comportent pareil
//
// Usage : node scripts/status-toggle-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_STATUS_PORT || 4211);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
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

// Une seule definition du faux centre et du faux jeu de reservations pour toute
// la console : celle du gate matrice. La dupliquer, ce serait deux verites qui
// divergent au premier changement de contrat. (Meme extraction que
// scripts/reservation-sheet-check.js, fins de ligne normalisees d'abord :
// selon core.autocrlf le fichier arrive en LF ou en CRLF et un marqueur ecrit
// en LF ne se trouve alors nulle part.)
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const matrixSrc = fs.readFileSync(path.join(__dirname, 'planning-matrix-check.js'), 'utf8').split(CRLF).join(LF);
const installMockSrc = matrixSrc.slice(
  matrixSrc.indexOf('async function installMock'),
  matrixSrc.indexOf("// ---------------------------------------------------------------------------\n// L'AUDITEUR"),
);
// eslint-disable-next-line no-eval
const installMock = eval(`(${installMockSrc.replace('async function installMock', 'async function')})`);

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// LE FAUX SERVEUR DE STATUT. Il imite ce que fait la prod sur un PATCH de
// statut : il repond en ~300 ms (le delai que Movsar voit), et son echo porte
// un `updatedAt` NEUF a chaque fois. C'est exactement la charge utile qui
// declenchait le deuxieme rendu. `window.__QA_PATCH__.mode` pilote le scenario.
async function installStatusPatchMock(page) {
  await page.addInitScript(() => {
    window.__QA_PATCH__ = { mode: 'echo', delayMs: 300, calls: 0 };
    const upstream = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-reservations' && method === 'PATCH') {
        const cfg = window.__QA_PATCH__;
        cfg.calls += 1;
        const body = JSON.parse(init.body || '{}');
        await new Promise((r) => setTimeout(r, cfg.delayMs));
        if (cfg.mode === 'fail') {
          return new Response(JSON.stringify({ ok: false, error: 'Serveur indisponible.' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        const reservation = { ...body, updatedAt: new Date().toISOString() };
        // Contre-epreuve : l'echo change une valeur qui SE DESSINE (l'effectif).
        if (cfg.mode === 'echo-changed') reservation.pax = (Number(body.pax) || 0) + 3;
        return new Response(JSON.stringify({ ok: true, reservation, automation: { communications: 0, jobs: 0, refreshed: false } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return upstream(input, init);
    };
  });
}

async function bootStaff(page) {
  await page.evaluate(async () => {
    window.__LANE_COUNT__ = 8;
    const d = '2026-07-18';
    state.currentDate = d;
    state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'bowling';
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.reservations = window.__QA_BUILD__(d);
    state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 20)); }
    await loadStaffCenterConfig(true);
    renderStaff();
  });
  await page.waitForTimeout(260);
}

// LE COMPTEUR. Deux mesures independantes du meme fait, parce qu'une seule
// pourrait mentir : (a) le nombre d'appels a renderStaffData, (b) le nombre de
// fois ou le DOM de la liste `#resList` est REELLEMENT remplace, observe par un
// MutationObserver. Un « redessin » que l'utilisateur voit, c'est (b).
async function armCounters(page) {
  await page.evaluate(() => {
    window.__QA_COUNT__ = { renders: 0, domWrites: 0, toasts: 0, toastTexts: [] };
    const nativeRender = window.renderStaffData;
    window.renderStaffData = function (...args) { window.__QA_COUNT__.renders += 1; return nativeRender.apply(this, args); };
    const nativeToast = window.toast;
    window.toast = function (msg, ...rest) { window.__QA_COUNT__.toasts += 1; window.__QA_COUNT__.toastTexts.push(String(msg)); return nativeToast.call(this, msg, ...rest); };
    const list = document.getElementById('resList');
    window.__QA_OBS__ = new MutationObserver((records) => {
      // `innerHTML = …` produit UNE salve de mutations sur le conteneur lui-meme
      // (retrait des anciens noeuds + ajout des nouveaux). On compte les salves,
      // pas les enregistrements : sinon un seul rendu se lirait comme dix.
      if (records.some((r) => r.target === list && r.type === 'childList' && r.addedNodes.length)) {
        window.__QA_COUNT__.domWrites += 1;
      }
    });
    window.__QA_OBS__.observe(list, { childList: true, subtree: false });
  });
}

async function resetCounters(page) {
  await page.evaluate(() => { window.__QA_COUNT__.renders = 0; window.__QA_COUNT__.domWrites = 0; window.__QA_COUNT__.toasts = 0; window.__QA_COUNT__.toastTexts = []; });
}

async function counters(page) { return page.evaluate(() => ({ ...window.__QA_COUNT__ })); }

// Choisit une ligne VISIBLE dont le statut n'est PAS deja celui qu'on va
// cliquer : cliquer « Arrive » sur un dossier deja arrive ne fait rien changer,
// donc ne prouve rien. Le gate le faisait, et lisait 0 redessin la ou il n'y
// avait tout simplement rien a redessiner.
async function choisirLigne(page, statutCible) {
  return page.evaluate((cible) => {
    const rows = [...document.querySelectorAll('#resList .res-row')];
    for (const row of rows) {
      const id = Number((row.getAttribute('onclick') || '').match(/openPos\((\d+)\)/)?.[1]);
      const r = state.reservations.find((x) => Number(x.id) === id);
      if (r && r.status !== cible) return { id, statutAvant: r.status };
    }
    return null;
  }, statutCible);
}

// Clique le bouton d'etat DE CETTE LIGNE-LA, pour de vrai (souris, pas d'appel
// de fonction), et rend l'etat mesure juste apres le clic - avant que l'echo
// serveur ait pu revenir. La ligne change de section au re-rendu : on la
// retrouve par son identifiant, jamais par sa position.
async function cliqueEtat(page, id, libelle) {
  const bouton = page.locator(`#resList .res-row[onclick="openPos(${id})"] .res-status-btn`, { hasText: libelle }).first();
  await bouton.scrollIntoViewIfNeeded();
  await bouton.click();
  await page.waitForTimeout(60);
  return page.evaluate(({ resId, lib }) => {
    const row = document.querySelector(`#resList .res-row[onclick="openPos(${resId})"]`);
    const btn = row ? [...row.querySelectorAll('.res-status-btn')].find((b) => b.textContent.trim() === lib) : null;
    return { actifImmediat: !!(btn && btn.classList.contains('active')), trouvee: !!row };
  }, { resId: id, lib: libelle });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    await installMock(page);
    await installStatusPatchMock(page);
    await page.goto(`${BASE_URL}/?v=status-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.setReservationStatusDirect === 'function', null, { timeout: 15000 });
    await bootStaff(page);
    await armCounters(page);

    const lignes = await page.locator('#resList .res-row').count();
    ok(lignes > 0, `la liste du jour est peuplee (${lignes} lignes)`);

    console.log('\n[1] UN CLIC = UN SEUL REDESSIN, ZERO MESSAGE');
    for (const [vrai, statut] of [['Arrivé', 'arrived'], ['Payé', 'paid'], ['Confirmé', 'pending']]) {
      const ligne = await choisirLigne(page, statut);
      if (!ok(!!ligne, `« ${vrai} » : une ligne a basculer existe`)) continue;
      await resetCounters(page);
      const immediat = await cliqueEtat(page, ligne.id, vrai);
      ok(immediat.actifImmediat, `« ${vrai} » : la bascule est immediate (dossier ${ligne.id}, « ${ligne.statutAvant} » avant), avant la reponse serveur`);
      const pendant = await counters(page);
      ok(pendant.domWrites === 1, `« ${vrai} » : 1 redessin au clic (mesure ${pendant.domWrites})`);
      // On laisse l'echo serveur revenir largement (300 ms de latence simulee).
      await page.waitForTimeout(900);
      const apres = await counters(page);
      ok(apres.domWrites === 1, `« ${vrai} » : TOUJOURS 1 redessin apres l'echo serveur (mesure ${apres.domWrites})`);
      ok(apres.renders === 1, `« ${vrai} » : renderStaffData appele une seule fois (mesure ${apres.renders})`);
      ok(apres.toasts === 0, `« ${vrai} » : aucun message de succes (mesure ${apres.toasts} : ${apres.toastTexts.join(' | ') || 'aucun'})`);
    }

    console.log("\n[2] L'ECHO SERVEUR PORTE BIEN UN updatedAt NEUF (sinon le test [1] ne teste rien)");
    const echo = await page.evaluate(async () => {
      const res = await fetch('/api/staff-reservations', { method: 'PATCH', body: JSON.stringify({ id: 1, pax: 4, updatedAt: '2000-01-01T00:00:00.000Z' }) });
      const payload = await res.json();
      return payload.reservation.updatedAt;
    });
    ok(echo !== '2000-01-01T00:00:00.000Z' && String(echo).startsWith('20'), `le faux serveur renvoie un updatedAt neuf (${echo})`);
    const appels = await page.evaluate(() => window.__QA_PATCH__.calls);
    ok(appels >= 4, `le PATCH a bien ete emis a chaque clic (${appels} appels)`);

    console.log("\n[3] CONTRE-EPREUVE : UN ECHO QUI CHANGE UNE VALEUR VISIBLE REDESSINE, LUI");
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'echo-changed'; });
    const ligne3 = await choisirLigne(page, 'arrived');
    ok(!!ligne3, 'une ligne a basculer existe pour la contre-epreuve');
    await resetCounters(page);
    const paxAvant = await page.evaluate((id) => Number(state.reservations.find((r) => Number(r.id) === id).pax), ligne3.id);
    await cliqueEtat(page, ligne3.id, 'Arrivé');
    const pendant2 = await counters(page);
    ok(pendant2.domWrites === 1, `avant l'echo : 1 redessin (mesure ${pendant2.domWrites})`);
    await page.waitForTimeout(900);
    const apres2 = await counters(page);
    ok(apres2.domWrites === 2, `apres un echo qui change l'effectif : 2 redessins (mesure ${apres2.domWrites}) - la garde n'est donc pas un « ne rien redessiner jamais »`);
    ok(paxAvant > 0, `l'effectif de depart etait bien lu (${paxAvant})`);

    console.log('\n[4] ECHEC SERVEUR : L\'ETAT REVIENT EN ARRIERE, AVEC UN MESSAGE');
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'fail'; });
    const cible = await page.evaluate(() => {
      const row = document.querySelector('#resList .res-row');
      const id = Number(row.getAttribute('onclick').match(/openPos\((\d+)\)/)[1]);
      return { id, statut: state.reservations.find((r) => Number(r.id) === id).status };
    });
    await resetCounters(page);
    await page.evaluate((id) => { const s = state.reservations.find((r) => Number(r.id) === id).status; window.setReservationStatusDirect(id, s === 'paid' ? 'pending' : 'paid'); }, cible.id);
    await page.waitForTimeout(1000);
    const apres3 = await counters(page);
    const statutFinal = await page.evaluate((id) => state.reservations.find((r) => Number(r.id) === id).status, cible.id);
    ok(statutFinal === cible.statut, `sur echec, le statut est revenu a « ${cible.statut} » (mesure « ${statutFinal} »)`);
    ok(apres3.toasts === 1, `sur echec, exactement 1 message (mesure ${apres3.toasts} : ${apres3.toastTexts.join(' | ') || 'aucun'})`);
    ok(/indisponible|impossible/i.test(apres3.toastTexts.join(' ')), 'le message d\'echec dit ce qui s\'est passe');

    console.log('\n[5] CONTRE-EPREUVES PAR MUTATION (ces 3 lignes DOIVENT etre FAIL)');
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'echo'; });
    await resetCounters(page);
    await page.evaluate(() => { window.__QA_COUNT__.domWrites = 2; window.__QA_COUNT__.toasts = 1; });
    const mute = await counters(page);
    ok(mute.domWrites === 1, 'MUTATION domWrites=2 lu comme 1 (doit echouer)');
    ok(mute.toasts === 0, 'MUTATION toasts=1 lu comme 0 (doit echouer)');
    ok(mute.renders === 99, 'MUTATION renders lu comme 99 (doit echouer)');
    const attendusEnMutation = 3;

    ok(errs.length === 0, `aucune erreur console (${errs.length}${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''})`);

    const reels = failures - attendusEnMutation;
    console.log(`\n${reels === 0 ? 'ok  ' : 'FAIL'}  BILAN : ${reels} echec(s) reel(s), ${attendusEnMutation} FAIL attendus en contre-epreuve`);
    await browser.close();
    server.close();
    process.exit(reels === 0 ? 0 : 1);
  } catch (error) {
    console.error('FAIL  ' + (error && error.stack ? error.stack : error));
    try { await browser.close(); } catch (e) { /* deja ferme */ }
    server.close();
    process.exit(1);
  }
}

main();
