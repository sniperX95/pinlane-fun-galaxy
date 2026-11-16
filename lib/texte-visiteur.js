'use strict';
// CE QU UN VISITEUR ECRIT DANS UN NOM OU UN INTITULE N Y LAISSE NI PIEGE, NI RESTE (2026-11-16).
//
// Le corps d un mail passe par textToHtml : `[texte](https://...)` y devient un lien, et une ligne
// `[[bouton : ... | https://...]]` un bouton. La premiere parade (sansBalisage) cassait ces formes en
// les laissant dans le texte : le mail de l equipe disait « Marie [ [bouton : Ouvrir la réservation |
// (lien retiré) Dupont ». Ansar, devant ce mail : « on dirait pas fini et ça décrédibilise ».
//
// Un nom ou un intitule n a aucune raison de porter un bouton, un lien ou une adresse web : le morceau
// part EN ENTIER, et il reste « Marie Dupont ». Une seule ligne, sans espaces en double.
//
// Lu par la porte publique (lib/reservation-request.js, l intitule du dossier) et par les mails d un
// dossier (lib/ops-communications.js, dossierSansBalisage). Un MESSAGE libre du client n est pas
// concerne : il garde son texte, que sansBalisage desarme sans le couper.
function sansPiege(texte) {
  return String(texte ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    // un bloc [[bouton : ... | ...]], ferme ou coupe avant la fin
    .replace(/\[\[[^\]]*(?:\]\]|$)/g, ' ')
    // un lien [texte](https://...), parenthese fermee ou non
    .replace(/\[[^\]]*\]\s*\(\s*(?:https?:\/\/|www\.)[^)\s]*\)?/gi, ' ')
    // une adresse web seule
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    // ce qui resterait d une forme tordue
    .replace(/\[\[|\]\]|\]\s*\(/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { sansPiege };
