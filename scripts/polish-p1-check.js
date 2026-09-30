// Gate Playwright - LE LOT DE POLISH P1 : CINQ PROPRIETES QUI ONT VRAIMENT CASSE.
//
// POURQUOI CE GATE EXISTE. Un lot de 49 correctifs de polish a ete livre le
// 2026-09-03. Trois relectures adverses en ont ressorti des defauts REELS, tous
// mesures. Ce gate ne garde pas les 49 : il garde les cinq proprietes qui ont
// casse pour de bon, ou qui portent une demande explicite de Movsar. Les autres
// sont deja tenues par les gates de leur sujet (planning-matrix, reservation-
// filters, charts, direction-cockpit).
//
// IL VERIFIE DES COMPORTEMENTS, JAMAIS DES PRESENCES. Un test qui verifie qu une
// chose EXISTE au lieu qu un effet SE PRODUISE est un faux vert, et ce depot en
// a paye plusieurs. Chaque propriete est donc mesuree sur ce que l ECRAN rend
// ou sur ce que le RESEAU porte, apres un vrai geste.
//
// LES CINQ PROPRIETES, ET LA MESURE D ORIGINE DE CHACUNE :
//
//   [A] LA BULLE DE NOTE EXISTE SUR LA CARTE LA PLUS COURTE.
//       Movsar, 2026-09-03 : « la petite icone de note ne se voit nulle part ».
//       Cause : les planchers de la carte etaient ecrits en `em` dans des
//       requetes de CONTENEUR, ou l `em` se resout sur la police du conteneur
//       interroge (.lane-col, 14px) et non sur celle de la carte. 9,6em valait
//       134,4px pour une piste de 134,2px : sur le planning 8 pistes en 1440,
//       AUCUN marqueur n atteignait l ecran. Mesure du defaut : bulle 0x0.
//       Mesure d aujourd hui : 12x12, debordement 0. Verifie en 1440x900 et en
//       390x844, parce que la piste ne fait pas la meme largeur aux deux.
//
//   [B] UNE ALERTE APPARTIENT A L ECRAN QUI L A LEVEE, ET UN RETOUR FORCE
//       S EXPLIQUE. Deux faces de la meme regle. Face avant : l alerte de
//       l ecran qu on quitte disparait (elle ne s effacait que par un delai de
//       4,5 s, et voyageait donc avec le client). Face arriere, et c est la
//       REGRESSION que la revue a trouvee : trois branches de confirmBooking
//       posaient leur explication AVANT goStep(2), donc clearAlert() l effacait
//       - mesure sur le tunnel reel : alertBox.innerHTML.length = 380 apres
//       showAlert, 0 apres goStep(2), et le client renvoye au choix des
//       horaires SANS UN MOT. Le correctif d apparence coutait une information.
//
//   [C] « A VENIR » NE DEBORDE PAS ET NE RETROGRADE PAS. Un dossier « a venir »
//       s ecrit de deux facons ('confirmed' par defaut, 'pending' pour une
//       demande) : le filtre doit rendre les deux et rien d autre. Et le bouton
//       « Confirme », qui s allume pour les deux, ecrivait toujours 'pending' :
//       sur un dossier deja confirme, un bouton DEJA enfonce changeait la
//       donnee sans que rien ne bouge a l ecran, et la page Clients / Groupes,
//       qui filtre les deux separement, voyait le dossier changer de colonne.
//
//   [D] UN SEUL FORMAT DE MONTANT PAR ECRAN. formatMoney (app-main.js) pose une
//       espace fine insecable U+202F avant l euro ; la bibliotheque de
//       graphiques posait une espace ordinaire U+0020. Sur l ecran de
//       Direction, la tuile KPI (ecrite par countUp, donc par la bibliotheque)
//       et les montants de tableau (ecrits par formatMoney) affichaient
//       « 7 350 € » contre « 7 350 € » : identiques a l oeil, differents en
//       octets, et la coupure de ligne ne se comporte pas pareil.
//
//   [E] UN PANNEAU NE SE CONTREDIT PAS. Le sous-titre de la modale d alerte
//       compte les dossiers concernes. Mais deux signaux n en portent AUCUN par
//       construction (« Pistes en maintenance », « N demandes sur mesure en
//       attente ») : y compter les dossiers ecrivait « Aucune reservation
//       concernee » sous un titre qui annonce justement de l argent qui attend
//       une reponse.
//
// CONTRE-EPREUVE PAR MUTATION, EN FIN DE GATE ET POUR CHAQUE PROPRIETE.
// La mesure de chaque propriete est une FONCTION : la passe verte l appelle sur
// le code livre, la passe de mutation la rappelle sur une copie SERVIE ou le
// correctif est annule, et exige qu au moins un verdict tombe. Rien n est jamais
// ecrit sur le disque : le serveur sert la version mutee depuis la memoire, donc
// aucune restauration ne peut etre oubliee. Un gate qui ne sait pas rougir ne
// prouve rien, et un gate qui se satisfait en retirant ce qu il mesure est pire
// que pas de gate.
//
// Usage : node scripts/polish-p1-check.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_POLISH_P1_PORT || 4641);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// L espace fine insecable, ecrite en ECHAPPEMENT : le caractere est invisible
// dans un editeur, et un gate sur la typographie ne peut pas se permettre une
// reference qu on ne relit pas.
const NBSP_FINE = '\u202F';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LE SERVEUR. Il sert le depot tel quel, PLUS deux choses :
//   - une carte d overrides en memoire : c est elle qui rend la contre-epreuve
//     possible sans jamais ecrire dans le depot (donc sans restauration a
//     oublier, ni mutation laissee en place apres un echec) ;
//   - les trois routes publiques du tunnel client, pour que le parcours de la
//     propriete [B] se joue sur des donnees fixes.
// ---------------------------------------------------------------------------
const overrides = new Map();

