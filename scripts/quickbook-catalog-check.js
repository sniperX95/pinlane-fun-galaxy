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
        window.__QA_POSTS__.push(JSON.parse(init.body || '{}'));
        return J({ ok: true, reservation: { id: 4242, date: today, startTime: '14:00', pax: 4, status: 'pending', type: 'visite', lanes: [] } });
      }
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

function statusText(page) {
  return page.evaluate(() => (document.querySelector('.qb-status-line') || {}).textContent || '');
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
    await page.evaluate(() => window.openQuickBook());
    await page.waitForSelector('.qb-type-row .qb-liste', { timeout: 8000 });
    await page.waitForTimeout(700);

    console.log('\n[1. Le selecteur suit le CATALOGUE VIVANT]');
    // LA LISTE (2026-10-02, Movsar : « deux moyens de cocher, garde celle du bas,
    // une par une ») : les activites se lisent sur ses lignes.
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.qb-type-row .qb-liste .qb-visit-toggle')].map((b) => b.textContent.trim()));
    // Le seuil porte sur les ACTIVITES du catalogue. Il valait 9 quand
    // « Formule » etait melangee a la liste ; depuis le 2026-08-26 les modes
    // sont comptes a part (assertion juste en dessous), donc 8 activites +
    // 2 modes = 10 choix au total, contre 3 boutons codes en dur a l origine.
    ok(buttons.length >= 8, `le selecteur propose ${buttons.length} activites, pas trois (${buttons.join(' | ')})`);
    for (const expected of ['Bowling', 'Laser Game', 'Minigolf Blacklight', 'Billards', 'Arcades', 'Playground', 'Duckpin Bowling', 'Fun Run by PIXEL']) {
      ok(buttons.includes(expected), `« ${expected} » est proposee`);
    }
    // « Un mode a part » se VERIFIE desormais, au lieu de se deduire de la
    // presence d un bouton dans la meme liste : depuis le 2026-08-26 les modes
    // (Formule, Sur mesure) vivent dans leur propre rangee, sous « ou
    // composer », parce que ce ne sont pas des activites a cocher.
    // Les modes : deux onglets, Activites et Formule (le « sur mesure » est
    // devenu des extras, plus un mode).
    const modes = await page.evaluate(() => [...document.querySelectorAll('.qb-type-row .qb-mode-tab')].map((b) => b.textContent.trim()));
    ok(modes.includes('Formule') && modes.includes('Activités'), `les formules restent un mode a part (${modes.join(' | ')})`);
    const doublons = await page.evaluate(() => document.querySelectorAll('#quickBookOverlay .qb-type-tile, #quickBookOverlay .qb-visit-grid').length);
    ok(doublons === 1, `UNE seule facon de choisir les activites (${doublons} selecteur(s))`);
    ok(!buttons.includes('Formule'), 'les formules ne sont PAS melangees aux activites');
    ok(buttons.length + modes.length >= 10, `le selecteur reste vivant : ${buttons.length} activites + ${modes.length} modes`);

    console.log('\n[2. Les pistes suivent le nombre de joueurs PENDANT la frappe]');
    // Le bug exact de Movsar : 9 joueurs, capacite 6 par piste -> 2 pistes.
    const before = await statusText(page);
    ok(/1\s*piste requise/.test(before), `depart a 4 joueurs : 1 piste requise (${before.trim()})`);
    await page.fill('.qb-field input[type="number"], #qbPax, input[data-qb-pax]', '9').catch(async () => {
      // Le champ n'a pas d'id stable : on prend le champ nombre de la modale.
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop();
        input.value = '9';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    await page.waitForTimeout(600);
    const after = await statusText(page);
    ok(/2\s*pistes requises/.test(after), `9 joueurs sur 6 par piste : 2 pistes requises (${after.trim()})`);
    ok(!/1\s*piste requise/.test(after), 'la ligne ne dit plus « 1 piste requise »');

    console.log('\n[3. Une activite libre ne demande pas de piste]');
    await page.evaluate(() => window.setQuickType('activity', 'minigolf_blacklight'));
    await page.waitForTimeout(700);
    const freeText = await statusText(page);
    ok(!/piste requise|pistes requises/.test(freeText), `le minigolf ne reserve aucune piste (${freeText.trim()})`);
    // Mesure par le DOM : le bouton actif porte l'activite choisie (l'etat
    // interne n'est pas expose, et une sonde qui le suppose rend undefined).
    const activeLabel = await page.evaluate(() => [...document.querySelectorAll('.qb-type-row .qb-liste .qb-visit-row.is-on .qb-visit-toggle')].map((b) => b.textContent.trim()).join(' + '));
    ok(activeLabel === 'Minigolf Blacklight', `le bouton actif est l activite choisie (${activeLabel})`);

    console.log('\n[4. Contre-epreuve : ce gate sait-il rougir ?]');
    // On remet le bowling et on force 4 joueurs : la ligne DOIT redire 1 piste.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const input = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')].pop();
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    const backTo1 = await statusText(page);
    ok(/1\s*piste requise/.test(backTo1), `retour a 4 joueurs : la ligne redescend a 1 piste (${backTo1.trim()}) -> la sonde suit vraiment l etat`);

    console.log('\n[5. Plusieurs activites, ce n est PAS « sur mesure »]');
    // Depuis le 2026-10-02, « sur mesure » = des EXTRAS (arcades, nourriture,
    // boissons) qu on ouvre a la main : cocher deux activites ne les ouvre pas.
    // Movsar, 2026-08-26 : « quand on choisis plusieurs faut pas que ca mette sur
    // mesure hein, c est juste ils ont plusieurs activites et c est normal ».
    // Cocher deux activites fabrique bien une VISITE cote donnees (le serveur ne
    // connait que ca pour un programme multi-activites), mais l ecran ne doit pas
    // annoncer un mode que personne n a choisi, et le dossier doit porter le nom
    // de ce qu il contient.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
    const multi = await page.evaluate(async () => {
      const modeActif = () => (document.querySelector('#quickBookOverlay .qb-extras') ? 'Sur mesure' : '');
      const avant = modeActif();
      const ligne = [...document.querySelectorAll('.qb-liste .qb-visit-toggle')].find((b) => b.textContent.trim() === 'Laser Game');
      if (ligne) ligne.click();
      await new Promise((r) => setTimeout(r, 500));
      return {
        avant,
        apres: modeActif(),
        // `quickBookState` est un `let` de module : il vit dans le scope global
        // lexical, PAS sur window. `window.quickBookState` rend undefined et la
        // sonde mentirait (le gate l a deja paye plus haut, section 3).
        type: (typeof quickBookState !== 'undefined' && quickBookState) ? quickBookState.type : 'introuvable',
        tuiles: [...document.querySelectorAll('.qb-liste .qb-visit-row.is-on .qb-visit-toggle')].map((b) => b.textContent.trim()),
      };
    });
    ok(multi.tuiles.length === 2, `deux activites sont retenues (${multi.tuiles.join(' + ')})`);
    ok(multi.type === 'visite', `le dossier reste une visite cote donnees (${multi.type})`);
    ok(multi.apres !== 'Sur mesure', `« Sur mesure » ne s allume PAS tout seul (mode actif : « ${multi.apres || 'aucun'} »)`);
    // CONTRE-EPREUVE : cliquer VRAIMENT « Sur mesure » doit, lui, l allumer.
    // Sans elle, l assertion ci-dessus passerait meme si le mode n existait plus.
    const choisi = await page.evaluate(async () => {
      const btn = document.querySelector('#quickBookOverlay .qb-extras-open');
      if (!btn) return { erreur: 'bouton absent' };
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      return { actif: document.querySelector('#quickBookOverlay .qb-extras') && quickBookState.surMesure ? 'Sur mesure' : '' };
    });
    ok(choisi.actif === 'Sur mesure', `choisi explicitement, il s allume (${choisi.actif || 'aucun'})`);

    console.log('\n[6. Le prix se saisit au joueur autant qu au total]');
    // Movsar, 2026-08-26 : « le sur mesure il peut modifier le prix par personne
    // et complet ». Le total reste la valeur qui part au serveur ; le champ par
    // personne est une autre facon de l ecrire, pas une seconde verite.
    const prix = await page.evaluate(async () => {
      const paxInput = [...document.querySelectorAll('#quickBookOverlay input[type="number"]')][0];
      if (paxInput) { paxInput.value = '8'; paxInput.dispatchEvent(new Event('input', { bubbles: true })); }
      await new Promise((r) => setTimeout(r, 500));
      const bascule = document.querySelector('.qb-price-toggle');
      if (bascule) bascule.click();
      await new Promise((r) => setTimeout(r, 400));
      const perso = document.getElementById('qbCustomPricePerPerson');
      const total = document.getElementById('qbCustomPrice');
      if (!perso || !total) return { erreur: 'champs absents' };
      const montant = () => ((document.querySelector('#quickBookOverlay .qb-summary .amt') || {}).textContent || '').trim();
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

    console.log('\n[7. Une ligne de la liste decoche autant qu elle coche]');
    // Movsar, 2026-08-26 : « faut qu on puisse decocher un par un et quand on en
    // recoche plusieurs comme on veut ». Le « + » ne savait qu AJOUTER : une
    // activite cochee par erreur restait la pour toujours et il fallait fermer la
    // fenetre pour repartir.
    await page.evaluate(() => window.setQuickType('bowling'));
    await page.waitForTimeout(400);
    const bascule = await page.evaluate(async () => {
      const retenues = () => [...document.querySelectorAll('.qb-liste .qb-visit-row.is-on .qb-visit-toggle')].map((x) => x.textContent.trim());
      const plusDe = (nom) => [...document.querySelectorAll('.qb-liste .qb-visit-toggle')].find((t) => t.textContent.trim() === nom);
      const etapes = [];
      for (const nom of ['Laser Game', 'Billards']) {
        plusDe(nom).click(); await new Promise((r) => setTimeout(r, 350));
      }
      etapes.push(retenues());
      plusDe('Billards').click(); await new Promise((r) => setTimeout(r, 350));
      etapes.push(retenues());
      plusDe('Billards').click(); await new Promise((r) => setTimeout(r, 350));
      etapes.push(retenues());
      // On retire jusqu a n en laisser qu une : la derniere ne se retire pas,
      // il faut bien reserver quelque chose.
      plusDe('Billards').click(); await new Promise((r) => setTimeout(r, 350));
      plusDe('Laser Game').click(); await new Promise((r) => setTimeout(r, 350));
      const avantDerniere = retenues();
      plusDe('Bowling').click(); await new Promise((r) => setTimeout(r, 350));
      return { troisChoisies: etapes[0], apresRetrait: etapes[1], apresRecoche: etapes[2], avantDerniere, apresTentativeDeToutRetirer: retenues() };
    });
    ok(bascule.troisChoisies.length === 3, `trois activites cochees (${bascule.troisChoisies.join(' + ')})`);
    ok(bascule.apresRetrait.length === 2 && !bascule.apresRetrait.includes('Billards'),
      `le « + » RETIRE celle qui etait cochee (${bascule.apresRetrait.join(' + ')})`);
    ok(bascule.apresRecoche.includes('Billards'),
      `et la recoche ensuite comme on veut (${bascule.apresRecoche.join(' + ')})`);
    ok(bascule.avantDerniere.length === 1,
      `on peut redescendre a une seule activite (${bascule.avantDerniere.join(' + ')})`);
    ok(bascule.apresTentativeDeToutRetirer.length === 1,
      `mais jamais a zero : il faut bien reserver quelque chose (${bascule.apresTentativeDeToutRetirer.join(' + ') || 'aucune'})`);

    console.log('\n[8. Chaque activite se regle selon ce qu elle vend]');
    // « playground on doit mettre cbn d enfant, le fun run pixel choisir 15, 30 ».
    // La detection passe par la DONNEE du catalogue (priceType, unitLabel), pas
    // par un id : un autre centre au meme modele en herite sans une ligne.
    const reglages = await page.evaluate(async () => {
      const retenue = (nom) => [...document.querySelectorAll('.qb-liste .qb-visit-row.is-on .qb-visit-toggle')].some((x) => x.textContent.trim() === nom);
      const plusDe = (nom) => [...document.querySelectorAll('.qb-liste .qb-visit-toggle')].find((t) => t.textContent.trim() === nom);
      for (const nom of ['Playground', 'Fun Run by PIXEL']) {
        if (!retenue(nom)) { plusDe(nom).click(); await new Promise((r) => setTimeout(r, 350)); }
      }
      await new Promise((r) => setTimeout(r, 400));
      const rangee = (nom) => [...document.querySelectorAll('.qb-visit-row')]
        .find((row) => (row.querySelector('.qb-visit-toggle') || {}).textContent.trim() === nom);
      const play = rangee('Playground');
      const fun = rangee('Fun Run by PIXEL');
      const compteurAvant = play ? (play.querySelector('.qb-step-valeur') || {}).textContent.trim() : '';
      const moins = play && play.querySelector('.qb-step-btn');
      if (moins) { moins.click(); await new Promise((r) => setTimeout(r, 350)); }
      const playApres = rangee('Playground');
      return {
        sessions: fun ? [...fun.querySelectorAll('.qb-dur-btn')].map((b) => b.textContent.trim()) : [],
        compteurAvant,
        compteurApres: playApres ? (playApres.querySelector('.qb-step-valeur') || {}).textContent.trim() : '',
        // Une activite sans reglage n en affiche pas : pas de bloc vide.
        billardsRegle: !!(rangee('Billards') && rangee('Billards').querySelector('.qb-visit-options')),
      };
    });
    ok(reglages.sessions.length >= 2 && /15 min/.test(reglages.sessions.join(' ')) && /30 min/.test(reglages.sessions.join(' ')),
      `le Fun Run propose ses sessions (${reglages.sessions.join(' | ') || 'aucune'})`);
    ok(/enfant/.test(reglages.compteurAvant), `la plaine de jeux se compte en enfants (${reglages.compteurAvant})`);
    ok(reglages.compteurApres !== reglages.compteurAvant,
      `et le compteur descend vraiment (${reglages.compteurAvant} -> ${reglages.compteurApres})`);

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
