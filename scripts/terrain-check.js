// LE TERRAIN : UNE FILE EN TROIS TEMPS, LE PROGRAMME DES FORMULES, ET LES
// PARAMETRES DU POSTE.
//
// Movsar, 2026-09-25 : « tout doit etre vrai prouvable », « pas de chose
// répétée », « un workflow super connecté ». Arrivees, En cours et Evenements
// montraient les MEMES reservations sous trois angles. Une seule page les
// remplace, trois colonnes exclusives tirees des vrais horaires. Refaite le
// 2026-09-30 (« pas facile a comprendre one shot », « pas toutes les infos
// importantes », « mais pas trop d info ») :
//
// [A] A 15:30, chaque dossier est dans SA colonne, une seule fois, dans l ordre
//     du service ; le termine-paye n apparait pas. Le groupe dont l heure est
//     passee sans arrivee pointee est EN RETARD, en tete de « À venir », avec
//     depuis quand et son numero. Une pastille seulement quand elle dit ce que
//     la colonne ne dit pas (retard, non pointe, a verifier, deja paye). Les
//     gestes suivent la colonne, et un dossier deja paye ne propose jamais
//     « Arrivé » (le statut est un seul champ). Le temps est relatif a
//     maintenant. Au-dela de l heure qui vient, une LIGNE (heure, nom,
//     activite, joueurs, pistes, consigne, validation en attente), sans geste.
//     Chaque colonne compte ses joueurs, la derniere ce qui n est pas encaisse.
//     Au telephone, une colonne, rien ne deborde, l argent a encaisser en tete.
// [B] LE GESTE : Arrivé fait passer la carte dans Sur place (le retard aussi),
//     Payé la retire du tableau, chaque fois en ecrivant au serveur. L entree
//     de page joue a l arrivee, jamais au re-rendu.
// [C] L HEURE fait avancer les cartes toute seule (tic de la minute), sans
//     rejouer l entree.
// [D] LES AUTRES DATES : une date passee n a plus rien a venir ni en salle,
//     tout ce qui n est pas paye est a cloturer, sans temps relatif ; une date
//     future est une liste de preparation, en lignes, sans geste.
// [E] LES ANCIENNES ADRESSES (#/staff/sessions, #/staff/events, liens et
//     etat memorise) menent au Terrain ; la barre laterale n a plus qu une
//     entree « Terrain ».
// [F] LES PARAMETRES DU POSTE : trois reglages reels (theme, export, donnees),
//     plus de plomberie (« Charger Ops ») ; l export couvre toute la journee
//     quel que soit l onglet laisse sur le planning, statuts en francais.
// [G] LE PROGRAMME DES FORMULES : « Sur place » dit l activite prevue
//     maintenant et la suivante ; une formule reste sur place jusqu a sa
//     derniere activite, meme sans piste ni arene. La page Formules suit la
//     journee (en cours, a venir, terminees), ses activites dans l ordre du
//     programme, heures en plage, chacune avec son etat lu a l heure (fait,
//     en cours, non coche, a venir) ; une formule terminee tient sur sa tete
//     de carte ; le sous-titre dit la journee, sans mode d emploi.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base). Horloge figee au 2026-09-25 15:30. Les ecritures (PATCH) sont
// servies en memoire par le gate : l etat suivant vient de ce qu il a recu.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation
// a la fois, et exige que chacune rougisse sa cible. Chaque mutation ne
// rejoue que la section de sa cible (TERRAIN_SECTION) : meme preuve, sans
// refaire les sept sections vingt-huit fois.
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
const SECTION = String(process.env.TERRAIN_SECTION || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T15:30:00`;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Chaque contre-preuve : [fichier servi, ancre exacte (LF), remplacement,
// controle qui doit rougir].
const MUTATIONS = {
  fini: ['app-main.js', "  if (context.when === 'past' || span.end <= context.now || groupeToutFait(reservation)) return status === 'paid' ? 'done' : 'closing';", "  if (context.when === 'past' || groupeToutFait(reservation)) return status === 'paid' ? 'done' : 'closing';", '[A] chaque dossier est dans sa colonne'],
  double: ['app-main.js', '    board[getStaffTerrainPhase(reservation, span, context)].push({ reservation, ...span });', "    const phase = getStaffTerrainPhase(reservation, span, context); board[phase].push({ reservation, ...span }); if (phase === 'closing') board.onsite.push({ reservation, ...span });", '[A] chaque dossier n apparait qu une fois'],
  retard: ['app-main.js', '    else if (board.now - item.start >= seuil - 1e-9) late.push(item);', '    else if (false) late.push(item);', '[A] le groupe en retard est en tete de « À venir »'],
  appeler: ['app-main.js', "  const call = phase === 'late' && phone", '  const call = false && phone', '[A] le groupe en retard porte son numero'],
  pointe: ['app-main.js', "  if (phase === 'closing' && upcoming && !groupeAJoue(reservation)) return { label: 'Non pointé', tone: 'unmarked' };", '', '[A] « Non pointé »'],
  verifier: ['app-main.js', "  if (isReservationAwaitingReview(reservation)) return { label: 'À vérifier', tone: 'review' };", '', '[A] « À vérifier » et « Payé »'],
  repete: ['app-main.js', "  if (reservation.status === 'paid') return { label: 'Payé', tone: 'paid' };\n  return null;", "  if (reservation.status === 'paid') return { label: 'Payé', tone: 'paid' };\n  return { label: getStaffReservationStatusLabel(reservation.status || 'pending'), tone: 'confirmed' };", '[A] aucune pastille ne repete la colonne'],
  // Paye = arrive (2026-10-02) : sans la regle, le paye avant son heure
  // retombe dans « À venir ».
  paye: ['app-main.js', "  if (status === 'arrived' || status === 'paid' || span.start <= context.now) return 'onsite';", "  if (status === 'arrived' || span.start <= context.now) return 'onsite';", '[A] chaque dossier est dans sa colonne'],
  plustard: ['app-main.js', '  const soon = today ? [...onsite.due, ...board.upcoming.filter(item => item.start <= horizon)] : [];', '  const soon = today ? [...onsite.due, ...board.upcoming] : [];', '[A] au-dela de l heure qui vient, une ligne'],
  montant: ['app-main.js', '  const due = board.closing.reduce(', '  const due = [...board.closing, ...onsite.present].reduce(', '[A] chaque colonne compte'],
  mobile: ['pinlane-staff.css', '  .terrain-column.is-closing.has-items { order: -1; }\n', '', '[A] au telephone'],
  geste: ['app-main.js', "  if (status === 'arrived' || status === 'paid' || span.start <= context.now) return 'onsite';", "  if (status === 'paid' || span.start <= context.now) return 'onsite';", '[B] Arrivé fait passer la carte dans Sur place'],
  entree: ['app-main.js', '  const arriving = active && (pages ? pages.lastPage !== model.page : !root.firstElementChild);', '  const arriving = active;', '[B] l entree ne rejoue pas au re-rendu'],
  visite: ['app-main.js', "    if (window.PinlaneV2) window.PinlaneV2.lastPage = '';\n", '', '[B] l entree joue quand on arrive sur la page'],
  tic: ['app-main.js', "  if (isStaffUtilityActive() && ['arrivals', 'formules'].includes(getStaffMenuPage())) renderStaffUtilityPage();\n", '', '[C] l heure fait avancer les cartes'],
  passe: ['app-main.js', "  if (context.when === 'past' || span.end <= context.now || groupeToutFait(reservation))", '  if (span.end <= context.now || groupeToutFait(reservation))', '[D] une date passee'],
  relatif: ['app-main.js', "  if (board.when !== 'today') return '';\n", '', '[D] une date passee'],
  alias: ['app-main.js', "const STAFF_PAGE_ALIASES = { sessions: 'arrivals', events: 'arrivals' };", 'const STAFF_PAGE_ALIASES = {};', '[E] les anciennes adresses menent au Terrain'],
  menu: ['staff-menu.js', "        { key: 'arrivals', label: 'Terrain', icon: 'sessions' }", "        { key: 'field', label: 'Terrain', icon: 'sessions', children: [{ key: 'arrivals', label: 'Arrivées' }, { key: 'sessions', label: 'En cours' }, { key: 'events', label: 'Événements' }] }", '[E] une seule entree « Terrain »'],
  export: ['app-main.js', "  const source = scope === 'day' ? getStaffUtilityReservations() : getPlanningVisibleReservations();", '  const source = getPlanningVisibleReservations();', '[F] l export des Parametres couvre toute la journee'],
  libelle: ['app-main.js', "    pending: 'Confirmé',\n    confirmed: 'Confirmé',", "    pending: 'En attente',\n    confirmed: 'Confirmé',", '[F] le statut exporte est en francais'],
  programme: ['app-main.js', "    ${phase === 'onsite' ? renderStaffTerrainProgram(item, board) : ''}\n", '', '[G] Sur place dit ou en est le groupe'],
  finformule: ['app-main.js', '  const ends = [...windows.map(window => Number(window.end)), ...items.map(item => item.end)];', '  const ends = windows.map(window => Number(window.end));', '[G] une formule reste sur place jusqu a sa derniere activite'],
  journee: ['app-main.js', '  formuleRows.forEach(reservation => groups[getStaffFormulaPhase(reservation, context)].push(reservation));', '  formuleRows.forEach(reservation => groups.upcoming.push(reservation));', '[G] la page Formules suit la journee'],
  ordre: ['app-main.js', '  const items = sortFormulaActivityItems(summary.items);', '  const items = summary.items;', '[G] les activites dans l ordre du programme'],
  plage: ['app-main.js', "'-' + escapeHtml(item.endTime)", "' : ' + escapeHtml(item.endTime)", '[G] les heures en plage'],
  etat: ['app-main.js', "  if (now >= end) return 'missed';", "  if (now >= end) return 'upcoming';", '[G] l etat de chaque activite se lit a l heure'],
  ticformules: ['app-main.js', "['arrivals', 'formules'].includes(getStaffMenuPage())", "getStaffMenuPage() === 'arrivals'", '[G] la page Formules suit l heure'],
  terminee: ['app-main.js', "  if (phase === 'done') {", "  if (phase === 'jamais') {", '[G] une formule terminee tient sur sa tete de carte'],
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
// pointee, une jamais pointee), une en jeu pointee, une en retard (15:00, pas
// pointee), trois dans l heure qui vient (dont une deja payee en ligne) et une
// au-dela, en attente de validation, avec une consigne.
const JOURNEE = [
  resa(7101, '10:00', 1, 'paid', 90, 'Famille Martin', 6),
  resa(7108, '13:00', 5, 'pending', 48, 'Nicolas Petit', 3),
  resa(7102, '14:00', 2, 'arrived', 60, 'Julie Lambert', 4),
  resa(7103, '15:00', 3, 'arrived', 120, 'Anniversaire Lucas', 10, { occasion: 'anniversaire', notes: 'Gâteau apporté par les parents, bougies à 16 h' }),
  resa(7104, '15:00', 4, 'pending', 75, 'Entreprise Solvay', 8, { occasion: 'entreprise', duration: 1.5 }),
  resa(7105, '16:00', 6, 'pending', 60, 'Groupe Dubois', 4),
  resa(7106, '16:15', 1, 'paid', 105, 'Marc Lemaire', 7),
  { ...resa(7109, '16:30', 0, 'pending', 96, 'Laser Lucie Moreau', 8), type: 'laser', lanes: [], duration: 0.5 },
  resa(7107, '19:00', 2, 'pending', 45, 'Sophie Renard', 3, { validationStatus: 'staff_review', notes: 'Deux enfants de moins de six ans' }),
];

// Trois formules : une en cours (programme detaille, une activite deja
// cochee, une passee sans coche), une terminee et payee, une a venir.
const bloc = (resourceType, activityId, startTime, endTime, countIndex, lanes) => ({ resourceType, activityId, startTime, endTime, countIndex, ...(lanes ? { lanes } : {}) });
const etape = (activityId, label, resourceType, startTime, endTime, countIndex = 1) => ({ type: 'activity', activityId, label, resourceType, startTime, endTime, countIndex });
const formule = (id, formuleId, startTime, lanes, status, name, pax, price, timeline, resourceBlocks, activityProgress = {}) => ({
  id, date: JOUR, startTime, duration: 1, type: 'formule', formuleId, label: formuleId === 'f4' ? 'FORMULE 4' : 'FORMULE 1', lanes, pax, price, status,
  name, email: `${id}@exemple.be`, phone: '+32470000001', centerId: dev.CENTER_ID, validationStatus: 'confirmed',
  opsPlan: { timeline, resourceBlocks }, activityProgress,
});
const JOURNEE_FORMULES = [
  formule(7201, 'f4', '14:15', [7, 8], 'arrived', 'Anniversaire Emma', 12, 468, [
    etape('bowling', 'Bowling', 'bowling_lane', '14:15', '15:15'),
    etape('minigolf_blacklight', 'Minigolf Blacklight', 'soft_capacity', '15:20', '16:05'),
    etape('laser_game', 'Laser Game', 'laser_arena', '16:15', '16:40', 1),
    etape('laser_game', 'Laser Game', 'laser_arena', '16:45', '17:10', 2),
    etape('service_drinks', '2 cruches boissons', 'bar_service', '17:10', '17:15'),
  ], [
    bloc('bowling_lane', 'bowling', '14:15', '15:15', 1, [7, 8]),
    bloc('laser_arena', 'laser_game', '16:15', '16:40', 1),
    bloc('laser_arena', 'laser_game', '16:45', '17:10', 2),
  ], { 'service_drinks-1': { done: true, doneAt: `${JOUR}T15:05:00`, by: 'Rachel' } }),
  formule(7202, 'f1', '10:00', [5, 6], 'paid', 'Anniversaire Louise', 10, 260, [
    etape('bowling', 'Bowling', 'bowling_lane', '10:00', '11:00'),
    etape('arcade_time', 'Arcades', 'soft_capacity', '11:05', '11:35'),
    etape('laser_game', 'Laser Game', 'laser_arena', '12:00', '12:25'),
    etape('service_drinks', '2 cruches boissons', 'bar_service', '12:25', '12:30'),
  ], [
    bloc('bowling_lane', 'bowling', '10:00', '11:00', 1, [5, 6]),
    bloc('laser_arena', 'laser_game', '12:00', '12:25', 1),
  ]),
  formule(7203, 'f1', '17:30', [3, 4], 'pending', 'Anniversaire Zoé', 12, 312, [
    etape('bowling', 'Bowling', 'bowling_lane', '17:30', '18:30'),
    etape('laser_game', 'Laser Game', 'laser_arena', '18:40', '19:05'),
    etape('arcade_time', 'Arcades', 'soft_capacity', '19:05', '19:35'),
    etape('service_drinks', '2 cruches boissons', 'bar_service', '19:35', '19:40'),
  ], [
    bloc('bowling_lane', 'bowling', '17:30', '18:30', 1, [3, 4]),
    bloc('laser_arena', 'laser_game', '18:40', '19:05', 1),
  ]),
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
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(mutation[0])] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

// Une console ouverte sur le Terrain, horloge figee, journee servie depuis un
// magasin que les PATCH modifient : ce que la page relit est ce qu elle a
// ecrit, comme avec le vrai serveur.
async function ouvrir(browser, { largeur = 1440, route = '#/staff/arrivals', journee = JOURNEE } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  const ecritures = [];
  const magasin = journee.map((r) => JSON.parse(JSON.stringify(r)));
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
    ecritures.push({ id: corps.id, status: corps.status, paymentMethod: corps.paymentMethod });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, reservation: cible ? { ...cible, date: corps.date || cible.date } : corps }) });
  });
  await page.goto(`${BASE}/${route}`);
  // Sans le Terrain (une contre-preuve qui casse la route), on n attend pas
  // indefiniment : le controle suivant dira ce qui manque.
  await page.waitForSelector('#staffUtilityPage .terrain-board, #staffUtilityPage .utility-empty', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('#staffUtilityPage [data-terrain-id]').length > 0, null, { timeout: 8000 }).catch(() => {});
  return { ctx, page, erreurs, ecritures };
}

// Une carte et une ligne se lisent par la meme porte : `data-terrain-id`.
const LIRE = () => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const root = document.getElementById('staffUtilityPage');
  const colonnes = [...root.querySelectorAll('.terrain-column')].map((col) => {
    const boite = col.getBoundingClientRect();
    return {
      titre: t(col.querySelector('h2')),
      compte: t(col.querySelector('.terrain-count')),
      detail: t(col.querySelector('.terrain-column-head small')),
      vide: t(col.querySelector('.terrain-empty')),
      sousTitre: t(col.querySelector('.terrain-subhead')),
      x: Math.round(boite.left),
      y: Math.round(boite.top),
      cartes: [...col.querySelectorAll('[data-terrain-id]')].map((el) => {
        const appel = el.querySelector('.terrain-call');
        return {
          id: el.getAttribute('data-terrain-id'),
          forme: el.classList.contains('terrain-row') ? 'ligne' : 'carte',
          statuts: [...el.querySelectorAll('.terrain-status')].map(t),
          quand: t(el.querySelector('.terrain-when')),
          appel: appel ? appel.getAttribute('href') : null,
          gestes: [...el.querySelectorAll('.terrain-card-actions button')].map(t),
          note: t(el.querySelector('.res-special-request')),
          occasion: t(el.querySelector('.res-occasion-tag')),
          programme: [...el.querySelectorAll('.terrain-program-step')].map((s) => [...s.children].map(t).join(' | ')),
        };
      }),
    };
  });
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

const LIRE_FORMULES = () => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const root = document.getElementById('staffUtilityPage');
  return {
    h1: t(root.querySelector('.utility-hero h1')),
    sousTitre: t(root.querySelector('.utility-hero p')),
    notePanneau: Boolean(root.querySelector('.utility-panel-note')),
    groupes: [...root.querySelectorAll('.formules-group')].map((g) => ({
      titre: t(g.querySelector('h3')),
      compte: t(g.querySelector('.formules-group-head span')),
      cartes: [...g.querySelectorAll('.formules-card')].map((c) => ({
        id: c.getAttribute('data-formule-id'),
        heures: [...c.querySelectorAll('.formules-card-time > *')].map(t).join('-'),
        lignes: [...c.querySelectorAll('.activity-check-row')].map((r) => ({
          activite: t(r.querySelector('.activity-check-label')),
          heure: t(r.querySelector('.activity-check-time')),
          etat: t(r.querySelector('.activity-check-state')),
        })),
      })),
    })),
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
const cliquer = (page, id, libelle) => page.evaluate(({ id, libelle }) => {
  const el = document.querySelector(`#staffUtilityPage [data-terrain-id="${id}"]`);
  const bouton = el && [...el.querySelectorAll('.terrain-card-actions button')].find((b) => b.textContent.trim() === libelle);
  if (bouton) bouton.click();
  return Boolean(bouton);
}, { id: String(id), libelle });
const section = (lettre) => !SECTION || SECTION === lettre;

