// LES ALERTES SE LISENT (2026-11-13, Ansar : « retravaille toutes les alertes que je reçois [...]
// c'est pas clair, j'comprends rien, faut français simple et tout clair »).
//
// Chaque type de message part ici par le VRAI code, jusqu a un faux Telegram en HTTP local (le
// meme envoi qu en prod, liens compris), puis passe le controle du gabarit (lib/alertes-texte.js,
// controlerTexte) : aucun mot technique ni identifiant interne, une ligne « Ce que tu fais » ou
// « Rien à faire », pas trop long, ni tiret long, ni apostrophe droite, ni emoji, ni donnee
// personnelle. Puis les contre-preuves : le code d avant, compile en memoire, doit rougir.
//
//   [G] le gabarit lui-meme et ses liens ;
//   [I] les textes d avant sont refuses (les exemples d Ansar du 13/11) ;
//   [R] la rafale ;
//   [P] la garde du quart d heure : chaque constat, les messages qu elle envoie, « Réglé », la mise
//       en service des sujets ;
//   [S] les alertes a l instant : panne interne, mails, taches, garde bloquee, formulaire, copie
//       dans l ancien formulaire, demande de groupe, reservation ratee, console ;
//   [X] les contre-preuves.
// Lancement : node scripts/alertes-lisibles-check.js   (port : PINLANE_ALERTES_PORT, 5307 par defaut)
'use strict';

for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|TELEGRAM|PINLANE_SECOURS|ANTHROPIC|OPENAI|OPENROUTER|KIMI|MOONSHOT|LLM_|GARDE_|INBOUND_EMAIL|CRON_SECRET|PUBLIC_APP_URL)/i.test(nom)) delete process.env[nom];
process.env.DATABASE_URL = 'postgres://banc/banc';

const http = require('http');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_ALERTES_PORT || 5307);
const LF = '\n';
const PERSONNEL = /Jean|Dupont|0471|example\.be|jean@/;

