#!/usr/bin/env node
'use strict';
// =============================================================================
// DES INSTALLATIONS COMPTEES : PISTES DE DUCKPIN, TABLES DE BILLARD
// -----------------------------------------------------------------------------
// Audit QA du 2026-09-28 sur app.pinlane.be/reserver/libramont :
//   * billards : aucune dotation (double reservation possible), et UNE table
//     d une heure quoi qu on ait choisi (le formulaire n envoyait rien) ;
//   * duckpin : aucune piste bloquee a l ecran des heures, le conflit ne
//     sortait qu au clic final (409, le formulaire rempli).
// Movsar, le meme jour :
//   « le duckpin super mal gere, nous n avons que 2 pistes avec 6 joueurs
//   max » ; au-dela, PLUSIEURS TOURS (sa reponse a la question posee) ;
//   « table de billard pas de nombre de joueur ... tu dois permettre de
//   choisir combien de tables ils veulent et c 10 euro par heure et par
//   table » ;
//   « que depuis le saas on peut choisir combien de table dispo etc pour tout
//   et que ça corrige a la seconde sur le formulaire ».
//
// LA REGLE A UNE SOURCE : le catalogue de l activite (booking.units,
// booking.capacityPerUnit), que la config du centre remplace activite par
// activite (activityCapacity, page Etablissement), et une fonction,
// activityUnitPlan (lib/activity-catalog).
//   [A] le catalogue : duckpin 2 pistes de 6, billards 6 tables sans regle de
//       joueurs ; le reglage du centre prime ;
//   [B] le moteur : pistes et tours du duckpin, tables choisies des billards,
//       duree et prix ; au-dela des tables du centre, un refus qui le dit ;
//   [C] une ligne enregistree se relit a l identique (vrai filtre de la base) ;
//   [D] le comptoir (booking-core) et le formulaire comptent comme le serveur ;
//   [E] la disponibilite publique ne propose plus une heure ou les pistes ou
//       les tables sont prises, et nomme l activite complete ;
//   [F] le formulaire : tables et heures des billards, ce qui part au serveur,
//       la phrase des tours du duckpin, et un changement du centre qui se voit
//       sans recharger ;
//   [G] la console : la fiche dit pistes, tables et tours ; la config du
//       centre garde les installations lisibles ;
//   [I] la page Etablissement, dans la vraie console : elle montre le reglage
//       du centre, refuse une saisie hors bornes sans rien envoyer, et ce
//       qu elle envoie devient le catalogue du centre ;
//   [H] contre-epreuves : chaque regle retiree, ce gate ROUGIT.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_TOURS_PORT || 4387);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CENTRE = 'libramont';
// Un samedi hors vacances scolaires et hors ferie : 10:00 - minuit. Le
// samedi des gates (scripts/jour-de-test.js) : le 21 novembre ecrit en dur
// faisait rougir le gate des qu il serait passe (2026-10-19).
// Hors reseau : la table statique des conges scolaires fait foi (avant de
// lire le calendrier pour choisir le jour).
process.env.PINLANE_CALENDAR_SYNC = 'off';
const JOUR = require('./jour-de-test').jourDeTest({ jour: 6 });

let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { console.log(`\n[${titre}]`); }
function viderCache() { Object.keys(require.cache).forEach((cle) => { delete require.cache[cle]; }); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return Boolean(await page.evaluate(fn, arg).catch(() => false)); }
}

// LE TARIF DES BILLARDS VIT EN BASE (activities.price_value, ligne « all » du
// client fungalaxy : 10 EUR, lue en prod le 2026-09-28), pas dans le socle. Ce
// gate pose la meme ligne dans le magasin du catalogue, comme la base la
// relit, pour chiffrer ce que la prod chiffre. Rejoue apres chaque vidage du
// cache des modules.
const LIGNE_BILLARDS_PROD = {
  id: 'billards', center_id: 'all', name: 'Billards', resource_type: 'soft_capacity',
  duration_model: { type: 'open_range', maxMinutes: 180, minMinutes: 60, stepMinutes: 60, defaultMinutes: 60 },
  service_model: { explainMinutes: 2, transitionOutMinutes: 5 }, risk_drivers: ['table_capacity'], planning_pressure: 'low',
  source: 'seed', active: true, bookable: null, price_type: 'per_unit_hour', price_value: '10.00', price_unit: 'par table et par heure',
  booking_order: null, owner_client_id: 'fungalaxy', pricing: null,
};
function catalogueProd() {
  require('../lib/catalog-store').applyCatalogState({
    centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }],
    activities: [LIGNE_BILLARDS_PROD],
  });
}
// Le reglage d un centre, pose comme la base le relirait (applyCenterOverrides :
// la config sauvegardee par la page Etablissement). Map vide = le fichier.
function reglageCentre(config) {
  require('../lib/ops-knowledge').applyCenterOverrides(config ? new Map([[CENTRE, config]]) : new Map());
}

// ---------------------------------------------------------------------------
// [A] [B] LES REGLES DU SERVEUR, EXECUTEES PAR LE VRAI CODE
// ---------------------------------------------------------------------------
const DUCKPIN = [
  // joueurs, duree (h) -> pistes au total, en meme temps, tours, minutes, EUR
  [1, 1, 1, 1, 1, 60, 39], [6, 1, 1, 1, 1, 60, 39], [7, 1, 2, 2, 1, 60, 78], [12, 1, 2, 2, 1, 60, 78],
  [13, 1, 3, 2, 2, 120, 117], [18, 1, 3, 2, 2, 120, 117], [24, 1, 4, 2, 2, 120, 156], [25, 1, 5, 2, 3, 180, 195],
  [13, 0.5, 3, 2, 2, 60, 60], [18, 2, 3, 2, 2, 240, 234],
];
const BILLARDS = [
  // joueurs, heures, tables demandees -> tables, minutes, EUR
  [1, 1, 0, 1, 60, 10], [21, 1, 0, 1, 60, 10], [21, 1, 6, 6, 60, 60], [8, 2, 3, 3, 120, 60], [4, 3, 2, 2, 180, 60], [30, 1, 6, 6, 60, 60],
];

function normaliser(programme, pax) {
  const { normalizeProgram } = require('../lib/visit-program');
  try {
    return { item: normalizeProgram(programme, { centerId: CENTRE, pax, dateStr: JOUR }).items[0] || {} };
  } catch (error) {
    return { erreur: { code: Number(error.statusCode) || 0, message: String(error.message || '') } };
  }
}

