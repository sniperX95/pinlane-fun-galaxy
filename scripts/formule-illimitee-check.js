// TOUTES LES ACTIVITES ET LA FORMULE ILLIMITEE (2026-11-18).
//
// Marius, manager de Gembloux, au vocal du 18 novembre : « est-ce que tu pourrais aussi creer un
// onglet dans les formules pour pouvoir choisir l integralite des formules en illimite, comme par
// exemple si moi j ai un petit team building qui vient, ils ont acces a toutes les activites, et
// donc je ne sais pas choisir ca sur le site, je suis oblige de choisir chaque activite ».
//
// Il joue la VRAIE console, le VRAI handler api/staff-reservations.js, le vrai api/ops.js et le vrai
// moteur (scripts/comptoir-banc.js, base et catalogue en memoire), le samedi 16 janvier 2027 a
// 15:10 a Libramont, et verifie toujours le DOSSIER CREE en base, jamais seulement l ecran.
//
//   [A] « TOUTES LES ACTIVITES » AU COMPTOIR. Un toucher met au ticket toutes les activites du
//       centre, et seulement elles (celles que le serveur vend pour ce centre). Le programme est
//       celui qu on aurait compose tuile par tuile ; le prix est celui du programme ; le bouton
//       dit ensuite « Toutes au ticket ». Le dossier cree porte chaque activite ; le bowling et le
//       laser y sont a leur heure, pistes et arene retenues.
//   [B] JAMAIS DEUX GROUPES SUR LA MEME PISTE. Deux groupes « toutes les activites » a la meme
//       heure : chacun ses pistes ; sur toute la journee, aucune piste n est prise deux fois au
//       meme moment, et l arene ne recoit jamais plus de joueurs que d armes.
//   [C] LA FORMULE ILLIMITEE DANS TARIFS & FORMULES. Le manager (droit Tarifs, sans Reglages) la
//       cree : la case « Toutes les activites (illimite) », une duree, un prix par joueur. Au
//       catalogue : toutes les activites du centre et seulement elles (le serveur les relit, une
//       liste forgee ne passe pas), bowling et laser a heure, le reste a volonte, la duree juste,
//       au comptoir seulement ; les clients ne la voient pas. Sans le droit Tarifs, ni bouton ni
//       ecriture.
//   [D] ELLE SE RESERVE AU COMPTOIR. Dans Formules, sa tuile ; au ticket, toutes ses activites ;
//       le dossier cree : la formule, son prix par joueur, pistes et arene retenues, pas moins
//       qu une visite equivalente.
//   [E] UNE FORMULE ORDINAIRE NE CHANGE PAS, OCTET POUR OCTET : lib/formule-comptoir.js et
//       lib/catalog-store.js, relus sans le chemin illimite, rendent les memes formules.
//   [*] Zero erreur JavaScript.
//
// CONTRE-PREUVES : `--contre-preuves` sert le code casse expres, une mutation a la fois (en
// memoire, le disque n est jamais touche) et exige que chacune rougisse sa cible.
// `--seul=A,B` ne joue que ces lettres ; `--ancres` verifie que chaque ancre existe une fois.
// Zero reseau sortant, zero vraie base : rien ne part.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const eclats = require('./gates-eclats.js');
const { trancher } = require('./gates-tranche');
const C = require('./comptoir-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, JOUR } = C;
const PORT = Number(process.env.PINLANE_ILLIMITE_PORT || 4985);
const CASSE = String(process.env.ILLIMITE_CASSE || '');
const lf = (t) => String(t).split('\r\n').join('\n');
const argument = (nom) => { const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };

const APP = 'assets/app-main.js';
const PAGES = 'assets/staff-pages-v2.js';
const FC_FICHIER = 'lib/formule-comptoir.js';
const STORE = 'lib/catalog-store.js';
const OPS = 'api/ops.js';
const VISITE = 'lib/visit-program.js';

// LA MUTATION : une garde retiree expres, une a la fois. `lettre` dit quel scenario la juge,
// `cible` le debut du libelle qui doit rougir, `serveur` qu elle se compile au serveur.
const MUTATIONS = [
  { nom: 'toutes-remplace-le-bowling', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '    s.bowlingParDefaut = false;\n    manquantes.forEach', vers: '    manquantes.forEach' },
  { nom: 'toutes-une-seule', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '    manquantes.forEach((id) => { if (!rsAuTicket(id)) rsPrendre(id); });', vers: '    rsPrendre(manquantes[0]);' },
  { nom: 'toutes-hors-centre', lettre: 'A', cible: '[A] un toucher : toutes les activites du centre au ticket', fichier: APP, de: '  return getQuickBookActivityChoices().map((c) => c.id);\n}', vers: "  return [...getQuickBookActivityChoices().map((c) => c.id), 'golf_oclock'];\n}" },
  { nom: 'toutes-reste-actif', lettre: 'A', cible: '[A] ensuite le bouton dit « Toutes au ticket »', fichier: APP, de: '  if (rsToutesAuTicket()) {', vers: '  if (false) {' },
  { nom: 'visite-sans-ressource', lettre: 'A', cible: '[A] le dossier : bowling et laser a leur heure, pistes et arene retenues', serveur: true, fichier: VISITE, de: '      planned: activity.planned === true,', vers: '      planned: false,' },
  // (Le refus du deuxieme groupe tient a trois gardes du serveur a la fois : le plan du moteur, l attribution
  // des pistes a l ecriture et la relecture des conflits. Retirer l une des deux premieres le laisse refuse, la
  // mesure du 18/11 : aucune ne se prouve seule, elles se prouvent ensemble par ce [B] vert.)
  { nom: 'visite-sans-pistes', lettre: 'B', cible: '[B] le premier groupe prend les deux pistes qui restaient', serveur: true, fichier: VISITE, de: '      planned: activity.planned === true,', vers: '      planned: false,' },
  { nom: 'illimite-fenetre-ouverte', lettre: 'D', cible: '[D] le dossier : la formule, son prix, pistes et arene retenues', serveur: true, fichier: FC_FICHIER, de: "const ORDRE_ILLIMITE = 'illimite';", vers: "const ORDRE_ILLIMITE = 'open_window';" },
  { nom: 'illimite-sans-bowling', lettre: 'C', cible: '[C] au catalogue : toutes les activites du centre, et seulement elles', serveur: true, fichier: FC_FICHIER, de: "  if (bowling) steps.push({ activityId: 'bowling'", vers: "  if (false) steps.push({ activityId: 'bowling'" },
  { nom: 'illimite-liste-forgee', lettre: 'C', cible: '[C] une liste forgee ne passe pas', serveur: true, fichier: OPS, de: "require('../lib/activity-catalog').listCenterActivities(targetCenter) : [];", vers: '(body.formule.activites || []) : [];' },
  { nom: 'illimite-montree', lettre: 'C', cible: '[C] au comptoir seulement : les clients ne la voient pas', serveur: true, fichier: FC_FICHIER, de: '      orderPolicy: ORDRE_ILLIMITE,\n      humanValidation: corps.clients === true ? null : MODE_COMPTOIR,', vers: '      orderPolicy: ORDRE_ILLIMITE,\n      humanValidation: null,' },
  { nom: 'illimite-sans-duree', lettre: 'C', cible: '[C] sa duree de visite borne les arrivees', serveur: true, fichier: STORE, de: '    if (minutes > 0) formule.estimatedTotalDuration = minutes / 60;\n', vers: '' },
  { nom: 'illimite-sans-bouton', lettre: 'C', cible: '[C] le manager a le bouton « + Formule illimitée »', fichier: PAGES, de: "          ${tfPeutTarifs() ? '<button type=\"button\" class=\"pv2-btn\" id=\"tfIllimite\"", vers: "          ${false ? '<button type=\"button\" class=\"pv2-btn\" id=\"tfIllimite\"" },
  { nom: 'composition-par-la-carte', lettre: 'D', cible: '[D] au ticket : toutes ses activites', fichier: APP, de: '  if (formule && formule.illimite && Array.isArray(formule.illimite.activites)) {', vers: '  if (false) {' },
  { nom: 'ordinaire-touchee', lettre: 'E', cible: '[E] lib/formule-comptoir.js : une formule ordinaire, octet pour octet', serveur: true, fichier: FC_FICHIER, de: '    descriptionLines,\n    steps,\n    humanValidation', vers: "    descriptionLines,\n    steps,\n    orderPolicy: null,\n    humanValidation" },
  { nom: 'catalogue-ordinaire-touche', lettre: 'E', cible: '[E] lib/catalog-store.js : les formules ordinaires, octet pour octet', serveur: true, fichier: STORE, de: '  if (canonical.orderPolicy === ORDRE_ILLIMITE) {', vers: "  if (canonical.orderPolicy !== 'open_window') {" },
];
const LES_MUTATIONS = new Map(MUTATIONS.map((m) => [m.nom, m]));

let echecs = 0;
let reussis = 0;
const mutation = CASSE ? LES_MUTATIONS.get(CASSE) : null;
function ok(cond, label, detail) {
  if (cond) { reussis += 1; console.log(`ok    ${label}`); return true; }
  echecs += 1;
  console.log(`FAIL  ${label}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (mutation && label.startsWith(mutation.cible)) throw Object.assign(new Error(`cible rouge : ${label}`), { cibleRouge: true });
  return false;
}
if (CASSE && !mutation) { console.error(`formule-illimitee-check : contre-preuve inconnue ${CASSE}`); process.exit(2); }
const compteAncre = (m) => lf(fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')).split(m.de).length - 1;
if (mutation && compteAncre(mutation) !== 1) { console.error(`formule-illimitee-check : la contre-preuve ${CASSE} ne trouve pas son ancre une seule fois`); process.exit(2); }
function transformer(rel, texte) {
  if (!mutation || mutation.serveur || mutation.fichier !== rel) return texte;
  return lf(texte).split(mutation.de).join(mutation.vers);
}

const serveur = C.monterServeur({ mutations: mutation && mutation.serveur ? [{ fichier: mutation.fichier, de: mutation.de, vers: mutation.vers }] : [] });
const ouvrir = (browser, options = {}) => C.ouvrirConsole(browser, serveur, { port: PORT, reservations: () => [], ...options });
const finir = async (m, quoi) => { ok(m.erreurs.length === 0, `[*] zero erreur JavaScript (${quoi})`, m.erreurs.slice(0, 3).join(' | ')); await m.ctx.close(); };

// ---------------------------------------------------------------------------
// Lire l ecran, lire la base.
// ---------------------------------------------------------------------------
const CENTRE = 'libramont';
const JOUEURS = 10;
const TEL = '0470 12 34 56';
const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
// Ce que le serveur vend pour ce centre : la seule definition de « toutes les activites ».
const DU_CENTRE = () => listCenterActivities(CENTRE).map((a) => a.id);
const memeEnsemble = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const planDe = (r) => (r && (typeof r.ops_plan === 'string' ? JSON.parse(r.ops_plan) : r.ops_plan)) || {};
const programmeDe = (r) => { const p = r && (typeof r.program === 'string' ? JSON.parse(r.program) : r.program); return (p && p.items) || []; };
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
// Ce que le dossier retient : les pistes du bowling, ses minutes, les armes et les parties du laser.
function retenues(r) {
  const blocs = planDe(r).resourceBlocks || [];
  const bowling = blocs.filter((b) => b.resourceType === 'bowling_lane');
  const laser = blocs.filter((b) => b.resourceType === 'laser_arena');
  return {
    pistes: [...new Set(bowling.flatMap((b) => (b.lanes || []).map(Number)))].sort((x, y) => x - y),
    minutesBowling: bowling.reduce((t, b) => t + (enMin(b.endTime) - enMin(b.startTime)), 0),
    armes: laser.reduce((t, b) => t + (Number(b.weaponNeed) || 0), 0),
    parties: new Set(laser.map((b) => b.countIndex || 1)).size,
    heures: { bowling: bowling[0] ? bowling[0].startTime : '', laser: laser[0] ? laser[0].startTime : '' },
  };
}
async function neufs(page, avant, voulu = 1) {
  for (let i = 0; i < 80; i += 1) {
    const l = [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
    if (l.length >= voulu) return l;
    await page.waitForTimeout(100);
  }
  return [...B.base.reservations.entries()].filter(([id]) => !avant.has(id)).map(([, r]) => r);
}
async function creer(page, nom) {
  await page.locator('#qbPhone').fill(TEL);
  await page.locator('#qbName').fill(nom);
  await page.waitForTimeout(200);
  await C.pret(page);
  await page.locator('#rvCreer').click();
}
async function attendreBase(page, cond) {
  for (let i = 0; i < 80; i += 1) { if (cond()) return true; await page.waitForTimeout(100); }
  return cond();
}
const lireFenetre = (page) => page.evaluate(() => {
  const c = rvConstruire({ simulation: true });
  const plan = rvPlanCourant();
  const bouton = document.getElementById('rsToutes');
  return {
    ids: rvActivites(),
    programme: c.reservation ? (c.reservation.program || []).map((l) => ({ ...l })) : null,
    type: c.reservation ? c.reservation.type : '',
    prix: plan ? Number(plan.prix) : null,
    bouton: bouton ? { texte: bouton.textContent.replace(/\s+/g, ' ').trim(), desactive: bouton.disabled, presse: bouton.getAttribute('aria-pressed') } : null,
  };
});
// Le prix d un programme, au serveur (lib/visit-program), sans passer par la console.
function prixDuProgramme(programme, startTime) {
  const { normalizeProgram } = require(path.join(ROOT, 'lib/visit-program.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const { getOperationalBowlingConfig } = require(path.join(ROOT, 'lib/ops-engine.js'));
  const centre = getCenter(CENTRE);
  return normalizeProgram(programme, { centerId: CENTRE, pax: JOUEURS, bowlingConfig: getOperationalBowlingConfig ? getOperationalBowlingConfig(centre, {}) : null, dateStr: JOUR, startTime, staff: true }).price;
}

// ---------------------------------------------------------------------------
// [A] TOUTES LES ACTIVITES AU COMPTOIR
// ---------------------------------------------------------------------------
async function scenarioA(browser) {
  console.log('\n[A] toutes les activites au comptoir');
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    // Le programme compose a la main, tuile par tuile : la reference.
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsZ-bowling .rs-h.is-on').first().click();
    await C.pret(page);
    await page.locator('#rsAjout-laser_game').click();
    await C.pret(page);
    const tuiles = await page.evaluate(() => getQuickBookActivityChoices().map((c) => c.id).filter((id) => id !== 'bowling' && id !== 'laser_game'));
    for (const id of tuiles) {
      await page.locator(`[id="rsT-${id}"]`).click();
      const question = page.locator('#rsQJTard');
      if (await question.count() && await question.isVisible().catch(() => false)) await question.click();
    }
    await C.pret(page);
    const main = await lireFenetre(page);
    await page.evaluate(() => closeQuickBook());
    await page.waitForTimeout(300);

    // Un toucher.
    await C.ouvrirFenetre(page, JOUEURS);
    const avant = await lireFenetre(page);
    ok(avant.bouton && /Toutes les activités/.test(avant.bouton.texte) && !avant.bouton.desactive && avant.ids.join() === 'bowling', '[A] la fenetre ouvre avec le bouton « Toutes les activités »', avant);
    await page.locator('#rsToutes').click();
    await C.pret(page);
    await page.waitForTimeout(600);
    const apres = await lireFenetre(page);
    const centre = DU_CENTRE();
    ok(memeEnsemble(apres.ids, centre) && apres.type === 'visite', '[A] un toucher : toutes les activites du centre au ticket, et seulement elles', { ecran: apres.ids, centre });
    ok(apres.bouton && apres.bouton.desactive && apres.bouton.presse === 'true' && /Toutes au ticket/.test(apres.bouton.texte), '[A] ensuite le bouton dit « Toutes au ticket »', apres.bouton);
    const cle = (p) => JSON.stringify((p || []).map((l) => JSON.stringify(Object.keys(l).sort().reduce((o, k) => ({ ...o, [k]: l[k] }), {}))).sort());
    ok(cle(apres.programme) === cle(main.programme), '[A] le programme est celui compose tuile par tuile', { toutes: apres.programme && apres.programme.map((l) => l.activityId), main: main.programme && main.programme.map((l) => l.activityId) });
    const attendu = prixDuProgramme(apres.programme, '15:00');
    ok(apres.prix != null && apres.prix > 0 && Math.abs(apres.prix - attendu) < 0.01 && Math.abs(apres.prix - main.prix) < 0.01, '[A] le prix est celui du programme', { ecran: apres.prix, programme: attendu, main: main.prix });

    // Le dossier.
    const debut = new Set([...B.base.reservations.keys()]);
    await creer(page, 'Team building Toutes');
    const [r] = await neufs(page, debut);
    const ids = programmeDe(r).map((l) => l.activityId);
    ok(r && memeEnsemble(ids, centre) && Math.abs(Number(r.price) - attendu) < 0.01, '[A] le dossier cree porte chaque activite du centre, au prix du programme', r && { ids, prix: r.price, attendu });
    const t = retenues(r);
    ok(r && t.pistes.length >= 2 && t.minutesBowling === 60 && t.armes === JOUEURS && t.parties === 1 && t.heures.bowling && t.heures.laser, '[A] le dossier : bowling et laser a leur heure, pistes et arene retenues', t);
  } finally { await finir(m, 'A'); }
}

// ---------------------------------------------------------------------------
// [B] JAMAIS DEUX GROUPES SUR LA MEME PISTE
// ---------------------------------------------------------------------------
function chevauchementsDeLaJournee() {
  const dossiers = [...B.base.reservations.values()].filter((r) => r.status !== 'cancelled' && String(r.date).slice(0, 10) === JOUR);
  const pistes = [];
  const laser = new Map();
  dossiers.forEach((r) => (planDe(r).resourceBlocks || []).forEach((b) => {
    if (b.resourceType === 'bowling_lane') pistes.push({ id: r.id, s: enMin(b.startTime), e: enMin(b.endTime), l: (b.lanes || []).map(Number) });
    if (b.resourceType === 'laser_arena') { const k = b.startTime; laser.set(k, (laser.get(k) || 0) + (Number(b.weaponNeed) || 0)); }
  }));
  const doubles = [];
  for (let i = 0; i < pistes.length; i += 1) {
    for (let j = i + 1; j < pistes.length; j += 1) {
      const a = pistes[i];
      const b = pistes[j];
      if (a.id === b.id || !(a.s < b.e && b.s < a.e)) continue;
      const communes = a.l.filter((x) => b.l.includes(x));
      if (communes.length) doubles.push({ dossiers: [a.id, b.id], pistes: communes });
    }
  }
  const armes = Number(require(path.join(ROOT, 'lib/ops-knowledge.js')).getCenter(CENTRE).resources.laser.weaponCount);
  return { doubles, arene: [...laser.entries()].filter(([, n]) => n > armes), dossiers: dossiers.length };
}

// Six pistes sur huit deja prises de 15:00 a 16:00 : il en reste deux, juste ce qu il faut a
// un groupe de 10. Le dossier est dans la base du serveur, c est lui qui juge.
const OCCUPEES = [1, 2, 3, 4, 5, 6];
const DEJA_LA = () => [{ ...C.dossierRetenu({ heure: '15:00', pistes: OCCUPEES, joueurs: 30 }), id: 9101, name: 'Groupe deja la', channel: 'staff', status: 'confirmed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];

async function scenarioB(browser) {
  console.log('\n[B] jamais deux groupes sur la meme piste');
  const m = await ouvrir(browser, { role: 'manager', reservations: DEJA_LA });
  try {
    const { page } = m;
    const debut = new Set([...B.base.reservations.keys()]);
    await C.ouvrirFenetre(page, JOUEURS);
    await page.locator('#rsToutes').click();
    await C.pret(page);
    await page.waitForTimeout(500);
    // Ce que « Créer » enverrait : le meme corps servira au deuxieme groupe.
    const corps = await page.evaluate(() => rvConstruire().reservation);
    await creer(page, 'Equipe Une');
    const [un] = await neufs(page, debut);
    const t1 = retenues(un);
    ok(un && t1.heures.bowling === '15:00' && t1.pistes.length === 2 && !t1.pistes.some((p) => OCCUPEES.includes(p)), '[B] le premier groupe prend les deux pistes qui restaient', t1);
    // Le deuxieme groupe, la meme visite a la meme heure, droit au serveur.
    const deux = await serveur.appeler('POST', '/api/staff-reservations', { ...corps, name: 'Equipe Deux', phone: TEL, centerId: CENTRE });
    const ne = deux.json.reservation && deux.json.reservation.id ? B.base.reservations.get(Number(deux.json.reservation.id)) : null;
    const t2 = ne ? retenues(ne) : null;
    ok((deux.statut >= 400 && !ne) || (ne && t2.pistes.length >= 2 && !t2.pistes.some((p) => t1.pistes.includes(p) || (t2.heures.bowling === '15:00' && OCCUPEES.includes(p)))), '[B] un deuxieme groupe sur l heure pleine est refuse, jamais surreserve', { statut: deux.statut, message: deux.json.message || deux.json.error, retenues: t2 });
    const bilan = chevauchementsDeLaJournee();
    ok(bilan.dossiers >= 2 && bilan.doubles.length === 0 && bilan.arene.length === 0, '[B] sur la journee, aucune piste prise deux fois, l arene jamais au-dela de ses armes', bilan);
  } finally { await finir(m, 'B'); }
}

// ---------------------------------------------------------------------------
// [C] LA FORMULE ILLIMITEE DANS TARIFS & FORMULES
// ---------------------------------------------------------------------------
const ID_ILLIMITEE = 'sm-libramont--acces-illimite';
const CORPS_ILLIMITE = { nom: 'Accès illimité', prixParPersonne: 32, minPax: 1, illimite: true, dureeMinutes: 180, clients: false };
const lePublicVoit = (id) => require(path.join(ROOT, 'lib/booking-config.js')).getEffectiveFormules(CENTRE).some((f) => f.id === id);
const lePublicRefuse = (id) => {
  const { normalizeReservationRequest } = require(path.join(ROOT, 'lib/reservation-request.js'));
  try { normalizeReservationRequest({ centerId: CENTRE, date: JOUR, startTime: '15:00', pax: JOUEURS, type: 'formule', formuleId: id, name: 'X', phone: '+32470000000', email: 'x@example.test' }, { channel: 'public' }); return false; } catch (error) { return /indisponible/i.test(error.message); }
};
async function garderParLeServeur(corps) {
  return serveur.appeler('POST', '/api/ops', { action: 'garderFormuleSurMesure', centerId: CENTRE, formule: corps });
}

async function scenarioC(browser) {
  console.log('\n[C] la formule illimitee dans Tarifs & formules');
  // Sans le droit Tarifs : ni bouton, ni ecriture.
  const m0 = await ouvrir(browser, { role: 'sans-tarifs' });
  try {
    const { page } = m0;
    await page.evaluate(() => { const b = document.querySelector('[data-fgx-menu-key="prices"]'); if (b) b.click(); });
    await page.waitForSelector('[data-tf-onglet="formules"]', { timeout: 20000 }).catch(() => {});
    ok(await page.locator('#tfIllimite').count() === 0, '[C] sans le droit Tarifs, pas de bouton', await page.locator('#tfIllimite').count());
  } finally { await finir(m0, 'C sans droit'); }
  serveur.changerSession(C.roleDe('sans-tarifs'));
  const refus = await garderParLeServeur(CORPS_ILLIMITE);
  ok(refus.statut === 403 && !C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE), '[C] sans le droit Tarifs, le serveur refuse', { statut: refus.statut });

  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    await page.evaluate(() => { const b = document.querySelector('[data-fgx-menu-key="prices"]'); if (b) b.click(); });
    await page.waitForSelector('#tfIllimite', { timeout: 20000 }).catch(() => {});
    ok(await page.locator('#tfIllimite').count() === 1, '[C] le manager a le bouton « + Formule illimitée »');
    await page.locator('#tfIllimite').click();
    await page.waitForSelector('#cevIlNom');
    const modale = await page.evaluate(() => ({
      toutes: document.getElementById('cevIlToutes').checked,
      dit: (document.getElementById('cevIlDit') || {}).textContent || '',
      duree: (document.getElementById('cevIlDuree') || {}).value || '',
      comptoir: document.getElementById('cevIlComptoir').checked,
    }));
    ok(modale.toutes && /pistes et arène retenues/.test(modale.dit) && /À volonté pendant la visite/.test(modale.dit) && modale.duree === '180' && modale.comptoir, '[C] la case « Toutes les activités (illimité) » est cochee, et dit ce qui est retenu', modale);
    await page.locator('#cevIlDuree').selectOption('180');
    await page.locator('#cevIlPrix').fill('32');
    await page.locator('#cevOverlay .btn-primary').click();
    await attendreBase(page, () => C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE));
    await page.waitForTimeout(500);
  } finally { await finir(m, 'C'); }
  verifierLaFormule();
  // Une liste forgee : le serveur relit le catalogue du centre.
  const forgee = await garderParLeServeur({ ...CORPS_ILLIMITE, nom: 'Forgee illimitee', activites: [{ id: 'golf_oclock' }, { id: 'bowling', minutes: 600 }] });
  const etapes = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === 'sm-libramont--forgee-illimitee').map((e) => e.activity_id);
  ok(forgee.statut === 200 && memeEnsemble(etapes, DU_CENTRE()), '[C] une liste forgee ne passe pas : le serveur relit le catalogue du centre', { statut: forgee.statut, message: forgee.json.message, etapes });
}

function verifierLaFormule() {
  const ligne = C.CATALOGUE_BANC.formules.get(ID_ILLIMITEE) || {};
  const etapes = C.CATALOGUE_BANC.etapes.filter((e) => e.formula_id === ID_ILLIMITEE).sort((a, b) => a.position - b.position);
  const ids = etapes.map((e) => e.activity_id);
  ok(Boolean(ligne.id) && memeEnsemble(ids, DU_CENTRE()), '[C] au catalogue : toutes les activites du centre, et seulement elles', { ids, centre: DU_CENTRE() });
  const bowling = etapes.find((e) => e.activity_id === 'bowling') || {};
  const laser = etapes.find((e) => e.activity_id === 'laser_game') || {};
  const libres = etapes.filter((e) => e.activity_id !== 'bowling' && e.activity_id !== 'laser_game');
  ok(bowling.critical === true && Number(bowling.duration_minutes) === 60 && laser.critical === true && Number(laser.count) === 1 && libres.length > 0 && libres.every((e) => !e.critical && / à volonté$/.test(String(e.label))), '[C] bowling et laser a heure, le reste a volonte', etapes.map((e) => [e.activity_id, e.count, e.duration_minutes, e.critical, e.label]));
  ok(ligne.order_policy === 'illimite' && ligne.price_type === 'per_pax' && Number(ligne.price_value) === 32, '[C] un prix par joueur, la formule dite illimitee', { politique: ligne.order_policy, prix: ligne.price_value, type: ligne.price_type });
  ok(ligne.human_validation === 'comptoir' && !lePublicVoit(ID_ILLIMITEE) && lePublicRefuse(ID_ILLIMITEE), '[C] au comptoir seulement : les clients ne la voient pas', { validation: ligne.human_validation, voit: lePublicVoit(ID_ILLIMITEE) });
  // La regle des arrivees que la route publique, l agent et la console partagent
  // (getFormuleArrivalWindow) : la derniere arrivee est la fermeture moins la visite.
  const { getEffectiveFormules, getFormuleArrivalWindow, getSchedule } = require(path.join(ROOT, 'lib/booking-config.js'));
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const servie = getEffectiveFormules(CENTRE, { comptoir: true }).find((f) => f.id === ID_ILLIMITEE) || {};
  const fenetre = getFormuleArrivalWindow(servie, getSchedule(JOUR, getCenter(CENTRE))) || {};
  ok(servie.estimatedTotalDuration === 3 && servie.illimite && servie.illimite.minutes === 180 && memeEnsemble(servie.illimite.activites, DU_CENTRE()) && fenetre.latestStart === fenetre.periodEnd - 3, '[C] sa duree de visite borne les arrivees (la derniere : la fermeture moins 3 h)', { duree: servie.estimatedTotalDuration, illimite: servie.illimite, fenetre });
}

// ---------------------------------------------------------------------------
// [D] ELLE SE RESERVE AU COMPTOIR
// ---------------------------------------------------------------------------
async function scenarioD(browser) {
  console.log('\n[D] elle se reserve au comptoir');
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) {
    serveur.changerSession(C.roleDe('manager'));
    await garderParLeServeur(CORPS_ILLIMITE);
  }
  // La visite equivalente, au meme handler : toutes les activites, le meme groupe, la meme heure.
  const programme = DU_CENTRE().map((id) => ({ activityId: id, pax: JOUEURS, participants: JOUEURS, ...(id === 'bowling' ? { duration: 1 } : {}), ...(id === 'laser_game' ? { games: 1 } : {}) }));
  const m = await ouvrir(browser, { role: 'manager' });
  try {
    const { page } = m;
    await C.ouvrirFenetre(page, JOUEURS);
    await page.waitForFunction((id) => getEffectiveCatalogFormules().some((f) => f.id === id), ID_ILLIMITEE, { timeout: 10000 }).catch(() => {});
    await page.locator('#rsFormules').click();
    const tuile = page.locator(`[id="rsF-${ID_ILLIMITEE}"]`);
    const texteTuile = await tuile.count() ? (await tuile.textContent()).replace(/\s+/g, ' ') : '';
    ok(/Accès illimité/.test(texteTuile) && /Toutes les activités, 3 h/.test(texteTuile), '[D] dans Formules, sa tuile : toutes les activites, 3 h', texteTuile);
    if (!(await tuile.count())) return;
    await tuile.click();
    await page.waitForSelector('.rs-s-l.is-formule .rs-h[data-heure="15:30"]', { timeout: 10000 });
    // La derniere arrivee proposee : la fermeture (minuit) moins les 3 h de la visite.
    const heures = await page.evaluate(() => rsHeuresDeLaFormule());
    ok(heures[heures.length - 1] === '21:00', '[D] la derniere arrivee proposee laisse les 3 h de la visite', heures.slice(-3));
    await page.locator('.rs-s-l.is-formule .rs-h[data-heure="15:30"]').click();
    await C.pret(page);
    const ids = await page.evaluate(() => rvActivites());
    ok(memeEnsemble(ids, DU_CENTRE()), '[D] au ticket : toutes ses activites', { ecran: ids, centre: DU_CENTRE() });
    const debut = new Set([...B.base.reservations.keys()]);
    await creer(page, 'Team building Formule');
    const [r] = await neufs(page, debut);
    const f = retenues(r);
    ok(r && r.formule_id === ID_ILLIMITEE && Number(r.price) === 32 * JOUEURS && f.pistes.length >= 2 && f.minutesBowling === 60 && f.armes === JOUEURS, '[D] le dossier : la formule, son prix, pistes et arene retenues', r && { formule: r.formule_id, prix: r.price, retenues: f });
    // La visite equivalente, creee au meme handler a une autre heure et lue de la meme facon.
    const visite = await serveur.appeler('POST', '/api/staff-reservations', { centerId: CENTRE, date: JOUR, startTime: '18:00', duration: 1, totalDuration: 1, lanes: [], pax: JOUEURS, status: 'pending', type: 'visite', name: 'Visite equivalente', phone: TEL, program: programme, preference: { activityOrder: programme.map((l) => l.activityId), preferredTimes: { bowling: '18:00', laser_game: '19:00' }, laserGameTimes: ['19:00'], laserPlacement: 'scheduled' } });
    const lue = visite.json.reservation && visite.json.reservation.id ? B.base.reservations.get(Number(visite.json.reservation.id)) : null;
    const v = lue ? retenues(lue) : null;
    ok(r && v && v.pistes.length > 0 && f.pistes.length >= v.pistes.length && f.minutesBowling >= v.minutesBowling && f.armes >= v.armes && f.parties >= v.parties, '[D] pas moins de ressources qu une visite equivalente', { formule: f, visite: v, statut: visite.statut, message: visite.json.message });
  } finally { await finir(m, 'D'); }
}

// ---------------------------------------------------------------------------
// [E] UNE FORMULE ORDINAIRE NE CHANGE PAS, OCTET POUR OCTET
// ---------------------------------------------------------------------------
// Un module relu tel qu il est sur le disque, le chemin illimite retire : c est le code d avant
// pour tout ce qui n est pas illimite. Il se compile sous un autre nom (la mutation d une
// contre-preuve ne le touche pas) ; le module vivant, lui, porte la mutation.
function compiler(rel, retirer, nom) {
  const source = lf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  if (source.split(retirer.de).length !== 2) throw new Error(`[E] ${rel} : le chemin illimite a retirer n est plus la (${retirer.de.slice(0, 60)})`);
  const fichier = path.join(ROOT, path.dirname(rel), nom);
  const module_ = new Module(fichier, module);
  module_.filename = fichier;
  module_.paths = Module._nodeModulePaths(path.dirname(fichier));
  module_._compile(source.split(retirer.de).join(retirer.vers), fichier);
  return module_.exports;
}
const SANS_ILLIMITE_FC = { de: "  if (corps.illimite === true) {\n    const champs = champsDeFormule(corps);\n    const duree = dureeIllimiteeLue(corps.dureeMinutes);", vers: "  if (false) {\n    const champs = champsDeFormule(corps);\n    const duree = dureeIllimiteeLue(corps.dureeMinutes);" };
const SANS_ILLIMITE_STORE = { de: '  if (canonical.orderPolicy === ORDRE_ILLIMITE) {', vers: '  if (false) {' };

async function scenarioE() {
  console.log('\n[E] une formule ordinaire ne change pas');
  const vivant = require(path.join(ROOT, FC_FICHIER));
  const avant = compiler(FC_FICHIER, SANS_ILLIMITE_FC, 'formule-comptoir.sans-illimite.js');
  const corps = [
    { nom: 'Forgee', prixParPersonne: 10, minPax: 2, activites: [{ id: 'bowling', minutes: 60, nom: 'Bowling 1 h' }], lignes: [] },
    { nom: 'Anniv du club', prixParPersonne: 22, minPax: 6, activites: [{ id: 'bowling', minutes: 90 }, { id: 'laser_game', parties: 2 }, { id: 'arcade_time', minutes: 30 }, { id: 'minigolf_blacklight' }], lignes: [{ nom: 'Crêpe au sucre', qte: 1, parPersonne: true }], clients: true },
    { nom: 'Pas illimitee', prixParPersonne: 15, minPax: 1, illimite: 'true', activites: [{ id: 'playground' }], lignes: [] },
  ];
  const activitesDuCentre = listCenterActivities(CENTRE);
  const differences = corps.map((c) => [JSON.stringify(vivant.formuleDepuisLeComptoir(c, { activitesDuCentre })), JSON.stringify(avant.formuleDepuisLeComptoir(c))]).filter(([a, b]) => a !== b);
  ok(differences.length === 0, '[E] lib/formule-comptoir.js : une formule ordinaire, octet pour octet', differences[0] || '');

  // Le catalogue : une formule ordinaire gardee, l illimitee, et tout le socle, sous les deux codes.
  if (!C.CATALOGUE_BANC.formules.has(ID_ILLIMITEE)) { serveur.changerSession(C.roleDe('manager')); await garderParLeServeur(CORPS_ILLIMITE); }
  if (![...C.CATALOGUE_BANC.formules.values()].some((f) => f.order_policy !== 'illimite')) await garderParLeServeur(corps[1]);
  const etat = { formulas: [...C.CATALOGUE_BANC.formules.values()], steps: C.CATALOGUE_BANC.etapes.slice(), activities: [], centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }, { id: 'gembloux', client_id: 'fungalaxy' }] };
  const neuf = compiler(STORE, { de: SANS_ILLIMITE_STORE.de, vers: SANS_ILLIMITE_STORE.de }, 'catalog-store.js');
  const ancien = compiler(STORE, SANS_ILLIMITE_STORE, 'catalog-store.sans-illimite.js');
  neuf.applyCatalogState(JSON.parse(JSON.stringify(etat)));
  ancien.applyCatalogState(JSON.parse(JSON.stringify(etat)));
  const ecarts = [];
  let vues = 0;
  const illimitees = new Set([...C.CATALOGUE_BANC.formules.values()].filter((f) => f.order_policy === 'illimite').map((f) => f.id));
  ['libramont', 'gembloux'].forEach((centre) => {
    const a = neuf.listBookingFormules(centre).filter((f) => !illimitees.has(f.id));
    const b = ancien.listBookingFormules(centre).filter((f) => !illimitees.has(f.id));
    if (JSON.stringify(a) !== JSON.stringify(b)) ecarts.push({ centre, liste: true });
    a.forEach((f) => {
      vues += 1;
      if (JSON.stringify(neuf.getFormulaDoc(f.id, centre)) !== JSON.stringify(ancien.getFormulaDoc(f.id, centre))) ecarts.push({ centre, id: f.id });
    });
  });
  const illimitee = neuf.listBookingFormules(CENTRE).find((f) => f.id === ID_ILLIMITEE);
  ok(ecarts.length === 0 && vues > 20 && illimitee && illimitee.illimite, '[E] lib/catalog-store.js : les formules ordinaires, octet pour octet', { ecarts: ecarts.slice(0, 3), vues, illimitee: Boolean(illimitee && illimitee.illimite) });
}

// ---------------------------------------------------------------------------
const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE };

function verifierLesAncres() {
  let mortes = 0;
  MUTATIONS.forEach((m) => { const n = compteAncre(m); if (n !== 1) { mortes += 1; console.log(`FAIL  ancre ${m.nom} trouvee ${n} fois : ${m.de.slice(0, 80)}`); } });
  const noms = new Set(MUTATIONS.map((m) => m.nom));
  if (noms.size !== MUTATIONS.length) { mortes += 1; console.log('FAIL  deux contre-preuves portent le meme nom'); }
  console.log(`formule-illimitee-check --ancres : ${MUTATIONS.length - mortes}/${MUTATIONS.length} uniques`);
  return mortes;
}

async function contrePreuves() {
  if (verifierLesAncres()) process.exit(1);
  const voulues = typeof argument('contre-preuves') === 'string' ? argument('contre-preuves').split(',') : null;
  const liste = trancher(voulues ? MUTATIONS.filter((m) => voulues.includes(m.nom)) : MUTATIONS);
  const runs = await eclats.enPool(liste, eclats.nombreDeFils(liste.length), (m, fil) => eclats.lancer(__filename, [`--seul=${m.lettre}`], {
    env: { ...process.env, ILLIMITE_CASSE: m.nom, PINLANE_ILLIMITE_PORT: String(PORT + 1 + fil) },
    timeout: 300000,
  }));
  let mordent = 0;
  liste.forEach((m, i) => {
    const sortie = `${runs[i].stdout || ''}${runs[i].stderr || ''}`;
    if (runs[i].status === 2) { console.log(`FAIL  contre-preuve ${m.nom} DESARMEE : ${sortie.trim().split('\n').pop()}`); return; }
    const rouges = sortie.split('\n').filter((l) => l.startsWith('FAIL'));
    if (rouges.some((l) => l.includes(m.cible))) { mordent += 1; console.log(`ok    contre-preuve ${m.nom} : « ${m.cible} » rougit`); return; }
    console.log(`FAIL  contre-preuve ${m.nom} : « ${m.cible} » reste vert (${rouges.length} autre(s) rouge(s) : ${rouges[0] ? rouges[0].slice(0, 140) : sortie.trim().split('\n').pop().slice(0, 160)})`);
  });
  console.log(`formule-illimitee-check --contre-preuves : ${mordent}/${liste.length} mordent`);
  process.exit(mordent === liste.length ? 0 : 1);
}

async function main() {
  if (argument('ancres')) process.exit(verifierLesAncres() ? 1 : 0);
  if (argument('contre-preuves')) { await contrePreuves(); return; }
  const seul = typeof argument('seul') === 'string' ? argument('seul').split(',') : Object.keys(SCENARIOS);
  const http = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: C.BROWSER_PATH, headless: true });
  try {
    for (const nom of seul) {
      try { await SCENARIOS[nom](browser); } catch (erreur) {
        if (erreur && erreur.cibleRouge) break;
        ok(false, `[${nom}] le scenario va jusqu au bout`, erreur && (erreur.message || String(erreur)).slice(0, 200));
      }
    }
  } finally {
    await browser.close();
    http.close();
  }
  console.log(`\nformule-illimitee-check : ${reussis} ok, ${echecs} echec(s)`);
  process.exit(echecs ? 1 : 0);
}

main().catch((erreur) => {
  console.error('formule-illimitee-check : interrompu', erreur && (erreur.stack || erreur));
  process.exit(1);
});
