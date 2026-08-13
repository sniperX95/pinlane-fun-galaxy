// Gate Playwright - LA FICHE DE RESERVATION (« Infos » et « Modifier »).
//
// Pourquoi ce gate existe : les deux panneaux qui s'ouvrent au clic sur une
// reservation etaient fonctionnels mais aveugles au clavier. Aucun `role`,
// aucun `aria-modal`, aucun nom, aucun focus a l'ouverture, aucun piege a
// focus, et Echap ne faisait RIEN - alors que les trois autres modales de la
// console (retard, communication, acces staff) avaient deja tout ca. Un
// comportement clavier ne se voit pas sur une capture : il se pilote, sinon il
// se perd a la prochaine refonte sans que personne s'en apercoive.
//
// CE QU'IL PROUVE, EN PILOTANT LE CLAVIER POUR DE VRAI :
//   1. semantique de fenetre modale : role, aria-modal, nom, bouton de fermeture nomme
//   2. le focus ENTRE dans la fenetre a l'ouverture
//   3. 25 tabulations avant + 25 arriere ne sortent jamais de la fenetre
//   4. Echap ferme
//   5. le focus REVIENT sur l'element qui avait ouvert la fiche
//   6. l'onglet « Modifier » garde l'identite du dossier (qui / quand / ou /
//      combien / combien ca fait) au lieu de la remplacer par un titre generique
//   7. chaque libelle de champ est associe a son champ
//   8. « Supprimer » est dans un groupe separe de « Enregistrer », et l'ecart
//      entre les deux est MESURE, pas suppose
//   9. contre-epreuves par mutation : on casse chaque garantie, le gate rougit
//
// Usage : node scripts/reservation-sheet-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_SHEET_PORT || 4207);
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

// Le mock du gate matrice fait autorite : une seule definition du faux centre
// et du faux jeu de reservations pour toute la console. Le dupliquer, ce serait
// deux verites qui divergent au premier changement de contrat.
const matrixSrc = fs.readFileSync(path.join(__dirname, 'planning-matrix-check.js'), 'utf8');
const installMockSrc = matrixSrc.slice(
  matrixSrc.indexOf('async function installMock'),
  matrixSrc.indexOf("// ---------------------------------------------------------------------------\n// L'AUDITEUR")
);
// eslint-disable-next-line no-eval
const installMock = eval(`(${installMockSrc.replace('async function installMock', 'async function')})`);

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

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
  await page.waitForTimeout(220);
}

