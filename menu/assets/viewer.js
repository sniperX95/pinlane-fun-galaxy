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
    var fx0 = 0, fy0 = 0, fx1 = 0, fy1 = 0, focalDrift = false;   // dérive du point focal pendant le ramp (planète -> centre écran), MÊME courbe que dive3d
    // Budget adaptatif : tél. peu puissants (<=4 cœurs / <=4 Go) => densité un cran plus basse (dégradation gracieuse, look quasi identique)
    var lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                   (navigator.deviceMemory && navigator.deviceMemory <= 4);
    var DPR_CAP = lowPower ? 1.35 : 1.5;   // mobile : jamais au-delà de 1.5 device px (2 = trop lourd)
    var STAR_N = lowPower ? 66 : 90;       // (était 150) -40% env., densité visuellement proche — INCHANGÉ au repos
    var MAX_PARTS = lowPower ? 240 : 800;  // shatter DENSE façon « N » : éclats = quads qui tumble (transitoire, ~1s ; lowPower bridé)
    var parts = [];                    // particules de désintégration du logo (rendues sur l'OVERLAY, devant la sphère)
    // Étoiles de FLUX éphémères : pool recyclé, actif UNIQUEMENT pendant le dive (warp>0.3) -> starfield dense, 0 coût au calme
    var STREAK_N = lowPower ? 90 : 220;
    var streaks = [];
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

    // Échantillonneur cubic-bezier(.45,.08,.7,.45) (Newton-Raphson) — MÊME courbe que dive3d.
    // Pente initiale NON nulle (.08/.45) : la plongée démarre avec la vitesse résiduelle du settle de l'envol
    // (le rebond devient l'aspiration, jamais d'arrêt), puis sortie très raide (rush).
    var warpEase = (function () {
      var x1 = 0.45, y1 = 0.08, x2 = 0.7, y2 = 0.45;
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
      buildStars(); buildNebulae(); sizeFxCanvas(); initStreaks();
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
        warp = warpEase(wp);                    // ÉCHANTILLONNAGE EXACT de cubic-bezier(.45,.08,.7,.45) -> phase-lock parfait avec dive3d
        if (focalDrift) {                        // le FOYER du warp suit la sphère (recentrage dive-dx/dy) sur la MÊME courbe
          fx = fx0 + (fx1 - fx0) * warp; fy = fy0 + (fy1 - fy0) * warp;
        }
        if (wp >= 1) { warpRamping = false; warpTarget = 1; if (focalDrift) { fx = fx1; fy = fy1; focalDrift = false; } }
      } else {
        warp += (warpTarget - warp) * Math.min(0.07 * dt, 1);   // décélération douce (retour au calme)
      }

      // fond dégradé (base opaque) — gradient mis en cache
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

      drawNebulae();

      // étoiles
      var warping = warp > 0.02;
      var boost = warp > 1.02;                  // segment HYPERESPACE (warpTarget 1.35 après le franchissement de la balle)
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (warping) {
          // STARFIELD 3D (écran de veille Windows / Star Fox) : des POINTS d'étoiles foncent vers nous —
          // accélération radiale ∝ distance (perspective : plus près = plus vite), léger GROSSISSEMENT en
          // approchant, queue de mouvement ≤ 6px (lisibilité de la vitesse, PAS une traînée), puis recyclage
          // IMMÉDIAT près du foyer dès la sortie d'écran -> flux dense et continu SANS étoile de plus.
          var dx = s.x - fx, dy = s.y - fy;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          var ux = dx / d, uy = dy / d;            // direction radiale unitaire (balle -> extérieur)
          var sp = (d * 0.135 + 0.5) * warp * dt;  // vitesse de la tête : ∝ distance (+0.5 : le centre ne stagne pas)
          var nx = s.x + ux * sp, ny = s.y + uy * sp;
          var edge = d / (diag * 0.5); if (edge > 1) edge = 1;
          // taille perspective : petite au fond (près du foyer), jusqu'à ~3x en approchant du bord
          var pr = s.r * (0.55 + edge * 1.9) * (0.85 + warp * 0.3);
          var L = 2 + sp * 0.12; if (L > 6) L = 6; // queue TRÈS courte, plafonnée à 6px
          var al = Math.min(s.a * (0.30 + warp * 0.75) * (0.35 + 0.65 * edge), 1);
          // 1 stroke à bouts ronds = point + micro-queue (capsule) : lecture « étoile », coût d'un seul tracé
          ctx.strokeStyle = 'rgba(255,255,255,' + al + ')';
          ctx.lineWidth = pr * 2;
          ctx.beginPath(); ctx.moveTo(nx - ux * L, ny - uy * L); ctx.lineTo(nx, ny); ctx.stroke();
          if (boost) {                             // MIROIR au pic : chaque étoile dupliquée par symétrie centrale
            // -> densité du flux x2 SANS étoile de plus (1 tracé par étoile, transitoire ~800ms)
            ctx.strokeStyle = 'rgba(210,222,255,' + (al * 0.7) + ')';
            ctx.lineWidth = pr * 1.7;
            ctx.beginPath(); ctx.moveTo(fx * 2 - nx + ux * L, fy * 2 - ny + uy * L); ctx.lineTo(fx * 2 - nx, fy * 2 - ny); ctx.stroke();
          }
          s.x = nx; s.y = ny;
          if (nx < -12 || nx > W + 12 || ny < -12 || ny > H + 12) {   // recyclage RAPIDE au foyer -> densité du flux
            var an = rand(0, Math.PI * 2), rr = rand(2, 36);
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

      // ÉTOILES DE FLUX éphémères : 2e nappe de POINTS émise du foyer PENDANT le dive uniquement — densifie le
      // starfield (recyclage express dès la sortie d'écran), mêmes règles que les étoiles : point + queue ≤ 6px.
      if (warp > 0.3) {
        ctx.lineCap = 'round';
        for (var q = 0; q < streaks.length; q++) {
          var st = streaks[q];
          if (!st.active) { if (Math.random() < 0.5) spawnStreak(st); else continue; }
          var stsp = (st.d * 0.135 + 0.6) * warp * dt;       // accélération radiale (perspective)
          st.d += stsp;
          var hx = fx + st.ux * st.d, hy = fy + st.uy * st.d;
          if (hx < -12 || hx > W + 12 || hy < -12 || hy > H + 12) { st.active = false; continue; }  // recyclage immédiat
          var sedge = st.d / (diag * 0.5); if (sedge > 1) sedge = 1;
          var spr = (0.5 + sedge * 1.8) * (0.85 + warp * 0.3);        // grossissement en approchant
          var stL = 2 + stsp * 0.12; if (stL > 6) stL = 6;            // micro-queue plafonnée à 6px
          ctx.strokeStyle = 'rgba(226,234,255,' + Math.min(st.a * (0.25 + warp * 0.75), 1) * (0.35 + 0.65 * sedge) + ')';
          ctx.lineWidth = spr * 2;
          ctx.beginPath(); ctx.moveTo(hx - st.ux * stL, hy - st.uy * stL); ctx.lineTo(hx, hy); ctx.stroke();
        }
      } else if (streaks.length) {
        for (var qz = 0; qz < streaks.length; qz++) streaks[qz].active = false;
      }

      // LUEUR DU DÉBOUCHÉ : point de fuite lumineux au foyer pendant le rush (la lumière au bout du tunnel,
      // que le whiteout de sortie vient crever) — 1 gradient/frame, uniquement warp>0.45, 0 coût au calme
      if (warp > 0.45) {
        var glr = 40 + warp * 90;
        var gl = ctx.createRadialGradient(fx, fy, 0, fx, fy, glr);
        gl.addColorStop(0, 'rgba(255,255,255,' + (0.30 * Math.min(warp, 1.35)) + ')');
        gl.addColorStop(0.4, 'rgba(206,220,255,' + (0.14 * Math.min(warp, 1.35)) + ')');
        gl.addColorStop(1, 'rgba(206,220,255,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(fx, fy, glr, 0, 6.283); ctx.fill();
      }

      // étoiles filantes (désactivées ET purgées en warp : une filante de 120-220px pendant le rush = une « ligne »)
      if (!warping) {
        nextShoot -= dt * 16.67;
        if (nextShoot <= 0) { spawnShooter(); nextShoot = rand(2500, 5000); }
      } else if (shooters.length) shooters.length = 0;
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
      parts.length = 0; fx = cx; fy = cy; warpRamping = false; warpRampT0 = -1; focalDrift = false;
      salvoRect = null; salvo2Done = true;
      for (var i = 0; i < streaks.length; i++) streaks[i].active = false;
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
      // v peut dépasser 1 (BOOST hyperespace : traînées ∝ warp² -> plus longues/lumineuses, 0 étoile de plus).
      // Coupe toujours le ramp (sinon sa dernière frame écraserait warpTarget) ; si le foyer dérivait, il est posé à destination.
      warpTo: function (v) {
        if (warpRamping) { warpRamping = false; if (focalDrift) { fx = fx1; fy = fy1; } }
        focalDrift = false;
        warpTarget = v;
      },
      // démarre la montée accélérée du star-warp sur `dur` ms (verrouillée sur la même fenêtre que le zoom CSS).
      // (tx,ty) optionnels : le FOYER dérive de sa position actuelle vers (tx,ty) sur la même courbe -> cohérent avec le recentrage de la sphère
      warpRamp: function (dur, tx, ty) {
        warpRamping = true; warpRampDur = Math.max(1, dur || 900); warpRampT0 = -1; warpTarget = 1;
        if (typeof tx === 'number' && typeof ty === 'number' && isFinite(tx) && isFinite(ty)) {
          fx0 = fx; fy0 = fy; fx1 = tx; fy1 = ty; focalDrift = true;
        } else focalDrift = false;
      },
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
  // Position NORMALISÉE du CENTRE de la balle de golf (au-dessus du « xy ») dans la boîte du logo.
  // = centre exact de la bbox du disque dans le SVG (getBBox : 341.02..396.42 x 38.93..94.17 de 522.9x354.3)
  // — cohérent avec transform-origin 70.52%/18.78% du wrap (CSS) et avec le viewBox de golfball.svg.
  var PLANET_FX = 0.7052, PLANET_FY = 0.1878;
  // Diamètre de la balle / largeur du logo (55.4/522.9), majoré de 10% pour couvrir le dessin plat
  // jusqu'au pic du push (1.06 -> 1.14 = +7.5%) : la balle 3D remplace EXACTEMENT la balle dessinée.
  var BALL_W = (55.4 / 522.9) * 1.10;

  // --- Scène 3D « plongée dans la balle » : LA balle de golf du logo, seule — SANS anneau ni décor
  //     (on plonge dans une balle de golf, point). Créée dynamiquement (le HTML des 2 centres reste
  //     inchangé). perspective + translateZ = vraie profondeur (pas un aplat).
  //     Structure : .ball-x > .ball-y > .planet3d — les DEUX wrappers portent l'arc X/Y de l'ENVOL
  //     (profils d'easing différents -> vraie trajectoire COURBE, GPU only), la balle porte scale/dive,
  //     et .planet3d__tex porte la texture golfball SEULE -> les alvéoles tournent SANS entraîner
  //     l'ombrage ni le spéculaire (l'éclairage reste fixe = lecture « sphère qui roule »). ---
  var scene = null, planetEl = null, ballXEl = null, ballYEl = null;
  function buildScene() {
    if (scene || reduce) return;
    scene = document.createElement('div'); scene.className = 'scene3d'; scene.setAttribute('aria-hidden', 'true');
    ballXEl = document.createElement('div'); ballXEl.className = 'ball-x';
    ballYEl = document.createElement('div'); ballYEl.className = 'ball-y';
    planetEl = document.createElement('div'); planetEl.className = 'planet3d';
    var tex = document.createElement('span'); tex.className = 'planet3d__tex';   // alvéoles (spin indépendant)
    var spec = document.createElement('span'); spec.className = 'planet3d__spec';
    var core = document.createElement('span'); core.className = 'planet3d__core';  // cœur qui gonfle -> ENTRÉE dans la sphère -> raccord whiteout
    planetEl.appendChild(tex); planetEl.appendChild(spec); planetEl.appendChild(core);
    // (un seul vocabulaire de traversée : le STARFIELD de points canvas émis du même foyer que la balle
    //  -> lecture claire + gros gain GPU sur mobiles faibles, aucune paroi/anneau CSS)
    ballYEl.appendChild(planetEl); ballXEl.appendChild(ballYEl);
    scene.appendChild(ballXEl);
    document.body.appendChild(scene);
  }

  var timers = [];
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function toCard() {
    if (location.hash !== '#carte') history.pushState(null, '', '#carte');
    runIntro();
  }

  // Point balle (centre du disque au-dessus du « xy ») en coords écran, à l'instant T (le wrap est scalé pendant l'intro,
  // getBoundingClientRect reflète le transform -> toujours juste). L'origine de TOUS les transforms = ce point (70.52%/18.78%),
  // donc il ne bouge pas entre les phases : mesurer à l'ignition puis à la plongée donne le même point.
  function planetPoint() {
    var el = document.querySelector('.entry__logo');
    var rect = el ? el.getBoundingClientRect() : null;
    if (!rect || !rect.width) return null;
    return { rect: rect, x: rect.left + PLANET_FX * rect.width, y: rect.top + PLANET_FY * rect.height };
  }

  /* SÉQUENCE — une chaîne CAUSALE resserrée : AUCUNE pause, chaque beat MORD sur le suivant (~2,94s clic->carte).
     B0    0-280   la scène se vide : nom+bouton s'effacent, le logo s'avance (scale 1->1.06).
     B1   90-690   le REFLET vitré balaye G->D et ATTERRIT sur la balle de golf (cœur posé ~590), puis laisse
                   une BRAISE ~100ms qui s'éteint PENDANT l'ignition (la lumière est absorbée, pas coupée).
     B2  560-1020  IGNITION (mord la fin du glint) : la balle du logo devient une sphère 3D (pop overshoot +
                   flash-braise du halo) ; les lettres baissent à 80% ; push lent 1.06->1.14 (anticipation).
     B3  980-1640  ENVOL (mord la fin du push) : la balle S'ARRACHE et vient SE CENTRER plein cadre. Arc courbe
                   (kick d'anticipation, fronde, hook-in) sur 2 wrappers X/Y ; STRETCH dans le sens du mouvement
                   en plein vol puis SQUASH à l'arrivée (masse réelle) ; SPIN des alvéoles (texture seule : elle
                   ROULE) ; grossissement 1 -> ~5x ; derrière elle le logo SE DÉSAGRÈGE en éclats. Le settle se
                   termine en LÉGER REBOND OUVERT (x1.035) : il N'EST PAS amorti — c'est l'élan de la plongée.
     B4 1640-2490  PLONGÉE immédiate : dive3d reprend EXACTEMENT le rebond (0% = scale x1.035 -> aspiration),
                   translateZ à travers la balle, une seule courbe cubic-bezier(.45,.08,.7,.45) à pente initiale
                   non nulle — warp étoiles même fenêtre (850ms), FOYER = CENTRE ÉCRAN, cœur blanc = on perce.
     B5 2490-2939  HYPERESPACE : boost warp 1->1.35, plein écran. Points d'étoiles depuis le CENTRE (accélération
                   radiale ∝ distance, queue ≤ 6px), flux doublé par MIROIR + 2e nappe recyclée + lueur du débouché.
     B6 2840-3390  DÉBOUCHÉ : whiteout radial (pic ~2939 = 4ms après la pose de la carte : raccord au frame près).
     B7 2935-3630  ARRIVÉE : la carte se pose (settle 1.035->1), header descend, barre monte (follow-through). */
  function runIntro() {
    clearTimers();
    if (reduce || !Space) {                     // simple fondu court (aucun warp / zoom / dispersion)
      body.classList.remove('pre');
      return;
    }
    buildScene();
    var ballSize = 0, tcx = window.innerWidth / 2, tcy = Math.round(window.innerHeight * 0.46);
    body.classList.add('go');                   // B0 + B1 : la scène se vide, le glint voyage vers la balle

    // B2 — IGNITION (le cœur du glint touche la balle ~590 : la sphère naît SOUS la braise, 30ms avant le contact
    //      elle est encore quasi invisible -> lecture « le glint l'allume », zéro attente)
    at(560, function () {
      var p = planetPoint();
      if (p) {
        Space.setWarpOrigin(p.x, p.y);           // le foyer du warp = la balle (recentré à la plongée)
        if (scene && planetEl) {
          // balle 3D = MÊME dessin, MÊME taille (+10% pour couvrir le dessin plat jusqu'au pic du push 1.14)
          ballSize = Math.max(22, Math.round(p.rect.width * BALL_W));
          planetEl.style.width = ballSize + 'px'; planetEl.style.height = ballSize + 'px';
          planetEl.style.left = (p.x - ballSize / 2) + 'px';
          planetEl.style.top = (p.y - ballSize / 2) + 'px';
          scene.style.display = 'block';
        }
      }
      body.classList.add('arm');                 // ignite (sphère) + push lent (anticipation) + lettres à 80%
    });

    // B3 — ENVOL (mord la fin du push, ~40ms avant sa fin : l'anticipation se rompt en plein élan) :
    //      la balle s'arrache du logo et vient se centrer (arc + spin + grow + stretch/squash) ;
    //      le logo se désagrège en éclats et s'efface derrière elle. NB : l'origine des transforms du wrap
    //      = le point balle -> le mordre en plein push ne fausse AUCUNE mesure (le point ne bouge jamais).
    at(980, function () {
      var p = planetPoint();
      tcx = window.innerWidth / 2; tcy = Math.round(window.innerHeight * 0.46);   // où la balle se pose (centre optique)
      if (p) {
        Space.disintegrate(p.rect, p.x, p.y, p.rect.width * 0.15);   // le départ BRISE le logo (balle préservée)
        var dx = tcx - p.x, dy = tcy - p.y, dist = Math.hypot(dx, dy) || 1;
        // KICK de l'arc (point de passage à ~30% du vol) : recul le long du voyage (anticipation) +
        // forte composante PERPENDICULAIRE à la corde (côté extérieur écran) + biais vers le haut ->
        // vraie boucle en fronde, JAMAIS colinéaire au trajet. Bornés (petits/grands écrans).
        var ux = dx / dist, uy = dy / dist;                        // direction du voyage
        var px2 = -uy, py2 = ux;                                   // perpendiculaire...
        if (px2 * (p.x - tcx) < 0) { px2 = -px2; py2 = -py2; }     // ...orientée vers l'extérieur (côté de la balle)
        var k1 = Math.min(26, dist * 0.18);                        // recul (anticipation)
        var k2 = Math.max(30, Math.min(64, dist * 0.5));           // ampleur de la fronde (courbure)
        var kx = -ux * k1 + px2 * k2, ky = -uy * k1 + py2 * k2 - 24;
        if (ballXEl) { ballXEl.style.setProperty('--tx', dx + 'px'); ballXEl.style.setProperty('--kx', kx.toFixed(1) + 'px'); }
        if (ballYEl) { ballYEl.style.setProperty('--ty', dy + 'px'); ballYEl.style.setProperty('--ky', ky.toFixed(1) + 'px'); }
        if (planetEl && ballSize) {              // plein cadre : diamètre final ≈ 46% du petit côté
          var grow = (Math.min(window.innerWidth, window.innerHeight) * 0.46) / ballSize;
          planetEl.style.setProperty('--grow', grow.toFixed(3));
        }
      }
      body.style.setProperty('--flash-x', tcx + 'px');               // le whiteout éclatera LÀ où la balle se pose
      body.style.setProperty('--flash-y', tcy + 'px');
      body.classList.add('travel');
    });

    // B4 — PLONGÉE IMMÉDIATE (1640 = fin exacte de l'envol : ballGrow finit en rebond OUVERT x1.035 et
    //      dive3d reprend ce rebond à son 0% -> la balle ne pose JAMAIS, le settle EST l'élan de l'aspiration)
    at(1640, function () {
      Space.setWarpOrigin(tcx, tcy);             // FOYER du warp = centre écran (là où la balle arrive)
      body.classList.add('zoom');
      Space.warpRamp(850);                       // même fenêtre + même courbe que dive3d (.85s)
    });

    // B5 — HYPERESPACE : la balle est franchie (fin du dive), l'écran ENTIER est le couloir.
    // Boost 1 -> 1.35 (approche exponentielle ~230ms de constante = montée en vitesse PUIS pic tenu) :
    // traînées plus longues/lumineuses, doublées par miroir. ~450ms ressenties avant le pic du débouché.
    at(2490, function () { Space.warpTo(1.35); });

    // B6 — DÉBOUCHÉ : pic du whiteout (montée 18% de .55s ≈ 99ms) à ~2939 = 4ms après la pose de la carte
    at(2840, function () { body.classList.add('flash'); });
    at(2935, function () {                       // B7 — carte révélée SOUS le blanc plein + settle/stagger d'arrivée
      body.classList.remove('pre');
      body.classList.add('land');
    });
    at(3050, function () { Space.warpTo(0); });  // décélération de l'hyperespace après le débouché (vitesse résiduelle)
    at(3390, function () { body.classList.remove('flash'); });
    at(3700, function () {                       // nettoyage (landSettle fini à ~3535)
      body.classList.remove('go', 'arm', 'travel', 'zoom', 'land');
      Space.reset();
      if (scene) scene.style.display = 'none';
    });
  }

  function toEntry() {
    clearTimers();
    Space && Space.warpTo(0);
    Space && Space.reset();
    body.classList.remove('go', 'arm', 'travel', 'zoom', 'warp', 'flash', 'dissolve', 'land');
    if (scene) scene.style.display = 'none';
    body.classList.add('pre');
  }

  if (open) open.addEventListener('click', toCard);

  window.addEventListener('popstate', function () {
    if (location.hash === '#carte') { clearTimers(); body.classList.remove('pre', 'go', 'arm', 'travel', 'zoom', 'warp', 'flash', 'dissolve', 'land'); Space && Space.reset(); if (scene) scene.style.display = 'none'; }
    else toEntry();
  });

  // état initial (deep-link vers #carte)
  if (location.hash === '#carte') body.classList.remove('pre');
})();
