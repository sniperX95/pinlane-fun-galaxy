/* Fun Galaxy — carte digitale. Zoom NATIF (pincer comme une photo).
   JS = bascule entrée<->carte + segment Recto/Verso (scroll + scroll-spy). */
(function () {
  'use strict';
  var body = document.body;
  var open = document.getElementById('openCard');
  var back = document.getElementById('backBtn');
  var nav = document.getElementById('nav');
  var pages = document.querySelectorAll('.page');
  var btns = nav ? nav.querySelectorAll('.nav__btn') : [];
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showCard() {
    body.classList.remove('pre');
    try { window.scrollTo(0, 0); } catch (e) {}
    setFace(0, false);
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
  }
  function showEntry() { body.classList.add('pre'); try { window.scrollTo(0, 0); } catch (e) {} }

  function setFace(i, doScroll) {
    if (nav) { nav.setAttribute('data-face', String(i)); }
    for (var k = 0; k < btns.length; k++) btns[k].setAttribute('aria-current', k === i ? 'true' : 'false');
    if (doScroll && pages[i]) pages[i].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  if (open) open.addEventListener('click', showCard);
  if (back) back.addEventListener('click', function (e) {
    e.preventDefault();
    if (location.hash === '#carte') history.back(); else showEntry();
  });
  for (var k = 0; k < btns.length; k++) (function (i) {
    btns[i].addEventListener('click', function () { setFace(i, true); });
  })(k);

  // Scroll-spy : le segment suit la page la plus visible (sans écraser un tap récent).
  var lock = 0;
  if ('IntersectionObserver' in window && pages.length) {
    var io = new IntersectionObserver(function (entries) {
      if (Date.now() < lock) return;
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio > 0.5) {
          var idx = Array.prototype.indexOf.call(pages, en.target);
          if (idx >= 0) setFace(idx, false);
        }
      });
    }, { threshold: [0.5] });
    for (var p = 0; p < pages.length; p++) io.observe(pages[p]);
  }
  // Un tap sur le segment fige le scroll-spy un court instant (évite les sauts).
  if (nav) nav.addEventListener('click', function () { lock = Date.now() + 700; });

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') showCard(); else showEntry();
  });
  if (location.hash === '#carte') { body.classList.remove('pre'); setFace(0, false); }
})();
