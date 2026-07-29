// CAPTURE LES DETAILS DU PRODUIT EN HAUTE DEFINITION, POUR LES VIGNETTES.
//
// POURQUOI CE SCRIPT EXISTE (le defaut qu'il corrige) :
//
// Les vignettes du film montraient un morceau DECOUPE DANS LE CLIP VIDEO, a des
// coordonnees ecrites a la main. Deux consequences, toutes les deux visibles a
// l'image :
//
//   1. FLOU. Le clip fait 3840 de large ; un decoupage de 520 px affiche dans
//      une carte de 548 px CSS, elle-meme rendue a 1,5x, occupe 822 pixels du
//      film. On agrandit donc 520 en 822, soit +58 %, A PARTIR D'UNE SOURCE
//      VP9 DEJA COMPRESSEE. Aucun reglage d'encodage ne rattrape ca.
//
//   2. CADRAGE FAUX. Un rectangle en dur ne sait pas ou est le contenu : il
//      coupait « Entreprise Ardenne Formule Premiu... » en plein milieu d'un
//      mot et tranchait le bouton « + Reservation » en deux.
//
// LA CORRECTION EST STRUCTURELLE, PAS UN REGLAGE. On ne decoupe plus une image,
// on CAPTURE L'ELEMENT : Playwright vise le noeud du DOM, le cadre est donc son
// rectangle exact, plus une marge. Un mot ne peut PLUS etre coupe — ce n'est
// pas mieux mesure, c'est impossible par construction.
//
// Et la nettete devient un exces : a densite 3, une carte de 320 px CSS sort en
// 960 pixels pour un affichage sur 822. L'image est REDUITE, jamais agrandie.
//
// Sortie : artifacts/promo-clips/details/<cle>.png + details.json (dimensions
// reelles de chaque capture — la scene y lit le RATIO pour dimensionner sa
// vignette, au lieu d'ecraser l'image dans un cadre arbitraire).
//
// Usage : node scripts/promo-details.js [--dsf 3]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const DSF = Number(arg('dsf', 3));
const ZOOM = Number(arg('zoom', 1.3));
// Le theme se choisit ici et NON au montage : une capture sombre eclaircie
// apres coup garde ses ombres et ses bordures sombres. C'est le produit qui
// possede les deux themes, autant les lui demander.
const THEME = arg('theme', 'dark');
const CSS_W = 2560, CSS_H = 1440;
const PORT = 4602;                       // 4601 est pris par le tournage
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'artifacts/promo-clips', arg('out', THEME === 'dark' ? 'details' : 'details-' + THEME));

// Marge autour de l'element. Sans elle, l'ombre et la bordure de la carte sont
// rasees et la vignette a l'air decoupee aux ciseaux. Reglable par cible :
// un element colle a son voisin doit etre pris au ras, sinon la marge mord
// sur la ligne d'a cote et la coupe.
const MARGE_DEF = 16;

// UNE VIGNETTE DOIT AGRANDIR, SINON ELLE FAIT DOUBLON.
//
// L'ecran principal montre 2560 px CSS de produit sur 1560 px de film : son
// echelle est 0,61. Une vignette qui afficherait le produit a une echelle plus
// faible se lirait comme une deuxieme copie du meme ecran, en plus petit —
// c'est exactement ce que Movsar a vu.
//
// La scene ne fixe donc PAS la largeur des vignettes : elle leur donne une
// AIRE constante et le ratio natif de la capture, ce qui evite d'ecraser une
// image large dans un cadre carre. On reproduit ici le meme calcul pour
// verifier, avant le montage, que chaque detail agrandira pour de vrai.
const ECHELLE_ECRAN = 1560 / 2560;
const AGRANDISSEMENT_MIN = 1.5;
const AIRE_F1 = 548 * 316, LARG_MAX_F1 = 820;
const AIRE_F2 = 436 * 252, LARG_MAX_F2 = 600;
const DSF_FILM = 1.5;                 // densite a laquelle le montage est rendu

