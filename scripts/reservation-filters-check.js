// Gate Playwright - LES FILTRES DE LA LISTE DU JOUR : L'EXCLUSION, PAS LA PRESENCE.
//
// Pourquoi ce gate existe. Verbatim Movsar, 2026-08-14, capture du panneau
// « Toutes les reservations » a l'appui (Tout 9 · A gerer 6 · Sur place 0 ·
// A venir 6 · Terminees 3) : « le truc reservation la c'est bugge, ca apparait
// dans toutes les categories, ca va pas du tout, ce genre de bug ne doit jamais
// arriver. »
//
// LA REGLE DEPUIS LE 2026-09-30 (lot C de la refonte de la console) : la liste
// lit le MOMENT de chaque groupe, la meme definition que le Terrain, la page
// Formules et la bande « En ce moment » de l'accueil (getStaffTerrainBoard,
// splitStaffTerrainOnsite), et plus son seul statut.
//   Tout        aucun filtre
//   A venir     pas commence et pas pointe arrive ; le RETARD      \
//               (heure passee, arrivee pas pointee) en fait partie,  |
//               marque « En retard · 40 min »                        |  QUATRE ETATS,
//   Sur place   pointe arrive, ou dans sa fenetre et deja paye        >  exclusifs, qui
//   A cloturer  fini, pas paye ; « Non pointé » s'il n'a jamais      |  se totalisent
//               ete pointe (peut-etre pas venu)                      |  a « Tout »
//   Terminees   fini et paye                                        /
//   A gerer     tout sauf Terminees       UNION de trois etats
//   Avec note   porte une note            ATTRIBUT, vrai dans tout etat
//
// DEPUIS LE 2026-10-08 : UNE PUCE PAR SECTION. La liste montrait ses sections
// (« En retard » en tete, les payes replies en bas) pendant que les puces
// comptaient les moments : « À venir 7 » au-dessus de « En retard 2 » et
// « À venir 5 », « Sur place » qui comptait les payes ranges dans « Déjà
// payées ». Les puces sont maintenant les sections, avec leur nombre :
//   En retard   heure passee, pas pointe (montree seulement s il y en a)
//   A venir     pas commence et pas pointe, pas paye
//   Sur place   pointe arrive (ou une activite cochee) pendant sa fenetre
//   A cloturer  fini, pas paye ; « Non pointé » s il n a jamais ete pointe
//   Payées      paye, qu il joue encore ou qu il ait fini (paye = arrive)
//   Pas venus   note « Pas venu » dans la fiche (montree s il y en a)
// Elles restent exclusives et se totalisent a « Tout ». « À gérer » (tout
// sauf les payes) est partie : « Tout » le montre deja, payes replies en bas.
// « Avec note » reste a part : un attribut, vrai dans toute section.
//
// Pourquoi le moment et plus le statut (etat des lieux du 30/09) : selon le
// statut, le club fini depuis dix minutes restait « Sur place », le groupe en
// retard « A venir » sans marque, a l'inverse du Terrain. Deux ecrans du meme
// comptoir ne peuvent pas se contredire sur qui est la.
//
// L'ORACLE EST ECRIT A LA MAIN, dossier par dossier (colonne `moment` du jeu),
// a une heure FIGEE : samedi 3 octobre 2026, 15:10. Il ne rederive pas la
// regle avec le code du produit, sinon une regle fausse des deux cotes
// passerait au vert.
//
// CE QUE CE GATE PROUVE, EN CLIQUANT LES PUCES POUR DE VRAI :
//   0. son prerequis : la page vit bien a 15:10 le 3 octobre, et chaque
//      dossier occupe bien la fenetre que le jeu lui donne
//   1. chaque puce rend exactement son ensemble, rien en trop, rien d'oublie
//   2. les cas qui justifient le lot : le retard reste « A venir » avec sa
//      pastille, l'arrivee en avance est « Sur place », le paye en cours de
//      partie aussi, le paye avant son heure est « Sur place » (paye = arrive, 02/10), le fini jamais pointe
//      est « A cloturer » avec « Non pointé », y compris a la minute pile
//   3. les quatre etats sont EXCLUSIFS deux a deux et leur union est « Tout »
//   4. les compteurs se RECOMPOSENT et annoncent les lignes qu'ils rendent
//   5. « A gerer » est l'union des trois premiers ; « Avec note » pioche dans
//      les quatre
//   6. dans le DOM, une ligne, une seule section, la section de son moment,
//      dans l'ordre de la journee. Depuis le 2026-10-01 (cartes de groupe a
//      la caisse) : le RETARD a sa section rouge en tete, « En retard », qui
//      reste un « À venir » pour les puces ; la section « Hors planning »
//      n existe plus, ces dossiers vivent dans leur moment
//   7. le recoupement est VISIBLE (deux groupes, un repere, dit en toutes
//      lettres) et aucune phrase-formule n'explique l'ecran
//   8. contre-epreuve par MUTATION : chaque regle cassee expres fait rougir la
//      sonde, et pour la bonne raison.
//
// Usage : node scripts/reservation-filters-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_FILTERS_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// L'heure de la journee jouee. Heure LOCALE des deux cotes (Node et le
// navigateur tournent sur la meme machine, donc le meme fuseau) : la page vit
// 15:10 quel que soit le fuseau de la machine. Date FIXE (setFixedTime) et pas
// seulement installee : le retard se lit a la minute (« 40 min »), une horloge
// qui avance pendant le gate le ferait tourner a « 41 min ».
const JOUR = '2026-10-03';
const HEURE = `${JOUR}T15:10:00`;
const MAINTENANT = 15 + 10 / 60;

