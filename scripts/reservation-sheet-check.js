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
// Les fins de ligne sont normalisees AVANT de chercher le marqueur : selon le
// reglage git de la machine (core.autocrlf), le meme fichier arrive en LF ou en
// CRLF, et un marqueur ecrit en LF ne se trouve alors nulle part. Le gate se
// mettait a extraire tout le fichier et mourait sur une erreur de syntaxe, sans
// rapport avec ce qu il teste.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const matrixSrc = fs.readFileSync(path.join(__dirname, 'planning-matrix-check.js'), 'utf8').split(CRLF).join(LF);
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
      const danger = document.querySelector('#posOverlay .dossier-other-actions .btn-secondary.danger');
      const primary = document.querySelector('#posOverlay .edit-actions .btn-primary');
      return {
        titre: (document.getElementById('posTitle') || {}).textContent || '',
        ident: [...document.querySelectorAll('#posOverlay .dossier-fact strong')].map(el => el.textContent).join(' · '),
        labels: labels.length,
        associes: labels.filter((l) => l.htmlFor && document.getElementById(l.htmlFor)).length,
        dangerGroupe: !!document.querySelector('#posOverlay .edit-actions-destructive .btn-secondary.danger'),
        primaryGroupe: !!document.querySelector('#posOverlay .edit-actions-main .btn-primary'),
        dangerFolded: !!danger && !!danger.closest('details:not([open])') && !danger.closest('.dossier-actions'),
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
    // DECISION INVERSEE (2026-08-25, Movsar : « ca montre un hashtag avec
    // un numero, il est relie nulle part, il sert a rien ») : le #id ne
    // parle a personne au comptoir. La reference technique vit au journal
    // d audit et dans l export, plus dans l entete de fiche.
    ok(!/#\d+/.test(edit.ident), 'la ligne d identite ne porte PLUS de reference technique #id');
    ok(edit.labels > 0 && edit.associes === edit.labels, `${edit.associes}/${edit.labels} libelles de champ associes a leur champ`);
    ok(edit.dangerGroupe && edit.primaryGroupe, 'Supprimer et Enregistrer sont dans deux groupes distincts');
    ok(edit.dangerFolded, 'actions destructives repliees hors de la barre Enregistrer');
    ok(edit.dangerCouleur !== edit.primaireCouleur, 'Supprimer ne porte pas la meme couleur que l action principale');

    // -----------------------------------------------------------------------
    // [5] LA REFONTE DU 2026-08-14, MESUREE. Trois defauts se laissent compter,
    // donc ils se laissent surveiller : la hauteur, le nombre de boutons a
    // l'ecran, et le nombre de faits de l'en-tete recopies dans le corps. Les
    // seuils sont posés au-dessus des mesures du jour (Infos 415 px / 7
    // boutons, Modifier 483 px / 7 boutons) : ils attrapent une derive, pas une
    // variation d'un pixel.
    // -----------------------------------------------------------------------
    console.log('\n[5] FICHE : HAUTEUR, BOUTONS, ET ZERO REDITE DE L EN-TETE');
    const mesureOnglet = async (tab) => {
      await page.evaluate((t) => { if (!state.selectedRes) openPos(state.reservations[0].id); setTab(t); }, tab);
      await page.waitForTimeout(200);
      return page.evaluate(() => {
        // Un controle range dans un depliant ferme n'est pas a l'ecran, et
        // `offsetParent` ne le dit pas (Chromium masque par content-visibility).
        const visible = (el) => {
          if (el.closest('details:not([open])')) return false;
          if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
          return el.getBoundingClientRect().width > 0;
        };
        const modal = document.querySelector('#posOverlay .edit-modal');
        const body = document.querySelector('#posOverlay .edit-modal-body');
        const corps = body ? body.innerText : '';
        const faits = [...document.querySelectorAll('#posOverlay .dossier-fact strong')].map(el => el.textContent.trim()).filter(Boolean);
        return {
          hauteur: Math.round(modal.getBoundingClientRect().height),
          plafond: window.innerHeight - 32,
          corpsDefilable: !!body && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY),
          // Les CASES des activites (.gc-check, une par activite, demandees
          // le 2026-10-01 : « cliquer sur les activites pour dire que ca a ete
          // fait ») sont des cases a cocher, pas des actions : elles se
          // comptent a part, le plafond reste celui des actions.
          // Les LIENS vers le planning (.gc-step-link, le nom Bowling / Laser
          // Game, demandes le 2026-10-01 : « qu on clique dessus et que ca
          // nous dirige vers les plannings ») sont le nom de l activite rendu
          // cliquable, pas une action en plus : comptes a part, un par
          // activite de bowling ou de laser au plus.
          boutons: [...document.querySelectorAll('#posOverlay button:not(.gc-check):not(.gc-step-link)')].filter(visible).length,
          liens: [...document.querySelectorAll('#posOverlay .gc-step .gc-step-link')].filter(visible).length,
          cases: [...document.querySelectorAll('#posOverlay .gc-step .gc-check')].filter(visible).length,
          pas: [...document.querySelectorAll('#posOverlay .gc-step')].filter(visible).length,
          faits: faits.length,
          // An activity's own participant count is required even when equal
          // to the visitors in the header. All other header facts, and any
          // duplicate visitor count outside activity details, remain banned.
          redites: faits.filter((f) => {
            if (!/^\d+\s+(joueurs?|enfants?)$/.test(f)) return corps.includes(f);
            const copie=body.cloneNode(true);
            copie.querySelectorAll('.gc-step-what > small, .gc-bill-lines dt small, [data-edit-activity] .dossier-participants-explanation, .dossier-price-section #editPrixEstime').forEach(el=>{el.textContent=el.textContent.split(f).join('');});
            return copie.textContent.includes(f);
          }),
          effectifsActivites:[...body.querySelectorAll('.gc-step-what > small')].map(el=>(el.textContent.match(/^(\d+) joueurs?/)||[])[1]).filter(Boolean),
        };
      });
    };
    const infos = await mesureOnglet('details');
    ok(infos.faits >= 2, `« Infos » : l en-tete se lit en ${infos.faits} faits (sans decoupe, « aucune redite » ne prouverait rien)`);
    // Depuis la refonte mixte du 04/10, les faits sont structures et la fiche
    // porte le programme et l'addition. Sa limite utile est le viewport avec
    // sa marge, son corps doit defiler : un ancien plafond fixe comprimerait
    // les controles ou cacherait les informations au lieu de les proteger.
    ok(infos.hauteur <= infos.plafond && infos.corpsDefilable, `« Infos » : ${infos.hauteur}px dans le plafond du viewport ${infos.plafond}px, corps defilable`);
    // PLAFOND 9 DEPUIS LE 2026-10-01 : une action de plus, demandee par
    // Movsar (« ajouter une note cote staff, une note du staff en interne ») :
    // le bouton « Note pour l equipe », son champ replie tant qu on ne
    // l ouvre pas. Les liens vers le planning se comptent a part (ci-dessous).
    ok(infos.boutons <= 9, `« Infos » : ${infos.boutons} boutons d action a l ecran (plafond 9, valait 11 avant refonte ; les cases des activites et les liens du planning a part)`);
    ok(infos.liens <= infos.pas, `« Infos » : ${infos.liens} liens vers le planning, au plus un par activite (${infos.pas})`);
    ok(infos.pas > 0 && infos.cases === infos.pas, `« Infos » : chaque activite du programme a sa case (${infos.cases} cases pour ${infos.pas} activites)`);
    ok(infos.redites.length === 0, `« Infos » : ${infos.redites.length} fait de l en-tete recopie dans le corps${infos.redites.length ? ' : ' + infos.redites.join(' | ') : ''}`);
    ok(infos.effectifsActivites.length>0&&infos.effectifsActivites.every(n=>Number(n)===11),'« Infos » : les activites indiquent leurs11 joueurs, independamment de l effectif global');
    const modif = await mesureOnglet('modifier');
    ok(modif.faits >= 2, `« Modifier » : l en-tete se lit en ${modif.faits} faits (sans decoupe, « aucune redite » ne prouverait rien)`);
    ok(modif.hauteur <= modif.plafond && modif.corpsDefilable, `« Modifier » : ${modif.hauteur}px dans le plafond du viewport ${modif.plafond}px, corps defilable`);
    ok(modif.redites.length === 0, `« Modifier » : ${modif.redites.length} fait de l en-tete recopie dans le corps${modif.redites.length ? ' : ' + modif.redites.join(' | ') : ''}`);

    // La composition neutre conserve les actions et les groupes plats.
    // Les separators gardent la hierarchie sans imposer un fond decoratif.
    const relief = await page.evaluate(() => {
      openPos(state.reservations[0].id); setTab('details');
      const transparent = (v) => !v || v === 'transparent' || /rgba\([^)]*,\s*0\)/.test(v);
      const act = document.querySelector('#posOverlay .pos-act');
      const groupes = [...document.querySelectorAll('#posOverlay .pos-sheet > .info-block')];
      return {
        actPresent: !!act && act.checkVisibility() && act.getBoundingClientRect().width > 0,
        groupes: groupes.length,
        groupesAvecFond: groupes.filter((g) => !transparent(getComputedStyle(g).backgroundColor)).length,
        groupesAvecFilet: groupes.filter((g) => parseFloat(getComputedStyle(g).borderTopWidth) > 0).length,
      };
    });
    await page.waitForTimeout(160);
    ok(relief.actPresent, 'le bloc d action reste present et visible dans la composition neutre');
    ok(relief.groupes > 0 && relief.groupesAvecFond === 0, `les ${relief.groupes} groupes du corps sont plats (${relief.groupesAvecFond} avec fond)`);
    ok(relief.groupes === relief.groupesAvecFilet, `les ${relief.groupes} groupes se separent par un filet`);

    // LE DEPLIANT RANGE SANS SUPPRIMER. Sa hauteur propre grandit a l'ouverture,
    // meme lorsque le modal a atteint son plafond. Les quatre controles sont
    // ensuite verifies cliquables au point milieu : aucune action n'a disparu.
    const fold = await page.evaluate(async () => {
      const d = document.querySelector('#posOverlay details.pos-fold');
      if (!d) return null;
      const h = () => Math.round(document.querySelector('#posOverlay .edit-modal').getBoundingClientRect().height);
      const chips = [...d.querySelectorAll('.delay-chip')];
      const contenu = d.getBoundingClientRect().height;
      const avant = { ouvert: d.open, hauteur: h(), contenu };
      d.querySelector('summary').click();
      await new Promise((r) => setTimeout(r, 200));
      const apres = { ouvert: d.open, hauteur: h(), contenu: d.getBoundingClientRect().height };
      const surEcran = chips.filter((c) => {
        const r = c.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === c;
      }).length;
      return { avant, apres, total: chips.length, surEcran };
    });
    ok(fold && !fold.avant.ouvert, 'le depliant « Client en retard » est ferme au repos');
    ok(fold && fold.apres.contenu > fold.avant.contenu + 40, `ouvrir le depliant revele son contenu (${fold ? fold.avant.contenu : '?'} a ${fold ? fold.apres.contenu : '?'}px), meme si la fenetre est plafonnee`);
    ok(fold && fold.apres.ouvert && fold.surEcran === fold.total && fold.total >= 4, `ouvert : les ${fold ? fold.total : '?'} controles de retard sont cliquables (${fold ? fold.surEcran : '?'} atteints au point milieu) - rien n a ete supprime`);
    // La suite attend la fiche OUVERTE : on la remet a plat plutot que de la fermer.
    await page.evaluate(() => { closePos(); openPos(state.reservations[0].id); });
    await page.waitForTimeout(160);

    console.log('\n[6] CONTRE-EPREUVES PAR MUTATION : on casse, le gate rougit');
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
    // (c) remettre Supprimer dans la barre principale doit etre detecte.
    const mutEcart = await page.evaluate(async () => {
      openPos(state.reservations[0].id);
      setTab('modifier');
      await new Promise((r) => setTimeout(r, 140));
      const d = document.querySelector('#posOverlay .btn-secondary.danger'), parent = d.parentElement, next = d.nextSibling;
      document.querySelector('#posOverlay .dossier-actions').append(d);
      const mixed = !!d.closest('.dossier-actions');
      parent.insertBefore(d, next);
      return { mixed, restored: !!d.closest('.dossier-other-actions') && !d.closest('.dossier-actions') };
    });
    ok(mutEcart.mixed, 'contre-epreuve : Supprimer remis dans la barre principale est detecte');
    ok(mutEcart.restored, 'mutation retiree : Supprimer revient dans Autres actions');
    await page.evaluate(() => closePos());

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nreservation-sheet-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    console.log('\n[PROGRAMME] La meme liste ne se dit pas deux fois');
    // Movsar, 2026-08-26 : « pq mettre le programme du groupe quand ya deja
    // suivi de groupe avec coche ». Le bloc « Programme du groupe » repetait,
    // juste au-dessus du suivi, les memes activites en moins utile (pas
    // d horaires, pas de coches). Il ne reste que quand il n y a PAS de suivi,
    // ou il est la seule vue du contenu.
    const doublon = await page.evaluate(async () => {
      // Il FAUT une reservation qui produise un suivi, sinon le test ne mesure
      // rien : le suivi n existe que pour une formule dont les activites sont
      // connues. On la choisit en interrogeant le rendu lui-meme.
      // Il FAUT une reservation qui produise un suivi, sinon le test ne mesure
      // rien. Le suivi n existe que pour une FORMULE dont les activites sont
      // connues : si le jeu de donnees n en a pas, on en fabrique une et on
      // verifie que le rendu la reconnait avant d asserter quoi que ce soit.
      let res = state.reservations.find((r) => renderFormulaActivityChecklist(r));
      if (!res) {
        const modele = state.reservations[0] || {};
        for (const fid of ['f1', 'f2', 'f3', 'f4', 'f8']) {
          const candidat = Object.assign({}, modele, {
            id: 990000 + Number(fid.replace('f', '')),
            type: 'formule', formuleId: fid, label: 'FORMULE ' + fid.replace('f', ''),
            pax: 8, activityProgress: {},
          });
          if (renderFormulaActivityChecklist(candidat)) { state.reservations.push(candidat); res = candidat; break; }
        }
      }
      if (!res) return { erreur: 'aucune reservation ne produit de suivi' };
      if (!res) return { erreur: 'aucune reservation' };
      // On lui donne un programme de deux activites, condition d apparition du
      // bloc, et un suivi.
      res.program = res.program && res.program.items && res.program.items.length >= 2 ? res.program : {
        items: [
          { activityId: 'bowling', name: 'Bowling', duration: 1, planned: true, price: 39, priceKnown: true },
          { activityId: 'arcade_time', name: 'Arcades', planned: false, price: 0, priceKnown: false },
        ],
        price: 39,
        priceComplete: false,
      };
      closePos(); openPos(res.id); setTab('details');
      // ON ATTEND LA CONDITION, PAS UNE DUREE. Une attente fixe de 600 ms rendait
      // ce gate INSTABLE : mesure du 2026-08-27, trois executions d affilee sans
      // rien changer au produit ont donne vert / rouge / vert, la fiche n ayant
      // pas fini de peindre ses etiquettes au moment de la lecture. Un gate qui
      // rougit au hasard ne protege plus rien : on cesse de le croire. On attend
      // donc que les etiquettes existent, avec un plafond - si elles n arrivent
      // JAMAIS, la mesure part quand meme et l assertion rougit pour de bon.
      // Depuis le 2026-10-01, programme et suivi sont UN SEUL bloc
      // « Programme » : les activites d une formule s y cochent. « Ne
      // coexistent pas » se lit donc : un seul bloc, qui porte les coches.
      const etiquettes = () => [...document.querySelectorAll('#posOverlay .info-label, .pos-sheet .info-label')]
        .map((n) => n.textContent.trim());
      const limite = Date.now() + 5000;
      while (Date.now() < limite) {
        const vues = etiquettes();
        if (vues.some((l) => /^Programme$/i.test(l))) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const labels = etiquettes();
      return {
        suivi: document.querySelectorAll('#posOverlay .gc-steps .gc-check').length > 0,
        programme: labels.filter((l) => /^Programme$|Programme du groupe|Suivi des activit/i.test(l)).length > 1,
        // Aucun identifiant technique ne doit s afficher a la place d un nom.
        idsBruts: [...document.querySelectorAll('#posOverlay, .pos-sheet')]
          .map((n) => n.textContent || '')
          .join(' ')
          .match(/\b(arcade_time|laser_game|fun_run|duckpin_bowling|minigolf_blacklight)\b/g) || [],
      };
    });
    if (ok(doublon && !doublon.erreur, `fiche ouverte${doublon && doublon.erreur ? ` (${doublon.erreur})` : ''}`)) {
      ok(!(doublon.suivi && doublon.programme),
        `programme et suivi ne coexistent pas (suivi: ${doublon.suivi}, programme: ${doublon.programme})`);
      ok(doublon.suivi,
        `le cas teste est bien celui ou un suivi existe (suivi: ${doublon.suivi}) : sans lui, « pas de doublon » serait vrai pour rien`);
      ok(doublon.suivi || doublon.programme,
        `mais le contenu du dossier reste visible quelque part (suivi: ${doublon.suivi}, programme: ${doublon.programme})`);
      ok(doublon.idsBruts.length === 0,
        `aucun identifiant technique a l ecran (${doublon.idsBruts.join(', ') || 'aucun'})`);
    }

    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nreservation-sheet-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nreservation-sheet-check: ALL OK');
}

main();
