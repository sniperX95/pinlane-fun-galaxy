// LES DROITS D UNE RESERVATION, COTE SERVEUR (2026-10-12).
//
// La console cache un bouton a qui n en a pas le droit ; le serveur, lui, doit
// REFUSER le geste, sinon le bouton cache n est qu une politesse. Trois trous
// mesures sur api/staff-reservations.js avant correction :
//   1. ANNULER (ou restaurer) un dossier par PATCH ne demandait que le droit de
//      changer un statut : le role preregle « Staff bar » (statut, pas
//      d annulation) annulait par l API ce que la console lui cache ;
//   2. ENCAISSER par « Modifier » (le dossier entier, statut paye ou moyen de
//      paiement change) ne demandait que reservations.edit, alors que le
//      chemin du statut seul exigeait deja payments.markPaid ;
//   3. LE PRIX d un dossier entier n etait borne nulle part (negatif, 10^9).
//
// Zero reseau, zero base : 'pg' est remplace dans require.cache par une table
// de sessions forgees. Le VRAI requireStaffPermission les relit (jeton,
// empreinte, role, raccourci du role verrouille) : rien n est court-circuite
// cote droits. Les fonctions de lib/database qui lisent et ecrivent les
// reservations sont remplacees par des doubles qui COMPTENT les ecritures :
// un refus se prouve par le statut ET par l absence d ecriture.
//
//   [A] ANNULER OU RESTAURER (chemin du statut seul) demande reservations.cancel ;
//       les autres statuts restent au droit de statut.
//   [B] ANNULER OU RESTAURER PAR « MODIFIER » (dossier entier) : meme regle ; un
//       dossier qui renvoie son propre statut passe.
//   [C] ENCAISSER PAR « MODIFIER » demande payments.markPaid (devenir paye, ou
//       changer le moyen) ; un dossier deja paye renvoye tel quel passe.
//   [D] LE PRIX SE BORNE entre 0 et 100 000 ; sans prix envoye, le dossier
//       garde le sien.
//   [E] SUPPRIMER demande reservations.cancel (regression).
//   [F] CONTRE-EPREUVES PAR MUTATION, compilees en memoire (crochet sur
//       Module.prototype._compile, le disque n est jamais touche) : chaque
//       garde retiree, le cas qu elle refusait passe.
//
// Usage : node scripts/droits-reservations-check.js
'use strict';
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
// Sans cet interrupteur, lib/booking-config ouvre une connexion pour le
// calendrier scolaire (meme precaution que client-isolation-check).
process.env.PINLANE_CALENDAR_SYNC = 'off';
process.env.DATABASE_URL = 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.DATABASE_SSL = 'disable';
process.env.STAFF_AUTH_SECRET = 'gate-droits-reservations-secret-2026';
// Valeur de banc, comme client-isolation-check : sans elle, le decodage du
// jeton de secours refuse toute session hors developpement.
process.env.PLATFORM_OWNER_CODE = 'GATE-OWNER-2026-DROITS';

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
// LA BASE : des sessions forgees, rien d autre. Une ecriture SQL sur les
// reservations ferait echouer le gate (les doubles de lib/database doivent
// tout intercepter).
// ---------------------------------------------------------------------------
// Meme empreinte que lib/staff-auth.hashSecret : le gate forge des jetons que
// le VRAI code d authentification reconnait.
function hashSecret(value) {
  return crypto.createHash('sha256').update(`${process.env.STAFF_AUTH_SECRET}:${String(value || '').trim()}`).digest('hex');
}
const SESSIONS = new Map();
async function requete(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/from staff_sessions s/i.test(s) && /s\.token_hash = \$1/.test(s)) {
    const row = SESSIONS.get(String(params[0] || ''));
    return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^(update|insert into|delete from) reservations\b/i.test(s)) throw new Error(`ecriture reservations non interceptee : ${s.slice(0, 120)}`);
  return { rows: [], rowCount: 0 };
}
class FauxClient { query(sql, params) { return requete(sql, params); } release() {} }
class FauxPool { async connect() { return new FauxClient(); } query(sql, params) { return requete(sql, params); } on() {} end() {} }
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, Client: FauxClient } };

