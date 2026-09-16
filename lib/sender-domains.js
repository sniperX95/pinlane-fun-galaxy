// A QUI APPARTIENT UNE ADRESSE D ENVOI (2026-09-16).
//
// Tous les clients de la plateforme partagent UN compte Resend. Le jour ou un
// domaine y est verifie pour un client (fungalaxy.be, le 16 septembre), rien
// cote fournisseur n empeche un AUTRE client d envoyer en son nom, signature
// DKIM valide comprise : il suffisait d enregistrer une identite d expediteur
// sur ce domaine, et saveEmailIdentity ne verifiait que la forme de l adresse.
// Resend ne connait pas nos clients : la frontiere se tient donc ici.
//
// LA REGLE. Un centre n envoie que depuis :
//   - un domaine de la PLATEFORME (pinlane.be ; resend.dev pour le repli
//     d installation) ;
//   - un domaine DECLARE pour SON client : l adresse publique d un de ses
//     centres au catalogue (ops-knowledge/centers.json, tenu par la
//     plateforme), ou une identite deja posee sur un de ses centres.
// Un domaine NEUF ne s ouvre que par la plateforme (provisionnement, session
// fondateur) : c est elle qui le verifie chez Resend, donc elle qui le declare.
// Et jamais, meme pour la plateforme, un domaine qu un AUTRE client tient deja.
//
// LE REFUS NE DIT PAS POURQUOI. « Ce domaine appartient a un autre
// etablissement » apprendrait a un client l existence d un autre : le message
// est le meme qu un domaine simplement jamais declare.

const DOMAINES_PLATEFORME = new Set(['pinlane.be', 'resend.dev']);
const RX_ADRESSE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// « Nom <adresse> » ou « adresse » -> adresse en minuscules, '' si invalide.
function adresseNue(valeur) {
  const brut = String(valeur || '').trim();
  const chevrons = brut.match(/<([^<>]+)>\s*$/);
  const adresse = (chevrons ? chevrons[1] : brut).trim().toLowerCase();
  return RX_ADRESSE.test(adresse) ? adresse : '';
}

function domaineDe(valeur) {
  const adresse = adresseNue(valeur);
  return adresse ? adresse.slice(adresse.lastIndexOf('@') + 1) : '';
}

// Le domaine sur lequel le fournisseur nous remet le courrier des centres
// (`libramont@inbound.pinlane.be`). Ce n est PAS un domaine d envoi.
function domaineReception() {
  return String(process.env.INBOUND_EMAIL_DOMAIN || 'inbound.pinlane.be').trim().toLowerCase();
}

// UNE VARIABLE D ENVIRONNEMENT VAUT POUR TOUS LES CLIENTS. Elle ne peut donc
// designer qu une adresse de la plateforme. Posee sur l adresse d un client
// (RESEND_FROM="Fun Galaxy <...>", RESEND_REPLY_TO=libramont@fungalaxy.be...),
// chaque AUTRE client signerait de son nom ou lui enverrait ses reponses : elle
// est alors ignoree. Le nom affiche est retire au passage, pour la meme raison.
function adresseDePlateforme(valeur) {
  const adresse = adresseNue(valeur);
  return adresse && DOMAINES_PLATEFORME.has(domaineDe(adresse)) ? adresse : '';
}

// UNE ADRESSE DE RECEPTION RAMENE LES REPONSES DANS LA BOITE DU CENTRE QU ELLE
// NOMME. Posee en retour d un autre centre, elle ferait lire les clients de
// l un par l autre.
function adresseDeReceptionDUnAutreCentre(centerId, valeur) {
  const adresse = adresseNue(valeur);
  if (!adresse || domaineDe(adresse) !== domaineReception()) return false;
  return adresse.slice(0, adresse.lastIndexOf('@')) !== String(centerId || '').trim().toLowerCase();
}

function clientDuCentre(centerId, declarations) {
  const id = String(centerId || '').trim();
  // Un centre sans client connu forme a lui seul son propre perimetre : il ne
  // peut rien heriter d un autre.
  return declarations.clientParCentre.get(id) || `centre:${id}`;
}

