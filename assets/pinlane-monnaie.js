/* ============================================================================
   LA MONNAIE D'UN CENTRE (2026-11-17)
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE. Jusqu'ici tout montant s'ecrivait avec un « € »
   en dur (304 dans 59 fichiers, mesure du 17/11) et la config d'un centre
   n'avait aucun champ pour sa monnaie : un centre suisse ne pouvait pas vendre
   en francs suisses (point D6 de la note avant-lancement du 16/11). Ansar, le
   17/11 : « regle tout ca ».

   LA LISTE BLANCHE VIT ICI, ET NULLE PART AILLEURS. Le serveur la lit par
   lib/monnaie.js (la config du centre, les mails, l'assistant), les pages par
   window.PinlaneMonnaie (le formulaire en ligne, la console). Ajouter une
   monnaie, c'est ajouter une ligne a DEVISES.

   L'EURO NE CHANGE PAS D'UN OCTET. Chaque endroit garde sa facon d'ecrire le
   nombre (virgule, espace fine ou insecable, « 25€ » colle ou « 25 € ») :
   seul le signe vient d'ici. signe('EUR') rend « € », signeColle('EUR') rend
   « € » sans espace : un centre en euros lit exactement ce qu'il lisait.
   Un code de lettres ne se colle jamais au nombre : « 25 CHF », pas « 25CHF ».

   AUCUN ETAT ICI. Le serveur sert plusieurs centres a la fois : la monnaie se
   passe a chaque appel, jamais retenue. Chaque page lit celle de SON centre
   (le formulaire dans sa meta, la console dans la config du centre ouvert).

   Double vie : global navigateur (window.PinlaneMonnaie) et module CommonJS,
   comme assets/brand-color.js, pour que le serveur et le gate exercent
   EXACTEMENT ce code et pas une copie.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinlaneMonnaie = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // `signe` : ce qui suit le montant. `noms` et `deNoms` : la monnaie dite en toutes lettres (« en euros »,
  // « combien d’euros »). `langue` : la langue de Intl pour un
  // affichage en style monnaie (le nombre garde l'ecriture belge partout ou la
  // page l'ecrit elle-meme). `libelle` : le choix de la console.
  const DEVISES = Object.freeze({
    EUR: Object.freeze({ code: 'EUR', signe: '€', nom: 'euro', noms: 'euros', deNoms: 'd’euros', libelle: 'Euro (€)' }),
    CHF: Object.freeze({ code: 'CHF', signe: 'CHF', nom: 'franc suisse', noms: 'francs suisses', deNoms: 'de francs suisses', libelle: 'Franc suisse (CHF)' }),
  });
  const DEFAUT = 'EUR';
  const CODES = Object.freeze(Object.keys(DEVISES));

  // Toute valeur inconnue, vide ou mal ecrite redevient l'euro : un reglage
  // abime ne doit jamais faire afficher une monnaie que le centre n'a pas.
  function devise(valeur) {
    const code = String(valeur === undefined || valeur === null ? '' : valeur).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(DEVISES, code) ? code : DEFAUT;
  }

  function estConnue(valeur) {
    const code = String(valeur === undefined || valeur === null ? '' : valeur).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(DEVISES, code);
  }

  function infos(valeur) { return DEVISES[devise(valeur)]; }
  function signe(valeur) { return infos(valeur).signe; }
  // La ou la page ecrivait « 25€ » colle : l'euro reste colle, un code de
  // lettres prend son espace.
  function signeColle(valeur) {
    const s = signe(valeur);
    return s === '€' ? s : ` ${s}`;
  }
  function noms(valeur) { return infos(valeur).noms; }
  function deNoms(valeur) { return infos(valeur).deNoms; }

  // Pour lire un montant ecrit dans un texte : tous les signes connus, du plus
  // long au plus court, echappes pour une expression reguliere.
  const MOTIF_SIGNES = CODES
    .map((code) => DEVISES[code].signe)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // Ce que la console propose, dans l'ordre de la liste blanche.
  function choix() {
    return CODES.map((code) => ({ code, libelle: DEVISES[code].libelle }));
  }

  return {
    DEVISES,
    DEFAUT,
    CODES,
    MOTIF_SIGNES,
    devise,
    estConnue,
    infos,
    signe,
    signeColle,
    noms,
    deNoms,
    choix,
  };
}));
