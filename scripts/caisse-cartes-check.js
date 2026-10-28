// LA LISTE DU PLANNING A COTE DE LA CAISSE : DES CARTES DE GROUPE.
//
// Movsar, 2026-10-01, captures de « Toutes les réservations » et de la fiche :
// « c est le truc qui sera affiche a cote de la caisse », « toutes les infos
// direct visibles », « les infos utiles sont en tout petit », « le truc en
// retard doit etre visible d office », « des encadres pour tout
// differencier », « aucune fausse info », « simplifie a mort ». Decisions du
// meme jour : une carte par groupe, le retard en tete apres un seuil reglable
// dans Etablissement (5 min), le prix et les activites avec leur heure et une
// aide sur la carte, le prix par personne et le detail dans la fiche, Payé
// demande Carte ou Espèces, et la Direction compte l encaisse par moyen.
//
// LA JOURNEE EST CELLE DU MOTEUR : douze dossiers passes par le vrai
// pipeline de planification (prepareReservationOps, hors base), chacun voyant
// les precedents. Horloge figee au samedi 3 octobre 2026, 15:10 a Bruxelles.
// L ORACLE EST ECRIT A LA MAIN (heures, sections, mots attendus).
//
//   [A] les sections : le RETARD en tete (rouge, depuis quand, le numero a
//       appeler), puis A venir, Sur place, A cloturer, Terminees ; chaque
//       dossier une fois ; une carte terminee tient sur sa tete
//   [B] le programme de chaque carte : les heures du planning, les pistes, et
//       l aide de chaque activite a 15:10 (Fini, En cours · fin 15:25, Dans
//       50 min, Dans 20 min, À leur rythme)
//   [C] les encadres : a valider, prix ajuste (avec le tarif), anniversaire
//       et formule, note du client ; aucun sur un dossier ordinaire
//   [D] le seuil de retard : a 15:03, le groupe de 15:00 est « Attendu » et
//       pas en retard ; reglé a 0, il l est ; reglé a 15, a 15:10, il ne
//       l est pas encore
//   [E] le geste : Espèces sur une carte ecrit status paid ET le moyen ; la
//       carte passe en Terminees avec « Payé · Espèces »
//   [F] la fiche : les vraies heures du groupe, le programme, l addition
//       ligne par ligne, le prix par joueur au centime, Payé · Carte et
//       Payé · Espèces, plus de « Plan automatique » ni de texte interne du
//       moteur, pas d « Arrivé maintenant » pour un groupe deja la
//   [G] telephone (390 px) : rien ne deborde, les boutons font 44 px
//   [H] le serveur : le seuil se borne (0-60, 5 par defaut) et la Direction
//       compte l encaisse par moyen (Carte, Espèces, Non précisé)
//
// CONTRE-EPREUVE (--mutate) : chaque regle est cassee EN MEMOIRE dans le
// fichier servi, et le gate doit rougir sur sa cible. Le disque n est jamais
// ecrit.
//
// Lancement : node scripts/caisse-cartes-check.js [--mutate]
'use strict';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_CAISSE_PORT || 4331);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JOUR = '2026-10-03';
// Le serveur prepare les plans avant le navigateur : sa garde de date doit
// voir la meme journee de fixture. Figer seulement page.clock faisait expirer
// les 11 plans fixes des le lendemain, avant toute mesure de l'interface.
const NativeDate = Date;
const FIXTURE_NOW = NativeDate.parse(`${JOUR}T08:00:00+02:00`);
global.Date = class FixtureDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [FIXTURE_NOW])); }
  static now() { return FIXTURE_NOW; }
};
const MUTATE = process.argv.includes('--mutate');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

// Les ancres se cherchent en LF (un depot Windows peut etre en CRLF).
const LF = String.fromCharCode(10);
const lireLF = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(String.fromCharCode(13) + LF).join(LF);

