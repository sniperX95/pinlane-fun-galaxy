// « PAS VENU » REND SES PLACES, ET SE RETIRE TANT QU ELLES SONT LIBRES (2026-11-06).
//
// Le trou, lu le 06/11 en relisant le code des retards : le bouton « Pas venu »
// ecrivait absent_at sans rien liberer. Seule une annulation rendait la piste, les
// armes ou la table ; le comptoir et le formulaire en ligne ne pouvaient pas revendre
// la piste d un groupe qui ne viendrait pas. Ce gate monte le VRAI handler
// api/staff-reservations.js, la vraie lib/database.js et le vrai moteur sur la base en
// memoire du banc (scripts/reserver-banc.js : vraies transactions, vrais verrous de
// journee), zero reseau, zero base :
//   [A] LA PISTE SE REVEND : huit pistes prises a 15:00, aucune place au comptoir ; un
//       groupe note « Pas venu », sa piste se reserve. Les lectures des places
//       (readAvailabilitySnapshot, readStaffState) ne le comptent plus ; la console
//       (avecAbsents) le garde, barre ;
//   [B] RETIRER « PAS VENU » : refuse quand sa piste a ete reprise, le refus dit qui et
//       a quelle heure, rien n est ecrit ; pointe « Arrivé », meme refus ; retire sans
//       reprise, il passe. Un « Arrivé » ordinaire ne prend pas le verrou de la journee ;
//   [C] LE MOTEUR DES RETARDS et LA LIMITE DE TABLES ne comptent plus un groupe absent ;
//   [D] LA MEME REGLE des deux cotes : lib/places-tenues.js et tientSesPlaces de la
//       console rendent la meme chose sur la meme matrice ;
//   [E] UNE ANNULEE REMISE A CONFIRME (2026-11-07) : elle garde sa piste en base ; si
//       le comptoir l a reprise, le statut seul est refuse et dit qui, elle reste
//       annulee ; sans reprise, elle revient. Pareil au laser.
// --contre-preuves : chaque regle retiree (en memoire, le disque n est jamais touche)
// fait rougir sa lettre ; chaque ancre existe une fois et une seule.
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./reserver-banc.js');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const DB = 'lib/database.js';
const MOTEUR = 'lib/ops-engine.js';
const REGLE = 'lib/places-tenues.js';
const APP = 'assets/app-main.js';
const CONTRE = process.argv.includes('--contre-preuves');

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`);
  return cond;
}

// ---------------------------------------------------------------------------
// Les deux ecritures que le banc ne simule pas : l absence (0056) et le statut,
// avec le declencheur de 0056 (pointe arrive ou paye, l absence s efface).
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx && !this.tx.abandonnee ? this.tx : null;
  const lire = (id) => (tx && tx.reservations.get(Number(id))) || B.base.reservations.get(Number(id));
  const ecrire = (avant, champs) => {
    const precedent = avant.updated_at ? new Date(avant.updated_at).getTime() : 0;
    const row = { ...avant, ...champs, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
    if (tx) tx.reservations.set(row.id, row); else B.base.reservations.set(row.id, row);
    return { rows: [copieLigne(row)], rowCount: 1 };
  };
  if (s === 'update reservations set absent_at = case when $2 then now() else null end, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    return avant ? ecrire(avant, { absent_at: params[1] ? new Date() : null }) : { rows: [], rowCount: 0 };
  }
  if (s === 'update reservations set status = $2, payment_method = $3, updated_at = now() where id = $1 returning *;') {
    const avant = lire(params[0]);
    if (!avant) return { rows: [], rowCount: 0 };
    const efface = ['arrived', 'paid'].includes(params[1]) ? { absent_at: null } : {};
    return ecrire(avant, { status: params[1], payment_method: params[2], ...efface });
  }
  return queryDuBanc.call(this, sql, params);
};

const JOUR = B.JOUR;
const enBase = (id) => B.base.reservations.get(Number(id));
const version = (id) => new Date(enBase(id).updated_at).toISOString();
// Un groupe de bowling a 15:00 sur sa piste, avec les colonnes 0056.
const groupe = (id, piste, champs = {}) => B.ligne(id, { start_time: '15:00', lanes: [piste], status: 'pending', name: `Groupe piste ${piste}`, absent_at: null, amount_paid: null, discount_reason: null, ...champs });
const HUIT_PISTES = () => [1, 2, 3, 4, 5, 6, 7, 8].map((l) => groupe(900 + l, l));
const BOWLING = (extra = {}) => B.corpsStaff({ type: 'bowling', pax: 4, startTime: '15:00', duration: 1, totalDuration: 1, lanes: [], laneCount: 1, requiresLanes: true, channel: 'staff', name: 'Banc Revente', ...extra });

function monter(mutations) {
  const m = B.monter({ mutations, session: B.sessionDuRole('direction', { nom: 'Ansar' }) });
  m.geste = async (id, champs) => {
    const r = await m.appeler('PATCH', URL_RESA, { id, centerId: 'libramont', baseUpdatedAt: version(id), ...champs });
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || r.json.error || '', json: r.json };
  };
  m.db = () => require(path.join(ROOT, DB));
  m.moteur = () => require(path.join(ROOT, MOTEUR));
  return m;
}
const dire = (x) => `${x.statut} ${x.code} ${x.message}`.trim();

// ---------------------------------------------------------------------------
// LES SCENARIOS. Chacun rend des faits ; les verdicts sont poses par `juger`.
// ---------------------------------------------------------------------------
async function scenarioRevente(mutations = []) {
  B.semer(HUIT_PISTES());
  const m = monter(mutations);
  const f = {};
  const plein = await m.appeler('POST', URL_RESA, BOWLING({ name: 'Banc Trop Tot' }));
  f.pleinStatut = plein.statut;
  f.absence = await m.geste(906, { absent: true });
  const db = m.db();
  const dispo = await db.readAvailabilitySnapshot(JOUR, 'libramont');
  f.dispoAvecAbsent = dispo.reservations.some((r) => Number(r.id) === 906);
  const places = await db.readStaffState(JOUR, 'libramont', { avecBlocages: true });
  f.placesAvecAbsent = places.reservations.some((r) => Number(r.id) === 906);
  const vueConsole = await db.readStaffState(JOUR, 'libramont', { blocagesAPart: true, avecAbsents: true });
  const vu = vueConsole.reservations.find((r) => Number(r.id) === 906);
  f.consoleGardeAbsent = Boolean(vu && vu.absentAt);
  const revente = await m.appeler('POST', URL_RESA, BOWLING());
  f.reventeStatut = revente.statut;
  f.reventePistes = revente.json && revente.json.reservation ? (revente.json.reservation.lanes || []).map(Number) : [];
  f.reventeMessage = revente.json.message || revente.json.error || '';
  return f;
}

async function scenarioRetrait(mutations = []) {
  B.semer(HUIT_PISTES());
  const m = monter(mutations);
  const f = {};
  await m.geste(906, { absent: true });
  const revente = await m.appeler('POST', URL_RESA, BOWLING());
  f.reventeStatut = revente.statut;
  f.annuler = await m.geste(906, { absent: false });
  f.toujoursAbsent = enBase(906).absent_at instanceof Date;
  f.arrive = await m.geste(906, { status: 'arrived' });
  f.statutApres = enBase(906).status;
  // Sans reprise : la piste 5 reste libre, l absence se retire.
  await m.geste(905, { absent: true });
  f.annulerLibre = await m.geste(905, { absent: false });
  f.libreEfface = enBase(905).absent_at === null;
  // Un « Arrivé » ordinaire : passe, sans le verrou de la journee.
  const cle = `fungalaxy:libramont:${JOUR}`;
  const verrous = B.base.verrousPris.filter((x) => x === cle).length;
  f.arriveOrdinaire = await m.geste(904, { status: 'arrived' });
  f.verrousOrdinaire = B.base.verrousPris.filter((x) => x === cle).length - verrous;
  return f;
}

// Au laser : 30 armes. Un groupe de 20 note « Pas venu » rend ses armes ; un autre
// groupe de 20 les prend ; retirer l absence est refuse, le laser est complet.
const LASER = (extra = {}) => B.corpsStaff({ type: 'laser', pax: 20, startTime: '15:00', laserGames: 1, duration: 0.5, name: 'Banc Laser', ...extra });
async function scenarioLaser(mutations = []) {
  B.semer([]);
  const m = monter(mutations);
  const f = {};
  const premier = await m.appeler('POST', URL_RESA, LASER({ name: 'Banc Laser Absent' }));
  const id = premier.json && premier.json.reservation ? Number(premier.json.reservation.id) : null;
  f.premier = premier.statut;
  // (les colonnes 0056, que l insertion du banc ne pose pas)
  if (id) Object.assign(enBase(id), { absent_at: null, amount_paid: null, discount_reason: null });
  f.pleinAvant = (await m.appeler('POST', URL_RESA, LASER({ name: 'Banc Laser Trop Tot' }))).statut;
  f.absence = id ? await m.geste(id, { absent: true }) : { statut: 0, message: 'pas de premier groupe' };
  f.revente = (await m.appeler('POST', URL_RESA, LASER({ name: 'Banc Laser Revente' }))).statut;
  f.annuler = id ? await m.geste(id, { absent: false }) : { statut: 0, message: '' };
  f.toujoursAbsent = id ? enBase(id).absent_at instanceof Date : false;
  return f;
}

// [E] Une annulee garde ses pistes et son plan en base : la remettre a Confirme lui
// rend ses places, seulement si personne ne les a prises.
async function scenarioRemise(mutations = []) {
  B.semer(HUIT_PISTES());
  const m = monter(mutations);
  const f = {};
  f.annulation = await m.geste(906, { status: 'cancelled' });
  f.pistesGardees = JSON.stringify((enBase(906).lanes || []).map(Number));
  const revente = await m.appeler('POST', URL_RESA, BOWLING());
  f.reventeStatut = revente.statut;
  f.reventePistes = revente.json && revente.json.reservation ? (revente.json.reservation.lanes || []).map(Number) : [];
  f.remise = await m.geste(906, { status: 'pending' });
  f.statutApres = enBase(906).status;
  // Sans reprise : la piste 5 reste libre, l annulee revient.
  await m.geste(905, { status: 'cancelled' });
  f.remiseLibre = await m.geste(905, { status: 'pending' });
  f.libreRevenue = enBase(905).status;
  return f;
}
async function scenarioRemiseLaser(mutations = []) {
  B.semer([]);
  const m = monter(mutations);
  const f = {};
  const premier = await m.appeler('POST', URL_RESA, LASER({ name: 'Banc Laser Annule' }));
  const id = premier.json && premier.json.reservation ? Number(premier.json.reservation.id) : null;
  if (id) Object.assign(enBase(id), { absent_at: null, amount_paid: null, discount_reason: null });
  f.annulation = id ? await m.geste(id, { status: 'cancelled' }) : { statut: 0, message: 'pas de premier groupe' };
  f.revente = (await m.appeler('POST', URL_RESA, LASER({ name: 'Banc Laser Revente' }))).statut;
  f.remise = id ? await m.geste(id, { status: 'pending' }) : { statut: 0, message: '' };
  f.statutApres = id ? enBase(id).status : '';
  return f;
}

async function scenarioMoteur(mutations = []) {
  B.semer([]);
  const m = monter(mutations);
  const f = {};
  const a = await m.appeler('POST', URL_RESA, BOWLING({ name: 'Banc Retard', startTime: '17:00', lanes: [2], pistesALaMain: 1 }));
  const b = await m.appeler('POST', URL_RESA, BOWLING({ name: 'Banc Suivant', startTime: '18:00', lanes: [2], pistesALaMain: 1 }));
  f.poses = [a.statut, b.statut, a.json.reservation && a.json.reservation.lanes, b.json.reservation && b.json.reservation.lanes];
  const etat = await m.db().readStaffState(JOUR, 'libramont', { avecAbsents: true });
  const retard = etat.reservations.find((r) => r.name === 'Banc Retard');
  const suivant = etat.reservations.find((r) => r.name === 'Banc Suivant');
  const { computeDelayImpact } = m.moteur();
  const impact = (absent) => computeDelayImpact({ centerId: 'libramont', date: JOUR, reservationId: retard.id, delayMinutes: 20 }, {
    reservations: [retard, absent ? { ...suivant, absentAt: new Date().toISOString() } : suivant], laneStatuses: {},
  });
  f.retardSuivantPresent = impact(false).status;
  f.retardSuivantAbsent = impact(true).status;
  // La limite de tables (une table au plus) : un groupe absent n en tient plus.
  const { getCenter } = require(path.join(ROOT, 'lib/ops-knowledge.js'));
  const centre = JSON.parse(JSON.stringify(getCenter('libramont')));
  centre.resources.partyTables = { ...(centre.resources.partyTables || {}), limitEnabled: true, hardCapacity: 1 };
  const table = (id, absentAt = null) => ({ id, date: JOUR, centerId: 'libramont', status: 'pending', absentAt, startTime: '15:00', type: 'formule', opsPlan: { resourceBlocks: [{ resourceType: 'party_table', start: 900, end: 1020, startTime: '15:00', endTime: '17:00' }] } });
  const { depassementDeTablesDuDossier } = m.moteur();
  f.tablesPresent = Boolean(depassementDeTablesDuDossier(table(2), [table(1)], centre));
  f.tablesAbsent = Boolean(depassementDeTablesDuDossier(table(2), [table(1, new Date().toISOString())], centre));
  return f;
}

// La console et le serveur, sur la meme matrice.
function scenarioRegle() {
  const lireRegle = (rel) => require(path.join(ROOT, rel));
  delete require.cache[path.join(ROOT, REGLE)];
  const serveur = lireRegle(REGLE).tientSesPlaces;
  const texte = fs.readFileSync(path.join(ROOT, APP), 'utf8').replace(/\r\n/g, '\n');
  const debut = texte.indexOf('function tientSesPlaces(r) {');
  const fin = texte.indexOf('\n}\n', debut);
  // eslint-disable-next-line no-new-func
  const regleConsole = debut >= 0 && fin > debut ? new Function(`${texte.slice(debut, fin + 3)}\nreturn tientSesPlaces;`)() : null;
  const matrice = [];
  for (const status of ['pending', 'confirmed', 'arrived', 'paid', 'cancelled', undefined]) {
    for (const absentAt of [null, '2027-01-16T14:20:00.000Z']) matrice.push({ status, absentAt });
  }
  matrice.push(null);
  const attendu = (r) => Boolean(r) && r.status !== 'cancelled' && !(r.absentAt && r.status !== 'arrived' && r.status !== 'paid');
  return {
    console: Boolean(regleConsole),
    ecartsServeur: matrice.filter((r) => serveur(r) !== attendu(r)).length,
    ecartsConsole: regleConsole ? matrice.filter((r) => regleConsole(r) !== serveur(r)).length : -1,
  };
}

// ---------------------------------------------------------------------------
// LES VERDICTS
// ---------------------------------------------------------------------------
function jugerRevente(f, v) {
  v(f.pleinStatut !== 201, '[A] huit pistes prises a 15:00 : le comptoir n a aucune place', f.pleinStatut);
  v(f.absence.statut === 200, '[A] « Pas venu » se note sur la piste 6', dire(f.absence));
  v(!f.dispoAvecAbsent, '[A] le formulaire en ligne (readAvailabilitySnapshot) ne compte plus le groupe absent');
  v(!f.placesAvecAbsent, '[A] le moteur du comptoir (readStaffState) ne le compte plus');
  v(f.consoleGardeAbsent, '[A] la console (avecAbsents) le garde, avec son absence');
  v(f.reventeStatut === 201 && f.reventePistes.length === 1 && f.reventePistes[0] === 6, '[A] la piste 6 se reserve au comptoir', `${f.reventeStatut} ${JSON.stringify(f.reventePistes)} ${f.reventeMessage}`);
}
function jugerRetrait(f, v) {
  v(f.reventeStatut === 201, '[B] la piste 6 du groupe absent est reprise', f.reventeStatut);
  v(f.annuler.statut === 409 && /piste 6/.test(f.annuler.message) && /Banc Revente/.test(f.annuler.message) && /15:00/.test(f.annuler.message) && /Modifier/.test(f.annuler.message),
    '[B] retirer « Pas venu » : refuse, le refus dit la piste, qui l a prise, a quelle heure, et Modifier', dire(f.annuler));
  v(f.toujoursAbsent, '[B] refuse : l absence reste en base');
  v(f.arrive.statut === 409 && /piste 6/.test(f.arrive.message) && f.statutApres === 'pending', '[B] le pointer « Arrivé » : meme refus, le statut ne bouge pas', `${dire(f.arrive)} ${f.statutApres}`);
  v(f.annulerLibre.statut === 200 && f.libreEfface, '[B] sans reprise (piste 5), l absence se retire', dire(f.annulerLibre));
  v(f.arriveOrdinaire.statut === 200 && f.verrousOrdinaire === 0, '[B] un « Arrivé » ordinaire passe sans prendre le verrou de la journee', `${dire(f.arriveOrdinaire)} verrous ${f.verrousOrdinaire}`);
}
function jugerLaser(f, v) {
  v(f.premier === 201 && f.pleinAvant !== 201, '[B] laser : 20 armes prises a 15:00, un second groupe de 20 n a pas la place', `${f.premier} ${f.pleinAvant}`);
  v(f.absence.statut === 200 && f.revente === 201, '[B] laser : le premier note « Pas venu », le second groupe de 20 prend ses armes', `${dire(f.absence)} ${f.revente}`);
  v(f.annuler.statut === 409 && /laser est complet/.test(f.annuler.message) && /Modifier/.test(f.annuler.message) && f.toujoursAbsent,
    '[B] laser : retirer « Pas venu » est refuse, le laser est complet, l absence reste', dire(f.annuler));
}
function jugerRemise(f, v) {
  v(f.annulation.statut === 200 && f.pistesGardees === '[6]', '[E] annulee, la reservation de la piste 6 garde sa piste en base', `${dire(f.annulation)} ${f.pistesGardees}`);
  v(f.reventeStatut === 201 && f.reventePistes.length === 1 && f.reventePistes[0] === 6, '[E] la piste 6 de l annulee est reprise au comptoir', `${f.reventeStatut} ${JSON.stringify(f.reventePistes)}`);
  v(f.remise.statut === 409 && /piste 6/.test(f.remise.message) && /Banc Revente/.test(f.remise.message) && /15:00/.test(f.remise.message),
    '[E] la remettre a Confirme : refuse, le refus dit la piste, qui l a prise et a quelle heure', dire(f.remise));
  v(f.statutApres === 'cancelled', '[E] refuse : elle reste annulee en base', f.statutApres);
  v(f.remiseLibre.statut === 200 && f.libreRevenue === 'pending', '[E] sans reprise (piste 5), l annulee revient a Confirme', `${dire(f.remiseLibre)} ${f.libreRevenue}`);
}
function jugerRemiseLaser(f, v) {
  v(f.annulation.statut === 200 && f.revente === 201, '[E] laser : un groupe de 20 annule, un autre groupe de 20 prend ses armes', `${dire(f.annulation)} ${f.revente}`);
  v(f.remise.statut === 409 && /laser est complet/.test(f.remise.message) && f.statutApres === 'cancelled',
    '[E] laser : la remettre a Confirme est refuse, le laser est complet, elle reste annulee', `${dire(f.remise)} ${f.statutApres}`);
}
function jugerMoteur(f, v) {
  v(f.poses[0] === 201 && f.poses[1] === 201, '[C] deux groupes poses sur la piste 2, a 17:00 et a 18:00', f.poses);
  v(f.retardSuivantPresent === 'conflicts', '[C] 20 min de retard a 17:00 : le groupe de 18:00 est touche', f.retardSuivantPresent);
  v(f.retardSuivantAbsent === 'no_conflict', '[C] le groupe de 18:00 absent : le retard ne touche personne', f.retardSuivantAbsent);
  v(f.tablesPresent && !f.tablesAbsent, '[C] la limite de tables ne compte plus la table d un groupe absent', `present ${f.tablesPresent} absent ${f.tablesAbsent}`);
}
function jugerRegle(f, v) {
  v(f.console, '[D] la regle de la console se lit dans assets/app-main.js');
  v(f.ecartsServeur === 0, '[D] la regle du serveur : absent et non pointe, ou annule, ne tient pas ses places', f.ecartsServeur);
  v(f.ecartsConsole === 0, '[D] la console et le serveur rendent la meme chose sur la meme matrice', f.ecartsConsole);
}

async function verdicts(mutations = []) {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  jugerRevente(await scenarioRevente(mutations), v);
  jugerRetrait(await scenarioRetrait(mutations), v);
  jugerLaser(await scenarioLaser(mutations), v);
  jugerRemise(await scenarioRemise(mutations), v);
  jugerRemiseLaser(await scenarioRemiseLaser(mutations), v);
  jugerMoteur(await scenarioMoteur(mutations), v);
  jugerRegle(scenarioRegle(), v);
  return liste;
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : une regle retiree, sa lettre rougit.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'reservation-compte-l-absent', lettre: 'A', fichier: DB, de: '  const reservations = result.rows.map(mapReservation).filter(tientSesPlaces);', vers: '  const reservations = result.rows.map(mapReservation);' },
  { nom: 'formulaire-compte-l-absent', lettre: 'A', fichier: DB, de: '      reservations: reservationResult.rows.map(mapReservation).filter(tientSesPlaces).concat(blocages),', vers: '      reservations: reservationResult.rows.map(mapReservation).concat(blocages),' },
  { nom: 'moteur-compte-l-absent', lettre: 'A', fichier: DB, de: '    const lus = options.avecAbsents ? dossiers : dossiers.filter(tientSesPlaces);', vers: '    const lus = dossiers;' },
  { nom: 'console-perd-l-absent', lettre: 'A', fichier: DB, de: '    const lus = options.avecAbsents ? dossiers : dossiers.filter(tientSesPlaces);', vers: '    const lus = dossiers.filter(tientSesPlaces);' },
  { nom: 'regle-qui-garde-tout', lettre: 'A', fichier: REGLE, de: '  return !(reservation.absentAt && reservation.status !== \'arrived\' && reservation.status !== \'paid\');', vers: '  return true;' },
  { nom: 'annuler-sans-garde', lettre: 'B', fichier: DB, de: '    if (avecAbsence && !input.absent) await refuserSiPlacesReprises(client, current, verrou);\n', vers: '' },
  { nom: 'arrive-sans-garde', lettre: 'B', fichier: DB, de: '    if (rendSesPlaces(current, prochain)) await refuserSiPlacesReprises(client, current, verrou);\n', vers: '' },
  { nom: 'laser-sans-garde', lettre: 'B', fichier: DB, de: '    ensureLaserCapacity(current, autres);\n  } catch (error) {\n    throw refus(', vers: '    void autres;\n  } catch (error) {\n    throw refus(' },
  { nom: 'refus-muet', lettre: 'B', fichier: DB, de: '    throw refus(`${communes.length > 1 ? \'pistes\' : \'piste\'} ${communes.join(\' et \')} par ${nom} à ${String(qui.startTime || \'\').slice(0, 5)}`);', vers: '    throw refus(\'une autre réservation\');' },
  { nom: 'arrive-ordinaire-verrouille', lettre: 'B', fichier: DB, de: '  if (!rendSesPlaces(dossier, changement)) return false;\n', vers: '' },
  // (le statut seul d une annulee, sans la garde : l ancien chemin de la remise)
  { nom: 'annulee-remise-sans-garde', lettre: 'E', fichier: DB, de: '    if (rendSesPlaces(current, prochain)) await refuserSiPlacesReprises(client, current, verrou);', vers: "    if (rendSesPlaces(current, prochain) && current.status !== 'cancelled') await refuserSiPlacesReprises(client, current, verrou);" },
  { nom: 'regle-de-remise-muette', lettre: 'E', fichier: REGLE, de: '  return !tientSesPlaces(reservation) && tientSesPlaces({ ...reservation, ...changement });', vers: '  return false;' },
  { nom: 'retard-compte-l-absent', lettre: 'C', fichier: MOTEUR, de: '  const allReservations = (Array.isArray(context.reservations) ? context.reservations : [])\n    .filter(tientSesPlaces);', vers: '  const allReservations = (Array.isArray(context.reservations) ? context.reservations : [])\n    .filter((reservation) => reservation && reservation.status !== \'cancelled\');' },
  { nom: 'tables-comptent-l-absent', lettre: 'C', fichier: MOTEUR, de: '    .filter((autre) => tientSesPlaces(autre) && Number(autre.id) !== Number(reservation.id))', vers: '    .filter((autre) => autre && Number(autre.id) !== Number(reservation.id))' },
  { nom: 'console-autre-regle', lettre: 'D', fichier: APP, de: '  return Boolean(r) && r.status !== \'cancelled\' && !(r.absentAt && r.status !== \'arrived\' && r.status !== \'paid\');', vers: '  return Boolean(r) && r.status !== \'cancelled\';' },
];

