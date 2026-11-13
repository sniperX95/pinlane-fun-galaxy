'use strict';
// LE FONDATEUR NE SIGNE RIEN SUR UN DOSSIER (2026-11-13, lib/fondateur-invisible.js). Le volet
// « reservations » du gate test:fondateur-invisible : scripts/fondateur-invisible-check.js le lance.
//
// Ansar : « j ouvre quelque chose ou quoi, ca doit pas afficher que c est ouvert ou lu ou fait par
// fondateur Pinlane, moi personne doit me voir, mais les autres roles du centre oui ».
//
// Le vrai api/staff-reservations.js, le vrai api/staff-state.js, la vraie lib/database.js et le vrai
// moteur, sur la journee « pic » de Fun Galaxy (scripts/planning-v3-fixtures.js) et la base en memoire
// du banc de la fenetre Reserver (scripts/reserver-banc.js). Le dossier 1633 porte deja des traces du
// fondateur (notes, coche, ligne de sur mesure, derniere modification), sous son nom actuel « Ansar
// Pinlane » et sous son nom de naissance, a cote de celles de Luc (Manager).
//   [C] la creation (fenetre Reserver) : la note « À placer », le plan et la note d equipe du corps
//   [N] les notes d equipe : signees par personne pour le fondateur (et sa session de secours), par
//       Marie pour Marie ; la reponse a Marie ne porte aucune vieille trace de lui
//   [P] Modifier : la derniere modification reste celle d avant, le prix ajuste et le compte a
//       l arrivee ne le nomment pas, la copie de secours non plus
//   [S] le suivi des activites : la coche du fondateur ne le nomme pas, celle de Marie oui
//   [E] les departs epingles : il ne s y inscrit pas
//   [L] la lecture : le staff-state rend ses vieilles traces sans nom a Marie (Direction) et a Zoe
//       (Bar), entieres au fondateur
//   [T] le chemin du retour : le dossier masque, renvoye par Marie ou par Zoe, ne resigne ni n efface rien
//   Partout, le journal d audit garde l acte du fondateur, a son identifiant de membre.
//
// La marque que requireStaffPermission pose sur la reponse (res.__nomsDuFondateur) est posee ici par le
// banc, avec la meme regle (estFondateur, nomsDuFondateur) : scripts/fondateur-invisible-check.js prouve
// la vraie, sur le vrai lib/staff-auth.js.
//
// Contre-preuves (sauf --sans-contre-preuves) : chaque garde retiree en memoire (le disque n est jamais
// ecrit) doit faire rougir sa lettre.
// Zero reseau, zero base, rien ne part.
// Lancement : node scripts/fondateur-invisible-dossiers-check.js [--sans-contre-preuves]
const path = require('path');
const { Readable } = require('stream');
const B = require('./reserver-banc.js');
const FX = require('./planning-v3-fixtures');

const ROOT = B.ROOT;
const URL_RESA = '/api/staff-reservations';
const FIXTURE = FX.lireFixture('pic');
const JOUR = FIXTURE.staffState.date;
const SOLO = 1633; // bowling 14:00, piste 7, 5 joueurs, 39 EUR
const NOEL = 1637; // bowling 16:30, piste 6, 4 joueurs
const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const MEMBRE = 'libramont:platform-owner';
const sansLui = (texte) => !String(texte).includes(NOM_ACTUEL) && !String(texte).includes(NOM_DE_NAISSANCE) && !String(texte).includes(':platform-owner');

