/* PINO, LA MASCOTTE DE PINLANE (2026-09-25).

   Movsar : « il nous faudrait une mascotte en dessin comme eux mais plus
   quali, qui est active, animée ». Une quille, parce que c est le metier des
   centres : elle flotte, cligne des yeux, salue a l arrivee, se rejouit
   quand tout est fait, reflechit pendant un vrai calcul, dort quand il n y a
   rien a faire.

   Le dessin est en couches (bras, corps, ombre de volume, bandes du col,
   contour, visage), chaque couche nommee pour que la feuille (pinlane.css,
   classes pm-) l anime en transform et opacity seulement. prefers-reduced-
   motion coupe tout. Decorative : aria-hidden, c est le texte voisin qui
   porte le sens ; une humeur ne remplace jamais un message.

   API : PinlaneMascot.html({ mood, size, className }) rend le balisage ;
   PinlaneMascot.setMood(el, mood) change l humeur d une mascotte posee. */
(function () {
  'use strict';

  var MOODS = { idle: 1, wave: 1, happy: 1, think: 1, sleep: 1 };
  var SIZES = { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 };
  var uid = 0;

  // La silhouette d une quille : tete ronde, col serre, ventre large, base
  // plate. Symetrique autour de x = 60.
  var CORPS = 'M60 9C73.5 9 82 18.5 82 31.5C82 42 76.5 49 73.4 55.2C71.3 59.6 72.2 64.8 75.8 70.6'
    + 'C85.6 84.5 94 98 94 112.5C94 126.5 87.5 136.8 81.5 143.6Q79.4 146 76.2 146H43.8Q40.6 146 38.5 143.6'
    + 'C32.5 136.8 26 126.5 26 112.5C26 98 34.4 84.5 44.2 70.6C47.8 64.8 48.7 59.6 46.6 55.2'
    + 'C43.5 49 38 42 38 31.5C38 18.5 46.5 9 60 9Z';

  function bras(cote, mood) {
    // Un bras = un trait d encre epais, puis un trait blanc plus fin par-dessus :
    // une capsule cernee, comme le corps. Il salue a droite ; la joie leve les
    // deux.
    var leve = cote === 'r' ? (mood === 'wave' || mood === 'happy') : mood === 'happy';
    var d = cote === 'l'
      ? (leve ? 'M33 91C24.5 85.5 19.5 77.5 18 69' : 'M33 93C25.5 97 20.5 103.5 18.5 111')
      : (leve ? 'M87 91C95.5 85.5 100.5 77.5 102 69' : 'M87 93C94.5 97 99.5 103.5 101.5 111');
    return '<g class="pm__arm pm__arm--' + cote + '">'
      + '<path class="pm__arm-ink" d="' + d + '"/>'
      + '<path class="pm__arm-fill" d="' + d + '"/>'
      + '</g>';
  }

  function yeux(mood) {
    if (mood === 'happy') {
      return '<g class="pm__eyes pm__eyes--joie">'
        + '<path class="pm__lid" d="M48.6 31.2Q52 26.4 55.4 31.2"/>'
        + '<path class="pm__lid" d="M64.6 31.2Q68 26.4 71.4 31.2"/>'
        + '</g>';
    }
    if (mood === 'sleep') {
      return '<g class="pm__eyes pm__eyes--dodo">'
        + '<path class="pm__lid" d="M48.6 29.6Q52 33 55.4 29.6"/>'
        + '<path class="pm__lid" d="M64.6 29.6Q68 33 71.4 29.6"/>'
        + '</g>';
    }
    return '<g class="pm__eyes">'
      + '<g class="pm__pupils">'
      + '<ellipse class="pm__eye" cx="52" cy="29.8" rx="3.3" ry="4.3"/>'
      + '<ellipse class="pm__eye" cx="68" cy="29.8" rx="3.3" ry="4.3"/>'
      + '<circle class="pm__glint" cx="53.1" cy="28.1" r="1.15"/>'
      + '<circle class="pm__glint" cx="69.1" cy="28.1" r="1.15"/>'
      + '</g></g>';
  }

  function bouche(mood) {
    if (mood === 'happy') return '<path class="pm__mouth-open" d="M54.4 37.4Q60 46.2 65.6 37.4Q60 39.6 54.4 37.4Z"/>';
    if (mood === 'sleep') return '<ellipse class="pm__mouth-o" cx="60" cy="40" rx="1.9" ry="1.6"/>';
    // « Hmm » : une moue de cote, pas une grimace triste.
    if (mood === 'think') return '<path class="pm__mouth" d="M57.4 40.4Q60.6 41.4 63.8 39.2"/>';
    return '<path class="pm__mouth" d="M55.4 38.3Q60 42.9 64.6 38.3"/>';
  }

  // Les sourcils ne sortent que quand ils disent quelque chose : un sourcil
  // leve pour reflechir.
  function sourcils(mood) {
    if (mood !== 'think') return '';
    return '<path class="pm__brow" d="M48.6 22.9Q52 22 55.4 23.1"/>'
      + '<path class="pm__brow" d="M64.4 21.6Q68 18.8 71.6 20.6"/>';
  }

  function extras(mood) {
    if (mood === 'think') {
      return '<g class="pm__dots"><circle cx="90" cy="18" r="2.4"/><circle cx="98" cy="12" r="2.4"/><circle cx="106" cy="6.5" r="2.4"/></g>';
    }
    if (mood === 'sleep') {
      return '<g class="pm__zz"><text x="86" y="22">z</text><text x="95" y="12">z</text></g>';
    }
    if (mood === 'happy') {
      return '<g class="pm__sparks">'
        + '<path d="M22 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>'
        + '<path d="M100 36l1.5 3.6 3.6 1.5-3.6 1.5-1.5 3.6-1.5-3.6-3.6-1.5 3.6-1.5z"/>'
        + '<path d="M104 88l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z"/>'
        + '</g>';
    }
    return '';
  }

  function svg(id, mood) {
    return '<svg class="pm__svg" viewBox="0 0 120 152" focusable="false">'
      + '<defs><clipPath id="' + id + '-c"><path d="' + CORPS + '"/></clipPath></defs>'
      + '<ellipse class="pm__shadow" cx="60" cy="147.5" rx="29" ry="3.6"/>'
      + '<g class="pm__bob">'
      + bras('l', mood) + bras('r', mood)
      + '<path class="pm__body" d="' + CORPS + '"/>'
      // LE VOLUME : la silhouette entiere dans le ton d ombre, puis la meme
      // silhouette eclairee, decalee vers la gauche. Il reste un croissant
      // d ombre qui suit exactement le bord droit, tete comprise.
      + '<g clip-path="url(#' + id + '-c)">'
      + '<path class="pm__shade" d="' + CORPS + '"/>'
      + '<path class="pm__lit" d="' + CORPS + '" transform="translate(-6.5 1)"/>'
      + '<path class="pm__band" d="M18 60.5Q60 67.5 102 60.5V66Q60 73 18 66Z"/>'
      + '<path class="pm__band" d="M18 71.2Q60 78.2 102 71.2V75.2Q60 82.2 18 75.2Z"/>'
      + '<ellipse class="pm__gloss" cx="44.5" cy="104" rx="4.2" ry="13" transform="rotate(10 44.5 104)"/>'
      + '<ellipse class="pm__gloss" cx="50" cy="21" rx="4.6" ry="2.6" transform="rotate(-24 50 21)"/>'
      + '</g>'
      + '<path class="pm__outline" d="' + CORPS + '"/>'
      + '<g class="pm__face">'
      + sourcils(mood)
      + yeux(mood)
      + '<ellipse class="pm__cheek" cx="45.6" cy="37.4" rx="3.5" ry="2.1"/>'
      + '<ellipse class="pm__cheek" cx="74.4" cy="37.4" rx="3.5" ry="2.1"/>'
      + bouche(mood)
      + '</g>'
      + '</g>'
      + extras(mood)
      + '</svg>';
  }

  function html(options) {
    var o = options || {};
    var mood = MOODS[o.mood] ? o.mood : 'idle';
    var size = SIZES[o.size] ? o.size : 'md';
    uid += 1;
    return '<span class="pm pm--' + mood + ' pm--' + size + (o.className ? ' ' + String(o.className) : '')
      + '" data-mood="' + mood + '" aria-hidden="true">' + svg('pm' + uid, mood) + '</span>';
  }

  // Change l humeur d une mascotte deja posee, sans toucher a sa taille ni a
  // ses classes propres. Meme humeur : rien ne se redessine (une animation
  // d entree ne se rejoue pas pour rien).
  function setMood(el, mood) {
    if (!el || !MOODS[mood] || el.getAttribute('data-mood') === mood) return;
    uid += 1;
    Object.keys(MOODS).forEach(function (m) { el.classList.remove('pm--' + m); });
    el.classList.add('pm--' + mood);
    el.setAttribute('data-mood', mood);
    el.innerHTML = svg('pm' + uid, mood);
  }

  window.PinlaneMascot = { html: html, setMood: setMood };
})();
