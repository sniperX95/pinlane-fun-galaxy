// LE FORMULAIRE NE BUGGE PLUS SUR UN TELEPHONE MODESTE NI SUR UN RESEAU LENT
// (Movsar, 2026-10-12 : « tout le formulaire sur des appareils moins
// puissants bug pas mal, c est toujours pas regle »).
//
// Le vrai formulaire (fungalaxy.html et son script) sur le serveur de dev,
// le processeur ralenti 6x (CDP), les API retardees ou calees par route. Ce
// qui se prouve est ce que le client vit, jamais une intention :
//
//   [A] SABLIER BORNE : un calcul des heures qui ne revient jamais finit en
//       panne dite, avec « Reessayer », au delai des lectures ; la requete
//       calee est coupee par la page.
//   [B] CALCUL PERIME COUPE : deux heures touchees vite, la demande de la
//       premiere est annulee par la page, la seconde fait le plan.
//   [C] TOUCHER RETENU : « Ces horaires me vont » touche pendant un recalcul
//       travaille (is-busy, aria-busy), puis mene aux coordonnees a la
//       reponse, avec l heure touchee. Touche pendant un recalcul qui revient
//       sans creneau, il reste gris, sans roue, et l ecran dit pourquoi.
//   [D] BLOCAGE BORNE : un blocage qui cale laisse passer aux coordonnees
//       a son delai, sans bandeau ; arrive apres coup, il est rendu au
//       serveur (aucune place tenue pour personne).
//   [E] CONFIRMATION JAMAIS COUPEE : passe 15 s, la ligne sous le bouton dit
//       que c est en cours et de ne pas recharger ; la requete n est pas
//       coupee, la reservation aboutit, la ligne reprend sa phrase.
//   [F] VEILLE CALME : aucune relecture de fond pendant les gestes ; un
//       changement vu par la relecture s applique en UNE lecture ; les
//       relectures des heures s espacent d au moins 19 s ; une relecture sans
//       changement ne reserialise pas la reponse.
//   [G] VITRINE APRES L ENTREE : « Envie d un peu plus ? » s ouvre une fois
//       les animations du recapitulatif finies, et la page ne devient inerte
//       qu une image au moins apres que la fenetre est a l ecran.
//   [H] CATALOGUE EN ROUTE : « Choisir mes activites » touche avant le
//       catalogue travaille, sans alerte, et mene aux activites a son
//       arrivee ; un jour choisi avant lui reste choisi ; un catalogue qui
//       ne vient jamais se dit en panne au delai, le bouton cesse de tourner.
//
// CONTRE-EPREUVE (--mutate) : chaque correctif est retire EN MEMOIRE (le
// script est servi mute par le serveur du gate), un a la fois, et le gate
// doit rougir SUR L ASSERTION QUI PORTE CE CORRECTIF, la mutation servie
// (preuve dans la sortie), sans qu aucun MONTAGE ne rougisse (sinon le
// scenario n a rien prouve). Chaque fils ne rejoue que les scenarios de sa
// mutation : le reste du gate ne dit rien sur elle. Le disque n est jamais
// ecrit, et on le verifie.
//
// Lancement : node scripts/formulaire-lenteur-check.js [--mutate]
//   PINLANE_LENTEUR_PORT (4631), PINLANE_LENTEUR_SCENARIOS (A,B,...),
//   PINLANE_LENTEUR_PARALLELE (fils simultanes de --mutate, 2).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_LENTEUR_PORT || 4631);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const CPU = 6;
const FICHIER = 'assets/fungalaxy-booking.js';
const REPLI_H = 'Les horaires ne se sont pas chargés. Réessayez dans un instant.';
const REPLI_F = 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.';
const EN_COURS = 'Votre réservation est toujours en cours d’envoi. Ne rechargez pas la page.';

