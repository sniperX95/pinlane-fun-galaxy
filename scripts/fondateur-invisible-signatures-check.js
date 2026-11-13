'use strict';
// LE FONDATEUR NE SIGNE NI UNE NOTE CLIENT, NI UN FAIT APPRIS, NI L INTERRUPTEUR DU FORMULAIRE, NI UN BILAN, NI
// UNE OUVERTURE (2026-11-13, lib/fondateur-invisible.js). Le volet « signatures » du gate
// test:fondateur-invisible : scripts/fondateur-invisible-check.js le lance.
//
// Ansar : « j ouvre quelque chose ou quoi, ca doit pas afficher que c est ouvert ou lu ou fait par
// fondateur Pinlane, moi personne doit me voir, mais les autres roles du centre oui ».
//
// Les vraies routes (api/ops.js : clientNotes, teachAgentFact, editAgentFact, forgetAgentFact,
// answerAgentQuestion, setEmbedState, saveDirectionReport ; api/staff-customer-notes.js) et les vraies
// ecritures de lib/assistant-memoire.js (les faits de l assistant) et de lib/ouverture-exceptionnelle.js. A la
// frontiere, des doubles NOTENT ce qui s ecrirait (la note, le fait, la configuration, le bilan) : la base
// n est jamais touchee. Pour chaque ecriture : le fondateur et sa session de secours ne signent pas, Marie
// (Direction) signe. Ce que l ecran montre : « Note client ... <nom> », « Appris par <nom> », « Modifié par
// <nom> », « Coupé le ... par <nom> », « édité par <nom> ».
//
// Contre-preuves (sauf --sans-contre-preuves) : chaque ecriture remise au nom de la session, en memoire (le
// disque n est jamais ecrit), fait rougir sa lettre.
// Zero base, zero reseau, rien ne part.
// Lancement : node scripts/fondateur-invisible-signatures-check.js [--sans-contre-preuves]
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.STAFF_AUTH_SECRET = 'gate-fondateur-signatures-secret-2026';

const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const MEMBRE = 'libramont:platform-owner';

let echecs = 0;
function ok(condition, message, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${!condition && detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
  if (!condition) echecs += 1;
  return Boolean(condition);
}

// ---------------------------------------------------------------------------
// La base : aucune ligne, sauf le nom actuel du membre fondateur (nomsDuFondateur).
// ---------------------------------------------------------------------------
class FauxClient {
  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s === 'select distinct name from staff_members where id like $1;') return params[0] === '%:platform-owner%' ? { rows: [{ name: NOM_ACTUEL }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }
  release() {}
}
class FauxPool {
  async connect() { return new FauxClient(); }
  query(sql, params) { return new FauxClient().query(sql, params); }
  on() {}
  end() {}
}
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, Client: FauxClient, types: { setTypeParser() {} } } };

// ---------------------------------------------------------------------------
// Les mutations, compilees en memoire.
// ---------------------------------------------------------------------------
let mutations = [];
const compilePrecedent = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const miennes = mutations.filter((e) => e.fichier === rel);
  if (!miennes.length) return compilePrecedent.call(this, contenu, nom);
  let mute = contenu.split('\r\n').join('\n');
  for (const { de, vers } of miennes) {
    if (mute.split(de).length !== 2) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compilePrecedent.call(this, mute, nom);
};

// ---------------------------------------------------------------------------
// Les doubles a la frontiere : ils notent ce qui s ecrirait.
// ---------------------------------------------------------------------------
const etat = { session: null, ecrit: [] };
const noter = (quoi, valeur) => { etat.ecrit.push({ quoi, ...valeur }); };
const dernier = (quoi) => etat.ecrit.filter((e) => e.quoi === quoi).slice(-1)[0] || null;

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
  return reel;
}
function purger() {
  Object.keys(require.cache).forEach((k) => {
    const rel = path.relative(ROOT, k);
    if (!rel.startsWith('..') && /^(lib|api)[\\/]/.test(rel)) delete require.cache[k];
  });
}