let echecs = 0;
function ok(condition, message, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${!condition && detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
  if (!condition) echecs += 1;
  return Boolean(condition);
}

// L heure de la journee de la fixture (scripts/derniere-modif-check.js) : le serveur juge « passe » et
// « aujourd hui » sur Date.
const VraieDate = Date;
async function auJour(travail, heure = '15:10') {
  const ecart = new VraieDate(FX.instant(JOUR, heure)).getTime() - VraieDate.now();
  class Fausse extends VraieDate {
    constructor(...a) { if (a.length === 0) super(VraieDate.now() + ecart); else super(...a); }
    static now() { return VraieDate.now() + ecart; }
  }
  global.Date = Fausse;
  try { return await travail(); } finally { global.Date = VraieDate; }
}

// ---------------------------------------------------------------------------
// Ce que le banc ne connait pas : le nom actuel du fondateur, la note d equipe et la coche, ecrites sous
// leur propre SQL (lib/database.js : noterReservationEquipe, setReservationActivityDone,
// setReservationActivityProgress).
// ---------------------------------------------------------------------------
const DATES = ['created_at', 'updated_at', 'expires_at', 'released_at', 'paid_at', 'absent_at'];
const copieLigne = (row) => JSON.parse(JSON.stringify(row), (k, v) => (DATES.includes(k) && v ? new Date(v) : v));
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
const enTx = (client) => (client && client.tx && !client.tx.abandonnee ? client.tx : null);
function ecrite(client, row) {
  const precedent = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const neuve = { ...row, updated_at: new Date(Math.max(Date.now(), precedent + 1)) };
  const tx = enTx(client);
  if (tx) tx.reservations.set(neuve.id, neuve); else B.base.reservations.set(neuve.id, neuve);
  return { rows: [copieLigne(neuve)], rowCount: 1 };
}
const RIEN = () => ({ rows: [], rowCount: 0 });
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (this && this.tx && this.tx.abandonnee) return queryDuBanc.call(this, sql, params);
  if (s === 'select distinct name from staff_members where id like $1;') {
    return params[0] === '%:platform-owner%' ? { rows: [{ name: NOM_ACTUEL }], rowCount: 1 } : RIEN();
  }
  const ligne = () => {
    const tx = enTx(this);
    const row = (tx && tx.reservations.get(Number(params[0]))) || B.base.reservations.get(Number(params[0]));
    return row && row.center_id === params[1] ? row : null;
  };
  if (s === 'select * from reservations where id = $1 and center_id = $2 for update;' || s === 'select 1 from reservations where id = $1 and center_id = $2;') {
    const row = ligne();
    return row ? { rows: [copieLigne(row)], rowCount: 1 } : RIEN();
  }
  if (s === 'update reservations set notes = $3, updated_at = now() where id = $1 and center_id = $2 returning *;') {
    const row = ligne();
    return row ? ecrite(this, { ...row, notes: params[2] }) : RIEN();
  }
  if (s === 'update reservations set activity_progress = $3::jsonb, updated_at = now() where id = $1 and center_id = $2 returning *;') {
    const row = ligne();
    return row ? ecrite(this, { ...row, activity_progress: JSON.parse(params[2]) }) : RIEN();
  }
  if (s.startsWith('update reservations set activity_progress = case when $4::jsonb is null')) {
    const row = ligne();
    if (!row) return RIEN();
    const suivi = typeof row.activity_progress === 'string' ? JSON.parse(row.activity_progress || '{}') : { ...(row.activity_progress || {}) };
    if (params[3] === null) delete suivi[params[2]];
    else suivi[params[2]] = JSON.parse(params[3]);
    return ecrite(this, { ...row, activity_progress: suivi });
  }
  return queryDuBanc.call(this, sql, params);
};

// ---------------------------------------------------------------------------
// LA BASE : la journee de la fixture, en colonnes ; le dossier 1633 avec ses traces.
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
  };
}
const LE = (heure) => `${JOUR}T${heure}:00.000Z`;
const noteEquipe = (t, par, le, extra = {}) => `[equipe] ${JSON.stringify({ t, par, le, ...extra })}`;
const NOTES = [
  'Anniversaire de Léa, 10 ans.',
  noteEquipe('Gâteau au frigo du bar', 'Luc Martin', LE('09:00')),
  noteEquipe('Vérifier le prix avec la direction', NOM_ACTUEL, LE('09:10')),
  noteEquipe('Ancienne note du fondateur', NOM_DE_NAISSANCE, LE('09:20')),
  noteEquipe('Piste 7 gardée pour eux', 'Luc Martin', LE('09:30'), { modifieLe: LE('09:40'), modifiePar: NOM_ACTUEL }),
].join('\n');
const SUIVI = {
  bowling: { done: true, doneAt: LE('10:00'), by: NOM_ACTUEL },
  minigolf: { done: true, doneAt: LE('10:05'), by: 'Luc Martin' },
};
const EXTRAS = [
  { id: 'x-boissons', name: 'Boissons × 5', price: 15, par: NOM_ACTUEL, le: LE('10:10') },
  { id: 'x-gateau', name: 'Gâteau', price: 10, par: 'Luc Martin', le: LE('10:15') },
];
const DERNIERE = { le: LE('10:20'), par: NOM_ACTUEL, quoi: ['Heure 13:30 → 14:00'] };
const copie = (v) => JSON.parse(JSON.stringify(v));