// Un samedi STRICTEMENT futur : le tunnel masque les creneaux deja passes, et
// une fixture calee sur aujourd hui rougirait par pure horloge en fin de
// journee. Le samedi parce que le centre de reference y ouvre 10h - minuit.
function samediSuivant() {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do { cursor.setUTCDate(cursor.getUTCDate() + 1); } while (cursor.getUTCDay() !== 6);
  return cursor.toISOString().slice(0, 10);
}
const DATE_TUNNEL = samediSuivant();

// Un samedi PASSE, pour la modale des alertes [E] : depuis le 2026-09-30, le
// signal qui porte des dossiers de paiement (« Paiements non soldés ») ne vit
// que sur une date passee. Le jour meme, l argent des groupes finis passe
// par le bandeau « En ce moment », et un groupe pas encore venu n est pas un
// paiement a faire : sur AUJOURD HUI, le signal dependait de l heure du run.
function samediPasse() {
  const d = new Date();
  d.setDate(d.getDate() - 7 - ((d.getDay() + 1) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DATE_PASSEE = samediPasse();
const CENTRE = 'libramont';

function metaPublique() {
  return {
    ok: true, today: DATE_TUNNEL, durationOptions: [],
    formules: [],
    activities: [
      { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, order: 1, defaultMinutes: 60 },
    ],
    center: {
      id: CENTRE, status: 'active',
      defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: null, 2: { open: '14:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '14:00', close: '22:00' }, 5: { open: '14:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
      holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] },
      offerAvailability: {},
      day: { date: DATE_TUNNEL, open: true, schedule: { open: 10, close: 24, label: '10h - Minuit' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
    },
  };
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    const json = (payload) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/api/public-booking-meta') return json(metaPublique());
    if (url.pathname === '/api/public-availability') {
      return json({ ok: true, date: DATE_TUNNEL, laneCount: 1, duration: 2, totalDuration: 2, price: 78, requiresLanes: true, label: 'Bowling', slots: [], suggestions: [], message: '' });
    }
    if (url.pathname === '/api/public-reservations') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => json({ ok: true, reservation: { id: 9001, lanes: [1], status: 'pending', price: 78 }, ops: {}, communications: [], warnings: [] }));
      return undefined;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return undefined;
    }
    let filePath = path.join(ROOT, rel);
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return undefined; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
    return undefined;
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------------------
// LE MOCK STAFF. Une session direction, un centre a 8 pistes, et le jeu de
// reservations passe en argument : chaque propriete a besoin d une journee
// DIFFERENTE, et une fixture partagee obligerait chacune a composer avec les
// besoins des autres.
// window.__PATCHES__ enregistre les ecritures : la propriete [C] se juge sur ce
// qui part sur le reseau, pas sur ce qui s affiche.
// ---------------------------------------------------------------------------
async function installMockStaff(page, jeu, options = {}) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, jeu, lanesEnMaintenance }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const openWeek = { 0: { open: '10:00', close: '24:00' }, 1: { open: '10:00', close: '24:00' }, 2: { open: '10:00', close: '24:00' }, 3: { open: '10:00', close: '24:00' }, 4: { open: '10:00', close: '24:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } };
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
      name: row.name || `Client ${row.id}`,
      phone: '+3247086' + String(1000 + index),
      email: `qa${index}@x.test`,
      date,
      startTime: row.start,
      duration: row.duration,
      lanes: row.lane ? [row.lane] : [],
      status: row.status,
      pax: row.pax || 4,
      price: row.price === undefined ? 40 : row.price,
      type: 'bowling',
      formuleId: null,
      label: '',
      notes: row.note || '',
      occasion: row.occasion || '',
    }));
    const laneStatuses = () => Array.from({ length: 8 }).reduce((a, _, i) => {
      a[i + 1] = (lanesEnMaintenance || []).includes(i + 1) ? 'maintenance' : 'active';
      return a;
    }, {});
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    window.__PATCHES__ = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (methode === 'PATCH' || methode === 'POST' || methode === 'PUT') {
        let corps = null;
        try { corps = JSON.parse(init.body || 'null'); } catch (e) { corps = null; }
        window.__PATCHES__.push({ methode, chemin: u.pathname, corps });
        if (/reservation/i.test(u.pathname)) return J({ ok: true, reservation: corps });
      }
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
  }, { expiresAt, jeu, lanesEnMaintenance: options.lanesEnMaintenance || [] });
}

