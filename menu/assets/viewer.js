/* Fun Galaxy — carte digitale. Le zoom est NATIF (pincer comme une photo).
   Ce script ne fait que la bascule écran d'entrée <-> carte. */
(function () {
  'use strict';
  var body = document.body;
  var open = document.getElementById('openCard');
  var back = document.getElementById('backBtn');

  function showCard() {
    body.classList.remove('pre');       // déverrouille le scroll + fond l'écran d'entrée
    try { window.scrollTo(0, 0); } catch (e) {}
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
  }
  function showEntry() {
    body.classList.add('pre');
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  if (open) open.addEventListener('click', showCard);
  if (back) back.addEventListener('click', function (e) {
    e.preventDefault();
    if (location.hash === '#carte') history.back(); else showEntry();
  });

  // Bouton retour du téléphone : #carte -> entrée
  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') showCard(); else showEntry();
  });

  // Si on arrive directement avec #carte (ex. rechargement), affiche la carte
  if (location.hash === '#carte') body.classList.remove('pre');
})();
