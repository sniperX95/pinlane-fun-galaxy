// LA RESERVATION RAPIDE SUIT LE CATALOGUE ET LE NOMBRE DE JOUEURS (2026-08-19).
// Deux defauts signales par Movsar sur captures :
//   1. « on monte de joueurs jusqu a plus de 6 et ça reste encore en disant une
//      piste requise » : la ligne d etat ne se recalculait pas pendant la
//      frappe (seul le total etait patche, le commentaire du code affirmait
//      meme que c etait « le seul nombre visible qui depend des joueurs »).
//   2. « on peut reserver que bowling et laser et formules alors que mtn on a
//      integre tout plein d autre » : trois boutons codes en dur pendant que le
//      centre vend huit activites. Meme classe de defaut que la grille Tarifs
//      du 2026-08-17, qui enumerait une CONSTANTE figee au deploiement.
// LES SEANCES (2026-11-03) : la fenetre du comptoir a change d ecran, pas de
// regles. Les activites a seances (bowling, laser) sont des blocs #rsZ-<id>,
// les autres des tuiles #rsT-<id>, les formules et le sur mesure des portes ;
// chaque activite retenue est une ligne du ticket (#rsL-a-<id>) qui ouvre sa
// page : ses reglages, ses pistes, « Retirer ». Les joueurs se touchent
// (#rsHaut [data-pax]) ou se tapent dans « Autre » (#qbPax, pose a Entree).
// La ligne d etat sous le nombre (#rvConsequence) n existe plus : ce que le
// nombre change se lit sur la page de la ligne (« conseillé » sous le nombre
// de pistes) et sur la ligne du ticket (« pistes 1 et 2 »).
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PINLANE_QUICKBOOK_PORT || 4225);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let failures = 0;
function ok(cond, label) { console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label); if (!cond) failures += 1; return cond; }

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

// Le catalogue du centre : HUIT activites vendables, comme en prod.
const ACTIVITIES = [
  { id: 'bowling', name: 'Bowling', planned: true, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 1, defaultMinutes: 60 },
  { id: 'laser_game', name: 'Laser Game', planned: true, priceType: 'grid_laser', priceValue: null, unitLabel: 'par personne', order: 2, defaultMinutes: 22 },
  { id: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false, priceType: 'per_pax', priceValue: 10, unitLabel: 'par personne', order: 3, defaultMinutes: 45 },
  { id: 'billards', name: 'Billards', planned: false, priceType: 'per_unit_hour', priceValue: 12, unitLabel: 'par table et par heure', order: 5, defaultMinutes: 60 },
  { id: 'arcade_time', name: 'Arcades', planned: false, priceType: 'per_pax', priceValue: null, unitLabel: '', order: 6, defaultMinutes: 30 },
  { id: 'playground', name: 'Playground', planned: false, priceType: 'per_pax', priceValue: 12, unitLabel: 'par enfant', order: 7, defaultMinutes: 60 },
  { id: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, priceType: 'grid_bowling', priceValue: null, unitLabel: 'par piste', order: 8, defaultMinutes: 60 },
  { id: 'fun_run', name: 'Fun Run by PIXEL', planned: false, priceType: 'grid_fun_run', priceValue: null, unitLabel: 'par session', order: 9, defaultMinutes: 15 },
];

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, ACTIVITIES }) => {
    const perms = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'planning.drag', 'reservations.view', 'reservations.create', 'reservations.quick', 'reservations.edit', 'reservations.status', 'clients.view', 'payments.view', 'settings.manage', 'direction.view'];
    const qaSession = { token: 'qa', centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    const today = new Date().toISOString().slice(0, 10);
    const J = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    const nf = window.fetch.bind(window);
    window.__QA_POSTS__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(raw, window.location.origin);
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: Array.from({ length: 8 }).reduce((a, _, i) => { a[i + 1] = 'active'; return a; }, {}), centerId: 'libramont' });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], laneStatuses: {}, centerId: 'libramont', revision: 'qa', syncedAt: new Date().toISOString() });
      if (u.pathname === '/api/staff-reservations' && String(init.method || 'GET').toUpperCase() === 'POST') {
        const corps = JSON.parse(init.body || '{}');
        // LA FENETRE SIMULE AVANT DE CREER (dryRun, 2026-10-08) : une
        // simulation n est pas une creation, elle ne se compte pas.
        if (corps.dryRun) return J({ ok: true, dryRun: true, plan: { disponible: true, debut: corps.startTime || '', fin: '', blocs: [], etapes: [], prix: null } });
        window.__QA_POSTS__.push(corps);
        return J({ ok: true, reservation: { id: 4242, date: today, startTime: '14:00', pax: 4, status: 'pending', type: 'visite', lanes: [] } });
      }
      // Le client deja venu et les departs rapides : lectures de la fenetre.
      if (u.pathname === '/api/staff-reservations') return J({ ok: true, client: null, departs: [] });
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], customRequests: [] });
      if (u.pathname === '/api/public-booking-meta') {
        return J({
          ok: true, today, durationOptions: [], formules: [], activities: ACTIVITIES,
          center: {
            id: 'libramont', status: 'active',
            defaultSchedule: { regular: { 0: { open: '10:00', close: '22:00' }, 1: { open: '10:00', close: '22:00' }, 2: { open: '10:00', close: '22:00' }, 3: { open: '10:00', close: '22:00' }, 4: { open: '10:00', close: '22:00' }, 5: { open: '10:00', close: '24:00' }, 6: { open: '10:00', close: '24:00' } }, holiday: {} },
            holidaySettings: { enabled: true, overrides: [], formulaBlockedPeriods: [] }, offerAvailability: {},
            day: { date: today, open: true, schedule: { open: 10, close: 22, label: '10h - 22h' }, closedLabel: '', closedWindows: [], unavailableFormulaIds: [], unavailableActivityIds: [], unavailableFormulaReason: {} },
          },
        });
      }
      return nf(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, ACTIVITIES });
}

