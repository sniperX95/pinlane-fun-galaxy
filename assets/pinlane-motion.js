/* ==========================================================================
   LE MOTION DE LA CONSOLE
   ==========================================================================
   Ajout du 2026-07-29, demande de Movsar : « le motion design de la landing est
   beaucoup plus beau que celui du vrai produit, il n'y a pas autant d'animation
   quand une nouvelle resa arrive ».

   C'est vrai, mais on ne porte PAS le motion de la vitrine tel quel, et c'est
   volontaire. Sur la vitrine une scene dure 12,5 s : elle RACONTE. Ici on est au
   comptoir un samedi soir, avec un groupe qui attend : le motion doit INFORMER
   en 200 a 500 ms puis disparaitre. Un spinner de 1,2 s sur chaque action ferait
   passer l'outil pour lent, et la loi 1 du produit est « si ca demande une
   explication, c'est rate ».

   Ce qui se porte donc, et rien d'autre :
     - les chiffres montent unite par unite AU LIEU DE SAUTER ;
     - ce qui vient d'arriver se signale, puis s'eteint tout seul ;
     - une valeur qui monte et une valeur qui descend ne se ressemblent pas.

   LA REGLE QUI FAIT TOUT TENIR : un chiffre ne s'anime QUE s'il a change. Le
   poll re-rend l'ecran toutes les quelques secondes ; sans cette regle, tout le
   tableau de bord se remettrait a defiler en boucle devant quelqu'un qui essaie
   de lire. C'est la difference entre « vivant » et « inutilisable ».
   ========================================================================== */

