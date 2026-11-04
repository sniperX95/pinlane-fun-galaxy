#!/usr/bin/env node
// LA LIGNE « HEURE D'ARRIVEE » (Movsar, 2026-10-21).
//
// Apres « Pour tout faire, arrivez à 17:50 » : « NON, ils ont le choix de
// choisir l'heure qu'ils veulent, genre rajouter une catégorie pour choisir
// l'heure d'arrivée ». Sur l ecran des heures, une ligne « Heure d'arrivée » en
// tete, facultative comme celle des arcades, pour la visite a la carte et la
// formule. Chaque heure du jour se juge par le serveur avec le calcul de la
// reservation : tout tient, ce qui ne tiendra pas, ou complet.
//
// DISSOCIEE (Ansar, 2026-11-04 : « on change l heure d arrive et les heures bowling
// et laser game suivent mais non jveux si je veux laisser du temps pour x ou y
// raison »). La changer ne deplace jamais une heure touchee ; une heure seulement
// proposee reste ou elle est tant qu elle tient, sinon elle se recale sur la plus
// proche ; une activite touchee avant l arrivee l avance. L ecran demande ses heures
// par `arrivals=1` ; la liste `arrivees=1`, qui posait toute la visite, reste a l API.
//
// Le cas de Movsar : visite du jeudi 22/10, 11 personnes, Bowling, Laser Game,
// Playground, Arcades, Billards, fermeture 22:00.
//   [A] API visite : la liste, une arrivee tot ou tout tient, une tardive qui
//       dit ce qui ne tiendra pas, trop tard a la fin ; chaque arrivee qui se
//       prend pose un plan qui tient cote serveur, a cette arrivee-la, avec le
//       meme manque ; sans le parametre, rien ne change.
//   [B] API formule (Formule 1, jeudi 5/11, 11 personnes) : pareil.
//   [C] Ecran visite (telephone 390x844) : la ligne en tete, fermee, l heure du
//       plan, rien de demande avant de l ouvrir, le bouton du bas libre ; ouverte,
//       ses heures ; 18:00 touchee ne touche rien d autre, les heures proposees se
//       recalent apres elle ; le bowling change a 19:30, l arrivee ne bouge pas ; le
//       bowling a 17:00 l avance, et le conseil le dit ; une arrivee tres en avance
//       laisse les heures ou elles sont ; effacer ne retire aucune heure touchee ;
//       « Arriver à 17:50 » de la proposition pose ses heures.
//   [D] Ecran formule : la ligne, une arrivee touchee, puis effacee.
//
// Contre-epreuve : node scripts/choisir-arrivee-check.js --mutate (mutations
// servies en memoire, aucun fichier touche).
// Captures : PINLANE_CHOIX_CAPTURES=<dossier> enregistre les ecrans du cas.
'use strict';
process.env.TZ = 'Europe/Brussels';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAINTENANT = '2026-10-20T15:00:00+02:00';
const JOUR = '2026-10-22';
const JOUR_FORMULE = '2026-11-05';
const PROGRAMME = [
  { activityId: 'bowling', duration: 1 },
  { activityId: 'laser_game', games: 1 },
  { activityId: 'playground' },
  { activityId: 'arcade_time' },
  { activityId: 'billards', units: 1, hours: 1 },
];
const TOT = '17:50';
const TARDIVE = '20:20';
const HORS = ['Billards', 'Arcades', 'Playground'];

// L horloge du processus, figee puis elle avance.
{
  const Vraie = Date;
  const depart = Vraie.now();
  const cible = new Vraie(MAINTENANT).getTime();
  class Figee extends Vraie {
    constructor(...a) { if (a.length === 0) super(cible + (Vraie.now() - depart)); else super(...a); }
    static now() { return cible + (Vraie.now() - depart); }
  }
  global.Date = Figee;
}