function reglesServeur() {
  catalogueProd();
  const catalogue = require('../lib/activity-catalog');
  const act = (centre, id) => catalogue.listCenterActivities(centre).find((a) => a.id === id) || {};
  const r = {
    duck: act(CENTRE, 'duckpin_bowling'),
    bil: act(CENTRE, 'billards'),
    bilGembloux: act('gembloux', 'billards'),
    duckpin: DUCKPIN.map(([pax, duration]) => normaliser([{ activityId: 'duckpin_bowling', duration }], pax).item || {}),
    billards: BILLARDS.map(([pax, hours, units]) => normaliser([{ activityId: 'billards', hours, ...(units ? { units } : {}) }], pax).item || {}),
    septTables: normaliser([{ activityId: 'billards', hours: 1, units: 7 }], 4),
  };
  // Le reglage du centre : 8 tables, 3 pistes de 5 joueurs.
  reglageCentre({ activityCapacity: { billards: { units: 8 }, duckpin_bowling: { units: 3, capacityPerUnit: 5 } } });
  r.bilRegle = act(CENTRE, 'billards');
  r.duckRegle = act(CENTRE, 'duckpin_bowling');
  r.bilGemblouxRegle = act('gembloux', 'billards');
  r.septTablesRegle = normaliser([{ activityId: 'billards', hours: 1, units: 7 }], 4);
  r.duckpin16Regle = normaliser([{ activityId: 'duckpin_bowling', duration: 1 }], 16).item || {};
  reglageCentre(null);
  return r;
}

function verifierServeur(r) {
  section('A. LE CATALOGUE, ET LE REGLAGE DU CENTRE QUI PRIME');
  ok(r.duck.units === 2 && r.duck.capacityPerUnit === 6, 'le duckpin de Libramont : 2 pistes, 6 joueurs par piste', `units=${r.duck.units} cap=${r.duck.capacityPerUnit}`);
  ok(r.bil.units === 6 && r.bil.capacityPerUnit == null && r.bilGembloux.units === 6,
    'les billards de Libramont et de Gembloux : 6 tables (fungalaxy.be), aucune regle de joueurs par table', `libramont ${r.bil.units}/${r.bil.capacityPerUnit}, gembloux ${r.bilGembloux.units}`);
  ok(r.bil.priceValue === 10, 'MONTAGE le tarif de la base : 10 EUR par table et par heure', String(r.bil.priceValue));
  ok(r.bilRegle.units === 8 && r.duckRegle.units === 3 && r.duckRegle.capacityPerUnit === 5,
    'le reglage du centre prime sur le socle : 8 tables, 3 pistes de 5', `billards ${r.bilRegle.units}, duckpin ${r.duckRegle.units}x${r.duckRegle.capacityPerUnit}`);
  ok(r.bilGemblouxRegle.units === 6, 'CLOISONNEMENT le reglage de Libramont ne touche pas Gembloux', String(r.bilGemblouxRegle.units));

  section('B. LE MOTEUR');
  const ecartsDuck = [];
  DUCKPIN.forEach(([pax, duree, units, aLaFois, tours, minutes, prix], i) => {
    const it = r.duckpin[i];
    const lu = [it.units, it.laneCount, it.sessions || 1, it.minutes, it.price];
    if (JSON.stringify(lu) !== JSON.stringify([units, aLaFois, tours, minutes, prix]) || Boolean(it.rotation) !== (tours > 1)) {
      ecartsDuck.push(`${pax}p ${duree}h : ${JSON.stringify(lu)} au lieu de ${JSON.stringify([units, aLaFois, tours, minutes, prix])}`);
    }
  });
  ok(ecartsDuck.length === 0, `duckpin : pistes, tours, duree et prix pour ${DUCKPIN.length} groupes (18 joueurs = 3 pistes en 2 tours, 117 EUR)`, ecartsDuck.slice(0, 3).join(' ; '));
  const ecartsBil = [];
  BILLARDS.forEach(([pax, heures, demandees, tables, minutes, prix], i) => {
    const it = r.billards[i];
    const lu = [it.units, it.minutes, it.price];
    if (JSON.stringify(lu) !== JSON.stringify([tables, minutes, prix]) || it.hours !== heures || (it.sessions || 1) !== 1) {
      ecartsBil.push(`${pax}p ${heures}h ${demandees || '-'} : ${JSON.stringify(lu)} au lieu de ${JSON.stringify([tables, minutes, prix])}`);
    }
  });
  ok(ecartsBil.length === 0, `billards : les tables CHOISIES, 10 EUR par table et par heure, jamais de tour (${BILLARDS.length} cas : 3 tables x 2 h = 60 EUR)`, ecartsBil.slice(0, 3).join(' ; '));
  ok(r.septTables.erreur && r.septTables.erreur.code === 422 && r.septTables.erreur.message === 'Billards : 6 tables au plus.',
    '7 tables quand le centre en a 6 : refuse en 422, avec le compte du centre, jamais rabote', JSON.stringify(r.septTables.erreur || r.septTables.item));
  ok(!r.septTablesRegle.erreur && r.septTablesRegle.item.units === 7,
    'le centre reglé a 8 tables : les 7 passent', JSON.stringify(r.septTablesRegle.erreur || { units: r.septTablesRegle.item.units }));
  ok(r.duckpin16Regle.units === 4 && r.duckpin16Regle.laneCount === 3 && r.duckpin16Regle.sessions === 2,
    'le duckpin reglé a 3 pistes de 5 : 16 joueurs font 4 pistes, 3 a la fois, en 2 tours', JSON.stringify({ u: r.duckpin16Regle.units, lc: r.duckpin16Regle.laneCount, s: r.duckpin16Regle.sessions }));
}

// ---------------------------------------------------------------------------
// [C] UNE LIGNE ENREGISTREE SE RELIT A L IDENTIQUE
// ---------------------------------------------------------------------------
function verifierRelecture() {
  section('C. UNE LIGNE ENREGISTREE SE RELIT A L IDENTIQUE');
  catalogueProd();
  const { normalizeProgram } = require('../lib/visit-program');
  const { normalizeReservationPayload } = require('../lib/database');
  const ranger = (programme, pax) => normalizeReservationPayload({
    centerId: CENTRE, type: 'activite', date: JOUR, startTime: '14:00', duration: 1, pax, name: 'QA', phone: '+32491000000', email: 'qa@example.com', program: programme,
  }, {}).program;
  const garde = (l) => JSON.stringify({ units: l.units, sessions: l.sessions, minutes: l.minutes, price: l.price, hours: l.hours, duration: l.duration });
  const ecarts = [];
  let cas = 0;
  for (let pax = 1; pax <= 40; pax += 1) {
    const lignes = [
      ...[0.5, 1, 1.5, 2].map((duration) => ({ activityId: 'duckpin_bowling', duration })),
      ...[1, 2, 3].flatMap((hours) => [1, 3, 6].map((units) => ({ activityId: 'billards', hours, units }))),
    ];
    lignes.forEach((ligne) => {
      cas += 1;
      const avant = normalizeProgram([ligne], { centerId: CENTRE, pax, dateStr: JOUR });
      const relu = normalizeProgram(ranger(avant, pax).items, { centerId: CENTRE, pax, dateStr: JOUR });
      const deux = normalizeProgram(relu.items, { centerId: CENTRE, pax, dateStr: JOUR });
      if (garde(avant.items[0]) !== garde(relu.items[0]) || garde(relu.items[0]) !== garde(deux.items[0]) || avant.price !== deux.price) {
        ecarts.push(`${pax}p ${JSON.stringify(ligne)} ${garde(avant.items[0])} -> ${garde(relu.items[0])}`);
      }
    });
  }
  ok(ecarts.length === 0, `enregistree puis relue deux fois, une ligne garde pistes, tables, tours, duree et prix (${cas} cas, par le vrai filtre de la base)`, ecarts.slice(0, 2).join(' ; '));
  // Le chemin du serveur de bout en bout : la demande du formulaire, puis la
  // renormalisation de la reservation.
  const { normalizeReservationRequest, renormalizeVisitProgram } = require('../lib/reservation-request');
  const { getCenter } = require('../lib/ops-knowledge');
  const demande = normalizeReservationRequest({
    centerId: CENTRE, type: 'visite', date: JOUR, startTime: '14:00', pax: 18, name: 'QA', email: 'qa@example.com', phone: '+32491000000',
    program: [{ activityId: 'duckpin_bowling', duration: 1 }, { activityId: 'billards', hours: 2, units: 3 }],
  }, { channel: 'public' });
  const prixPar = () => JSON.stringify(Object.fromEntries(demande.program.items.map((l) => [l.activityId, l.price])));
  const avant = prixPar();
  renormalizeVisitProgram(demande, getCenter(CENTRE).resources.bowling, { channel: 'public' });
  const apres = prixPar();
  const attendu = JSON.stringify({ billards: 60, duckpin_bowling: 117 });
  ok(avant === attendu && apres === attendu,
    'reservation de 18 : duckpin 117 EUR, billards 3 tables x 2 h = 60 EUR, pareil apres la renormalisation du serveur', `${avant} puis ${apres}`);
}

