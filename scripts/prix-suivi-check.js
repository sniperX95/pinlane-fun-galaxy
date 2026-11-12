// LE PRIX QUI SUIT UNE MODIFICATION (2026-11-03, lot droits et sur mesure).
//
// Le risque, mesure : dans Modifier, le staff change le contenu d un dossier
// (joueurs, parties, duree, une activite) sans taper de prix. La console
// envoyait son estimation (getEditPrixEstime) avec la raison « Prix revu au
// comptoir », et le serveur la jugeait contre SA base (baseDuServeur, le vrai
// moteur). Une activite que la console chiffre et pas le serveur (le minigolf
// du socle, sans tarif) : 258 EUR contre 168 pour une visite de 9, et un role
// a 5 % refuse sans avoir touche a un prix. Depuis, un prix qui suit le
// contenu ne part pas, sa raison non plus : le serveur le pose sur sa
// reference, l ajustement deja en place garde (prixQuiSuit,
// lib/droits-reservation.js).
//
// La console reelle (scripts/planning-v3-fixtures.js, le samedi « pic » a
// 15:10) ; ses PATCH partent au VRAI handler api/staff-reservations.js, au vrai
// moteur et a la vraie lib/database.js, sur la base en memoire de reserver-banc
// ou la journee de la fixture est semee. Le serveur juge avec un role a 5 %.
//   [S] le meme catalogue des deux cotes, un contenu change sans prix tape (un
//       bowling seul, un laser seul, une visite a programme, la meme avec une
//       partie de laser en plus pour une partie du groupe, une formule a la
//       personne, une formule sur pistes, une formule adaptee) : l estimation
//       de la console tombe sur la base du moteur plus les extras, au centime ;
//       le PATCH ne porte ni prix ni raison ; le serveur ecrit le prix que le
//       champ annonce ; le role a 5 % passe, sans note de prix ;
//   [D] la console chiffre une activite que le serveur ne chiffre pas : le
//       serveur pose SA base plus les extras, le role a 5 % passe, sans note ;
//   [A] l ajustement en place se garde : un prix d ami (10 EUR de moins) dont
//       le bowling passe a 2 h, le champ annonce le nouveau tarif moins 10 et
//       le dit, le serveur ecrit le meme ; une visite offerte qui perd un
//       joueur reste a 0 EUR, sans refus ni note ;
//   [T] un prix tape garde son chemin : il part avec sa raison, le serveur le
//       juge (dans les 5 %, il passe et se trace ; au-dela, refus, rien
//       d ecrit) ;
//   [J] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi, ou compilee en
// memoire cote serveur ; le disque n est jamais touche) fait rougir sa lettre.
//   PS_MUTATIONS : un sous-ensemble ; PS_BAVARD : les lignes des contre-preuves.
// Zero reseau, zero base reelle, rien ne part.
// Lancement : node scripts/prix-suivi-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PRIX_SUIVI_PORT || 5221);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_RESA = '/api/staff-reservations';
const JS = 'assets/app-main.js';
const API = 'api/staff-reservations.js';
const DROITS = 'lib/droits-reservation.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

let echecs = 0;
let silence = false;
const rouges = [];
// La contre-preuve en cours a mordu des que sa lettre rougit : la suite de ses
// scenarios n apporterait plus rien.
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation).
// ---------------------------------------------------------------------------
const FIXTURE = FX.lireFixture('pic');
function ligneDepuis(r) {
  return {
    id: r.id, center_id: r.centerId || 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '',
    date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration, lanes: (r.lanes || []).map(Number),
    pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label,
    occasion: r.occasion || '', extras: r.extras || [], payment_method: r.paymentMethod || null, notes: r.notes || '',
    ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0,
    created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt),
    acquisition: r.acquisition ?? null, client_key: r.clientKey || '', paid_at: r.paidAt ? new Date(r.paidAt) : null,
    amount_paid: r.amountPaid ?? null, discount_reason: r.discountReason || '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
  };
}
const centimes = (v) => Math.round((Number(v) || 0) * 100);
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const extras = (typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras) || [];
  const notes = String(row.notes || '').split('\n').filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return null; } }).filter(Boolean);
  return { pax: Number(row.pax), price: Number(row.price), basePrice: Number(row.base_price), extras: extras.reduce((s, x) => s + (Number(x.price) || 0), 0), notesPrix: notes.filter((n) => n.type === 'prix'), label: row.label };
}

