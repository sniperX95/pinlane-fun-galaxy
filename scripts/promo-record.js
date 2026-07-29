// ENREGISTREMENT de vraies interactions dans le produit, pour la video promo.
//
// Les versions precedentes faisaient panner des captures FIXES : on voyait le
// produit, jamais quelqu'un s'en servir. Ici Playwright pilote reellement
// l'application (remplir le formulaire, choisir un creneau, taper ses
// coordonnees, naviguer dans le back-office) et enregistre la session. Ce qui
// est a l'ecran EST le produit en fonctionnement, pas une reconstitution.
//
// Le film final est rendu en 3840x2160 ; ce clip y vit dans une carte reduite.
// Voir la note sur recordVideo plus bas : la capture reste a sa taille native.
//
// Sortie : un webm par scenario dans artifacts/promo-clips/.
//
// Usage : node scripts/promo-record.js [--cssw 2560] [--cssh 1440]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
// DEUX PIEGES PAYES ICI, ne pas les rejouer :
//
// 1. Ouvrir l'application a 3840 pixels CSS ne donne pas une belle image : elle
//    a une largeur de contenu maximale, elle se retrouve minuscule au milieu de
//    marges vides. La bonne mise en page est a 2560.
//
// 2. `deviceScaleFactor` N'AUGMENTE PAS la definition de recordVideo. Playwright
//    capture le viewport a sa taille CSS et le POSE en haut a gauche d'un cadre
//    de la taille demandee, le reste en gris. Demander 3840x2160 sur un viewport
//    de 2560 donne donc 33 % de gris a droite et en bas, pas du 4K.
//    -> la video est enregistree a sa taille naturelle.
//
// Ce n'est pas une perte : le clip vit dans une carte de ~1500 px CSS, soit
// 2250 px reels dans un rendu 4K. Une source de 2560 y est encore REDUITE.
// La valeur etait absente de la regle CSS (`zoom: }`) : elle n'a jamais ete
// appliquee, l'interface a donc ete filmee a sa taille normale alors que le
// commentaire ci-dessus decrit l'inverse. C'est une des causes du texte petit
// et mou dans la fenetre reduite du montage.
const ZOOM = Number(arg('zoom', 1.3));
const CSS_W = Number(arg('cssw', 2560));
const CSS_H = Number(arg('cssh', 1440));
const W = CSS_W;
const H = CSS_H;

// ===========================================================================
// POURQUOI LA CAPTURE SE FAIT IMAGE PAR IMAGE, ET PLUS PAR recordVideo.
//
// L'enregistreur video de Playwright encode en VP8 a debit modeste. Sur une
// interface sombre pleine de petit texte, c'est ruineux : compare cote a cote
// avec une capture PNG du MEME ecran, le texte est bave et cerne d'artefacts
// de bloc. C'etait la cause dominante du « flou », pas le cadrage ni l'echelle.
//
// On capture donc des PNG a densite 1.5 (3840x2160) puis on assemble en VP9
// quasi sans perte. Un PNG de cette interface pese ~0,3 Mo : 900 images tiennent
// dans 270 Mo, c'est negligeable.
//
// Consequence : le temps n'avance plus tout seul. Le curseur est pilote par une
// HORLOGE VIRTUELLE avancee d'exactement 1/FPS par image — la capture devient
// aussi reproductible que le rendu du montage.
// ===========================================================================
const FPS = Number(arg('fps', 25));
const DSF = Number(arg('dsf', 1.5));
const SEQ = path.join(ROOT, 'artifacts/promo-clips/seq');
let frameIdx = 0;

async function snap(page) {
  await page.evaluate((dt) => { if (window.__pcTick) window.__pcTick(dt); }, 1 / FPS);
  await page.screenshot({ path: path.join(SEQ, `f${String(frameIdx).padStart(5, '0')}.png`) });
  frameIdx += 1;
}

// Remplace waitForTimeout : au lieu d'attendre, on FILME l'attente.
async function pause(page, ms) {
  const n = Math.max(1, Math.round((ms / 1000) * FPS));
  for (let i = 0; i < n; i++) await snap(page);
}

// Instant courant du clip, en secondes — c'est le compteur d'images qui fait foi.
const instant = () => frameIdx / FPS;
const OUT = path.join(ROOT, 'artifacts/promo-clips');
const PORT = 4601;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Journal des gestes REELLEMENT joues. Un scenario qui rate en silence donnerait
// un clip ou il ne se passe rien : on le saurait trop tard, au montage.
const DONE = [];
const MISSED = [];

function loadFromVisualQa(name) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-visual-qa.js'), 'utf8');
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error(name + ' introuvable dans run-visual-qa.js');
  const end = new RegExp('\\r?\\n\\}\\r?\\n').exec(src.slice(start));
  if (!end) throw new Error('fin de ' + name + ' introuvable');
  const body = src.slice(start, start + end.index + end[0].length);
  // eslint-disable-next-line no-new-func
  return new Function('BASE_URL', body + '\nreturn ' + name + ';')(BASE_URL);
}

const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
  });
  server.listen(PORT, '127.0.0.1', () => resolve(server));
});

