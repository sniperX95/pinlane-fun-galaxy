// Filtre simulation : LE predicat unique qui distingue une reservation de
// simulation d'une vraie reservation. Un seul endroit de verite, meme role que
// lib/ops-engine.js pour le moteur.
//
// Pourquoi ce module existe : lib/ops-simulation.js appelle le VRAI
// createReservation et persiste dans la vraie table reservations, avec
// channel 'sim-client' / 'sim-staff'. Sans exclusion, ces lignes sont comptees
// comme de vraies reservations dans le CA, les analytics et le ciblage des
// messages (releve prod du 2026-07-19 : 6790 EUR de CA fantome contre 6689 EUR
// de CA reel, soit un CA affiche gonfle de plus de 100 pour cent).
//
// ── REGLE D'EMPLOI, NON NEGOCIABLE ──────────────────────────────────────────
// A appliquer aux lecteurs ANALYTIQUES (CA, metriques, audiences de messages).
// JAMAIS aux lecteurs de CAPACITE :
//   - lib/database.js readStaffState
//   - lib/database.js readAvailabilitySnapshot
//   - lib/database.js listReservationsForDate
// readStaffState n'est PAS un lecteur d'affichage : c'est le readState du
// planificateur (lib/reservation-ops.js, `options.readState || readStaffState`)
// utilise par api/public-reservations.js, api/staff-reservations.js et
// lib/reservation-alternatives.js sur le chemin de reservation REEL.
// Si le planificateur cessait de voir les lignes de simulation pendant que
// l'allocateur (listReservationsForDate) continue de les voir, le plan
// attribuerait une piste deja occupee, ensureAssignableLanes leverait
// "Ce creneau vient de changer", les alternatives seraient calculees sur le
// meme etat filtre donc egalement occupees, et un vrai client payant tournerait
// en boucle sur un echec. On transformerait une perte de capacite silencieuse
// en panne visible : regression stricte sur l'axe argent.
// L'exclusion est donc OPT-IN, au point de consommation analytique.
// scripts/simulation-isolation-check.js asserte les DEUX sens (presence aux
// points analytiques, absence dans les trois lecteurs de capacite).
//
// ── ASYMETRIE ASSUMEE AVEC LE DELETE DE resetSimulation ─────────────────────
// deleteSimulationData (lib/database.js) retient DEUX predicats :
// `channel in ('sim-client','sim-staff') OR notes like '[SIM:%'`.
// La LECTURE n'en retient qu'UN : le channel. Choix delibere.
//   1. channel est le discriminant structurel : pose par normalizeText a la
//      creation, preserve par updateReservation, verifie sur les 18 lignes de
//      simulation en base. notes est du texte libre edite par le staff.
//   2. Les couts d'erreur sont asymetriques. Un faux positif de LECTURE
//      (vraie reservation dont un membre du staff a colle une note commencant
//      par "[SIM:") ferait disparaitre du CA reel, silencieusement et pour
//      toujours, sur toutes les pages : on sous-compterait de l'argent reel
//      sans aucun signal. Le delete, lui, est une action ponctuelle declenchee
//      explicitement par un humain depuis la console de simulation : il a le
//      droit d'etre glouton pour ne laisser aucun residu.
//   3. Consequence acceptee : une ligne de simulation dont le channel aurait
//      ete reecrit en channel reel resterait comptee. Elle ne serait alors plus
//      distinguable d'une vraie reservation par aucun moyen fiable, et
//      resetSimulation (double predicat) la supprime toujours.

const SIMULATION_CHANNELS = ['sim-client', 'sim-staff'];

const SIMULATION_CHANNEL_SET = new Set(SIMULATION_CHANNELS);

// Predicat JS : accepte le camelCase (reservation mappee) et le snake_case
// (ligne pg brute), pour rester utilisable des deux cotes du mapper.
function isSimulationReservation(reservation) {
  if (!reservation) return false;
  const channel = reservation.channel !== undefined ? reservation.channel : reservation.center_channel;
  return SIMULATION_CHANNEL_SET.has(String(channel || '').trim());
}

// Filtre de liste. `includeSimulation: true` = opt-in explicite (console de
// simulation) : la liste ressort intacte.
function excludeSimulationRows(rows, options = {}) {
  if (!Array.isArray(rows)) return [];
  if (options.includeSimulation === true) return rows;
  return rows.filter((row) => !isSimulationReservation(row));
}

// Fragment SQL a coller dans un `where` / `join ... on` existant, sans
// parametre positionnel (valeurs constantes : aucune injection possible).
// `alias` = alias de table quand la requete en utilise un (ex : 'res').
function simulationSqlExclusion(alias = '') {
  const prefix = alias ? `${String(alias).trim()}.` : '';
  const list = SIMULATION_CHANNELS.map((channel) => `'${channel}'`).join(', ');
  return `coalesce(${prefix}channel, '') not in (${list})`;
}

module.exports = {
  SIMULATION_CHANNELS,
  isSimulationReservation,
  excludeSimulationRows,
  simulationSqlExclusion,
};
