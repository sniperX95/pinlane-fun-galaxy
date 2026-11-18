// L ORDRE D ENVOYER LA CONFIRMATION S ECRIT AVEC LA RESERVATION EN LIGNE (2026-11-18, point C4 de la
// verification avant le lancement).
//
// Le trou : la confirmation d une reservation en ligne se met en file APRES le COMMIT
// (api/public-reservations.js, afterReservationCreated). Une fonction coupee entre les deux (limite de
// duree de l hebergeur, processus tombe) laissait une reservation sans aucun mail : le client ne savait
// pas que c etait pris, et la tour de controle ne le voyait qu apres 20 minutes.
//
// Maintenant le travail qui compose et envoie les mails de la reservation (dispatch_communications, le
// meme que enqueueReservationAutomation pose apres coup, sous la meme cle) s ecrit dans la transaction de
// la reservation (lib/database.js createReservation). Ce gate rejoue le VRAI handler du formulaire, la
// vraie lib/database.js et le vrai moteur sur la base en memoire du banc des blocages
// (scripts/slot-holds-check.js : vraies transactions). Ce qui suit l ecriture (mails, automatisations)
// y est muet : exactement ce qu en voit la base quand la fonction est coupee juste apres le COMMIT.
//   [A] APRES UNE COUPURE : la reservation est en base avec son travail d envoi, ecrit dans la meme
//       transaction, avant le COMMIT, pour ce dossier et ce client ;
//   [B] UNE SEULE FILE : sa cle, son type et sa priorite sont ceux que le chemin normal pose apres coup
//       (le vrai enqueueReservationAutomation) : les deux se confondent, jamais deux travaux ;
//   [C] JAMAIS L UN SANS L AUTRE : si le travail ne s ecrit pas, la reservation non plus, et le client
//       lit une panne, jamais « horaires pris » ;
//   [D] LE COMPTOIR ET LES AUTRES ECRITURES NE CHANGENT PAS : sans la demande du formulaire,
//       createReservation n ecrit aucun travail ;
//   [E] LE TRAVAIL REPRIS COMPOSE LA CONFIRMATION DE CE DOSSIER, sous la cle de mail du chemin normal :
//       un mail deja parti ne repart pas.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const banc = require('./slot-holds-check.js');

const ROOT = path.resolve(__dirname, '..');
const DB = 'lib/database.js';
const API = 'api/public-reservations.js';
const CONTRE = process.argv.includes('--contre-preuves');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

