/* ==========================================================================
   LE PALIER DE PERFORMANCE : la console s'adapte a la machine qui l'affiche
   ==========================================================================

   Ajout du 2026-08-12, plainte de Movsar : « j'ai teste avec des pc pas tres
   puissants et ca rame, ca rame a mort, c'est inutilisable ».

   CE QUE LA MESURE A DIT, ET C'ETAIT UNE SURPRISE (banc
   `scripts/perf-fluidity-check.js`, CPU bride 6x, rasterizer logiciel) :

     ecran campaigns, IMMOBILE  ........................  10 fps
     le meme, canvas WebGL masque  .....................  60 fps
     le meme, backdrop-filter coupe  ...................  10 fps
     le meme, toutes animations CSS coupees  ...........  10 fps

   Autrement dit : le verre, les transitions et les animations CSS ne coutent
   RIEN. Un seul objet ecrase la page, et c'est le halftone WebGL plein ecran
   (1440x900, une passe de bruit simplex 3D PAR PIXEL). Toutes les autres
   pistes qu'on pouvait soupconner de loin sont innocentes, et les couper
   n'aurait rien rendu - c'est la raison d'etre du banc.

   LE VRAI DEFAUT N'EST DONC PAS « TROP D'ANIMATIONS », C'EST QU'AUCUNE NE
   S'ADAPTE. Entre la pleine qualite et `prefers-reduced-motion` il n'existait
   aucun palier intermediaire, et personne ne coche reduced-motion sur le PC du
   comptoir. Ce fichier cree ce palier manquant.

   TROIS PALIERS, ET CE QU'ILS CHANGENT :
     : `full` - rien ne change, la console d'aujourd'hui a l'identique ;
     : `eco`  - les toiles peignent a 55 % de leur resolution et un peu moins
                souvent. Le mouvement est LE MEME, il coute trois fois moins ;
     : `min`  - 35 % de resolution, cadence plus lente encore, et sur un
                rasterizer logiciel le shader ne demarre pas du tout : c'est le
                champ de points canvas 2D qui prend la main. Mesure : 60 fps,
                et il a ete dessine pour cette page, ce n'est pas un pis-aller.

   AUCUNE ANIMATION N'EST SUPPRIMEE A AUCUN PALIER. C'etait la contrainte
   explicite (« sans enlever les animations ») et le gate la verifie.

   COMMENT LE PALIER EST CHOISI. D'abord des signaux statiques, lisibles avant
   la premiere image, donc sans rien couter : le nom du rasterizer, le nombre
   de coeurs, la memoire annoncee. Ensuite, et c'est ce qui rattrape les cas
   qu'aucune heuristique ne devine, les BOUCLES DEJA EN PLACE rapportent leurs
   propres images via `signaler()`. On n'ajoute donc aucune boucle de mesure :
   ce sont les objets couteux eux-memes qui disent qu'ils coutent trop cher.

   LA DEGRADATION EST A SENS UNIQUE. Un palier ne remonte jamais tout seul :
   une console qui oscille entre deux qualites est plus penible qu'une console
   un cran trop sobre, et l'oscillation est le defaut classique de ce genre de
   mecanisme. On repart au palier haut au prochain chargement.
   ========================================================================== */

