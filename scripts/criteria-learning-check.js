// Gate : le cerveau d'un centre a le DROIT de diverger de celui des autres.
//
// CE QUE CE GATE DEFEND
// Mesure du 2026-09-09, avant purge : les trois centres portaient les 40 memes
// criteres AUX MEMES POIDS, aucun n'ayant jamais diverge. La cause n'etait pas
// l'absence d'apprentissage, c'est que deux ecrivains se contredisaient sur la
// meme table :
//   - batchUpsertCriteria (apprentissage) : greatest(existant, nouveau), donc
//     un poids appris ne redescend jamais ;
//   - ensureDefaultCriteria (semis)       : weight = excluded.weight, donc
//     retour a la valeur d'usine.
// Et le semis tourne a CHAQUE invocation de l'agent : sa seule garde est un Set
// en memoire de processus, vide a chaque demarrage a froid, c'est-a-dire
// presque toujours sur des fonctions serverless. Tout apprentissage etait donc
// efface au tour suivant, et un cerveau par centre etait impossible.
//
// Le gate lit la clause DANS le fichier de production et en derive la
// semantique : il ne fait pas confiance a un commentaire, et il ne recopie pas
// le SQL (une copie diverge). Sans reseau ni DB.
// node scripts/criteria-learning-check.js
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'lib', 'marketing-agents.js');
const src = fs.readFileSync(SOURCE, 'utf8');

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

console.log('[1] UNE SEULE CLAUSE, PARTAGEE PAR LES DEUX ECRIVAINS');
const bloc = src.match(/const CONFLIT_CRITERE_PRESERVE_LE_POIDS = `([\s\S]*?)`;/);
ok('la clause de conflit existe en un seul endroit nomme', Boolean(bloc));
const clause = bloc ? bloc[1] : '';
const usages = (src.match(/\$\{CONFLIT_CRITERE_PRESERVE_LE_POIDS\}/g) || []).length;
ok('les DEUX ecrivains l utilisent (semis et apprentissage)', usages === 2, `${usages} usage(s)`);

// Combien d'ecrivains existent reellement ? Si un troisieme apparaissait sans
// passer par la clause, le cerveau redeviendrait effacable.
const ecrivains = (src.match(/insert into marketing_agent_criteria/g) || []).length;
ok('aucun ecrivain n a ete oublie', ecrivains === usages, `${ecrivains} insert(s) pour ${usages} usage(s) de la clause`);
ok('plus aucun ecrasement direct du poids dans le SQL',
  !/weight\s*=\s*excluded\.weight/.test(src.replace(/^\s*\/\/.*$/gm, '')),
  'un « weight = excluded.weight » subsiste hors commentaire');

console.log('\n[2] LA SEMANTIQUE, DERIVEE DE LA CLAUSE ELLE-MEME');
// On extrait l'expression appliquee au poids et on la joue sur des nombres.
// C'est plus fort qu'une recherche de chaine : si quelqu'un ecrivait
// least() au lieu de greatest(), la chaine « greatest » disparaitrait mais un
// test de presence de « marketing_agent_criteria.weight » resterait vert.
const ligneWeight = (clause.match(/weight\s*=\s*([^,\n]+)/) || [])[1] || '';
ok('MONTAGE : la clause porte bien une regle sur le poids', Boolean(ligneWeight.trim()), JSON.stringify(ligneWeight));

function appliquer(expression, existant, propose) {
  const e = String(expression);
  if (/greatest\s*\(/i.test(e)) return Math.max(existant, propose);
  if (/least\s*\(/i.test(e)) return Math.min(existant, propose);
  if (/excluded\.weight/.test(e)) return propose;
  if (/marketing_agent_criteria\.weight/.test(e)) return existant;
  return null;
}

const APPRIS = 2.9;
const USINE = 1.4;
const apresSemis = appliquer(ligneWeight, APPRIS, USINE);
ok('MONTAGE : la semantique est reconnue', apresSemis !== null, JSON.stringify(ligneWeight));
ok(`un poids appris (${APPRIS}) survit a un semis a la valeur d usine (${USINE})`,
  apresSemis === APPRIS, `obtenu ${apresSemis}`);
ok('une valeur d usine RELEVEE se propage quand meme aux centres existants',
  appliquer(ligneWeight, 1.0, 2.0) === 2.0,
  `obtenu ${appliquer(ligneWeight, 1.0, 2.0)}`);

console.log('\n[3] CONTRE-PREUVES : les deux regressions possibles');
ok('CONTRE-PREUVE : l ancienne clause « weight = excluded.weight » perdrait l apprentissage',
  appliquer('excluded.weight', APPRIS, USINE) === USINE,
  `obtenu ${appliquer('excluded.weight', APPRIS, USINE)}`);
ok('CONTRE-PREUVE : une clause least() le perdrait aussi',
  appliquer('least(marketing_agent_criteria.weight, excluded.weight)', APPRIS, USINE) === USINE);
ok('MONTAGE : ces deux clauses fautives sont bien DIFFERENTES de celle en place',
  appliquer('excluded.weight', APPRIS, USINE) !== apresSemis);

console.log('\n[4] LE SEMIS TOURNE SOUVENT : SA GARDE NE PROTEGE RIEN');
// Le Set en memoire donne l illusion d un semis unique. Il est vide a chaque
// demarrage a froid, donc la clause est la SEULE protection reelle.
ok('MONTAGE : la garde du semis est bien un Set en memoire de processus',
  /seededCriteriaCenters\s*(=|\.)/.test(src) && /new Set\(/.test(src),
  'la garde a change de nature, revoir ce raisonnement');
ok('elle n est pas persistee (aucune lecture en base pour savoir si un centre est deja seme)',
  !/seededCriteriaCenters[\s\S]{0,200}from\s+marketing_agent_criteria/.test(src));

console.log(`\n${failures ? `criteria-learning-check: ${failures} ECHEC(S)` : 'criteria-learning-check: ALL OK'}`);
process.exit(failures ? 1 : 0);