// ---------------------------------------------------------------------------
// [D] LE COMPTOIR ET LE FORMULAIRE COMPTENT COMME LE SERVEUR
// ---------------------------------------------------------------------------
function chargerCoeur() {
  const source = fs.readFileSync(path.join(ROOT, 'assets/booking-core.js'), 'utf8');
  const bac = { window: {}, document: { addEventListener() {} }, console, fetch: () => Promise.resolve(), localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, setInterval, clearInterval };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(source, bac, { filename: 'booking-core.js' });
  return bac;
}
// Une fonction prise dans son fichier, par son texte (elle vit dans une
// fermeture ou dans un gros script de page). Vide = renommee : le gate le dit.
function fonctionDuFichier(fichier, nom, indentation = '') {
  const source = fs.readFileSync(path.join(ROOT, fichier), 'utf8').replace(/\r\n/g, '\n');
  const debut = source.indexOf(`\n${indentation}function ${nom}(`);
  if (debut === -1) return '';
  const fin = source.indexOf(`\n${indentation}}\n`, debut + 1);
  return fin === -1 ? '' : source.slice(debut + 1, fin + indentation.length + 3);
}

function verifierMiroirs() {
  section('D. LE COMPTOIR ET LE FORMULAIRE COMPTENT COMME LE SERVEUR');
  catalogueProd();
  const { listCenterActivities, activityUnitPlan } = require('../lib/activity-catalog');
  const { normalizeProgram } = require('../lib/visit-program');
  const catalogue = listCenterActivities(CENTRE);
  const duck = catalogue.find((a) => a.id === 'duckpin_bowling');
  const bil = catalogue.find((a) => a.id === 'billards');
  const coeur = chargerCoeur();
  const cle = (p) => JSON.stringify([p.units, p.atOnce, p.tours, p.lastTour]);
  const ecartsCoeur = [];
  for (let pax = 1; pax <= 80; pax += 1) {
    [[duck, [0]], [bil, [0, 1, 3, 6, 8]]].forEach(([a, demandes]) => {
      demandes.forEach((demandees) => {
        const serveur = activityUnitPlan(a, pax, { requested: demandees });
        const comptoir = typeof coeur.getActivityUnitPlan === 'function' ? coeur.getActivityUnitPlan(a, pax, demandees) : null;
        if (!comptoir || cle(serveur) !== cle(comptoir)) ecartsCoeur.push(`${a.id} ${pax}p/${demandees} : ${cle(serveur)} contre ${comptoir ? cle(comptoir) : 'ABSENT'}`);
      });
    });
  }
  ok(ecartsCoeur.length === 0, 'le comptoir (booking-core) compte pistes, tables et tours comme le serveur (80 groupes)', ecartsCoeur.slice(0, 2).join(' ; '));
  coeur.setCenterActivities(catalogue);
  const ecartsPrix = [];
  for (let pax = 1; pax <= 30; pax += 1) {
    [1, 2, 3].forEach((hours) => {
      [1, 2, 6].forEach((units) => {
        const serveur = normalizeProgram([{ activityId: 'billards', hours, units }], { centerId: CENTRE, pax, dateStr: JOUR }).items[0].price;
        const comptoir = coeur.getFreeActivityPrice(bil, { pax, hours, units, dateStr: JOUR });
        if (serveur !== comptoir) ecartsPrix.push(`${pax}p ${units}t ${hours}h : serveur ${serveur}, comptoir ${comptoir}`);
      });
    });
  }
  ok(ecartsPrix.length === 0, 'le prix des billards au comptoir est celui du serveur (30 groupes x 3 durees x 3 nombres de tables)', ecartsPrix.slice(0, 2).join(' ; '));

  const texte = fonctionDuFichier('assets/fungalaxy-booking.js', 'unitesPour', '  ');
  ok(texte.length > 0, 'MONTAGE le formulaire a sa fonction unitesPour');
  const ecartsForm = [];
  if (texte) {
    for (let pax = 1; pax <= 80; pax += 1) {
      const bac = { state: { pax, options: {} }, a: duck };
      vm.createContext(bac);
      const joueurs = fonctionDuFichier('assets/fungalaxy-booking.js', 'bornesJoueurs', '  ') + '\n' + fonctionDuFichier('assets/fungalaxy-booking.js', 'joueursDe', '  ');
      vm.runInContext(`${joueurs}\n${texte}\nvar resultat = unitesPour(a);`, bac, { filename: 'fungalaxy-booking.js:unitesPour' });
      const serveur = activityUnitPlan(duck, pax);
      if (cle(serveur) !== cle(bac.resultat || {})) ecartsForm.push(`${pax}p : ${cle(serveur)} contre ${cle(bac.resultat || {})}`);
    }
  }
  ok(texte && ecartsForm.length === 0, 'le formulaire Fun Galaxy compte les pistes et les tours du duckpin pareil (80 groupes)', ecartsForm.slice(0, 2).join(' ; '));
}

// ---------------------------------------------------------------------------
// [E] LA DISPONIBILITE PUBLIQUE
// ---------------------------------------------------------------------------
let dossiersDuJour = [];
function chargerDispo() {
  viderCache();
  const database = require('../lib/database');
  database.readAvailabilitySnapshot = async (date, centerId) => ({ reservations: dossiersDuJour, laneStatuses: {}, blocks: [], date, centerId });
  catalogueProd();
  return require('../api/public-availability');
}
async function appelDispo(handler, params) {
  const q = new URLSearchParams({ centerId: CENTRE, date: JOUR, ...params });
  const req = { method: 'GET', url: `/api/public-availability?${q.toString()}`, headers: { host: 'localhost', 'x-forwarded-for': '10.9.0.7' }, socket: { remoteAddress: '10.9.0.7' } };
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers || {}); };
  res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk); };
  await handler(req, res);
  try { return JSON.parse(res.body || '{}'); } catch (error) { return {}; }
}
// Un dossier deja pose ce jour-la, tel que la base le relit (mapReservation).
function dossier(id, { startTime, heures, pax, items }) {
  return {
    id, centerId: CENTRE, date: JOUR, startTime, duration: heures, totalDuration: heures, pax, status: 'confirmed',
    validationStatus: 'confirmed', type: 'activite', lanes: [], program: { items, price: 0, priceComplete: true }, opsPlan: null,
  };
}
const DUCK_12 = { activityId: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, duration: 1, minutes: 60, units: 2 };
const BIL_4 = { activityId: 'billards', name: 'Billards', planned: false, hours: 1, minutes: 60, units: 4 };

