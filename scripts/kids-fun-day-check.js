// KIDS FUN DAY : TOUTES LES ACTIVITES EN ILLIMITE, AUCUNE PLACE A RESERVER (2026-11-24).
//
// Le gerant, devant la ligne du planning ou seules Arcades et Plaine portaient « Illimité » :
//   « kids fun day c'est toutes les activités en illimité » ; « pour les places, dis-toi juste qu'ils ont tout
//   en illimité, donc si bowling n'est pas dispo ou laser ils font autre chose, genre pas besoin de booker des
//   places » ; « et du coup faudrait faire un truc adapté pour le planning bowling et lasergame » ; devant
//   Modifier d un de ces dossiers (une carte « Bowling », « Heure --:-- », aucune duree) : « et pq ça montre
//   bowling comme ça wtf ».
// LA CAUSE : sa fiche du catalogue, en base, porte une etape de bowling de 300 min (Tarifs & formules). Le
// serveur la servait en formule a pistes (hasBowling, 5 h), tenait des pistes de 12:00 a 17:00 pour chaque
// groupe, refusait la formule quand il n en restait plus, et Modifier allumait un bowling de 5 h. Ce gate pose
// CE catalogue-la dans la base en memoire (FICHE_EN_BASE), pour Libramont et Gembloux.
//
// Le VRAI serveur (scripts/comptoir-banc.js : api/staff-reservations.js, api/public-availability.js, le moteur,
// lib/database.js, sur la base en memoire) et la VRAIE console (scripts/planning-v3-fixtures.js, la journee
// « normal », le mercredi 13 janvier 2027 a 14:10), qui recoit les formules et les activites que ce serveur
// sert (__fixtureLecture) et lui envoie ses ecritures. Aucune base reelle, aucun reseau.
//   [A] LA REGLE ET LE CATALOGUE : elle se lit sur la carte (« Toutes les activités illimitées », fenetre
//       ouverte), le Matin Malin et les autres n en sont pas ; aucune etape jouee ne prend de place, mais Tarifs
//       & formules garde celles du catalogue ; ce qu elle comprend est ce que le centre propose, le meme au
//       serveur et a la console (8 a Libramont, 6 a Gembloux) ;
//   [B] RIEN NE SE RESERVE (les deux centres) : le dossier neuf n a ni piste, ni bloc, ni partie de laser a
//       placer, il finit a 17:00, 30 € par joueur ; il se prend meme quand toutes les pistes et toutes les armes
//       sont prises, et meme quand le bowling est privatise ;
//   [C] LES PLACES LIBRES NE CHANGENT PAS : les creneaux libres du bowling, du laser et d une Formule 3 sont les
//       memes sans aucun Kids Fun Day, avec trois dossiers neufs, et avec deux dossiers d avant (pistes 7 et 8
//       de 12:00 a 17:00, une partie de laser a placer) ; un dossier d avant se lit sans ses pistes, a son heure
//       et a son prix ; une piste qu il « tenait » se vend ;
//   [D] RIEN EN PLUS DE CE QUI EST COMPRIS : creer et modifier refusent une activite comprise « en plus », en le
//       disant ; une Formule 3 la vend toujours ; un en plus d avant reste, se garde et se retire ; une Formule 3
//       et son bowling en plus qui passe a Kids Fun Day ne le paie plus ; adaptee a la main avec un bowling, elle
//       garde ses pistes, adaptee sans place elle n en a pas ; aucun complement ne se propose ;
//   [E] LES AUTRES LECTEURS : le programme a cocher de l assistant, la feuille de secours (« illim. »), la
//       demande de bureau ;
//   [F] LE PLANNING COMPLET : « Illimité » dans chaque colonne des activites du centre, pour un dossier neuf, un
//       dossier d avant sans piste et un d avant avec ses pistes, a Libramont et a Gembloux ; la tete de colonne
//       ne les compte pas avec les groupes a l heure ; une activite en plus garde son heure a cote ; la fiche a
//       une case par activite, les memes que l assistant ;
//   [G] MODIFIER : chaque activite comprise se lit « Illimité », sans heure, ni duree, ni pistes, ni joueurs, et
//       « Ajouter » ne la propose pas ; le prix et sa TVA ne bougent pas ; un nom change seul s enregistre ; un
//       bowling en plus d avant a son heure, sa duree et ses pistes ; choisir Kids Fun Day sur une Formule 3 ne
//       garde pas son bowling en plus, revenir le rend ;
//   [H] RESERVER : ni piste, ni duree, ni heure d activite ; tuiles et blocs disent « illimité », un toucher
//       n ajoute rien et le dit ; le dossier cree n a rien de pose, 30 € par joueur ;
//   [I] LES BANDEAUX « À VOLONTÉ » (bowling et laser) : les groupes du jour, leurs joueurs, leur etat, jusqu a
//       quelle heure, la phrase ; un toucher ouvre la fiche ; un annule, un absent, un adapte avec bowling n y
//       sont pas ; caches un jour sans groupe ou pour une activite que le centre n a pas ; la grille et les
//       compteurs sont les memes avec et sans ; rien ne deborde a 1366, 1280, 1024 px ni au telephone ; pas de
//       bouton noir, cible de 44 px au doigt ;
//   [J] LE FORMULAIRE PUBLIC : kfd ne demande qu une heure d arrivee, ni piste ni duree ;
//   [Z] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ou au serveur, en memoire ; le disque n est jamais
// touche) a son ancre une fois et une seule, puis fait rougir sa lettre.
//   KFD_SCENARIOS : des lettres (A,F) ; KFD_MUTATIONS : des noms ; KFD_BAVARD : le detail ;
//   KFD_CAPTURES=<dossier> : les images pour Ansar (jamais une preuve).
'use strict';
const fs = require('fs');
const path = require('path');

const C = require('./comptoir-banc.js');
// (la table des privatisations, en memoire : apres le banc)
const PB = require('./privatisation-banc.js');
const { chromium } = require('playwright-core');

const { B, FX, ROOT, BROWSER_PATH } = C;
// 5238 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_KIDS_FUN_DAY_PORT || 5238);
const APP = 'assets/app-main.js';
const PG = 'assets/pinlane-planning-global.js';
const BC = 'assets/booking-core.js';
const CSS = 'assets/pinlane-staff.css';
const REGLE = 'lib/formule-tout-illimite.js';
const STORE = 'lib/catalog-store.js';
const BASE = 'lib/database.js';
const API = 'api/staff-reservations.js';
const FENETRE = 'lib/reserver-fenetre.js';

const JOUR = '2027-01-13'; // un mercredi, hors vacances
const HEURE = '14:10';
const CENTRES = ['libramont', 'gembloux'];
const COMPRISES = {
  libramont: ['arcade_time', 'billards', 'bowling', 'duckpin_bowling', 'fun_run', 'laser_game', 'minigolf_blacklight', 'playground'],
  gembloux: ['arcade_time', 'billards', 'bowling', 'golf_oclock', 'laser_game', 'minigolf_blacklight'],
};
const PRIX = 30;
const lib = (rel) => require(path.join(ROOT, rel));
const CAPTURES = process.env.KFD_CAPTURES || '';
const liste = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
const copie = (v) => JSON.parse(JSON.stringify(v));
const enMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const enHeure = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1200)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel && !ed.serveur) t = t.replace(ed.de, () => ed.vers);
  return t;
}
const editionsDuServeur = () => (mutation ? mutation.editions.filter((ed) => ed.serveur).map(({ fichier, de, vers }) => ({ fichier, de, vers })) : []);

// ---------------------------------------------------------------------------
// LE SERVEUR, SUR LE CATALOGUE DE PRODUCTION : la fiche du Kids Fun Day en base, avec son bowling de 5 h.
// ---------------------------------------------------------------------------
const FICHE_EN_BASE = {
  id: 'kfd', name: 'KIDS FUN DAY', family: 'Speciale', min_pax: 1, price_type: 'per_pax', price_value: PRIX, price_old: null, not_during_holidays: true, valid_days: [3],
  time_limit_min_minutes: 720, time_limit_max_minutes: 1020, human_validation: 'recommended', order_policy: 'open_window', is_birthday_formula: false, best: false,
  description_lines: ['Toutes les activités illimitées', 'De 12h à 17h pour les enfants de 5 à 12 ans'], sort_index: 10, source: 'seed', active: true, owner_client_id: 'fungalaxy',
};
const etapeEnBase = (position, activity_id, duration_minutes, formula_id = 'kfd') => ({ formula_id, position, activity_id, count: 1, duration_minutes, label: null, critical: false, resource_type: null, pax: null, optional: false, owner_client_id: 'fungalaxy' });

async function monterServeur(lignes = [], { heure = '10:00', centre = 'libramont', formules = [], etapes = [] } = {}) {
  const serveur = C.monterServeur({ mutations: editionsDuServeur() });
  C.CATALOGUE_BANC.formules.set('kfd', copie(FICHE_EN_BASE));
  C.CATALOGUE_BANC.etapes = [etapeEnBase(0, 'playground', 300), etapeEnBase(1, 'arcade_time', 300), etapeEnBase(2, 'bowling', 300), ...etapes];
  formules.forEach((f) => C.CATALOGUE_BANC.formules.set(f.id, f));
  const maintenant = FX.instant(JOUR, heure).getTime();
  globalThis.__comptoirMaintenant = maintenant;
  PB.vider();
  B.semer(lignes);
  B.base.horloge = maintenant;
  await lib(STORE).refreshCatalog(new (require(require.resolve('pg', { paths: [ROOT] })).Client)(), { force: true });
  serveur.changerSession(B.sessionDuRole('direction', { nom: 'Accueil', centre }));
  return serveur;
}
const corps = (o = {}) => ({
  centerId: 'libramont', date: JOUR, startTime: '12:00', type: 'formule', formuleId: 'kfd', pax: 8, name: 'Anniversaire Nora', phone: '0470 11 12 13', email: '', status: 'pending',
  duration: 0.5, totalDuration: 5, label: 'Kids Fun Day', extras: [], ...o,
});
const creer = (serveur, o) => serveur.appeler('POST', '/api/staff-reservations', corps(o));
const modifier = (serveur, r, o) => serveur.appeler('PATCH', '/api/staff-reservations', { id: r.id, centerId: r.centerId, baseUpdatedAt: r.updatedAt, ...o });
const enApi = (id) => lib(BASE).mapReservation(B.base.reservations.get(Number(id)));
const dernier = () => [...B.base.reservations.values()].pop();
const placesDuPlan = (plan) => ((plan && plan.resourceBlocks) || []).filter((b) => b && (b.resourceType === 'bowling_lane' || b.resourceType === 'laser_arena'));
// Les creneaux libres tels que le formulaire et l equipe les recoivent.
async function creneaux(centre, question) {
  const r = await B.appeler(lib('api/public-availability.js'), 'GET', `/api/public-availability?date=${JOUR}&centerId=${centre}&${question}`);
  return { statut: r.statut, message: r.json.message || '', slots: (r.json.slots || []).map((s) => [s.time, s.freeCount, s.laneCount || 0, (s.opsPlan && s.opsPlan.endTime) || '']) };
}

// UN DOSSIER D AVANT, tel que la base le garde : des pistes tenues de 12:00 a 17:00, une partie de laser a placer.
const friseLibre = (debut, activites) => activites.map((id) => ({ type: 'activity', activityId: id, label: id, resourceType: 'soft_capacity', countIndex: 1, flexible: true, openWindow: true, start: enMin(debut), end: 1020, startTime: debut, endTime: '17:00', durationMinutes: 300 }));
function planDAvant({ debut = '12:00', pistes = [], joueurs = 8, laser = false, centre = 'libramont' } = {}) {
  const bloc = { type: 'activity', activityId: 'bowling', label: 'Bowling', resourceType: 'bowling_lane', countIndex: 1, start: enMin(debut), end: 1020, startTime: debut, endTime: '17:00', durationMinutes: 1020 - enMin(debut), lanes: pistes, requiredLanes: pistes.length, players: joueurs, critical: true };
  return {
    formulaId: 'kfd', startTime: debut, endTime: '17:00', totalMinutes: 1020 - enMin(debut), arrivalTime: debut, arrivalMinutes: 0, bufferMinutes: 0, assignedLanes: pistes, conflicts: [],
    timeline: [...friseLibre(debut, centre === 'gembloux' ? ['arcade_time'] : ['playground', 'arcade_time']), ...(pistes.length ? [copie(bloc)] : [])],
    resourceBlocks: pistes.length ? [bloc] : [],
    laserPassPlan: laser ? { totalGames: 1, placement: 'all_on_site', scheduledPasses: [], pendingPasses: [{ countIndex: 1, activityId: 'laser_game' }] } : null,
  };
}
const ligneDAvant = (id, o = {}) => B.ligne(id, {
  date: JOUR, start_time: '12:00', duration: 5, total_duration: 5, pax: 8, type: 'formule', formule_id: 'kfd', label: 'Kids Fun Day', name: `Groupe ${id}`, base_price: 240, price: 240, status: 'confirmed',
  lanes: [7, 8], ops_plan: planDAvant({ pistes: [7, 8], laser: true, centre: o.center_id }), ...o,
});
// Un bowling achete en plus, la forme de lib/formule-en-plus.js (fusionnerLesEnPlus).
function enPlusBowling(plan, { heure, pistes, joueurs, prix = 39, minutes = 60 }) {
  const s = enMin(heure);
  const bloc = { type: 'activity', activityId: 'bowling', label: 'Bowling', resourceType: 'bowling_lane', countIndex: 2, start: s, end: s + minutes, startTime: heure, endTime: enHeure(s + minutes), durationMinutes: minutes, lanes: pistes, requiredLanes: pistes.length, players: joueurs, critical: true, enPlus: true };
  return {
    ...plan, timeline: [...plan.timeline, copie(bloc)], resourceBlocks: [...plan.resourceBlocks, bloc],
    enPlus: { prix, complet: true, items: [{ activityId: 'bowling', name: 'Bowling', participants: joueurs, duration: minutes / 60, heure, price: prix, priceKnown: true }] },
  };
}

