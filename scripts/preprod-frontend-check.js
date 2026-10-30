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
function ok(condition, id, detail) {
  results.push({ id, pass: !!condition, detail });
  console.log((condition ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(detail));
}
async function scenario(id, run) {
  try { await run(); } catch (error) { ok(false, id + ':execution', error.message); }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  if (req.method !== 'GET' || !/^(index\.html$|assets\/|favicon\.)/.test(rel) || rel.includes('..')) {
    res.writeHead(403); return res.end('Fixture not defined');
  }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': (mime[path.extname(rel)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(err ? '' : data);
  });
});
async function shot(page, name) {
  await page.waitForTimeout(900);
  if (captureEnabled) await page.screenshot({ path: path.join(OUT, name + '.png') });
}
async function contained(page, selector, count = 30) {
  const escaped = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
    if (!(await page.evaluate(s => !!document.activeElement.closest(s), selector))) escaped.push(i);
  }
  return escaped;
}
async function main({ roiOnly = false, capture = false } = {}) {
  captureEnabled = capture;
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  BASE_URL = 'http://127.0.0.1:' + server.address().port;
  const installQaApi = loadFixture('installQaApi'), seedStressDay = loadFixture('seedStressDay');
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [320, 390, 768, 1180, 1440]) for (const theme of ['light', 'dark']) {
      const suffix = width + '-' + theme;
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, hasTouch: width <= 1180, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin === BASE_URL) return route.continue();
        blocked.push(u.hostname); return route.abort();
      });
      const page = await context.newPage(); page.setDefaultTimeout(4000);
      page.on('pageerror', err => errors.push({ suffix, message: err.message }));
      await installQaApi(page);
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof setView === 'function');
      await seedStressDay(page);
      await page.waitForFunction(() => !!window.pv2Mail);
      await page.evaluate(t => { state.staffTheme = t; document.documentElement.dataset.theme = t; renderStaff(); }, theme);
      await page.waitForTimeout(900);
      if (!roiOnly) {
      await scenario('F5-' + suffix, async () => {
        const sizes = await page.locator('.lane-header .settings').evaluateAll(list => list.map(el => {
          const r = el.getBoundingClientRect(), head = el.closest('.lane-header').getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + 2, r.y + 2);
          return { width: r.width, height: r.height, inside: r.top >= head.top && r.bottom <= head.bottom && r.left >= head.left && r.right <= head.right, hit: hit === el || el.contains(hit) };
        }).filter(r => r.width > 0));
        ok(width <= 768 ? sizes.length === 0 : sizes.length >= 8 && sizes.every(r => r.width >= 44 && r.height >= 44 && r.inside && r.hit), 'F5-' + suffix, sizes);
        await shot(page, 'planning-' + suffix);
      });
      await scenario('F1-' + suffix, async () => {
        // A real focused trigger, with the existing planning click handler.
        const trigger = page.locator('.slot-cell.clickable').first();
        await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
        await page.evaluate(() => { window.__trigger = document.activeElement; });
        await page.keyboard.press('Enter');
        const ax = await page.evaluate(() => {
          const modal = document.querySelector('.qb-modal');
          return { role: modal?.getAttribute('role'), name: document.getElementById(modal?.getAttribute('aria-labelledby'))?.textContent,
            inside: modal?.contains(document.activeElement), close: modal?.querySelector('.close-btn, .rv-fermer')?.getAttribute('aria-label'),
            fields: [...modal.querySelectorAll('input,textarea,select')].map(el => ({ id: el.id, named: !!(el.labels?.length || el.getAttribute('aria-label')) })) };
        });
        ok(ax.role === 'dialog' && ax.name && ax.inside && ax.close && ax.fields.every(f => f.named), 'F1-semantics-' + suffix, ax);
        ok((await contained(page, '.qb-modal')).length === 0, 'F1-trap-' + suffix, '30 mixed Tab/Shift+Tab');
        // v5 : le detail s ouvre au chevron de la ligne ; le re-rendu lui
        // garde le focus et le chevron dit qu il a bascule.
        const chevron = page.locator('#quickBookOverlay .rv-ouvrir[aria-controls]').first();
        const chevronId = await chevron.getAttribute('id');
        const avant = await chevron.getAttribute('aria-expanded');
        await chevron.click();
        const restored = await page.evaluate(({ id, avant }) => document.activeElement.id === id && document.activeElement.getAttribute('aria-expanded') !== avant, { id: chevronId, avant });
        ok(restored, 'F1-rerender-' + suffix, 'line chevron retains focus and toggles');
        await shot(page, 'quickbook-' + suffix);
        await page.keyboard.press('Escape');
        ok(await page.evaluate(() => !quickBookState && document.activeElement === window.__trigger), 'F1-close-' + suffix, 'Escape and opener focus');
        await page.evaluate(() => closeQuickBook());
      });
      if (width === 1440 && theme === 'light') await scenario('dialog-edge-cases', async () => {
        // Le jour vient du scenario, jamais de l heure du gate : une fenetre
        // ouverte pour la demi-heure qui vient est « au comptoir » (un champ
        // unique, maquette v5), une autre heure redemande telephone et nom.
        const champs = (auComptoir) => page.evaluate((auComptoir) => {
          let date = todayStr(), startTime = numToTime(Math.min(23.5, Math.ceil(currentTimeDecimal() * 2) / 2));
          if (!auComptoir) {
            const d = parseLocalDate(state.currentDate); d.setDate(d.getDate() + 7);
            date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
            startTime = '16:00';
          }
          openQuickBook({ date, startTime }); toggleQuickBookMore();
          const lus = [...document.querySelectorAll('.qb-modal input,.qb-modal textarea')].map(el => ({ id: el.id, name: el.labels?.[0]?.textContent || el.getAttribute('aria-label') }));
          closeQuickBook();
          return lus;
        }, auComptoir);
        const full = await champs(false);
        // v5 : le formulaire complet = le jour, les joueurs, le contact, l e-mail
        // et la note ; l heure se regle a l horloge de chaque ligne.
        ok(['qbDate', 'qbPax', 'qbPhone', 'qbName', 'qbEmail', 'qbNotes'].every((id) => full.some((f) => f.id === id)) && full.every(f => f.name), 'F1-full-fields', full);
        const comptoir = await champs(true);
        ok(['qbDate', 'qbPax', 'qbQui', 'qbPhone', 'qbEmail', 'qbNotes'].every((id) => comptoir.some((f) => f.id === id)) && !comptoir.some((f) => f.id === 'qbName') && comptoir.every(f => f.name), 'F1-full-fields-comptoir', comptoir);
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
      await scenario('F4-sheet-' + suffix, async () => {
        await page.evaluate(() => { document.querySelector('.booking[data-booking-res-id="9002"]').focus(); openPos(9002); });
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
        ok(await page.evaluate(() => window.__answer === false && document.activeElement === window.__confirmTrigger && !!state.selectedRes), 'F4-cancel-restore-' + suffix, 'Escape closes only confirmation and restores sheet focus');
        await page.evaluate(() => { staffConfirm({ title: 'Contrôle positif' }).then(v => window.__answer = v); });
        await page.locator('[data-role="confirm-ok"]').click();
        ok(await page.evaluate(() => window.__answer === true && document.activeElement === window.__confirmTrigger), 'F4-confirm-restore-' + suffix, 'positive confirmation');
        await page.keyboard.press('Escape');
        ok(await page.evaluate(() => !state.selectedRes && document.activeElement.matches('.booking')), 'sheet-close-' + suffix, 'sheet Escape and opener restoration');
        await page.evaluate(() => closePos());
      });
      await scenario('F2-' + suffix, async () => {
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
      await scenario('F3-' + suffix, async () => {
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
      await scenario('C6-visual-' + suffix, async () => {
        await page.evaluate(() => {
          setView('staff'); closeQuickBook(); closePos();
          // The real painter owns the center+account scope; do not substitute
          // a plain center id, which would invalidate the fixture on next paint.
          state.staffMenuPage = 'campaigns'; renderStaff(); renderStaffCampaignsPage();
          mkBrief.data = { receipts: [], paie: { available: false, unavailableReason: 'query_failed', euros: null, venues: null, sent: null, reviewClicks: null, days: 30, young: false, quietWindow: false,
            sources: ['Anniversaires', 'Relances', 'Campagnes', 'Suivi de visite', 'Messages directs', 'Autres'].map(label => ({ label, sent: null, revenue: null })) } };
          mkBrief.tab = 'results'; renderStaff(); renderStaffCampaignsPage();
        });
        const hero = page.locator('.mkw-hero');
        await hero.scrollIntoViewIfNeeded();
        ok(await hero.locator('.mkw-src').count() === 6 && (await hero.innerText()).includes('Mesure indisponible') && !(await hero.innerText()).includes('null'), 'C6-render-' + suffix, 'unavailable with six source labels');
        await shot(page, 'roi-unavailable-' + suffix);
      });
      if (!roiOnly && width === 1440 && theme === 'light') await scenario('quickbook-submit', async () => {
        await page.evaluate(() => {
          setView('staff'); state.staffMenuPage = 'planning'; renderStaff();
          const d = parseLocalDate(state.currentDate); d.setDate(d.getDate() + 7);
          const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
          openQuickBook({ date, startTime: '16:00', type: 'bowling', name: 'QA', email: 'invalid', pax: 4 });
          window.__PINLANE_QA_RES_POSTS__ = [];
        });
        await page.locator('#rvCreer').click();
        ok(await page.evaluate(() => !window.__PINLANE_QA_RES_POSTS__.length && !quickBookState.submitting && !!quickBookState.error && !!document.activeElement.closest('.qb-modal')), 'submit-invalid', 'invalid email blocked, button/focus recovered');
        await page.locator('#qbEmail').fill('qa@example.test');
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
        await page.keyboard.press('Escape');
        ok(await page.evaluate(() => !!quickBookState?.submitting && !!document.activeElement.closest('.qb-modal')), 'submit-escape-pending', 'pending POST remains visible');
        await page.evaluate(async () => { window.__releaseSubmit(); await window.__saveTask; });
        ok(await page.evaluate(() => !quickBookState && window.__PINLANE_QA_RES_POSTS__.length === 1), 'submit-success-single', 'one simulated POST; modal closed');
      });
      if (!roiOnly && width === 1440 && theme === 'light') await scenario('C2', async () => {
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
    fs.writeFileSync(path.join(OUT, roiOnly ? 'roi-results.json' : 'results.json'), JSON.stringify({ results, errors, blocked }, null, 2));
    console.log(JSON.stringify({ output: OUT, pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length }));
    if (results.some(r => !r.pass)) process.exitCode = 1;
  }
}
module.exports = { main, close: () => server.close() };
if (require.main === module) main().catch(error => { console.error(error); server.close(); process.exit(1); });
