// DEUX POSTES, UNE RESERVATION : RIEN NE S ECRASE EN SILENCE.
//
// Movsar, 2026-09-25 : « plusieurs ecrans, plusieurs PC, plusieurs personnes ».
// Chaque ecriture de reservation envoie le dossier ENTIER, pris dans la copie
// de l ecran qui l envoie. Avant ce lot, le poste qui avait la fiche ouverte
// depuis une minute renvoyait le statut d il y a une minute : « Arrivé », pose
// entre-temps au comptoir, repassait en « Confirmé » sans que personne ne le
// voie. Deux coches d activite simultanees : la seconde effacait la premiere.
//
// Ce gate ouvre la VRAIE console dans deux navigateurs (deux postes) branches
// sur UN serveur simule qui applique le contrat du vrai (lib/database.js
// updateReservation) : une ecriture qui porte une version perimee recoit 409 et
// la version actuelle ; les ecritures passent une a la fois, dans l ordre
// d arrivee ; la coche d une activite ajoute ou retire UNE cle.
//
// LES PROPRIETES :
//
//   [A] FICHE OUVERTE, UN COLLEGUE CHANGE LE STATUT : l enregistrement garde
//       son statut et pose le nombre de joueurs saisi ; la personne lit que le
//       statut avait change et qu il est conserve.
//   [B] LES DEUX ONT CHANGE LE MEME CHAMP : rien n est ecrit au premier
//       enregistrement, la fiche garde la saisie et nomme le champ ; le second
//       enregistrement l applique, en connaissance de cause.
//   [C] UNE ACTION RAPIDE SUR UN ECRAN EN RETARD (« Payé » sur un dossier
//       passe « Arrivé » ailleurs) n ecrase pas : refusee, l ecran montre la
//       version actuelle.
//   [D] CE QUI COMPOSE SE REJOUE : deux supplements ajoutes en meme temps
//       restent tous les deux, et le prix les compte tous les deux.
//   [E] DEUX COCHES D ACTIVITES SIMULTANEES restent toutes les deux.
//   [F] LE MEME POSTE, DEUX ACTIONS D AFFILEE (« Arrivé » puis « Payé ») : la
//       seconde part de ce que la premiere a produit, aucun refus.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a
// la fois, et exige que chacune rougisse sa cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4307 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_DEUX_POSTES_PORT || 4307);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.DEUX_POSTES_CASSE || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T10:30:00+02:00`;
const DELAI = 8000;

const MUTATIONS = {
  // Le client n envoie plus sa version : le serveur ecrit tout, comme avant.
  'sans-version': ['app-main.js', '        ...(version ? { baseUpdatedAt: version } : {})', '', '[A] le statut pose par le collegue est garde'],
  // Le rejeu ecrase meme quand l autre a change le meme champ.
  'sans-dispute': ['app-main.js', '      if (disputes.length) throw conflitReservation(courante, disputes);', '', '[B] rien n est ecrit au premier enregistrement'],
  // Le rejeu renvoie le dossier fige au lieu de rejouer l action.
  'sans-rejeu': ['app-main.js', '      const rejouee = appliquer(courante);', '      const rejouee = { ...apres, updatedAt: courante.updatedAt };', '[D] les deux supplements restent'],
  // La coche renvoie le suivi entier.
  'suivi-entier': ['app-main.js', "      activityToggle: { key, done: !wasDone, doneAt: coche ? coche.doneAt : '', by: coche ? coche.by : '' },", '      activityProgress: progress,', '[E] les deux coches restent'],
  // Les ecritures d un poste ne font plus la queue.
  'sans-file': ['app-main.js', '  const precedente = file.get(cle) || Promise.resolve(null);', '  const precedente = Promise.resolve(null);', '[F] aucun refus entre les deux actions du meme poste'],
};

// ---------------------------------------------------------------------------
// LE SERVEUR PARTAGE : ses reservations, ses versions, ses refus.
// ---------------------------------------------------------------------------
let horloge = Date.parse(`${JOUR}T08:00:00.000Z`);
function nouvelleVersion() { horloge += 1000; return new Date(horloge).toISOString(); }

