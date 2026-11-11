'use strict';
// LE TELEPHONE DU CLIENT EST OBLIGATOIRE A LA CREATION (Ansar, 2026-11-11 : « on doit
// obligatoirement mettre numéro de téléphone »). Une seule regle pour la fenetre Reserver
// (api/staff-reservations.js) et pour la reservation que l assistant prepare
// (lib/assistant-reservation.js) ; la page la redit dans assets/app-main.js
// (rvTelephoneValide).
//
// Les chiffres se lisent comme la fenetre les met en forme (normalizePhoneInput) :
// « 0... » est belge, « 00 » ou « + » ouvre un indicatif. Un numero tient avec au moins
// 8 chiffres apres l indicatif belge (un fixe de Bruxelles en a 8, un portable 9) et au
// plus 15 en tout (la norme E.164) ; un numero etranger compte son indicatif.

function chiffresDuTelephone(valeur) {
  const brut = String(valeur || '').replace(/\s+/g, ' ').trim();
  if (!brut) return '';
  const chiffres = brut.replace(/\D/g, '');
  if (brut.startsWith('+')) return chiffres;
  if (brut.startsWith('00')) return chiffres.slice(2);
  if (brut.startsWith('0')) return `32${chiffres.slice(1)}`;
  return `32${chiffres}`;
}

function telephoneValide(valeur) {
  const chiffres = chiffresDuTelephone(valeur);
  return chiffres.length <= 15 && chiffres.replace(/^32/, '').length >= 8;
}

// La forme que la fenetre envoie : « +32 470 12 34 56 » reste tel quel, « 0470... »
// prend l indicatif belge.
function telephoneMisEnForme(valeur) {
  const brut = String(valeur || '').replace(/\s+/g, ' ').trim();
  if (!brut) return '';
  if (brut.startsWith('+')) return brut;
  if (brut.startsWith('00')) return `+${brut.slice(2)}`;
  if (brut.startsWith('0')) return `+32 ${brut.slice(1)}`.trim();
  return `+32 ${brut}`.trim();
}

module.exports = { chiffresDuTelephone, telephoneValide, telephoneMisEnForme };