function construireDeclarations(lignesCentres, lignesIdentites, centresCatalogue) {
  const clientParCentre = new Map();
  for (const ligne of lignesCentres || []) {
    const id = String((ligne && ligne.id) || '').trim();
    const client = String((ligne && ligne.client_id) || '').trim();
    if (id && client) clientParCentre.set(id, client);
  }
  const declarations = { clientParCentre, domainesParClient: new Map() };
  const declarer = (centerId, adresse) => {
    const domaine = domaineDe(adresse);
    if (!domaine || DOMAINES_PLATEFORME.has(domaine) || domaine === domaineReception()) return;
    const client = clientDuCentre(centerId, declarations);
    if (!declarations.domainesParClient.has(client)) declarations.domainesParClient.set(client, new Set());
    declarations.domainesParClient.get(client).add(domaine);
  };
  for (const centre of centresCatalogue || []) {
    declarer(centre && centre.id, centre && centre.publicInfo && centre.publicInfo.email);
  }
  for (const ligne of lignesIdentites || []) declarer(ligne && ligne.center_id, ligne && ligne.email);
  return declarations;
}

async function chargerDeclarations(query) {
  const centres = await query("select id, coalesce(client_id, '') as client_id from centers;", []);
  const identites = await query('select center_id, email from email_identities;', []);
  // Pas de repli silencieux : un catalogue illisible leve, et l enregistrement
  // echoue au lieu de passer sans la moitie des declarations.
  const { loadOpsKnowledge } = require('./ops-knowledge');
  return construireDeclarations(centres.rows, identites.rows, loadOpsKnowledge().centers);
}

// Vrai si le centre PEUT signer depuis cette adresse.
function expediteurAutorise(centerId, valeur, declarations, { declarationPlateforme = false } = {}) {
  const adresse = adresseNue(valeur);
  if (!adresse) return false;
  const domaine = domaineDe(adresse);
  // Une adresse de reception n est jamais un expediteur : les reponses a ce
  // mail repartiraient dans la boite du centre qu elle nomme.
  if (domaine === domaineReception()) return false;
  const moi = clientDuCentre(centerId, declarations);
  for (const [client, domaines] of declarations.domainesParClient) {
    if (client !== moi && domaines.has(domaine)) return false;
  }
  if (DOMAINES_PLATEFORME.has(domaine) || declarationPlateforme) return true;
  const miens = declarations.domainesParClient.get(moi);
  return Boolean(miens && miens.has(domaine));
}

// Vrai si l adresse appartient a un AUTRE client que celui du centre : son
// domaine est tenu par un autre client, ou c est l adresse de reception d un
// centre d un autre client. Une adresse qu aucun client ne tient (celle de la
// plateforme, une boite personnelle) n appartient a personne : elle reste
// utilisable, ce qui laisse intacte une configuration existante.
function adresseDUnAutreClient(centerId, valeur, declarations) {
  const adresse = adresseNue(valeur);
  if (!adresse) return false;
  const domaine = domaineDe(adresse);
  const moi = clientDuCentre(centerId, declarations);
  if (domaine === domaineReception()) {
    return clientDuCentre(adresse.slice(0, adresse.lastIndexOf('@')), declarations) !== moi;
  }
  for (const [client, domaines] of declarations.domainesParClient) {
    if (client !== moi && domaines.has(domaine)) return true;
  }
  return false;
}

async function verifierExpediteur(centerId, valeur, { query, declarationPlateforme = false } = {}) {
  const declarations = await chargerDeclarations(query);
  return expediteurAutorise(centerId, valeur, declarations, { declarationPlateforme });
}

module.exports = {
  DOMAINES_PLATEFORME,
  adresseNue,
  adresseDePlateforme,
  adresseDUnAutreClient,
  adresseDeReceptionDUnAutreCentre,
  chargerDeclarations,
  construireDeclarations,
  domaineDe,
  domaineReception,
  expediteurAutorise,
  verifierExpediteur,
};
