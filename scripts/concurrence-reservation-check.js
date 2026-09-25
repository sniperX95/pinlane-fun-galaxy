// DEUX POSTES, UNE RESERVATION : CE QUE LE SERVEUR GARANTIT (2026-09-25).
//
// Movsar : « plusieurs ecrans, plusieurs PC, plusieurs personnes ». Le client
// envoie le dossier ENTIER d une reservation, pris dans la copie de SON ecran.
// Sans controle, le poste qui avait la fiche ouverte depuis une minute
// effacait en silence ce qu un collegue venait d y changer. Et un PATCH
// PARTIEL (le bouton « Valider » d une reservation en attente) perdait ses
// pistes : refus trompeur « Ce créneau vient de changer » sur un plan qui les
// portait, ou piste 5 reattribuee en piste 1 sans un mot (mesure au banc sur le
// vrai updateReservation avant correction).
//
// Zero reseau, zero base : le module 'pg' est remplace dans require.cache, AVANT
// tout require de lib/database.js, par une table en memoire qui journalise
// chaque requete. Le vrai updateReservation, le vrai handler
// api/staff-reservations et la vraie coche en delta y sont rejoues.
//
//   [A] UN PATCH SANS `lanes` GARDE LES PISTES, et passe sur un plan qui les
//       porte (bouton Valider).
//   [B] LA VERSION : egale, on ecrit ; differente, 409 avec la version
//       actuelle et rien n est ecrit ; illisible, 400 ; absente, comme avant.
//   [C] L ORDRE DES VERROUS : la date (advisory) AVANT la ligne (for update),
//       le meme ordre que applyReservationScheduleUpdates. L inverse peut
//       faire s attendre deux ecritures l une l autre.
//   [D] UNE ECRITURE ENTRE LA LECTURE ET LE VERROU : avec version, 409 ; un
//       PATCH partiel se recalcule sur la ligne fraiche (la note du collegue
//       survit).
//   [E] LE HANDLER : le 409 porte { code, reservation } ; le droit sur le
//       centre est controle AVANT la version ; le controle precoce evite une
//       replanification pour rien.
//   [F] LA COCHE EN DELTA : ajoute ou retire UNE cle, garde celles des autres ;
//       cle illisible refusee ; 100 cles au plus.
//
// CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
// Module.prototype._compile, le disque n est jamais touche).
//
// Usage : node scripts/concurrence-reservation-check.js
'use strict';
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ---------------------------------------------------------------------------
// Mutations en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE. Stricte sur les reservations (une requete inconnue sur
// cette table fait echouer le gate), indulgente ailleurs (journal, evenements,
// automatisations : lignes vides).
// ---------------------------------------------------------------------------
const base = {
  lignes: new Map(),
  journal: [],
  // Appele quand une requete « for update » arrive : simule un collegue qui
  // ecrit entre la premiere lecture et le verrou.
  avantVerrou: null,
  horloge: Date.parse('2026-09-25T09:00:00.000Z'),
};

function maintenant() {
  base.horloge += 1000;
  return new Date(base.horloge);
}

function ligne(r) {
  return {
    id: r.id,
    center_id: r.centerId || 'libramont',
    channel: 'staff',
    name: r.name || 'Groupe Essai',
    phone: '0470000000',
    email: 'essai@example.test',
    date: r.date || '2026-10-03',
    start_time: r.startTime || '18:00',
    duration: r.duration || 1,
    total_duration: r.duration || 1,
    lanes: r.lanes || [],
    pax: r.pax || 6,
    status: r.status || 'confirmed',
    base_price: 60,
    price: r.price || 60,
    type: r.type || 'bowling',
    formule_id: r.formuleId || null,
    label: 'Bowling',
    occasion: '',
    extras: [],
    payment_method: null,
    notes: r.notes || '',
    ops_plan: r.opsPlan === undefined ? null : r.opsPlan,
    risk_level: '',
    risk_score: null,
    validation_status: r.validationStatus || 'confirmed',
    activity_progress: r.activityProgress || {},
    program: null,
    created_at: new Date('2026-09-20T10:00:00.000Z'),
    updated_at: new Date(r.updatedAt || '2026-09-24T10:00:00.123Z'),
  };
}

