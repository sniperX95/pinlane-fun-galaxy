'use strict';

// LA MONNAIE D UN CENTRE, COTE SERVEUR (2026-11-17, point D6 de la note avant-lancement du 16/11).
//
// La liste blanche et l ecriture du signe vivent dans assets/pinlane-monnaie.js, le meme fichier que
// lisent les pages : ce module n en garde aucune copie, il ajoute seulement ce que seul le serveur sait,
// la monnaie d un centre donne (sa config, champ `currency`, absent pour l euro).
//
// Jamais d etat : le serveur sert plusieurs centres a la fois, la monnaie se demande a chaque texte.

const monnaie = require('../assets/pinlane-monnaie.js');

// La monnaie du centre, lue dans sa config fusionnee (lib/ops-knowledge, fichier + base). Un centre
// inconnu, ou une lecture qui echoue, vend en euros : exactement ce que tout centre faisait avant.
function deviseDuCentre(centerId) {
  const id = String(centerId || '').trim();
  if (!id) return monnaie.DEFAUT;
  try {
    // Lu a l appel, pas en tete : ops-knowledge charge la config des centres, qui charge ce module.
    const { getCenter } = require('./ops-knowledge');
    return monnaie.devise(getCenter(id).currency);
  } catch (error) {
    return monnaie.DEFAUT;
  }
}

function signeDuCentre(centerId) {
  return monnaie.signe(deviseDuCentre(centerId));
}

// La monnaie d un centre deja en main (l objet de getCenter, qui porte `currency` hors euro), sinon
// celle que sa config donne a son identifiant : un objet partiel ({ id, name }) ne fait pas tomber un
// centre suisse dans l euro.
function deviseDe(centre, centerId) {
  if (centre && typeof centre === 'object' && centre.currency) return monnaie.devise(centre.currency);
  const id = centerId || (centre && typeof centre === 'object' ? centre.id : centre);
  return deviseDuCentre(id);
}

// Les libelles fixes qui portent un montant (« 4 visites ou 500 € », un segment de campagne) : pour un
// centre hors euro, chaque signe de l euro devient celui du centre. En euros, l objet rendu EST l objet
// recu : la reponse d un centre en euros ne change pas d un octet.
function localiserSignes(valeur, devise) {
  const code = monnaie.devise(devise);
  if (code === monnaie.DEFAUT) return valeur;
  const euro = monnaie.signe(monnaie.DEFAUT);
  const signe = monnaie.signe(code);
  const parcourir = (v) => {
    if (typeof v === 'string') return v.split(euro).join(signe);
    if (Array.isArray(v)) return v.map(parcourir);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([cle, x]) => [cle, parcourir(x)]));
    return v;
  };
  return parcourir(valeur);
}

// LA MONNAIE D UN TRAVAIL EN COURS. Les aides partagees de l assistant (ses gestes, ses outils, ses
// controles) ecrivent des montants sans recevoir le centre. La requete qui travaille pour UN centre
// pose sa monnaie pour SA duree (AsyncLocalStorage : chaque requete a la sienne, deux centres servis en
// meme temps ne se melangent jamais), et ces aides la lisent. Hors d une requete qui l a posee : l euro.
const { AsyncLocalStorage } = require('async_hooks');
const travail = new AsyncLocalStorage();

function avecDevise(devise, fn) {
  return travail.run({ devise: devise ? monnaie.devise(devise) : monnaie.DEFAUT }, fn);
}

// Une fois le centre de la requete connu : la monnaie de tout ce qui suit dans CETTE requete.
function poserDevise(devise) {
  const store = travail.getStore();
  if (!store) return null;
  store.devise = monnaie.devise(devise);
  return store.devise;
}

function deviseEnCours() {
  const store = travail.getStore();
  return store ? store.devise : monnaie.DEFAUT;
}

module.exports = {
  ...monnaie,
  deviseDuCentre,
  signeDuCentre,
  deviseDe,
  localiserSignes,
  avecDevise,
  poserDevise,
  deviseEnCours,
};