// UNE MUTATION PAR CORRECTIF : `attendu`, l assertion qui doit rougir ;
// `scenarios`, ceux que le fils rejoue.
const MUTATIONS = [
  {
    nom: 'les lectures n ont plus de delai',
    de: '    var minuteur = setTimeout(function () { parDelai = true; controle.abort(); }, reglages.delai || DELAI_LECTURE);',
    vers: '    var minuteur = 0;',
    attendu: '[A1]', scenarios: ['A', 'H'],
  },
  {
    nom: 'le calcul perime n est plus coupe',
    de: '    if (planEnCours) planEnCours.abort();\n    var controle = planEnCours = new AbortController();',
    vers: '    var controle = planEnCours = new AbortController();',
    attendu: '[B1]', scenarios: ['B'],
  },
  {
    nom: 'le bouton redevient gris a chaque calcul (le toucher se perd)',
    de: '    if (!(state.dispo && state.creneau)) goContact.disabled = true;',
    vers: '    goContact.disabled = true;',
    attendu: '[C1]', scenarios: ['C'],
  },
  {
    nom: 'le toucher retenu ne part plus a la reponse',
    de: "    if (retenu && slot && sceneCourante === 'heures') garderHoraires();",
    vers: '    void retenu;',
    attendu: '[C2]', scenarios: ['C'],
  },
  {
    nom: 'sans creneau, le bouton retenu garde sa roue',
    de: '    var retenu = contactRetenu;\n    lacherContact();',
    vers: '    var retenu = contactRetenu;',
    attendu: '[C3]', scenarios: ['C3'],
  },
  {
    nom: 'le blocage n a plus de delai',
    de: '  var DELAI_BLOCAGE = 8000;',
    vers: '  var DELAI_BLOCAGE = 600000;',
    attendu: '[D1]', scenarios: ['D'],
  },
  {
    nom: 'le blocage arrive apres le delai n est plus rendu',
    de: '          if (res.statut === 201 && x.holdToken && (version !== blocage.version || !avaitJeton)) {',
    vers: '          if (res.statut === 201 && x.holdToken && version !== blocage.version) {',
    attendu: '[D2]', scenarios: ['D'],
  },
  {
    nom: 'la confirmation longue se tait',
    de: '      noteEnvoi.textContent = t;\n',
    vers: '',
    attendu: '[E1]', scenarios: ['E'],
  },
  {
    // Pas un correctif retire : la regle qu un correctif futur casserait.
    nom: 'la confirmation passe sous le delai des lectures (coupee a 12 s)',
    de: "      return fetch('/api/public-reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), credentials: 'omit' });",
    vers: "      var coupe = new AbortController(); setTimeout(function () { coupe.abort(); }, DELAI_LECTURE);\n      return fetch('/api/public-reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), credentials: 'omit', signal: coupe.signal });",
    attendu: '[E2]', scenarios: ['E'],
  },
  {
    nom: 'la veille ne se tait plus pendant les gestes',
    de: '    if (doc.hidden || t - dernierGeste < CALME_APRES_GESTE) return;',
    vers: '    if (doc.hidden) return;',
    attendu: '[F1]', scenarios: ['F'],
  },
  {
    nom: 'un changement vu par la relecture redemande le calcul',
    de: "        poserPlan(x, rep.texte, cle, repereFocus(), '', '');",
    vers: '        chargerPlan();',
    attendu: '[F2]', scenarios: ['F'],
  },
  {
    nom: 'les heures se relisent de nouveau toutes les 15 s',
    de: '  var CADENCE_HEURES = 20000, heuresLues = 0;',
    vers: '  var CADENCE_HEURES = 15000, heuresLues = 0;',
    attendu: '[F3]', scenarios: ['F'],
  },
  {
    nom: 'la relecture reserialise la reponse pour la comparer',
    de: "        if (id !== requeteEnCours || cle !== cleDemande() || sceneCourante !== 'heures' || rep.texte === avant || state.dispoTexte !== avant) return;",
    vers: "        if (id !== requeteEnCours || cle !== cleDemande() || sceneCourante !== 'heures' || JSON.stringify(lu(rep)) === JSON.stringify(state.dispo) || state.dispoTexte !== avant) return;",
    attendu: '[F4]', scenarios: ['F'],
  },
  {
    nom: 'la vitrine repart a 750 ms fixes, au milieu de l entree',
    de: "    vitrineMinuteur = setTimeout(decider, 4000);\n    apresAnimations($('.fg-scene[data-scene=\"recap\"]'), decider);",
    vers: '    vitrineMinuteur = setTimeout(decider, 750);',
    attendu: '[G1]', scenarios: ['G'],
  },
  {
    nom: 'la page devient inerte dans la meme tache que la fenetre',
    de: "    root.classList.add('fg-vitrine-ouverte');\n    placerVitrine(true);",
    vers: "    pageInerte(true);\n    root.classList.add('fg-vitrine-ouverte');\n    placerVitrine(true);",
    attendu: '[G2]', scenarios: ['G'],
  },
  {
    nom: 'un toucher avant le catalogue est renvoye (« se charge encore »)',
    de: "    if (!meta) { if (panneMeta) direErreur(panneMeta); else apresCatalogue($('#goActivities'), allerAuxActivites); return; }",
    vers: "    if (!meta) { direErreur(panneMeta || 'Le formulaire se charge encore. Réessayez dans un instant.'); return; }",
    attendu: '[H1]', scenarios: ['H'],
  },
  {
    nom: 'le catalogue remplace le jour choisi avant lui',
    de: '        if (state.date) direJour(state.date);\n        else if (premier) choisirJour(premier);',
    vers: '        if (premier) choisirJour(premier);',
    attendu: '[H2]', scenarios: ['H'],
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_LENTEUR_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
const SCENARIOS = String(process.env.PINLANE_LENTEUR_SCENARIOS || 'A,B,C,C3,D,E,F,G,H').split(',').map((s) => s.trim()).filter(Boolean);
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${FICHIER} : ${mutation.de.slice(0, 80)}`);
    process.exit(2);
  }
  return texte.split(mutation.de).join(mutation.vers);
}

const mock = require('./dev-tunnel-server');
const { chromium } = require('playwright-core');

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch (error) { return false; }
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const plat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// --- Le serveur : le mock partage, et le formulaire mute quand il le faut ---
let servies = 0;
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (MUTATION && url.pathname === `/${FICHIER}`) {
      const source = fs.readFileSync(path.join(ROOT, FICHIER), 'utf8');
      const mute = muter(source, MUTATION);
      servies += 1;
      if (servies === 1) console.log(`${MUTATION_PREUVE} ${MUTATION.nom}`);
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(mute);
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
// Chaque scenario repart d un serveur vide : ni dossier pose, ni blocage, ni
// plafond de requetes laisse par le precedent.
function reinitialiser() {
  mock.occupationDev.length = 0;
  mock.blocagesDev.clear();
  const seaux = globalThis.__pinlaneRateBuckets;
  if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations)/.test(k)).forEach((k) => seaux.delete(k));
}
function lireJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (morceau) => { corps += morceau; });
      res.on('end', () => { try { resolve(JSON.parse(corps)); } catch (error) { resolve({ brut: corps.slice(0, 200) }); } });
    }).on('error', reject);
  });
}

// --- Une page neuve, son journal, son processeur ralenti ---------------------
async function nouvellePage(browser, { avantChargement } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const journal = { req: [], fin: [], ko: [], erreurs: [] };
  page.on('pageerror', (e) => journal.erreurs.push(e.message));
  page.on('request', (r) => { if (r.url().includes('/api/')) journal.req.push({ t: Date.now(), u: r.url(), m: r.method(), corps: r.postData() || '' }); });
  page.on('requestfinished', (r) => { if (r.url().includes('/api/')) journal.fin.push({ t: Date.now(), u: r.url(), m: r.method() }); });
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) journal.ko.push({ t: Date.now(), u: r.url(), m: r.method(), e: (r.failure() && r.failure().errorText) || '' }); });
  if (avantChargement) await avantChargement(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  return { ctx, page, journal };
}
const estPlan = (u) => u.pathname === '/api/public-availability' && u.searchParams.get('type') !== 'durees';
const estMeta = (u) => u.pathname === '/api/public-booking-meta';
const lectureHeures = (r) => r.u.includes('/api/public-availability?') && !r.u.includes('type=durees');
const lectureCatalogue = (r) => r.m === 'GET' && r.u.includes('/api/public-booking-meta?') && !r.u.includes('calendar=');
function poses(u) { try { return JSON.parse(new URL(u).searchParams.get('preferredTimes') || '{}'); } catch (e) { return {}; } }

async function allerAuMois(page, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${MOIS[mo - 1].charAt(0).toUpperCase()}${MOIS[mo - 1].slice(1)} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (x) => document.querySelector('#calTitle').textContent.trim() !== x, 4000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 10000, dateStr);
}
async function jusquAuxHeures(page, { pax = 6, activites = ['bowling', 'laser_game'] } = {}) {
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.is-ready', { timeout: 30000 });
  await page.click('#dayBtn');
  await allerAuMois(page, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.fill('#paxInput', String(pax));
  await page.dispatchEvent('#paxInput', 'input');
  await page.locator('#paxInput').blur();
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 15000);
  for (const id of activites) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
  await page.click('#goHours');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering')
    && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 30000);
}
// Les heures de bowling libres, ni posees ni proposees : dans l ordre du jour.
function heuresLibres(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-track[data-activity="bowling"] .fg-chip'))
    .filter((x) => x.dataset.ok !== 'false' && x.dataset.state === 'ok' && !x.classList.contains('is-on') && !x.classList.contains('is-proposed'))
    .map((x) => x.dataset.time));
}
// Toucher une heure comme un doigt : sa ligne et sa plage ouvertes d abord.
async function toucherHeure(page, h) {
  await page.evaluate((t) => {
    const chip = document.querySelector(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${t}"]`);
    const ligne = chip && chip.closest('.fg-etape');
    if (ligne && !ligne.classList.contains('is-open')) ligne.querySelector('.fg-etape__tete').click();
    const plage = chip && chip.closest('.fg-period');
    if (plage && !plage.classList.contains('is-open')) plage.querySelector('.fg-period__btn').click();
  }, h);
  await dormir(700);
  await page.click(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${h}"]`, { timeout: 8000 });
}
// Un vrai toucher au milieu du bouton : un bouton gris l avale, comme sous
// un doigt (Playwright, lui, attendrait qu il se rallume).
async function toucherAuMilieu(page, sel) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
  await dormir(150);
  const b = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  await page.mouse.click(b.x, b.y);
}
function retarder(page, predicat, ms) {
  return page.route(predicat, async (route) => { await dormir(ms); try { await route.continue(); } catch (e) { /* annulee par la page */ } });
}
async function versLeRecap(page) {
  await page.click('#goContact');
  if (!await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 15000)) return false;
  await page.fill('#cPrenom', 'Camille');
  await page.fill('#cNom', 'Test');
  await page.fill('#cEmail', 'groupe@example.org');
  await page.fill('#cTel', '0491301667');
  await page.click('.fg-occasion[data-occasion="anniversaire"]');
  await page.check('#cConsent');
  return true;
}
const scene = (page) => page.evaluate(() => (document.querySelector('.fg-scene.is-active') || { dataset: {} }).dataset.scene || '');