(function () {
  'use strict';

  var CLE = 'pinlane_perf_tier';        // forcage manuel (support, QA, banc)
  var PALIERS = ['full', 'eco', 'min'];

  // Reglages par palier. `echelle` est le facteur applique au backing store des
  // toiles : le cout d'un shader plein ecran varie avec le NOMBRE DE PIXELS,
  // donc 0.55 coute ~3x moins et 0.35 ~8x moins. La texture est un voile doux :
  // a l'ecran, l'etirement ne se voit pas.
  var REGLAGES = {
    full: { echelle: 1, cadence: 32, dprMax: 2 },
    eco: { echelle: 0.55, cadence: 40, dprMax: 1 },
    min: { echelle: 0.35, cadence: 50, dprMax: 1 },
  };

  var etat = {
    palier: 'full',
    force: false,
    logiciel: false,
    renderer: '',
    coeurs: 0,
    memoire: 0,
    raison: 'defaut',
  };

  var abonnes = [];

  function lireForcage() {
    try {
      var v = window.localStorage.getItem(CLE);
      return PALIERS.indexOf(v) > -1 ? v : null;
    } catch (e) { return null; }
  }

  /* ---- LE RASTERIZER -----------------------------------------------------
     Un vieux PC de bureau n'a pas « un GPU lent » : tres souvent il n'a AUCUNE
     acceleration, parce que le pilote est sur liste noire ou absent. Chrome
     bascule alors sur SwiftShader, qui calcule les pixels au processeur. C'est
     precisement le cas que le banc reproduit, et c'est celui ou un shader
     plein ecran passe de « joli » a « inutilisable ».

     La lecture cree un contexte WebGL jetable : quelques millisecondes une
     seule fois au chargement, contre une page a 10 fps toute la soiree. */
  function lireRenderer() {
    var toile;
    var gl;
    try {
      toile = document.createElement('canvas');
      toile.width = 1;
      toile.height = 1;
      gl = toile.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
        || toile.getContext('webgl', { failIfMajorPerformanceCaveat: false });
      if (!gl) return { nom: '', logiciel: true };   // pas de WebGL du tout : traite comme logiciel
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var nom = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
      var logiciel = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i.test(nom);
      return { nom: nom, logiciel: logiciel };
    } catch (e) {
      return { nom: '', logiciel: true };
    } finally {
      // Le contexte jetable est rendu tout de suite : un contexte WebGL vivant
      // compte dans le quota du navigateur (16 en general), et l'application en
      // ouvre un vrai juste apres.
      try { if (gl && gl.getExtension('WEBGL_lose_context')) gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e2) { /* rien a faire */ }
    }
  }

  function poser(palier, raison) {
    if (PALIERS.indexOf(palier) < 0) return;
    if (palier === etat.palier) return;
    etat.palier = palier;
    etat.raison = raison;
    try { document.documentElement.setAttribute('data-pl-perf', palier); } catch (e) { /* pas de documentElement */ }
    for (var i = 0; i < abonnes.length; i += 1) {
      try { abonnes[i](palier); } catch (e) { /* un abonne qui casse n'emporte pas les autres */ }
    }
  }

  function descendre(raison) {
    if (etat.force) return false;                       // un choix manuel ne se fait pas ecraser
    var i = PALIERS.indexOf(etat.palier);
    if (i < 0 || i >= PALIERS.length - 1) return false;  // deja au plus sobre
    poser(PALIERS[i + 1], raison);
    return true;
  }

  /* ---- LE CHOIX INITIAL --------------------------------------------------
     Uniquement des signaux gratuits, lisibles avant la premiere image. Les
     seuils sont volontairement larges : se tromper vers le sobre coute un
     voile un peu moins fin, se tromper vers le riche coute une console
     inutilisable. L'asymetrie decide. */
  function choisirAuDemarrage() {
    var forcage = lireForcage();
    if (forcage) {
      etat.force = true;
      poser(forcage, 'forcage manuel');
      return;
    }
    var r = lireRenderer();
    etat.renderer = r.nom;
    etat.logiciel = r.logiciel;
    etat.coeurs = Number(navigator.hardwareConcurrency) || 0;
    etat.memoire = Number(navigator.deviceMemory) || 0;

    if (r.logiciel) { poser('min', 'rasterizer logiciel : ' + (r.nom || 'inconnu')); return; }
    if ((etat.coeurs && etat.coeurs <= 2) || (etat.memoire && etat.memoire <= 2)) { poser('min', 'machine tres limitee'); return; }
    if ((etat.coeurs && etat.coeurs <= 4) || (etat.memoire && etat.memoire <= 4)) { poser('eco', 'machine modeste'); return; }
    poser('full', 'machine confortable');
  }

  /* ---- L'ADAPTATION EN MARCHE --------------------------------------------
     Les boucles couteuses (halftone, champ de points) appellent `signaler()`
     avec leur propre delta d'image. Aucune boucle n'est ajoutee ici.

     On exige une FENETRE PLEINE de mauvaises images avant de descendre : une
     image isolee a 200 ms, c'est un rendu de page ou un garbage collect, pas
     une machine lente. Descendre la-dessus ferait clignoter la qualite a
     chaque clic. */
  var FENETRE = 40;                 // images observees avant de trancher
  var fenetre = [];
  var gele = 0;                     // horodatage : on laisse le nouveau palier s'installer

  function signaler(delta) {
    if (etat.force || etat.palier === PALIERS[PALIERS.length - 1]) return;
    if (!(delta > 0) || delta > 2000) return;          // onglet en arriere-plan : delta absurde, on jette
    var t = now();
    if (t < gele) return;
    fenetre.push(delta);
    if (fenetre.length < FENETRE) return;
    var tri = fenetre.slice().sort(function (a, b) { return a - b; });
    var p50 = tri[Math.floor(tri.length / 2)];
    fenetre = [];
    // La cadence visee est deja plafonnee (32 ms au palier haut) : on ne
    // descend que si la machine ne tient MEME PAS le double de ce budget,
    // c'est-a-dire si elle est visiblement en peine.
    if (p50 > REGLAGES[etat.palier].cadence * 2) {
      if (descendre('images mesurees a ' + Math.round(p50) + ' ms')) gele = now() + 4000;
    }
  }

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  choisirAuDemarrage();
  // L'attribut doit exister des le premier rendu meme au palier haut : le CSS
  // s'accroche dessus, et un attribut qui apparait apres coup provoquerait un
  // recalcul de style complet a un moment ou la page a autre chose a faire.
  try {
    if (!document.documentElement.getAttribute('data-pl-perf')) {
      document.documentElement.setAttribute('data-pl-perf', etat.palier);
    }
  } catch (e) { /* pas de documentElement */ }

  window.PinlanePerf = {
    palier: function () { return etat.palier; },
    echelle: function () { return REGLAGES[etat.palier].echelle; },
    cadence: function () { return REGLAGES[etat.palier].cadence; },
    dprMax: function () { return REGLAGES[etat.palier].dprMax; },
    logiciel: function () { return etat.logiciel; },
    /* Le shader plein ecran a-t-il le droit de demarrer ?
       Non quand la machine peint SANS GPU et qu'on est au palier le plus
       sobre : mesure, 10 fps contre 60 pour le repli canvas 2D.
       Oui des que quelqu'un a force un palier a la main - forcer veut dire
       « je sais ce que je demande », et c'est aussi ce qui permet au gate de
       prouver, par contre-epreuve, que ce refus sert reellement a quelque
       chose. Un garde-fou qu'on ne peut pas desactiver est un garde-fou qu'on
       ne peut pas tester. */
    shaderPleinEcran: function () { return !(etat.logiciel && etat.palier === 'min'); },
    signaler: signaler,
    /* Rend une fonction de DESABONNEMENT, et ce n'est pas du confort d'API.
       `plFxHalftone` est rappele a chaque montage de la page marketing : sans
       moyen de se retirer, chaque visite laissait derriere elle une fermeture
       tenant un canvas mort et son contexte WebGL. Vingt allers-retours et on
       garde vingt contextes en vie, pour un quota navigateur de seize. La
       fuite n'aurait pas plante tout de suite - elle aurait plante loin de sa
       cause, ce qui est pire. */
    surChangement: function (cb) {
      if (typeof cb !== 'function') return function () {};
      abonnes.push(cb);
      return function () {
        var i = abonnes.indexOf(cb);
        if (i > -1) abonnes.splice(i, 1);
      };
    },
    // Diagnostic : ce que le support et le banc lisent pour comprendre un cas.
    etat: function () {
      return {
        palier: etat.palier, raison: etat.raison, force: etat.force,
        logiciel: etat.logiciel, renderer: etat.renderer,
        coeurs: etat.coeurs, memoire: etat.memoire,
      };
    },
    // Forcage explicite, garde entre deux visites. `null` rend la main a la
    // detection automatique.
    forcer: function (palier) {
      try {
        if (palier === null) { window.localStorage.removeItem(CLE); etat.force = false; return; }
        if (PALIERS.indexOf(palier) < 0) return;
        window.localStorage.setItem(CLE, palier);
        etat.force = true;
        poser(palier, 'forcage manuel');
      } catch (e) { /* stockage refuse : le forcage ne survivra pas, tant pis */ }
    },
  };
}());
