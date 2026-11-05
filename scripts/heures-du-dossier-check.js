// UN DOSSIER POSE GARDE SES HEURES (2026-11-02, audit du comptoir).
//
// Un samedi, 15:10. Le groupe d Arthur (Formule 3, bowling 13:30, minigolf 14:35,
// arcades 15:25) arrive a dix au lieu de neuf. Le plancher du jour (maintenant
// + 15 min) est une regle de VENTE : il refusait le plan ancre d un dossier deja
// en cours, le compte tombait sur « Le nombre de joueurs a changé » ; quand le
// plan passait, le minigolf et les arcades perdaient leurs heures. Ce gate monte
// ce samedi pour de vrai : la console reelle (planning-v3-fixtures, le samedi
// « pic » a 15:10), et ses PATCH au VRAI handler, au vrai moteur et a la vraie
// lib/database.js, sur la base en memoire de reserver-banc, LE SERVEUR A LA MEME
// HEURE QUE LA PAGE. C est ce que les autres gates ne font pas : leur serveur
// vit a la date reelle, jamais le jour de la fixture, et le plancher y dort.
//   [A] LE COMPTE D UNE FORMULE A HEURES : Arthur, un de plus a 15:10. Le serveur
//       l ecrit ; le minigolf, les arcades, les boissons et la fin de visite
//       restent les leurs, la feuille les dit ; un groupe paye (Noah), par
//       Modifier, aussi ; chaque formule de la journee, un de plus : ses
//       heures, ou un refus qui dit pourquoi ; une formule a table enregistree
//       avec l ancien calcul garde son arrivee, sa table et sa premiere activite ;
//   [B] UNE FORMULE A ANCRES (le tunnel, Reserver) : ses activites libres n ont
//       pas d heure, la feuille n en invente aucune, la visite dure quand meme
//       jusqu a sa fin ; recomptee apres son debut, elle passe ;
//   [C] UN REFUS SE DIT : sous le minimum de la formule, le comptoir lit le motif
//       du moteur (avec pistes : rien n est ecrit ; sans piste : ecrit, et le
//       toast dit que le planning n a pas suivi), jamais « mise à jour » tout court ;
//   [D] UN LASER AJOUTE DEPUIS MODIFIER : le serveur ne pose aucune heure, la
//       console n en invente aucune (ni 15:00, ni « de trop ») : « à placer », et
//       le toast le dit ;
//   [E] UN DEPLACEMENT QUI NE DEPLACE RIEN NE SE DIT PAS « déplacé » : Amis de
//       Clara sur une piste prise, deux pistes : aucun PATCH, l aperçu et l avis
//       le disent ; une selection sur place non plus ; Noel se deplace toujours ;
//   [F] LA FENETRE OUVERTE ET L ARRIVEE : le meme plancher, les memes dossiers
//       (Lambert, Matin malin en cours ; un plan compose par heure d arrivee) ;
//   [G] LE PLANCHER GARDE LA VENTE : sans le drapeau, ou hors du comptoir, une
//       heure passee reste refusee ;
//   [H] LA MEME REGLE, DE PRES : un dossier deplace d un bloc garde l ecart ; une
//       heure que le nouveau plan occupe redevient sans heure, jamais fausse ;
//   [I] UN GESTE DU PLANNING SURVIT AU COMPTE : glisser une activite ne change pas
//       l heure du dossier, recompter le groupe ne la ramene pas en arriere
//       (bowling seul, formule, laser seul, partie retiree du planning) ;
//   [J] aucune erreur JS ;
//   [K] LE CANAL PUBLIC N ENTRE PAS DANS LA MODIFICATION : un corps qui se dit
//       « modification » n y gagne ni le chemin, ni son propre plan ;
//   [L] UN DOSSIER A PLACER, DEPLACE PAR MODIFIER, TIENT L ARENE a sa nouvelle heure.
// --contre-preuves : chaque regle retiree (au code servi, ou compile en memoire
// cote serveur ; le disque n est jamais touche) fait rougir sa lettre.
//   HD_MUTATIONS : un sous-ensemble ; HD_BAVARD : les lignes des contre-preuves.
'use strict';
const fs = require('fs');
const path = require('path');
// La base en memoire et le faux 'pg' s installent au require, avant tout module
// de lib/ (aucune base reelle n est jamais ouverte).
const B = require('./reserver-banc.js');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');
const { plusJours } = require('./jour-de-test');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_HEURES_DOSSIER_PORT || 5193);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const CORE = 'assets/booking-core.js';
const API = 'api/staff-reservations.js';
const MOTEUR = 'lib/ops-engine.js';
const OPS = 'lib/reservation-ops.js';
const BASE = 'lib/database.js';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

const ARTHUR = 1600; // Formule 3, plan a heures, arrive, 9 personnes, pistes 3 et 4
const NOAH = 1596; // Formule 4, paye, bowling 14:00, laser 16:00 et 16:30
const LINA = 1601; // Formule 5, laser seul, arrivee, 11 personnes
const LAMBERT = 1609; // Matin malin (fenetre ouverte), arrivee, en cours depuis 10:00
const CLARA = 1634; // bowling 15:00, pistes 6 et 7, toutes les autres prises
const NOEL = 1637; // bowling 16:30, piste 6
const MANON = 1618; // laser seul, deux parties, 15:30 et 16:00
const SACHA = 1604; // Formule 1, bowling 15:30, laser 17:30

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`);
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
// L HEURE DU SERVEUR. Le temps d une requete, global.Date est au jour de la
// fixture : todayStr et le plancher du moteur la lisent a l appel. Hors requete,
// la vraie date : Playwright vit dans ce processus, et son journal d horloge
// casse les minuteurs de la page au-dela de 24,8 jours d ecart
// (scripts/gates-horloge.js).
// ---------------------------------------------------------------------------
const VraieDate = Date;
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
async function auJour(travail, heure = '15:10', jour = JOUR) {
  const ecart = new VraieDate(FX.instant(jour, heure)).getTime() - VraieDate.now();
  class Fausse extends VraieDate {
    constructor(...a) { if (a.length === 0) super(VraieDate.now() + ecart); else super(...a); }
    static now() { return VraieDate.now() + ecart; }
  }
  global.Date = Fausse;
  try { return await travail(); } finally { global.Date = VraieDate; }
}

// « Arrivé » ecrit par setReservationStatus (lib/database.js) : sa requete, sur
// la vue de la transaction du client, comme les ecritures du banc.
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

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes (l inverse de mapReservation).
// ---------------------------------------------------------------------------
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
  return { pax: Number(row.pax), price: Number(row.price), status: row.status, type: row.type, formuleId: row.formule_id || '', lanes: (row.lanes || []).map(Number), program: row.program, plan };
}
const dossier = (id) => FIXTURE.staffState.reservations.find((r) => r.id === id);
// Une activite du plan : `Minigolf@14:35-15:20`, ou sans heure (`~`).
const lignePlan = (e) => `${e.activityId}#${e.countIndex || 1}@${e.flexible ? '~' : `${e.startTime}-${e.endTime}`}`;
const etapes = (plan) => ((plan && plan.timeline) || []).filter((e) => e && e.activityId).map(lignePlan).sort();
const etape = (plan, activityId, rang = 1) => ((plan && plan.timeline) || []).find((e) => e && e.activityId === activityId && Number(e.countIndex || 1) === rang) || null;
const blocs = (plan) => ((plan && plan.resourceBlocks) || []).map((b) => `${b.resourceType}#${b.countIndex || 1}@${b.startTime}-${b.endTime}:${(b.lanes || []).join('-')}`).sort();
// Ce qui compte pour le groupe d une formule a table : quand il arrive, quand la table
// commence, quand commence sa premiere activite.
const reperesDeTable = (plan) => {
  const activites = ((plan && plan.timeline) || []).filter((e) => e && e.activityId && e.activityId !== 'party_table' && e.activityId !== 'service_drinks')
    .sort((x, y) => String(x.startTime).localeCompare(String(y.startTime)));
  return { arrivee: plan && plan.arrivalTime, table: (etape(plan, 'party_table') || {}).startTime, premiere: activites[0] ? `${activites[0].activityId}@${activites[0].startTime}` : '' };
};