const MUTATIONS = [
  // Depuis le 2026-10-08, la section d un dossier vient de getStaffListeSection :
  // le retard y monte dans « En retard » ; sans cette ligne il reste « À venir ».
  { nom: 'le retard reste dans « À venir »', cible: '[A]', fichier: 'assets/app-main.js',
    de: "  if (etat === 'upcoming' && m && m.late) return 'late';\n", vers: '' },
  { nom: 'le seuil de retard est ignore (retard des la minute pile)', cible: '[D]', fichier: 'assets/app-main.js',
    de: '    else if (board.now - item.start >= seuil - 1e-9) late.push(item);', vers: '    else if (board.now - item.start >= 0) late.push(item);' },
  { nom: 'Encaisser oublie le moyen', cible: '[E]', fichier: 'assets/app-main.js',
    de: "  setReservationStatusDirect(id, 'paid', ev, { paymentMethod: moyen });", vers: "  setReservationStatusDirect(id, 'paid', ev);" },
  { nom: 'l aide de l activite ne lit plus l heure', cible: '[B]', fichier: 'assets/app-main.js',
    de: "  if (now >= etape.start) return { cle: 'encours', mot: `En cours · fin ${formatClockDisplay(etape.end)}` };", vers: "  if (now >= etape.start) return { cle: 'prevu', mot: '' };" },
  { nom: 'le prix ajuste n a plus d encadre', cible: '[C]', fichier: 'assets/app-main.js',
    de: '  if (marquePrix) encadres.push', vers: '  if (false) encadres.push' },
  { nom: 'la fiche reprend l heure de la premiere fenetre', cible: '[F]', fichier: 'assets/app-main.js',
    de: '  const span = getStaffTerrainSpan(r);\n  const jour = r.date', vers: '  const span = { start: timeToNum(r.startTime), end: timeToNum(r.startTime) + (Number(r.duration) || 1) };\n  const jour = r.date' },
  { nom: 'le prix par joueur arrondi a l euro', cible: '[F]', fichier: 'assets/app-main.js',
    de: '  const parJoueur = total > 0 && joueurs > 0 ? formatMoneyCentimes(total / joueurs) : \'\';', vers: '  const parJoueur = total > 0 && joueurs > 0 ? formatMoney(total / joueurs) : \'\';' },
  // Depuis le 2026-10-04, DEUX regles garantissent les 44 px (celle du
  // telephone et `#staffTableBox .gc-btn`, posee pour la tablette) : muter la
  // premiere seule ne pouvait plus rougir [G]. La mutation casse la garantie
  // generale, en force, pour que la mesure soit bien exercee.
  { nom: 'les boutons des cartes redescendent a 32 px sur telephone', cible: '[G]', fichier: 'assets/pinlane-staff.css',
    de: '#staffTableBox .gc-btn { min-height:44px; min-width:44px; }', vers: '#staffTableBox .gc-btn { min-height:32px !important; height:32px !important; min-width:44px; }' },
];

let failures = 0;
let journal = [];
function ok(cond, label, detail = '') {
  journal.push({ ok: Boolean(cond), label });
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// LA JOURNEE, PASSEE PAR LE VRAI MOTEUR.
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
      notes: notes || '', activityProgress: {}, program: r.program || null, channel: 'staff',
      centerId: 'libramont', opsPlan: plan, riskLevel: r.riskLevel || '', riskScore: r.riskScore ?? null,
      validationStatus: validationStatus || r.validationStatus || 'confirmed',
    });
  }
  return jour;
}

// ---------------------------------------------------------------------------
// LE SERVEUR (fichiers du depot, ou leur version mutee) ET LE NAVIGATEUR.
// ---------------------------------------------------------------------------
const overrides = new Map();
function serveur() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
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

