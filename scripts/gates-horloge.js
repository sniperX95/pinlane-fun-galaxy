// L HORLOGE D UNE PAGE DANS UN GATE A LA DATE FIGEE (2026-10-30).
//
// Un gate qui remplace global.Date pour le moteur (sa journee de fixture)
// partage son processus avec Playwright, et page.clock date son journal avec
// le Date.now() de Node. La page rattrape ensuite l ecart avec SA vraie date :
// au dela de 2^31 ms (24,855 jours), ses minuteurs ne partent plus, ni
// requestAnimationFrame ni setTimeout, sans aucune erreur. libre-entier, fige
// au 5 octobre, est passe au rouge le 30/10 a 03:31 UTC sans que rien ne
// change, sur le poste comme sur GitHub (ses cartes ne se rangeaient plus).
//
// figerPage passe page.clock par la vraie classe Date, le temps de l appel :
// Playwright lit la vraie heure, le gate garde la sienne. A appeler quand aucune
// requete n est en route : le serveur du gate, dans le meme processus, verrait
// la vraie date pendant ce temps.
'use strict';

// Les dates des gates heritent de la vraie.
function vraieDate() {
  const parent = Object.getPrototypeOf(global.Date);
  return parent === Function.prototype ? global.Date : parent;
}

async function figerPage(page, instant) {
  const fausse = global.Date;
  const Vraie = vraieDate();
  global.Date = Vraie;
  try {
    await page.clock.setFixedTime(new Vraie(instant));
  } finally {
    global.Date = fausse;
  }
}

module.exports = { figerPage, vraieDate };
