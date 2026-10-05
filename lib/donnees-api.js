// LES DONNEES D UN CENTRE, LUES DANS LA BASE (2026-10-05).
//
// Une seule lecture sert trois lecteurs : la page Direction (onglet Clients &
// provenance), l export Excel « Données clients » et l agent IA marketing. Les
// chiffres viennent de lib/donnees-clients.js : personne ne les recalcule.
//
// Une base pas encore migree (0055 absente, slot_holds ou custom_requests
// absentes) se lit quand meme : ce qui manque est vide, rien ne plante.
'use strict';

const { mapReservation } = require('./database');
const { analyserDonnees } = require('./donnees-clients');
const { Classeur } = require('./xlsx-writer');
const { simulationSqlExclusion } = require('./simulation-filter');

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function ajouterJours(jour, n) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function aujourdhuiBelge(maintenant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

async function lireTolerant(pool, sql, params) {
  try {
    return (await pool.query(sql, params)).rows;
  } catch (error) {
    if (error && (error.code === '42P01' || error.code === '42703')) return [];
    throw error;
  }
}

function periode({ startDate, endDate, maintenant } = {}) {
  const aujourdhui = aujourdhuiBelge(maintenant);
  const fin = JOUR.test(String(endDate || '')) ? endDate : aujourdhui;
  const debut = JOUR.test(String(startDate || '')) ? startDate : ajouterJours(fin, -89);
  if (debut > fin) throw Object.assign(new Error('Période invalide.'), { statusCode: 400, expose: true });
  return { debut, fin, aujourdhui };
}

async function lireDonnees(pool, { centerId, startDate, endDate, maintenant = new Date() } = {}) {
  if (!centerId) throw Object.assign(new Error('Choisissez un centre precis.'), { statusCode: 400, expose: true });
  const { debut, fin, aujourdhui } = periode({ startDate, endDate, maintenant });
  const [reservations, holds, demandes] = await Promise.all([
    lireTolerant(pool, `select * from reservations where center_id = $1 and date <= $2 and ${simulationSqlExclusion()} order by date asc, start_time asc, id asc;`, [centerId, fin]),
    lireTolerant(pool, 'select date::text as date, payload, reservation_id, release_reason from slot_holds where center_id = $1 and date >= $2 and date <= $3;', [centerId, debut, fin]),
    lireTolerant(pool, 'select id, status, payload, created_at, pax, occasion, requested_date from custom_requests where center_id = $1 and created_at >= $2::date and created_at < ($3::date + 1);', [centerId, debut, fin]),
  ]);
  const analyse = analyserDonnees({
    history: reservations.map(mapReservation),
    holds: holds.map((h) => ({ ...h, date: String(h.date).slice(0, 10) })),
    demandes: demandes.map((d) => ({ ...d, createdAt: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at || '') })),
    startDate: debut,
    endDate: fin,
    aujourdhui,
  });
  return { ok: true, centerId, ...analyse };
}