async function ouvrirStaff(page, pageStaff, vue, jour = null) {
  await page.goto(`${BASE_URL}/?v=p1-${Date.now()}-${Math.random().toString(36).slice(2)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.evaluate(({ cible, resource, jour }) => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    setView('staff');
    // LE PLANNING SE MESURE UN JOUR OU LE CENTRE EST OUVERT.
    //
    // Sans cette ligne, le gate travaillait sur AUJOURD HUI : il est passe au
    // vert des mois durant, puis a rougi net a minuit un dimanche soir, parce
    // que Libramont ferme le lundi. Un jour ferme ne dessine aucune piste, donc
    // aucune carte a mesurer, et l echec ressemblait a une regression de code.
    // Le samedi est deja le jour de reference du tunnel ici (ouvert 10h-minuit).
    if (jour) state.currentDate = jour;
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    state.staffPlanningExpanded = false;
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage(cible);
    if (resource && typeof setStaffResourceView === 'function') setStaffResourceView(resource);
  }, { cible: pageStaff, resource: vue, jour });
  await page.waitForTimeout(600);
}

// Un contexte NEUF par scenario : un contexte partage transmet le localStorage
// d une page a l autre, et le second scenario heriterait de l etat du premier
// (date de travail, filtre de statut, theme). Ce piege a deja coute un gate.
// PENDANT LA PASSE DE MUTATION, UNE ERREUR DE PAGE EST ATTENDUE, PAS UN DEFAUT.
// Sans ce drapeau, une mutation qui casserait le rendu compterait un FAIL de
// plus au lieu d etre la preuve qu on cherche : le gate rougirait pour la
// mauvaise raison, et un lecteur croirait a une regression du produit.
let enMutation = false;
async function pageNeuve(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    if (enMutation) { console.log(`      (mutation) erreur JS attendue : ${e.message}`); return; }
    console.log(`FAIL  erreur JS dans la page : ${e.message}`);
    failures += 1;
  });
  return { page, fermer: () => context.close() };
}

// ===========================================================================
// [A] LA BULLE DE NOTE SUR LA CARTE LA PLUS COURTE
// ===========================================================================
// La carte 30 minutes est la plus courte que le planning sache rendre (classe
// `dens-xs`, une seule ligne). Les deux autres sont la pour PROUVER LE MONTAGE :
// sans elles, « la plus courte » ne serait qu une affirmation du gate.
const JEU_PLANNING = [
  { id: 80001, lane: 1, start: '14:00', duration: 0.5, pax: 11, status: 'pending', note: 'Gateau a sortir a 14h30, bougies dans le frigo' },
  { id: 80002, lane: 2, start: '15:00', duration: 1, pax: 6, status: 'confirmed', occasion: 'anniversaire' },
  { id: 80003, lane: 3, start: '16:00', duration: 2, pax: 8, status: 'arrived', note: 'Un joueur sourd' },
];

async function mesurerA(browser) {
  const resultat = {};
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { page, fermer } = await pageNeuve(browser, vp);
    try {
      await installMockStaff(page, JEU_PLANNING);
      await ouvrirStaff(page, 'planning', 'bowling', DATE_TUNNEL);
      await page.waitForSelector('.booking[data-booking-res-id="80001"]', { timeout: 20000 });
      await page.waitForTimeout(400);
      resultat[vp.width] = await page.evaluate(() => {
        const lire = (id) => {
          const carte = document.querySelector(`.booking[data-booking-res-id="${id}"]`);
          if (!carte) return null;
          const rc = carte.getBoundingClientRect();
          const bulle = carte.querySelector('.bk-flag.flag-note');
          const rb = bulle ? bulle.getBoundingClientRect() : null;
          const piste = carte.closest('.lane-col');
          return {
            carte: { w: rc.width, h: rc.height, top: rc.top, bottom: rc.bottom, left: rc.left, right: rc.right },
            piste: piste ? piste.getBoundingClientRect().width : null,
            classes: carte.className,
            bulle: rb ? { w: rb.width, h: rb.height, top: rb.top, bottom: rb.bottom, left: rb.left, right: rb.right } : null,
            debordH: carte.scrollHeight - carte.clientHeight,
            debordW: carte.scrollWidth - carte.clientWidth,
          };
        };
        return { courte: lire(80001), moyenne: lire(80002), longue: lire(80003) };
      });
    } finally {
      await fermer();
    }
  }
  return resultat;
}

function jugerA(m) {
  const verdicts = [];
  for (const largeur of [1440, 390]) {
    const v = m[largeur];
    const c = v && v.courte;
    if (!c) { verdicts.push({ ok: false, label: `[A ${largeur}] la carte de 30 minutes est rendue`, detail: 'carte introuvable' }); continue; }
    // MONTAGE D ABORD : si la carte mesuree n est pas la plus courte, tout ce
    // qui suit ne prouve rien.
    verdicts.push({
      ok: /\bdens-xs\b/.test(c.classes) && v.longue && c.carte.h < v.longue.carte.h,
      label: `[A ${largeur}] MONTAGE : la carte mesuree est bien la plus courte (dens-xs)`,
      detail: `${Math.round(c.carte.h)}px contre ${v.longue ? Math.round(v.longue.carte.h) : '?'}px pour la carte de 2 h, piste ${c.piste ? Math.round(c.piste * 10) / 10 : '?'}px`,
    });
    verdicts.push({
      ok: Boolean(c.bulle) && c.bulle.w > 0 && c.bulle.h > 0,
      label: `[A ${largeur}] la bulle de note a une taille NON NULLE sur cette carte`,
      detail: c.bulle ? `${Math.round(c.bulle.w)}x${Math.round(c.bulle.h)}` : 'aucune bulle rendue (0x0 : le defaut d origine)',
    });
    // « Sans que le contenu deborde de la carte » : la bulle tient DANS le
    // rectangle de la carte, et la carte ne cache rien qu elle ne montre.
    const dedans = Boolean(c.bulle)
      && c.bulle.top >= c.carte.top - 1 && c.bulle.bottom <= c.carte.bottom + 1
      && c.bulle.left >= c.carte.left - 1 && c.bulle.right <= c.carte.right + 1;
    verdicts.push({
      ok: dedans,
      label: `[A ${largeur}] et elle tient DANS le rectangle de la carte`,
      detail: c.bulle ? `bulle ${Math.round(c.bulle.left)}..${Math.round(c.bulle.right)} x ${Math.round(c.bulle.top)}..${Math.round(c.bulle.bottom)}, carte ${Math.round(c.carte.left)}..${Math.round(c.carte.right)} x ${Math.round(c.carte.top)}..${Math.round(c.carte.bottom)}` : 'aucune bulle',
    });
    verdicts.push({
      ok: c.debordH <= 1 && c.debordW <= 1,
      label: `[A ${largeur}] le contenu de la carte ne deborde pas`,
      detail: `debordement ${c.debordH}px en hauteur, ${c.debordW}px en largeur`,
    });
  }
  return verdicts;
}

// ===========================================================================
// [B] L ALERTE APPARTIENT A SON ECRAN, ET LE RETOUR FORCE S EXPLIQUE
// ===========================================================================
async function ouvrirTunnel(page) {
  await page.goto(`${BASE_URL}/?v=p1b-${Date.now()}-${Math.random().toString(36).slice(2)}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.goStep2 === 'function' && typeof window.goStep === 'function', null, { timeout: 20000 });
}

// L etat visible de la boite d alerte : ce que le client LIT, pas ce que le DOM
// contient. Une boite pleine mais a hauteur nulle ou transparente ne dit rien.
const LIRE_ALERTE = () => {
  const el = document.getElementById('alertBox');
  if (!el) return { present: false, texte: '', hauteur: 0, opacite: 0 };
  const boite = el.querySelector('.alert');
  const r = boite ? boite.getBoundingClientRect() : null;
  return {
    present: Boolean(boite),
    texte: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    hauteur: r ? Math.round(r.height) : 0,
    largeur: r ? Math.round(r.width) : 0,
    opacite: boite ? Number(getComputedStyle(boite).opacity) : 0,
    longueurHtml: el.innerHTML.length,
  };
};

