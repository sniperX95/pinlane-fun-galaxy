// LE PRIX D UN DOSSIER NE CHANGE PAS PARCE QU ON L A REGARDE.
//
// Au comptoir, "Adapter pour ce dossier" ouvre le panneau de composition d une
// reservation. Mesure du 2026-08-31 : la SIMPLE OUVERTURE du panneau, sans un
// seul clic sur une case, ecrasait le prix du dossier par un total recalcule
// aux valeurs par DEFAUT.
//
// Fixture : 3 tables de billard reservees 2 heures a 20 EUR la table et par
// heure, soit 120 EUR reellement vendus au comptoir. A l ouverture du panneau,
// le champ tombait a 20 EUR, et un simple "Enregistrer" envoyait price=20 au
// serveur - 100 EUR perdus, 83 % du dossier - pendant que program.items
// montrait toujours units:3, hours:2 intacts en base. Invisible sur la fiche,
// visible seulement en caisse.
//
// LA CHAINE, en trois maillons, tous dans assets/app-main.js :
//   1. buildEditProgramFromReservation ne recopiait duration/games QUE pour le
//      bowling et le laser. Pour toute autre activite elle ne gardait que le
//      on/off, en jetant units / hours / minutes / participants.
//   2. getEditProgramItems reconstruisait donc des lignes nues.
//   3. estimerPrixProgramme appelait getFreeActivityPrice sans ces valeurs, qui
//      retombaient sur leurs defauts (units=1, hours=1) : 20 x 1 x 1 = 20.
// Le tunnel public les passait correctement depuis toujours : seul le chemin du
// COMPTOIR etait touche.
//
// Ce gate pilote un VRAI navigateur sur le VRAI bundle (montage repris de
// scripts/edit-sheet-check.js). Il verifie deux choses, dans cet ordre :
//   A. ouvrir le panneau ne change RIEN au prix ;
//   B. enregistrer sans avoir rien touche renvoie le prix REEL au serveur.
//
// Contre-epreuve : `--mutate` remet l oubli des options dans le bundle, prouve
// que le gate rougit, et restaure par edition inverse.
//
// Lancement : node scripts/edit-price-options-check.js
const PORT = Number(process.env.PINLANE_EDIT_PRICE_PORT || 4503);
const http = require('http');
const fs = require('fs');
const p = require('path');
// Le depot est celui qui contient ce script. Un chemin Windows ecrit en dur ici
// faisait mourir la CI Linux sur ce gate depuis le 2026-08-31.
const REPO = p.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const EDGE = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = p.join(REPO, decodeURIComponent(u.pathname));
  if (u.pathname === '/') f = p.join(REPO, 'index.html');
  fs.readFile(f, (e, c) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(c);
  });
});

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

// Contre-epreuve : on remet l oubli des reglages dans le bundle, on prouve que
// le gate rougit, et on restaure par edition inverse.
if (process.argv.includes('--mutate')) {
  const APP = p.join(REPO, 'assets', 'app-main.js');
  const source = fs.readFileSync(APP, 'utf8');
  const marqueur = 'if (Object.keys(reglages).length) etat.othersOptions[id] = reglages;';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le report des reglages est introuvable dans assets/app-main.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, 'void reglages;');
  fs.writeFileSync(APP, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, PINLANE_EDIT_PRICE_PORT: String(PORT + 1) } });
  fs.writeFileSync(APP, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans le report des reglages.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans le report des reglages, le gate rougit ; bundle restaure a l identique.');
  process.exit(0);
}

srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()); });
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  await pg.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.cancel', 'reservations.status', 'clients.view', 'payments.view', 'payments.markPaid', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const localDay = new Date();
    const today = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;
    // Reservation reelle : 3 tables de billard reservees pour 2 HEURES.
    // Prix facture reel au dossier = 120 EUR (20 EUR/table/heure x 3 tables x 2h).
    // C'est EXACTEMENT ce que le staff a vendu au comptoir.
    const R = [
      {
        id: 9001, name: 'BILLARD TEST', phone: '+32487000000', email: 'b@x.be', date: today,
        startTime: '18:00', duration: 2, pax: 6, price: 120, basePrice: 120,
        type: 'activite', label: 'Billards', lanes: [], status: 'paid', centerId: 'libramont',
        channel: 'staff', activityProgress: {}, extras: [],
        program: { items: [{ activityId: 'billards', units: 3, hours: 2, pax: 6 }] },
      },
    ];
    const ACTIVITIES = [
      { id: 'billards', name: 'Billards', priceType: 'per_unit_hour', priceValue: 20, unitLabel: 'par table et par heure', bookable: true, order: 5 },
    ];
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: R, laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: R, laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_PATCH__ = window.__QA_PATCH__ || [];
        window.__QA_PATCH__.push(body);
        const idx = R.findIndex((r) => String(r.id) === String(body.id));
        const base = idx >= 0 ? R[idx] : R[0];
        const merged = { ...base, ...body };
        if (idx >= 0) R[idx] = merged;
        return J({ ok: true, reservation: merged });
      }
      if (u.pathname === '/api/staff-reservations') return J({ ok: true, reservation: R[0] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES, center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });

  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => typeof window.setView === 'function');
  await pg.evaluate(() => window.setView('staff'));
  await pg.waitForTimeout(1800);

  await pg.waitForFunction(() => typeof window.openStaffReservationDetail === 'function', { timeout: 20000 });
  await pg.evaluate((rid) => { window.openStaffReservationDetail(rid); }, 9001);
  await pg.waitForSelector('.pos-tabs, .edit-form, [role="tab"]', { timeout: 15000 }).catch(() => {});
  await pg.evaluate(() => {
    const fiche = document.querySelector('#posOverlay, .pos-sheet') || document;
    const tab = [...fiche.querySelectorAll('button, a, [role="tab"]')].find((t) => /^Modifier$/i.test(t.textContent.trim()));
    if (tab) tab.click();
  });
  await pg.waitForSelector('.edit-form', { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(400);

  const before = await pg.evaluate(() => ({
    stateEditPrice: window.state && window.state.editState ? window.state.editState.price : undefined,
    selectedResPrice: window.state && window.state.selectedRes ? window.state.selectedRes.price : undefined,
    price: document.getElementById('editPriceInput') ? document.getElementById('editPriceInput').value : null,
    estimeLine: document.getElementById('editPrixEstime') ? document.getElementById('editPrixEstime').textContent : null,
  }));
  console.log('AVANT ouverture "Adapter pour ce dossier" : state.editState.price =', before.stateEditPrice, '| selectedRes.price =', before.selectedResPrice, '| champ DOM =', before.price, '| ligne =', before.estimeLine);
  // On n asserte PAS sur state.editState avant ouverture : le panneau n existe
  // pas encore, la valeur est legitimement absente. Ce qui se mesure, c est ce
  // que le staff VOIT une fois le panneau ouvert, et ce qui PART au serveur.

  // Ouvrir "Adapter pour ce dossier" SANS RIEN COCHER NI TAPER.
  const clicked = await pg.evaluate(() => {
    const btn = [...document.querySelectorAll('.edit-adapter-btn')].find((b) => /Adapter pour ce dossier/i.test(b.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  ok(clicked, 'bouton "Adapter pour ce dossier" trouve et clique');
  await pg.waitForTimeout(300);

  const after = await pg.evaluate(() => ({
    stateEditPrice: window.state && window.state.editState ? window.state.editState.price : undefined,
    price: document.getElementById('editPriceInput') ? document.getElementById('editPriceInput').value : null,
    estimeLine: document.getElementById('editPrixEstime') ? document.getElementById('editPrixEstime').textContent : null,
    detail: document.querySelector('.edit-prix-detail') ? document.querySelector('.edit-prix-detail').textContent : null,
  }));
  console.log('APRES ouverture "Adapter pour ce dossier" (aucun clic sur une option) : state.editState.price =', after.stateEditPrice, '| champ DOM =', after.price, '| ligne =', after.estimeLine, '| detail =', after.detail);

  ok(String(after.price) === '120',
    `le champ de prix apres simple ouverture affiche le prix reel du dossier (affiche ${after.price}, attendu 120)`);

  // Le staff clique "Enregistrer" (ne touche a AUCUNE case a cocher, juste
  // rouvert la fiche puis sauve). Est-ce que le prix ENVOYE AU SERVEUR est
  // le vrai (120) ou le degrade (20) ?
  const submitted = await pg.evaluate(async () => {
    const form = document.querySelector('.edit-form');
    if (!form) return { ok: false, reason: 'no form' };
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, patches: window.__QA_PATCH__ || [] };
  });
  console.log('PATCH envoyes au serveur :', JSON.stringify(submitted.patches));
  const lastPatch = submitted.patches && submitted.patches.length ? submitted.patches[submitted.patches.length - 1] : null;
  ok(!!lastPatch && Number(lastPatch.price) === 120,
    `prix ENVOYE au serveur apres un simple enregistrement = 120 (envoye ${lastPatch ? lastPatch.price : 'aucun PATCH'})`);
  // Et le programme, lui, n a jamais bouge : c est ce contraste qui rend la
  // perte invisible sur la fiche.
  const lignes = lastPatch && lastPatch.program && lastPatch.program.items ? lastPatch.program.items : [];
  ok(lignes.length === 1 && Number(lignes[0].units) === 3 && Number(lignes[0].hours) === 2,
    `le programme envoye porte toujours 3 tables x 2 h (${JSON.stringify(lignes)})`);

  await b.close();
  srv.close(() => {
    console.log('');
    console.log(failures === 0 ? 'GATE VERT' : `GATE ROUGE (${failures} echec(s))`);
    process.exit(failures === 0 ? 0 : 1);
  });
});