async function main() {
  if (process.argv.includes('--contre-preuves')) {
    let manquees = 0;
    for (const [nom, mutation] of Object.entries(MUTATIONS)) {
      const cible = mutation[3];
      const lettre = (/^\[([A-Z])\]/.exec(cible) || [])[1] || '';
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TERRAIN_CASSE: nom, TERRAIN_SECTION: lettre }, encoding: 'utf8', timeout: 300000 });
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
    if (section('A')) {
      // ===================================================================
      console.log('[A] A 15:30, CHAQUE DOSSIER DANS SA COLONNE');
      // ===================================================================
      const a = await ouvrir(browser);
      const va = await a.page.evaluate(LIRE);
      const [avenir, surPlace, cloturer] = va.colonnes;
      ok(va.page === 'arrivals' && va.h1 === 'Terrain', '[A] MONTAGE : la page Terrain est ouverte', `${va.page} « ${va.h1} »`);
      ok(va.colonnes.map((c) => c.titre).join(' | ') === 'À venir | Sur place | À clôturer', '[A] trois colonnes, dans l ordre du service', va.colonnes.map((c) => c.titre).join(' | '));
      // PAYE = ARRIVE (2026-10-02, Movsar : « le paiement est que sur place ») :
      // 7106, paye avant son heure, est « Sur place », plus « À venir ».
      ok(ids(avenir).join(',') === '7104,7105,7109,7107' && ids(surPlace).join(',') === '7103,7106' && ids(cloturer).join(',') === '7108,7102',
        '[A] chaque dossier est dans sa colonne, dans l ordre du service', `a venir ${ids(avenir)} | sur place ${ids(surPlace)} | a cloturer ${ids(cloturer)}`);
      const tous = va.colonnes.flatMap(ids);
      ok(tous.length === 8 && new Set(tous).size === 8 && !tous.includes('7101'),
        '[A] chaque dossier n apparait qu une fois, le termine-paye n apparait pas', `${tous.length} cartes, ${new Set(tous).size} distinctes`);
      const solvay = carte(va, 7104) || {};
      ok(solvay.colonne === 'À venir' && (avenir.cartes[0] || {}).id === '7104' && solvay.forme === 'carte' && solvay.statuts.join(' / ') === 'En retard · 30 min',
        '[A] le groupe en retard est en tete de « À venir », sa pastille dit depuis quand', `${solvay.colonne} · ${solvay.forme} · « ${(solvay.statuts || []).join(' / ')} »`);
      ok(solvay.appel === 'tel:+32470000000' && !solvay.quand,
        '[A] le groupe en retard porte son numero (lien d appel), pas un temps relatif', `appel ${solvay.appel} · temps « ${solvay.quand} »`);
      const statut = (id) => ((carte(va, id) || {}).statuts || []).join(' / ');
      ok(statut(7108) === 'Non pointé', '[A] « Non pointé » : fini sans arrivee pointee (peut-etre pas venu)', `7108 « ${statut(7108)} »`);
      ok(statut(7107) === 'À vérifier' && statut(7106) === 'Payé', '[A] « À vérifier » et « Payé » : ce que la colonne ne dit pas', `7107 « ${statut(7107)} », 7106 « ${statut(7106)} »`);
      ok(['7105', '7109', '7103', '7102'].every((id) => statut(id) === '') && va.colonnes.every((c) => c.cartes.every((k) => k.statuts.length <= 1)),
        '[A] aucune pastille ne repete la colonne (ni « Confirmé » ni « Arrivé »), jamais deux par dossier', ['7105', '7109', '7103', '7102'].map((id) => `${id} « ${statut(id)} »`).join(', '));
      const gestes = (id) => ((carte(va, id) || {}).gestes || []).join('+');
      ok(gestes(7106) === 'Détail', '[A] un dossier deja paye ne propose pas « Arrivé »', gestes(7106));
      // Encaisser note le moyen depuis le 2026-10-01 : « Payé · Carte » et
      // « Payé · Espèces » remplacent « Payé ».
      const PAYER = 'Détail+Payé · Carte+Payé · Espèces';
      ok(gestes(7104) === 'Détail+Arrivé' && gestes(7105) === 'Détail+Arrivé' && gestes(7109) === 'Détail+Arrivé' && gestes(7103) === PAYER && gestes(7102) === PAYER && gestes(7108) === PAYER,
        '[A] les gestes suivent la colonne', ['7104', '7105', '7103', '7102', '7108'].map((id) => `${id} ${gestes(id)}`).join(' | '));
      const quand = (id) => (carte(va, id) || {}).quand;
      ok(quand(7105) === 'dans 30 min' && quand(7106) === 'commence dans 45 min' && quand(7109) === 'dans 1 h' && quand(7103) === 'fin dans 30 min' && quand(7102) === 'fini depuis 30 min' && quand(7108) === 'fini depuis 1 h 30',
        '[A] le temps est dit relativement a maintenant', ['7105', '7106', '7109', '7103', '7102', '7108'].map(quand).join(' | '));
      const renard = carte(va, 7107) || {};
      ok(renard.forme === 'ligne' && avenir.sousTitre === 'Après 16:30' && avenir.cartes.filter((k) => k.forme === 'carte').map((k) => k.id).join(',') === '7104,7105,7109',
        '[A] au-dela de l heure qui vient, une ligne sous « Après 16:30 », les autres en cartes', `7107 ${renard.forme} · « ${avenir.sousTitre} »`);
      ok(/^Deux enfants/.test(renard.note || '') && (renard.statuts || []).join() === 'À vérifier' && (renard.gestes || []).length === 0,
        '[A] la ligne garde la consigne et la validation en attente, sans geste', `note « ${renard.note} » · ${(renard.gestes || []).length} geste(s)`);
      ok(avenir.compte === '4' && avenir.detail === '23 joueurs' && surPlace.compte === '2' && surPlace.detail === '17 joueurs' && cloturer.compte === '2' && /^108\s*€ non encaissés$/.test(cloturer.detail || ''),
        '[A] chaque colonne compte ses dossiers et ses joueurs, la derniere ce qui n est pas encaisse', `${avenir.compte}/${avenir.detail} | ${surPlace.compte}/${surPlace.detail} | ${cloturer.compte}/${cloturer.detail}`);
      ok(va.sousTitre === '9 réservations · 53 joueurs · 1 terminée et payée', '[A] le sous-titre compte la journee', `« ${va.sousTitre} »`);
      const lucas = carte(va, 7103) || {};
      ok(/^Gâteau apporté/.test(lucas.note || '') && lucas.occasion === 'Anniversaire' && lucas.programme.length === 0,
        '[A] la consigne et l occasion sont sur la carte ; une seule activite, pas de programme', `${lucas.occasion} / ${lucas.note} / programme ${lucas.programme.length}`);
      ok(!va.enteteRecopie, '[A] ni titre recopie ni « Rafraîchir » factice');
      ok(a.erreurs.length === 0, '[A] aucune erreur JavaScript', a.erreurs.slice(0, 3).join(' | '));
      await a.ctx.close();

      const tel = await ouvrir(browser, { largeur: 390 });
      const vt = await tel.page.evaluate(LIRE);
      const [tAvenir, tSurPlace, tCloturer] = vt.colonnes;
      ok(vt.debordement <= 0 && vt.colonnes.length === 3 && new Set(vt.colonnes.map((c) => c.x)).size === 1 && tCloturer.y < tAvenir.y && tAvenir.y < tSurPlace.y,
        '[A] au telephone : une colonne, rien ne deborde, l argent a encaisser en tete', `debordement ${vt.debordement} px, x ${vt.colonnes.map((c) => c.x).join('/')}, y a cloturer ${tCloturer && tCloturer.y} < a venir ${tAvenir && tAvenir.y} < sur place ${tSurPlace && tSurPlace.y}`);
      await tel.ctx.close();
    }

    if (section('B')) {
      // ===================================================================
      console.log('');
      console.log('[B] LE GESTE');
      // ===================================================================
      const b = await ouvrir(browser);
      await cliquer(b.page, 7105, 'Arrivé');
      await b.page.waitForFunction(() => Boolean(document.querySelector('.terrain-column.is-onsite [data-terrain-id="7105"]')), null, { timeout: 5000 }).catch(() => {});
      const vb1 = await b.page.evaluate(LIRE);
      const dubois = carte(vb1, 7105) || {};
      ok(dubois.colonne === 'Sur place' && (dubois.statuts || []).length === 0 && (dubois.gestes || []).join('+') === 'Détail+Payé · Carte+Payé · Espèces',
        '[B] Arrivé fait passer la carte dans Sur place', JSON.stringify(dubois));
      ok(b.ecritures.some((e) => String(e.id) === '7105' && e.status === 'arrived'), '[B] le geste ecrit au serveur (PATCH arrived)', JSON.stringify(b.ecritures));
      await cliquer(b.page, 7104, 'Arrivé');
      await b.page.waitForFunction(() => Boolean(document.querySelector('.terrain-column.is-onsite [data-terrain-id="7104"]')), null, { timeout: 5000 }).catch(() => {});
      const vb2 = await b.page.evaluate(LIRE);
      const solvay = carte(vb2, 7104) || {};
      ok(solvay.colonne === 'Sur place' && (solvay.statuts || []).length === 0 && (solvay.gestes || []).join('+') === 'Détail+Payé · Carte+Payé · Espèces' && b.ecritures.some((e) => String(e.id) === '7104' && e.status === 'arrived'),
        '[B] pointer le groupe en retard le fait passer Sur place, sans pastille', JSON.stringify(solvay));
      await cliquer(b.page, 7102, 'Payé · Espèces');
      await b.page.waitForFunction(() => !document.querySelector('[data-terrain-id="7102"]'), null, { timeout: 5000 }).catch(() => {});
      const vb3 = await b.page.evaluate(LIRE);
      ok(!carte(vb3, 7102) && vb3.sousTitre === '9 réservations · 53 joueurs · 2 terminées et payées' && b.ecritures.some((e) => String(e.id) === '7102' && e.status === 'paid' && e.paymentMethod === 'Espèces'),
        '[B] Payé · Espèces clot le dossier (et ecrit le moyen) : il quitte le tableau et compte parmi les termines', `« ${vb3.sousTitre} » ${JSON.stringify(b.ecritures.filter((e) => String(e.id) === '7102'))}`);
      ok(vb3.entree === false, '[B] l entree ne rejoue pas au re-rendu');
      const retour = await b.page.evaluate(() => {
        openStaffMenuPage('planning');
        openStaffMenuPage('arrivals');
        return document.getElementById('staffUtilityPage').classList.contains('utility-enter');
      });
      ok(retour, '[B] l entree joue quand on arrive sur la page');
      ok(b.erreurs.length === 0, '[B] aucune erreur JavaScript', b.erreurs.slice(0, 3).join(' | '));
      await b.ctx.close();
    }

    if (section('C')) {
      // ===================================================================
      console.log('');
      console.log('[C] L HEURE');
      // ===================================================================
      const c = await ouvrir(browser);
      // 16:01 : Dubois (16:00) est dans la marge de retard du centre (5 min
      // par defaut, Etablissement, 2026-10-01) : attendu, pas encore en retard.
      await c.page.clock.fastForward(31 * 60 * 1000);
      await c.page.waitForTimeout(300);
      const vm = await c.page.evaluate(LIRE);
      const duboisMarge = carte(vm, 7105) || {};
      ok(duboisMarge.colonne === 'À venir' && (duboisMarge.statuts || []).length === 0 && duboisMarge.quand === 'attendu maintenant',
        '[C] 16:01, dans la marge de 5 min : Dubois est « attendu maintenant », sans pastille de retard', `Dubois ${duboisMarge.colonne}/${(duboisMarge.statuts || []).join()}/${duboisMarge.quand}`);
      await c.page.clock.fastForward(5 * 60 * 1000);
      await c.page.waitForTimeout(300);
      const vc = await c.page.evaluate(LIRE);
      const duboisTic = carte(vc, 7105) || {};
      const lucasTic = carte(vc, 7103) || {};
      ok(duboisTic.colonne === 'À venir' && (duboisTic.statuts || []).join() === 'En retard · 6 min' && lucasTic.colonne === 'À clôturer' && lucasTic.quand === 'fini depuis 6 min' && vc.colonnes[0].sousTitre === 'Après 17:06',
        '[C] l heure fait avancer les cartes (16:06 : Dubois en retard, Lucas fini, la limite des lignes suit)', `Dubois ${duboisTic.colonne}/${(duboisTic.statuts || []).join()} · Lucas ${lucasTic.colonne}/${lucasTic.quand} · « ${vc.colonnes[0].sousTitre} »`);
      ok(vc.entree === false, '[C] le tic de la minute ne rejoue pas l entree');
      ok(c.erreurs.length === 0, '[C] aucune erreur JavaScript', c.erreurs.slice(0, 3).join(' | '));
      await c.ctx.close();
    }

    if (section('D') || section('E')) {
      const d = await ouvrir(browser);
      if (section('D')) {
        // =================================================================
        console.log('');
        console.log('[D] LES AUTRES DATES');
        // =================================================================
        await d.page.evaluate(() => shiftDate(-1));
        await d.page.waitForFunction(() => /24 sept/.test((document.querySelector('#staffUtilityPage .staff-date-label') || {}).textContent || '') && document.querySelectorAll('.terrain-column.is-closing [data-terrain-id]').length > 0, null, { timeout: 8000 }).catch(() => {});
        const hier = await d.page.evaluate(LIRE);
        const [h1c, h2c, h3c] = hier.colonnes;
        ok(ids(h1c).length === 0 && ids(h2c).length === 0 && ids(h3c).length === 7 && hier.colonnes.every((col) => col.cartes.every((k) => !k.quand && !k.statuts.some((s) => /retard/i.test(s)))),
          '[D] une date passee : rien a venir ni en salle, tout ce qui n est pas paye est a cloturer, sans temps relatif', `${ids(h1c).length}/${ids(h2c).length}/${ids(h3c).length}, temps ${hier.colonnes.flatMap((col) => col.cartes.map((k) => k.quand)).filter(Boolean).join(', ') || 'aucun'}`);
        await d.page.evaluate(() => shiftDate(2));
        await d.page.waitForFunction(() => /26 sept/.test((document.querySelector('#staffUtilityPage .staff-date-label') || {}).textContent || '') && document.querySelectorAll('.terrain-column.is-upcoming [data-terrain-id]').length > 0, null, { timeout: 8000 }).catch(() => {});
        const demain = await d.page.evaluate(LIRE);
        const [f1c, f2c, f3c] = demain.colonnes;
        ok(ids(f1c).length === 9 && f1c.cartes.every((k) => k.forme === 'ligne' && k.gestes.length === 0) && !f1c.sousTitre && ids(f2c).length === 0 && ids(f3c).length === 0,
          '[D] une date future : une liste de preparation, en lignes, sans geste', `${demain.colonnes.map((col) => ids(col).length).join('/')} · formes ${[...new Set(f1c.cartes.map((k) => k.forme))].join(',')}`);
        ok(d.erreurs.length === 0, '[D] aucune erreur JavaScript', d.erreurs.slice(0, 3).join(' | '));
      }

      if (section('E')) {
        // =================================================================
        console.log('');
        console.log('[E] LES ANCIENNES ADRESSES ET LA BARRE LATERALE');
        // =================================================================
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
      }
      await d.ctx.close();
    }

    if (section('F')) {
      // ===================================================================
      console.log('');
      console.log('[F] LES PARAMETRES DU POSTE');
      // ===================================================================
      const f = await ouvrir(browser);
      await f.page.evaluate(() => { setStaffToday(); openStaffMenuPage('settings'); });
      await f.page.waitForSelector('#staffUtilityPage .settings-list', { timeout: 5000 }).catch(() => {});
      const reglages = await f.page.evaluate(() => {
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
        await f.page.evaluate(`(${bouton})(${JSON.stringify(libelle)})?.click()`);
        return f.page.evaluate(`(() => { const b = (${bouton})(${JSON.stringify(libelle)}); return { theme: state.staffTheme, presse: b ? b.getAttribute('aria-pressed') : null }; })()`);
      };
      const sombre = await basculer('Sombre');
      const clair = await basculer('Clair');
      ok(reglages.titres.join(' | ') === 'Apparence | Export du planning | Données' && !reglages.plomberie && reglages.themeAvant === 'light' && sombre.theme === 'dark' && sombre.presse === 'true' && clair.theme === 'light' && clair.presse === 'true',
        '[F] trois reglages reels, le theme bascule dans les deux sens et le dit', `${reglages.titres.join(' | ')} · Charger Ops ${reglages.plomberie} · theme ${reglages.themeAvant} -> ${sombre.theme} (${sombre.presse}) -> ${clair.theme} (${clair.presse})`);
      const fichier = await f.page.evaluate(() => {
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
      ok(f.erreurs.length === 0, '[F] aucune erreur JavaScript', f.erreurs.slice(0, 3).join(' | '));
      await f.ctx.close();
    }

    if (section('G')) {
      // ===================================================================
      console.log('');
      console.log('[G] LE PROGRAMME DES FORMULES');
      // ===================================================================
      const g = await ouvrir(browser, { journee: JOURNEE_FORMULES });
      const vg = await g.page.evaluate(LIRE);
      const emma = carte(vg, 7201) || {};
      ok(emma.colonne === 'Sur place' && (emma.programme || []).join(' / ') === 'Maintenant | Minigolf Blacklight · 12 joueurs | jusqu’à 16:05 / Ensuite | Laser Game (1/2) · 12 joueurs | à 16:15',
        '[G] Sur place dit ou en est le groupe : l activite prevue maintenant et la suivante', `${emma.colonne} · ${(emma.programme || []).join(' / ')}`);
      await g.page.clock.fastForward(102 * 60 * 1000);
      await g.page.waitForTimeout(300);
      const vg2 = await g.page.evaluate(LIRE);
      const emmaTard = carte(vg2, 7201) || {};
      ok(emmaTard.colonne === 'Sur place' && (emmaTard.programme || []).join(' / ') === 'Maintenant | 2 cruches boissons · 12 joueurs | jusqu’à 17:15',
        '[G] une formule reste sur place jusqu a sa derniere activite, meme sans piste ni arene (17:12, cruches jusqu a 17:15)', `${emmaTard.colonne} · ${(emmaTard.programme || []).join(' / ')}`);
      ok(g.erreurs.length === 0, '[G] aucune erreur JavaScript (Terrain)', g.erreurs.slice(0, 3).join(' | '));
      await g.ctx.close();

      const h = await ouvrir(browser, { journee: JOURNEE_FORMULES });
      await h.page.evaluate(() => openStaffMenuPage('formules'));
      await h.page.waitForSelector('#staffUtilityPage .formules-group', { timeout: 8000 }).catch(() => {});
      const vf = await h.page.evaluate(LIRE_FORMULES);
      const groupe = (titre) => vf.groupes.find((x) => x.titre === titre) || { cartes: [] };
      ok(vf.h1 === 'Formules' && vf.groupes.map((x) => `${x.titre}:${x.cartes.map((k) => k.id).join(',')}`).join(' | ') === 'En cours:7201 | À venir:7203 | Terminées:7202',
        '[G] la page Formules suit la journee : en cours, a venir, terminees', vf.groupes.map((x) => `${x.titre}:${x.cartes.map((k) => k.id).join(',')}`).join(' | '));
      const lignesEmma = ((groupe('En cours').cartes[0]) || { lignes: [] }).lignes;
      ok(lignesEmma.map((l) => l.activite).join(', ') === 'Bowling, Minigolf Blacklight, Laser Game (1/2), Laser Game (2/2), 2 cruches boissons',
        '[G] les activites dans l ordre du programme (la definition de la formule met le minigolf avant le bowling)', lignesEmma.map((l) => l.activite).join(', '));
      ok(lignesEmma.map((l) => l.heure).join(', ') === '14:15-15:15, 15:20-16:05, 16:15-16:40, 16:45-17:10, 17:10-17:15',
        '[G] les heures en plage', lignesEmma.map((l) => l.heure).join(', '));
      ok(lignesEmma.map((l) => l.etat).join(', ') === 'Non coché, En cours, À venir, À venir, par Rachel · 15:05',
        '[G] l etat de chaque activite se lit a l heure (non coche, en cours, a venir, fait)', lignesEmma.map((l) => l.etat).join(', '));
      const louise = (groupe('Terminées').cartes[0]) || {};
      ok(louise.id === '7202' && (louise.lignes || []).length === 0 && louise.heures === '10:00-12:30',
        '[G] une formule terminee tient sur sa tete de carte (ses heures, son compte, Ouvrir)', `${louise.id} · ${(louise.lignes || []).length} ligne(s) · ${louise.heures}`);
      ok(vf.sousTitre === '3 formules · 34 joueurs · 1/13 activités cochées' && !vf.notePanneau,
        '[G] le sous-titre dit la journee, sans mode d emploi ni compte recopie', `« ${vf.sousTitre} » · note de panneau ${vf.notePanneau}`);
      await h.page.clock.fastForward(36 * 60 * 1000);
      await h.page.waitForTimeout(300);
      const vf2 = await h.page.evaluate(LIRE_FORMULES);
      const lignesTard = ((vf2.groupes.find((x) => x.titre === 'En cours') || { cartes: [] }).cartes[0] || { lignes: [] }).lignes;
      ok(lignesTard.map((l) => l.etat).join(', ') === 'Non coché, Non coché, À venir, À venir, par Rachel · 15:05',
        '[G] la page Formules suit l heure : a 16:06, le minigolf fini sans coche passe « Non coché »', lignesTard.map((l) => l.etat).join(', '));
      ok(h.erreurs.length === 0, '[G] aucune erreur JavaScript (Formules)', h.erreurs.slice(0, 3).join(' | '));
      await h.ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  console.log(`terrain-check: ${reussis} ok, ${echecs} echec(s)${CASSE ? ` (contre-preuve ${CASSE})` : ''}${SECTION ? ` (section ${SECTION})` : ''}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
