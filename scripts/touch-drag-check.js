// Test INTERACTIF du glisser-deposer AU DOIGT (2026-09-11). Movsar : « tout ce
// qui est drag and drop ca fonctionne pas pour genre tablette tactile ». Les
// cartes du planning ne suivaient que la souris (mousedown, mousemove) : au
// doigt, le navigateur fait defiler la page et ces evenements ne partent
// jamais. Le tableau d analyse suivait le pointeur, mais seule sa petite
// poignee bloquait le defilement : attraper la carte ne faisait rien.
//
// Les gestes sont de VRAIS gestes tactiles : Input.dispatchTouchEvent du
// protocole DevTools, que le navigateur traite comme un doigt (defilement
// natif, evenements pointeur, clic emule apres un tap). Tablette paysage
// 1180 x 820, ecran tactile, Edge headless. Le chemin souris a son propre gate
// (laser-drag-check, analytics-board-check) : celui-ci ne le remplace pas.
//
// Scenarios :
//   A. Bowling : appui long puis glisser = la carte change de piste et d heure,
//      et la page ne bouge pas sous le doigt.
//   B. Bowling : un doigt qui part tout de suite d une carte FAIT DEFILER, ne
//      deplace rien.
//   C. Planning : un tap sur une carte ouvre toujours la reservation.
//   I. Bowling : un appui long relache sans bouger ne deplace rien (ni requete,
//      ni fantome oublie).
//   J. Bowling : un geste interrompu (touchcancel) ne depose rien.
//   N. Bowling : le planning se redessine pendant le glisser (un autre poste a
//      modifie une reservation), la carte tenue quitte la page : le depot
//      arrive quand meme.
//   D. Laser (planning de la maquette E) : appui long, glisser un groupe place
//      vers la file « À placer ».
//   E. Laser : appui long, glisser son jeton de la file vers un depart libre.
//   L. Laser : un geste interrompu ne retire rien du planning.
//   F. Bowling multi-pistes : glisser au doigt deplace le groupe comme la souris;
//      maintien1s conserve une selection apres relachement. Les pistes explicites
//      se deplacent seules, les pistes decochees gardent leurs horaires. En
//      passant, a la souris, le fantome suit le curseur A L ECRAN : il
//      s affichait sous la page avant ce gate.
//   M. Bowling : avec deux doigts sur l ecran (le second pose pendant l appui,
//      ou un doigt deja pose ailleurs), la carte ne se leve pas.
//   G. Tableau d analyse : appui long = mode edition ; en edition, appui long
//      sur le CORPS d une carte puis glisser = elle change de place, persistee.
//   H. Tableau d analyse : en edition, un glisser qui part tout de suite fait
//      defiler la page, sans remanier la grille.
//   K. Tableau d analyse : un geste interrompu rend la carte a sa place.
//   O. Tableau d analyse : en edition, la poignee se tire tout de suite au
//      doigt, sans appui long (elle interdit le defilement).
// Les defilements sont LENTS (plus longs que l appui long) : un doigt qui part
// tout de suite doit rester un defilement jusqu au bout.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_TOUCH_PORT || 4661);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const TABLETTE = { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// Le tableau d analyse, seul, sur une page minimale (meme montage que
// analytics-board-check), plus le module du geste tactile et de quoi defiler.
const PAGE_TABLEAU = `<!DOCTYPE html>
<html lang="fr" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate tactile du tableau d analyse</title>
<link rel="stylesheet" href="/assets/pinlane.css">
<link rel="stylesheet" href="/assets/pinlane-charts.css">
<link rel="stylesheet" href="/assets/pinlane-daterange.css">
<link rel="stylesheet" href="/assets/pinlane-analytics-board.css">
</head>
<body>
<main style="max-width:1000px;margin:0 auto;padding:48px 24px">
  <div id="host" style="width:420px"></div>
  <div style="height:1400px"></div>
</main>
<script src="/assets/pinlane-touch-drag.js"></script>
<script src="/assets/pinlane-charts.js"></script>
<script src="/assets/pinlane-daterange.js"></script>
<script src="/assets/pinlane-analytics-board.js"></script>
</body>
</html>`;

const INIT_TABLEAU = `
window.__buildAnalytics = function (start, end) {
  function fromISO(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
  function iso(d){function p(n){return (n<10?'0':'')+n;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
  var daily=[]; var d=fromISO(start); var endD=fromISO(end); var i=0; var sumC=0,sumR=0,sumP=0;
  while (d <= endD && i < 200) { var c=(i%7)+3; var r=c*35; var px=c*2+1; daily.push({date:iso(d),count:c,revenue:r,pax:px}); sumC+=c; sumR+=r; sumP+=px; d.setDate(d.getDate()+1); i+=1; }
  return { totals:{reservations:sumC,revenue:sumR,pax:sumP,avgBasket:42,paymentRate:82,cancelRate:7}, daily:daily,
    byType:{Bowling:{count:14,revenue:520,pax:36},Laser:{count:9,revenue:340,pax:22},Restaurant:{count:5,revenue:180,pax:12}},
    byChannel:[{channel:'Site',count:16},{channel:'Telephone',count:7},{channel:'Sur place',count:5}], occupancy:{rate:64} };
};
window.__mountBoard = function () {
  window.__board = window.PinlaneAnalyticsBoard.mount('host', {
    storageKey: 'pab-touch',
    getAnalytics: function (s, e) { return Promise.resolve(window.__buildAnalytics(s, e)); },
    defaultWidgets: [{metric:'revenue',viz:'line'},{metric:'byType',viz:'donut'},{metric:'reservations',viz:'bars'}],
    maxDate: '2026-07-21'
  });
};
`;

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/__touch-board') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(PAGE_TABLEAU);
      return;
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
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

