// « TOUTES LES RESERVATIONS » DIT LA VERITE, A L HEURE, SUR CHAQUE ECRAN.
//
// Movsar, 2026-10-07 au soir : « il a pas mal de bugs, des « à venir » qui
// restent en « confirmé » et inversement, et des bugs graphiques ». Puis le
// 2026-10-08 : « répare tous les bugs, rends les cartes juste un peu plus
// petites, plus simple, plus visible ». L etat des lieux (relu contre le code
// le 2026-10-08) a trouve douze causes. Ce gate les rejoue une par une, dans
// le vrai navigateur, sur la journee du gate caisse-cartes (douze dossiers
// passes par le vrai moteur, samedi 3 octobre 2026) :
//
//   [A] une activite cochee prouve la presence : un groupe jamais pointe
//       « Arrivé » mais qui a joue est « Sur place », pas « En retard », et
//       sa carte propose d encaisser, plus « Arrivé »
//   [B] « Pas venu » (0056) sort le groupe du retard : section « Pas venus »,
//       sa puce, et le mot de sa fiche
//   [C] la fiche dit le mot de la liste (« En retard », « À clôturer »...),
//       plus le statut enregistre (« Confirmé », « Arrivé »)
//   [D] les puces sont les sections : chaque puce annonce le nombre de cartes
//       de sa section, et elles se totalisent a « Tout »
//   [E] le poll redessine ce qui a change : une coche d activite venue d un
//       autre poste (la signature de rendu l ignorait), et la fiche ouverte
//       (elle n etait jamais redessinee par le poll)
//   [F] le tic tombe a la minute pile : le groupe de 15:00 passe « En
//       retard » a 15:05, pas jusqu a une minute plus tard
//   [G] le reveil de la tablette redessine tout de suite (le poll du reveil
//       repond 304 et ne redessinait rien)
//   [H] une ecriture locale qui masque la valeur d un autre poste ne fige plus
//       la journee : passee la garde, la lecture suivante redemande tout
//   [I] une lecture qui ne repond pas est abandonnee : la journee n attend
//       plus en file sans fin
//   [J] le mode secours du serveur (base indisponible, 200 sans dossiers)
//       n efface plus la journee et ne ferme plus la fiche ; la liste dit
//       « Reconnexion… », puis se tait au retour
//   [K] un rendu qui plante ne laisse plus la journee a moitie dessinee : la
//       lecture suivante redessine
//   [L] le jour avance tout seul a 5 h, si l equipe regardait la veille
//   [M] la boite de la liste remplit l ecran : sous le planning global (vue
//       « Toutes », tablette et telephone), on y arrive en faisant defiler la
//       page, puis elle defile en elle-meme ; les encadres tiennent sur une
//       ligne, et au telephone l aide d une activite remonte a cote du nom
//   [N] « Arrivé » sur un groupe deja pointe par un autre poste le dit
//   [O] les cartes des gens reliees aux plannings (2026-10-09) : le lisere a
//       la couleur de l etat (bleu confirme, ambre arrive, vert paye, rouge
//       en retard) dans les deux themes, une seule grille (l heure en tete de
//       sa rangee), des encadres d une ligne sans fond dont le texte coupe se
//       lit au survol, des etapes resserrees, le prix ajuste en ambre, des
//       boutons qui gardent 44 px
//
// CONTRE-EPREUVE (--contre-preuves) : chaque correction est defaite EN
// MEMOIRE dans le fichier servi, et le gate doit rougir sur sa lettre. Le
// disque n est jamais ecrit.
//
// Lancement : node scripts/liste-statuts-check.js [--contre-preuves]
'use strict';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LISTE_PORT || 4337);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JOUR = '2026-10-03';
const CONTRE = process.argv.includes('--contre-preuves');
// Le moteur garde ses plans du jour : il doit voir la journee jouee.
const NativeDate = Date;
const FIXTURE_NOW = NativeDate.parse(`${JOUR}T08:00:00+02:00`);
global.Date = class FixtureDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [FIXTURE_NOW])); }
  static now() { return FIXTURE_NOW; }
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;
const lireLF = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CRLF).join(LF);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// LA JOURNEE, PASSEE PAR LE VRAI MOTEUR (celle de caisse-cartes-check).
// A 15:10 : Martin (14:30) et Nguyen (15:00) en retard, Dupont sur place,
// Léa, FC Bertrix et l Hôtel des Ardennes a cloturer, Peeters paye.
// ---------------------------------------------------------------------------
async function journee() {
  const { prepareReservationOps } = require(path.join(ROOT, 'lib', 'reservation-ops'));
  const V = (items, times, laser) => ({ type: 'visite', program: items, preference: { preferredTimes: times, laserGameTimes: laser || [], laserPlacement: 'scheduled' } });
  const SPECS = [
    { id: 81001, name: 'Famille Peeters', pax: 6, startTime: '11:00', ...V([{ activityId: 'bowling', duration: 1 }], { bowling: '11:00' }), status: 'paid', paymentMethod: 'Espèces' },
    { id: 81002, name: 'Anniversaire de Léa', pax: 10, companions: 2, startTime: '12:00', type: 'formule', formuleId: 'f7', occasion: 'anniversaire', status: 'arrived', notes: 'Gâteau apporté par les parents, à sortir vers 14h.', prix: 240 },
    { id: 81003, name: 'FC Bertrix U15', pax: 24, startTime: '13:00', ...V([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }], { bowling: '13:00', laser_game: '14:30' }, ['14:30']), status: 'arrived' },
    { id: 81004, name: 'Dupont', pax: 10, startTime: '14:00', ...V([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }], { bowling: '14:00', laser_game: '15:00' }, ['15:00', '16:00']), status: 'arrived' },
    { id: 81005, name: 'Hôtel des Ardennes', pax: 4, startTime: '13:30', ...V([{ activityId: 'minigolf_blacklight' }, { activityId: 'arcade_time' }], {}), status: 'arrived' },
    { id: 81006, name: 'Martin', pax: 4, startTime: '14:30', ...V([{ activityId: 'bowling', duration: 1 }], { bowling: '14:30' }), status: 'confirmed' },
    { id: 81007, name: 'Nguyen', pax: 6, startTime: '15:00', ...V([{ activityId: 'laser_game', games: 1 }], { laser_game: '15:00' }, ['15:00']), status: 'confirmed' },
    { id: 81008, name: 'Lambda SA', pax: 30, startTime: '15:30', ...V([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }], { bowling: '15:30', laser_game: '17:00' }, ['17:00']), status: 'pending', validationStatus: 'staff_review', customPrice: 280, notes: 'Facture au nom de Lambda SA. Prix négocié par Seb.' },
    { id: 81009, name: 'Anniversaire de Noah', pax: 8, companions: 2, startTime: '16:00', type: 'formule', formuleId: 'f4', occasion: 'anniversaire', status: 'confirmed', notes: 'Allergie arachides (Noah).', prix: 312 },
    { id: 81010, name: 'Famille Janssens', pax: 5, startTime: '17:00', ...V([{ activityId: 'bowling', duration: 1.5 }, { activityId: 'minigolf_blacklight' }], { bowling: '17:00' }), status: 'confirmed' },
    { id: 81011, name: 'EVJF de Sarah', pax: 12, startTime: '18:00', ...V([{ activityId: 'laser_game', games: 2 }, { activityId: 'bowling', duration: 1 }], { laser_game: '18:00', bowling: '19:00' }, ['18:00', '20:30']), status: 'confirmed' },
    { id: 81012, name: 'Scouts de Neufchâteau', pax: 40, startTime: '19:30', ...V([{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 1 }], { bowling: '19:30', laser_game: '21:00' }, ['21:00']), status: 'confirmed' },
  ];
  const jour = [];
  for (const spec of SPECS) {
    const { id, status, paymentMethod, customPrice, notes, validationStatus, occasion, companions, prix, ...corps } = spec;
    const body = { centerId: 'libramont', date: JOUR, phone: `+32 470 ${String(id).slice(-3)} 21 45`, email: `qa${id}@exemple.be`, ...corps };
    const r = await prepareReservationOps(body, 'staff', { readState: async () => ({ reservations: jour, laneStatuses: {} }) });
    const plan = r.opsPlan || null;
    const base = Number(r.basePrice || r.price || 0) || prix || 0;
    jour.push({
      id, name: spec.name, phone: body.phone, email: body.email, date: JOUR,
      startTime: (plan && plan.startTime) || spec.startTime,
      duration: Number(r.duration || 1), totalDuration: Number(r.totalDuration || r.duration || 1),
      lanes: (plan && plan.assignedLanes) || [], pax: spec.pax, status,
      basePrice: base, price: customPrice || Number(r.price || 0) || base,
      type: r.type || corps.type, formuleId: corps.formuleId || '', label: r.label || '',
      occasion: occasion || '', companions: companions || 0, extras: [], paymentMethod: paymentMethod || '',
      notes: notes || '', activityProgress: {}, absentAt: null, amountPaid: null, program: r.program || null, channel: 'staff',
      centerId: 'libramont', opsPlan: plan, riskLevel: r.riskLevel || '', riskScore: r.riskScore ?? null,
      validationStatus: validationStatus || r.validationStatus || 'confirmed',
    });
  }
  return jour;
}
// Une journee de travail pour un scenario : la base, avec ses retouches.
const variante = (jour, retouches = {}) => jour.map((r) => (retouches[r.id] ? { ...r, ...retouches[r.id] } : { ...r }));

