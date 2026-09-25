// CE QU UN POSTE CHANGE, L AUTRE ECRAN LE MONTRE, SANS QUE PERSONNE NE RECHARGE.
//
// Movsar, 2026-09-25 : « plusieurs ecrans, plusieurs PC, plusieurs personnes :
// si quelqu un fait une modif, peu importe ce que c est, tout le monde doit le
// voir en instantane ».
//
// Ce gate ouvre la VRAIE console dans deux navigateurs (deux contextes, deux
// postes) branches sur UN meme serveur simule : ce que l un ecrit, l autre le
// lit, exactement comme deux PC sur la meme base. Le pouls (assets/ops-live.js)
// et ce que chaque page relit (app-main, LE DIRECT) sont les vrais ; seul le
// serveur est simule, avec des empreintes par domaine comme le vrai
// (lib/database.js getOpsPulse).
//
// LES PROPRIETES :
//
//   [A] LE POULS PORTE LA JOURNEE AFFICHEE. Sans la date, une reservation prise
//       pour un jour hors de la fenetre du serveur ne se verrait jamais.
//   [B] UNE RESERVATION PRISE AILLEURS APPARAIT SUR LE PLANNING, sans
//       rechargement (un temoin pose dans la page survit), en moins de 6 s.
//   [C] UNE PISTE MISE EN MAINTENANCE AILLEURS SE FERME SUR LE PLANNING.
//   [D] UNE DEMANDE ARRIVEE fait monter le compteur de la barre laterale sur
//       n importe quelle page, et la page Demandes, ouverte ensuite, la montre.
//       Et une page deja visitee, puis quittee (Reservations), se rouvre sur
//       ce qui a change pendant qu on regardait ailleurs : son cache a ete
//       oublie, pas servi perime.
//   [E] UN PRIX CHANGE AILLEURS se lit sur la page Tarifs ouverte.
//   [F] LA CONFIGURATION CHANGEE se lit sur la page Etablissement ; mais un
//       formulaire en cours d edition n est JAMAIS reconstruit sous les doigts
//       (la saisie survit), et la modification arrive des qu on l annule.
//   [G] UN MEMBRE AJOUTE AILLEURS apparait sur la page Equipe.
//   [H] DEUX POSTES : le statut d une reservation change par un clic sur le
//       poste A se voit sur le planning du poste B.
//   [I] QUAND RIEN NE BOUGE, RIEN N EST RELU : sur un pouls stable, aucune
//       donnee lourde n est redemandee.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a
// la fois, et exige que chacune rougisse sa cible.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base), surcharge ici par l etat partage des deux postes.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4306 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_TEMPS_REEL_PORT || 4306);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.TEMPS_REEL_CASSE || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T10:30:00+02:00`;
const DELAI = 6000;

const MUTATIONS = {
  // Le pouls n envoie plus la journee affichee.
  date: ['ops-live.js', "          + (date ? '&date=' + encodeURIComponent(date) : ''));", '          );', '[A] le pouls porte la journee affichee'],
  // La page affichee ne relit plus rien : les changements sont « consommes ».
  relire: ['app-main.js', '  caches.forEach((cache) => cache.relire());\n  if (journee) syncDateReservations(state.currentDate, { silent: true });', '', '[B] une reservation prise ailleurs apparait sur le planning'],
  // Les caches des pages non affichees ne sont plus oublies.
  oublier: ['app-main.js', '    cache.oublier();\n  });', '  });', '[D] la page Reservations, rouverte, montre ce qui a change pendant qu on regardait ailleurs'],
  // Le brouillon d Etablissement n est plus protege.
  brouillon: ['app-main.js', "      brouillon: page === 'establishment' ? () => Boolean(state.establishmentEditing) : undefined,", '      brouillon: undefined,', '[F] le formulaire en cours d edition garde sa saisie'],
  // L equipe n est plus relue.
  equipe: ['app-main.js', '      relire: () => refreshStaffAccessForLiveSync(),', '      relire: () => {},', '[G] un membre ajoute ailleurs apparait sur la page Equipe'],
  // Le planning ne sait plus que le pouls vit : il relit sa journee toutes les 4 s.
  filet: ['app-main.js', "  if (state.view === 'staff') return typeof window.pinlanePoulsVivant === 'function' && window.pinlanePoulsVivant() ? 15000 : 4000;", "  if (state.view === 'staff') return 4000;", '[I] le pouls vivant, le planning espace sa propre lecture a 15 s'],
};

