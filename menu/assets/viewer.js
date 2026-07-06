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
  var frameEl = document.querySelector('.frame');
  var fs = byId('fs');
  var fsImg = byId('fsImg');
  var fsClose = byId('fsClose');
  var fsSeg = byId('fsSeg');
  var fsBtns = fsSeg ? fsSeg.querySelectorAll('.seg__btn') : [];

  /* ============================================================
     1) MOTEUR DE FOND SPATIAL (canvas, rAF unique)
     ============================================================ */
  var Space = (function () {
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, diag = 1, bgGrad = null;
    var fx = 0, fy = 0;                 // point focal du star-warp (défaut = centre ; recentré sur la planète du logo à l'intro)
    var stars = [], nebulae = [], shooters = [];
    var running = false, rafId = 0, last = 0, nextShoot = 1200;
    var warp = 0, warpTarget = 0;      // 0 = calme, 1 = hyperespace
    var warpRamping = false, warpRampDur = 900, warpRampT0 = -1;  // montée ACCÉLÉRÉE (ease-in) synchronisée au zoom
    // Budget adaptatif : tél. peu puissants (<=4 cœurs / <=4 Go) => densité un cran plus basse (dégradation gracieuse, look quasi identique)
    var lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                   (navigator.deviceMemory && navigator.deviceMemory <= 4);
    var DPR_CAP = lowPower ? 1.35 : 1.5;   // mobile : jamais au-delà de 1.5 device px (2 = trop lourd)
    var STAR_N = lowPower ? 66 : 90;       // (était 150) -40% env., densité visuellement proche
    var MAX_PARTS = lowPower ? 190 : 240;  // plafond dur de particules de désintégration
    var parts = [];                    // particules de désintégration du logo
    var logoImg = new Image(), logoReady = false, logoPts = null;
    (function () {
      var el = document.querySelector('.entry__logo');
      if (!el) return;
      logoImg.onload = function () {
        try {
          var ow = 100, ratio = (logoImg.naturalHeight / logoImg.naturalWidth) || (217 / 320);
          var oh = Math.max(1, Math.round(ow * ratio));
          var oc = document.createElement('canvas'); oc.width = ow; oc.height = oh;
          var octx = oc.getContext('2d');
          octx.drawImage(logoImg, 0, 0, ow, oh);
          var d = octx.getImageData(0, 0, ow, oh).data, pts = [];
          for (var y = 0; y < oh; y += 2) for (var x = 0; x < ow; x += 2) {
            var idx = (y * ow + x) * 4;
            if (d[idx + 3] > 45) pts.push({ u: x / ow, v: y / oh, r: d[idx], g: d[idx + 1], b: d[idx + 2] });
          }
          logoPts = pts; logoReady = pts.length > 0;
        } catch (e) { logoReady = false; }
      };
      logoImg.src = el.currentSrc || el.src;
    })();

    function rand(a, b) { return a + Math.random() * (b - a); }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H * 0.44; diag = Math.sqrt(W * W + H * H);
      fx = cx; fy = cy;                  // point focal par défaut (ré-fixé sur la planète juste avant le warp)
      // Dégradé de fond mis en cache : dépend seulement de cx/cy/diag (constants entre resize) -> évite un createRadialGradient par frame
      bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, diag * 0.7);
      bgGrad.addColorStop(0, '#0b0b1e');
      bgGrad.addColorStop(0.5, '#070713');
      bgGrad.addColorStop(1, '#04040c');
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
      if (warpRamping) {                       // montée pilotée par le temps -> accélération (p²) verrouillée sur le zoom
        if (warpRampT0 < 0) warpRampT0 = t;
        var wp = (t - warpRampT0) / warpRampDur; if (wp > 1) wp = 1;
        warp = wp * wp;                         // ease-in : étoiles lentes au départ puis whip vers le pic
        if (wp >= 1) { warpRamping = false; warpTarget = 1; }
      } else {
        warp += (warpTarget - warp) * Math.min(0.07 * dt, 1);   // décélération douce (retour au calme)
      }

      // fond dégradé (base opaque) — gradient mis en cache
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

      drawNebulae();

      // étoiles
      var warping = warp > 0.02;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (warping) {
          var dx = s.x - fx, dy = s.y - fy;        // les traînées filent depuis le point focal (planète du logo)
          var k = 0.16 * warp * dt;
          var nx = s.x + dx * k, ny = s.y + dy * k;
          ctx.strokeStyle = 'rgba(200,214,255,' + Math.min(s.a * (0.4 + warp), 1) + ')';
          ctx.lineWidth = s.r * (0.8 + warp);
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(nx, ny); ctx.stroke();
          s.x = nx; s.y = ny;
          var d2 = (nx - fx) * (nx - fx) + (ny - fy) * (ny - fy);
          if (d2 > diag * diag * 0.28) {           // recyclage : ré-émission près du point focal (la planète = le portail)
            var an = rand(0, Math.PI * 2), rr = rand(6, 46);
            s.x = fx + Math.cos(an) * rr; s.y = fy + Math.sin(an) * rr;
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

      // particules de désintégration du logo -> aspirées dans le star-warp
      for (var pk = parts.length - 1; pk >= 0; pk--) {
        var pp = parts[pk];
        if (pp.delay > 0) { pp.delay -= dt; continue; }   // dissolution progressive (gauche -> droite)
        pp.life += dt;
        var pdx = pp.x - fx, pdy = pp.y - fy;             // expansion depuis la planète (les particules jaillissent de LÀ)
        var pex = (0.045 + 0.16 * warp) * dt;             // expansion radiale (puff puis star-warp)
        var pnx = pp.x + pdx * pex + pp.vx * dt;
        var pny = pp.y + pdy * pex + pp.vy * dt;
        var pf = 1 - pp.life / pp.max;
        if (pf <= 0 || pnx < -60 || pnx > W + 60 || pny < -60 || pny > H + 60) { parts.splice(pk, 1); continue; }
        var pa = Math.min(pf * (0.85 + warp * 0.4), 1);
        ctx.strokeStyle = 'rgba(' + pp.col[0] + ',' + pp.col[1] + ',' + pp.col[2] + ',' + pa + ')';
        ctx.lineWidth = 1 + warp * 0.8;
        ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(pnx, pny); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + (pa * 0.7) + ')';   // petite tête brillante
        ctx.fillRect(pnx - 0.6, pny - 0.6, 1.2, 1.2);
        pp.x = pnx; pp.y = pny;
      }
      ctx.globalCompositeOperation = 'source-over';

      // avancer les phases de nébuleuses
      for (var n = 0; n < nebulae.length; n++) nebulae[n].ph += nebulae[n].drift * dt * 16.67;

      rafId = requestAnimationFrame(frame);
    }

    function drawStatic() {
      // rendu unique (mouvement réduit / onglet caché) — gradient mis en cache
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
      drawNebulae();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        ctx.fillStyle = 'rgba(255,255,255,' + s.a + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function disintegrate(rect) {
      // éclate le logo en particules à sa silhouette (coords écran = coords canvas)
      if (!logoReady || !logoPts || !rect) return;
      var lcx = rect.left + rect.width / 2, lcy = rect.top + rect.height / 2;
      // plafond dur : on échantillonne les points du logo par pas pour ne jamais dépasser MAX_PARTS (répartition spatiale conservée)
      var stride = Math.max(1, Math.ceil(logoPts.length / MAX_PARTS));
      for (var i = 0; i < logoPts.length; i += stride) {
        var p = logoPts[i];
        var px = rect.left + p.u * rect.width, py = rect.top + p.v * rect.height;
        var ox = px - lcx, oy = py - lcy, od = Math.hypot(ox, oy) || 1;   // direction radiale (explosion vers l'extérieur)
        parts.push({
          x: px, y: py,
          vx: ox / od * rand(0.7, 1.8) + rand(-0.35, 0.35),
          vy: oy / od * rand(0.7, 1.8) + rand(-0.35, 0.35),
          col: [p.r, p.g, p.b],
          life: 0, max: rand(52, 88),
          delay: p.u * 7 + rand(0, 4)                // balayage de dissolution gauche -> droite
        });
      }
    }
    function resetFx() { parts.length = 0; fx = cx; fy = cy; warpRamping = false; warpRampT0 = -1; }
    // recentre le point focal du star-warp/désintégration (coords écran = coords canvas)
    function setWarpOrigin(x, y) {
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) { fx = x; fy = y; }
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
      warpTo: function (v) { if (v <= 0) { warpRamping = false; } warpTarget = v; },
      // démarre la montée accélérée du star-warp sur `dur` ms (verrouillée sur la même fenêtre que le zoom CSS)
      warpRamp: function (dur) { warpRamping = true; warpRampDur = Math.max(1, dur || 900); warpRampT0 = -1; warpTarget = 1; },
      start: start, stop: stop,
      disintegrate: disintegrate, reset: resetFx, setWarpOrigin: setWarpOrigin
    };
  })();

  /* ============================================================
     2) BASCULE RECTO / VERSO (crossfade)
     ============================================================ */
  var face = 0;
  var recto = imgBase ? imgBase.getAttribute('data-recto') : '';
  var verso = imgBase ? imgBase.getAttribute('data-verso') : '';
  var altBase = imgBase ? imgBase.getAttribute('data-alt-base') : '';

  function srcFor(i) { return i === 1 ? verso : recto; }
  function altFor(i) { return altBase + (i === 1 ? ' — verso' : ' — recto'); }

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

  function syncSeg(i) {
    if (seg) seg.setAttribute('data-face', String(i));
    for (var a = 0; a < btns.length; a++) btns[a].setAttribute('aria-current', a === i ? 'true' : 'false');
    if (fsSeg) fsSeg.setAttribute('data-face', String(i));
    for (var b = 0; b < fsBtns.length; b++) fsBtns[b].setAttribute('aria-current', b === i ? 'true' : 'false');
  }

  function setFace(i, animate) {
    i = i ? 1 : 0;
    syncSeg(i);
    var src = srcFor(i), alt = altFor(i);
    if (i !== face && animate) crossfadeTo(src, alt);
    else if (imgBase) { imgBase.src = src; imgBase.alt = alt; }
    if (fsImg) { fsImg.src = src; fsImg.alt = alt; }
    face = i;
    if (stage) stage.scrollTop = 0;
  }

  for (var k = 0; k < btns.length; k++) (function (i) {
    btns[i].addEventListener('click', function () { setFace(i, true); });
  })(k);
  for (var kf = 0; kf < fsBtns.length; kf++) (function (i) {
    fsBtns[i].addEventListener('click', function () { setFace(i, true); });
  })(kf);

  /* Plein écran carte : tap -> overlay contain, zoom natif (pincer), ✕/tap pour fermer */
  var fsClosing = false;
  function openFs() {
    if (!fs) return;
    if (fsImg) { fsImg.src = srcFor(face); fsImg.alt = altFor(face); }
    fsClosing = false;
    fs.hidden = false;
    fs.setAttribute('aria-hidden', 'false');
    void fs.offsetWidth;                       // reflow -> transition d'ouverture
    fs.classList.add('is-open');
    if (fsClose) fsClose.focus();
  }
  function finishClose() {
    if (!fs) return;
    fs.hidden = true;
    fs.setAttribute('aria-hidden', 'true');
    fsClosing = false;
    if (frameEl) frameEl.focus();
  }
  function closeFs() {
    if (!fs || fs.hidden || fsClosing) return;
    fsClosing = true;
    fs.classList.remove('is-open');
    if (reduce) finishClose();
  }
  if (fs) {
    fs.addEventListener('transitionend', function (e) {
      if (fsClosing && e.target === fs && e.propertyName === 'opacity') finishClose();
    });
    fs.addEventListener('click', function (e) {
      if (e.target === fs || e.target === fsImg) closeFs();   // tap fond/carte ferme ; pincer = zoom natif
    });
  }
  if (frameEl) {
    frameEl.addEventListener('click', openFs);
    frameEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openFs(); }
    });
  }
  if (fsClose) fsClose.addEventListener('click', closeFs);
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && fs && !fs.hidden) closeFs();
  });

  /* ============================================================
     3) TRANSITION CINÉMATIQUE entrée -> carte
     ============================================================ */
  // Position NORMALISÉE de la planète (balle de golf + anneau, au-dessus du « xy ») dans la boîte du logo.
  // Mesurée sur le SVG rendu (centroïde des pixels clairs de la balle) — cohérent avec .entry__logo-wrap::after (CSS).
  var PLANET_FX = 0.716, PLANET_FY = 0.163;

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
    body.classList.add('go');                   // (a) nom+bouton out, logo apparaît/se cale  (b) reflet vitré fin glisse G->D (~1s, savouré)
    // (c) enchaînement DIRECT, sans temps mort : on plonge dans la planète + les étoiles filent, tout accélère ensemble
    at(1250, function () {
      var el = document.querySelector('.entry__logo');
      var rect = el ? el.getBoundingClientRect() : null;
      if (rect) {                                // point de la planète (balle de golf au-dessus du « xy ») en coords écran
        var px = rect.left + PLANET_FX * rect.width;
        var py = rect.top + PLANET_FY * rect.height;
        Space.setWarpOrigin(px, py);             // les étoiles filent PILE depuis la planète
        body.style.setProperty('--flash-x', px + 'px');   // le flash « on passe à travers » est centré sur la planète
        body.style.setProperty('--flash-y', py + 'px');
      }
      body.classList.add('zoom');                // ZOOM : la caméra plonge dans la planète (scale, origine = planète)
      Space.warpRamp(1000);                      // star-warp accéléré sur la MÊME fenêtre/courbe que le zoom
    });
    at(2080, function () { body.classList.add('flash'); });  // (d) pic : flash doux « on passe à travers »
    at(2200, function () { body.classList.remove('pre'); }); // (e) débouché fluide sur la carte
    at(2380, function () { Space.warpTo(0); });              // décélération de l'hyperespace
    at(2560, function () { body.classList.remove('flash'); });
    at(3000, function () { body.classList.remove('go', 'zoom', 'warp'); Space.reset(); }); // nettoyage
  }

  function toEntry() {
    clearTimers();
    Space && Space.warpTo(0);
    Space && Space.reset();
    body.classList.remove('go', 'zoom', 'warp', 'flash', 'dissolve');
    body.classList.add('pre');
  }

  if (open) open.addEventListener('click', toCard);

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') { clearTimers(); body.classList.remove('pre', 'go', 'zoom', 'warp', 'flash', 'dissolve'); Space && Space.reset(); }
    else toEntry();
  });

  // état initial (deep-link vers #carte)
  if (location.hash === '#carte') body.classList.remove('pre');
})();
