// LA BASE DE TEST DE LA CI (2026-11-18, point C9 de la note avant-lancement du 16/11).
//
// Sept gates lisent PINLANE_TEST_DATABASE_URL (registre, sauvegarde, secours-api,
// validation-parametrable, validation-situations-reelles en entier ; donnees-clients [F] et
// encaisse-absence [C]). Aucune machine ne leur donnait de base : ils se sautaient partout, et
// la suite les comptait « sautes ». Maintenant la part qui joue l un d eux demarre le Postgres de
// la machine Windows, migre une base modele (quality-gates.yml, « Les outils de la part »), et le
// lanceur donne a chaque unite une copie neuve du modele (gates-lancer.js, baseDeLUnite).
//
// Ce gate prouve le cablage, sans base :
//   [A] la detection : ces sept gates, et eux seuls, demandent l outil « postgres » ;
//   [B] le lanceur : une copie par unite quand le modele existe, jamais un saut silencieux ;
//   [C] la CI : le Postgres demarre, le modele recoit les migrations, le lanceur le recoit.
// La preuve que les gates tournent vraiment est la suite GitHub : ils y passent de « saute » a vert.
//
// Usage : node scripts/base-de-test-ci-check.js [--contre-preuves]
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const COMMUN = 'scripts/gates-commun.js';
const LANCEUR = 'scripts/gates-lancer.js';
const CI = '.github/workflows/quality-gates.yml';
// (Les noms se construisent : un nom de script cite entre guillemets lie ce gate a ce script pour le
// lanceur, gates-commun.js liensDirects, et ce gate heriterait de leur outil « postgres ».)
const gate = (nom) => `scripts/${nom}-check.js`;
const AVEC_BASE = ['donnees-clients', 'encaisse-absence', 'registre', 'sauvegarde', 'secours-api', 'validation-parametrable', 'validation-situations-reelles'].map(gate);
const SANS_BASE = ['gates-parties', 'comptoir-dotation', 'centre-publie'].map(gate);

const MUTATIONS = [
  { nom: 'detection-retiree', lettre: '[A]', fichier: COMMUN, de: "if (/\\bprocess\\.env\\.PINLANE_TEST_DATABASE_URL\\b/.test(source)) outils.add('postgres');", vers: '', libelle: 'aucune part ne demarrerait Postgres' },
  { nom: 'detection-trop-large', lettre: '[A]', fichier: COMMUN, de: '/\\bprocess\\.env\\.PINLANE_TEST_DATABASE_URL\\b/', vers: '/\\bPINLANE_TEST_DATABASE_URL\\b/', libelle: 'le gate du lanceur demarrerait Postgres pour rien' },
  { nom: 'base-partagee', lettre: '[B]', fichier: LANCEUR, de: 'env.PINLANE_TEST_DATABASE_URL = baseDeLUnite(modele, u);', vers: 'env.PINLANE_TEST_DATABASE_URL = modele;', libelle: 'trois gates joues ensemble se marcheraient dessus dans la meme base' },
  { nom: 'saut-silencieux', lettre: '[B]', fichier: LANCEUR, de: "env.PINLANE_TEST_DATABASE_URL = 'postgres://localhost:1/copie-de-la-base-impossible';", vers: 'delete env.PINLANE_TEST_DATABASE_URL;', libelle: 'une copie ratee passerait pour un gate saute' },
  { nom: 'modele-pas-migre', lettre: '[C]', fichier: CI, de: '            node scripts/run-db-migrations.js\n', vers: '', libelle: 'les gates tourneraient sur une base sans tables' },
];

const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

// Le module de detection, compile depuis un texte donne (la vraie source, ou sa mutation).
function chargerCommun(source) {
  const absolu = path.join(ROOT, COMMUN);
  const m = new Module(absolu, module);
  m.filename = absolu;
  m.paths = Module._nodeModulePaths(path.dirname(absolu));
  m._compile(source, absolu);
  return m.exports;
}

