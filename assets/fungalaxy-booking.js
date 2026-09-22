/* =============================================================================
   FUN GALAXY, LE FORMULAIRE DE RESERVATION (v3, 2026-09-22)
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
  function minutesLabel(m) { m = Number(m) || 0; if (m >= 60) { var h = Math.floor(m / 60), r = m % 60; return r ? h + 'h' + String(r).padStart(2, '0') : h + ' heure' + (h > 1 ? 's' : ''); } return m + ' min'; }
  function heuresLabel(v) { v = Number(v) || 0; if (v === 0.5) return '30 min'; if (v === 1) return '1 heure'; if (v === 1.5) return '1h30'; if (v === 2) return '2 heures'; return minutesLabel(Math.round(v * 60)); }
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
  function optionChoisie(a) {
    var liste = optionsPour(a);
    if (!liste.length) return null;
    var choix = state.options[a.id] || {};
    var trouvee = liste.filter(function (o) { return choix[o.cle] === o.valeur; })[0];
    if (trouvee) return trouvee;
    // Le defaut : 1 h de piste, 1 partie, la session la plus courte.
    return liste.filter(function (o) { return (o.cle === 'duration' && o.valeur === 1) || (o.cle === 'games' && o.valeur === 1); })[0] || liste[0];
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

  /* --- Etape 1 : le jour et le groupe ------------------------------------------- */

  var dayBtn = $('#dayBtn'), dayList = $('#dayList'), dayLabel = $('#dayLabel'), dayHint = $('#dayHint');
  var dayField = dayBtn.closest('.fg-field');
  var paxOut = $('#paxOut'), paxValue = $('#paxValue'), paxHint = $('#paxHint');
  var PAX_MIN = 1, PAX_MAX = 240;

  // Le calendrier vient du serveur (calendar=45, cle center.calendar, a cote
  // de center.day) : ouverture, horaires, fermeture, ferie ou conge scolaire,
  // jour par jour. Sans lui (vieille reponse), la grille hebdomadaire du
  // centre fait un repli sans periode.
  function joursProposes() {
    var cal = meta && meta.center && Array.isArray(meta.center.calendar) ? meta.center.calendar : null;
    var today = meta && meta.today ? deIso(meta.today) : new Date();
    var out = [];
    if (cal && cal.length) {
      cal.forEach(function (j, i) {
        out.push({ date: j.date, ouvert: Boolean(j.open), horaire: j.open ? horaireLabel(j.schedule) : (j.closedLabel || 'Fermé'), periode: j.holiday ? { type: j.holiday.type, label: accentuer(j.holiday.label) } : null, coupures: j.closedWindows || [], aujourdhui: i === 0, demain: i === 1 });
      });
      return out;
    }
    var regular = meta && meta.center && meta.center.defaultSchedule && meta.center.defaultSchedule.regular;
    for (var i = 0; i < 45; i += 1) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      var r = regular ? regular[String(d.getDay())] : null;
      var sch = r && r.open ? { open: Number(r.open.split(':')[0]), close: Number(r.close.split(':')[0]) } : null;
      out.push({ date: iso(d), ouvert: Boolean(sch), horaire: horaireLabel(sch), periode: null, coupures: [], aujourdhui: i === 0, demain: i === 1 });
    }
    return out;
  }
  function jourInfo(dateStr) { return joursProposes().filter(function (j) { return j.date === dateStr; })[0] || null; }
  function rendreJours() {
    var moisVu = '';
    dayList.innerHTML = joursProposes().map(function (j, i) {
      var d = deIso(j.date);
      var mois = MOIS[d.getMonth()] + ' ' + d.getFullYear();
      var tete = '';
      if (mois !== moisVu) { tete = '<li class="fg-day__month" role="presentation">' + esc(cap(mois)) + '</li>'; moisVu = mois; }
      var libelle = jourLong(j.date) + (j.aujourdhui ? ' (aujourd’hui)' : j.demain ? ' (demain)' : '');
      var tag = j.periode ? '<i class="fg-tag ' + (j.periode.type === 'public' ? 'fg-tag--ferie' : 'fg-tag--vacances') + '">' + esc(j.periode.type === 'public' ? 'Férié · ' + j.periode.label : j.periode.label) + '</i>' : '';
      return tete + '<li role="presentation" style="--i:' + (i % 12) + '">'
        + '<button type="button" class="fg-day__opt' + (j.ouvert ? '' : ' is-off') + '" data-date="' + j.date + '" ' + (j.ouvert ? '' : 'disabled') + ' role="option" aria-selected="' + (j.date === state.date) + '">'
        + '<span class="fg-day__opt-main"><span>' + esc(libelle) + '</span>' + tag + '</span>'
        + '<small>' + esc(j.horaire) + '</small></button></li>';
    }).join('');
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
    var o = typeof ouvrir === 'boolean' ? ouvrir : dayList.hidden;
    if (o) rendreJours();
    dayList.hidden = !o;
    dayBtn.setAttribute('aria-expanded', String(o));
    // Le champ passe au-dessus de ses voisins tant que la liste est ouverte :
    // chaque champ anime porte son propre contexte d empilement.
    if (dayField) dayField.classList.toggle('is-open', o);
    if (o) { var sel = $('.fg-day__opt[aria-selected="true"]', dayList) || $('.fg-day__opt:not([disabled])', dayList); if (sel) { sel.focus({ preventScroll: true }); sel.scrollIntoView({ block: 'nearest' }); } }
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
      var a = activite(id);
      return a && !(a.maxPax && state.pax > a.maxPax);
    });
    rendreActivites();
    rendreFormules();
    rendreCompteur(false);
    aller('activites');
    placerBarre();
  });

  /* --- Etape 2 : les activites et les formules ----------------------------------- */

  var gridAct = $('#gridAct'), gridFor = $('#gridFor'), actCount = $('#actCount'), goHours = $('#goHours');
  function rendreOptions(a) {
    var liste = optionsPour(a);
    if (!liste.length) return '';
    var choix = optionChoisie(a);
    return '<div class="fg-opts" role="group" aria-label="Options ' + esc(a.name) + '">' + liste.map(function (o, i) {
      var on = choix && choix.cle === o.cle && choix.valeur === o.valeur;
      return '<button type="button" class="fg-opt' + (on ? ' is-on' : '') + '" style="--i:' + i + '" data-cle="' + o.cle + '" data-valeur="' + o.valeur + '" aria-pressed="' + on + '"><b>' + esc(o.label) + '</b><small>' + esc(euros(o.prix)) + '</small></button>';
    }).join('') + '</div>';
  }
  function rendreActivites() {
    gridAct.innerHTML = activitesVendables().map(function (a, i) {
      var p = photo(a.id);
      var on = state.selection.indexOf(a.id) >= 0;
      var trop = a.maxPax && state.pax > a.maxPax;
      return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '" data-activity="' + esc(a.id) + '">'
        + '<div class="fg-card fg-rise' + (on ? ' is-on' : '') + (trop ? ' is-off' : '') + '" style="--i:' + (i % 8) + '" data-activity="' + esc(a.id) + '" role="checkbox" tabindex="' + (trop ? '-1' : '0') + '" aria-checked="' + on + '" ' + (trop ? 'aria-disabled="true" title="' + esc(a.name) + ' : ' + a.maxPax + ' personnes maximum"' : '') + '>'
        + (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
        + '<span class="fg-card__glow" aria-hidden="true"></span>'
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
        + '<span class="fg-card__name">' + esc(a.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prixCarte(a)) + (a.note ? ' · ' + esc(a.note) : '') + '</span>'
        + '</div>'
        + rendreOptions(a)
        + '</li>';
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
      return '<li class="fg-grid__item' + (on ? ' is-on' : '') + '"><div class="fg-card fg-card--formule fg-rise' + (on ? ' is-on' : '') + (mini ? ' is-off' : '') + '" style="--i:' + (i % 8) + '" data-formule="' + esc(f.id) + '" role="radio" tabindex="' + (mini ? '-1' : '0') + '" aria-checked="' + on + '" ' + (mini ? 'aria-disabled="true" title="Minimum ' + f.minPax + ' personnes"' : '') + '>'
        + '<span class="fg-card__glow" aria-hidden="true"></span>'
        + '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
        + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#a-formule"/></svg></span>'
        + '<span class="fg-card__name">' + esc(f.name) + '</span>'
        + '<span class="fg-card__price">' + esc(prix) + (f.oldPrice ? ' <s>' + esc(euros(f.oldPrice)) + '</s>' : '') + '</span>'
        + '<span class="fg-card__meta">' + esc((f.desc || []).slice(0, 3).join(' · ')) + (f.minPax ? ' · dès ' + f.minPax + ' pers.' : '') + '</span>'
        + '</div></li>';
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
  // Le halo qui suit le pointeur sur une carte (souris seulement) : deux
  // variables CSS, aucun calcul de mise en page.
  if (finPointer) {
    var rectCarte = null, carteSurvolee = null;
    gridAct.addEventListener('pointerover', function (e) {
      var card = e.target.closest && e.target.closest('.fg-card');
      if (!card || card === carteSurvolee) return;
      carteSurvolee = card;
      rectCarte = card.getBoundingClientRect();
    });
    gridAct.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.fg-card');
      if (!card || card !== carteSurvolee || !rectCarte) return;
      var x = e.clientX - rectCarte.left, y = e.clientY - rectCarte.top;
      card.style.setProperty('--mx', x.toFixed(0) + 'px');
      card.style.setProperty('--my', y.toFixed(0) + 'px');
      card.style.setProperty('--rx', ((x / rectCarte.width - 0.5) * 7).toFixed(2) + 'deg');
      card.style.setProperty('--ry', ((0.5 - y / rectCarte.height) * 7).toFixed(2) + 'deg');
    });
    gridAct.addEventListener('pointerout', function (e) {
      var card = e.target.closest && e.target.closest('.fg-card');
      if (!card || card !== carteSurvolee) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      ['--mx', '--my', '--rx', '--ry'].forEach(function (v) { card.style.removeProperty(v); });
      carteSurvolee = null; rectCarte = null;
    });
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
    var prix = $('.fg-card__price', card);
    var a = activite(id);
    if (prix && a) prix.textContent = prixCarte(a) + (a.note ? ' · ' + a.note : '');
    rendreCompteur(true);
    invaliderDispo();
    setTimeout(posterHauteur, 320);
  }
  gridAct.addEventListener('click', function (e) {
    var opt = e.target.closest('.fg-opt');
    if (opt) {
      var item = opt.closest('.fg-grid__item');
      var a = activite(item.dataset.activity);
      if (!a) return;
      state.options[a.id] = {};
      state.options[a.id][opt.dataset.cle] = Number(opt.dataset.valeur);
      $$('.fg-opt', item).forEach(function (o) { var on = o === opt; o.classList.toggle('is-on', on); o.setAttribute('aria-pressed', String(on)); });
      var prix = $('.fg-card__price', item);
      if (prix) prix.textContent = prixCarte(a) + (a.note ? ' · ' + a.note : '');
      invaliderDispo();
      return;
    }
    basculerActivite(e.target.closest('.fg-card'));
  });
  gridAct.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('fg-card')) { e.preventDefault(); basculerActivite(e.target); }
  });
  function choisirFormule(card) {
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
  var rendusFrais = true;      // la cascade des puces ne joue qu au premier rendu
  var derniereAction = null;   // { activity, time } : la puce a retrouver apres un re-rendu
  function invaliderDispo() { state.dispo = null; state.creneau = null; state.heure = ''; state.pins = {}; state.laserParts = []; goContact.disabled = true; }
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
    return state.selection.map(function (id) { var a = activite(id); return a ? a.name : id; }).join(' + ');
  }
  function urlDispo() {
    var q = new URLSearchParams();
    q.set('centerId', CENTER); q.set('date', state.date); q.set('pax', String(state.pax));
    if (state.onglet === 'formules') { q.set('type', 'formule'); q.set('formuleId', state.formuleId); }
    else { q.set('type', 'visite'); q.set('program', JSON.stringify(programme())); }
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
    rendusFrais = true; derniereAction = null;
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
    var zone = $('#planZone');
    if (zone) zone.innerHTML = '<p class="fg-loading">On compose votre visite…</p>';
    fetch(urlDispo(), { credentials: 'omit' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (id !== requeteEnCours) return;
        if (!j || j.ok === false) throw new Error((j && j.message) || 'Disponibilités indisponibles.');
        state.dispo = j;
        var slot = (j.slots || [])[0] || null;
        state.creneau = slot ? { slot: slot, reponse: j } : null;
        state.heure = slot ? slot.time : '';
        rendreHeures();
        goContact.disabled = !slot;
      })
      .catch(function (err) {
        if (id !== requeteEnCours) return;
        hourZone.innerHTML = '<div class="fg-notice fg-notice--warn">' + esc(err.message || 'Impossible de charger les disponibilités.') + '</div>';
        posterHauteur();
      });
  }
  var MOTS_COURTS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', anchor_overlap: 'chevauche', resource_conflict: 'occupé', business_rules: 'non valable', unknown_anchor: 'indispo' };
  function motCourt(t) { return MOTS_COURTS[t.code] || 'indispo'; }
  function periode(h) { var n = Number(String(h).split(':')[0]); return n < 12 ? 'Matin' : n < 18 ? 'Après-midi' : 'Soirée'; }
  function rendreChips(times, actif, propose, multi) {
    var groupes = {};
    times.forEach(function (t) { var p = periode(t.time); (groupes[p] = groupes[p] || []).push(t); });
    var k = 0;
    var html = '<ul class="fg-chips' + (rendusFrais ? ' is-fresh' : '') + '" role="listbox" aria-label="Heures de début"' + (multi ? ' aria-multiselectable="true"' : '') + '>';
    Object.keys(groupes).forEach(function (p) {
      html += '<li class="fg-period fg-kicker" role="presentation">' + esc(p) + '</li>';
      groupes[p].forEach(function (t) {
        var ok = t.ok !== false;
        var on = actif.indexOf(t.time) >= 0;
        var prop = !on && propose === t.time;
        html += '<li role="presentation"><button type="button" class="fg-chip' + (on ? ' is-on' : '') + (prop ? ' is-proposed' : '') + (ok ? '' : ' is-off') + '" role="option" aria-selected="' + on + '" data-time="' + esc(t.time) + '" data-ok="' + ok + '" data-reason="' + esc(t.reason || '') + '" style="--i:' + (k++) + '" title="' + esc(ok ? '' : (t.reason || 'Indisponible')) + '">'
          + '<b>' + esc(t.time) + '</b>' + (ok ? (prop ? '<small>proposé</small>' : '') : '<small>' + esc(motCourt(t)) + '</small>') + '</button></li>';
      });
    });
    return html + '</ul>';
  }
  function rendreHeures() {
    var d = state.dispo;
    var ancres = (d.anchors && d.anchors.activities) || [];
    var html = '';
    if (ancres.length) {
      // Une piste par activite planifiee : TOUTES les heures du jour, celles
      // qui ne tiennent pas restent visibles avec leur raison.
      var defauts = (d.anchors && d.anchors.defaultTimes) || {};
      ancres.forEach(function (a, i) {
        var laser = a.activityId === 'laser_game';
        var count = Math.max(1, Number(a.count) || 1);
        var actifs = laser && state.laserParts.length ? state.laserParts : (state.pins[a.activityId] ? [state.pins[a.activityId]] : []);
        var multi = laser && count > 1;
        var detail = (laser ? count + ' partie' + (count > 1 ? 's' : '') + ' · ' : '') + minutesLabel(a.durationMinutes) + (count > 1 ? ' chacune' : '') + (multi ? ' · choisissez jusqu’à ' + count + ' heures' : '');
        html += '<section class="fg-track' + (rendusFrais ? ' fg-rise' : '') + '" style="--i:' + i + '" data-activity="' + esc(a.activityId) + '" data-count="' + count + '">'
          + '<div class="fg-track__head"><span class="fg-track__icon"><svg aria-hidden="true"><use href="#' + icone(a.activityId) + '"/></svg></span><b>' + esc(a.label || a.activityId) + '</b><span class="fg-track__detail">' + esc(detail) + '</span>'
          + (actifs.length ? '<button type="button" class="fg-link fg-track__reset" data-reset="' + esc(a.activityId) + '">Laisser l’équipe placer</button>' : '') + '</div>'
          + rendreChips(a.times || [], actifs, actifs.length ? '' : (defauts[a.activityId] || ''), multi)
          + '<p class="fg-why" role="status" hidden></p>'
          + '</section>';
      });
    } else {
      var slots = (d.slots || []).map(function (s) { return { time: s.time, ok: true }; });
      if (!slots.length) {
        html += '<div class="fg-notice fg-notice--warn"><b>' + esc(d.message || 'Aucun créneau ce jour-là.') + '</b></div>';
      } else {
        html += '<section class="fg-track' + (rendusFrais ? ' fg-rise' : '') + '" style="--i:0" data-activity="">' + rendreChips(slots, state.heure ? [state.heure] : [], '', false) + '<p class="fg-why" role="status" hidden></p></section>';
      }
    }
    html += '<div id="planZone"></div>';
    hourZone.innerHTML = html;
    keepLabel.textContent = ancres.length ? 'Garder ces horaires' : 'Garder ce créneau';
    rendusFrais = false;
    // La puce que l on vient de poser retrouve le focus et lance son onde.
    if (derniereAction) {
      var posee = $('.fg-track[data-activity="' + derniereAction.activity + '"] .fg-chip[data-time="' + derniereAction.time + '"]', hourZone);
      if (posee) { posee.classList.add('is-just'); posee.focus({ preventScroll: true }); }
      derniereAction = null;
    }
    rendrePlan();
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    var reset = e.target.closest('[data-reset]');
    if (reset) {
      var idr = reset.dataset.reset;
      delete state.pins[idr];
      if (idr === 'laser_game') state.laserParts = [];
      chargerPlan();
      return;
    }
    var chip = e.target.closest('.fg-chip');
    if (!chip) return;
    var track = chip.closest('.fg-track');
    var why = $('.fg-why', track);
    if (chip.dataset.ok === 'false') {
      // Une heure impossible se lit : la raison vient du moteur, mot pour mot.
      $$('.fg-chip.is-asked', track).forEach(function (c) { c.classList.remove('is-asked'); });
      chip.classList.add('is-asked');
      why.innerHTML = '<b>' + esc(chip.dataset.time) + '</b> : ' + esc(chip.dataset.reason || 'indisponible à cette heure.');
      why.hidden = false;
      posterHauteur();
      return;
    }
    why.hidden = true;
    var idA = track.dataset.activity;
    var t = chip.dataset.time;
    if (!idA) {
      // Formule ou visite sans activite planifiee : le creneau se retient tel quel.
      var direct = (state.dispo.slots || []).filter(function (s) { return s.time === t; })[0];
      if (!direct) return;
      state.heure = t;
      state.creneau = { slot: direct, reponse: state.dispo };
      $$('.fg-chip', track).forEach(function (c) { var on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-selected', String(on)); });
      rendrePlan();
      goContact.disabled = false;
      return;
    }
    var count = Number(track.dataset.count) || 1;
    derniereAction = { activity: idA, time: t };
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
  function blocsDuPlan(cr) {
    var plan = cr && cr.slot ? (cr.slot.opsPlan || {}) : {};
    return (plan.resourceBlocks || []).filter(function (b) { return b.type === 'activity' || b.activityId; });
  }
  function rendrePlan() {
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
          var texte = s.label || Object.keys(times).map(function (k) { var a = activite(k); return (a ? a.name : k) + ' ' + times[k]; }).join(' · ');
          return '<button type="button" class="fg-suggest__btn" data-suggest="' + esc(JSON.stringify(times)) + '" style="--i:' + i + '">' + esc(texte) + '</button>';
        }).join('') + '</span>';
      }
      zone.innerHTML = html + '</div>';
      posterHauteur();
      return;
    }
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
    var prix = Number(cr.reponse.price);
    var complet = !cr.reponse.program || cr.reponse.program.priceComplete !== false;
    var fin = cr.slot.visitEndTime || '';
    zone.innerHTML = '<div class="fg-plan is-swap"><svg aria-hidden="true"><use href="#i-clock"/></svg>' + parties.join('<span class="dot">·</span>')
      + (fin ? '<span class="dot">·</span>Fin vers <b>' + esc(fin) + '</b>' : '')
      + (prix > 0 ? '<span class="dot">·</span><span class="fg-plan__price">' + esc(euros(prix)) + (complet ? '' : ' + activités réglées sur place') + '</span>' : '')
      + '</div>';
    var avis = (plan.comfortNotices || []).map(function (n) { return typeof n === 'string' ? n : (n && (n.message || n.label)) || ''; }).filter(Boolean);
    if (avis.length) zone.innerHTML += '<div class="fg-notice">' + avis.map(esc).join('<br>') + '</div>';
    posterHauteur();
  }
  hourZone.addEventListener('click', function (e) {
    var s = e.target.closest('[data-suggest]');
    if (!s) return;
    try {
      var times = JSON.parse(s.dataset.suggest);
      state.pins = {}; state.laserParts = [];
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
        var detail = it.games ? it.games + ' partie' + (it.games > 1 ? 's' : '') : (it.minutes ? minutesLabel(it.minutes) : '');
        if (it.services && it.services.length > 1) detail += ' · ' + it.services.length + ' services';
        lignes.push({ icone: icone(it.activityId), nom: it.name || it.activityId, detail: detail, aside: bloc && bloc.startTime ? bloc.startTime : '' });
      });
    } else {
      state.selection.forEach(function (id) { var a = activite(id); lignes.push({ icone: icone(id), nom: a ? a.name : id, detail: '', aside: '' }); });
    }
    var prix = Number(rep.price) || 0;
    var complet = !rep.program || rep.program.priceComplete !== false;
    var j = jourInfo(state.date);
    var html = '<div class="fg-recap__row fg-rise" style="--i:1"><svg aria-hidden="true"><use href="#i-calendar"/></svg>' + esc(jourLong(state.date)) + (j && j.periode ? ' <i class="fg-tag ' + (j.periode.type === 'public' ? 'fg-tag--ferie' : 'fg-tag--vacances') + '">' + esc(j.periode.label) + '</i>' : '') + '</div>'
      + '<div class="fg-recap__row fg-rise" style="--i:2"><svg aria-hidden="true"><use href="#i-users"/></svg>' + esc(personnes(state.pax)) + '</div>'
      + '<div class="fg-recap__sep"></div>';
    lignes.forEach(function (l, i) {
      html += '<div class="fg-recap__item fg-rise" style="--i:' + (3 + i) + '"><span class="fg-recap__badge"><svg aria-hidden="true"><use href="#' + l.icone + '"/></svg></span>'
        + '<span><span class="fg-recap__name">' + esc(l.nom) + '</span>' + (l.detail ? '<br><span class="fg-recap__detail">' + esc(l.detail) + '</span>' : '') + '</span>'
        + '<span class="fg-recap__aside">' + (l.aside ? 'Début<b>' + esc(l.aside) + '</b>' : (i === 0 && plan.arrivalTime ? 'Arrivée<b>' + esc(plan.arrivalTime) + '</b>' : '')) + '</span></div>';
    });
    html += '<div class="fg-recap__sep"></div>'
      + (plan.arrivalTime ? '<div class="fg-recap__row fg-rise" style="--i:' + (3 + lignes.length) + '"><svg aria-hidden="true"><use href="#i-clock"/></svg>Arrivée conseillée à <b>&nbsp;' + esc(plan.arrivalTime) + '</b>' + (cr.slot.visitEndTime ? ', fin vers ' + esc(cr.slot.visitEndTime) : '') + '</div>' : '')
      + '<div class="fg-total fg-rise" style="--i:' + (4 + lignes.length) + '"><div><div class="fg-total__label">' + (complet ? 'Total estimé' : 'Total estimé, hors activités réglées sur place') + '</div>'
      + '<div class="fg-total__amount" id="totalAmount" data-total="' + prix + '">' + (prix > 0 ? esc(euros(prix)) : 'Sur place') + '</div></div>'
      + '<div class="fg-total__pay"><svg aria-hidden="true"><use href="#i-card"/></svg><span>Paiement<br>sur place</span></div></div>'
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
    rendrePax(0);
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
        // Le premier jour ouvert : aujourd hui si le centre est ouvert, sinon
        // le prochain.
        var premier = joursProposes().filter(function (x) { return x.ouvert; })[0];
        if (premier) choisirJour(premier.date);
        rendrePax(0);
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