async function ouvrir(browser, jour, { heure = '15:10', largeur = 1440, seuil = null } = {}) {
  const centre = { ...require(path.join(ROOT, 'ops-knowledge', 'centers.json')).centers.find((c) => c.id === 'libramont'), status: 'active' };
  const activites = require(path.join(ROOT, 'ops-knowledge', 'activities.json')).activities;
  const ctx = await browser.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const instant = `${JOUR}T${heure}:00+02:00`;
  await page.clock.setFixedTime(new Date(instant));
  const expiresAt = new Date(new Date(instant).getTime() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, jour, centre, activites, seuil }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view', 'payments.markPaid'];
    const session = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const memoire = JSON.parse(JSON.stringify(jour));
    window.__caisse = { ecritures: [] };
    const centreServi = seuil === null ? centre : { ...centre, accueil: { lateThresholdMinutes: seuil } };
    const J = (p) => { const corps = JSON.stringify(p); let h = 0; for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0; return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } }); };
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input?.url || '', window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: `qa-${window.__caisse.ecritures.length}`, reservations: u.searchParams.get('date') === memoire[0].date ? memoire : [], laneStatuses: { 1: 'active', 2: 'active', 3: 'active', 4: 'active', 5: 'active', 6: 'active', 7: 'active', 8: 'active' }, centerId: 'libramont', ...(seuil === null ? {} : { accueil: { lateThresholdMinutes: seuil } }) });
      if (u.pathname === '/api/staff-reservations' && methode !== 'GET') {
        let corps = {}; try { corps = JSON.parse(init.body || '{}'); } catch (e) {}
        window.__caisse.ecritures.push(corps);
        const r = memoire.find((x) => Number(x.id) === Number(corps.id));
        if (r) Object.assign(r, { status: corps.status || r.status, paymentMethod: corps.paymentMethod ?? r.paymentMethod });
        return J({ ok: true, reservation: r || null });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: memoire[0].date, durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') {
        if (u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: [centreServi], activities: activites });
        return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      }
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: memoire, emails: [], agentEvents: [], centerId: 'libramont' });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, jour, centre, activites, seuil });
  await page.goto(`${BASE}/?caisse=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof state !== 'undefined', null, { timeout: 20000 });
  await page.evaluate((jourDate) => {
    if (typeof hasSavedAuth === 'function') hasSavedAuth();
    state.currentDate = jourDate;
    setView('staff');
    state.staffStatusFilter = 'all';
    state.searchTerm = '';
    if (typeof openStaffMenuPage === 'function') openStaffMenuPage('planning');
    if (typeof setStaffResourceView === 'function') setStaffResourceView('all');
  }, JOUR);
  await page.waitForFunction((n) => document.querySelectorAll('#resList .gc[data-res-row-id]').length === n, jour.length, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page, erreurs };
}

// Ce que l ecran montre, carte par carte.
const lireListe = (page) => page.evaluate(() => {
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  return [...document.querySelectorAll('#resList .gc-section')].map((sec) => ({
    cle: [...sec.classList].find((c) => ['active', 'late', 'upcoming', 'onsite', 'closing', 'done'].includes(c)),
    titre: txt(sec.querySelector('.res-section-head .label')),
    cartes: [...sec.querySelectorAll('.gc[data-res-row-id]')].map((c) => ({
      id: Number(c.dataset.resRowId),
      phase: (() => { const m = getStaffReservationMoments(state.reservations).get(String(c.dataset.resRowId)); return m?.late ? 'late' : m?.etat; })(),
      quand: txt(c.querySelector('.gc-when')),
      prix: txt(c.querySelector('.gc-price')),
      alerte: txt(c.querySelector('.gc-alert')),
      appel: c.querySelector('.gc-call') ? c.querySelector('.gc-call').getAttribute('href') : '',
      etapes: [...c.querySelectorAll('.gc-step')].map((s) => ({ heure: txt(s.querySelector('.gc-step-time')), quoi: txt(s.querySelector('.gc-step-what')), aide: txt(s.querySelector('.gc-step-state')), focus: s.classList.contains('is-focus') })),
      // Les activites libres : une ligne de puces cochables (2026-10-01).
      libres: [...c.querySelectorAll('.gc-step-libres .gc-libre')].map((b) => ({ nom: txt(b.querySelector('span')), fait: b.classList.contains('is-fait'), cochable: !b.disabled })),
      encadres: [...c.querySelectorAll('.gc-flag')].map((f) => ({ ton: [...f.classList].find((x) => x.startsWith('tone-')), texte: txt(f) })),
      boutons: [...c.querySelectorAll('.gc-actions button')].map((b) => txt(b)),
      termine: c.classList.contains('is-done'),
    })),
  }));
});
const carte = (sections, id) => sections.flatMap((s) => s.cartes.map((c) => ({ ...c, section: c.phase || s.cle }))).find((c) => c.id === id) || null;

// Un bloc qui plante rougit SA lettre et laisse les autres se jouer.
async function bloc(lettre, fn) {
  try { await fn(); } catch (error) { ok(false, `${lettre} le bloc a planté`, String(error && error.message || error).split('\n')[0]); }
}

async function scenario(browser, jour) {
  return scenarioBlocs(browser, jour);
}

async function scenarioBlocs(browser, jour) {
  // [A] LES SECTIONS
  await bloc('[A]', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, jour);
    const sections = await lireListe(page);
    ok(sections.map((s) => s.cle).join(',') === 'active', '[A] les visites non terminées restent dans une grille active stable', sections.map((s) => s.cle).join(','));
    const ids = (cle) => sections.flatMap(s => s.cartes).filter(c => c.phase === cle).sort((a,b) => a.quand.localeCompare(b.quand)).map(c => c.id).join(',');
    ok(ids('late') === '81006,81007', '[A] en retard : Martin (14:30) puis Nguyen (15:00)', ids('late'));
    // (la phase ci-dessus vient du modele ; depuis le 2026-10-10 les visites
    // partagent une grille, et c est la puce qui dit le retard a l ecran)
    const puceRetard = await page.evaluate(() => {
      const puce = [...document.querySelectorAll('#resList .status-chip')].find((x) => /En retard/.test(x.textContent));
      const n = puce ? puce.querySelector('span') : null;
      return n ? Number(n.textContent.trim()) : null;
    });
    ok(puceRetard === 2, '[A] la puce « En retard » compte Martin et Nguyen', String(puceRetard));
    ok(ids('upcoming') === '81008,81009,81010,81011,81012', '[A] à venir, par heure', ids('upcoming'));
    ok(ids('onsite') === '81001,81004', '[A] sur place : payé non terminé Peeters et Dupont', ids('onsite'));
    ok(ids('closing').split(',').sort().join(',') === '81002,81003,81005', '[A] à clôturer : Léa, FC Bertrix, Hôtel des Ardennes', ids('closing'));
    ok(ids('done') === '', '[A] aucune visite terminée sans suivi entièrement coché', ids('done'));
    const tous = sections.flatMap((s) => s.cartes.map((c) => c.id));
    ok(tous.length === jour.length && new Set(tous).size === jour.length, '[A] chaque dossier une fois', `${tous.length} cartes`);
    const martin = carte(sections, 81006);
    ok(martin && /En retard · 40 min/.test(martin.alerte) && /Attendu à 14:30/.test(martin.alerte), '[A] le retard dit depuis quand et l heure attendue', martin && martin.alerte);
    ok(martin && martin.appel === 'tel:+32470006' + '2145', '[A] le numero a appeler est un lien', martin && martin.appel);
    ok(martin && martin.boutons.join('|') === 'Arrivé', '[A] le seul geste d un retard : Arrivé', martin && martin.boutons.join('|'));
    const peeters = carte(sections, 81001);
    ok(peeters && !peeters.termine && peeters.etapes.length > 0 && /Payé · Espèces/.test(peeters.prix), '[A] payé ne masque pas le programme restant', peeters && JSON.stringify(peeters));
    const titreRetard = await page.evaluate(() => { const el = document.querySelector('.gc-alert.is-late b'); return el ? getComputedStyle(el).color : ''; });
    // UN RETARD SE DIT UNE FOIS (2026-10-05) : la carte garde un filet neutre et
    // porte le rouge en liseré a gauche (ombre interne), de la couleur exacte
    // du titre de section. Le controle lit ce liseré, plus le bord.
    const bordRetard = await page.evaluate(() => { const el = document.querySelector('.gc.is-late'); return el ? getComputedStyle(el).boxShadow : ''; });
    const rouge = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
    ok(Boolean(titreRetard) && bordRetard.includes(titreRetard) && /inset/.test(bordRetard), '[A] la section et la carte en retard sont rouges (--danger)', `${titreRetard} / ${bordRetard} / ${rouge}`);

    // [B] LE PROGRAMME ET L AIDE
    const dupont = carte(sections, 81004);
    const aides = dupont ? dupont.etapes.map((e) => `${e.heure.slice(0, 5)} ${e.aide}`) : [];
    ok(aides.join(' | ') === '14:00 Fini | 15:00 En cours · fin 15:25 | 16:00 Dans 50 min', '[B] Dupont : bowling fini, laser en cours, la 2e partie dans 50 min', aides.join(' | '));
    ok(dupont && dupont.etapes[1].focus && !dupont.etapes[0].focus, '[B] l activite en cours porte le contour', dupont && JSON.stringify(dupont.etapes.map((e) => e.focus)));
    ok(dupont && /pistes 1, 2/.test(dupont.etapes[0].quoi) && /partie 2\/2/.test(dupont.etapes[2].quoi), '[B] les pistes et le rang de la partie se lisent sur la ligne', dupont && dupont.etapes.map((e) => e.quoi).join(' | '));
    const lambda = carte(sections, 81008);
    ok(lambda && /pistes 1 à 5/.test(lambda.etapes[0].quoi) && lambda.etapes[0].aide === 'Dans 20 min', '[B] Lambda : « pistes 1 à 5 », dans 20 min', lambda && JSON.stringify(lambda.etapes[0]));
    const ardennes = carte(sections, 81005);
    // UNE LIGNE POUR TOUTES LES ACTIVITES LIBRES (Movsar, 2026-10-01 : « quand
    // y aura une trentaine de reservations ca va etre super galere ») : « Libre,
    // a leur rythme », puis une puce cochable par activite.
    ok(ardennes && ardennes.etapes.length === 1 && ardennes.etapes[0].heure === 'Libre, à leur rythme'
      && ardennes.libres.map((l) => l.nom).join('|') === 'Minigolf Blacklight|Arcades' && ardennes.libres.every((l) => l.cochable && !l.fait),
      '[B] les activités libres : une ligne « Libre », une puce cochable par activité', ardennes && JSON.stringify({ etapes: ardennes.etapes, libres: ardennes.libres }));
    ok(ardennes && /Prix sur place/.test(ardennes.prix) && !/0\s*€/.test(ardennes.prix), '[B] sans montant connu : « Prix sur place », jamais « 0 € »', ardennes && ardennes.prix);
    const scouts = carte(sections, 81012);
    ok(scouts && scouts.etapes.filter((e) => /groupe \d\/2 · 20 joueurs/.test(e.quoi)).length === 2, '[B] le laser en deux groupes de 20 se lit sur deux lignes', scouts && scouts.etapes.map((e) => e.quoi).join(' | '));

    // [C] LES ENCADRES
    const tons = (c) => (c ? c.encadres.map((e) => e.ton).join(',') : '');
    ok(tons(lambda) === 'tone-review,tone-price,tone-note', '[C] Lambda : à valider, prix ajusté, note', tons(lambda));
    ok(lambda && /280\s*€ · référence 495\s*€/.test(lambda.encadres[1].texte), '[C] le prix ajusté dit le tarif (« 280 € · référence 495 € »)', lambda && lambda.encadres[1] && lambda.encadres[1].texte);
    const noah = carte(sections, 81009);
    ok(noah && /Anniversaire/.test((noah.encadres.find((e) => e.ton === 'tone-occasion') || {}).texte || '') && /Allergie arachides/.test((noah.encadres.find((e) => e.ton === 'tone-note') || {}).texte || ''), '[C] Noah : anniversaire et la note en entier', noah && JSON.stringify(noah.encadres));
    ok(martin && martin.encadres.length === 0 && dupont && dupont.encadres.length === 0, '[C] aucun encadré sur un dossier ordinaire', `${tons(martin)} / ${tons(dupont)}`);
    ok(lambda && lambda.boutons[0] === 'Valider', '[C] une demande à valider propose Valider en premier', lambda && lambda.boutons.join('|'));

    // [E] LE GESTE
    ok(dupont && dupont.boutons.join('|') === 'Carte|Espèces', '[E] un groupe sur place s encaisse : Carte ou Espèces', dupont && dupont.boutons.join('|'));
    await page.click('#resList .gc[data-res-row-id="81004"] .gc-actions button:has-text("Espèces")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const ecrit = await page.evaluate(() => window.__caisse.ecritures.slice(-1)[0] || null);
    ok(ecrit && Number(ecrit.id) === 81004 && ecrit.status === 'paid' && ecrit.paymentMethod === 'Espèces', '[E] Espèces écrit status paid ET paymentMethod Espèces', JSON.stringify(ecrit && { id: ecrit.id, status: ecrit.status, paymentMethod: ecrit.paymentMethod }));
    const apres = await lireListe(page);
    const dupontApres = carte(apres, 81004);
    ok(dupontApres && /Payé · Espèces/.test(dupontApres.prix), '[E] la carte dit « Payé · Espèces »', dupontApres && dupontApres.prix);
    ok(erreurs.length === 0, '[A-E] aucune erreur JS', erreurs.join(' | '));
    await ctx.close();
  });

  // [D] LE SEUIL DE RETARD
  await bloc('[D]', async () => {
    const { ctx, page } = await ouvrir(browser, jour, { heure: '15:03' });
    const s = await lireListe(page);
    const nguyen = carte(s, 81007);
    ok(nguyen && nguyen.section === 'upcoming' && !nguyen.alerte && nguyen.etapes[0].aide === 'Attendu', '[D] 15:03, seuil 5 min : Nguyen (15:00) est « Attendu » dans À venir, pas en retard', nguyen && JSON.stringify({ s: nguyen.section, a: nguyen.alerte, aide: nguyen.etapes[0].aide }));
    await ctx.close();
  });
  await bloc('[D]', async () => {
    const { ctx, page } = await ouvrir(browser, jour, { heure: '15:03', seuil: 0 });
    const nguyen = carte(await lireListe(page), 81007);
    ok(nguyen && nguyen.section === 'late' && /En retard · 3 min/.test(nguyen.alerte), '[D] réglé à 0 : à 15:03 il est en retard de 3 min', nguyen && `${nguyen.section} ${nguyen.alerte}`);
    await ctx.close();
  });
  await bloc('[D]', async () => {
    const { ctx, page } = await ouvrir(browser, jour, { heure: '15:10', seuil: 15 });
    const s = await lireListe(page);
    const nguyen = carte(s, 81007);
    const martin = carte(s, 81006);
    ok(nguyen && nguyen.section === 'upcoming' && martin && martin.section === 'late', '[D] réglé à 15 : à 15:10, Nguyen attendu, Martin (40 min) en retard', `${nguyen && nguyen.section} / ${martin && martin.section}`);
    await ctx.close();
  });

  // [F] LA FICHE
  await bloc('[F]', async () => {
    const { ctx, page } = await ouvrir(browser, jour);
    await page.evaluate(() => openPos(81004));
    await page.waitForTimeout(500);
    const fiche = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const m = document.querySelector('#posOverlay .edit-modal');
      if (!m) return { sous: '', corps: '', lignes: [], total: '', etats: [], etapes: 0 };
      return {
        facts: Object.fromEntries([...m.querySelectorAll('.dossier-fact')].map((fact) => [txt(fact.querySelector('span')), txt(fact.querySelector('strong'))])),
        corps: txt(m.querySelector('.edit-modal-body')),
        lignes: [...m.querySelectorAll('.gc-bill-lines > div')].map((d) => `${txt(d.querySelector('dt'))} ${txt(d.querySelector('dd'))}`),
        total: txt(m.querySelector('.gc-bill-total')),
        addition: txt(m.querySelector('.gc-bill')),
        argent: txt(m.querySelector('.fx-act .pos-act-money')),
        etats: [...m.querySelectorAll('.gc-sheet-states button')].map((b) => txt(b)),
        etapes: m.querySelectorAll('.gc-steps .gc-step').length,
      };
    });
    ok(fiche.facts && fiche.facts.Horaires === '14:00 → 16:25' && /^(10 joueurs|10 personnes présentes)$/.test(fiche.facts.Groupe), '[F] l en-tête dit les vraies heures du groupe (14:00 → 16:25)', JSON.stringify(fiche.facts));
    ok(fiche.etapes === 3, '[F] le programme : trois lignes', String(fiche.etapes));
    ok(/^Bowling 10 joueurs · 1h · 2 pistes × 39\s*€ 78\s*€$/.test(fiche.lignes[0] || '') && /^Laser Game 10 joueurs · 2 parties · 18\s*€ × 10 180\s*€$/.test(fiche.lignes[1] || ''), '[F] l addition ligne par ligne, avec leurs10 joueurs et le calcul (2 pistes × 39 €, 18 € × 10)', fiche.lignes.join(' | '));
    ok(fiche.facts && fiche.facts.Ressources === 'Pistes 1, 2 + arène laser', '[F] l en-tête dit où : « Pistes 1, 2 + arène laser »', JSON.stringify(fiche.facts));
    // DEPUIS LA FICHE D UN COUP D OEIL (2026-10-26), « À encaisser » se lit une
    // fois, sur la ligne d etat en haut de la fiche ; l addition garde le total
    // et le prix par joueur.
    ok(/258\s*€/.test(fiche.total) && /25,80\s*€ par joueur/.test(fiche.total) && /À encaisser\s*258\s*€/.test(fiche.argent) && !/À encaisser|Payé/.test(fiche.addition), '[F] le total et le prix par joueur au centime dans l addition, « À encaisser 258 € » une fois, sur la ligne d etat', JSON.stringify({ total: fiche.total, argent: fiche.argent }));
    ok(fiche.etats.join('|') === 'Confirmé|Arrivé|Payé · Carte|Payé · Espèces', '[F] les états : Confirmé, Arrivé, Payé · Carte, Payé · Espèces', fiche.etats.join('|'));
    ok(!/Plan automatique|Risque|Consigne:|Point marche/.test(fiche.corps), '[F] plus de « Plan automatique » ni de texte interne du moteur', (fiche.corps.match(/Plan automatique|Risque[^|]*|Consigne:[^|]*/) || [''])[0]);
    ok(!/Arrivé maintenant/.test(fiche.corps), '[F] un groupe déjà arrivé n a pas « Arrivé maintenant »', '');
    await page.evaluate(() => { closePos(); openPos(81008); });
    await page.waitForTimeout(400);
    const lambda = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      if (!document.querySelector('#posOverlay .gc-bill')) return { ajuste: '', total: '' };
      const ajuste = document.querySelector('#posOverlay .gc-bill-lines .is-adjust');
      return { ajuste: ajuste ? `${txt(ajuste.querySelector('dt'))} ${txt(ajuste.querySelector('dd'))}` : '', total: txt(document.querySelector('#posOverlay .gc-bill-total')) };
    });
    ok(/^Prix ajusté tarif 495\s*€ −215\s*€$/.test(lambda.ajuste) && /9,33\s*€ par joueur/.test(lambda.total), '[F] Lambda : l écart au tarif et 9,33 € par joueur', JSON.stringify(lambda));
    await ctx.close();
  });

  // [G] TELEPHONE
  await bloc('[G]', async () => {
    const { ctx, page } = await ouvrir(browser, jour, { largeur: 390 });
    const mesure = await page.evaluate(() => {
      const cartes = [...document.querySelectorAll('#resList .gc')];
      const deborde = cartes.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.dataset.resRowId);
      const boutons = [...document.querySelectorAll('#resList .gc-actions button')].map((b) => Math.round(b.getBoundingClientRect().height));
      return { deborde, petits: boutons.filter((h) => h < 44).length, n: boutons.length, page: document.documentElement.scrollWidth };
    });
    ok(mesure.deborde.length === 0 && mesure.page <= 390, '[G] 390 px : aucune carte ne déborde, pas de défilement horizontal', JSON.stringify(mesure));
    ok(mesure.n > 0 && mesure.petits === 0, '[G] 390 px : chaque bouton fait au moins 44 px', JSON.stringify(mesure));
    await ctx.close();
  });
}

function serveurSeul() {
  // [H] LE SERVEUR
  const { normalizeAccueil, normalizeCenterConfig } = require(path.join(ROOT, 'lib', 'center-config'));
  ok(normalizeAccueil(null).lateThresholdMinutes === 5 && normalizeAccueil({ lateThresholdMinutes: 99 }).lateThresholdMinutes === 60 && normalizeAccueil({ lateThresholdMinutes: -3 }).lateThresholdMinutes === 0 && normalizeAccueil({ lateThresholdMinutes: 'x' }).lateThresholdMinutes === 5, '[H] le seuil se borne : 5 par défaut, 0 à 60');
  ok(normalizeCenterConfig({ accueil: { lateThresholdMinutes: 8 } }, 'libramont').accueil.lateThresholdMinutes === 8, '[H] la configuration du centre garde le seuil enregistré');
  const { buildDirectionAnalytics } = require(path.join(ROOT, 'lib', 'direction-analytics'));
  const d = (id, status, price, paymentMethod) => ({ id, date: JOUR, status, price, pax: 2, paymentMethod, name: `c${id}`, phone: `+3247000000${id}`, type: 'bowling', startTime: '14:00' });
  const a = buildDirectionAnalytics({ history: [d(1, 'paid', 100, 'Carte Bancaire'), d(2, 'paid', 50, 'Espèces'), d(3, 'paid', 30, 'Comptoir'), d(4, 'pending', 70, '')], startDate: JOUR, endDate: JOUR, center: null });
  const m = Object.fromEntries((a.byPaymentMethod || []).map((x) => [x.key, x.amount]));
  ok(a.totals.collected === 180 && m.carte === 100 && m.especes === 50 && m.non_precise === 30, '[H] la Direction : 180 € encaissés = 100 carte + 50 espèces + 30 non précisé', JSON.stringify({ c: a.totals.collected, m }));
}

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));
  const jour = await journee();
  const server = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!MUTATE) {
      serveurSeul();
      await scenario(browser, jour);
    } else {
      // Chaque regle cassee doit faire rougir SA cible. Le disque n est pas ecrit.
      const avant = Object.fromEntries(MUTATIONS.map((m) => [m.fichier, fs.readFileSync(path.join(ROOT, m.fichier))]));
      for (const m of MUTATIONS) {
        overrides.clear();
        const src = lireLF(m.fichier);
        if (!src.includes(m.de)) { ok(false, `[mutation] ancre introuvable : ${m.nom}`); continue; }
        let mute = src.replace(m.de, m.vers);
        if (m.plus) {
          if (!mute.includes(m.plus.de)) { ok(false, `[mutation] ancre 2 introuvable : ${m.nom}`); continue; }
          mute = mute.replace(m.plus.de, m.plus.vers);
        }
        overrides.set(m.fichier, mute);
        journal = [];
        const echecsAvant = failures;
        await scenario(browser, jour);
        const rouges = journal.filter((l) => !l.ok && l.label.startsWith(m.cible));
        failures = echecsAvant;
        ok(rouges.length > 0, `[contre-épreuve] ${m.nom} : ${m.cible} rougit (${rouges.length})`);
      }
      overrides.clear();
      for (const [fichier, buf] of Object.entries(avant)) ok(Buffer.compare(buf, fs.readFileSync(path.join(ROOT, fichier))) === 0, `[contre-épreuve] ${fichier} intact sur le disque`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\ncaisse-cartes-check: ${failures} défaut(s).` : `\ncaisse-cartes-check: ALL OK${MUTATE ? ' (contre-épreuves)' : ''} (retard en tête, aides par activité, encadrés, seuil réglable, Carte/Espèces, fiche, téléphone, Direction)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
