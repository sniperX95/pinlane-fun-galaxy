/* ==========================================================================
   LE MOUVEMENT DE LA CONSOLE (2026-11-19)
   ==========================================================================
   Ansar : « beaucoup plus waw, joli, du motion design partout, et léger pour
   vraiment tout », en s'aidant de ce qui a déjà été fait de très beau. Lu dans
   le code de douze bibliothèques (motion-primitives, React Bits, NumberFlow,
   shadcn/studio, UI Layouts, Watermelon, Aceternity ; durées de Carbon et
   Atlassian) : learning/resources/2026-11-19_bibliotheques-motion. Réécrit
   ici sans React ni dépendance, en n'animant que transform et opacity, que le
   compositeur joue même quand le fil de la page travaille.

   La règle qui fait tout tenir : RIEN N'ATTEND L'ANIMATION. L'état de la
   console change tout de suite, comme avant (le serveur, les gates et les
   lecteurs d'écran le lisent tel quel). Le mouvement se joue sur des CALQUES
   à part, vides de texte et sans id, qui disparaissent à la fin.

   - les fenêtres : la vraie fenêtre (la fiche, Réserver, Modifier, le client)
     grandit depuis le point touché (Linear Modal, Morphing Dialog) ; fermée, sa
     forme vide y repart. Depuis le 21/11, plus rien ne vole à sa place.
   - glisseur : une surbrillance qui suit la souris d'une ligne à l'autre, au
     lieu de sauter (Motion Highlight, Animated Background).
   - repère : le fond de l'onglet choisi glisse de l'ancien au nouveau.
   - repli du menu : la page glisse en transform au lieu de recalculer sa
     largeur à chaque image.
   Mouvement réduit : rien ne vole ni ne glisse, l'état change d'un coup.
   ========================================================================== */

