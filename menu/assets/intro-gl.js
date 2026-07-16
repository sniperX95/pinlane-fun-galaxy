/* Fun Galaxy : INTRO 3D WebGL : vraie sphère de golf éclairée (normal map d'alvéoles bakée),
   starfield volumétrique en points GL (taille ∝ profondeur, scintillement), bloom post-process
   (bright-pass 1/4 res + blur gaussien séparable + composite additif), caméra qui PLONGE dans la
   balle (travelling + FOV qui s'ouvre), mouvement 100% physique (springs amortis, masse, rolling).

   Self-contained : zéro dépendance, zéro requête externe. Utilisé par viewer.js UNIQUEMENT pour
   la séquence d'intro : au repos et sur la page carte, seul le canvas 2D tourne (le contexte GL
   est libéré à la fin : dispose() -> WEBGL_lose_context + canvas retiré du DOM).

   FALLBACK : si WebGL indisponible (ou ?nogl pour test), createIntro() rend null et viewer.js
   garde sa séquence CSS/canvas existante. prefers-reduced-motion : jamais initialisé.

   TIMELINE UNIQUE dans le rAF : cues (t, fn) + intégrateur à PAS FIXE 120Hz -> déterministe.
   Temps injectable : intro.seek(ms) rejoue cues + physique de 0 à ms et rend UNE frame
   (vérification headless : geler/seeker aux instants clés, capturer, échantillonner les pixels). */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var forceOff = /[?&#]nogl\b/.test(location.search + ' ' + location.hash);
  var lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
                 (navigator.deviceMemory && navigator.deviceMemory <= 4);
  var DPR_CAP = lowPower ? 1.35 : 1.5;

  /* ---------- easing : cubic-bezier(.45,.08,.7,.45), MÊME courbe que le warp 2D (phase-lock) ---------- */
  function makeBezier(x1, y1, x2, y2) {
    function bez(t, a, b) { var A = 1 - 3 * b + 3 * a, B = 3 * b - 6 * a, C = 3 * a; return ((A * t + B) * t + C) * t; }
    function slope(t, a, b) { var A = 1 - 3 * b + 3 * a, B = 3 * b - 6 * a, C = 3 * a; return (3 * A * t + 2 * B) * t + C; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 6; i++) { var d = slope(t, x1, x2); if (d > -1e-6 && d < 1e-6) break; t -= (bez(t, x1, x2) - x) / d; }
      if (t < 0) t = 0; else if (t > 1) t = 1;
      return bez(t, y1, y2);
    };
  }
  var diveEase = makeBezier(0.45, 0.08, 0.7, 0.45);

  /* ---------- mini-math : mat4/mat3/quaternion (juste ce qu'il faut) ---------- */
  function perspective(fovYdeg, aspect, near, far) {
    var f = 1 / Math.tan(fovYdeg * Math.PI / 360), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mat4RotZ(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  function mat4Mul(a, b) {         // a*b (colonnes)
    var o = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function mat3Mul(a, b) {
    var o = new Array(9);
    for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) {
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
    return o;
  }
  function quatMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
      a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }
  function quatAxisAngle(ax, ay, az, ang) {
    var s = Math.sin(ang / 2);
    return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
  }
  function quatToMat3(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [1 - (yy + zz), xy + wz, xz - wy, xy - wz, 1 - (xx + zz), yz + wx, xz + wy, yz - wx, 1 - (xx + yy)];
  }

  /* ---------- shaders ---------- */
  var VS_BALL = [
    'attribute vec3 aPos;',
    'attribute vec2 aUv;',
    'uniform mat4 uProj;',
    'uniform mat4 uModel;',
    'uniform mat3 uNrm;',
    'varying vec3 vN; varying vec3 vP; varying vec2 vUv;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vP = w.xyz; vN = uNrm * aPos; vUv = aUv;',
    '  gl_Position = uProj * w;',
    '}'
  ].join('\n');

  /* Éclairage : key light chaude haut-gauche (cohérente avec le dessin du logo), wrap diffuse doux,
     spéculaire Blinn-Phong net, ambiance aubergine (#241833 éclairci), rim fresnel teal/violet TRÈS
     subtil (couleurs de marque), AO dans les alvéoles. Faces INTÉRIEURES (traversée) : tunnel de
     lumière au fond -> "on perce la balle", raccord au whiteout. Sortie PRÉMULTIPLIÉE (col*a, a). */
  var FS_BALL = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vP; varying vec2 vUv;',
    'uniform sampler2D uMap;',
    'uniform vec3 uLight;',
    'uniform float uGlow;',      // émissif d'ignition / braise
    'uniform float uCore;',      // progression de la plongée (tunnel intérieur)
    'uniform float uFade;',      // fondu d'apparition
    'uniform float uBump;',
    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(-vP);',
    '  if (!gl_FrontFacing) {',
    '    vec3 D = normalize(vP);',
    '    float ahead = max(-D.z, 0.0);',                                 // regarde vers le fond du tunnel
    '    float hot = pow(ahead, 14.0) * uCore;',                         // cône de lumière SERRÉ (un seul climax : la sortie)
    '    vec3 icol = mix(vec3(0.05, 0.033, 0.09), vec3(0.62, 0.98, 0.90), min(hot * 1.25, 1.0));',
    '    icol += vec3(1.0, 1.0, 0.98) * pow(ahead, 60.0) * uCore * 2.4;', // point blanc du débouché
    '    float aIn = uFade * (1.0 - smoothstep(0.72, 0.95, uCore));',    // la paroi SE DISSOUT -> crossfade vers le starfield
    '    gl_FragColor = vec4(icol * aIn, aIn);',
    '    return;',
    '  }',
    '  vec4 tex = texture2D(uMap, vUv);',
    '  vec3 T = cross(vec3(0.0, 1.0, 0.0), N);',
    '  float tl = max(length(T), 1e-4); T /= tl;',
    '  vec3 B = cross(N, T);',
    '  vec2 tn = (tex.rg - 0.5) * 2.0;',
    '  vec3 Np = normalize(N + (T * tn.x + B * tn.y) * uBump);',
    '  float ao = mix(1.0, tex.a, 0.9);',
    '  float wrapD = clamp((dot(Np, uLight) + 0.35) / 1.35, 0.0, 1.0);',
    '  wrapD = pow(wrapD, 1.25);',
    '  vec3 albedo = vec3(0.93, 0.94, 0.97);',
    '  vec3 amb = vec3(0.17, 0.13, 0.22);',                              // ambiance aubergine (marque)
    '  vec3 key = vec3(1.05, 1.01, 0.94);',                              // key light légèrement chaude
    '  vec3 col = albedo * (amb + key * wrapD) * ao;',
    '  vec3 H = normalize(uLight + V);',
    '  float spec = pow(max(dot(Np, H), 0.0), 130.0);',
    '  col += vec3(1.0, 0.99, 0.95) * spec * (0.35 + 0.95 * ao);',       // spéculaire net (cassé par les alvéoles)
    '  float f = pow(1.0 - max(dot(N, V), 0.0), 2.6);',
    '  vec3 rim = mix(vec3(0.40, 0.73, 0.67), vec3(0.58, 0.26, 0.57), clamp(0.5 + 0.8 * N.x, 0.0, 1.0));',
    '  col += rim * f * 0.30;',                                          // rim teal/violet subtil
    '  col += vec3(1.0, 0.98, 0.95) * uGlow * (0.42 + 0.9 * f);',        // braise d\'ignition (le bloom la prend)
    '  float edge = smoothstep(0.0, 0.05, dot(N, V)) * uFade;',          // silhouette adoucie ~1px
    '  gl_FragColor = vec4(col * edge, edge);',
    '}'
  ].join('\n');

  /* Starfield : UN draw call de gl.POINTS. Position 3D dans un tube autour de l'axe de vol,
     recyclage par fract(), taille ∝ 1/distance (vraie perspective), scintillement par étoile,
     fondu près du plan caméra. Rendu ADDITIF (alpha 0 -> composite additif sur la page). */
  var VS_STARS = [
    'attribute vec4 aSeed;',
    'uniform mat4 uProj;',
    'uniform float uTime;',      // secondes (sim)
    'uniform float uPhase;',     // avancement intégré du flux (CPU, ∝ warp)
    'uniform float uWarp;',
    'uniform float uStarA;',
    'uniform vec2 uFocal;',      // offset NDC du point de fuite
    'uniform float uPx;',        // échelle DPR
    'varying vec3 vCol;',
    'void main(){',
    '  float an = aSeed.x * 6.28318;',
    '  float rad = 0.4 + pow(aSeed.y, 1.6) * 7.5;',
    '  float z = fract(aSeed.z + uPhase * (0.55 + 0.9 * aSeed.w));',
    '  float dist = mix(34.0, 0.55, z);',
    '  vec3 p = vec3(cos(an) * rad, sin(an) * rad, -dist);',
    '  vec4 cp = uProj * vec4(p, 1.0);',
    '  cp.xy += uFocal * cp.w;',
    '  gl_Position = cp;',
    '  float tw = 0.72 + 0.28 * sin(uTime * (2.0 + aSeed.w * 6.0) + aSeed.x * 40.0);',  // scintillement
    '  float nearF = smoothstep(1.0, 0.86, z);',
    '  float farF = smoothstep(0.0, 0.16, z);',
    '  float b = uStarA * tw * farF * nearF * (0.30 + 0.70 * z) * (0.45 + uWarp * 0.75);',
    '  float tsel = fract(aSeed.w * 7.31);',
    '  vec3 tint = vec3(1.0);',
    '  if (tsel < 0.16) tint = vec3(0.62, 0.93, 0.87);',                 // quelques étoiles teal
    '  else if (tsel > 0.84) tint = vec3(0.85, 0.66, 0.93);',            // ... et violettes (marque)
    '  vCol = tint * min(b, 1.25);',
    '  gl_PointSize = clamp((2.4 + aSeed.w * 3.2) * (3.4 / dist) * uPx * (1.0 + uWarp * 0.55), 1.0, 24.0);',
    '}'
  ].join('\n');
  var FS_STARS = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'void main(){',
    '  vec2 d = gl_PointCoord - 0.5;',
    '  float r2 = dot(d, d);',
    '  float a = exp(-r2 * 14.0) * smoothstep(0.25, 0.05, r2);',         // point doux, cœur brillant
    '  gl_FragColor = vec4(vCol * a, 0.0);',
    '}'
  ].join('\n');

  var VS_QUAD = [
    'attribute vec2 aPos;',
    'varying vec2 vUv; varying vec2 vNdc;',
    'void main(){ vUv = aPos * 0.5 + 0.5; vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  /* Lueur du débouché : halo radial additif au point de fuite (la lumière au bout du tunnel) */
  var FS_GLOW = [
    'precision mediump float;',
    'varying vec2 vNdc;',
    'uniform vec2 uC; uniform float uI; uniform float uK; uniform float uAspect;',
    'void main(){',
    '  vec2 d = (vNdc - uC) * vec2(uAspect, 1.0);',
    '  float g = exp(-dot(d, d) * uK);',
    '  vec3 col = mix(vec3(0.80, 0.86, 1.0), vec3(1.0), g * 0.6) * g * uI;',
    '  gl_FragColor = vec4(col, 0.0);',
    '}'
  ].join('\n');

  var FS_BRIGHT = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex; uniform float uThresh; uniform float uGain;',
    'void main(){',
    '  vec3 c = texture2D(uTex, vUv).rgb;',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  float k = max(l - uThresh, 0.0) / max(l, 1e-4);',
    '  gl_FragColor = vec4(c * k * uGain, 1.0);',
    '}'
  ].join('\n');

  var FS_BLUR = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex; uniform vec2 uDir;',                        // uDir = texel * axe
    'void main(){',
    '  vec3 c = texture2D(uTex, vUv).rgb * 0.227027;',
    '  c += texture2D(uTex, vUv + uDir * 1.3846).rgb * 0.3162162;',
    '  c += texture2D(uTex, vUv - uDir * 1.3846).rgb * 0.3162162;',
    '  c += texture2D(uTex, vUv + uDir * 3.2308).rgb * 0.0702703;',
    '  c += texture2D(uTex, vUv - uDir * 3.2308).rgb * 0.0702703;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var FS_COPY = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex; uniform float uI;',
    'void main(){ vec4 c = texture2D(uTex, vUv); gl_FragColor = vec4(c.rgb * uI, c.a); }'
  ].join('\n');

  /* ---------- normal map d'alvéoles bakée (hauteur -> normales tangentes + AO), déterministe ---------- */
  function bakeDimpleMap(gl) {
    var TW = lowPower ? 512 : 1024, TH = TW >> 1;
    var height = new Float32Array(TW * TH);
    var N = 320, GA = Math.PI * (3 - Math.sqrt(5));                      // spirale de Fibonacci
    var aRad = 0.075;                                                    // rayon angulaire d'une alvéole
    for (var i = 0; i < N; i++) {
      var y = 1 - (i + 0.5) * 2 / N;                                     // -1..1
      var lat = Math.asin(y);
      if (Math.abs(lat) > 1.32) continue;                                // pôles : distorsion trop forte
      var lon = (i * GA) % (Math.PI * 2);
      var cy = (0.5 - lat / Math.PI) * TH;
      var cx = (lon / (Math.PI * 2)) * TW;
      var rv = (aRad / Math.PI) * TH;
      var ru = rv / Math.cos(lat);
      var x0 = Math.floor(cx - ru - 1), x1 = Math.ceil(cx + ru + 1);
      var y0 = Math.max(0, Math.floor(cy - rv - 1)), y1 = Math.min(TH - 1, Math.ceil(cy + rv + 1));
      for (var py = y0; py <= y1; py++) {
        for (var px = x0; px <= x1; px++) {
          var dx = (px - cx) / ru, dy = (py - cy) / rv;
          var d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          var wx = ((px % TW) + TW) % TW;                                // wrap en longitude
          var depth = Math.pow(1 - d2, 1.15);                            // bol sphérique, bord net
          var idx = py * TW + wx;
          if (depth > height[idx]) height[idx] = depth;                  // profondeur (positif = creux)
        }
      }
    }
    var data = new Uint8Array(TW * TH * 4);
    var S = 2.6;                                                         // force des pentes
    for (var vy = 0; vy < TH; vy++) {
      for (var vx = 0; vx < TW; vx++) {
        var iC = vy * TW + vx;
        var hl = height[vy * TW + ((vx - 1 + TW) % TW)], hr = height[vy * TW + ((vx + 1) % TW)];
        var hu = height[Math.max(0, vy - 1) * TW + vx], hd = height[Math.min(TH - 1, vy + 1) * TW + vx];
        // hauteur de surface = -creux : pente su = d(surface)/du = -(hr-hl)/2 ...
        var su = (hr - hl) * 0.5 * S, sv = (hd - hu) * 0.5 * S;
        // tangente T ∝ +u ; bitangente B = cross(N,T) pointe vers -v (le haut de la texture)
        var nx = su, ny = -sv, nz = 1;
        var il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        var o = iC * 4;
        data[o] = Math.round((nx * il * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * il * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(height[iC] * 255);
        data[o + 3] = Math.round((1 - height[iC] * 0.55) * 255);         // AO au fond des alvéoles
      }
    }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /* ---------- géométrie sphère (lat/long, ~3.7k tris, seam dupliquée pour l'UV) ---------- */
  function buildSphere(gl) {
    var RINGS = 36, COLS = 52;
    var verts = [], idx = [];
    for (var r = 0; r <= RINGS; r++) {
      var lat = Math.PI / 2 - (r / RINGS) * Math.PI;                     // +90° -> -90°
      var cl = Math.cos(lat), sl = Math.sin(lat);
      for (var c = 0; c <= COLS; c++) {
        var lon = (c / COLS) * Math.PI * 2;
        verts.push(cl * Math.sin(lon), sl, cl * Math.cos(lon), c / COLS, r / RINGS);
      }
    }
    for (var rr = 0; rr < RINGS; rr++) {
      for (var cc = 0; cc < COLS; cc++) {
        var a = rr * (COLS + 1) + cc, b = a + COLS + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return { vbo: vbo, ibo: ibo, count: idx.length };
  }

  /* ---------- helpers GL ---------- */
  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }
  function program(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc), fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
    return p;
  }
  function makeFbo(gl, w, h, depth) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) return null;
    return { fb: fb, tex: tex, rb: rb, w: w, h: h };
  }

  /* ================================================================
     createIntro() : construit tout ; null si le GL n'est pas dispo
     ================================================================ */
  function createIntro() {
    if (reduce || forceOff || !window.WebGLRenderingContext) return null;
    var canvas = document.createElement('canvas');
    canvas.className = 'glintro';
    canvas.setAttribute('aria-hidden', 'true');
    var OPTS = { alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    var gl = null;
    try { gl = canvas.getContext('webgl', OPTS) || canvas.getContext('experimental-webgl', OPTS); } catch (e) { gl = null; }
    if (!gl) return null;

    var pBall = program(gl, VS_BALL, FS_BALL);
    var pStar = program(gl, VS_STARS, FS_STARS);
    var pGlow = program(gl, VS_QUAD, FS_GLOW);
    var pBright = program(gl, VS_QUAD, FS_BRIGHT);
    var pBlur = program(gl, VS_QUAD, FS_BLUR);
    var pCopy = program(gl, VS_QUAD, FS_COPY);
    if (!pBall || !pStar || !pGlow || !pBright || !pBlur || !pCopy) {
      var lc0 = gl.getExtension('WEBGL_lose_context'); if (lc0) lc0.loseContext();
      return null;
    }

    var sphere = buildSphere(gl);
    var dimpleTex = bakeDimpleMap(gl);

    // étoiles : seeds DÉTERMINISTES (LCG) -> flux reproductible en test comme en prod
    var STAR_N = lowPower ? 520 : 900;
    var seeds = new Float32Array(STAR_N * 4);
    var rngS = 1234567;
    function rng() { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; }
    for (var i = 0; i < STAR_N * 4; i++) seeds[i] = rng();
    var starVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starVbo);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    var quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // uniforms/attribs lookup
    function U(p, n) { return gl.getUniformLocation(p, n); }
    function A(p, n) { return gl.getAttribLocation(p, n); }
    var uB = { proj: U(pBall, 'uProj'), model: U(pBall, 'uModel'), nrm: U(pBall, 'uNrm'), map: U(pBall, 'uMap'), light: U(pBall, 'uLight'), glow: U(pBall, 'uGlow'), core: U(pBall, 'uCore'), fade: U(pBall, 'uFade'), bump: U(pBall, 'uBump') };
    var aB = { pos: A(pBall, 'aPos'), uv: A(pBall, 'aUv') };
    var uS = { proj: U(pStar, 'uProj'), time: U(pStar, 'uTime'), phase: U(pStar, 'uPhase'), warp: U(pStar, 'uWarp'), starA: U(pStar, 'uStarA'), focal: U(pStar, 'uFocal'), px: U(pStar, 'uPx') };
    var aS = A(pStar, 'aSeed');
    var uG = { c: U(pGlow, 'uC'), i: U(pGlow, 'uI'), k: U(pGlow, 'uK'), aspect: U(pGlow, 'uAspect') };
    var aG = A(pGlow, 'aPos');
    var uBr = { tex: U(pBright, 'uTex'), thresh: U(pBright, 'uThresh'), gain: U(pBright, 'uGain') };
    var aBr = A(pBright, 'aPos');
    var uBl = { tex: U(pBlur, 'uTex'), dir: U(pBlur, 'uDir') };
    var aBl = A(pBlur, 'aPos');
    var uC = { tex: U(pCopy, 'uTex'), i: U(pCopy, 'uI') };
    var aC = A(pCopy, 'aPos');

    /* ----- taille / FBOs ----- */
    var W = 0, H = 0, DPR = 1, fboScene = null, fboA = null, fboB = null;
    var BLOOM_DIV = lowPower ? 6 : 4;
    function sizeAll() {
      DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      W = window.innerWidth; H = window.innerHeight;
      var pw = Math.max(2, Math.round(W * DPR)), ph = Math.max(2, Math.round(H * DPR));
      if (canvas.width === pw && canvas.height === ph && fboScene) return;
      canvas.width = pw; canvas.height = ph;
      if (fboScene) { gl.deleteFramebuffer(fboScene.fb); gl.deleteTexture(fboScene.tex); if (fboScene.rb) gl.deleteRenderbuffer(fboScene.rb); }
      if (fboA) { gl.deleteFramebuffer(fboA.fb); gl.deleteTexture(fboA.tex); }
      if (fboB) { gl.deleteFramebuffer(fboB.fb); gl.deleteTexture(fboB.tex); }
      fboScene = makeFbo(gl, pw, ph, true);
      var bw = Math.max(16, Math.round(pw / BLOOM_DIV)), bh = Math.max(16, Math.round(ph / BLOOM_DIV));
      fboA = makeFbo(gl, bw, bh, false);
      fboB = makeFbo(gl, bw, bh, false);
    }
    sizeAll();
    if (!fboScene || !fboA || !fboB) {                                   // FBO impossible -> fallback CSS
      var lc1 = gl.getExtension('WEBGL_lose_context'); if (lc1) lc1.loseContext();
      return null;
    }

    /* ================================================================
       ÉTAT & PHYSIQUE (pas fixe 120Hz : déterministe, seekable)
       ================================================================ */
    var PH = { HIDDEN: 0, IGNITE: 1, FLIGHT: 2, DIVE: 3, HYPER: 4 };
    var D0 = 10;                                                         // profondeur d'ancrage de la balle
    var FOV0 = 55;
    var st = null;
    function resetState() {
      st = {
        phase: PH.HIDDEN,
        wpp: 1,                                                          // world-per-pixel à D0 (posé à l'ignition)
        x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0,                          // spring position (monde)
        r: 0.1, vr: 0, tr: 0.1,                                          // spring rayon (monde)
        posW: 8.5, posZ: 0.62,                                           // ω/ζ du spring position
        radW: 24, radZ: 0.55,
        q: [0, 0, 0, 1],                                                 // orientation (quaternion)
        rollAxis: [0.25, 0.95, 0.15], rollW: 0.5,                        // spin résiduel
        glow: 0,
        warp: 0, starPhase: 0,
        diveMs: -1, floodMs: -1,
        z: -D0, fov: FOV0, roll: 0, core: 0, fade: 0,
        focalNdc: [0, 0.08],
        simMs: 0
      };
    }
    resetState();

    var SIM_DT = 1 / 120;
    function step(dt) {
      var s = st;
      s.simMs += dt * 1000;
      // spring position (semi-implicite : stable et vivant)
      var w2 = s.posW * s.posW;
      s.vx += (-w2 * (s.x - s.tx) - 2 * s.posZ * s.posW * s.vx) * dt;
      s.vy += (-w2 * (s.y - s.ty) - 2 * s.posZ * s.posW * s.vy) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      // spring rayon
      var rw2 = s.radW * s.radW;
      s.vr += (-rw2 * (s.r - s.tr) - 2 * s.radZ * s.radW * s.vr) * dt;
      s.r += s.vr * dt;
      // fade d'apparition
      if (s.phase >= PH.IGNITE && s.fade < 1) s.fade = Math.min(1, s.fade + dt / 0.09);
      // braise d'ignition : décroissance exponentielle
      s.glow *= Math.exp(-dt / 0.16);
      // ROTATION : rolling ∝ vitesse (la balle roule le long de son voyage) + spin résiduel
      var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (sp > 1e-5 && s.r > 1e-4) {
        var invSp = 1 / sp;
        // axe ⟂ au mouvement dans le plan écran : rolling naturel
        var ax = s.vy * invSp, ay = -s.vx * invSp;
        var wRoll = Math.min(sp / s.r * 0.12, 7);
        s.q = quatMul(quatAxisAngle(ax, ay, 0, wRoll * dt), s.q);
      }
      s.q = quatMul(quatAxisAngle(s.rollAxis[0], s.rollAxis[1], s.rollAxis[2], s.rollW * dt), s.q);
      // renormalise (dérive numérique)
      var qn = 1 / Math.sqrt(s.q[0] * s.q[0] + s.q[1] * s.q[1] + s.q[2] * s.q[2] + s.q[3] * s.q[3] || 1);
      s.q[0] *= qn; s.q[1] *= qn; s.q[2] *= qn; s.q[3] *= qn;
      // PLONGÉE : caméra DANS la balle, z, FOV qui s'ouvre (vertige), roll, tunnel
      if (s.phase >= PH.DIVE && s.diveMs >= 0) {
        var e = diveEase(Math.min((s.simMs - s.diveMs) / 850, 1));
        var R = s.r;
        s.z = -D0 + (D0 + 1.35 * R) * e;                                 // la surface FRANCHIT le plan caméra
        s.fov = FOV0 + 30 * e * e;                                       // le FOV s'ouvre
        s.roll = -0.10 * e;                                              // léger roulis organique
        s.core = e;
        if (s.phase === PH.HYPER) {
          s.warp += (1.35 - s.warp) * (1 - Math.exp(-dt / 0.23));        // boost hyperespace
        } else {
          s.warp = e;                                                    // même courbe que le zoom (phase-lock)
        }
      }
      s.starPhase += (0.012 + s.warp * s.warp * 0.55) * dt;              // flux intégré (pas de saut si warp varie)
    }

    /* ----- cues (timeline unique) ----- */
    var cues = [], cueIdx = 0;
    function fireCues(tMs) {
      while (cueIdx < cues.length && cues[cueIdx].t <= tMs) { cues[cueIdx].fn(); cueIdx++; }
    }

    /* ----- conversions écran <-> monde ----- */
    function scrToWorld(sx, sy) { return [(sx - W / 2) * st.wpp, (H / 2 - sy) * st.wpp]; }

    /* ----- rendu ----- */
    function ballMatrices() {
      var s = st;
      // stretch dans le sens du mouvement (masse : s'étire en vol, l'oscillation du settle la fait respirer)
      var spd = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      var spdPx = spd / (s.wpp || 1);
      var k = Math.min(spdPx / 2600, 0.22);
      var phi = Math.atan2(s.vy, s.vx);
      var cP = Math.cos(phi), sP = Math.sin(phi);
      var sx = 1 + k, syz = 1 - k * 0.5;
      // A = Rz(phi) * diag(sx,syz,syz) * Rz(-phi) * Rq   (échelle uniforme r appliquée à part)
      var Rv = [cP, sP, 0, -sP, cP, 0, 0, 0, 1];
      var RvT = [cP, -sP, 0, sP, cP, 0, 0, 0, 1];
      var Sm = [sx, 0, 0, 0, syz, 0, 0, 0, syz];
      var Rq = quatToMat3(s.q);
      var A3 = mat3Mul(mat3Mul(mat3Mul(Rv, Sm), RvT), Rq);
      var Si = [1 / sx, 0, 0, 0, 1 / syz, 0, 0, 0, 1 / syz];
      var N3 = mat3Mul(mat3Mul(mat3Mul(Rv, Si), RvT), Rq);               // inverse-transpose (rotations orthogonales)
      var r = s.r;
      var model = [
        A3[0] * r, A3[1] * r, A3[2] * r, 0,
        A3[3] * r, A3[4] * r, A3[5] * r, 0,
        A3[6] * r, A3[7] * r, A3[8] * r, 0,
        s.x, s.y, s.z, 1
      ];
      return { model: model, nrm: N3 };
    }

    function bloomAmount() {
      var s = st;
      var amt = 0.5 + s.glow * 0.9;                                      // braise d'ignition -> pic de bloom
      if (s.phase >= PH.DIVE) amt = 0.55 + s.core * 0.9;
      if (s.phase >= PH.HYPER) amt = 1.35;
      if (s.floodMs >= 0) {                                              // whiteout : le bloom inonde
        var f = Math.min((s.simMs - s.floodMs) / 140, 1);
        amt += f * 1.3;
      }
      return amt;
    }

    function render() {
      var s = st;
      sizeAll();
      if (s.phase === PH.HIDDEN) {                                       // rien à montrer : canvas transparent
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      var proj = perspective(s.fov, W / H, 0.05, 60);
      if (s.roll !== 0) proj = mat4Mul(proj, mat4RotZ(s.roll));

      // ---- PASSE 1 : scène -> FBO ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboScene.fb);
      gl.viewport(0, 0, fboScene.w, fboScene.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var ballVisible = s.fade > 0.001 && (s.z - s.r) < 0.06;             // cachée une fois entièrement franchie
      var piercing = s.core > 0.7;                                        // traversée : la paroi se dissout
      var starA = Math.min(s.warp * 1.5, 1);

      function drawBall() {
        var m = ballMatrices();
        gl.enable(gl.DEPTH_TEST); gl.depthMask(!piercing);               // paroi translucide : ne masque plus le flux
        gl.disable(gl.CULL_FACE);                                        // faces intérieures = tunnel
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pBall);
        gl.uniformMatrix4fv(uB.proj, false, proj);
        gl.uniformMatrix4fv(uB.model, false, m.model);
        gl.uniformMatrix3fv(uB.nrm, false, m.nrm);
        gl.uniform3f(uB.light, -0.5, 0.62, 0.605);                       // key haut-gauche, vers la caméra
        gl.uniform1f(uB.glow, s.glow);
        gl.uniform1f(uB.core, s.core);
        gl.uniform1f(uB.fade, s.fade);
        gl.uniform1f(uB.bump, 0.9);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dimpleTex);
        gl.uniform1i(uB.map, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sphere.vbo);
        gl.enableVertexAttribArray(aB.pos);
        gl.vertexAttribPointer(aB.pos, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(aB.uv);
        gl.vertexAttribPointer(aB.uv, 2, gl.FLOAT, false, 20, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphere.ibo);
        gl.drawElements(gl.TRIANGLES, sphere.count, gl.UNSIGNED_SHORT, 0);
        gl.disableVertexAttribArray(aB.pos);
        gl.disableVertexAttribArray(aB.uv);
        gl.depthMask(true);
      }
      function drawGlow(cxN, cyN, gi, gk) {                              // halo radial additif (braise / tunnel)
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        gl.useProgram(pGlow);
        gl.uniform2f(uG.c, cxN, cyN);
        gl.uniform1f(uG.i, gi);
        gl.uniform1f(uG.k, gk);
        gl.uniform1f(uG.aspect, W / H);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.enableVertexAttribArray(aG);
        gl.vertexAttribPointer(aG, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(aG);
      }
      function drawStarsGlow() {
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);           // additif, alpha du fond conservé
        gl.useProgram(pStar);
        gl.uniformMatrix4fv(uS.proj, false, proj);
        gl.uniform1f(uS.time, s.simMs / 1000);
        gl.uniform1f(uS.phase, s.starPhase);
        gl.uniform1f(uS.warp, s.warp);
        gl.uniform1f(uS.starA, starA);
        gl.uniform2f(uS.focal, s.focalNdc[0], s.focalNdc[1]);
        gl.uniform1f(uS.px, DPR);
        gl.bindBuffer(gl.ARRAY_BUFFER, starVbo);
        gl.enableVertexAttribArray(aS);
        gl.vertexAttribPointer(aS, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, STAR_N);
        gl.disableVertexAttribArray(aS);

        // lueur du débouché (au point de fuite)
        var gi = 0.35 * s.warp * s.warp;
        var gk = 22;
        if (s.floodMs >= 0) { var ff = Math.min((s.simMs - s.floodMs) / 140, 1); gi += ff * 2.4; gk = 22 - ff * 14; }
        drawGlow(s.focalNdc[0], s.focalNdc[1], gi, gk);
      }

      // Ordre : balle OPAQUE d'abord (occlusion correcte du flux), mais pendant la TRAVERSÉE la
      // paroi devient translucide : étoiles d'abord, paroi fondue PAR-DESSUS (crossfade réel).
      if (piercing) {
        if (starA > 0.004) drawStarsGlow();
        if (ballVisible) drawBall();
      } else {
        if (ballVisible) drawBall();
        if (starA > 0.004) drawStarsGlow();
      }
      // BRAISE d'ignition : halo radial serré autour de la sphère (le glint s'y est absorbé, elle brûle)
      if (s.glow > 0.02 && ballVisible) {
        var bx4 = proj[0] * s.x + proj[4] * s.y + proj[8] * s.z + proj[12];
        var by4 = proj[1] * s.x + proj[5] * s.y + proj[9] * s.z + proj[13];
        var bw4 = proj[3] * s.x + proj[7] * s.y + proj[11] * s.z + proj[15];
        drawGlow(bx4 / bw4, by4 / bw4, s.glow * 0.6, 200);
      }
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);

      // ---- PASSE 2 : bright-pass (1/4 ou 1/6 res) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fb);
      gl.viewport(0, 0, fboA.w, fboA.h);
      gl.disable(gl.BLEND);
      gl.useProgram(pBright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboScene.tex);
      gl.uniform1i(uBr.tex, 0);
      gl.uniform1f(uBr.thresh, 0.72);
      gl.uniform1f(uBr.gain, 1.15);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
      gl.enableVertexAttribArray(aBr);
      gl.vertexAttribPointer(aBr, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ---- PASSE 3/4 : blur gaussien séparable H puis V ----
      gl.useProgram(pBlur);
      gl.uniform1i(uBl.tex, 0);
      gl.enableVertexAttribArray(aBl);
      gl.vertexAttribPointer(aBl, 2, gl.FLOAT, false, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fb);
      gl.viewport(0, 0, fboB.w, fboB.h);
      gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
      gl.uniform2f(uBl.dir, 1 / fboA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.fb);
      gl.viewport(0, 0, fboA.w, fboA.h);
      gl.bindTexture(gl.TEXTURE_2D, fboB.tex);
      gl.uniform2f(uBl.dir, 0, 1 / fboB.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ---- PASSE 5 : composite -> canvas (scène telle quelle + bloom ADDITIF, alpha préservé) ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(pCopy);
      gl.uniform1i(uC.tex, 0);
      gl.bindTexture(gl.TEXTURE_2D, fboScene.tex);
      gl.uniform1f(uC.i, 1.0);
      gl.enableVertexAttribArray(aC);
      gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);                                 // couche prémultipliée
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);             // bloom additif (alpha inchangé)
      gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
      gl.uniform1f(uC.i, bloomAmount());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(aC);
      gl.disable(gl.BLEND);
    }

    /* ================================================================
       BOUCLE (rAF unique) + seek déterministe
       ================================================================ */
    var t0 = -1, lastT = 0, acc = 0, rafId = 0, disposed = false, started = false;
    function frame(now) {
      if (disposed) return;
      if (t0 < 0) { t0 = now; lastT = now; }
      var tMs = now - t0;
      fireCues(tMs);
      var dt = Math.min((now - lastT) / 1000, 0.1);                      // onglet caché : pas de rattrapage massif
      lastT = now;
      acc += dt;
      var guard = 0;
      while (acc >= SIM_DT && guard < 16) { step(SIM_DT); acc -= SIM_DT; guard++; }
      if (guard >= 16) acc = 0;
      render();
      rafId = requestAnimationFrame(frame);
    }

    var intro = {
      disposed: false,
      _resetHook: null,                                                  // posé par viewer.js (tests seek)

      cue: function (t, fn) { cues.push({ t: t, fn: fn }); cues.sort(function (a, b) { return a.t - b.t; }); return intro; },

      start: function () {
        if (started || disposed) return;
        started = true;
        document.body.appendChild(canvas);
        rafId = requestAnimationFrame(frame);
      },

      /* --- actions de phase (appelées par les cues) --- */
      // La sphère naît PILE sur la balle du logo : projection écran -> monde exacte
      // (wpp = 2·D0·tan(fov/2)/H : diamètre px et centre px reproduits au pixel)
      ignite: function (sx, sy, diamPx) {
        var s = st;
        s.wpp = 2 * D0 * Math.tan(FOV0 * Math.PI / 360) / H;
        var w = scrToWorld(sx, sy);
        s.x = w[0]; s.y = w[1]; s.tx = w[0]; s.ty = w[1];
        s.vx = 0; s.vy = 0;
        var r = (diamPx / 2) * s.wpp;
        s.r = r * 0.3; s.vr = 0; s.tr = r;                               // pop d'ignition (spring overshoot)
        s.radW = 24; s.radZ = 0.55;
        s.posW = 30; s.posZ = 0.9;                                       // ancrage raide sur le logo
        s.glow = 1.5;                                                    // braise -> le bloom flambe
        s.fade = 0;
        s.phase = PH.IGNITE;
      },
      // Anticipation : petite impulsion de recul (la masse se charge avant l'arrachement)
      anticipate: function (dirX, dirY) {
        var s = st;
        s.vx -= dirX * 150 * s.wpp;
        s.vy += dirY * 150 * s.wpp;                                      // écran y+ = bas -> monde y- (signe inversé)
        s.vr -= s.r * 1.2;
      },
      // Envol : spring vers le centre + kick fronde (perpendiculaire) + biais vers le haut = arc VIVANT
      launch: function (tcx, tcy, diamPx) {
        var s = st;
        var w = scrToWorld(tcx, tcy);
        s.tx = w[0]; s.ty = w[1];
        s.tr = (diamPx / 2) * s.wpp;
        s.posW = 8.5; s.posZ = 0.62;                                     // sous-amorti : overshoot + micro-oscillations
        s.radW = 7.5; s.radZ = 0.8;                                      // le grossissement traîne (masse)
        // kick en px/s dans l'espace écran, converti monde (y inversé)
        var sbx = s.x / s.wpp + W / 2, sby = H / 2 - s.y / s.wpp;        // position balle écran
        var dx = tcx - sbx, dy = tcy - sby;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / dist, uy = dy / dist;
        var px2 = -uy, py2 = ux;
        if (px2 * (sbx - tcx) < 0) { px2 = -px2; py2 = -py2; }           // fronde côté EXTÉRIEUR (comme l'ancien arc)
        var vPerp = Math.max(240, Math.min(500, dist * 2.0));
        var vBack = Math.min(220, dist * 0.9);
        var kx = -ux * vBack + px2 * vPerp;
        var ky = -uy * vBack + py2 * vPerp - 190;                        // biais vers le haut (écran)
        s.vx += kx * s.wpp;
        s.vy += -ky * s.wpp;
        s.rollW = 1.6;                                                   // spin de vol (parallaxe de surface)
        s.phase = PH.FLIGHT;
        s.focalNdc = [ (tcx / W) * 2 - 1, 1 - (tcy / H) * 2 ];
      },
      // Plongée : travelling caméra DANS la balle (z + FOV + roll), warp verrouillé sur la même courbe
      dive: function () {
        var s = st;
        s.diveMs = s.simMs;
        s.posZ = 1.05;                                                   // on calme le spring (la cible absorbe)
        s.rollW = 0.9;
        s.phase = PH.DIVE;
      },
      hyper: function () { st.phase = PH.HYPER; },
      flood: function () { st.floodMs = st.simMs; },                     // whiteout : bloom + lueur inondent
      hide: function () { canvas.style.display = 'none'; },              // sous le blanc plein (carte posée)

      /* --- gel du temps réel (vérification headless) : seuls les seek() pilotent ensuite --- */
      freeze: function () { if (rafId) cancelAnimationFrame(rafId); rafId = 0; },

      /* --- temps injectable : rejoue cues + physique de 0 à ms, rend UNE frame (déterministe) --- */
      seek: function (ms) {
        if (disposed) return;
        resetState();
        cueIdx = 0;
        canvas.style.display = '';
        if (intro._resetHook) intro._resetHook();
        var t = 0;
        while (t < ms) {
          var next = Math.min(t + SIM_DT * 1000, ms);
          fireCues(next);
          if (disposed) return;                                          // une cue a fermé l'intro (cleanup)
          step(SIM_DT);
          t = next;
        }
        fireCues(ms);
        if (disposed) return;
        if (!canvas.parentNode) document.body.appendChild(canvas);
        render();
      },

      /* --- preuves mesurées (tests) --- */
      readPixel: function (sx, sy) {                                     // à appeler juste après seek()
        var px = new Uint8Array(4);
        gl.readPixels(Math.round(sx * DPR), Math.round(canvas.height - sy * DPR), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      },
      ballScreen: function () {                                          // centre + rayon projetés (px écran)
        var s = st;
        var proj = perspective(s.fov, W / H, 0.05, 60);
        if (s.roll !== 0) proj = mat4Mul(proj, mat4RotZ(s.roll));
        var cx4 = proj[0] * s.x + proj[4] * s.y + proj[8] * s.z + proj[12];
        var cy4 = proj[1] * s.x + proj[5] * s.y + proj[9] * s.z + proj[13];
        var cw4 = proj[3] * s.x + proj[7] * s.y + proj[11] * s.z + proj[15];
        var nx = cx4 / cw4, ny = cy4 / cw4;
        var rpx = s.r / (-s.z) / Math.tan(s.fov * Math.PI / 360) * (H / 2);
        return { x: (nx * 0.5 + 0.5) * W, y: (1 - (ny * 0.5 + 0.5)) * H, r: rpx };
      },
      state: function () { return { phase: st.phase, warp: st.warp, fov: st.fov, z: st.z, r: st.r, glow: st.glow }; },

      /* --- libération TOTALE du contexte après l'intro --- */
      dispose: function () {
        if (disposed) return;
        disposed = true; intro.disposed = true;
        if (rafId) cancelAnimationFrame(rafId);
        try {
          gl.deleteBuffer(sphere.vbo); gl.deleteBuffer(sphere.ibo);
          gl.deleteBuffer(starVbo); gl.deleteBuffer(quadVbo);
          gl.deleteTexture(dimpleTex);
          [fboScene, fboA, fboB].forEach(function (f) {
            if (!f) return;
            gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex);
            if (f.rb) gl.deleteRenderbuffer(f.rb);
          });
          [pBall, pStar, pGlow, pBright, pBlur, pCopy].forEach(function (p) { gl.deleteProgram(p); });
          var lc = gl.getExtension('WEBGL_lose_context');
          if (lc) lc.loseContext();
        } catch (e) { /* contexte déjà perdu : rien à faire */ }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (window.__fgIntro === intro) window.__fgIntro = null;
      },

      onContextLost: null
    };

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      var cb = intro.onContextLost;
      intro.dispose();
      if (cb) cb();                                                      // viewer.js finalise en douceur (carte posée)
    }, false);

    window.addEventListener('resize', function () { if (!disposed) sizeAll(); });

    window.__fgIntro = intro;                                            // hook de vérification (seek/readPixel)
    return intro;
  }

  window.FGIntroGL = {
    available: !reduce && !forceOff && !!window.WebGLRenderingContext,
    createIntro: createIntro
  };
})();