// TROISIEME PLAFOND, ET C'EST LUI QUI TUE LE FLOU : la vignette ne depasse
// jamais la definition NATIVE de sa capture. Au-dela, on agrandirait des
// pixels — exactement la faute de la version precedente, qui etirait 520 px
// de video sur 822 px de film. Ici c'est structurellement impossible : la
// largeur est bornee par le nombre de pixels reellement captures.
const largeurVignette = (aire, largMax, ratio, wPx) =>
  Math.min(largMax, Math.sqrt(aire * ratio), wPx / DSF_FILM);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

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

// Les fonctions de mise en scene vivent dans le harnais QA : les recopier ici
// les ferait diverger a la premiere evolution du produit.
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

const INIT = ([zoom, theme]) => {
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
    // Le theme est re-impose a CHAQUE passe : la page publique du client
    // s'ouvre dans son propre theme et ecrase le reglage pose au chargement.
    if (document.documentElement.getAttribute('data-theme') !== theme) {
      document.documentElement.setAttribute('data-theme', theme);
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
      body { zoom: ${zoom} }
      /* Une capture d'element fige : toute animation en cours sortirait a
         mi-parcours, donc a demi transparente ou decalee. */
      *, *::before, *::after { animation-duration:0s !important; transition-duration:0s !important }`;
    (document.head || document.documentElement).appendChild(st);
    passe();
    new MutationObserver(passe).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  poser();
};

// ===========================================================================
// UN SAMEDI CHARGE, ET NON LE JEU DE TEST.
//
// Les captures se faisaient sur le fixture du harnais QA : quatre reservations
// aux noms volontairement interminables, faits pour eprouver la mise en page.
// A l'ecran d'une publicite, ca donne un planning presque vide et un chiffre
// du jour a 601 € — « 4 reservations mdrr », verdict de Movsar, et il a raison :
// on ne vend pas un outil de pilotage avec la journee d'un centre a l'arret.
//
// Ce seed-ci decrit un samedi PLEIN et plausible : 8 pistes de 10 h a 22 h,
// des groupes de tailles variees, des formules, des anniversaires. Les chiffres
// que le film affiche restent donc LUS SUR L'ECRAN — c'est la journee montree
// qui change, pas les nombres qu'on lui fait dire.
//
// Aucun tirage aleatoire : la table est ecrite, donc deux captures successives
// donnent exactement la meme image.
// ===========================================================================
const SAMEDI = (() => {
  const groupes = [
    ['Famille Lambert', 'bowling', 'Bowling classique', 4, 39],
    ['Anniversaire Léa', 'bowling', 'Bowling classique', 8, 78],
    ['Groupe Vandenberg', 'bowling', 'Bowling classique', 6, 59],
    ['Entreprise Ardenne', 'formule', 'FORMULE 3', 11, 308],
    ['École Saint-Hubert', 'bowling', 'Bowling 2 h', 17, 156],
    ['Famille Moreau', 'bowling', 'Bowling classique', 5, 39],
    ['CE Delhaize', 'formule', 'FORMULE 2', 14, 266],
    ['Anniversaire Noah', 'bowling', 'Bowling classique', 9, 78],
    ['Team Proximus', 'formule', 'FORMULE 3', 12, 336],
    ['Famille Dubois', 'bowling', 'Bowling classique', 4, 39],
    ['Club Ath', 'bowling', 'Bowling 2 h', 16, 156],
    ['Anniversaire Jade', 'bowling', 'Bowling classique', 7, 59],
    ['Famille Petit', 'bowling', 'Bowling classique', 3, 20],
    ['Groupe Namur', 'formule', 'FORMULE 1', 10, 190],
    ['Amis Charleroi', 'bowling', 'Bowling classique', 6, 59],
    ['Anniversaire Tom', 'bowling', 'Bowling classique', 8, 78],
    ['Famille Renard', 'bowling', 'Bowling classique', 5, 39],
    ['Scouts Libramont', 'bowling', 'Bowling 2 h', 18, 156],
    ['Team Engie', 'formule', 'FORMULE 2', 13, 247],
    ['Famille Collin', 'bowling', 'Bowling classique', 4, 39],
    ['Anniversaire Inès', 'bowling', 'Bowling classique', 9, 78],
    ['Groupe Bastogne', 'bowling', 'Bowling classique', 7, 59],
    ['Famille Gérard', 'bowling', 'Bowling classique', 5, 39],
    ['CE Carrefour', 'formule', 'FORMULE 3', 15, 420],
    ['Amis Marche', 'bowling', 'Bowling classique', 6, 59],
    ['Anniversaire Hugo', 'bowling', 'Bowling classique', 8, 78],
    ['Famille Simon', 'bowling', 'Bowling classique', 4, 39],
    ['Club Neufchâteau', 'bowling', 'Bowling 2 h', 14, 156],
    ['Famille Leroy', 'bowling', 'Bowling classique', 6, 59],
    ['Anniversaire Manon', 'bowling', 'Bowling classique', 10, 98],
    ['Groupe Arlon', 'formule', 'FORMULE 2', 12, 228],
    ['Famille Denis', 'bowling', 'Bowling classique', 5, 39],
    ['Amis Dinant', 'bowling', 'Bowling classique', 7, 59],
    ['Anniversaire Sacha', 'bowling', 'Bowling classique', 8, 78],
    ['Famille Bertrand', 'bowling', 'Bowling classique', 4, 39],
    ['Team Belfius', 'formule', 'FORMULE 1', 11, 209],
    ['Famille Nicolas', 'bowling', 'Bowling classique', 6, 59],
    ['Anniversaire Elsa', 'bowling', 'Bowling classique', 9, 78],
  ];
  // Remplissage piste par piste : chaque piste enchaine ses sessions sans
  // chevauchement, ce qui donne un planning dense mais coherent.
  const PISTES = 8;
  const suivante = Array.from({ length: PISTES }, () => 10);   // heure libre par piste
  const STATUTS = ['paid', 'arrived', 'confirmed', 'confirmed', 'paid'];
  return groupes.map((g, i) => {
    const [nom, type, label, pax, price] = g;
    const duree = label.includes('2 h') ? 2 : (type === 'formule' ? 1.5 : 1);
    const nbPistes = pax > 12 ? 3 : (pax > 6 ? 2 : 1);
    // On choisit les pistes les plus tot disponibles.
    const ordre = suivante.map((h, k) => ({ h, k })).sort((a, b) => a.h - b.h || a.k - b.k);
    const choisies = ordre.slice(0, nbPistes);
    const debut = Math.max(...choisies.map((c) => c.h));
    choisies.forEach((c) => { suivante[c.k] = debut + duree; });
    const hh = String(Math.floor(debut)).padStart(2, '0');
    const mm = debut % 1 === 0 ? '00' : '30';
    return {
      id: 8000 + i, name: `${nom} #${8000 + i}`,
      phone: `+3247086${String(1000 + i).slice(-4)}`,
      email: `contact${i}@example.test`,
      startTime: `${hh}:${mm}`, duration: duree,
      lanes: choisies.map((c) => c.k + 1),
      status: STATUTS[i % STATUTS.length],
      pax, price, type, label,
      ...(type === 'formule' ? { formuleId: 'formule3' } : {}),
    };
  }).filter((r) => Number(r.startTime.slice(0, 2)) < 22);
})();

