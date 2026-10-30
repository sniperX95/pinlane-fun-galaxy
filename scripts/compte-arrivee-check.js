// LE COMPTE A L ARRIVEE (2026-10-29, lot 2 de R33 ; Movsar : « Oui, le compte »).
//
// « Arrivé » reste un geste ; il devient « Arrivé · 10 », et le toucher une
// seconde fois ouvre « Ils sont : 10 [−] [+] ». Tranche par Movsar le 29/10 :
// le second toucher ; le prix suit le compte, a la baisse aussi ; un forfait
// par piste se compte comme dans Modifier ; seul qui peut modifier un dossier
// compte. La console reelle (scripts/planning-v3-fixtures.js, le samedi « pic »
// a 15:10) ; ses PATCH partent au VRAI handler api/staff-reservations.js, au
// vrai moteur et a la vraie lib/database.js, sur la base en memoire de
// reserver-banc ou la journee de la fixture est semee (aucun reseau, aucune
// base reelle, rien ne part).
//   [A] « Arrivé » pointe en un geste (le PATCH ne porte que le statut) ; il
//       devient « Arrivé · 10 », un bouton qui ouvre le compte, sur la feuille,
//       au prochain depart laser et dans la fiche ;
//   [B] le second toucher ouvre la bulle : « Ils sont 10 », comme a la
//       reservation, le prix du dossier ; rien ne part a l ouverture ;
//   [C] L ACTE FINAL, formule a la personne (Anniversaire Hugo, Formule 8,
//       28 EUR, 10 reserves) : 13 -> le serveur ecrit 13 personnes et 364 EUR,
//       la note « Compte à l’arrivée : 10 → 13 » a l auteur de SA session, les
//       heures du groupe inchangees ; la feuille dit 13 et « 10 rés. » ;
//   [D] moins nombreux, le prix suit (Movsar) : 13 -> 8, 224 EUR ; la bulle et
//       la feuille gardent « 10 à la réservation » ;
//   [E] un forfait par piste, comme Modifier : Amis de Clara (bowling, pistes
//       6 et 7) 7 -> 12, memes pistes, meme prix ; 17 sans piste libre a cote,
//       la bulle le dit et rien ne part ; Famille Noel (piste 6, la 7 libre)
//       4 -> 7, une piste de plus et son prix ;
//   [F] le droit : le Staff bar voit « Arrivé · 8 » sans bouton, dans la
//       feuille comme dans la fiche ; le serveur refuse son compte, et le
//       compte d un groupe pas encore arrive ;
//   [G] le meme calcul que Modifier : chaque prix envoye est celui que l onglet
//       Modifier annonce pour ce nombre ;
//   [H] au telephone, la bulle tient dans l ecran, rien sous 12 px ; Echap la
//       ferme et rend le focus au bouton ;
//   [J] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi, ou compile en memoire
// cote serveur ; le disque n est jamais touche) fait rougir sa lettre.
//   CA_MUTATIONS : un sous-ensemble ; CA_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout
// module de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');

// « Arrivé » ecrit par setReservationStatus (lib/database.js) : sa requete,
// sur la vue de la transaction du client, comme les ecritures du banc.
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryAvant = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s === 'update reservations set status = $2, payment_method = $3, updated_at = now() where id = $1 returning *;') {
    const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
    const avant = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    if (!avant) return { rows: [], rowCount: 0 };
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, status: params[1], payment_method: params[2] || null, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [JSON.parse(JSON.stringify(row), (k, v) => (['created_at', 'updated_at', 'paid_at', 'absent_at'].includes(k) && v ? new Date(v) : v))], rowCount: 1 };
  }
  return queryAvant.call(this, sql, params);
};
const PORT = Number(process.env.PINLANE_COMPTE_ARRIVEE_PORT || 5189);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const GJS = 'assets/pinlane-planning-global.js';
const CSS = 'assets/pinlane-staff.css';
const API = 'api/staff-reservations.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

