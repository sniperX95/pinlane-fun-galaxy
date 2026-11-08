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

  var EMPTY_TEXT = 'Pas encore de données sur la période.';
  // Serie presente mais entierement nulle : ce n'est pas un manque de donnees,
  // c'est une absence de valeur. Une ligne plate a zero sur sept mois occupe
  // 200 px et laisse croire a une panne du graphe.
  var FLAT_TEXT = 'Aucune valeur sur cette période.';
  // Largeur de repli quand l'hote n'est pas encore mesurable (hors flux, onglet
  // masque). Le rendu normal utilise la largeur REELLE : voir hostWidth.
  var VB_W = 560;
  // Plancher bas expres : une sparkline vit dans une tuile de ~180 px. A 320,
  // son viewBox etait plus large que la tuile et le SVG se re-echelonnait vers
  // le BAS (40 px demandes, 22 px rendus). 140 = la largeur sous laquelle un
  // graphe avec axes (48 px de marge gauche) n'a plus de place utile.
  var VB_MIN = 140;
  var VB_MAX = 1600;
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

  // MEME MONNAIE, MEME ECRITURE. formatMoney (app-main.js) pose une espace
  // fine insecable U+202F avant l'euro ; la bibliotheque posait une espace
  // ordinaire U+0020. Les deux ecrivent le MEME montant sur le MEME ecran (la
  // tuile KPI par countUp, le total serveur par formatMoney) : « 7 350 € »
  // contre « 7 350 € », identiques a l'oeil, differents en octets. Le
  // caractere est invisible : il s'ecrit en echappement, jamais en litteral.
  var NBSP_FINE = ' ';

  function formatValue(value, format) {
    var v = Number(value);
    if (!Number.isFinite(v)) v = 0;
    // Un panier par joueur se lit au centime, une taille de groupe a la decimale.
    if (format === 'euro2') return v.toFixed(2).replace('.', ',') + NBSP_FINE + '€';
    if (format === 'dec1') return v.toFixed(1).replace('.', ',');
    v = Math.round(v);
    if (format === 'euro') return groupInt(v) + NBSP_FINE + '€';
    if (format === 'percent') return String(v) + '%';
    return groupInt(v);
  }

  // Version compacte pour les graduations et les valeurs au-dessus des barres.
  function formatTick(value, format) {
    if (format === 'euro2') format = 'euro';
    if (format === 'dec1') format = 'int';
    var v = Math.round(Number(value) || 0);
    if (Math.abs(v) >= 1000) {
      var k = v / 1000;
      var txt = Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
      return format === 'euro' ? txt + 'k' + NBSP_FINE + '€' : txt + 'k';
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

  // Une sparkline vit dans une tuile : sa hauteur se compte en dizaines de px,
  // pas en centaines. Marges quasi nulles, sinon la courbe n'a plus de place.
  var SPARK_PAD = { l: 2, r: 2, t: 6, b: 6 };
  function clampSparkHeight(h, fallback) {
    var v = Number(h);
    return Number.isFinite(v) && v >= 24 && v <= 120 ? Math.round(v) : fallback;
  }

  // 3-4 graduations rondes qui contiennent le max (pas de courbe qui creve
  // le plafond, pas d'axe menteur).
  function buildScale(maxValue, format) {
    if (!(maxValue > 0)) return { top: 1, ticks: [0] };
    if (format === 'percent' && maxValue <= 100) return { top: 100, ticks: [0, 50, 100] };
    // LE PLUS PETIT PAS ROND QUI LOGE LE PIC, avec ~8 % d air, en trois
    // graduations. L ancienne regle arrondissait max/2,6 au palier superieur :
    // un pic de 27 donnait un pas de 20 et un plafond a 60, plus de la moitie
    // du graphique vide (arrivees par heure de l accueil, 2026-09-30).
    var need = maxValue * 1.08 / 3;
    var pow = Math.pow(10, Math.floor(Math.log(need) / Math.LN10));
    // 1,5 et 2,5 seulement quand le pas reste entier (pow >= 10) : jamais de
    // graduation a virgule sur des donnees entieres.
    var stops = pow >= 10 ? [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : [1, 2, 3, 4, 5, 6, 8, 10];
    var mult = stops[stops.length - 1];
    for (var si = 0; si < stops.length; si += 1) { if (stops[si] * pow >= need) { mult = stops[si]; break; } }
    // Le palier n'etait entier que tant que `pow` valait au moins 1 : sous un
    // max de 3, `pow` tombe a 0,1 et le pas avec lui. Max = 2 donnait un pas de
    // 0,8, donc des graduations 0 / 0,8 / 1,6 / 2,4 que formatTick arrondit a
    // « 0 », « 1 », « 2 », « 2 » : deux reperes a deux hauteurs pour une seule
    // valeur, un axe faux a la lecture. Or les libelles sont TOUJOURS rendus
    // entiers : un pas inferieur a 1 produit forcement un doublon. Le plancher
    // de 1 est donc une consequence du format d'affichage, pas un choix.
    var step = Math.max(1, mult * pow);
    return { top: step * 3, ticks: [0, step, step * 2, step * 3] };
  }

  function renderEmpty(el, text) {
    el.innerHTML = '<div class="plc-empty">' + esc(text || EMPTY_TEXT) + '</div>';
  }

  function hasValue(series) {
    return series.some(function (p) { return p.value > 0; });
  }

  // ── Echelle 1:1 ───────────────────────────────────────────────────────────
  // Le SVG etait dessine dans un viewBox de largeur FIXE (560) puis etire a la
  // largeur du conteneur par `width: 100%`. Un SVG s'agrandit en entier : sur
  // une carte de 1100 px, tout etait multiplie par ~2 - le TEXTE des axes
  // (11 px devenus 22 px) et la HAUTEUR (200 px devenus ~400 px). D'ou des
  // graphes geants au texte disproportionne sur la page Direction.
  // On dessine desormais a la taille reelle : le viewBox vaut la largeur
  // mesuree, donc l'echelle est 1 et les tailles de la CSS sont respectees.
  function hostWidth(el) {
    var w = 0;
    try { w = Math.round((el && el.clientWidth) || 0); } catch (e) { w = 0; }
    if (!w) return VB_W;
    return Math.max(VB_MIN, Math.min(VB_MAX, w));
  }

  // Re-rendu au redimensionnement : sans lui, elargir la fenetre re-etirerait le
  // dessin (retour du defaut qu'on vient de corriger). Hysteresis de 24 px pour
  // ne pas redessiner a chaque pixel, et largeur memorisee AVANT le rendu pour
  // qu'un redessin ne puisse pas se re-declencher lui-meme.
  var resizeObserver = null;
  function keepScaled(el, render) {
    if (!el) return;
    el.__plcRender = render;
    el.__plcWidth = hostWidth(el);
    if (typeof ResizeObserver === 'undefined') return;
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var target = entry.target;
          if (!target || typeof target.__plcRender !== 'function') return;
          // La PREMIERE notification arrive juste apres observe() : elle ne
          // signale aucun changement. La rejouer re-rendrait le graphe (donc
          // remplacerait le DOM et ses ecouteurs de survol) pour rien.
          if (target.__plcFirstResize) { target.__plcFirstResize = false; return; }
          var width = Math.round(entry.contentRect ? entry.contentRect.width : 0);
          if (!width || Math.abs(width - (target.__plcWidth || 0)) < 24) return;
          target.__plcWidth = width;
          target.__plcRender();
        });
      });
    }
    if (!el.__plcObserved) {
      el.__plcObserved = true;
      el.__plcFirstResize = true;
      resizeObserver.observe(el);
    }
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

  function chartFrame(inner, height, ariaLabel, vbW) {
    return '<svg class="plc-svg" viewBox="0 0 ' + (vbW || VB_W) + ' ' + height + '" role="img" aria-label="' + esc(ariaLabel) + '" focusable="false">' + inner + '</svg>';
  }

  function gridMarkup(scale, format, height, vbW) {
    var innerH = height - PAD.t - PAD.b;
    var out = [];
    scale.ticks.forEach(function (t) {
      var y = round2(PAD.t + innerH * (1 - t / scale.top));
      var cls = t === 0 ? 'plc-baseline' : 'plc-grid';
      out.push('<line class="' + cls + '" x1="' + PAD.l + '" x2="' + ((vbW || VB_W) - PAD.r) + '" y1="' + y + '" y2="' + y + '"></line>');
      out.push('<text class="plc-ytick" x="' + (PAD.l - 8) + '" y="' + round2(y + 3.5) + '" text-anchor="end">' + esc(formatTick(t, format)) + '</text>');
    });
    return out.join('');
  }

  // Labels X espaces : jamais plus de ~6, sinon ils se marchent dessus.
  // Nombre de labels DEDUIT de la largeur reelle (~1 tous les 96 px) au lieu
  // d'un 6 fixe : dans une carte etroite, six dates se chevauchaient
  // ("01 ja04 fevr.").
  function xLabelsMarkup(points, height, vbW) {
    var n = points.length;
    var usable = (vbW || VB_W) - PAD.l - PAD.r;
    var maxLabels = Math.max(2, Math.min(6, Math.floor(usable / 96)));
    var step = Math.max(1, Math.ceil(n / maxLabels));
    var y = height - 10;
    var out = [];
    points.forEach(function (p, i) {
      if (i % step !== 0 || !p.label) return;
      var anchor = p.x > (vbW || VB_W) - 80 ? 'end' : (p.x < 80 ? 'start' : 'middle');
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
  function wireLine(wrap, pts, height, vbW) {
    if (!wrap) return;
    var svg = wrap.querySelector('.plc-svg');
    var cross = wrap.querySelector('.plc-crosshair');
    var hdot = wrap.querySelector('.plc-dot-hover');
    if (!svg || !cross || !hdot || !pts.length) return;
    var tip = makeTip(wrap);
    var onMove = function (ev) {
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0) || !(srect.height > 0)) return;
      var sx = (ev.clientX - srect.left) / srect.width * (vbW || VB_W);
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
      var px = (p.x / (vbW || VB_W)) * srect.width + (srect.left - wrect.left);
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
    // Mode sparkline : la courbe SEULE, dans une tuile de 40 px. Aucun axe,
    // aucun label, aucune valeur - une sparkline qui porte des graduations de
    // 11 px dans 40 px de haut ne se lit pas, elle salit la tuile.
    var spark = o.sparkline === true;
    var series = normalizeSeries(o.series);
    if (spark && !hasValue(series)) { el.innerHTML = ''; return; }
    if (!series.length) { renderEmpty(el); return; }
    if (!hasValue(series)) { renderEmpty(el, FLAT_TEXT); return; }
    var pad = spark ? SPARK_PAD : PAD;
    var format = o.format || 'int';
    var height = spark ? clampSparkHeight(o.height, 40) : clampHeight(o.height, 200);
    var animate = shouldAnimate(o.motionKey);
    var max = 0;
    series.forEach(function (p) { if (p.value > max) max = p.value; });
    var scale = buildScale(max, format);
    var vbW = hostWidth(el);
    var innerW = vbW - pad.l - pad.r;
    var innerH = height - pad.t - pad.b;
    var n = series.length;
    var pts = series.map(function (p, i) {
      return {
        x: n === 1 ? pad.l + innerW / 2 : pad.l + (innerW * i) / (n - 1),
        y: pad.t + innerH * (1 - p.value / scale.top),
        value: p.value,
        label: p.label,
      };
    });
    var d = smoothPathD(pts);
    var baseY = round2(pad.t + innerH);
    var last = pts[n - 1];
    var area = d + ' L' + round2(last.x) + ' ' + baseY + ' L' + round2(pts[0].x) + ' ' + baseY + ' Z';
    var parts = spark ? [] : [gridMarkup(scale, format, height, vbW), xLabelsMarkup(pts, height, vbW)];
    parts.push('<path class="plc-line-area" d="' + area + '"></path>');
    parts.push('<path class="plc-line-path" d="' + d + '" pathLength="1000"' + (animate ? ' style="stroke-dasharray:1000;stroke-dashoffset:1000"' : '') + '></path>');
    if (!spark) {
      parts.push('<circle class="plc-line-dot" cx="' + round2(last.x) + '" cy="' + round2(last.y) + '" r="3.5"></circle>');
      // AUCUNE valeur imprimee dans le graphe. Collee au dernier point, elle
      // tombait sur la courbe ; posee dans un coin, elle flottait sans rien a
      // quoi se rattacher. Un graphe porte une FORME : l'axe donne l'echelle,
      // le survol donne la valeur exacte, et le total vit dans l'en-tete de la
      // carte (tuiles KPI de la Direction, titre de la carte ailleurs). C'est
      // aussi ce que font les consoles de reference.
      parts.push('<g class="plc-line-hover" aria-hidden="true"><line class="plc-crosshair" x1="0" x2="0" y1="' + round2(pad.t) + '" y2="' + baseY + '"></line><circle class="plc-dot-hover" cx="0" cy="0" r="4.5"></circle></g>');
    }
    pts.forEach(function (p) { p.vtext = formatValue(p.value, format); });
    var wrap = mountChart(el, 'plc-line-wrap' + (spark ? ' plc-spark' : ''), chartFrame(parts.join(''), height, spark ? 'Tendance' : 'Evolution sur la periode', vbW), animate);
    if (!spark) wireLine(wrap, pts, height, vbW);
    keepScaled(el, function () { lineChart(host, opts); });
  }

  function barChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var series = normalizeSeries(o.series);
    if (!series.length) { renderEmpty(el); return; }
    if (!hasValue(series)) { renderEmpty(el, FLAT_TEXT); return; }
    var format = o.format || 'int';
    var height = clampHeight(o.height, 200);
    var animate = shouldAnimate(o.motionKey);
    var max = 0;
    series.forEach(function (p) { if (p.value > max) max = p.value; });
    var scale = buildScale(max, format);
    var vbW = hostWidth(el);
    var innerW = vbW - PAD.l - PAD.r;
    var innerH = height - PAD.t - PAD.b;
    var baseY = PAD.t + innerH;
    var n = series.length;
    var slot = innerW / n;
    var barW = Math.max(3, Math.min(slot * 0.62, 64));
    // Stagger total <= 300ms : 220ms de croissance + au plus 80ms de decalage.
    var stepDelay = n > 1 ? 80 / (n - 1) : 0;
    var past = typeof o.pastBefore === 'number' && o.pastBefore >= 0 ? Math.floor(o.pastBefore) : -1;
    var bars = [];
    var valueTexts = [];
    var centers = [];
    series.forEach(function (p, i) {
      var h = innerH * (p.value / scale.top);
      var x = PAD.l + slot * i + (slot - barW) / 2;
      var y = baseY - h;
      centers.push({ x: x + barW / 2, label: p.label });
      // pastBefore : les heures deja passees s effacent, l heure en cours se
      // detache (accueil, arrivees du jour). -1 ou absent : aucune marque.
      var when = past < 0 ? '' : i < past ? ' is-past' : i === past ? ' is-now' : '';
      bars.push('<rect class="plc-bar' + when + '" data-i="' + i + '" x="' + round2(x) + '" y="' + round2(y) + '" width="' + round2(barW) + '" height="' + round2(h) + '" rx="2" style="--plc-d:' + Math.round(stepDelay * i) + 'ms"><title>' + esc((p.label ? p.label + ' : ' : '') + formatValue(p.value, format)) + '</title></rect>');
      // Un « 0 » imprime au-dessus d une barre absente se lit comme une donnee
      // de plus : la valeur ne s ecrit que sur une barre qui existe.
      if (n <= 8 && p.value > 0) {
        valueTexts.push('<text class="plc-bar-value" x="' + round2(x + barW / 2) + '" y="' + round2(Math.max(12, y - 6)) + '" text-anchor="middle">' + esc(formatTick(p.value, format)) + '</text>');
      }
    });
    var parts = [gridMarkup(scale, format, height, vbW), xLabelsMarkup(centers, height, vbW), bars.join(''), valueTexts.join('')];
    var barInfo = series.map(function (p) { return { label: p.label, value: formatValue(p.value, format) }; });
    var wrap = mountChart(el, 'plc-bar-wrap', chartFrame(parts.join(''), height, 'Volumes sur la periode', vbW), animate);
    wireSegments(wrap, '.plc-bar', barInfo);
    keepScaled(el, function () { barChart(host, opts); });
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
    // tip : l infobulle du moteur au lieu du title natif ; valeur(v) ecrit le nombre.
    var infos = [];
    var valeur = typeof o.valeur === 'function' ? o.valeur : function (v) { return String(v); };
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
        // null : le creneau n existe pas (centre ferme) ; il ne se lit pas comme un creux.
        if (row[i] === null) { out.push('<div class="plc-heat-ferme"></div>'); continue; }
        var num = Number(row[i]);
        var v = Number.isFinite(num) && num > 0 ? num : 0;
        var target = v > 0 ? round2(0.12 + 0.88 * (v / max)) : 0;
        var prefix = typeof o.etiquette === 'function'
          ? o.etiquette(r, i)
          : ((rowLabels[r] == null ? '' : rowLabels[r] + ' ') + (colLabels[i] == null ? '' : colLabels[i])).trim();
        var title = prefix ? prefix + ' : ' + v : String(v);
        var attribut = ' title="' + esc(title) + '"';
        if (o.tip === true) { attribut = ' data-i="' + infos.length + '"'; infos.push({ label: prefix, value: valeur(v) }); }
        out.push('<div class="plc-heat-cell"' + attribut + '><span class="plc-heat-fill" style="--plc-o:' + target + ';--plc-d:' + delay + 'ms"></span></div>');
      }
    });
    var grid = '<div class="plc-heat-grid" style="grid-template-columns:auto repeat(' + cols + ', minmax(0, 1fr))">' + out.join('') + '</div>';
    var wrapHeat = mountChart(el, 'plc-heatmap', grid, animate);
    if (o.tip === true) wireSegments(wrapHeat, '.plc-heat-cell', infos);
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

  // ---- Courbe comparee (dashboard, 2026-11-08) --------------------------------
  // La periode en trait plein, la periode d avant en pointille, une seule echelle. Un jour
  // sans valeur (ratio sans denominateur : centre ferme) coupe la ligne, il ne vaut pas zero.
  // Le survol lit les deux periodes au meme rang ; le changement de statistique (meme nombre
  // de points) fait glisser la courbe au lieu de la redessiner.
  function normalizeTrend(series) {
    if (!Array.isArray(series)) return [];
    return series.filter(function (row) { return row != null && typeof row === 'object'; }).map(function (row) {
      var v = row.value == null ? NaN : Number(row.value);
      return { label: pointLabel(row), long: row.long ? String(row.long) : pointLabel(row), value: Number.isFinite(v) && v >= 0 ? v : null };
    });
  }

  // Les morceaux continus d une serie de points (un point sans valeur les separe).
  function trendSegments(pts) {
    var out = [];
    var cur = [];
    pts.forEach(function (p) {
      if (p.y == null) { if (cur.length) out.push(cur); cur = []; return; }
      cur.push(p);
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function trendLineD(pts) {
    return trendSegments(pts).map(function (seg) { return seg.length === 1 ? 'M' + round2(seg[0].x) + ' ' + round2(seg[0].y) + ' h0.01' : smoothPathD(seg); }).join(' ');
  }

  function trendAreaD(pts, baseY) {
    return trendSegments(pts).filter(function (seg) { return seg.length > 1; }).map(function (seg) {
      return smoothPathD(seg) + ' L' + round2(seg[seg.length - 1].x) + ' ' + baseY + ' L' + round2(seg[0].x) + ' ' + baseY + ' Z';
    }).join(' ');
  }

  function trendDelta(a, b, format) {
    if (a == null || b == null) return '';
    if (format === 'percent') {
      var pts = Math.round(a - b);
      return (pts > 0 ? '+' : '') + pts + ' pt' + (Math.abs(pts) > 1 ? 's' : '');
    }
    if (!(b > 0)) return '';
    var pct = Math.round(((a - b) / b) * 100);
    return (pct > 0 ? '+' : '') + pct + NBSP_FINE + '%';
  }

  function wireTrend(wrap, pts, comp, height, vbW, o) {
    if (!wrap) return;
    var svg = wrap.querySelector('.plc-svg');
    var cross = wrap.querySelector('.plc-crosshair');
    var dot = wrap.querySelector('.plc-trend-dot');
    var dotC = wrap.querySelector('.plc-trend-dot-compare');
    if (!svg || !cross || !dot) return;
    var tip = makeTip(wrap);
    tip.classList.add('plc-tip-trend');
    var format = o.format || 'int';
    var courant = -1;
    function poser(idx) {
      idx = Math.max(0, Math.min(pts.length - 1, idx));
      courant = idx;
      var p = pts[idx];
      var q = comp[idx] || null;
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0) || !(srect.height > 0)) return;
      cross.setAttribute('x1', round2(p.x));
      cross.setAttribute('x2', round2(p.x));
      dot.style.display = p.y == null ? 'none' : '';
      if (p.y != null) { dot.setAttribute('cx', round2(p.x)); dot.setAttribute('cy', round2(p.y)); }
      if (dotC) {
        dotC.style.display = q && q.y != null ? '' : 'none';
        if (q && q.y != null) { dotC.setAttribute('cx', round2(q.x)); dotC.setAttribute('cy', round2(q.y)); }
      }
      var html = '<span class="plc-tip-label">' + esc(p.long) + '</span>'
        + '<span class="plc-tip-row"><i class="plc-tip-key"></i><b class="plc-tip-value">' + esc(p.value == null ? 'rien ce jour-là' : formatValue(p.value, format)) + '</b></span>';
      if (q) {
        var delta = trendDelta(p.value, q.value, format);
        html += '<span class="plc-tip-row"><i class="plc-tip-key is-compare"></i><span class="plc-tip-compare">' + esc(q.long) + ', ' + esc(q.value == null ? 'rien ce jour-là' : formatValue(q.value, format)) + '</span>' + (delta ? '<em class="plc-tip-delta">' + esc(delta) + '</em>' : '') + '</span>';
      }
      var wrect = wrap.getBoundingClientRect();
      var px = (p.x / vbW) * srect.width + (srect.left - wrect.left);
      var ancre = p.y != null ? p.y : height / 2;
      var py = (ancre / height) * srect.height + (srect.top - wrect.top);
      showTip(wrap, tip, html, px, py);
    }
    function versRang(ev) {
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0)) return -1;
      var sx = (ev.clientX - srect.left) / srect.width * vbW;
      var rang = 0;
      var best = Infinity;
      for (var i = 0; i < pts.length; i += 1) {
        var dx = Math.abs(pts[i].x - sx);
        if (dx < best) { best = dx; rang = i; }
      }
      return rang;
    }
    wrap.addEventListener('pointermove', function (ev) { poser(versRang(ev)); });
    wrap.addEventListener('pointerdown', function (ev) { poser(versRang(ev)); });
    wrap.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hideTip(wrap, tip); });
    wrap.setAttribute('tabindex', '0');
    wrap.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      poser(courant < 0 ? pts.length - 1 : courant + (ev.key === 'ArrowRight' ? 1 : -1));
    });
    wrap.addEventListener('focus', function () { if (courant < 0) poser(pts.length - 1); });
    wrap.addEventListener('blur', function () { hideTip(wrap, tip); courant = -1; });
  }

  function trendChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var series = normalizeTrend(o.series);
    var compare = normalizeTrend(o.compare);
    var format = o.format || 'int';
    if (!series.length) { renderEmpty(el); el.__plcTrend = null; return; }
    if (!series.some(function (p) { return p.value > 0; })) { renderEmpty(el, FLAT_TEXT); el.__plcTrend = null; return; }
    var height = clampHeight(o.height, 260);
    var animate = shouldAnimate(o.motionKey);
    var max = 0;
    series.concat(compare).forEach(function (p) { if (p.value != null && p.value > max) max = p.value; });
    // Une echelle pour les deux periodes. Un taux garde son echelle a lui : 12 % sur un axe
    // de 0 a 100 serait une ligne plate au ras du sol.
    var scale = buildScale(max, format === 'percent' ? 'int' : format);
    var vbW = hostWidth(el);
    var innerW = vbW - PAD.l - PAD.r;
    var innerH = height - PAD.t - PAD.b;
    var baseY = round2(PAD.t + innerH);
    var n = series.length;
    // relier : un jour sans valeur (centre ferme, pour un taux) n est pas une mesure. La ligne
    // passe par-dessus au lieu de se casser ; le point, lui, dit qu il n y a rien.
    var trace = function (rows) { return o.relier === true ? rows.filter(function (p) { return p.y != null; }) : rows; };
    var placer = function (rows) {
      return rows.map(function (p, i) {
        return {
          x: n === 1 ? PAD.l + innerW / 2 : PAD.l + (innerW * i) / (n - 1),
          y: p.value == null ? null : PAD.t + innerH * (1 - p.value / scale.top),
          value: p.value,
          label: p.label,
          long: p.long,
        };
      });
    };
    var pts = placer(series);
    var comp = placer(compare.slice(0, n));
    // La derniere valeur connue porte le point de fin.
    var dernier = null;
    pts.forEach(function (p) { if (p.y != null) dernier = p; });
    var parts = [gridMarkup(scale, format, height, vbW), xLabelsMarkup(pts, height, vbW)];
    if (comp.length) parts.push('<path class="plc-trend-compare" d="' + trendLineD(trace(comp)) + '"></path>');
    parts.push('<path class="plc-trend-area" d="' + trendAreaD(trace(pts), baseY) + '"></path>');
    parts.push('<path class="plc-trend-line" d="' + trendLineD(trace(pts)) + '" pathLength="1000"' + (animate ? ' style="stroke-dasharray:1000;stroke-dashoffset:1000"' : '') + '></path>');
    if (dernier) parts.push('<circle class="plc-trend-end" cx="' + round2(dernier.x) + '" cy="' + round2(dernier.y) + '" r="4"></circle>');
    parts.push('<g class="plc-line-hover" aria-hidden="true"><line class="plc-crosshair" x1="0" x2="0" y1="' + round2(PAD.t) + '" y2="' + baseY + '"></line>'
      + (comp.length ? '<circle class="plc-trend-dot-compare" cx="0" cy="0" r="3.5"></circle>' : '')
      + '<circle class="plc-trend-dot" cx="0" cy="0" r="5"></circle></g>');
    var precedent = el.__plcTrend;
    var wrap = mountChart(el, 'plc-trend-wrap', chartFrame(parts.join(''), height, o.ariaLabel || 'Evolution sur la periode', vbW), animate);
    wireTrend(wrap, pts, comp, height, vbW, o);
    el.__plcTrend = { n: n, pts: pts.map(function (p) { return p.y; }), height: height, vbW: vbW };
    // Meme nombre de points, autre statistique : la courbe glisse vers sa nouvelle forme.
    if (!animate && precedent && precedent.n === n && precedent.vbW === vbW && precedent.height === height
      && !reducedMotion() && precedent.pts.some(function (y, i) { return y !== pts[i].y; })
      && precedent.pts.every(function (y, i) { return (y == null) === (pts[i].y == null); })) {
      var ligne = wrap.querySelector('.plc-trend-line');
      var aire = wrap.querySelector('.plc-trend-area');
      var fin = wrap.querySelector('.plc-trend-end');
      var depart = 0;
      var DUREE = 260;
      var pasDeTemps = function (ts) {
        if (!depart) depart = ts;
        var t = Math.min(1, (ts - depart) / DUREE);
        var e = 1 - Math.pow(1 - t, 3);
        var etape = pts.map(function (p, i) { return { x: p.x, y: p.y == null ? null : precedent.pts[i] + (p.y - precedent.pts[i]) * e }; });
        if (ligne && ligne.isConnected) {
          ligne.setAttribute('d', trendLineD(trace(etape)));
          if (aire) aire.setAttribute('d', trendAreaD(trace(etape), baseY));
          var bout = null;
          etape.forEach(function (p) { if (p.y != null) bout = p; });
          if (fin && bout) fin.setAttribute('cy', round2(bout.y));
          if (t < 1) window.requestAnimationFrame(pasDeTemps);
        }
      };
      window.requestAnimationFrame(pasDeTemps);
    }
    keepScaled(el, function () { trendChart(host, opts); });
  }

  // ---- Plusieurs courbes sur une echelle (assistant, 2026-11-08) ------------------
  // Trois series au plus : la palette validee n a que trois teintes. Le survol lit toutes les
  // series au meme rang, une valeur absente coupe la courbe sans valoir zero.
  function multiChart(host, opts) {
    var el = resolveHost(host);
    if (!el) return;
    var o = opts || {};
    var format = o.format || 'int';
    var labels = Array.isArray(o.labels) ? o.labels.map(String) : [];
    var series = (Array.isArray(o.series) ? o.series : []).slice(0, 3).map(function (s) {
      return { nom: String(s.nom), valeurs: labels.map(function (_, i) { var v = s.valeurs ? s.valeurs[i] : null; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); }) };
    });
    if (!labels.length || !series.length) { renderEmpty(el); return; }
    var max = 0;
    series.forEach(function (s) { s.valeurs.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (!(max > 0)) { renderEmpty(el, FLAT_TEXT); return; }
    var height = clampHeight(o.height, 240);
    var scale = buildScale(max, format === 'percent' ? 'int' : format);
    var vbW = hostWidth(el);
    var innerW = vbW - PAD.l - PAD.r;
    var innerH = height - PAD.t - PAD.b;
    var n = labels.length;
    var xDe = function (i) { return n === 1 ? PAD.l + innerW / 2 : PAD.l + (innerW * i) / (n - 1); };
    var traces = series.map(function (s) {
      return s.valeurs.map(function (v, i) { return { x: xDe(i), y: v == null ? null : PAD.t + innerH * (1 - v / scale.top), value: v }; });
    });
    var parts = [gridMarkup(scale, format, height, vbW), xLabelsMarkup(labels.map(function (label, i) { return { x: xDe(i), label: label }; }), height, vbW)];
    traces.forEach(function (pts, k) { parts.push('<path class="plc-multi-line ton-' + (k + 1) + '" d="' + trendLineD(pts) + '"></path>'); });
    parts.push('<g class="plc-line-hover" aria-hidden="true"><line class="plc-crosshair" x1="0" x2="0" y1="' + round2(PAD.t) + '" y2="' + round2(PAD.t + innerH) + '"></line>'
      + series.map(function (_, k) { return '<circle class="plc-multi-dot ton-' + (k + 1) + '" cx="0" cy="0" r="4"></circle>'; }).join('') + '</g>');
    var noms = series.map(function (s) { return s.nom; }).join(', ');
    var wrap = mountChart(el, 'plc-multi-wrap', chartFrame(parts.join(''), height, o.ariaLabel || ('Evolution de ' + noms), vbW), false);
    el.insertAdjacentHTML('afterbegin', '<div class="plc-multi-legende">' + series.map(function (s, k) { return '<span><i class="ton-' + (k + 1) + '"></i>' + esc(s.nom) + '</span>'; }).join('') + '</div>');
    if (wrap) cablerMulti(wrap, traces, series, labels, height, vbW, format);
    keepScaled(el, function () { multiChart(host, opts); });
  }

  function cablerMulti(wrap, traces, series, labels, height, vbW, format) {
    var svg = wrap.querySelector('.plc-svg');
    var cross = wrap.querySelector('.plc-crosshair');
    var points = wrap.querySelectorAll('.plc-multi-dot');
    if (!svg || !cross) return;
    var tip = makeTip(wrap);
    tip.classList.add('plc-tip-trend');
    var courant = -1;
    function poser(idx) {
      idx = Math.max(0, Math.min(labels.length - 1, idx));
      courant = idx;
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0) || !(srect.height > 0)) return;
      var x = traces[0][idx].x;
      cross.setAttribute('x1', round2(x));
      cross.setAttribute('x2', round2(x));
      var haut = height / 2;
      traces.forEach(function (pts, k) {
        var p = pts[idx];
        points[k].style.display = p.y == null ? 'none' : '';
        if (p.y != null) { points[k].setAttribute('cx', round2(p.x)); points[k].setAttribute('cy', round2(p.y)); haut = Math.min(haut, p.y); }
      });
      var html = '<span class="plc-tip-label">' + esc(labels[idx]) + '</span>' + series.map(function (s, k) {
        return '<span class="plc-tip-row"><i class="plc-tip-key plc-multi-cle ton-' + (k + 1) + '"></i><span class="plc-tip-compare">' + esc(s.nom) + '</span><b class="plc-tip-value">' + esc(s.valeurs[idx] == null ? 'rien' : formatValue(s.valeurs[idx], format)) + '</b></span>';
      }).join('');
      var wrect = wrap.getBoundingClientRect();
      showTip(wrap, tip, html, (x / vbW) * srect.width + (srect.left - wrect.left), (haut / height) * srect.height + (srect.top - wrect.top));
    }
    function versRang(ev) {
      var srect = svg.getBoundingClientRect();
      if (!(srect.width > 0)) return 0;
      var sx = (ev.clientX - srect.left) / srect.width * vbW;
      var rang = 0;
      var ecart = Infinity;
      traces[0].forEach(function (p, i) { var d = Math.abs(p.x - sx); if (d < ecart) { ecart = d; rang = i; } });
      return rang;
    }
    wrap.addEventListener('pointermove', function (ev) { poser(versRang(ev)); });
    wrap.addEventListener('pointerdown', function (ev) { poser(versRang(ev)); });
    wrap.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hideTip(wrap, tip); });
    wrap.setAttribute('tabindex', '0');
    wrap.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      poser(courant < 0 ? labels.length - 1 : courant + (ev.key === 'ArrowRight' ? 1 : -1));
    });
    wrap.addEventListener('focus', function () { if (courant < 0) poser(labels.length - 1); });
    wrap.addEventListener('blur', function () { hideTip(wrap, tip); courant = -1; });
  }

  window.PinlaneCharts = {
    lineChart: lineChart,
    trendChart: trendChart,
    multiChart: multiChart,
    barChart: barChart,
    donutChart: donutChart,
    heatmapChart: heatmapChart,
    countUp: countUp,
  };
})();