// ---------------------------------------------------------------------------
// L ETAT DU SERVEUR, partage par les deux postes.
// ---------------------------------------------------------------------------
const resa = (id, extra = {}) => ({
  id, date: JOUR, startTime: '15:00', duration: 1, type: 'bowling', lanes: [1], pax: 4, price: 39, status: 'pending',
  name: `Client ${id}`, email: `${id}@exemple.be`, phone: '+32470000000', centerId: dev.CENTER_ID,
  validationStatus: 'confirmed', updatedAt: new Date(`${JOUR}T08:00:00Z`).toISOString(), ...extra,
});
const serveurPartage = {
  versions: {},
  reservations: [resa(8101, { name: 'Famille Lambert', startTime: '14:00', lanes: [1] })],
  pistes: { 1: 'active', 2: 'active', 3: 'active', 4: 'active', 5: 'active', 6: 'active', 7: 'active', 8: 'active' },
  demandes: [{ id: 501, centerId: dev.CENTER_ID, contactName: 'Entreprise Dumont', company: 'Dumont SA', email: 'rh@dumont.be', phone: '', requestedDate: '2026-10-09', pax: 30, occasion: 'Team building', message: 'Soiree pour 30', source: 'site', status: 'new', createdAt: new Date(`${JOUR}T07:00:00Z`).toISOString(), updatedAt: new Date(`${JOUR}T07:00:00Z`).toISOString() }],
  centreNom: 'Fun Galaxy Libramont',
  prixF1: 26,
  membres: [],
  lecturesLourdes: 0,
  lecturesJournee: 0,
  poulsAvecDate: [],
};
function bump(domaine) { serveurPartage.versions[domaine] = (serveurPartage.versions[domaine] || 0) + 1; }
function empreinte(domaine) { return `${domaine}-${serveurPartage.versions[domaine] || 0}`; }