async function mesurerB(browser) {
  const out = {};
  // --- Face avant : l alerte de l ecran qu on quitte s en va avec lui -------
  {
    const { page, fermer } = await pageNeuve(browser, { width: 1440, height: 900 });
    try {
      await ouvrirTunnel(page);
      // LE REFUS EST REEL, ET IL TOMBE A L ETAPE 1. Une date deja passee est le
      // premier verdict de goStep2 : le client reste sur son ecran et lit
      // pourquoi. (Un pax invalide, lui, est verifie APRES l ecran de reglages,
      // qui s intercale : il n aurait pas leve d alerte au premier clic.)
      await page.evaluate((date) => {
        state.view = 'client';
        state.booking.date = '2020-01-04';    // un samedi, mais en 2020
        state.booking.mode = 'carte';
        state.booking.type = 'bowling';
        state.booking.duration = 1;
        state.booking.pax = 8;
        state.__dateFuture = date;
        setView('client');
        if (typeof goStep === 'function') goStep(1, { animate: false });
      }, DATE_TUNNEL);
      await page.waitForTimeout(300);
      await page.evaluate(() => window.goStep2());
      await page.waitForTimeout(500);
      out.refus = await page.evaluate(LIRE_ALERTE);
      out.etapeApresRefus = await page.evaluate(() => Number(state.step));
      // Le client corrige et avance de son plein gre. Le bouton de l etape 1
      // peut demander DEUX clics (« Continuer » vers l ecran de reglages, puis
      // « Verifier les disponibilites ») : on le suit jusqu a l etape 2, comme
      // un client le ferait, au lieu de supposer un seul geste.
      await page.evaluate(() => { state.booking.date = state.__dateFuture; });
      for (let essai = 0; essai < 3; essai += 1) {
        if (await page.evaluate(() => Number(state.step)) === 2) break;
        await page.evaluate(() => window.goStep2());
        await page.waitForTimeout(700);
      }
      out.apresAvance = await page.evaluate(LIRE_ALERTE);
      out.etapeApresAvance = await page.evaluate(() => Number(state.step));
    } finally {
      await fermer();
    }
  }
  // --- Face arriere : le retour force porte son explication ----------------
  {
    const { page, fermer } = await pageNeuve(browser, { width: 1440, height: 900 });
    try {
      await ouvrirTunnel(page);
      out.retour = await page.evaluate(async (date) => {
        state.view = 'client';
        Object.assign(state.booking, {
          date, mode: 'carte', type: 'bowling', pax: 8,
          // 23:30 + 2 h finit a 1 h 30 du matin : hors des horaires du samedi
          // (10h - minuit). Le refus est PHYSIQUE et ne depend d aucune horloge.
          startTime: '23:30', duration: 2,
          name: 'Client QA', phone: '+32470860001', email: 'qa@x.test',
          allocatedLanes: [1],
        });
        setView('client');
        goStep(4, { animate: false });
        return { etapeAvant: Number(state.step) };
      }, DATE_TUNNEL);
      await page.waitForTimeout(400);
      await page.evaluate(() => window.confirmBooking());
      // On laisse TOUT se poser : goStep(2) enchaine sur fetchSlots, qui
      // re-rend l ecran des horaires. Un message qui survit a showAlert mais pas
      // au re-rendu qui suit ne serait pas lu davantage.
      await page.waitForTimeout(1600);
      out.apresRetour = await page.evaluate(LIRE_ALERTE);
      out.etapeApresRetour = await page.evaluate(() => Number(state.step));
    } finally {
      await fermer();
    }
  }
  return out;
}

function jugerB(m) {
  const verdicts = [];
  verdicts.push({
    ok: Boolean(m.refus) && m.refus.present && m.refus.hauteur > 0 && m.etapeApresRefus === 1 && /pass/i.test(m.refus.texte),
    label: '[B] MONTAGE : un refus REEL a l etape 1 leve bien une alerte lisible',
    detail: m.refus ? `« ${m.refus.texte} » ${m.refus.hauteur}px, etape ${m.etapeApresRefus}` : 'aucune mesure',
  });
  verdicts.push({
    ok: Boolean(m.apresAvance) && m.etapeApresAvance === 2 && !m.apresAvance.present && m.apresAvance.longueurHtml === 0,
    label: '[B] le client avance de son plein gre : l alerte de l ecran quitte a DISPARU',
    detail: m.apresAvance ? `etape ${m.etapeApresAvance}, boite ${m.apresAvance.longueurHtml} caractere(s), « ${m.apresAvance.texte} »` : 'aucune mesure',
  });
  verdicts.push({
    ok: m.etapeApresRetour === 2,
    label: '[B] MONTAGE : un creneau hors horaires RENVOIE bien le client a l etape 2',
    detail: `etape ${m.retour ? m.retour.etapeAvant : '?'} -> ${m.etapeApresRetour}`,
  });
  const a = m.apresRetour;
  verdicts.push({
    ok: Boolean(a) && a.present && a.hauteur > 0 && a.largeur > 0 && a.opacite > 0.9 && /horaire/i.test(a.texte),
    label: '[B] et le message qui dit POURQUOI est LISIBLE a l arrivee',
    detail: a ? `« ${a.texte} » ${a.largeur}x${a.hauteur}px, opacite ${a.opacite}` : 'aucune mesure',
  });
  return verdicts;
}

// ===========================================================================
// [C] « A VENIR » NE DEBORDE PAS ET NE RETROGRADE PAS
// ===========================================================================
const JEU_STATUTS = [
  { id: 81001, lane: 1, start: '11:00', duration: 1, status: 'pending' },
  { id: 81002, lane: 2, start: '12:00', duration: 1, status: 'confirmed' },
  { id: 81003, lane: 3, start: '13:00', duration: 1, status: 'confirmed' },
  { id: 81004, lane: 4, start: '14:00', duration: 1, status: 'arrived' },
  { id: 81005, lane: 5, start: '15:00', duration: 1, status: 'paid' },
];
const CONFIRME_TEMOIN = 81002;