// Le serveur peut servir une VERSION MUTEE d'un fichier : c'est ce qui rend la
// contre-epreuve possible sans jamais ecrire dans le depot.
const overrides = new Map();

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    let filePath = path.join(ROOT, rel);
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

let failures = 0;
function ok(cond, label, detail = '') { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`); if (!cond) failures += 1; return cond; }

// ---------------------------------------------------------------------------
// LE JEU DE DONNEES, A 15:10. Chaque ligne porte le moment ATTENDU, ecrit a la
// main. Il couvre les cinq statuts utiles (confirme, en attente, arrive, paye)
// dans les quatre moments, les bords (fini a la minute pile, arrive en avance,
// paye d'avance, paye pendant la partie), des notes dans les quatre etats, et
// des dossiers HORS PLANNING (ni piste ni laser) dans les quatre etats aussi :
// ils ont leur section en tete, c'est la ou une ligne pourrait se dedoubler.
// Les pistes ne se chevauchent pas : la grille reste une journee possible.
// ---------------------------------------------------------------------------
const JEU = [
  // id, statut, debut, duree (h), piste, note, hors planning, moment attendu, retard (min)
  { id: 71001, status: 'confirmed', start: '16:00', duree: 1, piste: 6, note: '', off: false, moment: 'upcoming' },
  { id: 71002, status: 'pending', start: '17:00', duree: 1, piste: 7, note: 'Gâteau à sortir', off: false, moment: 'upcoming' },
  // Paye d'avance (en ligne) : il n'est pas encore la, il reste « À venir ».
  { id: 71003, status: 'paid', start: '18:00', duree: 1, piste: 8, note: '', off: false, moment: 'onsite' },
  // Le RETARD : heure passee, jamais pointe. « À venir », marque, pas « Sur place ».
  { id: 71004, status: 'confirmed', start: '14:30', duree: 1, piste: 1, note: '', off: false, moment: 'upcoming', retard: 40 },
  { id: 71005, status: 'pending', start: '15:00', duree: 1, piste: 2, note: '', off: false, moment: 'upcoming', retard: 10 },
  { id: 71006, status: 'arrived', start: '14:00', duree: 2, piste: 3, note: 'Table 4 réservée', off: false, moment: 'onsite' },
  // Arrive en AVANCE : pointe, donc sur place avant sa fenetre.
  { id: 71007, status: 'arrived', start: '16:30', duree: 1, piste: 1, note: '', off: false, moment: 'onsite' },
  // Paye PENDANT la partie : il joue encore, il est sur place.
  { id: 71008, status: 'paid', start: '14:45', duree: 1, piste: 4, note: '', off: false, moment: 'onsite' },
  { id: 71009, status: 'arrived', start: '13:00', duree: 1, piste: 7, note: '', off: false, moment: 'closing' },
  // Fini et jamais pointe : « Non pointé », peut-etre pas venu.
  { id: 71010, status: 'confirmed', start: '12:00', duree: 1, piste: 8, note: 'Rappeler le client', off: false, moment: 'closing', nonPointe: true },
  // Fini a la MINUTE PILE (14:10-15:10) : c'est fini, pas « en cours ».
  { id: 71013, status: 'pending', start: '14:10', duree: 1, piste: 5, note: '', off: false, moment: 'closing', nonPointe: true },
  { id: 71011, status: 'paid', start: '11:00', duree: 1, piste: 1, note: '', off: false, moment: 'done' },
  { id: 71012, status: 'paid', start: '12:30', duree: 2, piste: 2, note: 'Facture à envoyer', off: false, moment: 'done' },
  // HORS PLANNING, un par moment.
  { id: 71014, status: 'confirmed', start: '16:00', duree: 1, piste: null, note: '', off: true, moment: 'upcoming' },
  { id: 71015, status: 'arrived', start: '14:00', duree: 2, piste: null, note: '', off: true, moment: 'onsite' },
  { id: 71016, status: 'paid', start: '11:00', duree: 1, piste: null, note: '', off: true, moment: 'done' },
  { id: 71017, status: 'pending', start: '12:00', duree: 1, piste: null, note: '', off: true, moment: 'closing', nonPointe: true },
];
// La section attendue d'un dossier : paye en bas, retard en tete, sinon son
// moment (ecrit a la main dans le jeu).
const sectionAttendue = (r) => (r.status === 'paid' ? 'paid' : r.retard ? 'late' : r.moment);
const SECTIONS = ['late', 'upcoming', 'onsite', 'closing', 'paid'];
const ATTENDU = {
  all: JEU.map((r) => r.id),
  ...Object.fromEntries(SECTIONS.map((cle) => [cle, JEU.filter((r) => sectionAttendue(r) === cle).map((r) => r.id)])),
  notes: JEU.filter((r) => r.note).map((r) => r.id),
};
// Libelle de chaque puce, dans l'ordre de la barre.
const PUCES = [['all', 'Tout'], ['late', 'En retard'], ['upcoming', 'À venir'], ['onsite', 'Sur place'], ['closing', 'À clôturer'], ['paid', 'Payées'], ['notes', 'Avec note']];
const heure = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h + m / 60; };

async function installMock(page, jeu) {
  // La session expire 24 h apres l HEURE DE LA PAGE, pas apres l heure
  // reelle : figee au 3 octobre, la page voyait sinon une session echue.
  const expiresAt = new Date(new Date(HEURE).getTime() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, jeu }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const openWeek = { '0': { open: '10:00', close: '24:00' }, '1': { open: '10:00', close: '24:00' }, '2': { open: '10:00', close: '24:00' }, '3': { open: '10:00', close: '24:00' }, '4': { open: '10:00', close: '24:00' }, '5': { open: '10:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } };
    const centerFor = (id) => ({
      id, name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels',
      resources: {
        bowling: { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true },
        laser: { weaponCount: 24, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' },
        partyTables: null,
      },
      defaultSchedule: { regular: openWeek, holiday: {} },
      activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {}, classification: {}, customActivities: [],
    });
    const build = (date) => jeu.map((row, index) => ({
      id: row.id,
      name: `Client ${row.id}`,
      phone: '+3247086' + String(1000 + index),
      email: `qa${index}@x.test`,
      date,
      startTime: row.start,
      duration: row.duree,
      // Hors planning = AUCUNE piste et AUCUN laser : la reservation n'apparait
      // sur aucune grille, elle remonte dans sa propre section de la liste.
      lanes: row.off ? [] : [row.piste],
      status: row.status,
      pax: 4,
      price: 40,
      type: row.off ? 'formule' : 'bowling',
      formuleId: row.off ? 'f6' : null,
      label: '',
      notes: row.note || '',
    }));
    const laneStatuses = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE : l etag est
    // l empreinte du contenu servi, meme contenu donc meme etag (sinon la
    // console re-rend a chaque sondage).
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || aujourdhui(); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: laneStatuses(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: aujourdhui(), durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [centerFor(u.searchParams.get('centerId') || 'libramont')], activities: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || aujourdhui(); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, jeu });
}

// Une page neuve, a 15:10 le jour joue, sur l'onglet « Toutes », filtre a zero.
async function ouvrirListe(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log(`FAIL  erreur JS dans la page : ${e.message}`); failures += 1; });
  await page.clock.setFixedTime(new Date(HEURE));
  await installMock(page, JEU);
  await page.goto(`${BASE_URL}/?v=filtres-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.evaluate((jour) => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.currentDate = jour;
    setView('staff');
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.staffPlanningExpanded = false;
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('planning');
    if (typeof setStaffResourceView === 'function') setStaffResourceView('all');
  }, JOUR);
  await page.waitForFunction((n) => document.querySelectorAll('#resList .res-row[data-res-row-id]').length === n, JEU.length, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}