// ---------------------------------------------------------------------------
// [A] LA REGLE ET LE CATALOGUE
// ---------------------------------------------------------------------------
async function scenarioA() {
  await monterServeur();
  const R = lib(REGLE);
  const oui = ['Toutes les activités illimitées', 'Accès illimité à toutes nos activités', 'Toutes les activités à volonté', 'TOUTES LES ACTIVITÉS ILLIMITÉES'];
  const non = ['Laser Game illimité', 'Arcades illimitées, hors jeux à cadeaux', 'Toutes les activités de la formule doivent être terminées à 12h', 'Toutes les activités de la formule sont illimitées le matin', '1h de Bowling', ''];
  ok(oui.every(R.ditToutIllimite) && !non.some(R.ditToutIllimite), '[A] la regle se lit sur les mots de la carte, et eux seuls', { oui: oui.filter((x) => !R.ditToutIllimite(x)), non: non.filter(R.ditToutIllimite) });
  ok(R.estToutIllimite('open_window', oui) && !R.estToutIllimite('flexible', oui) && !R.estToutIllimite(null, oui) && !R.estToutIllimite('illimite', oui), '[A] une formule a heures fixes ou un accès illimité n en est pas une');
  const S = lib(STORE);
  const { listCenterActivities } = lib('lib/activity-catalog.js');
  const { getCenter } = lib('lib/ops-knowledge.js');
  const META = lib('api/public-booking-meta.js').__test;
  for (const centre of CENTRES) {
    const servies = META.formulesPubliques(centre, getCenter(centre));
    const kfd = servies.find((f) => f.id === 'kfd');
    ok(servies.filter((f) => f.toutIllimite).map((f) => f.id).join() === 'kfd', `[A] ${centre} : seul le Kids Fun Day comprend tout, tel que le serveur le sert`, servies.filter((f) => f.toutIllimite).map((f) => f.id));
    ok(Boolean(kfd) && kfd.hasBowling === false && !kfd.bowlingDur && kfd.orderPolicy === 'open_window' && kfd.price === PRIX && kfd.type === 'per_pax', `[A] ${centre} : il n est plus une formule a pistes, malgre l etape de bowling de sa fiche ; ${PRIX} € par joueur`, kfd);
    const doc = S.getFormulaDoc('kfd', centre);
    ok(doc.steps.length > 0 && !doc.steps.some(R.prendUnePlace), `[A] ${centre} : aucune etape jouee ne prend de place`, doc.steps);
    const regles = S.getFormulaCatalogSteps('kfd', centre) || [];
    ok(regles.some((e) => e.activityId === 'bowling' && Number(e.durationMinutes) === 300) && regles.length === 3, `[A] ${centre} : Tarifs & formules garde l etape du catalogue`, regles);
    const comprises = R.activitesComprises('kfd', centre);
    const consoles = META.activitesPubliques(centre, getCenter(centre)).map((a) => a.id);
    ok([...comprises].sort().join() === COMPRISES[centre].join(), `[A] ${centre} : elle comprend ce que le centre propose, ${COMPRISES[centre].length} activites`, comprises);
    ok([...consoles].sort().join() === COMPRISES[centre].join() && listCenterActivities(centre).length === consoles.length, `[A] ${centre} : la console en lit la meme liste`, consoles);
    const mm = S.getFormulaDoc('mm', centre);
    ok(!servies.some((f) => f.id === 'mm' && f.toutIllimite) && mm.steps.filter((e) => e.activityId === 'laser_game').length > 0 && R.activitesComprises('mm', centre) === null, `[A] ${centre} : le Matin Malin garde son laser`, mm.steps);
  }
  // Sans la base (le fichier du depot), la meme formule : les deux jumelles du fichier le disent.
  C.CATALOGUE_BANC.formules.clear();
  C.CATALOGUE_BANC.etapes = [];
  await S.refreshCatalog(new (require(require.resolve('pg', { paths: [ROOT] })).Client)(), { force: true });
  ok(S.getBookingFormule('kfd', 'libramont').toutIllimite === true && S.getFormulaDoc('kfd', 'libramont').toutIllimite === true && lib('lib/booking-config.js').FORMULES.find((f) => f.id === 'kfd').toutIllimite === true, '[A] le fichier du depot dit la meme chose');
}

// ---------------------------------------------------------------------------
// [B] RIEN NE SE RESERVE
// ---------------------------------------------------------------------------
async function scenarioB() {
  for (const centre of CENTRES) {
    const serveur = await monterServeur([], { centre });
    const r = await creer(serveur, { centerId: centre });
    const enBase = dernier();
    const plan = (enBase && enBase.ops_plan) || {};
    ok(r.statut === 201 && enBase.center_id === centre && enBase.lanes.length === 0, `[B] ${centre} : le dossier se cree sans aucune piste`, { statut: r.statut, message: r.json.message, pistes: enBase && enBase.lanes });
    ok(placesDuPlan(plan).length === 0 && !plan.laserPassPlan && !(plan.assignedLanes || []).length, `[B] ${centre} : ni bloc de bowling ou de laser, ni partie a placer`, { blocs: plan.resourceBlocks, laser: plan.laserPassPlan });
    ok(plan.endTime === '17:00' && !(plan.timeline || []).some(lib(REGLE).prendUnePlace), `[B] ${centre} : la visite finit a 17:00, sa frise n a ni bowling ni laser`, plan.timeline);
    ok(Number(enBase.price) === 8 * PRIX && Number(enBase.base_price) === 8 * PRIX, `[B] ${centre} : ${8 * PRIX} € pour 8, comme avant`, { prix: enBase.price, reference: enBase.base_price });
    ok(r.json.reservation.lanes.length === 0 && r.json.reservation.duration === 0.5 && r.json.reservation.startTime === '12:00' && Number(r.json.reservation.price) === 8 * PRIX, `[B] ${centre} : la console le recoit tel quel`, { pistes: r.json.reservation.lanes, duree: r.json.reservation.duration });
    const seul = await creer(serveur, { centerId: centre, pax: 1, name: 'Un seul enfant', phone: '0470 55 66 77' });
    ok(seul.statut === 201 && Number(dernier().price) === PRIX, `[B] ${centre} : un enfant seul, ${PRIX} €`, { statut: seul.statut, message: seul.json.message });
  }
  // TOUTES LES PISTES ET TOUTES LES ARMES PRISES, DE 12:00 A 22:00 : le bowling et le laser se refusent, lui non.
  const armes = Number(lib('lib/ops-knowledge.js').getCenter('libramont').resources.laser.weaponCount);
  const plein = [B.ligne(901, { date: JOUR, start_time: '12:00', duration: 10, total_duration: 10, lanes: [1, 2, 3, 4, 5, 6, 7, 8], pax: 40, type: 'bowling', label: 'Bowling' })];
  for (let i = 0; i < 20; i += 1) {
    const debut = enHeure(720 + 30 * i);
    const bloc = C.blocLaser(debut, armes);
    plein.push(B.ligne(920 + i, { date: JOUR, start_time: debut, duration: 0.5, total_duration: 0.5, lanes: [], pax: armes, type: 'laser', label: 'Laser Game', ops_plan: { startTime: debut, endTime: bloc.endTime, resourceBlocks: [bloc], timeline: [copie(bloc)], conflicts: [], assignedLanes: [] } }));
  }
  const serveur = await monterServeur(plein);
  const bowling = await creer(serveur, { type: 'bowling', formuleId: '', label: 'Bowling', startTime: '14:00', pax: 4, duration: 1, totalDuration: 1, laneCount: 1 });
  const laser = await creer(serveur, { type: 'laser', formuleId: '', label: 'Laser Game', startTime: '14:00', pax: 4, duration: 0.5, totalDuration: 0.5, laserGames: 1 });
  ok([400, 409].includes(bowling.statut) && /piste/.test(bowling.json.message) && [400, 409].includes(laser.statut) && /armes/.test(laser.json.message), '[B] temoin : pistes et armes toutes prises, un bowling et un laser se refusent', { bowling: [bowling.statut, bowling.json.message], laser: [laser.statut, laser.json.message] });
  const r = await creer(serveur, { pax: 25 });
  ok(r.statut === 201 && Number(dernier().price) === 25 * PRIX, '[B] le Kids Fun Day se prend quand meme : « ils font autre chose »', { statut: r.statut, message: r.json.message });
  // LE BOWLING ET LA PLAINE PRIVATISES L APRES-MIDI : un bowling se refuse, le Kids Fun Day non.
  const prive = await monterServeur();
  await PB.poserBlocs(['bowling', 'playground'].map((id) => ({ scope_type: 'activity', scope_ref: id, date: JOUR, start_time: '13:00', end_time: '18:00', reason: 'Entreprise Lambert', kind: 'private' })));
  const refuse = await creer(prive, { type: 'bowling', formuleId: '', label: 'Bowling', startTime: '14:00', pax: 4, duration: 1, totalDuration: 1, laneCount: 1 });
  const pris = await creer(prive);
  ok([400, 409].includes(refuse.statut) && pris.statut === 201, '[B] bowling et plaine privatises : un bowling se refuse, le Kids Fun Day se prend', { bowling: [refuse.statut, refuse.json.message], kfd: [pris.statut, pris.json.message] });
}

// ---------------------------------------------------------------------------
// [C] LES PLACES LIBRES NE CHANGENT PAS
// ---------------------------------------------------------------------------
const QUESTIONS = [['bowling', 'type=bowling&pax=6&duration=1'], ['laser', 'type=laser&pax=10&games=1'], ['Formule 3', 'type=formule&formuleId=f3&pax=8']];
async function scenarioC() {
  const lire = async (centre) => Object.fromEntries(await Promise.all(QUESTIONS.map(async ([nom, q]) => [nom, await creneaux(centre, q)])));
  for (const centre of CENTRES) {
    await monterServeur([], { centre });
    const sans = await lire(centre);
    ok(sans.bowling.slots.length > 5 && sans.laser.slots.length > 5, `[C] ${centre} : le jour est ouvert, des creneaux se proposent`, sans);
    let serveur = await monterServeur([], { centre });
    for (let i = 0; i < 3; i += 1) {
      const r = await creer(serveur, { centerId: centre, startTime: ['12:00', '13:00', '14:30'][i], pax: 12 + i, name: `Groupe ${i}`, phone: `0470 20 20 2${i}` });
      ok(r.statut === 201, `[C] ${centre} : groupe ${i + 1} cree`, r.json.message);
    }
    const avec = await lire(centre);
    ok(JSON.stringify(avec) === JSON.stringify(sans), `[C] ${centre} : trois dossiers neufs, les memes places libres (bowling, laser, Formule 3)`, { sans: sans.bowling.slots.slice(0, 3), avec: avec.bowling.slots.slice(0, 3) });
    serveur = await monterServeur([ligneDAvant(701, { center_id: centre }), ligneDAvant(702, { center_id: centre, start_time: '13:00', lanes: [1, 2, 3], pax: 16, ops_plan: planDAvant({ debut: '13:00', pistes: [1, 2, 3], joueurs: 16, laser: true }) })], { centre });
    const avant = await lire(centre);
    ok(JSON.stringify(avant) === JSON.stringify(sans), `[C] ${centre} : deux dossiers d avant, leurs pistes ne tiennent plus rien`, { sans: sans.bowling.slots.slice(0, 3), avec: avant.bowling.slots.slice(0, 3) });
    const lu = enApi(701);
    ok(lu.lanes.length === 0 && lu.duration === 0.5 && placesDuPlan(lu.opsPlan).length === 0 && !lu.opsPlan.laserPassPlan && !lu.opsPlan.assignedLanes.length && !lu.opsPlan.timeline.some((e) => e.activityId === 'bowling'), `[C] ${centre} : un dossier d avant se lit sans piste ni partie a placer`, { pistes: lu.lanes, duree: lu.duration, blocs: lu.opsPlan.resourceBlocks, laser: lu.opsPlan.laserPassPlan });
    ok(lu.startTime === '12:00' && lu.totalDuration === 5 && lu.price === 240 && lu.basePrice === 240 && lu.pax === 8 && lu.opsPlan.endTime === '17:00' && lu.opsPlan.timeline.length === (centre === 'gembloux' ? 1 : 2), `[C] ${centre} : son heure, sa fin, ses joueurs et son prix ne bougent pas`, { debut: lu.startTime, fin: lu.opsPlan.endTime, prix: lu.price });
    const vendu = await creer(serveur, { centerId: centre, type: 'bowling', formuleId: '', label: 'Bowling', startTime: '14:00', pax: 40, duration: 1, totalDuration: 1, laneCount: 8, requiresLanes: true, name: 'Les huit pistes', phone: '0470 99 88 77' });
    ok(centre !== 'libramont' || (vendu.statut === 201 && dernier().lanes.length >= 7), `[C] ${centre} : les pistes qu ils « tenaient » se vendent`, { statut: vendu.statut, message: vendu.json.message, pistes: dernier().lanes });
  }
  // UN EN PLUS D AVANT GARDE SES PISTES, et elles seules.
  await monterServeur([ligneDAvant(703, { lanes: [4, 7, 8], price: 279, base_price: 279, ops_plan: enPlusBowling(planDAvant({ pistes: [7, 8] }), { heure: '17:00', pistes: [4], joueurs: 6 }) })]);
  const lu = enApi(703);
  ok(lu.lanes.join() === '4' && placesDuPlan(lu.opsPlan).length === 1 && lu.opsPlan.resourceBlocks[0].enPlus === true && lu.opsPlan.enPlus.items.length === 1, '[C] un bowling achete en plus garde sa piste, et elle seule', { pistes: lu.lanes, blocs: lu.opsPlan.resourceBlocks });
}

