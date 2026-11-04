'use strict';
// LE LASER N EST PAS LE MEME D UN CENTRE A L AUTRE (Ansar, 2026-11-04 : « leur laser game
// ya 20 armes et peuvent faire jouer plusieurs personnes en meme temps dans des jeux
// differents alors que libramont non c oblige que le jeu soit jouer ensemble pour une meme
// partie »).
//
// UNE SEULE PARTIE A LA FOIS (parallelLaunches a 1) : tout le monde dans l arene joue la
// meme partie. Un groupe rejoint la partie qui part, s il reste des armes, et une autre
// heure de depart attend que l arene se libere.
//
// DES PARTIES SEPAREES (parallelLaunches au-dessus de 1) : chaque groupe a sa partie et son
// heure, il ne joue qu entre lui. Ce qui borne, ce sont les armes de l arene et le nombre de
// parties que le systeme fait tourner ensemble. Personne ne rejoint personne, rien n est
// partage : ni le moteur, ni le client, ni le mail ne doivent le dire.

function partiesSeparees(center) {
  return Number(center && center.resources && center.resources.laser && center.resources.laser.parallelLaunches) > 1;
}

// Combien de parties tourneraient si ce groupe entrait, ses voisins etant les blocs qui
// chevauchent sa fenetre. Deux groupes a la meme heure, c est une seule partie la ou tout
// le monde joue ensemble, et deux parties la ou chacun a la sienne.
function partiesEnJeu({ separees, voisins, start, end }) {
  if (separees) return voisins.length + 1;
  const sessions = new Set(voisins.map((bloc) => `${bloc.start}-${bloc.end}`));
  return sessions.size + (sessions.has(`${start}-${end}`) ? 0 : 1);
}

module.exports = { partiesEnJeu, partiesSeparees };