// La console se lit au texte (scenarioRegle) : sa mutation se joue la, pas au chargeur.
async function verdictsSous(m) {
  if (m.fichier !== APP) return verdicts([{ fichier: m.fichier, de: m.de, vers: m.vers }]);
  const chemin = path.join(ROOT, APP);
  const lire = fs.readFileSync;
  fs.readFileSync = function (fichier, ...reste) {
    const texte = lire.call(fs, fichier, ...reste);
    return path.resolve(String(fichier)) === chemin ? String(texte).replace(/\r\n/g, '\n').split(m.de).join(m.vers) : texte;
  };
  try { return await verdicts([]); } finally { fs.readFileSync = lire; }
}

async function main() {
  const t0 = Date.now();
  if (!CONTRE) {
    for (const x of await verdicts()) ok(x.ok, x.label, x.detail);
  } else {
    const depart = new Set((await verdicts()).filter((x) => !x.ok).map((x) => x.label));
    ok(depart.size === 0, '[CP] sans mutation, tout est vert', [...depart].join(' ; '));
    console.log('[CP] contre-preuves : chaque regle retiree fait rougir sa lettre');
    for (const m of MUTATIONS) {
      const n = fs.readFileSync(path.join(ROOT, m.fichier), 'utf8').replace(/\r\n/g, '\n').split(m.de).length - 1;
      if (!ok(n === 1, `[CP] mutation ${m.nom} : son ancre existe une fois et une seule`, n)) continue;
      let rouges = [];
      try {
        rouges = (await verdictsSous(m)).filter((x) => !x.ok && !depart.has(x.label)).map((x) => x.label);
      } catch (e) {
        rouges = [`[${m.lettre}] crash ${e.message}`];
      }
      ok(rouges.some((l) => l.startsWith(`[${m.lettre}]`)), `[CP] mutation ${m.nom} : [${m.lettre}] rougit`, rouges.slice(0, 3).join(' ; ') || 'rien n a rougi');
    }
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nretards-places-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nretards-places-check: ALL OK${CONTRE ? ' (contre-preuves)' : ''}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