function semer(liste) {
  base.lignes.clear();
  base.journal.length = 0;
  base.avantVerrou = null;
  liste.forEach((r) => base.lignes.set(r.id, ligne(r)));
}

function copie(r) { return r ? JSON.parse(JSON.stringify(r), (k, v) => (k === 'updated_at' || k === 'created_at' ? new Date(v) : v)) : r; }

async function requete(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  base.journal.push(s);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };
  if (/pg_advisory_xact_lock/.test(s)) return { rows: [{}], rowCount: 1 };
  if (/^select \* from reservations where id = \$1 for update/.test(s)) {
    if (typeof base.avantVerrou === 'function') { const f = base.avantVerrou; base.avantVerrou = null; f(); }
    const r = base.lignes.get(Number(params[0]));
    return { rows: r ? [copie(r)] : [], rowCount: r ? 1 : 0 };
  }
  if (/^select \* from reservations where id = \$1 limit 1/.test(s)) {
    const r = base.lignes.get(Number(params[0]));
    return { rows: r ? [copie(r)] : [], rowCount: r ? 1 : 0 };
  }
  if (/^select 1 from reservations where id = \$1 and center_id = \$2/.test(s)) {
    const r = base.lignes.get(Number(params[0]));
    return { rows: r && r.center_id === params[1] ? [{ '?column?': 1 }] : [], rowCount: r && r.center_id === params[1] ? 1 : 0 };
  }
  if (/from reservations where date = \$1 and center_id = \$2/.test(s)) {
    const rows = [...base.lignes.values()].filter((r) => r.date === params[0] && r.center_id === params[1]
      && r.status !== 'cancelled' && (!params[2] || r.id !== Number(params[2])));
    return { rows: rows.map(copie), rowCount: rows.length };
  }
  if (/from lane_statuses/.test(s)) return { rows: [], rowCount: 0 };
  if (/^update reservations set center_id = \$2/.test(s)) {
    const [id, centerId, channel, name, phone, email, date, startTime, duration, totalDuration, lanes, pax, status, basePrice, price, type, formuleId, label, occasion, extras, paymentMethod, notes, opsPlan, riskLevel, riskScore, validationStatus, activityProgress, program] = params;
    const avant = base.lignes.get(Number(id));
    if (!avant) return { rows: [], rowCount: 0 };
    const apres = {
      ...avant, center_id: centerId, channel, name, phone, email, date, start_time: startTime, duration, total_duration: totalDuration,
      lanes, pax, status, base_price: basePrice, price, type, formule_id: formuleId, label, occasion, extras: JSON.parse(extras),
      payment_method: paymentMethod, notes, ops_plan: opsPlan ? JSON.parse(opsPlan) : null, risk_level: riskLevel, risk_score: riskScore,
      validation_status: validationStatus, activity_progress: JSON.parse(activityProgress), program: program ? JSON.parse(program) : null,
      updated_at: maintenant(),
    };
    base.lignes.set(Number(id), apres);
    return { rows: [copie(apres)], rowCount: 1 };
  }
  if (/^update reservations set activity_progress = case when \$4::jsonb is null/.test(s)) {
    // La coche, INTERPRETEE depuis le texte SQL envoye (pas supposee) : le
    // retrait « - $3 » part de la valeur en base, la pose « base || objet » la
    // complete ; une pose sans « || » remplace le suivi entier. La borne de
    // 100 cles ne vaut que pour une cle nouvelle.
    const [id, centerId, cle, valeur] = params;
    const r = base.lignes.get(Number(id));
    if (!r || r.center_id !== centerId) return { rows: [], rowCount: 0 };
    const enBase = { ...(r.activity_progress || {}) };
    let suivi;
    if (valeur === null) {
      suivi = /coalesce\(activity_progress, '\{\}'::jsonb\) - \$3::text/.test(s) ? enBase : {};
      delete suivi[cle];
    } else {
      if (!Object.prototype.hasOwnProperty.call(enBase, cle) && Object.keys(enBase).length >= 100 && /< 100/.test(s)) return { rows: [], rowCount: 0 };
      suivi = /coalesce\(activity_progress, '\{\}'::jsonb\) \|\| jsonb_build_object\(\$3::text, \$4::jsonb\)/.test(s) ? enBase : {};
      suivi[cle] = JSON.parse(valeur);
    }
    const apres = { ...r, activity_progress: suivi, updated_at: maintenant() };
    base.lignes.set(Number(id), apres);
    return { rows: [copie(apres)], rowCount: 1 };
  }
  if (/^update reservations set activity_progress = \$3::jsonb/.test(s)) {
    // L ancien chemin : le suivi entier remplace celui en base.
    const [id, centerId, valeur] = params;
    const r = base.lignes.get(Number(id));
    if (!r || r.center_id !== centerId) return { rows: [], rowCount: 0 };
    const apres = { ...r, activity_progress: JSON.parse(valeur), updated_at: maintenant() };
    base.lignes.set(Number(id), apres);
    return { rows: [copie(apres)], rowCount: 1 };
  }
  if (/^(update reservations|delete from reservations|insert into reservations)\b/.test(s) || /^select .* from reservations\b/.test(s)) {
    throw new Error(`SQL reservations non simulee : ${s.slice(0, 140)}`);
  }
  return { rows: [], rowCount: 0 };
}