// Ce que le nombre de joueurs change au bowling, lu a l ecran : la page de la
// ligne Bowling marque « conseillé » le nombre de pistes du centre (la regle
// « Auto ») et presse celui qui part ; la ligne du ticket dit les pistes posees.
async function pistesLues(page) {
  await page.click('#rsL-a-bowling');
  await page.waitForSelector('#rsCorps [data-pistes]', { timeout: 5000 });
  return page.evaluate(() => {
    const cles = [...document.querySelectorAll('#rsCorps [data-pistes]')].map((b) => ({
      n: Number(b.dataset.pistes),
      conseille: /conseillé/.test((b.querySelector('small') || {}).textContent || ''),
      on: b.classList.contains('is-on') && b.getAttribute('aria-pressed') === 'true',
    }));
    const conseillee = cles.find((c) => c.conseille);
    const choisie = cles.find((c) => c.on);
    const detail = ((document.querySelector('#rsL-a-bowling .rs-tk-n small') || {}).textContent || '').trim();
    const posees = /\bpistes?\s+((?:\d+(?:, | et )?)+)/.exec(detail);
    return {
      conseille: conseillee ? conseillee.n : 0,
      choisie: choisie ? choisie.n : 0,
      ticketPistes: posees ? posees[1].match(/\d+/g).length : 0,
      unePiste: cles.some((c) => c.n === 1 && (c.conseille || c.on)),
      texte: `${conseillee ? conseillee.n : '?'} conseillée(s), ${choisie ? choisie.n : '?'} choisie(s), ticket « ${detail || 'absent'} »`,
    };
  });
}