// ---------------------------------------------------------------------------
// [D] RIEN EN PLUS DE CE QUI EST COMPRIS
// ---------------------------------------------------------------------------
async function scenarioD() {
  let serveur = await monterServeur();
  for (const ligne of [{ activityId: 'bowling', duration: 1, heure: '17:30' }, { activityId: 'laser_game', games: 1, heure: '17:30' }, { activityId: 'minigolf_blacklight' }, { activityId: 'fun_run' }]) {
    const avant = B.base.reservations.size;
    const r = await creer(serveur, { enPlus: [ligne] });
    ok(r.statut === 422 && /est déjà compris dans KIDS FUN DAY, en illimité : rien à ajouter en plus\./.test(r.json.message || '') && B.base.reservations.size === avant, `[D] creer : ${ligne.activityId} en plus se refuse, la phrase dit pourquoi`, { statut: r.statut, message: r.json.message });
  }
  const temoin = await creer(serveur, { formuleId: 'f3', label: 'Formule 3', startTime: '14:00', duration: 1, totalDuration: 4, enPlus: [{ activityId: 'bowling', duration: 1, heure: '19:00' }] });
  const t = dernier();
  ok(temoin.statut === 201 && t.ops_plan.enPlus && t.ops_plan.enPlus.items.length === 1 && Number(t.ops_plan.enPlus.prix) > 0 && Number(t.price) > 8 * 30, '[D] temoin : une Formule 3 vend toujours son bowling en plus', { statut: temoin.statut, message: temoin.json.message, prix: t && t.price });
  // Cette Formule 3 passe a Kids Fun Day : le bowling en plus y est compris, il ne se paie plus.
  const f3 = enApi(t.id);
  const passe = await modifier(serveur, f3, { type: 'formule', formuleId: 'kfd', label: 'Kids Fun Day', startTime: '13:00', date: JOUR, pax: f3.pax, duration: 0.5, totalDuration: 4, lanes: [], price: null });
  const p = enApi(t.id);
  ok(passe.statut === 200 && p.formuleId === 'kfd' && p.lanes.length === 0 && placesDuPlan(p.opsPlan).length === 0 && !(p.opsPlan.enPlus && (p.opsPlan.enPlus.items || []).length), '[D] une Formule 3 et son bowling en plus qui passe a Kids Fun Day ne tient plus aucune piste', { statut: passe.statut, message: passe.json.message, pistes: p.lanes, enPlus: p.opsPlan.enPlus });
  ok(Number(p.price) === f3.pax * PRIX, `[D] ... et se paie ${f3.pax * PRIX} €, rien d autre`, { prix: p.price });
  // Modifier un Kids Fun Day.
  serveur = await monterServeur();
  await creer(serveur);
  const neuf = enApi(dernier().id);
  const refus = await modifier(serveur, neuf, { enPlus: [{ activityId: 'bowling', duration: 1, heure: '17:30' }] });
  ok(refus.statut === 422 && /déjà compris/.test(refus.json.message || '') && Number(enApi(neuf.id).price) === 240 && !enApi(neuf.id).opsPlan.enPlus, '[D] modifier : un bowling en plus se refuse, rien ne change', { statut: refus.statut, message: refus.json.message });
  const nom = await modifier(serveur, neuf, { name: 'Anniversaire Nora et Lina' });
  ok(nom.statut === 200 && enApi(neuf.id).name === 'Anniversaire Nora et Lina' && enApi(neuf.id).lanes.length === 0 && Number(enApi(neuf.id).price) === 240, '[D] modifier : un nom change seul s enregistre, sans piste, au meme prix', { statut: nom.statut, message: nom.json.message });
  const deux = await modifier(serveur, enApi(neuf.id), { pax: 10, date: JOUR, startTime: '12:30', type: 'formule', formuleId: 'kfd', duration: 0.5, totalDuration: 4.5, lanes: [], price: null });
  const apres = enApi(neuf.id);
  ok(deux.statut === 200 && apres.pax === 10 && Number(apres.price) === 300 && apres.lanes.length === 0 && placesDuPlan(apres.opsPlan).length === 0, '[D] modifier : deux enfants de plus a une autre heure, 300 €, toujours rien de pose', { statut: deux.statut, message: deux.json.message, prix: apres.price, pistes: apres.lanes });
  // UN DOSSIER D AVANT AVEC SES PISTES : deplace ou renomme, il ne les reprend pas.
  serveur = await monterServeur([ligneDAvant(711)]);
  const vieux = enApi(711);
  const renomme = await modifier(serveur, vieux, { name: 'Anniversaire Lucas' });
  ok(renomme.statut === 200 && (B.base.reservations.get(711).lanes || []).length === 0 && Number(B.base.reservations.get(711).price) === 240, '[D] un dossier d avant renomme ne tient plus ses pistes en base, au meme prix', { statut: renomme.statut, message: renomme.json.message, pistes: B.base.reservations.get(711).lanes });
  // UN EN PLUS D AVANT : il se garde (un nom change) et l equipe le retire.
  serveur = await monterServeur([ligneDAvant(712, { lanes: [4, 5, 7, 8], price: 318, base_price: 318, ops_plan: enPlusBowling(planDAvant({ pistes: [7, 8] }), { heure: '17:00', pistes: [4, 5], joueurs: 8, prix: 78 }) })]);
  const garde = await modifier(serveur, enApi(712), { name: 'Famille Collin' });
  ok(garde.statut === 200 && enApi(712).lanes.join() === '4,5' && (enApi(712).opsPlan.enPlus.items || []).length === 1 && Number(enApi(712).price) === 318, '[D] un bowling en plus d avant se garde quand on change autre chose', { statut: garde.statut, message: garde.json.message, pistes: enApi(712).lanes, prix: enApi(712).price });
  const repose = await modifier(serveur, enApi(712), { enPlus: [{ activityId: 'bowling', duration: 1, heure: '17:00', participants: 8 }] });
  ok(repose.statut === 200, '[D] ... et se repose tel quel', { statut: repose.statut, message: repose.json.message });
  // (l equipe le regle encore : deplace d une demi-heure, il n est pas « ajoute en plus », il reste le sien)
  const deplace = await modifier(serveur, enApi(712), { enPlus: [{ activityId: 'bowling', duration: 1, heure: '17:30', participants: 8 }] });
  const enPlusDeplace = ((enApi(712).opsPlan.enPlus || {}).items || [])[0] || {};
  ok(deplace.statut === 200 && enPlusDeplace.heure === '17:30', '[D] ... et se deplace a 17:30 sans etre refuse comme « deja compris »', { statut: deplace.statut, message: deplace.json.message, enPlus: enPlusDeplace });
  const retire = await modifier(serveur, enApi(712), { enPlus: [], price: null });
  ok(retire.statut === 200 && enApi(712).lanes.length === 0 && !((enApi(712).opsPlan.enPlus || {}).items || []).length && Number(enApi(712).price) === 240, '[D] ... et se retire : 240 €, plus aucune piste', { statut: retire.statut, message: retire.json.message, pistes: enApi(712).lanes, prix: enApi(712).price });
  // ADAPTEE A LA MAIN : avec un bowling elle garde ses pistes ; sans aucune place, elle comprend tout comme les autres.
  const programme = (ids) => ({ items: ids.map((id) => ({ activityId: id, name: id, participants: 8, ...(id === 'bowling' ? { duration: 1 } : {}) })), price: 240, priceComplete: true });
  const bloc = C.blocBowling('14:00', 60, [5, 6], 8);
  const adaptee = (ids, plan) => ligneDAvant(713, { label: 'KIDS FUN DAY (adaptée)', lanes: plan.assignedLanes, duration: 1, program: programme(ids), ops_plan: plan });
  await monterServeur([adaptee(['bowling', 'playground'], { startTime: '14:00', endTime: '15:00', assignedLanes: [5, 6], resourceBlocks: [bloc], timeline: [copie(bloc)], conflicts: [] })]);
  ok(enApi(713).lanes.join() === '5,6' && placesDuPlan(enApi(713).opsPlan).length === 1 && !lib(REGLE).dossierToutIllimite(enApi(713)), '[D] adaptee avec un bowling, elle garde ce que l equipe a pose', { pistes: enApi(713).lanes });
  await monterServeur([adaptee(['playground', 'arcade_time'], planDAvant({ pistes: [7, 8] }))]);
  ok(enApi(713).lanes.length === 0 && lib(REGLE).dossierToutIllimite(enApi(713)), '[D] adaptee sans aucune place, elle comprend tout comme les autres', { pistes: enApi(713).lanes });
  // AUCUN COMPLEMENT A VENDRE au formulaire, meme quand une formule du centre reprend ses etapes et y ajoute un
  // laser (elle se propose a une autre formule de plaine et d arcades).
  const jumelle = (id, prix, ordre) => ({ ...copie(FICHE_EN_BASE), id, name: id.toUpperCase(), price_value: prix, description_lines: ['Plaine et arcades illimitées', 'Laser Game illimité'], source: 'custom', sort_index: 90 + ordre });
  await monterServeur([], {
    formules: [jumelle('plaine', 30, 1), jumelle('plaine-laser', 40, 2)],
    etapes: ['plaine', 'plaine-laser'].flatMap((id) => [etapeEnBase(0, 'playground', 300, id), etapeEnBase(1, 'arcade_time', 300, id), ...(id === 'plaine' ? [] : [etapeEnBase(2, 'laser_game', 20, id)])]),
  });
  const complements = (formuleId) => lib('lib/booking-complements.js').buildFormulaComplements({ centerId: 'libramont', formuleId, date: JOUR, pax: 8, retainedSlot: { time: '12:00', lanes: [], opsPlan: {} }, type: 'formule', duration: 0, priceOptions: { bowlingConfig: null, dateStr: JOUR }, reservations: [], laneStatuses: {}, blocks: [], passesFinalGuards: null }).map((c) => c.id);
  ok(complements('plaine').includes('plaine-laser') && complements('kfd').length === 0, '[D] le formulaire ne propose aucun complement au Kids Fun Day (une formule voisine en a)', { plaine: complements('plaine'), kfd: complements('kfd') });
}