class FauxClient { query(sql, params) { return requete(sql, params); } release() {} }
class FauxPool { async connect() { return new FauxClient(); } query(sql, params) { return requete(sql, params); } on() {} end() {} }
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, Client: FauxClient } };

const CHEMIN_DB = path.join(ROOT, 'lib/database.js');
function chargerBase() {
  delete require.cache[require.resolve(CHEMIN_DB)];
  return require(CHEMIN_DB);
}

const PLAN_PISTE_3 = { resourceBlocks: [{ resourceType: 'bowling_lane', startTime: '18:00', endTime: '19:00', lanes: [3], durationMinutes: 60 }] };
const V0 = '2026-09-24T10:00:00.123Z';

// ---------------------------------------------------------------------------
// LE HANDLER, avec ses voisins remplaces : session, replanification, caches,
// automatisations et journal. On compte ce qu il appelle.
// ---------------------------------------------------------------------------
const appels = { permission: [], replan: 0, rechauffe: 0 };
let droits = { refuser: false };

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}

function chargerHandler() {
  const session = { centerId: 'libramont', authorizedCenterId: 'libramont', member: { id: 'm-1', name: 'Poste A' }, role: { id: 'direction', locked: true }, permissions: [] };
  remplacer('lib/staff-auth.js', {
    getStaffSessionFromRequest: async () => session,
    requireStaffPermission: async (req, res, permission) => {
      appels.permission.push(permission);
      if (droits.refuser) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, message: 'Acces refuse.' }));
        return null;
      }
      return session;
    },
  });
  remplacer('lib/reservation-ops.js', {
    prepareReservationOps: async () => { appels.replan += 1; return {}; },
  });
  remplacer('lib/ops-knowledge.js', { refreshCenterOverrides: async () => { appels.rechauffe += 1; } });
  remplacer('lib/booking-config.js', { refreshFormuleOverrides: async () => {} });
  remplacer('lib/catalog-store.js', { refreshCatalog: async () => {} });
  remplacer('lib/ops-communications.js', { enqueueReservationCommunications: async () => [] });
  remplacer('lib/ops-jobs.js', { enqueueReservationAutomation: async () => [] });
  remplacer('lib/audit-log.js', { writeAuditLog: async () => ({}) });
  // La base et le handler recompiles ensemble, avec les mutations du moment
  // (et sans celles d un tour precedent restees dans le cache).
  chargerBase();
  const chemin = require.resolve(path.join(ROOT, 'api/staff-reservations.js'));
  delete require.cache[chemin];
  return require(chemin);
}