function juger(sources, dire) {
  // [A] la detection
  const commun = chargerCommun(sources[COMMUN]);
  const avec = AVEC_BASE.filter((f) => commun.outilsExternes(f, ROOT).includes('postgres'));
  dire(avec.length === AVEC_BASE.length, '[A] les sept gates a base demandent Postgres', `${avec.length}/${AVEC_BASE.length}`);
  const tous = fs.readdirSync(path.join(ROOT, 'scripts')).filter((n) => /-check\.js$/.test(n)).map((n) => `scripts/${n}`);
  const enTrop = tous.filter((f) => !AVEC_BASE.includes(f) && commun.outilsExternes(f, ROOT).includes('postgres'));
  dire(enTrop.length === 0 && SANS_BASE.every((f) => !commun.outilsExternes(f, ROOT).includes('postgres')), '[A] et eux seuls (le gate du lanceur, qui cite la variable, n en est pas)', enTrop.join(', ') || 'aucun autre');

  // [B] le lanceur
  const lanceur = sources[LANCEUR];
  dire(/const modele = process\.env\.PINLANE_TEST_DATABASE_URL_MODELE;\s*\n\s*if \(modele && utiliseLaBase\(u\)\)/.test(lanceur), '[B] le lanceur lit le modele et ne copie que pour un gate a base');
  dire(lanceur.includes('env.PINLANE_TEST_DATABASE_URL = baseDeLUnite(modele, u);'), '[B] chaque unite recoit sa propre copie du modele');
  dire(/create database "\$\{nom\}" template "\$\{gabarit\}"/.test(lanceur) && /drop database if exists "\$\{nom\}" with \(force\)/.test(lanceur), '[B] la copie est neuve a chaque essai (supprimee puis recopiee)');
  dire(lanceur.includes("env.PINLANE_TEST_DATABASE_URL = 'postgres://localhost:1/copie-de-la-base-impossible';"), '[B] une copie ratee fait rougir le gate, jamais un saut silencieux');

  // [C] la CI
  const ci = sources[CI];
  const etape = (ci.split("if ($outils -contains 'postgres') {")[1] || '').split('\n          }\n')[0];
  dire(Boolean(etape) && /Start-Service/.test(etape) && /pg_isready/.test(etape), '[C] la part qui en a besoin demarre le Postgres de la machine et attend qu il reponde');
  dire(/create database pin_modele/.test(etape) && etape.includes('node scripts/run-db-migrations.js') && /DATABASE_SSL = 'disable'/.test(etape), '[C] la base modele recoit toutes les migrations du depot');
  dire(/PINLANE_TEST_DATABASE_URL_MODELE=\$serveur\/pin_modele" \| Out-File -FilePath \$env:GITHUB_ENV/.test(etape) && /GITHUB_PATH/.test(etape), '[C] le lanceur recoit le modele, et les gates les outils de Postgres (pg_dump, psql)');
}

function jouer(sources) {
  const rouges = new Set();
  let echecs = 0;
  juger(sources, (cond, label) => { if (!cond) { rouges.add(label.slice(0, 3)); echecs += 1; } });
  return { rouges, echecs };
}

const SOURCES = { [COMMUN]: lire(COMMUN), [LANCEUR]: lire(LANCEUR), [CI]: lire(CI) };

if (process.argv.includes('--contre-preuves')) {
  let fautes = 0;
  for (const m of MUTATIONS) {
    const avant = SOURCES[m.fichier];
    if (avant.split(m.de).length !== 2) { console.log(`ROUGE contre-preuve « ${m.nom} » : ancre introuvable ou en double dans ${m.fichier}`); fautes += 1; continue; }
    const { rouges } = jouer({ ...SOURCES, [m.fichier]: avant.replace(m.de, m.vers) });
    if (rouges.has(m.lettre)) console.log(`ok    contre-preuve « ${m.nom} » : ${m.lettre} ROUGIT (${m.libelle})`);
    else { console.log(`ROUGE contre-preuve « ${m.nom} » : ${m.lettre} reste vert alors que ${m.libelle}`); fautes += 1; }
  }
  const sain = jouer(SOURCES);
  if (sain.echecs) { console.log(`ROUGE le code du disque ne passe pas (${[...sain.rouges].join(' ')})`); fautes += 1; }
  else console.log('ok    aucune mutation ne survit : tout repasse au vert sur le code du disque');
  console.log(fautes ? `\nbase-de-test-ci-check --contre-preuves: ${fautes} echec(s)` : '\nbase-de-test-ci-check --contre-preuves: ALL OK - chaque morceau retire fait rougir sa lettre');
  process.exitCode = fautes ? 1 : 0;
} else {
  let echecs = 0;
  juger(SOURCES, (cond, label, detail = '') => { console.log(`${cond ? 'ok   ' : 'ROUGE'} ${label}${detail ? `  :: ${detail}` : ''}`); if (!cond) echecs += 1; });
  console.log(echecs ? `\nbase-de-test-ci-check: ${echecs} echec(s)` : '\nbase-de-test-ci-check: ALL OK - la CI donne une base de test a chaque gate qui en demande une');
  process.exitCode = echecs ? 1 : 0;
}