function monter(liste = []) {
  mutations = liste;
  purger();
  etat.ecrit = [];
  const auth = require(path.join(ROOT, 'lib/staff-auth.js'));
  const { sendError } = require(path.join(ROOT, 'lib/http.js'));
  remplacer('lib/staff-auth.js', {
    getStaffSessionFromRequest: async () => etat.session,
    // La vraie regle des droits, et la marque des reponses comme la vraie porte la pose.
    requireStaffPermission: async (req, res, permission, options = {}) => {
      const s = etat.session;
      if (!s || !auth.sessionHasPermission(s, permission)) { sendError(res, 403, 'Accès refusé.'); return null; }
      const F = require(path.join(ROOT, 'lib/fondateur-invisible.js'));
      if (res && typeof res === 'object') res.__nomsDuFondateur = F.estFondateur(s) ? null : await F.nomsDuFondateur();
      return { ...s, authorizedCenterId: options.centerId && options.centerId !== 'all' ? options.centerId : s.centerId };
    },
  });
  remplacer('lib/audit-log.js', { writeAuditLog: async () => ({}), writeAuditLogOrThrow: async () => ({}) });
  remplacer('lib/garde-serveur.js', { signalerPanneServeur: () => {} });
  remplacer('lib/ops-communications.js', {
    saveClientNote: async (centre, cle, corps, _r, options = {}) => { noter('note-ops', { updatedBy: options.updatedBy }); return { note: { body: corps, updatedBy: options.updatedBy, updatedAt: '2026-11-13T10:00:00.000Z' }, clientKey: cle }; },
  });
  remplacer('lib/customer-notes.js', {
    saveCustomerNote: async (entree) => { noter('note-fiche', { updatedBy: entree.updatedBy }); return { note: { body: entree.body, updatedBy: entree.updatedBy, updatedAt: '2026-11-13T10:00:00.000Z' }, versionId: 1, previousVersion: null }; },
  });
  remplacer('lib/database.js', {
    updateDirectionReportBody: async (entree) => { noter('bilan', { editedBy: entree.editedBy }); return { id: entree.id, editedBy: entree.editedBy, editedAt: '2026-11-13T10:00:00.000Z' }; },
    listAgentQuestions: async () => [],
    getInboundCommunication: async () => ({ id: 77, centerId: 'libramont', payload: { analysis: { question: 'Le parking est-il gratuit ?' } } }),
    marquerQuestionRepondue: async (entree) => { noter('question-repondue', { par: entree.par }); return { id: entree.communicationId }; },
  });
  remplacer('lib/center-config.js', { saveCenterConfigOverride: async (pool, centre, patch) => { noter('configuration', { patch }); return patch; } });
  remplacer('lib/ops-knowledge.js', { refreshCenterOverrides: async () => {} });
  remplacer('lib/email-agent.js', {
    apprendreUnFait: async (centre, entree) => { noter('fait-appris', { par: entree.par }); return { id: 5, question: entree.question, reponse: entree.reponse, par: entree.par }; },
    modifierUnFait: async (centre, entree) => { noter('fait-modifie', { par: entree.par }); return { id: entree.id, reponse: entree.reponse, par: entree.par }; },
    oublierUnFait: async (centre, entree) => { noter('fait-oublie', { par: entree.par }); return 1; },
    getFaitsAppris: async () => [],
    questionsProches: () => [],
    analyzeEmail: async () => ({}),
    compterResolutions: async () => {},
  });
  return {
    ops: require(path.join(ROOT, 'api/ops.js')),
    notes: require(path.join(ROOT, 'api/staff-customer-notes.js')),
    memoire: require(path.join(ROOT, 'lib/assistant-memoire.js')),
    ouverture: require(path.join(ROOT, 'lib/ouverture-exceptionnelle.js')),
  };
}

async function appeler(handler, methode, url, corps) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  req.method = methode;
  req.url = url;
  req.headers = { host: 'localhost', 'content-type': 'application/json' };
  const res = {
    statusCode: 200, entetes: {}, corps: '', headersSent: false, writableEnded: false,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    writeHead(s) { this.statusCode = s; return this; },
    end(b) { this.corps = String(b || ''); this.headersSent = true; this.writableEnded = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {}, brut: res.corps };
}

