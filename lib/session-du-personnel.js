'use strict';

// LA SESSION DU PERSONNEL VUE D UNE PORTE PUBLIQUE (sortie d api/public-availability le 2026-11-10, pour que la
// page de reservation, api/public-booking-meta, la lise de la meme facon). Une requete sans aucune trace de session
// n interroge pas la base ; une session illisible vaut un visiteur. Les portes publiques s en servent pour reserver
// au visiteur ce que le personnel n a pas a subir : les regles de reservation en ligne du centre, et le retrait des
// champs internes. Le module des sessions se lit a l appel : un banc qui le remplace est suivi.
async function sessionDuPersonnel(req) {
  const h = (req && req.headers) || {};
  if (!h.cookie && !h['x-staff-session'] && !h['x-fgx-session'] && !h['x-fun-galaxy-session']) return null;
  try { return await require('./staff-auth').getStaffSessionFromRequest(req); } catch (error) { return null; }
}

module.exports = { sessionDuPersonnel };