// =============================================================================
async function scenarioA(browser) {
  console.log('\n[A] UN CALCUL QUI CALE FINIT EN PANNE DITE');
  const { ctx, page, journal } = await nouvellePage(browser);
  let lacher = () => {};
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [A] ecran des heures, plan calcule, bouton actif');
    const libres = await heuresLibres(page);
    ok(libres.length > 0, 'MONTAGE [A] une heure de bowling libre a toucher', libres.slice(0, 3).join(' '));
    const cale = new Promise((r) => { lacher = r; });
    await page.route((u) => estPlan(u), async (route) => { await cale; try { await route.continue(); } catch (e) { /* coupee */ } });
    const n0 = journal.ko.length, t0 = Date.now();
    await toucherHeure(page, libres[0]);
    const vu = await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#hourZone [data-retry]'), 22000);
    const ms = Date.now() - t0;
    const etat = await page.evaluate(() => ({ notice: (document.querySelector('#hourZone .fg-notice b') || {}).textContent || '', gris: document.querySelector('#goContact').disabled, roue: document.querySelector('#goContact').classList.contains('is-busy') }));
    ok(vu && ms >= 10000 && ms <= 20000 && plat(etat.notice) === plat(REPLI_H) && etat.gris && !etat.roue,
      '[A1] le calcul cale finit en panne dite, avec « Reessayer », au delai des lectures (12 s), le bouton gris et sans roue', JSON.stringify({ vu, ms, etat }));
    const coupee = journal.ko.slice(n0).filter((k) => lectureHeures(k) && /ABORTED/i.test(k.e));
    ok(coupee.length === 1, '[A1] la requete calee est coupee par la page', `${coupee.length} coupee(s)`);
    ok(journal.erreurs.length === 0, '[A] aucune erreur de page', journal.erreurs.join(' | '));
  } finally { lacher(); await ctx.close(); }
}

