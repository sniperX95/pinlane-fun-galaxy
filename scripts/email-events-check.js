// LES EVENEMENTS DU FOURNISSEUR D ENVOI ATTEIGNENT LA LIGNE DU MAIL (2026-09-16).
//
// POURQUOI CE GATE EXISTE. La page Emails disait « envoye » et plus rien : le
// webhook acquittait sent, delivered, opened, clicked, bounced, complained sans
// les lire. Ce gate prouve, sur le VRAI handler (api/inbound-email.js) et le
// VRAI module d enregistrement (lib/email-events.js), avec une base en memoire
// et un reseau qui n existe pas :
//
//   [A] un evenement NON SIGNE est refuse en 401, rien n est ecrit ;
//   [B] email.sent signe est enregistre (200, recorded) et donne au mail son
//       Message-ID ;
//   [C] une RELIVRAISON (meme svix-id) repond deduped et ne touche AUCUN
//       compteur ; sans la clause de conflit, le moteur leverait ;
//   [D] delivered pose delivered_at et fait passer sent -> delivered ;
//   [E] deux ouvertures distinctes font open_count = 2, opened_at = la premiere ;
//   [F] un clic garde le lien, le navigateur et l heure, JAMAIS l adresse IP ;
//   [G] un rebond passe le mail en failed avec une raison lisible ;
//   [H] une plainte inscrit l adresse en suppression marketing (source
//       complaint), bornee au centre du mail ;
//   [I] un email_id inconnu est garde (evenement sans message : le webhook parle) ;
//   [J] failed passe un mail en attente en echec ;
//   [K] un type inconnu est ignore, un mail recu part toujours a l ingestion ;
//   [L] une panne interne repond 503 (le fournisseur reessaie, l operation
//       est idempotente).
//
// CONTRE-EPREUVES par mutation compilee en memoire (crochet
// Module.prototype._compile, disque jamais touche, ancre absente = erreur).
//
// Usage : node scripts/email-events-check.js
'use strict';
const crypto = require('crypto');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
process.env.DATABASE_URL = 'postgres://gate/gate';
process.env.DATABASE_SSL = 'disable';
const SECRET_WEBHOOK = `whsec_${Buffer.from('cle-de-signature-des-evenements-2026').toString('base64')}`;
process.env.RESEND_WEBHOOK_SECRET = SECRET_WEBHOOK;
delete process.env.INBOUND_EMAIL_SECRET;

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// La signature, ecrite d apres la specification (jamais importee du code mesure).
function signer(corps, { id = `svix_${crypto.randomUUID()}`, secret = SECRET_WEBHOOK } = {}) {
  const horodatage = Math.floor(Date.now() / 1000);
  const cle = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signature = crypto.createHmac('sha256', cle).update(`${id}.${horodatage}.${corps}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(horodatage), 'svix-signature': `v1,${signature}` };
}

// ---------------------------------------------------------------------------
// LA BASE EN MEMOIRE : nos envois, les evenements, la liste de suppression.
// Le moteur OBEIT AU TEXTE des requetes (clause de conflit, borne de sens,
// statut du rebond) pour que les contre-epreuves puissent rougir.
// ---------------------------------------------------------------------------
const DB = { communications: [], email_events: [], marketing_suppressions: [] };
let PANNE = false;
let SEQ = 0;
const lignes = (rows) => ({ rows, rowCount: rows.length });
const clone = (row) => JSON.parse(JSON.stringify(row));
function reset() {
  DB.communications = [
    { id: 1, center_id: 'libramont', direction: 'outbound', status: 'sent', recipient: 'Marie@exemple.be', provider_message_id: 'resend-1', message_id: null, delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, bounced_at: null, complained_at: null, last_error: '', created_at: '2026-09-16T10:00:00.000Z' },
    { id: 2, center_id: 'libramont', direction: 'outbound', status: 'queued', recipient: 'paul@exemple.be', provider_message_id: 'resend-2', message_id: null, delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, bounced_at: null, complained_at: null, last_error: '', created_at: '2026-09-16T10:01:00.000Z' },
    { id: 3, center_id: 'gembloux', direction: 'outbound', status: 'sent', recipient: 'lea@exemple.be', provider_message_id: 'resend-3', message_id: null, delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, bounced_at: null, complained_at: null, last_error: '', created_at: '2026-09-16T10:02:00.000Z' },
    // Un mail RECU qui porte, par collision, le meme identifiant fournisseur
    // qu un envoi : seul le SENS distingue les deux, et l evenement ne doit
    // jamais toucher le mail recu.
    { id: 4, center_id: 'libramont', direction: 'inbound', status: 'received', recipient: 'marie@exemple.be', provider_message_id: 'resend-1', message_id: '<q@gmail.com>', delivered_at: null, opened_at: null, open_count: 0, clicked_at: null, click_count: 0, bounced_at: null, complained_at: null, last_error: '', created_at: '2026-09-16T11:00:00.000Z' },
  ];
  DB.email_events = [];
  DB.marketing_suppressions = [];
  PANNE = false;
  SEQ = 0;
}
const trouver = (id) => DB.communications.find((c) => c.id === Number(id));

async function requete(texte, params = []) {
  if (PANNE) throw new Error('connection terminated unexpectedly');
  const sql = String(texte).replace(/\s+/g, ' ').trim();
  const p = params || [];
  if (/^select id, center_id, status, recipient from communications where provider_message_id = \$1/i.test(sql)) {
    const borne = /direction = 'outbound'/.test(sql);
    return lignes(DB.communications
      .filter((c) => c.provider_message_id === p[0] && (!borne || c.direction === 'outbound'))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 1).map(clone));
  }
  if (/^insert into email_events/i.test(sql)) {
    const doublon = DB.email_events.some((e) => e.event_key === p[3]);
    if (doublon) {
      if (/on conflict \(event_key\) do nothing/i.test(sql)) return lignes([]);
      const erreur = new Error('duplicate key value violates unique constraint "email_events_key_idx"');
      erreur.code = '23505';
      throw erreur;
    }
    SEQ += 1;
    const row = { id: SEQ, center_id: p[0], communication_id: p[1], provider_email_id: p[2], event_key: p[3], event_type: p[4], occurred_at: p[5], data: JSON.parse(p[6] || '{}') };
    DB.email_events.push(row);
    return lignes([{ id: row.id }]);
  }
  if (/^update communications set message_id = \$2 where id = \$1/i.test(sql)) {
    const c = trouver(p[0]);
    if (c && !c.message_id) c.message_id = p[1];
    return lignes([]);
  }
  if (/^update communications set delivered_at = coalesce\(delivered_at, \$2::timestamptz\)/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) { c.delivered_at = c.delivered_at || p[1]; if (c.status === 'sent') c.status = 'delivered'; }
    return lignes([]);
  }
  if (/^update communications set opened_at = coalesce\(opened_at, \$2::timestamptz\), open_count = open_count \+ 1/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) { c.opened_at = c.opened_at || p[1]; c.open_count += 1; }
    return lignes([]);
  }
  if (/^update communications set clicked_at = coalesce\(clicked_at, \$2::timestamptz\), click_count = click_count \+ 1/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) { c.clicked_at = c.clicked_at || p[1]; c.click_count += 1; }
    return lignes([]);
  }
  if (/^update communications set bounced_at = coalesce\(bounced_at, \$2::timestamptz\)/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) {
      c.bounced_at = c.bounced_at || p[1];
      if (/status = case when status in \('sent', 'delivered'\) then 'failed' else status end/.test(sql) && ['sent', 'delivered'].includes(c.status)) c.status = 'failed';
      c.last_error = p[2];
    }
    return lignes([]);
  }
  if (/^update communications set complained_at = coalesce\(complained_at, \$2::timestamptz\)/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) c.complained_at = c.complained_at || p[1];
    return lignes([]);
  }
  if (/^insert into marketing_suppressions/i.test(sql)) {
    if (!DB.marketing_suppressions.some((s) => s.center_id === p[0] && s.email === String(p[1]).toLowerCase())) {
      DB.marketing_suppressions.push({ center_id: p[0], email: p[1], source: /'complaint'/.test(sql) ? 'complaint' : 'inconnu', reason: p[2] });
    }
    return lignes([]);
  }
  if (/^update communications set status = case when status in \('sent', 'delivered', 'queued', 'processing'\) then 'failed' else status end/i.test(sql)) {
    const c = trouver(p[0]);
    if (c) { if (['sent', 'delivered', 'queued', 'processing'].includes(c.status)) c.status = 'failed'; c.last_error = p[1]; }
    return lignes([]);
  }
  throw new Error(`requete non reconnue par le gate : ${sql.slice(0, 100)}`);
}

class FakePool {
  async query(texte, params) { return requete(texte, params); }
  async connect() { return { query: (texte, params) => requete(texte, params), release() {} }; }
  on() {}
  async end() {}
}
const pgResolu = require.resolve('pg', { paths: [ROOT] });
require.cache[pgResolu] = { id: pgResolu, filename: pgResolu, loaded: true, exports: { Pool: FakePool } };
global.fetch = async () => { throw new Error('reseau interdit dans ce gate'); };

// ---------------------------------------------------------------------------
// MUTATIONS COMPILEES EN MEMOIRE.
// ---------------------------------------------------------------------------
const MUTABLES = ['lib/email-events.js', 'api/inbound-email.js'];
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function compileMute(contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};
function charger() {
  for (const rel of MUTABLES) delete require.cache[require.resolve(path.join(ROOT, rel))];
  const webhook = require(path.join(ROOT, 'api/inbound-email.js'));
  const evenements = require(path.join(ROOT, 'lib/email-events.js'));
  return { webhook, evenements };
}

// Un appel HTTP au VRAI handler (enregistrement par defaut : la base du
// produit, ici le FakePool), l ingestion remplacee par un espion.
async function appeler(m, { corps, entetes = {} }) {
  const appels = [];
  const handler = m.webhook.createHandler({
    ingest: async (args) => { appels.push(args); return { communication: { id: 99 }, deduped: false }; },
    recupererContenu: async () => ({ text: 'Bonjour', html: '', headers: {} }),
  });
  const req = Object.assign(Readable.from([corps]), { method: 'POST', url: '/api/inbound-email', headers: { host: 'app.pinlane.be', 'content-type': 'application/json', ...entetes } });
  let rendu = '';
  const res = { statusCode: 0, setHeader() {}, end(chunk) { rendu = String(chunk || ''); } };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(rendu); } catch (error) { json = { brut: rendu }; }
  return { statut: res.statusCode, corps: json, appels };
}
// L instant de l evenement est celui que le fournisseur ecrit en tete de
// l enveloppe (created_at), repris aussi dans data.created_at.
function evenement(type, data, extra = {}) {
  const createdAt = (data && data.created_at) || '2026-09-16T12:00:00.000Z';
  return JSON.stringify({ type, created_at: createdAt, data: { email_id: 'resend-1', created_at: createdAt, ...data }, ...extra });
}
async function livrer(m, type, data = {}, options = {}) {
  const corps = evenement(type, data);
  return appeler(m, { corps, entetes: signer(corps, options) });
}

(async () => {
  reset();
  let m = charger();
  ok(DB.communications[0].status === 'sent' && DB.communications[0].open_count === 0 && DB.email_events.length === 0,
    '[montage] un envoi « sent » sans aucun evenement, aucune ouverture');

  // =====================================================================
  console.log('\n[A] un evenement non signe est refuse');
  // =====================================================================
  const nonSigne = await appeler(m, { corps: evenement('email.delivered', {}), entetes: {} });
  ok(nonSigne.statut === 401 && DB.email_events.length === 0 && !DB.communications[0].delivered_at, '[A] 401, rien n est ecrit', `HTTP ${nonSigne.statut}`);
  const mauvaisSecret = await livrer(m, 'email.delivered', {}, { secret: `whsec_${Buffer.from('autre').toString('base64')}` });
  ok(mauvaisSecret.statut === 401 && DB.email_events.length === 0, '[A] une signature d un autre secret est refusee', `HTTP ${mauvaisSecret.statut}`);

  // =====================================================================
  console.log('\n[B][C] sent : Message-ID, puis relivraison dedupliquee');
  // =====================================================================
  const sent = await livrer(m, 'email.sent', { message_id: '<conf-1@fungalaxy.be>' }, { id: 'svix-sent-1' });
  ok(sent.statut === 200 && sent.corps.ok === true && sent.corps.recorded === 'sent' && sent.corps.deduped === false && sent.appels.length === 0,
    '[B] email.sent signe : 200, recorded, rien n est ingere comme un mail recu', JSON.stringify(sent.corps));
  ok(DB.email_events.length === 1 && DB.email_events[0].communication_id === 1 && DB.email_events[0].center_id === 'libramont' && DB.email_events[0].event_key === 'svix-sent-1',
    '[B] l evenement est ecrit, rattache au mail et a son centre, cle = svix-id', JSON.stringify(DB.email_events[0]));
  ok(trouver(1).message_id === '<conf-1@fungalaxy.be>', '[B] le mail recoit son Message-ID', trouver(1).message_id);
  ok(trouver(4).message_id === '<q@gmail.com>', '[B] le mail RECU qui partage l identifiant fournisseur n est pas touche (borne de sens)');
  const rejoue = await livrer(m, 'email.sent', { message_id: '<autre@fungalaxy.be>' }, { id: 'svix-sent-1' });
  ok(rejoue.statut === 200 && rejoue.corps.deduped === true && DB.email_events.length === 1 && trouver(1).message_id === '<conf-1@fungalaxy.be>',
    '[C] la meme livraison rejouee : deduped, un seul evenement, rien ne change', JSON.stringify(rejoue.corps));

  // =====================================================================
  console.log('\n[D][E][F] delivered, opened x2, clicked');
  // =====================================================================
  const delivered = await livrer(m, 'email.delivered', { created_at: '2026-09-16T12:00:05.000Z' }, { id: 'svix-del-1' });
  ok(delivered.statut === 200 && trouver(1).status === 'delivered' && trouver(1).delivered_at === '2026-09-16T12:00:05.000Z',
    '[D] delivered : delivered_at pose, statut sent -> delivered', JSON.stringify({ statut: trouver(1).status, delivered_at: trouver(1).delivered_at }));
  await livrer(m, 'email.opened', { created_at: '2026-09-16T12:10:00.000Z' }, { id: 'svix-open-1' });
  await livrer(m, 'email.opened', { created_at: '2026-09-16T12:30:00.000Z' }, { id: 'svix-open-2' });
  const rejoueOuverture = await livrer(m, 'email.opened', { created_at: '2026-09-16T12:30:00.000Z' }, { id: 'svix-open-2' });
  ok(trouver(1).open_count === 2 && trouver(1).opened_at === '2026-09-16T12:10:00.000Z' && rejoueOuverture.corps.deduped === true,
    '[E] deux ouvertures distinctes -> open_count 2, opened_at = la premiere ; la relivraison ne compte pas', JSON.stringify({ open_count: trouver(1).open_count, opened_at: trouver(1).opened_at }));
  const clic = await livrer(m, 'email.clicked', { created_at: '2026-09-16T12:31:00.000Z', click: { link: 'https://app.pinlane.be/r?k=abc', ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone)', timestamp: '2026-09-16T12:31:00.000Z' } }, { id: 'svix-click-1' });
  const evenementClic = DB.email_events.find((e) => e.event_type === 'clicked');
  ok(clic.statut === 200 && trouver(1).click_count === 1 && trouver(1).clicked_at === '2026-09-16T12:31:00.000Z',
    '[F] clicked : click_count 1, clicked_at pose');
  ok(Boolean(evenementClic) && evenementClic.data.link === 'https://app.pinlane.be/r?k=abc' && /iPhone/.test(evenementClic.data.userAgent) && evenementClic.data.timestamp === '2026-09-16T12:31:00.000Z'
    && !JSON.stringify(evenementClic.data).includes('203.0.113.9') && !('ipAddress' in evenementClic.data),
    '[F] le clic garde le lien, le navigateur et l heure, JAMAIS l adresse IP', JSON.stringify(evenementClic && evenementClic.data));

  // =====================================================================
  console.log('\n[G][H][I][J][M] bounced, complained, inconnu, failed, delayed');
  // =====================================================================
  const bounce = await livrer(m, 'email.bounced', { email_id: 'resend-3', bounce: { type: 'Permanent', subType: 'General', message: 'The recipient address does not exist' } }, { id: 'svix-bounce-3' });
  ok(bounce.statut === 200 && trouver(3).status === 'failed' && /^Adresse en erreur \(bounce\)/.test(trouver(3).last_error) && /does not exist/.test(trouver(3).last_error) && trouver(3).bounced_at,
    '[G] bounced : le mail de Gembloux passe en failed avec une raison lisible', trouver(3).last_error);
  const plainte = await livrer(m, 'email.complained', {}, { id: 'svix-complaint-1' });
  ok(plainte.statut === 200 && trouver(1).complained_at && DB.marketing_suppressions.length === 1
    && DB.marketing_suppressions[0].center_id === 'libramont' && DB.marketing_suppressions[0].email === 'marie@exemple.be' && DB.marketing_suppressions[0].source === 'complaint',
    '[H] complained : complained_at, et l adresse (minuscule) entre en suppression marketing du centre, source complaint', JSON.stringify(DB.marketing_suppressions[0]));
  const inconnu = await livrer(m, 'email.delivered', { email_id: 'resend-qui-n-existe-pas' }, { id: 'svix-orphan-1' });
  const orphelin = DB.email_events.find((e) => e.event_key === 'svix-orphan-1');
  ok(inconnu.statut === 200 && inconnu.corps.recorded === 'delivered' && Boolean(orphelin) && orphelin.communication_id === null && orphelin.center_id === '',
    '[I] un email_id inconnu : l evenement est garde sans message ni centre (le webhook parle)', JSON.stringify(orphelin));
  const echec = await livrer(m, 'email.failed', { email_id: 'resend-2', failed: { reason: 'Domain not verified' } }, { id: 'svix-failed-2' });
  ok(echec.statut === 200 && trouver(2).status === 'failed' && /Domain not verified/.test(trouver(2).last_error),
    '[J] failed : un mail en attente passe en echec avec la raison du fournisseur', trouver(2).last_error);
  const avant = clone(trouver(1));
  const retard = await livrer(m, 'email.delivery_delayed', {}, { id: 'svix-delay-1' });
  ok(retard.statut === 200 && retard.corps.recorded === 'delivery_delayed' && JSON.stringify(clone(trouver(1))) === JSON.stringify(avant) && DB.email_events.some((e) => e.event_type === 'delivery_delayed'),
    '[M] delivery_delayed : garde comme evenement, aucune colonne du mail ne bouge');

  // =====================================================================
  console.log('\n[K] un type inconnu est ignore, un mail recu part a l ingestion');
  // =====================================================================
  const nbAvant = DB.email_events.length;
  const contact = await livrer(m, 'contact.created', {}, { id: 'svix-contact-1' });
  ok(contact.statut === 200 && contact.corps.ignored === 'contact.created' && DB.email_events.length === nbAvant && contact.appels.length === 0,
    '[K] contact.created : ignore en 200, rien n est ecrit', JSON.stringify(contact.corps));
  const recu = JSON.stringify({ type: 'email.received', data: { email_id: 'in-1', from: 'marie@exemple.be', subject: 'Question', to: ['libramont@inbound.pinlane.be'], received_for: ['libramont@inbound.pinlane.be'] } });
  const reception = await appeler(m, { corps: recu, entetes: signer(recu) });
  ok(reception.statut === 200 && reception.appels.length === 1 && reception.appels[0].centerId === 'libramont' && DB.email_events.length === nbAvant,
    '[K] contraste : email.received part a l ingestion, sans creer d evenement', `HTTP ${reception.statut}, ${reception.appels.length} ingestion(s)`);

  // =====================================================================
  console.log('\n[L] une panne interne repond 503');
  // =====================================================================
  PANNE = true;
  const panne = await livrer(m, 'email.delivered', {}, { id: 'svix-panne-1' });
  PANNE = false;
  ok(panne.statut === 503 && !JSON.stringify(panne.corps).includes('connection terminated'),
    '[L] base en panne : 503 pour que le fournisseur reessaie, sans le detail technique', `HTTP ${panne.statut} ${JSON.stringify(panne.corps)}`);
  const cle = m.evenements.cleDEvenement({}, 'email.opened', { email_id: 'x', created_at: 't' });
  ok(/^[0-9a-f]{64}$/.test(cle) && cle === m.evenements.cleDEvenement({}, 'email.opened', { email_id: 'x', created_at: 't' }) && m.evenements.cleDEvenement({ 'svix-id': 'msg_1' }, 'x', {}) === 'msg_1',
    '[L] la cle d evenement : svix-id si present, sinon une empreinte stable');

  // =====================================================================
  console.log('\n[mutation] contre-epreuves (le gate ROUGIRAIT sans chaque garde)');
  // =====================================================================
  const contreEpreuves = [
    {
      nom: 'la clause de conflit disparait : une relivraison fait lever la base',
      fichier: 'lib/email-events.js',
      de: '     on conflict (event_key) do nothing',
      vers: '',
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.sent', { message_id: '<a@b>' }, { id: 'svix-x' }); return livrer(mm, 'email.sent', { message_id: '<a@b>' }, { id: 'svix-x' }); },
      rouge: (r) => r.statut !== 200 || r.corps.deduped !== true,
    },
    {
      nom: 'une relivraison touche encore les compteurs',
      fichier: 'lib/email-events.js',
      de: '  if (!inseree) return { ok: true, deduped: true, communicationId, type: t };',
      vers: '  if (false) return { ok: true, deduped: true, communicationId, type: t };',
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.opened', {}, { id: 'svix-o' }); await livrer(mm, 'email.opened', {}, { id: 'svix-o' }); return trouver(1).open_count; },
      rouge: (n) => n !== 1,
    },
    {
      nom: 'le clic garde l adresse IP',
      fichier: 'lib/email-events.js',
      de: '      link: court(clic.link, 500),',
      vers: '      link: court(clic.link, 500), ipAddress: clic.ipAddress,',
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.clicked', { click: { link: 'https://x', ipAddress: '203.0.113.9', userAgent: 'ua', timestamp: 't' } }, { id: 'svix-c' }); return DB.email_events[0].data; },
      rouge: (data) => JSON.stringify(data).includes('203.0.113.9'),
    },
    {
      nom: 'un rebond ne met plus le mail en echec',
      fichier: 'lib/email-events.js',
      de: "       set bounced_at = coalesce(bounced_at, $2::timestamptz),\n           status = case when status in ('sent', 'delivered') then 'failed' else status end,",
      vers: '       set bounced_at = coalesce(bounced_at, $2::timestamptz),',
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.bounced', { bounce: { type: 'Permanent', message: 'x' } }, { id: 'svix-b' }); return trouver(1).status; },
      rouge: (statut) => statut !== 'failed',
    },
    {
      nom: 'une plainte n inscrit plus l adresse en suppression',
      fichier: 'lib/email-events.js',
      de: '    if (adresse && centre) {',
      vers: '    if (false) {',
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.complained', {}, { id: 'svix-p' }); return DB.marketing_suppressions.length; },
      rouge: (n) => n === 0,
    },
    {
      nom: 'la borne de sens disparait : l evenement touche un mail RECU',
      fichier: 'lib/email-events.js',
      de: "       where provider_message_id = $1 and direction = 'outbound'",
      vers: '       where provider_message_id = $1',
      // Le mail RECU (id 4) est le plus recent des deux : sans la borne, c est
      // lui que l ouverture credite.
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.opened', {}, { id: 'svix-s' }); return trouver(4).open_count; },
      rouge: (ouvertures) => ouvertures !== 0,
    },
    {
      nom: 'la verification de signature est neutralisee',
      fichier: 'api/inbound-email.js',
      de: '    if (!autorise(brut, req)) {',
      vers: '    if (false) {',
      rejouer: async (mm) => { reset(); return appeler(mm, { corps: evenement('email.delivered', {}), entetes: {} }); },
      rouge: (r) => r.statut === 200 || DB.email_events.length > 0,
    },
    {
      nom: 'les evenements ne sont plus enregistres',
      fichier: 'lib/email-events.js',
      de: "  if (!TYPES_ACCEPTES.has(t)) return { ok: true, ignored: t || 'inconnu' };",
      vers: "  if (true) return { ok: true, ignored: t || 'inconnu' };",
      rejouer: async (mm) => { reset(); await livrer(mm, 'email.delivered', {}, { id: 'svix-d' }); return { n: DB.email_events.length, statut: trouver(1).status }; },
      rouge: (r) => r.n === 0 || r.statut !== 'delivered',
    },
  ];
  for (const c of contreEpreuves) {
    let verdict = false;
    try {
      mutations = [{ fichier: c.fichier, de: c.de, vers: c.vers }];
      const mm = charger();
      verdict = c.rouge(await c.rejouer(mm));
    } catch (erreur) {
      verdict = false;
      console.log(`      (contre-epreuve impossible : ${erreur.message})`);
    } finally {
      mutations = [];
    }
    ok(verdict, `[mutation] « ${c.nom} » (le gate ROUGIRAIT)`);
  }
  m = charger();
  ok(mutations.length === 0, '[mutation] aucune mutation ne survit');

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})().catch((erreur) => {
  console.error('FAIL  gate interrompu :', (erreur && erreur.stack) || erreur);
  process.exit(1);
});
