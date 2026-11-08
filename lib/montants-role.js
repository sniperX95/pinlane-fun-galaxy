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
// La valeur retiree devient null, jamais 0 : un zero est un FAIT, et il serait faux. Le
// chemin du retour est plus bas (retirerLesMontantsDuCorps) : ce qu une session sans ce
// droit renvoie ne touche a aucun montant.
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

// LE CHEMIN DU RETOUR. La console renvoie le dossier ENTIER a chaque modification
// (buildReservationApiPayload) : pour une session sans ce droit, ses montants reviennent
// vides. Un supplement a 15 EUR sans son prix n est plus reconnu (cleDeLigne,
// lib/droits-reservation.js) : il repartait comme une ligne neuve a 0 EUR, ou se faisait
// refuser sans qu on y ait touche. Une session qui ne voit pas les montants ne les ecrit
// donc pas : le haut du dossier perd les siens (le serveur garde le prix, ou le pose sur sa
// reference si le contenu change), et chaque ligne reprend celui du dossier stocke.
function identiteDeLigne(ligne) {
  if (!ligne || typeof ligne !== 'object') return '';
  for (const champ of ['id', 'articleId', 'activityId', 'name', 'label', 'type']) {
    const v = ligne[champ];
    if (v !== undefined && v !== null && v !== '') return `${champ}:${v}`;
  }
  return '';
}

function reprendreLesMontants(recu, stocke, profondeur = 0) {
  if (profondeur > 40 || recu === null || typeof recu !== 'object') return recu;
  if (Array.isArray(recu)) {
    const modeles = Array.isArray(stocke) ? stocke : [];
    const pris = new Set();
    return recu.map((element, i) => {
      const id = identiteDeLigne(element);
      const j = id
        ? modeles.findIndex((m, k) => !pris.has(k) && identiteDeLigne(m) === id)
        : (i < modeles.length && !pris.has(i) ? i : -1);
      if (j >= 0) pris.add(j);
      return reprendreLesMontants(element, j >= 0 ? modeles[j] : undefined, profondeur + 1);
    });
  }
  const modele = stocke && typeof stocke === 'object' && !Array.isArray(stocke) ? stocke : null;
  const copie = {};
  for (const [cle, valeur] of Object.entries(recu)) {
    if (!CLES_ARGENT.has(cle)) {
      copie[cle] = reprendreLesMontants(valeur, modele ? modele[cle] : undefined, profondeur + 1);
    } else if (modele && Object.prototype.hasOwnProperty.call(modele, cle)) {
      copie[cle] = modele[cle];
    } else if (valeur !== null && valeur !== undefined && valeur !== '') {
      // Une ligne neuve (un article du catalogue) garde son propre prix.
      copie[cle] = valeur;
    }
  }
  return copie;
}

function retirerLesMontantsDuCorps(corps, dossier) {
  for (const cle of Object.keys(corps)) {
    if (CLES_ARGENT.has(cle) || cle === 'prixRaison') delete corps[cle];
    else corps[cle] = reprendreLesMontants(corps[cle], dossier ? dossier[cle] : undefined);
  }
  return corps;
}

module.exports = { CLES_ARGENT, sansMontants, retirerLesMontantsDuCorps };
