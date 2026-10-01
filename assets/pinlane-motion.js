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

  /* ---- LE FOCUS QUI SURVIT AU RENDU -------------------------------------
     Les pages de la console se re-rendent par `innerHTML` complet. Un champ de
     recherche dont le `oninput` declenche ce rendu est donc DETRUIT a chaque
     lettre : le focus part, et taper « anniversaire » demande douze clics.
     C'est ce que Movsar a decrit : « j'ecris un a et ca me retire de
     l'ecriture ».

     On memorise le champ par une CLE (`data-pl-focus`) et non par sa reference :
     l'element d'apres le rendu n'est pas le meme objet. La position du curseur
     est restauree aussi, sinon corriger une faute au milieu d'un mot renverrait
     le curseur a la fin. */
  function garderFocus(rendre) {
    var actif = document.activeElement;
    var cle = actif && actif.getAttribute ? actif.getAttribute('data-pl-focus') : null;
    var debut = null;
    var fin = null;
    if (cle) {
      try { debut = actif.selectionStart; fin = actif.selectionEnd; } catch (e) { /* type sans selection */ }
    }
    rendre();
    if (!cle) return;
    var neuf = document.querySelector('[data-pl-focus="' + cle + '"]');
    if (!neuf || neuf === actif) return;
    try {
      neuf.focus({ preventScroll: true });
      if (debut !== null) neuf.setSelectionRange(debut, fin);
    } catch (e) { /* le champ n'accepte pas la selection */ }
  }

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
      // Repaint invisible (is-repaint sur un ancetre) : la cascade ne
      // rejoue pas. La signature vient d etre memorisee ci-dessus, donc
      // elle ne rejouera pas non plus au retrait de la classe.
      if (liste.closest && liste.closest('.is-repaint')) continue;
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

  function oublierNeuves() { neuves = Object.create(null); animees = Object.create(null); }

  /* L ARRIVEE NE S ANIME QU UNE FOIS. Le marquage « nouveau » dure trois
     minutes, mais la liste et le planning se re-rendent plusieurs fois par
     minute : sans ce jeton, le halo et l entree rejouaient A CHAQUE rendu
     pendant tout ce temps, et l ecran clignotait tout seul (2026-08-26,
     Movsar : « on VOIT que ca rafraichit »). Le SIGNAL, lui, reste : la
     ligne garde son liistere accent, sans mouvement. */
  var animees = Object.create(null);
  function animationNeuveDue(id) {
    if (id == null) return false;
    var cle = String(id);
    if (animees[cle]) return false;
    animees[cle] = true;
    return true;
  }

  /* ---- LES CARTES QUI CHANGENT DE PLACE (2026-10-02) ---------------------
     Movsar : « aucune animation, mais pas lourd, faut pas que ca nique la
     fluidite quand on coche, decoche, quand une carte se place ». Une carte
     cochee « Tout est fait » passe en « À clôturer », une carte payee descend :
     elle GLISSE de son ancienne place a la nouvelle (FLIP : transform seul,
     220 ms), au lieu de disparaitre et reapparaitre.
     Les positions se memorisent par CLE (`data-res-row-id`) et RELATIVEMENT a
     la liste : faire defiler la page ne fait rien bouger. Au poll, rien n a
     change de place, rien ne s anime. Bornes : 40 cartes, et une carte qui
     saute de plus d un ecran ne glisse pas (elle s allume a l arrivee). */
  var places = Object.create(null);
  var noeuds = Object.create(null);      // la carte de la passe precedente (pour le fantome)
  var comptes = Object.create(null);     // le compte de chaque bandeau
  var FLIP_MAX = 60;
  var DUREE = 320;
  var COURBE = 'cubic-bezier(.2,.8,.2,1)';
  function anime(el, images, options) {
    if (typeof el.animate !== 'function') return null;
    try { return el.animate(images, options); } catch (e) { return null; }
  }
  function sectionDe(el) { var s = el && el.closest ? el.closest('.gc-section') : null; return s ? s.className.replace(/\s+(pl-\S+)/g, '') : ''; }
  // La CIBLE d une carte partie : son nouveau bandeau s il est replie (elle y
  // « rentre »), sinon rien (elle s efface sur place).
  function cibleDe(liste, cle, base) {
    var neuve = liste.querySelector('[data-res-row-id="' + cle + '"]');
    if (!neuve) return null;
    var section = neuve.closest('.gc-section');
    var bandeau = section ? section.querySelector('.gc-band') : null;
    if (!bandeau) return null;
    var r = bandeau.getBoundingClientRect();
    return r.width ? { x: r.left - base.left + 40, y: r.top - base.top, bandeau: bandeau } : null;
  }
  function deplacements(racine) {
    var hote = racine && racine.querySelectorAll ? racine : document;
    var listes = hote.querySelectorAll('.gc-sections');
    for (var l = 0; l < listes.length; l += 1) {
      var liste = listes[l];
      var base = liste.getBoundingClientRect();
      if (!base.width) continue;
      var cartes = liste.querySelectorAll('[data-res-row-id]');
      var vues = Object.create(null);
      var vusNoeuds = Object.create(null);
      var bandeauxTouches = [];
      var nouvelles = [];
      for (var i = 0; i < cartes.length && i < FLIP_MAX; i += 1) {
        var carte = cartes[i];
        var cle = carte.getAttribute('data-res-row-id');
        var r = carte.getBoundingClientRect();
        if (!r.width) continue;
        var ici = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, s: sectionDe(carte) };
        vues[cle] = ici;
        vusNoeuds[cle] = carte;
        var avant = places[cle];
        if (reduit || carte.__plPlace) continue;
        carte.__plPlace = true;
        if (!avant) {
          // Une carte qui apparait alors que la liste etait deja la (nouvelle
          // reservation, carte qui sort d une section repliee) : elle se pose.
          if (Object.keys(places).length) nouvelles.push(carte);
          continue;
        }
        var dx = avant.x - ici.x;
        var dy = avant.y - ici.y;
        var change = avant.s !== ici.s;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) continue;
        if (Math.abs(dy) > window.innerHeight * 1.5) {
          // Trop loin pour glisser : elle s allume la ou elle arrive.
          if (change) { carte.classList.remove('pl-arrive'); void carte.offsetWidth; carte.classList.add('pl-arrive'); }
          continue;
        }
        anime(carte, [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' + (change ? ' scale(.97)' : '') }, { transform: 'none' }], { duration: change ? DUREE + 80 : DUREE, easing: COURBE });
        if (change) {
          (function (c) { window.setTimeout(function () { c.classList.add('pl-arrive'); }, DUREE + 60); }(carte));
          var bd = carte.closest('.gc-section') ? carte.closest('.gc-section').querySelector('.gc-band') : null;
          if (bd) bandeauxTouches.push(bd);
        }
      }
      // LES CARTES PARTIES : un fantome de l ancienne carte part de son
      // ancienne place vers son nouveau bandeau (s il est replie) et s efface.
      // UN CHANGEMENT DE CONTEXTE N EST PAS UN MOUVEMENT : changer de jour, de
      // filtre ou de page remplace beaucoup de cartes d un coup. Au-dela de
      // trois parties ou arrivees, rien ne s anime (la cascade s en charge).
      var parties = [];
      for (var g in places) if (!vues[g]) parties.push(g);
      var calme = parties.length > 3 || nouvelles.length > 3;
      if (!reduit && !calme) {
        nouvelles.forEach(function (c) { anime(c, [{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: COURBE }); });
      }
      if (!reduit && !calme) {
        for (var k in places) {
          if (vues[k]) continue;
          var vieux = noeuds[k];
          var p = places[k];
          if (!vieux || !p || !p.w) continue;
          var cible = cibleDe(liste, k, base);
          var fantome = vieux.cloneNode(true);
          fantome.removeAttribute('data-res-row-id');
          fantome.setAttribute('aria-hidden', 'true');
          fantome.classList.add('pl-fantome');
          fantome.style.cssText = 'position:absolute;left:' + p.x + 'px;top:' + p.y + 'px;width:' + p.w + 'px;height:' + p.h + 'px;margin:0;pointer-events:none;z-index:6;';
          liste.appendChild(fantome);
          var vers = cible
            ? 'translate(' + (cible.x - p.x) + 'px,' + (cible.y - p.y) + 'px) scale(.35)'
            : 'scale(.92)';
          var a = anime(fantome, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: vers }], { duration: cible ? 460 : 260, easing: 'cubic-bezier(.4,0,.2,1)' });
          (function (f) {
            var fin = function () { if (f.parentNode) f.parentNode.removeChild(f); };
            if (a) a.onfinish = fin; else fin();
            window.setTimeout(fin, 700);
          }(fantome));
          if (cible && cible.bandeau) bandeauxTouches.push(cible.bandeau);
        }
      }
      // LE BANDEAU QUI RECOIT s illumine une fois.
      var bandeaux = liste.querySelectorAll('.gc-section .gc-band');
      for (var j = 0; j < bandeaux.length; j += 1) {
        var bandeau = bandeaux[j];
        var cleB = sectionDe(bandeau);
        var n = Number((bandeau.querySelector('.count') || {}).textContent) || 0;
        if (comptes[cleB] !== undefined && n > comptes[cleB]) bandeauxTouches.push(bandeau);
        comptes[cleB] = n;
      }
      if (!reduit) {
        var deja = [];
        bandeauxTouches.forEach(function (bd) {
          if (deja.indexOf(bd) >= 0) return;
          deja.push(bd);
          anime(bd, [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.012)', filter: 'brightness(1.35)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 520, delay: 140, easing: 'ease-out' });
        });
      }
      // Seules les cartes VUES a ce passage gardent une place : une carte
      // cachee (depliant ferme, autre page) repart de zero.
      places = vues;
      noeuds = vusNoeuds;
    }
  }

  /* ---- LA COCHE QUI REPOND ----------------------------------------------
     Une case cochee « saute » une fois (220 ms) quand son etat CHANGE, jamais
     au rafraichissement : l etat se memorise par cle (`data-pl-focus` de la
     case, qui est stable). */
  var coches = Object.create(null);
  function cochesChangees(racine) {
    var hote = racine && racine.querySelectorAll ? racine : document;
    var cases = hote.querySelectorAll('.gc-check[data-pl-focus], .gc-libre[data-pl-focus]');
    for (var i = 0; i < cases.length; i += 1) {
      var c = cases[i];
      var cle = c.getAttribute('data-pl-focus');
      var on = c.classList.contains('is-on') || c.classList.contains('is-fait');
      var avant = coches[cle];
      coches[cle] = on;
      if (avant === undefined || avant === on || reduit) continue;
      c.classList.remove('pl-pop');
      void c.offsetWidth;
      c.classList.add('pl-pop');
    }
  }

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
      window.requestAnimationFrame(function () { arme = false; chiffres(document); cascade(document); deplacements(document); cochesChangees(document); });
    }).observe(cible, { childList: true, subtree: true });
    chiffres(document);          // pose la valeur de reference sans animer
    cascade(document);
    deplacements(document);      // pose les places de reference
    cochesChangees(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observer);
  else observer();

  window.PinlaneMotion = {
    chiffres: chiffres,
    cascade: cascade,
    garderFocus: garderFocus,
    oublier: oublier,
    marquerNeuves: marquerNeuves,
    estNeuve: estNeuve,
    oublierNeuves: oublierNeuves,
    animationNeuveDue: animationNeuveDue,
    reduit: reduit,
  };
}());
