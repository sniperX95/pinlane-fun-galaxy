// LES POSTES DE GARDE (2026-11-06, Ansar : « des gardes sur absolument tout Pinlane, et
// previens-moi de tout sur Telegram »). Chaque poste joue ici son vrai code, sur une base en
// memoire et un faux Telegram qui note tout (le groupe, le sujet, la sonnerie, le texte).
// Puis sa contre-preuve le casse expres : un poste qui ne rougit pas a sa casse ne garde rien.
//
//   [T] le canal : les quatre sujets, seules les pannes sonnent, le repli quand le groupe
//       refuse, les longs messages, la rafale ;
//   [R] les annonces : une reservation, une demande de groupe, sans donnee personnelle ;
//   [J] le journal : les annonces rattrapees, les modifications du quart d heure, le curseur ;
//   [S] les plantages du serveur, par le vrai webhook des mails ;
//   [C] les plantages de la console, par le vrai api/ops ;
//   [A] les taches de fond ;
//   [M] les mails revenus ou signales, par le vrai webhook ;
//   [B] le bilan du matin et le controle du texte de l IA ;
//   [G] la garde entiere : mise en service, explication d une panne, suivis, bilan ;
//   [K] la caisse du chef de garde ;
//   [X] les contre-preuves.
// Lancement : node scripts/garde-postes-check.js
'use strict';

for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|TELEGRAM|PINLANE_SECOURS|ANTHROPIC|OPENAI|OPENROUTER|KIMI|MOONSHOT|LLM_|GARDE_|INBOUND_EMAIL|CRON_SECRET)/i.test(nom)) delete process.env[nom];
process.env.DATABASE_URL = 'postgres://banc/banc';
process.env.TELEGRAM_JETON = 'banc';
process.env.TELEGRAM_CHAT = '42';
process.env.INBOUND_EMAIL_SECRET = 'secret-du-banc';

const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const LF = '\n';
const PERSONNEL = /Jean|Dupont|0471|example\.be|jean@/;
const GROUPE = '-1001234567890';

let total = 0;
let echecs = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) {
    console.log(`ok    ${message}`);
    return;
  }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 700)}`}`);
}