const HUGO = 1602; // Formule 8, 28 EUR par personne, 10 reserves, attendu a 15:00
const CLARA = 1634; // bowling, pistes 6 et 7, 7 joueurs, 15:00
const NOEL = 1637; // bowling, piste 6, 4 joueurs, 16:30 (la piste 7 est libre)
const MANON = 1618; // laser 15:30, 8 joueurs
const CAMILLE = 1603; // Formule 7, 15:30, pas encore arrivee

let echecs = 0;
let silence = false;
const rouges = [];
// La contre-preuve en cours (`mutation`) a mordu des que sa lettre rougit : la
// suite de ses scenarios n apporterait plus rien (2026-10-30, la suite
// raccourcie ; chaque scenario ferme sa page dans un finally).
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}

let mutation = null;
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
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
function enBase(id) {
  const row = B.base.reservations.get(Number(id));
  if (!row) return null;
  const plan = typeof row.ops_plan === 'string' ? JSON.parse(row.ops_plan) : row.ops_plan;
  const notes = String(row.notes || '').split('\n').filter((l) => l.startsWith('[equipe] ')).map((l) => { try { return JSON.parse(l.slice(9)); } catch (e) { return null; } }).filter(Boolean);
  return {
    pax: Number(row.pax), price: Number(row.price), basePrice: Number(row.base_price), status: row.status,
    lanes: (row.lanes || []).map(Number), notes, plan,
    heures: (plan && Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : []).map((b) => `${b.activityId || b.resourceType}@${b.startTime || ''}`).sort().join(','),
    version: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
function lireBulle() {
  const pop = document.getElementById('comptePop');
  if (!pop) return { ouverte: false };
  const txt = (s) => { const n = pop.querySelector(s); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const b = pop.getBoundingClientRect();
  const petits = [];
  const marche = document.createTreeWalker(pop, NodeFilter.SHOW_TEXT);
  for (let n = marche.nextNode(); n; n = marche.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement) continue;
    const px = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (px < 12) petits.push(`${n.textContent.trim().slice(0, 20)} ${px}px`);
  }
  return {
    ouverte: true, titre: txt('.compte-pop__titre'), n: Number(txt('output')), ref: txt('.compte-pop__ref'),
    prixLigne: txt('.compte-pop__prix span'), prix: txt('.compte-pop__prix b'), avant: txt('.compte-pop__avant'), erreur: txt('.compte-pop__erreur'),
    boite: { g: Math.round(b.left), d: Math.round(b.right), h: Math.round(b.top), bas: Math.round(b.bottom), iw: innerWidth, ih: innerHeight },
    petits, focus: document.activeElement && document.activeElement.getAttribute('data-compte-focus'),
  };
}
function lireLigne(id) {
  const tr = document.querySelector(`[data-gf-id="${id}"]`);
  if (!tr) return { absente: true };
  const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const bouton = tr.querySelector('[data-compte-id]');
  return {
    bouton: bouton ? { tag: bouton.tagName, texte: txt(bouton), popup: bouton.getAttribute('aria-haspopup') } : null,
    etat: txt(tr.querySelector('.gf-etat .gf-b.t-arr')),
    pers: txt(tr.querySelector('.gf-n b')),
    res: txt(tr.querySelector('.gf-n__res')),
    arriver: Boolean(tr.querySelector('[data-gf-arrive]')),
  };
}

async function ouvrirBulle(page, selecteur) {
  await page.locator(selecteur).first().scrollIntoViewIfNeeded();
  await page.locator(selecteur).first().click();
  await page.waitForSelector('#comptePop', { timeout: 5000 }).catch(() => null);
  return page.evaluate(lireBulle);
}
async function pas(page, delta, fois) {
  for (let i = 0; i < fois; i += 1) await page.locator(`#comptePop [data-compte-pas="${delta}"]`).click();
  await page.waitForTimeout(120);
  return page.evaluate(lireBulle);
}
async function enregistrer(page, journal) {
  const avant = journal.length;
  await page.locator('#comptePop .compte-pop__ok').click();
  await page.waitForFunction(() => !document.getElementById('comptePop') || (document.querySelector('#comptePop .compte-pop__erreur') && !document.querySelector('#comptePop.is-occupe')), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
  return { envois: journal.slice(avant), bulle: await page.evaluate(lireBulle), toast: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '') };
}

// CE QUE L ONGLET MODIFIER ANNONCE pour ce nombre, par ses boutons − et + :
// l oracle du calcul [G]. La fiche se ferme sans rien envoyer.
async function prixDeModifier(page, id, n) {
  return page.evaluate(async ({ id, n }) => {
    if (typeof fermerCompteArrivee === 'function') fermerCompteArrivee(false);
    closePos();
    openPos(id);
    setTab('modifier');
    const bouton = (plus) => document.querySelector(`#posOverlay .fm-joueurs [aria-label="${plus ? 'Un joueur de plus' : 'Un joueur de moins'}"]`);
    for (let garde = 0; garde < 300 && Number(state.editState.pax) !== n; garde += 1) bouton(Number(state.editState.pax) < n).click();
    await new Promise((r) => setTimeout(r, 60));
    const champ = document.getElementById('editPriceInput');
    const lu = { prix: champ ? Number(champ.value) : null, pistes: String(state.editState.lanesStr || ''), pax: Number(state.editState.pax) };
    closePos();
    return lu;
  }, { id, n });
}

async function monter(browser, serveur, { appareil = 'ordinateur', theme = 'dark' } = {}) {
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil, theme, port: PORT, heure: '15:10',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { journal.push(corps); return serveur.appeler('PATCH', '/api/staff-reservations', corps); });
    },
  });
  return { ...m, journal };
}