const resa = (id, extra = {}) => ({
  id, date: JOUR, startTime: '15:00', duration: 1, totalDuration: 1, type: 'bowling', lanes: [1], pax: 4,
  price: 39, basePrice: 39, status: 'pending', name: `Client ${id}`, email: `${id}@exemple.be`, phone: '+32470000000',
  centerId: dev.CENTER_ID, channel: 'staff', validationStatus: 'confirmed', extras: [], notes: '', activityProgress: {},
  opsPlan: null, updatedAt: nouvelleVersion(), ...extra,
});

const serveurPartage = {
  versions: {},
  reservations: [
    resa(8201, { name: 'Famille Lambert', startTime: '14:00', lanes: [1] }),
    resa(8202, { name: 'Anniversaire Martin', startTime: '16:00', lanes: [2] }),
    resa(8203, { name: 'Club Renard', startTime: '17:00', lanes: [3] }),
    resa(8204, { name: 'Soiree Dumont', startTime: '18:00', lanes: [4] }),
    resa(8205, { name: 'Ecole Saint-Joseph', startTime: '13:00', type: 'formule', formuleId: 'f1', lanes: [5], pax: 10, price: 260, basePrice: 260 }),
    resa(8206, { name: 'Groupe Petit', startTime: '19:00', lanes: [6] }),
  ],
  refus: [],
  // Les ecritures passent une a la fois, dans l ordre d arrivee (le vrai serveur
  // verrouille la ligne) : la version se controle au moment d ecrire.
  file: Promise.resolve(),
  delaiEcriture: 0,
};
function bump(domaine) { serveurPartage.versions[domaine] = (serveurPartage.versions[domaine] || 0) + 1; }
function empreinte(domaine) { return `${domaine}-${serveurPartage.versions[domaine] || 0}`; }
function trouver(id) { return serveurPartage.reservations.find((r) => String(r.id) === String(id)); }

// Un collegue ecrit, et l autre poste ne l a pas encore lu (le pouls n est pas
// prevenu) : l ecran du poste A est en retard, pour de bon.
function ecritureSilencieuse(id, champs) {
  const r = trouver(id);
  Object.assign(r, champs, { updatedAt: nouvelleVersion() });
}

const CHAMPS_ECRITS = ['name', 'phone', 'email', 'date', 'startTime', 'duration', 'totalDuration', 'lanes', 'pax', 'status', 'basePrice', 'price', 'type', 'formuleId', 'label', 'occasion', 'extras', 'paymentMethod', 'notes', 'opsPlan', 'validationStatus', 'activityProgress', 'program'];

