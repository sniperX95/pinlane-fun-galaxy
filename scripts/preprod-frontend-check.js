// Local UI gate. Run only through artifacts/preprod-fixes-20260912/run-isolated.cjs.
// Real HTML/CSS/JS, local static server, fixture APIs; no application server or DB.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts/preprod-fixes-20260912/frontend');
const results = [], errors = [], blocked = [];
let BASE_URL;
let captureEnabled = false;
const qa = fs.readFileSync(path.join(__dirname, 'run-visual-qa.js'), 'utf8');
function loadFixture(name) {
  const start = qa.indexOf('async function ' + name + '(');
  const end = /\r?\n\}\r?\n/.exec(qa.slice(start));
  if (start < 0 || !end) throw new Error('Missing QA fixture: ' + name);
  let body = qa.slice(start, start + end.index + end[0].length);
  if (name === 'installQaApi') body = body.replace("'planning.bowling',", "'planning.bowling', 'reservations.quick', 'reservations.create', 'reservations.edit', 'emails.send',");
  return new Function('BASE_URL', body + '\nreturn ' + name)(BASE_URL);
}
let silence = false;
function ok(condition, id, detail) {
  results.push({ id, pass: !!condition, detail });
  if (!silence) console.log((condition ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(detail));
  return !!condition;
}
async function scenario(id, run) {
  try { await run(); } catch (error) { ok(false, id + ':execution', error.message); }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
// Une contre-preuve (--contre-preuves) sert son fichier avec la regle retiree : le
// disque n est jamais touche.
let mutation = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  if (req.method !== 'GET' || !/^(index\.html$|assets\/|favicon\.)/.test(rel) || rel.includes('..')) {
    res.writeHead(403); return res.end('Fixture not defined');
  }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': (mime[path.extname(rel)] || 'application/octet-stream') + '; charset=utf-8' });
    if (!err && mutation && rel === mutation.fichier) data = String(data).replace(/\r\n/g, '\n').replace(mutation.de, () => mutation.vers);
    res.end(err ? '' : data);
  });
});
async function shot(page, name) {
  await page.waitForTimeout(900);
  if (captureEnabled) await page.screenshot({ path: path.join(OUT, name + '.png') });
}
// Le focus revient a la fin de la sortie d une fenetre : ce qui se lisait
// aussitot apres Echap perdait la course sur une machine chargee.
const finit = (page, condition, arg = null) => page.waitForFunction(condition, arg, { timeout: 8000 }).then(() => true, () => page.evaluate(condition, arg).then(Boolean, () => false));
async function contained(page, selector, count = 30) {
  const escaped = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
    if (!(await page.evaluate(s => !!document.activeElement.closest(s), selector))) escaped.push(i);
  }
  return escaped;
}
// LE PLANNING SE REDESSINE FENETRE OUVERTE (2026-11-07). Chaque minute, la barre de
// l heure bouge et la grille entiere est reecrite : la case ou la carte qui a ouvert la
// fenetre est remplacee par sa copie. Deux choses se verifient avant Echap, a chaque
// taille. A minute figee, le tic ne reecrit rien : la hauteur d heure suit la boite des
// le premier rendu (avant, a 1180 et 1440, le premier tic la changeait d un pixel et
// reecrivait la grille, d ou F1-close et sheet-close rouges par hasard). Puis la grille
// marquee retouchee se reconstruit au tic comme a un changement de minute, quel que soit
// le jour ou l heure du banc, et Echap doit rendre le focus a la copie : meme piste et
// meme heure pour une case, meme dossier, meme piste et meme heure pour une carte.
async function ticFenetreOuverte(page, ouvreur) {
  return page.evaluate((nom) => {
    const wrap = document.getElementById('planningGridWrap'), avant = window[nom];
    tickStaffMinute();
    const fige = avant.isConnected;
    rendusDeSurface.get(wrap).touchee = true;
    tickStaffMinute();
    return { fige, reconstruite: !avant.isConnected, fenetre: !!quickBookState || !!state.selectedRes };
  }, ouvreur);
}
// Sans fenetre, le focus sur une case ou une carte de la grille. A minute figee, le tic
// laisse la grille (en F1, c est le premier tic du banc : avant, la hauteur d heure y
// changeait) ; marquee retouchee, elle se reconstruit au tic, et le focus doit etre
// passe a la copie (memes cles).
async function grilleSousLeFocus(page, cles) {
  return page.evaluate((cles) => {
    const avant = document.activeElement, wrap = document.getElementById('planningGridWrap');
    tickStaffMinute();
    const fige = avant.isConnected;
    rendusDeSurface.get(wrap).touchee = true;
    tickStaffMinute();
    const actif = document.activeElement;
    return { fige, reconstruite: !avant.isConnected, surLaCopie: actif !== avant && actif.isConnected && actif.tagName === avant.tagName && cles.every((cle) => actif.getAttribute(cle) === avant.getAttribute(cle)), focus: `${actif.tagName}.${actif.className}` };
  }, cles);
}
// Fenetre et fiche fermees, le focus est sur l ouvreur ou sur sa copie (memes cles, dans
// le document).
function revenuALOuvreur({ nom, cles }) {
  const actif = document.activeElement, ouvreur = window[nom];
  const surLui = actif === ouvreur || (actif.isConnected && actif.tagName === ouvreur.tagName && cles.every((cle) => actif.getAttribute(cle) === ouvreur.getAttribute(cle)));
  return !quickBookState && !state.selectedRes && surLui;
}
const ouLeFocus = (page, nom) => page.evaluate((nom) => {
  const actif = document.activeElement;
  return { fenetre: !!quickBookState, fiche: !!state.selectedRes, focus: `${actif.tagName}.${actif.className}`, cles: { ...actif.dataset }, ouvreur: window[nom].isConnected };
}, nom);
const CLES_CASE = ['data-bowling-drop-lane', 'data-bowling-drop-start'];
const CLES_CARTE = ['data-booking-res-id', 'data-booking-lane', 'data-booking-start'];

