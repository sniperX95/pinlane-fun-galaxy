// LE RE-RENDU NE DOIT PAS SE VOIR (gate ne le 2026-08-26).
//
// Movsar, trois fois de suite : « ya toujours le sorte de refresh en gros, ca
// rafraichis toutes les resa affichees toutes les 3 secondes, on VOIT que ca
// rafraichit » puis « quand on coche ou decoche ca rafraichit 2 fois ».
//
// Ce gate ne verifie pas une PRESENCE, il compte des EVENEMENTS : les
// animations et transitions qui DEMARRENT reellement pendant que la console
// travaille. La regle produit est simple et se teste :
//   - la donnee se rafraichit (les rendus ont bien lieu, le poll fait son
//     travail) ;
//   - l ecran ne bouge pas (zero animation rejouee) ;
//   - ce que le staff avait sous les yeux ne saute pas (defilement et focus
//     conserves dans la fiche).
// Deux contre-preuves par mutation prouvent que le gate sait rougir.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_REFRESH_PORT || 4252);
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

// Date du CENTRE, calculee comme todayStr() de l app (booking-core.js, fuseau
// Europe/Brussels), jamais dans le fuseau de la machine : juste sur un poste
// belge, fausse sur un runner CI en UTC entre 22 h et minuit UTC.
const dstr = (off) => {
  const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const lire = (type) => Number(jour.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(lire('year'), lire('month') - 1, lire('day') + off)).toISOString().slice(0, 10);
};

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const today = dstr(0);
  await page.addInitScript(({ expiresAt, today }) => {
    const perms = ['dashboard.view','planning.view','planning.bowling','planning.laser','reservations.view','reservations.create','reservations.edit','reservations.status','reservations.quick','clients.view','payments.view','payments.markPaid','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const build = () => ([
      { id: 9020, name: 'Anniversaire Emma', phone: '+32470860020', email: 'emma@x.test', date: today, startTime: '15:00', duration: 1, totalDuration: 2.5, lanes: [3,4], status: 'pending', pax: 8, price: 312, basePrice: 312, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', centerId: 'libramont', channel: 'public', activityProgress: {}, extras: [],
        opsPlan: { staffSummary: 'Formule 4 anniversaire', timeline: [
          { type:'service', label:'Arrivée & accueil', resourceType:'bar_service', startTime:'14:50', endTime:'15:00' },
          { type:'activity', activityId:'minigolf_blacklight', label:'Minigolf Blacklight', resourceType:'soft_capacity', startTime:'15:00', endTime:'15:30', countIndex:1 },
          { type:'activity', activityId:'bowling', label:'Bowling', resourceType:'bowling_lane', startTime:'15:30', endTime:'16:30', countIndex:1 },
          { type:'activity', activityId:'laser_game', label:'Laser Game', resourceType:'laser_arena', startTime:'16:45', endTime:'17:10', countIndex:1 },
          { type:'activity', activityId:'laser_game', label:'Laser Game', resourceType:'laser_arena', startTime:'17:15', endTime:'17:40', countIndex:2 },
        ], resourceBlocks: [
          { resourceType:'bowling_lane', activityId:'bowling', startTime:'15:30', endTime:'16:30', lanes:[3,4], countIndex:1 },
          { resourceType:'laser_arena', activityId:'laser_game', startTime:'16:45', endTime:'17:10', countIndex:1 },
          { resourceType:'laser_arena', activityId:'laser_game', startTime:'17:15', endTime:'17:40', countIndex:2 },
        ] } },
      { id: 9021, name: 'Groupe Lucas', phone: '+32470860021', email: 'lucas@x.test', date: today, startTime: '11:00', duration: 1, totalDuration: 1, lanes: [5,6], status: 'arrived', pax: 6, price: 156, basePrice: 156, type: 'bowling', label: 'Bowling', centerId: 'libramont', channel: 'public', activityProgress: {}, extras: [] },
      { id: 9022, name: 'Ecole Saint Jean', phone: '+32470860022', email: 'ecole@x.test', date: today, startTime: '13:00', duration: 2, totalDuration: 2, lanes: [1,2], status: 'paid', pax: 24, price: 480, basePrice: 480, type: 'bowling', label: 'Bowling', centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, extras: [] },
      { id: 9023, name: 'Laser Team', phone: '+32470860023', email: 'team@x.test', date: today, startTime: '18:00', duration: 0.5, totalDuration: 0.5, lanes: [], status: 'pending', pax: 10, price: 100, basePrice: 100, type: 'laser', label: 'Laser Game', centerId: 'libramont', channel: 'public', activityProgress: {}, extras: [] },
    ]);
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    window.__QA_STORE__ = {};
    // ETAG STABLE : le serveur reel renvoie 304 quand rien ne change. Un etag
    // neuf a chaque appel forcerait une resynchronisation permanente et
    // fabriquerait le symptome qu on cherche a mesurer.
    const J = (p, etag) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: etag || 'qa-stable' } });
    const nativeFetch = window.fetch.bind(window);
    window.__QA_POLLS__ = 0;
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const m = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') {
        window.__QA_POLLS__ += 1;
        let base = build().map(r => window.__QA_STORE__[r.id] ? { ...r, activityProgress: window.__QA_STORE__[r.id] } : r);
        let revision = 'qa-stable';
        // Mutation SERVEUR pilotee par le test : une donnee affichee change a
        // chaque poll, donc la revision change et le client DOIT re-rendre.
        if (window.__QA_MUTER__) {
          window.__QA_MUTATIONS__ = (window.__QA_MUTATIONS__ || 0) + 1;
          base = base.map((r, i) => (i === 1 ? { ...r, price: 156 + window.__QA_MUTATIONS__ } : r));
          revision = 'qa-mute-' + window.__QA_MUTATIONS__;
        }
        return J({ ok: true, revision, reservations: base, laneStatuses: lanes(), centerId: 'libramont' }, revision);
      }
      if (u.pathname === '/api/staff-reservations' && m === 'PATCH') {
        const b = JSON.parse(init.body || '{}');
        let base = build().find(r => Number(r.id) === Number(b.id)) || {};
        try { if (typeof state !== 'undefined' && Array.isArray(state.reservations)) { const f = state.reservations.find(r => Number(r.id) === Number(b.id)); if (f) base = f; } } catch (e) {}
        // Vrai serveur (setReservationActivityDone) : UNE cle ajoutee ou retiree
        // sur ce qui est EN BASE.
        const enBase = window.__QA_STORE__[b.id] || (build().find(r => Number(r.id) === Number(b.id)) || {}).activityProgress || {};
        let ap;
        if (b.activityToggle && typeof b.activityToggle === 'object') {
          ap = { ...enBase };
          if (b.activityToggle.done) ap[b.activityToggle.key] = { done: true, doneAt: b.activityToggle.doneAt || '', by: b.activityToggle.by || '' };
          else delete ap[b.activityToggle.key];
        } else {
          ap = b.activityProgress && typeof b.activityProgress === 'object' ? b.activityProgress : enBase;
        }
        window.__QA_STORE__[b.id] = ap;
        return J({ ok: true, reservation: { ...base, activityProgress: ap }, automation: { communications: 0, jobs: 0, refreshed: true } });
      }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today, durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '22:00' }, '6': { open: '10:00', close: '22:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, today });
}