(function () {
  'use strict';

  var mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var souris = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  function reduit() { return Boolean(mq && mq.matches); }
  function peutAnimer(el) { return !reduit() && el && typeof el.animate === 'function'; }

  // Les trois courbes de la console (pinlane.css) : on part vite et on se pose.
  var SORTIE = 'cubic-bezier(0.23, 1, 0.32, 1)';
  var GLISSE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  // Les animations des gestes portent cet id : elles naissent juste après le rendu du geste,
  // exprès, et le nettoyage des rendus (terminerAnimationsDuRendu, app-main.js) les laisse jouer.
  var ID = 'pl-mouvement';

  function boite(el) {
    if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return null;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }
  function aLEcran(b) {
    return Boolean(b) && b.top + b.height > 0 && b.top < window.innerHeight && b.left + b.width > 0 && b.left < window.innerWidth;
  }

  // Un calque fixe, vide, sans id ni texte : invisible aux sélecteurs et aux lecteurs d'écran.
  function calque(classe) {
    var el = document.createElement('div');
    el.className = 'pl-calque ' + classe;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }
  function poser(el, b) {
    el.style.width = b.width + 'px';
    el.style.height = b.height + 'px';
  }
  function placement(b, base) {
    return 'translate(' + b.left + 'px, ' + b.top + 'px) scale(' + (b.width / base.width) + ', ' + (b.height / base.height) + ')';
  }
  function retirerALaFin(animation, el) {
    var fin = function () { if (el.isConnected) el.remove(); };
    animation.onfinish = fin;
    animation.oncancel = fin;
    // (un onglet en arrière-plan peut ne jamais finir l'animation)
    setTimeout(fin, 2000);
  }

  // ---- VOLER ----------------------------------------------------------------
  // Une forme vide (le fond, le bord et l'ombre de la fenêtre qu'elle annonce)
  // part du rectangle `de` et se pose sur `vers`. `retour` : elle part de `de`
  // et s'efface en s'approchant de `vers`.
  function voler(de, vers, o) {
    o = o || {};
    if (reduit() || !de || !vers) return null;
    var base = o.retour ? de : vers;
    var el = calque('pl-vol' + (o.classe ? ' ' + o.classe : ''));
    poser(el, base);
    if (o.rayon) el.style.borderRadius = o.rayon;
    var etapes = o.retour
      ? [{ transform: placement(de, base), opacity: 1 }, { transform: placement(vers, base), opacity: 0 }]
      : [{ transform: placement(de, base), opacity: o.opaciteDepart == null ? 0.5 : o.opaciteDepart }, { transform: placement(vers, base), opacity: 1 }];
    var a = el.animate(etapes, { duration: o.duree || 280, easing: o.courbe || GLISSE, fill: 'forwards' });
    if (o.retour) { retirerALaFin(a, el); return a; }
    // Posée, la forme s'efface sur la vraie fenêtre qui apparaît dessous.
    a.onfinish = function () {
      var b = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: o.effacement || 140, easing: 'linear', fill: 'forwards' });
      retirerALaFin(b, el);
    };
    a.oncancel = function () { el.remove(); };
    setTimeout(function () { if (el.isConnected) el.remove(); }, 2000);
    return a;
  }

  // Un voile qui s'éteint seul, à la place de celui qui vient de disparaître d'un coup.
  function voileQuiSEteint(duree) {
    if (reduit()) return null;
    var v = calque('pl-voile');
    retirerALaFin(v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duree || 180, easing: SORTIE, fill: 'forwards' }), v);
    return v;
  }

  // ---- LES FENETRES ---------------------------------------------------------
  // LA FENETRE SORT DE CE QU'ON A TOUCHÉ (2026-11-21). L'histoire, pour ne pas la refaire :
  // - 19/11 : une forme vide volait de la ligne à la fenêtre (300 ms, puis 140 ms de fondu)
  //   pendant que la vraie fenêtre restait à l'opacité 0 jusqu'à 273 ms. Le gérant (20/11) :
  //   « pas fluide du tout », « trop lente ». C'était le calque qui saccadait : une boîte de
  //   1100 px, son ombre de 56 px mise à l'échelle à chaque image.
  // - 20/11, 81022c5 : plus de calque, la fenêtre de 0,98 à 1 en 180 ms. Rapide, mais 2 % de
  //   1100 px ne se voient pas. Le gérant, le soir : « plus de motion du tout, partout ».
  // Désormais c'est la VRAIE fenêtre (jamais une copie) qui bouge, sur transform et opacity,
  // que le compositeur joue seul : elle grandit de 0,9 à 1 en 240 ms depuis le point touché
  // (transform-origin), avec un pas vers lui. Son opacité, à part, est pleine en 60 ms : à
  // 30 ms elle laissait voir le planning à travers elle, un dédoublement que le gérant refuse.
  // Au téléphone elle monte du bas. Ouverte par le code (l'adresse, un test, un rendu), sans
  // toucher, elle se fond à sa vraie taille : rien ne dit d'où elle viendrait, et une mesure
  // faite pendant son entrée reste juste.
  var DERNIERE_FERMEE = -1e9;
  function reouverture() { return performance.now() - DERNIERE_FERMEE < 300; }
  var OUVERTURE = 240;
  var OUVERTURE_TELEPHONE = 260;
  var OPACITE = 60;
  var FERMETURE = 160;
  var ECHELLE_DEPART = 0.9;
  function telephone() { return Boolean(window.matchMedia) && window.matchMedia('(max-width: 860px)').matches; }

  // Le dernier vrai toucher (souris, doigt, stylet), ou la touche Entrée ou Espace sur ce qui a
  // le focus. Lu seulement quand une fenêtre s'ouvre dans la demi-seconde qui suit.
  var touche = null;
  function noterAppui(event) {
    if (event.isTrusted) touche = { x: event.clientX, y: event.clientY, t: performance.now() };
  }
  function noterTouche(event) {
    if (event.isTrusted && (event.key === 'Enter' || event.key === ' ')) touche = { el: event.target, t: performance.now() };
  }
  function pointTouche() {
    var t = touche;
    touche = null;
    if (!t || performance.now() - t.t > 600) return null;
    if (!t.el) return { x: t.x, y: t.y };
    var b = boite(t.el);
    return b && aLEcran(b) ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  }
  function borne(v, max) { return Math.max(-max, Math.min(max, v)); }

  // La fenêtre qui part et son voile (fermerFenetre) : la suivante qui s'ouvre les retire d'abord.
  var partantes = [];
  function acheverLesSorties() {
    var liste = partantes;
    partantes = [];
    liste.forEach(function (el) { if (el && el.isConnected) el.remove(); });
  }

  // La fenêtre naît du point `p` (coordonnées de l'écran) : de `d.echelle` à elle-même, sur
  // transform seul (son opacité se joue à part). Au téléphone elle monte du bas, sa taille ne
  // change jamais (elle prend tout l'écran : 0,9 de l'écran se lirait comme une autre fenêtre).
  function naitre(surface, p, d) {
    var etapes;
    if (telephone()) {
      var monte = Math.round(Math.min(64, window.innerHeight * 0.07) * d.montee);
      etapes = [{ transform: 'translateY(' + monte + 'px)' }, { transform: 'translateY(0px)' }];
    } else {
      // La seule mesure de l'ouverture : la boîte de la fenêtre qu'on vient de peindre.
      var b = boite(surface);
      if (!b) return null;
      surface.style.transformOrigin = Math.round(p.x - b.left) + 'px ' + Math.round(p.y - b.top) + 'px';
      // (un pas vers le point touché, en plus de l'échelle qui s'y ramène : 16 px au plus)
      var dx = Math.round(borne((p.x - (b.left + b.width / 2)) * 0.06, 16));
      var dy = Math.round(borne((p.y - (b.top + b.height / 2)) * 0.06, 16));
      etapes = [
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + d.echelle + ')' },
        { transform: 'translate(0px, 0px) scale(1)' },
      ];
    }
    var a = surface.animate(etapes, { id: ID, duration: telephone() ? OUVERTURE_TELEPHONE : OUVERTURE, easing: SORTIE });
    a.onfinish = a.oncancel = function () { surface.style.transformOrigin = ''; };
    return a;
  }

  // `voileEl` : le fond qui assombrit la page ; `surface` : la fenêtre, déjà peinte et lisible.
  function ouvrirFenetre(voileEl, surface) {
    acheverLesSorties();
    var p = pointTouche();
    if (!peutAnimer(surface) || reouverture()) return null;
    // L'opacité, à part de l'échelle : pleine en 60 ms. La fenêtre est DANS son voile, qui se
    // fond donc avec elle et pas plus lentement : un voile à 0,65 la laissait à 0,65 elle aussi.
    var fondu = voileEl && voileEl !== surface && typeof voileEl.animate === 'function' ? voileEl : surface;
    fondu.animate([{ opacity: 0 }, { opacity: 1 }], { id: ID, duration: OPACITE, easing: SORTIE });
    // (le point reste sur le fond, que les rendus de la fenêtre gardent : elle y repartira)
    if (voileEl) voileEl._plPoint = p;
    if (!p) return null;
    return naitre(surface, p, { echelle: ECHELLE_DEPART, montee: 1 });
  }

  // MODIFIER S'OUVRE DEPUIS SON ONGLET : la fiche, devenue plus grande d'un coup (sa mise en
  // page), en grandit depuis l'onglet touché, de 0,94 à elle-même, opaque d'un bout à l'autre.
  function grandirFenetre(surface) {
    var p = pointTouche();
    if (!p || !peutAnimer(surface)) return null;
    return naitre(surface, p, { echelle: 0.94, montee: 0.5 });
  }

  // La fenêtre va disparaître d'un coup (l'appelant cache son fond et la vide juste après) :
  // sa forme, vide, reste à sa place et repart en 160 ms vers là d'où la fenêtre était née
  // (0,95 et un fondu ; au téléphone elle redescend), le voile s'éteint. Rien n'attend : le fond
  // est fermé, le focus rendu, l'état écrit dès cet appel. (Faire partir la VRAIE fenêtre
  // demande de la reposer ailleurs dans la page : mesuré le 21/11 à CPU x4, l'image suivante
  // tombait 0,5 à 1,4 s plus tard, contre 40 à 125 ms ; la forme vide, elle, ne coûte rien.)
  function fermerFenetre(surface) {
    DERNIERE_FERMEE = performance.now();
    acheverLesSorties();
    if (!peutAnimer(surface) || !surface.isConnected) return;
    var depuis = boite(surface);
    if (!depuis || !aLEcran(depuis)) return;
    partantes.push(voileQuiSEteint(FERMETURE));
    var fond = surface.parentElement;
    var p = fond && fond._plPoint;
    var style = getComputedStyle(surface);
    var forme = calque('pl-vol pl-sortie');
    poser(forme, depuis);
    forme.style.left = depuis.left + 'px';
    forme.style.top = depuis.top + 'px';
    forme.style.borderRadius = style.borderRadius;
    forme.style.background = style.backgroundColor;
    forme.style.transformOrigin = p ? Math.round(p.x - depuis.left) + 'px ' + Math.round(p.y - depuis.top) + 'px' : '50% 50%';
    var fin = telephone() ? 'translateY(' + Math.round(Math.min(40, window.innerHeight * 0.045)) + 'px)' : 'scale(0.95)';
    var a = forme.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: fin }], { id: ID, duration: FERMETURE, easing: SORTIE, fill: 'forwards' });
    partantes.push(forme);
    retirerALaFin(a, forme);
  }

  // ---- LE GLISSEUR ----------------------------------------------------------
  // Une surbrillance par famille (lignes du planning, entrées du menu) : elle glisse
  // d'un élément survolé au suivant, et s'éteint quand la souris quitte la famille.
  // L'élément garde son survol CSS quand le glisseur n'est pas là (doigt, mouvement réduit).
  var glisseurs = [];
  function glisseur(selecteur, o) {
    o = o || {};
    var g = { selecteur: selecteur, classe: o.classe || '', el: null, sur: null, boite: null, timer: 0, marge: o.marge || 0 };
    glisseurs.push(g);
    return g;
  }
  function eteindre(g, vite) {
    if (!g.el || !g.sur) return;
    g.sur = null;
    g.boite = null;
    g.el.animate([{ opacity: Number(getComputedStyle(g.el).opacity) }, { opacity: 0 }], { duration: vite ? 1 : 140, easing: 'linear', fill: 'forwards' });
  }
  function allumer(g, cible) {
    var b = boite(cible);
    if (!b) return;
    if (g.marge) b = { left: b.left + g.marge, top: b.top + g.marge, width: b.width - 2 * g.marge, height: b.height - 2 * g.marge };
    if (!g.el || !g.el.isConnected) {
      g.el = calque('pl-surbrillance' + (g.classe ? ' ' + g.classe : ''));
    }
    var avant = g.sur && g.boite;
    poser(g.el, b);
    if (avant) {
      g.el.animate([
        { transform: placement(g.boite, b), opacity: 1 },
        { transform: placement(b, b), opacity: 1 },
      ], { duration: 160, easing: GLISSE, fill: 'forwards' });
    } else {
      g.el.animate([
        { transform: placement(b, b), opacity: 0 },
        { transform: placement(b, b), opacity: 1 },
      ], { duration: 120, easing: 'linear', fill: 'forwards' });
    }
    g.sur = cible;
    g.boite = b;
  }
  function survol(event) {
    if (reduit() || !(souris && souris.matches) || !glisseurs.length) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    for (var i = 0; i < glisseurs.length; i++) {
      var g = glisseurs[i];
      var cible = t.closest(g.selecteur);
      if (cible) {
        clearTimeout(g.timer);
        if (cible !== g.sur) allumer(g, cible);
      } else if (g.sur) {
        clearTimeout(g.timer);
        g.timer = setTimeout(eteindre.bind(null, g, false), 60);
      }
    }
  }
  // Un défilement déplace les lignes sous un calque fixe : il s'éteint sans attendre.
  function defilement() { for (var i = 0; i < glisseurs.length; i++) eteindre(glisseurs[i], true); }

  // ---- LE REPERE D'ONGLET ---------------------------------------------------
  // Le fond de l'onglet choisi glisse de l'ancien au nouveau (Animated Background,
  // Fluid Tabs). `groupe` : le conteneur, qui ne se redessine pas ; `actif` : l'onglet
  // choisi. On mesure avant le clic, puis après le rendu. Le repère vit DANS le groupe,
  // derrière les libellés, le temps du voyage ; posé, l'onglet reprend son propre fond.
  var reperes = [];
  // `o.trait` : l'onglet choisi est souligné, c'est le trait qui glisse (au lieu du fond).
  function repere(groupe, actif, o) { reperes.push({ groupe: groupe, actif: actif, o: o || {} }); }
  function relatif(b, cadre) { return { left: b.left - cadre.left, top: b.top - cadre.top, width: b.width, height: b.height }; }
  // Le rendu du geste a pu redessiner tout le groupe : on reprend celui qui occupe la même place,
  // ou le seul de son espèce à l'écran (la fiche grandit en passant à Modifier : sa barre
  // d'onglets remonte de 140 px avec elle).
  function retrouver(selecteur, b) {
    var meilleur = null;
    var ecart = Infinity;
    var visibles = [];
    document.querySelectorAll(selecteur).forEach(function (el) {
      var c = boite(el);
      if (!c) return;
      visibles.push(el);
      var e = Math.abs(c.left - b.left) + Math.abs(c.top - b.top);
      if (e < ecart) { ecart = e; meilleur = el; }
    });
    if (ecart < 48) return meilleur;
    return visibles.length === 1 ? visibles[0] : null;
  }
  function couleurDuTrait(el) {
    var apres = getComputedStyle(el, '::after');
    if (apres && apres.content !== 'none' && apres.backgroundColor && apres.backgroundColor !== 'rgba(0, 0, 0, 0)') return apres.backgroundColor;
    var bord = getComputedStyle(el).borderBottomColor;
    return bord && bord !== 'rgba(0, 0, 0, 0)' ? bord : 'var(--accent)';
  }
  function lancerRepere(r, conteneur, ancien, bAncien, cadreAvant) {
    var g = conteneur.isConnected ? conteneur : retrouver(r.groupe, cadreAvant);
    if (!g) return;
    var nouveau = g.querySelector(r.actif);
    var cadre = boite(g);
    var b = boite(nouveau);
    if (!nouveau || !cadre || !b) return;
    // L'ancien choisi se reprend à sa place DANS le groupe : si le groupe a bougé avec sa
    // fenêtre, le repère glisse le long de la barre, pas en travers de l'écran.
    bAncien = { left: bAncien.left + cadre.left - cadreAvant.left, top: bAncien.top + cadre.top - cadreAvant.top, width: bAncien.width, height: bAncien.height };
    if (Math.abs(b.left - bAncien.left) < 1 && Math.abs(b.top - bAncien.top) < 1) return;
    var trait = Boolean(r.o.trait);
    var de = bAncien;
    var vers = b;
    var el = document.createElement('span');
    el.className = 'pl-repere' + (trait ? ' is-trait' : '');
    el.setAttribute('aria-hidden', 'true');
    if (trait) {
      var epais = r.o.epaisseur || 2;
      var retrait = r.o.retrait || 0;
      var bas = r.o.bas || 0;
      de = { left: bAncien.left + retrait, top: bAncien.top + bAncien.height - epais + bas, width: bAncien.width - 2 * retrait, height: epais };
      vers = { left: b.left + retrait, top: b.top + b.height - epais + bas, width: b.width - 2 * retrait, height: epais };
      el.style.background = couleurDuTrait(nouveau);
      el.style.borderRadius = epais + 'px';
    } else {
      var style = getComputedStyle(nouveau);
      el.style.borderRadius = style.borderRadius;
      el.style.background = style.backgroundColor;
      el.style.boxShadow = style.boxShadow;
      if (parseFloat(style.borderTopWidth) > 0) el.style.border = style.borderTopWidth + ' ' + style.borderTopStyle + ' ' + style.borderTopColor;
    }
    el.style.width = vers.width + 'px';
    el.style.height = vers.height + 'px';
    g.appendChild(el);
    g.classList.add('pl-repere-voyage');
    nouveau.setAttribute('data-pl-repere-actif', trait ? 'trait' : 'fond');
    var a = el.animate([
      { transform: placement(relatif(de, cadre), vers) },
      { transform: placement(relatif(vers, cadre), vers) },
    ], { id: ID, duration: r.o.duree || 240, easing: GLISSE, fill: 'forwards' });
    var fin = function () {
      g.classList.remove('pl-repere-voyage');
      if (nouveau.isConnected) nouveau.removeAttribute('data-pl-repere-actif');
      if (el.isConnected) el.remove();
    };
    a.onfinish = fin;
    a.oncancel = fin;
    setTimeout(fin, 1500);
  }
  function avantClic(event) {
    if (reduit() || !reperes.length) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    reperes.forEach(function (r) {
      var conteneur = t.closest(r.groupe);
      if (!conteneur) return;
      var ancien = conteneur.querySelector(r.actif);
      var bAncien = boite(ancien);
      var cadreAvant = boite(conteneur);
      if (!bAncien || !cadreAvant) return;
      // Après le geste et son rendu : le nouvel onglet choisi.
      requestAnimationFrame(function () { lancerRepere(r, conteneur, ancien, bAncien, cadreAvant); });
    });
  }

  // ---- LE REPLI DU MENU -----------------------------------------------------
  // `avant` : la position de la page avant le repli. La page a déjà sa nouvelle largeur
  // (une seule mise en page) ; elle glisse de son ancienne place à la nouvelle.
  function glisserDepuis(el, avantGauche) {
    if (!peutAnimer(el) || avantGauche == null) return;
    var b = boite(el);
    if (!b) return;
    var dx = avantGauche - b.left;
    if (Math.abs(dx) < 1) return;
    el.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { id: ID, duration: 240, easing: GLISSE });
  }

  // Le corps dit si les glisseurs sont là : sans eux (doigt, mouvement réduit), chaque
  // ligne garde son survol CSS ; avec eux, c'est la surbrillance qui glisse qui le donne.
  function marquerCorps() {
    if (!document.body) return;
    document.body.classList.toggle('pl-glisse', !reduit() && Boolean(souris && souris.matches));
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', noterAppui, { capture: true, passive: true });
    document.addEventListener('keydown', noterTouche, true);
    document.addEventListener('pointerover', survol, { passive: true });
    document.addEventListener('pointerleave', function () { glisseurs.forEach(function (g) { eteindre(g, false); }); }, { passive: true });
    window.addEventListener('scroll', defilement, { passive: true, capture: true });
    document.addEventListener('click', avantClic, true);
    document.addEventListener('click', avantGeste, true);
    window.addEventListener('click', apresLeGeste);
    document.addEventListener('click', resumeTouche, true);
    document.addEventListener('toggle', deplie, true);
    if (document.body) marquerCorps(); else document.addEventListener('DOMContentLoaded', marquerCorps);
    [mq, souris].forEach(function (m) { if (m && typeof m.addEventListener === 'function') m.addEventListener('change', marquerCorps); });
  }


  // ---- DES BLOCS QUI ENTRENT ------------------------------------------------
  // Un fondu et quelques pixels, en cascade : la page qu'on ouvre, le jour qu'on change,
  // l'onglet de la fiche. `translate` (la propriété seule) s'ajoute à ce qui place déjà
  // l'élément, sans le remplacer. Les blocs hors de l'écran ne bougent pas.
  function entrer(els, o) {
    o = o || {};
    var pas = o.pas == null ? 40 : o.pas;
    var dx = o.dx || 0;
    var dy = o.dy == null ? 12 : o.dy;
    var n = 0;
    Array.prototype.forEach.call(els || [], function (el) {
      if (n >= (o.max || 8) || !peutAnimer(el)) return;
      var b = boite(el);
      if (!b || !aLEcran(b)) return;
      el.animate([{ opacity: 0, translate: dx + 'px ' + dy + 'px' }, { opacity: 1, translate: '0px 0px' }], { id: ID, duration: o.duree || 340, delay: n * pas, easing: SORTIE, fill: 'backwards' });
      n += 1;
    });
  }
  function enfantsVisibles(racine) {
    if (!racine) return [];
    return Array.prototype.filter.call(racine.children, function (c) { return !c.classList.contains('hidden') && !c.classList.contains('pl-repere') && Boolean(boite(c)); });
  }
  // Une page qui joue déjà son entrée (les pages v2, pv2-enter) ne reçoit pas la nôtre.
  function dejaEnMouvement(racine) {
    return document.getAnimations().some(function (a) {
      var t = a.effect && a.effect.target;
      return Boolean(t) && t.nodeType === 1 && racine.contains(t) && a.playState === 'running' && !(a.effect.getComputedTiming().iterations === Infinity);
    });
  }

  // ---- APRES LE GESTE --------------------------------------------------------
  // Une page ouverte, un autre jour, un autre onglet : le mouvement se joue une fois que le
  // geste a redessiné la console. Un écouteur de clic posé sur window passe après ceux de la
  // console et avant que l'image soit peinte : l'entrée part de la bonne première image, sans
  // éclair. (Un gestionnaire qui arrête le clic : pas de mouvement, rien ne casse.)
  var gestes = [];
  var enAttente = [];
  function apresGeste(selecteur, avant, apres) { gestes.push({ s: selecteur, avant: avant, apres: apres }); }
  function avantGeste(event) {
    enAttente = [];
    if (reduit()) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    gestes.forEach(function (g) {
      var cible = t.closest(g.s);
      if (cible) enAttente.push({ g: g, cible: cible, mesure: g.avant ? g.avant(cible) : null });
    });
    // Le menu arrête ses clics (stopPropagation) : ils n'atteignent jamais window. Le relais
    // passe à l'image suivante, avant qu'elle soit peinte ; si window a déjà joué, il n'a rien.
    if (enAttente.length) requestAnimationFrame(apresLeGeste);
  }
  function apresLeGeste() {
    var liste = enAttente;
    enAttente = [];
    liste.forEach(function (p) { try { p.g.apres(p.cible, p.mesure); } catch (e) { /* le mouvement ne casse jamais un geste */ } });
  }
  function etat() { return typeof state !== 'undefined' && state ? state : {}; }
  function pageCourante() { var s = etat(); return [s.view, s.staffMenuPage, s.staffResourceView].join('|'); }
  var PLANNINGS = '#globalPlanningBox:not(.hidden), #planningBox:not(.hidden), #laserPlanningBox:not(.hidden)';

  // La page qu'on ouvre depuis le menu : ses blocs montent en cascade.
  apresGeste('[data-fgx-menu-key]', pageCourante, function (cible, avant) {
    if (pageCourante() === avant) return;
    var wrap = document.querySelector('#staffView .staff-wrap');
    if (!wrap || dejaEnMouvement(wrap)) return;
    var blocs = enfantsVisibles(wrap);
    if (blocs.length === 1) blocs = enfantsVisibles(blocs[0]);
    entrer(blocs, { dy: 16, pas: 45, duree: 380, max: 6 });
  });
  // Complet, Bowling, Laser : le planning choisi monte doucement.
  apresGeste('.pb-seg__b', pageCourante, function (cible, avant) {
    if (pageCourante() === avant) return;
    entrer(document.querySelectorAll(PLANNINGS), { dy: 10, duree: 300, max: 1 });
  });
  // Un autre jour : le planning glisse dans le sens du temps, le jour écrit roule.
  function glisserJour(sens) {
    var cible = document.querySelector(PLANNINGS) || document.querySelector('#staffDashboardPage:not(.hidden)');
    if (cible && peutAnimer(cible)) cible.animate([{ opacity: 0.15, translate: (sens * 32) + 'px 0px' }, { opacity: 1, translate: '0px 0px' }], { id: ID, duration: 320, easing: SORTIE });
    document.querySelectorAll('#staffDateShort, #staffDateLabel').forEach(function (el) {
      if (peutAnimer(el) && boite(el)) el.animate([{ opacity: 0, translate: '0px ' + (sens * 9) + 'px' }, { opacity: 1, translate: '0px 0px' }], { id: ID, duration: 280, easing: SORTIE });
    });
  }
  apresGeste('#staffPrevDateBtn, #staffNextDateBtn, .staff-today-btn, .staff-cal-day', function () { return etat().currentDate; }, function (cible, avant) {
    var apres = etat().currentDate;
    if (!apres || !avant || apres === avant) return;
    glisserJour(apres > avant ? 1 : -1);
  });
  // Infos, Modifier : le contenu de la fiche arrive du côté de l'onglet choisi.
  var ONGLETS = ['details', 'modifier'];
  apresGeste('.dossier-tabs .tab', function () { return etat().activeTab; }, function (cible, avant) {
    var apres = etat().activeTab;
    if (!apres || apres === avant) return;
    if (apres === 'modifier') grandirFenetre(document.querySelector('#posOverlay:not(.hidden) .edit-modal'));
    var sens = ONGLETS.indexOf(apres) >= ONGLETS.indexOf(avant) ? 1 : -1;
    entrer(enfantsVisibles(document.querySelector('#posOverlay .edit-modal-body')), { dx: sens * 18, dy: 0, pas: 30, duree: 280, max: 6 });
  });
  // Les filtres du planning complet et les onglets des clients : les lignes arrivent en cascade.
  apresGeste('#planningBande button.gf-c', function () { return etat().staffStatusFilter; }, function (cible, avant) {
    if (etat().staffStatusFilter === avant) return;
    entrer(document.querySelectorAll('.gf-t tr.gf-r'), { dy: 8, pas: 18, duree: 260, max: 12 });
  });
  apresGeste('.crm-seg', function () { return etat().staffClientSegment; }, function () {
    entrer(document.querySelectorAll('#staffClientsPage .crm-table tbody tr'), { dy: 8, pas: 20, duree: 260, max: 12 });
  });
  // Arrivé, payé : le geste le plus fréquent de la journée dit qu'il a été entendu. Une onde
  // de la couleur du nouvel état passe sur la ligne (un calque, la ligne ne bouge pas). Rien
  // n'attend : l'état est déjà écrit quand l'onde part.
  function onde(ligne) {
    var b = boite(ligne);
    if (!b || !aLEcran(b)) return;
    var teinte = (getComputedStyle(ligne).getPropertyValue('--bk-barre') || '').trim() || 'var(--accent)';
    var c = calque('pl-onde');
    poser(c, b);
    c.style.transform = 'translate(' + b.left + 'px, ' + b.top + 'px)';
    c.style.background = 'color-mix(in srgb, ' + teinte + ' 22%, transparent)';
    var a = c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    a.onfinish = a.oncancel = function () { c.remove(); };
  }
  apresGeste('[data-gf-arrive], [data-gf-payer]', function (cible) {
    var l = cible.closest('[data-gf-id]');
    return l ? l.getAttribute('data-gf-id') : null;
  }, function (cible, id) {
    if (!id) return;
    var cle = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
    var ligne = document.querySelector('.gf-t tr.gf-r[data-gf-id="' + cle + '"]');
    // (rien sur la ligne elle-même : la réponse du serveur la repeint aussitôt, une animation
    // posée dessus disparaîtrait avec elle ; le calque, lui, ne dépend d'aucun rendu)
    if (ligne && peutAnimer(ligne)) onde(ligne);
  });

  // ---- CE QUI SE DEPLIE --------------------------------------------------------
  // « Détail du calcul », « Téléphone, e-mail, occasion »… : ouvert par un geste, le contenu
  // descend en cascade. Un <details> recréé ouvert par un rendu (il déclenche aussi `toggle`)
  // ne bouge pas : seul le clic sur son résumé le marque. La cascade part à l'image suivante,
  // une fois passés les gestionnaires du dépliant : « Historique » ne remplit son corps que
  // dans son propre `ontoggle`, vide (0 px) au moment où nous l'entendons.
  var depliesParGeste = typeof WeakSet === 'function' ? new WeakSet() : null;
  function resumeTouche(event) {
    var s = event.target && event.target.closest && event.target.closest('summary');
    if (s && depliesParGeste && s.parentElement && s.parentElement.tagName === 'DETAILS') depliesParGeste.add(s.parentElement);
  }
  function deplie(event) {
    var d = event.target;
    if (!d || d.tagName !== 'DETAILS' || !depliesParGeste || !depliesParGeste.has(d)) return;
    depliesParGeste.delete(d);
    if (!d.open || reduit()) return;
    requestAnimationFrame(function () {
      if (!d.open || !d.isConnected) return;
      entrer(Array.prototype.filter.call(d.children, function (c) { return c.tagName !== 'SUMMARY'; }), { dy: -6, pas: 30, duree: 240, max: 6 });
    });
  }

  // ---- LES PETITS MENUS ------------------------------------------------------
  // Un menu né d'un bouton en descend (ou y monte s'il s'ouvre au-dessus) : 6 px et un fondu.
  function surgir(pop, ancre) {
    if (!peutAnimer(pop)) return;
    var b = boite(pop);
    var a = boite(ancre);
    var dessus = Boolean(a && b) && b.top + b.height <= a.top + 2;
    pop.animate([{ opacity: 0, translate: '0px ' + (dessus ? 6 : -6) + 'px' }, { opacity: 1, translate: '0px 0px' }], { id: ID, duration: 170, easing: SORTIE });
  }

  // ---- LE TOAST --------------------------------------------------------------
  // Une mèche sous le message dit le temps qui reste ; un message qui en remplace un autre fait
  // un petit saut ; le toast sort en glissant au lieu de s'éteindre net. Sa disparition n'est
  // pas un état : elle tombe 160 ms plus tard, rien d'autre n'attend.
  var sortieToast = null;
  function mecheDe(el) { return el && el.querySelector('.pl-meche'); }
  function toastMeche(el, duree) {
    if (!el || reduit()) return;
    var m = mecheDe(el);
    if (!m) {
      m = document.createElement('span');
      m.className = 'pl-meche';
      m.setAttribute('aria-hidden', 'true');
      el.appendChild(m);
    }
    if (typeof m.animate !== 'function') return;
    var depart = 1;
    if (m._plA) {
      var mm = /matrix\(([^,]+)/.exec(getComputedStyle(m).transform || '');
      if (mm) depart = Math.max(0, Math.min(1, Number(mm[1])));
      m._plA.cancel();
    }
    m._plA = m.animate([{ transform: 'scaleX(' + depart + ')' }, { transform: 'scaleX(0)' }], { duration: duree, easing: 'linear', fill: 'forwards' });
  }
  function toastPause(el) { var m = mecheDe(el); if (m && m._plA) m._plA.pause(); }
  function toastMontre(el, duree, remplace) {
    if (!el) return;
    if (sortieToast) { sortieToast.cancel(); sortieToast = null; }
    toastMeche(el, duree);
    if (remplace && peutAnimer(el)) el.animate([{ opacity: 0.4, translate: '0px 5px', scale: '0.98' }, { opacity: 1, translate: '0px 0px', scale: '1' }], { duration: 200, easing: SORTIE });
  }
  function toastSortie(el, fin) {
    if (!el || !peutAnimer(el) || el.classList.contains('hidden')) { fin(); return; }
    var a = el.animate([{ opacity: 1, translate: '0px 0px' }, { opacity: 0, translate: '0px 10px' }], { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    sortieToast = a;
    // Un onglet caché ne rend plus ses animations (onfinish attendrait son retour) : la minuterie
    // cache le toast quand même. Un nouveau message entre-temps annule la sortie et les deux.
    var fini = false;
    function finir() {
      if (fini || sortieToast !== a) return;
      fini = true;
      sortieToast = null;
      fin();
      a.cancel();
    }
    a.onfinish = finir;
    setTimeout(finir, 260);
  }

  // Les familles de la console.
  glisseur('.ops-sidebar .fgx-menu-item, .ops-sidebar .fgx-menu-subitem', { classe: 'is-menu' });
  glisseur('.gf-t tr.gf-r:not(.gf-retenue)', { classe: 'is-ligne' });
  repere('.pb-seg', '.pb-seg__b.active');
  // (vague 2 : la tuile choisie de l'accueil, les onglets de la fiche, les joueurs et le jour de
  // Réserver, les onglets soulignés des clients, la page choisie dans le menu)
  repere('.plt-tuiles', '.plt-tuile.is-on');
  repere('.dossier-tabs', '.tab.active');
  repere('.rs-ns', '.rs-n.is-on');
  repere('.rs-seg', 'button.is-on, .rs-seg-date.is-on');
  repere('.crm-segbar', '.crm-seg.is-active', { trait: true, retrait: 10, bas: 1 });
  repere('.fgx-menu-nav', '[data-fgx-menu-key].active');
  glisseur('#resList article.res-row.gc', { classe: 'is-carte' });
  glisseur('#staffClientsPage .crm-table tbody tr', { classe: 'is-ligne' });
  glisseur('button.em-row.pv2-thread-row', { classe: 'is-ligne' });
  glisseur('.bdg-lignes > li', { classe: 'is-ligne' });

  window.PlMouvement = {
    voler: voler,
    ouvrirFenetre: ouvrirFenetre,
    fermerFenetre: fermerFenetre,
    glisserDepuis: glisserDepuis,
    surgir: surgir,
    entrer: entrer,
    toastMontre: toastMontre,
    toastMeche: toastMeche,
    toastPause: toastPause,
    toastSortie: toastSortie,
    glisseur: glisseur,
    repere: repere,
    reduit: reduit,
  };
}());
