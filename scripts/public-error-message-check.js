// UN MESSAGE D ERREUR NE SORT QUE S IL A ETE ECRIT POUR ETRE LU.
//
// Lecture du 2026-09-01 (lentille coherence back) : api/staff-lanes.js,
// api/staff-state.js et api/simulation.js renvoyaient error.message TEL QUEL
// dans leur catch final. Une erreur de pilote (« relation ... does not exist »,
// ECONNREFUSED, « Cannot read properties of undefined ») arrivait donc en clair
// dans la console du staff, la ou le tunnel public la masque depuis longtemps
// (api/public-reservations.js, 503 neutre).
//
// lib/http.publicErrorMessage(error, repli) tranche : une erreur levee AVEC un
// statusCode a ete ecrite pour l utilisateur, elle passe ; sans statusCode, elle
// ne passe que si elle ne ressemble a rien de technique ; sinon le repli, et le
// detail part dans les logs.
//
// Ce gate prouve :
//   A. le comportement de la fonction sur 6 cas (metier, SQL, pilote, JS, vide,
//      trop long) ;
//   B. que les trois handlers l appellent bel et bien (une fonction saine que
//      personne n appelle ne protege personne).
// Contre-epreuve par mutation : le filtre technique est neutralise, le gate
// doit rougir sur la fuite SQL, restauration a l identique verifiee par hash.
//
// Lancement : node scripts/public-error-message-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HTTP = path.join(ROOT, 'lib', 'http.js');
const HANDLERS = ['api/staff-lanes.js', 'api/staff-state.js', 'api/simulation.js'];

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function verdicts() {
  delete require.cache[require.resolve(HTTP)];
  const { publicErrorMessage } = require(HTTP);
  const REPLI = 'Impossible de mettre a jour la piste.';
  const silence = console.error;
  console.error = () => {};
  try {
    const metier = Object.assign(new Error('Piste inconnue pour ce centre.'), { statusCode: 404 });
    const sansStatut = new Error('Piste inconnue pour ce centre.');
    const sql = new Error('relation "lanes_v2" does not exist');
    const pilote = new Error('connect ECONNREFUSED 10.0.0.4:5432');
    const js = new Error("Cannot read properties of undefined (reading 'laneId')");
    const long = new Error('x'.repeat(240));
    return {
      metier: publicErrorMessage(metier, REPLI) === 'Piste inconnue pour ce centre.',
      sansStatut: publicErrorMessage(sansStatut, REPLI) === 'Piste inconnue pour ce centre.',
      sql: publicErrorMessage(sql, REPLI) === REPLI,
      pilote: publicErrorMessage(pilote, REPLI) === REPLI,
      js: publicErrorMessage(js, REPLI) === REPLI,
      vide: publicErrorMessage(null, REPLI) === REPLI && publicErrorMessage(new Error(''), REPLI) === REPLI,
      long: publicErrorMessage(long, REPLI) === REPLI,
    };
  } finally { console.error = silence; }
}

function main() {
  console.log('--- A. la fonction tranche ---');
  const v = verdicts();
  ok(v.metier, 'erreur metier avec statusCode : son message passe');
  ok(v.sansStatut, 'erreur lisible sans statusCode : son message passe');
  ok(v.sql, 'erreur SQL : masquee par le repli');
  ok(v.pilote, 'erreur de connexion : masquee par le repli');
  ok(v.js, 'erreur JavaScript interne : masquee par le repli');
  ok(v.vide, 'erreur vide ou nulle : le repli');
  ok(v.long, 'message de plus de 200 caracteres : le repli');

  console.log('--- B. les trois handlers l appellent ---');
  for (const rel of HANDLERS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok(/publicErrorMessage\(error,/.test(src), `${rel} passe son erreur par publicErrorMessage`);
    ok(!/sendError\(res, [^,]+, error\.message \|\|/.test(src), `${rel} ne renvoie plus error.message brut`);
  }
}

function mutation() {
  console.log('--- C. contre-epreuve par mutation (filtre technique neutralise) ---');
  const avant = sha(HTTP);
  const src = fs.readFileSync(HTTP, 'utf8');
  const find = 'TECHNICAL_ERROR_RE.test(message)';
  if (!src.includes(find)) { console.log('FAIL  ancre de mutation introuvable'); failures += 1; return; }
  fs.writeFileSync(HTTP, src.replace(find, 'false /* mutation gate */'));
  let rougit = false;
  try {
    const v = verdicts();
    rougit = !v.sql || !v.pilote || !v.js;
  } finally {
    fs.writeFileSync(HTTP, src);
  }
  ok(rougit, 'filtre neutralise : la fuite SQL rougit');
  ok(sha(HTTP) === avant, 'lib/http.js restaure a l identique (hash)');
  try {
    const diff = execFileSync('git', ['diff', '--quiet', '--', 'lib/http.js'], { cwd: ROOT, stdio: 'pipe' });
    void diff;
  } catch (error) { /* diff non vide = travail en cours legitime : le hash fait foi */ }
}

main();
mutation();
console.log(failures ? `\n${failures} echec(s)` : '\nTous les controles passent.');
process.exit(failures ? 1 : 0);
