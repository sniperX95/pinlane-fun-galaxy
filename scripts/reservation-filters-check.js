// Gate Playwright - LES FILTRES DE LA LISTE DU JOUR : L'EXCLUSION, PAS LA PRESENCE.
//
// Pourquoi ce gate existe. Verbatim Movsar, 2026-08-14, capture du panneau
// « Toutes les reservations » a l'appui (Tout 9 · A gerer 6 · Sur place 0 ·
// A venir 6 · Terminees 3) : « le truc reservation la c'est bugge, ca apparait
// dans toutes les categories, ca va pas du tout, ce genre de bug ne doit jamais
// arriver. »
//
// LA REGLE REELLE DE CHAQUE ONGLET, telle qu'elle est aujourd'hui :
//   Tout        aucun filtre
//   Sur place   status === 'arrived'      \
//   A venir     status === 'pending'       > TROIS ETATS EXCLUSIFS, qui se
//   Terminees   status === 'paid'         /  totalisent exactement a « Tout »
//   A gerer     status !== 'paid'            UNION de deux etats
//   Avec note   porte une note              ATTRIBUT, vrai dans tout etat
//
// Rien n'etait casse dans le filtrage : les six puces etaient peintes a
// l'identique alors qu'elles repondent a trois questions differentes. Un gerant
// qui additionne tombe sur 40 pour 24 dossiers. Le recoupement reste (c'est la
// liste de travail d'un comptoir : tout ce qui n'est pas fini) mais il est
// desormais SEPARE, marque et explique.
//
// CE QUE CE GATE PROUVE, EN CLIQUANT LES PUCES POUR DE VRAI :
//   1. les trois etats sont EXCLUSIFS DEUX A DEUX : aucune reservation ne sort
//      dans deux d'entre eux (c'est l'assertion d'EXCLUSION, pas de presence)
//   2. leur union est EXACTEMENT « Tout » : personne en trop, personne oublie
//   3. les compteurs affiches se RECOMPOSENT : arrived + pending + paid = all
//   4. « A gerer » est exactement l'union Sur place + A venir, ni plus ni moins
//   5. « Avec note » est un attribut : il pioche dans les trois etats
//   6. dans le DOM, une reservation n'apparait JAMAIS deux fois : une ligne,
//      une seule section, et la section est celle de son etat
//   7. le recoupement est VISIBLE : deux groupes separes, un repere sur les
//      puces qui recoupent, et une ligne de resume qui recompose les comptes
//   8. contre-epreuve par MUTATION : on casse la regle exprès (un etat qui
//      deborde sur un autre, un compteur qui ment) et le gate doit rougir.
//      Sans ca, « 0 defaut » peut vouloir dire « la sonde ne regarde rien ».
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
// LE JEU DE DONNEES. Il couvre TOUS les etats, et pas seulement ceux qui
// arrangent : trois statuts, des notes reparties dans les trois etats (sinon
// « Avec note » ne prouverait pas qu'il est transversal), et des reservations
// HORS PLANNING (ni piste ni laser), qui ont leur propre section en tete de
// liste et qui sont exactement le cas ou une ligne pourrait se dedoubler.
// ---------------------------------------------------------------------------
const JEU = [
  // id, statut, note ?, hors planning ?
  { id: 70001, status: 'pending', note: '', off: false },
  { id: 70002, status: 'pending', note: 'Gateau a sortir', off: false },
  { id: 70003, status: 'pending', note: '', off: true },
  { id: 70004, status: 'arrived', note: '', off: false },
  { id: 70005, status: 'arrived', note: 'Table 4 reservee', off: false },
  { id: 70006, status: 'arrived', note: '', off: true },
  { id: 70007, status: 'paid', note: '', off: false },
  { id: 70008, status: 'paid', note: 'Facture a envoyer', off: false },
  { id: 70009, status: 'paid', note: '', off: true },
  { id: 70010, status: 'pending', note: '', off: false },
  { id: 70011, status: 'arrived', note: '', off: false },
  { id: 70012, status: 'paid', note: '', off: false },
];
const ATTENDU = {
  all: JEU.map((r) => r.id),
  arrived: JEU.filter((r) => r.status === 'arrived').map((r) => r.id),
  pending: JEU.filter((r) => r.status === 'pending').map((r) => r.id),
  paid: JEU.filter((r) => r.status === 'paid').map((r) => r.id),
  open: JEU.filter((r) => r.status !== 'paid').map((r) => r.id),
  notes: JEU.filter((r) => r.note).map((r) => r.id),
};

