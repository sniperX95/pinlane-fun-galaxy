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
//       ne reconstruit aucune des trois surfaces ;
//   [B] un dossier qui change se voit, et seule la surface qui le montre se
//       reconstruit (la grille cachee reste) ;
//   [C] une surface touchee depuis son rendu (classe posee par un geste, texte
//       reecrit) se reconstruit meme si son HTML est identique : jamais d etat
//       perime ;
//   [D] un rendu ne force pas de mise en page au milieu de ses ecritures : au
//       plus deux mises en page pour un changement d etat, rendu et image ;
//   [E] la cascade du motion redemarre ses lignes en une seule lecture, quel
//       que soit leur nombre ;
//   [F] RATIO : un re-rendu sans changement coute moins de la moitie d un
//       rendu qui change tout (temps processeur du fil principal, memes
//       instants) ;
//   [G] le defilement de la timeline laser et de la liste survit au rendu ;
//   [H] telephone 390 px : le planning Laser (normal et plein ecran) tient dans
//       la largeur, la file « Parties a placer » au-dessus de la grille, aucune
//       page ne deborde de cote ;
//   [I] au doigt sur telephone : appui long sur une partie a placer, glisser
//       sur une tranche libre, la partie y est posee (vrai transformateur
//       lib/reservation-activity-move.js) ;
//   [J] a la souris sur tablette : une carte bowling glissee d une heure est
//       relue a sa nouvelle heure ; « Arrivé » bascule la carte.
//
// Contre-preuves : node scripts/staff-console-perf-check.js --contre-preuves
// Le fichier servi est casse expres (en memoire, le disque n est jamais
// touche) et la verification visee doit rougir :
//   surface    -> poserHtmlSurface reconstruit toujours        [A] et [F]
//   touchee    -> une surface touchee passe pour intacte        [C]
//   defilement -> la position se relit au milieu du rendu       [D]
//   cascade    -> une lecture forcee par ligne dans la cascade  [E]
//   telephone  -> le bloc telephone du planning Laser retire    [H]
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
const JOUR = '2026-10-10';

