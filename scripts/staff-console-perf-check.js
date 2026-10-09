// LA CONSOLE STAFF RESTE FLUIDE SUR UNE TABLETTE MODESTE, ET LE PLANNING LASER
// TIENT SUR UN TELEPHONE (2026-10-07).
//
// Movsar : « les tablettes qu on va avoir pour le logiciel ca bug dessus [...]
// faire super gaffe [...] sans niquer les animations ni l agreabilite ».
// Mesure A/B (tablette 800x1280, processeur ralenti 4x et 6x, journee chargee :
// 42 bowling sur 6 pistes, 26 lancements laser) : chaque rendu du planning
// payait plusieurs mises en page completes forcees, le releve des cartes du
// motion en forcait une par carte, et un re-rendu sans aucun changement
// reconstruisait quand meme les deux grilles et la liste (analyse HTML, style,
// mise en page, accessibilite, peinture de 2 800 elements).
//
// Ce gate garde ce que les correctifs garantissent, avec des COMPTEURS et des
// RATIOS, jamais des millisecondes absolues (un seuil absolu mesure l humeur de
// la machine, pas le code : lecon du 2026-08-26) :
//   [A] un re-rendu sans changement (sondage, tic de l horloge, rendu complet)
//       ne reconstruit aucune des trois surfaces, y compris juste apres ce que
//       le motion ecrit sur la liste (cascade, allumage, compteurs, fantome) ;
//   [B] un dossier qui change se voit, et seule la surface qui le montre se
//       reconstruit (la grille cachee reste) ;
//   [C] une surface touchee depuis son rendu (classe posee par un geste, texte
//       reecrit) se reconstruit meme si son HTML est identique : jamais d etat
//       perime ;
//   [D] un rendu ne force pas de mise en page au milieu de ses ecritures :
//       cinq changements d etat d affilee tiennent en quinze mises en page
//       (trois en moyenne, une quand tout va bien) ;
//   [E] la cascade du motion redemarre ses lignes en une seule lecture, quel
//       que soit leur nombre ;
//   [F] RATIO : un re-rendu sans changement coute moins de la moitie d un
//       rendu qui change tout (temps processeur du fil principal, memes
//       instants), et chaque mesure « sans changement » n a vraiment rien
//       reconstruit ;
//   [G] le defilement du planning laser plein ecran (maquette E, un rang par
//       depart) survit a un rendu qui change ;
//   [H] telephone 390 px : le planning Laser (normal et plein ecran) tient dans
//       la largeur, jauges et comptes compris, la file « À placer » reste a
//       l ecran, aucune page ne deborde de cote ;
//   [I] au doigt sur telephone : appui long sur une partie a placer, glisser
//       sur un depart qui la prend, la partie y est posee au depart sous le
//       doigt (vrai transformateur lib/reservation-activity-move.js) ;
//   [J] a la souris sur tablette : une carte bowling glissee d une heure est
//       relue a sa nouvelle heure ; « Arrivé » bascule la carte ;
//   [K] tablette, Laser plein ecran : une partie glissee au bord bas du
//       planning, au-dessus de la file, le fait defiler, puis se pose sur le
//       depart vise ;
//   [L] la meme partie, glissee SUR la file « À placer » au bas de l ecran, ne
//       fait pas defiler le planning, et lachee la, elle quitte le planning.
//
// Contre-preuves : node scripts/staff-console-perf-check.js --contre-preuves
// (ou --contre-preuves=nom,nom). Le fichier servi est casse expres (en
// memoire, le disque n est jamais touche) et la verification visee doit
// rougir :
//   surface    -> poserHtmlSurface reconstruit toujours             [A] et [F]
//   touchee    -> une surface touchee passe pour intacte             [C]
//   motion     -> ce que le motion ecrit passe pour une retouche     [A] et [F]
//   compteur   -> le marqueur d un compteur tombe avant sa derniere
//                 ecriture                                          [A]
//   defilement -> la position se relit au milieu du rendu            [D]
//   cascade    -> une lecture forcee par ligne dans la cascade       [E]
//   telephone  -> les cases de la jauge Laser ne retrecissent plus   [H]
//   defile     -> le planning Laser ne suit plus le bord             [K]
//   file       -> le planning Laser defile aussi sur la file         [L]
// Rejouer une seule verification : --seulement=K,L
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { installActivityMoveFixture } = require('./activity-drag-ui-fixture');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_STAFF_PERF_PORT || 4881);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const TABLETTE = { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-BE' };
const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'fr-BE' };
// LE JOUR DU GATE EST TOUJOURS A VENIR (2026-10-09) : le samedi qui suit, a
// deux jours au moins. En dur, il devenait « aujourd hui » pour la page le
// lendemain (departs joues replies, carte du prochain depart), puis un jour
// passe. Le centre du gate ouvre de 10:00 a 24:00 tous les jours : le jour de
// la semaine ne change rien. Pas d horloge figee : le glisser au doigt ignore
// le clic suivant jusqu a Date.now() + 350 ms, une heure arretee l ignorerait
// pour toujours.
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SAMEDI = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + 2); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return d; })();
const JOUR = isoLocal(SAMEDI);
const LENDEMAIN = isoLocal(new Date(SAMEDI.getFullYear(), SAMEDI.getMonth(), SAMEDI.getDate() + 1));
const CODES_TABLETTE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'K', 'L'];
const CODES_TELEPHONE = ['H', 'I'];