// Clique la puce dont le LIBELLE correspond, comme un humain, puis lit ce que
// la liste rend vraiment. On ne demande jamais a une fonction ce qu'elle
// filtrerait : on lit les lignes qui existent a l'ecran.
async function cliquerPuce(page, libelle) {
  const clique = await page.evaluate((lib) => {
    const chip = [...document.querySelectorAll('#resList .status-chip')]
      .find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith(lib));
    if (!chip) return false;
    chip.click();
    return true;
  }, libelle);
  if (!clique) return null;
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#resList .res-row[data-res-row-id]')];
    const sections = [...document.querySelectorAll('#resList .res-section')].map((s) => ({
      cle: [...s.classList].find((c) => ['late', 'upcoming', 'onsite', 'closing', 'done'].includes(c)) || '?',
      ids: [...s.querySelectorAll('.res-row[data-res-row-id]')].map((r) => Number(r.getAttribute('data-res-row-id'))),
    }));
    const chips = {};
    document.querySelectorAll('#resList .status-chip').forEach((c) => {
      const clone = c.cloneNode(true);
      const compteur = clone.querySelector('span');
      const n = compteur ? Number(compteur.textContent.trim()) : null;
      [].forEach.call(clone.querySelectorAll('span'), (s) => s.remove());
      chips[(clone.textContent || '').replace(/\s+/g, ' ').trim()] = n;
    });
    const pastilles = {};
    rows.forEach((r) => {
      pastilles[r.getAttribute('data-res-row-id')] = {
        retard: ((r.querySelector('.gc-alert.is-late b') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        nonPointe: Boolean(r.querySelector('.gc-alert.is-unmarked')),
      };
    });
    return { ids: rows.map((r) => Number(r.getAttribute('data-res-row-id'))), sections, chips, pastilles };
  });
}

