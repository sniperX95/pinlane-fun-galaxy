// GATE : qui signe un mail manuel (2026-09-17). Le compte technique
// « Proprietaire plateforme » (acces proprietaire ou de secours) ne signe
// jamais : l equipe du centre signe a sa place. Une vraie personne signe de son
// nom ; un nom tape a la main reste respecte. Contre-epreuve par mutation.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const FICHIER = path.join(__dirname, '..', 'lib', 'ops-communications.js');
let echecs = 0;
function ok(condition, libelle, detail = '') {
  if (!condition) echecs += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${libelle}${detail ? `  ${detail}` : ''}`);
}

function charger(mutation = null) {
  let source = fs.readFileSync(FICHIER, 'utf8');
  if (mutation) {
    if (!source.includes(mutation.de)) throw new Error(`ancre de mutation absente : ${mutation.nom}`);
    source = source.replace(mutation.de, mutation.vers);
  }
  const m = new Module(FICHIER, module);
  m.filename = FICHIER;
  m.paths = Module._nodeModulePaths(path.dirname(FICHIER));
  m._compile(source, FICHIER);
  return m.exports;
}

const PROPRIO = { id: 'libramont:platform-owner-emergency', name: 'Proprietaire plateforme', role: 'Direction', emergency: true };
const PROPRIO_SEED = { id: 'libramont:platform-owner', name: 'Propriétaire plateforme', role: 'Propriétaire plateforme' };
const SARAH = { id: 'libramont:m-12', name: 'Sarah', role: 'Accueil' };

function cas(lib) {
  const p = lib.__test.personneDuMembre;
  return {
    proprio: p(PROPRIO),
    proprioNomRenvoye: p(PROPRIO, { name: 'Proprietaire plateforme', role: 'Direction' }),
    proprioSeed: p(PROPRIO_SEED),
    proprioNomTape: p(PROPRIO, { name: 'Movsar', role: 'Gerant' }),
    sarah: p(SARAH),
    roleTechnique: p(SARAH, { name: 'Sarah', role: 'Proprietaire plateforme' }),
  };
}

const r = cas(charger());
ok(r.proprio === null, 'le compte de secours proprietaire ne signe pas : l equipe signe', JSON.stringify(r.proprio));
ok(r.proprioNomRenvoye === null, 'meme si l ecran renvoie « Proprietaire plateforme » comme nom', JSON.stringify(r.proprioNomRenvoye));
ok(r.proprioSeed === null, 'le membre proprietaire seede (avec accents) ne signe pas non plus', JSON.stringify(r.proprioSeed));
ok(r.proprioNomTape && r.proprioNomTape.name === 'Movsar' && r.proprioNomTape.role === 'Gerant', 'un vrai nom tape a la main reste respecte', JSON.stringify(r.proprioNomTape));
ok(r.sarah && r.sarah.name === 'Sarah' && r.sarah.role === 'Accueil', 'une personne du centre signe de son nom et de son role', JSON.stringify(r.sarah));
ok(r.roleTechnique && r.roleTechnique.name === 'Sarah' && r.roleTechnique.role === '', 'le libelle technique n apparait jamais comme role', JSON.stringify(r.roleTechnique));

console.log('\n[mutation] contre-epreuve');
let rouge = false;
try {
  const mute = cas(charger({ nom: 'le libelle technique signe', de: "if (sansAccents(nom) === LIBELLE_TECHNIQUE || membreTechnique) return null;", vers: '' }));
  rouge = mute.proprio !== null && mute.proprioNomRenvoye !== null;
} catch (erreur) {
  console.log(`      (contre-epreuve impossible : ${erreur.message})`);
}
ok(rouge, '[mutation] « le libelle technique signe » : le gate ROUGIRAIT');

console.log(echecs ? `\n${echecs} controle(s) en echec.` : '\nemail-signataire-check: ALL OK');
process.exit(echecs ? 1 : 0);