// [fichier, ancre, remplacement] : chaque ancre doit exister une seule fois.
const MUTATIONS = {
  surface: ['assets/app-main.js', '    if (!suivi.touchee && suivi.html === html) return false;', '    if (false) return false;', ['A', 'F']],
  touchee: ['assets/app-main.js', "  return mutations.some((m) => m.type === 'childList' || m.target !== conteneur);", '  return false;', ['C']],
  defilement: ['assets/app-main.js', '  const connu = lot && (lot.aPoser.get(el) || lot.lus.get(el));', '  const connu = null;', ['D']],
  cascade: ['assets/pinlane-motion.js', "      if (aDecaler[r][0].classList.contains('pl-in')) { aDecaler[r][0].classList.remove('pl-in'); relancer = true; }", "      if (aDecaler[r][0].classList.contains('pl-in')) { aDecaler[r][0].classList.remove('pl-in'); void aDecaler[r][0].offsetWidth; }", ['E']],
  telephone: ['assets/pinlane-staff.css', '  .laser-planning-box.expanded .planning-grid-wrap {\n    display: flex;\n    flex-direction: column;\n  }', '', ['H']],
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
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 8000 }).catch(() => {});
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
    }
    if (veut('B')) {
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'bowling' && r.status === 'confirmed').id);
      const n = await reconstructions(page, `applyOptimisticReservation({ ...state.reservations.find((r) => r.id === ${id}), status: 'arrived', updatedAt: new Date().toISOString() })`);
      const vu = await page.evaluate((id) => ({ bloc: [...document.querySelectorAll(`#planningGridWrap .booking[data-booking-res-id="${id}"]`)].every((e) => e.classList.contains('arr')), carte: [...document.querySelectorAll(`#resList [data-res-row-id="${id}"] button`)].some((b) => /Carte|Espèces/.test(b.textContent)) }), id);
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
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'bowling' && r.status === 'confirmed').id);
      const m0 = await metriques(cdp);
      await page.evaluate((id) => applyOptimisticReservation({ ...state.reservations.find((r) => r.id === id), status: 'arrived', updatedAt: new Date().toISOString() }), id);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
      const m1 = await metriques(cdp);
      const mises = m1.LayoutCount - m0.LayoutCount;
      verifier('D', mises <= 2, 'un changement d etat se rend avec au plus deux mises en page (rendu + image)', `${mises} mise(s) en page`);
      await repos(page);
    }
    if (veut('E')) {
      const r = await page.evaluate(() => { state.staffResourceView = 'all'; renderStaff(); return document.querySelectorAll('#resList [data-pl-stagger] > *').length; });
      await repos(page, 600);
      const m0 = await metriques(cdp);
      const decalees = await page.evaluate(() => { PinlaneMotion.oublier(); PinlaneMotion.cascade(document); return document.querySelectorAll('#resList .pl-in').length; });
      const m1 = await metriques(cdp);
      const mises = m1.LayoutCount - m0.LayoutCount;
      verifier('E', decalees >= 20, 'MONTAGE : la cascade redemarre beaucoup de lignes', `${decalees} lignes decalees sur ${r}`);
      verifier('E', mises <= 2, 'la cascade redemarre toutes ses lignes en une seule lecture', `${mises} mise(s) en page pour ${decalees} lignes`);
      await repos(page);
    }
    if (veut('F')) {
      // Temps processeur du fil principal (ThreadTime), memes instants, cinq
      // alternances : un re-rendu sans changement contre un rendu qui change
      // tout (jour suivant, puis retour).
      const cout = async (agir, arg) => { const m0 = await metriques(cdp); await page.evaluate(agir, arg); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))); const m1 = await metriques(cdp); return (m1.ThreadTime - m0.ThreadTime) * 1000; };
      await page.evaluate(() => { state.staffResourceView = 'bowling'; renderStaff(); });
      await repos(page);
      const identiques = [], complets = [];
      for (let i = 0; i < 5; i += 1) {
        complets.push(await cout((jour) => { state.currentDate = jour; state.reservations = window.__JOUR__(jour).map((x) => ({ ...x })); renderStaff(); }, i % 2 ? '2026-10-10' : '2026-10-11'));
        await repos(page, 150);
        identiques.push(await cout(() => { renderStaffData(); renderStaff(); }));
        await repos(page, 150);
      }
      const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const rapport = med(identiques) / Math.max(1, med(complets));
      verifier('F', rapport < 0.5, 'un re-rendu sans changement coute moins de la moitie d un rendu qui change tout', `${med(identiques).toFixed(0)} ms contre ${med(complets).toFixed(0)} ms (rapport ${rapport.toFixed(2)}, plafond 0,5)`);
      await page.evaluate(() => { state.currentDate = '2026-10-10'; state.reservations = window.__JOUR__('2026-10-10').map((x) => ({ ...x })); renderStaff(); });
      await repos(page);
    }
    if (veut('G')) {
      await page.evaluate(() => { state.staffResourceView = 'laser'; toggleLaserPlanningExpanded(); });
      await repos(page);
      const pose = await page.evaluate(() => { const a = document.querySelector('#laserPlanningGridWrap .laser-agenda'); a.scrollTop = 400; return a.scrollTop; });
      const id = await page.evaluate(() => state.reservations.find((r) => r.type === 'laser' && r.status === 'confirmed' && r.id !== 7102).id);
      await page.evaluate((id) => applyOptimisticReservation({ ...state.reservations.find((r) => r.id === id), status: 'arrived', updatedAt: new Date().toISOString() }), id);
      await page.evaluate(() => renderStaff());
      await repos(page);
      const apres = await page.evaluate(() => document.querySelector('#laserPlanningGridWrap .laser-agenda').scrollTop);
      verifier('G', pose > 300 && Math.abs(apres - pose) <= 1, 'la timeline laser plein ecran garde sa position a travers un rendu qui change', { pose, apres });
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
    verifier('*', erreurs.length === 0, 'aucune erreur de page (tablette)', erreurs.slice(0, 3));
  } finally { await ctx.close(); }
}