async function reglesDispo(handler) {
  const heures = (rep) => (Array.isArray(rep.slots) ? rep.slots : []).map((s) => s.time);
  const visite = (programme, pax) => ({ type: 'visite', pax: String(pax), program: JSON.stringify(programme), softReserve: '1' });
  const duckpin6 = [{ activityId: 'duckpin_bowling', duration: 1 }];
  const billards = (units) => [{ activityId: 'billards', hours: 1, units }];
  dossiersDuJour = [];
  const libre = heures(await appelDispo(handler, visite(duckpin6, 6)));
  dossiersDuJour = [dossier(9001, { startTime: '15:00', heures: 1, pax: 12, items: [DUCK_12] })];
  const pris = heures(await appelDispo(handler, visite(duckpin6, 6)));
  // Des pistes VRAIMENT prises toute la journee : un dossier qui JOUE 14 h de
  // duckpin. Un dossier de 14 h qui n en joue qu une heure ne les prend pas
  // (2026-09-30, le temoin `longue` juste apres).
  dossiersDuJour = [dossier(9002, { startTime: '10:00', heures: 14, pax: 12, items: [{ ...DUCK_12, duration: 14, minutes: 840 }] })];
  const journee = await appelDispo(handler, visite(duckpin6, 6));
  const avecBowling = await appelDispo(handler, visite([{ activityId: 'bowling', duration: 1 }, ...duckpin6], 6));
  dossiersDuJour = [dossier(9005, { startTime: '10:00', heures: 14, pax: 12, items: [DUCK_12] })];
  const longue = heures(await appelDispo(handler, visite(duckpin6, 6)));
  dossiersDuJour = [dossier(9003, { startTime: '15:00', heures: 1, pax: 8, items: [BIL_4] })];
  const deuxTables = heures(await appelDispo(handler, visite(billards(2), 4)));
  const troisTables = heures(await appelDispo(handler, visite(billards(3), 4)));
  const septTables = await appelDispo(handler, visite(billards(7), 4));
  // Le centre passe a 8 tables : 4 tables tiennent a 15:00 a cote des 4 prises.
  reglageCentre({ activityCapacity: { billards: { units: 8 } } });
  const quatreSurHuit = heures(await appelDispo(handler, visite(billards(4), 4)));
  reglageCentre(null);
  // LA GRILLE DES HEURES JUGE LES PISTES COMME LA VALIDATION (campagne du
  // 2026-09-29) : les 2 pistes de duckpin JOUEES de 10:00 a 14:00, une visite
  // bowling + duckpin ne tient qu a partir de 13:00 (duckpin a 14:00).
  dossiersDuJour = [dossier(9004, { startTime: '10:00', heures: 4, pax: 12, items: [{ ...DUCK_12, duration: 4, minutes: 240 }] })];
  const grille = await appelDispo(handler, visite([{ activityId: 'bowling', duration: 1 }, ...duckpin6], 6));
  dossiersDuJour = [];
  return { libre, pris, journee, avecBowling, longue, deuxTables, troisTables, septTables, quatreSurHuit, grille };
}

function verifierDispo(r) {
  section('E. LA DISPONIBILITE PUBLIQUE');
  const autour = (liste) => liste.filter((h) => h >= '13:30' && h <= '16:30').join(' ');
  ok(['14:00', '14:30', '15:00', '15:30', '16:00'].every((h) => r.libre.includes(h)), 'MONTAGE sans dossier, le duckpin est propose de 14:00 a 16:00', autour(r.libre));
  ok(!r.pris.includes('14:30') && !r.pris.includes('15:00') && !r.pris.includes('15:30'),
    'les 2 pistes prises de 15:00 a 16:00 : aucune heure qui les chevauche n est proposee', autour(r.pris));
  ok(r.pris.includes('14:00') && r.pris.includes('16:00'), 'les heures qui les touchent bout a bout restent (14:00, 16:00)', autour(r.pris));
  ok(Array.isArray(r.journee.slots) && r.journee.slots.length === 0 && r.journee.message === 'Duckpin Bowling : complet ce jour-là. Essayez une autre date.',
    'pistes prises toute la journee : aucune heure, et le message nomme le duckpin', `${(r.journee.slots || []).length} heure(s) « ${r.journee.message} »`);
  ok(Array.isArray(r.avecBowling.slots) && r.avecBowling.slots.length === 0 && /^Duckpin Bowling : complet/.test(r.avecBowling.message || ''),
    'bowling + duckpin le meme jour : plus de creneau vendu pour rien, le message nomme le duckpin', `${(r.avecBowling.slots || []).length} creneau(x) « ${r.avecBowling.message} »`);
  // UN DOSSIER LONG NE TIENT SES PISTES QUE LE TEMPS DE LES JOUER (2026-09-30).
  // 14 h de visite, 1 h de duckpin : il la joue avant ou apres, les autres
  // groupes gardent toutes leurs heures. L ancienne regle n en laissait aucune.
  ok(['10:00', '14:00', '15:00', '18:00'].every((h) => r.longue.includes(h)),
    'un dossier de 14 h qui joue 1 h de duckpin laisse les heures du jour aux autres groupes', `${r.longue.length} heure(s) : ${r.longue.slice(0, 6).join(' ')}`);
  const grilleBowling = ((r.grille.anchors && r.grille.anchors.activities) || []).find((a) => a.activityId === 'bowling') || { times: [] };
  const aLHeure = (t) => grilleBowling.times.find((x) => x.time === t) || {};
  const fermees = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30'].map(aLHeure);
  ok(fermees.every((x) => x.ok === false && x.reason === 'Duckpin Bowling complet') && aLHeure('13:00').ok !== false,
    'la grille des heures juge les pistes de duckpin comme la validation : 10:00 a 12:30 se refusent en le disant, 13:00 tient',
    fermees.map((x) => `${x.time} ${x.ok === false ? x.reason : 'ok'}`).concat([`13:00 ${aLHeure('13:00').ok === false ? aLHeure('13:00').reason : 'ok'}`]).join(' | '));
  const proposee = (r.grille.slots || [])[0] || null;
  ok(Boolean(proposee) && proposee.time === '13:00' && !r.grille.message,
    'l heure proposee d office est la premiere qui tient (13:00), jamais une heure que la validation refuserait', `${proposee ? proposee.time : 'aucune'} « ${r.grille.message || ''} »`);
  ok(r.deuxTables.includes('15:00') && !r.troisTables.includes('15:00') && r.troisTables.includes('16:00'),
    '4 tables prises a 15:00 sur 6 : 2 tables y tiennent, 3 non (16:00 si)', `2 tables : ${autour(r.deuxTables)} | 3 tables : ${autour(r.troisTables)}`);
  // Un refus d option repond sans liste d heures (422), avec sa raison.
  ok(!(Array.isArray(r.septTables.slots) && r.septTables.slots.length) && r.septTables.message === 'Billards : 6 tables au plus.',
    '7 tables demandees a un centre qui en a 6 : aucune heure, et la raison', `« ${r.septTables.message} »`);
  ok(r.quatreSurHuit.includes('15:00'), 'le centre reglé a 8 tables : 4 de plus tiennent a 15:00, sans deploiement', autour(r.quatreSurHuit));
}

