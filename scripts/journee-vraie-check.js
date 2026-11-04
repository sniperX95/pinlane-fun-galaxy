// CE QUE LA JOURNEE ET LES TARIFS AFFIRMENT EST VRAI.
//
// Movsar, 2026-09-25 : « aucune fausse info, tout doit etre vrai prouvable ».
// Mesure avant correction :
// [A] la tuile « Réservations aujourd'hui » gardait ce libelle sur n importe
//     quelle date, et l argent paye s appelait « validés ». Depuis le lot C
//     (2026-09-30) le bandeau du planning ne recopie plus l accueil : trois
//     cases qui servent a planifier, perimetre dans le libelle, aucun montant,
//     et « Libres maintenant », dont les pistes doivent etre celles que la
//     grille montre libres a la ligne « maintenant » ;
// [B] la tete du planning redisait les comptes des tuiles juste au-dessus, et
//     son titre « Planning 8 pistes » etait ecrit en dur dans la page, quelle
//     que soit la grille dessinee dessous ; puis, corrige, il restait sur la
//     valeur par defaut quand la configuration arrivait apres le premier rendu
//     (la grille, redessinee par les blocages, montrait 6 pistes). Depuis la
//     barre des plannings (2026-11-03), les horaires sont dans le menu « ⋯ » et
//     le nombre de pistes dans la bulle de l onglet : la regle ne change pas ;
// [C] la page Pistes dessinait 8 rangees pour tout centre ;
// [D] les chiffres de Tarifs & formules portaient sur « les données locales »
//     (le jour affiche et ses voisins, une fenetre que personne ne connait),
//     chaque carte sans reservation repetait « Aucune réservation liée », et
//     chaque carte peignait « Tarif du centre » en bouton principal ;
// [E] le panneau du jour des Reservations ecrivait « 0 résa · 0 joueurs » ;
// [F] Formules, vide, affichait « 0 formule sur la date · 0/0 activité faite »
//     au-dessus d un etat vide qui paraphrasait le sous-titre ;
// [G] la fenetre de 30 jours se calculait avec toISOString() : a Bruxelles,
//     minuit local est la veille en UTC, et la fenetre comptait 31 jours.
//
// Serveur : scripts/dev-console-server.js (fixtures, aucun reseau, aucune
// base). Horloge figee au 2026-09-25 15:30, fuseau Europe/Brussels. Un centre
// a SIX pistes (config servie), un historique CRM de 30 jours servi par le
// gate, et sa reponse arrive APRES le premier rendu de Tarifs.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation
// a la fois, et exige que chacune rougisse sa cible.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const dev = require('./dev-console-server.js');

const ROOT = path.join(__dirname, '..');
// 4302 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_JOURNEE_PORT || 4302);
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.JOURNEE_CASSE || '');
const JOUR = '2026-09-25';
const HEURE = `${JOUR}T15:30:00+02:00`;