async function scenarioB(browser) {
  console.log('\n[B] DEUX HEURES TOUCHEES VITE : LE CALCUL PERIME EST COUPE');
  const { ctx, page, journal } = await nouvellePage(browser);
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [B] ecran des heures, plan calcule');
    const libres = await heuresLibres(page);
    ok(libres.length >= 2, 'MONTAGE [B] deux heures de bowling libres', libres.slice(0, 3).join(' '));
    const [h1, h2] = [libres[0], libres[libres.length - 1]];
    await retarder(page, (u) => estPlan(u), 2500);
    await toucherHeure(page, h1);
    await dormir(300);
    await toucherHeure(page, h2);
    ok(await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 20000), 'MONTAGE [B] le dernier calcul revient');
    await dormir(800);
    const pour = (h) => (r) => lectureHeures(r) && poses(r.u).bowling === h;
    const premiere = journal.req.filter(pour(h1)), seconde = journal.req.filter(pour(h2));
    ok(premiere.length === 1 && seconde.length === 1, 'MONTAGE [B] une demande par heure touchee', `${premiere.length} / ${seconde.length}`);
    const coupee = journal.ko.some((k) => pour(h1)(k) && /ABORTED/i.test(k.e));
    const finie = journal.fin.some(pour(h1));
    ok(coupee && !finie, '[B1] la demande de la premiere heure est annulee par la page, pas lue jusqu au bout', JSON.stringify({ h1, coupee, finie }));
    const posee = await page.evaluate((h) => Boolean(document.querySelector(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${h}"].is-on`)), h2);
    ok(journal.fin.some(pour(h2)) && posee, '[B2] la seconde fait le plan : son heure est posee', h2);
  } finally { await ctx.close(); }
}

async function scenarioC(browser) {
  console.log('\n[C] « CES HORAIRES ME VONT » PENDANT UN RECALCUL');
  // Le toucher retenu part a la reponse, avec l heure touchee.
  {
    const { ctx, page, journal } = await nouvellePage(browser);
    try {
      ok(await jusquAuxHeures(page), 'MONTAGE [C] ecran des heures, plan calcule');
      const libres = await heuresLibres(page);
      ok(libres.length > 0, 'MONTAGE [C] une heure de bowling libre');
      const h = libres[0];
      await retarder(page, (u) => estPlan(u), 3500);
      await toucherHeure(page, h);
      await dormir(300);
      const avant = await page.evaluate(() => ({ calcul: document.querySelector('#hourZone').classList.contains('is-busy'), gris: document.querySelector('#goContact').disabled }));
      ok(avant.calcul, 'MONTAGE [C] le recalcul est en route au moment du toucher', JSON.stringify(avant));
      await toucherAuMilieu(page, '#goContact');
      const pendant = await page.evaluate(() => ({ roue: document.querySelector('#goContact').classList.contains('is-busy'), aria: document.querySelector('#goContact').getAttribute('aria-busy'), scene: document.querySelector('.fg-scene.is-active').dataset.scene }));
      ok(pendant.roue && pendant.aria === 'true' && pendant.scene === 'heures', '[C1] le toucher est entendu : le bouton travaille (is-busy, aria-busy) pendant le calcul', JSON.stringify(pendant));
      const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 15000);
      const blocage = mock.dernierePose.blocages.filter((b) => b.action === 'hold').pop();
      const heure = blocage && blocage.corps && blocage.corps.preference && blocage.corps.preference.preferredTimes ? blocage.corps.preference.preferredTimes.bowling : '';
      const ordre = (() => { const r = journal.fin.filter((x) => lectureHeures(x) && poses(x.u).bowling === h).pop(); const b = journal.req.filter((x) => x.u.includes('/api/public-holds') && !/"release":true/.test(x.corps)).pop(); return Boolean(r && b && b.t >= r.t); })();
      ok(contact && heure === h && ordre, '[C2] a la reponse, il mene aux coordonnees, et le blocage part apres le calcul, avec l heure touchee', JSON.stringify({ contact, h, heure, ordre }));
    } finally { await ctx.close(); }
  }
}
async function scenarioC3(browser) {
  console.log('\n[C3] « CES HORAIRES ME VONT » PENDANT UN RECALCUL QUI REVIENT SANS CRENEAU');
  {
    const { ctx, page } = await nouvellePage(browser);
    try {
      ok(await jusquAuxHeures(page), 'MONTAGE [C] ecran des heures, plan calcule (sans creneau)');
      const libres = await heuresLibres(page);
      const h = libres[0];
      await page.route((u) => estPlan(u) && poses(u.href).bowling === h, async (route) => {
        await dormir(3000);
        try { const rep = await route.fetch(); const j = await rep.json(); j.slots = []; await route.fulfill({ response: rep, json: j }); } catch (e) { /* coupee */ }
      });
      await toucherHeure(page, h);
      await dormir(300);
      await toucherAuMilieu(page, '#goContact');
      const roue = await page.evaluate(() => document.querySelector('#goContact').classList.contains('is-busy'));
      ok(roue, 'MONTAGE [C] le toucher sur le recalcul sans creneau est retenu');
      ok(await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 15000), 'MONTAGE [C] le recalcul sans creneau revient');
      await dormir(800);
      const apres = await page.evaluate(() => ({ scene: document.querySelector('.fg-scene.is-active').dataset.scene, gris: document.querySelector('#goContact').disabled, roue: document.querySelector('#goContact').classList.contains('is-busy'), aria: document.querySelector('#goContact').hasAttribute('aria-busy'), pourquoi: Boolean(document.querySelector('#planZone .fg-notice--warn')) }));
      ok(apres.scene === 'heures' && apres.gris && !apres.roue && !apres.aria && apres.pourquoi, '[C3] sans creneau : il reste gris, sans roue, et l ecran dit pourquoi', JSON.stringify(apres));
    } finally { await ctx.close(); }
  }
}

