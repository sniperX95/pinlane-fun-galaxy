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
  await page.waitForSelector('[data-estab-page] .eb-bh-b', { state: 'visible', timeout: 15000 });
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
    console.log('\n[1] Cinq parties, des blocs replies, tous les champs dans la page');
    // =====================================================================
    const structure = await page.evaluate(() => ({
      nav: Array.from(document.querySelectorAll('.eb-nav-i')).map(el => el.dataset.ebLink),
      sections: Array.from(document.querySelectorAll('.eb-sec')).map(el => el.id),
      blocs: document.querySelectorAll('.eb-blk').length,
      replies: Array.from(document.querySelectorAll('.eb-blk')).filter(b => !b.classList.contains('est-ouvert')).length,
      champsReplies: document.querySelectorAll('.eb-blk:not(.est-ouvert) input, .eb-blk:not(.est-ouvert) select, .eb-blk:not(.est-ouvert) textarea').length,
      phrasesVisibles: Array.from(document.querySelectorAll('.eb-blk:not(.est-ouvert) > .eb-bh-b .eb-bh')).filter(t => t.getBoundingClientRect().height > 0).length,
      secoursVisible: getComputedStyle(document.getElementById('estab-secours-emails')).visibility,
    }));
    ok(structure.nav.join() === 'centre,horaires,offres,clients,regles', `5 entrees dans le sommaire (obtenu ${structure.nav.join(' / ')})`);
    ok(structure.sections.join() === 'eb-s-centre,eb-s-horaires,eb-s-offres,eb-s-clients,eb-s-regles', `5 parties dans la page (obtenu ${structure.sections.join(' / ')})`);
    ok(structure.replies >= 3 && structure.replies < structure.blocs, `les blocs longs sont replies, pas tous (obtenu ${structure.replies} sur ${structure.blocs})`);
    ok(structure.phrasesVisibles === structure.replies, `un bloc replie garde son titre (obtenu ${structure.phrasesVisibles} sur ${structure.replies})`);
    ok(structure.champsReplies > 20, `les champs des blocs replies restent dans la page (obtenu ${structure.champsReplies})`);
    ok(structure.secoursVisible === 'hidden', `MONTAGE un champ replie n est pas atteignable au clavier (obtenu ${structure.secoursVisible})`);

    // Les fermetures ne sont plus une section orpheline en bas de page.
    const blocksTab = await page.evaluate(() => {
      const partie = document.querySelector('.availability-blocks')?.closest('.eb-sec');
      return partie ? partie.id : 'hors-partie';
    });
    ok(blocksTab === 'eb-s-horaires', `le panneau Blocages vit dans la partie Horaires (obtenu ${blocksTab})`);

    // =====================================================================
    console.log('\n[2] Une saisie survit aux plis et au sommaire');
    // =====================================================================
    const typed = await page.evaluate(() => {
      const champ = document.getElementById('estab-laneCount');
      champ.value = '12';
      const bloc = champ.closest('.eb-blk');
      ebBasculerPli(bloc, false);
      setEstablishmentTab('offres');
      setEstablishmentTab('clients');
      ebBasculerPli(bloc, true);
      setEstablishmentTab('centre');
      return document.getElementById('estab-laneCount').value;
    });
    ok(typed === '12', `la valeur tapee survit au pli et au sommaire (obtenu "${typed}", attendu "12")`);

    // =====================================================================
    console.log('\n[2b] Un repeint ne perd pas ce qui n est pas enregistre');
    // =====================================================================
    const repeindre = () => page.evaluate(async () => {
      const champ = document.getElementById('estab-laneCount');
      champ.value = '13';
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      const temoin = document.querySelector('[data-estab-page]');
      temoin.dataset.temoin = '1';
      renderStaffUtilityPage();            // une reponse reseau arrive
      setStaffTheme(state.staffTheme === 'light' ? 'dark' : 'light');
      await new Promise(r => setTimeout(r, 60));
      return {
        valeur: document.getElementById('estab-laneCount').value,
        barre: !document.getElementById('ebBar').hidden,
        edition: state.establishmentEditing,
        meme: document.querySelector('[data-estab-page]').dataset.temoin === '1',
      };
    });
    const repeint = await repeindre();
    ok(repeint.valeur === '13' && repeint.barre && repeint.edition, `la saisie et le bouton Enregistrer restent (obtenu ${JSON.stringify(repeint)})`);
    ok(repeint.meme, 'la page n a pas ete reconstruite');
    await page.evaluate(() => cancelEstablishmentEdit());
    await page.waitForFunction(() => !state.establishmentEditing && document.getElementById('estab-laneCount') && document.getElementById('ebBar') && document.getElementById('ebBar').hidden, null, { timeout: 5000 });
    const annule = await page.evaluate(() => document.getElementById('estab-laneCount').value);
    ok(annule !== '13', `Annuler repart de ce qui est enregistre (obtenu "${annule}")`);

    // =====================================================================
    console.log('\n[3] Enregistrer depuis une autre partie n efface rien');
    // =====================================================================
    // Le piege : submitCenterConfig lit par getElementById. Si un bloc replie
    // sortait du DOM, sa config partirait aux valeurs de repli.
    const saved = await page.evaluate(async () => {
      document.getElementById('estab-laneCount').value = '11';       // onglet « Le centre »
      document.getElementById('estab-groupMinPax').value = '7';      // onglet « Clients & groupes »
      document.getElementById('estab-bar-escort').checked = true;    // onglet « Regles & comptoir »
      const offer = document.getElementById('estab-offer-f1');
      offer.checked = false;                                          // onglet « Offres & activites »
      // Onglet « Regles » : la validation par l equipe (vrais clics : le
      // niveau re-rend sa carte, l interrupteur se cherche apres) et la boite
      // de secours.
      document.querySelector('#estab-validation .estab-seg-btn[onclick*="\'normal\'"]').click();
      document.querySelector('#estab-validation input[onchange*="\'laser_partage\'"]').click();
      document.getElementById('estab-secours-emails').value = 'Secours@FunGalaxy.be, direction@fungalaxy.be';
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
        validation: JSON.stringify(config.validationEquipe || null),
        secours: JSON.stringify(config.secours || null),
      };
    });
    ok(!!saved, 'un payload saveCenterConfig est bien envoye');
    ok(saved && Number(saved.lanes) === 11, `onglet Le centre : laneCount = 11 dans le payload (obtenu ${saved && saved.lanes})`);
    ok(saved && Number(saved.groupMinPax) === 7, `onglet Clients : groupMinPax = 7 (obtenu ${saved && saved.groupMinPax})`);
    ok(saved && saved.escort === true, `onglet Regles : accompagnement active (obtenu ${saved && saved.escort})`);
    ok(saved && saved.f1 === false, `onglet Offres : formule f1 decochee (obtenu ${saved && saved.f1})`);
    ok(saved && saved.days === 7, `onglet Horaires : les 7 jours partent quand meme (obtenu ${saved && saved.days})`);
    ok(saved && saved.validation === '{"niveau":"normal","situations":{"laser_partage":true}}', `onglet Regles : niveau Normal + laser partage dans le payload (obtenu ${saved && saved.validation})`);
    ok(saved && saved.secours === '{"emails":["Secours@FunGalaxy.be","direction@fungalaxy.be"]}', `onglet Regles : la boite de secours part (obtenu ${saved && saved.secours})`);

    // =====================================================================
    console.log('\n[3b] Une adresse de secours mal formee bloque l enregistrement, et le dit');
    // =====================================================================
    await openEstablishment(page, 'secours');
    const bloque = await page.evaluate(async () => {
      document.getElementById('estab-secours-emails').value = 'secours@fungalaxy.be, pas-une-adresse';
      setEstablishmentTab('horaires');
      window.__QA_SAVED__ = [];
      await submitCenterConfig('libramont');
      const toastEl = document.getElementById('toast') || document.querySelector('.toast');
      return {
        posts: window.__QA_SAVED__.filter(body => body.action === 'saveCenterConfig').length,
        ouvert: document.getElementById('estab-secours-emails').closest('.eb-blk').classList.contains('est-ouvert'),
        active: document.activeElement ? document.activeElement.id : '',
        message: toastEl ? toastEl.textContent : '',
      };
    });
    ok(bloque.posts === 0, `rien ne part au serveur (obtenu ${bloque.posts} envoi(s))`);
    ok(bloque.ouvert === true && bloque.active === 'estab-secours-emails', `le bloc replie s ouvre sur le champ (obtenu ${bloque.ouvert} / ${bloque.active})`);
    ok(/pas-une-adresse/.test(bloque.message), `le message nomme l adresse fautive (obtenu "${bloque.message}")`);

    // =====================================================================
    console.log('\n[4] Un champ invalide ouvre SON pli');
    // =====================================================================
    const champFautif = () => page.evaluate(() => {
      const champ = document.getElementById('estab-laneCount');
      const bloc = champ.closest('.eb-blk');
      ebBasculerPli(bloc, false);                 // replie, le champ devient introuvable a l oeil
      champ.value = '999';                        // hors bornes (1-40)
      setEstablishmentTab('offres');              // on part ailleurs
      const invalid = validateEstablishmentForm();
      focusEstablishmentField(invalid[0]);
      const actif = document.activeElement;
      return {
        premier: invalid[0] ? invalid[0].id : '',
        ouvert: bloc.classList.contains('est-ouvert'),
        dansLaLigne: Boolean(actif && actif.closest('.eb-line') && actif.closest('.eb-line').contains(champ)),
        visible: actif ? getComputedStyle(actif).visibility : '',
      };
    });
    await openEstablishment(page, 'invalide');
    const focused = await champFautif();
    ok(focused.premier === 'estab-laneCount', `MONTAGE le champ hors bornes est refuse (obtenu "${focused.premier}")`);
    ok(focused.ouvert === true, 'le pli du champ invalide est ouvert');
    ok(focused.dansLaLigne === true && focused.visible === 'visible', `le clavier arrive sur la ligne fautive (obtenu ${JSON.stringify(focused)})`);

    // =====================================================================
    console.log('\n[5] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    // On remet le comportement d un pli qui ne s ouvre pas : le champ fautif reste invisible.
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const anchor = toFileEol("  if (pliDuChamp && typeof ebBasculerPli === 'function') ebBasculerPli(pliDuChamp, true);\n");
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      ok(false, `ancre de mutation introuvable ou ambigue (${occurrences})`);
    } else {
      fs.writeFileSync(APP, original.replace(anchor, ''));
      let casse = null;
      try {
        await openEstablishment(page, 'mutation');
        casse = await champFautif();
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
      ok(casse && casse.ouvert === false, `pli qui ne s ouvre plus : le champ reste cache (obtenu ${JSON.stringify(casse)}) -> le gate ROUGIRAIT`);
      const garde = toFileEol("  if (state.staffMenuPage === 'establishment' && ficheEtablissementEnCours() && root.querySelector('[data-estab-page]')) return;\n");
      if (original.split(garde).length !== 2) ok(false, 'ancre de la garde de repeint introuvable');
      fs.writeFileSync(APP, original.replace(garde, ''));
      let perdu = null;
      try {
        await openEstablishment(page, 'mutation-repeint');
        perdu = await repeindre();
      } finally {
        fs.writeFileSync(APP, original);
      }
      ok(perdu && perdu.valeur !== '13', `sans la garde, le repeint efface la saisie (obtenu ${JSON.stringify(perdu)}) -> le gate ROUGIRAIT`);
      await openEstablishment(page, 'restore');
      const restored = await champFautif();
      ok(restored.ouvert === true, 'restauration inverse : le pli s ouvre de nouveau');
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
  console.log('\nestablishment-tabs-check: ALL OK - 5 parties, aucune saisie perdue, aucun champ invalide cache.');
}

main().catch((err) => { console.error(err); process.exit(1); });