// Le role juge par le serveur : modifier, ajuster un prix de 5 % au plus.
const CINQ = {
  centerId: 'libramont',
  member: { id: 'm-cinq', name: 'Rachel' },
  role: { id: 'cinq-pourcent', locked: false },
  permissions: ['reservations.view', 'reservations.quick', 'reservations.create', 'reservations.edit', 'reservations.status',
    'niveau:surmesure:libre', 'niveau:prix:5', 'niveau:formule:oui', 'niveau:forcer:oui', 'niveau:historique:oui'],
};

// ---------------------------------------------------------------------------
// LE CATALOGUE. En production, la console lit celui du serveur ; la fixture
// porte celui de la production (son meta), le banc n a que le socle du depot
// (le minigolf y est sans tarif). [S], [A] et [T] posent les tarifs du meta sur
// le catalogue en memoire du serveur, comme la base les lui donnerait ; [D]
// garde le socle : la console y chiffre ce que le serveur ne chiffre pas.
// ---------------------------------------------------------------------------
async function catalogue(serveur, aligne) {
  const store = require(path.join(ROOT, 'lib/catalog-store.js'));
  await store.refreshCatalog(serveur.S.db.getPool(), { force: true }).catch(() => null);
  if (!aligne) return;
  const meta = FX.lireCentre().publicBookingMeta.activities || [];
  for (const doc of store.listActivities('libramont')) {
    const vu = meta.find((a) => a.id === doc.id);
    if (!vu || !doc.booking) continue;
    doc.booking.priceType = vu.priceType;
    doc.booking.priceValue = vu.priceValue;
    doc.booking.pricing = vu.pricing;
  }
}
function catalogueAligne() {
  const { getCenterActivity } = require(path.join(ROOT, 'lib/activity-catalog.js'));
  const meta = FX.lireCentre().publicBookingMeta.activities || [];
  return meta.filter((a) => a.priceValue != null).every((a) => {
    const vu = getCenterActivity('libramont', a.id);
    return !vu || vu.priceValue === a.priceValue;
  });
}

// ---------------------------------------------------------------------------
// DANS LA PAGE : ouvrir Modifier, changer le contenu, lire ce que la console
// estime, ce que son champ porte et ce que la ligne sous le prix dit.
// ---------------------------------------------------------------------------
async function changer(page, id, geste, prixTape = null) {
  return page.evaluate(async ({ id, geste, prixTape }) => {
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
    if (typeof closePos === 'function') closePos();
    openPos(id);
    setTab('modifier');
    await attendre(60);
    if (!state.editState.programmeEdite) ensureEditProgram(dossierPourFormule(state.selectedRes));
    if (geste.pax) for (let garde = 0; garde < 60 && Number(state.editState.pax) !== geste.pax; garde += 1) editPaxPas(Number(state.editState.pax) < geste.pax ? 1 : -1);
    if (geste.duree) setEditBowlingDuration(geste.duree);
    if (geste.parties) setEditLaserGames(geste.parties);
    if (geste.retirer) toggleEditActivity(geste.retirer);
    await attendre(80);
    if (prixTape !== null) {
      const champ = document.getElementById('editPriceInput');
      champ.value = String(prixTape);
      setEditPrice(String(prixTape));
      await attendre(40);
    }
    const estime = getEditPrixEstime();
    const champ = document.getElementById('editPriceInput');
    const ligne = document.getElementById('editPrixEstime');
    return {
      estime: estime ? estime.total : null,
      utilisable: Boolean(estime && estime.utilisable),
      champ: champ ? Number(champ.value) : null,
      ligne: ligne && !ligne.hidden ? ligne.textContent.replace(/\s+/g, ' ').trim() : '',
      fige: Boolean(state.editState.prixFige),
    };
  }, { id, geste, prixTape });
}

