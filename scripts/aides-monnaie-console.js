// LES AIDES DE LA MONNAIE DE LA CONSOLE, POUR LES GATES QUI REJOUENT LA CONSOLE HORS DE SA PAGE (2026-11-18).
//
// Depuis D6 (la monnaie du centre), la console, admin-console.js, admin-data.js et le module des suggestions
// ecrivent leurs montants avec deviseMonnaie(), signeMonnaie() et leurs voisines, definies une seule fois dans
// assets/booking-core.js. La vraie page charge booking-core avant tout le reste ; un gate qui recopie quelques
// fonctions dans un bac a sable doit charger ces aides aussi, sinon il plante sur « signeMonnaie is not
// defined » au lieu de juger ce qu il juge. C est la VRAIE source qui est servie, pas une copie : sans le
// fichier assets/pinlane-monnaie.js et sans centre, elle rend l euro, comme la console d un centre en euros.
'use strict';
const fs = require('fs');
const path = require('path');

const DEBUT = '// LA MONNAIE DU CENTRE OUVERT';
const FIN = '// Le formateur se construit une fois';

function sourceAidesMonnaie(root = path.resolve(__dirname, '..')) {
  const coeur = fs.readFileSync(path.join(root, 'assets', 'booking-core.js'), 'utf8');
  const debut = coeur.indexOf(DEBUT);
  const fin = debut < 0 ? -1 : coeur.indexOf(FIN, debut);
  if (debut < 0 || fin < 0) throw new Error('aides-monnaie-console : les aides de la monnaie ne se trouvent plus dans assets/booking-core.js, entre « LA MONNAIE DU CENTRE OUVERT » et « Le formateur se construit une fois »');
  return coeur.slice(debut, fin);
}

// Pour un bac a sable vm : les aides deviennent des fonctions globales du contexte, comme dans la page.
function chargerAidesMonnaie(context, root) {
  require('vm').runInContext(sourceAidesMonnaie(root), context, { filename: 'assets/booking-core.js (aides de la monnaie)' });
  return context;
}

module.exports = { sourceAidesMonnaie, chargerAidesMonnaie };
