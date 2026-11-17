// LE COMPTOIR REVERIFIE LES INSTALLATIONS COMPTEES SOUS LE VERROU (2026-11-16, partie A de la
// verification avant le lancement).
//
// Le trou, mesure au banc avant correction : le plan du comptoir se calcule AVANT la transaction, et la
// creation (lib/reserver-creation.js, creerDepuisLaFenetre) ne passait pas la garde des installations
// comptees a createReservation. Deux postes qui creaient en meme temps un groupe de 12 au duckpin (2
// pistes a Libramont) recevaient deux fois 201 : 4 pistes vendues pour 2. Et un dossier que le plan
// refusait pour cette raison (« Duckpin Bowling est complet sur ce créneau. ») etait cree quand meme,
// sans « À placer », si la requete partait sans « Créer quand même ». Le formulaire en ligne, lui,
// rejouait deja la garde sous le verrou de la journee (api/public-reservations.js).
//
// Ce gate monte le VRAI handler api/staff-reservations.js, la vraie lib/database.js et le vrai moteur sur
// la base en memoire du banc (scripts/reserver-banc.js : vraies transactions, vrais verrous de journee) :
//   [A] LA COURSE : deux postes creent en meme temps un groupe qui prend toute la dotation ; un seul
//       passe, l autre est refuse avec le nom de l activite, un seul dossier est en base. Le meme refus
//       quand un collegue valide son groupe entre le plan du poste et son verrou ;
//   [B] SANS « CRÉER QUAND MÊME » : une dotation deja prise refuse la creation, rien n est ecrit ; avec,
//       le dossier part « À placer », signe, et c est le choix de l equipe ;
//   [C] ELLE NE REFUSE QUE L IRREALISABLE : deux groupes d une piste chacun passent ensemble ; une
//       activite sans dotation n est pas bridee ; une autre heure reste libre.
//   [D] LE REFUS DIT POURQUOI (C10, 2026-11-17) : le cas mesure le 16/11, un groupe de 12 « À placer » au
//       duckpin et le groupe qui tenait les pistes annule. Le suivant reste refuse (le dossier « À placer »
//       garde sa place, ses personnes vont venir), mais la simulation et le refus sous le verrou disent
//       a l equipe qu un dossier « À placer » de 12 personnes (15:00) y garde sa place et comment la
//       liberer. Sans dossier « À placer », « complet » reste seul ; le formulaire en ligne aussi.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const CREATION = 'lib/reserver-creation.js';
const DB = 'lib/database.js';
const OPS = 'lib/reservation-ops.js';
const CONTRE = process.argv.includes('--contre-preuves');

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

// L activite comptee du centre (duckpin : 2 pistes de 6) et une activite libre, lues dans le catalogue.
function activites() {
  const { listCenterActivities } = require(path.join(ROOT, 'lib/activity-catalog.js'));
  const toutes = listCenterActivities('libramont');
  const comptee = toutes.find((a) => a.id === 'duckpin_bowling');
  const libre = toutes.find((a) => !a.planned && !(Number(a.units) > 0) && a.id !== 'duckpin_bowling' && a.bookable !== false);
  return { comptee, libre };
}

const visite = (nom, activityId, pax, heure, extra = {}) => B.corpsStaff({ type: 'visite', pax, startTime: heure, program: [{ activityId, duration: 1 }], name: nom, ...extra });
const dire = (r) => `${r.statut}${r.json.message || r.json.error ? ` ${r.json.message || r.json.error}` : ''}`;
const enBase = () => [...B.base.reservations.values()];
const noms = () => enBase().map((r) => r.name).sort().join(', ');

function monter(mutations) {
  return B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
}

