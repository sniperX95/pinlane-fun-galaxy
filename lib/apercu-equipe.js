'use strict';

// L APERCU DE L EQUIPE (2026-11-18, Ansar : « fais en sorte que je puisse revoir dans app.pinlane.be/reserver/libramont,
// et gembloux aussi, le formulaire, parce que je le vois plus du tout »).
//
// Coupe depuis la Tour de controle (lib/ops-knowledge.js, coupureEnLigne), le formulaire en ligne d un centre se ferme
// pour tout visiteur, et cela ne change pas. L equipe de ce centre, et le fondateur, peuvent encore le regarder tel
// qu il serait ouvert : le catalogue et les heures, rien d autre. Trois conditions, toutes jugees ici, cote serveur :
//   - la page le demande (apercu=1). Sans ce mot, la reponse reste celle du visiteur, cookie ou pas ;
//   - une session du personnel, lue comme aux autres portes publiques (lib/session-du-personnel.js : le cookie
//     HttpOnly que la console pose a la connexion, que le navigateur joint seul aux pages de ce domaine), et qui entre
//     dans CE centre (lib/staff-auth.js, sessionAuCentre : son centre, une jumelle, le fondateur) ;
//   - le centre est coupe par l interrupteur de la console (centre.embed.actif). Ouvert, il n y a rien a apercevoir ;
//     un centre qui n a pas publie ses horaires ou ses tarifs (lib/centre-publie.js) n a pas d apercu non plus : son
//     formulaire montrerait les heures et les prix de depart, ceux d un autre centre.
// Ce qui ne change pas : la reservation, la retenue des heures et la demande sur mesure restent refusees
// (lib/demande-publique.js, api/public-booking-meta.js), session ou pas. Aucune reservation, aucun mail.
//
// Toute reponse a une demande d apercu est privee : aucun cache partage (Vercel, un relais) ne la garde, et elle se
// dit dependante du cookie. Un Cache-Control pose plus loin (lib/http.js sendJson pose le sien) devient prive lui aussi.

const { coupureEnLigne } = require('./ops-knowledge');

const CACHE_PRIVE = 'private, no-store, max-age=0';
const VARY_PRIVE = 'Origin, Cookie, X-Staff-Session';
// Ce que le formulaire dit a l equipe : en haut de chaque ecran, et a la place d un envoi.
const BANDEAU = 'Aperçu réservé à l’équipe. La réservation en ligne est coupée. Les clients voient l’écran de coupure. Rien ne se réserve depuis cet aperçu.';
const ENVOI = 'Ceci est un aperçu de l’équipe. Rien ne se réserve ni ne s’envoie depuis cet aperçu.';

function apercuDemande(req) {
  try {
    return new URL(String((req && req.url) || ''), 'https://pinlane.invalid').searchParams.get('apercu') === '1';
  } catch (error) {
    return false;
  }
}

function reponsePrivee(res) {
  if (!res || res.__reponsePrivee) return;
  res.__reponsePrivee = true;
  const poser = res.setHeader.bind(res);
  res.setHeader = (nom, valeur) => {
    const cle = String(nom).toLowerCase();
    return poser(nom, cle === 'cache-control' ? CACHE_PRIVE : cle === 'vary' ? VARY_PRIVE : valeur);
  };
  poser('Cache-Control', CACHE_PRIVE);
  poser('Vary', VARY_PRIVE);
}

// L apercu pour cette requete, ou null. Une demande d apercu rend toujours une reponse privee, accordee ou non.
async function apercuDeLEquipe(req, res, centre) {
  if (!apercuDemande(req)) return null;
  reponsePrivee(res);
  const id = String((centre && centre.id) || '');
  if (!id || !centre.embed || centre.embed.actif !== false || !coupureEnLigne(id)) return null;
  if (require('./centre-publie').manqueAPublier(centre)) return null;
  const session = await require('./session-du-personnel').sessionDuPersonnel(req);
  if (!session) return null;
  let entre = null;
  try { entre = await require('./staff-auth').sessionAuCentre(session, id); } catch (error) { entre = null; }
  return entre ? { bandeau: BANDEAU, envoi: ENVOI } : null;
}

module.exports = { apercuDeLEquipe, apercuDemande, reponsePrivee, BANDEAU, ENVOI, CACHE_PRIVE };