// ---------------------------------------------------------------------------
// [E] LES AUTRES LECTEURS
// ---------------------------------------------------------------------------
async function scenarioE() {
  for (const centre of CENTRES) {
    await monterServeur([ligneDAvant(721, { center_id: centre })], { centre });
    const r = enApi(721);
    const P = lib('lib/programme-a-cocher.js');
    const reglages = { postes: 30, formules: lib('lib/booking-config.js').getEffectiveFormules(centre, { comptoir: true }), activites: lib('lib/activity-catalog.js').listCenterActivities(centre) };
    const etapes = P.etapesACocher(r, reglages);
    ok(etapes.map((e) => e.activityId).sort().join() === COMPRISES[centre].join() && etapes.every((e) => e.illimite && e.start === null && !e.aPlacer && e.cle === `${e.activityId}-1`), `[E] ${centre} : l assistant lit une case par activite comprise, sans heure ni partie a placer`, etapes.map((e) => [e.cle, e.start, e.aPlacer]));
    // LA FEUILLE DE SECOURS : « illim. » dans les colonnes des activites du centre, vide dans les autres.
    const F = lib('lib/feuille-secours.js');
    const cases = F.casesActivites(r);
    const colonnes = F.COLONNES_ACTIVITES.map((c) => [c.cle, c.activites.some((id) => COMPRISES[centre].includes(id))]);
    ok(colonnes.every(([cle, dedans]) => cases[cle] === (dedans ? 'illim.' : '')), `[E] ${centre} : la feuille de secours dit « illim. » dans ces colonnes, et elles seules`, cases);
    const bureau = lib('lib/demande-bureau-centre.js').formuleDuCentre(centre, 'kfd');
    ok(bureau.parties.length === 1 && bureau.parties[0].nom === 'Toutes les activités, en illimité' && bureau.pistes === false && bureau.prixParJoueur === PRIX, `[E] ${centre} : une demande de bureau dit « Toutes les activités, en illimité », sans piste`, bureau);
  }
  await monterServeur([ligneDAvant(722, { lanes: [4, 5], ops_plan: enPlusBowling(planDAvant(), { heure: '17:00', pistes: [4, 5], joueurs: 8 }) })]);
  const F = lib('lib/feuille-secours.js');
  const cases = F.casesActivites(enApi(722));
  ok(/X/.test(cases.bowling) && cases.lg === 'illim.', '[E] un bowling achete en plus garde ses croix sur la feuille', cases);
}

// ---------------------------------------------------------------------------
// [J] LE FORMULAIRE PUBLIC
// ---------------------------------------------------------------------------
async function scenarioJ() {
  const serveur = await monterServeur();
  const r = await B.appeler(serveur.S.dispo, 'GET', `/api/public-availability?date=${JOUR}&centerId=libramont&type=formule&formuleId=kfd&pax=8`);
  const { slots = [], ...reste } = r.json;
  ok(slots.length === 10 && slots[0].time === '12:00' && slots[9].time === '16:30' && slots.every((s) => !(s.lanes || []).length && s.opsPlan.endTime === '17:00'), '[J] des heures d arrivee de 12:00 a 16:30, jusqu a 17:00, aucune piste', slots.map((s) => [s.time, s.lanes, s.opsPlan && s.opsPlan.endTime]));
  ok(reste.requiresLanes === false && Number(reste.laneCount) === 0 && reste.price === 8 * PRIX && ((reste.anchors && reste.anchors.activities) || []).length === 0 && Number((reste.anchors || {}).laserGames || 0) === 0, '[J] ni piste, ni heure d activite, ni partie a choisir ; 240 € pour 8', reste);
  const cree = await B.appeler(serveur.S.reservations, 'POST', '/api/public-reservations', {
    centerId: 'libramont', date: JOUR, startTime: '12:00', pax: 5, channel: 'public', type: 'formule', formuleId: 'kfd', name: 'Claire Dubois', phone: '0470 12 34 56', email: 'claire@exemple.test', label: 'KIDS FUN DAY',
    duration: 5, totalDuration: 5, price: 150, basePrice: 150, preference: { preferredTimes: {}, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' },
  });
  const ligne = dernier();
  ok(cree.statut === 201 && ligne && ligne.lanes.length === 0 && placesDuPlan(ligne.ops_plan).length === 0 && !ligne.ops_plan.laserPassPlan && Number(ligne.price) === 150, '[J] une reservation en ligne n a ni piste ni partie a placer, 150 € pour 5', { statut: cree.statut, message: cree.json.message, pistes: ligne && ligne.lanes, prix: ligne && ligne.price });
}

// ---------------------------------------------------------------------------
// LA CONSOLE : le mercredi « normal », sept groupes Kids Fun Day, le catalogue que ce serveur sert.
// ---------------------------------------------------------------------------
const CLUB = 1583; // la fixture : un dossier d avant, sans piste (13:00, 10 joueurs, 300 €)
const NORA = 9301; // un dossier d avant avec les pistes 7 et 8 de 12:00 a 17:00 (la capture du gerant)
const COLLIN = 9303; // avec un bowling achete en plus a 17:00, pistes 4 et 5
const BASTIN = 9304; // attendu a 13:30, en retard
const ADAPTE = 9305; // adapte a la main avec un bowling de 14:30, pistes 3 et 6
const ANNULE = 9306;
const ABSENT = 9307;
const ECOLE = 9308; // 35 joueurs, plus que l arene n a d armes
const F1 = 1587; // une Formule 1 a 15:00 et son bowling en plus a 18:00, pistes 7 et 8
const KFD = [CLUB, NORA, COLLIN, BASTIN, ADAPTE, ANNULE, ABSENT, ECOLE];
const NOTE_DEMO = /\[DEMO-JOURS[^\]]*\][^\n]*/g;

function journee() {
  const tous = copie(FX.lireFixture('normal').staffState.reservations).map((r) => ({ ...r, name: String(r.name || '').replace(/^DÉMO · /, ''), notes: String(r.notes || '').replace(NOTE_DEMO, '').trim() }));
  const club = tous.find((r) => r.id === CLUB);
  Object.assign(club, { status: 'arrived', label: 'KIDS FUN DAY' });
  const f1 = tous.find((r) => r.id === F1);
  Object.assign(f1, { opsPlan: enPlusBowling(f1.opsPlan, { heure: '18:00', pistes: [7, 8], joueurs: 8, prix: 78 }), lanes: [1, 2, 7, 8], price: 286, basePrice: 286 });
  const groupe = (o) => ({ ...copie(club), duration: 5, occasion: '', clientKey: `kfd:${o.id}`, basePrice: o.price, ...o, opsPlan: o.opsPlan || planDAvant({ debut: o.startTime, joueurs: o.pax }) });
  const bloc = C.blocBowling('14:30', 60, [3, 6], 8);
  tous.push(
    groupe({ id: NORA, name: 'Anniversaire Nora (7 ans)', pax: 8, price: 240, startTime: '12:00', lanes: [7, 8], opsPlan: planDAvant({ pistes: [7, 8], laser: true }) }),
    groupe({ id: COLLIN, name: 'Famille Collin', pax: 8, price: 318, startTime: '13:00', totalDuration: 5, lanes: [4, 5], opsPlan: enPlusBowling(planDAvant({ debut: '13:00' }), { heure: '17:00', pistes: [4, 5], joueurs: 8, prix: 78 }) }),
    groupe({ id: BASTIN, name: 'Cousins Bastin', pax: 4, price: 120, startTime: '13:30', status: 'pending' }),
    groupe({ id: ADAPTE, name: 'Amis de Zoé', pax: 8, price: 240, startTime: '14:30', label: 'KIDS FUN DAY (adaptée)', duration: 1, lanes: [3, 6], program: { items: [{ activityId: 'bowling', name: 'Bowling', participants: 8, duration: 1 }, { activityId: 'playground', name: 'Playground', participants: 8 }], price: 240, priceComplete: true }, opsPlan: { startTime: '14:30', endTime: '15:30', assignedLanes: [3, 6], resourceBlocks: [bloc], timeline: [copie(bloc)], conflicts: [] }, status: 'pending' }),
    groupe({ id: ECOLE, name: 'École communale', pax: 35, price: 1050, startTime: '13:30' }),
    groupe({ id: ANNULE, name: 'Groupe annulé', pax: 5, price: 150, startTime: '12:30', status: 'cancelled' }),
    groupe({ id: ABSENT, name: 'Groupe absent', pax: 5, price: 150, startTime: '12:30', status: 'pending', absentAt: FX.instant(JOUR, '13:20').toISOString() }),
  );
  return tous;
}
const enLigne = (r) => B.ligne(r.id, {
  center_id: 'libramont', channel: r.channel || 'staff', name: r.name, phone: r.phone || '', email: r.email || '', date: r.date, start_time: r.startTime, duration: r.duration, total_duration: r.totalDuration ?? r.duration,
  lanes: (r.lanes || []).map(Number), pax: r.pax, status: r.status, base_price: r.basePrice, price: r.price, type: r.type, formule_id: r.formuleId || null, label: r.label, occasion: r.occasion || '', extras: r.extras || [],
  payment_method: r.paymentMethod || null, notes: r.notes || '', ops_plan: r.opsPlan || null, risk_level: r.riskLevel || '', risk_score: r.riskScore ?? null, validation_status: r.validationStatus || 'confirmed',
  activity_progress: r.activityProgress || {}, program: r.program || null, companions: r.companions || 0, created_at: new Date(r.createdAt), updated_at: new Date(r.updatedAt), client_key: r.clientKey || '',
  paid_at: null, amount_paid: null, discount_reason: '', absent_at: r.absentAt ? new Date(r.absentAt) : null,
});

async function ouvrir(browser, { centre = 'libramont', appareil = 'comptoir', theme = 'light', heure = HEURE, sans = [], neuf = true, plein = false, payes = [], enTout = 0 } = {}) {
  const dossiers = journee().filter((r) => !sans.includes(r.id)).map((r) => (payes.includes(r.id) ? { ...r, status: 'paid' } : r));
  // (un mercredi charge : `enTout` groupes a volonte de plus)
  const modele = dossiers.find((r) => r.id === BASTIN);
  for (let i = 0; i < enTout; i += 1) dossiers.push({ ...copie(modele), id: 9400 + i, name: `Famille numéro ${i + 1} de Neufchâteau`, clientKey: `kfd:${9400 + i}`, startTime: '14:30', status: i % 2 ? 'arrived' : 'pending' });
  const serveur = await monterServeur(dossiers.map(enLigne), { heure, centre: 'libramont' });
  const META = lib('api/public-booking-meta.js').__test;
  const { getCenter } = lib('lib/ops-knowledge.js');
  const meta = { ...FX.lireCentre().publicBookingMeta, formules: META.formulesPubliques(centre, getCenter(centre)), activities: META.activitesPubliques(centre, getCenter(centre)), today: JOUR };
  // LE DOSSIER NEUF, cree par ce serveur.
  let idNeuf = null;
  if (neuf) {
    const cree = await creer(serveur, { startTime: '14:30', pax: 3, name: 'Famille Dethier', phone: '0470 20 30 40', totalDuration: 2.5 });
    if (cree.statut !== 201) throw new Error(`dossier neuf : ${cree.statut} ${cree.json.message}`);
    idNeuf = cree.json.reservation.id;
    dossiers.push(cree.json.reservation);
  }
  const journal = [];
  const m = await FX.monter(browser, {
    fixture: 'normal', appareil, theme, port: PORT, heure, plein,
    avantChargement: async (page) => {
      await page.exposeFunction('__fixtureServeur', async (c) => { journal.push({ m: 'PATCH', corps: c }); return serveur.appeler('PATCH', '/api/staff-reservations', c); });
      await page.exposeFunction('__fixtureBlanc', async (c) => { journal.push({ m: 'POST', corps: c }); return serveur.appeler('POST', '/api/staff-reservations', c); });
      await page.exposeFunction('__fixtureLecture', async (chemin) => {
        const u = new URL(chemin, 'http://banc');
        if (u.pathname === '/api/public-booking-meta') return meta;
        if (u.pathname === '/api/staff-reservations') { const r = await serveur.appeler('GET', chemin); return { ...r.json, __statut: r.statut }; }
        if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'surMesureCatalogue') return { ok: true, centerId: 'libramont', surMesure: C.CATALOGUE, formulesGardees: [] };
        return null;
      });
    },
  });
  m.page.setDefaultTimeout(20000);
  await m.page.evaluate((jour) => {
    const fx = window.__FIXTURE__;
    fx.jours[fx.jour] = jour.map((x) => JSON.parse(JSON.stringify(x)));
    state.reservations = jour.map((x) => JSON.parse(JSON.stringify(x)));
    renderStaff();
  }, dossiers);
  await FX.repos(m.page, 500);
  return { ...m, serveur, journal, idNeuf };
}
async function avec(browser, quoi, o, corps) {
  const m = await ouvrir(browser, o);
  try {
    await corps(m.page, m);
    ok(m.erreurs.length === 0, `[Z] aucune erreur de page (${quoi})`, m.erreurs.slice(0, 3));
  } finally { await m.ctx.close(); }
}
const aller = async (page, vue) => { await page.evaluate((v) => pbChanger(v), vue); await FX.repos(page, 400); };
async function fermer(page) { await page.evaluate(() => fermerFiche()); await FX.repos(page, 250); }
async function ouvrirModifier(page, id) {
  await page.evaluate((rid) => openPos(rid), id);
  await page.waitForSelector('#posOverlay:not(.hidden)', { timeout: 10000 });
  await FX.repos(page, 300);
  await page.locator('#posOverlay button').filter({ hasText: /^Modifier$/ }).first().click();
  await page.waitForSelector('#posOverlay .fm-programme', { timeout: 10000 });
  await FX.repos(page, 600);
}
const photo = async (page, nom, o = {}) => {
  if (!CAPTURES || mutation) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await FX.repos(page, 300);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`), ...o });
};

// ---------------------------------------------------------------------------
// CE QUI SE LIT DANS LA PAGE.
// ---------------------------------------------------------------------------
const lireLigne = (page, id) => page.evaluate((rid) => {
  const tr = document.querySelector(`#globalPlanningGridWrap tr.gf-r[data-gf-id="${rid}"]`);
  if (!tr) return null;
  const tetes = [...document.querySelectorAll('#globalPlanningGridWrap thead th.gf-th--a')].map((th) => th.textContent.trim());
  return [...tr.querySelectorAll('td.gf-a')].map((td, i) => ({ col: td.getAttribute('data-gf-titre') || tetes[i] || '', textes: [...td.querySelectorAll('.gf-x')].map((x) => ((x.querySelector('.gf-x__t') || x).textContent || '').trim()) }));
}, id);
const enMots = (ligne) => Object.fromEntries((ligne || []).filter((c) => c.textes.length).map((c) => [c.col, c.textes.join(' + ')]));
const lireTetes = (page) => page.evaluate(() => [...document.querySelectorAll('#globalPlanningGridWrap thead th.gf-th--a')].map((th) => ({ cle: th.getAttribute('data-gf-cle'), titre: th.textContent.trim(), bulle: th.getAttribute('title') || '' })));
const lireBandeau = (page, id) => page.evaluate((zone) => {
  const z = document.getElementById(zone);
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  if (!z) return null;
  const vu = !z.hidden && z.getClientRects().length > 0;
  const boite = z.getBoundingClientRect();
  return {
    vu, titre: t(z.querySelector('.pl-volonte__t')), haut: Math.round(boite.height),
    groupes: [...z.querySelectorAll('.pl-volonte__g')].map((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      const rvb = (cs.backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
      return {
        id: Number(b.dataset.volonte), nom: t(b.querySelector('b')), texte: t(b), aria: b.getAttribute('aria-label') || '',
        etat: (b.className.match(/is-(la|retard|parti)/) || [])[1] || 'attendu', grise: b.classList.contains('is-grise'),
        h: Math.round(r.height), dedans: r.left >= boite.left - 0.5 && r.right <= boite.right + 0.5 && b.scrollWidth <= b.clientWidth + 1,
        // (un fond plus clair que sombre, jamais un bouton noir)
        clair: rvb.length >= 3 ? (rvb[0] * 299 + rvb[1] * 587 + rvb[2] * 114) / 1000 : 255,
        police: cs.fontFamily, taille: parseFloat(cs.fontSize),
      };
    }),
  };
}, id);
// Ce que les plannings comptent et dessinent, hors bandeau.
const lireCompte = (page) => page.evaluate(() => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  return {
    bowling: t(document.getElementById('staffBowlingCount')), laser: t(document.getElementById('staffLaserCount')),
    etats: [...document.querySelectorAll('[data-gf-etat]')].map(t),
  };
});
const lireGrilleBowling = (page) => page.evaluate(() => ({
  texte: document.getElementById('planningGridWrap').textContent.replace(/\s+/g, ' ').trim(),
  cartes: [...document.querySelectorAll('#planningGridWrap .booking')].map((c) => [c.getAttribute('data-booking-res-id'), c.getAttribute('data-booking-lane') || c.getAttribute('data-lane') || '', c.getAttribute('data-booking-start')]),
}));
const lireGrilleLaser = (page) => page.evaluate(() => ({
  texte: document.getElementById('laserPlanningGridWrap').textContent.replace(/\s+/g, ' ').trim(),
  groupes: [...document.querySelectorAll('#laserPlanningGridWrap .lp-g')].map((g) => [g.getAttribute('data-laser-res-id'), (g.closest('.lp-dep') || g).getAttribute('data-lp-t')]),
  // (les parties a placer du jour, la barre du planning laser)
  aPlacer: getPendingLaserPasses(state.currentDate).length,
}));
const sansDebordement = (page) => page.evaluate(() => ({ page: document.scrollingElement.scrollWidth, iw: window.innerWidth }));