function lignesDuJour() {
  return FIXTURE.staffState.reservations.map((r) => {
    const ligne = ligneDepuis(copie(r));
    if (r.id === SOLO) return { ...ligne, notes: NOTES, activity_progress: copie(SUIVI), extras: copie(EXTRAS), base_price: 39, price: 64, ops_plan: { ...ligne.ops_plan, derniereModif: copie(DERNIERE) } };
    if (r.id === NOEL) return { ...ligne, status: 'arrived' };
    return ligne;
  });
}
const enBase = (id) => B.base.reservations.get(Number(id));
const planEnBase = (id) => { const plan = enBase(id) && enBase(id).ops_plan; return typeof plan === 'string' ? JSON.parse(plan) : plan; };
const suiviEnBase = (id) => { const s = enBase(id) && enBase(id).activity_progress; return typeof s === 'string' ? JSON.parse(s) : (s || {}); };
const notesLues = (texte) => { const { lireNoteEquipe } = require(path.join(ROOT, 'lib/database.js')); return String(texte || '').split('\n').map(lireNoteEquipe).filter(Boolean); };
const noteDe = (texte, t) => notesLues(texte).find((n) => n.t === t) || null;
// Le corps que la console envoie pour un dossier (le dossier entier).
function corpsDe(r, champs = {}) {
  const lanes = (r.lanes || []).length;
  return { ...r, centerId: 'libramont', requiresLanes: lanes > 0, laneCount: lanes, allowPastStart: true, baseUpdatedAt: r.updatedAt, ...champs };
}

// ---------------------------------------------------------------------------
// LES PERSONNES. Le fondateur porte la permission de plateforme (lib/staff-auth.js) ; sa session de
// secours aussi, sous le role verrouille Direction.
// ---------------------------------------------------------------------------
const MARIE = () => B.sessionDuRole('direction', { nom: 'Marie Dupont' });
const LUC = () => B.sessionDuRole('manager', { nom: 'Luc Martin' });
const ZOE = () => B.sessionDuRole('staff-bar', { nom: 'Zoé Bar' });
function FONDATEUR() {
  const s = B.sessionDuRole('direction', { nom: NOM_ACTUEL });
  s.member.id = MEMBRE;
  s.permissions = [...s.permissions, 'platform.admin'];
  return s;
}
function SECOURS() {
  const s = B.sessionDuRole('direction', { nom: NOM_DE_NAISSANCE });
  s.member.id = `${MEMBRE}-emergency`;
  s.role.locked = true;
  s.permissions = [...s.permissions, 'platform.admin'];
  return s;
}

// Un appel, avec la marque que requireStaffPermission pose pour une session du centre.
async function comme(m, session, handler, methode, url, corps) {
  m.changerSession(session);
  const F = require(path.join(ROOT, 'lib/fondateur-invisible.js'));
  const marque = F.estFondateur(session) ? null : await F.nomsDuFondateur();
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  req.method = methode;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  const res = {
    statusCode: 200,
    entetes: {},
    corps: '',
    __nomsDuFondateur: marque,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    end(b) { this.corps = String(b || ''); },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (error) { json = null; }
  return { statut: res.statusCode, json: json || {}, brut: res.corps };
}

function monter(mutations = [], semis = lignesDuJour()) {
  B.semer(semis);
  const m = B.monter({ mutations, session: LUC() });
  m.patch = async (session, corps) => {
    const r = await auJour(() => comme(m, session, m.handler, 'PATCH', URL_RESA, corps));
    return { statut: r.statut, code: r.json.code || '', message: r.json.message || '', r: r.json.reservation || null, brut: r.brut };
  };
  m.etat = async (session) => {
    const etat = require(path.join(ROOT, 'api/staff-state.js'));
    return auJour(() => comme(m, session, etat, 'GET', `/api/staff-state?date=${JOUR}&centerId=libramont`));
  };
  m.direct = (session, methode, url, corps) => comme(m, session, m.handler, methode, url, corps);
  m.auditsDu = (membre) => m.journal.audits.filter((a) => a.actorMemberId === membre);
  return m;
}
const dire = (x) => `${x.statut} ${x.code || ''} ${x.message || ''}`.trim();

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

// ---------------------------------------------------------------------------
// [C] LA CREATION, depuis la fenetre Reserver : un dossier force « à placer » sur 16:00 complet.
// ---------------------------------------------------------------------------
const PLEIN_16H = () => [1, 2, 3, 4, 5, 6, 7, 8].map((piste) => B.ligne(910 + piste, { start_time: '16:00', lanes: [piste], name: `Piste ${piste}` }));
const FORCE_16H = (note) => ({ ...B.corpsStaff({ type: 'bowling', pax: 4, startTime: '16:00', duration: 1, totalDuration: 1, lanes: [], laneCount: 1 }), forcer: true, notes: `[equipe] ${JSON.stringify({ t: note })}` });

async function groupeCreation(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations, PLEIN_16H());
  const x = await m.direct(FONDATEUR(), 'POST', URL_RESA, FORCE_16H('Allergie aux arachides'));
  const lu = x.json.reservation ? enBase(x.json.reservation.id) : null;
  const plan = lu && (typeof lu.ops_plan === 'string' ? JSON.parse(lu.ops_plan) : lu.ops_plan);
  const notes = notesLues(lu && lu.notes);
  const aPlacer = notes.find((n) => /^À placer/.test(n.t));
  const corps = notes.find((n) => n.t === 'Allergie aux arachides');
  v(x.statut === 201 && x.json.aPlacer === true && lu, '[C0] MONTAGE le fondateur cree un dossier force a placer', `${x.statut} ${x.json.message || ''}`);
  v(aPlacer && aPlacer.par === '' && plan && plan.aPlacer && plan.aPlacer.par === '', '[C1] la note « À placer » et le plan du fondateur ne le nomment pas', { aPlacer, plan: plan && plan.aPlacer });
  v(corps && corps.par === '', '[C2] la note d equipe tapee a la creation par le fondateur est signee par personne', corps);
  v(sansLui(JSON.stringify(lu)), '[C3] le dossier cree par le fondateur ne porte ni son nom ni son identifiant', lu && lu.notes);
  v(m.auditsDu(MEMBRE).some((a) => a.action === 'createReservation'), '[C4] le journal d audit garde la creation, a son identifiant', m.journal.audits.map((a) => `${a.action}:${a.actorMemberId}`));
  const y = await m.direct(MARIE(), 'POST', URL_RESA, FORCE_16H('Le papa paie a la fin'));
  const luMarie = y.json.reservation ? enBase(y.json.reservation.id) : null;
  const notesMarie = notesLues(luMarie && luMarie.notes);
  const planMarie = luMarie && (typeof luMarie.ops_plan === 'string' ? JSON.parse(luMarie.ops_plan) : luMarie.ops_plan);
  v(y.statut === 201 && notesMarie.find((n) => /^À placer/.test(n.t) && n.par === 'Marie Dupont') && notesMarie.find((n) => n.t === 'Le papa paie a la fin' && n.par === 'Marie Dupont') && planMarie && planMarie.aPlacer && planMarie.aPlacer.par === 'Marie Dupont',
    '[C5] le meme geste de Marie (Direction) reste signe Marie', { statut: dire(y), notes: notesMarie, plan: planMarie && planMarie.aPlacer });
  return liste;
}

