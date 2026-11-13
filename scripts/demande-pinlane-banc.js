// LE BANC DE PINLANE DANS LES DEMANDES SUR MESURE (2026-11-13, v5 de la page des demandes).
//
// Le VRAI api/assistant.js (mode demande) et le VRAI api/ops.js (customRequestBook, sendDirectEmail, GET
// customRequests), le vrai moteur de la fenetre Reserver et la vraie lib/database.js, sur la base en memoire
// de scripts/slot-holds-check.js (vraies transactions, vraies reservations). Ce banc y ajoute :
//   - la table des demandes (custom_requests), rejouee requete par requete comme Postgres la rend, et la
//     lecture des mails recus d un client (communications) ;
//   - un faux Claude sur un port local, qui suit un scenario ecrit (aucun appel paye) ;
//   - des doubles a la frontiere : la session (une porte par centre, la VRAIE regle des droits
//     sessionHasPermission), le journal d audit, le cerveau des mails et la conversation du client, l envoi
//     d un mail, la confirmation d une reservation, l annonce au groupe de l equipe ;
//   - des mutations compilees en memoire pour les contre-preuves (le disque n est jamais touche).
// Zero base, zero reseau sortant, rien ne part.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
// La base en memoire et le faux 'pg' s installent au require.
const banc = require('./slot-holds-check.js');

// ---------------------------------------------------------------------------
// Les mutations, appliquees au chargement des fichiers vises.
// ---------------------------------------------------------------------------
let editions = [];
const chargerJs = Module._extensions['.js'];
Module._extensions['.js'] = function charger(m, f) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const miennes = editions.filter((e) => e.fichier === rel);
  if (!miennes.length) { chargerJs(m, f); return; }
  let texte = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  miennes.forEach((e) => {
    if (texte.split(e.de).length !== 2) throw new Error(`ancre absente ou multiple dans ${rel} : ${e.de.slice(0, 80)}`);
    texte = texte.split(e.de).join(e.vers);
  });
  m._compile(texte, f);
};

// ---------------------------------------------------------------------------
// L etat du banc : ce que les doubles notent, ce que le faux Claude doit repondre.
// ---------------------------------------------------------------------------
const etat = {};
function reinitialiser() {
  Object.assign(etat, {
    session: null,
    portes: [],
    audits: [],
    mails: [],
    lecons: [],
    confirmations: [],
    pannes: [],
    faits: [],
    conversation: [],
    client: null,
    appels: [],
    script: [],
    recus: new Map(),
    demandes: new Map(),
  });
}
reinitialiser();

const copie = (v) => JSON.parse(JSON.stringify(v));
const ligneDeDemande = (row) => ({ ...copie(row), created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) });