async function enregistrer(page, journal) {
  const avant = journal.length;
  await page.locator('#posOverlay .es-save').click();
  await page.waitForFunction((n) => (window.__envois || 0) > n, avant, { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(300);
  return journal.slice(avant);
}

async function monter(browser, serveur) {
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'dark', port: PORT, heure: '15:10',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => {
        const reponse = await serveur.appeler('PATCH', URL_RESA, corps);
        journal.push({ corps, statut: reponse.statut, json: reponse.json });
        await page.evaluate(() => { window.__envois = (window.__envois || 0) + 1; }).catch(() => null);
        return reponse;
      });
    },
  });
  return { ...m, journal };
}

// La base, le serveur et la page d un groupe : neufs a chaque fois.
async function ouvrirGroupe(browser, { aligne }) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: CINQ });
  await catalogue(serveur, aligne);
  const page = await monter(browser, serveur);
  return { serveur, ...page };
}

// Un dossier de la base et de la console, retouche avant le geste (un prix
// d ami, une partie de laser en plus) : la console le relit tel que la base le
// porte, a la meme version.
async function retoucher(page, id, retouche) {
  const row = B.base.reservations.get(Number(id));
  const neuf = { ...row, ...retouche(row) };
  B.base.reservations.set(row.id, neuf);
  await page.evaluate((r) => {
    const maj = (d) => ({ ...d, program: r.program, basePrice: r.base_price, price: r.price, updatedAt: new Date(r.updated_at).toISOString() });
    const i = state.reservations.findIndex((x) => x.id === r.id);
    state.reservations[i] = maj(state.reservations[i]);
    const j = window.__FIXTURE__.jours[window.__FIXTURE__.jour];
    const k = j.findIndex((x) => x.id === r.id);
    j[k] = maj(j[k]);
  }, JSON.parse(JSON.stringify(neuf)));
}

// La partie de laser en plus, posee comme le moteur la normalise (lib/visit-program).
function partieEnPlus(extraLaser) {
  return (row) => {
    const visit = require(path.join(ROOT, 'lib/visit-program.js'));
    const items = row.program.items.map((item) => (item.activityId === 'laser_game' ? { ...item, extraLaser } : item));
    const programme = visit.normalizeProgram(items, { centerId: 'libramont', pax: Number(row.pax), dateStr: row.date });
    const total = Number(programme.price) || 0;
    return { program: { ...row.program, items: programme.items.map((it) => ({ ...it, planned: true })), price: total }, base_price: total, price: total };
  };
}

const sansPrixNiRaison = (corps) => !Object.prototype.hasOwnProperty.call(corps || {}, 'price') && !Object.prototype.hasOwnProperty.call(corps || {}, 'prixRaison');

// ---------------------------------------------------------------------------
// [S] LE MEME CATALOGUE DES DEUX COTES.
// ---------------------------------------------------------------------------
const SCENARIOS_S = [
  { nom: 'bowling seul, 1 h -> 2 h', id: 1613, geste: { duree: 2 } },
  { nom: 'laser seul, 2 parties -> 3', id: 1618, geste: { parties: 3 } },
  { nom: 'visite bowling, laser et minigolf, 8 -> 9 joueurs', id: 1622, geste: { pax: 9 } },
  { nom: 'visite avec une partie de laser en plus pour 4, 9 -> 10 joueurs', id: 1622, geste: { pax: 10 }, extraLaser: { games: 2, participants: 4 } },
  { nom: 'formule a la personne, 10 -> 11 joueurs', id: 1602, geste: { pax: 11 } },
  { nom: 'formule sur pistes, 10 -> 11 joueurs', id: 1604, geste: { pax: 11 } },
  { nom: 'formule adaptee, laser retire', id: 1604, geste: { retirer: 'laser_game' } },
];