const MUTATIONS = {
  // [A] Le bandeau du planning. Le calcul oublie les reservations du jour :
  // la piste 5, prise, se dit libre.
  libresfaux: ['app-main.js', '  poser(todaysReservations());\n', '', '[A] les pistes libres maintenant sont les vraies'],
  perimetre: ['app-main.js', "title: `Occupation ${ressource} sur la journée` },", "title: 'Occupation sur la journée' },", '[A] le bandeau dit son perimetre'],
  // (2026-10-27 : l occupation des pistes est lue par
  // getStaffBowlingLaneOccupation, qui porte la garde des blocages ; la garde
  // du jour meme reste ici)
  demain: ['app-main.js', '  if (state.currentDate !== todayStr()) return null;\n  const occupation = getStaffBowlingLaneOccupation();', '  const occupation = getStaffBowlingLaneOccupation();', '[A] « Libres » seulement le jour meme'],
  argent: ['app-main.js', "id: 'kpiRes', value: String(res.length), title: `${pax} joueur${pax > 1 ? 's' : ''}` },", "id: 'kpiRes', value: String(res.length), title: `${pax} joueur${pax > 1 ? 's' : ''} · ${formatMoney(99)}` },", '[A] aucun montant ni « aujourd hui » dans le bandeau'],
  soustitre: ['app-main.js', "const horaires = fenetre.closed ? 'Centre fermé ce jour-là' : `Ouvert ${fenetre.label}`;", "const horaires = `${todaysReservations().length} réservations • ${fenetre.label}`;", '[B] la tete du planning ne redit pas les tuiles'],
  titrepistes: ['app-main.js', "function pbBulleBowling() {\n  const laneCount = getAvailabilityLaneCount();", "function pbBulleBowling() {\n  const laneCount = 8;", '[B] le titre compte les pistes de la grille'],
  // La configuration arrivee ne redessine plus le planning ouvert : la tete et
  // la grille gardent les valeurs par defaut (la course du 2026-09-25).
  configrepeint: ['app-main.js', "    if (planningBox && !planningBox.classList.contains('hidden')) repaintKeepingScroll(planningBox, () => renderPlanning());\n", '', '[B] le titre compte les pistes de la grille'],
  rangees: ['app-main.js', '  const laneCount = getAvailabilityLaneCount();\n  for (let lane = 1; lane <= laneCount; lane += 1) {', '  for (let lane = 1; lane <= TOTAL_LANES; lane += 1) {', '[C] la page Pistes a autant de rangees que de pistes'],
  fenetre: ['app-main.js', 'function getPricingReservations() {\n  if (!canReadStaffReservationHistory()) return [];\n  return getStaffResourceHistoryRows();\n}', "function getPricingReservations() {\n  if (!canReadStaffReservationHistory()) return [];\n  return (state.reservations || []).filter(reservation => reservation.status !== 'cancelled');\n}", '[D] les chiffres de Tarifs portent sur 30 jours'],
  // Le repeint APRES l arrivee de l historique (le premier, au debut du
  // chargement, ne montre encore rien).
  repeint: ['app-main.js', "  else if (isStaffPricingActive() && typeof renderStaffPricingPage === 'function') renderStaffPricingPage();\n}\n\nfunction ensureStaffClientData() {", '}\n\nfunction ensureStaffClientData() {', '[D] les chiffres de Tarifs portent sur 30 jours'],
  vide: ['staff-pages-v2.js', "return n ? `${tfPluriel(n, 'réservation')} / 30 j` : '';", "return `${tfPluriel(n, 'réservation')} / 30 j`;", '[D] une ligne sans reservation reste muette'],
  primaire: ['staff-pages-v2.js', 'class="pv2-btn sm" data-add-formula=', 'class="pv2-btn primary" data-add-formula=', '[D] au repos, aucun bouton ne crie'],
  zero: ['staff-pages-v2.js', " : 'Aucune réservation'}</small>", " : `${dayAgg.count} résa · ${dayAgg.pax} joueurs`}</small>", '[E] le jour vide le dit en mots'],
  formulesvide: ['app-main.js', '    const summary = formuleRows.length ? [', '    const summary = true ? [', '[F] Formules vide sans compteur a zero'],
  appel: ['staff-pages-v2.js', "if ((typeof canReadStaffReservationHistory !== 'function' || canReadStaffReservationHistory()) && typeof ensureStaffClientData === 'function') ensureStaffClientData();", "if (typeof ensureStaffClientData === 'function') ensureStaffClientData();", '[H] sans droit sur l historique, Tarifs ne l appelle pas'],
  tuiles: ['staff-pages-v2.js', "if (typeof canReadStaffReservationHistory === 'function' && !canReadStaffReservationHistory()) return '30 derniers jours : non accessible avec votre rôle';", '', '[H] et le resume dit que l historique n est pas accessible'],
  utc: ['app-main.js', 'd.setDate(d.getDate() - 30); return toLocalDateStr(d); })();', 'd.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();', '[G] la fenetre compte 30 jours'],
};

