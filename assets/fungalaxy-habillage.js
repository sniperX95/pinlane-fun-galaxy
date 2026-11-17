/* ==========================================================================
   L HABILLAGE DU FORMULAIRE, POSE AVANT LE PREMIER AFFICHAGE (2026-11-17)

   La page de reservation est neutre : elle ne porte le nom, le logo ni les
   couleurs d aucun centre. Ce que le centre de l adresse montre (titre de
   l onglet, logo et son lien, couleurs) est une donnee, calculee par le
   serveur (lib/habillage-formulaire.js) et posee ici.

   Ce script est charge dans l en-tete, AVANT la feuille de style et sans
   attendre : rien ne s affiche tant qu il n a pas fini. Il pose l habillage
   depuis ce qu il a de plus sur, dans cet ordre :
     1. ce que le serveur a repondu a la derniere visite (garde dans le
        navigateur, par centre) ;
     2. sinon l instantane du centre, un petit fichier servi comme une image
        (/assets/habillage/<centre>.js, ecrit par scripts/habillage-instantanes.js).
        Un centre qui n en a pas reste neutre jusqu a la reponse du serveur.
   Le formulaire (fungalaxy-booking.js) repasse ensuite la reponse du serveur,
   qui fait foi et remplace le reste.

   Rien de ce qui est lu n est execute ni ecrit en HTML : des couleurs en
   hexadecimal, une adresse de logo du depot ou en https, un lien en https,
   des textes poses comme du texte.
   ========================================================================== */
