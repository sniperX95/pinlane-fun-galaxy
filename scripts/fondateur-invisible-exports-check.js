'use strict';
// LES FICHIERS D UN CENTRE NE PORTENT RIEN DU FONDATEUR (2026-11-13, lib/fondateur-invisible.js). Le volet
// « fichiers » du gate test:fondateur-invisible : scripts/fondateur-invisible-check.js le lance.
//
// Ansar : « moi personne doit me voir, mais les autres roles du centre oui ». Un fichier part par res.end ou
// par mail, jamais par sendJson : la marque des reponses ne le voit pas. Trois fichiers, par leur vrai code :
//   [C] « Tout exporter » (GET /api/ops?action=exportComplet, lib/export-complet.js) : la base du centre ; a la
//       Direction, ni la ligne d equipe du fondateur, ni ses lectures, ni ses gestes au journal, ni son nom
//       sous une note ; au fondateur, tout
//   [J] le classeur du jour de la page Secours (GET /api/ops?action=classeurJour, lib/secours-api.js et
//       lib/export-excel.js) : les demandes du jour sans son nom
//   [E] le classeur qui part chaque jour a l adresse de secours du centre (lib/secours-envoi.js) : pareil
// Le classeur est remplace par un double qui note chaque ligne ecrite (lib/xlsx-writer.js) : on lit ce que le
// fichier contiendrait, sans le dezipper. La base est en memoire ; rien ne part.
//
// Contre-preuves (sauf --sans-contre-preuves) : chaque garde retiree en memoire fait rougir sa lettre.
// Lancement : node scripts/fondateur-invisible-exports-check.js [--sans-contre-preuves]
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|OPENROUTER|ANTHROPIC|OPENAI|BREVO|TELEGRAM)/i.test(nom)) delete process.env[nom];
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.STAFF_AUTH_SECRET = 'gate-fondateur-exports-secret-2026';

const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const NOM_ACTUEL = 'Ansar Pinlane';
const NOM_DE_NAISSANCE = 'Proprietaire plateforme';
const MEMBRE = 'libramont:platform-owner';
const JOUR = '2030-06-15';
const sansLui = (texte) => !String(texte).includes(NOM_ACTUEL) && !String(texte).includes(NOM_DE_NAISSANCE) && !String(texte).includes(':platform-owner');

