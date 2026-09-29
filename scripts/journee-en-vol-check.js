#!/usr/bin/env node
'use strict';
// =============================================================================
// LA JOURNEE DEMANDEE PENDANT UNE LECTURE EN VOL (2026-09-29)
// -----------------------------------------------------------------------------
// Campagne de reservations sur banc local : le planning d un second samedi
// mettait 4 s a montrer ses dossiers, 0,2 s pour le premier. La console
// (syncDateReservations) abandonnait en silence toute demande faite pendant
// qu une autre lecture de staff-state etait en vol : le jour choisi attendait
// le tour suivant de la boucle de secours (4 s sans pouls, 15 s quand le pouls
// vit). Deux clics sur « jour suivant » suffisaient, et un changement de centre
// gardait la journee de l ancien.
//
//   [A] deux jours choisis coup sur coup : le second arrive, lu apres le
//       premier, et s affiche au planning ;
//   [B] qui attend une journee demandee pendant une lecture recoit sa vraie
//       reponse (creation rapide, ouverture de session) ;
//   [C] un changement de centre pendant une lecture : la reponse de l ancien
//       centre ne s affiche jamais sur le nouveau, la journee du nouveau arrive ;
//   [E] contre-epreuves sur le bundle servi : sans la file d attente, [A] et
//       [B] rougissent ; sans la garde du centre, [C] rougit.
//
// La boucle de secours est arretee avant les mesures : ce qui arrive ne peut
// venir que de la regle mesuree. Aucune base, aucun envoi.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_JOURNEE_EN_VOL_PORT || 4417);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}

// Le bundle servi : celui du disque, ou une copie mutee en memoire (le disque
// n est jamais touche).
let appMute = null;
function serveur() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (appMute !== null && url.pathname === '/assets/app-main.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(appMute);
      return;
    }
    let fichier = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') fichier = path.join(ROOT, 'index.html');
    if (!fichier.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (erreur, contenu) => {
      if (erreur) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(contenu);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Des jours apres aujourd hui : une date de travail future est conservee.
function jour(delta) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const J0 = jour(20), J1 = jour(21), J2 = jour(22), J3 = jour(23), J4 = jour(24), J5 = jour(25);

// La session, la date de travail et un staff-state double : deux dossiers par
// centre et par jour, nommes d apres eux, avec un delai reglable par lecture.
// Toute lecture est notee (date, centre, envoi, reception).
async function installer(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ exp, j0 }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.create', 'reservations.edit', 'clients.view', 'settings.manage', 'centers.switch'];
    const session = {
      token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt: exp,
      member: { id: 'libramont:qa', name: 'QA' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms,
    };
    try {
      localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
      localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'planning', adminCenterId: 'libramont', currentDate: j0 }));
    } catch (e) { /* stockage indisponible : le boot le dira */ }
    window.__QA_LECTURES__ = [];
    window.__QA_DELAIS__ = {};
    const ids = {};
    const J = (corps, entetes) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(entetes || {}) } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const brut = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(brut, window.location.origin);
      if (!u.pathname.startsWith('/api/')) return nf(input, init);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session });
      if (u.pathname === '/api/staff-state') {
        const date = u.searchParams.get('date') || '';
        const centre = u.searchParams.get('centerId') || '';
        const lecture = { date, centre, envoi: performance.now(), recu: 0 };
        window.__QA_LECTURES__.push(lecture);
        const delai = Number(window.__QA_DELAIS__[`${centre}|${date}`]) || 0;
        if (delai) await new Promise((fin) => setTimeout(fin, delai));
        lecture.recu = performance.now();
        const cle = `${centre}|${date}`;
        if (!ids[cle]) ids[cle] = 1000 + Object.keys(ids).length * 10;
        const reservations = [1, 2].map((n) => ({
          id: ids[cle] + n, date, centerId: centre, startTime: `1${n + 3}:00`, duration: 1, totalDuration: 1, pax: 4,
          name: `Client ${centre} ${date} ${n}`, phone: '', email: '', status: 'confirmed', validationStatus: 'confirmed',
          type: 'bowling', lanes: [n], laneCount: 1, price: 39,
        }));
        return J({ ok: true, reservations, laneStatuses: {} }, { ETag: `"${cle}-${Math.round(lecture.envoi)}"` });
      }
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today: '', durationOptions: [], formules: [], laserOptions: [], bowlingPrices: {},
          activities: [{ id: 'bowling', name: 'Bowling', resourceType: 'bowling_lane', priceType: 'grid_bowling', planned: true, order: 1 }],
          center: { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', offerAvailability: {}, booking: { laneCount: 8 } },
        });
      }
      if (u.pathname === '/api/public-availability') return J({ ok: true, slots: [], program: null });
      if (u.pathname === '/api/ops') {
        const action = u.searchParams.get('action');
        const centres = [
          { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: { bowling: { laneCount: 8 } } },
          { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', clientId: 'fungalaxy', clientName: 'Fun Galaxy', resources: { bowling: { laneCount: 8 } } },
        ];
        if (action === 'menuCenters') return J({ ok: true, owner: false, centers: centres });
        if (action === 'centerConfig') return J({ ok: true, centers: centres.map((c) => ({ ...c, timezone: 'Europe/Brussels' })), activities: [] });
        return J({ ok: true, items: [], rows: [], formulas: [], activities: [], blocks: [], entries: [] });
      }
      return J({ ok: true });
    };
  }, { exp: expiresAt, j0: J0 });
}