const CRLF = '\r\n';
const LF = '\n';
const MUTATIONS = [
  {
    nom: 'la visite ne sert plus la ligne des arrivees',
    fichier: 'api/public-availability.js',
    remplacer: [['        if (ligneDesArrivees) {\n          const arrivalTimes = ligneDesArriveesDuJour({', '        if (false) {\n          const arrivalTimes = ligneDesArriveesDuJour({']],
  },
  {
    nom: 'l arrivee dite n est plus celle du plan',
    fichier: 'lib/ops-engine.js',
    remplacer: [
      ['const arrivee = Math.max(ouverture, debut - FORMULA_ARRIVAL_MINUTES);', 'const arrivee = Math.max(ouverture, debut - 20);'],
      ['      if (verdict && verdict.ok && verdict.arrival !== time) return;\n', ''],
    ],
  },
  {
    nom: 'la ligne ne voit plus ce qui ne tiendra pas',
    fichier: 'api/public-availability.js',
    remplacer: [['const manque = Number.isFinite(fin) && fin > fermetureDuJour ? fin - fermetureDuJour : 0;', 'const manque = 0;']],
  },
  {
    nom: 'un avertissement sur toutes les heures',
    fichier: 'lib/ops-engine.js',
    remplacer: [['      ...(meilleur.manque > 0 ? {', '      ...(meilleur.manque >= 0 ? {']],
  },
  {
    nom: 'la formule ne sert plus la ligne des arrivees',
    fichier: 'api/public-availability.js',
    remplacer: [['          if (ligneDesArrivees) {\n            const arrivalTimes = laserPlacement', '          if (false) {\n            const arrivalTimes = laserPlacement']],
  },
  {
    nom: 'la ligne d arrivee s ouvre seule et se charge sans qu on la touche',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [["function aPlacer(e) { return e.id !== 'arrivee' && e.etat", 'function aPlacer(e) { return e.etat']],
  },
  {
    nom: 'une arrivee ne garde plus les heures proposees ou elles sont',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [['    retenirProposees({ apres: minutesDe(t) + ACCUEIL });\n    state.arrivee = t;', '    state.retenues = { pins: {}, parties: [] };\n    state.arrivee = t;']],
  },
  {
    nom: 'une activite touchee avant l arrivee ne l avance plus',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [["    if (!state.arrivee || !(minutesDe(t) < minutesDe(state.arrivee) + ACCUEIL)) return;\n    state.arrivee = '';", "    return;\n    state.arrivee = '';"]],
  },
  {
    nom: 'effacer l arrivee retire les heures touchees',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [["    arriveeEffacee = state.arrivee;\n    state.arrivee = ''; adaptation = null;", "    arriveeEffacee = state.arrivee;\n    state.arrivee = ''; adaptation = null; state.pins = {}; state.laserParts = [];"]],
  },
  {
    nom: 'le bouton de la proposition ne pose pas ses heures',
    fichier: 'assets/fungalaxy-booking.js',
    remplacer: [['    Object.keys(heures).forEach(function (k) { if (heures[k]) state.pins[k] = String(heures[k]).slice(0, 5); });\n', '']],
  },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_CHOIX_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  let texte = contenu.split(CRLF).join(LF);
  mutation.remplacer.forEach(([de, vers]) => {
    if (texte.split(de).length - 1 !== 1) {
      console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${de.slice(0, 70)}`);
      process.exit(2);
    }
    texte = texte.split(de).join(vers);
  });
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte;
}
// Le crochet est pose AVANT tout require applicatif.
if (MUTATION && !MUTATION.fichier.startsWith('assets/')) {
  const Module = require('module');
  const compile = Module.prototype._compile;
  const cible = path.resolve(ROOT, MUTATION.fichier);
  Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) return compile.call(this, muter(contenu, MUTATION), nom);
    return compile.call(this, contenu, nom);
  };
}

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
function section(titre) { console.log(`\n${titre}`); }

const database = require('../lib/database');
database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: [], laneStatuses: {}, blocks: [], date, centerId });
database.readStaffState = database.readAvailabilitySnapshot;
const dispo = require('../api/public-availability');
const { verifierEcritureClient } = require('../lib/client-writing');

let ip = 0;
async function heures(q) {
  ip += 1;
  const adresse = `10.8.${ip % 250}.${1 + (ip % 200)}`;
  const req = { method: 'GET', url: `/api/public-availability?${new URLSearchParams({ centerId: 'libramont', ...q }).toString()}`, headers: { host: 'localhost', 'x-forwarded-for': adresse }, socket: { remoteAddress: adresse } };
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (b) => { res.body = b === undefined ? '' : String(b); };
  await dispo(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}
const visite = (q = {}) => heures({ type: 'visite', date: JOUR, pax: '11', softReserve: '1', program: JSON.stringify(PROGRAMME), ...q });
const formule = (q = {}) => heures({ type: 'formule', formuleId: 'f1', date: JOUR_FORMULE, pax: '11', ...q });
const posees = (h) => ({ preferredTimes: JSON.stringify(h), ...(h.laser_game ? { laserGameTimes: JSON.stringify([h.laser_game]) } : {}) });
const debuts = (slot) => Object.fromEntries(((slot && slot.opsPlan && slot.opsPlan.resourceBlocks) || []).filter((b) => b.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime)).reverse().map((b) => [b.activityId, b.startTime]));
const memesHeures = (slot, times) => Object.keys(times).every((id) => debuts(slot)[id] === times[id]);
const noms = (slot) => [...new Set(((slot && slot.visitShortfallItems) || []).map((h) => h.name))];
const entree = (liste, t) => (liste || []).find((x) => x.time === t) || null;

// Chaque arrivee qui se prend, rejouee comme la demande du toucher : un plan a
// ces heures, qui arrive a cette heure-la, avec le meme manque.
async function rejouer(demande, liste, label) {
  const ecarts = [];
  let jouees = 0;
  for (const x of (liste || []).filter((e) => e.ok)) {
    jouees += 1;
    const rep = await demande(posees(x.times));
    const slot = (rep.slots || [])[0];
    if (!slot) { ecarts.push(`${x.time} : aucun creneau (${rep.message})`); continue; }
    if (!memesHeures(slot, x.times)) ecarts.push(`${x.time} : heures ${JSON.stringify(debuts(slot))} vs ${JSON.stringify(x.times)}`);
    if (slot.opsPlan.arrivalTime !== x.time) ecarts.push(`${x.time} : le plan arrive a ${slot.opsPlan.arrivalTime}`);
    if (Boolean(x.warning) !== Boolean(slot.visitEndsAtClose)) ecarts.push(`${x.time} : avis ${Boolean(x.warning)} vs fermeture ${Boolean(slot.visitEndsAtClose)}`);
    if (x.warning && x.warning.missing && x.warning.missing.length && x.warning.missing.join(',') !== noms(slot).join(',')) ecarts.push(`${x.time} : manque ${x.warning.missing} vs ${noms(slot)}`);
    if (!x.warning && x.endTime !== slot.visitEndTime) ecarts.push(`${x.time} : fin ${x.endTime} vs ${slot.visitEndTime}`);
  }
  ok(jouees >= 10 && ecarts.length === 0, `${label} chaque arrivee qui se prend (${jouees}) pose, rejouee comme le toucher, un plan a ses heures qui arrive a cette heure-la, avec le meme manque et la meme fin`, ecarts.slice(0, 3).join(' | '));
}

async function main() {
  section('A. API, LA VISITE DE MOVSAR (22/10, 11 personnes)');
  const a = await visite({ arrivees: '1' });
  const liste = a.arrivalTimes || [];
  ok(liste.length >= 20 && liste.every((x) => /^\d\d:\d\d$/.test(x.time)), '[A] la liste des arrivees du jour, une par heure de la grille', `${liste.length} : ${liste.slice(0, 3).map((x) => x.time).join(', ')}...`);
  const ouverture = liste[0] || {};
  ok(ouverture.time === '10:00' && ouverture.ok && ouverture.times && ouverture.times.bowling === '10:00', '[A] a l ouverture, l arrivee est a l heure pile de la premiere activite (bowling 10:00)', JSON.stringify(ouverture));
  const tot = entree(liste, TOT) || {};
  ok(tot.ok && !tot.warning && tot.times && tot.times.bowling === '18:00' && tot.times.laser_game === '19:00', `[A] arriver a ${TOT} fait tout tenir : bowling 18:00, laser 19:00`, JSON.stringify(tot));
  const tard = entree(liste, TARDIVE) || {};
  ok(tard.ok && tard.warning && tard.warning.code === 'arrival_short' && (tard.warning.missing || []).join(',') === HORS.join(','),
    `[A] arriver a ${TARDIVE} se prend, et dit ce qui ne tiendra pas : ${HORS.join(', ')}`, JSON.stringify(tard.warning || null));
  const phrase = (tard.warning && tard.warning.reason) || '';
  ok(phrase === 'Ne tiendront pas avant la fermeture (22:00) : Billards, Arcades et Playground.' && !verifierEcritureClient(phrase, { etat: 'sans-promesse' }).length && (phrase.match(/\s:\s/g) || []).length <= 1 && !/[\u2013\u2014]/.test(phrase),
    '[A] la phrase est courte et respecte l ecriture client', phrase);
  const tropTard = entree(liste, '20:50') || {};
  ok(tropTard.ok === false && tropTard.code === 'schedule' && tropTard.reason === 'Trop tard pour tout faire avant la fermeture (22:00).', '[A] a 20:50, trop tard : dit, sans heure inventee', JSON.stringify(tropTard));
  const avis = liste.filter((x) => x.ok && x.warning).map((x) => x.time);
  ok(avis.length > 0 && avis.every((t) => t >= '18:00'), '[A] seules les arrivees tardives portent un avis (aucun avertissement sur toutes les heures)', avis.join(', '));
  await rejouer(visite, liste, '[A]');
  const sans = await visite();
  ok(Array.isArray(sans.slots) && !('arrivalTimes' in sans), '[A] sans le parametre, la reponse ne porte aucune liste d arrivee', Object.keys(sans).join(','));

  section('B. API, LA FORMULE 1 (5/11, 11 personnes)');
  const b = await formule({ arrivees: '1' });
  const listeF = b.arrivalTimes || [];
  const totF = entree(listeF, TOT) || {};
  ok(listeF.length >= 10 && totF.ok && !totF.warning && totF.times && totF.times.bowling === '18:00' && totF.times.laser_game === '19:00', `[B] la liste de la formule, ${TOT} : bowling 18:00, laser 19:00`, `${listeF.length} ; ${JSON.stringify(totF)}`);
  const refusF = listeF.filter((x) => !x.ok);
  ok(refusF.length > 0 && refusF.every((x) => x.reason && x.time > totF.time), '[B] les arrivees trop tardives se refusent, avec leur raison', refusF.map((x) => `${x.time} ${x.reason}`).slice(0, 2).join(' | '));
  await rejouer(formule, listeF, '[B]');
  const sansF = await formule();
  ok(!('arrivalTimes' in sansF), '[B] sans le parametre, rien ne change', Object.keys(sansF).join(','));

  section('C ET D. L ECRAN, TELEPHONE 390x844');
  await ecran();

  console.log(failures ? `\nchoisir-arrivee-check: ${failures} defaut(s).` : '\nchoisir-arrivee-check: ALL OK (la ligne « Arrivée » est en tete, dissociee des activites ; chaque arrivee se juge par la porte de la reservation et pose un plan qui arrive a cette heure-la ; le client change ce qu il veut, l arrivee se recale, il l efface ; la formule pareil)');
  process.exit(failures ? 1 : 0);
}

async function ecran() {
  const PORT = Number(process.env.PINLANE_CHOIX_PORT || 4541);
  const BASE = `http://127.0.0.1:${PORT}`;
  const CAPTURES = process.env.PINLANE_CHOIX_CAPTURES || '';
  if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const { figerPage } = require('./gates-horloge');
  const server = mock.createServer({ port: PORT });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const ouvrir = async (avantHeures) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const erreurs = [];
    const demandes = [];
    page.on('pageerror', (err) => erreurs.push(String((err && err.message) || err)));
    page.on('request', (r) => { if (r.url().indexOf('/api/public-availability') >= 0) demandes.push(r.url()); });
    if (MUTATION && MUTATION.fichier.startsWith('assets/')) {
      const mute = muter(fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8'), MUTATION);
      await page.route(`**/${MUTATION.fichier}*`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: mute }));
    }
    await figerPage(page, MAINTENANT);
    await page.goto(`${BASE}/fungalaxy/libramont`);
    await avantHeures(page);
    await page.waitForSelector('#planZone .fg-visit', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('#hourZone.is-busy'), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return { page, erreurs, demandes };
  };
  const jour = async (page, date) => {
    await page.click('#dayBtn');
    for (let i = 0; i < 4; i += 1) {
      if (await page.$(`#calGrid .fg-cal__day[data-date="${date}"]`)) break;
      await page.click('#calNext');
    }
    await page.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
    await page.fill('#paxInput', '11');
    await page.click('#goActivities');
  };
  const versVisite = async (page) => {
    await jour(page, JOUR);
    for (const it of PROGRAMME) await page.click(`#gridAct .fg-card[data-activity="${it.activityId}"]`);
    await page.click('#goHours');
  };
  const versFormule = async (page) => {
    await jour(page, JOUR_FORMULE);
    await page.waitForSelector('.fg-scene[data-scene="activites"].is-active');
    await page.click('#tabFor');
    await page.waitForSelector('#gridFor .fg-card[data-formule="f1"]');
    await page.click('#gridFor .fg-card[data-formule="f1"]');
    await page.waitForTimeout(250);
    await page.click('#goHours');
  };
  const calme = async (page) => {
    await page.waitForFunction(() => !document.querySelector('#hourZone.is-busy'), null, { timeout: 15000 });
    await page.waitForTimeout(500);
  };
  const lire = (page) => page.evaluate(() => {
    const t = (n) => (n ? n.textContent.replace(/[\s\u00a0\u202f]+/g, ' ').trim() : '');
    const lignes = Array.from(document.querySelectorAll('#hourZone .fg-etape[data-cle]'));
    const li = document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]');
    const tete = li && li.querySelector('.fg-etape__tete');
    const piste = document.querySelector('.fg-track[data-activity="arrivee"]');
    return {
      ligne: li ? {
        rang: lignes.indexOf(li),
        tete: Boolean(tete && tete.tagName === 'BUTTON'),
        ouverte: li.classList.contains('is-open'),
        expanded: tete ? tete.getAttribute('aria-expanded') : '',
        etat: ['choisi', 'propose', 'libre', 'vide'].find((k) => li.classList.contains(`is-${k}`)) || '',
        heure: (li.querySelector('.fg-etape__heure') || { dataset: {} }).dataset.mot || '',
        titre: t(li.querySelector('.fg-etape__quoi b')),
        detail: t(li.querySelector('.fg-etape__quoi small')),
        reset: Boolean(piste && piste.querySelector('[data-reset="arrivee"]') && !piste.querySelector('[data-reset="arrivee"]').hidden),
      } : null,
      autres: lignes.filter((l) => l !== li).map((l) => ({ cle: l.dataset.cle, ouverte: l.classList.contains('is-open'), heure: (l.querySelector('.fg-etape__heure') || { dataset: {} }).dataset.mot || '' })),
      conseil: t(document.querySelector('#hourZone .fg-conseil:not([hidden])')),
      puces: piste ? Array.from(piste.querySelectorAll('.fg-chip')).map((c) => ({ t: c.dataset.time, etat: c.dataset.state || '', ok: c.dataset.ok !== 'false', on: c.classList.contains('is-on'), prop: c.classList.contains('is-proposed') })) : [],
      raisons: piste ? Array.from(piste.querySelectorAll('.fg-why-list__item')).map((l) => ({ heures: String(l.dataset.heures || '').split(' ').filter(Boolean), texte: t(l.querySelector('.fg-why-list__quand + span')) })) : [],
      posees: Object.fromEntries(Array.from(document.querySelectorAll('.fg-track')).filter((tr) => tr.dataset.activity !== 'arrivee').map((tr) => [tr.dataset.activity, Array.from(tr.querySelectorAll('.fg-chip.is-on')).map((c) => c.dataset.time)])),
      libresBowling: Array.from(document.querySelectorAll('.fg-track[data-activity="bowling"] .fg-chip')).filter((c) => c.dataset.ok !== 'false' && !c.classList.contains('is-on')).length,
      arrivee: t(document.querySelector('#planZone .fg-visit__step--in b')),
      hors: t(document.querySelector('#planZone .fg-visit__hors')),
      garder: !document.querySelector('#goContact').disabled,
    };
  });
  const ouvrirLigne = async (page) => {
    const ouverte = await page.evaluate(() => { const l = document.querySelector('#hourZone .fg-etape[data-cle="arrivee"]'); return Boolean(l && l.classList.contains('is-open')); });
    if (!ouverte) await page.click('#hourZone .fg-etape[data-cle="arrivee"] .fg-etape__tete');
    await page.waitForFunction(() => document.querySelectorAll('.fg-track[data-activity="arrivee"] .fg-chip').length > 0, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  };
  // L onglet de la plage d une heure, puis l heure, comme au doigt.
  const toucher = async (page, piste, heure) => {
    await page.evaluate(({ id, h }) => {
      const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
      const sec = c && c.closest('.fg-period');
      if (sec && !sec.classList.contains('is-open')) sec.querySelector('.fg-period__btn').click();
    }, { id: piste, h: heure });
    await page.waitForTimeout(300);
    const pris = await page.evaluate(({ id, h }) => {
      const c = document.querySelector(`.fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
      if (!c || c.dataset.ok === 'false') return false;
      c.click();
      return true;
    }, { id: piste, h: heure });
    await calme(page);
    return pris;
  };
  const capture = async (page, nom, selecteur) => {
    if (!CAPTURES) return;
    await page.$eval(selecteur, (z) => z.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(CAPTURES, nom) });
  };
  const arriveesDemandees = (demandes) => demandes.filter((u) => new URL(u).searchParams.get('arrivals') === '1');
  const heureDe = (v, cle) => (v.autres.find((l) => l.cle === cle) || {}).heure || '';
  try {
    // [C] LA VISITE DE MOVSAR
    const { page, erreurs, demandes } = await ouvrir(versVisite);
    const v0 = await lire(page);
    ok(v0.ligne && v0.ligne.rang === 0 && v0.ligne.tete && v0.ligne.titre === 'Arrivée', '[C] la ligne « Arrivée » est la premiere du programme, avec un en-tete a toucher', JSON.stringify(v0.ligne));
    // A l ouverture, l arrivee est celle de la premiere activite : le recapitulatif ne la redit pas.
    ok(v0.ligne && !v0.ligne.ouverte && v0.ligne.expanded === 'false' && v0.ligne.etat === 'propose' && v0.ligne.heure === '10:00' && !v0.arrivee,
      '[C] fermee, elle dit l arrivee du plan ; a la meme heure que la premiere activite, le recapitulatif ne la redit pas', `${JSON.stringify(v0.ligne)} | visite « ${v0.arrivee} »`);
    ok(v0.garder && arriveesDemandees(demandes).length === 0 && v0.autres.some((l) => l.ouverte), '[C] rien ne l attend : « Ces horaires me vont » se touche, aucune liste d arrivee demandee, une ligne d activite s ouvre', `${v0.garder} ${arriveesDemandees(demandes).length}`);
    await ouvrirLigne(page);
    const v1 = await lire(page);
    const listes = arriveesDemandees(demandes);
    ok(listes.length === 1 && !new URL(listes[0]).searchParams.has('preferredTimes'), '[C] ouverte, ses heures se demandent une fois, sans les heures seulement proposees', listes.join(' | '));
    const puce = (v, h) => v.puces.find((p) => p.t === h) || {};
    ok(v1.ligne.ouverte && v1.puces.length >= 20 && puce(v1, '18:00').etat === 'ok' && puce(v1, '18:00').ok, '[C] ses heures s affichent, 18:00 sans rien a dire', `${v1.puces.length} ; ${JSON.stringify(puce(v1, '18:00'))}`);
    const refusees = v1.puces.filter((p) => !p.ok);
    ok(refusees.length > 0 && refusees.every((p) => p.t >= '18:00') && refusees.every((p) => (v1.raisons.find((r) => r.heures.includes(p.t)) || {}).texte), '[C] seules des arrivees tardives se refusent, avec leur raison pour les lecteurs d ecran', refusees.map((p) => p.t).join(', '));
    ok(v1.raisons.every((r) => !verifierEcritureClient(r.texte, { etat: 'sans-promesse' }).length && (r.texte.match(/\s:\s/g) || []).length <= 1 && !/[\u2013\u2014]/.test(r.texte)), '[C] chaque raison respecte l ecriture client', v1.raisons.map((r) => r.texte).join(' | '));
    await capture(page, '1-la-ligne-ouverte.png', '#hourZone .fg-etape[data-cle="arrivee"]');

    // Une arrivee touchee : elle seule est choisie, ce qui ne tient plus se recale apres elle.
    const prise = await toucher(page, 'arrivee', '18:00');
    const v2 = await lire(page);
    ok(prise && JSON.stringify(v2.posees.bowling) === '[]' && JSON.stringify(v2.posees.laser_game) === '[]' && heureDe(v2, 'bowling') >= '18:10',
      '[C] 18:00 touchee : aucune activite n est choisie pour autant, le bowling propose se recale apres elle', `${JSON.stringify(v2.posees)} ${JSON.stringify(v2.autres)}`);
    ok(v2.ligne.etat === 'choisi' && v2.ligne.heure === '18:00' && v2.arrivee === '18:00' && v2.garder, '[C] la ligne dit 18:00 choisie, la visite part de 18:00, le bouton du bas reste', `${JSON.stringify(v2.ligne)} | visite ${v2.arrivee}`);
    await capture(page, '2-arrivee-choisie.png', '#hourZone .fg-prog');

    // Une activite touchee apres l arrivee : l arrivee ne bouge pas.
    const change = await toucher(page, 'bowling', '19:30');
    const v3 = await lire(page);
    ok(change && JSON.stringify(v3.posees.bowling) === '["19:30"]' && v3.ligne.etat === 'choisi' && v3.ligne.heure === '18:00' && v3.arrivee === '18:00', '[C] le bowling touche a 19:30 : l arrivee reste 18:00', `${JSON.stringify(v3.posees)} ${JSON.stringify(v3.ligne)} | visite ${v3.arrivee}`);
    await capture(page, '3-activite-changee.png', '#hourZone .fg-prog');

    // Une activite touchee avant l arrivee : on ne joue pas avant d etre la, elle l avance.
    const avance = await toucher(page, 'bowling', '17:00');
    const v4 = await lire(page);
    ok(avance && JSON.stringify(v4.posees.bowling) === '["17:00"]' && v4.ligne.heure === '16:50' && v4.arrivee === '16:50' && v4.conseil === 'Arrivée avancée à 16:50.', '[C] le bowling touche a 17:00, avant l arrivee : elle avance a 16:50, le conseil le dit', `${JSON.stringify(v4.ligne)} | visite ${v4.arrivee} | « ${v4.conseil} »`);

    // Tres en avance : les heures restent ou elles sont, la touchee comme la proposee.
    const laserAvant = heureDe(v4, 'laser_game');
    await ouvrirLigne(page);
    const enAvance = await toucher(page, 'arrivee', '12:00');
    const v5 = await lire(page);
    ok(enAvance && JSON.stringify(v5.posees.bowling) === '["17:00"]' && Boolean(laserAvant) && heureDe(v5, 'laser_game') === laserAvant && v5.ligne.etat === 'choisi' && v5.ligne.heure === '12:00',
      '[C] une arrivee a 12:00 : le bowling touche et le laser propose ne bougent pas', `${laserAvant} -> ${heureDe(v5, 'laser_game')} ; ${JSON.stringify(v5.ligne)}`);
    ok(/avant le bowling/.test(v5.conseil), '[C] et le conseil dit le temps avant le bowling', v5.conseil);
    await ouvrirLigne(page);
    const v6 = await lire(page);
    ok(JSON.stringify(v6.puces.filter((p) => p.on).map((p) => p.t)) === '["12:00"]' && v6.ligne.reset, '[C] dans la ligne, l heure choisie est la sienne, et « Effacer » est la', `${JSON.stringify(v6.puces.filter((p) => p.on).map((p) => p.t))} ${v6.ligne.reset}`);

    // Effacer : aucune heure touchee ne part, la ligne redit l arrivee du plan.
    await page.click('.fg-track[data-activity="arrivee"] [data-reset="arrivee"]');
    await calme(page);
    const v7 = await lire(page);
    ok(JSON.stringify(v7.posees.bowling) === '["17:00"]' && v7.ligne.etat === 'propose' && v7.ligne.heure === v7.arrivee && Boolean(v7.arrivee) && !v7.ligne.reset,
      '[C] effacee : le bowling du client reste, la ligne redit l arrivee du plan', `${JSON.stringify(v7.posees)} ${JSON.stringify(v7.ligne)} | visite ${v7.arrivee}`);

    // « Arriver à 17:50 » de la proposition : toutes les heures de ce plan d un coup.
    await toucher(page, 'laser_game', '20:30');
    await toucher(page, 'bowling', '21:00');
    const fit = await page.$('#hourZone [data-fit]');
    if (fit) { await fit.click(); await calme(page); }
    const v8 = await lire(page);
    ok(Boolean(fit) && v8.ligne.heure === TOT && v8.arrivee === TOT && JSON.stringify(v8.posees.bowling) === '["18:00"]',
      `[C] « Arriver à ${TOT} » pose les heures de ce plan, la ligne dit ${TOT}`, `${Boolean(fit)} ${JSON.stringify(v8.ligne)} ${JSON.stringify(v8.posees)}`);
    ok(erreurs.length === 0, '[C] aucune erreur de page', erreurs.join(' | '));
    await page.close();

    // [D] LA FORMULE 1
    const f = await ouvrir(versFormule);
    const f0 = await lire(f.page);
    ok(f0.ligne && f0.ligne.rang === 0 && !f0.ligne.ouverte && f0.ligne.heure === '14:00' && !f0.arrivee && arriveesDemandees(f.demandes).length === 0,
      '[D] formule : la ligne en tete, fermee, l arrivee du plan', `${JSON.stringify(f0.ligne)} | visite « ${f0.arrivee} »`);
    await ouvrirLigne(f.page);
    const priseF = await toucher(f.page, 'arrivee', '18:00');
    const f1 = await lire(f.page);
    ok(priseF && JSON.stringify(f1.posees.bowling) === '[]' && JSON.stringify(f1.posees.laser_game) === '[]' && heureDe(f1, 'bowling') >= '18:10' && f1.ligne.etat === 'choisi' && f1.ligne.heure === '18:00' && f1.arrivee === '18:00',
      '[D] formule : 18:00 touchee, aucune activite n est choisie pour autant, le bowling propose se recale, la visite part de 18:00', `${JSON.stringify(f1.posees)} ${JSON.stringify(f1.ligne)} | ${f1.arrivee} | ${JSON.stringify(f1.autres)}`);
    await ouvrirLigne(f.page);
    await f.page.click('.fg-track[data-activity="arrivee"] [data-reset="arrivee"]');
    await calme(f.page);
    const f2 = await lire(f.page);
    ok(f2.ligne.etat === 'propose' && JSON.stringify(f2.posees.bowling) === '[]' && f2.ligne.heure === f2.arrivee,
      '[D] formule : effacee, la ligne redit l arrivee du plan', `${JSON.stringify(f2.posees)} ${JSON.stringify(f2.ligne)} | ${f2.arrivee}`);
    ok(f.erreurs.length === 0, '[D] aucune erreur de page', f.erreurs.join(' | '));
    await f.page.close();
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv.includes('--mutate')) {
  const eclats = require('./gates-eclats');
  const PORT = Number(process.env.PINLANE_CHOIX_PORT || 4541);
  eclats.enPool(MUTATIONS, eclats.nombreDeFils(MUTATIONS.length), (m, fil, i) => eclats.lancer(__filename, [], { env: { ...process.env, PINLANE_CHOIX_PORT: String(PORT + 1 + fil), PINLANE_CHOIX_MUTATION: String(i + 1), PINLANE_CHOIX_CAPTURES: '' } })).then((runs) => {
    let tuees = 0;
    MUTATIONS.forEach((m, i) => {
      const run = runs[i];
      const sortie = `${run.stdout || ''}${run.stderr || ''}`;
      const servie = sortie.indexOf(MUTATION_PREUVE) >= 0;
      const tuee = servie && run.status === 1;
      if (tuee) tuees += 1;
      console.log(`${tuee ? 'TUEE   ' : 'SURVIT '} ${m.nom}${servie ? '' : ' (mutation non servie)'}${tuee ? '' : `  [code ${run.status}]`}`);
    });
    console.log(tuees === MUTATIONS.length ? `\nchoisir-arrivee-check --mutate: ${tuees}/${MUTATIONS.length} mutations tuees` : `\nchoisir-arrivee-check --mutate: ${MUTATIONS.length - tuees} mutation(s) survivante(s)`);
    process.exit(tuees === MUTATIONS.length ? 0 : 1);
  });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}
