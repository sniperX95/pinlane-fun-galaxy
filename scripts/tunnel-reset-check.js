// APRES UNE RESERVATION, LE TUNNEL REPART PROPRE.
//
// Deux defauts signales par Movsar (2026-09-02), reproduits par un lecteur le
// 2026-09-03, verrouilles ici sur le VRAI tunnel dans un navigateur :
//
//   A. LA DATE NE RECULE JAMAIS. resetBooking() reposait la date sur
//      todayStr() en dur : apres une reservation le 12, un nouveau dossier
//      repartait sur aujourd hui, parfois un jour FERME (lundi), parfois une
//      journee deja terminee (le soir, apres la fermeture). La regle : garder
//      la date choisie si elle est encore reservable, sinon la PROCHAINE date
//      ouverte. Jamais une date en dur : firstBookableDate lit getSchedule,
//      c est a dire le planning EDITABLE du centre (consigne Movsar : les
//      horaires se changent a volonte, rien de code en dur).
//
//   B. LE BOUTON CONFIRMER SE DESCELLE. Le sceau (disque + coche) restait
//      dessine quand on relancait une reservation : resetBooking ne relachait
//      jamais setBookingSubmitBusy, et une garde empechait de retirer
//      is-sealed. On verifie le COMPORTEMENT (opacite du libelle), pas la
//      presence d une classe.
//
// Chaque propriete est d abord MONTEE (on prouve que la situation testee
// existe : aujourd hui ferme, ou deja passe, ou le sceau bien engage) avant
// d etre jugee, sinon un vert ne voudrait rien dire. Puis une CONTRE-EPREUVE
// par mutation (--mutate) casse chaque correctif et exige que le gate rougisse.
//
// Lancement : node scripts/tunnel-reset-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'assets/booking-core.js');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_RESET_PORT || 4623);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// installQaApi vit dans run-visual-qa.js : session staff + API stubbee + le POST
// /api/public-reservations stocke dans window.__PINLANE_QA_PUBLIC_POSTS__. On la
// reutilise sans la dupliquer (motif de scripts/promo-shots-hd.js).
function loadFromVisualQa(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8');
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error(name + ' introuvable dans run-visual-qa.js');
  const end = new RegExp('\\r?\\n\\}\\r?\\n').exec(src.slice(start));
  if (!end) throw new Error('fin de ' + name + ' introuvable');
  const body = src.slice(start, start + end.index + end[0].length);
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', body + '\nreturn ' + name + ';')(BASE_URL);
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

// Lit l etat DATE et BOUTON dans la page.
const SNAPSHOT = `(() => {
  const b = document.getElementById('btnConfirmBooking');
  const label = b && b.querySelector('.btn-label');
  const sched = (typeof getSchedule === 'function') ? getSchedule(state.booking.date, state.isHolidayMode) : null;
  return {
    today: todayStr(),
    date: state.booking.date,
    fDate: (document.getElementById('fDate') || {}).value,
    open: !!sched,
    step: state.step,
    btnClass: b ? b.className : null,
    labelOpacity: label ? Number(getComputedStyle(label).opacity) : null,
  };
})()`;

async function playThenReset(browser, installQaApi, { fixedTime, chosenDate, startTime }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  await p.clock.setFixedTime(new Date(fixedTime));
  await installQaApi(p);
  await p.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await p.evaluate(() => setView('client'));
  await p.waitForTimeout(150);

  const mount = await p.evaluate(({ chosenDate }) => {
    const todaySched = (typeof getSchedule === 'function') ? getSchedule(todayStr(), state.isHolidayMode) : null;
    const chosenSched = (typeof getSchedule === 'function') ? getSchedule(chosenDate, state.isHolidayMode) : null;
    const now = (typeof currentTimeDecimal === 'function') ? currentTimeDecimal() : null;
    return {
      todayOpen: !!todaySched,
      todayClosedNow: !!todaySched && now !== null && now >= todaySched.close,
      chosenOpen: !!chosenSched,
      today: todayStr(),
    };
  }, { chosenDate });

  const afterSuccess = await p.evaluate(async ({ chosenDate, startTime }) => {
    state.booking = Object.assign({}, state.booking, {
      name: 'QA Reset', phone: '0470000000', email: 'qa@pinlane.test', pax: 4,
      date: chosenDate, type: 'bowling', formuleId: '', duration: 1, totalDuration: 1,
      laneCount: 1, startTime, allocatedLanes: [], mode: 'carte',
      activities: { bowling: { duration: 1 } },
    });
    const field = document.getElementById('fDate');
    if (field) field.value = chosenDate;
    await confirmBooking();
    const b = document.getElementById('btnConfirmBooking');
    const label = b && b.querySelector('.btn-label');
    return {
      step: state.step,
      btnClass: b ? b.className : null,
      labelOpacity: label ? Number(getComputedStyle(label).opacity) : null,
      posted: (window.__PINLANE_QA_PUBLIC_POSTS__ || []).length,
    };
  }, { chosenDate, startTime });

  // « Faire une autre reservation » : le bouton exact de l ecran 5.
  const resetClicked = await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#step5 button, #successView button, [onclick*="resetBooking"]'))
      .find(el => /resetBooking/.test(el.getAttribute('onclick') || ''));
    if (btn) { btn.click(); return true; }
    if (typeof resetBooking === 'function') { resetBooking(); return 'fallback'; }
    return false;
  });
  await p.waitForTimeout(150);
  const afterReset = await p.evaluate(SNAPSHOT);

  await context.close();
  return { mount, afterSuccess, afterReset, resetClicked };
}