async function main() {
  const server = await serveStatic();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await installMock(page);
    await page.goto(BASE_URL + '/?v=qb-' + Date.now(), { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => window.setView('staff'));
    await page.waitForTimeout(1500);
    // Le catalogue doit etre charge avant d'ouvrir : c'est lui qui peuple le
    // selecteur.
    await page.waitForFunction(() => typeof window.getCenterActivities === 'function' && window.getCenterActivities().length >= 8, null, { timeout: 15000 });
    // Un jour FUTUR a 14:00 : le soir, aujourd hui n a plus d heure ouverte.
    const demain = await page.evaluate(() => { const d = new Date(todayStr() + 'T12:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await page.evaluate((jour) => window.openQuickBook({ date: jour, startTime: '14:00', type: 'bowling', pax: 4 }), demain);
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv #rsL-a-bowling', { timeout: 8000 });
    await page.waitForTimeout(700);
    // Les activites retenues, a l ecran : les lignes du ticket, dans leur ordre.
    const lignes = () => page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay #rsLignes .rs-tk-a[id^="rsL-a-"] .rs-tk-n > b')].map((e) => e.textContent.trim()));
    // Chaque toucher ajoute (2026-11-03) : sur l ecran des activites, une seance
    // (bowling, laser) ou une tuile entre au ticket sans quitter la page.
    const activites = async () => {
      if (!(await page.locator('#quickBookOverlay .qb-modal.rv.is-q-activites').count())) await page.click('#rsRetour');
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-activites', { timeout: 3000 });
    };
    const ajouter = async (id) => {
      await activites();
      // Une seance pas encore au ticket est repliee (2026-11-08) : son bouton l ajoute.
      const seance = ['bowling', 'laser_game'].includes(id);
      const repliee = seance && (await page.locator(`#rsAjout-${id}`).count()) > 0;
      await page.click(repliee ? `#rsAjout-${id}` : seance ? `#rsZ-${id} .rs-h[data-heure] >> nth=0` : `#rsT-${id}`);
      await page.waitForSelector(`#rsL-a-${id}`, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    };
    // Retirer vit sur la page de la ligne, que sa ligne du ticket ouvre.
    const retirer = async (id) => {
      if (!(await page.locator(`#rsL-a-${id}`).count())) return false;
      await page.click(`#rsL-a-${id}`);
      await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-ligne', { timeout: 3000 });
      const bouton = page.locator(`#rvRetirer-${id}`);
      if (!(await bouton.count())) return false;
      await bouton.click();
      await page.waitForTimeout(400);
      return true;
    };

    console.log('\n[1. Le selecteur suit le CATALOGUE VIVANT]');
    // L accueil de la fenetre : un bloc de seances par activite a seances, une
    // tuile par autre activite, chacune sous son nom du catalogue (une tuile
    // garde son premier mot : « Minigolf », « Fun Run »), puis les portes.
    const accueil = await page.evaluate(() => ({
      choix: [
        ...[...document.querySelectorAll('#quickBookOverlay #rsCorps .rs-z > section.rs-seance')].map((s) => ({ id: s.parentElement.id.replace(/^rsZ-/, ''), nom: ((s.querySelector('.rs-s-n > b') || {}).textContent || '').trim() })),
        ...[...document.querySelectorAll('#quickBookOverlay #rsCorps .rs-pt[data-quoi]')].map((t) => ({ id: t.dataset.quoi, nom: ((t.querySelector('b') || {}).textContent || '').trim() })),
      ],
      portes: [...document.querySelectorAll('#quickBookOverlay #rsCorps .rs-porte')].map((p) => ({ id: p.id, nom: ((p.querySelector('b') || {}).textContent || '').trim() })),
      selecteurs: document.querySelectorAll('#quickBookOverlay .rs-petits, #quickBookOverlay .rv-ajouts, #quickBookOverlay .qb-type-tile, #quickBookOverlay .qb-visit-grid').length,
    }));
    const buttons = accueil.choix.map((c) => c.nom).filter((nom) => nom && !/Sur mesure/.test(nom));
    ok(buttons.length >= 8, `la fenetre propose ${buttons.length} activites, pas trois (${buttons.join(' | ')})`);
    for (const activite of ACTIVITIES) {
      const choix = accueil.choix.find((c) => c.id === activite.id);
      // (au comptoir, Fun Run by PIXEL s appelle Pixel)
      const nomVu = activite.id === 'fun_run' ? 'Pixel' : activite.name;
      ok(Boolean(choix && choix.nom && nomVu.startsWith(choix.nom)), `« ${nomVu} » est proposee (${choix ? choix.nom : 'absente'})`);
    }
    // Les modes : les activites a l accueil, les formules derriere leur porte, sur
    // leur propre page qui ramene aux Activités (le « sur mesure » est une porte
    // d extras, pas un mode).
    const porteFormules = accueil.portes.find((p) => p.id === 'rsFormules');
    await page.click('#rsFormules');
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-formules', { timeout: 3000 });
    const retourFormules = await page.evaluate(() => ((document.getElementById('rsRetour') || {}).textContent || '').replace(/^‹\s*/, '').trim());
    await page.click('#rsRetour');
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-activites', { timeout: 3000 });
    const modes = [porteFormules ? porteFormules.nom : '', retourFormules].filter(Boolean);
    ok(modes.includes('Formules') && modes.includes('Activités'), `les formules restent un mode a part (${modes.join(' | ')})`);
    const parActivite = ACTIVITIES.map((activite) => accueil.choix.filter((c) => c.id === activite.id).length);
    ok(accueil.selecteurs === 1 && parActivite.every((n) => n === 1), `UNE seule facon de choisir les activites (${accueil.selecteurs} selecteur(s), ${parActivite.join('/')} par activite)`);
    ok(!buttons.some((nom) => /^Formules?$/.test(nom)), 'les formules ne sont PAS melangees aux activites');
    ok(buttons.length + modes.length >= 10, `le selecteur reste vivant : ${buttons.length} activites + ${modes.length} modes`);

    console.log('\n[2. Les pistes suivent le nombre de joueurs des qu il est tape]');
    // Le bug exact de Movsar : 9 joueurs, capacite 6 par piste -> 2 pistes. Le
    // champ « Autre » pose son nombre a Entree : rien ne se lit a moitie tape.
    const before = await pistesLues(page);
    ok(before.conseille === 1 && before.choisie === 1 && before.ticketPistes === 1, `depart a 4 joueurs : 1 piste conseillee (${before.texte})`);
    await page.fill('#qbPax', '9');
    await page.press('#qbPax', 'Enter');
    await page.waitForTimeout(600);
    const after = await pistesLues(page);
    ok(after.conseille === 2 && after.choisie === 2 && after.ticketPistes === 2, `9 joueurs sur 6 par piste : 2 pistes conseillees (${after.texte})`);
    ok(!after.unePiste, 'la ligne ne dit plus « 1 piste conseillée »');

    console.log('\n[3. Une activite libre ne demande pas de piste]');
    // La tuile s ajoute au bowling ; la croix du bowling le retire, la ligne du minigolf
    // ouvre sa page.
    await ajouter('minigolf_blacklight');
    await page.click('#rsSuppr-a-bowling');
    await page.waitForFunction(() => !document.querySelector('#rsL-a-bowling'), null, { timeout: 3000 }).catch(() => {});
    await page.click('#rsL-a-minigolf_blacklight');
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv.is-q-ligne', { timeout: 3000 });
    await page.waitForTimeout(500);
    const libre = await page.evaluate(() => ({
      page: ((document.getElementById('rsCorps') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      ticket: [...document.querySelectorAll('#rsLignes .rs-tk-a')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
      cles: document.querySelectorAll('#rsCorps [data-pistes], #rsCorps [data-piste]').length,
    }));
    ok(libre.cles === 0 && !/piste|arène/i.test(libre.page) && !/piste|arène/i.test(libre.ticket), `le minigolf ne reserve aucune piste (page « ${libre.page.slice(0, 80)} », ticket « ${libre.ticket} »)`);
    // Mesure par le DOM : la ligne a l ecran est l activite choisie.
    const activeLabel = (await lignes()).join(' + ');
    ok(activeLabel === 'Minigolf Blacklight', `la ligne a l ecran est l activite choisie (${activeLabel})`);

    console.log('\n[4. Contre-epreuve : ce gate sait-il rougir ?]');
    // On remet le bowling (un toucher sur une de ses seances l ajoute, la croix du
    // minigolf le retire) et 4 joueurs : la page DOIT redire 1 piste.
    await ajouter('bowling');
    await page.click('#rsSuppr-a-minigolf_blacklight');
    await page.waitForFunction(() => !document.querySelector('#rsL-a-minigolf_blacklight'), null, { timeout: 3000 }).catch(() => {});
    await page.click('#rsHaut [data-pax="4"]');
    await page.waitForTimeout(600);
    const backTo1 = await pistesLues(page);
    ok(backTo1.conseille === 1 && backTo1.choisie === 1 && backTo1.ticketPistes === 1, `retour a 4 joueurs : la ligne redescend a 1 piste (${backTo1.texte}) -> la sonde suit vraiment l etat`);

    console.log('\n[5. Plusieurs activites, ce n est PAS « sur mesure »]');
    // Movsar, 2026-08-26 : « quand on choisis plusieurs faut pas que ca mette sur
    // mesure hein, c est juste ils ont plusieurs activites et c est normal ».
    // Depuis le 2026-10-02, « sur mesure » = des EXTRAS qu on ouvre a la main.
    // Depuis le 2026-11-03, il s ouvre par sa porte : sa page (le catalogue
    // d extras) a gauche, une ligne du ticket par article ajoute.
    const modeActif = () => page.evaluate(() => {
      const modale = document.querySelector('#quickBookOverlay .qb-modal.rv');
      if (modale && modale.classList.contains('is-q-mesure')) return 'Sur mesure';
      return document.querySelector('#quickBookOverlay #rsLignes [id^="rsL-x-"]') ? 'Sur mesure' : '';
    });
    await ajouter('laser_game');
    const multi = await page.evaluate(() => ({
      // `quickBookState` est un `let` de module : scope global lexical, PAS window.
      type: (typeof quickBookState !== 'undefined' && quickBookState) ? quickBookState.type : 'introuvable',
    }));
    multi.tuiles = await lignes();
    multi.apres = await modeActif();
    ok(multi.tuiles.length === 2, `deux activites sont retenues (${multi.tuiles.join(' + ')})`);
    ok(multi.type === 'visite', `le dossier reste une visite cote donnees (${multi.type})`);
    ok(multi.apres !== 'Sur mesure', `« Sur mesure » ne s allume PAS tout seul (mode actif : « ${multi.apres || 'aucun'} »)`);
    // CONTRE-EPREUVE : choisir VRAIMENT « Sur mesure » doit, lui, l allumer.
    await page.click('#rsMesure');
    await page.waitForTimeout(400);
    const choisi = await modeActif();
    ok(choisi === 'Sur mesure', `choisi explicitement, il s allume (${choisi || 'aucun'})`);
    await page.click('#rsRetour');
    await page.waitForTimeout(300);

    console.log('\n[6. Le prix se saisit au joueur autant qu au total]');
    // Movsar, 2026-08-26 : « il peut modifier le prix par personne et complet ».
    // Le total reste la valeur qui part au serveur ; le champ par personne est
    // une autre facon de l ecrire, pas une seconde verite.
    // Les deux champs vivent sur la page Total, que la ligne Total du ticket ouvre.
    await page.click('#rsHaut [data-pax="8"]');
    await page.waitForTimeout(500);
    await page.click('#rsL-total');
    await page.waitForSelector('#qbCustomPricePerPerson', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const prix = await page.evaluate(async () => {
      const perso = document.getElementById('qbCustomPricePerPerson');
      const total = document.getElementById('qbCustomPrice');
      if (!perso || !total) return { erreur: 'champs absents' };
      const montant = () => ((document.getElementById('rvTotalPied') || {}).textContent || '').replace(/\s/g, '');
      perso.focus(); perso.value = '15'; perso.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const apresPerso = { total: document.getElementById('qbCustomPrice').value, affiche: montant() };
      const champTotal = document.getElementById('qbCustomPrice');
      champTotal.focus(); champTotal.value = '200'; champTotal.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return { apresPerso, apresTotal: { perso: document.getElementById('qbCustomPricePerPerson').value, affiche: montant() } };
    });
    if (ok(prix && !prix.erreur, `les deux champs de prix sont presents${prix && prix.erreur ? ` (${prix.erreur})` : ''}`)) {
      ok(Number(prix.apresPerso.total) === 120, `15 EUR par personne x 8 joueurs = ${prix.apresPerso.total} EUR`);
      ok(prix.apresPerso.affiche === '120€', `le montant annonce suit (${prix.apresPerso.affiche})`);
      ok(Number(prix.apresTotal.perso) === 25, `et dans l autre sens : 200 EUR au total = ${prix.apresTotal.perso} EUR par personne`);
    }
    // Le prix du catalogue revient d un toucher (« Prix catalogue », sur la page Total).
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    if (await page.locator('#rsPrixCatalogue').count()) await page.click('#rsPrixCatalogue');
    await page.waitForTimeout(300);

    console.log('\n[7. Une activite se retire autant qu elle s ajoute]');
    // Movsar, 2026-08-26 : « faut qu on puisse decocher un par un et quand on en
    // recoche plusieurs comme on veut ». Les seances : un toucher ajoute, on retire
    // sur la page de la ligne ; la derniere ne se retire pas. On repart du bowling
    // seul.
    await retirer('laser_game');
    const depart7 = await lignes();
    ok(depart7.length === 1 && /^Bowling/.test(depart7[0]), `prerequis : le bowling seul au depart (${depart7.join(' + ')})`);
    await ajouter('laser_game');
    await ajouter('billards');
    const troisChoisies = await lignes();
    await retirer('billards');
    const apresRetrait = await lignes();
    await ajouter('billards');
    const apresRecoche = await lignes();
    await retirer('billards');
    await retirer('laser_game');
    const avantDerniere = await lignes();
    const derniereRetirable = await retirer('bowling');
    const apresTentativeDeToutRetirer = await lignes();
    ok(troisChoisies.length === 3, `trois activites retenues (${troisChoisies.join(' + ')})`);
    ok(apresRetrait.length === 2 && !apresRetrait.includes('Billards'), `« Retirer » RETIRE celle qui etait retenue (${apresRetrait.join(' + ')})`);
    ok(apresRecoche.includes('Billards'), `et la remet ensuite comme on veut (${apresRecoche.join(' + ')})`);
    ok(avantDerniere.length === 1, `on peut redescendre a une seule activite (${avantDerniere.join(' + ')})`);
    ok(!derniereRetirable && apresTentativeDeToutRetirer.length === 1, `mais jamais a zero : la derniere n a pas de « Retirer » (${apresTentativeDeToutRetirer.join(' + ') || 'aucune'})`);

    console.log('\n[8. Chaque activite se regle selon ce qu elle vend]');
    // « playground on doit mettre cbn d enfant, le fun run pixel choisir 15, 30 ».
    // La detection passe par la DONNEE du catalogue (priceType, unitLabel), pas
    // par un id : un autre centre au meme modele en herite sans une ligne.
    await page.click('#rsHaut [data-pax="8"]');
    await page.waitForTimeout(400);
    for (const id of ['playground', 'fun_run']) {
      if (!(await page.locator(`#rsL-a-${id}`).count())) await ajouter(id);
    }
    // Le Fun Run : sa page propose ses sessions.
    await page.click('#rsL-a-fun_run');
    await page.waitForTimeout(350);
    const sessions = await page.evaluate(() => {
      const rang = [...document.querySelectorAll('#rsCorps .rs-rang')].find((r) => ((r.querySelector('.rs-lbl') || {}).textContent || '').trim() === 'Session');
      return rang ? [...rang.querySelectorAll('.rs-choix button > b')].map((b) => b.textContent.trim()) : [];
    });
    // La plaine de jeux : sa page porte un compteur, son moins en retire un.
    await page.click('#rsL-a-playground');
    await page.waitForTimeout(350);
    const reglages = await page.evaluate(async () => {
      const compteur = () => [...document.querySelectorAll('#rsCorps .rs-rang')].find((r) => r.querySelector('.rs-pas'));
      const valeur = () => (compteur() ? compteur().querySelector('.rs-pas > b').textContent.trim() : '');
      const compteurAvant = valeur();
      const libelleEnfants = compteur() ? compteur().textContent.replace(/\s+/g, ' ').trim() : '';
      const joueursAvant = quickBookState.pax;
      const autres = [...document.querySelectorAll('#rsLignes .rs-tk-a[data-activite]')].map((e) => e.dataset.activite).filter((id) => id !== 'playground');
      const autresAvant = Object.fromEntries(autres.map((id) => [id, getQuickVisitParticipants(id)]));
      const moins = compteur() ? compteur().querySelector('.rs-pas > button') : null;
      if (moins) { moins.click(); await new Promise((r) => setTimeout(r, 350)); }
      return {
        compteurAvant,
        libelleEnfants, joueursAvant, joueursApres: quickBookState.pax,
        enfantsApres: getQuickVisitParticipants('playground'),
        autresInchanges: autres.length >= 2 && JSON.stringify(autresAvant) === JSON.stringify(Object.fromEntries(autres.map((id) => [id, getQuickVisitParticipants(id)]))),
        compteurApres: valeur(),
      };
    });
    reglages.sessions = sessions;
    ok(reglages.sessions.length >= 2 && /15 min/.test(reglages.sessions.join(' ')) && /30 min/.test(reglages.sessions.join(' ')),
      `le Fun Run propose ses sessions (${reglages.sessions.join(' | ') || 'aucune'})`);
    ok(/enfant/i.test(reglages.libelleEnfants), `la plaine de jeux se compte en enfants (${reglages.libelleEnfants})`);
    ok(reglages.compteurApres !== reglages.compteurAvant && reglages.enfantsApres === 7,
      `et le compteur descend vraiment (${reglages.compteurAvant} -> ${reglages.compteurApres})`);
    ok(reglages.joueursAvant === 8 && reglages.joueursApres === 8 && reglages.autresInchanges, '7 enfants sur 8 visiteurs sans changer les autres activites');

    if (process.env.QB_SHOT) {
      await page.click('#rsHaut [data-pax="9"]');
      await page.waitForTimeout(500);
      await page.screenshot({ path: process.env.QB_SHOT, fullPage: false });
    }
    ok(errs.length === 0, `zero erreur console (${errs.length}${errs.length ? ' : ' + errs[0] : ''})`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\nquickbook-catalog-check: ${failures} echec(s).`); process.exit(1); }
  console.log('\nquickbook-catalog-check: ALL OK - la reservation rapide suit le catalogue et les joueurs.');
}

main().catch((error) => { console.error(error); process.exit(1); });