// LA TABLE DES DEMANDES, telle que lib/database.js l interroge (getCustomRequest, appendCustomRequestSuivi,
// updateCustomRequestStatus, listCustomRequests). Une requete inconnue sur cette table arrete le banc.
function sqlDesDemandes(s, p) {
  const une = (id) => etat.demandes.get(Number(id)) || null;
  const dansLeCentre = (row, centre) => Boolean(row) && (!centre || row.center_id === centre);
  if (s === "select * from custom_requests where id = $1 and ($2 = '' or center_id = $2);") {
    const row = une(p[0]);
    return dansLeCentre(row, p[1]) ? { rows: [ligneDeDemande(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s === "select payload from custom_requests where id = $1 and ($2 = '' or center_id = $2) for update;") {
    const row = une(p[0]);
    return dansLeCentre(row, p[1]) ? { rows: [{ payload: copie(row.payload || {}) }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (s === 'update custom_requests set payload = $2::jsonb where id = $1 returning *;') {
    const row = une(p[0]);
    if (!row) return { rows: [], rowCount: 0 };
    row.payload = JSON.parse(p[1]);
    row.updated_at = new Date().toISOString();
    return { rows: [ligneDeDemande(row)], rowCount: 1 };
  }
  if (s === "update custom_requests set status = $2 where id = $1 and ($3 = '' or center_id = $3) returning *;") {
    const row = une(p[0]);
    if (!dansLeCentre(row, p[2])) return { rows: [], rowCount: 0 };
    row.status = p[1];
    row.updated_at = new Date().toISOString();
    return { rows: [ligneDeDemande(row)], rowCount: 1 };
  }
  const liste = /^select \* from custom_requests (?:where (.+) )?order by created_at desc limit \$(\d+);$/.exec(s);
  if (liste) {
    const filtres = (liste[1] || '').split(' and ').filter(Boolean).map((f) => /^(center_id|status) = \$(\d+)$/.exec(f));
    if (filtres.some((f) => !f)) throw new Error(`SQL custom_requests non simulee : ${s.slice(0, 160)}`);
    const rows = [...etat.demandes.values()]
      .filter((row) => filtres.every(([, col, n]) => row[col] === p[Number(n) - 1]))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Number(p[Number(liste[2]) - 1]) || 100)
      .map(ligneDeDemande);
    return { rows, rowCount: rows.length };
  }
  if (/\bcustom_requests\b/.test(s)) throw new Error(`SQL custom_requests non simulee : ${s.slice(0, 160)}`);
  // Le dernier mail recu de chaque client (enrichirDemandes) : ce que le banc a pose dans etat.recus.
  if (s.startsWith('select lower(recipient) as email, max(created_at) as dernier from communications where center_id = $1')) {
    const rows = (Array.isArray(p[1]) ? p[1] : []).filter((email) => etat.recus.has(`${p[0]}|${email}`)).map((email) => ({ email, dernier: etat.recus.get(`${p[0]}|${email}`) }));
    return { rows, rowCount: rows.length };
  }
  return null;
}

const pg = require(require.resolve('pg', { paths: [ROOT] }));
const queryDuBanc = pg.Client.prototype.query;
pg.Client.prototype.query = async function (sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const reponse = sqlDesDemandes(s, params);
  if (reponse) return reponse;
  return queryDuBanc.call(this, sql, params);
};

// Une demande en base, dans la forme des colonnes.
function semerDemande(champs) {
  const maintenant = new Date().toISOString();
  const row = {
    id: champs.id, center_id: champs.centre || 'libramont', contact_name: champs.contactName || '', company: champs.company || '',
    email: champs.email || '', phone: champs.phone || '', requested_date: champs.requestedDate || '', pax: champs.pax || 0,
    occasion: champs.occasion || '', message: champs.message || '', source: 'client', status: champs.status || 'new',
    payload: copie(champs.payload || {}), created_at: champs.createdAt || maintenant, updated_at: maintenant,
  };
  etat.demandes.set(row.id, row);
  return row;
}

// ---------------------------------------------------------------------------
// Les doubles, poses sur les modules recharges, AVANT les deux handlers.
// ---------------------------------------------------------------------------
const CENTRES = [
  { id: 'libramont', name: 'Fun Galaxy Libramont', clientId: 'fun-galaxy' },
  { id: 'gembloux', name: 'Fun Galaxy Gembloux', clientId: 'fun-galaxy' },
  { id: 'etranger', name: 'Bowling d’ailleurs', clientId: 'autre-client' },
];
const SIGNATURE = 'Funement vôtre,\nL’équipe Fun Galaxy Libramont';
function cerveau() {
  const { consignesPourLAgent } = require(path.join(ROOT, 'lib/client-writing.js'));
  return {
    stable: [
      'Tu es l\'assistant de l\'équipe du centre de loisirs. Tu rédiges la réponse à une demande sur mesure d\'un groupe.',
      'Réponds uniquement en JSON conforme au schéma.',
      consignesPourLAgent(),
      `Signature à utiliser dans chaque réponse : ${SIGNATURE}`,
      '--- VOIX ---\nUn ton chaleureux et précis, le vouvoiement.',
    ].join('\n'),
    context: '--- FAITS DU CENTRE ---\nLe parking est gratuit devant le centre. Le centre est ouvert le samedi de 10 h à minuit.',
    lecons: '',
    signature: SIGNATURE,
    centerName: 'Fun Galaxy Libramont',
    overrides: {},
  };
}

function remplacer(relatif, surcharge) {
  const chemin = require.resolve(path.join(ROOT, relatif));
  const reel = require(chemin);
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: { ...reel, ...surcharge } };
  return reel;
}

function purger() {
  Object.keys(require.cache).forEach((k) => {
    const rel = path.relative(ROOT, k);
    if (!rel.startsWith('..') && /^(lib|api|assets)[\\/]/.test(rel)) delete require.cache[k];
  });
}

// `cerveauReel` : le vrai cerveau des mails (regles, voix, faits du centre lus dans le depot), pour le banc du
// vrai modele ; le gate garde un cerveau fixe, pour que ses verdicts ne dependent pas d un texte qui change.
function installerDoubles({ cerveauReel = false } = {}) {
  const auth = require(path.join(ROOT, 'lib/staff-auth.js'));
  const { sendError } = require(path.join(ROOT, 'lib/http.js'));
  // LA PORTE, CENTRE PAR CENTRE : une session ouvre les centres de son client (etat.session.centres), avec
  // la vraie regle des droits ; la reponse porte la marque des montants comme la vraie porte la pose.
  remplacer('lib/staff-auth.js', {
    getStaffSessionFromRequest: async () => etat.session,
    requireStaffPermission: async (req, res, permission, options = {}) => {
      const s = etat.session;
      if (!s) { sendError(res, 401, 'Session staff requise.'); return null; }
      const centre = options.centerId || s.centerId;
      etat.portes.push({ centre, permission: [].concat(permission).join('|') });
      if (!(s.centres || [s.centerId]).includes(centre) || !auth.sessionHasPermission(s, permission)) { sendError(res, 403, 'Accès refusé.'); return null; }
      const ouverte = { ...s, authorizedCenterId: centre };
      if (res && typeof res === 'object' && res.__montantsDuCatalogue !== true) res.__sansMontants = !auth.sessionHasPermission(ouverte, 'payments.view');
      return ouverte;
    },
  });
  remplacer('lib/audit-log.js', {
    writeAuditLog: async (entree) => { etat.audits.push(entree); return {}; },
    writeAuditLogOrThrow: async (entree) => { etat.audits.push(entree); return {}; },
  });
  remplacer('lib/center-scope.js', { listCentersForSession: async () => CENTRES });
  remplacer('lib/assistant-memoire.js', { faitsPourLeModele: async () => ({ faits: etat.faits.map((f) => ({ ...f })), ecartes: 0 }) });
  remplacer('lib/email-agent.js', {
    ...(cerveauReel ? {} : { buildEmailBrain: async () => cerveau() }),
    conversationAvecLeClient: async () => copie(etat.conversation),
    matchClient: async () => (etat.client ? copie(etat.client) : null),
    recordAgentLesson: async (lecon) => { etat.lecons.push(lecon); return {}; },
  });
  remplacer('lib/ops-communications.js', {
    sendDirectEmail: async (mail) => { etat.mails.push(mail); return { ok: true, communication: { id: 700 + etat.mails.length, status: 'sent' } }; },
    enqueueReservationCommunications: async () => [],
    dispatchDueCommunications: async () => ({ sent: 0 }),
    sendCustomRequestAck: async () => ({ skipped: true }),
  });
  remplacer('lib/ops-jobs.js', { enqueueReservationAutomation: async () => [] });
  // La confirmation au client part de afterReservationCreated, comme pour la fenetre Reserver : le double
  // note la reservation qu il aurait confirmee, et a quelle adresse.
  remplacer('lib/reservation-ops.js', { afterReservationCreated: async (r) => { etat.confirmations.push({ id: r.id, email: r.email || '' }); return { communications: [], warnings: [] }; } });
  remplacer('lib/garde-annonces.js', { annoncerReservation: async () => ({ ok: true }) });
  remplacer('lib/garde-serveur.js', { signalerPanneServeur: (surface, erreur) => { etat.pannes.push(`${surface} ${erreur && erreur.stack ? erreur.stack.split('\n').slice(0, 3).join(' | ') : erreur}`); } });
}

// Le banc monte pour un passage : le code (mute ou non) recharge, les doubles poses, les deux handlers.
let handlers = null;
function monter(liste = [], options = {}) {
  editions = liste;
  purger();
  installerDoubles(options);
  handlers = {
    assistant: require(path.join(ROOT, 'api/assistant.js')),
    ops: require(path.join(ROOT, 'api/ops.js')),
  };
  return handlers;
}
function demonter() {
  editions = [];
  handlers = null;
  purger();
}

// ---------------------------------------------------------------------------
// Le faux Claude : il note chaque requete et suit le scenario.
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PINLANE_DEMANDE_PINLANE_PORT || 5443);
const PORT_CLAUDE = PORT + 1;
process.env.ANTHROPIC_API_KEY = 'cle-de-banc';
process.env.ASSISTANT_BASE_URL = `http://127.0.0.1:${PORT_CLAUDE}`;

const texteP = (t) => ({ texte: t });
const outilP = (id, name, input) => ({ outil: { id, name, input: { pourquoi: 'Je vérifie pour ce groupe', ...input } } });
const pas = (blocs, stop = 'end_turn') => ({ blocs, stop });
const fin = (t) => pas([texteP(t)]);

const fauxClaude = http.createServer((req, res) => {
  let brut = '';
  req.on('data', (c) => { brut += c; });
  req.on('end', () => {
    const corps = JSON.parse(brut);
    etat.appels.push({ corps, url: req.url });
    // Un pas peut se calculer sur ce que le modele vient de recevoir (le prix de la carte, par exemple).
    const prochain = etat.script.shift();
    const suite = typeof prochain === 'function' ? prochain(corps) : prochain;
    if (!suite) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"invalid_request_error","message":"scenario epuise"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const dire = (type, donnees) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...donnees })}\n\n`);
    dire('message_start', { message: { id: `msg_${etat.appels.length}`, type: 'message', role: 'assistant', model: corps.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    suite.blocs.forEach((b, index) => {
      if (b.texte !== undefined) {
        dire('content_block_start', { index, content_block: { type: 'text', text: '' } });
        dire('content_block_delta', { index, delta: { type: 'text_delta', text: b.texte } });
      } else {
        dire('content_block_start', { index, content_block: { type: 'tool_use', id: b.outil.id, name: b.outil.name, input: {} } });
        dire('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.outil.input) } });
      }
      dire('content_block_stop', { index });
    });
    dire('message_delta', { delta: { stop_reason: suite.stop, stop_sequence: null }, usage: { output_tokens: 50 } });
    dire('message_stop', {});
    res.end();
  });
});

// La route de l assistant, servie en HTTP comme en production : le flux se lit evenement par evenement.
const serveur = http.createServer((req, res) => {
  if (!handlers) { res.statusCode = 503; res.end(); return; }
  handlers.assistant(req, res).catch((e) => { etat.pannes.push(`handler a jete ${e && e.stack}`); res.statusCode = 500; res.end(); });
});

async function demarrer() {
  await new Promise((r) => fauxClaude.listen(PORT_CLAUDE, '127.0.0.1', r));
  await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
}
function arreter() {
  fauxClaude.close();
  serveur.close();
}

function lireFlux(texte) {
  return texte.split('\n\n').filter((b) => b.startsWith('event: ')).map((b) => {
    const [ligne, donnees] = b.split('\n');
    return { type: ligne.slice(7), donnees: JSON.parse(donnees.slice(6)) };
  });
}

// POST /api/assistant, comme la page : le flux complet, ou la reponse JSON d un refus.
async function poser(corps) {
  const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
  const brut = await r.text();
  if (!/event-stream/.test(r.headers.get('content-type') || '')) {
    let json = {};
    try { json = JSON.parse(brut || '{}'); } catch (e) { json = { brut }; }
    return { statut: r.status, json, evenements: [], un: () => null, tous: () => [] };
  }
  const evenements = lireFlux(brut);
  return { statut: r.status, evenements, un: (t) => evenements.find((e) => e.type === t) || null, tous: (t) => evenements.filter((e) => e.type === t) };
}

// /api/ops, comme la console l appelle (POST avec action, ou GET avec ?action=).
async function ops(methode, url, corps) {
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
  await handlers.ops(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (e) { json = null; }
  return { statut: res.statusCode, json: json || {} };
}

// Les resultats d outils que le modele a recus dans sa n-ieme requete.
const resultatsOutils = (appel) => {
  const dernier = appel && appel.corps.messages[appel.corps.messages.length - 1];
  return (dernier && Array.isArray(dernier.content) ? dernier.content : []).filter((b) => b.type === 'tool_result');
};

module.exports = {
  ROOT, JOUR: banc.JOUR, base: banc.base, semer: banc.semer, etat, reinitialiser, semerDemande, monter, demonter,
  demarrer, arreter, poser, ops, texteP, outilP, pas, fin, resultatsOutils, CENTRES, SIGNATURE,
};