// ---------------------------------------------------------------------------
// [F] LE PLANNING COMPLET
// ---------------------------------------------------------------------------
const COLONNES = {
  libramont: ['Arcades', 'Billard', 'Bowling', 'Duckpin', 'Laser', 'Minigolf', 'Pixel', 'Plaine'],
  gembloux: ['Arcades', 'Billard', 'Bowling', 'Laser', 'Minigolf', 'O’Clock'],
};
const groupesDe = (bulle) => { const n = /: (\d+) groupes?/.exec(bulle); return n ? Number(n[1]) : 0; };
const illimitesDe = (bulle) => { const n = /(\d+) en illimité/.exec(bulle); return n ? Number(n[1]) : 0; };
async function colonnesEtFiche(browser) {
  for (const centre of CENTRES) {
    await avec(browser, `planning complet, ${centre}`, { centre }, async (page, m) => {
      await aller(page, 'all');
      if (centre === 'libramont') await photo(page, 'kids-fun-day-planning-complet');
      for (const [quoi, id] of [['un dossier neuf', m.idNeuf], ['un dossier d avant sans piste', CLUB], ['un dossier d avant avec ses pistes', NORA]]) {
        const ligne = enMots(await lireLigne(page, id));
        ok(Object.keys(ligne).sort().join() === COLONNES[centre].join() && Object.values(ligne).every((t) => t === 'Illimité'), `[F] ${centre}, ${quoi} : « Illimité » dans chaque colonne de ses activites`, ligne);
      }
      if (centre !== 'libramont') return;
      const collin = enMots(await lireLigne(page, COLLIN));
      ok(collin.Bowling === 'Illimité + 17:00' && Object.keys(collin).length === 8, '[F] un bowling achete en plus garde son heure, a cote d « Illimité »', collin);
      const zoe = enMots(await lireLigne(page, ADAPTE));
      ok(zoe.Bowling === '14:30' && !Object.values(zoe).includes('Illimité'), '[F] adapte a la main avec un bowling, il dit son heure', zoe);
      const temoin = enMots(await lireLigne(page, F1));
      ok(temoin.Bowling === '15:00 + 18:00' && !Object.values(temoin).includes('Illimité'), '[F] temoin : une Formule 1 garde ses heures', temoin);
      const larg = await sansDebordement(page);
      ok(larg.page <= larg.iw + 1, '[F] les huit colonnes ouvertes ne font pas defiler la page de cote', larg);
      // LA FICHE : une case par activite, les memes que le programme lu par l assistant.
      const P = lib('lib/programme-a-cocher.js');
      const reglages = { postes: 30, formules: lib('lib/booking-config.js').getEffectiveFormules(centre, { comptoir: true }), activites: lib('lib/activity-catalog.js').listCenterActivities(centre) };
      for (const id of [m.idNeuf, CLUB, NORA, COLLIN]) {
        const cles = await page.evaluate((rid) => getGroupeProgramme(state.reservations.find((x) => Number(x.id) === rid)).filter((e) => e.coche).map((e) => e.coche), id);
        const twin = P.etapesACocher(enApi(id), reglages).filter((e) => !e.sansCoche).map((e) => e.cle);
        ok(cles.length === 8 && JSON.stringify(cles) === JSON.stringify(twin), `[F] le dossier ${id} : la fiche a les memes cases que l assistant, une par activite`, { fiche: cles, assistant: twin });
      }
      await page.evaluate((rid) => openPos(rid), NORA);
      await page.waitForSelector('#posOverlay:not(.hidden) .fx-programme', { timeout: 10000 });
      await FX.repos(page, 300);
      const fiche = await page.evaluate(() => ({ texte: document.querySelector('#posOverlay .fx-programme').innerText.replace(/\s+/g, ' '), cases: [...document.querySelectorAll('#posOverlay .fx-programme button.gc-check')].length }));
      ok((fiche.texte.match(/Illimité/g) || []).length === 8 && /0 sur 8/.test(fiche.texte) && !/--:--|à placer/i.test(fiche.texte) && fiche.cases === 8, '[F] la fiche : huit lignes « Illimité », huit cases, rien « à placer »', fiche);
      await page.locator('#posOverlay .fx-programme button.gc-check').first().click();
      await page.waitForFunction((rid) => { const r = state.reservations.find((x) => Number(x.id) === rid); return Boolean(r && r.activityProgress && r.activityProgress['bowling-1'] && r.activityProgress['bowling-1'].done); }, NORA, { timeout: 8000 }).catch(() => null);
      ok(Boolean((enApi(NORA).activityProgress['bowling-1'] || {}).done) && Number(enApi(NORA).price) === 240, '[F] une activite se coche, et s ecrit', enApi(NORA).activityProgress);
      await fermer(page);
    });
  }
}
// LA TETE DES COLONNES, L ETAT DU CENTRE ET LES COMPTEURS : les memes sans aucun Kids Fun Day.
async function teteDesColonnes(browser) {
  let avecEux = null;
  await avec(browser, 'tete des colonnes, avec', { sans: [ADAPTE, COLLIN] }, async (page) => { await aller(page, 'all'); avecEux = { tetes: await lireTetes(page), compte: await lireCompte(page) }; });
  await avec(browser, 'tete des colonnes, sans', { sans: KFD, neuf: false }, async (page) => {
    await aller(page, 'all');
    const sans = { tetes: await lireTetes(page), compte: await lireCompte(page) };
    const attendu = Object.fromEntries(sans.tetes.map((t) => [t.cle, groupesDe(t.bulle)]));
    ok(avecEux.tetes.length === 8 && avecEux.tetes.every((t) => groupesDe(t.bulle) === (attendu[t.cle] || 0) && illimitesDe(t.bulle) === 5), '[F] la tete de colonne ne les compte pas avec les groupes a l heure, « 5 en illimité »', { avec: avecEux.tetes.map((t) => t.bulle), sans: sans.tetes.map((t) => t.bulle) });
    ok(JSON.stringify(avecEux.compte) === JSON.stringify(sans.compte), '[F] pistes libres, prochain depart laser et compteurs des onglets : les memes avec et sans', { avec: avecEux.compte, sans: sans.compte });
  });
}

