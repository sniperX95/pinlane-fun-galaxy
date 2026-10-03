// Gate Playwright - UNE DEMANDE A VERIFIER SE DIT A VERIFIER, UNE VISITE DIT
// TOUTES SES ACTIVITES.
//
// Audit QA du 2026-09-28, deux constats de la console :
//   * une Formule 4 reservee en ligne disait au client « demande envoyée,
//     vérifiée sous 24 h » (validationStatus « staff_review ») pendant que la
//     liste du jour et la fiche l affichaient « Confirmé », pistes bloquees.
//     Seul le Terrain disait « À vérifier ».
//   * une visite a la carte sans piste (minigolf + arcades + Fun Run) se lisait
//     « 30 min » dans la liste : la demi-heure par defaut du dossier, pour
//     trois activites, et le nom d aucune.
//
// CE QU IL PROUVE, EN CLIQUANT POUR DE VRAI (console reelle, API mockee) :
//   [1] la ligne d une demande a verifier porte la pastille « À vérifier » et
//       son premier bouton est « Valider », jamais « Confirmé » allume ; les
//       autres lignes a venir gardent « Confirmé » ;
//   [2] cliquer « Valider » envoie validationStatus « confirmed » et la ligne
//       redevient « Confirmé », sans pastille ;
//   [3] la fiche dit que la demande attend une validation, et valide d un clic ;
//   [4] le tableau de bord et la carte des formules disent « À vérifier » ;
//   [5] la ligne d une visite sans piste dit chaque activite avec ce qu elle
//       achete, et la duree de la visite, plus « 30 min » ;
//   [6] contre-epreuve : sans la regle, la ligne redit « Confirmé » ; ce gate
//       ROUGIT.
//
// Usage : node scripts/demande-a-verifier-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_AVERIFIER_PORT || 4385);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const JOUR = '2026-07-18';

// Les contre-epreuves : app-main.js servi avec la regle retiree, puis avec la
// signature de re-rendu privee de validationStatus (valider ne redessinait
// alors plus la ligne : l etat changeait, la signature non).
const MUTATIONS = {
  regle: ['  return Boolean(reservation)\n    && reservation.validationStatus === \'staff_review\'\n    && isUpcomingReservationStatus(reservation.status);', '  return false;'],
  signature: ["    validationStatus: r.validationStatus || '',\n", ''],
};
let casse = '';

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (casse && url.pathname === '/assets/app-main.js') {
      const src = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(src.replace(MUTATIONS[casse][0], MUTATIONS[casse][1]));
      return;
    }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Le faux centre et les fausses reservations de toute la console : ceux du gate
// matrice, jamais une copie (meme extraction que status-toggle-check).
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
function ok(cond, label, detail) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) failures += 1; return cond; }

// Le PATCH de la prod renvoie le dossier COMPLET, relu en base apres
// l ecriture : le faux serveur fusionne le corps partiel avec le dossier connu.
// Le jeu du jour passe par l API (staff-state, admin-range) a chaque
// synchronisation : les demandes a verifier et la visite sont posees DANS la
// reponse, sinon la prochaine lecture les effacerait. Une demande validee le
// reste, comme en base.
// La visite du gate, dans la forme que la BASE en garde : on la fait passer par
// le vrai filtre d ecriture (normalizeReservationPayload). Sa ligne Fun Run est
// une ligne ANCIENNE, sans passages ni palier (les deux lignes de la prod du
// 2026-09-28 sont ainsi) : l ecran doit les retrouver par le catalogue.
function visiteRangee() {
  const { normalizeReservationPayload } = require('../lib/database');
  return normalizeReservationPayload({
    centerId: 'libramont', type: 'activite', date: JOUR, startTime: '15:00', duration: 0.5, totalDuration: 1.75, pax: 8,
    name: 'Visite QA sans piste', phone: '+32491000000', email: 'qa@example.com', price: 194,
    program: {
      items: [
        { activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, minutes: 45, price: 60, priceKnown: true },
        { activityId: 'playground', name: 'Playground', planned: false, minutes: 60, participants: 2, price: 24, priceKnown: true },
        { activityId: 'fun_run', name: 'Fun Run by PIXEL', planned: false, minutes: 60, price: 110, priceKnown: true },
      ],
      price: 194,
      priceComplete: true,
    },
  }, {});
}