function reponseJson(route, corps, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(corps) });
}

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const mutation = CASSE ? MUTATIONS[CASSE] : null;
    if (CASSE && !mutation) { console.error(`deux-postes-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`deux-postes-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

async function ecrire(corps) {
  const cible = trouver(corps.id);
  if (!cible) return { status: 404, corps: { ok: false, message: 'Reservation introuvable.' } };
  if (serveurPartage.delaiEcriture) await new Promise((r) => setTimeout(r, serveurPartage.delaiEcriture));
  if (corps.baseUpdatedAt && corps.baseUpdatedAt !== cible.updatedAt) {
    serveurPartage.refus.push(Number(corps.id));
    return { status: 409, corps: { ok: false, code: 'reservation_modifiee', message: 'Cette réservation a changé entre-temps.', reservation: { ...cible } } };
  }
  if (corps.activityToggle) {
    const coche = corps.activityToggle;
    const suivi = { ...(cible.activityProgress || {}) };
    if (coche.done) suivi[coche.key] = { done: true, doneAt: coche.doneAt || '', by: coche.by || '' };
    else delete suivi[coche.key];
    cible.activityProgress = suivi;
  } else {
    CHAMPS_ECRITS.forEach((champ) => { if (Object.prototype.hasOwnProperty.call(corps, champ)) cible[champ] = corps[champ]; });
  }
  cible.updatedAt = nouvelleVersion();
  bump(`jour:${cible.date}`);
  bump('reservations');
  return { status: 200, corps: { ok: true, reservation: { ...cible }, automation: { communications: 0, jobs: 0, refreshed: false } } };
}

async function brancher(ctx) {
  await ctx.route('**/api/ops**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action') || '';
    if (req.method() === 'GET' && action === 'pulse') {
      const date = url.searchParams.get('date') || '';
      const domaines = {};
      ['communications', 'suggestions', 'evenements', 'prises', 'reservations', 'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'equipe', 'notes', 'courrier']
        .forEach((nom) => { domaines[nom] = empreinte(nom); });
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) domaines[`jour:${date}`] = empreinte(`jour:${date}`);
      return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, domaines, empreinte: Object.values(domaines).join('.') });
    }
    if (req.method() === 'GET' && action === 'customRequests') return reponseJson(route, { ok: true, customRequests: [] });
    if (req.method() === 'GET' && action === 'listAvailabilityBlocks') return reponseJson(route, { ok: true, blocks: [] });
    return route.continue();
  });
  await ctx.route('**/api/admin-range**', async (route) => {
    const url = new URL(route.request().url());
    const debut = url.searchParams.get('startDate') || '0000-00-00';
    const fin = url.searchParams.get('endDate') || '9999-99-99';
    const reservations = serveurPartage.reservations.filter((r) => r.date >= debut && r.date <= fin).map((r) => ({ ...r }));
    return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, reservations, hasMore: false, nextCursor: null, syncedAt: new Date().toISOString() });
  });
  await ctx.route('**/api/staff-state**', async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') || JOUR;
    if (url.searchParams.get('days')) return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, endDate: date, days: [] });
    const reservations = serveurPartage.reservations.filter((r) => r.date === date && r.status !== 'cancelled').map((r) => ({ ...r }));
    const revision = `rev-${date}-${reservations.map((r) => r.updatedAt).join('|')}`;
    const pistes = {};
    for (let n = 1; n <= 8; n += 1) pistes[n] = 'active';
    return reponseJson(route, { ok: true, date, centerId: dev.CENTER_ID, reservations, laneStatuses: pistes, laneMaintenance: {}, revision });
  });
  await ctx.route('**/api/staff-reservations**', async (route) => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.continue();
    let corps = {};
    try { corps = JSON.parse(req.postData() || '{}'); } catch (e) { corps = {}; }
    const tour = serveurPartage.file.then(() => ecrire(corps));
    serveurPartage.file = tour.catch(() => {});
    const { status, corps: reponse } = await tour;
    return reponseJson(route, reponse, status);
  });
}