// [fichier, ancre, remplacement, verifications qui doivent rougir] : chaque
// ancre doit exister une seule fois.
const SURFACE_TOUCHEE = "  return mutations.some((m) => !ecritureDuMotion(m) && (m.type === 'childList' || m.target !== conteneur));";
const MUTATIONS = {
  surface: ['assets/app-main.js', '    if (!suivi.touchee && suivi.html === html) return false;', '    if (false) return false;', ['A', 'F']],
  touchee: ['assets/app-main.js', SURFACE_TOUCHEE, '  return false;', ['C']],
  motion: ['assets/app-main.js', SURFACE_TOUCHEE, "  return mutations.some((m) => m.type === 'childList' || m.target !== conteneur);", ['A', 'F']],
  compteur: ['assets/pinlane-motion.js', "        Promise.resolve().then(function () { el.removeAttribute('data-pl-anim'); });", "        el.removeAttribute('data-pl-anim');", ['A']],
  defilement: ['assets/app-main.js', '  const connu = lot && (lot.aPoser.get(el) || lot.lus.get(el));', '  const connu = null;', ['D']],
  cascade: ['assets/pinlane-motion.js', "      if (aDecaler[r][0].classList.contains('pl-in')) { aDecaler[r][0].classList.remove('pl-in'); relancer = true; }", "      if (aDecaler[r][0].classList.contains('pl-in')) { aDecaler[r][0].classList.remove('pl-in'); void aDecaler[r][0].offsetWidth; }", ['E']],
  // Le planning Laser de la maquette E (2026-10-08) : 40 px par case, 12
  // armes font 502 px, la jauge sort du telephone.
  telephone: ['assets/pinlane-staff.css', '.lp-cases { display: grid; grid-template-columns: repeat(var(--lp-cases), minmax(0, 1fr)); gap: 0; width: 100%; background: var(--lp-vide); border-radius: 4px; box-shadow: inset 0 0 0 1px var(--lp-case); overflow: hidden; }', '.lp-cases { display: grid; grid-template-columns: repeat(var(--lp-cases), 40px); gap: 0; width: 100%; background: var(--lp-vide); border-radius: 4px; box-shadow: inset 0 0 0 1px var(--lp-case); overflow: hidden; }', ['H']],
  // Le defilement du bord ne bouge plus le planning (lpDefilerDemarrer).
  defile: ['assets/app-main.js', '      defileur.scrollTop = avantPos + vitesse * dt / 1000;', '      void avantPos;', ['K']],
  // Le bord bas oublie la file : le pointeur sur la file fait defiler.
  file: ['assets/app-main.js', '    const bas = Math.min(window.innerHeight, cadre.bottom, basFile);', '    const bas = Math.min(window.innerHeight, cadre.bottom);', ['L']],
};

let casse = null;
function contenu(fichier) {
  const brut = fs.readFileSync(fichier);
  if (!casse) return brut;
  const [cible, ancre, remplacement] = MUTATIONS[casse];
  if (path.resolve(ROOT, cible) !== path.resolve(fichier)) return brut;
  const texte = brut.toString('utf8').replace(/\r\n/g, '\n');
  if (texte.split(ancre).length !== 2) throw new Error(`contre-preuve ${casse} : ancre introuvable ou multiple dans ${cible}`);
  return Buffer.from(texte.replace(ancre, remplacement), 'utf8');
}
function servir() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let f = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') f = path.join(ROOT, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    try {
      const corps = contenu(f);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(corps);
    } catch (error) { res.writeHead(500); res.end(String(error.message)); }
  });
  return new Promise((ok, ko) => { server.once('error', ko); server.listen(PORT, '127.0.0.1', () => ok(server)); });
}

// Le faux serveur, cote page : session, centre 6 pistes / 12 armes ouvert de
// 10 a 24 h, journee chargee (ids propres a chaque jour), une partie laser a
// placer, PATCH de statut et deplacement par le vrai transformateur.
function installerMock(page) {
  const expiresAt = new Date(Date.now() + 864e5).toISOString();
  return page.addInitScript(({ expiresAt, JOUR }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'reservations.quick', 'clients.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const semaine = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { open: '10:00', close: '24:00' }]));
    const centre = { id: 'libramont', name: 'Centre QA', status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 6, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8, preferAdjacentLanes: true }, laser: { weaponCount: 12, parallelLaunches: 1, canSplitGroupsCleanly: false, requiresCompleteGroupBeforeLaunch: true, riskLevel: 'critical' }, partyTables: null }, defaultSchedule: { regular: semaine, holiday: {} }, activityAvailability: {}, holidaySettings: { enabled: false, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {}, classification: {}, customActivities: [] };
    const jours = {};
    const jour = (date) => {
      if (jours[date]) return jours[date];
      const r = [];
      let id = 70000 + Number(date.slice(8, 10)) * 200;
      for (let lane = 1; lane <= 6; lane += 1) for (let h = 10; h < 23; h += 2) {
        const debut = String(h).padStart(2, '0') + ':' + String((lane * 15) % 60).padStart(2, '0');
        r.push({ id: id++, name: `Groupe ${lane}-${h} ${date.slice(8)}`, phone: '+3247000' + String(id).slice(-4), email: `g${id}@x.test`, centerId: 'libramont', date, startTime: debut, duration: 1, totalDuration: 1, type: 'bowling', label: 'Bowling', status: h < 14 ? 'arrived' : 'confirmed', pax: 4 + (lane % 4), lanes: [lane], price: 39, basePrice: 39, updatedAt: '2026-10-04T08:00:00Z', opsPlan: null, program: null });
      }
      for (let h = 10; h < 23; h += 1) for (const mm of ['00', '30']) r.push({ id: id++, name: `Laser ${h}${mm} ${date.slice(8)}`, phone: '+3247100' + String(id).slice(-4), email: `l${id}@x.test`, centerId: 'libramont', date, startTime: String(h).padStart(2, '0') + ':' + mm, duration: 0.5, totalDuration: 0.5, type: 'laser', label: 'Laser', status: 'confirmed', pax: 6 + (h % 5), lanes: [], price: 40, basePrice: 40, updatedAt: '2026-10-04T08:00:00Z', opsPlan: null, program: null });
      if (date === JOUR) r.push({ id: 7102, name: 'Dossier 7102', phone: '+32470007102', email: 'd7102@x.test', centerId: 'libramont', date, startTime: '18:00', duration: 1, totalDuration: 1, type: 'laser', label: 'Laser', status: 'confirmed', pax: 6, lanes: [], price: 80, basePrice: 80, updatedAt: '2026-10-04T08:00:00Z', opsPlan: { laserManual: true, resourceBlocks: [] }, program: null });
      jours[date] = r;
      return r;
    };
    window.__JOUR__ = jour;
    window.__PATCHS__ = [];
    // Un serveur ne change pas d ETag quand rien n a bouge : l empreinte du contenu.
    const J = (p, status = 200) => { const corps = JSON.stringify(p); let h = 0; for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0; return new Response(corps, { status, headers: { 'content-type': 'application/json; charset=utf-8', etag: 'qa-' + (h >>> 0).toString(36) } }); };
    const natif = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), permissions: perms, locked: true }], members: [{ id: 'qa', name: 'QA', roleId: 'direction' }] } });
      if (u.pathname === '/api/staff-customer-notes' && m === 'GET') { const lot = u.searchParams.get('reservationIds'); const s = (id) => ({ eligible: true, clientKey: 'p:qa' + id, note: null }); if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), s(Number(id))])) }); return J({ ok: true, ...s(Number(u.searchParams.get('reservationId'))) }); }
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || JOUR; return J({ ok: true, revision: 'qa-' + d, reservations: jour(d), laneStatuses: {}, centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: JOUR, durationOptions: [], formules: [], center: null });
      if (u.pathname === '/api/ops') { if (u.searchParams.get('action') === 'centerConfig') return J({ ok: true, centers: [centre], activities: [] }); return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} }); }
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || JOUR; return J({ ok: true, reservations: jour(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const corps = JSON.parse(init.body || '{}');
        window.__PATCHS__.push(corps);
        let ici = null;
        for (const d of Object.keys(jours)) { const i = jours[d].findIndex((x) => String(x.id) === String(corps.id)); if (i >= 0) ici = [d, i]; }
        if (!ici) return J({ ok: false, error: 'introuvable' }, 404);
        const [d, i] = ici;
        if (corps.activityMove) {
          const resultat = await window.__qaActivityMove({ current: { ...jours[d][i], centerId: 'libramont' }, body: corps });
          if (!resultat.ok) return J(resultat, resultat.status || 422);
          jours[d][i] = resultat.reservation;
          return J(resultat);
        }
        if (corps.status) { jours[d][i] = { ...jours[d][i], status: corps.status, updatedAt: new Date().toISOString() }; return J({ ok: true, reservation: jours[d][i] }); }
        return J({ ok: false, error: 'non gere' }, 400);
      }
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, JOUR });
}