async function scenarioCourse(mutations = []) {
  const f = {};
  B.semer([]);
  let m = monter(mutations);
  const { comptee } = activites();
  f.dotation = comptee ? `${comptee.units} x ${comptee.capacityPerUnit}` : 'absente';
  const tout = Number(comptee.units) * Number(comptee.capacityPerUnit);
  // Deux postes, en meme temps, chacun un groupe qui prend toute la dotation.
  const deux = await Promise.all([m.appeler('POST', URL_RESA, visite('Poste A', comptee.id, tout, '15:00')), m.appeler('POST', URL_RESA, visite('Poste B', comptee.id, tout, '15:00'))]);
  f.statuts = deux.map((r) => r.statut).sort().join(',');
  f.refus = deux.filter((r) => r.statut !== 201).map((r) => r.json.message || r.json.error || '').join(' | ');
  f.dossiers = enBase().length;
  // Le collegue valide son groupe entre le plan du poste et son verrou de journee.
  const ligneDuCollegue = { ...enBase()[0], id: 9001, name: 'Collegue' };
  B.semer([]);
  m = monter(mutations);
  B.base.avantVerrou = () => { B.base.reservations.set(ligneDuCollegue.id, ligneDuCollegue); };
  const tardif = await m.appeler('POST', URL_RESA, visite('Poste C', comptee.id, tout, '15:00'));
  f.tardif = dire(tardif);
  f.apresTardif = noms();
  return f;
}

async function scenarioSansForcer(mutations = []) {
  const f = {};
  B.semer([]);
  const m = monter(mutations);
  const { comptee } = activites();
  const tout = Number(comptee.units) * Number(comptee.capacityPerUnit);
  const premier = await m.appeler('POST', URL_RESA, visite('Premier', comptee.id, tout, '15:00'));
  f.premier = premier.statut;
  const simule = await m.appeler('POST', URL_RESA, { ...visite('Second', comptee.id, tout, '15:00'), dryRun: true });
  f.simule = ((simule.json.plan && simule.json.plan.conflits) || []).map((c) => `${c.type}:${c.message}`).join(' | ');
  const second = await m.appeler('POST', URL_RESA, visite('Second', comptee.id, tout, '15:00'));
  f.second = dire(second);
  f.apresSecond = noms();
  const force = await m.appeler('POST', URL_RESA, visite('Force', comptee.id, tout, '15:00', { forcer: true }));
  f.force = `${force.statut} ${force.json.aPlacer === true}`;
  const ligne = enBase().find((r) => r.name === 'Force');
  f.noteForce = ligne ? String(ligne.notes || '') : '';
  return f;
}

async function scenarioRealisable(mutations = []) {
  const f = {};
  B.semer([]);
  let m = monter(mutations);
  const { comptee, libre } = activites();
  const unePiste = Number(comptee.capacityPerUnit);
  // Deux groupes d une piste chacun, en meme temps : la dotation les porte tous les deux.
  const deux = await Promise.all([m.appeler('POST', URL_RESA, visite('Piste 1', comptee.id, unePiste, '15:00')), m.appeler('POST', URL_RESA, visite('Piste 2', comptee.id, unePiste, '15:00'))]);
  f.deuxPetits = deux.map((r) => r.statut).sort().join(',');
  // Une autre heure reste libre.
  const plusTard = await m.appeler('POST', URL_RESA, visite('Plus tard', comptee.id, unePiste * Number(comptee.units), '18:00'));
  f.plusTard = dire(plusTard);
  // Une activite sans dotation : deux grands groupes ensemble.
  B.semer([]);
  m = monter(mutations);
  f.libre = libre ? libre.id : 'aucune';
  if (libre) {
    const grands = await Promise.all([m.appeler('POST', URL_RESA, visite('Grand 1', libre.id, 20, '15:00')), m.appeler('POST', URL_RESA, visite('Grand 2', libre.id, 20, '15:00'))]);
    f.deuxGrands = grands.map(dire).sort().join(' | ');
  }
  return f;
}