async function scenarioD(browser) {
  console.log('\n[D] UN BLOCAGE QUI CALE NE RETIENT PAS LE CLIENT');
  const { ctx, page } = await nouvellePage(browser);
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [D] ecran des heures, plan calcule');
    const avantBlocages = mock.dernierePose.blocages.length;
    // Le blocage arrive au serveur 18 s apres le toucher : bien apres le delai.
    await page.route((u) => u.pathname === '/api/public-holds', async (route) => {
      if (!/"release":true/.test(route.request().postData() || '')) await dormir(18000);
      try { await route.continue(); } catch (e) { /* coupee */ }
    });
    const t0 = Date.now();
    await page.click('#goContact');
    const contact = await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 15000);
    const ms = Date.now() - t0;
    const bandeau = await page.evaluate(() => { const b = document.querySelector('.fg-scene[data-scene="contact"] [data-hold]'); return b && !b.hidden; });
    ok(contact && ms >= 6500 && ms <= 14500 && !bandeau, '[D1] passe le delai du blocage (8 s), le client avance aux coordonnees, sans bandeau', JSON.stringify({ contact, ms, bandeau }));
    // Le blocage arrive apres coup au serveur : la page le rend.
    let poses0 = [], rendu = false;
    for (let k = 0; k < 250 && !rendu; k += 1) {
      const actions = mock.dernierePose.blocages.slice(avantBlocages);
      poses0 = actions.filter((a) => a.action === 'hold').map((a) => a.jeton);
      rendu = poses0.length > 0 && poses0.every((j) => actions.some((a) => a.action === 'release' && a.jeton === j && a.libere));
      if (!rendu) await dormir(100);
    }
    const actifs = [...mock.blocagesDev.values()].filter((b) => b.etat === 'actif').length;
    ok(poses0.length === 1, 'MONTAGE [D] le blocage tardif a bien ete pose au serveur', String(poses0.length));
    ok(rendu && actifs === 0, '[D2] arrive apres le delai, ce blocage est rendu : aucune place tenue pour personne', JSON.stringify({ rendu, actifs }));
  } finally { await ctx.close(); }
}

async function scenarioE(browser) {
  console.log('\n[E] LA CONFIRMATION LONGUE : JAMAIS COUPEE, JAMAIS MUETTE');
  const { ctx, page, journal } = await nouvellePage(browser);
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [E] ecran des heures, plan calcule');
    ok(await versLeRecap(page), 'MONTAGE [E] coordonnees remplies');
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 12000), 'MONTAGE [E] recapitulatif');
    await attendre(page, () => !document.querySelector('#vitrine').hasAttribute('data-attendue'), 8000);
    if (await page.evaluate(() => !document.querySelector('#vitrine').hidden)) { await page.keyboard.press('Escape'); await attendre(page, () => document.querySelector('#vitrine').hidden, 3000); }
    const phrase = await page.evaluate(() => document.querySelector('.fg-scene[data-scene="recap"] .fg-confirm__note').textContent);
    await retarder(page, (u) => u.pathname === '/api/public-reservations', 17500);
    const t0 = Date.now();
    await page.click('#confirmBtn');
    await dormir(6000);
    const tot = await page.evaluate(() => document.querySelector('.fg-scene[data-scene="recap"] .fg-confirm__note').textContent);
    const ligne = await attendre(page, (t) => document.querySelector('.fg-scene[data-scene="recap"] .fg-confirm__note').textContent === t, 14000, EN_COURS);
    const ms = Date.now() - t0;
    const roue = await page.evaluate(() => document.querySelector('#confirmBtn').classList.contains('is-busy'));
    ok(tot === phrase && ligne && ms >= 13000 && ms <= 19000 && roue, '[E1] passe 15 s, la ligne sous le bouton dit que c est en cours et de ne pas recharger', JSON.stringify({ ms, tot: plat(tot), roue }));
    const fin = await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000);
    const coupee = journal.ko.some((k) => k.u.includes('/api/public-reservations'));
    const finie = journal.fin.some((k) => k.u.includes('/api/public-reservations'));
    const reprise = await page.evaluate(() => document.querySelector('.fg-scene[data-scene="recap"] .fg-confirm__note').textContent);
    ok(fin && finie && !coupee && reprise === phrase, '[E2] la requete n est jamais coupee : la reservation aboutit, la ligne reprend sa phrase', JSON.stringify({ fin, finie, coupee, reprise: plat(reprise) }));
  } finally { await ctx.close(); }
}