// ---------------------------------------------------------------------------
// Les personnes.
// ---------------------------------------------------------------------------
const personne = (id, nom, permissions = []) => ({ centerId: 'libramont', member: { id, name: nom }, role: { id: 'direction', name: 'Direction', locked: true }, permissions });
const MARIE = () => personne('libramont:direction-marie', 'Marie Dupont');
const FONDATEUR = () => personne(MEMBRE, NOM_ACTUEL, ['platform.admin']);
const SECOURS = () => personne(`${MEMBRE}-emergency`, NOM_DE_NAISSANCE, ['platform.admin']);
const QUI = [['Marie', MARIE, 'Marie Dupont'], ['le fondateur', FONDATEUR, ''], ['sa session de secours', SECOURS, '']];

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

// Une ecriture, faite par Marie, le fondateur et sa session de secours : seule Marie signe.
async function chacun(v, lettre, libelle, faire, lire) {
  const lus = [];
  for (const [, session] of QUI) {
    etat.session = session();
    let r = null;
    try { r = await faire(); } catch (error) { r = { erreur: error.message }; }
    lus.push({ r, signe: lire() });
  }
  const attendu = QUI.map(([, , nom]) => nom);
  const vus = lus.map((l) => l.signe);
  v(JSON.stringify(vus) === JSON.stringify(attendu), `${lettre} ${libelle} : Marie signe, ni le fondateur ni sa session de secours`, { vus, reponses: lus.map((l) => (l.r && l.r.statut) || (l.r && l.r.erreur) || 'ok') });
  return lus;
}