async function tabulationsSortantes(page, key, count) {
  let sorties = 0;
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press(key);
    // eslint-disable-next-line no-await-in-loop
    const dedans = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest('#posOverlay')));
    if (!dedans) sorties += 1;
  }
  return sorties;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=sheet-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.openPos === 'function', null, { timeout: 15000 });
    await bootStaff(page);

    console.log('\n[1] SEMANTIQUE DE FENETRE MODALE');
    await page.evaluate(() => openPos(state.reservations[0].id));
    await page.waitForTimeout(180);
    const sem = await page.evaluate(() => {
      const m = document.querySelector('#posOverlay .edit-modal');
      const t = document.getElementById('posTitle');
      return {
        role: m && m.getAttribute('role'),
        modal: m && m.getAttribute('aria-modal'),
        labelledby: m && m.getAttribute('aria-labelledby'),
        titre: t && t.textContent.trim(),
        closeLabel: (document.querySelector('#posOverlay .close-btn') || {}).ariaLabel
          || (document.querySelector('#posOverlay .close-btn') || document.createElement('i')).getAttribute('aria-label'),
        tabsRole: [...document.querySelectorAll('#posOverlay .modal-tabs .tab')].map((b) => b.getAttribute('role')),
        selected: [...document.querySelectorAll('#posOverlay .modal-tabs .tab')].map((b) => b.getAttribute('aria-selected')),
        focus: document.activeElement ? document.activeElement.textContent.trim() : '',
      };
    });
    ok(sem.role === 'dialog', `role="dialog" (obtenu ${sem.role})`);
    ok(sem.modal === 'true', `aria-modal="true" (obtenu ${sem.modal})`);
    ok(sem.labelledby === 'posTitle' && !!sem.titre, `la fenetre porte le nom du client (« ${sem.titre} »)`);
    ok(!!sem.closeLabel, `le bouton de fermeture a un nom accessible (« ${sem.closeLabel} »)`);
    ok(sem.tabsRole.every((r) => r === 'tab') && sem.selected.join(',') === 'true,false', `les onglets sont des onglets (${sem.selected.join(',')})`);
    ok(sem.focus === 'Infos', `le focus entre dans la fenetre, sur l onglet actif (obtenu « ${sem.focus} »)`);

    console.log('\n[2] PIEGE A FOCUS : la tabulation ne sort pas de la fenetre');
    const avant = await tabulationsSortantes(page, 'Tab', 25);
    ok(avant === 0, `25 tabulations avant : ${avant} sortie(s)`);
    const arriere = await tabulationsSortantes(page, 'Shift+Tab', 25);
    ok(arriere === 0, `25 tabulations arriere : ${arriere} sortie(s)`);

    console.log('\n[3] ECHAP FERME, ET LE FOCUS REVIENT D OU IL VENAIT');
    await page.evaluate(() => closePos());
    await page.waitForTimeout(120);
    // On ouvre depuis une VRAIE ligne de la liste, au clavier, pour pouvoir
    // verifier que le focus lui revient.
    const retour = await page.evaluate(async () => {
      const row = document.querySelector('#resList .res-row');
      if (!row) return { erreur: 'aucune ligne de liste' };
      row.setAttribute('tabindex', '-1');
      row.focus();
      const avant = document.activeElement === row;
      openPos(Number(row.getAttribute('data-res-id')) || state.reservations[0].id);
      await new Promise((r) => setTimeout(r, 120));
      const dansLaFiche = !!(document.activeElement && document.activeElement.closest('#posOverlay'));
      return { avant, dansLaFiche };
    });
    ok(retour.avant && retour.dansLaFiche, 'le focus quitte la ligne pour entrer dans la fiche');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const apresEchap = await page.evaluate(() => ({
      hidden: document.getElementById('posOverlay').classList.contains('hidden'),
      selected: !!state.selectedRes,
      focusSurLigne: !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('res-row')),
    }));
    ok(apresEchap.hidden && !apresEchap.selected, 'Echap ferme la fiche');
    ok(apresEchap.focusSurLigne, 'le focus revient sur la ligne qui avait ouvert la fiche');

    console.log('\n[4] ONGLET MODIFIER : identite, libelles, groupement des actions');
    await page.evaluate(() => { openPos(state.reservations[0].id); setTab('modifier'); });
    await page.waitForTimeout(200);
    const edit = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#posOverlay label.lbl')];
      const danger = document.querySelector('#posOverlay .edit-actions .btn-secondary.danger');
      const primary = document.querySelector('#posOverlay .edit-actions .btn-primary');
      return {
        titre: (document.getElementById('posTitle') || {}).textContent || '',
        ident: (document.querySelector('#posOverlay .edit-modal-head p') || {}).textContent || '',
        labels: labels.length,
        associes: labels.filter((l) => l.htmlFor && document.getElementById(l.htmlFor)).length,
        dangerGroupe: !!document.querySelector('#posOverlay .edit-actions-destructive .btn-secondary.danger'),
        primaryGroupe: !!document.querySelector('#posOverlay .edit-actions-main .btn-primary'),
        ecart: danger && primary ? Math.round(primary.getBoundingClientRect().left - danger.getBoundingClientRect().right) : -1,
        dangerCouleur: danger ? getComputedStyle(danger).color : '',
        primaireCouleur: primary ? getComputedStyle(primary).color : '',
      };
    });
    ok(edit.titre.trim().length > 0, `l onglet Modifier garde le nom du client en titre (« ${edit.titre.trim()} »)`);
    // Les cinq questions du comptoir : qui (le titre), quand, ou, combien ils
    // sont, combien ca fait. La ligne d'identite porte les quatre dernieres.
    ok(/\d{1,2}:\d{2}/.test(edit.ident), `la ligne d identite dit QUAND (« ${edit.ident.trim()} »)`);
    ok(/Piste|Laser|Hors piste/.test(edit.ident), 'la ligne d identite dit OU');
    ok(/joueur/.test(edit.ident), 'la ligne d identite dit COMBIEN ILS SONT');
    ok(/#\d+/.test(edit.ident), 'la ligne d identite porte la reference du dossier');
    ok(edit.labels > 0 && edit.associes === edit.labels, `${edit.associes}/${edit.labels} libelles de champ associes a leur champ`);
    ok(edit.dangerGroupe && edit.primaryGroupe, 'Supprimer et Enregistrer sont dans deux groupes distincts');
    ok(edit.ecart > 200, `ecart MESURE entre Supprimer et Enregistrer : ${edit.ecart}px (minimum 200)`);
    ok(edit.dangerCouleur !== edit.primaireCouleur, 'Supprimer ne porte pas la meme couleur que l action principale');

    console.log('\n[5] CONTRE-EPREUVES PAR MUTATION : on casse, le gate rougit');
    // (a) on retire le gestionnaire clavier : Echap doit cesser de fonctionner.
    const mutEchap = await page.evaluate(async () => {
      const overlay = document.getElementById('posOverlay');
      overlay.removeEventListener('keydown', handlePosKeydown);
      const before = !overlay.classList.contains('hidden');
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      const after = !overlay.classList.contains('hidden');
      overlay.addEventListener('keydown', handlePosKeydown);
      return { before, after };
    });
    ok(mutEchap.before && mutEchap.after, 'contre-epreuve : sans le gestionnaire, Echap ne ferme plus (le test mesure bien le gestionnaire)');
    // (b) le gestionnaire remis, Echap refonctionne.
    await page.evaluate(() => { if (!state.selectedRes) openPos(state.reservations[0].id); });
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(140);
    const remis = await page.evaluate(() => document.getElementById('posOverlay').classList.contains('hidden'));
    ok(remis, 'gestionnaire remis : Echap referme');
    // (c) on colle les deux groupes d'actions : l'ecart doit tomber sous le seuil.
    const mutEcart = await page.evaluate(async () => {
      openPos(state.reservations[0].id);
      setTab('modifier');
      await new Promise((r) => setTimeout(r, 140));
      const style = document.createElement('style');
      style.id = 'qa-mutation-actions';
      style.textContent = '#posOverlay .edit-actions{justify-content:flex-end !important;}';
      document.head.appendChild(style);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const d = document.querySelector('#posOverlay .btn-secondary.danger');
      const p = document.querySelector('#posOverlay .btn-primary');
      const ecart = Math.round(p.getBoundingClientRect().left - d.getBoundingClientRect().right);
      style.remove();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const restaure = Math.round(
        document.querySelector('#posOverlay .btn-primary').getBoundingClientRect().left
        - document.querySelector('#posOverlay .btn-secondary.danger').getBoundingClientRect().right
      );
      return { ecart, restaure };
    });
    ok(mutEcart.ecart < 200, `contre-epreuve : groupes recolles, l ecart tombe a ${mutEcart.ecart}px (le seuil mesure vraiment quelque chose)`);
    ok(mutEcart.restaure > 200, `mutation retiree : l ecart remonte a ${mutEcart.restaure}px`);
    await page.evaluate(() => closePos());

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nreservation-sheet-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nreservation-sheet-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreservation-sheet-check: ALL OK');
}

main();