// LE JEU DE DONNEES S'INJECTE AVANT LE CHARGEMENT, PAS APRES.
//
// Assigner `state.reservations` une fois la page chargee ne tient pas : le
// produit reconstruit son etat depuis la fabrique `__PINLANE_QA_RESERVATIONS__`
// a plusieurs moments, et l'affectation se faisait ecraser en silence — l'ecran
// restait a quatre reservations pendant que je croyais en avoir pose
// trente-huit. On remplace donc LA FABRIQUE, dans un addInitScript pose APRES
// celui du harnais QA : le dernier inscrit gagne, et tous les chemins de
// rechargement servent desormais le samedi charge.
async function poserJeuSamedi(page) {
  await page.addInitScript((resas) => {
    const fabrique = (date) => resas.map((r) => ({ ...r, date }));
    window.__PINLANE_QA_RESERVATIONS__ = fabrique;
    Object.defineProperty(window, '__PINLANE_QA_RESERVATIONS__', {
      value: fabrique, writable: false, configurable: false,
    });
  }, SAMEDI);
}

async function seedSamediCharge(page) {
  const total = await page.evaluate((resas) => {
    const d = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
    const jeu = resas.map((r) => ({ ...r, date: d }));
    // On remplace AUSSI la fabrique du harnais QA : plusieurs chemins du
    // produit la rappellent pour reconstruire l'etat, et le premier essai
    // s'est fait ecraser en silence — l'ecran affichait encore les quatre
    // reservations du jeu de test alors que l'etat en contenait trente-huit.
    window.__PINLANE_QA_RESERVATIONS__ = () => jeu.map((r) => ({ ...r }));
    state.currentDate = d;
    state.staffMenuPage = 'planning';
    state.staffResourceView = 'bowling';
    state.reservations = jeu;
    if (typeof save === 'function') save();
    if (typeof setView === 'function') setView('staff');
    if (typeof renderStaff === 'function') renderStaff();
    return {
      resas: state.reservations.length,
      joueurs: state.reservations.reduce((s, r) => s + r.pax, 0),
      ca: state.reservations.reduce((s, r) => s + r.price, 0),
    };
  }, SAMEDI);
  console.log(`   samedi charge : ${total.resas} réservations, ${total.joueurs} joueurs, ${total.ca} €`);
  return total;
}