async function mesurerC(browser) {
  const { page, fermer } = await pageNeuve(browser, { width: 1440, height: 900 });
  try {
    await installMockStaff(page, JEU_STATUTS);
    await ouvrirStaff(page, 'planning', 'all');
    await page.waitForSelector('#resList .status-chip', { timeout: 20000 });
    await page.waitForTimeout(400);

    // 1. Le filtre « A venir », clique comme un humain.
    const cliqueAVenir = await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#resList .status-chip')]
        .find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith('À venir'));
      if (!chip) return false;
      chip.click();
      return true;
    });
    await page.waitForTimeout(350);
    const avenir = await page.evaluate(() => ({
      clique: true,
      ids: [...document.querySelectorAll('#resList .res-row[data-res-row-id]')].map((r) => Number(r.getAttribute('data-res-row-id'))),
    }));
    avenir.clique = cliqueAVenir;

    // 2. Le bouton deja enfonce ne fait pas retomber le dossier.
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#resList .status-chip')]
        .find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith('Tout'));
      if (chip) chip.click();
    });
    await page.waitForTimeout(350);
    const boutons = await page.evaluate((id) => {
      const ligne = document.querySelector(`#resList .res-row[data-res-row-id="${id}"]`);
      if (!ligne) return null;
      const btns = [...ligne.querySelectorAll('.res-status-btn')];
      return {
        libelles: btns.map((b) => b.textContent.trim()),
        confirmeActif: btns[0] ? btns[0].classList.contains('active') : null,
      };
    }, CONFIRME_TEMOIN);

    const avantClic = await page.evaluate((id) => {
      window.__PATCHES__ = [];
      return (state.reservations.find((r) => Number(r.id) === id) || {}).status;
    }, CONFIRME_TEMOIN);
    await page.evaluate((id) => {
      const ligne = document.querySelector(`#resList .res-row[data-res-row-id="${id}"]`);
      const btn = ligne && ligne.querySelector('.res-status-btn');
      if (btn) btn.click();
    }, CONFIRME_TEMOIN);
    await page.waitForTimeout(700);
    const apresConfirme = await page.evaluate((id) => ({
      statut: (state.reservations.find((r) => Number(r.id) === id) || {}).status,
      ecritures: (window.__PATCHES__ || []).length,
    }), CONFIRME_TEMOIN);

    // 3. TEMOIN : le meme chemin de clic, mais vers un etat DIFFERENT, doit
    //    ecrire. Sans lui, « zero ecriture » se lirait aussi bien comme « le
    //    clic n arrive nulle part » - et le gate serait vert sur un ecran mort.
    await page.evaluate((id) => {
      window.__PATCHES__ = [];
      const ligne = document.querySelector(`#resList .res-row[data-res-row-id="${id}"]`);
      const btns = ligne ? [...ligne.querySelectorAll('.res-status-btn')] : [];
      if (btns[1]) btns[1].click();
    }, CONFIRME_TEMOIN);
    await page.waitForTimeout(700);
    const apresArrive = await page.evaluate((id) => ({
      statut: (state.reservations.find((r) => Number(r.id) === id) || {}).status,
      ecritures: (window.__PATCHES__ || []).length,
    }), CONFIRME_TEMOIN);

    return { avenir, boutons, avantClic, apresConfirme, apresArrive };
  } finally {
    await fermer();
  }
}

function jugerC(m) {
  const verdicts = [];
  const statutDe = new Map(JEU_STATUTS.map((r) => [r.id, r.status]));
  const attendus = JEU_STATUTS.filter((r) => r.status === 'pending' || r.status === 'confirmed').map((r) => r.id);
  const rendus = (m.avenir && m.avenir.ids) || [];
  verdicts.push({
    ok: Boolean(m.avenir && m.avenir.clique) && attendus.every((id) => rendus.includes(id)),
    label: '[C] « À venir » rend les dossiers EN ATTENTE et les dossiers CONFIRMES',
    detail: `attendus ${attendus.join(', ')} · rendus ${rendus.join(', ') || 'aucun'}`,
  });
  const intrus = rendus.filter((id) => !['pending', 'confirmed'].includes(statutDe.get(id)));
  verdicts.push({
    ok: intrus.length === 0,
    label: '[C] et RIEN d autre : aucun arrive, aucun termine',
    detail: intrus.length ? intrus.map((id) => `${id} (${statutDe.get(id)})`).join(', ') : `${rendus.length} lignes, toutes a venir`,
  });
  verdicts.push({
    ok: Boolean(m.boutons) && m.boutons.confirmeActif === true && m.avantClic === 'confirmed',
    label: '[C] MONTAGE : sur un dossier CONFIRME, le bouton « Confirmé » est deja enfonce',
    detail: m.boutons ? `statut ${m.avantClic}, bouton actif ${m.boutons.confirmeActif}, boutons ${m.boutons.libelles.join(' / ')}` : 'ligne introuvable',
  });
  verdicts.push({
    ok: Boolean(m.apresConfirme) && m.apresConfirme.statut === 'confirmed' && m.apresConfirme.ecritures === 0,
    label: '[C] cliquer ce bouton deja enfonce n ecrit RIEN et ne retrograde pas le dossier',
    detail: m.apresConfirme ? `statut ${m.apresConfirme.statut}, ${m.apresConfirme.ecritures} ecriture(s) reseau` : 'aucune mesure',
  });
  verdicts.push({
    ok: Boolean(m.apresArrive) && m.apresArrive.statut === 'arrived' && m.apresArrive.ecritures >= 1,
    label: '[C] TEMOIN : le meme clic vers un AUTRE etat ecrit bien (l ecran n est pas mort)',
    detail: m.apresArrive ? `statut ${m.apresArrive.statut}, ${m.apresArrive.ecritures} ecriture(s) reseau` : 'aucune mesure',
  });
  return verdicts;
}

