// Pages « Pistes bowling » et « Laser Game » : des POSTES D ACTION
// (2e verdict Movsar 2026-08-25 : « jette tout, repense : une page ou on VA
// pour REGLER des choses ou VOIR »). Ce qu on vient y faire :
//   - fermer/rouvrir une piste, et REPLACER les resas d une piste en panne
//     (le bouton ouvre LA resa, pas une liste) ;
//   - voir l etat vivant par piste (occupee par qui jusqu a quand, creux) ;
//   - vendre un creux : le clic ouvre la resa rapide PREREMPLIE ;
//   - laser : repondre au comptoir (prochain lancement, places restantes),
//     completer les sessions faibles du jour, decider sur 30 jours.
// Chaque assertion exerce un GESTE (clic -> etat verifie) ou un chiffre
// recalcule a la main sur le dataset impose. Presence sans comportement =
// faux vert.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_LANES_PORT || 4231);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

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
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.quick','reservations.edit','reservations.status','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Date du CENTRE, calculee comme todayStr() de l app (booking-core.js,
    // fuseau Europe/Brussels), jamais dans le fuseau du navigateur :
    // toISOString rendait la date UTC, et la date locale du navigateur, juste
    // sur un poste belge, est fausse sur un runner CI en UTC. Dans les deux cas,
    // entre minuit et 2 h (heure d ete belge), les resas « du jour » tombaient
    // la veille et le gate rougissait (vu en local le 2026-08-26 vers 1 h, et
    // reproduit le 2026-09-15 avec un navigateur en Etc/GMT+12).
    const dstr = (off) => {
      const jour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const lire = (type) => Number(jour.find((part) => part.type === type)?.value);
      return new Date(Date.UTC(lire('year'), lire('month') - 1, lire('day') + off)).toISOString().slice(0, 10);
    };
    window.__QA_DSTR__ = dstr;
    const R = [];
    let id = 70000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: new Date().toISOString(), ...o }); };
    // 30 DERNIERS JOURS, chiffres imposes :
    // piste 1 : 18 resas de 2 h = 36 h ; piste 2 : 9 resas de 2 h = 18 h ;
    // pistes 3-8 : rien (sous-utilisation a signaler).
    for (let i = 0; i < 18; i += 1) add({ name: `P1 ${i}`, phone: `+3247100${1000 + i}`, date: dstr(-1 - i), startTime: '14:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [1] });
    for (let i = 0; i < 9; i += 1) add({ name: `P2 ${i}`, phone: `+3247100${2000 + i}`, date: dstr(-1 - i), startTime: '18:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [2] });
    // LASER 30 jours : 10 lancements isoles de 15 joueurs -> remplissage moyen
    // 50 % (capacite 30), 150 joueurs.
    for (let i = 0; i < 10; i += 1) add({ name: `L ${i}`, phone: `+3247100${3000 + i}`, date: dstr(-1 - i), startTime: '19:00', duration: 1, pax: 15, price: 150, type: 'laser', label: 'Laser' });
    // AUJOURD HUI : piste 1 (2 h), piste 2 (1 h), un lancement laser 8 joueurs.
    add({ name: 'Jour P1', phone: '+32471009001', date: dstr(0), startTime: '14:00', duration: 2, pax: 4, price: 60, type: 'bowling', label: 'Bowling', lanes: [1] });
    add({ name: 'Jour P2', phone: '+32471009002', date: dstr(0), startTime: '15:00', duration: 1, pax: 3, price: 30, type: 'bowling', label: 'Bowling', lanes: [2] });
    add({ name: 'Jour Laser', phone: '+32471009003', date: dstr(0), startTime: '15:00', duration: 1, pax: 8, price: 80, type: 'laser', label: 'Laser' });
    const build = () => R.map((r) => ({ ...r }));
    // Piste 2 en maintenance DATEE (panne pin-setter) : ses resas du jour
    // sont A REPLACER. Le vrai serveur (api/staff-lanes + staff-state)
    // porte laneStatuses ET laneMaintenance : le double fait pareil.
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = i + 1 === 2 ? 'maintenance' : 'active'; return a; }, {});
    const laneMaintenance = () => ({ 2: { from: dstr(0), until: dstr(2), note: 'pin-setter' } });
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), laneMaintenance: laneMaintenance(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/staff-lanes') { const b = JSON.parse(init.body || '{}'); return J({ ok: true, lane: { lane: b.lane, status: b.status, maintenanceFrom: b.maintenanceFrom || '', maintenanceUntil: b.maintenanceUntil || '', maintenanceNote: b.note || '' } }); }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'customRequests') return J({ ok: true, customRequests: [] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: dstr(0), durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': { open: '10:00', close: '22:00' }, '2': { open: '10:00', close: '22:00' }, '3': { open: '10:00', close: '22:00' }, '4': { open: '10:00', close: '22:00' }, '5': { open: '10:00', close: '22:00' }, '6': { open: '10:00', close: '22:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      return nf(input, init);
    };
    window.__QA_BUILD__ = build;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  // Aucun dialog NATIF (prompt/alert/confirm) n a sa place dans la console
  // (verdict Movsar 2026-08-25) : s il s en ouvre un, le gate rougit.
  page.on('dialog', (d) => { errs.push('DIALOG NATIF: ' + d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=lanes-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = todayStr(); state.staffTheme = 'dark';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); openStaffMenuPage('lanes');
    });
    await page.waitForTimeout(900);

    // Montage d abord : les resas « du jour » du jeu d essai doivent etre datees
    // du jour que la page affiche, sinon les rouges suivants ne disent pas ce
    // qu ils nomment.
    console.log('\n[MONTAGE] les resas du jour sont datees du jour de la page');
    const montage = await page.evaluate(() => ({ page: todayStr(), jour: [...new Set(window.__QA_BUILD__().filter((r) => /^Jour /.test(r.name)).map((r) => r.date))] }));
    ok(montage.jour.length === 1 && montage.jour[0] === montage.page, `resas du jour datees du ${montage.jour.join(', ')}, page au ${montage.page}`);

    console.log('\n[PISTES : le mur des pistes, un geste par probleme]');
    const mur = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffUtilityPage .lane-row')];
      const lit = (n) => {
        const row = rows.find((r) => r.dataset.lane === String(n));
        if (!row) return null;
        return {
          texte: row.textContent.replace(/\s+/g, ' ').trim(),
          maintenance: row.classList.contains('is-maintenance'),
          slots: row.querySelectorAll('.lane-slot').length,
          gaps: row.querySelectorAll('.lane-gap').length,
          pct: Number((row.querySelector('[data-role="lane-pct"]') || {}).dataset?.pct),
          replace: [...row.querySelectorAll('[data-role="lane-replace"] button')].map((b) => b.textContent.trim()),
        };
      };
      return { nb: rows.length, p1: lit(1), p2: lit(2), p3: lit(3) };
    });
    ok(mur.nb === 8, `une rangee par piste (${mur.nb})`);
    ok(mur.p1 && mur.p1.slots === 1, `piste 1 : sa resa du jour est posee sur la reglette (${mur.p1 && mur.p1.slots})`);
    ok(mur.p1 && mur.p1.pct > 0 && mur.p2 && mur.p1.pct === mur.p2.pct * 2,
      `l occupation 30 j est calculee (piste 1 ${mur.p1 && mur.p1.pct}% = 2x piste 2 ${mur.p2 && mur.p2.pct}%, 36 h vs 18 h)`);
    ok(mur.p3 && mur.p3.slots === 0 && mur.p3.gaps >= 1, `piste 3 vide : son creux est offert a la vente (${mur.p3 && mur.p3.gaps} creux)`);

    console.log('\n[PISTES : la panne se REGLE d ici]');
    ok(mur.p2.maintenance && /pin-setter/.test(mur.p2.texte), `piste 2 : la panne et sa note sont dites (« ${mur.p2.texte.slice(0, 90)} »)`);
    ok(mur.p2.replace.length === 1 && /Jour P2/.test(mur.p2.replace[0]),
      `la resa posee sur la piste en panne est A REPLACER (${mur.p2.replace.join(' | ') || 'aucune'})`);
    // Le bouton ouvre LA resa (pas une liste) : c est le geste qui repare.
    await page.evaluate(() => {
      document.querySelector('.lane-row[data-lane="2"] [data-role="lane-replace"] button').click();
    });
    await page.waitForTimeout(500);
    const ouverte = await page.evaluate(() => state.selectedRes && state.selectedRes.name);
    ok(ouverte === 'Jour P2', `le bouton A REPLACER ouvre la resa touchee (${ouverte})`);
    await page.evaluate(() => { state.selectedRes = null; save(); setView('staff'); openStaffMenuPage('lanes'); });
    await page.waitForTimeout(600);

    // Le creux de la piste 3 se VEND : clic -> resa rapide preremplie
    // (meme geste que le planning : quickFromCell).
    await page.evaluate(() => {
      document.querySelector('.lane-row[data-lane="3"] .lane-gap').click();
    });
    await page.waitForTimeout(500);
    // quickBookState est un let de module, pas une propriete de window :
    // on le lit dans son scope global de script.
    const creux = await page.evaluate(() => (typeof quickBookState !== 'undefined' && quickBookState
      ? { lane: (quickBookState.lanes || [])[0], type: quickBookState.type }
      : { lane: null, type: null }));
    ok(creux.lane === 3 && creux.type === 'bowling', `le creux ouvre la resa rapide preremplie (piste ${creux.lane}, ${creux.type})`);
    await page.evaluate(() => { if (typeof closeQuickBook === 'function') closeQuickBook(); });
    await page.waitForTimeout(300);

    // Fermer une piste marche toujours, et se voit ICI.
    await page.evaluate(() => {
      const row = document.querySelector('.lane-row[data-lane="4"]');
      const btn = [...row.querySelectorAll('button')].find((b) => /Fermer/.test(b.textContent));
      btn.click();
    });
    await page.waitForTimeout(500);
    const fermee = await page.evaluate(() => {
      const row = document.querySelector('.lane-row[data-lane="4"]');
      return row ? row.classList.contains('is-maintenance') : false;
    });
    ok(fermee, '« Fermer » bascule la piste et la rangee le MONTRE sans quitter la page');

    // « Entretien… » ouvre un FORMULAIRE dans la rangee (dates + motif),
    // jamais un prompt navigateur. Planifier envoie le meme PATCH que
    // toujours et la rangee montre la maintenance et son motif.
    await page.evaluate(() => {
      const row = document.querySelector('.lane-row[data-lane="5"]');
      const btn = [...row.querySelectorAll('button')].find((b) => /Entretien/.test(b.textContent));
      btn.click();
    });
    await page.waitForTimeout(400);
    const form = await page.evaluate(() => {
      const zone = document.querySelector('.lane-row[data-lane="5"] [data-role="lane-maint-form"]');
      return {
        present: !!zone,
        dates: zone ? zone.querySelectorAll('input[type="date"]').length : 0,
        motif: zone ? !!zone.querySelector('input[type="text"]') : false,
      };
    });
    ok(form.present && form.dates === 2 && form.motif, `le formulaire d entretien vit DANS la rangee (2 dates + motif) et non dans un prompt (${JSON.stringify(form)})`);
    await page.evaluate(() => {
      // Meme date du centre que le jeu d essai (installMock la pose).
      const dstr = window.__QA_DSTR__;
      document.getElementById('laneMaintFrom-5').value = dstr(0);
      document.getElementById('laneMaintUntil-5').value = dstr(2);
      document.getElementById('laneMaintNote-5').value = 'huilage';
      const zone = document.querySelector('.lane-row[data-lane="5"] [data-role="lane-maint-form"]');
      [...zone.querySelectorAll('button')].find((b) => /Planifier/.test(b.textContent)).click();
    });
    // ATTENTE PAR CONDITION, PAS PAR CHRONO. Le clic « Planifier » sauvegarde
    // puis re-rend : sous la charge de la suite complete, 600 ms en dur ne
    // suffisaient pas et le gate lisait la rangee d AVANT le clic. Le butoir
    // atteint laisse l assertion ROUGIR, il ne la sauve pas.
    const lireRangee5 = () => page.evaluate(() => {
      const row = document.querySelector('.lane-row[data-lane="5"]');
      return {
        maintenance: row ? row.classList.contains('is-maintenance') : false,
        texte: row ? row.textContent.replace(/\s+/g, ' ') : '',
      };
    });
    const butoirEntretien = Date.now() + 10000;
    let planifie = await lireRangee5();
    while (!(planifie.maintenance && /huilage/.test(planifie.texte)) && Date.now() < butoirEntretien) {
      await page.waitForTimeout(100);
      planifie = await lireRangee5();
    }
    ok(planifie.maintenance && /huilage/.test(planifie.texte),
      `l entretien planifie se voit sur la rangee, motif compris (« ${planifie.texte.slice(0, 90)} »)`);

    console.log('\n[LASER : repondre, completer, decider]');
    await page.evaluate(() => { openStaffMenuPage('laserGame'); });
    await page.waitForTimeout(900);
    const laser = await page.evaluate(() => {
      const head = document.querySelector('#staffUtilityPage .laser-next');
      const sessions = [...document.querySelectorAll('#staffUtilityPage .laser-session')];
      const s0 = sessions[0] || null;
      return {
        bandeau: head ? head.textContent.replace(/\s+/g, ' ').trim() : '',
        sessions: sessions.length,
        s0: s0 ? s0.textContent.replace(/\s+/g, ' ').trim() : '',
        completer: s0 ? [...s0.querySelectorAll('button')].some((b) => /Compl[ée]ter|Ajouter/.test(b.textContent)) : false,
        bilan: (document.querySelector('#staffUtilityPage .laser-30d') || {}).textContent || '',
        // L heure du CENTRE (Europe/Brussels), celle avec laquelle l app decide si
        // un lancement est encore a venir, jamais l heure du navigateur : sur un
        // runner CI en UTC, le branchement prenait le mauvais cote deux heures
        // par jour (vu le 2026-09-15 avec un navigateur en Etc/GMT+12).
        heureNow: (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); const lire = (t) => Number(p.find((x) => x.type === t)?.value); return lire('hour') + lire('minute') / 60; })(),
      };
    });
    // Le bandeau repond a LA question du comptoir, calculee comme le client :
    // avant 15 h -> « Prochain lancement 15:00 · 22 places » ; apres -> il
    // dit qu il n y a plus de lancement a venir.
    // L heure du bandeau doit etre CELLE de la session rendue (le moteur
    // pose la fenetre laser avec son briefing : 15:05, pas 15:00 brut),
    // et le branchement futur/passe se fait sur CETTE heure-la, pas sur un
    // 15:00 suppose (attrape par un run de suite a 15:0x pile).
    const heureSession = (laser.s0.match(/^(\d{2}:\d{2})/) || [])[1] || '';
    const heureSessionDec = heureSession ? Number(heureSession.split(':')[0]) + Number(heureSession.split(':')[1]) / 60 : 15;
    if (laser.heureNow < heureSessionDec) {
      ok(heureSession && laser.bandeau.includes(heureSession) && /22\s*places/.test(laser.bandeau),
        `le bandeau repond au comptoir, coherent avec la session (« ${laser.bandeau.slice(0, 90)} » / session ${heureSession})`);
    } else {
      ok(/[Aa]ucun.*lancement/.test(laser.bandeau),
        `plus de lancement a venir : le bandeau le dit (« ${laser.bandeau.slice(0, 90)} »)`);
    }
    ok(laser.sessions === 1 && /8\s*\/\s*30/.test(laser.s0), `la session du jour est la, avec son remplissage (« ${laser.s0.slice(0, 80)} »)`);
    if (laser.heureNow < heureSessionDec) {
      ok(laser.completer, 'une session future a 27 % porte son geste : Completer');
    }
    ok(/50\s*%/.test(laser.bilan) && /10\s*lancement/.test(laser.bilan) && /150/.test(laser.bilan),
      `le bilan 30 j est chiffre juste : 50 %, 10 lancements, 150 places vides (« ${laser.bilan.replace(/\s+/g, ' ').trim().slice(0, 140)} »)`);
    // Un groupe de la session s ouvre d un clic (repondre a « c est qui ? »).
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#staffUtilityPage .laser-session button')].find((b) => /Jour Laser/.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    const groupe = await page.evaluate(() => state.selectedRes && state.selectedRes.name);
    ok(groupe === 'Jour Laser', `un groupe s ouvre d un clic (${groupe})`);
    ok(errs.length === 0, `zero erreur JS (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } catch (e) {
    console.error('\nlanes-laser-pages-check FAIL:', e.stack || e.message);
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nlanes-laser-pages-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nlanes-laser-pages-check: ALL OK');
}
main();
