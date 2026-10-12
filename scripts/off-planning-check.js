// Reservations HORS PLANNING : celles qui n'occupent ni piste bowling ni zone
// laser (formules table + plaine de jeux f6/f7/f8, Kids Fun Day). Elles
// n'apparaissent sur AUCUNE des deux grilles : avant, elles n'existaient que
// noyees dans la liste du jour, sous un onglet « Planning Complet » qui se
// contentait d'empiler les deux plannings. Un anniversaire enfant pouvait donc
// arriver sans que personne ne l'ait vu.
//
// Ce gate verifie le COMPORTEMENT dans un vrai navigateur, pas la presence du
// code : la regle de classement, l'alerte de l'onglet VISIBLE DEPUIS LES AUTRES
// onglets, la disparition des grilles sur l'onglet liste, la section en tete de
// liste sans doublon, et surtout la contre-preuve : la resa hors planning est
// bien ABSENTE des deux grilles (donc c'est cet onglet ou nulle part).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_OFFPLANNING_PORT || 4199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const DATE = '2026-07-18'; // samedi ouvert : deterministe, jamais un jour ferme
let appOverride = null;

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    // La contre-preuve sert une mutation en memoire, sans toucher au chantier.
    if (filePath === APP && appOverride !== null) {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(appOverride); return;
    }
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
  await page.addInitScript(({ expiresAt, DATE }) => {
    const perms = ['dashboard.view','planning.view','planning.bowling','planning.laser','reservations.view','reservations.create','reservations.edit','reservations.status','reservations.quick','clients.view','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const build = (date) => ([
      // HORS PLANNING : FORMULE 6 = table privee + plaine de jeux + arcades.
      // Aucun bloc bowling_lane / laser_arena : invisible sur les deux grilles.
      { id: 9101, name: 'Anniversaire Lea', phone: '+32470000101', email: 'lea@x.test', date, startTime: '14:00', duration: 2, lanes: [], status: 'pending', pax: 12, price: 216, type: 'formule', formuleId: 'f6', label: 'FORMULE 6',
        opsPlan: { staffSummary: 'Formule 6 anniversaire', resourceBlocks: [
          { resourceType: 'party_table', activityId: 'party_table', startTime: '14:00', endTime: '16:00', countIndex: 1 },
          { resourceType: 'soft_capacity', activityId: 'playground', startTime: '14:00', endTime: '16:00', countIndex: 1 },
        ] } },
      // SUR LES DEUX GRILLES : FORMULE 1 = bowling + laser places.
      { id: 9102, name: 'Groupe Nathan', phone: '+32470000102', email: 'nathan@x.test', date, startTime: '15:00', duration: 1, lanes: [1,2], status: 'pending', pax: 8, price: 208, type: 'formule', formuleId: 'f1', label: 'FORMULE 1',
        opsPlan: { staffSummary: 'Formule 1', resourceBlocks: [
          { resourceType: 'bowling_lane', activityId: 'bowling', startTime: '15:00', endTime: '16:00', lanes: [1,2], countIndex: 1 },
          { resourceType: 'laser_arena', activityId: 'laser_game', startTime: '16:15', endTime: '16:40', countIndex: 1 },
        ] } },
      // A PLACER (et NON hors planning) : partie laser retiree de la grille a la
      // main. Elle attend deja dans le tiroir du planning laser, la remonter en
      // « hors planning » ferait du bruit sur un cas deja outille.
      { id: 9103, name: 'Sami Laser', phone: '+32470000103', email: 'sami@x.test', date, startTime: '17:00', duration: 0.5, lanes: [], status: 'pending', pax: 10, price: 100, type: 'laser', label: 'Laser Game',
        opsPlan: { laserManual: true, resourceBlocks: [] } },
      // GRILLE BOWLING : reservation directe classique.
      { id: 9104, name: 'Karim Bowling', phone: '+32470000104', email: 'karim@x.test', date, startTime: '18:00', duration: 1, lanes: [5], status: 'arrived', pax: 5, price: 39, type: 'bowling', label: 'Bowling' },
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
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
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
      if (u.pathname === '/api/staff-state') { const d = u.searchParams.get('date') || DATE; return J({ ok: true, revision: `qa-${d}`, reservations: build(d), laneStatuses: lanes(), centerId: 'libramont' }); }
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: DATE, durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/admin-range') { const d = u.searchParams.get('startDate') || DATE; return J({ ok: true, reservations: build(d), emails: [], agentEvents: [], centerId: 'libramont' }); }
      return nativeFetch(input, init);
    };
    window.__QA_BUILD__ = build; window.__QA_LANES__ = lanes;
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, DATE });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function bootStaff(page, cacheKey) {
  await page.goto(`${BASE_URL}/?v=offplanning-${cacheKey}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
  await page.evaluate((d) => {
    state.currentDate = d; state.staffMenuPage = 'planning'; state.staffResourceView = 'all'; state.staffTheme = 'dark';
    state.staffStatusFilter = 'all'; state.searchTerm = '';
    state.reservations = window.__QA_BUILD__(d); state.laneStatuses = window.__QA_LANES__();
    save(); setView('staff'); renderStaff();
  }, DATE);
  await page.waitForTimeout(400);
}

async function switchTab(page, view) {
  await page.evaluate((v) => { setStaffResourceView(v); }, view);
  await page.waitForTimeout(250);
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('console', msg => { if (msg.type() === 'error') errs.push('CONSOLE: ' + msg.text()); });
  try {
    // Midi le jour du jeu : ses quatre groupes (14:00 a 18:00) sont a venir,
    // sauf celui deja pointe arrive. Avec l horloge reelle, cette date passee
    // rendait « À venir » vide (la liste lit le moment depuis le 2026-09-30).
    await page.clock.install({ time: new Date(`${DATE}T12:00:00`) });
    await installMock(page);
    await bootStaff(page, 'base');

    // =====================================================================
    console.log('\n[1] La regle de classement');
    // =====================================================================
    const rule = await page.evaluate(() => {
      const by = (id) => state.reservations.find(r => r.id === id);
      return {
        f6: isOffPlanningReservation(by(9101)),
        f1: isOffPlanningReservation(by(9102)),
        laserAPlacer: isOffPlanningReservation(by(9103)),
        bowling: isOffPlanningReservation(by(9104)),
        total: state.reservations.filter(isOffPlanningReservation).length,
      };
    });
    ok(rule.f6 === true, 'FORMULE 6 (table + plaine de jeux) est hors planning');
    ok(rule.f1 === false, 'FORMULE 1 (bowling + laser places) n est PAS hors planning');
    ok(rule.laserAPlacer === false, 'une partie laser « a placer » n est PAS hors planning (elle a deja son tiroir)');
    ok(rule.bowling === false, 'un bowling direct avec piste n est PAS hors planning');
    ok(rule.total === 1, `1 seule resa hors planning sur les 4 du jour (obtenu ${rule.total})`);

    // =====================================================================
    console.log('\n[2] L alerte se voit DEPUIS LES AUTRES ONGLETS');
    // =====================================================================
    // C est tout l interet : si le signal n existait que sur l onglet concerne,
    // il faudrait deja savoir qu il y a quelque chose a voir pour le voir.
    for (const view of ['bowling', 'laser', 'all']) {
      await switchTab(page, view);
      const tab = await page.evaluate(() => ({
        sub: document.getElementById('staffAllSub')?.textContent || '',
        alert: !!document.getElementById('staffTabAll')?.classList.contains('has-alert'),
        count: document.getElementById('staffAllCount')?.textContent || '',
      }));
      ok(tab.sub === '1 hors planning', `onglet ${view} : le sous-titre annonce « 1 hors planning » (obtenu « ${tab.sub} »)`);
      ok(tab.alert === true, `onglet ${view} : l onglet porte la classe d alerte`);
      ok(tab.count === '4', `onglet ${view} : le compteur reste le total du jour (obtenu ${tab.count})`);
    }

    // =====================================================================
    console.log('\n[3] Une grille ne s affiche que sur SON onglet');
    // =====================================================================
    const boxes = {};
    for (const view of ['all', 'bowling', 'laser']) {
      await switchTab(page, view);
      boxes[view] = await page.evaluate(() => ({
        bowling: !document.getElementById('planningBox')?.classList.contains('hidden'),
        laser: !document.getElementById('laserPlanningBox')?.classList.contains('hidden'),
      }));
    }
    ok(boxes.all.bowling === false && boxes.all.laser === false, 'onglet « Toutes les reservations » : les DEUX grilles sont masquees (fin du planning complet)');
    ok(boxes.bowling.bowling === true && boxes.bowling.laser === false, 'onglet Bowling : grille bowling seule');
    ok(boxes.laser.laser === true && boxes.laser.bowling === false, 'onglet Laser : grille laser seule');

    // =====================================================================
    // Depuis le 2026-10-01 (cartes de groupe a la caisse), la section a part
    // est devenue une marque sur la carte : le groupe vit dans son moment
    // (À venir...), et sa carte dit « Hors planning ».
    console.log('\n[4] La carte « Hors planning » se voit dans la liste, sans doublon');
    // =====================================================================
    await switchTab(page, 'all');
    const list = await page.evaluate(() => {
      const marquees = [...document.querySelectorAll('#resList .res-row')].filter(r => r.querySelector('.gc-tag') && /Hors planning/.test(r.querySelector('.gc-tag').textContent));
      return {
        offRows: marquees.map(r => r.textContent),
        offSection: marquees.length ? [...marquees[0].closest('.res-section').classList].join(' ') : '',
        leaOccurrences: [...document.querySelectorAll('#resList .res-row')].filter(r => r.textContent.includes('Anniversaire Lea')).length,
        totalRows: document.querySelectorAll('#resList .res-row').length,
      };
    });
    ok(list.offRows.length === 1 && list.offRows[0].includes('Anniversaire Lea'), 'une seule carte porte « Hors planning » : l anniversaire FORMULE 6');
    // Depuis le 2026-10-10 (f52cb20), « Tout » range les visites vivantes dans
    // une seule section par heure (« Visites à suivre », cle active) : le
    // groupe hors planning y vit avec les autres, jamais dans une section a part.
    ok(/\b(active|upcoming)\b/.test(list.offSection), `elle vit avec les autres visites, « Visites à suivre » ou « À venir » (obtenu « ${list.offSection} »)`);
    ok(list.leaOccurrences === 1, `la resa hors planning n est PAS dupliquee dans les sections de statut (${list.leaOccurrences} occurrence(s))`);
    ok(list.totalRows === 4, `les 4 resas du jour restent listees (obtenu ${list.totalRows})`);

    // Le filtre de statut ne doit jamais faire disparaitre la zone hors planning
    // quand la resa concernee est elle-meme dans le filtre.
    await page.evaluate(() => { setStaffStatusFilter('upcoming'); });
    await page.waitForTimeout(250);
    const filtered = await page.evaluate(() => ({
      off: [...document.querySelectorAll('#resList .gc-tag')].some(t => /Hors planning/.test(t.textContent)),
      // Departure animation clones retain .res-row for460ms, but deliberately
      // lose their live row id and become aria-hidden. Count real dossiers.
      rows: document.querySelectorAll('#resList [data-res-row-id]').length,
      ids:[...document.querySelectorAll('#resList [data-res-row-id]')].map(el=>el.getAttribute('data-res-row-id')),
    }));
    ok(filtered.off === true, 'filtre « A venir » : la carte hors planning reste presente');
    ok(filtered.rows === 3 && filtered.ids.join(',') === '9101,9102,9103', `filtre « A venir » : 3 resas, Karim arrive exclu (obtenu ${filtered.rows}; ids ${filtered.ids})`);
    await page.evaluate(() => { setStaffStatusFilter('all'); });
    await page.waitForTimeout(200);

    // =====================================================================
    console.log('\n[5] CONTRE-PREUVE : la resa hors planning est ABSENTE des deux grilles');
    // =====================================================================
    // Sans ca, l onglet ne servirait a rien : c est parce qu elle n apparait
    // nulle part ailleurs que cette zone est le seul endroit ou la voir.
    await switchTab(page, 'bowling');
    const inBowlingGrid = await page.evaluate(() => (document.getElementById('planningGridWrap')?.textContent || '').includes('Anniversaire Lea'));
    await switchTab(page, 'laser');
    const inLaserGrid = await page.evaluate(() => {
      const box = document.getElementById('laserPlanningBox');
      return (box?.textContent || '').includes('Anniversaire Lea');
    });
    ok(inBowlingGrid === false, 'la grille bowling ne la montre pas');
    ok(inLaserGrid === false, 'le planning laser ne la montre pas (tiroir « a placer » compris)');

    // =====================================================================
    console.log('\n[6] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol('  return getLaserGameCountForReservation(reservation) === 0;');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      ok(false, `ancre de mutation introuvable ou ambigue (${occurrences})`);
    } else {
      appOverride = original.replace(anchor, toFileEol('  return false;'));
      let mutated = { sub: '', off: true };
      try {
        await bootStaff(page, 'mutation');
        mutated = await page.evaluate(() => ({
          sub: document.getElementById('staffAllSub')?.textContent || '',
          off: [...document.querySelectorAll('#resList .gc-tag')].some(t => /Hors planning/.test(t.textContent)),
        }));
      } finally {
        appOverride = null;
      }
      ok(mutated.off === false && mutated.sub === 'Le jour au complet',
        `regle neutralisee : plus de zone hors planning, sous-titre « ${mutated.sub} » -> le gate ROUGIRAIT`);
      await bootStaff(page, 'restore');
      const restored = await page.evaluate(() => ({
        sub: document.getElementById('staffAllSub')?.textContent || '',
        off: [...document.querySelectorAll('#resList .gc-tag')].some(t => /Hors planning/.test(t.textContent)),
      }));
      ok(restored.off === true && restored.sub === '1 hors planning', 'restauration inverse : la zone et l alerte reviennent');
    }

    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\noff-planning-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\noff-planning-check: ALL OK - une reservation sans piste ni zone laser ne peut plus passer inapercue.');
}

main().catch((err) => { console.error(err); process.exit(1); });