async function scenarioF(browser) {
  console.log('\n[F] LA VEILLE SE TAIT PENDANT LES GESTES ET NE REFAIT RIEN POUR RIEN');
  const { ctx, page, journal } = await nouvellePage(browser, {
    // Les serialisations de plus de 4000 caracteres : la reponse des heures
    // en fait 16 000, la relecture ne doit plus la reserialiser.
    avantChargement: (p) => p.addInitScript(() => {
      const brut = JSON.stringify;
      window.__grosJSON = 0;
      JSON.stringify = function () { const s = brut.apply(JSON, arguments); if (typeof s === 'string' && s.length > 4000) window.__grosJSON += 1; return s; };
    }),
  });
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [F] ecran des heures, plan calcule');
    const libres = await heuresLibres(page);
    ok(libres.length > 0, 'MONTAGE [F] une heure de bowling libre ou poser un changement');
    const H = libres[libres.length - 1];
    const t0 = Date.now();
    // 1. Des gestes, toutes les 3 s pendant 24 s.
    for (let k = 0; k < 8; k += 1) { await page.keyboard.press('Shift'); await dormir(3000); }
    const t1 = Date.now();
    const pendant = journal.req.filter((r) => r.t >= t0 && r.t <= t1 && (lectureHeures(r) || lectureCatalogue(r)));
    ok(pendant.length === 0, '[F1] aucune relecture de fond pendant les gestes (24 s)', pendant.map((r) => `${Math.round((r.t - t0) / 1000)}s ${new URL(r.u).pathname}`).join(', '));
    // 2. Un changement chez le centre : toutes les pistes prises a H.
    const [hh, mm] = H.split(':').map(Number), debut = hh * 60 + mm;
    const fin = `${String(Math.floor((debut + 60) / 60)).padStart(2, '0')}:${String((debut + 60) % 60).padStart(2, '0')}`;
    const pistes = [1, 2, 3, 4, 5, 6, 7, 8];
    mock.occupationDev.push({
      id: 7001, centerId: 'libramont', date: mock.DATE, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', pax: 48,
      startTime: H, duration: 1, totalDuration: 1, lanes: pistes,
      program: { items: [{ activityId: 'bowling', planned: true, minutes: 60, duration: 1 }] },
      opsPlan: { startTime: H, endTime: fin, resourceBlocks: [{ type: 'activity', resourceType: 'bowling_lane', activityId: 'bowling', startTime: H, endTime: fin, lanes: pistes, players: 48, start: debut, end: debut + 60 }] },
    });
    const urlPage = journal.req.filter(lectureHeures).pop().u;
    const verif = await lireJson(urlPage.replace(/^http:\/\/[^/]+/, BASE_URL));
    const aH = (((verif.anchors && verif.anchors.activities) || []).find((a) => a.activityId === 'bowling') || { times: [] }).times.find((t) => t.time === H) || {};
    ok(aH.ok === false, 'MONTAGE [F] le serveur ferme bien H une fois les pistes prises', `${H} ${JSON.stringify(aH).slice(0, 120)}`);
    const t2 = Date.now();
    const applique = await attendre(page, (h) => { const c = document.querySelector(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${h}"]`); return c && c.dataset.ok === 'false'; }, 30000, H);
    await dormir(1500);
    const t3 = Date.now();
    const lectures = journal.req.filter((r) => r.t >= t2 && r.t <= t3 && lectureHeures(r));
    ok(applique && lectures.length === 1, '[F2] le changement vu par la relecture s applique en UNE lecture, sans recalcul', JSON.stringify({ applique, lectures: lectures.length }));
    // 3. Plus rien ne change : la relecture suivante.
    const gros0 = await page.evaluate(() => window.__grosJSON);
    let suivante = null;
    for (let k = 0; k < 280 && !suivante; k += 1) {
      suivante = journal.req.filter((r) => r.t > t3 && lectureHeures(r))[0] || null;
      if (!suivante) await dormir(100);
    }
    await dormir(1500);
    const gros1 = await page.evaluate(() => window.__grosJSON);
    const ecart = suivante && lectures.length ? Math.round((suivante.t - lectures[0].t) / 100) / 10 : 0;
    ok(Boolean(suivante) && ecart >= 19, '[F3] les relectures des heures s espacent d au moins 19 s', `${ecart} s`);
    ok(Boolean(suivante) && gros1 === gros0, '[F4] une relecture sans changement ne reserialise pas la reponse', `${gros1 - gros0} serialisation(s) de plus de 4000 caracteres`);
    ok(journal.erreurs.length === 0, '[F] aucune erreur de page', journal.erreurs.join(' | '));
  } finally { await ctx.close(); }
}

async function scenarioG(browser) {
  console.log('\n[G] LA VITRINE ATTEND QUE LE RECAPITULATIF SOIT POSE');
  const { ctx, page } = await nouvellePage(browser);
  try {
    ok(await jusquAuxHeures(page), 'MONTAGE [G] ecran des heures (bowling et laser, 6 joueurs : une offre)');
    ok(await versLeRecap(page), 'MONTAGE [G] coordonnees remplies');
    await page.evaluate(() => {
      const w = window.__sonde = { trames: 0, pose: 0, maxAnims: 0, montree: 0, inerte: 0, entree: 0 };
      const recap = document.querySelector('.fg-scene[data-scene="recap"]');
      const tour = () => {
        w.trames += 1;
        if (recap.classList.contains('is-active')) {
          if (!w.entree) w.entree = w.trames;
          const n = recap.getAnimations({ subtree: true }).filter((a) => { const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; return t && t.iterations !== Infinity && a.playState === 'running'; }).length;
          w.maxAnims = Math.max(w.maxAnims, n);
          if (n === 0 && w.maxAnims > 0 && !w.pose) w.pose = w.trames;
        }
        requestAnimationFrame(tour);
      };
      requestAnimationFrame(tour);
      new MutationObserver((recs) => recs.forEach((r) => {
        if (r.target.id === 'vitrine' && r.attributeName === 'hidden' && !r.target.hidden && !w.montree) w.montree = w.trames;
        if (r.target.classList && r.target.classList.contains('fg-shell') && r.attributeName === 'inert' && r.target.inert && !w.inerte) w.inerte = w.trames;
      })).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden', 'inert'] });
    });
    await page.click('#goRecap');
    const ouverte = await attendre(page, () => { const v = document.querySelector('#vitrine'); return !v.hidden && !v.hasAttribute('data-attendue'); }, 10000);
    await dormir(400);
    const s = await page.evaluate(() => Object.assign({ cartes: document.querySelectorAll('#vitrine .fg-vitrine__carte[data-carte]').length, inertePage: document.querySelector('.fg-shell').inert }, window.__sonde));
    ok(ouverte && s.cartes > 0 && s.maxAnims > 0 && s.pose > 0, 'MONTAGE [G] la vitrine s ouvre seule, avec ses offres, sur un recapitulatif qui s anime', JSON.stringify(s));
    ok(s.montree >= s.pose, '[G1] la fenetre s ouvre une fois les animations du recapitulatif finies', `montree a l image ${s.montree}, pose a l image ${s.pose}`);
    ok(s.inerte > s.montree && s.inertePage, '[G2] la page ne devient inerte qu une image au moins apres la fenetre', `montree ${s.montree}, inerte ${s.inerte}`);
  } finally { await ctx.close(); }
}

async function scenarioH(browser) {
  console.log('\n[H] LE CATALOGUE EN ROUTE');
  // H1 : le toucher avant le catalogue est garde, puis rejoue.
  {
    reinitialiser();
    let lacher = () => {};
    const tenu = new Promise((r) => { lacher = r; });
    const { ctx, page } = await nouvellePage(browser, {
      avantChargement: (p) => p.route((u) => estMeta(u) && u.searchParams.get('calendar') === '45' && !u.searchParams.get('calendarFrom'), async (route) => { await tenu; try { await route.continue(); } catch (e) { /* coupee */ } }),
    });
    try {
      await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#goActivities');
      await dormir(600);
      await toucherAuMilieu(page, '#goActivities');
      await dormir(300);
      const pendant = await page.evaluate(() => ({ roue: document.querySelector('#goActivities').classList.contains('is-busy'), aria: document.querySelector('#goActivities').getAttribute('aria-busy'), alerte: document.querySelector('#fgAlert').hidden ? '' : document.querySelector('#fgAlert').textContent, pret: document.body.classList.contains('is-ready') }));
      ok(!pendant.pret, 'MONTAGE [H] le catalogue est encore en route au moment du toucher');
      lacher();
      const activites = await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active'), 15000);
      const apres = await page.evaluate(() => ({ roue: document.querySelector('#goActivities').classList.contains('is-busy'), alerte: !document.querySelector('#fgAlert').hidden }));
      ok(pendant.roue && pendant.aria === 'true' && !pendant.alerte && activites && !apres.roue && !apres.alerte,
        '[H1] touche avant le catalogue, le bouton travaille sans alerte, et mene aux activites a son arrivee', JSON.stringify({ pendant, activites, apres }));
    } finally { lacher(); await ctx.close(); }
  }
  // H2 : un jour choisi avant le catalogue reste choisi.
  {
    reinitialiser();
    const meta = await lireJson(`${BASE_URL}/api/public-booking-meta?centerId=libramont&calendar=45`);
    const ouverts = ((meta.center && meta.center.calendar) || []).filter((e) => e.open && !e.over).map((e) => e.date).sort();
    const cible = [mock.DATE, ...ouverts.filter((d) => d > mock.DATE)].find((d) => d !== ouverts[0] && ouverts.includes(d)) || '';
    ok(Boolean(cible) && cible !== ouverts[0], 'MONTAGE [H] un jour ouvert qui n est pas le premier', `${cible} (premier : ${ouverts[0]})`);
    let lacher = () => {};
    const tenu = new Promise((r) => { lacher = r; });
    const { ctx, page } = await nouvellePage(browser, {
      avantChargement: (p) => p.route((u) => estMeta(u) && u.searchParams.get('calendar') === '45' && !u.searchParams.get('calendarFrom'), async (route) => { await tenu; try { await route.continue(); } catch (e) { /* coupee */ } }),
    });
    try {
      await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#dayBtn');
      await page.click('#dayBtn');
      ok(await allerAuMois(page, cible), 'MONTAGE [H] le calendrier charge son mois avant le catalogue');
      await page.click(`#calGrid .fg-cal__day[data-date="${cible}"]`);
      const avant = await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim());
      lacher();
      ok(await attendre(page, () => document.body.classList.contains('is-ready'), 15000), 'MONTAGE [H] le catalogue arrive');
      await dormir(600);
      const apres = await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim());
      ok(avant && apres === avant, '[H2] le jour choisi avant le catalogue reste choisi', `${avant} -> ${apres}`);
    } finally { lacher(); await ctx.close(); }
  }
  // H3 : un catalogue qui ne vient jamais se dit en panne au delai.
  {
    reinitialiser();
    let lacher = () => {};
    const jamais = new Promise((r) => { lacher = r; });
    const { ctx, page } = await nouvellePage(browser, {
      avantChargement: (p) => p.route((u) => estMeta(u) && u.searchParams.get('calendar') === '45' && !u.searchParams.get('calendarFrom'), async (route) => { await jamais; try { await route.continue(); } catch (e) { /* coupee */ } }),
    });
    try {
      await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#goActivities');
      const t0 = Date.now();
      await dormir(600);
      await toucherAuMilieu(page, '#goActivities');
      const panne = await attendre(page, (t) => { const a = document.querySelector('#fgAlert'); return !a.hidden && a.textContent.replace(/\s+/g, ' ').trim() === t; }, 22000, plat(REPLI_F));
      const ms = Date.now() - t0;
      const roue = await page.evaluate(() => document.querySelector('#goActivities').classList.contains('is-busy'));
      ok(panne && ms >= 10000 && ms <= 20000 && !roue, '[H3] un catalogue qui ne vient jamais se dit en panne au delai, et le bouton cesse de tourner', JSON.stringify({ panne, ms, roue }));
    } finally { lacher(); await ctx.close(); }
  }
}

