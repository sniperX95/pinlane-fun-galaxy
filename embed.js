/*!
 * Pinlane, module de réservation embarqué
 * https://app.pinlane.be
 *
 * Installation : une ligne, à l'endroit où le formulaire doit apparaître.
 *
 *   <script src="https://app.pinlane.be/embed.js" data-center="libramont"></script>
 *
 * Attributs disponibles :
 *   data-center         identifiant du centre (obligatoire si data-center-key est absent)
 *   data-center-key     clé de stockage local ou cookie où le site garde déjà le centre
 *                       choisi par le visiteur ; data-center sert alors de valeur par défaut
 *   data-target         sélecteur CSS du conteneur d'accueil (défaut : à l'endroit du script)
 *   data-fallback       sélecteur CSS du formulaire existant, masqué tant que le module est actif
 *   data-height         hauteur initiale en pixels avant le premier calcul (défaut : 480)
 *   data-scroll-margin  marge haute au défilement, pour passer sous un en-tête fixe (défaut : 80)
 *   data-design         "fungalaxy" monte le formulaire aux couleurs du centre
 *                       (même parcours, mêmes réservations) ; absent, le parcours standard
 *
 * Le cadre s'adapte à la hauteur de son contenu. À chaque réservation confirmée, un
 * événement `pinlane_booking` est poussé dans le dataLayer de la page et un événement
 * DOM `pinlane:booking` est émis, sans aucune donnée personnelle.
 *
 * Aucune dépendance, aucune étape de compilation.
 */

