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

// v5 (2026-10-08) : ce que le nombre de joueurs change s ecrit a cote du
// nombre (#rvConsequence) : « 2 pistes conseillées », « Sans piste ni arène ».
function statusText(page) {
  return page.evaluate(() => (document.getElementById('rvConsequence') || {}).textContent || '');
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
    await page.waitForSelector('#quickBookOverlay .qb-modal.rv [data-rv-ligne]', { timeout: 8000 });
    await page.waitForTimeout(700);
    // Les noms a l ecran : les lignes posees, et les pastilles de « + Activité ».
    const lignes = () => page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay .rv-lignes > [data-rv-ligne]:not(.is-retiree) .rv-nom > span')].map((e) => e.textContent.trim()));
    const ouvrirAjouts = () => page.evaluate(() => { if (!quickBookState.ajoutsOuverts) document.getElementById('rvPlusActivite').click(); });
    const ajouter = async (id) => { await ouvrirAjouts(); await page.waitForTimeout(250); await page.click(`[data-rv-ajout="${id}"]`); await page.waitForTimeout(400); };
    // Retirer vit dans le detail de la ligne (le chevron l ouvre).
    const retirer = (id) => page.evaluate(async (id) => {
      const ligne = document.querySelector(`[data-rv-ligne="${id}"]`);
      if (!ligne) return false;
      if (!document.getElementById(`rvRetirer-${id}`)) { const ouvrir = ligne.querySelector('.rv-ouvrir'); if (ouvrir) ouvrir.click(); await new Promise((r) => setTimeout(r, 300)); }
      const bouton = document.getElementById(`rvRetirer-${id}`);
      if (!bouton) return false;
      bouton.click();
      await new Promise((r) => setTimeout(r, 400));
      return true;
    }, id);

    console.log('\n[1. Le selecteur suit le CATALOGUE VIVANT]');
    await ouvrirAjouts();
    await page.waitForTimeout(300);
    const buttons = await page.evaluate(() => [
      ...[...document.querySelectorAll('#quickBookOverlay .rv-lignes > [data-rv-ligne] .rv-nom > span')].map((e) => e.textContent.trim()),
      ...[...document.querySelectorAll('#quickBookOverlay [data-rv-ajout]')].map((b) => b.textContent.trim()),
    ].filter((nom) => nom && !/Sur mesure/.test(nom)));
    ok(buttons.length >= 8, `la fenetre propose ${buttons.length} activites, pas trois (${buttons.join(' | ')})`);
    for (const expected of ['Bowling', 'Laser Game', 'Minigolf Blacklight', 'Billards', 'Arcades', 'Playground', 'Duckpin Bowling', 'Fun Run by PIXEL']) {
      ok(buttons.includes(expected), `« ${expected} » est proposee`);
    }
    // Les modes : deux onglets, Activites et Formule (le « sur mesure » est
    // devenu des extras, plus un mode).
    const modes = await page.evaluate(() => [...document.querySelectorAll('#quickBookOverlay .rv-plan-tete [role="tab"]')].map((b) => b.textContent.trim()));
    ok(modes.includes('Formule') && modes.includes('Activités'), `les formules restent un mode a part (${modes.join(' | ')})`);
    const doublons = await page.evaluate(() => document.querySelectorAll('#quickBookOverlay .rv-ajouts, #quickBookOverlay .qb-type-tile, #quickBookOverlay .qb-visit-grid').length);
    ok(doublons === 1, `UNE seule facon de choisir les activites (${doublons} selecteur(s))`);
    ok(!buttons.includes('Formule'), 'les formules ne sont PAS melangees aux activites');
    ok(buttons.length + modes.length >= 10, `le selecteur reste vivant : ${buttons.length} activites + ${modes.length} modes`);
    await page.evaluate(() => { if (quickBookState.ajoutsOuverts) rvBasculerAjouts(); });

    console.log('\n[2. Les pistes suivent le nombre de joueurs PENDANT la frappe]');
    // Le bug exact de Movsar : 9 joueurs, capacite 6 par piste -> 2 pistes.
    const before = await statusText(page);
    ok(/1\s*piste conseillée/.test(before), `depart a 4 joueurs : 1 piste conseillee (${before.trim()})`);
    await page.fill('#qbPax', '9');
    await page.waitForTimeout(600);
    const after = await statusText(page);
    ok(/2\s*pistes conseillées/.test(after), `9 joueurs sur 6 par piste : 2 pistes conseillees (${after.trim()})`);
    ok(!/1\s*piste conseillée/.test(after), 'la ligne ne dit plus « 1 piste conseillée »');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    console.log('\n[3. Une activite libre ne demande pas de piste]');
    await page.evaluate(() => window.setQuickType('activity', 'minigolf_blacklight'));
    await page.waitForTimeout(700);
    const freeText = await statusText(page);
    ok(!/pistes? conseillées?|au bowling/.test(freeText) && /Sans piste/.test(freeText), `le minigolf ne reserve aucune piste (${freeText.trim()})`);
    // Mesure par le DOM : la ligne a l ecran est l activite choisie.
    const activeLabel = (await lignes()).join(' + ');
    ok(activeLabel === 'Minigolf Blacklight', `la ligne a l ecran est l activite choisie (${activeLabel})`);

    console.log('\n[4. Contre-epreuve : ce gate sait-il rougir ?]');
    // On remet le bowling et 4 joueurs : la ligne DOIT redire 1 piste.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
    await page.fill('#qbPax', '4');
    await page.waitForTimeout(600);
    const backTo1 = await statusText(page);
    ok(/1\s*piste conseillée/.test(backTo1), `retour a 4 joueurs : la ligne redescend a 1 piste (${backTo1.trim()}) -> la sonde suit vraiment l etat`);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    console.log('\n[5. Plusieurs activites, ce n est PAS « sur mesure »]');
    // Movsar, 2026-08-26 : « quand on choisis plusieurs faut pas que ca mette sur
    // mesure hein, c est juste ils ont plusieurs activites et c est normal ».
    // Depuis le 2026-10-02, « sur mesure » = des EXTRAS qu on ouvre a la main.
    const modeActif = () => page.evaluate(() => (document.querySelector('#quickBookOverlay [data-rv-ligne="sur-mesure"]') && quickBookState.surMesure ? 'Sur mesure' : ''));
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
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
    await ouvrirAjouts();
    await page.waitForTimeout(250);
    await page.click('#rvSurMesure');
    await page.waitForTimeout(400);
    const choisi = await modeActif();
    ok(choisi === 'Sur mesure', `choisi explicitement, il s allume (${choisi || 'aucun'})`);
    await page.evaluate(() => window.setQuickSurMesure(false));

    console.log('\n[6. Le prix se saisit au joueur autant qu au total]');
    // Movsar, 2026-08-26 : « il peut modifier le prix par personne et complet ».
    // Le total reste la valeur qui part au serveur ; le champ par personne est
    // une autre facon de l ecrire, pas une seconde verite.
    await page.fill('#qbPax', '8');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(300);
    await page.click('#rvRevoir');
    await page.waitForTimeout(400);
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
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); if (typeof clearQuickCustomPrice === 'function') clearQuickCustomPrice(); });

    console.log('\n[7. Une activite se retire autant qu elle s ajoute]');
    // Movsar, 2026-08-26 : « faut qu on puisse decocher un par un et quand on en
    // recoche plusieurs comme on veut ». v5 : on ajoute au « + Activité », on
    // retire dans le detail de la ligne ; la derniere ne se retire pas.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
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
    await page.fill('#qbPax', '8');
    await page.waitForTimeout(400);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (const id of ['playground', 'fun_run']) {
      const deja = await page.evaluate((id) => Boolean(document.querySelector(`[data-rv-ligne="${id}"]`)), id);
      if (!deja) await ajouter(id);
    }
    const reglages = await page.evaluate(async () => {
      const ligne = (id) => document.querySelector(`[data-rv-ligne="${id}"]`);
      const fun = ligne('fun_run');
      if (fun && !fun.classList.contains('is-ouverte')) { fun.querySelector('.rv-ouvrir').click(); await new Promise((r) => setTimeout(r, 350)); }
      const play = () => ligne('playground');
      const compteur = (l) => (l && l.querySelector('.rv-lc-h .rv-qte') ? l.querySelector('.rv-lc-h .rv-qte') : null);
      const compteurAvant = compteur(play()) ? compteur(play()).querySelector('b').textContent.trim() : '';
      const libelleEnfants = compteur(play()) ? compteur(play()).textContent.replace(/\s+/g, ' ').trim() : '';
      const joueursAvant = quickBookState.pax;
      const autresAvant = Object.fromEntries(Object.keys(ensureQuickVisit().options).filter((id) => id !== 'playground').map((id) => [id, getQuickVisitParticipants(id)]));
      const moins = compteur(play()) ? compteur(play()).querySelector('button') : null;
      if (moins) { moins.click(); await new Promise((r) => setTimeout(r, 350)); }
      const funApres = ligne('fun_run');
      return {
        sessions: funApres ? [...funApres.querySelectorAll('.rv-seg[aria-label="Session"] button')].map((b) => b.textContent.trim()) : [],
        compteurAvant,
        libelleEnfants, joueursAvant, joueursApres: quickBookState.pax,
        enfantsApres: getQuickVisitParticipants('playground'),
        autresInchanges: JSON.stringify(autresAvant) === JSON.stringify(Object.fromEntries(Object.keys(autresAvant).map((id) => [id, getQuickVisitParticipants(id)]))),
        compteurApres: compteur(play()) ? compteur(play()).querySelector('b').textContent.trim() : '',
      };
    });
    ok(reglages.sessions.length >= 2 && /15 min/.test(reglages.sessions.join(' ')) && /30 min/.test(reglages.sessions.join(' ')),
      `le Fun Run propose ses sessions (${reglages.sessions.join(' | ') || 'aucune'})`);
    ok(/enfant/i.test(reglages.libelleEnfants), `la plaine de jeux se compte en enfants (${reglages.libelleEnfants})`);
    ok(reglages.compteurApres !== reglages.compteurAvant && reglages.enfantsApres === 7,
      `et le compteur descend vraiment (${reglages.compteurAvant} -> ${reglages.compteurApres})`);
    ok(reglages.joueursAvant === 8 && reglages.joueursApres === 8 && reglages.autresInchanges, '7 enfants sur 8 visiteurs sans changer les autres activites');

    if (process.env.QB_SHOT) {
      await page.evaluate(() => { const i = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop(); i.value = '9'; i.dispatchEvent(new Event('input', { bubbles: true })); });
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