async function groupe(liste = []) {
  const { liste: rendus, v } = verdicts();
  const m = monter(liste);
  const ops = (corps) => appeler(m.ops, 'POST', '/api/ops', { centerId: 'libramont', ...corps });
  // [N] la note d un client, par la fiche et par la page Clients.
  const fiche = await chacun(v, '[N1]', 'la note client de la fiche (api/staff-customer-notes.js)',
    () => appeler(m.notes, 'PATCH', '/api/staff-customer-notes', { centerId: 'libramont', reservationId: 9201, body: 'Préfère la piste 3.', baseUpdatedAt: null }),
    () => (dernier('note-fiche') || {}).updatedBy);
  v(fiche.every((l) => l.r && l.r.statut === 200), '[N0] MONTAGE la fiche enregistre la note pour chacun', fiche.map((l) => l.r && l.r.statut));
  await chacun(v, '[N2]', 'la note client de la page Clients (api/ops.js clientNotes)',
    () => ops({ action: 'clientNotes', clientKey: 'tel:0470123456', body: 'Vient chaque mardi.' }),
    () => (dernier('note-ops') || {}).updatedBy);
  // [F] les faits appris de l agent des mails (« Appris par », « Modifié par »).
  await chacun(v, '[F1]', 'un fait appris d office (teachAgentFact)',
    () => ops({ action: 'teachAgentFact', question: 'Le parking est-il gratuit ?', reponse: 'Oui, devant le centre.' }),
    () => (dernier('fait-appris') || {}).par);
  await chacun(v, '[F4]', 'la question d un mail levee par un fait (answerAgentQuestion) : le fait',
    () => ops({ action: 'answerAgentQuestion', communicationId: 77, reponse: 'Oui, devant le centre.' }),
    () => (dernier('fait-appris') || {}).par);
  v(JSON.stringify(etat.ecrit.filter((e) => e.quoi === 'question-repondue').map((e) => e.par)) === JSON.stringify(['Marie Dupont', '', '']), '[F5] et la question du mail, « répondue par », ne le nomme pas non plus', etat.ecrit.filter((e) => e.quoi === 'question-repondue'));
  await chacun(v, '[F2]', 'un fait corrige (editAgentFact)',
    () => ops({ action: 'editAgentFact', id: 5, reponse: 'Oui, et gardé le soir.' }),
    () => (dernier('fait-modifie') || {}).par);
  await chacun(v, '[F3]', 'un fait oublie (forgetAgentFact)',
    () => ops({ action: 'forgetAgentFact', id: 5 }),
    () => (dernier('fait-oublie') || {}).par);
  // [I] l interrupteur du formulaire (« Coupé le ... par »).
  await chacun(v, '[I1]', 'l interrupteur du formulaire (setEmbedState)',
    () => ops({ action: 'setEmbedState', actif: false }),
    () => { const d = dernier('configuration'); return d && d.patch && d.patch.embed ? d.patch.embed.basculePar : 'absent'; });
  // [B] le bilan de direction (« édité par »).
  await chacun(v, '[B1]', 'le bilan de direction (saveDirectionReport) : « édité par direction » pour lui',
    () => ops({ action: 'saveDirectionReport', id: 3, bodyMd: 'Une bonne semaine.' }),
    () => { const d = dernier('bilan'); return d ? (d.editedBy === 'direction' ? '' : d.editedBy) : 'absent'; });
  // [A] les faits de l assistant (lib/assistant-memoire.js).
  const requetes = [];
  const q = async (sql, params) => { requetes.push(params); return { rows: [{ id: 9, texte: 'Le parking est gratuit.', origine: 'panneau', contexte: '', appris_par_nom: params[5] || '', modifie_par_nom: '', created_at: new Date() }] }; };
  await chacun(v, '[A1]', 'un fait appris par l assistant (ajouterFait, « Appris par »)',
    () => m.memoire.ajouterFait(q, { centerId: 'libramont', texte: 'Le parking est gratuit devant le centre.', origine: 'panneau', contexte: '', session: etat.session }),
    () => requetes[requetes.length - 1][5]);
  await chacun(v, '[A2]', 'un fait modifie (modifierFait, « Modifié par »)',
    () => m.memoire.modifierFait(q, { centerId: 'libramont', id: 9, texte: 'Le parking est gratuit, et gardé.', session: etat.session }),
    () => requetes[requetes.length - 1][3]);
  await chacun(v, '[A3]', 'un fait retire (retirerFait)',
    () => m.memoire.retirerFait(q, { centerId: 'libramont', id: 9, session: etat.session }),
    () => requetes[requetes.length - 1][2]);
  v(requetes.length === 9, '[A0] MONTAGE les trois ecritures des faits ont eu lieu pour chacun', requetes.length);
  // [O] l ouverture exceptionnelle d un jour.
  await chacun(v, '[O1]', 'l ouverture exceptionnelle (poserOuverture)',
    () => m.ouverture.poserOuverture({ pool: {}, centerId: 'libramont', session: etat.session, date: '2030-06-15', open: '10:00', close: '23:00', motif: 'Soirée privée', aujourdhui: '2030-06-01', lireLeJour: async () => ({ reservations: [] }), centre: () => ({ ouverturesExceptionnelles: [] }), rafraichir: async () => {} }),
    () => { const d = dernier('configuration'); const o = d && d.patch && Array.isArray(d.patch.ouverturesExceptionnelles) ? d.patch.ouverturesExceptionnelles[0] : null; return o ? o.par : 'absent'; });
  return rendus;
}