// ---------------------------------------------------------------------------
// [F] LE FORMULAIRE FUN GALAXY
// ---------------------------------------------------------------------------
async function versActivites(page, mock, pax) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  const [y, mo] = mock.DATE.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, mock.DATE);
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, pax);
  await page.click('#goActivities');
  return attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
}
async function lireTiroir(page, id) {
  await page.click('#gridAct li[data-activity="' + id + '"] [data-activity-info]');
  const information = await page.locator('.fg-info-text').textContent();
  await page.keyboard.press('Escape');
  const result = await page.evaluate((activityId) => {
    const item = document.querySelector(`#gridAct .fg-grid__item[data-activity="${activityId}"]`);
    if (!item) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    const groupe = (cle) => [...item.querySelectorAll(`.fg-pill[data-cle="${cle}"]`)].map((p) => ({ label: txt(p.querySelector('b')), petit: txt(p.querySelector('small')), on: p.classList.contains('is-on') }));
    const compteur = item.querySelector('[data-compteur="units"]');
    return {
      titres: [txt(item.querySelector('[data-compteur="units"]') && item.querySelector('[data-compteur="units"]').previousElementSibling).replace(/\d+ au plus$/, '').trim(), ...[...item.querySelectorAll('.fg-card__optlabel')].map(txt)].filter(Boolean),
      tables: groupe('units'),
      compteur: compteur ? {
        n: txt(compteur.querySelector('.fg-kids__n')),
        moinsOff: compteur.querySelector('[data-pas="-1"]').disabled,
        plusOff: compteur.querySelector('[data-pas="1"]').disabled,
        texte: txt(compteur.previousElementSibling.querySelector('small')),
      } : null,
      heures: groupe('hours'),
      durees: groupe('duration'),
      note: txt(item.querySelector('.fg-card__rot')),
      prix: txt(item.querySelector('.fg-card__price')),
    };
  }, id);
  // Le bref de la carte dit les tables/durees. La capacite detaillee vit dans
  // la popup, sous un titre : lire la ligne seule conserve l'oracle exact.
  result.brief = result.note;
  result.information = information;
  result.note = information.split('\n').find(text => /joueurs max par/.test(text)) || '';
  return result;
}

const MUTATION_TUNNEL = ["      if (a.priceType === 'per_unit_hour') { var billard = reglageBillard(a); ligne.units = billard.units; ligne.hours = billard.hours; }", ''];
// La console sans les installations dans ce qu elle envoie : servie mutee en
// memoire, le depot n est jamais touche.
const MUTATION_CONSOLE = ['    activityCapacity,\n', ''];
let tunnelCasse = false;
let consoleCassee = false;
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (tunnelCasse && url.pathname === '/assets/fungalaxy-booking.js') {
      const src = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(MUTATION_TUNNEL[0], MUTATION_TUNNEL[1]));
      return;
    }
    if (consoleCassee && url.pathname === '/assets/app-main.js') {
      const src = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(MUTATION_CONSOLE[0], MUTATION_CONSOLE[1]));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function parcoursFormulaire(browser, mock, pax, { changerLeCentre = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  const demandes = [];
  page.on('pageerror', (e) => erreurs.push(String((e && e.message) || e)));
  page.on('request', (req) => { if (req.url().includes('/api/public-availability') && req.url().includes('type=visite')) demandes.push(req.url()); });
  const sortie = { erreurs };
  sortie.arrive = await versActivites(page, mock, pax);
  await page.click('#gridAct .fg-card[data-activity="billards"]');
  await page.waitForTimeout(300);
  sortie.billards = await lireTiroir(page, 'billards');
  // LES TABLES AU COMPTEUR (Movsar, 2026-09-30) : deux « + » font trois tables.
  const plusTable = '#gridAct .fg-grid__item[data-activity="billards"] [data-compteur="units"] [data-pas="1"]';
  const moinsTable = '#gridAct .fg-grid__item[data-activity="billards"] [data-compteur="units"] [data-pas="-1"]';
  for (let k = 0; k < 2; k += 1) await page.click(plusTable).catch(() => {});
  await page.waitForTimeout(150);
  sortie.troisTables = await lireTiroir(page, 'billards');
  // Le plafond : quatre « + » de plus s arretent a 5 (un bouton desactive ne
  // fait rien), puis deux « - » ramenent a 3.
  await page.evaluate((sel) => { for (let k = 0; k < 4; k += 1) document.querySelector(sel).click(); }, plusTable);
  await page.waitForTimeout(150);
  sortie.plafond = await lireTiroir(page, 'billards');
  for (let k = 0; k < 2; k += 1) await page.click(moinsTable).catch(() => {});
  await page.waitForTimeout(150);
  await page.click('#gridAct .fg-grid__item[data-activity="billards"] .fg-pill[data-cle="hours"][data-valeur="2"]').catch(() => {});
  await page.waitForTimeout(150);
  sortie.deuxHeures = await lireTiroir(page, 'billards');
  await page.click('#gridAct .fg-card[data-activity="duckpin_bowling"]');
  await page.waitForTimeout(300);
  sortie.duckpin = await lireTiroir(page, 'duckpin_bowling');
  if (changerLeCentre) {
    // Le centre passe a 2 tables dans la console (sous le plafond de 5) : la
    // meta du mock le sert, et le formulaire DEJA OUVERT doit le voir sans
    // rechargement ; revenu a 6, le plafond de 5 reprend.
    const billards = mock.ACTIVITIES.find((a) => a.id === 'billards');
    const avant = billards.units;
    billards.units = 2;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    sortie.deuxVu = await attendre(page, () => { const c = document.querySelector('#gridAct .fg-grid__item[data-activity="billards"] [data-compteur="units"]'); const t = c && c.previousElementSibling.querySelector('small'); return Boolean(t) && t.textContent.trim() === '2 au plus'; }, 5000);
    sortie.apresChangement = await lireTiroir(page, 'billards');
    billards.units = avant;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    sortie.cinqRevu = await attendre(page, () => { const c = document.querySelector('#gridAct .fg-grid__item[data-activity="billards"] [data-compteur="units"]'); const t = c && c.previousElementSibling.querySelector('small'); return Boolean(t) && t.textContent.trim() === '5 au plus'; }, 5000);
  }
  await page.click('#goHours');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 6000);
  await page.waitForTimeout(800);
  const derniere = demandes[demandes.length - 1];
  sortie.programme = null;
  if (derniere) {
    try { sortie.programme = JSON.parse(new URL(derniere).searchParams.get('program')); } catch (error) { sortie.programme = null; }
  }
  await ctx.close();
  return sortie;
}