// ---------------------------------------------------------------------------
// LES DOSSIERS ET CE QUI LES ECRIT. Chaque cas repart des dossiers semes :
// un double ne modifie jamais la table, il journalise l ecriture demandee.
// ---------------------------------------------------------------------------
const dossiers = new Map();
const ecrit = { statut: [], maj: [], suppr: [], secours: [] };
const journalAudit = [];
function dossier(r) {
  return {
    id: r.id, centerId: 'libramont', channel: 'staff', name: 'Groupe Essai', phone: '0470000000', email: 'essai@example.test',
    date: '2026-10-24', startTime: '15:00', duration: 1, totalDuration: 1, lanes: [3], pax: 6, status: 'pending',
    basePrice: 60, price: 60, type: 'bowling', formuleId: null, label: 'Bowling', occasion: '', extras: [], paymentMethod: null,
    notes: '', opsPlan: null, riskLevel: '', riskScore: null, validationStatus: 'confirmed', activityProgress: {}, program: null,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-12T10:00:00.000Z', ...r,
  };
}
function semer() {
  dossiers.clear();
  [
    dossier({ id: 501, status: 'pending' }),
    dossier({ id: 502, status: 'cancelled' }),
    dossier({ id: 503, status: 'cancelled' }),
    dossier({ id: 504, status: 'paid', paymentMethod: 'cash' }),
  ].forEach((d) => dossiers.set(d.id, d));
  for (const liste of Object.values(ecrit)) liste.length = 0;
  journalAudit.length = 0;
}
const copie = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
}

// lib/database D ABORD : les modules charges ensuite y prennent les doubles.
remplacer('lib/database.js', {
  getReservationById: async (id) => copie(dossiers.get(Number(id))),
  setReservationStatus: async ({ id, status, paymentMethod }) => {
    ecrit.statut.push({ id, status, ...(paymentMethod !== undefined ? { paymentMethod } : {}) });
    return { ...copie(dossiers.get(Number(id))), status, ...(paymentMethod !== undefined ? { paymentMethod } : {}) };
  },
  updateReservation: async (patch) => {
    ecrit.maj.push(copie(patch));
    return { ...copie(dossiers.get(Number(patch.id))), ...copie(patch) };
  },
  deleteReservation: async (id) => { ecrit.suppr.push(Number(id)); return { archiveId: 'archive-gate' }; },
  createOpsEvent: async () => ({}),
  cancelReservationCommunications: async () => [],
  cancelReservationOpsJobs: async () => [],
});
remplacer('lib/audit-log.js', { writeAuditLog: async (entree) => { journalAudit.push(entree); return {}; } });
remplacer('lib/secours-envoi.js', { copieSecours: async (reservation, options = {}) => { ecrit.secours.push(options.evenement); return {}; } });
remplacer('lib/ops-communications.js', { enqueueReservationCommunications: async () => [] });
remplacer('lib/ops-jobs.js', { enqueueReservationAutomation: async () => [] });
remplacer('lib/reservation-ops.js', { prepareReservationOps: async () => ({}) });
remplacer('lib/ops-knowledge.js', { refreshCenterOverrides: async () => {} });
remplacer('lib/booking-config.js', { refreshFormuleOverrides: async () => {} });
remplacer('lib/catalog-store.js', { refreshCatalog: async () => {} });

const { STAFF_ROLE_PRESETS } = require(path.join(ROOT, 'lib', 'staff-auth.js'));

// LES ROLES : les preregles reels, plus un role cree dans Equipe qui saisit et
// modifie sans annuler ni encaisser (aucun preregle n a ce profil, la page
// Equipe le permet).
const ROLES = new Map(STAFF_ROLE_PRESETS.map((r) => [r.id, r]));
ROLES.set('saisie', { id: 'saisie', name: 'Saisie', code: 'SA', locked: false, permissions: ['reservations.view', 'reservations.status', 'reservations.edit'] });
const JETONS = {};
for (const role of ROLES.values()) {
  const jeton = `gate-droits-${role.id}`;
  JETONS[role.id] = jeton;
  SESSIONS.set(hashSecret(jeton), {
    token_hash: hashSecret(jeton), center_id: 'libramont', expires_at: new Date(Date.now() + 3600000).toISOString(),
    member_id: `libramont:${role.id}`, member_name: role.name, contact: '', member_status: 'active',
    role_id: role.id, role_name: role.name, role_code: role.code, permissions: role.permissions || [], locked: Boolean(role.locked),
  });
}

function chargerHandler() {
  const chemin = require.resolve(path.join(ROOT, 'api/staff-reservations.js'));
  delete require.cache[chemin];
  return require(chemin);
}