// ===========================================================================
// [D] UN SEUL FORMAT DE MONTANT PAR ECRAN (Direction)
// ===========================================================================
// Le poste d observation Direction a deja son harnais complet dans
// scripts/direction-cockpit-check.js : sa session mockee, ses fixtures
// deterministes et son amorcage. On le REUTILISE au lieu d en recopier 250
// lignes qui divergeraient au premier changement de fixture - meme motif que
// promo-shots-hd.js avec run-visual-qa.js. Le decoupage est volontairement
// naif : il echoue bruyamment si la fonction change de forme, ce qui est
// exactement ce qu on veut d une dependance entre gates.
function chargerDepuisGate(fichier, noms, portee) {
  const src = fs.readFileSync(path.join(ROOT, fichier), 'utf8');
  const morceaux = noms.map((nom) => {
    let debut = src.indexOf(`async function ${nom}(`);
    if (debut === -1) debut = src.indexOf(`function ${nom}(`);
    if (debut === -1) throw new Error(`${nom} introuvable dans ${fichier}`);
    const fin = /\r?\n\}\r?\n/.exec(src.slice(debut));
    if (!fin) throw new Error(`fin de ${nom} introuvable dans ${fichier}`);
    return src.slice(debut, debut + fin.index + fin[0].length);
  });
  const cles = Object.keys(portee);
  // eslint-disable-next-line no-new-func
  return new Function(...cles, `${morceaux.join('\n')}\nreturn { ${noms.join(', ')} };`)(...cles.map((k) => portee[k]));
}

const DATERANGE_REAL_PATH = path.join(ROOT, 'assets', 'pinlane-daterange.js');
const gateDirection = chargerDepuisGate('scripts/direction-cockpit-check.js', ['installMock', 'bootDirection'], {
  BASE_URL,
  DATERANGE_REAL_EXISTS: fs.existsSync(DATERANGE_REAL_PATH),
  DATERANGE_REAL_PATH,
  // Le cadrage des vues (hauteurs de graphes standardisees) ne joue aucun role
  // dans l ecriture d un montant : on n injecte rien de fonctionnel, juste de
  // quoi satisfaire l appel a addStyleTag, et on le dit.
  GATE_DIR_SIZING_CSS: '/* polish-p1-check : aucun cadrage injecte, ce gate ne mesure pas les hauteurs de graphe */',
});

async function mesurerD(browser) {
  const { page, fermer } = await pageNeuve(browser, { width: 1400, height: 950 });
  try {
    await gateDirection.bootDirection(page);
    await page.waitForTimeout(900);
    return page.evaluate(() => {
      // Le total SERVI par le mock : la reference vient de la donnee, jamais
      // d une chaine recopiee dans le gate.
      const cles = Object.keys(window.__DIR_SERVED__ || {});
      const registre = cles.length ? window.__DIR_SERVED__[cles[0]] : null;
      const total = registre ? registre.totals.revenue : null;
      const tuile = document.getElementById('dirKpiVal-revenue');
      // Tout montant VISIBLE de l ecran, avec l origine de son ecriture : la
      // valeur d une tuile KPI est posee par PinlaneCharts.countUp, tout le
      // reste passe par formatMoney.
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const montants = [];
      document.querySelectorAll('#adminContent *').forEach((el) => {
        if (el.children.length) return;                    // feuilles seulement
        if (!visible(el)) return;
        const txt = (el.textContent || '').trim();
        const m = /([0-9])(.?)\u20AC/.exec(txt);           // dernier chiffre, separateur, euro
        if (!m) return;
        montants.push({
          texte: txt.slice(0, 40),
          separateur: m[2],
          code: m[2] ? m[2].codePointAt(0) : 0,
          parCourbe: el.classList.contains('dir-kpi-value'),
        });
      });
      return {
        total,
        tuileTexte: tuile ? tuile.textContent : null,
        tuileCodes: tuile ? [...tuile.textContent].map((c) => c.codePointAt(0)) : null,
        formatMoneyTexte: total == null ? null : formatMoney(total),
        formatMoneyCodes: total == null ? null : [...formatMoney(total)].map((c) => c.codePointAt(0)),
        montants,
      };
    });
  } finally {
    await fermer();
  }
}

function jugerD(m) {
  const verdicts = [];
  const parCourbe = m.montants.filter((x) => x.parCourbe);
  const parFormatMoney = m.montants.filter((x) => !x.parCourbe);
  verdicts.push({
    ok: m.total != null && parCourbe.length > 0 && parFormatMoney.length > 0,
    label: '[D] MONTAGE : le meme ecran porte des montants ecrits par la bibliotheque ET par formatMoney',
    detail: `${parCourbe.length} par countUp, ${parFormatMoney.length} par formatMoney, total servi ${m.total}`,
  });
  const memeChaine = m.tuileTexte != null && m.formatMoneyTexte != null
    && JSON.stringify(m.tuileCodes) === JSON.stringify(m.formatMoneyCodes);
  verdicts.push({
    ok: memeChaine,
    label: '[D] la tuile KPI et formatMoney ecrivent le MEME montant, point de code par point de code',
    detail: `« ${m.tuileTexte} » [${(m.tuileCodes || []).map((c) => c.toString(16)).join(' ')}] vs « ${m.formatMoneyTexte} » [${(m.formatMoneyCodes || []).map((c) => c.toString(16)).join(' ')}]`,
  });
  const separateurs = [...new Set(m.montants.map((x) => x.code))];
  verdicts.push({
    ok: separateurs.length === 1 && separateurs[0] === NBSP_FINE.codePointAt(0),
    label: '[D] un SEUL separateur avant l euro sur tout l ecran, et c est l espace fine insecable',
    detail: `${m.montants.length} montants lus, separateur(s) U+${separateurs.map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join(' + U+')}`,
  });
  return verdicts;
}

