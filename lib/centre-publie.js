'use strict';

// CE QU UN CENTRE N A PAS ENCORE PUBLIE (2026-11-17, avant-lancement D2).
//
// Les horaires de repli et les grilles de prix de depart du code sont ceux du premier client
// (lib/booking-config.js : getLegacySchedule, GRILLES_DE_DEPART). Un centre du fichier socle les garde : ce
// sont les siens, ou ceux de la demonstration. Un centre ne dans la console, lui, une fois passe « actif »
// avant que son gerant ait rien saisi, ouvrait ses reservations en ligne aux heures de Libramont et vendait
// le bowling, le laser et le Fun Run aux prix de Fun Galaxy.
//
// La regle : hors du fichier socle, un centre ne vend rien en ligne tant qu il n a pas publie
//   - ses horaires : au moins un jour ouvert dans sa grille (un marqueur texte n est pas une grille) ;
//   - le prix de ce qu il vend A LA GRILLE : le bowling a l heure (sa grille, ou son tarif a la partie), le
//     laser, le Fun Run. Une activite a prix fixe porte deja le sien dans le catalogue du centre.
// Tant que ce n est pas fait, le formulaire se ferme sur une phrase et le serveur refuse creneaux, retenues
// et reservations (lib/ops-knowledge.js : coupureEnLigne, publicBookingBlockReason).
//
// Ce que cette regle ne fait pas : le comptoir. L equipe d un centre qui n a rien publie y reserve encore
// avec les heures et les prix de depart ; c est elle qui les voit, et elle seule.

const SOCLE = new Set(((require('../ops-knowledge/centers.json').centers) || []).map((centre) => String(centre.id)));

// Les activites vendues a la grille, et la grille que le centre doit avoir posee pour chacune
// (lib/center-config.js, CASES_DES_GRILLES).
const GRILLE_DE = { grid_bowling: 'bowling', grid_laser: 'laser', grid_fun_run: 'funRun' };

function grilleDeclaree(centre, nom) {
  const grille = centre && centre.grillesTarif && centre.grillesTarif[nom];
  return Boolean(grille && typeof grille === 'object' && Object.keys(grille).length);
}

function activitesVendues(centre) {
  try {
    return require('./activity-catalog').listSellableActivities({
      centerId: centre.id,
      activityOffers: centre.activityOffers,
      availability: centre.activityAvailability && typeof centre.activityAvailability === 'object' ? centre.activityAvailability : null,
      capacity: centre.activityCapacity && typeof centre.activityCapacity === 'object' ? centre.activityCapacity : null,
    });
  } catch (error) {
    // Catalogue illisible : la regle des tarifs ne peut pas se prononcer, celle des horaires a deja joue.
    return [];
  }
}

// Les activites vendues a la grille dont le centre n a pas encore pose le prix. La mise en route
// (lib/mise-en-route.js, D7) les nomme au gerant ; la regle du formulaire n en regarde que le nombre.
// `activites` : pour un essai sans catalogue ; en service, celles que le centre vend.
function tarifsAPoser(centre, { activites } = {}) {
  const manquants = [];
  for (const activite of (Array.isArray(activites) ? activites : activitesVendues(centre))) {
    const nom = GRILLE_DE[activite && activite.priceType];
    if (!nom) continue;
    // Le bowling vendu a la partie porte son tarif dans les ressources du centre.
    if (nom === 'bowling' && centre.resources && centre.resources.bowling && centre.resources.bowling.pricing) continue;
    if (!grilleDeclaree(centre, nom)) manquants.push(activite);
  }
  return manquants;
}

const estDuSocle = (centre) => SOCLE.has(String((centre && centre.id) || ''));

// '' quand tout est publie (ou que le centre est du socle), sinon 'horaires' ou 'tarifs'.
function manqueAPublier(centre, { activites } = {}) {
  if (!centre || typeof centre !== 'object' || SOCLE.has(String(centre.id || ''))) return '';
  if (!require('./center-facts').joursOuvertsDeclares(centre.defaultSchedule)) return 'horaires';
  return tarifsAPoser(centre, { activites }).length ? 'tarifs' : '';
}

const PHRASES = {
  horaires: 'Ce centre n’a pas publié ses horaires en ligne : il ne prend pas de réservation ici pour le moment.',
  tarifs: 'Ce centre n’a pas publié ses tarifs en ligne : il ne prend pas de réservation ici pour le moment.',
};
function phraseNonPublie(centre, options) {
  const manque = manqueAPublier(centre, options);
  return manque ? PHRASES[manque] : '';
}

module.exports = { activitesVendues, estDuSocle, manqueAPublier, phraseNonPublie, PHRASES, tarifsAPoser };