// GARDE : l'ECRAN affiche-t-il bien ce qu'on a seme ?
//
// C'est la garde qui manquait. Le seed rapportait 38 reservations pendant que
// la page en affichait 4, et rien ne le signalait : on ne verifiait que l'etat
// interne, jamais le rendu. Un jeu de donnees pose n'est pas un jeu de donnees
// AFFICHE.
async function verifierDonneesAffichees(page, attendu) {
  const lu = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = /(\d+)\s+réservations?\s+bowling/i.exec(t);
    const j = /•\s*(\d+)\s+joueurs/i.exec(t);
    return { resas: m ? Number(m[1]) : null, joueurs: j ? Number(j[1]) : null };
  });
  if (lu.resas === null) { RATES.push('impossible de lire le compte affiche sur le planning'); return; }
  // Le planning ne montre que le bowling : le compte affiche est donc <= total.
  if (lu.resas < attendu.resas * 0.5) {
    RATES.push(`l'ecran affiche ${lu.resas} reservations pour ${attendu.resas} semees — le seed a ete ecrase`);
  }
  console.log(`   ecran : ${lu.resas} reservations, ${lu.joueurs} joueurs affiches`);
}

const RATES = [];
const FAITS = [];

// LE BORD DOIT TOMBER DANS DU VIDE, PAS DANS UNE LIGNE DE TEXTE.
//
// Viser l'element garantit que SON contenu est entier, pas que la marge de
// securite ne mord pas sur le voisin d'a cote : la fiche client sortait avec
// un numero de telephone tranche en deux dans les 6 derniers pixels.
//
// Le discriminant est le CONTRASTE de la bande de bord. Du fond uni donne un
// ecart-type nul ; une ligne de texte coupee monte a 46. Mesure sur les 17
// captures : les saines sont a 0,0-4,4, la coupee a 46,2 — la separation est
// franche, pas un reglage a la main.
const BORD_MAX = 8;
function luminanceMoyenne(fichier) {
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', fichier, '-vf', 'format=gray',
    '-f', 'rawvideo', '-'], { maxBuffer: 256 * 1024 * 1024 });
  let s = 0;
  for (let i = 0; i < g.length; i += 4) s += g[i];
  return s / Math.ceil(g.length / 4);
}
function contrasteDesBords(fichier) {
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', fichier], { encoding: 'utf8' }).trim().split(',');
  const W = Number(dims[0]), H = Number(dims[1]);
  const bande = (crop) => {
    const g = execFileSync('ffmpeg', ['-v', 'error', '-i', fichier, '-vf', `crop=${crop},format=gray`,
      '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
    let s = 0, q = 0;
    for (let i = 0; i < g.length; i++) { s += g[i]; q += g[i] * g[i]; }
    const m = s / g.length;
    return Math.sqrt(Math.max(0, q / g.length - m * m));
  };
  const e = 7;
  return Math.max(
    bande(`${W}:${e}:0:0`), bande(`${W}:${e}:0:${H - e}`),
    bande(`${e}:${H}:0:0`), bande(`${e}:${H}:${W - e}:0`),
  );
}

// Trouve le PLUS PETIT element qui contient le texte et depasse les minimums.
// Le plus petit, parce que le texte cherche apparait aussi dans les ancetres :
// viser le plus grand ramenerait la page entiere.
async function capturer(page, cle, texte, opts = {}) {
  const minW = opts.minW || 150, minH = opts.minH || 70;
  const MARGE = opts.marge === undefined ? MARGE_DEF : opts.marge;
  const info = await page.evaluate(([needle, mw, mh, marge]) => {
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const el = [...document.querySelectorAll('*')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width < mw || r.height < mh) return false;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < .2) return false;
        return norm(e.textContent).includes(want);
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (ra.width * ra.height) - (rb.width * rb.height);
      })[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    // getBoundingClientRect tient DEJA compte du zoom CSS : ces coordonnees
    // sont directement celles du viewport, aucun facteur a appliquer.
    return {
      x: Math.max(0, Math.round(r.left - marge)),
      y: Math.max(0, Math.round(r.top - marge)),
      w: Math.round(Math.min(r.width + marge * 2, window.innerWidth - Math.max(0, r.left - marge))),
      h: Math.round(Math.min(r.height + marge * 2, window.innerHeight - Math.max(0, r.top - marge))),
      brutW: Math.round(r.width), brutH: Math.round(r.height),
      dedans: r.top >= -1 && r.bottom <= window.innerHeight + 1,
      apercu: norm(el.textContent).slice(0, 70),
    };
  }, [texte, minW, minH, MARGE]);

  if (!info) { RATES.push(`${cle} : « ${texte} » introuvable`); console.log(`   MANQUE ${cle}`); return null; }
  await page.waitForTimeout(360);           // le defilement doit se poser
  const r2 = await page.evaluate(([needle, mw, mh, marge]) => {
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(needle);
    const el = [...document.querySelectorAll('*')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width < mw || r.height < mh) return false;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < .2) return false;
        return norm(e.textContent).includes(want);
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (ra.width * ra.height) - (rb.width * rb.height);
      })[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left - marge)),
      y: Math.max(0, Math.round(r.top - marge)),
      w: Math.round(Math.min(r.width + marge * 2, window.innerWidth - Math.max(0, r.left - marge))),
      h: Math.round(Math.min(r.height + marge * 2, window.innerHeight - Math.max(0, r.top - marge))),
      brutW: Math.round(r.width), brutH: Math.round(r.height),
      dedans: r.top >= -1 && r.bottom <= window.innerHeight + 1,
    };
  }, [texte, minW, minH, MARGE]);
  const box = r2 || info;

  if (!box.dedans) { RATES.push(`${cle} : deborde du viewport (${box.brutW}x${box.brutH})`); }
  const fichier = path.join(OUT, cle + '.png');
  await page.screenshot({ path: fichier, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });

  // Si la marge a mordu sur le voisin, on reprend AU RAS de l'element. Le
  // cadre devient alors son rectangle exact : plus aucun pixel etranger ne
  // peut y entrer, c'est garanti par construction et non par une mesure.
  let bord = contrasteDesBords(fichier);
  // La garde de bord ne cherche qu'une chose : la marge a-t-elle mordu sur le
  // voisin. Sans marge elle n'a pas d'objet — et elle se trompe : le lisere de
  // statut d'une reservation, coupe par les coins arrondis, fait monter la
  // mesure a 67 sur une capture pourtant parfaitement entiere.
  let auRas = MARGE === 0;
  if (bord > BORD_MAX && MARGE > 0) {
    box.x += MARGE; box.y += MARGE;
    box.w = Math.max(8, box.w - MARGE * 2); box.h = Math.max(8, box.h - MARGE * 2);
    await page.screenshot({ path: fichier, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    bord = contrasteDesBords(fichier);
    auRas = true;
  }
  if (bord > BORD_MAX && !auRas) RATES.push(`${cle} : le cadre coupe du contenu (contraste de bord ${bord.toFixed(1)})`);

  // Le theme demande est-il celui qu'on a capture ? Une page qui ecrase le
  // reglage (la page publique du client le fait) donnerait des cartes sombres
  // posees sur une direction artistique claire — le defaut saute aux yeux dans
  // le film, jamais dans un journal qui dit « 22 details captures ».
  const lum = luminanceMoyenne(fichier);
  const attenduClair = THEME !== 'dark';
  if (attenduClair && lum < 140) RATES.push(`${cle} : theme ${THEME} demande mais capture sombre (luminance ${lum.toFixed(0)})`);
  if (!attenduClair && lum > 120) RATES.push(`${cle} : theme sombre demande mais capture claire (luminance ${lum.toFixed(0)})`);

  const octets = fs.statSync(fichier).size;
  const px = { w: Math.round(box.w * DSF), h: Math.round(box.h * DSF) };
  // Deux cibles qui tombent sur le MEME element donnent deux vignettes
  // identiques cote a cote — le defaut se voit tout de suite a l'ecran, mais
  // jamais dans un journal qui dit « 14 details captures ».
  const jumeau = FAITS.find((f) => f.x === box.x && f.y === box.y && f.cssW === box.w);
  if (jumeau) RATES.push(`${cle} : capture le meme element que ${jumeau.cle}`);

  const ratio = box.w / box.h;
  const l1 = largeurVignette(AIRE_F1, LARG_MAX_F1, ratio, px.w);
  const l2 = largeurVignette(AIRE_F2, LARG_MAX_F2, ratio, px.w);
  const g1 = l1 / box.w / ECHELLE_ECRAN;
  const g2 = l2 / box.w / ECHELLE_ECRAN;
  // Definition effective : pixels de capture par pixel de film. Le plafond
  // ci-dessus la maintient >= 1 ; on la journalise pour le prouver.
  const defi = px.w / (l1 * DSF_FILM);

  FAITS.push({ cle, texte, x: box.x, y: box.y, cssW: box.w, cssH: box.h, w: px.w, h: px.h,
    ratio: +ratio.toFixed(3), g1: +g1.toFixed(2), g2: +g2.toFixed(2), defi: +defi.toFixed(2),
    bord: +bord.toFixed(1), auRas, marge: auRas ? 0 : MARGE, octets });
  const place = g2 >= AGRANDISSEMENT_MIN ? 'f1+f2' : (g1 >= AGRANDISSEMENT_MIN ? 'f1 seul' : 'AUCUN');
  console.log(`   ${cle} : ${box.w}x${box.h} css -> ${px.w}x${px.h} px  `
    + `zoom x${g1.toFixed(1)}/x${g2.toFixed(1)}  definition x${defi.toFixed(1)}  `
    + `bord ${bord.toFixed(1)}${auRas ? ' (au ras)' : ''}  [${place}]`);
  if (g1 < AGRANDISSEMENT_MIN) {
    RATES.push(`${cle} : n'agrandit que x${g1.toFixed(2)} meme dans le grand cadre (minimum x${AGRANDISSEMENT_MIN})`);
  }
  return box;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const installQaApi = loadFromVisualQa('installQaApi');
  const seedStressDay = loadFromVisualQa('seedStressDay');
  const renderStaffPage = loadFromVisualQa('renderStaffPage');
  const browser = await chromium.launch();

  // ---- COTE CLIENT ---------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DSF });
    await ctx.addInitScript(INIT, [ZOOM, THEME]);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/?demo=1&v=det-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      if (typeof setView === 'function') setView('client');
    }, THEME);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    console.log('COTE CLIENT');

    // 17 joueurs : la crea « Samedi » enchaine « un groupe de dix-sept » sur le
    // plan du planning PUIS le formulaire. Avec 6 dans le champ, deux plans
    // consecutifs se contredisaient. Un chiffre juste isolement peut etre faux
    // dans l'enchainement.
    await page.evaluate(() => { const e = document.querySelector('#fPax'); if (e) { e.value = '17'; e.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForTimeout(400);
    // Cibles choisies dans l'inventaire des elements REELS de la page, pas
    // devinees : « Durée » attrapait le conteneur entier (1020 px CSS), la
    // vignette aurait montre le produit plus PETIT que la fenetre principale.
    await capturer(page, 'client-joueurs', 'Nombre de joueurs', { minW: 240, minH: 90 });
    await capturer(page, 'client-duree', '1 heure', { minW: 180, minH: 60 });
    await capturer(page, 'client-date', 'Ouvert 10h', { minW: 240, minH: 90 });
    await ctx.close();
  }

  // ---- COTE EQUIPE ---------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DSF });
    await ctx.addInitScript(INIT, [ZOOM, THEME]);
    const page = await ctx.newPage();
    // MODE DEMONSTRATION DU PRODUIT (`?demo=1`) plutot que le harnais QA.
    //
    // Le harnais sert des donnees de TEST : quatre reservations aux noms
    // interminables, faites pour eprouver la mise en page. Poser un autre jeu
    // par-dessus ne marchait pas — le produit charge ses reservations par son
    // API, que le harnais intercepte, si bien que `state.reservations = ...`
    // etait ecrase en silence et que l'ecran restait a quatre lignes.
    //
    // Le mode demo, lui, EST prevu pour ca : meme application, journee
    // coherente, reseau coupe, enseigne remplacee avant le premier rendu.
    // On cesse donc de lutter contre le harnais et on utilise la porte prevue.
    await page.goto(`${BASE_URL}/?demo=1&v=det2-${Date.now()}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => typeof window.setView === 'function', null, { timeout: 15000 });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), THEME);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1800);
    const journee = await page.evaluate(() => {
      let r = [];
      try { r = state.reservations || []; } catch (e) { r = []; }
      return { resas: r.length, joueurs: r.reduce((s, x) => s + (x.pax || 0), 0) };
    });
    console.log(`   journee de demonstration : ${journee.resas} réservations, ${journee.joueurs} joueurs`);

    const menu = await page.evaluate(() => [...document.querySelectorAll('.fgx-menu-nav [data-fgx-menu-key]')]
      .map((el) => ({ key: el.getAttribute('data-fgx-menu-key'), label: (el.getAttribute('title') || '').trim() })));
    const go = async (key) => {
      const item = menu.find((k) => k.key === key);
      if (!item) { RATES.push(`menu ${key} absent`); return false; }
      await page.evaluate((k) => {
        const el = document.querySelector(`.fgx-menu-nav [data-fgx-menu-key="${k}"]`);
        if (el) el.click();
      }, key);
      await page.waitForTimeout(1100);
      return true;
    };

    console.log('PLANNING');
    await page.waitForTimeout(800);
    await verifierDonneesAffichees(page, journee);
    // Cibles relevees dans l'inventaire du MODE DEMO : sa mise en page n'est
    // pas celle du harnais QA, et les anciennes cibles y attrapaient des
    // conteneurs pleine page (2560 x 6838).
    await capturer(page, 'plan-titre', '38 réservations bowling', { minW: 250, minH: 45 });
    // Au ras : dans le planning les reservations se touchent, la marge tombait
    // dans la ligne du dessous.
    await capturer(page, 'plan-booking', 'Famille Dubois', { minW: 130, minH: 90, marge: 0 });
    await capturer(page, 'plan-booking2', 'Club Padel', { minW: 130, minH: 44, marge: 0 });

    console.log("VUE D'ENSEMBLE");
    await go('dashboard');
    await page.waitForTimeout(600);
    await capturer(page, 'dash-resa', 'Réservations aujourd', { minW: 250, minH: 80 });
    await capturer(page, 'dash-joueurs', 'Joueurs aujourd', { minW: 250, minH: 80 });
    await capturer(page, 'dash-occup', "Taux d'occupation", { minW: 250, minH: 60 });
    await capturer(page, 'dash-donut', '38 réservations aujourd', { minW: 150, minH: 150 });
    await capturer(page, 'dash-encaisser', 'Paiement à encaisser', { minW: 250, minH: 60 });

    console.log('EMAILS');
    await go('emails');
    await capturer(page, 'mail-confirmation', 'Confirme la réservation au client', { minW: 220, minH: 100 });
    await capturer(page, 'mail-rappel', 'Rappelle la venue quelques jours', { minW: 220, minH: 100 });
    await capturer(page, 'mail-anniv', "L’anniversaire fêté ici revient", { minW: 220, minH: 100 });

    console.log('MARKETING');
    await go('campaigns');
    await page.waitForFunction(() => /surveille|urgent a publier|Demande-moi/i.test(document.body.innerText),
      null, { timeout: 12000 }).catch(() => RATES.push('agent marketing vide'));
    await page.waitForTimeout(900);
    // Sur des donnees de demonstration, l'agent n'a rien a proposer : ses
    // compteurs affichent 0. On montre donc ce qu'il EST (« je surveille… »,
    // « il propose, tu valides ») et pas ce qu'il a trouve ce matin — un zero
    // agrandi en plein ecran dirait le contraire de ce que dit la voix.
    await capturer(page, 'mkt-agent', 'en veille', { minW: 240, minH: 34 });
    await capturer(page, 'mkt-onglets', 'Studio', { minW: 300, minH: 30 });

    // ETABLISSEMENT : le mode demo ne configure qu'un seul centre, il n'y a
    // donc rien a montrer de « vos centres ». La crea « Samedi » ne parle pas
    // de multi-centre : on ne capture pas une page pour la laisser inutilisee.

    console.log('CLIENTS');
    await go('clients');
    await capturer(page, 'cli-venir', 'attendus', { minW: 250, minH: 90 });

    const restes = await page.evaluate(() => {
      const m = document.body.innerText.match(/fun\s*galaxy|fungalaxy|mngfunglxy/gi);
      return m ? m.slice(0, 5) : [];
    });
    if (restes.length) RATES.push(`enseigne visible : ${restes.join(', ')}`);
    await ctx.close();
  }

  await browser.close();
  server.close();

  fs.writeFileSync(path.join(OUT, 'details.json'), JSON.stringify({ dsf: DSF, zoom: ZOOM, items: FAITS }, null, 2));
  // La scene est ouverte en file:// : elle ne peut pas lire un JSON par fetch
  // (meme origine refusee). On ecrit donc un script, charge par <script src>,
  // comme marks.js. La scene y prend le RATIO de chaque capture pour ne jamais
  // ecraser une image dans un cadre qui n'est pas le sien.
  const table = {};
  // `marge` sert a la scene : c'est elle qui borne le zoom de respiration.
  // Sans cette valeur, un zoom uniforme rognerait le texte des captures prises
  // au ras, qui n'ont aucune marge de securite.
  FAITS.forEach((f) => { table[f.cle] = { w: f.w, h: f.h, ratio: f.ratio, cssW: f.cssW, marge: f.marge }; });
  fs.writeFileSync(path.join(OUT, 'details.js'),
    '// Genere par scripts/promo-details.js — ne pas editer a la main.\n'
    + 'window.PROMO_DETAILS = ' + JSON.stringify(table, null, 2) + ';\n');
  console.log(`\n${FAITS.length} details captures dans ${path.relative(ROOT, OUT)}`);
  if (RATES.length) {
    console.log('\nPROBLEMES :');
    RATES.forEach((r) => console.log('  - ' + r));
    process.exit(1);
  }
  console.log('OK : toutes les cibles capturees, aucune coupee, aucune trop large');
})().catch((e) => { console.error(e); process.exit(1); });