// ---------------------------------------------------------------------------
// LE SERVEUR (fichiers du depot, ou leur version defaite) ET LA PAGE.
// ---------------------------------------------------------------------------
const overrides = new Map();
function serveur() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(overrides.get(rel));
      return;
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

const APPAREILS = {
  ordi: { viewport: { width: 1440, height: 900 } },
  tablette: { viewport: { width: 800, height: 1280 } },
  telephone: { viewport: { width: 390, height: 844 } },
};

// horloge : 'fixe' (l heure ne bouge pas) ou 'installee' (on la fait avancer).
async function ouvrir(browser, jour, { instant = `${JOUR}T15:10:00+02:00`, horloge = 'fixe', appareil = 'ordi', date = JOUR } = {}) {
  const centre = { ...require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.find((c) => c.id === 'libramont'), status: 'active' };
  const activites = require(path.join(ROOT, 'ops-knowledge', 'activities.json')).activities;
  const ctx = await browser.newContext({ ...APPAREILS[appareil] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  // Un Date de la classe courante (FixtureDate, construit avec sa valeur) :
  // Playwright reconnait les dates a `instanceof Date`, et une NativeDate n en
  // est plus une une fois Date remplace pour le moteur.
  if (horloge === 'fixe') await page.clock.setFixedTime(new Date(instant));
  else await page.clock.install({ time: new Date(instant) });
  const expiresAt = new NativeDate(new NativeDate(instant).getTime() + 48 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, jour, centre, activites, JOUR }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view', 'payments.markPaid'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const memoire = JSON.parse(JSON.stringify(jour));
    window.__liste = { memoire, mode: 'normal', lectures: 0, ecritures: [] };
    const empreinte = (texte) => { let h = 0; for (let i = 0; i < texte.length; i += 1) h = (h * 31 + texte.charCodeAt(i)) | 0; return `qa-${(h >>> 0).toString(36)}`; };
    const J = (p, etag) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(etag ? { etag } : {}) } });
    const enTete = (init, nom) => {
      const h = init && init.headers;
      if (!h) return null;
      if (typeof h.get === 'function') return h.get(nom);
      const cle = Object.keys(h).find((k) => k.toLowerCase() === nom.toLowerCase());
      return cle ? h[cle] : null;
    };
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input?.url || '', window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') {
        window.__liste.lectures += 1;
        const d = u.searchParams.get('date');
        // UNE LECTURE PENDUE : elle ne rend jamais la main, sauf si on
        // l abandonne (le signal de la page).
        if (window.__liste.mode === 'pendu') {
          return new Promise((_, rejeter) => {
            if (init.signal) init.signal.addEventListener('abort', () => rejeter(new DOMException('Lecture abandonnée', 'AbortError')));
          });
        }
        // LE MODE SECOURS d api/staff-state.js : 200, sans dossiers, degraded.
        if (window.__liste.mode === 'degrade') {
          const rev = `degraded:libramont:${d}`;
          return J({ ok: true, degraded: true, storageUnavailable: true, storageMessage: 'Données temps réel temporairement indisponibles. Mode secours actif.', date: d, centerId: 'libramont', reservations: [], laneStatuses: [], revision: rev }, rev);
        }
        const corps = { ok: true, reservations: d === JOUR ? memoire : [], laneStatuses: { 1: 'active', 2: 'active', 3: 'active', 4: 'active', 5: 'active', 6: 'active', 7: 'active', 8: 'active' }, centerId: 'libramont' };
        const etag = empreinte(JSON.stringify(corps));
        // Un vrai serveur : meme contenu, meme etag, et 304 a qui l a deja.
        if (enTete(init, 'If-None-Match') === etag) return new Response(null, { status: 304, headers: { etag } });
        return J({ ...corps, revision: etag }, etag);
      }
      if (u.pathname === '/api/staff-reservations' && methode !== 'GET') {
        let corps = {}; try { corps = JSON.parse(init.body || '{}'); } catch (e) { /* corps vide */ }
        window.__liste.ecritures.push(corps);
        const r = memoire.find((x) => Number(x.id) === Number(corps.id));
        if (r) Object.assign(r, { status: corps.status || r.status, paymentMethod: corps.paymentMethod ?? r.paymentMethod, updatedAt: new Date().toISOString() });
        const rendu = r ? JSON.parse(JSON.stringify(r)) : null;
        // UN AUTRE POSTE DEFAIT L ECRITURE juste apres, avant toute lecture :
        // ce poste a sa reponse (« Arrivé »), le serveur dit « Confirmé ».
        if (r && window.__liste.defaitApres === r.id) { r.status = 'confirmed'; r.updatedAt = new Date().toISOString(); window.__liste.defaitApres = null; }
        return J({ ok: true, reservation: rendu });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: JOUR, durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        if (u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: [centre], activities: activites });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: memoire, emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname.startsWith('/api/')) return J({ ok: true });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, jour, centre, activites, JOUR });
  await page.goto(`${BASE}/?liste=${NativeDate.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000, polling: 100 });
  await page.evaluate((d) => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.currentDate = d;
    setView('staff');
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('planning');
    if (typeof setStaffResourceView === 'function') setStaffResourceView('all');
  }, date);
  if (date === JOUR) await page.waitForFunction((n) => document.querySelectorAll('#resList .gc[data-res-row-id]').length === n, jour.length, { timeout: 20000, polling: 100 }).catch(() => {});
  await attendre(250);
  return { ctx, page, erreurs };
}

// Ce que la liste montre : les puces (mot -> nombre) et les sections (cle ->
// cartes).
const lireListe = (page) => page.evaluate(() => {
  const puces = {};
  document.querySelectorAll('#resList .status-chip').forEach((c) => {
    const clone = c.cloneNode(true);
    const n = clone.querySelector('span');
    const nombre = n ? Number(n.textContent.trim()) : null;
    clone.querySelectorAll('span, svg').forEach((s) => s.remove());
    puces[clone.textContent.replace(/\s+/g, ' ').trim()] = nombre;
  });
  const sections = [...document.querySelectorAll('#resList .gc-section')].map((s) => ({
    cle: ['active', 'late', 'upcoming', 'onsite', 'closing', 'done', 'absent'].find((k) => s.classList.contains(k)) || '?',
    titre: ((s.querySelector('.res-section-head .label') || {}).textContent || '').trim(),
    annonce: Number(((s.querySelector('.res-section-head .count') || {}).textContent || '').trim()),
    ids: [...s.querySelectorAll('.gc[data-res-row-id]')].map((c) => Number(c.dataset.resRowId)),
  }));
  const moments = getStaffReservationMoments(state.reservations);
  const phases = Object.fromEntries(state.reservations.map(r => { const m = moments.get(String(r.id)); return [r.id, r.absentAt ? 'absent' : m?.late ? 'late' : m?.etat]; }));
  // Le mot que chaque carte AFFICHE (« En retard », « À venir »...).
  const mots = Object.fromEntries([...document.querySelectorAll('#resList .gc[data-res-row-id]')].map((c) => [Number(c.dataset.resRowId), ((c.querySelector('.gc-visit-state') || {}).textContent || '').trim()]));
  return { puces, sections, phases, mots };
});
const sectionDe = (liste, id) => liste.phases[id] || (liste.sections.find((s) => s.ids.includes(id)) || {}).cle || 'aucune';
const motDeFiche = (page, id) => page.evaluate((x) => {
  openPos(x);
  const t = ((document.querySelector('#posOverlay .dossier-status') || {}).textContent || '').trim();
  closePos();
  return t;
}, id);
const sync = (page) => page.evaluate((d) => syncDateReservations(d, { silent: true }), JOUR);

// ---------------------------------------------------------------------------
// LES SCENARIOS. Chacun rend sa liste de controles { cond, label, detail }.
// ---------------------------------------------------------------------------
const SCENARIOS = {
  // [A] [B] [C] [D] a 15:10 : Dupont a joue sans etre pointe, Nguyen « Pas venu ».
  async journeeJouee(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const jour = variante(base, {
      81004: { status: 'confirmed', activityProgress: { 'bowling-1': { done: true, at: `${JOUR}T14:55:00+02:00` } } },
      81007: { absentAt: `${JOUR}T15:08:00+02:00` },
    });
    const { ctx, page, erreurs } = await ouvrir(browser, jour);
    try {
      const liste = await lireListe(page);
      c(sectionDe(liste, 81006) === 'late', '[0] prerequis : a 15:10 Martin (14:30) est en retard', sectionDe(liste, 81006));
      // [A]
      c(sectionDe(liste, 81004) === 'onsite', '[A] Dupont, bowling coche sans « Arrivé », est « Sur place »', sectionDe(liste, 81004));
      const dupont = await page.evaluate(() => {
        const carte = document.querySelector('#resList .gc[data-res-row-id="81004"]');
        return carte ? { retard: Boolean(carte.querySelector('.gc-alert.is-late')), boutons: [...carte.querySelectorAll('.gc-actions button')].map((b) => b.textContent.trim()) } : null;
      });
      c(dupont && !dupont.retard, '[A] et sa carte ne crie plus au retard', JSON.stringify(dupont));
      c(dupont && !dupont.boutons.includes('Arrivé') && dupont.boutons.includes('Carte') && dupont.boutons.includes('Espèces'), '[A] son geste est d encaisser, plus « Arrivé »', dupont && dupont.boutons.join(' · '));
      // [B]
      c(sectionDe(liste, 81007) === 'absent', '[B] Nguyen, noté « Pas venu », est dans « Pas venus »', sectionDe(liste, 81007));
      c(liste.puces['Pas venus'] === 1, '[B] la puce « Pas venus » le compte', JSON.stringify(liste.puces));
      c(liste.puces['En retard'] === 1, '[B] et « En retard » ne compte plus que Martin', `${liste.puces['En retard']}`);
      // [C]
      const mots = {};
      for (const [id, attendu] of [[81006, 'En retard'], [81003, 'À clôturer'], [81001, 'Sur place'], [81008, 'À vérifier'], [81010, 'À venir'], [81004, 'Sur place'], [81007, 'Pas venu']]) {
        mots[id] = await motDeFiche(page, id);
        c(mots[id] === attendu, `[C] la fiche de ${id} dit « ${attendu} », le mot de la liste`, `« ${mots[id]} »`);
      }
      // [D]
      const motDeSection = { late: 'En retard', upcoming: 'À venir', onsite: 'Sur place', closing: 'À clôturer', done: 'Terminées', absent: 'Pas venus' };
      liste.sections.forEach((s) => {
        const compteAttendu = s.cle === 'active' ? jour.length - (liste.puces['Terminées'] || 0) - (liste.puces['Pas venus'] || 0) : liste.puces[motDeSection[s.cle]];
        c(compteAttendu === s.ids.length && s.annonce === s.ids.length, `[D] le bandeau « ${s.titre} » annonce ses cartes réelles`, `${compteAttendu} · bandeau ${s.annonce}`);
      });
      const somme = Object.entries(liste.puces).filter(([mot]) => !['Tout', 'Avec note'].includes(mot)).reduce((t, [, n]) => t + (n || 0), 0);
      c(somme === liste.puces.Tout && liste.puces.Tout === jour.length, '[D] les puces de section se totalisent a « Tout »', `${somme} pour ${liste.puces.Tout}`);
      const toutesCartes = liste.sections.flatMap((s) => s.ids);
      c(toutesCartes.length === new Set(toutesCartes).size && toutesCartes.length === jour.length, '[D] chaque dossier est dans une section, une seule', `${toutesCartes.length} cartes`);
      c(!('À gérer' in liste.puces) && !('Payées' in liste.puces), '[D] aucun filtre caisse qui masque les activités restantes', Object.keys(liste.puces).join(' · '));
      // Chaque puce, cliquee, ne rend que sa section.
      for (const [cle, mot] of Object.entries(motDeSection)) {
        if (!(mot in liste.puces)) continue;
        await page.evaluate((k) => setStaffStatusFilter(k === 'done' ? 'paid' : k), cle);
        const filtree = await lireListe(page);
        const ids = filtree.sections.flatMap((s) => s.ids).sort();
        const attendus = Object.entries(liste.phases).filter(([, phase]) => phase === cle).map(([id]) => Number(id)).sort();
        c(ids.join(',') === attendus.join(','), `[D] la puce « ${mot} » rend exactement sa section`, `${ids.length} pour ${attendus.length}`);
      }
      await page.evaluate(() => setStaffStatusFilter('all'));
      c(erreurs.length === 0, '[0] aucune erreur JS', erreurs.join(' | '));
    } finally { await ctx.close(); }
    return out;
  },

  // [E] le poll redessine la liste ET la fiche ouverte.
  async pollRedessine(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page, erreurs } = await ouvrir(browser, variante(base));
    try {
      await page.evaluate(() => openPos(81006));
      const avant = await page.evaluate(() => (document.querySelector('#posOverlay .dossier-status') || {}).textContent || '');
      c(avant.trim() === 'En retard', '[0] prerequis : la fiche ouverte de Martin dit « En retard »', avant);
      // Un autre poste pointe Martin arrive.
      await page.evaluate(() => { window.__liste.memoire.find((r) => r.id === 81006).status = 'arrived'; });
      await sync(page);
      const apres = await page.evaluate(() => ({
        ouverte: !document.getElementById('posOverlay').classList.contains('hidden'),
        mot: ((document.querySelector('#posOverlay .dossier-status') || {}).textContent || '').trim(),
      }));
      c(apres.ouverte && apres.mot === 'Sur place', '[E] la fiche ouverte suit le poll : « Sur place »', JSON.stringify(apres));
      await page.evaluate(() => closePos());
      // Une coche d activite, et rien d autre, venue d un autre poste.
      const fait = () => page.evaluate(() => Boolean(document.querySelector('#resList .gc[data-res-row-id="81004"] .gc-step.is-fait')));
      c(!(await fait()), '[0] prerequis : aucune activite de Dupont n est cochee');
      await page.evaluate(() => { window.__liste.memoire.find((r) => r.id === 81004).activityProgress = { 'laser_game-1': { done: true, at: '2026-10-03T15:09:00+02:00' } }; });
      await sync(page);
      c(await fait(), '[E] la coche d un autre poste se voit des la lecture, sans attendre le tic');
      c(erreurs.length === 0, '[0] aucune erreur JS', erreurs.join(' | '));
    } finally { await ctx.close(); }
    return out;
  },

  // [F] le tic a la minute pile.
  async ticMinute(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base), { instant: `${JOUR}T15:04:30+02:00`, horloge: 'installee' });
    try {
      const avant = await lireListe(page);
      c(sectionDe(avant, 81007) === 'upcoming' && avant.mots[81007] === 'À venir', '[0] prerequis : vers 15:04, Nguyen (15:00) est attendu, pas en retard', `${sectionDe(avant, 81007)} · carte « ${avant.mots[81007]} »`);
      await page.clock.runFor(31000);
      const apres = await lireListe(page);
      const heure = await page.evaluate(() => new Date().toTimeString().slice(0, 8));
      // CE QUE LA CARTE AFFICHE, pas l avis du modele (sectionDe le recalcule a
      // l heure de la lecture : depuis le 2026-10-10 il disait « en retard »
      // sans que la liste ait ete repeinte, et le gate ne voyait plus le tic).
      c(apres.mots[81007] === 'En retard', '[F] passe 15:05, il est « En retard » sans attendre une minute de plus', `${heure} · carte « ${apres.mots[81007]} »`);
    } finally { await ctx.close(); }
    return out;
  },

  // [G] le reveil.
  async reveil(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base), { instant: `${JOUR}T15:04:30+02:00`, horloge: 'installee' });
    try {
      await page.clock.pauseAt(new Date(`${JOUR}T15:04:45+02:00`));
      const avant = await lireListe(page);
      c(sectionDe(avant, 81007) === 'upcoming' && avant.mots[81007] === 'À venir', '[0] prerequis : a 15:04:45, Nguyen est attendu', `${sectionDe(avant, 81007)} · carte « ${avant.mots[81007]} »`);
      // La tablette dormait : l heure a avance sans qu aucun minuteur ne joue.
      await page.clock.setSystemTime(new Date(`${JOUR}T15:06:00+02:00`));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await attendre(300);
      const apres = await lireListe(page);
      c(apres.mots[81007] === 'En retard', '[G] au reveil, la liste se redessine tout de suite', `carte « ${apres.mots[81007]} »`);
    } finally { await ctx.close(); }
    return out;
  },

  // [H] la garde de 9 s ne fige plus la journee.
  async garde(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base), { horloge: 'installee' });
    try {
      // Ce poste pointe Martin ; un autre le remet « Confirmé » juste apres.
      const clique = await page.evaluate(() => {
        const carte = document.querySelector('#resList .gc[data-res-row-id="81006"]');
        const bouton = carte && [...carte.querySelectorAll('.gc-actions button')].find((b) => b.textContent.trim() === 'Arrivé');
        if (!bouton) return false;
        window.__liste.defaitApres = 81006;
        bouton.click();
        return true;
      });
      await page.waitForFunction(() => window.__liste.ecritures.length > 0 && !isReservationMutationInFlight(81006, 'status', 'arrived'), null, { timeout: 8000, polling: 50 }).catch(() => {});
      c(clique && (await page.evaluate(() => window.__liste.memoire.find((r) => r.id === 81006).status)) === 'confirmed', '[0] prerequis : « Arrivé » s est ecrit, puis un autre poste l a defait');
      await sync(page);
      c(sectionDe(await lireListe(page), 81006) === 'onsite', '[0] prerequis : pendant la garde, ce poste garde sa valeur (« Sur place »)');
      await page.clock.fastForward(10000);
      await sync(page);
      const section = sectionDe(await lireListe(page), 81006);
      c(section === 'late', '[H] passee la garde, la valeur de l autre poste revient (« En retard »)', section);
    } finally { await ctx.close(); }
    return out;
  },

  // [I] une lecture pendue est abandonnee.
  async lecturePendue(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base), { horloge: 'installee' });
    try {
      await page.evaluate((d) => {
        window.__liste.mode = 'pendu';
        window.__lectureFinie = false;
        syncDateReservations(d, { silent: true }).then(() => { window.__lectureFinie = true; });
      }, JOUR);
      c(await page.evaluate(() => remoteSyncBusy), '[0] prerequis : la lecture est en vol');
      // Deux delais : la lecture en vol est abandonnee, puis celle qui
      // attendait en file part a son tour, pendue elle aussi, et l est aussi.
      await page.clock.fastForward(16000);
      await page.evaluate(() => { window.__liste.mode = 'normal'; });
      await page.clock.fastForward(16000);
      let finie = false;
      for (let i = 0; i < 20 && !finie; i += 1) { finie = await page.evaluate(() => window.__lectureFinie && !remoteSyncBusy); if (!finie) await attendre(100); }
      c(finie, '[I] au-dela du delai, la lecture est abandonnee et la journee ne reste pas en file');
      await page.evaluate(() => { window.__liste.memoire.find((r) => r.id === 81006).status = 'arrived'; });
      // Une journee restee en file ne rendrait jamais la main : on borne.
      const passe = await Promise.race([sync(page).then(() => true), attendre(3000).then(() => false)]);
      c(passe && sectionDe(await lireListe(page), 81006) === 'onsite', '[I] et la lecture suivante passe', passe ? '' : 'la lecture suivante attend encore');
    } finally { await ctx.close(); }
    return out;
  },

  // [J] le mode secours du serveur.
  async modeSecours(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base));
    try {
      await page.evaluate(() => { openPos(81006); window.__liste.mode = 'degrade'; });
      await sync(page);
      await sync(page);
      const pendant = await page.evaluate(() => ({
        cartes: document.querySelectorAll('#resList .gc[data-res-row-id]').length,
        fiche: !document.getElementById('posOverlay').classList.contains('hidden'),
        signal: (() => { const s = document.getElementById('tableSyncState'); return s ? { vu: !s.hidden, texte: s.textContent.trim() } : null; })(),
      }));
      c(pendant.cartes === base.length, '[J] la base en panne n efface pas la journee', `${pendant.cartes} cartes`);
      c(pendant.fiche, '[J] et ne ferme pas la fiche ouverte');
      c(pendant.signal && pendant.signal.vu && /Reconnexion/.test(pendant.signal.texte), '[J] la liste dit qu elle se reconnecte', JSON.stringify(pendant.signal));
      await page.evaluate(() => { window.__liste.mode = 'normal'; });
      await sync(page);
      const apres = await page.evaluate(() => { const s = document.getElementById('tableSyncState'); return s ? s.hidden : null; });
      c(apres === true, '[J] et se tait des que le serveur repond', `${apres}`);
    } finally { await ctx.close(); }
    return out;
  },

  // [K] un rendu qui plante.
  async renduPlante(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base));
    try {
      await page.evaluate(() => {
        const vrai = renderStaffData;
        let fois = 0;
        renderStaffData = function () { fois += 1; if (fois === 1) throw new Error('rendu cassé exprès'); return vrai.apply(this, arguments); };
        window.__liste.memoire.find((r) => r.id === 81001).name = 'Famille Peeters-Lambert';
      });
      await sync(page);
      await sync(page);
      const nom = await page.evaluate(() => ((document.querySelector('#resList .gc[data-res-row-id="81001"] .res-row-name') || {}).textContent || '').trim());
      c(nom === 'Famille Peeters-Lambert', '[K] apres un rendu qui plante, la lecture suivante redessine', `« ${nom} »`);
    } finally { await ctx.close(); }
    return out;
  },

  // [L] le jour avance a 5 h.
  async jourSuivant(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const veille = await ouvrir(browser, variante(base), { instant: `${JOUR}T23:50:00+02:00`, horloge: 'installee' });
    try {
      await veille.page.clock.fastForward('40:00');
      const minuit = await veille.page.evaluate(() => state.currentDate);
      c(minuit === JOUR, '[L] a 0:30, la soiree d hier reste affichee', minuit);
      await veille.page.clock.fastForward('04:31:00');
      const matin = await veille.page.evaluate(() => state.currentDate);
      c(matin === '2026-10-04', '[L] a 5 h, la console passe au jour qui commence', matin);
    } finally { await veille.ctx.close(); }
    const ailleurs = await ouvrir(browser, variante(base), { instant: `${JOUR}T23:50:00+02:00`, horloge: 'installee', date: '2026-10-06' });
    try {
      await ailleurs.page.clock.fastForward('05:11:00');
      const vu = await ailleurs.page.evaluate(() => state.currentDate);
      c(vu === '2026-10-06', '[L] mais une autre date regardee expres ne bouge pas', vu);
    } finally { await ailleurs.ctx.close(); }
    return out;
  },

  // [M] l ecran : la boite jusqu en bas, les encadres sur une ligne, l aide
  // a cote du nom au telephone.
  async ecran(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const tablette = await ouvrir(browser, variante(base), { appareil: 'tablette' });
    try {
      const m = await tablette.page.evaluate(() => {
        const planning = document.getElementById('globalPlanningBox');
        const boite = document.getElementById('staffTableBox');
        boite.scrollIntoView({ block: 'start' });
        const box = boite.getBoundingClientRect();
        const encadres = [...document.querySelectorAll('#staffTableBox .gc-flag')].filter((f) => f.textContent.trim().length < 60).map((f) => Math.round(f.getBoundingClientRect().height));
        return { planning: Boolean(planning && !planning.classList.contains('hidden') && planning.getBoundingClientRect().height > 0), haut: Math.round(box.height), bas: Math.round(box.bottom + window.scrollY), ecran: innerHeight, page: document.scrollingElement.scrollHeight, encadres };
      });
      c(m.planning, '[M] tablette : la vue « Toutes » montre le planning global au-dessus de la liste');
      // La boite fait l ecran moins 12 px d air (ajusterHauteurListe, branche
      // « elle commence sous la moitie de l ecran ») ; sans cette regle elle
      // prend la hauteur de ses cartes et depasse l ecran.
      c(m.haut >= m.ecran - 72 && m.haut <= m.ecran, '[M] tablette : quand on y arrive, la liste remplit l ecran et defile en elle-meme', `${m.haut} pour ${m.ecran}`);
      // Sous la boite, il ne reste que la marge basse de la page (48 px).
      c(m.page - m.bas <= 72, '[M] tablette : rien sous la liste que la marge de la page', `page ${m.page}, bas de la liste ${m.bas}`);
      c(m.encadres.length > 0 && m.encadres.every((h) => h <= 34), '[M] un encadre court tient sur une ligne', m.encadres.join(', '));
    } finally { await tablette.ctx.close(); }
    const tel = await ouvrir(browser, variante(base), { appareil: 'telephone' });
    try {
      const m = await tel.page.evaluate(() => {
        const boite = document.getElementById('staffTableBox');
        boite.scrollIntoView({ block: 'start' });
        const box = boite.getBoundingClientRect();
        const etapes = [...document.querySelectorAll('#staffTableBox .gc-step')].filter((s) => (s.querySelector('.gc-step-state') || {}).textContent).map((s) => {
          const quoi = s.querySelector('.gc-step-what b').getBoundingClientRect();
          const aide = s.querySelector('.gc-step-state').getBoundingClientRect();
          return Math.round(aide.top - quoi.top);
        });
        return { haut: Math.round(box.height), ecran: innerHeight, etapes };
      });
      c(m.haut >= m.ecran - 30, '[M] telephone : la liste prend l ecran entier', `${m.haut} pour ${m.ecran}`);
      // Une liste cachee donne 0 - 0 = 0 < 16 : l ecart ne se lit que sur une
      // liste affichee (rouge de la suite du 2026-10-08, boite a 0 px).
      c(m.haut > 0 && m.etapes.length > 0 && m.etapes.every((d) => d < 16), '[M] telephone : l aide d une activite est sur la ligne de son nom', `${m.etapes.join(', ')} (liste ${m.haut} px)`);
    } finally { await tel.ctx.close(); }
    return out;
  },

  // [N] « Arrivé » deja fait par un autre poste.
  async dejaFait(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const { ctx, page } = await ouvrir(browser, variante(base));
    try {
      const dit = await page.evaluate(async () => {
        await setReservationStatusDirect(81003, 'arrived', { stopPropagation() {}, target: null });
        const t = document.getElementById('toast');
        return t && !t.classList.contains('hidden') ? t.textContent.trim() : '';
      });
      c(/déjà pointé arrivé/.test(dit), '[N] « Arrivé » sur un groupe deja pointe le dit', `« ${dit} »`);
      c((await page.evaluate(() => window.__liste.ecritures.length)) === 0, '[N] sans rien ecrire');
    } finally { await ctx.close(); }
    return out;
  },

  // [O] les cartes des gens reliees aux plannings (2026-10-09, maquettes « B »
  // et « C ») : le lisere a la couleur de l etat, une seule grille, des
  // encadres d une ligne sans fond, des etapes resserrees, le prix ajuste en
  // ambre, des boutons qui gardent 44 px.
  async cartes(browser, base) {
    const out = [];
    const c = (cond, label, detail = '') => out.push({ cond: Boolean(cond), label, detail });
    const mesurer = (page, theme) => page.evaluate(async (theme) => {
      state.staffTheme = theme;
      applyStaffTheme();
      document.querySelectorAll('#staffTableBox details.gc-section:not([open])').forEach((d) => { d.open = true; });
      // Le theme se fond en 150 ms : une couleur lue pendant le fondu ment.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.race([Promise.all(document.getAnimations().map((a) => a.finished)), new Promise((r) => setTimeout(r, 1500))]);
      // Toute couleur calculee passe par un pixel de canvas (rgb, oklab d une
      // transition, color(srgb) d un color-mix) ; celle d une ombre est en
      // tete de sa valeur calculee.
      const toile = document.createElement('canvas');
      toile.width = 1; toile.height = 1;
      const g = toile.getContext('2d', { willReadFrequently: true });
      const lire = (s) => {
        if (!s || !CSS.supports('color', s)) return null;
        g.clearRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1);
        const p = g.getImageData(0, 0, 1, 1).data;
        return { a: Number((p[3] / 255).toFixed(2)), hex: `#${[p[0], p[1], p[2]].map((x) => x.toString(16).padStart(2, '0')).join('')}` };
      };
      const boite = document.getElementById('staffTableBox');
      const sonde = (valeur) => { const e = document.createElement('i'); e.style.color = valeur; boite.appendChild(e); const v = lire(getComputedStyle(e).color); e.remove(); return v ? v.hex : ''; };
      const vu = (e) => e.getBoundingClientRect().width > 0;
      const cartes = [...boite.querySelectorAll('.res-row.gc[data-res-row-id]')].filter(vu).map((carte) => {
        const ombre = getComputedStyle(carte).boxShadow;
        const couleur = lire((ombre.match(/^[a-z-]+\([^)]*\)|^#[0-9a-f]+/i) || [])[0]);
        const r = carte.getBoundingClientRect();
        return {
          id: Number(carte.dataset.resRowId), etat: carte.dataset.etat || '', tard: carte.classList.contains('is-late'),
          barre: /inset/.test(ombre) && couleur && couleur.a > 0.99 ? couleur.hex : '',
          gauche: Math.round(r.left), largeur: Math.round(r.width), compacte: carte.classList.contains('is-done'),
        };
      });
      const encadres = [...boite.querySelectorAll('.gc-flag')].filter(vu).map((f) => {
        const texte = f.querySelector(':scope > span');
        return {
          ton: [...f.classList].find((x) => x.startsWith('tone-')) || '',
          haut: Math.round(f.getBoundingClientRect().height),
          fond: (lire(getComputedStyle(f).backgroundColor) || { a: 0 }).a,
          coupe: texte ? texte.scrollWidth > texte.clientWidth + 1 : false,
          title: f.getAttribute('title') || '',
          plein: texte ? texte.textContent.trim() : '',
          couleurTitre: (lire(getComputedStyle(f.querySelector('b')).color) || {}).hex || '',
        };
      });
      const etapes = [...boite.querySelectorAll('.gc-step')].filter(vu).map((s) => {
        const cs = getComputedStyle(s);
        const quoi = s.querySelector('.gc-step-what, .gc-libres');
        return { haut: Math.round(s.getBoundingClientRect().height), quoi: quoi ? Math.round(quoi.getBoundingClientRect().height) : 0, marge: Math.max(parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0) };
      });
      const boutons = [...boite.querySelectorAll('.gc-btn')].filter(vu).map((b) => Math.round(b.getBoundingClientRect().height));
      const heures = [...boite.querySelectorAll('.gc-hour-row')].filter(vu).map((h) => {
        const etiquette = h.querySelector('.gc-hour').getBoundingClientRect();
        const premiere = h.querySelector('.res-row.gc').getBoundingClientRect();
        return { basEtiquette: Math.round(etiquette.bottom), hautCarte: Math.round(premiere.top), gaucheCarte: Math.round(premiere.left) };
      });
      return { cartes, encadres, etapes, boutons, heures, danger: sonde('var(--danger)'), warning: sonde('var(--warning)') };
    }, theme);
    // L etat attendu de chaque dossier, d apres la journee servie.
    const statut = Object.fromEntries(base.map((r) => [Number(r.id), r.status]));
    const etatDe = (id) => ({ paid: 'paid', arrived: 'arr' }[statut[id]] || 'conf');
    const TEINTES = {
      light: { conf: '#0070f3', arr: '#f5a623', paid: '#22c55e' },
      dark: { conf: '#3291ff', arr: '#f5a623', paid: '#3dd68c' },
    };
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await ouvrir(browser, variante(base));
      try {
        const m = await mesurer(page, theme);
        const t = TEINTES[theme];
        // Le prerequis : chaque etat a au moins une carte a l ecran.
        const vus = new Set(m.cartes.map((x) => (x.tard ? 'retard' : x.etat)));
        c(['conf', 'arr', 'paid', 'retard'].every((k) => vus.has(k)), `[O] ${theme} : une carte de chaque etat a l ecran (confirme, arrive, paye, en retard)`, [...vus].join(','));
        const fausses = m.cartes.filter((x) => x.etat !== etatDe(x.id) || x.barre !== (x.tard ? m.danger : t[x.etat]));
        c(m.cartes.length > 0 && fausses.length === 0, `[O] ${theme} : le lisere de chaque carte a la couleur de son etat (rouge en retard)`,
          fausses.map((x) => `${x.id} ${x.etat}/${etatDe(x.id)}${x.tard ? ' retard' : ''} ${x.barre || 'sans lisere'}`).join(' | ') || `${m.cartes.length} cartes`);
        if (theme === 'light') {
          c(m.encadres.length > 0 && m.encadres.every((e) => e.fond === 0 && e.haut <= 24), '[O] un encadre tient sur une ligne, sans fond', m.encadres.map((e) => `${e.ton} ${e.haut}px fond ${e.fond}`).join(' | '));
          const coupes = m.encadres.filter((e) => e.coupe);
          c(coupes.length > 0 && coupes.every((e) => e.title.includes(e.plein)), '[O] un texte coupe au bord se lit en entier au survol (title)', coupes.map((e) => `${e.ton} « ${e.title.slice(0, 40)} »`).join(' | ') || 'aucun texte coupe');
          const prix = m.encadres.find((e) => e.ton === 'tone-price');
          c(prix && prix.couleurTitre === m.warning, '[O] le prix ajuste parle ambre, comme sur les plannings', prix ? `${prix.couleurTitre} pour ${m.warning}` : 'pas d encadre de prix');
          c(m.etapes.length > 0 && m.etapes.every((e) => e.marge <= 5), '[O] les etapes sont resserrees (5 px de marge, 8 avant)', [...new Set(m.etapes.map((e) => e.marge))].join(','));
          // Deux lignes (le nom, puis son detail) tiennent en 48 px ; une etape
          // plus longue l est par son contenu (l explication d une capacite).
          const deuxLignes = m.etapes.filter((e) => e.quoi > 0 && e.quoi <= 40);
          c(deuxLignes.length > 0 && deuxLignes.every((e) => e.haut <= 48), '[O] une etape de deux lignes tient en 48 px (57 avant)', deuxLignes.map((e) => e.haut).join(','));
          c(m.boutons.length > 0 && m.boutons.every((h) => h >= 44), '[O] les boutons gardent 44 px (le doigt)', m.boutons.join(','));
        }
      } finally { await ctx.close(); }
    }
    // Une seule grille : a 10:30, sept groupes a venir sur plusieurs heures,
    // la liste se range par heure.
    const matin = await ouvrir(browser, variante(base), { instant: `${JOUR}T10:30:00+02:00` });
    try {
      const m = await mesurer(matin.page, 'light');
      // Les cartes payees et les absents ont leur grille compacte (340 px) :
      // la grille commune est celle des cartes a servir.
      const servir = m.cartes.filter((x) => !x.compacte);
      const largeurs = servir.map((x) => x.largeur);
      const gauche = Math.min(...servir.map((x) => x.gauche));
      c(servir.length >= 7 && await matin.page.locator('#resList .gc-section.active').count() === 1, '[O] a 10:30 toutes les visites à suivre partagent une seule grille stable', `${servir.length} cartes`);
      c(largeurs.length > 0 && Math.max(...largeurs) - Math.min(...largeurs) <= 1, '[O] une seule grille : toutes les cartes a servir ont la meme largeur', [...new Set(largeurs)].join(','));
      const horaires = await matin.page.locator('#resList .gc-section.active .gc-when b').allTextContents();
      c(horaires.length === servir.length && horaires.every((h, i) => !i || h >= horaires[i - 1]), '[O] chaque carte affiche son heure en ordre chronologique', horaires.join(' · '));
      // La puce « À venir » range encore par heure (7 groupes sur au moins
      // deux heures) : dans la boite de la liste, l heure tient en tete de sa
      // rangee, au-dessus de ses cartes (depuis le 2026-10-10, la grille par
      // defaut n a plus de rangees, ce controle ne vivait plus que la).
      await matin.page.evaluate(() => setStaffStatusFilter('upcoming'));
      const f = await mesurer(matin.page, 'light');
      const gaucheF = Math.min(...f.cartes.filter((x) => !x.compacte).map((x) => x.gauche));
      c(f.heures.length >= 2 && f.heures.every((h) => h.basEtiquette <= h.hautCarte && h.gaucheCarte === gaucheF), '[O] « À venir » : l heure est en tete de sa rangee, ses cartes au meme bord gauche que les autres', JSON.stringify(f.heures.slice(0, 3)));
    } finally { await matin.ctx.close(); }
    return out;
  },
};

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : chaque correction defaite, le gate doit rougir sur sa
// lettre (et seulement en rejouant le scenario qui la prouve).
// ---------------------------------------------------------------------------
const JS = 'assets/app-main.js';
const CSS = 'assets/pinlane-staff.css';
const MUTATIONS = [
  { lettre: 'A', scenario: 'journeeJouee', fichier: JS, nom: 'une activite cochee ne prouve plus la presence',
    de: ' || item.start > board.now || groupeAJoue(item.reservation)) present.push(item);', vers: ' || item.start > board.now) present.push(item);' },
  { lettre: 'B', scenario: 'journeeJouee', fichier: JS, nom: '« Pas venu » ignore',
    de: "  if (reservation.absentAt && status !== 'paid') return 'absent';", vers: '' },
  { lettre: 'C', scenario: 'journeeJouee', fichier: JS, nom: 'la fiche relit le statut enregistre',
    de: "  if (reservation.status === 'cancelled') return { label: 'Annulé', className: 'cancelled' };\n  const moments = getStaffReservationMoments([reservation], reservation.date || state.currentDate);",
    vers: "  if (reservation.status === 'cancelled') return { label: 'Annulé', className: 'cancelled' };\n  if (reservation.status !== 'paid' && !isReservationAwaitingReview(reservation)) return reservation.status === 'arrived' ? { label: 'Arrivé', className: 'arrived' } : { label: 'Confirmé', className: 'pending' };\n  const moments = getStaffReservationMoments([reservation], reservation.date || state.currentDate);" },
  // (depuis le 2026-10-10, les visites a suivre partagent une section : [D]
  // ne voit plus ce recompte, [B] le voit, le retard y retombe « À venir »)
  { lettre: 'B', scenario: 'journeeJouee', fichier: JS, nom: 'les puces recomptent les moments (le retard compte « À venir »)',
    de: "  reservations.forEach(r => { counts[getStaffListeSection(moments, r)] += 1; });",
    vers: "  reservations.forEach(r => { const e = getStaffReservationMomentState(moments, r); counts[e === 'done' ? 'paid' : e] = (counts[e === 'done' ? 'paid' : e] || 0) + 1; });" },
  { lettre: 'E', scenario: 'pollRedessine', fichier: JS, nom: 'la signature de rendu oublie les coches',
    de: '    activityProgress: empreinteCoches(r.activityProgress),\n    absentAt: r.absentAt || \'\',\n    amountPaid: r.amountPaid ?? null,', vers: '    absentAt: r.absentAt || \'\',\n    amountPaid: r.amountPaid ?? null,' },
  { lettre: 'E', scenario: 'pollRedessine', fichier: JS, nom: 'le poll ne redessine plus la fiche ouverte',
    de: '      if (!opts.skipRender) repeindreFicheSiChangee();', vers: '' },
  { lettre: 'F', scenario: 'ticMinute', fichier: JS, nom: 'le tic repart de l heure de chargement',
    de: '  setTimeout(() => { tickStaffMinute(); planifierTicMinute(); }, 60000 - (Date.now() % 60000) + 250);', vers: '  setTimeout(() => { tickStaffMinute(); planifierTicMinute(); }, 60000);' },
  { lettre: 'G', scenario: 'reveil', fichier: JS, nom: 'le reveil ne joue plus le tic',
    de: "  if (document.visibilityState === 'visible') tickStaffMinute();", vers: '' },
  { lettre: 'H', scenario: 'garde', fichier: JS, nom: 'la revision masquee est retenue',
    de: "    staffRevisionByDate[revisionKey] = masque || !rendu ? `a-relire:${nextRevision}` : nextRevision;", vers: '    staffRevisionByDate[revisionKey] = nextRevision;' },
  { lettre: 'I', scenario: 'lecturePendue', fichier: JS, nom: 'la lecture n a plus de delai',
    de: '      signal: delaiLecture.signal\n', vers: '\n' },
  { lettre: 'J', scenario: 'modeSecours', fichier: JS, nom: 'le mode secours est pris pour une journee vide',
    de: '    if (payload.degraded) {', vers: '    if (false) {' },
  { lettre: 'J', scenario: 'modeSecours', fichier: JS, nom: 'la liste ne dit plus la panne',
    de: "  const liste = document.getElementById('tableSyncState');\n  if (liste) {", vers: "  const liste = null;\n  if (liste) {" },
  { lettre: 'K', scenario: 'renduPlante', fichier: JS, nom: 'un rendu qui plante n est pas rattrape',
    de: '        if (beforeData !== afterData || aMontrer) renderStaffData();', vers: '        if (beforeData !== afterData) renderStaffData();' },
  { lettre: 'L', scenario: 'jourSuivant', fichier: JS, nom: 'le jour ne suit plus',
    de: '  if (suivreLeJour()) return;\n', vers: '' },
  { lettre: 'M', scenario: 'ecran', fichier: CSS, nom: 'la boite replafonnee a 704 px (son plancher sous un planning part avec elle)',
    de: '.table-box#staffTableBox:not(.hidden):not(.expanded) { max-height: max(480px, calc(100dvh - var(--liste-haut, 280px) - 12px)); }\n/* Sous un planning (elle commence sous la moitie de l ecran), elle garde\n   cette hauteur meme quand ses cartes raccourcissent : la page ne remonte\n   pas sous le doigt (2026-10-12). */\n.table-box#staffTableBox.is-plein-ecran:not(.hidden):not(.expanded) { min-height: calc(100dvh - 12px); }', vers: '' },
  { lettre: 'M', scenario: 'ecran', fichier: CSS, nom: 'l encadre reprend deux lignes',
    de: '#staffTableBox .gc-flag { flex-direction: row; flex-wrap: nowrap; align-items: baseline; gap: 8px; min-width: 0; padding: 1px 0; border: 0; border-radius: 0; background: none; line-height: 1.4; }', vers: '' },
  { lettre: 'M', scenario: 'ecran', fichier: CSS, nom: 'l aide repasse sous le nom au telephone',
    de: '  #staffTableBox .gc-step-state { grid-column: 3; grid-row: 1; justify-self: end; align-self: start; }\n  #staffTableBox .gc-step.is-cochable .gc-step-state { grid-column: 4; grid-row: 1; }', vers: '' },
  { lettre: 'O', scenario: 'cartes', fichier: CSS, nom: 'le lisere disparait',
    de: '#staffTableBox .res-row.gc { box-shadow: inset 3px 0 0 var(--gc-barre, transparent); }', vers: '' },
  { lettre: 'O', scenario: 'cartes', fichier: JS, nom: 'la carte oublie son etat (tout en bleu)',
    de: '  const etat = lpTeinte(r).slice(3);', vers: '  const etat = \'conf\';' },
  { lettre: 'O', scenario: 'cartes', fichier: CSS, nom: 'l heure repasse a gauche de sa rangee',
    de: '#staffTableBox .gc-hour-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }', vers: '' },
  { lettre: 'O', scenario: 'cartes', fichier: CSS, nom: 'l encadre reprend son fond',
    de: '#staffTableBox .gc-flag { flex-direction: row; flex-wrap: nowrap; align-items: baseline; gap: 8px; min-width: 0; padding: 1px 0; border: 0; border-radius: 0; background: none; line-height: 1.4; }', vers: '#staffTableBox .gc-flag { flex-direction: row; flex-wrap: nowrap; align-items: baseline; gap: 8px; min-width: 0; padding: 1px 0; line-height: 1.4; }' },
  { lettre: 'O', scenario: 'cartes', fichier: JS, nom: 'le texte coupe perd son title',
    de: '${e.texte ? ` title="${escapeHtml(`${e.titre} : ${e.texte}`)}"` : \'\'}', vers: '' },
  { lettre: 'O', scenario: 'cartes', fichier: CSS, nom: 'les etapes reprennent leur marge',
    de: '#staffTableBox .gc-step { padding: 5px 6px; margin: 0 -6px; gap: 8px; }', vers: '' },
  { lettre: 'O', scenario: 'cartes', fichier: CSS, nom: 'le prix ajuste repasse au bleu',
    de: '.gc-flag.tone-price b { color: var(--warning); }', vers: '.gc-flag.tone-price b { color: var(--accent-strong); }' },
  { lettre: 'N', scenario: 'dejaFait', fichier: JS, nom: 'le clic deja fait se tait',
    de: "      toast({ arrived: 'Ce groupe est déjà pointé arrivé.', paid: 'Ce dossier est déjà payé.' }[status] || 'C’est déjà fait.');", vers: '' },
];