// ---------------------------------------------------------------------------
// DANS LA PAGE.
// ---------------------------------------------------------------------------
function lireCase({ id, titre }) {
  const tr = document.querySelector(`[data-gf-id="${id}"]`);
  const td = tr && tr.querySelector(`td.gf-a[data-gf-titre="${titre}"]`);
  const x = td && td.querySelector('.gf-x');
  return { ligne: Boolean(tr), texte: x ? x.textContent.replace(/\s+/g, ' ').trim() : '', titre: x ? x.getAttribute('title') || '' : '' };
}
const uneCase = (page, id, titre) => page.evaluate(lireCase, { id, titre });
const toastDe = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
function lireBulle() {
  const pop = document.getElementById('comptePop');
  if (!pop) return { ouverte: false };
  const n = pop.querySelector('output');
  const e = pop.querySelector('.compte-pop__erreur');
  return { ouverte: true, n: n ? Number(n.textContent) : null, erreur: e ? e.textContent.replace(/\s+/g, ' ').trim() : '' };
}
async function compter(page, id, delta, fois) {
  await page.locator(`[data-gf-id="${id}"] [data-compte-id]`).first().scrollIntoViewIfNeeded();
  await page.locator(`[data-gf-id="${id}"] [data-compte-id]`).first().click();
  await page.waitForSelector('#comptePop', { timeout: 5000 });
  for (let i = 0; i < fois; i += 1) await page.locator(`#comptePop [data-compte-pas="${delta}"]`).click();
  await page.waitForTimeout(120);
  await page.locator('#comptePop .compte-pop__ok').click();
  await page.waitForFunction(() => !document.getElementById('comptePop') || (document.querySelector('#comptePop .compte-pop__erreur') && !document.querySelector('#comptePop.is-occupe')), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(250);
  return { bulle: await page.evaluate(lireBulle), toast: await toastDe(page) };
}
async function ouvrirModifier(page, id) {
  await page.evaluate((i) => { closePos(); openPos(i); setTab('modifier'); }, id);
  await page.waitForSelector('#posOverlay .fm-joueurs', { timeout: 8000 });
  await page.waitForTimeout(250);
}
async function enregistrerModifier(page) {
  await page.locator('#posOverlay button', { hasText: /^Enregistrer$/ }).first().click();
  await page.waitForFunction(() => !document.querySelector('#posOverlay .fm-joueurs') || (document.getElementById('editError') && document.getElementById('editError').textContent.trim()), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(350);
  return toastDe(page);
}
// Le pointeur, du haut d une carte de bowling jusqu a la cellule piste/heure.
async function glisser(page, id, lane, heure) {
  const points = await page.evaluate(({ id, lane, heure }) => {
    const carte = document.querySelector(`.booking[data-booking-res-id="${id}"]`);
    const cellule = document.querySelector(`.slot-cell.clickable[data-bowling-drop-lane="${lane}"][data-bowling-drop-start="${heure}"]`);
    if (!carte) return null;
    carte.scrollIntoView({ block: 'center' });
    const a = carte.getBoundingClientRect();
    const c = cellule ? cellule.getBoundingClientRect() : (() => {
      // (la cellule est sous une carte : la colonne et la hauteur de la carte)
      const col = document.querySelector(`#planningGridWrap .lane-col[data-lane="${lane}"]`).getBoundingClientRect();
      return { left: col.left, width: col.width, top: a.top, height: 8 };
    })();
    return { de: { x: a.left + a.width / 2, y: a.top + 12 }, vers: { x: c.left + c.width / 2, y: c.top + Math.min(8, c.height / 2) } };
  }, { id, lane, heure });
  if (!points) return null;
  await page.mouse.move(points.de.x, points.de.y);
  await page.mouse.down();
  await page.mouse.move(points.de.x + 12, points.de.y + 2, { steps: 3 });
  await page.mouse.move(points.vers.x, points.vers.y, { steps: 8 });
  await page.waitForTimeout(220);
  const apercu = await page.evaluate(() => Array.from(document.querySelectorAll('.bowling-drop-preview')).map((p) => ({ invalide: p.classList.contains('invalid'), texte: p.textContent.replace(/\s+/g, ' ').trim() })));
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { apercu };
}
const avisDe = (page) => page.evaluate(() => { const n = document.getElementById('planningMoveNotice'); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; });

function monterServeur() {
  B.semer(FIXTURE.staffState.reservations.map(ligneDepuis));
  // Direction : ce gate parle des heures, pas du plafond de prix d un role.
  return B.monter({ mutations: mutation ? mutation.editions.filter((ed) => ed.serveur) : [], session: B.sessionDuRole('direction', { nom: 'Rachel' }) });
}
async function monter(browser, serveur) {
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'pic', appareil: 'ordinateur', theme: 'dark', port: PORT, heure: '15:10',
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (corps) => { journal.push(corps); return auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corps)); });
    },
  });
  return { ...m, journal };
}
// Le corps que la console envoie pour ce dossier (le dossier entier).
function corpsDe(r, champs = {}) {
  const lanes = (r.lanes || []).length;
  return { ...r, centerId: 'libramont', requiresLanes: lanes > 0, laneCount: lanes, allowPastStart: true, baseUpdatedAt: r.updatedAt, prixRaison: 'Prix revu au comptoir', ...champs };
}

