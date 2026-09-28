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
  if (EMBED) body.classList.add('is-embed');
  if (finPointer) body.classList.add('has-pointer');

  // Le fond du site hote voyage dans l URL : liste blanche de caracteres
  // stricte, sinon color-scheme: dark peint un rectangle gris chez le client.
  // Il devient AUSSI le fond de reference des degrades (--fg-bg) : les bords
  // des photos se fondent dans la page du client, pas dans notre noir a nous.
  var fond = params.get('fond') || '';
  if (fond && fond.length < 40 && /^[0-9a-fA-F#rgbaRGBA(), .%]+$/.test(fond)) {
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
    if (!h || h === derniereHauteur || (h < derniereHauteur && derniereHauteur - h < 8)) return;
    derniereHauteur = h;
    poster({ type: 'pinlane:height', height: h });
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
      root.style.setProperty('--tunnel-vue-haut', (Number(d.cacheEnHaut) || 0) + 'px');
      root.style.setProperty('--tunnel-vue-ecran', (Number(d.hauteurEcran) || 0) + 'px');
      var haut = Number(d.hautCadre);
      if (isFinite(haut)) hautCadre = haut;
      ecranHote = Number(d.hauteurEcran) || 0;
      // La fenetre du calendrier (telephone) suit le milieu de l ecran hote.
      placerFenetre(false);
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
    heure: '',                 // debut de visite du creneau retenu
    dispo: null,               // la derniere reponse de public-availability
    dispoCle: '',              // la demande qui a produit state.dispo, prise au depart de la requete
    creneau: null,             // le slot retenu (avec opsPlan)
    contact: { prenom: '', nom: '', email: '', telephone: '', note: '', occasion: '', occasionAutre: '' },
    reservation: null,
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
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Ce qui ne se coupe pas en fin de ligne : « 4 personnes », « 1 h 40 »,
  // « Sam. 26 sept. » ; un separateur (· ou +) reste avec le mot d avant, et
  // le dernier mot d un nom avec le precedent (« Laser Game »), sans souder
  // un long nom entier.
  function insecable(s) { return String(s == null ? '' : s).replace(/ /g, '\u00a0'); }
  function finInsecable(s) { return String(s == null ? '' : s).replace(/ ([^ ]+)$/, '\u00a0$1'); }
  // Rejoue une animation CSS une fois : retire la classe, force un recalcul,
  // la repose. Elle repart d elle-meme ensuite : restee posee, elle rejouerait
  // chaque fois que l element repasse de display:none a affiche.
  var minuteursRejoue = new WeakMap();
  function rejouer(el, cls) {
    if (!el || reduced) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
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
  function activitesVendables() {
    return (meta && meta.activities ? meta.activities.slice() : []).sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
  }
  function activite(id) { return activitesVendables().filter(function (x) { return x.id === id; })[0] || null; }
  function nomActivite(id) { var a = activite(id); return a ? a.name : id; }

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
    return Math.min(40, Math.max(1, Math.ceil(Math.max(1, state.pax) / places)));
  }
  // LES PISTES D UN GROUPE, ET SES TOURS (duckpin : 6 joueurs par piste, 2
  // pistes, reglables dans Etablissement). MIROIR de activityUnitPlan
  // (lib/activity-catalog) : le serveur fait foi, le gate tours-dotation-check
  // compare les deux pour chaque taille de groupe.
  function unitesPour(a) {
    var capacite = Math.trunc(Number(a && a.capacityPerUnit) || 0);
    var dotation = Math.trunc(Number(a && a.units) || 0);
    var joueurs = Math.max(1, Math.trunc(Number(state.pax) || 1));
    var necessaires = capacite > 0 ? Math.ceil(joueurs / capacite) : 1;
    var units = Math.min(50, Math.max(1, necessaires));
    var aLaFois = dotation > 0 ? Math.min(dotation, units) : units;
    var tours = Math.min(40, Math.max(1, Math.ceil(units / aLaFois)));
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
  function noteRotation(a) {
    if (a.priceType === 'grid_fun_run') {
      var n = sessionsPour(a);
      if (n < 2) return '';
      var places = Math.trunc(Number(a.capacityPerUnit) || 0) * Math.max(1, Math.trunc(Number(a.units) || 1));
      return 'Votre groupe joue en ' + n + ' sessions, ' + places + ' joueurs à la fois.';
    }
    var mot = motUnite(a);
    if (a.priceType !== 'grid_bowling' || !mot || !(Number(a.capacityPerUnit) > 0)) return '';
    var p = unitesPour(a);
    if (p.units < 2) return '';
    var nb = function (k) { return k + ' ' + mot + (k > 1 ? 's' : ''); };
    if (p.tours < 2) return 'Pour ' + state.pax + ' joueurs : ' + nb(p.units) + ' (' + p.perUnit + ' joueurs par ' + mot + ').';
    var suite = '';
    for (var t = 1; t < p.tours; t += 1) suite += ', puis ' + (t === p.tours - 1 ? p.lastTour : p.atOnce);
    var opt = optionChoisie(a);
    var duree = dureeExacte(Math.round((opt ? Number(opt.valeur) : 1) * 60));
    return 'Pour ' + state.pax + ' joueurs : ' + p.units + ' ' + mot + 's de ' + p.perUnit + '. Le centre en a ' + p.atOnce
      + ', vous jouez donc en ' + p.tours + ' tours de ' + duree + ' (' + nb(p.atOnce) + suite + ').';
  }
  // LES BILLARDS : le client choisit ses tables (une par defaut, jusqu a ce
  // que le centre en a) et ses heures (le pas du catalogue). Movsar,
  // 2026-09-28 : « tu dois permettre de choisir combien de tables ils veulent
  // et c 10 euro par heure et par table ». Le serveur refuse au-dela des
  // tables du centre : l ecran n en propose jamais plus.
  function tablesMax(a) {
    var d = Math.trunc(Number(a && a.units) || 0);
    return d > 0 ? Math.min(50, d) : 4;
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
  // Le montant d une ligne de billard : tables x heures x tarif du centre,
  // null quand le centre n a pas saisi de tarif (« sur place »).
  function prixBillard(a, tables, heures) {
    return a && Number(a.priceValue) > 0 ? Math.round(Number(a.priceValue) * tables * heures * 100) / 100 : null;
  }
  // `libre` : le prix de base, sans la ligne que la reservation a choisie
  // (la demande sur mesure montre le tarif, l equipe composera les lignes).
  function prixCarte(a, libre) {
    if (!meta) return '';
    var choisie = !libre && state.selection.indexOf(a.id) >= 0;
    // Des billards choisis : le montant de SA ligne, et ce qu il paie.
    if (a.priceType === 'per_unit_hour' && choisie) {
      var r = reglageBillard(a);
      var total = prixBillard(a, r.units, r.hours);
      var motTable = motUnite(a) || 'unité';
      // « 3 tables » et « 2 heures » ne se coupent pas en fin de ligne.
      var quoi = insecable(r.units + ' ' + motTable + (r.units > 1 ? 's' : '')) + ', ' + insecable(heuresLabel(r.hours));
      return (total == null ? 'Tarif sur place' : euros(total)) + ' · ' + quoi;
    }
    var opt = optionChoisie(a);
    if (opt) {
      if (choisie) return euros(opt.prix) + ' ' + opt.unite;
      var mini = Math.min.apply(null, optionsPour(a).map(function (o) { return o.prix; }).filter(function (p) { return p > 0; }));
      return isFinite(mini) ? 'Dès ' + euros(mini) + ' ' + opt.unite : 'Tarif sur place';
    }
    var unite = a.unitLabel ? ' ' + a.unitLabel.replace(/^par /, '/ ') : '';
    switch (a.priceType) {
      case 'per_pax':
      case 'per_unit_hour':
        return a.priceValue ? 'Dès ' + euros(a.priceValue) + unite : 'Tarif sur place';
      default:
        return a.priceValue ? euros(a.priceValue) + unite : 'Tarif sur place';
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
    $$('[data-steps]').forEach(function (ol) { ol.innerHTML = html; });
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
  var accentsEnAttente = false;
  window.addEventListener('resize', function () {
    if (accentsEnAttente) return;
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
  var dayField = dayBtn.closest('.fg-field');
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
      date: entry.date, ouvert: Boolean(entry.open), horaire: entry.open ? horaireLabel(entry.schedule) : (entry.closedLabel || 'Fermé'),
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
    var p = fetch('/api/public-booking-meta?' + q.toString(), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) { absorberCalendrier(j && j.center && j.center.calendar); moisCharges[cle] = true; })
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
      var off = passe || loin || avant || !j || !j.ouvert;
      var cls = 'fg-cal__day' + (off ? ' is-off' : '') + (passe || avant ? ' is-past' : '') + (s === today ? ' is-today' : '') + (s === choisi ? ' is-selected' : '') + (j && j.periode ? (j.periode.type === 'public' ? ' is-ferie' : ' is-vacances') : '') + (!j && !passe && !loin ? ' is-loading' : '');
      var titre = avant && cible().avantMin ? cible().avantMin : j ? infoTexte(j) : (passe ? 'Date passée' : (loin ? 'Au-delà de la période de réservation' : 'Chargement…'));
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
    var j = jourInfo(dateStr);
    var morceaux = [];
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
    dayHint.textContent = morceaux.join('\u00a0· ');
    dayBtn.setAttribute('title', dayHint.textContent);
    invaliderDispo();
  }
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
    if (ecranHote) dayPop.style.maxHeight = Math.max(200, ecranHote - 24) + 'px';
    var h = dayPop.offsetHeight, cadre = window.innerHeight;
    var milieu = ecranHote && hautCadre !== null ? ecranHote / 2 - hautCadre : cadre / 2;
    var y = Math.max(h / 2 + 8, Math.min(cadre - h / 2 - 8, milieu));
    dayPop.style.top = Math.round(y) + 'px';
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
    paxInput.classList.remove('is-up', 'is-down');
    void paxInput.offsetWidth;
    paxInput.classList.add(sens > 0 ? 'is-up' : 'is-down');
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
    paxOut.textContent = personnes(state.pax);
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
    // Le groupe change : la question des enfants se repose, tout le groupe par
    // defaut, jamais un ancien compte qui ne correspond plus a rien.
    state.enfants = null;
    rendrePax();
    majEnfants();
  }
  $('#paxMinus').addEventListener('click', function () { poserPax(state.pax - 1); paxInput.value = String(state.pax); ajusterLargeurPax(); battrePax(-1); });
  $('#paxPlus').addEventListener('click', function () { poserPax(state.pax + 1); paxInput.value = String(state.pax); ajusterLargeurPax(); battrePax(1); });
  // Le nombre se tape aussi : la valeur se prend des qu elle est lisible, et
  // se remet au propre quand le champ est quitte (vide ou hors bornes).
  paxInput.addEventListener('input', function () { ajusterLargeurPax(); var v = parseInt(paxInput.value, 10); if (isFinite(v) && v >= PAX_MIN) poserPax(v); });
  paxInput.addEventListener('blur', function () { paxInput.value = String(state.pax); ajusterLargeurPax(); });
  paxInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); paxInput.blur(); } });

  $('#goActivities').addEventListener('click', function () {
    if (!meta) { direErreur(panneMeta || 'Le formulaire se charge encore. Réessayez dans un instant.'); return; }
    if (grandGroupe()) { ouvrirSurMesure($('#goActivities')); return; }
    if (!state.date) { direErreur('Choisissez d’abord un jour.'); dayBtn.focus(); return; }
    direErreur('');
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
    rendreActivites();
    rendreFormules();
    rendreCompteur(false);
    aller('activites');
    placerBarre();
  });

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
    if (a.priceType === 'per_unit_hour') {
      var r = reglageBillard(a);
      var mot = motUnite(a) || 'unité';
      var tables = [];
      for (var n = 1; n <= tablesMax(a); n += 1) tables.push({ valeur: n, label: String(n), sous: mot + (n > 1 ? 's' : '') });
      return [
        { cle: 'units', titre: mot.charAt(0).toUpperCase() + mot.slice(1) + 's', options: tables, choisie: r.units },
        { cle: 'hours', titre: 'Durée', options: heuresPossibles(a).map(function (h) { return { valeur: h, label: heuresLabel(h), prix: prixBillard(a, r.units, h) }; }), choisie: r.hours },
      ];
    }
    var liste = optionsPour(a);
    if (!liste.length) return [];
    var i = indexOption(a);
    return [{ cle: liste[0].cle, titre: TITRES_OPTION[liste[0].cle] || 'Option', options: liste, choisie: liste[i < 0 ? 0 : i].valeur }];
  }
  function petitDePastille(o) { return o.sous != null ? o.sous : (o.prix == null ? 'sur place' : euros(o.prix)); }
  function rendreOption(a) {
    var groupes = groupesOptions(a);
    if (!groupes.length) return '';
    var base = 'opt-' + String(a.id).replace(/[^a-z0-9_-]/gi, '');
    return '<div class="fg-card__opt"><div class="fg-card__optin"><div class="fg-card__optbox">'
      + groupes.map(function (g) {
        var idTitre = groupes.length > 1 ? base + '-' + g.cle : base;
        return '<span class="fg-card__optlabel" id="' + idTitre + '">' + esc(g.titre) + '</span>'
          + '<div class="fg-pills" role="radiogroup" aria-labelledby="' + idTitre + '" data-cle="' + esc(g.cle) + '" data-n="' + g.options.length + '">'
          + g.options.map(function (o) {
            var on = o.valeur === g.choisie;
            return '<button type="button" class="fg-pill' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? '0' : '-1') + '" data-cle="' + esc(g.cle) + '" data-valeur="' + esc(String(o.valeur)) + '"><b>' + esc(o.label) + '</b><small>' + esc(petitDePastille(o)) + '</small></button>';
          }).join('')
          + '</div>';
      }).join('')
      + (noteRotation(a) ? '<p class="fg-card__rot">' + esc(noteRotation(a)) + '</p>' : '')
      + '</div></div></div>';
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
    state.options[a.id] = a.priceType === 'per_unit_hour' ? Object.assign({}, state.options[a.id] || {}) : {};
    state.options[a.id][g.cle] = o.valeur;
    $$('.fg-pill', groupe || item).forEach(function (x) { var on = x === pill; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    majPastilles(item, a);
    majPrixCarte(item, a, true);
    invaliderDispo();
  }
  // Les montants des pastilles et la phrase des tours suivent le reglage :
  // deux heures pour trois tables ne coutent pas ce que coute une table, et
  // un tour dure la duree choisie.
  function majPastilles(item, a) {
    groupesOptions(a).forEach(function (g) {
      g.options.forEach(function (o) {
        var petit = item.querySelector('.fg-pill[data-cle="' + g.cle + '"][data-valeur="' + String(o.valeur) + '"] small');
        if (petit) petit.textContent = petitDePastille(o);
      });
    });
    var rot = $('.fg-card__rot', item);
    if (rot) rot.textContent = noteRotation(a);
  }
  function rendreActivites() {
    gridAct.innerHTML = activitesVendables().map(function (a, i) {
      var p = photo(a.id);
      var on = state.selection.indexOf(a.id) >= 0;
      var trop = a.maxPax && state.pax > a.maxPax;
      // Pas assez de joueurs : la carte reste TOUCHABLE et dit pourquoi, comme
      // une formule refusee (une raison qu on ne peut pas atteindre ne sert a
      // personne).
      var peu = !trop && tropPeu(a);
      var ferme = !trop && !peu && fermeCeJour(a);
      return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '" data-activity="' + esc(a.id) + '">'
        + '<div class="fg-card fg-rise' + (on ? ' is-on' : '') + (trop ? ' is-off' : '') + (peu || ferme ? ' is-refus' : '') + '" style="--i:' + (i % 8) + '" data-activity="' + esc(a.id) + '" role="checkbox" tabindex="' + (trop ? '-1' : '0') + '" aria-checked="' + on + '" ' + (trop ? 'aria-disabled="true" title="' + esc(a.name) + ' : ' + a.maxPax + ' personnes maximum"' : '') + '>'
        + (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
        + '<span class="fg-card__name">' + esc(a.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prixCarte(a)) + (precisionsCarte(a) ? ' · ' + esc(precisionsCarte(a)) : '') + '</span>'
        + (peu ? '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>Il faut être au moins ' + a.minPax + ' joueurs. Vous êtes ' + state.pax + '.</span>' : '')
        + (ferme ? '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>Indisponible ' + esc(minuscule(jourLong(state.date))) + '.</span>' : '')
        + '</div>'
        + rendreOption(a)
        + '</li>';
    }).join('') || ('<li class="fg-empty">Aucune activité ne se réserve en ligne pour le moment.' + ligneCentre() + '</li>');
    // Une carte deja cochee (retour a cet ecran) montre sa photo tout de suite.
    $$('.fg-card.is-on', gridAct).forEach(chargerPhotoCarte);
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
          + '<ul class="fg-for__list">' + (f.desc || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
          + (regles.length ? '<span class="fg-for__rules">' + regles.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span>' : '')
          + (v.ok ? '' : '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>' + esc(v.pourquoi) + '</span>')
          + '</div>'
          + (f.kidsOnly && v.ok ? rendreEnfants(f) : '')
          + '</li>';
      }).join('');
      return '<section class="fg-fam"><h3 class="fg-fam__title">' + esc(libelleFamille(cle)) + '<span>' + parFamille[cle].length + ' formule' + (parFamille[cle].length > 1 ? 's' : '') + '</span></h3>'
        + '<ul class="fg-grid fg-grid--for">' + cartes + '</ul></section>';
    }).join('');
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
    btn.classList.remove('is-wake'); void btn.offsetWidth; btn.classList.add('is-wake');
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
    if (bump && b) { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); }
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
    var prix = $('.fg-card__price', item);
    if (!prix || !a) return;
    var avant = prix.textContent;
    prix.textContent = prixCarte(a) + (precisionsCarte(a) ? ' · ' + precisionsCarte(a) : '');
    if (anime && prix.textContent !== avant) rejouer(prix, 'is-maj');
  }
  function basculerActivite(card) {
    // Refusee pour ce groupe : on fait lire la raison, on ne coche pas.
    if (card && card.classList.contains('is-refus')) {
      var pourquoi = card.querySelector('.fg-for__off');
      if (pourquoi) { pourquoi.classList.remove('is-pulse'); void pourquoi.offsetWidth; pourquoi.classList.add('is-pulse'); dire(pourquoi.textContent.trim()); }
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
    majPrixCarte(item, activite(id), on);
    rendreCompteur(true);
    invaliderDispo();
    setTimeout(posterHauteur, 320);
  }
  gridAct.addEventListener('click', function (e) {
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
      if (pourquoi) { pourquoi.classList.remove('is-pulse'); void pourquoi.offsetWidth; pourquoi.classList.add('is-pulse'); dire(pourquoi.textContent.trim()); }
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
  var reveilGarder = false;    // « Garder » s eveille a la premiere reponse apres l arrivee sur les heures, pas a chaque heure posee
  var signaturePistes = '';    // les pistes rendues (activites + heures) : sinon, on met a jour sur place
  var adaptation = null;       // { deplace, pour, t } : l activite deplacee pour l heure posee
  function invaliderDispo() { state.dispo = null; state.creneau = null; state.heure = ''; state.pins = {}; state.laserParts = []; adaptation = null; signaturePistes = ''; goContact.disabled = true; }
  function programme() {
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
      return ligne;
    });
  }
  function nomsChoisis() {
    if (state.onglet === 'formules') { var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0]; return f ? f.name : ''; }
    return state.selection.map(nomActivite).join(' + ');
  }
  function urlDispo() {
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
    var cible = (piste && ($('.fg-period.is-open .fg-chip[aria-selected="true"]', piste) || $('.fg-period.is-open .fg-period__btn', piste)))
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
    goContact.disabled = true;
    hourZone.classList.add('is-busy');
    fetch(urlDispo(), { credentials: 'omit' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (id !== requeteEnCours) return;
        if (!j || j.ok === false) throw erreurLisible(j, 'Les horaires ne se sont pas chargés. Réessayez dans un instant.');
        state.dispo = j; state.dispoCle = cle;
        var slot = (j.slots || [])[0] || null;
        state.creneau = slot ? { slot: slot, reponse: j } : null;
        state.heure = slot ? slot.time : '';
        hourZone.classList.remove('is-busy');
        rendreHeures();
        $$('.fg-chip.is-pending', hourZone).forEach(function (c) { c.classList.remove('is-pending'); });
        var posee = idAttente ? $('.fg-track[data-activity="' + idAttente + '"] .fg-chip[data-time="' + heureAttente + '"]', hourZone) : null;
        if (posee && posee.classList.contains('is-on') && planRetient(idAttente, heureAttente)) rejouer(posee, 'is-pose');
        goContact.disabled = !slot;
        if (slot && reveilGarder) { reveilGarder = false; eveiller(goContact); }
        rendreFocus(repere);
      })
      .catch(function (err) {
        if (id !== requeteEnCours) return;
        hourZone.classList.remove('is-busy');
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
  var MOTS_DURS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', schedule_free: 'trop tard', resource_conflict: 'complet', business_rules: 'non valable', off_grid: 'hors grille', unknown_anchor: 'indispo', anchor_overlap: 'occupé' };
  function etatHeure(t, idPiste) {
    if (t.ok === false) {
      var autre = t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId && t.conflict.activityId !== idPiste;
      if (autre) return { etat: 'shift', mot: 'décale', raison: t.reason || 'Chevauche une autre activité', conflit: t.conflict };
      // Sa propre partie garde son conflit : la phrase dira laquelle, et quand elle joue.
      return { etat: 'hard', mot: MOTS_DURS[t.code] || 'indispo', raison: t.reason || 'Indisponible', conflit: t.code === 'anchor_overlap' ? (t.conflict || null) : null };
    }
    if (t.warning) return { etat: 'soft', mot: 'serré', raison: t.warning.reason || 'Peu de temps pour le reste de la visite', conflit: null };
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
  // (Movsar, 2026-09-24 : « trop long, mal explique ») : ce qui coince, et ce
  // que le toucher fait quand il fait bouger autre chose. Chaque phrase CITE ce
  // que le moteur a dit : sa raison, ou l activite en conflit avec la plage
  // que le plan lui donne. Rien n est invente, tout se retrouve dans la reponse.
  function phraseRaison(g, nomPiste) {
    var piste = nomBas(nomPiste || 'activité');
    if (g.etat === 'shift') {
      var plage = g.conflit.id ? plageOccupee(state.creneau, g.conflit.id, g.conflit.time) : '';
      var quand = plage ? ' (' + plage + ')' : ' de ' + g.conflit.time;
      // Une partie de laser parmi d autres posees : elle seule se libere et
      // passe sans heure. Seule posee, le moteur la replace, comme le bowling.
      if (g.conflit.id === 'laser_game' && state.laserParts.length > 1 && rangPartie(g.conflit.time)) {
        return 'Pendant votre partie ' + rangPartie(g.conflit.time) + ' de laser game' + quand + ', qui passe sur place avec l’équipe.';
      }
      return 'Pendant votre ' + nomBas(String(g.conflit.label || 'autre activité').replace(/\s*\(partie \d+\)$/, '')) + quand + ', qui se décale avant ou après.';
    }
    if (g.etat === 'soft') return 'Possible, mais ' + minuscule(g.raison) + '.';
    var r = g.raison || 'Indisponible';
    switch (g.code) {
      case 'capacity':
      case 'resource_conflict':
        return 'Complet pour votre groupe' + (r && r !== 'Complet' ? ' : ' + minuscule(r) : '') + '.';
      case 'schedule':
        return 'Trop tard : ' + minuscule(r) + '.';
      case 'schedule_free':
        return 'Trop tard pour tout faire : ' + minuscule(r) + '.';
      case 'blocked':
        return 'Fermé : ' + minuscule(r) + '.';
      case 'anchor_overlap':
        // SA PROPRE PARTIE, que rien ne deplace ici : laquelle, et quand elle joue.
        if (!g.conflit.time) return 'Votre autre partie de ' + piste + ' joue à cette heure.';
        var k = rangPartie(g.conflit.time);
        var sienne = plageOccupee(state.creneau, g.conflit.id || '', g.conflit.time);
        return 'Votre partie' + (k ? ' ' + k : '') + ' de ' + piste + ' joue ' + (sienne ? 'de ' + sienne : 'à ' + g.conflit.time) + '.';
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
    if (ouvrir && ul) { ul.classList.remove('is-fresh'); void ul.offsetWidth; ul.classList.add('is-fresh'); }
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
      var vagues = chips.filter(function (c) { return c.classList.contains('is-wave') && c.dataset.wave; }).map(function (c) { return $('small', c).textContent + ' à ' + c.dataset.time; });
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
      cles.push(['shift', 'décale']);
      phrases.push(decale.length + (decale.length > 1 ? ' décalent ' : ' décale ') + (cibles.length === 1 ? 'votre ' + minuscule(cibles[0]) : 'une autre activité'));
    }
    if (serre.length) {
      cles.push(['soft', 'serré']);
      phrases.push(serre.length + (serre.length > 1 ? ' serrées' : ' serrée'));
    }
    if (dur.length) {
      var mots = uniques(dur.map(function (c) { return (($('small', c) || {}).textContent || '').trim(); }));
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
    // la piste porte une seule note, et la raison reste au survol.
    if (toutSerre && e.etat === 'soft') { e.etat = 'ok'; e.mot = ''; }
    var on = actifs.indexOf(t.time) >= 0;
    var prop = !on && propose === t.time;
    // La partie que le toucher deplace (verdict `move`), s il en deplace une.
    var deplace = t.ok === false && t.move ? String(t.move.replaces || '') : '';
    // Un refus « a soi » sans verdict de deplacement : l heure d une de SES
    // parties, dite comme telle, jamais « pris ».
    if (e.etat === 'hard' && e.conflit && e.conflit.activityId === idPiste && multi && rangPartie(e.conflit.time)) e.mot = 'partie ' + rangPartie(e.conflit.time);
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
    $('small', chip).textContent = on ? (multi ? 'partie ' + rangPartie(t.time) : 'choisi') : (prop ? 'proposé' : e.mot);
  }
  // LES RAISONS D UNE PLAGE, SOUS SES HEURES. Une ligne par raison, avec toutes
  // les heures qui la partagent ; rien pour une plage ou tout est prenable. La
  // puce retenue ou proposee ne s explique pas : c est un choix, pas un
  // obstacle.
  // Chaque heure expliquee POINTE sa ligne (aria-describedby) : un lecteur
  // d ecran lit la raison en arrivant sur l heure.
  function expliquerPeriode(sec, nomPiste) {
    var liste = $('.fg-why-list', sec);
    if (!liste) return;
    var racine = ($('.fg-period__body', sec) || {}).id || 'per';
    var groupes = [], index = {};
    $$('.fg-chip', sec).forEach(function (c) {
      c.removeAttribute('aria-describedby');
      var etat = c.dataset.state;
      // L heure d une de SES parties ne s explique pas ici : son nom est sur
      // la puce (« partie 1 », « 2e groupe »), sa plage dans le cadre des
      // parties ou la note des groupes.
      if (!etat || etat === 'ok' || etat === 'wave' || c.classList.contains('is-on') || c.classList.contains('is-proposed')) return;
      var cle = etat + '|' + (c.dataset.code || '') + '|' + (c.dataset.conflictLabel || '') + '@' + (c.dataset.conflictTime || '') + '|' + (etat === 'shift' ? '' : c.dataset.reason || '');
      if (!index[cle]) {
        index[cle] = {
          etat: etat, code: c.dataset.code || '', raison: c.dataset.reason || '', mot: ($('small', c) || {}).textContent || '',
          conflit: { id: c.dataset.conflict || '', label: c.dataset.conflictLabel || '', time: c.dataset.conflictTime || '' }, heures: [], puces: [],
        };
        groupes.push(index[cle]);
      }
      index[cle].heures.push(c.dataset.time);
      index[cle].puces.push(c);
    });
    liste.innerHTML = groupes.map(function (g, k) {
      return '<li class="fg-why-list__item" id="' + esc(racine) + '-why-' + k + '" data-etat="' + esc(g.etat) + '" data-heures="' + esc(g.heures.join(' ')) + '">'
        + '<i class="fg-key fg-key--' + esc(g.etat) + '">' + esc(g.mot) + '</i>'
        + '<span><b>' + esc(joindreHeures(g.heures)) + '</b> · ' + esc(phraseRaison(g, nomPiste)) + '</span></li>';
    }).join('');
    groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.setAttribute('aria-describedby', racine + '-why-' + k); }); });
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
  // montre qu ils ont selectionne x heures sur x parties »). Chaque partie :
  // son heure et la fin de son dernier groupe (le plan), ou « sur place avec
  // l equipe » quand aucune heure ne la pose (le moteur la laisse alors a
  // l equipe, lib/ops-engine.js). Sans heure choisie, la partie que l equipe
  // propose se dit proposee.
  function debutsDesParties(cr, id) {
    var parParties = {};
    ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || []).forEach(function (b) {
      if (!b || b.activityId !== id || !b.startTime) return;
      var k = Number(b.countIndex) || 1;
      if (!parParties[k] || String(b.startTime) < parParties[k]) parParties[k] = String(b.startTime);
    });
    return Object.keys(parParties).map(function (k) { return parParties[k]; }).sort();
  }
  function rendreParties(track, a) {
    var boite = $('.fg-parts', track);
    if (!boite) return;
    var total = Math.max(1, Number(a.count) || 1);
    var n = state.laserParts.length;
    var heures = n ? state.laserParts.slice() : debutsDesParties(state.creneau, a.activityId);
    var avant = $$('.fg-parts__item', boite).map(function (li) { return li.textContent; });
    var html = '<p class="fg-parts__head"><span>Vos ' + total + ' parties</span><b>'
      + (n ? n + ' heure' + (n > 1 ? 's' : '') + ' choisie' + (n > 1 ? 's' : '') + ' sur ' + total : 'aucune heure choisie') + '</b></p><ol class="fg-parts__list">';
    for (var k = 0; k < total; k += 1) {
      var h = heures[k] || '';
      var plage = h ? plageOccupee(state.creneau, a.activityId, h) : '';
      var fin = plage ? plage.split(' à ').pop() : '';
      html += '<li class="fg-parts__item ' + (h ? (n ? 'is-set' : 'is-proposed') : 'is-free') + '" data-partie="' + (k + 1) + '">'
        + '<i aria-hidden="true">' + (k + 1) + '</i><span><span class="sr-only">Partie ' + (k + 1) + ' : </span>'
        + (h ? '<b>' + esc(h) + '</b>' + (fin ? ' → ' + esc(heureAffichee(fin)) : '') + (n ? '' : ' <small>proposée</small>') : 'sur place avec l’équipe')
        + '</span></li>';
    }
    html += '</ol>';
    // UNE PARTIE SANS HEURE RESTE POSSIBLE, MAIS ELLE SE JOUE AUX PLACES QUI
    // RESTENT (Movsar, 2026-09-28 : « ils peuvent la placer sur place, mais
    // c est mieux s ils choisissent ; la premiere est obligatoire »). Le cadre
    // le dit la ou le client peut agir, juste au-dessus des heures. La
    // premiere partie a toujours son heure : choisie, ou proposee par l equipe.
    var sansHeure = [];
    for (var r = 1; r < total; r += 1) if (!heures[r]) sansHeure.push(String(r + 1));
    if (sansHeure.length) {
      var plusieurs = sansHeure.length > 1;
      html += '<p class="fg-parts__note"><svg aria-hidden="true"><use href="#i-info"/></svg><span>'
        + (plusieurs ? 'Les parties ' : 'La partie ') + esc(joindreListe(sansHeure, ' et ')) + ' se ' + (plusieurs ? 'placeront' : 'placera') + ' sur place avec l’équipe, selon les places libres ce jour-là. '
        + '<b>Mieux vaut ' + (plusieurs ? 'leur' : 'lui') + ' choisir une heure maintenant</b> : touchez une autre heure ci-dessous.</span></p>';
    }
    boite.innerHTML = html;
    // Ce qui a change (une partie posee, deplacee, retiree) monte a sa place.
    $$('.fg-parts__item', boite).forEach(function (li, k) { if (k < avant.length && li.textContent !== avant[k]) li.classList.add('is-maj'); });
  }
  function majPistes(d) {
    var ancres = (d.anchors && d.anchors.activities) || [];
    var defauts = (d.anchors && d.anchors.defaultTimes) || {};
    ancres.forEach(function (a) {
      var track = $('.fg-track[data-activity="' + a.activityId + '"]', hourZone);
      if (!track) return;
      var actifs = actifsDe(a);
      var propose = actifs.length ? '' : (defauts[a.activityId] || '');
      // Ce qui se PREND, deplacements compris : leur verdict est le leur.
      var possibles = (a.times || []).map(verdictDu).filter(function (v) { return v.ok !== false; });
      var toutSerre = possibles.length > 0 && possibles.every(function (v) { return v.warning; });
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
        note.textContent = !toutSerre ? '' : autres.length
          ? 'Serré à toute heure avec votre ' + autres.join(' et votre ') + ' : tout ne tiendra pas avant la fermeture.'
          : 'Serré à toute heure : tout ne tiendra pas avant la fermeture ce jour-là.';
        note.hidden = !toutSerre;
      }
      var vagues = $('.fg-track__waves', track);
      if (vagues) {
        var v = vaguesPour(state.creneau, a.activityId);
        vagues.innerHTML = v ? noteVagues(v, multi) : '';
        vagues.hidden = !v;
      }
      if (multi) rendreParties(track, a);
      var reset = $('[data-reset]', track);
      if (reset) reset.hidden = !actifs.length;
      majPeriodes(track);
    });
  }
  function signatureDe(d) {
    var ancres = (d.anchors && d.anchors.activities) || [];
    if (ancres.length) return ancres.map(function (a) { return a.activityId + ':' + (a.times || []).map(function (t) { return t.time; }).join(','); }).join('|');
    return 'slots:' + (d.slots || []).map(function (s) { return s.time; }).join(',');
  }
  function rendreHeures() {
    var d = state.dispo;
    var ancres = (d.anchors && d.anchors.activities) || [];
    var signature = signatureDe(d);
    if (signature === signaturePistes && $('.fg-track', hourZone)) {
      majPistes(d);
      rendreVisite();
      posterHauteur();
      return;
    }
    var html = '';
    if (ancres.length) {
      // Quarante-huit mots de legende sur un telephone, c etait un mur
      // (Movsar, 2026-09-23 : « ya trop de texte c est abusé surtout sur
      // mobile »). Chaque cle PORTE le contour de la puce qu elle decrit :
      // sous 680 px, les trois contours parlent seuls et la glose disparait.
      html += '<p class="fg-legend fg-rise" style="--i:0">'
        + '<span class="fg-legend__tip">Ce qui coince est expliqué sous chaque plage horaire.</span>'
        + '<span class="fg-legend__key fg-legend__key--soft"><i>Serré</i><em>tout ne tiendra peut-être pas</em></span>'
        + '<span class="fg-legend__key fg-legend__key--shift"><i>Décale</i><em>l’autre activité se déplace</em></span>'
        + '<span class="fg-legend__key fg-legend__key--off"><i>Complet</i><em>impossible ce jour-là</em></span>'
        + '</p>';
      ancres.forEach(function (a, i) {
        var laser = a.activityId === 'laser_game';
        var count = Math.max(1, Number(a.count) || 1);
        var multi = laser && count > 1;
        // Plusieurs parties : une heure par partie ; le compte « x heures
        // choisies sur x » est dans le cadre des parties, juste dessous.
        var detail = multi ? count + ' parties de ' + minutesLabel(a.durationMinutes) + ' · une heure par partie' : (laser ? '1 partie · ' : '') + minutesLabel(a.durationMinutes);
        html += '<section class="fg-track fg-rise" style="--i:' + (i + 1) + '" data-activity="' + esc(a.activityId) + '" data-count="' + count + '">'
          + '<div class="fg-track__head">'
          + (ancres.length > 1 ? '<span class="fg-track__num" aria-hidden="true">' + (i + 1) + '</span>' : '')
          + '<span class="fg-track__icon"><svg aria-hidden="true"><use href="#' + icone(a.activityId) + '"/></svg></span><b>' + esc(a.label || a.activityId) + '</b><span class="fg-track__detail">' + esc(detail) + '</span>'
          + '</div>'
          // Ce qui EXPLIQUE les heures se lit avant elles ; ce qui AGIT sur
          // elles se pose apres. Ni l un ni l autre dans le bandeau : lui ne
          // porte que le rang, l icone, le nom et la duree.
          + (multi ? '<div class="fg-parts"></div>' : '')
          + '<p class="fg-track__waves" hidden></p>'
          + rendreChips(a.times || [], multi, a.activityId)
          + '<div class="fg-track__foot">'
          + '<span class="fg-track__note" role="status" hidden></span>'
          + '<button type="button" class="fg-link fg-track__reset" data-reset="' + esc(a.activityId) + '" hidden>Revenir à l’heure proposée</button>'
          + '</div>'
          + '</section>';
      });
    } else {
      var slots = (d.slots || []).map(function (s) { return { time: s.time, ok: true }; });
      // Sans heure a proposer, l avis unique est celui du bloc de la visite
      // (rendreVisite) : un second avis ici disait deux fois la meme chose.
      if (slots.length) html += '<section class="fg-track fg-rise" style="--i:1" data-activity="">' + rendreChips(slots, false, 'slot') + '</section>';
    }
    html += '<div id="planZone" class="fg-rise" style="--i:' + (ancres.length + 2) + '"></div>';
    hourZone.innerHTML = html;
    signaturePistes = signature;
    keepLabel.textContent = ancres.length ? 'Ces horaires me vont' : 'Cette heure me va';
    if (ancres.length) majPistes(d);
    else { $$('.fg-chip', hourZone).forEach(function (chip) { majChip(chip, { time: chip.dataset.time, ok: true }, state.heure ? [state.heure] : [], ''); }); $$('.fg-track', hourZone).forEach(majPeriodes); }
    rendreVisite();
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    var enTete = e.target.closest('.fg-period__btn');
    if (enTete) {
      var sec = enTete.closest('.fg-period');
      var piste = sec.closest('.fg-track');
      if (piste) piste.dataset.touched = '1';
      if (sec.classList.contains('is-open')) basculerPeriode(sec, false); else montrerPeriode(piste || sec.parentElement, sec);
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
      adaptation = null;
      chargerPlan();
      return;
    }
    var chip = e.target.closest('.fg-chip');
    if (!chip) return;
    var track = chip.closest('.fg-track');
    var t = chip.dataset.time;
    $$('.fg-chip.is-asked', hourZone).forEach(function (c) { c.classList.remove('is-asked'); });
    $$('.fg-why-list__item.is-lit, .fg-parts__item.is-lit, .fg-track__waves.is-lit', hourZone).forEach(function (l) { l.classList.remove('is-lit'); });
    if (chip.dataset.ok === 'false') {
      // Une heure qui ne se prend pas s EXPLIQUE deja : sous sa plage (la
      // ligne qui la concerne s eclaire, plus de seconde boite qui repete), ou,
      // pour l heure d une de SES parties, dans le cadre des parties ou la note
      // des groupes, que la voix redit.
      chip.classList.add('is-asked');
      var cible = null;
      if (chip.dataset.state === 'wave') {
        cible = chip.dataset.partie ? $('.fg-parts__item[data-partie="' + chip.dataset.partie + '"]', track) : $('.fg-track__waves', track);
        dire(t + ' : votre ' + (chip.dataset.partie ? 'partie ' + chip.dataset.partie : $('small', chip).textContent) + ' joue à cette heure.');
      } else {
        var sec = chip.closest('.fg-period');
        cible = sec ? $$('.fg-why-list__item', sec).filter(function (l) { return (' ' + l.dataset.heures + ' ').indexOf(' ' + t + ' ') >= 0; })[0] : null;
      }
      if (cible) { void cible.offsetWidth; cible.classList.add('is-lit'); }
      posterHauteur();
      return;
    }
    var idA = track.dataset.activity;
    if (!idA) {
      // Formule ou visite sans activite planifiee : le creneau se retient tel quel.
      var direct = (state.dispo.slots || []).filter(function (s) { return s.time === t; })[0];
      if (!direct) return;
      state.heure = t;
      state.creneau = { slot: direct, reponse: state.dispo };
      $$('.fg-chip', track).forEach(function (c) { majChip(c, { time: c.dataset.time, ok: true }, [t], ''); });
      // Le creneau vient des slots du serveur : il est retenu tel quel.
      rejouer(chip, 'is-pose');
      rendreVisite();
      goContact.disabled = false;
      return;
    }
    adaptation = null;
    var vague = chip.dataset.state === 'wave' && chip.dataset.wave ? JSON.parse(chip.dataset.wave) : null;
    if ((chip.dataset.state === 'shift' || (vague && chip.dataset.sous === 'shift')) && chip.dataset.conflict) {
      // L heure chevauche l AUTRE activite posee : c est l AUTRE qui bouge. Le
      // bowling se leve, le moteur le replace autour de l heure choisie. Une
      // partie de laser parmi d autres se libere seule et passe sans heure
      // (l equipe la placera sur place) : le reste du choix ne genait
      // personne (meme regle que le tunnel).
      var autre = chip.dataset.conflict;
      if (autre === 'laser_game' && state.laserParts.length > 1 && state.laserParts.indexOf(chip.dataset.conflictTime) >= 0) {
        state.laserParts = state.laserParts.filter(function (h) { return h !== chip.dataset.conflictTime; });
        state.pins.laser_game = state.laserParts[0];
      } else {
        delete state.pins[autre];
        if (autre === 'laser_game') state.laserParts = [];
        adaptation = { deplace: autre, pour: idA, t: t };
      }
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
      if (i >= 0) state.laserParts.splice(i, 1);
      else if (j >= 0) state.laserParts[j] = t;
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
      if (!index[cle]) { index[cle] = { id: b.activityId, partie: Number(b.countIndex) || 1, groupes: [], pistes: 0 }; liste.push(index[cle]); }
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
  function planRetient(id, t) { return blocsDuPlan(state.creneau).some(function (b) { return b.activityId === id && b.startTime === t; }); }
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
    return m > 0 ? '\u00a0· <b>' + esc(insecable(dureeExacte(m))) + '</b> sur place' : '';
  }
  // Ce qu une ligne de programme achete, en mots : les parties, les sessions
  // d un groupe qui tourne, ou la duree (par groupe quand il en joue deux).
  function detailLigne(it) {
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
    return [a.note, a.ageRange ? a.ageRange.replace(/ /g, '\u00a0') : '', a.minPax > 1 ? a.minPax + '\u00a0joueurs minimum' : ''].filter(Boolean).join(' · ');
  }
  // Pas assez de joueurs pour lancer l activite (minPax du catalogue).
  function tropPeu(a) { return Boolean(a && a.minPax > 1 && state.pax < a.minPax); }
  // Une activite que le centre a bloquee pour la journee choisie (verdict du
  // serveur, calendrier servi) : le moteur ne la refuse pas toujours, l ecran
  // ne la propose donc pas.
  function fermeCeJour(a) { var j = jourInfo(state.date); return Boolean(a && j && (j.unavailableActivityIds || []).indexOf(a.id) >= 0); }
  function etapeVisite(o) {
    return '<li class="fg-visit__step' + (o.genre ? ' fg-visit__step--' + o.genre : '') + (o.bouge ? ' is-moved' : '') + '"><b>' + esc(o.heure) + '</b>'
      + '<span>' + (o.icone ? '<svg aria-hidden="true"><use href="#' + o.icone + '"/></svg>' : '') + esc(o.titre) + '</span>'
      + '<small>' + esc(o.detail || '') + '</small></li>';
  }
  // LE BLOC « VOTRE VISITE », COMPLET (Movsar, 2026-09-24 : « plus complet et
  // serieux, vraiment un truc super complet »). L arrivee et son avance sur la
  // premiere activite ; chaque partie a son heure, jusqu a la fin de son
  // dernier groupe, avec ses groupes et ses pistes ; les parties qui se placent
  // sur place ; les activites libres ; la fin ; puis le detail du prix et le
  // paiement. Tout vient de la reponse : le plan, le programme, le prix.
  function formuleChoisie() {
    return state.onglet === 'formules' ? (((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0] || null) : null;
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
      var aPose = Object.keys(state.pins).length > 0 || state.laserParts.length > 0;
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
    var ancrages = formule ? (d.anchors || {}) : {};
    var illimite = Boolean(formule && formule.orderPolicy === 'open_window');
    var libres = items.filter(function (it) { return !planifies[it.activityId]; });
    // Une entree a la journee ne compte pas dans « environ X » : ce temps-la
    // n est pas achete, il est libre toute la journee.
    var minutesLibres = libres.reduce(function (s, it) { return s + (it.dayAccess ? 0 : (Number(it.minutes) || 0)); }, 0);
    var prix = Number(rep.price);
    var complet = !rep.program || rep.program.priceComplete !== false;
    // UNE VISITE FAITE SEULEMENT D ENTREES A LA JOURNEE (la plaine seule) n a
    // pas de fin a annoncer : celle du planning n est qu une estimation, et
    // l annoncer disait « 1 h » a un client qui paie la journee.
    var journee = items.length > 0 && items.every(function (it) { return it.dayAccess; });
    var fin = journee ? '' : (slot.visitEndTime || plan.endTime || '');
    // Le resume de la barre du bas : les heures et le prix de l en-tete de
    // « Votre visite », lus aux memes endroits de la meme reponse.
    var depart = plan.arrivalTime || slot.time || '';
    var span = depart && fin ? '<b>' + esc(depart) + ' → ' + esc(heureAffichee(fin)) + '</b>' + (slot.visitEndsAtClose ? ' (fermeture)' : ' environ')
      : (journee && depart ? 'dès <b>' + esc(depart) + '</b>, toute la journée' : '');
    var sumAvant = $$('b', hourSum).map(function (b) { return b.textContent; });
    hourSum.innerHTML = span + (prix > 0 ? (span ? '\u00a0· ' : '') + '<b>' + esc(euros(prix)) + '</b>' + (complet ? '' : ' + sur place') : '');
    // Ce qui a change dans le resume monte a sa place, une fois. Les <b> sont
    // neufs a chaque appel (innerHTML) : la classe sur un noeud neuf suffit.
    // Resume vide avant (arrivee, erreur, combinaison refusee) : rien ne roule.
    var sumApres = $$('b', hourSum);
    sumApres.forEach(function (b, k) { if (k < sumAvant.length && b.textContent !== sumAvant[k]) b.classList.add('is-maj'); });
    var prixBouge = prix > 0 && sumApres.length > 0 && sumApres[sumApres.length - 1].classList.contains('is-maj');
    var lignes = '';
    var dits = [];
    if (plan.arrivalTime) {
      var avance = parts.length ? minutesEntre(plan.arrivalTime, parts[0].debut) : 0;
      var premiere = parts.length ? ((items.filter(function (x) { return x.activityId === parts[0].id; })[0] || {}).name || nomActivite(parts[0].id)) : '';
      lignes += etapeVisite({ genre: 'in', heure: plan.arrivalTime, titre: 'Arrivée conseillée', detail: avance > 0 ? avance + ' min avant votre ' + nomBas(premiere) : 'on vous accueille' });
    }
    parts.forEach(function (p) {
      var it = items.filter(function (x) { return x.activityId === p.id; })[0] || {};
      var nom = it.name || nomActivite(p.id);
      var total = Number(it.games) || (formule && p.id === 'laser_game' ? Number(ancrages.laserGames) || 0 : 0);
      // « partie 2 sur 3 » compte les PARTIES (countIndex), jamais les groupes
      // d une meme partie : un grand groupe joue chaque partie en plusieurs.
      var quoi = total > 1 ? 'partie ' + p.partie + ' sur ' + total : total === 1 ? '1 partie' : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) + (p.groupes.length > 1 ? ' par groupe' : '') : ''));
      var bouge = Boolean(adaptation && adaptation.deplace === p.id);
      var detail = [p.fin ? 'jusqu’à ' + heureAffichee(p.fin) : '', texteGroupes(p, true), p.pistes > 0 ? p.pistes + ' piste' + (p.pistes > 1 ? 's' : '') : '',
        bouge ? 'déplacé pour votre ' + nomActivite(adaptation.pour) + ' à ' + adaptation.t : ''].filter(Boolean).join(' · ');
      dits.push(nom + (quoi ? ', ' + quoi : '') + ', de ' + p.debut + (p.fin ? ' à ' + heureAffichee(p.fin) : '') + (p.groupes.length > 1 ? ', en ' + p.groupes.length + ' groupes' : '') + (bouge ? ', déplacé' : ''));
      lignes += etapeVisite({ heure: p.debut, icone: icone(p.id), titre: nom + (quoi ? ' · ' + quoi : ''), detail: detail, bouge: bouge });
    });
    // LES PARTIES SANS HEURE : le moteur les laisse a l equipe, sur place.
    function partiesSurPlace(id, nomR, total, posees) {
      if (!(total > 1) || !posees || posees >= total) return;
      var reste = [];
      for (var k = posees + 1; k <= total; k += 1) reste.push(String(k));
      var quelles = 'partie' + (reste.length > 1 ? 's ' : ' ') + joindreListe(reste, ' et ') + ' sur ' + total;
      lignes += etapeVisite({ genre: 'onsite', heure: 'sur place', icone: icone(id), titre: nomR + ' · ' + quelles, detail: 'à placer sur place avec l’équipe' });
      dits.push(nomR + ', ' + quelles + ', à placer sur place avec l’équipe');
    }
    items.forEach(function (it) {
      partiesSurPlace(it.activityId, it.name || nomActivite(it.activityId), Number(it.games) || 0, parts.filter(function (p) { return p.id === it.activityId; }).length);
    });
    if (formule) partiesSurPlace('laser_game', nomActivite('laser_game'), Number(ancrages.laserGames) || 0, parts.filter(function (p) { return p.id === 'laser_game'; }).length);
    if (libres.length) {
      lignes += '<li class="fg-visit__step fg-visit__step--free"><b>libre</b><span>' + libres.map(function (it) { var entre = it.dayAccess ? 'toute la journée' : detailSessions(it); return '<i><svg aria-hidden="true"><use href="#' + icone(it.activityId) + '"/></svg>' + esc(it.name || nomActivite(it.activityId)) + (entre ? ' (' + esc(entre) + ')' : '') + '</i>'; }).join('') + '</span><small>à votre rythme' + (minutesLibres ? ' · ' + esc(dureeApprox(minutesLibres)) : '') + '</small></li>';
    }
    // UNE FORMULE ILLIMITEE se joue a volonte jusqu a la fin de sa periode, au
    // meme prix quelle que soit l heure d arrivee : la ligne dit le temps de
    // jeu qui reste a cette heure-la (arrive a 16:30 au Kids Fun Day, 30 min).
    var jeuRestant = illimite && fin ? minutesEntre(slot.time, fin) : 0;
    if (illimite && jeuRestant > 0) {
      lignes += etapeVisite({ genre: 'free', heure: 'illimité', icone: 'a-formule', titre: formule.name, detail: 'à volonté jusqu’à ' + heureAffichee(fin) + ' · ' + dureeExacte(jeuRestant) + ' de jeu, même prix à toute heure' });
      dits.push(formule.name + ', à volonté jusqu’à ' + heureAffichee(fin) + ' : ' + dureeExacte(jeuRestant) + ' de jeu, même prix à toute heure');
    }
    if (!parts.length && !libres.length && !plan.arrivalTime) lignes = '<li class="fg-visit__step"><b>' + esc(slot.time) + '</b><span>Début</span><small></small></li>' + lignes;
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
        return '<div><dt>' + esc(it.name || nomActivite(it.activityId)) + (det ? ' <small>· ' + esc(det) + '</small>' : '') + '</dt><dd>' + (sait ? esc(euros(it.price)) : 'sur place') + '</dd></div>';
      });
      if (Math.abs(connus - prix) < 0.01) {
        prixHtml = '<dl class="fg-visit__prices">' + lp.join('')
          + '<div class="fg-visit__total"><dt>' + (complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place') + '</dt><dd>' + esc(euros(prix)) + '</dd></div></dl>'
          + '<p class="fg-visit__pay"><svg aria-hidden="true"><use href="#i-card"/></svg>Aucun paiement en ligne : vous réglez sur place, par carte ou en espèces.</p>';
      }
    }
    var html2 = '<div class="fg-visit"><div class="fg-visit__head"><span class="fg-visit__title"><svg aria-hidden="true"><use href="#i-clock"/></svg>Votre visite</span>'
      + (fin ? '<span class="fg-visit__span">' + (plan.arrivalTime ? 'de <b>' + esc(plan.arrivalTime) + '</b> ' : '') + (slot.visitEndsAtClose ? 'jusqu’à la fermeture (<b>' + esc(heureAffichee(fin)) + '</b>)' : illimite ? 'à <b>' + esc(heureAffichee(fin)) + '</b>, fin de la formule' : 'à <b>' + esc(heureAffichee(fin)) + '</b> environ') + surPlace(plan.arrivalTime, fin) + '</span>'
        : (journee && depart ? '<span class="fg-visit__span">dès <b>' + esc(depart) + '</b>, accès toute la journée</span>' : ''))
      + (prix > 0 ? '<span class="fg-visit__price">' + esc(euros(prix)) + (complet ? '' : '<small>le reste se règle sur place</small>') + '</span>' : '')
      + '</div><ol class="fg-visit__list">' + lignes + '</ol>';
    // CE QUE COMPREND LA FORMULE, dans les mots du centre, ceux de sa carte :
    // c est ce qu il vend. Le moteur n en planifie qu une partie (le Kids Fun
    // Day vend « toutes les activites illimitees », le moteur en place deux),
    // il donne les heures, jamais la liste de ce qui est compris.
    var compris = formule ? (formule.desc || []).filter(Boolean) : [];
    if (compris.length) {
      html2 += '<div class="fg-visit__incl"><p class="fg-visit__incl-title"><svg aria-hidden="true"><use href="#a-formule"/></svg>Compris dans ' + esc(formule.name) + '</p>'
        + '<ul>' + compris.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    var avis = (plan.comfortNotices || []).map(function (n) { return typeof n === 'string' ? n : (n && (n.message || n.label)) || ''; }).filter(Boolean);
    if (slot.visitEndsAtClose && Number(slot.visitShortfallMinutes) > 0) avis.unshift('À cette heure, tout ne tiendra pas avant la fermeture : il manque ' + dureeApprox(slot.visitShortfallMinutes) + '. Vous choisirez sur place ce que vous gardez.');
    if (avis.length) html2 += '<p class="fg-visit__warn">' + avis.map(esc).join('<br>') + '</p>';
    html2 += prixHtml;
    // Ce que dit la voix est ce qui est ecrit dans le bloc : l arrivee, chaque
    // partie a son heure et sa fin, les parties sur place, la fin, le prix (et
    // ce qui se regle sur place), les avertissements.
    if (sceneCourante === 'heures') dire(('Votre visite. '
      + (plan.arrivalTime ? 'Arrivée conseillée à ' + plan.arrivalTime + '. ' : '')
      + (dits.length ? dits.join('. ') + '. ' : (plan.arrivalTime ? '' : 'Début à ' + slot.time + '. '))
      + (fin ? (slot.visitEndsAtClose ? 'Jusqu’à la fermeture à ' : illimite ? 'Fin de la formule à ' : 'Fin vers ') + heureAffichee(fin) + '. ' : (journee ? 'Accès toute la journée. ' : ''))
      + (prix > 0 ? euros(prix) + (complet ? '' : ', le reste se règle sur place') + '. ' : '')
      + (compris.length ? 'Compris : ' + compris.join(', ') + '. ' : '')
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
    if (e.target.closest('[data-reset-tout]')) { state.pins = {}; state.laserParts = []; adaptation = null; $$('.fg-track', hourZone).forEach(function (t) { delete t.dataset.touched; }); chargerPlan(); return; }
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
  goContact.addEventListener('click', function () {
    if (goContact.disabled || !state.creneau) return;
    $('#recallLine').textContent = insecable(jourCourt(state.date)) + '\u00a0· ' + insecable(groupeLisible()) + '\u00a0· ' + (state.creneau.slot.opsPlan && state.creneau.slot.opsPlan.arrivalTime ? 'arrivée ' + state.creneau.slot.opsPlan.arrivalTime : state.heure);
    $('#recallBody').innerHTML = htmlRecap(false);
    basculerRappel(false);
    aller('contact');
  });

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
    wrap.classList.remove('is-nudge'); void wrap.offsetWidth; wrap.classList.add('is-nudge');
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
  });

  /* --- Etape 5 : le recapitulatif ------------------------------------------------ */

  // LE RECAPITULATIF, UNE SEULE SOURCE. L ecran des coordonnees le montre en
  // entier a cote du formulaire (Movsar, 2026-09-23 : « pourquoi y a pas le
  // recap ici, y a juste un mini recap ») ; le dernier ecran le reprend, avec
  // les coordonnees qui partiront. Une seule fonction pour les deux :
  // deux rendus finiraient par se contredire.
  function htmlRecap(final) {
    var cr = state.creneau, rep = cr ? cr.reponse : {}, plan = cr ? (cr.slot.opsPlan || {}) : {};
    var lignes = [];
    var items = (rep.program && rep.program.items) || [];
    if (state.onglet === 'formules') {
      var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0] || {};
      lignes.push({ icone: 'a-formule', nom: f.name || rep.label || 'Formule', detail: (f.desc || []).join(' · '), aside: '' });
    } else if (items.length) {
      items.forEach(function (it) {
        // Chaque partie a son heure, celles qui n en ont pas se placent sur
        // place avec l equipe ; les groupes d un grand groupe, leur taille et,
        // pour une activite d une seule partie, leurs departs. Lu dans le plan
        // (vu en prod le 2026-09-23 : « Debut 11:00 », le 2e groupe tu).
        var siennes = partiesDuPlan(cr).filter(function (p) { return p.id === it.activityId; });
        var total = Number(it.games) || 0;
        var morceaux = [];
        if (total > 1) {
          var heures = siennes.map(function (p) { return p.debut; });
          var reste = total - heures.length;
          morceaux.push(total + ' parties' + (heures.length ? ' : ' + joindreListe(heures.concat(reste > 0 ? [reste + ' sur place avec l’équipe'] : []), ' et ') : ', sur place avec l’équipe'));
        } else if (it.dayAccess) {
          morceaux.push('accès toute la journée', ageActivite(it.activityId));
        } else {
          morceaux.push(total === 1 ? '1 partie' : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) + (siennes[0] && siennes[0].groupes.length > 1 ? ' par groupe' : '') : '')));
        }
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
    var html = '<div class="fg-recap__row fg-rise" style="--i:1"><svg aria-hidden="true"><use href="#i-calendar"/></svg><span>' + esc(jourLong(state.date)) + '</span>' + (j && j.periode ? '<i class="fg-tag ' + (j.periode.type === 'public' ? 'fg-tag--ferie' : 'fg-tag--vacances') + '">' + esc(j.periode.label) + '</i>' : '') + '</div>'
      + '<div class="fg-recap__row fg-rise" style="--i:2"><svg aria-hidden="true"><use href="#i-users"/></svg><span>' + esc(groupeLisible()) + '</span></div>'
      + '<div class="fg-recap__sep"></div>';
    lignes.forEach(function (l, i) {
      html += '<div class="fg-recap__item fg-rise" style="--i:' + (3 + i) + '"><span class="fg-recap__badge"><svg aria-hidden="true"><use href="#' + l.icone + '"/></svg></span>'
        + '<span><span class="fg-recap__name">' + esc(l.nom) + '</span>' + (l.detail ? '<br><span class="fg-recap__detail">' + esc(l.detail) + '</span>' : '') + '</span>'
        + '<span class="fg-recap__aside">' + (l.aside ? 'Début<b>' + esc(l.aside) + '</b>' : '<small>à votre rythme</small>') + '</span></div>';
    });
    html += '<div class="fg-recap__sep"></div>'
      + (plan.arrivalTime ? '<div class="fg-recap__row fg-rise" style="--i:' + (3 + lignes.length) + '"><svg aria-hidden="true"><use href="#i-clock"/></svg><span>Arrivée conseillée à <b>' + esc(plan.arrivalTime) + '</b>' + (fin ? (cr.slot.visitEndsAtClose ? ', jusqu’à la fermeture (' + esc(heureAffichee(fin)) + ')' : ', fin vers ' + esc(heureAffichee(fin))) : '') + surPlace(plan.arrivalTime, fin) + '</span></div>' : '')
      + '<div class="fg-total fg-rise" style="--i:' + (4 + lignes.length) + '"><div><div class="fg-total__label">' + (complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place') + '</div>'
      + '<div class="fg-total__amount"' + (final ? ' id="totalAmount"' : '') + ' data-total="' + prix + '">' + (prix > 0 ? esc(euros(prix)) : 'Sur place') + '</div></div>'
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
    return html;
  }
  // LE TOTAL S AFFICHE A SA VALEUR, D EMBLEE. Il montait de 0 a son montant en
  // 700 ms : l audit du 2026-09-28 a lu 25 EUR pour 39, 466 pour 780, et un
  // client qui regarde a ce moment-la voit un prix qui n existe pas.
  function rendreRecap() {
    $('#recap').innerHTML = htmlRecap(true);
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
      notes: [state.contact.occasion === 'autre' && state.contact.occasionAutre ? 'Occasion : ' + state.contact.occasionAutre : '', state.contact.note || ''].filter(Boolean).join('. '),
      // Les heures posees par le client et celles composees par le serveur
      // repartent ensemble : le serveur revalide exactement ce qui a ete montre.
      preference: { preferredTimes: preferredTimes, laserGameTimes: state.laserParts.slice(), laserPlacement: plan && plan.anchorPlan && plan.anchorPlan.laserPlacement === 'onsite' ? 'onsite' : 'scheduled', arrivalConfidence: 'normal' },
      // Le montant affiche part avec la demande, comme dans le tunnel ; le
      // serveur recalcule tout et c est son montant qui est enregistre.
      price: Number(rep.price) || 0,
      basePrice: Number(rep.price) || 0,
      duration: Number(rep.duration) || 1,
      totalDuration: Number(rep.totalDuration) || Number(rep.duration) || 1,
      laneCount: Number(rep.laneCount) || 0,
      requiresLanes: Boolean(rep.requiresLanes),
      label: rep.label || '',
    };
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
  confirmBtn.addEventListener('click', function () {
    if (confirmBtn.classList.contains('is-busy')) return;
    erreurEnvoi('');
    confirmBtn.classList.add('is-busy'); confirmBtn.setAttribute('aria-busy', 'true');
    fetch('/api/public-reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j || {} }; }); })
      .then(function (res) {
        confirmBtn.classList.remove('is-busy'); confirmBtn.removeAttribute('aria-busy');
        if (res.status === 201 && res.json.ok !== false && res.json.reservation) { reussite(res.json); return; }
        // 409 : le serveur refuse de confirmer en ligne ce creneau. Ses
        // alternatives sont dites, sans le creneau refuse ni les doublons.
        // Les heures seront redemandees (dispo vide) ; le creneau refuse reste
        // celui du recapitulatif tant qu aucun autre n est rendu : vide, le
        // recapitulatif rouvert par « vos coordonnees » perdait son plan et
        // son prix (« Sur place »).
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
    // bouge) ; le programme, les noms seuls (les heures, groupes scindes
    // compris, sont au recapitulatif : un troisieme rendu du plan finirait par
    // le contredire) ; l e-mail n est annonce que si la reponse l a mis en
    // file (le centre peut couper l envoi) ; le montant dit ce qu il couvre,
    // comme le total du recapitulatif.
    var planFin = r.opsPlan && typeof r.opsPlan === 'object' ? r.opsPlan : (heureRes === state.heure && state.creneau ? (state.creneau.slot.opsPlan || {}) : {});
    var arrivee = planFin.arrivalTime ? String(planFin.arrivalTime) : '';
    var quoi = nomsChoisis();
    var repFin = (state.creneau || {}).reponse || {};
    var prixComplet = !repFin.program || repFin.program.priceComplete !== false;
    var comms = Array.isArray(reponse.communications) ? reponse.communications : [];
    var mailQ = comms.filter(function (c) { return c && c.channel === 'email' && c.status !== 'draft' && (c.templateId === 'confirmation' || c.templateId === 'request_received'); })[0];
    var nomRes = String(r.name || (state.contact.prenom + ' ' + state.contact.nom)).trim();
    var quand = '<b>' + esc(jourLong(dateRes)) + '</b>, ' + esc(personnes(paxRes)) + (arrivee ? '. Arrivée conseillée à <b>' + esc(arrivee) + '</b>.' : ', à <b>' + esc(heureRes) + '</b>.') + (confirme ? ' C’est réservé&nbsp;: on vous attend&nbsp;!' : ' L’équipe vérifie votre demande et vous répond sous 24 heures ouvrables.');
    var ligneMail = mailQ ? (mailQ.templateId === 'confirmation' ? 'La confirmation part à ' : 'Un accusé de réception part à ') + '<b>' + esc(mailRes) + '</b>.' : 'Au nom de <b>' + esc(nomRes) + '</b>, ' + esc(mailRes) + '.';
    var ligneMontant = Number(r.price) > 0 ? 'Montant estimé <b>' + esc(euros(r.price)) + '</b>' + (prixComplet ? ', à régler' : ', hors activités réglées sur place. Tout est à régler') + ' sur place, par carte ou en espèces.' : 'Tout se règle sur place, par carte ou en espèces.';
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
  var SM_JS = '/assets/fungalaxy-sur-mesure.js?v=20260929a';
  var SM_CSS = '/assets/fungalaxy-sur-mesure.css?v=20260929a';
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
    if (!meta) { direErreur(panneMeta || 'Le formulaire se charge encore. Réessayez dans un instant.'); return; }
    direErreur('');
    if (smModule) { smModule.ouvrir(); return; }
    var btn = bouton && bouton.classList ? bouton : null;
    var occupe = function (on) { if (!btn) return; btn.classList.toggle('is-busy', on); if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); };
    occupe(true);
    chargerSurMesure().then(function (m) { occupe(false); m.ouvrir(); }).catch(function () {
      occupe(false);
      var c = meta && meta.center && meta.center.contact;
      direErreur('La demande sur mesure ne s’est pas chargée. Vérifiez votre connexion et réessayez' + (c && c.phone ? ', ou appelez le centre au ' + c.phone : '') + '.');
    });
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
      secouer: secouer, sortieClavier: sortieClavier,
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
  // l onglet, en entrant dans les activites, et toutes les 10 s tant qu il
  // montre les activites ou les heures. Rien ne bouge si rien n a change ;
  // sinon les cartes se redessinent, la selection et les reglages gardes
  // (ramenes aux nouvelles limites), et les heures se recalculent.
  var empreinteCatalogue = '';
  function empreinteDuCatalogue(j) { return JSON.stringify([(j && j.activities) || [], (j && j.formules) || [], (j && j.center && j.center.customRequest) || null]); }
  function rafraichirCatalogue() {
    // Pas pendant les coordonnees ni le recapitulatif : le client relit ce
    // qu il va envoyer, et le serveur revalide tout a l envoi.
    if (!meta || doc.hidden || ['date', 'activites', 'heures', 'sm-envies'].indexOf(sceneCourante) < 0) return;
    var q = new URLSearchParams(); q.set('centerId', CENTER);
    fetch('/api/public-booking-meta?' + q.toString(), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok === false || !Array.isArray(j.activities)) return;
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
          return a && !(a.maxPax && state.pax > a.maxPax) && !tropPeu(a);
        });
        if (state.formuleId && !((meta.formules || []).filter(function (x) { return x.id === state.formuleId; })[0])) state.formuleId = '';
        rendreActivites();
        rendreFormules();
        rendreCompteur(false);
        // Les heures deja posees restent : seule la disponibilite se recalcule.
        state.dispo = null;
        if (sceneCourante === 'heures') chargerHeures();
      })
      .catch(function () {});
  }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) rafraichirCatalogue(); });
  setInterval(function () { if (sceneCourante === 'activites' || sceneCourante === 'heures' || sceneCourante === 'sm-envies') rafraichirCatalogue(); }, 10000);
  $('#goActivities').addEventListener('click', function () { rafraichirCatalogue(); });

  /* --- Le demarrage ----------------------------------------------------------------- */

  function demarrer() {
    poserPhotos();
    decouperTitres();
    espacerTitreActif();
    rendreEtapes();
    rendrePax();
    var q = new URLSearchParams(); q.set('centerId', CENTER); q.set('calendar', '45');
    fetch('/api/public-booking-meta?' + q.toString(), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok === false) throw erreurLisible(j, 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.');
        meta = j; direErreur('');
        empreinteCatalogue = empreinteDuCatalogue(j);
        if (meta.center && meta.center.status && meta.center.status !== 'active') {
          direErreur('Ce centre n’ouvre pas encore ses réservations en ligne.');
        }
        if (meta.center && meta.center.demonstration === true) {
          direErreur('Ce formulaire est une démonstration : rien n’y est enregistré.');
        }
        absorberCalendrier(meta.center && meta.center.calendar);
        // Le premier jour ouvert : aujourd hui si le centre est ouvert, sinon
        // le prochain.
        var premier = Object.keys(jours).sort().filter(function (s) { return jours[s].ouvert; })[0];
        if (premier) choisirJour(premier);
        rendrePax();
        rendreActivites();
        rendreFormules();
        rendreCompteur(false);
        choisirOnglet('activites');
        body.classList.add('is-ready');
        posterHauteur();
      })
      .catch(function (err) { panneMeta = err && err.lisible ? err.message : 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.'; direErreur(panneMeta); body.classList.add('is-ready'); });
    posterHauteur();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
