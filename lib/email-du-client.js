'use strict';
// L E-MAIL DU CLIENT, TAPE PAR L EQUIPE (Ansar, 2026-11-23 : « pour un truc plus quali, le par mail, mais
// genre un bouton simple, rapide, efficace [...] le champ se transforme en champ pour écrire le mail, mais
// c'est optionnel, ils peuvent dire qu'ils ont pas le mail »). Une seule regle pour la creation (la fenetre
// Reserver, un lot compris) et pour l onglet Modifier (api/staff-reservations.js) ; la page la redit
// (assets/app-main.js : rvEmailNettoye, rvEmailValide) et scripts/par-mail-check.js prouve que les deux
// disent la meme chose. Vide, le client n a pas d adresse : c est permis. Le formulaire en ligne garde sa
// propre regle (lib/reservation-request.js, requireEmail).
//
// NETTOYEE : sans espaces (une adresse n en a jamais, un copier-coller en laisse), sans caractere invisible,
// sans « mailto: », sans le nom d un en-tete copie (« Jean Dupont <jean@x.be> » garde jean@x.be), sans la
// ponctuation d une fin de phrase, en minuscules (comme lib/marketing-suppression.js, normalizeEmail).
// VALIDE : avant l arobase, 64 caracteres au plus, sans point au bord ni deux points de suite ; apres, un
// domaine d au moins deux morceaux (lettres, chiffres, tirets, jamais un tiret au bord) qui finit par deux
// lettres au moins ; 254 caracteres en tout.
const EMAIL_MAX = 254;
const MESSAGE_EMAIL_INVALIDE = 'Cette adresse e-mail n’est pas valide. Une adresse s’écrit comme prenom@email.be.';

function emailNettoye(valeur) {
  let t = String(valeur ?? '').normalize('NFC').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, '');
  const entreChevrons = /<([^<>]*@[^<>]*)>/.exec(t);
  if (entreChevrons) t = entreChevrons[1];
  t = t.replace(/^mailto:/i, '').replace(/[.,;:]+$/, '');
  return t.toLowerCase();
}

function emailValide(valeur) {
  const t = String(valeur ?? '');
  if (!t || t.length > EMAIL_MAX) return false;
  const arobase = t.lastIndexOf('@');
  if (arobase <= 0 || t.indexOf('@') !== arobase) return false;
  const local = t.slice(0, arobase);
  const morceaux = t.slice(arobase + 1).split('.');
  if (local.length > 64 || /^\.|\.$|\.\./.test(local) || /[\s<>()[\]\\,;:"]/.test(local)) return false;
  if (morceaux.length < 2 || !morceaux.every((m) => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(m))) return false;
  return /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/u.test(morceaux[morceaux.length - 1]);
}

module.exports = { emailNettoye, emailValide, EMAIL_MAX, MESSAGE_EMAIL_INVALIDE };
