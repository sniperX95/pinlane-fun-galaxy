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
    var h = Math.max(body.scrollHeight, body.offsetHeight);
    if (!h || Math.abs(h - derniereHauteur) < 8) return;
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
      root.style.setProperty('--tunnel-vue-haut', (Number(d.cacheEnHaut) || 0) + 'px');
      root.style.setProperty('--tunnel-vue-bas', (Number(d.cacheEnBas) || 0) + 'px');
      root.style.setProperty('--tunnel-vue-ecran', (Number(d.hauteurEcran) || 0) + 'px');
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
    onglet: 'activites',
    pins: {},                  // activityId -> 'HH:MM' : les heures que le client a posees
    laserParts: [],            // heures des parties de laser posees (si plusieurs parties)
    heure: '',                 // debut de visite du creneau retenu
    dispo: null,               // la derniere reponse de public-availability
    creneau: null,             // le slot retenu (avec opsPlan)
    contact: { prenom: '', nom: '', email: '', telephone: '' },
    reservation: null,
  };
  var SCENES = ['date', 'activites', 'heures', 'contact', 'recap', 'fin'];
  var ETAPES = [
    { id: 'date', label: 'Date & groupe' },
    { id: 'activites', label: 'Activités' },
    { id: 'heures', label: 'Créneaux' },
    { id: 'contact', label: 'Contact' },
    { id: 'recap', label: 'Confirmation' },
  ];
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
  // « 3 sessions de 15 min » quand le groupe tourne sur une installation qui
  // ne le prend pas d un coup (Fun Run). `sessions` est calcule par le
  // SERVEUR (lib/visit-program) et voyage dans la ligne de programme.
  function detailSessions(it) {
    var n = Math.trunc(Number(it && it.sessions) || 1);
    var mn = Number(it && it.minutes) || 0;
    if (n < 2 || !mn) return '';
    return n + ' sessions de ' + minutesLabel(Math.round(mn / n));
  }
  function minutesLabel(m) { m = Number(m) || 0; if (m >= 60) { var h = Math.floor(m / 60), r = m % 60; return r ? h + 'h' + String(r).padStart(2, '0') : h + ' heure' + (h > 1 ? 's' : ''); } return m + ' min'; }
  function dureeApprox(m) { m = Number(m) || 0; if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; return 'environ ' + h + ' h' + (r >= 30 ? '30' : ''); }
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
  // « 12 personnes : 3 sessions, 5 joueurs a la fois. » Vide quand le groupe
  // passe en une fois.
  function noteRotation(a) {
    var n = sessionsPour(a);
    if (n < 2) return '';
    var places = Math.trunc(Number(a.capacityPerUnit) || 0) * Math.max(1, Math.trunc(Number(a.units) || 1));
    return 'Le groupe tourne : ' + n + ' sessions, ' + places + ' joueurs à la fois.';
  }
  function prixCarte(a) {
    if (!meta) return '';
    var opt = optionChoisie(a);
    if (opt) {
      if (state.selection.indexOf(a.id) >= 0) return euros(opt.prix) + ' ' + opt.unite;
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

  function rendreEtapes() {
    var rang = SCENES.indexOf(sceneCourante);
    var actif = Math.min(rang, ETAPES.length - 1);
    var html = ETAPES.map(function (e, i) {
      var cls = i < actif || sceneCourante === 'fin' ? 'is-done' : (i === actif ? 'is-active' : '');
      var cliquable = i < actif && sceneCourante !== 'fin';
      var inner = '<span class="fg-steps__dot"><span>' + (i + 1) + '</span><svg aria-hidden="true"><use href="#i-check"/></svg></span><span class="lbl">' + esc(e.label) + '</span>';
      return '<li class="fg-steps__item ' + cls + '" ' + (i === actif ? 'aria-current="step"' : '') + '>'
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

  /* --- Les scenes ----------------------------------------------------------------- */

  var stage = $('#fgStage');
  var enTransition = false;
  var transitionId = 0;
  function chargerPhoto(scene) {
    var img = $('.fg-art img', scene);
    if (!img || !img.dataset.src) return;
    img.srcset = img.dataset.srcset || '';
    img.src = img.dataset.src;
    delete img.dataset.src; delete img.dataset.srcset;
  }
  function aller(cible, retour) {
    if (cible === sceneCourante || enTransition) return;
    var de = $('.fg-scene[data-scene="' + sceneCourante + '"]');
    var vers = $('.fg-scene[data-scene="' + cible + '"]');
    if (!vers) return;
    sceneCourante = cible;
    body.dataset.step = String(SCENES.indexOf(cible) + 1);
    rendreEtapes();
    chargerPhoto(vers);
    // La photo de la scene suivante se precharge pendant que celle-ci se lit.
    var suivante = $('.fg-scene[data-scene="' + SCENES[SCENES.indexOf(cible) + 1] + '"]');
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
      };
      var surScene = function (e) {
        if (e.target !== vers) return;
        vers.removeEventListener('animationend', surScene);
        fini();
      };
      vers.addEventListener('animationend', surScene);
      setTimeout(function () { vers.removeEventListener('animationend', surScene); fini(); }, 600);
    }
    poster({ type: 'pinlane:screen' });
    if (!EMBED) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    var focus = $('.fg-title', vers);
    if (focus) { focus.setAttribute('tabindex', '-1'); focus.focus({ preventScroll: true }); }
    setTimeout(posterHauteur, 50);
  }
  function precedent() {
    var i = SCENES.indexOf(sceneCourante);
    if (i > 0) aller(SCENES[i - 1], true);
  }
  $$('[data-back]').forEach(function (b) { b.addEventListener('click', precedent); });
  doc.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-goto]');
    if (b) aller(b.dataset.goto, true);
  });

  /* --- Alerte globale ------------------------------------------------------------ */

  var alerte = $('#fgAlert');
  function direErreur(msg) { alerte.textContent = msg; alerte.hidden = !msg; if (msg) posterHauteur(); }

  /* --- Etape 1 : le jour (calendrier par mois) ----------------------------------- */

  var dayBtn = $('#dayBtn'), dayPop = $('#dayPop'), dayLabel = $('#dayLabel'), dayHint = $('#dayHint');
  var calTitle = $('#calTitle'), calGrid = $('#calGrid'), calInfo = $('#calInfo'), calPrev = $('#calPrev'), calNext = $('#calNext');
  var dayField = dayBtn.closest('.fg-field');
  // Le calendrier vient du serveur (center.calendar, a cote de center.day) :
  // ouverture, horaires, fermeture, ferie ou conge scolaire, jour par jour.
  // Les 45 premiers jours arrivent avec le catalogue ; les mois suivants se
  // demandent quand on les ouvre (calendarFrom), et restent en memoire.
  var jours = {};              // 'YYYY-MM-DD' -> l entree servie
  var moisCharges = {};        // 'YYYY-MM' -> true | Promise
  var moisVu = null;           // { y, m } du mois affiche
  var jourFocus = '';          // le jour porte par le clavier dans la grille
  function aujourdhui() { return meta && meta.today ? String(meta.today) : iso(new Date()); }
  function horizon() {
    var n = Number(meta && meta.bookingHorizonDays) || 365;
    var t = deIso(aujourdhui());
    return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
  }
  function entreeJour(entry) {
    return { date: entry.date, ouvert: Boolean(entry.open), horaire: entry.open ? horaireLabel(entry.schedule) : (entry.closedLabel || 'Fermé'), periode: entry.holiday ? { type: entry.holiday.type, label: accentuer(entry.holiday.label) } : null, coupures: entry.closedWindows || [] };
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
    // Un jour qui avait le focus le retrouve apres le rendu : sans cela, le
    // second rendu (fin du chargement du mois) jetait le focus du clavier.
    var avaitFocus = calGrid.contains(doc.activeElement);
    var y = moisVu.y, m = moisVu.m;
    var today = aujourdhui(), fin = horizon();
    calTitle.textContent = cap(MOIS[m]) + ' ' + y;
    var decalage = (new Date(y, m, 1).getDay() + 6) % 7; // lundi en tete
    var n = joursDuMois(y, m);
    var html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (l, i) { return '<span class="fg-cal__wd" role="columnheader" aria-label="' + esc(cap(JOURS[(i + 1) % 7])) + '">' + l + '</span>'; }).join('');
    for (var v = 0; v < decalage; v += 1) html += '<span class="fg-cal__void" role="presentation"></span>';
    var focusable = '';
    for (var d = 1; d <= n; d += 1) {
      var s = cleMois(y, m) + '-' + String(d).padStart(2, '0');
      var j = jours[s];
      var passe = s < today, loin = s > fin;
      var off = passe || loin || !j || !j.ouvert;
      var cls = 'fg-cal__day' + (off ? ' is-off' : '') + (passe ? ' is-past' : '') + (s === today ? ' is-today' : '') + (s === state.date ? ' is-selected' : '') + (j && j.periode ? (j.periode.type === 'public' ? ' is-ferie' : ' is-vacances') : '') + (!j && !passe && !loin ? ' is-loading' : '');
      var titre = j ? infoTexte(j) : (passe ? 'Date passée' : (loin ? 'Au-delà de la période de réservation' : 'Chargement…'));
      if (!off && !focusable) focusable = s;
      html += '<button type="button" class="' + cls + '" data-date="' + s + '" role="gridcell" aria-selected="' + (s === state.date) + '" aria-label="' + esc(titre) + '" title="' + esc(titre) + '" ' + (off ? 'disabled' : '') + ' tabindex="-1">' + d + (j && j.periode ? '<i></i>' : '') + '</button>';
    }
    calGrid.innerHTML = html;
    var cible = (jourFocus && jourFocus.slice(0, 7) === cleMois(y, m) && $('.fg-cal__day[data-date="' + jourFocus + '"]:not([disabled])', calGrid)) ? jourFocus : (state.date.slice(0, 7) === cleMois(y, m) ? state.date : focusable);
    var b = cible ? $('.fg-cal__day[data-date="' + cible + '"]', calGrid) : null;
    if (b) { b.setAttribute('tabindex', '0'); jourFocus = cible; if (avaitFocus && !b.disabled) b.focus({ preventScroll: true }); }
    calPrev.disabled = cleMois(y, m) <= today.slice(0, 7);
    calNext.disabled = cleMois(y, m + 1) > fin.slice(0, 7);
    calInfo.textContent = infoTexte(jours[state.date]) || 'Choisissez un jour.';
    setTimeout(posterHauteur, 50);
  }
  function montrerMois(y, m, focusAu) {
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    moisVu = { y: y, m: m };
    if (focusAu) jourFocus = focusAu;
    rendreCalendrier();
    // Un mois deja complet ne se redessine pas une seconde fois.
    if (moisCharges[cleMois(y, m)] === true) return;
    chargerMois(y, m).then(function () { if (moisVu && moisVu.y === y && moisVu.m === m) rendreCalendrier(); });
  }
  function choisirJour(dateStr) {
    state.date = dateStr;
    dayLabel.textContent = jourLong(dateStr);
    var j = jourInfo(dateStr);
    var morceaux = [];
    if (j) {
      morceaux.push(j.ouvert ? 'Ouvert ' + j.horaire : j.horaire);
      if (j.periode) morceaux.push(j.periode.type === 'public' ? 'Férié : ' + j.periode.label : j.periode.label);
      if (j.coupures && j.coupures.length) morceaux.push('Fermé ' + j.coupures.map(function (c) { return c.start + '-' + c.end; }).join(', '));
    }
    dayHint.textContent = morceaux.join(' · ');
    dayBtn.setAttribute('title', dayHint.textContent);
    invaliderDispo();
  }
  function ouvrirJours(ouvrir) {
    var o = typeof ouvrir === 'boolean' ? ouvrir : dayPop.hidden;
    if (o) { var d = deIso(state.date || aujourdhui()); montrerMois(d.getFullYear(), d.getMonth(), state.date); }
    dayPop.hidden = !o;
    dayBtn.setAttribute('aria-expanded', String(o));
    // Le champ passe au-dessus de ses voisins tant que le calendrier est
    // ouvert : chaque champ anime porte son propre contexte d empilement.
    if (dayField) dayField.classList.toggle('is-open', o);
    if (o) { var b = $('.fg-cal__day[tabindex="0"]', calGrid); if (b) b.focus({ preventScroll: true }); }
    setTimeout(posterHauteur, 260);
  }
  dayBtn.addEventListener('click', function () { ouvrirJours(); });
  calPrev.addEventListener('click', function () { if (moisVu) montrerMois(moisVu.y, moisVu.m - 1, ''); });
  calNext.addEventListener('click', function () { if (moisVu) montrerMois(moisVu.y, moisVu.m + 1, ''); });
  calGrid.addEventListener('click', function (e) {
    var b = e.target.closest('.fg-cal__day');
    if (!b || b.disabled) return;
    choisirJour(b.dataset.date);
    ouvrirJours(false);
    dayBtn.focus();
  });
  calGrid.addEventListener('mouseover', function (e) { var b = e.target.closest('.fg-cal__day'); if (b && jours[b.dataset.date]) calInfo.textContent = infoTexte(jours[b.dataset.date]); });
  calGrid.addEventListener('mouseleave', function () { calInfo.textContent = infoTexte(jours[state.date]) || 'Choisissez un jour.'; });
  calGrid.addEventListener('focusin', function (e) { var b = e.target.closest('.fg-cal__day'); if (b && jours[b.dataset.date]) calInfo.textContent = infoTexte(jours[b.dataset.date]); });
  // Le clavier : fleches d un jour ou d une semaine, en changeant de mois au
  // bord ; Entree ou Espace choisit ; Echap ferme.
  function deplacerFocus(delta) {
    var depart = deIso(jourFocus || state.date || aujourdhui());
    var today = aujourdhui(), fin = horizon();
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
    if (e.key === 'Escape') { ouvrirJours(false); dayBtn.focus(); return; }
    var dans = e.target && e.target.closest && e.target.closest('#dayPop');
    if (!dans) return;
    var pas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (pas) { e.preventDefault(); deplacerFocus(pas); }
  });
  doc.addEventListener('click', function (e) { if (!dayPop.hidden && !e.target.closest('.fg-day')) ouvrirJours(false); });

  /* --- Etape 1 : le groupe ------------------------------------------------------- */

  var paxOut = $('#paxOut'), paxInput = $('#paxInput'), paxHint = $('#paxHint');
  var PAX_MIN = 1, PAX_MAX = 240;
  function rendrePax() {
    paxOut.textContent = personnes(state.pax);
    if (String(paxInput.value) !== String(state.pax) && doc.activeElement !== paxInput) paxInput.value = String(state.pax);
    $('#paxMinus').disabled = state.pax <= PAX_MIN;
    $('#paxPlus').disabled = state.pax >= PAX_MAX;
    var lanes = meta && meta.center && meta.center.booking;
    if (lanes && lanes.laneCount && lanes.normalCapacityPerLane) {
      var confort = lanes.laneCount * lanes.normalCapacityPerLane;
      paxHint.textContent = state.pax > confort
        ? 'Grand groupe : au-delà de ' + confort + ' personnes, certaines activités se jouent en plusieurs groupes. On vous le montre à l’étape des horaires.'
        : '';
    }
    invaliderDispo();
  }
  function poserPax(n) {
    n = Math.min(PAX_MAX, Math.max(PAX_MIN, Math.trunc(Number(n) || 0)));
    if (n === state.pax) return;
    state.pax = n;
    rendrePax();
  }
  $('#paxMinus').addEventListener('click', function () { poserPax(state.pax - 1); paxInput.value = String(state.pax); });
  $('#paxPlus').addEventListener('click', function () { poserPax(state.pax + 1); paxInput.value = String(state.pax); });
  // Le nombre se tape aussi : la valeur se prend des qu elle est lisible, et
  // se remet au propre quand le champ est quitte (vide ou hors bornes).
  paxInput.addEventListener('input', function () { var v = parseInt(paxInput.value, 10); if (isFinite(v) && v >= PAX_MIN) poserPax(v); });
  paxInput.addEventListener('blur', function () { paxInput.value = String(state.pax); });
  paxInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); paxInput.blur(); } });

  $('#goActivities').addEventListener('click', function () {
    if (!state.date) { direErreur('Choisissez d’abord un jour.'); dayBtn.focus(); return; }
    direErreur('');
    // Le groupe a pu changer depuis le dernier rendu : une activite bornee
    // (Fun Run, 5 joueurs) sort de la selection si le groupe la depasse.
    state.selection = state.selection.filter(function (id) {
      var a = activite(id);
      return a && !(a.maxPax && state.pax > a.maxPax);
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
  function rendreOption(a) {
    var liste = optionsPour(a);
    if (!liste.length) return '';
    var i = indexOption(a);
    var idTitre = 'opt-' + String(a.id).replace(/[^a-z0-9_-]/gi, '');
    return '<div class="fg-card__opt"><div class="fg-card__optin"><div class="fg-card__optbox">'
      + '<span class="fg-card__optlabel" id="' + idTitre + '">' + esc(TITRES_OPTION[liste[0].cle] || 'Option') + '</span>'
      + '<div class="fg-pills" role="radiogroup" aria-labelledby="' + idTitre + '" data-n="' + liste.length + '">'
      + liste.map(function (o, k) {
        return '<button type="button" class="fg-pill' + (k === i ? ' is-on' : '') + '" role="radio" aria-checked="' + (k === i) + '" tabindex="' + (k === i ? '0' : '-1') + '" data-valeur="' + esc(String(o.valeur)) + '"><b>' + esc(o.label) + '</b><small>' + esc(euros(o.prix)) + '</small></button>';
      }).join('')
      + '</div>'
      + (noteRotation(a) ? '<p class="fg-card__rot">' + esc(noteRotation(a)) + '</p>' : '')
      + '</div></div></div>';
  }
  function choisirPastille(pill) {
    var item = pill.closest('.fg-grid__item');
    var a = activite(item.dataset.activity);
    var o = optionsPour(a).filter(function (x) { return String(x.valeur) === pill.dataset.valeur; })[0];
    if (!a || !o) return;
    state.options[a.id] = {};
    state.options[a.id][o.cle] = o.valeur;
    $$('.fg-pill', item).forEach(function (x) { var on = x === pill; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    majPrixCarte(item, a);
    invaliderDispo();
  }
  function rendreActivites() {
    gridAct.innerHTML = activitesVendables().map(function (a, i) {
      var p = photo(a.id);
      var on = state.selection.indexOf(a.id) >= 0;
      var trop = a.maxPax && state.pax > a.maxPax;
      return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '" data-activity="' + esc(a.id) + '">'
        + '<div class="fg-card fg-rise' + (on ? ' is-on' : '') + (trop ? ' is-off' : '') + '" style="--i:' + (i % 8) + '" data-activity="' + esc(a.id) + '" role="checkbox" tabindex="' + (trop ? '-1' : '0') + '" aria-checked="' + on + '" ' + (trop ? 'aria-disabled="true" title="' + esc(a.name) + ' : ' + a.maxPax + ' personnes maximum"' : '') + '>'
        + (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
        + '<span class="fg-card__name">' + esc(a.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prixCarte(a)) + (a.note ? ' · ' + esc(a.note) : '') + '</span>'
        + '</div>'
        + rendreOption(a)
        + '</li>';
    }).join('') || '<li class="fg-empty">Aucune activité réservable en ligne pour le moment.</li>';
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
    if (f.minPax && state.pax < f.minPax) return { ok: false, court: 'Dès ' + f.minPax + ' personnes', pourquoi: 'Vous êtes ' + state.pax + ' : cette formule part de ' + f.minPax + ' personnes.' };
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
    var liste = (meta && meta.formules) || [];
    if (!liste.length) { gridFor.innerHTML = '<p class="fg-empty">Aucune formule proposée en ligne pour le moment.</p>'; return; }
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
          + (f.best ? '<span class="fg-for__best">Le plus pris</span>' : '') + '</span>'
          + '<span class="fg-for__price"><b>' + esc(euros(f.price)) + '</b><small>' + (f.type === 'per_lane' ? 'la piste' : 'par personne') + '</small>'
          + (f.oldPrice ? '<s>' + esc(euros(f.oldPrice)) + '</s>' : '') + '</span>'
          + '<ul class="fg-for__list">' + (f.desc || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
          + (regles.length ? '<span class="fg-for__rules">' + regles.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span>' : '')
          + (v.ok ? '' : '<span class="fg-for__off" role="status"><svg aria-hidden="true"><use href="#i-info"/></svg>' + esc(v.pourquoi) + '</span>')
          + '</div></li>';
      }).join('');
      return '<section class="fg-fam"><h3 class="fg-fam__title">' + esc(libelleFamille(cle)) + '<span>' + parFamille[cle].length + ' formule' + (parFamille[cle].length > 1 ? 's' : '') + '</span></h3>'
        + '<ul class="fg-grid fg-grid--for">' + cartes + '</ul></section>';
    }).join('');
  }
  function rendreCompteur(bump) {
    var n = state.onglet === 'formules' ? (state.formuleId ? 1 : 0) : state.selection.length;
    var mot = state.onglet === 'formules' ? 'formule' : 'activité';
    actCount.innerHTML = '<b>' + n + '</b> ' + esc(mot + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : ''));
    if (bump) { var b = $('b', actCount); b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); }
    goHours.disabled = n === 0;
  }
  // La photo d une carte ne se telecharge que quand elle peut se voir : au
  // survol, au focus clavier, ou quand la carte est cochee. Huit photos
  // chargees d avance pesaient 400 Ko pour un ecran qui n en montre aucune.
  function chargerPhotoCarte(card) {
    var img = card && card.querySelector('.fg-card__photo img[data-src]');
    if (!img) return;
    img.src = img.dataset.src;
    delete img.dataset.src;
  }
  gridAct.addEventListener('pointerenter', function (e) { chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card')); }, true);
  gridAct.addEventListener('focusin', function (e) { chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card')); });
  function majPrixCarte(item, a) {
    var prix = $('.fg-card__price', item);
    if (prix && a) prix.textContent = prixCarte(a) + (a.note ? ' · ' + a.note : '');
  }
  function basculerActivite(card) {
    if (!card || card.classList.contains('is-off')) return;
    chargerPhotoCarte(card);
    var item = card.closest('.fg-grid__item');
    var id = item.dataset.activity;
    var i = state.selection.indexOf(id);
    if (i >= 0) state.selection.splice(i, 1); else state.selection.push(id);
    var on = i < 0;
    card.classList.toggle('is-on', on);
    item.classList.toggle('is-on', on);
    card.setAttribute('aria-checked', String(on));
    majPrixCarte(item, activite(id));
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
      if (pourquoi) { pourquoi.classList.remove('is-pulse'); void pourquoi.offsetWidth; pourquoi.classList.add('is-pulse'); }
      return;
    }
    if (!card || card.classList.contains('is-off')) return;
    var id = card.dataset.formule;
    state.formuleId = state.formuleId === id ? '' : id;
    $$('.fg-card', gridFor).forEach(function (c) { var on = c.dataset.formule === state.formuleId; c.classList.toggle('is-on', on); c.closest('.fg-grid__item').classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    rendreCompteur(true);
    invaliderDispo();
  }
  gridFor.addEventListener('click', function (e) { choisirFormule(e.target.closest('.fg-card')); });
  gridFor.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('fg-card')) { e.preventDefault(); choisirFormule(e.target); }
  });
  // Le soulignement glisse sous l onglet courant : mesure une fois par
  // changement, quand la scene est visible (cachee, tout mesure zero).
  function placerBarre() {
    var barre = $('#tabBar');
    var onglet = state.onglet === 'activites' ? $('#tabAct') : $('#tabFor');
    if (!barre || !onglet || !onglet.offsetWidth) return;
    barre.style.transform = 'translateX(' + onglet.offsetLeft + 'px) scaleX(' + (onglet.offsetWidth / 100) + ')';
  }
  window.addEventListener('resize', placerBarre);
  function choisirOnglet(quel) {
    state.onglet = quel;
    var act = quel === 'activites';
    $('#tabAct').setAttribute('aria-selected', String(act));
    $('#tabFor').setAttribute('aria-selected', String(!act));
    $('#panelAct').hidden = !act;
    $('#panelFor').hidden = act;
    placerBarre();
    rendreCompteur(false);
    setTimeout(posterHauteur, 50);
  }
  $('#tabAct').addEventListener('click', function () { choisirOnglet('activites'); });
  $('#tabFor').addEventListener('click', function () { choisirOnglet('formules'); });
  goHours.addEventListener('click', function () { if (!goHours.disabled) { aller('heures'); chargerHeures(); } });

  /* --- Etape 3 : les heures ---------------------------------------------------- */

  var hourZone = $('#hourZone'), hourSub = $('#hourSub'), goContact = $('#goContact'), keepLabel = $('#keepLabel');
  var requeteEnCours = 0;
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
      return ligne;
    });
  }
  function nomsChoisis() {
    if (state.onglet === 'formules') { var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0]; return f ? f.name : ''; }
    return state.selection.map(nomActivite).join(' + ');
  }
  function urlDispo() {
    var q = new URLSearchParams();
    q.set('centerId', CENTER); q.set('date', state.date); q.set('pax', String(state.pax));
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
  function chargerHeures() {
    var j = jourInfo(state.date);
    hourSub.innerHTML = '<b>' + esc(jourCourt(state.date)) + '</b> · ' + esc(personnes(state.pax)) + ' · ' + esc(nomsChoisis())
      + (j && j.ouvert ? '<span class="fg-sub__open">Ouvert ' + esc(j.horaire) + (j.periode ? ' · ' + esc(j.periode.label) : '') + '</span>' : '');
    if (state.dispo) { rendreHeures(); return; }
    hourZone.innerHTML = '<p class="fg-loading">On regarde ce qui est libre…</p>';
    chargerPlan();
  }
  // Une seule route pour tout : sans heure posee, le serveur compose la
  // premiere combinaison possible et rend la grille ; avec des heures posees,
  // il recalcule la grille autour d elles et le plan qui en decoule.
  function chargerPlan() {
    var id = ++requeteEnCours;
    goContact.disabled = true;
    hourZone.classList.add('is-busy');
    fetch(urlDispo(), { credentials: 'omit' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (id !== requeteEnCours) return;
        if (!j || j.ok === false) throw new Error((j && j.message) || 'Disponibilités indisponibles.');
        state.dispo = j;
        var slot = (j.slots || [])[0] || null;
        state.creneau = slot ? { slot: slot, reponse: j } : null;
        state.heure = slot ? slot.time : '';
        hourZone.classList.remove('is-busy');
        rendreHeures();
        goContact.disabled = !slot;
      })
      .catch(function (err) {
        if (id !== requeteEnCours) return;
        hourZone.classList.remove('is-busy');
        hourZone.innerHTML = '<div class="fg-notice fg-notice--warn">' + esc(err.message || 'Impossible de charger les disponibilités.') + '</div>';
        signaturePistes = '';
        posterHauteur();
      });
  }
  // Les etats d une heure, lus dans la reponse :
  //   ok    : rien a dire ;
  //   soft  : possible, mais la visite finira a la fermeture (avertissement du moteur) ;
  //   shift : chevauche l autre activite posee ; la choisir deplace cette autre activite ;
  //   hard  : impossible ce jour-la (complet, ferme, trop tard) : on lit pourquoi, sans pouvoir la prendre.
  var MOTS_DURS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', resource_conflict: 'occupé', business_rules: 'non valable', off_grid: 'hors grille', unknown_anchor: 'indispo' };
  function etatHeure(t) {
    if (t.ok === false) {
      if (t.code === 'anchor_overlap') return { etat: 'shift', mot: 'décale', raison: t.reason || 'Chevauche une autre activité', conflit: t.conflict || null };
      return { etat: 'hard', mot: MOTS_DURS[t.code] || 'indispo', raison: t.reason || 'Indisponible', conflit: null };
    }
    if (t.warning) return { etat: 'soft', mot: 'serré', raison: t.warning.reason || 'Peu de temps pour le reste de la visite', conflit: null };
    return { etat: 'ok', mot: '', raison: '', conflit: null };
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
        + '<span class="fg-period__sum"></span>'
        + '<svg class="fg-period__chev" aria-hidden="true"><use href="#i-chevron"/></svg>'
        + '</button>'
        + '<div class="fg-period__body" id="' + id + '"><ul class="fg-chips" role="listbox" aria-label="' + esc(p) + '"' + (multi ? ' aria-multiselectable="true"' : '') + '>';
      groupes[p].forEach(function (t, k) {
        html += '<li role="presentation"><button type="button" class="fg-chip" role="option" data-time="' + esc(t.time) + '" style="--i:' + k + '"><b>' + esc(t.time) + '</b><small></small></button></li>';
      });
      html += '</ul></div></section>';
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
      var n = chips.filter(function (c) { return c.dataset.state !== 'hard'; }).length;
      var choisis = chips.filter(function (c) { return c.classList.contains('is-on'); }).map(function (c) { return c.dataset.time; });
      var propose = chips.filter(function (c) { return c.classList.contains('is-proposed'); }).map(function (c) { return c.dataset.time; })[0];
      var sum = n ? n + ' créneau' + (n > 1 ? 'x' : '') : 'rien de possible';
      if (choisis.length) sum = 'choisi ' + choisis.join(' et ') + ' · ' + sum;
      else if (propose) sum = 'proposé ' + propose + ' · ' + sum;
      $('.fg-period__sum', sec).textContent = sum;
      sec.classList.toggle('is-picked', choisis.length > 0);
      sec.classList.toggle('is-empty', n === 0);
      if (!utile && (choisis.length || propose)) utile = sec;
    });
    if (secs.length && !track.dataset.touched) {
      montrerPeriode(track, utile || secs.filter(function (x) { return !x.classList.contains('is-empty'); })[0] || secs[0]);
    }
  }
  // La mise a jour d une puce SUR PLACE : etat, raison, choix, proposition.
  // Rien n est reconstruit, rien ne saute : c est ce qui evite le tremblement
  // a chaque heure posee.
  function majChip(chip, t, actifs, propose, toutSerre) {
    var e = etatHeure(t);
    // Quand TOUTES les heures possibles de la piste sont serrees, le mot ne
    // dit plus rien sur l heure : la cause est ailleurs (une autre activite
    // posee tard, ou une journee trop courte). Les puces restent normales,
    // la piste porte une seule note, et la raison reste au survol.
    if (toutSerre && e.etat === 'soft') { e.etat = 'ok'; e.mot = ''; }
    var on = actifs.indexOf(t.time) >= 0;
    var prop = !on && propose === t.time;
    chip.dataset.state = e.etat;
    chip.dataset.reason = e.raison;
    chip.dataset.ok = e.etat === 'hard' ? 'false' : 'true';
    if (e.conflit) chip.dataset.conflict = e.conflit.activityId || ''; else delete chip.dataset.conflict;
    chip.classList.toggle('is-on', on);
    chip.classList.toggle('is-proposed', prop);
    chip.classList.toggle('is-soft', e.etat === 'soft');
    chip.classList.toggle('is-shift', e.etat === 'shift');
    chip.classList.toggle('is-off', e.etat === 'hard');
    chip.setAttribute('aria-selected', String(on));
    chip.setAttribute('title', e.etat === 'ok' ? (prop ? 'Heure proposée par l’équipe' : e.raison) : e.raison);
    $('small', chip).textContent = on ? 'choisi' : (prop ? 'proposé' : e.mot);
  }
  function actifsDe(a) {
    var laser = a.activityId === 'laser_game';
    return laser && state.laserParts.length ? state.laserParts : (state.pins[a.activityId] ? [state.pins[a.activityId]] : []);
  }
  function majPistes(d) {
    var ancres = (d.anchors && d.anchors.activities) || [];
    var defauts = (d.anchors && d.anchors.defaultTimes) || {};
    ancres.forEach(function (a) {
      var track = $('.fg-track[data-activity="' + a.activityId + '"]', hourZone);
      if (!track) return;
      var actifs = actifsDe(a);
      var propose = actifs.length ? '' : (defauts[a.activityId] || '');
      var possibles = (a.times || []).filter(function (t) { return t.ok !== false; });
      var toutSerre = possibles.length > 0 && possibles.every(function (t) { return t.warning; });
      (a.times || []).forEach(function (t) {
        var chip = $('.fg-chip[data-time="' + t.time + '"]', track);
        if (chip) majChip(chip, t, actifs, propose, toutSerre);
      });
      var note = $('.fg-track__note', track);
      if (note) {
        var autres = ancres.filter(function (b) { return b.activityId !== a.activityId && actifsDe(b).length; })
          .map(function (b) { return (b.label || b.activityId) + ' à ' + actifsDe(b).join(' et '); });
        note.textContent = !toutSerre ? '' : autres.length
          ? 'Serré à toute heure avec votre ' + autres.join(' et votre ') + ' : tout ne tiendra pas avant la fermeture.'
          : 'Serré à toute heure : tout ne tiendra pas avant la fermeture ce jour-là.';
        note.hidden = !toutSerre;
      }
      var reset = $('[data-reset]', track);
      if (reset) reset.hidden = !actifs.length;
      var why = $('.fg-why', track);
      if (why) why.hidden = true;
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
      html += '<p class="fg-legend fg-rise" style="--i:0">Touchez une heure en pointillés pour lire ce qui coince. <b>Serré</b> : possible, mais tout ne tiendra peut-être pas avant la fermeture. <b>Décale</b> : possible, l’autre activité se déplace. <b>Complet</b>, <b>fermé</b>, <b>trop tard</b> : impossible ce jour-là.</p>';
      ancres.forEach(function (a, i) {
        var laser = a.activityId === 'laser_game';
        var count = Math.max(1, Number(a.count) || 1);
        var multi = laser && count > 1;
        var detail = (laser ? count + ' partie' + (count > 1 ? 's' : '') + ' · ' : '') + minutesLabel(a.durationMinutes) + (count > 1 ? ' chacune' : '') + (multi ? ' · choisissez jusqu’à ' + count + ' heures' : '');
        html += '<section class="fg-track fg-rise" style="--i:' + (i + 1) + '" data-activity="' + esc(a.activityId) + '" data-count="' + count + '">'
          + '<div class="fg-track__head"><span class="fg-track__icon"><svg aria-hidden="true"><use href="#' + icone(a.activityId) + '"/></svg></span><b>' + esc(a.label || a.activityId) + '</b><span class="fg-track__detail">' + esc(detail) + '</span>'
          + '<button type="button" class="fg-link fg-track__reset" data-reset="' + esc(a.activityId) + '" hidden>Laisser l’équipe placer</button>'
          + '<span class="fg-track__note" role="status" hidden></span></div>'
          + rendreChips(a.times || [], multi, a.activityId)
          + '<p class="fg-why" role="status" hidden></p>'
          + '</section>';
      });
    } else {
      var slots = (d.slots || []).map(function (s) { return { time: s.time, ok: true }; });
      if (!slots.length) {
        html += '<div class="fg-notice fg-notice--warn"><b>' + esc(d.message || 'Aucun créneau ce jour-là.') + '</b></div>';
      } else {
        html += '<section class="fg-track fg-rise" style="--i:1" data-activity="">' + rendreChips(slots, false, 'slot') + '<p class="fg-why" role="status" hidden></p></section>';
      }
    }
    html += '<div id="planZone" class="fg-rise" style="--i:' + (ancres.length + 2) + '"></div>';
    hourZone.innerHTML = html;
    signaturePistes = signature;
    keepLabel.textContent = ancres.length ? 'Garder ces horaires' : 'Garder ce créneau';
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
    var why = $('.fg-why', track);
    var t = chip.dataset.time;
    if (chip.dataset.state === 'hard') {
      // Une heure impossible se lit : la raison vient du moteur, mot pour mot.
      $$('.fg-chip.is-asked', hourZone).forEach(function (c) { c.classList.remove('is-asked'); });
      chip.classList.add('is-asked');
      why.innerHTML = '<b>' + esc(t) + '</b> : ' + esc(chip.dataset.reason || 'indisponible à cette heure.');
      why.hidden = false;
      posterHauteur();
      return;
    }
    why.hidden = true;
    $$('.fg-chip.is-asked', hourZone).forEach(function (c) { c.classList.remove('is-asked'); });
    var idA = track.dataset.activity;
    if (!idA) {
      // Formule ou visite sans activite planifiee : le creneau se retient tel quel.
      var direct = (state.dispo.slots || []).filter(function (s) { return s.time === t; })[0];
      if (!direct) return;
      state.heure = t;
      state.creneau = { slot: direct, reponse: state.dispo };
      $$('.fg-chip', track).forEach(function (c) { majChip(c, { time: c.dataset.time, ok: true }, [t], ''); });
      rendreVisite();
      goContact.disabled = false;
      return;
    }
    adaptation = null;
    if (chip.dataset.state === 'shift' && chip.dataset.conflict) {
      // L heure chevauche l autre activite posee : c est l AUTRE qui bouge.
      // Sa pose s efface, le moteur la replace autour de l heure choisie.
      var autre = chip.dataset.conflict;
      delete state.pins[autre];
      if (autre === 'laser_game') state.laserParts = [];
      adaptation = { deplace: autre, pour: idA, t: t };
    }
    var count = Number(track.dataset.count) || 1;
    if (idA === 'laser_game' && count > 1) {
      var i = state.laserParts.indexOf(t);
      if (i >= 0) state.laserParts.splice(i, 1);
      else { if (state.laserParts.length >= count) state.laserParts.shift(); state.laserParts.push(t); }
      state.laserParts.sort();
      if (state.laserParts.length) state.pins.laser_game = state.laserParts[0]; else delete state.pins.laser_game;
    } else if (state.pins[idA] === t) {
      delete state.pins[idA];
    } else {
      state.pins[idA] = t;
    }
    chargerPlan();
  });
  // Les parties POSEES d une activite (une partie peut compter plusieurs
  // vagues), et ce qui reste a placer : le moteur laisse les parties non
  // posees « sur place, avec l equipe » (lib/ops-engine.js). L ecran le dit.
  function partiesPosees(cr, id) {
    var vues = {};
    ((cr && cr.slot && cr.slot.opsPlan && cr.slot.opsPlan.resourceBlocks) || []).forEach(function (b) { if (b && b.activityId === id) vues[Number(b.countIndex) || 1] = true; });
    return Object.keys(vues).length;
  }
  function resteSurPlace(total, posees) {
    var reste = total - posees;
    if (!(total > 1) || !(posees > 0) || reste <= 0) return '';
    return (reste === 1 ? 'la partie suivante se place' : 'les ' + reste + ' parties suivantes se placent') + ' sur place avec l’équipe';
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
  // Le bloc « votre visite » : l arrivee, chaque activite reservee a son heure,
  // les activites libres a votre rythme, la fin, le prix. Toutes les activites
  // de la visite y sont, jamais seulement celles a creneau.
  function rendreVisite() {
    var zone = $('#planZone');
    if (!zone) return;
    var d = state.dispo || {};
    var cr = state.creneau;
    if (!cr) {
      var html = '<div class="fg-notice fg-notice--warn"><b>' + esc(d.message || 'Cette combinaison d’heures ne tient pas.') + '</b>';
      var sugg = Array.isArray(d.suggestions) ? d.suggestions.slice(0, 4) : [];
      if (sugg.length) {
        html += '<span class="fg-suggest">' + sugg.map(function (s, i) {
          var times = s.times || {};
          var texte = s.label || Object.keys(times).map(function (k) { return nomActivite(k) + ' ' + times[k]; }).join(' · ');
          return '<button type="button" class="fg-suggest__btn" data-suggest="' + esc(JSON.stringify(times)) + '" style="--i:' + i + '">' + esc(texte) + '</button>';
        }).join('') + '</span>';
      }
      zone.innerHTML = html + '</div>';
      posterHauteur();
      return;
    }
    var slot = cr.slot, rep = cr.reponse, plan = slot.opsPlan || {};
    var blocs = blocsDuPlan(cr);
    var planifies = {};
    blocs.forEach(function (b) { planifies[b.activityId] = 1; });
    var items = (rep.program && rep.program.items) || [];
    var libres = items.filter(function (it) { return !planifies[it.activityId]; });
    var minutesLibres = libres.reduce(function (s, it) { return s + (Number(it.minutes) || 0); }, 0);
    var prix = Number(rep.price);
    var complet = !rep.program || rep.program.priceComplete !== false;
    var fin = slot.visitEndTime || plan.endTime || '';
    var lignes = '';
    if (plan.arrivalTime) lignes += '<li class="fg-visit__step fg-visit__step--in"><b>' + esc(plan.arrivalTime) + '</b><span>Arrivée</span><small>on vous accueille</small></li>';
    // Le dernier bloc de chaque activite porte ce qui reste a placer.
    var dernierBloc = {};
    blocs.forEach(function (b) { dernierBloc[b.activityId] = b; });
    blocs.forEach(function (b) {
      var it = items.filter(function (x) { return x.activityId === b.activityId; })[0] || {};
      var nom = it.name || nomActivite(b.activityId);
      var total = Number(it.games) || 0;
      var posees = partiesPosees(cr, b.activityId);
      var detail = total ? total + ' partie' + (total > 1 ? 's' : '') : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) : ''));
      // « partie 2/3 » compte les PARTIES (countIndex), jamais les vagues d une
      // meme partie : un grand groupe joue sa partie en deux groupes.
      if (total > 1 && posees > 1) detail = 'partie ' + (Number(b.countIndex) || 1) + '/' + total;
      if (b.groupWaveCount > 1) detail += (detail ? ' · ' : '') + 'groupe ' + b.groupWaveIndex + '/' + b.groupWaveCount;
      if (dernierBloc[b.activityId] === b && resteSurPlace(total, posees)) detail += ' · ' + resteSurPlace(total, posees);
      var bouge = adaptation && adaptation.deplace === b.activityId;
      lignes += '<li class="fg-visit__step' + (bouge ? ' is-moved' : '') + '"><b>' + esc(b.startTime) + '</b><span><svg aria-hidden="true"><use href="#' + icone(b.activityId) + '"/></svg>' + esc(nom) + '</span><small>' + esc(detail) + (bouge ? ' · déplacé pour votre ' + esc(nomActivite(adaptation.pour)) + ' à ' + esc(adaptation.t) : '') + '</small></li>';
    });
    if (libres.length) {
      lignes += '<li class="fg-visit__step fg-visit__step--free"><b>libre</b><span>' + libres.map(function (it) { return '<i><svg aria-hidden="true"><use href="#' + icone(it.activityId) + '"/></svg>' + esc(it.name || nomActivite(it.activityId)) + (detailSessions(it) ? ' (' + esc(detailSessions(it)) + ')' : '') + '</i>'; }).join('') + '</span><small>à votre rythme' + (minutesLibres ? ' · ' + esc(dureeApprox(minutesLibres)) : '') + '</small></li>';
    }
    if (!lignes) lignes = '<li class="fg-visit__step"><b>' + esc(slot.time) + '</b><span>Début</span><small></small></li>';
    var html2 = '<div class="fg-visit"><div class="fg-visit__head"><span class="fg-visit__title"><svg aria-hidden="true"><use href="#i-clock"/></svg>Votre visite</span>'
      + (fin ? '<span class="fg-visit__span">' + (plan.arrivalTime ? 'de <b>' + esc(plan.arrivalTime) + '</b> ' : '') + (slot.visitEndsAtClose ? 'jusqu’à la fermeture (<b>' + esc(heureAffichee(fin)) + '</b>)' : 'à <b>' + esc(heureAffichee(fin)) + '</b> environ') + '</span>' : '')
      + (prix > 0 ? '<span class="fg-visit__price">' + esc(euros(prix)) + (complet ? '' : '<small>le reste se règle sur place</small>') + '</span>' : '')
      + '</div><ol class="fg-visit__list">' + lignes + '</ol>';
    var avis = (plan.comfortNotices || []).map(function (n) { return typeof n === 'string' ? n : (n && (n.message || n.label)) || ''; }).filter(Boolean);
    if (slot.visitEndsAtClose && Number(slot.visitShortfallMinutes) > 0) avis.unshift('À cette heure, tout ne tiendra pas avant la fermeture : il manque ' + dureeApprox(slot.visitShortfallMinutes) + '. Vous choisirez sur place ce que vous gardez.');
    if (avis.length) html2 += '<p class="fg-visit__warn">' + avis.map(esc).join('<br>') + '</p>';
    zone.innerHTML = html2 + '</div>';
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    var s = e.target.closest('[data-suggest]');
    if (!s) return;
    try {
      var times = JSON.parse(s.dataset.suggest);
      state.pins = {}; state.laserParts = []; adaptation = null;
      Object.keys(times).forEach(function (k) { if (times[k]) state.pins[k] = String(times[k]).slice(0, 5); });
      chargerPlan();
    } catch (err) { /* suggestion illisible : rien */ }
  });
  goContact.addEventListener('click', function () {
    if (goContact.disabled || !state.creneau) return;
    $('#recallLine').textContent = jourCourt(state.date) + ' · ' + personnes(state.pax) + ' · ' + (state.creneau.slot.opsPlan && state.creneau.slot.opsPlan.arrivalTime ? 'arrivée ' + state.creneau.slot.opsPlan.arrivalTime : state.heure);
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
  }
  function validerContact() {
    var ok = true;
    var prenom = champ('cPrenom'), nom = champ('cNom'), email = champ('cEmail'), tel = champ('cTel'), consent = champ('cConsent');
    [prenom, nom].forEach(function (i) { var v = i.value.trim(); poserErreur(i, v ? '' : 'Ce champ est nécessaire.'); if (!v) ok = false; });
    var ev = email.value.trim();
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev);
    poserErreur(email, ev ? (emailOk ? '' : 'Cette adresse ne semble pas complète.') : 'Votre e-mail sert à vous envoyer la confirmation.');
    if (!emailOk) ok = false;
    var tv = tel.value.replace(/[\s.\-\/]/g, '');
    var telOk = /^\+?\d{8,15}$/.test(tv);
    poserErreur(tel, tv ? (telOk ? '' : 'Un numéro à 8 chiffres minimum, s’il vous plaît.') : 'Votre téléphone permet à l’équipe de vous joindre.');
    if (!telOk) ok = false;
    $('#consentWrap').classList.toggle('is-invalid', !consent.checked);
    if (!consent.checked) ok = false;
    return ok;
  }
  ['cPrenom', 'cNom', 'cEmail', 'cTel'].forEach(function (id) { champ(id).addEventListener('input', function () { poserErreur(champ(id), ''); }); });
  champ('cConsent').addEventListener('change', function () { $('#consentWrap').classList.remove('is-invalid'); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validerContact()) { var premier = $('.is-invalid .fg-input, .fg-check.is-invalid input', form); if (premier) premier.focus(); posterHauteur(); return; }
    state.contact = { prenom: champ('cPrenom').value.trim(), nom: champ('cNom').value.trim(), email: champ('cEmail').value.trim(), telephone: champ('cTel').value.trim() };
    rendreRecap();
    aller('recap');
  });

  /* --- Etape 5 : le recapitulatif ------------------------------------------------ */

  function rendreRecap() {
    var cr = state.creneau, rep = cr ? cr.reponse : {}, plan = cr ? (cr.slot.opsPlan || {}) : {};
    var lignes = [];
    var items = (rep.program && rep.program.items) || [];
    if (state.onglet === 'formules') {
      var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0] || {};
      lignes.push({ icone: 'a-formule', nom: f.name || rep.label || 'Formule', detail: (f.desc || []).join(' · '), aside: '' });
    } else if (items.length) {
      items.forEach(function (it) {
        var bloc = blocsDuPlan(cr).filter(function (b) { return b.activityId === it.activityId; })[0];
        var detail = it.games ? it.games + ' partie' + (it.games > 1 ? 's' : '') : (detailSessions(it) || (it.minutes ? minutesLabel(it.minutes) : ''));
        if (bloc && resteSurPlace(Number(it.games) || 0, partiesPosees(cr, it.activityId))) detail += ' · ' + resteSurPlace(Number(it.games) || 0, partiesPosees(cr, it.activityId));
        if (it.services && it.services.length > 1) detail += ' · ' + it.services.length + ' services';
        lignes.push({ icone: icone(it.activityId), nom: it.name || nomActivite(it.activityId), detail: detail, aside: bloc && bloc.startTime ? bloc.startTime : '' });
      });
    } else {
      state.selection.forEach(function (id) { lignes.push({ icone: icone(id), nom: nomActivite(id), detail: '', aside: '' }); });
    }
    var prix = Number(rep.price) || 0;
    var complet = !rep.program || rep.program.priceComplete !== false;
    var j = jourInfo(state.date);
    var fin = cr ? (cr.slot.visitEndTime || '') : '';
    var html = '<div class="fg-recap__row fg-rise" style="--i:1"><svg aria-hidden="true"><use href="#i-calendar"/></svg><span>' + esc(jourLong(state.date)) + '</span>' + (j && j.periode ? '<i class="fg-tag ' + (j.periode.type === 'public' ? 'fg-tag--ferie' : 'fg-tag--vacances') + '">' + esc(j.periode.label) + '</i>' : '') + '</div>'
      + '<div class="fg-recap__row fg-rise" style="--i:2"><svg aria-hidden="true"><use href="#i-users"/></svg><span>' + esc(personnes(state.pax)) + '</span></div>'
      + '<div class="fg-recap__sep"></div>';
    lignes.forEach(function (l, i) {
      html += '<div class="fg-recap__item fg-rise" style="--i:' + (3 + i) + '"><span class="fg-recap__badge"><svg aria-hidden="true"><use href="#' + l.icone + '"/></svg></span>'
        + '<span><span class="fg-recap__name">' + esc(l.nom) + '</span>' + (l.detail ? '<br><span class="fg-recap__detail">' + esc(l.detail) + '</span>' : '') + '</span>'
        + '<span class="fg-recap__aside">' + (l.aside ? 'Début<b>' + esc(l.aside) + '</b>' : '<small>à votre rythme</small>') + '</span></div>';
    });
    html += '<div class="fg-recap__sep"></div>'
      + (plan.arrivalTime ? '<div class="fg-recap__row fg-rise" style="--i:' + (3 + lignes.length) + '"><svg aria-hidden="true"><use href="#i-clock"/></svg><span>Arrivée conseillée à <b>' + esc(plan.arrivalTime) + '</b>' + (fin ? (cr.slot.visitEndsAtClose ? ', jusqu’à la fermeture (' + esc(heureAffichee(fin)) + ')' : ', fin vers ' + esc(heureAffichee(fin))) : '') + '</span></div>' : '')
      + '<div class="fg-total fg-rise" style="--i:' + (4 + lignes.length) + '"><div><div class="fg-total__label">' + (complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place') + '</div>'
      + '<div class="fg-total__amount" id="totalAmount" data-total="' + prix + '">' + (prix > 0 ? esc(euros(prix)) : 'Sur place') + '</div></div>'
      + '<div class="fg-total__pay"><svg aria-hidden="true"><use href="#i-card"/></svg><span>Paiement <br class="fg-total__br">sur place</span></div></div>'
      + '<p class="fg-recap__detail fg-rise" style="--i:' + (5 + lignes.length) + '; margin-top:14px">La confirmation partira à <b style="color:var(--fg-text)">' + esc(state.contact.email) + '</b>' + (state.heure ? ' · début à ' + esc(state.heure) : '') + '</p>';
    $('#recap').innerHTML = html;
    if (prix > 0 && !reduced) compterJusqua($('#totalAmount'), prix);
  }
  // Le total monte jusqu a sa valeur reelle : la valeur finale est toujours exacte.
  function compterJusqua(el, cible) {
    var t0 = null, duree = 700;
    var pas = function (t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / duree);
      var doux = 1 - Math.pow(1 - p, 3);
      el.textContent = euros(Math.round(cible * doux));
      if (p < 1) requestAnimationFrame(pas); else el.textContent = euros(cible);
    };
    requestAnimationFrame(pas);
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
      pax: state.pax,
      channel: 'public',
      notes: '',
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
  confirmBtn.addEventListener('click', function () {
    if (confirmBtn.classList.contains('is-busy')) return;
    direErreur('');
    confirmBtn.classList.add('is-busy'); confirmBtn.setAttribute('aria-busy', 'true');
    fetch('/api/public-reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j || {} }; }); })
      .then(function (res) {
        confirmBtn.classList.remove('is-busy'); confirmBtn.removeAttribute('aria-busy');
        if (res.status === 201 && res.json.ok !== false && res.json.reservation) { reussite(res.json); return; }
        if (res.status === 409 && Array.isArray(res.json.alternatives) && res.json.alternatives.length) {
          var alt = res.json.alternatives.map(function (a) { return jourCourt(a.date) + ' à ' + a.startTime; }).slice(0, 4).join(', ');
          direErreur((res.json.message || 'Ce créneau vient de changer.') + ' Alternatives : ' + alt + '. Revenez à l’étape des horaires pour choisir.');
          return;
        }
        direErreur(res.json.message || 'La réservation n’a pas pu être enregistrée. Réessayez dans un instant.');
      })
      .catch(function () {
        confirmBtn.classList.remove('is-busy'); confirmBtn.removeAttribute('aria-busy');
        direErreur('Le réseau n’a pas répondu. Vérifiez votre connexion et réessayez.');
      });
  });
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
    $('#finBody').innerHTML = '<div class="fg-done__ref fg-rise" style="--i:1">Réservation n° ' + esc(r.id) + '</div>'
      + '<p class="fg-rise" style="--i:2">' + (confirme
        ? '<b>' + esc(jourLong(dateRes)) + ' à ' + esc(heureRes) + '</b>, ' + esc(personnes(paxRes)) + '. Votre place est réservée.'
        : '<b>' + esc(jourLong(dateRes)) + ' à ' + esc(heureRes) + '</b>, ' + esc(personnes(paxRes)) + '. L’équipe vérifie votre demande et revient vers vous rapidement.') + '</p>'
      + '<p class="fg-rise" style="--i:3"><svg style="width:18px;height:18px;vertical-align:-3px;margin-right:6px" aria-hidden="true"><use href="#i-mail"/></svg>' + (confirme ? 'La confirmation part' : 'Un accusé de réception part') + ' à <b>' + esc(mailRes) + '</b>.</p>'
      + (Number(r.price) > 0 ? '<p class="fg-rise" style="--i:4">Montant estimé <b>' + esc(euros(r.price)) + '</b>, à régler sur place.</p>' : '')
      + (contact && contact.phone ? '<p class="fg-rise" style="--i:5">Une question ? ' + esc(contact.phone) + (contact.email ? ' · ' + esc(contact.email) : '') + '</p>' : '')
      + (!EMBED && meta && meta.center && meta.center.identity && meta.center.identity.siteUrl ? '<div class="fg-actions fg-actions--center fg-rise" style="--i:6"><a class="fg-btn fg-btn--ghost" href="' + esc(meta.center.identity.siteUrl) + '">Retour au site</a></div>' : '');
    var burst = $('#finBurst');
    if (burst && !reduced) { burst.innerHTML = ''; for (var i = 0; i < 14; i += 1) { var s = doc.createElement('i'); s.style.setProperty('--a', (i * 360 / 14) + 'deg'); s.style.setProperty('--d', (60 + (i % 3) * 30) + 'px'); s.style.setProperty('--t', (i % 2 ? 0.05 : 0) + 's'); burst.appendChild(s); } }
    aller('fin');
    // La mesure de conversion pour le site hote : relue dans le dossier cree,
    // sans aucune donnee personnelle.
    poster({ type: 'pinlane:booking', detail: {
      reservationId: r.id, center: CENTER, amount: Number(r.price) || 0, currency: 'EUR', pax: paxRes, date: dateRes,
      startTime: heureRes, type: r.type || (state.onglet === 'formules' ? 'formule' : 'visite'), formuleId: r.formuleId || state.formuleId || '', label: r.label || '', status: confirme ? 'confirmed' : 'received',
    } });
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

  /* --- Le demarrage ----------------------------------------------------------------- */

  function demarrer() {
    decouperTitres();
    rendreEtapes();
    rendrePax();
    var q = new URLSearchParams(); q.set('centerId', CENTER); q.set('calendar', '45');
    fetch('/api/public-booking-meta?' + q.toString(), { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok === false) throw new Error((j && j.message) || 'Catalogue indisponible.');
        meta = j;
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
      .catch(function (err) { direErreur(err.message || 'Le catalogue ne répond pas. Réessayez dans un instant.'); body.classList.add('is-ready'); });
    posterHauteur();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
