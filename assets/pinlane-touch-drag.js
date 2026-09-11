// LE GLISSER AU DOIGT, ECRIT UNE FOIS (2026-09-11).
//
// Movsar : « tout ce qui est drag and drop ca fonctionne pas pour genre
// tablette tactile ». Les cartes du planning suivaient la souris seule
// (mousedown, mousemove) : au doigt, le navigateur fait defiler la page et ces
// evenements ne partent jamais. Le tableau d analyse suivait le pointeur, mais
// le defilement natif lui volait le geste des que le doigt bougeait.
//
// UN SEUL GESTE, PARTOUT : un APPUI LONG leve l element (MAINTIEN_MS sans
// bouger de plus de TOLERANCE_PX), comme un agenda ou une liste sur telephone ;
// un doigt qui part tout de suite fait defiler, un tap reste un clic. Une fois
// leve, le doigt deplace l element et plus la page, et le relacher depose,
// sans clic emule derriere ; leve puis relache sur place, rien ne se depose.
// C est un geste a UN doigt : un second doigt sur l ecran l arrete (pincement).
//
// POURQUOI LES EVENEMENTS TACTILES ET PAS LE POINTEUR : sous touch-action
// auto, le navigateur annule le pointeur (pointercancel) des qu il decide de
// faire defiler, et un touch-action: none sur les cartes empecherait de faire
// defiler le planning en partant d une carte. Un touchmove annule, lui, arrete
// le defilement sans rien casser d autre.
//
// LE GESTE S ECOUTE SUR L ELEMENT, pas sur le document : un geste tactile
// reste adresse a l element ou il a commence, meme si le planning se redessine
// pendant le geste et que cet element quitte la page ; et Safari n honore le
// preventDefault d un touchmove que si un gestionnaire non passif existait
// AVANT le geste. Seul le guet du second doigt est sur le document.
//
// Chaque utilisateur fournit ses rappels : lever(point), bouger(point),
// deposer(point), annuler(etaitLeve), et en option maintienLong(point), un
// second palier atteint en restant immobile une fois l element leve. Un point a
// la forme d un evenement souris (clientX, clientY, button, preventDefault,
// stopPropagation) : le code ecrit pour la souris le lit tel quel.
(function () {
  'use strict';

  var MAINTIEN_MS = 280;
  var TOLERANCE_PX = 8;
  var geste = null;

  function point(contact) {
    return {
      clientX: contact.clientX,
      clientY: contact.clientY,
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: function () {},
      stopPropagation: function () {},
    };
  }

  function contactDe(liste, id) {
    if (!liste) return null;
    for (var i = 0; i < liste.length; i += 1) {
      if (liste[i].identifier === id) return liste[i];
    }
    return null;
  }

  function horsTolerance(x, y, x0, y0) {
    var dx = x - x0;
    var dy = y - y0;
    return dx * dx + dy * dy > TOLERANCE_PX * TOLERANCE_PX;
  }

  function effacerMinuteries(g) {
    if (g.minuterie) window.clearTimeout(g.minuterie);
    if (g.minuterieLongue) window.clearTimeout(g.minuterieLongue);
    g.minuterie = 0;
    g.minuterieLongue = 0;
  }

  function abandonner() {
    var g = geste;
    geste = null;
    if (!g) return;
    effacerMinuteries(g);
    if (g.rappels.annuler) g.rappels.annuler(g.leve);
  }

  function lever() {
    var g = geste;
    if (!g) return;
    g.minuterie = 0;
    g.leve = true;
    g.xLeve = g.dernier.clientX;
    g.yLeve = g.dernier.clientY;
    g.rappels.lever(g.dernier);
    if (g.rappels.maintienLong && g.maintienLongMs > 0) {
      g.minuterieLongue = window.setTimeout(function () {
        if (geste !== g) return;
        g.minuterieLongue = 0;
        g.rappels.maintienLong(g.dernier);
      }, g.maintienLongMs);
    }
  }

  function demarrer(event, rappels, options) {
    if (!event || !event.touches) return;
    // Un geste encore ouvert ici a perdu sa fin : il est oublie, ses minuteries
    // avec lui, avant d en ouvrir un autre.
    if (geste) abandonner();
    // Un doigt deja pose ailleurs : c est un geste a deux doigts, rien ne se leve.
    if (event.touches.length !== 1) return;
    var contact = event.touches[0];
    var opts = options || {};
    geste = {
      id: contact.identifier,
      x0: contact.clientX,
      y0: contact.clientY,
      dernier: point(contact),
      leve: false,
      bouge: false,
      rappels: rappels,
      minuterie: 0,
      minuterieLongue: 0,
      maintienLongMs: Number(opts.maintienLongMs) || 0,
      xLeve: 0,
      yLeve: 0,
    };
    geste.minuterie = window.setTimeout(lever, Number(opts.maintienMs) || MAINTIEN_MS);
  }

  function bouger(event) {
    var g = geste;
    if (!g) return;
    var contact = contactDe(event.changedTouches, g.id);
    if (!contact) return;
    g.dernier = point(contact);
    if (!g.leve) {
      // Le doigt part avant la levee : c est un defilement, le navigateur le garde.
      if (horsTolerance(contact.clientX, contact.clientY, g.x0, g.y0)) abandonner();
      return;
    }
    if (event.cancelable) event.preventDefault();
    if (!g.bouge && horsTolerance(contact.clientX, contact.clientY, g.xLeve, g.yLeve)) {
      g.bouge = true;
      if (g.minuterieLongue) window.clearTimeout(g.minuterieLongue);
      g.minuterieLongue = 0;
    }
    g.rappels.bouger(g.dernier);
  }

  function finir(event) {
    var g = geste;
    if (!g) return;
    var contact = contactDe(event.changedTouches, g.id);
    if (!contact) return;
    geste = null;
    effacerMinuteries(g);
    if (!g.leve || !g.bouge) {
      // Un tap, ou un appui un peu long relache sur place : rien ne se depose,
      // l element reprend sa place et le clic que le navigateur emule, s il en
      // emule un, fait son travail habituel (ouvrir la reservation).
      if (g.rappels.annuler) g.rappels.annuler(g.leve);
      return;
    }
    // Un depot : ni souris ni clic emules derriere lui.
    if (event.cancelable) event.preventDefault();
    g.rappels.deposer(point(contact));
  }

  function interrompre(event) {
    if (!geste) return;
    if (event && event.changedTouches && !contactDe(event.changedTouches, geste.id)) return;
    abandonner();
  }

  // Sur Android, l appui long ouvre un menu contextuel : pas pendant un geste.
  function menu(event) {
    if (geste && event && event.cancelable) event.preventDefault();
  }

  // UN SECOND DOIGT, OU QU IL SE POSE, fait de l ensemble un pincement ou un
  // defilement a deux doigts : le geste en cours s arrete, avant ou apres la
  // levee, et l element reprend sa place. Ecoute sur le document, en capture :
  // le second doigt peut se poser hors de l element, ou le geste n entend rien.
  document.addEventListener('touchstart', function (event) {
    if (geste && event.touches && event.touches.length > 1) abandonner();
  }, { passive: true, capture: true });

  window.PinlaneTouchDrag = {
    MAINTIEN_MS: MAINTIEN_MS,
    TOLERANCE_PX: TOLERANCE_PX,
    demarrer: demarrer,
    bouger: bouger,
    finir: finir,
    interrompre: interrompre,
    menu: menu,
    actif: function () { return Boolean(geste); },
  };
})();