async function groupeS(browser, noms = null) {
  const { page, erreurs, journal } = await ouvrirGroupe(browser, { aligne: true });
  try {
    for (const s of SCENARIOS_S.filter((x) => !noms || noms.includes(x.nom))) {
      if (s.extraLaser) await retoucher(page, s.id, partieEnPlus(s.extraLaser));
      const avant = enBase(s.id);
      const lu = await changer(page, s.id, s.geste);
      const envois = await enregistrer(page, journal);
      const envoi = envois[envois.length - 1] || {};
      const apres = enBase(s.id);
      const moteur = apres.basePrice + apres.extras;
      const detail = { console: lu.estime, champ: lu.champ, moteur, base: apres.basePrice, extras: apres.extras, ecrit: apres.price, statut: envoi.statut, message: envoi.json && envoi.json.message, avant: avant.price };
      ok(catalogueAligne(), `[S] MONTAGE ${s.nom} : le serveur juge avec le catalogue de la console`);
      ok(lu.utilisable && !lu.fige && envoi.statut === 200 && centimes(lu.estime) === centimes(moteur),
        `[S] ${s.nom} : l estimation de la console tombe sur la base du moteur plus les extras, au centime`, detail);
      ok(envois.length === 1 && sansPrixNiRaison(envoi.corps), `[S] ${s.nom} : le PATCH ne porte ni prix ni raison`,
        { envois: envois.length, price: envoi.corps && envoi.corps.price, prixRaison: envoi.corps && envoi.corps.prixRaison });
      ok(envoi.statut === 200 && centimes(apres.price) === centimes(lu.champ) && centimes(apres.price) !== centimes(avant.price),
        `[S] ${s.nom} : le serveur ecrit le prix que le champ annonce`, detail);
      ok(envoi.statut === 200 && apres.notesPrix.length === avant.notesPrix.length,
        `[S] ${s.nom} : un role a 5 % passe, sans note de prix`,
        { statut: envoi.statut, code: envoi.json && envoi.json.code, message: envoi.json && envoi.json.message, notes: apres.notesPrix.slice(avant.notesPrix.length) });
    }
    ok(erreurs.length === 0, '[J] [S] aucune erreur JS', erreurs.slice(0, 3));
  } finally { await page.context().close(); }
}

// ---------------------------------------------------------------------------
// [D] LA CONSOLE CHIFFRE CE QUE LE SERVEUR NE CHIFFRE PAS.
// ---------------------------------------------------------------------------
async function groupeD(browser) {
  const { page, erreurs, journal } = await ouvrirGroupe(browser, { aligne: false });
  try {
    const id = 1622;
    const avant = enBase(id);
    const lu = await changer(page, id, { pax: 9 });
    const envois = await enregistrer(page, journal);
    const envoi = envois[envois.length - 1] || {};
    const apres = enBase(id);
    const moteur = apres.basePrice + apres.extras;
    const detail = { console: lu.estime, champ: lu.champ, moteur, ecrit: apres.price, statut: envoi.statut, code: envoi.json && envoi.json.code, message: envoi.json && envoi.json.message };
    ok(lu.utilisable && centimes(lu.estime) > centimes(moteur), '[D] MONTAGE la console chiffre une activite que le serveur ne chiffre pas', detail);
    ok(envoi.statut === 200 && centimes(apres.price) === centimes(moteur) && apres.pax === 9,
      `[D] visite 8 -> 9 : le serveur pose SA base plus les extras (${moteur} EUR, la console en annoncait ${lu.estime}), le role a 5 % passe`, detail);
    ok(envoi.statut === 200 && apres.notesPrix.length === avant.notesPrix.length, '[D] aucune note de prix', apres.notesPrix);
    ok(erreurs.length === 0, '[J] [D] aucune erreur JS', erreurs.slice(0, 3));
  } finally { await page.context().close(); }
}

