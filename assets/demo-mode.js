/* ==========================================================================
   MODE DEMONSTRATION PUBLIC : la VRAIE application, avec de fausses donnees.
   ==========================================================================

   Demande de Movsar (2026-07-29) : la vitrine doit montrer « notre truc reel »,
   pas une maquette qui lui ressemble. Ce fichier fait tourner l'application
   telle quelle - meme code, meme planning, memes interactions - sur un jeu de
   donnees de demonstration.

   TROIS GARANTIES, non negociables puisque cette page est PUBLIQUE :

   1. AUCUNE DONNEE REELLE NE PEUT SORTIR. Le mode n'ajoute pas un filtre au
      dessus des appels : il coupe le reseau. `fetch` et `XMLHttpRequest` sont
      remplaces, et tout ce qui vise /api/ recoit une reponse fabriquee ici.
      Meme si un ecran demandait une donnee client, la requete ne partirait
      jamais. C'est la seule facon d'etre sur : une liste blanche d'endpoints
      finit toujours par oublier celui qu'on vient d'ajouter.
   2. AUCUNE ECRITURE. Les POST recoivent un accuse de reception fabrique. Rien
      ne remonte au serveur, donc rien ne peut abimer un centre.
   3. AUCUNE ENSEIGNE DE CLIENT. Le centre s'appelle « Bowling Central », et le
      remplacement se fait AVANT le premier rendu, jamais apres coup (sur la
      pub, un nettoyage tardif laissait l'enseigne visible les 2 premieres
      secondes).

   Le mode ne s'active QUE si l'URL porte `?demo=1`. Sans ce parametre, ce
   fichier ne fait strictement rien : il ne peut pas gener la production.
   ========================================================================== */