async function monter(browser, appareil, vue = 'bowling') {
  const ctx = await browser.newContext(appareil);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await installActivityMoveFixture(page);
  await installerMock(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(BASE_URL + '/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.loadStaffCenterConfig === 'function', null, { timeout: 60000 });
  await page.evaluate(async ({ JOUR, vue }) => {
    await ensureStaffConsolesLoaded();
    state.currentDate = JOUR; state.adminCenterId = 'libramont'; state.staffMenuPage = 'planning'; state.staffResourceView = vue; state.staffTheme = 'dark';
    state.searchTerm = ''; state.staffStatusFilter = 'all'; state.staffPlanningExpanded = false; state.staffLaserPlanningExpanded = false; state.staffTableExpanded = false;
    state.reservations = window.__JOUR__(JOUR).map((x) => ({ ...x }));
    setView('staff');
    while (staffCenterConfigCache.loading) await new Promise((r) => setTimeout(r, 25));
    await loadStaffCenterConfig(true);
    renderStaff();
  }, { JOUR, vue });
  await repos(page);
  return { ctx, page, cdp, erreurs };
}

// Attente bornee de la fin des animations et du reseau mocke.
async function repos(page, min = 400) {
  await page.waitForTimeout(min);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running') && !document.querySelector('[data-pl-anim]'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
}
async function metriques(cdp) { const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; metrics.forEach((m) => { o[m.name] = m.value; }); return o; }
// Compte les reconstructions (mutations de contenu) de chaque surface pendant `agir`.
async function reconstructions(page, agir) {
  await page.evaluate(() => {
    window.__recons = { planningGridWrap: 0, laserPlanningGridWrap: 0, resList: 0 };
    window.__reconsObs = Object.keys(window.__recons).map((id) => { const el = document.getElementById(id); const o = new MutationObserver((ms) => { if (ms.some((m) => m.type === 'childList' && m.target === el)) window.__recons[id] += 1; }); o.observe(el, { childList: true }); return o; });
  });
  await page.evaluate(agir);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
  return page.evaluate(() => { window.__reconsObs.forEach((o) => o.disconnect()); return window.__recons; });
}
// Le depart lu sous un point du planning Laser, comme le lit le depot
// (lpCibleSous : le rang sous le pointeur), et ce que le fantome annonce.
function heureSousLePoint(page, point) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const rang = el && el.closest('#laserPlanningGridWrap .lp-dep[data-lp-t]');
    return rang ? { heure: rang.dataset.lpT, debut: numToTime(Number(rang.dataset.lpT)), fantome: ((document.querySelector('.lp-fantome .lp-fantome__vers') || {}).textContent || '').trim() } : null;
  }, point);
}
// La bande ou le pointeur ne fait rien defiler : pendant un glisser, le
// planning Laser defile seul a moins de 96 px du haut de son cadre et du haut
// de la file « À placer » (lpDefilerDemarrer). Rend le premier depart qui
// prend la partie levee (is-cible) dans cette bande, ou null.
function departPermisALecran(page) {
  return page.evaluate(() => {
    const cadre = lpDefileur();
    const file = document.querySelector('#laserPlanningGridWrap .lp-file');
    if (!cadre || !file) return null;
    const r = cadre.getBoundingClientRect();
    const haut = Math.max(0, r.top) + 96 + 12;
    const bas = Math.min(innerHeight, r.bottom, file.getBoundingClientRect().top) - 96 - 12;
    for (const rang of document.querySelectorAll('#laserPlanningGridWrap .lp-dep.is-cible[data-lp-t]')) {
      const b = rang.querySelector('.lp-dep__jauge').getBoundingClientRect();
      const y = b.top + b.height / 2;
      if (y > haut && y < bas) return { x: b.left + Math.min(b.width / 2, 60), y, heure: rang.dataset.lpT };
    }
    return null;
  });
}
function relireHeure(page, unite) {
  return page.evaluate((unite) => {
    const r = state.reservations.find((x) => x.id === 7102);
    const w = r && getLaserWindowsFromReservation(r).find((x) => laserBlockUnitKey(x) === unite);
    return w ? numToTime(w.start) : null;
  }, unite);
}
const enHeures = (t) => { const [h, m] = String(t || '').split(':').map(Number); return h + m / 60; };
// La partie partie la ou on l a lachee : dans le depart vise, celui que le
// fantome annoncait sous le pointeur, envoyee telle quelle au serveur, et
// relue a cette heure.
function poseeOuVisee(attendu, visee, envoi, relu, unite) {
  return Boolean(attendu) && attendu.heure === visee
    && enHeures(attendu.debut) >= Number(visee) && enHeures(attendu.debut) < Number(visee) + 0.5
    && attendu.fantome.includes(`Vers ${attendu.debut}`)
    && envoi.some((m) => m && m.activityId === 'laser_game' && m.unitKey === unite && m.startTime === attendu.debut)
    && relu === attendu.debut;
}

