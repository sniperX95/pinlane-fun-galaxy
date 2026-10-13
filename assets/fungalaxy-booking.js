/* =============================================================================
   FUN GALAXY, LE FORMULAIRE DE RESERVATION (v3.2, 2026-09-22)
   -----------------------------------------------------------------------------
   Un client leger au-dessus des trois API publiques de Pinlane, sans aucune
   bibliotheque :
     GET  /api/public-booking-meta   le catalogue, le calendrier, la marque
     GET  /api/public-availability   les heures possibles et le plan de visite
     POST /api/public-reservations   la creation, le serveur recalcule tout
   Tout ce qui s affiche vient de ces reponses : aucun prix, aucune heure,
   aucun nom d activite, aucun jour ferie n est ecrit ici.

   Embarque dans fungalaxy.be par /embed.js (iframe), il parle le meme
   protocole que le tunnel actuel : pinlane:height, pinlane:screen,
   pinlane:booking vers l hote, pinlane:vue depuis l hote, fond=... dans l URL.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var body = doc.body;
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finPointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  // La colonne etroite des cartes (maconnerie) : une seule requete, relue a
  // chaque image d un tiroir qui s ouvre, au lieu d une nouvelle par mesure.
  var petitEcran = window.matchMedia ? window.matchMedia('(max-width:560px)') : { matches: false };

  /* --- L adresse : le centre, le mode embarque, le fond de l hote ------------ */

  var params = new URLSearchParams(window.location.search);
  var SLUG_RX = /^[a-z][a-z0-9-]{1,40}$/;
  function centreDepuisAdresse() {
    var m = window.location.pathname.match(/^\/fungalaxy\/([a-z0-9-]+)\/?$/i);
    var brut = (m && m[1]) || params.get('center') || params.get('centerId') || 'libramont';
    brut = String(brut).toLowerCase();
    return SLUG_RX.test(brut) ? brut : 'libramont';
  }
  var CENTER = centreDepuisAdresse();
  var EMBED = params.get('embed') === '1' && window.parent !== window;

  /* --- D ou vient le client (SEO, SEA, reseaux) ------------------------------ */
  // Les parametres de campagne de CETTE page, ou de la page du site du centre
  // qui embarque le formulaire (embed.js les passe dans hote et ref). Aucune donnee
  // personnelle, rien de depose sur l appareil : le serveur
  // (lib/acquisition) borne et deduit la source.
  var CLES_CAMPAGNE = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];
  var ACQUISITION = (function () {
    function campagne(qs) { var o = {}; CLES_CAMPAGNE.forEach(function (k) { var v = qs && qs.get(k); if (v) o[k] = String(v).slice(0, 150); }); return o; }
    var hote = EMBED ? String(params.get('hote') || '') : '';
    var qsHote = null;
    try { qsHote = hote ? new URL(hote).searchParams : null; } catch (e) { qsHote = null; }
    // La page sans ses parametres prives : seuls ceux de campagne voyagent.
    function sansSecret(adresse) {
      try {
        var u = new URL(String(adresse || ''));
        var q = campagne(u.searchParams);
        var garde = Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); });
        return u.origin + u.pathname + (garde.length ? '?' + garde.join('&') : '');
      } catch (e) { return ''; }
    }
    var visite = Object.assign({}, campagne(qsHote), campagne(params), {
      referrer: sansSecret(EMBED ? params.get('ref') : document.referrer).split('?')[0],
      landing: sansSecret(EMBED ? hote : window.location.href),
      hote: sansSecret(hote),
      at: new Date().toISOString()
    });
    // Rien n est depose sur l appareil (pas de cookie, pas de stockage) : un
    // suivi d une visite a l autre demanderait le consentement cookies. On lit
    // la visite en cours, ce qui suffit a dire d ou vient la reservation.
    return { dernier: visite };
  })();
  window.pinlaneAcquisition = function () { return ACQUISITION; };
  if (EMBED) body.classList.add('is-embed');
  if (finPointer) body.classList.add('has-pointer');

  // Le fond du site hote voyage dans l URL : liste blanche de caracteres
  // stricte, sinon color-scheme: dark peint un rectangle gris chez le client.
  // Il devient AUSSI le fond de reference des degrades (--fg-bg) : les bords
  // des photos se fondent dans la page du client, pas dans notre noir a nous.
  // ET SEULEMENT S IL EST SOMBRE (2026-10-12, vu au balayage : sur une page
  // au fond blanc, le recapitulatif ecrit en blanc devenait illisible). Le
  // formulaire ecrit en clair : un fond clair, ou trop transparent pour en
  // etre sur, garde le noir du formulaire. Seuil : luminance relative 0,03,
  // ou le gris des textes secondaires garde plus de 6 de contraste.
  function fondAssezSombre(c) {
    var r, g, b, a = 1, m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(c))) {
      r = Number(m[1]); g = Number(m[2]); b = Number(m[3]);
      if (m[4] != null) a = m[5] ? Number(m[4]) / 100 : Number(m[4]);
    } else return false;
    if (!(a >= 0.95)) return false;
    var lin = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) <= 0.03;
  }
  var fond = params.get('fond') || '';
  if (fond && fond.length < 40 && /^[0-9a-fA-F#rgbaRGBA(), .%]+$/.test(fond) && fondAssezSombre(fond)) {
    root.style.background = fond;
    body.style.background = fond;
    root.style.setProperty('--fg-bg', fond);
  }

  /* --- Le pont avec l hote ------------------------------------------------------ */

  var parentOrigin = '';
  try { if (EMBED && doc.referrer) parentOrigin = new URL(doc.referrer).origin; } catch (e) { parentOrigin = ''; }
  function poster(message) {
    if (!EMBED || !parentOrigin) return;
    try { window.parent.postMessage(message, parentOrigin); } catch (e) {}
  }
  var derniereHauteur = 0;
  // UN TIROIR QUI S OUVRE NE REDIMENSIONNE LE CADRE QU UNE FOIS. Le tiroir
  // d une carte et le menu d une plage horaire se deplient en
  // grid-template-rows (0,4 s) : la hauteur du contenu change a chaque image.
  // Suivie image par image, elle redimensionnait le cadre a chaque image, et
  // chaque redimensionnement coute un layout du document entier, le recalcul
  // des unites d ecran et le travail de la page hote (mesure 2026-10-07, 4x :
  // la moitie des images perdues a l ouverture d une plage). Pendant ces
  // transitions, la hauteur du cadre est TENUE : posee d emblee a la hauteur
  // d arrivee (calculee au depart), elle ne redescend qu une fois tout pose.
  // Le formulaire ne bouge pas d un pixel ; seule la page hote, SOUS le
  // cadre, se pose en une fois au lieu de glisser.
  var tiroirsEnCours = new Map(), hauteurTenue = 0, tenueAFaire = false;
  function posterHauteur() {
    if (!EMBED || !parentOrigin) return;
    // body.scrollHeight, jamais documentElement : le second vaut au moins la
    // hauteur du cadre et le cadre ne saurait alors que grandir (cliquet).
    // La hauteur MONTE au pixel pres : un contenu plus haut que le cadre, meme
    // de 3 px, rendait le cadre defilable, et il avalait le geste (molette,
    // doigt) au lieu de le rendre a la page du client. Elle ne REDESCEND
    // qu au-dela de 8 px : quelques pixels vides en bas ne genent personne,
    // un arrondi qui tremble si.
    var h = Math.max(body.scrollHeight, body.offsetHeight);
    if (tiroirsEnCours.size) {
      // La hauteur d arrivee se calcule des que le contenu des tiroirs qui
      // s ouvrent se mesure : replie en content-visibility: hidden, il ne
      // revient au layout qu a la premiere image de la transition.
      if (tenueAFaire) {
        var arrivee = hauteurDArrivee();
        if (arrivee) { hauteurTenue = Math.max(hauteurTenue, arrivee); tenueAFaire = false; }
      }
      h = Math.max(h, hauteurTenue);
    }
    if (!h || h === derniereHauteur || (h < derniereHauteur && derniereHauteur - h < 8)) return;
    derniereHauteur = h;
    poster({ type: 'pinlane:height', height: h });
  }
  // La hauteur du corps une fois les tiroirs en cours arrives : ce que chacun
  // va gagner (son contenu entier s il s ouvre) ou perdre (tout s il se
  // ferme). Dans une maconnerie (cartes d activites), le cadre ne grandit que
  // de ce que gagne la colonne la plus haute.
  function hauteurDArrivee() {
    var h = Math.max(body.scrollHeight, body.offsetHeight);
    var parGrille = new Map(), parOnglets = new Map(), incomplet = false;
    tiroirsEnCours.forEach(function (minuteur, el) {
      var parent = el.parentElement, contenu = el.firstElementChild;
      if (!el.isConnected || !parent) return;
      var ouvrant = parent.classList.contains('is-on') || parent.classList.contains('is-open');
      if (ouvrant && contenu && getComputedStyle(contenu).contentVisibility === 'hidden') { incomplet = true; return; }
      // Des onglets (parent en display: contents, les plages de l ecran des
      // heures pas a pas) : leurs corps partagent UNE case de la grille, que
      // le plus haut fait. Celui qui se ferme et celui qui s ouvre ne
      // s additionnent pas : la case passe du plus haut d avant au plus haut
      // d apres (les additionner retirait deux fois la plage fermee, 54 px).
      if (getComputedStyle(parent).display === 'contents') {
        var onglets = parent.parentElement, o = parOnglets.get(onglets) || { avant: 0, apres: 0 };
        o.avant = Math.max(o.avant, el.getBoundingClientRect().height);
        o.apres = Math.max(o.apres, ouvrant && contenu ? contenu.scrollHeight : 0);
        parOnglets.set(onglets, o);
        return;
      }
      var ecart = (ouvrant && contenu ? contenu.scrollHeight : 0) - el.getBoundingClientRect().height;
      var grille = parent.parentElement;
      if (grille && grille._fgMasonryObserver) {
        if (!parGrille.has(grille)) parGrille.set(grille, new Map());
        parGrille.get(grille).set(parent, ecart);
      } else h += ecart;
    });
    parGrille.forEach(function (ecarts, grille) {
      var colonnes = getComputedStyle(grille).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      var espace = petitEcran.matches ? 10 : 14;
      var hauteurs = Array(colonnes).fill(0);
      Array.from(grille.children).filter(function (x) { return x.classList.contains('fg-grid__item'); }).forEach(function (tuile, i) {
        hauteurs[i % colonnes] += Math.ceil(tuile.getBoundingClientRect().height) + (ecarts.get(tuile) || 0) + espace;
      });
      h += Math.max.apply(null, hauteurs) - espace - grille.getBoundingClientRect().height;
    });
    parOnglets.forEach(function (o) { h += o.apres - o.avant; });
    return incomplet ? 0 : Math.ceil(h);
  }
  function lacherTiroir(el) {
    if (!tiroirsEnCours.has(el)) return;
    clearTimeout(tiroirsEnCours.get(el));
    tiroirsEnCours.delete(el);
    if (!tiroirsEnCours.size) { hauteurTenue = 0; tenueAFaire = false; posterHauteur(); }
  }
  if (EMBED) {
    doc.addEventListener('transitionrun', function (e) {
      if (e.propertyName !== 'grid-template-rows') return;
      // Filet : un tiroir retire du document en pleine course ne previent pas.
      clearTimeout(tiroirsEnCours.get(e.target));
      tiroirsEnCours.set(e.target, setTimeout(function () { lacherTiroir(e.target); }, 1200));
      // Rien ne redescend pendant la course ; la hauteur d arrivee se pose
      // des qu elle se mesure.
      hauteurTenue = Math.max(hauteurTenue, derniereHauteur);
      tenueAFaire = true;
      posterHauteur();
    });
    var finTiroir = function (e) { if (e.propertyName === 'grid-template-rows') lacherTiroir(e.target); };
    doc.addEventListener('transitionend', finTiroir);
    doc.addEventListener('transitioncancel', finTiroir);
  }
  if (EMBED) {
    if ('ResizeObserver' in window) new ResizeObserver(posterHauteur).observe(body);
    else { window.addEventListener('resize', posterHauteur); setInterval(posterHauteur, 800); }
    window.addEventListener('load', posterHauteur);
    window.addEventListener('message', function (event) {
      if (!parentOrigin || event.origin !== parentOrigin) return;
      var d = event.data || {};
      if (d.type !== 'pinlane:vue') return;
      // Seul embed.js envoie la zone visible : l hote suit donc la hauteur, et
      // le cadre peut se verrouiller (voir html.fg-pilote dans la feuille).
      if (!root.classList.contains('fg-pilote')) root.classList.add('fg-pilote');
      // La zone visible reste en JS (hautCadre, ecranHote) : aucune regle du
      // formulaire ne la lit. Posee en variables CSS sur la racine, elle
      // changeait a chaque image d un defilement de la page hote (et du
      // defilement doux qui suit chaque changement d ecran), et une variable
      // heritee qui change sur la racine fait recalculer le style de TOUT le
      // document : un millier d elements, 40 a 150 ms par image a 4x (mesure
      // du 2026-10-07).
      var haut = Number(d.hautCadre);
      if (isFinite(haut)) hautCadre = haut;
      ecranHote = Number(d.hauteurEcran) || 0;
      // Les fenetres du calendrier (telephone) et des offres suivent le
      // milieu de l ecran hote.
      placerFenetre(false);
      placerVitrine(false);
      placerInfoFenetre(infoCentreDemande); infoCentreDemande = false;
    });
  }

  /* --- L etat ------------------------------------------------------------------- */

  var meta = null;             // la reponse de public-booking-meta
  var state = {
    date: '',
    pax: 4,
    selection: [],             // ids d activites cochees (onglet Activites)
    options: {},               // id -> { duration | games | minutes } choisis sur la carte
    formuleId: '',             // ou une formule (onglet Formules)
    enfants: null,             // offre reservee aux enfants : combien le sont (null = tout le groupe)
    onglet: 'activites',
    pins: {},                  // activityId -> 'HH:MM' : les heures que le client a posees
    laserParts: [],            // heures des parties de laser posees (si plusieurs parties)
    heuresPassees: {},         // activityId -> ['HH:MM'] : heures posees devenues passees, retirees par le serveur
    arrivee: '',               // formule : l heure d arrivee choisie ('' : le client choisit les heures des activites)
    arcade: '',                // avec une arrivee : l heure d arcade choisie ('' : la frise du serveur la range)
    heure: '',                 // debut de visite du creneau retenu
    dispo: null,               // la derniere reponse de public-availability
    dispoCle: '',              // la demande qui a produit state.dispo, prise au depart de la requete
    dispoTexte: '',            // state.dispo tel que recu : la relecture des heures compare avec lui
    creneau: null,             // le slot retenu (avec opsPlan)
    contact: { prenom: '', nom: '', email: '', telephone: '', note: '', occasion: '', occasionAutre: '' },
    reservation: null,
    attente: null,             // l offre d attente acceptee : { activityId, participants, cle } (cle : la demande sans elle)
  };
  var SCENES = ['date', 'activites', 'heures', 'contact', 'recap', 'fin'];
  var ETAPES = [
    { id: 'date', label: 'Date & groupe' },
    { id: 'activites', label: 'Activités' },
    { id: 'heures', label: 'Horaires' },
    { id: 'contact', label: 'Coordonnées' },
    { id: 'recap', label: 'Validation' },
  ];
  // LE PARCOURS SUR MESURE : ses ecrans et son fil d etapes, a lui. Le premier
  // ecran (le jour et le groupe) est la porte commune des deux parcours.
  var SCENES_SM = ['sm-groupe', 'sm-date', 'sm-envies', 'sm-contact', 'sm-recap', 'fin'];
  var ETAPES_SM = [
    { id: 'sm-groupe', label: 'Votre groupe' },
    { id: 'sm-date', label: 'Date' },
    { id: 'sm-envies', label: 'Envies' },
    { id: 'sm-contact', label: 'Coordonnées' },
    { id: 'sm-recap', label: 'Envoi' },
  ];
  // La demande en cours de redaction. `actif` : le parcours montre est celui
  // de la demande ; les reponses restent quand on revient a la porte.
  var sm = {
    actif: false, type: '', organisation: '', participants: 0, paxTouche: false, accompagnants: 0, ages: [],
    date: '', date2: '', dateTouchee: false, flexible: false, periode: '', moment: '',
    activites: [], formules: [], conseil: false, budget: '', onglet: 'activites', contact: null,
  };
  function parcours() { return sm.actif ? SCENES_SM : SCENES; }
  function etapes() { return sm.actif ? ETAPES_SM : ETAPES; }
  var sceneCourante = 'date';

  /* --- Outils ------------------------------------------------------------------- */

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function deIso(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function jourLong(s) { var d = deIso(s); return cap(JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]); }
  function jourCourt(s) { var d = deIso(s); return cap(JOURS_COURTS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS_COURTS[d.getMonth()]); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function euros(n) { n = Number(n); if (!isFinite(n)) return ''; return (Math.round(n * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €'; }
  function personnes(n) { return n + ' personne' + (n > 1 ? 's' : ''); }
  function joueurs(n) { return n + ' joueur' + (n > 1 ? 's' : ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Ce qui ne se coupe pas en fin de ligne : « 4 personnes », « 1 h 40 »,
  // « Sam. 26 sept. » ; un separateur (· ou +) reste avec le mot d avant, et
  // le dernier mot d un nom avec le precedent (« Laser Game »), sans souder
  // un long nom entier.
  function insecable(s) { return String(s == null ? '' : s).replace(/ /g, '\u00a0'); }
  function finInsecable(s) { return String(s == null ? '' : s).replace(/ ([^ ]+)$/, '\u00a0$1'); }
  // LES MOTS QUI NE SE SEPARENT PAS (2026-10-12, vu au balayage a 360 px :
  // « 2 » en fin de ligne et « pistes » dessous, un « × » ou un « = » pendus,
  // « / » puis « personne »). Un nombre reste avec son unite, un « · » avec
  // ce qui le precede, un « × » ou un « = » avec ce qui le suit, un prix
  // avec ce qu il paie, « sur place » d un seul tenant.
  var UNITES = '€|min|h|heures?|pistes?|joueurs?|parties?|personnes?|groupes?|places?|ans|enfants?|tables?|cartes?|sessions?|participants?';
  var NOMBRE_UNITE = new RegExp('(\\d) (?=(?:' + UNITES + ')(?![A-Za-zÀ-ÿ]))', 'g');
  function typo(s) {
    return String(s == null ? '' : s)
      .replace(/(\d) h (\d)/g, '$1\u00a0h\u00a0$2')
      .replace(NOMBRE_UNITE, '$1\u00a0')
      .replace(/ · /g, '\u00a0· ')
      .replace(/ ([×=]) /g, ' $1\u00a0')
      .replace(/ \/ /g, '\u00a0/\u00a0')
      .replace(/ sur place/g, '\u00a0sur\u00a0place')
      .replace(/joueurs minimum/g, 'joueurs\u00a0minimum');
  }
  // Rejoue une animation CSS une fois : retire la classe, force un recalcul,
  // la repose. Elle repart d elle-meme ensuite : restee posee, elle rejouerait
  // chaque fois que l element repasse de display:none a affiche.
  // Le recalcul force (void offsetWidth) ne sert qu a RELANCER une animation
  // dont la classe est deja posee : une classe absente se pose sans rien
  // forcer. Chaque recalcul force est un layout de la page au milieu d un
  // geste (banc 2026-10-07, 4x : trois touches de « + » passent de 62 a
  // 33 ms de longues taches).
  function relancer(el, cls) {
    if (el.classList.contains(cls)) { el.classList.remove(cls); void el.offsetWidth; }
    el.classList.add(cls);
  }
  var minuteursRejoue = new WeakMap();
  function rejouer(el, cls) {
    if (!el || reduced) return;
    relancer(el, cls);
    clearTimeout(minuteursRejoue.get(el));
    minuteursRejoue.set(el, setTimeout(function () { el.classList.remove(cls); }, 700));
  }
  // Le telephone public du centre (public-booking-meta, publicInfo) : une
  // piste quand rien ne se reserve en ligne. Un point de contact, jamais une
  // promesse de reservation par telephone.
  function ligneCentre() {
    var c = meta && meta.center && meta.center.contact;
    return c && c.phone ? ' Pour en savoir plus, appelez le centre au ' + lienContact({ phone: c.phone }) + '.' : '';
  }
  // « 3 sessions de 15 min » quand le groupe tourne sur une installation qui
  // ne le prend pas d un coup (Fun Run). `sessions` est calcule par le
  // SERVEUR (lib/visit-program) et voyage dans la ligne de programme.
  function detailSessions(it) {
    var n = Math.trunc(Number(it && it.sessions) || 1);
    var mn = Number(it && it.minutes) || 0;
    // Tables de billard, pistes de duckpin : leur nombre, la duree, et les
    // tours d un groupe plus grand que ce que le centre possede.
    var unites = Math.trunc(Number(it && it.units) || 0);
    var mot = motUnite(it);
    if (unites > 0 && mot && it.activityId !== 'bowling') {
      var nombre = unites + ' ' + mot + (unites > 1 ? 's' : '');
      if (!mn) return nombre;
      return n > 1 ? nombre + ' · ' + n + ' tours de ' + minutesLabel(Math.round(mn / n)) : nombre + ' · ' + minutesLabel(mn);
    }
    if (n < 2 || !mn) return '';
    return n + ' sessions de ' + minutesLabel(Math.round(mn / n));
  }
  function participantsLigne(it) {
    if (!it || !it.activityId) return '';
    var n = Number(it.participants) || joueursDe(activite(it.activityId));
    return seCompteParEnfant(activite(it.activityId)) ? n + ' enfant' + (n > 1 ? 's' : '') : joueurs(n);
  }
  function minutesLabel(m) { m = Number(m) || 0; if (m >= 60) { var h = Math.floor(m / 60), r = m % 60; return r ? h + 'h' + String(r).padStart(2, '0') : h + ' heure' + (h > 1 ? 's' : ''); } return m + ' min'; }
  function dureeApprox(m) { m = Number(m) || 0; if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; return 'environ ' + h + ' h' + (r >= 30 ? '30' : ''); }
  function minutesEntre(a, b) {
    var pa = /^(\d{1,2}):(\d{2})$/.exec(String(a || ''));
    var pb = /^(\d{1,2}):(\d{2})$/.exec(String(b || ''));
    if (!pa || !pb) return 0;
    var d = (Number(pb[1]) * 60 + Number(pb[2])) - (Number(pa[1]) * 60 + Number(pa[2]));
    return d > 0 ? d : 0;
  }
  function dureeExacte(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : '');
  }
  // « environ 45 min », « environ 1 h 30 » : une duree estimee, jamais promise,
  // qui ne se coupe pas en fin de ligne.
  function environ(m) { return insecable('environ ' + dureeExacte(m)); }
  function heuresLabel(v) { v = Number(v) || 0; if (v === 0.5) return '30 min'; if (v === 1) return '1 heure'; if (v === 1.5) return '1h30'; if (v === 2) return '2 heures'; return minutesLabel(Math.round(v * 60)); }
  function heureAffichee(t) { return t === '24:00' ? 'minuit' : t; }
  // Les libelles du serveur sont sans accent (une table partagee avec les
  // mails et les statistiques) : la seule chose qu on refait ici, ce sont
  // les accents, jamais le sens.
  var ACCENTS = {
    "Conge d'automne": 'Congé d’automne', "Vacances d'hiver": 'Vacances d’hiver', 'Conge de detente': 'Congé de détente',
    'Vacances de printemps': 'Vacances de printemps', "Vacances d'ete": 'Vacances d’été', 'Lundi de Paques': 'Lundi de Pâques',
    'Fete du Travail': 'Fête du Travail', 'Lundi de Pentecote': 'Lundi de Pentecôte', 'Fete nationale': 'Fête nationale', 'Noel': 'Noël',
    "Jour de l'An": 'Jour de l’An', 'Jour special (manuel)': 'Jour spécial',
  };
  function accentuer(s) { return ACCENTS[s] || String(s || '').replace("'", '’'); }
  function horaireLabel(sch) {
    if (!sch) return 'Fermé';
    if (sch.label) return String(sch.label).replace('Minuit', 'minuit');
    var f = function (t) { var h = Math.floor(t), m = Math.round((t - h) * 60); return m ? h + 'h' + String(m).padStart(2, '0') : h + 'h'; };
    return f(sch.open) + ' - ' + (sch.close === 24 ? 'minuit' : f(sch.close));
  }
  function icone(id) {
    var s = String(id || '').toLowerCase();
    if (/bowling/.test(s) && /duck/.test(s)) return 'a-duckpin';
    if (/bowling/.test(s)) return 'a-bowling';
    if (/laser/.test(s)) return 'a-laser';
    if (/golf/.test(s)) return 'a-minigolf';
    if (/billard/.test(s)) return 'a-billard';
    if (/arcade/.test(s)) return 'a-arcade';
    if (/playground|plaine/.test(s)) return 'a-plaine';
    if (/fun_run|funrun|fun-run/.test(s)) return 'a-funrun';
    // La table d une formule anniversaire : le gateau des occasions.
    if (/table/.test(s)) return 'o-anniversaire';
    return 'a-star';
  }
  function photo(id) {
    var s = String(id || '').toLowerCase();
    if (/duck/.test(s)) return 'duckpin';
    if (/bowling/.test(s)) return 'pistes-neon';
    if (/laser/.test(s)) return 'laser-joueur';
    if (/golf/.test(s)) return 'minigolf';
    if (/billard/.test(s)) return 'billard';
    if (/arcade/.test(s)) return 'arcades';
    if (/playground|plaine/.test(s)) return 'plaine';
    if (/fun_run|funrun|fun-run/.test(s)) return 'fun-run';
    return '';
  }
  // Ce que nomme un mot de la carte d une formule (« 1 partie Minigolf »,
  // « 1 table privée pendant 2 heures ») ou un identifiant d activite, par les
  // memes indices que icone() : l activite, la table, ou rien (des boissons,
  // une condition).
  function genreCompris(s) {
    s = String(s || '').toLowerCase().replace(/_/g, ' ');
    if (/duck/.test(s)) return 'duckpin';
    if (/bowling/.test(s)) return 'bowling';
    if (/laser/.test(s)) return 'laser_game';
    if (/golf/.test(s)) return 'minigolf';
    if (/billard/.test(s)) return 'billard';
    if (/arcade/.test(s)) return 'arcade';
    if (/playground|plaine/.test(s)) return 'plaine';
    if (/fun ?run|fun-run/.test(s)) return 'fun_run';
    if (/\btable\b/.test(s)) return 'table';
    return '';
  }
  function estBoisson(s) { return /boisson|bi[eè]re|cruche|verre/i.test(String(s || '')); }
  function activitesVendables() {
    return (meta && meta.activities ? meta.activities.slice() : []).sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
  }
  function activite(id) { return activitesVendables().filter(function (x) { return x.id === id; })[0] || null; }
  function nomActivite(id) { var a = activite(id); return a ? a.name : id; }
  // LA PARTIE DE LASER, cote client : 20 min de jeu, plus 5 a 10 min
  // d explication des regles et de preparation (Movsar, 2026-09-30). Le jeu
  // vient de la fiche du centre, les 5 du creneau de l arene (25), les 10 du
  // pas de ses departs (30), tous servis par le meta ; la console, elle, garde
  // le creneau entier. Sans ces chiffres, rien n est dit.
  function dureeLaser() {
    var a = activite('laser_game');
    var jeu = Number(a && a.gameMinutes) || 0, creneau = Number(a && a.sessionMinutes) || 0, cycle = Number(a && a.cycleMinutes) || 0;
    return jeu > 0 && creneau > jeu ? { jeu: jeu, creneau: creneau, cycle: Math.max(creneau, cycle) } : null;
  }
  function phraseLaser() {
    var d = dureeLaser();
    if (!d) return '';
    var avant = d.creneau - d.jeu, auPlus = d.cycle - d.jeu;
    // Court (Movsar, 2026-10-01 : « enormement de texte a l endroit des
    // horaires, abuse pour lasergame sur mobile ») : le meme fait, en une ligne.
    return 'Partie de ' + d.jeu + ' min, + ' + (auPlus > avant ? avant + ' à ' + auPlus : avant) + ' min de règles.';
  }

  /* --- Les options d une activite (duree, parties, session) --------------------- */

  // Les grilles viennent du catalogue servi : bowling et duckpin par duree de
  // piste, laser par nombre de parties, Fun Run par session. Une activite sans
  // grille n a pas d option.
  function optionsPour(a) {
    if (!meta || !a) return [];
    if (a.priceType === 'grid_bowling') {
      return (meta.durationOptions || []).map(function (o) { return { cle: 'duration', valeur: Number(o.value), label: o.label || heuresLabel(o.value), prix: Number(o.price) || 0, unite: '/ piste' }; });
    }
    if (a.priceType === 'grid_laser') {
      return (meta.laserOptions || []).map(function (o) { return { cle: 'games', valeur: Number(o.games), label: o.label || (o.games + ' partie' + (o.games > 1 ? 's' : '')), prix: Number(o.price) || 0, unite: '/ personne' }; });
    }
    if (a.priceType === 'grid_fun_run') {
      return (meta.funRunOptions || []).map(function (o) { return { cle: 'minutes', valeur: Number(o.minutes), label: o.label || (o.minutes + ' min'), prix: Number(o.price) || 0, unite: '/ session' }; });
    }
    return [];
  }
  function indexOption(a) {
    var liste = optionsPour(a);
    if (!liste.length) return -1;
    var choix = state.options[a.id] || {};
    for (var i = 0; i < liste.length; i += 1) if (choix[liste[i].cle] === liste[i].valeur) return i;
    // Le defaut : 1 h de piste, 1 partie, la session la plus courte.
    for (var k = 0; k < liste.length; k += 1) if ((liste[k].cle === 'duration' && liste[k].valeur === 1) || (liste[k].cle === 'games' && liste[k].valeur === 1)) return k;
    return 0;
  }
  function optionChoisie(a) { var i = indexOption(a); return i < 0 ? null : optionsPour(a)[i]; }
  // Combien de passages pour CE groupe sur une installation qui n en prend
  // qu une partie a la fois (Fun Run : 5 joueurs). MIROIR de
  // activitySessionCount (lib/activity-catalog) : le serveur fait foi, le gate
  // funrun-rotation-check compare les deux.
  function sessionsPour(a) {
    var capacite = Math.trunc(Number(a && a.capacityPerUnit) || 0);
    var unites = Math.trunc(Number(a && a.units) || 0);
    if (capacite <= 0) return 1;
    var places = capacite * (unites > 0 ? unites : 1);
    return Math.min(1000, Math.max(1, Math.ceil(joueursDe(a) / places)));
  }
  // Le groupe reste le nombre de visiteurs. Chaque activite compte ceux qui
  // y jouent : le serveur recalcule prix, ressources et passages sur eux.
  function bornesJoueurs(a) {
    var tous = Math.max(1, Math.trunc(Number(state.pax) || 1));
    var plafond = Number(a && a.maxPax) || tous;
    var max = Number(a && a.capacityPerUnit) > 0 ? tous : Math.min(tous, plafond);
    return { min: Math.min(max, Math.max(1, Math.trunc(Number(a && a.minPax) || 1))), max: max };
  }
  function joueursDe(a) {
    var tous = Math.max(1, Math.trunc(Number(state.pax) || 1));
    if (!a) return tous;
    var bornes = bornesJoueurs(a);
    var v = Math.trunc(Number((state.options[a.id] || {}).participants));
    return Math.min(bornes.max, Math.max(bornes.min, v > 0 ? v : tous));
  }
  // LES PISTES D UN GROUPE, ET SES TOURS (duckpin : 6 joueurs par piste, 2
  // pistes, reglables dans Etablissement). MIROIR de activityUnitPlan
  // (lib/activity-catalog) : le serveur fait foi, le gate tours-dotation-check
  // compare les deux pour chaque taille de groupe.
  function unitesPour(a) {
    var capacite = Math.trunc(Number(a && a.capacityPerUnit) || 0);
    var dotation = Math.trunc(Number(a && a.units) || 0);
    var joueurs = joueursDe(a);
    var necessaires = capacite > 0 ? Math.ceil(joueurs / capacite) : 1;
    var units = Math.min(state.surMesure ? 1000 : 50, Math.max(1, necessaires));
    var aLaFois = dotation > 0 ? Math.min(dotation, units) : units;
    var tours = Math.min(state.surMesure ? 1000 : 40, Math.max(1, Math.ceil(units / aLaFois)));
    return { units: units, atOnce: aLaFois, tours: tours, lastTour: units - (tours - 1) * aLaFois, perUnit: capacite };
  }
  // Le mot d une unite, lu au catalogue : « par piste » donne piste, « par
  // table et par heure » donne table.
  function motUnite(x) {
    var m = /par ([a-zà-ÿ]+)/i.exec(String((x && x.unitLabel) || ''));
    return m ? m[1] : '';
  }
  // Le Fun Run : « Votre groupe joue en 3 sessions, 5 joueurs a la fois. »
  // Le duckpin : « Pour 18 joueurs : 3 pistes de 6. Le centre en a 2, vous
  // jouez donc en 2 tours de 1 h (2 pistes, puis 1). » Vide quand tout le
  // groupe tient d un coup, et pour les billards, dont les tables se
  // choisissent.
  // La phrase sous les pastilles : les tours d une activite qui tourne, ou la
  // duree d une partie de laser.
  // LES MONTANTS SONT INDICATIFS (Movsar, 2026-10-01 : « les montants
  // affiches a chaque fois sur le formulaire, faut dire que c est a titre
  // informatif ») : le total de la visite, la barre du bas, le recapitulatif
  // et l ecran final le disent. Rien n est encaisse en ligne.
  function noteCarte(a) { var ar = reglageArcade(a); return ar ? (ar.mode === 'time' ? '1 carte par personne. Jeux sans cadeaux en illimité pendant la durée choisie.' : 'Tous les jeux, cadeaux inclus. ' + credits(ar.offer.gameCostMin == null ? ar.config.creditGameCostMin : ar.offer.gameCostMin) + ' à ' + credits(ar.offer.gameCostMax == null ? ar.config.creditGameCostMax : ar.offer.gameCostMax) + ' crédits par jeu. Durée variable.') : noteRotation(a) || (a && a.id === 'bowling' ? phrasePistes(a) : '') || (a && a.id === 'laser_game' ? phraseLaser() : ''); }
  function credits(n) { return Number(n).toLocaleString('fr-BE', { maximumFractionDigits: 2 }); }
  function noteCourte(a) {
    var ar = reglageArcade(a), opt = optionChoisie(a), n;
    if (state.selection.indexOf(a.id) < 0) {
      if (ar) return 'Au temps ou en crédits · offre au choix';
      if (a.priceType === 'grid_bowling') { var durees = optionsPour(a), capacite = a.id === 'bowling' ? Number(meta && meta.center && meta.center.booking && meta.center.booking.normalCapacityPerLane) : Number(a.capacityPerUnit); return (durees.length ? durees[0].label + ' à ' + durees[durees.length - 1].label : 'Durée au choix') + (capacite > 0 ? ' · ' + capacite + ' joueurs / piste' : ''); }
      if (a.priceType === 'grid_fun_run') return 'Durée au choix · sessions selon votre groupe';
      if (a.priceType === 'grid_laser') return 'Nombre de parties au choix';
      if (a.priceType === 'per_unit_hour') return 'Tables et durée au choix';
    }
    if (ar) return ar.mode === 'time' ? '1 carte par personne' : 'Tous les jeux · durée variable';
    if (a.id === 'bowling') { var p = pistesBowling(); n = p && p.pistes; }
    else if (a.priceType === 'grid_bowling') n = unitesPour(a).units;
    else if (a.priceType === 'grid_fun_run') n = sessionsPour(a);
    if (n && opt) return opt.label + ' · ' + n + ' ' + (a.priceType === 'grid_fun_run' ? 'session' : 'piste') + (n > 1 ? 's' : '') + ' × ' + euros(opt.prix) + ' = ' + euros(n * opt.prix);
    if (a.id === 'laser_game' && dureeLaser()) return dureeLaser().jeu + ' min de jeu par partie';
    if (a.priceType === 'per_unit_hour') { var billard = reglageBillard(a); return billard.units + ' table' + (billard.units > 1 ? 's' : '') + ' · ' + heuresLabel(billard.hours); }
    var journee = a.dayAccess || a.id === 'playground';
    return [journee ? 'Accès à la journée' : '', journee && /journ[eé]e/i.test(a.note || '') ? '' : a.note, a.ageRange ? a.ageRange : a.minAge ? 'Dès ' + a.minAge + ' ans' : ''].filter(Boolean).join(' · ');
  }
  function conditionsActivite(a) {
    var lignes = [];
    if (a.ageRange) lignes.push('Âge : ' + a.ageRange + '.');
    else if (a.minAge || a.maxAge) lignes.push('Âge : ' + (a.minAge ? 'dès ' + a.minAge + ' ans' : '') + (a.maxAge ? ', jusqu’à ' + a.maxAge + ' ans' : '') + '.');
    if (a.minHeightCm) lignes.push('Taille minimum : ' + a.minHeightCm + ' cm.');
    if (a.minPax > 1) lignes.push('Au moins ' + a.minPax + ' joueurs.');
    return lignes;
  }
  function sectionsInfoActivite(a) {
    var selectionnee = state.selection.indexOf(a.id) >= 0;
    var ar = reglageArcade(a), option = selectionnee ? optionChoisie(a) : null, sections = [];
    var choix = selectionnee ? [joueursDe(a) + (seCompteParEnfant(a) ? ' enfants' : ' joueurs'), option && option.label].filter(Boolean).join(' · ') : '';
    var tarif = [], capaciteInfo = [], fonctionnement = ar ? [] : [selectionnee ? noteCarte(a) : '', a.note, a.description].filter(Boolean);
    if (ar && selectionnee) tarif.push(ar.cards + ' carte' + (ar.cards > 1 ? 's' : '') + ' · ' + (ar.mode === 'time' ? ar.offer.minutes + ' min / carte' : credits(Number(ar.offer.credits) + Number(ar.offer.bonusCredits || 0)) + ' crédits / carte'), euros(ar.offer.price) + ' / carte', 'Total indicatif : ' + euros(ar.price));
    if (!selectionnee) tarif.push(prixCarte(a, true));
    if (!selectionnee) {
      var booking = meta && meta.center && meta.center.booking;
      if (a.priceType === 'grid_bowling') fonctionnement.push('Choisissez la durée puis le nombre de joueurs. Le nombre de pistes est calculé pour votre groupe.');
      if (a.id === 'bowling' && booking && Number(booking.normalCapacityPerLane) > 0) capaciteInfo.push('Jusqu’à ' + booking.normalCapacityPerLane + ' joueurs par piste.' + (Number(booking.emergencyCapacityPerLane) > Number(booking.normalCapacityPerLane) ? ' Jusqu’à ' + booking.emergencyCapacityPerLane + ' joueurs par piste peuvent être proposés si les pistes manquent. Comptez environ 10 min par joueur pour une partie : une piste plus remplie demande un rythme plus soutenu.' : ''));
      else if (a.capacityPerUnit > 0 && a.priceType === 'grid_bowling') capaciteInfo.push('Jusqu’à ' + a.capacityPerUnit + ' joueurs par piste. Les grands groupes peuvent jouer en plusieurs tours, selon les pistes disponibles.');
      else if (a.capacityPerUnit > 0 && a.priceType === 'grid_fun_run') fonctionnement.push('Choisissez la durée et les participants. Jusqu’à ' + a.capacityPerUnit + ' joueurs jouent par session ; les autres passent à leur tour.');
      if (a.id === 'laser_game') fonctionnement.push('Choisissez le nombre de parties et les joueurs qui participent.', phraseLaser());
      if (a.priceType === 'per_unit_hour') fonctionnement.push('Choisissez vos tables, la durée et les participants. ' + tablesMax(a) + ' tables au plus ; le tarif dépend des tables et des heures choisies.');
      if (ar) fonctionnement.push('Choisissez le temps de jeu ou une carte en crédits, puis les participants.');
      if (a.priceType === 'per_pax') fonctionnement.push(seCompteParEnfant(a) ? 'Indiquez les enfants qui jouent : le tarif est calculé sur eux.' : 'Indiquez les joueurs qui participent : chacun paie son entrée.');
    }
    if (!ar && selectionnee) {
      var unitaire = option ? Number(option.prix) : tarifConnu(a) ? Number(a.priceValue) : null;
      if ((a.priceType === 'per_pax' || a.priceType === 'grid_laser') && unitaire != null && isFinite(unitaire)) tarif.push(euros(unitaire) + ' / ' + (seCompteParEnfant(a) ? 'enfant' : 'personne') + ' × ' + joueursDe(a) + ' = ' + euros(Math.round(unitaire * joueursDe(a) * 100) / 100));
      else if (a.priceType === 'per_unit_hour') {
        var r = reglageBillard(a), total = prixBillard(a, r.units, r.hours);
        tarif.push(r.units + ' table' + (r.units > 1 ? 's' : '') + ' · ' + heuresLabel(r.hours) + (total == null ? ' · Prix à l’accueil.' : ' · ' + euros(a.priceValue) + ' / table / heure = ' + euros(total) + '.'));
        fonctionnement.push(tablesMax(a) + ' tables au plus. Le nombre de tables et la durée déterminent le prix.');
      } else if (option) tarif.push(noteCourte(a));
      else tarif.push(prixCarte(a));
      if (seCompteParEnfant(a)) fonctionnement.push(texteCompteur(compteurDe(a)));
    }
    sections.push({ titre: selectionnee ? 'Votre sélection' : 'Le tarif', lignes: [choix].concat(tarif).filter(Boolean) });
    if (fonctionnement.length) sections.push({ titre: 'Comment ça se passe', lignes: fonctionnement });
    if (capaciteInfo.length) sections.push({ titre: 'Les pistes et votre groupe', lignes: capaciteInfo });
    var conditions = conditionsActivite(a);
    if (conditions.length) sections.push({ titre: 'Accès et participants', lignes: conditions });
    var tarifs = optionsPour(a).map(function (o) { return o.label + ' : ' + euros(o.prix) + ' ' + o.unite; });
    if (ar) {
      tarifs = ar.time.map(function (o) { if (ar.mode === 'time' && o.id === ar.offer.id) o = ar.offer; return o.minutes + ' min à volonté : ' + euros(o.price) + ' / carte, une carte par personne.'; })
        .concat(ar.credit.map(function (o) { if (ar.mode === 'credit' && o.id === ar.offer.id) o = ar.offer; return euros(o.price) + ' / carte : ' + credits(o.credits) + ' crédits + ' + credits(o.bonusCredits || 0) + ' bonus = ' + credits(Number(o.credits) + Number(o.bonusCredits || 0)) + ' crédits.'; }));
      var mode = ar.mode === 'time' ? 'Au temps' : 'En crédits';
      var lisible = function (d) { return d === 'Une carte par personne. Jeux sans cadeaux en illimité pendant la durée choisie ; jeux permettant de gagner des cadeaux exclus.' ? 'Une carte par personne. Accès illimité pendant la durée choisie, hors jeux permettant de gagner des cadeaux.' : d; };
      var tempsInfo = lisible(ar.config.timedDescription);
      // Comme ses couts par jeu, la carte retenue garde la description que le
      // serveur a confirmee avec son prix : elle prime sur le catalogue en cache.
      var retenue = lisible(ar.offer.description || (ar.mode === 'time' ? ar.config.timedDescription : ar.config.creditDescription));
      sections.push({ titre: selectionnee ? mode : 'Deux façons de jouer', lignes: selectionnee ? [retenue].concat(ar.mode === 'credit' ? ['Tous les jeux, cadeaux inclus · ' + credits(ar.offer.gameCostMin == null ? ar.config.creditGameCostMin : ar.offer.gameCostMin) + ' à ' + credits(ar.offer.gameCostMax == null ? ar.config.creditGameCostMax : ar.offer.gameCostMax) + ' crédits par jeu.'] : []) : [tempsInfo, ar.config.creditDescription] });
    }
    if (tarifs.length) sections.push({ titre: 'Les offres disponibles', lignes: tarifs });
    sections.push({ titre: 'À savoir', lignes: ['Montants indicatifs, recalculés selon vos choix avant confirmation. Aucun paiement en ligne ; règlement à l’accueil.'] });
    sections.forEach(function (section) { section.lignes = section.lignes.filter(function (line, i, all) { return line && all.indexOf(line) === i; }); });
    return sections;
  }
  function texteSectionsInfo(sections) {
    return sections.map(function (s) { return s.titre + '\n' + s.lignes.filter(Boolean).join('\n\n'); }).join('\n\n');
  }
  function boutonInfo(attribut, id, titre, sections, image) {
    return '<button type="button" class="fg-info-btn" ' + attribut + '="' + esc(id) + '" data-info-title="' + esc(titre) + '" data-info-text="' + esc(texteSectionsInfo(sections)) + '" data-info-sections="' + esc(JSON.stringify(sections)) + '" data-info-image="' + esc(image || '') + '" aria-label="Informations sur ' + esc(titre) + '" aria-haspopup="dialog"><svg class="fg-info-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle class="fg-info-dot" cx="12" cy="7.5" r=".8"/></svg></button>';
  }
  function htmlInfo(a) {
    return '<div class="fg-card__info"><p class="fg-card__rot">' + esc(typo(noteCourte(a))) + '</p>' + boutonInfo('data-activity-info', a.id, a.name, sectionsInfoActivite(a), a.id) + '</div>';
  }
  function htmlInfoFormule(f, contexte) {
    contexte = contexte || {};
    var surMesure = !!contexte.surMesure, n = Number(contexte.pax) || state.pax;
    var unite = f.type === 'per_lane' ? 'la piste' : f.kidsOnly ? 'par enfant' : 'par personne';
    var sections = [{ titre: 'Le tarif', lignes: [euros(f.price) + ' ' + unite] }, { titre: 'Ce qui est inclus', lignes: (f.desc || []).slice() }];
    if (!surMesure && state.formuleId === f.id && f.type === 'per_pax' && !f.kidsOnly) sections[0].lignes.push(euros(f.price) + ' / personne × ' + n + ' = ' + euros(Math.round(Number(f.price) * n * 100) / 100));
    if (!surMesure && f.kidsOnly && state.formuleId === f.id) sections[0].lignes.push(textesEnfants(f).prix, textesEnfants(f).adultes);
    var notes = (f.notes || []).filter(function (note) { return !(/cadeaux/i.test(note) && (f.desc || []).some(function (d) { return /cadeaux/i.test(d); })); });
    var regles = reglesFormule(f).map(function (r) { return f.kidsOnly && f.minPax > 1 && r === 'dès ' + f.minPax + ' personnes' ? 'dès ' + f.minPax + ' enfants' : r; }).filter(function (r) { return !notes.some(function (note) { return /vacances/i.test(r) && /vacances/i.test(note) || /personnes|enfants/i.test(r) && /minimum/i.test(note) || /avant|de [0-9]|à partir/i.test(r) && /[0-9]h/i.test(note); }); }).concat(notes).filter(Boolean);
    if (f.kidsOnly) regles.push('Pour les enfants de ' + f.kidsOnly.ageMin + ' à ' + f.kidsOnly.ageMax + ' ans.', 'Les adultes qui accompagnent ne paient pas la formule.');
    if (regles.length) sections.push({ titre: 'Conditions de cette formule', lignes: regles.filter(function (s, i, all) { return all.indexOf(s) === i; }) });
    var acces = [];
    (f.desc || []).forEach(function (d) {
      var genre = genreCompris(d), ids = { bowling: 'bowling', duckpin: 'duckpin_bowling', laser_game: 'laser_game', minigolf: 'minigolf_blacklight', billard: 'billards', arcade: 'arcade_time', plaine: 'playground', fun_run: 'fun_run' };
      var a = activite(ids[genre]);
      if (a) { var conditions = conditionsActivite(a); if (a.id === 'laser_game' && phraseLaser()) conditions.push(phraseLaser()); if (conditions.length) acces.push(a.name + ' : ' + conditions.join(' ')); }
    });
    if (acces.length) sections.push({ titre: 'L’accès aux activités incluses', lignes: acces });
    var duree = !surMesure && dureesCache[state.date + '|' + state.pax] && dureesCache[state.date + '|' + state.pax][f.id];
    if (duree) sections.push({ titre: 'Votre temps sur place', lignes: [texteDuree(duree)] });
    sections.push({ titre: 'À savoir', lignes: [surMesure ? 'Le programme et le montant sont à confirmer avec l’équipe pour votre groupe.' : 'Montants indicatifs, recalculés selon vos choix avant confirmation. Aucun paiement en ligne ; règlement à l’accueil.'] });
    var bref = (f.minPax > 1 ? 'Dès ' + f.minPax + (f.kidsOnly ? ' enfants' : ' personnes') : f.kidsOnly ? f.kidsOnly.ageMin + ' à ' + f.kidsOnly.ageMax + ' ans' : [f.validDays && f.validDays.length && f.validDays.length < 7 ? joursLisibles(f.validDays) : '', plageLisible(f.timeLimit)].filter(Boolean).join(' · ') || 'Voir les conditions');
    var illimite = (f.desc || []).filter(function (d) { return /^toutes les activit[eé]s illimit[eé]es$/i.test(String(d).trim()); })[0];
    if (illimite) bref = illimite + ' · ' + bref;
    var image = (f.desc || []).filter(function (d) { return photo(d); })[0] || '';
    if (!image && (f.desc || []).some(function (d) { return /toutes les activit[eé]s/i.test(d); })) {
      var illimitee = activitesVendables().filter(function (a) { return photo(a.id); })[0];
      image = illimitee ? illimitee.id : '';
    }
    return '<div class="fg-card__info fg-for__info"><p class="fg-card__rot">' + esc(bref) + '</p>' + boutonInfo('data-formula-info', f.id, f.name, sections, image) + '</div>';
  }
  // LA FICHE D UNE ACTIVITE (Movsar, 2026-10-07 : « description complete quand
  // meme », mais belle, jamais toute la page, et pas « IA »). Le texte reste
  // mot pour mot celui des sections, que les gates comparent a data-info-text :
  // seules des balises s ajoutent, pour mettre le prix en avant, poser les
  // conditions en tuiles et les tarifs en liste.
  var GENRES_INFO = { 'Le tarif': 'lead', 'Votre sélection': 'lead', 'Accès et participants': 'faits', 'Les offres disponibles': 'tarifs', 'Ce qui est inclus': 'inclus', 'À savoir': 'note' };
  function montantsEnAvant(texte) { return esc(texte).replace(/\d[\d   .,]*\s?€/g, function (m) { return '<b class="fg-info-num">' + m + '</b>'; }); }
  function ligneCoupee(l, classe) {
    var i = l.indexOf(' : '), k, sep, v;
    if (i > 0) { k = l.slice(0, i); sep = ' : '; v = l.slice(i + 3); }
    else { var m = /^(Au moins|Dès|Jusqu’à) (.+)$/.exec(l); if (!m) return '<p class="' + classe + '"><span class="' + classe + '__v">' + esc(l) + '</span></p>'; k = m[1]; sep = ' '; v = m[2]; }
    var fin = classe === 'fg-info-fait' && /\.$/.test(v) ? '.' : '';
    if (fin) v = v.slice(0, -1);
    return '<p class="' + classe + '"><span class="' + classe + '__k">' + esc(k) + '</span><span class="fg-info-sep">' + sep + '</span><span class="' + classe + '__v">' + esc(v) + (fin ? '<span class="fg-info-sep">.</span>' : '') + '</span></p>';
  }
  function htmlSectionInfo(s) {
    var genre = GENRES_INFO[s.titre] || 'texte';
    var lignes = s.lignes.filter(Boolean).map(function (l, i) {
      if (genre === 'lead') return '<p' + (i ? '' : ' class="fg-info-prix"') + '>' + montantsEnAvant(l) + '</p>';
      if (genre === 'faits') return ligneCoupee(l, 'fg-info-fait');
      if (genre === 'tarifs') return ligneCoupee(l, 'fg-info-tarif');
      return '<p>' + esc(l) + '</p>';
    });
    return '<section class="fg-info-section fg-info-section--' + genre + '"><h3>' + esc(s.titre) + '</h3>\n' + lignes.join('\n\n') + '</section>';
  }
  function placerInfoFenetre(demander) {
    if (!activityDialog || !activityDialog.open) return;
    // Sur telephone, la fiche est un tiroir pose en bas de ce qu on voit.
    var tiroir = window.innerWidth < 600;
    activityDialog.classList.toggle('is-sheet', tiroir);
    if (!EMBED) return;
    activityDialog.classList.toggle('is-short', ecranHote > 0 && ecranHote <= 500);
    if (tiroir) {
      var haut = 0, bas = window.innerHeight;
      if (ecranHote && hautCadre !== null) { haut = Math.max(0, -hautCadre); bas = Math.min(window.innerHeight, ecranHote - hautCadre); }
      if (bas <= haut) return;
      activityDialog.style.maxHeight = Math.max(120, bas - haut - 16) + 'px';
      activityDialog.style.top = Math.round(bas - 8) + 'px';
      return;
    }
    centrerDansLaVue(activityDialog, demander);
    if (ecranHote && hautCadre !== null) {
      var debutVisible = Math.max(0, -hautCadre), finVisible = Math.min(window.innerHeight, ecranHote - hautCadre);
      if (finVisible > debutVisible) {
        var hauteurMax = Math.max(80, Math.min(ecranHote - 24, finVisible - debutVisible - 16));
        activityDialog.style.maxHeight = hauteurMax + 'px';
        activityDialog.style.setProperty('--fi-max', hauteurMax + 'px');
        var demiHauteur = Math.min(activityDialog.offsetHeight, hauteurMax) / 2;
        activityDialog.style.top = Math.round(Math.max(debutVisible + demiHauteur + 8, Math.min(finVisible - demiHauteur - 8, ecranHote / 2 - hautCadre))) + 'px';
      }
    }
  }
  var activityDialog, infoOpener, infoResizeObserver, infoCentreDemande = false;
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-activity-info], [data-formula-info]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (btn.dataset.formulaInfo && gridFor.contains(btn)) {
      var formuleInfo = ((meta && meta.formules) || []).filter(function (f) { return f.id === btn.dataset.formulaInfo; })[0];
      if (formuleInfo) {
        var actualisationInfo = doc.createElement('div'); actualisationInfo.innerHTML = htmlInfoFormule(formuleInfo);
        var boutonActualise = $('[data-formula-info]', actualisationInfo);
        btn.dataset.infoText = boutonActualise.dataset.infoText; btn.dataset.infoSections = boutonActualise.dataset.infoSections;
      }
    }
    if (!activityDialog) {
      activityDialog = doc.createElement('dialog'); activityDialog.className = 'fg-info-dialog';
      activityDialog.setAttribute('aria-labelledby', 'fgInfoTitle');
      activityDialog.innerHTML = '<div class="fg-info-hero"><img class="fg-info-photo" alt=""></div><span class="fg-info-grip" aria-hidden="true"></span><button type="button" class="fg-info-close" aria-label="Fermer les informations"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button><div class="fg-info-body" tabindex="0" role="region" aria-labelledby="fgInfoTitle"><h2 id="fgInfoTitle"></h2><div class="fg-info-text"></div></div>';
      doc.body.appendChild(activityDialog);
      if ('ResizeObserver' in window) infoResizeObserver = new ResizeObserver(function () { placerInfoFenetre(false); });
      $('.fg-info-photo', activityDialog).addEventListener('load', function () { placerInfoFenetre(false); });
      $('.fg-info-close', activityDialog).addEventListener('click', function () { activityDialog.close(); });
      activityDialog.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Tab' || !activityDialog.open) return;
        var accessibles = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', activityDialog).filter(function (el) { return el.getClientRects().length && !el.hidden; });
        if (!accessibles.length) return;
        var i = accessibles.indexOf(doc.activeElement), prochain = i < 0 ? (ev.shiftKey ? accessibles.length - 1 : 0) : (i + (ev.shiftKey ? -1 : 1) + accessibles.length) % accessibles.length;
        ev.preventDefault(); accessibles[prochain].focus({ preventScroll: true });
      });
      activityDialog.addEventListener('click', function (ev) { var r = activityDialog.getBoundingClientRect(); if (ev.target === activityDialog && (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)) activityDialog.close(); });
      activityDialog.addEventListener('close', function () { if (infoResizeObserver) infoResizeObserver.disconnect(); infoCentreDemande = false; doc.body.style.overflow = activityDialog._overflow; var type = infoOpener && infoOpener.dataset.formulaInfo ? 'formula' : 'activity'; var id = infoOpener && infoOpener.dataset[type + 'Info']; var focus = infoOpener && (infoOpener.isConnected ? infoOpener : $('[data-' + type + '-info="' + id + '"]', $('.fg-scene.is-active') || doc)); if (focus) focus.focus({ preventScroll: true }); });
    }
    infoOpener = btn;
    $('#fgInfoTitle', activityDialog).textContent = btn.dataset.infoTitle;
    var contenu = $('.fg-info-text', activityDialog), sections;
    try { sections = JSON.parse(btn.dataset.infoSections || 'null'); } catch (_) { sections = null; }
    if (sections) contenu.innerHTML = sections.map(htmlSectionInfo).join('\n\n');
    else contenu.textContent = btn.dataset.infoText;
    var image = $('.fg-info-photo', activityDialog), centre = meta && meta.center && meta.center.id || CENTER;
    var sujet = btn.dataset.infoImage || btn.dataset.activityInfo;
    var p = centre === 'libramont' ? photo(sujet) : centre === 'gembloux' && sujet === 'golf_oclock' ? 'gembloux-golf-salle' : '';
    image.hidden = !p; $('.fg-info-hero', activityDialog).classList.toggle('has-photo', !!p); activityDialog.classList.toggle('has-photo', !!p); if (p) { image.src = '/assets/fungalaxy/' + p + '-800.webp'; image.alt = btn.dataset.infoTitle; } else { image.removeAttribute('src'); image.alt = ''; }
    activityDialog._overflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';
    activityDialog.showModal(); $('.fg-info-body', activityDialog).scrollTop = 0; placerInfoFenetre(false); $('.fg-info-close', activityDialog).focus({ preventScroll: true });
    if (infoResizeObserver) infoResizeObserver.observe(activityDialog);
    // Le pont existant renvoie pinlane:vue meme si la hauteur ne change pas.
    // Redemander la vue apres le focus evite de reutiliser le scroll precedent.
    if (EMBED) { infoCentreDemande = true; poster({ type: 'pinlane:height', height: derniereHauteur || Math.max(body.scrollHeight, body.offsetHeight) }); }
  }, true);
  function reglageArcade(a) {
    var c = a && a.id === 'arcade_time' && a.arcadeOffers;
    if (!c || c.enabled === false) return null;
    function valide(o) { return o.enabled !== false && /^[a-z0-9][a-z0-9-]{0,59}$/.test(String(o.id)) && o.price != null && isFinite(Number(o.price)) && Number(o.price) >= 0; }
    var time = (c.timeOffers || []).filter(function (o) { return valide(o) && Number(o.minutes) > 0; });
    var credit = (c.creditOffers || []).filter(function (o) { return valide(o) && Number(o.credits) >= 0 && Number(o.bonusCredits || 0) >= 0; });
    if (!time.length && !credit.length) return null;
    var opt = state.options[a.id] || {}, mode = opt.arcadeMode === 'credit' ? 'credit' : 'time';
    if (!(mode === 'time' ? time : credit).length) mode = time.length ? 'time' : 'credit';
    var list = mode === 'time' ? time : credit;
    var id = opt.arcadeOfferId || (mode === 'time' ? opt.arcadeTimeOfferId : opt.arcadeCreditOfferId);
    var offer = list.filter(function (o) { return o.id === id; })[0] || list[0];
    if (opt.arcadeSnapshot && opt.arcadeSnapshot.mode === mode && opt.arcadeSnapshot.id === offer.id) offer = opt.arcadeSnapshot;
    var cards = mode === 'time' ? joueursDe(a) : Math.min(1000, Math.max(1, Math.trunc(opt.cards == null ? joueursDe(a) : Number(opt.cards) || 1)));
    return { mode: mode, offer: offer, offers: list, time: time, credit: credit, cards: cards, config: c, price: Math.round(Number(offer.price) * 100) * cards / 100 };
  }
  function choixArcade(a, opt, cle, valeur, avant) {
    avant = avant || reglageArcade(a); opt = Object.assign({}, opt || {}); delete opt.arcadeSnapshot;
    if (cle === 'arcadeMode') {
      if (avant) opt[avant.mode === 'time' ? 'arcadeTimeOfferId' : 'arcadeCreditOfferId'] = avant.offer.id;
      opt.arcadeMode = valeur; opt.arcadeOfferId = opt[valeur === 'time' ? 'arcadeTimeOfferId' : 'arcadeCreditOfferId'] || '';
    } else { opt[cle] = valeur; if (cle === 'arcadeOfferId') opt[avant.mode === 'time' ? 'arcadeTimeOfferId' : 'arcadeCreditOfferId'] = valeur; }
    return opt;
  }
  function snapshotArcade(a) {
    var ar = reglageArcade(a); if (!ar) return null;
    var o = ar.offer;
    return { activityId: a.id, participants: joueursDe(a), cards: ar.cards, arcadeMode: ar.mode,
      arcadeOfferId: o.id, price: ar.price, arcadeOffer: Object.assign({}, o, { mode: ar.mode,
        totalCredits: Number(o.credits || 0) + Number(o.bonusCredits || 0), gameCostMin: o.gameCostMin == null ? ar.config.creditGameCostMin : o.gameCostMin,
        gameCostMax: o.gameCostMax == null ? ar.config.creditGameCostMax : o.gameCostMax,
        description: o.description || (ar.mode === 'time' ? ar.config.timedDescription : ar.config.creditDescription) || '' }) };
  }
  function detailArcade(it, complet) {
    var o = it && it.arcadeOffer; if (!o) return '';
    var n = Number(it.cards) || Number(it.participants) || 1;
    var text = n + ' carte' + (n > 1 ? 's' : '') + ' · ';
    text += o.mode === 'time' ? minutesLabel(o.minutes) + ' par carte' + (complet ? ' · 1 carte par personne · jeux sans cadeaux en illimité' : '')
      : credits(o.credits || 0) + ' crédits + ' + credits(o.bonusCredits || 0) + ' bonus = ' + credits(o.totalCredits == null ? Number(o.credits || 0) + Number(o.bonusCredits || 0) : o.totalCredits) + ' crédits par carte' + (complet ? ' · tous les jeux, cadeaux inclus · ' + credits(o.gameCostMin) + ' à ' + credits(o.gameCostMax) + ' crédits/jeu' : '');
    return text + ' · ' + euros(o.price) + ' × ' + n + ' = ' + euros(it.price) + (complet && o.description ? ' · ' + o.description : '');
  }
  // LES PISTES DE BOWLING DU GROUPE (Movsar, 2026-10-01 : « au-dela de 6
  // joueurs c est une autre piste en plus, payee : prix par temps et par
  // piste, 6 joueurs max par piste ; faut que ce soit visible quand ils
  // choisissent les horaires, pour comprendre pourquoi c est plus cher »).
  // MIROIR de getBilledLaneCount (lib/booking-config) : services equilibres,
  // pistes de confort, repli sur la capacite de secours. Le serveur fait foi.
  // Rien quand le centre vend le bowling a la partie (bowlingPricing, N4).
  function pistesBowling() {
    var b = meta && meta.center && meta.center.booking;
    if (!b || b.bowlingPricing) return null;
    var parc = Math.max(1, Number(b.laneCount) || 8);
    var confort = Math.max(1, Number(b.normalCapacityPerLane) || 6);
    var secours = Math.max(confort, Number(b.emergencyCapacityPerLane) || confort);
    var joueurs = state.onglet === 'formules' ? joueursDemandes() : joueursDe(activite('bowling'));
    var cr = !state.surMesure && state.creneau;
    var item = cr && cr.reponse.program && (cr.reponse.program.items || []).filter(function (it) { return it.activityId === 'bowling'; })[0];
    var capacite = cr && (cr.slot.bowlingCapacity || (item && item.bowlingCapacity));
    if (capacite && capacite.emergency) return { pistes: Number(item && item.billedLaneCount) || Number(cr.slot.laneCount) || 1, parPiste: capacite.emergencyCapacityPerLane, joueurs: joueurs, services: item && item.services ? item.services.length : 1 };
    var services = [joueurs];
    if (joueurs > parc * secours) {
      var n = Math.ceil(joueurs / (parc * confort)), base = Math.floor(joueurs / n), reste = joueurs % n;
      services = [];
      for (var i = 0; i < n; i += 1) services.push(base + (i < reste ? 1 : 0));
    }
    var pistes = services.reduce(function (t, j) {
      var req = Math.ceil(j / confort);
      return t + (req > parc && j <= parc * secours ? parc : req);
    }, 0);
    return { pistes: pistes, parPiste: confort, joueurs: joueurs, services: services.length };
  }
  // LE CALCUL DES PISTES, LE MEME POUR LE BOWLING, LE DUCKPIN ET LE FUN RUN
  // (Movsar, 2026-10-01 : « ici faut dire joueurs max par piste, explique
  // bien », puis « t abuses sur la description du duckpin ») : court, le
  // maximum puis le calcul, « 6 joueurs max par piste : 3 pistes × 39 € =
  // 117 € ». Une seule piste : « 6 joueurs max par piste ».
  function calculPistes(parPiste, pistes, prixPiste, mot) {
    mot = mot || 'piste';
    var max = parPiste + ' joueurs max par ' + mot;
    if (pistes < 2) return max;
    return max + ' : ' + pistes + ' ' + mot + 's' + (prixPiste > 0 ? ' × ' + euros(prixPiste) + ' = ' + euros(prixPiste * pistes) : '');
  }
  function phrasePistes(a) {
    var p = pistesBowling();
    if (!p) return '';
    var opt = optionChoisie(a);
    var prix = opt ? Number(opt.prix) || 0 : 0;
    var b = meta && meta.center && meta.center.booking;
    var secours = b && Number(b.emergencyCapacityPerLane);
    return calculPistes(p.parPiste, p.pistes, prix).replace('joueurs max par piste', secours > p.parPiste ? 'joueurs par piste en confort' : 'joueurs max par piste') + (p.pistes > 1 && p.services > 1 ? ', en ' + p.services + ' tours' : '') + '.'
      + (secours > p.parPiste ? ' Selon les pistes libres, jusqu’à ' + secours + ' joueurs par piste (environ 10 min par joueur pour une partie).' : '');
  }
  function noteRotation(a) {
    if (a.priceType === 'grid_fun_run') {
      var n = sessionsPour(a);
      var places = Math.trunc(Number(a.capacityPerUnit) || 0) * Math.max(1, Math.trunc(Number(a.units) || 1));
      if (!(places > 0)) return '';
      var optF = optionChoisie(a);
      return calculPistes(places, n, optF ? Number(optF.prix) || 0 : 0, 'session') + '.';
    }
    var mot = motUnite(a);
    if (a.priceType !== 'grid_bowling' || !mot || !(Number(a.capacityPerUnit) > 0)) return '';
    var p = unitesPour(a);
    var opt = optionChoisie(a);
    var calcul = calculPistes(p.perUnit, p.units, opt ? Number(opt.prix) || 0 : 0, mot);
    if (p.tours < 2) return calcul + '.';
    return calcul + ', en ' + p.tours + ' tours de ' + dureeExacte(Math.round((opt ? Number(opt.valeur) : 1) * 60)) + '.';
  }
  // LES BILLARDS : le client choisit ses tables (une par defaut, jusqu a ce
  // que le centre en a) et ses heures (le pas du catalogue). Movsar,
  // 2026-09-28 : « tu dois permettre de choisir combien de tables ils veulent
  // et c 10 euro par heure et par table ». Le serveur refuse au-dela des
  // tables du centre : l ecran n en propose jamais plus.
  function tablesMax(a) {
    var d = Math.trunc(Number(a && a.units) || 0);
    var max = d > 0 ? Math.min(50, d) : 4;
    // UNE reservation en prend au plus `maxUnitsPerBooking` (5 tables de
    // billard, catalogue) ; le serveur refuse au-dela.
    var plafond = Math.trunc(Number(a && a.maxUnitsPerBooking) || 0);
    return plafond > 0 ? Math.min(max, plafond) : max;
  }
  // Les enfants qui vont a la plaine de jeux : le groupe par defaut (le prix
  // d avant), jamais plus que le groupe, jamais moins d un.
  function enfantsPlaine(a) {
    return joueursDe(a);
  }
  function seCompteParEnfant(a) { return Boolean(a) && a.priceType === 'per_pax' && /enfant/i.test(a.unitLabel || ''); }
  // UN COMPTEUR PLUTOT QUE DES PASTILLES (Movsar, 2026-09-30) : les tables de
  // billard et les enfants de la plaine de jeux.
  function compteurDe(a, cle) {
    if (!a) return null;
    var ar = reglageArcade(a);
    if (cle === 'cards' && ar && ar.mode === 'credit') return { cle: 'cards', titre: 'Cartes', mot: 'carte', min: 1, max: 1000, n: ar.cards, muet: true };
    if (cle === 'units' && a.priceType === 'per_unit_hour') {
      var mot = motUnite(a) || 'unité';
      return { cle: 'units', titre: mot.charAt(0).toUpperCase() + mot.slice(1) + 's', mot: mot, min: 1, max: tablesMax(a), n: reglageBillard(a).units };
    }
    var bornes = bornesJoueurs(a), enfant = seCompteParEnfant(a);
    return { cle: 'participants', titre: enfant ? 'Enfants' : 'Joueurs', mot: enfant ? 'enfant' : 'joueur', min: bornes.min, max: bornes.max, n: joueursDe(a), muet: true };
  }
  function texteCompteur(c) {
    if (c.muet) return '';
    if (c.cle === 'units') return c.max + ' ' + c.mot + (c.max > 1 ? 's' : '') + ' au plus';
    var autres = state.pax - c.n;
    if (autres > 1) return 'Les ' + autres + ' autres ne paient pas l’entrée.';
    return autres === 1 ? 'L’autre ne paie pas l’entrée.' : 'Tout le groupe y va.';
  }
  function heuresPossibles(a) {
    var pas = Math.max(15, Number(a && a.stepMinutes) || 60);
    var min = Math.max(15, Number(a && a.minMinutes) || 60);
    var max = Math.max(min, Number(a && a.maxMinutes) || min);
    var out = [];
    for (var m = min; m <= max; m += pas) out.push(m / 60);
    return out.length ? out : [1];
  }
  function reglageBillard(a) {
    var choix = state.options[a.id] || {};
    var tables = Math.min(tablesMax(a), Math.max(1, Math.trunc(Number(choix.units) || 1)));
    var heures = heuresPossibles(a);
    return { units: tables, hours: heures.indexOf(Number(choix.hours)) >= 0 ? Number(choix.hours) : heures[0] };
  }
  // UN PRIX QUI N EST PAS EN LIGNE N EST PAS « SUR PLACE » (Movsar,
  // 2026-10-01 : « pq sur place ici ? tout est a payer sur place »). Tout se
  // regle a l accueil ; ce qui distingue ces lignes, c est que le centre n a
  // pas saisi leur tarif : il se donne a l accueil.
  var PRIX_ACCUEIL = 'prix à l’accueil';
  function sansPrixEnLigne(items) {
    return (items || []).filter(function (it) { return !(it.priceKnown === true || (it.priceKnown !== false && Number(it.price) > 0)); })
      .map(function (it) { return it.name || nomActivite(it.activityId); });
  }
  function nomsSansPrix(items) { var n = sansPrixEnLigne(items); return n.length ? joindreListe(n, ' et ') : 'les activités'; }
  function totalIndicatif(complet, items) { return complet ? 'Total indicatif' : 'Total indicatif, sans ' + nomsSansPrix(items) + ' (' + PRIX_ACCUEIL + ')'; }
  // Le montant d une ligne de billard : tables x heures x tarif du centre,
  // null quand le centre n a pas saisi de tarif (prix a l accueil).
  function tarifConnu(a) {
    return a && a.priceValue != null && isFinite(Number(a.priceValue)) && Number(a.priceValue) >= 0;
  }
  function prixBillard(a, tables, heures) {
    return tarifConnu(a) ? Math.round(Number(a.priceValue) * tables * heures * 100) / 100 : null;
  }
  // `libre` : le prix de base, sans la ligne que la reservation a choisie
  // (la demande sur mesure montre le tarif, l equipe composera les lignes).
  function prixCarte(a, libre) {
    if (!meta) return '';
    var choisie = !libre && state.selection.indexOf(a.id) >= 0;
    var ar = reglageArcade(a);
    if (ar) return choisie ? euros(ar.price) + ' · ' + ar.cards + ' carte' + (ar.cards > 1 ? 's' : '') : 'Dès ' + euros(Math.min.apply(null, ar.time.concat(ar.credit).map(function (o) { return Number(o.price); }))) + ' / carte';
    // Des billards choisis : le montant de SA ligne, et ce qu il paie.
    if (a.priceType === 'per_unit_hour' && choisie) {
      var r = reglageBillard(a);
      var total = prixBillard(a, r.units, r.hours);
      var motTable = motUnite(a) || 'unité';
      // « 3 tables » et « 2 heures » ne se coupent pas en fin de ligne.
      var quoi = insecable(r.units + ' ' + motTable + (r.units > 1 ? 's' : '')) + ', ' + insecable(heuresLabel(r.hours));
      return (total == null ? 'Prix à l’accueil' : euros(total)) + ' · ' + quoi;
    }
    if (choisie && seCompteParEnfant(a) && tarifConnu(a)) {
      var enfants = enfantsPlaine(a);
      return euros(Math.round(Number(a.priceValue) * enfants * 100) / 100) + ' · ' + insecable(enfants + ' enfant' + (enfants > 1 ? 's' : ''));
    }
    var opt = optionChoisie(a);
    if (opt) {
      if (choisie && a.priceType === 'grid_laser') return euros(Math.round(opt.prix * joueursDe(a) * 100) / 100) + ' · ' + insecable(joueurs(joueursDe(a)));
      if (choisie) return euros(opt.prix) + ' ' + opt.unite;
      var mini = Math.min.apply(null, optionsPour(a).map(function (o) { return o.prix; }).filter(function (p) { return p >= 0; }));
      return isFinite(mini) ? 'Dès ' + euros(mini) + ' ' + opt.unite : 'Prix à l’accueil';
    }
    var unite = a.unitLabel ? ' ' + a.unitLabel.replace(/^par /, '/ ') : '';
    switch (a.priceType) {
      case 'per_pax':
        if (choisie && tarifConnu(a)) return euros(Math.round(Number(a.priceValue) * joueursDe(a) * 100) / 100) + ' · ' + insecable(joueurs(joueursDe(a)));
      case 'per_unit_hour':
        return tarifConnu(a) ? 'Dès ' + euros(a.priceValue) + unite : 'Prix à l’accueil';
      default:
        return tarifConnu(a) ? euros(a.priceValue) + unite : 'Prix à l’accueil';
    }
  }

  /* --- Le fil des etapes ------------------------------------------------------- */

  // UNE BARRE SEGMENTEE, PAS UN COLLIER DE PASTILLES. Cinq segments qui se
  // remplissent, un numero a deux chiffres et un libelle sous chacun. Le
  // mouvement dit ce qui vient de se passer : en avancant, le segment de
  // l etape atteinte se REMPLIT et celui qu on quitte passe au blanc ; en
  // reculant, celui qu on quitte se VIDE ; a la fin, les cinq se balaient une
  // fois, de gauche a droite. Rien ne bouge en continu. Le rendu est refait a
  // chaque changement d ecran (les ecrans caches sont en `display: none`),
  // donc chaque animation part exactement quand l ecran apparait.
  var etapePrecedente = -1;
  function rendreEtapes() {
    var liste = etapes();
    var total = liste.length;
    var fin = sceneCourante === 'fin';
    var actif = Math.min(parcours().indexOf(sceneCourante), total - 1);
    var avant = etapePrecedente;
    etapePrecedente = fin ? total : actif;
    var sens = avant < 0 ? 'depart' : fin ? 'fin' : actif > avant ? 'avance' : actif < avant ? 'recule' : 'reste';
    var deux = function (n) { return String(n).padStart(2, '0'); };
    var html = liste.map(function (e, i) {
      var cls = fin || i < actif ? 'is-done' : (i === actif ? 'is-active' : '');
      var geste = '';
      if (sens === 'avance' && i === actif) geste = ' is-filling';
      if (sens === 'avance' && i === avant) geste = ' is-settling';
      if (sens === 'recule' && i === avant) geste = ' is-draining';
      if (sens === 'fin') geste = ' is-sweep';
      var cliquable = i < actif && !fin;
      // Le rang « /05 » ne s affiche que dans une colonne etroite (regle CSS),
      // la ou les quatre autres libelles tombent.
      var inner = '<span class="fg-steps__seg" aria-hidden="true"></span>'
        + '<span class="fg-steps__txt"><span class="fg-steps__num">' + deux(i + 1) + '</span>'
        + (i === actif && !fin ? '<span class="fg-steps__of" aria-hidden="true">/' + deux(total) + '</span>' : '')
        + '<span class="lbl">' + esc(e.label) + '</span></span>';
      return '<li class="fg-steps__item ' + cls + geste + '" style="--i:' + i + '"' + (i === actif && !fin ? ' aria-current="step"' : '') + '>'
        + (cliquable ? '<button type="button" data-goto="' + e.id + '" aria-label="Revenir à l’étape ' + esc(e.label) + '">' + inner + '</button>' : inner)
        + '</li>';
    }).join('');
    // Le fil ne s ecrit que dans l ecran qui arrive : les cinq autres listes
    // le recevront quand leur ecran viendra (rendreEtapes est appele a chaque
    // changement d ecran, avant que l ecran ne s affiche). Six analyses HTML
    // par geste pour cinq listes invisibles (banc 2026-10-07, 4x : l arrivee
    // sur les activites passe de 200 a 158 ms de longues taches).
    var courante = $('.fg-scene[data-scene="' + sceneCourante + '"] [data-steps]');
    if (courante) courante.innerHTML = html;
    else $$('[data-steps]').forEach(function (ol) { ol.innerHTML = html; });
  }

  /* --- Les titres, mot par mot -------------------------------------------------- */

  function decouperTitres() {
    $$('[data-words]').forEach(function (el) {
      if (el.dataset.cut === '1') return;
      el.dataset.cut = '1';
      var i = 0;
      var walk = function (node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (n) {
          if (n.nodeType === 3) {
            var frag = doc.createDocumentFragment();
            // Les espaces ordinaires separent les mots ; l espace insecable
            // (« vous ? ») reste dans son mot, le « ? » ne part jamais seul.
            n.textContent.split(/([ \t\r\n]+)/).forEach(function (part) {
              if (!part) return;
              if (/^[ \t\r\n]+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
              var w = doc.createElement('span'); w.className = 'w';
              var s = doc.createElement('span'); s.style.setProperty('--i', i++); s.textContent = part;
              w.appendChild(s); frag.appendChild(w);
            });
            node.replaceChild(frag, n);
          } else if (n.nodeType === 1 && n.tagName !== 'SVG' && n.tagName !== 'svg' && n.tagName !== 'BR') walk(n);
        });
      };
      walk(el);
    });
  }
  // LES ACCENTS DES TITRES NE MORDENT PAS LA LIGNE DU DESSUS. Chez Anton,
  // l accent d une capitale monte a 1,11 em de la ligne de base, et
  // l interligne des titres est de 0,94 em : en 2e ligne, « CONFIRMEE »
  // plantait son accent dans le O de « RESERVATION » (mesure le 2026-09-23).
  // Seul un mot accentue SOUS la premiere ligne agrandit sa ligne vers le
  // haut, de ce qu il faut : les autres titres gardent leur interligne serre.
  // Relu a chaque ecran, a chaque changement de largeur et quand la police
  // arrive : la coupure des lignes en depend.
  // Une lettre porte son accent AU-DESSUS quand sa forme decomposee (NFD)
  // contient un signe du haut (U+0300 a U+030A : grave, aigu, circonflexe,
  // tilde, trema...). Aucune lettre accentuee n est ecrite ici : le controle
  // de qualite prend certaines d entre elles pour du texte mal encode.
  var ACCENT_HAUT = /[\u0300-\u030A]/;
  function espacerAccents(titre) {
    if (!titre) return;
    var mots = $$('.w', titre);
    mots.forEach(function (w) { w.classList.remove('w--accent'); });
    if (mots.length < 2 || !titre.getClientRects().length) return;
    var haut = mots[0].offsetTop;
    mots.forEach(function (w) {
      if (w.offsetTop > haut + 2 && ACCENT_HAUT.test(w.textContent.toUpperCase().normalize('NFD'))) w.classList.add('w--accent');
    });
  }
  function espacerTitreActif() { espacerAccents($('.fg-scene.is-active .fg-title')); }
  // La coupure des lignes ne depend que de la LARGEUR. Dans le cadre du
  // client, la hauteur change a chaque image d un tiroir qui s ouvre (l hote
  // suit le contenu) : relire la position des mots a chaque fois forcait un
  // layout par image pour rien.
  var accentsEnAttente = false, largeurAccents = window.innerWidth;
  window.addEventListener('resize', function () {
    if (accentsEnAttente || window.innerWidth === largeurAccents) return;
    largeurAccents = window.innerWidth;
    accentsEnAttente = true;
    requestAnimationFrame(function () { accentsEnAttente = false; espacerTitreActif(); });
  });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(espacerTitreActif);

  /* --- Les scenes ----------------------------------------------------------------- */

  var stage = $('#fgStage');
  var enTransition = false;
  var transitionId = 0;
  // Un geste de navigation fait PENDANT une transition (0,48 s) n est plus
  // perdu : le dernier demande part des qu elle finit. Avant, « Retour »
  // touche juste apres l arrivee sur un ecran ne faisait rien.
  var allerEnAttente = null;
  function chargerPhoto(scene) {
    var img = $('.fg-art img', scene);
    if (!img || !img.dataset.src) return;
    img.srcset = img.dataset.srcset || '';
    img.src = img.dataset.src;
    delete img.dataset.src; delete img.dataset.srcset;
  }
  // LES PHOTOS DE CHAQUE CENTRE (Movsar, 2026-09-23 : « que des images de Fun
  // Galaxy Libramont pour le formulaire de Libramont et de Gembloux pour celui
  // de Gembloux ; sur internet il y a aussi des images de l ancienne enseigne,
  // fais gaffe »). Un centre ne montre QUE ses photos, prises apres le
  // changement d enseigne ; la preuve de chacune (image d origine, page du site
  // qui dit le centre, mois d envoi) est tenue par le gate du formulaire, qui
  // refuse toute photo sans preuve. Un centre sans photo prouvee n en montre
  // aucune, jamais celles d un autre. Le choix des activites garde ses
  // vignettes. `h` : la hauteur de la version 1600, pour que le cadre annonce
  // soit la forme du fichier.
  var PHOTOS = {
    libramont: [
      { f: 'duckpin', h: 1066 },
      { f: 'fun-run', h: 1067 },
      { f: 'laser-couloir', h: 1066 },
      { f: 'minigolf', h: 1066 },
      { f: 'pistes-neon', h: 1066 },
      { f: 'salle-bowling', h: 1066 },
      { f: 'simulateurs', h: 1067 },
      { f: 'billards-libramont', h: 1066 },
    ],
    gembloux: [
      { f: 'gembloux-golf-salle', h: 1066 },
      { f: 'gembloux-golf-ecrans', h: 1066 },
      { f: 'gembloux-golf-quilles', h: 1066 },
      { f: 'gembloux-golf-rampe', h: 1066 },
      { f: 'gembloux-golf-balle', h: 1066 },
      { f: 'gembloux-golf-obstacle', h: 1066 },
      { f: 'gembloux-golf-cible', h: 1066 },
      { f: 'gembloux-golf-seaux', h: 1066 },
    ],
  };
  // ELLES TOURNENT : chaque visite tire un ordre (Fisher-Yates), qui ne change
  // plus jusqu a la fin de la reservation (« pour chaque nouvelle reservation,
  // pas que ca change pendant la resa »). Moins de photos que d ecrans : la
  // suite recommence, et deux ecrans voisins ne montrent jamais la meme des
  // que le centre en a deux. La premiere part tout de suite, en priorite.
  function poserPhotos() {
    // Propre a la table seulement : « /fungalaxy/constructor » lirait une
    // propriete heritee de l objet, et la page tomberait.
    var pool = (Object.prototype.hasOwnProperty.call(PHOTOS, CENTER) ? PHOTOS[CENTER] : []).slice();
    for (var i = pool.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var x = pool[i]; pool[i] = pool[j]; pool[j] = x;
    }
    tirage = pool;
    if (!pool.length) return;
    $$('.fg-scene').forEach(function (scene, k) {
      var img = $('.fg-art img', scene);
      if (img) poserPhoto(img, pool[k % pool.length]);
    });
    chargerPhoto($('.fg-scene.is-active'));
  }
  var tirage = [];
  function poserPhoto(img, p) {
    var base = '/assets/fungalaxy/' + p.f;
    img.width = 1600;
    img.height = p.h;
    img.dataset.src = base + '-800.webp';
    img.dataset.srcset = base + '-800.webp 800w, ' + base + '-1600.webp 1600w';
    img.dataset.photo = p.f;
  }
  // Les ecrans de la demande, entres plus tard, prennent leurs photos dans le
  // MEME tirage : jamais celle de l ecran d avant, ni, pour le dernier, celle
  // de l ecran qui le suit.
  function photosDesScenes(scenes, avant, apres) {
    if (!tirage.length) return;
    var precedente = avant ? (($('.fg-art img', avant) || {}).dataset || {}).photo || '' : '';
    var suivante = apres ? (($('.fg-art img', apres) || {}).dataset || {}).photo || '' : '';
    var curseur = 1;
    scenes.forEach(function (scene, k) {
      var img = $('.fg-art img', scene);
      if (!img) { precedente = ''; return; }
      var evite = k === scenes.length - 1 ? suivante : '';
      var p = tirage[curseur % tirage.length];
      for (var essai = 0; essai < tirage.length; essai += 1) {
        p = tirage[(curseur + essai) % tirage.length];
        if (p.f !== precedente && p.f !== evite) { curseur += essai; break; }
      }
      curseur += 1;
      poserPhoto(img, p);
      precedente = p.f;
    });
  }
  function aller(cible, retour) {
    if (enTransition) { allerEnAttente = { cible: cible, retour: retour }; return; }
    if (cible === sceneCourante) return;
    if (vitrineOuverte()) fermerVitrine(false);
    var de = $('.fg-scene[data-scene="' + sceneCourante + '"]');
    var vers = $('.fg-scene[data-scene="' + cible + '"]');
    if (!vers) return;
    // Un ecran de la demande ouvre son parcours, un ecran de la reservation le
    // sien ; l ecran final garde celui qui y mene.
    if (/^sm-/.test(cible)) sm.actif = true; else if (cible !== 'fin') sm.actif = false;
    var chemin = parcours();
    sceneCourante = cible;
    body.dataset.step = String(chemin.indexOf(cible) + 1);
    body.dataset.parcours = sm.actif ? 'sur-mesure' : 'reservation';
    rendreEtapes();
    chargerPhoto(vers);
    // La photo de la scene suivante se precharge pendant que celle-ci se lit.
    var suivante = $('.fg-scene[data-scene="' + chemin[chemin.indexOf(cible) + 1] + '"]');
    if (suivante) chargerPhoto(suivante);
    stage.classList.toggle('is-back', Boolean(retour));
    if (reduced) {
      de.classList.remove('is-active'); vers.classList.add('is-active');
    } else {
      enTransition = true;
      var jeton = ++transitionId;
      de.classList.remove('is-active'); de.classList.add('is-leaving');
      vers.classList.add('is-active', 'is-entering');
      // animationend REMONTE depuis les enfants (mots du titre, cascade des
      // champs) : seule la fin de l animation de la scene elle-meme compte,
      // et seulement si aucune autre transition n a demarre entre-temps.
      var fini = function () {
        if (jeton !== transitionId) return;
        de.classList.remove('is-leaving'); vers.classList.remove('is-entering');
        enTransition = false;
        // La scene sortante, posee en absolu, portait encore sa hauteur : le
        // corps n a pas change de taille en la retirant, l observateur ne dit
        // rien. Sans cet appel, le cadre restait a la hauteur de l ecran
        // precedent (un vide noir sous un ecran plus court).
        posterHauteur();
        apresAnimations(vers, posterHauteur);
        if (allerEnAttente) { var suite = allerEnAttente; allerEnAttente = null; aller(suite.cible, suite.retour); }
      };
      var surScene = function (e) {
        if (e.target !== vers) return;
        vers.removeEventListener('animationend', surScene);
        fini();
      };
      vers.addEventListener('animationend', surScene);
      setTimeout(function () { vers.removeEventListener('animationend', surScene); fini(); }, 600);
    }
    espacerAccents($('.fg-title', vers));
    poster({ type: 'pinlane:screen' });
    if (!EMBED) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    var focus = $('.fg-title', vers);
    if (focus) { focus.setAttribute('tabindex', '-1'); focus.focus({ preventScroll: true }); }
    setTimeout(posterHauteur, 50);
  }
  // Rappelle fn quand les animations finies de racine et de son contenu sont
  // terminees : une entree qui monte de 16 px compte encore dans la hauteur
  // tant qu elle joue. Les animations sans fin (reflets) ne comptent pas.
  function apresAnimations(racine, fn) {
    var liste = [];
    try {
      liste = (racine && racine.getAnimations ? racine.getAnimations({ subtree: true }) : []).filter(function (a) {
        var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        return a.playState === 'running' && t && t.iterations !== Infinity;
      });
    } catch (e) { liste = []; }
    if (!liste.length || !window.Promise) { fn(); return; }
    Promise.all(liste.map(function (a) { return a.finished.catch(function () {}); })).then(function () { fn(); });
  }

  // Amene la bande qui va du haut de `depuis` au bas de `el` dans ce qui se
  // voit, en defilant le moins possible ; le haut prime si elle ne tient pas.
  // En embarque c est la page du client qui defile : on lui dit quelle bande
  // montrer (embed.js, pinlane:voir), le cadre ne defile jamais lui-meme.
  function montrer(el, depuis) {
    if (!el || !el.getClientRects().length) return;
    var haut = (depuis || el).getBoundingClientRect().top;
    var bas = el.getBoundingClientRect().bottom;
    if (EMBED) {
      var y = window.pageYOffset || 0;
      poster({ type: 'pinlane:voir', haut: Math.round(haut + y), bas: Math.round(bas + y) });
      return;
    }
    var marge = 16, ecran = window.innerHeight, delta = 0;
    if (bas > ecran - marge) delta = bas - (ecran - marge);
    if (haut - delta < marge) delta = haut - marge;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
  }

  function precedent() {
    var chemin = parcours();
    var i = chemin.indexOf(sceneCourante);
    if (i > 0) aller(chemin[i - 1], true);
    // Le premier ecran de la demande ramene a la porte commune.
    else if (i === 0 && sm.actif) aller('date', true);
  }

  /* --- Le cadre dans la page hote ---------------------------------------------- */

  // La barre du bas (compteur ou resume, Retour, le bouton qui avance) reste
  // a sa place, en fin d ecran : elle ne suit l ecran sur aucun format
  // (Movsar, 2026-09-24 : « en vrai pas besoin de suivre, c inutile »).
  // Embarque, la page hote dit ou est le cadre dans son ecran (pinlane:vue) :
  // la fenetre du calendrier du telephone s y centre.
  var hautCadre = null, ecranHote = 0;
  function focusClavier(el) { try { return el.matches(':focus-visible'); } catch (e) { return false; } }
  // Au clavier, dans le cadre embarque, la page hote defile pour montrer ce
  // qui prend le focus, anneau compris. Chromium n applique pas la marge de
  // defilement (scroll-margin) quand il fait defiler la page PARENTE : une
  // carte a cheval sur le bas de l ecran y etait alignee au pixel, son anneau
  // dehors (mesure le 2026-09-24). La bande est demandee a l hote, qui garde
  // 16 px. Jamais au toucher : une carte touchee ne fait pas defiler la page.
  if (EMBED) doc.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.matches && el.matches('.fg-card, .fg-pill, .fg-tab') && focusClavier(el)) montrer(el);
  });
  $$('[data-back]').forEach(function (b) { b.addEventListener('click', precedent); });
  doc.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-goto]');
    if (b) aller(b.dataset.goto, true);
  });

  /* --- Alerte globale ------------------------------------------------------------ */

  var alerte = $('#fgAlert');
  function direErreur(msg) { alerte.textContent = msg; alerte.hidden = !msg; if (msg) posterHauteur(); }
  // UNE PANNE SE DIT EN FRANCAIS : le message du serveur s il en donne un,
  // sinon le seul fait constate. Jamais le texte brut du navigateur
  // (« Failed to fetch », « Load failed », « Unexpected token »).
  function erreurLisible(j, repli) { var e = new Error(j && j.message ? String(j.message) : repli); e.lisible = true; return e; }
  var panneMeta = '';          // la panne du catalogue, redite par Continuer
  // UNE LECTURE DU SERVEUR NE PEND JAMAIS (2026-10-12). Sur un reseau qui
  // cale, fetch attend sans fin : l ecran des heures restait sur son squelette
  // et « Ces horaires me vont » gris, sans un mot (sonde sous lenteur : plus
  // de 20 s, et rien). Chaque GET part avec un delai au plus, puis echoue
  // comme une panne, que l appelant dit deja. Celui qui le lance peut aussi
  // l annuler (une demande plus recente le remplace) : l annulation se tait.
  // Le corps se lit toujours, meme en erreur : laisse non lu, il garde la
  // requete ouverte. Le texte brut reste : une relecture le compare tel quel,
  // sans rien reserialiser.
  var DELAI_LECTURE = 12000;
  function lire(url, reglages) {
    reglages = reglages || {};
    var controle = new AbortController(), parDelai = false, externe = reglages.signal || null;
    var suivre = function () { controle.abort(); };
    if (externe) { if (externe.aborted) controle.abort(); else externe.addEventListener('abort', suivre); }
    var minuteur = setTimeout(function () { parDelai = true; controle.abort(); }, reglages.delai || DELAI_LECTURE);
    var finir = function () { clearTimeout(minuteur); if (externe) externe.removeEventListener('abort', suivre); };
    return fetch(url, { credentials: 'omit', headers: reglages.headers || {}, signal: controle.signal })
      .then(function (r) { return r.text().then(function (texte) { finir(); return { statut: r.status, ok: r.ok, texte: texte }; }); })
      .catch(function () { finir(); var e = new Error(parDelai ? 'delai' : 'reseau'); e.delai = parDelai; e.annule = !parDelai && controle.signal.aborted; throw e; });
  }
  function lu(rep) { try { return JSON.parse(rep.texte); } catch (e) { return null; } }
  // Un bouton qui travaille : la roue de .is-busy, et aria-busy pour qui ne la voit pas.
  function occuper(btn, oui) { if (!btn) return; btn.classList.toggle('is-busy', oui); if (oui) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); }
  // UNE SEULE VOIX pour les gestes : une phrase courte, deja ecrite a
  // l ecran. Videe puis reposee 80 ms plus tard : la meme phrase deux fois
  // de suite se relit.
  var vocal = $('#fgLive'), vocalMinuteur = 0;
  function dire(t) {
    if (!vocal) return;
    clearTimeout(vocalMinuteur);
    vocal.textContent = '';
    if (t) vocalMinuteur = setTimeout(function () { vocal.textContent = t; }, 80);
  }

  /* --- Etape 1 : le jour (calendrier par mois) ----------------------------------- */

  var dayBtn = $('#dayBtn'), dayPop = $('#dayPop'), dayLabel = $('#dayLabel'), dayHint = $('#dayHint');
  var calTitle = $('#calTitle'), calGrid = $('#calGrid'), calInfo = $('#calInfo'), calPrev = $('#calPrev'), calNext = $('#calNext');
  // Sous 560 px de large, ou sur un ecran de moins de 500 px de haut
  // (telephone en paysage), le calendrier s ouvre au milieu de l ecran, sur un
  // voile ; ailleurs, sous le bouton. dayMaison : sa place sous le bouton.
  // Embarque, la hauteur qui compte est celle de l ecran de l HOTE : celle du
  // cadre est celle de son contenu.
  var dayVoile = $('#dayVoile'), dayMaison = dayPop.parentNode;
  // LE CALENDRIER SERT PLUSIEURS CHAMPS : le jour de la reservation, et les
  // dates de la demande sur mesure (au plus tot demain). Une seule fenetre,
  // posee sous le champ qui l ouvre ; la cible dit quelle date elle montre,
  // la premiere date choisissable et ce que fait un choix.
  var CIBLE_JOUR = {
    btn: dayBtn,
    valeur: function () { return state.date; },
    min: function () { return aujourdhui(); },
    poser: function (d) { choisirJour(d); rejouer(dayLabel, 'is-maj'); rejouer(dayHint, 'is-maj'); },
    avantMin: '',
  };
  var calCible = null;
  function cible() { return calCible || CIBLE_JOUR; }
  function ouvrirCalendrier(c) {
    if (!dayPop.hidden && cible() !== c) ouvrirJours(false);
    calCible = c;
    ouvrirJours();
  }
  var auMilieu = window.matchMedia ? window.matchMedia('(max-width: 560px)') : null;
  var MARGE_FENETRE = 96;
  function ecranCourt() { return EMBED ? ecranHote > 0 && ecranHote <= 500 : window.innerHeight <= 500; }
  function fenetreAuMilieu() { return Boolean(auMilieu && auMilieu.matches) || ecranCourt(); }
  // Le calendrier vient du serveur (center.calendar, a cote de center.day) :
  // ouverture, horaires, fermeture, ferie ou conge scolaire, jour par jour.
  // Les 45 premiers jours arrivent avec le catalogue ; les mois suivants se
  // demandent quand on les ouvre (calendarFrom), et restent en memoire.
  var jours = {};              // 'YYYY-MM-DD' -> l entree servie
  var moisCharges = {};        // 'YYYY-MM' -> true | Promise
  var moisVu = null;           // { y, m } du mois affiche
  var jourFocus = '';          // le jour porte par le clavier dans la grille
  function aujourdhui() { return meta && meta.today ? String(meta.today) : iso(new Date()); }
  function demain() { var t = deIso(aujourdhui()); return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)); }
  // Le glissement du mois et la pose du jour choisi (rejouer) : la classe part
  // a la fin, ou a l interruption (calendrier referme, ecran quitte) ; restee
  // posee, l element la rejouerait en repassant de display:none a affiche.
  // Deux clics rapides : l interruption du premier glissement arrive quand le
  // second a deja demarre, elle ne doit pas le couper.
  [calGrid, dayLabel, dayHint].forEach(function (el) {
    ['animationend', 'animationcancel'].forEach(function (t) {
      el.addEventListener(t, function (e) {
        if (e.target !== el || (el.getAnimations && el.getAnimations().length)) return;
        el.classList.remove('is-next', 'is-prev', 'is-maj');
      });
    });
  });
  function horizon() {
    var n = Number(meta && meta.bookingHorizonDays) || 365;
    var t = deIso(aujourdhui());
    return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
  }
  // L ENTREE GARDE LE VERDICT DU JOUR que le serveur a calcule : le jour de
  // la semaine, les vacances qui bloquent les formules, les formules et les
  // activites indisponibles ce jour-la, les horaires bruts. Jusqu au
  // 2026-09-28 elle les jetait : verdictFormule ne voyait ni les vacances ni
  // les blocages (FORMULE 1 choisissable le 19 octobre, conge d automne, que
  // le serveur refuse ensuite), alors que son gate lui donnait le calendrier
  // brut et restait vert.
  function entreeJour(entry) {
    return {
      date: entry.date, ouvert: Boolean(entry.open), fini: entry.over === true, horaire: entry.open ? horaireLabel(entry.schedule) : (entry.closedLabel || 'Fermé'),
      periode: entry.holiday ? { type: entry.holiday.type, label: accentuer(entry.holiday.label) } : null, coupures: entry.closedWindows || [],
      weekday: typeof entry.weekday === 'number' ? entry.weekday : undefined,
      schedule: entry.schedule && typeof entry.schedule === 'object' ? { open: Number(entry.schedule.open), close: Number(entry.schedule.close) } : null,
      formulaHolidayOff: Boolean(entry.formulaHolidayOff),
      unavailableFormulaIds: Array.isArray(entry.unavailableFormulaIds) ? entry.unavailableFormulaIds.slice() : [],
      unavailableActivityIds: Array.isArray(entry.unavailableActivityIds) ? entry.unavailableActivityIds.slice() : [],
    };
  }
  function absorberCalendrier(liste) {
    (liste || []).forEach(function (e) { if (e && e.date) jours[e.date] = entreeJour(e); });
  }
  function jourInfo(dateStr) { return jours[dateStr] || null; }
  // LA JOURNEE FINIE (Movsar, 2026-10-01 : « quand un jour est fini, genre la
  // il est plus de 22 heures, ca doit dire que c est ferme et ils peuvent plus
  // continuer pour ce jour, mais uniquement quand l heure est passee »). Le
  // serveur le dit au chargement (`over`) ; une page restee ouverte le voit
  // ici, a l heure du CENTRE (jamais celle d un telephone a l etranger), a
  // partir de l heure de fermeture et pas une minute avant.
  function minutesCentre() {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: (meta && meta.center && meta.center.timezone) || 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      var h = 0, mn = 0;
      parts.forEach(function (x) { if (x.type === 'hour') h = Number(x.value) % 24; if (x.type === 'minute') mn = Number(x.value); });
      return h * 60 + mn;
    } catch (e) { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  }
  function journeeFinie(dateStr) {
    var j = jourInfo(dateStr);
    if (!j || !dateStr || dateStr !== aujourdhui()) return false;
    if (j.fini) return true;
    return Boolean(j.ouvert && j.schedule && isFinite(j.schedule.close) && minutesCentre() >= Math.round(j.schedule.close * 60));
  }
  function ouvertCeJour(dateStr) { var j = jourInfo(dateStr); return Boolean(j && j.ouvert && !journeeFinie(dateStr)); }
  function heureFermeture(j) { return j && j.schedule && isFinite(j.schedule.close) ? (j.schedule.close >= 24 ? 'minuit' : Math.floor(j.schedule.close) + 'h' + (j.schedule.close % 1 ? String(Math.round((j.schedule.close % 1) * 60)).padStart(2, '0') : '')) : ''; }
  function cleMois(y, m) { if (m < 0) { m += 12; y -= 1; } if (m > 11) { m -= 12; y += 1; } return y + '-' + String(m + 1).padStart(2, '0'); }
  function joursDuMois(y, m) { return new Date(y, m + 1, 0).getDate(); }
  // Le mois est complet quand chaque jour entre aujourd hui et l horizon a son
  // entree ; sinon on demande ce qui manque, en une seule requete.
  function chargerMois(y, m) {
    var cle = cleMois(y, m);
    if (moisCharges[cle] === true) return Promise.resolve();
    if (moisCharges[cle]) return moisCharges[cle];
    var today = aujourdhui(), fin = horizon();
    var n = joursDuMois(y, m), premier = '';
    for (var d = 1; d <= n; d += 1) {
      var s = cle + '-' + String(d).padStart(2, '0');
      if (s < today || s > fin) continue;
      if (!jours[s]) { premier = s; break; }
    }
    if (!premier) { moisCharges[cle] = true; return Promise.resolve(); }
    var q = new URLSearchParams(); q.set('centerId', CENTER); q.set('calendar', String(Math.min(90, n))); q.set('calendarFrom', premier);
    // Un mois qui ne vient pas (panne, refus, delai) se redemande au prochain
    // passage : marque charge, il gardait ses jours « Chargement… » pour toujours.
    var p = lire('/api/public-booking-meta?' + q.toString())
      .then(function (rep) { var j = lu(rep); if (!j || j.ok === false || !(j.center && Array.isArray(j.center.calendar))) throw new Error('mois'); absorberCalendrier(j.center.calendar); moisCharges[cle] = true; })
      .catch(function () { delete moisCharges[cle]; });
    moisCharges[cle] = p;
    return p;
  }
  function infoTexte(j) {
    if (!j) return '';
    var morceaux = [jourLong(j.date), j.ouvert ? 'ouvert ' + j.horaire : j.horaire.toLowerCase()];
    if (j.periode) morceaux.push(j.periode.type === 'public' ? 'férié : ' + j.periode.label : j.periode.label);
    if (j.coupures && j.coupures.length) morceaux.push('fermé ' + j.coupures.map(function (c) { return c.start + '-' + c.end; }).join(', '));
    return morceaux.join(' · ');
  }
  function rendreCalendrier() {
    if (!moisVu) return;
    var navFocus = doc.activeElement === calPrev ? calPrev : (doc.activeElement === calNext ? calNext : null);
    // Un jour qui avait le focus le retrouve apres le rendu : sans cela, le
    // second rendu (fin du chargement du mois) jetait le focus du clavier.
    var avaitFocus = calGrid.contains(doc.activeElement);
    var y = moisVu.y, m = moisVu.m;
    var today = aujourdhui(), fin = horizon(), mini = cible().min(), choisi = cible().valeur();
    calTitle.textContent = cap(MOIS[m]) + ' ' + y;
    var decalage = (new Date(y, m, 1).getDay() + 6) % 7; // lundi en tete
    var n = joursDuMois(y, m);
    var html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (l, i) { return '<span class="fg-cal__wd" role="columnheader" aria-label="' + esc(cap(JOURS[(i + 1) % 7])) + '">' + l + '</span>'; }).join('');
    for (var v = 0; v < decalage; v += 1) html += '<span class="fg-cal__void" role="presentation"></span>';
    var focusable = '';
    for (var d = 1; d <= n; d += 1) {
      var s = cleMois(y, m) + '-' + String(d).padStart(2, '0');
      var j = jours[s];
      var passe = s < today, loin = s > fin, avant = !passe && s < mini;
      var fini = journeeFinie(s);
      var off = passe || loin || avant || !j || !j.ouvert || fini;
      var cls = 'fg-cal__day' + (off ? ' is-off' : '') + (passe || avant ? ' is-past' : '') + (s === today ? ' is-today' : '') + (s === choisi ? ' is-selected' : '') + (j && j.periode ? (j.periode.type === 'public' ? ' is-ferie' : ' is-vacances') : '') + (!j && !passe && !loin ? ' is-loading' : '');
      var titre = avant && cible().avantMin ? cible().avantMin : fini ? 'Aujourd’hui : fermé, la journée est finie' : j ? infoTexte(j) : (passe ? 'Date passée' : (loin ? 'Au-delà de la période de réservation' : 'Chargement…'));
      if (!off && !focusable) focusable = s;
      html += '<button type="button" class="' + cls + '" data-date="' + s + '" role="gridcell" aria-selected="' + (s === choisi) + '" aria-label="' + esc(titre) + '" title="' + esc(titre) + '" ' + (off ? 'disabled' : '') + ' tabindex="-1">' + d + (j && j.periode ? '<i></i>' : '') + '</button>';
    }
    calGrid.innerHTML = html;
    var vise = (jourFocus && jourFocus.slice(0, 7) === cleMois(y, m) && $('.fg-cal__day[data-date="' + jourFocus + '"]:not([disabled])', calGrid)) ? jourFocus : (choisi && choisi.slice(0, 7) === cleMois(y, m) ? choisi : focusable);
    var b = vise ? $('.fg-cal__day[data-date="' + vise + '"]', calGrid) : null;
    if (b) { b.setAttribute('tabindex', '0'); jourFocus = vise; if (avaitFocus && !b.disabled) b.focus({ preventScroll: true }); }
    calPrev.disabled = cleMois(y, m) <= mini.slice(0, 7);
    calNext.disabled = cleMois(y, m + 1) > fin.slice(0, 7);
    // Une fleche qui s eteint sous le focus le passe a l autre, active par
    // construction (le mois affiche reste entre aujourd hui et l horizon).
    if (navFocus && navFocus.disabled) (navFocus === calNext ? calPrev : calNext).focus({ preventScroll: true });
    calInfo.textContent = infoTexte(jours[choisi]) || 'Choisissez un jour.';
    setTimeout(posterHauteur, 50);
  }
  function montrerMois(y, m, focusAu) {
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    // Le mois glisse dans le sens de la fleche ; l ouverture (moisVu vide) ne
    // glisse pas.
    var sens = moisVu ? (y * 12 + m) - (moisVu.y * 12 + moisVu.m) : 0;
    moisVu = { y: y, m: m };
    if (focusAu) jourFocus = focusAu;
    rendreCalendrier();
    if (sens) { calGrid.classList.remove('is-next', 'is-prev'); rejouer(calGrid, sens > 0 ? 'is-next' : 'is-prev'); }
    // Un mois deja complet ne se redessine pas une seconde fois.
    if (moisCharges[cleMois(y, m)] === true) return;
    chargerMois(y, m).then(function () { if (moisVu && moisVu.y === y && moisVu.m === m) rendreCalendrier(); });
  }
  function choisirJour(dateStr) {
    state.date = dateStr;
    dayLabel.textContent = jourLong(dateStr);
    direJour(dateStr);
    invaliderDispo();
  }
  var finVue = false;
  function direJour(dateStr) {
    var j = jourInfo(dateStr);
    var morceaux = [];
    finVue = journeeFinie(dateStr);
    dayHint.classList.toggle('is-warn', finVue);
    if (finVue) {
      var heure = heureFermeture(j);
      dayHint.textContent = 'Aujourd’hui\u00a0· Fermé, la journée est finie' + (heure ? ' (fermeture ' + heure + ')' : '') + '. Choisissez un autre jour.';
      dayBtn.setAttribute('title', dayHint.textContent);
      return;
    }
    // Le jour pre-choisi au depart peut etre aujourd hui : le dire evite de
    // reserver pour ce soir par megarde. meta.today est la date du centre.
    var rel = dateStr === aujourdhui() ? 'Aujourd’hui' : dateStr === demain() ? 'Demain' : '';
    if (rel) morceaux.push(rel);
    if (j) {
      morceaux.push(j.ouvert ? 'Ouvert ' + j.horaire : j.horaire);
      if (j.periode) morceaux.push(j.periode.type === 'public' ? 'Férié : ' + j.periode.label : j.periode.label);
      if (j.coupures && j.coupures.length) morceaux.push('Fermé ' + j.coupures.map(function (c) { return c.start + '-' + c.end; }).join(', '));
    }
    // L espace insecable colle le « · » au mot d avant : il ne commence jamais
    // une ligne quand l indice passe sur deux lignes.
    // Le jour propose d office est demain PARCE QUE la journee est finie : le
    // dire, sinon le client qui voulait venir ce soir ne le voit pas.
    if (dateStr === demain() && journeeFinie(aujourdhui())) morceaux.push('Aujourd’hui\u00a0: fermé');
    dayHint.textContent = morceaux.join('\u00a0· ');
    dayBtn.setAttribute('title', dayHint.textContent);
  }
  // Une page restee ouverte passe la fermeture : l indice et le calendrier le
  // disent des que l heure est passee, sans rien recharger.
  setInterval(function () {
    if (!state.date || journeeFinie(state.date) === finVue) return;
    direJour(state.date);
    rendreCalendrier();
  }, 30000);
  function ouvrirJours(ouvrir) {
    var o = typeof ouvrir === 'boolean' ? ouvrir : dayPop.hidden;
    // L ouverture ne garde que son apparition (fg-pop) : le mois montre ne
    // glisse pas depuis celui qu on avait quitte.
    var c = cible();
    if (o) { moisVu = null; calGrid.classList.remove('is-next', 'is-prev'); var d = deIso(c.valeur() || c.min()); montrerMois(d.getFullYear(), d.getMonth(), c.valeur()); }
    var milieu = o && fenetreAuMilieu();
    // Au milieu de l ecran (telephone), la fenetre vit dans <body> le temps
    // d etre ouverte : les champs animent leur transform (entree en cascade),
    // et un parent qui anime son transform decale et coupe un enfant en
    // position fixe. Refermee, elle retrouve sa place sous le bouton.
    if (milieu && dayPop.parentNode !== body) body.appendChild(dayPop);
    dayPop.classList.toggle('is-fenetre', milieu);
    dayPop.classList.toggle('is-court', milieu && ecranCourt());
    dayPop.hidden = !o;
    if (dayVoile) dayVoile.hidden = !milieu;
    if (milieu) dayPop.setAttribute('aria-modal', 'true'); else dayPop.removeAttribute('aria-modal');
    var maison = c.btn.closest('.fg-day') || dayMaison;
    if (!milieu && dayPop.parentNode !== maison) maison.appendChild(dayPop);
    dayPop.style.top = '';
    dayPop.style.maxHeight = '';
    if (milieu) placerFenetre(true);
    c.btn.setAttribute('aria-expanded', String(o));
    // Le champ passe au-dessus de ses voisins tant que le calendrier est
    // ouvert : chaque champ anime porte son propre contexte d empilement.
    var champDate = c.btn.closest('.fg-field');
    if (champDate) champDate.classList.toggle('is-open', o);
    if (o) { var b = $('.fg-cal__day[tabindex="0"]', calGrid); if (b) b.focus({ preventScroll: true }); }
    // Une fois le calendrier pose (fin de son apparition) : la hauteur suit,
    // puis, sous le bouton (tablette, bureau), la page amene le bouton ET le
    // mois entier dans l ecran. Au milieu de l ecran, rien a defiler.
    apresAnimations(dayPop, function () {
      posterHauteur();
      if (o && !dayPop.hidden && !milieu) montrer(dayPop, c.btn);
    });
  }
  // Embarquee, la fenetre du milieu se centre sur l ECRAN de la page du
  // client (ce que pinlane:vue dit de sa vue), pas sur le cadre, souvent bien
  // plus haut que l ecran ; elle reste dans le cadre. Quand le cadre ne couvre
  // pas le milieu de l ecran, elle se pose au plus pres, et la page du client
  // defile pour la montrer entiere, avec ses marges (pinlane:voir).
  function placerFenetre(demander) {
    if (!EMBED || dayPop.hidden || !fenetreAuMilieu()) return;
    centrerDansLaVue(dayPop, demander);
  }
  // Une fenetre embarquee se pose au milieu de l ecran de la page hote, dans
  // le cadre : celle du calendrier, celle des offres du recapitulatif.
  function centrerDansLaVue(el, demander) {
    if (ecranHote) el.style.maxHeight = Math.max(200, ecranHote - 24) + 'px';
    var h = el.offsetHeight, cadre = window.innerHeight;
    var milieu = ecranHote && hautCadre !== null ? ecranHote / 2 - hautCadre : cadre / 2;
    var y = Math.max(h / 2 + 8, Math.min(cadre - h / 2 - 8, milieu));
    el.style.top = Math.round(y) + 'px';
    if (demander && Math.abs(y - milieu) > 2) {
      poster({ type: 'pinlane:voir', haut: Math.round(Math.max(0, y - h / 2 - MARGE_FENETRE)), bas: Math.round(Math.min(cadre, y + h / 2 + MARGE_FENETRE)) });
    }
  }
  if (dayVoile) dayVoile.addEventListener('click', function () { var btn = cible().btn; ouvrirJours(false); btn.focus(); });
  // Un telephone qu on tourne en paysage (ou l inverse) change de calendrier :
  // la fenetre ouverte se referme plutot que de rester a la mauvaise place.
  if (auMilieu) {
    var auMilieuChange = function () { if (!dayPop.hidden) ouvrirJours(false); };
    if (auMilieu.addEventListener) auMilieu.addEventListener('change', auMilieuChange);
    else if (auMilieu.addListener) auMilieu.addListener(auMilieuChange);
  }
  dayBtn.addEventListener('click', function () { ouvrirCalendrier(CIBLE_JOUR); });
  calPrev.addEventListener('click', function () { if (moisVu) montrerMois(moisVu.y, moisVu.m - 1, ''); });
  calNext.addEventListener('click', function () { if (moisVu) montrerMois(moisVu.y, moisVu.m + 1, ''); });
  calGrid.addEventListener('click', function (e) {
    var b = e.target.closest('.fg-cal__day');
    if (!b || b.disabled) return;
    // Le jour choisi se pose dans le champ qui a ouvert le calendrier ; au
    // demarrage (choisirJour seul), rien ne bouge.
    var c = cible();
    c.poser(b.dataset.date);
    ouvrirJours(false);
    c.btn.focus();
  });
  calGrid.addEventListener('mouseover', function (e) { var b = e.target.closest('.fg-cal__day'); if (b && jours[b.dataset.date]) calInfo.textContent = infoTexte(jours[b.dataset.date]); });
  calGrid.addEventListener('mouseleave', function () { calInfo.textContent = infoTexte(jours[cible().valeur()]) || 'Choisissez un jour.'; });
  calGrid.addEventListener('focusin', function (e) { var b = e.target.closest('.fg-cal__day'); if (b && jours[b.dataset.date]) calInfo.textContent = infoTexte(jours[b.dataset.date]); });
  // Le clavier : fleches d un jour ou d une semaine, en changeant de mois au
  // bord ; Entree ou Espace choisit ; Echap ferme.
  function deplacerFocus(delta) {
    var depart = deIso(jourFocus || cible().valeur() || cible().min());
    var today = cible().min(), fin = horizon();
    for (var k = 1; k <= 62; k += 1) {
      var d = new Date(depart.getFullYear(), depart.getMonth(), depart.getDate() + delta * k);
      var s = iso(d);
      if (s < today || s > fin) return;
      if (!moisVu || d.getMonth() !== moisVu.m || d.getFullYear() !== moisVu.y) montrerMois(d.getFullYear(), d.getMonth(), s);
      var b = $('.fg-cal__day[data-date="' + s + '"]', calGrid);
      if (b && !b.disabled) { $$('.fg-cal__day[tabindex="0"]', calGrid).forEach(function (x) { x.setAttribute('tabindex', '-1'); }); b.setAttribute('tabindex', '0'); b.focus(); jourFocus = s; return; }
      if (b && b.classList.contains('is-loading')) return;
    }
  }
  doc.addEventListener('keydown', function (e) {
    if (dayPop.hidden) return;
    if (e.key === 'Escape') { var btn = cible().btn; ouvrirJours(false); btn.focus(); return; }
    var dans = e.target && e.target.closest && e.target.closest('#dayPop');
    if (!dans) return;
    var pas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (pas) { e.preventDefault(); deplacerFocus(pas); }
  });
  // Sur telephone la fenetre ouverte n est plus dans .fg-day : un toucher
  // dedans (mois suivant) ne doit pas la fermer.
  doc.addEventListener('click', function (e) { if (!dayPop.hidden && !e.target.closest('.fg-day') && !dayPop.contains(e.target)) ouvrirJours(false); });
  // Le clavier qui quitte le calendrier (Tab depuis la grille, Maj+Tab depuis
  // le champ) le referme : ouvert, il couvre le compteur et le bouton. La
  // fenetre du milieu (telephone) vit dans <body> : on ecoute le champ ET
  // la fenetre. Sans destination (fenetre quittee, jour re-rendu), il reste
  // ouvert.
  var dayWrap = dayBtn.closest('.fg-day');
  function sortieClavier(e) {
    var vers = e.relatedTarget;
    var wrap = cible().btn.closest('.fg-day');
    if (!dayPop.hidden && vers && !wrap.contains(vers) && !dayPop.contains(vers)) ouvrirJours(false);
  }
  dayWrap.addEventListener('focusout', sortieClavier);
  dayPop.addEventListener('focusout', sortieClavier);

  /* --- Etape 1 : le groupe ------------------------------------------------------- */

  var paxOut = $('#paxOut'), paxInput = $('#paxInput'), paxHint = $('#paxHint');
  var paxBox = paxInput.closest('.fg-stepper');
  var PAX_MIN = 1, PAX_MAX = 240;
  // Le dernier message ecrit sous le compteur : la region live ne se reecrit
  // que s il change, sinon chaque clic relirait la meme phrase.
  var indicePax = '';
  // LA LARGEUR DU CHAMP SUIT SON NOMBRE. Avec une largeur fixe et un texte
  // cale a droite, les deux em de vide restaient A GAUCHE du chiffre : l encre
  // « 4 personnes » sortait du centre de la case (Movsar, 2026-09-23).
  function ajusterLargeurPax() {
    var n = Math.max(1, String(paxInput.value || state.pax).length);
    paxInput.style.width = (n + 0.3) + 'ch';
  }
  var minuteurBump = 0;
  function battrePax(sens) {
    if (reduced) return;
    var sensCls = sens > 0 ? 'is-up' : 'is-down';
    paxInput.classList.remove(sens > 0 ? 'is-down' : 'is-up');
    relancer(paxInput, sensCls);
    if (paxBox) {
      paxBox.classList.add('is-bump');
      clearTimeout(minuteurBump);
      minuteurBump = setTimeout(function () { paxBox.classList.remove('is-bump'); }, 420);
    }
  }
  paxInput.addEventListener('animationend', function () { paxInput.classList.remove('is-up', 'is-down'); });
  // Le champ fait la largeur de son nombre : toucher n importe ou dans la case
  // du milieu le donne a taper, nombre deja selectionne (on tape par-dessus).
  $('#paxValue').addEventListener('click', function (e) { if (e.target !== paxInput) { paxInput.focus(); paxInput.select(); } });
  function rendrePax() {
    paxOut.textContent = joueurs(state.pax);
    if (String(paxInput.value) !== String(state.pax) && doc.activeElement !== paxInput) paxInput.value = String(state.pax);
    ajusterLargeurPax();
    $('#paxMinus').disabled = state.pax <= PAX_MIN;
    $('#paxPlus').disabled = state.pax >= PAX_MAX;
    var lanes = meta && meta.center && meta.center.booking;
    var indice = '';
    // Un grand groupe passe par la demande sur mesure : l encart le dit, la
    // phrase des passages ne sert plus.
    var gros = grandGroupe();
    if (!gros && lanes && lanes.laneCount && lanes.normalCapacityPerLane) {
      var confort = lanes.laneCount * lanes.normalCapacityPerLane;
      // Une phrase, pas trois : le detail (combien de groupes, dans quel ordre)
      // se lit desormais sur la piste concernee, a l etape des horaires.
      if (state.pax > confort) indice = esc('Grand groupe : au-delà de ' + confort + ' personnes, certaines activités se jouent en plusieurs passages.');
    }
    // AU PLAFOND, LE FORMULAIRE DIT POURQUOI : le « + » s eteint a 240 (borne
    // du serveur et de la base) et un nombre tape au-dela y est ramene. Le
    // numero vient de la meta du centre ; sans lui, la phrase s arrete a la borne.
    var auMax = state.pax >= PAX_MAX;
    if (auMax && gros) {
      indice = 'Plus de ' + PAX_MAX + '&nbsp;? Vous préciserez le nombre exact dans la demande.';
    } else if (auMax) {
      var contact = meta && meta.center && meta.center.contact;
      indice += (indice ? ' ' : '') + 'En ligne, ' + PAX_MAX + ' personnes au maximum.'
        + (contact && contact.phone ? ' Pour un groupe plus grand, appelez le centre au ' + lienContact({ phone: contact.phone }) : '');
    }
    paxHint.classList.toggle('is-warn', auMax && !gros);
    if (indice !== indicePax) { indicePax = indice; paxHint.innerHTML = indice; }
    majSeuil();
    invaliderDispo();
  }
  function poserPax(n) {
    n = Math.min(PAX_MAX, Math.max(PAX_MIN, Math.trunc(Number(n) || 0)));
    if (n === state.pax) return;
    state.pax = n;
    // Les choix explicites suivent leur plafond ; un choix reste un sous-
    // groupe quand on augmente la visite. Sans choix, toute la visite joue.
    Object.keys(state.options).forEach(function (id) {
      var opt = state.options[id], a = activite(id);
      if (a && opt && opt.participants != null) opt.participants = joueursDe(a);
    });
    state.selection = state.selection.filter(function (id) { return !tropPeu(activite(id)); });
    // Le groupe change : la question des enfants se repose, tout le groupe par
    // defaut, jamais un ancien compte qui ne correspond plus a rien.
    state.enfants = null;
    rendrePax();
    // La grille des activites n est pas a l ecran : elle se reconstruit une fois, en y allant (goActivities).
    majEnfants();
  }
  $('#paxMinus').addEventListener('click', function () { poserPax(state.pax - 1); paxInput.value = String(state.pax); ajusterLargeurPax(); battrePax(-1); });
  $('#paxPlus').addEventListener('click', function () { poserPax(state.pax + 1); paxInput.value = String(state.pax); ajusterLargeurPax(); battrePax(1); });
  // Le nombre se tape aussi : la valeur se prend des qu elle est lisible, et
  // se remet au propre quand le champ est quitte (vide ou hors bornes).
  paxInput.addEventListener('input', function () { ajusterLargeurPax(); var v = parseInt(paxInput.value, 10); if (isFinite(v) && v >= PAX_MIN) poserPax(v); });
  paxInput.addEventListener('blur', function () { paxInput.value = String(state.pax); ajusterLargeurPax(); });
  paxInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); paxInput.blur(); } });

  // UN TOUCHER AVANT LE CATALOGUE EST GARDE (2026-10-12). Le premier ecran
  // s affiche avant que le catalogue n arrive. Sur un reseau lent, « Choisir
  // mes activites » repondait « Le formulaire se charge encore. Reessayez
  // dans un instant. », en rouge, en haut de la page, loin du doigt, et le
  // geste etait perdu (sonde : toujours sur le premier ecran une fois le
  // catalogue arrive). Le bouton travaille, et le geste repart des que le
  // catalogue est la ; seul le dernier compte, c est le plus recent. Une
  // panne du catalogue, elle, se redit (panneMeta).
  var gesteAvantCatalogue = null;
  function apresCatalogue(btn, faire) {
    if (gesteAvantCatalogue && gesteAvantCatalogue.btn !== btn) occuper(gesteAvantCatalogue.btn, false);
    gesteAvantCatalogue = { btn: btn, faire: faire };
    occuper(btn, true);
  }
  function rejouerGeste() {
    var g = gesteAvantCatalogue;
    gesteAvantCatalogue = null;
    if (!g) return;
    occuper(g.btn, false);
    if (meta) g.faire(); else if (panneMeta) direErreur(panneMeta);
  }
  function allerAuxActivites() {
    if (!meta) { if (panneMeta) direErreur(panneMeta); else apresCatalogue($('#goActivities'), allerAuxActivites); return; }
    if (grandGroupe()) { ouvrirSurMesure($('#goActivities')); return; }
    if (!state.date) { direErreur('Choisissez d’abord un jour.'); dayBtn.focus(); return; }
    if (journeeFinie(state.date)) { direJour(state.date); rendreCalendrier(); direErreur('Le centre est fermé pour aujourd’hui : la journée est finie. Choisissez un autre jour.'); dayBtn.focus(); return; }
    direErreur('');
    var selectionAvant = state.selection.length, formuleAvant = state.formuleId;
    // Le groupe a pu changer depuis le dernier rendu : une activite bornee
    // (Fun Run, 5 joueurs) sort de la selection si le groupe la depasse.
    state.selection = state.selection.filter(function (id) {
      var a = activite(id);
      return a && !(a.maxPax && state.pax > a.maxPax) && !tropPeu(a) && !fermeCeJour(a);
    });
    // Le jour ou le groupe a pu changer : une formule qui n est plus valable
    // ce jour-la se decoche, sinon le client part vers un ecran d heures vide.
    if (state.formuleId) {
      var choisie = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0];
      if (!choisie || !verdictFormule(choisie).ok) state.formuleId = '';
    }
    // Les deux grilles ne se reconstruisent que si ce qui les ecrit depuis
    // l exterieur a change (le jour, le groupe, le catalogue) ou si le tri
    // ci-dessus vient de retirer une carte ou la formule : sur l ecran
    // lui-meme, chaque geste les met deja a jour sur place. Reconstruire dix
    // cartes et quatorze formules a chaque retour, pour un ecran identique,
    // doublait le travail du geste (banc 2026-10-07, 4x : 25 layouts et 95 ms
    // de script, contre 14 et 42).
    if (empreinteGrilles() !== grillesRendues || state.selection.length !== selectionAvant || state.formuleId !== formuleAvant) {
      rendreActivites();
      // Les formules vivent dans un panneau cache tant que leur onglet n est
      // pas choisi : quatorze cartes se construisent apres le premier rendu de
      // l ecran, pas dans le geste qui y mene (banc 2026-10-07, 4x : 270 ms de
      // longues taches contre 158). L onglet qui s ouvre avant les construit
      // tout de suite (choisirOnglet).
      if (state.onglet === 'formules') rendreFormules(); else programmerFormules();
      grillesRendues = empreinteGrilles();
    }
    rendreCompteur(false);
    aller('activites');
    placerBarre();
  }
  $('#goActivities').addEventListener('click', allerAuxActivites);
  var grillesRendues = '';
  function empreinteGrilles() { return [state.date, state.pax, empreinteCatalogue].join('|'); }
  var formulesEnRetard = false;
  function rendreFormulesEnRetard() { if (!formulesEnRetard) return; formulesEnRetard = false; rendreFormules(); }
  function programmerFormules() {
    formulesEnRetard = true;
    if (window.requestIdleCallback) requestIdleCallback(rendreFormulesEnRetard, { timeout: 600 });
    else setTimeout(rendreFormulesEnRetard, 150);
  }

  /* --- Etape 2 : les activites et les formules ----------------------------------- */

  var gridAct = $('#gridAct'), gridFor = $('#gridFor'), actCount = $('#actCount'), goHours = $('#goHours');
  // L option d une carte cochee (duree de piste, parties, session) : un tiroir
  // qui s ouvre SOUS la carte, avec TOUTES les options en pastilles et la
  // retenue pleine. Des fleches qui font defiler une valeur n etaient pas
  // comprises (Movsar, 2026-09-22) : ici tout se voit d un coup. Le tiroir
  // vit a cote de la carte dans le DOM (une case a cocher n a pas d enfants
  // interactifs) et se deploie en CSS, sans mesure.
  var TITRES_OPTION = { duration: 'Durée de piste', games: 'Parties', minutes: 'Durée' };
  // Les reglages d une activite, groupe par groupe : UN groupe pour une grille
  // (duree de piste, parties, session), DEUX pour les billards (combien de
  // tables, combien d heures). Chaque pastille de duree dit ce que la ligne
  // couterait avec elle ; une pastille de tables dit un nombre de tables.
  function groupesOptions(a) {
    if (!meta || !a) return [];
    var ar = reglageArcade(a);
    if (ar) return [
      { cle: 'arcadeMode', titre: 'Carte Fun Galaxy', choisie: ar.mode, options: [{ valeur: 'time', label: 'Temps', sous: 'Sans cadeaux', disabled: !ar.time.length }, { valeur: 'credit', label: 'Crédits', sous: 'Tous les jeux', disabled: !ar.credit.length }].filter(function (o) { return !o.disabled; }) },
      { cle: 'arcadeOfferId', titre: ar.mode === 'time' ? 'Durée par carte' : 'Crédits par carte', choisie: ar.offer.id, select: ar.mode === 'credit', options: ar.offers.map(function (o) { if (o.id === ar.offer.id) o = ar.offer; return { valeur: o.id, label: ar.mode === 'time' ? minutesLabel(o.minutes) : credits(o.credits) + ' + ' + credits(o.bonusCredits || 0) + ' bonus', prix: Number(o.price) }; }) },
    ];
    if (a.priceType === 'per_unit_hour') {
      var r = reglageBillard(a);
      // Les tables se comptent (compteurDe), les heures se choisissent.
      return [
        { cle: 'hours', titre: 'Durée', options: heuresPossibles(a).map(function (h) { return { valeur: h, label: heuresLabel(h), prix: prixBillard(a, r.units, h) }; }), choisie: r.hours },
      ];
    }
    var liste = optionsPour(a);
    if (!liste.length) return [];
    var i = indexOption(a);
    return [{ cle: liste[0].cle, titre: TITRES_OPTION[liste[0].cle] || 'Option', options: liste, choisie: liste[i < 0 ? 0 : i].valeur }];
  }
  function petitDePastille(o) { return o.sous != null ? o.sous : (o.prix == null ? PRIX_ACCUEIL : euros(o.prix)); }
  function htmlCompteur(c, base) {
    var id = base + '-' + c.cle;
    var saisie = c.cle === 'participants' || c.cle === 'cards';
    var moins = c.cle === 'units' ? 'Une ' + c.mot + ' de moins' : 'Un ' + c.mot + ' de moins';
    var plus = c.cle === 'units' ? 'Une ' + c.mot + ' de plus' : 'Un ' + c.mot + ' de plus';
    return '<div class="fg-count"><label class="fg-count__label" id="' + id + '"' + (saisie ? ' for="' + id + '-value"' : '') + '>' + esc(c.titre)
      + (c.cle === 'participants' ? '<small>sur ' + state.pax + '</small>' : c.cle === 'cards' ? '' : '<small>' + c.max + ' au plus</small>') + '</label>'
      + '<div class="fg-stepper fg-kids__stepper" role="group" aria-labelledby="' + id + '" data-compteur="' + esc(c.cle) + '">'
      + '<button type="button" class="fg-stepper__btn" data-pas="-1" aria-label="' + esc(moins) + '"' + (c.n <= c.min ? ' disabled' : '') + '>&minus;</button>'
      + (saisie ? '<input class="fg-kids__n fg-count__input" id="' + id + '-value" type="number" inputmode="numeric" min="' + c.min + '" max="' + c.max + '" step="1" value="' + c.n + '" aria-labelledby="' + id + '">' : '<output class="fg-kids__n" aria-live="polite">' + c.n + '</output>')
      + '<button type="button" class="fg-stepper__btn" data-pas="1" aria-label="' + esc(plus) + '"' + (c.n >= c.max ? ' disabled' : '') + '>+</button>'
      + '</div></div>';
  }
  function rendreOption(a) {
    var groupes = groupesOptions(a);
    var ar = reglageArcade(a);
    var compteur = compteurDe(a);
    var base = 'opt-' + String(a.id).replace(/[^a-z0-9_-]/gi, '');
    return '<div class="fg-card__opt"><div class="fg-card__optin"><div class="fg-card__optbox">'
      + htmlCompteur(compteur, base)
      + (a.priceType === 'per_unit_hour' ? htmlCompteur(compteurDe(a, 'units'), base) : '')
      + (ar && ar.mode === 'credit' ? htmlCompteur(compteurDe(a, 'cards'), base) : '')
      + groupes.map(function (g) {
        var idTitre = groupes.length > 1 ? base + '-' + g.cle : base;
        if (g.select) return '<div class="fg-option-group"><label class="fg-card__optlabel" for="' + idTitre + '">' + esc(g.titre) + '</label><select class="fg-arcade-select" id="' + idTitre + '" data-cle="' + esc(g.cle) + '">' + g.options.map(function (o) { return '<option value="' + esc(o.valeur) + '"' + (o.valeur === g.choisie ? ' selected' : '') + '>' + esc(euros(o.prix) + ' · ' + o.label) + '</option>'; }).join('') + '</select></div>';
        return '<div class="fg-option-group"><span class="fg-card__optlabel" id="' + idTitre + '">' + esc(g.titre) + '</span>'
          + '<div class="fg-pills" role="radiogroup" aria-labelledby="' + idTitre + '" data-cle="' + esc(g.cle) + '" data-n="' + g.options.length + '">'
          + g.options.map(function (o) {
            var on = o.valeur === g.choisie;
            return '<button type="button" class="fg-pill' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? '0' : '-1') + '" data-cle="' + esc(g.cle) + '" data-valeur="' + esc(String(o.valeur)) + '"><b>' + esc(o.label) + '</b><small>' + esc(petitDePastille(o)) + '</small></button>';
          }).join('')
          + '</div></div>';
      }).join('')
      + '</div></div></div>';
  }
  function tuileActivite(item) { return item && item._fgTuile || item; }
  function tiroirActivite(item) { return item && (item._fgEditeur || item); }
  function caseActivite(id, nom, on) {
    return '<button type="button" class="fg-card-select' + (on ? ' is-on' : '') + '" data-activity-toggle="' + esc(id) + '" role="checkbox" aria-checked="' + on + '" aria-label="' + esc(nom) + '"><svg aria-hidden="true"><use href="#i-check"/></svg></button>';
  }
  // Keep the actual controls beside their card and compact each column.
  function rendreEditeurActivites(grille, id, retirer, montrer) {
    // Every card retains its own real controls. Columns compact independently:
    // a short neighbour never gets an empty drawer's height as padding.
    if (grille._fgMesure) { cancelAnimationFrame(grille._fgMesure); grille._fgMesure = 0; }
    var tuiles = Array.from(grille.children).filter(function (x) { return x.classList.contains('fg-grid__item'); });
    tuiles.forEach(function (tile) {
      var card = $('.fg-card', tile), drawer = $('.fg-card__opt', tile), cle = tile.dataset.activity || tile.dataset.smActivity;
      card.setAttribute('role', 'checkbox'); card.setAttribute('aria-checked', String(tile.classList.contains('is-on')));
      if (drawer) { drawer.id = grille.id + '-options-' + cle; card.setAttribute('aria-controls', drawer.id); drawer.setAttribute('aria-hidden', String(!tile.classList.contains('is-on'))); }
    });
    function mesurer() {
      grille._fgMesure = 0;
      var largeur = grille.getBoundingClientRect().width;
      if (!largeur) return;
      // LES COLONNES DE LA FEUILLE, PAS CELLES DE NOS PLACEMENTS (2026-10-12).
      // gridTemplateColumns compte aussi les colonnes implicites, et nos
      // grid-column: 3 et 4, ecrits a 4 colonnes, en creaient des que la
      // feuille passait a 2 (telephone tourne, fenetre retrecie) : la mesure
      // relisait 4, les deux vraies colonnes tombaient a 0 px et les cartes
      // s empilaient. Quand la fenetre ou la grille change de largeur, les
      // placements sont retires AVANT de compter : la grille revient a ses
      // seules colonnes. Une lecture de plus, au redimensionnement seulement.
      var cle = window.innerWidth + 'x' + largeur;
      if (grille._fgCle !== cle) {
        tuiles.forEach(function (tile) { tile.style.gridColumn = ''; tile.style.gridRow = ''; });
        grille._fgColonnes = getComputedStyle(grille).gridTemplateColumns.split(' ').filter(Boolean).length;
        grille._fgCle = cle;
      }
      var colonnes = grille._fgColonnes;
      var espace = petitEcran.matches ? 10 : 14;
      var hauteurs = Array(colonnes).fill(0);
      // TOUTES les lectures, PUIS toutes les ecritures. Lire la hauteur d une
      // tuile apres avoir ecrit la rangee de la precedente force un layout par
      // tuile ; pendant qu un tiroir s ouvre (0,4 s), l observateur rappelle
      // cette mesure a chaque image (banc 2026-10-07, 4x : 80 layouts par
      // tiroir ouvert, 48 ainsi). Une valeur inchangee ne se reecrit pas :
      // rien n est invalide pour rien.
      var mesures = tuiles.map(function (tile) { return Math.ceil(tile.getBoundingClientRect().height); });
      tuiles.forEach(function (tile, i) {
        var col = i % colonnes, h = mesures[i];
        var colonne = String(col + 1), rangee = String(hauteurs[col] + 1) + ' / span ' + h;
        if (tile.style.gridColumn !== colonne) tile.style.gridColumn = colonne;
        if (tile.style.gridRow !== rangee) tile.style.gridRow = rangee;
        hauteurs[col] += h + espace;
      });
      posterHauteur();
    }
    function attendreMesure() { if (!grille._fgMesure) grille._fgMesure = requestAnimationFrame(mesurer); }
    if (grille._fgMasonryObserver) grille._fgMasonryObserver.disconnect();
    if (window.ResizeObserver) { grille._fgMasonryObserver = new ResizeObserver(attendreMesure); grille._fgMasonryObserver.observe(grille); tuiles.forEach(function (tile) { grille._fgMasonryObserver.observe(tile); }); }
    attendreMesure();
  }
  function choisirPastille(pill) {
    var item = pill.closest('.fg-grid__item');
    var a = activite(item.dataset.activity);
    var groupe = pill.closest('.fg-pills');
    var g = groupesOptions(a).filter(function (x) { return x.cle === pill.dataset.cle; })[0];
    var o = g ? g.options.filter(function (x) { return String(x.valeur) === pill.dataset.valeur; })[0] : null;
    if (!a || !o) return;
    // Les billards gardent leurs DEUX reglages (tables et heures) ; une grille
    // n en a qu un.
    state.options[a.id] = Object.assign({}, state.options[a.id] || {});
    if (reglageArcade(a)) state.options[a.id] = choixArcade(a, state.options[a.id], g.cle, o.valeur);
    else state.options[a.id][g.cle] = o.valeur;
    if (reglageArcade(a)) { $('.fg-card__opt', item).outerHTML = rendreOption(a); var choisi = $('.fg-pill[data-cle="' + g.cle + '"][data-valeur="' + o.valeur + '"]', item); if (choisi) choisi.focus({ preventScroll: true }); }
    $$('.fg-pill', groupe || item).forEach(function (x) { var on = x === pill; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    majPastilles(item, a);
    majPrixCarte(item, a, true);
    invaliderDispo();
  }
  // Les montants des pastilles et la phrase des tours suivent le reglage :
  // deux heures pour trois tables ne coutent pas ce que coute une table, et
  // un tour dure la duree choisie.
  function majPastilles(item, a) {
    var tile = tuileActivite(item);
    item = tiroirActivite(item);
    groupesOptions(a).forEach(function (g) {
      g.options.forEach(function (o) {
        var petit = item.querySelector('.fg-pill[data-cle="' + g.cle + '"][data-valeur="' + String(o.valeur) + '"] small');
        if (petit) petit.textContent = petitDePastille(o);
      });
    });
    var rot = $('.fg-card__rot', tile);
    if (rot) rot.textContent = typo(noteCourte(a));
    var info = $('[data-activity-info]', tile); if (info) { var sections = sectionsInfoActivite(a); info.dataset.infoText = texteSectionsInfo(sections); info.dataset.infoSections = JSON.stringify(sections); }
  }
  function rendreActivites() {
    gridAct.innerHTML = activitesVendables().map(function (a, i) {
      var p = photo(a.id);
      var on = state.selection.indexOf(a.id) >= 0;
      var trop = false;
      // Pas assez de joueurs : la carte reste TOUCHABLE et dit pourquoi, comme
      // une formule refusee (une raison qu on ne peut pas atteindre ne sert a
      // personne).
      var peu = !trop && tropPeu(a);
      var ferme = !trop && !peu && fermeCeJour(a);
      return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '" data-activity="' + esc(a.id) + '">'
        + '<div class="fg-card fg-rise' + (on ? ' is-on' : '') + (trop ? ' is-off' : '') + (peu || ferme ? ' is-refus' : '') + '" style="--i:' + (i % 8) + '" data-activity="' + esc(a.id) + '" role="checkbox" tabindex="' + (trop ? '-1' : '0') + '" aria-checked="' + on + '" ' + (trop ? 'aria-disabled="true" title="' + esc(a.name) + ' : ' + a.maxPax + ' personnes maximum"' : '') + '>'
        + (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
        + '<span class="fg-card__name">' + esc(a.name) + '</span>'
        + '<span class="fg-card__price">' + esc(typo(prixCarte(a) + (precisionsCarte(a) ? ' · ' + precisionsCarte(a) : ''))) + '</span>'
        + (peu ? '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>Il faut être au moins ' + a.minPax + ' joueurs. Vous êtes ' + state.pax + '.</span>' : '')
        + (ferme ? '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>Indisponible ' + esc(minuscule(jourLong(state.date))) + '.</span>' : '')
        + '</div>' + caseActivite(a.id, a.name, on)
        + htmlInfo(a)
        + rendreOption(a)
        + '</li>';
    }).join('') || ('<li class="fg-empty">Aucune activité ne se réserve en ligne pour le moment.' + ligneCentre() + '</li>');
    // Une carte deja cochee (retour a cet ecran) montre sa photo tout de suite.
    $$('.fg-card.is-on', gridAct).forEach(chargerPhotoCarte);
    rendreEditeurActivites(gridAct, '', retirerActivite);
  }
  var JOURS_SEM = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  // Les jours dans l ordre de la semaine, lundi d abord : « mardi, mercredi,
  // jeudi et dimanche », jamais « dimanche, mardi… » comme le tableau brut.
  function joursLisibles(liste) {
    var noms = (liste || []).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); })
      .map(function (d) { return JOURS_SEM[d] || ''; }).filter(Boolean);
    if (!noms.length) return '';
    if (noms.length === 1) return 'le ' + noms[0];
    return 'les ' + noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }
  function heureRonde(v) { var h = Math.floor(Number(v)); var m = Math.round((Number(v) - h) * 60); return m ? h + 'h' + String(m).padStart(2, '0') : h + 'h'; }
  function plageLisible(limite) {
    if (!limite) return '';
    if (limite.min && limite.max) return 'de ' + heureRonde(limite.min) + ' à ' + heureRonde(limite.max);
    if (limite.max) return 'avant ' + heureRonde(limite.max);
    if (limite.min) return 'à partir de ' + heureRonde(limite.min);
    return '';
  }
  // LE VERDICT D UNE FORMULE POUR CE JOUR ET CE GROUPE, dans l ordre de
  // getFormuleAvailability (lib/booking-config), la fonction qui accepte ou
  // refuse la vraie reservation. Rien n est devine ici : le jour bloque
  // (vacances, feries) et l interrupteur du staff sont des verdicts DU
  // SERVEUR, lus dans le calendrier (formulaHolidayOff) et dans la formule
  // (offerOff). Le gate fungalaxy-form compare ce verdict au serveur sur une
  // grille complete de formules, de jours et de tailles de groupe.
  function verdictFormule(f) {
    var j = jourInfo(state.date) || {};
    if (f.offerOff) return { ok: false, court: 'Indisponible', pourquoi: 'Cette offre est momentanément suspendue.' };
    if ((j.unavailableFormulaIds || []).indexOf(f.id) >= 0) return { ok: false, court: 'Indisponible ce jour', pourquoi: 'Une des activités de cette formule n’est pas disponible ce jour-là.' };
    if (f.minPax && state.pax < f.minPax) return { ok: false, court: 'Dès ' + f.minPax + ' personnes', pourquoi: f.minPaxLaser
      ? 'Le laser game de cette formule se joue à ' + f.minPax + ' minimum. Vous êtes ' + state.pax + '.'
      : 'Vous êtes ' + state.pax + ' : cette formule demande au moins ' + f.minPax + ' personnes.' };
    if (f.noHolidays && j.formulaHolidayOff) return { ok: false, court: 'Pas pendant les vacances', pourquoi: 'Non valable pendant les vacances scolaires et les jours fériés.' };
    if (f.validDays && f.validDays.length && f.validDays.indexOf(jourSemaine(state.date)) < 0) return { ok: false, court: joursLisibles(f.validDays), pourquoi: 'Cette formule se réserve ' + joursLisibles(f.validDays) + ', pas ' + (JOURS_SEM[jourSemaine(state.date)] ? 'le ' + JOURS_SEM[jourSemaine(state.date)] : 'ce jour-là') + '.' };
    var reel = disponibilitesFormules[cleDisponibilitesFormules()];
    var verdict = reel && reel[f.id];
    if (verdict && verdict.available === false) return { ok:false, court:'Indisponible ce jour', pourquoi:verdict.reason || 'Aucun horaire disponible pour cette formule ce jour-là.' };
    return { ok: true, court: '', pourquoi: '' };
  }
  function jourSemaine(dateStr) {
    var j = jourInfo(dateStr);
    if (j && typeof j.weekday === 'number') return j.weekday;
    var p = String(dateStr || '').split('-').map(Number);
    return p.length === 3 ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : -1;
  }
  // Les contraintes de la formule, telles que le catalogue les declare : le
  // groupe minimum, les jours, la plage horaire, les vacances. Ce sont elles
  // que le client cherchait et qui n etaient nulle part (retour de Movsar).
  function reglesFormule(f) {
    var out = [];
    if (f.minPax > 1) out.push('dès ' + f.minPax + ' personnes');
    if (f.validDays && f.validDays.length && f.validDays.length < 7) out.push(joursLisibles(f.validDays));
    if (plageLisible(f.timeLimit)) out.push(plageLisible(f.timeLimit));
    if (f.noHolidays) out.push('hors vacances et fériés');
    return out;
  }
  // Le catalogue ecrit « Formules speciales » SANS accent : c est sa valeur
  // canonique, gardee par booking-constants-drift-check. Ce formulaire est lu
  // par des clients, il ecrit le francais, et sous un onglet « Formules » le
  // mot ne se repete pas. La cle ignore accents et casse, comme la console ;
  // une famille creee par le staff s affiche telle qu elle est ecrite.
  var LIBELLE_FAMILLE = { 'formules anniversaires': 'Anniversaires', 'formules speciales': 'Offres spéciales' };
  function libelleFamille(nom) {
    var cle = String(nom == null ? '' : nom).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    return LIBELLE_FAMILLE[cle] || nom;
  }
  // LA DUREE DE CHAQUE FORMULE (Movsar, 2026-09-30 : « mettre le temps que ca
  // dure chaque formule »). Le serveur la mesure pour le jour et le groupe
  // choisis, comme le recapitulatif (de l arrivee a la fin) ; elle se pose en
  // place dans chaque carte. Sans reponse, la ligne s efface : rien n est devine.
  var dureesCache = {}, dureesEnCours = '';
  var disponibilitesFormules = {}, disponibilitesFormulesTemps = {}, dureesChargement = null;
  function cleDisponibilitesFormules() { return CENTER + '|' + state.date + '|' + state.pax; }
  function poserDisponibilitesFormules(disponibilites) {
    $$('[data-formule]',gridFor).forEach(function(card) {
      var f=((meta && meta.formules)||[]).filter(function(x){return x.id===card.dataset.formule;})[0];
      if(!f)return;
      var v=verdictFormule(f),off=$('.fg-for__off',card);
      card.classList.toggle('is-refus',!v.ok);
      if(disponibilites && disponibilites[f.id] && disponibilites[f.id].available===false && disponibilites[f.id].code!=='calendar')card.setAttribute('aria-disabled','true');
      else card.removeAttribute('aria-disabled');
      if(!v.ok){if(!off){off=doc.createElement('span');off.className='fg-for__off';card.appendChild(off);}off.textContent=v.pourquoi;}
      else if(off)off.remove();
      if(!v.ok && state.formuleId===f.id){state.formuleId='';card.classList.remove('is-on');card.setAttribute('aria-checked','false');card.closest('.fg-grid__item').classList.remove('is-on');}
    });
    rendreCompteur(false);
  }
  function texteDuree(d) {
    var a = Math.round(Number(d && d.min) / 5) * 5, b = Math.round(Number(d && d.max) / 5) * 5;
    if (!(a > 0) || !(b > 0)) return '';
    return a === b ? 'Environ ' + insecable(dureeExacte(a)) + ' sur place' : insecable(dureeExacte(a)) + ' à ' + insecable(dureeExacte(b)) + ' sur place selon l’heure';
  }
  function poserDurees(durees) {
    $$('[data-duree-for]', gridFor).forEach(function (el) {
      var t = durees && durees[el.dataset.dureeFor] ? texteDuree(durees[el.dataset.dureeFor]) : '';
      if (!t) { el.remove(); return; }
      $('span', el).textContent = t;
      el.classList.remove('is-wait');
    });
  }
  function chargerDurees() {
    if (!state.date || !(state.pax > 0)) { poserDurees({}); return; }
    var cle = state.date + '|' + state.pax,realKey=cleDisponibilitesFormules();
    if (dureesCache[cle]) poserDurees(dureesCache[cle]);
    if (Date.now()-(disponibilitesFormulesTemps[realKey]||0)<10000) { poserDisponibilitesFormules(disponibilitesFormules[realKey]); return; }
    if(dureesChargement && dureesEnCours===realKey)return;
    if(dureesChargement)dureesChargement.abort();
    dureesChargement=new AbortController();var controller=dureesChargement;
    dureesEnCours = realKey;
    lire('/api/public-availability?' + new URLSearchParams({ centerId: CENTER, date: state.date, pax: String(state.pax), type: 'durees' }).toString(), { signal: controller.signal })
      // Le corps se lit meme en erreur : laisse non lu (404 d un centre
      // inconnu), il garde la requete ouverte dans le navigateur.
      .then(function (r) { return r.ok ? lu(r) : null; })
      .then(function (rep) {
        var d = rep && rep.ok && rep.durees ? rep.durees : null;
        if (d) dureesCache[cle] = d;
        if (!controller.signal.aborted && dureesEnCours===realKey && cleDisponibilitesFormules()===realKey) {
          poserDurees(d || {});
          if(rep && rep.ok && rep.formulaAvailability){disponibilitesFormules[realKey]=rep.formulaAvailability;disponibilitesFormulesTemps[realKey]=Date.now();poserDisponibilitesFormules(rep.formulaAvailability);}
        }
        if(dureesChargement===controller)dureesChargement=null;
      })
      .catch(function () { if (!controller.signal.aborted && cleDisponibilitesFormules()===realKey) poserDurees({}); if(dureesChargement===controller)dureesChargement=null; });
  }
  function rendreFormules() {
    // Une formule dont une activite manque a ce centre (missingActivityIds,
    // la plaine de jeux de Gembloux) ne peut jamais y etre planifiee.
    var liste = ((meta && meta.formules) || []).filter(function (f) { return !(Array.isArray(f.missingActivityIds) && f.missingActivityIds.length); });
    if (!liste.length) { gridFor.innerHTML = '<p class="fg-empty">Aucune formule ne se réserve en ligne pour le moment.' + ligneCentre() + '</p>'; return; }
    // Une famille par section (anniversaires, offres speciales) : quatorze
    // cartes a la suite ne se lisaient pas. L ordre des familles est celui du
    // catalogue, jamais une liste ecrite ici.
    var familles = [], parFamille = {};
    liste.forEach(function (f) {
      var cle = f.family || 'Formules';
      if (!parFamille[cle]) { parFamille[cle] = []; familles.push(cle); }
      parFamille[cle].push(f);
    });
    var n = 0;
    gridFor.innerHTML = familles.map(function (cle) {
      var cartes = parFamille[cle].map(function (f) {
        var on = state.formuleId === f.id;
        var v = verdictFormule(f);
        var regles = reglesFormule(f);
        n += 1;
        return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '">'
          + '<div class="fg-card fg-card--formule fg-rise' + (on ? ' is-on' : '') + (v.ok ? '' : ' is-refus') + '" style="--i:' + (n % 8) + '" data-formule="' + esc(f.id) + '" role="radio" tabindex="0" aria-checked="' + on + '">'
          + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
          + '<span class="fg-for__head"><span class="fg-card__name">' + esc(f.name) + '</span>'
          + (f.best ? '<span class="fg-for__best">Bon plan</span>' : '') + '</span>'
          + '<span class="fg-for__price"><b>' + esc(euros(f.price)) + '</b><small>' + (f.type === 'per_lane' ? 'la piste' : f.kidsOnly ? 'par enfant' : 'par personne') + '</small>'
          + (f.oldPrice ? '<s>' + esc(euros(f.oldPrice)) + '</s>' : '') + '</span>'
          + '<span class="fg-for__time is-wait" data-duree-for="' + esc(f.id) + '"><svg aria-hidden="true"><use href="#i-clock"/></svg><span></span></span>'
          + '<ul class="fg-for__list">' + (f.desc || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
          + (regles.length ? '<span class="fg-for__rules">' + regles.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span>' : '')
          + (v.ok ? '' : '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>' + esc(v.pourquoi) + '</span>')
          + '</div>'
          + htmlInfoFormule(f)
          + (f.kidsOnly && v.ok ? rendreEnfants(f) : '')
          + '</li>';
      }).join('');
      return '<section class="fg-fam"><h3 class="fg-fam__title">' + esc(libelleFamille(cle)) + '<span>' + parFamille[cle].length + ' formule' + (parFamille[cle].length > 1 ? 's' : '') + '</span></h3>'
        + '<ul class="fg-grid fg-grid--for">' + cartes + '</ul></section>';
    }).join('');
    chargerDurees();
  }
  // LES ENFANTS D UNE OFFRE QUI LEUR EST RESERVEE (Kids Fun Day, « pour les
  // enfants de 5 a 12 ans », lu dans la description du centre par le
  // serveur : kidsOnly). Le groupe du premier ecran compte tout le monde ; la
  // carte demande combien sont des enfants, les autres les accompagnent sans
  // payer la formule (Movsar, 2026-09-28 : « demander enfants / adultes ;
  // seuls les enfants paient la formule »). Par defaut, tout le groupe : rien
  // ne se paie en moins sans que le client l ait dit.
  function enfantsDuGroupe() {
    var n = Math.trunc(Number(state.enfants));
    return Math.min(state.pax, Math.max(1, n > 0 ? n : state.pax));
  }
  function joueursDemandes() { var f = formuleChoisie(); return f && f.kidsOnly ? enfantsDuGroupe() : state.pax; }
  function accompagnantsDemandes() { return state.pax - joueursDemandes(); }
  // Le groupe tel qu il se dit partout apres le choix : « 6 enfants + 2
  // adultes » pour une offre reservee aux enfants, « 8 personnes » sinon.
  function groupeLisible() {
    var f = formuleChoisie();
    if (!(f && f.kidsOnly)) return personnes(state.pax);
    var n = enfantsDuGroupe(), a = state.pax - n;
    return n + ' enfant' + (n > 1 ? 's' : '') + (a > 0 ? ' + ' + a + ' adulte' + (a > 1 ? 's' : '') : '');
  }
  function textesEnfants(f) {
    var n = enfantsDuGroupe(), a = state.pax - n;
    return {
      adultes: a > 0 ? '+ ' + a + ' adulte' + (a > 1 ? 's' : '') + ' qui accompagne' + (a > 1 ? 'nt' : '') + ', sans payer la formule' : 'Aucun adulte accompagnant',
      prix: f.type === 'per_pax' && Number(f.price) > 0 ? euros(f.price * n) + ' pour ' + n + ' enfant' + (n > 1 ? 's' : '') : '',
    };
  }
  function rendreEnfants(f) {
    var n = enfantsDuGroupe(), t = textesEnfants(f), id = 'kids-' + String(f.id).replace(/[^a-z0-9_-]/gi, '');
    return '<div class="fg-card__opt"><div class="fg-card__optin"><div class="fg-card__optbox fg-kids" data-kids-for="' + esc(f.id) + '">'
      + '<span class="fg-card__optlabel" id="' + id + '">Enfants de ' + f.kidsOnly.ageMin + ' à ' + f.kidsOnly.ageMax + ' ans</span>'
      + '<div class="fg-kids__row"><div class="fg-stepper fg-kids__stepper" role="group" aria-labelledby="' + id + '">'
      + '<button type="button" class="fg-stepper__btn" data-kids="-1" aria-label="Un enfant de moins"' + (n <= 1 ? ' disabled' : '') + '>&minus;</button>'
      + '<output class="fg-kids__n" aria-live="polite">' + n + '</output>'
      + '<button type="button" class="fg-stepper__btn" data-kids="1" aria-label="Un enfant de plus"' + (n >= state.pax ? ' disabled' : '') + '>+</button>'
      + '</div><p class="fg-kids__adults">' + esc(t.adultes) + '</p></div>'
      + (t.prix ? '<p class="fg-card__rot fg-kids__prix">' + esc(t.prix) + '</p>' : '')
      + '</div></div></div>';
  }
  function majEnfants() {
    $$('.fg-kids', gridFor).forEach(function (box) {
      var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === box.dataset.kidsFor; })[0];
      if (!f) return;
      var n = enfantsDuGroupe(), t = textesEnfants(f);
      $('.fg-kids__n', box).textContent = String(n);
      $('[data-kids="-1"]', box).disabled = n <= 1;
      $('[data-kids="1"]', box).disabled = n >= state.pax;
      $('.fg-kids__adults', box).textContent = t.adultes;
      var prix = $('.fg-kids__prix', box);
      if (prix) prix.textContent = t.prix;
    });
  }
  // Reveil du bouton qui avance. La classe se RETIRE apres l animation :
  // laissee en place, elle rejouerait a chaque retour sur l ecran (une scene
  // cachee est en display:none, et son retour redemarre toute animation CSS).
  function eveiller(btn) {
    clearTimeout(btn._eveil);
    relancer(btn, 'is-wake');
    btn._eveil = setTimeout(function () { btn.classList.remove('is-wake'); }, 600);
  }
  // A zero, la barre dit quoi faire, et rappelle ce qui reste choisi dans
  // l autre onglet (changer d onglet ne vide ni la selection ni la formule).
  function rendreCompteur(bump) {
    var formules = state.onglet === 'formules';
    var nA = state.selection.length, nF = state.formuleId ? 1 : 0;
    var n = formules ? nF : nA;
    if (n) actCount.innerHTML = '<b>' + n + '</b> ' + esc((formules ? 'formule' : 'activité') + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : ''));
    else actCount.textContent = formules
      ? 'Choisissez une formule' + (nA ? ', ou revenez à ' + (nA > 1 ? 'vos ' + nA + ' activités' : 'votre activité') : '') + '.'
      : (nF ? 'Cochez des activités, ou revenez à votre formule.' : 'Cochez une ou plusieurs activités.');
    var b = $('b', actCount);
    if (bump && b) relancer(b, 'is-bump');
    var etaitInactif = goHours.disabled;
    goHours.disabled = n === 0;
    if (bump && etaitInactif && !goHours.disabled) eveiller(goHours);
  }
  // La photo d une carte ne se telecharge que quand elle peut se voir : au
  // survol, au focus clavier, ou quand la carte est cochee. Huit photos
  // chargees d avance pesaient 400 Ko pour un ecran qui n en montre aucune.
  // Un doigt ne survole pas : le toucher la charge en cochant, et un doigt
  // qui fait defiler la liste ne telecharge plus chaque carte qu il effleure.
  function chargerPhotoCarte(card) {
    var img = card && card.querySelector('.fg-card__photo img[data-src]');
    if (!img) return;
    img.src = img.dataset.src;
    delete img.dataset.src;
  }
  gridAct.addEventListener('pointerenter', function (e) {
    if (e.pointerType === 'touch') return;
    chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card'));
  }, true);
  gridAct.addEventListener('focusin', function (e) { chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card')); });
  // Le prix ne roule que sur un geste qui le change (pastille choisie, carte
  // cochee) : decocher le rend a « Des X » sans rien jouer.
  function majPrixCarte(item, a, anime) {
    item = tuileActivite(item);
    var prix = $('.fg-card__price', item);
    if (!prix || !a) return;
    var avant = prix.textContent;
    prix.textContent = typo(prixCarte(a) + (precisionsCarte(a) ? ' · ' + precisionsCarte(a) : ''));
    if (anime && prix.textContent !== avant) rejouer(prix, 'is-maj');
  }
  function retirerActivite(id) { var card = $('.fg-card[data-activity="' + id + '"]', gridAct); basculerActivite(card); $('.fg-card-select', card.closest('.fg-grid__item')).focus({ preventScroll:true }); }
  function basculerActivite(card) {
    // Refusee pour ce groupe : on fait lire la raison, on ne coche pas.
    if (card && card.classList.contains('is-refus')) {
      var pourquoi = card.querySelector('.fg-for__off');
      if (pourquoi) { relancer(pourquoi, 'is-pulse'); dire(pourquoi.textContent.trim()); }
      return;
    }
    if (!card || card.classList.contains('is-off')) return;
    chargerPhotoCarte(card);
    var item = card.closest('.fg-grid__item');
    var id = item.dataset.activity;
    var i = state.selection.indexOf(id);
    if (i >= 0) state.selection.splice(i, 1); else state.selection.push(id);
    var on = i < 0;
    card.classList.toggle('is-on', on);
    if (on) rejouer(card, 'is-coche'); else card.classList.remove('is-coche');
    item.classList.toggle('is-on', on);
    card.setAttribute('aria-checked', String(on));
    var caseChoix = $('.fg-card-select', item); caseChoix.classList.toggle('is-on', on); caseChoix.setAttribute('aria-checked', String(on));
    majPrixCarte(item, activite(id), on);
    majPastilles(item, activite(id));
    rendreCompteur(true);
    invaliderDispo();
    rendreEditeurActivites(gridAct, on ? id : '', retirerActivite, on);
    setTimeout(posterHauteur, 320);
  }
  function changerCompteur(btn, valeur) {
    var item = btn.closest('.fg-grid__item');
    var a = activite(item && item.dataset.activity);
    var box = btn.closest('[data-compteur]');
    var c = compteurDe(a, box && box.dataset.compteur);
    if (!a || !c) return;
    var n = Math.min(c.max, Math.max(c.min, Math.trunc(valeur == null ? c.n + Number(btn.dataset.pas) : valeur)));
    if (!isFinite(n)) return;
    state.options[a.id] = Object.assign({}, state.options[a.id] || {});
    state.options[a.id][c.cle] = n;
    var apres = compteurDe(a, c.cle);
    if (box) {
      var chiffre = $('.fg-kids__n', box);
      if (chiffre.tagName === 'INPUT') { if (doc.activeElement !== chiffre || valeur == null) chiffre.value = String(apres.n); }
      else chiffre.textContent = String(apres.n);
      $('[data-pas="-1"]', box).disabled = apres.n <= apres.min;
      $('[data-pas="1"]', box).disabled = apres.n >= apres.max;
    }
    var txt = item.querySelector('[data-compteur-texte]');
    if (txt) txt.textContent = texteCompteur(apres);
    majPastilles(item, a);
    var cartes = reglageArcade(a) && $('[data-compteur="cards"] input', item);
    if (cartes && c.cle === 'participants' && state.options[a.id].cards == null) cartes.value = String(reglageArcade(a).cards);
    majPrixCarte(item, a, true);
    invaliderDispo();
    dire(apres.n + ' ' + apres.mot + (apres.n > 1 ? 's' : '') + '.');
  }
  gridAct.addEventListener('input', function (e) {
    if (!e.target.matches('.fg-count__input')) return;
    var n = Number(e.target.value);
    if (e.target.value !== '' && Number.isInteger(n) && n >= Number(e.target.min) && n <= Number(e.target.max)) changerCompteur(e.target, n);
  });
  gridAct.addEventListener('change', function (e) {
    if (e.target.matches('.fg-arcade-select')) {
      var item = e.target.closest('.fg-grid__item'), a = activite(item.dataset.activity), ar = reglageArcade(a);
      if (!ar || !ar.offers.some(function (o) { return o.id === e.target.value; })) return;
      state.options[a.id] = choixArcade(a, state.options[a.id], 'arcadeOfferId', e.target.value); majPastilles(item, a); majPrixCarte(item, a, true); invaliderDispo(); return;
    }
    if (!e.target.matches('.fg-count__input')) return;
    var cle = e.target.closest('[data-compteur]').dataset.compteur;
    var c = compteurDe(activite(e.target.closest('.fg-grid__item').dataset.activity), cle);
    var n = e.target.value.trim() ? Number(e.target.value) : c.n;
    changerCompteur(e.target, isFinite(n) ? n : c.n);
    e.target.value = String(compteurDe(activite(e.target.closest('.fg-grid__item').dataset.activity), cle).n);
  });
  gridAct.addEventListener('click', function (e) {
    var choix = e.target.closest('[data-activity-toggle]');
    if (choix) { basculerActivite($('.fg-card', choix.closest('.fg-grid__item'))); return; }
    var pas = e.target.closest('[data-pas]');
    if (pas) { if (!pas.disabled) changerCompteur(pas); return; }
    var pill = e.target.closest('.fg-pill');
    if (pill) { choisirPastille(pill); return; }
    basculerActivite(e.target.closest('.fg-card'));
  });
  gridAct.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('fg-card')) { e.preventDefault(); basculerActivite(e.target); return; }
    // Les pastilles forment un groupe radio : les fleches passent de l une a l autre.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.classList && e.target.classList.contains('fg-pill')) {
      var pills = $$('.fg-pill', e.target.closest('.fg-pills'));
      var k = pills.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1);
      if (k < 0 || k >= pills.length) return;
      e.preventDefault();
      choisirPastille(pills[k]);
      pills[k].focus({ preventScroll: true });
    }
  });
  function choisirFormule(card) {
    // Une formule refusee ce jour-la reste TOUCHABLE (sa raison est ecrite sur
    // la carte, et on la fait clignoter au clic) : la declarer inoperable la
    // rendrait muette pour un lecteur d ecran comme pour un doigt.
    if (card && card.classList.contains('is-refus')) {
      var pourquoi = card.querySelector('.fg-for__off');
      // La raison se dit aussi : dans une carte role="radio", les enfants sont
      // presentationnels, une region vivante posee dedans ne parlait pas.
      if (pourquoi) { relancer(pourquoi, 'is-pulse'); dire(pourquoi.textContent.trim()); }
      return;
    }
    if (!card || card.classList.contains('is-off')) return;
    var id = card.dataset.formule;
    state.formuleId = state.formuleId === id ? '' : id;
    $$('.fg-card', gridFor).forEach(function (c) { var on = c.dataset.formule === state.formuleId; c.classList.toggle('is-on', on); c.closest('.fg-grid__item').classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); if (!on) c.classList.remove('is-coche'); });
    if (state.formuleId === id) rejouer(card, 'is-coche');
    rendreCompteur(true);
    invaliderDispo();
  }
  gridFor.addEventListener('click', function (e) {
    var pas = e.target.closest('[data-kids]');
    if (pas) {
      if (pas.disabled) return;
      state.enfants = enfantsDuGroupe() + Number(pas.dataset.kids);
      majEnfants();
      invaliderDispo();
      var n = enfantsDuGroupe(), a = state.pax - n;
      dire(n + ' enfant' + (n > 1 ? 's' : '') + (a > 0 ? ' et ' + a + ' adulte' + (a > 1 ? 's' : '') + ' accompagnant' + (a > 1 ? 's' : '') : '') + '.');
      return;
    }
    choisirFormule(e.target.closest('.fg-card'));
  });
  gridFor.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('fg-card')) { e.preventDefault(); choisirFormule(e.target); }
  });
  // Un geste se joue une fois : la classe part a la fin, sinon il rejouerait
  // chaque fois que l onglet ou l ecran se re-affiche (display none -> block).
  function finGeste(e) {
    if (e.animationName === 'fg-tick') { var c = e.target.closest('.fg-card'); if (c) c.classList.remove('is-coche'); }
    else if (e.animationName === 'fg-maj') e.target.classList.remove('is-maj');
  }
  gridAct.addEventListener('animationend', finGeste);
  gridFor.addEventListener('animationend', finGeste);
  // La pastille suit l onglet courant : une classe, rien a mesurer.
  function placerBarre() { $('.fg-tabs').classList.toggle('is-for', state.onglet === 'formules'); }
  function choisirOnglet(quel) {
    state.onglet = quel;
    var act = quel === 'activites';
    if (!act) rendreFormulesEnRetard();
    $('#tabAct').setAttribute('aria-selected', String(act));
    $('#tabFor').setAttribute('aria-selected', String(!act));
    $('#tabAct').tabIndex = act ? 0 : -1;
    $('#tabFor').tabIndex = act ? -1 : 0;
    $('#panelAct').hidden = !act;
    $('#panelFor').hidden = act;
    placerBarre();
    rendreCompteur(false);
    setTimeout(posterHauteur, 50);
  }
  $('#tabAct').addEventListener('click', function () { choisirOnglet('activites'); });
  $('#tabFor').addEventListener('click', function () { choisirOnglet('formules'); });
  // Clavier (motif onglets de l APG) : fleche gauche ou droite = l autre
  // onglet, Debut/Fin = le premier/le dernier ; la selection suit le focus.
  $('.fg-tabs').addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var vers = e.key === 'Home' ? 'activites' : e.key === 'End' ? 'formules'
      : (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? (state.onglet === 'activites' ? 'formules' : 'activites') : '';
    if (!vers) return;
    e.preventDefault();
    if (vers !== state.onglet) choisirOnglet(vers);
    (vers === 'activites' ? $('#tabAct') : $('#tabFor')).focus({ preventScroll: true });
  });
  goHours.addEventListener('click', function () { if (!goHours.disabled) { aller('heures'); chargerHeures(); } });

  /* --- Etape 3 : les heures ---------------------------------------------------- */

  var hourZone = $('#hourZone'), hourSub = $('#hourSub'), goContact = $('#goContact'), keepLabel = $('#keepLabel'), hourSum = $('#hourSum');
  // L attente du premier calcul : la forme d une piste, jamais un nombre de
  // pistes devine. Ni piste, ni bloc de visite, ni heure dedans : rien ne
  // doit passer pour une reponse.
  var SQUELETTE = '<div class="fg-skel"><p class="fg-skel__txt">On regarde ce qui est libre…</p><div class="fg-skel__card" aria-hidden="true"><i></i><i style="--i:1"></i><i style="--i:2"></i><i style="--i:3"></i></div></div>';
  var requeteEnCours = 0;
  var planEnCours = null;      // la lecture du plan en route : une plus recente, ou une demande qui change, l annule
  var contactRetenu = false;   // « Ces horaires me vont » touche pendant un recalcul : il part a la reponse
  var reveilGarder = false;    // « Garder » s eveille a la premiere reponse apres l arrivee sur les heures, pas a chaque heure posee
  var signaturePistes = '';    // les pistes rendues (activites + heures) : sinon, on met a jour sur place
  var adaptation = null;       // { deplace, pour, t } : l activite deplacee pour l heure posee
  var libreOuvert = '';        // 'HH:MM-HH:MM' : le temps libre de l agenda deplie
  var arrivees = { cle: '', liste: null, bornes: null, message: '', lu: 0, enCours: '', erreur: false }; // la liste des heures d arrivee d une formule (arrivals=1)
  var arcades = { cle: '', liste: null, lu: 0, enCours: '', erreur: false }; // les heures d arcade d une arrivee (arcades=1)
  var grilleSansArrivee = null; // { cle, anchors } : la grille de la derniere reponse sans heure d arrivee
  function invaliderDispo() { if (state.attente && state.attente.cle !== cleBase()) state.attente = null; state.dispo = null; state.creneau = null; state.heure = ''; state.pins = {}; state.laserParts = []; state.heuresPassees = {}; state.arrivee = ''; state.arcade = ''; arrivees.cle = ''; arcades.cle = ''; adaptation = null; signaturePistes = ''; etapeOuverte = null; etapeTouchee = false; partiesSurPlace = false; goContact.disabled = true; annulerPlan(); libererBlocage(); }
  // UNE DEMANDE QUI CHANGE COUPE SON CALCUL EN ROUTE (2026-10-12) : le retour
  // aux activites pendant un calcul, puis un geste. La reponse ne servait
  // plus a rien (la cle de la demande la jetait), mais elle se telechargeait
  // et se lisait quand meme, sur un telephone deja lent.
  function annulerPlan() {
    if (!planEnCours) return;
    planEnCours.abort(); planEnCours = null;
    requeteEnCours += 1;
    hourZone.classList.remove('is-busy');
    lacherContact();
  }
  function lacherContact() { if (!contactRetenu) return; contactRetenu = false; occuper(goContact, false); }
  // LES LIGNES CHOISIES a l ecran des activites, puis l offre d attente
  // acceptee, tant que la demande est celle pour laquelle elle a ete
  // proposee (meme jour, meme groupe, memes activites et options). Changer
  // l un de ceux-la la fait tomber : elle ne revient jamais toute seule.
  function programme() {
    var lignes = lignesChoisies();
    var att = attenteRetenue();
    if (att) lignes.push({ activityId: att.activityId, waitOffer: true, participants: att.participants });
    return lignes;
  }
  function cleBase() { return state.date + '|' + state.pax + '|' + joueursDemandes() + '|' + JSON.stringify(lignesChoisies()); }
  function attenteRetenue() {
    var a = state.attente;
    return a && state.onglet !== 'formules' && a.cle === cleBase() ? a : null;
  }
  function lignesChoisies() {
    return state.selection.map(function (id) {
      var a = activite(id) || {};
      var ligne = { activityId: id };
      var opt = optionChoisie(a);
      if (a.priceType === 'grid_bowling') ligne.duration = opt ? opt.valeur : 1;
      if (a.priceType === 'grid_laser') ligne.games = opt ? opt.valeur : 1;
      if (a.priceType === 'grid_fun_run') ligne.minutes = opt ? opt.valeur : (a.defaultMinutes || 15);
      // Les billards : les tables et les heures choisies. Sans elles, le
      // serveur retombait sur une table pendant une heure, quoi qu on ait
      // choisi (audit du 2026-09-28).
      if (a.priceType === 'per_unit_hour') { var billard = reglageBillard(a); ligne.units = billard.units; ligne.hours = billard.hours; }
      var arcade = reglageArcade(a);
      if (arcade) { ligne.arcadeMode = arcade.mode; ligne.arcadeOfferId = arcade.offer.id; ligne.cards = arcade.cards; }
      // Le serveur compte CE sous-groupe pour le prix et la capacite. Sans
      // champ, tout le groupe participe (contrat historique).
      if (seCompteParEnfant(a) || joueursDe(a) < state.pax) ligne.participants = joueursDe(a);
      var extra = state.options[id] || {};
      if (extra.upsell) ligne.upsell = Object.assign({}, extra.upsell, { participants: joueursDe(a) });
      if (extra.extraLaser) ligne.extraLaser = Object.assign({}, extra.extraLaser);
      return ligne;
    });
  }
  function nomsChoisis() {
    if (state.onglet === 'formules') { var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0]; return f ? f.name : ''; }
    return state.selection.map(nomActivite).join(' + ');
  }
  // `liste` : la liste des heures d arrivee d une formule (arrivals=1), jugee
  // avec les heures deja posees (2026-10-13), comme le plan qu elle annonce ;
  // 'arcades' : les heures d arcade de l arrivee choisie (arcades=1).
  function urlDispo(liste) {
    var q = new URLSearchParams();
    q.set('centerId', CENTER); q.set('date', state.date); q.set('pax', String(joueursDemandes()));
    if (state.onglet === 'formules') { q.set('type', 'formule'); q.set('formuleId', state.formuleId); }
    else {
      q.set('type', 'visite'); q.set('program', JSON.stringify(programme()));
      // Le temps des activites libres est un conseil, pas un interdit : les
      // heures qui le rognent restent possibles, avec un avertissement.
      q.set('softReserve', '1');
    }
    var pins = {};
    Object.keys(state.pins).forEach(function (k) { if (state.pins[k]) pins[k] = state.pins[k]; });
    if (state.laserParts.length) { pins.laser_game = state.laserParts[0]; q.set('laserGameTimes', JSON.stringify(state.laserParts)); }
    if (Object.keys(pins).length) q.set('preferredTimes', JSON.stringify(pins));
    // L heure d arcade choisie ne vaut qu avec une arrivee (2026-10-13).
    if (state.arrivee && state.arcade) q.set('arcade', state.arcade);
    if (liste === 'arcades') { q.set('arrival', state.arrivee); q.set('arcades', '1'); return '/api/public-availability?' + q.toString(); }
    if (liste) { q.set('arrivals', '1'); return '/api/public-availability?' + q.toString(); }
    // L HEURE D ARRIVEE choisie part seule, en dernier : sans elle, la demande
    // reste celle d avant, au caractere pres.
    if (state.arrivee) q.set('arrival', state.arrivee);
    return '/api/public-availability?' + q.toString();
  }
  // UNE REPONSE NE SERT QU A LA DEMANDE QUI L A PRODUITE : le jour, le groupe,
  // le mode (activites ou formule) et ce qui est choisi. Changer d onglet ne
  // vide rien, et une reponse peut arriver apres un changement : sans cette
  // cle, une formule reprenait le plan et le prix calcules pour des activites.
  function cleDemande() { return state.date + '|' + state.pax + '|' + joueursDemandes() + '|' + (state.onglet === 'formules' ? 'f:' + state.formuleId : 'v:' + JSON.stringify(programme())); }
  function chargerHeures() {
    if (state.dispo && state.dispoCle !== cleDemande()) invaliderDispo();
    var j = jourInfo(state.date);
    hourSub.innerHTML = '<b>' + esc(insecable(jourCourt(state.date))) + '</b>\u00a0· ' + esc(insecable(groupeLisible())) + '\u00a0· ' + nomsChoisis().split(' + ').map(function (n) { return esc(finInsecable(n)); }).join('\u00a0+ ')
      + (j && j.ouvert ? '<span class="fg-sub__open">Ouvert ' + esc(j.horaire) + (j.periode ? ' · ' + esc(j.periode.label) : '') + '</span>' : '');
    if (state.dispo) { rendreHeures(); return; }
    hourZone.innerHTML = SQUELETTE;
    hourSum.textContent = '';
    reveilGarder = true;
    chargerPlan();
  }
  // LE FOCUS NE TOMBE JAMAIS SUR LA PAGE. Un recalcul qui cache ou remplace
  // ce qui avait le focus (« Revenir a l heure proposee » masque, proposition
  // reecrite, zone reecrite en erreur, pistes reconstruites) le rend au plus
  // proche : l heure retenue de la meme piste, sinon son menu ouvert ; depuis
  // le bloc de la visite, son premier bouton ; sinon le premier menu ouvert,
  // sinon le titre (tabindex -1 pose par aller). Au clavier, la cible est
  // amenee dans ce qui se voit (montrer, cadre compris).
  function repereFocus() {
    var f = doc.activeElement;
    if (!f || !hourZone.contains(f)) return null;
    var t = f.closest('.fg-track');
    return { piste: t ? t.dataset.activity : null, plan: Boolean(f.closest('#planZone')), clavier: focusClavier(f) };
  }
  function rendreFocus(r) {
    if (!r) return;
    var f = doc.activeElement;
    if (f && f !== body && f.isConnected && getComputedStyle(f).visibility !== 'hidden') return;
    var piste = r.piste !== null ? $('.fg-track[data-activity="' + r.piste + '"]', hourZone) : null;
    // Une piste dans une ligne repliee ne se voit pas : le focus va a sa ligne.
    var ligne = piste && piste.closest('.fg-etape');
    var visible = piste && (!ligne || ligne.classList.contains('is-open'));
    var cible = (visible && ($('.fg-period.is-open .fg-chip[aria-selected="true"]', piste) || $('.fg-period.is-open .fg-period__btn', piste)))
      || (ligne && $('.fg-etape__tete', ligne))
      || (r.plan && $('#planZone button'))
      || $('.fg-period.is-open .fg-period__btn', hourZone) || $('#t-hour');
    if (!cible) return;
    cible.focus({ preventScroll: true });
    if (r.clavier) montrer(cible);
  }
  // Une seule route pour tout : sans heure posee, le serveur compose la
  // premiere combinaison possible et rend la grille ; avec des heures posees,
  // il recalcule la grille autour d elles et le plan qui en decoule.
  function chargerPlan() {
    var id = ++requeteEnCours, cle = cleDemande();
    var repere = repereFocus();
    // La case touchee qui attend cette reponse : l onde partira d elle si le
    // plan du serveur la retient.
    var attente = $('.fg-chip.is-pending', hourZone), pisteAttente = attente ? attente.closest('.fg-track') : null;
    var idAttente = pisteAttente ? pisteAttente.dataset.activity : '', heureAttente = attente ? attente.dataset.time : '';
    // LE CALCUL PERIME EST COUPE (2026-10-12). Trois heures touchees vite :
    // trois calculs, et les deux premiers se telechargeaient et se lisaient
    // jusqu au bout pour rien (sonde : 3 partis, 3 finis, aucun coupe). Le
    // plus recent annule le precedent.
    if (planEnCours) planEnCours.abort();
    var controle = planEnCours = new AbortController();
    // UN PLAN AFFICHE GARDE SON BOUTON PENDANT LE RECALCUL (2026-10-12). Grise
    // a chaque calcul, « Ces horaires me vont » avalait le toucher qui tombait
    // dans la fenetre, sans un mot (sonde : 4 s de calcul, toucher perdu). Il
    // reste touchable, le toucher est retenu et part a la reponse
    // (garderHoraires, poserPlan). Sans plan a l ecran (premier calcul,
    // panne), rien a garder : il reste gris.
    if (!(state.dispo && state.creneau)) goContact.disabled = true;
    hourZone.classList.add('is-busy');
    lire(urlDispo(), { headers: enteteBlocage(), signal: controle.signal })
      .then(function (rep) {
        if (id !== requeteEnCours) return;
        var j = lu(rep);
        if (!j || j.ok === false) throw erreurLisible(j, 'Les horaires ne se sont pas chargés. Réessayez dans un instant.');
        if (planEnCours === controle) planEnCours = null;
        poserPlan(j, rep.texte, cle, repere, idAttente, heureAttente);
      })
      .catch(function (err) {
        if (id !== requeteEnCours || (err && err.annule)) return;
        if (planEnCours === controle) planEnCours = null;
        hourZone.classList.remove('is-busy');
        // Plus de plan : plus rien a garder, le toucher retenu tombe avec lui.
        goContact.disabled = true;
        lacherContact();
        var msgErr = err && err.lisible ? err.message : 'Les horaires ne se sont pas chargés. Réessayez dans un instant.';
        hourZone.innerHTML = '<div class="fg-notice fg-notice--warn"><b>' + esc(msgErr) + '</b><span class="fg-suggest"><button type="button" class="fg-suggest__btn" data-retry>Réessayer</button></span></div>';
        state.dispo = null;
        hourSum.textContent = '';
        signaturePistes = '';
        posterHauteur();
        if (sceneCourante === 'heures') dire(msgErr);
        rendreFocus(repere);
      });
  }
  // LA REPONSE DEVIENT LE PLAN : celle du calcul demande (chargerPlan), ou
  // celle de la relecture de fond qui a vu un changement (relireHeures), sans
  // la redemander. `texte` : la reponse telle que recue, que la relecture
  // compare.
  function poserPlan(j, texte, cle, repere, idAttente, heureAttente) {
    // LE CENTRE A COUPE L HEURE D ARRIVEE entre la liste et le plan
    // (arrivalBounds.arrivalFirst false) : l option disparait, l arrivee
    // choisie tombe, les heures des activites reviennent.
    if (j.arrivalBounds) { cleArrivees(cle); arrivees.bornes = j.arrivalBounds; }
    if (state.arrivee && j.arrivalBounds && j.arrivalBounds.arrivalFirst === false) { hourZone.classList.remove('is-busy'); lacherContact(); arriveeRetiree(); return; }
    // La grille d une reponse d arrivee est jugee avec elle : elle ne remplace
    // pas celle d une demande sans arrivee.
    if (j.anchors && !j.arrival) grilleSansArrivee = { cle: cle, anchors: j.anchors };
    state.dispo = j; state.dispoCle = cle; state.dispoTexte = texte;
    heuresLues = Date.now();
    plus.statut = null; plus.annuler = null; plus.refuses = {};
    // UNE HEURE POSEE DEVENUE PASSEE (2026-09-30) : le serveur l a retiree
    // de la demande (`heuresPassees`) ; elle sort aussi du choix du client,
    // et sa piste le dit jusqu a ce qu il en choisisse une autre.
    var passees = Array.isArray(j.heuresPassees) ? j.heuresPassees : [];
    passees.forEach(function (p) {
      if (!p || !p.activityId || !p.time) return;
      if (p.activityId === 'laser_game') {
        state.laserParts = state.laserParts.filter(function (h) { return h !== p.time; });
        if (state.laserParts.length) state.pins.laser_game = state.laserParts[0]; else delete state.pins.laser_game;
      } else if (state.pins[p.activityId] === p.time) delete state.pins[p.activityId];
      var deja = state.heuresPassees[p.activityId] || [];
      if (deja.indexOf(p.time) < 0) state.heuresPassees[p.activityId] = deja.concat(p.time).sort();
    });
    if (passees.length) dire(passees.length > 1 ? 'Des heures choisies sont passées : choisissez-en d’autres.' : 'L’heure de ' + passees[0].time + ' est passée : choisissez-en une autre.');
    var slot = (j.slots || [])[0] || null;
    state.creneau = slot ? creneauAvecDevis(slot, j) : null;
    state.heure = slot ? slot.time : '';
    // Une arrivee que la liste disait possible, refusee par le plan (prise
    // entre-temps) : la liste ouverte se relit, ses heures restent vraies.
    if (state.arrivee && !slot && arrivees.liste) { arrivees.lu = 0; if (etapeOuverte === 'arrivee') chargerArrivees(); }
    hourZone.classList.remove('is-busy');
    rendreHeures();
    $$('.fg-chip.is-pending', hourZone).forEach(function (c) { c.classList.remove('is-pending'); });
    var posee = idAttente ? $('.fg-track[data-activity="' + idAttente + '"] .fg-chip[data-time="' + heureAttente + '"]', hourZone) : null;
    // La ligne avance bouton eteint, comme quand il l etait pendant tout le
    // calcul : ni reveil, ni focus pour lui (« Garder » s eveille une fois, a
    // l arrivee sur les heures). Rallume dans la meme tache, il garde son focus.
    goContact.disabled = true;
    if (posee && posee.classList.contains('is-on') && planRetient(idAttente, heureAttente)) { rejouer(posee, 'is-pose'); avancerEtape(); }
    goContact.disabled = !slot;
    var retenu = contactRetenu;
    lacherContact();
    if (slot && reveilGarder) { reveilGarder = false; eveiller(goContact); }
    majRefusHoraires();
    rendreFocus(repere);
    // Le toucher retenu part sur le plan qui vient d arriver. Sans creneau,
    // le bouton reste gris et le bloc de la visite dit pourquoi.
    if (retenu && slot && sceneCourante === 'heures') garderHoraires();
  }
  // Les etats d une heure, lus dans la reponse :
  //   ok    : rien a dire ;
  //   soft  : possible, mais la visite finira a la fermeture (avertissement du moteur) ;
  //   shift : chevauche une AUTRE activite posee ; la choisir replace cette autre activite ;
  //   hard  : impossible ce jour-la (complet, ferme, trop tard) : on lit pourquoi,
  //           sans pouvoir la prendre ;
  //   wave  : l heure ou joue le 2e (3e...) groupe d une partie retenue : elle est
  //           deja au client, et la toucher y fait partir cette partie.
  // UN CHEVAUCHEMENT AVEC SOI-MEME N EST PAS UN DECALAGE. Le tunnel le sait
  // depuis le 2026-09-18 (`conflict.activityId !== activity.activityId`) : une
  // autre partie du MEME laser ne se replace pas, c est le groupe lui-meme qui
  // occupe l arene. Ce n est plus un refus non plus (voir verdictDu) : la
  // toucher DEPLACE cette partie-la.
  // LE CALCUL D UN « COMPLET », tel que le moteur l a fait (lib/ops-engine,
  // getFormulaAnchorAvailability). Movsar, 2026-09-30 : « faut montrer ici que
  // 6 joueurs max par piste donc vous avez besoin de x pistes ». Les pistes :
  // joueurs par piste, pistes qu il faut, pistes libres. L arene : ses places
  // libres et celles qu il faut, ou l autre partie deja lancee. Sans ces
  // chiffres, la raison du serveur telle quelle.
  function nombre(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }
  function raisonComplet(t) {
    var quand;
    if (Number(t.lanesNeeded) > 0) {
      var libres = Number(t.lanesFree) || 0;
      quand = t.serviceTime ? ' à ' + t.serviceTime : '';
      return t.playersPerLane + ' joueurs max par piste, il vous faut ' + nombre(Number(t.lanesNeeded), 'piste', 'pistes')
        + (Number(t.serviceCount) > 1 ? ' pour chacun de vos ' + t.serviceCount + ' groupes' : '')
        + ' et ' + (libres === 0 ? 'aucune n’est libre' : libres === 1 ? 'une seule est libre' : libres + ' seulement sont libres') + quand;
    }
    quand = t.waveTime ? ' à ' + t.waveTime : '';
    if (t.arenaBusy) return 'une autre partie de laser est déjà lancée' + (quand || ' à cette heure');
    if (Number(t.placesNeeded) > 0 && Number(t.arenaPlaces) > 0) {
      var places = Number(t.placesFree) || 0;
      return (places === 0 ? 'les ' + t.arenaPlaces + ' places de l’arène sont prises' + quand
        : nombre(places, 'place libre', 'places libres') + ' sur ' + t.arenaPlaces + quand + ', il en faut ' + t.placesNeeded);
    }
    return t.reason || 'Complet';
  }
  // LES CHIFFRES D UN « COMPLET », pour la ligne courte sous les heures
  // (phraseRaison) : les memes que raisonComplet, sans la phrase. L heure ou
  // le manque se produit (le 2e groupe, le 2e service) ne se dit que si
  // elle n est pas l heure elle-meme.
  function chiffresComplet(t) {
    if (Number(t.lanesNeeded) > 0) return { pistes: Number(t.lanesNeeded), libres: Number(t.lanesFree) || 0, groupes: Number(t.serviceCount) || 1, quand: t.serviceTime || '' };
    if (t.arenaBusy) return { lancee: true, quand: t.waveTime || '' };
    if (Number(t.placesNeeded) > 0 && Number(t.arenaPlaces) > 0) return { besoin: Number(t.placesNeeded), places: Number(t.placesFree) || 0, arene: Number(t.arenaPlaces), quand: t.waveTime || '' };
    return null;
  }
  // Les heures d une ligne, en suites : trois demi-heures qui se suivent ou
  // plus se disent « 13:00 à 14:00 », deux « 16:00 et 16:30 ». Jamais une
  // plage qui engloberait une heure libre.
  function plageHeures(liste) {
    var suites = [];
    (liste || []).forEach(function (h) {
      var s = suites[suites.length - 1];
      if (s && minutesDe(h) - minutesDe(s[s.length - 1]) === 30) s.push(h); else suites.push([h]);
    });
    return joindreHeures(suites.map(function (s) { return s.length > 2 ? s[0] + ' à ' + s[s.length - 1] : s.join(suites.length > 1 ? ', ' : ' et '); }));
  }
  var MOTS_DURS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', schedule_free: 'trop tard', resource_conflict: 'complet', business_rules: 'non valable', off_grid: 'hors grille', unknown_anchor: 'indispo', anchor_overlap: 'occupé',
    arrival_full: 'complet', arrival_after_anchor: 'trop tard', arcade_overlap: 'occupé', arcade_before_arrival: 'trop tôt' };
  // L AUTRE QUI BOUGE, et l heure se prend : elle chevauche une autre activite
  // posee, ou se prend avant l arrivee choisie (ou pendant son accueil) et
  // l avance. Le dernier choix gagne (Movsar, 2026-10-13 : « on peut prendre
  // l heure qu on veut, juste si c est vraiment impossible on peut pas »).
  // Une heure posee sur les arcades choisies les decale (arcade_overlap).
  var DECALENT = { anchor_overlap: 1, arrival_before: 1, arrival_welcome: 1, arcade_overlap: 1 };
  // Le mot d un avis : une longue attente, une longue visite (les bornes de
  // l arrivee, qui previennent sans refuser), sinon une fin serree.
  var MOTS_AVIS = { arrival_wait: 'attente', arrival_visit: 'longue' };
  function avisDArrivee(w) { return Boolean(w && MOTS_AVIS[w.code]); }
  function etatHeure(t, idPiste) {
    if (t.ok === false) {
      var autre = DECALENT[t.code] && t.conflict && t.conflict.activityId && t.conflict.activityId !== idPiste;
      if (autre) return { etat: 'shift', mot: 'décale', raison: t.reason || 'Chevauche une autre activité', conflit: t.conflict };
      // Sa propre partie garde son conflit : la phrase dira laquelle, et quand elle joue.
      return { etat: 'hard', mot: MOTS_DURS[t.code] || 'indispo', raison: t.code === 'capacity' ? raisonComplet(t) : (t.reason || 'Indisponible'), conflit: t.code === 'anchor_overlap' ? (t.conflict || null) : null };
    }
    // Une arrivee qui libere des heures posees avant elle : elle se prend, et
    // le serveur les replace apres elle.
    if (t.libere) return { etat: 'shift', mot: 'décale', raison: t.libere.raison, conflit: t.libere };
    if (t.warning) return { etat: 'soft', mot: MOTS_AVIS[t.warning.code] || 'serré', raison: t.warning.reason || 'Peu de temps pour le reste de la visite', conflit: null };
    return { etat: 'ok', mot: '', raison: '', conflit: null };
  }
  function minutesDe(h) { var p = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return p ? Number(p[1]) * 60 + Number(p[2]) : NaN; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function minuscule(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
  function joindreHeures(liste) { return liste.length < 2 ? (liste[0] || '') : liste.slice(0, -1).join(', ') + ' et ' + liste[liste.length - 1]; }
  // LES HEURES QU EMPORTENT LES GROUPES SUIVANTS, lues dans le PLAN rendu par le
  // serveur (jamais recalculees ici) : heure -> { rang, total, joueurs, debut, fin,
  // depuis }, « depuis » etant l heure retenue ou part le 1er groupe de la partie.
  // Une vague couvre chaque demi-heure de la grille qu elle occupe : la 2e vague
  // d un laser (14:00-14:25) emporte 14:00, le 2e service d un bowling
  // (13:30-14:30) emporte 13:30 et 14:00. Le 1er groupe n emporte rien : son
  // heure est celle que le client a choisie.
  // SEULES LES HEURES RETENUES PAR LE CLIENT EMPORTENT (la regle du tunnel,
  // heuresEmporteesParLeLaser). L heure que l equipe PROPOSE n est pas un choix :
  // marquer « groupe 2 » la demi-heure suivante bloquait le client qui voulait
  // justement faire partir son 1er groupe a cette heure-la, ce que la note des
  // groupes lui demande de faire. Meme chose pour une 2e partie que le moteur
  // place seul : ses heures restent a prendre.
  function heuresEmportees(cr, id, retenues) {
    var out = {};
    var blocs = ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || []).filter(function (b) { return b && b.activityId === id; });
    (retenues || []).forEach(function (h) {
      // La partie que lance CETTE heure : celle dont le 1er groupe part a h.
      var tete = blocs.filter(function (b) { return b.startTime === h && Number(b.groupWaveCount) > 1 && (Number(b.groupWaveIndex) || 1) === 1; })[0];
      if (!tete) return;
      var partie = Number(tete.countIndex) || 1;
      blocs.forEach(function (b) {
        if ((Number(b.countIndex) || 1) !== partie || !(Number(b.groupWaveIndex) > 1)) return;
        var debut = minutesDe(b.startTime), fin = minutesDe(b.endTime);
        if (!isFinite(debut) || !isFinite(fin)) return;
        for (var m = Math.floor(debut / 30) * 30; m < fin; m += 30) {
          var quand = hhmm(m);
          if (!out[quand]) out[quand] = { rang: Number(b.groupWaveIndex), total: Number(b.groupWaveCount), joueurs: Number(b.players) || 0, debut: b.startTime, fin: b.endTime, depuis: h };
        }
      });
    });
    return out;
  }
  // LE TOUCHER A LE VERDICT DE CE QU IL FAIT. Une heure qui chevauche l une de
  // SES parties de laser, jugee comme une partie en plus, est refusee ; le
  // toucher, lui, DEPLACE cette partie-la, et le serveur rend le verdict de ce
  // deplacement a cote du refus (`move`, lib/ops-engine.js visitFeasibilityAt),
  // par la meme porte que la reservation. Plus aucun « pris » qui ne se prend
  // pas (Movsar, 2026-09-24 : « c est con, c est mal fait »). Sans `move`, le
  // verdict est celui de l heure : une activite d une seule partie, ou la plus
  // tot des parties quand toutes sont posees, y est deja deplacee par le moteur.
  function verdictDu(t) { return t && t.ok === false && t.move ? t.move : t; }
  // Le rang d une partie de laser posee : l ordre de ses heures, celui ou le
  // serveur numerote les parties.
  function rangPartie(h) { return state.laserParts.indexOf(h) + 1; }
  // La plage REELLE qu occupe une activite du plan, a partir de son depart :
  // toutes ses vagues comprises (un laser de 13:30 en deux groupes occupe
  // 13:30 a 14:25). Sans correspondance dans le plan, rien : la phrase dit
  // alors l heure de depart seule.
  function plageOccupee(cr, id, debut) {
    var blocs = ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || []).filter(function (b) { return b && b.activityId === id; });
    var tete = blocs.filter(function (b) { return b.startTime === debut; })[0];
    if (!tete) return '';
    var partie = Number(tete.countIndex) || 1;
    var fin = blocs.filter(function (b) { return (Number(b.countIndex) || 1) === partie; }).map(function (b) { return String(b.endTime || ''); }).sort().pop();
    return fin ? debut + ' à ' + fin : '';
  }
  function nomBas(s) { return String(s || '').toLowerCase(); }
  // LA PHRASE D UNE RAISON, pour un groupe d heures qui la partagent. Courte
  // (Movsar, 2026-09-24 : « trop long, mal explique » ; 2026-10-12 : « explique
  // brievement et joliment ») : ce qui manque, avec les chiffres du moteur, ou
  // ce que le toucher fera bouger. Le mot de la puce (« complet ») ne se
  // repete pas : l etiquette des heures porte deja son contour. Rien n est
  // invente, tout se retrouve dans la reponse ; la phrase longue reste le
  // titre de la puce.
  function phraseRaison(g, nomPiste) {
    var piste = nomBas(nomPiste || 'activité');
    if (g.etat === 'shift' && g.conflit.id === 'arrivee') {
      // L heure se prend avant l arrivee choisie : l arrivee avance, le plan
      // la conseille alors juste avant cette heure.
      var accueil = Number(arrivees.bornes && arrivees.bornes.welcomeMinutes) || 0;
      return typo('Avance votre arrivée (' + g.conflit.time + ')' + (accueil ? ' : vous arriverez ' + accueil + ' min avant votre ' + piste + '.' : '.'));
    }
    // L arrivee libere des heures posees avant elle (liberePar).
    if (g.etat === 'shift' && (g.piste === 'arrivee' || g.piste === 'arcade_time')) return typo(g.raison);
    // Une heure posee sur les arcades choisies : la frise les replace.
    if (g.etat === 'shift' && g.conflit.id === 'arcade_time') return typo('Vos arcades (' + g.conflit.time + ') se replaceront avant ou après.');
    if (g.etat === 'shift') {
      var plage = g.conflit.id ? plageOccupee(state.creneau, g.conflit.id, g.conflit.time) : '';
      var quand = plage ? ' (' + plage + ')' : ' de ' + g.conflit.time;
      // Une partie de laser parmi d autres posees : elle seule se libere et
      // passe sans heure. Seule posee, le moteur la replace, comme le bowling.
      if (g.conflit.id === 'laser_game' && state.laserParts.length > 1 && rangPartie(g.conflit.time)) {
        return 'Votre partie ' + rangPartie(g.conflit.time) + ' de laser game' + quand + ' passera dans la foulée, sans heure fixe.';
      }
      return 'Votre ' + nomBas(String(g.conflit.label || 'autre activité').replace(/\s*\(partie \d+\)$/, '')) + quand + ' se décalera avant ou après.';
    }
    // UN AVIS DE L ARRIVEE (2026-10-13) : la longue attente ou la longue
    // visite, des heures de la ligne, en fourchette ; pour une arrivee, avec
    // ce qui la fait attendre (`cause` du serveur), pour une activite, depuis
    // l arrivee choisie.
    var avis = g.chiffres;
    if (g.etat === 'soft' && avis && avis.minutes) {
      var court = Math.min.apply(null, g.places), long = Math.max.apply(null, g.places);
      var duree = dureeExacte(court) + (long > court ? ' à ' + dureeExacte(long) : '');
      if (avis.avis === 'arrival_visit') return typo('Possible, la visite dure ' + duree + '.');
      var pourquoi = avis.cause ? (/^avec /i.test(avis.cause) ? ', ' : ' : ') + minuscule(avis.cause)
        : g.piste !== 'arrivee' && state.arrivee ? ' après votre arrivée (' + state.arrivee + ')' : '';
      return typo('Possible, avec ' + duree + ' sans activité' + pourquoi + '.');
    }
    if (g.etat === 'soft') return 'Possible, mais ' + minuscule(g.raison).replace(/\.$/, '') + '.';
    // La raison du serveur finit souvent par un point : la phrase en ajoute un
    // seul (« pour cette formule.. » en prod le 13/10).
    var r = String(g.raison || 'Indisponible').replace(/\.+$/, '');
    var x = g.chiffres, a = g.quand ? ' à ' + g.quand : '';
    if (x && x.pistes) {
      return 'Il faut ' + nombre(x.pistes, 'piste', 'pistes') + (x.groupes > 1 ? ' pour chacun de vos ' + x.groupes + ' groupes' : '')
        + ' : ' + (x.libres === 0 ? 'aucune n’est libre' : x.libres === 1 ? 'une seule est libre' : x.libres + ' seulement sont libres') + a + '.';
    }
    if (x && x.lancee) return 'Une autre partie de laser est déjà lancée' + a + '.';
    if (x && x.besoin) {
      var bas = Math.min.apply(null, g.places), haut = Math.max.apply(null, g.places);
      if (haut === 0) return 'Les ' + x.arene + ' places de l’arène sont prises' + a + '.';
      // Comme le bowling : ce qu il faut, puis ce qui est libre. La taille de
      // l arene se lit deja dans la note du partage, juste dessous.
      var libres = bas === haut ? (haut === 1 ? 'une seule est libre' : haut + ' sont libres')
        : bas === 0 ? (haut === 1 ? 'au plus une est libre' : 'au plus ' + haut + ' sont libres')
        : bas + (haut === bas + 1 ? ' ou ' : ' à ') + haut + ' sont libres';
      return 'Il faut ' + nombre(x.besoin, 'place', 'places') + ' : ' + libres + a + '.';
    }
    switch (g.code) {
      case 'arrival_full':
        return 'Complet pour la suite de la journée.';
      case 'capacity':
      case 'resource_conflict':
        return r && r !== 'Complet' ? r.charAt(0).toUpperCase() + r.slice(1) + '.' : 'Complet pour votre groupe.';
      case 'schedule':
        var fin = /^fin apr[eè]s (.+)$/i.exec(r);
        return fin ? 'Finirait après ' + fin[1] + '.' : 'Trop tard : ' + minuscule(r) + '.';
      case 'schedule_free':
        return 'Trop tard pour tout faire : ' + minuscule(r) + '.';
      case 'blocked':
        return r === 'Indisponible' ? 'Fermé à cette heure.' : 'Fermé : ' + minuscule(r) + '.';
      case 'anchor_overlap':
        // SA PROPRE PARTIE, que rien ne deplace ici : laquelle, et quand elle joue.
        if (!g.conflit.time) return 'Votre autre partie de ' + piste + ' joue à cette heure.';
        var k = rangPartie(g.conflit.time);
        var sienne = plageOccupee(state.creneau, g.conflit.id || '', g.conflit.time);
        return 'Votre partie' + (k ? ' ' + k : '') + ' de ' + piste + ' joue ' + (sienne ? 'de ' + sienne : 'à ' + g.conflit.time) + '.';
      // Une arrivee apres une activite deja posee : la phrase du serveur.
      case 'arrival_after_anchor':
        return typo(r.charAt(0).toUpperCase() + r.slice(1).replace(/\.$/, '') + '.');
      default:
        return r.charAt(0).toUpperCase() + r.slice(1) + '.';
    }
  }
  function periode(h) { var n = Number(String(h).split(':')[0]); return n < 12 ? 'Matin' : n < 18 ? 'Après-midi' : 'Soirée'; }
  var ICONES_PERIODE = { 'Matin': 'i-matin', 'Après-midi': 'i-jour', 'Soirée': 'i-soir' };
  // Les heures d une piste, par periode (matin, apres-midi, soiree) : chaque
  // periode est un menu depliant avec son resume (heure choisie ou proposee,
  // nombre de creneaux). Les puces d une periode fermee restent dans le DOM :
  // elles se mettent a jour sur place comme les autres.
  function rendreChips(times, multi, idPiste) {
    var groupes = {}, ordre = [];
    times.forEach(function (t) { var p = periode(t.time); if (!groupes[p]) { groupes[p] = []; ordre.push(p); } groupes[p].push(t); });
    var html = '<div class="fg-periods">';
    ordre.forEach(function (p, j) {
      var id = 'per-' + String(idPiste || 'slot').replace(/[^a-z0-9_-]/gi, '') + '-' + j;
      html += '<section class="fg-period" data-period="' + esc(p) + '">'
        + '<button type="button" class="fg-period__btn" aria-expanded="false" aria-controls="' + id + '">'
        + '<svg class="fg-period__icon" aria-hidden="true"><use href="#' + (ICONES_PERIODE[p] || 'i-clock') + '"/></svg>'
        + '<span class="fg-period__name">' + esc(p) + '</span>'
        + '<span class="fg-period__keys" aria-hidden="true"></span>'
        + '<span class="fg-period__sum"></span><span class="sr-only fg-period__dit"></span>'
        + '<svg class="fg-period__chev" aria-hidden="true"><use href="#i-chevron"/></svg>'
        + '</button>'
        + '<div class="fg-period__body" id="' + id + '"><div class="fg-period__inner"><ul class="fg-chips" role="listbox" aria-label="' + esc(p) + '"' + (multi ? ' aria-multiselectable="true"' : '') + '>';
      groupes[p].forEach(function (t, k) {
        html += '<li role="presentation"><button type="button" class="fg-chip" role="option" data-time="' + esc(t.time) + '" style="--i:' + k + '"><b>' + esc(t.time) + '</b><small></small></button></li>';
      });
      html += '</ul><ul class="fg-why-list" hidden></ul></div></div></section>';
    });
    return html + '</div>';
  }
  function basculerPeriode(sec, ouvrir) {
    if (!sec || sec.classList.contains('is-open') === ouvrir) return;
    var btn = $('.fg-period__btn', sec);
    sec.classList.toggle('is-open', ouvrir);
    if (btn) btn.setAttribute('aria-expanded', String(ouvrir));
    var ul = $('.fg-chips', sec);
    if (ouvrir && ul) relancer(ul, 'is-fresh');
  }
  // Un seul menu ouvert par piste : ouvrir une periode referme les autres.
  function montrerPeriode(track, sec) {
    $$('.fg-period', track).forEach(function (x) { basculerPeriode(x, x === sec); });
  }
  // Le resume de chaque periode, et le menu ouvert : tant que le client n a
  // pas touche aux menus de la piste, c est celui de l heure choisie, sinon
  // proposee, sinon la premiere periode possible. Quand une pose deplace la
  // proposition de l autre piste (bowling pose le soir : le laser passe le
  // soir), son menu la suit. Des que le client ouvre ou ferme un menu, la
  // piste est a lui : plus rien ne s ouvre ni ne se ferme tout seul.
  function majPeriodes(track) {
    var secs = $$('.fg-period', track);
    var utile = null;
    secs.forEach(function (sec) {
      var chips = $$('.fg-chip', sec);
      var n = chips.filter(function (c) { return c.dataset.ok !== 'false'; }).length;
      var choisis = chips.filter(function (c) { return c.classList.contains('is-on'); }).map(function (c) { return c.dataset.time; });
      var propose = chips.filter(function (c) { return c.classList.contains('is-proposed'); }).map(function (c) { return c.dataset.time; })[0];
      // L heure d un groupe suivant qui tombe dans une AUTRE plage que celle
      // de son depart : la plage reste repliee, son menu le dit (vu en prod
      // le 2026-09-23 : 11:30 retenue au laser, le 2e groupe a 12:00 dans
      // l apres-midi, invisible).
      var vagues = chips.filter(function (c) { return c.classList.contains('is-wave') && c.dataset.wave; }).map(function (c) { return (c.dataset.mot || $('small', c).textContent) + ' à ' + c.dataset.time; });
      var sum = n > 1 ? n + ' au choix' : n === 1 ? 'une seule possible' : 'rien de possible';
      if (choisis.length) sum = 'choisi ' + choisis.join(' et ') + ' · ' + sum;
      else if (vagues.length) sum = vagues.join(', ') + ' · ' + sum;
      else if (propose) sum = 'proposé ' + propose + ' · ' + sum;
      $('.fg-period__sum', sec).textContent = sum;
      rendreCles(sec, chips, n);
      sec.classList.toggle('is-picked', choisis.length > 0);
      sec.classList.toggle('is-empty', n === 0);
      if (!utile && (choisis.length || propose)) utile = sec;
    });
    // L heure retenue ou proposee CHANGE DE PLAGE sans que le client touche
    // cette piste (le bowling part a 23:00, le moteur replace le laser a
    // 22:30) : sa plage s ouvre, meme si le client avait feuillete ses onglets
    // avant. Le laser restait sur « Après-midi », son heure en soiree
    // (2026-10-12).
    var plageUtile = utile ? String(secs.indexOf(utile)) : '';
    if (plageUtile && track.dataset.plageUtile && track.dataset.plageUtile !== plageUtile) delete track.dataset.touched;
    if (plageUtile) track.dataset.plageUtile = plageUtile;
    if (secs.length && !track.dataset.touched) {
      montrerPeriode(track, utile || secs.filter(function (x) { return !x.classList.contains('is-empty'); })[0] || secs[0]);
    }
  }
  // CE QUE CACHE UNE PLAGE REPLIEE (Movsar, 2026-09-28 : « quand on est dans
  // les horaires matin ou apres-midi on a pas les infos genre decale, serre et
  // tout, y a que sur soiree »). Les mots sont sur les puces, et les puces
  // d une plage repliee ne se voient pas : son en-tete porte les memes mots,
  // dans le meme contour que la legende, et « rien ne coince » quand toutes
  // ses heures se prennent sans rien bousculer. L heure choisie ou proposee
  // ne compte pas (c est un choix, pas un obstacle), ni celles de ses propres
  // parties. Le lecteur d ecran entend la phrase entiere, comptes compris.
  function rendreCles(sec, chips, n) {
    var zone = $('.fg-period__keys', sec), dit = $('.fg-period__dit', sec);
    if (!zone || !dit) return;
    var autres = chips.filter(function (c) { return !c.classList.contains('is-on') && !c.classList.contains('is-proposed') && c.dataset.state !== 'wave'; });
    var par = function (etat) { return autres.filter(function (c) { return c.dataset.state === etat; }); };
    var uniques = function (liste) { return liste.filter(function (x, k) { return x && liste.indexOf(x) === k; }); };
    var decale = par('shift'), serre = par('soft'), dur = par('hard');
    var cles = [], phrases = [];
    if (decale.length) {
      var cibles = uniques(decale.map(function (c) { return c.dataset.conflictLabel || ''; }));
      var ids = uniques(decale.map(function (c) { return c.dataset.conflict || ''; }));
      cles.push(['shift', 'décale']);
      phrases.push(decale.length + (decale.length > 1 ? ' décalent ' : ' décale ') + (ids.length === 1 && ids[0] === 'arcade_time' ? 'vos arcades' : cibles.length === 1 ? 'votre ' + minuscule(cibles[0]) : 'une autre activité'));
    }
    if (serre.length) {
      // Le mot de l avis, celui des puces : « attente » depuis l arrivee,
      // sinon « serré ».
      var motsAvis = uniques(serre.map(function (c) { return String(c.dataset.mot || '').trim(); }));
      var motAvis = motsAvis.length === 1 ? motsAvis[0] : 'serré';
      cles.push(['soft', motAvis]);
      phrases.push(serre.length + (motAvis === 'attente' ? ' avec de l’attente' : motAvis === 'longue' ? (serre.length > 1 ? ' longues' : ' longue') : serre.length > 1 ? ' serrées' : ' serrée'));
    }
    if (dur.length) {
      var mots = uniques(dur.map(function (c) { return String(c.dataset.mot || '').trim(); }));
      cles.push(['hard', mots.length === 1 ? mots[0] : 'indispo']);
      phrases.push(dur.length + ' impossible' + (dur.length > 1 ? 's' : ''));
    }
    if (!cles.length && n > 0) cles.push(['ok', 'rien ne coince']);
    zone.innerHTML = cles.map(function (k) { return '<i class="fg-key fg-key--' + k[0] + '">' + esc(k[1]) + '</i>'; }).join('');
    dit.textContent = phrases.length ? ' : ' + joindreListe(phrases, ', ') + '.' : (n > 0 ? ' : rien ne coince.' : '');
  }
  // La mise a jour d une puce SUR PLACE : etat, raison, choix, proposition.
  // Rien n est reconstruit, rien ne saute : c est ce qui evite le tremblement
  // a chaque heure posee.
  function majChip(chip, t, actifs, propose, toutSerre, idPiste, emportees, compte) {
    var multi = idPiste === 'laser_game' && compte > 1;
    var v = verdictDu(t);
    var e = etatHeure(v, idPiste || '');
    // Quand TOUTES les heures possibles de la piste sont serrees, le mot ne
    // dit plus rien sur l heure : la cause est ailleurs (une autre activite
    // posee tard, ou une journee trop courte). Les puces restent normales,
    // la piste porte une seule note, et la raison reste au survol. Une attente
    // depuis l arrivee, elle, depend de l heure : elle se dit.
    if (toutSerre && e.etat === 'soft' && !avisDArrivee(v.warning)) { e.etat = 'ok'; e.mot = ''; }
    var on = actifs.indexOf(t.time) >= 0;
    var prop = !on && propose === t.time;
    // La partie que le toucher deplace (verdict `move`), s il en deplace une.
    var deplace = t.ok === false && t.move ? String(t.move.replaces || '') : '';
    // Un refus « a soi » sans verdict de deplacement : l heure d une de SES
    // parties, dite comme telle, jamais « pris ».
    if (e.etat === 'hard' && e.conflit && e.conflit.activityId === idPiste && multi && rangPartie(e.conflit.time)) { e.mot = 'partie ' + rangPartie(e.conflit.time); e.nom = true; }
    var titre = e.raison;
    // L HEURE D UN GROUPE SUIVANT d une partie retenue : elle est au client,
    // marquee a son nom (« partie 1 », ou « 2e groupe » pour une activite d une
    // seule partie), et elle SE CHOISIT (Movsar, 2026-09-23) : la toucher y
    // fait partir cette partie, selon le verdict du serveur sur ce depart.
    var vague = !on && emportees ? emportees[t.time] : null;
    if (vague) {
      var sous = e.etat;
      var rang = multi ? rangPartie(vague.depuis) : 0;
      var plage = plageOccupee(state.creneau, idPiste, vague.depuis);
      var motif = sous === 'ok' ? '' : (e.conflit && e.conflit.activityId === idPiste && rangPartie(e.conflit.time)
        ? 'elle chevaucherait votre partie ' + rangPartie(e.conflit.time) + ' (' + e.conflit.time + ')' : minuscule(e.raison));
      titre = multi
        ? 'Votre partie ' + rang + ' joue ' + (plage ? 'de ' + plage : 'à ' + vague.depuis) + ' (' + vague.rang + 'e groupe à ' + t.time + ').'
          + (sous === 'hard' ? ' La faire partir à ' + t.time + ' est impossible : ' + motif + '.' : ' La toucher la fait partir à ' + t.time + (sous === 'ok' ? '.' : ' : ' + motif + '.'))
        : 'Votre ' + vague.rang + 'e groupe (' + vague.joueurs + ' joueurs) joue de ' + vague.debut + ' à ' + vague.fin + ', juste après le premier.'
          + (sous === 'hard' ? ' Y faire partir le 1er groupe est impossible : ' + motif + '.' : ' La choisir y fait partir votre 1er groupe' + (sous === 'ok' ? '.' : ' : ' + motif + '.'));
      e = { etat: 'wave', sous: sous, motif: sous === 'ok' ? '' : e.raison, mot: multi ? 'partie ' + rang : vague.rang + 'e groupe', conflit: sous === 'shift' ? e.conflit : null, raison: titre };
    } else if (deplace) {
      var r = rangPartie(deplace);
      var qui = 'votre partie' + (r ? ' ' + r : '') + ' (' + deplace + ')';
      titre = e.etat === 'hard' ? 'Déplacer ' + qui + ' à ' + t.time + ' est impossible : ' + minuscule(e.raison) + '.'
        : 'Déplace ' + qui + ' à ' + t.time + (e.etat === 'ok' ? '.' : ' : ' + minuscule(e.raison) + '.');
    }
    chip.dataset.state = e.etat;
    chip.dataset.reason = e.raison;
    chip.dataset.ok = e.etat === 'hard' || e.sous === 'hard' ? 'false' : 'true';
    // Ce qu il faut pour ecrire la phrase de la plage, sans rien relire ailleurs.
    chip.dataset.code = v.ok === false && e.etat !== 'wave' ? String(v.code || '') : '';
    // L AVIS D UNE BORNE DE L ARRIVEE (2026-10-13) porte ses minutes : la ligne
    // les dit en fourchette. Sa cause ne se dit que pour une arrivee : pour une
    // activite, c est cette heure-la qui fait attendre.
    var avis = e.etat === 'soft' && avisDArrivee(v.warning)
      ? Number(v.warning.code === 'arrival_wait' ? v.warning.waitMinutes : v.warning.visitMinutes) || 0 : 0;
    var chiffres = e.etat === 'hard' && v.ok === false && v.code === 'capacity' ? chiffresComplet(v)
      : avis > 0 ? { minutes: avis, avis: v.warning.code, cause: idPiste === 'arrivee' ? String(v.warning.cause || '') : '' } : null;
    if (chiffres) chip.dataset.court = JSON.stringify(chiffres); else delete chip.dataset.court;
    if (deplace) chip.dataset.replaces = deplace; else delete chip.dataset.replaces;
    if (e.etat === 'wave') { chip.dataset.sous = e.sous; chip.dataset.motif = e.motif; } else { delete chip.dataset.sous; delete chip.dataset.motif; }
    if (e.etat === 'wave' && multi) chip.dataset.partie = String(rangPartie(vague.depuis)); else delete chip.dataset.partie;
    if (e.conflit) { chip.dataset.conflict = e.conflit.activityId || ''; chip.dataset.conflictLabel = e.conflit.label || ''; chip.dataset.conflictTime = e.conflit.time || ''; }
    else { delete chip.dataset.conflict; delete chip.dataset.conflictLabel; delete chip.dataset.conflictTime; }
    if (vague) chip.dataset.wave = JSON.stringify(vague); else delete chip.dataset.wave;
    chip.classList.toggle('is-on', on);
    chip.classList.toggle('is-proposed', prop);
    chip.classList.toggle('is-soft', e.etat === 'soft');
    chip.classList.toggle('is-shift', e.etat === 'shift');
    chip.classList.toggle('is-off', e.etat === 'hard');
    chip.classList.toggle('is-wave', e.etat === 'wave');
    chip.setAttribute('aria-selected', String(on));
    chip.setAttribute('title', e.etat === 'ok' && prop ? 'Heure proposée pour votre visite' : titre);
    var mot = on ? (multi ? 'partie ' + rangPartie(t.time) : 'choisi') : (prop ? 'proposé' : e.mot);
    chip.dataset.mot = mot;
    // LE MOT D UN PROBLEME NE S ECRIT PLUS SOUS L HEURE (Movsar, 2026-10-13 :
    // « pas de mot décale mais [...] entouré en pointillé ») : serree, decalee
    // ou impossible, l heure garde son mot pour les en-tetes et les lecteurs
    // d ecran, et sa ligne d explication le dit sous la grille. Seuls
    // « choisi », « proposé » et le nom d une partie s ecrivent.
    $('small', chip).textContent = on || prop || e.etat === 'wave' || e.nom ? mot : '';
    if (on || prop || !/^(soft|shift|hard)$/.test(e.etat)) delete chip.dataset.teinte;
  }
  // LES RAISONS D UNE PLAGE, SOUS SES HEURES. Une ligne par raison, avec toutes
  // les heures qui la partagent ; rien pour une plage ou tout est prenable. La
  // puce retenue ou proposee ne s explique pas : c est un choix, pas un
  // obstacle.
  // Chaque heure expliquee POINTE sa ligne (aria-describedby) : un lecteur
  // d ecran lit la raison en arrivant sur l heure.
  // UNE TEINTE PAR PROBLEME (Movsar, 2026-10-13 : « expliqué super proprement
  // en bas avec couleur différente par problème pour pas avoir la même
  // chose ») : chaque ligne d une plage a la sienne, et les heures qu elle
  // explique ont un contour en tirets de cette teinte (data-teinte).
  var TEINTES = 4;
  function teinteDe(k) { return String(k % TEINTES); }
  function expliquerPeriode(sec, nomPiste) {
    var liste = $('.fg-why-list', sec);
    if (!liste) return;
    var racine = ($('.fg-period__body', sec) || {}).id || 'per';
    var idPiste = ((sec.closest('.fg-track') || {}).dataset || {}).activity || '';
    var groupes = [], index = {};
    $$('.fg-chip', sec).forEach(function (c) {
      c.removeAttribute('aria-describedby');
      delete c.dataset.teinte;
      var etat = c.dataset.state;
      // L heure d une de SES parties ne s explique pas ici : son nom est sur
      // la puce (« partie 1 », « 2e groupe »), sa plage dans le cadre des
      // parties ou la note des groupes.
      if (!etat || etat === 'ok' || etat === 'wave' || c.classList.contains('is-on') || c.classList.contains('is-proposed')) return;
      // Les heures qui manquent de la MEME chose (les memes pistes, le meme
      // nombre de places) partagent une ligne ; les places libres de chacune
      // se disent en fourchette (« 8 à 9 sont libres »).
      var chiffres = null;
      try { chiffres = c.dataset.court ? JSON.parse(c.dataset.court) : null; } catch (err) { chiffres = null; }
      var quand = chiffres && chiffres.quand && chiffres.quand !== c.dataset.time ? chiffres.quand : '';
      var cause = !chiffres ? '' : chiffres.pistes ? 'pistes:' + chiffres.pistes + ':' + chiffres.libres + ':' + chiffres.groupes + '@' + quand : chiffres.besoin ? 'places:' + chiffres.besoin + ':' + chiffres.arene + '@' + quand : chiffres.minutes ? 'minutes:' + (chiffres.avis || '') + ':' + (chiffres.cause || '') : 'lancee@' + quand;
      // Ce qui decale se groupe par ce qui bouge (l heure avant l arrivee et
      // celle de son accueil l avancent pareil).
      var cle = etat + '|' + (etat === 'shift' ? '' : c.dataset.code || '') + '|' + (c.dataset.conflictLabel || '') + '@' + (c.dataset.conflictTime || '') + '|' + (cause || (etat === 'shift' ? '' : c.dataset.reason || ''));
      if (!index[cle]) {
        index[cle] = {
          etat: etat, code: c.dataset.code || '', raison: c.dataset.reason || '', mot: c.dataset.mot || '',
          conflit: { id: c.dataset.conflict || '', label: c.dataset.conflictLabel || '', time: c.dataset.conflictTime || '' }, heures: [], puces: [],
          chiffres: chiffres, quand: quand, places: [], piste: idPiste,
        };
        groupes.push(index[cle]);
      }
      index[cle].heures.push(c.dataset.time);
      index[cle].puces.push(c);
      if (chiffres && (chiffres.besoin || chiffres.minutes)) index[cle].places.push(chiffres.besoin ? chiffres.places : chiffres.minutes);
    });
    liste.innerHTML = groupes.map(function (g, k) {
      return '<li class="fg-why-list__item" id="' + esc(racine) + '-why-' + k + '" data-etat="' + esc(g.etat) + '" data-teinte="' + teinteDe(k) + '" data-heures="' + esc(g.heures.join(' ')) + '">'
        + '<i class="fg-key fg-key--' + esc(g.etat) + '">' + esc(g.mot) + '</i>'
        + '<b class="fg-why-list__quand">' + esc(plageHeures(g.heures)) + '</b> <span>' + esc(phraseRaison(g, nomPiste)) + '</span></li>';
    }).join('');
    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.setAttribute('aria-describedby', racine + '-why-' + k); }); });
    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.dataset.teinte = teinteDe(k); }); });
    liste.hidden = !groupes.length;
  }
  function vaguesPour(cr, id) {
    var blocs = ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || [])
      .filter(function (b) { return b && b.activityId === id && Number(b.groupWaveCount) > 1; });
    if (!blocs.length) return null;
    var total = 0, tailles = {};
    blocs.forEach(function (b) {
      total = Math.max(total, Number(b.groupWaveCount) || 0);
      var i = Number(b.groupWaveIndex) || 1;
      if (!tailles[i]) tailles[i] = Number(b.players) || 0;
    });
    var liste = [];
    for (var i = 1; i <= total; i += 1) if (tailles[i]) liste.push(tailles[i]);
    return { total: total, tailles: liste };
  }
  // Les tailles des groupes, « de 20 » quand elles sont egales, sinon
  // « (24 + 25) » : le meme mot sur la piste, dans la visite et au recapitulatif.
  function taillesGroupes(tailles) {
    return tailles.every(function (x) { return x === tailles[0]; }) ? 'de ' + tailles[0] : '(' + tailles.join(' + ') + ')';
  }
  // LE GROUPE SCINDE, EN UNE PHRASE (Movsar, 2026-09-24 : les groupes, « trop
  // long, mal explique »). Combien de groupes et leur taille, lues dans le
  // plan ; l heure de chacun se lit sur les heures (« partie 1 », « 2e
  // groupe ») et dans le bloc de la visite.
  function noteVagues(v, multi) {
    if (!v || !(v.total > 1)) return '';
    var tailles = v.tailles.length === v.total ? ' ' + taillesGroupes(v.tailles) : '';
    return esc(personnes(state.pax)) + ', trop pour jouer tous ensemble : ' + (multi ? 'chaque partie se joue en ' : '')
      + '<b>' + v.total + ' groupes' + esc(tailles) + '</b>, l’un après l’autre.';
  }
  function actifsDe(a) {
    var laser = a.activityId === 'laser_game';
    return laser && state.laserParts.length ? state.laserParts : (state.pins[a.activityId] ? [state.pins[a.activityId]] : []);
  }
  // LES PARTIES DE LASER, UNE PAR UNE (Movsar, 2026-09-24 : « faut que ca
  // montre qu ils ont selectionne x heures sur x parties »). Chaque partie a
  // sa ligne au programme (etapesDe) : son heure, ou « sur place » quand
  // aucune heure ne la pose (le moteur la laisse alors a l equipe,
  // lib/ops-engine.js). Sans heure choisie, celle que l equipe propose.
  function debutsDesParties(cr, id) {
    var parParties = {};
    ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || []).forEach(function (b) {
      if (!b || b.activityId !== id || !b.startTime) return;
      var k = Number(b.countIndex) || 1;
      if (!parParties[k] || String(b.startTime) < parParties[k]) parParties[k] = String(b.startTime);
    });
    return Object.keys(parParties).map(function (k) { return parParties[k]; }).sort();
  }
  function majPistes(d) {
    var ancres = (d.anchors && d.anchors.activities) || [];
    var defauts = (d.anchors && d.anchors.defaultTimes) || {};
    // Ce qui saute ne se nomme qu UNE fois, sous la derniere piste serree (la
    // plus proche de « Votre visite ») : deux pistes serrees le disaient deux
    // fois, et l ecran des heures a deja trop de texte sur telephone.
    var dernierSerre = '';
    // « Serré » parle de la fin de la visite : une attente depuis l arrivee
    // n en est pas un (elle se dit sur ses heures).
    var serree = function (v) { return v.warning && !avisDArrivee(v.warning); };
    ancres.forEach(function (a) {
      var p = (a.times || []).map(verdictDu).filter(function (v) { return v.ok !== false; });
      if (p.length > 0 && p.every(serree)) dernierSerre = a.activityId;
    });
    ancres.forEach(function (a) {
      var track = $('.fg-track[data-activity="' + a.activityId + '"]', hourZone);
      if (!track) return;
      var actifs = actifsDe(a);
      var propose = actifs.length ? '' : (defauts[a.activityId] || '');
      // Ce qui se PREND, deplacements compris : leur verdict est le leur.
      var possibles = (a.times || []).map(verdictDu).filter(function (v) { return v.ok !== false; });
      var toutSerre = possibles.length > 0 && possibles.every(serree);
      var emportees = heuresEmportees(state.creneau, a.activityId, actifs);
      var compte = Math.max(1, Number(a.count) || 1);
      var multi = a.activityId === 'laser_game' && compte > 1;
      (a.times || []).forEach(function (t) {
        var chip = $('.fg-chip[data-time="' + t.time + '"]', track);
        if (chip) majChip(chip, t, actifs, propose, toutSerre, a.activityId, emportees, compte);
      });
      $$('.fg-period', track).forEach(function (sec) { expliquerPeriode(sec, a.label || a.activityId); });
      var note = $('.fg-track__note', track);
      if (note) {
        var autres = ancres.filter(function (b) { return b.activityId !== a.activityId && actifsDe(b).length; })
          .map(function (b) { return (b.label || b.activityId) + ' à ' + actifsDe(b).join(' et '); });
        // Ce qui saute avec la combinaison retenue se nomme ici aussi, la ou
        // le client choisit son heure (sans duree : le detail est plus bas).
        var retenu = state.creneau && state.creneau.slot;
        var sautent = horsDelaiDu(retenu);
        var finRetenue = retenu && retenu.visitEndTime;
        var quoi = a.activityId === dernierSerre && sautent.length && finRetenue ? phraseHorsDelai(sautent, finRetenue, false) : null;
        var suiteNote = quoi ? quoi.tete + ' : ' + quoi.noms + '.' : sautent.length ? '' : 'Tout ne tiendra pas avant la fermeture' + (autres.length ? '.' : ' ce jour-là.');
        var serre = !toutSerre ? '' : ((autres.length
          ? 'Serré à toute heure avec votre ' + autres.join(' et votre ') + '.'
          : 'Serré à toute heure.') + (suiteNote ? ' ' + suiteNote : ''));
        // L heure posee devenue passee (retiree par le serveur) : dite ici
        // tant que le client n en a pas choisi une autre.
        var passees = state.heuresPassees[a.activityId] || [];
        var passe = !passees.length ? '' : passees.length > 1
          ? 'Les heures de ' + joindreListe(passees, ' et ') + ' sont passées : choisissez-en d’autres.'
          : 'L’heure de ' + passees[0] + ' est passée : choisissez-en une autre.';
        note.textContent = [passe, serre].filter(Boolean).join(' ');
        note.hidden = !(passe || serre);
      }
      var vagues = $('.fg-track__waves', track);
      if (vagues) {
        var v = vaguesPour(state.creneau, a.activityId);
        vagues.innerHTML = v ? noteVagues(v, multi) : '';
        vagues.hidden = !v;
      }
      var reset = $('[data-reset]', track);
      if (reset) reset.hidden = !actifs.length;
      majPeriodes(track);
    });
  }
  // Le devis du créneau fait foi : la répartition de secours dépend des
  // pistes réellement disponibles, jamais du seul effectif du groupe.
  function creneauAvecDevis(slot, rep) {
    var devis = Object.assign({}, rep);
    ['price', 'program', 'laneCount', 'duration', 'totalDuration'].forEach(function (cle) { if (slot[cle] != null) devis[cle] = slot[cle]; });
    return { slot: slot, reponse: devis };
  }
  function actualiserDevis(x, conserverBlocage) {
    if (!state.creneau || x.price == null) return;
    if (!conserverBlocage) libererBlocage();
    var cr = state.creneau, slot = Object.assign({}, cr.slot);
    if (x.program) { delete slot.bowlingCapacity; delete slot.emergencyWarning; }
    ['price', 'program', 'laneCount', 'bowlingCapacity', 'emergencyWarning', 'opsPlan'].forEach(function (cle) { if (x[cle] != null) slot[cle] = x[cle]; });
    state.creneau = creneauAvecDevis(slot, cr.reponse);
    ((x.program && x.program.items) || []).forEach(function (it) {
      if (!it.arcadeOffer || it.activityId !== 'arcade_time') return;
      var opt = state.options[it.activityId] || {}, ar = reglageArcade(activite(it.activityId));
      if (ar && ar.mode === it.arcadeOffer.mode && ar.offer.id === it.arcadeOffer.id) opt.arcadeSnapshot = Object.assign({}, it.arcadeOffer);
      state.options[it.activityId] = opt;
      var item = $('[data-activity="arcade_time"].fg-grid__item', gridAct), a = activite(it.activityId);
      if (item) { $('.fg-card__opt', tiroirActivite(item)).outerHTML = rendreOption(a); majPastilles(item, a); majPrixCarte(item, a, false); }
    });
  }
  function avertissementBowling(cr) {
    var source = cr && cr.slot ? cr.slot : cr || {};
    if (source.emergencyWarning) return source.emergencyWarning;
    var items = (source.program && source.program.items) || (cr && cr.reponse && cr.reponse.program && cr.reponse.program.items) || [];
    var ligne = items.filter(function (it) { return it.activityId === 'bowling'; })[0] || {};
    var c = source.bowlingCapacity || ligne.bowlingCapacity;
    if (!c || !c.emergency) return '';
    return 'Répartition selon les pistes disponibles : ' + (c.lanePlayers || []).join(' + ') + ' joueurs, jusqu’à ' + c.emergencyCapacityPerLane
      + ' par piste. Comptez environ ' + c.estimatedMinutes + ' min pour une partie complète (environ 10 min par joueur).'
      + (c.speedWarning ? ' La durée choisie demande un rythme soutenu ; finir la partie n’est pas garanti.' : '');
  }
  // LA GRILLE DES ACTIVITES D UNE FORMULE, heure d arrivee choisie comprise :
  // la reponse d une arrivee la porte, jugee avec elle (2026-10-13) ; quand
  // son calcul echoue au serveur, celle de la derniere demande sans arrivee
  // donne ses lignes au programme.
  function ancrage(d) {
    return (d && d.anchors) || (state.arrivee && grilleSansArrivee && grilleSansArrivee.cle === cleDemande() && grilleSansArrivee.anchors) || {};
  }
  // LA FORMULE PAR HEURE D ARRIVEE EST PROPOSEE (2026-10-13) a une formule qui
  // a une activite a heure fixe, quand le centre la propose : son reglage dans
  // la meta, puis le serveur, qui a le dernier mot (arrivalBounds). Sans
  // reglage dans la meta (un serveur d avant), elle ne l est pas.
  function arriveeProposee(ancres) {
    var v = meta && meta.center && meta.center.formulaVisit;
    var b = (arrivees.cle === cleDemande() && arrivees.bornes) || null;
    return state.onglet === 'formules' && ancres.length > 0 && Boolean(v && v.arrivalFirst === true) && !(b && b.arrivalFirst === false);
  }
  function signatureDe(d) {
    var ancres = ancrage(d).activities || [];
    if (ancres.length) return ancres.map(function (a) { return a.activityId + ':' + (a.times || []).map(function (t) { return t.time; }).join(','); }).join('|');
    return 'slots:' + (d.slots || []).map(function (s) { return s.time; }).join(',');
  }
  function rendreHeures() {
    var d = state.dispo;
    var ancres = ancrage(d).activities || [];
    var avecArrivee = arriveeProposee(ancres);
    var signature = signatureDe(d) + '|' + JSON.stringify(state.creneau && [state.creneau.slot.laneCount, state.creneau.slot.bowlingCapacity, state.creneau.reponse.price]) + (avecArrivee ? '|arrivee' : '') + (aDesArcades(d) ? '|arcades' : '');
    if (signature === signaturePistes && $('.fg-track', hourZone)) {
      majPistes(d);
      if (ancres.length) majEtapes(d);
      rendreArrivees();
      rendreArcades();
      rendreVisite();
      posterHauteur();
      return;
    }
    var html = '';
    // LA PARTIE DE LASER SE PARTAGE (Movsar, 2026-09-30 : « preciser pour
    // lasergame que c est susceptible d avoir d autres gens avec eux »). Vrai
    // des qu une partie du groupe laisse une place dans l arene ; un groupe qui
    // remplit exactement ses parties (30, 60...) joue entre lui, et la phrase
    // se tait. Le nombre de places est celui que le centre declare.
    function notePartage() {
      var places = Number(meta && meta.center && meta.center.booking && meta.center.booking.laserArenaCapacity) || 0;
      var n = state.onglet === 'formules' ? joueursDemandes() : joueursDe(activite('laser_game'));
      var partage = !(places && n % places === 0);
      var duree = phraseLaser();
      if (!partage && !duree) return '';
      return '<p class="fg-track__share"><svg aria-hidden="true"><use href="#i-info"/></svg><span>'
        + (duree ? esc(duree) + (partage ? ' ' : '') : '')
        + (!partage ? '' : '<b>Partie partagée</b>' + (places ? ' (jusqu’à ' + places + ' joueurs)' : '') + ' : d’autres groupes peuvent jouer avec vous.')
        + '</span></p>';
    }
    // LES PISTES DU BOWLING, la ou se choisit l heure : combien, pourquoi, et
    // ce que ca coute (le prix d une piste fois les pistes).
    function notePistes() {
      var a = activite('bowling'), p = pistesBowling();
      if (!a || !p) return '';
      var opt = optionChoisie(a), prix = opt ? Number(opt.prix) || 0 : 0;
      return '<p class="fg-track__lanes"><svg aria-hidden="true"><use href="#i-info"/></svg><span>'
        // Le calcul se lit d un bloc : sur un ecran etroit, il passe entier a
        // la ligne apres les deux-points, au lieu de pendre un « × ».
        + '<b>' + p.parPiste + '\u00a0joueurs par piste</b>\u00a0: <span class="fg-calcul">' + typo(p.joueurs + ' joueurs = ' + p.pistes + ' piste' + (p.pistes > 1 ? 's' : ''))
        + (prix ? ' ×\u00a0' + esc(typo(euros(prix))) + ' =\u00a0<b>' + esc(typo(euros(prix * p.pistes))) + '</b>' : '') + (p.services > 1 ? typo(', en ' + p.services + ' tours') : '') + '.</span>'
        + '</span></p>';
    }
    if (ancres.length) {
      // PLUS DE LEGENDE (Movsar, 2026-10-07 : « pas bcp de texte, sinon ca
      // fait trop long a lire »). Une heure qui coince le dit sur sa puce, et
      // sa raison s eclaire quand on la touche. Les pistes se rangent dans les
      // lignes du programme (htmlEtapes) : chacune dans la ligne de son
      // activite, celle du laser dans la ligne de la partie ouverte.
      var pistesHtml = {};
      ancres.forEach(function (a, i) {
        var laser = a.activityId === 'laser_game';
        var count = Math.max(1, Number(a.count) || 1);
        var multi = laser && count > 1;
        // Plusieurs parties : une heure par partie ; le compte « x heures
        // choisies sur x » est dans le cadre des parties, juste dessous.
        // Le JEU d une partie de laser (20 min), pas le creneau de l arene
        // (25 min) : la phrase juste dessous dit les deux.
        var minutesPartie = laser && dureeLaser() ? dureeLaser().jeu : a.durationMinutes;
        var detail = multi ? count + ' parties de ' + minutesLabel(minutesPartie) : (laser ? '1 partie · ' : '') + minutesLabel(minutesPartie);
        if (state.onglet !== 'formules') detail = joueurs(joueursDe(activite(a.activityId))) + ' · ' + detail;
        var pistes = a.activityId === 'bowling' ? pistesBowling() : null;
        if (pistes) detail += ' · ' + pistes.pistes + ' piste' + (pistes.pistes > 1 ? 's' : '');
        detailsEtapes[a.activityId] = detail;
        pistesHtml[a.activityId] = '<section class="fg-track" data-activity="' + esc(a.activityId) + '" data-count="' + count + '">'
          + '<div class="fg-track__head">'
          + (ancres.length > 1 ? '<span class="fg-track__num" aria-hidden="true">' + (i + 1) + '</span>' : '')
          + '<span class="fg-track__icon"><svg aria-hidden="true"><use href="#' + icone(a.activityId) + '"/></svg></span><b>' + esc(a.label || a.activityId) + '</b><span class="fg-track__detail">' + esc(detail) + '</span>'
          + '</div>'
          + '<p class="fg-track__waves" hidden></p>'
          + rendreChips(a.times || [], multi, a.activityId)
          // Ce qui EXPLIQUE les heures se lit en petit sous elles : les pistes
          // du bowling, la partie de laser partagee.
          + (laser ? notePartage() : '')
          + (a.activityId === 'bowling' ? notePistes() : '')
          + '<div class="fg-track__foot">'
          + '<span class="fg-track__note" role="status" hidden></span>'
          + '<button type="button" class="fg-link fg-track__reset" data-reset="' + esc(a.activityId) + '" hidden>Revenir à l’heure proposée</button>'
          + '</div>'
          + '</section>';
      });
      // Les heures d arcade se chargent a l ouverture de leur ligne (rendreArcades).
      if (aDesArcades(d)) pistesHtml.arcade_time = '<section class="fg-track" data-activity="arcade_time" data-count="1"></section>';
      html += htmlEtapes(etapesDe(d), pistesHtml, avecArrivee);
    } else {
      var slots = (d.slots || []).map(function (s) { return { time: s.time, ok: true }; });
      // Sans heure a proposer, l avis unique est celui du bloc de la visite
      // (rendreVisite) : un second avis ici disait deux fois la meme chose.
      if (slots.length) html += '<section class="fg-track fg-rise" style="--i:1" data-activity="">' + rendreChips(slots, false, 'slot') + '</section>';
    }
    html += '<div id="planZone" class="fg-rise" style="--i:' + (ancres.length ? 1 : 2) + '"></div>';
    hourZone.innerHTML = html;
    signaturePistes = signature;
    keepLabel.textContent = ancres.length ? 'Ces horaires me vont' : 'Cette heure me va';
    if (ancres.length) { majPistes(d); majEtapes(d); rendreArrivees(); rendreArcades(); }
    else { $$('.fg-chip', hourZone).forEach(function (chip) { majChip(chip, { time: chip.dataset.time, ok: true }, state.heure ? [state.heure] : [], ''); }); $$('.fg-track', hourZone).forEach(majPeriodes); }
    rendreVisite();
    posterHauteur();
  }

  /* --- LE PROGRAMME, PAS A PAS (Movsar, 2026-10-07) -------------------------
     Une ligne par chose a placer, et une ligne PAR PARTIE de laser : deux
     parties, deux lignes, deux heures (« les clients ne comprennent pas qu ils
     doivent appuyer sur plusieurs horaires »). Les lignes se rangent dans
     l ordre de la journee, entre l arrivee et la fin : la premiere activite
     donne l heure d arrivee. Une seule ligne ouverte ; l heure posee et
     retenue par le plan, la suivante s ouvre seule. Les heures, leurs etats et
     leurs raisons restent celles des pistes (majPistes) : chaque piste se pose
     dans sa ligne, celle du laser dans la ligne de la partie ouverte. */
  var etapeOuverte = null;     // 'bowling', 'laser_game#2' : la ligne ouverte, null quand tout est replie
  var etapeTouchee = false;    // le client a ouvert ou ferme une ligne : plus rien ne s ouvre a sa place, sauf apres une heure posee
  var partiesSurPlace = false; // les parties de laser sans heure, laissees a l equipe en connaissance de cause
  var detailsEtapes = {};      // le detail de chaque activite (« 6 joueurs · 1 heure · 1 piste »)
  // Une heure d arrivee choisie : les heures que le client n a pas posees sont
  // celles que le serveur a placees a partir d elle, et les parties sans heure
  // se jouent a la suite, placees par l equipe.
  function etapesDe(d) {
    var a0 = ancrage(d), plan0 = state.creneau ? state.creneau.slot.opsPlan || {} : {};
    var ancres = a0.activities || [], defauts = (state.arrivee ? plan0.anchorPlan && plan0.anchorPlan.times : a0.defaultTimes) || {};
    var liste = [];
    ancres.forEach(function (a, rang) {
      var id = a.activityId, compte = Math.max(1, Number(a.count) || 1), label = a.label || nomActivite(id);
      if (!(id === 'laser_game' && compte > 1)) {
        var choisi = state.pins[id] || '';
        liste.push({ cle: id, id: id, partie: 0, compte: 1, rang: rang, label: label, heure: choisi || defauts[id] || '', etat: choisi ? 'choisi' : defauts[id] ? 'propose' : 'vide' });
        return;
      }
      // Les heures des parties : choisies, sinon celles que le plan propose ;
      // une partie sans heure se joue dans la foulee, placee par l equipe.
      var n = state.laserParts.length, heures = n ? state.laserParts.slice() : debutsDesParties(state.creneau, id);
      for (var k = 1; k <= compte; k += 1) {
        var h = heures[k - 1] || '';
        liste.push({ cle: id + '#' + k, id: id, partie: k, compte: compte, rang: rang, label: label, heure: h, etat: h ? (n ? 'choisi' : 'propose') : (partiesSurPlace || state.arrivee ? 'surplace' : 'vide') });
      }
    });
    // LES ARCADES A LEUR HEURE (Movsar, 2026-10-13 : « ils peuvent choisir
    // heure d arrivee mais aussi arcade »). Une heure d arrivee choisie, les
    // arcades de la formule ont leur ligne : l heure choisie, sinon celle ou la
    // frise du serveur les range.
    if (aDesArcades(d)) {
      var rangee = arcadeDuPlan();
      liste.push({ cle: 'arcade_time', id: 'arcade_time', partie: 0, compte: 1, rang: ancres.length, label: (activite('arcade_time') && nomActivite('arcade_time')) || rangee.label || 'Arcades', heure: state.arcade || rangee.startTime || '', etat: state.arcade ? 'choisi' : rangee.startTime ? 'propose' : 'vide' });
    }
    return liste.sort(function (x, y) { return (x.heure ? 0 : 1) - (y.heure ? 0 : 1) || (x.heure < y.heure ? -1 : x.heure > y.heure ? 1 : 0) || x.rang - y.rang || x.partie - y.partie; });
  }
  // La formule a des arcades (son pass), et une heure d arrivee est choisie.
  function aDesArcades(d) { return Boolean(state.arrivee) && state.onglet === 'formules' && (ancrage(d).freePass || []).some(function (x) { return x.activityId === 'arcade_time'; }); }
  // Les arcades dans la frise du plan : { startTime, endTime, minutes, chosen }.
  function arcadeDuPlan() {
    var plan = state.creneau ? state.creneau.slot.opsPlan || {} : {};
    return ((plan.arrivalPlan && plan.arrivalPlan.frise) || []).filter(function (s) { return s.kind === 'free' && s.activityId === 'arcade_time' && s.timed; })[0] || {};
  }
  function aPlacer(e) { return !state.arrivee && e.etat !== 'choisi' && e.etat !== 'surplace'; }
  function detailPartie() {
    var d = dureeLaser(), a = activite('laser_game');
    return [state.onglet !== 'formules' && a ? joueurs(joueursDe(a)) : '', d ? minutesLabel(d.jeu) + ' de jeu' : ''].filter(Boolean).join(' · ');
  }
  function bornesVisite() {
    var cr = state.creneau, slot = cr && cr.slot, plan = (slot && slot.opsPlan) || {};
    var fin = slot ? (slot.visitEndTime || plan.endTime || '') : '';
    return { arrivee: arriveeDe(plan), fin: fin ? heureAffichee(fin) : '', fermeture: Boolean(slot && slot.visitEndsAtClose) };
  }
  // L HEURE D ARRIVEE DITE AU CLIENT (Movsar, 2026-10-13 : « l heure la plus
  // tot choisie est l heure d arrivee »). Un plan compose a partir de l heure
  // d arrivee du client la porte (arrivalPlan) : c est elle qui se dit, jamais
  // l accueil dix minutes avant (arrivalTime). Sans heure d arrivee choisie,
  // rien ne change : l arrivee conseillee du plan.
  function arriveeDe(plan) { return (plan && plan.arrivalPlan && plan.arrivalPlan.arrivalTime) || (plan && plan.arrivalTime) || ''; }
  function idEtape(cle) { return 'etp-' + String(cle).replace(/[^a-z0-9_-]/gi, '-'); }
  // Une ligne du programme : son en-tete (l icone, le titre et son detail,
  // l heure), et ce qu elle deplie. Ni point ni fil (2026-10-13).
  function ligneEtape(classe, attributs, cle, ico, titre, dedans) {
    return '<li class="fg-etape' + classe + '" data-cle="' + esc(cle) + '"' + attributs + '>'
      + '<button type="button" class="fg-etape__tete" aria-expanded="false" aria-controls="' + idEtape(cle) + '">'
      + '<span class="fg-etape__icone"><svg aria-hidden="true"><use href="#' + ico + '"/></svg></span>'
      + '<span class="fg-etape__quoi"><b>' + titre + '</b><small></small></span>'
      + '<span class="fg-etape__heure"></span>'
      + '<svg class="fg-etape__chev" aria-hidden="true"><use href="#i-chevron"/></svg>'
      + '</button>'
      + '<div class="fg-etape__corps" id="' + idEtape(cle) + '"><div class="fg-etape__dedans">' + dedans + '</div></div></li>';
  }
  // L ARRIVEE SE CHOISIT DANS LE PROGRAMME (2026-10-13) : la borne d arrivee
  // devient la premiere ligne, ses heures d arrivee se deplient comme celles
  // d une activite. Une arrivee choisie, chaque activite garde sa ligne ET SES
  // HEURES A TOUCHER, jugees par le serveur avec cette arrivee (Movsar : « on
  // peut pas choisir les heures qu on veut pour les autres activites [...]
  // c est vraiment mal foutu »).
  function htmlEtapes(etapes, pistes, avecArrivee) {
    var laserPose = false;
    var html = '<div class="fg-prog fg-rise" style="--i:0"><ol class="fg-etapes">'
      + (avecArrivee ? ligneEtape(' fg-etape--arrivee', '', 'arrivee', 'i-clock', 'Arrivée', '<div class="fg-etape__piste"><section class="fg-track" data-activity="arrivee"></section></div>')
        : '<li class="fg-etape fg-etape--borne fg-etape--arrivee" aria-hidden="true"><span class="fg-etape__quoi">Arrivée</span><span class="fg-etape__heure"></span></li>');
    etapes.forEach(function (e) {
      var piste = '';
      if (e.partie) { if (!laserPose) { piste = pistes[e.id] || ''; laserPose = true; } }
      else piste = pistes[e.id] || '';
      html += ligneEtape('', ' data-activity="' + esc(e.id) + '" data-partie="' + e.partie + '"', e.cle, icone(e.id),
        esc(e.label) + (e.partie ? ' <em><span class="sr-only">partie </span>' + e.partie + '<span aria-hidden="true">/</span><span class="sr-only"> sur </span>' + e.compte + '</em>' : ''),
        '<div class="fg-etape__piste">' + piste + '</div>'
        + (e.partie > 1 ? '<p class="fg-etape__alt"><button type="button" class="fg-etape__surplace" data-sur-place><svg aria-hidden="true"><use href="#i-users"/></svg>Laisser l’équipe la placer sur place</button></p>' : ''));
    });
    return html + '<li class="fg-etape fg-etape--borne fg-etape--fin" aria-hidden="true"><span class="fg-etape__quoi">Fin</span><span class="fg-etape__heure"></span></li></ol></div>';
  }
  function ouvrirEtape(cle) {
    etapeOuverte = cle;
    if (state.dispo) majEtapes(state.dispo);
    if (cle === 'arrivee') chargerArrivees();
    if (cle === 'arcade_time') chargerArcades();
    posterHauteur();
    setTimeout(posterHauteur, 450);
  }
  // Apres une heure posee et retenue : la prochaine ligne a placer s ouvre ;
  // tout est place, tout se replie et le bouton s eveille.
  function avancerEtape() {
    if (!state.dispo) return;
    var suivante = etapesDe(state.dispo).filter(aPlacer)[0];
    var f = doc.activeElement, ligne = f && f.closest && f.closest('.fg-etape'), clavier = ligne ? focusClavier(f) : false;
    ouvrirEtape(suivante ? suivante.cle : null);
    if (!suivante && !goContact.disabled) eveiller(goContact);
    // Le focus ne reste pas dans une ligne qui se replie : il suit le programme.
    if (ligne && !ligne.classList.contains('is-open')) {
      var vers = suivante ? $('.fg-etape[data-cle="' + suivante.cle + '"] .fg-etape__tete', hourZone) : goContact;
      if (vers && !vers.disabled) { vers.focus({ preventScroll: true }); if (clavier) montrer(vers); }
    }
  }
  function majEtapes(d) {
    var ol = $('.fg-etapes', hourZone);
    if (!ol) return;
    var etapes = etapesDe(d), ligneArr = $('.fg-etape[data-cle="arrivee"]', ol);
    if (etapeOuverte && !(etapeOuverte === 'arrivee' ? ligneArr : etapes.some(function (e) { return e.cle === etapeOuverte; }))) etapeOuverte = null;
    if (etapeOuverte === null && !etapeTouchee) { var premiere = etapes.filter(aPlacer)[0]; etapeOuverte = premiere ? premiere.cle : null; }
    // L ORDRE DE LA JOURNEE. Une ligne qui change de place glisse jusqu a la
    // nouvelle (FLIP : sa place d avant, puis la nouvelle, en un recalcul force).
    // L arrivee reste en tete.
    var fin = $('.fg-etape--fin', ol);
    var ordre = $$('.fg-etape[data-partie]', ol).map(function (li) { return li.dataset.cle; }).join('|');
    var avant = {};
    if (ordre !== etapes.map(function (e) { return e.cle; }).join('|')) {
      $$('.fg-etape[data-partie]', ol).forEach(function (li) { avant[li.dataset.cle] = li.getBoundingClientRect().top; });
      etapes.forEach(function (e) { var li = $('.fg-etape[data-cle="' + e.cle + '"]', ol); if (li) ol.insertBefore(li, fin); });
    }
    var bornes = bornesVisite();
    $('.fg-etape--arrivee .fg-etape__heure', ol).textContent = bornes.arrivee;
    $('.fg-etape--fin .fg-etape__quoi', ol).textContent = bornes.fermeture ? 'Fermeture' : 'Fin vers';
    $('.fg-etape--fin .fg-etape__heure', ol).textContent = bornes.fin;
    ol.classList.toggle('has-bornes', Boolean(bornes.arrivee && bornes.fin));
    // L arrivee se lit comme une autre ligne : choisie, sinon celle que le
    // plan conseille ; dessous, ce qu elle fait faire.
    if (ligneArr) detailsEtapes.arrivee = texteArrivee();
    if ($('.fg-etape[data-cle="arcade_time"]', ol)) detailsEtapes.arcade_time = texteArcades();
    (ligneArr ? etapes.concat([{ cle: 'arrivee', id: 'arrivee', partie: 0, heure: state.arrivee || bornes.arrivee, etat: state.arrivee ? 'choisi' : bornes.arrivee ? 'propose' : 'vide' }]) : etapes).forEach(function (e) {
      var li = $('.fg-etape[data-cle="' + e.cle + '"]', ol);
      if (!li) return;
      var ouverte = e.cle === etapeOuverte, heure = $('.fg-etape__heure', li);
      var mot = e.etat === 'choisi' ? e.heure : e.etat === 'propose' ? e.heure : e.etat === 'surplace' ? 'Sur place' : 'À choisir';
      var dit = e.etat === 'choisi' ? 'choisie ' : e.etat === 'propose' ? 'proposée ' : '';
      if (heure.dataset.mot !== mot && heure.dataset.mot) rejouer(heure, 'is-maj');
      heure.dataset.mot = mot;
      heure.innerHTML = (dit ? '<span class="sr-only">Heure ' + dit + '</span>' : '') + esc(mot);
      // Le rang d une partie est dans son badge (« 1/2 ») : dessous, ce qu elle dure.
      $('.fg-etape__quoi small', li).textContent = typo(e.partie ? detailPartie() : (detailsEtapes[e.id] || ''));
      ['choisi', 'propose', 'vide', 'surplace'].forEach(function (x) { li.classList.toggle('is-' + x, e.etat === x); });
      li.classList.toggle('is-open', ouverte);
      $('.fg-etape__tete', li).setAttribute('aria-expanded', String(ouverte));
      var alt = $('.fg-etape__alt', li);
      if (alt) alt.hidden = e.etat === 'choisi' || e.etat === 'surplace';
    });
    // La piste du laser suit la partie ouverte (sinon, la premiere partie).
    var pisteLaser = $('.fg-track[data-activity="laser_game"]', ol);
    if (pisteLaser && Number(pisteLaser.dataset.count) > 1) {
      var cleLaser = etapeOuverte && etapeOuverte.indexOf('laser_game#') === 0 ? etapeOuverte : (etapes.filter(function (e) { return e.partie; })[0] || {}).cle;
      var place = cleLaser ? $('.fg-etape[data-cle="' + cleLaser + '"] .fg-etape__piste', ol) : null;
      if (place && pisteLaser.parentNode !== place) place.appendChild(pisteLaser);
      // Dans la ligne d une partie, l heure d une AUTRE partie n est pas « la »
      // sienne : elle se lit pour ce qu elle est, l heure de l autre partie.
      var kLaser = cleLaser ? Number(cleLaser.split('#')[1]) : 0, sienne = kLaser ? state.laserParts[kLaser - 1] || '' : '';
      $$('.fg-chip', pisteLaser).forEach(function (c) { c.classList.toggle('is-autre', c.classList.contains('is-on') && c.dataset.time !== sienne); });
    }
    var bouges = Object.keys(avant).map(function (cle) {
      var li = $('.fg-etape[data-cle="' + cle + '"]', ol), dy = avant[cle] - li.getBoundingClientRect().top;
      if (!dy || reduced) return null;
      li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)';
      return li;
    }).filter(Boolean);
    if (bouges.length) {
      void ol.offsetHeight;
      bouges.forEach(function (li) { li.style.transition = 'transform .42s var(--fg-ease-out)'; li.style.transform = ''; });
      setTimeout(function () { bouges.forEach(function (li) { li.style.transition = ''; }); }, 460);
    }
  }

  /* --- LA FORMULE PAR HEURE D ARRIVEE (2026-10-13) ----------------------------
     Le gerant de Libramont, le 12/10 : un groupe de 10 veut venir a 10:00, le
     bowling et le laser sont pleins de 10:00 a 12:00, la formule a 30 min
     d arcades a faire pendant ce temps. Movsar, le 13/10 : « pour les formules
     ils peuvent choisir heure pour arcade aussi ». Le client choisit l heure
     ou il arrive : le libre de la formule d abord, le bowling et le laser des
     qu ils sont libres. Chaque heure d arrivee dit si elle tient et sinon
     pourquoi (arrivals=1, la porte de la reservation) ; la liste ne se charge
     qu a l ouverture de la ligne : sans elle, aucune demande ne change. */
  // Ce que l arrivee fait faire, sous son titre. Sans heure choisie : le libre
  // de la formule (ses arcades, sinon son minigolf, jamais une activite qu elle
  // n a pas) en attendant ses activites a heure fixe. Une heure choisie : ce
  // qui se fait avant la premiere, lu dans la frise du plan.
  function texteArrivee() {
    var a = ancrage(state.dispo), plan = state.creneau ? state.creneau.slot.opsPlan || {} : {};
    if (state.arrivee) {
      var frise = (plan.arrivalPlan && plan.arrivalPlan.frise) || [], attente = Number(plan.arrivalPlan && plan.arrivalPlan.waitMinutes) || 0;
      return frise.filter(function (s) { return s.kind === 'free' && s.placement === 'before' && !estBoisson(s.label); })
        .map(function (s) { return s.label + (s.timed ? ' jusqu’à ' + heureAffichee(s.endTime) : ' en attendant'); })
        .concat(attente > 0 ? [dureeExacte(attente) + ' d’attente'] : []).join(' · ');
    }
    var libres = (a.freePass || []).slice().sort(function (x, y) { return (y.activityId === 'arcade_time') - (x.activityId === 'arcade_time'); });
    var noms = (a.activities || []).map(function (x) { return 'le ' + nomBas(x.label || nomActivite(x.activityId)); });
    return libres.length && noms.length ? 'À votre heure : ' + nomBas(libres[0].label) + ' en attendant ' + joindreListe(noms, ' et ') : '';
  }
  function cleArrivees(cle) {
    if (arrivees.cle !== cle) { arrivees.cle = cle; arrivees.liste = null; arrivees.bornes = null; arrivees.message = ''; arrivees.lu = 0; arrivees.erreur = false; arrivees.poses = ''; }
  }
  // La liste se juge avec les heures posees (urlDispo) : elle ne vaut que pour
  // celles-ci.
  function signaturePoses() { return JSON.stringify([state.pins, state.laserParts].concat(state.arrivee && state.arcade ? [state.arcade] : [])); }
  // La liste, relue a chaque ouverture passe la cadence des heures, et des que
  // les heures posees ont change.
  function chargerArrivees() {
    var cle = cleDemande(), poses = signaturePoses(), enCours = cle + '#' + poses;
    cleArrivees(cle);
    if (arrivees.enCours === enCours || (arrivees.liste && arrivees.poses === poses && Date.now() - arrivees.lu < CADENCE_HEURES)) { rendreArrivees(); return; }
    arrivees.enCours = enCours; arrivees.erreur = false;
    rendreArrivees();
    lire(urlDispo(true), { headers: enteteBlocage() })
      .then(function (rep) { var j = lu(rep); if (!j || j.ok === false) throw new Error('liste'); return j; })
      .then(function (j) {
        if (arrivees.enCours === enCours) arrivees.enCours = '';
        if (cle !== cleDemande() || poses !== signaturePoses()) return;
        arrivees.poses = poses;
        arrivees.liste = Array.isArray(j.arrivals) ? j.arrivals : [];
        arrivees.bornes = j.arrivalBounds || null;
        arrivees.message = String(j.message || '');
        arrivees.lu = Date.now();
        if (arrivees.bornes && arrivees.bornes.arrivalFirst === false) { arriveeRetiree(); return; }
        rendreArrivees();
        posterHauteur();
      }, function () {
        if (arrivees.enCours === enCours) arrivees.enCours = '';
        if (cle !== cleDemande() || poses !== signaturePoses()) return;
        arrivees.erreur = !arrivees.liste;
        rendreArrivees();
        posterHauteur();
      });
  }
  // LE DERNIER CHOIX GAGNE (Movsar, 2026-10-13 : « c est vraiment pas normal
  // de pouvoir choisir aucun horaire »). Une arrivee a t libere les heures
  // posees avant elle et ses minutes d accueil (welcomeMinutes : la regle de
  // la liste du serveur, api/public-availability.js poseesApres) ; le serveur
  // replace ces activites apres elle.
  function poseesAvant(t) {
    var seuil = minutesDe(t) + (Number(arrivees.bornes && arrivees.bornes.welcomeMinutes) || 0);
    var avant = function (h) { return minutesDe(h) < seuil; };
    var parties = state.laserParts.length ? state.laserParts : (state.pins.laser_game ? [state.pins.laser_game] : []);
    return {
      pins: Object.keys(state.pins).filter(function (id) { return id !== 'laser_game' && avant(state.pins[id]); }),
      parties: parties.filter(avant),
      restantes: parties.filter(function (h) { return !avant(h); }),
      arcade: Boolean(state.arcade) && avant(state.arcade),
    };
  }
  // « votre bowling », « vos arcades » : le possessif de ce qu on deplace.
  function votre(id) { return id === 'arcade_time' ? 'vos ' + nomBas(nomActivite(id)) : 'votre ' + nomBas(nomActivite(id)); }
  // Ce qu une arrivee libere, dit sur sa puce : les activites que le serveur
  // a jugees liberees (`releases`), avec leurs heures posees.
  function liberePar(t, ids) {
    var liste = Array.isArray(ids) ? ids : [];
    if (!liste.length) return null;
    var avant = poseesAvant(t);
    var heureDe = function (id) { return id === 'laser_game' ? joindreHeures(avant.parties) : id === 'arcade_time' ? state.arcade : state.pins[id] || ''; };
    var dites = liste.map(function (id) { return votre(id) + (heureDe(id) ? ' (' + heureDe(id) + ')' : ''); });
    var phrase = joindreListe(dites, ' et ') + (liste.length > 1 || liste[0] === 'arcade_time' ? ' se replaceront' : ' se replacera') + ' après votre arrivée.';
    return {
      activityId: liste.join(','),
      label: joindreListe(liste.map(nomActivite), ' et '),
      time: liste.map(heureDe).filter(Boolean).join(', '),
      raison: phrase.charAt(0).toUpperCase() + phrase.slice(1),
    };
  }
  // LES HEURES D ARRIVEE, avec la grammaire des heures des activites : le mot
  // court sur la puce, une ligne par cause sous la plage, la phrase longue du
  // serveur en titre. Une longue attente est un avis, ses minutes se disent en
  // fourchette ; une arrivee qui libere des heures posees se dit « décale ».
  function rendreArrivees() {
    var track = $('.fg-track[data-activity="arrivee"]', hourZone);
    if (!track) return;
    var liste = arrivees.cle === cleDemande() ? arrivees.liste : null;
    var etat = liste ? liste.map(function (x) { return x.time; }).join(',') : arrivees.erreur ? '!' : '…';
    if (track.dataset.etat !== etat) {
      track.dataset.etat = etat;
      track.innerHTML = (liste ? rendreChips(liste, false, 'arrivee') : arrivees.erreur ? '' : '<p class="fg-loading">On regarde ce qui est libre…</p>')
        + '<div class="fg-track__foot"><span class="fg-track__note" role="status" hidden></span>'
        + (liste || !arrivees.erreur ? '<button type="button" class="fg-link fg-track__reset" data-reset="arrivee" hidden>Revenir à l’heure proposée</button>'
          : '<button type="button" class="fg-link fg-track__reset" data-arrivees>Réessayer</button>')
        + '</div>';
    }
    var note = $('.fg-track__note', track);
    note.textContent = liste ? arrivees.message : arrivees.erreur ? 'Les heures d’arrivée ne se sont pas chargées.' : '';
    note.hidden = !note.textContent;
    if (!liste) return;
    var parHeure = {};
    liste.forEach(function (x) { parHeure[x.time] = x; });
    $$('.fg-chip', track).forEach(function (chip) {
      var x = parHeure[chip.dataset.time] || {}, refus = x.ok === false;
      var court = refus ? String((x.shortReason && x.shortReason !== 'Indisponible' ? x.shortReason : x.reason) || 'Indisponible').replace(/\.$/, '') : '';
      var libere = refus || state.arrivee === chip.dataset.time ? null : liberePar(chip.dataset.time, x.releases);
      majChip(chip, { time: chip.dataset.time, ok: !refus, code: x.code, reason: court, warning: x.warning, libere: libere }, state.arrivee ? [state.arrivee] : [], '', false, 'arrivee', null, 1);
      if (refus && x.reason) chip.setAttribute('title', x.reason);
    });
    $$('.fg-period', track).forEach(function (sec) { expliquerPeriode(sec, 'arrivée'); });
    var reset = $('[data-reset="arrivee"]', track);
    if (reset) reset.hidden = !state.arrivee;
    majPeriodes(track);
  }
  // UNE HEURE D ARRIVEE CHOISIE : le serveur pose a partir d elle le bowling
  // et le laser encore libres. LES HEURES POSEES APRES ELLE RESTENT (Movsar,
  // 2026-10-13 : « quand ils choisissent l heure d arrivee on peut pas
  // choisir les heures qu on veut pour les autres activites ») ; celles
  // d avant se liberent, le serveur les replace apres elle, la visite le dit
  // (adaptation). La liste des arrivees a juge chacune ainsi. Retouchee,
  // l arrivee se retire.
  function choisirArrivee(t, puce) {
    adaptation = null;
    if (state.arrivee === t) { state.arrivee = ''; state.arcade = ''; }
    else {
      state.arrivee = t;
      var avant = poseesAvant(t), liberees = avant.pins.slice();
      avant.pins.forEach(function (id) { delete state.pins[id]; });
      if (avant.parties.length) {
        liberees.push('laser_game');
        if (state.laserParts.length) state.laserParts = avant.restantes;
        if (avant.restantes.length) state.pins.laser_game = avant.restantes[0]; else delete state.pins.laser_game;
      }
      // Des arcades posees avant elle : la frise les range apres l accueil.
      if (avant.arcade) { liberees.push('arcade_time'); state.arcade = ''; }
      if (liberees.length) adaptation = { liberees: liberees, pour: 'arrivee', t: t };
    }
    $$('.fg-chip.is-pending', hourZone).forEach(function (c) { c.classList.remove('is-pending'); });
    if (puce) puce.classList.add('is-pending');
    chargerPlan();
  }
  /* --- LES ARCADES A LEUR HEURE (2026-10-13) --------------------------------
     Movsar : « pourquoi tu mets automatiquement l heure d arrivee a arcade [...]
     ils peuvent choisir heure d arrivee mais aussi arcade, mettre arcade
     pendant temps d attente ». Une arrivee choisie, la ligne des arcades dit
     ou la frise les range ; ses heures (arcades=1) se chargent a son
     ouverture, chacune jugee par la porte de la reservation. Une heure sur une
     activite posee la decale (le dernier choix gagne). */
  function texteArcades() {
    var s = arcadeDuPlan(), m = Number(s.minutes) || 0;
    var ou = state.arcade ? 'à votre heure' : !s.startTime ? '' : s.placement === 'after' ? 'après les activités' : 'pendant l’attente';
    return [m ? minutesLabel(m) : '', 'comprises', ou].filter(Boolean).join(' · ');
  }
  // La liste ne depend que de l arrivee et des heures posees des activites :
  // choisir une arcade ne la relit pas.
  function cleArcades() { return cleDemande() + '#' + state.arrivee + '#' + JSON.stringify([state.pins, state.laserParts]); }
  function chargerArcades() {
    var cle = cleArcades();
    if (arcades.cle !== cle) { arcades.cle = cle; arcades.liste = null; arcades.lu = 0; arcades.erreur = false; }
    if (!state.arrivee || arcades.enCours === cle || (arcades.liste && Date.now() - arcades.lu < CADENCE_HEURES)) { rendreArcades(); return; }
    arcades.enCours = cle; arcades.erreur = false;
    rendreArcades();
    lire(urlDispo('arcades'), { headers: enteteBlocage() })
      .then(function (rep) { var j = lu(rep); if (!j || j.ok === false) throw new Error('arcades'); return j; })
      .then(function (j) {
        if (arcades.enCours === cle) arcades.enCours = '';
        if (cle !== cleArcades()) return;
        arcades.liste = Array.isArray(j.arcadeTimes) ? j.arcadeTimes : [];
        arcades.lu = Date.now();
        rendreArcades();
        posterHauteur();
      }, function () {
        if (arcades.enCours === cle) arcades.enCours = '';
        if (cle !== cleArcades()) return;
        arcades.erreur = !arcades.liste;
        rendreArcades();
        posterHauteur();
      });
  }
  // Ce qu une heure d arcade decale, dit sur sa puce : l activite posee
  // qu elle chevauche (`conflict` du serveur), que le moteur replace.
  function arcadeLibere(x) {
    var c = x && x.conflict;
    if (!c || !c.activityId) return null;
    // Une partie de laser parmi d autres posees : elle seule se libere et passe
    // dans la foulee (la liste l a jugee ainsi) ; seule posee, le moteur la replace.
    var k = c.activityId === 'laser_game' && state.laserParts.length > 1 ? rangPartie(c.time) : 0;
    var phrase = k ? 'votre partie ' + k + ' de laser game (' + c.time + ') passera dans la foulée, sans heure fixe.'
      : votre(c.activityId) + (c.time ? ' (' + c.time + ')' : '') + ' se replacera autour de vos arcades.';
    return { activityId: c.activityId, label: c.label || nomActivite(c.activityId), time: c.time || '', raison: phrase.charAt(0).toUpperCase() + phrase.slice(1) };
  }
  function rendreArcades() {
    var track = $('.fg-track[data-activity="arcade_time"]', hourZone);
    if (!track) return;
    // La ligne ouverte sur une liste d une autre demande (une autre arrivee,
    // d autres heures posees) la relit : ses verdicts ne valent plus.
    if (etapeOuverte === 'arcade_time' && arcades.cle !== cleArcades() && arcades.enCours !== cleArcades()) { chargerArcades(); return; }
    var liste = arcades.cle === cleArcades() ? arcades.liste : null;
    // L heure ou le plan tient les arcades a sa puce, meme hors de la grille
    // (la fin d une activite, prise dans un temps libre) : elle tient.
    var duPlan = arcadeDuPlan().startTime || '';
    if (liste && duPlan && !liste.some(function (x) { return x.time === duPlan; })) liste = liste.concat([{ time: duPlan, ok: true }]).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    var etat = liste ? 'l:' + liste.map(function (x) { return x.time; }).join(',') : arcades.erreur ? '!' : '…';
    if (track.dataset.etat !== etat) {
      track.dataset.etat = etat;
      track.innerHTML = (liste ? (liste.length ? rendreChips(liste, false, 'arcade_time') : '') : arcades.erreur ? '' : '<p class="fg-loading">On regarde les heures d’arcade…</p>')
        + '<div class="fg-track__foot"><span class="fg-track__note" role="status" hidden></span>'
        + (liste || !arcades.erreur ? '<button type="button" class="fg-link fg-track__reset" data-reset="arcade_time" hidden>Revenir à l’heure proposée</button>'
          : '<button type="button" class="fg-link fg-track__reset" data-arcades>Réessayer</button>')
        + '</div>';
    }
    var note = $('.fg-track__note', track);
    note.textContent = liste && !liste.length ? 'Aucune autre heure d’arcade ce jour-là.' : !liste && arcades.erreur ? 'Les heures d’arcade ne se sont pas chargées.' : '';
    note.hidden = !note.textContent;
    var reset = $('[data-reset="arcade_time"]', track);
    if (reset) reset.hidden = !state.arcade;
    if (!liste) return;
    var parHeure = {};
    liste.forEach(function (x) { parHeure[x.time] = x; });
    var rangee = state.arcade ? '' : arcadeDuPlan().startTime || '';
    $$('.fg-chip', track).forEach(function (chip) {
      var x = parHeure[chip.dataset.time] || {}, refus = x.ok === false;
      var court = refus ? String((x.shortReason && x.shortReason !== 'Indisponible' ? x.shortReason : x.reason) || 'Indisponible').replace(/\.$/, '') : '';
      var decale = refus || state.arcade === chip.dataset.time ? null : arcadeLibere(x);
      majChip(chip, { time: chip.dataset.time, ok: !refus, code: x.code, reason: court, libere: decale, warning: x.warning }, state.arcade ? [state.arcade] : [], rangee, false, 'arcade_time', null, 1);
      if (x.ok === false && x.reason) chip.setAttribute('title', x.reason);
    });
    $$('.fg-period', track).forEach(function (sec) { expliquerPeriode(sec, 'arcades'); });
    majPeriodes(track);
  }
  // UNE HEURE D ARCADE CHOISIE : la frise pose les arcades a cette heure ; une
  // activite posee qu elle chevauche se leve et le moteur la replace autour
  // (la liste l a jugee ainsi). Retouchee, l heure se retire et la frise
  // reprend la main.
  function choisirArcade(t, puce) {
    adaptation = null;
    if (state.arcade === t) state.arcade = '';
    else {
      var x = ((arcades.cle === cleArcades() && arcades.liste) || []).filter(function (e) { return e.time === t; })[0] || {};
      var c = x.ok !== false && x.conflict && x.conflict.activityId ? x.conflict : null;
      if (c) {
        if (c.activityId === 'laser_game') {
          var parties = state.laserParts.length ? state.laserParts : (state.pins.laser_game ? [state.pins.laser_game] : []);
          var restent = parties.filter(function (h) { return h !== c.time; });
          if (state.laserParts.length) state.laserParts = restent;
          if (restent.length) state.pins.laser_game = restent[0]; else delete state.pins.laser_game;
        } else delete state.pins[c.activityId];
        adaptation = { liberees: [c.activityId], pour: 'arcade_time', t: t };
      }
      state.arcade = t;
    }
    $$('.fg-chip.is-pending', hourZone).forEach(function (el) { el.classList.remove('is-pending'); });
    if (puce) puce.classList.add('is-pending');
    chargerPlan();
  }
  // LE CENTRE NE PROPOSE PLUS L ARRIVEE (arrivalBounds.arrivalFirst false) :
  // la ligne redevient la borne d arrivee, une arrivee choisie tombe.
  function arriveeRetiree() {
    if (etapeOuverte === 'arrivee') etapeOuverte = null;
    signaturePistes = '';
    if (state.arrivee) { state.arrivee = ''; state.arcade = ''; chargerPlan(); return; }
    if (state.dispo) rendreHeures();
  }
  hourZone.addEventListener('click', function (e) {
    var tete = e.target.closest('.fg-etape__tete');
    if (tete) {
      var ligne = tete.closest('.fg-etape');
      etapeTouchee = true;
      ouvrirEtape(ligne.classList.contains('is-open') ? null : ligne.dataset.cle);
      return;
    }
    if (e.target.closest('[data-sur-place]')) {
      // Les parties sans heure restent a l equipe : la ligne se dit « Sur place ».
      partiesSurPlace = true;
      avancerEtape();
      return;
    }
    if (e.target.closest('[data-arrivees]')) { chargerArrivees(); return; }
    if (e.target.closest('[data-arcades]')) { chargerArcades(); return; }
    var enTete = e.target.closest('.fg-period__btn');
    if (enTete) {
      var sec = enTete.closest('.fg-period');
      var piste = sec.closest('.fg-track');
      if (piste) piste.dataset.touched = '1';
      // Dans une ligne du programme, les plages sont des onglets : celui qui
      // est ouvert le reste.
      if (sec.classList.contains('is-open')) { if (!sec.closest('.fg-etape')) basculerPeriode(sec, false); } else montrerPeriode(piste || sec.parentElement, sec);
      posterHauteur();
      setTimeout(posterHauteur, 450);
      return;
    }
    var reset = e.target.closest('[data-reset]');
    if (reset) {
      var idr = reset.dataset.reset;
      // Rendre la main a l equipe rend aussi les menus : la piste rouvre la
      // periode de l heure proposee.
      var pisteReset = reset.closest('.fg-track');
      if (pisteReset) delete pisteReset.dataset.touched;
      delete state.pins[idr];
      if (idr === 'laser_game') state.laserParts = [];
      if (idr === 'arrivee') { state.arrivee = ''; state.arcade = ''; }
      if (idr === 'arcade_time') state.arcade = '';
      delete state.heuresPassees[idr];
      adaptation = null;
      chargerPlan();
      return;
    }
    var chip = e.target.closest('.fg-chip');
    if (!chip) return;
    var track = chip.closest('.fg-track');
    var t = chip.dataset.time;
    $$('.fg-chip.is-asked', hourZone).forEach(function (c) { c.classList.remove('is-asked'); });
    $$('.fg-why-list__item.is-lit, .fg-etape.is-lit, .fg-track__waves.is-lit', hourZone).forEach(function (l) { l.classList.remove('is-lit'); });
    if (chip.dataset.ok === 'false') {
      // Une heure qui ne se prend pas s EXPLIQUE deja : sous sa plage (la
      // ligne qui la concerne s eclaire, plus de seconde boite qui repete), ou,
      // pour l heure d une de SES parties, dans le cadre des parties ou la note
      // des groupes, que la voix redit.
      chip.classList.add('is-asked');
      var cible = null;
      if (chip.dataset.state === 'wave') {
        cible = chip.dataset.partie ? $('.fg-etape[data-cle="laser_game#' + chip.dataset.partie + '"]', hourZone) : $('.fg-track__waves', track);
        dire(t + ' : votre ' + (chip.dataset.partie ? 'partie ' + chip.dataset.partie : chip.dataset.mot || $('small', chip).textContent) + ' joue à cette heure.');
      } else {
        var sec = chip.closest('.fg-period');
        cible = sec ? $$('.fg-why-list__item', sec).filter(function (l) { return (' ' + l.dataset.heures + ' ').indexOf(' ' + t + ' ') >= 0; })[0] : null;
      }
      if (cible) { void cible.offsetWidth; cible.classList.add('is-lit'); }
      posterHauteur();
      return;
    }
    var idA = track.dataset.activity;
    if (idA === 'arrivee') { choisirArrivee(t, chip); return; }
    if (idA === 'arcade_time') { choisirArcade(t, chip); return; }
    if (!idA) {
      // Formule ou visite sans activite planifiee : le creneau se retient tel quel.
      var direct = (state.dispo.slots || []).filter(function (s) { return s.time === t; })[0];
      if (!direct) return;
      state.heure = t;
      state.creneau = creneauAvecDevis(direct, state.dispo);
      $$('.fg-chip', track).forEach(function (c) { majChip(c, { time: c.dataset.time, ok: true }, [t], ''); });
      // Le creneau vient des slots du serveur : il est retenu tel quel.
      rejouer(chip, 'is-pose');
      rendreVisite();
      goContact.disabled = false;
      return;
    }
    adaptation = null;
    var vague = chip.dataset.state === 'wave' && chip.dataset.wave ? JSON.parse(chip.dataset.wave) : null;
    if ((chip.dataset.state === 'shift' || (vague && chip.dataset.sous === 'shift')) && chip.dataset.conflict && chip.dataset.conflict !== 'arrivee') {
      // L heure chevauche l AUTRE activite posee : c est l AUTRE qui bouge. Le
      // bowling se leve, le moteur le replace autour de l heure choisie. Une
      // partie de laser parmi d autres se libere seule et passe sans heure
      // (l equipe la placera sur place) : le reste du choix ne genait
      // personne (meme regle que le tunnel).
      var autre = chip.dataset.conflict;
      // Les arcades posees que l heure chevauche : elles se levent, la frise
      // les range autour de cette heure.
      if (autre === 'arcade_time') {
        state.arcade = '';
        adaptation = { deplace: 'arcade_time', pour: idA, t: t };
      } else if (autre === 'laser_game' && state.laserParts.length > 1 && state.laserParts.indexOf(chip.dataset.conflictTime) >= 0) {
        state.laserParts = state.laserParts.filter(function (h) { return h !== chip.dataset.conflictTime; });
        state.pins.laser_game = state.laserParts[0];
      } else {
        delete state.pins[autre];
        if (autre === 'laser_game') state.laserParts = [];
        adaptation = { deplace: autre, pour: idA, t: t };
      }
    }
    // UNE HEURE PRISE AVANT L ARRIVEE CHOISIE, ou pendant son accueil : le
    // dernier choix gagne, l arrivee tombe et le plan la conseille juste avant
    // la premiere activite (la grille l a dit « décale » : arrival_before,
    // arrival_welcome). Une partie de laser deplacee la-bas fait de meme.
    var accueil = Number(arrivees.bornes && arrivees.bornes.welcomeMinutes) || 0;
    if (state.arrivee && minutesDe(t) < minutesDe(state.arrivee) + accueil) {
      if (!adaptation) adaptation = { deplace: 'arrivee', pour: idA, t: t, avant: state.arrivee };
      state.arrivee = '';
      state.arcade = '';
    }
    var count = Number(track.dataset.count) || 1;
    if (idA === 'laser_game' && count > 1) {
      var i = state.laserParts.indexOf(t);
      // La partie DEPLACEE : celle que l heure chevauche (verdict `move` du
      // serveur), ou celle dont un groupe joue deja a cette heure ; les autres
      // ne bougent pas. Sinon l heure ajoute une partie, et remplace la plus
      // tot quand toutes sont posees (la regle que le serveur a jugee).
      var remplacee = chip.dataset.replaces || (vague ? vague.depuis : '');
      var j = remplacee ? state.laserParts.indexOf(remplacee) : -1;
      // LA PARTIE DE LA LIGNE OUVERTE : son heure bouge, ou elle en recoit une.
      // L heure d une AUTRE partie ouvre la ligne de celle-ci, sans rien poser.
      var kOuvert = etapeOuverte && etapeOuverte.indexOf('laser_game#') === 0 ? Number(etapeOuverte.split('#')[1]) : 0;
      var actuelle = kOuvert ? state.laserParts[kOuvert - 1] || '' : '';
      if (i >= 0 && kOuvert && state.laserParts[i] !== actuelle) { ouvrirEtape('laser_game#' + (i + 1)); return; }
      if (i >= 0) state.laserParts.splice(i, 1);
      else if (j >= 0) state.laserParts[j] = t;
      else if (actuelle) state.laserParts[kOuvert - 1] = t;
      else { if (state.laserParts.length >= count) state.laserParts.shift(); state.laserParts.push(t); }
      state.laserParts.sort();
      if (state.laserParts.length) state.pins.laser_game = state.laserParts[0]; else delete state.pins.laser_game;
    } else if (vague) {
      state.pins[idA] = t;
    } else if (state.pins[idA] === t) {
      delete state.pins[idA];
    } else {
      state.pins[idA] = t;
    }
    // Une heure choisie pour cette activite : l heure passee n est plus a dire.
    delete state.heuresPassees[idA];
    // L heure touchee s entoure tout de suite, avant la reponse : le toucher
    // est entendu. chargerPlan relit cette case a la reponse.
    $$('.fg-chip.is-pending', hourZone).forEach(function (c) { c.classList.remove('is-pending'); }); chip.classList.add('is-pending');
    chargerPlan();
  });
  // LES ACTIVITES DU PLAN, UNE PAR PARTIE. Une activite a creneau se joue en
  // parties (le bowling, chaque partie de laser), et chaque partie en un ou
  // plusieurs groupes quand le groupe ne tient pas en une fois. Tout vient
  // des blocs du plan rendu par le serveur, jamais recalcule ici : l heure de
  // chaque groupe, sa taille, la fin du dernier, les pistes du bowling.
  function partiesDuPlan(cr) {
    var plan = cr && cr.slot ? (cr.slot.opsPlan || {}) : {};
    var index = {}, liste = [];
    // Une entree a la journee n est pas une partie a heure : le bloc que le
    // planning lui pose (visite 100 % libre) disait « Playground · 1 heure,
    // jusqu a 11:00 ». Elle se lit avec les activites libres.
    var journee = {};
    (((cr && cr.reponse && cr.reponse.program) || {}).items || []).forEach(function (it) { if (it && it.dayAccess) journee[it.activityId] = 1; });
    (plan.resourceBlocks || []).forEach(function (b) {
      if (!b || !(b.type === 'activity' || b.activityId) || !b.activityId || !b.startTime || journee[b.activityId]) return;
      var cle = b.activityId + '#' + (Number(b.countIndex) || 1);
      if (!index[cle]) { index[cle] = { id: b.activityId, partie: Number(b.countIndex) || 1, groupes: [], pistes: 0, label: String(b.label || '') }; liste.push(index[cle]); }
      var p = index[cle];
      if (p.groupes.some(function (g) { return g.debut === String(b.startTime); })) return;
      p.groupes.push({ joueurs: Number(b.players) || 0, debut: String(b.startTime), fin: String(b.endTime || '') });
      p.pistes = Math.max(p.pistes, Number(b.requiredLanes) || 0);
    });
    liste.forEach(function (p) {
      p.groupes.sort(function (x, y) { return x.debut.localeCompare(y.debut); });
      p.debut = p.groupes[0].debut;
      p.fin = p.groupes.map(function (g) { return g.fin; }).sort().pop() || '';
    });
    return liste.sort(function (x, y) { return x.debut.localeCompare(y.debut); });
  }
  function blocsDuPlan(cr) {
    var plan = cr && cr.slot ? (cr.slot.opsPlan || {}) : {};
    var vus = {};
    return (plan.resourceBlocks || []).filter(function (b) {
      if (!(b.type === 'activity' || b.activityId)) return false;
      var cle = b.activityId + '@' + b.startTime;
      if (vus[cle]) return false; vus[cle] = 1; return true;
    }).sort(function (a, b) { return String(a.startTime).localeCompare(String(b.startTime)); });
  }
  // La case « choisie » vient de state.pins : elle le reste meme quand le serveur
  // ne rend aucun plan. L onde ne confirme que ce que le plan place vraiment.
  function planRetient(id, t) {
    if (id === 'arrivee') return Boolean(state.creneau) && state.arrivee === t;
    if (id === 'arcade_time') return arcadeDuPlan().startTime === t;
    return blocsDuPlan(state.creneau).some(function (b) { return b.activityId === id && b.startTime === t; });
  }
  // « a, b et c », « a puis b » : une liste lue d un trait.
  function joindreListe(liste, et) { return liste.length < 2 ? (liste[0] || '') : liste.slice(0, -1).join(', ') + et + liste[liste.length - 1]; }
  // LES GROUPES D UNE PARTIE, en une ligne : combien, de quelle taille, et,
  // quand il le faut, a quelle heure chacun part.
  function texteGroupes(p, avecHeures) {
    if (!p || !(p.groupes.length > 1)) return '';
    return p.groupes.length + ' groupes ' + taillesGroupes(p.groupes.map(function (g) { return g.joueurs; }))
      + (avecHeures ? ', à ' + joindreListe(p.groupes.map(function (g) { return g.debut; }), ' puis ') : '');
  }
  // LE TEMPS SUR PLACE, de l arrivee conseillee a la fin annoncee. Les deux
  // heures viennent du plan du serveur : la duree n est donc jamais un
  // troisieme chiffre a cote de deux autres, c est leur ecart. Additionner les
  // minutes des activites aurait menti pour un grand groupe (la ligne du
  // programme porte la duree d UN service, pas des deux).
  function surPlace(debut, fin) {
    var m = minutesEntre(debut, fin);
    return m > 0 ? '\u00a0· <b>' + esc(insecable(dureeExacte(m))) + '</b>\u00a0sur\u00a0place' : '';
  }
  // Ce qu une ligne de programme achete, en mots : les parties, les sessions
  // d un groupe qui tourne, ou la duree (par groupe quand il en joue deux).
  function detailSupplementLaser(it) { var games = Math.max(0, Number(it.extraLaser.games) - (Number(it.games) || 1)); return games + ' partie' + (games > 1 ? 's' : '') + ' supplémentaire' + (games > 1 ? 's' : '') + ' pour ' + Number(it.extraLaser.participants) + ' joueurs'; }
  function detailLigne(it) {
    if (it.arcadeOffer) return detailArcade(it);
    if (it.waitOffer === true) return 'pendant l’attente, ' + (Number(it.participants) || 0) + ' personne' + (Number(it.participants) > 1 ? 's' : '');
    if (it.extraLaser) { var baseGames = Number(it.games) || 1; return baseGames + ' partie' + (baseGames > 1 ? 's' : '') + ' + ' + detailSupplementLaser(it); }
    if (Number(it.games) > 0) return it.games + ' partie' + (it.games > 1 ? 's' : '');
    if (it.dayAccess) return 'toute la journée';
    return detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) + (it.services && it.services.length > 1 ? ' par groupe' : '') : '');
  }
  // UNE ENTREE A LA JOURNEE (la plaine de jeux) se dit comme elle se vend :
  // « accès toute la journée ». Ses minutes au catalogue ne sont qu une
  // estimation de temps sur place pour le planning, jamais montree comme ce
  // que le client achete (Movsar, 2026-09-25 : « ça met 1h dans le recap ...
  // c est un acces toute la journée et c est entre 4 ans à 12 ans »).
  // L age est celui que le CENTRE declare (public-booking-meta).
  function ageActivite(id) { var a = activite(id); return a && a.ageRange ? a.ageRange : ''; }
  // L age ne se coupe pas en fin de ligne (« · 4 » puis « à 12 ans »).
  // Le minimum de joueurs se lit sur la carte avant tout choix (le laser se
  // joue a deux) : le client ne le decouvre pas en cochant.
  function precisionsCarte(a) {
    return [a.ageRange ? a.ageRange.replace(/ /g, '\u00a0') : '', a.minPax > 1 ? a.minPax + '\u00a0joueurs minimum' : ''].filter(Boolean).join(' · ');
  }
  // Pas assez de joueurs pour lancer l activite (minPax du catalogue).
  function tropPeu(a) { return Boolean(a && a.minPax > 1 && state.pax < a.minPax); }
  // Une activite que le centre a bloquee pour la journee choisie (verdict du
  // serveur, calendrier servi) : le moteur ne la refuse pas toujours, l ecran
  // ne la propose donc pas.
  function fermeCeJour(a) { var j = jourInfo(state.date); return Boolean(a && j && (j.unavailableActivityIds || []).indexOf(a.id) >= 0); }
  // Une etape : son heure (vide pour ce qui se joue dans la foulee), son
  // titre, son detail, et au besoin une seconde ligne de detail.
  // CE QUI NE TIENDRA PAS AVANT LA FERMETURE, NOMME (Movsar, 2026-10-01 :
  // « faut dire ce qui sera pas possible de jouer [...] quand y plusieurs
  // comme ça faut dire tout ce qui se jouera pas »). Le serveur le nomme
  // (visitShortfallItems) avec la mesure qui donne la fin de la visite : les
  // heures de bowling et de laser restent, ce sont les activites sans heure
  // qui sautent. L ecran le dit, sans rien recalculer.
  function horsDelaiDu(slot) {
    return slot && slot.visitEndsAtClose && Array.isArray(slot.visitShortfallItems) ? slot.visitShortfallItems : [];
  }
  function nomHorsDelai(h, avecDuree) {
    if (h.partie) return h.name + ' (partie ' + h.partie + ')';
    var ar = reglageArcade(activite(h.activityId));
    return h.name + (avecDuree && !h.durationEstimated && !(ar && ar.mode === 'credit') && !h.dayAccess && Number(h.minutes) > 0 ? ' (' + dureeExacte(h.minutes) + ')' : '');
  }
  function phraseHorsDelai(liste, fin, avecDuree) {
    return {
      tete: (liste.length > 1 ? 'Ne tiendront pas' : 'Ne tiendra pas') + ' avant la fermeture (' + heureAffichee(fin) + ')',
      noms: joindreListe(liste.map(function (h) { return nomHorsDelai(h, avecDuree); }), ' et '),
    };
  }
  // UNE LIGNE DE L AGENDA (Movsar, 2026-10-13, la maquette B : « la B, mais
  // plus travaille, mieux fait et toujours moins IA »). L heure se lit dans la
  // colonne des heures, puis le titre et son detail. Une activite a heure fixe
  // porte sa duree (--m, en minutes) : la hauteur de son bloc en vient. Ni
  // icone ni puce : l heure, la place et la couleur disent ce qu est la ligne.
  function etapeVisite(o) {
    var genres = [].concat(o.genre || []).map(function (g) { return ' fg-visit__step--' + g; }).join('');
    return '<li class="fg-visit__step' + genres + (o.bouge ? ' is-moved' : '') + '"' + (o.minutes > 0 ? ' style="--m:' + Math.round(o.minutes) + '"' : '') + '><b>' + esc(o.heure || '') + '</b>'
      + '<span>' + (o.titreHtml || esc(typoVisite(o.titre))) + '</span>'
      + '<small>' + esc(typoVisite(o.detail || '')) + '</small>' + (o.detail2 ? '<small>' + esc(typoVisite(o.detail2)) + '</small>' : '') + '</li>';
  }
  // Une heure ne quitte pas le mot qui la porte, ni « partie 1 sur 2 » ses
  // chiffres : dans un bloc etroit, « jusqu’à » restait seul en fin de ligne,
  // « 11:25 » sous lui, et « sur 2 » passait a la ligne.
  function typoVisite(s) {
    return typo(s).replace(/ (\d{1,2}:\d{2}|minuit)(?![\w:])/g, '\u00a0$1')
      .replace(/(parties?) (\d)/g, '$1\u00a0$2').replace(/(\d) sur (\d)/g, '$1\u00a0sur\u00a0$2');
  }
  // La teinte d un bloc, par famille, comme sur la maquette choisie : les
  // pistes au violet de la marque, l arene au violet vif, le reste au violet
  // profond.
  function teinteBloc(id) { var s = String(id || ''); return /laser/.test(s) ? 'arene' : /bowling|duck/.test(s) ? 'piste' : 'libre'; }
  // LE BLOC « VOTRE VISITE », COMPLET (Movsar, 2026-09-24 : « plus complet et
  // serieux, vraiment un truc super complet »). L arrivee et son avance sur la
  // premiere activite ; chaque partie a son heure, jusqu a la fin de son
  // dernier groupe, avec ses groupes et ses pistes ; les parties qui se placent
  // sur place ; les activites libres ; la fin ; puis le detail du prix et le
  // paiement. Tout vient de la reponse : le plan, le programme, le prix.
  function formuleChoisie() {
    return state.onglet === 'formules' ? (((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0] || null) : null;
  }
  /* --- Le petit plus : l offre d attente et « Envie d un peu plus ? » ------------ */

  // Les cartes viennent du serveur avec le creneau retenu (public-availability,
  // `complements`) : il n y met que ce qu il a juge faisable a ces heures-la,
  // chiffre par le meme calcul que la reservation. Deux besoins, deux places
  // (Movsar, 2026-09-28 : « place au bon moment, ou ca fait pas chiant »).
  // TOUTES LES OFFRES DANS LA FENETRE DE FIN (Movsar, 2026-10-01 : « chepa
  // si c bien de mettre une add on ici [...] une belle pop up qui est bcp
  // mieux, c mieux de laisser la belle pop up uniquement, et si jamais ca
  // donne pour x personnes, ils peuvent choisir pour combien de personnes »).
  // L offre d attente (un sous-groupe attend son tour) ne s affiche plus a
  // l ecran des horaires : elle rejoint « Envie d un peu plus ? », avec le
  // nombre de personnes a choisir. Une seule offre d attente a la fois.
  var plus = { enCours: '', refuses: {}, statut: null, annuler: null, personnes: {}, devis: {}, demandes: {}, vedette: '', vedetteSig: '', acceptees: {} };
  // CE QUE LA FENETRE FAIT VRAIMENT (Movsar, 2026-10-07 : « tout repertorie
  // dans les stats, qui a pris les add-on, les raisons [...] pour savoir les
  // raisons qui font le plus prendre un add-on »). Chaque geste part avec la
  // carte qu il touche : sa raison, sa place, sa remise prouvee, son montant.
  // Rien de personnel : la visite est un identifiant tire au hasard pour cette
  // page, jamais relie a un nom. Une statistique perdue ne gene jamais le
  // client : envoi groupe, sans attente, erreur ignoree.
  var VISITE = (function () {
    try { var a = new Uint8Array(12); window.crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
    catch (e) { return ''; }
  })();
  var gestes = [], gestesMinuteur = 0;
  function suivre(evenement, c, extra) {
    if (!VISITE) return;
    var g = { evenement: evenement };
    if (c) {
      var r = remiseDuPlus(c);
      g.carte = String(c.id); g.genre = String(c.kind || ''); g.activite = String((c.patch && c.patch.activityId) || '');
      g.raison = String((c.raison && c.raison.code) || ''); g.priorite = Number(c.priorite) || 0;
      g.montant = montantDe(c); g.personnes = c.kind === 'formule' ? 0 : personnesDe(c);
      if (r) g.promo = r.pourcent;
    }
    Object.keys(extra || {}).forEach(function (k) { g[k] = extra[k]; });
    gestes.push(g);
    clearTimeout(gestesMinuteur);
    gestesMinuteur = setTimeout(envoyerGestes, 800);
  }
  function envoyerGestes() {
    clearTimeout(gestesMinuteur);
    while (gestes.length) {
      var corps = JSON.stringify({ kind: 'vitrine', centerId: CENTER, visite: VISITE, gestes: gestes.splice(0, 20) });
      var parti = false;
      try { parti = Boolean(navigator.sendBeacon && navigator.sendBeacon('/api/public-booking-meta', new Blob([corps], { type: 'application/json' }))); } catch (e) { parti = false; }
      if (!parti) fetch('/api/public-booking-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, keepalive: true, credentials: 'omit' }).catch(function () {});
    }
  }
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') envoyerGestes(); });
  function cartesPlus() {
    var rep = state.creneau ? state.creneau.reponse : null;
    return ((rep && rep.complements) || []).filter(function (c) {
      if (!c || !c.id || plus.refuses[c.id]) return false;
      if (c.kind !== 'formule' && bornesDuPlus(c).max < bornesDuPlus(c).min) return false;
      if (c.kind === 'attente') return Boolean(c.patch && c.patch.activityId) && state.onglet !== 'formules' && !state.attente;
      return c.kind === 'formule' ? Boolean(c.formuleId) && state.onglet === 'formules' : Boolean(c.patch && c.patch.activityId) && state.onglet !== 'formules';
    });
  }
  // Ceux qui attendent, et combien le client en inscrit : tous par defaut,
  // jamais plus, jamais moins d un.
  function attendentDe(c) { return Math.max(1, Math.trunc(Number((c.attente || {}).personnes) || Number(c.pax) || 1)); }
  function personnesDe(c) {
    var bornes = bornesDuPlus(c), v = Math.trunc(Number(plus.personnes[c.id]) || Number(c.participants) || 0);
    return Math.min(bornes.max, Math.max(bornes.min, v > 0 ? v : bornes.max));
  }
  function bornesDuPlus(c) {
    var a = activite(c.patch && c.patch.activityId) || {}, b = c.participantBounds || {};
    var max = Math.min(state.pax, Number(b.max) || (c.kind === 'attente' ? attendentDe(c) : state.pax));
    max = Math.min(max, bornesJoueurs(a).max);
    return { min: Math.max(1, Number(b.min) || Number(a.minPax) || 1), max: Math.max(0, max) };
  }
  function devisDuPlus(c) {
    var d = plus.devis[c.id];
    return d && d.cle === cleDemande() && d.cr === state.creneau && d.participants === personnesDe(c) ? d : null;
  }
  // Le nombre de personnes pour lequel le serveur a chiffre la carte.
  function personnesInitiales(c) { return Number(c.participants) || (c.kind === 'attente' ? attendentDe(c) : state.pax); }
  function plusPret(c) {
    if (c.kind === 'formule') return true;
    var b = bornesDuPlus(c), d = devisDuPlus(c);
    return b.max >= b.min && (d ? !d.pending && !d.error : personnesDe(c) === personnesInitiales(c));
  }
  function prixParPersonneDe(c) { return Number(c.prixParPersonne) > 0 ? Number(c.prixParPersonne) : Number(c.deltaPerPax) || 0; }
  function montantDe(c) { var d = devisDuPlus(c); return d && !d.pending && !d.error ? d.deltaTotal : c.kind === 'attente' ? Math.round(prixParPersonneDe(c) * personnesDe(c) * 100) / 100 : Number(c.deltaTotal) || 0; }
  function nomDuPlus(c) { return c.kind === 'attente' ? nomActivite(c.patch.activityId) : String(c.name || ''); }
  // Les phrases du serveur sont partagees avec le tunnel : l apostrophe y est
  // droite, celle du formulaire est typographique.
  function motsServeur(s) { return String(s || '').replace(/'/g, '’'); }
  // Le panier propose par une carte, sur une COPIE : le panier du client ne
  // change qu apres un aller-retour serveur reussi. Le serveur a derive les
  // options du catalogue (duree, palier, parties) : rien ne se devine ici.
  function copiePanier() {
    return { selection: state.selection.slice(), options: JSON.parse(JSON.stringify(state.options)), attente: state.attente, formuleId: state.formuleId };
  }
  function panierDe(carte) {
    var c = copiePanier();
    if (carte.kind === 'formule') { c.formuleId = carte.formuleId; return c; }
    var id = String(carte.patch.activityId), o = carte.patch.options || {};
    if (carte.kind === 'attente') c.attente = { activityId: id, participants: personnesDe(carte) };
    else {
      if (c.selection.indexOf(id) < 0) c.selection.push(id);
      var reglage = {};
      ['duration', 'games', 'minutes', 'units', 'hours', 'cards'].forEach(function (k) { if (o[k] !== undefined && !(k === 'games' && o.extraLaser)) reglage[k] = Number(o[k]); });
      ['arcadeMode', 'arcadeOfferId'].forEach(function (k) { if (o[k] !== undefined) reglage[k] = String(o[k]); });
      if (o.extraLaser) reglage.extraLaser = Object.assign({}, o.extraLaser, { participants: personnesDe(carte) });
      else {
        reglage.participants = personnesDe(carte);
        if (o.upsell) reglage.upsell = Object.assign({}, o.upsell, { participants: personnesDe(carte) });
      }
      c.options[id] = Object.assign({}, c.options[id] || {}, reglage);
    }
    // L offre d attente suit le panier : sa cle devient la demande du panier
    // propose, sinon ajouter une activite la ferait tomber.
    if (c.attente) c.attente = Object.assign({}, c.attente, { cle: avecPanier(c, cleBase) });
    return c;
  }
  function avecPanier(c, fn) {
    var avant = copiePanier();
    state.selection = c.selection; state.options = c.options; state.attente = c.attente; state.formuleId = c.formuleId;
    try { return fn(); } finally { state.selection = avant.selection; state.options = avant.options; state.attente = avant.attente; state.formuleId = avant.formuleId; }
  }
  // LA VISITE NE BOUGE PAS : meme heure de debut, memes pistes, memes heures
  // posees ; et jamais plus cher que ce que la carte annoncait (un tarif change
  // dans la console entre-temps). Sinon la carte se retire et dit pourquoi, le
  // panier reste celui du client. Meme loi que le tunnel.
  function refusDuPlus(j, cr, carte) {
    if (!j || j.ok === false) return (j && j.message) || 'Cette option n’est plus disponible.';
    var slot = (j.slots || [])[0];
    if (!slot || slot.time !== cr.slot.time) return 'Cette option déplacerait vos horaires.';
    if (JSON.stringify(slot.lanes || []) !== JSON.stringify(cr.slot.lanes || [])) return 'Cette option déplacerait vos pistes.';
    var avant = (cr.slot.opsPlan && cr.slot.opsPlan.anchorPlan && cr.slot.opsPlan.anchorPlan.times) || {};
    var apres = (slot.opsPlan && slot.opsPlan.anchorPlan && slot.opsPlan.anchorPlan.times) || {};
    if (Object.keys(avant).some(function (k) { return avant[k] && apres[k] !== avant[k]; })) return 'Cette option déplacerait vos horaires.';
    if (carte) {
      var ecart = Math.round(((Number(slot.price != null ? slot.price : j.price) || 0) - (Number(cr.reponse.price) || 0)) * 100) / 100;
      if (ecart > (Number(carte.deltaTotal) || 0) + 0.001) return 'Le tarif de cette option vient de changer.';
      // UNE OFFRE D ATTENTE N EST ACQUISE QUE POSEE PAR LE SERVEUR : sa ligne
      // revient marquee, au tarif d attente. Sinon (le groupe ne tourne plus,
      // l offre a quitte le centre), la carte se retire : jamais « Ajout
      // confirmé » sur une ligne que le serveur n a pas faite.
      if (carte.kind === 'attente' && !(((j.program && j.program.items) || []).some(function (it) { return it.waitOffer === true && it.activityId === carte.patch.activityId; }))) return 'Cette offre n’est plus disponible.';
      if (carte.kind === 'configured') {
        var offert = ((j.program && j.program.items) || []).filter(function (it) { return it.activityId === carte.patch.activityId; })[0];
        var contrat = offert && (offert.extraLaser || offert.upsell);
        if (!contrat || contrat.offerId !== carte.offerId || Number(contrat.participants) !== personnesDe(carte)) return 'Cette offre n’est plus disponible.';
      }
    }
    return '';
  }
  function changerPanier(c, carte, ecran, texteOk) {
    var cr = state.creneau;
    if (!cr || plus.enCours) return;
    plus.enCours = carte ? carte.id : 'retour';
    var cleAvant = cleDemande();
    var url = avecPanier(c, urlDispo);
    plus.statut = { ecran: ecran, texte: 'Vérification…', ton: 'busy' };
    rendrePlus(ecran, false);
    // Borne comme toute lecture : sans elle, une reponse qui ne vient pas
    // laissait « Vérification… » et tous les « Ajouter » eteints pour toujours.
    lire(url, { headers: enteteBlocage() })
      .then(function (rep) {
        var j = lu(rep), texte = rep.texte;
        if (!j) throw new Error('illisible');
        plus.enCours = '';
        // La reponse ne sert que si rien n a bouge pendant l aller-retour.
        if (state.creneau !== cr || cleDemande() !== cleAvant) return;
        var refus = refusDuPlus(j, cr, carte);
        // LES HORAIRES BLOQUES SUIVENT LE PANIER : au recapitulatif, le
        // nouveau panier (une partie de laser de plus, une activite) est
        // retenu AVANT de devenir celui du client. Pris entre-temps, l ajout
        // est refuse et le panier ne bouge pas ; une panne technique ne
        // retient rien de plus et laisse faire, la confirmation reverifie.
        if (!refus && ecran === 'recap' && blocage.etat === 'tenu') {
          var neuf = avecPanier(c, function () {
            var cr0 = state.creneau;
            state.creneau = creneauAvecDevis(j.slots[0], j);
            try { return { corps: corpsBlocage(), cle: cleBlocage() }; } finally { state.creneau = cr0; }
          });
          plus.enCours = carte ? carte.id : 'retour';
          retenir(neuf.corps, neuf.cle).then(function (r) {
            plus.enCours = '';
            if (state.creneau !== cr || cleDemande() !== cleAvant) return;
            if (r.pris || r.refus || r.prixChange) {
              if (carte) plus.refuses[carte.id] = 1;
              plus.statut = { ecran: ecran, texte: carte ? 'Cette option n’est plus disponible sur vos horaires.' : 'Ce changement n’est plus possible sur vos horaires.', ton: 'ko' };
            } else appliquerPanier(c, carte, ecran, texteOk, j, cr, texte);
            rendrePlus(ecran, true);
          });
          return;
        }
        if (refus) {
          if (carte) plus.refuses[carte.id] = 1;
          plus.statut = { ecran: ecran, texte: refus, ton: 'ko' };
        } else appliquerPanier(c, carte, ecran, texteOk, j, cr, texte);
        rendrePlus(ecran, true);
      })
      .catch(function () {
        plus.enCours = '';
        if (state.creneau !== cr) return;
        plus.statut = { ecran: ecran, texte: 'La vérification n’a pas abouti. Réessayez dans un instant.', ton: 'ko' };
        rendrePlus(ecran, true);
      });
  }
  // Le panier propose devient celui du client, avec le creneau que le
  // serveur vient de rendre.
  function appliquerPanier(c, carte, ecran, texteOk, j, cr, texte) {
    var avant = copiePanier();
    state.selection = c.selection; state.options = c.options; state.attente = c.attente; state.formuleId = c.formuleId;
    var slot = j.slots[0];
    state.dispo = j; state.dispoCle = cleDemande(); state.dispoTexte = texte;
    state.creneau = creneauAvecDevis(slot, j);
    state.heure = slot.time;
    plus.annuler = carte ? { panier: avant, nom: nomDuPlus(carte), ecran: ecran, carte: carte } : null;
    if (carte) { plus.acceptees[carte.id] = carte; suivre('acceptee', carte); }
    // Le montant dit est celui que le serveur vient d appliquer, jamais
    // celui de la carte : les deux ne different que si un tarif a baisse
    // entre-temps, et la phrase reste vraie.
    plus.statut = { ecran: ecran, texte: carte ? texteAjout(carte, Math.round(((Number(state.creneau.reponse.price) || 0) - (Number(cr.reponse.price) || 0)) * 100) / 100) : texteOk, ton: 'ok' };
  }
  // Pendant l aller-retour, rien ne se redessine : la phrase change sur place
  // et les boutons se taisent. A la reponse, l ecran se redessine (prix, plan,
  // recapitulatif), le focus revient sur le bloc et la phrase est dite.
  function rendrePlus(ecran, fini) {
    if (!fini) {
      var zoneS = $('[data-plus-statut="' + ecran + '"]');
      if (zoneS) { zoneS.textContent = plus.statut ? plus.statut.texte : ''; zoneS.dataset.ton = plus.statut ? plus.statut.ton : ''; }
      if (ecran === 'recap' && vitrineOuverte()) { vitrineStatut.textContent = plus.statut ? plus.statut.texte : ''; vitrineStatut.dataset.ton = plus.statut ? plus.statut.ton : ''; }
      $$('[data-plus], [data-plus-annuler], [data-plus-retirer]').forEach(function (b) { b.disabled = true; });
      return;
    }
    if (sceneCourante === 'recap' && ecran === 'recap') rendreRecap(true);
    else if (sceneCourante === 'heures' && ecran === 'heures') rendreHeures();
    else return;
    // LA FENETRE DES OFFRES : un ajout reussi la ferme, et le recapitulatif
    // dit ce qui a ete ajoute, avec « Annuler » ; un refus la garde ouverte,
    // sans la carte refusee, et la phrase dit pourquoi.
    var montre = false;
    if (ecran === 'recap' && vitrineOuverte()) {
      if (!plus.statut || plus.statut.ton !== 'ok') { rendreVitrine(true); vitrinePanneau.focus({ preventScroll: true }); return; }
      fermerVitrine(false);
      montre = true;
    }
    var bloc = $('#plus-' + ecran);
    if (bloc) { bloc.focus({ preventScroll: true }); if (montre) montrer(bloc); }
    if (plus.statut) dire(plus.statut.texte);
  }
  // Des tournures sans accord : « Formule 5 » est feminin, « Laser Game »
  // masculin, la phrase ne choisit pas. Le palier du laser se dit (2 parties
  // au lieu de 1), une activite nouvelle se dit par son nom seul.
  function texteAjout(c, montant) {
    if (c.kind === 'attente') {
      var n = personnesDe(c), tous = attendentDe(c);
      return 'Ajout confirmé : ' + nomDuPlus(c) + (n === tous ? ' pour les ' + n + ' personnes qui attendent' : ' pour ' + n + ' personne' + (n > 1 ? 's' : '') + ' pendant l’attente') + ', +' + euros(montant) + '.';
    }
    return 'Ajout confirmé : ' + nomDuPlus(c) + (c.kind !== 'formule' ? ', ' + personnesDe(c) + ' participant' + (personnesDe(c) > 1 ? 's' : '') : '') + ', +' + euros(montant) + '.';
  }
  function statutPlus(ecran) {
    var s = plus.statut && plus.statut.ecran === ecran ? plus.statut : null;
    var annulable = Boolean(s && s.ton === 'ok' && plus.annuler && plus.annuler.ecran === ecran);
    return '<p class="fg-plus__statut" data-plus-statut="' + ecran + '" data-ton="' + (s ? s.ton : '') + '">' + (s ? esc(s.texte) : '')
      + (annulable ? ' <button type="button" class="fg-plus__annuler" data-plus-annuler>Annuler</button>' : '') + '</p>';
  }
  // AU RECAPITULATIF, juste avant de valider : les offres vivent dans leur
  // fenetre (plus bas) ; le recapitulatif garde de quoi la rouvrir, et la
  // phrase d un ajout avec son « Annuler ».
  function htmlPlusRecap() {
    var cartes = cartesPlus();
    var s = plus.statut && plus.statut.ecran === 'recap' ? plus.statut : null;
    if (!cartes.length && !s) return '';
    return '<div class="fg-plus" id="plus-recap" tabindex="-1">'
      + (cartes.length ? '<p class="fg-plus__head"><b>Envie d’un peu plus&nbsp;?</b> <small>Vos horaires ne bougent pas.</small></p>'
        + '<button type="button" class="fg-plus__voir" data-vitrine-ouvrir>' + (cartes.length > 1 ? 'Voir les ' + cartes.length + ' options' : 'Voir l’option') + '<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>' : '')
      + statutPlus('recap') + '</div>';
  }
  function surPlus(e, ecran) {
    var retry = e.target.closest('[data-plus-requote]');
    if (retry) { var rcarte = cartesPlus().filter(function (c) { return c.id === retry.dataset.plusRequote; })[0]; if (rcarte && !plus.enCours) chiffrerDuPlus(rcarte); return true; }
    var b = e.target.closest('[data-plus]');
    if (b) {
      var carte = cartesPlus().filter(function (c) { return c.id === b.dataset.plus; })[0];
      if (carte && plusPret(carte)) changerPanier(panierDe(carte), Object.assign({}, carte, { deltaTotal: montantDe(carte) }), ecran, '');
      return true;
    }
    if (e.target.closest('[data-plus-annuler]')) {
      if (plus.annuler && plus.annuler.carte) { delete plus.acceptees[plus.annuler.carte.id]; suivre('annulee', plus.annuler.carte); }
      if (plus.annuler) changerPanier(plus.annuler.panier, null, ecran, 'Annulé : votre visite revient à ce qu’elle était, sans ' + plus.annuler.nom + '.');
      return true;
    }
    if (e.target.closest('[data-plus-retirer]')) {
      var c = copiePanier();
      c.attente = null;
      changerPanier(c, null, ecran, 'Offre retirée : les personnes qui attendent n’ont plus d’activité réservée.');
      return true;
    }
    return false;
  }

  function rendreVisite() {
    var zone = $('#planZone');
    if (!zone) return;
    var d = state.dispo || {};
    var cr = state.creneau;
    if (!cr) {
      // UN JOUR SANS ISSUE N EST PLUS UNE IMPASSE. Avec des heures posees,
      // ce sont elles qui coincent : une seule sortie, rendre la main a
      // l equipe. Sans heure posee, c est le jour, le groupe ou le programme :
      // on y retourne d un toucher (le fil des etapes, lui, est loin en haut).
      var aPose = Object.keys(state.pins).length > 0 || state.laserParts.length > 0 || Boolean(state.arrivee);
      var msgNotice = d.message || (aPose ? 'Avec les heures choisies, la visite ne tient pas.' : 'Aucun horaire possible ce jour-là pour votre visite.');
      var html = '<div class="fg-notice fg-notice--warn"><b>' + esc(msgNotice) + '</b>';
      var sugg = Array.isArray(d.suggestions) ? d.suggestions.slice(0, 4) : [];
      var propos = [];
      if (sugg.length) {
        html += '<span class="fg-suggest">' + sugg.map(function (s, i) {
          var times = s.times || {};
          var texte = s.label || Object.keys(times).map(function (k) { return nomActivite(k) + ' ' + times[k]; }).join(' · ');
          propos.push(texte);
          return '<button type="button" class="fg-suggest__btn" data-suggest="' + esc(JSON.stringify(times)) + '" style="--i:' + i + '">' + esc(texte) + '</button>';
        }).join('') + '</span>';
      }
      // Une heure d arrivee refusee : la suivante qui tient, que le serveur donne.
      var versA = state.arrivee && d.arrival ? d.arrival.nextAcceptableTime || d.arrival.firstAcceptableTime || '' : '';
      if (versA) {
        propos.push('arriver à ' + versA);
        html += '<span class="fg-suggest"><button type="button" class="fg-suggest__btn" data-arrivee-vers="' + esc(versA) + '">Arriver à ' + esc(versA) + '</button></span>';
      }
      html += '<span class="fg-suggest">' + (aPose
        ? '<button type="button" class="fg-suggest__btn" data-reset-tout>Laisser l’équipe tout placer</button>'
        : '<button type="button" class="fg-suggest__btn" data-goto="date">Changer de jour ou de groupe</button><button type="button" class="fg-suggest__btn" data-goto="activites">' + (state.onglet === 'formules' ? 'Changer de formule' : 'Changer d’activités') + '</button>') + '</span>';
      zone.innerHTML = html + '</div>';
      if (sceneCourante === 'heures') dire(msgNotice + (propos.length ? ' Autres horaires proposés : ' + propos.join(' ; ') + '.' : ''));
      hourSum.textContent = '';
      posterHauteur();
      return;
    }
    var slot = cr.slot, rep = cr.reponse, plan = slot.opsPlan || {};
    var parts = partiesDuPlan(cr);
    var planifies = {};
    parts.forEach(function (p) { planifies[p.id] = 1; });
    var items = (rep.program && rep.program.items) || [];
    // UNE FORMULE N A PAS DE PROGRAMME : ce qu elle contient se lit dans les
    // ancres du serveur, ses parties de laser, ses activites libres, ses
    // boissons. Sans elles, l ecran des heures d une Formule 4 ne montrait que
    // le bowling et la 1re partie de laser (Movsar, 2026-09-28 : « les
    // formules, y a pas tous les details des activites quand on est dans le
    // choix des heures »). Une formule a la periode (Kids Fun Day, Matin
    // Malin) se joue en illimite jusqu a la fin de sa periode, au meme prix
    // quelle que soit l heure d arrivee (sa reponse a la question posee).
    var formule = formuleChoisie();
    var ancrages = formule ? ancrage(d) : {};
    var illimite = Boolean(formule && formule.orderPolicy === 'open_window');
    var libres = items.filter(function (it) { return !planifies[it.activityId] && it.waitOffer !== true; });
    // LES MOTS DE LA CARTE DE LA FORMULE, chacun avec ce qu il nomme : ils
    // nomment la table d une formule anniversaire et se rangent dans la
    // visite, plus bas.
    var carte = formule ? (formule.desc || []).filter(Boolean).map(function (x) { return { texte: String(x), genre: genreCompris(x) }; }) : [];
    // Le nom d une partie : celui du programme, du catalogue, sinon les mots
    // de la carte pour ce que le public ne connait pas par son identifiant (la
    // table d une formule anniversaire s affichait « party_table »), sinon
    // celui que le plan lui donne.
    function nomDePartie(p) {
      var it = items.filter(function (x) { return x.activityId === p.id; })[0] || {};
      if (it.name) return it.name;
      if (activite(p.id)) return nomActivite(p.id);
      var mot = carte.filter(function (c) { return c.genre && c.genre === genreCompris(p.id); })[0];
      return mot ? mot.texte : (p.label || p.id);
    }
    var prix = Number(rep.price);
    var complet = !rep.program || rep.program.priceComplete !== false;
    var prixVisible = prix > 0 || (complet && items.some(function (it) { return it.priceKnown === true; }));
    // UNE VISITE FAITE SEULEMENT D ENTREES A LA JOURNEE (la plaine seule) n a
    // pas de fin a annoncer : celle du planning n est qu une estimation, et
    // l annoncer disait « 1 h » a un client qui paie la journee.
    var journee = items.length > 0 && items.every(function (it) { return it.dayAccess; });
    var fin = journee ? '' : (slot.visitEndTime || plan.endTime || '');
    var horsDelai = fin ? horsDelaiDu(slot) : [];
    var horsLibres = {};
    horsDelai.forEach(function (h) { if (!h.partie) horsLibres[h.activityId] = 1; });
    var horsParties = horsDelai.filter(function (h) { return h.partie && h.sansHeure; }).map(function (h) { return String(h.partie); });
    // Le resume de la barre du bas : les heures et le prix de l en-tete de
    // « Votre visite », lus aux memes endroits de la meme reponse.
    var arrivee = arriveeDe(plan);
    var depart = arrivee || slot.time || '';
    var span = depart && fin ? '<b>' + esc(depart) + ' → ' + esc(heureAffichee(fin)) + '</b>' + (slot.visitEndsAtClose ? ' (fermeture)' : ' environ')
      : (journee && depart ? 'dès <b>' + esc(depart) + '</b>, toute la journée' : '');
    var sumAvant = $$('b', hourSum).map(function (b) { return b.textContent; });
    hourSum.innerHTML = span + (prixVisible ? (span ? '\u00a0· ' : '') + '<b>' + esc(euros(prix)) + '</b>' + '<small class="fg-bar__ind"> indicatif</small>' + (complet ? '' : ' + ' + insecable(PRIX_ACCUEIL)) : '');
    // Ce qui a change dans le resume monte a sa place, une fois. Les <b> sont
    // neufs a chaque appel (innerHTML) : la classe sur un noeud neuf suffit.
    // Resume vide avant (arrivee, erreur, combinaison refusee) : rien ne roule.
    var sumApres = $$('b', hourSum);
    sumApres.forEach(function (b, k) { if (k < sumAvant.length && b.textContent !== sumAvant[k]) b.classList.add('is-maj'); });
    var prixBouge = prix > 0 && sumApres.length > 0 && sumApres[sumApres.length - 1].classList.contains('is-maj');
    var lignes = '';
    var dits = [];
    var vus = {};
    var premiere = parts.length ? nomDePartie(parts[0]) : '';
    // L ECHELLE DE L AGENDA : la hauteur d un bloc suit sa duree. Les minutes
    // des activites a heure fixe se comptent ici ; l echelle (--px, posee sur
    // la liste) se resserre pour une longue visite, et la feuille borne chaque
    // bloc (une hauteur mini lisible, jamais plus de 200 px).
    var minutesAgenda = 0;
    var finPrec = '';
    var rangLibre = 0;
    // LE TEMPS VIDE ENTRE DEUX ACTIVITES SE VOIT ET SE NOMME (Movsar,
    // 2026-10-13, l agenda) : « 20 min d attente », a sa place. Celui de la
    // frise est celui du serveur ; sans frise, c est l ecart des deux heures du
    // plan. A partir de 10 min : en dessous, c est le passage d une activite a
    // l autre, et l arrivee en garde le compte (« d attente en tout »).
    // LE TEMPS LIBRE QUI SE REMPLIT (Movsar, meme jour : « des pop up adaptées
    // en fonction du temps libre [...] si ils ont des activités à choisir sur
    // place déjà et que ça couvre tout le temps libre faut pas proposer »).
    // Une attente de la frise ou quelque chose tient devient un cadre en
    // pointille qui le propose : les arcades de la formule, une arrivee plus
    // tard. Le serveur range deja le minigolf, les boissons et les parties sur
    // place dans les trous : ce qui reste en attente, rien ne le couvre.
    function ligneAttente(minutes, s) {
      var m = Math.round(Number(minutes) || 0);
      if (m < 10) return;
      var mots = dureeExacte(m) + ' d’attente';
      var actions = s ? actionsDuTemps(s, m) : [];
      if (!actions.length) {
        lignes += '<li class="fg-visit__gap" style="--m:' + m + '">' + esc(typoVisite(mots)) + '</li>';
      } else {
        var cle = s.gapStartTime + '-' + s.gapEndTime, ouvert = libreOuvert === cle, idL = 'libre-' + (rangLibre += 1);
        lignes += '<li class="fg-visit__gap fg-visit__gap--libre' + (ouvert ? ' is-open' : '') + '" style="--m:' + m + '">'
          + '<button type="button" class="fg-libre" data-libre="' + esc(cle) + '" aria-expanded="' + ouvert + '" aria-controls="' + idL + '">'
          + '<span class="fg-libre__quoi">' + esc(typoVisite(dureeExacte(m) + ' de libre')) + '</span>'
          + '<span class="fg-libre__aide">' + esc(actions.length > 1 ? actions.length + ' idées' : 'Une idée') + '</span>'
          + '<svg class="fg-libre__chev" aria-hidden="true"><use href="#i-chevron"/></svg></button>'
          + '<div class="fg-libre__choix" id="' + idL + '"' + (ouvert ? '' : ' hidden') + '>'
          + actions.map(function (a) { return '<button type="button" class="fg-libre__action" ' + a.attr + '><b>' + esc(typoVisite(a.titre)) + '</b><small>' + esc(typoVisite(a.detail)) + '</small></button>'; }).join('')
          + '</div></li>';
      }
      minutesAgenda += Math.min(m, 40);
      dits.push(mots + (actions.length ? ' : ' + actions.map(function (a) { return a.titre; }).join(' ou ') : ''));
    }
    // CE QUI TIENT DANS UNE ATTENTE, rien d invente : les arcades de la
    // formule quand elles sont apres les activites et que l attente les tient
    // (deplacer des arcades deja dans une attente ne fait rien gagner) ;
    // l attente d avant la premiere activite, une arrivee plus tard que le
    // serveur a verifiee.
    function actionsDuTemps(s, m) {
      var liste = [];
      if (!s.gapStartTime || !parArrivee) return liste;
      var arc = arcadeDuPlan(), dureeArc = Number(arc.minutes) || 0;
      if (dureeArc && arc.placement === 'after' && m >= dureeArc) {
        liste.push({ attr: 'data-libre-arcades="' + esc(s.gapStartTime) + '"', titre: 'Y faire vos arcades', detail: 'de ' + s.gapStartTime + ' à ' + hhmm(minutesDe(s.gapStartTime) + dureeArc) + ', au lieu de ' + arc.startTime });
      }
      // L arrivee plus tard que le serveur a verifiee (`arrival.later`) : le
      // meme programme, moins d attente. Rien de devine ici.
      var tard = state.arrivee && d.arrival && d.arrival.later;
      if (s.placement === 'before' && tard && tard.time && Number(tard.savedMinutes) > 0) {
        liste.push({ attr: 'data-libre-arrivee="' + esc(tard.time) + '"', titre: 'Arriver à ' + tard.time, detail: 'même programme, ' + dureeExacte(Number(tard.savedMinutes)) + ' d’attente en moins' });
      }
      return liste;
    }
    // L arrivee choisie par le client se dit telle quelle, avec l attente que
    // son programme laisse ; sinon l arrivee conseillee et son avance.
    var parArrivee = plan.arrivalPlan || null, attenteA = parArrivee ? Number(parArrivee.waitMinutes) || 0 : 0;
    if (arrivee) {
      var avance = parts.length ? minutesEntre(arrivee, parts[0].debut) : 0;
      // L arrivee choisie que l heure d une activite a fait avancer (le dernier
      // choix gagne) : la ligne le dit.
      var avancee = !parArrivee && adaptation && adaptation.deplace === 'arrivee' && adaptation.avant ? 'au lieu de ' + adaptation.avant : '';
      lignes += etapeVisite(parArrivee ? { genre: 'in', heure: arrivee, titre: 'Arrivée', detail: typo('à votre heure' + (attenteA > 0 ? ' · ' + dureeExacte(attenteA) + ' d’attente en tout' : '')) }
        : { genre: 'in', heure: arrivee, titre: 'Arrivée conseillée', detail: [avance > 0 ? avance + ' min avant votre ' + nomBas(premiere) : 'on vous accueille', avancee].filter(Boolean).join(' · '), bouge: Boolean(avancee) });
      if (avancee) dits.push('Arrivée avancée, ' + avancee);
    }
    function lignePartie(p) {
      var it = items.filter(function (x) { return x.activityId === p.id; })[0] || {};
      var nom = nomDePartie(p);
      var total = Number(it.games) || (formule && p.id === 'laser_game' ? Number(ancrages.laserGames) || 0 : 0);
      // « partie 2 sur 3 » compte les PARTIES (countIndex), jamais les groupes
      // d une meme partie : un grand groupe joue chaque partie en plusieurs.
      var quoi = total > 1 ? 'partie ' + p.partie + ' sur ' + total : total === 1 ? '1 partie' : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) + (p.groupes.length > 1 ? ' par groupe' : '') : ''));
      // Deplacee pour une autre heure posee, ou liberee par l arrivee choisie
      // et replacee apres elle (une partie de laser gardee, elle, n a pas bouge).
      var replacee = Boolean(adaptation && adaptation.liberees && adaptation.liberees.indexOf(p.id) >= 0
        && (p.id !== 'laser_game' || state.laserParts.indexOf(p.debut) < 0));
      var bouge = Boolean(adaptation && adaptation.deplace === p.id) || replacee;
      var jeuPartie = p.id === 'laser_game' && dureeLaser() ? dureeLaser().jeu : 0;
      var detail = [participantsLigne(it), jeuPartie ? jeuPartie + ' min de jeu' : '', p.fin ? 'jusqu’à ' + heureAffichee(p.fin) + (jeuPartie ? ' avec les règles et la préparation' : '') : '', texteGroupes(p, true), p.pistes > 0 ? p.pistes + ' piste' + (p.pistes > 1 ? 's' : '') : '',
        replacee ? (adaptation.pour === 'arcade_time' ? 'replacé autour de vos arcades (' + adaptation.t + ')' : 'replacé après votre arrivée (' + adaptation.t + ')')
          : bouge ? 'déplacé pour votre ' + nomActivite(adaptation.pour) + ' à ' + adaptation.t : ''].filter(Boolean).join(' · ');
      // La frise dit ses attentes elle-meme : son ecart ne se recompte pas.
      if (!parLaFrise && finPrec) ligneAttente(minutesEntre(finPrec, p.debut));
      var duree = minutesEntre(p.debut, p.fin);
      minutesAgenda += duree;
      if (p.fin > finPrec) finPrec = p.fin;
      dits.push(nom + (quoi ? ', ' + quoi : '') + ', de ' + p.debut + (p.fin ? ' à ' + heureAffichee(p.fin) : '') + (p.groupes.length > 1 ? ', en ' + p.groupes.length + ' groupes' : '') + (bouge ? ', déplacé' : ''));
      lignes += etapeVisite({ genre: ['bloc', teinteBloc(p.id)], heure: p.debut, minutes: duree, titre: nom + (quoi ? ' · ' + quoi : ''), detail: detail, bouge: bouge });
    }
    // UNE VISITE PAR HEURE D ARRIVEE SE LIT DANS L ORDRE DE SA FRISE (2026-10-13) :
    // les arcades a leur heure, le libre fait en attendant la premiere
    // activite, puis le bowling et le laser. Les boissons et le reste du libre
    // restent avec ce que comprend la formule, plus bas. Ses attentes (kind
    // « wait ») prennent leur place dans l agenda.
    var parLaFrise = true;
    ((parArrivee && parArrivee.frise) || []).forEach(function (s) {
      if (s.kind === 'anchor') {
        var p = parts.filter(function (x) { return !x.dit && x.id === s.activityId && x.debut === s.startTime; })[0];
        if (p) { p.dit = 1; lignePartie(p); }
        return;
      }
      if (s.kind === 'wait') { ligneAttente(s.minutes, s); return; }
      if (s.kind !== 'free' || estBoisson(s.label) || !(s.timed || s.placement === 'before')) return;
      vus[genreCompris(s.activityId)] = 1;
      var m = s.timed ? minutesEntre(s.startTime, s.endTime) : 0;
      minutesAgenda += m;
      if (s.timed && s.endTime > finPrec) finPrec = s.endTime;
      // Les arcades a l heure du client, ou levees par l heure d une activite
      // posee sur elles (le dernier choix gagne) : la ligne le dit.
      var leveeA = s.activityId === 'arcade_time' && Boolean(adaptation) && (adaptation.deplace === 'arcade_time' || (adaptation.liberees || []).indexOf('arcade_time') >= 0);
      var ouA = !leveeA ? (s.chosen ? 'à votre heure' : '')
        : adaptation.deplace === 'arcade_time' ? 'déplacées pour votre ' + nomBas(nomActivite(adaptation.pour)) + ' à ' + adaptation.t
          : 'replacées après votre arrivée (' + adaptation.t + ')';
      lignes += etapeVisite(s.timed ? { genre: ['bloc', teinteBloc(s.activityId)], heure: s.startTime, minutes: m, titre: s.label, detail: 'jusqu’à ' + heureAffichee(s.endTime) + (ouA ? ' · ' + ouA : ''), bouge: leveeA }
        : { genre: ['free', 'suite'], heure: '', titre: s.label, detail: 'en attendant votre ' + nomBas(premiere) });
      dits.push(s.label + (s.timed ? ', de ' + s.startTime + ' à ' + heureAffichee(s.endTime) + (ouA ? ', ' + ouA : '') : ', en attendant votre ' + nomBas(premiere)));
    });
    parLaFrise = false;
    parts.forEach(function (p) { if (!p.dit) lignePartie(p); });
    // CE QUI N A PAS D HEURE SE RANGE SOUS « DANS LA FOULEE » (Movsar,
    // 2026-09-29 : « met "dans la foulee", pas une heure imposee, comme ca ils
    // comprennent bien ») : les parties de laser que l equipe place, les
    // activites libres d une visite, ce que comprend la carte d une formule.
    // Un titre pour le groupe, une ligne par chose, jamais une heure : dans
    // l agenda, le groupe se pose apres la derniere activite a heure, a part
    // de l axe du temps (aucune heure, aucune hauteur de duree).
    var suite = '';
    var suiteDits = [];
    function ligneSuite(o, voix) {
      suite += etapeVisite({ genre: [o.genre, 'suite'].concat(o.hors ? ['hors'] : []), heure: '', titre: o.titre, titreHtml: o.titreHtml, detail: o.detail });
      suiteDits.push(voix);
    }
    // LES PARTIES DE LASER SANS HEURE : l equipe les place sur place, et la
    // fin de la visite compte le temps qu elles prennent a la suite (Movsar,
    // meme jour : « les 2 parties de laser, ca dure 40 minutes minimum »). Ce
    // temps est celui du moteur (laserPassPlan.followOnMinutes).
    var aLaSuite = Math.max(0, Math.round(Number(plan.laserPassPlan && plan.laserPassPlan.followOnMinutes) || 0));
    parts.forEach(function (p) { vus[genreCompris(p.id)] = 1; });
    function partiesSurPlace(id, nomR, total, posees, participants) {
      // Toutes sans heure : seul le laser d une formule a bowling peut l etre.
      if (!(total >= 1) || posees >= total || (!posees && id !== 'laser_game')) return;
      var reste = [];
      for (var k = posees + 1; k <= total; k += 1) reste.push(String(k));
      var quelles = total === 1 ? '1 partie' : 'partie' + (reste.length > 1 ? 's ' : ' ') + joindreListe(reste, ' et ') + ' sur ' + total;
      var coupees = id === 'laser_game' ? reste.filter(function (k) { return horsParties.indexOf(k) >= 0; }) : [];
      var detail = (reste.length > 1 ? 'placées' : 'placée') + ' sur place avec l’équipe' + (id === 'laser_game' && aLaSuite && !participants ? ' · ' + environ(aLaSuite) : '')
        + (coupees.length ? ' · ' + (coupees.length > 1 ? 'parties ' + joindreListe(coupees, ' et ') + ' : ne tiendront pas' : 'partie ' + coupees[0] + ' : ne tiendra pas') + ' avant ' + heureAffichee(fin) : '');
      if (participants) detail = participants + ' joueur' + (participants > 1 ? 's' : '') + ' · ' + detail;
      ligneSuite({ genre: 'onsite', hors: coupees.length > 0 && coupees.length === reste.length, titre: nomR + ' · ' + quelles, detail: detail }, nomR + ', ' + quelles + ', ' + detail);
      vus[genreCompris(id)] = 1;
    }
    items.forEach(function (it) {
      partiesSurPlace(it.activityId, it.name || nomActivite(it.activityId), Number(it.games) || 0, parts.filter(function (p) { return p.id === it.activityId; }).length);
      if (it.extraLaser) partiesSurPlace(it.activityId, it.name || nomActivite(it.activityId), Number(it.extraLaser.games), Number(it.games) || 1, Number(it.extraLaser.participants));
    });
    if (formule) partiesSurPlace('laser_game', nomActivite('laser_game'), Number(ancrages.laserGames) || 0, parts.filter(function (p) { return p.id === 'laser_game'; }).length);
    // Les activites libres d une visite, a votre rythme. Une entree a la
    // journee ne dit aucune duree : ce temps-la n est pas achete.
    libres.forEach(function (it) {
      var nomL = it.name || nomActivite(it.activityId);
      var entre = it.arcadeOffer ? detailArcade(it) : it.dayAccess ? 'toute la journée' : detailSessions(it);
      var duree = !entre && !it.durationEstimated && Number(it.minutes) > 0 ? environ(it.minutes) : '';
      var tiendra = !horsLibres[it.activityId];
      var rythme = tiendra ? 'à votre rythme' : 'ne tiendra pas avant ' + heureAffichee(fin);
      ligneSuite({ genre: 'free', hors: !tiendra, titreHtml: '<i>' + esc(typoVisite(nomL + (entre ? ' (' + entre + ')' : ''))) + '</i>', detail: participantsLigne(it) + ' · ' + rythme + (duree ? ' · ' + duree : '') },
        nomL + (entre ? ' (' + entre + ')' : '') + ', ' + rythme + (duree ? ', ' + duree : ''));
    });
    // L offre d attente prise a la fenetre de fin : une ligne de la visite,
    // pour qui et pendant quoi (elle se retire a la fin, par « Annuler »).
    items.filter(function (it) { return it.waitOffer === true; }).forEach(function (it) {
      var nW = Math.max(1, Number(it.participants) || 1);
      var nomW = it.name || nomActivite(it.activityId);
      var detW = 'pendant l’attente · ' + nW + ' personne' + (nW > 1 ? 's' : '') + (Number(it.minutes) > 0 ? ' · ' + environ(it.minutes) : '');
      ligneSuite({ genre: 'free', titreHtml: '<i>' + esc(typoVisite(nomW)) + '</i>', detail: detW }, nomW + ', ' + detW);
    });
    // CE QUE COMPREND LA CARTE D UNE FORMULE, dans ses mots, c est ce que le
    // centre vend : ce qui a deja sa ligne a heure (bowling, laser, table) ne
    // se redit pas, une activite se joue a votre rythme, le reste (les
    // boissons) est compris. Une formule a volonte le dit sur sa ligne.
    if (formule && !illimite) carte.forEach(function (c) {
      if (c.genre && vus[c.genre]) return;
      if (c.genre) ligneSuite({ genre: 'incl', titre: c.texte, detail: 'compris · à votre rythme' }, c.texte + ', compris');
      else ligneSuite({ genre: 'incl', titre: c.texte, detail: 'compris' }, c.texte + ', compris');
    });
    if (suite) {
      // Pendant la table d une formule anniversaire, les activites se jouent
      // pendant la table ; sans rien a heure, des l arrivee.
      var avecTable = parts.some(function (p) { return genreCompris(p.id) === 'table'; });
      var entete = !parts.length ? 'Dès votre arrivée' : avecTable ? 'Pendant votre table' : 'Dans la foulée';
      lignes += '<li class="fg-visit__suite"><p class="fg-visit__group"><b>' + esc(entete) + '</b>, sans heure fixe</p><ul>' + suite + '</ul></li>';
      dits.push(entete + ', sans heure fixe : ' + suiteDits.join(' ; '));
    }
    // UNE FORMULE ILLIMITEE se joue a volonte jusqu a la fin de sa periode, au
    // meme prix quelle que soit l heure d arrivee : la ligne dit le temps de
    // jeu qui reste a cette heure-la (arrive a 16:30 au Kids Fun Day, 30 min),
    // puis ce que comprend sa carte, dans ses mots. Dans l agenda, c est un
    // bloc de l heure d arrivee a la fin de la periode (compresse : la feuille
    // le borne), qui dit lui-meme son debut.
    var jeuRestant = illimite && fin ? minutesEntre(slot.time, fin) : 0;
    var motsIllimite = illimite ? carte.map(function (c) { return c.texte; }) : [];
    if (illimite && jeuRestant > 0) {
      minutesAgenda += jeuRestant;
      lignes += etapeVisite({ genre: ['bloc', 'free', 'illimite'], heure: slot.time, minutes: jeuRestant, titre: formule.name, detail: 'à volonté jusqu’à ' + heureAffichee(fin) + ' · ' + dureeExacte(jeuRestant) + ' de jeu, même prix à toute heure', detail2: motsIllimite.join(' · ') });
      dits.push(formule.name + ', à partir de ' + slot.time + ', à volonté jusqu’à ' + heureAffichee(fin) + ' : ' + dureeExacte(jeuRestant) + ' de jeu, même prix à toute heure' + (motsIllimite.length ? '. Compris : ' + motsIllimite.join(', ') : ''));
    } else if (motsIllimite.length) {
      lignes += etapeVisite({ genre: ['incl', 'suite'], heure: '', titre: motsIllimite.join(' · '), detail: 'compris dans ' + formule.name });
      dits.push('Compris : ' + motsIllimite.join(', '));
    }
    var debut = !parts.length && !libres.length && !arrivee && !(illimite && jeuRestant > 0);
    if (debut) lignes = '<li class="fg-visit__step fg-visit__step--debut"><b>' + esc(slot.time) + '</b><span>Début</span><small></small></li>' + lignes;
    if (fin) lignes += etapeVisite({ genre: 'out', heure: heureAffichee(fin), titre: 'Fin de la visite', detail: slot.visitEndsAtClose ? 'fermeture du centre' : illimite ? 'fin de la formule' : 'heure estimée' });
    // LE DETAIL DU PRIX : chaque ligne du programme et son montant, ce qui se
    // regle sur place, le total. Montre seulement quand la somme des montants
    // connus EST le prix annonce : sinon, le total seul, en tete du bloc.
    var prixHtml = '';
    if (state.onglet !== 'formules' && items.length > 1 && prix > 0) {
      var connus = 0;
      var lp = items.map(function (it) {
        var sait = it.priceKnown === true || (it.priceKnown !== false && Number(it.price) > 0);
        if (sait) connus += Number(it.price) || 0;
        var det = detailLigne(it);
        return '<div><dt>' + esc(typoVisite(it.name || nomActivite(it.activityId))) + (det ? ' <small>· ' + esc(typoVisite(det)) + '</small>' : '') + '</dt><dd>' + (sait ? esc(euros(it.price)) : PRIX_ACCUEIL) + '</dd></div>';
      });
      if (Math.abs(connus - prix) < 0.01) {
        prixHtml = '<dl class="fg-visit__prices">' + lp.join('')
          // Les lignes juste au-dessus disent lesquelles : le total reste court.
          + '<div class="fg-visit__total"><dt>' + (complet ? 'Total indicatif' : 'Total indicatif, hors ' + insecable(PRIX_ACCUEIL)) + '</dt><dd>' + esc(euros(prix)) + '</dd></div></dl>'
          + '<p class="fg-visit__pay">Montants à titre indicatif. Aucun paiement en ligne : vous réglez sur place, par carte ou en espèces.</p>';
      }
    }
    // L EN-TETE : le titre et le prix sur une ligne, la plage dessous, puis ce
    // qui se regle a l accueil. Ni bandeau teinte ni icone. PLUS DE REPLI : il
    // cachait une liste de texte (2026-10-07), ouverte d office depuis le
    // 2026-10-12 ; l agenda est la visite elle-meme, replie il ne resterait que
    // l en-tete, que la barre du bas redit deja.
    var html2 = '<div class="fg-visit"><div class="fg-visit__head"><h3 class="fg-visit__title">Votre visite</h3>'
      + (prixVisible ? '<span class="fg-visit__price">' + esc(euros(prix)) + '</span>' : '')
      + (fin ? '<p class="fg-visit__span">' + (arrivee ? 'de <b>' + esc(arrivee) + '</b> ' : '') + (slot.visitEndsAtClose ? 'jusqu’à la fermeture (<b>' + esc(heureAffichee(fin)) + '</b>)' : illimite ? 'à <b>' + esc(heureAffichee(fin)) + '</b>, fin de la formule' : 'à <b>' + esc(heureAffichee(fin)) + '</b> environ') + surPlace(arrivee, fin) + '</p>'
        : (journee && depart ? '<p class="fg-visit__span">dès <b>' + esc(depart) + '</b>, accès toute la journée</p>' : ''))
      + (prixVisible && !complet ? '<p class="fg-visit__reste">+ ' + esc(typoVisite(nomsSansPrix(items))) + ', ' + insecable(PRIX_ACCUEIL) + '</p>' : '')
      + '</div>';
    // L echelle de l agenda : 1,8 px par minute (une heure de bowling fait
    // 108 px), resserree au-dela d environ 2 h 45 d activites, jamais sous
    // 1 px par minute.
    var echelle = Math.max(1, Math.min(1.8, 300 / Math.max(1, minutesAgenda)));
    // Une visite sans aucune heure (la plaine seule) n a pas de colonne des
    // heures : ses lignes reprennent toute la largeur.
    var avecHeures = Boolean(arrivee || fin || parts.length || debut || (illimite && jeuRestant > 0));
    var listeHtml = '<ol class="fg-visit__list' + (avecHeures ? '' : ' fg-visit__list--libre') + '" style="--px:' + echelle.toFixed(2) + 'px">' + lignes + '</ol>';
    var avis = (plan.comfortNotices || []).map(function (n) { return typeof n === 'string' ? n : (n && (n.message || n.label)) || ''; }).filter(Boolean);
    var secoursBowling = avertissementBowling(state.creneau);
    if (secoursBowling && avis.indexOf(secoursBowling) < 0) avis.push(secoursBowling);
    var horsHtml = '';
    if (horsDelai.length) {
      // Les heures posees ne bougent pas : elles se redisent telles quelles.
      var heuresPosees = {}, nomsPoses = [];
      parts.forEach(function (p) {
        var n = nomDePartie(p);
        if (!heuresPosees[n]) { heuresPosees[n] = []; nomsPoses.push(n); }
        if (heuresPosees[n].indexOf(p.debut) < 0) heuresPosees[n].push(p.debut);
      });
      var fixes = nomsPoses.map(function (n) { return n + ' à ' + joindreListe(heuresPosees[n], ' et '); });
      var gardees = fixes.length ? (fixes.length > 1 ? 'Vos heures ne bougent pas : ' : 'Votre heure ne bouge pas : ') + joindreListe(fixes, ' et ') + '.' : '';
      // Un montant connu reste dans le total indicatif : il se dit.
      var comptees = horsDelai.filter(function (h) { return !h.partie; }).map(function (h) { return items.filter(function (it) { return it.activityId === h.activityId; })[0]; })
        .filter(function (it) { return it && it.priceKnown === true && Number(it.price) > 0; });
      var compte = comptees.length ? 'Le total indicatif compte encore ' + joindreListe(comptees.map(function (it) { return (it.name || nomActivite(it.activityId)) + ' (' + euros(it.price) + ')'; }), ' et ') + '.' : '';
      var phrase = phraseHorsDelai(horsDelai, fin, true);
      horsHtml = '<p class="fg-visit__warn fg-visit__hors"><b>' + esc(typoVisite(phrase.tete)) + '\u00a0:</b> ' + esc(typoVisite(phrase.noms)) + '.'
        + (gardees || compte ? '<br>' + esc(typoVisite([gardees, compte].filter(Boolean).join(' '))) : '') + '</p>';
      avis.unshift([phrase.tete + ' : ' + phrase.noms + '.', gardees, compte].filter(Boolean).join(' '));
    } else if (slot.visitEndsAtClose && Number(slot.visitShortfallMinutes) > 0) {
      avis.unshift('À cette heure, tout ne tiendra pas avant la fermeture : il manque ' + dureeApprox(slot.visitShortfallMinutes) + '. Vous choisirez sur place ce que vous gardez.');
    }
    var avisSimples = horsHtml ? avis.slice(1) : avis;
    // Ce qui ne tiendra pas reste visible sous l en-tete, juste avant l agenda
    // qui porte les lignes qu il raye.
    html2 += horsHtml;
    if (avisSimples.length) html2 += '<p class="fg-visit__warn">' + avisSimples.map(function (a) { return esc(typoVisite(a)); }).join('<br>') + '</p>';
    html2 += listeHtml + prixHtml;
    // Ce que dit la voix est ce qui est ecrit dans le bloc : l arrivee, chaque
    // partie a son heure et sa fin, ce qui se joue dans la foulee, la fin, le
    // prix (et ce qui se regle sur place), les avertissements.
    if (sceneCourante === 'heures') dire(('Votre visite. '
      + (arrivee ? (parArrivee ? 'Arrivée à ' : 'Arrivée conseillée à ') + arrivee + '. ' : '')
      + (dits.length ? dits.join('. ') + '. ' : (arrivee ? '' : 'Début à ' + slot.time + '. '))
      + (fin ? (slot.visitEndsAtClose ? 'Jusqu’à la fermeture à ' : illimite ? 'Fin de la formule à ' : 'Fin vers ') + heureAffichee(fin) + '. ' : (journee ? 'Accès toute la journée. ' : ''))
      + (prixVisible ? euros(prix) + (complet ? '' : ', plus ' + nomsSansPrix(items) + ', ' + PRIX_ACCUEIL) + '. ' : '')
      + avis.join(' ')).trim());
    zone.innerHTML = html2 + '</div>';
    if (prixBouge) $('.fg-visit__price', zone).classList.add('is-maj');
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    // « Reessayer » apres une panne : le meme calcul, avec le meme etat. Le
    // focus passe au titre avant que le bouton ne disparaisse.
    if (e.target.closest('[data-retry]')) { $('#t-hour').focus({ preventScroll: true }); chargerHeures(); return; }
    // Toutes les poses levees d un coup : le meme geste que « revenir a
    // l heure proposee » d une piste, etendu a toutes. Sans heure posee, le
    // serveur compose sa combinaison par defaut, ou dit qu il n y en a pas.
    if (e.target.closest('[data-reset-tout]')) { state.pins = {}; state.laserParts = []; state.arrivee = ''; state.arcade = ''; adaptation = null; $$('.fg-track', hourZone).forEach(function (t) { delete t.dataset.touched; }); chargerPlan(); return; }
    var versA = e.target.closest('[data-arrivee-vers]');
    if (versA) { choisirArrivee(versA.dataset.arriveeVers); return; }
    // LE TEMPS LIBRE (2026-10-13) : le cadre se deplie sur place, sans rien
    // redessiner ; ce qu il propose se pose comme une heure choisie.
    var cadre = e.target.closest('[data-libre]');
    if (cadre) {
      var li = cadre.closest('.fg-visit__gap--libre'), ouvrir = cadre.getAttribute('aria-expanded') !== 'true';
      libreOuvert = ouvrir ? cadre.dataset.libre : '';
      $$('.fg-visit__gap--libre', hourZone).forEach(function (autre) {
        var b = $('[data-libre]', autre), ici = autre === li && ouvrir;
        autre.classList.toggle('is-open', ici);
        if (b) b.setAttribute('aria-expanded', String(ici));
        var choix = $('.fg-libre__choix', autre);
        if (choix) choix.hidden = !ici;
      });
      posterHauteur();
      return;
    }
    var versArcades = e.target.closest('[data-libre-arcades]');
    if (versArcades) { libreOuvert = ''; adaptation = null; state.arcade = versArcades.dataset.libreArcades; chargerPlan(); return; }
    var plusTard = e.target.closest('[data-libre-arrivee]');
    if (plusTard) { libreOuvert = ''; choisirArrivee(plusTard.dataset.libreArrivee); return; }
    var s = e.target.closest('[data-suggest]');
    if (!s) return;
    try {
      var times = JSON.parse(s.dataset.suggest);
      state.pins = {}; state.laserParts = []; adaptation = null;
      Object.keys(times).forEach(function (k) { if (times[k]) state.pins[k] = String(times[k]).slice(0, 5); });
      // Un laser de plusieurs parties tient ses heures dans laserParts (le
      // rang « partie 1 », le cadre des parties, l envoi) : l heure suggeree
      // y entre comme sa premiere partie.
      var pisteLaser = $('.fg-track[data-activity="laser_game"]', hourZone);
      if (state.pins.laser_game && pisteLaser && Number(pisteLaser.dataset.count) > 1) state.laserParts = [state.pins.laser_game];
      chargerPlan();
    } catch (err) { /* suggestion illisible : rien */ }
  });
  // A l ecran des coordonnees, le recapitulatif ENTIER (htmlRecap). Sur
  // telephone il se replie sous sa ligne de resume, pour que le formulaire
  // reste en tete ; sur ordinateur il est ouvert a cote, sans bouton.
  var recall = $('#recall'), recallToggle = $('#recallToggle');
  function basculerRappel(ouvrir) {
    recall.classList.toggle('is-open', ouvrir);
    recallToggle.setAttribute('aria-expanded', String(ouvrir));
    $('span', recallToggle).textContent = ouvrir ? 'Masquer le détail' : 'Voir le détail';
  }
  recallToggle.addEventListener('click', function () {
    basculerRappel(recallToggle.getAttribute('aria-expanded') !== 'true');
    posterHauteur();
  });
  function versLeContact() {
    $('#recallLine').textContent = insecable(jourCourt(state.date)) + '\u00a0· ' + insecable(groupeLisible()) + '\u00a0· ' + (arriveeDe(state.creneau.slot.opsPlan) ? 'arrivée ' + arriveeDe(state.creneau.slot.opsPlan) : state.heure);
    $('#recallBody').innerHTML = htmlRecap(false);
    basculerRappel(false);
    rendreBlocage();
    aller('contact');
  }
  function garderHoraires() {
    if (goContact.disabled || !state.creneau || goContact.classList.contains('is-busy')) return;
    // Un recalcul en route : le toucher attend sa reponse, le bouton travaille.
    if (planEnCours) { contactRetenu = true; occuper(goContact, true); return; }
    var cle = cleBlocage();
    // Le meme choix, encore bloque (retour arriere, puis Continuer) : le
    // decompte continue, il ne repart pas. Dix minutes par choix, pas plus.
    if (blocage.etat === 'tenu' && blocage.cle === cle && blocage.echeance > Date.now()) { versLeContact(); return; }
    goContact.classList.add('is-busy'); goContact.setAttribute('aria-busy', 'true');
    retenir(corpsBlocage(), cle).then(function (r) {
      goContact.classList.remove('is-busy'); goContact.removeAttribute('aria-busy');
      // Le client a change son choix pendant l aller-retour : ce verdict ne
      // vaut plus, son prochain « Continuer » demandera le sien.
      if (sceneCourante !== 'heures' || cle !== cleBlocage()) return;
      if (r.prixChange) { actualiserDevis(r.devis); signaturePistes = ''; rendreHeures(); refuserHoraires('<b>Le montant a changé.</b> Vérifiez le nouveau montant, puis continuez à nouveau.'); return; }
      if (r.pris) { horairesPris(r.message); return; }
      if (r.refus) {
        if (r.code === 'custom_request_required' && meta && meta.center && r.fromPax) meta.center.customRequest = { fromPax: Number(r.fromPax) };
        refuserHoraires('<b>' + esc(r.message || 'Ces horaires ne peuvent pas être réservés en ligne.') + '</b>');
        return;
      }
      versLeContact();
    });
  }
  goContact.addEventListener('click', garderHoraires);

  /* --- Les horaires bloques pendant que le client finit ------------------------- */

  // LES HORAIRES CHOISIS SONT BLOQUES POUR LE CLIENT (Movsar, 2026-09-29 :
  // « ca montre que les horaires choisis sont bloques pour lui pendant 10
  // minutes max, et ca bloque vraiment [...] si 3 personnes sont sur la meme
  // page au meme moment »). « Ces horaires me vont » demande au serveur de les
  // retenir (POST /api/public-holds) : pistes, arene et installations comptent
  // alors pour tous les autres clients, et pour l equipe. Un decompte le dit
  // sur les coordonnees et le recapitulatif ; a zero, rien n est plus garanti
  // et un bouton les redemande. La confirmation porte le jeton : le blocage
  // devient la reservation, dans la meme transaction.
  // Un echec technique (reseau, serveur, plafond de l appareil) ne retient rien
  // et laisse avancer : la confirmation reverifie tout, comme avant. Tout passe
  // par une file : jamais deux demandes de cet ecran en meme temps.
  var blocage = { version: 0, jeton: '', cle: '', echeance: 0, total: 0, etat: '', message: '', minuteur: 0, prevenu: false, file: Promise.resolve() };
  var bandeaux = $$('[data-hold]'), hourErr = $('#hourErr');
  function enteteBlocage() { return blocage.jeton ? { 'X-Pinlane-Hold': blocage.jeton } : {}; }
  // Ce que le client a choisi : sa demande, puis ses heures.
  function cleChoix() { return cleDemande() + '|' + JSON.stringify(state.pins) + '|' + JSON.stringify(state.laserParts) + (state.arrivee ? '|' + state.arrivee + (state.arcade ? '|' + state.arcade : '') : ''); }
  function cleBlocage() { return cleChoix() + '|' + (state.heure || ''); }
  // Le corps de la reservation, sans les coordonnees : un blocage n a ni nom,
  // ni telephone, ni e-mail.
  function corpsBlocage() {
    var p = payload();
    ['name', 'phone', 'email', 'notes', 'occasion'].forEach(function (k) { delete p[k]; });
    return p;
  }
  function enFile(fn) {
    var suite = blocage.file.then(fn, fn);
    blocage.file = suite.then(function () {}, function () {});
    return suite;
  }
  function heureLocale(ms) { var d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function decompte(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  // UN BLOCAGE QUI TRAINE NE RETIENT PAS LE CLIENT (2026-10-12). Sur un reseau
  // qui cale, « Ces horaires me vont » tournait sans fin (sonde : 14 s, la
  // roue toujours la). Passe DELAI_BLOCAGE, le client avance sans blocage,
  // comme apres toute panne technique : la confirmation reverifie tout, et la
  // file se libere (la confirmation n attend plus ce blocage). La demande
  // n est pas coupee : un blocage qui arrive apres coup pour un premier choix
  // est rendu aussitot. Garde, il tiendrait dix minutes une place que plus
  // personne n attend, et la confirmation du client lui-meme s y heurterait.
  var DELAI_BLOCAGE = 8000;
  function retenir(corps, cle) {
    var version = blocage.version;
    return enFile(function () {
      var ticket = { abandonne: false };
      return new Promise(function (resolve) {
        var minuteur = setTimeout(function () {
          ticket.abandonne = true;
          if (version !== blocage.version) { resolve({ obsolete: true }); return; }
          arreterDecompte();
          resolve({ sans: true });
        }, DELAI_BLOCAGE);
        demanderBlocage(corps, cle, 1, version, ticket).then(function (r) { clearTimeout(minuteur); resolve(r); });
      });
    });
  }
  function demanderBlocage(corps, cle, essais, version, ticket) {
    if (version !== blocage.version) return Promise.resolve({ obsolete: true });
    var avaitJeton = Boolean(blocage.jeton);
    if (blocage.jeton) corps.holdToken = blocage.jeton;
    corps.acquisition = ACQUISITION;
    var abandonne = function () { return version !== blocage.version || Boolean(ticket && ticket.abandonne); };
    return fetch('/api/public-holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (x) { return { statut: r.status, json: x || {} }; }); })
      .then(function (res) {
        var x = res.json;
        // Le groupe ou le panier a changé pendant le réseau : rendre la place
        // obtenue pour l'ancien choix, sans remplacer le blocage courant. De
        // meme pour un premier choix arrive apres le delai (le client est
        // passe sans lui) ; le jeton que le client garde, lui, reste le sien.
        if (abandonne()) {
          if (res.statut === 201 && x.holdToken && (version !== blocage.version || !avaitJeton)) {
            return fetch('/api/public-holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: true, holdToken: x.holdToken }), credentials: 'omit', keepalive: true })
              .catch(function () {}).then(function () { return { obsolete: true }; });
          }
          return { obsolete: true };
        }
        if (res.statut === 201 && x.ok !== false && x.holdToken) { if (cle === cleBlocage()) actualiserDevis(x, true); poserBlocage(x, cle); return { ok: true }; }
        if (res.statut === 409 && x.code === 'price_changed') return { prixChange: true, devis: x };
        // Deux demandes de cet ecran se sont croisees au serveur : une fois.
        if (res.statut === 409 && x.code === 'hold_retry' && essais > 0) return demanderBlocage(corps, cle, essais - 1, version, ticket);
        if (res.statut === 409 && (x.code === 'slot_taken' || x.code === 'slot_unavailable')) return { pris: true, message: x.message || '' };
        // Un refus du centre (fermé, groupe trop grand) vient de NOTRE API :
        // JSON ok:false et sa phrase. Un 404 sans elle, c est l adresse du
        // blocage qui manque (deploiement, reecriture) : le client avance sans
        // blocage, la confirmation reverifie, rien ne se bloque pour autant.
        if ((res.statut === 422 || res.statut === 404) && x.ok === false && x.message) return { refus: true, message: x.message, code: x.code || '', fromPax: x.fromPax };
        arreterDecompte();
        return { sans: true };
      })
      // Une panne arrivee apres le delai ne touche plus a rien : un autre
      // blocage a pu etre pose depuis.
      .catch(function () { if (abandonne()) return { obsolete: true }; arreterDecompte(); return { sans: true }; });
  }
  // Le decompte part de ce que le SERVEUR a pose (echeance moins son heure) :
  // l horloge du telephone peut avancer ou retarder, pas la duree.
  function poserBlocage(x, cle) {
    var reste = Date.parse(x.expiresAt) - Date.parse(x.serverNow);
    if (!(reste > 0)) reste = (Number(x.minutes) || 10) * 60000;
    blocage.jeton = x.holdToken; blocage.cle = cle; blocage.total = reste; blocage.echeance = Date.now() + reste;
    blocage.etat = 'tenu'; blocage.message = ''; blocage.prevenu = false;
    clearInterval(blocage.minuteur);
    blocage.minuteur = setInterval(tic, 1000);
    rendreBlocage();
  }
  function arreterDecompte() {
    clearInterval(blocage.minuteur); blocage.minuteur = 0;
    blocage.etat = '';
    rendreBlocage();
  }
  // Rendre la place tout de suite : le client change de jour, de groupe ou
  // d activites. Le jeton ne sert plus.
  function libererBlocage() {
    blocage.version += 1;
    if (!blocage.jeton) return;
    var jeton = blocage.jeton;
    blocage.jeton = ''; blocage.cle = '';
    arreterDecompte();
    enFile(function () {
      return fetch('/api/public-holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: true, holdToken: jeton }), credentials: 'omit', keepalive: true }).catch(function () {});
    });
  }
  // La reservation est faite : le blocage est devenu elle, le jeton est mort.
  function finirBlocage() { blocage.jeton = ''; blocage.cle = ''; arreterDecompte(); }
  function surEcranDuBlocage() { return sceneCourante === 'contact' || sceneCourante === 'recap'; }
  function tic() {
    if (blocage.etat !== 'tenu') return;
    var reste = blocage.echeance - Date.now();
    if (reste <= 0) {
      clearInterval(blocage.minuteur); blocage.minuteur = 0;
      blocage.etat = 'echu';
      rendreBlocage();
      if (surEcranDuBlocage()) dire('Vos horaires ne sont plus bloqués. Ils sont peut-être encore libres : bloquez-les à nouveau pour les garder.');
      return;
    }
    if (reste <= 120000 && !blocage.prevenu) {
      blocage.prevenu = true;
      if (surEcranDuBlocage()) dire('Plus que 2 minutes pour valider : ensuite, vos horaires sont remis en vente.');
    }
    rendreBlocage();
  }
  function poserTexte(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function rendreBlocage() {
    var visible = ['tenu', 'echu', 'reprise', 'pris'].indexOf(blocage.etat) >= 0;
    var reste = Math.max(0, blocage.echeance - Date.now());
    bandeaux.forEach(function (b) {
      b.hidden = !visible;
      if (!visible) return;
      var tenu = blocage.etat === 'tenu';
      b.classList.toggle('is-urgent', tenu && reste <= 120000);
      b.classList.toggle('is-libre', !tenu);
      var temps = $('[data-hold-temps]', b), btn = $('[data-hold-action]', b), barre = $('[data-hold-barre]', b);
      poserTexte($('[data-hold-titre]', b), tenu ? 'Vos horaires sont bloqués pour vous' : 'Vos horaires ne sont plus bloqués');
      poserTexte($('[data-hold-sous]', b), tenu ? 'Jusqu’à ' + heureLocale(blocage.echeance) + '. Sans validation d’ici là, ils sont remis en vente.'
        : blocage.etat === 'pris' ? (blocage.message || 'Ces horaires ne sont plus libres.') : 'Ils sont peut-être encore libres.');
      temps.hidden = !tenu;
      if (tenu) poserTexte(temps, decompte(reste));
      barre.style.transform = 'scaleX(' + (tenu && blocage.total ? Math.min(1, reste / blocage.total) : 0).toFixed(4) + ')';
      btn.hidden = tenu;
      btn.disabled = blocage.etat === 'reprise';
      if (blocage.etat === 'reprise') btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
      btn.dataset.action = blocage.etat === 'pris' ? 'rechoisir' : 'reprendre';
      poserTexte(btn, blocage.etat === 'pris' ? 'Choisir d’autres horaires' : blocage.etat === 'reprise' ? 'Vérification…' : 'Les bloquer à nouveau');
    });
  }
  function rechoisirHoraires() {
    aller('heures', true);
    if (sceneCourante !== 'heures') return;
    state.dispo = null; signaturePistes = ''; goContact.disabled = true;
    chargerHeures();
  }
  function reprendreBlocage() {
    if (!state.creneau || blocage.etat === 'reprise') return;
    blocage.etat = 'reprise';
    rendreBlocage();
    retenir(corpsBlocage(), cleBlocage()).then(function (r) {
      if (r.prixChange) { actualiserDevis(r.devis); blocage.etat = 'echu'; rendreBlocage(); rendreRecap(); dire('Le montant a changé. Vérifiez-le avant de bloquer à nouveau vos horaires.'); return; }
      if (r.ok) { dire('Vos horaires sont de nouveau bloqués pour vous, jusqu’à ' + heureLocale(blocage.echeance) + '.'); return; }
      if (r.pris || r.refus) {
        blocage.etat = 'pris'; blocage.message = r.message || '';
        rendreBlocage();
        dire(blocage.message || 'Ces horaires ne sont plus libres.');
        return;
      }
      // Panne technique : rien n est garanti, le bouton reste la.
      blocage.etat = 'echu';
      rendreBlocage();
    });
  }
  bandeaux.forEach(function (b) {
    b.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-hold-action]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.action === 'rechoisir') rechoisirHoraires(); else reprendreBlocage();
    });
  });
  // L ECRAN DES HORAIRES, quand ils ont ete pris au moment de les bloquer :
  // la phrase du serveur (quand la place se libere, si c est un autre client
  // qui les retient), et les horaires relus. Elle reste tant que le client
  // n a pas change son choix.
  function refuserHoraires(html) {
    hourErr.innerHTML = html;
    hourErr.hidden = false;
    hourErr.dataset.cle = cleChoix();
    posterHauteur();
    montrer(hourErr);
  }
  function horairesPris(message) {
    refuserHoraires('<b>' + esc(message || 'Ces horaires ne sont plus libres.') + '</b> Les horaires affichés sont à jour.');
    dire((message || 'Ces horaires ne sont plus libres.') + ' Les horaires affichés sont à jour.');
    state.dispo = null; signaturePistes = ''; goContact.disabled = true;
    chargerHeures();
  }
  function majRefusHoraires() {
    if (hourErr.hidden || hourErr.dataset.cle === cleChoix()) return;
    hourErr.hidden = true; hourErr.innerHTML = ''; delete hourErr.dataset.cle;
    posterHauteur();
  }
  // LES HEURES SE RELISENT sur leur ecran (veille, plus bas) : un creneau
  // retenu ou reserve par un autre client s y voit sans recharger, et le sien
  // reste libre pour lui (le jeton voyage dans l en-tete). Rien ne bouge si
  // rien n a change ; jamais pendant un calcul, un ajout ou un blocage en
  // cours. LA RELECTURE NE REFAIT RIEN POUR RIEN (2026-10-12) : elle
  // re-serialisait la reponse entiere pour la comparer, puis, au moindre
  // changement, redemandait le meme calcul (deux lectures, deux analyses, sur
  // un telephone deja lent). Le texte recu se compare tel quel, et ce qui a
  // change s applique sans rien redemander.
  var CADENCE_HEURES = 20000, heuresLues = 0;
  function relireHeures() {
    if (sceneCourante !== 'heures' || doc.hidden || !state.dispo || !state.dispoTexte) return;
    if (hourZone.classList.contains('is-busy') || plus.enCours || goContact.classList.contains('is-busy')) return;
    heuresLues = Date.now();
    var id = requeteEnCours, cle = cleDemande(), avant = state.dispoTexte;
    lire(urlDispo(), { headers: enteteBlocage() })
      .then(function (rep) {
        if (id !== requeteEnCours || cle !== cleDemande() || sceneCourante !== 'heures' || rep.texte === avant || state.dispoTexte !== avant) return;
        if (hourZone.classList.contains('is-busy') || plus.enCours || goContact.classList.contains('is-busy')) return;
        var x = lu(rep);
        if (!x || x.ok === false) return;
        poserPlan(x, rep.texte, cle, repereFocus(), '', '');
      })
      .catch(function () {});
  }
  // L onglet quitte : le blocage est rendu tout de suite, pas dans dix
  // minutes. Revenu par le bouton Retour (page restauree), le bandeau dit
  // qu il n est plus garanti et propose de le reprendre.
  window.addEventListener('pagehide', function () {
    if (!blocage.jeton) return;
    var corps = JSON.stringify({ release: true, holdToken: blocage.jeton });
    var parti = false;
    try { parti = navigator.sendBeacon('/api/public-holds', new Blob([corps], { type: 'application/json' })); } catch (e) { parti = false; }
    if (!parti) { try { fetch('/api/public-holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, credentials: 'omit', keepalive: true }); } catch (e) { /* rien a faire */ } }
    if (blocage.etat === 'tenu') { clearInterval(blocage.minuteur); blocage.minuteur = 0; blocage.etat = 'echu'; }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) rendreBlocage(); });
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) tic(); });

  /* --- Etape 4 : le contact ------------------------------------------------------ */

  var form = $('#contactForm');
  function champ(id) { return $('#' + id); }
  function poserErreur(input, msg) {
    var wrap = input.closest('.fg-field');
    if (!wrap) return;
    wrap.classList.toggle('is-invalid', Boolean(msg));
    $('.fg-field__error', wrap).textContent = msg || '';
    // Le champ se dit invalide lui-meme : son message (aria-describedby) est
    // lu quand il prend le focus, au lieu d une annonce detachee du champ.
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  // UNE FAUTE DE FRAPPE DANS LE DOMAINE (« gmial.com ») : l e-mail porte la
  // confirmation ou l accuse de reception, une adresse fausse le perd. Une
  // QUESTION seulement : rien n est corrige sans toucher la proposition, et
  // l envoi n est jamais bloque. Un domaine d un vrai pays different de celui
  // propose (hotmail.it, live.de) est une adresse correcte : on n y touche pas.
  var DOMAINES = ['gmail.com', 'hotmail.com', 'hotmail.be', 'hotmail.fr', 'hotmail.nl', 'hotmail.de', 'outlook.com', 'outlook.be', 'outlook.fr', 'outlook.nl', 'live.be', 'live.fr', 'live.com', 'live.nl', 'msn.com', 'yahoo.fr', 'yahoo.com', 'icloud.com', 'me.com', 'skynet.be', 'telenet.be', 'proximus.be', 'scarlet.be', 'voo.be', 'orange.be', 'orange.fr', 'free.fr', 'laposte.net', 'gmx.com', 'gmx.be', 'gmx.fr', 'gmx.de', 'gmx.net', 'mail.com', 'web.de', 'proton.me', 'protonmail.com', 'ymail.com', 'email.com'];
  var PAYS = ['be', 'fr', 'nl', 'lu', 'de', 'it', 'es', 'pt', 'ch', 'at', 'uk', 'ie', 'se', 'pl', 'ca', 'eu'];
  function ecart(a, b) { var p = [], i, j, prec, t; for (j = 0; j <= b.length; j += 1) p[j] = j; for (i = 1; i <= a.length; i += 1) { prec = p[0]; p[0] = i; for (j = 1; j <= b.length; j += 1) { t = p[j]; p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1)); prec = t; } } return p[b.length]; }
  function adresseProbable(v) {
    var m = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(String(v || '').trim());
    if (!m) return '';
    var dom = m[2].toLowerCase();
    if (dom.length > 40 || DOMAINES.indexOf(dom) >= 0) return '';
    var best = '', d = 9;
    DOMAINES.forEach(function (x) { var k = ecart(dom, x); if (k < d) { d = k; best = x; } });
    var tld = dom.split('.').pop();
    if (tld !== best.split('.').pop() && PAYS.indexOf(tld) >= 0) return '';
    return (d === 1 || (d === 2 && best.length >= 9)) ? m[1] + '@' + best : '';
  }
  var boiteMail = $('#emailSuggest');
  function viderSuggestion() { boiteMail.innerHTML = ''; boiteMail.dataset.s = ''; }
  // La meme proposition ne se redessine pas : un blur qui remplacerait le
  // bouton pendant qu on le touche (ou qu on y tabule) perdrait le geste.
  function proposerEmail() {
    var s = adresseProbable(champ('cEmail').value);
    if ((boiteMail.dataset.s || '') === s) return;
    boiteMail.dataset.s = s;
    boiteMail.innerHTML = s ? 'Vouliez-vous dire <button type="button" data-mail="' + esc(s) + '">' + esc(s) + '</button>&nbsp;?' : '';
  }
  champ('cEmail').addEventListener('blur', proposerEmail);
  boiteMail.addEventListener('click', function (e) { var b = e.target.closest('[data-mail]'); if (!b) return; champ('cEmail').value = b.dataset.mail; viderSuggestion(); poserErreur(champ('cEmail'), ''); champ('cTel').focus(); });
  // L OCCASION DE LA VISITE (Movsar, 2026-09-24 : « faut remettre l occasion
  // de leur venue, pour avoir les stats de qui vient et pourquoi »). Un seul
  // choix, requis. Les valeurs sont celles que le serveur garde et que la
  // console de direction compte (OCCASION_VALUES, lib/reservation-request.js) :
  // une valeur qu il ne connait pas partirait en « non precise ». « Autre »
  // ouvre une precision facultative, jointe au mot pour l equipe (la colonne
  // ne garde que la cle), comme dans le tunnel.
  var occasions = $('#occasions');
  function occasionChoisie() { var b = $('.fg-occasion.is-on', occasions); return b ? b.dataset.occasion : ''; }
  function occasionFocale() { return $('.fg-occasion[tabindex="0"]', occasions) || $('.fg-occasion', occasions); }
  function choisirOccasion(btn, focus) {
    if (!btn) return;
    $$('.fg-occasion', occasions).forEach(function (b) { var on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    var autre = $('#occasionAutreWrap');
    var avant = autre.hidden;
    autre.hidden = btn.dataset.occasion !== 'autre';
    poserErreur(occasions, '');
    if (focus) btn.focus({ preventScroll: true });
    if (avant !== autre.hidden) posterHauteur();
  }
  occasions.addEventListener('click', function (e) { choisirOccasion(e.target.closest('.fg-occasion'), false); });
  // Un groupe radio (motif APG) : les fleches passent d une occasion a l autre
  // et la choisissent ; un seul arret de tabulation.
  occasions.addEventListener('keydown', function (e) {
    var pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!pas || !e.target.classList || !e.target.classList.contains('fg-occasion')) return;
    var liste = $$('.fg-occasion', occasions);
    e.preventDefault();
    choisirOccasion(liste[(liste.indexOf(e.target) + pas + liste.length) % liste.length], true);
  });
  // Le mot de l occasion tel que le client l a touche, et sa precision.
  function libelleOccasion() {
    var b = $('.fg-occasion[data-occasion="' + state.contact.occasion + '"]', occasions);
    var nom = b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
    return nom + (state.contact.occasion === 'autre' && state.contact.occasionAutre ? ' (' + state.contact.occasionAutre + ')' : '');
  }
  function validerContact() {
    var ok = true;
    var prenom = champ('cPrenom'), nom = champ('cNom'), email = champ('cEmail'), tel = champ('cTel'), consent = champ('cConsent');
    [[prenom, 'Indiquez votre prénom.'], [nom, 'Indiquez votre nom.']].forEach(function (p) { var v = p[0].value.trim(); poserErreur(p[0], v ? '' : p[1]); if (!v) ok = false; });
    var ev = email.value.trim();
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev);
    poserErreur(email, ev ? (emailOk ? '' : 'Vérifiez cette adresse (exemple : prenom@email.be).') : 'Indiquez votre adresse e-mail.');
    if (!emailOk) ok = false;
    var tv = tel.value.replace(/\(0\)/g, '').replace(/[\s.\-\/()]/g, '');
    var telOk = /^\+?\d{8,15}$/.test(tv);
    poserErreur(tel, tv ? (telOk ? '' : 'Vérifiez ce numéro (exemple : 0471 23 45 67).') : 'Indiquez un numéro où l’équipe peut vous joindre.');
    if (!telOk) ok = false;
    var occ = occasionChoisie();
    poserErreur(occasions, occ ? '' : 'Choisissez l’occasion de votre visite.');
    if (!occ) ok = false;
    $('#consentWrap').classList.toggle('is-invalid', !consent.checked); $('#eConsent').textContent = consent.checked ? '' : 'Cochez cette case pour continuer.'; if (consent.checked) consent.removeAttribute('aria-invalid'); else consent.setAttribute('aria-invalid', 'true');
    if (!consent.checked) ok = false;
    if (!ok) proposerEmail();
    return ok;
  }
  ['cPrenom', 'cNom', 'cEmail', 'cTel'].forEach(function (id) { champ(id).addEventListener('input', function () { poserErreur(champ(id), ''); if (id === 'cEmail') viderSuggestion(); }); });
  champ('cConsent').addEventListener('change', function () { $('#consentWrap').classList.remove('is-invalid'); $('#eConsent').textContent = ''; champ('cConsent').removeAttribute('aria-invalid'); });
  // ENTREE FAIT AVANCER D UN CHAMP : le clavier du telephone affiche « suivant »
  // et n envoie pas un formulaire a moitie rempli. Depuis le telephone, Entree
  // va a la case si elle n est pas cochee (sinon son erreur s afficherait avant
  // qu on ait pu la cocher) ; cochee, Entree envoie, comme avant.
  var ordreContact = ['cPrenom', 'cNom', 'cEmail', 'cTel'];
  ordreContact.forEach(function (id, k) {
    champ(id).addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      var suivant = ordreContact[k + 1] ? champ(ordreContact[k + 1]) : (!occasionChoisie() ? occasionFocale() : (champ('cConsent').checked ? null : champ('cConsent')));
      if (!suivant) return;
      e.preventDefault();
      suivant.focus();
    });
  });
  // La precision d « Autre » : Entree va a la case si elle n est pas cochee,
  // sinon envoie, comme depuis le telephone.
  champ('cOccasionAutre').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || champ('cConsent').checked) return;
    e.preventDefault();
    champ('cConsent').focus();
  });
  // Le petit « non » : seul le premier champ a corriger bouge, une fois.
  // La classe part a la fin de SA secousse, filtree sur la cible : le message
  // d erreur (fg-err, plus court) remonte aussi jusqu au champ et la couperait.
  // Restee posee, elle rejouerait a chaque retour sur l ecran (display: none).
  // Pas d ecoute de animationcancel : sur un double envoi, l evenement arrive
  // apres le redemarrage et tuerait la nouvelle secousse.
  function secouer(wrap) {
    if (!wrap || reduced) return;
    relancer(wrap, 'is-nudge');
  }
  form.addEventListener('animationend', function (e) {
    if (!e.target.matches('.fg-input, .fg-occasions, .fg-check__box')) return;
    var w = e.target.closest('.is-nudge');
    if (w) w.classList.remove('is-nudge');
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    // Un champ qui a DEJA le focus ne le reprend pas (aucun evenement) : son
    // erreur ne serait pas lue. Il le rend, puis le reprend.
    if (!validerContact()) { var premier = $('.fg-field.is-invalid > .fg-input, .fg-field.is-invalid .fg-occasion[tabindex="0"], .fg-check.is-invalid input', form); if (premier) { secouer(premier.closest('.fg-field, .fg-check')); if (premier === doc.activeElement) premier.blur(); premier.focus(); } posterHauteur(); return; }
    // « +32 (0)471 » : le serveur ne garde que les chiffres et le « + », le
    // « (0) » donnerait un numero qui n existe pas.
    state.contact = { prenom: champ('cPrenom').value.trim(), nom: champ('cNom').value.trim(), email: champ('cEmail').value.trim(), telephone: champ('cTel').value.replace(/\(0\)/g, '').replace(/\s+/g, ' ').trim(), note: champ('cNote').value.trim().slice(0, 500),
      occasion: occasionChoisie(), occasionAutre: occasionChoisie() === 'autre' ? champ('cOccasionAutre').value.replace(/\s+/g, ' ').trim().slice(0, 160) : '' };
    erreurEnvoi(''); rendreRecap();
    aller('recap');
    // Les offres du creneau retenu, dans leur fenetre, une fois l ecran entre.
    programmerVitrine();
  });

  /* --- Etape 5 : le recapitulatif ------------------------------------------------ */

  // LE RECAPITULATIF, UNE SEULE SOURCE. L ecran des coordonnees le montre en
  // entier a cote du formulaire (Movsar, 2026-09-23 : « pourquoi y a pas le
  // recap ici, y a juste un mini recap ») ; le dernier ecran le reprend, avec
  // les coordonnees qui partiront. Une seule fonction pour les deux :
  // deux rendus finiraient par se contredire.
  function htmlRecap(final) {
    var cr = state.creneau, rep = cr ? cr.reponse : {}, plan = cr ? (cr.slot.opsPlan || {}) : {}, arrivee = arriveeDe(plan);
    var lignes = [];
    var items = (rep.program && rep.program.items) || [];
    if (state.onglet === 'formules') {
      var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0] || {};
      lignes.push({ icone: 'a-formule', nom: f.name || rep.label || 'Formule', detail: (f.desc || []).join(' · '), aside: '' });
    } else if (items.length) {
      items.forEach(function (it) {
        // L offre d attente acceptee : pour qui, et pendant quoi.
        if (it.waitOffer === true) {
          var nAtt = Math.max(1, Number(it.participants) || 1);
          lignes.push({ icone: icone(it.activityId), nom: it.name || nomActivite(it.activityId), detail: 'pendant l’attente · ' + nAtt + ' personne' + (nAtt > 1 ? 's' : '') + (it.minutes ? ' · ' + minutesLabel(it.minutes) : ''), aside: '' });
          return;
        }
        // Chaque partie a son heure, celles qui n en ont pas se jouent dans la
        // foulee (l equipe les place) ; les groupes d un grand groupe, leur taille et,
        // pour une activite d une seule partie, leurs departs. Lu dans le plan
        // (vu en prod le 2026-09-23 : « Debut 11:00 », le 2e groupe tu).
        var siennes = partiesDuPlan(cr).filter(function (p) { return p.id === it.activityId; });
        var total = Number(it.games) || 0;
        var morceaux = [participantsLigne(it)];
        if (total > 1) {
          var heures = siennes.map(function (p) { return p.debut; });
          var reste = total - heures.length;
          morceaux.push(total + ' parties' + (heures.length ? ' : ' + joindreListe(heures.concat(reste > 0 ? [reste + ' dans la foulée'] : []), ' et ') : ', dans la foulée'));
        } else if (it.arcadeOffer) {
          morceaux.push(detailArcade(it));
        } else if (it.dayAccess) {
          morceaux.push('accès toute la journée', ageActivite(it.activityId));
        } else {
          morceaux.push(total === 1 ? '1 partie' : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) + (siennes[0] && siennes[0].groupes.length > 1 ? ' par groupe' : '') : '')));
        }
        if (it.extraLaser) morceaux.push(detailSupplementLaser(it) + ', dans la foulée');
        if (it.activityId === 'laser_game' && total >= 1 && dureeLaser()) morceaux.push(dureeLaser().jeu + ' min de jeu par partie');
        var grand = siennes.filter(function (p) { return p.groupes.length > 1; })[0];
        if (grand) morceaux.push(texteGroupes(grand, total <= 1) + (total > 1 ? ' par partie' : ''));
        else if (it.services && it.services.length > 1) morceaux.push(it.services.length + ' groupes l’un après l’autre');
        lignes.push({ icone: icone(it.activityId), nom: it.name || nomActivite(it.activityId), detail: morceaux.filter(Boolean).join(' · '), aside: siennes[0] ? siennes[0].debut : '' });
      });
    } else {
      state.selection.forEach(function (id) { lignes.push({ icone: icone(id), nom: nomActivite(id), detail: '', aside: '' }); });
    }
    var prix = Number(rep.price) || 0;
    var complet = !rep.program || rep.program.priceComplete !== false;
    var j = jourInfo(state.date);
    var fin = cr ? (cr.slot.visitEndTime || '') : '';
    var horsFinal = fin ? horsDelaiDu(cr.slot) : [];
    var html = '<div class="fg-recap__row fg-rise" style="--i:1"><svg aria-hidden="true"><use href="#i-calendar"/></svg><span>' + esc(jourLong(state.date)) + '</span>' + (j && j.periode ? '<i class="fg-tag ' + (j.periode.type === 'public' ? 'fg-tag--ferie' : 'fg-tag--vacances') + '">' + esc(j.periode.label) + '</i>' : '') + '</div>'
      + '<div class="fg-recap__row fg-rise" style="--i:2"><svg aria-hidden="true"><use href="#i-users"/></svg><span>' + esc(groupeLisible()) + '</span></div>'
      + '<div class="fg-recap__sep"></div>';
    lignes.forEach(function (l, i) {
      html += '<div class="fg-recap__item fg-rise" style="--i:' + (3 + i) + '"><span class="fg-recap__badge"><svg aria-hidden="true"><use href="#' + l.icone + '"/></svg></span>'
        + '<span><span class="fg-recap__name">' + esc(l.nom) + '</span>' + (l.detail ? '<br><span class="fg-recap__detail">' + esc(l.detail) + '</span>' : '') + '</span>'
        + '<span class="fg-recap__aside">' + (l.aside ? 'Début<b>' + esc(l.aside) + '</b>' : '<small>à votre rythme</small>') + '</span></div>';
    });
    html += '<div class="fg-recap__sep"></div>'
      + (arrivee ? '<div class="fg-recap__row fg-rise" style="--i:' + (3 + lignes.length) + '"><svg aria-hidden="true"><use href="#i-clock"/></svg><span>' + (plan.arrivalPlan ? 'Arrivée à' : 'Arrivée conseillée à') + ' <b>' + esc(arrivee) + '</b>' + (fin ? (cr.slot.visitEndsAtClose ? ', jusqu’à la fermeture (' + esc(heureAffichee(fin)) + ')' : ', fin vers ' + esc(heureAffichee(fin))) : '') + surPlace(arrivee, fin) + '</span></div>' : '')
      + (horsFinal.length ? '<div class="fg-recap__row fg-recap__hors fg-rise" style="--i:' + (3 + lignes.length) + '"><svg aria-hidden="true"><use href="#i-info"/></svg><span><b>' + esc(phraseHorsDelai(horsFinal, fin, false).tete) + ' :</b> ' + esc(phraseHorsDelai(horsFinal, fin, false).noms) + '</span></div>' : '')
      + '<div class="fg-total fg-rise" style="--i:' + (4 + lignes.length) + '"><div><div class="fg-total__label">' + esc(totalIndicatif(complet, (rep.program && rep.program.items) || [])) + '</div>'
      + '<div class="fg-total__amount"' + (final ? ' id="totalAmount"' : '') + ' data-total="' + prix + '">' + (prix > 0 || (complet && items.some(function (it) { return it.priceKnown === true; })) ? esc(euros(prix)) : 'Sur place') + '</div></div>'
      // Les deux moyens acceptes sur place (Movsar, 2026-09-23 : « on accepte
      // le liquide ») : la carte et le billet, puis les mots.
      + '<div class="fg-total__pay"><span class="fg-total__icons" aria-hidden="true"><svg><use href="#i-card"/></svg><svg><use href="#i-cash"/></svg></span><span class="fg-total__how"><b>Paiement sur place</b> <small>Carte ou espèces</small></span></div></div>';
    // LES COORDONNEES RELUES, telles qu elles partiront (state.contact est
    // exactement ce que porte l envoi). Aucun e-mail n est promis ici : il ne
    // part pas si le centre a coupe l envoi, et une demande a verifier recoit
    // un accuse, pas une confirmation.
    if (final) {
      // L heure de debut n est redite ici que si aucune ligne ne la porte (formule, repli sans programme).
      var sansDebut = state.heure && !lignes.some(function (l) { return l.aside; });
      html += '<p class="fg-recap__detail fg-recap__who fg-rise" style="--i:' + (5 + lignes.length) + '; margin-top:14px">'
        + (sansDebut ? 'Début de la visite à <b style="color:var(--fg-text)">' + esc(state.heure) + '</b><br>' : '')
        + 'Au nom de <b style="color:var(--fg-text)">' + esc((state.contact.prenom + ' ' + state.contact.nom).trim()) + '</b>&nbsp;· ' + esc(state.contact.email) + '&nbsp;· ' + esc(state.contact.telephone) + '</p>';
    }
    // Le mot pour l equipe, repris tel qu il part (notes) : jamais comme une
    // demande acceptee, l aide sous le champ dit deja « sans garantie ».
    if (final && state.contact.occasion) html += '<p class="fg-recap__detail fg-recap__occasion fg-rise" style="--i:' + (6 + lignes.length) + '">Occasion&nbsp;: <b style="color:var(--fg-text)">' + esc(libelleOccasion()) + '</b></p>';
    if (final && state.contact.note) html += '<p class="fg-recap__detail fg-recap__note fg-rise" style="--i:' + (7 + lignes.length) + '">Votre mot pour l’équipe&nbsp;: «&nbsp;' + esc(state.contact.note) + '&nbsp;»</p>';
    var secoursBowling = avertissementBowling(cr);
    if (secoursBowling) html += '<p class="fg-recap__detail fg-recap__note">' + esc(secoursBowling) + '</p>';
    if (final) html += htmlPlusRecap();
    return html;
  }
  // LE TOTAL S AFFICHE A SA VALEUR, D EMBLEE. Il montait de 0 a son montant en
  // 700 ms : l audit du 2026-09-28 a lu 25 EUR pour 39, 466 pour 780, et un
  // client qui regarde a ce moment-la voit un prix qui n existe pas.
  // `calme` : un ajout redessine sur place, sans rejouer l entree des lignes.
  // A l arrivee sur l ecran, la phrase d un ajout precedent ne revient pas.
  function rendreRecap(calme) {
    var r = $('#recap');
    if (!calme && plus.statut && plus.statut.ecran === 'recap') { plus.statut = null; plus.annuler = null; }
    r.classList.toggle('is-calme', Boolean(calme));
    r.innerHTML = htmlRecap(true);
  }
  $('#recap').addEventListener('click', function (e) {
    if (e.target.closest('[data-vitrine-ouvrir]')) { ouvrirVitrine(); return; }
    surPlus(e, 'recap');
  });

  /* --- Envie d un peu plus ? La fenetre -------------------------------------------- */

  // LA FENETRE DES OFFRES (Movsar, 2026-09-29 : « une pop up genre a la McDo,
  // mais super quali et belle, avec des images, dans la DA du formulaire »).
  // Elle s ouvre une fois a l arrivee au recapitulatif quand le serveur a joint
  // des offres au creneau retenu, et plus jamais pour les memes offres ; le
  // recapitulatif garde de quoi la rouvrir. « Ajouter » passe par le meme
  // aller-retour serveur que partout (changerPanier). Embarquee, elle se pose
  // au milieu de l ecran de la page hote, comme le calendrier.
  var vitrine = $('#vitrine'), vitrinePanneau = $('#vitrinePanneau'), vitrineCartes = $('#vitrineCartes'), vitrineStatut = $('#vitrineStatut');
  var vitrineVues = {}, vitrineRetour = null, vitrineMinuteur = 0;
  function vitrineOuverte() { return Boolean(vitrine && !vitrine.hidden); }
  function signatureVitrine() { return cleDemande() + '|' + cartesPlus().map(function (c) { return c.id; }).join(','); }
  // La photo d une offre : celle de l activite ajoutee, ou, pour une formule,
  // de ce que la formule ajoute (« 30 min d Arcades »).
  function photoDuPlus(c) { return photo(c.kind === 'formule' ? (c.addsLabel || c.name) : c.patch.activityId); }
  function imageDuPlus(c, p, ico) {
    var image = c.image, src = image && String(image.src || '');
    if (src && (/^https:\/\//i.test(src) || /^\/assets\/[a-z0-9_./-]+\.(webp|png|jpe?g)$/i.test(src) || /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(src))) {
      var x = Math.min(100, Math.max(0, Number(image.positionX) || 0)), y = Math.min(100, Math.max(0, Number(image.positionY) || 0)), z = Math.min(3, Math.max(1, Number(image.zoom) || 1));
      return '<img src="' + esc(src) + '" alt="" decoding="async" style="object-position:' + x + '% ' + y + '%;transform:scale(' + z + ')">';
    }
    return p ? '<img src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async">' : '<svg><use href="#' + ico + '"/></svg>';
  }
  // LA REMISE SE PROUVE OU NE S AFFICHE PAS (Movsar, 2026-10-07 : « prix
  // barre et badge »). Le prix de reference vient du serveur : l offre du
  // centre avant sa remise, le catalogue face au tarif d attente, une partie
  // de laser achetee seule ; ou du devis qu il vient de rendre pour ce nombre
  // de personnes. Jamais un pourcentage calcule ici sur une base devinee,
  // jamais un prorata : un autre nombre sans devis qui le prouve, pas de prix
  // barre.
  function remiseDuPlus(c) {
    var d = devisDuPlus(c), ref = 0;
    if (d) {
      if (d.pending || d.error) return null;
      if (d.discount && Number(d.discount.referencePrice) > 0) ref = Number(d.discount.referencePrice);
      // La reference de la carte ne vaut que pour le nombre qu elle a chiffre.
      if (c.promo && d.participants === personnesInitiales(c)) ref = Math.max(ref, Number(c.promo.reference) || 0);
    } else if (c.promo) ref = Number(c.promo.reference) || 0;
    var montant = montantDe(c);
    return ref > montant ? { reference: ref, pourcent: Math.round(100 * (ref - montant) / ref) } : null;
  }
  // Le prix d abord pour la voix (« +48 €, au lieu de 60 €, moins 20 % ») ;
  // a l oeil, l ancien prix passe devant (order), barre.
  function htmlMontant(c) {
    var d = devisDuPlus(c), r = remiseDuPlus(c);
    return '<b class="fg-vitrine__prix">' + (d && d.pending ? '…' : d && d.error ? 'À recalculer' : '+' + esc(euros(montantDe(c)))) + '</b>'
      + (r ? '<s class="fg-vitrine__barre"><span class="sr-only">au lieu de </span>' + esc(euros(r.reference)) + '</s>'
        + '<em class="fg-vitrine__remise"><span class="sr-only">soit </span>−' + r.pourcent + '&nbsp;%</em>' : '');
  }
  function etatDuPrix(c) {
    var d = devisDuPlus(c);
    if (d && d.pending) return 'Vérification du prix…';
    if (d && d.error) return esc(d.error) + ' <button type="button" class="fg-vitrine__retry" data-plus-requote="' + esc(c.id) + '">Réessayer</button>';
    return '';
  }
  function carteVitrineDe(id) { return $$('.fg-vitrine__carte[data-carte]', vitrineCartes).filter(function (li) { return li.dataset.carte === id; })[0] || null; }
  function rafraichirPrixDuPlus(c) {
    var li = carteVitrineDe(c.id);
    if (!li) return;
    $('.fg-vitrine__montant', li).innerHTML = htmlMontant(c);
    var etat = $('.fg-vitrine__etat', li);
    if (etat) etat.innerHTML = etatDuPrix(c);
    var b = $('[data-plus]', li);
    if (b) {
      b.disabled = Boolean(plus.enCours) || !plusPret(c);
      b.setAttribute('aria-label', 'Ajouter ' + nomDuPlus(c) + ' pour ' + euros(montantDe(c)) + ' de plus');
    }
    var voir = $('[data-vitrine-vedette]', li);
    if (voir) voir.setAttribute('aria-label', libelleLigne(c));
  }
  function chiffrerDuPlus(c) {
    var ancien = plus.demandes[c.id];
    if (ancien) ancien.abort();
    var controller = new AbortController(), cr = state.creneau, cle = cleDemande(), n = personnesDe(c);
    plus.demandes[c.id] = controller;
    var devis = { cle: cle, cr: cr, participants: n, pending: true };
    plus.devis[c.id] = devis;
    rafraichirPrixDuPlus(c);
    var panier = panierDe(c), url = avecPanier(panier, urlDispo);
    // Le corps se lit aussi en erreur (lire) : jete sans etre lu, il gardait la
    // requete ouverte ; et un prix qui ne vient pas ne reste plus « … ».
    lire(url, { headers: enteteBlocage(), signal: controller.signal }).then(function (r) { var j = r.ok ? lu(r) : null; if (!j) throw new Error('Cette offre ne peut pas être chiffrée.'); return j; })
      .then(function (j) {
        if (controller.signal.aborted || plus.devis[c.id] !== devis || state.creneau !== cr || cleDemande() !== cle) return;
        var refus = refusDuPlus(j, cr, Object.assign({}, c, { deltaTotal: Number.MAX_VALUE }));
        devis.pending = false;
        if (refus) devis.error = refus;
        else {
          var price = Number(j.slots[0].price != null ? j.slots[0].price : j.price), original = Number(cr.reponse.price);
          if (!Number.isFinite(price) || !Number.isFinite(original) || price < original) { devis.error = 'Cette offre ne peut pas être chiffrée.'; rafraichirPrixDuPlus(c); return; }
          devis.deltaTotal = Math.round((price - original) * 100) / 100;
          var item = ((j.program && j.program.items) || []).filter(function (it) { return it.activityId === c.patch.activityId; })[0];
          devis.discount = item && (item.extraLaser || item.upsell);
        }
        rafraichirPrixDuPlus(c);
      }).catch(function (error) {
        if (controller.signal.aborted || plus.devis[c.id] !== devis || state.creneau !== cr || cleDemande() !== cle) return;
        devis.pending = false; devis.error = 'Prix indisponible. Réessayez avec le compteur.';
        rafraichirPrixDuPlus(c);
      });
  }
  // Ce que l offre ajoute, en une ligne (« 1h de Duckpin Bowling »).
  function quoiDuPlus(c) {
    if (c.kind === 'attente') {
      var duree = Math.trunc(Number((c.attente || {}).dureeOffre) || 0);
      return (duree ? dureeExacte(duree) + ' ' : '') + 'pendant l’attente de votre tour';
    }
    var quoi = motsServeur(c.addsLabel);
    if (c.kind === 'configured') {
      var option = (c.patch && c.patch.options) || {};
      quoi = option.extraLaser ? quoi.replace(/ · \d+ joueurs$/, '') : option.duration ? heuresLabel(option.duration) : option.hours ? heuresLabel(option.hours) : option.minutes ? minutesLabel(option.minutes) : '';
      if (option.arcadeOfferId) { var ar = avecPanier(panierDe(c), function () { return reglageArcade(activite(c.patch.activityId)); }); if (ar) quoi = ar.mode === 'time' ? minutesLabel(ar.offer.minutes) + ' par carte' : credits(Number(ar.offer.credits) + Number(ar.offer.bonusCredits || 0)) + ' crédits par carte'; }
    }
    return quoi;
  }
  // Sans prix par personne, comme les autres offres de la fenetre (Movsar,
  // 2026-09-29) : le compteur et le montant de la carte disent tout. La raison
  // d une offre d attente dit deja qui attend : la note ne le repete pas.
  function noteDuPlus(c) {
    if (c.kind === 'attente') {
      if (c.raison && c.raison.code === 'attente') return '';
      var att = c.attente || {};
      return attendentDe(c) + ' personne' + (attendentDe(c) > 1 ? 's attendent' : ' attend') + ' leur tour' + (Number(att.minutes) > 0 ? ' (' + dureeExacte(att.minutes) + ')' : '');
    }
    return [personnesDe(c) === (Number(c.participants) || bornesDuPlus(c).max) ? c.totalLabel : '', c.noteLabel].filter(Boolean).map(motsServeur).join(' · ');
  }
  function quiDuPlus(c) {
    if (c.kind === 'formule') return '';
    var bornes = bornesDuPlus(c), n = personnesDe(c);
    return '<span class="fg-vitrine__qui"><span class="fg-vitrine__quimot" id="qui-' + esc(c.id) + '">' + (seCompteParEnfant(activite(c.patch.activityId)) ? 'Enfants' : 'Joueurs') + '</span>'
      + '<span class="fg-stepper fg-vitrine__stepper" role="group" aria-labelledby="qui-' + esc(c.id) + '">'
      + '<button type="button" class="fg-stepper__btn" data-vitrine-pas="-1" data-carte="' + esc(c.id) + '" aria-label="Une personne de moins"' + (n <= bornes.min ? ' disabled' : '') + '>&minus;</button>'
      + '<output class="fg-vitrine__n" aria-live="polite">' + n + '</output>'
      + '<button type="button" class="fg-stepper__btn" data-vitrine-pas="1" data-carte="' + esc(c.id) + '" aria-label="Une personne de plus"' + (n >= bornes.max ? ' disabled' : '') + '>+</button>'
      + '</span></span><small class="fg-vitrine__validite">' + (bornes.min === bornes.max ? bornes.min + ' participant' + (bornes.min > 1 ? 's' : '') : 'De ' + bornes.min + ' à ' + bornes.max + ' participants') + '</small>';
  }
  // LA MEILLEURE POUR VOUS (Movsar, 2026-10-07). La raison est un fait du
  // creneau retenu, ecrit par le serveur (qui attend et combien de temps, la
  // pause entre deux activites, la partie de plus qui coute moins cher) ; son
  // icone dit de quoi elle parle.
  var ICONE_RAISON = { attente: 'i-users', pause: 'i-clock', suite: 'a-laser' };
  // « La meilleure pour vous » est une affirmation : seule la premiere du
  // serveur la porte. Une offre que le client fait passer devant n en est pas
  // devenue la meilleure, elle garde sa raison et perd le titre.
  function carteVedette(c, seule, enTete) {
    var p = photoDuPlus(c), ico = c.kind === 'formule' ? 'a-formule' : icone(c.patch.activityId);
    var quoi = quoiDuPlus(c), note = noteDuPlus(c), raison = c.raison && c.raison.titre ? motsServeur(c.raison.titre) : '';
    return '<li class="fg-vitrine__carte is-vedette" data-carte="' + esc(c.id) + '">'
      + '<span class="fg-vitrine__photo" aria-hidden="true">' + imageDuPlus(c, p, ico) + '</span>'
      + '<span class="fg-vitrine__corps">'
      + (seule || !enTete ? '' : '<span class="fg-vitrine__pour">La meilleure pour vous</span>')
      + (raison ? '<span class="fg-vitrine__raison"><svg aria-hidden="true"><use href="#' + (ICONE_RAISON[c.raison.code] || 'i-info') + '"/></svg>' + esc(raison) + '</span>' : '')
      + '<b class="fg-vitrine__nom"><svg aria-hidden="true"><use href="#' + ico + '"/></svg>' + esc(nomDuPlus(c)) + '</b>'
      + (quoi ? '<span class="fg-vitrine__quoi">' + esc(quoi) + '</span>' : '')
      + (note ? '<small class="fg-vitrine__note">' + esc(note) + '</small>' : '') + quiDuPlus(c) + '</span>'
      + '<span class="fg-vitrine__achat"><span class="fg-vitrine__chiffre"><span class="fg-vitrine__montant">' + htmlMontant(c) + '</span><small class="fg-vitrine__etat">' + etatDuPrix(c) + '</small></span>'
      + '<button type="button" class="fg-btn fg-vitrine__ajouter" data-plus="' + esc(c.id) + '"' + (!plusPret(c) ? ' disabled' : '') + ' aria-label="Ajouter ' + esc(nomDuPlus(c)) + ' pour ' + esc(euros(montantDe(c))) + ' de plus">Ajouter</button></span></li>';
  }
  // Les autres offres : une rangee chacune, que l on touche pour la voir en
  // avant (son compteur, son detail, son « Ajouter »).
  function libelleLigne(c) {
    var dit = c.raison && c.raison.titre ? motsServeur(c.raison.titre) : quoiDuPlus(c), d = devisDuPlus(c);
    return 'Voir ' + nomDuPlus(c) + (dit ? ', ' + dit : '') + ', ' + (d && d.pending ? 'prix en vérification' : euros(montantDe(c)) + ' de plus');
  }
  function ligneVitrine(c, i) {
    var p = photoDuPlus(c), ico = c.kind === 'formule' ? 'a-formule' : icone(c.patch.activityId);
    var dit = c.raison && c.raison.titre ? motsServeur(c.raison.titre) : quoiDuPlus(c);
    return '<li class="fg-vitrine__carte fg-vitrine__ligne" data-carte="' + esc(c.id) + '" style="--i:' + i + '">'
      + '<button type="button" class="fg-vitrine__voir" data-vitrine-vedette="' + esc(c.id) + '" aria-label="' + esc(libelleLigne(c)) + '">'
      + '<span class="fg-vitrine__photo" aria-hidden="true">' + imageDuPlus(c, p, ico) + '</span>'
      + '<span class="fg-vitrine__ltxt" aria-hidden="true"><b class="fg-vitrine__nom">' + esc(nomDuPlus(c)) + '</b>' + (dit ? '<small>' + esc(dit) + '</small>' : '') + '</span>'
      + '<span class="fg-vitrine__montant" aria-hidden="true">' + htmlMontant(c) + '</span>'
      + '<svg class="fg-vitrine__fleche" aria-hidden="true"><use href="#i-arrow"/></svg>'
      + '</button></li>';
  }
  // L offre en avant : celle que le client a touchee, tant qu elle est la ;
  // sinon la premiere du serveur, qui les range par la force de leur raison.
  function vedetteDe(cartes) {
    return cartes.filter(function (c) { return c.id === plus.vedette; })[0] || cartes[0] || null;
  }
  function basculerVedette(id) {
    if (plus.enCours || plus.vedette === id) return;
    var c = cartesPlus().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var avant = $$('.fg-vitrine__carte[data-carte]', vitrineCartes).map(function (li) { return li.dataset.carte; }).indexOf(id);
    plus.vedette = id;
    rendreVitrine('bascule');
    suivre('vedette', c, { rang: Math.max(0, avant) });
    var ajouter = $('.is-vedette [data-plus]', vitrineCartes);
    (ajouter && !ajouter.disabled ? ajouter : vitrinePanneau).focus({ preventScroll: true });
    if (vitrinePanneau.scrollTop > 0) vitrinePanneau.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    dire('En avant : ' + nomDuPlus(c) + ', ' + euros(montantDe(c)) + ' de plus.');
  }
  // Le compteur d une offre d attente : le nombre, le prix et le bouton
  // suivent sur place, sans redessiner la fenetre (le focus reste).
  function changerPersonnes(btn) {
    var c = cartesPlus().filter(function (x) { return x.id === btn.dataset.carte; })[0];
    if (!c) return;
    if (plus.enCours) return;
    var bornes = bornesDuPlus(c), n = Math.min(bornes.max, Math.max(bornes.min, personnesDe(c) + Number(btn.dataset.vitrinePas)));
    plus.personnes[c.id] = n;
    var carte = btn.closest('.fg-vitrine__carte');
    var note = $('.fg-vitrine__note', carte);
    if (note && c.kind !== 'attente') note.textContent = motsServeur(c.noteLabel || '');
    $('.fg-vitrine__n', carte).textContent = String(n);
    $('[data-vitrine-pas="-1"]', carte).disabled = n <= bornes.min;
    $('[data-vitrine-pas="1"]', carte).disabled = n >= bornes.max;
    chiffrerDuPlus(c);
    if ((btn.disabled) && $('[data-vitrine-pas]:not([disabled])', carte)) $('[data-vitrine-pas]:not([disabled])', carte).focus({ preventScroll: true });
    dire(n + ' personne' + (n > 1 ? 's' : '') + ', vérification du prix.');
  }
  // `mode` : true, redessinee apres un refus (rien ne rejoue son entree) ;
  // 'bascule', une autre offre passe devant (elle seule entre) ; sinon,
  // l ouverture.
  function rendreVitrine(mode) {
    var cartes = cartesPlus(), vedette = vedetteDe(cartes);
    plus.vedette = vedette ? vedette.id : '';
    var autres = cartes.filter(function (c) { return c !== vedette; });
    vitrineCartes.innerHTML = (vedette ? carteVedette(vedette, !autres.length, vedette === cartes[0]) : '')
      + (autres.length ? '<li class="fg-vitrine__aussi" aria-hidden="true" style="--i:1">Autres options</li>' : '')
      + autres.map(function (c, i) { return ligneVitrine(c, i + 1); }).join('');
    vitrineCartes.dataset.n = String(cartes.length);
    vitrineCartes.classList.toggle('is-calme', mode === true);
    vitrineCartes.classList.toggle('is-bascule', mode === 'bascule');
    var s = plus.statut && plus.statut.ecran === 'recap' && plus.statut.ton !== 'ok' ? plus.statut : null;
    vitrineStatut.textContent = s ? s.texte : '';
    vitrineStatut.dataset.ton = s ? s.ton : '';
    $('.fg-vitrine__non', vitrine).textContent = cartes.length ? 'Non merci' : 'Fermer';
    placerVitrine(false);
    cartes.forEach(function (c) { if (c.kind !== 'formule' && !devisDuPlus(c) && !plusPret(c)) chiffrerDuPlus(c); });
  }
  function placerVitrine(demander) {
    if (!EMBED || !vitrineOuverte()) return;
    centrerDansLaVue(vitrinePanneau, demander);
  }
  // Le reste de la page se tait pendant que la fenetre est ouverte : ni le
  // clavier ni un lecteur d ecran n y vont.
  function pageInerte(oui) {
    $$('.fg-top, .fg-shell').forEach(function (el) { el.inert = oui; });
  }
  function ouvrirVitrine() {
    if (!vitrine || vitrineOuverte() || !cartesPlus().length) return;
    vitrineVues[signatureVitrine()] = 1;
    // D autres offres que la derniere fois : la meilleure repasse devant.
    if (plus.vedetteSig !== signatureVitrine()) { plus.vedette = ''; plus.vedetteSig = signatureVitrine(); }
    vitrineRetour = doc.activeElement;
    vitrine.hidden = false;
    rendreVitrine(false);
    $$('.fg-vitrine__carte[data-carte]', vitrineCartes).forEach(function (li, rang) {
      var c = cartesPlus().filter(function (x) { return x.id === li.dataset.carte; })[0];
      if (c) suivre('vue', c, { rang: rang });
    });
    root.classList.add('fg-vitrine-ouverte');
    placerVitrine(true);
    vitrinePanneau.focus({ preventScroll: true });
    // LA PAGE SE TAIT UNE FOIS LA FENETRE A L ECRAN (2026-10-12). Rendue
    // inerte dans la meme tache que la fenetre (sonde a 6x : meme image), la
    // page entiere se recalculait avant que la fenetre ne se peigne. Deux
    // images plus tard, la fenetre a ete peinte ; la decision prise
    // (data-attendue) se dit alors.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (vitrineOuverte()) pageInerte(true);
        vitrine.removeAttribute('data-attendue');
      });
    });
  }
  function fermerVitrine(rendreFocus) {
    if (!vitrineOuverte()) return;
    vitrine.hidden = true;
    pageInerte(false);
    root.classList.remove('fg-vitrine-ouverte');
    vitrinePanneau.style.top = ''; vitrinePanneau.style.maxHeight = '';
    if (rendreFocus) {
      var retour = vitrineRetour && doc.contains(vitrineRetour) && vitrineRetour !== body ? vitrineRetour : $('#t-ok');
      if (retour) retour.focus({ preventScroll: true });
    }
    vitrineRetour = null;
  }
  // A l arrivee au recapitulatif, une fois l ecran entre : jamais pendant
  // l envoi, jamais deux fois pour les memes offres. Tant que la decision
  // n est pas prise, la fenetre porte data-attendue ; « Valider » l annule.
  // ELLE ATTEND QUE L ECRAN SOIT POSE (2026-10-12). Elle partait a 750 ms
  // fixes, au milieu de l entree du recapitulatif (sonde a 6x : ouverte 500 ms
  // avant la fin de ses animations), et les deux se disputaient chaque image.
  // Elle s ouvre a la fin de l entree, lignes et photo comprises, 4 s au plus
  // apres l arrivee.
  var vitrineDecision = 0;
  function programmerVitrine() {
    clearTimeout(vitrineMinuteur);
    var jeton = ++vitrineDecision, parti = false;
    if (vitrine) vitrine.setAttribute('data-attendue', '');
    var decider = function () {
      if (parti || jeton !== vitrineDecision) return;
      parti = true;
      clearTimeout(vitrineMinuteur);
      vitrineMinuteur = setTimeout(function () {
        if (jeton !== vitrineDecision) return;
        if (sceneCourante === 'recap' && !confirmBtn.classList.contains('is-busy') && !vitrineVues[signatureVitrine()]) ouvrirVitrine();
        if (vitrine && !vitrineOuverte()) vitrine.removeAttribute('data-attendue');
      }, reduced ? 200 : 0);
    };
    vitrineMinuteur = setTimeout(decider, 4000);
    apresAnimations($('.fg-scene[data-scene="recap"]'), decider);
  }
  function annulerVitrine() {
    clearTimeout(vitrineMinuteur);
    vitrineDecision += 1;
    if (vitrine) vitrine.removeAttribute('data-attendue');
  }
  if (vitrine) {
    vitrine.addEventListener('click', function (e) {
      if (e.target.closest('[data-vitrine-fermer]')) { suivre('fermee'); fermerVitrine(true); return; }
      var voir = e.target.closest('[data-vitrine-vedette]');
      if (voir) { basculerVedette(voir.dataset.vitrineVedette); return; }
      var pas = e.target.closest('[data-vitrine-pas]');
      if (pas) { if (!pas.disabled) changerPersonnes(pas); return; }
      if (e.target.closest('[data-plus-requote]')) { surPlus(e, 'recap'); return; }
      var b = e.target.closest('[data-plus]');
      if (!b || b.disabled) return;
      b.classList.add('is-busy');
      var ajoutee = cartesPlus().filter(function (x) { return x.id === b.dataset.plus; })[0];
      if (ajoutee) suivre('ajout', ajoutee, { rang: 0 });
      surPlus(e, 'recap');
    });
    // Echap ferme ; Tab tourne dans la fenetre.
    doc.addEventListener('keydown', function (e) {
      if (!vitrineOuverte()) return;
      if (e.key === 'Escape') { e.preventDefault(); suivre('fermee'); fermerVitrine(true); return; }
      if (e.key !== 'Tab') return;
      var f = $$('button:not([disabled]), [href]', vitrinePanneau);
      if (!f.length) { e.preventDefault(); vitrinePanneau.focus(); return; }
      if (e.shiftKey && (doc.activeElement === f[0] || doc.activeElement === vitrinePanneau)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  }

  /* --- L envoi -------------------------------------------------------------------- */

  var confirmBtn = $('#confirmBtn');
  function payload() {
    var cr = state.creneau, rep = cr ? cr.reponse : {};
    var plan = cr && cr.slot.opsPlan ? cr.slot.opsPlan : null;
    var preferredTimes = {};
    if (plan && plan.anchorPlan && plan.anchorPlan.times) Object.keys(plan.anchorPlan.times).forEach(function (k) { if (plan.anchorPlan.times[k]) preferredTimes[k] = plan.anchorPlan.times[k]; });
    Object.keys(state.pins).forEach(function (k) { if (state.pins[k]) preferredTimes[k] = state.pins[k]; });
    var base = {
      centerId: CENTER,
      acquisition: ACQUISITION,
      name: (state.contact.prenom + ' ' + state.contact.nom).trim(),
      phone: state.contact.telephone,
      email: state.contact.email,
      date: state.date,
      startTime: state.heure || (cr && cr.slot.time) || '',
      // Les joueurs (les enfants d une offre qui leur est reservee) font le
      // prix ; les adultes qui les accompagnent viennent en plus, sans payer.
      pax: joueursDemandes(),
      companions: accompagnantsDemandes(),
      channel: 'public',
      // L occasion declaree : la console de direction la compte. La precision
      // d « Autre » rejoint le mot facultatif pour l equipe (colonne notes, que
      // la console du centre affiche) : la colonne occasion ne garde que la
      // cle, comme dans le tunnel.
      occasion: state.contact.occasion || '',
      // La case « Je ne souhaite pas recevoir les offres » : un booleen, que
      // le serveur applique dans la transaction de la reservation.
      sansOffres: Boolean(champ('cSansOffres') && champ('cSansOffres').checked),
      notes: [state.contact.occasion === 'autre' && state.contact.occasionAutre ? 'Occasion : ' + state.contact.occasionAutre : '', state.contact.note || ''].filter(Boolean).join('. '),
      // Les heures posees par le client et celles composees par le serveur
      // repartent ensemble : le serveur revalide exactement ce qui a ete montre.
      preference: { preferredTimes: preferredTimes, laserGameTimes: state.laserParts.slice(), laserPlacement: plan && plan.anchorPlan && plan.anchorPlan.laserPlacement === 'onsite' ? 'onsite' : 'scheduled', arrivalConfidence: 'normal' },
      // Le montant affiche part avec la demande, comme dans le tunnel ; le
      // serveur recalcule tout et c est son montant qui est enregistre.
      price: Number(rep.price) || 0,
      quotedPrice: Number(rep.price) || 0,
      basePrice: Number(rep.price) || 0,
      duration: Number(rep.duration) || 1,
      totalDuration: Number(rep.totalDuration) || Number(rep.duration) || 1,
      laneCount: Number(rep.laneCount) || 0,
      requiresLanes: Boolean(rep.requiresLanes),
      label: rep.label || '',
    };
    // L HEURE D ARRIVEE part avec les heures que le serveur a posees a partir
    // d elle (le plan montre, parties de laser comprises) : il revalide
    // exactement ce que le client a lu. Sans elle, la demande reste celle
    // d avant, au caractere pres.
    if (state.arrivee) {
      base.preference.arrivalTime = state.arrivee;
      if (plan && plan.anchorPlan && Array.isArray(plan.anchorPlan.laserGameTimes)) base.preference.laserGameTimes = plan.anchorPlan.laserGameTimes.slice();
      // L heure d arcade que le client a choisie ; sans elle, le serveur range
      // les arcades comme il l a montre.
      if (state.arcade) base.preference.arcadeTime = state.arcade;
    }
    if (state.onglet === 'formules') { base.type = 'formule'; base.formuleId = state.formuleId; }
    else { base.type = 'visite'; base.program = programme(); }
    if (cr && cr.slot.lanes) base.lanes = cr.slot.lanes;
    if (plan) base.opsPlan = plan;
    return base;
  }
  // L ERREUR D ENVOI SE LIT SOUS LE BOUTON QUI L A CAUSEE : sur telephone le
  // doigt est en bas, l alerte du haut (#fgAlert) est hors de l ecran. Elle
  // est amenee dans ce qui se voit par montrer() : en embarque, c est la page
  // du client qui defile, le cadre ne defile jamais lui-meme.
  var confirmErr = $('#confirmErr');
  function erreurEnvoi(html) {
    confirmErr.innerHTML = html || '';
    confirmErr.hidden = !html;
    if (html) { posterHauteur(); montrer(confirmErr); }
  }
  function appelCentre() {
    var c = meta && meta.center && meta.center.contact;
    return c && c.phone ? 'appelez le ' + lienContact({ phone: c.phone }) : '';
  }
  // « Choisir d autres horaires » : le serveur a refuse CES heures, elles
  // sont redemandees (state.dispo vide), jamais reprises du dernier rendu.
  confirmErr.addEventListener('click', function (e) {
    if (e.target.closest('[data-surmesure]')) { erreurEnvoi(''); ouvrirSurMesure(e.target.closest('[data-surmesure]')); return; }
    if (!e.target.closest('[data-rechoisir]')) return;
    aller('heures', true);
    if (sceneCourante !== 'heures') return;
    erreurEnvoi('');
    chargerHeures();
  });
  // LA CONFIRMATION N EST JAMAIS COUPEE (2026-10-12) : le dossier a pu etre
  // ecrit avant la reponse, une coupure ferait renvoyer une reservation deja
  // faite. Mais elle ne se tait plus : passe ENVOI_LONG, la ligne sous le
  // bouton dit que c est toujours en cours et qu il ne faut pas recharger
  // (sonde : 16 s de roue, sans un mot). Elle reprend sa phrase a la reponse.
  var ENVOI_LONG = 15000, envoiMinuteur = 0, noteEnvoi = $('.fg-scene[data-scene="recap"] .fg-confirm__note'), noteEnvoiAvant = '';
  function envoiEnCours(oui) {
    clearTimeout(envoiMinuteur);
    if (!noteEnvoi) return;
    if (noteEnvoiAvant) { noteEnvoi.textContent = noteEnvoiAvant; noteEnvoiAvant = ''; posterHauteur(); }
    if (!oui) return;
    envoiMinuteur = setTimeout(function () {
      var t = 'Votre réservation est toujours en cours d’envoi. Ne rechargez pas la page.';
      noteEnvoiAvant = noteEnvoi.textContent;
      noteEnvoi.textContent = t;
      dire(t);
      posterHauteur();
    }, ENVOI_LONG);
  }
  confirmBtn.addEventListener('click', function () {
    if (confirmBtn.classList.contains('is-busy')) return;
    annulerVitrine();
    erreurEnvoi('');
    confirmBtn.classList.add('is-busy'); confirmBtn.setAttribute('aria-busy', 'true');
    envoiEnCours(true);
    // Apres un blocage encore en route (un ajout au recapitulatif), jamais en
    // meme temps : la file les passe l un apres l autre. Le jeton fait du
    // blocage la reservation ; une confirmation renvoyee (reponse perdue)
    // rend la reservation deja faite (200, replay), jamais une deuxieme.
    enFile(function () {
      var corps = payload();
      if (blocage.jeton) corps.holdToken = blocage.jeton;
      return fetch('/api/public-reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), credentials: 'omit' });
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j || {} }; }); })
      .then(function (res) {
        confirmBtn.classList.remove('is-busy'); confirmBtn.removeAttribute('aria-busy');
        envoiEnCours(false);
        if ((res.status === 201 || (res.status === 200 && res.json.replay === true)) && res.json.ok !== false && res.json.reservation) { finirBlocage(); reussite(res.json); return; }
        // 409 : le serveur refuse de confirmer en ligne ce creneau. Ses
        // alternatives sont dites, sans le creneau refuse ni les doublons.
        // Les heures seront redemandees (dispo vide) ; le creneau refuse reste
        // celui du recapitulatif tant qu aucun autre n est rendu : vide, le
        // recapitulatif rouvert par « vos coordonnees » perdait son plan et
        // son prix (« Sur place »).
        if (res.status === 409 && res.json.code === 'price_changed') {
          actualiserDevis(res.json); rendreRecap();
          erreurEnvoi('<b>Le montant a changé.</b> Vérifiez le nouveau montant avant de confirmer à nouveau.');
          return;
        }
        if (res.status === 409) {
          var depart = state.heure || (state.creneau && state.creneau.slot.time) || '';
          state.dispo = null; signaturePistes = ''; goContact.disabled = true;
          var alts = (Array.isArray(res.json.alternatives) ? res.json.alternatives : [])
            .filter(function (a) { return a && a.date && a.startTime && !(a.date === state.date && a.startTime === depart); })
            .map(function (a) { return jourCourt(a.date) + ' à ' + a.startTime; })
            .filter(function (s, i, t) { return t.indexOf(s) === i; })
            .slice(0, 3);
          erreurEnvoi('<b>Ce créneau ne peut plus être réservé en ligne.</b>'
            + (alts.length ? ' ' + (alts.length > 1 ? 'Autres possibilités' : 'Autre possibilité') + '&nbsp;: ' + esc(alts.join(', ')) + '.' : '')
            + '<button type="button" class="fg-alert__btn" data-rechoisir>Choisir d’autres horaires</button>');
          // Les offres « Envie d un peu plus ? » valaient pour le creneau
          // refuse : elles partent avec lui (« Vos horaires ne bougent pas »
          // ne serait plus vrai). De nouvelles heures les ramenent.
          cartesPlus().forEach(function (c) { plus.refuses[c.id] = 1; });
          plus.statut = null; plus.annuler = null;
          var blocPlus = $('#plus-recap');
          if (blocPlus) blocPlus.parentNode.removeChild(blocPlus);
          return;
        }
        // Pinlane en panne, mais la demande est partie au centre par mail : on
        // le dit, et le bouton ne propose plus de la renvoyer.
        if (res.json.code === 'transmise_au_centre') {
          confirmBtn.disabled = true;
          erreurEnvoi('<b>' + esc(res.json.message) + '</b>');
          return;
        }
        // Le centre a baisse son seuil pendant que la page etait ouverte : la
        // reservation devient une demande sur mesure, le bouton y mene.
        if (res.json.code === 'custom_request_required') {
          if (meta && meta.center && res.json.fromPax) meta.center.customRequest = { fromPax: Number(res.json.fromPax) };
          erreurEnvoi('<b>' + esc(res.json.message || 'Votre groupe passe par une demande sur mesure.') + '</b><button type="button" class="fg-alert__btn" data-surmesure>Faire une demande sur mesure</button>');
          return;
        }
        erreurEnvoi('<b>' + esc(res.json.message || 'La réservation n’a pas pu être enregistrée. Réessayez dans un instant.') + '</b>');
      })
      // Une coupure OU une reponse illisible : le dossier a pu etre ecrit
      // avant la reponse, et rien n empeche un doublon. On ne pousse donc pas
      // a renvoyer.
      .catch(function () {
        confirmBtn.classList.remove('is-busy'); confirmBtn.removeAttribute('aria-busy');
        envoiEnCours(false);
        var appel = appelCentre();
        erreurEnvoi('<b>Impossible de savoir si votre demande est partie.</b> Avant de la renvoyer, ' + (appel ? appel + ' ou regardez vos e-mails.' : 'regardez vos e-mails.'));
      });
  });
  // Un titre change de texte : il se redecoupe mot a mot, comme au depart.
  // Le telephone et l e-mail du centre se TOUCHENT : sur telephone, un doigt
  // appelle ou ecrit au lieu de recopier. Le lien ne porte que des chiffres
  // (et un « + »), ou une adresse bien formee ; sinon le texte reste du texte.
  function lienContact(c) {
    var chiffres = String(c.phone || '').replace(/[^\d+]/g, '');
    var tel = chiffres.replace(/\+/g, '').length >= 8 ? '<a class="fg-done__lien" href="tel:' + esc(chiffres) + '">' + esc(c.phone) + '</a>' : esc(c.phone);
    var mail = !c.email ? '' : /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(c.email) ? '<a class="fg-done__lien" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : esc(c.email);
    return tel + (mail ? '\u00a0· ' + mail : '');
  }
  function poserTitre(el, html) {
    if (!el) return;
    el.innerHTML = html;
    delete el.dataset.cut;
    decouperTitres();
    espacerAccents(el);
  }
  function reussite(reponse) {
    var r = reponse.reservation || {};
    state.reservation = r;
    // Le dossier rendu par le serveur fait foi (il a pu deplacer l heure de
    // depart) ; ce qu il ne renvoie pas est relu dans l etat, jamais invente.
    var dateRes = r.date || state.date;
    var heureRes = r.startTime || state.heure;
    var paxRes = Number(r.pax) || state.pax;
    var mailRes = r.email || state.contact.email;
    var confirme = r.validationStatus === 'confirmed' || (reponse.ops && reponse.ops.autoDecision === 'auto_confirmed');
    var contact = meta && meta.center && meta.center.contact;
    // L ECRAN FINAL EST UN RECU : chaque ligne vient du dossier rendu ou de
    // ce que la reponse a vraiment fait. L arrivee est celle du plan rendu
    // (repli sur le plan affiche seulement si l heure de depart n a pas
    // bouge) ; le programme et les joueurs de chaque activite ; l e-mail n
    // est annonce que si la reponse l a mis en
    // file (le centre peut couper l envoi) ; le montant dit ce qu il couvre,
    // comme le total du recapitulatif.
    var planFin = r.opsPlan && typeof r.opsPlan === 'object' ? r.opsPlan : (heureRes === state.heure && state.creneau ? (state.creneau.slot.opsPlan || {}) : {});
    var arrivee = String(arriveeDe(planFin));
    var quoi = nomsChoisis();
    var repFin = (state.creneau || {}).reponse || {};
    var itemsFin = r.program && r.program.items ? r.program.items : (repFin.program && repFin.program.items) || [];
    if (state.onglet !== 'formules' && itemsFin.length) quoi = itemsFin.map(function (it) { return (it.name || nomActivite(it.activityId)) + ' (' + participantsLigne(it) + (it.arcadeOffer || it.extraLaser ? ' · ' + detailLigne(it) : '') + ')'; }).join(' + ');
    var prixComplet = !repFin.program || repFin.program.priceComplete !== false;
    var comms = Array.isArray(reponse.communications) ? reponse.communications : [];
    var mailQ = comms.filter(function (c) { return c && c.channel === 'email' && c.status !== 'draft' && (c.templateId === 'confirmation' || c.templateId === 'request_received'); })[0];
    var nomRes = String(r.name || (state.contact.prenom + ' ' + state.contact.nom)).trim();
    var quand = '<b>' + esc(jourLong(dateRes)) + '</b>, ' + esc(personnes(paxRes)) + (arrivee ? '. Arrivée conseillée à <b>' + esc(arrivee) + '</b>.' : ', à <b>' + esc(heureRes) + '</b>.') + (confirme ? ' C’est réservé&nbsp;: on vous attend&nbsp;!' : ' L’équipe vérifie votre demande et vous répond sous 24 heures ouvrables.');
    // L heure d arrivee choisie par le client n est pas un conseil (2026-10-13).
    if (planFin.arrivalPlan) quand = quand.replace('Arrivée conseillée à', 'Arrivée à');
    var ligneMail = mailQ ? (mailQ.templateId === 'confirmation' ? 'La confirmation part à ' : 'Un accusé de réception part à ') + '<b>' + esc(mailRes) + '</b>.' : 'Au nom de <b>' + esc(nomRes) + '</b>, ' + esc(mailRes) + '.';
    var ligneMontant = Number(r.price) > 0 || (prixComplet && itemsFin.some(function (it) { return it.priceKnown === true; })) ? 'Montant indicatif <b>' + esc(euros(r.price)) + '</b>' + (prixComplet ? ', à régler' : ', sans ' + esc(nomsSansPrix((repFin.program && repFin.program.items) || [])) + ' (' + PRIX_ACCUEIL + '). Tout est à régler') + ' sur place, par carte ou en espèces.' : 'Tout se règle sur place, par carte ou en espèces.';
    function rangee(ico, html) { return '<p class="fg-done__row"><svg aria-hidden="true"><use href="#' + ico + '"/></svg><span>' + html + '</span></p>'; }
    // LE TITRE DIT CE QUI S EST PASSE : confirmee d office, ou demande que
    // l equipe va verifier. « C est enregistre » etait vrai dans les deux cas,
    // et ne disait rien.
    poserTitre($('#t-fin'), confirme ? 'Réservation<br><em>confirmée</em>' : 'Demande<br><em>envoyée</em>');
    // Aucun numero de reservation : le SaaS ne s en sert nulle part, le
    // client n aurait rien a en faire (Movsar, 2026-09-24).
    $('#finBody').innerHTML = '<div class="fg-done__ticket fg-rise" style="--i:2">'
      + rangee('i-calendar', quand)
      + (quoi ? rangee('a-formule', 'Au programme&nbsp;: ' + esc(quoi)) : '')
      + (avertissementBowling(r.program ? r : state.creneau) ? rangee('i-info', esc(avertissementBowling(r.program ? r : state.creneau))) : '')
      + rangee('i-mail', ligneMail)
      + rangee('i-card', ligneMontant)
      + (contact && contact.phone ? '<p class="fg-done__row"><svg aria-hidden="true"><use href="#i-info"/></svg><span>Une question ? ' + lienContact(contact) + '</span></p>' : '')
      + '</div>'
      + (!EMBED && meta && meta.center && meta.center.identity && meta.center.identity.siteUrl ? '<div class="fg-actions fg-actions--center fg-rise" style="--i:3"><a class="fg-btn fg-btn--ghost" href="' + esc(meta.center.identity.siteUrl) + '">Retour au site</a></div>' : '');
    // L ANNEAU SUIT LE MEME VERDICT QUE LE TITRE : la coche et les confettis
    // pour une reservation confirmee, l enveloppe pour une demande que
    // l equipe va verifier (aucune fete, rien n est encore acquis).
    var anneau = $('.fg-done__ring');
    var icone = anneau && $('svg use', anneau);
    if (anneau) anneau.classList.toggle('is-mail', !confirme);
    if (icone) icone.setAttribute('href', confirme ? '#i-check' : '#i-mail');
    var burst = $('#finBurst');
    if (burst) {
      burst.innerHTML = '';
      if (confirme && !reduced) for (var i = 0; i < 14; i += 1) {
        var a = (-165 + i * 150 / 13) * Math.PI / 180, d = 70 + (i % 4) * 16, s = doc.createElement('i');
        s.style.setProperty('--x', Math.round(Math.cos(a) * d) + 'px');
        s.style.setProperty('--y', Math.round(Math.sin(a) * d) + 'px');
        s.style.setProperty('--r', (i % 2 ? 1 : -1) * (150 + i * 15) + 'deg');
        s.style.setProperty('--t', (i % 3) * 40 + 'ms');
        burst.appendChild(s);
      }
    }
    aller('fin');
    Object.keys(plus.acceptees).forEach(function (id) {
      var c = plus.acceptees[id], act = c.patch && c.patch.activityId;
      if (act && itemsFin.some(function (it) { return it.activityId === act; })) suivre('reservee', c, { reservation: Number(r.id) || 0 });
    });
    plus.acceptees = {};
    envoyerGestes();
    // La mesure de conversion pour le site hote : relue dans le dossier cree,
    // sans aucune donnee personnelle.
    poster({ type: 'pinlane:booking', detail: {
      reservationId: r.id, center: CENTER, amount: Number(r.price) || 0, currency: 'EUR', pax: paxRes, date: dateRes,
      startTime: heureRes, type: r.type || (state.onglet === 'formules' ? 'formule' : 'visite'), formuleId: r.formuleId || state.formuleId || '', label: r.label || '', status: confirme ? 'confirmed' : 'received',
    } });
  }

  /* --- La demande sur mesure ------------------------------------------------------ */

  // LE PARCOURS SUR MESURE (2026-09-28). Movsar : « tout groupe superieur a 30
  // donc a partir 31 tout groupe sera redirige vers une demande sur mesure ...
  // une reponse max 24h ouvrable et ils peuvent pas reserver le jour meme »,
  // puis « il doit avoir son propre truc avec toutes formules dispo, si non
  // pourquoi, choix des activites, un truc super complet ». Ses cinq ecrans
  // vivent dans assets/fungalaxy-sur-mesure.js et sa feuille, CHARGES A LA
  // DEMANDE : le parcours de reservation, celui de presque tous les visiteurs,
  // n en telecharge ni n en analyse rien (budget du gate fungalaxy-form-check,
  // 88 Ko de sources en moins). Restent ici l encart du seuil et la porte du
  // premier ecran, et le chargement.
  // LE SEUIL DU CENTRE : a partir de `fromPax` personnes, pas de reservation
  // en ligne, une demande (reglage Etablissement, relu avec le catalogue).
  function seuilSurMesure() {
    var c = meta && meta.center && meta.center.customRequest;
    var n = c ? Math.trunc(Number(c.fromPax)) : 0;
    return n >= 2 ? n : 0;
  }
  function grandGroupe() { var s = seuilSurMesure(); return Boolean(s && state.pax >= s); }
  var smSeuil = $('#smSeuil'), smDoor = $('#smDoor');
  function majSeuil() {
    var s = seuilSurMesure(), gros = grandGroupe();
    var avant = smSeuil.hidden;
    smSeuil.hidden = !gros;
    if (smDoor) smDoor.hidden = gros;
    if (gros) $('#smSeuilTexte').textContent = 'À partir de ' + s + ' personnes, l’équipe compose le programme avec vous : faites une demande sur mesure, réponse sous 24 heures ouvrables.';
    var label = $('#goActivitiesLabel');
    var mot = gros ? 'Préparer ma demande sur mesure' : 'Choisir mes activités';
    if (label && label.textContent !== mot) label.textContent = mot;
    if (avant !== smSeuil.hidden) { if (gros) rejouer(smSeuil, 'is-maj'); posterHauteur(); }
    // Le groupe atteint le seuil : la demande se charge deja, le clic l ouvrira
    // sans attendre.
    if (gros) prechargerSurMesure();
  }

  // LE CHARGEMENT. Le script et sa feuille partent ensemble ; la demande ne
  // s ouvre qu une fois les deux arrives (jamais un ecran sans sa mise en
  // forme). Un fichier qui echoue se redemande au clic suivant, celui qui est
  // arrive ne se recharge pas.
  var SM_JS = '/assets/fungalaxy-sur-mesure.js?v=20261006decoche';
  var SM_CSS = '/assets/fungalaxy-sur-mesure.css?v=20261003info';
  var smModule = null, smFichiers = {};
  function chargerFichier(cle, balise, attributs) {
    if (!smFichiers[cle]) {
      smFichiers[cle] = new Promise(function (resolve, reject) {
        var el = doc.createElement(balise);
        Object.keys(attributs).forEach(function (k) { el[k] = attributs[k]; });
        el.onload = function () { resolve(el); };
        el.onerror = function () { if (el.parentNode) el.parentNode.removeChild(el); delete smFichiers[cle]; reject(new Error('chargement')); };
        doc.head.appendChild(el);
      });
    }
    return smFichiers[cle];
  }
  function chargerSurMesure() {
    if (smModule) return Promise.resolve(smModule);
    return Promise.all([
      chargerFichier('css', 'link', { rel: 'stylesheet', href: SM_CSS }),
      chargerFichier('js', 'script', { src: SM_JS, async: true }),
    ]).then(function () {
      if (!smModule) {
        if (typeof window.FGSurMesure !== 'function') throw new Error('module');
        smModule = window.FGSurMesure(interne());
      }
      return smModule;
    });
  }
  function prechargerSurMesure() { chargerSurMesure().catch(function () {}); }

  // L OUVERTURE. Sur un reseau lent, le bouton touche dit qu il travaille ; un
  // echec se dit en clair, avec le numero du centre.
  function ouvrirSurMesure(bouton) {
    var btn = bouton && bouton.classList ? bouton : null;
    if (!meta) { if (panneMeta) direErreur(panneMeta); else apresCatalogue(btn, function () { ouvrirSurMesure(bouton); }); return; }
    direErreur('');
    if (smModule) { smModule.ouvrir(); return; }
    // Borne comme une lecture (2026-10-12) : un fichier qui ne vient pas
    // laissait le bouton tourner sans fin. Arrive apres coup, il ne s ouvre
    // pas tout seul ; le toucher suivant l ouvre aussitot.
    var fini = false;
    var echec = function () {
      if (fini) return;
      fini = true;
      occuper(btn, false);
      var c = meta && meta.center && meta.center.contact;
      direErreur('La demande sur mesure ne s’est pas chargée. Vérifiez votre connexion et réessayez' + (c && c.phone ? ', ou appelez le centre au ' + c.phone : '') + '.');
    };
    var delai = setTimeout(echec, DELAI_LECTURE);
    occuper(btn, true);
    chargerSurMesure().then(function (m) { if (fini) return; fini = true; clearTimeout(delai); occuper(btn, false); m.ouvrir(); }).catch(function () { clearTimeout(delai); echec(); });
  }
  if (smDoor) {
    $('#smDoorBtn').addEventListener('click', function (e) { ouvrirSurMesure(e.currentTarget); });
    // La main qui approche la porte la fait deja charger.
    smDoor.addEventListener('pointerenter', prechargerSurMesure);
    smDoor.addEventListener('focusin', prechargerSurMesure);
  }

  // CE QUE LA DEMANDE EMPRUNTE AU FORMULAIRE : ses outils, son etat, son
  // calendrier, ses ecrans. `meta` se relit a chaque lecture : le catalogue
  // se recharge (retour sur l onglet, toutes les 10 s).
  // Le sur-mesure utilise le même catalogue, les mêmes options et calculs.
  // Ce contexte ne dure qu'un rendu synchrone ; le panier standard est préservé.
  function reglagesSurMesure(a, options, pax, date, selectionnee) {
    var avant = { options: state.options, pax: state.pax, date: state.date, selection: state.selection, onglet: state.onglet, sm: state.surMesure };
    state.surMesure = true; state.onglet = 'activites'; state.options = {}; state.options[a.id] = options || {};
    state.pax = pax; state.date = date || avant.date; state.selection = [a.id];
    try {
      var opt = optionChoisie(a), billard = reglageBillard(a), montant = null;
      var arcade = reglageArcade(a);
      if (arcade) montant = arcade.price;
      else if (opt) {
        var q = a.priceType === 'grid_laser' ? joueursDe(a) : a.priceType === 'grid_fun_run' ? sessionsPour(a)
          : a.id === 'bowling' && pistesBowling() ? pistesBowling().pistes : unitesPour(a).units;
        montant = Math.round(opt.prix * q * 100) / 100;
      } else if (a.priceType === 'per_unit_hour') montant = prixBillard(a, billard.units, billard.hours);
      else if (tarifConnu(a)) montant = Math.round(Number(a.priceValue) * (a.priceType === 'per_pax' ? joueursDe(a) : 1) * 100) / 100;
      if (selectionnee === false) state.selection = [];
      return { montant: montant, html: rendreOption(a).replace(/opt-/g, 'sm-opt-'), info: htmlInfo(a), prix: prixCarte(a),
        compteurs: [compteurDe(a)].concat(a.priceType === 'per_unit_hour' ? [compteurDe(a, 'units')] : arcade && arcade.mode === 'credit' ? [compteurDe(a, 'cards')] : []),
        arcade: arcade ? snapshotArcade(a) : null, detail: arcade ? detailArcade(snapshotArcade(a)) : '', groupes: groupesOptions(a) };
    } finally {
      state.options = avant.options; state.pax = avant.pax; state.date = avant.date; state.selection = avant.selection; state.onglet = avant.onglet; state.surMesure = avant.sm;
    }
  }
  function interne() {
    var I = {
      doc: doc, $: $, $$: $$, CENTER: CENTER, EMBED: EMBED, sm: sm, state: state,
      activite: activite, activitesVendables: activitesVendables, aller: aller, appelCentre: appelCentre, champ: champ,
      chargerPhotoCarte: chargerPhotoCarte, decouperTitres: decouperTitres, deIso: deIso, dire: dire, esc: esc, euros: euros,
      eveiller: eveiller, finGeste: finGeste, heureRonde: heureRonde, icone: icone, iso: iso, jourInfo: jourInfo,
      jourLong: jourLong, joursLisibles: joursLisibles, libelleFamille: libelleFamille, lienContact: lienContact,
      ligneCentre: ligneCentre, minuscule: minuscule, montrer: montrer, motUnite: motUnite, ouvrirCalendrier: ouvrirCalendrier,
      photo: photo, photosDesScenes: photosDesScenes, plageLisible: plageLisible, poserErreur: poserErreur, poserTitre: poserTitre,
      posterHauteur: posterHauteur, precedent: precedent, prixCarte: prixCarte, reglesFormule: reglesFormule, rejouer: rejouer,
      htmlInfoFormule: htmlInfoFormule,
      secouer: secouer, sortieClavier: sortieClavier, reglagesSurMesure: reglagesSurMesure, choixArcade: choixArcade,
      rendreEditeurActivites: rendreEditeurActivites, caseActivite: caseActivite, tuileActivite: tuileActivite, tiroirActivite: tiroirActivite,
      scene: function () { return sceneCourante; },
    };
    Object.defineProperty(I, 'meta', { get: function () { return meta; } });
    return I;
  }

  /* --- La photo qui suit la souris (ordinateur seulement) ---------------------- */

  if (finPointer && !reduced) {
    var rafPara = 0;
    doc.addEventListener('pointermove', function (e) {
      if (rafPara) return;
      rafPara = requestAnimationFrame(function () {
        rafPara = 0;
        var x = (e.clientX / window.innerWidth - 0.5).toFixed(3);
        var y = (e.clientY / window.innerHeight - 0.5).toFixed(3);
        root.style.setProperty('--px', x);
        root.style.setProperty('--py', y);
      });
    });
  }

  /* --- Le catalogue se relit --------------------------------------------------------- */

  // UN CHANGEMENT DU CENTRE SE VOIT SANS RECHARGER (Movsar, 2026-09-28 :
  // « que ça corrige à la seconde sur le formulaire »). Le centre change ses
  // tables, ses pistes ou une formule dans la console : le serveur l applique
  // aussitot, et le formulaire deja ouvert relit le catalogue en revenant sur
  // l onglet, en entrant dans les activites, et toutes les 30 s (la veille,
  // plus bas) tant qu il montre les activites ou les heures. Rien ne bouge si
  // rien n a change ; sinon les cartes se redessinent, la selection et les
  // reglages gardes (ramenes aux nouvelles limites), et les heures se
  // recalculent. Le texte recu identique au dernier ne se relit meme pas : ni
  // analyse, ni empreinte reserialisee (2026-10-12).
  var empreinteCatalogue = '', catalogueTexte = '', catalogueLu = 0;
  function empreinteDuCatalogue(j) { return JSON.stringify([(j && j.activities) || [], (j && j.formules) || [], (j && j.center && j.center.customRequest) || null]); }
  function rafraichirCatalogue() {
    // Pas pendant les coordonnees ni le recapitulatif : le client relit ce
    // qu il va envoyer, et le serveur revalide tout a l envoi.
    if (!meta || doc.hidden || ['date', 'activites', 'heures', 'sm-envies'].indexOf(sceneCourante) < 0) return;
    catalogueLu = Date.now();
    var q = new URLSearchParams(); q.set('centerId', CENTER);
    lire('/api/public-booking-meta?' + q.toString())
      .then(function (rep) {
        if (rep.texte === catalogueTexte) return;
        var j = lu(rep);
        if (!j || j.ok === false || !Array.isArray(j.activities)) return;
        catalogueTexte = rep.texte;
        var neuve = empreinteDuCatalogue(j);
        if (neuve === empreinteCatalogue) return;
        empreinteCatalogue = neuve;
        meta.activities = j.activities;
        if (Array.isArray(j.formules)) meta.formules = j.formules;
        if (meta.center && j.center && j.center.customRequest) meta.center.customRequest = j.center.customRequest;
        rendrePax();
        if (sceneCourante === 'sm-envies') { if (smModule) smModule.rafraichir(); return; }
        state.selection = state.selection.filter(function (id) {
          var a = activite(id);
          return a && !tropPeu(a);
        });
        if (state.formuleId && !((meta.formules || []).filter(function (x) { return x.id === state.formuleId; })[0])) state.formuleId = '';
        rendreActivites();
        rendreFormules();
        grillesRendues = empreinteGrilles();
        rendreCompteur(false);
        // Les heures deja posees restent : seule la disponibilite se recalcule.
        state.dispo = null;
        if (sceneCourante === 'heures') chargerHeures();
      })
      .catch(function () {});
  }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) rafraichirCatalogue(); });
  $('#goActivities').addEventListener('click', function () { rafraichirCatalogue(); });
  // LA VEILLE SE TAIT QUAND ON TOUCHE (2026-10-12). Les relectures de fond (les
  // heures, le catalogue et les durees des formules) partaient a heure fixe,
  // toutes les 15 et 10 s, au milieu des gestes : sur un telephone modeste,
  // leur lecture et leur rendu tombaient sur le toucher suivant. Elles
  // attendent que la main se pose (CALME_APRES_GESTE sans toucher ni touche)
  // et s espacent : CADENCE_HEURES pour les heures, CADENCE_CATALOGUE pour le
  // catalogue. Une lecture faite par ailleurs (un calcul, l entree dans les
  // activites) compte : la suivante attend sa cadence entiere.
  var CADENCE_CATALOGUE = 30000, CALME_APRES_GESTE = 8000, dernierGeste = 0;
  ['pointerdown', 'keydown'].forEach(function (t) { doc.addEventListener(t, function () { dernierGeste = Date.now(); }, true); });
  setInterval(function () {
    var t = Date.now();
    if (doc.hidden || t - dernierGeste < CALME_APRES_GESTE) return;
    if (t - heuresLues >= CADENCE_HEURES) relireHeures();
    if (t - catalogueLu < CADENCE_CATALOGUE || !(sceneCourante === 'activites' || sceneCourante === 'heures' || sceneCourante === 'sm-envies')) return;
    catalogueLu = t;
    rafraichirCatalogue();
    if (sceneCourante === 'activites' && state.onglet === 'formules') chargerDurees();
  }, 1000);

  /* --- Le demarrage ----------------------------------------------------------------- */

  function demarrer() {
    poserPhotos();
    decouperTitres();
    espacerTitreActif();
    rendreEtapes();
    rendrePax();
    var q = new URLSearchParams(); q.set('centerId', CENTER); q.set('calendar', '45');
    lire('/api/public-booking-meta?' + q.toString())
      .then(function (rep) {
        var j = lu(rep);
        if (!j || j.ok === false) throw erreurLisible(j, 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.');
        meta = j; direErreur('');
        empreinteCatalogue = empreinteDuCatalogue(j);
        // La case des offres nomme le centre qui les enverrait : un retrait
        // vaut pour CE centre (la liste est tenue centre par centre).
        var nomOffres = meta.center && meta.center.name ? String(meta.center.name) : '';
        if (nomOffres) $$('[data-centre-nom]').forEach(function (el) { el.textContent = (/^[aeiouyhàâäéèêëîïôöûü]/i.test(nomOffres) ? 'd’' : 'de ') + nomOffres; });
        if (meta.center && meta.center.status && meta.center.status !== 'active') {
          direErreur('Ce centre n’ouvre pas encore ses réservations en ligne.');
        }
        if (meta.center && meta.center.demonstration === true) {
          direErreur('Ce formulaire est une démonstration : rien n’y est enregistré.');
        }
        absorberCalendrier(meta.center && meta.center.calendar);
        // Le premier jour ouvert : aujourd hui si le centre est ouvert, sinon
        // le prochain. UN JOUR DEJA CHOISI RESTE (2026-10-12) : le calendrier
        // charge son mois seul, et sur un reseau lent le client y choisit son
        // jour avant l arrivee du catalogue, qui le remplacait par le premier
        // jour ouvert (sonde : samedi choisi, mardi affiche). Ouvert, le
        // calendrier se redessine avec les jours arrives.
        var premier = Object.keys(jours).sort().filter(function (s) { return ouvertCeJour(s); })[0];
        if (state.date) direJour(state.date);
        else if (premier) choisirJour(premier);
        if (!dayPop.hidden) rendreCalendrier();
        rendrePax();
        rendreActivites();
        rendreFormules();
        grillesRendues = empreinteGrilles();
        rendreCompteur(false);
        choisirOnglet('activites');
        body.classList.add('is-ready');
        posterHauteur();
        rejouerGeste();
      })
      .catch(function (err) { panneMeta = err && err.lisible ? err.message : 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.'; direErreur(panneMeta); body.classList.add('is-ready'); rejouerGeste(); });
    posterHauteur();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