let echecs = 0;
let reussis = 0;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}${detail ? `  ${detail}` : ''}`); return; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

const resa = (id, date, extra = {}) => ({
  id, date, startTime: '15:00', duration: 1, type: 'bowling', lanes: [1], pax: 4, price: 39, status: 'pending',
  name: `Client ${id}`, email: `${id}@exemple.be`, phone: '+32470000000', centerId: dev.CENTER_ID, validationStatus: 'confirmed', ...extra,
});
// La journee affichee : deux reservations bowling, dont une payee.
const JOURNEE = [
  resa(7301, JOUR, { startTime: '16:00', lanes: [2], status: 'paid', price: 60 }),
  resa(7302, JOUR, { startTime: '18:00', lanes: [3], pax: 6 }),
];
// Un groupe EN COURS a 15:30 (piste 5, 15:00-16:00), servi au seul scenario du
// bandeau : sans lui, « Libres maintenant » dirait « toutes » et son
// recoupement avec la grille ne prouverait rien.
const EN_COURS = resa(7303, JOUR, { startTime: '15:00', lanes: [5], status: 'arrived', pax: 2, price: 30 });
// L historique CRM : la fenetre des 30 jours revolus va du 2026-08-26 (inclus)
// au 2026-09-24 (inclus). Trois reservations y tombent ; celle du 2026-08-25
// est hors fenetre, l annulee ne compte pas, et la journee en cours (les deux
// de JOURNEE, que le serveur sert aussi quand la plage la couvre) non plus.
const HISTORIQUE = [
  resa(7311, '2026-09-24'),
  resa(7312, '2026-09-23', { type: 'formule', formuleId: 'f1', pax: 8, price: 208, status: 'paid' }),
  resa(7313, '2026-08-26', { type: 'formule', formuleId: 'f1', pax: 6, price: 156, status: 'paid' }),
  resa(7314, '2026-08-25', { type: 'formule', formuleId: 'f1', pax: 6, price: 156, status: 'paid' }),
  resa(7316, '2026-09-10', { type: 'formule', formuleId: 'f1', pax: 6, price: 156, status: 'cancelled' }),
];

function serveur() {
  const interne = dev.creerServeur(dev.creerRepondeurFixtures({ origine: BASE }));
  const servir = interne.listeners('request')[0];
  return http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const mutation = CASSE ? MUTATIONS[CASSE] : null;
    if (CASSE && !mutation) { console.error(`journee-vraie-check: contre-preuve inconnue ${CASSE}`); process.exit(2); }
    if (mutation && url.pathname === `/assets/${mutation[0]}`) {
      const src = fs.readFileSync(path.join(ROOT, 'assets', mutation[0]), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(mutation[1]).length !== 2) { console.error(`journee-vraie-check: la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(mutation[1], mutation[2]));
      return;
    }
    servir(req, res);
  });
}

async function ouvrir(browser, route, { permissions = null, journee = JOURNEE } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Brussels' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  await page.clock.install({ time: new Date(HEURE) });
  await page.addInitScript((jour) => {
    try { localStorage.setItem('funGalaxy_v4', JSON.stringify({ view: 'staff', staffMenuPage: 'dashboard', currentDate: jour, staffTheme: 'light' })); } catch (e) { /* stockage indisponible */ }
  }, JOUR);
  await page.route('**/api/staff-state**', (r) => {
    const date = new URL(r.request().url()).searchParams.get('date') || JOUR;
    const reservations = date === JOUR ? journee : [];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, revision: `journee-${date}`, reservations: reservations.map((x) => ({ ...x })), laneStatuses: { 1: 'active', 2: 'active', 3: 'active', 4: 'active', 5: 'active', 6: 'active' }, centerId: dev.CENTER_ID }) });
  });
  // Un role restreint : la session servie ne porte que ces droits.
  if (permissions) {
    await page.route('**/api/staff-auth**', async (r) => {
      const reponse = await r.fetch();
      const corps = await reponse.json();
      if (corps && corps.session) corps.session = { ...corps.session, role: { id: 'essai', name: 'Essai', locked: false }, permissions };
      r.fulfill({ response: reponse, json: corps });
    });
  }
  // L historique arrive APRES le premier rendu : la page doit se repeindre.
  // Comme le vrai serveur, il porte aussi la journee en cours quand la plage
  // demandee la couvre : la page Reservations lit le mois ENTIER et, une fois
  // la plage chargee, ce que le serveur ne renvoie pas n existe plus. Sans ca,
  // le jour passait de « 2 réservations » a « Aucune réservation » 400 ms apres
  // l ouverture, et [E] ne gagnait que la course.
  const appelsHistorique = [];
  await page.route('**/api/admin-range**', async (r) => {
    appelsHistorique.push(r.request().url());
    const q = new URL(r.request().url()).searchParams;
    const couvreLeJour = (q.get('startDate') || '') <= JOUR && JOUR <= (q.get('endDate') || '');
    await new Promise((resolve) => setTimeout(resolve, 400));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, reservations: [...HISTORIQUE, ...(couvreLeJour ? journee : [])].map((x) => ({ ...x })), centerId: dev.CENTER_ID }) });
  });
  await page.route('**/api/ops**', async (r) => {
    const url = new URL(r.request().url());
    // Le serveur de dev ne sert AUCUNE formule : le catalogue du gate en porte
    // trois, dont FORMULE 1, celle de l historique.
    if (url.searchParams.get('action') === 'clientCatalog') {
      const formule = (id, name, bookingFamily, priceValue) => ({
        id, name, family: bookingFamily, bookingFamily, minPax: 4, priceType: 'per_pax', source: 'seed', active: true,
        validDays: null, timeLimitMinMinutes: null, timeLimitMaxMinutes: null, desc: [], notes: [],
        base: { priceValue, priceOld: null },
        effective: { name, priceValue, priceOld: null, enabled: true, removed: false },
        centerOverride: null, steps: [],
      });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, centerId: dev.CENTER_ID, activities: [], centerActivityIds: [], formulas: [
        formule('f1', 'FORMULE 1', 'Formules anniversaires', 26),
        formule('f2', 'FORMULE 2', 'Formules anniversaires', 29),
        formule('s1', 'Matin Malin', 'Formules speciales', 15),
      ] }) });
    }
    if (url.searchParams.get('action') !== 'centerConfig') return r.continue();
    // La configuration arrive APRES le premier rendu du planning : c est
    // l ordre qui a rougi la suite complete le 2026-09-25 (titre « Planning 8
    // pistes » au-dessus d une grille de 6). Servie tout de suite, [B] ne
    // gagnait que la course.
    await new Promise((resolve) => setTimeout(resolve, 700));
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, activities: [], centers: [{ id: dev.CENTER_ID, name: 'Centre du gate', status: 'active', timezone: 'Europe/Brussels', resources: { bowling: { laneCount: 6, normalCapacityPerLane: 6 }, laser: { weaponCount: 30, parallelLaunches: 1 } } }] }),
    });
  });
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state && state.view === 'staff', null, { timeout: 15000 });
  return { ctx, page, erreurs, appelsHistorique };
}