// Un curseur visible est INDISPENSABLE : sans lui, les elements changent d'etat
// tout seuls et le spectateur ne comprend pas qu'on manipule le produit.
// CURSEUR DE DEMONSTRATION, modele « pastille qui traine ».
//
// Le clic doit se VOIR : dans le film, ce clip vit reduit dans une carte, un
// petit curseur systeme y disparait. Trois elements, trois ressorts distincts :
//   - la fleche, ancree a sa POINTE, sur un ressort nerveux ;
//   - une pastille Pinlane qui TRAINE derriere sur un ressort plus mou et
//     bascule selon la vitesse — c'est elle qui donne la sensation de geste ;
//   - un halo d'impact au clic, plus l'enfoncement des deux.
// Les ressorts sont integres a la main (pas de bibliotheque dans la page).
const CURSEUR_TAILLE = 62;
const CURSOR_CSS = `
  #__pcArrow{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
    width:${CURSEUR_TAILLE}px;height:${CURSEUR_TAILLE}px;transform-origin:0% 0%;
    filter:drop-shadow(0 8px 20px rgba(0,0,0,.75))}
  #__pcLabel{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;
    transform-origin:0% 50%;background:#3291ff;color:#fff;border-radius:999px;
    padding:${Math.round(CURSEUR_TAILLE * .18)}px ${Math.round(CURSEUR_TAILLE * .36)}px;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    font-size:${Math.max(12, Math.round(CURSEUR_TAILLE * .43))}px;font-weight:600;
    line-height:1.1;letter-spacing:.1px;white-space:nowrap;
    box-shadow:0 8px 22px rgba(0,0,0,.35), 0 2px 5px rgba(0,0,0,.22),
               inset 0 1px 0 rgba(255,255,255,.35)}
  #__pcRing{position:fixed;width:56px;height:56px;border-radius:50%;z-index:2147483645;
    pointer-events:none;border:7px solid #3291ff;opacity:0;
    box-shadow:0 0 40px rgba(50,145,255,.9), inset 0 0 24px rgba(50,145,255,.5)}`;