async function main() {
  const server = await serveur();
  let browser = null;
  const t0 = Date.now();
  try {
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    const table = { A: scenarioA, B: scenarioB, C: scenarioC, C3: scenarioC3, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH };
    for (const s of SCENARIOS) {
      if (!table[s]) { ok(false, `MONTAGE scenario inconnu : ${s}`); continue; }
      reinitialiser();
      try { await table[s](browser); } catch (error) { ok(false, `MONTAGE [${s}] le scenario s est arrete en route`, String(error && error.message || error).split(LF)[0].slice(0, 160)); }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  if (MUTATION) ok(servies > 0, 'MONTAGE la mutation a ete servie au formulaire', String(servies));
  console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s, scenarios ${SCENARIOS.join(',')})`);
  if (failures) {
    console.error(`\nformulaire-lenteur-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nformulaire-lenteur-check: ALL OK (sous lenteur, aucun toucher avale, aucun sablier sans fin, aucun calcul perime qui continue, une panne dite a temps)');
}

if (process.argv.includes('--mutate')) {
  const avant = fs.readFileSync(path.join(ROOT, FICHIER), 'utf8');
  const { spawn } = require('child_process');
  const parallele = Math.max(1, Number(process.env.PINLANE_LENTEUR_PARALLELE || 2));
  let ratees = 0, suivant = 0;
  const lancer = (index) => new Promise((resolve) => {
    const mutation = MUTATIONS[index];
    const env = { ...process.env, PINLANE_LENTEUR_MUTATION: String(index + 1), PINLANE_LENTEUR_PORT: String(PORT + 1 + index), PINLANE_LENTEUR_SCENARIOS: mutation.scenarios.join(',') };
    const fils = spawn(process.execPath, [__filename], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    fils.stdout.on('data', (d) => { sortie += d; });
    fils.stderr.on('data', (d) => { sortie += d; });
    fils.on('close', (code) => {
      // Le crochet a-t-il MORDU, et la ou il devait ? Sans ces preuves, un
      // fils qui echoue pour une autre raison (port pris, montage casse) se
      // lirait comme une contre-epreuve.
      const lignes = sortie.split(LF);
      const mordu = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
      const vise = lignes.some((l) => l.startsWith(`FAIL  ${mutation.attendu}`));
      const montage = lignes.filter((l) => l.startsWith('FAIL  MONTAGE'));
      if (code === 1 && mordu && vise && !montage.length) {
        console.log(`contre-epreuve OK : ${mutation.attendu} rougit quand ${mutation.nom}.`);
      } else {
        ratees += 1;
        console.log(sortie);
        console.log(`CONTRE-EPREUVE RATEE (code ${code}, mutation ${mordu ? 'servie' : 'JAMAIS servie'}, ${mutation.attendu} ${vise ? 'rouge' : 'PAS rouge'}, ${montage.length} montage(s) rouge(s)) : ${mutation.nom}.`);
      }
      resolve();
    });
  });
  const ouvrier = async () => { while (suivant < MUTATIONS.length) { const i = suivant; suivant += 1; await lancer(i); } };
  Promise.all(Array.from({ length: parallele }, ouvrier)).then(() => {
    if (fs.readFileSync(path.join(ROOT, FICHIER), 'utf8') !== avant) { console.log(`LE DISQUE A ETE ECRIT : ${FICHIER}`); ratees += 1; }
    if (ratees) { console.log(`\nformulaire-lenteur-check --mutate: ${ratees} contre-epreuve(s) ratee(s).`); process.exit(1); }
    console.log(`\nformulaire-lenteur-check --mutate: contre-epreuve OK : ${MUTATIONS.length} mutations, chacune rougit sur son assertion, et aucun fichier n a ete ecrit.`);
  });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}
