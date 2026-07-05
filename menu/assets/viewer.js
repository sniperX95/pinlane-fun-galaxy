/* ===========================================================================
   Fun Galaxy — carte digitale
   Vanilla JS : ciel étoilé, transition galactique, visionneuse zoom/pan.
   Aucune dépendance, aucune requête externe.
   =========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ *
   *  1. Ciel étoilé — dessiné une seule fois sur un canvas (net en DPR) *
   * ------------------------------------------------------------------ */
  function initStars(canvas) {
    var ctx = canvas.getContext("2d");
    var w = 0, h = 0, dpr = 1, raf = 0;

    function draw() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // densité douce, proportionnelle à la surface — étoiles fines et discrètes
      var count = Math.min(220, Math.round((w * h) / 5200));
      // teintes rares : blanc dominant, quelques touches teal/violet très pâles
      var tints = [
        "255,255,255", "255,255,255", "255,255,255",
        "205,232,226", "214,196,224"
      ];
      for (var i = 0; i < count; i++) {
        var x = Math.random() * w;
        var y = Math.random() * h;
        var r = Math.random() * 0.9 + 0.25;          // 0.25 → 1.15 px
        var a = Math.random() * 0.5 + 0.12;          // 0.12 → 0.62 alpha
        var tint = tints[(Math.random() * tints.length) | 0];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + tint + "," + a.toFixed(3) + ")";
        ctx.fill();
        // halo à peine perceptible sur les plus grosses étoiles
        if (r > 0.95) {
          ctx.beginPath();
          ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(" + tint + "," + (a * 0.12).toFixed(3) + ")";
          ctx.fill();
        }
      }
    }

    function onResize() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }

    draw();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   *  2. Visionneuse : zoom (pinch / molette / double-tap) + pan        *
   * ------------------------------------------------------------------ */
  function ZoomPan(stage, slide, img) {
    var MIN = 1, MAX = 4;
    var scale = 1, tx = 0, ty = 0;
    var pointers = new Map();
    var pinchStart = null;          // { dist, cx, cy, scale, tx, ty }
    var panStart = null;            // { x, y, tx, ty }
    var moved = false;
    var self = this;

    this.onSwipe = null;            // callback(direction) quand scale === 1
    this.onZoomChange = null;       // callback(isZoomed)

    function apply() {
      slide.style.transform =
        "translate3d(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px,0) scale(" + scale.toFixed(4) + ")";
    }

    // Bornes de translation : garde l'image visible sans dérive excessive
    function clamp() {
      var rect = stage.getBoundingClientRect();
      // image affichée (avant scale) approximée par la taille du slide
      var iw = img.clientWidth * scale;
      var ih = img.clientHeight * scale;
      // slide occupe toute la scène ; on limite le décalage au débordement
      var maxX = Math.max(0, (iw - rect.width) / 2) + rect.width * 0.12;
      var maxY = Math.max(0, (ih - rect.height) / 2) + rect.height * 0.12;
      tx = Math.max(-maxX, Math.min(maxX, tx));
      ty = Math.max(-maxY, Math.min(maxY, ty));
    }

    function setScale(next, cx, cy) {
      next = Math.max(MIN, Math.min(MAX, next));
      var rect = stage.getBoundingClientRect();
      // point focal relatif au centre de la scène
      var ox = (cx - rect.left) - rect.width / 2;
      var oy = (cy - rect.top) - rect.height / 2;
      var ratio = next / scale;
      // ajuste la translation pour zoomer vers le doigt/curseur
      tx = ox - (ox - tx) * ratio;
      ty = oy - (oy - ty) * ratio;
      scale = next;
      if (scale <= MIN + 0.001) { scale = MIN; tx = 0; ty = 0; }
      clamp();
      apply();
      notifyZoom();
    }

    var wasZoomed = false;
    function notifyZoom() {
      var z = scale > MIN + 0.001;
      if (z !== wasZoomed) {
        wasZoomed = z;
        if (self.onZoomChange) self.onZoomChange(z);
      }
    }

    this.reset = function (animate) {
      scale = MIN; tx = 0; ty = 0;
      if (animate !== false) {
        slide.style.transition = "transform 360ms cubic-bezier(.22,.61,.36,1)";
        apply();
        window.setTimeout(function () { slide.style.transition = ""; }, 380);
      } else {
        apply();
      }
      notifyZoom();
    };

    this.isZoomed = function () { return scale > MIN + 0.001; };

    function dist(a, b) {
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.hypot(dx, dy);
    }
    function midpoint(a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    stage.addEventListener("pointerdown", function (e) {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      slide.style.transition = "";

      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinchStart = {
          dist: dist(pts[0], pts[1]),
          mid: midpoint(pts[0], pts[1]),
          scale: scale, tx: tx, ty: ty
        };
        panStart = null;
      } else if (pointers.size === 1) {
        panStart = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
        stage.classList.add("is-grabbing");
      }
    });

    stage.addEventListener("pointermove", function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2 && pinchStart) {
        var pts = Array.from(pointers.values());
        var d = dist(pts[0], pts[1]);
        var mid = midpoint(pts[0], pts[1]);
        var next = pinchStart.scale * (d / pinchStart.dist);
        // applique le zoom en gardant le point médian stable
        scale = Math.max(MIN, Math.min(MAX, next));
        var rect = stage.getBoundingClientRect();
        var ox = mid.x - rect.left - rect.width / 2;
        var oy = mid.y - rect.top - rect.height / 2;
        var ratio = scale / pinchStart.scale;
        tx = ox - (ox - pinchStart.tx) * ratio;
        ty = oy - (oy - pinchStart.ty) * ratio;
        if (scale <= MIN + 0.001) { scale = MIN; tx = 0; ty = 0; }
        clamp();
        apply();
        notifyZoom();
        moved = true;
      } else if (pointers.size === 1 && panStart) {
        var dx = e.clientX - panStart.x;
        var dy = e.clientY - panStart.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (scale > MIN + 0.001) {
          tx = panStart.tx + dx;
          ty = panStart.ty + dy;
          clamp();
          apply();
        }
        // si scale === 1, on ne pan pas : le geste sera peut-être un swipe (au up)
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      var start = panStart;
      var upX = e.clientX;
      pointers.delete(e.pointerId);
      stage.classList.remove("is-grabbing");

      if (pointers.size < 2) pinchStart = null;

      if (pointers.size === 0) {
        // swipe horizontal recto/verso uniquement si non zoomé
        if (start && scale <= MIN + 0.001) {
          var dx = upX - start.x;
          if (Math.abs(dx) > 55 && self.onSwipe) {
            self.onSwipe(dx < 0 ? "next" : "prev");
          }
        }
        panStart = null;
      } else if (pointers.size === 1) {
        // repasse en mode pan avec le pointeur restant
        var rem = Array.from(pointers.entries())[0];
        panStart = { x: rem[1].x, y: rem[1].y, tx: tx, ty: ty };
      }
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);

    // Molette (desktop) : zoom centré sur le curseur
    stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      var factor = Math.exp(-e.deltaY * 0.0015);
      setScale(scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Double-tap / double-clic : bascule zoom
    var lastTap = 0, lastX = 0, lastY = 0;
    stage.addEventListener("pointerup", function (e) {
      if (e.pointerType === "mouse") return; // géré par dblclick
      var now = Date.now();
      if (now - lastTap < 300 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) {
        toggleZoom(e.clientX, e.clientY);
        lastTap = 0;
      } else {
        lastTap = now; lastX = e.clientX; lastY = e.clientY;
      }
    });
    stage.addEventListener("dblclick", function (e) {
      e.preventDefault();
      toggleZoom(e.clientX, e.clientY);
    });

    function toggleZoom(cx, cy) {
      slide.style.transition = "transform 340ms cubic-bezier(.22,.61,.36,1)";
      if (scale > MIN + 0.001) {
        self.reset(false);
      } else {
        setScale(2.4, cx, cy);
      }
      window.setTimeout(function () { slide.style.transition = ""; }, 360);
    }

    window.addEventListener("resize", function () { clamp(); apply(); }, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   *  3. Orchestration de la page centre (entrée → transition → carte)  *
   * ------------------------------------------------------------------ */
  function initViewer() {
    var openBtn = document.getElementById("openCard");
    var backBtn = document.getElementById("backBtn");
    var viewer = document.getElementById("viewer");
    var stage = document.getElementById("stage");
    var slide = document.getElementById("slide");
    var img = document.getElementById("carteImg");
    var faces = document.getElementById("faces");
    var faceBtns = faces ? faces.querySelectorAll(".faces__btn") : [];
    var resetBtn = document.getElementById("resetBtn");
    var hint = document.getElementById("hint");
    if (!openBtn || !viewer || !stage || !img) return;

    var sources = [img.getAttribute("data-recto"), img.getAttribute("data-verso")];
    var current = 0;
    var engine = new ZoomPan(stage, slide, img);

    engine.onZoomChange = function (zoomed) {
      if (resetBtn) resetBtn.classList.toggle("is-visible", zoomed);
      if (hint && zoomed) hint.classList.remove("is-visible");
    };
    engine.onSwipe = function (dir) {
      setFace(dir === "next" ? 1 : 0);
    };

    function setFace(index) {
      index = index ? 1 : 0;
      if (index === current) return;
      current = index;
      faces.setAttribute("data-face", String(index));
      for (var i = 0; i < faceBtns.length; i++) {
        faceBtns[i].setAttribute("aria-selected", i === index ? "true" : "false");
      }
      // crossfade + swap source
      img.classList.add("is-swapping");
      engine.reset(false);
      window.setTimeout(function () {
        img.src = sources[index];
        img.alt = index === 0 ? "Carte Fun Galaxy — recto" : "Carte Fun Galaxy — verso";
      }, 200);
      img.addEventListener("load", function onLoad() {
        img.classList.remove("is-swapping");
        img.removeEventListener("load", onLoad);
      });
      // filet de sécurité si l'image est déjà en cache
      window.setTimeout(function () { img.classList.remove("is-swapping"); }, 420);
    }

    for (var i = 0; i < faceBtns.length; i++) {
      (function (idx) {
        faceBtns[idx].addEventListener("click", function () { setFace(idx); });
      })(i);
    }
    if (resetBtn) resetBtn.addEventListener("click", function () { engine.reset(true); });

    // Entrée → transition galactique → carte
    var opened = false;
    function openCard() {
      if (opened) return;
      opened = true;
      // précharge le recto immédiatement
      if (!img.src) img.src = sources[0];

      document.body.classList.add("is-leaving");
      var delay = reduceMotion ? 260 : 780;
      window.setTimeout(function () {
        var entry = document.querySelector(".entry");
        if (entry) entry.setAttribute("hidden", "");
        viewer.removeAttribute("hidden");
        // force reflow puis fade-in
        void viewer.offsetWidth;
        viewer.classList.add("is-open");
        document.body.classList.remove("is-leaving");
        // indice double-tap, discret et éphémère
        if (hint && !reduceMotion) {
          window.setTimeout(function () { hint.classList.add("is-visible"); }, 500);
          window.setTimeout(function () { hint.classList.remove("is-visible"); }, 4200);
        }
      }, delay);
    }
    openBtn.addEventListener("click", openCard);

    function goBack() {
      if (!opened) return;
      viewer.classList.remove("is-open");
      document.body.classList.add("is-returning");
      engine.reset(false);
      var entry = document.querySelector(".entry");
      window.setTimeout(function () {
        viewer.setAttribute("hidden", "");
        if (entry) entry.removeAttribute("hidden");
        document.body.classList.remove("is-returning");
        opened = false;
      }, reduceMotion ? 200 : 520);
    }
    if (backBtn) backBtn.addEventListener("click", goBack);
  }

  /* ------------------------------------------------------------------ *
   *  4. Boot                                                           *
   * ------------------------------------------------------------------ */
  function boot() {
    var canvas = document.querySelector("canvas.stars");
    if (canvas) initStars(canvas);
    initViewer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