// L EXCEL « Données clients » : une feuille par question.
function classeurDonnees(a, { centerId = '', maintenant = new Date() } = {}) {
  const c = new Classeur({ titre: `Pinlane · données clients · ${centerId}`, auteur: 'Pinlane', date: maintenant });
  const s = c.ajouterFeuille('Synthèse', { figer: 0, filtre: false, bandes: false, paysage: false });
  s.definirColonnes([{ titre: 'Indicateur', largeur: 40 }, { titre: 'Valeur', largeur: 16 }]);
  s.titre(`Données clients · ${centerId} · du ${a.startDate} au ${a.endDate}`, 2);
  s.titre(`Lu dans la base le ${maintenant.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`, 2, { style: 'sous-titre' });
  s.vide();
  const t = a.totaux;
  const f = a.fidelite;
  [
    ['Réservations', t.reservations, 'entier'], ['Annulées', t.annulees, 'entier'], ['Chiffre réservé', t.chiffre, 'euros'],
    ['Encaissé', t.encaisse, 'euros'], ['Panier moyen', t.panierMoyen, 'euros'], ['Joueurs', t.joueurs, 'entier'],
    ['Clients venus sur la période', t.clientsPeriode, 'entier'], ['Dont nouveaux', t.nouveauxClients, 'entier'],
    ['Dont déjà venus', t.clientsRevenus, 'entier'], ['Réservations dont la provenance est connue', t.reservationsAvecSource, 'entier'],
    ['Clients connus (tout l historique)', f.clientsConnus, 'entier'], ['Taux de retour (%)', f.tauxRetour, 'nombre'],
    ['Jours moyens entre deux visites', f.joursMoyensEntreVisites == null ? '' : f.joursMoyensEntreVisites, 'entier'],
    ['Part du chiffre faite par les clients revenus (%)', f.partChiffreFideles, 'nombre'], ['Dépense moyenne par client', f.depenseMoyenneParClient, 'euros'],
    ['Demandes sur mesure reçues', a.demandes.recues, 'entier'], ['Demandes devenues réservation', a.demandes.converties, 'entier'],
  ].forEach(([k, v, type]) => s.ligneCle(k, v, v === '' ? null : type));

  const feuille = (nom, colonnes, lignes, vide) => {
    const fe = c.ajouterFeuille(nom);
    fe.definirColonnes(colonnes);
    fe.entete();
    if (!lignes.length) fe.ligneVide(vide);
    lignes.forEach((l) => fe.ajouterLigne(l));
  };
  feuille('Clients', [
    { titre: 'Nom', largeur: 24 }, { titre: 'Téléphone', largeur: 16 }, { titre: 'E-mail', largeur: 28 },
    { titre: 'Visites', type: 'entier' }, { titre: 'Dépensé', type: 'euros' }, { titre: 'Payé', type: 'euros' }, { titre: 'Panier moyen', type: 'euros' },
    { titre: 'Première visite', type: 'date' }, { titre: 'Dernière visite', type: 'date' }, { titre: 'Jours entre visites', type: 'entier' },
    { titre: 'Jours depuis la dernière', type: 'entier' }, { titre: 'Activité favorite', largeur: 20 }, { titre: 'Groupe max', type: 'entier' },
    { titre: 'Source à la 1re visite', largeur: 24 }, { titre: 'Source à la dernière', largeur: 24 },
  ], a.clients.map((x) => [x.nom, x.telephone, x.email, x.visites, x.depense, x.paye, x.panierMoyen, x.premiereVisite, x.derniereVisite,
    x.joursEntreVisites == null ? '' : x.joursEntreVisites, x.joursDepuisDerniere == null ? '' : x.joursDepuisDerniere, x.activiteFavorite, x.groupeMax, x.sourcePremiere, x.sourceDerniere]), 'Aucun client.');
  feuille('Provenance', [
    { titre: 'Source', largeur: 30 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Nouveaux clients', type: 'entier' }, { titre: 'Joueurs', type: 'entier' },
    { titre: 'Chiffre', type: 'euros' }, { titre: 'Encaissé', type: 'euros' }, { titre: 'Panier moyen', type: 'euros' },
  ], a.sources.map((x) => [x.source, x.reservations, x.nouveauxClients, x.joueurs, x.chiffre, x.encaisse, x.panierMoyen]), 'Aucune réservation sur la période.');
  feuille('Campagnes', [{ titre: 'Campagne', largeur: 34 }, { titre: 'Source', largeur: 26 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Chiffre', type: 'euros' }],
    a.campagnes.map((x) => [x.campagne, x.source, x.reservations, x.chiffre]), 'Aucune réservation venue d une campagne marquée (utm_campaign).');
  feuille('Entonnoir en ligne', [{ titre: 'Source', largeur: 30 }, { titre: 'Créneaux retenus', type: 'entier' }, { titre: 'Confirmés', type: 'entier' }, { titre: 'Abandons', type: 'entier' }, { titre: 'Taux de confirmation (%)', type: 'nombre' }],
    a.entonnoir.map((x) => [x.source, x.creneauxRetenus, x.confirmes, x.abandons, x.tauxConfirmation]), 'Aucun créneau retenu en ligne sur la période.');
  feuille('Activités', [{ titre: 'Activité', largeur: 26 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Parties', type: 'entier' }, { titre: 'Joueurs', type: 'entier' },
    { titre: 'Joueurs en moyenne', type: 'nombre' }, { titre: 'Médiane', type: 'entier' }, { titre: 'Plus petit groupe', type: 'entier' }, { titre: 'Plus grand groupe', type: 'entier' }],
  a.activites.map((x) => [x.activite, x.reservations, x.parties, x.joueurs, x.joueursMoyen, x.joueursMedian, x.groupeMin, x.groupeMax]), 'Aucune activité sur la période.');
  feuille('Enchaînements', [{ titre: 'Enchaînement', largeur: 50 }, { titre: 'Étapes', type: 'entier' }, { titre: 'Réservations', type: 'entier' }, { titre: 'Joueurs', type: 'entier' }, { titre: 'Chiffre', type: 'euros' }, { titre: 'Panier moyen', type: 'euros' }],
    a.suites.map((x) => [x.suite, x.etapes, x.reservations, x.joueurs, x.chiffre, x.panierMoyen]), 'Aucune réservation sur la période.');
  feuille('Tailles de groupe', [{ titre: 'Personnes', largeur: 14 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Chiffre', type: 'euros' }],
    a.tailles.map((x) => [x.groupe, x.reservations, x.chiffre]), 'Aucune réservation.');
  feuille('Appareils', [{ titre: 'Appareil', largeur: 16 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Chiffre', type: 'euros' }],
    a.appareils.map((x) => [x.appareil, x.reservations, x.chiffre]), 'Aucune réservation en ligne suivie.');
  feuille('Pages d entrée', [{ titre: 'Page', largeur: 50 }, { titre: 'Réservations', type: 'entier' }, { titre: 'Chiffre', type: 'euros' }],
    a.pages.map((x) => [x.page, x.reservations, x.chiffre]), 'Aucune page connue.');
  return c.versBuffer();
}

module.exports = { lireDonnees, classeurDonnees, periode };