// ---------------------------------------------------------------------------
// [A] L AJUSTEMENT EN PLACE SE GARDE.
// ---------------------------------------------------------------------------
async function groupeA(browser) {
  const { page, erreurs, journal } = await ouvrirGroupe(browser, { aligne: true });
  try {
    // Un prix d ami : 10 EUR de moins que la reference ecrite.
    await retoucher(page, 1613, (row) => ({ price: Number(row.base_price) - 10 }));
    const avantAmi = enBase(1613);
    const ami = await changer(page, 1613, { duree: 2 });
    const envoisAmi = await enregistrer(page, journal);
    const envoiAmi = envoisAmi[envoisAmi.length - 1] || {};
    const apresAmi = enBase(1613);
    const detailAmi = { console: ami.estime, champ: ami.champ, ligne: ami.ligne, ecrit: apresAmi.price, base: apresAmi.basePrice, statut: envoiAmi.statut, message: envoiAmi.json && envoiAmi.json.message };
    ok(ami.utilisable && centimes(ami.champ) === centimes(ami.estime) - 1000 && /ajustement de -?\s?−?10 € gardé/.test(ami.ligne),
      '[A] prix d ami, bowling 1 h -> 2 h : le champ annonce le nouveau tarif moins 10 EUR, et la ligne le dit', detailAmi);
    ok(envoiAmi.statut === 200 && sansPrixNiRaison(envoiAmi.corps) && centimes(apresAmi.price) === centimes(ami.champ) && centimes(apresAmi.price) === centimes(apresAmi.basePrice + apresAmi.extras) - 1000,
      '[A] prix d ami : le serveur ecrit le meme montant, sa base moins les 10 EUR', detailAmi);
    ok(apresAmi.notesPrix.length === avantAmi.notesPrix.length, '[A] prix d ami : aucune note de prix', apresAmi.notesPrix);
    // Une visite offerte : son ecart couvre tout le tarif, le groupe perd un joueur.
    await retoucher(page, 1622, () => ({ price: 0 }));
    const avantOffert = enBase(1622);
    const offert = await changer(page, 1622, { pax: 7 });
    const envoisOffert = await enregistrer(page, journal);
    const envoiOffert = envoisOffert[envoisOffert.length - 1] || {};
    const apresOffert = enBase(1622);
    const detailOffert = { console: offert.estime, champ: offert.champ, ecrit: apresOffert.price, base: apresOffert.basePrice, pax: apresOffert.pax, statut: envoiOffert.statut, code: envoiOffert.json && envoiOffert.json.code, message: envoiOffert.json && envoiOffert.json.message };
    ok(offert.utilisable && offert.champ === 0 && centimes(offert.estime) > 0, '[A] visite offerte, 8 -> 7 : le champ reste a 0 EUR', detailOffert);
    ok(envoiOffert.statut === 200 && apresOffert.pax === 7 && apresOffert.price === 0 && apresOffert.basePrice > 0 && apresOffert.notesPrix.length === avantOffert.notesPrix.length,
      '[A] visite offerte : le serveur ecrit 0 EUR sur sa nouvelle base, le role a 5 % passe, sans note', detailOffert);
    ok(erreurs.length === 0, '[J] [A] aucune erreur JS', erreurs.slice(0, 3));
  } finally { await page.context().close(); }
}

// ---------------------------------------------------------------------------
// [T] UN PRIX TAPE GARDE SON CHEMIN.
// ---------------------------------------------------------------------------
async function groupeT(browser) {
  const { page, erreurs, journal } = await ouvrirGroupe(browser, { aligne: true });
  try {
    const id = 1618;
    // Dans les 5 % : il part, avec la raison d office, et se trace.
    const sonde = await changer(page, id, { parties: 3 });
    const dansLaMarge = Math.round(sonde.estime * 0.96 * 100) / 100;
    const lu = await changer(page, id, { parties: 3 }, dansLaMarge);
    const envois = await enregistrer(page, journal);
    const envoi = envois[envois.length - 1] || {};
    const apres = enBase(id);
    const note = apres.notesPrix[apres.notesPrix.length - 1] || null;
    ok(lu.fige && envoi.statut === 200 && Number(envoi.corps && envoi.corps.price) === dansLaMarge && (envoi.corps || {}).prixRaison === 'Prix revu au comptoir',
      `[T] laser 2 -> 3 parties, ${dansLaMarge} EUR tapes : le prix part avec sa raison`, { statut: envoi.statut, price: envoi.corps && envoi.corps.price, prixRaison: envoi.corps && envoi.corps.prixRaison, message: envoi.json && envoi.json.message });
    ok(centimes(apres.price) === centimes(dansLaMarge) && note && Number(note.prix && note.prix.a) === dansLaMarge && /Prix revu au comptoir/.test(note.t || '') && note.par === 'Rachel',
      '[T] dans les 5 % : le serveur l ecrit et le trace, sous le nom de la session', { ecrit: apres.price, note });
    // Au-dela : refus, rien d ecrit.
    const loin = Math.round(sonde.estime * 0.5 * 100) / 100;
    const avantLoin = enBase(id);
    await changer(page, id, { parties: 2 }, loin);
    const envoisLoin = await enregistrer(page, journal);
    const envoiLoin = envoisLoin[envoisLoin.length - 1] || {};
    const apresLoin = enBase(id);
    ok(envoiLoin.statut === 403 && (envoiLoin.json || {}).code === 'prix_niveau_insuffisant' && apresLoin.price === avantLoin.price && apresLoin.notesPrix.length === avantLoin.notesPrix.length,
      `[T] ${loin} EUR tapes, au-dela des 5 % : refus, rien d ecrit`, { statut: envoiLoin.statut, code: envoiLoin.json && envoiLoin.json.code, avant: avantLoin.price, apres: apresLoin.price });
    ok(erreurs.length === 0, '[J] [T] aucune erreur JS', erreurs.slice(0, 3));
  } finally { await page.context().close(); }
}

