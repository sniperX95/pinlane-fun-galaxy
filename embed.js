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
 *   data-start          "sur-mesure" ouvre le formulaire aux couleurs du centre directement
 *                       sur la demande de groupe (page Événements d'un site)
 *   data-miroir         sélecteur de l'ancien formulaire Gravity Forms (#gform_4) : chaque
 *                       réservation prise par le formulaire aux couleurs du centre y est aussi
 *                       envoyée, une entrée par activité, pendant une période d'essai
 *
 * Le cadre s'adapte à la hauteur de son contenu. À chaque réservation confirmée, un
 * événement `pinlane_booking` est poussé dans le dataLayer de la page et un événement
 * DOM `pinlane:booking` est émis, sans aucune donnée personnelle. À chaque demande de
 * groupe envoyée, de même : `pinlane_demande` et `pinlane:demande`.
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

  // (normalise comme le choix du visiteur : une espace en trop ou une majuscule ne change pas de centre)
  var center = centreChoisiParLeVisiteur() || identifiantDeCentre(script.getAttribute('data-center')) || '';

  // SANS CENTRE, PAS DE FORMULAIRE (Ansar, 2026-11-04 : « des resa qui spawn a gembloux et pas a libra »). Sur un site a
  // plusieurs centres, une ligne qui ne nomme pas le sien rangerait ses reservations chez un autre : elle ne monte rien,
  // le formulaire du site reste en place, et l oubli se lit dans la console du navigateur.
  if ((script.getAttribute('data-design') || '').toLowerCase() === 'fungalaxy' && !center) {
    try { console.error('Pinlane embed.js : data-center manquant, aucun formulaire monte.'); } catch (error) { /* console absente */ }
    return;
  }

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
  // data-start="sur-mesure" ouvre ce formulaire directement sur la demande de
  // groupe (la page Evenements d un site). Une seule valeur reconnue, toute
  // autre est ignoree ; le parcours /reserver ne la connait pas.
  var depart = (script.getAttribute('data-start') || '').toLowerCase() === 'sur-mesure' ? '&start=sur-mesure' : '';
  // data-miroir nomme l ancien formulaire (Gravity Forms) dans lequel chaque reservation prise ici est recopiee : voir
  // « La copie dans l ancien formulaire », plus bas. Meme controle que data-fallback ; le formulaire aux couleurs du
  // centre est le seul a savoir l envoyer.
  var miroirSelecteur = script.getAttribute('data-miroir') || '';
  if (/[{}@<]/.test(miroirSelecteur)) miroirSelecteur = '';
  var miroirDemande = design === 'fungalaxy' && miroirSelecteur !== '';
  var target = design === 'fungalaxy'
    ? origin + '/fungalaxy/' + encodeURIComponent(center) + '?embed=1' + depart + (miroirDemande ? '&miroir=1' : '')
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
  // D ou vient le visiteur : la page du site qui embarque le formulaire (avec
  // ses parametres de campagne : utm, gclid, fbclid) et la page d avant. Le
  // formulaire en deduit la source de chaque reservation (SEO, SEA, reseaux).
  // Rien d autre ne part que l adresse de la page et ses parametres de
  // campagne : un e-mail ou un jeton glisse dans l URL du site reste ici.
  function pageSansSecret(adresse) {
    try {
      var u = new URL(String(adresse || ''));
      if (!/^https?:$/.test(u.protocol)) return '';
      var garde = [];
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'].forEach(function (k) {
        var v = u.searchParams.get(k);
        if (v) garde.push(k + '=' + encodeURIComponent(v.slice(0, 120)));
      });
      return (u.origin + u.pathname + (garde.length ? '?' + garde.join('&') : '')).slice(0, 600);
    } catch (e) { return ''; }
  }
  var pageHote = '';
  var refHote = '';
  try { pageHote = pageSansSecret(window.location.href); refHote = pageSansSecret(document.referrer).split('?')[0]; } catch (e) { pageHote = ''; }
  frame.src = target + (fondHote ? '&fond=' + encodeURIComponent(fondHote) : '')
    + (pageHote ? '&hote=' + encodeURIComponent(pageHote) : '')
    + (refHote ? '&ref=' + encodeURIComponent(refHote) : '');
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

  // UNE DEMANDE DE GROUPE EST UN CONTACT, PAS UNE VENTE : `Lead` côté Meta et
  // `generate_lead` côté GA4, les événements standard de cette famille. Aucun
  // montant : l'équipe chiffre la demande après coup. data-track="datalayer"
  // coupe ces appels comme pour la réservation.
  function declencherDemandeSurLesOutilsDuSite(detail) {
    if (!mesureDirecte) return;
    try {
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Lead', { content_name: 'Demande de groupe', content_category: String(detail.type || '') });
      }
    } catch (error) { /* le pixel du site a refusé : ce n'est pas à nous de le rattraper */ }
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'generate_lead', { lead_source: 'demande_sur_mesure', center: String(detail.center || '') });
      }
    } catch (error) { /* idem pour l'analytics du site */ }
  }

  // LA COPIE DANS L ANCIEN FORMULAIRE (2026-11-13, Ansar : « quand qlq un fini de reserver avec notre formulaire faut
  // que ça fasse une resa en meme temps ... exactement comme ils ont deja actuellement ... pour voir si tout coincide »).
  //
  // Pendant l essai, chaque reservation prise dans le cadre est aussi envoyee par l ancien formulaire du site, masque
  // mais toujours dans la page : une entree par activite, comme si le visiteur l avait remplie lui-meme (meme
  // navigateur, meme page, memes champs caches, anti-spam compris). L equipe recoit donc ses mails habituels et peut
  // comparer. Trois regles :
  //   - le formulaire de la page n est jamais touche : les valeurs partent dans une copie (FormData), ses champs
  //     restent vides et rien ne s ajoute a la page. Le retour a l ancien formulaire ne laisse donc aucune trace ;
  //   - ces donnees sont personnelles : elles n arrivent que du cadre pose par ce script (origine ET source, verifiees
  //     plus bas) et ne repartent que vers le site lui-meme (meme origine que la page) ;
  //   - une reservation n est recopiee qu une fois, et le resultat repart au cadre, qui le signale a Pinlane : une
  //     copie ratee se sait au lieu de se perdre.
  function sansAccents(texte) {
    var s = String(texte == null ? '' : texte).toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (error) { /* normalize indisponible */ }
    return s;
  }
  function cleDe(texte) { return sansAccents(texte).replace(/[^a-z0-9]+/g, ''); }
  function motsDe(texte) { return ' ' + sansAccents(texte).replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }

  // Les champs se reconnaissent a leur intitule, pas a leur numero : le formulaire de Libramont (4) et celui de
  // Gembloux (1) ne numerotent pas pareil le choix du centre, et un champ ajoute par l agence ne decale rien.
  function champsDuFormulaire(form) {
    var champs = {};
    var blocs = form.querySelectorAll('.gfield');
    for (var i = 0; i < blocs.length; i += 1) {
      var bloc = blocs[i];
      var titre = bloc.querySelector('.gfield_label, legend, label');
      var mots = motsDe(titre ? titre.textContent : '');
      var radios = bloc.querySelectorAll('input[type="radio"]');
      var liste = bloc.querySelector('select');
      var saisies = bloc.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type])');
      if (radios.length) {
        var choix = { nom: radios[0].name, activite: '', formule: '' };
        for (var r = 0; r < radios.length; r += 1) {
          if (cleDe(radios[r].value).indexOf('activite') >= 0) choix.activite = radios[r].value;
          if (cleDe(radios[r].value).indexOf('formule') >= 0) choix.formule = radios[r].value;
        }
        if (choix.activite && choix.formule && !champs.quoi) champs.quoi = choix;
      } else if (/ heure /.test(mots) && saisies.length === 2 && saisies[0].name === saisies[1].name) {
        champs.heure = saisies[0].name;
      } else if (liste) {
        if (/ centre /.test(mots)) champs.centre = liste;
        else if (/ formule /.test(mots)) champs.formule = liste;
        else if (/ activite /.test(mots)) champs.activite = liste;
      } else if (saisies.length === 1) {
        var type = (saisies[0].getAttribute('type') || 'text').toLowerCase();
        if (type === 'email') champs.email = saisies[0].name;
        else if (type === 'tel') champs.telephone = saisies[0].name;
        else if (/ (participants?|personnes?) /.test(mots)) champs.participants = saisies[0].name;
        else if (/ (jour|date) /.test(mots)) champs.jour = saisies[0].name;
        else if (/ nom /.test(mots)) champs.nom = saisies[0].name;
      }
    }
    return champs;
  }

  // L option de la liste : celle dont l intitule est le nom envoye, sinon celle dont la valeur commence par
  // l identifiant (« laser-game-gembloux » pour laser_game), sinon un intitule qui commence par l autre. Rien
  // d approchant : '' et jamais la premiere option, qui ferait d une partie de laser une entree « Arcades ».
  function optionDe(liste, nom, identifiant, seuleSiUnique) {
    var options = [];
    for (var i = 0; i < liste.options.length; i += 1) if (liste.options[i].value) options.push(liste.options[i]);
    var cle = cleDe(nom);
    var id = cleDe(identifiant);
    function chercher(test) { for (var j = 0; j < options.length; j += 1) if (test(options[j])) return options[j].value; return ''; }
    return (cle && chercher(function (o) { return cleDe(o.textContent) === cle; }))
      || (id && chercher(function (o) { return cleDe(o.value).indexOf(id) === 0; }))
      || (cle.length >= 4 && chercher(function (o) { var t = cleDe(o.textContent); return t.length >= 4 && (t.indexOf(cle) === 0 || cle.indexOf(t) === 0); }))
      || (seuleSiUnique && options.length === 1 ? options[0].value : '');
  }

  // Ce que Gravity Forms repond : sa confirmation (un message ou une redirection vers une page de remerciement), ou le
  // formulaire renvoye avec ses erreurs. Le formulaire porte lui-meme, dans son script, les noms de la confirmation et
  // de la redirection : seules la BALISE de confirmation et la FONCTION de redirection comptent. Des champs refuses ne
  // remontent que les numeros, jamais le contenu.
  function lireReponse(reponse, html, note) {
    if (!reponse.ok) return { recu: false, raison: 'http-' + reponse.status };
    if (/id=['"]gform_confirmation_(?:wrapper|message)_\d+['"]/.test(html) || /function\s+gformRedirect\s*\(\s*\)\s*\{\s*document\.location\.href/.test(html)) {
      return { recu: true, raison: note };
    }
    var refuses = [];
    html.replace(/<[^>]*\bid=['"]field_\d+_(\d+)['"][^>]*>/g, function (balise, numero) {
      if (/class=['"][^'"]*\bgfield_error\b/.test(balise)) refuses.push(numero);
      return balise;
    });
    if (refuses.length || /id=['"]gform_\d+_validation_container['"]/.test(html)) return { recu: false, raison: 'refuse' + (refuses.length ? ':' + refuses.slice(0, 6).join(',') : '') };
    return { recu: false, raison: 'reponse-inconnue' };
  }

  function poser(donnees, nom, valeur) { if (nom) donnees.set(nom, valeur == null ? '' : String(valeur)); }
  function envoyerUneLigne(form, cible, champs, ligne) {
    var donnees = new FormData(form);
    var formule = ligne.type === 'formule';
    poser(donnees, champs.nom, ligne.nom);
    if (champs.centre) poser(donnees, champs.centre.name, optionDe(champs.centre, ligne.centre, ligne.centreId, true));
    poser(donnees, champs.quoi.nom, formule ? champs.quoi.formule : champs.quoi.activite);
    // La liste que la logique du formulaire cache ne part pas : sa valeur par defaut (sa premiere option) se lirait
    // dans l entree.
    var visee = formule ? champs.formule : champs.activite;
    var cachee = formule ? champs.activite : champs.formule;
    if (cachee) donnees.delete(cachee.name);
    var valeur = visee ? optionDe(visee, formule ? ligne.formule : ligne.activite, formule ? ligne.formuleId : ligne.activiteId) : '';
    if (visee) poser(donnees, visee.name, valeur);
    // Ce que leur liste ne connait pas se lit quand meme, a cote du jour (le seul champ libre).
    poser(donnees, champs.jour, ligne.jour + (valeur ? '' : ' · ' + (formule ? ligne.formule : ligne.activite)));
    if (champs.heure) {
      var hm = /^(\d{1,2}):(\d{2})$/.exec(ligne.heure);
      donnees.delete(champs.heure);
      donnees.append(champs.heure, hm ? String(Number(hm[1])) : '');
      donnees.append(champs.heure, hm ? hm[2] : '');
    }
    poser(donnees, champs.participants, ligne.participants);
    poser(donnees, champs.telephone, ligne.telephone);
    poser(donnees, champs.email, ligne.email);
    var note = valeur ? '' : (formule ? 'formule-inconnue' : 'activite-inconnue');
    // keepalive : le client qui ferme l onglet sur l ecran de confirmation n emporte pas l envoi avec lui.
    return fetch(cible, { method: 'POST', body: donnees, credentials: 'same-origin', keepalive: true })
      .then(function (reponse) { return reponse.text().then(function (html) { return lireReponse(reponse, html, note); }); })
      .catch(function () { return { recu: false, raison: 'reseau' }; });
  }

  function texteBorne(valeur, max) { return String(valeur == null ? '' : valeur).slice(0, max); }
  var recopiees = {};
  function repondreAuCadre(id, resultat) {
    if (!frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({
        type: 'pinlane:miroir-fait', id: id, ok: resultat.ok === true, raison: String(resultat.raison || '').slice(0, 200),
        lignes: resultat.lignes || 0, envoyees: resultat.envoyees || 0,
      }, origin);
    } catch (error) { /* cadre retire */ }
  }
  function recopier(data) {
    var id = String(data.id || '');
    if (!miroirDemande || !/^\d{1,12}$/.test(id) || recopiees[id]) return;
    recopiees[id] = true;
    var lignes = (Array.isArray(data.lignes) ? data.lignes : []).slice(0, 8).map(function (l) {
      l = l && typeof l === 'object' ? l : {};
      var personnes = Math.trunc(Number(l.participants) || 0);
      return {
        type: l.type === 'formule' ? 'formule' : 'activite',
        nom: texteBorne(l.nom, 120), telephone: texteBorne(l.telephone, 40), email: texteBorne(l.email, 160),
        centre: texteBorne(l.centre, 80), centreId: texteBorne(l.centreId, 40),
        activite: texteBorne(l.activite, 80), activiteId: texteBorne(l.activiteId, 60),
        formule: texteBorne(l.formule, 80), formuleId: texteBorne(l.formuleId, 40),
        jour: texteBorne(l.jour, 40), heure: texteBorne(l.heure, 5),
        participants: personnes > 0 && personnes < 1000 ? String(personnes) : '',
      };
    });
    if (!lignes.length) { repondreAuCadre(id, { ok: false, raison: 'rien-a-copier' }); return; }
    var form = null;
    try { form = document.querySelector(miroirSelecteur); } catch (error) { form = null; }
    if (form && form.tagName !== 'FORM') form = form.querySelector('form');
    // L adresse d envoi lue dans l attribut (un champ nomme « action » masquerait la propriete), et seulement sur le
    // site lui-meme.
    var cible = '';
    try {
      var adresse = form ? new URL(form.getAttribute('action') || window.location.href, window.location.href) : null;
      if (adresse && adresse.origin === window.location.origin) cible = adresse.href;
    } catch (error) { cible = ''; }
    if (!cible || typeof FormData !== 'function' || typeof fetch !== 'function') { repondreAuCadre(id, { ok: false, raison: 'formulaire-absent', lignes: lignes.length }); return; }
    var champs = champsDuFormulaire(form);
    var manque = ['nom', 'email', 'telephone', 'participants', 'quoi'].filter(function (k) { return !champs[k]; });
    if (manque.length) { repondreAuCadre(id, { ok: false, raison: 'champ-introuvable:' + manque.join(','), lignes: lignes.length }); return; }
    // Une entree apres l autre : jamais deux envois du meme visiteur dans la meme seconde.
    var envoyees = 0;
    var raisons = [];
    var suite = Promise.resolve();
    lignes.forEach(function (ligne) {
      suite = suite.then(function () { return envoyerUneLigne(form, cible, champs, ligne); }).then(function (r) {
        if (r.recu) envoyees += 1;
        if (r.raison) raisons.push(r.raison);
      });
    });
    suite.then(function () {
      repondreAuCadre(id, { ok: envoyees === lignes.length && !raisons.length, raison: raisons.join(';'), lignes: lignes.length, envoyees: envoyees });
    });
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
    if (data.type === 'pinlane:demande') {
      // Demande de groupe envoyée (demande sur mesure) : le même chemin que la
      // réservation, sous son propre nom, pinlane_demande. Aucune donnée
      // personnelle.
      var demande = data.detail && typeof data.detail === 'object' ? data.detail : {};
      try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'pinlane_demande', pinlane: demande }); } catch (error) { /* dataLayer inaccessible */ }
      try { window.dispatchEvent(new CustomEvent('pinlane:demande', { detail: demande })); } catch (error) { /* CustomEvent indisponible */ }
      declencherDemandeSurLesOutilsDuSite(demande);
      return;
    }
    if (data.type === 'pinlane:miroir') {
      // Reservation confirmee, avec ce que le visiteur aurait tape dans l ancien formulaire : voir « La copie dans
      // l ancien formulaire ». Rien ne part si la ligne du site ne l a pas demandee (data-miroir).
      recopier(data);
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