function reponseJson(route, corps) {
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(corps) });
}

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const mutation = CASSE ? MUTATIONS[CASSE] : null;
    if (CASSE && !mutation) { console.error(`temps-reel-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`temps-reel-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

// Les routes que les deux postes partagent. Le reste (mails, sequences...)
// vient des fixtures du serveur de developpement.
async function brancher(ctx) {
  await ctx.route('**/api/ops**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action') || '';
    if (req.method() === 'GET' && action === 'pulse') {
      const date = url.searchParams.get('date') || '';
      if (date) serveurPartage.poulsAvecDate.push(date);
      const domaines = {};
      ['communications', 'suggestions', 'evenements', 'prises', 'reservations', 'pistes', 'blocages', 'demandes', 'catalogue', 'config', 'equipe', 'notes', 'courrier']
        .forEach((nom) => { domaines[nom] = empreinte(nom); });
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) domaines[`jour:${date}`] = empreinte(`jour:${date}`);
      return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, domaines, empreinte: Object.values(domaines).join('.') });
    }
    if (req.method() === 'GET' && action === 'customRequests') {
      serveurPartage.lecturesLourdes += 1;
      return reponseJson(route, { ok: true, customRequests: serveurPartage.demandes.map((d) => ({ ...d })) });
    }
    if (req.method() === 'GET' && action === 'centerConfig') {
      serveurPartage.lecturesLourdes += 1;
      return reponseJson(route, { ok: true, activities: [], centers: [{ id: dev.CENTER_ID, name: serveurPartage.centreNom, status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 8, normalCapacityPerLane: 6 }, laser: { weaponCount: 30, parallelLaunches: 1 } } }] });
    }
    if (req.method() === 'GET' && action === 'clientCatalog') {
      serveurPartage.lecturesLourdes += 1;
      const formule = (id, name, family, priceValue) => ({
        id, name, family, bookingFamily: family, minPax: 4, priceType: 'per_pax', source: 'seed', active: true,
        validDays: null, timeLimitMinMinutes: null, timeLimitMaxMinutes: null, desc: [], notes: [],
        base: { priceValue, priceOld: null }, effective: { name, priceValue, priceOld: null, enabled: true, removed: false },
        centerOverride: null, steps: [],
      });
      return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, activities: [], centerActivityIds: [], formulas: [
        formule('f1', 'FORMULE 1', 'Formules anniversaires', serveurPartage.prixF1),
        formule('f2', 'FORMULE 2', 'Formules anniversaires', 29),
      ] });
    }
    if (req.method() === 'GET' && action === 'listAvailabilityBlocks') return reponseJson(route, { ok: true, blocks: [] });
    return route.continue();
  });
  await ctx.route('**/api/admin-range**', async (route) => {
    const url = new URL(route.request().url());
    const debut = url.searchParams.get('startDate') || '0000-00-00';
    const fin = url.searchParams.get('endDate') || '9999-99-99';
    serveurPartage.lecturesLourdes += 1;
    const reservations = serveurPartage.reservations.filter((r) => r.date >= debut && r.date <= fin).map((r) => ({ ...r }));
    return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, reservations, hasMore: false, nextCursor: null, syncedAt: new Date().toISOString() });
  });
  await ctx.route('**/api/staff-state**', async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') || JOUR;
    if (url.searchParams.get('days')) return reponseJson(route, { ok: true, centerId: dev.CENTER_ID, endDate: date, days: [] });
    serveurPartage.lecturesJournee += 1;
    const reservations = serveurPartage.reservations.filter((r) => r.date === date && r.status !== 'cancelled').map((r) => ({ ...r }));
    const revision = `rev-${date}-${empreinte(`jour:${date}`)}-${empreinte('pistes')}`;
    return reponseJson(route, { ok: true, date, centerId: dev.CENTER_ID, reservations, laneStatuses: { ...serveurPartage.pistes }, laneMaintenance: {}, revision });
  });
  await ctx.route('**/api/staff-auth**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const reponse = await route.fetch();
    const corps = await reponse.json();
    if (corps && corps.accessControl) corps.accessControl.members = [...corps.accessControl.members, ...serveurPartage.membres.map((m) => ({ ...m }))];
    // Les pages Tarifs et Equipe demandent leurs droits : la session du gate les porte.
    if (corps && corps.session) corps.session.permissions = [...new Set([...(corps.session.permissions || []), 'pricing.manage', 'users.manage'])];
    return route.fulfill({ response: reponse, json: corps });
  });
  // Le poste A change un statut : l ecriture arrive au serveur partage.
  await ctx.route('**/api/staff-reservations**', async (route) => {
    const req = route.request();
    if (req.method() !== 'PATCH') return route.continue();
    let corps = {};
    try { corps = JSON.parse(req.postData() || '{}'); } catch (e) { corps = {}; }
    const cible = serveurPartage.reservations.find((r) => String(r.id) === String(corps.id));
    if (!cible) return reponseJson(route, { ok: false, message: 'Reservation introuvable.' });
    Object.assign(cible, { status: corps.status || cible.status, updatedAt: new Date().toISOString() });
    bump(`jour:${cible.date}`);
    bump('reservations');
    return reponseJson(route, { ok: true, reservation: { ...cible }, automation: { communications: 0, jobs: 0, refreshed: false } });
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
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff' && typeof window.synchroniserLaConsole === 'function', null, { timeout: 20000 });
  // Le temoin : s il survit, aucun rechargement n a eu lieu.
  await page.evaluate(() => { window.__temoinTempsReel = 'pose'; });
  return { ctx, page, erreurs };
}

async function aller(page, cible) {
  await page.evaluate((c) => openStaffMenuPage(c), cible);
}

const attendre = (page, fn, arg, ms = DELAI) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);

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
    const B = await ouvrir(browser, 'planning');
    postes.push(B);
    await attendre(B.page, () => (document.getElementById('planningGridWrap') || {}).textContent && document.getElementById('planningGridWrap').textContent.includes('Famille Lambert'), null, 10000);

    // =====================================================================
    console.log('[A] le pouls porte la journee affichee');
    // =====================================================================
    const vuDate = await attendre(B.page, () => true, null, 100).then(() => new Promise((r) => setTimeout(r, 2600))).then(() => serveurPartage.poulsAvecDate.includes(JOUR));
    ok(vuDate, '[A] le pouls porte la journee affichee', serveurPartage.poulsAvecDate.slice(-3).join(','));

    // =====================================================================
    console.log('\n[B] une reservation prise ailleurs');
    // =====================================================================
    serveurPartage.reservations.push(resa(8102, { name: 'Anniversaire Martin', startTime: '16:00', lanes: [4] }));
    bump(`jour:${JOUR}`);
    bump('reservations');
    const vuResa = await attendre(B.page, () => (document.getElementById('planningGridWrap') || { textContent: '' }).textContent.includes('Anniversaire Martin'));
    ok(vuResa, '[B] une reservation prise ailleurs apparait sur le planning', vuResa ? 'en moins de 6 s' : 'toujours absente');
    ok(await B.page.evaluate(() => window.__temoinTempsReel === 'pose'), '[B] sans rechargement (le temoin a survecu)');

    // =====================================================================
    console.log('\n[C] une piste mise en maintenance ailleurs');
    // =====================================================================
    serveurPartage.pistes[3] = 'maintenance';
    bump('pistes');
    const vuPiste = await attendre(B.page, () => document.querySelectorAll('[data-bowling-drop-lane="3"]').length === 0 && document.querySelectorAll('[data-bowling-drop-lane="2"]').length > 0);
    ok(vuPiste, '[C] la piste 3 se ferme sur le planning', vuPiste ? 'fermee' : 'toujours ouverte');

    // =====================================================================
    console.log('\n[D] une demande arrivee');
    // =====================================================================
    // La page Demandes est visitee une premiere fois : son cache existe.
    await aller(B.page, 'requests');
    await attendre(B.page, () => document.querySelector('[data-request-id="501"]') !== null, null, 8000);
    await aller(B.page, 'planning');
    await attendre(B.page, () => (document.getElementById('planningGridWrap') || { textContent: '' }).textContent.includes('Famille Lambert'), null, 6000);
    const badgeAvant = await B.page.evaluate(() => typeof getStaffNewCustomRequestCount === 'function' ? getStaffNewCustomRequestCount() : -1);
    serveurPartage.demandes.unshift({ ...serveurPartage.demandes[0], id: 502, contactName: 'Ecole Saint-Joseph', company: 'Ecole Saint-Joseph', email: 'direction@stjo.be', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    bump('demandes');
    const badgeMonte = await attendre(B.page, (avant) => typeof getStaffNewCustomRequestCount === 'function' && getStaffNewCustomRequestCount() === avant + 1, badgeAvant);
    ok(badgeMonte, '[D] le compteur de la barre laterale monte, depuis le planning', `${badgeAvant} -> ${await B.page.evaluate(() => getStaffNewCustomRequestCount())}`);
    await aller(B.page, 'requests');
    const vuDemande = await attendre(B.page, () => document.querySelector('[data-request-id="502"]') !== null, null, 4000);
    ok(vuDemande, '[D] la page Demandes ouverte ensuite montre la demande arrivee', vuDemande ? 'listee' : 'absente');

    await aller(B.page, 'reservations');
    const resaPrete = await attendre(B.page, () => /Famille Lambert/.test((document.getElementById('staffView') || { textContent: '' }).textContent), null, 8000);
    await aller(B.page, 'planning');
    // Un AUTRE jour du mois : le planning (journee du 25) ne la recopie pas
    // dans le cache du mois ; seul l oubli de ce cache la fait apparaitre.
    serveurPartage.reservations.push(resa(8103, { date: '2026-09-28', name: 'Club Renard', startTime: '17:00', lanes: [5] }));
    bump('jour:2026-09-28');
    bump('reservations');
    await new Promise((r) => setTimeout(r, 3500));
    await aller(B.page, 'reservations');
    const vuRenard = await attendre(B.page, () => typeof getStaffReservationsSourceReservations === 'function'
      && getStaffReservationsSourceReservations().some((r) => r.id === 8103), null, 4000);
    ok(resaPrete && vuRenard, '[D] la page Reservations, rouverte, montre ce qui a change pendant qu on regardait ailleurs', `visitee ${resaPrete}, rouverte ${vuRenard ? 'a jour' : 'perimee'}`);

    // =====================================================================
    console.log('\n[E] un prix change ailleurs');
    // =====================================================================
    await aller(B.page, 'prices');
    const tarifsPrets = await attendre(B.page, () => /FORMULE 1/.test((document.getElementById('staffView') || { textContent: '' }).textContent), null, 8000);
    const prixAvant = await B.page.evaluate(() => (document.getElementById('staffView') || { textContent: '' }).textContent.includes('31'));
    serveurPartage.prixF1 = 31;
    bump('catalogue');
    const vuPrix = await attendre(B.page, () => /31\s*€/.test((document.getElementById('staffView') || { textContent: '' }).textContent));
    ok(tarifsPrets && !prixAvant && vuPrix, '[E] le nouveau prix se lit sur la page Tarifs ouverte', `page prete ${tarifsPrets}, 31 avant ${prixAvant}, 31 apres ${vuPrix}`);

    // =====================================================================
    console.log('\n[F] la configuration changee, et le formulaire en cours');
    // =====================================================================
    await aller(B.page, 'establishment');
    await attendre(B.page, () => /Fun Galaxy Libramont/.test((document.querySelector('.establishment-editor') || { textContent: '' }).textContent), null, 8000);
    serveurPartage.centreNom = 'Fun Galaxy Libramont Centre';
    bump('config');
    const vuNom = await attendre(B.page, () => /Fun Galaxy Libramont Centre/.test((document.querySelector('.establishment-editor h2') || { textContent: '' }).textContent));
    ok(vuNom, '[F] le nouveau nom du centre se lit sur la page Etablissement', vuNom ? 'lu' : 'ancien nom');
    // En edition : la saisie survit a une modification faite ailleurs.
    await B.page.evaluate(() => { if (typeof startEstablishmentEdit === 'function') startEstablishmentEdit(); });
    const champ = await attendre(B.page, () => Boolean(document.querySelector('.establishment-editor input[type="text"], .establishment-editor input:not([type])')), null, 4000);
    let saisie = '';
    if (champ) {
      saisie = 'Saisie en cours 42';
      await B.page.evaluate((valeur) => {
        const el = document.querySelector('.establishment-editor input[type="text"], .establishment-editor input:not([type])');
        el.focus();
        el.value = valeur;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.blur();
      }, saisie);
    }
    serveurPartage.centreNom = 'Fun Galaxy Libramont Nord';
    bump('config');
    await new Promise((r) => setTimeout(r, 4500));
    const saisieSurvit = await B.page.evaluate((valeur) => {
      const el = document.querySelector('.establishment-editor input[type="text"], .establishment-editor input:not([type])');
      return Boolean(el && el.value === valeur);
    }, saisie);
    ok(champ && saisieSurvit, '[F] le formulaire en cours d edition garde sa saisie', champ ? (saisieSurvit ? 'saisie intacte' : 'saisie effacee') : 'formulaire introuvable');
    await B.page.evaluate(() => { if (typeof cancelEstablishmentEdit === 'function') cancelEstablishmentEdit(); });
    const apresAnnuler = await attendre(B.page, () => /Fun Galaxy Libramont Nord/.test((document.querySelector('.establishment-editor h2') || { textContent: '' }).textContent));
    ok(apresAnnuler, '[F] et la modification arrive des que le formulaire est annule', apresAnnuler ? 'arrivee' : 'jamais arrivee');

    // =====================================================================
    console.log('\n[G] un membre ajoute ailleurs');
    // =====================================================================
    await aller(B.page, 'users');
    await attendre(B.page, () => document.querySelectorAll('.staff-member-card').length > 0, null, 8000);
    serveurPartage.membres.push({ id: 'membre-nouveau', name: 'Julie Nouvelle', contact: 'julie@centre.be', roleId: 'direction', status: 'active', code: 'X', lastSeen: '' });
    bump('equipe');
    const vuMembre = await attendre(B.page, () => /Julie Nouvelle/.test((document.getElementById('staffView') || { textContent: '' }).textContent));
    ok(vuMembre, '[G] un membre ajoute ailleurs apparait sur la page Equipe', vuMembre ? 'liste' : 'absent');

    // =====================================================================
    console.log('\n[H] deux postes : un clic sur A se voit sur B');
    // =====================================================================
    await aller(B.page, 'planning');
    await attendre(B.page, () => (document.getElementById('planningGridWrap') || { textContent: '' }).textContent.includes('Famille Lambert'), null, 6000);
    const A = await ouvrir(browser, 'planning');
    postes.push(A);
    await attendre(A.page, () => Array.isArray(state.reservations) && state.reservations.some((r) => r.id === 8101), null, 10000);
    await A.page.evaluate(async () => { if (typeof setReservationStatusDirect === 'function') await setReservationStatusDirect(8101, 'arrived'); });
    const butoir = Date.now() + DELAI;
    while (Date.now() < butoir && serveurPartage.reservations.find((r) => r.id === 8101).status !== 'arrived') await new Promise((r) => setTimeout(r, 100));
    const ecrit = serveurPartage.reservations.find((r) => r.id === 8101).status;
    const vuSurB = await attendre(B.page, () => Array.isArray(state.reservations) && (state.reservations.find((r) => r.id === 8101) || {}).status === 'arrived');
    ok(ecrit === 'arrived' && vuSurB, '[H] le statut change sur le poste A se voit sur le poste B', `serveur : ${ecrit}, poste B : ${vuSurB ? 'arrived' : 'ancien statut'}`);

    // =====================================================================
    console.log('\n[I] quand rien ne bouge, rien n est relu');
    // =====================================================================
    await A.ctx.close();
    postes.pop();
    await new Promise((r) => setTimeout(r, 2500));
    const avant = serveurPartage.lecturesLourdes;
    const journeeAvant = serveurPartage.lecturesJournee;
    await new Promise((r) => setTimeout(r, 6500));
    const relues = serveurPartage.lecturesLourdes - avant;
    const journees = serveurPartage.lecturesJournee - journeeAvant;
    ok(relues === 0, '[I] six secondes de pouls stable : aucune donnee lourde redemandee', `${relues} lecture(s)`);
    ok(journees <= 1, '[I] et la journee n est plus relue que par son filet de 15 s', `${journees} lecture(s) en 6,5 s`);
    const cadence = await B.page.evaluate(() => getRemoteSyncBaseDelay());
    ok(cadence === 15000, '[I] le pouls vivant, le planning espace sa propre lecture a 15 s', `${cadence} ms`);

    ok(B.erreurs.length === 0, '[B..I] aucune erreur JavaScript', B.erreurs.slice(0, 3).join(' | '));
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
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TEMPS_REEL_CASSE: nom }, encoding: 'utf8', timeout: 240000 });
    const sortie = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status === 2) { console.log(`FAIL  contre-preuve ${nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); continue; }
    const rougit = sortie.split('\n').some((l) => l.startsWith('FAIL') && l.includes(cible));
    if (rougit) { mordent += 1; console.log(`ok    contre-preuve ${nom} : « ${cible} » rougit`); } else console.log(`FAIL  contre-preuve ${nom} : « ${cible} » reste vert`);
  }
  console.log(`temps-reel-check --contre-preuves: ${mordent}/${noms.length} mordent`);
  process.exit(mordent === noms.length ? 0 : 1);
}

if (process.argv.includes('--contre-preuves')) contrePreuves();
else {
  run().then(() => {
    console.log(`\ntemps-reel-check: ${reussis} ok, ${echecs} echec(s)`);
    process.exit(echecs ? 1 : 0);
  }).catch((error) => {
    console.error('temps-reel-check: interrompu', error && error.stack || error);
    process.exit(1);
  });
}