const attendre = (page, fn, arg, ms = 5000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);

async function run() {
  const srv = serveur();
  await new Promise((resolve) => srv.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    // =====================================================================
    console.log('[A][B] LE PLANNING');
    // =====================================================================
    const p = await ouvrir(browser, '#/staff/planning', { journee: [...JOURNEE, EN_COURS] });
    await attendre(p.page, () => document.querySelectorAll('#planningBande .pb-k').length === 3, null, 8000);
    await attendre(p.page, () => document.getElementById('staffTabBowling').title === 'Planning Bowling, 6 pistes', null, 6000);
    const lireBandeau = () => p.page.evaluate(() => {
      const cases = [...document.querySelectorAll('#planningBande .pb-k')];
      return {
        cases: cases.map((k) => ({
          label: ((k.querySelector('.gf-c__l') || {}).textContent || '').trim(),
          value: ((k.querySelector('.gf-c__v') || {}).textContent || '').trim(),
          hint: ((k.querySelector('.gf-e__s') || {}).textContent || '').trim(),
          title: k.getAttribute('title') || '',
        })),
        // (ce que la case dit a l ecran et dans sa bulle)
        texte: cases.map((k) => `${k.textContent} ${k.getAttribute('title') || ''}`).join(' ').replace(/\s+/g, ' ').trim(),
      };
    });
    const libelles = (b) => b.cases.map((k) => k.label).join(' | ');
    const bandeau = await lireBandeau();
    const cas = (label) => bandeau.cases.find((k) => k.label === label) || {};
    // LA GRILLE, LUE A LA HAUTEUR DE LA LIGNE « MAINTENANT » : une piste est
    // prise si une carte, un horaire retenu en ligne ou un blocage la couvre,
    // ou si elle est en maintenance. C est l oracle de « Libres maintenant » :
    // ce que le gerant voit sous la case, pas le calcul qui la remplit.
    const libresDeLaGrille = await p.page.evaluate(() => {
      const ligne = document.querySelector('#planningGridWrap .current-line');
      const colonnes = [...document.querySelectorAll('#planningGridWrap .lane-col[data-lane]')];
      if (!ligne || !colonnes.length) return null;
      const r = ligne.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const prise = (col) => col.classList.contains('maint')
        || [...col.querySelectorAll('.booking, .planning-hold, .planning-blocked')].some((b) => { const x = b.getBoundingClientRect(); return x.top <= y && x.bottom > y; });
      return colonnes.filter((col) => !prise(col)).map((col) => Number(col.getAttribute('data-lane')));
    });
    const libresDeLaCase = ((cas('Libres').title || '').match(/Piste \d+ libre/g) || []).map((x) => Number(x.match(/\d+/)[0]));
    ok(libelles(bandeau) === 'Occupation | Réservations | Libres' && cas('Occupation').title === 'Occupation des pistes sur la journée', '[A] le bandeau dit son perimetre et ne garde que ce qui sert a planifier', `${libelles(bandeau)} · ${cas('Occupation').title}`);
    ok(bandeau.texte !== '' && !/€|\bEUR\b/.test(bandeau.texte) && !/aujourd/i.test(bandeau.texte), '[A] aucun montant ni « aujourd hui » dans le bandeau', `« ${bandeau.texte} »`);
    ok(cas('Réservations').value === '3' && cas('Réservations').title === '12 joueurs', '[A] les reservations du bowling et leurs joueurs', `${cas('Réservations').value} · ${cas('Réservations').title}`);
    ok(cas('Libres').value === '5 pistes' && cas('Libres').hint === '1, 2, 3, 4 et 6' && /Piste 2 libre jusqu’à 16:00/.test(cas('Libres').title), '[A] les pistes libres maintenant sont les vraies', `${cas('Libres').value} · ${cas('Libresintenant').hint}`);
    ok(Array.isArray(libresDeLaGrille) && libresDeLaGrille.join(',') === '1,2,3,4,6' && libresDeLaCase.join(',') === libresDeLaGrille.join(','), '[A] la case dit les pistes que la grille montre libres', `grille ${libresDeLaGrille ? libresDeLaGrille.join(',') : 'illisible'} · case ${libresDeLaCase.join(',')}`);
    const jour = await p.page.evaluate(() => {
      document.getElementById('planningPlus').click();
      const sub = (document.querySelector('.staff-action-popover [data-pb-horaires]') || {}).textContent || '';
      closeStaffFloatingMenus();
      return {
        sub,
        titre: document.getElementById('staffTabBowling').title,
        pistes: new Set([...document.querySelectorAll('[data-bowling-drop-lane]')].map((c) => c.getAttribute('data-bowling-drop-lane'))).size,
      };
    });
    ok(/^Ouvert \S/.test(jour.sub) && !/réservation|joueur/.test(jour.sub), '[B] la tete du planning ne redit pas les tuiles', `« ${jour.sub} »`);
    ok(jour.titre === 'Planning Bowling, 6 pistes' && jour.pistes === 6, '[B] le titre compte les pistes de la grille', `« ${jour.titre} » · grille ${jour.pistes} piste(s)`);
    // Isoler l'arrivée de configuration APRÈS le montage : attendre plusieurs
    // secondes pouvait laisser le poll, les blocages ou le bootstrap réparer
    // le mutant qui retirait le repaint immédiat. Réponse synthétique en
    // microtask, aucun délai ni autre requête entre sa livraison et la mesure.
    await attendre(p.page, () => staffCenterConfigCache.loaded && !staffCenterConfigCache.loading && availabilityBlocksCache.loaded && staffConsolesReady);
    const configImmediate = await p.page.evaluate(async () => {
      const center = staffCenterConfigCache.centers.find(c => c.id === getCurrentStaffCenterId());
      const ancienne = { ...center, resources: { ...center.resources, bowling: { ...center.resources.bowling, laneCount: 8 } } };
      const lire = () => ({ titre: document.getElementById('staffTabBowling').title, pistes: new Set([...document.querySelectorAll('[data-bowling-drop-lane]')].map(c => c.getAttribute('data-bowling-drop-lane'))).size });
      setCenterScheduleConfig(ancienne);
      staffCenterConfigCache.centers = staffCenterConfigCache.centers.map(c => c.id === center.id ? ancienne : c);
      renderPlanning();
      const avant = lire(), trace = [];
      const fetchOrigine = window.fetch, renderOrigine = window.renderPlanning;
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (url.pathname === '/api/ops' && url.searchParams.get('action') === 'centerConfig') {
          trace.push({ evenement: 'réponse configuration', pistes: 6 });
          return Promise.resolve(new Response(JSON.stringify({ok:true, activities:[], centers:[center]}), {status:200,headers:{'content-type':'application/json'}}));
        }
        return fetchOrigine(input, init);
      };
      window.renderPlanning = function () { trace.push({ evenement: 'renderPlanning', appel: new Error().stack }); return renderOrigine.apply(this, arguments); };
      try {
        await loadStaffCenterConfig(true);
        return { avant, apres: lire(), trace };
      } finally {
        window.fetch = fetchOrigine;
        window.renderPlanning = renderOrigine;
      }
    });
    ok(configImmediate.avant.titre === 'Planning Bowling, 8 pistes' && configImmediate.avant.pistes === 8,
      'MONTAGE [B] la scène stable commence avec huit pistes', JSON.stringify(configImmediate.avant));
    ok(configImmediate.apres.titre === 'Planning Bowling, 6 pistes' && configImmediate.apres.pistes === 6
      && configImmediate.trace.some(e => e.evenement === 'renderPlanning' && /loadStaffCenterConfig/.test(e.appel)),
      '[B] le titre compte les pistes de la grille dès la réponse configuration', JSON.stringify(configImmediate));
    // L onglet laser dit le sien : l arene, ses reservations, pas de pistes.
    await p.page.evaluate(() => setStaffResourceView('laser'));
    await attendre(p.page, () => /arène/.test((document.querySelector('#planningBande .pb-k') || { getAttribute: () => '' }).getAttribute('title') || ''));
    const laser = await lireBandeau();
    ok(/^Occupation \| Réservations\b/.test(libelles(laser)) && laser.cases[0].title === 'Occupation de l’arène sur la journée', '[A] le bandeau dit son perimetre, onglet laser compris', `${libelles(laser)} · ${laser.cases[0].title}`);
    await p.page.evaluate(() => setStaffResourceView('bowling'));
    await p.page.evaluate(() => shiftDate(1));
    await attendre(p.page, () => document.querySelectorAll('#planningBande .pb-k').length === 2);
    const demain = await lireBandeau();
    ok(libelles(demain) === 'Occupation | Réservations', '[A] « Libres » seulement le jour meme', `le lendemain : ${libelles(demain)}`);
    ok(p.erreurs.length === 0, '[A][B] aucune erreur JavaScript', p.erreurs.slice(0, 3).join(' | '));
    await p.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[C] LA PAGE PISTES');
    // =====================================================================
    const l = await ouvrir(browser, '#/staff/lanes');
    await attendre(l.page, () => document.querySelectorAll('#staffUtilityPage .lane-row[data-lane]').length === 6, null, 6000);
    const rangees = await l.page.evaluate(() => [...document.querySelectorAll('#staffUtilityPage .lane-row[data-lane]')].map((x) => x.getAttribute('data-lane')));
    ok(rangees.length === 6 && rangees.join(',') === '1,2,3,4,5,6', '[C] la page Pistes a autant de rangees que de pistes', rangees.join(','));
    await l.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[D] TARIFS & FORMULES : 30 JOURS');
    // =====================================================================
    const t = await ouvrir(browser, '#/staff/prices');
    await attendre(t.page, () => document.querySelector('#staffPricingPage [data-tf-resume]'), null, 8000);
    // La fenetre arrive apres le premier rendu : on attend sa trace.
    const arrive = await attendre(t.page, () => /\b3 réservations\b/.test((document.querySelector('#staffPricingPage [data-tf-resume]') || {}).textContent || ''), null, 6000);
    const tarifs = await t.page.evaluate(() => {
      const root = document.getElementById('staffPricingPage');
      const lignes = [...root.querySelectorAll('[data-tf-ligne]')];
      const f1 = lignes.find((l) => l.getAttribute('data-tf-ligne') === 'f1');
      return {
        crumb: ((root.querySelector('.pv2-bar-crumb') || {}).textContent || '').trim(),
        titre: ((root.querySelector('.pv2-bar h1') || {}).textContent || '').trim(),
        resume: ((root.querySelector('[data-tf-resume]') || {}).textContent || '').replace(/[\s\u00a0\u202f]+/g, ' ').trim(),
        lignes: lignes.length,
        avecUsage: lignes.filter((l) => l.querySelector('.tf-usage')).length,
        f1: f1 ? ((f1.querySelector('.tf-usage') || {}).textContent || '').trim() : '',
        muettes: lignes.filter((l) => /\b0 réservation/.test(l.textContent)).length,
        principaux: root.querySelectorAll('.pv2-btn.primary').length,
        prixCliquables: root.querySelectorAll('[data-tf-prix]').length,
      };
    });
    ok(arrive && /^30 derniers jours : 3 réservations/.test(tarifs.resume), '[D] les chiffres de Tarifs portent sur 30 jours', tarifs.resume);
    ok(/· 403 ?€ réservés/.test(tarifs.resume), '[D] le chiffre additionne la fenetre, rien d autre', tarifs.resume);
    ok(/la plus demandée : FORMULE 1/i.test(tarifs.resume), '[D] « Plus demandé » designe l offre la plus demandee', tarifs.resume);
    ok(/^2 réservations \/ 30 j$/.test(tarifs.f1), '[D] la ligne de l offre dit ses chiffres', `« ${tarifs.f1} »`);
    ok(tarifs.lignes > 1 && tarifs.avecUsage === 1 && tarifs.muettes === 0, '[D] une ligne sans reservation reste muette', `${tarifs.avecUsage} ligne(s) chiffree(s) sur ${tarifs.lignes}, ${tarifs.muettes} « 0 réservation »`);
    ok(tarifs.principaux === 0 && tarifs.prixCliquables > 0, '[D] au repos, aucun bouton ne crie', `${tarifs.principaux} bouton(s) principal(aux), ${tarifs.prixCliquables} prix cliquable(s)`);
    ok(tarifs.crumb === 'Activités & tarifs' && tarifs.titre === 'Tarifs & formules', '[D] le surtitre est le groupe du menu, le titre la page', `${tarifs.crumb} / ${tarifs.titre}`);
    // [G] la fenetre elle-meme, a Bruxelles
    const fenetre = await t.page.evaluate(() => getStaffResourceHistoryRows().map((r) => r.date).sort());
    ok(fenetre.join(',') === '2026-08-26,2026-09-23,2026-09-24', '[G] la fenetre compte 30 jours', fenetre.join(','));
    ok(t.erreurs.length === 0, '[D] aucune erreur JavaScript', t.erreurs.slice(0, 3).join(' | '));
    await t.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[E] RESERVATIONS : LE PANNEAU DU JOUR');
    // =====================================================================
    const r = await ouvrir(browser, '#/staff/reservations');
    await attendre(r.page, () => document.querySelector('#staffReservationsPage .pv2-day-head small'), null, 8000);
    await attendre(r.page, () => /réservations/.test((document.querySelector('#staffReservationsPage .pv2-day-head small') || {}).textContent || ''));
    const aujourd = await r.page.evaluate(() => ({
      jour: ((document.querySelector('#staffReservationsPage .pv2-day-head small') || {}).textContent || '').replace(/\u202f/g, ' ').trim(),
      crumb: ((document.querySelector('#staffReservationsPage .pv2-bar-crumb') || {}).textContent || '').trim(),
      titre: ((document.querySelector('#staffReservationsPage .pv2-bar h1') || {}).textContent || '').trim(),
      titreVisible: (() => { const el = document.querySelector('#staffReservationsPage .pv2-bar h1'); if (!el) return false; const rect = el.getBoundingClientRect(), style = getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility === 'visible'; })(),
      menuActif: Boolean(document.querySelector('[data-staff-menu-root] .fgx-menu-nav [data-fgx-menu-key="reservations"].active')),
    }));
    await r.page.evaluate(() => { const b = document.querySelector('#staffReservationsPage [data-cal-date="2026-09-28"]'); if (b) b.click(); });
    await attendre(r.page, () => /Aucune réservation|résa/.test((document.querySelector('#staffReservationsPage .pv2-day-head small') || {}).textContent || ''));
    const vide = await r.page.evaluate(() => ((document.querySelector('#staffReservationsPage .pv2-day-head small') || {}).textContent || '').trim());
    ok(/^2 réservations · 10 joueurs · 99 €$/.test(aujourd.jour), '[E] le jour rempli, pluriels justes', `« ${aujourd.jour} »`);
    ok(vide === 'Aucune réservation', '[E] le jour vide le dit en mots', `« ${vide} »`);
    // Le titre porte seul l'identite dans la nouvelle direction du SaaS : le
    // surtitre redondant Journee est retire, le vrai menu reste synchronise.
    ok(aujourd.titre === 'Réservations' && aujourd.titreVisible && aujourd.menuActif,
      '[E] le titre Reservations est visible et le menu de la page est actif', JSON.stringify(aujourd));
    await r.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] FORMULES, SANS FORMULE');
    // =====================================================================
    const f = await ouvrir(browser, '#/staff/formules');
    await attendre(f.page, () => document.querySelector('#staffUtilityPage .events-empty-state'), null, 8000);
    const formules = await f.page.evaluate(() => {
      const root = document.getElementById('staffUtilityPage');
      const vide = root.querySelector('.events-empty-state');
      return {
        compteur: /(^|[^\d])0 formule|0\/0 activité|(^|[^\d])0 joueur/.test(root.textContent),
        vide: vide ? vide.textContent.replace(/\s+/g, ' ').trim() : '',
      };
    });
    ok(!formules.compteur && formules.vide === 'Aucune formule sur cette date.', '[F] Formules vide sans compteur a zero', `compteur ${formules.compteur} · « ${formules.vide} »`);
    await f.ctx.close();

    // =====================================================================
    console.log('');
    console.log('[H] TARIFS POUR UN ROLE SANS L HISTORIQUE');
    // =====================================================================
    // Le serveur reserve /api/admin-range a direction.view, reservations.view
    // ou clients.view. Un role qui n a que pricing.manage ne l appelle pas, et
    // la page ne pretend pas « 0 réservation ».
    const h = await ouvrir(browser, '#/staff/prices', { permissions: ['dashboard.view', 'pricing.manage'] });
    await attendre(h.page, () => document.querySelector('#staffPricingPage [data-tf-resume]'), null, 8000);
    await h.page.waitForTimeout(1200);
    const restreint = await h.page.evaluate(() => {
      const root = document.getElementById('staffPricingPage');
      return {
        droits: typeof canReadStaffReservationHistory === 'function' ? canReadStaffReservationHistory() : 'absent',
        resume: ((root.querySelector('[data-tf-resume]') || {}).textContent || '').trim(),
        chiffrees: root.querySelectorAll('.tf-usage').length,
      };
    });
    ok(restreint.droits === false, 'MONTAGE [H] la session servie n a pas le droit de lire l historique', String(restreint.droits));
    ok(h.appelsHistorique.length === 0, '[H] sans droit sur l historique, Tarifs ne l appelle pas', `${h.appelsHistorique.length} appel(s)`);
    // LA REGLE : aucun chiffre (un « 0 » serait un fait faux), la raison est
    // dite, aucune ligne d offre ne porte de chiffres.
    ok(/non accessible/i.test(restreint.resume) && !/\d+\s*réservation/.test(restreint.resume) && restreint.chiffrees === 0, '[H] et le resume dit que l historique n est pas accessible', `« ${restreint.resume} » · ${restreint.chiffrees} ligne(s) chiffree(s)`);
    ok(h.erreurs.length === 0, '[H] aucune erreur JavaScript', h.erreurs.slice(0, 3).join(' | '));
    await h.ctx.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
}