async function installCursor(page) {
  await page.evaluate(([css, T]) => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);

    // Les trois elements vivent sur <html> et non <body> : le body est zoome
    // pour la nettete, et le curseur doit rester a l'echelle de la souris.
    const arrow = document.createElement('div');
    arrow.id = '__pcArrow';
    // Fleche ancree a sa POINTE (0,0) : le point chaud est le coin, pas le
    // centre, sinon le clic semble se produire a cote de la cible.
    arrow.innerHTML = `<svg width="${T}" height="${T}" viewBox="0 0 28 28" fill="none"
      style="display:block;overflow:visible">
      <path d="M5 3 L23 14 L14 16 L11 24 Z" fill="#ffffff"
        stroke="rgba(0,0,0,.35)" stroke-width=".8" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(arrow);

    const label = document.createElement('div');
    label.id = '__pcLabel';
    label.textContent = 'Pinlane';
    document.documentElement.appendChild(label);

    const ring = document.createElement('div');
    ring.id = '__pcRing';
    document.documentElement.appendChild(ring);

    // --- ressorts integres a la main ---------------------------------------
    // La page n'a pas de bibliotheque d'animation : un ressort amorti se
    // calcule en trois lignes, et rester en JS pur evite d'injecter une
    // dependance dans l'application filmee.
    // x = position, v = vitesse. La vitesse part de ZERO : l'initialiser a la
    // position projetait le curseur a l'autre bout de l'ecran a la 1re frame.
    const ressort = (x0) => ({ x: x0, v: 0 });
    // Integration en SOUS-PAS de 4 ms maximum.
    //
    // Un ressort raide integre en Euler explicite DIVERGE des que k*dt/m
    // depasse ~2. Avec k=500 et m=0.5, une frame de 32 ms donne 32 : l'echelle
    // partait a l'infini et la pastille couvrait la moitie de l'ecran en bleu.
    // Decouper le pas de temps rend le calcul stable quelle que soit la charge
    // machine — et c'est aussi ce qui rend le rendu reproductible.
    const SOUS_PAS = 0.004;
    const pas = (e, cible, dt, k, c, m) => {
      const n = Math.max(1, Math.ceil(dt / SOUS_PAS));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = (-k * (e.x - cible) - c * e.v) / m;
        e.v += a * h;
        e.x += e.v * h;
      }
    };

    const cible = { x: -9999, y: -9999 };
    const fleche = { x: ressort(-9999), y: ressort(-9999) };
    const pastille = { x: ressort(-9999), y: ressort(-9999) };
    const inclin = ressort(0);
    const echelle = ressort(1);
    let dernier = null;                         // echantillon pour la vitesse

    // Decalage de la pastille : elle se pose en bas a droite de la pointe.
    const DX = T * 0.9, DY = T * 0.2 + 6;
    const INCLIN_MAX = 25;                      // degres

    // HORLOGE VIRTUELLE.
    //
    // La capture se fait image par image : le temps reel ne veut plus rien dire
    // entre deux screenshots (une capture PNG 4K prend ~250 ms). Le montage
    // avance donc l'horloge lui-meme, d'exactement 1/FPS par image. Meme
    // methode que le rendu de la scene : c'est ce qui rend le clip reproductible
    // et le curseur regulier.
    let horloge = 0;         // secondes ecoulees dans le clip
    let presseA = -99;       // instant de l'appui, sur la meme horloge
    let ringA = -99;         // instant du halo
    window.__pcTick = (dt) => {
      horloge += dt;
      pas(fleche.x, cible.x, dt, 380, 32, 0.6);
      pas(fleche.y, cible.y, dt, 380, 32, 0.6);
      pas(pastille.x, cible.x, dt, 220, 26, 0.7);
      pas(pastille.y, cible.y, dt, 220, 26, 0.7);
      pas(inclin, inclin.cible || 0, dt, 200, 24, 0.6);
      const enfonce = (horloge - presseA) < 0.15 ? 0.92 : 1;
      pas(echelle, enfonce, dt, 500, 28, 0.5);

      arrow.style.transform = `translate(${fleche.x.x}px, ${fleche.y.x}px) scale(${echelle.x})`;
      label.style.transform = `translate(${pastille.x.x + DX}px, ${pastille.y.x + DY}px) `
        + `rotate(${inclin.x}deg) scale(${echelle.x})`;

      // Le halo est dessine a la main lui aussi : une transition CSS suivrait
      // l'horloge murale et ne bougerait pas d'une image a l'autre.
      const u = (horloge - ringA) / 0.62;
      if (u >= 0 && u <= 1) {
        const e = 1 - Math.pow(1 - u, 3);
        ring.style.opacity = String(1 - u);
        ring.style.transform = `scale(${0.32 + e * 3.7})`;
      } else {
        ring.style.opacity = '0';
      }
    };
    window.__pcNow = () => horloge;
    window.__pcPress = () => { presseA = horloge; };
    window.__pcRing = () => { ringA = horloge; };

    window.__promoMove = (x, y) => {
      // Vitesse mesuree sur l'horloge VIRTUELLE : sur l'horloge murale, le
      // temps passe a ecrire un PNG ferait croire a un deplacement lent.
      const now = horloge * 1000;
      if (dernier) {
        const dt = Math.max(1, now - dernier.t);
        const vx = ((x - dernier.x) / dt) * 1000;
        const vy = ((y - dernier.y) / dt) * 1000;
        // La pastille bascule dans le sens du deplacement, d'autant plus fort
        // qu'on va vite. C'est ce basculement qui fait « geste » et non
        // « element qui se teleporte ».
        const vitesse = Math.hypot(vx, vy);
        const signe = vx === 0 ? 0 : (vx > 0 ? 1 : -1);
        inclin.cible = signe * Math.min(1, vitesse / 1500) * INCLIN_MAX;
      }
      dernier = { x, y, t: now };
      cible.x = x; cible.y = y;
    };

    window.__promoClick = (x, y) => {
      // Aucune transition CSS ici : elles suivent l'horloge murale et seraient
      // deja terminees (ou pas commencees) au moment de la capture suivante.
      // C'est __pcTick qui dessine le halo, image par image.
      ring.style.transition = 'none';
      ring.style.left = (x - 28) + 'px';
      ring.style.top = (y - 28) + 'px';
      window.__pcPress();
      window.__pcRing();
    };
  }, [CURSOR_CSS, CURSEUR_TAILLE]);
}

// Deplacement humain : courbe, acceleration puis freinage. Une souris ne va
// jamais en ligne droite a vitesse constante.
async function moveTo(page, x, y, steps = 22) {
  const from = await page.evaluate(() => window.__promoAt || { x: 300, y: 300 });
  const cx = (from.x + x) / 2 + (y - from.y) * .22;
  const cy = (from.y + y) / 2 - (x - from.x) * .22;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const px = u * u * from.x + 2 * u * e * cx + e * e * x;
    const py = u * u * from.y + 2 * u * e * cy + e * e * y;
    await page.evaluate(([a, b]) => { window.__promoMove(a, b); window.__promoAt = { x: a, y: b }; }, [px, py]);
    await pause(page, 9);
  }
}

async function boxOf(page, sel) {
  // Un champ sous la ligne de flottaison n'est pas « absent » : il faut y aller.
  // Sans ce defilement, l'etape 3 du parcours (nom, telephone) etait sautee.
  const near = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return true;
  }, sel);
  if (!near) return null;
  await pause(page, 520);            // le defilement doit finir
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.top > window.innerHeight || r.bottom < 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}

async function clickAt(page, sel, label, settle = 560) {
  const box = await boxOf(page, sel);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await pause(page, 150);        // temps de survol : l'etat hover se voit
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [box.x, box.y]);
  await pause(page, 80);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, sel);
  await pause(page, settle);
  DONE.push(label);
  console.log(`   clic ${label}`);
  return true;
}

// La frappe caractere par caractere : c'est ce qui fait « quelqu'un utilise le
// produit » plutot que « une valeur est apparue ».
async function typeInto(page, sel, text, label) {
  const box = await boxOf(page, sel);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  await moveTo(page, box.x, box.y);
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [box.x, box.y]);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.focus(); el.value = ''; } }, sel);
  for (const ch of text) {
    await page.evaluate(([s, c]) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.value += c;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [sel, ch]);
    await pause(page, 52);
  }
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel);
  await pause(page, 300);
  DONE.push(label);
  console.log(`   saisie ${label} = "${text}"`);
  return true;
}

// Clique le n-ieme enfant visible d'un conteneur : les options (durees,
// formules, creneaux) sont generees, on ne peut pas les cibler en dur.
async function clickNth(page, container, n, label) {
  const sel = await page.evaluate(([c, i]) => {
    const host = document.querySelector(c);
    if (!host) return null;
    const kids = [...host.children].filter((k) => k.getBoundingClientRect().height > 8);
    const el = kids[i];
    if (!el) return null;
    el.setAttribute('data-promo-pick', '1');
    return `${c} > [data-promo-pick="1"]`;
  }, [container, n]);
  if (!sel) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  const ok = await clickAt(page, sel, label);
  await page.evaluate(() => document.querySelectorAll('[data-promo-pick]').forEach((e) => e.removeAttribute('data-promo-pick')));
  return ok;
}

// Cible un element par son TEXTE visible. Les cartes de sequences d'emails
// (« Confirmation », « Rappel avant la venue »…) sont generees et n'ont pas
// d'identifiant stable : c'est leur libelle qui les designe, et c'est ce meme
// libelle que la voix prononce dans le film.
async function clickByText(page, text, label, settle = 620) {
  const sel = await page.evaluate((needle) => {
    // Sans depouiller les accents, « Reactiver » ne trouve pas « Réactiver » :
    // la sequence nommee par la voix off serait absente de l'image.
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const cands = [...document.querySelectorAll('button, a, [role="button"], .card, .seq-card, li, div')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 18) return false;
        if (r.top < 0 || r.top > window.innerHeight) return false;
        return norm(el.textContent).includes(want);
      });
    // Le plus PETIT element qui contient le texte : sinon on cible le body.
    const el = cands.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
      - (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0];
    if (!el) return null;
    el.setAttribute('data-promo-txt', '1');
    return '[data-promo-txt="1"]';
  }, text);
  if (!sel) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  const ok = await clickAt(page, sel, label, settle);
  await page.evaluate(() => document.querySelectorAll('[data-promo-txt]').forEach((e) => e.removeAttribute('data-promo-txt')));
  return ok;
}

// REPERES POUR LE MONTAGE.
//
// Mesurer les coordonnees d'un element dans une session separee ne marche pas :
// la page n'est jamais dans le meme etat qu'au tournage (defilement, onglet
// actif, zoom, re-rendus). Le seul moment ou l'on connait la position exacte
// d'un element, c'est quand on le filme. L'enregistreur note donc lui-meme ou
// et QUAND, et le montage lit ce fichier au lieu de deviner.
const MARQUES = {};
let T0 = 0;
function noterMarque(cle, rect) {
  MARQUES[cle] = { ...rect, t: instant() };
}

// Survol appuye : sur un plan serre, voir l'element REAGIR sous le curseur
// vaut mieux qu'un clic qui change de page trop vite.
async function hoverText(page, text, label, minW = 60, minH = 24) {
  const box = await page.evaluate(([needle, mw, mh]) => {
    // Sans depouiller les accents, « Reactiver » ne trouve pas « Réactiver » :
    // la sequence nommee par la voix off serait absente de l'image.
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const el = [...document.querySelectorAll('button, a, [role="button"], .card, li, div')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > mw && r.height > mh && r.top > 0 && r.top < window.innerHeight
          && norm(e.textContent).includes(want);
      })
      .sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
        - (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Le RECTANGLE complet, pas seulement le centre : le montage a besoin du
    // cadre exact pour poser son repere dessus.
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, [text, minW, minH]);
  if (!box) { MISSED.push(label); console.log(`   (absent) ${label}`); return false; }
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  await moveTo(page, cx, cy);
  await page.mouse.move(cx, cy);
  await pause(page, 760);
  noterMarque(label, box);
  DONE.push(label);
  console.log(`   survol ${label}  [${box.x},${box.y} ${box.w}x${box.h} @${instant().toFixed(1)}s]`);
  return true;
}

// Ferme le panneau ouvert en cliquant SUR LE FOND, comme un vrai utilisateur
// (`posOverlay` ecoute exactement ce clic). `Escape` ne fait rien ici : sans
// cette fermeture, la fiche reservation restait a l'ecran 19 s sur 24 et
// masquait toutes les pages suivantes du film.
async function closeOverlay(page, label = 'fermeture du panneau') {
  const pt = await page.evaluate(() => {
    const ov = [...document.querySelectorAll('[id$="Overlay"], [id$="Modal"]')]
      .find((o) => {
        const s = getComputedStyle(o);
        const r = o.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05
          && r.width > 200 && r.height > 200;
      });
    if (!ov) return null;
    const or = ov.getBoundingClientRect();
    // Le panneau est l'enfant le plus grand : on vise a cote, sur le fond.
    const panel = [...ov.children]
      .map((c) => c.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const y = Math.max(or.top + 30, Math.min(or.bottom - 30, or.top + or.height / 2));
    const x = panel && panel.left - or.left > 90 ? or.left + 45 : or.right - 45;
    return { x, y, id: ov.id };
  });
  if (!pt) return false;
  await moveTo(page, pt.x, pt.y, 14);
  await page.evaluate(([a, b]) => window.__promoClick(a, b), [pt.x, pt.y]);
  await page.mouse.click(pt.x, pt.y);
  await pause(page, 620);
  const still = await page.evaluate((id) => {
    const o = document.getElementById(id);
    if (!o) return false;
    const s = getComputedStyle(o);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05;
  }, pt.id);
  if (still) { MISSED.push(label + ' (reste ouvert)'); console.log(`   PANNEAU TOUJOURS OUVERT : ${pt.id}`); return false; }
  DONE.push(label);
  console.log(`   ${label} (${pt.id})`);
  return true;
}

// La console Direction interroge /api/admin-range sur une periode de 30 jours.
// Le mock QA ne repond que pour la date de depart, donc la console affichait
// « Pas encore de donnees sur cette periode » : aucun graphique a filmer.
// On etend le mock a toute la periode, avec un volume plus fort le week-end
// pour que la courbe ressemble a un vrai centre. C'est de la donnee de DEMO,
// au meme titre que la journee seedee pour le planning.
async function seedDirectionRange(page) {
  const ok = await page.evaluate(() => {
    const build = window.__PINLANE_QA_RESERVATIONS__;
    if (typeof build !== 'function') return false;
    const precedent = window.fetch;
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : (input && input.url) || '';
      let url;
      try { url = new URL(href, location.origin); } catch (e) { return precedent(input, init); }
      if (url.pathname !== '/api/admin-range') return precedent(input, init);
      const debut = url.searchParams.get('startDate');
      const fin = url.searchParams.get('endDate');
      const out = [];
      const d = new Date(debut + 'T00:00:00Z');
      const stop = new Date(fin + 'T00:00:00Z');
      let jour = 0;
      while (d <= stop && jour < 120) {
        const iso = d.toISOString().slice(0, 10);
        const s = d.getUTCDay();
        const n = s === 6 ? 5 : s === 0 ? 4 : s === 5 ? 3 : 2;
        build(iso).slice(0, n).forEach((r, k) => {
          out.push({ ...r, id: (jour + 1) * 100 + k, date: iso });
        });
        d.setUTCDate(d.getUTCDate() + 1);
        jour += 1;
      }
      return Promise.resolve(new Response(
        JSON.stringify({ ok: true, reservations: out, emails: [], agentEvents: [],
          centerId: url.searchParams.get('centerId') || 'libramont' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    };
    return true;
  });
  console.log(ok ? '   periode Direction alimentee' : '   ATTENTION : mock QA introuvable, Direction restera vide');
  return ok;
}

// ANONYMISATION DE L'ENSEIGNE.
//
// Le jeu de demo porte le nom d'un client reel. Une pub Pinlane qui affiche
// l'enseigne d'un client partout, c'est le client qu'elle met en avant, pas le
// produit — et c'est une exposition qu'il n'a pas demandee. On substitue donc
// un nom neutre a l'affichage, en continu : l'application se re-rend sans
// arret, une passe unique serait effacee au premier changement de page.
const ENSEIGNE_INTERDITE = /fun\s*galaxy|fungalaxy|mngfunglxy/i;

// Le meme traitement, mais pose AVANT le premier rendu de la page.
//
// L'enregistrement demarre a la creation du contexte, donc AVANT qu'un
// page.evaluate ait pu tourner : les premieres secondes du clip montraient
// l'enseigne et le logo du client. Injecte ici, le nettoyage est actif des la
// premiere image.
//
// ZOOM : l'application est rendue a 1,4x dans la meme capture 2560x1440. Chaque
// element d'interface recoit donc 1,4x plus de pixels, et le film 4K n'a plus a
// l'agrandir — c'est ce qui rendait les captures floues. Le zoom porte sur
// <body> et non <html> : le curseur de demonstration, ajoute a <html>, reste
// hors du zoom et ses coordonnees continuent de coincider avec la souris.
const SCRIPT_INIT = (zoom) => {
  const REGLES = [
    [/Fun\s*Galaxy\s+Libramont/gi, 'Bowling Central'],
    [/Fun\s*Galaxy\s+Gembloux/gi, 'Bowling Nord'],
    [/Fun\s*Galaxy\s+Ciney/gi, 'Bowling Sud'],
    [/Fun\s*Galaxy/gi, 'Bowling Central'],
    [/fungalaxy/gi, 'democentre'],
    [/mngfunglxy/gi, 'democentre'],
  ];
  const suspect = /fun\s*galaxy|fungalaxy|mngfunglxy/i;
  const reecrire = (v) => { let s = v; for (const [re, to] of REGLES) s = s.replace(re, to); return s; };
  const passe = () => {
    if (!document.body) return;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const cibles = [];
    while (w.nextNode()) {
      const n = w.currentNode;
      if (n.nodeValue && suspect.test(n.nodeValue)) cibles.push(n);
    }
    cibles.forEach((n) => { n.nodeValue = reecrire(n.nodeValue); });
    // Theme sombre re-impose a chaque rendu : la page publique du client
    // s'ouvre en clair et ecrase le reglage pose au chargement.
    if (document.documentElement.getAttribute('data-theme') !== 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    document.querySelectorAll('[title],[alt],[placeholder],[aria-label]').forEach((el) => {
      for (const attr of ['title', 'alt', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && suspect.test(v)) el.setAttribute(attr, reecrire(v));
      }
    });
  };
  const poser = () => {
    if (!document.body) { requestAnimationFrame(poser); return; }
    const st = document.createElement('style');
    st.textContent = `img[src*="galaxy" i], img[src*="fun-galaxy" i], img.logo[alt*="Galaxy" i],
       a:has(> img[src*="galaxy" i]), *:has(> img.logo[src*="galaxy" i])
        { visibility:hidden !important }
      body { zoom: ${zoom} }`;
    (document.head || document.documentElement).appendChild(st);
    passe();
    new MutationObserver(passe).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  poser();
};

async function anonymiser(page) {
  await page.evaluate(() => {
    const REGLES = [
      [/Fun\s*Galaxy\s+Libramont/gi, 'Bowling Central'],
      [/Fun\s*Galaxy\s+Gembloux/gi, 'Bowling Nord'],
      [/Fun\s*Galaxy\s+Ciney/gi, 'Bowling Sud'],
      [/Fun\s*Galaxy/gi, 'Bowling Central'],
      [/fungalaxy/gi, 'democentre'],
      [/mngfunglxy/gi, 'democentre'],
    ];
    const suspect = /fun\s*galaxy|fungalaxy|mngfunglxy/i;
    const reecrire = (v) => { let s = v; for (const [re, to] of REGLES) s = s.replace(re, to); return s; };
    const passe = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const cibles = [];
      while (w.nextNode()) {
        const n = w.currentNode;
        if (n.nodeValue && suspect.test(n.nodeValue)) cibles.push(n);
      }
      // Le remplacement rend le noeud non-suspect : l'observateur qui se
      // redeclenche ne trouve plus rien, la boucle s'arrete d'elle-meme.
      cibles.forEach((n) => { n.nodeValue = reecrire(n.nodeValue); });
      document.querySelectorAll('[title],[alt],[placeholder],[aria-label]').forEach((el) => {
        for (const attr of ['title', 'alt', 'placeholder', 'aria-label']) {
          const v = el.getAttribute(attr);
          if (v && suspect.test(v)) el.setAttribute(attr, reecrire(v));
        }
      });
    };
    passe();
    new MutationObserver(passe).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Le logo de l'enseigne est une image : on la masque sans casser la mise
    // en page (visibility, pas display).
    const st = document.createElement('style');
    st.textContent = `img[src*="galaxy" i], img[src*="fgx" i], img[alt*="galaxy" i],
      .client-logo img, .fgx-menu-brand img { visibility:hidden !important }`;
    document.head.appendChild(st);
  });
}

// Contre-controle : si l'enseigne survit quelque part, le clip est inutilisable
// et il vaut mieux le savoir avant le montage.
async function verifierAnonymat(page, etiquette) {
  const restes = await page.evaluate(() => {
    const m = document.body.innerText.match(/fun\s*galaxy|fungalaxy|mngfunglxy/gi);
    return m ? m.slice(0, 5) : [];
  });
  if (restes.length) {
    MISSED.push(`anonymat ${etiquette} : ${restes.join(', ')}`);
    console.log(`   ENSEIGNE VISIBLE (${etiquette}) : ${restes.join(', ')}`);
    return false;
  }
  console.log(`   anonymat verifie (${etiquette})`);
  return true;
}

// Assemble la sequence PNG en VP9 quasi sans perte.
//
// VP9 et non H.264 : le Chromium livre avec Playwright n'embarque pas les
// codecs proprietaires, et c'est ce meme Chromium qui lira le clip pendant le
// rendu du montage. crf 15 sur une interface sombre = pas d'artefact visible,
// a des annees-lumiere du VP8 basse qualite de recordVideo.
function assembler(nom) {
  const sortie = path.join(OUT, nom + '.webm');
  execSync([
    'ffmpeg -y -hide_banner -loglevel error',
    '-framerate ' + FPS,
    '-i "' + path.join(SEQ, 'f%05d.png') + '"',
    '-c:v libvpx-vp9 -crf 15 -b:v 0 -row-mt 1 -cpu-used 2',
    '-pix_fmt yuv420p',
    '"' + sortie + '"',
  ].join(' '), { stdio: ['ignore', 'ignore', 'pipe'] });
  const mo = (fs.statSync(sortie).size / 1048576).toFixed(1);
  console.log(`   ${nom}.webm : ${frameIdx} images a ${FPS} ips `
    + `(${(frameIdx / FPS).toFixed(1)}s, ${mo} Mo)`);
  fs.rmSync(SEQ, { recursive: true, force: true });
  fs.mkdirSync(SEQ, { recursive: true });
  frameIdx = 0;
}

(async () => {
  const installQaApi = loadFromVisualQa('installQaApi');
  const seedStressDay = loadFromVisualQa('seedStressDay');
  const renderStaffPage = loadFromVisualQa('renderStaffPage');

  const server = await serve();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(SEQ, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();

  // ---- SCENARIO 1 : le client reserve VRAIMENT ------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: CSS_W, height: CSS_H },

      deviceScaleFactor: DSF,
    });
    await ctx.addInitScript(SCRIPT_INIT, ZOOM);
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (typeof setView === 'function') setView('client');
    });
    await page.evaluate(() => document.fonts.ready);
    await pause(page, 1000);
    await installCursor(page);
    await anonymiser(page);

    console.log('SCENARIO 1 - le client reserve');
    await pause(page, 400);
    await typeInto(page, '#fPax', '6', 'nombre de joueurs');
    await clickAt(page, '#segFormule', 'onglet Nos Formules');
    await clickNth(page, '#formuleGrid', 1, 'une formule');
    await clickAt(page, '#segBowling', 'retour Bowling simple');
    await clickNth(page, '#durGrid', 2, 'duree de jeu');
    await clickAt(page, '#btnStep1', 'Verifier les disponibilites', 1100);
    // Etape 2 : le creneau. C'est LE moment ou le produit prouve sa valeur.
    await clickNth(page, '#slotList', 0, 'un creneau disponible', 900);
    await typeInto(page, '#fName', 'Camille Dubois', 'nom du client');
    await typeInto(page, '#fPhone', '0470112233', 'telephone');
    await pause(page, 900);
    await verifierAnonymat(page, 'client');
    await ctx.close();
    assembler('client');
  }

  // ---- SCENARIO 2 : l'equipe pilote le centre ------------------------------
  {
    const ctx = await browser.newContext({
      viewport: { width: CSS_W, height: CSS_H },

      deviceScaleFactor: DSF,
    });
    await ctx.addInitScript(SCRIPT_INIT, ZOOM);
    const page = await ctx.newPage();
    await installQaApi(page);
    await page.goto(`${BASE_URL}/?v=rec2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await seedStressDay(page);
    await page.evaluate(() => document.fonts.ready);
    await pause(page, 1100);
    await installCursor(page);
    await anonymiser(page);

    // Origine des temps du clip staff : tout ce qui suit est date par rapport
    // a cet instant, ce qui permet au montage de scruber pile sur le geste.
    frameIdx = 0;   // origine des temps du clip staff
    console.log('SCENARIO 2 - on SUIT une reservation');
    // Le film raconte une histoire, pas une visite guidee des menus :
    // la reservation tombe, elle se pose dans le planning, la confirmation
    // part, le rappel avant la venue suit, la relance reveille les dormants.
    // Chaque etape ci-dessous est nommee par la voix off au montage.
    const menu = await page.evaluate(() => [...document.querySelectorAll('.fgx-menu-nav [data-fgx-menu-key]')]
      .map((el) => ({ key: el.getAttribute('data-fgx-menu-key'), label: (el.getAttribute('title') || '').trim() }))
      .filter((k) => k.key && k.key !== 'dashboard'));
    console.log(`   ${menu.length} entrees de menu trouvees`);
    const go = async (key, label) => {
      const item = menu.find((k) => k.key === key);
      if (!item) { MISSED.push(label); console.log(`   (menu absent) ${label}`); return false; }
      return clickAt(page, `.fgx-menu-nav [data-fgx-menu-key="${item.key}"]`, item.label || label, 820);
    };

    // 1. « Elle se pose dans votre planning » : la reservation, ouverte.
    await renderStaffPage(page, 'planning');
    await pause(page, 800);
    await hoverText(page, 'Famille Lambert', 'survol de la reservation');
    await clickAt(page, '.booking', 'ouverture de la reservation', 1600);
    await closeOverlay(page, 'fermeture de la fiche');

    // 2. La liste des reservations : la meme resa, vue autrement.
    await go('reservations', 'Reservations');
    await hoverText(page, 'Famille Lambert', 'la resa dans la liste');

    // 3-5. Les sequences d'emails, une par une, dans l'ordre du texte dit.
    await go('emails', 'Emails & relances');
    await pause(page, 400);
    // On cible chaque carte par sa PHRASE DE DESCRIPTION, pas par son titre :
    // « Confirmation » apparait aussi dans des lignes de tableau et dans le
    // texte d'introduction, et le repere se posait alors a cote. La description
    // n'existe qu'une fois, dans sa carte. Taille minimale exigee pour attraper
    // la carte entiere et non la ligne de texte qu'elle contient.
    for (const [txt, label] of [
      ['Confirme la reservation au client', 'sequence Confirmation'],
      ['Rappelle la venue quelques jours', 'sequence Rappel avant la venue'],
      ['Clients fideles plus vus depuis', 'sequence Reactiver les dormants'],
    ]) {
      const seen = await hoverText(page, txt, label, 150, 120);
      if (seen) await pause(page, 320);
    }
    await clickByText(page, 'Nouveau message', 'ouvrir un nouveau message', 1300);
    await closeOverlay(page, 'fermeture du message');

    // 6. Marketing : l'agent IA. On lui PARLE, c'est tout l'interet.
    //
    // La conversation de l'agent se charge en differe. Filmee trop tot, la page
    // ne montre que la barre laterale — et au montage, la voix annonce « une IA
    // marketing » sur un ecran vide. On ATTEND le contenu, et on le dit si
    // jamais il n'arrive pas.
    await go('campaigns', 'Marketing');
    const agentPret = await page.waitForFunction(
      () => /surveille|urgent a publier|Demande-moi/i.test(document.body.innerText),
      null, { timeout: 12000 },
    ).then(() => true).catch(() => false);
    if (!agentPret) {
      MISSED.push('contenu agent marketing');
      console.log('   AGENT MARKETING VIDE : le plan « IA marketing » serait sans image');
    } else {
      console.log(`   agent marketing charge @${instant().toFixed(1)}s`);
      noterMarque('page marketing', { x: 0, y: 0, w: CSS_W, h: CSS_H });
    }
    await pause(page, 700);
    await typeInto(page, '[placeholder*="Demande-moi"], #mkwAsk, textarea',
      'un post pour la soiree fluo de samedi', 'demande a l agent marketing');
    await pause(page, 600);
    for (const onglet of ['Le plan', 'Concurrents', 'Résultats']) {
      await clickByText(page, onglet, `onglet marketing ${onglet}`, 820);
    }

    // 7. Etablissement : tout se regle depuis l'interface.
    await go('establishment', 'Etablissement');
    await pause(page, 500);
    for (const onglet of ['Horaires & fermetures', 'Offres & activités']) {
      await clickByText(page, onglet, `onglet etablissement ${onglet}`, 900);
    }
    await hoverText(page, 'Bowling Nord', 'un autre centre');

    // 8. La data analysee.
    //
    // La console Direction (`setView('admin')`) N'EST PAS filmable ici : elle
    // agrege /api/admin-range, et le mock QA ne produit rien qu'elle sache
    // exploiter — elle affiche « Pas encore de donnees sur cette periode »
    // meme apres avoir alimente la periode et force `loadAdminDashboard(true)`.
    // Ses graphiques demandent le vrai pipeline de donnees.
    //
    // On filme donc la page Clients, qui rend de VRAIES analyses sur les
    // memes donnees : panier moyen, visites et depense par client, a relancer.
    // Montrer un ecran vide « parce que c'etait dans le script » serait pire
    // que de montrer une autre surface qui, elle, prouve le propos.
    await go('clients', 'Clients');
    await pause(page, 600);
    await hoverText(page, 'Panier moyen', 'le panier moyen');
    await clickNth(page, '.table tbody, tbody', 0, 'une fiche client', 1200);
    await page.mouse.move(CSS_W * .62, CSS_H * .42);
    await pause(page, 800);

    // 9. Vue d'ensemble : les compteurs du jour.
    await go('dashboard', "Vue d'ensemble");
    await page.mouse.move(CSS_W * .5, CSS_H * .3);
    await verifierAnonymat(page, 'staff');
    await pause(page, 1400);
    await ctx.close();
    assembler('staff');
  }

  await browser.close();
  server.close();

  const clips = ['client.webm', 'staff.webm']
    .filter((f) => fs.existsSync(path.join(OUT, f)))
    .map((f) => `${f} (${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} Mo)`);
  fs.rmSync(SEQ, { recursive: true, force: true });

  // Fichier de reperes lu par la scene de montage. Ecrit en .js et non .json :
  // la scene est chargee en file:// et un fetch() y est bloque, alors qu'un
  // <script src> passe.
  //
  // Plus aucun recalage a faire : les instants sont le compteur d'images divise
  // par la cadence, donc exactement la position dans le clip assemble. C'est
  // l'avantage cache de la capture image par image — avant, il fallait estimer
  // le decalage entre le debut de l'enregistrement et le debut du scenario.
  const decalage = 0;
  const marques = {};
  for (const [k, v] of Object.entries(MARQUES)) marques[k] = { ...v, t: Number((v.t + decalage).toFixed(2)) };
  fs.writeFileSync(path.join(OUT, 'marks.js'),
    '// Genere par scripts/promo-record.js — coordonnees et instants releves PENDANT le tournage.\n'
    + `window.PROMO_MARKS = ${JSON.stringify(marques, null, 1)};\n`);
  console.log(`\nreperes : ${Object.keys(marques).length} (decalage clip ${decalage.toFixed(2)}s) -> artifacts/promo-clips/marks.js`);
  for (const [k, v] of Object.entries(marques)) console.log(`   ${k.padEnd(34)} ${v.x},${v.y} ${v.w}x${v.h} @${v.t}s`);

  console.log(`\nclips ${W}x${H} (natif, sans remplissage) : ` + (clips.join(', ') || 'AUCUN'));
  console.log(`gestes joues : ${DONE.length}  -  ${DONE.join(' | ')}`);
  if (MISSED.length) console.log(`gestes MANQUES : ${MISSED.join(' | ')}`);
  if (!clips.length) process.exit(1);
  // Un clip sans geste, c'est un screencast fixe : autant le savoir ici.
  if (DONE.length < 8) { console.error(`\nECHEC : ${DONE.length} gestes seulement, le clip serait statique`); process.exit(1); }
})().catch((e) => { console.error('promo-record:', e.message); process.exit(1); });