// ---------------------------------------------------------------------------
// [G] MODIFIER
// ---------------------------------------------------------------------------
const lireModifier = (page) => page.evaluate(() => {
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const zone = document.querySelector('#posOverlay .fm-programme');
  if (!zone) return null;
  const vus = (sel) => [...zone.querySelectorAll(sel)].filter((n) => n.getClientRects().length);
  const enPlus = [...zone.querySelectorAll('[data-edit-en-plus]')].map((x) => ({
    id: x.dataset.editEnPlus, nom: t(x.querySelector('h5')), detail: t(x.querySelector('.fm-act-detail')), pistes: t(x.querySelector('.fm-act-pistes')),
    heure: t(x.querySelector('.fm-act-heure')), duree: [...x.querySelectorAll('.qb-dur-btn.active, [aria-pressed="true"]')].map(t), retirer: Boolean(x.querySelector('.fm-retirer')), texte: t(x),
  }));
  return {
    illimite: [...zone.querySelectorAll('.fm-illimite li')].map((li) => [li.dataset.illimite, t(li.querySelector('strong'))]),
    phrase: t(zone.querySelector('.fm-illimite-dit')),
    cartes: [...zone.querySelectorAll('.dossier-activity:not([data-edit-en-plus])')].map(t),
    // (tout ce qui se regle dans les activites, hors d une activite en plus)
    reglages: vus('.fm-acts input, .fm-acts button, .fm-acts select').filter((n) => !n.closest('[data-edit-en-plus]')).map((n) => n.tagName + ' ' + t(n)),
    ajouts: vus('.fm-ajout').map(t), adapter: Boolean(document.getElementById('editAdapter')), duree: Boolean(document.getElementById('editDurationInput')), pistes: Boolean(document.getElementById('editLanesLabel')),
    enPlus, formule: (document.getElementById('editFormuleSelect') || {}).value || '', carte: [...zone.querySelectorAll('.fm-acts .edit-formule-list li')].map(t),
    prix: (document.getElementById('editPriceInput') || {}).value || '', bas: t(document.getElementById('editModifs')),
    parts: (() => { const p = partsTvaEdition(getEditPrixEstime()); return { n: p.length, somme: Math.round(p.reduce((s, x) => s + Number(x.montant || 0), 0) * 100) / 100, sortes: [...new Set(p.map((x) => x.sorte))] }; })(),
  };
});
async function scenarioG(browser) {
  await avec(browser, 'Modifier', {}, async (page, m) => {
    for (const [quoi, id, prix] of [['un dossier d avant avec ses pistes (la capture)', NORA, '240'], ['un dossier d avant', CLUB, '300'], ['un dossier neuf', m.idNeuf, '90']]) {
      await ouvrirModifier(page, id);
      const l = await lireModifier(page);
      ok(l.illimite.map((x) => x[0]).sort().join() === COMPRISES.libramont.join() && l.illimite.every((x) => x[1] === 'Illimité') && /Rien à réserver : ils jouent quand une piste ou un départ est libre\./.test(l.phrase), `[G] ${quoi} : chaque activite comprise se lit « Illimité »`, l.illimite);
      ok(l.cartes.length === 0 && l.reglages.length === 0 && !l.duree && !l.pistes, `[G] ${quoi} : ni carte, ni heure, ni duree, ni pistes, ni joueurs a regler`, { cartes: l.cartes, reglages: l.reglages, duree: l.duree, pistes: l.pistes });
      ok(l.ajouts.length === 0 && !l.adapter && l.enPlus.length === 0, `[G] ${quoi} : « Ajouter » ne propose rien de compris, rien a adapter`, { ajouts: l.ajouts, enPlus: l.enPlus });
      ok(l.prix === prix && l.formule === 'kfd' && l.carte.join() === FICHE_EN_BASE.description_lines.join(), `[G] ${quoi} : ${prix} €, sa formule et les lignes de sa carte`, { prix: l.prix, formule: l.formule, carte: l.carte });
      ok(l.parts.somme === Number(prix) && l.parts.sortes.join() === 'activities', `[G] ${quoi} : la TVA se calcule sur le meme prix, en un seul taux`, l.parts);
      if (id === NORA) await photo(page, 'kids-fun-day-modifier');
      await fermer(page);
    }
    // ADAPTE A LA MAIN SANS AUCUNE PLACE (un playground et des arcades) : il comprend tout, Modifier ne lui rallume
    // aucune activite a regler (sa carte dit « (adaptée) », seule la regle du dossier le voit).
    const programmeAdapte = await page.evaluate((rid) => {
      const r = { ...state.reservations.find((x) => Number(x.id) === rid), label: 'KIDS FUN DAY (adaptée)', program: { items: [{ activityId: 'playground', name: 'Playground', participants: 10 }, { activityId: 'arcade_time', name: 'Arcades', participants: 10 }], price: 300, priceComplete: true } };
      const e = buildEditProgramFromReservation(r);
      return { tout: dossierToutIllimite(r), bowling: e.bowling.on, laser: e.laser_game.on, autres: Object.keys(e.others).filter((k) => e.others[k]) };
    }, CLUB);
    ok(programmeAdapte.tout && !programmeAdapte.bowling && !programmeAdapte.laser && programmeAdapte.autres.length === 0, '[G] un dossier adapte sans aucune place : Modifier ne rallume aucune activite a regler', programmeAdapte);
    // UN NOM CHANGE SEUL S ENREGISTRE : le dossier d avant perd ses pistes en base, pas son prix.
    await ouvrirModifier(page, NORA);
    await page.fill('#editNameInput', 'Anniversaire Nora et Lina');
    await FX.repos(page, 400);
    await page.locator('#posOverlay .fm button[type="submit"], #posOverlay form.edit-form button[type="submit"]').last().click();
    for (let i = 0; i < 60 && enApi(NORA).name !== 'Anniversaire Nora et Lina'; i += 1) await page.waitForTimeout(100);
    await FX.repos(page, 500);
    const nora = enApi(NORA);
    ok(nora.name === 'Anniversaire Nora et Lina' && Number(nora.price) === 240 && (B.base.reservations.get(NORA).lanes || []).length === 0 && nora.startTime === '12:00', '[G] un nom change seul s enregistre : 240 €, 12:00, plus aucune piste', { nom: nora.name, prix: nora.price, pistes: B.base.reservations.get(NORA).lanes });
    await page.evaluate(() => { if (!document.getElementById('posOverlay').classList.contains('hidden')) fermerFiche(); });
    await FX.repos(page, 300);
    // UN BOWLING EN PLUS D AVANT : son heure, sa duree, ses pistes, « Retirer ».
    await ouvrirModifier(page, COLLIN);
    const c = await lireModifier(page);
    ok(c.illimite.length === 8 && c.enPlus.length === 1 && c.enPlus[0].id === 'bowling' && /17:00/.test(c.enPlus[0].texte + c.enPlus[0].heure) && c.enPlus[0].detail === 'en plus de la formule · 78 €' && c.enPlus[0].pistes === 'pistes 4, 5' && c.enPlus[0].duree.includes('1 heure') && c.enPlus[0].retirer && c.prix === '318', '[G] un bowling achete en plus se lit avec son heure, sa duree, ses pistes et son prix', c.enPlus);
    await page.locator('[data-edit-en-plus="bowling"] .fm-retirer').click();
    await FX.repos(page, 1200);
    const sansLui = await lireModifier(page);
    ok(sansLui.enPlus.length === 0 && sansLui.ajouts.length === 0 && sansLui.prix === '240', '[G] retire, il ne se repropose pas, 240 €', { enPlus: sansLui.enPlus, ajouts: sansLui.ajouts, prix: sansLui.prix });
    await fermer(page);
    const quitter = page.locator('button').filter({ hasText: /^(Quitter sans enregistrer|Fermer sans enregistrer|Abandonner)$/ });
    if (await quitter.count()) { await quitter.first().click(); await FX.repos(page, 300); }
    // UNE FORMULE 1 ET SON BOWLING EN PLUS : choisir Kids Fun Day ne le garde pas, revenir le rend.
    await ouvrirModifier(page, F1);
    const avant = await lireModifier(page);
    await page.selectOption('#editFormuleSelect', 'kfd');
    await FX.repos(page, 1200);
    const pendant = await lireModifier(page);
    await page.selectOption('#editFormuleSelect', 'f1');
    await FX.repos(page, 1200);
    const retour = await lireModifier(page);
    ok(avant.enPlus.length === 1 && avant.illimite.length === 0 && avant.ajouts.length > 0, '[G] temoin : une Formule 1 a son bowling en plus, « Ajouter » propose le reste', { enPlus: avant.enPlus.map((x) => x.id), ajouts: avant.ajouts });
    ok(pendant.enPlus.length === 0 && pendant.illimite.length === 8 && pendant.ajouts.length === 0 && pendant.cartes.length === 0 && pendant.prix === '240', '[G] choisir Kids Fun Day : 240 €, « Illimité » partout, son bowling en plus n y est plus', { enPlus: pendant.enPlus, illimite: pendant.illimite.length, ajouts: pendant.ajouts, cartes: pendant.cartes, prix: pendant.prix });
    ok(retour.enPlus.length === 1 && retour.illimite.length === 0 && retour.prix === avant.prix, '[G] revenir a la Formule 1 rend son bowling en plus et son prix', { enPlus: retour.enPlus.map((x) => x.id), prix: [avant.prix, retour.prix] });
  });
}

// ---------------------------------------------------------------------------
// [H] RESERVER
// ---------------------------------------------------------------------------
async function versLesActivites(page) {
  for (let i = 0; i < 4 && !(await page.evaluate(() => rsEtat().q === 'activites')); i += 1) {
    await page.click('#quickBookOverlay #rsRetour').catch(() => {});
    await page.waitForTimeout(250);
  }
  await C.pret(page);
  await FX.repos(page, 300);
}
async function scenarioH(browser) {
  await avec(browser, 'Réserver', { neuf: false }, async (page) => {
    await C.ouvrirFenetre(page, 8);
    await page.click('#quickBookOverlay #rsFormules');
    await page.waitForSelector('#quickBookOverlay [data-formule="kfd"]', { timeout: 8000 });
    const carte = (await page.locator('#quickBookOverlay [data-formule="kfd"]').innerText()).replace(/\s+/g, ' ');
    ok(/toutes les activités, en illimité/.test(carte) && /30 €/.test(carte) && !/bowling|piste|5 h/i.test(carte), '[H] la formule se dit « toutes les activités, en illimité », 30 €', carte);
    await page.click('#quickBookOverlay [data-formule="kfd"]');
    await page.waitForSelector('#quickBookOverlay #rsL-a-formule', { timeout: 8000 });
    await C.pret(page);
    await FX.repos(page, 400);
    await photo(page, 'kids-fun-day-reserver');
    // SA LIGNE DU TICKET OUVERTE : ce qu elle comprend, rien a regler.
    await page.click('#quickBookOverlay #rsL-a-formule');
    await FX.repos(page, 500);
    const ligne = await page.evaluate(() => ({ comprises: [...document.querySelectorAll('#rsToutIllimite li')].map((x) => x.textContent.trim()), adapter: Boolean(document.getElementById('rvAdapter')), texte: document.getElementById('rsCol').innerText.replace(/\s+/g, ' ') }));
    ok(ligne.comprises.length === 8 && !ligne.adapter && /Rien à réserver : ils jouent quand une piste ou un départ est libre\./.test(ligne.texte), '[H] sa ligne liste les huit activites, sans « Adapter à ce groupe »', ligne);
    ok(!/Pistes|Durée|parties?\b/i.test(ligne.texte.replace(/quand une piste/g, '')), '[H] sa ligne ne demande ni pistes, ni duree, ni parties', ligne.texte);
    await versLesActivites(page);
    const page1 = await page.evaluate(() => ({
      tuiles: [...document.querySelectorAll('#quickBookOverlay .rs-pt')].map((b) => [b.id.replace('rsT-', ''), b.classList.contains('is-on'), (b.querySelector('small') || {}).textContent || '']),
      blocs: ['bowling', 'laser_game'].map((id) => { const z = document.getElementById('rsZ-' + id); return z ? [id, (z.querySelector('small') || {}).textContent || '', z.querySelectorAll('button').length] : [id, null, null]; }),
      mesure: (document.getElementById('rsTkMesure') || {}).textContent || '',
      total: (document.getElementById('rvTotalPied') || {}).textContent || '',
      hauteur: document.getElementById('rsCol').scrollHeight - document.getElementById('rsCol').clientHeight,
    }));
    ok(page1.tuiles.length === 6 && page1.tuiles.every((x) => x[1] && x[2] === 'illimité'), '[H] chaque tuile dit « illimité », sans prix', page1.tuiles);
    ok(page1.blocs.every((x) => x[1] === 'illimité, rien à réserver' && x[2] === 0), '[H] le bowling et le laser : « illimité, rien à réserver », aucun bouton (piste, duree, partie, Ajouter)', page1.blocs);
    ok(/Ajouter une boisson ou un repas/.test(page1.mesure) && /240/.test(page1.total) && page1.hauteur <= 1, '[H] le ticket n ajoute qu une boisson ou un repas ; 240 € ; la fenetre tient', page1);
    await page.click('#quickBookOverlay #rsT-minigolf_blacklight');
    await FX.repos(page, 400);
    const touche = await page.evaluate(() => ({ enPlus: (quickBookState.enPlus || []).length, adaptee: Boolean(quickBookState.adaptee), dit: (document.getElementById('rvVerdict') || {}).textContent || '', total: (document.getElementById('rvTotalPied') || {}).textContent || '' }));
    ok(touche.enPlus === 0 && !touche.adaptee && /déjà dans Kids fun day, en illimité/.test(touche.dit) && /240/.test(touche.total), '[H] toucher le minigolf n ajoute rien et le dit', touche);
    await page.click('#quickBookOverlay #rsTkMesure');
    await FX.repos(page, 400);
    const onglets = await page.evaluate(() => document.getElementById('rsCol').innerText.replace(/\s+/g, ' '));
    ok(/Nourriture/.test(onglets) && /Boissons/.test(onglets) && !/Activités Nourriture/.test(onglets), '[H] « Ajouter une boisson ou un repas » n ouvre aucune activite', onglets.slice(0, 260));
    // « CRÉER ».
    const avant = new Set(B.base.reservations.keys());
    await page.fill('#quickBookOverlay #qbPhone', '0470 21 11 26');
    await C.pret(page);
    await page.waitForTimeout(400);
    await page.click('#quickBookOverlay #rvCreer');
    let ids = [];
    for (let i = 0; i < 60 && !ids.length; i += 1) { ids = [...B.base.reservations.keys()].filter((id) => !avant.has(id)); await page.waitForTimeout(150); }
    const r = ids.length ? enApi(ids[0]) : null;
    ok(Boolean(r) && r.formuleId === 'kfd' && r.lanes.length === 0 && placesDuPlan(r.opsPlan).length === 0 && !r.opsPlan.laserPassPlan && Number(r.price) === 240 && r.opsPlan.endTime === '17:00' && r.duration === 0.5 && !/adaptée/.test(r.label), '[H] « Créer » : le dossier n a rien de pose, 240 €, jusqu a 17:00', r && { pistes: r.lanes, prix: r.price, fin: r.opsPlan.endTime, duree: r.duration, nom: r.label });
  });
}