let total = 0;
let echecs = 0;
function ok(condition, message, detail) {
  total += 1;
  if (condition) { console.log(`ok    ${message}`); return; }
  echecs += 1;
  console.log(`FAIL  ${message}${detail === undefined ? '' : `  ${(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}`}`);
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
const charger = (rel) => require(path.join(ROOT, rel));
function purger() {
  for (const cle of Object.keys(require.cache)) if (cle.startsWith(path.join(ROOT, 'lib')) || cle.startsWith(path.join(ROOT, 'api'))) delete require.cache[cle];
}

// Le faux Telegram : un vrai serveur HTTP local, qui note chaque message.
// ---------------------------------------------------------------------------
// La base en memoire, derriere le vrai module pg de lib/database.js : chaque lecture de la garde
// rend une ligne, pour que chaque constat se fabrique. Une lecture inconnue rend vide.
// ---------------------------------------------------------------------------
const ROUTES = [];
const route = (motif, rendre) => ROUTES.push({ motif, rendre });
const rows = (lignes) => ({ rows: lignes, rowCount: lignes.length });
function repondre(sql, p = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  for (const r of ROUTES) if (r.motif.test(s)) return rows(r.rendre(s, p));
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
const il = (minutes) => new Date(Date.now() - minutes * 60000);
// Un etat ou chaque poste de la garde a quelque chose a dire.
function routesDeLaGarde() {
  ROUTES.length = 0;
  route(/from centers/, () => [
    { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', settings: { config: { secours: { emails: ['secours@fungalaxy.be'] }, embed: { actif: false } } } },
    { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', settings: { config: {} } },
  ]);
  const passage = (task_name, status, minutes, error = null) => ({ task_name, status, started_at: il(minutes), finished_at: il(minutes), error, dernier_ok: il(minutes) });
  const sains = (echoue) => [passage('garde', 'ok', 10), passage('sonde', 'ok', 10), passage('secours', 'ok', 300), passage('dispatch-communications', 'ok', 60), echoue ? passage('ops-jobs', 'failed', 5, 'connect ECONNREFUSED 10.0.0.1:5432') : passage('ops-jobs', 'ok', 600), passage('sauvegarde', 'ok', 600), passage('agent-orchestrator', 'ok', 600)];
  route(/distinct on \(task_name\)/, () => sains(true));
  route(/max\(finished_at\) as dernier_ok/, () => sains(false));
  route(/status = 'failed' and channel = 'email'/, () => [{ center_id: 'gembloux', n: 3, dernier: il(30) }]);
  route(/where status = 'queued' and coalesce/, () => [{ center_id: 'libramont', n: 2, depuis: il(60) }]);
  route(/from email_events where event_type in/, () => [{ center_id: 'gembloux', event_type: 'bounced', n: 1 }, { center_id: 'libramont', event_type: 'complained', n: 2 }]);
  route(/from client_errors where occurred_at > now\(\) - interval '24 hours' and resolved_at is null/, () => [
    { center_id: 'gembloux', stack_hash: 'a1b2c3d4e5', message: 'TypeError: x is undefined (jean@example.be)', page: 'formulaire:recap', n: 2, personnes: 1, dernier: il(5), origine: 'client' },
    { center_id: 'plateforme', stack_hash: 'b2c3d4e5f6', message: 'connect ECONNREFUSED 10.0.0.1:5432', page: 'serveur:api/staff-reservations', n: 1, personnes: 1, dernier: il(5), origine: 'serveur' },
    { center_id: 'libramont', stack_hash: 'c3d4e5f6a7', message: 'Cannot read properties of undefined', page: 'planning', n: 4, personnes: 2, dernier: il(5), origine: 'console' },
  ]);
  route(/entity_type = 'formulaire' and occurred_at > now\(\) - interval '24 hours'/, () => [{ center_id: 'gembloux', action: 'reservation.panne', raison: '', n: 2, dernier: il(10) }, { center_id: 'libramont', action: 'reservation.refusee', raison: 'horaires déjà pris', n: 16, dernier: il(10) }]);
  route(/lower\(coalesce\(email, ''\)\) like \$1/, () => [{ center_id: 'gembloux', n: 2, premier: '2026-11-20' }]);
  route(/validation_status = 'staff_review' and status = 'pending'/, () => [{ center_id: 'gembloux', n: 2 }]);
  route(/from custom_requests where status = 'new'/, () => [{ center_id: 'libramont', n: 1 }]);
  route(/and price <= 0 and created_at/, () => [{ center_id: 'gembloux', n: 1 }]);
  route(/not exists \(select 1 from communications c where c\.reservation_id = r\.id/, () => [{ center_id: 'libramont', n: 2 }]);
  route(/b\.lanes && a\.lanes/, () => [{ center_id: 'libramont', n: 1 }]);
  const arene = (id, date, debut, joueurs) => ({ id, center_id: 'libramont', date, start_time: `${String(Math.floor(debut / 60)).padStart(2, '0')}:${String(debut % 60).padStart(2, '0')}:00`, duration: 1, type: 'laser', pax: joueurs, formule_id: null, lanes: [], status: 'confirmed', ops_plan: { resourceBlocks: [{ resourceType: 'laser_arena', activityId: 'laser_game', start: debut, end: debut + 20, players: joueurs, countIndex: 1 }] } });
  route(/ops_plan::text like '%laser_arena%'/, () => [arene(501, '2026-11-15', 900, 20), arene(502, '2026-11-15', 900, 15)]);
  route(/from availability_blocks where center_id = any/, () => [{ id: 1, center_id: 'libramont', scope_type: 'center', scope_ref: null, recurrence: 'once', date: '2026-11-15', day_of_week: null, date_from: null, date_until: null, start_time: '18:00', end_time: '24:00', reason: 'banc', created_by: 'banc' }]);
  const enLigne = (id, date, heure, duree, lanes) => ({ id, center_id: 'libramont', date, start_time: `${heure}:00`, duration: duree, total_duration: duree, type: 'bowling', formule_id: null, lanes });
  route(/total_duration, type, formule_id, lanes from reservations/, () => [enLigne(701, '2026-11-15', '17:00', 2, [1]), enLigne(703, '2026-11-16', '10:00', 1, [3])]);
  route(/from formulaire_etapes where parcours = 'reservation'/, () => [{ center_id: 'libramont', n: 64, valides: 11, finis: 0 }, { center_id: 'gembloux', n: 35, valides: 4, finis: 0 }]);
}

const TG = [];
const serveur = http.createServer((req, res) => {
  let brut = '';
  req.on('data', (m) => { brut += m; });
  req.on('end', () => {
    try { TG.push(JSON.parse(brut)); } catch (error) { TG.push({ text: '', illisible: true }); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
const brancher = () => {
  process.env.TELEGRAM_API = `http://127.0.0.1:${PORT}`;
  process.env.TELEGRAM_JETON = 'banc';
  process.env.TELEGRAM_CHAT = '42';
};
for (const nom of ['error', 'warn']) { const o = console[nom]; console[nom] = (...a) => { if (!/\[garde\]|\[chef-de-garde\]|\[tour-controle\]|ECRITURE PERDUE|TRACE PERDUE|\[client-errors\]|\[audit\]/.test(String(a[0]))) o(...a); }; }

// Un message passe-t-il le gabarit ? Rend les fautes, vides si oui.
const fautesDe = (texte, genre) => charger('lib/alertes-texte.js').controlerTexte(texte, { genre });
// ALERTES_MONTRER=1 imprime chaque message tel qu il part, pour le relire avec les yeux d Ansar.
function lisible(texte, genre, nom) {
  if (process.env.ALERTES_MONTRER) console.log(`\n----- ${nom}\n${texte}\n-----`);
  const f = fautesDe(texte, genre);
  ok(f.length === 0, `${nom} : se lit`, f.length ? `${f.join(' | ')}  >>  ${texte}` : undefined);
  ok(!PERSONNEL.test(texte), `${nom} : aucune donnee personnelle`, texte);
  return f.length === 0;
}

// ---------------------------------------------------------------------------
// [G] Le gabarit et ses liens.
// ---------------------------------------------------------------------------
async function preuvesGabarit() {
  const t = charger('lib/alertes-texte.js');
  const b = t.bloc({ quoi: 'Gembloux : le formulaire en ligne ne s’ouvre plus', effet: 'Les clients ne peuvent plus réserver en ligne', action: t.faire('réserve toi-même sur le site pour vérifier.'), lien: t.lienVers('tour') });
  ok(b.texte === 'Gembloux : le formulaire en ligne ne s’ouvre plus.\nLes clients ne peuvent plus réserver en ligne.\nCe que tu fais : réserve toi-même sur le site pour vérifier.\nOuvrir la Tour de contrôle', '[G] un bloc : ce qui se passe, ce que ca change, ce que tu fais, le lien', b.texte);
  lisible(b.texte, 'alerte', '[G] le bloc du gabarit');
  ok(b.liens.length === 1 && b.liens[0].url === 'https://app.pinlane.be/#/staff/cockpit-tour', '[G] le lien mene a la Tour de controle', b.liens);
  const r = t.regle('à Gembloux, le formulaire en ligne ne s’ouvrait plus', Date.parse('2026-11-14T13:05:00Z'));
  ok(r === 'Réglé : à Gembloux, le formulaire en ligne ne s’ouvrait plus, depuis 14:05.', '[G] « Réglé » : la meme chose au passe, et depuis quand', r);
  lisible(r, 'regle', '[G] la ligne « Réglé »');
  const deux = t.assembler([b, t.bloc({ quoi: 'Libramont : 2 mails n’ont pas pu partir', effet: 'Ces clients n’ont peut-être pas leur confirmation', action: t.faire('regarde les mails.'), lien: t.lienVers('tour') })]);
  const { entitesDesLiens } = charger('lib/garde-alertes.js');
  const entites = entitesDesLiens(deux.texte, { liens: deux.liens });
  ok(entites.length === 2 && entites.every((e) => e.url.endsWith('/#/staff/cockpit-tour') && deux.texte.substr(e.offset, e.length) === 'Ouvrir la Tour de contrôle'), '[G] deux alertes dans un message : chaque ligne « Ouvrir » s ouvre', entites);
  lisible(deux.texte, 'alerte', '[G] deux alertes dans un message');
}

// ---------------------------------------------------------------------------
// [I] Les textes d avant sont refuses.
// ---------------------------------------------------------------------------
const AVANT = [
  ['une panne du serveur d avant', 'URGENT Pinlane\nPanne du serveur, api/ops (libramont).\nECONNREFUSED connect ECONNREFUSED 10.0.0.1:5432\nLe détail est dans la Tour de contrôle.'],
  ['une console plantee d avant', 'URGENT Pinlane\nLa console de Gembloux a planté chez Seb, page planning (plantage abc123). Le détail est dans la Tour de contrôle.'],
  ['une tache d avant', 'URGENT Pinlane\nops-jobs ne tourne plus. Dernier passage réussi il y a 2 h.'],
  ['une action inconnue d avant', 'Modifications, 14:03 à 14:10\nGembloux\n14:03 Seb : action « saveEmailTemplate » (la garde ne la connaît pas encore)'],
  ['l explication d avant', 'Le chef de garde :\nUn mail de Gembloux n’est pas parti.'],
  ['une erreur technique recopiee', 'Gembloux : la console ne répond plus.\nTypeError: Cannot read properties of undefined (reading \'id\') at app-main.js:10\nCe que tu fais : recharge la page.'],
  ['un message sans ligne d action', 'Gembloux : 2 mails n’ont pas pu partir.\nLes clients n’ont peut-être pas leur confirmation.'],
  ['un message trop long', `Gembloux : le formulaire ne s’ouvre plus.\n${'Les clients ne peuvent plus réserver. '.repeat(20)}\nCe que tu fais : vérifie.`],
];
function preuvesAvant() {
  for (const [nom, texte] of AVANT) {
    const f = fautesDe(texte, /^Modifications/.test(texte) ? 'releve' : 'alerte');
    ok(f.length > 0, `[I] ${nom} : refusee`, f.length ? f.join(' | ') : texte);
  }
}

// ---------------------------------------------------------------------------
// [R] La rafale, par le vrai alerter, jusqu au faux Telegram.
// ---------------------------------------------------------------------------
async function messagesDeRafale() {
  const a = charger('lib/garde-alertes.js');
  a.oublierLesAlertes();
  TG.length = 0;
  const t0 = Date.parse('2026-11-14T12:00:00Z');
  for (let i = 0; i < 14; i += 1) await a.alerter(`cle-${i}`, `Gembloux : essai ${i}.\nRien.\nRien à faire : essai.`, { maintenant: t0 + i * 1000 });
  for (let i = 0; i < 14; i += 1) await a.alerter(`public-${i}`, `Gembloux : essai public ${i}.\nRien.\nRien à faire : essai.`, { maintenant: t0 + i * 1000, origine: 'public', urgent: false });
  a.oublierLesAlertes();
  return { serveur: TG[12] || { text: '' }, public: TG[25] || { text: '' } };
}
async function preuvesRafale() {
  const { serveur, public: pub } = await messagesDeRafale();
  lisible(serveur.text, 'alerte', '[R] la rafale des pannes');
  lisible(pub.text, 'alerte', '[R] la rafale des navigateurs');
  ok(!serveur.disable_notification && pub.disable_notification === true, '[R] la rafale des pannes sonne, celle des navigateurs non', { serveur: serveur.disable_notification, public: pub.disable_notification });
  ok((serveur.entities || []).some((e) => e.type === 'text_link' && /cockpit-tour$/.test(e.url)) && (pub.entities || []).some((e) => /cockpit-incidents$/.test(e.url)), '[R] chacune mene a sa page de la console', { serveur: serveur.entities, public: pub.entities });
}

// ---------------------------------------------------------------------------
// [X] Les contre-preuves : le code d avant doit rougir.
// ---------------------------------------------------------------------------
async function contrePreuves() {
  const rouge = async (nom, edits, rejouer) => {
    mutations = edits;
    purger();
    let tient;
    try { tient = await rejouer(); } catch (error) { tient = false; }
    mutations = [];
    purger();
    ok(tient === false, `[X] ${nom} : rougit`);
  };
  await rouge('le controle qui laisse passer un mot technique', [{ fichier: 'lib/alertes-texte.js', de: "  [/\\bserveurs?\\b/i, 'serveur'],\n", vers: '' }], async () => fautesDe('Pinlane : le serveur ne répond plus.\nLes clients attendent.\nCe que tu fais : attends.', 'alerte').length > 0);
  await rouge('le controle qui oublie la ligne d action', [{ fichier: 'lib/alertes-texte.js', de: "      if (actions.length !== 1) fautes.push(", vers: "      if (false) fautes.push(" }], async () => fautesDe('Gembloux : 2 mails n’ont pas pu partir.\nLes clients attendent.', 'alerte').length > 0);
  await rouge('la rafale d avant', [{ fichier: 'lib/garde-alertes.js', de: "    const m = texteRafale(origine, env);", vers: "    const m = { texte: 'URGENT Pinlane\\nTrop d’alertes d’un coup : les suivantes ne partent plus pendant 10 minutes. Tout est dans la Tour de contrôle.', liens: [] };" }], async () => fautesDe((await messagesDeRafale()).serveur.text, 'alerte').length === 0);
  const garde = async () => {
    const { problemes, ouverts, regles, tour } = await messagesDeLaGarde();
    const fautes = problemes.flatMap((p) => fautesDe(tour.blocDuConstat(p, process.env).texte, 'alerte'));
    return !fautes.length && fautesDe(ouverts.messages[0].texte, 'alerte').length === 0 && fautesDe(regles.messages[0].texte, 'regle').length === 0;
  };
  await rouge('une console plantee d avant', [{ fichier: 'lib/tour-controle.js', de: "    console: (e) => ({ quoi: `${qui(e)} : la console a eu une erreur${page(e)}`,", vers: "    console: (e) => ({ quoi: `${qui(e)} : la console a planté (plantage ${e.cle})`," }], garde);
  await rouge('une panne interne qui recopie le message technique', [{ fichier: 'lib/tour-controle.js', de: "effet: `${fois(e)} ${T.causeLisible(e.message)}`,", vers: "effet: `${fois(e)} ${e.message}`," }], garde);
  await rouge('une tache qui dit « ne tourne plus » avec son nom interne', [{ fichier: 'lib/tour-controle.js', de: "quoi: `Pinlane : ${minuscule(t.nom)} est en retard`,", vers: "quoi: `Pinlane : ${t.id} ne tourne plus`," }], garde);
  await rouge('un « Réglé » d avant', [{ fichier: 'lib/tour-controle.js', de: "  if (regles.length) messages.push({ texte: regles.map((p) => T.regle(p, instant)).join('\\n'),", vers: "  if (regles.length) messages.push({ texte: `Réglé, Pinlane\\n${regles.join('\\n')}`," }], garde);
  await rouge('un constat sans sa ligne « ce que tu fais »', [{ fichier: 'lib/tour-controle.js', de: "const blocDuConstat = (p, env) => T.bloc({ quoi: p.quoi || p.titre, effet: p.effet || '', action: p.action || T.faire('regarde dans la Tour de contrôle.'),", vers: "const blocDuConstat = (p, env) => T.bloc({ quoi: p.quoi || p.titre, effet: p.effet || '', action: '', " }], garde);
  await rouge('une presentation d avant', [{ fichier: 'lib/tour-controle.js', de: "      const r = await envoyerTelegram(lignes.join('\\n'), { env, fetcher, sujet });", vers: "      const r = await envoyerTelegram(`Pinlane : ce fil reçoit la garde.\\nMise en service de la garde Pinlane.\\n${lignes[1]} La sonde passe toutes les 5 minutes.`, { env, fetcher, sujet });" }], async () => (await presentationsDesSujets()).every((m) => fautesDe(m.text, 'presentation').length === 0));
  const instant = async () => (await alertesALInstant()).every((s) => s.messages.length === 1 && fautesDe(s.messages[0].text, 'alerte').length === 0);
  await rouge('une panne interne qui recopie le message technique, a l instant', [{ fichier: 'lib/alertes-messages.js', de: "    effet: `${T.causeLisible(message)} ${quiEstTouche(surface)}`,", vers: "    effet: `${message} ${quiEstTouche(surface)}`," }], instant);
  await rouge('le signalement d une panne qui garde son texte d avant', [{ fichier: 'lib/garde-serveur.js', de: '      m.texte,\n', vers: "      `URGENT Pinlane\\nPanne du serveur, ${nom}.\\n${message}\\nLe détail est dans la Tour de contrôle.`,\n" }], instant);
  await rouge('la console qui garde son texte d avant', [{ fichier: 'api/ops.js', de: '        await alerter(`console:${centre}:${empreinte}`, m.texte,', vers: '        await alerter(`console:${centre}:${empreinte}`, `URGENT Pinlane\\nLa console de ${centre} a planté (plantage ${empreinte}).`,' }], instant);
  await rouge('une tache ratee qui garde son texte d avant', [{ fichier: 'lib/cron-tasks.js', de: '    await alerter(`tache:${taskName}:echec`, m.texte,', vers: '    await alerter(`tache:${taskName}:echec`, `URGENT Pinlane\\n${taskName} ne tourne plus : ${raison}`,' }], instant);
  await rouge('un mail revenu qui sonne encore', [{ fichier: 'lib/alertes-messages.js', de: "action: T.faire(`demande à l’équipe de ${centre} d’appeler ce client, le numéro est dans le dossier.`) }), false);", vers: "action: T.faire(`demande à l’équipe de ${centre} d’appeler ce client, le numéro est dans le dossier.`) }), true);" }], async () => (await alertesALInstant()).every((s) => Boolean(!(s.messages[0] || {}).disable_notification) === s.sonne));
  await rouge('un lien qui ne s ouvre qu une fois', [{ fichier: 'lib/garde-alertes.js', de: "    for (let i = t.indexOf(lien.texte); i >= 0; i = t.indexOf(lien.texte, i + lien.texte.length)) trouves.push(", vers: "    for (let i = t.indexOf(lien.texte); i >= 0; i = -1) trouves.push(" }], async () => {
    const t = charger('lib/alertes-texte.js');
    const b = t.bloc({ quoi: 'Gembloux : essai', action: t.faire('rien'), lien: t.lienVers('tour') });
    const deux = t.assembler([b, b]);
    return charger('lib/garde-alertes.js').entitesDesLiens(deux.texte, { liens: deux.liens }).length === 2;
  });
}

// ---------------------------------------------------------------------------
// [P] La garde du quart d heure.
// ---------------------------------------------------------------------------
// Les familles de constats, chacune fabriquee par le vrai lireProblemes.
const FAMILLES = ['tache:secours:retard', 'tache:ops-jobs:echec', 'mail:echec:gembloux', 'mail:attente:libramont', 'mail:bounced:gembloux', 'mail:complained:libramont', 'erreur:client:', 'erreur:serveur:', 'erreur:console:', 'essai:panne:gembloux', 'essai:refus:libramont', 'centre:ferme:libramont', 'secours:sans-adresse:gembloux', 'base:fabriquees:gembloux', 'suivi:a-valider:gembloux', 'suivi:demande:libramont', 'integrite:prix-zero:gembloux', 'integrite:sans-mail:libramont', 'integrite:doublon:libramont', 'integrite:laser:libramont', 'integrite:fermeture:libramont', 'integrite:horaires:libramont', 'formulaire:bloque:libramont', 'formulaire:personne-au-bout:gembloux'];
async function constatsDeLaGarde() {
  routesDeLaGarde();
  const tour = charger('lib/tour-controle.js');
  const { problemes } = await tour.lireProblemes(pool, { env: process.env, maintenant: Date.now() });
  // Sans Telegram, une lecture qui tombe, un controle d integrite illisible.
  ROUTES.unshift({ motif: /from email_events where event_type in/, rendre: () => { throw new Error('relation "email_events" does not exist'); } });
  ROUTES.unshift({ motif: /b\.lanes && a\.lanes/, rendre: () => { throw new Error('syntax error at or near "x"'); } });
  const sansCanal = (await tour.lireProblemes(pool, { env: {}, maintenant: Date.now() })).problemes;
  routesDeLaGarde();
  return [...problemes, ...sansCanal.filter((p) => /^(canal|lecture|integrite:illisible)/.test(p.cle))];
}
async function messagesDeLaGarde() {
  const tour = charger('lib/tour-controle.js');
  const problemes = await constatsDeLaGarde();
  const ouverts = tour.deciderGarde({}, problemes, { env: process.env, instant: Date.parse('2026-11-14T13:05:00Z') });
  const regles = tour.deciderGarde(ouverts.dits, [], { env: process.env, instant: Date.parse('2026-11-14T13:05:00Z') });
  return { problemes, ouverts, regles, tour };
}
async function preuvesGarde() {
  const { problemes, ouverts, regles, tour } = await messagesDeLaGarde();
  const manquent = FAMILLES.filter((f) => !problemes.some((p) => p.cle.startsWith(f)));
  ok(!manquent.length, '[P] chaque poste de la garde se fabrique par le vrai code', manquent);
  ok(['canal:absent', 'lecture:mails', 'integrite:illisible'].every((c) => problemes.some((p) => p.cle === c)), '[P] et les constats sans canal, de lecture et de controle illisible', problemes.map((p) => p.cle).filter((c) => /^(canal|lecture|integrite:ill)/.test(c)));
  // Chaque constat tel que la garde le dirait (ce qui se dit a l instant ne se redit qu aggrave).
  for (const p of problemes) lisible(tour.blocDuConstat(p, process.env).texte, 'alerte', `[P] ${p.cle.replace(/:[0-9a-f]{6,}$/, '')}`);
  const dits = problemes.filter((p) => !p.instant);
  const message = ouverts.messages[0] || { texte: '' };
  const premier = problemes.find((p) => message.texte.startsWith(`${p.quoi}.`));
  ok(ouverts.messages.length === 1 && message.urgent === true && premier && premier.gravite === 'critique' && message.texte.split('\n\n').length === dits.length, '[P] un seul message pour tout ce qui est neuf, l urgent en tete, et il sonne', message.texte.slice(0, 200));
  const entites = charger('lib/garde-alertes.js').entitesDesLiens(message.texte, { liens: message.liens });
  const plantage = problemes.find((p) => p.cle.startsWith('erreur:console:'));
  ok(entites.filter((e) => /cockpit-tour$/.test(e.url)).length >= 8 && entites.some((e) => /\/#\/staff\/secours$/.test(e.url)) && entites.some((e) => /\/#\/staff\/requests$/.test(e.url)) && /cockpit-incidents$/.test(tour.blocDuConstat(plantage, process.env).liens[0].url), '[P] chaque alerte mene a sa page : la Tour, Secours, les Demandes, les Incidents', entites.map((e) => e.url.replace(/^.*#/, '')).join(' '));
  const regle = regles.messages[0] || { texte: '' };
  lisible(regle.texte, 'regle', '[P] « Réglé » pour tout ce qui disparait');
  ok(regles.messages.length === 1 && regle.urgent === false && regle.texte.split('\n').length === dits.length && /^Réglé : à Gembloux, des mails ne partaient pas, depuis 14:05\.$/m.test(regle.texte), '[P] « Réglé » dit la meme chose au passe, une ligne par probleme, sans sonner', regle.texte.split('\n').slice(0, 4));
  const ancien = tour.deciderGarde({ 'erreur:serveur:abcdef': 'Le serveur a planté (api/ops)', 'mail:echec:gembloux:2': '2 mails ne sont pas partis à Gembloux' }, [], { env: process.env }).messages[0] || { texte: '' };
  lisible(ancien.texte, 'regle', '[P] un probleme retenu avant ce gabarit se dit regle sans son vieux jargon');
}
// ---------------------------------------------------------------------------
// [S] Les alertes a l instant, par les vrais points d entree quand ils se jouent sans base, sinon
// par lib/alertes-messages.js, ou les routes prennent leur texte (tour-controle-check joue ces routes).
// ---------------------------------------------------------------------------
const { Readable } = require('stream');
async function appeler(handler, methode, url, corps, entetes = {}) {
  const req = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]);
  Object.assign(req, { method: methode, url, headers: { host: 'localhost', 'content-type': 'application/json', 'user-agent': 'banc', ...entetes }, socket: { remoteAddress: '10.0.0.9' } });
  const res = { statusCode: 200, entetes: {}, corps: '', headersSent: false, setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, writeHead(s) { this.statusCode = s; return this; }, write(b) { this.corps += String(b || ''); }, end(b) { this.corps += String(b || ''); this.headersSent = true; } };
  await handler(req, res);
  return { statut: res.statusCode, corps: res.corps };
}
const SESSION = { member: { id: 'gembloux:staff-bar', name: 'Seb' }, centerId: 'gembloux', authorizedCenterId: 'gembloux', permissions: ['*'], role: { id: 'direction' } };
function monterOps() {
  const staffAuth = require(path.join(ROOT, 'lib/staff-auth'));
  staffAuth.requireStaffPermission = async () => SESSION;
  staffAuth.getStaffSessionFromRequest = async () => SESSION;
  return charger('api/ops.js');
}
const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms));
// Chaque alerte a l instant, avec ce qu elle doit faire : sonner ou non.
async function alertesALInstant() {
  ROUTES.length = 0;
  const a = charger('lib/garde-alertes.js');
  const M = charger('lib/alertes-messages.js');
  const sorties = [];
  const prendre = async (nom, sonne, jouer) => {
    a.oublierLesAlertes();
    TG.length = 0;
    await jouer();
    await attendre();
    sorties.push({ nom, sonne, messages: TG.slice() });
  };
  await prendre('panne interne, par le vrai signalement', true, () => charger('lib/garde-serveur.js').signalerPanneServeur('api/staff-reservations', Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432 pour jean@example.be'), { code: 'ECONNREFUSED' }), { centerId: 'gembloux' }));
  await prendre('panne pendant une tache, par le vrai signalement', true, () => charger('lib/garde-serveur.js').signalerPanneServeur('api/cron:sauvegarde', new Error('relation "x" does not exist')));
  route(/from communications c left join \(select id, date, start_time from reservations where /, () => [{ id: 55, center_id: 'gembloux', template_id: 'confirmation', reservation_id: 1234, date: '2026-11-14', start_time: '15:00:00' }]);
  for (const type of ['bounced', 'complained', 'failed']) await prendre(`mail ${type}, par le vrai signal du fournisseur`, false, () => charger('lib/garde-mails.js').alerterEvenementMail({ ok: true, deduped: false, communicationId: 55, type }));
  await prendre('tache ratee, par la vraie tache', false, () => charger('lib/cron-tasks.js').recordWorkerTask('secours', async () => ({ ok: false, message: 'Resend a refusé 2 feuilles' })));
  await prendre('agents marketing rates, par la vraie tache', false, () => charger('lib/cron-tasks.js').recordWorkerTask('agent-orchestrator', async () => ({ ok: false, message: 'quota' })));
  ROUTES.unshift({ motif: /from ops_worker_runs where task_name = 'garde'/, rendre: () => { throw new Error('connect ECONNREFUSED'); } });
  process.env.CRON_SECRET = 'banc';
  await prendre('garde bloquee, par le vrai cron', true, () => appeler(charger('api/cron.js'), 'GET', '/api/cron?action=garde', undefined, { authorization: 'Bearer banc' }).catch(() => null));
  delete process.env.CRON_SECRET;
  ROUTES.length = 0;
  await prendre('console plantee, par la vraie console', false, () => appeler(monterOps(), 'POST', '/api/ops?action=logClientError', { action: 'logClientError', centerId: 'gembloux', page: 'planning', message: 'Cannot read properties of undefined (jean@example.be)', source: 'https://app.pinlane.be/assets/app-main.js', lineno: 10, colno: 4, stack: 'TypeError: Cannot read properties of undefined\n    at renderStaff (app-main.js:10:4)' }));
  const envoyer = (m) => a.envoyerTelegram(m.texte, { silencieux: !m.urgent, liens: m.liens });
  await prendre('horaires non retenus', false, () => envoyer(M.horairesNonRetenus('gembloux')));
  await prendre('reservation ratee, transmise', true, () => envoyer(M.reservationEchouee({ centre: 'libramont', essai: { date: '2026-11-14', heure: '15:00', joueurs: 4 }, transmise: true })));
  await prendre('reservation ratee, perdue', true, () => envoyer(M.reservationEchouee({ centre: 'gembloux', essai: { date: '2026-11-14', heure: '15:00', joueurs: 4 }, transmise: false })));
  await prendre('formulaire, un client', false, () => envoyer(M.formulairePlante({ centre: 'gembloux', etape: 'recap', visiteurs: 1 })));
  await prendre('formulaire, deux clients', true, () => envoyer(M.formulairePlante({ centre: 'gembloux', etape: 'recap', visiteurs: 2 })));
  await prendre('copie dans l ancien formulaire', false, () => envoyer(M.copieAncienFormulaire({ centre: 'gembloux', numero: 903, envoyees: 1, lignes: 2, pourquoi: 'un champ de leur formulaire a changé de nom' })));
  await prendre('demande de groupe non enregistree', true, () => envoyer(M.demandeNonEnregistree({ centre: 'gembloux', participants: 35 })));
  a.oublierLesAlertes();
  return sorties;
}
async function preuvesInstant() {
  const sorties = await alertesALInstant();
  for (const s of sorties) {
    const m = s.messages[0] || { text: '' };
    ok(s.messages.length === 1, `[S] ${s.nom} : un message`, s.messages.map((x) => x.text));
    lisible(m.text, 'alerte', `[S] ${s.nom}`);
    ok(Boolean(!m.disable_notification) === s.sonne, `[S] ${s.nom} : ${s.sonne ? 'sonne' : 'arrive sans sonnerie'}`, m.disable_notification);
  }
}

async function presentationsDesSujets() {
  routesDeLaGarde();
  process.env.TELEGRAM_GROUPE = '-1001234567890';
  process.env.TELEGRAM_SUJETS = 'pannes:2,reservations:3,modifications:4,bilans:5';
  TG.length = 0;
  try {
    await charger('lib/tour-controle.js').lancerGarde({ pool, instant: new Date('2026-11-14T12:00:00Z'), llm: async () => null });
  } finally {
    delete process.env.TELEGRAM_GROUPE;
    delete process.env.TELEGRAM_SUJETS;
  }
  return TG.filter((m) => /^Pinlane : ce fil reçoit/.test(m.text || ''));
}
async function preuvesPresentation() {
  const presentations = await presentationsDesSujets();
  ok(presentations.length === 4, '[P] le groupe branche : chaque sujet recoit sa presentation', TG.map((m) => (m.text || '').slice(0, 50)));
  for (const m of presentations) lisible(m.text, 'presentation', `[P] la presentation du sujet ${m.message_thread_id}`);
}

(async () => {
  await new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, '127.0.0.1', resolve); });
  brancher();
  try {
    await preuvesGabarit();
    preuvesAvant();
    await preuvesRafale();
    await preuvesGarde();
    await preuvesPresentation();
    await preuvesInstant();
    await contrePreuves();
  } finally {
    serveur.close();
  }
  console.log(`\nalertes-lisibles-check: ${echecs ? `${echecs} ECHEC(S) sur ${total}` : `ALL OK (${total})`}`);
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('alertes-lisibles-check: PLANTAGE', error && (error.stack || error));
  process.exit(1);
});
