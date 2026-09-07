/* ==========================================================================
   PINLANE EMBED : le parcours de reservation, installe chez le client.
   ==========================================================================

   Le tunnel client n'est pas fait pour vivre sur le domaine de Pinlane : le
   visiteur arrive sur le site de SON centre, il doit y rester. Jusqu'ici,
   installer voulait dire ecrire une iframe a la main et vivre avec une hauteur
   fixe qui coupe les etapes longues ou laisse un trou blanc sur les courtes.

   Ce que le client colle, une fois, la ou il veut le formulaire :

     <script src="https://app.pinlane.be/embed.js" data-center="libramont"></script>

   Ce que le script garantit :
     : l'iframe se cree A L'ENDROIT du script (pas en fin de page) ;
     : la HAUTEUR suit le contenu, etape par etape, via postMessage - c'est ce
       qui separe un vrai widget d'un cadre avec ascenseur ;
     : a chaque changement d'ecran du parcours, le haut du cadre revient en vue
       s'il etait sorti de l'ecran (le visiteur ne regarde jamais le bas d'un
       cadre qui vient de changer de hauteur) ;
     : le message de redimensionnement n'est accepte que s'il vient de l'iframe
       que CE script a cree (verification de la source ET de l'origine) : un
       autre cadre de la page ne peut pas piloter notre hauteur ;
     : sans JavaScript, un lien de repli mene au parcours en pleine page - le
       client ne perd jamais une reservation a cause d'un navigateur exotique ;
     : le cadre se monte a l endroit indique par data-target, ou a defaut la
       ou le script est colle ; l ancien formulaire designe par data-fallback
       est masque par une regle !important, que le site ne peut pas defaire ;
     : sur un site multi-centres, le centre suit la selection deja faite par le
       visiteur (data-center-key nomme la cle que le site utilise deja) ;
       data-center reste le defaut quand rien n a ete choisi ;
     : l ancien formulaire du client RESTE dans la page, simplement masque par
       ce script. Un interrupteur cote Pinlane le rend en un clic, sans toucher
       au site : c est la sortie de secours d un dimanche a 15 h, quand personne
       ne veut chercher les identifiants de l agence. Le selecteur du formulaire
       d origine se declare avec data-fallback ;
     : a chaque reservation prise, le site recoit un evenement de mesure
       (dataLayer `pinlane_booking` + CustomEvent `pinlane:booking`, sans
       donnee personnelle) : GA4, GTM et Pixel Meta du site continuent de
       compter les conversions. Mode d'emploi : docs/embed-tracking.md.

   Zero dependance, zero build : le fichier est servi tel quel.
   ========================================================================== */

