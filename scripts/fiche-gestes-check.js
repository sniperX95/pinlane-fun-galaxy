// Gate Playwright et moteur - LES QUATRE AJOUTS DE LA FICHE (2026-10-12).
//
// Movsar, sur la fiche refaite : « Annuler un geste, Changer la date, Garde-fou
// de Modifier, Boutons selon le rôle ». Chacun se pilote pour de vrai :
//   [A] LES BOUTONS SUIVENT LE ROLE, sur les roles livres (lib/staff-auth.js) :
//       la Direction voit tout ; le Manager n envoie pas de message (il n a pas
//       emails.send) ; le Staff bar pointe et encaisse, sans « Modifier » ni pli
//       du retard ; la Technique replanifie un retard mais ne touche aucun
//       etat ; le Marketing ecrit au client, rien d autre. Une demande a
//       verifier ne propose « Valider » qu a qui peut modifier.
//   [B] ANNULER UN GESTE. « Arrivé » ecrit arrived, puis le toast porte
//       « Annuler » ; le toucher ecrit le statut d avant, sans autre message.
//       « Payé » se defait en « Arrivé », sans moyen de paiement.
//   [C] LE GARDE-FOU DE « MODIFIER ». Sans saisie, la croix ferme. Avec une
//       saisie, la croix, Échap, le clic dehors et « Infos » demandent ;
//       « Continuer la saisie » garde tout, « Quitter sans enregistrer » ferme.
//   [D] CHANGER LA DATE. Un autre jour : les pistes disent qu elles seront
//       attribuees, « Enregistrer » demande confirmation, le PATCH porte la
//       nouvelle date et laisse les pistes au serveur ; un jour passe est
//       refuse sans rien envoyer.
//   [E] LE SERVEUR NE SURREMPLIT PAS LE NOUVEAU JOUR (vrais moteur et
//       validateur de lib/, base en memoire de reserver-banc, rien ne part) :
//       le plan evite la piste prise ce jour-la, la base refuse d y ecrire la
//       piste prise, un jour complet passe « à vérifier », un laser plein est
//       refuse.
//   [F] CONTRE-PREUVES : chaque garantie cassee dans le code fait rougir.
//
// Usage : node scripts/fiche-gestes-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FICHE_GESTES_PORT || 4239);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// Les mutations du code SERVI (contre-preuves de l ecran) : appliquees a
// assets/app-main.js a la volee, le disque n est jamais touche.
let mutationsServies = [];
let mutationRatee = '';
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      if (url.pathname === '/assets/app-main.js' && mutationsServies.length) {
        let src = content.toString('utf8').split(CRLF).join(LF);
        for (const { de, vers } of mutationsServies) {
          if (src.split(de).length !== 2) { mutationRatee = de.slice(0, 80); break; }
          src = src.split(de).join(vers);
        }
        content = Buffer.from(src, 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Le faux centre et le faux jeu de reservations de toute la console : ceux du
// gate matrice (meme extraction que reservation-sheet-check, fins de ligne
// normalisees d abord).
const matrixSrc = fs.readFileSync(path.join(__dirname, 'planning-matrix-check.js'), 'utf8').split(CRLF).join(LF);
const installMockSrc = matrixSrc.slice(
  matrixSrc.indexOf('async function installMock'),
  matrixSrc.indexOf("// ---------------------------------------------------------------------------\n// L'AUDITEUR"),
);
// eslint-disable-next-line no-eval
const installMock = eval(`(${installMockSrc.replace('async function installMock', 'async function')})`);

// LE FAUX SERVEUR DES ECRITURES : il note chaque PATCH et rend la fiche
// entiere avec ce que le PATCH change, comme `returning *`. Ce qu il a accepte,
// il le rend aux releves suivants (/api/staff-state), sinon un releve
// ramenerait l etat d avant le geste.
async function installPatchMock(page) {
  await page.addInitScript(() => {
    window.__QA_PATCHES__ = [];
    window.__QA_GARDES__ = {};
    const amont = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-state' && methode === 'GET') {
        const res = await amont(input, init);
        const gardes = window.__QA_GARDES__;
        if (!Object.keys(gardes).length) return res;
        const j = await res.clone().json().catch(() => null);
        if (!j || !Array.isArray(j.reservations)) return res;
        j.reservations = j.reservations.map((r) => (gardes[r.id] ? { ...r, ...gardes[r.id] } : r));
        return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
      }
      if (u.pathname === '/api/staff-reservations' && methode === 'PATCH') {
        const corps = JSON.parse(init.body || '{}');
        window.__QA_PATCHES__.push(corps);
        await new Promise((r) => setTimeout(r, 120));
        // eslint-disable-next-line no-undef
        const liste = typeof state !== 'undefined' && Array.isArray(state.reservations) ? state.reservations : [];
        const connue = liste.find((r) => String(r.id) === String(corps.id)) || {};
        const { baseUpdatedAt, ...change } = corps;
        const reservation = { ...connue, ...change, updatedAt: new Date().toISOString() };
        window.__QA_GARDES__[reservation.id] = { status: reservation.status, paymentMethod: reservation.paymentMethod, date: reservation.date, name: reservation.name, updatedAt: reservation.updatedAt };
        return new Response(JSON.stringify({ ok: true, reservation, automation: { communications: 0, jobs: 0, refreshed: false } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return amont(input, init);
    };
  });
}

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

const JOUR_CONSOLE = '2026-07-18';
async function bootStaff(page) {
  await page.evaluate(async (d) => {
    window.__LANE_COUNT__ = 8;
    state.currentDate = d;
    state.adminCenterId = 'libramont';
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'all';
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.reservations = window.__QA_BUILD__(d);
    state.laneStatuses = window.__QA_LANES__();
    setView('staff');
    while (staffCenterConfigCache.loading) { await new Promise((r) => setTimeout(r, 20)); }
    await loadStaffCenterConfig(true);
    renderStaff();
    // Les messages simples (toast) se comptent : le seul message d un geste
    // reussi doit etre l offre d annuler, qui ne passe pas par toast().
    window.__QA_TOASTS__ = [];
    const natif = window.toast;
    window.toast = function (msg, ...reste) { window.__QA_TOASTS__.push(String(msg)); return natif.call(this, msg, ...reste); };
  }, JOUR_CONSOLE);
  await page.waitForTimeout(260);
}

async function ouvrirConsole(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(`CONSOLE: ${msg.text()}`); });
  page.on('pageerror', (e) => errs.push(`PAGE: ${e && e.message ? e.message : e}`));
  // L heure de la page est figee le matin du jour de la console : les groupes
  // sont tous a venir, la carte propose « Arrivé », quelle que soit l heure a
  // laquelle le gate tourne.
  await page.clock.install({ time: new Date(`${JOUR_CONSOLE}T09:00:00`) });
  await installMock(page);
  await installPatchMock(page);
  await page.goto(`${BASE_URL}/?v=fiche-gestes-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.openPos === 'function', null, { timeout: 15000 });
  await bootStaff(page);
  return { page, errs };
}

const presets = require(path.join(ROOT, 'lib/staff-auth.js')).STAFF_ROLE_PRESETS;
async function prendreRole(page, roleId) {
  const preset = presets.find((p) => p.id === roleId);
  await page.evaluate(({ id, locked, permissions }) => {
    state.staffAuthSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt: new Date(Date.now() + 3600e3).toISOString(), member: { id: `qa-${id}`, name: 'QA', roleId: id }, role: { id, name: id, locked }, permissions };
  }, { id: preset.id, locked: Boolean(preset.locked), permissions: [...preset.permissions] });
}

async function idDe(page, statut) {
  return page.evaluate((s) => (state.reservations.find((r) => r.status === s && r.type === 'bowling') || {}).id, statut);
}

async function ouvrirFiche(page, id, onglet = 'details') {
  await page.evaluate(({ id, onglet }) => { openPos(id); if (onglet === 'modifier') setTab('modifier'); }, { id, onglet });
  await page.waitForTimeout(160);
}

const ficheOuverte = (page) => page.evaluate(() => !document.getElementById('posOverlay').classList.contains('hidden'));
const confirmation = (page) => page.evaluate(() => {
  const d = document.querySelector('.staff-confirm');
  return d ? (d.querySelector('strong') || {}).textContent || '' : '';
});

// ---------------------------------------------------------------------------
// [A] LES BOUTONS SUIVENT LE ROLE
// ---------------------------------------------------------------------------
async function scenarioRoles(page) {
  const f = {};
  const id = await idDe(page, 'pending');
  for (const role of ['direction', 'manager', 'staff-bar', 'technique', 'marketing']) {
    await prendreRole(page, role);
    await page.evaluate(() => { if (typeof closePos === 'function') closePos(); renderStaff(); });
    await ouvrirFiche(page, id);
    f[role] = await page.evaluate((rid) => {
      const m = document.querySelector('#posOverlay .edit-modal');
      return {
        onglets: [...m.querySelectorAll('.modal-tabs .tab')].map((t) => t.textContent.trim()).join(','),
        etats: [...m.querySelectorAll('.pos-act-row .res-status-btn')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()).join(','),
        pli: Boolean(m.querySelector('.fx-pli')),
        message: Boolean(m.querySelector('.fx-message')),
        carte: [...document.querySelectorAll(`#resList [data-res-row-id="${rid}"] .gc-actions button`)].map((b) => b.textContent.trim()).join(','),
      };
    }, id);
  }
  // Une demande a verifier : « Valider » pour qui peut modifier, pas pour le
  // Staff bar (le serveur demande reservations.edit).
  const idVerif = await page.evaluate(() => {
    const r = state.reservations.find((x) => x.status === 'pending' && x.type === 'bowling');
    const autre = state.reservations.find((x) => x.status === 'pending' && x.type === 'bowling' && x.id !== r.id) || r;
    autre.validationStatus = 'staff_review';
    return autre.id;
  });
  for (const role of ['direction', 'staff-bar']) {
    await prendreRole(page, role);
    await page.evaluate(() => closePos());
    await ouvrirFiche(page, idVerif);
    f[`verifier-${role}`] = await page.evaluate(() => [...document.querySelectorAll('#posOverlay .pos-act-row .res-status-btn')].map((b) => b.textContent.trim()).join(','));
  }
  await page.evaluate((rid) => { const r = state.reservations.find((x) => x.id === rid); if (r) delete r.validationStatus; closePos(); }, idVerif);
  await prendreRole(page, 'direction');
  return f;
}