async function ouvrir(browser, page0) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Brussels' });
  await brancher(ctx);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  await page.clock.install({ time: new Date(HEURE) });
  await page.addInitScript(({ jour, page0 }) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: page0, currentDate: jour, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, { jour: JOUR, page0 });
  await page.goto(`${BASE}/#/staff/${page0}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff' && typeof window.envoyerModificationReservation === 'function', null, { timeout: 20000 });
  await page.waitForFunction(() => Array.isArray(state.reservations) && state.reservations.some((r) => r.id === 8201), null, { timeout: 15000 });
  // Les messages montres a la personne, dans l ordre.
  await page.evaluate(() => {
    window.__messages = [];
    const origine = window.toast;
    window.toast = function (message) { window.__messages.push(String(message)); return origine.apply(this, arguments); };
  });
  return { ctx, page, erreurs };
}

const attendre = (page, fn, arg, ms = DELAI) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);
async function attendreServeur(condition, ms = DELAI) {
  const butoir = Date.now() + ms;
  while (Date.now() < butoir) { if (condition()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return condition();
}

async function ouvrirFiche(page, id) {
  await page.evaluate((rid) => { openPos(rid); setTab('modifier'); }, id);
  await page.waitForSelector('.edit-form #editPaxInput', { timeout: 10000 });
}

async function enregistrer(page) {
  await page.evaluate(() => {
    const f = document.querySelector('.edit-form');
    if (f) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

async function run() {
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const postes = [];
  try {
    const A = await ouvrir(browser, 'planning');
    postes.push(A);
    const B = await ouvrir(browser, 'planning');
    postes.push(B);

    // =====================================================================
    console.log('[A] fiche ouverte, un collegue change le statut');
    // =====================================================================
    await ouvrirFiche(A.page, 8201);
    const refusAvantA = serveurPartage.refus.length;
    await B.page.evaluate(() => setReservationStatusDirect(8201, 'arrived'));
    const arriveA = await attendreServeur(() => trouver(8201).status === 'arrived');
    await A.page.fill('#editPaxInput', '6');
    await enregistrer(A.page);
    const ecritA = await attendreServeur(() => Number(trouver(8201).pax) === 6);
    const resaA = trouver(8201);
    ok(arriveA && ecritA && resaA.status === 'arrived', '[A] le statut pose par le collegue est garde', `statut ${resaA.status}, joueurs ${resaA.pax}`);
    const messageA = await attendre(A.page, () => window.__messages.some((m) => /^Réservation mise à jour\. Modifié entre-temps et conservé : le statut\.$/.test(m)), null, 4000);
    ok(messageA, '[A] la personne lit que le statut avait change et qu il est conserve',
      (await A.page.evaluate(() => window.__messages.slice(-1)[0] || '')).slice(0, 120));
    ok(serveurPartage.refus.length - refusAvantA === 1, '[A] une version perimee a ete refusee puis rejouee', `${serveurPartage.refus.length - refusAvantA} refus`);

    // =====================================================================
    console.log('\n[B] les deux ont change le meme champ');
    // =====================================================================
    await ouvrirFiche(A.page, 8202);
    await B.page.evaluate(() => {
      const r = state.reservations.find((x) => x.id === 8202);
      return envoyerModificationReservation(r, (d) => ({ ...d, pax: 8 }));
    });
    await attendreServeur(() => Number(trouver(8202).pax) === 8);
    await A.page.fill('#editPaxInput', '6');
    await enregistrer(A.page);
    const erreurB = await attendre(A.page, () => /le nombre de joueurs/.test((document.getElementById('editError') || { textContent: '' }).textContent), null, 5000);
    const paxApresPremier = Number(trouver(8202).pax);
    const saisieGardee = await A.page.evaluate(() => (document.getElementById('editPaxInput') || {}).value);
    ok(erreurB && paxApresPremier === 8, '[B] rien n est ecrit au premier enregistrement', `serveur ${paxApresPremier}, message ${erreurB ? 'nomme le champ' : 'absent'}`);
    ok(saisieGardee === '6', '[B] la fiche garde la saisie', `champ ${saisieGardee}`);
    await enregistrer(A.page);
    const ecritB = await attendreServeur(() => Number(trouver(8202).pax) === 6);
    ok(ecritB, '[B] le second enregistrement applique la saisie, en connaissance de cause', `serveur ${trouver(8202).pax}`);

    // =====================================================================
    console.log('\n[C] une action rapide sur un ecran en retard');
    // =====================================================================
    ecritureSilencieuse(8203, { status: 'arrived' });
    await A.page.evaluate(() => setReservationStatusDirect(8203, 'paid'));
    const vuC = await attendre(A.page, () => (state.reservations.find((r) => r.id === 8203) || {}).status === 'arrived', null, 5000);
    ok(trouver(8203).status === 'arrived' && vuC, '[C] « Payé » sur un dossier passe « Arrivé » ailleurs : refuse, l ecran montre la version actuelle',
      `serveur ${trouver(8203).status}, ecran ${await A.page.evaluate(() => (state.reservations.find((r) => r.id === 8203) || {}).status)}`);

    // =====================================================================
    console.log('\n[D] ce qui compose se rejoue');
    // =====================================================================
    await A.page.evaluate(() => openPos(8204));
    ecritureSilencieuse(8204, { extras: [{ id: 'u2', name: 'Cruche Soda', price: 12 }], price: 51 });
    await A.page.evaluate(() => addExtra('u1'));
    const ecritD = await attendreServeur(() => (trouver(8204).extras || []).length === 2);
    const extrasD = (trouver(8204).extras || []).map((e) => e.id).join(',');
    ok(ecritD && extrasD === 'u2,u1', '[D] les deux supplements restent', extrasD);
    ok(Number(trouver(8204).price) === 69, '[D] et le prix les compte tous les deux (39 + 12 + 18)', `${trouver(8204).price}`);
    await A.page.evaluate(() => closePos());

    // =====================================================================
    console.log('\n[E] deux coches d activites simultanees');
    // =====================================================================
    ecritureSilencieuse(8205, { activityProgress: { 'bowling-1': { done: true, doneAt: `${JOUR}T08:40:00.000Z`, by: 'Poste B' } } });
    await A.page.evaluate(() => toggleFormulaActivity(8205, 'laser_game-1'));
    const ecritE = await attendreServeur(() => Object.keys(trouver(8205).activityProgress || {}).length >= 1 && Boolean((trouver(8205).activityProgress || {})['laser_game-1']));
    const cochesE = Object.keys(trouver(8205).activityProgress || {}).sort().join(',');
    ok(ecritE && cochesE === 'bowling-1,laser_game-1', '[E] les deux coches restent', cochesE);

    // =====================================================================
    console.log('\n[F] le meme poste, deux actions d affilee');
    // =====================================================================
    // Les messages des scenarios precedents ([C] a montre un conflit) ne
    // comptent pas ici.
    await A.page.evaluate(() => { window.__messages = []; });
    serveurPartage.delaiEcriture = 300;
    const refusAvantF = serveurPartage.refus.filter((id) => id === 8206).length;
    await A.page.evaluate(() => { setReservationStatusDirect(8206, 'arrived'); setReservationStatusDirect(8206, 'paid'); });
    const ecritF = await attendreServeur(() => trouver(8206).status === 'paid', 6000);
    await new Promise((r) => setTimeout(r, 900));
    serveurPartage.delaiEcriture = 0;
    const refusF = serveurPartage.refus.filter((id) => id === 8206).length - refusAvantF;
    ok(ecritF && refusF === 0, '[F] aucun refus entre les deux actions du meme poste', `statut ${trouver(8206).status}, ${refusF} refus`);
    const conflitF = await A.page.evaluate(() => window.__messages.some((m) => /changé entre-temps|change en ce moment/.test(m)));
    ok(!conflitF, '[F] et aucun message de conflit pour ses propres actions');

    ok(A.erreurs.length === 0 && B.erreurs.length === 0, '[A..F] aucune erreur JavaScript', [...A.erreurs, ...B.erreurs].slice(0, 3).join(' | '));
  } finally {
    for (const poste of postes) await poste.ctx.close().catch(() => {});
    await browser.close();
    srv.close();
  }
}

function contrePreuves() {
  let mordent = 0;
  const noms = Object.keys(MUTATIONS);
  for (const nom of noms) {
    const cible = MUTATIONS[nom][3];
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, DEUX_POSTES_CASSE: nom }, encoding: 'utf8', timeout: 240000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status === 2) { console.log(`FAIL  contre-preuve ${nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); continue; }
    const rougit = sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(cible));
    if (rougit) { mordent += 1; console.log(`ok    contre-preuve ${nom} : « ${cible} » rougit`); } else console.log(`FAIL  contre-preuve ${nom} : « ${cible} » reste vert`);
  }
  console.log(`deux-postes-check --contre-preuves: ${mordent}/${noms.length} mordent`);
  process.exit(mordent === noms.length ? 0 : 1);
}

if (process.argv.includes('--contre-preuves')) contrePreuves();
else {
  run().then(() => {
    console.log(`\ndeux-postes-check: ${reussis} ok, ${echecs} echec(s)`);
    process.exit(echecs ? 1 : 0);
  }).catch((error) => {
    console.error('deux-postes-check: interrompu', error && error.stack || error);
    process.exit(1);
  });
}