async function jouer(browser, groupes) {
  for (const g of groupes) {
    if (g === 'S') await groupeS(browser);
    // Un scenario suffit a voir ce qui part.
    if (g === 'S1') await groupeS(browser, [SCENARIOS_S[1].nom]);
    if (g === 'D') await groupeD(browser);
    if (g === 'A') await groupeA(browser);
    if (g === 'T') await groupeT(browser);
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'console-envoie-le-prix', lettre: 'S', groupes: ['S1'], editions: [{ fichier: JS, de: '      if (prixSuivi) delete corps.price;\n', vers: '' }] },
  { nom: 'console-ne-suit-plus', lettre: 'D', groupes: ['D'], editions: [{ fichier: JS, de: '  const prixSuivi = !es.prixFige && Boolean(estimeEcran', vers: '  const prixSuivi = false && Boolean(estimeEcran' }] },
  // Le moteur rend deja un prix a un programme et a un plan de pistes, sans
  // l ajustement : c est le prix d ami qui le voit.
  { nom: 'serveur-ne-pose-pas', lettre: 'A', groupes: ['A'], editions: [{ fichier: API, serveur: true, de: '  if (prixSuivi) {\n    patch.price = prixQuiSuit(', vers: '  if (false) {\n    patch.price = prixQuiSuit(' }] },
  { nom: 'prix-pose-puis-juge', lettre: 'A', groupes: ['A'], editions: [{ fichier: API, serveur: true, de: 'const notePrix = prixSuivi ? null : jugerPrixDeModification(', vers: 'const notePrix = jugerPrixDeModification(' }] },
  { nom: 'ajustement-perdu-au-serveur', lettre: 'A', groupes: ['A'], editions: [{ fichier: DROITS, serveur: true, de: '(baseAvant > 0 ? prixAvant - baseAvant - extrasAvant : 0)', vers: '0' }] },
  { nom: 'ajustement-perdu-a-l-ecran', lettre: 'A', groupes: ['A'], editions: [{ fichier: JS, de: 'Math.round((estime.total + ajustementGarde(r)) * 100) / 100', vers: 'Math.round(estime.total * 100) / 100' }] },
  { nom: 'ajustement-tu', lettre: 'A', groupes: ['A'], editions: [{ fichier: JS, de: '    return phrase(ajustement\n', vers: '    return phrase(false\n' }] },
  { nom: 'plancher-oublie', lettre: 'A', groupes: ['A'], editions: [{ fichier: DROITS, serveur: true, de: 'return euros(Math.max(0, pose));', vers: 'return euros(pose);' }] },
  { nom: 'plancher-oublie-a-l-ecran', lettre: 'A', groupes: ['A'], editions: [{ fichier: JS, de: 'return Math.max(0, Math.round((estime.total + ajustementGarde(r)) * 100) / 100);', vers: 'return Math.round((estime.total + ajustementGarde(r)) * 100) / 100;' }] },
  { nom: 'prix-tape-sans-raison', lettre: 'T', groupes: ['T'], editions: [{ fichier: JS, de: '        ...(prixSuivi ? {} : { prixRaison: RAISON_PRIX_PAR_DEFAUT }),\n', vers: '' }] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, ['S', 'D', 'A', 'T']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.PS_MUTATIONS || liste(process.env.PS_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PS_BAVARD;
        try {
          await jouer(browser, m.groupes);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nprix-suivi-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nprix-suivi-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