async function installPatchMock(page, { activites, visite }) {
  await page.addInitScript(({ activitesDuCentre, visiteDuGate }) => {
    window.__QA_ACTIVITES__ = activitesDuCentre;
    window.__QA_VISITE__ = visiteDuGate;
    window.__QA_PATCHES__ = [];
    window.__QA_REVIEW__ = new Set();
    window.__QA_VALIDES__ = new Set();
    window.__QA_EXTRA__ = [];
    const ajuster = (liste, date) => {
      const out = (Array.isArray(liste) ? liste : []).map((r) => (window.__QA_REVIEW__.has(Number(r.id)) && !window.__QA_VALIDES__.has(Number(r.id))
        ? { ...r, validationStatus: 'staff_review' }
        : (window.__QA_VALIDES__.has(Number(r.id)) ? { ...r, validationStatus: 'confirmed' } : r)));
      window.__QA_EXTRA__.filter((r) => !date || r.date === date).forEach((r) => { if (!out.some((x) => Number(x.id) === Number(r.id))) out.push({ ...r }); });
      return out;
    };
    window.__QA_AJUSTER__ = ajuster;
    const upstream = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-reservations' && method === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_PATCHES__.push(body);
        if (body.validationStatus === 'confirmed') window.__QA_VALIDES__.add(Number(body.id));
        await new Promise((r) => setTimeout(r, 120));
        // `state` est declare en `let` par app-main : il vit dans la portee
        // globale partagee des scripts, pas sur window.
        // eslint-disable-next-line no-undef
        const etat = typeof state !== 'undefined' ? state : null;
        const connu = ((etat && etat.reservations) || []).find((r) => Number(r.id) === Number(body.id)) || {};
        const reservation = { ...connu, ...body, updatedAt: new Date().toISOString() };
        delete reservation.skipReplan;
        return new Response(JSON.stringify({ ok: true, reservation, automation: { communications: 0, jobs: 0, refreshed: false } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      const reponse = await upstream(input, init);
      if (method === 'GET' && (u.pathname === '/api/staff-state' || u.pathname === '/api/admin-range')) {
        const payload = await reponse.clone().json().catch(() => null);
        if (payload && Array.isArray(payload.reservations)) {
          payload.reservations = ajuster(payload.reservations, u.searchParams.get('date') || '');
          return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
      }
      // Le catalogue du centre, comme la prod le sert a la console : sans lui,
      // une ligne ancienne ne retrouve ni son type de tarif ni l entree a la
      // journee.
      if (method === 'GET' && u.pathname === '/api/public-booking-meta') {
        const payload = await reponse.clone().json().catch(() => null);
        if (payload) {
          payload.activities = window.__QA_ACTIVITES__;
          return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
      }
      return reponse;
    };
  }, { activitesDuCentre: activites, visiteDuGate: visite });
}

// Deux demandes a verifier (une pour la liste, une pour la fiche) et une visite
// a la carte sans piste, ajoutees au jeu du gate matrice.
async function bootStaff(page) {
  return page.evaluate(async (d) => {
    window.__LANE_COUNT__ = 8;
    state.currentDate = d;
    state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'all';
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    const brut = window.__QA_BUILD__(d);
    const aVenir = brut.filter((r) => r.status === 'pending' && r.validationStatus !== 'staff_review');
    const liste = aVenir[0];
    const fiche = aVenir[1];
    if (liste) window.__QA_REVIEW__.add(Number(liste.id));
    if (fiche) window.__QA_REVIEW__.add(Number(fiche.id));
    window.__QA_EXTRA__.push({ ...window.__QA_VISITE__, id: 990001, date: d, status: 'pending', validationStatus: 'confirmed', lanes: [], laneCount: 0 });
    state.reservations = window.__QA_AJUSTER__(brut, d);
    state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 20)); }
    await loadStaffCenterConfig(true);
    renderStaff();
    return { liste: liste ? liste.id : null, fiche: fiche ? fiche.id : null, autre: (aVenir[2] || {}).id || null };
  }, JOUR);
}

function lireLigne(page, id) {
  return page.evaluate((resId) => {
    // Depuis le 2026-10-01 (cartes de groupe a la caisse) : l encadre
    // « À vérifier », les gestes de la carte (« Valider », puis « Arrivé » ;
    // « Confirmé » vit dans la fiche), le programme ligne par ligne, et les
    // heures de la visite (debut, fin).
    const row = document.querySelector(`#resList .res-row[onclick="openPos(${resId})"]`);
    if (!row) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const boutons = [...row.querySelectorAll('.gc-actions button')];
    const minutes = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(h || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const debut = minutes(txt(row.querySelector('.gc-when b')));
    const fin = minutes(txt(row.querySelector('.gc-when small')));
    return {
      pastille: txt(row.querySelector('.gc-flag.tone-review b')),
      premier: txt(boutons[0]),
      premierClasses: boutons[0] ? boutons[0].className : '',
      confirmeAllume: boutons.some((b) => txt(b) === 'Confirmé' && b.classList.contains('active')),
      offre: [...row.querySelectorAll('.gc-step-what, .gc-libre')].map((w) => [txt(w.querySelector('b, span')), txt(w.querySelector('small'))].filter(Boolean).join(' ')).join(' · '),
      dureeMinutes: debut !== null && fin !== null ? fin - debut : null,
    };
  }, id);
}

async function parcours(browser, donnees) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  // Le matin du jour joue (matrice : samedi 18 juillet 2026) : ses dossiers
  // sont « à venir ». Sur une date passee, une carte de la liste n offre plus
  // « Arrivé » (2026-10-01, cartes de groupe : un groupe fini s encaisse).
  await page.clock.install({ time: new Date('2026-07-18T09:00:00') });
  await installMock(page);
  await installPatchMock(page, donnees);
  await page.goto(`${BASE_URL}/?v=averifier-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.validateReservationDirect === 'function', null, { timeout: 15000 });
  const ids = await bootStaff(page);
  await page.waitForTimeout(300);
  return { page, ids, errs };
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const donnees = {
    activites: require('../lib/activity-catalog').listCenterActivities('libramont'),
    visite: visiteRangee(),
  };
  const funRunRange = ((donnees.visite.program || {}).items || []).find((i) => i.activityId === 'fun_run') || {};
  ok(funRunRange.minutes === 60 && funRunRange.sessions === undefined && funRunRange.priceType === undefined,
    'MONTAGE la visite est dans la forme que la base garde, sa ligne Fun Run est ancienne (sans passages ni type de tarif)', JSON.stringify(funRunRange));
  try {
    const { page, ids, errs } = await parcours(browser, donnees);
    ok(ids.liste && ids.fiche && ids.autre, 'MONTAGE le jeu du gate matrice fournit trois dossiers a venir', JSON.stringify(ids));

    console.log('\n[1] LA LIGNE D UNE DEMANDE A VERIFIER');
    const l1 = await lireLigne(page, ids.liste) || {};
    ok(l1.pastille === 'À vérifier', 'la ligne porte la pastille « À vérifier »', `« ${l1.pastille} »`);
    ok(l1.premier === 'Valider' && /\breview\b/.test(l1.premierClasses) && !l1.confirmeAllume,
      'son premier bouton est « Valider », et « Confirmé » n y est allume nulle part', JSON.stringify({ premier: l1.premier, classes: l1.premierClasses }));
    const autre = await lireLigne(page, ids.autre) || {};
    ok(autre.premier === 'Arrivé' && !autre.pastille, 'une autre carte a venir propose « Arrivé », sans encadré', JSON.stringify({ premier: autre.premier, pastille: autre.pastille }));

    console.log('\n[2] VALIDER D UN CLIC');
    await page.locator(`#resList .res-row[onclick="openPos(${ids.liste})"] .gc-actions button`, { hasText: 'Valider' }).first().click();
    await page.waitForTimeout(700);
    const patch = await page.evaluate(() => window.__QA_PATCHES__.slice(-1)[0] || null);
    ok(patch && Number(patch.id) === Number(ids.liste) && patch.validationStatus === 'confirmed', 'le clic envoie validationStatus « confirmed » pour CE dossier', JSON.stringify(patch));
    const l2 = await lireLigne(page, ids.liste) || {};
    const etat2 = await page.evaluate((id) => {
      const r = state.reservations.find((x) => Number(x.id) === Number(id)) || {};
      return { validationStatus: r.validationStatus, status: r.status, toasts: [...document.querySelectorAll('.toast, #toast')].map((t) => t.textContent.trim()).filter(Boolean) };
    }, ids.liste);
    ok(l2.premier === 'Arrivé' && !l2.pastille, 'la carte validée propose « Arrivé », sans encadré « À vérifier »', JSON.stringify({ premier: l2.premier, pastille: l2.pastille, etat: etat2 }));

    console.log('\n[3] LA FICHE');
    await page.evaluate((id) => openPos(id), ids.fiche);
    await page.waitForTimeout(400);
    const f1 = await page.evaluate(() => {
      const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
      const b = document.querySelector('.pos-act-row .res-status-btn');
      return { note: txt(document.querySelector('.pos-act-review')), premier: txt(b) };
    });
    ok(/^Cette demande attend votre validation/.test(f1.note) && /pas confirmée/.test(f1.note) && f1.premier === 'Valider',
      'la fiche dit que la demande attend une validation, qu elle n est pas confirmee, et son premier bouton valide', JSON.stringify(f1));
    await page.locator('.pos-act-row .res-status-btn', { hasText: 'Valider' }).first().click();
    await page.waitForTimeout(700);
    const f2 = await page.evaluate(() => {
      const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
      const b = document.querySelector('.pos-act-row .res-status-btn');
      return { note: txt(document.querySelector('.pos-act-review')), premier: txt(b), allume: Boolean(b && b.classList.contains('active')) };
    });
    ok(!f2.note && f2.premier === 'Confirmé' && f2.allume, 'apres le clic, la fiche dit « Confirmé » et la note disparait', JSON.stringify(f2));
    await page.evaluate(() => { if (typeof closePos === 'function') closePos(); });

    console.log('\n[4] LE TABLEAU DE BORD ET LES FORMULES');
    const meta = await page.evaluate(() => ({
      review: getStaffDashboardStatusMeta({ status: 'pending', validationStatus: 'staff_review' }),
      confirme: getStaffDashboardStatusMeta({ status: 'pending', validationStatus: 'confirmed' }),
      arrive: getStaffDashboardStatusMeta({ status: 'arrived', validationStatus: 'staff_review' }),
      libelle: getStaffReservationStateLabel({ status: 'pending', validationStatus: 'staff_review' }),
    }));
    ok(meta.review.label === 'À vérifier' && meta.review.className === 'review', 'le tableau de bord dit « À vérifier » pour une demande en attente', JSON.stringify(meta.review));
    ok(meta.confirme.label === 'Confirmé' && meta.arrive.label === 'Arrivé', 'et garde « Confirmé » validee, « Arrivé » une fois le groupe la', `${meta.confirme.label} / ${meta.arrive.label}`);
    ok(meta.libelle === 'À vérifier', 'la carte des formules et l export lisent le meme libelle', meta.libelle);

    console.log('\n[5] LA VISITE SANS PISTE');
    const v = await lireLigne(page, 990001) || {};
    ok(v.offre === 'Minigolf Blacklight 8 joueurs · 45 min · Playground 2 enfants · toute la journée · Fun Run by PIXEL 8 joueurs · 2 × 30 min',
      'la ligne dit chaque activite avec ce qu elle achete (la plaine a la journee, le Fun Run en 2 sessions de 30 min, retrouvees au catalogue)', `« ${v.offre} »`);
    ok(v.dureeMinutes === 105, 'et la carte va de son debut a debut + 1h45 (45 min + 2 × 30 min, la plaine ne compte pas), plus la demi-heure par defaut', `« ${v.dureeMinutes} min »`);

    ok(errs.length === 0, 'aucune erreur console', errs.slice(0, 3).join(' | '));
    await page.close();

    console.log('\n[6] CONTRE-EPREUVES');
    const src = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
    if (ok(src.split(MUTATIONS.regle[0]).length === 2, 'contre-epreuve montable : la regle se trouve une seule fois dans app-main.js')) {
      casse = 'regle';
      const c = await parcours(browser, donnees);
      const lc = await lireLigne(c.page, c.ids.liste) || {};
      casse = '';
      ok(lc.premier === 'Arrivé' && !lc.pastille, 'sans la regle, la demande se lit comme une carte confirmée : ce gate ROUGIRAIT', JSON.stringify({ premier: lc.premier, pastille: lc.pastille }));
      await c.page.close();
    }
    if (ok(src.split(MUTATIONS.signature[0]).length === 2, 'contre-epreuve montable : validationStatus figure une seule fois dans la signature de re-rendu')) {
      casse = 'signature';
      const c = await parcours(browser, donnees);
      await c.page.locator(`#resList .res-row[onclick="openPos(${c.ids.liste})"] .gc-actions button`, { hasText: 'Valider' }).first().click();
      await c.page.waitForTimeout(700);
      const lc = await lireLigne(c.page, c.ids.liste) || {};
      casse = '';
      ok(lc.premier === 'Valider' && lc.pastille === 'À vérifier', 'sans validationStatus dans la signature, la ligne validee reste « Valider » : ce gate ROUGIRAIT', JSON.stringify({ premier: lc.premier, pastille: lc.pastille }));
      await c.page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures === 0 ? 'demande-a-verifier-check: ALL OK' : `demande-a-verifier-check: ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