// Mutations en memoire, avant celles du banc.
let mutations = [];
const compilePrecedent = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compilePrecedent.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compilePrecedent.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// La table des travaux, apprise au banc : une ligne ecrite dans une transaction n existe qu a son COMMIT.
// ---------------------------------------------------------------------------
const travaux = { valides: [], refuser: false, ordre: [] };
const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const tx = this && this.tx ? this.tx : null;
  if (/^insert into ops_jobs \(/.test(s)) {
    travaux.ordre.push('travail');
    if (travaux.refuser) {
      if (tx) tx.abandonnee = true;
      throw Object.assign(new Error('relation "ops_jobs" does not exist'), { code: '42P01' });
    }
    const ligne = { sql: s, params, dansUneTransaction: Boolean(tx), avecReservation: tx ? [...tx.reservations.keys()] : [] };
    if (tx) { tx.travaux = tx.travaux || []; tx.travaux.push(ligne); } else travaux.valides.push(ligne);
    return { rows: [], rowCount: 1 };
  }
  if (/^insert into reservations \(/.test(s)) travaux.ordre.push('reservation');
  if (s === 'COMMIT' || s === 'ROLLBACK') {
    const valide = s === 'COMMIT' && tx && !tx.abandonnee;
    const enAttente = (tx && tx.travaux) || [];
    const r = await queryDuBanc.call(this, sql, params);
    if (valide) { travaux.ordre.push('COMMIT'); travaux.valides.push(...enAttente); }
    return r;
  }
  return queryDuBanc.call(this, sql, params);
};

function charger(liste) {
  mutations = liste;
  try { return banc.charger(); } finally { mutations = []; }
}

// Un module du produit compile a neuf, hors du cache du banc (ou il est muet).
function moduleReel(rel) {
  const chemin = path.join(ROOT, rel);
  const m = new Module(chemin, module);
  m.filename = chemin;
  m.paths = Module._nodeModulePaths(path.dirname(chemin));
  m._compile(fs.readFileSync(chemin, 'utf8'), chemin);
  return m.exports;
}

const SANS_REGLAGES = { query: async () => ({ rows: [], rowCount: 0 }) };

async function scenario(liste) {
  const f = {};
  // [A] La confirmation en ligne, sans rien de ce qui suit l ecriture.
  banc.semer([]);
  travaux.valides = []; travaux.refuser = false; travaux.ordre = [];
  let S = charger(liste);
  const client = banc.avecContact(banc.BOWLING('17:00'), 7);
  const r = await banc.confirmer(S, client);
  const enBase = [...banc.base.reservations.values()];
  const resa = enBase[0] || null;
  const job = travaux.valides[0] || null;
  const p = job ? job.params : [];
  let charge = null;
  try { charge = job ? JSON.parse(p[3]) : null; } catch (e) { charge = null; }
  f.a = {
    statut: r.statut,
    reservations: enBase.length,
    travaux: travaux.valides.length,
    type: job ? (/'dispatch_communications'/.test(job.sql) ? 'dispatch_communications' : job.sql.slice(0, 160)) : '',
    memeTransaction: Boolean(job && job.dansUneTransaction && resa && job.avecReservation.includes(resa.id)),
    ordre: travaux.ordre.join(' > '),
    dossier: Boolean(resa && Number(p[1]) === resa.id && p[0] === resa.center_id),
    cle: p[2] || '',
    cleAttendue: resa ? `reservation:${resa.id}:job:dispatch_communications` : '?',
    charge: Boolean(charge && charge.reservation && Number(charge.reservation.id) === (resa && resa.id) && charge.reservation.email === client.email && charge.reservation.date === client.date),
    conflit: Boolean(job && /on conflict \(idempotency_key\) where idempotency_key is not null do nothing/.test(job.sql)),
    priorite: job ? (/'queued', 90, now\(\), 5,/.test(job.sql) ? 90 : 0) : 0,
  };
  f.chargeReservation = charge && charge.reservation;
  // [B] Le chemin normal, le vrai : la cle, le type et la priorite qu il pose apres coup.
  if (charge && charge.reservation) {
    const poses = [];
    await moduleReel('lib/ops-jobs.js').enqueueReservationAutomation(charge.reservation, { createJob: async (j) => { poses.push(j); return j; }, deps: SANS_REGLAGES });
    const normal = poses.find((j) => j.jobType === 'dispatch_communications') || {};
    f.b = { cle: normal.idempotencyKey || '', priorite: normal.priority, centre: normal.centerId, numero: normal.reservationId };
  } else f.b = { cle: '' };
  // [C] Le travail refuse : la reservation ne s ecrit pas, le client lit une panne.
  banc.semer([]);
  travaux.valides = []; travaux.refuser = true; travaux.ordre = [];
  S = charger(liste);
  const refus = await banc.confirmer(S, banc.avecContact(banc.BOWLING('17:00'), 8));
  travaux.refuser = false;
  f.c = { statut: refus.statut, code: String(refus.json.code || ''), alternatives: (refus.json.alternatives || []).length, reservations: banc.base.reservations.size, essais: travaux.ordre.filter((x) => x === 'travail').length };
  // [D] Une creation sans la demande du formulaire (comptoir, assistant, simulation).
  banc.semer([]);
  travaux.valides = []; travaux.ordre = [];
  S = charger(liste);
  const ops = await S.ops.prepareReservationOps(S.requete.normalizeReservationRequest({ ...banc.avecContact(banc.BOWLING('15:00'), 9), channel: 'staff' }, { channel: 'staff' }), 'staff');
  let comptoir = '';
  try {
    const cree = await S.db.createReservation({ ...banc.avecContact(banc.BOWLING('15:00'), 9), ...ops, channel: 'staff', lanes: ops.opsPlan && ops.opsPlan.assignedLanes });
    comptoir = cree && cree.id ? 'cree' : 'rien';
  } catch (error) { comptoir = `refus ${error.message}`; }
  f.d = { comptoir, travaux: travaux.valides.length, essais: travaux.ordre.filter((x) => x === 'travail').length };
  // [E] Le travail repris compose la confirmation de ce dossier, sous la cle de mail du chemin normal.
  if (f.chargeReservation) {
    const mails = [];
    await moduleReel('lib/ops-communications.js').enqueueReservationCommunications(f.chargeReservation, {
      validationMode: f.chargeReservation.validationStatus,
      enqueue: async (ligne) => { mails.push(ligne); return ligne; },
      deps: SANS_REGLAGES,
    });
    const id = f.chargeReservation.id;
    const premier = mails.find((m) => m.templateId === 'confirmation' || m.templateId === 'request_received') || {};
    f.e = { modele: premier.templateId || '', destinataire: premier.recipient || '', cle: premier.idempotencyKey || '', cleAttendue: `reservation:${id}:${premier.templateId}:email`, numero: premier.reservationId, id };
  } else f.e = { modele: '' };
  return f;
}

function juger(f, dire) {
  const a = f.a;
  dire(a.statut === 201 && a.reservations === 1 && a.travaux === 1 && a.type === 'dispatch_communications',
    '[A] apres une coupure juste apres l ecriture, la reservation est en base avec son travail d envoi', a);
  dire(a.memeTransaction && a.ordre === 'reservation > travail > COMMIT' && a.dossier && a.cle === a.cleAttendue && a.charge,
    '[A] le travail est ecrit dans la meme transaction, avant le COMMIT, pour ce dossier et ce client', a);
  dire(Boolean(a.cle) && f.b.cle === a.cle && f.b.priorite === a.priorite && a.conflit && Number(f.b.numero) === Number((f.chargeReservation || {}).id),
    '[B] une seule file : la cle, le type et la priorite du chemin normal, et l ecriture cede a un travail deja la', { transaction: { cle: a.cle, priorite: a.priorite, conflit: a.conflit }, normal: f.b });
  dire(f.c.essais === 1 && f.c.reservations === 0 && f.c.statut === 503 && f.c.alternatives === 0,
    '[C] si le travail ne s ecrit pas, la reservation non plus, et le client lit une panne (jamais « horaires pris »)', f.c);
  dire(f.d.comptoir === 'cree' && f.d.travaux === 0 && f.d.essais === 0, '[D] une creation sans la demande du formulaire n ecrit aucun travail', f.d);
  dire(f.e.modele === 'confirmation' && f.e.destinataire === 'client7@example.test' && f.e.cle === f.e.cleAttendue && Number(f.e.numero) === Number(f.e.id),
    '[E] le travail repris compose la confirmation de ce dossier, sous la cle de mail du chemin normal', f.e);
}

const CONTRE_PREUVES = [
  { nom: 'mail-apres-le-commit', lettres: ['[A]', '[B]', '[C]'], fichier: DB, de: '    if (input.ordreDEnvoiAvecLaReservation === true) {\n', vers: '    if (false) {\n', libelle: 'une coupure apres l ecriture laisserait le client sans confirmation' },
  { nom: 'formulaire-sans-la-demande', lettres: ['[A]', '[C]'], fichier: API, de: '          ordreDEnvoiAvecLaReservation: true,\n', vers: '', libelle: 'le formulaire ne demanderait pas l ordre d envoi' },
  { nom: 'deux-travaux', lettres: ['[A]', '[B]'], fichier: DB, de: "`reservation:${reservation.id}:job:dispatch_communications`", vers: "`reservation:${reservation.id}:job:envoi`", libelle: 'le chemin normal poserait un second travail, et deux envois' },
  { nom: 'tous-les-canaux', lettres: ['[D]'], fichier: DB, de: '    if (input.ordreDEnvoiAvecLaReservation === true) {\n', vers: '    if (true) {\n', libelle: 'le comptoir et la simulation ecriraient un travail qu ils ne demandent pas' },
];

(async () => {
  if (!CONTRE) {
    juger(await scenario([]), ok);
    console.log(echecs ? `\nconfirmation-en-file-check: ${echecs} FAIL` : '\nconfirmation-en-file-check: ALL OK - la reservation en ligne et l ordre d envoyer sa confirmation s ecrivent ensemble, une seule file');
    process.exit(echecs ? 1 : 0);
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      juger(await scenario([{ fichier: c.fichier, de: c.de, vers: c.vers }]), (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(', ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  juger(await scenario([]), (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  console.log(echecs ? `\nconfirmation-en-file-check --contre-preuves: ${echecs} FAIL` : '\nconfirmation-en-file-check --contre-preuves: ALL OK - chaque garde retiree fait rougir sa lettre');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
