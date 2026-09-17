// GATE : le vrai client d un mail recu (lib/email-contact.js, 2026-09-17).
// Un mail du formulaire du site (expediteur = adresse du centre) doit etre
// attribue au client ecrit dans le mail ; un mail normal reste a son
// expediteur ; dans le doute (plusieurs adresses sans etiquette), on ne devine
// pas. Chaque garde a sa contre-epreuve par mutation compilee en memoire.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const FICHIER = path.join(__dirname, '..', 'lib', 'email-contact.js');
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

const FORMULAIRE = {
  from: 'info@fungalaxy.be',
  fromName: 'Fun Galaxy',
  to: 'libramont@fungalaxy.be',
  centerEmail: 'libramont@fungalaxy.be',
  text: 'Pour commencer, quel est votre nom ?   JULIE EXEMPLE Choix du centre   Libramont Nombre de participants ?   15 Téléphone   0032470000000\nE-mail   julie@exemple.be [julie@exemple.be]',
};

function scenarios(lib) {
  const r = {};
  r.formulaire = lib.adresseDuClient(FORMULAIRE);
  r.replyTo = lib.adresseDuClient({ ...FORMULAIRE, replyTo: 'Julie Exemple <julie.rt@exemple.be>' });
  r.normal = lib.adresseDuClient({ from: 'marie@exemple.be', fromName: 'Marie', to: 'libramont@fungalaxy.be', centerEmail: 'libramont@fungalaxy.be', text: 'Bonjour, mon mari (paul@exemple.be) viendra aussi.' });
  r.ambigu = lib.adresseDuClient({ ...FORMULAIRE, text: 'Contacts : a@exemple.be ou b@exemple.be' });
  r.etiquetteParmiPlusieurs = lib.adresseDuClient({ ...FORMULAIRE, text: 'Societe : compta@societe.be\nE-mail : julie@exemple.be' });
  r.noreply = lib.adresseDuClient({ from: 'no-reply@wix-forms.com', to: 'libramont@fungalaxy.be', centerEmail: 'libramont@fungalaxy.be', text: 'Email: paul@exemple.be' });
  r.replyToDuCentre = lib.adresseDuClient({ from: 'marie@exemple.be', fromName: 'Marie', replyTo: 'info@fungalaxy.be', to: 'libramont@fungalaxy.be', centerEmail: 'libramont@fungalaxy.be', text: 'Bonjour' });
  r.sansAdresse = lib.adresseDuClient({ ...FORMULAIRE, text: 'Nom : Julie. Telephone : 0470000000' });
  return r;
}

function verifier(r, prefixe = '') {
  const v = {};
  v.formulaire = r.formulaire.email === 'julie@exemple.be' && r.formulaire.source === 'corps' && r.formulaire.relais === 'info@fungalaxy.be';
  v.replyTo = r.replyTo.email === 'julie.rt@exemple.be' && r.replyTo.name === 'Julie Exemple' && r.replyTo.source === 'reply-to';
  v.normal = r.normal.email === 'marie@exemple.be' && r.normal.source === 'expediteur';
  v.ambigu = r.ambigu.email === 'info@fungalaxy.be' && r.ambigu.source === 'expediteur';
  v.etiquette = r.etiquetteParmiPlusieurs.email === 'julie@exemple.be';
  v.noreply = r.noreply.email === 'paul@exemple.be' && r.noreply.source === 'corps';
  v.replyToDuCentre = r.replyToDuCentre.email === 'marie@exemple.be';
  v.sansAdresse = r.sansAdresse.email === 'info@fungalaxy.be' && r.sansAdresse.source === 'expediteur';
  if (!prefixe) {
    ok(v.formulaire, 'formulaire du site : le client est l adresse ecrite dans le mail, le site est garde comme relais', JSON.stringify(r.formulaire));
    ok(v.replyTo, 'un Reply-To externe prime, avec son nom', JSON.stringify(r.replyTo));
    ok(v.normal, 'un mail normal reste a son expediteur, meme s il cite une autre adresse', JSON.stringify(r.normal));
    ok(v.ambigu, 'deux adresses sans etiquette : on ne devine pas', JSON.stringify(r.ambigu));
    ok(v.etiquette, 'l adresse etiquetee E-mail l emporte sur une autre adresse du corps', JSON.stringify(r.etiquetteParmiPlusieurs));
    ok(v.noreply, 'une adresse no-reply d un service de formulaires est un relais', JSON.stringify(r.noreply));
    ok(v.replyToDuCentre, 'un Reply-To vers le centre lui-meme ne remplace pas le client', JSON.stringify(r.replyToDuCentre));
    ok(v.sansAdresse, 'un relais sans adresse dans le corps garde l expediteur', JSON.stringify(r.sansAdresse));
  }
  return v;
}

const base = verifier(scenarios(charger()));

const MUTATIONS = [
  { nom: 'le Reply-To est ignore', de: '  if (externe(adresseReponse)) {', vers: '  if (false) {', casse: 'replyTo' },
  { nom: 'le relais n est plus detecte', de: 'const relais = Boolean(expediteur) && (estDuCentre(expediteur) || estRelaisLocal(expediteur));', vers: 'const relais = false;', casse: 'formulaire' },
  { nom: 'tout expediteur devient un relais', de: 'const relais = Boolean(expediteur) && (estDuCentre(expediteur) || estRelaisLocal(expediteur));', vers: 'const relais = true;', casse: 'normal' },
  { nom: 'on devine parmi plusieurs adresses', de: '  if (distinctes.length === 1) return', vers: '  if (distinctes.length >= 1) return', casse: 'ambigu' },
  { nom: 'l etiquette n est plus lue', de: '  const etiquetee = candidates.find((candidate) => ETIQUETTE_RX.test(candidate.avant));', vers: '  const etiquetee = null;', casse: 'etiquette' },
  { nom: 'une adresse du centre compte comme client', de: '!estDuCentre(adresse) && ', vers: '', casse: 'replyToDuCentre' },
];
console.log('\n[mutation] contre-epreuves');
for (const mutation of MUTATIONS) {
  let rouge = false;
  try {
    rouge = verifier(scenarios(charger(mutation)), 'mutation')[mutation.casse] === false;
  } catch (erreur) {
    console.log(`      (contre-epreuve impossible : ${erreur.message})`);
  }
  ok(rouge, `[mutation] « ${mutation.nom} » : le gate ROUGIRAIT`);
}
ok(Object.values(base).every(Boolean), '[montage] tous les scenarios de base sont verts avant les mutations');

console.log(echecs ? `\n${echecs} controle(s) en echec.` : '\nemail-contact-check: ALL OK');
process.exit(echecs ? 1 : 0);
