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

module.exports = { prixBowlingAuPalier, prixLaserAuPalier };