// ---------------------------------------------------------------------------
// [N] LES NOTES D EQUIPE (la route dediee : ajouter, modifier).
// ---------------------------------------------------------------------------
async function groupeNotes(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  let x = await m.patch(FONDATEUR(), { id: SOLO, centerId: 'libramont', noteEquipe: { ajout: 'Prévenir le client du retard' } });
  let n = noteDe(enBase(SOLO).notes, 'Prévenir le client du retard');
  v(x.statut === 200 && n && n.par === '', '[N1] la note ajoutee par le fondateur est signee par personne', { statut: dire(x), n });
  v(x.r && x.r.notes.includes(NOM_ACTUEL), '[N2] le fondateur, lui, relit ses vieilles notes a son nom', x.r && x.r.notes);
  x = await m.patch(FONDATEUR(), { id: SOLO, centerId: 'libramont', noteEquipe: { modifier: { le: LE('09:00'), baseText: 'Gâteau au frigo du bar', texte: 'Gâteau au frigo du bar, bougies 10' } } });
  n = noteDe(enBase(SOLO).notes, 'Gâteau au frigo du bar, bougies 10');
  v(x.statut === 200 && n && n.par === 'Luc Martin' && n.modifiePar === '' && Boolean(n.modifieLe), '[N3] la note de Luc reecrite par le fondateur : Luc reste l auteur, « modifiée par » ne le nomme pas', { statut: dire(x), n });
  x = await m.patch(SECOURS(), { id: SOLO, centerId: 'libramont', noteEquipe: { ajout: 'Note de la session de secours' } });
  n = noteDe(enBase(SOLO).notes, 'Note de la session de secours');
  v(x.statut === 200 && n && n.par === '', '[N4] sa session de secours ne signe pas non plus', { statut: dire(x), n });
  x = await m.patch(MARIE(), { id: SOLO, centerId: 'libramont', noteEquipe: { ajout: 'Le papa paie a la fin' } });
  n = noteDe(enBase(SOLO).notes, 'Le papa paie a la fin');
  v(x.statut === 200 && n && n.par === 'Marie Dupont', '[N5] la note de Marie (Direction) reste signee Marie', { statut: dire(x), n });
  v(x.statut === 200 && sansLui(x.brut) && x.brut.includes('Luc Martin') && x.brut.includes('Vérifier le prix avec la direction'),
    '[N6] la reponse a Marie porte toutes les notes, aucune a son nom ; celles de Luc gardent le leur', x.brut.slice(0, 300));
  const actes = m.auditsDu(MEMBRE).map((a) => a.action);
  v(actes.includes('ajouterNoteEquipe') && actes.includes('modifierNoteEquipe') && m.auditsDu(`${MEMBRE}-emergency`).length === 1,
    '[N7] le journal d audit garde chaque note du fondateur et de sa session de secours, a leur identifiant', actes);
  return liste;
}