// Le meme faux serveur que laser-drag-check : session, planning, PATCH enregistres.
async function installMock(page) {
  await require('./activity-drag-ui-fixture').installActivityMoveFixture(page);
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view','planning.view','planning.bowling','planning.laser','planning.drag','reservations.view','reservations.create','reservations.edit','reservations.status','reservations.quick','clients.view','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'QA', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const build = (date) => ([
      { id: 9001, name: 'Anniv Lina #9001', phone: '+32470860011', email: 'a@x.test', date, startTime: '14:00', duration: 1, lanes: [1], status: 'confirmed', pax: 6, price: 20, type: 'bowling', label: 'Bowling' },
      { id: 9002, name: 'Famille Lambert #9002', phone: '+32470860012', email: 'b@x.test', date, startTime: '14:30', duration: 1, lanes: [2], status: 'arrived', pax: 4, price: 39, type: 'bowling', label: 'Bowling' },
      { id: 9004, name: 'Ecole SH #9004', phone: '+32470860014', email: 'd@x.test', date, startTime: '18:00', duration: 2, lanes: [4,6,8], status: 'confirmed', pax: 17, price: 234, type: 'bowling', label: 'Bowling 2h' },
      { id: 9010, name: 'Ansar Bisultanov #9010', phone: '+32470860010', email: 'ansar@x.test', date, startTime: '17:30', duration: 0.5, lanes: [], status: 'confirmed', pax: 4, price: 20, type: 'laser', label: 'Laser direct' },
    ]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
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
    const nativeFetch = window.fetch.bind(window);
    window.__QA_PATCHES__ = [];
    window.__QA_STORE__ = {};
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-customer-notes' && m === 'GET') {
        const ids=(u.searchParams.get('reservationIds')||u.searchParams.get('reservationId')||'').split(',');
        const blank={eligible:true,clientKey:'+32470000000',note:null};
        return J({ok:true,...blank,notesByReservationId:Object.fromEntries(ids.filter(Boolean).map(id=>[id,blank]))});
      }
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10); const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, ...window.__QA_STORE__[r.id] } : r); return J({ ok: true, revision: `qa-${d}-${Object.keys(window.__QA_STORE__).length}`, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const b = JSON.parse(init.body || '{}');
        window.__QA_PATCHES__.push(b);
        if (b.activityMove) {
          const current = { ...state.reservations.find(r => Number(r.id) === Number(b.id)), centerId: 'libramont' };
          const result = await window.__qaActivityMove({ current, body: b });
          if (!result.ok) return new Response(JSON.stringify(result), { status: result.status, headers: { 'content-type': 'application/json' } });
          window.__QA_STORE__[b.id] = result.reservation;
          return J(result);
        }
        let merged = { ...b };
        try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) merged = { ...f, ...b }; } } catch (e) {}
        window.__QA_STORE__[b.id] = { startTime: merged.startTime, opsPlan: merged.opsPlan, lanes: merged.lanes };
        return J({ ok: true, reservation: merged, automation: { communications: 0, jobs: 0, refreshed: true } });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: new Date().toISOString().slice(0,10), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || new Date().toISOString().slice(0,10); return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// Un doigt : touchStart, des touchMove, touchEnd, sur la meme piste de contact.
function doigt(page, cdp) {
  const envoyer = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    async poser(p) { await envoyer('touchStart', [{ x: p.x, y: p.y, id: 1 }]); },
    async aller(de, vers, pas = 16, rythme = 16) {
      for (let i = 1; i <= pas; i += 1) {
        await envoyer('touchMove', [{ x: de.x + ((vers.x - de.x) * i) / pas, y: de.y + ((vers.y - de.y) * i) / pas, id: 1 }]);
        await page.waitForTimeout(rythme);
      }
    },
    async lever() { await envoyer('touchEnd', []); },
    // Le systeme reprend la main (appel entrant, geste du systeme) : touchcancel.
    async interrompre() { await envoyer('touchCancel', []); },
    async glisser(de, vers, { maintien = 0, pas = 16, rythme = 16 } = {}) {
      await this.poser(de);
      if (maintien) await page.waitForTimeout(maintien);
      await this.aller(de, vers, pas, rythme);
      await this.lever();
    },
    async tap(p) { await this.poser(p); await page.waitForTimeout(40); await this.lever(); },
    async appui(p, ms) { await this.poser(p); await page.waitForTimeout(ms); await this.lever(); },
  };
}

// Attend une CONDITION, bornee : rend false au lieu de jeter si elle n arrive pas.
async function attendre(page, fn, arg, ms = 3000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms });
    // A targeted move is drawn only after its server receipt. Sending a PATCH
    // is not yet a successful gesture, and the next fixture must not reset it.
    await page.waitForFunction(() => typeof fileEcrituresReservation !== 'function' || (Object.keys(bowlingDragLatestSeqByReservation).length === 0 && Object.keys(laserPassLatestSeqByReservation).length === 0 && fileEcrituresReservation().size === 0), null, { timeout: ms });
    return true; } catch (e) { return false; }
}

// Tous les defilements qui peuvent bouger sous un doigt : la page et chaque
// ancetre defilable d un element.
function releverDefilements(page, selecteur) {
  return page.evaluate((sel) => {
    const liste = [document.scrollingElement || document.documentElement];
    let n = document.querySelector(sel);
    n = n && n.parentElement;
    while (n && n !== document.body) {
      if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) liste.push(n);
      n = n.parentElement;
    }
    return liste.map((e) => ({ top: e.scrollTop, left: e.scrollLeft, marge: e.scrollHeight - e.clientHeight - e.scrollTop }));
  }, selecteur);
}
function ecartMax(avant, apres) {
  return Math.max(0, ...avant.map((a, i) => (apres[i] ? Math.abs(apres[i].top - a.top) + Math.abs(apres[i].left - a.left) : 0)));
}

// Chaque scenario repart du meme planning. L app protege un deplacement qu elle
// vient d envoyer contre un rafraichissement qui le contredirait : cette memoire
// est purgee aussi, sinon le scenario suivant retrouve la carte deja deplacee.
async function ouvrirPlanning(page, vue) {
  const poser = (v) => {
    if(typeof cancelPlanningMove === 'function')cancelPlanningMove(false);
    // Le planning Laser garde le groupe pris d un scenario a l autre : on le rend.
    if (typeof lpEtat === 'object' && lpEtat) { lpEtat.choisi = null; lpEtat.raison = ''; }
    const d = '2026-07-18';
    state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = v; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = v === 'laser'; state.staffPlanningExpanded = false;
    state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
    state.reservations.forEach((r) => clearReservationMutation(r.id));
    window.__QA_STORE__ = {};
    save(); setView('staff'); renderStaff();
  };
  await page.evaluate(poser, vue);
  await page.waitForTimeout(350);
  // LA GRILLE DOIT MESURER QUELQUE CHOSE, et le rester. Le demarrage de la
  // console est asynchrone : un rendu tardif reprend la main apres ce montage
  // et referme le planning. Les cartes existent alors dans le DOM avec des
  // rectangles a zero, le doigt se pose en (0,0) et rien ne se leve. On
  // re-impose la vue tant que la grille ne mesure rien.
  // ET ELLE DOIT LE RESTER. Une seule mesure ne suffit pas : le rendu tardif
  // peut arriver APRES la verification et refermer le planning juste avant le
  // geste. On exige donc deux mesures a 500 ms d intervalle, ce qui laisse
  // passer le rendu tardif ; s il a referme la grille, on re-impose.
  const mesurable = () => page.evaluate((v) => {
    const cadre = document.getElementById(v === 'laser' ? 'laserPlanningBox' : 'planningGridWrap');
    return Boolean(cadre) && cadre.getBoundingClientRect().height > 100;
  }, vue);
  let prete = false;
  for (let essai = 0; essai < 8 && !prete; essai += 1) {
    if (await mesurable()) {
      await page.waitForTimeout(500);
      prete = await mesurable();
    }
    if (!prete) { await page.evaluate(poser, vue); await page.waitForTimeout(350); }
  }
  ok(prete, `montage : le planning ${vue} est rendu et mesurable`);
}