// Console ouverte sur J0 et ses dossiers, boucle de secours arretee, aucune
// lecture en vol.
async function ouvrir(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await installer(page);
  await page.goto(`${BASE_URL}/?v=journee-en-vol`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof setStaffDateFromPicker === 'function' && typeof syncDateReservations === 'function', null, { timeout: 20000 });
  await page.evaluate((j0) => { setView('staff'); if (typeof setMenuPage === 'function') setMenuPage('planning'); setStaffDateFromPicker(j0); }, J0);
  const pret = await page.waitForFunction((j0) => state.reservations.some((r) => r.date === j0), J0, { timeout: 15000 }).then(() => true, () => false);
  await page.evaluate(() => { window.scheduleRemoteSync = function () {}; clearTimeout(remoteSyncTimer); });
  await page.waitForFunction(() => !remoteSyncBusy && remoteSyncEnAttente.size === 0, null, { timeout: 10000 }).catch(() => {});
  return { ctx, page, erreurs, pret };
}
const auRepos = (page) => page.waitForFunction(() => !remoteSyncBusy && remoteSyncEnAttente.size === 0, null, { timeout: 10000 }).then(() => true, () => false);

// [A] Deux jours coup sur coup : J1 met 1,2 s a venir, J2 est demande pendant.
async function mesurerA(page) {
  const r = await page.evaluate(async ({ j1, j2 }) => {
    window.__QA_DELAIS__[`libramont|${j1}`] = 1200;
    const t0 = performance.now();
    setStaffDateFromPicker(j1);
    setStaffDateFromPicker(j2);
    while (performance.now() - t0 < 6000 && !state.reservations.some((x) => x.date === j2)) await new Promise((fin) => setTimeout(fin, 50));
    const lectures = window.__QA_LECTURES__.filter((l) => l.envoi >= t0);
    const l1 = lectures.find((l) => l.date === j1);
    const l2 = lectures.find((l) => l.date === j2);
    return {
      noms: state.reservations.filter((x) => x.date === j2).map((x) => x.name),
      courant: state.currentDate,
      ordre: lectures.map((l) => l.date),
      apresJ1: l1 && l2 ? Math.round(l2.envoi - l1.recu) : null,
    };
  }, { j1: J1, j2: J2 });
  r.ecran = r.noms.length
    ? await page.waitForFunction((nom) => document.body.innerText.includes(nom), r.noms[0], { timeout: 4000 }).then(() => true, () => false)
    : false;
  return r;
}
function jugerA(r) {
  return r.courant === J2 && r.noms.length === 2 && r.apresJ1 !== null && r.apresJ1 >= 0 && r.ordre.filter((d) => d === J2).length === 1;
}

// [B] Une journee attendue (await) pendant qu une autre est en vol.
async function mesurerB(page) {
  return page.evaluate(async ({ j3, j4 }) => {
    window.__QA_DELAIS__[`libramont|${j3}`] = 800;
    syncDateReservations(j3, { silent: true, skipRender: true });
    const enVol = remoteSyncBusy;
    await syncDateReservations(j4, { silent: true, skipRender: true });
    return { enVol, presents: state.reservations.filter((x) => x.date === j4).length };
  }, { j3: J3, j4: J4 });
}
const jugerB = (r) => r.enVol === true && r.presents === 2;

