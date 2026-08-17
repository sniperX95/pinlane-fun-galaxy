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
/* LA MARQUE DU CENTRE, AVANT LA PREMIERE PEINTURE.
 *
 * Meme probleme, meme remede que la vue de depart ci-dessus. Les couleurs du
 * tunnel public viennent du SERVEUR (center.branding, /api/public-booking-meta)
 * depuis qu'elles ont quitte assets/pinlane-client.css, ou le magenta Fun
 * Galaxy etait ecrit en dur et heritait a tout deuxieme client. Elles
 * n'arrivent donc qu'apres le boot : mesure au navigateur le 2026-08-08, le
 * visiteur voyait l'accent plateforme pendant environ 1 s avant la couleur de
 * son centre.
 *
 * On relit donc la derniere marque CONNUE pour CE centre (memoire ecrite par
 * applyCenterBranding, assets/app-main.js) et on pose les jetons tout de suite.
 * Clefee par centre : une installation multi-sites ne melange jamais deux
 * marques, et un centre inconnu de la memoire n'herite de rien. Le serveur
 * reste seul juge : sa reponse ecrase ou efface ce rappel quelques instants
 * plus tard.
 */
/* Depuis la purge de marque, la meme memoire porte aussi l'IDENTITE du centre
 * (nom d'onglet, logo, liens du site, ville du sous-titre) : index.html est
 * neutre, l'identite est une donnee de centre ecrite par applyCenterIdentity
 * (assets/app-main.js). Le titre se pose tout de suite ; le logo et les liens
 * attendent que le DOM existe (DOMContentLoaded arrive avant tout retour
 * reseau). Le visiteur ne voit jamais l'identite d'un autre centre, et le
 * serveur reste seul juge : sa reponse ecrase ce rappel quelques instants
 * plus tard. */
(function () {
  var TOKENS = {
    accent: '--tenant-accent',
    accentStrong: '--tenant-accent-strong',
    accentSoft: '--tenant-accent-soft',
    accentContrast: '--tenant-accent-contrast',
  };
  var HEX = /^#[0-9a-f]{6}$/i;
  var LOGO_URL = /^(?:https:\/\/[^\s"'<>]+|\.?\/?assets\/[a-z0-9_/.-]+)$/i;
  var SITE_URL = /^https:\/\//i;
  try {
    var params = new URLSearchParams(location.search || '');
    var center = String(params.get('center') || params.get('centerId') || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(center)) return;
    var brand = JSON.parse(localStorage.getItem('pinlane-brand:' + center) || 'null');
    if (!brand || typeof brand !== 'object') return;
    var dark = brand.dark && typeof brand.dark === 'object' ? brand.dark : {};
    var root = document.documentElement;
    Object.keys(TOKENS).forEach(function (key) {
      if (HEX.test(String(brand[key] || ''))) root.style.setProperty(TOKENS[key], brand[key]);
      if (HEX.test(String(dark[key] || ''))) root.style.setProperty(TOKENS[key] + '-dark', dark[key]);
    });

    /* Les axes de STYLE du tunnel, rappeles avec les couleurs : sans eux, un
       centre en rayons ronds + fond aurora flasherait la version plateforme
       une seconde. Miroir de TENANT_STYLE_AXES (app-main.js). Le theme force
       ne se rappelle qu'en tunnel pur : ici, seul le chemin /reserver ou
       ?embed=1 est concerne (la console garde le theme de l'operateur). */
    var STYLE_AXES = {
      radius: ['sharp', 'soft', 'round'],
      font: ['geist', 'humanist', 'serif', 'mono'],
      backdrop: ['plain', 'tint', 'aurora'],
      cards: ['line', 'flat', 'shadow'],
      buttons: ['pill', 'rounded'],
    };
    Object.keys(STYLE_AXES).forEach(function (axis) {
      var value = String(brand[axis] || '').trim().toLowerCase();
      if (STYLE_AXES[axis].indexOf(value) !== -1) root.setAttribute('data-tunnel-' + axis, value);
    });
    var path = String(location.pathname || '').toLowerCase().replace(/\/+$/, '');
    var isPureTunnel = path === '/reserver' || params.get('embed') === '1';
    var forcedTheme = String(brand.theme || '').trim().toLowerCase();
    if (isPureTunnel && (forcedTheme === 'light' || forcedTheme === 'dark')) {
      root.setAttribute('data-theme', forcedTheme);
    }

    var identity = brand.identity && typeof brand.identity === 'object' ? brand.identity : null;
    if (!identity) return;
    var name = String(identity.name || '').trim().slice(0, 120);
    if (name) document.title = name + ' · Réservation';
    var applyIdentityDom = function () {
      var logo = document.getElementById('centerLogo');
      var wordmark = document.getElementById('centerWordmark');
      var logoUrl = String(identity.logoUrl || '').trim();
      if (logo && wordmark) {
        if (logoUrl.length <= 300 && LOGO_URL.test(logoUrl)) {
          logo.src = logoUrl;
          logo.alt = name || 'Logo du centre';
          logo.hidden = false;
          wordmark.hidden = true;
          var wrap = logo.closest ? logo.closest('.logo-wrap') : null;
          if (wrap && identity.logoOnDark === true) wrap.classList.add('logo-on-dark');
        } else if (name) {
          wordmark.textContent = name;
          wordmark.hidden = false;
        }
      }
      var nav = document.getElementById('nav');
      var links = Array.isArray(identity.siteLinks) ? identity.siteLinks : [];
      if (nav && links.length && !nav.childElementCount) {
        links.slice(0, 6).forEach(function (link) {
          var label = String((link && link.label) || '').trim().slice(0, 40);
          var url = String((link && link.url) || '').trim();
          if (!label || url.length > 300 || !SITE_URL.test(url)) return;
          var anchor = document.createElement('a');
          anchor.className = 'nav-link';
          anchor.href = url;
          anchor.target = '_blank';
          anchor.rel = 'noopener';
          anchor.textContent = label;
          nav.appendChild(anchor);
        });
      }
      var hero = document.getElementById('heroSubtitle');
      var city = String(identity.city || '').trim().slice(0, 80);
      if (hero && city) {
        hero.textContent = 'Un parcours plus compact, plus clair et plus sérieux pour réserver rapidement votre partie à ' + city + '.';
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyIdentityDom, { once: true });
    } else {
      applyIdentityDom();
    }
  } catch (error) {
    // Stockage inaccessible (mode prive, iframe cloisonnee) : sans rappel, le
    // tunnel affiche l'accent plateforme jusqu'a la reponse du serveur.
  }
}());

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