const GARDES = [
  { lettre: '[N1]', fichier: 'api/staff-customer-notes.js', de: "updatedBy: require('../lib/fondateur-invisible').signatureVisible(session, { avecId: false }) });", vers: "updatedBy: session.member?.name || '' });" },
  { lettre: '[N2]', fichier: 'api/ops.js', de: "{ baseUpdatedAt: body.baseUpdatedAt, updatedBy: signatureVisible(options.session, { avecId: false }) });", vers: "{ baseUpdatedAt: body.baseUpdatedAt, updatedBy: options.session?.member?.name || '' });" },
  { lettre: '[F1]', fichier: 'api/ops.js', de: "const fait = await apprendreUnFait(centre, { question: body.question, reponse: body.reponse, par: signatureVisible(options.session) });", vers: "const fait = await apprendreUnFait(centre, { question: body.question, reponse: body.reponse, par: options.session.member.name });" },
  { lettre: '[F4]', fichier: 'api/ops.js', de: "    const par = signatureVisible(options.session);\n    const { apprendreUnFait, analyzeEmail, getFaitsAppris, compterResolutions, questionsProches } = require('../lib/email-agent');", vers: "    const par = String(options.session.member.name || '');\n    const { apprendreUnFait, analyzeEmail, getFaitsAppris, compterResolutions, questionsProches } = require('../lib/email-agent');" },
  { lettre: '[F2]', fichier: 'api/ops.js', de: 'const fait = await modifierUnFait(centre, { id: body.id, reponse: body.reponse, par: signatureVisible(options.session) });', vers: 'const fait = await modifierUnFait(centre, { id: body.id, reponse: body.reponse, par: options.session.member.name });' },
  { lettre: '[F3]', fichier: 'api/ops.js', de: 'question: body.question, par: signatureVisible(options.session) });', vers: 'question: body.question, par: options.session.member.name });' },
  { lettre: '[I1]', fichier: 'api/ops.js', de: '        basculePar: signatureVisible(options.session),', vers: '        basculePar: options.session.member.name,' },
  { lettre: '[B1]', fichier: 'api/ops.js', de: "      editedBy: signatureVisible(options.session, { repli: 'direction' }),", vers: "      editedBy: options.session?.member?.name || options.session?.member?.id || 'direction'," },
  { lettre: '[A1]', fichier: 'lib/assistant-memoire.js', de: "String(membre.id || ''), nettoyer(require('./fondateur-invisible').signatureVisible(session, { avecId: false })).slice(0, 80)],", vers: "String(membre.id || ''), nettoyer(membre.name).slice(0, 80)]," },
  { lettre: '[A2]', fichier: 'lib/assistant-memoire.js', de: "    [Number(id) || 0, centerId, propre, nettoyer(require('./fondateur-invisible').signatureVisible(session, { avecId: false })).slice(0, 80)],", vers: '    [Number(id) || 0, centerId, propre, nettoyer(session && session.member && session.member.name).slice(0, 80)],' },
  { lettre: '[A3]', fichier: 'lib/assistant-memoire.js', de: "    [Number(id) || 0, centerId, nettoyer(require('./fondateur-invisible').signatureVisible(session, { avecId: false })).slice(0, 80)],", vers: '    [Number(id) || 0, centerId, nettoyer(session && session.member && session.member.name).slice(0, 80)],' },
  { lettre: '[O1]', fichier: 'lib/ouverture-exceptionnelle.js', de: "par: require('./fondateur-invisible').signatureVisible(session, { avecId: false }),", vers: 'par: String(session.member.name || \'\'),' },
];

(async () => {
  let liste;
  try { liste = await groupe([]); } catch (error) { liste = [{ ok: false, label: 'le banc s est arrete', detail: error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error) }]; }
  liste.forEach((x) => ok(x.ok, x.label, x.detail));
  if (!process.argv.includes('--sans-contre-preuves')) {
    console.log('\n[X] contre-preuves');
    for (const g of GARDES) {
      let rendus = [];
      try { rendus = await groupe([{ fichier: g.fichier, de: g.de, vers: g.vers }]); } catch (error) { rendus = [{ ok: false, label: 'exception', detail: error.message }]; }
      const lu = rendus.find((x) => x.label.startsWith(g.lettre));
      ok(Boolean(lu && !lu.ok), `contre-preuve « ${g.lettre} remis au nom de la session » : le gate ROUGIT`, lu ? '' : `lettre absente : ${JSON.stringify(rendus.filter((x) => !x.ok)).slice(0, 300)}`);
    }
    mutations = [];
  }
  if (echecs) { console.error(`\nfondateur-invisible-signatures: ${echecs} FAIL`); process.exit(1); }
  console.log('\nfondateur-invisible-signatures: ALL OK - note client, faits appris, interrupteur, bilan et ouverture : le fondateur ne signe rien, Marie oui.');
  process.exit(0);
})();