// ---------------------------------------------------------------------------
// [P] MODIFIER : la derniere modification, le prix ajuste, le compte a l arrivee, la copie de secours.
// ---------------------------------------------------------------------------
async function groupeModifier(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const etat = await m.etat(FONDATEUR());
  const solo = (etat.json.reservations || []).find((r) => r.id === SOLO);
  let x = await m.patch(MARIE(), corpsDe(solo, { pax: 6 }));
  const deMarie = planEnBase(SOLO) && planEnBase(SOLO).derniereModif;
  v(x.statut === 200 && deMarie && deMarie.par === 'Marie Dupont' && deMarie.quoi.includes('5 → 6 joueurs'), '[P1] Marie passe le groupe a 6 : « Modifié, Marie Dupont »', { statut: dire(x), d: deMarie });
  const secoursMarie = m.journal.secours.length ? m.journal.secours[m.journal.secours.length - 1][1] : null;
  v(secoursMarie && secoursMarie.par === 'Marie Dupont', '[P2] la copie de secours du geste de Marie la nomme', secoursMarie);
  const avant = JSON.stringify(deMarie);
  const nbSecours = m.journal.secours.length;
  x = await m.patch(FONDATEUR(), corpsDe(x.r, { name: `${x.r.name} (Léa)` }));
  v(x.statut === 200 && enBase(SOLO).name === `${solo.name} (Léa)` && JSON.stringify(planEnBase(SOLO).derniereModif) === avant,
    '[P3] le fondateur renomme le dossier : le nom change, la derniere modification reste celle de Marie', { statut: dire(x), d: planEnBase(SOLO).derniereModif });
  const secoursFondateur = m.journal.secours.length > nbSecours ? m.journal.secours[m.journal.secours.length - 1][1] : null;
  v(secoursFondateur && secoursFondateur.par === '', '[P4] la copie de secours du geste du fondateur ne le nomme pas', secoursFondateur);
  x = await m.patch(FONDATEUR(), corpsDe(x.r, { price: 58, prixRaison: 'Geste commercial' }));
  const prix = notesLues(enBase(SOLO).notes).filter((n) => n.type === 'prix');
  v(x.statut === 200 && prix.length === 1 && prix[0].par === '' && prix[0].prix && prix[0].prix.a === 58, '[P5] le prix ajuste par le fondateur garde sa raison, signee par personne', { statut: dire(x), prix });
  x = await m.patch(MARIE(), corpsDe(x.r, { price: 56, prixRaison: 'Bougies offertes' }));
  const prixMarie = notesLues(enBase(SOLO).notes).filter((n) => n.type === 'prix' && n.prix && n.prix.a === 56);
  v(x.statut === 200 && prixMarie.length === 1 && prixMarie[0].par === 'Marie Dupont', '[P6] le prix ajuste par Marie reste signe Marie', { statut: dire(x), prixMarie });
  const noel = (etat.json.reservations || []).find((r) => r.id === NOEL);
  x = await m.patch(FONDATEUR(), corpsDe(noel, { pax: 6, compteArrivee: true }));
  const compte = notesLues(enBase(NOEL).notes).find((n) => n.compte);
  v(x.statut === 200 && compte && compte.par === '' && compte.compte.de === 4 && compte.compte.a === 6, '[P7] le compte a l arrivee fait par le fondateur ne le nomme pas', { statut: dire(x), compte });
  const actes = m.auditsDu(MEMBRE).map((a) => a.action);
  v(actes.filter((a) => a === 'updateReservation').length === 3, '[P8] le journal d audit garde ses trois modifications, a son identifiant', actes);
  return liste;
}

