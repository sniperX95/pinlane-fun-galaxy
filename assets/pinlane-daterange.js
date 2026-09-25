/* ==========================================================================
   window.PinlaneDateRange : selecteur de plage de dates de la console admin
   (categorie Direction). Vanilla, zero dependance, zero build. Style :
   assets/pinlane-daterange.css (classes pdr-).

   Contrat :
   - mount(host, { value, onChange, maxDate }) -> handle { getValue(),
     setValue(v), destroy() }.
     host = element OU id (degrade silencieux si absent).
     value = { start:'YYYY-MM-DD', end:'YYYY-MM-DD',
               granularity:'day'|'week'|'month', compare:'none'|'previous'|'year' }.
     maxDate:'YYYY-MM-DD' (defaut aujourd'hui, on ne choisit pas le futur).
     onChange(next) appele a CHAQUE changement avec la valeur complete
     normalisee (start <= end <= maxDate garanti).
   - Barre de 3 controles facon Vercel Analytics : pilule Plage de dates (popover
     presets a gauche + deux champs debut/fin pour le mode Personnalise), pilule
     granularite (Par jour / semaine / mois), toggle Comparer (+ pilule Periode
     precedente / Annee precedente quand actif).
   - Formatage FR-BE ('30 avr. 2026'), fuseau local, chiffres tabulaires.
   - Popovers fermes au clic exterieur et a Echap, un seul ouvert a la fois.
   - Accessible : boutons focalisables, aria-expanded / aria-pressed / aria-checked.

   Dates : on manipule des chaines 'YYYY-MM-DD' en fuseau LOCAL. new Date(str)
   parserait en UTC (bug de decalage) : on decompose donc les composants a la
   main. Deux chaines ISO se comparent chronologiquement par comparaison
   lexicographique, ce que fait cmp().
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var PRESETS = [
    { id: 'last7', label: '7 derniers jours' },
    { id: 'last30', label: '30 derniers jours' },
    { id: 'thisMonth', label: 'Ce mois-ci' },
    { id: 'lastMonth', label: 'Mois dernier' },
    { id: 'last90', label: '90 derniers jours' },
    { id: 'thisYear', label: 'Cette année' },
    { id: 'custom', label: 'Personnalisée' },
  ];
  var GRANS = [
    { id: 'day', label: 'Par jour' },
    { id: 'week', label: 'Par semaine' },
    { id: 'month', label: 'Par mois' },
  ];
  var COMPARES = [
    { id: 'previous', label: 'Période précédente' },
    { id: 'year', label: 'Année précédente' },
  ];

  // ---- Helpers dates (fuseau local, ISO 'YYYY-MM-DD') ---------------------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isValidISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = dateFromISO(s);
    return d.getFullYear() === Number(s.slice(0, 4))
      && d.getMonth() === Number(s.slice(5, 7)) - 1
      && d.getDate() === Number(s.slice(8, 10));
  }

  function dateFromISO(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function isoFromDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return isoFromDate(new Date()); }

  function addDays(iso, n) {
    var d = dateFromISO(iso);
    d.setDate(d.getDate() + n);
    return isoFromDate(d);
  }

  function startOfMonth(iso) { return iso.slice(0, 7) + '-01'; }
  function startOfYear(iso) { return iso.slice(0, 4) + '-01-01'; }

  // Comparaison chronologique de deux chaines ISO (lexicographique = temporel).
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  // Garantie du contrat : start <= end <= maxDate. end plafonne d'abord a
  // maxDate, puis start est ramene sous end (borne du mode Personnalise).
  function clampRange(start, end, maxDate) {
    var s = start;
    var e = end;
    if (cmp(e, maxDate) > 0) e = maxDate;
    if (cmp(s, maxDate) > 0) s = maxDate;
    if (cmp(s, e) > 0) { s = e; }
    return { start: s, end: e };
  }

  function presetRange(id, maxDate) {
    if (id === 'last7') return { start: addDays(maxDate, -6), end: maxDate };
    if (id === 'last30') return { start: addDays(maxDate, -29), end: maxDate };
    if (id === 'last90') return { start: addDays(maxDate, -89), end: maxDate };
    if (id === 'thisMonth') return { start: startOfMonth(maxDate), end: maxDate };
    if (id === 'lastMonth') {
      var lastDay = addDays(startOfMonth(maxDate), -1);
      return { start: startOfMonth(lastDay), end: lastDay };
    }
    if (id === 'thisYear') return { start: startOfYear(maxDate), end: maxDate };
    return null; // custom : pas de plage predefinie
  }

  function detectPreset(start, end, maxDate) {
    for (var i = 0; i < PRESETS.length; i += 1) {
      if (PRESETS[i].id === 'custom') continue;
      var r = presetRange(PRESETS[i].id, maxDate);
      if (r && r.start === start && r.end === end) return PRESETS[i].id;
    }
    return 'custom';
  }

  function formatFR(iso) {
    try {
      return dateFromISO(iso).toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (e) { return iso; }
  }

  function granLabel(g) {
    for (var i = 0; i < GRANS.length; i += 1) if (GRANS[i].id === g) return GRANS[i].label;
    return GRANS[0].label;
  }

  function compareLabel(c) {
    for (var i = 0; i < COMPARES.length; i += 1) if (COMPARES[i].id === c) return COMPARES[i].label;
    return COMPARES[0].label;
  }

  // ---- Normalisation de la valeur -----------------------------------------

  function normalizeValue(v, maxDate) {
    var src = v && typeof v === 'object' ? v : {};
    var end = isValidISO(src.end) ? src.end : maxDate;
    var start = isValidISO(src.start) ? src.start : addDays(end, -29);
    var r = clampRange(start, end, maxDate);
    var g = (src.granularity === 'week' || src.granularity === 'month') ? src.granularity : 'day';
    var c = (src.compare === 'previous' || src.compare === 'year') ? src.compare : 'none';
    return { start: r.start, end: r.end, granularity: g, compare: c };
  }

  // ---- Balisage ------------------------------------------------------------

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function caretSVG() {
    return '<svg class="pdr-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">'
      + '<path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';
  }

  function resolveHost(host) {
    if (!host) return null;
    if (typeof host === 'string') return document.getElementById(host);
    return host.nodeType === 1 ? host : null;
  }

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // ---- mount ---------------------------------------------------------------

  function mount(host, options) {
    var el = resolveHost(host);
    if (!el) return null; // degrade silencieux

    var opts = options || {};
    var maxDate = isValidISO(opts.maxDate) ? opts.maxDate : todayISO();
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var init = normalizeValue(opts.value, maxDate);
    var state = {
      start: init.start,
      end: init.end,
      granularity: init.granularity,
      compareOn: init.compare !== 'none',
      compareMode: init.compare === 'year' ? 'year' : 'previous',
    };
    var openName = null; // 'range' | 'gran' | 'compare' | null
    var destroyed = false;

    // Structure statique de la barre. Les panneaux sont injectes a l'ouverture.
    el.innerHTML = ''
      + '<div class="pdr-bar" role="group" aria-label="Plage de dates et granularite">'
      + '  <div class="pdr-group pdr-group-range">'
      + '    <button type="button" class="pdr-pill pdr-range-trigger" aria-haspopup="dialog" aria-expanded="false">'
      + '      <span class="pdr-label">Plage de dates</span>'
      + '      <span class="pdr-sep" aria-hidden="true"></span>'
      + '      <span class="pdr-value pdr-range-value"></span>'
      + caretSVG()
      + '    </button>'
      + '    <div class="pdr-pop" data-pop="range"></div>'
      + '  </div>'
      + '  <div class="pdr-group pdr-group-gran">'
      + '    <button type="button" class="pdr-pill pdr-gran-trigger" aria-haspopup="menu" aria-expanded="false">'
      + '      <span class="pdr-value pdr-gran-value"></span>'
      + caretSVG()
      + '    </button>'
      + '    <div class="pdr-pop" data-pop="gran"></div>'
      + '  </div>'
      + '  <div class="pdr-group pdr-group-compare">'
      + '    <button type="button" class="pdr-toggle pdr-compare-toggle" aria-pressed="false">'
      + '      <span class="pdr-switch" aria-hidden="true"><span class="pdr-switch-knob"></span></span>'
      + '      <span>Comparer</span>'
      + '    </button>'
      + '    <span class="pdr-compare-extra" hidden>'
      + '      <button type="button" class="pdr-pill pdr-compare-trigger" aria-haspopup="menu" aria-expanded="false">'
      + '        <span class="pdr-value pdr-compare-value"></span>'
      + caretSVG()
      + '      </button>'
      + '      <div class="pdr-pop" data-pop="compare"></div>'
      + '    </span>'
      + '  </div>'
      + '</div>';

    var bar = el.querySelector('.pdr-bar');
    var rangeTrigger = el.querySelector('.pdr-range-trigger');
    var rangeValueEl = el.querySelector('.pdr-range-value');
    var granTrigger = el.querySelector('.pdr-gran-trigger');
    var granValueEl = el.querySelector('.pdr-gran-value');
    var compareToggle = el.querySelector('.pdr-compare-toggle');
    var compareExtra = el.querySelector('.pdr-compare-extra');
    var compareTrigger = el.querySelector('.pdr-compare-trigger');
    var compareValueEl = el.querySelector('.pdr-compare-value');
    var rangePop = el.querySelector('.pdr-pop[data-pop="range"]');
    var granPop = el.querySelector('.pdr-pop[data-pop="gran"]');
    var comparePop = el.querySelector('.pdr-pop[data-pop="compare"]');

    function popFor(name) {
      return name === 'range' ? rangePop : (name === 'gran' ? granPop : comparePop);
    }
    function triggerFor(name) {
      return name === 'range' ? rangeTrigger : (name === 'gran' ? granTrigger : compareTrigger);
    }

    function currentValue() {
      return {
        start: state.start,
        end: state.end,
        granularity: state.granularity,
        compare: state.compareOn ? state.compareMode : 'none',
      };
    }

    function emit() { onChange(currentValue()); }

    // ---- Rendu des libelles ----
    function renderRangeValue() {
      rangeValueEl.textContent = formatFR(state.start) + ' → ' + formatFR(state.end);
    }
    function renderGranValue() { granValueEl.textContent = granLabel(state.granularity); }
    function renderCompare() {
      compareToggle.setAttribute('aria-pressed', state.compareOn ? 'true' : 'false');
      if (state.compareOn) compareExtra.removeAttribute('hidden');
      else compareExtra.setAttribute('hidden', '');
      compareValueEl.textContent = compareLabel(state.compareMode);
    }
    function renderAll() {
      renderRangeValue();
      renderGranValue();
      renderCompare();
    }

    // ---- Panneaux (construits a l'ouverture) ----
    function rangePanelHTML() {
      var current = detectPreset(state.start, state.end, maxDate);
      var items = PRESETS.map(function (p) {
        return '<button type="button" class="pdr-preset" role="listitem" data-preset="' + p.id + '"'
          + ' aria-current="' + (p.id === current ? 'true' : 'false') + '">' + esc(p.label) + '</button>';
      }).join('');
      return '<div class="pdr-panel pdr-range-panel pdr-anim" role="dialog" aria-label="Choisir la plage de dates">'
        + '<div class="pdr-presets" role="list">' + items + '</div>'
        + '<div class="pdr-custom">'
        + '<label class="pdr-field"><span>Début</span>'
        + '<input type="date" class="pdr-date pdr-date-start" value="' + esc(state.start) + '" max="' + esc(maxDate) + '"></label>'
        + '<label class="pdr-field"><span>Fin</span>'
        + '<input type="date" class="pdr-date pdr-date-end" value="' + esc(state.end) + '" max="' + esc(maxDate) + '"></label>'
        + '</div>'
        + '</div>';
    }
    function menuPanelHTML(kind) {
      var list = kind === 'gran' ? GRANS : COMPARES;
      var currentId = kind === 'gran' ? state.granularity : state.compareMode;
      var attr = kind === 'gran' ? 'data-gran' : 'data-compare';
      var extra = kind === 'gran' ? 'pdr-gran-panel' : 'pdr-compare-panel';
      var items = list.map(function (m) {
        return '<button type="button" class="pdr-item" role="menuitemradio" ' + attr + '="' + m.id + '"'
          + ' aria-checked="' + (m.id === currentId ? 'true' : 'false') + '">' + esc(m.label) + '</button>';
      }).join('');
      return '<div class="pdr-panel pdr-menu ' + extra + ' pdr-anim" role="menu">' + items + '</div>';
    }

    // ---- Ouverture / fermeture ----
    function openPop(name) {
      closeAllPops();
      openName = name;
      var pop = popFor(name);
      var trig = triggerFor(name);
      pop.innerHTML = name === 'range' ? rangePanelHTML() : menuPanelHTML(name);
      var panel = pop.firstElementChild;
      if (trig) trig.setAttribute('aria-expanded', 'true');
      // Double rAF : l'etat initial (.pdr-anim) est peint, PUIS .pdr-in
      // declenche la transition. Sous reduced-motion le CSS pose l'etat final.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          if (panel && panel.isConnected) panel.classList.add('pdr-in');
        });
      });
      // Focus premier element utile (accessibilite).
      var first = panel && panel.querySelector('button, input');
      if (first && typeof first.focus === 'function') {
        try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
      }
    }
    function closePop(name) {
      var pop = popFor(name);
      if (pop) pop.innerHTML = '';
      var trig = triggerFor(name);
      if (trig) trig.setAttribute('aria-expanded', 'false');
      if (openName === name) openName = null;
    }
    function closeAllPops() {
      ['range', 'gran', 'compare'].forEach(function (n) { closePop(n); });
      openName = null;
    }
    function togglePop(name) {
      if (openName === name) closePop(name);
      else openPop(name);
    }

    // ---- Handlers ----
    function onRangeTrigger() { togglePop('range'); }
    function onGranTrigger() { togglePop('gran'); }
    function onCompareTrigger() { togglePop('compare'); }

    function onRangePopClick(evt) {
      var btn = evt.target.closest ? evt.target.closest('[data-preset]') : null;
      if (!btn || !rangePop.contains(btn)) return;
      var id = btn.getAttribute('data-preset');
      if (id === 'custom') {
        // Bascule en mode Personnalise : on garde le popover ouvert et on
        // amene le focus sur le champ de debut. Aucune emission (rien n'a change).
        var startInput = rangePop.querySelector('.pdr-date-start');
        if (startInput) startInput.focus();
        return;
      }
      var r = presetRange(id, maxDate);
      if (!r) return;
      state.start = r.start;
      state.end = r.end;
      renderRangeValue();
      closePop('range');
      emit();
    }

    function onRangePopChange(evt) {
      var input = evt.target.closest ? evt.target.closest('.pdr-date') : null;
      if (!input) return;
      var startInput = rangePop.querySelector('.pdr-date-start');
      var endInput = rangePop.querySelector('.pdr-date-end');
      if (!startInput || !endInput) return;
      var s = isValidISO(startInput.value) ? startInput.value : state.start;
      var e = isValidISO(endInput.value) ? endInput.value : state.end;
      var r = clampRange(s, e, maxDate);
      state.start = r.start;
      state.end = r.end;
      // Reflechit la valeur corrigee dans les champs et met a jour les presets.
      startInput.value = state.start;
      endInput.value = state.end;
      var current = detectPreset(state.start, state.end, maxDate);
      Array.prototype.forEach.call(rangePop.querySelectorAll('.pdr-preset'), function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-preset') === current ? 'true' : 'false');
      });
      renderRangeValue();
      emit();
    }

    function onGranPopClick(evt) {
      var btn = evt.target.closest ? evt.target.closest('[data-gran]') : null;
      if (!btn || !granPop.contains(btn)) return;
      state.granularity = btn.getAttribute('data-gran');
      renderGranValue();
      closePop('gran');
      emit();
    }

    function onComparePopClick(evt) {
      var btn = evt.target.closest ? evt.target.closest('[data-compare]') : null;
      if (!btn || !comparePop.contains(btn)) return;
      state.compareMode = btn.getAttribute('data-compare');
      state.compareOn = true;
      renderCompare();
      closePop('compare');
      emit();
    }

    function onCompareToggle() {
      state.compareOn = !state.compareOn;
      if (!state.compareOn) closePop('compare');
      renderCompare();
      emit();
    }

    // ---- Clic exterieur + Echap (capture : un seul ouvert, ferme dehors) ----
    function onDocClick(evt) {
      if (!openName) return;
      if (bar.contains(evt.target)) return;
      closePop(openName);
    }
    function onDocKey(evt) {
      if (evt.key !== 'Escape' || !openName) return;
      var trig = triggerFor(openName);
      closePop(openName);
      if (trig && typeof trig.focus === 'function') trig.focus();
    }

    rangeTrigger.addEventListener('click', onRangeTrigger);
    granTrigger.addEventListener('click', onGranTrigger);
    compareTrigger.addEventListener('click', onCompareTrigger);
    compareToggle.addEventListener('click', onCompareToggle);
    rangePop.addEventListener('click', onRangePopClick);
    rangePop.addEventListener('change', onRangePopChange);
    granPop.addEventListener('click', onGranPopClick);
    comparePop.addEventListener('click', onComparePopClick);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onDocKey, true);

    renderAll();

    // ---- Handle ----
    return {
      getValue: function () { return currentValue(); },
      setValue: function (v) {
        if (destroyed) return;
        var nv = normalizeValue(v, maxDate);
        state.start = nv.start;
        state.end = nv.end;
        state.granularity = nv.granularity;
        state.compareOn = nv.compare !== 'none';
        if (nv.compare === 'year') state.compareMode = 'year';
        else if (nv.compare === 'previous') state.compareMode = 'previous';
        closeAllPops();
        renderAll();
        // setValue est programmatique : pas d'emission (evite les boucles).
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onDocKey, true);
        el.innerHTML = '';
      },
    };
  }

  window.PinlaneDateRange = { mount: mount };
})();
