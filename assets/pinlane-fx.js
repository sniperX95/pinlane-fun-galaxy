/* ==========================================================================
   PINLANE FX : deux textures signature, zero dependance, zero build.
   ==========================================================================

   Demande de Movsar (2026-07-28) a partir de deux composants Framer/React
   qu'il voulait voir dans la console : un champ de points « chromatic waves »
   (halftone pilote par du bruit) et des particules qui reforment une forme.
   Le bundle Pinlane est du vanilla servi en statique : pas de React, pas de
   `ogl`, pas de npm cote navigateur. Les deux effets sont donc reecrits ici en
   WebGL2 brut / canvas 2D, avec les memes regles que le reste de la console :

     : ZERO couleur en dur. Les teintes sont lues sur le canvas (`color`,
       `--accent`), donc parite light/dark automatique par les tokens.
     : `prefers-reduced-motion` : image fixe peinte UNE fois, aucune boucle,
       aucun listener.
     : la boucle s'arrete si le canvas quitte le DOM, passe hors ecran, ou si
       l'onglet est masque. Zero rAF a vide, zero listener orphelin.
     : ~30 fps plafonnes, DPR plafonne a 2.
     : degradation franche : sans WebGL2, `halftone` rend false et l'appelant
       garde son fond existant. Jamais d'ecran noir, jamais d'exception.

   Deux fonctions posees sur window :
     window.plFxHalftone(canvas, opts) -> stop() | null
     window.plFxMark(canvas, opts)     -> stop() | null
   ========================================================================== */