async function telephone(browser, seulement) {
  const veut = (c) => !seulement || seulement.includes(c);
  const { ctx, page, cdp, erreurs } = await monter(browser, TELEPHONE, 'laser');
  try {
    const geo = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), scrollW: e.scrollWidth, clientW: e.clientWidth }; }, sel);
    const deborde = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (veut('H')) {
      const wrap = await geo('#laserPlanningGridWrap');
      const cap = await geo('#laserPlanningGridWrap .laser-agenda-row .laser-agenda-capacity');
      verifier('H', wrap && wrap.scrollW <= wrap.clientW + 1 && cap && cap.right <= 390, 'Laser : l agenda tient dans la largeur, colonne Capacite comprise', { wrap, cap });
      verifier('H', !(await deborde()), 'Laser : la page ne deborde pas de cote');
      await page.evaluate(() => toggleLaserPlanningExpanded());
      await repos(page);
      const agenda = await geo('#laserPlanningGridWrap .laser-agenda');
      const file = await geo('#laserPlanningGridWrap .laser-pass-queue');
      const capP = await geo('#laserPlanningGridWrap .laser-agenda-row .laser-agenda-capacity');
      verifier('H', agenda && agenda.width >= 300 && agenda.left >= 0 && agenda.right <= 391 && agenda.top < 844 - 200, 'Laser plein ecran : la grille des heures prend la largeur et reste a l ecran', agenda);
      verifier('H', file && agenda && file.bottom <= agenda.top + 1 && file.width >= 300, 'Laser plein ecran : la file « Parties a placer » est au-dessus de la grille', { file, agenda });
      verifier('H', capP && capP.right <= 391, 'Laser plein ecran : la colonne Capacite se voit', capP);
      verifier('H', !(await deborde()), 'Laser plein ecran : la page ne deborde pas de cote');
    }
    if (veut('I')) {
      if (!(await page.evaluate(() => state.staffLaserPlanningExpanded))) { await page.evaluate(() => toggleLaserPlanningExpanded()); await repos(page); }
      // La journee chargee remplit chaque demi-heure jusqu a 22 h 30 : les
      // tranches libres sont en fin de soiree, la timeline y defile d abord.
      await page.evaluate(() => { const a = document.querySelector('#laserPlanningGridWrap .laser-agenda'); a.scrollTop = a.scrollHeight; });
      await page.waitForTimeout(150);
      const pos = await page.evaluate(() => {
        const carte = document.querySelector('#laserPlanningGridWrap .laser-pass-card[data-laser-res-id="7102"]');
        const agenda = document.querySelector('#laserPlanningGridWrap .laser-agenda');
        const rangee = [...document.querySelectorAll('#laserPlanningGridWrap .laser-agenda-row[data-laser-time-start]')].find((r) => { const b = r.getBoundingClientRect(); const a = agenda.getBoundingClientRect(); return r.querySelector('.laser-session-slot.is-empty:not(.is-busy)') && b.top > a.top + 40 && b.bottom < a.bottom - 20; });
        if (!carte || !rangee) return null;
        const c = carte.getBoundingClientRect(); const s = rangee.querySelector('.laser-session-slot').getBoundingClientRect();
        return { de: { x: c.left + c.width / 2, y: c.top + c.height / 2 }, vers: { x: s.left + s.width / 2, y: s.top + Math.min(12, s.height / 2) }, heure: rangee.dataset.laserTimeStart, avant: getPendingLaserPasses(state.currentDate).length };
      });
      if (verifier('I', Boolean(pos), 'MONTAGE : une partie a placer et une tranche libre a l ecran du telephone', pos)) {
        const doigt = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const n0 = await page.evaluate(() => window.__PATCHS__.length);
        await doigt('touchStart', [{ x: pos.de.x, y: pos.de.y, id: 1 }]);
        await page.waitForTimeout(450);
        for (let i = 1; i <= 16; i += 1) { await doigt('touchMove', [{ x: pos.de.x + (pos.vers.x - pos.de.x) * i / 16, y: pos.de.y + (pos.vers.y - pos.de.y) * i / 16, id: 1 }]); await page.waitForTimeout(20); }
        await page.waitForTimeout(120);
        await doigt('touchEnd', []);
        const pose = await page.waitForFunction(({ n0, avant }) => window.__PATCHS__.length > n0 && getPendingLaserPasses(state.currentDate).length < avant, { n0, avant: pos.avant }, { timeout: 10000 }).then(() => true, () => false);
        const envoi = await page.evaluate((n0) => window.__PATCHS__.slice(n0).map((b) => b.activityMove), n0);
        verifier('I', pose && envoi.some((m) => m && m.activityId === 'laser_game'), 'au doigt, la partie glissee sur une tranche libre y est posee', { envoi, heure: pos.heure });
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
  await tablette(browser, seulement);
  await telephone(browser, seulement);
}

(async () => {
  const contrePreuves = process.argv.includes('--contre-preuves');
  const server = await servir();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    if (!contrePreuves) {
      await passe(browser, null);
      if (echecs.length) throw new Error(`${echecs.length} verification(s) rouge(s) : ${[...new Set(echecs)].join(', ')}`);
      console.log(`OK : ${checks} verifications, console fluide et planning Laser tenu sur telephone.`);
      return;
    }
    const manquees = [];
    for (const [nom, def] of Object.entries(MUTATIONS)) {
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
    console.log(`OK : les ${Object.keys(MUTATIONS).length} contre-preuves rougissent la ou elles doivent.`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