let checks = 0;
const echecs = [];
function verifier(code, cond, label, detail) {
  checks += 1;
  console.log(`${cond ? 'OK  ' : 'FAIL'} [${code}] ${label}${detail !== undefined ? '  ->  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  if (!cond) echecs.push(code);
  return cond;
}

async function tablette(browser, seulement) {
  const veut = (c) => !seulement || seulement.includes(c);
  const { ctx, page, cdp, erreurs } = await monter(browser, TABLETTE, 'bowling');
  try {
    if (veut('A')) {
      const n = await reconstructions(page, () => { renderStaffData(); renderStaff(); if (typeof tickHorlogeStaff === 'function') tickHorlogeStaff(); });
      verifier('A', n.planningGridWrap === 0 && n.laserPlanningGridWrap === 0 && n.resList === 0, 'un re-rendu sans changement (sondage, rendu complet, tic) ne reconstruit aucune surface', n);
      // CE QUE LE MOTION ECRIT NE SALIT PAS LA SURFACE. Juste apres un rendu
      // qui change, le motion pose sur la liste ses classes (pl-in, pl-arrive,
      // couleur des compteurs), ses delais de cascade, le texte des compteurs
      // en course et le fantome de la carte partie : le rendu identique suivant
      // ne doit pas la reconstruire pour autant. Un dossier annule quitte la
      // liste : son fantome s en va, le compteur de la section descend. Le
      // montage verifie que le motion a bien ecrit tout ca avant ce rendu.
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'bowling' && r.status === 'confirmed').id);
      await page.evaluate(() => {
        const liste = document.getElementById('resList');
        window.__ecritsMotion = { compteurs: 0, fantome: 0, autres: 0 };
        window.__obsMotion = new MutationObserver((ms) => ms.forEach((m) => {
          if (m.type === 'childList' && m.target === liste) return;
          const cible = m.target.nodeType === 1 ? m.target : m.target.parentNode;
          if (cible && cible.closest('[data-pl-num]')) window.__ecritsMotion.compteurs += 1;
          else if ([...m.addedNodes, ...m.removedNodes].some((n) => n.nodeType === 1 && n.classList.contains('pl-fantome'))) window.__ecritsMotion.fantome += 1;
          else window.__ecritsMotion.autres += 1;
        }));
        window.__obsMotion.observe(liste, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      await page.evaluate((id) => applyOptimisticReservation({ ...state.reservations.find((r) => r.id === id), status: 'cancelled', updatedAt: new Date().toISOString() }), id);
      await repos(page, 1200);
      const ecrits = await page.evaluate(() => { window.__obsMotion.disconnect(); return window.__ecritsMotion; });
      const apres = await reconstructions(page, () => { renderStaffData(); renderStaff(); });
      verifier('A', ecrits.compteurs > 0 && ecrits.fantome > 0 && apres.resList === 0 && apres.planningGridWrap === 0, 'juste apres un changement, ce que le motion ecrit sur la liste (compteur qui descend, fantome de la carte partie) ne la fait pas reconstruire au rendu identique suivant', { ecrits, ...apres });
      const lignes = await page.evaluate(() => { PinlaneMotion.oublier(); PinlaneMotion.cascade(document); return document.querySelectorAll('#resList .pl-in').length; });
      await repos(page);
      const cascade = await reconstructions(page, () => { renderStaffData(); renderStaff(); });
      verifier('A', lignes >= 20 && cascade.resList === 0, 'une cascade rejouee (pl-in, delais) ne fait pas reconstruire la liste au rendu identique suivant', { lignes, ...cascade });
    }
    if (veut('B')) {
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'bowling' && r.status === 'confirmed').id);
      const n = await reconstructions(page, `applyOptimisticReservation({ ...state.reservations.find((r) => r.id === ${id}), status: 'arrived', updatedAt: new Date().toISOString() })`);
      // Au moins un bloc dessine : un « tous les blocs » sur une liste vide
      // serait vrai sans rien prouver.
      const vu = await page.evaluate((id) => { const blocs = [...document.querySelectorAll(`#planningGridWrap .booking[data-booking-res-id="${id}"]`)]; return { blocs: blocs.length, bloc: blocs.length > 0 && blocs.every((e) => e.classList.contains('arr')), carte: [...document.querySelectorAll(`#resList [data-res-row-id="${id}"] button`)].some((b) => /Carte|Espèces/.test(b.textContent)) }; }, id);
      verifier('B', vu.bloc && vu.carte, 'un dossier passe Arrivé se voit dans la grille ET dans la liste', vu);
      verifier('B', n.laserPlanningGridWrap === 0 && n.planningGridWrap >= 1 && n.resList >= 1, 'seules les surfaces qui le montrent se reconstruisent (la grille laser cachee reste)', n);
      await repos(page);
    }
    if (veut('C')) {
      const reste = await page.evaluate(() => {
        const carte = document.querySelector('#resList [data-res-row-id]');
        carte.classList.add('qa-touchee');
        renderStaff();
        return Boolean(document.querySelector('#resList .qa-touchee'));
      });
      verifier('C', !reste, 'une carte touchee depuis le rendu est reconstruite, meme a HTML identique');
      const texte = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#resList .gc-btn')].find((x) => x.textContent.trim() === 'Arrivé');
        if (!b) return 'absent';
        b.textContent = 'Enregistrement…';
        renderStaffData();
        return [...document.querySelectorAll('#resList .gc-btn')].some((x) => x.textContent.trim() === 'Enregistrement…') ? 'perime' : 'frais';
      });
      verifier('C', texte === 'frais', 'un texte reecrit sur place ne survit pas au rendu suivant', texte);
      await repos(page);
    }
    if (veut('D')) {
      // Cinq changements d etat d affilee, chacun compte du clic a l image
      // suivante (rendu, puis releve des cartes du motion). PLAFOND : quinze
      // mises en page pour les cinq, trois par changement en moyenne. Mesure
      // du 2026-10-07 : sain, une par changement (5 et 9 sur deux passes, un
      // changement isole est monte a 5) ; position relue au milieu du rendu
      // (contre-preuve « defilement »), 4 a 5 par changement, 21 au total.
      // L ancien plafond (deux pour UN changement) etait le minimum possible :
      // un accident isole le faisait rougir. La somme sur cinq absorbe deux
      // accidents et rougit des que chaque rendu repaie ses lectures.
      const ids = await page.evaluate(() => state.reservations.filter((r) => r.type === 'bowling' && r.status === 'confirmed').slice(0, 5).map((r) => r.id));
      const parChangement = [];
      for (const id of ids) {
        const m0 = await metriques(cdp);
        await page.evaluate((id) => applyOptimisticReservation({ ...state.reservations.find((r) => r.id === id), status: 'arrived', updatedAt: new Date().toISOString() }), id);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
        const m1 = await metriques(cdp);
        parChangement.push(m1.LayoutCount - m0.LayoutCount);
        await repos(page);
      }
      const total = parChangement.reduce((s, x) => s + x, 0);
      verifier('D', ids.length === 5 && total <= 3 * ids.length, 'cinq changements d etat se rendent en quinze mises en page au plus (trois en moyenne)', `${total} mise(s) en page pour ${ids.length} changements (${parChangement.join(', ')}), plafond ${3 * ids.length}`);
    }
    if (veut('E')) {
      const r = await page.evaluate(() => { state.staffResourceView = 'all'; renderStaff(); return document.querySelectorAll('#resList [data-pl-stagger] > *').length; });
      await repos(page, 600);
      // UNE ENTREE EN COURS (2026-10-08). Depuis que le motion retire pl-in a la
      // fin de l animation (2e684d8), une cascade rejouee sur des lignes au
      // repos n a rien a redemarrer : ni la lecture unique ni la contre-preuve
      // ne s executaient plus. E garde le REDEMARRAGE : une premiere cascade
      // remet les lignes en entree (sa mise en page soldee avant la mesure),
      // la cascade mesuree les relance pendant qu elles le sont encore.
      await page.evaluate(() => { PinlaneMotion.oublier(); PinlaneMotion.cascade(document); void document.documentElement.offsetWidth; });
      const m0 = await metriques(cdp);
      const { enEntree, decalees } = await page.evaluate(() => {
        const enEntree = document.querySelectorAll('#resList .pl-in').length;
        PinlaneMotion.oublier();
        PinlaneMotion.cascade(document);
        return { enEntree, decalees: document.querySelectorAll('#resList .pl-in').length };
      });
      const m1 = await metriques(cdp);
      const mises = m1.LayoutCount - m0.LayoutCount;
      verifier('E', enEntree >= 20, 'MONTAGE : la cascade est rejouee sur des lignes encore en entree', `${enEntree} lignes en entree sur ${r}`);
      verifier('E', decalees >= 20, 'MONTAGE : la cascade redemarre beaucoup de lignes', `${decalees} lignes decalees sur ${r}`);
      verifier('E', mises <= 2, 'la cascade redemarre toutes ses lignes en une seule lecture', `${mises} mise(s) en page pour ${decalees} lignes`);
      await repos(page);
    }
    if (veut('F')) {
      // Temps processeur du fil principal (ThreadTime), memes instants, cinq
      // alternances : un re-rendu sans changement contre un rendu qui change
      // tout (jour suivant, puis retour). Chaque mesure « sans changement »
      // suit le rendu complet ET la cascade que le motion y joue : elle ne
      // compte que si elle n a reconstruit aucune surface. La cascade rejoue
      // quand le debut des lignes change (heures et initiale du nom, 18
      // caracteres) : un vrai jour suivant change, le jeu de donnees d ici
      // garde les memes d un jour a l autre, d ou l oubli explicite.
      const cout = async (agir, arg) => { const m0 = await metriques(cdp); await page.evaluate(agir, arg); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))); const m1 = await metriques(cdp); return (m1.ThreadTime - m0.ThreadTime) * 1000; };
      await page.evaluate(() => { state.staffResourceView = 'bowling'; renderStaff(); });
      await repos(page);
      const identiques = [], complets = [], reconstruits = [];
      for (let i = 0; i < 5; i += 1) {
        complets.push(await cout((jour) => { state.currentDate = jour; state.reservations = window.__JOUR__(jour).map((x) => ({ ...x })); PinlaneMotion.oublier(); renderStaff(); }, i % 2 ? JOUR : LENDEMAIN));
        await repos(page, 150);
        // Les observateurs se posent hors de la fenetre mesuree.
        await page.evaluate(() => { window.__recF = 0; window.__obsF = ['planningGridWrap', 'laserPlanningGridWrap', 'resList'].map((id) => { const el = document.getElementById(id); const o = new MutationObserver((ms) => { if (ms.some((m) => m.type === 'childList' && m.target === el)) window.__recF += 1; }); o.observe(el, { childList: true }); return o; }); });
        identiques.push(await cout(() => { renderStaffData(); renderStaff(); }));
        reconstruits.push(await page.evaluate(() => { window.__obsF.forEach((o) => o.disconnect()); return window.__recF; }));
        await repos(page, 150);
      }
      const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      verifier('F', reconstruits.every((x) => x === 0), 'MONTAGE : chaque mesure « sans changement », juste apres un rendu complet et sa cascade, ne reconstruit aucune surface', reconstruits);
      const rapport = med(identiques) / Math.max(1, med(complets));
      verifier('F', rapport < 0.5, 'un re-rendu sans changement coute moins de la moitie d un rendu qui change tout', `${med(identiques).toFixed(0)} ms contre ${med(complets).toFixed(0)} ms (rapport ${rapport.toFixed(2)}, plafond 0,5)`);
      await page.evaluate((jour) => { state.currentDate = jour; state.reservations = window.__JOUR__(jour).map((x) => ({ ...x })); renderStaff(); }, JOUR);
      await repos(page);
    }
    if (veut('G')) {
      // Plein ecran, le planning Laser defile dans son cadre (lpDefileur).
      await page.evaluate(() => { state.staffResourceView = 'laser'; toggleLaserPlanningExpanded(); });
      await repos(page);
      const pose = await page.evaluate(() => { const c = lpDefileur(); if (!c || c.id !== 'laserPlanningGridWrap') return { cadre: c ? c.id || c.tagName : null, haut: -1 }; c.scrollTop = 400; return { cadre: c.id, haut: c.scrollTop }; });
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'laser' && r.status === 'confirmed' && r.id !== 7102).id);
      const n = await reconstructions(page, `(applyOptimisticReservation({ ...state.reservations.find((r) => r.id === ${id}), status: 'arrived', updatedAt: new Date().toISOString() }), renderStaff())`);
      await repos(page);
      const apres = await page.evaluate((id) => ({ haut: lpDefileur().scrollTop, arrive: [...document.querySelectorAll(`#laserPlanningGridWrap .lp-g[data-laser-res-id="${id}"]`)].some((g) => g.classList.contains('st-arr')) }), id);
      // Le rendu a bien change le planning (sinon garder sa position ne prouve rien).
      verifier('G', pose.cadre === 'laserPlanningGridWrap' && pose.haut > 300 && n.laserPlanningGridWrap >= 1 && apres.arrive, 'MONTAGE : planning plein ecran defile, et le rendu qui change le reconstruit (le groupe passe Arrivé)', { pose, ...n, arrive: apres.arrive });
      verifier('G', Math.abs(apres.haut - pose.haut) <= 1, 'le planning laser plein ecran garde sa position a travers un rendu qui change', { pose: pose.haut, apres: apres.haut });
      await page.evaluate(() => collapseStaffPlanningFullscreen());
      await repos(page);
    }
    if (veut('J')) {
      await page.evaluate(() => { state.staffResourceView = 'bowling'; renderStaff(); document.getElementById('planningBox').scrollIntoView({ block: 'start' }); });
      await repos(page);
      const cible = await page.evaluate(() => {
        const HH = parseFloat(getComputedStyle(document.getElementById('planningBox')).getPropertyValue('--planning-hour-h')) || 48;
        const el = [...document.querySelectorAll('#planningGridWrap .booking[data-booking-lane="4"]')].find((e) => { const r = e.getBoundingClientRect(); return r.top > 60 && r.bottom + HH < innerHeight - 40; });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id: Number(el.dataset.bookingResId), st: Number(el.dataset.bookingStart), x: r.left + r.width / 2, y: r.top + 12, dy: HH };
      });
      if (verifier('J', Boolean(cible), 'MONTAGE : une carte bowling de la piste 4 est a l ecran')) {
        await page.mouse.move(cible.x, cible.y);
        await page.mouse.down();
        await page.mouse.move(cible.x + 1, cible.y + 8);
        for (let i = 1; i <= 12; i += 1) { await page.mouse.move(cible.x + 1, cible.y + 8 + (cible.dy - 8) * i / 12); await page.waitForTimeout(16); }
        await page.mouse.up();
        const deplace = await page.waitForFunction(({ id, st }) => [...document.querySelectorAll(`#planningGridWrap .booking[data-booking-res-id="${id}"]`)].some((e) => Math.abs(Number(e.dataset.bookingStart) - (st + 1)) < 0.01), cible, { timeout: 10000 }).then(() => true, () => false);
        verifier('J', deplace, 'a la souris, la carte glissee d une heure est relue a sa nouvelle heure', cible);
      }
      await repos(page);
      await page.evaluate(() => { state.staffResourceView = 'all'; renderStaff(); });
      await repos(page);
      const id = await page.evaluate(() => { const r = state.reservations.find((x) => x.status === 'confirmed' && x.type === 'bowling' && document.querySelector(`#resList [data-res-row-id="${x.id}"]`)); return r && r.id; });
      const bouton = page.locator(`#resList [data-res-row-id="${id}"] button`).filter({ hasText: /^Arrivé$/ }).first();
      await bouton.scrollIntoViewIfNeeded();
      await bouton.click();
      const bascule = await page.waitForFunction((id) => state.reservations.find((x) => x.id === id).status === 'arrived' && [...document.querySelectorAll(`#resList [data-res-row-id="${id}"] button`)].some((b) => /Carte|Espèces/.test(b.textContent)), id, { timeout: 10000 }).then(() => true, () => false);
      verifier('J', bascule, '« Arrivé » cliqué bascule la carte en encaissement');
    }
    if (veut('K') || veut('L')) await laserPleinEcranTablette(page, veut);
    verifier('*', erreurs.length === 0, 'aucune erreur de page (tablette)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

// [K] et [L] : tablette, Laser plein ecran, a la souris. Le planning de la
// maquette E defile dans son cadre, la file « À placer » collee en bas sur
// toute la largeur. Pendant un glisser, il defile seul a moins de 96 px du
// haut du cadre et du haut de la file (lpDefilerDemarrer). Une partie se
// place en la glissant au bord bas, au-dessus de la file ; la meme partie,
// glissee SUR la file, vise la file : le planning ne bouge pas.
async function laserPleinEcranTablette(page, veut) {
  const hautPlanning = () => page.evaluate(() => lpDefileur().scrollTop);
  await page.evaluate(() => { collapseStaffPlanningFullscreen(); state.staffResourceView = 'laser'; renderStaff(); toggleLaserPlanningExpanded(); });
  await repos(page);
  // Le planning s arrete 450 px avant sa fin : la fin de soiree, ou les
  // departs prennent encore la partie de 7102, est sous le bord.
  const depart = await page.evaluate(() => {
    const cadre = lpDefileur();
    const jeton = document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="7102"]');
    if (!cadre || cadre.id !== 'laserPlanningGridWrap' || !jeton) return null;
    const max = cadre.scrollHeight - cadre.clientHeight;
    cadre.scrollTop = Math.max(0, max - 450);
    const c = jeton.getBoundingClientRect();
    return { haut: cadre.scrollTop, max, x: c.left + c.width / 2, y: c.top + c.height / 2, unite: jeton.dataset.laserUnit, avant: getPendingLaserPasses(state.currentDate).length, n0: window.__PATCHS__.length };
  });
  if (!verifier('K', Boolean(depart) && depart.max - depart.haut >= 300, 'MONTAGE : une partie a placer, et un planning qui peut encore defiler vers le bas', depart)) return;
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + 8, depart.y);
  // Levee, la partie fait grandir la file de sa barre « Où placer » : le bord
  // bas est 30 px au-dessus de la file, dans la zone de 96 px.
  const bord = await page.evaluate(() => { const f = document.querySelector('#laserPlanningGridWrap .lp-file').getBoundingClientRect(); return { x: Math.round(f.left + f.width / 2), y: Math.round(f.top - 30), leve: Boolean(lpEtat.glisse) }; });
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(depart.x + 8 + (bord.x - depart.x - 8) * i / 12, depart.y + (bord.y - depart.y) * i / 12); await page.waitForTimeout(16); }
  // Le pointeur reste au bord bas : le planning defile seul jusqu a sa fin.
  await page.waitForFunction(() => { const c = lpDefileur(); return c.scrollTop >= c.scrollHeight - c.clientHeight - 1; }, null, { timeout: 10000 }).catch(() => {});
  const defile = await hautPlanning();
  verifier('K', bord.leve && defile > depart.haut + 100, 'pointeur au bord bas du planning, au-dessus de la file : il defile sous la partie glissee', { leve: bord.leve, avant: depart.haut, apres: defile, max: depart.max });
  // Lachee hors de la zone du bord bas : le planning ne bouge plus.
  const cible = await departPermisALecran(page);
  if (!verifier('K', Boolean(cible), 'MONTAGE : un depart qui prend la partie, a l ecran, une fois le planning defile', cible)) { await page.mouse.up(); return; }
  for (let i = 1; i <= 8; i += 1) { await page.mouse.move(bord.x + (cible.x - bord.x) * i / 8, bord.y + (cible.y - bord.y) * i / 8); await page.waitForTimeout(16); }
  const attendu = await heureSousLePoint(page, cible);
  await page.mouse.up();
  const pose = await page.waitForFunction(({ n0, avant }) => window.__PATCHS__.length > n0 && getPendingLaserPasses(state.currentDate).length < avant, depart, { timeout: 10000 }).then(() => true, () => false);
  const envoi = await page.evaluate((n0) => window.__PATCHS__.slice(n0).map((b) => b.activityMove), depart.n0);
  const relu = await relireHeure(page, depart.unite);
  verifier('K', pose && poseeOuVisee(attendu, cible.heure, envoi, relu, depart.unite), 'la partie lachee se pose sur le depart vise, celui que le fantome annoncait, et se relit a cette heure', { attendu, envoi, relu });
  if (!veut('L') || !pose) return;

  await repos(page);
  // La partie posee, amenee entre les deux zones de bord (la file grandit de
  // sa barre, 54 px, une fois la partie levee) et saisie la. La molette,
  // pendant le glisser, remonte le planning, pour qu il ait de quoi defiler
  // vers le bas quand le pointeur arrive sur la file.
  const prise = await page.evaluate((unite) => {
    const cadre = lpDefileur();
    const g = document.querySelector(`#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="7102"][data-laser-unit="${unite}"]`);
    if (!cadre || !g) return null;
    const r = cadre.getBoundingClientRect();
    const haut = Math.max(0, r.top) + 96 + 12;
    const bas = document.querySelector('#laserPlanningGridWrap .lp-file').getBoundingClientRect().top - 54 - 96 - 12;
    for (let essai = 0; essai < 12; essai += 1) {
      const b = g.getBoundingClientRect();
      const ecart = (b.top + b.height / 2) - (haut + bas) / 2;
      if (Math.abs(ecart) <= 2) break;
      cadre.scrollTop += ecart;
    }
    const c = g.getBoundingClientRect();
    return { haut: Math.round(haut), bas: Math.round(bas), x: c.left + Math.min(40, c.width / 2), y: c.top + c.height / 2, n0: window.__PATCHS__.length };
  }, depart.unite);
  if (!verifier('L', Boolean(prise) && prise.y > prise.haut && prise.y < prise.bas, 'MONTAGE : la partie posee a l ecran, hors des zones de bord', prise)) return;
  await page.mouse.move(prise.x, prise.y);
  await page.mouse.down();
  await page.mouse.move(prise.x - 8, prise.y);
  await page.mouse.wheel(0, -300);
  // La molette a fini quand le planning ne bouge plus (trois lectures egales).
  let stable = 0;
  for (let essai = 0, haut = null; essai < 40 && stable < 3; essai += 1) { await page.waitForTimeout(50); const h = await hautPlanning(); stable = h === haut ? stable + 1 : 0; haut = h; }
  // Le pointeur saute dans la file (la bande au-dessus d elle ferait defiler
  // au passage), puis y descend jusqu au bas de l ecran.
  const file = await page.evaluate(() => { const f = document.querySelector('#laserPlanningGridWrap .lp-file').getBoundingClientRect(); return { x: Math.round(f.left + f.width / 2), haut: Math.round(f.top), bas: Math.round(f.bottom), leve: Boolean(lpEtat.glisse) }; });
  const BORD = Math.min(file.bas - 6, TABLETTE.viewport.height - 30);
  await page.mouse.move(file.x, file.haut + 12, { steps: 1 });
  const avant = await hautPlanning();
  for (let i = 1; i <= 6; i += 1) { await page.mouse.move(file.x, file.haut + 12 + (BORD - file.haut - 12) * i / 6); await page.waitForTimeout(16); }
  await page.waitForTimeout(700);
  const apres = await hautPlanning();
  const finale = await page.evaluate(() => { const c = lpDefileur(); return { max: c.scrollHeight - c.clientHeight, survol: Boolean(document.querySelector('#laserPlanningGridWrap .lp-file.is-survol')) }; });
  verifier('L', file.leve && stable >= 3 && finale.max - avant >= 100 && finale.survol && BORD > TABLETTE.viewport.height - 100, 'MONTAGE : la partie levee vise la file, au bas de l ecran, et le planning a de quoi defiler vers le bas', { leve: file.leve, stable, avant, max: finale.max, survol: finale.survol, bord: BORD });
  verifier('L', Math.abs(apres - avant) <= 1, 'sur la file, au bas de l ecran, le planning ne defile pas', { avant, apres });
  await page.mouse.up();
  const retire = await page.waitForFunction((avant) => getPendingLaserPasses(state.currentDate).length === avant, depart.avant, { timeout: 10000 }).then(() => true, () => false);
  const envoiL = await page.evaluate((n0) => window.__PATCHS__.slice(n0).map((b) => b.activityMove), prise.n0);
  verifier('L', retire && envoiL.some((m) => m && m.unplace === true && m.unitKey === depart.unite), 'lachee sur la file, la partie quitte le planning et revient « a placer »', envoiL);
  await page.evaluate(() => collapseStaffPlanningFullscreen());
  await repos(page);
}