let echecs = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return cond;
}

async function main() {
  const base = await journee();
  // Le moteur a eu sa journee figee ; Playwright tourne dans ce processus et
  // lit l heure de Node pour ses horloges installees : on lui rend la vraie.
  global.Date = NativeDate;
  const server = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!CONTRE) {
      for (const [nom, scenario] of Object.entries(SCENARIOS)) {
        console.log(`\n-- ${nom}`);
        let controles = [];
        try { controles = await scenario(browser, base); } catch (e) { controles = [{ cond: false, label: `[0] le scenario ${nom} s est joue`, detail: e.message }]; }
        controles.forEach((x) => ok(x.cond, x.label, x.detail));
      }
    } else {
      const sources = { [JS]: lireLF(JS), [CSS]: lireLF(CSS) };
      for (const m of MUTATIONS) {
        const src = sources[m.fichier];
        const n = src.split(m.de).length - 1;
        if (!ok(n === 1, `[contre-preuve ${m.lettre}] l ancre de « ${m.nom} » existe une fois`, `trouvee ${n} fois : la contre-preuve est DESARMEE`)) continue;
        overrides.set(m.fichier, src.replace(m.de, m.vers));
        let controles = [];
        try { controles = await SCENARIOS[m.scenario](browser, base); } catch (e) { controles = [{ cond: false, label: `[${m.lettre}] scenario interrompu`, detail: e.message }]; }
        overrides.delete(m.fichier);
        const rouges = controles.filter((x) => !x.cond);
        const bonne = rouges.filter((x) => x.label.startsWith(`[${m.lettre}]`));
        ok(bonne.length > 0, `[contre-preuve ${m.lettre}] « ${m.nom} » fait rougir [${m.lettre}]`,
          rouges.length ? `rouges : ${rouges.map((x) => x.label).join(' | ')}` : 'LE GATE EST AVEUGLE : il ne protege rien');
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${echecs ? `${echecs} controle(s) en echec` : (CONTRE ? 'Toutes les contre-preuves mordent' : 'Tous les controles passent')}`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
