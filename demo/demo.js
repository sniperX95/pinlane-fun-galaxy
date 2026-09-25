/* ==========================================================================
   LA DEMONSTRATION PUBLIQUE : son unique script.
   ==========================================================================
   Objet AUTONOME depuis le 2026-08-13. Il ne charge rien de l'application, il
   n'appelle aucune API, il ne touche ni base ni stockage. Ce fichier dessine
   deux ecrans, neuf portes fermees, et un guide qui construit l'ecran en
   racontant une journee de gerant.

   CE QUI EST NON NEGOCIABLE ICI, parce que la page est PUBLIQUE :
     - aucune enseigne, ville ou entreprise reelle (voir demo-data.js) ;
     - aucune promesse que le produit ne tient pas : Pinlane N'ENCAISSE PAS,
       ne modelise aucun acompte, et l'agent PREPARE sans jamais publier ;
     - tout chiffre affiche se recompose a partir de ce qui est dessine.
   ========================================================================== */
(function () {
  'use strict';

  var D = window.PL_DEMO;
  var LIEN_APPEL = 'https://pinlane.be/#demo';
  var params = new URLSearchParams(window.location.search);
  // `?guide=0` : l'ecran plein tout de suite. Utilise par les mesures et par
  // le gate de fidelite, qui doit lire des libelles, pas une mise en scene.
  var GUIDE_ACTIF = params.get('guide') !== '0';
  var SANS_MOUVEMENT = (function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (error) { return false; }
  }());

  /* ========================================================================
     1. LE MENU : onze entrees, deux ouvertes, neuf grisees.
     ========================================================================
     La demonstration est un APPAT, pas un libre-service (decision de Movsar
     du 2026-08-13 : « limiter la majorite des choses interessantes et
     renvoyer vers la reservation d'appel »).

     POURQUOI CES DEUX-LA, et pas d'autres :
       - PLANNING : il prouve en trois secondes qu'il s'agit d'un vrai
         logiciel, et il est credible sans aucun reglage du centre ;
       - MARKETING : un agent qui PREPARE et attend la validation, ce que la
         concurrence n'a pas. C'est l'argument qui declenche l'appel.
     Tout le reste (tarifs, fiches clients, textes d'emails, roles) ne vaut
     que branche sur les donnees du visiteur : un tarif fabrique ne ressemble
     jamais au sien, et le montrer le devalue.

     L'ORDRE ET LES LIBELLES SONT CEUX DU PRODUIT. Le gate
     `test:demo-fidelity` les compare a la vraie console et rougit si l'un des
     deux bouge sans l'autre. */
  var MENU = [
    { groupe: 'Journée' },
    { cle: 'dashboard', libelle: 'Vue d’ensemble', ico: 'grille' },
    { cle: 'planning', libelle: 'Planning', ico: 'calendrier', ouvert: true },
    { cle: 'reservations', libelle: 'Réservations', ico: 'liste' },
    { cle: 'formules', libelle: 'Formules', ico: 'liste' },
    { cle: 'arrivals', libelle: 'Terrain', ico: 'horloge' },
    { groupe: 'Clients & marketing' },
    { cle: 'clients', libelle: 'Clients', ico: 'gens', pastille: '2' },
    { cle: 'emails', libelle: 'Emails & relances', ico: 'enveloppe' },
    { cle: 'campaigns', libelle: 'Marketing', ico: 'porte-voix', ouvert: true },
    { groupe: 'Administration' },
    { cle: 'activities', libelle: 'Activités & tarifs', ico: 'etiquette' },
    { cle: 'users', libelle: 'Équipe & accès', ico: 'gens' },
    { cle: 'establishment', libelle: 'Établissement', ico: 'batiment' },
  ];

  /* Le texte de chaque porte fermee. `quoi` = ce qu'il y a derriere avec les
     MOTS DU PRODUIT ; `pourquoi` = la raison honnete pour laquelle ca s'ouvre
     pendant l'appel. Neuf portes fermees = neuf arguments de vente ecrits. */
  var PORTES = {
    dashboard: {
      titre: 'Vue d’ensemble',
      quoi: ['Les réservations, les joueurs et le chiffre du jour, comparés à la veille',
        'Le taux d’occupation des pistes, créneau par créneau',
        'La répartition entre bowling, laser et formules',
        'Ce qui vient du site et ce qui vient du comptoir'],
      pourquoi: 'Un tableau de bord ne prouve rien avec des chiffres inventés. Sur vos données, il se lit en dix secondes.',
    },
    reservations: {
      titre: 'Réservations',
      quoi: ['Le mois entier en carte de chaleur, un jour égale une intensité',
        'Le flux d’une journée, trié par heure, avec la durée et les pistes',
        'Le détail d’une réservation, son statut et son reste à encaisser',
        'La création d’une réservation au comptoir'],
      pourquoi: 'C’est votre carnet. On l’ouvre avec vos vraies réservations, reprises de votre outil actuel.',
    },
    formules: {
      titre: 'Formules',
      quoi: ['Chaque formule du jour et ce qu’elle contient',
        'La liste à cocher au fur et à mesure du service',
        'Ce qui reste à préparer avant l’arrivée du groupe'],
      pourquoi: 'Vos formules ne ressemblent pas à celles d’un centre inventé. On les charge avant l’appel.',
    },
    arrivals: {
      titre: 'Terrain',
      quoi: ['À venir : les groupes attendus, avec l’heure et le nombre de joueurs',
        'Sur place : qui est arrivé ou joue en ce moment, et quand ça se termine',
        'À clôturer : les parties finies qui restent à encaisser'],
      pourquoi: 'Un écran fait pour le comptoir un samedi. Il se juge sur une vraie journée, pas sur la nôtre.',
    },
    clients: {
      titre: 'Clients',
      quoi: ['Chaque client, ses visites, ce qu’il a dépensé, sa prochaine venue',
        'À relancer : ceux venus deux fois et plus vus depuis deux mois',
        'Les demandes sur mesure reçues par le site, à traiter',
        'Les anniversaires fêtés ici il y a un an, qui se re-réservent'],
      pourquoi: 'Ce sont des données personnelles. On ne les invente pas pour une page publique : on ouvre l’écran avec les vôtres.',
    },
    emails: {
      titre: 'Emails et relances',
      quoi: ['Les six séquences automatiques, chacune allumée ou éteinte par vous',
        'Le texte exact de chaque email, modifiable, avec vos variables',
        'La file d’envoi : ce qui est parti, ce qui attend, ce qui a échoué',
        'Les emails reçus, et la réponse que l’agent a préparée'],
      pourquoi: 'Les textes portent le nom, le ton et les horaires de votre centre. On les écrit ensemble pendant l’appel.',
    },
    activities: {
      titre: 'Activités et tarifs',
      quoi: ['Vos tarifs par activité, par durée et par formule',
        'L’état des pistes, la maintenance et l’occupation du jour',
        'Le laser : lancements, groupes partagés, capacité en armes'],
      pourquoi: 'Un tarif inventé ne ressemble jamais au vôtre. On reprend votre grille telle quelle, c’est compris dans l’installation.',
    },
    users: {
      titre: 'Équipe et accès',
      quoi: ['Un rôle par métier : direction, accueil, terrain',
        'Ce que chaque rôle peut voir et faire, permission par permission',
        'Un code d’accès par personne, révocable en un clic'],
      pourquoi: 'Les accès se décident avec vous, pas devant tout le monde sur une page publique.',
    },
    establishment: {
      titre: 'Établissement',
      quoi: ['Vos horaires, jour par jour, et vos fermetures',
        'Vos ressources : pistes, arènes laser, tables d’anniversaire',
        'Les activités que vous vendez, et celles que vous ne vendez pas',
        'Votre couleur de marque, reprise par votre tunnel de réservation'],
      pourquoi: 'C’est la fiche de VOTRE centre. On la remplit ensemble : c’est l’installation, et elle prend vingt minutes.',
    },
  };

  var ICONES = {
    grille: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    calendrier: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    liste: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    gens: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    enveloppe: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    'porte-voix': '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    etiquette: '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    batiment: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h2a2 2 0 0 1 2 2v10"/><path d="M9 8h2M9 12h2M9 16h2"/>',
    cadenas: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    etincelle: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6.3 6.3l4.2 4.2M13.5 13.5l4.2 4.2M17.7 6.3l-4.2 4.2M10.5 13.5l-4.2 4.2"/>',
    gauche: '<path d="m15 18-6-6 6-6"/>',
    droite: '<path d="m9 18 6-6-6-6"/>',
  };
  function svg(nom, classe) {
    return '<svg class="' + (classe || 'd-ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (ICONES[nom] || '') + '</svg>';
  }
  function ech(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var etat = { page: 'planning', filtre: 'arrived', porte: '', focusAvant: null };

  /* ========================================================================
     2. LA BARRE LATERALE
     ========================================================================
     Les entrees fermees sont GRISEES, et l'etat ne tient PAS a la couleur
     seule : contraste reduit, un cadenas, et un complement lu par la synthese
     vocale (« ouvert pendant l'appel »). Elles restent cliquables : le clic
     est ce qui ouvre la fenetre qui explique. */
  function peindreMenu() {
    var nav = document.querySelector('[data-d-nav]');
    var html = '';
    MENU.forEach(function (item) {
      if (item.groupe) { html += '<p class="d-nav-groupe">' + ech(item.groupe) + '</p>'; return; }
      var ferme = !item.ouvert;
      html += '<button type="button" class="d-nav-item' + (ferme ? ' is-verrou' : '')
        + (etat.page === item.cle ? ' is-actif' : '') + '"'
        + ' data-d-menu="' + item.cle + '"'
        + (ferme ? ' aria-describedby="dVerrouAide"' : '')
        + '>'
        + svg(item.ico)
        + '<span class="d-nav-libelle">' + ech(item.libelle) + '</span>'
        + (item.pastille ? '<span class="d-pastille">' + ech(item.pastille) + '</span>' : '')
        + (ferme ? svg('cadenas', 'd-cadenas') + '<span class="d-invisible">, ouvert pendant l’appel</span>' : '')
        + '</button>';
    });
    html += '<p id="dVerrouAide" class="d-invisible">Cette section s’ouvre pendant un appel de vingt minutes, branchée sur les données de votre centre.</p>';
    nav.innerHTML = html;
    [].forEach.call(nav.querySelectorAll('[data-d-menu]'), function (b) {
      b.addEventListener('click', function () { ouvrir(b.getAttribute('data-d-menu')); });
    });
  }

  /* ========================================================================
     3. L'ECRAN PLANNING
     ========================================================================
     ALLEGEMENT, et il faut dire d'ou venait la charge. Mesure du 2026-08-13
     sur la console reelle : la page Planning faisait 5 473 px, dont 4 384 px
     (80 %) pour une liste qui REPETE en trente-sept grandes cartes les
     trente-sept reservations deja dessinees dans la grille juste au-dessus.
     C'est une structure DU PRODUIT, pas un exces de donnees fabriquees : elle
     grandit avec le nombre de reservations, donc un vrai samedi charge est
     pire, pas meilleur. C'est remonte comme sujet produit dans le journal.

     Ici, la liste s'ouvre sur le filtre « Sur place », qui est un controle du
     produit, visible et cliquable : neuf lignes au lieu de trente-sept, et un
     clic sur « Tout » rend les autres. Rien n'est cache, aucun bouton n'est
     invente. */
  function dateDuJour() {
    var d = new Date();
    var t = d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function dateCourte() {
    var d = new Date();
    var t = d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function classeStatut(s) { return s === 'arrived' ? 'is-arr' : (s === 'paid' ? 'is-pay' : ''); }

  function htmlGrille(combien) {
    var lignes = (D.FERMETURE - D.OUVERTURE) * 2;
    var h = '<div class="d-grille"><div class="d-grille-inner">';
    h += '<div class="d-gtete">Heure</div>';
    for (var p = 1; p <= D.PISTES; p += 1) h += '<div class="d-gtete">Piste ' + p + '</div>';
    var posees = D.RESERVATIONS.slice(0, combien === undefined ? D.RESERVATIONS.length : combien);
    for (var l = 0; l < lignes; l += 1) {
      var heure = D.OUVERTURE + l * 0.5;
      h += '<div class="d-gheure">' + (l % 2 === 0 ? D.heures(heure) : '') + '</div>';
      for (var piste = 1; piste <= D.PISTES; piste += 1) {
        h += '<div class="d-gpiste">';
        posees.forEach(function (r) {
          if (r.lanes.indexOf(piste) === -1 || r.start !== heure) return;
          var hauteur = r.duration * 2 * 46 - 6;
          h += '<div class="d-bloc is-neuf ' + classeStatut(r.statut) + '" style="height:' + hauteur + 'px">'
            + '<b>' + ech(r.name) + '</b>'
            + '<span>' + ech(r.activite) + '</span>'
            + '<em>' + r.pax + ' j · ' + r.duration + 'h</em>'
            + '</div>';
        });
        h += '</div>';
      }
    }
    return h + '</div></div>';
  }

  function htmlPlanning(combien) {
    var visibles = D.RESERVATIONS.filter(function (r) {
      if (etat.filtre === 'all') return true;
      if (etat.filtre === 'open') return r.statut !== 'paid';
      return r.statut === etat.filtre;
    });
    var comptes = {
      all: D.RESERVATIONS.length,
      open: D.RESERVATIONS.filter(function (r) { return r.statut !== 'paid'; }).length,
      arrived: D.RESERVATIONS.filter(function (r) { return r.statut === 'arrived'; }).length,
      pending: D.RESERVATIONS.filter(function (r) { return r.statut === 'pending'; }).length,
      paid: D.RESERVATIONS.filter(function (r) { return r.statut === 'paid'; }).length,
    };
    var h = '';

    h += '<div class="d-tete" data-d-bloc="tete">'
      + '<div class="d-tete-titre"><h1>Planning du jour</h1><p>' + ech(dateDuJour()) + '</p></div>'
      + '<div class="d-tete-actions">'
      + '<div class="d-datenav">'
      + '<button type="button" aria-label="Jour précédent">' + svg('gauche', 'd-x') + '</button>'
      + '<span>' + ech(dateCourte()) + '</span>'
      + '<button type="button" aria-label="Jour suivant">' + svg('droite', 'd-x') + '</button>'
      + '</div>'
      + '<button type="button" class="d-btn">Aujourd’hui</button>'
      + '<button type="button" class="d-btn d-btn-fort">+ Réservation rapide</button>'
      + '</div></div>';

    h += '<div class="d-kpis" data-d-bloc="kpi">';
    D.INDICATEURS.forEach(function (k, i) {
      h += '<div class="d-kpi' + (k.fort ? ' is-fort' : '') + '" data-d-casc="' + (i + 1) + '">'
        + '<div class="d-kpi-lib">' + ech(k.libelle) + '</div>'
        + '<div class="d-kpi-val">' + ech(k.valeur) + '</div>'
        + '<div class="d-kpi-unite' + (k.cle === 'chiffre' ? ' is-ok' : '') + '">' + ech(k.unite) + '</div>'
        + '</div>';
    });
    h += '</div>';

    h += '<div class="d-onglets" data-d-bloc="onglets">';
    D.ONGLETS.forEach(function (o, i) {
      h += '<button type="button" class="d-onglet' + (o.actif ? ' is-actif' : '') + '" data-d-casc="' + (i + 1) + '">'
        + '<b>' + ech(o.titre) + '</b><span>' + ech(o.sous) + '</span><i>' + o.compte + '</i></button>';
    });
    h += '</div>';

    h += '<div class="d-boite" data-d-bloc="grille">'
      + '<div class="d-boite-tete">'
      + '<div><h2>Planning ' + D.PISTES + ' pistes</h2>'
      + '<p>' + D.RESERVATIONS.length + ' réservations bowling · '
      + D.RESERVATIONS.reduce(function (s, r) { return s + r.pax; }, 0) + ' joueurs · '
      + D.OUVERTURE + 'h - ' + D.FERMETURE + 'h</p></div>'
      + '<div class="d-legende">'
      + '<span><i></i>Confirmé</span><span><i class="is-arr"></i>Arrivé</span><span><i class="is-pay"></i>Payé</span>'
      + '</div></div>'
      + htmlGrille(combien)
      + '</div>';

    h += '<div class="d-boite" data-d-bloc="liste">'
      + '<div class="d-boite-tete"><div><h2>Réservations Bowling</h2>'
      + '<p>Bowling uniquement · ' + comptes.open + ' à gérer maintenant · ' + comptes.paid + ' terminées</p></div></div>'
      + '<div class="d-filtres">';
    D.FILTRES.forEach(function (f) {
      h += '<button type="button" class="d-puce' + (etat.filtre === f.cle ? ' is-actif' : '') + '"'
        + ' data-d-filtre="' + f.cle + '">' + ech(f.libelle) + ' <b>' + comptes[f.cle] + '</b></button>';
    });
    h += '</div><div class="d-liste">';
    if (!visibles.length) {
      h += '<div class="d-ligne"><span style="color:var(--muted)">Aucune réservation dans ce filtre.</span></div>';
    }
    visibles.forEach(function (r, i) {
      var etiq = r.statut === 'arrived' ? ['is-arr', 'Sur place']
        : (r.statut === 'paid' ? ['is-pay', 'Terminée'] : ['is-att', 'À venir']);
      h += '<div class="d-ligne" data-d-casc="' + Math.min(i + 1, 8) + '">'
        + '<span class="d-ligne-h">' + D.heures(r.start) + '</span>'
        + '<span class="d-ligne-qui"><b>' + ech(r.name) + '</b>'
        + '<span>' + ech(r.activite) + ' · ' + r.pax + ' joueurs · piste ' + r.lanes.join(' et ') + '</span></span>'
        + '<span class="d-etiq ' + etiq[0] + '">' + etiq[1] + '</span>'
        + '<span class="d-ligne-prix">' + r.prix + '€</span>'
        + '<span class="d-ligne-actions">'
        + '<button type="button" class="d-mini">Arrivé</button>'
        + '<button type="button" class="d-mini">Payé</button>'
        + '</span></div>';
    });
    h += '</div></div>';
    return h;
  }

  /* ========================================================================
     4. L'ECRAN MARKETING
     ========================================================================
     L'agent PREPARE, le gerant valide ou copie. Le mot « publie » n'apparait
     sur aucune proposition, et sa paie se compte en venues et en chiffre
     reserve, jamais en euros encaisses : le produit n'encaisse pas. */
  function htmlMarketing() {
    var a = D.AGENT;
    var h = '<div class="d-mkt"><div>';
    h += '<div class="d-mkt-tete" data-d-bloc="agent">'
      + '<span class="d-mkt-sceau">' + svg('etincelle', 'd-x') + '</span>'
      + '<div><h1>Marketing</h1>'
      + '<span class="d-mkt-vivant"><i></i>analyse chaque matin</span>'
      + '<p>L’employé marketing de ' + ech(D.CENTRE) + '. Vous validez, rien ne part tout seul.</p></div>'
      + '</div>';

    h += '<div class="d-mkt-mot" data-d-bloc="mot">'
      + '<div class="d-mkt-bonjour"><i>' + svg('etincelle', 'd-x') + '</i><h2>Bonjour.</h2></div>'
      + '<p class="d-mkt-brief">' + ech(a.mot) + '</p>'
      + '<p class="d-mkt-rappel">2 propositions vous attendent dans le panneau. Posez une question, ou décrivez ce que je dois préparer.</p>'
      + '<div class="d-mkt-saisie"><span>Décris le livrable : « un post pour la soirée fluo »</span>'
      + '<button type="button" class="d-btn d-btn-fort">Préparer</button></div>'
      + '<div class="d-mkt-chips">'
      + '<button type="button" class="d-chip">Remplir lundi prochain</button>'
      + '<button type="button" class="d-chip">Que fait le bowling à 12 min ?</button>'
      + '<button type="button" class="d-chip">Un post pour le week-end</button>'
      + '</div></div>';
    h += '</div>';

    h += '<aside class="d-panneau" data-d-bloc="travail" aria-label="Le travail de l’agent">'
      + '<div class="d-panneau-tete"><h2>Le travail</h2></div>';
    h += '<div class="d-groupe" data-d-casc="1">'
      + '<div class="d-groupe-tete"><h3>À valider</h3><span class="d-compte">' + a.propositions.length + '</span></div>';
    a.propositions.forEach(function (p) {
      h += '<button type="button" class="d-carte-prop' + (p.ton === 'danger' ? ' is-danger' : '') + '">'
        + '<b>' + ech(p.type) + '</b><p>' + ech(p.titre) + '</p>'
        + '<em>' + ech(p.meta) + ' · ' + ech(p.note) + '</em></button>';
    });
    h += '</div>';
    h += '<div class="d-groupe" data-d-casc="2"><div class="d-groupe-tete"><h3>En cours</h3>'
      + '<span class="d-compte">' + a.enCours.length + '</span></div>';
    a.enCours.forEach(function (c) {
      h += '<div class="d-veille"><i style="background:var(--accent)"></i>' + ech(c.titre)
        + '<span>' + ech(c.meta) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="d-groupe" data-d-casc="3"><div class="d-groupe-tete"><h3>À surveiller</h3></div>';
    a.veille.forEach(function (v) {
      h += '<div class="d-veille"><i></i>' + ech(v.titre) + '<span>' + ech(v.valeur) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="d-groupe" data-d-casc="4"><div class="d-groupe-tete"><h3>Les 14 prochains jours</h3></div>'
      + '<div class="d-radar">';
    D.RADAR.forEach(function (j, i) {
      h += '<div class="d-radar-j is-' + j.niveau + (i === 0 ? ' is-auj' : '') + '">'
        + j.jour + '<b>' + j.date + '</b><u>' + j.valeur + '</u></div>';
    });
    h += '</div></div></aside></div>';
    return h;
  }

  /* ========================================================================
     5. LA NAVIGATION, ET LES PORTES FERMEES
     ======================================================================== */
  function estOuvert(cle) {
    for (var i = 0; i < MENU.length; i += 1) if (MENU[i].cle === cle) return !!MENU[i].ouvert;
    return false;
  }

  function rendre(combien) {
    var planning = document.getElementById('ecranPlanning');
    var marketing = document.getElementById('ecranMarketing');
    // On ne repeint QUE l'ecran visible. Pendant le remplissage du planning il
    // y a un rendu toutes les 105 ms : redessiner l'ecran Marketing a chaque
    // fois serait trente reconstructions inutiles.
    if (etat.page === 'planning') planning.innerHTML = htmlPlanning(combien);
    else marketing.innerHTML = htmlMarketing();
    planning.hidden = etat.page !== 'planning';
    marketing.hidden = etat.page !== 'campaigns';
    // Les jetons du guide sont reappliques apres CHAQUE rendu : les noeuds
    // viennent d'etre recrees, une classe posee sur les anciens serait partie
    // avec eux. C'est ce qui rend le guide increvable a travers les rendus.
    appliquerJetons();
    [].forEach.call(document.querySelectorAll('[data-d-filtre]'), function (b) {
      b.addEventListener('click', function () { etat.filtre = b.getAttribute('data-d-filtre'); rendre(); });
    });
  }

  function ouvrir(cle) {
    if (estOuvert(cle)) {
      fermerFenetre();
      etat.page = cle;
      peindreMenu();
      rendre();
      return;
    }
    // Porte fermee : l'ecran reel reste derriere, floute, et la fenetre se
    // pose par-dessus. On ne change PAS `etat.page` : le fond doit rester une
    // page qui existe vraiment, pas un ecran vide.
    peindreMenuAvecActif(cle);
    ouvrirFenetre(cle);
  }

  function peindreMenuAvecActif(cle) {
    peindreMenu();
    var b = document.querySelector('[data-d-menu="' + cle + '"]');
    if (b) b.classList.add('is-actif');
  }

  var ID_FENETRE = 'dFenetre';
  function ouvrirFenetre(cle) {
    var p = PORTES[cle];
    if (!p) return;
    if (!etat.porte) etat.focusAvant = document.activeElement;
    etat.porte = cle;
    var fond = document.getElementById(ID_FENETRE);
    if (!fond) {
      fond = document.createElement('div');
      fond.id = ID_FENETRE;
      fond.className = 'd-fenetre-fond';
      document.body.appendChild(fond);
    }
    fond.innerHTML = '<section class="d-fenetre" role="dialog" aria-modal="true"'
      + ' aria-labelledby="dFenetreTitre" aria-describedby="dFenetreLede" tabindex="-1">'
      + '<p class="d-fenetre-kick"><i aria-hidden="true"></i>Sur rendez-vous</p>'
      + '<h2 id="dFenetreTitre">' + ech(p.titre) + '</h2>'
      + '<p class="d-fenetre-lede" id="dFenetreLede">L’écran est derrière cette fenêtre. On l’ouvre avec vous, branché sur les données de votre centre, pendant un appel de vingt minutes.</p>'
      + '<ul class="d-fenetre-liste">'
      + p.quoi.map(function (l) { return '<li>' + ech(l) + '</li>'; }).join('')
      + '</ul>'
      + '<p class="d-fenetre-pourquoi">' + ech(p.pourquoi) + '</p>'
      + '<div class="d-fenetre-actions">'
      + '<a class="d-fenetre-cta" href="' + LIEN_APPEL + '" target="_top" rel="noopener">Réserver l’appel de vingt minutes</a>'
      + '<button type="button" class="d-fenetre-retour" data-d-retour>Continuer sur le planning</button>'
      + '</div>'
      + '<p class="d-fenetre-echap">Touche Échap pour revenir au planning. Aucun compte à rebours, rien ne se ferme tout seul.</p>'
      + '</section>';
    document.body.classList.add('is-verrou');
    var principal = document.getElementById('dMain');
    if (principal) { principal.setAttribute('inert', ''); principal.setAttribute('aria-hidden', 'true'); }
    fond.querySelector('[data-d-retour]').addEventListener('click', function () { ouvrir('planning'); });
    fond.addEventListener('mousedown', function (ev) { if (ev.target === fond) ouvrir('planning'); });
    var boite = fond.querySelector('.d-fenetre');
    requestAnimationFrame(function () { try { boite.focus(); } catch (error) { /* pas focusable */ } });
  }

  function fermerFenetre() {
    if (!etat.porte) return;
    etat.porte = '';
    document.body.classList.remove('is-verrou');
    var principal = document.getElementById('dMain');
    if (principal) { principal.removeAttribute('inert'); principal.removeAttribute('aria-hidden'); }
    var fond = document.getElementById(ID_FENETRE);
    if (fond) fond.remove();
    if (etat.focusAvant && document.contains(etat.focusAvant)) {
      try { etat.focusAvant.focus(); } catch (error) { /* element parti */ }
    }
    etat.focusAvant = null;
  }

  /* Le piege a focus, et ses TROIS portes de sortie : Echap, le bouton
     « Continuer sur le planning », et un clic hors de la fenetre. Aucun compte
     a rebours, rien ne se ferme tout seul.

     A CORRIGE UNE AFFIRMATION FAUSSE de la premiere version, trouvee par le
     gate et pas par relecture : le commentaire promettait que la barre
     laterale restait cliquable pendant que la fenetre est ouverte. Elle ne
     l'est pas, et elle ne doit pas l'etre : le voile couvre tout l'ecran,
     c'est ce qui fait d'une fenetre une VRAIE fenetre modale, et c'est ce que
     la consigne demande (focus piege dedans, echappable). */
  document.addEventListener('keydown', function (e) {
    if (!etat.porte) return;
    var fond = document.getElementById(ID_FENETRE);
    if (!fond) return;
    if (e.key === 'Escape') { e.preventDefault(); ouvrir('planning'); return; }
    if (e.key !== 'Tab') return;
    var liste = [].filter.call(
      fond.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0; }
    );
    if (!liste.length) return;
    var premier = liste[0];
    var dernier = liste[liste.length - 1];
    if (!fond.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? dernier : premier).focus();
    } else if (e.shiftKey && document.activeElement === premier) {
      e.preventDefault(); dernier.focus();
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault(); premier.focus();
    }
  }, true);

  /* ========================================================================
     6. LE GUIDE : la console se construit en racontant une journee.
     ========================================================================
     Ce n'est pas une visite des fonctionnalites (« voici le menu, voici les
     onglets »), c'est UNE JOURNEE : l'agent qui a travaille la nuit et qu'on
     valide le matin, la reservation qui se pose seule, le geste de comptoir,
     la relance client, les chiffres du soir. A chaque etape, le bloc dont on
     parle ARRIVE, et la phrase dit ce que le gerant y gagne.

     TROIS REGLES qui empechent le guide de devenir une prison :
       1. il ne bloque JAMAIS l'exploration : sa carte n'est pas modale, et le
          moindre clic dans la console le replie en revelant tout ;
       2. « Passer » revele TOUT immediatement, sans animation a attendre ;
       3. `prefers-reduced-motion` pose l'etat final des le depart.

     Le rythme : une etape toutes les 6,6 s avec une jauge qui le montre, et
     jamais de trou (chaque etape amene son bloc au moment ou la phrase le
     nomme). Le survol de la carte met en pause : on ne perd pas sa phrase
     parce qu'on a voulu la relire. */
  var JETONS = ['tete', 'kpi', 'onglets', 'grille', 'liste', 'agent', 'mot', 'travail'];
  var vus = [];
  var fixes = [];

  var ETAPES = [
    {
      page: 'planning', jetons: ['tete'], cible: '[data-d-bloc="tete"]',
      titre: '8 h 40. Vous ouvrez le centre.',
      dit: 'Une seule page pour la journée entière : la date, et le bouton qui crée une réservation au comptoir.',
      gain: 'Plus de classeur, plus de tableur partagé. Ce que vous voyez ici, votre équipe le voit aussi.',
    },
    {
      page: 'campaigns', jetons: ['agent', 'mot'], cible: '[data-d-bloc="mot"]',
      titre: 'Cette nuit, l’agent a travaillé.',
      dit: 'Il a lu vos réservations pendant que le centre dormait, et il vous laisse un mot. Deux choses ce matin, pas quinze.',
      gain: 'Vous arrivez devant un constat déjà fait, pas devant des chiffres à éplucher.',
    },
    {
      page: 'campaigns', jetons: ['travail'], cible: '[data-d-bloc="travail"]',
      titre: 'Deux propositions, dont la relance client.',
      dit: 'Un post pour vos après-midis vides de 14 h à 16 h, et l’email des anniversaires fêtés ici il y a un an. Les deux sont écrits, ils attendent.',
      gain: 'Il prépare, vous validez ou vous copiez. Rien ne part sans vous, jamais.',
    },
    {
      page: 'planning', jetons: ['onglets', 'grille'], cible: '[data-d-bloc="grille"]', remplir: true,
      titre: 'La réservation se pose toute seule.',
      dit: 'Chaque réservation prise sur votre site atterrit sur la bonne piste, à la bonne heure, sans que personne ne la recopie.',
      gain: 'Zéro double réservation, zéro saisie le lundi matin. Et le creux de 14 h à 16 h se voit, c’est celui dont l’agent parlait.',
    },
    {
      page: 'planning', jetons: ['liste'], cible: '[data-d-bloc="liste"]',
      titre: '14 h. Un groupe arrive au comptoir.',
      dit: 'La même journée en liste, ouverte sur ceux qui sont là. Arrivé, payé : un clic, et toute l’équipe le voit.',
      gain: 'Le geste du samedi soir tient en une seconde. Le centre encaisse par ses propres moyens, Pinlane suit le statut.',
    },
    {
      page: 'planning', jetons: ['kpi'], cible: '[data-d-bloc="kpi"]',
      titre: '22 h. Les chiffres du soir sont déjà faits.',
      dit: 'Réservations, joueurs, chiffre d’affaires, taux d’occupation. Comptés sur la journée que vous venez de voir : additionnez les blocs, vous retombez dessus.',
      gain: 'Vous fermez sans rien calculer. Et l’agent repart de ces chiffres pour la nuit suivante.',
    },
    {
      page: 'planning', jetons: [], cible: '', fin: true,
      titre: 'Voilà une journée.',
      dit: 'Le reste de la console tourne aussi : réservations, clients, emails, tarifs, équipe. Les entrées grisées s’ouvrent pendant l’appel, avec vos données.',
      gain: 'Explorez librement, tout est cliquable. Et rien de ce que vous voyez ici n’est réel.',
    },
  ];
  /* LA DUREE D'UNE ETAPE SE CALCULE, elle ne se choisit pas.
     Premiere version : 6,6 s pour tout le monde. Mesure : les cartes portent
     40 a 51 mots, soit 10 a 13 s de lecture a 230 mots par minute. Le guide
     tournait donc DEUX FOIS trop vite, et un livrable qu'on n'a pas le temps
     de lire se ressent exactement comme un livrable casse (lecon deja payee
     sur la vitrine le 2026-07-29 : « bugge » voulait dire « trop rapide »).
     Chaque etape dure donc le temps de lire SON texte, plus deux secondes
     pour regarder l'element que la phrase designe. */
  function dureeDe(etape) {
    var mots = (etape.titre + ' ' + etape.dit + ' ' + etape.gain).split(/s+/).length;
    return Math.round(2000 + (mots / 230) * 60000);
  }

  function appliquerJetons() {
    [].forEach.call(document.querySelectorAll('[data-d-bloc]'), function (el) {
      var j = el.getAttribute('data-d-bloc');
      el.classList.toggle('is-vu', vus.indexOf(j) !== -1);
      el.classList.toggle('is-fixe', fixes.indexOf(j) !== -1);
    });
  }
  function revelerTout() {
    vus = JETONS.slice();
    fixes = JETONS.slice();
    document.documentElement.removeAttribute('data-d-guide');
    appliquerJetons();
  }

  function construireGuide() {
    var carte = document.createElement('aside');
    carte.className = 'd-guide';
    carte.id = 'dGuide';
    carte.setAttribute('role', 'region');
    carte.setAttribute('aria-label', 'Guide de la démonstration');
    document.body.appendChild(carte);
    var halo = document.querySelector('.d-halo');

    var index = -1;
    var tEtape = null;
    var tHalo = null;
    var tFixe = null;
    var pilotage = false;
    var termine = false;
    var enAuto = true;

    function stop() {
      if (tEtape) { clearTimeout(tEtape); tEtape = null; }
      if (tHalo) { clearInterval(tHalo); tHalo = null; }
    }
    function placerHalo(sel) {
      var el = sel ? document.querySelector(sel) : null;
      if (!el) { halo.classList.remove('is-on'); return; }
      var b = el.getBoundingClientRect();
      if (b.height < 4 || b.width < 4) { halo.classList.remove('is-on'); return; }
      halo.style.top = Math.max(4, b.top - 5) + 'px';
      halo.style.left = Math.max(4, b.left - 5) + 'px';
      halo.style.width = Math.min(b.width + 10, window.innerWidth - 8) + 'px';
      halo.style.height = Math.min(b.height + 10, window.innerHeight - 8) + 'px';
      halo.classList.add('is-on');
    }
    function peindreCarte(e) {
      var pied = e.fin
        ? '<button type="button" class="d-g-lien" data-d-rejouer>Revoir le guide</button>'
          + '<div class="d-guide-droite">'
          + '<button type="button" class="d-g-sec" data-d-fermer>Explorer librement</button>'
          + '<a class="d-g-fort" href="' + LIEN_APPEL + '" target="_top" rel="noopener">Réserver l’appel</a></div>'
        : '<button type="button" class="d-g-lien" data-d-passer>Passer le guide</button>'
          + '<div class="d-guide-droite">'
          + '<button type="button" class="d-g-sec" data-d-prec' + (index <= 0 ? ' disabled' : '') + '>Précédent</button>'
          + '<button type="button" class="d-g-fort" data-d-suiv>Suivant</button></div>';
      carte.className = 'd-guide' + (e.fin || SANS_MOUVEMENT || !enAuto ? '' : ' is-court');
      document.body.classList.add('d-guide-vivant');
      carte.style.setProperty('--d-duree', dureeDe(e) + 'ms');
      carte.innerHTML = '<div class="d-guide-jauge" aria-hidden="true"><i></i></div>'
        + '<div class="d-guide-corps">'
        + '<p class="d-guide-rang">Étape ' + (index + 1) + ' sur ' + ETAPES.length + ' · la journée d’un gérant</p>'
        + '<h2 class="d-guide-titre">' + ech(e.titre) + '</h2>'
        + '<p class="d-guide-dit">' + ech(e.dit) + '</p>'
        + '<p class="d-guide-gain"><b>Ce que ça change.</b> ' + ech(e.gain) + '</p></div>'
        + '<div class="d-guide-pied">' + pied + '</div>';
      brancher();
    }
    function brancher() {
      var q = function (s) { return carte.querySelector(s); };
      var p = q('[data-d-passer]'); if (p) p.addEventListener('click', function () { finir('passe'); });
      var s = q('[data-d-suiv]'); if (s) s.addEventListener('click', function () { enAuto = false; allerA(index + 1); });
      var r = q('[data-d-prec]'); if (r) r.addEventListener('click', function () { enAuto = false; allerA(index - 1); });
      var f = q('[data-d-fermer]'); if (f) f.addEventListener('click', function () { finir('fini'); });
      var j = q('[data-d-rejouer]'); if (j) j.addEventListener('click', relancer);
    }

    function allerA(n) {
      if (termine) return;
      stop();
      if (n < 0) n = 0;
      if (n >= ETAPES.length) { finir('fini'); return; }
      index = n;
      var e = ETAPES[n];

      if (e.page && etat.page !== e.page) {
        pilotage = true;
        etat.page = e.page;
        peindreMenu();
        rendre();
        setTimeout(function () { pilotage = false; }, 420);
      }
      if (e.jetons && e.jetons.length) {
        e.jetons.forEach(function (j) { if (vus.indexOf(j) === -1) vus.push(j); });
        appliquerJetons();
        if (SANS_MOUVEMENT) { e.jetons.forEach(function (j) { if (fixes.indexOf(j) === -1) fixes.push(j); }); appliquerJetons(); }
        else {
          if (tFixe) clearTimeout(tFixe);
          tFixe = setTimeout(function () {
            e.jetons.forEach(function (j) { if (fixes.indexOf(j) === -1) fixes.push(j); });
            appliquerJetons();
          }, 1200);
        }
      }
      if (e.fin) revelerTout();

      // Le remplissage du planning, reservation par reservation : c'est CE
      // mouvement qui raconte « personne n'a rien recopie ».
      if (e.remplir && !SANS_MOUVEMENT) remplirGrille();

      peindreCarte(e);
      setTimeout(function () {
        var el = e.cible ? document.querySelector(e.cible) : null;
        if (el) {
          try { el.scrollIntoView({ behavior: SANS_MOUVEMENT ? 'auto' : 'smooth', block: 'center' }); }
          catch (error) { el.scrollIntoView(); }
        }
        placerHalo(e.cible);
      }, e.jetons && e.jetons.length ? 440 : 140);
      tHalo = setInterval(function () { placerHalo(e.cible); }, 260);

      if (enAuto && !e.fin) tEtape = setTimeout(function () { allerA(index + 1); }, dureeDe(e));
    }

    var tRemplissage = [];
    function remplirGrille() {
      tRemplissage.forEach(clearTimeout);
      tRemplissage = [];
      var total = D.RESERVATIONS.length;
      rendre(0);
      for (var i = 1; i <= total; i += 1) {
        (function (k) {
          tRemplissage.push(setTimeout(function () {
            if (etat.page === 'planning' && !termine) rendre(k);
          }, 240 + k * 105));
        }(i));
      }
      tRemplissage.push(setTimeout(function () { if (etat.page === 'planning') rendre(); }, 240 + (total + 1) * 105));
    }

    function finir(raison) {
      stop();
      if (tFixe) { clearTimeout(tFixe); tFixe = null; }
      tRemplissage.forEach(clearTimeout);
      tRemplissage = [];
      termine = true;
      revelerTout();
      rendre();
      halo.classList.remove('is-on');
      document.body.classList.remove('d-guide-vivant');
      carte.className = 'd-guide is-pastille';
      carte.innerHTML = '<div class="d-guide-pied"><button type="button" class="d-g-sec" data-d-rejouer>'
        + (raison === 'passe' ? 'Reprendre le guide' : 'Revoir le guide')
        + '</button></div>';
      brancher();
    }

    function relancer() {
      termine = false;
      enAuto = true;
      vus = [];
      fixes = [];
      document.documentElement.setAttribute('data-d-guide', '1');
      appliquerJetons();
      allerA(0);
    }

    /* DES QUE le visiteur touche la console, il obtient l'ecran complet. Pas
       de demi-ecran pendant qu'il explore, pas d'animation a attendre. */
    document.addEventListener('pointerdown', function (ev) {
      if (termine || pilotage) return;
      if (carte.contains(ev.target)) return;
      var dans = ev.target && ev.target.closest ? ev.target.closest('.d-main, .d-side, .d-fenetre-fond') : null;
      if (dans) finir('fini');
    }, true);

    carte.addEventListener('mouseenter', function () {
      if (tEtape) { clearTimeout(tEtape); tEtape = null; }
      carte.classList.remove('is-court');
    });
    window.addEventListener('resize', function () {
      if (!termine && ETAPES[index]) placerHalo(ETAPES[index].cible);
    });

    return {
      demarrer: function () {
        if (SANS_MOUVEMENT) revelerTout();
        allerA(0);
      },
    };
  }

  /* ========================================================================
     7. DEMARRAGE
     ======================================================================== */
  function demarrer() {
    peindreMenu();
    if (!GUIDE_ACTIF) revelerTout();
    rendre();
    if (GUIDE_ACTIF) {
      var moteur = construireGuide();
      moteur.demarrer();
      // FILET DE SECURITE : si quoi que ce soit empeche le guide d'avancer,
      // personne ne doit rester devant un ecran depouille.
      setTimeout(function () {
        if (document.documentElement.hasAttribute('data-d-guide')
          && vus.length === 0) { revelerTout(); rendre(); }
      }, 8000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
}());
