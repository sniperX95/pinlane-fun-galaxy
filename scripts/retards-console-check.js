// LES RETARDS DANS LA CONSOLE (2026-11-06) : la piste reprise apres un groupe en
// retard, et « Pas venu » qui rend ses places.
//
// Deux trous lus le 06/11 dans le code des retards. Un groupe en retard compte a son
// heure prevue et rien ne disait qu un autre groupe reprend sa piste tant que l equipe
// n ouvrait pas « Ils arrivent dans ». Et « Pas venu » ne rendait rien : la console
// comptait encore sa piste et ses armes. Ansar a valide les deux reponses sur planches
// (« Oui, les deux »). Ce gate les garde sur la vraie console
// (scripts/planning-v3-fixtures.js, le samedi « pic » a 15:20, aucun reseau, aucune base) :
//   [A] LA PISTE REPRISE : sous le retard, « Pistes 3-4 reprises à 16:00 » (Famille
//       Pirotte, +50 min) et « Piste 6 reprise à 16:30 » (Amis de Clara, +20 min), la
//       bulle nomme le groupe suivant ; rien pour un groupe dont la partie est finie ni
//       avant le retard ; le toucher ouvre « Ils arrivent dans » ; un groupe suivant
//       note « Pas venu » ne reprend rien ;
//   [B] « PAS VENU » REND SES PISTES : le vrai bouton de la ligne, puis la barre (4 puis
//       6 pistes libres), 15:30 et 16:00 (« Bowling complet » puis « 1 piste libre »), la
//       case « Pistes 6-7 libérées », et au planning des pistes la carte grise
//       « Pas venu » ;
//   [C] LES CONTROLES DE LA CONSOLE suivent la meme regle (tientSesPlaces) : les pistes
//       prises, le conflit d un glisser, la fenetre Réserver, et au laser le depart, les
//       armes comptees et la place d un groupe.
// --contre-preuves : chaque regle retiree (au texte servi, le disque n est jamais
// touche) fait rougir sa lettre ; chaque ancre existe une fois et une seule.
//   RC_MUTATIONS : un sous-ensemble ; RC_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 5233 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_RETARDS_CONSOLE_PORT || 5233);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PG = 'assets/pinlane-planning-global.js';
const APP = 'assets/app-main.js';
const liste = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let rouges = [];
let mutation = null;
let silence = false;
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`);
  if (!cond && mutation && mordu(label)) throw new Mordu(label);
  return cond;
}
// Un rouge deja la sans mutation ne prouve rien : seul un rouge nouveau mord.
const mordu = (label) => label.startsWith(`[${mutation.lettre}]`) && !mutation.deDepart.has(label);
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LE MONTAGE : le samedi « pic », sans le prefixe DÉMO, en 1440x900 ; un faux serveur
// rend le PATCH de l absence comme le vrai (absentAt pose ou retire).
// ---------------------------------------------------------------------------
function fauxServeur() {
  window.__fixtureServeur = async (corps) => {
    const journee = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    const avant = journee.find((x) => String(x.id) === String(corps.id));
    const ecrit = Object.assign({}, avant, corps, { updatedAt: new Date().toISOString() });
    if ('absent' in corps) { ecrit.absentAt = corps.absent ? new Date().toISOString() : null; delete ecrit.absent; }
    return { statut: 200, json: { ok: true, reservation: ecrit } };
  };
}
async function monter(browser, heure = '15:20') {
  return FX.monter(browser, { fixture: 'pic', appareil: 'ordinateur', theme: 'dark', heure, port: PORT, variante: ['sansdemo'], avantChargement: (page) => page.addInitScript(fauxServeur) });
}
// La ligne d un groupe du tableau, lue sur ses vrais noeuds.
const ligneDe = (page, nom) => page.evaluate((n) => {
  const r = [...document.querySelectorAll('.gf-r[data-gf-id]')].find((x) => (x.querySelector('.gf-nom__t') || {}).textContent === n);
  if (!r) return null;
  const reprise = r.querySelector('[data-gf-reprise]');
  const bowling = [...r.querySelectorAll('.gf-a[data-gf-titre="Bowling"] .gf-x')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
  return {
    id: r.getAttribute('data-gf-id'),
    retard: Boolean(r.querySelector('[data-gf-retard]')),
    reprise: reprise && !reprise.hidden ? reprise.textContent.trim() : '',
    repriseBulle: reprise && !reprise.hidden ? reprise.getAttribute('title') || '' : '',
    bowling,
    pasVenu: Boolean(r.querySelector('[data-gf-absent]')),
  };
}, nom);
// La case d heure d une demi-heure (« 16:00 », « Bowling complet », « 1 piste libre »).
const caseHeure = (page, h) => page.evaluate((x) => {
  const c = [...document.querySelectorAll('.gf-bloc, [class*="gf-bloc"]')].find((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().startsWith(x));
  return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
}, h);
const barre = (page) => page.evaluate(() => {
  const n = [...document.querySelectorAll('div, section, header')].filter((e) => /en direct/.test(e.textContent || '') && e.getBoundingClientRect().width > 1000 && e.getBoundingClientRect().height < 70)
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
  // (le texte rendu, avec ses espaces : textContent colle « Pistes4 libres »)
  return n ? n.innerText.replace(/\s+/g, ' ').trim() : '';
});
async function marquerAbsent(page, nom) {
  const id = await page.evaluate((n) => { const r = state.reservations.find((x) => x.name === n); return r ? r.id : null; }, nom);
  if (!id) return false;
  await page.evaluate((x) => { const r = state.reservations.find((y) => y.id === x); r.absentAt = new Date().toISOString(); renderStaff(); }, id);
  await FX.repos(page, 300);
  return true;
}

// ---------------------------------------------------------------------------
// [A] LA PISTE REPRISE
// ---------------------------------------------------------------------------
async function reprise(browser) {
  const { ctx, page, erreurs } = await monter(browser, '15:20');
  try {
    const pirotte = await ligneDe(page, 'Famille Pirotte');
    const clara = await ligneDe(page, 'Amis de Clara');
    const foot = await ligneDe(page, 'Club de foot U12');
    ok(pirotte && pirotte.retard && pirotte.reprise === 'Pistes 3-4 reprises à 16:00', '[A] Famille Pirotte (+50 min) : « Pistes 3-4 reprises à 16:00 » sous le retard', pirotte);
    ok(clara && clara.retard && clara.reprise === 'Piste 6 reprise à 16:30', '[A] Amis de Clara (+20 min) : « Piste 6 reprise à 16:30 », la piste 7 reste a eux', clara);
    ok(clara && /^Famille Noël prend la piste 6 à 16:30/.test(clara.repriseBulle) && /Toucher pour décaler/.test(clara.repriseBulle), '[A] la bulle nomme le groupe suivant et dit le geste', clara && clara.repriseBulle);
    ok(foot && foot.retard && foot.reprise === '', '[A] Club de foot U12 (+2h20) : sa partie est finie, rien a reprendre', foot);
    // Le toucher ouvre « Ils arrivent dans ».
    await page.click(`[data-gf-reprise="${clara.id}"]`);
    await FX.repos(page, 250);
    const bulle = await page.evaluate(() => { const t = [...document.querySelectorAll('.staff-action-popover-title')].find((x) => x.offsetParent !== null); return t ? t.textContent.trim() : ''; });
    ok(bulle === 'Ils arrivent dans', '[A] toucher la piste reprise ouvre « Ils arrivent dans »', bulle);
    await page.keyboard.press('Escape');
    // Le groupe suivant ne viendra pas : il ne reprend rien.
    await marquerAbsent(page, 'Anniversaire Louise (9 ans)');
    const apres = await ligneDe(page, 'Famille Pirotte');
    ok(apres && apres.retard && apres.reprise === '', '[A] Anniversaire Louise note « Pas venu » : plus rien de repris apres Famille Pirotte', apres);
    ok(!erreurs.length, '[A] aucune erreur dans la page', erreurs.slice(0, 2));
  } finally { await ctx.close(); }
  // Avant le retard (15:04, le seuil est a 5 min) : rien.
  const tot = await monter(browser, '15:04');
  try {
    const clara = await ligneDe(tot.page, 'Amis de Clara');
    ok(clara && !clara.retard && clara.reprise === '', '[A] a 15:04, Amis de Clara ne sont pas en retard : rien sous leur nom', clara);
  } finally { await tot.ctx.close(); }
}

// ---------------------------------------------------------------------------
// [B] « PAS VENU » REND SES PISTES
// ---------------------------------------------------------------------------
async function pasVenu(browser) {
  const { ctx, page, erreurs } = await monter(browser, '15:20');
  try {
    const barreAvant = await barre(page);
    const seizeAvant = await caseHeure(page, '16:00');
    ok(/Pistes 4 libres 1, 2, 5 et 8/.test(barreAvant), '[B] avant : la barre compte 4 pistes libres', barreAvant);
    ok(/Bowling complet/.test(seizeAvant), '[B] avant : 16:00 dit « Bowling complet »', seizeAvant);
    const clara = await ligneDe(page, 'Amis de Clara');
    ok(clara && clara.pasVenu, '[B] la ligne d Amis de Clara porte « Pas venu »', clara);
    await page.click(`[data-gf-absent="${clara.id}"]`);
    await page.waitForFunction((id) => { const r = state.reservations.find((x) => String(x.id) === String(id)); return Boolean(r && r.absentAt); }, clara.id, { timeout: 8000 }).catch(() => {});
    await FX.repos(page, 400);
    const barreApres = await barre(page);
    const quinzeTrente = await caseHeure(page, '15:30');
    const seize = await caseHeure(page, '16:00');
    const apres = await ligneDe(page, 'Amis de Clara');
    ok(/Pistes 6 libres 1, 2, 5, 6, 7 et 8/.test(barreApres), '[B] apres « Pas venu » : la barre compte 6 pistes libres', barreApres);
    ok(/2 pistes libres/.test(quinzeTrente), '[B] 15:30 a 2 pistes libres', quinzeTrente);
    ok(/1 piste libre/.test(seize) && !/Bowling complet/.test(seize), '[B] 16:00 passe de « Bowling complet » a « 1 piste libre »', seize);
    ok(!apres, '[B] la ligne d Amis de Clara quitte le planning', apres);
    // Le planning des pistes.
    await page.evaluate(() => { const t = [...document.querySelectorAll('button, a')].find((x) => /^Bowling/.test((x.textContent || '').trim())); if (t) t.click(); });
    await FX.repos(page, 500);
    const cartes = await page.evaluate((id) => [...document.querySelectorAll(`.booking[data-booking-res-id="${id}"]`)].map((c) => ({ absent: c.classList.contains('is-absent'), texte: c.textContent.replace(/\s+/g, ' ').trim(), z: getComputedStyle(c).zIndex })), clara.id);
    ok(cartes.length === 0, '[B] au planning des pistes, ses deux cartes ne sont plus la', cartes);
    const libres = await page.evaluate(() => { const k = document.getElementById('kpiFree'); return k ? k.closest('[class]').textContent.replace(/\s+/g, ' ').trim() : (document.body.textContent.match(/Libres\s*\d+\s*pistes[^A-Z]*/) || [''])[0]; });
    ok(/6 pistes/.test(libres), '[B] au planning des pistes, 6 pistes libres', libres);
    ok(!erreurs.length, '[B] aucune erreur dans la page', erreurs.slice(0, 2));
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------
// [C] LES CONTROLES DE LA CONSOLE
// ---------------------------------------------------------------------------
async function controles(browser) {
  const { ctx, page } = await monter(browser, '15:20');
  try {
    const lire = () => page.evaluate(() => {
      const jour = state.currentDate;
      // (la fenetre Réserver fermee n a pas d etat : celui de sa journee, le temps de lire)
      const prev = quickBookState;
      quickBookState = { ...(prev || {}), date: jour };
      const occupation = rvOccupationPistes('15:30', 1);
      quickBookState = prev;
      const depart = lpModele().departs.find((d) => Math.abs(d.t - 15.5) < 0.001);
      return {
        prises: [...getOccupiedLanes(jour, '15:30', 1, null)].map(Number).sort((a, b) => a - b),
        conflit: lanesConflict(jour, '15:30', 1, [6], null).map((r) => r.name),
        reserver6: occupation[6] && occupation[6].etat,
        placesLaser: depart ? depart.places : null,
        armes: rsArmesComptees(jour, { start: 15.5, duration: 0.5 }, getAvailabilityLaserCapacity() || 30).pris,
        laser15: getLaserAvailability(jour, '15:30', 0.5, 15, null),
      };
    });
    const avant = await lire();
    await marquerAbsent(page, 'Amis de Clara');
    await marquerAbsent(page, 'Amis de Manon');
    const apres = await lire();
    ok(avant.prises.includes(6) && avant.prises.includes(7) && !apres.prises.includes(6) && !apres.prises.includes(7), '[C] les pistes prises a 15:30 (getOccupiedLanes) rendent 6 et 7', { avant: avant.prises, apres: apres.prises });
    ok(avant.conflit.includes('Amis de Clara') && !apres.conflit.length, '[C] glisser un groupe sur la piste 6 a 15:30 ne se heurte plus a eux (lanesConflict)', { avant: avant.conflit, apres: apres.conflit });
    ok(avant.reserver6 === 'pris' && apres.reserver6 === 'libre', '[C] la fenetre Réserver dit la piste 6 libre a 15:30 (rvOccupationPistes)', { avant: avant.reserver6, apres: apres.reserver6 });
    ok(apres.placesLaser - avant.placesLaser === 8, '[C] le depart laser de 15:30 rend les 8 armes d Amis de Manon (lpModele)', { avant: avant.placesLaser, apres: apres.placesLaser });
    ok(avant.armes - apres.armes === 8, '[C] les armes comptees de Réserver a 15:30 rendent les 8 (rsArmesComptees)', { avant: avant.armes, apres: apres.armes });
    ok(avant.laser15 && avant.laser15.ok === false && apres.laser15 && apres.laser15.ok === true, '[C] un groupe de 15 au laser a 15:30 : refuse, puis accepte (getLaserAvailability)', { avant: avant.laser15, apres: apres.laser15 });
  } finally { await ctx.close(); }
}

const SCENARIOS = { reprise, pasVenu, controles };

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const SEUL = (fichier, de, vers = '') => [{ fichier, de, vers }];
const MUTATIONS = [
  { nom: 'sans-piste-reprise', lettre: 'A', scenarios: ['reprise'], editions: SEUL(PG, '    var reprise = g.retard && m.maintenant != null ? gfReprise(g, m) : null;\n', '    var reprise = null;\n') },
  { nom: 'reprise-apres-la-partie', lettre: 'A', scenarios: ['reprise'], editions: SEUL(PG, '.filter(function (e) { return e.pistes && e.pistes.length && e.end > m.maintenant + 1e-6; });', '.filter(function (e) { return e.pistes && e.pistes.length; });') },
  { nom: 'reprise-sans-le-retard', lettre: 'A', scenarios: ['reprise'], editions: SEUL(PG, '          if (o.start < e.end - 1e-6 || o.start >= e.end + retard - 1e-6) return;', '          if (o.start < e.end - 1e-6 || o.start >= e.end - 1e-6) return;') },
  { nom: 'pistes-libres-comptent-l-absent', lettre: 'B', scenarios: ['pasVenu'], editions: SEUL(APP, '  poser(todaysReservations().filter(tientSesPlaces));', '  poser(todaysReservations());') },
  { nom: 'ligne-absente-reste', lettre: 'B', scenarios: ['pasVenu'], editions: SEUL(PG, "    var tout = filtre === 'absent' ? duJour : duJour.filter(tientSesPlaces);", '    var tout = duJour;') },
  { nom: 'carte-absente-reste', lettre: 'B', scenarios: ['pasVenu'], editions: SEUL(APP, "  const res = todaysReservations().filter(r => tientSesPlaces(r) && reservationMatchesStaffResource(r, 'bowling')", "  const res = todaysReservations().filter(r => reservationMatchesStaffResource(r, 'bowling')") },
  { nom: 'pistes-prises-avec-l-absent', lettre: 'C', scenarios: ['controles'], editions: SEUL(APP, '    if (r.date === date && tientSesPlaces(r) && (r.lanes || []).length > 0) {', "    if (r.date === date && r.status !== 'cancelled' && (r.lanes || []).length > 0) {") },
  { nom: 'glisser-heurte-l-absent', lettre: 'C', scenarios: ['controles'], editions: SEUL(APP, '    r.date === date &&\n    tientSesPlaces(r) &&', "    r.date === date &&\n    r.status !== 'cancelled' &&") },
  { nom: 'laser-avec-l-absent', lettre: 'C', scenarios: ['controles'], editions: SEUL(APP, '    .filter(r => r.id !== ignoreId && r.date === date && tientSesPlaces(r))', "    .filter(r => r.id !== ignoreId && r.date === date && r.status !== 'cancelled')") },
  { nom: 'reserver-voit-l-absent', lettre: 'C', scenarios: ['controles'], editions: SEUL(APP, '    .filter((r) => r.date === s.date && tientSesPlaces(r) && (r.lanes || []).length > 0)', "    .filter((r) => r.date === s.date && r.status !== 'cancelled' && (r.lanes || []).length > 0)") },
  { nom: 'armes-comptent-l-absent', lettre: 'C', scenarios: ['controles'], editions: SEUL(APP, '  const pris = Math.min(capacite, compter(state.reservations.filter((r) => r.date === date && tientSesPlaces(r))));', "  const pris = Math.min(capacite, compter(state.reservations.filter((r) => r.date === date && r.status !== 'cancelled')));") },
];

async function jouer(browser, noms) {
  for (const n of noms) {
    if (!SCENARIOS[n]) throw new Error(`scenario inconnu : ${n}`);
    await SCENARIOS[n](browser);
  }
}
// Les rouges du scenario sans mutation, une fois par scenario.
const releves = new Map();
async function rougesDeDepart(browser, noms) {
  const tout = new Set();
  for (const n of noms) {
    if (!releves.has(n)) {
      const garde = rouges.length;
      const avant = echecs;
      silence = true;
      try { await jouer(browser, [n]); } catch (e) { rouges.push(`crash de depart ${n} : ${e.message}`); }
      silence = false;
      releves.set(n, rouges.slice(garde));
      rouges.length = garde;
      echecs = avant;
    }
    releves.get(n).forEach((l) => tout.add(l));
  }
  return tout;
}

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, Object.keys(SCENARIOS));
    } else {
      console.log('[CP] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.RC_MUTATIONS || liste(process.env.RC_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[CP] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const deDepart = await rougesDeDepart(browser, m.scenarios);
        const avant = echecs;
        const garde = rouges.length;
        mutation = { ...m, deDepart };
        silence = !process.env.RC_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        const vus = rouges.slice(garde);
        const mord = vus.some(mordu);
        mutation = null;
        rouges.length = garde;
        echecs = avant;
        ok(mord, `[CP] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nretards-console-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nretards-console-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