function verifierFormulaire(p25, p8) {
  section('F. LE FORMULAIRE FUN GALAXY');
  ok(p25.arrive && p25.billards, 'MONTAGE le formulaire arrive aux activites, avec la carte des billards');
  const b = p25.billards || { titres: [], tables: [], heures: [] };
  ok(JSON.stringify(b.titres) === JSON.stringify(['Tables', 'Durée']), 'les billards ont deux reglages : les tables, puis la duree', b.titres.join(' | '));
  const c = b.compteur || {};
  ok(b.tables.length === 0 && c.n === '1' && c.moinsOff === true && c.plusOff === false && c.texte === '5 au plus',
    'les tables se comptent (plus de pastilles) : 1 par defaut, « - » eteint, 5 au plus (le plafond, sous les 6 du centre)', JSON.stringify({ pastilles: b.tables.length, ...c }));
  const pl = (p25.plafond || {}).compteur || {};
  ok(pl.n === '5' && pl.plusOff === true && pl.moinsOff === false, 'quatre « + » de plus s arretent a 5 tables, « + » eteint', JSON.stringify(pl));
  ok(JSON.stringify(b.heures.map((x) => x.label)) === JSON.stringify(['1 heure', '2 heures', '3 heures']) && JSON.stringify(b.heures.map((x) => x.petit)) === JSON.stringify(['10 €', '20 €', '30 €']),
    'les heures (le pas du catalogue) disent le prix pour une table : 10, 20, 30 EUR', b.heures.map((x) => `${x.label} ${x.petit}`).join(' | '));
  const t3 = p25.troisTables || { heures: [] };
  ok(JSON.stringify(t3.heures.map((x) => x.petit)) === JSON.stringify(['30 €', '60 €', '90 €']), 'trois tables choisies : chaque duree dit ce que la ligne coute (30, 60, 90 EUR)', t3.heures.map((x) => x.petit).join(' | '));
  const h2 = p25.deuxHeures || {};
  ok(h2.prix === '60 € · 3 tables, 2 heures', 'deux heures : la carte dit le montant de la ligne et ce qu il paie', `« ${h2.prix} »`);
  ok([p25.billards, p8.billards].every(item => item && !/(?:joueurs?|personnes?)\s+(?:max\s+)?par\s+table/i.test(`${item.information}\n${item.brief}`)),
    'aucune phrase de joueurs par table pour les billards (Movsar : pas besoin)');
  // COURT, le maximum puis le calcul (Movsar, 2026-10-01 : « faut dire
  // joueurs max par piste, explique bien », puis « t abuses sur la
  // description du duckpin »).
  ok((p25.duckpin || {}).note === '6 joueurs max par piste : 5 pistes × 39 € = 195 €, en 3 tours de 1 h.',
    'le duckpin a 25 joueurs : le maximum par piste, 5 pistes et leur prix, 3 tours', `« ${(p25.duckpin || {}).note} »`);
  ok((p8.duckpin || {}).note === '6 joueurs max par piste : 2 pistes × 39 € = 78 €.', 'le duckpin a 8 joueurs : le maximum par piste, deux pistes et leur prix, pas de tour', `« ${(p8.duckpin || {}).note} »`);
  const ligne = (p25.programme || []).find((l) => l && l.activityId === 'billards') || null;
  ok(ligne && Number(ligne.units) === 3 && Number(ligne.hours) === 2, 'la demande de disponibilite porte les 3 tables et les 2 heures choisies', JSON.stringify(ligne));
  ok(p8.deuxVu === true && ((p8.apresChangement || {}).compteur || {}).n === '2' && p8.cinqRevu === true,
    'le centre passe a 2 tables : le compteur deja ouvert s arrete a 2 sans recharger (le choix de 3 redescend a 2), puis 5 a nouveau', `2 vu=${p8.deuxVu}, compteur ${JSON.stringify((p8.apresChangement || {}).compteur)}, 5 revu=${p8.cinqRevu}`);
  ok(p25.erreurs.length === 0 && p8.erreurs.length === 0, 'aucune erreur JavaScript', p25.erreurs.concat(p8.erreurs).slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------------------
// [G] LA CONSOLE
// ---------------------------------------------------------------------------
function verifierConsole() {
  section('G. LA CONSOLE');
  catalogueProd();
  const { listCenterActivities } = require('../lib/activity-catalog');
  const { normalizeProgram } = require('../lib/visit-program');
  const coeur = chargerCoeur();
  coeur.setCenterActivities(listCenterActivities(CENTRE));
  const noms = ['bowlingCapacityMessage', 'participantsLigneProgramme', 'activityCountsChildren', 'catalogueDeLigne', 'ligneALaJournee', 'detailLigneProgramme', 'detailLigneProgrammeSansEffectif', 'detailUnitesLigne'];
  const textes = noms.map((nom) => fonctionDuFichier('assets/app-main.js', nom));
  if (!ok(textes.every(Boolean), 'MONTAGE les fonctions de la fiche se trouvent dans app-main', noms.filter((n, i) => !textes[i]).join(', '))) return;
  vm.runInContext(textes.join('\n'), coeur, { filename: 'app-main.js:fiche' });
  const ligne = (programme, pax) => {
    const it = normalizeProgram([programme], { centerId: CENTRE, pax, dateStr: JOUR }).items[0];
    return coeur.detailLigneProgramme(it, { pax, program: { items: [it] } });
  };
  const cas = [
    [{ activityId: 'duckpin_bowling', duration: 1 }, 6, '6 joueurs · 1 piste · 1h'],
    [{ activityId: 'duckpin_bowling', duration: 1 }, 12, '12 joueurs · 2 pistes · 1h'],
    [{ activityId: 'duckpin_bowling', duration: 1 }, 18, '18 joueurs · 3 pistes · 2 tours de 1h'],
    [{ activityId: 'duckpin_bowling', duration: 1, participants: 6 }, 18, '6 joueurs · 1 piste · 1h'],
    [{ activityId: 'billards', hours: 1 }, 4, '4 joueurs · 1 table · 1h'],
    [{ activityId: 'billards', hours: 2, units: 3 }, 8, '8 joueurs · 3 tables · 2h'],
  ];
  const ecarts = cas.map(([p, pax, attendu]) => [ligne(p, pax), attendu, pax, p.activityId]).filter(([lu, attendu]) => lu !== attendu);
  ok(ecarts.length === 0, 'la fiche dit les pistes, les tables et les tours (duckpin 18 : « 3 pistes · 2 tours de 1h »)', ecarts.map(([lu, a, pax, id]) => `${id} ${pax}p « ${lu} » au lieu de « ${a} »`).join(' ; '));
  // La ligne de duckpin enregistree AVANT que la base ne garde ses pistes
  // (dossier 1380 en prod, 79 joueurs, 60 min, 78 EUR) : elle dit ce qui a ete
  // chiffre, 2 pistes d un passage.
  const ancienne = coeur.detailLigneProgramme({ activityId: 'duckpin_bowling', name: 'Duckpin Bowling', planned: false, duration: 1, minutes: 60, price: 78, priceKnown: true }, { pax: 79 });
  ok(ancienne === '79 joueurs · 2 pistes · 1h', 'une ligne de duckpin d avant ce lot dit ce qui a ete chiffre (2 pistes, 78 EUR), pas 14 pistes', `« ${ancienne} »`);

  // La page Etablissement : ce qu elle envoie, le serveur le garde et le relit.
  const { normalizeCenterConfig } = require('../lib/center-config');
  const config = normalizeCenterConfig({ activityCapacity: { billards: { units: 8 }, duckpin_bowling: { units: 3, capacityPerUnit: 5 }, 'x y': { units: 2 }, fun_run: { units: 0 } } }, CENTRE);
  ok(JSON.stringify(config.activityCapacity) === JSON.stringify({ billards: { units: 8 }, duckpin_bowling: { units: 3, capacityPerUnit: 5 } }),
    'la config du centre garde les installations lisibles et jette le reste (id illisible, zero)', JSON.stringify(config.activityCapacity));
  const relue = normalizeCenterConfig(config, CENTRE);
  ok(JSON.stringify(relue.activityCapacity) === JSON.stringify(config.activityCapacity), 'relue, elle ne bouge pas');
}

// ---------------------------------------------------------------------------
// [I] LA PAGE ETABLISSEMENT, DANS LA VRAIE CONSOLE
// ---------------------------------------------------------------------------
// Le gerant regle ses installations dans Etablissement. La page montre ce que
// le centre a regle (8 tables ici, quand le socle en dit 6), refuse une saisie
// hors bornes SANS RIEN ENVOYER, et envoie ce qui est saisi dans la config du
// centre ; relue par le serveur, cette config change le catalogue du centre.
// La liste des activites est celle que sert /api/ops (activitesDuSocle), pas
// une copie ecrite ici.
function configEtablissement() {
  const { toEditableConfig } = require('../lib/center-config');
  const { activitesDuSocle } = require('../api/ops').__test;
  const { loadOpsKnowledge } = require('../lib/ops-knowledge');
  const baseline = require('../ops-knowledge/centers.json');
  return {
    ok: true,
    centers: (baseline.centers || []).map((centre) => ({
      id: centre.id, name: centre.name, clientId: 'fungalaxy', clientName: 'Fun Galaxy',
      ...toEditableConfig(centre),
      ...(centre.id === CENTRE ? { activityCapacity: { billards: { units: 8 } } } : {}),
    })),
    activities: activitesDuSocle(loadOpsKnowledge()),
  };
}

async function pageEtablissement(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, CONFIG, CENTRE }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
    const session = { token: 'qa', cookieBacked: false, centerId: CENTRE, expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // Un serveur ne change pas d etag quand rien n a bouge : sinon la console
    // re-rend a chaque sondage et efface la saisie en cours.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const natif = window.fetch.bind(window);
    window.__ENVOIS__ = [];
    window.fetch = async (input, init = {}) => {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || '', window.location.origin);
      const methode = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: CENTRE });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: CENTRE });
      if (u.pathname === '/api/ops' && methode === 'POST') { window.__ENVOIS__.push(JSON.parse(init.body || '{}')); return J({ ok: true }); }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(CONFIG);
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return natif(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(session));
  }, { expiresAt, CONFIG: configEtablissement(), CENTRE });
  try {
    await page.goto(`${BASE_URL}/?v=tours-etablissement`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.submitCenterConfig === 'function', null, { timeout: 20000 });
    await page.evaluate((jour) => {
      state.currentDate = jour;
      state.staffMenuPage = 'establishment';
      state.establishmentTab = 'offres';
      state.establishmentEditing = false;
      save();
      setView('staff');
    }, JOUR);
    await page.waitForSelector('.estab-tabs button', { state: 'visible', timeout: 20000 });
    await page.evaluate(() => setEstablishmentTab('offres'));
    const lecture = await page.evaluate(() => Array.from(document.querySelectorAll('#estabPanel-offres .estab-tag')).map((t) => t.textContent.trim()));
    await page.evaluate(() => { startEstablishmentEdit(); setEstablishmentTab('offres'); });
    await page.waitForSelector('#estab-cap-units-billards', { state: 'attached', timeout: 10000 });
    const champs = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.establishment-editor .estab-cap-input')).map((i) => [i.id, i.value])));
    const refus = await page.evaluate(async (centre) => {
      const champ = document.getElementById('estab-cap-units-billards');
      champ.value = '0';
      window.__ENVOIS__ = [];
      await submitCenterConfig(centre);
      const note = champ.closest('.field') && champ.closest('.field').querySelector('[role="alert"]');
      return { envois: window.__ENVOIS__.length, invalide: champ.getAttribute('aria-invalid'), message: note ? note.textContent : '' };
    }, CENTRE);
    const envoye = await page.evaluate(async (centre) => {
      document.getElementById('estab-cap-units-billards').value = '7';
      document.getElementById('estab-cap-units-duckpin_bowling').value = '3';
      document.getElementById('estab-cap-players-duckpin_bowling').value = '5';
      window.__ENVOIS__ = [];
      await submitCenterConfig(centre);
      const corps = window.__ENVOIS__.find((b) => b.action === 'saveCenterConfig');
      return corps ? corps.config : null;
    }, CENTRE);
    return { lecture, champs, refus, envoye, erreurs };
  } finally {
    await ctx.close();
  }
}