// ---------------------------------------------------------------------------
// [A] LE COMPTE D UNE FORMULE A HEURES.
// ---------------------------------------------------------------------------
async function scenarioCompte(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs } = await monter(browser, serveur);
  try {
    const avant = etapes(dossier(ARTHUR).opsPlan);
    const blocsAvant = blocs(dossier(ARTHUR).opsPlan);
    const finAvant = dossier(ARTHUR).opsPlan.endTime;
    const totalAvant = dossier(ARTHUR).opsPlan.totalMinutes;
    ok(avant.includes('minigolf_blacklight#1@14:35-15:20') && avant.includes('arcade_time#1@15:25-15:55') && finAvant === '16:10',
      '[A] MONTAGE Arthur a ses heures : minigolf 14:35, arcades 15:25, fin 16:10', { avant, finAvant });
    // Le suivi des activites, ce que le comptoir coche : les boissons y ont leur heure.
    const suivi = () => page.evaluate((id) => getFormulaActivityChecklist(state.reservations.find((x) => x.id === id)).map((i) => `${i.key}@${i.startTime}`), ARTHUR);
    const suiviAvant = await suivi();
    const compte = await compter(page, ARTHUR, 1, 1);
    const b = enBase(ARTHUR);
    ok(!compte.bulle.ouverte && b.pax === 10 && b.status === 'arrived',
      '[A] 15:10, un de plus : le compte d un groupe deja en cours passe, le serveur ecrit 10', { compte, pax: b.pax });
    ok(/10 personnes/.test(compte.toast), '[A] le toast dit 10 personnes', compte.toast);
    ok(JSON.stringify(etapes(b.plan)) === JSON.stringify(avant),
      '[A] le plan garde chaque activite a son heure, boissons comprises', { avant, apres: etapes(b.plan) });
    ok(JSON.stringify(blocs(b.plan)) === JSON.stringify(blocsAvant), '[A] le bowling reste a son heure, sur ses pistes', { avant: blocsAvant, apres: blocs(b.plan) });
    ok(b.plan.endTime === finAvant && b.plan.totalMinutes === totalAvant,
      '[A] la fin de visite ne recule pas : 16:10, 155 min', { fin: b.plan.endTime, total: b.plan.totalMinutes });
    const mini = await uneCase(page, ARTHUR, 'Minigolf');
    const arcades = await uneCase(page, ARTHUR, 'Arcades');
    ok(mini.texte === '14:35' && arcades.texte === '15:25', '[A] la feuille dit minigolf 14:35 et arcades 15:25', { mini, arcades });
    const suiviApres = await suivi();
    ok(JSON.stringify(suiviApres) === JSON.stringify(suiviAvant), '[A] le suivi des activites garde ses heures', { avant: suiviAvant, apres: suiviApres });

    // Paye veut dire arrive : Noah a paye, Modifier le compte de la meme facon.
    const noahAvant = etapes(dossier(NOAH).opsPlan);
    await ouvrirModifier(page, NOAH);
    await page.locator('#posOverlay .fm-joueurs [aria-label="Un joueur de plus"]').click();
    const toastNoah = await enregistrerModifier(page);
    const n = enBase(NOAH);
    ok(n.pax === 11 && n.status === 'paid' && JSON.stringify(etapes(n.plan)) === JSON.stringify(noahAvant),
      '[A] un groupe paye (Noah), un de plus par Modifier : ecrit, il reste paye, chaque activite a son heure', { toastNoah, pax: n.pax, statut: n.status, avant: noahAvant, apres: etapes(n.plan) });
    ok(erreurs.length === 0, '[J] compte : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// Chaque formule de la journee, un de plus : ses heures, ou un refus qui dit
// pourquoi. Jamais les heures perdues, jamais le plan non refait en silence.
async function scenarioToutesLesFormules() {
  const formules = FIXTURE.staffState.reservations.filter((r) => r.type === 'formule' || r.formuleId);
  for (const r of formules) {
    const serveur = monterServeur();
    const rep = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(r, { pax: r.pax + 1 })));
    const quoi = `${r.id} ${r.formuleId} ${r.startTime}`;
    if (rep.statut === 200) {
      const b = enBase(r.id);
      // LES FORMULES A TABLE (f6, f7, f8) n ont aucune heure posee : un de plus refait leur
      // plan avec la regle d aujourd hui. Ces dossiers ont ete enregistres avec l ancien
      // calcul (boissons de 5 min, battement entre les etapes) : leurs etapes internes se
      // resserrent et leur fin avec elles. C est accepte (2026-11-04) : ce qui compte pour
      // le groupe ne bouge pas. Les formules a heures gardent la regle entiere.
      if (etape(r.opsPlan, 'party_table')) {
        const avant = reperesDeTable(r.opsPlan);
        const apres = reperesDeTable(b.plan);
        ok(!rep.json.planNonRefait && avant.arrivee && avant.table && avant.premiere && JSON.stringify(apres) === JSON.stringify(avant),
          `[A] ${quoi} : un de plus a table, l arrivee, la table et la premiere activite restent`, { motif: rep.json.planNonRefait, avant, apres });
        continue;
      }
      ok(!rep.json.planNonRefait && JSON.stringify(etapes(b.plan)) === JSON.stringify(etapes(r.opsPlan)) && b.plan.endTime >= r.opsPlan.endTime,
        `[A] ${quoi} : un de plus, les heures et la fin restent`, { motif: rep.json.planNonRefait, avant: etapes(r.opsPlan), apres: etapes(b.plan), fin: [r.opsPlan.endTime, b.plan.endTime] });
    } else {
      ok(rep.statut >= 400 && rep.statut < 500 && rep.json.message && !/relancer la recherche/.test(rep.json.message) && enBase(r.id).pax === r.pax,
        `[A] ${quoi} : un refus dit son motif, rien n est ecrit`, { statut: rep.statut, message: rep.json.message });
    }
  }
}