// [C] Libramont lit J5 (1 s) quand la console passe a Gembloux, comme la
// bascule de centre du menu : centre change, puis relecture de la journee.
// La lecture de Gembloux prend 300 ms, comme un vrai aller-retour : a zero,
// une journee etrangere appliquee puis remplacee dans la meme rafale de
// microtaches ne serait jamais observable, et la garde jamais prouvee.
async function mesurerC(page) {
  return page.evaluate(async ({ j5 }) => {
    window.__QA_DELAIS__[`libramont|${j5}`] = 1000;
    window.__QA_DELAIS__[`gembloux|${j5}`] = 300;
    setStaffDateFromPicker(j5);
    await new Promise((fin) => setTimeout(fin, 100));
    state.adminCenterId = 'gembloux';
    syncDateReservations(state.currentDate, { silent: true });
    const vus = new Set();
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      state.reservations.filter((x) => x.date === j5).forEach((x) => vus.add(x.centerId));
      if (performance.now() - t0 > 1600 && !remoteSyncBusy && remoteSyncEnAttente.size === 0) break;
      await new Promise((fin) => setTimeout(fin, 20));
    }
    return { vus: [...vus], final: [...new Set(state.reservations.filter((x) => x.date === j5).map((x) => x.centerId))] };
  }, { j5: J5 });
}
const jugerC = (r) => r.vus.length === 1 && r.vus[0] === 'gembloux' && r.final.length === 1 && r.final[0] === 'gembloux';

async function mesurerTout(browser) {
  const o = await ouvrir(browser);
  try {
    const a = await mesurerA(o.page);
    await auRepos(o.page);
    const b = await mesurerB(o.page);
    await auRepos(o.page);
    const c = await mesurerC(o.page);
    return { pret: o.pret, erreurs: o.erreurs, a, b, c };
  } finally { await o.ctx.close(); }
}

const MUTATIONS = [
  {
    nom: 'sans la file d attente (la demande en vol abandonnee, comme avant)',
    de: '    return new Promise((resolve) => attente.resolveurs.push(resolve));',
    vers: '    remoteSyncEnAttente.delete(dateStr); return false;',
    rougit: (m) => !jugerA(m.a) && !jugerB(m.b),
  },
  {
    nom: 'sans la garde du centre (la reponse de l ancien centre s applique)',
    de: '    if (encodeURIComponent(getCurrentStaffCenterId()) !== centerId) {',
    vers: '    if (false) {',
    rougit: (m) => !jugerC(m.c),
  },
];

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const m = await mesurerTout(browser);
    console.log(`[jours] ${J1} puis ${J2} ; ${J3} en vol, ${J4} attendu ; ${J5} pendant la bascule de centre`);
    ok(m.pret, 'MONTAGE : la console ouvre sa journee de travail avec ses dossiers');
    ok(jugerA(m.a), '[A] deux jours choisis coup sur coup : le second arrive, lu juste apres le premier', JSON.stringify({ noms: m.a.noms.length, ordre: m.a.ordre, apresJ1ms: m.a.apresJ1 }));
    ok(m.a.ecran, '[A] et le planning le montre', m.a.noms[0] || '');
    ok(jugerB(m.b), '[B] qui attend une journee demandee pendant une lecture recoit sa vraie reponse', JSON.stringify(m.b));
    ok(jugerC(m.c), '[C] bascule de centre pendant une lecture : jamais la journee de l ancien, celle du nouveau arrive', JSON.stringify(m.c));
    ok(m.erreurs.length === 0, 'aucune erreur dans la page', m.erreurs.join(' | '));

    console.log('\n[E] CONTRE-EPREUVES sur le bundle servi (le disque n est pas touche)');
    const source = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8');
    for (const mut of MUTATIONS) {
      const n = source.split(mut.de).length - 1;
      if (!ok(n === 1, `contre-epreuve montable : ancre unique (${mut.nom})`, `${n} occurrence(s)`)) continue;
      appMute = source.split(mut.de).join(mut.vers);
      let mesure = null;
      try { mesure = await mesurerTout(browser); } finally { appMute = null; }
      ok(Boolean(mesure && mesure.pret) && mut.rougit(mesure), `${mut.nom} : ce gate ROUGIRAIT`, JSON.stringify(mesure && { a: mesure.a.noms.length, b: mesure.b.presents, c: mesure.c.vus }));
    }
    ok(appMute === null && fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8') === source, 'assets/app-main.js intact sur le disque');
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'journee-en-vol-check: ALL OK' : `journee-en-vol-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