(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  // L'origine est déduite de l'URL du script : rien à configurer côté site.
  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch (error) {
    return;
  }

  // Sur un site multi-centres, le centre affiché suit celui que le visiteur a déjà
  // choisi. On lit la même source que le site (stockage local, puis cookies) via la
  // clé nommée par data-center-key. La valeur est normalisée en identifiant ;
  // si elle est inexploitable, data-center reprend la main.
  function identifiantDeCentre(valeur) {
    var brut = String(valeur == null ? '' : valeur).trim().toLowerCase();
    if (!brut) return '';
    try { brut = brut.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (error) { /* normalize indisponible */ }
    var id = brut.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return /^[a-z][a-z0-9-]{1,40}$/.test(id) ? id : '';
  }

  function centreChoisiParLeVisiteur() {
    var cle = script.getAttribute('data-center-key') || '';
    if (!cle) return '';
    var valeur = '';
    try { valeur = window.localStorage.getItem(cle) || ''; } catch (error) { valeur = ''; }
    if (!valeur) {
      try {
        var parts = String(document.cookie || '').split(';');
        for (var i = 0; i < parts.length; i += 1) {
          var paire = parts[i].split('=');
          if (paire[0] && paire[0].trim() === cle) { valeur = decodeURIComponent((paire[1] || '').trim()); break; }
        }
      } catch (error) { valeur = ''; }
    }
    return identifiantDeCentre(valeur);
  }

  var center = centreChoisiParLeVisiteur() || script.getAttribute('data-center') || '';

  // Le formulaire existant est masqué, jamais retiré de la page : le retour en
  // arrière reste un simple réglage, sans intervention sur le site.
  //
  // Le masquage passe par une feuille de style et non par un style en ligne. Un
  // style en ligne peut être réécrit par un script du site qui s'exécute après
  // celui-ci ; une règle `!important` l'emporte, et s'applique même si l'élément
  // n'existe pas encore au moment où ce script tourne.
  var replisSelecteur = script.getAttribute('data-fallback') || '';
  var masque = null;
  // Un sélecteur valide ne contient ni accolade, ni arobase, ni chevron ouvrant :
  // ce contrôle empêche la valeur de sortir de la règle ou de la balise de style.
  if (replisSelecteur && !/[{}@<]/.test(replisSelecteur)) {
    try {
      document.querySelector(replisSelecteur);
      masque = document.createElement('style');
      masque.setAttribute('data-pinlane', 'repli');
      masque.appendChild(document.createTextNode(replisSelecteur + '{display:none !important;}'));
      (document.head || document.documentElement).appendChild(masque);
    } catch (error) { masque = null; }
  }

  var height = parseInt(script.getAttribute('data-height'), 10);
  // Hauteur de départ, remplacée dès le premier message de hauteur. Un plancher
  // plus élevé produirait un saut de mise en page visible.
  var minHeight = Number.isFinite(height) && height > 0 ? height : 480;

  // data-design="fungalaxy" monte le formulaire habille aux couleurs du centre
  // (fungalaxy.html, meme parcours, memes API). Sans l attribut, rien ne
  // change : c est le parcours /reserver, exactement comme avant.
  var design = (script.getAttribute('data-design') || '').toLowerCase();
  var target = design === 'fungalaxy'
    ? origin + '/fungalaxy/' + encodeURIComponent(center || 'libramont') + '?embed=1'
    : origin + '/reserver?embed=1' + (center ? '&center=' + encodeURIComponent(center) : '');

  // Conteneur d'accueil, résolu avant la création du cadre : c'est de là qu'est
  // lue la couleur de fond du site.
  function cibleDeMontage() {
    var selecteur = script.getAttribute('data-target') || '';
    if (selecteur) {
      try { return document.querySelector(selecteur) || script.parentNode; } catch (error) { return script.parentNode; }
    }
    return script.parentNode;
  }

  // Premier ancêtre qui peint réellement un fond. Un document en `color-scheme:
  // dark` n'a pas de canevas transparent : le navigateur le peint lui-même. Le
  // cadre reprend donc la couleur du site pour se fondre dans la page.
  function fondDuSite(depart) {
    var noeud = depart;
    while (noeud && noeud.nodeType === 1) {
      var couleur = getComputedStyle(noeud).backgroundColor;
      if (couleur && couleur !== 'transparent' && couleur.indexOf('rgba(0, 0, 0, 0)') === -1) return couleur;
      noeud = noeud.parentElement;
    }
    return '';
  }

  var frame = document.createElement('iframe');
  // La couleur voyage dans l'adresse et non dans un message : elle est ainsi
  // connue avant la première peinture.
  var fondHote = fondDuSite(cibleDeMontage());
  frame.src = target + (fondHote ? '&fond=' + encodeURIComponent(fondHote) : '');
  frame.title = 'Reservation en ligne';
  frame.loading = 'lazy';
  frame.style.cssText = 'display:block;width:100%;border:0;min-height:' + minHeight + 'px;';
  // Au changement d'écran, le haut du cadre revient en vue. Cette marge laisse
  // la place à un en-tête fixe du site.
  var scrollMargin = parseInt(script.getAttribute('data-scroll-margin'), 10);
  frame.style.scrollMarginTop = (Number.isFinite(scrollMargin) && scrollMargin >= 0 ? scrollMargin : 80) + 'px';

  // Sous 720 px, le cadre reprend la largeur de l'écran. Les conteneurs de
  // contenu portent souvent un rembourrage latéral prévu pour du texte, qui
  // réduit le formulaire à une colonne étroite. Aucun élément du site n'est
  // modifié : seules les marges du cadre compensent ce rembourrage.
  function pleineLargeurTelephone() {
    frame.style.marginLeft = '0px';
    frame.style.marginRight = '0px';
    frame.style.width = '100%';
    frame.style.maxWidth = 'none';
    if (!frame.parentNode || window.innerWidth > 720) return;
    var boite = frame.getBoundingClientRect();
    var gauche = Math.round(boite.left);
    var droite = Math.round(document.documentElement.clientWidth - boite.right);
    // Déjà pleine largeur, ou déjà plus large que l'écran : on ne touche à rien.
    if (gauche <= 1 && droite <= 1) return;
    if (gauche < 0 || droite < 0) return;
    frame.style.marginLeft = '-' + gauche + 'px';
    frame.style.marginRight = '-' + droite + 'px';
    // Largeur explicite : une iframe est un élément remplacé, sans largeur
    // déclarée elle retombe sur sa taille intrinsèque de 300 px.
    frame.style.width = 'calc(100% + ' + (gauche + droite) + 'px)';
    // Butée au pixel : les arrondis sous-pixel du site peuvent faire dépasser le
    // cadre, et un pixel suffit à faire défiler la page latéralement.
    frame.style.maxWidth = document.documentElement.clientWidth + 'px';
  }

  frame.setAttribute('allow', 'payment');

  var fallback = document.createElement('noscript');
  var link = document.createElement('a');
  link.href = target;
  link.textContent = 'Reserver en ligne';
  fallback.appendChild(link);

  // Montage dans le conteneur désigné par data-target, ou à défaut à l'endroit
  // du script.
  var cible = cibleDeMontage();
  if (cible) {
    cible.appendChild(frame);
    cible.appendChild(fallback);
  } else {
    script.parentNode.insertBefore(frame, script);
    script.parentNode.insertBefore(fallback, script);
  }

  // Une iframe dont la hauteur suit son contenu ne défile pas : c'est la page
  // hôte qui défile. Le cadre ne peut donc pas savoir seul quelle partie de
  // lui-même est visible. La page le lui indique à chaque défilement.
  var vueEnAttente = false;
  function posterZoneVisible() {
    vueEnAttente = false;
    if (!frame.contentWindow) return;
    var boite = frame.getBoundingClientRect();
    var hauteurEcran = window.innerHeight || document.documentElement.clientHeight || 0;
    var message = {
      type: 'pinlane:vue',
      cacheEnHaut: Math.max(0, Math.round(-boite.top)),
      cacheEnBas: Math.max(0, Math.round(boite.bottom - hauteurEcran)),
      hauteurEcran: Math.round(hauteurEcran),
      // Le haut du cadre dans l'écran, non borné : il ne bouge que si la page
      // défile (un cadre qui grandit par le bas garde son haut). Le cadre s'en
      // sert pour ranger ses barres collées pendant le défilement.
      hautCadre: Math.round(boite.top),
    };
    try { frame.contentWindow.postMessage(message, origin); } catch (error) { /* cadre retire */ }
  }
  function planifierZoneVisible() {
    if (vueEnAttente) return;
    vueEnAttente = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(posterZoneVisible);
    else setTimeout(posterZoneVisible, 60);
  }
  window.addEventListener('scroll', planifierZoneVisible, { passive: true });
  window.addEventListener('resize', planifierZoneVisible);
  frame.addEventListener('load', posterZoneVisible);

  pleineLargeurTelephone();
  var minuteurLargeur = null;
  window.addEventListener('resize', function () {
    if (minuteurLargeur) clearTimeout(minuteurLargeur);
    minuteurLargeur = setTimeout(pleineLargeurTelephone, 120);
  });

  // Le cadre est monté immédiatement ; la lecture du réglage part en parallèle et
  // n'agit que dans le cas où le formulaire d'origine doit être rétabli. Une
  // erreur réseau ne rétablit jamais l'ancien formulaire : c'est un choix, pas la
  // conséquence d'une coupure passagère.
  function rendreLAncienFormulaire() {
    try {
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);
    } catch (error) { /* deja retire */ }
    if (masque && masque.parentNode) masque.parentNode.removeChild(masque);
  }

  try {
    var etatUrl = origin + '/api/public-booking-meta?embedState=1'
      + (center ? '&center=' + encodeURIComponent(center) : '');
    if (typeof fetch === 'function') {
      fetch(etatUrl, { credentials: 'omit' })
        .then(function (reponse) { return reponse && reponse.ok ? reponse.json() : null; })
        .then(function (etat) {
          if (etat && etat.actif === false) rendreLAncienFormulaire();
        })
        .catch(function () { /* le module reste en place */ });
    }
  } catch (error) { /* fetch indisponible : le module reste en place */ }

  // LES OUTILS DE MESURE DU SITE SE DECLENCHENT TOUT SEULS.
  //
  // Le push dataLayer ne compte rien tant que personne n'a créé un déclencheur
  // dans GTM. Or ce que demande l'agence du client, c'est de ne PAS perdre de
  // données : on appelle donc directement les outils DÉJÀ chargés par la page.
  // `fbq` (Pixel Meta) et `gtag` (GA4) sont des variables globales posées par
  // leurs propres scripts. Si le visiteur a refusé les cookies, ces scripts ne
  // sont jamais chargés, donc les globales n'existent pas et rien ne part : le
  // consentement du site est respecté par construction, sans que ce fichier ait
  // à le lire ni à le comprendre.
  //
  // data-track="datalayer" coupe cet appel direct, pour un site qui préfère
  // câbler l'événement lui-même dans GTM : sans ce réglage il compterait deux
  // fois. data-meta-event nomme l'événement Meta quand ce n'est pas celui-là.
  var mesureDirecte = (script.getAttribute('data-track') || '').toLowerCase() !== 'datalayer';
  var evenementMeta = script.getAttribute('data-meta-event') || 'CompleteRegistration';
  function declencherLesOutilsDuSite(detail) {
    if (!mesureDirecte) return;
    var montant = Number(detail.amount) || 0;
    var devise = detail.currency || 'EUR';
    try {
      if (typeof window.fbq === 'function') {
        window.fbq('track', evenementMeta, { value: montant, currency: devise, content_name: detail.label || '', status: detail.status || '' });
      }
    } catch (error) { /* le pixel du site a refusé : ce n'est pas à nous de le rattraper */ }
    // GA4 : `purchase`, PAS un nom maison. Seuls les événements RECOMMANDÉS de
    // la spécification alimentent les rapports d'eux-mêmes ; un nom inventé
    // oblige le site à aller le cocher à la main comme événement clé, ce qui
    // est exactement le travail qu'on lui épargne. `purchase` exige quatre
    // champs : currency, transaction_id, value et items.
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'purchase', {
          transaction_id: String(detail.reservationId || ''),
          value: montant,
          currency: devise,
          items: [{
            item_id: String(detail.formuleId || detail.type || 'reservation'),
            item_name: String(detail.label || 'Réservation'),
            item_category: String(detail.center || ''),
            price: montant,
            quantity: 1,
          }],
        });
      }
    } catch (error) { /* idem pour l'analytics du site */ }
  }

  window.addEventListener('message', function (event) {
    // Deux contrôles : l'origine dit d'où vient le message, la source dit quel
    // cadre l'a envoyé. Sans le second, une autre iframe de la même origine
    // pourrait redimensionner celle-ci.
    if (event.origin !== origin) return;
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data) return;
    if (data.type === 'pinlane:screen') {
      var top = frame.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.5) frame.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (data.type === 'pinlane:booking') {
      // Réservation confirmée. La page hôte ne voit rien de l'intérieur du cadre :
      // c'est ce message qui porte la conversion à ses outils de mesure. Deux
      // sorties, pour n'imposer aucun outillage : un push dataLayer (déclencheur
      // « événement personnalisé » pinlane_booking dans GTM) et un événement DOM
      // pour un site sans gestionnaire de balises. Aucune donnée personnelle.
      var detail = data.detail && typeof data.detail === 'object' ? data.detail : {};
      try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'pinlane_booking', pinlane: detail }); } catch (error) { /* dataLayer inaccessible */ }
      try { window.dispatchEvent(new CustomEvent('pinlane:booking', { detail: detail })); } catch (error) { /* CustomEvent indisponible */ }
      declencherLesOutilsDuSite(detail);
      return;
    }
    if (data.type === 'pinlane:voir') {
      // Le cadre demande à montrer une bande de lui-même (un calendrier qui
      // s'ouvre, par exemple) : la page défile du minimum pour qu'elle tienne
      // dans l'écran, et son haut prime si elle ne tient pas. Le haut garde la
      // même marge que pinlane:screen (en-tête collé du site).
      var hautBande = Number(data.haut);
      var basBande = Number(data.bas);
      if (!Number.isFinite(hautBande) || !Number.isFinite(basBande) || basBande <= hautBande) return;
      var boiteCadre = frame.getBoundingClientRect();
      var ecran = window.innerHeight || document.documentElement.clientHeight || 0;
      var margeHaut = parseFloat(frame.style.scrollMarginTop);
      if (!Number.isFinite(margeHaut) || margeHaut < 0) margeHaut = 16;
      var decalage = 0;
      if (boiteCadre.top + basBande > ecran - 16) decalage = boiteCadre.top + basBande - (ecran - 16);
      if (boiteCadre.top + hautBande - decalage < margeHaut) decalage = boiteCadre.top + hautBande - margeHaut;
      if (Math.abs(decalage) >= 1) window.scrollBy({ top: decalage, behavior: 'smooth' });
      return;
    }
    if (data.type !== 'pinlane:height') return;
    var next = Number(data.height);
    if (!Number.isFinite(next) || next < 200 || next > 20000) return;
    frame.style.height = Math.ceil(next) + 'px';
    // La hauteur change, donc la part visible aussi.
    planifierZoneVisible();
    frame.style.minHeight = '0';
  }, false);
}());