async function scenarioAPlacer(mutations = []) {
  const f = {};
  B.semer([]);
  const m = monter(mutations);
  const { comptee } = activites();
  const tout = Number(comptee.units) * Number(comptee.capacityPerUnit);
  f.tenant = (await m.appeler('POST', URL_RESA, visite('Tenant', comptee.id, tout, '15:00'))).statut;
  const attente = await m.appeler('POST', URL_RESA, visite('Attente', comptee.id, tout, '15:00', { forcer: true }));
  f.attente = `${attente.statut} ${attente.json.aPlacer === true}`;
  // Le groupe qui tenait les pistes annule.
  const tenant = enBase().find((r) => r.name === 'Tenant');
  if (tenant) tenant.status = 'cancelled';
  const simule = await m.appeler('POST', URL_RESA, { ...visite('Suivant', comptee.id, tout, '15:00'), dryRun: true });
  f.simule = ((simule.json.plan && simule.json.plan.conflits) || []).map((c) => c.message).join(' | ');
  f.suivant = dire(await m.appeler('POST', URL_RESA, visite('Suivant', comptee.id, tout, '15:00')));
  f.apres = noms();
  // Le formulaire en ligne, sur la meme journee.
  const { prepareReservationOps } = require(path.join(ROOT, 'lib/reservation-ops.js'));
  const enLigne = await prepareReservationOps(visite('En ligne', comptee.id, tout, '15:00'), 'public');
  f.enLigne = String((enLigne && (enLigne.planWarning || enLigne.reason)) || '');
  return f;
}

function jugerCourse(f, dire2) {
  dire2(f.dotation === '2 x 6', 'MONTAGE le duckpin de Libramont : 2 pistes de 6', f.dotation);
  dire2(f.statuts === '201,400' && f.dossiers === 1, '[A] deux postes en meme temps sur toute la dotation : un seul passe, un seul dossier en base', `${f.statuts} / ${f.dossiers} dossier(s)`);
  dire2(/Duckpin Bowling est complet sur ce créneau\./.test(f.refus), '[A] le refus nomme l activite complete', f.refus);
  dire2(/^400 Duckpin Bowling est complet/.test(f.tardif) && f.apresTardif === 'Collegue', '[A] un collegue valide entre le plan et le verrou : refuse, seul son dossier est en base', `${f.tardif} / ${f.apresTardif}`);
}
function jugerSansForcer(f, dire2) {
  dire2(f.premier === 201 && /^plan:Duckpin Bowling est complet/.test(f.simule), 'MONTAGE la dotation est prise, la simulation le dit', `${f.premier} / ${f.simule}`);
  dire2(/^400 Duckpin Bowling est complet/.test(f.second) && f.apresSecond === 'Premier', '[B] sans « Créer quand même » : refuse, rien n est ecrit', `${f.second} / ${f.apresSecond}`);
  dire2(f.force === '201 true' && /À placer : créé malgré le conflit\. Duckpin Bowling est complet/.test(f.noteForce), '[B] avec « Créer quand même » : le dossier part « À placer », avec sa raison', `${f.force} / ${f.noteForce.slice(0, 120)}`);
  dire2(!/À placer/.test(f.simule) && !/À placer/.test(f.second), '[D] sans dossier « À placer » sur l heure, le refus reste « complet » seul', `${f.simule} / ${f.second}`);
}
const RAISON_A_PLACER = /Duckpin Bowling est complet sur ce créneau\. Un dossier « À placer » de 12 personnes \(15:00\) y garde sa place\. Pour la libérer, placez-le à une autre heure ou annulez-le\./;
function jugerAPlacer(f, dire2) {
  dire2(f.tenant === 201 && f.attente === '201 true', 'MONTAGE un groupe tient le duckpin, un second part « À placer » a la meme heure', `${f.tenant} / ${f.attente}`);
  dire2(RAISON_A_PLACER.test(f.simule), '[D] le groupe qui tenait les pistes annule : la simulation dit qu un dossier « À placer » garde la place', f.simule);
  dire2(/^400 /.test(f.suivant) && RAISON_A_PLACER.test(f.suivant) && f.apres === 'Attente, Tenant', '[D] sans « Créer quand même » : refuse sous le verrou avec la meme raison, rien n est ecrit', `${f.suivant} / ${f.apres}`);
  dire2(/Duckpin Bowling est complet sur ce créneau\./.test(f.enLigne) && !/À placer/.test(f.enLigne), '[D] le formulaire en ligne dit « complet » sans rien dire des dossiers des autres', f.enLigne);
}
function jugerRealisable(f, dire2) {
  dire2(f.deuxPetits === '201,201', '[C] deux groupes d une piste chacun, en meme temps : les deux passent', f.deuxPetits);
  dire2(/^201/.test(f.plusTard), '[C] une autre heure reste libre', f.plusTard);
  dire2(f.libre !== 'aucune' && f.deuxGrands === '201 | 201', '[C] une activite sans dotation n est pas bridee', `${f.libre} : ${f.deuxGrands}`);
}