// Centre d un element, apres l avoir amene au milieu de l ecran, et s il est
// entierement visible (sinon le geste ne prouve rien).
// UN RECTANGLE A ZERO N EST PAS UNE POSITION. Une carte lue avant que la
// console ait fini sa mise en page rend {0,0,0,0} : le centre tombe en (0,0),
// et l ancien test « visible » le declarait VISIBLE (0 >= 0 et 0 <= hauteur).
// Le doigt se posait alors dans le coin de l ecran, sur la barre laterale, et
// le gate accusait le produit de ne pas lever la carte. Mesure du 2026-09-19 :
// doigt [0,0] alors que la carte etait en [435,737,531,783].
function centre(page, selecteur, amener = false) {
  return attendre(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const b = el.getBoundingClientRect();
    return b.width > 1 && b.height > 1;
  }, selecteur, 8000).then(() => page.evaluate(({ sel, amener }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    if (amener) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return null;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, visible: b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth };
  }, { sel: selecteur, amener }));
}

// Ou est le fantome par rapport au doigt : ecart entre son bas et le doigt
// (positif = au-dessus), decalage de son centre sur le doigt (0 = centre).
function fantome(page, selecteur, doigtEn) {
  return page.evaluate(({ sel, p }) => {
    const g = document.querySelector(sel);
    if (!g) return null;
    const b = g.getBoundingClientRect();
    return { ecart: Math.round(p.y - b.bottom), decentre: Math.round((b.left + b.right) / 2 - p.x), haut: Math.round(b.top) };
  }, { sel: selecteur, p: doigtEn });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const context = await browser.newContext(TABLETTE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touche = doigt(page, cdp);
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGE: ' + e.message));
  try {
    await installMock(page);
    // ON OUVRE LA CONSOLE A SON ADRESSE REELLE. Forcer state.view en memoire
    // sans toucher l URL laisse les deux en desaccord : un evenement de
    // navigation tardif (hashchange, popstate) re-synchronise la route depuis
    // l adresse et RAMENE la vue client. Mesure du 2026-09-19, pile a l appui :
    // syncRouteFromHash -> setView("client") a 6,4 s, la grille passe de 742 px
    // a 0, le doigt se pose dans le vide. En production la console s ouvre sur
    // #/staff/... : le gate fait desormais pareil.
    await page.goto(`${BASE_URL}/?v=touch-${Date.now()}#/staff/planning`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    const tactile = await page.evaluate(() => ({ points: navigator.maxTouchPoints, evenements: 'ontouchstart' in window }));
    ok(tactile.points > 0 && tactile.evenements, `MONTAGE : ecran tactile emule (${tactile.points} point(s), evenements tactiles : ${tactile.evenements})`);

    // --- A : bowling, appui long puis glisser -------------------------------
    console.log('\n[A] Bowling : appui long puis glisser deplace la carte, la page reste immobile');
    await ouvrirPlanning(page, 'bowling');
    const srcA = await centre(page, '.booking[data-booking-res-id="9002"]', true);
    const tgtA = await centre(page, '.slot-cell[data-bowling-drop-lane="5"][data-bowling-drop-start="16"]');
    if (ok(srcA && tgtA && srcA.visible && tgtA.visible, 'MONTAGE : la carte 9002 et la cellule piste 5 / 16:00 sont a l ecran')) {
      const avantA = await releverDefilements(page, '.booking[data-booking-res-id="9002"]');
      const patchsA = await page.evaluate(() => window.__QA_PATCHES__.length);
      await touche.poser(srcA);
      await page.waitForTimeout(500);
      // Le fantome doit etre AU-DESSUS du doigt, et centre sur lui : dessous,
      // la main le cache.
      const fantomeA = await fantome(page, '.bowling-drag-ghost-card', srcA);
      await touche.aller(srcA, tgtA);
      await touche.lever();
      ok(fantomeA && fantomeA.ecart >= 4 && fantomeA.haut >= 0 && Math.abs(fantomeA.decentre) <= 2, `l appui long leve la carte, et son fantome s affiche au-dessus du doigt, centre (${JSON.stringify(fantomeA)})`);
      const envoye = await attendre(page, (n) => window.__QA_PATCHES__.length > n, patchsA);
      const resA = await page.evaluate(() => { const r = state.reservations.find((x) => x.id === 9002) || {}; return { start: numToTime(getBowlingWindowsFromReservation(r)[0]?.start), lanes: r.lanes }; });
      const apresA = await releverDefilements(page, '.booking[data-booking-res-id="9002"]');
      ok(envoye, 'le depot au doigt envoie la modification au serveur');
      ok(resA.start === '16:00' && JSON.stringify(resA.lanes) === '[5]', `la reservation 9002 passe a 16:00 piste 5 (${resA.start}, pistes ${JSON.stringify(resA.lanes)})`);
      ok(ecartMax(avantA, apresA) <= 8, `la page ne defile pas sous le doigt pendant le glisser (ecart ${ecartMax(avantA, apresA)} px)`);
    }

    // --- B : un doigt qui part tout de suite fait defiler --------------------
    console.log('\n[B] Bowling : un doigt qui part tout de suite d une carte fait defiler, ne deplace rien');
    await ouvrirPlanning(page, 'bowling');
    await page.evaluate(() => { (document.scrollingElement || document.documentElement).scrollTop = 0; });
    const srcB = await centre(page, '.booking[data-booking-res-id="9001"]');
    const avantB = await releverDefilements(page, '.booking[data-booking-res-id="9001"]');
    const margeB = Math.max(...avantB.map((d) => d.marge));
    if (ok(srcB && srcB.visible && margeB > 150, `MONTAGE : la carte 9001 est a l ecran et il reste de quoi defiler (${margeB} px)`)) {
      const patchsB = await page.evaluate(() => window.__QA_PATCHES__.length);
      // Un defilement LENT (plus long que l appui long) : un doigt qui part
      // tout de suite doit rester un defilement jusqu au bout, pas devenir un
      // glisser a la 280e milliseconde.
      await touche.glisser(srcB, { x: srcB.x, y: Math.max(20, srcB.y - 260) }, { pas: 16, rythme: 30 });
      await page.waitForTimeout(500);
      const apresB = await releverDefilements(page, '.booking[data-booking-res-id="9001"]');
      const resB = await page.evaluate((n) => ({ patchs: window.__QA_PATCHES__.length - n, start: (state.reservations.find((x) => x.id === 9001) || {}).startTime }), patchsB);
      ok(ecartMax(avantB, apresB) >= 60, `le planning defile sous le doigt (${ecartMax(avantB, apresB)} px)`);
      ok(resB.patchs === 0 && resB.start === '14:00', `et rien n est deplace (${resB.patchs} modification(s), 9001 a ${resB.start})`);
    }

    // --- C : un tap ouvre toujours la reservation ---------------------------
    console.log('\n[C] Planning : un tap sur une carte ouvre toujours la reservation');
    await ouvrirPlanning(page, 'bowling');
    await page.evaluate(() => { window.__ouverts = []; window.openPos = (id) => { window.__ouverts.push(Number(id)); }; });
    const srcC = await centre(page, '.booking[data-booking-res-id="9002"]', true);
    if (ok(srcC && srcC.visible, 'MONTAGE : la carte 9002 est a l ecran')) {
      await touche.tap(srcC);
      ok(await attendre(page, () => window.__ouverts.includes(9002), null, 2000), 'le tap sur la carte bowling ouvre la reservation 9002');
    }

    // --- I : appui long relache sur place ------------------------------------
    console.log('\n[I] Bowling : un appui long relache sans bouger ne deplace rien');
    await ouvrirPlanning(page, 'bowling');
    const srcI = await centre(page, '.booking[data-booking-res-id="9002"]', true);
    if (ok(srcI && srcI.visible, 'MONTAGE : la carte 9002 est a l ecran')) {
      const nI = await page.evaluate(() => window.__QA_PATCHES__.length);
      await touche.poser(srcI);
      await page.waitForTimeout(500);
      const leveeI = await page.evaluate(() => !!document.querySelector('.bowling-drag-ghost-card'));
      await touche.lever();
      await page.waitForTimeout(500);
      const resI = await page.evaluate((n) => ({
        patchs: window.__QA_PATCHES__.length - n,
        start: (state.reservations.find((x) => x.id === 9002) || {}).startTime,
        fantome: !!document.querySelector('.bowling-drag-ghost-card'),
        enGlisser: document.body.classList.contains('bowling-dragging'),
      }), nI);
      ok(leveeI, 'MONTAGE : l appui long a bien leve la carte (fantome present)');
      ok(resI.patchs === 0 && resI.start === '14:30', `relachee sur place, la carte ne bouge pas (${resI.patchs} modification(s), 9002 a ${resI.start})`);
      ok(!resI.fantome && !resI.enGlisser, 'le fantome et l etat « en glisser » disparaissent');
    }

    // --- J : geste interrompu au planning ------------------------------------
    console.log('\n[J] Bowling : un geste interrompu ne depose rien');
    await ouvrirPlanning(page, 'bowling');
    const srcJ = await centre(page, '.booking[data-booking-res-id="9002"]', true);
    const tgtJ = await centre(page, '.slot-cell[data-bowling-drop-lane="5"][data-bowling-drop-start="16"]');
    if (ok(srcJ && tgtJ && srcJ.visible && tgtJ.visible, 'MONTAGE : carte 9002 et cellule piste 5 / 16:00 a l ecran')) {
      const nJ = await page.evaluate(() => window.__QA_PATCHES__.length);
      await touche.poser(srcJ);
      await page.waitForTimeout(500);
      await touche.aller(srcJ, tgtJ);
      const cibleJ = await page.evaluate(() => !!document.querySelector('.is-drop-target'));
      await touche.interrompre();
      await page.waitForTimeout(500);
      const resJ = await page.evaluate((n) => ({
        patchs: window.__QA_PATCHES__.length - n,
        start: (state.reservations.find((x) => x.id === 9002) || {}).startTime,
        fantome: !!document.querySelector('.bowling-drag-ghost-card'),
        cible: !!document.querySelector('.is-drop-target'),
        enGlisser: document.body.classList.contains('bowling-dragging'),
      }), nJ);
      ok(cibleJ, 'MONTAGE : au moment de l interruption, une cellule etait visee');
      ok(resJ.patchs === 0 && resJ.start === '14:30', `interrompu, rien n est depose (${resJ.patchs} modification(s), 9002 a ${resJ.start})`);
      ok(!resJ.fantome && !resJ.cible && !resJ.enGlisser, 'ni fantome, ni cible surlignee, ni etat « en glisser » ne restent');
    }

    // --- N : le planning se redessine pendant le glisser ---------------------
    // Un autre poste modifie une reservation : la console redessine le planning
    // pendant que le doigt glisse, et la carte tenue quitte la page. Le geste
    // continue jusqu au depot : il ecoute sur la carte, pas sur le document,
    // ou les evenements d un element retire n arrivent plus.
    console.log('\n[N] Bowling : le planning se redessine pendant le glisser, le depot arrive quand meme');
    await ouvrirPlanning(page, 'bowling');
    const srcN = await centre(page, '.booking[data-booking-res-id="9002"]', true);
    const tgtN = await centre(page, '.slot-cell[data-bowling-drop-lane="5"][data-bowling-drop-start="16"]');
    if (ok(srcN && tgtN && srcN.visible && tgtN.visible, 'MONTAGE : carte 9002 et cellule piste 5 / 16:00 a l ecran')) {
      const nN = await page.evaluate(() => { window.__carteTenue = document.querySelector('.booking[data-booking-res-id="9002"]'); return window.__QA_PATCHES__.length; });
      await touche.poser(srcN);
      await page.waitForTimeout(500);
      const mi = { x: (srcN.x + tgtN.x) / 2, y: (srcN.y + tgtN.y) / 2 };
      await touche.aller(srcN, mi, 8);
      const redessine = await page.evaluate(() => { renderStaffData(); return !window.__carteTenue.isConnected && !!document.querySelector('.booking[data-booking-res-id="9002"]'); });
      await touche.aller(mi, tgtN, 8);
      await touche.lever();
      const envoyeN = await attendre(page, (n) => window.__QA_PATCHES__.length > n, nN);
      const resN = await page.evaluate(() => { const r = state.reservations.find((x) => x.id === 9002) || {}; return { start: numToTime(getBowlingWindowsFromReservation(r)[0]?.start), lanes: r.lanes, fantome: !!document.querySelector('.bowling-drag-ghost-card') }; });
      ok(redessine, 'MONTAGE : la carte tenue a quitte la page pendant le glisser, une nouvelle l a remplacee');
      ok(envoyeN && resN.start === '16:00' && JSON.stringify(resN.lanes) === '[5]' && !resN.fantome, `le depot arrive quand meme : 9002 a 16:00 piste 5, sans fantome oublie (${resN.start}, pistes ${JSON.stringify(resN.lanes)})`);
    }

    // --- D, E, L : le planning Laser de la maquette E, plein ecran ----------
    // Un rang par depart, la file « À placer » collee en bas. Pendant un
    // glisser, le planning defile seul a moins de 96 px du haut de son cadre et
    // du haut de la file (lpDefilerDemarrer) : ce que le doigt saisit s amene
    // entre les deux (la ou poser le doigt ne fait rien defiler).
    const amenerLaser = (selecteur) => page.evaluate((selecteur) => {
      const el = document.querySelector(selecteur);
      const cadre = lpDefileur();
      if (!el || !cadre) return null;
      const r = cadre.getBoundingClientRect();
      const file = document.querySelector('#laserPlanningGridWrap .lp-file');
      const haut = Math.max(0, r.top) + 96 + 12;
      const bas = Math.min(innerHeight, r.bottom, file ? file.getBoundingClientRect().top : Infinity) - 96 - 12;
      for (let essai = 0; essai < 12; essai += 1) {
        const b = el.getBoundingClientRect();
        const ecart = (b.top + b.height / 2) - (haut + bas) / 2;
        if (Math.abs(ecart) <= 2) break;
        cadre.scrollTop += ecart;
      }
      const b = el.getBoundingClientRect();
      const y = b.top + b.height / 2;
      return { x: b.left + Math.min(b.width / 2, 60), y, visible: b.height > 4 && y > haut && y < bas };
    }, selecteur);
    const centreFile = () => page.evaluate(() => { const q = document.querySelector('#laserPlanningGridWrap .lp-file'); if (!q) return null; const b = q.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const GROUPE_9010 = '#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]';

    // --- D : laser, groupe place vers la file « À placer » -----------------
    console.log('\n[D] Laser : appui long, glisser un groupe place vers la file « À placer »');
    await ouvrirPlanning(page, 'laser');
    const srcD = await amenerLaser(GROUPE_9010);
    const fileD = await centreFile();
    if (ok(srcD && srcD.visible && fileD, 'MONTAGE : groupe laser place a l ecran et file « À placer » presente')) {
      const nD = await page.evaluate(() => window.__QA_PATCHES__.length);
      await touche.poser(srcD);
      await page.waitForTimeout(500);
      const fantomeD = await fantome(page, '.lp-fantome', srcD);
      await touche.aller(srcD, await centreFile());
      await touche.lever();
      ok(fantomeD && fantomeD.ecart >= 4 && fantomeD.haut >= 0 && Math.abs(fantomeD.decentre) <= 2, `le fantome laser s affiche au-dessus du doigt, centre (${JSON.stringify(fantomeD)})`);
      await attendre(page, () => getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9010)).length === 0, null, 3000);
      const resD = await page.evaluate((n) => {
        const r = state.reservations.find((x) => x.id === 9010);
        const patchs = (window.__QA_PATCHES__ || []).slice(n);
        const patch = patchs.slice(-1)[0] || null;
        return { fenetres: getLaserWindowsFromReservation(r).length, attente: getPendingLaserPasses(state.currentDate).map((p) => p.reservation.id), jeton: !!document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="9010"]'), patchs: patchs.length, manuel: !!(patch && patch.activityMove && patch.activityMove.unplace) };
      }, nD);
      ok(resD.fenetres === 0 && resD.attente.includes(9010) && resD.jeton, `la partie quitte le planning et attend dans la file (${resD.fenetres} fenetre(s), jeton ${resD.jeton})`);
      ok(resD.patchs === 1 && resD.manuel, `la modification envoyee porte le retrait (activityMove.unplace) (${resD.patchs} modification(s))`);
    }

    // --- E : laser, jeton en attente vers un depart libre ------------------
    // Independant de D : la partie est mise en attente A LA SOURIS (chemin prouve
    // par laser-drag-check), puis replacee au doigt.
    console.log('\n[E] Laser : appui long, glisser le jeton en attente vers un depart libre');
    await ouvrirPlanning(page, 'laser');
    const miseEnAttente = await amenerLaser(GROUPE_9010);
    if (miseEnAttente && miseEnAttente.visible) {
      await page.mouse.move(miseEnAttente.x, miseEnAttente.y); await page.mouse.down();
      await page.mouse.move(miseEnAttente.x + 8, miseEnAttente.y + 8, { steps: 2 });
      const fileE = await centreFile();
      await page.mouse.move(fileE.x, fileE.y, { steps: 10 }); await page.mouse.up();
      await attendre(page, () => !!document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="9010"]'), null, 3000);
    }
    const jetonE = await page.evaluate(() => { const j = document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="9010"]'); if (!j) return null; const b = j.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, visible: b.top >= 0 && b.bottom <= innerHeight }; });
    if (ok(jetonE && jetonE.visible, 'MONTAGE : jeton en attente a l ecran, dans la file')) {
      await touche.poser(jetonE);
      await page.waitForTimeout(500);
      // Le jeton leve, la file a grandi de sa barre : le planning va au bout
      // de la journee (il n a plus rien a defiler vers le bas, le doigt peut
      // traverser la bande du bas), et la cible est le depart libre le plus
      // proche du milieu de la bande.
      const tgtE = await page.evaluate(() => {
        const cadre = lpDefileur();
        cadre.scrollTop = cadre.scrollHeight;
        const r = cadre.getBoundingClientRect();
        const haut = Math.max(0, r.top) + 96 + 12;
        const bas = Math.min(innerHeight, r.bottom, document.querySelector('#laserPlanningGridWrap .lp-file').getBoundingClientRect().top) - 96 - 12;
        const rangs = [...document.querySelectorAll('#laserPlanningGridWrap .lp-dep.is-cible[data-lp-t]')]
          .map((d) => { const b = d.querySelector('.lp-dep__jauge').getBoundingClientRect(); return { t: Number(d.dataset.lpT), x: b.left + Math.min(b.width / 2, 60), y: b.top + b.height / 2 }; })
          .filter((o) => o.y > haut && o.y < bas)
          .sort((a, b) => Math.abs(a.y - (haut + bas) / 2) - Math.abs(b.y - (haut + bas) / 2));
        return { leve: Boolean(lpEtat.glisse), cible: rangs[0] || null };
      });
      if (ok(tgtE.leve && tgtE.cible, `MONTAGE : jeton leve, un depart libre l accepte (${tgtE.cible ? tgtE.cible.t : 'aucun'})`)) {
        await touche.aller(jetonE, tgtE.cible);
      }
      await touche.lever();
      await attendre(page, () => getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9010)).length > 0, null, 3000);
      const resE = await page.evaluate(() => { const w = getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9010)); return w.length ? w[0].start : null; });
      ok(tgtE.cible && resE !== null && Math.abs(Number(resE) - Number(tgtE.cible.t)) <= 0.01, `la partie est placee au depart vise (${tgtE.cible ? tgtE.cible.t : '?'}, lu ${resE})`);
    }

    // --- L : laser, geste interrompu -----------------------------------------
    console.log('\n[L] Laser : un geste interrompu ne retire rien du planning');
    await ouvrirPlanning(page, 'laser');
    const srcL = await amenerLaser(GROUPE_9010);
    const fileL = await centreFile();
    if (ok(srcL && srcL.visible && fileL, 'MONTAGE : groupe laser place a l ecran et file « À placer » presente')) {
      const avantL = await page.evaluate(() => ({ patchs: window.__QA_PATCHES__.length, fenetres: getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9010)).length }));
      await touche.poser(srcL);
      await page.waitForTimeout(500);
      await touche.aller(srcL, await centreFile());
      const viseeL = await page.evaluate(() => !!document.querySelector('#laserPlanningGridWrap .lp-file.is-survol') && Boolean(lpEtat.glisse));
      await touche.interrompre();
      await page.waitForTimeout(500);
      const resL = await page.evaluate((n) => ({
        patchs: window.__QA_PATCHES__.length - n,
        fenetres: getLaserWindowsFromReservation(state.reservations.find((x) => x.id === 9010)).length,
        fantome: !!document.querySelector('.lp-fantome'),
        cible: !!document.querySelector('#laserPlanningGridWrap .is-survol'),
        enGlisser: document.body.classList.contains('lp-glisse') || Boolean(lpEtat.glisse) || Boolean(lpEtat.geste),
      }), avantL.patchs);
      ok(viseeL && avantL.fenetres > 0, `MONTAGE : la partie etait au planning et la file « À placer » etait visee a l interruption (${avantL.fenetres} fenetre(s))`);
      ok(resL.patchs === 0 && resL.fenetres === avantL.fenetres, `interrompu, la partie reste au planning (${resL.patchs} modification(s), ${resL.fenetres} fenetre(s))`);
      ok(!resL.fantome && !resL.cible && !resL.enGlisser, `ni fantome, ni file surlignee, ni etat « en glisser » ne restent (${JSON.stringify(resL)})`);
    }

    // --- F : bowling multi-pistes, groupe ou piste seule --------------------
    console.log('\n[F] Bowling multi-pistes : glisser groupe et maintien1s avec sélection directe des pistes');
    const SRC_F = '.booking[data-booking-res-id="9004"][data-booking-lane="4"]';
    const TGT_F = '.slot-cell[data-bowling-drop-lane="1"][data-bowling-drop-start="18"]';
    const pistesF = () => page.evaluate(() => JSON.stringify((state.reservations.find((x) => x.id === 9004) || {}).lanes));
    const oracle = {};
    for (const [nom, shift] of [['groupe', false], ['piste', true]]) {
      await ouvrirPlanning(page, 'bowling');
      const s = await centre(page, SRC_F, true);
      const t = await centre(page, TGT_F);
      if (!s || !t || !s.visible || !t.visible) { oracle[nom] = null; continue; }
      const n = await page.evaluate(() => window.__QA_PATCHES__.length);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(s.x, s.y); await page.mouse.down();
      await page.mouse.move(s.x + 8, s.y + 8, { steps: 2 });
      await page.mouse.move(t.x, t.y, { steps: 8 });
      if (!shift) {
        // A LA SOURIS AUSSI, le fantome suit le curseur a l ecran : il partait de
        // sa place dans le flux, en bas de la page, et restait invisible.
        const g = await page.evaluate(() => { const e = document.querySelector('.bowling-drag-ghost-card'); if (!e) return null; const b = e.getBoundingClientRect(); return { gauche: Math.round(b.left), haut: Math.round(b.top) }; });
        ok(g && Math.abs(g.gauche - Math.round(t.x + 14)) <= 2 && Math.abs(g.haut - Math.round(t.y + 14)) <= 2, `a la souris, le fantome bowling suit le curseur a l ecran (${JSON.stringify(g)}, curseur ${Math.round(t.x)},${Math.round(t.y)})`);
      }
      await page.mouse.up();
      if (shift) await page.keyboard.up('Shift');
      await attendre(page, (k) => window.__QA_PATCHES__.length > k, n);
      oracle[nom] = await pistesF();
    }
    if (ok(oracle.groupe && oracle.piste && oracle.groupe !== oracle.piste, 'MONTAGE : mouse group/single lane differ')) {
      await ouvrirPlanning(page, 'bowling');
      const source = await centre(page, SRC_F, true), target = await centre(page, TGT_F);
      if (ok(source && target && source.visible && target.visible, 'MONTAGE : touch group source/target visible')) {
        const n=await page.evaluate(()=>window.__QA_PATCHES__.length);
        await touche.glisser(source,target,{maintien:450,pas:16,rythme:60});
        await attendre(page,k=>window.__QA_PATCHES__.length>k,n);
        ok(await pistesF()===oracle.groupe,'moving finger after450ms still moves whole group like mouse');
      }
      await ouvrirPlanning(page,'bowling');
      const held=await centre(page,SRC_F,true);
      if(ok(held&&held.visible,'MONTAGE : source for persistent selection visible')) {
        const before=await page.evaluate(()=>({patches:window.__QA_PATCHES__.length,plan:state.reservations.find(r=>r.id===9004).opsPlan,price:state.reservations.find(r=>r.id===9004).price}));
        await touche.appui(held,1120);
        ok(await page.evaluate(()=>!!planningMoveSelection),'one second hold remains selected after release');ok(await page.locator('.booking.is-move-selected').count()===3,'all three linked lane cards highlighted');ok(await page.locator('#planningMoveSelection').count()===0,'no movement menu');
        ok(await page.evaluate(n=>window.__QA_PATCHES__.length===n,before.patches),'persistent selection is not a write');
        await page.waitForTimeout(650);
        await page.locator('.booking[data-booking-res-id="9004"][data-booking-lane="6"]').first().click();
        await page.locator('.booking[data-booking-res-id="9004"][data-booking-lane="8"]').first().click();
        ok(await page.locator('.booking.is-move-selected').count()===1,'clicked lane cards are not highlighted');
        const selected=await centre(page,SRC_F,true),destination=await centre(page,'.slot-cell[data-bowling-drop-lane="1"][data-bowling-drop-start="17"]');
        ok(selected&&destination&&selected.visible&&destination.visible,'direct touch source/target visible');
        await touche.glisser(selected,destination,{maintien:100,pas:16,rythme:60});
        await attendre(page,k=>window.__QA_PATCHES__.length>k,before.patches);
        const result=await page.evaluate(()=>{const r=state.reservations.find(r=>r.id===9004);return{price:r.price,windows:getBowlingWindowsFromReservation(r),request:window.__QA_PATCHES__.at(-1)};});
        ok(JSON.stringify(result.request.activityMove.sourceLanes)==='[4]','explicit selection sends only chosen source lane');
        ok(result.windows.some(w=>w.lanes.includes(1)&&w.start===17),'chosen lane moved to17:00');
        ok(result.windows.some(w=>w.lanes.includes(6)&&w.start===18)&&result.windows.some(w=>w.lanes.includes(8)&&w.start===18),'unchecked lanes6/8 stay18:00');
        ok(result.price===before.price,'splitting lanes preserves total price');
        ok(await page.evaluate(()=>!planningMoveSelection),'successful direct drop clears selection');
      }
    }

    // --- M : deux doigts ------------------------------------------------------
    // Deux doigts sur l ecran, c est un pincement ou un defilement, jamais un
    // glisser : que le second se pose pendant l appui sur la carte, ou qu un
    // doigt soit deja pose ailleurs quand l autre appuie sur la carte.
    console.log('\n[M] Bowling : avec deux doigts sur l ecran, la carte ne se leve pas');
    const envoyer = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await page.evaluate(() => {
      document.addEventListener('touchstart', (e) => {
        if (!window.__doigtsVus) return;
        const surCarte = e.target && e.target.closest && e.target.closest('.booking[data-booking-res-id="9002"]');
        window.__doigtsVus.push(e.touches.length + (surCarte ? 'c' : ''));
      }, true);
    });
    for (const [nom, carteDabord] of [['le second se pose ailleurs pendant l appui', true], ['un doigt est deja pose ailleurs', false]]) {
      await ouvrirPlanning(page, 'bowling');
      const s = await centre(page, '.booking[data-booking-res-id="9002"]', true);
      const t = await centre(page, '.slot-cell[data-bowling-drop-lane="5"][data-bowling-drop-start="16"]');
      const a = await centre(page, '.slot-cell[data-bowling-drop-lane="7"][data-bowling-drop-start="16"]');
      if (!ok(s && t && a && s.visible && t.visible && a.visible, `MONTAGE (${nom}) : carte 9002, cellules piste 5 et piste 7 / 16:00 a l ecran`)) continue;
      await page.evaluate(() => { window.__doigtsVus = []; });
      const n = await page.evaluate(() => window.__QA_PATCHES__.length);
      const carte = { x: s.x, y: s.y, id: carteDabord ? 1 : 2 };
      const ailleurs = { x: a.x, y: a.y, id: carteDabord ? 2 : 1 };
      const parId = (p, q) => p.id - q.id;
      await envoyer('touchStart', [carteDabord ? carte : ailleurs]);
      await page.waitForTimeout(120);
      await envoyer('touchStart', [carte, ailleurs].sort(parId));
      await page.waitForTimeout(500);
      const leve = await page.evaluate(() => !!document.querySelector('.bowling-drag-ghost-card'));
      for (let i = 1; i <= 12; i += 1) {
        const bouge = { ...carte, x: s.x + ((t.x - s.x) * i) / 12, y: s.y + ((t.y - s.y) * i) / 12 };
        await envoyer('touchMove', [bouge, ailleurs].sort(parId));
        await page.waitForTimeout(16);
      }
      await envoyer('touchEnd', []);
      await page.waitForTimeout(500);
      const res = await page.evaluate((k) => ({ patchs: window.__QA_PATCHES__.length - k, start: (state.reservations.find((x) => x.id === 9002) || {}).startTime, fantome: !!document.querySelector('.bowling-drag-ghost-card'), vus: window.__doigtsVus.join(',') }), n);
      const attendu = carteDabord ? '1c,2' : '1,2c';
      ok(res.vus === attendu, `MONTAGE (${nom}) : la page a vu ${carteDabord ? 'la carte puis un second doigt' : 'un doigt ailleurs puis la carte'} (${res.vus}, attendu ${attendu})`);
      ok(!leve && !res.fantome && res.patchs === 0 && res.start === '14:30', `${nom} : la carte ne se leve pas, rien n est depose (levee ${leve}, ${res.patchs} modification(s), 9002 a ${res.start})`);
    }

    if (errs.length) { console.log('\nErreurs console (planning) :\n' + errs.join('\n')); failures += errs.length; errs.length = 0; }

    // --- G et H : le tableau d analyse --------------------------------------
    const tab = await context.newPage();
    const cdpTab = await context.newCDPSession(tab);
    const doigtTab = doigt(tab, cdpTab);
    tab.on('console', (msg) => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
    tab.on('pageerror', (e) => errs.push('PAGE: ' + e.message));
    await tab.addInitScript(INIT_TABLEAU);
    await tab.goto(`${BASE_URL}/__touch-board?ts=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await tab.waitForFunction(() => window.PinlaneAnalyticsBoard && window.PinlaneCharts, null, { timeout: 10000 });
    await tab.evaluate(() => { localStorage.removeItem('pab-touch'); window.__mountBoard(); });
    await tab.waitForFunction(() => { const r = document.querySelector('.pab'); return r && Number(r.getAttribute('data-render')) >= 1 && document.querySelectorAll('.pab-widget').length >= 3; }, null, { timeout: 10000 });
    const ordre = () => tab.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.pab-widget'), (c) => c.getAttribute('data-metric') + ':' + c.getAttribute('data-viz')));
    const ordreStocke = () => tab.evaluate(() => { try { const o = JSON.parse(localStorage.getItem('pab-touch')); return o && o.widgets ? o.widgets.map((w) => w.metric + ':' + w.viz) : null; } catch (e) { return null; } });
    const corps = (i) => tab.evaluate((k) => { const c = document.querySelectorAll('.pab-widget')[k]; const b = c.querySelector('.pab-widget-body').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, visible: b.top >= 0 && b.bottom <= window.innerHeight }; }, i);

    console.log('\n[G] Tableau d analyse : appui long = edition, puis appui long sur le corps d une carte et glisser');
    const ordre0 = await ordre();
    const c0 = await corps(0);
    if (ok(ordre0.join() === 'revenue:line,byType:donut,reservations:bars' && c0.visible, `MONTAGE : ordre de depart connu et premiere carte a l ecran (${ordre0.join(' | ')})`)) {
      await doigtTab.appui(c0, 700);
      const edition = await attendre(tab, () => document.querySelector('.pab').getAttribute('data-editing') === 'true', null, 1500);
      ok(edition, 'un appui long sur une carte ouvre le mode edition');
      if (edition) {
        await tab.waitForTimeout(250);
        const de = await corps(0);
        const vers = await tab.evaluate(() => { const b = document.querySelectorAll('.pab-widget')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.75 }; });
        await doigtTab.poser(de);
        await tab.waitForTimeout(450);
        // Le doigt n a pas encore bouge : la carte doit DEJA etre levee, sinon
        // rien ne dit que l appui long a pris (le pointeur, lui, ne la leverait
        // qu au premier mouvement).
        const leveeSurPlace = await tab.evaluate(() => { const c = document.querySelectorAll('.pab-widget')[0]; return !!(c && c.classList.contains('pab-dragging') && document.querySelector('.pab-placeholder')); });
        await doigtTab.aller(de, vers, 18, 16);
        await doigtTab.lever();
        await attendre(tab, () => !document.querySelector('.pab-dragging'), null, 2000);
        const ordre1 = await ordre();
        const stocke1 = await ordreStocke();
        ok(leveeSurPlace, 'l appui long leve la carte avant que le doigt bouge');
        ok(ordre1[0] === 'byType:donut' && ordre1[1] === 'revenue:line', `la carte attrapee par son corps passe apres la suivante (${ordre1.join(' | ')})`);
        ok(stocke1 && stocke1.join() === ordre1.join(), `le nouvel ordre est persiste (${stocke1 && stocke1.join(' | ')})`);
        const selection = await tab.evaluate(() => String(window.getSelection() || '').length);
        ok(selection === 0, `aucun texte n est selectionne par l appui long (${selection} caractere(s))`);

        console.log('\n[H] Tableau d analyse : en edition, un doigt qui part tout de suite fait defiler la page');
        await tab.evaluate(() => window.scrollTo(0, 0));
        const avantH = await tab.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
        const ordreAvantH = await ordre();
        const pH = await corps(1);
        // Tout remaniement de la grille pendant le defilement est compte : une
        // carte levee puis reposee reconstruit la grille, meme si l ordre final
        // ne change pas.
        await tab.evaluate(() => {
          window.__remaniements = 0;
          window.__observateur = new MutationObserver((l) => { window.__remaniements += l.length; });
          window.__observateur.observe(document.querySelector('.pab-grid'), { childList: true });
        });
        await doigtTab.glisser(pH, { x: pH.x, y: Math.max(20, pH.y - 300) }, { pas: 16, rythme: 30 });
        await tab.waitForTimeout(500);
        const apresH = await tab.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
        const ordreApresH = await ordre();
        const remaniements = await tab.evaluate(() => { window.__observateur.disconnect(); return window.__remaniements; });
        ok(apresH - avantH >= 60, `la page defile sous le doigt (${avantH} -> ${apresH})`);
        ok(ordreApresH.join() === ordreAvantH.join() && !(await tab.evaluate(() => !!document.querySelector('.pab-dragging'))), 'et aucune carte ne bouge');
        ok(remaniements === 0, `la grille n est pas remaniee pendant le defilement (${remaniements} changement(s))`);

        console.log('\n[K] Tableau d analyse : un geste interrompu rend la carte a sa place');
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.waitForTimeout(150);
        const ordreAvantK = await ordre();
        const deK = await corps(0);
        const versK = await tab.evaluate(() => { const b = document.querySelectorAll('.pab-widget')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.75 }; });
        await doigtTab.poser(deK);
        await tab.waitForTimeout(450);
        await doigtTab.aller(deK, versK, 12, 16);
        // Deposee a cet instant, la carte devait changer de place : sinon
        // l interruption ne prouverait rien (un depot sur place garde l ordre).
        const leveeK = await tab.evaluate(() => {
          const grille = document.querySelector('.pab-grid');
          const carte = grille && grille.querySelector('.pab-dragging');
          if (!carte || !grille.querySelector('.pab-placeholder')) return false;
          const nom = (c) => c.getAttribute('data-metric');
          const enfants = Array.prototype.filter.call(grille.children, (c) => c.classList.contains('pab-widget') || c.classList.contains('pab-placeholder'));
          const actuel = enfants.filter((c) => c.classList.contains('pab-widget')).map(nom).join();
          const depose = enfants.filter((c) => c !== carte).map((c) => (c.classList.contains('pab-placeholder') ? nom(carte) : nom(c))).join();
          return actuel !== depose;
        });
        await doigtTab.interrompre();
        await tab.waitForTimeout(400);
        const ordreApresK = await ordre();
        ok(leveeK, 'MONTAGE : la carte etait levee et visait une autre place au moment de l interruption');
        ok(ordreApresK.join() === ordreAvantK.join() && !(await tab.evaluate(() => !!document.querySelector('.pab-dragging, .pab-placeholder'))), `interrompue, la carte reprend sa place (${ordreApresK.join(' | ')})`);

        // La poignee interdit le defilement (touch-action: none) : le doigt
        // doit la tirer TOUT DE SUITE, sans appui long, comme avant ce gate.
        console.log('\n[O] Tableau d analyse : en edition, la poignee se tire tout de suite au doigt');
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.waitForTimeout(150);
        const ordreAvantO = await ordre();
        const poignee = await tab.evaluate(() => {
          const h = document.querySelectorAll('.pab-widget')[0].querySelector('.pab-handle');
          const b = h.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, visible: getComputedStyle(h).display !== 'none' && b.width > 0 && b.top >= 0 && b.bottom <= window.innerHeight };
        });
        const versO = await tab.evaluate(() => { const b = document.querySelectorAll('.pab-widget')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.75 }; });
        if (ok(poignee.visible, 'MONTAGE : la poignee de la premiere carte est visible (edition) et a l ecran')) {
          await doigtTab.glisser(poignee, versO, { pas: 12 });
          await attendre(tab, () => !document.querySelector('.pab-dragging'), null, 2000);
          const ordreApresO = await ordre();
          ok(ordreApresO[0] === ordreAvantO[1] && ordreApresO[1] === ordreAvantO[0] && !(await tab.evaluate(() => !!document.querySelector('.pab-dragging, .pab-placeholder'))), `tiree sans appui long, la carte passe apres la suivante (${ordreAvantO.join(' | ')} -> ${ordreApresO.join(' | ')})`);
        }
      }
    }

    if (errs.length) { console.log('\nErreurs console (tableau) :\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\ntouch-drag-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Erreurs console :\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\ntouch-drag-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ntouch-drag-check: ALL OK');
}
main();