// ---------------------------------------------------------------------------
// [B] UNE FORMULE A ANCRES.
// ---------------------------------------------------------------------------
const ANCREE = (heure) => ({ centerId: 'libramont', channel: 'staff', date: JOUR, name: 'Groupe ancré', phone: '0470000000', email: '', status: 'pending', type: 'formule', formuleId: 'f3', pax: 8, startTime: heure, duration: 1, lanes: [], laneCount: 2, requiresLanes: true, preference: { preferredTimes: { bowling: heure }, laserGameTimes: [], laserPlacement: 'scheduled' } });
async function scenarioAncree(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs } = await monter(browser, serveur);
  try {
    // Reservee le matin, comme le tunnel et la fenetre Reserver : bowling a
    // 13:00. Le groupe arrive ; a 15:10, son bowling est fini, sa visite court
    // encore (jusqu a 15:25), ses activites libres sans heure.
    const cree = await auJour(() => serveur.appeler('POST', '/api/staff-reservations', ANCREE('13:00')), '09:00');
    const r = cree.json.reservation;
    ok(cree.statut === 201 && r && r.opsPlan && r.opsPlan.anchorPlan, '[B] MONTAGE une formule creee a son heure d ancre, plan a ancres', { statut: cree.statut, message: cree.json.message });
    if (!r) return;
    B.base.reservations.get(r.id).status = 'arrived';
    await page.evaluate((d) => {
      const dossier = { ...d, status: 'arrived' };
      window.__FIXTURE__.jours[window.__FIXTURE__.jour].push(dossier);
      upsertReservationInState(dossier);
      renderStaffData();
    }, r);
    await page.waitForSelector(`[data-gf-id="${r.id}"]`, { timeout: 8000 });
    const debut = '13:00';
    const mini = await uneCase(page, r.id, 'Minigolf');
    const arcades = await uneCase(page, r.id, 'Arcades');
    ok(mini.ligne && !mini.texte.includes(debut) && !arcades.texte.includes(debut) && !mini.titre.includes(`à ${debut}`) && !arcades.titre.includes(`à ${debut}`),
      '[B] la feuille ne donne pas aux activites libres l heure de debut de la visite', { mini, arcades });
    const span = await page.evaluate((id) => getStaffTerrainSpan(state.reservations.find((x) => x.id === id)), r.id);
    const fin = (() => { const [h, m] = r.opsPlan.endTime.split(':').map(Number); return h + m / 60 - Number(r.opsPlan.bufferMinutes || 0) / 60; })();
    ok(Math.abs(span.end - fin) < 0.02, '[B] la visite dure jusqu a sa fin, pas jusqu au dernier bloc a heure', { span, fin });
    const compte = await compter(page, r.id, 1, 1);
    const b = enBase(r.id);
    ok(!compte.bulle.ouverte && b.pax === 9, '[B] recomptee apres son debut, elle passe : le serveur ecrit 9', { compte, pax: b.pax });
    ok(JSON.stringify(blocs(b.plan)) === JSON.stringify(blocs(r.opsPlan)) && JSON.stringify(etapes(b.plan)) === JSON.stringify(etapes(r.opsPlan)),
      '[B] son bowling reste a son heure, le libre reste sans heure', { avant: etapes(r.opsPlan), apres: etapes(b.plan) });
    ok(erreurs.length === 0, '[J] ancree : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [C] UN REFUS SE DIT.
// ---------------------------------------------------------------------------
async function scenarioRefus(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs } = await monter(browser, serveur);
  try {
    // Avec pistes : le moteur refuse sous le minimum, la base garde son refus.
    const avec = await compter(page, ARTHUR, -1, 6);
    ok(avec.bulle.ouverte && /Minimum 6 personnes/.test(avec.bulle.erreur) && /Rien n’a été enregistré/.test(avec.bulle.erreur) && enBase(ARTHUR).pax === 9,
      '[C] Arthur a 3 : la bulle dit le motif du moteur, rien n est ecrit', { bulle: avec.bulle, pax: enBase(ARTHUR).pax });
    await page.keyboard.press('Escape');
    // Sans piste, le dossier s ecrit sur l ancien plan : le toast le dit.
    const sans = await compter(page, LINA, -1, 7);
    ok(enBase(LINA).pax === 4 && /planning n’a pas suivi/.test(sans.toast) && /Minimum 6 personnes/.test(sans.toast),
      '[C] Lina a 4, sans piste : ecrit, et le toast dit que le planning n a pas suivi, et pourquoi', { toast: sans.toast, pax: enBase(LINA).pax });
    // La meme chose par Modifier.
    await ouvrirModifier(page, LINA);
    await page.locator('#posOverlay .fm-joueurs [aria-label="Un joueur de moins"]').click();
    const toast = await enregistrerModifier(page);
    ok(enBase(LINA).pax === 3 && /planning n’a pas suivi/.test(toast) && /Minimum 6 personnes/.test(toast),
      '[C] par Modifier aussi : jamais « mise à jour » tout court', { toast, pax: enBase(LINA).pax });
    ok(erreurs.length === 0, '[J] refus : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [D] UN LASER AJOUTE DEPUIS MODIFIER.
// ---------------------------------------------------------------------------
async function scenarioLaser(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    const tropAvant = await page.evaluate(() => (document.body.innerText.match(/\d+ de trop/g) || []).length);
    await ouvrirModifier(page, ARTHUR);
    const chip = page.locator('#posOverlay button', { hasText: /^Laser Game$/ }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(500);
    const toast = await enregistrerModifier(page);
    const b = enBase(ARTHUR);
    const pass = (b.plan && b.plan.laserPassPlan) || {};
    ok(journal.length === 1 && !blocs(b.plan).some((x) => x.startsWith('laser_arena')) && (pass.pendingPasses || []).length === 1 && !(pass.scheduledPasses || []).length,
      '[D] le serveur refait le plan a 15:10 : aucune heure de laser, une partie a placer', { envois: journal.length, blocs: blocs(b.plan), pass });
    const ecran = await page.evaluate((id) => {
      const r = state.reservations.find((x) => x.id === id);
      return { fenetres: getLaserWindowsFromReservation(r).map((w) => w.start), attente: getPendingLaserPassesForReservation(r).map((p) => p.unitKey), trop: (document.body.innerText.match(/\d+ de trop/g) || []).length };
    }, ARTHUR);
    const laser = await uneCase(page, ARTHUR, 'Laser');
    ok(ecran.fenetres.length === 0 && ecran.attente.join() === '1.1', '[D] la console n invente aucune heure : la partie attend dans la file', ecran);
    ok(ecran.trop <= tropAvant, '[D] aucun « de trop » de plus sur la journee', { avant: tropAvant, apres: ecran.trop });
    ok(/à placer/i.test(`${laser.texte} ${laser.titre}`) && !/15:00/.test(`${laser.texte} ${laser.titre}`), '[D] la feuille dit « à placer », jamais 15:00', laser);
    ok(/1 partie de laser à placer/.test(toast), '[D] le toast dit la partie a placer', toast);
    ok(/visite à la carte/.test(toast), '[D] le toast dit que la formule devient une visite a la carte', toast);
    ok(etape(b.plan, 'minigolf_blacklight') && etape(b.plan, 'minigolf_blacklight').startTime === '14:35' && !etape(b.plan, 'minigolf_blacklight').flexible
      && etape(b.plan, 'arcade_time') && etape(b.plan, 'arcade_time').startTime === '15:25',
      '[D] le plan refait garde aussi les heures du minigolf et des arcades', etapes(b.plan));
    // L equipe la place : un vrai placement, le serveur confirme.
    const place = await page.evaluate((id) => scheduleLaserPass(id, '1.1', 16.5), ARTHUR);
    await page.waitForTimeout(200);
    const posee = await page.evaluate((id) => { const r = state.reservations.find((x) => x.id === id); return { fenetres: getLaserWindowsFromReservation(r).map((w) => w.start), attente: getPendingLaserPassesForReservation(r).length }; }, ARTHUR);
    ok(place !== false && posee.fenetres.join() === '16.5' && posee.attente === 0 && blocs(enBase(ARTHUR).plan).some((x) => x.startsWith('laser_arena#1@16:30')),
      '[D] placee par l equipe a 16:30, elle sort de la file, ecrite par le serveur', { place, posee, blocs: blocs(enBase(ARTHUR).plan), avis: await avisDe(page) });
    ok(erreurs.length === 0, '[J] laser : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// Deux parties ajoutees : aucune n a d heure, et placer l une ne fabrique pas l autre.
async function scenarioDeuxParties(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs } = await monter(browser, serveur);
  try {
    await ouvrirModifier(page, ARTHUR);
    const chip = page.locator('#posOverlay button', { hasText: /^Laser Game$/ }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(400);
    await page.locator('#posOverlay [aria-label="Nombre de parties Laser Game"] button', { hasText: '2' }).click();
    await page.waitForTimeout(300);
    const toast = await enregistrerModifier(page);
    const lire = () => page.evaluate((id) => { const r = state.reservations.find((x) => x.id === id); return { fenetres: getLaserWindowsFromReservation(r).map((w) => w.start), attente: getPendingLaserPassesForReservation(r).map((p) => p.unitKey) }; }, ARTHUR);
    const avant = await lire();
    ok(avant.fenetres.length === 0 && avant.attente.join() === '1.1,2.1' && /2 parties de laser à placer/.test(toast),
      '[D] deux parties ajoutees : toutes deux a placer, le toast le dit', { avant, toast });
    await page.evaluate((id) => scheduleLaserPass(id, '1.1', 16.5), ARTHUR);
    await page.waitForTimeout(250);
    const apres = await lire();
    ok(apres.fenetres.join() === '16.5' && apres.attente.join() === '2.1' && blocs(enBase(ARTHUR).plan).filter((x) => x.startsWith('laser_arena')).length === 1,
      '[D] placer la premiere ne fabrique pas la seconde : elle reste a placer', { apres, blocs: blocs(enBase(ARTHUR).plan), avis: await avisDe(page) });
    ok(erreurs.length === 0, '[J] deux parties : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [E] UN DEPLACEMENT QUI NE DEPLACE RIEN.
// ---------------------------------------------------------------------------
async function scenarioGlisser(browser) {
  const serveur = monterServeur();
  const { ctx, page, erreurs, journal } = await monter(browser, serveur);
  try {
    await page.evaluate(() => { openStaffPlanningResource('bowling'); });
    await page.waitForSelector(`.booking[data-booking-res-id="${CLARA}"]`, { timeout: 8000 });
    await page.waitForTimeout(400);
    // Clara, deux pistes : sur la piste 2, prise ; il ne reste que les siennes.
    const prise = await glisser(page, CLARA, 2, 15);
    const avis = await avisDe(page);
    const toast = await toastDe(page);
    ok(prise && journal.length === 0, '[E] Clara sur une piste prise : aucun PATCH ne part', { prise, envois: journal.length });
    ok(prise && prise.apercu.length > 0 && prise.apercu.every((a) => a.invalide), '[E] l aperçu le dit pendant le geste', prise);
    ok(/non déplacé/.test(avis) && !/Bowling déplacé/.test(toast), '[E] l avis dit « non déplacé », jamais « déplacé »', { avis, toast });
    // Reposee sur sa propre case : rien, pas meme un avis.
    await page.evaluate(() => document.getElementById('planningMoveNotice')?.remove());
    await glisser(page, CLARA, 6, 15);
    const surPlace = await avisDe(page);
    ok(journal.length === 0 && !surPlace, '[E] reposee sur sa place : rien ne part, rien ne se dit', { envois: journal.length, surPlace });
    // La selection (M, puis valider) et Shift : la meme regle.
    const selection = await page.evaluate((id) => scheduleBowlingSelection({ reservationId: id, sourceLanes: [6, 7], targetLane: 6, targetStart: 15 }), CLARA);
    ok(selection === false && journal.length === 0, '[E] une selection sur place : rien ne part', { selection, envois: journal.length });
    // Avec une vraie panne, le conflit se dit comme avant.
    await page.evaluate(() => { state.laneStatuses[7] = 'maintenance'; });
    await page.evaluate((id) => scheduleBowlingDrag(id, 2, 15, 6, 15, false), CLARA);
    await page.waitForTimeout(150);
    const panne = await avisDe(page);
    ok(/Conflit de pistes/.test(panne) && journal.length === 0, '[E] une piste en panne : « Conflit de pistes », rien ne part', { panne, envois: journal.length });
    await page.evaluate(() => { delete state.laneStatuses[7]; });
    // Noel, une piste : il se deplace, le toast le dit, le serveur l ecrit.
    await glisser(page, NOEL, 7, 16.5);
    await page.waitForTimeout(300);
    const toastNoel = await toastDe(page);
    ok(journal.length === 1 && journal[0].activityMove && enBase(NOEL).lanes.join() === '7' && /Bowling déplacé/.test(toastNoel),
      '[E] Noel, une piste : il se deplace vraiment', { envois: journal.map((j) => j.activityMove), lanes: enBase(NOEL).lanes, toast: toastNoel });
    ok(erreurs.length === 0, '[J] glisser : aucune erreur JS', erreurs.slice(0, 3));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [F] [G] [H] LE MOTEUR, SANS NAVIGATEUR.
// ---------------------------------------------------------------------------
async function scenarioMoteur() {
  // [F] LA FENETRE OUVERTE : Lambert, Matin malin depuis 10:00, recompte a 15:10.
  let serveur = monterServeur();
  const lambert = dossier(LAMBERT);
  const fenetre = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(lambert, { pax: 9, compteArrivee: true })));
  ok(fenetre.statut === 200 && !fenetre.json.planNonRefait && enBase(LAMBERT).pax === 9 && JSON.stringify(etapes(enBase(LAMBERT).plan)) === JSON.stringify(etapes(lambert.opsPlan)),
    '[F] une formule a fenetre ouverte en cours se recompte : le plan suit, ses heures restent', { statut: fenetre.statut, motif: fenetre.json.planNonRefait, message: fenetre.json.message, avant: etapes(lambert.opsPlan), apres: etapes((enBase(LAMBERT) || {}).plan) });

  // [F] UN PLAN PAR HEURE D ARRIVEE : la meme porte.
  serveur = monterServeur();
  const parArrivee = { ...ANCREE('12:30'), startTime: '12:00', preference: { arrivalTime: '12:00', preferredTimes: { bowling: '12:30' }, laserGameTimes: [], laserPlacement: 'scheduled' } };
  const cree = await auJour(() => serveur.appeler('POST', '/api/staff-reservations', parArrivee), '09:00');
  const r = cree.json.reservation;
  ok(cree.statut === 201 && r && r.opsPlan && r.opsPlan.arrivalPlan, '[F] MONTAGE une formule planifiee par son heure d arrivee', { statut: cree.statut, message: cree.json.message });
  if (r) {
    const rep = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(r, { pax: 9 })));
    ok(rep.statut === 200 && !rep.json.planNonRefait && enBase(r.id).pax === 9 && JSON.stringify(blocs(enBase(r.id).plan)) === JSON.stringify(blocs(r.opsPlan)),
      '[F] par heure d arrivee, recomptee a 15:10 : le plan suit, le bowling reste', { statut: rep.statut, motif: rep.json.planNonRefait, message: rep.json.message });
  }

  // [G] LE PLANCHER GARDE LA VENTE.
  serveur = monterServeur();
  const { prepareReservationOps } = require(path.join(ROOT, OPS));
  const vide = { readState: async () => ({ reservations: [], laneStatuses: {} }) };
  const plan = (corps, canal) => auJour(() => prepareReservationOps(corps, canal, vide));
  const avecDrapeau = await plan({ ...ANCREE('14:00'), allowPastStart: true }, 'staff');
  const sansDrapeau = await plan(ANCREE('14:00'), 'staff');
  const enLigne = await plan({ ...ANCREE('14:00'), channel: 'public', allowPastStart: true }, 'public');
  const fenetreEnLigne = await plan({ centerId: 'libramont', channel: 'public', allowPastStart: true, date: JOUR, name: 'Client', phone: '0470000000', email: 'client@example.test', type: 'formule', formuleId: 'mm', pax: 8, startTime: '10:00', duration: 1, preference: {} }, 'public');
  const arriveeEnLigne = await plan({ ...ANCREE('14:00'), channel: 'public', allowPastStart: true, startTime: '13:30', preference: { arrivalTime: '13:30', preferredTimes: { bowling: '14:00' }, laserGameTimes: [], laserPlacement: 'scheduled' } }, 'public');
  ok(avecDrapeau.planAvailable === true, '[G] MONTAGE au comptoir, avec le drapeau, 14:00 a 15:10 se pose', { motif: avecDrapeau.planRefusal });
  ok(sansDrapeau.planAvailable === false, '[G] au comptoir, sans le drapeau, 14:00 a 15:10 reste refuse', { plan: sansDrapeau.planAvailable });
  ok(enLigne.planAvailable === false, '[G] en ligne, le drapeau n ouvre rien : 14:00 a 15:10 reste refuse', { plan: enLigne.planAvailable });
  ok(fenetreEnLigne.planAvailable === false, '[G] en ligne, une fenetre ouverte passee reste refusee', { plan: fenetreEnLigne.planAvailable });
  ok(arriveeEnLigne.planAvailable === false, '[G] en ligne, une arrivee passee reste refusee', { plan: arriveeEnLigne.planAvailable });

  // [H] UN DOSSIER DEPLACE D UN BLOC GARDE L ECART.
  serveur = monterServeur();
  const arthur = dossier(ARTHUR);
  const decale = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(arthur, { startTime: '13:00' })));
  const d = enBase(ARTHUR);
  ok(decale.statut === 200 && etape(d.plan, 'bowling').startTime === '13:00' && etape(d.plan, 'minigolf_blacklight').startTime === '14:05' && etape(d.plan, 'arcade_time').startTime === '14:55' && d.plan.endTime === '15:40',
    '[H] Arthur avance a 13:00 : tout suit de 30 minutes, minigolf 14:05, arcades 14:55, fin 15:40', { statut: decale.statut, message: decale.json.message, etapes: etapes(d.plan), fin: d.plan && d.plan.endTime });

  // [H] UN DOSSIER D HIER SE CORRIGE ENCORE : la date passee, comme l heure passee,
  // ne ferme que la vente.
  serveur = monterServeur();
  const hier = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(arthur, { pax: 10 })), '10:00', plusJours(JOUR, 1));
  ok(hier.statut === 200 && !hier.json.planNonRefait && enBase(ARTHUR).pax === 10 && JSON.stringify(etapes(enBase(ARTHUR).plan)) === JSON.stringify(etapes(arthur.opsPlan)),
    '[H] le lendemain, un dossier d hier se corrige et garde ses heures', { statut: hier.statut, message: hier.json.message, motif: hier.json.planNonRefait, etapes: etapes(enBase(ARTHUR).plan) });

  // [H] UNE HEURE QUE LE NOUVEAU PLAN OCCUPE : le minigolf du dossier tombe sur le
  // bowling : sans heure, jamais une heure fausse.
  serveur = monterServeur();
  const copie = JSON.parse(JSON.stringify(arthur));
  const mini = copie.opsPlan.timeline.find((e) => e.activityId === 'minigolf_blacklight');
  Object.assign(mini, { start: 840, end: 885, startTime: '14:00', endTime: '14:45' });
  B.base.reservations.get(ARTHUR).ops_plan = copie.opsPlan;
  const occupe = await auJour(() => serveur.appeler('PATCH', '/api/staff-reservations', corpsDe(copie, { pax: 10 })));
  const o = enBase(ARTHUR);
  ok(occupe.statut === 200 && etape(o.plan, 'minigolf_blacklight').flexible === true && etape(o.plan, 'arcade_time').startTime === '15:25',
    '[H] une heure qui tombe sur le bowling redevient sans heure, l autre reste', { statut: occupe.statut, message: occupe.json.message, etapes: etapes(o.plan) });

  // [I] UN GESTE DU PLANNING SURVIT AU COMPTE. Deplacer une activite ne change pas
  // l heure du dossier : recompter ne doit pas la ramener a son ancienne heure.
  const url = '/api/staff-reservations';
  const deplacer = (s, r, activityMove) => auJour(() => s.appeler('PATCH', url, { id: r.id, centerId: 'libramont', baseUpdatedAt: r.updatedAt, activityMove }));
  const heuresBlocs = (id) => blocs(enBase(id).plan).map((x) => x.split(':').slice(0, 3).join(':'));

  serveur = monterServeur();
  const noel = dossier(NOEL);
  const noelDeplace = (await deplacer(serveur, noel, { activityId: 'bowling', startTime: '17:00', lanes: [6] })).json.reservation;
  const noelPlus = await auJour(() => serveur.appeler('PATCH', url, corpsDe(noelDeplace, { pax: 5 })));
  ok(noelPlus.statut === 200 && enBase(NOEL).pax === 5 && etape(enBase(NOEL).plan, 'bowling').startTime === '17:00',
    '[I] un bowling glisse a 17:00 puis recompte reste a 17:00', { statut: noelPlus.statut, message: noelPlus.json.message, etapes: etapes(enBase(NOEL).plan) });

  serveur = monterServeur();
  const noelBis = (await deplacer(serveur, noel, { activityId: 'bowling', startTime: '17:00', lanes: [6] })).json.reservation;
  const noelHeure = await auJour(() => serveur.appeler('PATCH', url, corpsDe(noelBis, { startTime: '17:30' })));
  ok(noelHeure.statut === 200 && etape(enBase(NOEL).plan, 'bowling').startTime === '18:00',
    '[I] apres un glisser, changer l heure du dossier decale du meme ecart que la fenetre l annonce : 17:00 -> 18:00', { statut: noelHeure.statut, message: noelHeure.json.message, etapes: etapes(enBase(NOEL).plan) });

  serveur = monterServeur();
  const arthurDeplace = (await deplacer(serveur, arthur, { activityId: 'bowling', startTime: '13:00', lanes: [3, 4] })).json.reservation;
  const arthurPlus = await auJour(() => serveur.appeler('PATCH', url, corpsDe(arthurDeplace, { pax: 10 })));
  const a2 = enBase(ARTHUR);
  ok(arthurPlus.statut === 200 && etape(a2.plan, 'bowling').startTime === '13:00' && etape(a2.plan, 'minigolf_blacklight').startTime === '14:35' && etape(a2.plan, 'arcade_time').startTime === '15:25',
    '[I] une formule au bowling glisse puis recomptee : rien ne bouge', { statut: arthurPlus.statut, message: arthurPlus.json.message, etapes: etapes(a2.plan) });

  serveur = monterServeur();
  const manon = dossier(MANON);
  const manonDeplace = (await deplacer(serveur, manon, { activityId: 'laser_game', unitKey: '1.1', startTime: '18:00' })).json.reservation;
  const manonPlus = await auJour(() => serveur.appeler('PATCH', url, corpsDe(manonDeplace, { pax: 9 })));
  const m2 = enBase(MANON);
  ok(manonPlus.statut === 200 && m2.pax === 9 && heuresBlocs(MANON).join() === 'laser_arena#1@18:00-18:25,laser_arena#2@16:00-16:25'
    && m2.plan.resourceBlocks.every((b) => Number(b.players) === 9) && m2.plan.laserManual === true,
    '[I] un laser place a la main puis recompte : chaque partie reste ou l equipe l a posee, avec 9 joueurs', { statut: manonPlus.statut, message: manonPlus.json.message, blocs: heuresBlocs(MANON), joueurs: (m2.plan.resourceBlocks || []).map((b) => b.players) });

  serveur = monterServeur();
  const sacha = dossier(SACHA);
  const sachaDeplace = (await deplacer(serveur, sacha, { activityId: 'laser_game', unitKey: '1.1', startTime: '20:05' })).json.reservation;
  const sachaPlus = await auJour(() => serveur.appeler('PATCH', url, corpsDe(sachaDeplace, { pax: 11 })));
  ok(sachaPlus.statut === 200 && enBase(SACHA).pax === 11 && heuresBlocs(SACHA).filter((x) => x.startsWith('laser')).join() === 'laser_arena#1@20:05-20:30',
    '[I] une formule dont la partie est hors de la grille : le laser reste ou l equipe l a pose', { statut: sachaPlus.statut, message: sachaPlus.json.message, blocs: heuresBlocs(SACHA) });

  serveur = monterServeur();
  const manonRetiree = (await deplacer(serveur, manon, { activityId: 'laser_game', unitKey: '2.1', unplace: true })).json.reservation;
  const manonPlus2 = await auJour(() => serveur.appeler('PATCH', url, corpsDe(manonRetiree, { pax: 9 })));
  const m3 = enBase(MANON);
  ok(manonPlus2.statut === 200 && heuresBlocs(MANON).join() === 'laser_arena#1@15:30-15:55' && (m3.plan.laserPassPlan.pendingPasses || []).map((p) => p.countIndex).join() === '2',
    '[I] une partie retiree du planning reste a placer apres un compte', { statut: manonPlus2.statut, message: manonPlus2.json.message, blocs: heuresBlocs(MANON), pass: m3.plan.laserPassPlan });
}

async function scenarioSources() {
  // [K] UN VISITEUR FORGE UNE « MODIFICATION » : le meme corps, sans ces champs, ne pose
  // que ce que le moteur tient.
  let serveur = monterServeur();
  B.semer([]);
  const forge = {
    centerId: 'libramont', date: JOUR, pax: 6, type: 'laser', duration: 0.5, totalDuration: 0.5, laserGames: 1, games: 1, phone: '0470111222', channel: 'public', price: 0, name: 'Pirate', email: 'p@example.com', startTime: '20:00',
    ignoreReservationId: 1, heureEnregistree: '20:00', opsPlan: { laserManual: true, resourceBlocks: [{ resourceType: 'laser_arena', startTime: '10:30', endTime: '10:55', countIndex: 1, groupWaveIndex: 1 }], timeline: [] },
  };
  const pirate = await auJour(() => B.appeler(serveur.S.reservations, 'POST', '/api/public-reservations', forge));
  const lu = pirate.json.reservation;
  const heures = lu ? blocs(lu.opsPlan).filter((x) => x.startsWith('laser')) : [];
  ok(pirate.statut === 201 && lu && lu.startTime === '20:00' && heures.length > 0 && heures.every((x) => x.includes('@20:')),
    '[K] un corps public qui se dit modification ne pose pas son plan', { statut: pirate.statut, message: pirate.json.message, debut: lu && lu.startTime, heures });

  // [L] A PLACER, PUIS DEPLACE A 17:00 : le dossier tient ses deux parties, un groupe de
  // 30 n y entre plus.
  serveur = monterServeur();
  B.semer([]);
  const url = '/api/staff-reservations';
  const poser = (champs) => auJour(() => serveur.appeler('POST', url, B.corpsStaff({ date: JOUR, type: 'laser', startTime: '15:00', duration: 0.5, totalDuration: 0.5, laserGames: 1, allowPastStart: true, ...champs })));
  await poser({ pax: 30, name: 'Plein' });
  const aPlacer = (await poser({ pax: 6, duration: 1, totalDuration: 1, laserGames: 2, name: 'À placer', forcer: true })).json.reservation;
  ok(aPlacer && aPlacer.opsPlan && aPlacer.opsPlan.aPlacer, '[L] MONTAGE un dossier a placer, deux parties', aPlacer && aPlacer.opsPlan);
  if (aPlacer) {
    const deplace = await auJour(() => serveur.appeler('PATCH', url, corpsDe(aPlacer, { startTime: '17:00' })));
    const apres = enBase(aPlacer.id);
    const lasers = blocs(apres.plan).filter((x) => x.startsWith('laser'));
    ok(deplace.statut === 200 && lasers.length === 2 && lasers.every((x) => /@17:/.test(x)), '[L] deplace a 17:00, il tient ses deux parties dans l arene', { statut: deplace.statut, message: deplace.json.message, lasers });
    const autre = await poser({ pax: 30, name: 'Autre groupe', startTime: '17:00' });
    ok(autre.statut >= 400, '[L] un groupe de 30 n y entre plus', { statut: autre.statut, message: autre.json.message });
  }
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const COMPTE = ['compte'];
const FORMULES = ['formules'];
const ANCRE = ['ancree'];
const REFUS = ['refus'];
const LASER = ['laser'];
const GLISSER = ['glisser'];
const MOT = ['moteur'];
const SOURCES = ['sources'];
const DRAPEAU = "allowPastStart: input.channel === 'staff' && Boolean(input.allowPastStart),";
const MUTATIONS = [
  { nom: 'public-dans-la-modification', lettre: 'K', scenarios: SOURCES, editions: [{ fichier: OPS, serveur: true, de: 'Number(options.ignoreReservationId || (staff ? request.ignoreReservationId : 0) || 0)', vers: 'Number(options.ignoreReservationId || request.ignoreReservationId || 0)' }, { fichier: OPS, serveur: true, de: "  request.heureEnregistree = options.heureEnregistree || '';\n", vers: '' }] },
  { nom: 'a-placer-sans-arene', lettre: 'L', scenarios: SOURCES, editions: [{ fichier: OPS, serveur: true, de: 'if (!ancien || !ancien.laserManual || ancien.aPlacer) return plan;', vers: 'if (!ancien || !ancien.laserManual) return plan;' }] },
  { nom: 'plancher-sur-les-ancres', lettre: 'A', scenarios: COMPTE, editions: [{ fichier: MOTEUR, serveur: true, de: "    preMinutes: FORMULA_ARRIVAL_MINUTES,\n    allowPastStart,\n  });\n  if (!window.ok) return { ok: false, code: 'schedule', reason: window.reason, scenario: null };", vers: "    preMinutes: FORMULA_ARRIVAL_MINUTES,\n  });\n  if (!window.ok) return { ok: false, code: 'schedule', reason: window.reason, scenario: null };" }] },
  { nom: 'drapeau-non-transmis', lettre: 'A', scenarios: COMPTE, editions: [{ fichier: MOTEUR, serveur: true, de: `    arcadeStart,\n    ${DRAPEAU}\n  });\n\n  const scenarios = result.scenario`, vers: '    arcadeStart,\n  });\n\n  const scenarios = result.scenario' }] },
  { nom: 'heures-du-libre-perdues', lettre: 'A', scenarios: COMPTE, editions: [{ fichier: OPS, serveur: true, de: '    recommended = garderLesHeuresDuLibre(recommended, request.opsPlan, visitStartShiftMinutes(request));\n', vers: '' }] },
  { nom: 'fin-qui-recule', lettre: 'A', scenarios: COMPTE, editions: [{ fichier: OPS, serveur: true, de: '    ...(depassement > 0 ? { endTime: minutesToTime(finGardee + marge), totalMinutes: Number(plan.totalMinutes || 0) + depassement } : {}),\n', vers: '' }] },
  { nom: 'boissons-sans-heure', lettre: 'A', scenarios: COMPTE, editions: [{ fichier: OPS, serveur: true, de: '      type: tenue.type,\n', vers: '' }] },
  { nom: 'refus-sans-motif', lettre: 'A', scenarios: FORMULES, editions: [{ fichier: MOTEUR, serveur: true, de: "  if (date === today && !allowPastStart) {\n", vers: "  if (date === today) {\n" }, { fichier: BASE, serveur: true, de: "throw new Error(input.planRefusal ? `Le planning ne suit pas ce nombre : ${input.planRefusal}` : 'Le nombre de joueurs a changé. Merci de relancer la recherche avant de confirmer.');", vers: "throw new Error('Le nombre de joueurs a changé. Merci de relancer la recherche avant de confirmer.');" }] },
  { nom: 'fausse-heure', lettre: 'B', scenarios: ANCRE, editions: [{ fichier: CORE, de: '    if (step.flexible) return;\n    const occ', vers: '    const occ' }] },
  { nom: 'visite-raccourcie', lettre: 'B', scenarios: ANCRE, editions: [{ fichier: JS, de: '[...getStaffFormulaTimedItems(reservation), ...getFormulaFreeWindows(reservation), ...avant];', vers: '[...getStaffFormulaTimedItems(reservation), ...avant];' }] },
  { nom: 'motif-avale-par-la-base', lettre: 'C', scenarios: REFUS, editions: [{ fichier: BASE, serveur: true, de: "throw new Error(input.planRefusal ? `Le planning ne suit pas ce nombre : ${input.planRefusal}` : 'Le nombre de joueurs a changé. Merci de relancer la recherche avant de confirmer.');", vers: "throw new Error('Le nombre de joueurs a changé. Merci de relancer la recherche avant de confirmer.');" }] },
  { nom: 'api-muette', lettre: 'C', scenarios: REFUS, editions: [{ fichier: API, serveur: true, de: '        ...(planNonRefait ? { planNonRefait } : {}),\n', vers: '' }] },
  { nom: 'compte-muet', lettre: 'C', scenarios: REFUS, editions: [{ fichier: JS, de: '      : payload.planNonRefait\n        ? `${nom} : ${fait.pax} personnes, mais le planning n’a pas suivi : ${payload.planNonRefait}`\n        : `${nom}', vers: '      : `${nom}' }] },
  { nom: 'modifier-muet', lettre: 'C', scenarios: REFUS, editions: [{ fichier: JS, de: '        : payload.planNonRefait\n          ? `Réservation mise à jour, mais le planning n’a pas suivi : ${payload.planNonRefait}`\n          : partiesAPlacer > 0', vers: '        : partiesAPlacer > 0' }] },
  { nom: 'laser-invente', lettre: 'D', scenarios: LASER, editions: [{ fichier: CORE, de: "  if (resourceType === 'laser_arena' && planLaisseLeLaserAPlacer(reservation)) return planned;\n", vers: '' }] },
  { nom: 'laser-hors-de-la-file', lettre: 'D', scenarios: LASER, editions: [{ fichier: CORE, de: ' || planLaisseLeLaserAPlacer(reservation)))) return [];', vers: '))) return [];' }] },
  { nom: 'partie-tue', lettre: 'D', scenarios: LASER, editions: [{ fichier: JS, de: "          : partiesAPlacer > 0\n            ? `Réservation mise à jour : ${partiesAPlacer} partie${partiesAPlacer > 1 ? 's' : ''} de laser à placer au planning.`\n            : 'Réservation mise à jour';", vers: "          : 'Réservation mise à jour';" }] },
  { nom: 'visite-tue', lettre: 'D', scenarios: LASER, editions: [{ fichier: JS, de: 'const dit = devenueVisite ? ', vers: 'const dit = false ? ' }] },
  { nom: 'faux-deplacement', lettre: 'E', scenarios: GLISSER, editions: [{ fichier: JS, de: '  if (bowlingResteEnPlace(reservation, groupStart, lanes)) {\n', vers: '  if (false) {\n' }] },
  { nom: 'apercu-menteur', lettre: 'E', scenarios: GLISSER, editions: [{ fichier: JS, de: "  if (surPlace) return { reservation, targetLane, targetStart, duration, lanes, valid: false, message: 'Aucune autre piste libre' };\n", vers: '' }] },
  { nom: 'selection-sur-place', lettre: 'E', scenarios: GLISSER, editions: [{ fichier: JS, de: '  if(fenetresChoisies.length&&lanes.every(', vers: '  if(false&&lanes.every(' }] },
  { nom: 'fenetre-ouverte', lettre: 'F', scenarios: MOT, editions: [{ fichier: MOTEUR, serveur: true, de: " preMinutes: FORMULA_ARRIVAL_MINUTES, allowPastStart: input.channel === 'staff' && Boolean(input.allowPastStart) });\n  const closeMinutes", vers: ' preMinutes: FORMULA_ARRIVAL_MINUTES });\n  const closeMinutes' }] },
  { nom: 'arrivee-sans-drapeau', lettre: 'F', scenarios: MOT, editions: [{ fichier: MOTEUR, serveur: true, de: `    memo: context.arrivalMemo instanceof Map ? context.arrivalMemo : null,\n    ${DRAPEAU}\n`, vers: '    memo: context.arrivalMemo instanceof Map ? context.arrivalMemo : null,\n' }] },
  { nom: 'porte-de-l-arrivee', lettre: 'F', scenarios: MOT, editions: [{ fichier: MOTEUR, serveur: true, de: 'laserGameTimes: partiesTenues, arrival: arrivee, arcadeStart, allowPastStart,\n', vers: 'laserGameTimes: partiesTenues, arrival: arrivee, arcadeStart,\n' }] },
  { nom: 'plancher-leve-pour-tous', lettre: 'G', scenarios: MOT, editions: [{ fichier: MOTEUR, serveur: true, de: '  if (date === today && !allowPastStart) {\n', vers: '  if (false) {\n' }] },
  { nom: 'drapeau-ouvert-en-ligne', lettre: 'G', scenarios: MOT, editions: [
    { fichier: OPS, serveur: true, de: "allowPastStart: channel === 'staff' && Boolean(request.allowPastStart),", vers: 'allowPastStart: Boolean(request.allowPastStart),' },
    { fichier: MOTEUR, serveur: true, de: `    arcadeStart,\n    ${DRAPEAU}\n  });\n\n  const scenarios = result.scenario`, vers: '    arcadeStart,\n    allowPastStart: Boolean(input.allowPastStart),\n  });\n\n  const scenarios = result.scenario' },
  ] },
  { nom: 'ecart-oublie', lettre: 'H', scenarios: MOT, editions: [{ fichier: OPS, serveur: true, de: '    const debut = heure(tenue.startTime) + ecart;\n    const fin = heure(tenue.endTime) + ecart;\n', vers: '    const debut = heure(tenue.startTime);\n    const fin = heure(tenue.endTime);\n' }] },
  { nom: 'heure-fausse-gardee', lettre: 'H', scenarios: MOT, editions: [{ fichier: OPS, serveur: true, de: '    if (prises.some((bloc) => debut < bloc.fin && bloc.debut < fin)) return;\n', vers: '' }] },
  { nom: 'date-passee', lettre: 'H', scenarios: MOT, editions: [{ fichier: MOTEUR, serveur: true, de: '  if (date < today && !allowPastStart) {\n', vers: '  if (date < today) {\n' }] },
  { nom: 'seconde-partie-fabriquee', lettre: 'D', scenarios: ['deuxParties'], editions: [{ fichier: 'lib/reservation-activity-move.js', serveur: true, de: ' && !old.laserManual && !toutAPlacer) {\n', vers: ' && !old.laserManual) {\n' }] },
  { nom: 'ecart-au-premier-bloc', lettre: 'I', scenarios: MOT, editions: [{ fichier: OPS, serveur: true, de: '  if (avant && request.startTime) return timeToMinutes(String(request.startTime).slice(0, 5)) - timeToMinutes(avant);\n', vers: '' }] },
  { nom: 'heure-non-transmise', lettre: 'I', scenarios: MOT, editions: [{ fichier: API, serveur: true, de: ', heureEnregistree: current.startTime })', vers: ' })' }] },
  { nom: 'bowling-seul-rappele', lettre: 'I', scenarios: MOT, editions: [{ fichier: OPS, serveur: true, de: 'startTime: departDuMoteur(request),', vers: 'startTime: request.startTime,' }] },
  { nom: 'laser-seul-rappele', lettre: 'I', scenarios: MOT, editions: [{ fichier: OPS, serveur: true, de: '    recommended = garderLesPartiesPlacees(recommended, request, visitStartShiftMinutes(request));\n', vers: '' }] },
];

const SCENARIOS = {
  compte: scenarioCompte,
  formules: scenarioToutesLesFormules,
  ancree: scenarioAncree,
  refus: scenarioRefus,
  laser: scenarioLaser,
  deuxParties: scenarioDeuxParties,
  glisser: scenarioGlisser,
  moteur: scenarioMoteur,
  sources: scenarioSources,
};
async function jouer(browser, noms) {
  for (const nom of noms) await SCENARIOS[nom](browser);
}

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = VraieDate.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, liste(process.env.HD_SCENARIOS) || Object.keys(SCENARIOS));
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS.filter((x) => !process.env.HD_MUTATIONS || liste(process.env.HD_MUTATIONS).includes(x.nom))) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.HD_BAVARD;
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
      // (le moteur compile en memoire : on repart du vrai code)
      monterServeur();
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((VraieDate.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nheures-du-dossier-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nheures-du-dossier-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