// ---------------------------------------------------------------------------
// [S] LE SUIVI DES ACTIVITES : la coche (activityToggle) et le suivi entier (onglet d avant la coche).
// ---------------------------------------------------------------------------
async function groupeSuivi(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  let x = await m.patch(FONDATEUR(), { id: SOLO, centerId: 'libramont', activityToggle: { key: 'laser_game', done: true, doneAt: LE('14:05'), by: NOM_ACTUEL } });
  v(x.statut === 200 && suiviEnBase(SOLO).laser_game && suiviEnBase(SOLO).laser_game.done === true && suiviEnBase(SOLO).laser_game.by === '',
    '[S1] la coche du fondateur est faite, sans son nom', { statut: dire(x), suivi: suiviEnBase(SOLO) });
  const courant = suiviEnBase(SOLO);
  x = await m.patch(FONDATEUR(), { id: SOLO, centerId: 'libramont', activityProgress: { ...courant, escape: { done: true, doneAt: LE('14:10'), by: NOM_ACTUEL } } });
  const apres = suiviEnBase(SOLO);
  v(x.statut === 200 && apres.escape && apres.escape.done === true && apres.escape.by === '' && apres.bowling.by === NOM_ACTUEL,
    '[S2] le suivi entier envoye par le fondateur : sa coche neuve sans son nom, sa vieille coche en base intacte', { statut: dire(x), suivi: apres });
  x = await m.patch(MARIE(), { id: SOLO, centerId: 'libramont', activityToggle: { key: 'karting', done: true, doneAt: LE('14:15'), by: 'Marie Dupont' } });
  v(x.statut === 200 && suiviEnBase(SOLO).karting && suiviEnBase(SOLO).karting.by === 'Marie Dupont', '[S3] la coche de Marie reste a son nom', { statut: dire(x), suivi: suiviEnBase(SOLO) });
  v(x.statut === 200 && sansLui(x.brut) && x.brut.includes('Luc Martin'), '[S4] la reponse a Marie ne nomme pas le fondateur sur ses vieilles coches', x.brut.slice(0, 300));
  v(m.auditsDu(MEMBRE).filter((a) => a.action === 'setReservationActivityProgress').length === 2, '[S5] le journal d audit garde ses deux coches, a son identifiant', m.auditsDu(MEMBRE).map((a) => a.action));
  return liste;
}

// ---------------------------------------------------------------------------
// [E] LES DEPARTS EPINGLES (reservation_departs_epingles.updated_by, jamais montre a l ecran).
// ---------------------------------------------------------------------------
async function groupeEpingles(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations, []);
  const corps = { centerId: 'libramont', epingles: [{ libelle: 'Anniversaire laser', type: 'laser', laserGames: 3 }] };
  let x = await m.direct(FONDATEUR(), 'POST', `${URL_RESA}?departs=1`, corps);
  const ligne = B.extra.epingles.get('libramont');
  v(x.statut === 200 && ligne && ligne.updated_by === '', '[E1] les departs epingles par le fondateur ne gardent pas son nom', { statut: x.statut, ligne });
  x = await m.direct(LUC(), 'POST', `${URL_RESA}?departs=1`, corps);
  v(x.statut === 200 && B.extra.epingles.get('libramont').updated_by === 'm-manager Luc Martin', '[E2] ceux de Luc (Manager) gardent le sien', B.extra.epingles.get('libramont'));
  return liste;
}