(function () {
  'use strict';

  // Deux portes d'entree : `/demo` (URL lisible, partageable) et `?demo=1`
  // (utilisable sur n'importe quel chemin). Sans l'une des deux, ce fichier ne
  // fait STRICTEMENT rien : il ne peut pas gener la production.
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (error) { return; }
  var parLeChemin = /^\/demo\/?$/.test(window.location.pathname);
  if (params.get('demo') !== '1' && !parLeChemin) return;

  var CENTRE = 'Bowling Central';
  var PAGE = params.get('page') || 'planning';
  var AUJOURD_HUI = new Date().toISOString().slice(0, 10);

  // L'application route par l'URL : arrivee sur `/demo` sans fragment, elle
  // ouvrait le PARCOURS DE RESERVATION CLIENT au lieu du planning. On pose donc
  // le fragment que son routeur attend, avant qu'elle ne se lance - forcer la
  // vue apres coup se faisait ecraser par sa propre decision de demarrage.
  try {
    if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = '#/staff/' + PAGE;
    }
  } catch (error) { /* fragment refuse : le forcage plus bas prendra le relais */ }

  /* ---- Les donnees de demonstration --------------------------------------
     Une journee coherente : le nombre de reservations, de joueurs et le
     chiffre s'accordent. Un ecran de demonstration ou les totaux ne tombent
     pas juste detruit la confiance plus surement qu'une page vide. */
  var NOMS = ['Famille Dubois', 'Anniversaire Lucas', 'Team building Nexo', 'Groupe amis', 'Sarah Lemaire',
    'Ecole Saint-Joseph', 'Famille Martin', 'EVJF Camille', 'Club Padel', 'Famille Rousseau',
    'Duo Verhaegen', 'Soiree ligue', 'Famille Nowak'];
  // Les creneaux commencent DES L'OUVERTURE : le cadre de la vitrine ne montre
  // que le haut du planning, et des reservations qui demarrent a 14h laissaient
  // voir une grille vide au prospect - exactement l'inverse de ce qu'on veut
  // prouver.
  var HEURES = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
    '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

  function reservations() {
    return NOMS.map(function (nom, i) {
      return {
        id: 90000 + i,
        name: nom,
        date: AUJOURD_HUI,
        startTime: HEURES[i],
        duration: 60,
        pax: 4 + (i % 5),
        lane: (i % 8) + 1,
        lanes: [(i % 8) + 1],
        activity: 'bowling',
        status: i % 4 === 0 ? 'arrived' : 'pending',
        validationStatus: 'confirmed',
        price: 48 + i * 6,
        phone: '+32 470 00 00 00',
        email: 'contact@example.be',
        source: i % 3 === 0 ? 'phone' : 'online',
      };
    });
  }

  var DEMO = reservations();

  var PERMISSIONS = ['dashboard.view', 'planning.view', 'planning.bowling', 'planning.laser',
    'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status',
    'reservations.quick', 'clients.view', 'direction.view', 'campaigns.manage', 'marketing.agents'];

  var SESSION = {
    token: 'demo',
    cookieBacked: false,
    centerId: 'demo',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    member: { id: 'demo', name: 'Julie', roleId: 'direction' },
    role: { id: 'direction', name: 'Direction', locked: true },
    permissions: PERMISSIONS,
  };

  // Toute enseigne de client qui traverserait ce mode est remplacee a la
  // source, y compris au fond des objets de configuration.
  function neutraliser(valeur) {
    if (typeof valeur === 'string') return valeur.replace(/fun\s*galaxy/gi, CENTRE);
    if (Array.isArray(valeur)) return valeur.map(neutraliser);
    if (valeur && typeof valeur === 'object') {
      var sortie = {};
      Object.keys(valeur).forEach(function (cle) { sortie[cle] = neutraliser(valeur[cle]); });
      return sortie;
    }
    return valeur;
  }

  var CONFIG = {
    ok: true,
    centerId: 'demo',
    config: {
      identity: { name: CENTRE, city: 'Libramont', phone: '+32 61 00 00 00', email: 'contact@example.be' },
      resources: { lanes: 8, laserZones: 2 },
      hours: { open: '10:00', close: '23:00' },
    },
  };

  function reponse(charge) {
    return new Response(JSON.stringify(neutraliser(charge)), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // La table des reponses. Tout ce qui n'y figure pas recoit une reponse VIDE
  // mais valide : un ecran inconnu affiche « rien a montrer », il ne plante
  // pas et il n'atteint pas le reseau.
  function repondre(chemin, action) {
    if (chemin === '/api/staff-auth') {
      return reponse({
        ok: true, authenticated: true, session: SESSION,
        accessControl: {
          selectedRoleId: 'direction', selectedMemberId: 'demo',
          roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: '', updatedAt: new Date().toISOString(), locked: true, permissions: PERMISSIONS }],
          members: [{ id: 'demo', name: 'Julie', contact: '', roleId: 'direction', status: 'active', code: '', lastSeen: new Date().toISOString() }],
          events: [], permissions: PERMISSIONS,
        },
      });
    }
    if (chemin === '/api/staff-state') {
      return reponse({ ok: true, revision: 'demo', reservations: DEMO, laneStatuses: {}, centerId: 'demo' });
    }
    if (chemin === '/api/admin-range') {
      return reponse({ ok: true, reservations: DEMO, emails: [], agentEvents: [], centerId: 'demo' });
    }
    if (chemin === '/api/public-booking-meta') {
      return reponse({ ok: true, today: AUJOURD_HUI, durationOptions: [], formules: [], center: { id: 'demo', status: 'active' } });
    }
    if (chemin === '/api/ops' && action === 'centerConfig') return reponse(CONFIG);
    return reponse({
      ok: true, centerId: 'demo', reservations: [], communications: [], samples: [], suggestions: [],
      events: [], agents: [], blocks: [], clients: [], centers: [], entries: [],
    });
  }

  // COUPURE DU RESEAU. On ne filtre pas : on remplace. Aucun appel /api/ ne
  // quitte le navigateur en mode demonstration.
  var fetchNatif = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (entree, options) {
    var brut = typeof entree === 'string' ? entree : (entree && entree.url) || '';
    var u;
    try { u = new URL(brut, window.location.origin); } catch (error) { u = null; }
    if (u && u.pathname.indexOf('/api/') === 0) {
      return Promise.resolve(repondre(u.pathname, u.searchParams.get('action')));
    }
    return fetchNatif ? fetchNatif(entree, options) : Promise.reject(new Error('reseau indisponible'));
  };

  // XMLHttpRequest aussi : un seul chemin oublie suffirait a faire sortir une
  // requete vers l'API depuis une page publique.
  var ouvrirNatif = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (ouvrirNatif) {
    window.XMLHttpRequest.prototype.open = function (methode, adresse) {
      if (String(adresse || '').indexOf('/api/') !== -1) {
        arguments[1] = 'data:application/json,' + encodeURIComponent('{"ok":true}');
      }
      return ouvrirNatif.apply(this, arguments);
    };
  }

  try { window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(SESSION)); } catch (error) { /* stockage refuse */ }

  /* ---- L'habillage : on montre le PRODUIT, pas la navigation interne ------ */
  var style = document.createElement('style');
  style.textContent = [
    /* La barre laterale et l'en-tete du site n'ont rien a faire dans une
       vitrine : le prospect regarde le planning, pas le menu du logiciel. */
    'body.pinlane-demo .ops-sidebar, body.pinlane-demo header, body.pinlane-demo #logoutBtn { display: none !important; }',
    'body.pinlane-demo { --fgx-sidebar-width: 0px !important; }',
    'body.pinlane-demo .staff-wrap, body.pinlane-demo main { padding-left: 0 !important; margin-left: 0 !important; }',
    /* Une demonstration ne se defile pas toute seule dans son cadre : la
       hauteur remonte au site hote (voir l emetteur de app-main.js). */
    'body.pinlane-demo { overflow-x: hidden; }',
  ].join('\n');
  // L'enseigne du client vit AUSSI dans le gabarit : le titre de l'onglet, le
  // logo, les liens de navigation du site public. Les masquer ne suffit pas -
  // le titre s'affiche dans l'onglet du navigateur, et le texte alternatif se
  // lit a la synthese vocale. On les remplace.
  // `state` est declare en const au niveau du script de l application : il est
  // global, mais PAS une propriete de window (aucun let/const de haut niveau ne
  // l'est). `window.state` valait donc undefined, et les injections partaient
  // dans le vide sans lever la moindre erreur. On le resout par son nom.
  function etatApp() {
    try { return (typeof state !== 'undefined' && state) ? state : null; } catch (error) { return null; }
  }
  function neutraliserPage() {
    document.title = 'Pinlane · démonstration';
    [].forEach.call(document.querySelectorAll('img[alt]'), function (img) {
      if (/fun\s*galaxy/i.test(img.getAttribute('alt') || '')) img.setAttribute('alt', CENTRE);
    });
    var marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var noeud = marcheur.nextNode();
    while (noeud) {
      if (/fun\s*galaxy/i.test(noeud.nodeValue)) noeud.nodeValue = noeud.nodeValue.replace(/fun\s*galaxy/gi, CENTRE);
      noeud = marcheur.nextNode();
    }
  }

  // L'application decide elle-meme de sa vue au demarrage (hash, session,
  // detection du mode client). Poser la vue une seule fois au DOMContentLoaded
  // arrivait AVANT cette decision : la demonstration s'ouvrait sur le parcours
  // de reservation client au lieu du planning. On insiste donc jusqu'a ce que
  // la vue staff tienne, puis on arrete - au maximum deux secondes.
  function forcerVueStaff() {
    var essais = 0;
    var horloge = setInterval(function () {
      essais += 1;
      try {
        var etat = etatApp();
        if (etat) {
          etat.staffTheme = 'light';
          etat.staffMenuPage = PAGE;
          etat.view = 'staff';
          etat.currentDate = AUJOURD_HUI;
          // LES DONNEES SONT POSEES DANS L'ETAT, pas seulement servies par le
          // faux reseau. L'application vide `state.reservations` au chargement
          // (les reservations appartiennent au serveur depuis le 2026-07-28) et
          // les repeuple par un sondage : sur une page publique ou ce sondage
          // n'a pas de vraie source, le planning restait desesperement vide.
          if (!Array.isArray(etat.reservations) || etat.reservations.length !== DEMO.length) {
            etat.reservations = DEMO.slice();
          }
          if (etat.laneStatuses) {
            Object.keys(etat.laneStatuses).forEach(function (k) { etat.laneStatuses[k] = 'active'; });
          }
        }
        document.documentElement.setAttribute('data-theme', 'light');
        if (typeof window.setView === 'function') window.setView('staff');
        if (typeof window.renderStaff === 'function') window.renderStaff();
        neutraliserPage();
      } catch (error) { /* l application n est pas encore prete */ }
      var vueStaff = document.body.classList.contains('staff-mode');
      if ((vueStaff && essais > 2) || essais > 20) clearInterval(horloge);
    }, 100);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('pinlane-demo');
    document.head.appendChild(style);
    neutraliserPage();
    forcerVueStaff();
    // Un rendu ulterieur peut reintroduire un libelle : on surveille.
    new MutationObserver(neutraliserPage).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}());
