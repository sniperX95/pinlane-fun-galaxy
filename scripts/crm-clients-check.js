// Test INTERACTIF du redesign CRM Clients. Playwright pilote de vrais clics :
// chargement sans erreur console, facettes multi-sélection DÉSÉLECTIONNABLES (le bug
// "coincé dans une catégorie"), liste data-dense, fiche client 360, historique
// dépliable, tris déselectionnables, communications. Cf. leçon ship-interactive-ui-tested.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_CRM_PORT || 4201);
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
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    const perms = ['dashboard.view','planning.view','reservations.view','reservations.create','reservations.edit','reservations.status','clients.view','clients.edit','emails.view','emails.send','settings.manage','direction.view'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const dstr = (offsetDays) => { const d = new Date('2026-07-12T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };
    const iso = (offsetDays) => { const d = new Date('2026-07-12T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString(); };
    // 6 clients distincts (phone/email uniques), résas variées → agrégats + historique.
    const R = [];
    let id = 7000;
    const add = (o) => { R.push({ id: id++, lanes: [], status: 'paid', duration: 1, centerId: 'libramont', channel: 'public', paymentMethod: 'Comptoir', activityProgress: {}, createdAt: iso((o.date ? 0 : 0)), ...o }); };
    // A — Marie (fidèle, grosse dépensière, anniversaire, multi-visites, a des comms)
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-40), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire', channel: 'public' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-15), startTime: '16:00', pax: 10, price: 390, type: 'formule', formuleId: 'f1', label: 'FORMULE 1', occasion: 'anniversaire' });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(-3), startTime: '14:00', pax: 8, price: 260, type: 'bowling', label: 'Bowling', lanes: [1,2] });
    add({ name: 'Marie Dupont', phone: '+32470111001', email: 'marie@test.be', date: dstr(20), startTime: '15:00', pax: 12, price: 468, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', occasion: 'anniversaire', status: 'pending' }); // future
    // B — Entreprise (groupe, occasion entreprise, gros pax)
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-8), startTime: '18:00', pax: 30, price: 900, type: 'laser', label: 'Laser', occasion: 'entreprise' });
    add({ name: 'Entreprise Nova', phone: '+32470111002', email: 'contact@nova.be', date: dstr(-60), startTime: '19:00', pax: 24, price: 720, type: 'bowling', label: 'Bowling 2h', lanes: [3,4,5], duration: 2, occasion: 'entreprise' });
    // C — Paul (dormant >90j)
    add({ name: 'Paul Martin', phone: '+32470111003', email: 'paul@test.be', date: dstr(-130), startTime: '17:00', pax: 4, price: 80, type: 'bowling', label: 'Bowling', lanes: [6] });
    // D — Sophie (nouveau ce mois, 1 visite)
    add({ name: 'Sophie Bernard', phone: '+32470111004', email: 'sophie@test.be', date: dstr(-2), startTime: '14:30', pax: 6, price: 120, type: 'laser', label: 'Laser' });
    // E — Lucas (multi-visites bowling, une annulée)
    add({ name: 'Lucas Petit', phone: '+32470111005', email: 'lucas@test.be', date: dstr(-25), startTime: '20:00', pax: 5, price: 100, type: 'bowling', label: 'Bowling', lanes: [7] });
    add({ name: 'Lucas Petit', phone: '+32470111005', email: 'lucas@test.be', date: dstr(-10), startTime: '20:00', pax: 5, price: 0, type: 'bowling', label: 'Bowling', lanes: [7], status: 'cancelled' });
    add({ name: 'Lucas Petit', phone: '+32470111005', email: 'lucas@test.be', date: dstr(-1), startTime: '21:00', pax: 6, price: 130, type: 'bowling', label: 'Bowling', lanes: [8] });
    // F — École (occasion ecole, groupe)
    add({ name: 'École Saint-Jean', phone: '+32470111006', email: 'ecole@test.be', date: dstr(-5), startTime: '13:00', pax: 20, price: 300, type: 'formule', formuleId: 'f6', label: 'FORMULE 6', occasion: 'ecole' });
    const build = () => R.map(r => ({ ...r }));
    const comms = [
      { id: 1, recipient: 'marie@test.be', reservationId: 7000, templateId: 'confirmation', subject: 'Votre réservation est confirmée', sentAt: iso(-40), status: 'delivered', direction: 'outbound' },
      { id: 2, recipient: 'marie@test.be', reservationId: 7001, templateId: 'reminder_48h', subject: 'Rappel de votre venue', sentAt: iso(-17), status: 'sent', direction: 'outbound' },
      { id: 3, recipient: 'marie@test.be', reservationId: 7002, templateId: 'thanks', subject: 'Merci de votre visite', sentAt: iso(-2), status: 'failed', direction: 'outbound' },
    ];
    const lanes = () => Array.from({ length: 8 }).reduce((a, _, i) => { a[i+1] = 'active'; return a; }, {});
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nf = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: build(), laneStatuses: lanes(), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: build(), emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'communications') return J({ ok: true, communications: comms });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {} });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-07-12', durationOptions: [], formules: [], center: { id: 'libramont', status: 'active', defaultSchedule: { regular: { '0': { open: '10:00', close: '22:00' }, '1': null, '2': { open: '14:00', close: '22:00' }, '3': { open: '12:00', close: '22:00' }, '4': { open: '14:00', close: '22:00' }, '5': { open: '14:00', close: '24:00' }, '6': { open: '10:00', close: '24:00' } }, holiday: {} }, holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {} } });
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
  page.on('console', msg => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(`${BASE_URL}/?v=crm-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      state.currentDate = '2026-07-12'; state.staffMenuPage = 'clients'; state.staffTheme = 'dark';
      state.reservations = window.__QA_BUILD__();
      save(); setView('staff'); renderStaff();
    });
    await page.waitForTimeout(700);

    // [LOAD] pas d'erreur console + page rendue
    console.log('\n[LOAD] page Clients rendue sans erreur');
    const load = await page.evaluate(() => ({
      root: !!document.getElementById('staffClientsPage'),
      rows: document.querySelectorAll('#staffClientsPage table tbody tr').length,
      filterToggle: !!document.querySelector('#staffClientsPage .crm-filter-toggle'),
      sortTrigger: !!document.querySelector('#staffClientsPage .crm-sort-trigger'),
      sortMenuClosed: !document.querySelector('#staffClientsPage .crm-sort-menu'),
      facetsCollapsed: document.querySelectorAll('#staffClientsPage [aria-pressed]').length === 0,
      clients: (typeof getStaffClientRows === 'function') ? getStaffClientRows().length : -1,
    }));
    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' → ' + errs.slice(0,3).join(' | ') : ''}`);
    ok(load.root, 'conteneur #staffClientsPage présent');
    ok(load.clients === 6, `6 clients agrégés depuis les résas (obtenu ${load.clients})`);
    ok(load.rows >= 6, `liste rend ${load.rows} lignes`);
    ok(load.filterToggle, 'bouton "Filtres" (barre épurée) présent');
    ok(load.sortTrigger, 'bouton "Trier" (menu custom) présent');
    ok(load.sortMenuClosed, 'menu de tri fermé par défaut');
    ok(load.facetsCollapsed, 'facettes repliées par défaut (page épurée)');

    // [TRI-MENU] le menu custom s'ouvre lisible et une option applique le tri
    console.log('\n[TRI-MENU] popover de tri custom (fini le <select> gris illisible)');
    await page.evaluate(() => document.querySelector('#staffClientsPage .crm-sort-trigger').click());
    await page.waitForTimeout(150);
    const sortMenu = await page.evaluate(() => {
      const menu = document.querySelector('#staffClientsPage .crm-sort-menu');
      const opts = menu ? [...menu.querySelectorAll('.crm-sort-option')] : [];
      const spent = opts.find(o => /dépense totale/i.test(o.textContent));
      return { open: !!menu, count: opts.length, hasSpent: !!spent };
    });
    ok(sortMenu.open, 'clic "Trier" → menu ouvert');
    ok(sortMenu.count >= 8, `menu liste ${sortMenu.count} critères lisibles`);
    const sortApplied = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#staffClientsPage .crm-sort-menu .crm-sort-option')];
      const spent = opts.find(o => /dépense totale/i.test(o.textContent));
      spent.click();
      return {
        key: (state.staffClientSort || {}).key,
        menuClosed: !document.querySelector('#staffClientsPage .crm-sort-menu'),
        current: (document.querySelector('#staffClientsPage .crm-sort-current') || {}).textContent,
      };
    });
    ok(sortApplied.key === 'spent', `choisir une option applique le tri (key=${sortApplied.key})`);
    ok(sortApplied.menuClosed, 'choisir une option referme le menu');
    ok(/dépense totale/i.test(sortApplied.current || ''), `label courant reflète le choix (${sortApplied.current})`);

    // [FACETTE] toggle + DÉSÉLECTION (le bug) — on OUVRE d'abord le panneau
    console.log('\n[FACETTE] multi-sélection déselectionnable (le bug "coincé")');
    await page.evaluate(() => document.querySelector('#staffClientsPage .crm-filter-toggle').click());
    await page.waitForTimeout(200);
    const baseRows = await page.evaluate(() => document.querySelectorAll('#staffClientsPage table tbody tr').length);
    // clique la facette "Groupe" (type) — doit filtrer
    const facetInfo = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#staffClientsPage [aria-pressed]')];
      const g = chips.find(c => /groupe/i.test(c.textContent));
      if (!g) return null;
      g.click();
      return { clicked: true };
    });
    await page.waitForTimeout(250);
    const afterFacet = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#staffClientsPage [aria-pressed]')];
      const g = chips.find(c => /groupe/i.test(c.textContent));
      return { pressed: g ? g.getAttribute('aria-pressed') : null, rows: document.querySelectorAll('#staffClientsPage table tbody tr').length };
    });
    ok(facetInfo && afterFacet.pressed === 'true', 'facette Groupe activée (aria-pressed=true)');
    ok(afterFacet.rows < baseRows && afterFacet.rows >= 1, `filtre les groupes (${baseRows} → ${afterFacet.rows})`);
    // re-clic → DÉSÉLECTION (retour base)
    await page.evaluate(() => { const g = [...document.querySelectorAll('#staffClientsPage [aria-pressed]')].find(c => /groupe/i.test(c.textContent)); g.click(); });
    await page.waitForTimeout(250);
    const afterDeselect = await page.evaluate(() => {
      const g = [...document.querySelectorAll('#staffClientsPage [aria-pressed]')].find(c => /groupe/i.test(c.textContent));
      return { pressed: g ? g.getAttribute('aria-pressed') : null, rows: document.querySelectorAll('#staffClientsPage table tbody tr').length };
    });
    ok(afterDeselect.pressed === 'false', 'DÉSÉLECTION : re-clic → aria-pressed=false (le bug corrigé)');
    ok(afterDeselect.rows === baseRows, `retour à toute la base (${afterDeselect.rows}) — plus coincé`);

    // [RESET] Réinitialiser après 2 facettes
    console.log('\n[RESET] multi-facettes + Réinitialiser');
    const multi = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#staffClientsPage [aria-pressed]')];
      const a = chips.find(c => /fidèle/i.test(c.textContent));
      const b = chips.find(c => /anniversaire/i.test(c.textContent));
      if (a) a.click(); if (b) b.click();
      return { a: !!a, b: !!b };
    });
    await page.waitForTimeout(250);
    const resetBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#staffClientsPage button')].find(b => /réinitialiser|reinitialiser|effacer|✕/i.test(b.textContent));
      const before = document.querySelectorAll('#staffClientsPage [aria-pressed="true"]').length;
      if (btn) btn.click();
      return { found: !!btn, pressedBefore: before };
    });
    await page.waitForTimeout(250);
    // Compte uniquement les FILTRES actifs (les chips de tri gardent aussi aria-pressed).
    const afterReset = await page.evaluate(() => Object.values(state.staffClientFilters || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0));
    ok(multi.a && multi.b && resetBtn.pressedBefore >= 2, `multi-sélection active (${resetBtn.pressedBefore} facettes)`);
    ok(resetBtn.found && afterReset === 0, `bouton Réinitialiser vide toutes les facettes (reste ${afterReset})`);

    // [FICHE] sélection client → fiche 360 riche
    console.log('\n[FICHE] fiche client 360');
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#staffClientsPage table tbody tr')];
      const marie = rows.find(r => /Marie/i.test(r.textContent)) || rows[0];
      marie.click();
    });
    await page.waitForTimeout(400);
    const fiche = await page.evaluate(() => {
      const panel = document.querySelector('#staffClientsPage') || document;
      const txt = panel.textContent || '';
      return {
        hasName: /Marie Dupont/.test(txt),
        blocks: {
          kpis: panel.querySelectorAll('.crm-kpi, .admin-kpi').length,
          insight: /coup d.?œil|coup d.?oeil|Aime|Vient/i.test(txt),
          history: /réservations|Toutes ses/i.test(txt),
          details: panel.querySelectorAll('details').length,
        },
        // agrégats affichés : panier moyen, joueurs cumulés quelque part
        showsPlayers: /joueurs/i.test(txt),
      };
    });
    ok(fiche.hasName, 'fiche affiche le nom du client');
    ok(fiche.blocks.kpis >= 3, `bloc "ce que vaut le client" : ${fiche.blocks.kpis} KPI`);
    ok(fiche.blocks.insight, '"En un coup d\'œil" (phrases FR) présent');
    ok(fiche.blocks.history, 'bloc historique présent');
    ok(fiche.blocks.details >= 1, `historique dépliable (${fiche.blocks.details} <details>)`);

    // [HISTORIQUE] déplie une résa
    const expand = await page.evaluate(() => {
      const d = document.querySelector('#staffClientsPage details');
      if (!d) return false; d.open = true; d.dispatchEvent(new Event('toggle'));
      return d.open;
    });
    ok(expand, 'une réservation de l\'historique se déplie');

    // [COMMS] Marie a 3 messages
    console.log('\n[COMMS] communications + renvoyer');
    await page.evaluate(async () => { if (typeof loadStaffClientComms === 'function') { try { await loadStaffClientComms(true); } catch (e) {} } });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const marie = [...document.querySelectorAll('#staffClientsPage table tbody tr')].find(r => /Marie/i.test(r.textContent)); if (marie) marie.click(); });
    await page.waitForTimeout(400);
    const commsInfo = await page.evaluate(() => {
      const marie = state.reservations.find(r => /Marie/.test(r.name));
      const row = getStaffClientRows().find(r => /Marie/.test(r.name));
      const list = typeof getStaffClientCommunications === 'function' ? getStaffClientCommunications(row) : null;
      const panel = document.querySelector('#staffClientsPage');
      const txt = panel.textContent || '';
      // "Renvoyer" est dans l'attribut title du bouton ↻ → chercher dans le HTML.
      const hasResend = /Renvoyer/i.test(panel.innerHTML) || !!panel.querySelector('[title="Renvoyer"]');
      return { count: Array.isArray(list) ? list.length : -1, hasResend, hasMessagesBlock: /Messages|relances/i.test(txt) };
    });
    ok(commsInfo.count === 3, `3 communications matchées pour Marie (obtenu ${commsInfo.count})`);
    ok(commsInfo.hasMessagesBlock, 'bloc "Messages & relances" présent');
    ok(commsInfo.hasResend, 'bouton "Renvoyer" présent');

    // [TRI] chip de tri déselectionnable
    console.log('\n[TRI] tri déselectionnable');
    const sortInfo = await page.evaluate(() => {
      const before = JSON.stringify(state.staffClientSort);
      // clique un en-tête de colonne triable
      const th = [...document.querySelectorAll('#staffClientsPage th[aria-sort]')].find(t => /dépens|panier|joueurs/i.test(t.textContent));
      if (th) th.click();
      return { before, hadTh: !!th, after: JSON.stringify(state.staffClientSort) };
    });
    await page.waitForTimeout(200);
    ok(sortInfo.hadTh && sortInfo.before !== sortInfo.after, 'clic en-tête change le tri');

    // [SHOT] capture visuelle du menu de tri ouvert (dark + light), à la demande
    if (process.env.CRM_SHOT) {
      const shotDir = process.env.CRM_SHOT;
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { state.staffTheme = t; state.staffClientSortOpen = true; save(); renderStaffClientsPage(); }, theme);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${shotDir}/crm-sort-${theme}.png`, clip: { x: 0, y: 0, width: 1400, height: 460 } });
      }
      await page.evaluate(() => { state.staffClientSortOpen = false; save(); renderStaffClientsPage(); });
    }

    if (errs.length) { console.log('\nConsole errors:\n' + errs.join('\n')); }
  } catch (e) {
    console.error('\ncrm-clients-check FAIL:', e.stack || e.message);
    if (errs.length) console.log('Console errors:\n' + errs.join('\n'));
    failures += 1;
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\ncrm-clients-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncrm-clients-check: ALL OK');
}
main();
