/* ==========================================================================
   window.PinlaneAnalyticsBoard : tableau d'analyse personnalisable facon
   iPhone (mode edition : bouger / supprimer / ajouter des widgets). Vanilla,
   zero dependance, zero build. Style : assets/pinlane-analytics-board.css
   (classes pab-). Deux instances (dashboard, direction) cohabitent via des
   storageKey distincts : configs independantes, persistees en localStorage.

   Contrat :
   - mount(host, { storageKey, getAnalytics, defaultWidgets, maxDate })
       -> handle { destroy(), refresh() }.
     host = element OU id (degrade silencieux si absent).
     storageKey : cle localStorage (widgets + plage). Deux boards = deux cles.
     getAnalytics(startISO, endISO) -> Promise<analytics>. Le board NE fetch pas
       lui-meme : il appelle getAnalytics quand la plage change.
       analytics = { totals:{ reservations, revenue, pax, avgBasket,
         paymentRate, cancelRate }, daily:[{date,count,revenue,pax}],
         byType:{ '<type>':{count,revenue,pax} },
         byChannel:[{channel,count}], occupancy:{ rate } }.
     defaultWidgets : liste initiale si rien en storage,
       ex [{metric:'revenue',viz:'line'},{metric:'byType',viz:'donut'}].
     maxDate : 'YYYY-MM-DD' (defaut aujourd'hui, borne du selecteur de plage).

   Catalogue :
   - series : revenue / reservations / pax  -> viz 'line' | 'bars'
   - split  : byType / byChannel            -> viz 'donut' | 'bars'
   - stat   : occupancy / paymentRate / cancelRate / avgBasket -> viz 'tile'

   Rendu delegue a window.PinlaneCharts (lineChart / barChart / donutChart /
   countUp) : le survol/tooltip vient du moteur, on ne le reimplemente pas.
   Plage libre deleguee a window.PinlaneDateRange.

   Motion (Emil Kowalski) : transform / opacity, ease-out, jamais ease-in ni
   scale(0), <= 300ms. Mode edition : oscillation legere des cartes (jiggle),
   coupee sous prefers-reduced-motion. Un motionKey par widget + plage anime
   chaque graphe une seule fois (garde de premiere apparition du moteur).

   PIEGE repo : body.staff-mode header ET body.admin-mode header sont ecrases a
   hauteur 0. Ce composant n'emet JAMAIS de <header> : uniquement div / section.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Catalogue des metriques : kind pilote le rendu, viz les formes offertes.
  var CATALOG = {
    revenue: { kind: 'series', label: "Chiffre d'affaires", format: 'euro', field: 'revenue', viz: ['line', 'bars'] },
    reservations: { kind: 'series', label: 'Reservations', format: 'int', field: 'count', viz: ['line', 'bars'] },
    pax: { kind: 'series', label: 'Joueurs', format: 'int', field: 'pax', viz: ['line', 'bars'] },
    byType: { kind: 'split', label: 'Repartition par activite', format: 'int', viz: ['donut', 'bars'] },
    byChannel: { kind: 'split', label: 'Canaux', format: 'int', viz: ['donut', 'bars'] },
    occupancy: { kind: 'stat', label: 'Taux de remplissage', format: 'percent', viz: ['tile'] },
    paymentRate: { kind: 'stat', label: "Taux d'encaissement", format: 'percent', viz: ['tile'] },
    cancelRate: { kind: 'stat', label: "Taux d'annulation", format: 'percent', viz: ['tile'] },
    avgBasket: { kind: 'stat', label: 'Panier moyen', format: 'euro', viz: ['tile'] },
  };

  // Ordre d'affichage dans le choix d'ajout, groupe par famille. `hint` = la
  // legende ASCII qui explique la famille sous son titre dans le selecteur.
  var PICKER_GROUPS = [
    { title: 'Evolutions', hint: 'suivi jour par jour', metrics: ['revenue', 'reservations', 'pax'] },
    { title: 'Repartitions', hint: 'la part de chaque categorie', metrics: ['byType', 'byChannel'] },
    { title: 'Indicateurs', hint: 'un chiffre cle sur la periode', metrics: ['occupancy', 'paymentRate', 'cancelRate', 'avgBasket'] },
  ];
  var VIZ_LABEL = { line: 'Courbe', bars: 'Barres', donut: 'Anneau', tile: 'Grand chiffre' };
  // Mini-glyphes 20x20 (currentColor) pour donner un apercu de chaque forme.
  var VIZ_ICON = {
    line: '<path d="M2 15 C5 15 5 7 8 7 C11 7 10 12 13 12 C16 12 15 5 18 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>',
    bars: '<rect x="3" y="10" width="3.2" height="7" rx="1"></rect><rect x="8.4" y="5" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="12" width="3.2" height="5" rx="1"></rect>',
    donut: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-opacity="0.28"></circle><path d="M10 4 A6 6 0 0 1 15.2 12.8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"></path>',
    tile: '<rect x="3" y="5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect><rect x="5.5" y="8" width="6" height="1.8" rx="0.9"></rect><rect x="5.5" y="11" width="9" height="1.8" rx="0.9"></rect>',
  };
  function vizIcon(v) {
    return '<svg class="pab-viz-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' + (VIZ_ICON[v] || '') + '</svg>';
  }

  var CHART_H = 190;
  var LONG_PRESS_MS = 450;
  var DRAG_THRESHOLD_SQ = 25; // (5px)^2 : au-dela on considere un glisser
  var PRESS_MOVE_SQ = 64; // (8px)^2 : au-dela l'appui long est annule

  // Garde de premiere apparition des tuiles chiffrees (le moteur gere deja
  // celle des graphes via PINLANE_CHARTS_SEEN). Partagee entre instances.
  var SEEN_TILES = window.__PAB_SEEN_TILES instanceof Set ? window.__PAB_SEEN_TILES : new Set();
  window.__PAB_SEEN_TILES = SEEN_TILES;

  // ---- Helpers generaux ----------------------------------------------------

  function resolveHost(host) {
    if (!host) return null;
    if (typeof host === 'string') return document.getElementById(host);
    return host.nodeType === 1 ? host : null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // Formatage identique au moteur (countUp) pour l'etat final immediat quand la
  // tuile a deja ete animee : evite de rejouer le compteur au re-rendu.
  var INT_FMT = null;
  function groupInt(v) {
    if (!INT_FMT) {
      try { INT_FMT = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }); } catch (e) { INT_FMT = { format: String }; }
    }
    return INT_FMT.format(v);
  }
  function fmtStat(value, format) {
    var v = Number(value);
    if (!Number.isFinite(v)) v = 0;
    v = Math.round(v);
    if (format === 'euro') return groupInt(v) + ' €';
    if (format === 'percent') return String(v) + '%';
    return groupInt(v);
  }

  // ---- Helpers dates (fuseau local, ISO 'YYYY-MM-DD') ----------------------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoFromDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayISO() { return isoFromDate(new Date()); }
  function dateFromISO(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function isValidISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = dateFromISO(s);
    return d.getFullYear() === Number(s.slice(0, 4))
      && d.getMonth() === Number(s.slice(5, 7)) - 1
      && d.getDate() === Number(s.slice(8, 10));
  }
  function addDays(iso, n) { var d = dateFromISO(iso); d.setDate(d.getDate() + n); return isoFromDate(d); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  // ---- Normalisation config ------------------------------------------------

  function isValidWidget(w) {
    if (!w || typeof w !== 'object') return false;
    var meta = CATALOG[w.metric];
    if (!meta) return false;
    return meta.viz.indexOf(w.viz) !== -1;
  }

  // Ne conserve que les couples metrique+forme valides : une config storage
  // corrompue ne fait pas planter le board, elle est filtree.
  function sanitizeWidgets(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (w) {
      if (isValidWidget(w)) out.push({ id: typeof w.id === 'string' ? w.id : null, metric: w.metric, viz: w.viz });
    });
    return out;
  }

  function normalizeRange(v, maxDate) {
    var src = v && typeof v === 'object' ? v : {};
    var end = isValidISO(src.end) ? src.end : maxDate;
    var start = isValidISO(src.start) ? src.start : addDays(end, -29);
    if (cmp(end, maxDate) > 0) end = maxDate;
    if (cmp(start, maxDate) > 0) start = maxDate;
    if (cmp(start, end) > 0) start = end;
    var g = (src.granularity === 'week' || src.granularity === 'month') ? src.granularity : 'day';
    var c = (src.compare === 'previous' || src.compare === 'year') ? src.compare : 'none';
    return { start: start, end: end, granularity: g, compare: c };
  }

  function defaultRange(maxDate) {
    return { start: addDays(maxDate, -29), end: maxDate, granularity: 'day', compare: 'none' };
  }

  // ---- Petits fragments SVG ------------------------------------------------

  function handleSVG() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">'
      + '<circle cx="4" cy="3.5" r="1.2"></circle><circle cx="10" cy="3.5" r="1.2"></circle>'
      + '<circle cx="4" cy="7" r="1.2"></circle><circle cx="10" cy="7" r="1.2"></circle>'
      + '<circle cx="4" cy="10.5" r="1.2"></circle><circle cx="10" cy="10.5" r="1.2"></circle></svg>';
  }
  function closeSVG() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">'
      + '<path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>';
  }
  function checkSVG() {
    return '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" focusable="false">'
      + '<path d="M2.5 7 L5 9.5 L10.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }

  // ==========================================================================
  //  mount
  // ==========================================================================

  function mount(host, options) {
    var el = resolveHost(host);
    if (!el) return null; // degrade silencieux

    var opts = options || {};
    var storageKey = typeof opts.storageKey === 'string' && opts.storageKey ? opts.storageKey : 'pab-default';
    var getAnalytics = typeof opts.getAnalytics === 'function' ? opts.getAnalytics : function () { return Promise.resolve(null); };
    var maxDate = isValidISO(opts.maxDate) ? opts.maxDate : todayISO();
    var defaults = sanitizeWidgets(opts.defaultWidgets);
    if (!defaults.length) defaults = [{ id: null, metric: 'revenue', viz: 'line' }];

    var idSeq = 0;
    function nextId() { idSeq += 1; return 'w' + idSeq + '-' + Math.random().toString(36).slice(2, 7); }
    function withIds(list) {
      return list.map(function (w) { return { id: w.id || nextId(), metric: w.metric, viz: w.viz }; });
    }

    // ---- Chargement config ----
    var stored = readStore();
    var widgets;
    var range;
    if (stored && Array.isArray(stored.widgets) && sanitizeWidgets(stored.widgets).length) {
      widgets = withIds(sanitizeWidgets(stored.widgets));
      range = normalizeRange(stored.range, maxDate);
    } else {
      widgets = withIds(defaults.slice());
      range = defaultRange(maxDate);
    }

    var editing = false;
    var destroyed = false;
    var currentAnalytics = null;
    var reqToken = 0;
    var renderCount = 0;
    var lastFetchStart = null;
    var lastFetchEnd = null;
    var gesture = null; // { mode:'press'|'armed'|'drag', ... }
    var picker = null; // element popover d'ajout, ou null

    function readStore() {
      try {
        var raw = window.localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    function writeStore() {
      try {
        var payload = {
          widgets: widgets.map(function (w) { return { id: w.id, metric: w.metric, viz: w.viz }; }),
          range: range,
        };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch (e) { /* storage indispo : degrade silencieux */ }
    }

    function widgetById(id) {
      for (var i = 0; i < widgets.length; i += 1) if (widgets[i].id === id) return widgets[i];
      return null;
    }

    // ---- Structure statique ----
    el.innerHTML = ''
      + '<div class="pab" data-editing="false" data-dragging="false" data-render="0">'
      + '  <div class="pab-toolbar">'
      + '    <div class="pab-range"></div>'
      + '    <button type="button" class="pab-customize" aria-pressed="false">Personnaliser</button>'
      + '  </div>'
      + '  <div class="pab-grid"></div>'
      + '</div>';

    var root = el.querySelector('.pab');
    var rangeHost = el.querySelector('.pab-range');
    var customizeBtn = el.querySelector('.pab-customize');
    var grid = el.querySelector('.pab-grid');

    // ---- Selecteur de plage libre ----
    var dr = (window.PinlaneDateRange && typeof window.PinlaneDateRange.mount === 'function')
      ? window.PinlaneDateRange.mount(rangeHost, { value: range, maxDate: maxDate, onChange: onRangeChange })
      : null;

    function onRangeChange(next) {
      if (destroyed) return;
      var prevStart = range.start;
      var prevEnd = range.end;
      range = next;
      writeStore();
      // Seule une plage differente justifie un nouvel appel getAnalytics ;
      // un changement de granularite / comparaison ne refetch pas.
      if (next.start !== prevStart || next.end !== prevEnd) fetchAndRender();
    }

    // ---- Edition ----
    function setEditing(on) {
      editing = Boolean(on);
      root.setAttribute('data-editing', editing ? 'true' : 'false');
      customizeBtn.textContent = editing ? 'Termine' : 'Personnaliser';
      customizeBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
      if (!editing) closePicker();
    }
    customizeBtn.addEventListener('click', function () { setEditing(!editing); });

    // ---- Construction de la grille ----
    function buildGrid() {
      closePicker();
      grid.innerHTML = '';
      widgets.forEach(function (w) { grid.appendChild(createCard(w)); });
      grid.appendChild(createAddTile());
      applyData();
    }

    function createCard(w) {
      var meta = CATALOG[w.metric];
      var card = document.createElement('section');
      card.className = 'pab-widget';
      card.setAttribute('data-id', w.id);
      card.setAttribute('data-metric', w.metric);
      card.setAttribute('data-viz', w.viz);
      card.innerHTML = ''
        + '<div class="pab-widget-head">'
        + '  <span class="pab-handle" aria-hidden="true">' + handleSVG() + '</span>'
        + '  <span class="pab-widget-title">' + esc(meta.label) + '</span>'
        + '</div>'
        + '<button type="button" class="pab-remove" aria-label="Supprimer ' + esc(meta.label) + '">' + closeSVG() + '</button>'
        + '<div class="pab-widget-body"></div>';
      card.addEventListener('pointerdown', function (ev) { onCardPointerDown(ev, card, w); });
      var rm = card.querySelector('.pab-remove');
      rm.addEventListener('click', function (ev) { ev.stopPropagation(); removeWidget(w.id); });
      return card;
    }

    function createAddTile() {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pab-add-tile';
      btn.setAttribute('aria-label', 'Ajouter un widget');
      btn.innerHTML = '<span class="pab-add-plus" aria-hidden="true">+</span><span class="pab-add-label">Ajouter</span>';
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); togglePicker(btn); });
      return btn;
    }

    // ---- Choix d'ajout (metrique + forme) ----
    function togglePicker(anchorBtn) {
      if (picker) { closePicker(); return; }
      openPicker(anchorBtn);
    }
    function closePicker() {
      if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
      picker = null;
    }
    function openPicker(anchorBtn) {
      var selMetric = PICKER_GROUPS[0].metrics[0];
      var selViz = CATALOG[selMetric].viz[0];

      picker = document.createElement('div');
      picker.className = 'pab-picker';
      picker.setAttribute('role', 'dialog');
      picker.setAttribute('aria-label', 'Ajouter un widget');
      if (reducedMotion()) picker.setAttribute('data-reduced', 'true');

      var metricsHtml = PICKER_GROUPS.map(function (g) {
        var btns = g.metrics.map(function (m) {
          return '<button type="button" class="pab-pick-metric" data-pick-metric="' + m + '" aria-pressed="'
            + (m === selMetric ? 'true' : 'false') + '"><span class="pab-pick-metric-label">'
            + esc(CATALOG[m].label) + '</span><span class="pab-pick-check" aria-hidden="true">' + checkSVG() + '</span></button>';
        }).join('');
        return '<div class="pab-picker-group"><div class="pab-picker-group-title">' + esc(g.title)
          + '</div><div class="pab-picker-group-hint">' + esc(g.hint) + '</div>' + btns + '</div>';
      }).join('');

      picker.innerHTML = ''
        + '<div class="pab-picker-head"><span class="pab-picker-head-title">Ajouter un widget</span>'
        + '<span class="pab-picker-head-sub">Choisis une donnee, puis sa forme</span></div>'
        + '<div class="pab-picker-body">'
        + '  <div class="pab-picker-col pab-picker-metrics">' + metricsHtml + '</div>'
        + '  <div class="pab-picker-col pab-picker-forms">'
        + '    <div class="pab-picker-label">Forme</div>'
        + '    <div class="pab-picker-viz"></div>'
        + '    <button type="button" class="pab-picker-add">Ajouter</button>'
        + '  </div>'
        + '</div>';

      root.appendChild(picker);
      positionPicker(anchorBtn);

      var vizWrap = picker.querySelector('.pab-picker-viz');
      function renderViz() {
        vizWrap.innerHTML = CATALOG[selMetric].viz.map(function (v) {
          return '<button type="button" class="pab-pick-viz" data-pick-viz="' + v + '" aria-pressed="'
            + (v === selViz ? 'true' : 'false') + '">' + vizIcon(v)
            + '<span class="pab-viz-name">' + esc(VIZ_LABEL[v]) + '</span></button>';
        }).join('');
      }
      renderViz();

      picker.addEventListener('click', function (ev) {
        var mBtn = ev.target.closest ? ev.target.closest('[data-pick-metric]') : null;
        if (mBtn) {
          selMetric = mBtn.getAttribute('data-pick-metric');
          if (CATALOG[selMetric].viz.indexOf(selViz) === -1) selViz = CATALOG[selMetric].viz[0];
          Array.prototype.forEach.call(picker.querySelectorAll('.pab-pick-metric'), function (b) {
            b.setAttribute('aria-pressed', b === mBtn ? 'true' : 'false');
          });
          renderViz();
          return;
        }
        var vBtn = ev.target.closest ? ev.target.closest('[data-pick-viz]') : null;
        if (vBtn) {
          selViz = vBtn.getAttribute('data-pick-viz');
          Array.prototype.forEach.call(picker.querySelectorAll('.pab-pick-viz'), function (b) {
            b.setAttribute('aria-pressed', b === vBtn ? 'true' : 'false');
          });
          return;
        }
        if (ev.target.closest && ev.target.closest('.pab-picker-add')) {
          addWidget(selMetric, selViz);
        }
      });
    }
    function positionPicker(anchorBtn) {
      if (!picker) return;
      var rootRect = root.getBoundingClientRect();
      var aRect = (anchorBtn || grid).getBoundingClientRect();
      var top = aRect.top - rootRect.top;
      var left = aRect.left - rootRect.left;
      // Ramene dans les bords du board : jamais de debordement horizontal.
      var maxLeft = Math.max(0, root.clientWidth - picker.offsetWidth - 4);
      if (left > maxLeft) left = maxLeft;
      if (left < 0) left = 0;
      picker.style.top = Math.round(top) + 'px';
      picker.style.left = Math.round(left) + 'px';
    }

    function addWidget(metric, viz) {
      if (!CATALOG[metric] || CATALOG[metric].viz.indexOf(viz) === -1) return;
      widgets.push({ id: nextId(), metric: metric, viz: viz });
      writeStore();
      buildGrid();
    }
    function removeWidget(id) {
      widgets = widgets.filter(function (w) { return w.id !== id; });
      writeStore();
      buildGrid();
    }

    // ---- Rendu des donnees dans les widgets ----
    function motionKey(w) {
      return 'pab:' + storageKey + ':' + w.id + ':' + w.metric + ':' + w.viz + ':' + range.start + ':' + range.end;
    }

    function seriesData(metric) {
      var meta = CATALOG[metric];
      var daily = currentAnalytics && Array.isArray(currentAnalytics.daily) ? currentAnalytics.daily : [];
      return daily.map(function (d) {
        return { date: d && d.date, value: Number(d && d[meta.field]) || 0 };
      });
    }
    function splitData(metric) {
      if (metric === 'byType') {
        var obj = currentAnalytics && currentAnalytics.byType && typeof currentAnalytics.byType === 'object' ? currentAnalytics.byType : {};
        return Object.keys(obj).map(function (k) { var row = obj[k] || {}; return { label: k, value: Number(row.count) || 0 }; });
      }
      var arr = currentAnalytics && Array.isArray(currentAnalytics.byChannel) ? currentAnalytics.byChannel : [];
      return arr.map(function (r) { return { label: r && r.channel, value: Number(r && r.count) || 0 }; });
    }
    function statValue(metric) {
      if (metric === 'occupancy') {
        var o = currentAnalytics && currentAnalytics.occupancy;
        return Number(o && o.rate) || 0;
      }
      var t = currentAnalytics && currentAnalytics.totals ? currentAnalytics.totals : {};
      return Number(t[metric]) || 0;
    }

    function renderWidget(bodyEl, w) {
      if (!bodyEl) return;
      var meta = CATALOG[w.metric];
      var key = motionKey(w);
      var charts = window.PinlaneCharts;
      if (meta.kind === 'series') {
        var s = seriesData(w.metric);
        if (!charts) { bodyEl.innerHTML = ''; return; }
        if (w.viz === 'bars') charts.barChart(bodyEl, { series: s, format: meta.format, motionKey: key, height: CHART_H });
        else charts.lineChart(bodyEl, { series: s, format: meta.format, motionKey: key, height: CHART_H });
        return;
      }
      if (meta.kind === 'split') {
        var parts = splitData(w.metric);
        if (!charts) { bodyEl.innerHTML = ''; return; }
        if (w.viz === 'bars') charts.barChart(bodyEl, { series: parts, format: meta.format, motionKey: key, height: CHART_H });
        else charts.donutChart(bodyEl, { parts: parts, format: meta.format, motionKey: key });
        return;
      }
      // stat -> grande tuile chiffree
      renderTile(bodyEl, w, meta, key);
    }

    function renderTile(bodyEl, w, meta, key) {
      var value = statValue(w.metric);
      bodyEl.innerHTML = '<div class="pab-tile"><span class="pab-tile-value" data-role="v"></span>'
        + '<span class="pab-tile-caption">sur la periode</span></div>';
      var vEl = bodyEl.querySelector('[data-role="v"]');
      var charts = window.PinlaneCharts;
      if (SEEN_TILES.has(key) || !charts || typeof charts.countUp !== 'function') {
        vEl.textContent = fmtStat(value, meta.format);
      } else {
        SEEN_TILES.add(key);
        charts.countUp(vEl, value, { format: meta.format });
      }
    }

    function applyData() {
      var cards = grid.querySelectorAll('.pab-widget');
      Array.prototype.forEach.call(cards, function (card) {
        var w = widgetById(card.getAttribute('data-id'));
        if (w) renderWidget(card.querySelector('.pab-widget-body'), w);
      });
      renderCount += 1;
      root.setAttribute('data-render', String(renderCount));
    }

    // getAnalytics est asynchrone : un jeton par requete ignore les reponses
    // perimees si la plage rechange avant la resolution.
    function fetchAndRender() {
      var token = ++reqToken;
      var start = range.start;
      var end = range.end;
      lastFetchStart = start;
      lastFetchEnd = end;
      var p;
      try { p = getAnalytics(start, end); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (data) {
        if (destroyed || token !== reqToken) return;
        currentAnalytics = data;
        applyData();
      }, function () {
        if (destroyed || token !== reqToken) return;
        currentAnalytics = null;
        applyData();
      });
    }

    // ---- Geste pointeur : appui long (entree edition) + glisser (reordre) ----
    function onCardPointerDown(ev, card, w) {
      if (ev.button != null && ev.button !== 0) return; // gauche uniquement
      if (ev.target && ev.target.closest && ev.target.closest('.pab-remove')) return;
      if (!editing) {
        var t = window.setTimeout(function () {
          if (gesture && gesture.mode === 'press') { gesture = null; setEditing(true); }
        }, LONG_PRESS_MS);
        gesture = { mode: 'press', x0: ev.clientX, y0: ev.clientY, timer: t };
        return;
      }
      gesture = { mode: 'armed', card: card, widget: w, x0: ev.clientX, y0: ev.clientY };
    }

    function onDocPointerMove(ev) {
      if (!gesture) return;
      var dx = ev.clientX - gesture.x0;
      var dy = ev.clientY - gesture.y0;
      if (gesture.mode === 'press') {
        if (dx * dx + dy * dy > PRESS_MOVE_SQ) { window.clearTimeout(gesture.timer); gesture = null; }
        return;
      }
      if (gesture.mode === 'armed') {
        if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) startDrag(ev);
        return;
      }
      if (gesture.mode === 'drag') { ev.preventDefault(); updateDrag(ev); }
    }

    function onDocPointerUp() {
      if (!gesture) return;
      if (gesture.mode === 'press') { window.clearTimeout(gesture.timer); gesture = null; return; }
      if (gesture.mode === 'armed') { gesture = null; return; }
      if (gesture.mode === 'drag') { endDrag(); gesture = null; }
    }

    function startDrag(ev) {
      var card = gesture.card;
      var rect = card.getBoundingClientRect();
      var ph = document.createElement('div');
      ph.className = 'pab-placeholder';
      ph.style.width = rect.width + 'px';
      ph.style.height = rect.height + 'px';
      grid.insertBefore(ph, card);
      gesture.mode = 'drag';
      gesture.placeholder = ph;
      gesture.offX = gesture.x0 - rect.left;
      gesture.offY = gesture.y0 - rect.top;
      card.classList.add('pab-dragging');
      card.style.width = rect.width + 'px';
      card.style.height = rect.height + 'px';
      root.setAttribute('data-dragging', 'true'); // fige le jiggle : rects stables
      positionDrag(ev.clientX, ev.clientY);
    }

    function positionDrag(cx, cy) {
      var card = gesture.card;
      card.style.left = (cx - gesture.offX) + 'px';
      card.style.top = (cy - gesture.offY) + 'px';
    }

    function updateDrag(ev) {
      positionDrag(ev.clientX, ev.clientY);
      var sibs = grid.querySelectorAll('.pab-widget:not(.pab-dragging)');
      var best = null;
      var bestD = Infinity;
      var after = false;
      Array.prototype.forEach.call(sibs, function (sib) {
        var r = sib.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var d = (ev.clientX - cx) * (ev.clientX - cx) + (ev.clientY - cy) * (ev.clientY - cy);
        if (d < bestD) {
          bestD = d;
          best = sib;
          after = (ev.clientY > cy) || (Math.abs(ev.clientY - cy) < 1 && ev.clientX > cx);
        }
      });
      if (best) {
        var ref = after ? best.nextSibling : best;
        if (ref !== gesture.placeholder) grid.insertBefore(gesture.placeholder, ref);
      }
    }

    function endDrag() {
      var card = gesture.card;
      var ph = gesture.placeholder;
      if (ph && ph.parentNode) {
        grid.insertBefore(card, ph); // repose la carte a l'index du placeholder
        ph.parentNode.removeChild(ph);
      }
      card.classList.remove('pab-dragging');
      card.style.left = '';
      card.style.top = '';
      card.style.width = '';
      card.style.height = '';
      root.setAttribute('data-dragging', 'false');
      // Nouvel ordre lu depuis le DOM (le placeholder faisait foi de l'index).
      var order = [];
      Array.prototype.forEach.call(grid.querySelectorAll('.pab-widget'), function (c) {
        var w = widgetById(c.getAttribute('data-id'));
        if (w) order.push(w);
      });
      widgets = order;
      writeStore();
      buildGrid();
    }

    document.addEventListener('pointermove', onDocPointerMove, true);
    document.addEventListener('pointerup', onDocPointerUp, true);
    document.addEventListener('pointercancel', onDocPointerUp, true);

    // ---- Demarrage ----
    writeStore(); // persiste l'etat initial (defauts) : reload deterministe
    buildGrid();
    fetchAndRender();

    // ---- Handle ----
    return {
      refresh: function () { if (!destroyed) fetchAndRender(); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener('pointermove', onDocPointerMove, true);
        document.removeEventListener('pointerup', onDocPointerUp, true);
        document.removeEventListener('pointercancel', onDocPointerUp, true);
        if (gesture && gesture.timer) window.clearTimeout(gesture.timer);
        gesture = null;
        if (dr && typeof dr.destroy === 'function') dr.destroy();
        el.innerHTML = '';
      },
    };
  }

  window.PinlaneAnalyticsBoard = { mount: mount };
})();