async function main({ capture = false, seulement = null, tailles = null, rapport = true } = {}) {
  captureEnabled = capture;
  results.length = 0; errors.length = 0; blocked.length = 0;
  const joue = (nom) => !seulement || seulement.includes(nom);
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  BASE_URL = 'http://127.0.0.1:' + server.address().port;
  const installQaApi = loadFixture('installQaApi'), seedStressDay = loadFixture('seedStressDay');
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [320, 390, 768, 1180, 1440]) for (const theme of ['light', 'dark']) {
      const suffix = width + '-' + theme;
      if (tailles && !tailles.includes(suffix)) continue;
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, hasTouch: width <= 1180, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin === BASE_URL) return route.continue();
        blocked.push(u.hostname); return route.abort();
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', err => errors.push({ suffix, message: err.message }));
      await installQaApi(page);
      // La minute est figee. Le planning porte l heure : un rendu apres un changement
      // de minute reconstruit sa grille et detache la case ou la carte qui a ouvert
      // la fenetre (le focus va alors a sa copie). Ce rendu, F1 et F4 le provoquent
      // expres, au meme moment a chaque passage : ticFenetreOuverte.
      await page.clock.setFixedTime(new Date());
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof setView === 'function');
      await seedStressDay(page);
      await page.waitForFunction(() => !!window.pv2Mail);
      await page.evaluate(t => { state.staffTheme = t; document.documentElement.dataset.theme = t; renderStaff(); }, theme);
      await page.waitForTimeout(900);
      {
      if (joue('F5')) await scenario('F5-' + suffix, async () => {
        const sizes = await page.locator('.lane-header .settings').evaluateAll(list => list.map(el => {
          const r = el.getBoundingClientRect(), head = el.closest('.lane-header').getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + 2, r.y + 2);
          return { width: r.width, height: r.height, inside: r.top >= head.top && r.bottom <= head.bottom && r.left >= head.left && r.right <= head.right, hit: hit === el || el.contains(hit) };
        }).filter(r => r.width > 0));
        ok(width <= 768 ? sizes.length === 0 : sizes.length >= 8 && sizes.every(r => r.width >= 44 && r.height >= 44 && r.inside && r.hit), 'F5-' + suffix, sizes);
        await shot(page, 'planning-' + suffix);
      });
      if (joue('F1')) await scenario('F1-' + suffix, async () => {
        // A real focused trigger, with the existing planning click handler.
        const trigger = page.locator('.slot-cell.clickable').first();
        await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
        // (la grille se redessine sous le focus de la case : grilleSousLeFocus)
        const grille = await grilleSousLeFocus(page, CLES_CASE);
        ok(grille.fige, 'F1-tic-fige-' + suffix, grille.fige ? 'frozen minute: the first tick leaves the grid alone' : grille);
        ok(grille.reconstruite && grille.surLaCopie, 'F1-grille-' + suffix, grille.reconstruite && grille.surLaCopie ? 'grid rebuilt under the focused cell: focus on its copy' : grille);
        await trigger.focus();
        await page.evaluate(() => { window.__trigger = document.activeElement; });
        await page.keyboard.press('Enter');
        // La croix de la fenetre garde son id d une version a l autre (#rvFermer) ;
        // sa classe a change avec Les seances (2026-11-03).
        const ax = await page.evaluate(() => {
          const modal = document.querySelector('.qb-modal');
          return { role: modal?.getAttribute('role'), name: document.getElementById(modal?.getAttribute('aria-labelledby'))?.textContent,
            inside: modal?.contains(document.activeElement), close: modal?.querySelector('#rvFermer')?.getAttribute('aria-label'),
            fields: [...modal.querySelectorAll('input,textarea,select')].map(el => ({ id: el.id, named: !!(el.labels?.length || el.getAttribute('aria-label')) })) };
        });
        ok(ax.role === 'dialog' && ax.name && ax.inside && ax.close && ax.fields.every(f => f.named), 'F1-semantics-' + suffix, ax);
        ok((await contained(page, '.qb-modal')).length === 0, 'F1-trap-' + suffix, '30 mixed Tab/Shift+Tab');
        // Les seances (2026-11-03) : le detail d une ligne s ouvre en touchant sa ligne
        // du ticket (#rsL-a-<activite>), sa page a gauche ; la ligne le dit
        // (aria-current) et le re-rendu lui garde le focus. Au telephone (<= 900 px)
        // le ticket est replie derriere #rsResume, qui dit qu il l ouvre
        // (aria-expanded). Une touche que le geste cache (#rsResume quand le ticket
        // s ouvre, la ligne quand sa page replie le ticket) ne peut plus tenir le
        // focus : il reste alors dans la fenetre, sur une touche visible, jamais sur
        // la page derriere.
        const garde = (id) => page.evaluate((id) => {
          const actif = document.activeElement, modal = document.querySelector('.qb-modal'), cible = document.getElementById(id);
          const vu = el => !!el && el.getClientRects().length > 0;
          return { surLui: actif === cible, dansLaFenetre: !!modal && modal.contains(actif) && actif !== modal && vu(actif), visible: vu(cible), focus: `${actif.tagName}#${actif.id}.${actif.className}` };
        }, id);
        let ticket = null;
        if (width <= 900) {
          const resume = page.locator('#quickBookOverlay #rsResume');
          const replie = await resume.getAttribute('aria-expanded');
          await resume.click();
          ticket = { avant: replie, apres: await resume.getAttribute('aria-expanded'), ...await garde('rsResume') };
        }
        const ligne = page.locator('#quickBookOverlay #rsLignes .rs-tk-a').first();
        const ligneId = await ligne.getAttribute('id');
        const avant = await ligne.getAttribute('aria-current');
        await ligne.click();
        const lue = { id: ligneId, avant, apres: await ligne.getAttribute('aria-current'), ...await garde(ligneId) };
        const ticketOk = !ticket || (ticket.avant === 'false' && ticket.apres === 'true' && (ticket.visible ? ticket.surLui : ticket.dansLaFenetre));
        const ligneOk = lue.avant !== 'step' && lue.apres === 'step' && (lue.visible ? lue.surLui : lue.dansLaFenetre);
        ok(ticketOk && ligneOk, 'F1-rerender-' + suffix, ticketOk && ligneOk ? 'ticket line retains focus and says its page is open' : { ticket, ligne: lue });
        await shot(page, 'quickbook-' + suffix);
        // (la grille se redessine fenetre ouverte : ticFenetreOuverte)
        const tic = await ticFenetreOuverte(page, '__trigger');
        ok(tic.fige && tic.reconstruite && tic.fenetre, 'F1-tic-reecrit-' + suffix, tic.fige && tic.reconstruite && tic.fenetre ? 'frozen tick leaves the grid alone, then the grid is rebuilt with the window open' : tic);
        // Echap remonte d un cran a la fois : la page de la ligne revient a l accueil,
        // fenetre ouverte et focus dedans, puis l Echap suivant ferme et rend le focus
        // a l ouvreur, ou a sa copie : la meme case, piste et heure.
        await page.keyboard.press('Escape');
        const accueil = await finit(page, () => !!quickBookState && !!document.querySelector('.qb-modal.is-q-activites') && document.querySelector('.qb-modal').contains(document.activeElement));
        await page.keyboard.press('Escape');
        const refermee = await finit(page, revenuALOuvreur, { nom: '__trigger', cles: CLES_CASE });
        ok(accueil && refermee, 'F1-close-' + suffix, accueil && refermee ? 'Escape backs out to the welcome page, then closes; focus on the same cell' : { accueil, ...await ouLeFocus(page, '__trigger') });
      });
      // Fermee meme apres un echec du scenario : une fenetre restee ouverte garde son
      // piege a focus sur la fiche du scenario suivant (sheet-trap et F4 rougissaient
      // en cascade).
      await page.evaluate(() => closeQuickBook()).catch(() => {});
      if (joue('dialog-edge-cases') && width === 1440 && theme === 'light') await scenario('dialog-edge-cases', async () => {
        // Le jour vient du scenario, jamais de l heure du gate : une fenetre
        // ouverte pour la demi-heure qui vient est « au comptoir », une autre heure
        // est une reservation ordinaire. Les seances (2026-11-03) ont la meme forme a
        // toute heure : le champ unique « Nom ou téléphone » au ticket (#qbQui), sans
        // champ de nom a part sur l ecran, et le formulaire complet sur la page
        // Client, a un toucher du ticket (#rsL-client).
        const champs = (auComptoir) => page.evaluate((auComptoir) => {
          let date = todayStr(), startTime = numToTime(Math.min(23.5, Math.ceil(currentTimeDecimal() * 2) / 2));
          if (!auComptoir) {
            const d = parseLocalDate(state.currentDate); d.setDate(d.getDate() + 7);
            date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
            startTime = '16:00';
          }
          openQuickBook({ date, startTime });
          const lire = () => [...document.querySelectorAll('.qb-modal input,.qb-modal textarea')].map(el => ({ id: el.id, name: el.labels?.[0]?.textContent || el.getAttribute('aria-label') }));
          const ecran = lire();
          document.getElementById('rsL-client').click();
          const lus = lire();
          closeQuickBook();
          return { ecran, lus };
        }, auComptoir);
        const full = await champs(false);
        // Le formulaire complet = le jour, les joueurs, le contact, l e-mail et la
        // note, chaque champ nomme.
        ok(['qbDate', 'qbPax', 'qbPhone', 'qbName', 'qbEmail', 'qbNotes'].every((id) => full.lus.some((f) => f.id === id)) && full.lus.every(f => f.name), 'F1-full-fields', full.lus);
        const comptoir = await champs(true);
        ok(['qbDate', 'qbPax', 'qbQui', 'qbPhone', 'qbEmail', 'qbNotes'].every((id) => comptoir.lus.some((f) => f.id === id)) && comptoir.ecran.some((f) => f.id === 'qbQui') && !comptoir.ecran.some((f) => f.id === 'qbName') && comptoir.lus.every(f => f.name), 'F1-full-fields-comptoir', comptoir);
        await page.evaluate(() => { openQuickBook(); });
        const focusCases = await page.evaluate(() => {
          const root = document.querySelector('.qb-modal'), fixture = document.createElement('div');
          fixture.innerHTML = '<details><summary id="qa-summary">Options QA</summary><button id="qa-closed">Caché</button></details><button id="qa-disabled" disabled>Inactif</button><button id="qa-minus" tabindex="-1">Sans tabulation</button><div inert><button id="qa-inert">Inerte</button></div>';
          root.appendChild(fixture);
          const ids = focusablesInDialog(root).map(e => e.id);
          fixture.remove(); closeQuickBook(); return ids.filter(id => id.startsWith('qa-'));
        });
        ok(JSON.stringify(focusCases) === '["qa-summary"]', 'dialog-focus-filter', focusCases);
      });
      if (joue('F4')) await scenario('F4-sheet-' + suffix, async () => {
        // (la grille se redessine sous le focus de la carte : grilleSousLeFocus)
        await page.evaluate(() => document.querySelector('.booking[data-booking-res-id="9002"]').focus());
        const grille = await grilleSousLeFocus(page, CLES_CARTE);
        ok(grille.fige && grille.reconstruite && grille.surLaCopie, 'sheet-grille-' + suffix, grille.fige && grille.reconstruite && grille.surLaCopie ? 'frozen tick leaves the grid alone, then the grid is rebuilt under the focused card: focus on its copy' : grille);
        await page.evaluate(() => { window.__carte = document.querySelector('.booking[data-booking-res-id="9002"]'); window.__carte.focus(); openPos(9002); });
        ok((await contained(page, '#posOverlay .edit-modal', 35)).length === 0, 'sheet-trap-' + suffix, '35 tabs');
        await page.evaluate(() => {
          window.__confirmTrigger = document.querySelector('#posOverlay .tab.active'); window.__confirmTrigger.focus();
          window.__answer = null;
          staffConfirm({ title: 'Vérification locale', body: 'Aucune action métier attachée.' }).then(v => window.__answer = v);
        });
        const escaped = await contained(page, '.staff-confirm', 12);
        ok(!escaped.length, 'F4-trap-' + suffix, escaped);
        await shot(page, 'confirm-' + suffix);
        await page.keyboard.press('Escape');
        ok(await finit(page, () => window.__answer === false && document.activeElement === window.__confirmTrigger && !!state.selectedRes), 'F4-cancel-restore-' + suffix, 'Escape closes only confirmation and restores sheet focus');
        await page.evaluate(() => { staffConfirm({ title: 'Contrôle positif' }).then(v => window.__answer = v); });
        await page.locator('[data-role="confirm-ok"]').click();
        ok(await finit(page, () => window.__answer === true && document.activeElement === window.__confirmTrigger), 'F4-confirm-restore-' + suffix, 'positive confirmation');
        // (la grille se redessine fiche ouverte : ticFenetreOuverte)
        const tic = await ticFenetreOuverte(page, '__carte');
        ok(tic.fige && tic.reconstruite && tic.fenetre, 'sheet-tic-' + suffix, tic.fige && tic.reconstruite && tic.fenetre ? 'frozen tick leaves the grid alone, then the grid is rebuilt with the sheet open' : tic);
        await page.keyboard.press('Escape');
        const fermee = await finit(page, revenuALOuvreur, { nom: '__carte', cles: CLES_CARTE });
        ok(fermee, 'sheet-close-' + suffix, fermee ? 'sheet Escape and opener restoration: the same card' : await ouLeFocus(page, '__carte'));
        await page.evaluate(() => closePos());
      });
      if (joue('F2')) await scenario('F2-' + suffix, async () => {
        await page.evaluate(() => { state.staffMenuPage = 'clients'; state.staffClientSegment = 'tous'; renderStaff(); });
        const buttons = page.locator('.crm-th button');
        ok(await buttons.count() === 4, 'F2-native-' + suffix, await buttons.count());
        if (await buttons.count() === 4) for (const key of ['name', 'lastDate', 'reservations', 'spent']) {
          const btn = page.locator('.crm-th button[data-crm-sort="' + key + '"]');
          await btn.focus(); await page.keyboard.press('Enter');
          const first = await page.evaluate(() => ({ ...state.staffClientSort }));
          const order = await page.locator('.crm-table tbody .crm-client-id strong').allTextContents();
          ok(await btn.evaluate(el => el === document.activeElement && el.closest('th').getAttribute('aria-sort') === (state.staffClientSort.dir === 'asc' ? 'ascending' : 'descending')), 'F2-keyboard-' + key + '-' + suffix, first);
          await page.keyboard.press('Space');
          ok(await page.evaluate(k => state.staffClientSort.key === k, key) && (await page.evaluate(() => state.staffClientSort.dir)) !== first.dir, 'F2-toggle-' + key + '-' + suffix, 'Space toggles direction');
          if (key === 'name' || key === 'spent') {
            const reversed = await page.locator('.crm-table tbody .crm-client-id strong').allTextContents();
            ok(order.length === 5 && JSON.stringify(reversed) === JSON.stringify(order.reverse()), 'F2-row-order-' + key + '-' + suffix, reversed);
          }
        }
        await shot(page, 'crm-' + suffix);
      });
      if (joue('F3')) await scenario('F3-' + suffix, async () => {
        await page.evaluate(t => {
          setView('client'); resetBooking(); document.documentElement.dataset.theme = t;
          const f = FORMULES.find(f => f.id === 'f1'), d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
          let date;
          for (let i = 0; i < 60; i++) { date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); if (getFormuleAvailability(f, date, 8, '15:00').ok) break; d.setDate(d.getDate() + 7); }
          state.booking.type = 'formule'; state.booking.mode = 'formule'; state.booking.formuleId = 'f1'; state.booking.pax = 8; state.booking.date = date; state.booking.preference = createDefaultFormulaPreference(); syncBookingTypeUi(); goStep(2);
        }, theme);
        await page.evaluate(async () => { await fetchSlots({ showLoading: false }); selectSlot(getCurrentFormulaAnchorSlotIndex()); });
        await page.waitForTimeout(1000);
        await page.locator('#step3 .step-foot-cta').click();
        await shot(page, 'contact-error-' + suffix);
        const contact = await page.evaluate(() => {
          const input = document.getElementById('fName'), label = document.querySelector('label[for="fName"]');
          const r = input.getBoundingClientRect(), l = label.getBoundingClientRect(), alert = document.querySelector('#alertBox .alert')?.getBoundingClientRect();
          const overlap = a => !!alert && a.left < alert.right && a.right > alert.left && a.top < alert.bottom && a.bottom > alert.top;
          return { focused: document.activeElement === input, invalid: input.getAttribute('aria-invalid'), errors: document.querySelectorAll('#step3 .field-error-message').length,
            overlap: overlap(r) || overlap(l), hit: document.elementFromPoint(r.x + r.width / 2, r.y + 3) === input };
        });
        ok(contact.focused && contact.invalid === 'true' && contact.errors === 3 && !contact.overlap && contact.hit, 'F3-inline-' + suffix, contact);
        await page.locator('#fName').fill('Client QA'); await page.locator('#fPhone').fill('+32 000 00 00 00'); await page.locator('#fEmail').fill('invalid');
        await page.locator('#step3 .step-foot-cta').click();
        ok(await page.evaluate(() => state.step === 3 && document.activeElement.id === 'fEmail' && document.querySelectorAll('#step3 [aria-invalid="true"]').length === 1), 'F3-invalid-email-' + suffix, 'malformed email stays blocked');
        await page.locator('#fEmail').fill('qa@example.test'); await page.locator('#step3 .step-foot-cta').click();
        ok(await page.evaluate(() => state.step === 4 && !document.querySelector('#step3 [aria-invalid="true"]') && !document.getElementById('alertBox').textContent.trim()), 'F3-recovery-' + suffix, 'valid fields reach recap');
      });
      }
      if (joue('quickbook-submit') && width === 1440 && theme === 'light') await scenario('quickbook-submit', async () => {
        await page.evaluate(() => {
          setView('staff'); state.staffMenuPage = 'planning'; renderStaff();
          const d = parseLocalDate(state.currentDate); d.setDate(d.getDate() + 7);
          const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
          openQuickBook({ date, startTime: '16:00', type: 'bowling', name: 'QA', email: 'invalid', pax: 4 });
          window.__PINLANE_QA_RES_POSTS__ = [];
        });
        await page.locator('#rvCreer').click();
        ok(await page.evaluate(() => !window.__PINLANE_QA_RES_POSTS__.length && !quickBookState.submitting && !!quickBookState.error && !!document.activeElement.closest('.qb-modal')), 'submit-invalid', 'invalid email blocked, button/focus recovered');
        // L e-mail vit sur la page Client (Les seances, 2026-11-03) ; on revient a
        // l accueil avant l envoi : la, sans envoi en vol, Echap fermerait la fenetre.
        await page.locator('#rsL-client').click();
        await page.locator('#qbEmail').fill('qa@example.test');
        await page.locator('#rsRetour').click();
        await page.evaluate(() => {
          const original = apiRequest;
          apiRequest = async (url, options = {}) => {
            // La creation reste en vol ; la simulation (dryRun) de la fenetre,
            // qui n est pas une creation, passe sans attendre (2026-10-08).
            if (String(url).includes('staff-reservations') && options.method === 'POST' && !JSON.parse(String(options.body || '{}')).dryRun) await new Promise(r => { window.__releaseSubmit = r; });
            return original(url, options);
          };
          window.__saveTask = Promise.all([saveQuickBook(), saveQuickBook()]).finally(() => { apiRequest = original; });
        });
        await page.waitForFunction(() => typeof window.__releaseSubmit === 'function');
        const surAccueil = await page.evaluate(() => !!document.querySelector('.qb-modal.is-q-activites'));
        await page.keyboard.press('Escape');
        ok(surAccueil && await page.evaluate(() => !!quickBookState?.submitting && !!document.activeElement.closest('.qb-modal')), 'submit-escape-pending', surAccueil ? 'pending POST remains visible' : 'Escape not played on the welcome page');
        await page.evaluate(async () => { window.__releaseSubmit(); await window.__saveTask; });
        ok(await page.evaluate(() => !quickBookState && window.__PINLANE_QA_RES_POSTS__.length === 1), 'submit-success-single', 'one simulated POST; modal closed');
      });
      if (joue('C2') && width === 1440 && theme === 'light') await scenario('C2', async () => {
        const attempts = await page.evaluate(async () => {
          setView('staff'); closePos(); closeQuickBook();
          const originalApi = apiRequest, originalRows = getStaffEmailRows;
          const posts = []; let fail = true;
          apiRequest = async (url, options = {}) => {
            const body = JSON.parse(options.body || '{}');
            if (body.action !== 'sendDirectEmail') return originalApi(url, options);
            posts.push(body);
            if (fail) throw new Error('Réponse perdue (fixture)');
            return { ok: true, communication: { id: 98765 } };
          };
          try {
            pv2Mail.draft = { to: 'qa@example.test', name: 'QA', subject: 'Objet QA', body: 'Message QA', when: 'now' };
            await pv2ComposerSend(); await pv2ComposerSend();
            pv2ComposerField('body', 'Correction QA'); fail = false;
            await pv2ComposerSend();
            pv2Mail.draft = { to: 'qa@example.test', name: 'QA', subject: 'Objet QA', body: 'Correction QA', when: 'now' };
            await pv2ComposerSend();
            // Depuis la refonte v4 (2026-09-17), on repond dans la CONVERSATION
            // ouverte (pv2Threads.detail), avec son brouillon pv2Threads.reply[id] :
            // meme contrat de tentative que le composeur. ouvrir() remet la
            // conversation apres l envoi reussi, qui la recharge en arriere-plan.
            const ouvrir = () => {
              pv2Threads.selectedId = '901';
              pv2Threads.detail = { id: '901', loaded: true, loading: false, error: '', serie: 0,
                thread: { id: 901, contactEmail: 'qa@example.test', contactName: 'QA', subject: 'QA' },
                messages: [{ id: 9876, direction: 'inbound', subject: 'QA', analysis: null }],
                contact: { email: 'qa@example.test', name: 'QA' } };
            };
            ouvrir(); fail = true;
            pv2Threads.reply['901'] = { subject: 'Re: QA', body: 'Réponse QA', signature: false };
            await pv2InboxReply('901'); await pv2InboxReply('901');
            pv2Threads.reply['901'].body = 'Réponse corrigée'; fail = false;
            await pv2InboxReply('901');
            ouvrir();
            pv2Threads.reply['901'] = { subject: 'Re: QA', body: 'Réponse corrigée', signature: false };
            await pv2InboxReply('901');
          } finally { apiRequest = originalApi; getStaffEmailRows = originalRows; }
          return posts;
        });
        ok(attempts.length === 8 && attempts.every(p => /^[A-Za-z0-9:_-]{8,128}$/.test(p.attemptId || '')), 'C2-contract', attempts.map(p => ({ key: p.attemptId, body: p.body })));
        for (const [offset, name] of [[0, 'composer'], [4, 'reply']]) {
          const p = attempts.slice(offset, offset + 4);
          ok(p.length === 4 && !!p[0].attemptId && p[0].attemptId === p[1].attemptId && p[1].attemptId !== p[2].attemptId && p[2].attemptId !== p[3].attemptId, 'C2-retry-edit-new-' + name, p.map(x => x.attemptId));
        }
      });
      await context.close();
    }
  } finally {
    await browser.close(); server.close();
    ok(errors.length === 0, 'browser-errors', errors);
    if (rapport) {
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, blocked }, null, 2));
      console.log(JSON.stringify({ output: OUT, pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length }));
      if (results.some(r => !r.pass)) process.exitCode = 1;
    }
  }
  return results.slice();
}