const QUATRE = 'Confirmé,Arrivé,Payé · Carte,Payé · Espèces';
function verifierRoles(f, v) {
  v(f.direction.onglets === 'Infos,Modifier' && f.direction.etats === QUATRE && f.direction.pli && f.direction.message,
    `[A] Direction : tout (${JSON.stringify(f.direction)})`);
  v(f.manager.onglets === 'Infos,Modifier' && f.manager.etats === QUATRE && f.manager.pli && !f.manager.message,
    `[A] Manager : tout sauf « Envoyer un message » (${JSON.stringify(f.manager)})`);
  v(f['staff-bar'].onglets === '' && f['staff-bar'].etats === QUATRE && !f['staff-bar'].pli && !f['staff-bar'].message,
    `[A] Staff bar : les quatre etats, ni « Modifier », ni pli, ni message (${JSON.stringify(f['staff-bar'])})`);
  v(f.technique.onglets === '' && f.technique.etats === '' && f.technique.pli && !f.technique.message && f.technique.carte === '',
    `[A] Technique : aucun etat ni geste de carte, le pli du retard reste (${JSON.stringify(f.technique)})`);
  v(f.marketing.onglets === '' && f.marketing.etats === '' && !f.marketing.pli && f.marketing.message,
    `[A] Marketing : le message seul (${JSON.stringify(f.marketing)})`);
  v(/^Valider,/.test(f['verifier-direction']) && !/Valider/.test(f['verifier-staff-bar']) && /Arrivé/.test(f['verifier-staff-bar']),
    `[A] « Valider » pour la Direction, pas pour le Staff bar qui garde « Arrivé » (${f['verifier-direction']} / ${f['verifier-staff-bar']})`);
}

