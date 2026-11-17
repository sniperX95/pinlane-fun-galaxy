// LA BASE A-T-ELLE RECU SES MISES A JOUR ? (2026-11-17, point A4 de la verification avant le lancement).
//
// Le trou : le lanceur des migrations (scripts/) et leurs fichiers SQL (database/) ne partent pas en
// production, donc le site en ligne ne savait pas quelles mises a jour il attend. Et le code tolere une
// table ou une colonne absente : en avance sur la base, il ignorait en silence les creneaux retenus en
// ligne ou les fermetures, sans une alerte.
//
// La liste part maintenant avec le site (lib/migrations-attendues.js) et la surveillance du quart d heure
// la compare a la table schema_migrations (lib/tour-controle.js, constatsDesMigrations) :
//   [A] UNE REGLE, DEUX FICHIERS : la liste du site est, dans l ordre, celle du lanceur. Une migration
//       ajoutee d un seul cote rougit ici ;
//   [B] L ECART : ce qui manque a la base se nomme ; une base en avance sur le code ne manque de rien ;
//   [C] LE CONSTAT : base a jour ou en avance, rien ; une mise a jour qui manque se dit sans sonnerie au
//       premier passage ; deja dite au passage d avant, elle sonne ; son nom va au journal du serveur,
//       jamais dans le message ;
//   [D] LES MESSAGES DE LA GARDE, passage apres passage : un message sans bruit, puis un qui sonne, puis
//       plus rien tant que rien ne change, puis un seul « Réglé » ; chacun passe le gabarit des alertes
//       (lib/alertes-texte.js : aucun mot technique, aucun identifiant) ;
//   [E] LE BRANCHEMENT : la vraie lecture des problemes porte le constat ; une table illisible se dit
//       (« pas verifie ») sans coucher le reste ;
//   [F] LA SONDE PUBLIQUE (/api/healthz) : un booleen de plus, « la base a ce que le site attend », et
//       aucun nom de mise a jour ne sort.
// --contre-preuves : chaque regle retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
for (const nom of Object.keys(process.env)) if (/^(PG|DATABASE|POSTGRES|RESEND|TWILIO|TELEGRAM|PINLANE_SECOURS|ANTHROPIC|OPENAI|OPENROUTER|KIMI|MOONSHOT|LLM_PROVIDER)/i.test(nom)) delete process.env[nom];
process.env.DATABASE_URL = 'postgres://banc/banc';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const LISTE = 'lib/migrations-attendues.js';
const TOUR = 'lib/tour-controle.js';
const CONTRE = process.argv.includes('--contre-preuves');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

// Les mutations, compilees en memoire.
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
function charger(liste = []) {
  mutations = liste;
  for (const cle of Object.keys(require.cache)) {
    const rel = path.relative(ROOT, cle);
    if (!rel.startsWith('..') && /^(lib|api)[\\/]/.test(rel)) delete require.cache[cle];
  }
  const attendues = require(path.join(ROOT, LISTE));
  const tour = require(path.join(ROOT, TOUR));
  mutations = [];
  return { attendues, tour };
}

// La base : la table des mises a jour, et ce que la garde a dit a son dernier passage.
function fauxPool({ appliquees, dits = {}, illisible = false, vueAJour = true }) {
  return {
    query: async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s === 'select id from schema_migrations;') {
        if (illisible) throw Object.assign(new Error('relation "schema_migrations" does not exist'), { code: '42P01' });
        return { rows: appliquees.map((id) => ({ id })), rowCount: appliquees.length };
      }
      if (/^select result from ops_worker_runs where task_name = 'garde'/.test(s)) return { rows: [{ result: { dits, baseVueAJour: vueAJour } }], rowCount: 1 };
      throw new Error(`SQL non simulee : ${s.slice(0, 120)}`);
    },
    connect: async () => { throw new Error('connexion non simulee'); },
  };
}
const resume = (constats) => constats.map((c) => `${c.cle}:${c.gravite}${c.evenement ? ':evenement' : ''}`).join(' | ');

