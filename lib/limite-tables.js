// LA LIMITE DE TABLES (Movsar, 2026-10-14 : « les tables pour les anniversaire
// et tout on s en fou bloque pas des resa pour ca »).
//
// Rien ne se bloque jamais pour les tables (lib/ops-engine.js). Un centre peut
// allumer « Limite de tables » (Etablissement, onglet Le centre, eteinte par
// defaut) : quand une reservation creee, ou deplacee dans le temps, fait passer
// les tables anniversaire au-dela de sa limite (hardCapacity), UN mail previent
// le centre. La reservation est deja enregistree : ce module ne leve jamais.
//
// LES DESTINATAIRES : la boite de secours que le centre declare lui-meme dans
// Etablissement (onglet Regles & comptoir), et elle seule. Jamais
// PINLANE_SECOURS_EMAILS ni une boite staff globale (STAFF_REVIEW_EMAIL) : une
// variable d environnement vaut pour tous les centres. Jamais l adresse
// publique du fichier socle (publicInfo.email) : le centre ne la saisit pas,
// et un centre ne dans la console n en a pas. Sans adresse, rien ne part.
//
// UN SEUL MAIL : une cle stable par reservation, par jour et par plage de
// table (et par adresse). Un second enregistrement identique retrouve la ligne
// deja envoyee ; un deplacement vers une autre plage en depassement peut
// renvoyer. La ligne passe par la file des communications SANS reservation_id :
// la remise a jour des automatismes d un dossier (refreshReservationAutomation)
// ne l annule pas, et la file la recontrole a l envoi (alerteToujoursVraie).
'use strict';

const {
  depassementDeTablesDuDossier,
  limiteDeTablesActive,
  minutesToTime,
  tablesDuDossier,
} = require('./ops-engine');
const { isSimulationReservation } = require('./simulation-filter');

const TEMPLATE_LIMITE_TABLES = 'staff_tables_limit';
const ADRESSE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const NON_ROUTABLE = /@[^@]*\.(test|invalid|example|localhost)$/i;

function centreOuNull(centerId) {
  try {
    return require('./ops-knowledge').getCenter(centerId || 'libramont');
  } catch (error) {
    return null;
  }
}

function adressesDuCentre(center) {
  const brutes = center && center.secours && Array.isArray(center.secours.emails) ? center.secours.emails : [];
  const vues = new Set();
  const adresses = [];
  for (const brute of brutes) {
    const adresse = String(brute || '').trim().toLowerCase();
    if (!adresse || !ADRESSE.test(adresse) || NON_ROUTABLE.test(adresse) || vues.has(adresse)) continue;
    vues.add(adresse);
    adresses.push(adresse);
  }
  return adresses;
}

// Les plages de table d un dossier actif : « date|debut-fin ». Un dossier
// annule n occupe aucune table.
function plagesDeTables(reservation, center) {
  if (!reservation || reservation.status === 'cancelled') return [];
  return tablesDuDossier(reservation, center)
    .map((bloc) => `${reservation.date}|${minutesToTime(bloc.start)}-${minutesToTime(bloc.end)}`);
}

function lireJournee(date, centerId) {
  return require('./database').readStaffState(date, centerId || 'libramont', { avecBlocages: true });
}

// UNE RESERVATION VIENT D ETRE ECRITE. `avant` : le dossier avant la
// modification (null a la creation) ; seule une plage de table NOUVELLE peut
// prevenir le centre, jamais un changement de statut ou de contact. `etat` :
// la journee deja relue par l appelant.
async function alerterLimiteDeTables(reservation, { avant = null, etat = null } = {}) {
  try {
    if (!reservation || !reservation.id || isSimulationReservation(reservation)) return { rien: 'aucun dossier' };
    const centerId = reservation.centerId || 'libramont';
    const center = centreOuNull(centerId);
    if (!limiteDeTablesActive(center)) return { rien: 'limite eteinte' };
    const deja = new Set(plagesDeTables(avant, center));
    const nouvelles = plagesDeTables(reservation, center).filter((plage) => !deja.has(plage));
    if (!nouvelles.length) return { rien: 'aucune nouvelle plage de table' };
    const journee = etat || await lireJournee(reservation.date, centerId);
    const depassement = depassementDeTablesDuDossier(reservation, journee && journee.reservations, center);
    if (!depassement || !nouvelles.includes(`${reservation.date}|${depassement.startTime}-${depassement.endTime}`)) return { rien: 'limite tenue' };
    const destinataires = adressesDuCentre(center);
    if (!destinataires.length) return { ignore: 'aucune adresse de secours', depassement };
    const comms = require('./ops-communications');
    const lignes = await comms.enqueueTablesLimitAlert(reservation, depassement, destinataires);
    const envois = [];
    for (const ligne of lignes) {
      if (!ligne || !ligne.id || ligne.status !== 'queued') continue;
      envois.push(await comms.dispatchDueCommunications({ limit: 1, centerId, communicationId: ligne.id }));
    }
    return { depassement, destinataires, lignes: lignes.map((ligne) => ligne && ligne.id), envois };
  } catch (error) {
    return { erreur: error.message };
  }
}

// LE RECONTROLE A L ENVOI : une alerte remise en file (un envoi qui a echoue)
// ne part plus si son dossier a ete annule, change de jour ou de centre, si la
// limite a ete eteinte, ou si cette plage ne la depasse plus.
async function alerteToujoursVraie(communication) {
  const tables = communication && communication.payload && communication.payload.tables;
  if (!tables || !tables.reservationId) return { vraie: false, raison: 'alerte de tables sans dossier' };
  const database = require('./database');
  try { await require('./ops-knowledge').refreshCenterOverrides(database.getPool()); } catch (error) { /* socle fichier */ }
  const reservation = await database.getReservationById(tables.reservationId);
  if (!reservation || reservation.status === 'cancelled' || reservation.date !== tables.date
    || (reservation.centerId || 'libramont') !== (communication.centerId || 'libramont')) {
    return { vraie: false, raison: 'dossier annule ou deplace depuis l alerte' };
  }
  const center = centreOuNull(reservation.centerId);
  if (!limiteDeTablesActive(center)) return { vraie: false, raison: 'limite de tables eteinte' };
  const journee = await lireJournee(reservation.date, reservation.centerId);
  const depassement = depassementDeTablesDuDossier(reservation, journee && journee.reservations, center);
  if (!depassement || depassement.startTime !== tables.startTime || depassement.endTime !== tables.endTime) {
    return { vraie: false, raison: 'limite de tables tenue sur cette plage' };
  }
  return { vraie: true, raison: '' };
}

module.exports = {
  TEMPLATE_LIMITE_TABLES,
  adressesDuCentre,
  alerterLimiteDeTables,
  alerteToujoursVraie,
};