// ---------------------------------------------------------------------------
// [L] LA LECTURE, puis [T] LE CHEMIN DU RETOUR, avec ce que chacun a lu.
// ---------------------------------------------------------------------------
async function groupeLectureEtRetour(mutations = []) {
  const { liste, v } = verdicts();
  const m = monter(mutations);
  const lire = async (session) => {
    const x = await m.etat(session);
    return { x, solo: (x.json.reservations || []).find((r) => r.id === SOLO) || null };
  };
  const marie = await lire(MARIE());
  const s = marie.solo || {};
  v(marie.x.statut === 200 && marie.solo && sansLui(marie.x.brut), '[L1] le staff-state lu par Marie (Direction) ne nomme le fondateur nulle part', { statut: marie.x.statut, extrait: marie.x.brut.slice(0, 200) });
  const lues = notesLues(s.notes);
  v(['Vérifier le prix avec la direction', 'Ancienne note du fondateur'].every((t) => { const n = lues.find((x) => x.t === t); return n && n.par === ''; })
    && lues.some((x) => x.t === 'Gâteau au frigo du bar' && x.par === 'Luc Martin') && lues.some((x) => x.t === 'Piste 7 gardée pour eux' && x.par === 'Luc Martin' && x.modifiePar === '')
    && String(s.notes).includes('Anniversaire de Léa, 10 ans.'),
  '[L2] ses vieilles notes restent lisibles, sans nom (actuel ou de naissance) ; celles de Luc gardent Luc ; le mot du client ne bouge pas', lues);
  v(s.activityProgress && s.activityProgress.bowling && s.activityProgress.bowling.done === true && s.activityProgress.bowling.by === '' && s.activityProgress.minigolf.by === 'Luc Martin',
    '[L3] sa coche reste faite, sans son nom ; celle de Luc garde Luc', s.activityProgress);
  v(Array.isArray(s.extras) && s.extras.length === 2 && s.extras[0].par === '' && s.extras[1].par === 'Luc Martin', '[L4] sa ligne de sur mesure reste, sans son nom', s.extras);
  const d = s.opsPlan && s.opsPlan.derniereModif;
  v(d && d.par === '' && d.quoi[0] === 'Heure 13:30 → 14:00', '[L5] sa derniere modification se lit sans nom', d);
  const zoe = await lire(ZOE());
  v(zoe.x.statut === 200 && zoe.solo && sansLui(zoe.x.brut) && zoe.x.brut.includes('Luc Martin'), '[L6] Zoe (Bar) ne le voit pas non plus', zoe.x.brut.slice(0, 200));
  const lui = await lire(FONDATEUR());
  v(lui.x.statut === 200 && lui.solo && JSON.stringify(lui.solo).includes(NOM_ACTUEL) && lui.solo.activityProgress.bowling.by === NOM_ACTUEL, '[L7] le fondateur, lui, voit tout', lui.solo && lui.solo.activityProgress);

  // [T] Marie renvoie le dossier tel qu elle l a lu, et change le nom.
  const notesAvant = enBase(SOLO).notes;
  const suiviAvant = JSON.stringify(suiviEnBase(SOLO));
  let x = await m.patch(MARIE(), corpsDe(s, { name: `${s.name} (Léa)` }));
  v(x.statut === 200 && enBase(SOLO).name === `${s.name} (Léa)`, '[T0] MONTAGE Marie renvoie le dossier masque, le nom change', dire(x));
  v(enBase(SOLO).notes === notesAvant, '[T1] les notes du fondateur reviennent telles qu en base : ni resignees Marie, ni effacees', enBase(SOLO).notes);
  v(JSON.stringify(suiviEnBase(SOLO)) === suiviAvant, '[T2] sa coche garde son auteur en base', suiviEnBase(SOLO));
  const extras = typeof enBase(SOLO).extras === 'string' ? JSON.parse(enBase(SOLO).extras) : enBase(SOLO).extras;
  v(extras && extras[0] && extras[0].par === NOM_ACTUEL && extras[1].par === 'Luc Martin', '[T3] sa ligne de sur mesure garde son auteur en base', extras);
  const dm = planEnBase(SOLO).derniereModif;
  v(dm && dm.par === 'Marie Dupont', '[T4] le geste de Marie, lui, se signe Marie', dm);
  // Zoe (Bar) n a que le droit d ajouter : elle renvoie les notes masquees, plus la sienne.
  x = await m.patch(ZOE(), { id: SOLO, centerId: 'libramont', notes: `${s.notes}\n[equipe] ${JSON.stringify({ t: 'Le groupe arrive a 14:10' })}` });
  const apres = String(enBase(SOLO).notes).split('\n');
  const sienne = noteDe(enBase(SOLO).notes, 'Le groupe arrive a 14:10');
  v(x.statut === 200 && notesAvant.split('\n').every((l) => apres.includes(l)) && sienne && sienne.par === 'Zoé Bar',
    '[T5] Zoe ajoute sa note au dossier masque : pas de refus, les notes du fondateur intactes, la sienne a son nom', { statut: dire(x), notes: enBase(SOLO).notes });
  // Zoe renvoie le suivi masque, plus sa coche (l onglet d avant la coche unitaire).
  x = await m.patch(ZOE(), { id: SOLO, centerId: 'libramont', activityProgress: { ...s.activityProgress, laser_game: { done: true, doneAt: LE('14:20'), by: 'Zoé Bar' } } });
  const suivi = suiviEnBase(SOLO);
  v(x.statut === 200 && suivi.bowling.by === NOM_ACTUEL && suivi.minigolf.by === 'Luc Martin' && suivi.laser_game.by === 'Zoé Bar',
    '[T6] Zoe renvoie le suivi masque avec sa coche : la coche du fondateur garde son auteur en base', { statut: dire(x), suivi });
  return liste;
}

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES : chaque garde retiree en memoire fait rougir sa lettre.
// ---------------------------------------------------------------------------
const GARDES = [
  { nom: 'la note du fondateur se signe a son nom', fichier: 'lib/droits-reservation.js', de: "  if (estFondateur(session)) return '';\n", vers: '', groupe: groupeNotes, lettre: '[N1]' },
  { nom: 'la derniere modification du fondateur s ecrit', fichier: 'lib/droits-reservation.js', de: "  if (estFondateur(session)) return '';\n", vers: '', groupe: groupeModifier, lettre: '[P3]' },
  { nom: 'le prix ajuste du fondateur se signe', fichier: 'lib/droits-reservation.js', de: "  if (estFondateur(session)) return '';\n", vers: '', groupe: groupeModifier, lettre: '[P5]' },
  { nom: 'la copie de secours nomme le fondateur', fichier: 'api/staff-reservations.js', de: "  const par = require('../lib/fondateur-invisible').signatureVisible(session, { avecId: false });", vers: "  const par = (session && session.member && session.member.name) || '';", groupe: groupeModifier, lettre: '[P4]' },
  { nom: 'la coche du fondateur garde son nom', fichier: 'api/staff-reservations.js', de: "by: require('../lib/fondateur-invisible').estFondateur(session) ? '' : coche.by", vers: 'by: coche.by', groupe: groupeSuivi, lettre: '[S1]' },
  { nom: 'le suivi entier du fondateur garde son nom', fichier: 'api/staff-reservations.js', de: '  cles.forEach((cle) => { body[cle] = F.suiviSansSignature(body[cle], current.activityProgress, noms); });\n', vers: '', groupe: groupeSuivi, lettre: '[S2]' },
  { nom: 'la note « À placer » nomme le fondateur', fichier: 'lib/reserver-fenetre.js', de: "  if (require('./fondateur-invisible').estFondateur(session)) return '';\n", vers: '', groupe: groupeCreation, lettre: '[C1]' },
  { nom: 'les departs epingles gardent le fondateur', fichier: 'lib/registre.js', de: "  if (!member || require('./fondateur-invisible').estFondateur(session)) return '';", vers: "  if (!member) return '';", groupe: groupeEpingles, lettre: '[E1]' },
  { nom: 'la reponse a un centre n est plus masquee', fichier: 'lib/http.js', de: "const sansFondateur = res.__nomsDuFondateur ? require('./fondateur-invisible').masquerFondateur(payload, res.__nomsDuFondateur) : payload;", vers: 'const sansFondateur = payload;', groupe: groupeLectureEtRetour, lettre: '[L1]' },
  { nom: 'les notes masquees reviennent comme neuves', fichier: 'api/staff-reservations.js', de: "    if (typeof body.notes === 'string') body.notes = F.notesRendues(body.notes, String(current.notes || ''), res.__nomsDuFondateur);\n", vers: '', groupe: groupeLectureEtRetour, lettre: '[T1]' },
  { nom: 'Zoe est refusee sur les notes masquees', fichier: 'api/staff-reservations.js', de: "    if (typeof body.notes === 'string') body.notes = F.notesRendues(body.notes, String(current.notes || ''), res.__nomsDuFondateur);\n", vers: '', groupe: groupeLectureEtRetour, lettre: '[T5]' },
  { nom: 'le suivi masque efface l auteur en base', fichier: 'api/staff-reservations.js', de: '    cles.forEach((cle) => { body[cle] = F.suiviRendu(body[cle], current.activityProgress, res.__nomsDuFondateur); });\n', vers: '', groupe: groupeLectureEtRetour, lettre: '[T6]' },
];