// La vraie route /api/healthz (api/public-booking-meta.js), la base remplacee par le banc.
async function sonder(liste, pool) {
  mutations = liste;
  for (const cle of Object.keys(require.cache)) {
    const rel = path.relative(ROOT, cle);
    if (!rel.startsWith('..') && /^(lib|api)[\\/]/.test(rel)) delete require.cache[cle];
  }
  const cheminBase = require.resolve(path.join(ROOT, 'lib/database.js'));
  const reelle = require(cheminBase);
  require.cache[cheminBase] = { id: cheminBase, filename: cheminBase, loaded: true, exports: { ...reelle, getPool: () => pool, checkDatabaseHealth: async () => true } };
  const handler = require(path.join(ROOT, 'api/public-booking-meta.js'));
  mutations = [];
  const req = require('stream').Readable.from([]);
  req.method = 'GET';
  req.url = '/api/healthz';
  req.headers = { host: 'localhost', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  req.socket = { remoteAddress: '10.9.0.1' };
  const res = { statusCode: 200, entetes: {}, corps: '', setHeader(k, v) { this.entetes[k.toLowerCase()] = v; }, getHeader(k) { return this.entetes[k.toLowerCase()]; }, end(b) { this.corps = String(b || ''); } };
  await handler(req, res);
  let json = {};
  try { json = JSON.parse(res.corps); } catch (error) { json = {}; }
  return { statut: res.statusCode, json, brut: res.corps };
}

async function faits(liste = []) {
  const { attendues, tour } = charger(liste);
  const { MIGRATIONS } = require('./run-db-migrations');
  const duLanceur = MIGRATIONS.map((m) => m.id);
  const toutes = attendues.MIGRATIONS_ATTENDUES;
  const f = {};
  // [A]
  f.memeListe = JSON.stringify(toutes) === JSON.stringify(duLanceur);
  f.tailles = `${toutes.length} / ${duLanceur.length}`;
  f.sansDoublon = new Set(toutes).size === toutes.length;
  // [B]
  const sansLaDerniere = duLanceur.slice(0, -1);
  const derniere = duLanceur[duLanceur.length - 1];
  f.aJour = JSON.stringify(attendues.ecartDesMigrations(duLanceur));
  f.uneManque = JSON.stringify(attendues.ecartDesMigrations(sansLaDerniere).manquantes);
  f.derniere = derniere;
  f.enAvance = JSON.stringify(attendues.ecartDesMigrations([...duLanceur, '9999_migration_a_venir']));
  // [C]
  f.constatAJour = resume(await tour.constatsDesMigrations(fauxPool({ appliquees: duLanceur })));
  f.constatEnAvance = resume(await tour.constatsDesMigrations(fauxPool({ appliquees: [...duLanceur, '9999_migration_a_venir'] })));
  const journalServeur = [];
  const crierAvant = console.error;
  console.error = (...a) => { journalServeur.push(a.join(' ')); };
  const premier = await tour.constatsDesMigrations(fauxPool({ appliquees: sansLaDerniere }));
  console.error = crierAvant;
  f.journalServeur = journalServeur.join(' | ');
  f.premier = resume(premier);
  f.premierTexte = premier[0] ? `${premier[0].titre} ${premier[0].detail}` : '';
  const dejaDit = await tour.constatsDesMigrations(fauxPool({ appliquees: sansLaDerniere, dits: { 'base:migrations': { titre: 'x' } } }));
  f.dejaDit = resume(dejaDit);
  // Un registre incomplet depuis toujours : la garde n a jamais vu la base a jour, elle ne sonne pas.
  f.jamaisVueAJour = resume(await tour.constatsDesMigrations(fauxPool({ appliquees: sansLaDerniere, dits: { 'base:migrations': { titre: 'x' } }, vueAJour: false })));
  // La sonde publique : un booleen.
  f.sonde = `${await tour.baseAJour(fauxPool({ appliquees: duLanceur }))} ${await tour.baseAJour(fauxPool({ appliquees: sansLaDerniere }))} ${await tour.baseAJour(fauxPool({ appliquees: [...duLanceur, '9999_migration_a_venir'] }))}`;
  console.error = () => {};
  const sept = await tour.constatsDesMigrations(fauxPool({ appliquees: duLanceur.slice(0, -7) }));
  f.septTexte = sept[0] ? sept[0].titre : '';
  // [D] Quatre passages de la garde, chacun avec ce que le precedent a retenu.
  const env = {};
  const passages = [];
  const fautes = [];
  const { controlerTexte } = require(path.join(ROOT, 'lib/alertes-texte.js'));
  let dits = {};
  for (const appliquees of [sansLaDerniere, sansLaDerniere, sansLaDerniere, duLanceur]) {
    const problemes = await tour.constatsDesMigrations(fauxPool({ appliquees, dits }));
    const decision = tour.deciderGarde(dits, problemes, { env, instant: Date.parse('2026-11-21T10:00:00Z') });
    passages.push(decision.messages.map((m) => `${m.genre}${m.urgent ? ':sonne' : ''}:${m.texte.split(LF).filter(Boolean).length}`).join('+') || 'rien');
    for (const m of decision.messages) fautes.push(...controlerTexte(m.texte, { genre: m.genre }).map((faute) => `${m.genre} : ${faute}`));
    if (decision.messages[0] && passages.length === 1) f.textePremier = decision.messages[0].texte;
    if (decision.messages[0] && passages.length === 2) f.texteQuiSonne = decision.messages[0].texte;
    if (decision.messages[0] && passages.length === 4) f.texteRegle = decision.messages[0].texte;
    dits = decision.dits;
  }
  f.passages = passages;
  f.fautes = fautes;
  console.error = crierAvant;
  // [E] La vraie lecture des problemes : les autres sections de ce banc sont illisibles, chacune se dit.
  // Les sections que ce banc ne simule pas crient dans la console : c est attendu, on les fait taire ici.
  const crier = console.error;
  console.error = () => {};
  const lus = await tour.lireProblemes(fauxPool({ appliquees: sansLaDerniere }), { env });
  f.branche = lus.problemes.some((p) => p.cle === 'base:migrations');
  const illisible = await tour.lireProblemes(fauxPool({ appliquees: duLanceur, illisible: true }), { env });
  console.error = crier;
  f.illisible = illisible.problemes.filter((p) => /mises à jour de la base/.test(p.cle)).map((p) => `${p.cle}:${p.gravite}`).join(' | ');
  // [F] La sonde publique.
  const s1 = await sonder(liste, fauxPool({ appliquees: duLanceur }));
  const s2 = await sonder(liste, fauxPool({ appliquees: sansLaDerniere }));
  const s3 = await sonder(liste, fauxPool({ appliquees: duLanceur, illisible: true }));
  f.sondeAJour = `${s1.statut} ${s1.json.baseAJour}`;
  f.sondeEnRetard = `${s2.statut} ${s2.json.baseAJour}`;
  f.sondeIllisible = `${s3.statut} ${'baseAJour' in s3.json}`;
  f.sondeCles = Object.keys(s2.json).sort().join(',');
  f.sondeSansNom = !/\d{4}_[a-z]/.test(s2.brut);
  return f;
}

function juger(f, dire) {
  dire(f.memeListe && f.sansDoublon, '[A] la liste du site est, dans l ordre, celle du lanceur des migrations, sans doublon', f.tailles);
  dire(f.aJour === '{"manquantes":[],"enPlus":[]}', '[B] base a jour : rien ne manque', f.aJour);
  dire(f.uneManque === JSON.stringify([f.derniere]), '[B] une mise a jour absente de la base se nomme', f.uneManque);
  dire(f.enAvance === '{"manquantes":[],"enPlus":["9999_migration_a_venir"]}', '[B] une base en avance sur le code ne manque de rien', f.enAvance);
  dire(f.constatAJour === '' && f.constatEnAvance === '', '[C] base a jour, ou en avance : aucun constat', `${f.constatAJour} / ${f.constatEnAvance}`);
  dire(f.premier === 'base:migrations:attention', '[C] premier passage : un constat sans sonnerie', f.premier);
  dire(/le site attend 1 mise à jour de ses données qui n’est pas faite/.test(f.premierTexte) && !f.premierTexte.includes(f.derniere), '[C] il dit combien, sans le nom interne de la mise à jour', f.premierTexte);
  dire(f.journalServeur.includes(f.derniere), '[C] le nom de la mise à jour qui manque va au journal du serveur', f.journalServeur);
  dire(f.dejaDit === 'base:migrations:attention | base:migrations:durable:critique:evenement', '[C] deja dit au passage d avant, base deja vue a jour : il sonne', f.dejaDit);
  dire(f.jamaisVueAJour === 'base:migrations:attention', '[C] base jamais vue a jour (registre incomplet depuis toujours) : il ne sonne pas', f.jamaisVueAJour);
  dire(f.sonde === 'true false true', '[C] la sonde publique : un booleen, vrai quand rien ne manque (base a jour ou en avance)', f.sonde);
  dire(/attend 7 mises à jour de ses données qui ne sont pas faites/.test(f.septTexte), '[C] sept qui manquent : le compte, au pluriel', f.septTexte);
  dire(f.passages.join(' ; ') === 'alerte:4 ; alerte:sonne:4 ; rien ; regle:1', '[D] la garde : un message sans bruit, un qui sonne, plus rien, puis un seul « Réglé »', f.passages.join(' ; '));
  dire(/depuis plus d’un quart d’heure/.test(f.texteQuiSonne || ''), '[D] le message qui sonne dit que ça dure', f.texteQuiSonne);
  dire(/le site attendait des mises à jour de ses données/.test(f.texteRegle || ''), '[D] « Réglé » le dit au passé', f.texteRegle);
  dire(f.fautes.length === 0, '[D] chaque message passe le gabarit des alertes : aucun mot technique, aucun identifiant', f.fautes.join(' | '));
  dire(f.branche, '[E] la lecture des problèmes de la Tour porte le constat');
  dire(f.illisible === 'lecture:mises à jour de la base:attention', '[E] une table illisible se dit « pas vérifié », sans sonner ni coucher le reste', f.illisible);
  dire(f.sondeAJour === '200 true' && f.sondeEnRetard === '200 false', '[F] la sonde publique dit vrai ou faux, et reste en bonne santé dans les deux cas', `${f.sondeAJour} / ${f.sondeEnRetard}`);
  dire(f.sondeIllisible === '200 false', '[F] table illisible : le champ est absent, la sonde répond', f.sondeIllisible);
  dire(f.sondeCles === 'baseAJour,db,ok' && f.sondeSansNom, '[F] rien d autre ne sort : aucun nom de mise à jour', f.sondeCles);
}

const CONTRE_PREUVES = [
  { nom: 'liste-du-site-en-retard', lettre: '[A]', fichier: LISTE, de: "  '0061_formulaire_heures_pleines',\n", vers: '', libelle: 'une migration ajoutee au lanceur seul passerait inapercue' },
  { nom: 'base-en-avance-alerte', lettre: '[B]', fichier: LISTE, de: '    manquantes: MIGRATIONS_ATTENDUES.filter((id) => !enBase.has(id)),', vers: '    manquantes: [...MIGRATIONS_ATTENDUES.filter((id) => !enBase.has(id)), ...[...enBase].filter((id) => !attendues.has(id))],', libelle: 'chaque migration jouee avant sa mise en ligne ferait une alerte' },
  { nom: 'premier-passage-sonne', lettre: '[D]', fichier: TOUR, de: "cle: CLE_MIGRATIONS, gravite: 'attention'", vers: "cle: CLE_MIGRATIONS, gravite: 'critique'", libelle: 'chaque mise en ligne ferait sonner le telephone' },
  { nom: 'jamais-de-sonnerie', lettre: '[C]', fichier: TOUR, de: '  if (precedent.baseVueAJour && precedent.dits[CLE_MIGRATIONS]) {', vers: '  if (false) {', libelle: 'un ecart qui dure ne sonnerait jamais' },
  { nom: 'sonne-sans-avoir-vu-la-base-a-jour', lettre: '[C]', fichier: TOUR, de: '  if (precedent.baseVueAJour && precedent.dits[CLE_MIGRATIONS]) {', vers: '  if (precedent.dits[CLE_MIGRATIONS]) {', libelle: 'un registre incomplet depuis toujours reveillerait Ansar' },
  { nom: 'sonde-sans-le-booleen', lettre: '[F]', fichier: 'api/public-booking-meta.js', de: '          sante.baseAJour = await garde.baseAJour(getPool());', vers: '', libelle: 'rien ne dirait de dehors si la base suit le code' },
  { nom: 'constat-pas-branche', lettre: '[E]', fichier: TOUR, de: '    ...integrite,\n    ...migrations,\n', vers: '    ...integrite,\n', libelle: 'la garde ne dirait rien' },
];

(async () => {
  if (!CONTRE) {
    juger(await faits(), ok);
    console.log(echecs ? `\nmigrations-attendues-check: ${echecs} FAIL` : '\nmigrations-attendues-check: ALL OK - le site sait quelles mises a jour il attend, et la garde le dit quand la base ne les a pas');
    process.exit(echecs ? 1 : 0);
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      juger(await faits([{ fichier: c.fichier, de: c.de, vers: c.vers }]), (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(rouges.has(c.lettre), `contre-preuve « ${c.nom} » : ${c.lettre} ROUGIT (${c.libelle})`, mesure);
  }
  let propres = 0;
  juger(await faits(), (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  console.log(echecs ? `\nmigrations-attendues-check --contre-preuves: ${echecs} FAIL` : '\nmigrations-attendues-check --contre-preuves: ALL OK - chaque regle retiree fait rougir sa lettre');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
