// LES MONTANTS SUIVENT LE DROIT « Voir les montants » JUSQU AU SERVEUR (passe securite
// du 2026-11-08).
//
// Le droit `payments.view` ne gardait que l ecran : la console affichait « ··· »
// (moneyForRole, assets/app-main.js), mais le serveur envoyait quand meme les prix des
// reservations, l encaisse, le chiffre d affaires et le panier moyen. Les outils du
// navigateur les montraient a un role Marketing ou Technique. Le serveur les retire
// maintenant de TOUTE reponse JSON du staff faite pour une session sans ce droit :
// requireStaffPermission (lib/staff-auth.js) pose la marque sur la reponse, sendJson
// (lib/http.js) l applique. Une seule regle, au meme endroit, pour toutes les routes,
// y compris celles qui viendront.
//
// Ce qui n est PAS retire : les prix du CATALOGUE (formules, activites, grilles). Ils
// sont publics, le formulaire du site les montre a tout le monde, et la page Tarifs en a
// besoin (api/ops.js les exempte). Le statut paye ou non, le moyen de paiement et
// l heure de l encaissement restent aussi : ce ne sont pas des montants.
//
// La valeur retiree devient null, jamais 0 : un zero est un FAIT, et il serait faux. Un
// prix null renvoye par la console dans une modification est ignore par le serveur
// (api/staff-reservations.js garde alors le prix du dossier).
'use strict';

const CLES_ARGENT = new Set([
  // Une reservation et son programme.
  'price', 'basePrice', 'amountPaid', 'discountReason', 'unitPrice', 'totalPrice', 'lineTotal',
  // L encaisse et ce qui reste a payer.
  'encaisse', 'montant', 'prix', 'amount', 'collected', 'resteAPayer', 'aEncaisser',
  // Les chiffres : chiffre d affaires, panier moyen, paie des agents marketing.
  'revenue', 'revenue30', 'revenueTotal', 'revenue_total', 'revenue_by_type', 'reservedRevenue',
  'avgRevenue', 'referenceRevenue', 'previousRevenue', 'avgBasket', 'avg_basket', 'panierMoyen',
  'euros', 'chiffre', 'chiffreAffaires',
]);

// Une copie de la valeur sans ses montants. Les cles d argent valent null (une raison de
// remise, texte, devient vide). Profondeur bornee : une reponse n a pas 40 niveaux.
function sansMontants(valeur, profondeur = 0) {
  if (profondeur > 40 || valeur === null || typeof valeur !== 'object') return valeur;
  if (valeur instanceof Date || Buffer.isBuffer(valeur)) return valeur;
  if (Array.isArray(valeur)) return valeur.map((v) => sansMontants(v, profondeur + 1));
  const copie = {};
  for (const [cle, v] of Object.entries(valeur)) {
    if (CLES_ARGENT.has(cle)) {
      copie[cle] = typeof v === 'string' && cle === 'discountReason' ? '' : null;
    } else {
      copie[cle] = sansMontants(v, profondeur + 1);
    }
  }
  return copie;
}

module.exports = { CLES_ARGENT, sansMontants };
