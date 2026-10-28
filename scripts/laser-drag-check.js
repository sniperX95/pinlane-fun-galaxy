// Test INTERACTIF du glisser-déposer du planning (Playwright pilote un vrai
// mousedown -> move -> up sur l'app servie localement). Couvre les régressions
// que `browser-modules` (vm, ne charge pas app-main), `visual` (screenshote sans
// piloter) et `node --check` (syntaxe seule) NE VOIENT PAS. Cf. leçon
// « ship-interactive-ui-tested » : ne plus livrer de drag non testé au glisser.
//
// Scénarios :
//   A. Bowling (mode normal) : déposer une carte ne fait PAS remonter la page.
//   B. Bowling : curseur près du bord haut pendant le drag ne happe PAS la page.
//   C. Laser PLEIN ÉCRAN (planning de la maquette E, un rang par départ) :
//      déposer un groupe sur un autre départ ne remet PAS le planning en haut.
//   D. Laser : glisser un groupe placé sur la file « À placer » le dé-planifie,
//      et un vrai sondage du serveur ne le ramène pas.
//   E. Laser : re-glisser son jeton de la file vers un départ le replace.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_DRAG_PORT || 4193);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
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
    ].concat((window.__QA_EXTRA__ || []).map((extra) => ({ ...extra, date }))));
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p, etag) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: etag || `qa-${Date.now()}` } });
    // L empreinte des donnees servies : meme contenu, meme etag.
    const empreinte = (texte) => { let h = 0; for (let i = 0; i < texte.length; i += 1) h = (h * 31 + texte.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    const entete = (init, nom) => { const h = init.headers || {}; if (typeof h.get === 'function') return h.get(nom) || ''; return h[nom] || h[nom.toLowerCase()] || ''; };
    const nativeFetch = window.fetch.bind(window);
    window.__QA_PATCHES__ = [];
    // Les reservations qu un bloc de test pose lui-meme : le serveur les sert,
    // sinon le premier sondage les efface de la journee.
    window.__QA_EXTRA__ = [];
    window.__QA_STORE__ = {};
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'QA', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      // Les notes client internes (API du 2026-10-05, journal Pinlane 378) : la console
      // les precharge pour chaque carte. Absente, elle repondait 404 et ce gate rougissait
      // sur « aucune erreur console ». Meme forme que lib/customer-notes.js (voir le
      // mock commun de planning-matrix-check.js).
      if (u.pathname === '/api/staff-customer-notes' && String(init.method || 'GET').toUpperCase() === 'GET') {
        const sansNote = (id) => ({ eligible: true, clientKey: `p:qa${id}`, note: null });
        const lot = u.searchParams.get('reservationIds');
        if (lot !== null) return J({ ok: true, notesByReservationId: Object.fromEntries(lot.split(',').filter(Boolean).map((id) => [String(Number(id)), sansNote(Number(id))])) });
        return J({ ok: true, ...sansNote(Number(u.searchParams.get('reservationId'))) });
      }
      if (u.pathname === '/api/staff-state') {
        const d = u.searchParams.get('date') || new Date().toISOString().slice(0,10);
        const base = build(d).map(r => window.__QA_STORE__[r.id] ? { ...r, ...window.__QA_STORE__[r.id] } : r);
        // UN SERVEUR QUI CHANGE D ETAG A CHAQUE REPONSE FAIT RE-RENDRE LA CONSOLE
        // A CHAQUE SONDAGE. Pendant un glisser, le re-rendu detruit la carte tiree
        // et le deplacement se perd : c est ce qui rougissait un lancement sur trois.
        const rev = `qa-${d}-${empreinte(JSON.stringify(base))}`;
        if (entete(init, 'If-None-Match') === rev) return new Response(null, { status: 304, headers: { etag: rev } });
        return J({ ok: true, revision: rev, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }, rev);
      }
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

async function seedBowling(page) {
  await page.evaluate(() => {
    // Date FIXE ouverte (samedi 10:00-24:00) → test déterministe, jamais faussé par
    // un jour de fermeture (ex. lundi) où la grille planning ne rend pas de créneaux.
    const d = '2026-07-18';
    state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'bowling'; state.staffTheme = 'dark';
    state.staffLaserPlanningExpanded = false; state.staffPlanningExpanded = false;
    state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
    save(); setView('staff'); renderStaff();
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  const pageTop = () => page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  const setPageTop = (v) => page.evaluate((val) => { (document.scrollingElement || document.documentElement).scrollTop = val; }, v);
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=drag-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await seedBowling(page);
    await page.waitForTimeout(400);
    // LA GRILLE DOIT MESURER QUELQUE CHOSE. Le demarrage de la console est
    // asynchrone : un rendu tardif reprend la main apres le seed et referme le
    // planning. Les cellules existent alors dans le DOM, mais tous leurs
    // rectangles valent zero, et chaque geste tombe dans le vide.
    let grillePrete = false;
    for (let essai = 0; essai < 8 && !grillePrete; essai += 1) {
      grillePrete = await page.evaluate(() => {
        const cadre = document.getElementById('planningGridWrap');
        return Boolean(cadre) && cadre.getBoundingClientRect().height > 100;
      });
      if (!grillePrete) { await seedBowling(page); await page.waitForTimeout(400); }
    }
    ok(grillePrete, 'montage : la grille du planning est rendue et mesurable');

    // --- A : bowling normal, drop au centre, page immobile ---
    console.log('\n[A] Bowling normal : drop ne fait pas remonter la page');
    await setPageTop(400);
    const posA = await page.evaluate(() => {
      // ON CONSTRUIT LA SITUATION AU LIEU DE L ESPERER. Le produit ne retient
      // comme cible de depot que `.slot-cell.clickable`, et le planning a son
      // propre defileur : selon la hauteur rendue, la rangee visee tombait hors
      // de la bande utile et il ne restait AUCUNE cellule libre atteignable.
      const cadre = document.getElementById('planningGridWrap');
      const rc = cadre ? cadre.getBoundingClientRect() : null;
      const cellules = [...document.querySelectorAll('.slot-cell.clickable[data-bowling-drop-lane="5"]')];
      const viser = cellules.find((c) => Number(c.dataset.bowlingDropStart) === 16)
        || cellules[Math.floor(cellules.length / 2)] || null;
      // LA BANDE UTILE EST CELLE DU PLANNING. Le produit n accepte un depot que
      // dans #planningGridWrap : c est ce rectangle qui decide, pas une
      // constante. On y amene la cellule visee avec le defileur qui la porte.
      const milieu = rc ? rc.top + rc.height / 2 : 325;
      if (viser) {
        let defileur = viser.parentElement;
        while (defileur && defileur !== cadre && defileur.scrollHeight <= defileur.clientHeight + 4) defileur = defileur.parentElement;
        if (defileur && defileur.scrollHeight > defileur.clientHeight + 4) {
          for (let essai = 0; essai < 12; essai += 1) {
            const b = viser.getBoundingClientRect();
            const ecart = (b.top + b.height / 2) - milieu;
            if (Math.abs(ecart) <= 2) break;
            defileur.scrollTop += ecart;
          }
        }
      }
      const src = document.querySelector('.booking[data-booking-res-id="9002"]');
      const bs = src ? src.getBoundingClientRect() : null;
      const bt = viser ? viser.getBoundingClientRect() : null;
      const dedans = (b) => Boolean(rc) && Boolean(b) && b.height > 4
        && (b.top + b.height / 2) > rc.top + 4 && (b.top + b.height / 2) < rc.bottom - 4;
      return {
        src: bs ? { x: bs.x + bs.width / 2, y: bs.y + bs.height / 2 } : null,
        tgt: bt ? { x: bt.x + bt.width / 2, y: bt.top + bt.height / 2 } : null,
        heure: viser ? Number(viser.dataset.bowlingDropStart) : null,
        libres: cellules.length,
        visible: dedans(bs) && dedans(bt),
        mesure: `cadre ${rc ? Math.round(rc.top) : '?'}-${rc ? Math.round(rc.bottom) : '?'}, carte ${bs ? Math.round(bs.top + bs.height / 2) : '?'}, cible ${bt ? Math.round(bt.top + bt.height / 2) : '?'}`,
        before: numToTime(getBowlingWindowsFromReservation(state.reservations.find(x=>x.id===9002)||{})[0]?.start),
      };
    });
    ok(Boolean(posA.src) && Boolean(posA.tgt) && posA.visible,
      `montage : carte 9002 et cellule libre de la piste 5 dans le planning (${posA.libres} libre(s), cible ${posA.heure}h, ${posA.mesure})`);
    // LE POINT DE DEPART SE LIT APRES LE MONTAGE : amener la cible dans la vue
    // peut faire defiler, et ce defilement-la n est pas un saut pendant le depot.
    const beforeA = await pageTop();
    await page.mouse.move(posA.src.x, posA.src.y); await page.mouse.down();
    await page.mouse.move(posA.src.x + 8, posA.src.y + 8, { steps: 2 });
    await page.mouse.move(posA.tgt.x, posA.tgt.y, { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(350);
    const afterA = await pageTop();
    const movedA = await page.evaluate(() => numToTime(getBowlingWindowsFromReservation(state.reservations.find(x=>x.id===9002)||{})[0]?.start));
    ok(Math.abs(afterA - beforeA) <= 20, `page immobile pendant le drop (${beforeA} -> ${afterA})`);
    ok(movedA !== posA.before, `la résa 9002 a bien été déplacée (${posA.before} -> ${movedA})`);

    // --- B : bowling, curseur près du bord haut, page immobile ---
    console.log('\n[B] Bowling : curseur au bord haut ne happe pas la page');
    await page.evaluate(() => { state.reservations = window.__QA_BUILD__(state.currentDate); save(); renderStaff(); });
    await page.waitForTimeout(150); await setPageTop(500);
    const beforeB = await pageTop();
    const posB = await page.evaluate(() => { const el = document.querySelector('.booking[data-booking-res-id="9004"]') || document.querySelector('.booking'); const b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; });
    await page.mouse.move(posB.x, posB.y); await page.mouse.down();
    await page.mouse.move(posB.x + 8, posB.y + 8, { steps: 2 });
    await page.mouse.move(posB.x, 30, { steps: 4 }); await page.waitForTimeout(600);
    const duringB = await pageTop();
    await page.mouse.up(); await page.waitForTimeout(150);
    ok(Math.abs(duringB - beforeB) <= 20, `page immobile malgré le bord haut (${beforeB} -> ${duringB})`);

    // --- F : le toast de confirmation ne doit pas voler les clics ---
    // Movsar, revue manager : « les reservations de 30 minutes dont le changement
    // d heure ne s applique pas ». Le drag lui-meme fonctionne (A et B le
    // prouvent) ; ce qui bloque, c est le toast affiche 2,5 s apres CHAQUE
    // deplacement. Il est en position fixed au-dessus du planning, et une carte
    // de 30 min ne fait que ~22 px de haut contre 40 px de toast : elle peut
    // etre TOTALEMENT recouverte, et n a alors plus aucun point de prise. Une
    // carte d 1 h ou 2 h en depasse toujours, d ou un defaut qui ne se voit que
    // sur les demi-heures.
    console.log('\n[F] Le toast de confirmation ne vole pas les clics du planning');
    // Le toast ne fait que ~248 px de large, centre dans la fenetre : la carte
    // doit tomber dans son rectangle en X ET en Y, sinon on ne teste rien. On
    // cherche donc d abord la piste dont la colonne passe sous son centre, et on
    // pose la reservation de 30 min sur CELLE-LA.
    const pisteF = await page.evaluate(() => {
      state.reservations = window.__QA_BUILD__(state.currentDate);
      state.staffResourceView = 'bowling'; state.staffPlanningExpanded = false;
      save(); renderStaff();
      toast('Bowling deplace a 16:00 piste 5');
      const tr = document.getElementById('toast').getBoundingClientRect();
      const centreX = tr.left + tr.width / 2;
      const cellule = [...document.querySelectorAll('.slot-cell[data-bowling-drop-lane]')]
        .find((c) => { const b = c.getBoundingClientRect(); return b.left <= centreX && b.right >= centreX; });
      return cellule ? Number(cellule.dataset.bowlingDropLane) : null;
    });
    if (ok(Number.isFinite(pisteF), `une piste passe sous le toast (piste ${pisteF})`)) {
      await page.evaluate((piste) => {
        // DANS LA VERITE DU SERVEUR D ABORD. Poussee seulement en memoire, elle
        // disparaissait au premier sondage (replaceReservationsForDate remplace
        // la journee par ce que le serveur renvoie).
        const resa = { id: 9020, name: 'Demi heure #9020', phone: '+32470860020', email: 'f@x.test', date: state.currentDate, startTime: '20:00', duration: 0.5, lanes: [piste], status: 'confirmed', pax: 2, price: 12, type: 'bowling', label: 'Bowling 30 min' };
        window.__QA_EXTRA__ = [{ ...resa }];
        state.reservations.push(resa);
        save(); renderStaff();
      }, pisteF);
      await page.waitForTimeout(350);
      // On CONSTRUIT la situation au lieu de l esperer : le planning est fait
      // defiler jusqu a ce que la carte tombe dans le rectangle du toast.
      // LE MONTAGE SE VERIFIE JUSTE AVANT LE GESTE. Un rafraichissement de la
      // console remplace `state.reservations`, et la reservation posee a la main
      // plus haut disparait alors sans bruit : le drag ne porterait plus sur
      // rien, et l assertion d apres serait verte pour une carte volatilisee.
      const reposee = await page.evaluate((piste) => {
        if (state.reservations.some((x) => x.id === 9020)) return false;
        state.reservations.push({ id: 9020, name: 'Demi heure #9020', phone: '+32470860020', email: 'f@x.test', date: state.currentDate, startTime: '20:00', duration: 0.5, lanes: [piste], status: 'confirmed', pax: 2, price: 12, type: 'bowling', label: 'Bowling 30 min' });
        save(); renderStaff();
        return true;
      }, pisteF);
      if (reposee) await page.waitForTimeout(350);
      ok(await page.evaluate(() => state.reservations.some((x) => x.id === 9020)),
        `montage : la reservation de 30 min est bien en place${reposee ? ' (reposee apres un rafraichissement)' : ''}`);
      const posF = await page.evaluate((piste) => {
        toast('Bowling deplace a 16:00 piste 5');
        const toastEl = document.getElementById('toast');
        const carte = document.querySelector('.booking[data-booking-res-id="9020"]');
        if (!toastEl || !carte) return { erreur: 'carte ou toast absent' };
        let scroller = carte.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight + 4) scroller = scroller.parentElement;
        const tr = toastEl.getBoundingClientRect();
        const vise = tr.top + tr.height / 2;
        for (let essai = 0; essai < 12; essai += 1) {
          const cr = carte.getBoundingClientRect();
          const ecart = (cr.top + cr.height / 2) - vise;
          if (Math.abs(ecart) <= 2) break;
          if (scroller) scroller.scrollTop += ecart;
          else (document.scrollingElement || document.documentElement).scrollTop += ecart;
        }
        const cr = carte.getBoundingClientRect();
        const point = { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 };
        const dansLeToast = point.x >= tr.left && point.x <= tr.right && point.y >= tr.top && point.y <= tr.bottom;
        const dessous = document.elementFromPoint(point.x, point.y);
        const autrePiste = piste === 7 ? 5 : 7;
        // LA CIBLE EST NOMMEE, PAS DEVINEE. Le repli "n importe quelle cellule
        // de cette piste" tombait parfois sur un creneau ou le deplacement est
        // refuse, et la reservation disparaissait de la liste : un lancement sur
        // quatre sortait rouge, sans rien dire du produit. Si la cellule de 16:00
        // n existe pas, le montage le DIT au lieu de viser ailleurs.
        const cible = document.querySelector(`.slot-cell[data-bowling-drop-lane="${autrePiste}"][data-bowling-drop-start="16"]`);
        const cb = cible ? cible.getBoundingClientRect() : null;
        return {
          hauteurCarte: Math.round(cr.height),
          hauteurToast: Math.round(tr.height),
          dansLeToast,
          dessous: dessous ? `${dessous.tagName}#${dessous.id || 'sans-id'}` : 'rien',
          cestLeToast: !!(dessous && (dessous.id === 'toast' || (dessous.closest && dessous.closest('#toast')))),
          point,
          cible: cb ? { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 } : null,
          avant: numToTime(getBowlingWindowsFromReservation(state.reservations.find((x) => x.id === 9020) || {})[0]?.start),
        };
      }, pisteF);
      if (ok(posF && !posF.erreur && posF.cible, `situation construite (carte ${posF && posF.hauteurCarte}px, toast ${posF && posF.hauteurToast}px)`)) {
        // Prerequis : sans lui, les assertions suivantes ne prouveraient rien.
        ok(posF.dansLeToast, `le point de prise tombe DANS le rectangle du toast (${posF.dansLeToast})`);
        ok(!posF.cestLeToast, `et atteint quand meme la carte, pas le toast (${posF.dessous})`);
        await page.mouse.move(posF.point.x, posF.point.y); await page.mouse.down();
        await page.mouse.move(posF.point.x + 8, posF.point.y - 8, { steps: 2 });
        await page.mouse.move(posF.cible.x, posF.cible.y, { steps: 8 });
        await page.mouse.up(); await page.waitForTimeout(400);
        // ON LA RETROUVE PAR SON NOM AUTANT QUE PAR SON IDENTIFIANT. Une
        // reservation injectee a la main peut etre remplacee par un
        // rafraichissement de la console pendant le geste : elle revient alors
        // du serveur avec un autre identifiant, et chercher 9020 rendait
        // , ce qui satisfaisait l ancienne assertion.
        const apresBrut = await page.evaluate(() => {
          const parId = state.reservations.find((x) => x.id === 9020);
          const parNom = state.reservations.find((x) => String(x.name || "").includes("#9020"));
          const r = parId || parNom || null;
          return { heure: r ? numToTime(getBowlingWindowsFromReservation(r)[0]?.start) : null, total: state.reservations.length, parNom: Boolean(parNom && !parId) };
        });
        const apresF = apresBrut.heure;
        // ELLE DOIT EXISTER ENCORE. Sans cette moitie, une reservation disparue
        // rendait cette ligne verte : `undefined !== '20:00'` est vrai.
        ok(Boolean(apresF) && apresF !== posF.avant, `la resa de 30 min a bien bouge malgre le toast (${posF.avant} -> ${apresF}, ${apresBrut.total} resa(s)${apresBrut.parNom ? ', retrouvee par son nom' : ''})`);
        // CONTRE-EPREUVE : sans toast, le meme geste doit marcher. Si celle-ci
        // echoue, l assertion precedente ne prouvait rien du tout.
        const posG = await page.evaluate(() => {
          document.getElementById('toast').classList.add('hidden');
          const carte = document.querySelector('.booking[data-booking-res-id="9020"]');
          const cible = document.querySelector('.slot-cell[data-bowling-drop-lane="1"][data-bowling-drop-start="12"]') || document.querySelector('.slot-cell[data-bowling-drop-lane="1"]');
          if (!carte || !cible) return null;
          const cr = carte.getBoundingClientRect(); const cb = cible.getBoundingClientRect();
          return { src: { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 }, tgt: { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, avant: (state.reservations.find((x) => x.id === 9020) || {}).startTime };
        });
        if (ok(!!posG, 'contre-epreuve : carte et cible presentes')) {
          await page.mouse.move(posG.src.x, posG.src.y); await page.mouse.down();
          await page.mouse.move(posG.src.x + 8, posG.src.y - 8, { steps: 2 });
          await page.mouse.move(posG.tgt.x, posG.tgt.y, { steps: 8 });
          await page.mouse.up(); await page.waitForTimeout(400);
          const apresG = await page.evaluate(() => numToTime(getBowlingWindowsFromReservation(state.reservations.find((x) => x.id === 9020) || {})[0]?.start));
          ok(apresG !== posG.avant, `sans toast, le meme geste deplace bien la carte (${posG.avant} -> ${apresG})`);
        }
      }
    }

    // --- C/D/E : laser plein écran (planning de la maquette E) ---
    // Le planning defile dans son cadre (lpDefileur) ; pendant un glisser, il
    // defile seul a moins de 96 px du haut du cadre et du haut de la file
    // « À placer ». Groupe et cible s amenent entre les deux : le trajet du
    // pointeur ne fait alors rien defiler, et le depot vise ce qu on a choisi.
    await page.evaluate(() => { state.reservations = window.__QA_BUILD__(state.currentDate); state.staffResourceView = 'laser'; state.staffLaserPlanningExpanded = true; save(); renderStaff(); });
    await page.waitForTimeout(400);
    // Le cadre qui defile, quel qu il soit (lpDefileur) : depuis que la journee
    // laser tient a l ecran, en plein ecran c est la page qui defile.
    const cadreLaser = () => page.evaluate(() => { const c = lpDefileur(); return c ? Math.round(c.scrollTop) : null; });
    const amener = (selecteur) => page.evaluate((selecteur) => {
      const el = document.querySelector(selecteur);
      const cadre = lpDefileur();
      if (!el || !cadre) return { raison: `${selecteur} : ${el ? 'aucun cadre de defilement' : 'absent'}` };
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
      if (!(b.height > 4 && y > haut && y < bas)) return { raison: `${selecteur} au centre ${Math.round(y)}, bande ${Math.round(haut)}-${Math.round(bas)}` };
      return { x: b.left + Math.min(b.width / 2, 60), y };
    }, selecteur);
    // Un depart vide, sans personne en jeu, le plus proche du groupe 9010.
    const departVide = () => page.evaluate(() => {
      const g = document.querySelector('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]');
      const repere = g ? g.getBoundingClientRect().top : innerHeight / 2;
      const vides = [...document.querySelectorAll('#laserPlanningGridWrap .lp-dep.is-vide[data-lp-t]')]
        .filter((d) => (d.querySelector('.lp-dep__n b') || {}).textContent === '0')
        .map((d) => ({ t: Number(d.dataset.lpT), d: Math.abs(d.getBoundingClientRect().top - repere) }))
        .filter((o) => o.d > 100)
        .sort((a, b) => a.d - b.d);
      return vides.length ? vides[0].t : null;
    });
    const fini = () => page.waitForFunction(() => !lpEtat.enCours && !lpEtat.glisse && !lpEtat.geste, null, { timeout: 8000 }).then(() => true, () => false);

    console.log('\n[C] Laser plein écran : drop ne remet pas le planning en haut');
    const montageC = await page.evaluate(() => {
      const cadre = lpDefileur();
      return { cadre: cadre ? cadre.id || cadre.className || cadre.tagName : null, defilable: Boolean(cadre) && cadre.scrollHeight > cadre.clientHeight + 1, course: cadre ? cadre.scrollHeight - cadre.clientHeight : 0, departs: document.querySelectorAll('#laserPlanningGridWrap .lp-dep').length, groupe: Boolean(document.querySelector('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]')) };
    });
    if (ok(Boolean(montageC.cadre) && montageC.defilable && montageC.departs > 0 && montageC.groupe, `planning laser défilable en plein écran, groupe 9010 dans son départ (${JSON.stringify(montageC)})`)) {
      const tC = await departVide();
      const srcC = await amener('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]');
      if (ok(tC !== null && srcC && srcC.y, `un départ vide pour le drop (${tC})${srcC && srcC.raison ? ' :: ' + srcC.raison : ''}`)) {
        await page.mouse.move(srcC.x, srcC.y); await page.mouse.down();
        await page.mouse.move(srcC.x + 8, srcC.y + 8, { steps: 2 });
        const tgtC = await amener(`#laserPlanningGridWrap .lp-dep[data-lp-t="${tC}"] .lp-dep__jauge`);
        const beforeC = await cadreLaser();
        if (ok(tgtC && tgtC.y, `MONTAGE : groupe levé, départ ${tC} dans la vue${tgtC && tgtC.raison ? ' :: ' + tgtC.raison : ''}`)) {
          await page.mouse.move(tgtC.x, tgtC.y, { steps: 8 });
        }
        await page.mouse.up();
        const posee = await fini();
        await page.waitForTimeout(400);
        const afterC = await cadreLaser();
        const movedC = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); const w = getLaserWindowsFromReservation(r); return w.length ? w[0].start : null; });
        // Descendu de plus que la tolerance avant le lacher, sinon un retour en
        // haut passerait inapercu (la journee tient a l ecran : la page ne
        // defile plus que d une trentaine de pixels en plein ecran).
        ok(beforeC !== null && beforeC > 20 && afterC !== null && Math.abs(afterC - beforeC) <= 20, `planning immobile pendant le drop (${beforeC} -> ${afterC}, course ${montageC.course})`);
        ok(posee && movedC !== null && Math.abs(Number(movedC) - Number(tC)) <= 0.01, `la partie s'est bien déplacée (${tC}, lu ${movedC})`);
      }
    }

    console.log('\n[D] Laser : glisser un groupe placé vers la file « À placer » = dé-planifier');
    const srcD = await amener('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]');
    if (ok(srcD && srcD.y && await page.evaluate(() => Boolean(document.querySelector('#laserPlanningGridWrap .lp-file'))), `groupe placé + file « À placer » présents${srcD && srcD.raison ? ' :: ' + srcD.raison : ''}`)) {
      const nD = await page.evaluate(() => (window.__QA_PATCHES__ || []).length);
      await page.mouse.move(srcD.x, srcD.y); await page.mouse.down();
      await page.mouse.move(srcD.x + 8, srcD.y + 8, { steps: 2 });
      const fileD = await page.evaluate(() => { const q = document.querySelector('#laserPlanningGridWrap .lp-file').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
      await page.mouse.move(fileD.x, fileD.y, { steps: 10 }); await page.mouse.up();
      await fini();
      await page.waitForTimeout(450);
      const afterD = await page.evaluate((n) => {
        const r = state.reservations.find(x => x.id === 9010);
        const patchs = (window.__QA_PATCHES__ || []).slice(n);
        const patch = patchs.slice(-1)[0] || null;
        return { windows: getLaserWindowsFromReservation(r).length, laserManual: !!r.opsPlan?.laserManual, pending: getPendingLaserPasses(state.currentDate).map(p => p.reservation.id), inQueue: !!document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="9010"]'), onGrid: !!document.querySelector('#laserPlanningGridWrap .lp-dep [data-laser-res-id="9010"], #laserPlanningGridWrap .lp-cases i[data-lp-id="9010"]'), patchs: patchs.length, skipReplan: patch ? !!patch.activityMove : null, patchManual: patch ? !!patch.activityMove?.unplace : null };
      }, nD);
      ok(afterD.windows === 0, 'la partie quitte le planning');
      ok(afterD.laserManual === true, 'opsPlan.laserManual = true');
      ok(afterD.pending.includes(9010), 'apparaît dans « À placer »');
      ok(afterD.inQueue && !afterD.onGrid, 'jeton dans la file, plus dans aucun départ');
      ok(afterD.patchs === 1 && afterD.skipReplan === true && afterD.patchManual === true, `UN PATCH cible, qui persiste le retrait (activityMove.unplace) (${afterD.patchs})`);
      // survit à un vrai sondage du serveur (le faux serveur garde le dossier
      // tel que le PATCH l a laisse)
      const sonde = await page.evaluate(async () => { try { await syncDateReservations(state.currentDate); return true; } catch (e) { return String(e.message); } });
      await page.waitForTimeout(300);
      const poll = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); return { w: getLaserWindowsFromReservation(r).length, p: getPendingLaserPasses(state.currentDate).map(x=>x.reservation.id), jeton: !!document.querySelector('#laserPlanningGridWrap .lp-jeton[data-laser-res-id="9010"]') }; });
      ok(sonde === true && poll.w === 0 && poll.p.includes(9010) && poll.jeton, `reste dé-placé après un sondage du serveur (${JSON.stringify({ sonde, ...poll })})`);

      console.log('\n[E] Laser : re-glisser le jeton en attente vers un départ = replacer');
      const jetonE = await page.evaluate(() => { const j = document.querySelector('#laserPlanningGridWrap .lp-file .lp-jeton[data-laser-res-id="9010"]'); if (!j) return null; const c = j.getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2, visible: c.top >= 0 && c.bottom <= innerHeight }; });
      const tE = await departVide();
      if (ok(jetonE && jetonE.visible && tE !== null, `jeton en attente + départ vide présents (${tE})`)) {
        // Saisi dans la file, il se leve sans quitter la file (pas de bord) ;
        // la cible s amene dans la bande, et le pointeur y saute d un coup : la
        // bande du bas, au-dessus de la file, ferait defiler au passage.
        await page.mouse.move(jetonE.x, jetonE.y); await page.mouse.down();
        await page.mouse.move(jetonE.x + 8, jetonE.y, { steps: 2 });
        const tgtE = await amener(`#laserPlanningGridWrap .lp-dep[data-lp-t="${tE}"] .lp-dep__jauge`);
        const permis = await page.evaluate((t) => ({ leve: Boolean(lpEtat.glisse), classes: (document.querySelector(`#laserPlanningGridWrap .lp-dep[data-lp-t="${t}"]`) || {}).className || '' }), tE);
        if (ok(tgtE && tgtE.y && permis.leve && /\bis-cible\b/.test(permis.classes), `MONTAGE : jeton levé, le départ ${tE} l accepte (${permis.classes})${tgtE && tgtE.raison ? ' :: ' + tgtE.raison : ''}`)) {
          await page.mouse.move(tgtE.x, tgtE.y, { steps: 1 });
        }
        await page.mouse.up();
        await fini();
        await page.waitForTimeout(450);
        const afterE = await page.evaluate(() => { const r = state.reservations.find(x=>x.id===9010); const w = getLaserWindowsFromReservation(r); return { start: w.length ? w[0].start : null, pending: getPendingLaserPasses(state.currentDate).map(p=>p.reservation.id), onGrid: !!document.querySelector('#laserPlanningGridWrap .lp-dep .lp-g[data-laser-res-id="9010"]'), jeton: !!document.querySelector('#laserPlanningGridWrap .lp-jeton[data-laser-res-id="9010"]') }; });
        ok(afterE.start !== null && Math.abs(Number(afterE.start) - Number(tE)) <= 0.01, `re-placée au départ ${tE} (lu ${afterE.start})`);
        ok(!afterE.pending.includes(9010) && afterE.onGrid && !afterE.jeton, 'de retour sur le planning, plus dans la file');
      }
    }

    // --- G : la puce de retard ne recouvre rien ---
    // Movsar, 2026-08-26 : « le logo pour laser game est cache par le logo en
    // retard ». La puce etait posee en position absolue en haut a droite de la
    // carte, donc PAR-DESSUS la tete. Mesure avant correctif : puce de 42 px sur
    // une tete de 105 px, nom recouvert.
    console.log('\n[G] La puce de retard prend sa place au lieu de flotter dessus');
    const g = await page.evaluate(async () => {
      state.reservations = window.__QA_BUILD__(state.currentDate);
      state.staffResourceView = 'bowling'; state.staffPlanningExpanded = false;
      const r = state.reservations.find((x) => x.id === 9004) || state.reservations[0];
      r.opsPlan = Object.assign({}, r.opsPlan || {}, { delayFlag: { minutes: 10, from: '18:00', to: '18:10' } });
      save(); renderStaff();
      // On attend la CONDITION, pas une duree. Un sleep fixe de 500 ms mesure la
      // machine : sous charge (suite complete, plusieurs navigateurs en
      // parallele) le rendu n'etait pas fini et le gate rougissait alors que le
      // code etait sain. Faux rouge observe le 2026-09-09 dans test:ops:all,
      // vert des que le gate tournait seul.
      // L'echeance reste BORNEE : si la puce n'apparait jamais, la boucle
      // s'epuise et le message d'erreur d'origine part quand meme. Attendre la
      // condition ne desarme pas l'assertion, ca supprime seulement le hasard.
      const jusqua = Date.now() + 5000;
      let carte = null;
      let puce = null;
      while (Date.now() < jusqua) {
        carte = document.querySelector(`.booking[data-booking-res-id="${r.id}"]`);
        puce = carte ? carte.querySelector('.delay-indicator') : null;
        if (carte && puce) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      if (!carte) return { erreur: 'aucune carte' };
      if (!puce) return { erreur: 'aucune puce de retard' };
      const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, w: Math.round(b.width) }; };
      const chevauche = (m, n) => !(m.right <= n.x + 0.5 || n.right <= m.x + 0.5 || m.bottom <= n.y + 0.5 || n.bottom <= m.y + 0.5);
      const rp = rect(puce);
      const voisins = [...carte.querySelectorAll('.booking-name, [class*="flag-"]')];
      return {
        id: r.id,
        largeurPuce: rp.w,
        recouvre: voisins.filter((v) => chevauche(rp, rect(v))).map((v) => String(v.className).slice(0, 24)),
        voisins: voisins.length,
      };
    });
    if (ok(g && !g.erreur, `carte en retard rendue (${g && g.erreur ? g.erreur : `puce ${g.largeurPuce}px, ${g.voisins} voisin(s)`})`)) {
      ok(g.recouvre.length === 0, `la puce ne recouvre ni le nom ni les marques (${g.recouvre.join(', ') || 'rien'})`);
      // CONTRE-EPREUVE PAR MUTATION : on lui rend sa position absolue. Elle DOIT
      // se remettre a recouvrir, sinon l assertion ne mesure rien.
      // CETTE CONTRE-EPREUVE COURAIT APRES LE NAVIGATEUR. Elle posait le style
      // puis mesurait 200 ms plus tard, en montre. Sous la charge de la suite
      // complete (elle passe en 101e position sur 170), le recalcul de style
      // n'etait pas fini : la puce etait encore dans le flux, elle ne recouvrait
      // rien, et le gate rougissait en annoncant « 0 element » comme si c'etait
      // une mesure. Constate le 2026-09-03 : vert en isole deux fois de suite,
      // rouge dans la suite, sur un diff qui ne touche ni le markup de la carte
      // ni pinlane-staff.css. Elle visait en plus la PREMIERE puce du document
      // (`.booking .delay-indicator`), pas forcement la carte qu'on venait de
      // mesurer. Une contre-epreuve qui court peut mentir dans les deux sens :
      // elle attend maintenant que la mutation MORDE, sur la MEME carte, et son
      // montage est asserte avant son verdict.
      const mute = await page.evaluate(async (resId) => {
        const s = document.createElement('style');
        s.textContent = '.booking .delay-indicator { position: absolute !important; top: 3px; right: 4px; }';
        document.head.appendChild(s);
        const carte = document.querySelector(`.booking[data-booking-res-id="${resId}"]`);
        const puce = carte && carte.querySelector('.delay-indicator');
        let appliquee = false;
        if (puce) {
          const limite = Date.now() + 3000;
          while (Date.now() < limite) {
            if (getComputedStyle(puce).position === 'absolute') { appliquee = true; break; }
            await new Promise((res) => requestAnimationFrame(() => res()));
          }
        }
        const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; };
        const chevauche = (m, n) => !(m.right <= n.x + 0.5 || n.right <= m.x + 0.5 || m.bottom <= n.y + 0.5 || n.bottom <= m.y + 0.5);
        const voisins = carte ? [...carte.querySelectorAll('.booking-name, [class*="flag-"]')] : [];
        const combien = (carte && puce && appliquee)
          ? voisins.filter((v) => chevauche(rect(puce), rect(v))).length
          : 0;
        s.remove();
        return { appliquee, voisins: voisins.length, combien, carteTrouvee: Boolean(carte) };
      }, g.id);
      // LE MONTAGE D'ABORD : sans carte, sans voisin ou sans mutation reellement
      // appliquee, « 0 recouvrement » ne dit rien du produit.
      if (ok(mute.carteTrouvee && mute.voisins > 0 && mute.appliquee,
        `montage de la contre-epreuve : carte ${g.id} trouvee, ${mute.voisins} voisin(s), position absolue reellement appliquee (${mute.appliquee})`)) {
        ok(mute.combien > 0, `contre-preuve : en position absolue, la puce recouvre de nouveau ${mute.combien} element(s) -> le gate sait rougir`);
      }
    }

    // --- H : un refus reste affiche assez longtemps pour etre lu ---
    // Movsar, 2026-08-26 : « on a pas le temps de lire ici la notif ». Le delai
    // etait fixe a 3,6 s pour tous les messages ; le refus de deplacement fait
    // ~45 mots, soit environ 13 s de lecture.
    console.log('\n[H] Un refus reste lisible, une confirmation reste breve');
    const long = "Cette réservation contient un Laser Game : en déplaçant le bowling, sa partie passerait à 20:30, et l'arène n'est pas libre à ce moment. Choisissez un autre horaire de bowling, ou déplacez d'abord la partie laser.";
    await page.evaluate((texte) => { showPlanningMoveNotice('Le Laser Game suit le déplacement', texte, 'warning'); }, long);
    await page.waitForTimeout(4200);
    const encoreLa = await page.evaluate(() => !!document.querySelector('#planningMoveNotice.is-visible'));
    ok(encoreLa, `un refus de 45 mots est encore lisible apres 4,2 s (${encoreLa})`);
    // CONTRE-EPREUVE : une confirmation courte, elle, s efface vite. Sans elle,
    // « ca reste affiche » passerait meme si la notice ne partait plus jamais.
    await page.evaluate(() => { showPlanningMoveNotice('Deplace', '', 'success'); });
    await page.waitForTimeout(2400);
    const partie = await page.evaluate(() => !!document.querySelector('#planningMoveNotice.is-visible'));
    ok(!partie, `une confirmation breve s efface bien apres 2,4 s (visible: ${partie})`);

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); failures += errs.length; }
  } catch (e) {
    console.error('\nlaser-drag-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nlaser-drag-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nlaser-drag-check: ALL OK');
}
main();
