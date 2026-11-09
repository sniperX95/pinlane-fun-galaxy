// La page Etablissement (2026-11-09) : une rangee de cases (horaires, formules,
// clients et comptoir, fiche du centre) et une colonne par salle ; une case
// s ouvre sous la rangee, les autres restent dans la page, masquees. Ce gate
// protege ce qui casserait pour de vrai :
//   1. submitCenterConfig lit les champs par getElementById : un champ d une
//      case fermee doit rester dans la page, sinon enregistrer depuis une autre
//      case ecraserait sa config par les valeurs de repli.
//   2. Changer de case ne re-rend pas la page : un rendu relit la config du
//      serveur et effacerait ce qui vient d etre tape. Un repeint venu du
//      reseau ne l efface pas non plus.
//   3. Un champ invalide dans une case fermee ouvre sa case, sinon le message
//      « corrigez les champs » designe un champ invisible.
//   4. Un centre sans grille d horaires (Gembloux suit la grille d origine) se
//      montre avec les heures que le moteur applique : l afficher ferme, puis
//      l enregistrer, le fermerait pour de vrai.
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

async function openEstablishment(page, cacheKey, centre = 'libramont') {
  // domcontentloaded + attentes explicites : le polling staff empeche le
  // networkidle de se produire une fois l'app demarree.
  await page.goto(`${BASE_URL}/?v=estabtabs-${cacheKey}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 15000 });
  await page.evaluate((c) => {
    state.currentDate = '2026-07-18';
    state.adminCenterId = c;
    state.staffMenuPage = 'establishment';
    state.establishmentTab = 'centre';
    state.establishmentEditing = false;
    state.staffTheme = 'dark';
    save();
    setView('staff');
  }, centre);
  await page.waitForSelector(`[data-estab-page][data-eb-center="${centre}"] .eb-m`, { state: 'visible', timeout: 15000 });
}

// Un champ fautif dans une case fermee : on part ailleurs, on valide, le clavier doit arriver sur lui.
const champFautif = (page) => page.evaluate(() => {
  ebOuvrir('horaires');
  const champ = document.getElementById('estab-laneCount');
  champ.value = '999';                        // hors bornes (1-40)
  ebOuvrir('formules');                       // on part ailleurs
  const invalid = validateEstablishmentForm();
  focusEstablishmentField(invalid[0]);
  const actif = document.activeElement;
  return {
    premier: invalid[0] ? invalid[0].id : '',
    ouverte: !champ.closest('.eb-pan').hidden,
    actif: actif ? actif.id : '',
    visible: champ.getClientRects().length > 0,
  };
});

const repeindre = (page) => page.evaluate(async () => {
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

// Gembloux n a pas de grille : la page montre ce que le moteur applique, et c est ce qui part.
const horairesSansGrille = (page) => page.evaluate(async () => {
  const lire = (p, j) => ({ ferme: document.getElementById(`${p}-${j}-closed`).checked, ouvre: document.getElementById(`${p}-${j}-open`).value, fin: document.getElementById(`${p}-${j}-close`).value });
  const vu = { mardi: lire('estab-day', 2), lundi: lire('estab-day', 1), samediVacances: lire('estab-hday', 6) };
  window.__QA_SAVED__ = [];
  await submitCenterConfig('gembloux');
  const config = (window.__QA_SAVED__.find(body => body.action === 'saveCenterConfig') || {}).config || null;
  return { vu, mardi: config && config.defaultSchedule.regular['2'], lundi: config && config.defaultSchedule.regular['1'], samediVacances: config && config.defaultSchedule.holiday['6'] };
});

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
  page.on('dialog', dialog => { dialog.accept().catch(() => {}); });
  try {
    await installMock(page);
    await openEstablishment(page, 'base');

    // =====================================================================
    console.log('\n[1] Une rangee de cases, une seule ouverte, tous les champs dans la page');
    // =====================================================================
    const structure = await page.evaluate(() => ({
      menu: Array.from(document.querySelectorAll('.eb-m')).map(el => el.dataset.k),
      salles: Array.from(document.querySelectorAll('.eb-salles .eb-col')).map(el => el.dataset.k),
      ouvertes: Array.from(document.querySelectorAll('.eb-pan')).filter(p => !p.hidden).map(p => p.dataset.k),
      champsFermes: document.querySelectorAll('.eb-pan[hidden] input, .eb-pan[hidden] select, .eb-pan[hidden] textarea').length,
      secoursAtteignable: document.getElementById('estab-secours-emails').getClientRects().length > 0,
      fermetures: (document.querySelector('.availability-blocks') && document.querySelector('.availability-blocks').closest('.eb-pan') || {}).dataset?.k || 'hors-case',
      activitesSansCase: (staffCenterConfigCache.activities || []).filter(a => !document.getElementById(`estab-act-${a.id}`)).map(a => a.id),
    }));
    ok(structure.menu.join() === 'horaires,formules,clients,fiche', `4 cases de reglages (obtenu ${structure.menu.join(' / ')})`);
    ok(structure.salles.includes('bowling') && structure.salles.includes('laser_game') && structure.salles.includes('tables') && structure.salles[structure.salles.length - 1] === 'plus', `une colonne par salle, les tables, le + (obtenu ${structure.salles.join(' / ')})`);
    ok(structure.ouvertes.join() === 'horaires', `une seule case ouverte, les horaires (obtenu ${structure.ouvertes.join(' / ')})`);
    ok(structure.champsFermes > 60, `les champs des cases fermees restent dans la page (obtenu ${structure.champsFermes})`);
    ok(structure.secoursAtteignable === false, 'MONTAGE un champ d une case fermee n est pas atteignable');
    ok(structure.fermetures === 'horaires', `les fermetures vivent dans la case Horaires (obtenu ${structure.fermetures})`);
    ok(structure.activitesSansCase.length === 0, `chaque activite du catalogue a sa case a cocher (sans case : ${structure.activitesSansCase.join(', ') || 'aucune'})`);

    // =====================================================================
    console.log('\n[2] Une saisie survit aux cases');
    // =====================================================================
    const typed = await page.evaluate(() => {
      ebOuvrir('bowling');
      document.getElementById('estab-laneCount').value = '12';
      ebOuvrir('formules');
      setEstablishmentTab('offres');
      ebOuvrir('clients');
      ebOuvrir('bowling');
      return { valeur: document.getElementById('estab-laneCount').value, onglet: state.establishmentTab };
    });
    ok(typed.valeur === '12', `la valeur tapee survit aux cases (obtenu "${typed.valeur}", attendu "12")`);
    ok(typed.onglet === 'bowling', `la case ouverte est retenue (obtenu ${typed.onglet})`);

    // =====================================================================
    console.log('\n[2b] Un repeint ne perd pas ce qui n est pas enregistre');
    // =====================================================================
    const repeint = await repeindre(page);
    ok(repeint.valeur === '13' && repeint.barre && repeint.edition, `la saisie et le bouton Enregistrer restent (obtenu ${JSON.stringify(repeint)})`);
    ok(repeint.meme, 'la page n a pas ete reconstruite');
    await page.evaluate(() => cancelEstablishmentEdit());
    await page.waitForFunction(() => !state.establishmentEditing && document.getElementById('estab-laneCount') && document.getElementById('ebBar') && document.getElementById('ebBar').hidden, null, { timeout: 5000 });
    const annule = await page.evaluate(() => document.getElementById('estab-laneCount').value);
    ok(annule !== '13', `Annuler repart de ce qui est enregistre (obtenu "${annule}")`);

    // =====================================================================
    console.log('\n[3] Enregistrer depuis une autre case n efface rien');
    // =====================================================================
    // Le piege : submitCenterConfig lit par getElementById. Si une case fermee
    // sortait de la page, sa config partirait aux valeurs de repli.
    const saved = await page.evaluate(async () => {
      document.getElementById('estab-laneCount').value = '11';       // case Bowling
      document.getElementById('estab-groupMinPax').value = '7';      // case Clients et comptoir
      document.getElementById('estab-bar-escort').checked = true;    // case Clients et comptoir
      document.getElementById('estab-offer-f1').checked = false;     // case Formules
      document.getElementById('estab-parking').value = 'Gratuit, 80 places'; // case Fiche du centre
      // La validation par l equipe (vrais clics : le niveau re-rend sa carte,
      // la case se cherche apres) et la boite de secours.
      document.querySelector('#estab-validation .estab-seg-btn[onclick*="\'normal\'"]').click();
      document.querySelector('#estab-validation input[onchange*="\'laser_partage\'"]').click();
      document.getElementById('estab-secours-emails').value = 'Secours@FunGalaxy.be, direction@fungalaxy.be';
      ebOuvrir('horaires');                                           // on enregistre depuis AILLEURS
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
        parking: config.publicInfo?.parking,
      };
    });
    ok(!!saved, 'un payload saveCenterConfig est bien envoye');
    ok(saved && Number(saved.lanes) === 11, `case Bowling : laneCount = 11 dans le payload (obtenu ${saved && saved.lanes})`);
    ok(saved && Number(saved.groupMinPax) === 7, `case Clients : groupMinPax = 7 (obtenu ${saved && saved.groupMinPax})`);
    ok(saved && saved.escort === true, `case Clients : accompagnement active (obtenu ${saved && saved.escort})`);
    ok(saved && saved.f1 === false, `case Formules : formule f1 decochee (obtenu ${saved && saved.f1})`);
    ok(saved && saved.days === 7, `case Horaires : les 7 jours partent quand meme (obtenu ${saved && saved.days})`);
    ok(saved && saved.validation === '{"niveau":"normal","situations":{"laser_partage":true}}', `case Clients : niveau Normal + laser partage dans le payload (obtenu ${saved && saved.validation})`);
    ok(saved && saved.secours === '{"emails":["Secours@FunGalaxy.be","direction@fungalaxy.be"]}', `case Clients : la boite de secours part (obtenu ${saved && saved.secours})`);
    ok(saved && saved.parking === 'Gratuit, 80 places', `case Fiche : le parking part (obtenu ${saved && saved.parking})`);

    // =====================================================================
    console.log('\n[3b] Une adresse de secours mal formee bloque l enregistrement, et le dit');
    // =====================================================================
    await openEstablishment(page, 'secours');
    const bloque = await page.evaluate(async () => {
      document.getElementById('estab-secours-emails').value = 'secours@fungalaxy.be, pas-une-adresse';
      ebOuvrir('horaires');
      window.__QA_SAVED__ = [];
      await submitCenterConfig('libramont');
      const toastEl = document.getElementById('toast') || document.querySelector('.toast');
      return {
        posts: window.__QA_SAVED__.filter(body => body.action === 'saveCenterConfig').length,
        ouverte: !document.getElementById('estab-secours-emails').closest('.eb-pan').hidden,
        active: document.activeElement ? document.activeElement.id : '',
        message: toastEl ? toastEl.textContent : '',
      };
    });
    ok(bloque.posts === 0, `rien ne part au serveur (obtenu ${bloque.posts} envoi(s))`);
    ok(bloque.ouverte === true && bloque.active === 'estab-secours-emails', `la case s ouvre sur le champ (obtenu ${bloque.ouverte} / ${bloque.active})`);
    ok(/pas-une-adresse/.test(bloque.message), `le message nomme l adresse fautive (obtenu "${bloque.message}")`);

    // =====================================================================
    console.log('\n[4] Un champ invalide ouvre SA case');
    // =====================================================================
    await openEstablishment(page, 'invalide');
    const focused = await champFautif(page);
    ok(focused.premier === 'estab-laneCount', `MONTAGE le champ hors bornes est refuse (obtenu "${focused.premier}")`);
    ok(focused.ouverte === true && focused.visible === true, 'la case du champ invalide est ouverte');
    ok(focused.actif === 'estab-laneCount', `le clavier arrive sur le champ fautif (obtenu ${JSON.stringify(focused)})`);

    // =====================================================================
    console.log('\n[4b] Un centre sans grille montre les heures que le moteur applique');
    // =====================================================================
    await openEstablishment(page, 'sans-grille', 'gembloux');
    const sansGrille = await horairesSansGrille(page);
    ok(sansGrille.vu.mardi.ferme === false && sansGrille.vu.mardi.ouvre === '14:00', `mardi : ouvert a 14:00 comme le moteur (obtenu ${JSON.stringify(sansGrille.vu.mardi)})`);
    ok(sansGrille.vu.lundi.ferme === true, `lundi : ferme comme le moteur (obtenu ${JSON.stringify(sansGrille.vu.lundi)})`);
    ok(sansGrille.mardi && sansGrille.mardi.open === '14:00' && sansGrille.mardi.close === '22:00', `enregistrer garde mardi 14:00 a 22:00 (obtenu ${JSON.stringify(sansGrille.mardi)})`);
    ok(sansGrille.lundi === null && sansGrille.samediVacances && sansGrille.samediVacances.close === '24:00', `lundi reste ferme, samedi de vacances jusqu a minuit (obtenu ${JSON.stringify(sansGrille)})`);

    // =====================================================================
    console.log('\n[5] CONTRE-PREUVES par mutation (ce gate sait-il rougir ?)');
    // =====================================================================
    const original = fs.readFileSync(APP, 'utf8');
    const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
    const muter = async (nom, avant, apres, epreuve, rougit) => {
      const ancre = toFileEol(avant);
      const n = original.split(ancre).length - 1;
      if (n !== 1) { ok(false, `${nom} : ancre de mutation introuvable ou ambigue (${n})`); return null; }
      fs.writeFileSync(APP, original.replace(ancre, toFileEol(apres)));
      try {
        await epreuve();
        return await rougit();
      } finally {
        fs.writeFileSync(APP, original); // restauration par edition inverse
      }
    };
    // a. Une case qui ne s ouvre pas : le champ fautif reste cache.
    const casse = await muter('case', '  if (panneau && panneau.hidden) ebOuvrir(panneau.dataset.k);\n', '', () => openEstablishment(page, 'mutation'), () => champFautif(page));
    ok(casse && casse.ouverte === false, `case qui ne s ouvre plus : le champ reste cache (obtenu ${JSON.stringify(casse)}) -> le gate ROUGIRAIT`);
    // b. Sans la garde de repeint, la saisie s efface.
    const perdu = await muter('repeint', "  if (state.staffMenuPage === 'establishment' && ficheEtablissementEnCours() && root.querySelector('[data-estab-page]')) return;\n", '', () => openEstablishment(page, 'mutation-repeint'), () => repeindre(page));
    ok(perdu && perdu.valeur !== '13', `sans la garde, le repeint efface la saisie (obtenu ${JSON.stringify(perdu)}) -> le gate ROUGIRAIT`);
    // c. Lire seulement la grille du centre : Gembloux s affiche ferme, et partirait ferme.
    const ferme = await muter('grille', '  const slot = ebCreneauApplique(c.horaires, bloc, key);\n', '  const slot = (c.horaires[bloc] && c.horaires[bloc][key]) || null;\n', () => openEstablishment(page, 'mutation-grille', 'gembloux'), () => horairesSansGrille(page));
    ok(ferme && ferme.vu.mardi.ferme === true && ferme.mardi === null, `sans la grille appliquee, Gembloux partirait ferme le mardi (obtenu ${JSON.stringify(ferme && ferme.mardi)}) -> le gate ROUGIRAIT`);
    await openEstablishment(page, 'restore');
    const restored = await champFautif(page);
    ok(restored.ouverte === true, 'restauration inverse : la case s ouvre de nouveau');

    ok(errs.length === 0, `aucune erreur console (${errs.length})${errs.length ? ' : ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.error(`\nestablishment-tabs-check: FAIL ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nestablishment-tabs-check: ALL OK - une case ouverte a la fois, aucune saisie perdue, aucun champ invalide cache, les heures du moteur pour un centre sans grille.');
}

main().catch((err) => { console.error(err); process.exit(1); });
