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
//   6. les boutons se comportent pareil
//
// DEPUIS LE 2026-10-01 (cartes de groupe a la caisse), la carte n offre que le
// geste du moment : « Arrivé » tant que le groupe n est pas la, puis
// « Carte » / « Espèces » pour encaisser (le moyen part avec le statut).
// « Confirmé » (revenir en arriere) vit dans la fiche. Les regles mesurees
// sont les memes : un clic, un redessin, aucun message, bascule immediate.
//
// Usage : node scripts/status-toggle-check.js
// Contre-epreuve sur le vrai code : STATUS_TOGGLE_CASSE=annulation sert une
// console dont l echec ne remet plus l etat d avant ; le point 5 doit ROUGIR
// (prouve le 2026-09-29 : rouge 6 tours sur 6, vert 8 sur 8 sans la casse).
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
      if (process.env.STATUS_TOGGLE_CASSE === 'annulation' && url.pathname === '/assets/app-main.js') {
        const src = content.toString('utf8');
        // L annulation DU STATUT (la meme ligne existe ailleurs) : la derniere
        // avant le message « Impossible de mettre a jour le statut ».
        const ligne = 'applyOptimisticReservation(error.reservation || current, { preserveEditState: true });';
        const message = "toast(error.message || 'Impossible de mettre à jour le statut.');";
        const iMessage = src.indexOf(message);
        const iLigne = iMessage >= 0 ? src.lastIndexOf(ligne, iMessage) : -1;
        const entre = iLigne >= 0 ? src.slice(iLigne + ligne.length, iMessage).replace(/\s+/g, ' ').trim() : '';
        if (src.split(message).length !== 2 || iLigne < 0 || entre !== 'clearReservationMutation(id);') {
          console.error('status-toggle-check : la casse « annulation » ne trouve pas son ancre (le code a change ?)');
          process.exit(2);
        }
        content = Buffer.from(src.slice(0, iLigne) + 'void 0;' + src.slice(iLigne + ligne.length), 'utf8');
      }
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
//
// L ECHO EST RETENU PENDANT LA MESURE (2026-09-29). Le gate lisait l etat
// « avant l echo » 60 ms apres le clic, en pariant que les 300 ms simulees
// n etaient pas encore ecoulees. Le soir, sur une machine chargee, le clic
// lui-meme (defilement, attente de stabilite) en prenait davantage : l echo
// etait deja revenu, la contre-epreuve lisait 2 redessins « avant l echo » et
// l echec serveur se lisait sur un etat encore en vol. Le meme rouge a 2 tours
// sur 5 sur le code d avant le bureau des demandes : un pari sur l horloge,
// pas un defaut du produit. Desormais `retenir` garde la reponse jusqu a ce
// que le gate la LIBERE, puis le gate attend qu elle soit traitee :
// l ordre est garanti, quelle que soit la vitesse de la machine.
//
// ET LE FAUX SERVEUR GARDE CE QU IL A ACCEPTE. Il renvoyait un echo sans rien
// retenir : le releve suivant de la console (/api/staff-state) rendait le jeu
// de depart. Apres un echec, la console lache sa protection et reprend la
// verite du serveur au releve suivant, ce qui est juste : en prod, le statut
// ecrit juste avant y est. Ici, ce releve ramenait le statut d AVANT les
// clics precedents, et « sur echec, le statut revient » lisait « pending ».
// Un PATCH reussi est donc garde (`persistes`) et chaque releve le rend.
// Pendant une mesure, les releves sont GELES (`gelerReleves`) : sinon un
// releve tombe au bon moment remettait le bon statut A LA PLACE de
// l annulation, et une console sans annulation passait le gate un tour sur
// deux.
async function installStatusPatchMock(page) {
  await page.addInitScript(() => {
    window.__QA_PATCH__ = { mode: 'echo', delayMs: 300, calls: 0, retenir: false, enAttente: [], repondus: 0, persistes: {}, gelerReleves: false, relevesGeles: [] };
    const upstream = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-state' && method === 'GET') {
        if (window.__QA_PATCH__.gelerReleves) await new Promise((r) => { window.__QA_PATCH__.relevesGeles.push(r); });
        const res = await upstream(input, init);
        const gardes = window.__QA_PATCH__.persistes;
        if (!Object.keys(gardes).length) return res;
        const j = await res.clone().json().catch(() => null);
        if (!j || !Array.isArray(j.reservations)) return res;
        j.reservations = j.reservations.map((r) => (gardes[r.id] ? { ...r, ...gardes[r.id] } : r));
        return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
      }
      if (u.pathname === '/api/staff-reservations' && method === 'PATCH') {
        const cfg = window.__QA_PATCH__;
        cfg.calls += 1;
        const body = JSON.parse(init.body || '{}');
        if (cfg.retenir) await new Promise((r) => { cfg.enAttente.push(r); });
        else await new Promise((r) => setTimeout(r, cfg.delayMs));
        cfg.repondus += 1;
        if (cfg.mode === 'fail') {
          return new Response(JSON.stringify({ ok: false, error: 'Serveur indisponible.' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        const reservation = { ...body, updatedAt: new Date().toISOString() };
        // Contre-epreuve : l'echo change une valeur qui SE DESSINE (l'effectif).
        if (cfg.mode === 'echo-changed') reservation.pax = (Number(body.pax) || 0) + 3;
        if (reservation.id != null) {
          cfg.persistes[reservation.id] = Object.fromEntries(Object.entries({ status: reservation.status, paymentMethod: reservation.paymentMethod, pax: reservation.pax, updatedAt: reservation.updatedAt }).filter(([, v]) => v !== undefined));
        }
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

async function gelerReleves(page) {
  await page.evaluate(() => { window.__QA_PATCH__.gelerReleves = true; });
}
async function degelerReleves(page) {
  await page.evaluate(() => { const cfg = window.__QA_PATCH__; cfg.gelerReleves = false; cfg.relevesGeles.splice(0).forEach((r) => r()); });
  await page.waitForTimeout(150);
}

async function retenirEcho(page) {
  await page.evaluate(() => { window.__QA_PATCH__.retenir = true; });
}
// Libere les echos retenus (apres avoir vu partir la requete : un clic sans
// PATCH ne se libere pas, il echoue ici), attend qu ils soient tous rendus a la
// page, puis laisse la page les traiter (la lecture du JSON, puis le rendu).
async function libererEcho(page) {
  await page.waitForFunction(() => window.__QA_PATCH__.enAttente.length > 0, null, { timeout: 5000 });
  await page.evaluate(() => {
    const cfg = window.__QA_PATCH__;
    cfg.retenir = false;
    cfg.enAttente.splice(0).forEach((r) => r());
  });
  await page.waitForFunction(() => window.__QA_PATCH__.repondus >= window.__QA_PATCH__.calls, null, { timeout: 10000 });
  await page.evaluate(() => new Promise((r) => setTimeout(() => setTimeout(r, 50), 0)));
  await page.waitForTimeout(150);
}

// LA LISTE AU REPOS AVANT CHAQUE MESURE. Le chargement de la console (la
// configuration du centre, le premier releve) peut encore redessiner la liste
// juste apres le demarrage : compte dans la mesure du premier clic, ce redessin
// se lisait « 3 redessins au clic ». On attend 800 ms sans aucun redessin.
async function attendreCalme(page) {
  for (let k = 0; k < 12; k += 1) {
    const avant = await page.evaluate(() => window.__QA_COUNT__.domWrites);
    await page.waitForTimeout(800);
    if ((await page.evaluate(() => window.__QA_COUNT__.domWrites)) === avant) return true;
  }
  return false;
}

async function resetCounters(page) {
  await page.evaluate(() => { window.__QA_COUNT__.renders = 0; window.__QA_COUNT__.domWrites = 0; window.__QA_COUNT__.toasts = 0; window.__QA_COUNT__.toastTexts = []; });
}

async function counters(page) { return page.evaluate(() => ({ ...window.__QA_COUNT__ })); }

// Choisit une ligne VISIBLE dont le statut n'est PAS deja celui qu'on va
// cliquer : cliquer « Arrive » sur un dossier deja arrive ne fait rien changer,
// donc ne prouve rien. Le gate le faisait, et lisait 0 redessin la ou il n'y
// avait tout simplement rien a redessiner.
// Le bouton qui pose ce statut sur une carte : « Arrivé », ou « Espèces »
// pour payer.
const BOUTON = { arrived: 'Arrivé', paid: 'Espèces' };
async function choisirLigne(page, statutCible) {
  return page.evaluate(({ cible, libelle }) => {
    const rows = [...document.querySelectorAll('#resList .res-row')];
    for (const row of rows) {
      const id = Number((row.getAttribute('onclick') || '').match(/openPos\((\d+)\)/)?.[1]);
      const r = state.reservations.find((x) => Number(x.id) === id);
      const offre = [...row.querySelectorAll('.gc-actions button')].some((b) => b.textContent.trim() === libelle);
      if (r && r.status !== cible && offre) return { id, statutAvant: r.status };
    }
    return null;
  }, { cible: statutCible, libelle: BOUTON[statutCible] });
}

// Clique le bouton d'etat DE CETTE LIGNE-LA, pour de vrai (souris, pas d'appel
// de fonction), et rend l'etat mesure juste apres le clic - avant que l'echo
// serveur ait pu revenir. La ligne change de section au re-rendu : on la
// retrouve par son identifiant, jamais par sa position.
async function cliqueEtat(page, id, libelle, statut) {
  const bouton = page.locator(`#resList .res-row[onclick="openPos(${id})"] .gc-actions button`, { hasText: libelle }).first();
  await bouton.click();
  await page.waitForTimeout(60);
  return page.evaluate(({ resId, cible }) => {
    const row = document.querySelector(`#resList .res-row[onclick="openPos(${resId})"]`);
    const r = state.reservations.find((x) => Number(x.id) === resId);
    // La carte DIT le nouvel etat : arrive, elle propose d encaisser ; payee,
    // son prix porte « Payé ».
    const ditLEtat = !!row && (cible === 'paid'
      ? !!row.querySelector('.gc-price .is-paid')
      : [...row.querySelectorAll('.gc-actions button')].some((b) => b.textContent.trim() === 'Carte'));
    return { actifImmediat: Boolean(r && r.status === cible && ditLEtat), trouvee: !!row };
  }, { resId: id, cible: statut });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    // La page vit le jour joue, a 13:00 : des groupes a venir (Arrivé), des
    // groupes la (Carte / Espèces). Sur une date passee, la carte n offre plus
    // « Arrivé » : un groupe fini ne se pointe pas, il s encaisse.
    await page.clock.install({ time: new Date('2026-07-18T13:00:00') });
    await installMock(page);
    await installStatusPatchMock(page);
    await page.goto(`${BASE_URL}/?v=status-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.setReservationStatusDirect === 'function', null, { timeout: 15000 });
    await bootStaff(page);
    await armCounters(page);

    const lignes = await page.locator('#resList .res-row').count();
    ok(lignes > 0, `la liste du jour est peuplee (${lignes} lignes)`);

    console.log('\n[1] UN CLIC = UN SEUL REDESSIN, ZERO MESSAGE');
    for (const [vrai, statut] of [['Arrivé', 'arrived'], ['Espèces', 'paid']]) {
      const ligne = await choisirLigne(page, statut);
      if (!ok(!!ligne, `« ${vrai} » : une ligne a basculer existe`)) continue;
      ok(await attendreCalme(page), `« ${vrai} » : la liste est au repos avant le clic`);
      await gelerReleves(page);
      await resetCounters(page);
      await retenirEcho(page);
      const immediat = await cliqueEtat(page, ligne.id, vrai, statut);
      ok(immediat.actifImmediat, `« ${vrai} » : la bascule est immediate (dossier ${ligne.id}, « ${ligne.statutAvant} » avant), avant la reponse serveur`);
      const pendant = await counters(page);
      ok(pendant.domWrites === 1, `« ${vrai} » : 1 redessin au clic (mesure ${pendant.domWrites})`);
      // L echo revient, et la page l a traite.
      await libererEcho(page);
      const apres = await counters(page);
      ok(apres.domWrites === 1, `« ${vrai} » : TOUJOURS 1 redessin apres l'echo serveur (mesure ${apres.domWrites})`);
      ok(apres.renders === 1, `« ${vrai} » : renderStaffData appele une seule fois (mesure ${apres.renders})`);
      ok(apres.toasts === 0, `« ${vrai} » : aucun message de succes (mesure ${apres.toasts} : ${apres.toastTexts.join(' | ') || 'aucun'})`);
      await degelerReleves(page);
    }

    console.log("\n[2] L'ECHO SERVEUR PORTE BIEN UN updatedAt NEUF (sinon le test [1] ne teste rien)");
    const echo = await page.evaluate(async () => {
      const res = await fetch('/api/staff-reservations', { method: 'PATCH', body: JSON.stringify({ id: 1, pax: 4, updatedAt: '2000-01-01T00:00:00.000Z' }) });
      const payload = await res.json();
      return payload.reservation.updatedAt;
    });
    ok(echo !== '2000-01-01T00:00:00.000Z' && String(echo).startsWith('20'), `le faux serveur renvoie un updatedAt neuf (${echo})`);
    const appels = await page.evaluate(() => window.__QA_PATCH__.calls);
    ok(appels >= 3, `le PATCH a bien ete emis a chaque clic (${appels} appels)`);

    console.log("\n[3] CONTRE-EPREUVE : UN ECHO QUI CHANGE UNE VALEUR VISIBLE REDESSINE, LUI");
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'echo-changed'; });
    const ligne3 = await choisirLigne(page, 'arrived');
    ok(!!ligne3, 'une ligne a basculer existe pour la contre-epreuve');
    ok(await attendreCalme(page), 'la liste est au repos avant le clic de la contre-epreuve');
    await gelerReleves(page);
    await resetCounters(page);
    const paxAvant = await page.evaluate((id) => Number(state.reservations.find((r) => Number(r.id) === id).pax), ligne3.id);
    await retenirEcho(page);
    await cliqueEtat(page, ligne3.id, 'Arrivé', 'arrived');
    const pendant2 = await counters(page);
    ok(pendant2.domWrites === 1, `avant l'echo : 1 redessin (mesure ${pendant2.domWrites})`);
    await libererEcho(page);
    const apres2 = await counters(page);
    ok(apres2.domWrites === 2, `apres un echo qui change l'effectif : 2 redessins (mesure ${apres2.domWrites}) - la garde n'est donc pas un « ne rien redessiner jamais »`);
    ok(paxAvant > 0, `l'effectif de depart etait bien lu (${paxAvant})`);
    await degelerReleves(page);

    console.log('\n[4] ECHEC SERVEUR : L\'ETAT REVIENT EN ARRIERE, AVEC UN MESSAGE');
    await page.evaluate(() => { window.__QA_PATCH__.mode = 'fail'; });
    const cible = await page.evaluate(() => {
      const row = document.querySelector('#resList .res-row');
      const id = Number(row.getAttribute('onclick').match(/openPos\((\d+)\)/)[1]);
      return { id, statut: state.reservations.find((r) => Number(r.id) === id).status };
    });
    await gelerReleves(page);
    await resetCounters(page);
    await retenirEcho(page);
    await page.evaluate((id) => { const s = state.reservations.find((r) => Number(r.id) === id).status; window.setReservationStatusDirect(id, s === 'paid' ? 'pending' : 'paid'); }, cible.id);
    await libererEcho(page);
    const apres3 = await counters(page);
    const statutFinal = await page.evaluate((id) => state.reservations.find((r) => Number(r.id) === id).status, cible.id);
    await degelerReleves(page);
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
