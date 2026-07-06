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
    var STAR_N = lowPower ? 66 : 90;       // (était 150) -40% env., densité visuellement proche — INCHANGÉ au repos
    var MAX_PARTS = lowPower ? 240 : 800;  // shatter DENSE façon « N » : éclats = quads qui tumble (transitoire, ~1s ; lowPower bridé)
    var parts = [];                    // particules de désintégration du logo (rendues sur l'OVERLAY, devant la sphère)
    // Stries de tunnel ÉPHÉMÈRES : pool recyclé, actif UNIQUEMENT pendant le dive (warp>0.3) -> tunnel plein, 0 coût au calme
    var STREAK_N = lowPower ? 90 : 220;
    var streaks = [];
    // ANNEAUX de TUNNEL : cercles concentriques qui jaillissent de la planète (throat) et rushent AU-DELÀ de la caméra.
    // Pool pré-alloué (jamais d'allocation par frame), actif UNIQUEMENT au pic du dive (warp>0.5) -> vraie géométrie
    // d'intérieur pendant ~300ms (on TRAVERSE la surface), 0 coût au calme.
    var RING_N = lowPower ? 6 : 9;
    var rings = [], ringAcc = 0;
    // Overlay dédié aux fragments : canvas transparent plein écran (z135), au-dessus de .scene3d (z130), sous .flash-el (z140)
    var fxCanvas = null, fctx = null, fW = 0, fH = 0, fxDirty = false;
    var logoImg = new Image(), logoReady = false, logoPts = null;
    (function () {
      var el = document.querySelector('.entry__logo');
      if (!el) return;
      logoImg.onload = function () {
        try {
          var ow = 200, ratio = (logoImg.naturalHeight / logoImg.naturalWidth) || (217 / 320);  // raster fin -> silhouette nette
          var oh = Math.max(1, Math.round(ow * ratio));
          var oc = document.createElement('canvas'); oc.width = ow; oc.height = oh;
          var octx = oc.getContext('2d');
          octx.drawImage(logoImg, 0, 0, ow, oh);
          var d = octx.getImageData(0, 0, ow, oh).data, pts = [];
          for (var y = 0; y < oh; y += 1) for (var x = 0; x < ow; x += 1) {
            var idx = (y * ow + x) * 4;
            if (d[idx + 3] > 45) pts.push({ u: x / ow, v: y / oh, r: d[idx], g: d[idx + 1], b: d[idx + 2] });
          }
          logoPts = pts; logoReady = pts.length > 0;
        } catch (e) { logoReady = false; }
      };
      logoImg.src = el.currentSrc || el.src;
    })();

    function rand(a, b) { return a + Math.random() * (b - a); }

    // Échantillonneur cubic-bezier(.45,.05,.72,.5) (Newton-Raphson) — MÊME courbe que dive3d/planetStreak.
    // Verrouille la vitesse du warp sur la plongée CSS (l'ancien pow(1.7) déviait jusqu'à ~0.06 en milieu de courbe).
    var warpEase = (function () {
      var x1 = 0.45, y1 = 0.05, x2 = 0.72, y2 = 0.5;
      function bez(t, a, b) { var A = 1 - 3 * b + 3 * a, B = 3 * b - 6 * a, C = 3 * a; return ((A * t + B) * t + C) * t; }
      function slope(t, a, b) { var A = 1 - 3 * b + 3 * a, B = 3 * b - 6 * a, C = 3 * a; return (3 * A * t + 2 * B) * t + C; }
      return function (x) {
        if (x <= 0) return 0; if (x >= 1) return 1;
        var t = x;
        for (var i = 0; i < 6; i++) { var d = slope(t, x1, x2); if (d > -1e-6 && d < 1e-6) break; t -= (bez(t, x1, x2) - x) / d; }
        if (t < 0) t = 0; else if (t > 1) t = 1;
        return bez(t, y1, y2);
      };
    })();
    // état des salves de débris (dispersion façon « N » : 2 salves -> champ soutenu)
    var salvoRect = null, salvoSkipX = 0, salvoSkipY = 0, salvoSkipR = 0, salvo2Done = true;

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
      buildStars(); buildNebulae(); sizeFxCanvas(); initStreaks(); initRings();
    }

    // Overlay fragments : créé paresseusement (jamais en mouvement réduit), dimensionné au viewport * DPR
    function ensureFxCanvas() {
      if (fxCanvas || reduce) return;
      fxCanvas = document.createElement('canvas'); fxCanvas.className = 'fxparts';
      fxCanvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(fxCanvas);
      fctx = fxCanvas.getContext('2d');
      sizeFxCanvas();
    }
    function sizeFxCanvas() {
      if (!fxCanvas) return;
      fW = window.innerWidth; fH = window.innerHeight;
      fxCanvas.width = Math.round(fW * DPR); fxCanvas.height = Math.round(fH * DPR);
      fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function initStreaks() {
      if (streaks.length === STREAK_N) return;
      streaks = [];
      for (var i = 0; i < STREAK_N; i++) streaks.push({ active: false, ux: 0, uy: 0, d: 0, a: 0 });
    }
    function spawnStreak(s) {
      var an = rand(0, Math.PI * 2), rr = rand(3, 26);
      s.ux = Math.cos(an); s.uy = Math.sin(an); s.d = rr; s.a = rand(0.4, 0.95); s.active = true;
    }
    function initRings() {
      if (rings.length === RING_N) { for (var i = 0; i < RING_N; i++) rings[i].active = false; return; }
      rings = [];
      for (var j = 0; j < RING_N; j++) rings.push({ r: 0, active: false });
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
        warp = warpEase(wp);                    // ÉCHANTILLONNAGE EXACT de cubic-bezier(.45,.05,.72,.5) -> phase-lock parfait avec dive3d
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
      ctx.lineCap = 'round';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (warping) {
          // HYPERESPACE : la tête accélère radialement depuis la planète, la TRAÎNÉE s'ALLONGE avec le warp
          // (longueur ∝ warp² et ∝ distance au focal) — plus de vitesse SANS ajouter d'étoiles.
          var dx = s.x - fx, dy = s.y - fy;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          var ux = dx / d, uy = dy / d;            // direction radiale unitaire (planète -> extérieur)
          var k = 0.135 * warp * dt;               // accélération de la tête
          var nx = s.x + dx * k, ny = s.y + dy * k;
          var edge = d / (diag * 0.5); if (edge > 1) edge = 1;
          // traînée HYPERESPACE FRANC : ~720px au pic (≈155% de la demi-diagonale d'un 390x844) -> les stries filent
          // de la planète jusqu'aux bords ; base relevée (0.42) pour que même les stries mi-écran soient longues. 0 étoile de +.
          var L = (6 + warp * warp * 720) * (0.42 + 0.58 * edge);
          var tx = nx - ux * L, ty = ny - uy * L;  // la queue pointe vers le focal
          // BLOOM : 2 strokes par étoile -> halo bleuté doux + cœur blanc chaud (stries Netflix avec noyau brillant)
          var haloW = s.r * (0.55 + warp * 1.8);
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(nx, ny);
          ctx.strokeStyle = 'rgba(200,214,255,' + Math.min(s.a * (0.32 + warp * 0.95), 1) + ')';
          ctx.lineWidth = haloW; ctx.stroke();                       // halo doux
          ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(s.a * (0.28 + warp * 0.9), 1) + ')';
          ctx.lineWidth = haloW * 0.35; ctx.stroke();                // cœur chaud (même path, plus fin, blanc pur)
          s.x = nx; s.y = ny;
          var d2 = (nx - fx) * (nx - fx) + (ny - fy) * (ny - fy);
          if (d2 > diag * diag * 0.52) {           // recyclage plus TARD -> la tête parcourt ~72% de la diagonale avant reset (trace plus longue et franche)
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

      // STRIES DE TUNNEL éphémères : densifient l'hyperespace PENDANT le dive uniquement (émises du focal = la planète), recyclées
      if (warp > 0.3) {
        for (var q = 0; q < streaks.length; q++) {
          var st = streaks[q];
          if (!st.active) { if (Math.random() < 0.5) spawnStreak(st); else continue; }
          st.d += (st.d * 0.13 + 0.8) * warp * dt;         // accélération radiale (whip)
          var hx = fx + st.ux * st.d, hy = fy + st.uy * st.d;
          var sedge = st.d / (diag * 0.5); if (sedge > 1) sedge = 1;
          var sL = (8 + warp * warp * 560) * (0.34 + 0.66 * sedge);   // stries de tunnel ALLONGÉES (~570px) -> couloir franc
          ctx.strokeStyle = 'rgba(206,220,255,' + Math.min(st.a * (0.2 + warp * 0.85), 1) * (1 - sedge * 0.4) + ')';
          ctx.lineWidth = 0.6 + warp * 1.2;
          ctx.beginPath(); ctx.moveTo(hx - st.ux * sL, hy - st.uy * sL); ctx.lineTo(hx, hy); ctx.stroke();
          if (st.d > diag * 0.72) st.active = false;        // recyclage plus tard -> strie plus longue avant reset
        }
      } else if (streaks.length) {
        for (var qz = 0; qz < streaks.length; qz++) streaks[qz].active = false;
      }

      // ANNEAUX DE TUNNEL : au PIC du dive, des cercles concentriques JAILLISSENT de la planète (fx,fy) et rushent vers/au-delà
      // de la caméra -> vraie GÉOMÉTRIE D'INTÉRIEUR (on perce la surface et on traverse le couloir), façon intro Netflix.
      // Actif seulement warp>0.5 (~300ms au pic), pool recyclé, additif -> 0 coût au calme.
      if (warp > 0.5) {
        ringAcc += dt;
        if (ringAcc >= 3.0) {                                // cadence d'émission -> flux concentrique continu (pas un flash unique)
          ringAcc = 0;
          for (var rg = 0; rg < rings.length; rg++) if (!rings[rg].active) { rings[rg].r = rand(5, 15); rings[rg].active = true; break; }
        }
        for (var rk = 0; rk < rings.length; rk++) {
          var rn = rings[rk];
          if (!rn.active) continue;
          rn.r += (rn.r * 0.12 + 2.6) * warp * dt;           // accélération radiale (perspective : plus près = plus vite = rush vers la caméra)
          var rprog = rn.r / (diag * 0.6);                   // 0 = throat (planète)  ->  1+ = dépasse le plan caméra
          if (rprog >= 1.12) { rn.active = false; continue; }
          var ra = (rprog < 0.16 ? rprog / 0.16 : 1) * (1 - Math.max(0, (rprog - 0.7) / 0.42)); // fade-in throat + fade-out bord
          if (ra <= 0) continue;
          var rlw = 1.2 + rprog * 5.5;                       // paroi qui s'épaissit en approchant (perspective) -> lecture « couloir »
          ctx.strokeStyle = 'rgba(206,220,255,' + (0.5 * ra * (0.5 + 0.5 * warp)) + ')';
          ctx.lineWidth = rlw; ctx.beginPath(); ctx.arc(fx, fy, rn.r, 0, 6.283); ctx.stroke();
          // liseré brand (teal/violet alterné) accolé -> anneaux structurés, pas de simples cercles plats
          ctx.strokeStyle = (rk % 2 ? 'rgba(148,66,146,' : 'rgba(103,186,172,') + (0.34 * ra * warp) + ')';
          ctx.lineWidth = rlw * 0.5; ctx.beginPath(); ctx.arc(fx, fy, rn.r * 1.02, 0, 6.283); ctx.stroke();
        }
      } else if (rings.length) {
        for (var rz = 0; rz < rings.length; rz++) rings[rz].active = false;
        ringAcc = 0;
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

      ctx.globalCompositeOperation = 'source-over';   // fin des tracés additifs du canvas principal

      // 2e SALVE de débris quand le warp franchit 0.6 -> champ d'éclats SOUTENU (façon dispersion « N »)
      if (salvoRect && !salvo2Done && warp > 0.6) {
        emitParts(salvoRect, salvoSkipX, salvoSkipY, salvoSkipR, Math.round(MAX_PARTS * 0.55));
        salvo2Done = true;
      }

      // ---- DISPERSION sur l'OVERLAY (canvas z135, DEVANT la sphère 3D z130) : les éclats passent devant la caméra ----
      if (fctx) {
        if (parts.length) {
          if (fxCanvas.style.display !== 'block') fxCanvas.style.display = 'block';
          fctx.clearRect(0, 0, fW, fH);
          fctx.globalCompositeOperation = 'lighter';
          for (var pk = parts.length - 1; pk >= 0; pk--) {
            var pp = parts[pk];
            if (pp.delay > 0) { pp.delay -= dt; continue; }   // dissolution progressive (gauche -> droite)
            pp.life += dt;
            // DISPERSION façon logo « N » : les éclats jaillissent de la planète, ACCÉLÈRENT (∝ warp) et filent hors cadre
            var pdx = pp.x - fx, pdy = pp.y - fy;
            var pex = (0.05 + 0.42 * warp) * dt;              // éjection radiale accélérée (puff -> hyperespace)
            // BIAIS DIRECTIONNEL : rake global (+warp*2px/frame) -> les éclats sont peignés dans le sens de voyage
            // (sweep façon « N », pas une explosion purement radiale)
            var pnx = pp.x + pdx * pex + pp.vx * dt + warp * 2 * dt;
            var pny = pp.y + pdy * pex + pp.vy * dt;
            var pf = 1 - pp.life / pp.max;
            if (pf <= 0 || pnx < -80 || pnx > W + 80 || pny < -80 || pny > H + 80) { parts.splice(pk, 1); continue; }
            var pa = Math.min(pf * (1.0 + warp * 0.65), 1);  // éclats plus OPAQUES (présence accrue, même nb de particules)
            pp.rot += pp.vr * dt;                             // rotation PAR-FRAGMENT (tumble)
            // ÉCLAT = quad court orienté par sa rotation, ALLONGÉ radialement pendant le warp (whip) -> vrais débris, pas des strokes
            var lc = Math.cos(pp.rot), ls = Math.sin(pp.rot);
            var lng = pp.sz * (1.0 + warp * 8.4), hw = pp.sz * 0.64;  // shards PLUS LONGS + PLUS LARGES au pic warp (dislocation LISIBLE, 0 particule de +)
            var ax = lc * lng, ay = ls * lng, bx = -ls * hw, by = lc * hw;
            fctx.fillStyle = 'rgba(' + pp.col[0] + ',' + pp.col[1] + ',' + pp.col[2] + ',' + pa + ')';
            fctx.beginPath();
            fctx.moveTo(pnx - ax - bx, pny - ay - by);
            fctx.lineTo(pnx + ax - bx, pny + ay - by);
            fctx.lineTo(pnx + ax + bx, pny + ay + by);
            fctx.lineTo(pnx - ax + bx, pny - ay + by);
            fctx.closePath(); fctx.fill();
            var hd = pp.sz * 0.72;                                     // tête brillante DIMENSIONNÉE sur l'éclat (plus visible)
            fctx.fillStyle = 'rgba(255,255,255,' + (pa * 0.9) + ')';
            fctx.fillRect(pnx - hd, pny - hd, hd * 2, hd * 2);
            pp.x = pnx; pp.y = pny;
          }
          fctx.globalCompositeOperation = 'source-over';
          fxDirty = true;
        } else if (fxDirty) {                                 // les éclats ont disparu -> on efface l'overlay UNE fois puis on le masque
          fctx.clearRect(0, 0, fW, fH); fxDirty = false;
          fxCanvas.style.display = 'none';
        }
      }

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

    // Émet une salve d'éclats à la silhouette du logo (budget = nb max de points échantillonnés).
    // skipX/skipY/skipR : zone de la PLANÈTE préservée (elle devient la sphère 3D dans laquelle on plonge).
    function emitParts(rect, skipX, skipY, skipR, budget) {
      if (!logoReady || !logoPts || !rect) return;
      ensureFxCanvas();                          // overlay prêt AVANT de peupler les éclats
      var lcx = rect.left + rect.width / 2, lcy = rect.top + rect.height / 2;
      var hasSkip = (typeof skipR === 'number' && skipR > 0), skipR2 = hasSkip ? skipR * skipR : 0;
      // échantillonnage par pas -> jamais plus de `budget` points par salve (répartition spatiale conservée)
      var stride = Math.max(1, Math.ceil(logoPts.length / Math.max(1, budget)));
      for (var i = 0; i < logoPts.length; i += stride) {
        if (parts.length >= MAX_PARTS) break;      // plafond dur (protège les tél. peu puissants)
        var p = logoPts[i];
        var px = rect.left + p.u * rect.width, py = rect.top + p.v * rect.height;
        if (hasSkip) { var sdx = px - skipX, sdy = py - skipY; if (sdx * sdx + sdy * sdy < skipR2) continue; }
        var ox = px - lcx, oy = py - lcy, od = Math.hypot(ox, oy) || 1;   // direction radiale (explosion vers l'extérieur)
        parts.push({
          x: px, y: py,
          vx: ox / od * rand(0.9, 2.4) + rand(-0.5, 0.5),
          vy: oy / od * rand(0.9, 2.4) + rand(-0.5, 0.5),
          col: [p.r, p.g, p.b],
          life: 0, max: rand(50, 84),
          delay: p.u * 5 + rand(0, 3),               // balayage de dissolution gauche -> droite
          rot: rand(0, 6.283), vr: rand(-0.28, 0.28), sz: rand(1.7, 4.1)  // éclat = quad qui tumble (plus GROS -> dislocation lisible, nb inchangé)
        });
      }
    }
    function disintegrate(rect, skipX, skipY, skipR) {
      // 1re salve immédiate (planète préservée via skip) + ARME la 2e salve (déclenchée à warp>0.6)
      salvoRect = rect; salvoSkipX = skipX; salvoSkipY = skipY; salvoSkipR = skipR; salvo2Done = false;
      emitParts(rect, skipX, skipY, skipR, Math.round(MAX_PARTS * 0.62));
    }
    function resetFx() {
      parts.length = 0; fx = cx; fy = cy; warpRamping = false; warpRampT0 = -1;
      salvoRect = null; salvo2Done = true;
      for (var i = 0; i < streaks.length; i++) streaks[i].active = false;
      for (var ri = 0; ri < rings.length; ri++) rings[ri].active = false; ringAcc = 0;
      if (fctx) { fctx.clearRect(0, 0, fW, fH); fxDirty = false; }
      if (fxCanvas) fxCanvas.style.display = 'none';
    }
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

  // --- Scène 3D « plongée dans la planète » : sphère radiale + anneau, créée dynamiquement
  //     (le HTML des 2 centres reste inchangé). perspective + translateZ = vraie profondeur (pas un aplat). ---
  var scene = null, planetEl = null;
  function buildScene() {
    if (scene || reduce) return;
    scene = document.createElement('div'); scene.className = 'scene3d'; scene.setAttribute('aria-hidden', 'true');
    planetEl = document.createElement('div'); planetEl.className = 'planet3d';
    var ring = document.createElement('span'); ring.className = 'planet3d__ring';
    var spec = document.createElement('span'); spec.className = 'planet3d__spec';
    var core = document.createElement('span'); core.className = 'planet3d__core';  // cœur qui gonfle -> ENTRÉE dans la sphère -> raccord whiteout
    planetEl.appendChild(ring); planetEl.appendChild(spec); planetEl.appendChild(core);
    // 3 parois de TUNNEL empilées (rotation base + phases décalées via CSS) -> couloir soutenu façon « N »
    for (var ti = 1; ti <= 3; ti++) {
      var tunnel = document.createElement('div');
      tunnel.className = 'planet3d__tunnel' + (ti > 1 ? ' planet3d__tunnel--' + ti : '');
      scene.appendChild(tunnel);                // DERRIÈRE la sphère, même perspective (620) -> franchit le plan caméra
    }
    scene.appendChild(planetEl);
    document.body.appendChild(scene);
  }

  var timers = [];
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function toCard() {
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
    runIntro();
  }

  function runIntro() {
    clearTimers();
    if (reduce || !Space) {                     // simple fondu court (aucun warp / zoom / dispersion)
      body.classList.remove('pre');
      return;
    }
    buildScene();
    body.classList.add('go');                   // (a) nom+bouton out, logo apparaît/se cale  (b) reflet vitré fin glisse G->D (~1s, savouré)
    // (c) enchaînement DIRECT, sans temps mort : plongée 3D dans la planète + hyperespace + dispersion, tout sur la MÊME courbe (ease-in)
    at(1250, function () {
      var el = document.querySelector('.entry__logo');
      var rect = el ? el.getBoundingClientRect() : null;
      if (rect) {                                // point de la planète (balle de golf au-dessus du « xy ») en coords écran
        var px = rect.left + PLANET_FX * rect.width;
        var py = rect.top + PLANET_FY * rect.height;
        var pR = rect.width * 0.13;
        Space.setWarpOrigin(px, py);             // les traînées d'étoiles filent PILE depuis la planète
        Space.disintegrate(rect, px, py, pR);    // DISPERSION façon « N » : le mot « fun galaxy » se fragmente (planète préservée)
        body.style.setProperty('--flash-x', px + 'px');   // le flash « on passe à travers » est centré sur la planète
        body.style.setProperty('--flash-y', py + 'px');
        if (scene && planetEl) {                 // place la SPHÈRE 3D pile sur la planète, puis on plonge dedans (translateZ)
          var size = Math.max(22, Math.round(rect.width * 0.15));
          planetEl.style.width = size + 'px'; planetEl.style.height = size + 'px';
          planetEl.style.left = (px - size / 2) + 'px';
          planetEl.style.top = (py - size / 2) + 'px';
          var tcx = window.innerWidth / 2, tcy = window.innerHeight * 0.46;  // recentrage pendant la plongée
          planetEl.style.setProperty('--dive-dx', (tcx - px) + 'px');
          planetEl.style.setProperty('--dive-dy', (tcy - py) + 'px');
          scene.style.display = 'block';
        }
      }
      body.classList.add('zoom');                // PLONGÉE 3D : perspective + translateZ + rotate (origine = planète) EN MÊME TEMPS que le warp
      Space.warpRamp(1000);                      // star-warp accéléré sur la MÊME fenêtre/courbe que la plongée
    });
    // (d) RACCORD SANS POP : le PIC du whiteout (flashPulse, montée 120ms) culmine à ~2230ms = PILE quand dive3d atteint 100% (fin 2250)
    at(2110, function () { body.classList.add('flash'); });  // flash démarre -> pic d'opacité (flashPulse 18%) à ~2227
    at(2227, function () { body.classList.remove('pre'); });  // (e) carte révélée SOUS le whiteout PLEIN, cut net (transition coupée) -> seul le flash décline
    at(2360, function () { Space.warpTo(0); });               // décélération de l'hyperespace après le pic
    at(2760, function () { body.classList.remove('flash'); });// le flash se fond sur la carte
    at(3050, function () {                                     // nettoyage
      body.classList.remove('go', 'zoom', 'warp');
      Space.reset();
      if (scene) scene.style.display = 'none';
    });
  }

  function toEntry() {
    clearTimers();
    Space && Space.warpTo(0);
    Space && Space.reset();
    body.classList.remove('go', 'zoom', 'warp', 'flash', 'dissolve');
    if (scene) scene.style.display = 'none';
    body.classList.add('pre');
  }

  if (open) open.addEventListener('click', toCard);

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') { clearTimers(); body.classList.remove('pre', 'go', 'zoom', 'warp', 'flash', 'dissolve'); Space && Space.reset(); if (scene) scene.style.display = 'none'; }
    else toEntry();
  });

  // état initial (deep-link vers #carte)
  if (location.hash === '#carte') body.classList.remove('pre');
})();