// LES CONTRE-PREUVES (2026-11-07, --contre-preuves). Chaque regle retiree au texte servi
// fait rougir ses verifications a 1180 et a 1440, ou le planning remplit l ecran ; chaque
// ancre existe une fois et une seule. Une verification deja rouge sans la mutation ne
// prouve rien : elle doit passer sans elle et rougir avec.
const MUTATIONS = [
  // Le focus ne revient qu a l ouvreur encore dans le document, comme avant.
  { nom: 'focus-rendu-a-l-ancien-ouvreur', fichier: 'assets/app-main.js',
    de: '  if (!ouvreur || ouvreur.isConnected) return ouvreur || null;\n',
    vers: '  if (!ouvreur || ouvreur.isConnected) return ouvreur || null;\n  return null;\n',
    rougit: ['F1-close-', 'sheet-close-'] },
  // La grille se reecrit sans rendre le focus a la case ou a la carte qui l avait.
  { nom: 'focus-perdu-dans-la-grille', fichier: 'assets/app-main.js',
    de: '  if (focusDansLaGrille && !focusDansLaGrille.isConnected) equivalentDeLOuvreur(focusDansLaGrille)?.focus({ preventScroll: true });\n',
    vers: '',
    rougit: ['F1-grille-', 'sheet-grille-'] },
  // Le premier rendu mesure la boite avant que la barre pose sa hauteur : le tic suivant
  // change la hauteur d heure et reecrit la grille.
  { nom: 'boite-mesuree-avant-la-barre', fichier: 'assets/app-main.js',
    de: "    if (typeof window.pbPoserBas === 'function') window.pbPoserBas();\n",
    vers: '',
    rougit: ['F1-tic-fige-'] },
];
async function contrePreuves() {
  const tailles = ['1180-light', '1440-dark'], seulement = ['F1', 'F4'];
  let rouges = 0;
  const dire = (condition, id, detail) => { console.log((condition ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(detail)); if (!condition) rouges += 1; return condition; };
  silence = true;
  let sans;
  try { sans = await main({ seulement, tailles, rapport: false }); } finally { silence = false; }
  for (const m of MUTATIONS) {
    const n = fs.readFileSync(path.join(ROOT, m.fichier), 'utf8').replace(/\r\n/g, '\n').split(m.de).length - 1;
    if (!dire(n === 1, `[CP] ${m.nom} : ancre unique`, n)) continue;
    mutation = m; silence = true;
    let avec;
    try { avec = await main({ seulement, tailles, rapport: false }); } finally { mutation = null; silence = false; }
    const visees = avec.filter((r) => m.rougit.some((p) => r.id.startsWith(p)));
    const mordent = visees.filter((r) => !r.pass && (sans.find((s) => s.id === r.id) || {}).pass);
    dire(visees.length > 0 && mordent.length === visees.length, `[CP] ${m.nom} : ${m.rougit.join(', ')} rougissent`, { visees: visees.map((r) => r.id), mordent: mordent.map((r) => r.id) });
  }
  console.log(rouges ? `preprod-frontend contre-preuves : FAIL ${rouges}` : 'preprod-frontend contre-preuves : ALL OK');
  if (rouges) process.exitCode = 1;
}
module.exports = { main, close: () => server.close() };
if (require.main === module) (process.argv.includes('--contre-preuves') ? contrePreuves() : main()).catch(error => { console.error(error); server.close(); process.exit(1); });