(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  // L'origine vient de l'URL du script lui-meme : le client n'a rien a
  // configurer, et un changement de domaine cote Pinlane suit tout seul.
  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch (error) {
    return;
  }

  // LE CENTRE VIENT DE LA SELECTION QUE LE SITE A DEJA FAITE.
  //
  // Un site multi-centres demande au visiteur ou il va, une fois, et retient sa
  // reponse. Coller un centre FIXE dans la page enverrait un visiteur de
  // Gembloux sur le planning de Libramont : mauvais horaires, mauvais tarifs,
  // et personne ne s en apercevrait avant une reservation impossible a honorer.
  //
  // On lit donc la MEME source que le site : la cle nommee par
  // data-center-key, dans le stockage local puis dans les cookies. La valeur
  // est reduite a un identifiant (« Libramont » devient « libramont ») ; si
  // elle ne ressemble a rien d exploitable, data-center reprend la main. Aucune
  // table de correspondance a tenir : c est le nom du centre qui fait foi des
  // deux cotes.
  function identifiantDeCentre(valeur) {
    var brut = String(valeur == null ? '' : valeur).trim().toLowerCase();
    if (!brut) return '';
    try { brut = brut.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (error) { /* navigateur sans normalize */ }
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
  // L ANCIEN FORMULAIRE DU CLIENT, laisse en place et masque.
  //
  // Il ne faut surtout pas le supprimer du site : le jour ou il faut revenir en
  // arriere, on veut un interrupteur, pas une intervention dans WordPress. Le
  // client garde donc son formulaire dans la page, et ce script se contente de
  // le cacher tant que le parcours Pinlane est actif.
  // ON LE MASQUE AVEC UNE REGLE DE STYLE, PAS AVEC UN STYLE EN LIGNE.
  //
  // Un style en ligne se fait ecraser par le site lui-meme. Mesure sur le site
  // de Fun Galaxy : Gravity Forms appelle `jQuery('#gform_wrapper_4').show()`
  // quand il initialise sa logique conditionnelle, ce qui reecrit
  // `style="display:block"` APRES notre passage. Le visiteur verrait alors les
  // DEUX formulaires. Une regle `!important` posee dans une feuille de style
  // gagne contre n importe quel style en ligne sans `!important`, donc contre
  // tout ce que le site fera plus tard.
  //
  // Deuxieme benefice : la regle s applique meme si l element n existe pas
  // encore au moment ou ce script tourne (script colle plus haut dans la page).
  var replisSelecteur = script.getAttribute('data-fallback') || '';
  var masque = null;
  // Un selecteur CSS valide ne contient ni accolade, ni arobase, ni chevron
  // ouvrant : ce garde interdit qu une valeur de data-fallback sorte de la
  // regle, ou de la balise de style qui la porte.
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
  // 480 : la hauteur du premier ecran (la question du jour) sur un telephone.
  // Le premier message de hauteur arrive au chargement et remplace ce plancher ;
  // un plancher plus haut faisait un saut de mise en page visible chez l hote.
  var minHeight = Number.isFinite(height) && height > 0 ? height : 480;

  var target = origin + '/reserver?embed=1'
    + (center ? '&center=' + encodeURIComponent(center) : '');

  var frame = document.createElement('iframe');
  frame.src = target;
  frame.title = 'Reservation en ligne';
  frame.loading = 'lazy';
  frame.style.cssText = 'display:block;width:100%;border:0;min-height:' + minHeight + 'px;';
  // Quand le parcours change d ecran, le haut du cadre revient en vue ; la
  // plupart des sites ont un en-tete colle en haut, qui recouvrirait la barre
  // haute du parcours. Cette marge (80 px par defaut, data-scroll-margin pour
  // l ajuster) laisse l en-tete du site au-dessus, pas par-dessus.
  var scrollMargin = parseInt(script.getAttribute('data-scroll-margin'), 10);
  frame.style.scrollMarginTop = (Number.isFinite(scrollMargin) && scrollMargin >= 0 ? scrollMargin : 80) + 'px';

  // SUR TELEPHONE, LE FORMULAIRE PREND TOUTE LA LARGEUR DE L ECRAN.
  // Mesure sur la vraie page du client : dans un ecran de 320 px, le cadre ne
  // faisait que 244 px, pose a 38 px du bord, parce que le conteneur du site
  // porte un rembourrage lateral prevu pour du texte. Le parcours se
  // retrouvait dans une colonne etroite, au point qu il fallait balayer de
  // gauche a droite pour tout voir. Movsar : « c est juste un espace dedie
  // rectangulaire, non, faut que ce soit libre ».
  // On ne touche a AUCUN element du site : on tire seulement NOTRE cadre par
  // des marges negatives egales au rembourrage qu on vient de mesurer. Au-dela
  // de 720 px la colonne du site a un sens, donc on la respecte.
  function pleineLargeurTelephone() {
    frame.style.marginLeft = '0px';
    frame.style.marginRight = '0px';
    frame.style.width = '100%';
    frame.style.maxWidth = 'none';
    if (!frame.parentNode || window.innerWidth > 720) return;
    var boite = frame.getBoundingClientRect();
    var gauche = Math.round(boite.left);
    var droite = Math.round(document.documentElement.clientWidth - boite.right);
    // Deja pleine largeur, ou deja plus large que l ecran : on ne touche pas.
    if (gauche <= 1 && droite <= 1) return;
    if (gauche < 0 || droite < 0) return;
    frame.style.marginLeft = '-' + gauche + 'px';
    frame.style.marginRight = '-' + droite + 'px';
    // LARGEUR EXPLICITE, PAS `auto`. Une iframe est un element remplace : sans
    // largeur declaree elle retombe sur sa taille intrinseque de 300 px, quelle
    // que soit celle de son parent. Mesure : le cadre restait a 300 px sur tous
    // les telephones, meme sur un ecran de 430.
    frame.style.width = 'calc(100% + ' + (gauche + droite) + 'px)';
    // Butee au pixel : les arrondis de sous-pixel du site peuvent faire
    // depasser le cadre d un pixel, et un pixel suffit a faire glisser la page
    // de gauche a droite sur un telephone.
    frame.style.maxWidth = document.documentElement.clientWidth + 'px';
  }
  // Le parcours a besoin d'ecrire son propre stockage (brouillon de
  // reservation) et de poster le formulaire : same-origin sur SON origine, pas
  // sur celle du client.
  frame.setAttribute('allow', 'payment');

  var fallback = document.createElement('noscript');
  var link = document.createElement('a');
  link.href = target;
  link.textContent = 'Reserver en ligne';
  fallback.appendChild(link);

  // OU LE CADRE SE MONTE.
  //
  // Par defaut : a l endroit exact ou le script est colle. C est le cas simple,
  // et il ne bouge pas.
  //
  // Mais sur un site verrouille, l endroit ou l on PEUT coller un script n est
  // pas l endroit ou le formulaire DOIT apparaitre. Releve sur le site de Fun
  // Galaxy : le theme construit la section de reservation lui-meme, aucun champ
  // libre n existe a cet endroit, et le compte dont on dispose n a pas les
  // droits d installer quoi que ce soit. Le seul point d insertion disponible
  // est ailleurs dans la page. Sans data-target, le parcours s afficherait la
  // ou on a pu coller le script, pas la ou le visiteur le cherche.
  var cibleSelecteur = script.getAttribute('data-target') || '';
  var cible = null;
  if (cibleSelecteur) {
    try { cible = document.querySelector(cibleSelecteur); } catch (error) { cible = null; }
  }
  if (cible) {
    cible.appendChild(frame);
    cible.appendChild(fallback);
  } else {
    script.parentNode.insertBefore(frame, script);
    script.parentNode.insertBefore(fallback, script);
  }

  // Une fois monte, on sait enfin ou le site nous a places : c est la seule
  // position qui permette de mesurer son rembourrage.
  // CE QUI EST VISIBLE DU CADRE, DIT AU CADRE.
  // Une iframe dont la hauteur suit le contenu NE DEFILE PAS : c est la page
  // hote qui defile. Donc `position: fixed` a l interieur se colle au haut du
  // CADRE, pas au haut de l ecran. Un message pose la se retrouve hors champ
  // des que le visiteur est descendu un peu (Movsar : « il s affiche trop en
  // haut, on le voit pas quand on est un peu plus bas »). Le cadre ne peut pas
  // savoir tout seul ou il en est : seule la page hote le sait. On lui envoie
  // donc, a chaque defilement, combien de pixels de lui-meme sont caches en
  // haut et en bas, et il pose ses messages dans la bande qui reste visible.
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
    };
    try { frame.contentWindow.postMessage(message, origin); } catch (error) { /* cadre parti */ }
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

  // L INTERRUPTEUR. Le cadre est monte TOUT DE SUITE, comme avant : dans la vie
  // normale, faire attendre chaque visiteur le temps d une requete pour un
  // reglage qui ne change jamais serait un mauvais marche. La verification part
  // en parallele, et ne fait quelque chose que dans le seul cas ou il y a
  // quelque chose a faire : Pinlane a demande de rendre l ancien formulaire.
  //
  // UNE ERREUR RESEAU NE REND PAS L ANCIEN FORMULAIRE. Revenir en arriere est
  // une DECISION, jamais la consequence d une coupure passagere : sinon le site
  // du client basculerait d un formulaire a l autre au gre du reseau, sans que
  // personne ne l ait voulu ni ne le comprenne.
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
        .catch(function () { /* on garde le parcours en place */ });
    }
  } catch (error) { /* navigateur sans fetch : le parcours reste en place */ }

  window.addEventListener('message', function (event) {
    // Deux verifications, pas une : l'origine dit d'ou vient le message, la
    // source dit QUEL cadre l'a envoye. Sans la seconde, n'importe quelle autre
    // iframe servie par la meme origine pourrait redimensionner celle-ci.
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
      // UNE RESERVATION VIENT D ETRE PRISE DANS LE CADRE. Le site hote ne voit
      // rien de l'iframe : c'est ce message qui porte la conversion a ses outils
      // de mesure. Deux sorties, pour ne rien imposer : un push dataLayer (GTM :
      // declencheur « evenement personnalise » pinlane_booking, GA4 et Pixel
      // Meta s'y branchent sans toucher a ce fichier) et un CustomEvent DOM pour
      // un site sans GTM. Le detail ne porte aucune donnee personnelle.
      var detail = data.detail && typeof data.detail === 'object' ? data.detail : {};
      try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'pinlane_booking', pinlane: detail }); } catch (error) { /* dataLayer inaccessible */ }
      try { window.dispatchEvent(new CustomEvent('pinlane:booking', { detail: detail })); } catch (error) { /* navigateur sans CustomEvent */ }
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
