'use strict';
// LA CARTE DU LOGICIEL (2026-11-11, Ansar : « elle peut montrer a l utilisateur ou faut aller exactement
// pour faire x ou y sur le logiciel, et doit rediriger »). Chaque ecran de la console, sous le nom du
// menu de gauche et rang par rang comme la carte des droits (assets/app-main.js CARTE_DES_DROITS), avec
// les rubriques d Etablissement (EB_RUBRIQUES). Les droits sont ceux qui ouvrent l ecran
// (STAFF_PAGE_PERMISSION_MAP) : un ecran que le role n ouvre pas ne se propose pas.
// scripts/assistant-gestes-check.js rougit si un ecran du menu manque ici ou si une page n existe plus.

const DESTINATIONS = [
  { id: 'vue-ensemble', page: 'dashboard', chemin: 'Journée › Vue d’ensemble', phrase: 'La journée en un coup d’œil : réservations, arrivées, ce qui attend une réponse.', droits: ['dashboard.view'] },
  { id: 'planning', page: 'planning', chemin: 'Journée › Planning', phrase: 'Les plannings du jour : bowling, laser et le planning complet ; déplacer une réservation, fermer une piste.', droits: ['planning.view'] },
  { id: 'reservations', page: 'reservations', chemin: 'Journée › Réservations', phrase: 'Toutes les réservations, à venir et passées : en créer une, la modifier, l’annuler, l’encaisser.', droits: ['reservations.view'] },
  { id: 'formules-du-jour', page: 'formules', chemin: 'Journée › Formules', phrase: 'Les groupes en formule du jour et leurs étapes.', droits: ['reservations.view'] },
  { id: 'terrain', page: 'arrivals', chemin: 'Journée › Terrain', phrase: 'Qui arrive, qui joue, qui est à clôturer ; noter une arrivée ou un pas venu.', droits: ['reservations.status', 'reservations.view'] },
  { id: 'clients', page: 'clients', chemin: 'Clients & marketing › Clients', phrase: 'Les fiches des clients, leurs visites et leurs notes ; changer des coordonnées, écrire une note.', droits: ['clients.view'] },
  { id: 'demandes', page: 'requests', chemin: 'Clients & marketing › Demandes sur mesure', phrase: 'Les demandes de groupe et sur mesure : la proposition, le mail au client, la réservation.', droits: ['clients.view'] },
  { id: 'emails', page: 'emails', chemin: 'Clients & marketing › Emails & relances', phrase: 'Les mails reçus et envoyés, les modèles, les relances automatiques et les campagnes.', droits: ['emails.view'] },
  { id: 'marketing', page: 'campaigns', chemin: 'Clients & marketing › Marketing', phrase: 'L’assistant et les propositions de publications.', droits: ['campaigns.manage', 'marketing.agents'] },
  { id: 'tarifs', page: 'prices', chemin: 'Administration › Tarifs & formules', phrase: 'Les prix des activités et des formules, et la carte du sur mesure (boissons, nourriture, gâteaux).', droits: ['pricing.manage'] },
  { id: 'pistes', page: 'lanes', chemin: 'Administration › Pistes bowling', phrase: 'L’état de chaque piste de bowling.', droits: ['planning.bowling', 'settings.manage'] },
  { id: 'laser', page: 'laserGame', chemin: 'Administration › Laser Game', phrase: 'Les armes et les parties de laser game.', droits: ['planning.laser', 'settings.manage'] },
  { id: 'equipe', page: 'users', chemin: 'Administration › Équipe & accès', phrase: 'Les personnes de l’équipe, leurs rôles et ce que chaque rôle peut faire.', droits: ['users.manage'] },
  { id: 'etablissement', page: 'establishment', rubrique: 'centre', chemin: 'Administration › Établissement › Le centre', phrase: 'Le nom du centre, son état et ce que les clients lisent.', droits: ['settings.manage', 'direction.view'] },
  { id: 'horaires', page: 'establishment', rubrique: 'horaires', chemin: 'Administration › Établissement › Horaires', phrase: 'Les heures d’ouverture, les jours fermés et les jours qui font exception.', droits: ['settings.manage', 'direction.view'] },
  { id: 'activites', page: 'establishment', rubrique: 'activites', chemin: 'Administration › Établissement › Activités', phrase: 'Ce que le centre propose, et ce que le planning sait de chaque activité.', droits: ['settings.manage', 'direction.view'] },
  { id: 'formules-du-formulaire', page: 'establishment', rubrique: 'formules', chemin: 'Administration › Établissement › Formules', phrase: 'Les formules que le client peut choisir sur le formulaire en ligne.', droits: ['settings.manage', 'direction.view'] },
  { id: 'regles-reservation', page: 'establishment', rubrique: 'reservations', chemin: 'Administration › Établissement › Réservations', phrase: 'Quand un client peut réserver en ligne, et ce que l’équipe valide.', droits: ['settings.manage', 'direction.view'] },
  { id: 'accueil-secours', page: 'establishment', rubrique: 'accueil', chemin: 'Administration › Établissement › Accueil et secours', phrase: 'Quand un groupe passe en retard, et la copie des réservations si Pinlane ne répond plus.', droits: ['settings.manage', 'direction.view'] },
  { id: 'formulaire-en-ligne', page: 'establishment', rubrique: 'formulaire', chemin: 'Administration › Établissement › Formulaire en ligne', phrase: 'Le lien de réservation, son apparence et l’encaissement en ligne.', droits: ['settings.manage', 'direction.view'] },
  { id: 'secours', page: 'secours', chemin: 'Administration › Secours', phrase: 'La feuille de secours, si internet tombe.', droits: ['reservations.view'] },
  { id: 'parametres', page: 'settings', chemin: 'Administration › Paramètres', phrase: 'Les préférences de ce poste.', droits: ['settings.manage'] },
];

const PAR_ID = new Map(DESTINATIONS.map((d) => [d.id, d]));

function destination(id) {
  return PAR_ID.get(String(id || '')) || null;
}

// Un ecran s ouvre si le role a l un des droits qui l ouvrent, dans le centre ouvert.
function ouvrable(session, d) {
  const { sessionHasPermission } = require('./staff-auth');
  return Boolean(d) && d.droits.some((droit) => sessionHasPermission(session, droit));
}

// Ce que le modele lit pour choisir : l identifiant, le chemin, ce qu on y fait.
function carteEnTexte() {
  return DESTINATIONS.map((d) => `${d.id} : ${d.chemin}. ${d.phrase}`).join('\n');
}

module.exports = { DESTINATIONS, destination, ouvrable, carteEnTexte };