// ===========================================================================
// [E] UN PANNEAU NE SE CONTREDIT PAS
// ===========================================================================
// Une journee qui porte les DEUX formes de signal : « Paiement a encaisser »
// (des dossiers attaches) et « Pistes en maintenance » (aucun dossier, par
// construction). Sans les deux, la regle ne serait testee que d un cote.
const JEU_ALERTES = [
  { id: 82001, lane: 1, start: '11:00', duration: 1, status: 'pending', price: 120 },
  { id: 82002, lane: 2, start: '12:00', duration: 1, status: 'arrived', price: 80 },
  { id: 82003, lane: 3, start: '13:00', duration: 1, status: 'paid', price: 60 },
];

async function mesurerE(browser) {
  const { page, fermer } = await pageNeuve(browser, { width: 1440, height: 900 });
  try {
    await installMockStaff(page, JEU_ALERTES, { lanesEnMaintenance: [7, 8] });
    await ouvrirStaff(page, 'dashboard', undefined, DATE_PASSEE);
    await page.waitForSelector('.dash-kpi', { timeout: 20000 });
    await page.waitForTimeout(500);
    const lire = async (kind) => {
      await page.evaluate((k) => {
        if (typeof closeStaffDashboardDetail === 'function') closeStaffDashboardDetail();
        openStaffDashboardDetail('alerts', k);
      }, kind);
      await page.waitForTimeout(400);
      return page.evaluate((k) => {
        const modale = document.querySelector('#staffDashboardDetailOverlay .dashboard-detail-modal');
        if (!modale) return null;
        const section = modale.querySelector(`.alert-section.alert-${k}`);
        return {
          titre: (modale.querySelector('#dashboardDetailTitle') || {}).textContent || '',
          sousTitre: ((modale.querySelector('.dashboard-detail-head p') || {}).textContent || '').trim(),
          sectionPresente: Boolean(section),
          dossiers: section ? section.querySelectorAll('.dashboard-detail-row').length : -1,
          compteAffiche: section ? ((section.querySelector('.alert-count') || {}).textContent || '').trim() : '',
        };
      }, kind);
    };
    const maintenance = await lire('maintenance');
    const paiement = await lire('payment');
    await page.evaluate(() => { if (typeof closeStaffDashboardDetail === 'function') closeStaffDashboardDetail(); });
    return { maintenance, paiement };
  } finally {
    await fermer();
  }
}

// « N reservation(s) concernee(s) » annonce un LOT DE DOSSIERS. On lit ce
// nombre, s il est annonce.
function dossiersAnnonces(sousTitre) {
  const m = /(\d+)\s+réservations?\s+concernées?/i.exec(sousTitre || '');
  return m ? Number(m[1]) : null;
}

function jugerE(m) {
  const verdicts = [];
  const mt = m.maintenance;
  const pm = m.paiement;
  verdicts.push({
    ok: Boolean(mt) && mt.sectionPresente && mt.dossiers === 0,
    label: '[E] MONTAGE : le signal « maintenance » est bien un signal SANS dossier attache',
    detail: mt ? `${mt.dossiers} dossier(s) rendu(s), compteur du signal « ${mt.compteAffiche} »` : 'modale introuvable',
  });
  const annonceMaintenance = dossiersAnnonces(mt && mt.sousTitre);
  verdicts.push({
    ok: Boolean(mt) && annonceMaintenance === null && !/aucune\s+réservation/i.test(mt.sousTitre),
    label: '[E] le sous-titre n annonce AUCUN compte de dossiers pour un signal qui n en porte pas',
    detail: mt ? `« ${mt.sousTitre} » sous le titre « ${mt.titre} »` : 'aucune mesure',
  });
  verdicts.push({
    ok: Boolean(mt) && /signal|signaux/i.test(mt.sousTitre),
    label: '[E] il retombe sur le langage des signaux, qui, lui, dit vrai',
    detail: mt ? `« ${mt.sousTitre} »` : 'aucune mesure',
  });
  const annoncePaiement = dossiersAnnonces(pm && pm.sousTitre);
  verdicts.push({
    ok: Boolean(pm) && pm.sectionPresente && pm.dossiers > 0 && annoncePaiement === pm.dossiers,
    label: '[E] et sur un signal qui EN porte, le compte annonce est celui des dossiers rendus',
    detail: pm ? `annonce ${annoncePaiement} · rendus ${pm.dossiers} · « ${pm.sousTitre} »` : 'aucune mesure',
  });
  return verdicts;
}

