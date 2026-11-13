// CE QUI NE REVIENT PAS A ANSAR (2026-11-13, retouche le 2026-11-14).
//
// Le 13/11 (« quand je fais des modifs je reçois des alertes genre 5-10 après »), tout ce que
// faisait son compte se taisait. Le 14/11 : « si il faut hein juste ça doit pas montrer et
// afficher que c moi ». Ses gestes s annoncent donc comme ceux de l equipe, sans son nom
// (lib/garde-annonces.js, lib/garde-journal.js). Restent muets :
//   - la salle d essai (scripts/salle-essai-client.js), qui le dit par l en-tete x-pinlane-essai.
//     Un en-tete se fabrique : il ne fait que taire l annonce de CETTE demande, qui reste
//     enregistree, au journal et dans la Tour de controle ;
//   - une erreur qu il a vue sur son propre ecran (sa session dans la console, ou sur une porte
//     publique si le navigateur la porte) : vueParLeFondateur.
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

// La salle d essai, seule : une reservation, une demande ou une copie ratee faites depuis le
// navigateur d Ansar s annoncent comme les autres.
async function essaiDuFondateur(req) {
  const h = (req && req.headers) || {};
  return String(h[ENTETE] || '').trim() === 'salle-essai';
}

// Une erreur vue sur son propre ecran : la salle d essai, ou sa session.
async function vueParLeFondateur(req) {
  if (await essaiDuFondateur(req)) return true;
  try {
    return estLeFondateur(await require('./session-du-personnel').sessionDuPersonnel(req));
  } catch (error) {
    return false;
  }
}

module.exports = { ENTETE, essaiDuFondateur, estLeFondateur, vueParLeFondateur };