async function appeler(handler, corps) {
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = 'PATCH';
  req.url = '/api/staff-reservations';
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  const res = {
    statusCode: 200, entetes: {}, corps: '',
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    end(b) { this.corps = String(b || ''); this.fini = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json };
}

async function scenarioA(db) {
  const resultats = {};
  semer([
    { id: 101, lanes: [3], opsPlan: PLAN_PISTE_3 },
    { id: 102, lanes: [5], opsPlan: null },
    { id: 103, lanes: [6, 7], pax: 12, opsPlan: null },
  ]);
  for (const id of [101, 102, 103]) {
    try {
      const r = await db.updateReservation({ id, centerId: 'libramont', validationStatus: 'confirmed', skipReplan: true });
      resultats[id] = { pistes: r.lanes.join(','), validation: r.validationStatus };
    } catch (error) {
      resultats[id] = { refus: error.message };
    }
  }
  return resultats;
}

async function scenarioB(db) {
  semer([{ id: 201, lanes: [4], status: 'confirmed', notes: '' }]);
  const r = {};
  // Version egale : on ecrit.
  const ecrit = await db.updateReservation({ id: 201, centerId: 'libramont', baseUpdatedAt: V0, notes: 'Poste A', lanes: [4] });
  r.egale = ecrit.notes;
  const v1 = new Date(ecrit.updatedAt).toISOString();
  // Version d avant : 409, rien n est ecrit.
  try {
    await db.updateReservation({ id: 201, centerId: 'libramont', baseUpdatedAt: V0, notes: 'Poste B (perime)', lanes: [4] });
    r.perimee = 'ecrit';
  } catch (error) {
    r.perimee = `${error.statusCode}:${error.code}:${error.reservation ? error.reservation.notes : '?'}`;
  }
  r.enBase = base.lignes.get(201).notes;
  // Illisible : 400. Absente : comme avant.
  try {
    await db.updateReservation({ id: 201, centerId: 'libramont', baseUpdatedAt: '2026-02-31T10:00:00.000Z', notes: 'x', lanes: [4] });
    r.illisible = 'ecrit';
  } catch (error) {
    r.illisible = String(error.statusCode);
  }
  const sansVersion = await db.updateReservation({ id: 201, centerId: 'libramont', notes: 'Sans version', lanes: [4] });
  r.absente = sansVersion.notes;
  r.v1 = v1;
  return r;
}

async function scenarioC(db) {
  semer([{ id: 301, lanes: [2] }]);
  await db.updateReservation({ id: 301, centerId: 'libramont', baseUpdatedAt: V0, notes: 'ordre', lanes: [2] });
  const iDate = base.journal.findIndex((s) => /pg_advisory_xact_lock/.test(s));
  const iLigne = base.journal.findIndex((s) => /for update/.test(s));
  return { iDate, iLigne };
}

async function scenarioD(db) {
  const r = {};
  // Avec version : un collegue ecrit entre la lecture et le verrou.
  semer([{ id: 401, lanes: [1], notes: '' }]);
  base.avantVerrou = () => {
    const l = base.lignes.get(401);
    base.lignes.set(401, { ...l, status: 'arrived', updated_at: maintenant() });
  };
  try {
    await db.updateReservation({ id: 401, centerId: 'libramont', baseUpdatedAt: V0, pax: 8, lanes: [1] });
    r.avecVersion = `ecrit (statut ${base.lignes.get(401).status})`;
  } catch (error) {
    r.avecVersion = `${error.statusCode}:${error.reservation && error.reservation.status}`;
  }
  // PATCH partiel : le collegue a ecrit une note, la validation ne l efface pas.
  semer([{ id: 402, lanes: [5], notes: '', validationStatus: 'staff_review' }]);
  base.avantVerrou = () => {
    const l = base.lignes.get(402);
    base.lignes.set(402, { ...l, notes: 'Note du collegue', updated_at: maintenant() });
  };
  const partiel = await db.updateReservation({ id: 402, centerId: 'libramont', validationStatus: 'confirmed', skipReplan: true });
  r.partielNote = partiel.notes;
  r.partielValidation = partiel.validationStatus;
  r.partielPistes = partiel.lanes.join(',');
  return r;
}

async function scenarioE() {
  const r = {};
  appels.permission = []; appels.replan = 0; appels.rechauffe = 0; droits.refuser = false;
  const handler = chargerHandler();
  semer([{ id: 501, lanes: [3], status: 'arrived', updatedAt: '2026-09-24T10:05:00.000Z' }]);
  const refus = await appeler(handler, { id: 501, centerId: 'libramont', baseUpdatedAt: V0, status: 'confirmed', pax: 9, lanes: [3], date: '2026-10-03', startTime: '18:00', duration: 1 });
  r.statut = refus.statut;
  r.code = refus.json && refus.json.code;
  r.versionActuelle = refus.json && refus.json.reservation && refus.json.reservation.status;
  r.replanPourRien = appels.replan;
  r.permissionAvant = appels.permission.length > 0;
  r.enBase = base.lignes.get(501).status;
  // Sans droit sur le centre : 403, et la reservation ne sort pas.
  droits.refuser = true;
  const interdit = await appeler(handler, { id: 501, centerId: 'libramont', baseUpdatedAt: V0, status: 'confirmed', lanes: [3] });
  droits.refuser = false;
  r.interditStatut = interdit.statut;
  r.interditFuite = Boolean(interdit.json && interdit.json.reservation);
  return r;
}

async function scenarioF() {
  const r = {};
  const handler = chargerHandler();
  semer([{ id: 601, type: 'formule', lanes: [], activityProgress: { 'bowling-1': { done: true, doneAt: '2026-09-25T09:00:00.000Z', by: 'Poste B' } } }]);
  appels.permission = [];
  const pose = await appeler(handler, { id: 601, centerId: 'libramont', activityToggle: { key: 'laser_game-1', done: true, doneAt: '2026-09-25T09:01:00.000Z', by: 'Poste A' } });
  r.pose = pose.statut;
  // Le comptoir coche avec le droit « statut », comme l ancien chemin.
  r.droit = JSON.stringify(appels.permission[0]);
  r.apresPose = Object.keys(base.lignes.get(601).activity_progress).sort().join(',');
  const retire = await appeler(handler, { id: 601, centerId: 'libramont', activityToggle: { key: 'bowling-1', done: false } });
  r.retire = retire.statut;
  r.apresRetrait = Object.keys(base.lignes.get(601).activity_progress).sort().join(',');
  const illisible = await appeler(handler, { id: 601, centerId: 'libramont', activityToggle: { key: 'x y<script>', done: true } });
  r.illisible = illisible.statut;
  // 100 cles : une nouvelle est refusee, une presente se recoche.
  const plein = {};
  for (let i = 1; i <= 100; i += 1) plein[`arcade_time-${i}`] = { done: true, doneAt: '', by: '' };
  semer([{ id: 602, type: 'formule', lanes: [], activityProgress: plein }]);
  const trop = await appeler(handler, { id: 602, centerId: 'libramont', activityToggle: { key: 'laser_game-1', done: true } });
  r.trop = trop.statut;
  const recoche = await appeler(handler, { id: 602, centerId: 'libramont', activityToggle: { key: 'arcade_time-7', done: true } });
  r.recoche = recoche.statut;
  // L ancien format (suivi entier) passe toujours : un onglet ouvert avant le deploiement.
  semer([{ id: 603, type: 'formule', lanes: [], activityProgress: {} }]);
  const ancien = await appeler(handler, { id: 603, centerId: 'libramont', activityProgress: { 'bowling-1': { done: true, doneAt: '', by: 'x' } } });
  r.ancien = `${ancien.statut}:${Object.keys((ancien.json && ancien.json.reservation && ancien.json.reservation.activityProgress) || {}).join(',')}`;
  return r;
}

(async () => {
  const db = chargerBase();

  console.log('[A] un PATCH sans pistes garde ses pistes (bouton Valider)');
  const a = await scenarioA(db);
  ok(a[101] && a[101].pistes === '3' && a[101].validation === 'confirmed',
    '[A] plan qui porte la piste 3 : validee, sur la piste 3 (plus de « Ce créneau vient de changer »)', JSON.stringify(a[101]));
  ok(a[102] && a[102].pistes === '5', '[A] sans plan, piste 5 : reste sur la piste 5 (plus de piste 1 en silence)', JSON.stringify(a[102]));
  ok(a[103] && a[103].pistes === '6,7', '[A] deux pistes 6 et 7 : restent 6 et 7', JSON.stringify(a[103]));

  console.log('\n[B] la version');
  const b = await scenarioB(db);
  ok(b.egale === 'Poste A', '[B] version egale : ecrit', b.egale);
  ok(b.perimee === '409:reservation_modifiee:Poste A', '[B] version d avant : 409, avec la version actuelle', b.perimee);
  ok(b.enBase === 'Poste A', '[B] et rien n est ecrit', b.enBase);
  ok(b.illisible === '400', '[B] version illisible (31 fevrier) : 400, jamais un controle saute', b.illisible);
  ok(b.absente === 'Sans version', '[B] sans version : comme avant (un onglet ouvert avant le deploiement)', b.absente);

  console.log('\n[C] l ordre des verrous');
  const c = await scenarioC(db);
  ok(c.iDate >= 0 && c.iLigne > c.iDate, '[C] la date d abord, la ligne ensuite (meme ordre que le plan de retard)', `date ${c.iDate}, ligne ${c.iLigne}`);

  console.log('\n[D] une ecriture entre la lecture et le verrou');
  const d = await scenarioD(db);
  ok(d.avecVersion === '409:arrived', '[D] avec version : 409, la version du collegue part avec le refus', d.avecVersion);
  ok(d.partielNote === 'Note du collegue' && d.partielValidation === 'confirmed' && d.partielPistes === '5',
    '[D] PATCH partiel : recalcule sur la ligne fraiche, la note du collegue survit', `${d.partielNote} / ${d.partielValidation} / ${d.partielPistes}`);

  console.log('\n[E] le handler');
  const e = await scenarioE();
  ok(e.statut === 409 && e.code === 'reservation_modifiee' && e.versionActuelle === 'arrived',
    '[E] 409 porte le code et la version actuelle', `${e.statut} ${e.code} ${e.versionActuelle}`);
  ok(e.replanPourRien === 0, '[E] le controle precoce evite la replanification', `${e.replanPourRien} replan`);
  ok(e.permissionAvant, '[E] le droit sur le centre est controle avant la version');
  ok(e.enBase === 'arrived', '[E] rien n est ecrit', e.enBase);
  ok(e.interditStatut === 403 && !e.interditFuite, '[E] sans droit : 403, et la reservation ne sort pas', `${e.interditStatut} fuite ${e.interditFuite}`);

  console.log('\n[F] la coche en delta');
  const f = await scenarioF();
  ok(f.pose === 200 && f.apresPose === 'bowling-1,laser_game-1', '[F] cocher le laser garde la coche bowling du collegue', `${f.pose} ${f.apresPose}`);
  ok(f.droit === '["reservations.status","reservations.edit"]', '[F] cocher demande le droit « statut » (le comptoir), pas « modifier »', f.droit);
  ok(f.retire === 200 && f.apresRetrait === 'laser_game-1', '[F] decocher le bowling ne retire que lui', `${f.retire} ${f.apresRetrait}`);
  ok(f.illisible === 400, '[F] une cle illisible est refusee', String(f.illisible));
  ok(f.trop === 400 && f.recoche === 200, '[F] 100 cles au plus ; une cle presente se recoche', `${f.trop} / ${f.recoche}`);
  ok(f.ancien === '200:bowling-1', '[F] l ancien format passe toujours', f.ancien);

  // =====================================================================
  console.log('\n[MUTATION] le gate sait-il rougir ?');
  // =====================================================================
  const contre = [
    {
      nom: 'un PATCH sans pistes repart de pistes vides',
      fichier: 'lib/database.js',
      de: '  const lanesDemandees = Array.isArray(input.lanes) ? input.lanes : defaults.lanes;',
      vers: '  const lanesDemandees = Array.isArray(input.lanes) ? input.lanes : [];',
      rejouer: async () => { const r = await scenarioA(chargerBase()); return `${r[102].pistes || r[102].refus}`; },
      attendu: (v) => v === '5',
      libelle: 'valider une reservation la changerait de piste',
    },
    {
      nom: 'le controle de version est retire',
      fichier: 'lib/database.js',
      de: '    if (versionAttendue !== null && !memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);',
      vers: '',
      rejouer: async () => { const r = await scenarioB(chargerBase()); return r.enBase; },
      attendu: (v) => v === 'Poste A',
      libelle: 'le poste perime effacerait la note du collegue',
    },
    {
      nom: 'la ligne est verrouillee avant la date',
      fichier: 'lib/database.js',
      de: '    await lockDate(client, payload.date, payload.centerId);\n    // LA LIGNE, VERROUILLEE APRES LA DATE',
      vers: '    await client.query(\'select * from reservations where id = $1 for update;\', [Number(input.id)]);\n    await lockDate(client, payload.date, payload.centerId);\n    // LA LIGNE, VERROUILLEE APRES LA DATE',
      rejouer: async () => { const r = await scenarioC(chargerBase()); return r.iLigne > r.iDate; },
      attendu: (v) => v === true,
      libelle: 'deux ecritures pourraient s attendre l une l autre',
    },
    {
      nom: 'le PATCH partiel ne relit pas la ligne sous verrou',
      fichier: 'lib/database.js',
      de: '      current = fraiche;\n      payload = normalizeReservationPayload(input, current);',
      vers: '',
      rejouer: async () => { const r = await scenarioD(chargerBase()); return r.partielNote; },
      attendu: (v) => v === 'Note du collegue',
      libelle: 'la validation effacerait la note ecrite par un collegue pendant ce temps',
    },
    {
      nom: 'le handler ne controle plus la version avant de replanifier',
      fichier: 'api/staff-reservations.js',
      de: '      if (versionAttendue !== null && !memeVersion(current.updatedAt, versionAttendue)) throw reservationModifieeEntreTemps(current);',
      vers: '',
      rejouer: async () => { const r = await scenarioE(); return r.replanPourRien; },
      attendu: (v) => v === 0,
      libelle: 'chaque conflit coute une replanification complete pour rien',
    },
    {
      nom: 'le 409 ne porte plus la version actuelle',
      fichier: 'api/staff-reservations.js',
      de: '      ? { code: error.code, reservation: error.reservation }',
      vers: '      ? {}',
      rejouer: async () => { const r = await scenarioE(); return r.versionActuelle; },
      attendu: (v) => v === 'arrived',
      libelle: 'le client ne pourrait pas rejouer son action sur la version du collegue',
    },
    {
      nom: 'la version est controlee avant le droit sur le centre',
      fichier: 'api/staff-reservations.js',
      de: "      const current = await getReservationById(body.id);\n      if (!current) throw createHttpError('Reservation introuvable.', 404);\n\n      const requestedCenterId",
      vers: "      const current = await getReservationById(body.id);\n      if (!current) throw createHttpError('Reservation introuvable.', 404);\n      if (lireVersionAttendue(body.baseUpdatedAt) !== null && !memeVersion(current.updatedAt, lireVersionAttendue(body.baseUpdatedAt))) throw reservationModifieeEntreTemps(current);\n\n      const requestedCenterId",
      rejouer: async () => { const r = await scenarioE(); return `${r.interditStatut}:${r.interditFuite}`; },
      attendu: (v) => v === '403:false',
      libelle: 'une personne sans droit sur ce centre recevrait la reservation dans le refus',
    },
    {
      nom: 'la coche ecrit le suivi entier',
      fichier: 'lib/database.js',
      de: "              else coalesce(activity_progress, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb)",
      vers: "              else jsonb_build_object($3::text, $4::jsonb)",
      rejouer: async () => { const r = await scenarioF(); return r.apresPose; },
      attendu: (v) => v === 'bowling-1,laser_game-1',
      libelle: 'cocher le laser effacerait la coche bowling du collegue',
    },
    {
      nom: 'la coche demande le droit « modifier »',
      fichier: 'api/staff-reservations.js',
      de: "  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes', 'activityProgress', 'activity_progress', 'activityToggle'].includes(key));",
      vers: "  return keys.length > 0 && keys.every((key) => ['status', 'paymentMethod', 'payment_method', 'notes', 'activityProgress', 'activity_progress'].includes(key));",
      rejouer: async () => { const r = await scenarioF(); return r.droit; },
      attendu: (v) => v === '["reservations.status","reservations.edit"]',
      libelle: 'le comptoir ne pourrait plus cocher une activite faite',
    },
  ];
  for (const c2 of contre) {
    mutations = [{ fichier: c2.fichier, de: c2.de, vers: c2.vers }];
    let verdict = false;
    let mesure = '';
    try {
      const r = await c2.rejouer();
      mesure = String(r);
      verdict = !c2.attendu(r);
    } catch (error) {
      verdict = false;
      mesure = `exception : ${error.message}`;
    }
    mutations = [];
    ok(verdict, `[mutation] « ${c2.nom} » : ${c2.libelle} (le gate ROUGIRAIT)`, mesure);
  }
  // Rien de mute ne survit : un dernier passage propre rend les memes verdicts.
  const propre = await scenarioB(chargerBase());
  ok(propre.enBase === 'Poste A', '[mutation] aucune mutation ne survit', propre.enBase);

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nTous les controles passent.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