// ===========================================================================
// LES CINQ PROPRIETES, AVEC LA MUTATION QUI DOIT LES FAIRE ROUGIR
// ===========================================================================
// Chaque mutation ANNULE le correctif du lot a sa source, sur une copie SERVIE.
// Elle est ecrite pour reproduire le defaut d origine, pas pour casser au
// hasard : une mutation gratuite prouverait seulement que le gate reagit au
// bruit.
const PROPRIETES = [
  {
    cle: 'A',
    titre: 'LA BULLE DE NOTE EXISTE SUR LA CARTE LA PLUS COURTE',
    mesurer: mesurerA,
    juger: jugerA,
    mutation: {
      nom: 'le plancher des marqueurs repasse en `em` (l unite qui se resout sur .lane-col, pas sur la carte)',
      vise: /taille NON NULLE/,
      fichier: 'assets/pinlane-staff.css',
      de: '@container piste (max-width: 96px) {\n  .booking .bk-flags { display: none; }\n}',
      vers: '@container piste (max-width: 9.6em) {\n  .booking .bk-flags { display: none; }\n}',
    },
  },
  {
    cle: 'B',
    titre: 'UNE ALERTE APPARTIENT A SON ECRAN, ET UN RETOUR FORCE S EXPLIQUE',
    mesurer: mesurerB,
    juger: jugerB,
    mutation: {
      nom: 'goStep ne pose plus le message de l appelant apres le changement d etape',
      vise: /message qui dit POURQUOI/,
      fichier: 'assets/app-main.js',
      de: '  save();\n  // L etape d arrivee est en place : c est ici, et seulement ici, que le\n  // message de l appelant se pose. Un seul endroit, donc un seul ordre.\n  if (options.alert) showAlert(options.alert);\n}',
      vers: '  save();\n  // MUTATION DU GATE : le message est perdu, comme avant le correctif.\n}',
    },
  },
  {
    cle: 'C',
    titre: '« A VENIR » NE DEBORDE PAS ET NE RETROGRADE PAS',
    mesurer: mesurerC,
    juger: jugerC,
    mutation: {
      nom: 'l ecriture de statut redevient aveugle a l etat courant (un bouton deja enfonce ecrit quand meme)',
      vise: /n ecrit RIEN et ne retrograde pas/,
      fichier: 'assets/app-main.js',
      de: '  // Le dossier est deja dans l etat que le bouton demande : rien a ecrire.\n  if (reservationAlreadyInStatus(current, status)) return;',
      vers: '  // MUTATION DU GATE : plus aucune garde d idempotence.',
    },
  },
  {
    cle: 'D',
    titre: 'UN SEUL FORMAT DE MONTANT PAR ECRAN',
    mesurer: mesurerD,
    juger: jugerD,
    mutation: {
      nom: 'la bibliotheque de graphiques repasse a l espace ordinaire avant l euro',
      vise: /point de code par point de code/,
      fichier: 'assets/pinlane-charts.js',
      de: "if (format === 'euro') return groupInt(v) + NBSP_FINE + '\u20AC';",
      vers: "if (format === 'euro') return groupInt(v) + ' \u20AC';",
    },
  },
  {
    cle: 'E',
    titre: 'UN PANNEAU NE SE CONTREDIT PAS',
    mesurer: mesurerE,
    juger: jugerE,
    mutation: {
      nom: 'le sous-titre recompte les dossiers meme quand le signal n en porte aucun',
      vise: /n annonce AUCUN compte de dossiers/,
      fichier: 'assets/app-main.js',
      de: '        if (concernes) return `${concernes} réservation${concernes > 1 ? \'s\' : \'\'} concernée${concernes > 1 ? \'s\' : \'\'}`;',
      vers: '        if (kind) return `${concernes} réservation${concernes > 1 ? \'s\' : \'\'} concernée${concernes > 1 ? \'s\' : \'\'}`;',
    },
  },
];

// Les fins de ligne du depot ne sont pas uniformes (app-main.js en CRLF,
// pinlane-charts.js en LF) : une ancre ecrite en LF ne se trouverait nulle part
// dans un fichier CRLF. On normalise la copie SERVIE, jamais le disque.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
function sourceNormalisee(fichier) {
  return fs.readFileSync(path.join(ROOT, fichier), 'utf8').split(CRLF).join(LF);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const mesures = {};
  try {
    for (const propriete of PROPRIETES) {
      console.log(`\n[${propriete.cle}] ${propriete.titre}`);
      const m = await propriete.mesurer(browser);
      mesures[propriete.cle] = m;
      propriete.juger(m).forEach((v) => ok(v.ok, v.label, v.detail));
    }

    // =====================================================================
    console.log('\n[MUTATION] LE GATE SAIT-IL ROUGIR ? - une mutation par propriete');
    // =====================================================================
    // Ce qui est asserte ici, ce n est pas que la mutation casse quelque chose :
    // c est que LA MESURE DE CETTE PROPRIETE-LA tombe. Une mutation qui ferait
    // rougir une autre propriete ne prouverait rien sur celle-ci.
    for (const propriete of PROPRIETES) {
      const mut = propriete.mutation;
      const source = sourceNormalisee(mut.fichier);
      if (!ok(source.includes(mut.de),
        `[mutation ${propriete.cle}] l ancre de « ${mut.nom} » existe dans le source livre`,
        source.includes(mut.de) ? `${mut.fichier}` : `ANCRE INTROUVABLE dans ${mut.fichier} : la contre-epreuve est DESARMEE, elle ne protege plus rien`)) continue;
      const occurrences = source.split(mut.de).length - 1;
      if (!ok(occurrences === 1, `[mutation ${propriete.cle}] et elle est UNIQUE dans le fichier`, `${occurrences} occurrence(s)`)) continue;

      overrides.set(mut.fichier, source.replace(mut.de, mut.vers));
      let verdictsMutes = [];
      enMutation = true;
      try {
        verdictsMutes = propriete.juger(await propriete.mesurer(browser));
      } catch (error) {
        // Une mesure qui ne peut meme plus tourner EST un rouge : on le dit au
        // lieu de laisser l exception tuer le gate.
        verdictsMutes = [{ ok: false, label: 'la mesure ne tourne plus', detail: String(error.message).split('\n')[0] }];
      } finally {
        enMutation = false;
        overrides.delete(mut.fichier);
      }
      const tombes = verdictsMutes.filter((v) => !v.ok);
      // « Au moins un verdict tombe » ne suffirait pas : une mutation peut faire
      // tomber un MONTAGE et laisser la propriete elle-meme intacte. On exige
      // donc que ce soit LA phrase de la propriete qui tombe.
      const vises = tombes.filter((v) => mut.vise.test(v.label));
      ok(vises.length > 0,
        `[mutation ${propriete.cle}] « ${mut.nom} » fait bien tomber la propriete [${propriete.cle}] elle-meme`,
        vises.length
          ? `${vises.length} verdict(s) vise(s) sur ${tombes.length} tombe(s) : ${vises.map((v) => v.label).join(' · ')}`
          : `LA SONDE EST AVEUGLE sur ce point : ${tombes.length} verdict(s) tombe(s), aucun ne vise la propriete`);
    }

    // Le depot n a jamais ete touche : la contre-epreuve vit en memoire. On le
    // VERIFIE quand meme, parce qu une mutation laissee en place est le genre
    // de degat qu on ne voit qu au commit suivant.
    ok(overrides.size === 0, '[mutation] aucune mutation ne survit a la contre-epreuve', `${overrides.size} override(s) encore en place`);
    for (const propriete of PROPRIETES) {
      const mut = propriete.mutation;
      ok(sourceNormalisee(mut.fichier).includes(mut.de),
        `[mutation ${propriete.cle}] et le fichier ${mut.fichier} sur le disque est intact`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures ? `${failures} assertion(s) en echec` : 'Tous les controles passent'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