// Compte les animations/transitions qui DEMARRENT, et les rendus reels.
const INSTRUMENT = () => {
  window.__ANIM__ = [];
  window.__RENDERS__ = { staffData: 0, table: 0, pos: 0, planning: 0 };
  const desc = (el) => {
    if (!el || !el.tagName) return String(el);
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`;
  };
  document.addEventListener('animationstart', (e) => {
    window.__ANIM__.push({ kind: 'animation', name: e.animationName, cible: desc(e.target) });
  }, true);
  document.addEventListener('transitionstart', (e) => {
    window.__ANIM__.push({ kind: 'transition', prop: e.propertyName, cible: desc(e.target) });
  }, true);
  ['renderStaffData', 'renderTable', 'renderPos', 'renderPlanning'].forEach((nom) => {
    const orig = window[nom];
    if (typeof orig !== 'function') return;
    const cle = nom === 'renderStaffData' ? 'staffData' : nom === 'renderTable' ? 'table' : nom === 'renderPos' ? 'pos' : 'planning';
    window[nom] = function () { window.__RENDERS__[cle] += 1; return orig.apply(this, arguments); };
  });
};

const detail = (liste) => {
  const par = {};
  liste.forEach((a) => {
    const cle = a.kind === 'animation' ? `${a.name} sur ${a.cible}` : `${a.prop} sur ${a.cible}`;
    par[cle] = (par[cle] || 0) + 1;
  });
  return Object.entries(par).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}x ${k}`).join(' | ');
};

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function mesurerRepos(page, secondes) {
  await page.evaluate(() => { window.__ANIM__ = []; window.__RENDERS__ = { staffData: 0, table: 0, pos: 0, planning: 0 }; });
  await page.waitForTimeout(secondes * 1000);
  return page.evaluate(() => ({ anim: window.__ANIM__, renders: window.__RENDERS__ }));
}