function contrePreuves() {
  const noms = Object.keys(MUTATIONS);
  let mordent = 0;
  for (const nom of noms) {
    const cible = MUTATIONS[nom][3];
    const res = spawnSync(process.execPath, [__filename], { env: { ...process.env, JOURNEE_CASSE: nom }, encoding: 'utf8', timeout: 240000 });
    const sortie = `${res.stdout || ''}${res.stderr || ''}`;
    const rougit = sortie.split('\n').some((ligne) => ligne.startsWith('FAIL') && ligne.includes(cible));
    if (res.status === 2) console.log(`FAIL  contre-epreuve DESARMEE : ${nom} (ancre introuvable)`);
    else if (rougit) { mordent += 1; console.log(`ok    contre-preuve ${nom} : « ${cible} » rougit`); }
    else console.log(`FAIL  contre-preuve ${nom} : « ${cible} » reste vert`);
  }
  console.log(`\njournee-vraie-check --contre-preuves: ${mordent}/${noms.length} mordent`);
  process.exit(mordent === noms.length ? 0 : 1);
}

if (process.argv.includes('--contre-preuves')) contrePreuves();
else {
  run().then(() => {
    console.log(`\njournee-vraie-check: ${echecs ? `${echecs} echec(s)` : 'ALL OK'} (${reussis} ok)`);
    process.exit(echecs ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
