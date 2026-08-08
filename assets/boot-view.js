/* DEMARRAGE SANS FLASH.
 *
 * #clientView est la seule vue peinte par le HTML (staffView et adminView
 * naissent .hidden). Au rechargement de la console, le navigateur affichait
 * donc le PARCOURS DE RESERVATION pendant 1 a 2 secondes : le temps que
 * app-main.js (17 000 lignes) soit parse, puis que setView() s'execute, lui
 * meme place APRES le controle de session et deux synchros reseau. Le parcours
 * a desormais son adresse dediee (/reserver) : il n'a plus rien a faire sur la
 * console.
 *
 * Ce fichier est charge SANS defer, dans le <head> : il s'execute donc avant
 * que le body ne soit peint. Il ne fait qu'une chose, sans reseau : decider la
 * vue de depart (URL, puis etat sauvegarde) et poser un drapeau. Les regles
 * d'affichage vivent dans pinlane.css (html[data-boot="app"]).
 *
 * Le drapeau est retire par setView() des qu'une vue reelle est appliquee, et
 * par un filet de 8 s si le bundle ne demarre jamais : un voile ne doit pas
 * pouvoir bloquer l'ecran.
 */
(function () {
  try {
    var path = (location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    var hash = (location.hash || '').toLowerCase().replace('#/', '#');
    // Le parcours a son adresse : on n'y touche jamais.
    if (path === '/reserver') return;
    var app = false;
    // La demonstration publique ouvre la CONSOLE, jamais le parcours de
    // reservation : sans cette ligne, un prospect arrive sur /demo voyait le
    // tunnel client le temps que demo-mode.js pose son fragment.
    if (path === '/demo') {
      app = true;
    } else if (hash.indexOf('#staff') === 0 || hash.indexOf('#admin') === 0) {
      app = true;
    } else if (hash.indexOf('#client') !== 0) {
      // Aucun hash : c'est l'etat sauvegarde qui dit d'ou on revient.
      var saved = JSON.parse(localStorage.getItem('funGalaxy_v4') || '{}');
      if (saved && (saved.view === 'staff' || saved.view === 'admin')) app = true;
    }
    if (!app) return;
    document.documentElement.setAttribute('data-boot', 'app');
    setTimeout(function () {
      document.documentElement.removeAttribute('data-boot');
    }, 8000);
  } catch (error) {
    // Un stockage inaccessible (mode prive, iframe cloisonnee) ne doit jamais
    // empecher la page de s'afficher : sans drapeau, comportement d'avant.
  }
}());