async function mesurerMutations(page, secondes) {
  await page.evaluate(() => {
    window.__QA_MUTER__ = true; window.__QA_MUTATIONS__ = 0;
    window.__ANIM__ = []; window.__RENDERS__ = { staffData: 0, table: 0, pos: 0, planning: 0 };
  });
  await page.waitForTimeout(secondes * 1000);
  return page.evaluate(() => {
    window.__QA_MUTER__ = false;
    return { anim: window.__ANIM__, renders: window.__RENDERS__, mutations: window.__QA_MUTATIONS__ };
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=refresh-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = todayStr(); state.staffTheme = 'dark';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); openStaffMenuPage('planning'); setStaffResourceView('all');
    });
    await page.waitForTimeout(1200);
    await page.evaluate(INSTRUMENT);

    console.log('\n[1] LA CONSOLE AU REPOS NE BOUGE PAS');
    const repos = await mesurerRepos(page, 9);
    ok(repos.renders.staffData === 0 && repos.renders.table === 0,
      `rien ne se re-rend quand rien ne change (staffData ${repos.renders.staffData}, table ${repos.renders.table})`);
    ok(repos.anim.length === 0, `aucune animation au repos (${repos.anim.length}${repos.anim.length ? ' : ' + detail(repos.anim) : ''})`);

    console.log('\n[2] LE SERVEUR CHANGE UNE RESA A CHAQUE POLL : ca se RAFRAICHIT sans se VOIR');
    const mute = await mesurerMutations(page, 12);
    ok(mute.mutations >= 2, `le serveur a bien servi des changements (${mute.mutations})`);
    ok(mute.renders.staffData >= 2, `la donnee est rafraichie a l ecran (${mute.renders.staffData} rendus)`);
    ok(mute.anim.length === 0,
      `AUCUNE animation rejouee malgre ${mute.renders.staffData} rendus (${mute.anim.length}${mute.anim.length ? ' : ' + detail(mute.anim) : ''})`);

    console.log('\n[3] COCHER UNE ACTIVITE : UN SEUL changement visible, rien ne saute');
    await page.setViewportSize({ width: 1200, height: 560 });
    await page.evaluate(() => { openPos(9020); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.__ANIM__ = []; window.__RENDERS__ = { staffData: 0, table: 0, pos: 0, planning: 0 }; });
    // Mettre la cible réellement sous les yeux avant de mesurer : le clic
    // navigateur peut sinon défiler pour focaliser une case hors du cadre.
    const caseAct = await page.$('#posOverlay .gc-check');
    if (caseAct) await caseAct.scrollIntoViewIfNeeded();
    const avant = await page.evaluate(() => {
      const corps = document.querySelector('#posOverlay .edit-modal-body');
      if (!corps) return null;
      return { scroll: corps.scrollTop, scrollable: corps.scrollHeight - corps.clientHeight };
    });
    ok(!!avant && avant.scrollable > 40, `la fiche a de quoi defiler (${avant && avant.scrollable} px)`);
    if (caseAct) await caseAct.click();
    await page.waitForTimeout(1600);
    const coche = await page.evaluate(() => {
      const corps = document.querySelector('#posOverlay .edit-modal-body');
      const actif = document.activeElement;
      return {
        anim: window.__ANIM__, renders: window.__RENDERS__,
        scroll: corps ? corps.scrollTop : null,
        focus: actif ? (actif.getAttribute('data-pl-focus') || actif.className) : null,
        cochee: !!document.querySelector('#posOverlay .gc-check[aria-pressed="true"]'),
      };
    });
    ok(coche.cochee, 'la case est bien cochee (le geste sert a quelque chose)');
    ok(coche.renders.pos === 1, `UN SEUL rendu de la fiche pour un clic (${coche.renders.pos}) : l echo serveur ne repeint plus`);
    // LA COCHE REPOND, UNE FOIS (2026-10-02, Movsar : « aucune animation »,
    // « quand on coche, decoche »). Seul le petit saut de la case (plPop,
    // 220 ms) est permis : au plus une fois par case qui a change (la fiche, et
    // la meme activite sur la carte derriere). Rien d autre ne bouge, et le
    // repos comme le poll restent a zero animation ([1] et [2]).
    const sauts = coche.anim.filter((a) => /plPop/.test(JSON.stringify(a)));
    const autres = coche.anim.filter((a) => !/plPop/.test(JSON.stringify(a)));
    ok(autres.length === 0, `aucune autre animation sur la coche que le saut de la case (${autres.length}${autres.length ? ' : ' + detail(autres) : ''})`);
    ok(sauts.length >= 1 && sauts.length <= 2, `la case cochee saute une fois (${sauts.length} saut(s) : la fiche et la carte)`);
    ok(!!avant && coche.scroll === avant.scroll, `le defilement de la fiche est conserve (${avant && avant.scroll} -> ${coche.scroll})`);
    ok(String(coche.focus || '').indexOf('fiche.activite.') === 0, `le focus reste sur la case cliquee (${coche.focus})`);

    // Contre-preuve : retirer uniquement la restauration, garder le vrai
    // clic et le focus. Le même oracle doit détecter la perte de position.
    await page.evaluate(() => {
      window.__ORIG_REPAINT__ = window.repaintKeepingScroll;
      window.repaintKeepingScroll = function (root, render) { render(); };
    });
    try {
      const caseSansRestauration = await page.$('#posOverlay .gc-check');
      if (caseSansRestauration) await caseSansRestauration.scrollIntoViewIfNeeded();
      const positionMutation = await page.evaluate(() => document.querySelector('#posOverlay .edit-modal-body')?.scrollTop);
      ok(positionMutation > 40, `contre-preuve située dans la fiche défilée (${positionMutation} px)`);
      if (caseSansRestauration) await caseSansRestauration.click();
      await page.waitForTimeout(600);
      const positionSansRestauration = await page.evaluate(() => document.querySelector('#posOverlay .edit-modal-body')?.scrollTop);
      ok(positionSansRestauration !== positionMutation,
        `restauration retirée : la perte de défilement est détectée (${positionMutation} -> ${positionSansRestauration})`);
    } finally {
      await page.evaluate(() => { window.repaintKeepingScroll = window.__ORIG_REPAINT__; });
    }

    const ouvertureManuelle = await page.evaluate(async () => {
      const origineRetard = window.getLateArrivalMinutes;
      const origineScroll = Element.prototype.scrollIntoView;
      let demandesDefilement = 0;
      Element.prototype.scrollIntoView = function () {
        if (this.matches('.delay-control-block')) demandesDefilement += 1;
        return origineScroll.apply(this, arguments);
      };
      try {
        window.getLateArrivalMinutes = () => 15;
        renderPos();
        await new Promise(resolve => setTimeout(resolve, 100));
        const dejaOuvert = document.querySelector('#posOverlay .delay-control-block');
        const automatiqueMarque = dejaOuvert?.open && dejaOuvert.dataset.vu === '1' && demandesDefilement === 0;
        window.getLateArrivalMinutes = () => 0;
        renderPos();
        await new Promise(resolve => setTimeout(resolve, 100));
        const ferme = document.querySelector('#posOverlay .delay-control-block');
        const fermeAuDepart = !!ferme && !ferme.open;
        demandesDefilement = 0;
        ferme.querySelector('summary').click();
        await new Promise(resolve => setTimeout(resolve, 100));
        return { automatiqueMarque, fermeAuDepart, ouvert: ferme.open, demandesDefilement };
      } finally {
        window.getLateArrivalMinutes = origineRetard;
        Element.prototype.scrollIntoView = origineScroll;
      }
    });
    ok(ouvertureManuelle.automatiqueMarque, 'bloc retard déjà ouvert automatiquement : aucun défilement demandé au montage');
    ok(ouvertureManuelle.fermeAuDepart && ouvertureManuelle.ouvert && ouvertureManuelle.demandesDefilement === 1,
      `ouverture manuelle du bloc fermé : défilement conservé une fois (${ouvertureManuelle.demandesDefilement})`);

    console.log('\n[3 bis] UNE MODALE NE REMONTE PAS EN HAUT QUAND ON CLIQUE EN BAS');
    // Movsar 2026-08-26 : « quand on clique sur un bouton en bas ca nous
    // teleporte tout en haut et ca fait ca a plein d endroits ». Le conteneur
    // qui defile ici (.qb-modal) n a NI id NI data-scroll-key : c est exactement
    // le cas que la premiere version de repaintKeepingScroll ne savait pas
    // restaurer, puisqu elle ne reperait que les elements identifies.
    await page.setViewportSize({ width: 1100, height: 620 });
    await page.evaluate(() => { closePos(); openQuickBook({ date: state.currentDate, type: 'bowling', pax: 4 }); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { toggleQuickBookMore(); });
    await page.waitForTimeout(500);
    const modale = await page.evaluate(async () => {
      // CE QUI DEFILE, quel qu il soit : la modale entiere, ou sa colonne de
      // saisie depuis la refonte du 2026-10-01 (recapitulatif fixe a droite).
      const candidats = ['.qb-body', '.qb-modal'];
      const choisi = candidats.find((sel) => { const el = document.querySelector(`#quickBookOverlay ${sel}`); return el && el.scrollHeight - el.clientHeight > 80; }) || '.qb-modal';
      const boite = document.querySelector(`#quickBookOverlay ${choisi}`);
      if (!boite) return { erreur: 'modale absente' };
      const course = boite.scrollHeight - boite.clientHeight;
      boite.scrollTop = course;
      const avant = boite.scrollTop;
      const boutons = [...document.querySelectorAll('#quickBookOverlay .qb-dur-btn')];
      const cible = boutons[boutons.length - 1];
      if (cible) cible.click();
      await new Promise((r) => setTimeout(r, 700));
      const apres = document.querySelector(`#quickBookOverlay ${choisi}`);
      return { course, avant, apres: apres ? apres.scrollTop : null, choisi };
    });
    ok(modale.course > 80, `la modale a de quoi defiler (${modale.course} px, ${modale.choisi})`);
    ok(modale.avant > 0 && modale.apres === modale.avant,
      `cliquer un bouton EN BAS ne remonte pas la modale (${modale.avant} -> ${modale.apres})`);
    await page.evaluate(() => { closeQuickBook(); });
    await page.setViewportSize({ width: 1500, height: 950 });
    console.log('\n[4] LE PLEIN ECRAN DE LA LISTE EST UTILISABLE');
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.evaluate(() => { closePos(); openStaffMenuPage('planning'); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { toggleTableExpanded(); });
    await page.waitForTimeout(700);
    const plein = await page.evaluate(() => {
      const box = document.getElementById('staffTableBox');
      const toggle = document.getElementById('tableToggle');
      const r = box ? box.getBoundingClientRect() : null;
      const t = toggle ? toggle.getBoundingClientRect() : null;
      const st = box ? getComputedStyle(box) : null;
      const sections = document.querySelector('#resList .res-sections');
      return {
        hauteur: r ? Math.round(r.height) : 0,
        ecran: window.innerHeight,
        maxHeight: st ? st.maxHeight : '',
        toggleVisible: !!(t && t.width > 0 && t.height > 0),
        toggleTexte: toggle ? toggle.textContent.trim() : '',
        largeurContenu: sections ? Math.round(sections.getBoundingClientRect().width) : 0,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    ok(plein.hauteur >= plein.ecran - 2, `la liste occupe TOUT l ecran (${plein.hauteur} px sur ${plein.ecran})`);
    ok(plein.maxHeight === 'none', `le plafond de la boite normale est leve (max-height ${plein.maxHeight})`);
    ok(plein.toggleVisible && /duire/i.test(plein.toggleTexte), `la sortie est visible et nommee (${plein.toggleTexte})`);
    ok(plein.largeurContenu > 0 && plein.largeurContenu <= 1600, `le contenu reste dense (${plein.largeurContenu} px, plafond 1600)`);
    ok(plein.bodyOverflow === 'hidden', `la page derriere ne defile pas (${plein.bodyOverflow})`);
    const encoreOuvert = await page.evaluate(() => { collapseStaffPlanningFullscreen(); return !!document.querySelector('#staffTableBox.expanded'); });
    ok(encoreOuvert === false, 'Echap referme le plein ecran');

    console.log('\n[5] CONTRE-PREUVES PAR MUTATION : ce gate sait-il rougir ?');
    // (a) La fiche reprend son animation d entree a CHAQUE rendu : c est
    //     exactement l etat d avant le 2026-08-26, ou .fade-in etait pose sur
    //     un conteneur reconstruit a chaque fois.
    await page.setViewportSize({ width: 1200, height: 560 });
    await page.evaluate(() => {
      window.__ORIG_SHEET__ = window.posSheetClass;
      window.posSheetClass = function () { return 'pos-sheet fade-in'; };
      closePos();
    });
    await page.evaluate(() => { openPos(9020); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.__ANIM__ = []; });
    const caseB = await page.$('#posOverlay .gc-check');
    if (caseB) await caseB.click();
    await page.waitForTimeout(1500);
    const mutFiche = await page.evaluate(() => ({ anim: window.__ANIM__ }));
    ok(mutFiche.anim.length > 0,
      `animation d entree remise sur la fiche : le re-rendu REDEVIENT visible (${mutFiche.anim.length}${mutFiche.anim.length ? ' : ' + detail(mutFiche.anim) : ''})`);
    await page.evaluate(() => { if (window.__ORIG_SHEET__) window.posSheetClass = window.__ORIG_SHEET__; closePos(); });

    // (b) Le jeton d arrivee est neutralise : le halo « nouvelle reservation »
    //     rejoue a chaque rendu pendant les trois minutes du marquage.
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.evaluate(() => { openStaffMenuPage('planning'); setStaffResourceView('all'); });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.__ORIG_DUE__ = PinlaneMotion.animationNeuveDue;
      PinlaneMotion.animationNeuveDue = () => true;
      PinlaneMotion.marquerNeuves([9021, 9022]);
    });
    const mutNeuve = await mesurerMutations(page, 12);
    ok(mutNeuve.anim.length > 0,
      `jeton d arrivee neutralise : le halo REJOUE a chaque rendu (${mutNeuve.anim.length}${mutNeuve.anim.length ? ' : ' + detail(mutNeuve.anim) : ''})`);
    await page.evaluate(() => {
      if (window.__ORIG_DUE__) PinlaneMotion.animationNeuveDue = window.__ORIG_DUE__;
      PinlaneMotion.oublierNeuves();
    });
    const restaure = await mesurerMutations(page, 10);
    ok(restaure.anim.length === 0, `restauration a l identique : le rendu redevient invisible (${restaure.anim.length})`);
    if (errs.length) console.log('\nErreurs JS :\n' + errs.join('\n'));
    ok(errs.length === 0, `zero erreur JS (${errs.length})`);
  } catch (e) {
    console.error('\nrefresh-invisible-check FAIL:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nrefresh-invisible-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nrefresh-invisible-check: ALL OK - la donnee se rafraichit, l ecran ne bouge pas.');
}

main();
