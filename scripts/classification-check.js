// Vérifie que la classification client/groupe (seuils groupe + formules annif),
// éditable côté Établissement, pilote réellement isGroup/hasBirthday côté staff,
// et que l'éditeur collecte/envoie bien la classification.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4200;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

function serveStatic() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { response.writeHead(403); response.end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT: ${msg}`); }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);

  // ---- A. La config pilote isGroup / hasBirthday --------------------------
  const logic = await page.evaluate(() => {
    const today = todayStr();
    const res = (name, extra) => Object.assign({ name, phone: '0470' + name.length, email: '', date: today, startTime: '18:00', duration: 1, lanes: [1], status: 'confirmed', pax: 5, price: 50, type: 'bowling', label: 'Bowling' }, extra);
    const reservations = [
      res('Petit Groupe', { pax: 5 }),                          // 5 joueurs, pas de formule
      res('Annif F1', { pax: 6, type: 'formule', formuleId: 'f1', label: 'FORMULE 1' }),
      res('Solo', { pax: 2 }),
    ];
    const rowsBy = (rows) => Object.fromEntries(rows.map(r => [r.name, r]));

    // Défaut (rien servi) : groupe ≥10, annif = f1..f8
    delete state.staffClassification;
    const d = rowsBy(buildStaffClientRowsFromReservations(reservations));
    const out = {};
    out.defaultPetitGroupeIsGroup = d['Petit Groupe'].isGroup;   // 5 < 10 → false
    out.defaultAnnifF1 = d['Annif F1'].hasBirthday;              // f1 ∈ défaut → true
    out.defaultAnnifF1Group = d['Annif F1'].isGroup;            // formule → groupe (défaut)

    // Config custom servie par le poll : groupe ≥4, annif = f2 seulement
    state.staffClassification = { groupMinPax: 4, groupMinCumulative: 18, countFormulaAsGroup: false, sizeTiers: { medium: 12, large: 30, xl: 60 }, birthdayFromFormula: true, birthdayFormulaIds: ['f2'] };
    const c = rowsBy(buildStaffClientRowsFromReservations(reservations));
    out.customPetitGroupeIsGroup = c['Petit Groupe'].isGroup;   // 5 ≥ 4 → true
    out.customAnnifF1Birthday = c['Annif F1'].hasBirthday;      // f1 ∉ ['f2'] → false
    out.customAnnifF1Group = c['Annif F1'].isGroup;            // countFormulaAsGroup false, pax 6 ≥4 → true (via pax)
    out.customSoloGroup = c['Solo'].isGroup;                   // 2 < 4 → false
    return out;
  });
  assert(logic.defaultPetitGroupeIsGroup === false, 'défaut : 5 joueurs sans formule = pas un groupe');
  assert(logic.defaultAnnifF1 === true, 'défaut : formule F1 = anniversaire');
  assert(logic.defaultAnnifF1Group === true, 'défaut : une formule = groupe');
  assert(logic.customPetitGroupeIsGroup === true, 'config seuil 4 : 5 joueurs = groupe');
  assert(logic.customAnnifF1Birthday === false, 'config annif=[f2] : F1 n\'est plus anniversaire');
  assert(logic.customAnnifF1Group === true, 'config : F1 reste groupe par le nombre de joueurs');
  assert(logic.customSoloGroup === false, 'config seuil 4 : 2 joueurs = pas un groupe');

  // ---- B. L'éditeur Établissement affiche + envoie la classification -------
  const sent = await page.evaluate(async () => {
    // Session direction + cache config avec un centre portant une classification.
    storeStaffAuthSession({ cookieBacked: true, centerId: 'libramont', permissions: ['settings.manage', 'direction.view', 'clients.view'], role: { name: 'dir', locked: false }, member: { name: 'Dir' } });
    staffCenterConfigCache.loaded = true; staffCenterConfigCache.loading = false; staffCenterConfigCache.error = '';
    staffCenterConfigCache.activities = [];
    staffCenterConfigCache.centers = [{
      id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', timezone: 'Europe/Brussels',
      resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 }, laser: { weaponCount: 30, parallelLaunches: 1 } },
      defaultSchedule: { regular: {}, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: ['manual'] }, offerAvailability: {},
      classification: { groupMinPax: 10, groupMinCumulative: 18, countFormulaAsGroup: true, sizeTiers: { medium: 9, large: 25, xl: 70 }, birthdayFromFormula: true, birthdayFormulaIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] },
    }];
    state.establishmentCenterId = 'libramont';
    state.establishmentEditing = true;
    state.view = 'staff'; state.staffMenuPage = 'establishment';
    document.body.classList.add('staff-mode');
    // Monte l'éditeur dans le DOM.
    document.getElementById('staffUtilityPage').innerHTML = renderStaffUtilityEstablishment();

    // Les champs de classification existent et reflètent la config.
    const groupInput = document.getElementById('estab-groupMinPax');
    const bdayF1 = document.getElementById('estab-bday-f1');
    const present = !!groupInput && !!bdayF1;
    // Les « paliers de taille » n ont plus d ecran (leur seul lecteur etait la
    // page Groupes, supprimee) : aucun champ ne doit les proposer.
    const tierInputs = document.querySelectorAll('[id^="estab-tier-"]').length;
    // Modifie le seuil groupe + décoche f1 comme formule annif.
    if (groupInput) groupInput.value = '6';
    if (bdayF1) { bdayF1.checked = false; }

    // Intercepte l'envoi pour capturer le payload saveCenterConfig.
    let captured = null;
    const realRequest = window.apiRequest;
    window.apiRequest = async (url, opts) => {
      try { const b = opts && opts.body ? JSON.parse(opts.body) : {}; if (b.action === 'saveCenterConfig') captured = b; } catch (e) {}
      return { ok: true, config: {}, center: {} };
    };
    // loadStaffCenterConfig est rappelé après save : on le neutralise.
    window.loadStaffCenterConfig = async () => {};
    await submitCenterConfig('libramont');
    window.apiRequest = realRequest;
    return { present, captured, tierInputs };
  });
  assert(sent.present, 'éditeur : champs de classification présents');
  assert(sent.captured && sent.captured.config && sent.captured.config.classification, 'save envoie une classification');
  assert(sent.captured.config.classification.groupMinPax === 6, `seuil groupe édité envoyé (reçu ${sent.captured.config.classification.groupMinPax})`);
  assert(!sent.captured.config.classification.birthdayFormulaIds.includes('f1'), 'f1 décochée n\'est plus dans les formules annif');
  assert(sent.captured.config.classification.birthdayFormulaIds.includes('f2'), 'f2 reste dans les formules annif');
  assert(sent.tierInputs === 0, `plus aucun champ « paliers de taille » (${sent.tierInputs} trouve(s))`);
  assert(JSON.stringify(sent.captured.config.classification.sizeTiers) === JSON.stringify({ medium: 9, large: 25, xl: 70 }),
    `les paliers deja enregistres repartent tels quels (recu ${JSON.stringify(sent.captured.config.classification.sizeTiers)})`);

  const critical = pageErrors.filter((e) => !/ResizeObserver|favicon/i.test(e));
  if (critical.length) { console.log('PAGE ERRORS:', JSON.stringify(critical, null, 1)); throw new Error(`${critical.length} erreur(s) page`); }
  await browser.close();
  server.close();
  console.log('CLASSIFICATION CHECK: ALL OK');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
