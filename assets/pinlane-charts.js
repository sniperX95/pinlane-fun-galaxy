/* ==========================================================================
   window.PinlaneCharts : moteur de graphiques anime de la console staff.
   Vanilla, zero dependance, zero build. Consomme par assets/admin-console.js
   (panneau Tendances Direction + onglet Donnees) et assets/founder-cockpit.js
   (cout mensuel IA). Style : assets/pinlane-charts.css (classes plc-).

   Contrat :
   - lineChart(host, { series: [{date|label, value}], format, motionKey,
     height? }) : SVG responsive (viewBox, width 100%) ligne + aire, axe Y
     3-4 graduations tabulaires, labels X espaces (max ~6), dernier point
     marque d'un dot + valeur. Dessin stroke-dashoffset ~600ms.
   - barChart(host, { series, format, motionKey, height? }) : barres
     verticales, croissance scaleY depuis le bas, stagger total <= 300ms.
   - donutChart(host, { parts: [{label, value, tone?}], format, motionKey }) :
     anneau + legende (label, valeur, part %). tone 'success'|'warning'|
     'danger' optionnel, defaut nuances du texte via opacite.
   - heatmapChart(host, { matrix, rowLabels, colLabels, motionKey }) : grille
     d'intensite (opacite de la couleur texte), tooltip title natif.
   - countUp(el, value, { format }) : valeur animee <= 500ms, tabular-nums.
   Tous : host = element OU id ; serie vide -> message calme ; host absent ->
   retour silencieux ; AUCUNE couleur en dur (variables theme + currentColor).

   Motion : transform / opacity / stroke-dashoffset uniquement, ease-out
   (les durees et courbes vivent dans le CSS). Garde de premiere apparition :
   window.PINLANE_CHARTS_SEEN (Set de motionKey). Les pages staff se
   re-rendent par innerHTML : un motionKey deja vu pose l'etat final sans
   rejouer le dessin. prefers-reduced-motion : etat final immediat.
   L'animation part d'une classe posee en double requestAnimationFrame pour
   garantir que l'etat initial est peint avant la transition.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var SEEN = window.PINLANE_CHARTS_SEEN instanceof Set ? window.PINLANE_CHARTS_SEEN : new Set();
  window.PINLANE_CHARTS_SEEN = SEEN;

  var EMPTY_TEXT = 'Pas encore de donnees sur la periode.';
  var VB_W = 560;
  var PAD = { l: 48, r: 16, t: 20, b: 28 };
  var TONES = { success: 'plc-tone-success', warning: 'plc-tone-warning', danger: 'plc-tone-danger' };
  var FADE = [1, 0.66, 0.44, 0.3, 0.2, 0.14];

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function resolveHost(host) {
    if (!host) return null;
    if (typeof host === 'string') return document.getElementById(host);
    return host.nodeType === 1 ? host : null;
  }

  // Garde de premiere apparition. Sous reduced-motion la cle est quand meme
  // marquee vue : si la preference change en cours de session, on ne rejoue
  // pas un dessin deja montre.
  function wasSeen(key) {
    return Boolean(key) && SEEN.has(key);
  }

  function markSeen(key) {
    if (key) SEEN.add(key);
  }

  function shouldAnimate(motionKey) {
    var seen = wasSeen(motionKey);
    markSeen(motionKey);
    if (seen) return false;
    if (reducedMotion()) return false;
    return true;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  var INT_FMT = null;
  function groupInt(v) {
    if (!INT_FMT) {
      try { INT_FMT = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }); } catch (e) { INT_FMT = { format: String }; }
    }
    return INT_FMT.format(v);
  }

  function formatValue(value, format) {
    var v = Number(value);
    if (!Number.isFinite(v)) v = 0;
    v = Math.round(v);
    if (format === 'euro') return groupInt(v) + ' €';
    if (format === 'percent') return String(v) + '%';
    return groupInt(v);
  }

  // Version compacte pour les graduations et les valeurs au-dessus des barres.
  function formatTick(value, format) {
    var v = Math.round(Number(value) || 0);
    if (Math.abs(v) >= 1000) {
      var k = v / 1000;
      var txt = Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
      return format === 'euro' ? txt + 'k €' : txt + 'k';
    }
    return formatValue(v, format);
  }

  function pointLabel(row) {
    if (row.label != null && String(row.label) !== '') return String(row.label);
    var raw = String(row.date || '');
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (!m) return raw;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    try {
      return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' });
    } catch (e) { return m[3] + '/' + m[2]; }
  }

  // Valeurs negatives ramenees a 0 : la console ne trace que des volumes.
  function normalizeSeries(series) {
    if (!Array.isArray(series)) return [];
    return series
      .filter(function (row) { return row != null && typeof row === 'object'; })
      .map(function (row) {
        var v = Number(row.value);
        return { label: pointLabel(row), value: Number.isFinite(v) && v > 0 ? v : 0 };
      });
  }

  function clampHeight(h, fallback) {
    var v = Number(h);
    return Number.isFinite(v) && v >= 120 && v <= 420 ? Math.round(v) : fallback;
  }

  // 3-4 graduations rondes qui contiennent le max (pas de courbe qui creve
  // le plafond, pas d'axe menteur).
  function buildScale(maxValue, format) {
    if (!(maxValue > 0)) return { top: 1, ticks: [0] };
    if (format === 'percent' && maxValue <= 100) return { top: 100, ticks: [0, 50, 100] };
    // Vise ~15% de marge au-dessus du pic (rough = max/2.6) : le sommet de la
    // courbe respire sans coller au plafond, et sans laisser trop de vide.
    var rough = maxValue / 2.6;
    var pow = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var base = rough / pow;
    // Paliers entiers uniquement : jamais de graduation a virgule sur des
    // donnees entieres (0/2/3/5 illisible) -> pas de 1.5 ni 2.5.
    var stops = [1, 2, 3, 4, 5, 6, 8, 10];
    var mult = stops[stops.length - 1];
    for (var si = 0; si < stops.length; si += 1) { if (base <= stops[si]) { mult = stops[si]; break; } }
    var step = mult * pow;
    return { top: step * 3, ticks: [0, step, step * 2, step * 3] };
  }

  function renderEmpty(el) {
    el.innerHTML = '<div class="plc-empty">' + EMPTY_TEXT + '</div>';
  }

  function mountChart(el, extraClass, innerHtml, animate) {
    el.innerHTML = '<div class="plc-chart ' + extraClass + ' ' + (animate ? 'plc-anim' : 'plc-done') + '">' + innerHtml + '</div>';
    var wrap = el.firstElementChild;
    if (animate && wrap) {
      // Double rAF : l'etat initial est peint, PUIS la classe declenche la
      // transition. Si la page a ete re-rendue entre-temps, on ne fait rien.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          if (wrap && wrap.isConnected) wrap.classList.add('plc-in');
        });
      });
    }
    return wrap;
  }

  function chartFrame(inner, height, ariaLabel) {
    return '<svg class="plc-svg" viewBox="0 0 ' + VB_W + ' ' + height + '" role="img" aria-label="' + esc(ariaLabel) + '" focusable="false">' + inner + '</svg>';
  }

  function gridMarkup(scale, format, height) {
    var innerH = height - PAD.t - PAD.b;
    var out = [];
    scale.ticks.forEach(function (t) {
      var y = round2(PAD.t + innerH * (1 - t / scale.top));
      var cls = t === 0 ? 'plc-baseline' : 'plc-grid';
      out.push('<line class="' + cls + '" x1="' + PAD.l + '" x2="' + (VB_W - PAD.r) + '" y1="' + y + '" y2="' + y + '"></line>');
      out.push('<text class="plc-ytick" x="' + (PAD.l - 8) + '" y="' + round2(y + 3.5) + '" text-anchor="end">' + esc(formatTick(t, format)) + '</text>');
    });
    return out.join('');
  }

  // Labels X espaces : jamais plus de ~6, sinon ils se marchent dessus.
  function xLabelsMarkup(points, height) {
    var n = points.length;
    var step = Math.max(1, Math.ceil(n / 6));
    var y = height - 10;
    var out = [];
    points.forEach(function (p, i) {
      if (i % step !== 0 || !p.label) return;
      var anchor = p.x > VB_W - 80 ? 'end' : (p.x < 80 ? 'start' : 'middle');
      out.push('<text class="plc-xtick" x="' + round2(p.x) + '" y="' + y + '" text-anchor="' + anchor + '">' + esc(p.label) + '</text>');
    });
    return out.join('');
  }

  function linePathD(pts) {
    return pts.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + round2(p.x) + ' ' + round2(p.y);
    }).join(' ');
  }

  // Courbe lissee monotone (tangentes de Fritsch-Carlson) : rendu pro, sans
  // les segments brises "en dents de scie", et SANS depassement (la courbe ne
  // sort jamais de l'intervalle de ses voisins -> pas d'artefact sous la
  // baseline ni au-dessus du plafond, donc pas de bug graphique). Retombe sur
  // linePathD sous 3 points (ou l'interpolation cubique n'apporte rien).
  function smoothPathD(pts) {
    var n = pts.length;
    if (n < 3) return linePathD(pts);
    var dx = [], slope = [];
    for (var i = 0; i < n - 1; i += 1) {
      var h = pts[i + 1].x - pts[i].x;
      dx.push(h);
      slope.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
    }
    var m = new Array(n);
    m[0] = slope[0];
    m[n - 1] = slope[n - 2];
    for (var j = 1; j < n - 1; j += 1) {
      if (slope[j - 1] * slope[j] <= 0) { m[j] = 0; }
      else { m[j] = (slope[j - 1] + slope[j]) / 2; }
    }
    // Clamp de monotonie : borne les tangentes pour interdire tout depassement.
    for (var k = 0; k < n - 1; k += 1) {
      if (slope[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
      var a = m[k] / slope[k];
      var b = m[k + 1] / slope[k];
      var s = a * a + b * b;
      if (s > 9) {
        var tau = 3 / Math.sqrt(s);
        m[k] = tau * a * slope[k];
        m[k + 1] = tau * b * slope[k];
      }
    }
    var d = 'M' + round2(pts[0].x) + ' ' + round2(pts[0].y);
    for (var t = 0; t < n - 1; t += 1) {
      var h3 = dx[t] / 3;
      var c1x = pts[t].x + h3;
      var c1y = pts[t].y + m[t] * h3;
      var c2x = pts[t + 1].x - h3;
      var c2y = pts[t + 1].y - m[t + 1] * h3;
      d += ' C' + round2(c1x) + ' ' + round2(c1y) + ' ' + round2(c2x) + ' ' + round2(c2y)
        + ' ' + round2(pts[t + 1].x) + ' ' + round2(pts[t + 1].y);
    }
    return d;
  }

  // ---- Survol : infobulle + mise en avant ---------------------------------
  // Une infobulle HTML par graphe, enfant de .plc-chart (position:relative en
  // CSS). Les positions des points sont pre-calculees au montage ; le mousemove
  // ne fait que lire (nearest par x pour la ligne, index de l'element pour barre
  // et donut). Apparition/disparition en opacite <= 120ms (CSS), immediate sous
  // prefers-reduced-motion. Listeners poses une fois par montage de graphe.

  function makeTip(wrap) {
    var tip = document.createElement('div');
    tip.className = 'plc-tip';
    tip.setAttribute('aria-hidden', 'true');
    wrap.appendChild(tip);
    return tip;
  }

  function tipHtml(label, value) {
    return '<span class="plc-tip-label">' + esc(label) + '</span><span class="plc-tip-value">' + esc(value) + '</span>';
  }

  // px, py : point d'ancrage en pixels relatifs au conteneur. L'infobulle est
  // centree au-dessus du point puis ramenee dans les bords : aucun debordement.
  function showTip(wrap, tip, html, px, py) {
    tip.innerHTML = html;
    tip.setAttribute('aria-hidden', 'false');
    var pad = 6;
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var ww = wrap.clientWidth;
    var wh = wrap.clientHeight;
    var left = px - w / 2;
    var top = py - h - 12;
    if (top < pad) top = py + 16;
    if (left < pad) left = pad;
    if (left + w > ww - pad) left = ww - pad - w;
    if (left < pad) left = pad;
    if (top + h > wh - pad) top = wh - pad - h;
    if (top < pad) top = pad;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    wrap.classList.add('plc-hovering');
  }

  function hideTip(wrap, tip) {
    wrap.classList.remove('plc-hovering');
    tip.setAttribute('aria-hidden', 'true');
  }

  // Ligne : crosshair vertical + dot agrandi cales sur le point le plus proche
  // en x ; l'infobulle affiche le label X + la valeur formatee.
  function wireLine(wrap, pts, height) {
    if (!wrap) return;
    var svg = wrap.querySelector('.plc-svg');
    var cross = wrap.querySelector('.plc-crosshair');
    var hdot = wrap.querySelector('.plc-dot-hover');
    if (!svg || !cross || !hdot || !pts.length) return;
    var tip = makeTip(wrap);
    var onMove = function (ev) {
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0) || !(srect.height > 0)) return;
      var sx = (ev.clientX - srect.left) / srect.width * VB_W;
      var idx = 0;
      var best = Infinity;
      for (var i = 0; i < pts.length; i += 1) {
        var dx = Math.abs(pts[i].x - sx);
        if (dx < best) { best = dx; idx = i; }
      }
      var p = pts[idx];
      cross.setAttribute('x1', round2(p.x));
      cross.setAttribute('x2', round2(p.x));
      hdot.setAttribute('cx', round2(p.x));
      hdot.setAttribute('cy', round2(p.y));
      var wrect = wrap.getBoundingClientRect();
      var px = (p.x / VB_W) * srect.width + (srect.left - wrect.left);
      var py = (p.y / height) * srect.height + (srect.top - wrect.top);
      showTip(wrap, tip, tipHtml(p.label, p.vtext), px, py);
    };
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', function () { hideTip(wrap, tip); });
  }

  // Barres et donut : l'element survole porte data-i ; l'info (label + valeur
  // [+ part] pour le donut) est pre-calculee. L'infobulle suit le pointeur. La
  // mise en avant visuelle (barre contrastee, autres segments attenues) vit en
  // CSS :hover.
  function wireSegments(wrap, selector, info) {
    if (!wrap) return;
    var tip = makeTip(wrap);
    var onMove = function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(selector) : null;
      if (!el) { hideTip(wrap, tip); return; }
      var idx = Number(el.getAttribute('data-i'));
      var d = info[idx];
      if (!d) { hideTip(wrap, tip); return; }
      var wrect = wrap.getBoundingClientRect();
      showTip(wrap, tip, tipHtml(d.label, d.value), ev.clientX - wrect.left, ev.clientY - wrect.top);
    };
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', function () { hideTip(wrap, tip); });
  }

  function lineChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var series = normalizeSeries(o.series);
    if (!series.length) { renderEmpty(el); return; }
    var format = o.format || 'int';
    var height = clampHeight(o.height, 200);
    var animate = shouldAnimate(o.motionKey);
    var max = 0;
    series.forEach(function (p) { if (p.value > max) max = p.value; });
    var scale = buildScale(max, format);
    var innerW = VB_W - PAD.l - PAD.r;
    var innerH = height - PAD.t - PAD.b;
    var n = series.length;
    var pts = series.map(function (p, i) {
      return {
        x: n === 1 ? PAD.l + innerW / 2 : PAD.l + (innerW * i) / (n - 1),
        y: PAD.t + innerH * (1 - p.value / scale.top),
        value: p.value,
        label: p.label,
      };
    });
    var d = smoothPathD(pts);
    var baseY = round2(PAD.t + innerH);
    var last = pts[n - 1];
    var area = d + ' L' + round2(last.x) + ' ' + baseY + ' L' + round2(pts[0].x) + ' ' + baseY + ' Z';
    var parts = [gridMarkup(scale, format, height), xLabelsMarkup(pts, height)];
    parts.push('<path class="plc-line-area" d="' + area + '"></path>');
    parts.push('<path class="plc-line-path" d="' + d + '" pathLength="1000"' + (animate ? ' style="stroke-dasharray:1000;stroke-dashoffset:1000"' : '') + '></path>');
    parts.push('<circle class="plc-line-dot" cx="' + round2(last.x) + '" cy="' + round2(last.y) + '" r="3.5"></circle>');
    var vAnchor = last.x < PAD.l + 60 ? 'start' : 'end';
    var vx = vAnchor === 'end' ? last.x - 8 : last.x + 8;
    var vy = last.y - 8 < 14 ? last.y + 18 : last.y - 8;
    parts.push('<text class="plc-line-value" x="' + round2(vx) + '" y="' + round2(vy) + '" text-anchor="' + vAnchor + '">' + esc(formatValue(last.value, format)) + '</text>');
    parts.push('<g class="plc-line-hover" aria-hidden="true"><line class="plc-crosshair" x1="0" x2="0" y1="' + round2(PAD.t) + '" y2="' + baseY + '"></line><circle class="plc-dot-hover" cx="0" cy="0" r="4.5"></circle></g>');
    pts.forEach(function (p) { p.vtext = formatValue(p.value, format); });
    var wrap = mountChart(el, 'plc-line-wrap', chartFrame(parts.join(''), height, 'Evolution sur la periode'), animate);
    wireLine(wrap, pts, height);
  }

  function barChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var series = normalizeSeries(o.series);
    if (!series.length) { renderEmpty(el); return; }
    var format = o.format || 'int';
    var height = clampHeight(o.height, 200);
    var animate = shouldAnimate(o.motionKey);
    var max = 0;
    series.forEach(function (p) { if (p.value > max) max = p.value; });
    var scale = buildScale(max, format);
    var innerW = VB_W - PAD.l - PAD.r;
    var innerH = height - PAD.t - PAD.b;
    var baseY = PAD.t + innerH;
    var n = series.length;
    var slot = innerW / n;
    var barW = Math.max(3, Math.min(slot * 0.62, 64));
    // Stagger total <= 300ms : 220ms de croissance + au plus 80ms de decalage.
    var stepDelay = n > 1 ? 80 / (n - 1) : 0;
    var bars = [];
    var valueTexts = [];
    var centers = [];
    series.forEach(function (p, i) {
      var h = innerH * (p.value / scale.top);
      var x = PAD.l + slot * i + (slot - barW) / 2;
      var y = baseY - h;
      centers.push({ x: x + barW / 2, label: p.label });
      bars.push('<rect class="plc-bar" data-i="' + i + '" x="' + round2(x) + '" y="' + round2(y) + '" width="' + round2(barW) + '" height="' + round2(h) + '" rx="2" style="--plc-d:' + Math.round(stepDelay * i) + 'ms"><title>' + esc((p.label ? p.label + ' : ' : '') + formatValue(p.value, format)) + '</title></rect>');
      if (n <= 8) {
        valueTexts.push('<text class="plc-bar-value" x="' + round2(x + barW / 2) + '" y="' + round2(Math.max(12, y - 6)) + '" text-anchor="middle">' + esc(formatTick(p.value, format)) + '</text>');
      }
    });
    var parts = [gridMarkup(scale, format, height), xLabelsMarkup(centers, height), bars.join(''), valueTexts.join('')];
    var barInfo = series.map(function (p) { return { label: p.label, value: formatValue(p.value, format) }; });
    var wrap = mountChart(el, 'plc-bar-wrap', chartFrame(parts.join(''), height, 'Volumes sur la periode'), animate);
    wireSegments(wrap, '.plc-bar', barInfo);
  }

  function polar(cx, cy, r, deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, r, startDeg, sweepDeg) {
    var sweep = Math.min(359.98, Math.max(0.02, sweepDeg));
    var a = polar(cx, cy, r, startDeg);
    var b = polar(cx, cy, r, startDeg + sweep);
    var large = sweep > 180 ? 1 : 0;
    return 'M' + round2(a.x) + ' ' + round2(a.y) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + round2(b.x) + ' ' + round2(b.y);
  }

  function donutChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var format = o.format || 'int';
    var parts = (Array.isArray(o.parts) ? o.parts : [])
      .filter(function (p) { return p != null && typeof p === 'object'; })
      .map(function (p) {
        var v = Number(p.value);
        return {
          label: String(p.label == null ? '' : p.label),
          value: Number.isFinite(v) && v > 0 ? v : 0,
          tone: p.tone,
        };
      })
      .filter(function (p) { return p.value > 0; });
    var total = parts.reduce(function (sum, p) { return sum + p.value; }, 0);
    if (!parts.length || !(total > 0)) { renderEmpty(el); return; }
    var animate = shouldAnimate(o.motionKey);
    var liDelay = parts.length > 1 ? 100 / (parts.length - 1) : 0;
    var angle = 0;
    var segs = [];
    var items = [];
    var donutInfo = [];
    parts.forEach(function (p, i) {
      var frac = p.value / total;
      var sweep = frac * 360;
      var toneClass = TONES[p.tone] || '';
      var alpha = toneClass ? 1 : FADE[Math.min(i, FADE.length - 1)];
      segs.push('<path class="plc-donut-seg' + (toneClass ? ' ' + toneClass : '') + '" data-i="' + i + '" d="' + arcPath(60, 60, 45, angle, sweep) + '" pathLength="100" stroke-opacity="' + alpha + '"' + (animate ? ' style="stroke-dasharray:100;stroke-dashoffset:100"' : '') + '><title>' + esc(p.label + ' : ' + formatValue(p.value, format)) + '</title></path>');
      items.push('<li style="--plc-d:' + Math.round(liDelay * i) + 'ms"><span class="plc-swatch' + (toneClass ? ' ' + toneClass : '') + '"' + (toneClass ? '' : ' style="opacity:' + alpha + '"') + '></span><span class="plc-legend-label">' + esc(p.label) + '</span><span class="plc-legend-share">' + esc(formatValue(p.value, format)) + ' · ' + Math.round(frac * 100) + '%</span></li>');
      donutInfo.push({ label: p.label, value: formatValue(p.value, format) + ' · ' + Math.round(frac * 100) + '%' });
      angle += sweep;
    });
    var svg = '<svg class="plc-donut" viewBox="0 0 120 120" role="img" aria-label="Repartition" focusable="false"><circle class="plc-donut-track" cx="60" cy="60" r="45"></circle>' + segs.join('') + '</svg>';
    var wrap = mountChart(el, 'plc-donut-wrap', svg + '<ul class="plc-legend">' + items.join('') + '</ul>', animate);
    wireSegments(wrap, '.plc-donut-seg', donutInfo);
  }

  function heatmapChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var matrix = (Array.isArray(o.matrix) ? o.matrix : []).filter(function (row) { return Array.isArray(row); });
    var rows = matrix.length;
    var cols = 0;
    var max = 0;
    matrix.forEach(function (row) {
      if (row.length > cols) cols = row.length;
      row.forEach(function (v) {
        var num = Number(v);
        if (Number.isFinite(num) && num > max) max = num;
      });
    });
    if (!rows || !cols || !(max > 0)) { renderEmpty(el); return; }
    var rowLabels = Array.isArray(o.rowLabels) ? o.rowLabels : [];
    var colLabels = Array.isArray(o.colLabels) ? o.colLabels : [];
    var animate = shouldAnimate(o.motionKey);
    var colStep = cols > 12 ? Math.ceil(cols / 12) : 1;
    var out = ['<div class="plc-heat-corner"></div>'];
    for (var c = 0; c < cols; c += 1) {
      var cl = c % colStep === 0 ? String(colLabels[c] == null ? '' : colLabels[c]) : '';
      out.push('<div class="plc-heat-col">' + esc(cl) + '</div>');
    }
    var rowDelayStep = rows > 1 ? 60 / (rows - 1) : 0;
    matrix.forEach(function (row, r) {
      out.push('<div class="plc-heat-row">' + esc(String(rowLabels[r] == null ? '' : rowLabels[r])) + '</div>');
      var delay = Math.round(rowDelayStep * r);
      for (var i = 0; i < cols; i += 1) {
        var num = Number(row[i]);
        var v = Number.isFinite(num) && num > 0 ? num : 0;
        var target = v > 0 ? round2(0.12 + 0.88 * (v / max)) : 0;
        var prefix = ((rowLabels[r] == null ? '' : rowLabels[r] + ' ') + (colLabels[i] == null ? '' : colLabels[i])).trim();
        var title = prefix ? prefix + ' : ' + v : String(v);
        out.push('<div class="plc-heat-cell" title="' + esc(title) + '"><span class="plc-heat-fill" style="--plc-o:' + target + ';--plc-d:' + delay + 'ms"></span></div>');
      }
    });
    var grid = '<div class="plc-heat-grid" style="grid-template-columns:auto repeat(' + cols + ', minmax(0, 1fr))">' + out.join('') + '</div>';
    mountChart(el, 'plc-heatmap', grid, animate);
  }

  function countUp(el, value, opts) {
    var node = resolveHost(el);
    if (!node) return;
    var o = opts || {};
    var format = o.format || 'int';
    var target = Number(value);
    if (!Number.isFinite(target)) target = 0;
    node.classList.add('plc-countup');
    if (node._plcRaf) { window.cancelAnimationFrame(node._plcRaf); node._plcRaf = 0; }
    if (reducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      node.textContent = formatValue(target, format);
      return;
    }
    var DURATION = 450;
    var start = 0;
    node.textContent = formatValue(0, format);
    var tick = function (ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / DURATION);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = formatValue(target * eased, format);
      node._plcRaf = t < 1 ? window.requestAnimationFrame(tick) : 0;
    };
    node._plcRaf = window.requestAnimationFrame(tick);
  }

  window.PinlaneCharts = {
    lineChart: lineChart,
    barChart: barChart,
    donutChart: donutChart,
    heatmapChart: heatmapChart,
    countUp: countUp,
  };
})();