async function installMock(page, jeu) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
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
      startTime: `${String(11 + (index % 8)).padStart(2, '0')}:00`,
      duration: 1,
      // Hors planning = AUCUNE piste et AUCUN laser : la reservation n'apparait
      // sur aucune grille, elle remonte dans sa propre section de la liste.
      lanes: row.off ? [] : [1 + (index % 8)],
      status: row.status,
      pax: 4,
      price: 40,
      type: row.off ? 'formule' : 'bowling',
      formuleId: row.off ? 'f6' : null,
      label: '',
      notes: row.note || '',
    }));
    const laneStatuses = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0, 10); return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: laneStatuses(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0, 10), durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        if (action === 'centerConfig') return J({ ok: true, centers: [centerFor(u.searchParams.get('centerId') || 'libramont')], activities: [] });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0, 10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, jeu });
}

// Ouvre la console sur l'onglet « Toutes les reservations », filtre remis a zero.
async function ouvrirListe(page) {
  await page.goto(`${BASE_URL}/?v=filtres-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.evaluate(() => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    setView('staff');
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.staffPlanningExpanded = false;
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('planning');
    if (typeof setStaffResourceView === 'function') setStaffResourceView('all');
  });
  await page.waitForSelector('#resList .status-chip', { timeout: 20000 });
  await page.waitForTimeout(400);
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
      cle: [...s.classList].find((c) => ['offplanning', 'arrived', 'pending', 'paid'].includes(c)) || '?',
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
    return {
      ids: rows.map((r) => Number(r.getAttribute('data-res-row-id'))),
      sections,
      chips,
      resume: (document.querySelector('#resList .table-summary') || {}).textContent || '',
    };
  });
}

const trie = (a) => [...a].sort((x, y) => x - y);
const memeEnsemble = (a, b) => trie(a).join(',') === trie(b).join(',');

async function mesurer(page) {
  const vue = {};
  for (const [cle, libelle] of [['all', 'Tout'], ['arrived', 'Sur place'], ['pending', 'À venir'], ['paid', 'Terminées'], ['open', 'À gérer'], ['notes', 'Avec note']]) {
    vue[cle] = await cliquerPuce(page, libelle);
  }
  return vue;
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => { console.log(`FAIL  erreur JS dans la page : ${e.message}`); failures += 1; });
    await installMock(page, JEU);
    await ouvrirListe(page);
    const vue = await mesurer(page);

    // =====================================================================
    console.log('\n[1] CHAQUE ONGLET REND EXACTEMENT SON ENSEMBLE, ET RIEN D AUTRE');
    // =====================================================================
    Object.entries(ATTENDU).forEach(([cle, attendu]) => {
      const rendu = vue[cle] ? vue[cle].ids : null;
      if (!rendu) { ok(false, `[${cle}] la puce existe et rend une liste`); return; }
      const enTrop = rendu.filter((id) => !attendu.includes(id));
      const manquants = attendu.filter((id) => !rendu.includes(id));
      ok(enTrop.length === 0, `[${cle}] AUCUNE reservation en trop`, enTrop.length ? `en trop : ${enTrop.join(', ')}` : `${rendu.length} lignes`);
      ok(manquants.length === 0, `[${cle}] aucune reservation oubliee`, manquants.length ? `manquants : ${manquants.join(', ')}` : `${attendu.length} attendues`);
    });

    // =====================================================================
    console.log('\n[2] L EXCLUSION : LES TROIS ETATS NE SE RECOUPENT JAMAIS');
    // =====================================================================
    const etats = ['arrived', 'pending', 'paid'];
    const paires = [['arrived', 'pending'], ['arrived', 'paid'], ['pending', 'paid']];
    paires.forEach(([a, b]) => {
      const inter = (vue[a]?.ids || []).filter((id) => (vue[b]?.ids || []).includes(id));
      ok(inter.length === 0, `[exclusion] « ${a} » et « ${b} » n ont aucune reservation en commun`, inter.length ? `communes : ${inter.join(', ')}` : '0 commune');
    });
    const union = etats.flatMap((e) => vue[e]?.ids || []);
    ok(union.length === new Set(union).size, '[exclusion] aucune reservation n apparait dans deux etats', `${union.length} lignes pour ${new Set(union).size} dossiers`);
    ok(memeEnsemble(union, vue.all?.ids || []), '[exclusion] l union des trois etats est EXACTEMENT « Tout »', `${union.length} vs ${(vue.all?.ids || []).length}`);

    // =====================================================================
    console.log('\n[3] LES COMPTEURS SE RECOMPOSENT');
    // =====================================================================
    const chips = vue.all?.chips || {};
    const c = (nom) => (chips[nom] === undefined ? null : chips[nom]);
    ok(c('Tout') !== null && c('Sur place') !== null && c('À venir') !== null && c('Terminées') !== null,
      '[compteurs] les quatre puces d etat portent un compte', JSON.stringify(chips));
    const somme = (c('Sur place') || 0) + (c('À venir') || 0) + (c('Terminées') || 0);
    ok(somme === c('Tout'), '[compteurs] Sur place + À venir + Terminées = Tout',
      `${c('Sur place')} + ${c('À venir')} + ${c('Terminées')} = ${somme}, Tout = ${c('Tout')}`);
    ok(c('À gérer') === (c('Sur place') || 0) + (c('À venir') || 0),
      '[compteurs] « À gérer » vaut exactement Sur place + À venir', `${c('À gérer')}`);
    // Et le compte affiche doit egaler le nombre de lignes RENDUES : un compteur
    // juste sur une liste fausse ne vaut rien, et l inverse non plus.
    [['Tout', 'all'], ['Sur place', 'arrived'], ['À venir', 'pending'], ['Terminées', 'paid'], ['À gérer', 'open'], ['Avec note', 'notes']].forEach(([nom, cle]) => {
      ok(c(nom) === (vue[cle]?.ids || []).length,
        `[compteurs] « ${nom} » annonce le nombre de lignes qu il rend`, `${c(nom)} annonce / ${(vue[cle]?.ids || []).length} rendues`);
    });

    // =====================================================================
    console.log('\n[4] « À GÉRER » EST UNE UNION, « AVEC NOTE » UN ATTRIBUT');
    // =====================================================================
    const openIds = vue.open?.ids || [];
    ok(memeEnsemble(openIds, [...(vue.arrived?.ids || []), ...(vue.pending?.ids || [])]),
      '[union] « À gérer » = Sur place + À venir, ni plus ni moins', `${openIds.length} lignes`);
    ok(openIds.every((id) => !(vue.paid?.ids || []).includes(id)),
      '[union] aucune reservation terminee ne se glisse dans « À gérer »');
    const notesIds = vue.notes?.ids || [];
    const notesParEtat = etats.map((e) => notesIds.filter((id) => (vue[e]?.ids || []).includes(id)).length);
    ok(notesParEtat.every((n) => n > 0),
      '[attribut] « Avec note » pioche dans les TROIS etats (donc il les recoupe vraiment)',
      `sur place ${notesParEtat[0]} · a venir ${notesParEtat[1]} · terminees ${notesParEtat[2]}`);

    // =====================================================================
    console.log('\n[5] DANS LE DOM : UNE LIGNE, UNE SEULE SECTION, LA BONNE');
    // =====================================================================
    Object.entries(ATTENDU).forEach(([cle]) => {
      const v = vue[cle];
      if (!v) return;
      const doublons = v.ids.filter((id, i) => v.ids.indexOf(id) !== i);
      ok(doublons.length === 0, `[dom ${cle}] aucune ligne rendue deux fois`, doublons.length ? `doublons : ${doublons.join(', ')}` : `${v.ids.length} lignes`);
      const appartenance = {};
      v.sections.forEach((s) => s.ids.forEach((id) => { appartenance[id] = (appartenance[id] || 0) + 1; }));
      const multi = Object.entries(appartenance).filter(([, n]) => n > 1);
      ok(multi.length === 0, `[dom ${cle}] aucune reservation dans deux sections`, multi.length ? multi.map(([id, n]) => `${id}x${n}`).join(', ') : `${v.sections.length} sections`);
    });
    // La section d une ligne dit son etat (hors planning excepte : c est une
    // section de PLACEMENT, elle prime, et c est ecrit dans l interface).
    const horsPlanning = new Set(JEU.filter((r) => r.off).map((r) => r.id));
    const parId = new Map(JEU.map((r) => [r.id, r.status]));
    let sectionsJustes = 0;
    let sectionsFausses = [];
    (vue.all?.sections || []).forEach((s) => {
      s.ids.forEach((id) => {
        const attendue = horsPlanning.has(id) ? 'offplanning' : parId.get(id);
        if (s.cle === attendue) sectionsJustes += 1;
        else sectionsFausses.push(`${id} dans « ${s.cle} » au lieu de « ${attendue} »`);
      });
    });
    ok(sectionsFausses.length === 0, '[dom] chaque ligne est dans la section de son etat',
      sectionsFausses.length ? sectionsFausses.join(' · ') : `${sectionsJustes} lignes bien rangees`);

    // =====================================================================
    console.log('\n[6] LE RECOUPEMENT EST VISIBLE ET EXPLIQUE, PAS SUBI');
    // =====================================================================
    const forme = await page.evaluate(() => {
      const groupes = [...document.querySelectorAll('#resList .status-group')];
      const etatGroup = groupes[0];
      const crossGroup = groupes.find((g) => g.classList.contains('status-group-cross'));
      const lire = (g) => (g ? [...g.querySelectorAll('.status-chip')].map((c) => {
        const clone = c.cloneNode(true);
        [].forEach.call(clone.querySelectorAll('span'), (s) => s.remove());
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }) : []);
      const filet = crossGroup ? getComputedStyle(crossGroup, '::before') : null;
      const rectEtat = etatGroup ? etatGroup.getBoundingClientRect() : null;
      const rectCross = crossGroup ? crossGroup.getBoundingClientRect() : null;
      return {
        nbGroupes: groupes.length,
        etats: lire(etatGroup),
        croisements: lire(crossGroup),
        reperes: crossGroup ? crossGroup.querySelectorAll('.chip-cross-mark').length : 0,
        reperesEtat: etatGroup ? etatGroup.querySelectorAll('.chip-cross-mark').length : 0,
        titres: crossGroup ? [...crossGroup.querySelectorAll('.status-chip')].map((c) => c.getAttribute('title') || '') : [],
        aria: crossGroup ? [...crossGroup.querySelectorAll('.status-chip')].map((c) => c.getAttribute('aria-label') || '') : [],
        filetLargeur: filet ? filet.width : '',
        separes: rectEtat && rectCross ? Math.round(rectCross.left - rectEtat.right) : null,
      };
    });
    ok(forme.nbGroupes === 2, '[forme] la barre porte DEUX groupes, pas une rangee unique', `${forme.nbGroupes} groupes`);
    ok(forme.etats.join(' · ') === 'Tout · Sur place · À venir · Terminées',
      '[forme] le premier groupe ne porte QUE l etat', forme.etats.join(' · '));
    ok(forme.croisements.length === 2 && forme.croisements.includes('À gérer') && forme.croisements.includes('Avec note'),
      '[forme] le second groupe porte les deux vues qui recoupent', forme.croisements.join(' · '));
    ok(forme.reperes === forme.croisements.length && forme.reperesEtat === 0,
      '[forme] chaque puce qui recoupe porte le repere, aucune puce d etat n en porte',
      `${forme.reperes} reperes cote recoupement, ${forme.reperesEtat} cote etat`);
    ok(forme.titres.every((t) => /recoupe les états/i.test(t)) && forme.aria.every((a) => /recoupe les états/i.test(a)),
      '[forme] le recoupement est dit en toutes lettres, y compris a la synthese vocale');
    ok(forme.filetLargeur === '1px', '[forme] un filet separe les deux groupes', forme.filetLargeur);
    const resume = vue.all?.resume || '';
    const attenduResume = `${ATTENDU.all.length} réservations = ${ATTENDU.arrived.length} sur place + ${ATTENDU.pending.length} à venir + ${ATTENDU.paid.length} terminées`;
    ok(resume.includes(attenduResume), '[forme] la ligne de resume RECOMPOSE les comptes', resume.trim());
    ok(/«\s*À gérer\s*»\s*réunit les\s*\d+\s*non terminées/.test(resume),
      '[forme] et elle nomme le recoupement au lieu de le laisser deviner');

    // =====================================================================
    console.log('\n[7] CONTRE-EPREUVE PAR MUTATION - les FAIL qui suivent sont VOULUS');
    // =====================================================================
    // Fins de ligne normalisees d'abord : selon `core.autocrlf` le fichier
    // arrive en LF ou en CRLF, et une ancre ecrite en LF ne se trouve alors
    // nulle part. Le fichier servi a la page mutee est celui-ci, pas le disque.
    const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
    const LF = String.fromCharCode(10);
    const source = fs.readFileSync(path.join(ROOT, 'assets/app-main.js'), 'utf8').split(CRLF).join(LF);
    const mutations = [
      {
        nom: 'un etat qui deborde : « À venir » rend aussi les arrivees',
        de: "  if (filter === 'all') return reservations;\n  return reservations.filter(r => r.status === filter);",
        vers: "  if (filter === 'all') return reservations;\n  if (filter === 'pending') return reservations.filter(r => r.status !== 'paid');\n  return reservations.filter(r => r.status === filter);",
        attendu: /exclusion|en trop|compteurs/i,
      },
      {
        nom: 'un compteur qui ment : « Terminées » compte tout',
        de: '  const paid = reservations.filter(r => r.status === \'paid\').length;',
        vers: '  const paid = reservations.length;',
        attendu: /compteurs/i,
      },
      {
        nom: 'le recoupement redevient une puce d etat comme les autres',
        de: '      <div class="status-group status-group-cross" role="group" aria-label="Vues qui recoupent les états ci-dessus">',
        vers: '      <div class="status-group" role="group" aria-label="Vues qui recoupent les états ci-dessus">',
        attendu: /forme/i,
      },
    ];
    for (const mutation of mutations) {
      if (!source.includes(mutation.de)) { ok(false, `[mutation] l ancre « ${mutation.nom} » existe encore dans le source`); continue; }
      overrides.set('assets/app-main.js', source.replace(mutation.de, mutation.vers));
      const mutee = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await installMock(mutee, JEU);
      await ouvrirListe(mutee);
      const vm = await mesurer(mutee);
      const chipsM = vm.all?.chips || {};
      const cm = (n) => (chipsM[n] === undefined ? null : chipsM[n]);
      const rompu =
        // exclusion cassee
        (vm.pending?.ids || []).some((id) => (vm.arrived?.ids || []).includes(id))
        // recomposition cassee
        || ((cm('Sur place') || 0) + (cm('À venir') || 0) + (cm('Terminées') || 0)) !== cm('Tout')
        // ou compteur qui n annonce pas ce qu il rend
        || cm('Terminées') !== (vm.paid?.ids || []).length
        // ou la separation des groupes disparue
        || (await mutee.evaluate(() => document.querySelectorAll('#resList .status-group-cross').length)) === 0;
      ok(rompu, `[mutation] « ${mutation.nom} » fait bien rougir la sonde`,
        rompu ? 'la sonde a vu la regression' : 'LA SONDE EST AVEUGLE : elle ne protege rien');
      await mutee.close();
      overrides.delete('assets/app-main.js');
    }

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures ? `${failures} assertion(s) en echec` : 'Tous les controles passent'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