let echecs = 0;
function ok(condition, message, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${!condition && detail ? `  ${String(detail).slice(0, 400)}` : ''}`);
  if (!condition) echecs += 1;
  return Boolean(condition);
}

// ---------------------------------------------------------------------------
// LA BASE : quelques tables du centre, des traces du fondateur a cote de celles de Marie.
// ---------------------------------------------------------------------------
const LE = (h) => `${JOUR}T${h}:00.000Z`;
const note = (t, par, h) => `[equipe] ${JSON.stringify({ t, par, le: LE(h) })}`;
const TABLES = {
  staff_members: [
    { id: MEMBRE, center_id: 'libramont', name: NOM_ACTUEL, role_id: 'direction', status: 'active' },
    { id: 'libramont:direction-marie', center_id: 'libramont', name: 'Marie Dupont', role_id: 'direction', status: 'active' },
  ],
  audit_log: [
    { id: 1, center_id: 'libramont', actor_member_id: MEMBRE, actor_label: NOM_ACTUEL, action: 'updateReservation' },
    { id: 2, center_id: 'libramont', actor_member_id: 'libramont:direction-marie', actor_label: 'Marie Dupont', action: 'ajouterNoteEquipe' },
  ],
  communication_reads: [
    { id: 1, center_id: 'libramont', communication_id: 7001, member_id: MEMBRE, member_name: NOM_ACTUEL },
    { id: 2, center_id: 'libramont', communication_id: 7001, member_id: 'libramont:direction-marie', member_name: 'Marie Dupont' },
  ],
  client_notes: [
    { id: 1, center_id: 'libramont', client_key: 'tel:0470123456', body: 'Préfère la piste 3.', updated_by: NOM_ACTUEL },
    { id: 2, center_id: 'libramont', client_key: 'tel:0470999888', body: 'Vient chaque mardi.', updated_by: 'Marie Dupont' },
  ],
  reservations: [{
    id: 9301, center_id: 'libramont', channel: 'staff', name: 'Groupe Léa', phone: '0470111222', email: '', date: JOUR, start_time: '15:00', duration: 1, total_duration: 1,
    lanes: [1], pax: 8, status: 'confirmed', base_price: 100, price: 100, type: 'bowling', label: 'Bowling', extras: [{ id: 'x1', name: 'Boissons × 8', price: 0, par: NOM_ACTUEL }],
    notes: ['Anniversaire de Léa.', note('Vérifier le prix', NOM_ACTUEL, '09:00'), note('Gâteau au frigo', 'Marie Dupont', '09:10')].join('\n'),
    activity_progress: { bowling: { done: true, doneAt: LE('10:00'), by: NOM_ACTUEL } }, ops_plan: { derniereModif: { le: LE('10:05'), par: NOM_ACTUEL, quoi: ['5 → 8 joueurs'] } },
    validation_status: 'confirmed', created_at: new Date(LE('08:00')), updated_at: new Date(LE('10:05')),
  }],
};
const DEMANDE = () => ({
  id: 61, centerId: 'libramont', contactName: 'Clément Lambert', email: 'clement@castors.be', createdAt: LE('08:00'), requestedDate: JOUR, status: 'in_progress', message: 'Une sortie d’équipe.',
  payload: { suivi: {
    historique: [{ type: 'prise-en-charge', le: LE('08:30'), par: NOM_ACTUEL }, { type: 'statut', le: LE('09:00'), par: 'Marie Dupont', statut: 'in_progress' }],
    notes: [{ type: 'note', le: LE('08:40'), par: NOM_ACTUEL, texte: 'Client exigeant sur les horaires' }, { type: 'note', le: LE('08:50'), par: 'Marie Dupont', texte: 'Rappeler mardi' }],
  } },
});

const copie = (v) => JSON.parse(JSON.stringify(v), (k, val) => (['created_at', 'updated_at'].includes(k) && val ? new Date(val) : val));
class FauxClient {
  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s === 'select distinct name from staff_members where id like $1;') return params[0] === '%:platform-owner%' ? { rows: [{ name: NOM_ACTUEL }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (s.startsWith('select table_name, column_name, ordinal_position from information_schema.columns')) {
      const rows = Object.entries(TABLES).flatMap(([table, lignes]) => Object.keys(lignes[0]).map((column_name, i) => ({ table_name: table, column_name, ordinal_position: i + 1 })));
      return { rows, rowCount: rows.length };
    }
    const table = /^select (.+) from "([a-z_]+)" where center_id = \$1 order by id$/.exec(s);
    if (table) {
      const cols = table[1].split(', ').map((c) => c.replace(/"/g, ''));
      const rows = copie(TABLES[table[2]] || []).filter((r) => r.center_id === params[0]).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      return { rows, rowCount: rows.length };
    }
    if (s === 'select name from centers where id = $1') return { rows: [{ name: 'Fun Galaxy Libramont' }], rowCount: 1 };
    if (s.startsWith('select * from reservations where center_id = $1 and date = $2')) {
      const rows = copie(TABLES.reservations).filter((r) => r.center_id === params[0] && r.date === params[1]);
      return { rows, rowCount: rows.length };
    }
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
// Les mutations en memoire, les doubles a la frontiere.
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

// Le classeur qui note : chaque feuille garde ses lignes, le « fichier » est leur JSON.
class ClasseurQuiNote {
  constructor() { this.feuilles = []; }
  ajouterFeuille(nom) {
    const notes = { nom, lignes: [] };
    this.feuilles.push(notes);
    const feuille = new Proxy(notes, { get: (cible, cle) => (cle in cible ? cible[cle] : (...args) => { cible.lignes.push(args); return feuille; }) });
    return feuille;
  }
  versBuffer() { return Buffer.from(JSON.stringify(this.feuilles)); }
}

const etat = { session: null, envois: [] };
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
  const auth = require(path.join(ROOT, 'lib/staff-auth.js'));
  const { sendError } = require(path.join(ROOT, 'lib/http.js'));
  remplacer('lib/staff-auth.js', {
    getStaffSessionFromRequest: async () => etat.session,
    requireStaffPermission: async (req, res, permission, options = {}) => {
      const s = etat.session;
      if (!s || !auth.sessionHasPermission(s, permission)) { sendError(res, 403, 'Accès refusé.'); return null; }
      const F = require(path.join(ROOT, 'lib/fondateur-invisible.js'));
      if (res && typeof res === 'object') {
        res.__sansMontants = !auth.sessionHasPermission(s, 'payments.view');
        res.__nomsDuFondateur = F.estFondateur(s) ? null : await F.nomsDuFondateur();
      }
      return { ...s, authorizedCenterId: options.centerId && options.centerId !== 'all' ? options.centerId : s.centerId };
    },
  });
  remplacer('lib/audit-log.js', { writeAuditLog: async () => ({}), writeAuditLogOrThrow: async () => ({}) });
  remplacer('lib/garde-serveur.js', { signalerPanneServeur: () => {} });
  remplacer('lib/xlsx-writer.js', { Classeur: ClasseurQuiNote });
  remplacer('lib/database.js', { listCustomRequests: async () => [DEMANDE()] });
  return {
    ops: require(path.join(ROOT, 'api/ops.js')),
    secours: require(path.join(ROOT, 'lib/secours-envoi.js')),
  };
}

async function obtenir(handler, url) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = { host: 'localhost' };
  const res = {
    statusCode: 200, entetes: {}, corps: null, headersSent: false, writableEnded: false,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    writeHead(s) { this.statusCode = s; return this; },
    end(b) { this.corps = b; this.headersSent = true; this.writableEnded = true; },
  };
  await handler(req, res);
  const texte = Buffer.isBuffer(res.corps) ? res.corps.toString('utf8') : String(res.corps || '');
  let feuilles = null;
  try { feuilles = JSON.parse(texte); } catch (e) { feuilles = null; }
  return { statut: res.statusCode, texte, feuilles: Array.isArray(feuilles) ? feuilles : [] };
}
const feuille = (r, nom) => (r.feuilles.find((f) => f.nom === nom) || { lignes: [] });
const texteDe = (f) => JSON.stringify(f.lignes);

const personne = (id, nom, permissions = []) => ({ centerId: 'libramont', member: { id, name: nom }, role: { id: 'direction', name: 'Direction', locked: true }, permissions });
const MARIE = () => personne('libramont:direction-marie', 'Marie Dupont');
const FONDATEUR = () => personne(MEMBRE, NOM_ACTUEL, ['platform.admin']);

function verdicts() {
  const liste = [];
  const v = (cond, label, detail = '') => { liste.push({ ok: Boolean(cond), label, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return Boolean(cond); };
  return { liste, v };
}

async function groupe(liste = []) {
  const { liste: rendus, v } = verdicts();
  const m = monter(liste);
  // [C] Tout exporter.
  etat.session = MARIE();
  let r = await obtenir(m.ops, '/api/ops?action=exportComplet&centerId=libramont');
  v(r.statut === 200 && r.feuilles.length > 1, '[C0] MONTAGE la Direction exporte la base du centre', `${r.statut} ${r.texte.slice(0, 160)}`);
  v(r.statut === 200 && sansLui(r.texte), '[C1] « Tout exporter » par la Direction : aucune trace du fondateur, aucune feuille', r.texte.slice(0, 300));
  v(texteDe(feuille(r, 'staff_members')).includes('Marie Dupont') && texteDe(feuille(r, 'audit_log')).includes('ajouterNoteEquipe') && texteDe(feuille(r, 'communication_reads')).includes('Marie Dupont')
    && texteDe(feuille(r, 'client_notes')).includes('Préfère la piste 3.') && texteDe(feuille(r, 'reservations')).includes('Vérifier le prix') && texteDe(feuille(r, 'reservations')).includes('Marie Dupont'),
  '[C2] ce que fait l equipe y reste : Marie, son geste au journal, sa lecture ; les textes des notes du fondateur aussi', r.texte.slice(0, 300));
  etat.session = FONDATEUR();
  r = await obtenir(m.ops, '/api/ops?action=exportComplet&centerId=libramont');
  v(r.statut === 200 && r.texte.includes(NOM_ACTUEL) && r.texte.includes(MEMBRE), '[C3] le fondateur, lui, exporte tout', r.texte.slice(0, 200));
  // [J] Le classeur du jour, page Secours.
  etat.session = MARIE();
  r = await obtenir(m.ops, `/api/ops?action=classeurJour&centerId=libramont&date=${JOUR}`);
  const demandes = texteDe(feuille(r, 'Demandes sur mesure'));
  v(r.statut === 200 && demandes.includes('Rappeler mardi') && demandes.includes('Client exigeant sur les horaires'), '[J0] MONTAGE le classeur du jour porte la demande et ses notes', `${r.statut} ${r.texte.slice(0, 200)}`);
  v(r.statut === 200 && sansLui(r.texte) && demandes.includes('Marie Dupont'), '[J1] le classeur du jour telecharge par la Direction : ni son nom ni ses traces ; Marie reste', demandes.slice(0, 300));
  etat.session = FONDATEUR();
  r = await obtenir(m.ops, `/api/ops?action=classeurJour&centerId=libramont&date=${JOUR}`);
  v(r.statut === 200 && texteDe(feuille(r, 'Demandes sur mesure')).includes(NOM_ACTUEL), '[J2] le fondateur, lui, y lit son nom', texteDe(feuille(r, 'Demandes sur mesure')).slice(0, 200));
  // [E] Le classeur envoye chaque jour a l adresse de secours du centre (8 h).
  etat.envois = [];
  const { mapReservation } = require(path.join(ROOT, 'lib/database.js'));
  const deps = {
    lireEtat: async () => ({}),
    ecrireEtat: async () => {},
    lireJournee: async () => ({ reservations: copie(TABLES.reservations).map(mapReservation), demandes: [DEMANDE()] }),
    formules: () => ({}),
    envoyer: async (mail) => { etat.envois.push(mail); return { id: `m${etat.envois.length}` }; },
  };
  await m.secours.lancerSecours({ centres: [{ id: 'libramont', name: 'Fun Galaxy Libramont', secours: { emails: ['secours@fungalaxy.be'] } }], instant: new Date(`${JOUR}T08:05:00+02:00`), env: {}, deps });
  const pieces = etat.envois.flatMap((e) => (e.attachments || []).filter((a) => /\.xlsx$/.test(a.filename)).map((a) => Buffer.isBuffer(a.contenu) ? a.contenu.toString('utf8') : String(a.contenu || '')));
  v(pieces.length >= 1 && pieces.every((p) => p.includes('Rappeler mardi')), '[E0] MONTAGE le mail de 8 h part avec le classeur du jour', `${etat.envois.length} envoi(s), ${pieces.length} classeur(s)`);
  v(pieces.length >= 1 && pieces.every((p) => sansLui(p) && p.includes('Marie Dupont')), '[E1] le classeur envoye a l adresse de secours du centre : sans lui ; Marie reste', pieces.join(' ').slice(0, 300));
  return rendus;
}

const GARDES = [
  { lettre: '[C1]', fichier: 'lib/export-complet.js', de: "const lignes = sansFondateur ? require('./fondateur-invisible').masquerFondateur(lues, sansFondateur) : lues;", vers: 'const lignes = lues;' },
  { lettre: '[C1]', fichier: 'api/ops.js', de: ", sansFondateur: res.__nomsDuFondateur || null });", vers: ' });' },
  { lettre: '[J1]', fichier: 'api/ops.js', de: '      sansFondateur: res.__nomsDuFondateur || null,\n', vers: '' },
  { lettre: '[J1]', fichier: 'lib/secours-api.js', de: 'genereLe: new Date(), sansFondateur }),', vers: 'genereLe: new Date() }),' },
  { lettre: '[J1]', fichier: 'lib/export-excel.js', de: "const sansLui = (v) => (sansFondateur ? require('./fondateur-invisible').masquerFondateur(v, sansFondateur) : v);", vers: 'const sansLui = (v) => v;' },
  { lettre: '[E1]', fichier: 'lib/secours-envoi.js', de: "const sansFondateur = await require('./fondateur-invisible').nomsDuFondateur();", vers: 'const sansFondateur = null;' },
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
      ok(Boolean(lu && !lu.ok), `contre-preuve « ${g.fichier} sans sa garde » : le gate ROUGIT (${g.lettre} rougit)`, lu ? '' : `lettre absente : ${JSON.stringify(rendus.filter((x) => !x.ok)).slice(0, 300)}`);
    }
    mutations = [];
  }
  if (echecs) { console.error(`\nfondateur-invisible-exports: ${echecs} FAIL`); process.exit(1); }
  console.log('\nfondateur-invisible-exports: ALL OK - « Tout exporter » et le classeur du jour ne portent rien du fondateur pour un centre.');
  process.exit(0);
})();