// ---------------------------------------------------------------------------
// [I] LES BANDEAUX « À VOLONTÉ »
// ---------------------------------------------------------------------------
const PHRASES = { bowling: ['planningVolonte', 'Aucune piste réservée : ils jouent quand une piste est libre.'], laser: ['laserVolonte', 'Aucune arme réservée : ils jouent quand un départ a de la place.'] };
async function bandeauxDuJour(browser) {
  await avec(browser, 'bandeaux', {}, async (page, m) => {
    for (const [vue, [zone, phrase]] of Object.entries(PHRASES)) {
      await aller(page, vue);
      await photo(page, `kids-fun-day-planning-${vue}`);
      const b = await lireBandeau(page, zone);
      ok(b.vu && b.titre === `À volonté Kids Fun Day ${phrase}`, `[I] ${vue} : le bandeau dit « À volonté », la formule et la phrase`, b.titre);
      ok(b.groupes.map((g) => g.id).join() === [NORA, CLUB, COLLIN, BASTIN, ECOLE, m.idNeuf].join(), `[I] ${vue} : les groupes du jour dans l ordre, sans l annule, l absent ni l adapte avec bowling`, b.groupes.map((g) => [g.id, g.nom]));
      ok(b.groupes.map((g) => g.texte).join(' | ') === ['Anniversaire Nora (7 ans) 8 joueurs Arrivé jusqu’à 17:00', 'Club des enfants du mercredi 10 joueurs Arrivé jusqu’à 17:00', 'Famille Collin 8 joueurs Arrivé jusqu’à 17:00', 'Cousins Bastin 4 joueurs En retard jusqu’à 17:00', 'École communale 35 joueurs Arrivé jusqu’à 17:00', 'Famille Dethier 3 joueurs Attendu à 14:30 jusqu’à 17:00'].join(' | '), `[I] ${vue} : chaque groupe dit ses joueurs, son etat et jusqu a quelle heure`, b.groupes.map((g) => g.texte));
      ok(b.groupes.map((g) => g.etat).join() === 'la,la,la,retard,la,attendu' && b.groupes.every((g) => /Ouvrir sa fiche$/.test(g.aria)), `[I] ${vue} : l etat se voit aussi a sa couleur, le bouton se dit aux lecteurs d ecran`, b.groupes.map((g) => [g.etat, g.aria]));
      ok(b.groupes.every((g) => g.clair > 200 && /Geist/.test(g.police) && g.taille >= 13), `[I] ${vue} : sobre, en Geist, jamais un bouton noir`, b.groupes.map((g) => [g.clair, g.police, g.taille]));
      await page.locator(`#${zone} [data-volonte="${BASTIN}"]`).click();
      await page.waitForFunction(() => !document.getElementById('posOverlay').classList.contains('hidden'), null, { timeout: 6000 }).catch(() => null);
      const ouverte = await page.evaluate(() => ({ ouverte: !document.getElementById('posOverlay').classList.contains('hidden'), id: state.selectedRes && Number(state.selectedRes.id) }));
      ok(ouverte.ouverte && ouverte.id === BASTIN, `[I] ${vue} : un toucher ouvre la fiche`, ouverte);
      if (ouverte.ouverte) await fermer(page);
      // LA RECHERCHE DU PLANNING les grise comme le reste.
      await page.evaluate(() => { state.searchTerm = 'Collin'; renderStaff(); });
      await FX.repos(page, 300);
      const cherche = await lireBandeau(page, zone);
      ok(cherche.groupes.filter((g) => !g.grise).map((g) => g.id).join() === String(COLLIN), `[I] ${vue} : la recherche grise les autres`, cherche.groupes.map((g) => [g.id, g.grise]));
      await page.evaluate(() => { state.searchTerm = ''; renderStaff(); });
      await FX.repos(page, 300);
    }
    // UNE ACTIVITE QUE LE CENTRE N A PAS : pas de bandeau.
    await aller(page, 'laser');
    await page.evaluate(() => { setCenterActivities(getCenterActivities().filter((a) => a.id !== 'laser_game')); renderStaff(); });
    await FX.repos(page, 300);
    ok(!(await lireBandeau(page, 'laserVolonte')).vu, '[I] un centre sans laser : pas de bandeau au planning laser');
  });
}
// LA GRILLE ET LES COMPTEURS : les memes avec et sans (sans l adapte ni le bowling en plus, qui ont de vraies pistes).
async function grilleEtCompteurs(browser) {
  const releve = {};
  const lire = async (page) => {
    await aller(page, 'bowling');
    const r = { bowling: await lireGrilleBowling(page), compte: await lireCompte(page), bandeau: (await lireBandeau(page, 'planningVolonte')) };
    await aller(page, 'laser');
    return { ...r, laser: await lireGrilleLaser(page), bandeauLaser: await lireBandeau(page, 'laserVolonte') };
  };
  await avec(browser, 'grille, avec', { sans: [ADAPTE, COLLIN] }, async (page) => { releve.avec = await lire(page); });
  await avec(browser, 'grille, sans', { sans: KFD, neuf: false }, async (page) => { releve.sans = await lire(page); });
  ok(releve.avec.bandeau.vu && releve.avec.bandeauLaser.vu && !releve.sans.bandeau.vu && !releve.sans.bandeauLaser.vu && releve.sans.bandeau.haut === 0 && releve.sans.bandeauLaser.haut === 0, '[I] caches un jour sans aucun de ces groupes', { sans: [releve.sans.bandeau, releve.sans.bandeauLaser] });
  ok(JSON.stringify(releve.avec.bowling) === JSON.stringify(releve.sans.bowling), '[I] la grille du bowling est la meme avec et sans eux', { avec: releve.avec.bowling.cartes, sans: releve.sans.bowling.cartes });
  ok(JSON.stringify(releve.avec.laser) === JSON.stringify(releve.sans.laser), '[I] la grille du laser et ses parties a placer sont les memes avec et sans eux', { avec: releve.avec.laser.texte.slice(0, 500), sans: releve.sans.laser.texte.slice(0, 500) });
  ok(JSON.stringify(releve.avec.compte) === JSON.stringify(releve.sans.compte), '[I] les compteurs des onglets sont les memes', { avec: releve.avec.compte, sans: releve.sans.compte });
}
// LE SOIR : un groupe paye et sa visite finie est parti (groupeReparti, la regle de tous les plannings) ; un autre
// pas encore encaisse est toujours « Arrivé ».
async function leSoir(browser) {
  await avec(browser, 'bandeaux, le soir', { heure: '18:10', neuf: false, payes: [CLUB] }, async (page) => {
    await aller(page, 'bowling');
    const b = await lireBandeau(page, 'planningVolonte');
    const par = Object.fromEntries(b.groupes.map((g) => [g.id, g]));
    ok(par[CLUB].etat === 'parti' && /10 joueurs Parti jusqu’à 17:00/.test(par[CLUB].texte) && par[NORA].etat === 'la' && /Arrivé/.test(par[NORA].texte), '[I] le soir, un groupe paye et fini se dit « Parti »', b.groupes.map((g) => [g.nom, g.etat, g.texte]));
  });
}
// UN MERCREDI CHARGE (26 groupes) : la liste defile dans le tiers de l ecran, la grille garde sa place, et un groupe
// pointe ailleurs ne fait sauter ni la liste ni le clavier.
async function mercrediCharge(browser) {
  for (const [appareil, taille] of [['comptoir', 1366], ['tablette', 1024], ['telephone', 390]]) {
    await avec(browser, `26 groupes, ${taille} px`, { appareil, enTout: 20 }, async (page) => {
      await aller(page, 'bowling');
      const m = await page.evaluate(() => {
        const l = document.querySelector('#planningVolonte .pl-volonte__l');
        l.scrollTop = 60;
        const vise = l.querySelectorAll('.pl-volonte__g')[8];
        vise.focus({ preventScroll: true });
        const id = vise.dataset.volonte;
        const avant = l.scrollTop;
        const r = state.reservations.find((x) => String(x.id) === '9400');
        r.status = 'arrived';
        renderStaff();
        const apres = document.querySelector('#planningVolonte .pl-volonte__l');
        return { n: apres.querySelectorAll('.pl-volonte__g').length, h: Math.round(apres.getBoundingClientRect().height), ih: innerHeight, defile: apres.scrollHeight > apres.clientHeight + 20, avant, reste: apres.scrollTop, focus: document.activeElement && document.activeElement.dataset.volonte === id, grille: Math.round(document.getElementById('planningGridWrap').getBoundingClientRect().height) };
      });
      const larg = await sansDebordement(page);
      ok(m.n === 26 && m.defile && m.h <= Math.ceil(m.ih * 0.31) + 6 && m.grille > 160 && larg.page <= larg.iw + 1, `[I] 26 groupes, ${taille} px : la liste tient dans le tiers de l ecran, la grille garde sa place`, { m, larg });
      ok(m.avant > 0 && m.reste === m.avant && m.focus, `[I] 26 groupes, ${taille} px : un groupe pointe ailleurs ne fait sauter ni la liste ni le clavier`, m);
    });
  }
}
// LES ECRANS.
async function ecransDuBandeau(browser) {
  for (const [appareil, taille] of [['comptoir', 1366], ['portable', 1280], ['tablette', 1024], ['telephone', 390]]) {
    for (const plein of appareil === 'telephone' || appareil === 'portable' ? [false] : [false, true]) {
      await avec(browser, `${taille} px${plein ? ', plein écran' : ''}`, { appareil }, async (page) => {
        for (const [vue, [zone]] of Object.entries(PHRASES)) {
          await aller(page, vue);
          if (plein) { await page.evaluate((v) => (v === 'laser' ? toggleLaserPlanningExpanded() : togglePlanningExpanded()), vue); await FX.repos(page, 500); }
          const b = await lireBandeau(page, zone);
          const larg = await sansDebordement(page);
          ok(b.vu && b.groupes.length === 6 && b.groupes.every((g) => g.dedans) && larg.page <= larg.iw + 1, `[I] ${taille} px${plein ? ', plein écran' : ''}, ${vue} : rien ne deborde, aucun mot coupe`, { larg, groupes: b.groupes.map((g) => [g.nom, g.dedans]) });
          if (appareil === 'tablette' || appareil === 'telephone') ok(b.groupes.every((g) => g.h >= 44), `[I] ${taille} px, ${vue} : chaque groupe se touche au doigt (44 px)`, b.groupes.map((g) => g.h));
          const grille = await page.evaluate((v) => { const w = document.getElementById(v === 'laser' ? 'laserPlanningGridWrap' : 'planningGridWrap').getBoundingClientRect(); return { haut: Math.round(w.height), bas: Math.round(w.bottom), ih: window.innerHeight }; }, vue);
          ok(grille.haut > 160, `[I] ${taille} px${plein ? ', plein écran' : ''}, ${vue} : la grille garde sa place dessous`, grille);
          if (plein) { await page.evaluate((v) => (v === 'laser' ? toggleLaserPlanningExpanded() : togglePlanningExpanded()), vue); await FX.repos(page, 400); }
        }
      });
    }
  }
}