(function () {
  'use strict';
  var doc = document;
  var racine = doc.documentElement;
  var params = new URLSearchParams(window.location.search);
  var HEX = /^#[0-9a-f]{6}$/i;
  var SLUG_RX = /^[a-z][a-z0-9-]{1,40}$/;
  var LOGO_RX = /^(?:https:\/\/[^\s"'<>]+|\/assets\/[a-z0-9_\/.-]+)$/i;
  var SITE_RX = /^https:\/\/[^\s"'<>]+$/i;

  // LE CENTRE DE L ADRESSE. La meme regle que fungalaxy-booking.js (centreDepuisAdresse) : le gate
  // habillage-centre compare les deux sur une table d adresses.
  function centreDepuisAdresse() {
    var m = window.location.pathname.match(/^\/(?:fungalaxy|reserver)\/([^/]+)\/?$/i);
    var brut = (m && m[1]) || params.get('center') || params.get('centerId') || '';
    try { brut = decodeURIComponent(brut); } catch (e) { /* adresse illisible : refusee plus bas */ }
    brut = String(brut).trim().toLowerCase();
    if (!brut) return /^\/fungalaxy\/?$/i.test(window.location.pathname) ? 'libramont' : 'demo';
    return SLUG_RX.test(brut) ? brut : 'centre-inconnu';
  }
  var CENTRE = centreDepuisAdresse();

  // Les sept couleurs que la feuille consomme, et les trois dont elle lit aussi les canaux
  // (pour ses fonds et ses halos translucides).
  var VARS = { accent: '--fg-purple', accentVif: '--fg-purple-2', accentEncre: '--fg-purple-ink', accentTitre: '--fg-purple-em', second: '--fg-teal', secondEncre: '--fg-teal-ink', secondSombre: '--fg-teal-dim' };
  var CANAUX = { accent: '--fg-purple-rvb', accentVif: '--fg-purple-2-rvb', second: '--fg-teal-rvb' };
  function canaux(hex) { return parseInt(hex.slice(1, 3), 16) + ', ' + parseInt(hex.slice(3, 5), 16) + ', ' + parseInt(hex.slice(5, 7), 16); }
  function texte(v, max) { return String(v == null ? '' : v).slice(0, max); }

  // Ne garde que ce qui a la forme attendue, d ou que vienne l objet.
  function lire(h) {
    if (!h || typeof h !== 'object') return null;
    var out = { titre: texte(h.titre, 140), carte: texte(h.carte, 60), logo: '', logoSurSombre: h.logoSurSombre === true, logoAlt: texte(h.logoAlt, 80), logoTaille: null, site: '', couleurs: null };
    if (typeof h.logo === 'string' && h.logo.length <= 300 && LOGO_RX.test(h.logo)) out.logo = h.logo;
    if (typeof h.site === 'string' && h.site.length <= 300 && SITE_RX.test(h.site)) out.site = h.site;
    var t = h.logoTaille;
    if (t && t.length === 2 && t[0] > 0 && t[1] > 0 && t[0] < 10000 && t[1] < 10000) out.logoTaille = [Math.round(t[0]), Math.round(t[1])];
    if (h.couleurs && typeof h.couleurs === 'object') {
      var c = {}, complet = true, k;
      for (k in VARS) { if (HEX.test(String(h.couleurs[k] || ''))) c[k] = String(h.couleurs[k]).toLowerCase(); else complet = false; }
      if (complet) out.couleurs = c;
    }
    return out;
  }

  function poserCouleurs(c) {
    var k;
    for (k in VARS) { if (c) racine.style.setProperty(VARS[k], c[k]); else racine.style.removeProperty(VARS[k]); }
    for (k in CANAUX) { if (c) racine.style.setProperty(CANAUX[k], canaux(c[k])); else racine.style.removeProperty(CANAUX[k]); }
  }

  // LE LOGO TIENT DANS LE BANDEAU QUELLE QUE SOIT SA FORME. La feuille lui donne 88 px de large et
  // 60 px de haut au plus. Un logo tout en longueur y serait minuscule : il s elargit jusqu a 170 px,
  // en gardant ses proportions. Un logo plus ramasse garde la largeur de la feuille.
  function mesurer(img) {
    var l = img.naturalWidth, h = img.naturalHeight;
    if (!(l > 0 && h > 0)) return;
    var large = Math.round(60 * l / h);
    img.style.width = large > 96 ? Math.min(170, large) + 'px' : '';
    if (courant && !courant.logoTaille) { courant.logoTaille = [l, h]; if (source === 'serveur') retenir(courant); }
  }

  var courant = null;
  var source = '';
  // Le bandeau n existe pas encore quand ce script s execute : `false` tant qu il n est pas la.
  function poserBandeau() {
    var lien = doc.querySelector('.fg-top__brand');
    if (!lien) return false;
    var img = lien.querySelector('.fg-top__logo');
    var h = courant;
    if (!h || !h.logo || !img) { lien.hidden = true; return true; }
    if (img.getAttribute('src') !== h.logo) {
      img.style.width = '';
      if (h.logoTaille) { img.width = h.logoTaille[0]; img.height = h.logoTaille[1]; } else { img.removeAttribute('width'); img.removeAttribute('height'); }
      img.onload = function () { mesurer(img); };
      img.src = h.logo;
    }
    img.alt = h.logoAlt;
    if (h.logoAlt) lien.setAttribute('aria-label', h.logoAlt); else lien.removeAttribute('aria-label');
    if (h.site) lien.href = h.site; else lien.removeAttribute('href');
    // Un logo dessine pour un fond clair recoit une plaque claire : le formulaire est sombre.
    lien.classList.toggle('fg-top__brand--clair', !h.logoSurSombre);
    lien.hidden = false;
    return true;
  }

  function poser(h, origine) {
    courant = h;
    source = origine;
    poserCouleurs(h.couleurs);
    if (h.titre) doc.title = h.titre;
    poserBandeau();
    racine.setAttribute('data-habillage', origine);
  }

  var CLE = 'pinlane:habillage:1:' + CENTRE;
  function relire() { try { var brut = window.localStorage.getItem(CLE); return brut ? lire(JSON.parse(brut)) : null; } catch (e) { return null; } }
  function retenir(h) { try { window.localStorage.setItem(CLE, JSON.stringify(h)); } catch (e) { /* navigateur sans memoire : rien a garder */ } }

  window.PinlaneHabillage = {
    centre: CENTRE,
    // L instantane du centre : pose seulement si rien de plus sur ne l a deja ete.
    instantane: function (brut) { var h = lire(brut); if (h && !courant) poser(h, 'instantane'); },
    // La reponse du serveur : elle fait foi, et sert au prochain passage.
    appliquer: function (brut) {
      var h = lire(brut);
      if (!h) return;
      if (courant && courant.logo === h.logo && courant.logoTaille && !h.logoTaille) h.logoTaille = courant.logoTaille;
      poser(h, 'serveur');
      retenir(h);
    },
  };

  var garde = relire();
  if (garde) poser(garde, 'memoire');
  else if (CENTRE !== 'centre-inconnu') doc.write('<script src="/assets/habillage/' + CENTRE + '.js?v=1"><\/script>');

  var veille = null;
  if (!poserBandeau() && window.MutationObserver) {
    veille = new MutationObserver(function () { if (poserBandeau()) { veille.disconnect(); veille = null; } });
    veille.observe(racine, { childList: true, subtree: true });
  }
  doc.addEventListener('DOMContentLoaded', function () { poserBandeau(); if (veille) { veille.disconnect(); veille = null; } });
})();