const GARDE = '  const verifierProgramme = aPlacer ? null : (reservations, plan) => dotationDepassee(';
const CONTRE_PREUVES = [
  { nom: 'comptoir-sans-la-garde', lettres: ['[A]', '[B]'], fichier: CREATION, de: GARDE, vers: '  const verifierProgramme = true ? null : (reservations, plan) => dotationDepassee(', libelle: 'deux postes vendraient deux fois la dotation' },
  { nom: 'garde-pas-rejouee-sous-verrou', lettres: ['[A]'], fichier: DB, de: "    const complet = typeof verifierProgramme === 'function' ? verifierProgramme(liste, plan) : '';", vers: "    const complet = '';", libelle: 'la garde ne verrait pas ce que l autre poste vient d ecrire' },
  { nom: 'creer-quand-meme-refuse', lettres: ['[B]'], fichier: CREATION, de: GARDE, vers: '  const verifierProgramme = false ? null : (reservations, plan) => dotationDepassee(', libelle: 'l equipe ne pourrait plus creer un dossier a placer' },
  { nom: 'simulation-sans-raison', lettres: ['[D]'], fichier: OPS, de: "    const motifDotation = channel === 'staff' ? motifComplet(manque, requeteJugee, reservations) : `${manque} est complet sur ce créneau.`;", vers: '    const motifDotation = `${manque} est complet sur ce créneau.`;', libelle: 'l equipe lirait « complet » sans savoir quoi faire' },
  { nom: 'verrou-sans-raison', lettres: ['[D]'], fichier: DB, de: "typeof motifProgramme === 'function' ? motifProgramme(complet, liste, plan) : ", vers: '', libelle: 'le refus a l ecriture ne dirait plus pourquoi' },
  { nom: 'raison-dite-en-ligne', lettres: ['[D]'], fichier: OPS, de: "channel === 'staff' ? motifComplet(", vers: 'true ? motifComplet(', libelle: 'un visiteur apprendrait qu un autre groupe attend' },
  { nom: 'a-placer-ne-compte-plus', lettres: ['[D]'], fichier: OPS, de: "  const autres = (Array.isArray(reservations) ? reservations : [])\n    .filter((autre) => autre && String(autre.status || '').toLowerCase() !== 'cancelled');", vers: "  const autres = (Array.isArray(reservations) ? reservations : [])\n    .filter((autre) => autre && String(autre.status || '').toLowerCase() !== 'cancelled' && !estAPlacer(autre));", libelle: 'la place d un groupe a placer serait vendue une seconde fois' },
];

async function tout(mutations, dire2) {
  jugerCourse(await scenarioCourse(mutations), dire2);
  jugerSansForcer(await scenarioSansForcer(mutations), dire2);
  jugerRealisable(await scenarioRealisable(mutations), dire2);
  jugerAPlacer(await scenarioAPlacer(mutations), dire2);
}

(async () => {
  if (!CONTRE) {
    await tout([], ok);
    B.sortir('comptoir-dotation-check', echecs, 'le comptoir rejoue la garde des installations comptees sous le verrou de la journee');
    return;
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      await tout([{ fichier: c.fichier, de: c.de, vers: c.vers }], (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(' et ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  await tout([], (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  B.sortir('comptoir-dotation-check --contre-preuves', echecs, 'chaque garde retiree fait rougir sa lettre');
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
