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

   - voler : une forme vide part d'un rectangle et se pose sur un autre. La
     fiche naît de la ligne touchée et s'y range en se fermant ; Réserver naît
     de son bouton (Linear Modal, Morphing Dialog).
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
    if (reduit()) return;
    var v = calque('pl-voile');
    retirerALaFin(v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duree || 180, easing: SORTIE, fill: 'forwards' }), v);
  }

  // ---- LES FENETRES ---------------------------------------------------------
  // `surface` : la boîte de la fenêtre (la fiche, Réserver). `origine` : ce qui a été touché.
  // La fenêtre est déjà peinte et lisible ; on la fait apparaître pendant que la forme vole.
  function ouvrirFenetre(voileEl, surface, origine, o) {
    o = o || {};
    if (!peutAnimer(surface)) return;
    var cible = boite(surface);
    if (!cible) return;
    var depuis = boite(origine);
    if (voileEl && voileEl !== surface && typeof voileEl.animate === 'function') {
      voileEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: SORTIE });
    }
    if (depuis && aLEcran(depuis) && !(depuis.width >= cible.width * 0.9 && depuis.height >= cible.height * 0.9)) {
      // La forme vole de la ligne à la fenêtre ; le contenu se pose à son arrivée.
      voler(depuis, cible, { rayon: getComputedStyle(surface).borderRadius, duree: o.duree || 300 });
      surface.animate([{ opacity: 0 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }], { duration: (o.duree || 300) + 140, easing: 'linear' });
      return;
    }
    // Sans origine visible (ouverture par l'adresse, par un test) : elle apparaît en fondu, à sa
    // vraie taille. Jamais de transform sur la vraie fenêtre : sous scale(0.97), une mesure faite
    // pendant l'entrée lisait 38,8 px pour une photo de 40 (fiche-simple au téléphone, 19/11).
    surface.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: SORTIE });
  }

  // La fenêtre va disparaître d'un coup (l'appelant la cache juste après) : sa forme se range
  // dans ce qui l'avait ouverte, ou s'efface sur place, et le voile s'éteint.
  function fermerFenetre(surface, origine) {
    if (reduit()) return;
    var depuis = boite(surface);
    if (!depuis) return;
    voileQuiSEteint(170);
    var rayon = getComputedStyle(surface).borderRadius;
    var vers = boite(origine);
    if (vers && aLEcran(vers)) {
      voler(depuis, vers, { retour: true, rayon: rayon, duree: 240, courbe: GLISSE });
      return;
    }
    var petit = {
      left: depuis.left + depuis.width * 0.015, top: depuis.top + depuis.height * 0.015 + 6,
      width: depuis.width * 0.97, height: depuis.height * 0.97,
    };
    voler(depuis, petit, { retour: true, rayon: rayon, duree: 160, courbe: SORTIE });
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
  function repere(groupe, actif) { reperes.push({ groupe: groupe, actif: actif }); }
  function relatif(b, cadre) { return { left: b.left - cadre.left, top: b.top - cadre.top, width: b.width, height: b.height }; }
  function avantClic(event) {
    if (reduit() || !reperes.length) return;
    var t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    reperes.forEach(function (r) {
      var conteneur = t.closest(r.groupe);
      if (!conteneur) return;
      var ancien = conteneur.querySelector(r.actif);
      var bAncien = boite(ancien);
      if (!bAncien) return;
      // Après le geste et son rendu : le nouvel onglet choisi.
      requestAnimationFrame(function () {
        var nouveau = conteneur.isConnected && conteneur.querySelector(r.actif);
        var cadre = boite(conteneur);
        var b = boite(nouveau);
        if (!nouveau || !cadre || !b || nouveau === ancien && Math.abs(b.left - bAncien.left) < 1) return;
        var style = getComputedStyle(nouveau);
        var el = document.createElement('span');
        el.className = 'pl-repere';
        el.setAttribute('aria-hidden', 'true');
        el.style.width = b.width + 'px';
        el.style.height = b.height + 'px';
        el.style.borderRadius = style.borderRadius;
        el.style.background = style.backgroundColor;
        el.style.boxShadow = style.boxShadow;
        conteneur.appendChild(el);
        conteneur.classList.add('pl-repere-voyage');
        var a = el.animate([
          { transform: placement(relatif(bAncien, cadre), b) },
          { transform: placement(relatif(b, cadre), b) },
        ], { duration: 220, easing: GLISSE, fill: 'forwards' });
        var fin = function () { conteneur.classList.remove('pl-repere-voyage'); if (el.isConnected) el.remove(); };
        a.onfinish = fin;
        a.oncancel = fin;
        setTimeout(fin, 1500);
      });
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
    el.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { duration: 240, easing: GLISSE });
  }

  // Le corps dit si les glisseurs sont là : sans eux (doigt, mouvement réduit), chaque
  // ligne garde son survol CSS ; avec eux, c'est la surbrillance qui glisse qui le donne.
  function marquerCorps() {
    if (!document.body) return;
    document.body.classList.toggle('pl-glisse', !reduit() && Boolean(souris && souris.matches));
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerover', survol, { passive: true });
    document.addEventListener('pointerleave', function () { glisseurs.forEach(function (g) { eteindre(g, false); }); }, { passive: true });
    window.addEventListener('scroll', defilement, { passive: true, capture: true });
    document.addEventListener('click', avantClic, true);
    if (document.body) marquerCorps(); else document.addEventListener('DOMContentLoaded', marquerCorps);
    [mq, souris].forEach(function (m) { if (m && typeof m.addEventListener === 'function') m.addEventListener('change', marquerCorps); });
  }

  // Les familles de la console.
  glisseur('.ops-sidebar .fgx-menu-item, .ops-sidebar .fgx-menu-subitem', { classe: 'is-menu' });
  glisseur('.gf-t tr.gf-r:not(.gf-retenue)', { classe: 'is-ligne' });
  repere('.pb-seg', '.pb-seg__b.active');

  window.PlMouvement = {
    voler: voler,
    ouvrirFenetre: ouvrirFenetre,
    fermerFenetre: fermerFenetre,
    glisserDepuis: glisserDepuis,
    glisseur: glisseur,
    repere: repere,
    reduit: reduit,
  };
}());