// ---------------------------------------------------------------------------
// LE COMPTOIR, au bureau : A a G.
// ---------------------------------------------------------------------------
async function scenarioComptoir(browser) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const manager = B.sessionDuRole('manager', { nom: 'Rachel' });
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: manager });
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    // [A] « Arrivé » d un geste.
    const ligne = `[data-gf-id="${HUGO}"]`;
    await page.locator(ligne).first().scrollIntoViewIfNeeded();
    const avantA = journal.length;
    await page.locator(`${ligne} [data-gf-arrive]`).click();
    await page.waitForFunction((s) => document.querySelector(`${s} [data-compte-id]`), ligne, { timeout: 8000 }).catch(() => null);
    const pointage = journal.slice(avantA);
    const a = await page.evaluate(lireLigne, HUGO);
    ok(pointage.length === 1 && Object.keys(pointage[0]).filter((k) => !['id', 'centerId', 'baseUpdatedAt'].includes(k)).join() === 'status' && pointage[0].status === 'arrived' && enBase(HUGO).status === 'arrived',
      '[A] « Arrivé » pointe en un geste : un PATCH de statut seul, le groupe arrive en base', { pointage, base: enBase(HUGO).status });
    ok(a.bouton && a.bouton.tag === 'BUTTON' && a.bouton.texte === 'Arrivé · 10' && a.bouton.popup === 'dialog' && !a.arriver,
      '[A] feuille : le bouton devient « Arrivé · 10 », qui ouvre le compte', a);

    // [B] le second toucher.
    const avantB = journal.length;
    const b = await ouvrirBulle(page, `${ligne} [data-compte-id]`);
    ok(b.ouverte && b.n === 10 && b.ref === 'Comme à la réservation' && b.prix === '280 €' && !b.avant && b.focus === 'plus' && journal.length === avantB,
      '[B] la bulle s ouvre sur « Ils sont 10 », comme a la reservation, 280 €, le focus sur +, rien n est envoye', b);

    // [G] ce que Modifier annonce pour 13, puis [C] le compte.
    const oracle13 = await prixDeModifier(page, HUGO, 13);
    await ouvrirBulle(page, `${ligne} [data-compte-id]`);
    const c0 = await pas(page, 1, 3);
    ok(c0.n === 13 && c0.ref === '10 à la réservation' && c0.prix === '364 €' && c0.avant === 'avant 280 €' && /28 € × 13/.test(c0.prixLigne),
      '[C] 13 : la bulle dit 10 a la reservation, 28 € × 13 = 364 €, avant 280 €', c0);
    const planAvant = enBase(HUGO).heures;
    const c = await enregistrer(page, journal);
    const envoiC = c.envois[c.envois.length - 1] || {};
    const baseC = enBase(HUGO);
    const noteC = baseC.notes.filter((n) => n.compte);
    ok(c.envois.length === 1 && envoiC.compteArrivee === true && Number(envoiC.pax) === 13 && Number(envoiC.price) === 364,
      '[C] Enregistrer envoie UN PATCH : 13 personnes, 364 €, le drapeau du compte', c.envois.map((e) => ({ pax: e.pax, price: e.price, compte: e.compteArrivee })));
    ok(baseC.pax === 13 && baseC.price === 364 && baseC.status === 'arrived',
      '[C] le SERVEUR ecrit 13 personnes et 364 €, le groupe reste arrive', baseC);
    ok(noteC.length === 1 && noteC[0].compte.de === 10 && noteC[0].compte.a === 13 && noteC[0].t === 'Compte à l’arrivée : 10 → 13' && noteC[0].par === 'Rachel',
      '[C] le serveur trace « Compte à l’arrivée : 10 → 13 » a l auteur de sa session', noteC);
    ok(Boolean(planAvant) && baseC.heures === planAvant, '[C] les heures du groupe ne bougent pas', { avant: planAvant, apres: baseC.heures });
    const lc = await page.evaluate(lireLigne, HUGO);
    ok(!c.bulle.ouverte && lc.pers === '13' && lc.res === '10 rés.' && lc.bouton && lc.bouton.texte === 'Arrivé · 13' && /13 personnes/.test(c.toast) && /364/.test(c.toast),
      '[C] la bulle se ferme ; la feuille dit 13, « 10 rés. », « Arrivé · 13 » ; le toast dit 13 personnes et 364 €', { bulle: c.bulle, ligne: lc, toast: c.toast });
    ok(oracle13.pax === 13 && Number(envoiC.price) === oracle13.prix, '[G] 13 : le prix envoye est celui que Modifier annonce', { modifier: oracle13, envoye: envoiC.price });

    // [D] moins nombreux : le prix suit.
    const oracle8 = await prixDeModifier(page, HUGO, 8);
    const d0 = await ouvrirBulle(page, `${ligne} [data-compte-id]`);
    ok(d0.n === 13 && d0.ref === '10 à la réservation', '[D] rouverte, la bulle garde « 10 à la réservation »', d0);
    const d1 = await pas(page, -1, 5);
    const d = await enregistrer(page, journal);
    const baseD = enBase(HUGO);
    const ld = await page.evaluate(lireLigne, HUGO);
    ok(d1.n === 8 && d1.prix === '224 €' && d1.avant === 'avant 364 €' && baseD.pax === 8 && baseD.price === 224,
      '[D] 8 : le prix suit a la baisse (224 €), le serveur l ecrit', { bulle: d1, base: { pax: baseD.pax, price: baseD.price } });
    ok(baseD.notes.filter((n) => n.compte).map((n) => `${n.compte.de}>${n.compte.a}`).join() === '10>13,13>8' && ld.pers === '8' && ld.res === '10 rés.',
      '[D] deux comptes traces (10 → 13, 13 → 8) ; la feuille dit 8 et « 10 rés. »', { notes: baseD.notes, ligne: ld });
    const envoiD = d.envois[d.envois.length - 1] || {};
    ok(oracle8.pax === 8 && Number(envoiD.price) === oracle8.prix, '[G] 8 : le prix envoye est celui que Modifier annonce', { modifier: oracle8, envoye: envoiD.price });

    // [E] un forfait par piste : Amis de Clara, bowling sur les pistes 6 et 7.
    const lclara = `[data-gf-id="${CLARA}"]`;
    await page.locator(lclara).first().scrollIntoViewIfNeeded();
    await page.locator(`${lclara} [data-gf-arrive]`).click();
    await page.waitForFunction((s) => document.querySelector(`${s} [data-compte-id]`), lclara, { timeout: 8000 }).catch(() => null);
    const prixClara = enBase(CLARA).price;
    const oracle12 = await prixDeModifier(page, CLARA, 12);
    await ouvrirBulle(page, `${lclara} [data-compte-id]`);
    const e0 = await pas(page, 1, 5);
    const e1 = await enregistrer(page, journal);
    const baseE1 = enBase(CLARA);
    const envoiE1 = e1.envois[e1.envois.length - 1] || {};
    ok(e0.n === 12 && e0.ref === '7 à la réservation' && baseE1.pax === 12 && baseE1.lanes.join() === '6,7' && baseE1.price === prixClara,
      `[E] forfait par piste, 7 -> 12 : memes pistes (6, 7), meme prix (${prixClara} €), ecrits par le serveur`, { bulle: e0, base: { pax: baseE1.pax, lanes: baseE1.lanes, price: baseE1.price } });
    ok(oracle12.pax === 12 && Number(envoiE1.price) === oracle12.prix, '[G] forfait, 12 : le prix envoye est celui que Modifier annonce', { modifier: oracle12, envoye: envoiE1.price });
    // Plus de joueurs que ses pistes n en prennent, aucune piste libre a cote a
    // 15:00 (deux pistes au plus serre, 8 par piste) : la bulle le dit, rien ne
    // part, comme « Enregistrer » dans Modifier.
    const sansPiste = await (async () => {
      const lu = await ouvrirBulle(page, `${lclara} [data-compte-id]`);
      const plus = await pas(page, 1, 5);
      const r = await enregistrer(page, journal);
      await page.keyboard.press('Escape');
      return { lu, plus, envois: r.envois.length, bulle: r.bulle, base: enBase(CLARA).pax };
    })();
    ok(sansPiste.plus.n === 17 && /Impossible de libérer 3 piste/.test(sansPiste.plus.erreur) && sansPiste.envois === 0 && sansPiste.base === 12 && /Impossible de libérer/.test(sansPiste.bulle.erreur),
      '[E] 17 sur deux pistes sans piste libre a cote : la bulle dit « Impossible de libérer 3 pistes… », Enregistrer n envoie rien', sansPiste);
    // Une piste libre a cote (Famille Noel, piste 6 a 16:30, 4 joueurs) : 7
    // joueurs prennent la piste 7, et son prix suit.
    const lnoel = `[data-gf-id="${NOEL}"]`;
    await page.locator(lnoel).first().scrollIntoViewIfNeeded();
    await page.locator(`${lnoel} [data-gf-arrive]`).click();
    await page.waitForFunction((s) => document.querySelector(`${s} [data-compte-id]`), lnoel, { timeout: 8000 }).catch(() => null);
    const prixNoel = enBase(NOEL).price;
    const oracle7 = await prixDeModifier(page, NOEL, 7);
    await ouvrirBulle(page, `${lnoel} [data-compte-id]`);
    const e2 = await pas(page, 1, 3);
    const e3 = await enregistrer(page, journal);
    const baseE3 = enBase(NOEL);
    const envoiE3 = e3.envois[e3.envois.length - 1] || {};
    ok(e2.n === 7 && !e2.erreur && baseE3.pax === 7 && baseE3.lanes.join() === oracle7.pistes.replace(/\s/g, '') && baseE3.lanes.length === 2 && baseE3.price === oracle7.prix && baseE3.price > prixNoel && /pistes 6, 7/.test(e3.toast),
      '[E] une piste libre a cote : 4 -> 7 prend la piste 7 et son prix, comme Modifier ; le toast dit les pistes', { bulle: e2, base: { lanes: baseE3.lanes, price: baseE3.price }, modifier: oracle7, toast: e3.toast });
    ok(oracle7.pax === 7 && Number(envoiE3.price) === oracle7.prix, '[G] piste en plus, 7 : le prix envoye est celui que Modifier annonce', { modifier: oracle7, envoye: envoiE3.price });

    // [A] au prochain depart laser.
    await page.evaluate(() => { const t = Array.from(document.querySelectorAll('button, [role="tab"]')).find((n) => /Planning Laser Game/.test(n.textContent)); if (t) t.click(); });
    await page.waitForSelector('.lp-prochain', { timeout: 8000 }).catch(() => null);
    const manon = await page.evaluate((id) => {
      const groupe = Array.from(document.querySelectorAll('.lp-prochain .lp-groupe')).find((g) => g.querySelector(`[onclick*="lpIlsSontLa(${id}"]`) || g.querySelector(`[data-compte-id="${id}"]`));
      const bouton = groupe && groupe.querySelector(`[onclick*="lpIlsSontLa(${id}"]`);
      if (bouton) bouton.click();
      return Boolean(groupe);
    }, MANON);
    await page.waitForSelector(`.lp-prochain [data-compte-id="${MANON}"]`, { timeout: 8000 }).catch(() => null);
    const laser = await page.evaluate((id) => { const b = document.querySelector(`.lp-prochain [data-compte-id="${id}"]`); return b ? { tag: b.tagName, texte: b.textContent.replace(/\s+/g, ' ').trim() } : null; }, MANON);
    const bl = laser ? await ouvrirBulle(page, `.lp-prochain [data-compte-id="${MANON}"]`) : { ouverte: false };
    ok(manon && laser && laser.tag === 'BUTTON' && laser.texte === 'Arrivés · 8' && bl.ouverte && bl.n === 8,
      '[A] laser : « Ils sont là » pointe, devient « Arrivés · 8 » et ouvre le compte', { manon, laser, bulle: bl });
    await page.keyboard.press('Escape');

    // [A] dans la fiche.
    await page.evaluate((id) => { closePos(); openPos(id); }, HUGO);
    await page.waitForSelector('#posOverlay .res-status-btn.arrived', { timeout: 5000 }).catch(() => null);
    const fiche = await page.evaluate(() => { const b = document.querySelector('#posOverlay .res-status-btn.arrived'); return b ? { texte: b.textContent.replace(/\s+/g, ' ').trim(), compte: b.hasAttribute('data-compte-id'), presse: b.getAttribute('aria-pressed') } : null; });
    const bf = fiche && fiche.compte ? await ouvrirBulle(page, '#posOverlay .res-status-btn.arrived') : { ouverte: false };
    ok(fiche && fiche.texte === 'Arrivé · 8' && fiche.compte && fiche.presse === 'true' && bf.ouverte && bf.n === 8 && bf.ref === '10 à la réservation',
      '[A] fiche : « Arrivé · 8 » enfonce, le second toucher ouvre le compte (10 a la reservation)', { fiche, bulle: bf });
    await page.keyboard.press('Escape');
    await page.evaluate(() => closePos());

    // [F] le Staff bar voit le nombre, sans le bouton.
    await page.evaluate(() => { const t = Array.from(document.querySelectorAll('button, [role="tab"]')).find((n) => /Planning global/.test(n.textContent)); if (t) t.click(); });
    await page.waitForSelector(ligne, { timeout: 8000 }).catch(() => null);
    const sessionAvant = await page.evaluate(() => {
      const avant = state.staffAuthSession;
      state.staffAuthSession = { ...avant, role: { id: 'staff-bar', name: 'Staff bar', locked: false }, permissions: ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser', 'reservations.view', 'reservations.create', 'reservations.status', 'reservations.quick', 'payments.view', 'payments.markPaid'] };
      renderStaff();
      return Boolean(avant);
    });
    const fl = await page.evaluate(lireLigne, HUGO);
    await page.evaluate((id) => { closePos(); openPos(id); }, HUGO);
    const ff = await page.evaluate(() => { const b = document.querySelector('#posOverlay .res-status-btn.arrived'); return b ? { texte: b.textContent.replace(/\s+/g, ' ').trim(), compte: b.hasAttribute('data-compte-id') } : null; });
    await page.evaluate(() => closePos());
    ok(sessionAvant && !fl.bouton && fl.etat === 'Arrivé · 8' && ff && ff.texte === 'Arrivé · 8' && !ff.compte,
      '[F] Staff bar : « Arrivé · 8 » se lit, sans bouton de compte, dans la feuille et dans la fiche', { ligne: fl, fiche: ff });
    // Le serveur refuse son compte...
    const dernier = (d.envois[d.envois.length - 1]) || {};
    serveur.changerSession(B.sessionDuRole('staff-bar', { nom: 'Lucas' }));
    const refus = await serveur.appeler('PATCH', '/api/staff-reservations', { ...dernier, baseUpdatedAt: enBase(HUGO).version, pax: 9, price: 252, basePrice: 252 });
    serveur.changerSession(manager);
    ok(refus.statut === 403 && enBase(HUGO).pax === 8, '[F] le serveur refuse le compte du Staff bar (403), rien n est ecrit', { statut: refus.statut, pax: enBase(HUGO).pax });
    // ... et celui d un groupe pas encore arrive.
    const camille = FIXTURE.staffState.reservations.find((r) => r.id === CAMILLE);
    const pasArrive = await serveur.appeler('PATCH', '/api/staff-reservations', { ...camille, centerId: 'libramont', baseUpdatedAt: enBase(CAMILLE).version, pax: 15, price: 360, basePrice: 360, compteArrivee: true });
    ok(pasArrive.statut === 422 && /groupe pointé arrivé/.test(JSON.stringify(pasArrive.json)) && enBase(CAMILLE).pax === camille.pax,
      '[F] le serveur refuse le compte d un groupe pas encore arrive (422), rien n est ecrit', { statut: pasArrive.statut, json: pasArrive.json, pax: enBase(CAMILLE).pax });

    ok(erreurs.length === 0, '[J] comptoir : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [H] AU TELEPHONE.
// ---------------------------------------------------------------------------
async function scenarioTelephone(browser) {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  const serveur = B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('manager', { nom: 'Rachel' }) });
  const { ctx, page, erreurs } = await monter(browser, serveur, { appareil: 'telephone', theme: 'light' });
  try {
    const ligne = `[data-gf-id="${HUGO}"]`;
    await page.locator(ligne).first().scrollIntoViewIfNeeded();
    await page.locator(`${ligne} [data-gf-arrive]`).click();
    await page.waitForFunction((s) => document.querySelector(`${s} [data-compte-id]`), ligne, { timeout: 8000 }).catch(() => null);
    const h = await ouvrirBulle(page, `${ligne} [data-compte-id]`);
    ok(h.ouverte && h.boite.g >= 0 && h.boite.d <= h.boite.iw && h.boite.h >= 0 && h.boite.bas <= h.boite.ih && h.petits.length === 0,
      '[H] telephone : la bulle tient dans l ecran, rien sous 12 px', h);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const apres = await page.evaluate((s) => ({ ouverte: Boolean(document.getElementById('comptePop')), focus: Boolean(document.activeElement && document.activeElement.matches(`${s} [data-compte-id]`)) }), ligne);
    ok(!apres.ouverte && apres.focus, '[H] Echap ferme la bulle et rend le focus au bouton', apres);
    ok(erreurs.length === 0, '[J] telephone : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const COMPTOIR = ['comptoir'];
const TELEPHONE = ['telephone'];
const MUTATIONS = [
  { nom: 'badge-sans-geste', lettre: 'A', scenarios: COMPTOIR, editions: [{ fichier: GJS, de: "    if (typeof peutCompterArrivee === 'function' && peutCompterArrivee(r)) {", vers: '    if (false) {' }] },
  { nom: 'laser-sans-compte', lettre: 'A', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '        ? (peutCompterArrivee(r)\n', vers: '        ? (false\n' }] },
  { nom: 'fiche-sans-compte', lettre: 'A', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '    const compter = peutCompterArrivee(r);\n    const pax = Math.trunc(Number(r.pax) || 0);', vers: '    const compter = false;\n    const pax = Math.trunc(Number(r.pax) || 0);' }] },
  { nom: 'bulle-muette', lettre: 'B', scenarios: COMPTOIR, editions: [{ fichier: JS, de: "    <p class=\"compte-pop__ref\">${reserve === compteArrivee().n ? 'Comme à la réservation' : `${reserve} à la réservation`}</p>", vers: '' }] },
  { nom: 'note-perdue', lettre: 'C', scenarios: COMPTOIR, editions: [{ fichier: API, serveur: true, de: '        if (a !== de) patch.notes = notesAvecCompte(', vers: '        if (false) patch.notes = notesAvecCompte(' }] },
  { nom: 'drapeau-oublie', lettre: 'C', scenarios: COMPTOIR, editions: [{ fichier: JS, de: 'allowPastStart: true, compteArrivee: true });', vers: 'allowPastStart: true });' }] },
  { nom: 'auteur-du-corps', lettre: 'C', scenarios: COMPTOIR, editions: [{ fichier: API, serveur: true, de: "par: (membre && (membre.name || membre.displayName)) || 'Équipe' });", vers: "par: String(patch.name || '') });" }] },
  { nom: 'prix-fige', lettre: 'C', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '    const estime = getEditPrixEstime();\n    e.price = String(prixSuiviEdition(estime));\n', vers: '    const estime = getEditPrixEstime();\n' }] },
  { nom: 'jamais-a-la-baisse', lettre: 'D', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '    const estime = getEditPrixEstime();\n    e.price = String(prixSuiviEdition(estime));\n', vers: '    const estime = getEditPrixEstime();\n    e.price = String(Math.max(prixSuiviEdition(estime), Number(r.price) || 0));\n' }] },
  { nom: 'reserve-oubliee', lettre: 'D', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '  return premier ? Math.trunc(Number(premier.compte.de)) : Math.trunc(Number(r && r.pax) || 0);', vers: '  return Math.trunc(Number(r && r.pax) || 0);' }] },
  { nom: 'prix-par-tete', lettre: 'E', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '    const estime = getEditPrixEstime();\n    e.price = String(prixSuiviEdition(estime));\n', vers: '    const estime = getEditPrixEstime();\n    e.price = String(Math.round((Number(r.price) || 0) / Math.max(1, Number(r.pax) || 1) * n * 100) / 100);\n' }] },
  { nom: 'sans-piste-envoye', lettre: 'E', scenarios: COMPTOIR, editions: [{ fichier: JS, de: '    if (!suggested || suggested.length < requiredCount) {\n      return { erreur:', vers: '    if (false) {\n      return { erreur:' }] },
  { nom: 'staff-bar-compte', lettre: 'F', scenarios: COMPTOIR, editions: [{ fichier: JS, de: "r.date === todayStr() && peutAdapterFormule();", vers: 'r.date === todayStr();' }] },
  { nom: 'pas-arrive-compte', lettre: 'F', scenarios: COMPTOIR, editions: [{ fichier: API, serveur: true, de: "        if (current.status !== 'arrived') throw createHttpError('Le compte se fait sur un groupe pointé arrivé.', 422);\n", vers: '' }] },
  { nom: 'bulle-large', lettre: 'H', scenarios: TELEPHONE, editions: [{ fichier: CSS, de: '.compte-pop { position: fixed; z-index: 700; width: min(300px, calc(100vw - 32px));', vers: '.compte-pop { position: fixed; z-index: 700; width: 420px;' }] },
  { nom: 'echap-sourd', lettre: 'H', scenarios: TELEPHONE, editions: [{ fichier: JS, de: "  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fermerCompteArrivee(); }", vers: '' }] },
];

async function jouer(browser, noms) {
  for (const nom of noms) {
    if (nom === 'comptoir') await scenarioComptoir(browser);
    if (nom === 'telephone') await scenarioTelephone(browser);
  }
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, ['comptoir', 'telephone']);
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.CA_MUTATIONS || liste(process.env.CA_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.CA_BAVARD;
        try {
          await jouer(browser, m.scenarios);
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
  if (echecs) { console.error(`\ncompte-arrivee-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\ncompte-arrivee-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
