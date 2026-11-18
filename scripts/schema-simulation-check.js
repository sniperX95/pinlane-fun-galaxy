// LA SIMULATION NE MODIFIE PLUS LA TABLE DES RESERVATIONS EN SERVICE (2026-11-18, point C7 de la
// verification avant le lancement).
//
// Le trou : au premier appel de la simulation sur chaque instance, lib/database.js (ensureSimulationSchema)
// refaisait la regle du nombre de personnes, `alter table reservations drop constraint ... add constraint`.
// Postgres prend alors le verrou exclusif de la table des reservations (plus aucune lecture ni ecriture
// d une reservation) et relit toutes ses lignes pour valider la regle, en plein service. Tout etait deja
// pose par la migration 0002 (database/ops-schema.sql).
//
// Maintenant une lecture du catalogue de Postgres d abord, sans verrou ; seul ce qui manque se pose.
// Ce gate joue la vraie fonction sur une base en memoire qui note chaque requete :
//   [A] EN PRODUCTION (tout est pose) : une seule lecture, aucune modification de table, et rien au
//       deuxieme appel ;
//   [B] LA REGLE MANQUE (ou n a pas sa borne de 240) : elle se refait, les tables ne sont pas recreees ;
//   [C] LES TABLES MANQUENT, la regle est la : les tables se creent, la table des reservations n est
//       pas touchee ;
//   [D] UNE BASE NEUVE : les deux ;
//   [E] LA LECTURE NE MODIFIE RIEN : elle ne porte ni alter, ni create, ni drop, ni verrou.
// --contre-preuves : chaque garde retiree en memoire (le disque n est jamais touche) fait rougir sa lettre.
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const DB = 'lib/database.js';
const CONTRE = process.argv.includes('--contre-preuves');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';

let echecs = 0;
function ok(cond, label, detail = '') {
  if (!cond) echecs += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
  return cond;
}

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

// La base en memoire : elle repond a la lecture du catalogue selon l etat choisi, et note tout.
const base = { etat: {}, journal: [] };
class FauxPool {
  async query(sql) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    base.journal.push(s);
    if (/^select exists \( select 1 from pg_constraint/.test(s)) return { rows: [{ ...base.etat }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  async connect() { throw new Error('connexion non prevue par ce banc'); }
  on() {}
  end() {}
}
const pgPath = require.resolve('pg', { paths: [ROOT] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FauxPool, types: { setTypeParser() {} } } };

function charger(liste) {
  mutations = liste;
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`) && cle !== __filename) delete require.cache[cle];
  }
  try { return require(path.join(ROOT, DB)); } finally { mutations = []; }
}

const touche = (journal) => ({
  reservations: journal.filter((s) => /alter table reservations/i.test(s)).length,
  creations: journal.filter((s) => /create table if not exists ops_simulation_runs/i.test(s) && /create table if not exists ops_decision_logs/i.test(s)).length,
  lectures: journal.filter((s) => /^select exists \( select 1 from pg_constraint/.test(s)).length,
  total: journal.length,
});

async function jouer(liste, etat, appels = 1) {
  const db = charger(liste);
  base.etat = etat;
  base.journal = [];
  for (let i = 0; i < appels; i += 1) await db.ensureSimulationSchema();
  return { ...touche(base.journal), lecture: base.journal.find((s) => /^select exists/.test(s)) || '' };
}

async function tout(liste, dire) {
  const prod = await jouer(liste, { regle_pax: true, tables_simulation: true }, 2);
  dire(prod.lectures === 1 && prod.reservations === 0 && prod.creations === 0 && prod.total === 1,
    '[A] en production : une seule lecture, aucune modification de table, rien au deuxieme appel', prod);
  const sansRegle = await jouer(liste, { regle_pax: false, tables_simulation: true });
  dire(sansRegle.reservations === 1 && sansRegle.creations === 0,
    '[B] la regle manque : elle se refait, les tables ne sont pas recreees', sansRegle);
  const sansTables = await jouer(liste, { regle_pax: true, tables_simulation: false });
  dire(sansTables.creations === 1 && sansTables.reservations === 0,
    '[C] les tables manquent : elles se creent, la table des reservations n est pas touchee', sansTables);
  const neuve = await jouer(liste, { regle_pax: false, tables_simulation: false });
  dire(neuve.reservations === 1 && neuve.creations === 1, '[D] une base neuve : la regle et les tables se posent', neuve);
  dire(Boolean(prod.lecture) && !/\b(alter|create|drop|lock|for update|insert|update|delete)\b/i.test(prod.lecture) && /pax <= 240/.test(prod.lecture),
    '[E] la lecture ne modifie rien et verifie la borne de 240', prod.lecture.slice(0, 300));
}

const CONTRE_PREUVES = [
  { nom: 'alter-a-chaque-instance', lettres: ['[A]'], de: '  if (lu.regle_pax !== true) {\n', vers: '  if (true) {\n', libelle: 'la table des reservations serait verrouillee en plein service' },
  { nom: 'sans-lecture', lettres: ['[A]', '[E]'], de: '  const lu = (await getPool().query(LECTURE_SCHEMA_SIMULATION)).rows[0] || {};\n', vers: '  const lu = {};\n', libelle: 'tout se referait sans regarder' },
  { nom: 'tables-jamais-creees', lettres: ['[C]', '[D]'], de: '  if (lu.tables_simulation === true) {\n', vers: '  if (true) {\n', libelle: 'une base de test ne recevrait pas ses tables' },
  { nom: 'borne-non-verifiee', lettres: ['[E]'], de: "        and pg_get_constraintdef(oid) like '%pax <= 240%'\n", vers: '\n', libelle: 'une regle a l ancienne borne passerait pour bonne' },
];

(async () => {
  if (!CONTRE) {
    await tout([], ok);
    console.log(echecs ? `\nschema-simulation-check: ${echecs} FAIL` : '\nschema-simulation-check: ALL OK - la simulation lit avant de poser, la table des reservations n est jamais modifiee en production');
    process.exit(echecs ? 1 : 0);
  }
  for (const c of CONTRE_PREUVES) {
    const rouges = new Set();
    let mesure = '';
    try {
      await tout([{ fichier: DB, de: c.de, vers: c.vers }], (cond, label) => { if (!cond) rouges.add(label.slice(0, 3)); });
      mesure = [...rouges].join(' ');
    } catch (error) {
      mesure = `exception : ${error.message}`;
    }
    ok(c.lettres.every((lettre) => rouges.has(lettre)), `contre-preuve « ${c.nom} » : ${c.lettres.join(', ')} ROUGISSENT (${c.libelle})`, mesure);
  }
  let propres = 0;
  await tout([], (cond) => { if (!cond) propres += 1; });
  ok(propres === 0, 'aucune mutation ne survit : tout repasse au vert sur le code du disque');
  console.log(echecs ? `\nschema-simulation-check --contre-preuves: ${echecs} FAIL` : '\nschema-simulation-check --contre-preuves: ALL OK - chaque garde retiree fait rougir sa lettre');
  process.exit(echecs ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
