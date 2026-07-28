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
  var minHeight = Number.isFinite(height) && height > 0 ? height : 720;

  var target = origin + '/reserver?embed=1'
    + (center ? '&center=' + encodeURIComponent(center) : '');

  var frame = document.createElement('iframe');
  frame.src = target;
  frame.title = 'Reservation en ligne';
  frame.loading = 'lazy';
  frame.style.cssText = 'display:block;width:100%;border:0;min-height:' + minHeight + 'px;';
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
    if (!data || data.type !== 'pinlane:height') return;
    var next = Number(data.height);
    if (!Number.isFinite(next) || next < 200 || next > 20000) return;
    frame.style.height = Math.ceil(next) + 'px';
    frame.style.minHeight = '0';
  }, false);
}());