async function contrePreuves() {
  console.log('\n[X] contre-preuves');
  for (const g of GARDES) {
    await B.contrePreuve(ok, {
      nom: g.nom,
      fichier: g.fichier,
      de: g.de,
      vers: g.vers,
      // Le groupe qui s arrete (ancre absente, exception) ne rend pas sa lettre : la contre-preuve ne
      // compte que la lettre ROUGE, jamais un banc casse.
      rejouer: async (liste) => { try { return await g.groupe(liste); } catch (error) { return [{ ok: false, label: 'exception', detail: error.message }]; } },
      attendu: (verdictsRendus) => { const lu = verdictsRendus.find((x) => x.label.startsWith(g.lettre)); return !(lu && !lu.ok); },
      libelle: `${g.lettre} rougit`,
    });
  }
}

(async () => {
  for (const groupe of [groupeCreation, groupeNotes, groupeModifier, groupeSuivi, groupeEpingles, groupeLectureEtRetour]) {
    let liste;
    try { liste = await groupe([]); } catch (error) { liste = [{ ok: false, label: `${groupe.name} s est arrete`, detail: error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error) }]; }
    liste.forEach((x) => ok(x.ok, x.label, x.detail));
  }
  if (!process.argv.includes('--sans-contre-preuves')) await contrePreuves();
  B.sortir('fondateur-invisible-dossiers', echecs, 'le fondateur ne signe rien sur un dossier, ses vieilles traces se lisent sans nom, rien ne se resigne au retour.');
})();