async function main() {
  const server = await serve();
  const installQaApi = loadFromVisualQa('installQaApi');
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  try {
    // --- 1. Un LUNDI (aujourd hui ferme). La date choisie ouverte est gardee,
    //        jamais remplacee par aujourd hui-ferme. ---
    const lundi = await playThenReset(browser, installQaApi, {
      fixedTime: '2026-09-07T12:00:00+02:00', chosenDate: '2026-09-12', startTime: '15:00',
    });
    ok(lundi.mount.todayOpen === false, `[lundi] MONTAGE : aujourd hui (${lundi.mount.today}) est bien ferme`);
    ok(lundi.mount.chosenOpen === true, '[lundi] MONTAGE : la date choisie (2026-09-12) est ouverte');
    ok(lundi.afterSuccess.step === 5, `[lundi] la reservation aboutit (etape ${lundi.afterSuccess.step}, ${lundi.afterSuccess.posted} POST)`);
    ok(lundi.afterReset.date >= lundi.afterReset.today, `[lundi] la date ne recule pas dans le passe (${lundi.afterReset.date} >= ${lundi.afterReset.today})`);
    ok(lundi.afterReset.open === true, `[lundi] apres reset, la date n est jamais un jour ferme (${lundi.afterReset.date}, ouvert=${lundi.afterReset.open})`);
    ok(lundi.afterReset.date === '2026-09-12', `[lundi] la date choisie encore reservable est CONSERVEE (${lundi.afterReset.date})`);
    ok(lundi.afterReset.fDate === lundi.afterReset.date, `[lundi] le champ #fDate suit l etat (${lundi.afterReset.fDate})`);

    // --- 2. LE SOIR, apres la fermeture (dimanche 23:30, ferme a 22:00). Le
    //        reset ne repose pas le tunnel sur une journee deja terminee. ---
    const soir = await playThenReset(browser, installQaApi, {
      fixedTime: '2026-09-06T23:30:00+02:00', chosenDate: '2026-09-12', startTime: '15:00',
    });
    ok(soir.mount.todayOpen === true && soir.mount.todayClosedNow === true, `[soir] MONTAGE : aujourd hui ouvre mais a deja ferme (closedNow=${soir.mount.todayClosedNow})`);
    ok(soir.afterReset.open === true, `[soir] apres reset, la date est une journee ouvrable (${soir.afterReset.date})`);
    ok(soir.afterReset.date === '2026-09-12', `[soir] la date choisie future est CONSERVEE, pas remplacee par la soiree finie (${soir.afterReset.date})`);

    // --- 3. LE BOUTON CONFIRMER (propriete B), mesure sur le cas lundi. ---
    ok(/is-sealed/.test(lundi.afterSuccess.btnClass || '') && lundi.afterSuccess.labelOpacity === 0,
      `[bouton] MONTAGE : au succes le sceau est engage (classe is-sealed, libelle opacite ${lundi.afterSuccess.labelOpacity})`);
    ok(!/is-seal(ed|ing)/.test(lundi.afterReset.btnClass || ''),
      `[bouton] apres reset, plus aucune classe de sceau (${lundi.afterReset.btnClass})`);
    ok(lundi.afterReset.labelOpacity === 1,
      `[bouton] apres reset, le libelle Confirmer est de nouveau visible (opacite ${lundi.afterReset.labelOpacity})`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\ntunnel-reset-check: ${failures} defaut(s).`); process.exit(1); }
  console.log('\ntunnel-reset-check: ALL OK (la date ne recule jamais sur un jour ferme, le bouton repart propre)');
}

// Contre-epreuve : on casse chaque correctif tour a tour et on exige un echec.
if (process.argv.includes('--mutate')) {
  const coreSrc = fs.readFileSync(CORE, 'utf8');
  const appSrc = fs.readFileSync(APP, 'utf8');
  const EOL = appSrc.includes('\r\n') ? '\r\n' : '\n';
  const withEol = (s) => s.replace(/\n/g, EOL);
  const mutations = [
    { file: APP, src: appSrc, from: 'date: nextBookableDate,', to: 'date: todayStr(),', label: 'date remise a aujourd hui' },
    { file: APP, src: appSrc, from: withEol('  setBookingSubmitBusy(false);\n  // On garde la date'), to: withEol('  // On garde la date'), label: 'sceau non relache au reset' },
  ];
  const { spawnSync } = require('child_process');
  let bad = 0;
  for (const m of mutations) {
    if (!m.src.includes(m.from)) { console.error(`mutation impossible (${m.label}) : motif introuvable`); process.exit(1); }
    fs.writeFileSync(m.file, m.src.replace(m.from, m.to));
    const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
    fs.writeFileSync(m.file, m.src);
    if (run.status === 0) { console.error(`CONTRE-EPREUVE RATEE (${m.label}) : le gate reste vert.`); bad += 1; }
    else { console.log(`contre-epreuve OK (${m.label}) : le gate rougit, fichier restaure.`); }
  }
  process.exit(bad ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