async function lireForme(page) {
  return page.evaluate(() => {
    const groupes = [...document.querySelectorAll('#resList .status-group')];
    const etatGroup = groupes[0];
    const crossGroup = groupes.find((g) => g.classList.contains('status-group-cross'));
    const lire = (g) => (g ? [...g.querySelectorAll('.status-chip')].map((c) => {
      const clone = c.cloneNode(true);
      [].forEach.call(clone.querySelectorAll('span'), (s) => s.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }) : []);
    const filet = crossGroup ? getComputedStyle(crossGroup, '::before') : null;
    const barre = document.querySelector('#resList .table-toolbar');
    return {
      nbGroupes: groupes.length,
      etats: lire(etatGroup),
      croisements: lire(crossGroup),
      reperes: crossGroup ? crossGroup.querySelectorAll('.chip-cross-mark').length : 0,
      reperesEtat: etatGroup ? etatGroup.querySelectorAll('.chip-cross-mark').length : 0,
      titres: crossGroup ? [...crossGroup.querySelectorAll('.status-chip')].map((c) => c.getAttribute('title') || '') : [],
      aria: crossGroup ? [...crossGroup.querySelectorAll('.status-chip')].map((c) => c.getAttribute('aria-label') || '') : [],
      filetLargeur: filet ? filet.width : '',
      barre: barre ? barre.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  });
}

async function mesurer(page) {
  const vue = {};
  for (const [cle, libelle] of PUCES) vue[cle] = await cliquerPuce(page, libelle);
  vue.forme = await lireForme(page);
  // Le prerequis : l'heure et la date de la page, et la fenetre de chaque
  // dossier telle que le produit la lit.
  vue.prerequis = await page.evaluate((ids) => ({
    jour: typeof todayStr === 'function' ? todayStr() : '',
    date: state.currentDate,
    maintenant: typeof currentTimeDecimal === 'function' ? currentTimeDecimal() : null,
    fenetres: ids.map((id) => {
      const r = (state.reservations || []).find((x) => Number(x.id) === id);
      return r ? { id, ...getStaffTerrainSpan(r) } : { id, absent: true };
    }),
  }), JEU.map((r) => r.id));
  return vue;
}

const trie = (a) => [...a].sort((x, y) => x - y);
const memeEnsemble = (a, b) => trie(a).join(',') === trie(b).join(',');

// Tous les controles, sous forme de liste : la passe principale les imprime, la
// contre-epreuve les compte. Une seule definition, donc la contre-epreuve
// mesure exactement ce que la passe principale affirme.
function controler(vue) {
  const out = [];
  const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });

  // [0] PREREQUIS
  const p = vue.prerequis || {};
  c(p.jour === JOUR && p.date === JOUR, '[0] la page vit le jour joue', `aujourd hui ${p.jour}, date affichee ${p.date}`);
  c(p.maintenant !== null && Math.abs(p.maintenant - MAINTENANT) < 1 / 120, '[0] et il est 15:10 pour elle', `${p.maintenant}`);
  const fenetresFausses = (p.fenetres || []).filter((f) => {
    const r = JEU.find((x) => x.id === f.id);
    return f.absent || Math.abs(f.start - heure(r.start)) > 1e-6 || Math.abs(f.end - (heure(r.start) + r.duree)) > 1e-6;
  });
  c(fenetresFausses.length === 0, '[0] chaque dossier occupe la fenetre que le jeu lui donne',
    fenetresFausses.length ? fenetresFausses.map((f) => `${f.id} ${f.absent ? 'absent' : `${f.start}-${f.end}`}`).join(', ') : `${JEU.length} fenetres`);

  // [1] CHAQUE PUCE REND EXACTEMENT SON ENSEMBLE
  Object.entries(ATTENDU).forEach(([cle, attendu]) => {
    const rendu = vue[cle] ? vue[cle].ids : null;
    if (!rendu) { c(false, `[1] [${cle}] la puce existe et rend une liste`); return; }
    const enTrop = rendu.filter((id) => !attendu.includes(id));
    const manquants = attendu.filter((id) => !rendu.includes(id));
    c(enTrop.length === 0, `[1] [${cle}] AUCUNE reservation en trop`, enTrop.length ? `en trop : ${enTrop.join(', ')}` : `${rendu.length} lignes`);
    c(manquants.length === 0, `[1] [${cle}] aucune reservation oubliee`, manquants.length ? `manquants : ${manquants.join(', ')}` : `${attendu.length} attendues`);
  });

  // [2] LES CAS QUI JUSTIFIENT LE LOT
  const dans = (cle, id) => (vue[cle]?.ids || []).includes(id);
  const pastilles = vue.all?.pastilles || {};
  JEU.filter((r) => r.retard).forEach((r) => {
    c(dans('late', r.id) && !dans('onsite', r.id) && !dans('upcoming', r.id), `[2] le retard ${r.id} (${r.start}) est « En retard », ni « À venir » ni « Sur place »`);
    const lu = (pastilles[r.id] || {}).retard || '';
    c(lu === `En retard · ${r.retard} min`, `[2] et sa pastille dit depuis quand il est attendu`, `« ${lu} » pour « En retard · ${r.retard} min »`);
  });
  const sansRetard = JEU.filter((r) => !r.retard && (pastilles[r.id] || {}).retard);
  c(sansRetard.length === 0, '[2] aucune autre ligne ne porte « En retard »', sansRetard.map((r) => r.id).join(', '));
  c(dans('onsite', 71007), '[2] l arrivee pointee en AVANCE est « Sur place »');
  // PAYE = ARRIVE (2026-10-02, Movsar : « s ils ont paye c est qu ils sont
  // arrives, le paiement est que sur place ») et PAYE EN BAS (2026-10-01) :
  // paye pendant ou avant sa partie, il est dans « Payées », jamais « À venir ».
  c(dans('paid', 71008) && !dans('onsite', 71008), '[2] le groupe qui a paye PENDANT sa partie est dans « Payées »');
  c(dans('paid', 71003) && !dans('upcoming', 71003), '[2] le groupe qui a paye avant son heure est dans « Payées », pas « À venir »');
  c(dans('closing', 71013), '[2] fini a la minute pile, il est « À clôturer »');
  JEU.filter((r) => r.nonPointe).forEach((r) => {
    c(dans('closing', r.id) && (pastilles[r.id] || {}).nonPointe, `[2] le fini jamais pointe ${r.id} est « À clôturer » avec « Non pointé »`);
  });
  const nonPointesEnTrop = JEU.filter((r) => !r.nonPointe && (pastilles[r.id] || {}).nonPointe);
  c(nonPointesEnTrop.length === 0, '[2] « Non pointé » ne se pose sur aucune autre ligne', nonPointesEnTrop.map((r) => r.id).join(', '));

  // [3] L EXCLUSION
  for (let i = 0; i < SECTIONS.length; i += 1) {
    for (let j = i + 1; j < SECTIONS.length; j += 1) {
      const [a, b] = [SECTIONS[i], SECTIONS[j]];
      const inter = (vue[a]?.ids || []).filter((id) => (vue[b]?.ids || []).includes(id));
      c(inter.length === 0, `[3] « ${a} » et « ${b} » n ont aucune reservation en commun`, inter.length ? `communes : ${inter.join(', ')}` : '');
    }
  }
  const union = SECTIONS.flatMap((e) => vue[e]?.ids || []);
  c(union.length === new Set(union).size, '[3] aucune reservation n apparait dans deux sections', `${union.length} lignes pour ${new Set(union).size} dossiers`);
  c(memeEnsemble(union, vue.all?.ids || []), '[3] l union des sections est EXACTEMENT « Tout »', `${union.length} vs ${(vue.all?.ids || []).length}`);

  // [4] LES COMPTEURS : une puce annonce sa section, et elles se totalisent.
  const chips = vue.all?.chips || {};
  const n = (nom) => (chips[nom] === undefined ? null : chips[nom]);
  const motsSections = PUCES.filter(([cle]) => SECTIONS.includes(cle)).map(([, nom]) => nom);
  c(['Tout', ...motsSections].every((nom) => n(nom) !== null), '[4] « Tout » et chaque puce de section portent un compte', JSON.stringify(chips));
  const somme = motsSections.reduce((t, nom) => t + (n(nom) || 0), 0);
  c(somme === n('Tout'), `[4] ${motsSections.join(' + ')} = Tout`, `${somme} pour ${n('Tout')}`);
  c(n('À gérer') === null && n('Terminées') === null, '[4] plus de puce « À gérer » ni « Terminées »', JSON.stringify(chips));
  PUCES.forEach(([cle, nom]) => {
    c(n(nom) === (vue[cle]?.ids || []).length, `[4] « ${nom} » annonce le nombre de lignes qu il rend`, `${n(nom)} annonce / ${(vue[cle]?.ids || []).length} rendues`);
  });
  const sectionsTout = vue.all?.sections || [];
  SECTIONS.forEach((cle) => {
    const s = sectionsTout.find((x) => x.cle === (cle === 'paid' ? 'done' : cle));
    const mot = (PUCES.find(([k]) => k === cle) || [])[1];
    c((s ? s.ids.length : 0) === n(mot), `[4] la puce « ${mot} » annonce les cartes de sa section dans « Tout »`, `${n(mot)} / ${s ? s.ids.length : 0}`);
  });

  // [5] L ATTRIBUT
  const notesIds = vue.notes?.ids || [];
  const notesParSection = SECTIONS.map((e) => notesIds.filter((id) => (vue[e]?.ids || []).includes(id)).length);
  c(notesParSection.filter((x) => x > 0).length >= 4, '[5] « Avec note » pioche dans quatre sections', notesParSection.join(' · '));

  // [6] LE DOM
  PUCES.forEach(([cle]) => {
    const v = vue[cle];
    if (!v) return;
    const doublons = v.ids.filter((id, i) => v.ids.indexOf(id) !== i);
    c(doublons.length === 0, `[6] [${cle}] aucune ligne rendue deux fois`, doublons.length ? `doublons : ${doublons.join(', ')}` : '');
    const appartenance = {};
    v.sections.forEach((s) => s.ids.forEach((id) => { appartenance[id] = (appartenance[id] || 0) + 1; }));
    const multi = Object.entries(appartenance).filter(([, x]) => x > 1);
    c(multi.length === 0, `[6] [${cle}] aucune reservation dans deux sections`, multi.map(([id, x]) => `${id}x${x}`).join(', '));
  });
  // La section d une ligne dit son moment ; le retard a la sienne, en tete.
  // Un dossier deja encaisse descend dans « Déjà payées » (repliee, en bas),
  // meme s il joue encore : la liste de travail ne garde que ce qui reste.
  const fausses = [];
  (vue.all?.sections || []).forEach((s) => s.ids.forEach((id) => {
    const r = JEU.find((x) => x.id === id);
    const attendue = r.status === 'paid' ? 'done' : r.retard ? 'late' : r.moment;
    if (s.cle !== attendue) fausses.push(`${id} dans « ${s.cle} » au lieu de « ${attendue} »`);
  }));
  c(fausses.length === 0, '[6] chaque ligne est dans la section de son moment', fausses.join(' · '));
  const ordre = (vue.all?.sections || []).map((s) => s.cle).join(' > ');
  c(ordre === 'late > upcoming > onsite > closing > done', '[6] le retard en tete, puis les sections dans l ordre de la journee', ordre);

  // [7] LA FORME
  const f = vue.forme || {};
  c(f.nbGroupes === 2, '[7] la barre porte DEUX groupes, pas une rangee unique', `${f.nbGroupes} groupes`);
  c((f.etats || []).join(' · ') === 'Tout · En retard · À venir · Sur place · À clôturer · Payées', '[7] le premier groupe ne porte QUE les sections, dans l ordre de la liste', (f.etats || []).join(' · '));
  c((f.croisements || []).join(' · ') === 'Avec note', '[7] le second groupe porte la vue qui recoupe, « Avec note »', (f.croisements || []).join(' · '));
  c(f.reperes === (f.croisements || []).length && f.reperesEtat === 0, '[7] la puce qui recoupe porte le repere, aucune puce de section n en porte', `${f.reperes} / ${f.reperesEtat}`);
  c((f.titres || []).every((t) => /recoupe les sections/i.test(t)) && (f.aria || []).every((a) => /recoupe les sections/i.test(a)), '[7] le recoupement est dit en toutes lettres, y compris a la synthese vocale');
  c(f.filetLargeur === '1px', '[7] un filet separe les deux groupes', f.filetLargeur);
  c(!/=\s*\d/.test(f.barre || ''), '[7] aucune phrase-formule n explique l ecran sous les filtres', f.barre);
  return out;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const { ctx, page } = await ouvrirListe(browser);
    const vue = await mesurer(page);
    let rubrique = '';
    controler(vue).forEach((x) => {
      const r = x.label.slice(0, 3);
      if (r !== rubrique) { rubrique = r; console.log(''); }
      ok(x.cond, x.label, x.detail);
    });
    await ctx.close();

    // =====================================================================
    console.log('\n[8] CONTRE-EPREUVE PAR MUTATION - la sonde doit rougir, et pour la bonne raison');
    // =====================================================================
    // Fins de ligne normalisees d'abord : selon `core.autocrlf` le fichier
    // arrive en LF ou en CRLF, et une ancre ecrite en LF ne se trouve alors
    // nulle part. Le fichier servi a la page mutee est celui-ci, pas le disque.
    const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
    const LF = String.fromCharCode(10);
    const source = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').split(CRLF).join(LF);
    const mutations = [
      {
        // LE DEFAUT QUE LE LOT CORRIGE, cote retard : le groupe attendu depuis
        // 40 minutes range « Sur place » alors que personne ne l a vu.
        nom: 'le retard est range « Sur place »',
        de: "  poser(partage.late, 'upcoming', true);",
        vers: "  poser(partage.late, 'onsite', true);",
        attendu: /^\[(1|2)\]/,
      },
      {
        // LE RETOUR EN ARRIERE ENTIER : la liste retombe sur le statut seul
        // (le club fini reste « Sur place », le retard « À venir » sans marque).
        nom: 'la liste retombe sur le statut',
        de: "function getStaffListeSection(moments, r) {\n  const m = moments.get(String(r.id));",
        vers: "function getStaffListeSection(moments, r) {\n  return r.status === 'paid' ? 'paid' : r.status === 'arrived' ? 'onsite' : 'upcoming';\n  const m = moments.get(String(r.id));",
        attendu: /^\[(1|2)\]/,
      },
      {
        // LE DEFAUT DU 2026-10-08 : une puce qui ne compte pas sa section.
        nom: 'un compteur qui ment : « Payées » compte aussi les arrives',
        de: "  reservations.forEach(r => { counts[getStaffListeSection(moments, r)] += 1; });",
        vers: "  reservations.forEach(r => { counts[getStaffListeSection(moments, r)] += 1; });\n  counts.paid += reservations.filter(r => r.status === 'arrived').length;",
        attendu: /^\[4\]/,
      },
      {
        nom: 'une section prend les lignes d une autre',
        de: "  const payes = parSection('paid');",
        vers: "  const payes = parSection('closing');",
        attendu: /^\[(1|4|6)\]/,
      },
      {
        nom: 'le fini jamais pointe perd son « Non pointé »',
        de: "  if (moment && moment.etat === 'closing' && isUpcomingReservationStatus(r.status) && !groupeAJoue(r)) {\n    return '<div class=\"gc-alert is-unmarked\">",
        vers: "  if (false) {\n    return '<div class=\"gc-alert is-unmarked\">",
        attendu: /^\[2\]/,
      },
      {
        nom: 'le retard perd sa pastille',
        de: '  if (moment && moment.late) {\n    const depuis',
        vers: '  if (false) {\n    const depuis',
        attendu: /^\[2\]/,
      },
      {
        nom: 'le recoupement redevient une puce de section comme les autres',
        de: '<div class="status-group status-group-cross" role="group" aria-label="Vue qui recoupe les sections">',
        vers: '<div class="status-group" role="group" aria-label="Vue qui recoupe les sections">',
        attendu: /^\[7\]/,
      },
    ];
    for (const mutation of mutations) {
      // UNE ANCRE INTROUVABLE EST UNE GARDE MORTE : l assertion est ecrite en
      // vert aussi, le journal dit que la sonde peut encore etre injectee.
      const n = source.split(mutation.de).length - 1;
      if (!ok(n === 1, `[mutation] l ancre de « ${mutation.nom} » existe une fois dans le source livre`,
        n === 1 ? '' : `trouvee ${n} fois : la contre-epreuve est DESARMEE`)) continue;
      overrides.set('assets/app-main.js', source.replace(mutation.de, mutation.vers));
      const { ctx: ctxM, page: mutee } = await ouvrirListe(browser);
      const rouges = controler(await mesurer(mutee)).filter((x) => !x.cond);
      const bonneRaison = rouges.filter((x) => mutation.attendu.test(x.label));
      ok(bonneRaison.length > 0, `[mutation] « ${mutation.nom} » fait rougir la sonde, pour la bonne raison`,
        rouges.length ? `${rouges.length} controle(s) rouge(s), dont : ${(bonneRaison[0] || rouges[0]).label}` : 'LA SONDE EST AVEUGLE : elle ne protege rien');
      await ctxM.close();
      overrides.delete('assets/app-main.js');
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures ? `${failures} assertion(s) en echec` : 'Tous les controles passent'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
