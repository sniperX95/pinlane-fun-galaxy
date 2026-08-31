// Page Etablissement decoupee en 5 onglets : ce gate protege ce qui casserait
// pour de vrai si la structure bougeait.
//
// La page etait un mur : 7 sections empilees en lecture, 9 fieldsets en grille
// auto-fit en edition (4900 px). Elle est maintenant categorisee (Le centre /
// Horaires & fermetures / Offres & activites / Clients & groupes / Regles &
// comptoir).
//
// Le vrai risque de cette refonte n'est pas visuel, il est dans la SAISIE :
//   1. submitCenterConfig lit les champs par getElementById -> si un onglet
//      ferme n'etait pas dans le DOM, enregistrer depuis un autre onglet
//      ecraserait sa config par les valeurs de repli. On verifie donc qu'une
//      valeur tapee dans un onglet part bien dans le payload envoye depuis un
//      AUTRE onglet.
//   2. Changer d'onglet ne doit PAS re-rendre la page : un re-render relit la
//      config serveur et efface ce qui vient d'etre tape.
//   3. Un champ invalide sous un onglet ferme doit ouvrir son onglet, sinon le
//      message "corrigez les champs" designe un champ invisible.
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const APP = path.join(ROOT, 'assets/app-main.js');
const PORT = Number(process.env.PINLANE_ESTAB_TABS_PORT || 4213);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Config centre construite depuis la VRAIE baseline du repo (pas un objet
// invente) : si la forme servie change, ce gate le voit.
const centerConfig = (() => {
  const cc = require(path.join(ROOT, 'lib', 'center-config'));
  const baseline = require(path.join(ROOT, 'ops-knowledge', 'centers.json'));
  const knowledge = require(path.join(ROOT, 'ops-knowledge', 'activities.json'));
  return {
    ok: true,
    centers: (baseline.centers || []).map(center => ({ id: center.id, name: center.name, clientId: 'fungalaxy', clientName: 'Fun Galaxy', ...cc.toEditableConfig(center) })),
    activities: (knowledge.activities || []).map(activity => ({ id: activity.id, label: activity.label || activity.name || activity.id })),
  };
})();

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
  await page.addInitScript(({ expiresAt, CENTER_CONFIG }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const J = (p) => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${Date.now()}` } });
    const nativeFetch = window.fetch.bind(window);
    window.__QA_SAVED__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-07-18', durationOptions: [], formules: [/* forme prod reelle : depuis le durcissement anti-fuite, une liste vide = ce centre ne vend AUCUNE formule (plus de repli constante) */ { id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game', '30 min arcades', '2 cruches boissons'], price: 26, type: 'per_pax', minPax: 6, oldPrice: 34, noHolidays: false, hasBowling: true, bowlingDur: 1, notes: [] }], center: { id: 'libramont', status: 'active' } });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_SAVED__.push(body);
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(CENTER_CONFIG);
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, CENTER_CONFIG: centerConfig });
}

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

async function openEstablishment(page, cacheKey) {
  // domcontentloaded + attentes explicites : le polling staff empeche le
  // networkidle de se produire une fois l'app demarree.
  await page.goto(`${BASE_URL}/?v=estabtabs-${cacheKey}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    state.currentDate = '2026-07-18';
    state.staffMenuPage = 'establishment';
    state.establishmentTab = 'centre';
    state.establishmentEditing = false;
    state.staffTheme = 'dark';
    save();
    setView('staff');
  });
  await page.waitForSelector('.estab-tabs button', { state: 'visible', timeout: 15000 });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  // On traque les VRAIES erreurs JS. Les « Failed to load resource » viennent du
  // banc d'essai (CDN analytics hors ligne, favicon absent) : les compter ferait
  // rougir le gate pour une raison qui n'a rien a voir avec la page.
  const errs = [];
  page.on('pageerror', error => errs.push(`PAGEERROR: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
    errs.push(text);
  });
  try {
    await installMock(page);
    await openEstablishment(page, 'base');

    // =====================================================================
    console.log('\n[1] Cinq categories, un seul panneau visible');
    // =====================================================================
    const structure = await page.evaluate(() => ({
      tabs: Array.from(document.querySelectorAll('.estab-tabs button')).map(el => el.textContent.trim()),
      panels: Array.from(document.querySelectorAll('.estab-panel')).map(el => el.id),
      visible: Array.from(document.querySelectorAll('.estab-panel')).filter(el => !el.hidden).map(el => el.id),
    }));
    ok(structure.tabs.length === 5, `5 onglets (obtenu ${structure.tabs.length} : ${structure.tabs.join(' / ')})`);
    ok(structure.panels.length === 5, `5 panneaux dans le DOM (obtenu ${structure.panels.length})`);
    ok(structure.visible.length === 1 && structure.visible[0] === 'estabPanel-centre', `un seul panneau visible (${structure.visible.join(',') || 'aucun'})`);

    // Les fermetures ne sont plus une section orpheline en bas de page.
    const blocksTab = await page.evaluate(() => {
      const panel = document.querySelector('.availability-blocks')?.closest('.estab-panel');
      return panel ? panel.id : 'hors-onglet';
    });
    ok(blocksTab === 'estabPanel-horaires', `le panneau Blocages vit dans l'onglet Horaires (obtenu ${blocksTab})`);

    // =====================================================================
    console.log('\n[2] EDITION : une saisie survit au changement d onglet');
    // =====================================================================
    await page.evaluate(() => { startEstablishmentEdit(); });
    await page.waitForTimeout(400);
    const typed = await page.evaluate(() => {
      document.getElementById('estab-laneCount').value = '12';
      setEstablishmentTab('offres');
      setEstablishmentTab('clients');
      setEstablishmentTab('centre');
      return document.getElementById('estab-laneCount').value;
    });
    ok(typed === '12', `la valeur tapee survit a 3 changements d'onglet (obtenu "${typed}", attendu "12")`);

    // =====================================================================
    console.log('\n[3] EDITION : enregistrer depuis un autre onglet n efface rien');
    // =====================================================================
    // Le piege : submitCenterConfig lit par getElementById. Si un onglet ferme
    // sortait du DOM, sa config partirait aux valeurs de repli.
    const saved = await page.evaluate(async () => {
      document.getElementById('estab-laneCount').value = '11';       // onglet « Le centre »
      document.getElementById('estab-groupMinPax').value = '7';      // onglet « Clients & groupes »
      document.getElementById('estab-bar-escort').checked = true;    // onglet « Regles & comptoir »
      const offer = document.getElementById('estab-offer-f1');
      offer.checked = false;                                          // onglet « Offres & activites »
      setEstablishmentTab('horaires');                                // on enregistre depuis AILLEURS
      window.__QA_SAVED__ = [];
      await submitCenterConfig('libramont');
      const config = (window.__QA_SAVED__.find(body => body.action === 'saveCenterConfig') || {}).config || null;
      return config && {
        lanes: config.resources?.bowling?.laneCount,
        groupMinPax: config.classification?.groupMinPax,
        escort: config.resources?.barDesk?.activityEscort,
        f1: config.offerAvailability?.f1,
        days: Object.keys(config.defaultSchedule?.regular || {}).length,
      };
    });
    ok(!!saved, 'un payload saveCenterConfig est bien envoye');
    ok(saved && Number(saved.lanes) === 11, `onglet Le centre : laneCount = 11 dans le payload (obtenu ${saved && saved.lanes})`);
    ok(saved && Number(saved.groupMinPax) === 7, `onglet Clients : groupMinPax = 7 (obtenu ${saved && saved.groupMinPax})`);
    ok(saved && saved.escort === true, `onglet Regles : accompagnement active (obtenu ${saved && saved.escort})`);
    ok(saved && saved.f1 === false, `onglet Offres : formule f1 decochee (obtenu ${saved && saved.f1})`);
    ok(saved && saved.days === 7, `onglet Horaires : les 7 jours partent quand meme (obtenu ${saved && saved.days})`);

    // =====================================================================
    console.log('\n[4] Un champ invalide ouvre SON onglet');
    // =====================================================================
    await openEstablishment(page, 'invalide');
    const focused = await page.evaluate(() => {
      startEstablishmentEdit();
      document.getElementById('estab-laneCount').value = '999';  // hors bornes (1-40)
      setEstablishmentTab('offres');                              // on part ailleurs
      const invalid = validateEstablishmentForm();
      focusEstablishmentField(invalid[0]);
      return {
        tab: state.establishmentTab,
        activeId: document.activeElement ? document.activeElement.id : '',
        panelVisible: !document.getElementById('estabPanel-centre').hidden,
      };
    });
    ok(focused.tab === 'centre', `l'onglet du champ invalide est ouvert (obtenu ${focused.tab})`);
    ok(focused.panelVisible === true, 'son panneau est bien visible');
    ok(focused.activeId === 'estab-laneCount', `le focus est sur le champ fautif (obtenu "${focused.activeId}")`);

    // =====================================================================
    console.log('\n[5] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    // On remet le comportement d'avant : changer d'onglet re-rend la page. La
    // saisie non enregistree doit alors disparaitre, et le gate rougir.
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol('  const panels = document.querySelectorAll(\'.estab-panel\');\n  if (!panels.length) { renderStaffUtilityPage(); return; }');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      ok(false, `ancre de mutation introuvable ou ambigue (${occurrences})`);
    } else {
      fs.writeFileSync(APP, original.replace(anchor, toFileEol('  const panels = document.querySelectorAll(\'.estab-panel\');\n  { renderStaffUtilityPage(); return; }')));
      let survived = null;
      try {
        await openEstablishment(page, 'mutation');
        survived = await page.evaluate(() => {
          startEstablishmentEdit();
          document.getElementById('estab-laneCount').value = '12';
          setEstablishmentTab('offres');
          setEstablishmentTab('centre');
          return document.getElementById('estab-laneCount').value;
        });
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
      ok(survived !== '12', `re-render retabli : la saisie est perdue (obtenu "${survived}") -> le gate ROUGIRAIT`);
      await openEstablishment(page, 'restore');
      const restored = await page.evaluate(() => {
        startEstablishmentEdit();
        document.getElementById('estab-laneCount').value = '12';
        setEstablishmentTab('offres');
        setEstablishmentTab('centre');
        return document.getElementById('estab-laneCount').value;
      });
      ok(restored === '12', 'restauration inverse : la saisie survit de nouveau');
    }

    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\nestablishment-tabs-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nestablishment-tabs-check: ALL OK - 5 categories, aucune saisie perdue, aucun champ invalide cache.');
}

main().catch((err) => { console.error(err); process.exit(1); });
