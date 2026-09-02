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
       client ne perd jamais une reservation a cause d'un navigateur exotique.

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

  var center = script.getAttribute('data-center') || '';
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
  // Le parcours a besoin d'ecrire son propre stockage (brouillon de
  // reservation) et de poster le formulaire : same-origin sur SON origine, pas
  // sur celle du client.
  frame.setAttribute('allow', 'payment');

  var fallback = document.createElement('noscript');
  var link = document.createElement('a');
  link.href = target;
  link.textContent = 'Reserver en ligne';
  fallback.appendChild(link);

  script.parentNode.insertBefore(frame, script);
  script.parentNode.insertBefore(fallback, script);

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
    if (data.type !== 'pinlane:height') return;
    var next = Number(data.height);
    if (!Number.isFinite(next) || next < 200 || next > 20000) return;
    frame.style.height = Math.ceil(next) + 'px';
    frame.style.minHeight = '0';
  }, false);
}());