const SCENARIOS_SERVEUR = { A: [scenarioA], B: [scenarioB], C: [scenarioC], D: [scenarioD], E: [scenarioE], J: [scenarioJ] };
const SCENARIOS_CONSOLE = { F: [colonnesEtFiche, teteDesColonnes], G: [scenarioG], H: [scenarioH], I: [bandeauxDuJour, grilleEtCompteurs, leSoir, mercrediCharge, ecransDuBandeau] };

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : chaque regle retiree fait rougir sa lettre. `serveur` : le code du serveur, compile en memoire.
// ---------------------------------------------------------------------------
const S = (fichier, de, vers) => ({ fichier, de, vers, serveur: true });
const K = (fichier, de, vers) => ({ fichier, de, vers });
const SANS_PLACE = S(STORE, '    const libres = etapesSansPlace(catalogSteps);', '    const libres = catalogSteps;');
const MUTATIONS = [
  // le serveur
  { nom: 'regle-trop-large', lettre: 'A', scenario: scenarioA, editions: [S(REGLE, "  return /\\btoutes (?:les |nos )?activites\\b(?! de la formule)/.test(texte) && /\\billimite|\\ba volonte\\b/.test(texte);", "  return /\\billimite|\\ba volonte\\b/.test(texte);")] },
  { nom: 'bowling-de-la-fiche-joue', lettre: 'A', scenario: scenarioA, editions: [SANS_PLACE] },
  { nom: 'tarifs-perd-les-etapes', lettre: 'A', scenario: scenarioA, editions: [S(STORE, '    if (canonical.toutIllimite) catalogStepsById.set(id, formulaDocFromCanonical({ ...canonical, steps: canonical.catalogSteps }).steps);\n', '')] },
  { nom: 'le-serveur-tient-des-pistes', lettre: 'B', scenario: scenarioB, editions: [SANS_PLACE] },
  { nom: 'privatise-le-refuse', lettre: 'B', scenario: scenarioB, editions: [S(BASE, "  const tout = require('./formule-tout-illimite').dossierToutIllimite(payload);", '  const tout = false;')] },
  { nom: 'dossiers-d-avant-tiennent', lettre: 'C', scenario: scenarioC, editions: [S(BASE, "  return require('./formule-tout-illimite').dossierSansPlaces({", '  return ((dossier) => dossier)({')] },
  { nom: 'en-plus-perdu-a-la-lecture', lettre: 'C', scenario: scenarioC, editions: [S(REGLE, '  const reste = (bloc) => Boolean(bloc) && (bloc.enPlus === true || !prendUnePlace(bloc));', '  const reste = (bloc) => Boolean(bloc) && !prendUnePlace(bloc);')] },
  { nom: 'creer-vend-l-en-plus', lettre: 'D', scenario: scenarioD, editions: [S(FENETRE, '  if (compris) throw Object.assign(new Error(compris.message), { statusCode: 422, expose: true });\n', '')] },
  { nom: 'modifier-vend-l-en-plus', lettre: 'D', scenario: scenarioD, editions: [S(API, '  if (compris) throw Object.assign(createHttpError(', '  if (false) throw Object.assign(createHttpError(')] },
  { nom: 'en-plus-d-avant-fige', lettre: 'D', scenario: scenarioD, editions: [S(API, 'deja: avant ? avant.items.map((x) => x.activityId) : [] });', 'deja: [] });')] },
  { nom: 'changer-de-formule-le-garde', lettre: 'D', scenario: scenarioD, editions: [S(API, '      : decalees).filter((x) => !(comprises && comprises.includes(String(x.activityId))));', '      : decalees);')] },
  { nom: 'adaptee-perd-ses-pistes', lettre: 'D', scenario: scenarioD, editions: [S(REGLE, "  return !(lignes.some(prendUnePlace) && LIBELLE_ADAPTE.test(String(dossier.label || '')));", '  return true;')] },
  { nom: 'complement-propose', lettre: 'D', scenario: scenarioD, editions: [S('lib/booking-complements.js', '  if (currentFormule.toutIllimite) return [];\n', '')] },
  { nom: 'assistant-comme-avant', lettre: 'E', scenario: scenarioE, editions: [S('lib/programme-a-cocher.js', '  const illimite = toutIllimite(r, R);', '  const illimite = false;')] },
  { nom: 'feuille-muette', lettre: 'E', scenario: scenarioE, editions: [S('lib/feuille-secours.js', "  if (!presentes.some((a) => a.blocs.some((b) => b.enPlus)) && comprisesEnIllimite(resa).some((id) => col.activites.includes(id))) return 'illim.';\n", '')] },
  { nom: 'feuille-sans-croix', lettre: 'E', scenario: scenarioE, editions: [S('lib/feuille-secours.js', '  if (!presentes.some((a) => a.blocs.some((b) => b.enPlus)) && comprisesEnIllimite(resa)', '  if (comprisesEnIllimite(resa)')] },
  { nom: 'bureau-par-etapes', lettre: 'E', scenario: scenarioE, editions: [S('lib/demande-bureau-centre.js', "  if (f.toutIllimite) parties.push({ activite: 'tout_illimite', nom: 'Toutes les activités, en illimité', libelle: true, compte: 1, minutes: 0 });\n", '')] },
  { nom: 'formulaire-a-pistes', lettre: 'J', scenario: scenarioJ, editions: [SANS_PLACE] },
  // la console
  { nom: 'colonnes-oubliees', lettre: 'F', scenario: colonnesEtFiche, editions: [K(PG, '        if (!e.illimite || !e.activityId) return;\n', '        return;\n')] },
  { nom: 'programme-comme-avant', lettre: 'F', scenario: colonnesEtFiche, editions: [K(APP, "  const toutIllimite = typeof dossierToutIllimite === 'function' && dossierToutIllimite(r);\n  if (toutIllimite) {\n", '  const toutIllimite = false;\n  if (toutIllimite) {\n')] },
  { nom: 'en-plus-noye', lettre: 'F', scenario: colonnesEtFiche, editions: [K(PG, '    if (enPlus.length) liste = liste.concat(enPlus);\n', '')] },
  { nom: 'adaptee-illimitee', lettre: 'F', scenario: colonnesEtFiche, editions: [K(PG, "    if (f && f.toutIllimite === true && typeof dossierToutIllimite === 'function' && !dossierToutIllimite(r)) return false;\n", '')] },
  { nom: 'comptes-avec-les-autres', lettre: 'F', scenario: teteDesColonnes, editions: [K(PG, '      var n = c.groupes - (c.illimites || 0);', '      var n = c.groupes;')] },
  { nom: 'carte-bowling', lettre: 'G', scenario: scenarioG, editions: [K(APP, "  if (typeof dossierToutIllimite === 'function' && dossierToutIllimite(r)) return etat;\n", '')] },
  { nom: 'ajouter-propose', lettre: 'G', scenario: scenarioG, editions: [K(APP, "      if (toutIllimite) return '';\n", '')] },
  { nom: 'liste-absente', lettre: 'G', scenario: scenarioG, editions: [K(APP, "  const comprises = toutIllimite ? illimiteComprisEditionHtml(r) : '';", "  const comprises = '';")] },
  { nom: 'pistes-muettes', lettre: 'G', scenario: scenarioG, editions: [K(APP, "function pistesEnPlusEdition(x) {\n  if (x.id !== 'bowling') return '';", "function pistesEnPlusEdition(x) {\n  return '';")] },
  { nom: 'choisir-le-garde', lettre: 'G', scenario: scenarioG, editions: [K(APP, '    e.enPlusEdite = e.enPlusAvantIllimite.filter((x) => !comprises.includes(x.id));', '    e.enPlusEdite = e.enPlusAvantIllimite;')] },
  { nom: 'revenir-ne-rend-rien', lettre: 'G', scenario: scenarioG, editions: [K(APP, '    e.enPlusEdite = e.enPlusAvantIllimite;\n    delete e.enPlusAvantIllimite;\n', '    delete e.enPlusAvantIllimite;\n')] },
  { nom: 'resume-des-etapes', lettre: 'H', scenario: scenarioH, editions: [K(APP, "  if (typeof formuleToutIllimite === 'function' && formuleToutIllimite(f)) return 'toutes les activités, en illimité';\n", '')] },
  { nom: 'adapter-propose', lettre: 'H', scenario: scenarioH, editions: [K(APP, "  if (rsNiveau('formule') === 'oui' && !rvToutIllimite()) {", "  if (rsNiveau('formule') === 'oui') {")] },
  { nom: 'tuile-payante', lettre: 'H', scenario: scenarioH, editions: [K(APP, '  return rvToutIllimite() && activitesToutIllimite().some((activite) => String(activite.id) === String(id));', '  return false;')] },
  { nom: 'blocs-a-ajouter', lettre: 'H', scenario: scenarioH, editions: [K(APP, "    const bouton = compris || (acces && rvPrisDansLAcces(id)) ? '' :", "    const bouton = acces && rvPrisDansLAcces(id) ? '' :")] },
  { nom: 'bandeau-jamais-rendu', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, "  renderBandeauVolonte('bowling');\n", '')] },
  { nom: 'bandeau-laser-jamais-rendu', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, "  renderBandeauVolonte('laser_game');\n", '')] },
  { nom: 'annules-et-absents-montres', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, '    .filter(r => tientSesPlaces(r) && dossierToutIllimite(r))', '    .filter(r => dossierToutIllimite(r))')] },
  { nom: 'activite-absente-ignoree', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, "  if (typeof dossierToutIllimite !== 'function' || !activitesToutIllimite().some(activite => String(activite.id) === activityId)) return [];", "  if (typeof dossierToutIllimite !== 'function') return [];")] },
  { nom: 'retard-oublie', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, '    const retard = !la && groupeEnRetardAuPlanning(r, moment);', '    const retard = false;')] },
  { nom: 'sans-fiche', lettre: 'I', scenario: bandeauxDuJour, editions: [K(APP, '. Ouvrir sa fiche`)}" onclick="openPos(${Number(r.id)})"><i aria-hidden="true">', '. Ouvrir sa fiche`)}"><i aria-hidden="true">')] },
  { nom: 'bouton-noir', lettre: 'I', scenario: bandeauxDuJour, editions: [K(CSS, 'border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-strong); color: var(--muted); font: inherit; font-size: 13px;', 'border-radius: 10px; background: #111; color: var(--muted); font: inherit; font-size: 13px;')] },
  { nom: 'bandeau-vide-affiche', lettre: 'I', scenario: grilleEtCompteurs, editions: [K(APP, '  zone.innerHTML = html;\n  zone.hidden = !html;\n  if (haut && liste)', '  zone.innerHTML = html;\n  zone.hidden = false;\n  if (haut && liste)'), K(APP, '  if (zone.__rendu === html) return;\n  zone.__rendu = html;\n  // (un groupe pointe ailleurs', '  // (un groupe pointe ailleurs')] },
  { nom: 'ancien-plan-dessine', lettre: 'I', scenario: grilleEtCompteurs, editions: [K(BC, '(Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : []).filter(block => !toutIllimite || (block && block.enPlus));', '(Array.isArray(reservation.opsPlan?.resourceBlocks) ? reservation.opsPlan.resourceBlocks : []);')] },
  { nom: 'partie-fantome', lettre: 'I', scenario: grilleEtCompteurs, editions: [K(BC, '  if (dossierToutIllimite(reservation) && !getLaserWindowsFromReservation(reservation).length) return [];\n', '')] },
  { nom: 'parti-oublie', lettre: 'I', scenario: leSoir, editions: [K(APP, '    const parti = la && groupeReparti(r, moment, maintenant, span);', '    const parti = false;')] },
  { nom: 'liste-sans-borne', lettre: 'I', scenario: mercrediCharge, editions: [K(CSS, 'min-width: 0; max-height: 30vh; margin: -3px;', 'min-width: 0; margin: -3px;')] },
  { nom: 'la-liste-saute', lettre: 'I', scenario: mercrediCharge, editions: [K(APP, "  if (haut && liste) zone.querySelector('.pl-volonte__l').scrollTop = haut;\n", '')] },
  { nom: 'le-clavier-saute', lettre: 'I', scenario: mercrediCharge, editions: [K(APP, '  if (vise) vise.focus({ preventScroll: true });\n}\n\nfunction renderPlanning() {', '}\n\nfunction renderPlanning() {')] },
  { nom: 'une-seule-ligne', lettre: 'I', scenario: ecransDuBandeau, editions: [K(CSS, '.pl-volonte__l { display: flex; flex-wrap: wrap; gap: 6px;', '.pl-volonte__l { display: flex; flex-wrap: nowrap; gap: 6px;'), K(CSS, '.pl-volonte__g { --pl-volonte-c: var(--accent); box-sizing: border-box; display: inline-flex; flex-wrap: wrap;', '.pl-volonte__g { --pl-volonte-c: var(--accent); flex: none; box-sizing: border-box; display: inline-flex; flex-wrap: nowrap;')] },
  { nom: 'trop-petit-au-doigt', lettre: 'I', scenario: ecransDuBandeau, editions: [K(CSS, '@media (pointer: coarse) { .pl-volonte__g { min-height: 44px; } }', '')] },
];

async function contrePreuves(browser) {
  console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
  const lf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  for (const m of MUTATIONS.filter((x) => !process.env.KFD_MUTATIONS || liste(process.env.KFD_MUTATIONS).includes(x.nom))) {
    const ancres = m.editions.map((ed) => lf(ed.fichier).split(ed.de).length - 1);
    if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
    const avant = echecs;
    const garde = rouges.length;
    mutation = m;
    silence = !process.env.KFD_BAVARD;
    try {
      await m.scenario(browser);
    // (un plantage n est pas une regle qui rougit : il se dit, et la contre-preuve reste a prouver)
    } catch (e) { if (!(e instanceof Mordu)) rouges.push(`plantage : ${e.message}`); }
    silence = false;
    mutation = null;
    const vus = rouges.slice(garde);
    rouges.length = garde;
    echecs = avant;
    ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
  }
}

async function main() {
  const t0 = Date.now();
  const contre = process.argv.includes('--contre-preuves');
  const voulus = (l) => !process.env.KFD_SCENARIOS || liste(process.env.KFD_SCENARIOS).includes(l);
  const serveur = contre ? [] : Object.keys(SCENARIOS_SERVEUR).filter(voulus);
  const console_ = contre ? [] : Object.keys(SCENARIOS_CONSOLE).filter(voulus);
  for (const lettre of serveur) { console.log(`\n[${lettre}]`); for (const f of SCENARIOS_SERVEUR[lettre]) await f(); }
  if (contre || console_.length) {
    const serveurHttp = await FX.servir({ port: PORT, transformer });
    const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    try {
      if (contre) await contrePreuves(browser);
      for (const lettre of console_) { console.log(`\n[${lettre}]`); for (const f of SCENARIOS_CONSOLE[lettre]) await f(browser); }
    } finally { await browser.close(); serveurHttp.close(); }
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nkids-fun-day-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nkids-fun-day-check: ALL OK${contre ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
