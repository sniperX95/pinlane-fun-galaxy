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

// LE TELEPHONE COTE STAFF PEUT ETRE UN MOT (Ansar, 2026-11-22 : « côté staff on peut pouvoir
// écrire autre que des chiffres, des fois c par mail, on écrit par mail dessus ou / quand y a
// pas »). Un texte court passe : « par mail », « / ». Il ne vaut JAMAIS un numero : aucun SMS,
// aucun appel n en part. Un texte fait de chiffres et de ponctuation de numero (+ . - / espaces
// parentheses) est un numero et doit tenir (telephoneValide). Le formulaire public garde sa
// propre regle ; l assistant garde telephoneValide.
const TELEPHONE_MAX = 40;

function ressembleAUnNumero(valeur) {
  const brut = String(valeur || '').trim();
  return /^[+\d\s().\/-]+$/.test(brut) && /\d/.test(brut);
}

function telephoneAccepte(valeur) {
  const brut = String(valeur || '').replace(/\s+/g, ' ').trim();
  if (!brut || brut.length > TELEPHONE_MAX) return false;
  if (!ressembleAUnNumero(brut)) return true;
  return telephoneValide(brut);
}

// Le numero qui part en SMS : seulement un vrai numero, jamais un mot ni un « / ».
function telephoneEnvoyable(valeur) {
  const brut = String(valeur || '').trim();
  return ressembleAUnNumero(brut) && telephoneValide(brut);
}

module.exports = { chiffresDuTelephone, telephoneValide, telephoneMisEnForme, telephoneAccepte, telephoneEnvoyable, ressembleAUnNumero, TELEPHONE_MAX };