function verifierEtablissement(r) {
  section('I. LA PAGE ETABLISSEMENT');
  ok(r.erreurs.length === 0, 'MONTAGE la console s ouvre sans erreur', r.erreurs.join(' | '));
  ok(r.lecture.includes('Billards · 8 tables') && r.lecture.includes('Duckpin Bowling · 2 pistes, 6 joueurs par piste'),
    'en lecture, la page dit les installations du centre (8 tables reglees, 2 pistes de 6 du socle)', r.lecture.join(' | '));
  ok(r.champs['estab-cap-units-billards'] === '8' && r.champs['estab-cap-units-duckpin_bowling'] === '2' && r.champs['estab-cap-players-duckpin_bowling'] === '6',
    'en edition, les champs partent de ce que le centre a regle', JSON.stringify(r.champs));
  ok(r.refus.envois === 0 && r.refus.invalide === 'true' && /Billards/.test(r.refus.message) && /\b50\b/.test(r.refus.message),
    'zero table est refuse sous le champ, avec sa raison, et rien ne part', JSON.stringify(r.refus));
  const capa = r.envoye && r.envoye.activityCapacity;
  ok(Boolean(capa && capa.billards && capa.duckpin_bowling) && capa.billards.units === 7 && capa.duckpin_bowling.units === 3 && capa.duckpin_bowling.capacityPerUnit === 5,
    'la saisie part dans la config du centre (7 tables, 3 pistes de 5)', JSON.stringify(capa || null));
  if (!capa) return;
  // Ce qui part, le serveur le garde, et le catalogue du centre le suit.
  const { normalizeCenterConfig } = require('../lib/center-config');
  const gardee = normalizeCenterConfig({ activityCapacity: capa }, CENTRE).activityCapacity;
  catalogueProd();
  reglageCentre({ activityCapacity: gardee });
  const vendues = require('../lib/activity-catalog').listCenterActivities(CENTRE);
  const bil = vendues.find((a) => a.id === 'billards') || {};
  const duck = vendues.find((a) => a.id === 'duckpin_bowling') || {};
  reglageCentre(null);
  ok(bil.units === 7 && duck.units === 3 && duck.capacityPerUnit === 5,
    'relue par le serveur, la saisie devient le catalogue du centre (7 tables, 3 pistes de 5)', `billards ${bil.units}, duckpin ${duck.units} x ${duck.capacityPerUnit}`);
}

