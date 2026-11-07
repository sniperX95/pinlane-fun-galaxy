'use strict';

// UN GROUPE NOTE « PAS VENU » REND SES PLACES (2026-11-06). Avant, le bouton
// ecrivait absent_at sans rien liberer : seule une annulation rendait la piste,
// les armes et la table. Desormais un groupe absent reste au planning, barre,
// mais ne compte plus dans les places : le comptoir et le formulaire en ligne
// peuvent revendre sa piste.
//
// UNE SEULE REGLE COTE SERVEUR : les lectures des places (readStaffState,
// readAvailabilitySnapshot, listReservationsForDate), le moteur des retards et
// la limite de tables. La console a la meme, tientSesPlaces dans
// assets/app-main.js ; le gate retards-places joue les deux sur la meme matrice.
//
// Un groupe pointe arrive ou paye n est jamais absent (le declencheur de 0056
// efface absent_at) : la condition le redit pour une ligne lue sans lui.
function tientSesPlaces(reservation) {
  if (!reservation || reservation.status === 'cancelled') return false;
  return !(reservation.absentAt && reservation.status !== 'arrived' && reservation.status !== 'paid');
}

// LE GESTE REND-IL SES PLACES A UN DOSSIER QUI NE LES TENAIT PAS ? (2026-11-07) Un
// « Pas venu » pointe arrive ou paye, son absence retiree, une annulee remise a
// Confirme : le serveur verifie alors que personne ne les a prises
// (refuserSiPlacesReprises, lib/database.js).
function rendSesPlaces(reservation, changement) {
  return !tientSesPlaces(reservation) && tientSesPlaces({ ...reservation, ...changement });
}

module.exports = { tientSesPlaces, rendSesPlaces };
