/* =============================================================================
   FUN GALAXY, LE FORMULAIRE DE RESERVATION (v3, 2026-09-21)
   -----------------------------------------------------------------------------
   Un client leger au-dessus des trois API publiques de Pinlane, sans aucune
   bibliotheque :
     GET  /api/public-booking-meta   le catalogue, les horaires, la marque
     GET  /api/public-availability   les heures possibles et le plan de visite
     POST /api/public-reservations   la creation, le serveur recalcule tout
   Tout ce qui s affiche vient de ces reponses : aucun prix, aucune heure,
   aucun nom d activite n est ecrit ici.

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

  // Le fond du site hote voyage dans l URL : liste blanche de caracteres
  // stricte, sinon color-scheme: dark peint un rectangle gris chez le client.
  var fond = params.get('fond') || '';
  if (fond && fond.length < 40 && /^[0-9a-fA-F#rgbaRGBA(), .%]+$/.test(fond)) {
    root.style.background = fond;
    body.style.background = fond;
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
    formuleId: '',             // ou une formule (onglet Formules)
    onglet: 'activites',
    heure: '',                 // heure retenue
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
  function minutesLabel(m) { m = Number(m) || 0; if (m >= 60) { var h = Math.floor(m / 60), r = m % 60; return r ? h + 'h' + String(r).padStart(2, '0') : h + ' heure' + (h > 1 ? 's' : ''); } return m + ' min'; }
  function ouvertureDuJour(dateStr) {
    var s = meta && meta.center && meta.center.defaultSchedule;
    if (!s || !s.regular) return null;
    var d = deIso(dateStr).getDay();
    var r = s.regular[String(d)];
    return r && r.open ? r : null;
  }
  function horaireLabel(r) {
    if (!r) return 'Fermé';
    var f = function (t) { var p = String(t).split(':'); return p[1] === '00' ? Number(p[0]) + 'h' : p[0] + 'h' + p[1]; };
    return f(r.open) + ' - ' + (r.close === '24:00' ? 'minuit' : f(r.close));
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

  /* --- Les prix affiches sur les cartes, depuis le catalogue seulement ------- */

  function prixCarte(a) {
    if (!meta) return '';
    var unite = a.unitLabel ? ' ' + a.unitLabel.replace(/^par /, '/ ') : '';
    switch (a.priceType) {
      case 'grid_bowling': {
        var grille = (meta.center && meta.center.booking && meta.center.booking.bowlingPrices) || meta.bowlingPrices || {};
        var vals = Object.keys(grille).map(function (k) { return Number(grille[k]); }).filter(function (n) { return n > 0; });
        return vals.length ? 'Dès ' + euros(Math.min.apply(null, vals)) + ' / piste' : 'Tarif sur place';
      }
      case 'grid_laser': {
        var opts = meta.laserOptions || [];
        var mini = opts.length ? Math.min.apply(null, opts.map(function (o) { return Number(o.price) || 0; }).filter(Boolean)) : 0;
        return mini ? 'Dès ' + euros(mini) + ' / personne' : 'Tarif sur place';
      }
      case 'grid_fun_run': {
        var sessions = meta.funRunOptions || [];
        var bas = sessions.length ? Math.min.apply(null, sessions.map(function (o) { return Number(o.price) || 0; }).filter(Boolean)) : 0;
        return bas ? 'Dès ' + euros(bas) + ' / session' : 'Tarif sur place';
      }
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
            n.textContent.split(/(\s+)/).forEach(function (part) {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
              var w = doc.createElement('span'); w.className = 'w';
              var s = doc.createElement('span'); s.style.setProperty('--i', i++); s.textContent = part;
              w.appendChild(s); frag.appendChild(w);
            });
            node.replaceChild(frag, n);
          } else if (n.nodeType === 1 && n.tagName !== 'SVG' && n.tagName !== 'svg') walk(n);
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

  /* --- Etape 1 : le jour et le groupe ------------------------------------------- */

  var dayBtn = $('#dayBtn'), dayList = $('#dayList'), dayLabel = $('#dayLabel');
  var paxOut = $('#paxOut'), paxValue = $('#paxValue'), paxHint = $('#paxHint');
  var PAX_MIN = 1, PAX_MAX = 240;

  function joursProposes() {
    var today = meta && meta.today ? deIso(meta.today) : new Date();
    var out = [];
    for (var i = 0; i < 28; i += 1) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var s = iso(d);
      out.push({ date: s, ouvert: Boolean(ouvertureDuJour(s)), horaire: horaireLabel(ouvertureDuJour(s)), aujourdhui: i === 0, demain: i === 1 });
    }
    return out;
  }
  function rendreJours() {
    dayList.innerHTML = joursProposes().map(function (j) {
      var libelle = jourLong(j.date) + (j.aujourdhui ? ' (aujourd’hui)' : j.demain ? ' (demain)' : '');
      return '<li role="presentation">'
        + '<button type="button" class="fg-day__opt" data-date="' + j.date + '" ' + (j.ouvert ? '' : 'disabled') + ' role="option" aria-selected="' + (j.date === state.date) + '">'
        + '<span>' + esc(libelle) + '</span><small>' + esc(j.horaire) + '</small></button></li>';
    }).join('');
  }
  function choisirJour(dateStr) {
    state.date = dateStr;
    dayLabel.textContent = jourLong(dateStr);
    var r = ouvertureDuJour(dateStr);
    dayBtn.setAttribute('title', r ? 'Ouvert ' + horaireLabel(r) : '');
    invaliderDispo();
  }
  function ouvrirJours(ouvrir) {
    var o = typeof ouvrir === 'boolean' ? ouvrir : dayList.hidden;
    if (o) rendreJours();
    dayList.hidden = !o;
    dayBtn.setAttribute('aria-expanded', String(o));
    if (o) { var sel = $('.fg-day__opt[aria-selected="true"]', dayList) || $('.fg-day__opt:not([disabled])', dayList); if (sel) sel.focus(); }
    setTimeout(posterHauteur, 260);
  }
  dayBtn.addEventListener('click', function () { ouvrirJours(); });
  dayList.addEventListener('click', function (e) {
    var b = e.target.closest('.fg-day__opt');
    if (!b || b.disabled) return;
    choisirJour(b.dataset.date);
    ouvrirJours(false);
    dayBtn.focus();
  });
  doc.addEventListener('click', function (e) { if (!dayList.hidden && !e.target.closest('.fg-day')) ouvrirJours(false); });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dayList.hidden) { ouvrirJours(false); dayBtn.focus(); }
    if (dayList.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    var opts = $$('.fg-day__opt:not([disabled])', dayList);
    var i = opts.indexOf(doc.activeElement);
    var n = e.key === 'ArrowDown' ? Math.min(opts.length - 1, i + 1) : Math.max(0, i - 1);
    if (opts[n]) { opts[n].focus(); e.preventDefault(); }
  });

  function rendrePax(sens) {
    paxOut.textContent = personnes(state.pax);
    paxValue.classList.remove('is-up', 'is-down');
    if (sens) { void paxValue.offsetWidth; paxValue.classList.add(sens > 0 ? 'is-up' : 'is-down'); }
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
  $('#paxMinus').addEventListener('click', function () { if (state.pax > PAX_MIN) { state.pax -= 1; rendrePax(-1); } });
  $('#paxPlus').addEventListener('click', function () { if (state.pax < PAX_MAX) { state.pax += 1; rendrePax(1); } });

  $('#goActivities').addEventListener('click', function () {
    if (!state.date) { direErreur('Choisissez d’abord un jour.'); dayBtn.focus(); return; }
    direErreur('');
    // Le groupe a pu changer depuis le dernier rendu : une activite bornee
    // (Fun Run, 5 joueurs) sort de la selection si le groupe la depasse.
    state.selection = state.selection.filter(function (id) {
      var a = activitesVendables().filter(function (x) { return x.id === id; })[0];
      return a && !(a.maxPax && state.pax > a.maxPax);
    });
    rendreActivites();
    rendreFormules();
    rendreCompteur(false);
    aller('activites');
  });

  /* --- Etape 2 : les activites et les formules ----------------------------------- */

  var gridAct = $('#gridAct'), gridFor = $('#gridFor'), actCount = $('#actCount'), goHours = $('#goHours');
  function activitesVendables() {
    return (meta && meta.activities ? meta.activities.slice() : []).sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
  }
  function rendreActivites() {
    gridAct.innerHTML = activitesVendables().map(function (a, i) {
      var p = photo(a.id);
      var on = state.selection.indexOf(a.id) >= 0;
      var trop = a.maxPax && state.pax > a.maxPax;
      return '<li><button type="button" class="fg-card fg-rise' + (on ? ' is-on' : '') + '" style="--i:' + (i % 8) + '" data-activity="' + esc(a.id) + '" aria-pressed="' + on + '" ' + (trop ? 'disabled title="' + esc(a.name) + ' : ' + a.maxPax + ' personnes maximum"' : '') + '>'
        + (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
        + '<span class="fg-card__name">' + esc(a.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prixCarte(a)) + (a.note ? ' · ' + esc(a.note) : '') + '</span>'
        + '</button></li>';
    }).join('') || '<li class="fg-empty">Aucune activité réservable en ligne pour le moment.</li>';
    // Une carte deja cochee (retour a cet ecran) montre sa photo tout de suite.
    $$('.fg-card.is-on', gridAct).forEach(chargerPhotoCarte);
  }
  function rendreFormules() {
    var liste = (meta && meta.formules) || [];
    gridFor.innerHTML = liste.map(function (f, i) {
      var on = state.formuleId === f.id;
      var mini = f.minPax && state.pax < f.minPax;
      var prix = f.type === 'per_lane' ? euros(f.price) + ' / piste' : euros(f.price) + ' / personne';
      return '<li><button type="button" class="fg-card fg-card--formule fg-rise' + (on ? ' is-on' : '') + '" style="--i:' + (i % 8) + '" data-formule="' + esc(f.id) + '" aria-pressed="' + on + '" ' + (mini ? 'disabled title="Minimum ' + f.minPax + ' personnes"' : '') + '>'
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#a-formule"/></svg></span>'
        + '<span class="fg-card__name">' + esc(f.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prix) + (f.oldPrice ? ' <s style="color:var(--fg-faint)">' + esc(euros(f.oldPrice)) + '</s>' : '') + '</span>'
        + '<span class="fg-card__meta">' + esc((f.desc || []).slice(0, 3).join(' · ')) + (f.minPax ? ' · dès ' + f.minPax + ' pers.' : '') + '</span>'
        + '</button></li>';
    }).join('') || '<li class="fg-empty">Aucune formule proposée en ligne pour le moment.</li>';
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
  gridAct.addEventListener('click', function (e) {
    var card = e.target.closest('.fg-card');
    if (!card || card.disabled) return;
    chargerPhotoCarte(card);
    var id = card.dataset.activity;
    var i = state.selection.indexOf(id);
    if (i >= 0) state.selection.splice(i, 1); else state.selection.push(id);
    card.classList.toggle('is-on', i < 0);
    card.setAttribute('aria-pressed', String(i < 0));
    rendreCompteur(true);
    invaliderDispo();
  });
  gridFor.addEventListener('click', function (e) {
    var card = e.target.closest('.fg-card');
    if (!card || card.disabled) return;
    var id = card.dataset.formule;
    state.formuleId = state.formuleId === id ? '' : id;
    $$('.fg-card', gridFor).forEach(function (c) { var on = c.dataset.formule === state.formuleId; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); });
    rendreCompteur(true);
    invaliderDispo();
  });
  function choisirOnglet(quel) {
    state.onglet = quel;
    var act = quel === 'activites';
    $('#tabAct').setAttribute('aria-selected', String(act));
    $('#tabFor').setAttribute('aria-selected', String(!act));
    $('#panelAct').hidden = !act;
    $('#panelFor').hidden = act;
    rendreCompteur(false);
    setTimeout(posterHauteur, 50);
  }
  $('#tabAct').addEventListener('click', function () { choisirOnglet('activites'); });
  $('#tabFor').addEventListener('click', function () { choisirOnglet('formules'); });
  goHours.addEventListener('click', function () { if (!goHours.disabled) { aller('heures'); chargerHeures(); } });

  /* --- Etape 3 : les heures ---------------------------------------------------- */

  var hourZone = $('#hourZone'), hourSub = $('#hourSub'), goContact = $('#goContact'), keepTime = $('#keepTime');
  var requeteEnCours = 0;
  function invaliderDispo() { state.dispo = null; state.creneau = null; state.heure = ''; goContact.disabled = true; keepTime.textContent = ''; }
  function programme() {
    return state.selection.map(function (id) {
      var a = activitesVendables().filter(function (x) { return x.id === id; })[0] || {};
      var ligne = { activityId: id };
      if (a.priceType === 'grid_bowling') ligne.duration = 1;
      if (a.priceType === 'grid_laser') ligne.games = 1;
      if (a.priceType === 'grid_fun_run') ligne.minutes = a.defaultMinutes || 30;
      return ligne;
    });
  }
  function nomsChoisis() {
    if (state.onglet === 'formules') { var f = ((meta && meta.formules) || []).filter(function (x) { return x.id === state.formuleId; })[0]; return f ? f.name : ''; }
    return state.selection.map(function (id) { var a = activitesVendables().filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }).join(' + ');
  }
  function urlDispo(preferred) {
    var q = new URLSearchParams();
    q.set('centerId', CENTER); q.set('date', state.date); q.set('pax', String(state.pax));
    if (state.onglet === 'formules') { q.set('type', 'formule'); q.set('formuleId', state.formuleId); }
    else { q.set('type', 'visite'); q.set('program', JSON.stringify(programme())); }
    if (preferred) q.set('preferredTimes', JSON.stringify(preferred));
    return '/api/public-availability?' + q.toString();
  }
  function chargerHeures() {
    hourSub.innerHTML = '<b>' + esc(jourCourt(state.date)) + '</b> · ' + esc(personnes(state.pax)) + ' · ' + esc(nomsChoisis());
    if (state.dispo) { rendreHeures(); return; }
    hourZone.innerHTML = '<p class="fg-loading">On regarde ce qui est libre…</p>';
    var id = ++requeteEnCours;
    fetch(urlDispo(null), { credentials: 'omit' }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (res) {
        if (id !== requeteEnCours) return;
        if (!res.json || res.json.ok === false) throw new Error((res.json && res.json.message) || 'Disponibilités indisponibles.');
        state.dispo = res.json;
        rendreHeures();
      })
      .catch(function (err) {
        if (id !== requeteEnCours) return;
        hourZone.innerHTML = '<div class="fg-notice fg-notice--warn">' + esc(err.message || 'Impossible de charger les disponibilités.') + '</div>';
        posterHauteur();
      });
  }
  // Les heures proposees : pour une visite, la premiere activite ancree porte
  // toute la journee dans anchors ; pour une formule ou une visite sans
  // activite planifiee, ce sont les slots.
  function heuresProposees(d) {
    var ancre = d.anchors && d.anchors.activities && d.anchors.activities[0];
    if (ancre && Array.isArray(ancre.times) && ancre.times.length) {
      return ancre.times.map(function (t) { return { time: t.time, ok: t.ok !== false, reason: t.reason || '' }; });
    }
    return (d.slots || []).map(function (s) { return { time: s.time, ok: true, reason: '' }; });
  }
  function periode(h) { var n = Number(String(h).split(':')[0]); return n < 12 ? 'Matin' : n < 18 ? 'Après-midi' : 'Soirée'; }
  function rendreHeures() {
    var d = state.dispo;
    var heures = heuresProposees(d);
    if (!heures.length) {
      hourZone.innerHTML = '<div class="fg-notice fg-notice--warn"><b>' + esc(d.message || 'Aucun créneau ce jour-là.') + '</b>'
        + (d.suggestions && d.suggestions.length ? '<br>Essayez plutôt : ' + d.suggestions.map(function (s) { return esc(s.label || ''); }).join(', ') : '')
        + '</div>';
      posterHauteur();
      return;
    }
    var html = '';
    if (d.message && !heures.some(function (h) { return h.ok; })) html += '<div class="fg-notice fg-notice--warn">' + esc(d.message) + '</div>';
    var groupes = {};
    heures.forEach(function (h) { var p = periode(h.time); (groupes[p] = groupes[p] || []).push(h); });
    var k = 0;
    html += '<ul class="fg-chips is-fresh" role="listbox" aria-label="Heures de début">';
    Object.keys(groupes).forEach(function (p) {
      html += '<li class="fg-period fg-kicker" role="presentation">' + esc(p) + '</li>';
      groupes[p].forEach(function (h) {
        html += '<li role="presentation"><button type="button" class="fg-chip' + (h.time === state.heure ? ' is-on' : '') + '" role="option" aria-selected="' + (h.time === state.heure) + '" data-time="' + esc(h.time) + '" style="--i:' + (k++) + '" ' + (h.ok ? '' : 'disabled title="' + esc(h.reason || 'Indisponible') + '"') + '>' + esc(h.time) + '</button></li>';
      });
    });
    html += '</ul><div id="planZone"></div>';
    hourZone.innerHTML = html;
    if (state.creneau) rendrePlan(state.creneau, d);
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    var chip = e.target.closest('.fg-chip');
    if (!chip || chip.disabled) return;
    state.heure = chip.dataset.time;
    $$('.fg-chip', hourZone).forEach(function (c) { var on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-selected', String(on)); });
    goContact.disabled = true;
    keepTime.textContent = state.heure;
    var zone = $('#planZone');
    zone.innerHTML = '<p class="fg-loading">On compose votre visite…</p>';
    posterHauteur();
    var ancre = state.dispo.anchors && state.dispo.anchors.activities && state.dispo.anchors.activities[0];
    if (state.onglet === 'formules' || !ancre) {
      // Formule, ou visite sans activite planifiee : chaque creneau de la
      // premiere reponse porte deja son plan, rien a redemander.
      var direct = (state.dispo.slots || []).filter(function (s) { return s.time === state.heure; })[0];
      if (!direct) { zone.innerHTML = '<div class="fg-notice fg-notice--warn">Ce créneau ne tient pas. Choisissez une autre heure.</div>'; posterHauteur(); return; }
      state.creneau = { slot: direct, reponse: state.dispo };
      rendrePlan(state.creneau, state.dispo);
      goContact.disabled = false;
      return;
    }
    var id = ++requeteEnCours;
    var preferred = {};
    preferred[ancre.activityId] = state.heure;
    fetch(urlDispo(preferred), { credentials: 'omit' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (id !== requeteEnCours) return;
        if (!j || j.ok === false) throw new Error((j && j.message) || 'Créneau indisponible.');
        var slot = (j.slots || []).filter(function (s) { return s.time === state.heure; })[0] || (j.slots || [])[0] || null;
        if (!slot) throw new Error(j.message || 'Ce créneau ne tient pas. Choisissez une autre heure.');
        state.creneau = { slot: slot, reponse: j };
        rendrePlan(state.creneau, j);
        goContact.disabled = false;
      })
      .catch(function (err) {
        if (id !== requeteEnCours) return;
        $('#planZone').innerHTML = '<div class="fg-notice fg-notice--warn">' + esc(err.message) + '</div>';
        posterHauteur();
      });
  });
  function blocsDuPlan(cr) {
    var plan = cr.slot.opsPlan || {};
    return (plan.resourceBlocks || []).filter(function (b) { return b.type === 'activity' || b.activityId; });
  }
  function rendrePlan(cr, reponse) {
    var zone = $('#planZone');
    if (!zone) return;
    var plan = cr.slot.opsPlan || {};
    var parties = [];
    if (plan.arrivalTime) parties.push('Arrivée <b>' + esc(plan.arrivalTime) + '</b>');
    var vus = {};
    blocsDuPlan(cr).forEach(function (b) {
      var cle = b.activityId + '@' + b.startTime;
      if (vus[cle]) return; vus[cle] = 1;
      var nom = b.label ? String(b.label).replace(/\s+-\s+groupe.*$/i, '') : b.activityId;
      parties.push(esc(nom) + ' <b>' + esc(b.startTime) + '</b>' + (b.groupWaveCount > 1 ? ' <small>(' + b.groupWaveIndex + '/' + b.groupWaveCount + ')</small>' : ''));
    });
    if (!parties.length) parties.push('Début <b>' + esc(cr.slot.time) + '</b>');
    var prix = Number(reponse.price);
    var complet = !reponse.program || reponse.program.priceComplete !== false;
    var fin = cr.slot.visitEndTime || '';
    zone.innerHTML = '<div class="fg-plan is-swap"><svg aria-hidden="true"><use href="#i-clock"/></svg>' + parties.join('<span class="dot">·</span>')
      + (fin ? '<span class="dot">·</span>Fin vers <b>' + esc(fin) + '</b>' : '')
      + (prix > 0 ? '<span class="dot">·</span><span class="fg-plan__price">' + esc(euros(prix)) + (complet ? '' : ' + activités réglées sur place') + '</span>' : '')
      + '</div>';
    var avis = (plan.comfortNotices || []).map(function (n) { return typeof n === 'string' ? n : (n && (n.message || n.label)) || ''; }).filter(Boolean);
    if (avis.length) zone.innerHTML += '<div class="fg-notice">' + avis.map(esc).join('<br>') + '</div>';
    posterHauteur();
  }
  goContact.addEventListener('click', function () {
    if (goContact.disabled) return;
    $('#recallLine').textContent = jourCourt(state.date) + ' · ' + personnes(state.pax) + ' · ' + state.heure;
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
        var detail = it.games ? it.games + ' partie' + (it.games > 1 ? 's' : '') : (it.minutes ? minutesLabel(it.minutes) : '');
        if (it.services && it.services.length > 1) detail += ' · ' + it.services.length + ' services';
        lignes.push({ icone: icone(it.activityId), nom: it.name || it.activityId, detail: detail, aside: bloc && bloc.startTime ? bloc.startTime : '' });
      });
    } else {
      state.selection.forEach(function (id) { var a = activitesVendables().filter(function (x) { return x.id === id; })[0]; lignes.push({ icone: icone(id), nom: a ? a.name : id, detail: '', aside: '' }); });
    }
    var prix = Number(rep.price) || 0;
    var complet = !rep.program || rep.program.priceComplete !== false;
    var html = '<div class="fg-recap__row fg-rise" style="--i:1"><svg aria-hidden="true"><use href="#i-calendar"/></svg>' + esc(jourLong(state.date)) + '</div>'
      + '<div class="fg-recap__row fg-rise" style="--i:2"><svg aria-hidden="true"><use href="#i-users"/></svg>' + esc(personnes(state.pax)) + '</div>'
      + '<div class="fg-recap__sep"></div>';
    lignes.forEach(function (l, i) {
      html += '<div class="fg-recap__item fg-rise" style="--i:' + (3 + i) + '"><span class="fg-recap__badge"><svg aria-hidden="true"><use href="#' + l.icone + '"/></svg></span>'
        + '<span><span class="fg-recap__name">' + esc(l.nom) + '</span>' + (l.detail ? '<br><span class="fg-recap__detail">' + esc(l.detail) + '</span>' : '') + '</span>'
        + '<span class="fg-recap__aside">' + (i === 0 && plan.arrivalTime ? 'Arrivée<b>' + esc(plan.arrivalTime) + '</b>' : (l.aside ? 'Début<b>' + esc(l.aside) + '</b>' : '')) + '</span></div>';
    });
    html += '<div class="fg-recap__sep"></div>'
      + '<div class="fg-total fg-rise" style="--i:' + (4 + lignes.length) + '"><div><div class="fg-total__label">' + (complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place') + '</div>'
      + '<div class="fg-total__amount" id="totalAmount" data-total="' + prix + '">' + (prix > 0 ? esc(euros(prix)) : 'Sur place') + '</div></div>'
      + '<div class="fg-total__pay"><svg aria-hidden="true"><use href="#i-card"/></svg><span>Paiement<br>sur place</span></div></div>'
      + '<p class="fg-recap__detail fg-rise" style="--i:' + (5 + lignes.length) + '; margin-top:14px">La confirmation partira à <b style="color:var(--fg-text)">' + esc(state.contact.email) + '</b>' + (state.heure ? ' · début à ' + esc(state.heure) : '') + '</p>';
    $('#recap').innerHTML = html;
    if (prix > 0 && !reduced) compterJusqua($('#totalAmount'), prix);
  }
  // Le total monte jusqu a sa valeur reelle : transform seulement, aucune
  // mise en page pendant le defile, et la valeur finale est toujours exacte.
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
      preference: {},
      // Le montant affiche part avec la demande, comme dans le tunnel ; le
      // serveur recalcule tout et c est son montant qui est enregistre.
      price: Number(rep.price) || 0,
      basePrice: Number(rep.price) || 0,
    };
    if (state.onglet === 'formules') {
      base.type = 'formule'; base.formuleId = state.formuleId;
      base.duration = Number(rep.duration) || 1; base.totalDuration = Number(rep.totalDuration) || base.duration;
      base.laneCount = Number(rep.laneCount) || 0; base.requiresLanes = Boolean(rep.requiresLanes); base.label = rep.label || '';
      if (cr && cr.slot.opsPlan && cr.slot.opsPlan.anchorPlan) base.preference = { preferredTimes: cr.slot.opsPlan.anchorPlan.times || {}, laserPlacement: cr.slot.opsPlan.anchorPlan.laserPlacement || 'scheduled' };
    } else {
      base.type = 'visite'; base.program = programme();
      base.duration = Number(rep.duration) || 1; base.totalDuration = Number(rep.totalDuration) || base.duration;
      base.laneCount = Number(rep.laneCount) || 0; base.requiresLanes = Boolean(rep.requiresLanes); base.label = rep.label || '';
      if (cr && cr.slot.opsPlan && cr.slot.opsPlan.anchorPlan) base.preference = { preferredTimes: cr.slot.opsPlan.anchorPlan.times || {}, laserPlacement: cr.slot.opsPlan.anchorPlan.laserPlacement || 'scheduled' };
    }
    if (cr && cr.slot.lanes) base.lanes = cr.slot.lanes;
    if (cr && cr.slot.opsPlan) base.opsPlan = cr.slot.opsPlan;
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
    aller('fin');
    // La mesure de conversion pour le site hote : relue dans le dossier cree,
    // sans aucune donnee personnelle.
    poster({ type: 'pinlane:booking', detail: {
      reservationId: r.id, center: CENTER, amount: Number(r.price) || 0, currency: 'EUR', pax: paxRes, date: dateRes,
      startTime: heureRes, type: r.type || (state.onglet === 'formules' ? 'formule' : 'visite'), formuleId: r.formuleId || state.formuleId || '', label: r.label || '', status: confirme ? 'confirmed' : 'received',
    } });
  }

  /* --- Le demarrage ----------------------------------------------------------------- */

  function demarrer() {
    decouperTitres();
    rendreEtapes();
    rendrePax(0);
    var q = new URLSearchParams(); q.set('centerId', CENTER);
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
        // Le premier jour ouvert : aujourd hui si le centre est ouvert, sinon
        // le prochain.
        var jours = joursProposes();
        var premier = jours.filter(function (x) { return x.ouvert; })[0];
        if (premier) choisirJour(premier.date);
        rendrePax(0);
        rendreActivites();
        rendreFormules();
        rendreCompteur(false);
        posterHauteur();
      })
      .catch(function (err) { direErreur(err.message || 'Le catalogue ne répond pas. Réessayez dans un instant.'); });
    posterHauteur();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