// ---------------------------------------------------------------------------
// [H] CONTRE-EPREUVES
// ---------------------------------------------------------------------------
async function contreEpreuves(browser, mock) {
  section('H. CONTRE-EPREUVES');
  const srcTunnel = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
  if (ok(srcTunnel.split(MUTATION_TUNNEL[0]).length === 2, 'contre-epreuve montable : les tables et les heures des billards partent une seule fois du formulaire')) {
    tunnelCasse = true;
    const casse = await parcoursFormulaire(browser, mock, 25);
    tunnelCasse = false;
    const ligne = (casse.programme || []).find((l) => l && l.activityId === 'billards') || {};
    ok(ligne.units === undefined && ligne.hours === undefined, 'sans elles, la demande part sans tables ni heures : ce gate ROUGIRAIT', JSON.stringify(ligne));
  }
  const srcConsole = fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8').replace(/\r\n/g, '\n');
  if (ok(srcConsole.split(MUTATION_CONSOLE[0]).length === 2, 'contre-epreuve montable : les installations partent une seule fois de la page Etablissement')) {
    consoleCassee = true;
    const cassee = await pageEtablissement(browser);
    consoleCassee = false;
    ok(Boolean(cassee.envoye) && cassee.envoye.activityCapacity === undefined,
      'sans elles, la config part sans les installations : ce gate ROUGIRAIT', JSON.stringify((cassee.envoye && cassee.envoye.activityCapacity) || null));
  }

  const MUTATIONS = [
    {
      fichier: 'lib/activity-catalog.js',
      ancre: 'units: unitesDuCentre != null ? unitesDuCentre : (booking.units == null ? null : Number(booking.units)),',
      mute: 'units: booking.units == null ? null : Number(booking.units),',
      label: 'sans le reglage du centre, ses 8 tables restent 6',
      rouge: async () => { const r = reglesServeur(); return r.bilRegle.units === 6; },
    },
    {
      fichier: 'lib/visit-program.js',
      ancre: 'item.minutes = Math.round(item.duration * 60) * plan.tours;',
      mute: 'item.minutes = Math.round(item.duration * 60);',
      label: 'sans les tours dans la duree, 18 joueurs au duckpin ne durent qu une heure',
      rouge: async () => { const r = reglesServeur(); return r.duckpin[5].minutes === 60; },
    },
    {
      fichier: 'lib/visit-program.js',
      ancre: 'if (dotation > 0 && demandees > dotation) {',
      mute: 'if (false) {',
      label: 'sans le refus, 7 tables se vendent a un centre qui en a 6',
      rouge: async () => { const r = reglesServeur(); return !r.septTables.erreur; },
    },
    {
      fichier: 'lib/reservation-ops.js',
      ancre: 'const enregistrees = Math.trunc(Number(item && item.units) || 0);',
      mute: 'const enregistrees = 0;',
      label: 'sans les tables enregistrees, un dossier de 8 personnes tient les 6 tables',
      rouge: async () => { const r = await reglesDispo(chargerDispo()); return !r.deuxTables.includes('15:00'); },
    },
    {
      fichier: 'api/public-availability.js',
      ancre: 'const complete = dotationDuCreneau(slot, finDeVisiteMinutes(slot));',
      mute: 'const complete = \'\';',
      label: 'sans le filtre de la disponibilite, 15:00 est propose sur des pistes prises',
      rouge: async () => { const r = await reglesDispo(chargerDispo()); return r.pris.includes('15:00'); },
    },
    {
      fichier: 'api/public-availability.js',
      ancre: '            gardeDeVisite: gardeDesInstallations,',
      mute: '',
      label: 'sans la garde dans la grille des heures, 11:00 se dit libre sur des pistes prises et 10:00 est propose d office',
      rouge: async () => {
        const r = await reglesDispo(chargerDispo());
        const b = ((r.grille.anchors && r.grille.anchors.activities) || []).find((a) => a.activityId === 'bowling') || { times: [] };
        const onze = b.times.find((x) => x.time === '11:00') || {};
        return onze.ok !== false || ((r.grille.slots || [])[0] || {}).time !== '13:00';
      },
    },
  ];
  for (const m of MUTATIONS) {
    const chemin = path.join(ROOT, m.fichier);
    const original = fs.readFileSync(chemin, 'utf8');
    const ancre = original.indexOf('\r\n') >= 0 ? m.ancre : m.ancre.replace(/\r\n/g, '\n');
    const compte = original.split(ancre).length - 1;
    if (!ok(compte === 1, `contre-epreuve montable : « ${ancre.replace(/\s+/g, ' ').slice(0, 50)}… » une seule fois dans ${m.fichier}`, `${compte} occurrence(s)`)) continue;
    let rouge = false;
    try {
      fs.writeFileSync(chemin, original.split(ancre).join(m.mute));
      viderCache();
      rouge = await m.rouge();
    } catch (error) {
      rouge = true; // le code mute jette : c est aussi un rouge
    } finally {
      fs.writeFileSync(chemin, original);
      viderCache();
    }
    ok(rouge, `${m.label} : ce gate ROUGIRAIT`);
    ok(fs.readFileSync(chemin, 'utf8') === original, `${m.fichier} restaure a l identique`);
  }
  const apres = reglesServeur();
  const dispoApres = await reglesDispo(chargerDispo());
  ok(apres.bilRegle.units === 8 && apres.duckpin[5].minutes === 120 && Boolean(apres.septTables.erreur) && dispoApres.deuxTables.includes('15:00') && !dispoApres.pris.includes('15:00'),
    'code restaure : les regles redisent la verite');
}

async function main() {
  // La disponibilite AVANT le mock du formulaire : c est elle qui lit les
  // dossiers du jour que ce gate pose.
  const handler = chargerDispo();
  verifierServeur(reglesServeur());
  verifierRelecture();
  verifierMiroirs();
  verifierDispo(await reglesDispo(handler));
  verifierConsole();

  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const p25 = await parcoursFormulaire(browser, mock, 25);
    const p8 = await parcoursFormulaire(browser, mock, 8, { changerLeCentre: true });
    verifierFormulaire(p25, p8);
    verifierEtablissement(await pageEtablissement(browser));
    await contreEpreuves(browser, mock);
  } finally {
    await browser.close();
    srv.close();
  }

  console.log(`\n${echecs === 0 ? 'tours-dotation-check: ALL OK' : `tours-dotation-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
