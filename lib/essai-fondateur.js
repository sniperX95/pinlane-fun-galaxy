// LES ESSAIS DU FONDATEUR NE LUI REVIENNENT PAS (2026-11-13, Ansar : « quand je fais des modifs je
// reçois des alertes genre 5-10 après »). Une reservation, une demande de groupe ou une erreur faites
// par Ansar lui-meme pour essayer ne s annoncent pas et ne font pas d alerte :
//   - dans la console, sa session : le membre <centre>:platform-owner (ou -emergency, la cle de
//     secours), ou le droit platform.admin ;
//   - sur une porte publique, la meme session si le navigateur la porte (app.pinlane.be/reserver) ;
//   - depuis la salle d essai (scripts/salle-essai-client.js), qui le dit par l en-tete
//     x-pinlane-essai. Un en-tete se fabrique : il ne fait que taire l annonce de CETTE demande, qui
//     reste enregistree, au journal et dans la Tour de controle.
// Les reservations de demonstration (@demo.fungalaxy.test, canal sim-*) suivent leur propre regle
// (lib/simulation-filter.js, isFabricatedReservation).
'use strict';

const ENTETE = 'x-pinlane-essai';

// Une seule regle du fondateur (lib/fondateur-invisible.js) : la permission platform.admin, ou son
// membre <centre>:platform-owner (-emergency compris, la cle de secours).
function estLeFondateur(session) {
  if (!session) return false;
  const { estFondateur, estMembreFondateur } = require('./fondateur-invisible');
  return estFondateur(session) || estMembreFondateur((session.member && session.member.id) || session.memberId || '');
}

async function essaiDuFondateur(req) {
  const h = (req && req.headers) || {};
  if (String(h[ENTETE] || '').trim() === 'salle-essai') return true;
  try {
    return estLeFondateur(await require('./session-du-personnel').sessionDuPersonnel(req));
  } catch (error) {
    return false;
  }
}

module.exports = { ENTETE, essaiDuFondateur, estLeFondateur };
