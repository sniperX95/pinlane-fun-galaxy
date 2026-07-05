/* Fun Galaxy — carte digitale. Zoom NATIF. JS = entrée<->carte + bascule Recto/Verso (une page à la fois). */
(function () {
  'use strict';
  var body = document.body;
  var open = document.getElementById('openCard');
  var back = document.getElementById('backBtn');
  var seg = document.getElementById('seg');
  var stage = document.getElementById('stage');
  var img = document.getElementById('cardImg');
  var btns = seg ? seg.querySelectorAll('.seg__btn') : [];

  function showCard() {
    body.classList.remove('pre');
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
  }
  function showEntry() { body.classList.add('pre'); }

  function setFace(i) {
    if (seg) seg.setAttribute('data-face', String(i));
    for (var k = 0; k < btns.length; k++) btns[k].setAttribute('aria-current', k === i ? 'true' : 'false');
    if (img) {
      var src = i === 1 ? img.getAttribute('data-verso') : img.getAttribute('data-recto');
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.setAttribute('alt', img.getAttribute('data-alt-base') + (i === 1 ? ' — verso' : ' — recto'));
    }
    if (stage) stage.scrollTop = 0;
  }

  if (open) open.addEventListener('click', showCard);
  if (back) back.addEventListener('click', function (e) {
    e.preventDefault();
    if (location.hash === '#carte') history.back(); else showEntry();
  });
  for (var k = 0; k < btns.length; k++) (function (i) {
    btns[i].addEventListener('click', function () { setFace(i); });
  })(k);

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') showCard(); else showEntry();
  });
  if (location.hash === '#carte') body.classList.remove('pre');
})();
