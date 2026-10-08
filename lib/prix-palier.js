// LE PRIX AU-DELA DE LA GRILLE : PALIER PUIS UNITE (Movsar, 2026-10-08).
//
// La fenetre Reserver leve les plafonds (« plus que 3 parties », « plus que
// 2 heures ») : le staff peut vendre 4 parties de laser ou 2 h 30 de bowling.
// Les grilles s arretent avant, et getBasePrice rendait alors un prix FAUX qui
// se facture : 4 parties retombaient sur le prix d UNE partie, 2 h 30 de
// bowling valaient 0 €. Regle validee par Movsar : le plus grand palier de la
// grille, puis l unite pour le reste :
//   laser : 25 € les 3 parties, puis 10 € par partie en plus (prix d une partie) ;
//   bowling : 39 € l heure, plus 20 € la demi-heure (meme lecture que la grille
//   0.5 / 1 / 1.5 / 2 h, qu elle prolonge sans la contredire).
// Le staff peut toujours changer le prix ; ce calcul est le prix PROPOSE.
// Jumeau navigateur : prixLaserAuPalier / prixBowlingAuPalier dans
// assets/booking-core.js (scripts/prix-palier-check.js les compare).
//
// BRANCHE AU COMPTOIR SEULEMENT (getBasePrice, option `auPalier`). Le tunnel
// public refuse une duree hors grille parce qu elle vaut 0 EUR (la « garde
// anti-abus » de lib/reservation-request.js) : un palier toujours actif lui
// aurait ouvert, sur une requete forgee, 2 h 30 de bowling ou 4 parties qu il
// ne vend pas.

// LES PLAFONDS DU COMPTOIR (Movsar, 2026-10-08 : « on est le staff, on doit
// pouvoir faire ce qu on veut »). Le tunnel garde ses options ; le comptoir va
// jusqu a 12 parties de laser (la borne de forme que le moteur tenait deja,
// MAX_LASER_GAMES_PER_RESERVATION) et 6 h de bowling, par demi-heure.
const PARTIES_LASER_MAX = 12;
const HEURES_BOWLING_MAX = 6;

// Une duree de bowling vendable au comptoir, en heures : 30 min au moins, 6 h
// au plus, par pas de 30 min. null sinon (« 1 h 45 » n est pas une duree).
function dureeBowlingAuComptoir(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const heures = Number(valeur);
  if (!Number.isFinite(heures) || heures < 0.5 || heures > HEURES_BOWLING_MAX) return null;
  return Math.round(heures * 2) === heures * 2 ? heures : null;
}

// L OPTION DE LASER POUR N PARTIES, dans la forme de LASER_GAME_OPTIONS
// ({ games, value, label, price, durationMinutes }) : celle de la grille quand
// elle existe, sinon composee au palier. La grille lit une partie comme 0,5 h
// et 30 min (1 = 0,5 h, 2 = 1 h, 3 = 1,5 h) : la suite garde la meme lecture,
// c est elle que le planning et le jumeau navigateur relisent depuis `duration`.
function optionLaserAuPalier(options, parties) {
  const n = Number(parties);
  if (!Number.isInteger(n) || n < 1 || n > PARTIES_LASER_MAX) return null;
  const grille = Array.isArray(options) ? options : [];
  const exacte = grille.find((option) => Math.trunc(Number(option && option.games)) === n);
  if (exacte) return exacte;
  const prix = prixLaserAuPalier(grille, n);
  if (prix === null) return null;
  return { games: n, value: n / 2, label: `${n} parties`, price: prix, durationMinutes: n * 30 };
}

// options : [{ games, price }] (LASER_GAME_OPTIONS ou le catalogue du centre).
function prixLaserAuPalier(options, parties) {
  const n = Math.trunc(Number(parties));
  const liste = (Array.isArray(options) ? options : [])
    .map((option) => ({ games: Math.trunc(Number(option && option.games)), price: Number(option && option.price) }))
    .filter((option) => option.games > 0 && Number.isFinite(option.price) && option.price >= 0)
    .sort((a, b) => a.games - b.games);
  if (!Number.isFinite(n) || n < 1 || !liste.length) return null;
  const exact = liste.find((option) => option.games === n);
  if (exact) return exact.price;
  const palier = liste.filter((option) => option.games < n).pop();
  const unite = liste.find((option) => option.games === 1);
  if (!palier || !unite) return null;
  return palier.price + (n - palier.games) * unite.price;
}

// prix : { 0.5: 20, 1: 39, 1.5: 59, 2: 78 } (BOWLING_PRICES ou la grille du centre),
// heures : la duree en heures, par demi-heure.
function prixBowlingAuPalier(prix, heures) {
  const duree = Number(heures);
  if (!Number.isFinite(duree) || duree <= 0 || Math.round(duree * 2) !== duree * 2) return null;
  const grille = Object.entries(prix && typeof prix === 'object' ? prix : {})
    .map(([cle, valeur]) => ({ heures: Number(cle), price: Number(valeur) }))
    .filter((pas) => pas.heures > 0 && Number.isFinite(pas.price) && pas.price >= 0)
    .sort((a, b) => a.heures - b.heures);
  if (!grille.length) return null;
  const exact = grille.find((pas) => pas.heures === duree);
  if (exact) return exact.price;
  const palier = grille.filter((pas) => pas.heures < duree).pop();
  const heure = grille.find((pas) => pas.heures === 1);
  const demi = grille.find((pas) => pas.heures === 0.5);
  if (!palier || !heure) return null;
  const reste = duree - palier.heures;
  const heuresPleines = Math.floor(reste);
  const avecDemi = reste - heuresPleines >= 0.5;
  if (avecDemi && !demi) return null;
  return palier.price + heuresPleines * heure.price + (avecDemi ? demi.price : 0);
}

module.exports = {
  HEURES_BOWLING_MAX,
  PARTIES_LASER_MAX,
  dureeBowlingAuComptoir,
  optionLaserAuPalier,
  prixBowlingAuPalier,
  prixLaserAuPalier,
};