// Les mutations, compilees en memoire : le disque n est jamais ecrit.
let mutations = [];
const compileAvant = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const edits = mutations.filter((e) => e.fichier === rel);
  if (!edits.length) return compileAvant.call(this, contenu, nom);
  let mute = contenu.split('\r\n').join(LF);
  for (const { de, vers } of edits) {
    if (mute.split(de).length !== 2) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 80)}`);
    mute = mute.split(de).join(vers);
  }
  return compileAvant.call(this, mute, nom);
};
const MODULES_DE_GARDE = ['lib/garde-alertes.js', 'lib/garde-annonces.js', 'lib/garde-journal.js', 'lib/garde-serveur.js', 'lib/garde-mails.js', 'lib/garde-bilan.js', 'lib/tour-controle.js', 'lib/ops-engine.js', 'lib/cron-tasks.js', 'lib/llm-budget.js', 'lib/llm-client.js', 'lib/client-errors.js', 'api/inbound-email.js', 'api/ops.js'];
function purger() {
  for (const rel of MODULES_DE_GARDE) delete require.cache[require.resolve(path.join(ROOT, rel))];
}
const charger = (rel) => require(path.join(ROOT, rel));

// ---------------------------------------------------------------------------
// La base en memoire, derriere le vrai module pg de lib/database.js. Une lecture
// inconnue rend vide : chaque preuve pose les lignes qu elle lit.
// ---------------------------------------------------------------------------
const BD = {};
function remettre() {
  BD.routes = [];
  BD.erreurs = [];
  BD.journal = [];
  BD.runs = [];
  BD.etatGarde = null;
}
remettre();
const rows = (lignes) => ({ rows: lignes, rowCount: lignes.length });
function repondre(sql, p = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  for (const r of BD.routes) if (r.motif.test(s)) return rows(r.rendre(s, p));
  if (/^(begin|rollback|commit)/i.test(s)) return rows([]);
  if (/^insert into ops_worker_runs/i.test(s)) { BD.runs.push({ sql: s }); return rows([{ id: BD.runs.length, started_at: new Date() }]); }
  if (/^update ops_worker_runs/i.test(s)) return rows([]);
  if (/count\(\*\)::int as recent from client_errors/.test(s)) return rows([{ recent: 0 }]);
  if (/^insert into client_errors/i.test(s)) {
    BD.erreurs.push({ center_id: p[0], page: p[1], message: p[2], source: p[3], stack_hash: p[6], member_id: p[8] });
    return rows([{ id: BD.erreurs.length }]);
  }
  if (/^insert into audit_log/i.test(s)) {
    const colonnes = s.match(/\(([^)]+)\) values/i)[1].split(',').map((c) => c.trim());
    BD.journal.push(Object.fromEntries(colonnes.map((c, i) => [c, p[i]])));
    return rows([{ id: BD.journal.length }]);
  }
  if (/select result from ops_worker_runs where task_name = 'garde' and status = 'ok' order by started_at desc limit 1/.test(s)) return rows(BD.etatGarde ? [{ result: BD.etatGarde }] : []);
  return rows([]);
}
class FauxPool {
  constructor() { this.options = { max: 5 }; this.waitingCount = 0; this.idleCount = 1; this.totalCount = 1; }
  async query(sql, p) { return repondre(typeof sql === 'string' ? sql : sql.text, p); }
  async connect() { return { query: async (sql, p) => repondre(typeof sql === 'string' ? sql : sql.text, p), release() {} }; }
  on() {}
  async end() {}
}
const cheminPg = require.resolve('pg');
require.cache[cheminPg] = { id: cheminPg, filename: cheminPg, loaded: true, exports: { Pool: FauxPool } };
const pool = new FauxPool();
const route = (motif, rendre) => BD.routes.push({ motif, rendre });

// Le monde exterieur : Telegram et Resend notes, tout le reste interdit.
const TG = [];
let tgMode = 'ok';
const LLM = [];
global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    const corps = JSON.parse(options.body);
    if (tgMode === 'coupe') throw Object.assign(new Error('coupe'), { name: 'TimeoutError' });
    if (tgMode === 'refusGroupe' && String(corps.chat_id) === GROUPE) return new Response('{"ok":false}', { status: 400 });
    TG.push(corps);
    return new Response('{"ok":true}', { status: 200 });
  }
  if (u.includes('api.anthropic.com')) {
    LLM.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'réponse du banc' }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  }
  if (u.includes('api.resend.com')) return new Response('{"id":"banc"}', { status: 200 });
  throw new Error(`reseau interdit au banc : ${u}`);
};
const avecGroupe = () => { process.env.TELEGRAM_GROUPE = GROUPE; process.env.TELEGRAM_SUJETS = 'pannes:2,reservations:3,modifications:4,bilans:5'; };
const sansGroupe = () => { delete process.env.TELEGRAM_GROUPE; delete process.env.TELEGRAM_SUJETS; };
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/\[garde\]|\[chef-de-garde\]|\[tour-controle\]|ECRITURE PERDUE|TRACE PERDUE|\[ops\]|\[client-errors\]|inbound-email|\[audit\]/.test(String(a[0]))) o(...a); }; }

async function appeler(handler, methode, url, corps, entetes = {}) {
  const brut = corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))];
  const req = Readable.from(brut);
  Object.assign(req, { method: methode, url, headers: { host: 'localhost', 'content-type': 'application/json', 'user-agent': 'banc', ...entetes }, socket: { remoteAddress: '10.0.0.9' } });
  const res = {
    statusCode: 200, entetes: {}, corps: '', headersSent: false,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    getHeader(k) { return this.entetes[k.toLowerCase()]; },
    writeHead(s, h) { this.statusCode = s; if (h) Object.assign(this.entetes, h); return this; },
    write(b) { this.corps += String(b || ''); },
    end(b) { this.corps += String(b || ''); this.headersSent = true; },
  };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.corps); } catch (error) { json = null; }
  return { statut: res.statusCode, json, corps: res.corps };
}

// ---------------------------------------------------------------------------
// [T] Le canal.
// ---------------------------------------------------------------------------
async function preuvesCanal() {
  const a = charger('lib/garde-alertes.js');
  a.oublierLesAlertes();
  sansGroupe();
  TG.length = 0;
  await a.envoyerTelegram('panne A', { sujet: 'pannes' });
  await a.envoyerTelegram('réservation B', { sujet: 'reservations' });
  ok(TG.length === 2 && TG.every((m) => m.chat_id === '42' && !m.message_thread_id), '[T] sans groupe, tout part dans la conversation d Ansar, comme avant', TG);
  ok(!TG[0].disable_notification && TG[1].disable_notification === true, '[T] seule la panne sonne', TG);

  avecGroupe();
  TG.length = 0;
  for (const s of ['pannes', 'reservations', 'modifications', 'bilans']) await a.envoyerTelegram(`essai ${s}`, { sujet: s });
  ok(TG.map((m) => `${m.chat_id}/${m.message_thread_id}`).join(' ') === `${GROUPE}/2 ${GROUPE}/3 ${GROUPE}/4 ${GROUPE}/5`, '[T] avec le groupe, chaque sujet dans son fil', TG);
  ok(TG.filter((m) => !m.disable_notification).length === 1 && !TG[0].disable_notification, '[T] dans le groupe aussi, seules les pannes sonnent', TG);
  TG.length = 0;
  await a.envoyerTelegram('à regarder', { sujet: 'pannes', silencieux: true });
  ok(TG.length === 1 && TG[0].disable_notification === true && TG[0].message_thread_id === 2, '[T] une panne « à regarder » arrive dans Pannes sans sonner', TG);

  TG.length = 0;
  tgMode = 'refusGroupe';
  const repli = await a.envoyerTelegram('une réservation', { sujet: 'reservations' });
  tgMode = 'ok';
  ok(repli.ok && repli.repli && TG.length === 1 && TG[0].chat_id === '42' && /refuse ce message, sujet reservations/.test(TG[0].text) && /une réservation/.test(TG[0].text), '[T] le groupe refuse (bot retire, sujet supprime) : le message arrive quand meme, dans la conversation, et le dit', { repli, TG });

  TG.length = 0;
  tgMode = 'coupe';
  const coupe = await a.envoyerTelegram('x', { sujet: 'pannes' });
  tgMode = 'ok';
  ok(!coupe.ok && coupe.raison === 'délai dépassé' && TG.length === 0, '[T] Telegram injoignable : rien ne part, et l appelant le sait', coupe);

  TG.length = 0;
  const long = Array.from({ length: 300 }, (_, i) => `Ligne ${i} du bilan, assez longue pour remplir le message.`).join('\n');
  await a.envoyerTelegram(long, { sujet: 'bilans' });
  ok(TG.length >= 3 && TG.every((m) => m.text.length <= 3500 && m.message_thread_id === 5) && TG.map((m) => m.text).join('\n') === long, '[T] un long bilan part en plusieurs messages, sans rien perdre ni couper une ligne', TG.map((m) => m.text.length));

  a.oublierLesAlertes();
  TG.length = 0;
  const t0 = Date.parse('2026-11-14T12:00:00Z');
  for (let i = 0; i < 14; i += 1) await a.alerter(`cle-${i}`, `panne ${i}`, { maintenant: t0 + i * 1000 });
  ok(TG.length === 13 && /Trop d’alertes/.test(TG[12].text), '[T] 14 pannes differentes en 10 minutes : 12 messages, puis une ligne qui le dit', TG.map((m) => m.text));
  await a.alerter('cle-99', 'panne 99', { maintenant: t0 + 11 * 60_000 });
  ok(TG.length === 14 && TG[13].text === 'panne 99', '[T] la fenetre passee, les alertes repartent', TG.length);
  await a.alerter('cle-99', 'panne 99 encore', { maintenant: t0 + 11 * 60_000 + 5000 });
  ok(TG.length === 14, '[T] la meme panne dans sa fenetre : pas un second message', TG.length);
  a.oublierLesAlertes();
  sansGroupe();
}

// ---------------------------------------------------------------------------
// [R] Les annonces.
// ---------------------------------------------------------------------------
const RESA = { id: 1234, centerId: 'gembloux', channel: 'public', date: '2026-11-14', startTime: '15:00', pax: 12, price: 240, status: 'pending', validationStatus: 'confirmed', type: 'visite', program: { items: [{ name: 'Bowling' }, { name: 'Laser Game' }] }, name: 'Jean Dupont', phone: '0471000000', email: 'jean@example.be' };
async function preuvesAnnonces() {
  const an = charger('lib/garde-annonces.js');
  const t = an.texteReservation(RESA);
  ok(/^Nouvelle réservation, Gembloux, en ligne\n/.test(t) && t.includes('samedi 14/11 à 15:00, 12 personnes') && t.includes('Bowling, Laser Game') && t.includes('240,00 €') && t.includes('Réservation n° 1234'), '[R] une reservation en ligne : le centre, le jour, l heure, le nombre, ce qui est reserve, le prix, le dossier', t);
  ok(!PERSONNEL.test(t), '[R] ni nom, ni telephone, ni e-mail', t);
  const comptoir = an.texteReservation({ ...RESA, channel: 'staff', validationStatus: 'staff_review' }, { par: 'Seb' });
  ok(/au comptoir \(Seb\)/.test(comptoir) && /À valider par l’équipe/.test(comptoir), '[R] au comptoir : qui l a faite, et si elle attend la validation', comptoir);
  const formule = an.texteReservation({ ...RESA, type: 'formule', formuleId: 'f4', label: 'FORMULE 4', program: { items: [{ name: 'Bowling' }] } });
  ok(formule.includes('FORMULE 4') && !formule.includes('Bowling'), '[R] une formule se dit par son nom', formule);
  const d = an.texteDemande({ id: 56, centerId: 'libramont', pax: 35, occasion: 'anniversaire', requestedDate: 'samedi 21 novembre 2026, après-midi', contactName: 'Jean Dupont', email: 'jean@example.be' });
  ok(d === 'Nouvelle demande de groupe, Libramont\nAnniversaire, 35 personnes\nsamedi 21 novembre 2026, après-midi\nÀ traiter dans la console', '[R] une demande de groupe : le centre, l occasion, le nombre, le moment, sans le contact ni numero de demande (2026-11-06)', d);

  avecGroupe();
  an.reprendreLesAnnonces();
  TG.length = 0;
  const sort = await an.annoncerReservation(RESA);
  ok(sort === 'ok' && TG.length === 1 && TG[0].message_thread_id === 3 && TG[0].disable_notification === true, '[R] elle part dans le sujet Reservations, sans sonnerie', { sort, TG });
  TG.length = 0;
  ok(await an.annoncerReservation({ ...RESA, email: 'x@demo.fungalaxy.test' }) === 'essai' && TG.length === 0, '[R] une reservation de demonstration ne s annonce pas', TG);
  ok(await an.annoncerReservation({ ...RESA, channel: 'sim-client' }) === 'essai' && TG.length === 0, '[R] une simulation non plus', TG);
  tgMode = 'coupe';
  const s1 = await an.annoncerReservation(RESA);
  tgMode = 'ok';
  TG.length = 0;
  const s2 = await an.annoncerReservation(RESA);
  ok(s1 === 'non' && s2 === 'differee' && TG.length === 0, '[R] Telegram en panne : les suivantes n attendent plus Telegram pendant 2 minutes, la garde rattrape', { s1, s2 });
  an.reprendreLesAnnonces();
  sansGroupe();
}

// ---------------------------------------------------------------------------
// [J] Le journal relu.
// ---------------------------------------------------------------------------
const ligneJournal = (id, action, extra = {}) => ({ id, center_id: 'gembloux', occurred_at: new Date(`2026-11-14T13:${String(id % 100).padStart(2, '0')}:00Z`), actor_kind: 'staff', actor_label: 'Seb', action, entity_type: 'reservation', entity_id: String(800 + id), annonce: '', retard: null, dossiers: null, champs: {}, cles: [], dossier: { date: '2026-11-14', startTime: '16:00' }, ...extra });
function journalDuBanc() {
  return [
    ligneJournal(101, 'createReservation', { actor_kind: 'public', actor_label: 'client (formulaire public)', annonce: 'non' }),
    ligneJournal(102, 'createReservation', { annonce: 'ok' }),
    ligneJournal(103, 'updateReservation', { champs: { startTime: { before: '15:00', after: '16:00' } }, cles: ['startTime', 'opsPlan', 'riskScore'] }),
    ligneJournal(104, 'setReservationStatus', { champs: { status: { before: 'pending', after: 'cancelled' } }, cles: ['status'] }),
    ligneJournal(105, 'setReservationStatus', { champs: { status: { before: 'pending', after: 'arrived' } }, cles: ['status'] }),
    ligneJournal(106, 'updateReservation', { champs: { price: { before: 240, after: 200 } }, cles: ['price', 'name'] }),
    ligneJournal(107, 'saveCenterConfig', { center_id: 'libramont', entity_type: 'center', entity_id: 'libramont', actor_label: 'Ansar' }),
    ligneJournal(108, 'regenerateRoleCode', { entity_type: 'staff_role', entity_id: 'direction', actor_label: 'Ansar' }),
    ligneJournal(109, 'login', { entity_type: 'staff_session' }),
    ligneJournal(110, 'actionInconnueDemain', { entity_type: 'ops_action', entity_id: '' }),
    ligneJournal(111, 'createCustomRequest', { actor_kind: 'public', entity_type: 'custom_request', entity_id: '56', annonce: '' }),
  ];
}
function routesDuJournal(lignes) {
  route(/select coalesce\(max\(id\), 0\)::bigint as dernier from audit_log/, () => [{ dernier: 100 }]);
  route(/from audit_log a where/, (s, p) => lignes.filter((l) => l.id > Number(p[0])));
  const dossiers = { 901: { channel: 'public' }, 902: { channel: 'staff' } };
  route(/^select \* from reservations where id = \$1/, (s, p) => (dossiers[Number(p[0])] ? [{ id: Number(p[0]), center_id: 'gembloux', channel: dossiers[Number(p[0])].channel, date: '2026-11-20', start_time: '18:00', pax: 6, price: 120, status: 'pending', validation_status: 'confirmed', type: 'bowling', label: 'Bowling Classique', name: 'Jean Dupont', email: 'jean@example.be', phone: '0471' }] : []));
  route(/from custom_requests where id = \$1/, () => [{ id: 56, center_id: 'gembloux', pax: 35, occasion: 'entreprise', requested_date: 'vendredi 27 novembre, soir' }]);
}
async function preuvesJournal() {
  remettre();
  routesDuJournal(journalDuBanc());
  avecGroupe();
  charger('lib/garde-annonces.js').reprendreLesAnnonces();
  const j = charger('lib/garde-journal.js');
  TG.length = 0;
  const premier = await j.relireLeJournal(pool, null);
  ok(premier.curseur === 100 && TG.length === 0, '[J] premier passage : le curseur part de maintenant, l historique ne se rejoue pas', { premier, TG });

  const r = await j.relireLeJournal(pool, 100);
  const resa = TG.filter((m) => m.message_thread_id === 3);
  const modifs = TG.filter((m) => m.message_thread_id === 4);
  ok(resa.length === 2 && /^Nouvelle réservation, Gembloux, en ligne \(annoncée en retard\)/.test(resa[0].text) && /Réservation n° 901/.test(resa[0].text) && /^Nouvelle demande de groupe, Gembloux \(annoncée en retard\)/.test(resa[1].text), '[J] une annonce qui n est pas partie part au quart d heure suivant, marquee en retard', resa.map((m) => m.text));
  ok(!resa.some((m) => /Réservation n° 902/.test(m.text)), '[J] une annonce deja partie ne se redit pas', resa.map((m) => m.text));
  ok(!PERSONNEL.test(TG.map((m) => m.text).join(' ')), '[J] aucune donnee personnelle, meme en rattrapage', TG.map((m) => m.text));
  const texte = (modifs[0] && modifs[0].text) || '';
  ok(modifs.length === 1 && modifs[0].disable_notification === true, '[J] les modifications du quart d heure : un seul message, sans sonnerie', modifs);
  ok(/^Modifications, 14:03 à 14:10\nGembloux\n/.test(texte) && texte.includes('\nLibramont\n'), '[J] range par centre, avec la periode', texte);
  ok(texte.includes('14:03 Seb : réservation n° 903 (samedi 14/11 16:00) déplacée de 15:00 à 16:00'), '[J] une reservation deplacee : quand, qui, d ou vers ou', texte);
  ok(texte.includes('réservation n° 904 (samedi 14/11 16:00) annulée'), '[J] une reservation annulee', texte);
  ok(texte.includes('prix de 240,00 € à 200,00 €, changement : coordonnées'), '[J] un prix change, et des coordonnees changees sans les citer', texte);
  ok(texte.includes('14:07 Ansar : réglages du centre enregistrés') && texte.includes('code d’accès régénéré (direction)'), '[J] les reglages et les acces', texte);
  ok(texte.includes('action « actionInconnueDemain » (la garde ne la connaît pas encore)'), '[J] une action inconnue fait une ligne a son nom : rien ne disparait en silence', texte);
  ok(/Aussi : 1 arrivée notée\.$/.test(texte) && !/login/.test(texte), '[J] l ordinaire se compte en bas, une connexion ne se dit pas', texte);
  ok(r.curseur === 111 && r.annonces === 2, '[J] le curseur avance quand tout est parti', r);

  TG.length = 0;
  tgMode = 'coupe';
  const coupe = await j.relireLeJournal(pool, 100);
  tgMode = 'ok';
  ok(coupe.curseur === 100, '[J] Telegram coupe : le curseur ne bouge pas, tout se redira', coupe);

  remettre();
  routesDuJournal([ligneJournal(201, 'setReservationStatus', { champs: { status: { before: 'pending', after: 'paid' } }, cles: ['status'] }), ligneJournal(202, 'setReservationActivityProgress', { cles: ['activityProgress'] })]);
  TG.length = 0;
  const ordinaire = await j.relireLeJournal(pool, 200);
  ok(TG.length === 0 && ordinaire.curseur === 202, '[J] un quart d heure d ordinaire seulement (encaisse, etape) : pas de message', { TG, ordinaire });
  sansGroupe();
}

// ---------------------------------------------------------------------------
// [S] Les plantages du serveur, [M] les mails, par le vrai webhook.
// ---------------------------------------------------------------------------
async function preuvesServeur() {
  remettre();
  charger('lib/garde-alertes.js').oublierLesAlertes();
  const sv = charger('lib/garde-serveur.js');
  TG.length = 0;
  const panne = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432 pour jean@example.be'), { code: 'ECONNREFUSED' });
  await sv.signalerPanneServeur('api/staff-reservations', panne, { centerId: 'gembloux' });
  ok(BD.erreurs.length === 1 && BD.erreurs[0].member_id === 'serveur:api/staff-reservations' && BD.erreurs[0].center_id === 'gembloux' && !/jean@/.test(BD.erreurs[0].message), '[S] la panne entre dans la table des plantages, sous sa route, expurgee', BD.erreurs);
  ok(TG.length === 1 && /^URGENT Pinlane\nPanne du serveur, api\/staff-reservations \(gembloux\)\./.test(TG[0].text) && /ECONNREFUSED/.test(TG[0].text) && !PERSONNEL.test(TG[0].text), '[S] elle sonne, avec la route et la cause, sans adresse', TG);
  await sv.signalerPanneServeur('api/staff-reservations', panne, { centerId: 'gembloux' });
  ok(TG.length === 1, '[S] la meme panne dans l heure : pas un second message', TG.length);

  const { createHandler } = charger('api/inbound-email.js');
  TG.length = 0;
  const casse = createHandler({ enregistrerEvenement: async () => { throw new Error('relation "email_events" does not exist'); } });
  const r = await appeler(casse, 'POST', '/api/inbound-email', { type: 'email.bounced', data: { email_id: 're_banc' } }, { 'x-inbound-secret': 'secret-du-banc' });
  await attendre();
  ok(r.statut === 503 && TG.some((m) => /Panne du serveur, api\/inbound-email/.test(m.text)), '[S] par le vrai webhook : un evenement qui ne s ecrit pas rend 503 au fournisseur, et sonne', { r, TG });
}

async function preuvesMails() {
  remettre();
  charger('lib/garde-alertes.js').oublierLesAlertes();
  route(/from communications c left join \(select id, date, start_time from reservations where /, () => [{ id: 55, center_id: 'gembloux', template_id: 'confirmation', reservation_id: 1234, date: '2026-11-14', start_time: '15:00:00' }]);
  const { createHandler } = charger('api/inbound-email.js');
  const evenement = (resultat) => createHandler({ enregistrerEvenement: async () => resultat });
  TG.length = 0;
  const r = await appeler(evenement({ ok: true, deduped: false, communicationId: 55, type: 'bounced' }), 'POST', '/api/inbound-email', { type: 'email.bounced', data: { email_id: 're_x', to: ['jean@example.be'] } }, { 'x-inbound-secret': 'secret-du-banc' });
  ok(r.statut === 200 && TG.length === 1 && TG[0].text === 'URGENT Pinlane\nUn mail n’est pas arrivé chez un client de Gembloux : sa boîte l’a refusé (la confirmation).\nRéservation n° 1234 (samedi 14/11 à 15:00).\nÀ appeler : le numéro est dans le dossier.', '[M] un mail refuse par la boite du client sonne : quel mail, quel dossier, quoi faire', { r, TG });
  ok(!PERSONNEL.test(TG.map((m) => m.text).join(' ')), '[M] sans l adresse du client', TG);
  ok(!TG[0].disable_notification, '[M] il sonne : un client n a pas sa confirmation', TG);
  TG.length = 0;
  await appeler(evenement({ ok: true, deduped: true, communicationId: 55, type: 'bounced' }), 'POST', '/api/inbound-email', { type: 'email.bounced', data: {} }, { 'x-inbound-secret': 'secret-du-banc' });
  await appeler(evenement({ ok: true, deduped: false, communicationId: 56, type: 'delivered' }), 'POST', '/api/inbound-email', { type: 'email.delivered', data: {} }, { 'x-inbound-secret': 'secret-du-banc' });
  ok(TG.length === 0, '[M] une relivraison du fournisseur ou un mail bien remis : rien', TG);
  await appeler(evenement({ ok: true, deduped: false, communicationId: 57, type: 'complained' }), 'POST', '/api/inbound-email', { type: 'email.complained', data: {} }, { 'x-inbound-secret': 'secret-du-banc' });
  ok(TG.length === 1 && /a classé la confirmation en indésirable/.test(TG[0].text) && TG[0].disable_notification === true, '[M] un mail classe indesirable : dit, sans sonnerie', TG);
}

// ---------------------------------------------------------------------------
// [C] La console, par le vrai api/ops. [A] Les taches de fond.
// ---------------------------------------------------------------------------
const SESSION = { member: { id: 'gembloux:staff-bar', name: 'Seb' }, centerId: 'gembloux', authorizedCenterId: 'gembloux', permissions: ['*'], role: { id: 'direction' } };
function monterOps() {
  const staffAuth = require(path.join(ROOT, 'lib/staff-auth'));
  staffAuth.requireStaffPermission = async () => SESSION;
  staffAuth.getStaffSessionFromRequest = async () => SESSION;
  return charger('api/ops.js');
}
async function preuvesConsole() {
  remettre();
  charger('lib/garde-alertes.js').oublierLesAlertes();
  const ops = monterOps();
  TG.length = 0;
  const plantage = { action: 'logClientError', centerId: 'gembloux', page: 'planning', message: 'Cannot read properties of undefined (jean@example.be)', source: 'https://app.pinlane.be/assets/app-main.js', lineno: 10, colno: 4, stack: 'TypeError: Cannot read properties of undefined\n    at renderStaff (app-main.js:10:4)' };
  const r = await appeler(ops, 'POST', '/api/ops?action=logClientError', plantage);
  ok(r.statut === 200 && BD.erreurs.length === 1, '[C] la console qui plante : l erreur entre en base', { r, erreurs: BD.erreurs });
  ok(TG.length === 1 && /^URGENT Pinlane\nLa console de Gembloux a planté chez Seb, page planning \(plantage \w{6}\)/.test(TG[0].text) && !/Cannot read/.test(TG[0].text) && !PERSONNEL.test(TG[0].text), '[C] et sonne, sans rien recopier de ce que le navigateur envoie', TG);
  await appeler(ops, 'POST', '/api/ops?action=logClientError', plantage);
  ok(TG.length === 1, '[C] le meme plantage dans l heure : pas un second message', TG.length);
  await appeler(ops, 'POST', '/api/ops?action=logClientError', { ...plantage, message: 'autre chose', stack: 'Error: autre chose\n    at x (app-main.js:99:1)' });
  ok(TG.length === 2, '[C] un autre plantage : un second message', TG.length);
}

async function preuvesTaches() {
  remettre();
  charger('lib/garde-alertes.js').oublierLesAlertes();
  const ct = charger('lib/cron-tasks.js');
  TG.length = 0;
  await ct.recordWorkerTask('secours', async () => ({ ok: false, message: 'Resend a refusé 2 feuilles' }));
  ok(TG.length === 1 && TG[0].text === 'URGENT Pinlane\nLe planning de secours a échoué : Resend a refusé 2 feuilles' && !TG[0].disable_notification, '[A] une tache qui rend un echec sonne tout de suite, avec sa cause', TG);
  let leve = false;
  try {
    await ct.recordWorkerTask('dispatch-communications', async () => { throw new Error('Base occupée'); });
  } catch (error) {
    leve = true;
  }
  ok(leve && TG.length === 2 && TG[1].text === 'URGENT Pinlane\nL’envoi des mails en attente a échoué : Base occupée', '[A] une tache qui plante sonne aussi, et l erreur continue sa route', TG.map((m) => m.text));
  await ct.recordWorkerTask('agent-orchestrator', async () => ({ ok: false, message: 'quota' }));
  ok(TG.length === 3 && TG[2].text === 'À regarder, Pinlane\nLes agents marketing ont échoué : quota' && TG[2].disable_notification === true, '[A] les agents marketing : a regarder, sans sonnerie (aucun client touche)', TG.map((m) => m.text));
  await ct.recordWorkerTask('garde', async () => ({ ok: false, message: 'x' }));
  await ct.recordWorkerTask('secours', async () => ({ ok: true }));
  ok(TG.length === 3, '[A] la garde a son propre cri, et une tache saine ne dit rien', TG.length);
}

// ---------------------------------------------------------------------------
// [B] Le bilan du matin.
// ---------------------------------------------------------------------------
const MATIN = new Date('2026-11-14T07:30:00Z');
const CENTRES = [{ id: 'gembloux', nom: 'Gembloux', status: 'active', garde: true }, { id: 'libramont', nom: 'Libramont', status: 'active', garde: true }];
const TACHES_SAINES = [{ id: 'garde', nom: 'La garde', dernierOk: '2026-11-14T07:15:00Z' }, { id: 'secours', nom: 'Le planning de secours', dernierOk: '2026-11-14T07:15:00Z' }, { id: 'dispatch-communications', nom: 'L’envoi des mails en attente', dernierOk: '2026-11-14T06:00:00Z' }];
const resaDuBanc = (id, c) => ({ id, center_id: 'gembloux', channel: 'public', date: '2026-11-13', start_time: '15:00', pax: 4, price: 100, status: 'pending', validation_status: 'confirmed', type: 'bowling', label: 'Bowling', email: 'client@example.be', created_at: new Date('2026-11-13T10:00:00Z'), ...c });
function routesDuBilan() {
  const historique = [
    resaDuBanc(1, { status: 'paid', amount_paid: 90 }),
    resaDuBanc(2, { channel: 'staff', price: 50, pax: 2 }),
    resaDuBanc(3, { status: 'cancelled', price: 40 }),
    resaDuBanc(4, { absent_at: new Date('2026-11-13T16:00:00Z'), price: 30 }),
    resaDuBanc(5, { date: '2026-11-14', price: 70, pax: 5, validation_status: 'staff_review', channel: 'staff' }),
    resaDuBanc(6, { date: '2026-11-05', status: 'paid', price: 200, pax: 8, created_at: new Date('2026-11-01T10:00:00Z') }),
    resaDuBanc(7, { email: 'x@demo.fungalaxy.test', price: 999 }),
  ];
  route(/from reservations where center_id = any\(\$1::text\[\]\) and date >= /, () => historique);
  route(/from reservations where center_id = any\(\$1::text\[\]\) and created_at >= /, () => historique.filter((r) => [1, 2, 5, 7].includes(r.id)));
  route(/from custom_requests group by center_id/, () => [{ center_id: 'gembloux', recues: 1, personnes: 35, en_attente: 2 }]);
  route(/from audit_log a where/, () => [
    ligneJournal(301, 'updateReservation', { champs: { startTime: { before: '15:00', after: '16:00' } }, cles: ['startTime'] }),
    ligneJournal(302, 'setReservationStatus', { champs: { status: { before: 'pending', after: 'cancelled' } }, cles: ['status'] }),
    ligneJournal(303, 'setReservationStatus', { champs: { status: { before: 'pending', after: 'arrived' } }, cles: ['status'] }),
    ligneJournal(304, 'saveCenterConfig', { entity_type: 'center', entity_id: 'gembloux' }),
    ligneJournal(305, 'regenerateRoleCode', { entity_type: 'staff_role', entity_id: 'direction' }),
    ligneJournal(306, 'updateReservation', { champs: { price: { before: 240, after: 200 } }, cles: ['price'] }),
  ]);
  route(/from communications where channel = 'email' and direction = 'outbound'/, () => [{ center_id: 'gembloux', envoyes: 5, remis: 4, echecs: 1, en_attente: 0 }]);
  route(/from email_events where occurred_at >= /, () => [{ center_id: 'gembloux', event_type: 'bounced', n: 1 }]);
  route(/from client_errors where occurred_at >= /, () => [{ center_id: 'gembloux', origine: 'formulaire', n: 2, distincts: 1 }]);
  route(/entity_type = 'formulaire' and occurred_at >= /, () => [{ center_id: 'gembloux', action: 'reservation.refusee', n: 3 }]);
  route(/from ops_worker_runs where started_at >= /, () => [{ task_name: 'garde', ok: 96, echecs: 0 }, { task_name: 'secours', ok: 96, echecs: 0 }, { task_name: 'dispatch-communications', ok: 7, echecs: 1, derniere_erreur: 'Resend 500' }]);
  route(/task_name = 'sauvegarde' and status = 'ok'/, () => [{ result: { lignes: 20913, tables: 60 }, finished_at: new Date('2026-11-14T01:15:46Z') }]);
  route(/task_name = 'garde' and status = 'ok' and started_at >/, () => [{ result: { ouverts: [{ cle: 'mail:bounced:gembloux:1', titre: '1 mail est revenu à Gembloux', gravite: 'attention' }], regles: ['Gembloux n’a aucune adresse de secours'] }, started_at: new Date('2026-11-13T15:00:00Z') }]);
  route(/from llm_spend/, () => [{ month: '2026-11', cout: 0.42, calls: 10 }, { month: '2026-11:garde', cout: 0.03, calls: 2 }]);
}
const BON_TEXTE = [
  'EN BREF',
  'Gembloux : 3 réservations reçues hier, 2 visites, 150,00 € de chiffre d’affaires.',
  'Libramont : rien hier.',
  'GEMBLOUX',
  'Hier, 2 visites pour 6 personnes, 150,00 €. Encaissé 90,00 €. 1 annulée, 1 absente.',
  'Le mois : 3 réservations, 350,00 €. Aujourd’hui : 1 à valider. 2 demandes de groupe attendent.',
  'Mails : 5 envoyés, 4 remis, 1 revenu. 2 plantages au formulaire, 3 refus.',
  'LIBRAMONT',
  'Rien hier.',
  'LES AGENTS',
  'La garde : 96 passages. L’envoi des mails : 1 échec, Resend 500. Sauvegarde du 14/11 à 02:15, 20913 lignes. Dépense IA : 0,42 $ sur 5 $, 0,03 $ sur 2 $.',
  'LES PROBLÈMES',
  'Ouvert en 24 heures : 1 mail est revenu à Gembloux. Réglé : l’adresse de secours de Gembloux.',
  'À FAIRE AUJOURD’HUI',
  'Valider 1 réservation à Gembloux. Appeler le client dont le mail est revenu.',
].join('\n');
async function preuvesBilan() {
  remettre();
  routesDuBilan();
  const b = charger('lib/garde-bilan.js');
  const f = await b.faitsDuBilan(pool, { instant: MATIN, centres: CENTRES, taches: TACHES_SAINES, problemes: [{ titre: 'Gembloux n’a aucune adresse de secours', gravite: 'attention' }] });
  const g = f.centres.find((c) => c.centre === 'Gembloux');
  ok(f.bilanDu === 'vendredi 13/11' && f.moisDebut === '2026-11-01' && f.illisibles.length === 0, '[B] le bilan porte sur la veille, et tout se lit', { bilanDu: f.bilanDu, illisibles: f.illisibles });
  ok(g && JSON.stringify(g.visitesHier) === JSON.stringify({ reservations: 2, personnes: 6, ca: 150, encaisse: 90, payees: 1, annulees: 1, absentes: 1 }), '[B] les visites d hier suivent la regle de la page Direction : annulees et absentes hors du chiffre, l encaisse reel', g && g.visitesHier);
  ok(g && g.recuesHier.total === 3 && g.recuesHier.enLigne === 1 && g.recuesHier.auComptoir === 2 && g.recuesHier.montantReserve === 220, '[B] les reservations recues hier, par canal, sans la demonstration', g && g.recuesHier);
  ok(g && g.moisEnCours.ca === 350 && g.aujourdhui.aValider === 1 && g.demandesDeGroupe.enAttente === 2, '[B] le mois, aujourd hui, les demandes', g && { mois: g.moisEnCours, aujourdhui: g.aujourdhui, demandes: g.demandesDeGroupe });
  ok(g && JSON.stringify(g.modificationsHier) === JSON.stringify({ annulees: 1, deplacees: 1, prix: 1, reglages: 1, acces: 1, autres: 0, arrivees: 1, encaissements: 0 }), '[B] les modifications d hier, par genre', g && g.modificationsHier);
  const regles = b.bilanEnRegles(f);
  ok(/^Bilan Pinlane du vendredi 13\/11\n/.test(regles) && /\nGEMBLOUX\n/.test(regles) && /\nLIBRAMONT\n/.test(regles) && regles.includes('150,00 €') && regles.includes('Encaissé 90,00 €') && regles.includes('LES AGENTS') && regles.includes('1 mail est revenu à Gembloux') && regles.includes('Valider 1 réservation à Gembloux.'), '[B] le texte des regles dit tout : les centres, l argent, les agents, les problemes, quoi faire', regles);
  ok(!/[\u2014\u2013]/.test(regles) && !PERSONNEL.test(regles), '[B] sans tiret long ni donnee personnelle', regles);

  const appels = [];
  const llm = (texte) => async (options) => { appels.push(options); return texte === null ? null : { text: texte }; };
  const ia = await b.bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: llm(BON_TEXTE) });
  ok(ia.par === 'ia' && ia.texte.startsWith('Bilan Pinlane du vendredi 13/11\n\nEN BREF'), '[B] le texte du chef de garde passe quand chaque nombre vient des faits', ia.texte.slice(0, 200));
  ok(appels[0] && appels[0].budget === 'garde' && appels[0].model === 'claude-sonnet-5-5' && appels[0].effort === 'low' && JSON.parse(appels[0].user).centres.length === 2, '[B] il ecrit sur sa propre caisse, avec Sonnet 5.5 en effort bas, a partir des faits', appels[0] && { budget: appels[0].budget, model: appels[0].model, effort: appels[0].effort });
  ok(!PERSONNEL.test(appels[0] ? appels[0].user : 'Jean'), '[B] aucune donnee personnelle ne part a l IA', appels[0] && appels[0].user.slice(0, 200));
  const invente = await b.bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: llm(BON_TEXTE.replace('150,00 €', '1 950,00 €')) });
  ok(invente.par === 'regles' && /citait un nombre absent des données/.test(invente.texte) && invente.texte.includes('150,00 €'), '[B] un chiffre invente par l IA : c est le texte des regles qui part, et il le dit', invente.texte.slice(-200));
  const tiret = await b.bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: llm(BON_TEXTE.replace('Libramont : rien hier.', 'Libramont \u2014 rien hier.')) });
  ok(tiret.par === 'ia' && !/[\u2014\u2013]/.test(tiret.texte) && tiret.texte.includes('Libramont, rien hier.'), '[B] un tiret long de l IA se remplace, il ne part jamais', tiret.texte.slice(0, 300));
  const oubli = await b.bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: llm(BON_TEXTE.replace(/Libramont/gi, 'l autre centre')) });
  ok(oubli.par === 'regles', '[B] un centre oublie : le texte des regles', oubli.par);
  const muet = await b.bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: llm(null) });
  ok(muet.par === 'regles' && /n’a pas répondu/.test(muet.texte), '[B] l IA ne repond pas (cle, budget, panne) : le texte des regles, toujours', muet.texte.slice(-120));
}

// ---------------------------------------------------------------------------
// [G] La garde entiere.
// ---------------------------------------------------------------------------
function routesDeLaTour({ mailEchoue = false, suivis = false, integrite = false, formulaire = false, arene = 0, horaires = false } = {}) {
  route(/from centers/, () => [
    // `arene` : le nombre d armes que le gerant a regle dans la console pour le laser de Libramont.
    { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', settings: { config: { secours: { emails: ['secours@fungalaxy.be'] }, ...(arene ? { resources: { laser: { weaponCount: arene, parallelLaunches: 1 } } } : {}),
      // `horaires` : le gerant de Libramont a regle le mardi a 12:00 et ouvre exceptionnellement le lundi 16/11.
      ...(horaires ? { defaultSchedule: { regular: { 2: { open: '12:00', close: '22:00' } } }, ouverturesExceptionnelles: [{ date: '2026-11-16', open: '10:00', close: '18:00' }] } : {}) } } },
    { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', settings: { config: { secours: { emails: ['secours@fungalaxy.be'] } } } },
  ]);
  // Les taches sont saines a l heure du passage joue, pas a l heure du banc.
  const sain = (task_name) => { const il = new Date(INSTANT.valeur.getTime() - 600000); return { task_name, status: 'ok', started_at: il, finished_at: il, error: null, dernier_ok: il }; };
  const noms = ['garde', 'sonde', 'secours', 'dispatch-communications', 'ops-jobs', 'sauvegarde', 'agent-orchestrator'];
  route(/distinct on \(task_name\)/, () => noms.map(sain));
  route(/max\(finished_at\) as dernier_ok/, () => noms.map(sain));
  if (mailEchoue) route(/status = 'failed' and channel = 'email'/, () => [{ center_id: 'gembloux', n: 1, dernier: new Date() }]);
  if (suivis) {
    // Au comptoir, six « a verifier » a Libramont (les jours demo de la prod) : seule
    // une requete qui oublie le canal les compte.
    route(/validation_status = 'staff_review' and status = 'pending'/, (s) => [{ center_id: 'gembloux', n: 2 }, ...(/channel = 'public'/.test(s) ? [] : [{ center_id: 'libramont', n: 6 }])]);
    route(/from custom_requests where status = 'new'/, () => [{ center_id: 'libramont', n: 1 }]);
  }
  if (integrite) {
    // Un defaut enregistre par chasseur. A Gembloux, cinq reservations sans mail parce que
    // le gerant a coupe ses confirmations : seule une requete qui oublie le reglage les
    // compte. Avec 'panne', la requete des mails leve comme Postgres sur une faute de frappe.
    route(/and price <= 0 and created_at/, () => [{ center_id: 'gembloux', n: 1 }]);
    route(/not exists \(select 1 from communications c where c\.reservation_id = r\.id/, (s) => {
      if (integrite === 'panne') throw new Error('syntax error at or near "x"');
      return [{ center_id: 'libramont', n: 2 }, ...(/from center_automation_settings s/.test(s) ? [] : [{ center_id: 'gembloux', n: 5 }])];
    });
    route(/b\.lanes && a\.lanes/, () => [{ center_id: 'libramont', n: 1 }]);
    // Le laser, avec le reglage de chaque centre. Libramont (30 armes, une partie a la fois) : le
    // 15/11 deux groupes dans la meme partie de 15:00, 35 joueurs ; le 16/11 deux parties qui se
    // chevauchent, 15:00 et 15:10. Gembloux (20 armes, trois parties a la fois) : trois groupes
    // de six en parties separees, ce qui tient la-bas et ne tiendrait pas a Libramont.
    const arene = (id, centre, date, debut, joueurs) => ({ id, center_id: centre, date, start_time: `${String(Math.floor(debut / 60)).padStart(2, '0')}:${String(debut % 60).padStart(2, '0')}:00`, duration: 1, type: 'laser', pax: joueurs, formule_id: null, lanes: [], status: 'confirmed',
      ops_plan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: debut, end: debut + 20, players: joueurs, countIndex: 1 }] } });
    route(/ops_plan::text like '%laser_arena%'/, () => [...(integrite === 'laserCasse' ? [{ id: 599, center_id: 'libramont', date: '2026-11-15', start_time: '15:00:00', duration: 1, type: 'laser', pax: 4, formule_id: null, lanes: [], status: 'confirmed', ops_plan: { resourceBlocks: [null] } }] : []),arene(501, 'libramont', '2026-11-15', 900, 20), arene(502, 'libramont', '2026-11-15', 900, 15), arene(503, 'libramont', '2026-11-16', 900, 8), arene(504, 'libramont', '2026-11-16', 910, 8),
      arene(601, 'gembloux', '2026-11-15', 900, 6), arene(602, 'gembloux', '2026-11-15', 905, 6), arene(603, 'gembloux', '2026-11-15', 910, 6)]);
    // Les fermetures de Libramont : une soiree privatisee le 15/11 de 18:00 a 24:00, la piste 3
    // le 16/11 toute la journee, le bowling le 17/11 de 14:00 a 16:00. Gembloux n en a aucune.
    const bloc = (id, scope_type, scope_ref, date, start_time, end_time) => ({ id, center_id: 'libramont', scope_type, scope_ref, recurrence: 'once', date, day_of_week: null, date_from: null, date_until: null, start_time, end_time, reason: 'banc', created_by: 'banc' });
    route(/from availability_blocks where center_id = any/, () => [bloc(1, 'center', null, '2026-11-15', '18:00', '24:00'), bloc(2, 'lane', '3', '2026-11-16', null, null), bloc(3, 'activity', 'bowling', '2026-11-17', '14:00', '16:00')]);
    // En ligne : 17:00 pour deux heures traverse la privatisation ; 16:00 pour deux heures finit
    // pile a 18:00 et passe ; la piste 3 ; le bowling bloque ; Gembloux a 17:00, sans fermeture.
    // Le groupe privatise, inscrit au comptoir, n est rendu qu a une requete qui oublie le canal.
    const enLigne = (id, center_id, date, heure, duree, lanes) => ({ id, center_id, date, start_time: `${heure}:00`, duration: duree, total_duration: duree, type: 'bowling', formule_id: null, lanes });
    route(/total_duration, type, formule_id, lanes from reservations/, (s) => [enLigne(701, 'libramont', '2026-11-15', '17:00', 2, [1]), enLigne(702, 'libramont', '2026-11-15', '16:00', 2, [2]), enLigne(703, 'libramont', '2026-11-16', '10:00', 1, [3]),
      enLigne(704, 'libramont', '2026-11-17', '15:00', 1, [5]), enLigne(707, 'libramont', '2026-11-17', '13:00', 1, [6]), enLigne(708, 'libramont', '2026-11-19', '22:00', 1, [6]), enLigne(705, 'gembloux', '2026-11-15', '17:00', 2, [1]), ...(/channel = 'public'/.test(s) ? [] : [enLigne(706, 'libramont', '2026-11-15', '18:00', 4, [4])])]);
  }
  if (formulaire) {
    // Le suivi des ecrans, sur 24 heures. Libramont : 64 visites (14 un jour d 'essais'), 11 arrivees a la validation,
    // aucun envoi. Gembloux : 35 visites commencees, 4 a la validation, aucun envoi. 'envoye' :
    // un envoi compte a Libramont. 'vendu' : une reservation en ligne y est arrivee dans la meme
    // fenetre. 'panne' : la lecture des reservations du jour leve, on ne sait donc pas.
    route(/from formulaire_etapes where parcours = 'reservation'/, () => [{ center_id: 'libramont', n: formulaire === 'essais' ? 14 : 64, valides: 11, finis: formulaire === 'envoye' ? 1 : 0 }, { center_id: 'gembloux', n: 35, valides: 4, finis: 0 }]);
    route(/from reservations where channel = 'public' and created_at > now\(\) - interval '24 hours'/, () => {
      if (formulaire === 'panne') throw new Error('syntax error at or near "x"');
      return formulaire === 'vendu' ? [{ center_id: 'libramont', n: 2 }] : [];
    });
  }
}
const INSTANT = { valeur: new Date('2026-11-14T12:00:00Z') };
async function passe(options = {}) {
  const tour = charger('lib/tour-controle.js');
  TG.length = 0;
  INSTANT.valeur = options.instant || new Date('2026-11-14T12:00:00Z');
  const r = await tour.lancerGarde({ pool, instant: INSTANT.valeur, llm: options.llm || (async () => null) });
  BD.etatGarde = r;
  return { r, messages: TG.slice() };
}
async function preuvesGarde() {
  remettre();
  routesDeLaTour();
  avecGroupe();
  charger('lib/garde-alertes.js').oublierLesAlertes();
  const p1 = await passe();
  ok(p1.messages.length === 4 && p1.messages.every((m) => /^Mise en service de la garde Pinlane\./.test(m.text)) && p1.messages.map((m) => m.message_thread_id).join(',') === '2,3,4,5', '[G] le groupe branche : chaque sujet recoit une fois ce qu il recevra', p1.messages.map((m) => [m.message_thread_id, m.text.slice(0, 50)]));
  ok(p1.r.miseEnService === `${GROUPE}:bilans=5,modifications=4,pannes=2,reservations=3`, '[G] et la garde le retient', p1.r.miseEnService);
  const p2 = await passe();
  ok(p2.messages.length === 0, '[G] au passage suivant : rien', p2.messages);
  ok(/sécurité/.test(p1.messages.find((m) => m.message_thread_id === 2).text) && /sécurité/.test(p1.messages.find((m) => m.message_thread_id === 5).text), '[G] un groupe neuf apprend la garde de securite par la presentation de Pannes et de Bilans', p1.messages.map((m) => m.text.slice(-120)));
  // LA GARDE DE SECURITE AJOUTEE A UN GROUPE DEJA EN SERVICE (la prod du 2026-11-08) : sa
  // presentation part une fois, dans Bilans, et pas deux.
  BD.etatGarde = { ...BD.etatGarde, curseurRefus: null };
  const pS = await passe();
  ok(pS.messages.length === 1 && pS.messages[0].message_thread_id === 5 && /^Mise en service de la garde de sécurité Pinlane\./.test(pS.messages[0].text), '[G] garde de securite ajoutee a un groupe deja en service : sa presentation part dans Bilans', pS.messages.map((m) => [m.message_thread_id, m.text.slice(0, 50)]));
  ok(pS.r.curseurRefus !== null && pS.r.curseurRefus !== undefined, '[G] et la garde retient son curseur', pS.r.curseurRefus);
  const pS2 = await passe();
  ok(pS2.messages.length === 0, '[G] et pas deux fois', pS2.messages);

  BD.routes = [];
  routesDeLaTour({ mailEchoue: true });
  const appels = [];
  const explication = async (o) => { appels.push(o); return { text: 'Un mail de Gembloux n’est pas parti. Le client n’a peut-être pas sa confirmation. Regarder le dossier dans la Tour de contrôle.' }; };
  const p3 = await passe({ llm: explication });
  ok(p3.messages.length === 2 && /^URGENT Pinlane\n1 mail n’est pas parti à Gembloux/.test(p3.messages[0].text) && !p3.messages[0].disable_notification && p3.messages[0].message_thread_id === 2, '[G] une panne neuve sonne dans Pannes', p3.messages.map((m) => m.text));
  ok(p3.messages[1] && /^Le chef de garde :\nUn mail de Gembloux/.test(p3.messages[1].text) && p3.messages[1].disable_notification === true && appels.length === 1 && appels[0].budget === 'garde', '[G] le chef de garde l explique juste apres, sans sonner une deuxieme fois', p3.messages.map((m) => m.text));
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  const p4 = await passe({ llm: async () => ({ text: 'Cela touche 27 clients depuis ce matin.' }) });
  ok(p4.messages.length === 1, '[G] une explication qui invente un nombre ne part pas', p4.messages.map((m) => m.text));
  BD.etatGarde = { ...BD.etatGarde, dits: {}, explications: { jour: '2026-11-14', n: 8 } };
  const appelsCap = [];
  const p5 = await passe({ llm: async (o) => { appelsCap.push(o); return { text: 'ok' }; } });
  ok(p5.messages.length === 1 && appelsCap.length === 0, '[G] huit explications par jour au plus', { messages: p5.messages.length, appels: appelsCap.length });

  BD.routes = [];
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  routesDeLaTour({ suivis: true });
  const p6 = await passe();
  ok(p6.messages.length === 1 && /^À regarder, Pinlane\n/.test(p6.messages[0].text) && p6.messages[0].text.includes('2 réservations en ligne attendent la validation de l’équipe à Gembloux') && p6.messages[0].text.includes('1 demande de groupe attend une réponse à Libramont') && p6.messages[0].disable_notification === true, '[G] les suivis : a valider depuis 2 h, demande sans reponse depuis 24 h, dits sans sonnerie', p6.messages.map((m) => m.text));
  ok(!/la validation de l’équipe à Libramont/.test(p6.messages[0].text), '[G] les « a verifier » du comptoir ne passent pas pour un client qui attend', p6.messages[0].text);

  // Les chasseurs d integrite : trois defauts enregistres en base, dits ensemble, sans sonnerie.
  const etatApresSuivis = BD.etatGarde;
  BD.routes = [];
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  routesDeLaTour({ integrite: true });
  const p6b = await passe();
  const t6b = p6b.messages.length === 1 ? p6b.messages[0].text : '';
  ok(/^À regarder, Pinlane\n/.test(t6b) && p6b.messages[0].disable_notification === true && t6b.includes('1 réservation en ligne est enregistrée à 0 € à Gembloux') && t6b.includes('2 réservations en ligne n’ont reçu aucun mail à Libramont') && t6b.includes('1 double réservation de bowling sur la même piste à Libramont'), '[G] integrite : prix a 0, reservation sans mail, double piste, dits sans sonnerie', p6b.messages.map((m) => m.text));
  ok(t6b !== '' && !/reçu aucun mail à Gembloux/.test(t6b), '[G] integrite : un centre qui a coupe ses confirmations ne passe pas pour un mail perdu', t6b);
  {
    // LE LASER TROP PLEIN (2026-11-10) : la meme regle que le refus, avec le reglage de chaque centre.
    BD.routes = [];
    routesDeLaTour({ integrite: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    const l = problemes.find((p) => p.cle === 'integrite:laser:libramont') || {};
    ok(t6b.includes('3 départs laser dépassent ce que l’arène peut prendre à Libramont') && l.gravite === 'attention', '[G] integrite : un laser trop plein se dit, sans sonnerie', `${l.gravite} | ${t6b}`);
    ok(l.detail === 'Dans les 14 prochains jours, le 15/11 à 15:00, 35 joueurs pour 30 armes ; le 16/11 à 15:00, 2 parties en même temps pour 1 ; le 16/11 à 15:10, 2 parties en même temps pour 1. À vérifier dans le planning, un groupe est peut-être à déplacer.',
      '[G] integrite : le laser compte les armes ET les parties en meme temps, depart par depart', l.detail);
    ok(!problemes.some((p) => p.cle === 'integrite:laser:gembloux'), '[G] integrite : trois parties separees de six tiennent a Gembloux (20 armes, trois parties) : chaque centre garde son arene', problemes.map((p) => p.cle).join(', '));
    // LE REGLAGE DE LA CONSOLE (2026-11-10) : 40 armes reglees a Libramont, les 35 joueurs du 15/11 tiennent.
    BD.routes = [];
    routesDeLaTour({ integrite: true, arene: 40 });
    const regle = ((await charger('lib/tour-controle.js').lireProblemes(pool)).problemes.find((p) => p.cle === 'integrite:laser:libramont')) || {};
    ok(/^2 départs laser/.test(regle.titre || '') && !/35 joueurs/.test(regle.detail || ''), '[G] integrite : le laser compte avec les armes reglees dans la console, pas celles du fichier', `${regle.titre} | ${regle.detail}`);
    BD.routes = [];
    routesDeLaTour({ integrite: true });
    await charger('lib/tour-controle.js').lireProblemes(pool);
    // UN CALCUL QUI LEVE NE COUCHE PAS LA SECTION (2026-11-10) : un plan au bloc vide fait lever le laser.
    BD.routes = [];
    routesDeLaTour({ integrite: 'laserCasse' });
    const casse = (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes;
    ok(casse.some((p) => p.cle === 'integrite:prix-zero:gembloux') && casse.some((p) => p.cle === 'integrite:fermeture:libramont') && casse.some((p) => p.cle === 'integrite:illisible' && /laser, calcul/.test(p.titre)) && !casse.some((p) => p.cle === 'integrite:laser:libramont'),
      '[G] integrite : un calcul laser qui leve se dit, et les autres chasseurs parlent quand meme', casse.map((p) => `${p.cle} ${p.titre}`).join(' | '));
    BD.routes = [];
    routesDeLaTour({ integrite: true });
    // LA RESERVATION EN LIGNE SUR UNE FERMETURE (2026-11-10).
    const f = problemes.find((p) => p.cle === 'integrite:fermeture:libramont') || {};
    ok(t6b.includes('3 réservations en ligne tombent sur une fermeture à Libramont') && f.gravite === 'attention', '[G] integrite : une reservation en ligne sur une fermeture se dit, sans sonnerie', `${f.gravite} | ${t6b}`);
    ok(f.detail === 'Dans les 14 prochains jours, le 15/11 à 17:00, centre fermé ; le 16/11 à 10:00, piste 3 bloquée ; le 17/11 à 15:00, bowling bloqué. Le client n’en sait rien, il est à appeler ou à déplacer.',
      '[G] integrite : la fermeture compte toute la visite (17:00 pour deux heures), une piste et une activite bloquees, et laisse passer la visite qui finit pile a la fermeture', f.detail);
    ok(!problemes.some((p) => p.cle === 'integrite:fermeture:gembloux'), '[G] integrite : les fermetures de Libramont ne touchent pas Gembloux', problemes.map((p) => p.cle).join(', '));
    // LA RESERVATION EN LIGNE HORS DES HORAIRES (2026-11-10). Libramont : ferme le lundi, mardi et jeudi de 14:00 a 22:00.
    const h = problemes.find((p) => p.cle === 'integrite:horaires:libramont') || {};
    ok(t6b.includes('3 réservations en ligne tombent hors des horaires à Libramont') && h.gravite === 'attention', '[G] integrite : une reservation en ligne hors des horaires se dit, sans sonnerie', `${h.gravite} | ${t6b}`);
    ok(h.detail === 'Dans les 14 prochains jours, le 16/11 à 10:00, le centre est fermé ce jour-là ; le 17/11 à 13:00, le centre ouvre à 14:00 ; le 19/11 à 22:00, le centre ferme à 22:00. Les horaires ont sans doute changé après la réservation, le client est à appeler ou à déplacer.',
      '[G] integrite : jour ferme, arrivee avant l ouverture, arrivee a la fermeture ; une arrivee dans les horaires ne se dit pas', h.detail);
    ok(!problemes.some((p) => p.cle === 'integrite:horaires:gembloux'), '[G] integrite : Gembloux, dans ses horaires, ne se dit pas', problemes.map((p) => p.cle).join(', '));
    BD.routes = [];
    routesDeLaTour({ integrite: true, horaires: true });
    const regles = ((await charger('lib/tour-controle.js').lireProblemes(pool)).problemes.find((p) => p.cle === 'integrite:horaires:libramont')) || {};
    ok(/^1 réservation en ligne tombe hors des horaires/.test(regles.titre || '') && /le 19\/11 à 22:00/.test(regles.detail || ''), '[G] integrite : les horaires regles dans la console et une ouverture exceptionnelle comptent (mardi 12:00, lundi 16/11 ouvert)', `${regles.titre} | ${regles.detail}`);
    BD.routes = [];
    routesDeLaTour({ integrite: true });
    await charger('lib/tour-controle.js').lireProblemes(pool);
  }

  BD.routes = [];
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  routesDeLaTour({ integrite: 'panne' });
  const p6c = await passe();
  const t6c = p6c.messages.map((m) => m.text).join('\n');
  ok(p6c.messages.length === 1 && /^À regarder, Pinlane\n/.test(t6c) && p6c.messages[0].disable_notification === true && !/URGENT/.test(t6c) && t6c.includes('Un contrôle des réservations ne se lit pas (sans mail)'), '[G] integrite : une requete qui echoue se dit calmement, jamais en URGENT', p6c.messages.map((m) => m.text));
  ok(t6c.includes('enregistrée à 0 € à Gembloux') && t6c.includes('double réservation de bowling sur la même piste à Libramont'), '[G] integrite : un controle illisible n arrete pas les deux autres', t6c);

  // Le formulaire qui ne laisse plus reserver (2026-11-10) : onze visites a la validation sans un
  // envoi sonnent, trente-cinq visites commencees sans un envoi se disent sans sonnerie.
  BD.routes = [];
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  routesDeLaTour({ formulaire: true });
  const p6d = await passe();
  // Une seule annonce porte tout : la panne sonne, et ce qui est « a regarder » la suit dans le meme message.
  const urgent6d = p6d.messages.find((m) => /^URGENT Pinlane\n/.test(m.text)) || { text: '', disable_notification: true };
  ok(p6d.messages.length === 1 && urgent6d.text.includes('Le formulaire de Libramont ne laisse sans doute plus réserver : 11 visites à la validation, aucun envoi') && urgent6d.disable_notification !== true && !/Gembloux ne laisse/.test(urgent6d.text), '[G] formulaire : onze visites a la validation et aucun envoi, ca sonne pour ce centre et pour lui seul', p6d.messages.map((m) => m.text).join(' // '));
  ok(Array.isArray(p6d.r.critiques) && p6d.r.critiques.length === 1 && p6d.r.critiques[0].cle === 'formulaire:bloque:libramont' && p6d.r.critiques[0].centre === 'libramont' && /ne laisse sans doute plus réserver/.test(p6d.r.critiques[0].titre) && /Depuis 24 heures/.test(p6d.r.critiques[0].detail) && Object.keys(p6d.r.critiques[0]).sort().join(',') === 'centre,cle,detail,titre',
    '[G] la garde range en clair l alerte qui sonne (cle, centre, titre, detail), pour le veilleur de reparation', JSON.stringify(p6d.r.critiques));
  // Libramont vend en ligne : il ne reste que les trente-cinq visites de Gembloux, sans sonnerie.
  BD.routes = [];
  BD.etatGarde = { ...BD.etatGarde, dits: {} };
  routesDeLaTour({ formulaire: 'vendu' });
  const p6e = await passe();
  const calme6e = p6e.messages.length === 1 ? p6e.messages[0] : { text: p6e.messages.map((m) => m.text).join(' // ') };
  ok(/^À regarder, Pinlane\n/.test(calme6e.text) && calme6e.text.includes('35 visites ont commencé le formulaire de Gembloux, aucune n’est allée au bout') && calme6e.disable_notification === true && !/Libramont/.test(calme6e.text), '[G] formulaire : trente-cinq visites commencees sans un envoi se disent sans sonnerie', calme6e.text);
  ok(Array.isArray(p6e.r.critiques) && p6e.r.critiques.length === 0, '[G] une alerte « a regarder » n entre pas dans les alertes qui sonnent', JSON.stringify(p6e.r.critiques));
  const lireAvec = async (formulaire) => { BD.routes = []; routesDeLaTour({ formulaire }); return (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes; };
  const vendu = await lireAvec('vendu');
  ok(!vendu.some((p) => /^formulaire:.*:libramont$/.test(p.cle)) && vendu.some((p) => p.cle === 'formulaire:personne-au-bout:gembloux' && p.gravite === 'attention'), '[G] formulaire : une reservation en ligne arrivee dans la fenetre prouve qu il marche, rien ne se dit pour ce centre', vendu.map((p) => p.cle).join(' '));
  const envoye = await lireAvec('envoye');
  ok(!envoye.some((p) => /^formulaire:.*:libramont$/.test(p.cle)), '[G] formulaire : un seul envoi compte suffit a le dire vivant', envoye.map((p) => p.cle).join(' '));
  const sansLecture = await lireAvec('panne');
  ok(!sansLecture.some((p) => /^formulaire:/.test(p.cle)) && sansLecture.some((p) => p.cle === 'integrite:illisible' && p.gravite === 'attention' && /réservations en ligne du jour/.test(p.titre)) && !sansLecture.some((p) => String(p.cle).startsWith('lecture:')),
    '[G] formulaire : si les reservations du jour ne se lisent pas, rien ne se dit du formulaire, et le controle illisible se dit calmement', sansLecture.map((p) => `${p.cle}=${p.gravite}`).join(' '));
  const essais = await lireAvec('essais');
  ok(essais.some((p) => p.cle === 'formulaire:bloque:libramont' && p.gravite === 'attention') && !essais.some((p) => /^formulaire:/.test(p.cle) && p.gravite === 'critique'), '[G] formulaire : un jour d essais (14 visites dont 11 a la validation) se dit sans sonnerie', essais.map((p) => `${p.cle}=${p.gravite}`).join(' '));
  const calmeAussi = await lireAvec(false);
  ok(!calmeAussi.some((p) => /^formulaire:/.test(p.cle)), '[G] formulaire : sans visite comptee, aucune alerte', calmeAussi.map((p) => p.cle).join(' '));
  BD.etatGarde = etatApresSuivis;

  BD.routes = [];
  routesDeLaTour();
  routesDuBilan();
  BD.etatGarde = { ...BD.etatGarde, dits: {}, bilanDu: '2026-11-13' };
  const p7 = await passe({ instant: MATIN, llm: async () => ({ text: BON_TEXTE }) });
  const bilan = p7.messages.filter((m) => m.message_thread_id === 5);
  ok(bilan.length === 1 && /^Bilan Pinlane du vendredi 13\/11\n\nEN BREF/.test(bilan[0].text) && bilan[0].disable_notification === true && p7.r.bilanPar === 'ia', '[G] a 8 h 30, le bilan du chef de garde dans Bilans, sans sonnerie', p7.messages.map((m) => [m.message_thread_id, m.text.slice(0, 60)]));
  const p8 = await passe({ instant: new Date('2026-11-14T08:00:00Z'), llm: async () => ({ text: BON_TEXTE }) });
  ok(!p8.messages.some((m) => m.message_thread_id === 5), '[G] un seul bilan par matin', p8.messages.length);
  BD.etatGarde = { ...BD.etatGarde, bilanDu: '2026-11-13' };
  const p9 = await passe({ instant: new Date('2026-11-14T10:30:00Z'), llm: async () => ({ text: BON_TEXTE }) });
  ok(!p9.messages.some((m) => m.message_thread_id === 5), '[G] pas parti avant 11 h : il saute le jour', p9.messages.length);

  BD.routes = [];
  routesDeLaTour();
  routesDuJournal(journalDuBanc());
  BD.etatGarde = { ...BD.etatGarde, curseurAudit: 100 };
  const p10 = await passe();
  ok(p10.messages.some((m) => m.message_thread_id === 4 && /^Modifications/.test(m.text)) && p10.r.curseurAudit === 111, '[G] la garde relit le journal et avance son curseur', { curseur: p10.r.curseurAudit, sujets: p10.messages.map((m) => m.message_thread_id) });
  sansGroupe();
}

// ---------------------------------------------------------------------------
// [K] La caisse du chef de garde.
// ---------------------------------------------------------------------------
async function preuvesCaisse() {
  remettre();
  BD.depenses = [];
  route(/^insert into llm_spend/, (s, p) => { BD.depenses.push(p[0]); return []; });
  const budget = charger('lib/llm-budget.js');
  budget.__resetForTests();
  budget.recordSpend(1.5, 'garde');
  ok(!budget.isBudgetExhausted('garde') && budget.getMonthlySpend('commun') === 0, '[K] la depense du chef de garde ne touche pas la caisse commune', { garde: budget.getMonthlySpend('garde'), commun: budget.getMonthlySpend('commun') });
  budget.recordSpend(0.6, 'garde');
  ok(budget.isBudgetExhausted('garde') && !budget.isBudgetExhausted('commun'), '[K] au-dela de 2 $, le chef de garde se tait (le texte des regles part)', budget.budgetStatus('garde'));
  await attendre(20);
  ok(BD.depenses.length === 2 && BD.depenses.every((m) => /^\d{4}-\d{2}:garde$/.test(m)), '[K] sa depense s ecrit sur sa propre ligne de llm_spend', BD.depenses);
  budget.__resetForTests();
  budget.recordSpend(5.07, 'commun');
  process.env.ANTHROPIC_API_KEY = 'banc';
  LLM.length = 0;
  const { callLlm } = charger('lib/llm-client.js');
  const r = await callLlm({ system: 's', user: '{}', budget: 'garde', model: 'claude-sonnet-5-5', effort: 'low', usage: 'garde', maxTokens: 100 });
  delete process.env.ANTHROPIC_API_KEY;
  ok(r && r.text === 'réponse du banc' && LLM.length === 1 && LLM[0].model === 'claude-sonnet-5-5' && LLM[0].output_config && LLM[0].output_config.effort === 'low', '[K] la caisse commune vide (comme en octobre) n empeche pas le bilan, et l appel porte le modele et l effort', LLM[0]);
  budget.__resetForTests();
}

// ---------------------------------------------------------------------------
// [X] Les contre-preuves : le poste casse expres doit rougir.
// ---------------------------------------------------------------------------
async function contrePreuves() {
  const rouge = async (nom, edits, rejouer) => {
    mutations = edits;
    purger();
    let tient;
    try {
      tient = await rejouer();
    } catch (error) {
      tient = false;
    }
    mutations = [];
    purger();
    ok(tient === false, `[X] ${nom} : rougit`);
  };
  const silencieuxLu = async () => {
    avecGroupe();
    TG.length = 0;
    await charger('lib/garde-alertes.js').envoyerTelegram('x', { sujet: 'reservations' });
    sansGroupe();
    return TG[0] && TG[0].disable_notification === true;
  };
  await rouge('une reservation qui sonne comme une panne', [{ fichier: 'lib/garde-alertes.js', de: '  if (silencieux) corps.disable_notification = true;\n', vers: '' }], silencieuxLu);
  await rouge('un groupe qui refuse perd le message', [{ fichier: 'lib/garde-alertes.js', de: '    if (!dest.groupe || !r.refus) return r;\n', vers: '    return r;\n' }], async () => {
    avecGroupe();
    TG.length = 0;
    tgMode = 'refusGroupe';
    const r = await charger('lib/garde-alertes.js').envoyerTelegram('y', { sujet: 'pannes' });
    tgMode = 'ok';
    sansGroupe();
    return r.ok && TG.length === 1;
  });
  await rouge('une rafale noie Ansar', [{ fichier: 'lib/garde-alertes.js', de: '  if (rafale.n > RAFALE_MAX) {', vers: '  if (false) {' }], async () => {
    TG.length = 0;
    const a = charger('lib/garde-alertes.js');
    const t0 = Date.parse('2026-11-15T12:00:00Z');
    for (let i = 0; i < 14; i += 1) await a.alerter(`r-${i}`, `p ${i}`, { maintenant: t0 + i });
    return TG.length === 13;
  });
  await rouge('une reservation de demonstration s annonce', [{ fichier: 'lib/garde-annonces.js', de: "    if (!reservation || isFabricatedReservation(reservation)) return 'essai';", vers: "    if (!reservation) return 'essai';" }], async () => {
    TG.length = 0;
    return (await charger('lib/garde-annonces.js').annoncerReservation({ ...RESA, email: 'x@demo.fungalaxy.test' })) === 'essai' && TG.length === 0;
  });
  await rouge('une annonce qui cite le client', [{ fichier: 'lib/garde-annonces.js', de: '  lignes.push(`Réservation n° ${r.id}`);', vers: '  lignes.push(`Réservation n° ${r.id} ${r.name}`);' }], async () => !PERSONNEL.test(charger('lib/garde-annonces.js').texteReservation(RESA)));
  const journalRejoue = async () => {
    remettre();
    routesDuJournal(journalDuBanc());
    avecGroupe();
    TG.length = 0;
    const r = await charger('lib/garde-journal.js').relireLeJournal(pool, 100);
    sansGroupe();
    return r;
  };
  await rouge('une annonce partie se redit', [{ fichier: 'lib/garde-journal.js', de: "  if (['ok', 'essai'].includes(l.annonce)) return { ok: true, rien: true };", vers: '' }], async () => {
    await journalRejoue();
    return !TG.some((m) => /Réservation n° 902/.test(m.text));
  });
  await rouge('un message perdu fait avancer le curseur', [{ fichier: 'lib/garde-journal.js', de: 'return { curseur: envois.every(Boolean) ? dernier : Number(curseur),', vers: 'return { curseur: dernier,' }], async () => {
    tgMode = 'coupe';
    const r = await journalRejoue();
    tgMode = 'ok';
    return r.curseur === 100;
  });
  await rouge('une action inconnue disparait en silence', [{ fichier: 'lib/garde-journal.js', de: '  return { ligne: `action « ${String(l.action).slice(0, 60)} » (la garde ne la connaît pas encore)` };', vers: '  return { rien: true };' }], async () => {
    await journalRejoue();
    return TG.some((m) => /actionInconnueDemain/.test(m.text));
  });
  await rouge('une panne du serveur ne sonne plus', [{ fichier: 'lib/garde-serveur.js', de: '    return await alerter(\n', vers: '    return await (async () => ({}))(\n' }], async () => {
    remettre();
    TG.length = 0;
    await charger('lib/garde-serveur.js').signalerPanneServeur('api/x', new Error('panne x'));
    return TG.length === 1;
  });
  await rouge('la console qui plante ne previent plus', [{ fichier: 'api/ops.js', de: '        await alerter(`console:${centre}:${empreinte}`,', vers: '        await (async () => ({}))(`console:${centre}:${empreinte}`,' }], async () => {
    remettre();
    TG.length = 0;
    await appeler(monterOps(), 'POST', '/api/ops?action=logClientError', { action: 'logClientError', centerId: 'gembloux', page: 'planning', message: 'boum', stack: 'Error: boum\n    at y (app-main.js:1:1)' });
    return TG.length === 1;
  });
  await rouge('une tache en echec se tait', [{ fichier: 'lib/cron-tasks.js', de: "    if (degraded) await alerterTache(taskName, result.message || 'traitement partiellement ou totalement échoué');\n", vers: '' }], async () => {
    remettre();
    TG.length = 0;
    await charger('lib/cron-tasks.js').recordWorkerTask('secours', async () => ({ ok: false, message: 'x' }));
    return TG.length === 1;
  });
  await rouge('un mail revenu ne sonne plus', [{ fichier: 'lib/garde-mails.js', de: "const SONNENT = new Set(['bounced', 'complained', 'failed']);", vers: 'const SONNENT = new Set([]);' }], async () => {
    remettre();
    route(/from communications c left join \(select id, date, start_time from reservations where /, () => [{ id: 58, center_id: 'gembloux', template_id: 'confirmation', reservation_id: 1, date: '2026-11-14', start_time: '15:00' }]);
    TG.length = 0;
    await charger('lib/garde-mails.js').alerterEvenementMail({ ok: true, deduped: false, communicationId: 58, type: 'bounced' });
    return TG.length === 1;
  });
  await rouge('une reservation du comptoir passe pour un client qui attend', [{ fichier: 'lib/tour-controle.js', de: " and channel = 'public' and date >= $1::date", vers: ' and date >= $1::date' }], async () => {
    remettre();
    BD.routes = [];
    routesDeLaTour({ suivis: true });
    BD.etatGarde = null;
    sansGroupe();
    const p = await passe();
    return p.messages.length === 1 && /2 réservations en ligne attendent la validation de l’équipe à Gembloux/.test(p.messages[0].text) && !/la validation de l’équipe à Libramont/.test(p.messages[0].text);
  });
  await rouge('un chiffre invente par l IA passe', [{ fichier: 'lib/garde-bilan.js', de: '  const inconnus = [...new Set(nombres(propre).filter((n) => !permis.has(n)))];', vers: '  const inconnus = [];' }], async () => {
    remettre();
    routesDuBilan();
    const r = await charger('lib/garde-bilan.js').bilanDuMatin(pool, { tour: { centres: CENTRES, taches: TACHES_SAINES, problemes: [] }, instant: MATIN, llm: async () => ({ text: BON_TEXTE.replace('150,00 €', '1 950,00 €') }) });
    return r.par === 'regles';
  });
  await rouge('le bilan part l apres-midi', [{ fichier: 'lib/tour-controle.js', de: '  if (heure >= HEURE_BILAN && heure < FIN_BILAN && bilanDu !== jour) {', vers: '  if (heure >= HEURE_BILAN && bilanDu !== jour) {' }], async () => {
    remettre();
    routesDeLaTour();
    BD.etatGarde = { dits: {}, bilanDu: '2026-11-13' };
    const p = await passe({ instant: new Date('2026-11-14T13:00:00Z') });
    return !p.messages.some((m) => /^Bilan Pinlane/.test(m.text));
  });
  await rouge('la mise en service se repete', [{ fichier: 'lib/tour-controle.js', de: '  if (signature && miseEnService !== signature) {', vers: '  if (signature) {' }], async () => {
    remettre();
    routesDeLaTour();
    avecGroupe();
    await passe();
    const p = await passe();
    sansGroupe();
    return p.messages.length === 0;
  });
  await rouge('le chef de garde explique sans limite', [{ fichier: 'lib/tour-controle.js', de: 'if (critiques.length && partis && explications.n < EXPLICATIONS_PAR_JOUR) {', vers: 'if (critiques.length && partis) {' }], async () => {
    remettre();
    routesDeLaTour({ mailEchoue: true });
    BD.etatGarde = { dits: {}, explications: { jour: '2026-11-14', n: 8 } };
    const appels = [];
    await passe({ llm: async (o) => { appels.push(o); return { text: 'Un mail n’est pas parti.' }; } });
    return appels.length === 0;
  });
  await rouge('une reservation a valider qui attend ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: '    out.push({ cle: `suivi:a-valider:${l.center_id}`,', vers: '    if (false) out.push({ cle: `suivi:a-valider:${l.center_id}`,' }], async () => {
    remettre();
    routesDeLaTour({ suivis: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'suivi:a-valider:gembloux');
  });
  await rouge('une reservation en ligne a 0 euro ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: '    out.push({ cle: `integrite:prix-zero:${l.center_id}`,', vers: '    if (false) out.push({ cle: `integrite:prix-zero:${l.center_id}`,' }], async () => {
    remettre();
    routesDeLaTour({ integrite: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'integrite:prix-zero:gembloux' && p.gravite === 'attention');
  });
  await rouge('une reservation en ligne sans mail ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: '    out.push({ cle: `integrite:sans-mail:${l.center_id}`,', vers: '    if (false) out.push({ cle: `integrite:sans-mail:${l.center_id}`,' }], async () => {
    remettre();
    routesDeLaTour({ integrite: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'integrite:sans-mail:libramont' && p.gravite === 'attention');
  });
  await rouge('un centre qui a coupe ses confirmations passe pour un mail perdu', [{ fichier: 'lib/tour-controle.js', de: " and not exists (select 1 from center_automation_settings s where s.center_id = r.center_id and (s.settings->'confirmation'->>'enabled' = 'false' or s.settings->'request_received'->>'enabled' = 'false'))", vers: '' }], async () => {
    remettre();
    routesDeLaTour({ integrite: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'integrite:sans-mail:libramont') && !problemes.some((p) => p.cle === 'integrite:sans-mail:gembloux');
  });
  await rouge('une double reservation de piste ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: '    out.push({ cle: `integrite:doublon:${l.center_id}`,', vers: '    if (false) out.push({ cle: `integrite:doublon:${l.center_id}`,' }], async () => {
    remettre();
    routesDeLaTour({ integrite: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'integrite:doublon:libramont' && p.gravite === 'attention');
  });
  const problemesLaser = async () => { remettre(); routesDeLaTour({ integrite: true }); return (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes; };
  const laserDeLibramont = async () => (await problemesLaser()).find((p) => p.cle === 'integrite:laser:libramont') || {};
  await rouge('un laser trop plein ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: "        out.push({ cle: `integrite:laser:${centre}`,", vers: "        if (false) out.push({ cle: `integrite:laser:${centre}`," }], async () => (await laserDeLibramont()).gravite === 'attention');
  await rouge('les armes de l arene ne comptent plus', [{ fichier: 'lib/ops-engine.js', de: "    if (joueurs <= armes && parties <= max) return;", vers: "    if (parties <= max) return;" }], async () => /35 joueurs pour 30 armes/.test((await laserDeLibramont()).detail || ''));
  await rouge('les parties en meme temps ne comptent plus', [{ fichier: 'lib/ops-engine.js', de: "    if (joueurs <= armes && parties <= max) return;", vers: "    if (joueurs <= armes) return;" }], async () => /^3 départs/.test((await laserDeLibramont()).titre || ''));
  await rouge('chaque centre ne garde plus son arene', [{ fichier: 'lib/tour-controle.js', de: "surchargesLaser(liste, getCenter(centre))", vers: "surchargesLaser(liste, getCenter('libramont'))" }], async () => !(await problemesLaser()).some((p) => p.cle === 'integrite:laser:gembloux'));
  await rouge('le laser compte avec le fichier, pas avec la console', [{ fichier: 'lib/tour-controle.js', de: "    try { await require('./ops-knowledge').refreshCenterOverrides(pool, { force: true }); } catch (error) { /* socle fichier */ }\n", vers: '' }], async () => { remettre(); routesDeLaTour({ integrite: true, arene: 40 }); const l = (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes.find((p) => p.cle === 'integrite:laser:libramont') || {}; const tient = /^2 départs laser/.test(l.titre || ''); remettre(); routesDeLaTour({ integrite: true }); await charger('lib/tour-controle.js').lireProblemes(pool); return tient; });
  await rouge('un calcul laser qui leve couche toute la section integrite', [{ fichier: 'lib/tour-controle.js', de: "    illisibles.push('laser, calcul');", vers: '    throw error;' }], async () => { remettre(); routesDeLaTour({ integrite: 'laserCasse' }); const p = (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes; return p.some((x) => x.cle === 'integrite:prix-zero:gembloux'); });
  const fermetureDeLibramont = async () => (await problemesLaser()).find((p) => p.cle === 'integrite:fermeture:libramont') || {};
  await rouge('une reservation en ligne sur une fermeture ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: "        out.push({ cle: `integrite:fermeture:${centre}`,", vers: "        if (false) out.push({ cle: `integrite:fermeture:${centre}`," }], async () => (await fermetureDeLibramont()).gravite === 'attention');
  await rouge('la fermeture ne regarde plus que l heure de depart', [{ fichier: 'lib/tour-controle.js', de: "AB.isCenterClosedDuring(blocs, r.date, s, e)", vers: "AB.isCenterClosedAt(blocs, r.date, s)" }], async () => /le 15\/11 à 17:00, centre fermé/.test((await fermetureDeLibramont()).detail || ''));
  await rouge('les fermetures d un centre touchent l autre', [{ fichier: 'lib/tour-controle.js', de: "        const blocs = blocsDe.get(r.centerId) || [];", vers: "        const blocs = [...blocsDe.values()].flat();" }], async () => !(await problemesLaser()).some((p) => p.cle === 'integrite:fermeture:gembloux'));
  await rouge('une piste bloquee ne compte plus', [{ fichier: 'lib/tour-controle.js', de: "        for (const piste of r.lanes) if", vers: "        for (const piste of []) if" }], async () => /piste 3 bloquée/.test((await fermetureDeLibramont()).detail || ''));
  await rouge('une privatisation inscrite au comptoir passe pour un client perdu', [{ fichier: 'lib/tour-controle.js', de: "from reservations where channel = 'public' and status <> 'cancelled' and date >= $1::date and date < $1::date + 14", vers: "from reservations where status <> 'cancelled' and date >= $1::date and date < $1::date + 14" }], async () => /^3 réservations/.test((await fermetureDeLibramont()).titre || ''));
  const horairesDeLibramont = async (options = {}) => { remettre(); routesDeLaTour({ integrite: true, ...options }); const p = (await charger('lib/tour-controle.js').lireProblemes(pool)).problemes.find((x) => x.cle === 'integrite:horaires:libramont') || {}; if (options.horaires) { remettre(); routesDeLaTour({ integrite: true }); await charger('lib/tour-controle.js').lireProblemes(pool); } return p; };
  await rouge('une reservation en ligne hors des horaires ne se dit plus', [{ fichier: 'lib/tour-controle.js', de: "        out.push({ cle: `integrite:horaires:${centre}`,", vers: "        if (false) out.push({ cle: `integrite:horaires:${centre}`," }], async () => (await horairesDeLibramont()).gravite === 'attention');
  await rouge('un jour ferme ne compte plus', [{ fichier: 'lib/tour-controle.js', de: "        if (!h) pourquoi = 'le centre est fermé ce jour-là';", vers: '        if (!h) continue;' }], async () => /fermé ce jour-là/.test((await horairesDeLibramont()).detail || ''));
  await rouge('une arrivee avant l ouverture ne compte plus', [{ fichier: 'lib/tour-controle.js', de: "        else if (s < Math.round(Number(h.open) * 60)) pourquoi = `le centre ouvre à ${hh(h.open)}`;", vers: '        else if (false) pourquoi = String(hh(h.open));' }], async () => /ouvre à 14:00/.test((await horairesDeLibramont()).detail || ''));
  await rouge('une arrivee pile a la fermeture ne compte plus', [{ fichier: 'lib/tour-controle.js', de: "        else if (s >= Math.round(Number(h.close) * 60)) pourquoi = `le centre ferme à ${hh(h.close)}`;", vers: "        else if (s > Math.round(Number(h.close) * 60)) pourquoi = `le centre ferme à ${hh(h.close)}`;" }], async () => /ferme à 22:00/.test((await horairesDeLibramont()).detail || ''));
  await rouge('une ouverture exceptionnelle passe pour un jour ferme', [{ fichier: 'lib/tour-controle.js', de: "        const h = pourLEquipe(() => getSchedule(r.date, getCenter(r.centerId)));", vers: '        const h = getSchedule(r.date, getCenter(r.centerId));' }], async () => /^1 réservation /.test((await horairesDeLibramont({ horaires: true })).titre || ''));
  await rouge('les horaires se lisent au fichier, pas a la console', [{ fichier: 'lib/tour-controle.js', de: "    try { await require('./ops-knowledge').refreshCenterOverrides(pool, { force: true }); } catch (error) { /* socle fichier */ }\n", vers: '' }], async () => /^1 réservation /.test((await horairesDeLibramont({ horaires: true })).titre || ''));
  await rouge('un formulaire qui ne laisse plus reserver ne sonne plus', [{ fichier: 'lib/tour-controle.js', de: "gravite: Number(v.n) >= SEUIL_VISITES_POUR_SONNER ? 'critique' : 'attention',", vers: "gravite: 'attention'," }], async () => {
    remettre();
    routesDeLaTour({ formulaire: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'formulaire:bloque:libramont' && p.gravite === 'critique');
  });
  await rouge('une alerte « a regarder » lance une reparation', [{ fichier: 'lib/tour-controle.js', de: "critiques: problemesGarde.filter((p) => p.gravite === 'critique').map(", vers: 'critiques: problemesGarde.map(' }], async () => {
    remettre();
    routesDeLaTour({ formulaire: 'vendu' });
    const p = await passe();
    return Array.isArray(p.r.critiques) && p.r.critiques.length === 0;
  });
  await rouge('un jour d essais fait sonner le formulaire', [{ fichier: 'lib/tour-controle.js', de: "gravite: Number(v.n) >= SEUIL_VISITES_POUR_SONNER ? 'critique' : 'attention',", vers: "gravite: 'critique'," }], async () => {
    remettre();
    routesDeLaTour({ formulaire: 'essais' });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'formulaire:bloque:libramont' && p.gravite === 'attention');
  });
  await rouge('trente visites sans un envoi ne se disent plus', [{ fichier: 'lib/tour-controle.js', de: '    else if (Number(v.n) >= SEUIL_VISITES_SANS_ENVOI) out.push(', vers: '    else if (false) out.push(' }], async () => {
    remettre();
    routesDeLaTour({ formulaire: true });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'formulaire:personne-au-bout:gembloux' && p.gravite === 'attention');
  });
  await rouge('une reservation arrivee ne fait plus taire l alerte du formulaire', [{ fichier: 'lib/tour-controle.js', de: ' || arrivees.some((a) => a.center_id === v.center_id)) continue;', vers: ') continue;' }], async () => {
    remettre();
    routesDeLaTour({ formulaire: 'vendu' });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return !problemes.some((p) => p.cle === 'formulaire:bloque:libramont');
  });
  await rouge('un envoi compte ne fait plus taire l alerte du formulaire', [{ fichier: 'lib/tour-controle.js', de: '    if (Number(v.finis) > 0 || arrivees.some(', vers: '    if (arrivees.some(' }], async () => {
    remettre();
    routesDeLaTour({ formulaire: 'envoye' });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return !problemes.some((p) => p.cle === 'formulaire:bloque:libramont');
  });
  await rouge('des reservations du jour illisibles laissent sonner le formulaire', [{ fichier: 'lib/tour-controle.js', de: '  for (const v of onSait ? visites : []) {', vers: '  for (const v of visites) {' }], async () => {
    remettre();
    routesDeLaTour({ formulaire: 'panne' });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return !problemes.some((p) => /^formulaire:/.test(p.cle));
  });
  await rouge('une requete d integrite qui echoue sonne en URGENT', [{ fichier: 'lib/tour-controle.js', de: '      illisibles.push(nom);', vers: '      throw error;' }], async () => {
    remettre();
    routesDeLaTour({ integrite: 'panne' });
    const { problemes } = await charger('lib/tour-controle.js').lireProblemes(pool);
    return problemes.some((p) => p.cle === 'integrite:illisible' && p.gravite === 'attention') && !problemes.some((p) => String(p.cle).startsWith('lecture:'));
  });
  await rouge('la caisse du chef de garde se confond avec la commune', [{ fichier: 'lib/llm-budget.js', de: "  return p === 'commun' ? month : `${month}:${p}`;", vers: '  return month;' }], async () => {
    remettre();
    BD.depenses = [];
    route(/^insert into llm_spend/, (s, p) => { BD.depenses.push(p[0]); return []; });
    const budget = charger('lib/llm-budget.js');
    budget.__resetForTests();
    budget.recordSpend(0.5, 'garde');
    await attendre(20);
    budget.__resetForTests();
    return BD.depenses.length === 1 && /:garde$/.test(BD.depenses[0]);
  });
}

(async () => {
  await preuvesCanal();
  await preuvesAnnonces();
  await preuvesJournal();
  await preuvesServeur();
  await preuvesMails();
  await preuvesConsole();
  await preuvesTaches();
  await preuvesBilan();
  await preuvesGarde();
  await preuvesCaisse();
  await contrePreuves();
  console.log(`\ngarde-postes-check: ${echecs ? `${echecs} ECHEC(S) sur ${total}` : `ALL OK (${total})`}`);
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('garde-postes-check: PLANTAGE', error && (error.stack || error));
  process.exit(1);
});