// ---------------------------------------------------------------------------
// [B] ANNULER UN GESTE
// ---------------------------------------------------------------------------
async function scenarioAnnuler(page) {
  const f = {};
  const idAttente = await idDe(page, 'pending');
  await ouvrirFiche(page, idAttente);
  const n0 = await page.evaluate(() => { window.__QA_TOASTS__.length = 0; return window.__QA_PATCHES__.length; });
  await page.click('#posOverlay .pos-act-row .res-status-btn.arrived');
  await page.waitForFunction((n) => window.__QA_PATCHES__.length > n, n0, { timeout: 5000 });
  f.offre = await page.waitForSelector('#toast:not(.hidden) .toast-annuler', { timeout: 4000 }).then(() => true, () => false);
  f.apres = await page.evaluate((n) => ({ patch: window.__QA_PATCHES__[n], toast: document.getElementById('toast').textContent.replace(/\s+/g, ' ').trim(), simples: window.__QA_TOASTS__.slice() }), n0);
  if (f.offre) {
    await page.click('#toast .toast-annuler');
    await page.waitForFunction((n) => window.__QA_PATCHES__.length > n + 1, n0, { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(400);
  }
  f.retour = await page.evaluate(({ n, id }) => ({
    patch: window.__QA_PATCHES__[n + 1] || null,
    statut: (state.reservations.find((r) => r.id === id) || {}).status,
    encore: Boolean(document.querySelector('#toast:not(.hidden) .toast-annuler')),
  }), { n: n0, id: idAttente });
  await page.evaluate(() => closePos());
  // Payé · Carte sur un groupe arrive, puis « Annuler ».
  const idArrive = await idDe(page, 'arrived');
  await ouvrirFiche(page, idArrive);
  const n1 = await page.evaluate(() => window.__QA_PATCHES__.length);
  await page.click('#posOverlay .pos-act-row .res-status-btn.paid >> nth=0');
  await page.waitForFunction((n) => window.__QA_PATCHES__.length > n, n1, { timeout: 5000 });
  f.offrePaye = await page.waitForSelector('#toast:not(.hidden) .toast-annuler', { timeout: 4000 }).then(() => true, () => false);
  f.toastPaye = await page.evaluate(() => document.getElementById('toast').textContent.replace(/\s+/g, ' ').trim());
  if (f.offrePaye) {
    await page.click('#toast .toast-annuler');
    await page.waitForFunction((n) => window.__QA_PATCHES__.length > n + 1, n1, { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(400);
  }
  f.retourPaye = await page.evaluate(({ n, id }) => ({ aller: window.__QA_PATCHES__[n], patch: window.__QA_PATCHES__[n + 1] || null, statut: (state.reservations.find((r) => r.id === id) || {}).status }), { n: n1, id: idArrive });
  await page.evaluate(() => closePos());
  return f;
}

function verifierAnnuler(f, v) {
  v(f.apres.patch && f.apres.patch.status === 'arrived' && f.offre && /arrivé/.test(f.apres.toast) && /Annuler/.test(f.apres.toast),
    `[B] « Arrivé » ecrit arrived et le toast porte « Annuler » (« ${f.apres.toast} »)`);
  v(f.apres.simples.length === 0, `[B] aucun autre message apres le geste (${f.apres.simples.join(' | ') || 'aucun'})`);
  v(f.retour.patch && f.retour.patch.status === 'pending' && !('paymentMethod' in f.retour.patch) && f.retour.statut === 'pending' && !f.retour.encore,
    `[B] « Annuler » ecrit le statut d avant et ne se propose pas lui-meme (${JSON.stringify(f.retour)})`);
  v(f.retourPaye.aller && f.retourPaye.aller.status === 'paid' && f.offrePaye && /payé par carte/.test(f.toastPaye),
    `[B] « Payé · Carte » propose aussi « Annuler » (« ${f.toastPaye} »)`);
  v(f.retourPaye.patch && f.retourPaye.patch.status === 'arrived' && !('paymentMethod' in f.retourPaye.patch) && f.retourPaye.statut === 'arrived',
    `[B] un encaissement se defait en « Arrivé », sans moyen de paiement (${JSON.stringify(f.retourPaye.patch)})`);
}

// ---------------------------------------------------------------------------
// [C] LE GARDE-FOU DE « MODIFIER »
// ---------------------------------------------------------------------------
async function scenarioGardeFou(page) {
  const f = {};
  // Une fiche fermee trop tot (contre-preuve) ne doit pas faire attendre le
  // gate : chaque geste suivant ne se joue que si sa cible est la.
  const cliquer = async (sel) => { const el = await page.$(sel); if (el) await el.click(); return Boolean(el); };
  const id = await idDe(page, 'pending');
  await ouvrirFiche(page, id, 'modifier');
  f.propreALOuverture = await page.evaluate(() => ficheEditionModifiee());
  await page.click('#posOverlay .close-btn');
  await page.waitForTimeout(150);
  f.fermeSansSaisie = !(await ficheOuverte(page)) && !(await confirmation(page));
  await ouvrirFiche(page, id, 'modifier');
  await page.fill('#editNameInput', 'Nom change QA');
  await page.click('#posOverlay .close-btn');
  await page.waitForTimeout(150);
  f.titreCroix = await confirmation(page);
  if (f.titreCroix) await page.click('.staff-confirm [data-role="confirm-cancel"]');
  await page.waitForTimeout(150);
  f.garde = { ouverte: await ficheOuverte(page), nom: await page.evaluate(() => (document.getElementById('editNameInput') || {}).value || '') };
  if (await page.$('#editNameInput')) { await page.focus('#editNameInput'); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(150);
  f.titreEchap = await confirmation(page);
  if (f.titreEchap) await page.click('.staff-confirm [data-role="confirm-cancel"]');
  await page.waitForTimeout(120);
  await page.mouse.click(6, 6);
  await page.waitForTimeout(150);
  f.titreDehors = await confirmation(page);
  if (f.titreDehors) await page.click('.staff-confirm [data-role="confirm-cancel"]');
  await page.waitForTimeout(120);
  await cliquer('#posOverlay .modal-tabs .tab >> text=Infos');
  await page.waitForTimeout(150);
  f.titreInfos = await confirmation(page);
  if (f.titreInfos) await page.click('.staff-confirm [data-role="confirm-ok"]');
  await page.waitForTimeout(180);
  f.infos = await page.evaluate(() => ({ onglet: state.activeTab, ouverte: !document.getElementById('posOverlay').classList.contains('hidden') }));
  await page.evaluate(() => { if (state.selectedRes) setTab('modifier'); });
  if (await page.$('#editNameInput')) await page.fill('#editNameInput', 'Nom change QA');
  await cliquer('#posOverlay .close-btn');
  await page.waitForTimeout(150);
  if (await confirmation(page)) await page.click('.staff-confirm [data-role="confirm-ok"]');
  await page.waitForTimeout(180);
  f.quitte = !(await ficheOuverte(page));
  f.patches = await page.evaluate(() => window.__QA_PATCHES__.filter((p) => p.name === 'Nom change QA').length);
  return f;
}

function verifierGardeFou(f, v) {
  v(f.propreALOuverture === false && f.fermeSansSaisie, `[C] sans saisie, « Modifier » ne se croit pas modifie et la croix ferme (${f.propreALOuverture} / ${f.fermeSansSaisie})`);
  v(f.titreCroix === 'Quitter sans enregistrer ?', `[C] avec une saisie, la croix demande (« ${f.titreCroix} »)`);
  v(f.garde.ouverte && f.garde.nom === 'Nom change QA', `[C] « Continuer la saisie » garde la fiche et la saisie (${JSON.stringify(f.garde)})`);
  v(f.titreEchap === 'Quitter sans enregistrer ?' && f.titreDehors === 'Quitter sans enregistrer ?', `[C] Échap et le clic dehors demandent aussi (« ${f.titreEchap} » / « ${f.titreDehors} »)`);
  v(f.titreInfos === 'Quitter sans enregistrer ?' && f.infos.onglet === 'details' && f.infos.ouverte, `[C] « Infos » demande, puis revient aux infos (${JSON.stringify(f.infos)})`);
  v(f.quitte && f.patches === 0, `[C] « Quitter sans enregistrer » ferme sans rien envoyer (fermee ${f.quitte}, ${f.patches} envoi)`);
}

// ---------------------------------------------------------------------------
// [D] CHANGER LA DATE
// ---------------------------------------------------------------------------
async function scenarioDate(page) {
  const f = {};
  const id = await idDe(page, 'pending');
  const avant = await page.evaluate((rid) => { const r = state.reservations.find((x) => x.id === rid); return { lanes: r.lanes, date: r.date }; }, id);
  // La veille : le calendrier ne la propose pas (min), et rien ne part.
  await ouvrirFiche(page, id, 'modifier');
  const n0 = await page.evaluate(() => window.__QA_PATCHES__.length);
  await page.fill('#editDateInput', plusJours(JOUR_CONSOLE, -1));
  await page.waitForTimeout(150);
  await page.click('#posOverlay .es-save');
  await page.waitForTimeout(250);
  f.passe = await page.evaluate((n) => {
    const champ = document.getElementById('editDateInput');
    return { invalide: Boolean(champ && champ.validity && champ.validity.rangeUnderflow), erreur: (document.getElementById('editError') || {}).textContent || '', envoi: window.__QA_PATCHES__.length - n };
  }, n0);
  // Une semaine plus tard : les pistes au serveur, une confirmation, la date part.
  const cible = plusJours(JOUR_CONSOLE, 7);
  await page.fill('#editDateInput', cible);
  await page.waitForTimeout(200);
  f.ecran = await page.evaluate(() => ({
    indice: (document.getElementById('editJourHint') || {}).textContent || '',
    selecteur: Boolean(document.querySelector('#posOverlay .lane-picker')),
    pistes: [...document.querySelectorAll('#posOverlay .field-hint')].map((p) => p.textContent.trim()).find((t) => /^Attribuées à l’enregistrement/.test(t)) || '',
    focus: document.activeElement ? document.activeElement.id : '',
  }));
  await page.click('#posOverlay .es-save');
  await page.waitForTimeout(200);
  f.titre = await confirmation(page);
  if (f.titre) await page.click('.staff-confirm [data-role="confirm-ok"]');
  await page.waitForFunction((n) => window.__QA_PATCHES__.length > n, n0, { timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(400);
  f.envoi = await page.evaluate((n) => window.__QA_PATCHES__[n] || null, n0);
  f.apres = await page.evaluate(() => ({ ouverte: !document.getElementById('posOverlay').classList.contains('hidden'), toasts: window.__QA_TOASTS__.slice(-1)[0] || '' }));
  f.avant = avant;
  f.cible = cible;
  return f;
}

function verifierDate(f, v) {
  v((f.passe.invalide || /aujourd’hui ou un jour à venir/.test(f.passe.erreur)) && f.passe.envoi === 0, `[D] un jour passe est refuse, rien ne part (${JSON.stringify(f.passe)})`);
  v(/Nouveau jour/.test(f.ecran.indice) && !f.ecran.selecteur && /Attribuées à l’enregistrement/.test(f.ecran.pistes) && f.ecran.focus === 'editDateInput',
    `[D] un autre jour : les pistes seront attribuees, le selecteur d aujourd hui part, le focus reste au champ (${JSON.stringify(f.ecran)})`);
  v(/^Déplacer la réservation au /.test(f.titre), `[D] « Enregistrer » demande confirmation (« ${f.titre} »)`);
  v(f.envoi && f.envoi.date === f.cible && JSON.stringify((f.envoi.lanes || []).map(Number)) === JSON.stringify((f.avant.lanes || []).map(Number)),
    `[D] le PATCH porte ${f.cible} et les pistes d avant, que le serveur remplace (${f.envoi ? `${f.envoi.date} ${JSON.stringify(f.envoi.lanes)}` : 'aucun envoi'})`);
  v(!f.apres.ouverte && /^Réservation déplacée au /.test(f.apres.toasts), `[D] la fiche se ferme et le dit (« ${f.apres.toasts} »)`);
}

// ---------------------------------------------------------------------------
// [E] LE SERVEUR SUR LE NOUVEAU JOUR (vrais lib/, base en memoire)
// ---------------------------------------------------------------------------
function plusJours(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function scenarioServeur(mutations = []) {
  const J1 = B.JOUR;
  const J2 = plusJours(J1, 7);
  const J3 = plusJours(J1, 14);
  B.semer([
    B.ligne(800, { lanes: [1], start_time: '15:00' }),
    B.ligne(901, { date: J2, lanes: [1], start_time: '15:00' }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => B.ligne(910 + l, { date: J3, lanes: [l], start_time: '15:00' })),
  ]);
  const m = B.monter({ mutations });
  const db = m.S.db;
  const ops = m.S.ops;
  const jour = async (date) => (await db.readStaffState(date, 'libramont', { avecBlocages: true })).reservations;
  const f = {};
  const dossier = (await jour(J1)).find((r) => Number(r.id) === 800);
  const pistesDu = (plan) => [...new Set(((plan && plan.resourceBlocks) || []).filter((b) => b.resourceType === 'bowling_lane').flatMap((b) => b.lanes || []).map(Number))];
  // Vers J2 : la piste 1 y est prise a 15:00.
  const versJ2 = { ...dossier, date: J2, channel: 'staff' };
  const planJ2 = await ops.prepareReservationOps(versJ2, 'staff', { ignoreReservationId: 800 });
  f.pistesJ2 = pistesDu(planJ2.opsPlan);
  const autresJ2 = (await jour(J2)).filter((r) => Number(r.id) !== 800);
  try { db.validateReservationResources({ ...versJ2, ...planJ2, lanes: f.pistesJ2 }, autresJ2, {}, [], J2); f.ecritJ2 = 'accepte'; } catch (e) { f.ecritJ2 = e.message; }
  // Le dossier tel qu il etait (piste 1, sans plan neuf) ecrit sur J2 : la base
  // lui attribue une piste libre, ou refuse ; jamais la piste prise.
  try { f.pistePrise = { lanes: db.validateReservationResources({ ...versJ2, lanes: [1] }, autresJ2, {}, [], J2).lanes.map(Number) }; } catch (e) { f.pistePrise = { refus: e.message }; }
  // Vers J3 : les huit pistes sont prises a 15:00.
  const versJ3 = { ...dossier, date: J3, channel: 'staff' };
  const planJ3 = await ops.prepareReservationOps(versJ3, 'staff', { ignoreReservationId: 800 });
  f.j3 = { plan: planJ3.planAvailable, validation: planJ3.validationStatus };
  const autresJ3 = (await jour(J3)).filter((r) => Number(r.id) !== 800);
  try { db.validateReservationResources({ ...versJ3, lanes: [1] }, autresJ3, {}, [], J3); f.ecritJ3 = 'accepte'; } catch (e) { f.ecritJ3 = e.message; }
  // Le laser : 25 joueurs deja la a 15:00 sur J2 (30 armes), un groupe de 10
  // arrive de J1 avec son plan d avant.
  const creer = async (corps) => {
    const r = await m.appeler('POST', '/api/staff-reservations', corps);
    return r.json && r.json.reservation ? r.json.reservation : { erreur: r.json && (r.json.message || r.json.error), statut: r.statut };
  };
  const laserJ2 = await creer(B.corpsStaff({ date: J2, type: 'laser', pax: 25, startTime: '15:00', laserGames: 1, duration: 0.5, name: 'Laser J2' }));
  const laserJ1 = await creer(B.corpsStaff({ date: J1, type: 'laser', pax: 10, startTime: '15:00', laserGames: 1, duration: 0.5, name: 'Laser J1' }));
  f.laserCrees = Boolean(laserJ2.id && laserJ1.id);
  if (f.laserCrees) {
    const autresLaser = (await jour(J2)).filter((r) => Number(r.id) !== Number(laserJ1.id));
    try { db.validateReservationResources({ ...laserJ1, date: J2, channel: 'staff' }, autresLaser, {}, [], J2); f.laser = 'accepte'; } catch (e) { f.laser = e.message; }
  } else {
    f.laser = `creation impossible : ${JSON.stringify([laserJ2, laserJ1])}`;
  }
  return f;
}

function verifierServeur(f, v) {
  v(f.pistesJ2.length > 0 && !f.pistesJ2.includes(1) && f.ecritJ2 === 'accepte', `[E] vers un jour ou la piste 1 est prise, le plan en prend une autre et la base l accepte (pistes ${JSON.stringify(f.pistesJ2)}, ${f.ecritJ2})`);
  v(f.pistePrise.refus || (f.pistePrise.lanes.length && !f.pistePrise.lanes.includes(1)), `[E] la base n ecrit jamais la piste prise ce jour-la : une libre, ou un refus (${JSON.stringify(f.pistePrise)})`);
  // Le moteur n a pas de plan ; la base refuse d ecrire : le PATCH echoue et
  // rien ne bouge (la fiche dit « Pas de déplacement au … »).
  v(f.j3.plan === false && f.ecritJ3 !== 'accepte', `[E] un jour complet : pas de plan, et la base refuse d y ecrire le dossier (${JSON.stringify(f.j3)}, « ${f.ecritJ3} »)`);
  v(f.laserCrees && f.laser !== 'accepte', `[E] un laser plein ce jour-la est refuse (« ${f.laser} »)`);
}

// ---------------------------------------------------------------------------
async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const notes = [];
  const v = (cond, label) => notes.push([Boolean(cond), label]);
  const derouler = async () => {
    const { page, errs } = await ouvrirConsole(browser);
    const f = {};
    try {
      f.roles = await scenarioRoles(page);
      f.annuler = await scenarioAnnuler(page);
      f.garde = await scenarioGardeFou(page);
      f.date = await scenarioDate(page);
    } finally {
      f.erreurs = errs.slice();
      await page.close();
    }
    return f;
  };
  const juger = (f) => {
    const n = [];
    const w = (cond, label) => n.push([Boolean(cond), label]);
    verifierRoles(f.roles, w);
    verifierAnnuler(f.annuler, w);
    verifierGardeFou(f.garde, w);
    verifierDate(f.date, w);
    w(f.erreurs.length === 0, `aucune erreur console (${f.erreurs.slice(0, 3).join(' | ') || 'aucune'})`);
    return n;
  };
  try {
    console.log('\n[A-D] L ECRAN');
    const f = await derouler();
    juger(f).forEach(([c, l]) => ok(c, l));
    console.log('\n[E] LE SERVEUR');
    const s = await scenarioServeur();
    verifierServeur(s, v);
    notes.splice(0).forEach(([c, l]) => ok(c, l));

    console.log('\n[F] CONTRE-PREUVES');
    const ECRAN = [
      { nom: 'les etats sans droit', motif: /^\[A\] Technique/, de: "    statut: canUseStaffPermission(['reservations.status', 'reservations.edit']),", vers: '    statut: true,' },
      { nom: 'Arrivé sur la carte sans droit', motif: /^\[A\] Technique/, de: "    if (canUseStaffPermission(['reservations.status', 'reservations.edit'])) {\n      boutons.push(`<button type=\"button\" class=\"gc-btn ${aValider ? '' : 'is-primary'}\"", vers: "    if (true) {\n      boutons.push(`<button type=\"button\" class=\"gc-btn ${aValider ? '' : 'is-primary'}\"" },
      { nom: 'Payé dans la fiche sans droit', motif: /^\[A\] Marketing/, de: '    encaisser: canUseStaffPermission(\'payments.markPaid\'),', vers: '    encaisser: true,' },
      { nom: 'pas d offre d annuler', motif: /^\[B\] « Arrivé » ecrit arrived/, de: "    if (!options.sansAnnulation && ['arrived', 'paid'].includes(status)) proposerAnnulationGeste(versionEcrite, payload.reservation);", vers: '' },
      { nom: 'annuler remet un mauvais statut', motif: /^\[B\] un encaissement se defait/, de: "() => setReservationStatusDirect(apres.id, statutAvant, null, options));", vers: "() => setReservationStatusDirect(apres.id, 'pending', null, options));" },
      { nom: 'la croix ferme sans demander', motif: /^\[C\] avec une saisie, la croix demande/, de: 'function fermerFiche() {\n  if (!ficheEditionModifiee()) { closePos(); return; }', vers: 'function fermerFiche() {\n  { closePos(); return; }' },
      { nom: 'Infos sans demander', motif: /^\[C\] « Infos » demande/, de: "  if (cible !== 'modifier' && ficheEditionModifiee()) {", vers: '  if (false) {' },
      { nom: 'le jour garde les pistes d aujourd hui', motif: /^\[D\] « Enregistrer » demande confirmation/, de: '  const jourChange = Boolean(es.date) && es.date !== state.selectedRes.date;', vers: '  const jourChange = false;' },
    ];
    for (const mutation of ECRAN) {
      mutationsServies = [mutation];
      mutationRatee = '';
      // eslint-disable-next-line no-await-in-loop
      const f = await derouler().catch((e) => ({ exception: e.message }));
      mutationsServies = [];
      if (mutationRatee) { ok(false, `contre-preuve « ${mutation.nom} » : ancre absente (${mutationRatee})`); continue; }
      const rouge = f.exception ? true : juger(f).some(([c, l]) => !c && mutation.motif.test(l));
      ok(rouge, `contre-preuve « ${mutation.nom} » : le gate ROUGIT`, f.exception ? `exception : ${f.exception.slice(0, 120)}` : '');
    }
    const SERVEUR = [
      { nom: 'la base ecrit la piste prise', fichier: 'lib/database.js', de: '  if (requestedAreUsable) {\n    return requestedLanes;\n  }', vers: '  if (requestedLanes.length) {\n    return requestedLanes;\n  }', motif: /^\[E\] la base n ecrit jamais la piste prise/ },
    ];
    for (const mutation of SERVEUR) {
      // eslint-disable-next-line no-await-in-loop
      const s = await scenarioServeur([{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }]).catch((e) => ({ exception: e.message }));
      if (s.exception && /ancre absente/.test(s.exception)) { ok(false, `contre-preuve « ${mutation.nom} » : ${s.exception}`); continue; }
      const w = [];
      if (!s.exception) verifierServeur(s, (c, l) => w.push([Boolean(c), l]));
      ok(Boolean(s.exception) || w.some(([c, l]) => !c && mutation.motif.test(l)), `contre-preuve « ${mutation.nom} » : le gate ROUGIT`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures === 0 ? 'fiche-gestes-check: ALL OK' : `fiche-gestes-check: ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
