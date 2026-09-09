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

// ── PROVENANCE : une ligne FABRIQUEE ou une ligne d'EXPLOITATION ? ───────────
// Question voisine mais distincte de l'exclusion ci-dessus, et posee par un
// seul appelant : le bandeau "donnees de test" de l'ecran Direction
// (api/ops.js action=health). Ce bandeau affirme que les chiffres affiches ne
// sont pas de vraies donnees d'exploitation. Il ne peut le dire que si quelque
// chose, en base, le prouve.
//
// DEUX marqueurs existent, tous deux poses par le code QUI CREE la ligne, donc
// jamais devines :
//   1. le channel de simulation ci-dessus (lib/ops-simulation.js) ;
//   2. le domaine d'email du jeu de demonstration : scripts/seed-demo-month.js
//      pose @demo.fungalaxy.test sur CHAQUE ligne qu'il cree, et sa propre
//      purge refuse de tourner si une ligne visee ne le porte pas.
//
// Les deux comptent ICI alors qu'un seul compte dans l'exclusion analytique, et
// c'est voulu : les lignes de simulation sont exclues du CA mais RESTENT
// visibles sur les plannings (lecteurs de capacite, cf. regle d'emploi
// ci-dessus), tandis que les lignes du jeu de demonstration passent par le vrai
// chemin serveur avec un channel reel et sont donc comptees partout. Dans les
// deux cas, un ecran montre une ligne qui n'est pas de l'exploitation.
//
// Ce que ce predicat ne dit PAS : rien sur l'etat commercial de Pinlane. Il
// repond a "ce centre contient-il des lignes fabriquees", pas a "le SaaS est-il
// lance".
const DEMONSTRATION_EMAIL_DOMAIN = 'demo.fungalaxy.test';

// Fragment SQL a coller dans un `where`, avec UN parametre positionnel pour le
// motif d'email (numero passe par l'appelant : `$2`, `$3`...). Les valeurs de
// channel restent constantes, comme dans simulationSqlExclusion.
function fabricatedSqlPredicate(emailParamIndex) {
  const index = Number(emailParamIndex);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('fabricatedSqlPredicate: index de parametre invalide.');
  }
  return `(not (${simulationSqlExclusion()}) or lower(coalesce(email, '')) like $${index})`;
}

// La valeur a passer pour ce parametre.
function demonstrationEmailPattern() {
  return `%@${DEMONSTRATION_EMAIL_DOMAIN}`;
}

// Jumeau JS du predicat SQL ci-dessus, pour les consommateurs qui recoivent
// des lignes deja chargees plutot qu'une requete a completer : meme question,
// memes DEUX marqueurs, une seule source de verite.
//
// Pourquoi il existe : releve du 2026-09-09 sur Libramont, un envoi de
// campagne au segment "Fideles" partait vers 80 adresses dont 77 en
// @demo.fungalaxy.test. Ces lignes passent par le vrai chemin serveur avec un
// channel reel, donc simulationSqlExclusion (qui ne regarde que le channel) ne
// les voit pas. 77 rebonds durs d'un coup sur un domaine d'envoi fraichement
// verifie, c'est la facon la plus rapide de le faire suspendre.
//
// A appliquer aux memes endroits que l'exclusion analytique, et a AUCUN
// lecteur de capacite : la regle d'emploi en haut de ce fichier vaut pour les
// deux formes du predicat.
function isFabricatedReservation(reservation) {
  if (!reservation) return false;
  if (isSimulationReservation(reservation)) return true;
  const email = String(reservation.email || '').trim().toLowerCase();
  return email.endsWith(`@${DEMONSTRATION_EMAIL_DOMAIN}`);
}

module.exports = {
  SIMULATION_CHANNELS,
  DEMONSTRATION_EMAIL_DOMAIN,
  isSimulationReservation,
  excludeSimulationRows,
  simulationSqlExclusion,
  isFabricatedReservation,
  fabricatedSqlPredicate,
  demonstrationEmailPattern,
};