(function () {
  'use strict';

  var reduit = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- LES CHIFFRES QUI MONTENT -----------------------------------------
     Les rendus de la console sont des `innerHTML` complets : les noeuds sont
     detruits a chaque passage. On memorise donc la derniere valeur affichee par
     CLE STABLE (`data-pl-num`), pas par element. */
  var derniere = Object.create(null);
  var enCours = Object.create(null);

  function nombreDe(texte) {
    // On lit le nombre DANS le texte affiche : « 1 031 € », « 14 », « 78 % ».
    // Les espaces fines et insecables de `toLocaleString('fr-BE')` doivent
    // disparaitre avant le parsing, sinon « 1 031 » se lit 1.
    var brut = String(texte == null ? '' : texte)
      .replace(/[\s  ]/g, '')
      .replace(',', '.')
      .match(/-?\d+(?:\.\d+)?/);
    return brut ? Number(brut[0]) : null;
  }

  function animerChiffre(el, de, vers) {
    var cle = el.getAttribute('data-pl-num');
    var modele = el.textContent;
    // Marqueur anti-boucle : ecrire dans textContent declenche l'observateur,
    // qui rappellerait `chiffres()`, qui lirait une valeur intermediaire et
    // relancerait une animation vers elle. Sans ce drapeau, le compteur ne
    // s'arrete jamais.
    el.setAttribute('data-pl-anim', '1');
    var duree = Math.min(900, 260 + Math.abs(vers - de) * 8);
    var jeton = (enCours[cle] = (enCours[cle] || 0) + 1);
    var debut = null;
    var decimales = (String(vers).split('.')[1] || '').length;

    el.classList.remove('pl-num-up', 'pl-num-down');
    // Un chiffre qui monte et un chiffre qui descend ne doivent pas se
    // ressembler : au comptoir, « +1 reservation » et « -1 place » n'appellent
    // pas la meme reaction, et la couleur le dit avant que le nombre soit lu.
    el.classList.add(vers > de ? 'pl-num-up' : 'pl-num-down');

    function pas(t) {
      if (enCours[cle] !== jeton) return;            // un rendu plus recent a pris la main
      if (debut === null) debut = t;
      var p = Math.min(1, (t - debut) / duree);
      var doux = 1 - Math.pow(1 - p, 3);
      var v = de + (vers - de) * doux;
      el.textContent = modele.replace(/-?[\d\s  .,]*\d/, formater(v, decimales));
      if (p < 1) requestAnimationFrame(pas);
      else {
        el.textContent = modele;
        el.removeAttribute('data-pl-anim');
        window.setTimeout(function () {
          if (enCours[cle] === jeton) el.classList.remove('pl-num-up', 'pl-num-down');
        }, 900);
      }
    }
    requestAnimationFrame(pas);
  }

  function formater(v, decimales) {
    return decimales
      ? v.toFixed(decimales).replace('.', ',')
      : Math.round(v).toLocaleString('fr-BE');
  }

  // A appeler apres CHAQUE rendu qui peut contenir des chiffres.
  function chiffres(racine) {
    var hote = racine && racine.querySelectorAll ? racine : document;
    var noeuds = hote.querySelectorAll('[data-pl-num]');
    for (var i = 0; i < noeuds.length; i += 1) {
      var el = noeuds[i];
      if (el.hasAttribute('data-pl-anim')) continue;
      var cle = el.getAttribute('data-pl-num');
      var vers = nombreDe(el.textContent);
      if (vers === null) continue;
      var de = derniere[cle];
      derniere[cle] = vers;
      // Premier affichage : on POSE la valeur sans l'animer. Faire defiler tous
      // les compteurs a chaque ouverture de page serait spectaculaire une fois
      // et fatigant les mille suivantes.
      if (de === undefined || de === vers || reduit) continue;
      animerChiffre(el, de, vers);
    }
  }

  // Changer de centre ou de journee, c'est changer de sujet : les valeurs
  // precedentes ne sont plus comparables et ne doivent pas produire de defile.
  function oublier() { derniere = Object.create(null); signatures = Object.create(null); }

  /* ---- LES LISTES QUI SE RECOMPOSENT ------------------------------------
     Quand on cherche un client, la liste ne doit pas se remplacer d'un coup :
     ses lignes se posent l'une apres l'autre, comme sur la vitrine. 26 ms
     d'ecart, pas 200 : on veut que la liste RESPIRE, pas qu'elle se fasse
     attendre.

     Meme garde-fou que pour les chiffres : on ne rejoue que si la liste a
     vraiment change. La signature ne retient que l'IDENTITE des lignes (leurs
     18 premiers caracteres, donc le nom) et pas leurs valeurs : un montant qui
     bouge au poll ne doit pas relancer toute la cascade.

     TROIS BORNES, parce que c'est un outil de travail et pas une demo :
       - 8 lignes decalees au maximum (soit 126 ms avant la derniere), le reste
         apparait d'un bloc. Une cascade qu'on attend est une cascade ratee ;
       - la signature ne lit que 40 lignes : au-dela le cout de comparaison
         depasserait le benefice, et une liste de 200 lignes qui change change
         de toute facon dans ses 40 premieres ;
       - `void offsetWidth` force un recalcul de style, donc on ne le paie QUE
         sur les lignes reellement decalees. */
  var signatures = Object.create(null);
  var CASCADE_MAX = 8;               // au-dela, l'oeil ne suit plus et ca traine
  var CASCADE_PAS = 18;              // ms entre deux lignes
  var SIG_MAX = 40;                  // lignes lues pour la signature

  function cascade(racine) {
    var hote = racine && racine.querySelectorAll ? racine : document;
    var listes = hote.querySelectorAll('[data-pl-stagger]');
    for (var i = 0; i < listes.length; i += 1) {
      var liste = listes[i];
      var cle = liste.getAttribute('data-pl-stagger');
      var enfants = liste.children;
      var n = enfants.length;
      var sig = n + '|';
      for (var s = 0; s < n && s < SIG_MAX; s += 1) sig += (enfants[s].textContent || '').trim().slice(0, 18) + ';';
      if (signatures[cle] === sig) continue;
      signatures[cle] = sig;
      if (reduit) continue;
      for (var j = 0; j < n && j < CASCADE_MAX; j += 1) {
        var e = enfants[j];
        e.classList.remove('pl-in');
        void e.offsetWidth;          // force le redemarrage de l'animation
        e.style.animationDelay = (j * CASCADE_PAS) + 'ms';
        e.classList.add('pl-in');
      }
    }
  }

  /* ---- CE QUI VIENT D'ARRIVER -------------------------------------------
     Une reservation tombee du site pendant le service doit se voir DANS la
     liste et DANS le planning, pas seulement dans un bandeau en coin qu'on rate
     quand on a la tete au comptoir. Le marquage se perime tout seul : au bout
     de quelques minutes, « nouveau » ne veut plus rien dire, et un ecran ou
     tout brille est un ecran ou plus rien ne ressort. */
  var NEUF_MS = 3 * 60 * 1000;
  var neuves = Object.create(null);

  function marquerNeuves(ids) {
    var t = Date.now();
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      if (id == null) return;
      neuves[String(id)] = t;
    });
  }

  function estNeuve(id) {
    if (id == null) return false;
    var t = neuves[String(id)];
    if (!t) return false;
    if (Date.now() - t > NEUF_MS) { delete neuves[String(id)]; return false; }
    return true;
  }

  function oublierNeuves() { neuves = Object.create(null); }

  /* ---- LE DECLENCHEUR ----------------------------------------------------
     `renderStaffData` a une demi-douzaine de sorties selon la page, et le
     fichier est edite par plusieurs sessions : y greffer des appels a la main,
     c'est en oublier un et laisser un ecran mort. On observe donc le DOM. Ca
     marche quel que soit le chemin de rendu, et ca survit aux refactors.

     On regroupe sur `requestAnimationFrame` et NON sur un `setTimeout` : un
     `innerHTML` de page emet ses dizaines de mutations dans le meme tick, donc
     un seul rAF les couvre toutes. Surtout, le rAF s'execute AVANT la peinture.
     Avec un delai de 60 ms, le navigateur peignait d'abord la valeur finale
     posee par le rendu, puis l'animation repartait de l'ancienne : le chiffre
     faisait un aller-retour visible (40, puis 0, puis 40). Trouve par le test de
     monotonie, pas a la relecture. */
  var arme = false;
  function observer() {
    var cible = document.body;
    if (!cible || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (arme) return;
      arme = true;
      window.requestAnimationFrame(function () { arme = false; chiffres(document); cascade(document); });
    }).observe(cible, { childList: true, subtree: true });
    chiffres(document);          // pose la valeur de reference sans animer
    cascade(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observer);
  else observer();

  window.PinlaneMotion = {
    chiffres: chiffres,
    cascade: cascade,
    oublier: oublier,
    marquerNeuves: marquerNeuves,
    estNeuve: estNeuve,
    oublierNeuves: oublierNeuves,
    reduit: reduit,
  };
}());