async function appeler(handler, methode, role, corps) {
  const req = Readable.from([Buffer.from(JSON.stringify(corps))]);
  req.method = methode;
  req.url = '/api/staff-reservations';
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'x-staff-session': JETONS[role] };
  req.socket = { remoteAddress: '203.0.113.9' };
  const res = {
    statusCode: 200, entetes: {}, corps: '',
    setHeader(k, v) { this.entetes[String(k).toLowerCase()] = v; },
    getHeader(k) { return this.entetes[String(k).toLowerCase()]; },
    removeHeader(k) { delete this.entetes[String(k).toLowerCase()]; },
    writeHead(code) { this.statusCode = code; },
    write(b) { this.corps += String(b || ''); },
    end(b) { if (b) this.corps += String(b); this.fini = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (error) { json = null; }
  return { statut: res.statusCode, json, message: (json && (json.message || json.error)) || '' };
}

// Un cas : on resseme, on appelle, on rend ce qui a ete ecrit et refuse.
async function cas(handler, methode, role, corps) {
  semer();
  const r = await appeler(handler, methode, role, corps);
  const refus = journalAudit.filter((e) => e.outcome === 'denied').map((e) => e.entityId);
  return { ...r, ecrit: copie(ecrit), refus };
}
const aucuneEcriture = (r) => !r.ecrit.statut.length && !r.ecrit.maj.length && !r.ecrit.suppr.length;

(async () => {
  let handler = chargerHandler();

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[A] ANNULER OU RESTAURER, CHEMIN DU STATUT SEUL : reservations.cancel');
  {
    const bar = await cas(handler, 'PATCH', 'staff-bar', { id: 501, status: 'cancelled' });
    ok(bar.statut === 403, 'Staff bar (statut, pas d annulation) annule par l API : 403', `recu ${bar.statut} ${bar.message}`);
    ok(aucuneEcriture(bar), 'Staff bar : rien n est ecrit', JSON.stringify(bar.ecrit.statut));
    ok(bar.refus.includes('reservations.cancel'), 'le refus est journalise au nom de reservations.cancel', JSON.stringify(bar.refus));
    const tech = await cas(handler, 'PATCH', 'technique', { id: 501, status: 'cancelled' });
    ok(tech.statut === 403 && aucuneEcriture(tech), 'Technique (ni statut ni annulation) : 403, rien n est ecrit', `recu ${tech.statut}`);
    const man = await cas(handler, 'PATCH', 'manager', { id: 501, status: 'cancelled' });
    ok(man.statut === 200 && man.ecrit.statut.length === 1 && man.ecrit.statut[0].status === 'cancelled', 'Manager (annulation) annule : 200, statut ecrit', `recu ${man.statut} ${man.message}`);
    ok(man.ecrit.secours.includes('annulee'), 'l annulation part en copie de secours', JSON.stringify(man.ecrit.secours));
    const dir = await cas(handler, 'PATCH', 'direction', { id: 501, status: 'cancelled' });
    ok(dir.statut === 200 && dir.ecrit.statut.length === 1, 'Direction (role verrouille) annule : 200', `recu ${dir.statut}`);
    const barRestaure = await cas(handler, 'PATCH', 'staff-bar', { id: 502, status: 'pending' });
    ok(barRestaure.statut === 403 && aucuneEcriture(barRestaure), 'Staff bar restaure un dossier annule : 403, rien n est ecrit', `recu ${barRestaure.statut}`);
    const manRestaure = await cas(handler, 'PATCH', 'manager', { id: 502, status: 'pending' });
    ok(manRestaure.statut === 200 && manRestaure.ecrit.statut.length === 1 && manRestaure.ecrit.secours.includes('restauree'), 'Manager restaure : 200, copie de secours « restauree »', `recu ${manRestaure.statut}`);
    // Les autres statuts restent au droit de statut : la garde ne juge qu un
    // CHANGEMENT d annulation.
    const barArrive = await cas(handler, 'PATCH', 'staff-bar', { id: 501, status: 'arrived' });
    ok(barArrive.statut === 200 && barArrive.ecrit.statut.length === 1 && barArrive.ecrit.statut[0].status === 'arrived', 'Staff bar marque Arrive : 200 (droit de statut)', `recu ${barArrive.statut} ${barArrive.message}`);
    const barPaye = await cas(handler, 'PATCH', 'staff-bar', { id: 501, status: 'paid', paymentMethod: 'cash' });
    ok(barPaye.statut === 200 && barPaye.ecrit.statut.length === 1, 'Staff bar encaisse (statut + encaisser) : 200', `recu ${barPaye.statut} ${barPaye.message}`);
    const barDeja = await cas(handler, 'PATCH', 'staff-bar', { id: 503, status: 'cancelled' });
    ok(barDeja.statut === 200, 'un dossier deja annule renvoye « annule » ne change rien : 200', `recu ${barDeja.statut} ${barDeja.message}`);
  }

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[B] ANNULER OU RESTAURER PAR « MODIFIER » (dossier entier)');
  {
    const saisie = await cas(handler, 'PATCH', 'saisie', { id: 501, name: 'Groupe Essai', status: 'cancelled' });
    ok(saisie.statut === 403 && aucuneEcriture(saisie), 'role Saisie (modifier, pas annuler) annule par Modifier : 403, rien n est ecrit', `recu ${saisie.statut} ${saisie.message}`);
    const restaure = await cas(handler, 'PATCH', 'saisie', { id: 502, name: 'Groupe Essai', status: 'pending' });
    ok(restaure.statut === 403 && aucuneEcriture(restaure), 'role Saisie restaure par Modifier : 403, rien n est ecrit', `recu ${restaure.statut}`);
    const memeStatut = await cas(handler, 'PATCH', 'saisie', { id: 501, name: 'Groupe Essai bis', status: 'pending' });
    ok(memeStatut.statut === 200 && memeStatut.ecrit.maj.length === 1 && memeStatut.ecrit.maj[0].name === 'Groupe Essai bis', 'role Saisie modifie le nom, le dossier renvoie son propre statut : 200, ecrit', `recu ${memeStatut.statut} ${memeStatut.message}`);
    const man = await cas(handler, 'PATCH', 'manager', { id: 501, name: 'Groupe Essai', status: 'cancelled' });
    ok(man.statut === 200 && man.ecrit.maj.length === 1, 'Manager annule par Modifier : 200', `recu ${man.statut} ${man.message}`);
  }

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[C] ENCAISSER PAR « MODIFIER » : payments.markPaid');
  {
    const devient = await cas(handler, 'PATCH', 'saisie', { id: 501, name: 'Groupe Essai', status: 'paid', paymentMethod: 'card' });
    ok(devient.statut === 403 && aucuneEcriture(devient), 'role Saisie passe un dossier a Paye par Modifier : 403, rien n est ecrit', `recu ${devient.statut} ${devient.message}`);
    ok(devient.refus.includes('payments.markPaid'), 'le refus est journalise au nom de payments.markPaid', JSON.stringify(devient.refus));
    const moyen = await cas(handler, 'PATCH', 'saisie', { id: 504, name: 'Groupe Essai', status: 'paid', paymentMethod: 'card' });
    ok(moyen.statut === 403 && aucuneEcriture(moyen), 'role Saisie change le moyen de paiement (especes -> carte) : 403', `recu ${moyen.statut}`);
    const moyenSnake = await cas(handler, 'PATCH', 'saisie', { id: 504, name: 'Groupe Essai', payment_method: 'card' });
    ok(moyenSnake.statut === 403 && aucuneEcriture(moyenSnake), 'meme geste sous la clef payment_method : 403', `recu ${moyenSnake.statut}`);
    const tel = await cas(handler, 'PATCH', 'saisie', { id: 504, name: 'Groupe Essai bis', status: 'paid', paymentMethod: 'cash' });
    ok(tel.statut === 200 && tel.ecrit.maj.length === 1, 'role Saisie modifie un dossier deja paye, renvoye tel quel : 200', `recu ${tel.statut} ${tel.message}`);
    const sansMoyen = await cas(handler, 'PATCH', 'saisie', { id: 504, name: 'Groupe Essai bis', status: 'paid' });
    ok(sansMoyen.statut === 200 && sansMoyen.ecrit.maj.length === 1, 'dossier deja paye sans moyen envoye : 200', `recu ${sansMoyen.statut} ${sansMoyen.message}`);
    const man = await cas(handler, 'PATCH', 'manager', { id: 501, name: 'Groupe Essai', status: 'paid', paymentMethod: 'card' });
    ok(man.statut === 200 && man.ecrit.maj.length === 1, 'Manager (encaisser) passe a Paye par Modifier : 200', `recu ${man.statut} ${man.message}`);
    const seul = await cas(handler, 'PATCH', 'saisie', { id: 501, status: 'paid' });
    ok(seul.statut === 403 && aucuneEcriture(seul), 'chemin du statut seul, sans encaisser : 403 (garde existante)', `recu ${seul.statut}`);
  }

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[D] LE PRIX SE BORNE ENTRE 0 ET 100 000');
  {
    for (const prix of [-5, 100001, 'abc', 'Infinity']) {
      const r = await cas(handler, 'PATCH', 'manager', { id: 501, name: 'Groupe Essai', price: prix });
      ok(r.statut === 422 && /Prix invalide/.test(r.message) && aucuneEcriture(r), `prix ${JSON.stringify(prix)} : 422, rien n est ecrit`, `recu ${r.statut} ${r.message}`);
    }
    for (const prix of [0, 100000, '45.5']) {
      const r = await cas(handler, 'PATCH', 'manager', { id: 501, name: 'Groupe Essai', price: prix });
      ok(r.statut === 200 && r.ecrit.maj.length === 1, `prix ${JSON.stringify(prix)} : 200, ecrit`, `recu ${r.statut} ${r.message}`);
    }
    for (const [mot, corps] of [['null', { price: null }], ['vide', { price: '' }], ['absent', {}]]) {
      const r = await cas(handler, 'PATCH', 'manager', { id: 501, name: 'Groupe Essai', ...corps });
      ok(r.statut === 200 && r.ecrit.maj.length === 1, `prix ${mot} : le dossier garde le sien, 200`, `recu ${r.statut} ${r.message}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[E] SUPPRIMER : reservations.cancel (regression)');
  {
    const bar = await cas(handler, 'DELETE', 'staff-bar', { id: 501 });
    ok(bar.statut === 403 && !bar.ecrit.suppr.length, 'Staff bar supprime : 403, rien n est supprime', `recu ${bar.statut}`);
    const man = await cas(handler, 'DELETE', 'manager', { id: 501 });
    ok(man.statut === 200 && man.ecrit.suppr.length === 1, 'Manager supprime : 200', `recu ${man.statut} ${man.message}`);
  }

  // -------------------------------------------------------------------------
  console.log('');
  console.log('[F] CONTRE-EPREUVES : chaque garde retiree, le cas qu elle refusait passe');
  const contreEpreuves = [
    {
      nom: 'garde d annulation retiree : Staff bar annule',
      de: "      if (Object.prototype.hasOwnProperty.call(body, 'status')\n        && (String(body.status || '') === 'cancelled') !== (current.status === 'cancelled')) {",
      vers: '      if (false) {',
      appel: ['PATCH', 'staff-bar', { id: 501, status: 'cancelled' }],
    },
    {
      nom: 'garde d encaissement retiree : Saisie passe a Paye par Modifier',
      de: '      if (devientPaye || moyenChange) {',
      vers: '      if (false) {',
      appel: ['PATCH', 'saisie', { id: 501, name: 'Groupe Essai', status: 'paid', paymentMethod: 'card' }],
    },
    {
      nom: 'borne du prix retiree : prix -5 accepte',
      de: 'if (!Number.isFinite(prix) || prix < 0 || prix > 100000) throw',
      vers: 'if (false) throw',
      appel: ['PATCH', 'manager', { id: 501, name: 'Groupe Essai', price: -5 }],
    },
  ];
  for (const ce of contreEpreuves) {
    mutations = [{ fichier: 'api/staff-reservations.js', de: ce.de, vers: ce.vers }];
    let r;
    try {
      handler = chargerHandler();
      r = await cas(handler, ...ce.appel);
    } catch (error) {
      r = { statut: 0, message: error.message, ecrit: { statut: [], maj: [], suppr: [] } };
    }
    ok(r.statut === 200 && !aucuneEcriture(r), `${ce.nom} (le gate l aurait vu)`, `recu ${r.statut} ${r.message}`);
  }
  mutations = [];
  handler = chargerHandler();
  const retour = await cas(handler, 'PATCH', 'staff-bar', { id: 501, status: 'cancelled' });
  ok(retour.statut === 403, 'code d origine recharge : Staff bar a nouveau refuse', `recu ${retour.statut}`);

  console.log('');
  console.log(failures ? `GATE ROUGE : ${failures} echec(s)` : 'GATE VERT : les droits d une reservation tiennent cote serveur');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
