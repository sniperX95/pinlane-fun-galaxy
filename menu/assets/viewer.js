/* Fun Galaxy — carte digitale premium.
   Canvas spatial vivant (étoiles parallaxe + filantes + nébuleuses), transition cinématique
   (reveal logo + star-warp + flash), bascule Recto/Verso en crossfade. Zoom NATIF. rAF unique. */
(function () {
  'use strict';

  var body = document.body;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function byId(id) { return document.getElementById(id); }
  var open = byId('openCard');
  var seg = byId('seg');
  var stage = byId('stage');
  var imgBase = byId('cardImg');
  var imgFx = byId('cardImgFx');
  var canvas = byId('space');
  var btns = seg ? seg.querySelectorAll('.seg__btn') : [];

  /* ============================================================
     1) MOTEUR DE FOND SPATIAL (canvas, rAF unique)
     ============================================================ */
  var Space = (function () {
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, diag = 1;
    var stars = [], nebulae = [], shooters = [];
    var running = false, rafId = 0, last = 0, nextShoot = 1200;
    var warp = 0, warpTarget = 0;      // 0 = calme, 1 = hyperespace
    var STAR_N = 150;

    function rand(a, b) { return a + Math.random() * (b - a); }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.44; diag = Math.sqrt(W * W + H * H);
      buildStars(); buildNebulae();
    }

    function buildStars() {
      stars = [];
      var n = W < 480 ? STAR_N : Math.round(STAR_N * 1.35);
      for (var i = 0; i < n; i++) {
        var z = rand(0.25, 1);                 // profondeur (parallaxe)
        stars.push({
          x: rand(0, W), y: rand(0, H), z: z,
          r: 0.5 + z * 1.5,
          a: rand(0.35, 1) * (0.5 + z * 0.5),
          vx: rand(-0.05, 0.05) * z,
          vy: (0.06 + z * 0.10),               // dérive douce vers le bas
          tw: rand(0, Math.PI * 2),
          tws: rand(0.008, 0.03)
        });
      }
    }

    function buildNebulae() {
      var R = Math.max(W, H);
      nebulae = [
        { x: W * 0.72, y: H * 0.28, r: R * 0.55, col: [148, 66, 146], ph: 0, drift: 0.0008, amp: 26, base: 0.16 },
        { x: W * 0.24, y: H * 0.70, r: R * 0.5, col: [103, 186, 172], ph: 2.2, drift: 0.0006, amp: 22, base: 0.13 }
      ];
    }

    function spawnShooter() {
      // départ hors écran en haut/gauche, trajectoire diagonale
      var fromLeft = Math.random() < 0.5;
      var sx = fromLeft ? rand(-0.1, 0.35) * W : rand(0.65, 1.1) * W;
      var sy = rand(-0.1, 0.25) * H;
      var ang = fromLeft ? rand(0.28, 0.5) : rand(Math.PI - 0.5, Math.PI - 0.28);
      var sp = rand(9, 14);
      shooters.push({
        x: sx, y: sy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        len: rand(120, 220), life: 0, max: rand(55, 80)
      });
    }

    function drawNebulae() {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < nebulae.length; i++) {
        var nb = nebulae[i];
        var ox = Math.sin(nb.ph) * nb.amp, oy = Math.cos(nb.ph * 0.8) * nb.amp;
        var pulse = 0.85 + 0.15 * Math.sin(nb.ph * 1.3);
        var g = ctx.createRadialGradient(nb.x + ox, nb.y + oy, 0, nb.x + ox, nb.y + oy, nb.r);
        var c = nb.col, a = nb.base * pulse;
        g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')');
        g.addColorStop(0.5, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a * 0.35) + ')');
        g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(t) {
      if (!running) return;
      var dt = last ? Math.min((t - last) / 16.67, 3) : 1;
      last = t;
      warp += (warpTarget - warp) * Math.min(0.07 * dt, 1);

      // fond dégradé (base opaque)
      var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, diag * 0.7);
      bg.addColorStop(0, '#0b0b1e');
      bg.addColorStop(0.5, '#070713');
      bg.addColorStop(1, '#04040c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      drawNebulae();

      // étoiles
      var warping = warp > 0.02;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (warping) {
          var dx = s.x - cx, dy = s.y - cy;
          var k = 0.16 * warp * dt;
          var nx = s.x + dx * k, ny = s.y + dy * k;
          ctx.strokeStyle = 'rgba(200,214,255,' + Math.min(s.a * (0.4 + warp), 1) + ')';
          ctx.lineWidth = s.r * (0.8 + warp);
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(nx, ny); ctx.stroke();
          s.x = nx; s.y = ny;
          var d2 = (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy);
          if (d2 > diag * diag * 0.28) {           // recyclage : ré-émission près du centre
            var an = rand(0, Math.PI * 2), rr = rand(6, 46);
            s.x = cx + Math.cos(an) * rr; s.y = cy + Math.sin(an) * rr;
          }
        } else {
          s.x += s.vx * dt; s.y += s.vy * dt; s.tw += s.tws * dt;
          if (s.y > H + 2) { s.y = -2; s.x = rand(0, W); }
          if (s.x < -2) s.x = W + 2; else if (s.x > W + 2) s.x = -2;
          var al = s.a * (0.55 + 0.45 * Math.sin(s.tw));
          ctx.fillStyle = 'rgba(255,255,255,' + al + ')';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
          if (s.r > 1.4) {                          // léger halo sur les grosses étoiles
            ctx.fillStyle = 'rgba(180,205,255,' + (al * 0.25) + ')';
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, 6.283); ctx.fill();
          }
        }
      }

      // étoiles filantes (désactivées en warp)
      if (!warping) {
        nextShoot -= dt * 16.67;
        if (nextShoot <= 0) { spawnShooter(); nextShoot = rand(2500, 5000); }
      }
      for (var j = shooters.length - 1; j >= 0; j--) {
        var sh = shooters[j];
        sh.life += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt;
        var fade = 1 - sh.life / sh.max;
        if (fade <= 0 || sh.x < -300 || sh.x > W + 300 || sh.y > H + 300) { shooters.splice(j, 1); continue; }
        var tx = sh.x - sh.vx / Math.hypot(sh.vx, sh.vy) * sh.len;
        var ty = sh.y - sh.vy / Math.hypot(sh.vx, sh.vy) * sh.len;
        var grd = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
        grd.addColorStop(0, 'rgba(255,255,255,' + (0.9 * fade) + ')');
        grd.addColorStop(0.35, 'rgba(190,210,255,' + (0.35 * fade) + ')');
        grd.addColorStop(1, 'rgba(190,210,255,0)');
        ctx.strokeStyle = grd; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(tx, ty); ctx.stroke();
        // tête brillante
        ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * fade) + ')';
        ctx.beginPath(); ctx.arc(sh.x, sh.y, 1.6, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // avancer les phases de nébuleuses
      for (var n = 0; n < nebulae.length; n++) nebulae[n].ph += nebulae[n].drift * dt * 16.67;

      rafId = requestAnimationFrame(frame);
    }

    function drawStatic() {
      // rendu unique (mouvement réduit / onglet caché)
      var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, diag * 0.7);
      bg.addColorStop(0, '#0b0b1e'); bg.addColorStop(0.5, '#070713'); bg.addColorStop(1, '#04040c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      drawNebulae();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        ctx.fillStyle = 'rgba(255,255,255,' + s.a + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function start() {
      if (running) return;
      running = true; last = 0; rafId = requestAnimationFrame(frame);
    }
    function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); }

    // init
    resize();
    if (reduce) { drawStatic(); }
    else { start(); }

    window.addEventListener('resize', function () {
      resize(); if (reduce || !running) drawStatic();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (!reduce) start();
    });

    return {
      warpTo: function (v) { warpTarget = v; },
      start: start, stop: stop
    };
  })();

  /* ============================================================
     2) BASCULE RECTO / VERSO (crossfade)
     ============================================================ */
  var face = 0;
  var recto = imgBase ? imgBase.getAttribute('data-recto') : '';
  var verso = imgBase ? imgBase.getAttribute('data-verso') : '';
  var altBase = imgBase ? imgBase.getAttribute('data-alt-base') : '';

  function crossfadeTo(src, alt) {
    if (!imgFx || !imgBase) { if (imgBase) { imgBase.src = src; imgBase.alt = alt; } return; }
    var done = function () {
      imgFx.removeEventListener('transitionend', done);
      imgBase.src = src; imgBase.alt = alt;
      imgFx.style.transition = 'none';
      imgFx.style.opacity = '0';
      void imgFx.offsetWidth;                 // reflow
      imgFx.style.transition = '';
    };
    imgFx.style.opacity = '0';
    imgFx.onload = function () {
      imgFx.addEventListener('transitionend', done);
      requestAnimationFrame(function () { imgFx.style.opacity = '1'; });
    };
    imgFx.src = src;
  }

  function setFace(i, animate) {
    i = i ? 1 : 0;
    if (seg) seg.setAttribute('data-face', String(i));
    for (var k = 0; k < btns.length; k++) btns[k].setAttribute('aria-current', k === i ? 'true' : 'false');
    var src = i === 1 ? verso : recto;
    var alt = altBase + (i === 1 ? ' — verso' : ' — recto');
    if (i !== face && animate) crossfadeTo(src, alt);
    else if (imgBase) { imgBase.src = src; imgBase.alt = alt; }
    face = i;
    if (stage) stage.scrollTop = 0;
  }

  for (var k = 0; k < btns.length; k++) (function (i) {
    btns[i].addEventListener('click', function () { setFace(i, true); });
  })(k);

  /* ============================================================
     3) TRANSITION CINÉMATIQUE entrée -> carte
     ============================================================ */
  var timers = [];
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function toCard() {
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
    runIntro();
  }

  function runIntro() {
    clearTimers();
    if (reduce || !Space) {                     // simple fondu court
      body.classList.remove('pre');
      return;
    }
    body.classList.add('go');                   // nom+bouton out, logo reveal, halo bloom, shine
    at(480, function () { Space.warpTo(1); body.classList.add('warp'); });  // star-warp + entrée se fond
    at(820, function () { body.classList.add('flash'); });                  // flash lumineux
    at(1050, function () { body.classList.remove('pre'); });                // débouché sur la carte
    at(1180, function () { Space.warpTo(0); });                             // décélération de l'hyperespace
    at(1250, function () { body.classList.remove('flash'); });
    at(1780, function () { body.classList.remove('go', 'warp'); });         // nettoyage
  }

  function toEntry() {
    clearTimers();
    Space && Space.warpTo(0);
    body.classList.remove('go', 'warp', 'flash');
    body.classList.add('pre');
  }

  if (open) open.addEventListener('click', toCard);

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') { clearTimers(); body.classList.remove('pre', 'go', 'warp', 'flash'); }
    else toEntry();
  });

  // état initial (deep-link vers #carte)
  if (location.hash === '#carte') body.classList.remove('pre');
})();