async function telephone(browser, seulement) {
  const veut = (c) => !seulement || seulement.includes(c);
  const { ctx, page, cdp, erreurs } = await monter(browser, TELEPHONE, 'laser');
  try {
    const deborde = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    // Ce que le planning Laser (maquette E) montre sur le telephone : chaque
    // jauge (et sa derniere case : une case trop large deborde sans que la
    // grille bouge), chaque compte, le premier depart, la file « À placer ».
    const mesureLaser = () => page.evaluate(() => {
      const lp = document.querySelector('#laserPlanningGridWrap > .lp');
      if (!lp) return null;
      const larg = document.documentElement.clientWidth;
      const boite = (e) => { const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; };
      const vus = [...lp.querySelectorAll('.lp-dep .lp-cases, .lp-dep .lp-cases > i:last-child, .lp-dep .lp-dep__n')];
      const depassent = vus.filter((e) => { const b = e.getBoundingClientRect(); return b.right > larg + 0.5 || b.left < -0.5; }).slice(0, 4).map((e) => `${e.className || e.tagName} ${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}`);
      const premier = lp.querySelector('.lp-dep');
      const file = lp.querySelector('.lp-file');
      return { larg, haut: innerHeight, jauges: lp.querySelectorAll('.lp-dep .lp-cases').length, depassent, lp: boite(lp), premier: premier ? boite(premier) : null, file: file ? boite(file) : null };
    });
    if (veut('H')) {
      const normal = await mesureLaser();
      verifier('H', normal && normal.jauges > 0 && normal.depassent.length === 0 && normal.lp.right <= normal.larg + 1, 'Laser : le planning tient dans la largeur, jauges et comptes compris', normal);
      verifier('H', !(await deborde()), 'Laser : la page ne deborde pas de cote');
      await page.evaluate(() => toggleLaserPlanningExpanded());
      await repos(page);
      const plein = await mesureLaser();
      verifier('H', plein && plein.premier && plein.premier.width >= 300 && plein.premier.left >= 0 && plein.premier.right <= 391 && plein.premier.top < 844 - 200, 'Laser plein ecran : les departs prennent la largeur et restent a l ecran', plein && plein.premier);
      verifier('H', plein && plein.file && plein.premier && plein.file.top >= plein.premier.top && plein.file.bottom <= plein.haut + 1 && plein.file.top < plein.haut - 30 && plein.file.width >= 300, 'Laser plein ecran : la file « À placer » reste a l ecran, sous les departs', plein && { file: plein.file, premier: plein.premier, haut: plein.haut });
      verifier('H', plein && plein.jauges > 0 && plein.depassent.length === 0, 'Laser plein ecran : jauges et comptes se voient en entier', plein && plein.depassent);
      verifier('H', !(await deborde()), 'Laser plein ecran : la page ne deborde pas de cote');
    }
    if (veut('I')) {
      if (!(await page.evaluate(() => state.staffLaserPlanningExpanded))) { await page.evaluate(() => toggleLaserPlanningExpanded()); await repos(page); }
      const pos = await page.evaluate(() => {
        const jeton = document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="7102"]');
        if (!jeton) return null;
        const c = jeton.getBoundingClientRect();
        if (c.top < 0 || c.bottom > innerHeight) return { raison: `jeton ${Math.round(c.top)}-${Math.round(c.bottom)}, ecran ${innerHeight}` };
        return { de: { x: c.left + c.width / 2, y: c.top + c.height / 2 }, unite: jeton.dataset.laserUnit, avant: getPendingLaserPasses(state.currentDate).length };
      });
      if (verifier('I', Boolean(pos && pos.de), 'MONTAGE : une partie a placer a l ecran du telephone', pos)) {
        const doigt = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const n0 = await page.evaluate(() => window.__PATCHS__.length);
        await doigt('touchStart', [{ x: pos.de.x, y: pos.de.y, id: 1 }]);
        await page.waitForTimeout(450);
        // Levee, la partie fait grandir la file de sa barre. La journee chargee
        // remplit chaque demi-heure jusqu a 22 h 30 : les departs qui la
        // prennent encore sont surtout en fin de soiree, le planning y va (au
        // bout, il n a plus rien a defiler vers le bas : le doigt traverse la
        // bande du bas sans rien faire bouger).
        const vise = await page.evaluate(() => { const c = lpDefileur(); c.scrollTop = c.scrollHeight; return Boolean(lpEtat.glisse); });
        const vers = await departPermisALecran(page);
        let attendu = null;
        if (verifier('I', vise && Boolean(vers), 'MONTAGE : la partie est levee, et un depart qui la prend est a l ecran du telephone', { leve: vise, vers })) {
          for (let i = 1; i <= 16; i += 1) { await doigt('touchMove', [{ x: pos.de.x + (vers.x - pos.de.x) * i / 16, y: pos.de.y + (vers.y - pos.de.y) * i / 16, id: 1 }]); await page.waitForTimeout(20); }
          await page.waitForTimeout(120);
          attendu = await heureSousLePoint(page, vers);
        }
        await doigt('touchEnd', []);
        const pose = await page.waitForFunction(({ n0, avant }) => window.__PATCHS__.length > n0 && getPendingLaserPasses(state.currentDate).length < avant, { n0, avant: pos.avant }, { timeout: 10000 }).then(() => true, () => false);
        const envoi = await page.evaluate((n0) => window.__PATCHS__.slice(n0).map((b) => b.activityMove), n0);
        const relu = await relireHeure(page, pos.unite);
        verifier('I', pose && Boolean(vers) && poseeOuVisee(attendu, vers.heure, envoi, relu, pos.unite), 'au doigt, la partie glissee sur un depart y est posee, celui que le fantome annoncait sous le doigt', { attendu, envoi, relu });
      }
      await page.evaluate(() => collapseStaffPlanningFullscreen());
      await repos(page);
    }
    if (veut('H')) {
      for (const [vue, plein] of [['bowling', false], ['bowling', true], ['all', false]]) {
        await page.evaluate(({ vue, plein }) => { collapseStaffPlanningFullscreen(); state.staffResourceView = vue; renderStaff(); if (plein) togglePlanningExpanded(); }, { vue, plein });
        await repos(page);
        verifier('H', !(await deborde()), `${vue === 'all' ? 'Toutes les reservations' : 'Bowling'}${plein ? ' plein ecran' : ''} : la page ne deborde pas de cote`);
      }
    }
    verifier('*', erreurs.length === 0, 'aucune erreur de page (telephone)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

async function passe(browser, seulement) {
  if (!seulement || seulement.some((c) => CODES_TABLETTE.includes(c))) await tablette(browser, seulement);
  if (!seulement || seulement.some((c) => CODES_TELEPHONE.includes(c))) await telephone(browser, seulement);
}

const option = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a === undefined ? null : (a.split('=')[1] || ''); };

(async () => {
  const contrePreuves = option('contre-preuves');
  const seulement = option('seulement') ? option('seulement').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : null;
  const server = await servir();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (contrePreuves === null) {
      await passe(browser, seulement);
      if (echecs.length) throw new Error(`${echecs.length} verification(s) rouge(s) : ${[...new Set(echecs)].join(', ')}`);
      console.log(`OK : ${checks} verifications, console fluide et planning Laser tenu sur telephone.`);
      return;
    }
    const noms = contrePreuves ? contrePreuves.split(',').map((n) => n.trim()).filter(Boolean) : Object.keys(MUTATIONS);
    const inconnues = noms.filter((n) => !MUTATIONS[n]);
    if (inconnues.length) throw new Error(`contre-preuve(s) inconnue(s) : ${inconnues.join(', ')}`);
    const manquees = [];
    for (const nom of noms) {
      const def = MUTATIONS[nom];
      casse = nom;
      echecs.length = 0;
      console.log(`\n-- contre-preuve « ${nom} » : doit rougir sur ${def[3].join(', ')}`);
      await passe(browser, def[3]);
      const attrape = def[3].every((code) => echecs.includes(code));
      console.log(`${attrape ? 'OK  ' : 'FAIL'} la contre-preuve « ${nom} » fait rougir ${def[3].join(', ')}`);
      if (!attrape) manquees.push(nom);
    }
    casse = null;
    if (manquees.length) throw new Error(`contre-preuve(s) non detectee(s) : ${manquees.join(', ')}`);
    console.log(`OK : les ${noms.length} contre-preuves rougissent la ou elles doivent.`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
