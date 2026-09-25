// LE TERRAIN : UNE FILE EN TROIS TEMPS, ET LES PARAMETRES DU POSTE.
//
// Movsar, 2026-09-25 : « tout doit etre vrai prouvable », « pas de chose
// répétée », « un workflow super connecté ». Arrivees, En cours et Evenements
// montraient les MEMES reservations sous trois angles. Une seule page les
// remplace, trois colonnes exclusives tirees des vrais horaires :
//
// [A] A 15:30, chaque dossier est dans SA colonne (a venir, sur place, a
//     cloturer), une seule fois, dans l ordre du service ; le termine-paye
//     n apparait pas. Une seule pastille de statut par carte ; « Non pointé »
//     quand l heure dit que le groupe joue mais que personne n a clique
//     Arrivé. Les gestes suivent la colonne, et un dossier deja paye ne
//     propose jamais « Arrivé » (le statut est un seul champ : pointer
//     l arrivee effacerait le paiement). Le temps est dit relativement a
//     maintenant ; chaque colonne compte ses joueurs, la derniere ce qui
//     n est pas encaisse. Ni titre recopie ni « Rafraîchir » factice. Au
//     telephone, une colonne, rien ne deborde.
// [B] LE GESTE : Arrivé fait passer la carte dans Sur place, Payé la retire
//     du tableau, chaque fois en ecrivant au serveur. L entree de page joue a
//     l arrivee, jamais au re-rendu.
// [C] L HEURE fait avancer les cartes toute seule (tic de la minute), sans
//     rejouer l entree.
// [D] LES AUTRES DATES : une date passee n a plus rien a venir ni en salle,
//     tout ce qui n est pas paye est a cloturer, sans temps relatif ; une date
//     future est tout entiere a venir.
// [E] LES ANCIENNES ADRESSES (#/staff/sessions, #/staff/events, liens et
//     etat memorise) menent au Terrain ; la barre laterale n a plus qu une
//     entree « Terrain ».
// [F] LES PARAMETRES DU POSTE : trois reglages reels (theme, export, donnees),
//     plus de plomberie (« Charger Ops ») ; l export couvre toute la journee
//     quel que soit l onglet laisse sur le planning, statuts en francais.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base). Horloge figee au 2026-09-25 15:30. Les ecritures (PATCH) sont
// servies en memoire par le gate : l etat suivant vient de ce qu il a recu.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation
// a la fois, et exige que chacune rougisse sa cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4298 : aucun autre gate ne le prend (deux gates au meme port dans une vague
// se tuent).
const PORT = Number(process.env.PINLANE_TERRAIN_PORT || 4298);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.TERRAIN_CASSE || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T15:30:00`;

// Chaque contre-preuve : [fichier servi, ancre exacte (LF), remplacement,
// controle qui doit rougir].
const MUTATIONS = {
  fini: ['app-main.js', "  if (context.when === 'past' || span.end <= context.now) return status === 'paid' ? 'done' : 'closing';", "  if (context.when === 'past') return status === 'paid' ? 'done' : 'closing';", '[A] chaque dossier est dans sa colonne'],
  double: ['app-main.js', '    board[getStaffTerrainPhase(reservation, span, context)].push({ reservation, ...span });', "    const phase = getStaffTerrainPhase(reservation, span, context); board[phase].push({ reservation, ...span }); if (phase === 'closing') board.onsite.push({ reservation, ...span });", '[A] chaque dossier n apparait qu une fois'],
  pointe: ['app-main.js', "  if ((phase === 'onsite' || phase === 'closing') && upcoming) return { label: 'Non pointé', tone: 'unmarked' };", '', '[A] « Non pointé »'],
  verifier: ['app-main.js', "  if (upcoming && reservation.validationStatus === 'staff_review') return { label: 'À vérifier', tone: 'review' };", '', '[A] a venir, la pastille dit le vrai statut'],
  libelle: ['app-main.js', "    pending: 'Confirmé',\n    confirmed: 'Confirmé',", "    pending: 'En attente',\n    confirmed: 'Confirmé',", '[A] a venir, la pastille dit le vrai statut'],
  paye: ['app-main.js', "  if (phase !== 'closing' && status !== 'arrived' && status !== 'paid') {", "  if (phase !== 'closing' && status !== 'arrived') {", '[A] un dossier deja paye ne propose pas « Arrivé »'],
  montant: ['app-main.js', '  const due = board.closing.reduce(', '  const due = [...board.closing, ...board.onsite].reduce(', '[A] chaque colonne compte'],
  geste: ['app-main.js', "  if (status === 'arrived' || span.start <= context.now) return 'onsite';", "  if (span.start <= context.now) return 'onsite';", '[B] Arrivé fait passer la carte dans Sur place'],
  entree: ['app-main.js', '  const arriving = active && (pages ? pages.lastPage !== model.page : !root.firstElementChild);', '  const arriving = active;', '[B] l entree ne rejoue pas au re-rendu'],
  visite: ['app-main.js', "    if (window.PinlaneV2) window.PinlaneV2.lastPage = '';\n", '', '[B] l entree joue quand on arrive sur la page'],
  tic: ['app-main.js', "  if (isStaffUtilityActive() && getStaffMenuPage() === 'arrivals') renderStaffUtilityPage();\n}, 60000);", '}, 60000);', '[C] l heure fait avancer les cartes'],
  passe: ['app-main.js', "  if (context.when === 'past' || span.end <= context.now)", '  if (span.end <= context.now)', '[D] une date passee'],
  relatif: ['app-main.js', "  if (board.when !== 'today') return '';\n", '', '[D] une date passee'],
  alias: ['app-main.js', "const STAFF_PAGE_ALIASES = { sessions: 'arrivals', events: 'arrivals' };", 'const STAFF_PAGE_ALIASES = {};', '[E] les anciennes adresses menent au Terrain'],
  menu: ['staff-menu.js', "        { key: 'arrivals', label: 'Terrain', icon: 'sessions' }", "        { key: 'field', label: 'Terrain', icon: 'sessions', children: [{ key: 'arrivals', label: 'Arrivées' }, { key: 'sessions', label: 'En cours' }, { key: 'events', label: 'Événements' }] }", '[E] une seule entree « Terrain »'],
  export: ['app-main.js', "  const source = scope === 'day' ? getStaffUtilityReservations() : getPlanningVisibleReservations();", '  const source = getPlanningVisibleReservations();', '[F] l export des Parametres couvre toute la journee'],
};

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

// La duree est en HEURES, comme en production (1, 1.5, 2). Les statuts sont
// ceux de la base : « pending » pour une reservation confirmee pas encore
// arrivee (lib/database.js ne connait pas « confirmed ») ; l attente de
// validation passe par validationStatus « staff_review ».
const resa = (id, startTime, lane, status, price, name, pax, extra = {}) => ({
  id, date: JOUR, startTime, duration: 1, type: 'bowling', lanes: [lane], pax, price, status,
  name, email: `${id}@exemple.be`, phone: '+32470000000', centerId: dev.CENTER_ID, validationStatus: 'confirmed', ...extra,
});
// A 15:30 : une finie payee (absente du tableau), deux finies non payees (une
// pointee, une jamais pointee), deux en jeu (une pointee, une non), quatre a
// venir (dont une payee en ligne et une en attente de validation).
const JOURNEE = [
  resa(7101, '10:00', 1, 'paid', 90, 'Famille Martin', 6),
  resa(7108, '13:00', 5, 'pending', 48, 'Nicolas Petit', 3),
  resa(7102, '14:00', 2, 'arrived', 60, 'Julie Lambert', 4),
  resa(7103, '15:00', 3, 'arrived', 120, 'Anniversaire Lucas', 10, { occasion: 'anniversaire', notes: 'Gâteau apporté par les parents, bougies à 16 h' }),
  resa(7104, '15:00', 4, 'pending', 75, 'Entreprise Solvay', 8, { occasion: 'entreprise', duration: 1.5 }),
  resa(7105, '16:00', 6, 'pending', 60, 'Groupe Dubois', 4),
  { ...resa(7109, '16:30', 0, 'pending', 96, 'Laser Lucie Moreau', 8), type: 'laser', lanes: [], duration: 0.5 },
  resa(7106, '18:00', 1, 'paid', 105, 'Marc Lemaire', 7),
  resa(7107, '19:00', 2, 'pending', 45, 'Sophie Renard', 3, { validationStatus: 'staff_review' }),
];

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const mutation = CASSE ? MUTATIONS[CASSE] : null;
    if (CASSE && !mutation) { console.error(`terrain-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`terrain-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

// Une console ouverte sur le Terrain, horloge figee, journee servie depuis un
// magasin que les PATCH modifient : ce que la page relit est ce qu elle a
// ecrit, comme avec le vrai serveur.
async function ouvrir(browser, { largeur = 1440, route = '#/staff/arrivals' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  const ecritures = [];
  const magasin = JOURNEE.map((r) => ({ ...r }));
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  await page.clock.install({ time: new Date(HEURE) });
  await page.addInitScript((jour) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'dashboard', currentDate: jour, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, JOUR);
  await page.route('**/api/staff-state**', (r) => {
    const date = new URL(r.request().url()).searchParams.get('date') || JOUR;
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, revision: `terrain-${ecritures.length}`, reservations: magasin.map((x) => ({ ...x, date })), laneStatuses: { 1: 'active', 2: 'active', 3: 'active', 4: 'active', 5: 'active', 6: 'active', 7: 'active', 8: 'active' }, centerId: dev.CENTER_ID }),
    });
  });
  await page.route('**/api/staff-reservations**', (r) => {
    if (r.request().method() !== 'PATCH') return r.continue();
    let corps = {};
    try { corps = JSON.parse(r.request().postData() || '{}'); } catch (e) { corps = {}; }
    const cible = magasin.find((x) => String(x.id) === String(corps.id));
    if (cible && corps.status) cible.status = corps.status;
    ecritures.push({ id: corps.id, status: corps.status });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, reservation: cible ? { ...cible, date: corps.date || cible.date } : corps }) });
  });
  await page.goto(`${BASE}/${route}`);
  // Sans le Terrain (une contre-preuve qui casse la route), on n attend pas
  // indefiniment : le controle suivant dira ce qui manque.
  await page.waitForSelector('#staffUtilityPage .terrain-board, #staffUtilityPage .utility-empty', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('#staffUtilityPage .terrain-card').length > 0, null, { timeout: 8000 }).catch(() => {});
  return { ctx, page, erreurs, ecritures };
}

const LIRE = () => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const root = document.getElementById('staffUtilityPage');
  const colonnes = [...root.querySelectorAll('.terrain-column')].map((col) => ({
    titre: t(col.querySelector('h2')),
    compte: t(col.querySelector('.terrain-count')),
    detail: t(col.querySelector('.terrain-column-head small')),
    vide: t(col.querySelector('.terrain-empty')),
    x: Math.round(col.getBoundingClientRect().left),
    cartes: [...col.querySelectorAll('.terrain-card')].map((card) => ({
      id: card.getAttribute('data-terrain-id'),
      statuts: [...card.querySelectorAll('.terrain-status')].map(t),
      quand: t(card.querySelector('.terrain-when')),
      gestes: [...card.querySelectorAll('.terrain-card-actions button')].map(t),
      note: t(card.querySelector('.res-special-request')),
      occasion: t(card.querySelector('.res-occasion-tag')),
    })),
  }));
  return {
    page: state.staffMenuPage,
    h1: t(root.querySelector('.utility-hero h1')),
    sousTitre: t(root.querySelector('.utility-hero p')),
    entree: root.classList.contains('utility-enter'),
    enteteRecopie: Boolean(root.querySelector('.utility-panel-head')) || [...root.querySelectorAll('button')].some((b) => /Rafraîchir/.test(b.textContent)),
    colonnes,
    debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const ids = (col) => (col ? col.cartes.map((c) => c.id) : []);
const carte = (v, id) => {
  for (const col of v.colonnes) {
    const c = col.cartes.find((x) => x.id === String(id));
    if (c) return { ...c, colonne: col.titre };
  }
  return null;
};

async function main() {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const [nom, mutation] of Object.entries(MUTATIONS)) {
      const cible = mutation[3];
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TERRAIN_CASSE: nom }, encoding: 'utf8', timeout: 300000 });
      const sortie = `${r.stdout || ''}${r.stderr || ''}`;
      const cibleRouge = sortie.split('\n').some((l) => l.startsWith('FAIL') && l.indexOf(cible) >= 0);
      const mord = r.status === 1 && cibleRouge;
      if (!mord) manquees += 1;
      console.log(`${mord ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : ${mord ? `rougit « ${cible} »` : `ne mord pas (code ${r.status}, cible ${cibleRouge ? 'rouge' : 'verte'})`}`);
    }
    console.log(`terrain-check --contre-preuves: ${Object.keys(MUTATIONS).length - manquees}/${Object.keys(MUTATIONS).length} mordent`);
    process.exit(manquees ? 1 : 0);
  }

  const srv = serveur();
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A] A 15:30, CHAQUE DOSSIER DANS SA COLONNE');
    // =====================================================================
    const a = await ouvrir(browser);
    const va = await a.page.evaluate(LIRE);
    const [avenir, surPlace, cloturer] = va.colonnes;
    ok(va.page === 'arrivals' && va.h1 === 'Terrain', '[A] MONTAGE : la page Terrain est ouverte', `${va.page} « ${va.h1} »`);
    ok(va.colonnes.map((c) => c.titre).join(' | ') === 'À venir | Sur place | À clôturer', '[A] trois colonnes, dans l ordre du service', va.colonnes.map((c) => c.titre).join(' | '));
    ok(ids(avenir).join(',') === '7105,7109,7106,7107' && ids(surPlace).join(',') === '7103,7104' && ids(cloturer).join(',') === '7108,7102',
      '[A] chaque dossier est dans sa colonne, dans l ordre du service', `a venir ${ids(avenir)} | sur place ${ids(surPlace)} | a cloturer ${ids(cloturer)}`);
    const tous = va.colonnes.flatMap(ids);
    ok(tous.length === 8 && new Set(tous).size === 8 && !tous.includes('7101'),
      '[A] chaque dossier n apparait qu une fois, le termine-paye n apparait pas', `${tous.length} cartes, ${new Set(tous).size} distinctes`);
    ok(va.colonnes.every((c) => c.cartes.every((k) => k.statuts.length === 1)), '[A] une seule pastille de statut par carte');
    const statut = (id) => ((carte(va, id) || {}).statuts || [])[0];
    ok(statut(7104) === 'Non pointé' && statut(7108) === 'Non pointé' && statut(7103) === 'Arrivé' && statut(7102) === 'Arrivé',
      '[A] « Non pointé » quand l heure dit que le groupe joue ou a joue sans arrivee pointee', `7104 ${statut(7104)}, 7108 ${statut(7108)}, 7103 ${statut(7103)}, 7102 ${statut(7102)}`);
    ok(statut(7106) === 'Payé' && statut(7107) === 'À vérifier' && statut(7105) === 'Confirmé' && statut(7109) === 'Confirmé', '[A] a venir, la pastille dit le vrai statut (« pending » est une reservation confirmee)', `7106 ${statut(7106)}, 7107 ${statut(7107)}, 7105 ${statut(7105)}, 7109 ${statut(7109)}`);
    const gestes = (id) => ((carte(va, id) || {}).gestes || []).join('+');
    ok(gestes(7106) === 'Détail', '[A] un dossier deja paye ne propose pas « Arrivé »', gestes(7106));
    ok(gestes(7105) === 'Détail+Arrivé' && gestes(7103) === 'Détail+Payé' && gestes(7104) === 'Détail+Arrivé+Payé' && gestes(7102) === 'Détail+Payé' && gestes(7108) === 'Détail+Payé',
      '[A] les gestes suivent la colonne', `7105 ${gestes(7105)} | 7103 ${gestes(7103)} | 7104 ${gestes(7104)} | 7102 ${gestes(7102)}`);
    const quand = (id) => (carte(va, id) || {}).quand;
    ok(quand(7105) === 'dans 30 min' && quand(7109) === 'dans 1 h' && quand(7103) === 'fin dans 30 min' && quand(7104) === 'fin dans 1 h' && quand(7102) === 'fini depuis 30 min' && quand(7108) === 'fini depuis 1 h 30',
      '[A] le temps est dit relativement a maintenant', `${quand(7105)} | ${quand(7103)} | ${quand(7104)} | ${quand(7102)} | ${quand(7108)}`);
    ok(avenir.detail === '22 joueurs' && surPlace.detail === '18 joueurs' && /^108\s*€ non encaissés$/.test(cloturer.detail || ''),
      '[A] chaque colonne compte ses joueurs, la derniere ce qui n est pas encaisse', `${avenir.detail} | ${surPlace.detail} | ${cloturer.detail}`);
    ok(va.sousTitre === '9 réservations · 53 joueurs · 1 terminée et payée', '[A] le sous-titre compte la journee', `« ${va.sousTitre} »`);
    const lucas = carte(va, 7103) || {};
    ok(/^Gâteau apporté/.test(lucas.note || '') && lucas.occasion === 'Anniversaire', '[A] la consigne et l occasion sont sur la carte', `${lucas.occasion} / ${lucas.note}`);
    ok(!va.enteteRecopie, '[A] ni titre recopie ni « Rafraîchir » factice');
    ok(a.erreurs.length === 0, '[A] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));

    // =====================================================================
    console.log('');
    console.log('[B] LE GESTE');
    // =====================================================================
    await a.page.evaluate(() => {
      const card = document.querySelector('.terrain-card[data-terrain-id="7105"]');
      const bouton = card && [...card.querySelectorAll('.terrain-card-actions button')].find((b) => b.textContent.trim() === 'Arrivé');
      if (bouton) bouton.click();
    });
    await a.page.waitForFunction(() => Boolean(document.querySelector('.terrain-column.is-onsite .terrain-card[data-terrain-id="7105"]')), null, { timeout: 5000 }).catch(() => {});
    const vb1 = await a.page.evaluate(LIRE);
    const dubois = carte(vb1, 7105) || {};
    ok(dubois.colonne === 'Sur place' && (dubois.statuts || [])[0] === 'Arrivé' && (dubois.gestes || []).join('+') === 'Détail+Payé',
      '[B] Arrivé fait passer la carte dans Sur place', JSON.stringify(dubois));
    ok(a.ecritures.some((e) => String(e.id) === '7105' && e.status === 'arrived'), '[B] le geste ecrit au serveur (PATCH arrived)', JSON.stringify(a.ecritures));
    await a.page.evaluate(() => {
      const card = document.querySelector('.terrain-card[data-terrain-id="7102"]');
      const bouton = card && [...card.querySelectorAll('.terrain-card-actions button')].find((b) => b.textContent.trim() === 'Payé');
      if (bouton) bouton.click();
    });
    await a.page.waitForFunction(() => !document.querySelector('.terrain-card[data-terrain-id="7102"]'), null, { timeout: 5000 }).catch(() => {});
    const vb2 = await a.page.evaluate(LIRE);
    ok(!carte(vb2, 7102) && vb2.sousTitre === '9 réservations · 53 joueurs · 2 terminées et payées' && a.ecritures.some((e) => String(e.id) === '7102' && e.status === 'paid'),
      '[B] Payé clot le dossier : il quitte le tableau et compte parmi les termines', `« ${vb2.sousTitre} »`);
    ok(vb2.entree === false, '[B] l entree ne rejoue pas au re-rendu');
    const retour = await a.page.evaluate(() => {
      openStaffMenuPage('planning');
      openStaffMenuPage('arrivals');
      return document.getElementById('staffUtilityPage').classList.contains('utility-enter');
    });
    ok(retour, '[B] l entree joue quand on arrive sur la page');
    ok(a.erreurs.length === 0, '[B] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));
    await a.ctx.close();

    const tel = await ouvrir(browser, { largeur: 390 });
    const vt = await tel.page.evaluate(LIRE);
    ok(vt.debordement <= 0 && vt.colonnes.length === 3 && new Set(vt.colonnes.map((c) => c.x)).size === 1,
      '[A] au telephone : une colonne, rien ne deborde', `debordement ${vt.debordement} px, x ${vt.colonnes.map((c) => c.x).join('/')}`);
    await tel.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] L HEURE');
    // =====================================================================
    const c = await ouvrir(browser);
    await c.page.evaluate(() => { document.getElementById('staffUtilityPage').dataset.avantTic = '1'; });
    await c.page.clock.fastForward(31 * 60 * 1000);
    await c.page.waitForTimeout(300);
    const vc = await c.page.evaluate(LIRE);
    const duboisTic = carte(vc, 7105) || {};
    const lucasTic = carte(vc, 7103) || {};
    ok(duboisTic.colonne === 'Sur place' && (duboisTic.statuts || [])[0] === 'Non pointé' && lucasTic.colonne === 'À clôturer' && /^fini depuis/.test(lucasTic.quand || ''),
      '[C] l heure fait avancer les cartes (16:01 : Dubois en jeu non pointe, Lucas fini)', `Dubois ${duboisTic.colonne}/${(duboisTic.statuts || [])[0]} · Lucas ${lucasTic.colonne}/${lucasTic.quand}`);
    ok(vc.entree === false, '[C] le tic de la minute ne rejoue pas l entree');
    ok(c.erreurs.length === 0, '[C] aucune erreur JavaScript', c.erreurs.slice(0, 3).join(' | '));
    await c.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[D] LES AUTRES DATES');
    // =====================================================================
    const d = await ouvrir(browser);
    await d.page.evaluate(() => shiftDate(-1));
    await d.page.waitForFunction(() => /24 sept/.test((document.querySelector('#staffUtilityPage .staff-date-label') || {}).textContent || '') && document.querySelectorAll('.terrain-column.is-closing .terrain-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    const hier = await d.page.evaluate(LIRE);
    const [h1c, h2c, h3c] = hier.colonnes;
    ok(ids(h1c).length === 0 && ids(h2c).length === 0 && ids(h3c).length === 7 && hier.colonnes.every((col) => col.cartes.every((k) => !k.quand)),
      '[D] une date passee : rien a venir ni en salle, tout ce qui n est pas paye est a cloturer, sans temps relatif', `${ids(h1c).length}/${ids(h2c).length}/${ids(h3c).length}, temps ${hier.colonnes.flatMap((col) => col.cartes.map((k) => k.quand)).filter(Boolean).join(', ') || 'aucun'}`);
    await d.page.evaluate(() => shiftDate(2));
    await d.page.waitForFunction(() => /26 sept/.test((document.querySelector('#staffUtilityPage .staff-date-label') || {}).textContent || '') && document.querySelectorAll('.terrain-column.is-upcoming .terrain-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    const demain = await d.page.evaluate(LIRE);
    ok(ids(demain.colonnes[0]).length === 9 && ids(demain.colonnes[1]).length === 0 && ids(demain.colonnes[2]).length === 0,
      '[D] une date future : tout est a venir', demain.colonnes.map((col) => ids(col).length).join('/'));
    ok(d.erreurs.length === 0, '[D] aucune erreur JavaScript', d.erreurs.slice(0, 3).join(' | '));

    // =====================================================================
    console.log('');
    console.log('[E] LES ANCIENNES ADRESSES ET LA BARRE LATERALE');
    // =====================================================================
    const liens = await d.page.evaluate(() => {
      const vers = (page) => { openStaffMenuPage(page); return state.staffMenuPage; };
      return { sessions: vers('sessions'), events: vers('events') };
    });
    const e = await ouvrir(browser, { route: '#/staff/sessions' });
    const ve = await e.page.evaluate(LIRE);
    const e2 = await ouvrir(browser, { route: '#/staff/events' });
    const ve2 = await e2.page.evaluate(LIRE);
    ok(liens.sessions === 'arrivals' && liens.events === 'arrivals' && ve.page === 'arrivals' && ve.h1 === 'Terrain' && ve2.page === 'arrivals' && ve2.h1 === 'Terrain',
      '[E] les anciennes adresses menent au Terrain', `liens ${JSON.stringify(liens)}, #/staff/sessions ${ve.page} « ${ve.h1} », #/staff/events ${ve2.page} « ${ve2.h1} »`);
    const menu = await e.page.evaluate(() => {
      const nav = document.querySelector('.fgx-menu-nav');
      const entrees = nav ? [...nav.querySelectorAll('[data-fgx-menu-key="arrivals"]')] : [];
      return {
        terrain: entrees.map((b) => (b.querySelector('.fgx-menu-label') || b).textContent.trim()),
        anciennes: nav ? nav.querySelectorAll('[data-fgx-menu-toggle="field"], [data-fgx-menu-key="sessions"], [data-fgx-menu-key="events"]').length : -1,
        active: entrees.some((b) => b.classList.contains('active')),
      };
    });
    ok(menu.terrain.length === 1 && menu.terrain[0] === 'Terrain' && menu.anciennes === 0 && menu.active,
      '[E] une seule entree « Terrain » dans la barre laterale, allumee sur la page', JSON.stringify(menu));
    ok(e.erreurs.length === 0 && e2.erreurs.length === 0, '[E] aucune erreur JavaScript', [...e.erreurs, ...e2.erreurs].slice(0, 3).join(' | '));
    await e.ctx.close();
    await e2.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] LES PARAMETRES DU POSTE');
    // =====================================================================
    await d.page.evaluate(() => { setStaffToday(); openStaffMenuPage('settings'); });
    await d.page.waitForSelector('#staffUtilityPage .settings-list', { timeout: 5000 }).catch(() => {});
    const reglages = await d.page.evaluate(() => {
      const root = document.getElementById('staffUtilityPage');
      return {
        titres: [...root.querySelectorAll('.settings-row h2')].map((h) => h.textContent.trim()),
        plomberie: [...root.querySelectorAll('button')].some((b) => /Charger Ops/.test(b.textContent)),
        themeAvant: state.staffTheme,
      };
    });
    // Les deux boutons, cliques pour de vrai : chacun doit poser SON theme et
    // l annoncer (aria-pressed), pas seulement l un des deux.
    const bouton = (l) => [...document.querySelectorAll('#staffUtilityPage .settings-seg button')].find((b) => b.textContent.trim() === l);
    const basculer = async (libelle) => {
      await d.page.evaluate(`(${bouton})(${JSON.stringify(libelle)})?.click()`);
      return d.page.evaluate(`(() => { const b = (${bouton})(${JSON.stringify(libelle)}); return { theme: state.staffTheme, presse: b ? b.getAttribute('aria-pressed') : null }; })()`);
    };
    const sombre = await basculer('Sombre');
    const clair = await basculer('Clair');
    ok(reglages.titres.join(' | ') === 'Apparence | Export du planning | Données' && !reglages.plomberie && reglages.themeAvant === 'light' && sombre.theme === 'dark' && sombre.presse === 'true' && clair.theme === 'light' && clair.presse === 'true',
      '[F] trois reglages reels, le theme bascule dans les deux sens et le dit', `${reglages.titres.join(' | ')} · Charger Ops ${reglages.plomberie} · theme ${reglages.themeAvant} -> ${sombre.theme} (${sombre.presse}) -> ${clair.theme} (${clair.presse})`);
    const fichier = await d.page.evaluate(() => {
      // Le droit d exporter n est pas ce qu on teste ici : on le donne a la
      // session, et on capture le fichier au lieu de le telecharger.
      state.staffAuthSession = { ...state.staffAuthSession, permissions: [...new Set([...(state.staffAuthSession.permissions || []), 'exports.download'])] };
      state.staffResourceView = 'laser';
      const pris = [];
      downloadTextFile = (nom, contenu) => pris.push({ nom, contenu });
      exportStaffPlanningCsv('day');
      return pris[0] || null;
    });
    const lignes = fichier ? fichier.contenu.split('\n') : [];
    ok(Boolean(fichier) && lignes.length === 10 && /Groupe Dubois/.test(fichier.contenu) && /Laser Lucie Moreau/.test(fichier.contenu),
      '[F] l export des Parametres couvre toute la journee, quel que soit l onglet du planning', fichier ? `${lignes.length - 1} ligne(s) · ${fichier.nom}` : 'aucun fichier');
    ok(Boolean(fichier) && /Téléphone/.test(lignes[0]) && /Payé/.test(fichier.contenu) && /Confirmé/.test(fichier.contenu) && !/En attente/.test(fichier.contenu) && !/\b(confirmed|arrived|paid|pending)\b/.test(fichier.contenu),
      '[F] le statut exporte est en francais', lignes.slice(0, 2).join(' / '));
    ok(d.erreurs.length === 0, '[F] aucune erreur JavaScript', d.erreurs.slice(0, 3).join(' | '));
    await d.ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  console.log(`terrain-check: ${reussis} ok, ${echecs} echec(s)${CASSE ? ` (contre-preuve ${CASSE})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