(function () {
  'use strict';

  const FRAME_MS = 32;           // ~30 fps : fluide, sobre en CPU/GPU
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Couleur -> [r,g,b] en 0..1. Deux formes arrivent ici : le `color` calcule
  // (toujours `rgb(...)`) et la valeur BRUTE d'un token custom, qui dans ce
  // bundle est un hexa (`--accent: #0070f3`). Un parseur qui ne lirait que les
  // chiffres transformerait « #3291ff » en (3, 291, 255) : il faut les deux.
  function rgb01(value) {
    const raw = String(value || '').trim();
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
      return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
    }
    const parts = (raw.match(/[\d.]+/g) || []).map(Number);
    if (parts.length < 3) return [0.5, 0.5, 0.5];
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }

  // Luminance perceptuelle du texte : dit le theme sans jamais nommer une
  // couleur (texte clair = fond sombre).
  function isDarkTheme(textColor) {
    const parts = (String(textColor || '').match(/[\d.]+/g) || []).map(Number);
    if (parts.length < 3) return true;
    return (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000 > 140;
  }

  /* ======================================================================
     1) HALFTONE : le champ de points pilote par du bruit simplex.
     ======================================================================
     L'original (composant « Chromatic Waves ») fait DEUX passes : une passe
     bruit peinte dans un render target, puis une passe halftone qui echantillonne
     cette texture au centre de chaque cellule. La deuxieme passe ne lit qu'UN
     texel par cellule : la texture intermediaire ne sert a rien. On calcule donc
     le bruit directement au centre de la cellule, en UNE passe : meme image,
     moitie moins de travail GPU, et plus de render target a redimensionner.
     Le bruit simplex 3D est l'implementation de reference (Ashima/Gustavson),
     recopiee telle quelle : c'est un classique du domaine public. */

  const HALFTONE_VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

  const HALFTONE_FRAG = `#version 300 es
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCell;
uniform float uFreq;
uniform float uSpeed;
uniform float uGamma;
uniform float uBias;
uniform float uAlpha;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec2 uMouse;      // position du curseur en pixels de canvas (-1 = absent)
uniform float uMouseOn;   // fondu de presence 0..1 : l'entree et la sortie sont douces
uniform float uMouseR;    // rayon d'influence en pixels de canvas
out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  float cell = max(uCell, 1.0);
  vec2 pix = gl_FragCoord.xy;
  vec2 center = (floor(pix / cell) + 0.5) * cell;

  // INFLUENCE DU CURSEUR : une gaussienne centree sur le pointeur, calculee sur
  // le CENTRE DE CELLULE (et non sur le pixel) pour que tous les pixels d'un
  // meme point recoivent exactement la meme poussee : sinon le disque se
  // deforme au lieu de grossir.
  float md = distance(center, uMouse);
  float infl = uMouseOn * exp(-(md * md) / (2.0 * uMouseR * uMouseR));

  vec2 uv = center / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;
  // Le champ se creuse legerement autour du pointeur : la matiere reagit a la
  // main, elle ne se contente pas de briller.
  vec2 warp = uResolution.x > 0.0 ? (center - uMouse) / uResolution : vec2(0.0);
  float gray = abs(snoise(vec3(p * uFreq + warp * infl * 0.9, uTime * uSpeed)));
  gray = pow(clamp(gray, 0.0001, 1.0), uGamma);

  vec2 cellUv = fract(pix / cell) - 0.5;
  float dist = length(cellUv);
  float radius = clamp(gray + uBias + infl * 0.34, 0.0, 1.0) * 0.5;
  float aa = fwidth(dist) + 1e-4;
  float mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);
  vec3 col = mix(uColorA, uColorB, clamp(gray + infl * 0.5, 0.0, 1.0));
  fragColor = vec4(col, mark * uAlpha * (1.0 + infl * 0.85));
}`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  window.plFxHalftone = function plFxHalftone(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const opts = options || {};
    // alpha: true + premultipliedAlpha: false : le fond de la page reste
    // visible dessous, on ne peint QUE les points.
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    } catch (error) { gl = null; }
    if (!gl) return null;                       // pas de WebGL2 : l'appelant garde son fond

    const vs = compile(gl, gl.VERTEX_SHADER, HALFTONE_VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, HALFTONE_FRAG);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const u = {};
    ['uResolution', 'uTime', 'uCell', 'uFreq', 'uSpeed', 'uGamma', 'uBias', 'uAlpha', 'uColorA', 'uColorB', 'uMouse', 'uMouseOn', 'uMouseR']
      .forEach((name) => { u[name] = gl.getUniformLocation(program, name); });

    const state = {
      raf: 0, last: 0, t0: 0, w: 0, h: 0, dpr: 1, stopped: false,
      // Curseur : position visee (px CSS, repere page) et position LISSEE. Le
      // lissage evite que la tache saute d'un bout a l'autre sur un mouvement
      // rapide ; le fondu `on` fait entrer et sortir l'influence en douceur.
      px: null, py: null, mx: 0, my: 0, on: 0,
    };

    function readTheme() {
      const cs = getComputedStyle(canvas);
      const dark = isDarkTheme(cs.color);
      const accent = rgb01(cs.getPropertyValue('--accent') || cs.color);
      const text = rgb01(cs.color);
      gl.uniform3f(u.uColorA, text[0], text[1], text[2]);
      gl.uniform3f(u.uColorB, accent[0], accent[1], accent[2]);
      // Intensites TRES basses : la texture ne concurrence jamais la lecture.
      // Le dark porte un peu plus (contraste plus doux sur fond sombre).
      gl.uniform1f(u.uAlpha, opts.alpha != null ? opts.alpha : (dark ? 0.55 : 0.34));
    }

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w === state.w && h === state.h && dpr === state.dpr) return true;
      state.w = w; state.h = h; state.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      // La maille et le rayon d'influence sont donnes en px CSS : ils doivent
      // garder la meme taille a l'ecran quel que soit le DPR.
      gl.uniform1f(u.uCell, (opts.cell || 26) * dpr);
      gl.uniform1f(u.uMouseR, (opts.mouseRadius || 170) * dpr);
      return true;
    }

    function paint(seconds) {
      gl.uniform1f(u.uTime, seconds);
      gl.uniform2f(u.uMouse, state.mx * state.dpr, (state.h - state.my) * state.dpr); // gl_FragCoord a l'origine en BAS
      gl.uniform1f(u.uMouseOn, state.on);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      if (state.stopped) return;
      if (!canvas.isConnected || canvas.offsetParent === null) { stop(); return; }
      state.raf = requestAnimationFrame(frame);
      if (now - state.last < FRAME_MS) return;
      state.last = now;
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;   // hors ecran : on saute la peinture, pas l'horloge
      if (Math.abs(rect.width - state.w) > 1 || Math.abs(rect.height - state.h) > 1) resize();
      // Curseur : cible en coordonnees LOCALES du canvas, puis lissage.
      const target = state.px !== null ? 1 : 0;
      state.on += (target - state.on) * 0.12;
      if (state.px !== null) {
        const lx = state.px - rect.left;
        const ly = state.py - rect.top;
        // Premiere entree : on se pose directement, sinon la tache traverse
        // l'ecran en diagonale a chaque retour du pointeur.
        if (state.on < 0.02) { state.mx = lx; state.my = ly; }
        else { state.mx += (lx - state.mx) * 0.18; state.my += (ly - state.my) * 0.18; }
      }
      paint((now - state.t0) / 1000);
    }

    function onMove(event) {
      state.px = event.clientX;
      state.py = event.clientY;
    }
    function onLeave() { state.px = null; state.py = null; }

    function stop() {
      state.stopped = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    }

    function onVisibility() {
      if (document.hidden) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        return;
      }
      if (!state.stopped && !state.raf && !reduced) {
        state.last = 0;
        state.raf = requestAnimationFrame(frame);
      }
    }

    gl.uniform1f(u.uFreq, opts.frequency != null ? opts.frequency : 1.5);
    gl.uniform1f(u.uSpeed, opts.speed != null ? opts.speed : 0.16);
    gl.uniform1f(u.uGamma, opts.gamma != null ? opts.gamma : 3.4);
    gl.uniform1f(u.uBias, opts.bias != null ? opts.bias : -0.16);
    gl.uniform1f(u.uMouseOn, 0);
    gl.uniform2f(u.uMouse, -9999, -9999);
    readTheme();
    if (!resize()) return null;
    if (reduced) { paint(0); return stop; }     // image fixe : aucune boucle, aucun suivi du curseur
    state.t0 = performance.now();
    state.last = 0;
    paint(0);
    // Listeners GLOBAUX : le canvas est en pointer-events:none (il ne doit rien
    // intercepter), donc c'est la fenetre qui rapporte la position.
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave, { passive: true });
    document.addEventListener('mouseleave', onLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    state.raf = requestAnimationFrame(frame);
    return stop;
  };

  /* ======================================================================
     2) MARQUE EN PARTICULES : la forme de l'agent, faite de points.
     ======================================================================
     Adapte du composant « SVG Particle » de Movsar. Deux ecarts assumes :
       : la forme n'est pas une image distante (une requete reseau + un
         canvas taint par CORS), c'est le PATH SVG de la marque deja utilisee
         sur la page. « Adapte la forme pour etre en coherence ».
       : au repos, les particules FORMENT la marque au lieu d'errer. Un logo
         doit rester lisible ; c'est le curseur qui le disperse, et il se
         reforme tout seul. L'errance de l'original devient l'ETAT D'ENTREE :
         les points arrivent disperses et s'assemblent une fois. */

  function samplePath(pathData, size, viewBox, gap) {
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    const scale = size / viewBox;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff';
    try {
      ctx.fill(new Path2D(pathData));
    } catch (error) {
      return [];
    }
    let data;
    try {
      data = ctx.getImageData(0, 0, size, size).data;
    } catch (error) {
      return [];
    }
    const points = [];
    for (let y = 0; y < size; y += gap) {
      for (let x = 0; x < size; x += gap) {
        if (data[(y * size + x) * 4 + 3] >= 24) points.push({ hx: x, hy: y });
      }
    }
    return points;
  }

  const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);

  window.plFxMark = function plFxMark(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const opts = options || {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const size = Math.round(canvas.clientWidth || opts.size || 132);
    if (!size) return null;
    const gap = opts.gap || 3;
    const points = samplePath(opts.path, size, opts.viewBox || 24, gap);
    if (!points.length) return null;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const RADIUS = opts.radius || 62;          // rayon d'influence du curseur (px)
    const RADIUS2 = RADIUS * RADIUS;
    const ENTER_MS = 900;

    const particles = points.map((p) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = size * (0.55 + Math.random() * 0.75);
      return {
        hx: p.hx, hy: p.hy,
        x: p.hx + Math.cos(angle) * dist,
        y: p.hy + Math.sin(angle) * dist,
        sx: p.hx + Math.cos(angle) * dist,
        sy: p.hy + Math.sin(angle) * dist,
        px: 0, py: 0,                          // deplacement de repulsion en cours
        ph: Math.random() * 6.283,             // phase de respiration
        sp: 0.5 + Math.random() * 0.6,
        am: 0.5 + Math.random() * 0.9,
        a: 0.5 + Math.random() * 0.5,
      };
    });

    const state = { raf: 0, last: 0, t0: 0, mx: -9999, my: -9999, stopped: false, color: '' };

    function readColor() {
      // Le canvas porte `color: var(--accent-strong)` : la valeur CALCULEE est
      // deja un rgb() utilisable tel quel comme fillStyle. Zero couleur en dur,
      // parite light/dark automatique.
      const cs = getComputedStyle(canvas);
      state.color = cs.color || '#888';
    }

    function paint(now, animated) {
      const t = (now - state.t0) / 1000;
      const enter = animated ? EASE_OUT(Math.min(1, (now - state.t0) / ENTER_MS)) : 1;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = state.color;
      for (const p of particles) {
        let x = p.sx + (p.hx - p.sx) * enter;
        let y = p.sy + (p.hy - p.sy) * enter;
        if (animated) {
          // Respiration : le champ n'est jamais fige, l'amplitude reste sous
          // la maille pour que la forme reste nette.
          x += Math.sin(t * p.sp + p.ph) * p.am * 0.55;
          y += Math.cos(t * p.sp + p.ph) * p.am * 0.55;
          const dx = x - state.mx;
          const dy = y - state.my;
          const dd = dx * dx + dy * dy;
          if (dd < RADIUS2 && dd > 0.01) {
            const d = Math.sqrt(dd);
            const push = (1 - d / RADIUS) * RADIUS * 0.55;
            p.px += ((dx / d) * push - p.px) * 0.18;
            p.py += ((dy / d) * push - p.py) * 0.18;
          } else {
            p.px *= 0.9;                       // retour elastique vers la forme
            p.py *= 0.9;
          }
          x += p.px;
          y += p.py;
        }
        ctx.globalAlpha = p.a * enter;
        ctx.beginPath();
        ctx.arc(x, y, 1.05, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      if (state.stopped) return;
      if (!canvas.isConnected || canvas.offsetParent === null) { stop(); return; }
      state.raf = requestAnimationFrame(frame);
      if (now - state.last < FRAME_MS) return;
      state.last = now;
      paint(now, true);
    }

    function onMove(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const scale = size / rect.width;
      state.mx = (event.clientX - rect.left) * scale;
      state.my = (event.clientY - rect.top) * scale;
    }
    function onLeave() { state.mx = -9999; state.my = -9999; }

    function stop() {
      state.stopped = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    }

    function onVisibility() {
      if (document.hidden) {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        return;
      }
      if (!state.stopped && !state.raf && !reduced) {
        state.last = 0;
        state.raf = requestAnimationFrame(frame);
      }
    }

    readColor();
    if (reduced) { state.t0 = 0; paint(ENTER_MS, false); return stop; }
    state.t0 = performance.now();
    state.last = 0;
    paint(state.t0, true);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave, { passive: true });
    document.addEventListener('mouseleave', onLeave, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    state.raf = requestAnimationFrame(frame);
    return stop;
  };
}());
